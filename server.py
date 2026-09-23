"""Modern Modular FastAPI Server and Async REST API for Warhammer 40k Elo Ranking UI."""

import logging
import os
import sys
import argparse
try:
    import uvicorn
except ImportError:
    uvicorn = None
import math
import json
import secrets
import asyncio
import re
import time
import concurrent.futures
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from core import (
    FASTAPI_AVAILABLE, FastAPI, APIRouter, HTTPException, Query, Request, Response, BackgroundTasks,
    FileResponse, JSONResponse, PlainTextResponse, RedirectResponse, HTMLResponse, StreamingResponse,
    CORSMiddleware, StaticFiles,
    get_database, get_elo_engine, get_auth_manager, get_firestore_engine, get_army_parser,
    _get_user_session_or_401, _get_admin_session_or_403, _get_to_session_or_403,
    NO_CACHE_HEADERS, VERIFIED_TOURNAMENT_CITIES, web_dir, package_dir, logger,
    BestCoastPairingsScraper, Database, EloEngine,
    DEFAULT_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR, MIN_MATCHES_FOR_RANKING,
    BCP_API_BASE, DEFAULT_HEADERS, BCP_CLIENT_ID, BCP_USER_AGENT, GOOGLE_MAPS_API_KEY,
    TRACKER_ROOMS, TRACKER_LISTENERS, generate_unique_match_id, normalize_tracker_match_id
)

from routers import (
    admin,
    connect,
    community,
    armylists,
    auth,
    leaderboard,
    tracker,
    eventstudio,
    armory,
    leagues
)

app = FastAPI(
    title="OmniTactica - Warhammer 40k Suite API",
    version="2.1.0",
    description="High-performance async API for OmniTactica: Warhammer 40,000 Elo rankings, live match tracker, and BCP tournament suite.",
    docs_url="/docs",
    redoc_url="/redoc"
)

# GZip Response Compression Middleware
try:
    from starlette.middleware.gzip import GZipMiddleware
    app.add_middleware(GZipMiddleware, minimum_size=1000)
except ImportError:
    try:
        from fastapi.middleware.gzip import GZipMiddleware
        app.add_middleware(GZipMiddleware, minimum_size=1000)
    except ImportError:
        pass

# In-Memory Rate Limiting for Auth & Sensitive Endpoints
_AUTH_RATE_LIMITS = {
    "/api/auth/login": (20, 60),               # 20 requests per 60s
    "/api/auth/verify-registration": (15, 60), # 15 requests per 60s
    "/api/auth/register": (10, 60),            # 10 requests per 60s
    "/api/auth/forgot-password": (8, 60),      # 8 requests per 60s
    "/api/auth/reset-password": (8, 60),       # 8 requests per 60s
}
_rate_limits_state: Dict[str, List[float]] = {}

# HTTP Caching, Security Headers, and Rate Limiting Middleware
@app.middleware("http")
async def add_security_cache_and_rate_limit(request: Request, call_next):
    path = request.url.path
    client_ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "127.0.0.1")
    if client_ip and "," in client_ip:
        client_ip = client_ip.split(",")[0].strip()

    # 1. Rate Limiting Check
    if path in _AUTH_RATE_LIMITS:
        max_requests, window_secs = _AUTH_RATE_LIMITS[path]
        rate_key = f"{client_ip}:{path}"
        now = time.time()
        timestamps = _rate_limits_state.get(rate_key, [])
        valid_timestamps = [t for t in timestamps if (now - t) < window_secs]
        if len(valid_timestamps) >= max_requests:
            retry_after = int(window_secs - (now - valid_timestamps[0])) + 1
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please slow down.", "error": "Rate limit exceeded. Please try again shortly."},
                headers={"Retry-After": str(max(1, retry_after))}
            )
        valid_timestamps.append(now)
        _rate_limits_state[rate_key] = valid_timestamps
        if len(_rate_limits_state) > 10000:
            for k in list(_rate_limits_state.keys())[:2000]:
                _rate_limits_state.pop(k, None)

    response = await call_next(request)

    # 2. Baseline Security Headers (OWASP)
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(self)"

    # 3. HTTP Caching & Edge Rules
    if (
        path.startswith("/api/auth") or
        path.startswith("/api/user") or
        path.startswith("/api/admin") or
        path.startswith("/api/eventstudio") or
        path.startswith("/api/feedback") or
        path.startswith("/api/connect") or
        path.startswith("/api/tracker") or
        path.startswith("/api/chat") or
        path.startswith("/api/version") or
        path == "/health" or
        path == "/api/health"
    ):
        # Never cache authentication, admin, studio, session, user, connect, chat, live tracker, health, or version endpoints
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
    elif path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=86400, stale-while-revalidate=604800"
        if "Pragma" in response.headers:
            del response.headers["Pragma"]
    elif path.startswith("/css") or path.startswith("/js") or path in ("/", "/app", "/app.html", "/index.html", "/login", "/eventstudio", "/eventstudio.html", "/version.json"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    elif path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"

    return response

# CORS Middleware with explicit origins and regex support for credentials
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|.*\.c\.googlers\.com|.*\.omnitactica\.(com|app))(:\d+)?$",
    allow_origins=[
        "http://localhost:5173", "http://localhost:5174", "http://localhost:5175",
        "http://127.0.0.1:5173", "http://127.0.0.1:5174", "http://127.0.0.1:5175",
        "http://hsiehjun-high-perf-2.c.googlers.com:5175",
        "https://omnitactica.com", "https://omnitactica.app"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ultra-fast Uptime / Health Checks (<1ms) for Cloud Monitoring and Cloud Run Probes
@app.get("/health", summary="Fast uptime health check")
@app.get("/api/health", summary="Fast uptime health check")
async def root_health_check():
    return {"status": "ok"}

# Static Assets Mount
if (web_dir / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(web_dir / "assets")), name="assets")
if (web_dir / "css").exists():
    app.mount("/css", StaticFiles(directory=str(web_dir / "css")), name="css")
if (web_dir / "js").exists():
    app.mount("/js", StaticFiles(directory=str(web_dir / "js")), name="js")

async def _periodic_firestore_cleanup():
    """Background task to periodically clean up expired documents across rooms, connect_chats, and connect_user_sync."""
    while True:
        try:
            await asyncio.sleep(60)  # Wait 60s after startup before first run
            fs_engine = get_firestore_engine()
            res = fs_engine.cleanup_expired_documents()
            if any(v > 0 for v in res.values()):
                logger.info(f"🧹 Periodic Firestore cleanup pruned expired docs: {res}")
        except Exception as e:
            logger.warning(f"Notice during periodic Firestore cleanup: {e}")
        await asyncio.sleep(12 * 3600)  # Run every 12 hours

@app.on_event("startup")
async def on_server_startup():
    logger.info("Warhammer 40,000 Elo Backend online and ready.")
    asyncio.create_task(_periodic_firestore_cleanup())
    try:
        get_database().sync_player_latest_teams(force=False)
    except Exception as e:
        logger.warning(f"Notice during startup team sync: {e}")

    async def _prewarm_stats_cache():
        try:
            db = get_database()
            await asyncio.to_thread(db.get_summary_stats, "40k")
            logger.info("🔥 Global summary stats 40k cache pre-warmed")
        except Exception as se:
            logger.warning(f"Notice during stats cache pre-warming: {se}")

    asyncio.create_task(_prewarm_stats_cache())

    async def _prewarm_meta_intel_cache():
        try:
            now = datetime.now(timezone.utc)
            d90 = now - timedelta(days=90)
            start_str = d90.strftime("%Y-%m-%d")
            end_str = now.strftime("%Y-%m-%d")
            db = get_database()
            await asyncio.to_thread(db.get_faction_meta_stats, start_date=start_str, end_date=end_str, game_system="40k")
            await asyncio.to_thread(db.get_faction_meta_stats, start_date=start_str, end_date=end_str, game_system="aos")
            logger.info(f"🔥 Meta Intel 90-day cache pre-warmed for 40k and AoS ({start_str} to {end_str})")
            if hasattr(db, "prewarm_faction_details_cache"):
                await asyncio.to_thread(db.prewarm_faction_details_cache, "40k", "6mo", 12)
                await asyncio.to_thread(db.prewarm_faction_details_cache, "40k", "1yr", 12)
                await asyncio.to_thread(db.prewarm_faction_details_cache, "aos", "6mo", 12)
                await asyncio.to_thread(db.prewarm_faction_details_cache, "aos", "1yr", 12)
                logger.info("🔥 Meta Intel top 12 faction details cache pre-warmed for 40k and AoS (6mo & 1yr)")
        except Exception as me:
            logger.warning(f"Notice during Meta Intel cache pre-warming: {me}")

    asyncio.create_task(_prewarm_meta_intel_cache())

# Mount Modular Domain APIRouters
app.include_router(admin.router)
app.include_router(connect.router)
app.include_router(community.router)
app.include_router(armylists.router)
app.include_router(auth.router)
app.include_router(leaderboard.router)
app.include_router(tracker.router)
app.include_router(eventstudio.router)
app.include_router(armory.router)
app.include_router(leagues.router)

# =========================================================================
# NATIVE GAME TRACKER STATIC ASSET & PAGE SERVING
# =========================================================================
async def serve_tracker_asset(rel_path: str) -> Response:
    """Serves static CSS, fonts, and media images from local disk. Returns 404 if missing."""
    cache_key = rel_path.lstrip("/")

    # 1. Check local tracker static directory web/tracker/static/
    local_tracker_file = web_dir / "tracker" / "static" / cache_key
    if local_tracker_file.is_file():
        c_type = "application/javascript" if cache_key.endswith(".js") else ("text/css" if cache_key.endswith(".css") else None)
        hdrs = {
            "Cache-Control": "public, max-age=31536000, immutable" if "/_next/static/" in cache_key else "public, max-age=3600",
            "Access-Control-Allow-Origin": "*"
        }
        return FileResponse(str(local_tracker_file), media_type=c_type, headers=hdrs)

    # 2. Check general web directory
    local_web_file = web_dir / cache_key
    if local_web_file.is_file():
        return FileResponse(str(local_web_file))

    raise HTTPException(status_code=404, detail="Asset not found")

async def serve_tracker_html(path: str, request: Request) -> Response:
    """Serves local Tracker HTML page (play.html, aos.html, or lobby.html) with SSO authentication."""
    # Enforce SSO authentication on all Tracker routes
    if "tracker" in path.lower():
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        if not user:
            redirect_target = f"/{path}"
            if request.url.query:
                redirect_target += f"?{request.url.query}"
            return RedirectResponse(url=f"/login?redirect={urllib.parse.quote(redirect_target)}", status_code=303)

    is_aos = "aos" in path.lower()
    is_play_page = (
        "play" in path.lower()
        or bool(request.query_params.get("match_id"))
        or bool(request.query_params.get("room"))
        or bool(request.query_params.get("id"))
        or bool(request.query_params.get("solo"))
        or request.query_params.get("play") == "true"
    )
    if is_play_page:
        role = request.query_params.get("role")
        spectate = request.query_params.get("spectate")
        match_id = request.query_params.get("match_id") or request.query_params.get("room") or request.query_params.get("id")
        if (role == "spectator" or spectate == "true") and match_id:
            return RedirectResponse(url=f"/scorecard/{urllib.parse.quote(match_id)}", status_code=303)

    if is_aos and is_play_page:
        local_html_file = web_dir / "tracker" / "aos.html"
    elif is_play_page:
        local_html_file = web_dir / "tracker" / "play.html"
    else:
        local_html_file = web_dir / "tracker" / "lobby.html"

    if local_html_file.is_file():
        try:
            content = local_html_file.read_text(encoding="utf-8")
            return HTMLResponse(
                content=content,
                status_code=200,
                headers={
                    "Content-Type": "text/html; charset=utf-8",
                    "Cache-Control": "no-cache, must-revalidate"
                }
            )
        except Exception as e:
            logger.warning(f"Failed to read local tracker HTML {local_html_file}: {e}")

    raise HTTPException(status_code=404, detail="Tracker page not found")

def _get_request_user(request: Request, token: Optional[str] = None):
    auth_header = request.headers.get("Authorization", "")
    session_token = (
        token
        or request.cookies.get("session_token")
        or request.cookies.get("elo_auth_token")
        or request.cookies.get("native_session_token")
        or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    )
    if not session_token:
        return None
    try:
        auth_mgr = get_auth_manager()
        return auth_mgr.get_session(session_token)
    except Exception as e:
        logger.warning(f"Failed to validate session token: {e}")
        return None

# Root Landing Page
@app.get("/", include_in_schema=False)
@app.get("/index.html", include_in_schema=False)
async def serve_index(request: Request, token: Optional[str] = Query(None)):
    user = _get_request_user(request, token)
    if user and not request.query_params.get("public"):
        return RedirectResponse(url="/app", status_code=307)
    idx_file = web_dir / "index.html"
    if idx_file.exists():
        return FileResponse(
            str(idx_file),
            media_type="text/html",
            headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Pragma": "no-cache", "Expires": "0"}
        )
    raise HTTPException(status_code=404, detail="index.html not found")

@app.get("/api/version", include_in_schema=False)
@app.get("/version.json", include_in_schema=False)
async def api_version():
    v_file = web_dir / "version.json"
    version_str = "1.0.0"
    updated_at = None
    if v_file.exists():
        try:
            v_data = json.loads(v_file.read_text(encoding="utf-8"))
            version_str = str(v_data.get("version") or version_str).strip()
            updated_at = v_data.get("updated_at")
        except Exception:
            pass
    return JSONResponse(
        content={
            "version": version_str,
            "updated_at": updated_at,
            "status": "ok"
        },
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache"
        }
    )

# Authenticated Application Shell
@app.get("/app", include_in_schema=False)
@app.get("/app.html", include_in_schema=False)
@app.get("/aos", include_in_schema=False)
@app.get("/aos/", include_in_schema=False)
@app.get("/aos/app", include_in_schema=False)
@app.get("/40k", include_in_schema=False)
@app.get("/40k/", include_in_schema=False)
@app.get("/40k/app", include_in_schema=False)
async def serve_app(request: Request, token: Optional[str] = Query(None)):
    user = _get_request_user(request, token)
    if not user:
        target_path = request.url.path or "/app"
        return RedirectResponse(url=f"/login?redirect={urllib.parse.quote(target_path)}", status_code=307)
    app_file = web_dir / "app.html"
    if app_file.exists():
        return FileResponse(
            str(app_file),
            media_type="text/html",
            headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Pragma": "no-cache", "Expires": "0"}
        )
    raise HTTPException(status_code=404, detail="app.html not found")

@app.get("/tracker/tracker_sync.js", include_in_schema=False)
@app.get("/11th/tracker/tracker_sync.js", include_in_schema=False)
async def serve_tracker_sync_js():
    return FileResponse(str(web_dir / "tracker" / "tracker_sync.js"), media_type="application/javascript", headers={"Cache-Control": "no-cache, must-revalidate"})

@app.get("/tracker/tracker_sync_aos.js", include_in_schema=False)
@app.get("/11th/tracker/tracker_sync_aos.js", include_in_schema=False)
async def serve_tracker_sync_aos_js():
    return FileResponse(str(web_dir / "tracker" / "tracker_sync_aos.js"), media_type="application/javascript", headers={"Cache-Control": "no-cache, must-revalidate"})

@app.get("/tracker/tracker_sync.css", include_in_schema=False)
@app.get("/11th/tracker/tracker_sync.css", include_in_schema=False)
async def serve_tracker_sync_css():
    return FileResponse(str(web_dir / "tracker" / "tracker_sync.css"), media_type="text/css", headers={"Cache-Control": "no-cache, must-revalidate"})

@app.get("/tracker/bundle.js", include_in_schema=False)
@app.get("/11th/tracker/bundle.js", include_in_schema=False)
async def serve_tracker_bundle_js():
    bundle_file = web_dir / "tracker" / "bundle.js"
    if bundle_file.exists():
        return FileResponse(str(bundle_file), media_type="application/javascript", headers={"Cache-Control": "no-cache, must-revalidate"})
    raise HTTPException(status_code=404, detail="Tracker bundle not found")

@app.get("/tracker/bundle_aos.js", include_in_schema=False)
@app.get("/11th/tracker/bundle_aos.js", include_in_schema=False)
@app.get("/bundle_aos.js", include_in_schema=False)
async def serve_tracker_bundle_aos_js():
    bundle_file = web_dir / "tracker" / "bundle_aos.js"
    if bundle_file.exists():
        return FileResponse(str(bundle_file), media_type="application/javascript", headers={"Cache-Control": "no-cache, must-revalidate"})
    raise HTTPException(status_code=404, detail="AoS bundle not found")

@app.get("/tracker/bundle_40k.js", include_in_schema=False)
@app.get("/11th/tracker/bundle_40k.js", include_in_schema=False)
async def serve_tracker_bundle_40k_js():
    bundle_file = web_dir / "tracker" / "bundle_40k.js"
    if bundle_file.exists():
        return FileResponse(str(bundle_file), media_type="application/javascript", headers={"Cache-Control": "no-cache, must-revalidate"})
    bundle_fallback = web_dir / "tracker" / "bundle.js"
    if bundle_fallback.exists():
        return FileResponse(str(bundle_fallback), media_type="application/javascript", headers={"Cache-Control": "no-cache, must-revalidate"})
    raise HTTPException(status_code=404, detail="40k bundle not found")

@app.get("/tracker/aos", include_in_schema=False)
@app.get("/aos/tracker", include_in_schema=False)
async def serve_tracker_aos_alias(request: Request):
    query = f"?{request.url.query}" if request.url.query else ""
    return RedirectResponse(url=f"/11th/tracker/aos{query}", status_code=303)

@app.get("/login", include_in_schema=False)
@app.get("/tracker/login", include_in_schema=False)
async def serve_login(redirect: Optional[str] = Query(None)):
    login_file = web_dir / "tracker" / "login.html"
    if login_file.exists():
        return FileResponse(
            str(login_file),
            media_type="text/html",
            headers={"Cache-Control": "no-cache, must-revalidate"}
        )
    raise HTTPException(status_code=404, detail="login.html not found")

@app.get("/connect", include_in_schema=False)
@app.get("/sparring", include_in_schema=False)
async def serve_connect_page():
    return RedirectResponse(url="/app#community", status_code=303)

@app.get("/my-hub", include_in_schema=False)
@app.get("/hub", include_in_schema=False)
async def serve_my_hub(request: Request, token: Optional[str] = Query(None)):
    user = _get_request_user(request, token)
    if not user:
        return RedirectResponse(url="/login?redirect=/app#my-hub", status_code=303)
    return RedirectResponse(url="/app#my-hub", status_code=303)

@app.get("/tracker", include_in_schema=False)
@app.get("/tracker/", include_in_schema=False)
async def serve_tracker_alias(request: Request, token: Optional[str] = Query(None)):
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None

    qp = dict(request.query_params)
    event_id = qp.get("eventId") or qp.get("event_id")
    table_num = qp.get("table") or qp.get("table_num")
    round_num = qp.get("round") or qp.get("round_num") or 1
    match_id = qp.get("match_id") or qp.get("room") or qp.get("id")
    role = qp.get("role")

    if not match_id and event_id and table_num:
        match_id = f"BCP-{event_id}-R{round_num}-T{table_num}".upper()
        if not role:
            role = "spectator"
        if role == "spectator":
            target = f"/scorecard/{urllib.parse.quote_plus(match_id)}"
        else:
            target = f"/11th/tracker/play?match_id={urllib.parse.quote_plus(match_id)}&role={urllib.parse.quote_plus(role)}"
        if qp.get("pairing_id") and role != "spectator":
            target += f"&pairing_id={urllib.parse.quote_plus(qp['pairing_id'])}"
    elif match_id and (role == "spectator" or qp.get("spectate") == "true"):
        target = f"/scorecard/{urllib.parse.quote_plus(match_id)}"
    elif match_id or "play" in qp:
        query_str = f"?{request.url.query}" if request.url.query else ""
        target = f"/11th/tracker/play{query_str}"
    else:
        query_str = f"?{request.url.query}" if request.url.query else ""
        target = f"/11th/tracker{query_str}"

    if not user:
        return RedirectResponse(url=f"/login?redirect={urllib.parse.quote_plus(target)}", status_code=303)
    return RedirectResponse(url=target, status_code=303)

@app.get("/tracker/play", include_in_schema=False)
async def serve_tracker_play_alias(request: Request):
    qp = dict(request.query_params)
    role = qp.get("role")
    spectate = qp.get("spectate")
    match_id = qp.get("match_id") or qp.get("room") or qp.get("id")
    if (role == "spectator" or spectate == "true") and match_id:
        return RedirectResponse(url=f"/scorecard/{urllib.parse.quote(match_id)}", status_code=303)
    query = f"?{request.url.query}" if request.url.query else ""
    return RedirectResponse(url=f"/11th/tracker/play{query}", status_code=303)

# Native Next.js Static Asset & Image Optimization Serving
@app.get("/_next/image", include_in_schema=False)
async def serve_next_image_optimizer(request: Request):
    raw_url = request.query_params.get("url")
    if not raw_url:
        raise HTTPException(status_code=400, detail="Missing url parameter")
    clean_path = raw_url.lstrip("/")
    return await serve_tracker_asset(clean_path)

@app.get("/_next/{path:path}", include_in_schema=False)
async def serve_next_assets(path: str, request: Request):
    return await serve_tracker_asset(f"_next/{path}")

# Native Tracker Terrain, Cards, Layouts, and Media Assets
@app.get("/terrain/{path:path}", include_in_schema=False)
@app.get("/cards/{path:path}", include_in_schema=False)
@app.get("/images/{path:path}", include_in_schema=False)
@app.get("/icons/{path:path}", include_in_schema=False)
@app.get("/assets/{path:path}", include_in_schema=False)
@app.get("/factions/{path:path}", include_in_schema=False)
async def serve_tracker_media_assets(request: Request):
    rel_path = request.url.path.lstrip("/")
    return await serve_tracker_asset(rel_path)

# Native Tracker HTML Pages
@app.get("/11th/{path:path}", include_in_schema=False)
async def serve_11th_pages(path: str, request: Request):
    return await serve_tracker_html(f"11th/{path}", request)

@app.get("/11th", include_in_schema=False)
async def serve_11th_root(request: Request):
    return await serve_tracker_html("11th", request)

@app.get("/manifest.json", include_in_schema=False)
@app.get("/manifest.webmanifest", include_in_schema=False)
async def serve_pwa_manifest():
    manifest_file = web_dir / "manifest.json"
    manifest_headers = {
        "Content-Type": "application/manifest+json",
        "Cache-Control": "no-cache, no-store, must-revalidate"
    }
    if manifest_file.exists():
        return FileResponse(str(manifest_file), media_type="application/manifest+json", headers=manifest_headers)
    return JSONResponse(
        headers=manifest_headers,
        content={
            "name": "OmniTactica - 40K Tactical Suite",
            "short_name": "OmniTactica",
            "description": "OmniTactica Warhammer 40,000 Elo Rankings, Tournament Companion & Live Game Tracker",
            "id": "/",
            "start_url": "/",
            "scope": "/",
            "display": "standalone",
            "orientation": "any",
            "background_color": "#070b14",
            "theme_color": "#070b14",
            "icons": [
                {
                    "src": "/assets/icon-192.png",
                    "sizes": "192x192",
                    "type": "image/png",
                    "purpose": "any"
                },
                {
                    "src": "/assets/icon-512.png",
                    "sizes": "512x512",
                    "type": "image/png",
                    "purpose": "any"
                },
                {
                    "src": "/assets/icon-maskable-192.png",
                    "sizes": "192x192",
                    "type": "image/png",
                    "purpose": "maskable"
                },
                {
                    "src": "/assets/icon-maskable-512.png",
                    "sizes": "512x512",
                    "type": "image/png",
                    "purpose": "maskable"
                }
            ]
        }
    )

@app.get("/assets/{file:path}", include_in_schema=False)
async def serve_custom_assets(file: str):
    target = web_dir / "assets" / file
    if target.exists() and target.is_file():
        return FileResponse(str(target))
    raise HTTPException(status_code=404, detail="Asset not found")

@app.get("/logo-mark.svg", include_in_schema=False)
async def serve_logo_svg():
    svg = web_dir / "assets" / "logo.svg"
    if svg.exists():
        return FileResponse(str(svg), media_type="image/svg+xml")
    raise HTTPException(status_code=404, detail="logo.svg not found")

@app.get("/logo192w.png", include_in_schema=False)
async def serve_logo_192():
    png = web_dir / "assets" / "logo-192.png"
    if png.exists():
        return FileResponse(str(png), media_type="image/png")
    raise HTTPException(status_code=404, detail="logo-192.png not found")

@app.get("/logo512w.png", include_in_schema=False)
async def serve_logo_512():
    png = web_dir / "assets" / "logo-512.png"
    if png.exists():
        return FileResponse(str(png), media_type="image/png")
    raise HTTPException(status_code=404, detail="logo-512.png not found")

@app.get("/favicon.ico", include_in_schema=False)
async def serve_favicon():
    ico = web_dir / "favicon.ico"
    if ico.exists():
        return FileResponse(str(ico))
    svg = web_dir / "assets" / "logo.svg"
    if svg.exists():
        return FileResponse(str(svg), media_type="image/svg+xml")
    raise HTTPException(status_code=404, detail="favicon not found")

@app.get("/eventstudio", include_in_schema=False)
@app.get("/eventstudio.html", include_in_schema=False)
async def serve_eventstudio(request: Request, token: Optional[str] = Query(None)):
    user = _get_request_user(request, token)
    if not user:
        return RedirectResponse(url="/login?redirect=/eventstudio", status_code=303)
    es_file = web_dir / "eventstudio.html"
    if es_file.exists():
        return FileResponse(str(es_file), media_type="text/html")
    raise HTTPException(status_code=404, detail="eventstudio.html not found")

NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}

@app.get("/admin/feedback", include_in_schema=False)
@app.get("/admin/feedback.html", include_in_schema=False)
async def serve_admin_feedback(request: Request, token: Optional[str] = Query(None)):
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = token or request.cookies.get("session_token") or request.cookies.get("elo_auth_token") or request.cookies.get("native_session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    user_email = ((user.get("email") or "") if user else "").strip().lower()
    user_role = ((user.get("role") or "") if user else "").strip().lower()
    superadmin_email = os.environ.get("SUPERADMIN_EMAIL", "swimgeek751@gmail.com").strip().lower()
    is_admin = bool(user) and (user.get("is_admin") is True or user_role in ("admin", "superuser", "developer", "owner") or (bool(superadmin_email) and user_email == superadmin_email))
    if not is_admin:
        return RedirectResponse(url="/", status_code=303, headers=NO_CACHE_HEADERS)
    af_file = web_dir / "admin_feedback.html"
    if af_file.exists():
        return FileResponse(str(af_file), media_type="text/html", headers=NO_CACHE_HEADERS)
    raise HTTPException(status_code=404, detail="admin_feedback.html not found")

@app.get("/admin", include_in_schema=False)
@app.get("/admin.html", include_in_schema=False)
async def serve_admin_dashboard(request: Request, token: Optional[str] = Query(None)):
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = token or request.cookies.get("session_token") or request.cookies.get("elo_auth_token") or request.cookies.get("native_session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    user_email = ((user.get("email") or "") if user else "").strip().lower()
    user_role = ((user.get("role") or "") if user else "").strip().lower()
    superadmin_email = os.environ.get("SUPERADMIN_EMAIL", "swimgeek751@gmail.com").strip().lower()
    is_admin = bool(user) and (user.get("is_admin") is True or user_role in ("admin", "superuser", "developer", "owner") or (bool(superadmin_email) and user_email == superadmin_email))
    if not is_admin:
        return RedirectResponse(url="/", status_code=303, headers=NO_CACHE_HEADERS)
    adm_file = web_dir / "admin.html"
    if adm_file.exists():
        return FileResponse(str(adm_file), media_type="text/html", headers=NO_CACHE_HEADERS)
    raise HTTPException(status_code=404, detail="admin.html not found")



# Global Structured Error Handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback
    tb = traceback.format_exc()
    logger.error(f"Unhandled error on {request.method} {request.url.path}: {exc}\n{tb}")
    return JSONResponse(
        status_code=500,
        content={
            "status": "error",
            "detail": str(exc),
            "error_type": type(exc).__name__,
            "path": str(request.url.path)
        }
    )



def start_server(port: int = 8080, host: str = "0.0.0.0"):
    """Starts the production Uvicorn ASGI server or fallback HTTP server."""
    if FASTAPI_AVAILABLE and uvicorn is not None:
        uvicorn.run(
            "server:app",
            host=host,
            port=port,
            reload=False,
            workers=1,
            access_log=True
        )
    else:
        import http.server
        import socketserver

        class OmniRequestHandler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=str(web_dir), **kwargs)

            def end_headers(self):
                if self.path.startswith("/css") or self.path.startswith("/js"):
                    self.send_header("Cache-Control", "no-cache, must-revalidate")
                    self.send_header("Pragma", "no-cache")
                elif self.path.startswith("/api/version") or self.path.endswith(".html") or self.path in ("/", "/app", "/login"):
                    self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
                    self.send_header("Pragma", "no-cache")
                super().end_headers()

            def do_GET(self):
                clean_path = self.path.split("?")[0]
                if clean_path in ("/", "/index", "/index.html"):
                    self.path = "/index.html"
                elif clean_path in ("/app", "/app.html"):
                    self.path = "/app.html"
                elif clean_path in ("/login", "/login.html"):
                    self.path = "/login.html"
                elif clean_path == "/api/version":
                    v_file = web_dir / "version.json"
                    v_data = b'{"version":"1.0.0","status":"ok"}'
                    if v_file.exists():
                        try:
                            v_data = v_file.read_bytes()
                        except Exception:
                            pass
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(v_data)))
                    self.end_headers()
                    self.wfile.write(v_data)
                    return
                super().do_GET()

        socketserver.TCPServer.allow_reuse_address = True
        with socketserver.TCPServer((host, port), OmniRequestHandler) as httpd:
            print(f"🚀 OmniTactica HTTP server listening on http://{host}:{port}")
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                print("\nShutting down server...")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="OmniTactica Web API Server")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8080)), help="Port to listen on")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host interface to bind to")
    args = parser.parse_args()
    start_server(port=args.port, host=args.host)
