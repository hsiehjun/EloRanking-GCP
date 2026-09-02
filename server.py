"""Modern FastAPI Server and Async REST API for Warhammer 40k Elo Ranking UI."""

import logging
import os
import math
import json
import secrets
import asyncio
import re
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
try:
    from pydantic import BaseModel
except ImportError:
    class BaseModel:
        pass

try:
    from psycopg2 import extras
except ImportError:
    extras = None


try:
    from fastapi import FastAPI, HTTPException, Query, Request, Response, BackgroundTasks
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse, HTMLResponse, StreamingResponse
    from fastapi.staticfiles import StaticFiles
    import uvicorn
    FASTAPI_AVAILABLE = True
except ImportError:
    class BackgroundTasks:
        def add_task(self, *args, **kwargs):
            pass
    FASTAPI_AVAILABLE = False
    app = None

try:
    from google3.experimental.users.hsiehjun.EloRanking.config import (
        DEFAULT_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR,
        MIN_MATCHES_FOR_RANKING, get_package_dir, DATABASE_URL,
        BCP_API_BASE, DEFAULT_HEADERS, BCP_CLIENT_ID, BCP_USER_AGENT
    )
    from google3.experimental.users.hsiehjun.EloRanking.database import Database, get_db
    from google3.experimental.users.hsiehjun.EloRanking.scraper import BestCoastPairingsScraper
    from google3.experimental.users.hsiehjun.EloRanking.elo import EloEngine
except ImportError:
    try:
        from experimental.users.hsiehjun.EloRanking.config import (
            DEFAULT_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR,
            MIN_MATCHES_FOR_RANKING, get_package_dir, DATABASE_URL,
            BCP_API_BASE, DEFAULT_HEADERS, BCP_CLIENT_ID, BCP_USER_AGENT
        )
        from experimental.users.hsiehjun.EloRanking.database import Database, get_db
        from experimental.users.hsiehjun.EloRanking.scraper import BestCoastPairingsScraper
        from experimental.users.hsiehjun.EloRanking.elo import EloEngine
    except ImportError:
        from config import (
            DEFAULT_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR,
            MIN_MATCHES_FOR_RANKING, get_package_dir, DATABASE_URL,
            BCP_API_BASE, DEFAULT_HEADERS, BCP_CLIENT_ID, BCP_USER_AGENT
        )
        from database import Database, get_db
        from scraper import BestCoastPairingsScraper
        from elo import EloEngine
        from auth import get_auth_manager, _decode_jwt_payload
        from army_list_parser import get_parser as get_army_parser
        from firestore_db import get_firestore_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("EloAPI")

# Initialize Database & EloEngine Singletons
_db_instance = None
_engine_instance = None
_LAST_UPCOMING_SYNC_TIME = 0

def get_database():
    global _db_instance
    if _db_instance is None:
        _db_instance = get_db()
    return _db_instance

def get_elo_engine():
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = EloEngine(db=get_database())
    return _engine_instance


if FASTAPI_AVAILABLE:
    app = FastAPI(
        title="OmniTactica - Warhammer 40k Suite API",
        version="2.1.0",
        description="High-performance async API for OmniTactica: Warhammer 40,000 Elo rankings, live match tracker, and BCP tournament suite.",
        docs_url="/docs",
        redoc_url="/redoc"
    )

    # HTTP Caching & Edge Optimization Middleware
    @app.middleware("http")
    async def add_cache_headers(request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/api/auth") or path.startswith("/api/user"):
            # Never cache authentication, session, or user endpoints
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
        elif path.startswith("/css") or path.startswith("/js"):
            response.headers["Cache-Control"] = "public, max-age=86400, stale-while-revalidate=604800"
        elif path.startswith("/api/"):
            response.headers["Cache-Control"] = "public, max-age=15, stale-while-revalidate=60"
        return response



    # CORS Middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Base Package & Web Directory resolution
    package_dir = get_package_dir()
    web_dir = package_dir / "web"
    if not web_dir.exists():
        web_dir = Path(__file__).resolve().parent / "web"

    # Static Assets Mount
    if (web_dir / "assets").exists():
        app.mount("/assets", StaticFiles(directory=str(web_dir / "assets")), name="assets")
    if (web_dir / "css").exists():
        app.mount("/css", StaticFiles(directory=str(web_dir / "css")), name="css")
    if (web_dir / "js").exists():
        app.mount("/js", StaticFiles(directory=str(web_dir / "js")), name="js")

    @app.on_event("startup")
    async def on_server_startup():
        logger.info("Warhammer 40,000 Elo Backend online and ready.")


    # =========================================================================
    # EVENT STUDIO & BCP LIVE MATCH SYNC APIS
    # =========================================================================

    class SubmitScorePayload(BaseModel):
        event_id: str
        table: int
        round_num: int
        p1_score: int
        p2_score: int
        p1_name: Optional[str] = None
        p2_name: Optional[str] = None
        winner_id: Optional[str] = None
        source_app: Optional[str] = "Manual"
        game_details: Optional[Dict[str, Any]] = None
    class SubmitScorePayload(BaseModel):
        event_id: str
        table: int
        round_num: int
        p1_score: int
        p2_score: int
        p1_name: Optional[str] = "Player 1"
        p2_name: Optional[str] = "Player 2"
        source_app: Optional[str] = "EventStudio"
        game_details: Optional[Dict[str, Any]] = None
        bcp_token: Optional[str] = None

    class CreateEventPayload(BaseModel):
        name: str
        tier: Optional[str] = "Grand Tournament"
        rounds: Optional[int] = 5
        start_date: Optional[str] = None
        end_date: Optional[str] = None
        city: Optional[str] = ""
        state: Optional[str] = ""
        country: Optional[str] = "United States"
        lat: Optional[float] = None
        lng: Optional[float] = None
        location_verified: Optional[bool] = False
        venue: Optional[str] = ""
        points: Optional[int] = 2000
        capacity: Optional[int] = 32
        mission_pack: Optional[str] = "11th Edition Core"
        game_system_id: Optional[str] = None
        pairing_style: Optional[str] = "swiss"
        default_round_length: Optional[int] = 9000
        hide_lists: Optional[bool] = False
        hide_roster: Optional[bool] = False
        hide_placings: Optional[bool] = False
        require_lists: Optional[bool] = False
        passwordless_scoring: Optional[bool] = True
        ticket_price: Optional[int] = 0
        using_online_reg: Optional[bool] = False
        time_zone: Optional[str] = "America/Los_Angeles"
        bcp_token: Optional[str] = None
        event_type: Optional[str] = "Singles Event"  # "Singles Event", "Doubles Event", "Teams Event"
        team_size: Optional[int] = 1
        circuit_id: Optional[str] = None
        circuit_token: Optional[str] = None
        circuit_name: Optional[str] = None

    def execute_bcp_api_call(
        url: str,
        method: str = "GET",
        json_data: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None,
        explicit_token: Optional[str] = None
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """
        Direct caller for Best Coast Pairings API with:
        1. AccessToken with 'Bearer ' header
        2. Automatic token refresh fallback on 401
        """
        import urllib.request, urllib.error, json
        auth_mgr = get_auth_manager()

        tok = explicit_token
        # If explicit token is missing or not a 3-part JWT, pull valid BCP tokens from DB
        if (not tok or len(str(tok).strip().split(".")) != 3) and user_id:
            tok_dict = auth_mgr.get_valid_bcp_tokens(user_id)
            tok = tok_dict.get("access_token") or tok_dict.get("id_token")

        if not tok and user_id:
            tok_dict = auth_mgr.get_valid_bcp_tokens(user_id)
            tok = tok_dict.get("access_token") or tok_dict.get("id_token")

        if not tok:
            logger.warning(f"⚠️ [BCP API] No BCP token available for {method} {url}")
            return None, "No BCP authorization token available"

        def _do_request(token_val: str) -> Tuple[Optional[Dict[str, Any]], Optional[int], Optional[str]]:
            clean_tok = token_val.replace("Bearer ", "").replace("bearer ", "").strip()
            headers = DEFAULT_HEADERS.copy()
            headers["Authorization"] = f"Bearer {clean_tok}"
            headers["Content-Type"] = "application/json"

            if json_data is not None:
                body_bytes = json.dumps(json_data).encode("utf-8")
            elif method in ("POST", "PUT", "PATCH", "DELETE"):
                body_bytes = b"{}"
            else:
                body_bytes = None

            req = urllib.request.Request(url, data=body_bytes, headers=headers, method=method)

            try:
                with urllib.request.urlopen(req, timeout=12) as resp:
                    raw = resp.read().decode("utf-8")
                    data = json.loads(raw) if raw else {}
                    logger.info(f"✅ [BCP API SUCCESS {resp.status}] {method} {url}")
                    return data, resp.status, None
            except urllib.error.HTTPError as he:
                err_body = he.read().decode("utf-8", errors="ignore")
                return None, he.code, f"HTTP {he.code}: {err_body}"
            except Exception as e:
                logger.warning(f"⚠️ [BCP API Network Error] {method} {url}: {e}")
                return None, 0, str(e)

        # 1. Primary Request
        data, status, err = _do_request(tok)
        if data is not None:
            return data, None

        # 2. If 401 or 403, retry with alternate token (id_token vs access_token) or refresh
        if status in (401, 403) and user_id:
            logger.info(f"🔄 [BCP API] Status {status} on {method} {url}. Attempting token retry / refresh...")
            tok_dict = auth_mgr.get_valid_bcp_tokens(user_id)
            alt_tok = tok_dict.get("id_token") if tok == tok_dict.get("access_token") else tok_dict.get("access_token")
            if alt_tok and alt_tok != tok:
                data, status, err = _do_request(alt_tok)
                if data is not None:
                    return data, None

            fresh_dict = auth_mgr.get_valid_bcp_tokens(user_id, force_refresh=True)
            for cand_tok in [fresh_dict.get("access_token"), fresh_dict.get("id_token")]:
                if cand_tok and cand_tok != tok and cand_tok != alt_tok:
                    data, status, err = _do_request(cand_tok)
                    if data is not None:
                        return data, None

        if err:
            logger.warning(f"⚠️ [BCP API Failed] {method} {url}: {err}")
        return None, err

    @app.get("/api/eventstudio/events", summary="List organizer tournaments")
    async def api_eventstudio_list_events(request: Request, bcp_token: Optional[str] = Query(None)):
        db = get_database()
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None
        bcp_user_id = user.get("bcp_user_id") if user else None
        player_id = user.get("player_id") if user else None

        if not user_id and not bcp_user_id and not player_id:
            return {"success": True, "count": 0, "events": []}

        # Check BCP for any tournaments hosted by this organizer
        if user_id or bcp_token:
            try:
                start_range = "2025-09-01T07:00:00.000Z"
                end_range = "2027-09-02T06:59:59.999Z"
                sync_url = f"https://newprod-api.bestcoastpairings.com/v2/events?limit=50&eventSearchType=organizer&sortKey=eventDate&sortAscending=false&startDate={start_range}&endDate={end_range}"
                bcp_raw, err = execute_bcp_api_call(sync_url, method="GET", user_id=user_id, explicit_token=bcp_token)

                bcp_event_ids = set()
                bcp_sync_succeeded = False

                if bcp_raw:
                    bcp_sync_succeeded = True
                    items = bcp_raw.get("data", bcp_raw.get("events", [])) if isinstance(bcp_raw, dict) else bcp_raw
                    for item in (items if isinstance(items, list) else []):
                        if not isinstance(item, dict): continue
                        bcp_id = str(item.get("id") or item.get("_id"))
                        if db.is_event_deleted(bcp_id):
                            continue
                        bcp_event_ids.add(bcp_id)
                        loc = item.get("location") if isinstance(item.get("location"), dict) else {}
                        
                        # Preserve existing local fields/roster/pairings if present
                        existing = db.get_studio_event(bcp_id) or {}
                        merged = {
                            **existing,
                            "id": bcp_id,
                            "name": existing.get("name") or item.get("name", "BCP Tournament"),
                            "tier": existing.get("tier") or item.get("eventType") or item.get("tier") or "Grand Tournament",
                            "event_date": existing.get("event_date") or item.get("eventDate") or item.get("startDate"),
                            "end_date": existing.get("end_date") or item.get("endDate") or item.get("eventEndDate"),
                            "city": existing.get("city") or item.get("city") or loc.get("city"),
                            "state": existing.get("state") or item.get("state") or loc.get("state"),
                            "country": existing.get("country") or item.get("country") or loc.get("country"),
                            "venue": existing.get("venue") or item.get("venueName") or loc.get("venueName") or loc.get("name"),
                            "num_rounds": existing.get("num_rounds") or item.get("numberOfRounds") or item.get("numRounds") or 5,
                            "points": existing.get("points") or item.get("points") or 2000,
                            "capacity": existing.get("capacity") or item.get("totalPlayers") or item.get("capacity") or 32,
                            "organizer_id": user_id,
                            "organizer_bcp_id": item.get("ownerId") or item.get("owner_Id") or bcp_user_id or player_id,
                            "bcp_synced": True,
                            "bcp_status": "synced"
                        }
                        db.save_studio_event(merged)

                    # If BCP sync succeeded, inspect existing tournaments in OmniTactica:
                    # If an event has a BCP ID but is no longer present in the organizer's active BCP events,
                    # mark it as deleted on BCP (preserving it locally in OmniTactica)
                    if bcp_sync_succeeded:
                        existing_events = db.get_studio_events(organizer_id=user_id, organizer_bcp_id=bcp_user_id, player_id=player_id)
                        for ev in existing_events:
                            ev_id = ev.get("id", "")
                            if not ev_id.startswith("ES-") and ev_id not in bcp_event_ids:
                                db.delete_studio_event(ev_id, organizer_id=user_id)
            except Exception as se:
                logger.info(f"Notice syncing BCP organizer events: {se}")

        # Fetch tournaments created by or explicitly linked to this user/TO
        events = db.get_studio_events(organizer_id=user_id, organizer_bcp_id=bcp_user_id, player_id=player_id)

        return {
            "success": True,
            "count": len(events),
            "events": events
        }

    @app.get("/api/eventstudio/event/{event_id}", summary="Get tournament details, roster, and round pairings")
    async def api_eventstudio_get_event(event_id: str, request: Request):
        db = get_database()
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None

        ev = db.get_studio_event(event_id)
        if not ev:
            # Try direct BCP lookup and auto-link
            try:
                import urllib.request, json
                bcp_url = f"{BCP_API_BASE}/events/{event_id}"
                req = urllib.request.Request(bcp_url, headers=DEFAULT_HEADERS)
                with urllib.request.urlopen(req, timeout=10) as resp:
                    if resp.status == 200:
                        item = json.loads(resp.read().decode("utf-8"))
                        if isinstance(item, dict) and item.get("name"):
                            loc = item.get("location") if isinstance(item.get("location"), dict) else {}
                            saved = db.save_studio_event({
                                "id": str(item.get("id") or item.get("_id") or event_id),
                                "name": item.get("name", "BCP Tournament"),
                                "tier": item.get("eventType") or item.get("tier") or "Grand Tournament",
                                "event_date": item.get("eventDate") or item.get("startDate"),
                                "end_date": item.get("endDate") or item.get("eventEndDate"),
                                "city": item.get("city") or loc.get("city"),
                                "state": item.get("state") or loc.get("state"),
                                "country": item.get("country") or loc.get("country"),
                                "venue": item.get("venueName") or loc.get("venueName") or loc.get("name"),
                                "num_rounds": item.get("numberOfRounds") or item.get("numRounds") or 5,
                                "points": item.get("points") or 2000,
                                "capacity": item.get("totalPlayers") or item.get("capacity") or 32,
                                "organizer_id": user["id"] if user else None,
                                "organizer_bcp_id": item.get("ownerId") or item.get("owner_Id") or (user.get("bcp_user_id") if user else None),
                                "bcp_synced": True,
                                "bcp_status": "synced"
                            })
                            return {"success": True, "event": saved}
            except Exception as fe:
                logger.info(f"Direct BCP event fetch notice for {event_id}: {fe}")

            # Fallback to standard event lookup
            full_ev = db.get_tournament_details(event_id)
            if full_ev:
                return {"success": True, "event": full_ev}
            raise HTTPException(status_code=404, detail=f"Tournament '{event_id}' not found")

        # If it's a BCP event, check if it's still alive on BCP
        if not event_id.startswith("ES-") and ev.get("bcp_status") != "deleted_on_bcp":
            try:
                import urllib.request
                bcp_check_url = f"{BCP_API_BASE}/events/{event_id}"
                req = urllib.request.Request(bcp_check_url, headers=DEFAULT_HEADERS)
                try:
                    with urllib.request.urlopen(req, timeout=5) as check_resp:
                        if check_resp.status == 200:
                            if not ev.get("bcp_synced"):
                                ev["bcp_synced"] = True
                                ev["bcp_status"] = "synced"
                                db.save_studio_event(ev)
                except urllib.error.HTTPError as che:
                    if che.code in (404, 400, 410):
                        ev["bcp_status"] = "deleted_on_bcp"
                        ev["bcp_synced"] = False
                        db.save_studio_event(ev)
            except Exception:
                pass

        return {
            "success": True,
            "event": ev
        }

    @app.post("/api/eventstudio/event/create", summary="Create new tournament and register to BCP")
    async def api_eventstudio_create_event(payload: CreateEventPayload, request: Request):
        db = get_database()
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None
        bcp_user_id = user.get("bcp_user_id") if user else None
        bcp_token = payload.bcp_token or (auth_mgr.get_valid_bcp_token(user_id) if user_id else None)

        event_id = f"ES-{secrets.token_hex(4).upper()}"
        bcp_created = False
        bcp_error = None

        # Attempt to register on Best Coast Pairings API if token provided
        if user_id or payload.bcp_token:
            try:
                bcp_url = f"{BCP_API_BASE}/events"
                
                tok_check = payload.bcp_token or (auth_mgr.get_valid_bcp_token(user_id) if user_id else None)
                claims = _decode_jwt_payload(tok_check) if tok_check else {}
                if not bcp_user_id:
                    bcp_user_id = claims.get("sub") or claims.get("userId") or claims.get("custom:userId") or claims.get("username")

                # Format ISO timestamps for BCP
                s_date = payload.start_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
                e_date = payload.end_date or s_date
                event_date_iso = f"{s_date}T09:00:00.000Z" if len(s_date) == 10 else s_date
                end_date_iso = f"{e_date}T18:00:00.000Z" if len(e_date) == 10 else e_date
                
                tok_dict = auth_mgr.get_valid_bcp_tokens(user_id) if user_id else {}
                id_tok = tok_dict.get("id_token") or payload.bcp_token
                acc_tok = tok_dict.get("access_token") or payload.bcp_token or id_tok
                
                id_claims = _decode_jwt_payload(id_tok) if id_tok else {}
                acc_claims = _decode_jwt_payload(acc_tok) if acc_tok else {}

                # In BCP, ownerId must be the BCP userId attribute from the ID token or BCP profile
                bcp_owner_id = (
                    id_claims.get("userId")
                    or id_claims.get("custom:userId")
                    or acc_claims.get("userId")
                    or acc_claims.get("custom:userId")
                )

                sub_uuid = id_claims.get("sub") or acc_claims.get("sub") or (user.get("bcp_user_id") if user else None)

                # If no direct userId in claims, fetch BCP user profile
                if not bcp_owner_id and sub_uuid:
                    try:
                        u_url = f"https://newprod-api.bestcoastpairings.com/v1/users/{sub_uuid}"
                        u_req = urllib.request.Request(
                            u_url,
                            headers={
                                "Authorization": f"Bearer {acc_tok or id_tok}",
                                "client-id": "web-app",
                                "User-Agent": "Mozilla/5.0"
                            }
                        )
                        with urllib.request.urlopen(u_req, timeout=5) as u_resp:
                            if u_resp.status == 200:
                                u_data = json.loads(u_resp.read().decode("utf-8"))
                                if isinstance(u_data, dict) and u_data.get("id"):
                                    bcp_owner_id = str(u_data["id"])
                    except Exception as ue:
                        logger.debug(f"Fetch BCP user profile notice: {ue}")

                if not bcp_owner_id:
                    bcp_owner_id = sub_uuid

                city_str = payload.city or "San Diego"
                state_str = payload.state or "CA"
                venue_str = payload.venue or f"{city_str} Venue"
                country_str = payload.country or "United States"

                game_sys = payload.game_system_id or DEFAULT_GAME_SYSTEM_ID
                tz_str = payload.time_zone or "America/Los_Angeles"
                round_len = int(payload.default_round_length or 9000)

                is_doubles = payload.event_type == "Doubles Event"
                is_teams = payload.event_type == "Teams Event" or is_doubles
                team_sz = int(payload.team_size or (2 if is_doubles else (5 if is_teams else 1)))

                bcp_payload = {
                    "name": payload.name,
                    "ownerId": bcp_owner_id,
                    "gameSystemId": game_sys,
                    "gameType": "teams" if is_teams else "singles",
                    "doublesEvent": is_doubles,
                    "teamEvent": is_teams,
                    "teamSize": team_sz,
                    "eventSubType": "standard",
                    "boardGameEvent": False,
                    "eventDate": event_date_iso,
                    "eventEndDate": end_date_iso,
                    "endDate": end_date_iso,
                    "pairingStyle": payload.pairing_style.lower() if payload.pairing_style else "swiss",
                    "numberOfRounds": payload.rounds or 5,
                    "points": payload.points or 2000,
                    "startingTable": 1,
                    "hidePlacings": bool(payload.hide_placings),
                    "hideRoster": bool(payload.hide_roster),
                    "hidePlayerCount": False,
                    "defaultRoundLength": round_len,
                    "enablePasswords": True,
                    "passwordlessScoring": bool(payload.passwordless_scoring if payload.passwordless_scoring is not None else True),
                    "hideLists": bool(payload.hide_lists),
                    "listOptions": {"allowsFiles": True, "allowsImages": True, "allowsText": True},
                    "location": {
                        "name": venue_str,
                        "venue": venue_str,
                        "city": city_str,
                        "state": state_str,
                        "country": country_str,
                        "timeZone": tz_str,
                        **({"coordinate": [float(payload.lng), float(payload.lat)]} if payload.lat is not None and payload.lng is not None else {})
                    },
                    "ticketPrice": int((payload.ticket_price or 0) * 100) if payload.using_online_reg else 0,
                    "usingOnlineReg": bool(payload.using_online_reg),
                    "shippingDetails": {"requested": False},
                    "eventDescription": payload.mission_pack or "Created via OmniTactica Event Studio",
                    "eventDescriptionMarkup": payload.mission_pack or "Created via OmniTactica Event Studio"
                }

                res_data, bcp_err = execute_bcp_api_call(
                    bcp_url,
                    method="POST",
                    json_data=bcp_payload,
                    user_id=user_id,
                    explicit_token=acc_tok
                )

                # If 403 Access Denied, attempt retry with alternate sub_uuid or bcp_owner_id
                if not res_data and bcp_err and ("403" in str(bcp_err) or "access denied" in str(bcp_err).lower()) and sub_uuid and bcp_owner_id != sub_uuid:
                    logger.info(f"🔄 Retrying BCP event create with alternate ownerId: {sub_uuid}")
                    bcp_payload["ownerId"] = sub_uuid
                    res_data, bcp_err = execute_bcp_api_call(
                        bcp_url,
                        method="POST",
                        json_data=bcp_payload,
                        user_id=user_id,
                        explicit_token=acc_tok
                    )

                if res_data and isinstance(res_data, dict):
                    new_id = res_data.get("id") or res_data.get("_id") or (res_data.get("data") or {}).get("id")
                    if new_id:
                        event_id = str(new_id)
                        bcp_created = True

                        # Submit to circuit if chosen
                        if payload.circuit_id:
                            try:
                                circuit_url = f"{BCP_API_BASE}/events/{event_id}/submitToLeague"
                                c_body = {"leagueId": payload.circuit_id}
                                if payload.circuit_token:
                                    c_body["tokenCode"] = payload.circuit_token
                                execute_bcp_api_call(circuit_url, method="POST", json_data=c_body, user_id=user_id)
                                logger.info(f"✅ Submitted tournament {event_id} to circuit {payload.circuit_id}")
                            except Exception as ce:
                                logger.warning(f"Notice linking circuit on create: {ce}")
                elif bcp_err:
                    bcp_error = bcp_err
            except Exception as e:
                logger.warning(f"BCP Event create notice: {e}")
                bcp_error = str(e)

        # Save to local database
        circuits_list = []
        if payload.circuit_id:
            circuits_list.append({
                "id": payload.circuit_id,
                "name": payload.circuit_name or "Tournament Circuit",
                "linked_at": datetime.now(timezone.utc).isoformat()
            })

        is_doubles_local = payload.event_type == "Doubles Event"
        is_teams_local = payload.event_type == "Teams Event" or is_doubles_local
        now_date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        start_date_str = str(payload.start_date or now_date_str)
        end_date_str = str(payload.end_date or start_date_str)

        saved = db.save_studio_event({
            "id": event_id,
            "name": payload.name,
            "tier": payload.tier,
            "event_type": "doubles" if is_doubles_local else ("teams" if is_teams_local else "singles"),
            "team_size": team_sz_local,
            "circuits": circuits_list,
            "event_date": start_date_str,
            "end_date": end_date_str,
            "city": payload.city,
            "state": payload.state,
            "country": payload.country,
            "venue": payload.venue,
            "num_rounds": payload.rounds,
            "points": payload.points,
            "capacity": payload.capacity,
            "mission_pack": payload.mission_pack,
            "organizer_id": user_id,
            "organizer_bcp_id": bcp_user_id,
            "roster": [],
            "pairings": {str(r): [] for r in range(1, (payload.rounds or 5) + 1)}
        })

        return {
            "success": True,
            "event_id": event_id,
            "bcp_registered": bcp_created,
            "bcp_error": bcp_error,
            "event": saved
        }



    @app.put("/api/eventstudio/event/{event_id}", summary="Modify tournament details and push to BCP")
    async def api_eventstudio_update_event(event_id: str, payload: Dict[str, Any], request: Request):
        db = get_database()
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None

        ev = db.get_studio_event(event_id)
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")

        # Map date fields
        if "start_date" in payload and "event_date" not in payload:
            payload["event_date"] = payload["start_date"]

        for k, v in payload.items():
            ev[k] = v

        if "raw_json" in ev and isinstance(ev["raw_json"], dict):
            for k, v in payload.items():
                ev["raw_json"][k] = v

        saved = db.save_studio_event(ev)

        # Sync update to BCP if authenticated
        bcp_updated = False
        if user_id and not event_id.startswith("ES-"):
            bcp_set_fields = {}
            if "name" in payload: bcp_set_fields["name"] = payload["name"]
            if "event_date" in payload or "start_date" in payload:
                dt_val = str(payload.get("event_date") or payload.get("start_date"))
                if len(dt_val) == 10:
                    dt_val = f"{dt_val}T09:00:00.000Z"
                bcp_set_fields["eventDate"] = dt_val
            if "end_date" in payload:
                edt_val = str(payload["end_date"])
                if len(edt_val) == 10:
                    edt_val = f"{edt_val}T18:00:00.000Z"
                bcp_set_fields["eventEndDate"] = edt_val

            venue = payload.get("venue", ev.get("venue", ""))
            city = payload.get("city", ev.get("city", ""))
            state = payload.get("state", ev.get("state", ""))
            country = payload.get("country", ev.get("country", "United States"))

            if any(k in payload for k in ["venue", "city", "state", "country"]):
                bcp_set_fields["venueName"] = venue
                bcp_set_fields["city"] = city
                bcp_set_fields["state"] = state
                bcp_set_fields["country"] = country
                bcp_set_fields["location"] = {
                    "name": venue,
                    "venueName": venue,
                    "city": city,
                    "state": state,
                    "country": country
                }
            if "points" in payload: bcp_set_fields["points"] = int(payload["points"])
            if "capacity" in payload: bcp_set_fields["totalPlayers"] = int(payload["capacity"])
            if "num_rounds" in payload or "rounds" in payload:
                bcp_set_fields["numberOfRounds"] = int(payload.get("num_rounds") or payload.get("rounds"))
            if "tier" in payload: bcp_set_fields["eventType"] = payload["tier"]
            if "event_type" in payload:
                et_val = str(payload["event_type"]).lower()
                is_doubles = "doubles" in et_val
                is_teams = "team" in et_val or is_doubles
                team_sz = int(payload.get("team_size") or (2 if is_doubles else (5 if is_teams else 1)))
                bcp_set_fields["eventType"] = "Doubles Event" if is_doubles else ("Teams Event" if is_teams else "Singles Event")
                bcp_set_fields["doublesEvent"] = is_doubles
                bcp_set_fields["teamEvent"] = is_teams
                bcp_set_fields["gameType"] = "teams" if is_teams else "singles"
                bcp_set_fields["teamSize"] = team_sz
                ev["event_type"] = "doubles" if is_doubles else ("teams" if is_teams else "singles")
                ev["team_size"] = team_sz

            if bcp_set_fields:
                bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}"
                resp_data, err_msg = execute_bcp_api_call(bcp_url, method="POST", json_data={"set": bcp_set_fields}, user_id=user_id)
                if resp_data is not None or not err_msg:
                    bcp_updated = True
                    logger.info(f"✅ Successfully updated BCP tournament {event_id}")

        return {
            "success": True,
            "event": saved,
            "bcp_updated": bcp_updated
        }

    VERIFIED_TOURNAMENT_CITIES = [
        {"city": "San Diego", "state": "CA", "country": "United States", "lat": 32.7157, "lng": -117.1611, "label": "San Diego, CA, United States"},
        {"city": "Los Angeles", "state": "CA", "country": "United States", "lat": 34.0522, "lng": -118.2437, "label": "Los Angeles, CA, United States"},
        {"city": "San Francisco", "state": "CA", "country": "United States", "lat": 37.7749, "lng": -122.4194, "label": "San Francisco, CA, United States"},
        {"city": "San Jose", "state": "CA", "country": "United States", "lat": 37.3382, "lng": -121.8863, "label": "San Jose, CA, United States"},
        {"city": "Sacramento", "state": "CA", "country": "United States", "lat": 38.5816, "lng": -121.4944, "label": "Sacramento, CA, United States"},
        {"city": "Austin", "state": "TX", "country": "United States", "lat": 30.2672, "lng": -97.7431, "label": "Austin, TX, United States"},
        {"city": "Dallas", "state": "TX", "country": "United States", "lat": 32.7767, "lng": -96.7970, "label": "Dallas, TX, United States"},
        {"city": "Houston", "state": "TX", "country": "United States", "lat": 29.7604, "lng": -95.3698, "label": "Houston, TX, United States"},
        {"city": "San Antonio", "state": "TX", "country": "United States", "lat": 29.4241, "lng": -98.4936, "label": "San Antonio, TX, United States"},
        {"city": "Fort Worth", "state": "TX", "country": "United States", "lat": 32.7555, "lng": -97.3308, "label": "Fort Worth, TX, United States"},
        {"city": "Seattle", "state": "WA", "country": "United States", "lat": 47.6062, "lng": -122.3321, "label": "Seattle, WA, United States"},
        {"city": "Tacoma", "state": "WA", "country": "United States", "lat": 47.2529, "lng": -122.4443, "label": "Tacoma, WA, United States"},
        {"city": "Portland", "state": "OR", "country": "United States", "lat": 45.5152, "lng": -122.6784, "label": "Portland, OR, United States"},
        {"city": "Chicago", "state": "IL", "country": "United States", "lat": 41.8781, "lng": -87.6298, "label": "Chicago, IL, United States"},
        {"city": "New York", "state": "NY", "country": "United States", "lat": 40.7128, "lng": -74.0060, "label": "New York, NY, United States"},
        {"city": "Brooklyn", "state": "NY", "country": "United States", "lat": 40.6782, "lng": -73.9442, "label": "Brooklyn, NY, United States"},
        {"city": "Buffalo", "state": "NY", "country": "United States", "lat": 42.8864, "lng": -78.8784, "label": "Buffalo, NY, United States"},
        {"city": "Atlanta", "state": "GA", "country": "United States", "lat": 33.7490, "lng": -84.3880, "label": "Atlanta, GA, United States"},
        {"city": "Denver", "state": "CO", "country": "United States", "lat": 39.7392, "lng": -104.9903, "label": "Denver, CO, United States"},
        {"city": "Colorado Springs", "state": "CO", "country": "United States", "lat": 38.8339, "lng": -104.8214, "label": "Colorado Springs, CO, United States"},
        {"city": "Phoenix", "state": "AZ", "country": "United States", "lat": 33.4484, "lng": -112.0740, "label": "Phoenix, AZ, United States"},
        {"city": "Tucson", "state": "AZ", "country": "United States", "lat": 32.2226, "lng": -110.9747, "label": "Tucson, AZ, United States"},
        {"city": "Las Vegas", "state": "NV", "country": "United States", "lat": 36.1699, "lng": -115.1398, "label": "Las Vegas, NV, United States"},
        {"city": "Reno", "state": "NV", "country": "United States", "lat": 39.5296, "lng": -119.8138, "label": "Reno, NV, United States"},
        {"city": "Salt Lake City", "state": "UT", "country": "United States", "lat": 40.7608, "lng": -111.8910, "label": "Salt Lake City, UT, United States"},
        {"city": "Orlando", "state": "FL", "country": "United States", "lat": 28.5383, "lng": -81.3792, "label": "Orlando, FL, United States"},
        {"city": "Tampa", "state": "FL", "country": "United States", "lat": 27.9506, "lng": -82.4572, "label": "Tampa, FL, United States"},
        {"city": "Miami", "state": "FL", "country": "United States", "lat": 25.7617, "lng": -80.1918, "label": "Miami, FL, United States"},
        {"city": "Jacksonville", "state": "FL", "country": "United States", "lat": 30.3322, "lng": -81.6557, "label": "Jacksonville, FL, United States"},
        {"city": "Minneapolis", "state": "MN", "country": "United States", "lat": 44.9778, "lng": -93.2650, "label": "Minneapolis, MN, United States"},
        {"city": "Philadelphia", "state": "PA", "country": "United States", "lat": 39.9526, "lng": -75.1652, "label": "Philadelphia, PA, United States"},
        {"city": "Pittsburgh", "state": "PA", "country": "United States", "lat": 40.4406, "lng": -79.9959, "label": "Pittsburgh, PA, United States"},
        {"city": "Boston", "state": "MA", "country": "United States", "lat": 42.3601, "lng": -71.0589, "label": "Boston, MA, United States"},
        {"city": "Baltimore", "state": "MD", "country": "United States", "lat": 39.2904, "lng": -76.6122, "label": "Baltimore, MD, United States"},
        {"city": "Washington", "state": "DC", "country": "United States", "lat": 38.9072, "lng": -77.0369, "label": "Washington, DC, United States"},
        {"city": "Detroit", "state": "MI", "country": "United States", "lat": 42.3314, "lng": -83.0458, "label": "Detroit, MI, United States"},
        {"city": "Columbus", "state": "OH", "country": "United States", "lat": 39.9612, "lng": -82.9988, "label": "Columbus, OH, United States"},
        {"city": "Cleveland", "state": "OH", "country": "United States", "lat": 41.4993, "lng": -81.6944, "label": "Cleveland, OH, United States"},
        {"city": "Cincinnati", "state": "OH", "country": "United States", "lat": 39.1031, "lng": -84.5120, "label": "Cincinnati, OH, United States"},
        {"city": "Indianapolis", "state": "IN", "country": "United States", "lat": 39.7684, "lng": -86.1581, "label": "Indianapolis, IN, United States"},
        {"city": "Kansas City", "state": "MO", "country": "United States", "lat": 39.0997, "lng": -94.5786, "label": "Kansas City, MO, United States"},
        {"city": "St. Louis", "state": "MO", "country": "United States", "lat": 38.6270, "lng": -90.1994, "label": "St. Louis, MO, United States"},
        {"city": "Nashville", "state": "TN", "country": "United States", "lat": 36.1627, "lng": -86.7816, "label": "Nashville, TN, United States"},
        {"city": "Memphis", "state": "TN", "country": "United States", "lat": 35.1495, "lng": -90.0490, "label": "Memphis, TN, United States"},
        {"city": "Charlotte", "state": "NC", "country": "United States", "lat": 35.2271, "lng": -80.8431, "label": "Charlotte, NC, United States"},
        {"city": "Raleigh", "state": "NC", "country": "United States", "lat": 35.7796, "lng": -78.6382, "label": "Raleigh, NC, United States"},
        {"city": "New Orleans", "state": "LA", "country": "United States", "lat": 29.9511, "lng": -90.0715, "label": "New Orleans, LA, United States"},
        {"city": "Milwaukee", "state": "WI", "country": "United States", "lat": 43.0389, "lng": -87.9065, "label": "Milwaukee, WI, United States"},
        {"city": "London", "state": "Greater London", "country": "United Kingdom", "lat": 51.5074, "lng": -0.1278, "label": "London, United Kingdom"},
        {"city": "Nottingham", "state": "Nottinghamshire", "country": "United Kingdom", "lat": 52.9548, "lng": -1.1581, "label": "Nottingham, United Kingdom"},
        {"city": "Manchester", "state": "Greater Manchester", "country": "United Kingdom", "lat": 53.4808, "lng": -2.2426, "label": "Manchester, United Kingdom"},
        {"city": "Birmingham", "state": "West Midlands", "country": "United Kingdom", "lat": 52.4862, "lng": -1.8904, "label": "Birmingham, United Kingdom"},
        {"city": "Toronto", "state": "ON", "country": "Canada", "lat": 43.6532, "lng": -79.3832, "label": "Toronto, ON, Canada"},
        {"city": "Vancouver", "state": "BC", "country": "Canada", "lat": 49.2827, "lng": -123.1207, "label": "Vancouver, BC, Canada"},
        {"city": "Montreal", "state": "QC", "country": "Canada", "lat": 45.5017, "lng": -73.5673, "label": "Montreal, QC, Canada"},
        {"city": "Calgary", "state": "AB", "country": "Canada", "lat": 51.0447, "lng": -114.0719, "label": "Calgary, AB, Canada"},
        {"city": "Sydney", "state": "NSW", "country": "Australia", "lat": -33.8688, "lng": 151.2093, "label": "Sydney, NSW, Australia"},
        {"city": "Melbourne", "state": "VIC", "country": "Australia", "lat": -37.8136, "lng": 144.9631, "label": "Melbourne, VIC, Australia"},
        {"city": "Paris", "state": "Île-de-France", "country": "France", "lat": 48.8566, "lng": 2.3522, "label": "Paris, France"},
        {"city": "Berlin", "state": "Berlin", "country": "Germany", "lat": 52.5200, "lng": 13.4050, "label": "Berlin, Germany"},
        {"city": "Madrid", "state": "Community of Madrid", "country": "Spain", "lat": 40.4168, "lng": -3.7038, "label": "Madrid, Spain"},
        {"city": "Rome", "state": "Lazio", "country": "Italy", "lat": 41.9028, "lng": 12.4964, "label": "Rome, Italy"}
    ]

    @app.get("/api/eventstudio/locations/search", summary="Search verified cities for event creation")
    async def api_eventstudio_search_locations(q: str = Query("")):
        query = q.strip().lower()
        if not query or len(query) < 2:
            return {"results": VERIFIED_TOURNAMENT_CITIES[:8]}
        
        matches = [
            c for c in VERIFIED_TOURNAMENT_CITIES
            if query in c["city"].lower() or query in c["label"].lower()
        ]
        
        # If fewer than 5 local matches, try geocoding API fallback
        if len(matches) < 5:
            try:
                import urllib.request, json
                url = f"https://photon.komoot.io/api/?q={urllib.parse.quote(q)}&limit=6&osm_tag=place:city&osm_tag=place:town"
                req = urllib.request.Request(url, headers={"User-Agent": "OmniTactica/1.0"})
                with urllib.request.urlopen(req, timeout=2) as resp:
                    data = json.loads(resp.read().decode())
                    for f in data.get("features", []):
                        p = f.get("properties", {})
                        city = p.get("name") or p.get("city") or p.get("town")
                        if not city:
                            continue
                        state = p.get("state") or p.get("county") or ""
                        country = p.get("country") or ""
                        coords = f.get("geometry", {}).get("coordinates", [0, 0])
                        parts = [city, state, country] if state else [city, country]
                        label = ", ".join([x for x in parts if x])
                        key = f"{city.lower()}_{state.lower()}_{country.lower()}"
                        if not any(f"{m['city'].lower()}_{m['state'].lower()}_{m['country'].lower()}" == key for m in matches):
                            matches.append({
                                "city": city,
                                "state": state,
                                "country": country or "United States",
                                "lat": coords[1],
                                "lng": coords[0],
                                "label": label
                            })
            except Exception:
                pass

        if len(matches) < 3:
            try:
                import urllib.request, json
                nom_url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(q)}&format=json&addressdetails=1&limit=6"
                req = urllib.request.Request(nom_url, headers={"User-Agent": "OmniTactica-Tournament-App/1.0"})
                with urllib.request.urlopen(req, timeout=2) as resp:
                    items = json.loads(resp.read().decode())
                    for item in items:
                        addr = item.get("address", {})
                        city = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("municipality") or item.get("name")
                        if not city:
                            continue
                        state = addr.get("state") or addr.get("county") or ""
                        country = addr.get("country") or ""
                        lat = float(item.get("lat", 0))
                        lng = float(item.get("lon", 0))
                        parts = [city, state, country] if state else [city, country]
                        label = ", ".join([x for x in parts if x])
                        key = f"{city.lower()}_{state.lower()}_{country.lower()}"
                        if not any(f"{m['city'].lower()}_{m['state'].lower()}_{m['country'].lower()}" == key for m in matches):
                            matches.append({
                                "city": city,
                                "state": state,
                                "country": country or "United States",
                                "lat": lat,
                                "lng": lng,
                                "label": label
                            })
            except Exception:
                pass

        return {"results": matches[:10]}

    @app.get("/api/eventstudio/circuits", summary="Get available Warhammer 40k circuits from BCP")
    async def api_eventstudio_get_circuits(request: Request):
        try:
            import urllib.request, json
            url = f"{BCP_API_BASE}/leagues?limit=50&gameSystemId={DEFAULT_GAME_SYSTEM_ID}&active=true"
            headers = DEFAULT_HEADERS.copy()
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                leagues = data if isinstance(data, list) else data.get("data", [])
                formatted = [
                    {"id": str(l.get("id")), "name": l.get("name", "Unknown Circuit")}
                    for l in leagues if l.get("id") and l.get("name")
                ]
                return {"success": True, "circuits": formatted}
        except Exception as e:
            logger.warning(f"Error fetching circuits from BCP: {e}")
            return {"success": True, "circuits": [
                {"id": "NvjgICBwiP", "name": "ITC - Independent Tournament Circuit"},
                {"id": "247D2CRUW2", "name": "The U.K. Tournament Circuit (UKTC)"},
                {"id": "FHM0PJHRE7", "name": "California Championship Circuit"},
                {"id": "D6XLCWELAP", "name": "Northeast 40k Tournament Circuit"},
                {"id": "0J24UL9C46", "name": "The Great Lakes 40K Circuit"},
                {"id": "VHAD284QP4", "name": "The France Tournament Circuit"}
            ]}

    @app.get("/api/eventstudio/event/{event_id}/circuits", summary="Get circuits linked to this event")
    async def api_eventstudio_get_event_circuits(event_id: str, request: Request):
        db = get_database()
        ev = db.get_studio_event(event_id)
        local_circuits = ev.get("circuits", []) if ev else []
        if event_id.startswith("ES-"):
            return {"success": True, "circuits": local_circuits}

        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None

        bcp_url = f"{BCP_API_BASE}/events/{event_id}/leagues"
        data, err = execute_bcp_api_call(bcp_url, method="GET", user_id=user_id)
        merged = []
        seen = set()
        if data:
            bcp_leagues = data if isinstance(data, list) else data.get("data", [])
            for l in bcp_leagues:
                lid = str(l.get("id") or l.get("leagueId") or "")
                if lid and lid not in seen:
                    seen.add(lid)
                    merged.append({"id": lid, "name": l.get("name") or "Tournament Circuit", "submitted": True})
        for lc in local_circuits:
            if lc.get("id") not in seen:
                seen.add(lc.get("id"))
                merged.append(lc)
        return {"success": True, "circuits": merged}

    class SubmitCircuitPayload(BaseModel):
        circuit_id: str
        token_code: Optional[str] = None
        circuit_name: Optional[str] = None

    @app.post("/api/eventstudio/event/{event_id}/circuits/submit", summary="Link tournament to circuit on BCP")
    async def api_eventstudio_submit_circuit(event_id: str, payload: SubmitCircuitPayload, request: Request):
        db = get_database()
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None

        ev = db.get_studio_event(event_id)
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")

        bcp_ok = False
        if not event_id.startswith("ES-") and user_id:
            bcp_url = f"{BCP_API_BASE}/events/{event_id}/submitToLeague"
            bcp_body = {"leagueId": payload.circuit_id}
            if payload.token_code:
                bcp_body["tokenCode"] = payload.token_code
            res_data, err_msg = execute_bcp_api_call(bcp_url, method="POST", json_data=bcp_body, user_id=user_id)
            if res_data is not None or not err_msg:
                bcp_ok = True

        circuits = ev.get("circuits") or []
        c_name = payload.circuit_name or "Tournament Circuit"
        if not any(c.get("id") == payload.circuit_id for c in circuits):
            circuits.append({
                "id": payload.circuit_id,
                "name": c_name,
                "token_code": payload.token_code or "",
                "linked_at": datetime.now(timezone.utc).isoformat()
            })
            ev["circuits"] = circuits
            db.save_studio_event(ev)

        return {"success": True, "bcp_synced": bcp_ok, "circuits": circuits}

    @app.delete("/api/eventstudio/event/{event_id}", summary="Delete tournament from Event Studio and BCP")
    async def api_eventstudio_delete_event(event_id: str, request: Request):
        db = get_database()
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None
        bcp_token = auth_mgr.get_valid_bcp_token(user_id) if user_id else None

        db.delete_studio_event(event_id, organizer_id=user_id)

        # Delete on BCP if authenticated
        bcp_deleted = False
        if user_id and not event_id.startswith("ES-"):
            bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}"
            resp_data, err_msg = execute_bcp_api_call(bcp_url, method="DELETE", user_id=user_id)
            if resp_data is not None or not err_msg or (err_msg and ("404" in str(err_msg) or "not found" in str(err_msg).lower())):
                bcp_deleted = True
                logger.info(f"✅ Successfully deleted BCP tournament {event_id}")
            else:
                logger.warning(f"⚠️ BCP tournament delete for {event_id} failed: {err_msg}")

        return {
            "success": True,
            "event_id": event_id,
            "bcp_deleted": bcp_deleted,
            "message": "Tournament deleted successfully."
        }

    @app.post("/api/eventstudio/event/{event_id}/pairings", summary="Save round pairings and sync game rooms with BCP")
    async def api_eventstudio_save_pairings(event_id: str, payload: Dict[str, Any], request: Request):
        db = get_database()
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None
        bcp_token = auth_mgr.get_valid_bcp_token(user_id) if user_id else None

        round_num = str(payload.get("round") or payload.get("round_num") or 1)
        pairings_list = payload.get("pairings") or []

        ev = db.get_studio_event(event_id)
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")

        pairings_map = ev.get("pairings") or {}
        pairings_map[round_num] = pairings_list
        ev["pairings"] = pairings_map
        ev["current_round"] = int(round_num)

        # Pre-seed deterministic tracker rooms for each table
        for p in pairings_list:
            t_num = p.get("table") or 1
            mid = f"BCP-{event_id}-R{round_num}-T{t_num}".upper()
            p1_name = p.get("p1_name") or p.get("p1Name") or "Player 1"
            p2_name = p.get("p2_name") or p.get("p2Name") or "Player 2"
            p1_fac = p.get("p1_faction") or p.get("p1Faction") or ""
            p2_fac = p.get("p2_faction") or p.get("p2Faction") or ""
            
            if mid not in TRACKER_ROOMS:
                TRACKER_ROOMS[mid] = {
                    "match_id": mid,
                    "user_id_p1": None,
                    "user_id_p2": None,
                    "referee_ids": [user_id] if user_id else [],
                    "version": 1,
                    "state": {
                        "game": {
                            "eventId": event_id,
                            "roundNum": int(round_num),
                            "tableNum": int(t_num),
                            "p1Name": p1_name,
                            "p2Name": p2_name,
                            "p1Faction": p1_fac,
                            "p2Faction": p2_fac
                        },
                        "p1": {"rounds": [{"primaryScore": 0, "secondaryScore": 0}], "battleReady": True},
                        "p2": {"rounds": [{"primaryScore": 0, "secondaryScore": 0}], "battleReady": True},
                        "round": 1,
                        "started": False
                    }
                }

        saved = db.save_studio_event(ev)

        # Push to BCP
        bcp_pushed = False
        if bcp_token and not event_id.startswith("ES-"):
            try:
                import urllib.request, json
                bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}/rounds/{round_num}/pairings"
                req = urllib.request.Request(
                    bcp_url,
                    data=json.dumps({"pairings": pairings_list}).encode("utf-8"),
                    headers={
                        "Authorization": f"Bearer {bcp_token}",
                        "Content-Type": "application/json"
                    },
                    method="POST"
                )
                with urllib.request.urlopen(req, timeout=8) as resp:
                    if resp.status in (200, 201):
                        bcp_pushed = True
            except Exception as e:
                logger.debug(f"BCP pairings push notice: {e}")

        return {
            "success": True,
            "event_id": event_id,
            "round": round_num,
            "pairings_count": len(pairings_list),
            "bcp_pushed": bcp_pushed,
            "event": saved
        }

    @app.post("/api/eventstudio/event/{event_id}/roster", summary="Update event competitor roster")
    async def api_eventstudio_save_roster(event_id: str, payload: Dict[str, Any], request: Request):
        db = get_database()
        ev = db.get_studio_event(event_id)
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")

        roster = payload.get("roster") or []
        ev["roster"] = roster
        ev["total_players"] = len(roster)
        saved = db.save_studio_event(ev)

        return {
            "success": True,
            "roster_count": len(roster),
            "event": saved
        }

    @app.post("/api/eventstudio/event/{event_id}/pairings/generate", summary="Generate automated Swiss pairings for tournament round")
    async def api_eventstudio_generate_pairings(event_id: str, payload: Dict[str, Any], request: Request):
        db = get_database()
        ev = db.get_studio_event(event_id)
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")

        target_round = int(payload.get("round") or payload.get("round_num") or (ev.get("current_round") or 1))
        roster = [p for p in (ev.get("roster") or []) if not p.get("dropped")]
        if not roster or len(roster) < 2:
            raise HTTPException(status_code=400, detail="At least 2 active players required in roster to generate pairings")

        pairings_map = ev.get("pairings") or {}
        
        # Calculate historical records and past opponents
        records = {}
        past_opponents = {}
        for p in roster:
            pid = str(p.get("id") or p.get("player_id") or p.get("name"))
            records[pid] = {
                "player": p,
                "wins": 0,
                "losses": 0,
                "draws": 0,
                "points": 0,
                "battle_points": 0,
                "path_to_victory": 0,
                "byes": 0
            }
            past_opponents[pid] = set()

        for r_str, r_pairings in pairings_map.items():
            try:
                r_num = int(r_str)
            except Exception:
                continue
            if r_num >= target_round:
                continue
            for match in (r_pairings or []):
                p1_id = str(match.get("p1_id") or match.get("p1_name") or "")
                p2_id = str(match.get("p2_id") or match.get("p2_name") or "")
                p1_s = int(match.get("p1_score") or 0)
                p2_s = int(match.get("p2_score") or 0)
                is_bye = bool(match.get("is_bye") or not p2_id)

                if p1_id in records:
                    records[p1_id]["battle_points"] += p1_s
                    if is_bye:
                        records[p1_id]["wins"] += 1
                        records[p1_id]["points"] += 3
                        records[p1_id]["byes"] += 1
                    elif p1_s > p2_s:
                        records[p1_id]["wins"] += 1
                        records[p1_id]["points"] += 3
                        records[p1_id]["path_to_victory"] += (10 ** (10 - r_num))
                    elif p1_s < p2_s:
                        records[p1_id]["losses"] += 1
                    else:
                        records[p1_id]["draws"] += 1
                        records[p1_id]["points"] += 1

                if p2_id and p2_id in records and not is_bye:
                    records[p2_id]["battle_points"] += p2_s
                    past_opponents[p1_id].add(p2_id)
                    past_opponents[p2_id].add(p1_id)
                    if p2_s > p1_s:
                        records[p2_id]["wins"] += 1
                        records[p2_id]["points"] += 3
                        records[p2_id]["path_to_victory"] += (10 ** (10 - r_num))
                    elif p2_s < p1_s:
                        records[p2_id]["losses"] += 1
                    else:
                        records[p2_id]["draws"] += 1
                        records[p2_id]["points"] += 1

        # Sort players by Swiss Points -> Path to Victory -> Battle Points -> Elo / Seed
        sorted_players = sorted(
            roster,
            key=lambda p: (
                -records.get(str(p.get("id") or p.get("player_id") or p.get("name")), {}).get("points", 0),
                -records.get(str(p.get("id") or p.get("player_id") or p.get("name")), {}).get("path_to_victory", 0),
                -records.get(str(p.get("id") or p.get("player_id") or p.get("name")), {}).get("battle_points", 0),
                -float(p.get("elo") or p.get("current_elo") or 1500)
            )
        )

        # Handle Bye for odd players count
        bye_player = None
        if len(sorted_players) % 2 != 0:
            for candidate in reversed(sorted_players):
                cid = str(candidate.get("id") or candidate.get("player_id") or candidate.get("name"))
                if records.get(cid, {}).get("byes", 0) == 0:
                    bye_player = candidate
                    sorted_players.remove(candidate)
                    break
            if not bye_player and sorted_players:
                bye_player = sorted_players.pop()

        # Swiss pairing algorithm (greedy with rematch avoidance)
        pairs = []
        unpaired = list(sorted_players)
        
        while unpaired:
            p1 = unpaired.pop(0)
            p1_id = str(p1.get("id") or p1.get("player_id") or p1.get("name"))
            p1_team = (p1.get("team") or p1.get("club") or "").strip().lower()

            best_idx = 0
            for i, p2 in enumerate(unpaired):
                p2_id = str(p2.get("id") or p2.get("player_id") or p2.get("name"))
                p2_team = (p2.get("team") or p2.get("club") or "").strip().lower()
                is_rematch = p2_id in past_opponents.get(p1_id, set())
                same_team = bool(p1_team and p2_team and p1_team == p2_team)
                if not is_rematch and not same_team:
                    best_idx = i
                    break
                elif not is_rematch:
                    best_idx = i

            p2 = unpaired.pop(best_idx)
            pairs.append((p1, p2))

        # Format pairings list
        generated_pairings = []
        table_num = int(ev.get("startingTable") or 1)
        for p1, p2 in pairs:
            generated_pairings.append({
                "table": table_num,
                "p1_id": str(p1.get("id") or p1.get("player_id") or p1.get("name")),
                "p1_name": p1.get("name") or "Player 1",
                "p1_faction": p1.get("faction") or "Unknown Faction",
                "p1_army_list": p1.get("army_list") or "",
                "p1_score": 0,
                "p2_id": str(p2.get("id") or p2.get("player_id") or p2.get("name")),
                "p2_name": p2.get("name") or "Player 2",
                "p2_faction": p2.get("faction") or "Unknown Faction",
                "p2_army_list": p2.get("army_list") or "",
                "p2_score": 0,
                "is_done": False,
                "is_bye": False
            })
            table_num += 1

        if bye_player:
            generated_pairings.append({
                "table": table_num,
                "p1_id": str(bye_player.get("id") or bye_player.get("player_id") or bye_player.get("name")),
                "p1_name": bye_player.get("name") or "Player",
                "p1_faction": bye_player.get("faction") or "Unknown Faction",
                "p1_army_list": bye_player.get("army_list") or "",
                "p1_score": 100,
                "p2_id": None,
                "p2_name": "BYE",
                "p2_faction": "",
                "p2_army_list": "",
                "p2_score": 0,
                "is_done": True,
                "is_bye": True
            })

        pairings_map[str(target_round)] = generated_pairings
        ev["pairings"] = pairings_map
        ev["current_round"] = target_round
        saved = db.save_studio_event(ev)

        # Sync generate pairings to BCP if authenticated
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None
        bcp_generated = False
        if user_id and not event_id.startswith("ES-"):
            bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}/generatePairings"
            resp_data, err_msg = execute_bcp_api_call(bcp_url, method="POST", json_data={"round": target_round}, user_id=user_id)
            if resp_data is not None or not err_msg:
                bcp_generated = True
                logger.info(f"✅ Generated Round {target_round} pairings on BCP for {event_id}")

        return {
            "success": True,
            "round": target_round,
            "pairings": generated_pairings,
            "bcp_generated": bcp_generated,
            "event": saved
        }

    @app.post("/api/eventstudio/event/{event_id}/pairings/publish", summary="Publish tournament round pairings on OmniTactica and BCP")
    async def api_eventstudio_publish_pairings(event_id: str, payload: Dict[str, Any], request: Request):
        db = get_database()
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None

        ev = db.get_studio_event(event_id)
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")

        round_num = int(payload.get("round") or ev.get("current_round") or 1)
        ev["published_round"] = round_num
        ev["is_published"] = True
        saved = db.save_studio_event(ev)

        # Sync publish to BCP
        bcp_published = False
        if user_id and not event_id.startswith("ES-"):
            bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}/publishPairings"
            resp_data, err_msg = execute_bcp_api_call(bcp_url, method="POST", json_data={"round": round_num}, user_id=user_id)
            if resp_data is not None or not err_msg:
                bcp_published = True
                logger.info(f"✅ Successfully published Round {round_num} pairings on BCP for event {event_id}")

        return {
            "success": True,
            "round": round_num,
            "bcp_published": bcp_published,
            "event": saved,
            "message": f"Round {round_num} pairings published successfully."
        }

    @app.post("/api/eventstudio/event/{event_id}/pairings/unpublish", summary="Unpublish tournament round pairings on OmniTactica and BCP")
    async def api_eventstudio_unpublish_pairings(event_id: str, payload: Dict[str, Any], request: Request):
        db = get_database()
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None

        ev = db.get_studio_event(event_id)
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")

        round_num = int(payload.get("round") or ev.get("current_round") or 1)
        ev["is_published"] = False
        saved = db.save_studio_event(ev)

        # Sync unpublish to BCP
        bcp_unpublished = False
        if user_id and not event_id.startswith("ES-"):
            bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}/unPublishPairings"
            resp_data, err_msg = execute_bcp_api_call(bcp_url, method="POST", json_data={"round": round_num}, user_id=user_id)
            if resp_data is not None or not err_msg:
                bcp_unpublished = True
                logger.info(f"✅ Successfully unpublished Round {round_num} pairings on BCP for event {event_id}")

        return {
            "success": True,
            "round": round_num,
            "bcp_unpublished": bcp_unpublished,
            "event": saved,
            "message": f"Round {round_num} pairings unpublished."
        }

    @app.post("/api/eventstudio/event/{event_id}/round/finalize", summary="Finalize and lock round, advancing tournament round")
    async def api_eventstudio_finalize_round(event_id: str, payload: Dict[str, Any], request: Request):
        db = get_database()
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None

        ev = db.get_studio_event(event_id)
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")

        round_num = int(payload.get("round") or ev.get("current_round") or 1)
        total_rounds = int(ev.get("num_rounds") or 3)
        
        # Advance current round if not at end
        next_round = min(round_num + 1, total_rounds)
        ev["current_round"] = next_round
        saved = db.save_studio_event(ev)

        # Sync finalize to BCP
        bcp_finalized = False
        if user_id and not event_id.startswith("ES-"):
            bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}/finalizeRound"
            resp_data, err_msg = execute_bcp_api_call(bcp_url, method="POST", json_data={"round": round_num}, user_id=user_id)
            if resp_data is not None or not err_msg:
                bcp_finalized = True
                logger.info(f"✅ Successfully finalized Round {round_num} on BCP for event {event_id}")

        return {
            "success": True,
            "finalized_round": round_num,
            "current_round": next_round,
            "bcp_finalized": bcp_finalized,
            "event": saved,
            "message": f"Round {round_num} finalized successfully. Active round is now Round {next_round}."
        }

    @app.post("/api/eventstudio/event/{event_id}/round/reset", summary="Reset a round for corrections")
    async def api_eventstudio_reset_round(event_id: str, payload: Dict[str, Any], request: Request):
        db = get_database()
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None

        ev = db.get_studio_event(event_id)
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")

        round_num = int(payload.get("round") or ev.get("current_round") or 1)
        ev["current_round"] = max(1, round_num)
        saved = db.save_studio_event(ev)

        # Sync reset to BCP
        bcp_reset = False
        if user_id and not event_id.startswith("ES-"):
            bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}/resetRound"
            resp_data, err_msg = execute_bcp_api_call(bcp_url, method="POST", json_data={"round": round_num}, user_id=user_id)
            if resp_data is not None or not err_msg:
                bcp_reset = True
                logger.info(f"✅ Successfully reset Round {round_num} on BCP for event {event_id}")

        return {
            "success": True,
            "round": round_num,
            "bcp_reset": bcp_reset,
            "event": saved,
            "message": f"Round {round_num} has been reset."
        }

    @app.post("/api/eventstudio/event/{event_id}/end", summary="End and archive tournament on OmniTactica and BCP")
    async def api_eventstudio_end_tournament(event_id: str, request: Request):
        db = get_database()
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None

        ev = db.get_studio_event(event_id)
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")

        ev["is_ended"] = True
        saved = db.save_studio_event(ev)

        # Sync ended to BCP
        bcp_ended = False
        if user_id and not event_id.startswith("ES-"):
            bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}"
            resp_data, err_msg = execute_bcp_api_call(bcp_url, method="POST", json_data={"set": {"ended": True}}, user_id=user_id)
            if resp_data is not None or not err_msg:
                bcp_ended = True
                logger.info(f"✅ Successfully marked tournament {event_id} as ended on BCP")

        return {
            "success": True,
            "event_id": event_id,
            "bcp_ended": bcp_ended,
            "event": saved,
            "message": "Tournament concluded and archived successfully."
        }

    @app.get("/api/eventstudio/event/{event_id}/standings", summary="Compute live Swiss standings and tiebreaker metrics")
    async def api_eventstudio_get_standings(event_id: str, request: Request):
        db = get_database()
        ev = db.get_studio_event(event_id)
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")

        roster = ev.get("roster") or []
        pairings_map = ev.get("pairings") or {}

        # 1. Compute round-by-round statistics
        player_stats = {}
        for p in roster:
            pid = str(p.get("id") or p.get("player_id") or p.get("name"))
            player_stats[pid] = {
                "id": pid,
                "name": p.get("name") or "Player",
                "faction": p.get("faction") or "Unknown Faction",
                "team": p.get("team") or p.get("club") or "",
                "dropped": bool(p.get("dropped")),
                "checked_in": bool(p.get("checked_in")),
                "wins": 0,
                "losses": 0,
                "draws": 0,
                "swiss_points": 0,
                "path_to_victory": 0,
                "battle_points": 0,
                "battle_points_diff": 0,
                "opponents": [],
                "rounds_played": 0
            }

        for r_str, r_pairings in sorted(pairings_map.items(), key=lambda x: int(x[0]) if str(x[0]).isdigit() else 0):
            try:
                r_num = int(r_str)
            except Exception:
                continue
            for match in (r_pairings or []):
                p1_id = str(match.get("p1_id") or match.get("p1_name") or "")
                p2_id = str(match.get("p2_id") or match.get("p2_name") or "")
                p1_s = int(match.get("p1_score") or 0)
                p2_s = int(match.get("p2_score") or 0)
                is_done = bool(match.get("is_done") or p1_s > 0 or p2_s > 0)
                is_bye = bool(match.get("is_bye") or not p2_id)

                if is_done and p1_id in player_stats:
                    player_stats[p1_id]["rounds_played"] += 1
                    player_stats[p1_id]["battle_points"] += p1_s
                    player_stats[p1_id]["battle_points_diff"] += (p1_s - p2_s)
                    if is_bye:
                        player_stats[p1_id]["wins"] += 1
                        player_stats[p1_id]["swiss_points"] += 3
                        player_stats[p1_id]["path_to_victory"] += (10 ** (10 - r_num))
                    elif p1_s > p2_s:
                        player_stats[p1_id]["wins"] += 1
                        player_stats[p1_id]["swiss_points"] += 3
                        player_stats[p1_id]["path_to_victory"] += (10 ** (10 - r_num))
                    elif p1_s < p2_s:
                        player_stats[p1_id]["losses"] += 1
                    else:
                        player_stats[p1_id]["draws"] += 1
                        player_stats[p1_id]["swiss_points"] += 1

                if is_done and p2_id and p2_id in player_stats and not is_bye:
                    player_stats[p1_id]["opponents"].append(p2_id)
                    player_stats[p2_id]["opponents"].append(p1_id)
                    player_stats[p2_id]["rounds_played"] += 1
                    player_stats[p2_id]["battle_points"] += p2_s
                    player_stats[p2_id]["battle_points_diff"] += (p2_s - p1_s)
                    if p2_s > p1_s:
                        player_stats[p2_id]["wins"] += 1
                        player_stats[p2_id]["swiss_points"] += 3
                        player_stats[p2_id]["path_to_victory"] += (10 ** (10 - r_num))
                    elif p2_s < p1_s:
                        player_stats[p2_id]["losses"] += 1
                    else:
                        player_stats[p2_id]["draws"] += 1
                        player_stats[p2_id]["swiss_points"] += 1

        # 2. Compute Opponent Win % (Strength of Schedule)
        for pid, stats in player_stats.items():
            opp_win_rates = []
            for opp_id in stats["opponents"]:
                if opp_id in player_stats:
                    opp = player_stats[opp_id]
                    tot = max(1, opp["rounds_played"])
                    wr = (opp["wins"] + (0.5 * opp["draws"])) / tot
                    opp_win_rates.append(max(0.33, wr))
            stats["opp_win_rate_sos"] = round((sum(opp_win_rates) / max(1, len(opp_win_rates))) * 100.0, 1) if opp_win_rates else 33.0

        # 3. Sort Standings by Swiss Points -> Path to Victory -> SoS -> Battle Points
        standings = sorted(
            player_stats.values(),
            key=lambda s: (
                -s["swiss_points"],
                -s["path_to_victory"],
                -s["opp_win_rate_sos"],
                -s["battle_points"],
                -s["battle_points_diff"]
            )
        )

        for idx, item in enumerate(standings, 1):
            item["rank"] = idx

        return {
            "success": True,
            "event_id": event_id,
            "total_players": len(standings),
            "standings": standings
        }

    @app.post("/api/eventstudio/submit_score", summary="Submit table match score and sync with BCP")
    async def api_eventstudio_submit_score(payload: SubmitScorePayload, request: Request):
        auth_header = request.headers.get("Authorization", "")
        token = payload.bcp_token or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        
        # If user has a native session with linked BCP token
        if not token:
            session_token = request.cookies.get("session_token")
            if session_token:
                session = get_auth_manager().get_session(session_token)
                if session and session.get("bcp_token"):
                    token = session.get("bcp_token")

        logger.info(f"EventStudio: Submitting Table {payload.table} Round {payload.round_num} Score ({payload.p1_score} - {payload.p2_score}) Source: {payload.source_app}")
        
        bcp_synced = False
        if token:
            try:
                import urllib.request
                import json
                bcp_url = f"https://api.bestcoastpairings.com/v1/events/{payload.event_id}/pairings/{payload.table}"
                req = urllib.request.Request(
                    bcp_url,
                    data=json.dumps({
                        "player1_score": payload.p1_score,
                        "player2_score": payload.p2_score,
                        "round": payload.round_num,
                        "game_details": payload.game_details or {}
                    }).encode("utf-8"),
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json"
                    },
                    method="PUT"
                )
                with urllib.request.urlopen(req, timeout=8) as resp:
                    if resp.status in (200, 201, 204):
                        bcp_synced = True
            except Exception as e:
                logger.warning(f"BCP sync non-blocking notice: {e}")

        return {
            "success": True,
            "event_id": payload.event_id,
            "table": payload.table,
            "round_num": payload.round_num,
            "p1_score": payload.p1_score,
            "p2_score": payload.p2_score,
            "source_app": payload.source_app,
            "bcp_synced": bcp_synced
        }

    class JudgeCallCreatePayload(BaseModel):
        event_id: str
        table_num: Optional[int] = None
        match_id: Optional[str] = None
        player_name: Optional[str] = "Competitor"
        category: Optional[str] = "Rules Dispute"
        note: Optional[str] = ""

    class JudgeCallResolvePayload(BaseModel):
        call_id: str
        status: Optional[str] = "resolved"

    @app.post("/api/eventstudio/judge_call", summary="Submit judge / TO floor assistance call from game room")
    async def api_eventstudio_create_judge_call(payload: JudgeCallCreatePayload):
        db = get_database()
        res = db.create_judge_call(
            event_id=payload.event_id,
            table_num=payload.table_num,
            match_id=payload.match_id,
            player_name=payload.player_name or "Competitor",
            category=payload.category or "Rules Dispute",
            note=payload.note or ""
        )
        return {"success": True, "call": res}

    @app.get("/api/eventstudio/judge_calls", summary="List active judge calls for a tournament")
    async def api_eventstudio_get_judge_calls(event_id: str, active_only: bool = False):
        db = get_database()
        calls = db.get_judge_calls(event_id=event_id, active_only=active_only)
        return {"success": True, "event_id": event_id, "calls": calls}

    @app.post("/api/eventstudio/judge_call/resolve", summary="Update judge call status (en_route, resolved)")
    async def api_eventstudio_resolve_judge_call(payload: JudgeCallResolvePayload):
        db = get_database()
        ok = db.resolve_judge_call(call_id=payload.call_id, status=payload.status or "resolved")
        return {"success": ok, "call_id": payload.call_id, "status": payload.status}

    class PodGeneratePayload(BaseModel):
        pod_size: Optional[int] = 4
        num_pods: Optional[int] = 2
        target_round: Optional[int] = None

    @app.post("/api/eventstudio/event/{event_id}/pods/generate", summary="Automate multi-day Pod & Bracket progression")
    async def api_eventstudio_generate_pods(event_id: str, payload: PodGeneratePayload):
        db = get_database()
        res = db.generate_day2_pod_brackets(
            event_id=event_id,
            pod_size=payload.pod_size or 4,
            num_pods=payload.num_pods or 2,
            target_round=payload.target_round
        )
        return res

    @app.get("/api/eventstudio/match_predictor", summary="Predict tactical matchup outcome, win probability, and score differential")
    async def api_eventstudio_match_predictor(
        p1_id: Optional[str] = None,
        p2_id: Optional[str] = None,
        p1_name: Optional[str] = "Player 1",
        p2_name: Optional[str] = "Player 2",
        p1_faction: Optional[str] = "Unknown",
        p2_faction: Optional[str] = "Unknown"
    ):
        db = get_database()
        
        # 1. Elo Ratings
        p1_elo = 1500.0
        p2_elo = 1500.0
        p1_matches = 0
        p2_matches = 0

        with db.get_connection() as conn:
            from psycopg2 import extras
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                if p1_id:
                    cursor.execute("SELECT current_elo, total_matches FROM player_ratings WHERE player_id = %s;", (p1_id,))
                    r1 = cursor.fetchone()
                    if r1:
                        p1_elo = float(r1["current_elo"] or 1500.0)
                        p1_matches = int(r1["total_matches"] or 0)
                elif p1_name:
                    cursor.execute("SELECT current_elo, total_matches FROM player_ratings WHERE player_name ILIKE %s ORDER BY current_elo DESC LIMIT 1;", (f"%{p1_name}%",))
                    r1 = cursor.fetchone()
                    if r1:
                        p1_elo = float(r1["current_elo"] or 1500.0)
                        p1_matches = int(r1["total_matches"] or 0)

                if p2_id:
                    cursor.execute("SELECT current_elo, total_matches FROM player_ratings WHERE player_id = %s;", (p2_id,))
                    r2 = cursor.fetchone()
                    if r2:
                        p2_elo = float(r2["current_elo"] or 1500.0)
                        p2_matches = int(r2["total_matches"] or 0)
                elif p2_name:
                    cursor.execute("SELECT current_elo, total_matches FROM player_ratings WHERE player_name ILIKE %s ORDER BY current_elo DESC LIMIT 1;", (f"%{p2_name}%",))
                    r2 = cursor.fetchone()
                    if r2:
                        p2_elo = float(r2["current_elo"] or 1500.0)
                        p2_matches = int(r2["total_matches"] or 0)

                # 2. Faction Matchup Win Rate
                fac1 = p1_faction or "Unknown"
                fac2 = p2_faction or "Unknown"
                fac_p1_wins = 0
                fac_total = 0
                if fac1 != "Unknown" and fac2 != "Unknown":
                    cursor.execute("""
                    SELECT 
                        COUNT(*) as total_games,
                        SUM(CASE WHEN (winner_id = player1_id AND player1_faction = %s) OR (winner_id = player2_id AND player2_faction = %s) THEN 1 ELSE 0 END) as fac1_wins
                    FROM matches
                    WHERE is_done = TRUE AND (
                        (player1_faction = %s AND player2_faction = %s) OR
                        (player1_faction = %s AND player2_faction = %s)
                    );
                    """, (fac1, fac1, fac1, fac2, fac2, fac1))
                    fac_row = cursor.fetchone()
                    if fac_row and fac_row.get("total_games"):
                        fac_total = int(fac_row["total_games"] or 0)
                        fac_p1_wins = int(fac_row["fac1_wins"] or 0)

                # 3. Head-to-Head History
                h2h_matches = []
                if (p1_id and p2_id) or (p1_name and p2_name):
                    cursor.execute("""
                    SELECT m.round, m.player1_name, m.player2_name, m.player1_score, m.player2_score, m.match_date, e.name as event_name
                    FROM matches m
                    LEFT JOIN events e ON m.event_id = e.id
                    WHERE is_done = TRUE AND (
                        (m.player1_name ILIKE %s AND m.player2_name ILIKE %s) OR
                        (m.player1_name ILIKE %s AND m.player2_name ILIKE %s)
                    )
                    ORDER BY m.match_date DESC LIMIT 5;
                    """, (f"%{p1_name}%", f"%{p2_name}%", f"%{p2_name}%", f"%{p1_name}%"))
                    h2h_rows = cursor.fetchall()
                    for hr in h2h_rows:
                        h2h_matches.append({
                            "event_name": hr.get("event_name") or "Tournament Match",
                            "date": hr.get("match_date").isoformat() if hr.get("match_date") else None,
                            "p1_name": hr.get("player1_name"),
                            "p2_name": hr.get("player2_name"),
                            "score": f"{hr.get('player1_score')} - {hr.get('player2_score')}"
                        })

        # Calculate Elo Win Probability: P(A) = 1 / (1 + 10^((R_B - R_A)/400))
        elo_diff = p1_elo - p2_elo
        p1_win_prob = 1.0 / (1.0 + math.pow(10.0, -elo_diff / 400.0))
        p2_win_prob = 1.0 - p1_win_prob

        # Adjust slightly for faction matchup if >10 recorded games
        if fac_total >= 10:
            fac_rate = fac_p1_wins / max(1, fac_total)
            p1_win_prob = 0.75 * p1_win_prob + 0.25 * fac_rate
            p1_win_prob = max(0.05, min(0.95, p1_win_prob))
            p2_win_prob = 1.0 - p1_win_prob

        # Expected score prediction (Base 75 pts average, +/- up to 18 pts)
        expected_diff = round((p1_win_prob - 0.5) * 36.0)
        p1_expected_score = max(40, min(100, 75 + int(expected_diff / 2)))
        p2_expected_score = max(40, min(100, 75 - int(expected_diff / 2)))

        favored = p1_name if p1_win_prob > 0.52 else (p2_name if p2_win_prob > 0.52 else "Even Matchup")

        return {
            "player1": {
                "name": p1_name,
                "faction": p1_faction,
                "elo": round(p1_elo, 1),
                "win_probability": round(p1_win_prob * 100, 1),
                "expected_score": p1_expected_score
            },
            "player2": {
                "name": p2_name,
                "faction": p2_faction,
                "elo": round(p2_elo, 1),
                "win_probability": round(p2_win_prob * 100, 1),
                "expected_score": p2_expected_score
            },
            "favored_player": favored,
            "elo_diff": round(abs(elo_diff), 1),
            "expected_differential": abs(p1_expected_score - p2_expected_score),
            "faction_matchup": {
                "total_games": fac_total,
                "p1_faction_win_pct": round((fac_p1_wins / max(1, fac_total)) * 100, 1) if fac_total > 0 else 50.0
            },
            "h2h_history": h2h_matches
        }

    class WtcDraftSavePayload(BaseModel):
        event_id: str
        round_num: int
        team_a_name: Optional[str] = "Team A"
        team_b_name: Optional[str] = "Team B"
        draft_state: Dict[str, Any]

    @app.post("/api/eventstudio/wtc_draft", summary="Save active WTC team captain pairing draft state")
    async def api_eventstudio_save_wtc_draft(payload: WtcDraftSavePayload):
        db = get_database()
        res = db.save_wtc_draft(
            event_id=payload.event_id,
            round_num=payload.round_num,
            team_a_name=payload.team_a_name or "Team A",
            team_b_name=payload.team_b_name or "Team B",
            draft_state=payload.draft_state
        )
        return res

    @app.get("/api/eventstudio/wtc_draft", summary="Get WTC team captain pairing draft state")
    async def api_eventstudio_get_wtc_draft(event_id: str, round_num: int):
        db = get_database()
        res = db.get_wtc_draft(event_id=event_id, round_num=round_num)
        return {"success": True, "event_id": event_id, "round_num": round_num, "draft": res}


    # =========================================================================
    # MULTIPLAYER REALTIME GAME TRACKER ENGINE & SUPABASE SYNC
    # =========================================================================

    TRACKER_ROOMS: Dict[str, Dict[str, Any]] = {}
    TRACKER_LISTENERS: Dict[str, List[asyncio.Queue]] = {}

    def generate_unique_match_id(db) -> str:
        """Generates a cryptographically collision-free random match ID."""
        for _ in range(20):
            token = secrets.token_hex(4).upper()
            match_id = f"WH40K-{token[:4]}-{token[4:]}"
            if match_id not in TRACKER_ROOMS and not db.get_tracker_game(match_id):
                return match_id
        return f"WH40K-{secrets.token_hex(6).upper()}"

    class TrackerCreatePayload(BaseModel):
        token: Optional[str] = None
        p1_name: Optional[str] = None
        p2_name: Optional[str] = None
        p1_faction: Optional[str] = None
        p2_faction: Optional[str] = None
        p1_detachment: Optional[str] = None
        p2_detachment: Optional[str] = None
        event_id: Optional[str] = None
        round_num: Optional[int] = None
        table_num: Optional[int] = None
        match_id: Optional[str] = None

    class TrackerJoinPayload(BaseModel):
        token: Optional[str] = None
        player_name: Optional[str] = None
        claim_role: Optional[str] = None
        faction: Optional[str] = None
        detachment: Optional[str] = None

    class TrackerActionPayload(BaseModel):
        token: Optional[str] = None
        match_id: Optional[str] = None
        state: Optional[Dict[str, Any]] = None

    class TrackerStatePayload(BaseModel):
        match_id: str
        client_id: Optional[str] = "anon"
        token: Optional[str] = None
        role: Optional[str] = "editor"
        version: int = 1
        state: Dict[str, Any]

    def normalize_tracker_match_id(raw: str) -> str:
        s = raw.strip().upper().replace(" ", "")
        if s.startswith("WH40K-") or s.startswith("BCP-"):
            return s
        s_clean = s.replace("-", "")
        if len(s_clean) == 8:
            return f"WH40K-{s_clean[:4]}-{s_clean[4:]}"
        return s

    @app.post("/api/tracker/room/create", summary="Create or connect to a multiplayer match room with host player")
    async def api_tracker_create_room(request: Request, payload: Optional[TrackerCreatePayload] = None):
        db = get_database()
        auth_mgr = get_auth_manager()
        
        auth_header = request.headers.get("Authorization", "")
        session_token = (payload.token if payload and payload.token else None) or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        
        # Check if deterministic tournament room was requested
        match_id = None
        if payload:
            if payload.match_id:
                match_id = normalize_tracker_match_id(payload.match_id)
            elif payload.event_id and payload.round_num is not None and payload.table_num is not None:
                match_id = f"BCP-{payload.event_id}-R{payload.round_num}-T{payload.table_num}".upper()
        
        # If room already exists in memory or DB, return existing state so opponent joins same room!
        if match_id:
            if match_id in TRACKER_ROOMS:
                existing = TRACKER_ROOMS[match_id]
                u_id = user["id"] if user else None
                p1_id = existing.get("user_id_p1")
                p2_id = existing.get("user_id_p2")
                
                if u_id and p1_id == u_id:
                    role = "player1"
                elif u_id and p2_id == u_id:
                    role = "player2"
                elif not p2_id and u_id != p1_id:
                    # 2nd user claims Player 2 slot
                    existing["user_id_p2"] = u_id or f"p2_{secrets.token_hex(3)}"
                    if user and user.get("display_name"):
                        if isinstance(existing.get("state"), dict) and isinstance(existing["state"].get("game"), dict):
                            existing["state"]["game"]["p2Name"] = user["display_name"]
                    role = "player2"
                    try:
                        fs_engine = get_firestore_engine()
                        fs_engine.update_room(match_id, {
                            "user_id_p2": existing["user_id_p2"],
                            "p2_name": existing.get("state", {}).get("game", {}).get("p2Name") or user.get("display_name") if user else "Player 2"
                        })
                    except Exception:
                        pass
                else:
                    role = "spectator" if (p1_id and p2_id) else "player1"

                return {
                    "success": True,
                    "match_id": match_id,
                    "role": role,
                    "user_id_p1": existing.get("user_id_p1"),
                    "user_id_p2": existing.get("user_id_p2"),
                    "p1_name": existing.get("state", {}).get("game", {}).get("p1Name") or "Player 1",
                    "p2_name": existing.get("state", {}).get("game", {}).get("p2Name") or "Player 2",
                    "state": existing.get("state", {}),
                    "chess_clock": existing.get("chess_clock")
                }
            saved_game = db.get_tracker_game(match_id)
            if saved_game and saved_game.get("state"):
                u_id = user["id"] if user else None
                p1_id = saved_game.get("user_id_p1")
                p2_id = saved_game.get("user_id_p2")
                if u_id and p1_id == u_id:
                    role = "player1"
                elif u_id and p2_id == u_id:
                    role = "player2"
                elif not p2_id and u_id != p1_id:
                    role = "player2"
                    saved_game["user_id_p2"] = u_id or f"p2_{secrets.token_hex(3)}"
                else:
                    role = "spectator" if (p1_id and p2_id) else "player1"

                TRACKER_ROOMS[match_id] = {
                    "match_id": match_id,
                    "user_id_p1": saved_game.get("user_id_p1"),
                    "user_id_p2": saved_game.get("user_id_p2"),
                    "referee_ids": saved_game.get("referee_ids", []),
                    "version": saved_game.get("version", 1),
                    "state": saved_game["state"],
                    "chess_clock": saved_game.get("chess_clock"),
                    "updated_at": saved_game.get("updated_at")
                }
                return {
                    "success": True,
                    "match_id": match_id,
                    "role": role,
                    "user_id_p1": saved_game.get("user_id_p1"),
                    "user_id_p2": saved_game.get("user_id_p2"),
                    "p1_name": saved_game.get("p1_name") or "Player 1",
                    "p2_name": saved_game.get("p2_name") or "Player 2",
                    "state": saved_game["state"],
                    "chess_clock": saved_game.get("chess_clock")
                }
        else:
            match_id = generate_unique_match_id(db)

        user_id_p1 = user["id"] if user else None
        p1_name = (user.get("display_name") if user else None) or (payload.p1_name if payload else None) or "Player 1"
        p2_name = (payload.p2_name if payload and payload.p2_name else "Player 2")
        p1_fac = (payload.p1_faction if payload else None)
        p2_fac = (payload.p2_faction if payload else None)
        p1_det = [payload.p1_detachment] if (payload and payload.p1_detachment) else []
        p2_det = [payload.p2_detachment] if (payload and payload.p2_detachment) else []
        
        initial_state = {
            "id": f"g-{secrets.token_hex(4)}-{secrets.token_hex(3)}",
            "match_id": match_id,
            "event_id": payload.event_id if payload else None,
            "round_num": payload.round_num if payload else 1,
            "table_num": payload.table_num if payload else None,
            "user_id_p1": user_id_p1,
            "user_id_p2": None,
            "game": {
                "p1Name": p1_name,
                "p2Name": p2_name,
                "p1Faction": p1_fac,
                "p2Faction": p2_fac,
                "p1Detachments": p1_det,
                "p2Detachments": p2_det,
                "p1Disposition": None,
                "p2Disposition": None,
                "p1Primary": None,
                "p2Primary": None,
                "p1Role": None,
                "p2Role": None,
                "p1MissionType": None,
                "p2MissionType": None,
                "rollOffWinner": None,
                "firstTurn": None,
                "deployment": None,
                "terrainLayout": None,
                "trackCP": True,
                "showCP": True,
                "enableCP": True,
                "cpCounter": True,
                "cp": True,
                "eventId": payload.event_id if payload else None,
                "roundNum": payload.round_num if payload else 1,
                "tableNum": payload.table_num if payload else None
            },
            "p1": {
                "score": 0,
                "rounds": [
                    {"round": i, "battleRound": i, "primaryScore": 0, "secondaryScore": 0, "secondaries": []}
                    for i in range(1, 6)
                ],
                "battleReady": True,
                "cp": 0
            },
            "p2": {
                "score": 0,
                "rounds": [
                    {"round": i, "battleRound": i, "primaryScore": 0, "secondaryScore": 0, "secondaries": []}
                    for i in range(1, 6)
                ],
                "battleReady": True,
                "cp": 0
            },
            "round": 1,
            "started": False,
            "trackCP": True,
            "showCP": True,
            "enableCP": True,
            "cpCounter": True
        }
        
        TRACKER_ROOMS[match_id] = {
            "match_id": match_id,
            "user_id_p1": user_id_p1,
            "user_id_p2": None,
            "referee_ids": [],
            "version": 1,
            "state": initial_state,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        
        # Persist hot ephemeral room to Cloud Firestore Native
        try:
            fs_engine = get_firestore_engine()
            fs_engine.create_room(match_id, {
                "user_id_p1": user_id_p1,
                "user_id_p2": None,
                "referee_ids": [],
                "version": 1,
                "p1_name": p1_name,
                "p2_name": p2_name,
                "state": initial_state,
                "participants": {
                    "player1": {"uid": user_id_p1, "name": p1_name, "faction": p1_fac, "detachment": p1_det},
                    "player2": {"uid": None, "name": p2_name, "faction": p2_fac, "detachment": p2_det}
                },
                "clock": {
                    "activePlayer": "player1",
                    "player1RemainingMs": 4500000,
                    "player2RemainingMs": 4500000,
                    "lastSwitchTimestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
                    "isPaused": True
                }
            })
            logger.info(f"🔥 [CREATE ROOM] Created Firestore document rooms/{match_id}")
        except Exception as err:
            logger.error(f"❌ [CREATE ROOM] Firestore save error for {match_id}: {err}", exc_info=True)
            
        return {
            "success": True,
            "match_id": match_id,
            "role": "player1",
            "user_id_p1": user_id_p1,
            "p1_name": p1_name,
            "p2_name": p2_name,
            "state": initial_state
        }

    @app.get("/api/tracker/firestore/rooms/{match_id}", summary="Diagnostics: Verify and inspect raw document from Cloud Firestore")
    async def api_tracker_firestore_inspect(match_id: str):
        match_id = normalize_tracker_match_id(match_id)
        fs = get_firestore_engine()
        doc = fs.get_room(match_id)
        return {
            "match_id": match_id,
            "exists_in_firestore": doc is not None,
            "firestore_connected": fs.is_connected,
            "firestore_document": doc
        }

    @app.get("/api/tracker/room/{match_id}/check", summary="Check if room exists and check player slots")
    async def api_tracker_check_room(match_id: str, request: Request):
        match_id = normalize_tracker_match_id(match_id)
            
        db = get_database()
        fs_engine = get_firestore_engine()
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None
        
        if match_id in TRACKER_ROOMS:
            room = TRACKER_ROOMS[match_id]
        else:
            fs_doc = fs_engine.get_room(match_id)
            if fs_doc and fs_doc.get("state"):
                room = {
                    "match_id": match_id,
                    "user_id_p1": fs_doc.get("user_id_p1"),
                    "user_id_p2": fs_doc.get("user_id_p2"),
                    "p1_name": fs_doc.get("p1_name"),
                    "p2_name": fs_doc.get("p2_name"),
                    "version": fs_doc.get("version", 1),
                    "state": fs_doc["state"]
                }
                TRACKER_ROOMS[match_id] = room
            else:
                saved = db.get_tracker_game(match_id)
                if saved and saved.get("state"):
                    is_fin = bool(saved.get("is_finished") or (isinstance(saved.get("state"), dict) and saved["state"].get("is_finished")))
                    room = {
                        "match_id": match_id,
                        "user_id_p1": saved.get("user_id_p1"),
                        "user_id_p2": saved.get("user_id_p2"),
                        "p1_name": saved.get("p1_name"),
                        "p2_name": saved.get("p2_name"),
                        "version": saved.get("version", 1),
                        "state": saved["state"],
                        "is_finished": is_fin,
                        "readonly": is_fin
                    }
                    if not is_fin:
                        TRACKER_ROOMS[match_id] = room
                        try:
                            fs_engine.create_room(match_id, room)
                        except Exception:
                            pass
                else:
                    return {"exists": False, "match_id": match_id, "error": f"Room key '{match_id}' does not exist."}
                
        p1_id = room.get("user_id_p1")
        p2_id = room.get("user_id_p2")
        is_p1 = bool(user_id and p1_id == user_id)
        is_p2 = bool(user_id and p2_id == user_id)
        is_finished = bool(room.get("is_finished") or (isinstance(room.get("state"), dict) and room["state"].get("is_finished")))
        
        return {
            "exists": True,
            "match_id": match_id,
            "p1_name": room.get("state", {}).get("game", {}).get("p1Name") or "Player 1",
            "p2_name": room.get("state", {}).get("game", {}).get("p2Name") or "Player 2",
            "is_full": bool(is_finished or (p1_id is not None and p2_id is not None and not is_p1 and not is_p2)),
            "is_open_for_p2": bool(not is_finished and p2_id is None and not is_p1),
            "is_finished": is_finished,
            "scorecard_url": f"/scorecard/{match_id}"
        }

    @app.post("/api/tracker/room/{match_id}/join", summary="Join match room and claim Player 2 slot or Spectator")
    async def api_tracker_join_room(match_id: str, request: Request, payload: Optional[TrackerJoinPayload] = None):
        match_id = normalize_tracker_match_id(match_id)
        db = get_database()
        fs_engine = get_firestore_engine()
        auth_mgr = get_auth_manager()
        
        auth_header = request.headers.get("Authorization", "")
        session_token = (payload.token if payload and payload.token else None) or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None
        user_name = user.get("display_name") if user else None
        
        if match_id not in TRACKER_ROOMS:
            fs_doc = fs_engine.get_room(match_id)
            if fs_doc and fs_doc.get("state"):
                TRACKER_ROOMS[match_id] = {
                    "match_id": match_id,
                    "user_id_p1": fs_doc.get("user_id_p1"),
                    "user_id_p2": fs_doc.get("user_id_p2"),
                    "referee_ids": fs_doc.get("referee_ids", []),
                    "version": fs_doc.get("version", 1),
                    "state": fs_doc["state"],
                    "updated_at": fs_doc.get("updated_at")
                }
            else:
                saved = db.get_tracker_game(match_id)
                if saved and saved.get("state"):
                    is_fin = bool(saved.get("is_finished") or (isinstance(saved.get("state"), dict) and saved["state"].get("is_finished")))
                    if is_fin:
                        return {
                            "success": True,
                            "match_id": match_id,
                            "role": "spectator",
                            "is_finished": True,
                            "scorecard_url": f"/scorecard/{match_id}",
                            "state": saved["state"]
                        }
                    TRACKER_ROOMS[match_id] = {
                        "match_id": match_id,
                        "user_id_p1": saved.get("user_id_p1"),
                        "user_id_p2": saved.get("user_id_p2"),
                        "referee_ids": saved.get("referee_ids", []),
                        "version": saved.get("version", 1),
                        "state": saved["state"],
                        "updated_at": saved.get("updated_at")
                    }
                    try:
                        fs_engine.create_room(match_id, TRACKER_ROOMS[match_id])
                    except Exception:
                        pass
                else:
                    raise HTTPException(status_code=404, detail="Match room not found")
                
        room = TRACKER_ROOMS[match_id]
        st = room.get("state", {})
        game = st.get("game", {})
        
        # Determine Role with Tournament Participant Validation:
        p1_assigned_name = (game.get("p1Name") or "").strip().lower()
        p2_assigned_name = (game.get("p2Name") or "").strip().lower()
        # Determine candidate Player 2 identity from payload / user session
        incoming_name = (payload.player_name if payload and payload.player_name else None) or (user.get("display_name") if user else None) or (user.get("email", "").split("@")[0] if user else None)
        u_name = (incoming_name or "").strip().lower()
        is_tournament_match = match_id.startswith("BCP-") or bool(st.get("event_id"))
        is_p1_owner = bool(user_id and room.get("user_id_p1") and room.get("user_id_p1") == user_id)

        # 1. Check if user is already registered Player 1 owner
        if is_p1_owner and (not payload or payload.claim_role != "player2"):
            role = "player1"
        # 2. Check if user is already registered Player 2 owner
        elif user_id and room.get("user_id_p2") == user_id:
            role = "player2"
            if incoming_name and incoming_name != "Player 2" and incoming_name != game.get("p1Name"):
                game["p2Name"] = incoming_name
        # 3. Check if explicit Player 2 claim or open Player 2 slot
        elif (payload and payload.claim_role == "player2") or (not room.get("user_id_p2") and not is_p1_owner) or (not room.get("user_id_p2") and not is_tournament_match):
            room["user_id_p2"] = user_id or f"p2_{secrets.token_hex(3)}"
            if incoming_name and incoming_name != "Player 2" and incoming_name != game.get("p1Name"):
                game["p2Name"] = incoming_name
            if payload and payload.faction and not game.get("p2Faction"):
                game["p2Faction"] = payload.faction
            role = "player2"
            room["version"] += 1
            
            # Sync to Firestore Native
            try:
                fs_engine.update_room(match_id, {
                    "user_id_p2": room["user_id_p2"],
                    "p2_name": game.get("p2Name", "Player 2"),
                    "state": st,
                    "version": room["version"],
                    "participants": {
                        "player2": {
                            "uid": room["user_id_p2"],
                            "name": game.get("p2Name", "Player 2"),
                            "faction": game.get("p2Faction"),
                            "detachment": game.get("p2Detachment")
                        }
                    }
                })
            except Exception:
                pass
            
            # Broadcast P2 connection to opponent
            listeners = TRACKER_LISTENERS.get(match_id, [])
            msg = {
                "type": "state_update",
                "sender": "server",
                "version": room["version"],
                "state": st
            }
            for q in list(listeners):
                try:
                    await q.put(msg)
                except Exception:
                    pass
        elif (user_id and user_id in room.get("referee_ids", [])) or (user and user.get("role") in ("admin", "referee", "to")):
            role = "referee"
        else:
            role = "spectator"
            
        return {
            "success": True,
            "match_id": match_id,
            "role": role,
            "user_id": user_id,
            "user_name": user_name,
            "user_id_p1": room.get("user_id_p1"),
            "user_id_p2": room.get("user_id_p2"),
            "state": st,
            "chess_clock": room.get("chess_clock")
        }

    @app.post("/api/tracker/room/{match_id}/state", summary="Broadcast and persist multiplayer tracker state with role enforcement")
    async def api_tracker_save_state(match_id: str, payload: TrackerStatePayload, request: Request):
        match_id = normalize_tracker_match_id(match_id)
        fs_engine = get_firestore_engine()
        auth_mgr = get_auth_manager()
        db = get_database()
        
        # Hard Guard: If match is already concluded in PostgreSQL, reject state write and NEVER re-create Firestore room!
        saved_rec = db.get_tracker_game(match_id)
        if saved_rec and (saved_rec.get("is_finished") or (isinstance(saved_rec.get("state_json"), dict) and saved_rec["state_json"].get("is_finished"))):
            return {
                "success": False,
                "is_finished": True,
                "status": "finalized",
                "scorecard_url": f"/scorecard/{match_id}",
                "message": "Match has concluded and is locked."
            }
        
        auth_header = request.headers.get("Authorization", "")
        session_token = (payload.token if payload and payload.token else None) or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None
        
        if match_id not in TRACKER_ROOMS:
            fs_doc = fs_engine.get_room(match_id)
            if fs_doc and fs_doc.get("state"):
                if fs_doc.get("status") == "completed" or fs_doc.get("is_finished"):
                    return {
                        "success": False,
                        "is_finished": True,
                        "status": "finalized",
                        "scorecard_url": f"/scorecard/{match_id}",
                        "message": "Match has concluded."
                    }
                TRACKER_ROOMS[match_id] = {
                    "match_id": match_id,
                    "user_id_p1": fs_doc.get("user_id_p1"),
                    "user_id_p2": fs_doc.get("user_id_p2"),
                    "referee_ids": fs_doc.get("referee_ids", []),
                    "version": fs_doc.get("version", 1),
                    "state": fs_doc["state"],
                    "chess_clock": fs_doc.get("chess_clock"),
                    "updated_at": fs_doc.get("updated_at")
                }
            else:
                TRACKER_ROOMS[match_id] = {
                    "match_id": match_id,
                    "user_id_p1": user_id,
                    "user_id_p2": None,
                    "referee_ids": [],
                    "version": 0,
                    "state": {},
                    "chess_clock": None,
                    "created_at": datetime.now(timezone.utc).isoformat()
                }
        
        room = TRACKER_ROOMS[match_id]
        
        # Strict Permission Verification:
        is_p1 = bool(user_id and room.get("user_id_p1") == user_id)
        is_p2 = bool(user_id and room.get("user_id_p2") == user_id)
        is_ref = bool(user and (user_id in room.get("referee_ids", []) or user.get("role") in ("admin", "referee", "to")))
        is_tournament = match_id.startswith("BCP-") or bool(room.get("state", {}).get("event_id"))
        
        if is_tournament:
            if not (is_p1 or is_p2 or is_ref):
                raise HTTPException(status_code=403, detail="Permission denied: Only matched competitors or tournament organizers can edit this tournament match.")
        else:
            if room.get("user_id_p1") or room.get("user_id_p2"):
                if not (is_p1 or is_p2 or is_ref or payload.role in ("player1", "player2", "referee", "editor")):
                    raise HTTPException(status_code=403, detail="Permission denied: Spectators cannot modify match state")
        
        room["state"] = payload.state
        room["version"] = payload.version
        room["updated_at"] = datetime.now(timezone.utc).isoformat()
        
        # If user_id_p1 or user_id_p2 in state, retain them
        if payload.state.get("user_id_p1"):
            room["user_id_p1"] = payload.state["user_id_p1"]
        if payload.state.get("user_id_p2"):
            room["user_id_p2"] = payload.state["user_id_p2"]

        # Hot storage update in Cloud Firestore Native (ZERO PostgreSQL write)
        try:
            fs_engine.update_room(match_id, {
                "state": payload.state,
                "version": payload.version,
                "user_id_p1": room.get("user_id_p1"),
                "user_id_p2": room.get("user_id_p2"),
                "game": payload.state.get("game", {})
            })
        except Exception as fs_err:
            logger.debug(f"Firestore update notice: {fs_err}")

        # Broadcast to all connected SSE clients in this room
        listeners = TRACKER_LISTENERS.get(match_id, [])
        msg = {
            "type": "state_update",
            "sender": payload.client_id,
            "version": payload.version,
            "state": payload.state
        }
        for q in listeners:
            await q.put(msg)

        return {"success": True, "match_id": match_id, "version": payload.version}

    @app.get("/api/tracker/room/{match_id}", summary="Get current match room state")
    async def api_tracker_get_state(match_id: str):
        match_id = normalize_tracker_match_id(match_id)
        fs_engine = get_firestore_engine()
        db = get_database()
        
        # Fetch from Firestore / Memory
        fs_doc = fs_engine.get_room(match_id)
        if fs_doc and fs_doc.get("state"):
            TRACKER_ROOMS[match_id] = {
                "match_id": match_id,
                "user_id_p1": fs_doc.get("user_id_p1"),
                "user_id_p2": fs_doc.get("user_id_p2"),
                "referee_ids": fs_doc.get("referee_ids", []),
                "version": fs_doc.get("version", 1),
                "state": fs_doc["state"],
                "chess_clock": fs_doc.get("chess_clock"),
                "updated_at": fs_doc.get("updated_at")
            }
        try:
            saved = db.get_tracker_game(match_id)
        except Exception:
            pass

        online_count = max(1, len(TRACKER_LISTENERS.get(match_id, [])))
        if saved and saved.get("state"):
            if match_id not in TRACKER_ROOMS or (saved.get("version", 1) >= TRACKER_ROOMS[match_id].get("version", 0)):
                TRACKER_ROOMS[match_id] = {
                    "match_id": match_id,
                    "user_id_p1": saved.get("user_id_p1"),
                    "user_id_p2": saved.get("user_id_p2"),
                    "referee_ids": saved.get("referee_ids", []),
                    "version": saved.get("version", 1),
                    "state": saved["state"],
                    "chess_clock": saved.get("chess_clock"),
                    "updated_at": saved.get("updated_at")
                }
            res = dict(TRACKER_ROOMS[match_id])
            res["online_count"] = online_count
            res["chess_clock"] = TRACKER_ROOMS[match_id].get("chess_clock")
            return res

        if match_id in TRACKER_ROOMS and TRACKER_ROOMS[match_id].get("state"):
            res = dict(TRACKER_ROOMS[match_id])
            res["online_count"] = online_count
            res["chess_clock"] = TRACKER_ROOMS[match_id].get("chess_clock")
            return res

        return {"match_id": match_id, "version": 0, "online_count": online_count, "state": {}, "chess_clock": None}

    def _format_firestore_session_item(doc: Dict[str, Any]) -> Dict[str, Any]:
        st = doc.get("state", {}) if isinstance(doc.get("state"), dict) else {}
        game = st.get("game", {}) if isinstance(st.get("game"), dict) else {}
        p1 = st.get("p1", {}) if isinstance(st.get("p1"), dict) else {}
        p2 = st.get("p2", {}) if isinstance(st.get("p2"), dict) else {}
        
        match_id = doc.get("roomKey") or doc.get("matchId") or st.get("match_id") or ""
        p1_name = doc.get("p1_name") or game.get("p1Name") or "Player 1"
        p2_name = doc.get("p2_name") or game.get("p2Name") or "Player 2"
        p1_score = p1.get("score", 0) if isinstance(p1, dict) else 0
        p2_score = p2.get("score", 0) if isinstance(p2, dict) else 0
        p1_faction = game.get("p1Faction")
        p2_faction = game.get("p2Faction")
        primary_mission = game.get("p1Primary") or game.get("primary")
        current_round = st.get("round", 1) if isinstance(st, dict) else 1
        
        updated_ts = doc.get("updatedAt") or doc.get("updated_at") or int(datetime.now(timezone.utc).timestamp() * 1000)
        created_ts = doc.get("createdAt") or doc.get("created_at") or updated_ts
        expires_ts = doc.get("expiresAt") or (created_ts + (14 * 24 * 60 * 60 * 1000))
        
        date_str = datetime.fromtimestamp(updated_ts / 1000, tz=timezone.utc).strftime("%b %d, %Y %H:%M")
        
        return {
            "id": match_id,
            "match_id": match_id,
            "p1_name": p1_name,
            "p2_name": p2_name,
            "p1_score": p1_score,
            "p2_score": p2_score,
            "p1Score": p1_score,
            "p2Score": p2_score,
            "p1_faction": p1_faction,
            "p2_faction": p2_faction,
            "primary_mission": primary_mission,
            "current_round": current_round,
            "round": current_round,
            "is_finished": False,
            "isFinished": False,
            "is_abandoned": bool(doc.get("status") == "abandoned" or doc.get("is_abandoned")),
            "created_at": created_ts,
            "updated_at": updated_ts,
            "expires_at": expires_ts,
            "date": date_str,
            "state": st,
            "game": game,
            "version": doc.get("version", 1)
        }

    @app.get("/api/tracker/history", summary="Get persistent history of tracker games")
    async def api_tracker_history(request: Request, limit: int = 50, search: Optional[str] = None, token: Optional[str] = Query(None)):
        try:
            auth_mgr = get_auth_manager()
            auth_header = request.headers.get("Authorization", "")
            session_token = token or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
            user = auth_mgr.get_session(session_token) if session_token else None
            user_id = user["id"] if user else None
            user_name = user["display_name"] if user else None
            
            fs_engine = get_firestore_engine()
            active_docs = fs_engine.list_active_rooms_for_user(user_id=user_id, user_name=user_name, limit=limit)
            active_sessions = [_format_firestore_session_item(d) for d in active_docs if not d.get("is_abandoned")]
            
            db = get_database()
            completed = db.get_tracker_history(limit=limit, search=search, user_id=user_id, user_name=user_name)
            seen = {a["match_id"] for a in active_sessions}
            filtered_completed = [c for c in completed if c.get("match_id") not in seen]
            
            all_history = active_sessions + filtered_completed
            return {"success": True, "history": all_history}
        except Exception as err:
            logger.error(f"Error fetching tracker history: {err}")
            return {"success": False, "history": []}

    @app.get("/api/tracker/sessions", summary="Get user's 3-tier active slot management (primary active, unfinished, completed)")
    async def api_tracker_user_sessions(
        request: Request,
        token: Optional[str] = Query(None)
    ):
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = token or (auth_header[7:] if auth_header.startswith("Bearer ") else None) or request.cookies.get("session_token")
        user = auth_mgr.get_session(session_token) if session_token else None
        
        user_id = user["id"] if user else None
        user_name = user.get("display_name") if user else None
        
        fs_engine = get_firestore_engine()
        db = get_database()
        active_docs = fs_engine.list_active_rooms_for_user(user_id=user_id, user_name=user_name)
        
        seen_matches = set()
        active_sessions = []
        for doc in active_docs:
            mid = (doc.get("roomKey") or doc.get("matchId") or (doc.get("state", {}).get("match_id") if isinstance(doc.get("state"), dict) else "") or "").strip().upper()
            if mid and mid not in seen_matches:
                # Cross-check with PostgreSQL: If already concluded/finished, purge ghost room and NEVER list as active!
                saved = db.get_tracker_game(mid)
                if saved and (saved.get("is_finished") or (isinstance(saved.get("state_json"), dict) and saved["state_json"].get("is_finished"))):
                    try:
                        fs_engine.discard_room(mid)
                    except Exception:
                        pass
                    if mid in TRACKER_ROOMS:
                        try:
                            del TRACKER_ROOMS[mid]
                        except KeyError:
                            pass
                    continue

                seen_matches.add(mid)
                formatted = _format_firestore_session_item(doc)
                if not formatted["is_abandoned"]:
                    active_sessions.append(formatted)
                    
        primary_active = active_sessions[0] if active_sessions else None
        primary_mid = (primary_active.get("match_id") or primary_active.get("id") or "").strip().upper() if primary_active else ""
        unfinished_sessions = [s for s in active_sessions[1:] if (s.get("match_id") or s.get("id") or "").strip().upper() != primary_mid]
        
        db = get_database()
        completed_history = []
        try:
            completed_history = db.get_tracker_history(limit=50, user_id=user_id, user_name=user_name)
            completed_history = [g for g in completed_history if g.get("is_finished", True) and (g.get("match_id") or "").strip().upper() not in seen_matches]
        except Exception as err:
            logger.debug(f"History fetch notice: {err}")
            
        return {
            "success": True,
            "active_sessions": active_sessions,
            "completed_history": completed_history,
            "primary_active": primary_active,
            "unfinished_sessions": [],
            "total_games": len(completed_history) + len(active_sessions)
        }

    @app.post("/api/tracker/room/{match_id}/discard", summary="Discard / abandon a casual test session with zero Elo penalty")
    async def api_tracker_discard_game(match_id: str, request: Request, payload: Optional[TrackerActionPayload] = None):
        match_id = normalize_tracker_match_id(match_id)
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = (payload.token if payload else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None) or request.cookies.get("session_token")
        user = auth_mgr.get_session(session_token) if session_token else None
        
        # 1. Verify this is NOT a completed / permanent match record
        db = get_database()
        try:
            existing_game = db.get_tracker_game(match_id)
            if existing_game and existing_game.get("is_finished"):
                raise HTTPException(
                    status_code=400,
                    detail="Permanent record: Completed games cannot be discarded or deleted."
                )
        except HTTPException:
            raise
        except Exception:
            pass

        fs_engine = get_firestore_engine()
        room_doc = fs_engine.get_room(match_id) or TRACKER_ROOMS.get(match_id)
        
        # Verify authorization: ONLY the 2 registered players (Player 1 or Player 2) or admin can delete
        if room_doc:
            p1_id = room_doc.get("user_id_p1") or (room_doc.get("participants", {}).get("player1", {}).get("uid") if isinstance(room_doc.get("participants"), dict) else None)
            p2_id = room_doc.get("user_id_p2") or (room_doc.get("participants", {}).get("player2", {}).get("uid") if isinstance(room_doc.get("participants"), dict) else None)
            p1_name = (room_doc.get("p1_name") or (room_doc.get("state", {}).get("game", {}).get("p1Name") if isinstance(room_doc.get("state"), dict) else "") or "").strip().lower()
            p2_name = (room_doc.get("p2_name") or (room_doc.get("state", {}).get("game", {}).get("p2Name") if isinstance(room_doc.get("state"), dict) else "") or "").strip().lower()
            
            is_authorized = False
            if user:
                uid = user.get("id")
                uname = (user.get("display_name") or user.get("name") or "").strip().lower()
                is_admin = user.get("role") in ("admin", "superuser", "to", "referee")
                if is_admin:
                    is_authorized = True
                elif uid and (uid == p1_id or uid == p2_id):
                    is_authorized = True
                elif uname and (uname == p1_name or uname == p2_name):
                    is_authorized = True
            elif not p1_id and not p2_id:
                # Anonymous unassigned session
                is_authorized = True
                
            if not is_authorized:
                raise HTTPException(
                    status_code=403,
                    detail="Forbidden: Only registered players in this match can delete or discard this game."
                )
        
        # 2. Update Firestore Native (Delete room from active collection)
        fs_engine.discard_room(match_id)
        
        # 3. Update memory cache
        if match_id in TRACKER_ROOMS:
            try:
                del TRACKER_ROOMS[match_id]
            except KeyError:
                pass
            
        # 4. If in PostgreSQL, hide uncompleted draft
        if user:
            try:
                db.hide_tracker_game_for_user(match_id, user["id"])
            except Exception:
                pass
                
        return {"success": True, "match_id": match_id, "status": "abandoned"}

    @app.post("/api/tracker/room/{match_id}/finalize", summary="Finalize and lock match scorecard and compute Elo")
    async def api_tracker_finalize_game(match_id: str, request: Request, payload: Optional[TrackerActionPayload] = None):
        match_id = normalize_tracker_match_id(match_id)
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = (payload.token if payload else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None) or request.cookies.get("session_token")
        user = auth_mgr.get_session(session_token) if session_token else None
        
        fs_engine = get_firestore_engine()
        db = get_database()
        room = TRACKER_ROOMS.get(match_id) or fs_engine.get_room(match_id) or {}
        state = (payload.state if payload and payload.state else None) or room.get("state") or {}
        
        if isinstance(state, dict):
            state["is_finished"] = True
            state["started"] = True
            state["round"] = 5
            
        p1_id = room.get("user_id_p1") or (user["id"] if user else None)
        p2_id = room.get("user_id_p2")

        # 1. Update PostgreSQL permanently
        try:
            db.save_tracker_game(match_id, state, user_id_p1=p1_id, user_id_p2=p2_id)
        except Exception as e:
            logger.warning(f"Notice saving finalized game to DB: {e}")

        # 2. Broadcast conclusion to connected SSE listeners (Player 2, Spectators)
        listeners = TRACKER_LISTENERS.get(match_id, [])
        finalize_msg = {
            "type": "match_finalized",
            "match_id": match_id,
            "scorecard_url": f"/scorecard/{urllib.parse.quote(match_id)}",
            "status": "completed",
            "is_finished": True
        }
        for q in list(listeners):
            try:
                await q.put(finalize_msg)
            except Exception:
                pass

        # 3. Delete / remove from Cloud Firestore (active session is concluded!)
        try:
            fs_engine.discard_room(match_id)
        except Exception as e:
            logger.warning(f"Notice discarding Firestore room on conclusion {match_id}: {e}")

        # 4. Clean up Memory Cache
        if match_id in TRACKER_ROOMS:
            try:
                del TRACKER_ROOMS[match_id]
            except KeyError:
                pass
            
        return {
            "success": True,
            "match_id": match_id,
            "status": "completed",
            "scorecard_url": f"/scorecard/{urllib.parse.quote(match_id)}"
        }

    @app.post("/api/tracker/room/{match_id}/hide", summary="Soft-delete/hide a game from the user's personal history")
    async def api_tracker_hide_game(match_id: str, request: Request, payload: Optional[TrackerActionPayload] = None):
        match_id = normalize_tracker_match_id(match_id)
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = (payload.token if payload else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        if not user:
            raise HTTPException(status_code=401, detail="Authentication required to hide game")
        
        db = get_database()
        success = db.hide_tracker_game_for_user(match_id, user["id"])
        return {"success": success, "match_id": match_id, "hidden_for_user": user["id"]}

    @app.post("/api/tracker/room/{match_id}/unhide", summary="Unhide a game in the user's personal history")
    async def api_tracker_unhide_game(match_id: str, request: Request, payload: Optional[TrackerActionPayload] = None):
        match_id = normalize_tracker_match_id(match_id)
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = (payload.token if payload else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        if not user:
            raise HTTPException(status_code=401, detail="Authentication required to unhide game")
        
        db = get_database()
        success = db.unhide_tracker_game_for_user(match_id, user["id"])
        return {"success": success, "match_id": match_id, "unhidden_for_user": user["id"]}

    @app.get("/api/scorecard/{match_id}", summary="Get verified tournament digital scorecard data")
    async def api_get_scorecard(match_id: str):
        match_id = normalize_tracker_match_id(match_id)
        db = get_database()
        
        room = TRACKER_ROOMS.get(match_id)
        state = room.get("state") if room else None
        
        if not state:
            try:
                fs_engine = get_firestore_engine()
                fs_room = fs_engine.get_room(match_id)
                if fs_room and fs_room.get("state"):
                    state = fs_room.get("state")
            except Exception:
                pass
                
        game_rec = db.get_tracker_game(match_id)
        if not state and game_rec:
            state = game_rec.get("state_json") or game_rec
            
        if not state and not game_rec:
            raise HTTPException(status_code=404, detail="Scorecard not found for this match ID")
            
        return {
            "success": True,
            "match_id": match_id,
            "game_record": game_rec,
            "state": state
        }

    @app.get("/scorecard/{match_id}", summary="View digital scorecard page")
    async def view_scorecard_page(match_id: str):
        scorecard_file = web_dir / "scorecard.html"
        if scorecard_file.exists():
            return FileResponse(scorecard_file)
        return RedirectResponse(f"/?scorecard={match_id}")


    @app.get("/api/tracker/debug/test_save", summary="Diagnostics endpoint to test DB writes to tracker_games")
    async def api_tracker_debug_test_save():
        import traceback
        db = get_database()
        
        # 1. Force ensure all schema columns exist
        migration_log = []
        try:
            db.ensure_tracker_table()
            migration_log.append("ensure_tracker_table executed successfully")
        except Exception as me:
            migration_log.append(f"ensure_tracker_table error: {me}")

        test_id = f"WH40K-TEST-{secrets.token_hex(2).upper()}"
        test_state = {
            "id": "g-test",
            "match_id": test_id,
            "game": {"p1Name": "Tester 1", "p2Name": "Tester 2"},
            "p1": {"score": 0},
            "p2": {"score": 0},
            "round": 1
        }
        save_err = None
        load_err = None
        hist_err = None
        res = False
        loaded = None
        history = []
        try:
            res = db.save_tracker_game(test_id, test_state, version=1, user_id_p1="test_u1")
        except Exception as e:
            save_err = f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}"

        try:
            loaded = db.get_tracker_game(test_id)
        except Exception as e:
            load_err = f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}"

        try:
            history = db.get_tracker_history(limit=5)
        except Exception as e:
            hist_err = f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}"

        # Inspect table columns
        columns_info = []
        try:
            with db.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tracker_games';")
                    columns_info = [f"{r[0]} ({r[1]})" for r in cursor.fetchall()]
        except Exception as e:
            columns_info = [f"Error fetching columns: {e}"]

        return {
            "test_match_id": test_id,
            "migration_log": migration_log,
            "saved_success": res,
            "save_error": save_err,
            "loaded_from_db": loaded,
            "load_error": load_err,
            "recent_history_count": len(history),
            "history_error": hist_err,
            "table_columns": columns_info
        }

    # ==========================================
    # ARMY LISTS & WAHAPEDIA DATASHEET ENDPOINTS
    # ==========================================

    @app.post("/api/armylists/parse", summary="Parse and enrich army list from text or JSON")
    async def api_parse_armylist(req: Request):
        try:
            body = await req.json()
        except Exception:
            body = {}
        raw_text = body.get("text") or body.get("raw_text") or ""
        source_format = body.get("format")
        parser = get_army_parser()
        parsed = parser.parse(raw_text, source_hint=source_format)
        return {"success": True, "army_list": parsed}

    @app.post("/api/armylists/upload", summary="Upload and parse army list file (.json, .ros, .rosz, .txt)")
    async def api_upload_armylist(request: Request):
        content_type = request.headers.get("content-type", "")
        filename = request.headers.get("x-filename", "")
        file_bytes = b""

        if "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
            try:
                form = await request.form()
                file_obj = form.get("file")
                if file_obj and hasattr(file_obj, "read"):
                    file_bytes = await file_obj.read()
                    filename = getattr(file_obj, "filename", "") or filename
                elif file_obj:
                    file_bytes = file_obj.encode("utf-8") if isinstance(file_obj, str) else bytes(file_obj)
            except Exception as e:
                logger.warning(f"Form parse error: {e}")
                file_bytes = await request.body()
        else:
            file_bytes = await request.body()
            
        if not file_bytes:
            raise HTTPException(status_code=400, detail="Empty file payload")
        
        parser = get_army_parser()
        parsed = parser.parse_file(file_bytes, filename=filename)
        return {"success": True, "army_list": parsed}

    @app.get("/api/armylists", summary="Get saved army lists for current user")
    async def api_get_armylists(request: Request):
        auth_mgr = get_auth_manager()
        session_token = request.cookies.get("session_token")
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            session_token = auth_header.split(" ", 1)[1]
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None

        db = get_database()
        lists = db.get_user_army_lists(user_id=user_id)
        return {"success": True, "army_lists": lists}

    @app.post("/api/armylists", summary="Save or create user army list")
    async def api_save_armylist(request: Request):
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")
        
        auth_mgr = get_auth_manager()
        session_token = request.cookies.get("session_token")
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            session_token = auth_header.split(" ", 1)[1]
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None

        db = get_database()
        saved = db.save_user_army_list(user_id=user_id, list_data=body)
        return {"success": True, "army_list": saved}

    @app.get("/api/armylists/{list_id}", summary="Get single army list by ID")
    async def api_get_armylist(list_id: str, request: Request):
        auth_mgr = get_auth_manager()
        session_token = request.cookies.get("session_token")
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            session_token = auth_header.split(" ", 1)[1]
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None

        db = get_database()
        item = db.get_user_army_list(list_id, user_id=user_id)
        if not item:
            raise HTTPException(status_code=404, detail="Army list not found")
        return {"success": True, "army_list": item}

    # =========================================================================
    # WAHAPEDIA 11TH EDITION REFERENCE & SYNC ENDPOINTS
    # =========================================================================

    @app.get("/api/wahapedia/status", summary="Get Wahapedia 11th Edition sync status & stats")
    async def api_wahapedia_status():
        db = get_database()
        return db.waha_get_sync_status()

    @app.post("/api/wahapedia/sync", summary="Trigger sync of Wahapedia 11th edition datasets into PostgreSQL")
    async def api_wahapedia_sync(force: bool = Query(False)):
        from wahapedia_sync import sync_wahapedia_job
        try:
            res = await asyncio.to_thread(sync_wahapedia_job, force=force)
            return res
        except Exception as e:
            logger.error(f"Error in api_wahapedia_sync: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    @app.get("/api/wahapedia/stratagems", summary="Get detachment and core stratagems from Wahapedia")
    async def api_wahapedia_stratagems(detachment: str = Query(...), faction: Optional[str] = Query(None)):
        db = get_database()
        return {"detachment": detachment, "stratagems": db.waha_get_stratagems(detachment, faction_id=faction)}

    @app.get("/api/wahapedia/enhancements", summary="Get detachment enhancements from Wahapedia")
    async def api_wahapedia_enhancements(detachment: str = Query(...)):
        db = get_database()
        return {"detachment": detachment, "enhancements": db.waha_get_enhancements(detachment)}

    @app.get("/api/wahapedia/unit", summary="Find unit datasheet and statlines from Wahapedia")
    async def api_wahapedia_unit(name: str = Query(...), faction: Optional[str] = Query(None)):
        db = get_database()
        unit = db.waha_find_unit(name, faction_name=faction)
        if not unit:
            raise HTTPException(status_code=404, detail=f"Unit '{name}' not found in Wahapedia database")
        return unit

    @app.delete("/api/armylists/{list_id}", summary="Delete an army list")
    async def api_delete_armylist(list_id: str, request: Request):
        auth_mgr = get_auth_manager()
        session_token = request.cookies.get("session_token")
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            session_token = auth_header.split(" ", 1)[1]
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None

        db = get_database()
        success = db.delete_user_army_list(list_id, user_id=user_id)
        return {"success": success, "deleted_id": list_id}

    @app.get("/nr/app/list/{share_id}", include_in_schema=False)
    @app.get("/nr_proxy/{share_id}", summary="Proxy NewRecruit share page and automatically import list")
    @app.get("/api/armylist/nr_proxy/{share_id}", include_in_schema=False)
    @app.get("/api/armylists/nr_proxy/{share_id}", include_in_schema=False)
    async def api_nr_proxy(share_id: str):
        """Proxies NewRecruit share page with auto-import and direct interactive mode script injection."""
        clean_id = share_id.strip()
        try:
            url = f"https://www.newrecruit.eu/app/list/{clean_id}"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            def _fetch():
                with urllib.request.urlopen(req, timeout=4.0) as resp:
                    return resp.read().decode("utf-8")
            html = await asyncio.to_thread(_fetch)
            
            # Rewrite relative paths to absolute newrecruit.eu
            html = html.replace('href="/_nuxt/', 'href="https://www.newrecruit.eu/_nuxt/')
            html = html.replace('src="/_nuxt/', 'src="https://www.newrecruit.eu/_nuxt/')
            html = html.replace('href="/favicon', 'href="https://www.newrecruit.eu/favicon')
            
            # Inject auto-import and auto-play script
            auto_script = """
            <script>
            (function() {
              let clickedImport = false;
              let clickedPlay = false;
              const timer = setInterval(() => {
                try {
                  // 1. Auto-click 'Import List' on share preview page
                  if (!clickedImport) {
                    const btns = Array.from(document.querySelectorAll('button'));
                    const importBtn = btns.find(b => (b.textContent || '').trim().toLowerCase() === 'import list');
                    if (importBtn) {
                      clickedImport = true;
                      console.log('[Auto-Import] Found and auto-clicked Import List button');
                      importBtn.click();
                    }
                  }
                  // 2. Auto-enable Play Mode once list is imported / loaded
                  if (!clickedPlay && (window.location.href.includes('/app/Lists') || document.querySelector('.actionButtons, .unitName, .rosterHeader'))) {
                    const playBtn = Array.from(document.querySelectorAll('button, a, div, span')).find(el => {
                      const txt = (el.textContent || '').trim().toLowerCase();
                      return txt === 'play mode' || txt === '🎮 play mode' || txt.includes('play mode');
                    });
                    if (playBtn) {
                      clickedPlay = true;
                      playBtn.click();
                      clearInterval(timer);
                    }
                  }
                } catch(e) {}
              }, 120);
              setTimeout(() => clearInterval(timer), 12000);
            })();
            </script>
            """
            html = html.replace("</body>", auto_script + "</body>")
            return HTMLResponse(content=html, status_code=200)
        except Exception as e:
            logger.warning(f"Notice proxying NewRecruit auto-import: {e}")
            return RedirectResponse(url=f"https://www.newrecruit.eu/app/list/{clean_id}", status_code=302)

    @app.post("/api/tracker/room/{match_id}/armylist", summary="Attach player army list to live match room")
    async def api_tracker_attach_armylist(match_id: str, request: Request):
        match_id = normalize_tracker_match_id(match_id)
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")
        
        role = body.get("role") or "player1"
        army_list = body.get("army_list") or {}

        # 1. Update in-memory room
        if match_id not in TRACKER_ROOMS:
            TRACKER_ROOMS[match_id] = {
                "match_id": match_id,
                "state": {},
                "version": 1
            }

        if role == "player1":
            TRACKER_ROOMS[match_id]["p1_army_list"] = army_list
        else:
            TRACKER_ROOMS[match_id]["p2_army_list"] = army_list

        # 2. Persist in Cloud Firestore Native
        try:
            fs_engine = get_firestore_engine()
            col_list = "p1_army_list" if role == "player1" else "p2_army_list"
            fs_engine.update_room(match_id, {
                col_list: army_list,
                f"rosters.{role}": army_list
            })
        except Exception as e:
            logger.warning(f"Error persisting attached army list in Firestore: {e}")

        # 3. Broadcast SSE update to opponent and spectators
        listeners = TRACKER_LISTENERS.get(match_id, [])
        msg = {
            "type": "army_list_updated",
            "match_id": match_id,
            "role": role,
            "army_list": army_list,
            "sender": role
        }
        for q in list(listeners):
            try:
                await q.put(msg)
            except Exception:
                pass

        return {"success": True, "match_id": match_id, "role": role, "army_list": army_list}

    @app.get("/api/tracker/room/{match_id}/armylists", summary="Get attached army lists for Player 1 and Player 2")
    async def api_tracker_get_armylists(match_id: str):
        match_id = normalize_tracker_match_id(match_id)
        fs_engine = get_firestore_engine()
        p1_list = None
        p2_list = None

        if match_id in TRACKER_ROOMS:
            p1_list = TRACKER_ROOMS[match_id].get("p1_army_list")
            p2_list = TRACKER_ROOMS[match_id].get("p2_army_list")

        if not p1_list or not p2_list:
            fs_doc = fs_engine.get_room(match_id)
            if fs_doc:
                if not p1_list: p1_list = fs_doc.get("p1_army_list") or fs_doc.get("rosters", {}).get("player1")
                if not p2_list: p2_list = fs_doc.get("p2_army_list") or fs_doc.get("rosters", {}).get("player2")

        if not p1_list or not p2_list:
            db = get_database()
            game_rec = db.get_tracker_game(match_id)
            if game_rec:
                if not p1_list: p1_list = game_rec.get("p1_army_list")
                if not p2_list: p2_list = game_rec.get("p2_army_list")

        return {
            "success": True,
            "match_id": match_id,
            "p1_army_list": p1_list,
            "p2_army_list": p2_list
        }

    @app.post("/api/tracker/room/{match_id}/clock", summary="Synchronize tournament dual chess clock state")
    async def api_tracker_update_clock(match_id: str, request: Request):
        match_id = normalize_tracker_match_id(match_id)
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        if match_id not in TRACKER_ROOMS:
            TRACKER_ROOMS[match_id] = {
                "match_id": match_id,
                "state": {},
                "version": 1
            }

        room = TRACKER_ROOMS[match_id]
        clock_data = {
            "visible": bool(body.get("visible", True)),
            "running": bool(body.get("running", False)),
            "active_player": int(body.get("active_player", 1)),
            "duration_minutes": int(body.get("duration_minutes", 75)),
            "p1_remaining": int(body.get("p1_remaining", 4500)),
            "p2_remaining": int(body.get("p2_remaining", 4500)),
            "round_remaining": int(body.get("round_remaining", 9000)),
            "last_start_time": body.get("last_start_time"),
            "updated_at": int(datetime.now(timezone.utc).timestamp() * 1000)
        }
        room["chess_clock"] = clock_data

        # Persist in Cloud Firestore Native
        try:
            fs_engine = get_firestore_engine()
            fs_engine.update_room(match_id, {"chess_clock": clock_data, "clock": clock_data})
        except Exception:
            pass

        # Broadcast to all SSE clients in this room
        listeners = TRACKER_LISTENERS.get(match_id, [])
        msg = {
            "type": "clock_update",
            "sender": body.get("client_id", "anon"),
            "chess_clock": clock_data
        }
        for l_q in list(listeners):
            try:
                await l_q.put(msg)
            except Exception:
                pass

        return {"success": True, "chess_clock": clock_data}

    @app.post("/api/tracker/room/{match_id}/dice_tray", summary="Synchronize live tabletop dice tray across players")
    async def api_tracker_sync_dice_tray(match_id: str, request: Request):
        match_id = normalize_tracker_match_id(match_id)
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        if match_id not in TRACKER_ROOMS:
            TRACKER_ROOMS[match_id] = {
                "match_id": match_id,
                "state": {},
                "version": 1
            }

        room = TRACKER_ROOMS[match_id]
        tray = body.get("tray", [])
        target = int(body.get("target", 0))
        history = body.get("history")

        if "state" not in room or not isinstance(room["state"], dict):
            room["state"] = {}
        room["state"]["dice_tray"] = tray
        room["state"]["dice_target"] = target
        room["dice_tray"] = tray
        room["dice_target"] = target
        if history is not None:
            room["state"]["dice_history"] = history
            room["dice_history"] = history

        # Sync to Firestore Native
        try:
            fs_engine = get_firestore_engine()
            update_fields = {
                "dice_tray": tray,
                "dice_target": target,
                "state": {
                    "dice_tray": tray,
                    "dice_target": target
                }
            }
            if history is not None:
                update_fields["dice_history"] = history
                update_fields["state"]["dice_history"] = history
            fs_engine.update_room(match_id, update_fields)
        except Exception:
            pass

        # Broadcast live tray update to opponent
        listeners = TRACKER_LISTENERS.get(match_id, [])
        msg = {
            "type": "dice_tray",
            "sender": body.get("client_id", "anon"),
            "tray": tray,
            "target": target
        }
        if history is not None:
            msg["history"] = history
        for l_q in list(listeners):
            try:
                await l_q.put(msg)
            except Exception:
                pass

        return {"success": True, "tray": tray, "target": target}

    @app.post("/api/tracker/room/{match_id}/dice_roll", summary="Broadcast live dice roll to both players in room")
    async def api_tracker_roll_dice(match_id: str, request: Request):
        match_id = normalize_tracker_match_id(match_id)
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        if match_id not in TRACKER_ROOMS:
            TRACKER_ROOMS[match_id] = {
                "match_id": match_id,
                "state": {},
                "version": 1
            }

        room = TRACKER_ROOMS[match_id]
        roll_data = {
            "id": body.get("id") or f"roll_{int(datetime.now(timezone.utc).timestamp() * 1000)}",
            "player_name": body.get("player_name") or "Player",
            "player_num": int(body.get("player_num") or 1),
            "label": body.get("label") or "Dice Roll",
            "dice_count": int(body.get("dice_count") or 1),
            "die_type": body.get("die_type") or "D6",
            "target": int(body.get("target") or 0),
            "results": body.get("results") or [],
            "success_count": int(body.get("success_count") or 0),
            "fail_count": int(body.get("fail_count") or 0),
            "crit_count": int(body.get("crit_count") or 0),
            "sum": int(body.get("sum") or 0),
            "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000)
        }

        # Keep last 50 rolls in room history
        if "dice_history" not in room:
            room["dice_history"] = []
        room["dice_history"].append(roll_data)
        if len(room["dice_history"]) > 50:
            room["dice_history"] = room["dice_history"][-50:]

        tray = body.get("tray")
        target = int(body.get("target", 0))

        if "state" not in room or not isinstance(room["state"], dict):
            room["state"] = {}
        if tray is not None:
            room["state"]["dice_tray"] = tray
            room["dice_tray"] = tray
        room["state"]["dice_target"] = target
        room["state"]["dice_history"] = room["dice_history"]
        room["dice_target"] = target

        # Save to Firestore Native
        try:
            fs_engine = get_firestore_engine()
            fs_updates = {
                "dice_history": room["dice_history"],
                "dice_target": target,
                "state": {
                    "dice_history": room["dice_history"],
                    "dice_target": target
                }
            }
            if tray is not None:
                fs_updates["dice_tray"] = tray
                fs_updates["state"]["dice_tray"] = tray
            fs_engine.update_room(match_id, fs_updates)
        except Exception:
            pass

        # Broadcast to all SSE listeners in this room
        listeners = TRACKER_LISTENERS.get(match_id, [])
        msg = {
            "type": "dice_roll",
            "sender": body.get("client_id", "anon"),
            "roll": roll_data,
            "tray": tray,
            "target": target,
            "history": room["dice_history"]
        }
        for l_q in list(listeners):
            try:
                await l_q.put(msg)
            except Exception:
                pass

        return {
            "success": True,
            "roll": roll_data,
            "tray": tray,
            "target": target
        }

    @app.get("/api/tracker/room/{match_id}/stream", summary="Real-time Server-Sent Events stream for multiplayer match")
    async def api_tracker_stream(match_id: str, client_id: str = "anon"):
        match_id = normalize_tracker_match_id(match_id)
        q = asyncio.Queue()
        if match_id not in TRACKER_LISTENERS:
            TRACKER_LISTENERS[match_id] = []
        TRACKER_LISTENERS[match_id].append(q)

        # Broadcast live presence count to ALL connected listeners in this room
        cur_count = len(TRACKER_LISTENERS[match_id])
        p_msg = {"type": "presence", "count": cur_count}
        for l_q in list(TRACKER_LISTENERS[match_id]):
            try:
                await l_q.put(p_msg)
            except Exception:
                pass

        async def event_generator():
            try:
                # Send current room state on initial connection
                if match_id in TRACKER_ROOMS:
                    r = TRACKER_ROOMS[match_id]
                    if r.get("state"):
                        yield f"data: {json.dumps({'type': 'state_update', 'sender': 'server', 'version': r.get('version', 1), 'state': r['state']})}\n\n"
                    if r.get("chess_clock"):
                        yield f"data: {json.dumps({'type': 'clock_update', 'sender': 'server', 'chess_clock': r['chess_clock']})}\n\n"

                while True:
                    msg = await q.get()
                    yield f"data: {json.dumps(msg)}\n\n"
            except asyncio.CancelledError:
                pass
            finally:
                if match_id in TRACKER_LISTENERS and q in TRACKER_LISTENERS[match_id]:
                    TRACKER_LISTENERS[match_id].remove(q)
                rem_count = len(TRACKER_LISTENERS.get(match_id, []))
                disconn_msg = {"type": "presence", "count": rem_count}
                for rem_q in list(TRACKER_LISTENERS.get(match_id, [])):
                    try:
                        await rem_q.put(disconn_msg)
                    except Exception:
                        pass

        return StreamingResponse(event_generator(), media_type="text/event-stream")

    # =========================================================================
    # REVERSE PROXY & DYNAMIC HTML BRIDGE INJECTION (UPSTREAM GDM SYNC)
    # =========================================================================
    GDM_UPSTREAM = "https://gdmissions.app"
    GDM_STATIC_CACHE: Dict[str, Tuple[bytes, str, Dict[str, str]]] = {}

    BRIDGE_INJECTION_HTML = """
  <!-- CLOUD FIRESTORE NATIVE CLIENT SDK & MULTIPLAYER OVERLAY -->
  <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js"></script>
  <link rel="stylesheet" href="/tracker/tracker_sync.css?v=52.0">
  <script src="/tracker/tracker_sync.js?v=52.0"></script>
  <style>
    header.tac-header, footer.tac-footer, .tac-header, .tac-footer, footer {
      display: none !important;
    }
    body.is-tracker-lobby main > :not(#gt-lobby-wrapper),
    body:not(.is-tracker-play) main > div:not(:has(#gt-lobby-wrapper)):not(#gt-lobby-wrapper),
    body:not(.is-tracker-play) main h2:not(#gt-lobby-wrapper *),
    body:not(.is-tracker-play) main button:not(#gt-lobby-wrapper *):not(#gt-user-status-bar *),
    body:not(.is-tracker-play) main h3:not(#gt-lobby-wrapper *),
    body:not(.is-tracker-play) main p:not(#gt-lobby-wrapper *),
    body:not(.is-tracker-play) div[class*="max-w-md"]:not(#gt-lobby-wrapper *),
    body:not(.is-tracker-play) main > div > div:not(:has(#gt-lobby-wrapper)):not(#gt-lobby-wrapper) {
      display: none !important;
    }
    #gt-lobby-wrapper {
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
    button[aria-label*="Delete"],
    button[aria-label*="delete"],
    button:has(svg.lucide-trash),
    button:has(svg.lucide-trash-2),
    [class*="delete-game"],
    [data-action="delete"],
    button:has(span.text-xs),
    button[aria-label*="News"],
    a[href*="/news"],
    div[class*="fixed"]:has(button:has(svg.lucide-download)),
    div[class*="fixed"]:has(button:has(svg.lucide-plus-square)),
    div[class*="fixed"]:has(a[href*="install"]) {
      display: none !important;
    }
  </style>
  <script>
    if ('serviceWorker' in navigator) {
      try {
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
          for (let registration of registrations) {
            try { registration.unregister(); } catch(e) {}
          }
        }).catch(function() {});
        navigator.serviceWorker.register = function() {
          return Promise.resolve({
            installing: null,
            waiting: null,
            active: null,
            addEventListener: function() {},
            removeEventListener: function() {},
            dispatchEvent: function() { return false; }
          });
        };
      } catch(e) {}
    }
  </script>
"""

    async def proxy_gdm_asset(rel_path: str, query: str = "") -> Response:
        """Proxies static chunks, CSS, fonts, and images from upstream GDM with in-memory caching."""
        cache_key = rel_path.lstrip("/")
        full_cache_key = f"{cache_key}?{query}" if query else cache_key
        if full_cache_key in GDM_STATIC_CACHE:
            body, c_type, hdrs = GDM_STATIC_CACHE[full_cache_key]
            return Response(content=body, media_type=c_type, headers=hdrs)

        url = f"{GDM_UPSTREAM}/{cache_key}"
        if query:
            url += f"?{query}"

        def _fetch():
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "*/*"
                }
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                content = resp.read()
                c_type = resp.headers.get("Content-Type", "application/octet-stream")
                return content, c_type

        try:
            content, c_type = await asyncio.to_thread(_fetch)

            # Patch React context state setter hook dynamically in JS chunk stream
            if cache_key.endswith(".js") and b"gdm-11e-tracker-state" in content:
                txt = content.decode("utf-8", errors="ignore")
                txt = txt.replace(
                    "P(d()),j(!0)",
                    "P(d()),j(!0),window.__gdmSetTrackerState=function(e){try{k(M(e))}catch(err){console.error('StateSync err:',err)}},window.addEventListener('gdm-state-sync',function(e){if(e.detail&&window.__gdmSetTrackerState)window.__gdmSetTrackerState(e.detail)})"
                )
                txt = re.sub(r"function C\(e\)\{return.*?\}", "function C(e){return!0}", txt)
                content = txt.encode("utf-8")

            hdrs = {
                "Cache-Control": "public, max-age=31536000, immutable" if "/_next/static/" in cache_key else "public, max-age=3600",
                "Access-Control-Allow-Origin": "*"
            }

            if "/_next/static/" in cache_key or cache_key.endswith((".woff2", ".png", ".svg", ".ico", ".jpg", ".jpeg", ".webp", ".gif", ".avif")):
                GDM_STATIC_CACHE[full_cache_key] = (content, c_type, hdrs)

            return Response(content=content, media_type=c_type, headers=hdrs)
        except Exception as e:
            logger.error(f"Error proxying GDM asset {url}: {e}")
            raise HTTPException(status_code=404, detail="Asset not found")

    async def proxy_gdm_html(path: str, request: Request) -> Response:
        """Proxies upstream GDM HTML page and injects the live multiplayer bridge script."""
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

        url = f"{GDM_UPSTREAM}/{path.lstrip('/')}"

        def _fetch():
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                }
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                return resp.read().decode("utf-8", errors="ignore")

        try:
            raw_html = await asyncio.to_thread(_fetch)
            if "</head>" in raw_html:
                modified_html = raw_html.replace("</head>", f"{BRIDGE_INJECTION_HTML}\n</head>", 1)
            else:
                modified_html = f"{BRIDGE_INJECTION_HTML}\n{raw_html}"

            # Brand customization: replace GDM app branding in HTML
            modified_html = re.sub(r'<title>.*?</title>', '<title>Game Tracker | Warhammer 40,000 Elo Rankings</title>', modified_html, flags=re.IGNORECASE)
            modified_html = re.sub(r'content="GDM[^"]*"', 'content="40k Elo"', modified_html)
            modified_html = modified_html.replace('content="Game Day - Tabletop App"', 'content="Warhammer 40,000 Elo Game Tracker"')

            is_play_page = "play" in path.lower()
            body_class = "is-tracker-play" if is_play_page else "is-tracker-lobby"
            if "<body" in modified_html:
                if 'class="' in modified_html[modified_html.find("<body"):modified_html.find("<body") + 50]:
                    modified_html = re.sub(r'(<body[^>]*class=")([^"]*)(")', rf'\1\2 {body_class}\3', modified_html, count=1)
                else:
                    modified_html = re.sub(r'<body(\s*[^>]*)>', rf'<body\1 class="{body_class}">', modified_html, count=1)

            return HTMLResponse(content=modified_html, status_code=200, headers={"Content-Type": "text/html; charset=utf-8"})
        except Exception as e:
            logger.error(f"Error fetching GDM HTML {url}: {e}")
            raise HTTPException(status_code=502, detail="Failed to fetch upstream GDM layout")

    # Root Leaderboard & Competitor Hub
    @app.get("/", include_in_schema=False)
    @app.get("/index.html", include_in_schema=False)
    async def serve_index():
        idx_file = web_dir / "index.html"
        if idx_file.exists():
            return FileResponse(str(idx_file), media_type="text/html")
        raise HTTPException(status_code=404, detail="index.html not found")

    @app.get("/tracker/tracker_sync.js", include_in_schema=False)
    @app.get("/11th/tracker/tracker_sync.js", include_in_schema=False)
    async def serve_tracker_sync_js():
        return FileResponse(str(web_dir / "tracker" / "tracker_sync.js"), media_type="application/javascript", headers={"Cache-Control": "no-cache, must-revalidate"})

    @app.get("/tracker/tracker_sync.css", include_in_schema=False)
    @app.get("/11th/tracker/tracker_sync.css", include_in_schema=False)
    async def serve_tracker_sync_css():
        return FileResponse(str(web_dir / "tracker" / "tracker_sync.css"), media_type="text/css", headers={"Cache-Control": "no-cache, must-revalidate"})

    @app.get("/login", include_in_schema=False)
    @app.get("/tracker/login", include_in_schema=False)
    async def serve_login(redirect: Optional[str] = Query(None)):
        login_file = web_dir / "tracker" / "login.html"
        if login_file.exists():
            return FileResponse(str(login_file), media_type="text/html")
        raise HTTPException(status_code=404, detail="login.html not found")

    @app.get("/my-hub", include_in_schema=False)
    @app.get("/hub", include_in_schema=False)
    async def serve_my_hub(request: Request, token: Optional[str] = Query(None)):
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        if not user:
            return RedirectResponse(url="/login?redirect=/#my-hub", status_code=303)
        return RedirectResponse(url="/#my-hub", status_code=303)

    @app.get("/tracker", include_in_schema=False)
    @app.get("/tracker/", include_in_schema=False)
    async def serve_tracker_alias(request: Request, token: Optional[str] = Query(None)):
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        if not user:
            return RedirectResponse(url="/login?redirect=/11th/tracker", status_code=303)
        return RedirectResponse(url="/11th/tracker", status_code=303)

    @app.get("/tracker/play", include_in_schema=False)
    async def serve_tracker_play_alias(request: Request):
        query = f"?{request.url.query}" if request.url.query else ""
        return RedirectResponse(url=f"/11th/tracker/play{query}", status_code=303)

    # Dynamic Upstream Next.js Static Asset & Image Optimization Streaming
    @app.get("/_next/image", include_in_schema=False)
    async def serve_next_image_optimizer(request: Request):
        raw_url = request.query_params.get("url")
        if not raw_url:
            raise HTTPException(status_code=400, detail="Missing url parameter")
        clean_path = raw_url.lstrip("/")
        return await proxy_gdm_asset(clean_path)

    @app.get("/_next/{path:path}", include_in_schema=False)
    async def serve_next_assets(path: str, request: Request):
        return await proxy_gdm_asset(f"_next/{path}", request.url.query)

    # Dynamic Upstream Terrain, Cards, Layouts, and Media Assets
    @app.get("/terrain/{path:path}", include_in_schema=False)
    @app.get("/cards/{path:path}", include_in_schema=False)
    @app.get("/images/{path:path}", include_in_schema=False)
    @app.get("/icons/{path:path}", include_in_schema=False)
    @app.get("/assets/{path:path}", include_in_schema=False)
    @app.get("/svg/{path:path}", include_in_schema=False)
    @app.get("/factions/{path:path}", include_in_schema=False)
    @app.get("/data/{path:path}", include_in_schema=False)
    @app.get("/battlemaster/{path:path}", include_in_schema=False)
    async def serve_gdm_media_assets(request: Request):
        rel_path = request.url.path.lstrip("/")
        return await proxy_gdm_asset(rel_path, request.url.query)

    # Dynamic Upstream HTML Pages with Live Bridge Injection
    @app.get("/11th/{path:path}", include_in_schema=False)
    async def serve_11th_pages(path: str, request: Request):
        return await proxy_gdm_html(f"11th/{path}", request)

    @app.get("/11th", include_in_schema=False)
    async def serve_11th_root(request: Request):
        return await proxy_gdm_html("11th", request)

    @app.get("/10th/{path:path}", include_in_schema=False)
    async def serve_10th_pages(path: str, request: Request):
        return await proxy_gdm_html(f"10th/{path}", request)

    @app.get("/manifest.json", include_in_schema=False)
    @app.get("/manifest.webmanifest", include_in_schema=False)
    async def serve_pwa_manifest():
        manifest_file = web_dir / "manifest.json"
        if manifest_file.exists():
            return FileResponse(str(manifest_file), media_type="application/manifest+json")
        return JSONResponse(
            content={
                "name": "OmniTactica - 40K Tactical Suite",
                "short_name": "OmniTactica",
                "description": "OmniTactica Warhammer 40,000 Elo Rankings, Tournament Companion & Live Game Tracker",
                "start_url": "/#my-hub",
                "scope": "/",
                "display": "standalone",
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
            },
            headers={"Content-Type": "application/manifest+json"}
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
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        if not user:
            return RedirectResponse(url="/login?redirect=/#event-studio", status_code=303)
        es_file = web_dir / "eventstudio.html"
        if es_file.exists():
            return FileResponse(str(es_file), media_type="text/html")
        raise HTTPException(status_code=404, detail="eventstudio.html not found")

    @app.get("/admin/feedback", include_in_schema=False)
    @app.get("/admin/feedback.html", include_in_schema=False)
    async def serve_admin_feedback():
        af_file = web_dir / "admin_feedback.html"
        if af_file.exists():
            return FileResponse(str(af_file), media_type="text/html")
        raise HTTPException(status_code=404, detail="admin_feedback.html not found")

    @app.get("/admin", include_in_schema=False)
    @app.get("/admin.html", include_in_schema=False)
    async def serve_admin_dashboard(request: Request, token: Optional[str] = Query(None)):
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        if not user:
            return RedirectResponse(url="/login?redirect=/admin", status_code=303)
        user_role = (user.get("role") or "player").strip().lower()
        user_email = (user.get("email") or "").strip().lower()
        admin_emails = ('swimgeek751@gmail.com', 'hsiehjun@umich.edu', 'hsiehjun@google.com', 'hsiehjun@gmail.com')
        if user_role not in ("admin", "superuser", "developer", "owner") or user_email not in admin_emails:
            return RedirectResponse(url="/?error=unauthorized_admin", status_code=303)
        adm_file = web_dir / "admin.html"
        if adm_file.exists():
            return FileResponse(str(adm_file), media_type="text/html")
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

    # API: Summary Stats Ribbon
    @app.get("/api/stats", summary="Get global summary statistics")
    async def api_stats():
        return get_database().get_summary_stats()

    # API: Individual Leaderboard Standings
    @app.get("/api/leaderboard", summary="Get top ranked players (paginated)")
    async def api_leaderboard(
        page: int = Query(1, ge=1),
        page_size: int = Query(25, ge=5, le=200),
        limit: Optional[int] = Query(None),
        min_matches: int = Query(3, ge=0),
        query: Optional[str] = Query(None),
        faction: str = Query("All"),
        sort_by: str = Query("current_elo"),
        order: str = Query("DESC")
    ):
        return get_database().get_top_ranked_players(
            page=page,
            page_size=page_size,
            limit=limit,
            min_matches=min_matches,
            query=query.strip() if query else None,
            faction=faction.strip() if faction else "All",
            sort_by=sort_by,
            order=order
        )

    # API: Teams Power Rankings
    @app.get("/api/teams", summary="Get teams power rankings (paginated)")
    @app.get("/api/leaderboard/teams", include_in_schema=False)
    async def api_teams(
        page: int = Query(1, ge=1),
        page_size: int = Query(25, ge=5, le=200),
        min_roster: int = Query(5, ge=1),
        min_members: Optional[int] = Query(None),
        limit: Optional[int] = Query(None),
        query: Optional[str] = Query(None),
        sort_by: str = Query("power_rating"),
        order: str = Query("DESC")
    ):
        actual_min = min_members if min_members is not None else min_roster
        return get_database().get_teams_leaderboard(
            page=page,
            page_size=page_size,
            min_members=actual_min,
            limit=limit,
            query=query.strip() if query else None,
            sort_by=sort_by,
            order=order
        )

    # API: Team Roster
    @app.get("/api/team/{team_name}", summary="Get team member roster and power metrics")
    async def api_team_roster(team_name: str):
        return get_database().get_team_roster(team_name.strip())

    # API: Full Player Directory
    @app.get("/api/players", summary="Search and browse player directory (paginated)")
    async def api_players_directory(
        page: int = Query(1, ge=1),
        page_size: int = Query(25, ge=5, le=200),
        limit: Optional[int] = Query(None),
        query: Optional[str] = Query(None),
        faction: str = Query("All"),
        min_matches: int = Query(0, ge=0),
        sort_by: str = Query("current_elo"),
        order: str = Query("DESC")
    ):
        return get_database().get_players_directory(
            page=page,
            page_size=page_size,
            limit=limit,
            query=query.strip() if query else None,
            faction=faction.strip() if faction else "All",
            min_matches=min_matches,
            sort_by=sort_by,
            order=order
        )

    # API: Autocomplete Search for Match Predictor
    @app.get("/api/players/search", summary="Search players for predictor autocomplete")
    async def api_players_search(q: str = Query("", min_length=1), limit: int = Query(10, ge=1, le=50)):
        return get_database().search_players(q.strip(), limit=limit)

    # API: Player Profile & Historical Win Path
    @app.get("/api/player/{player_id}", summary="Get player profile, win path, and Elo trajectory")
    async def api_player_profile(player_id: str):
        return get_elo_engine().get_player_win_path(player_id.strip())

    # API: Tournaments List
    @app.get("/api/events", summary="List tournaments with date and status filters (paginated)")
    async def api_events(
        page: int = Query(1, ge=1),
        page_size: int = Query(25, ge=1, le=200),
        limit: Optional[int] = Query(None),
        query: Optional[str] = Query(None),
        status: str = Query("all"),
        sort_by: str = Query("event_date"),
        order: str = Query("DESC")
    ):
        return get_database().get_events_list(
            page=page,
            page_size=page_size,
            limit=limit,
            query=query.strip() if query else None,
            status=status,
            sort_by=sort_by,
            order=order
        )

    # API: Recommended & Upcoming Events for Competitor Hub (100% Live from BCP)
    @app.get("/api/events/recommended", summary="Get real-time live upcoming events from BCP")
    async def api_events_recommended(
        player_id: Optional[str] = Query(None),
        query: Optional[str] = Query(None),
        tier: Optional[str] = Query(None),
        state: Optional[str] = Query(None),
        city: Optional[str] = Query(None),
        lat: Optional[float] = Query(None),
        lng: Optional[float] = Query(None),
        radius_miles: Optional[float] = Query(None),
        sort_by: str = Query("date"),
        limit: int = Query(35, ge=1, le=100)
    ):
        db = get_database()
        now_dt = datetime.now(timezone.utc)
        player_id_clean = player_id.strip() if player_id else None
        
        # 1. Resolve user location & Elo from database
        detected_state = None
        detected_city = None
        user_elo = None
        
        KNOWN_CITIES = {
            "san diego": (32.7157, -117.1611),
            "temecula": (33.4936, -117.1484),
            "los angeles": (34.0522, -118.2437),
            "san francisco": (37.7749, -122.4194),
            "san jose": (37.3382, -121.8863),
            "sacramento": (38.5816, -121.4944),
            "austin": (30.2672, -97.7431),
            "dallas": (32.7767, -96.7970),
            "houston": (29.7604, -95.3698),
            "chicago": (41.8781, -87.6298),
            "seattle": (47.6062, -122.3321),
            "orlando": (28.5383, -81.3792),
            "london": (51.5074, -0.1278)
        }

        with db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                if player_id_clean:
                    cursor.execute("""
                    SELECT e.state, e.city, COUNT(*) as cnt
                    FROM event_participants ep
                    JOIN events e ON ep.event_id = e.id
                    WHERE ep.player_id = %s AND e.state IS NOT NULL AND TRIM(e.state) != ''
                    GROUP BY e.state, e.city
                    ORDER BY cnt DESC, MAX(e.event_date) DESC
                    LIMIT 1;
                    """, (player_id_clean,))
                    loc_row = cursor.fetchone()
                    if loc_row:
                        detected_state = loc_row.get("state")
                        detected_city = loc_row.get("city")

                    cursor.execute("SELECT current_elo FROM player_ratings WHERE player_id = %s;", (player_id_clean,))
                    elo_row = cursor.fetchone()
                    if elo_row:
                        user_elo = float(elo_row.get("current_elo") or 1500.0)

        target_state = (state.strip() if state and state.strip() else detected_state)
        target_city = (city.strip() if city and city.strip() else detected_city)

        user_lat = lat
        user_lng = lng
        if not user_lat and target_city and target_city.strip().lower() in KNOWN_CITIES:
            user_lat, user_lng = KNOWN_CITIES[target_city.strip().lower()]

        # 2. Query live upcoming events from BCP API
        bcp_events = []
        now_ts = time.time()
        effective_radius = int(radius_miles) if radius_miles and radius_miles > 0 else 50
        geo_key = f"{round(user_lat, 2) if user_lat else None}_{round(user_lng, 2) if user_lng else None}_{effective_radius}"
        
        if not hasattr(api_events_recommended, "_cache"):
            api_events_recommended._cache = {}

        cached_entry = api_events_recommended._cache.get(geo_key)
        if cached_entry and (now_ts - cached_entry["timestamp"] < 90) and cached_entry["events"]:
            bcp_events = list(cached_entry["events"])
        else:
            headers = DEFAULT_HEADERS.copy()
            fetched_bcp = []

            if user_lat and user_lng:
                # Direct BCP API server-side geospatial query (exact matching BCP web app)
                params = {
                    "limit": 50,
                    "gameSystemId": DEFAULT_GAME_SYSTEM_ID,
                    "startDate": now_dt.strftime("%Y-%m-%dT00:00:00.000Z"),
                    "endDate": (now_dt + timedelta(days=120)).strftime("%Y-%m-%dT23:59:59.999Z"),
                    "excludeOnline": "true",
                    "sortKey": "eventDate",
                    "sortAscending": "true",
                    "location": json.dumps({
                        "distance": effective_radius,
                        "distanceType": "miles",
                        "center": {
                            "lat": str(user_lat),
                            "long": str(user_lng)
                        }
                    })
                }
                next_key = None
                for _ in range(4):  # Up to 200 events
                    if next_key:
                        params["nextKey"] = next_key
                    url = f"{BCP_API_BASE}/events?{urllib.parse.urlencode(params)}"
                    try:
                        req = urllib.request.Request(url, headers=headers)
                        with urllib.request.urlopen(req, timeout=4.5) as resp:
                            data = json.loads(resp.read().decode())
                            evs = data.get("data", [])
                            fetched_bcp.extend(evs)
                            next_key = data.get("nextKey")
                            if not next_key:
                                break
                    except Exception as e:
                        logger.warning(f"Live BCP geo query error: {e}")
                        break
            else:
                # Global / multi-window query when no GPS coordinates are active
                windows = [
                    (now_dt.strftime("%Y-%m-%dT00:00:00.000Z"), (now_dt + timedelta(days=35)).strftime("%Y-%m-%dT23:59:59.999Z")),
                    ((now_dt + timedelta(days=36)).strftime("%Y-%m-%dT00:00:00.000Z"), (now_dt + timedelta(days=75)).strftime("%Y-%m-%dT23:59:59.999Z")),
                    ((now_dt + timedelta(days=76)).strftime("%Y-%m-%dT00:00:00.000Z"), (now_dt + timedelta(days=120)).strftime("%Y-%m-%dT23:59:59.999Z"))
                ]
                for s_iso, e_iso in windows:
                    next_key = None
                    params = {
                        "limit": 50,
                        "gameSystemId": DEFAULT_GAME_SYSTEM_ID,
                        "startDate": s_iso,
                        "endDate": e_iso
                    }
                    for _ in range(3):
                        if next_key:
                            params["nextKey"] = next_key
                        url = f"{BCP_API_BASE}/events?{urllib.parse.urlencode(params)}"
                        try:
                            req = urllib.request.Request(url, headers=headers)
                            with urllib.request.urlopen(req, timeout=3.5) as resp:
                                data = json.loads(resp.read().decode())
                                evs = data.get("data", [])
                                fetched_bcp.extend(evs)
                                next_key = data.get("nextKey")
                                if not next_key:
                                    break
                        except Exception as e:
                            logger.warning(f"Live BCP query error: {e}")
                            break

            if fetched_bcp:
                api_events_recommended._cache[geo_key] = {"timestamp": now_ts, "events": fetched_bcp}
                bcp_events = list(fetched_bcp)

            # Also merge with events already synced in local database
            try:
                with db.get_connection() as conn:
                    with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                        cursor.execute("""
                        SELECT id, name, event_date, city, state, country, total_players, num_rounds, is_ended, raw_json
                        FROM events
                        WHERE event_date >= CURRENT_DATE - INTERVAL '14 days'
                        ORDER BY event_date ASC
                        LIMIT 150;
                        """)
                        db_evs = [dict(r) for r in cursor.fetchall()]
                        seen_ids_temp = {e.get("id") or e.get("objectId") for e in bcp_events if e.get("id") or e.get("objectId")}
                        for dbev in db_evs:
                            if dbev.get("id") not in seen_ids_temp:
                                bcp_events.append(dbev)
            except Exception as e:
                logger.warning(f"Database query notice: {e}")

        def haversine_miles(lat1, lon1, lat2, lon2):
            R = 3958.8
            dLat = math.radians(lat2 - lat1)
            dLon = math.radians(lon2 - lon1)
            a = math.sin(dLat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dLon/2)**2
            return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

        processed_events = []
        seen_ids = set()

        # Batch query enrolled player stats from DB for all incoming events
        ev_all_ids = [str(ev.get("id") or ev.get("objectId")) for ev in bcp_events if (ev.get("id") or ev.get("objectId"))]
        try:
            field_stats = db.get_events_field_stats(ev_all_ids)
        except Exception as e:
            logger.warning(f"Notice querying field stats: {e}")
            field_stats = {}

        if not hasattr(api_events_recommended, "_roster_cache"):
            api_events_recommended._roster_cache = {}

        # For nearby upcoming events with enrolled players not yet in DB, fetch live roster from BCP
        headers = DEFAULT_HEADERS.copy()
        for ev in bcp_events[:20]:
            eid = str(ev.get("id") or ev.get("objectId") or "")
            enrolled_cnt = int(ev.get("totalPlayers") or ev.get("total_players") or ev.get("enrolled_count") or 0)
            if not eid or enrolled_cnt <= 0:
                continue

            # Check in-memory roster cache first (15-min TTL)
            roster_cached = api_events_recommended._roster_cache.get(eid)
            if roster_cached and (now_ts - roster_cached["timestamp"] < 900):
                field_stats[eid] = roster_cached["stats"]
                continue

            if eid not in field_stats or not field_stats[eid].get("avg_field_elo"):
                try:
                    p_url = f"{BCP_API_BASE}/events/{eid}/players"
                    p_req = urllib.request.Request(p_url, headers=headers)
                    with urllib.request.urlopen(p_req, timeout=1.8) as p_resp:
                        p_data = json.loads(p_resp.read().decode())
                        active_p = p_data.get("active", [])
                        if active_p:
                            p_ids = []
                            p_names = []
                            for p in active_p:
                                u = p.get("user") or {}
                                fn = u.get("firstName") or p.get("firstName") or ""
                                ln = u.get("lastName") or p.get("lastName") or ""
                                nm = f"{fn} {ln}".strip() or p.get("name")
                                pid = u.get("id") or p.get("userId") or p.get("id")
                                if pid: p_ids.append(pid)
                                if nm: p_names.append(nm.lower())

                            # Query ratings from PostgreSQL for these enrolled players
                            with db.get_connection() as conn:
                                with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cur:
                                    cur.execute("""
                                        SELECT player_id, LOWER(player_name) as player_name, current_elo
                                        FROM player_ratings
                                        WHERE player_id = ANY(%s) OR LOWER(player_name) = ANY(%s);
                                    """, (p_ids, p_names))
                                    rated_rows = cur.fetchall()
                                    found_ratings = {r["player_id"]: float(r["current_elo"]) for r in rated_rows if r.get("player_id")}
                                    name_ratings = {r["player_name"]: float(r["current_elo"]) for r in rated_rows if r.get("player_name")}

                            elos = []
                            for p in active_p:
                                u = p.get("user") or {}
                                fn = u.get("firstName") or p.get("firstName") or ""
                                ln = u.get("lastName") or p.get("lastName") or ""
                                nm = f"{fn} {ln}".strip().lower()
                                pid = u.get("id") or p.get("userId") or p.get("id")
                                p_elo = found_ratings.get(pid) or name_ratings.get(nm)
                                elos.append(p_elo if p_elo else 1500.0)

                            if elos:
                                calculated_stats = {
                                    "avg_field_elo": round(sum(elos) / len(elos), 1),
                                    "top_seed_elo": round(max(elos), 1),
                                    "total_enrolled": len(active_p),
                                    "rated_players_count": sum(1 for e in elos if e != 1500.0)
                                }
                                field_stats[eid] = calculated_stats
                                api_events_recommended._roster_cache[eid] = {
                                    "timestamp": now_ts,
                                    "stats": calculated_stats
                                }
                except Exception as pe:
                    logger.debug(f"Live roster fetch notice for {eid}: {pe}")

        for ev in bcp_events:
            ev_id = ev.get("id") or ev.get("objectId")
            if not ev_id or ev_id in seen_ids:
                continue
            seen_ids.add(ev_id)

            ev_name = ev.get("name") or "Tournament"
            ev_city = ev.get("city") or ""
            ev_state = ev.get("state") or ""
            ev_country = ev.get("country") or ""
            ev_date_raw = ev.get("eventDate") or ev.get("event_date")
            ev_date_str = str(ev_date_raw) if ev_date_raw else ""

            # Filter by search query keyword
            if query and query.strip():
                q_lower = query.strip().lower()
                full_text = f"{ev_name} {ev_city} {ev_state} {ev_country}".lower()
                if q_lower not in full_text:
                    continue

            # Filter by state if specified
            if target_state and target_state.lower() != "all" and not radius_miles:
                if (ev_state or "").strip().lower() != target_state.strip().lower():
                    continue

            # Distance calculation
            coord = ev.get("coordinate")
            if not coord and ev.get("raw_json"):
                try:
                    rj = ev["raw_json"] if isinstance(ev["raw_json"], dict) else json.loads(ev["raw_json"])
                    coord = rj.get("coordinate")
                except Exception:
                    pass

            dist_val = None
            ev_lat, ev_lng = None, None
            if coord and isinstance(coord, list) and len(coord) == 2:
                ev_lng, ev_lat = coord[0], coord[1]
            elif ev_city and ev_city.strip().lower() in KNOWN_CITIES:
                ev_lat, ev_lng = KNOWN_CITIES[ev_city.strip().lower()]

            if user_lat and user_lng and ev_lat and ev_lng:
                try:
                    dist_val = haversine_miles(float(user_lat), float(user_lng), float(ev_lat), float(ev_lng))
                except Exception:
                    pass

            if radius_miles and dist_val is not None and dist_val > radius_miles:
                continue

            # Extract raw_json if present
            raw_meta = {}
            if ev.get("raw_json"):
                try:
                    raw_meta = ev["raw_json"] if isinstance(ev["raw_json"], dict) else json.loads(ev["raw_json"])
                except Exception:
                    raw_meta = {}

            enrolled = int(ev.get("totalPlayers") or ev.get("total_players") or raw_meta.get("totalPlayers") or raw_meta.get("checkedInPlayers") or 0)
            
            raw_cap = (
                ev.get("numTickets") or raw_meta.get("numTickets") or 
                ev.get("queryNumPlayers") or raw_meta.get("queryNumPlayers") or 
                ev.get("maxPlayers") or raw_meta.get("maxPlayers") or 
                ev.get("capacity") or raw_meta.get("capacity") or
                ev.get("num_tickets") or raw_meta.get("num_tickets")
            )
            has_ticket_cap = raw_cap is not None and str(raw_cap).isdigit() and int(raw_cap) > 0
            cap = int(raw_cap) if has_ticket_cap else enrolled
            
            # Format time label
            time_label = "Upcoming"
            if ev_date_str:
                try:
                    ev_dt = datetime.fromisoformat(ev_date_str.replace("Z", "+00:00"))
                    delta_d = (ev_dt.date() - now_dt.date()).days
                    if delta_d == 0:
                        time_label = "Today"
                    elif delta_d == 1:
                        time_label = "Tomorrow"
                    elif delta_d > 1:
                        time_label = f"In {delta_d} days"
                except Exception:
                    pass

            # Tier strictly based on number of rounds: <=3 RTT/Local, 4-6 GT, >=7 Major
            rounds = int(ev.get("numberOfRounds") or ev.get("numRounds") or ev.get("numberOf_rounds") or ev.get("rounds") or 0)
            if rounds == 0:
                name_lower = ev_name.lower()
                if "major" in name_lower or "super major" in name_lower or "championship" in name_lower:
                    rounds = 7
                elif "gt" in name_lower or "grand tournament" in name_lower or "open" in name_lower:
                    rounds = 5
                else:
                    rounds = 3

            # Tier strictly based on number of rounds: <=3 RTT/Local, 4-6 GT, >=7 Major, with capacity sanity check
            tp = max(enrolled, cap)
            if rounds >= 7 or tp >= 60:
                tier = "Major"
                tier_badge = "tier-S"
                tier_baseline = 1720.0
            elif rounds >= 4 or tp >= 28:
                tier = "Grand Tournament"
                tier_badge = "tier-A"
                tier_baseline = 1620.0
            else:
                tier = "RTT / Local"
                tier_badge = "tier-B"
                tier_baseline = 1530.0

            # Dynamic Field Avg Elo from Enrolled Roster in PostgreSQL / BCP
            stats_entry = field_stats.get(str(ev_id)) or field_stats.get(ev_id)
            if stats_entry and stats_entry.get("avg_field_elo"):
                avg_elo_val = float(stats_entry["avg_field_elo"])
            else:
                avg_elo_val = tier_baseline

            if user_elo:
                diff = avg_elo_val - user_elo
                if enrolled <= 1:
                    skill_label = f"👥 {enrolled} Registered ({round(diff):+d} Elo)" if enrolled == 1 else "👥 Registration Open"
                    skill_badge = "badge-match-prime"
                elif abs(diff) <= 35:
                    skill_label = "🎯 Prime Skill Match"
                    skill_badge = "badge-match-prime"
                elif diff > 35 and diff <= 110:
                    skill_label = f"⚔️ Tough Field (+{round(diff)} Elo)"
                    skill_badge = "badge-match-hard"
                elif diff > 110:
                    skill_label = f"🦈 Shark Tank (+{round(diff)} Elo)"
                    skill_badge = "badge-match-extreme"
                else:
                    skill_label = f"🏆 Favorable Match ({round(diff)} Elo)"
                    skill_badge = "badge-match-favorable"
            else:
                if enrolled <= 1:
                    skill_label = f"👥 {enrolled} Registered" if enrolled == 1 else "👥 Registration Open"
                else:
                    skill_label = f"⭐ Field Avg: {round(avg_elo_val)} Elo"
                skill_badge = "badge-match-prime"

            processed_events.append({
                "id": ev_id,
                "name": ev_name,
                "event_date": ev_date_str,
                "city": ev_city,
                "state": ev_state,
                "country": ev_country,
                "total_players": enrolled,
                "enrolled_count": enrolled,
                "max_capacity": cap,
                "capacity_cap": cap,
                "has_ticket_cap": has_ticket_cap,
                "time_label": time_label,
                "tier": tier,
                "tier_badge": tier_badge,
                "distance_miles": round(dist_val, 1) if dist_val is not None else None,
                "is_nearby": bool(dist_val is not None and dist_val <= 60),
                "avg_elo_display": round(avg_elo_val, 1),
                "skill_match_label": skill_label,
                "skill_match_badge": skill_badge,
                "bcp_url": f"https://www.bestcoastpairings.com/event/{ev_id}"
            })

        # Filter by tier if specified
        if tier and tier.strip():
            t_target = tier.strip().lower()
            if t_target == "major":
                processed_events = [e for e in processed_events if e["tier"] == "Major"]
            elif "grand tournament" in t_target or t_target == "gt":
                processed_events = [e for e in processed_events if e["tier"] == "Grand Tournament"]
            elif "rtt" in t_target or "local" in t_target:
                processed_events = [e for e in processed_events if e["tier"] == "RTT / Local"]

        # Sort events based on selected sort_by mode (date soonest by default, distance, or elo)
        def event_sort_key(e):
            dt = e.get("event_date") or "9999-99-99"
            d = e.get("distance_miles")
            d_val = d if d is not None else 99999.0
            if sort_by == "distance":
                return (d_val, dt)
            elif sort_by == "elo":
                elo = float(e.get("avg_elo_display") or 0.0)
                return (-elo, dt, d_val)
            else:  # "date" (soonest first)
                return (dt, d_val)

        sorted_events = sorted(processed_events, key=event_sort_key)

        res = {
            "detected_state": detected_state,
            "detected_city": detected_city,
            "target_state": target_state,
            "user_elo": user_elo,
            "events": sorted_events[:limit],
            "total": len(sorted_events)
        }
        return res

    # API: Tournament Details & Round Pairings
    @app.get("/api/event/{event_id}", summary="Get tournament metadata, placings, and round pairings")
    async def api_event_details(event_id: str, force_sync: bool = False):
        db = get_database()
        event_id_str = event_id.strip()

        # Check existing data in DB
        event_details = db.get_event_details(event_id_str)

        # Auto-query BCP if:
        # 1) User explicitly requested force_sync
        # 2) Event is not yet in DB
        # 3) Event is ongoing/in-progress (is_ended is False)
        # 4) Event has 0 participants or matches scraped
        has_data = event_details and bool(event_details.get("players")) and bool(event_details.get("matches"))
        needs_roster_sync = (
            force_sync or 
            not has_data or 
            (event_details and all(p.get("pod_num") is None for p in event_details.get("players", [])) and (event_details.get("num_rounds", 0) >= 6 or event_details.get("total_players", 0) >= 48))
        )

        if needs_roster_sync:
            try:
                scraper = BestCoastPairingsScraper(db=db)
                scraper.sync_event_roster(event_id_str)
                if not has_data:
                    scraper.scrape_event(event_id_str)
                event_details = db.get_event_details(event_id_str)
            except Exception as e:
                logger.warning(f"Failed to sync BCP details for event {event_id_str}: {e}")
        elif event_details and not event_details.get("is_ended", True):
            # Background refresh for live ongoing tournament without blocking current response
            def bg_scrape():
                try:
                    s = BestCoastPairingsScraper(db=db)
                    s.scrape_event(event_id_str)
                except Exception:
                    pass
            import threading
            threading.Thread(target=bg_scrape, daemon=True).start()

        if not event_details:
            raise HTTPException(status_code=404, detail=f"Tournament '{event_id_str}' not found in database or on BCP")

        return event_details

    # API: Cloud Scheduler Cron Sync
    @app.post("/api/cron/sync-tournaments", summary="Cloud Scheduler cron to scrape latest tournaments and update Elo")
    @app.get("/api/cron/sync-tournaments", summary="Manual trigger to scrape latest tournaments and update Elo")
    async def api_cron_sync_tournaments(request: Request, background_tasks: BackgroundTasks):
        """Scrapes newly concluded BCP tournaments and recalculates Elo ratings."""
        def do_sync():
            try:
                db = get_database()
                scraper = BestCoastPairingsScraper(db=db)
                end_dt = datetime.now(timezone.utc)
                start_dt = end_dt - timedelta(days=3)
                start_str = start_dt.strftime("%Y-%m-%dT00:00:00.000Z")
                end_str = end_dt.strftime("%Y-%m-%dT23:59:59.999Z")
                
                logger.info(f"⏰ [CRON SYNC] Scraping tournaments from {start_str} to {end_str}...")
                res = scraper.scrape_date_range(start_date=start_str, end_date=end_str, max_events=50)
                logger.info(f"⏰ [CRON SYNC] Scraped {res.get('events_scraped', 0)} events, {res.get('matches_scraped', 0)} matches.")
                
                engine = get_elo_engine()
                recon_res = engine.reconstruct_incremental()
                logger.info(f"⏰ [CRON SYNC] Elo Reconstruction complete: {recon_res}")
            except Exception as err:
                logger.error(f"❌ [CRON SYNC] Error running scheduled tournament sync: {err}", exc_info=True)

        background_tasks.add_task(do_sync)
        return {
            "success": True,
            "message": "Scheduled BCP tournament sync and Elo recalculation task queued successfully."
        }

    # API: Past Head-to-Head Encounters
    @app.get("/api/head_to_head", summary="Get head-to-head encounters between two players")
    async def api_head_to_head(p1: str = Query(...), p2: str = Query(...)):
        return get_database().get_head_to_head(p1.strip(), p2.strip())

    # API: Unique Factions
    @app.get("/api/factions", summary="List all active Warhammer 40k factions")
    async def api_factions():
        stats = get_database().get_summary_stats()
        return stats.get("factions", [])

    # API: Faction Meta & Balance Analytics
    @app.get("/api/factions/meta", summary="Get global faction win rates and balance tier ratings")
    async def api_faction_meta(
        start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
        end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)")
    ):
        try:
            return get_database().get_faction_meta_stats(start_date=start_date, end_date=end_date)
        except Exception as e:
            logger.error(f"Error in /api/factions/meta: {e}")
            return {"factions": [], "monthly_trends": [], "error": str(e)}

    # API: Faction Details & Match History
    @app.get("/api/faction/{faction_name}", summary="Get faction detailed metrics, top players, and match history")
    async def api_faction_details(faction_name: str, limit: int = Query(100, ge=1, le=500)):
        return get_database().get_faction_details(faction_name.strip(), limit=limit)

    # API: Match Win Probability Predictor
    @app.get("/api/predict", summary="Calculate win odds and simulated Elo changes")
    async def api_predict(
        p1: Optional[str] = Query(None),
        p2: Optional[str] = Query(None),
        player1: Optional[str] = Query(None),
        player2: Optional[str] = Query(None)
    ):
        p1_name = p1 or player1 or ""
        p2_name = p2 or player2 or ""
        if not p1_name or not p2_name:
            raise HTTPException(status_code=400, detail="Missing p1 (player1) or p2 (player2) parameters")
        return get_elo_engine().predict_match_outcome(p1_name.strip(), p2_name.strip())



    # =========================================================================
    # NATIVE AUTHENTICATION & BCP LINKING APIS
    # =========================================================================

    class RegisterPayload(BaseModel):
        email: str
        password: str
        display_name: Optional[str] = None
        invite_code: Optional[str] = None

    class LoginPayload(BaseModel):
        email: str
        password: str

    class BCPConnectPayload(BaseModel):
        bcp_email: Optional[str] = None
        bcp_password: Optional[str] = None
        bcp_token: Optional[str] = None
        refresh_token: Optional[str] = None

    class ForgotPasswordPayload(BaseModel):
        email: str

    class ResetPasswordPayload(BaseModel):
        new_password: str
        token: Optional[str] = None
        code: Optional[str] = None
        email: Optional[str] = None

    class UserSettingsPayload(BaseModel):
        display_name: Optional[str] = None
        old_password: Optional[str] = None
        new_password: Optional[str] = None

    class VerifyRegistrationPayload(BaseModel):
        email: str
        code: str

    class ResendVerificationPayload(BaseModel):
        email: str

    @app.get("/api/auth/invite/validate", summary="Validate invitation code status")
    async def api_auth_validate_invite(code: str):
        auth_mgr = get_auth_manager()
        is_valid, err_msg, rec = auth_mgr.validate_invite_code(code)
        if not is_valid:
            return {"valid": False, "error": err_msg}
        return {
            "valid": True,
            "code": code.strip().upper(),
            "is_admin_code": rec.get("is_admin_code", False) if rec else False
        }

    @app.post("/api/auth/register", summary="Register a new native user account with 2FA email verification")
    async def api_auth_register(payload: RegisterPayload, response: Response):
        auth_mgr = get_auth_manager()
        res = auth_mgr.initiate_registration(
            payload.email, 
            payload.password, 
            payload.display_name or "", 
            invite_code=payload.invite_code
        )
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Registration failed"))
        return res

    @app.post("/api/auth/verify-registration", summary="Verify 6-digit email code to activate account")
    async def api_auth_verify_registration(request: Request, payload: VerifyRegistrationPayload, response: Response):
        auth_mgr = get_auth_manager()
        ua = request.headers.get("User-Agent")
        ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else None)
        if ip and "," in ip:
            ip = ip.split(",")[0].strip()
        res = auth_mgr.verify_registration_code(payload.email, payload.code, user_agent=ua, ip_address=ip)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Verification failed"))
        token = res.get("session_token")
        if token:
            response.set_cookie(key="session_token", value=token, max_age=2592000, path="/", httponly=False, samesite="lax")
        return res

    @app.post("/api/auth/resend-verification", summary="Resend 6-digit email verification code")
    async def api_auth_resend_verification(payload: ResendVerificationPayload):
        auth_mgr = get_auth_manager()
        res = auth_mgr.resend_registration_code(payload.email)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to resend code"))
        return res

    @app.post("/api/auth/login", summary="Login to native user account")
    async def api_auth_login(request: Request, payload: LoginPayload, response: Response):
        auth_mgr = get_auth_manager()
        ua = request.headers.get("User-Agent")
        ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else None)
        if ip and "," in ip:
            ip = ip.split(",")[0].strip()
        res = auth_mgr.login(payload.email, payload.password, user_agent=ua, ip_address=ip)
        if not res.get("success"):
            raise HTTPException(status_code=401, detail=res.get("error", "Invalid credentials"))
        token = res.get("session_token")
        if token:
            response.set_cookie(key="session_token", value=token, max_age=2592000, path="/", httponly=False, samesite="lax")
        return res

    @app.post("/api/auth/forgot-password", summary="Request password reset link and verification code via email")
    async def api_auth_forgot_password(payload: ForgotPasswordPayload):
        auth_mgr = get_auth_manager()
        res = auth_mgr.request_password_reset(payload.email)
        return res

    @app.get("/api/auth/reset-password/validate", summary="Validate password reset token or code")
    async def api_auth_validate_reset_token(token: Optional[str] = Query(None), code: Optional[str] = Query(None), email: Optional[str] = Query(None)):
        auth_mgr = get_auth_manager()
        res = auth_mgr.validate_reset_token(token=token, code=code, email=email)
        return res

    @app.post("/api/auth/reset-password", summary="Reset account password using token or email & code")
    async def api_auth_reset_password(payload: ResetPasswordPayload, response: Response):
        auth_mgr = get_auth_manager()
        res = auth_mgr.reset_password(
            new_password=payload.new_password,
            token=payload.token,
            code=payload.code,
            email=payload.email
        )
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Password reset failed"))
        token = res.get("session_token")
        if token:
            response.set_cookie(key="session_token", value=token, max_age=2592000, path="/", httponly=False, samesite="lax")
        return res

    @app.get("/api/auth/me", summary="Check active user session and BCP link status")
    async def api_auth_me(request: Request, token: Optional[str] = Query(None)):
        auth_header = request.headers.get("Authorization", "")
        session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        if not session_token:
            return {"authenticated": False}
        session = get_auth_manager().get_session(session_token)
        if not session:
            return {"authenticated": False}
        return {"authenticated": True, "user": session}

    @app.post("/api/auth/logout", summary="Logout current user session")
    async def api_auth_logout(request: Request, response: Response, token: Optional[str] = Query(None)):
        auth_header = request.headers.get("Authorization", "")
        session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        if session_token:
            get_auth_manager().logout(session_token)
        response.delete_cookie(key="session_token", path="/")
        return {"success": True}

    @app.post("/api/auth/logout-all", summary="Sign out user from all active devices")
    async def api_auth_logout_all(request: Request, response: Response, keep_current: bool = Query(False), token: Optional[str] = Query(None)):
        auth_header = request.headers.get("Authorization", "")
        session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        if not session_token:
            raise HTTPException(status_code=401, detail="Authentication required")
        auth_mgr = get_auth_manager()
        session = auth_mgr.get_session(session_token)
        if not session:
            raise HTTPException(status_code=401, detail="Invalid session")

        user_id = session["id"]
        token_to_keep = session_token if keep_current else None
        count = auth_mgr.logout_all_sessions(user_id, keep_current_token=token_to_keep)

        if not keep_current:
            response.delete_cookie(key="session_token", path="/")

        return {
            "success": True,
            "revoked_count": count,
            "signed_out_current": not keep_current,
            "message": f"Successfully signed out of {count} active device session(s)."
        }

    @app.get("/api/auth/sessions", summary="Get all active device sessions for current user")
    async def api_auth_get_sessions(request: Request, token: Optional[str] = Query(None)):
        auth_header = request.headers.get("Authorization", "")
        session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        if not session_token:
            raise HTTPException(status_code=401, detail="Authentication required")
        auth_mgr = get_auth_manager()
        session = auth_mgr.get_session(session_token)
        if not session:
            raise HTTPException(status_code=401, detail="Invalid session")

        sessions = auth_mgr.get_active_sessions(session["id"], current_token=session_token)
        return {
            "success": True,
            "sessions": sessions,
            "total_active": len(sessions)
        }

    @app.delete("/api/auth/sessions/{target_token}", summary="Revoke specific device session")
    async def api_auth_revoke_session(target_token: str, request: Request, token: Optional[str] = Query(None)):
        auth_header = request.headers.get("Authorization", "")
        session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        if not session_token:
            raise HTTPException(status_code=401, detail="Authentication required")
        auth_mgr = get_auth_manager()
        session = auth_mgr.get_session(session_token)
        if not session:
            raise HTTPException(status_code=401, detail="Invalid session")

        revoked = auth_mgr.revoke_session(session["id"], target_token)
        return {"success": revoked, "message": "Session revoked." if revoked else "Session not found."}

    @app.post("/api/user/settings", summary="Update user profile settings or change password")
    async def api_user_settings(request: Request, payload: UserSettingsPayload, token: Optional[str] = Query(None)):
        auth_header = request.headers.get("Authorization", "")
        session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        if not session_token:
            raise HTTPException(status_code=401, detail="Authentication required")
        session = get_auth_manager().get_session(session_token)
        if not session:
            raise HTTPException(status_code=401, detail="Invalid session")

        res = get_auth_manager().update_settings(
            session["id"],
            display_name=payload.display_name,
            old_password=payload.old_password,
            new_password=payload.new_password
        )
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to update settings"))
        return res

    @app.post("/api/user/bcp/connect", summary="Connect and link Best Coast Pairings account")
    async def api_user_bcp_connect(request: Request, payload: BCPConnectPayload, token: Optional[str] = Query(None)):
        auth_header = request.headers.get("Authorization", "")
        session_token = token or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        if not session_token:
            raise HTTPException(status_code=401, detail="Authentication required")
        session = get_auth_manager().get_session(session_token)
        if not session:
            raise HTTPException(status_code=401, detail="Invalid session")

        if payload.bcp_token:
            res = get_auth_manager().link_bcp_token(session["id"], payload.bcp_token, refresh_token=payload.refresh_token)
        else:
            if not payload.bcp_email or not payload.bcp_password:
                raise HTTPException(status_code=400, detail="BCP email and password or token required")
            res = get_auth_manager().link_bcp_account(session["id"], payload.bcp_email, payload.bcp_password)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to connect BCP account"))
        return res

    @app.post("/api/user/bcp/disconnect", summary="Unlink Best Coast Pairings account")
    async def api_user_bcp_disconnect(request: Request, token: Optional[str] = Query(None)):
        auth_header = request.headers.get("Authorization", "")
        session_token = token or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        if not session_token:
            raise HTTPException(status_code=401, detail="Authentication required")
        session = get_auth_manager().get_session(session_token)
        if not session:
            raise HTTPException(status_code=401, detail="Invalid session")

        return get_auth_manager().unlink_bcp_account(session["id"])

    @app.get("/api/user/dashboard", summary="Get personalized competitor hub analytics")
    async def api_user_dashboard(request: Request, player_id: Optional[str] = Query(None), token: Optional[str] = Query(None)):
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = token or (auth_header[7:] if auth_header.startswith("Bearer ") else None) or request.cookies.get("session_token")
        
        target_pid = player_id
        target_uid = None

        if session_token:
            session = auth_mgr.get_session(session_token)
            if session:
                target_uid = session.get("id")
                target_pid = target_pid or session.get("player_id")

        if not target_pid and not target_uid:
            top_p = get_database().get_top_ranked_players(limit=1)
            target_pid = top_p.get("items", [{}])[0].get("player_id", "demo") if isinstance(top_p, dict) else "demo"

        return auth_mgr.get_user_competitor_hub(player_id=target_pid, user_id=target_uid)

    class FeedbackPayload(BaseModel):
        feedback_type: str = "bug"
        message: str
        email: Optional[str] = None
        page_url: Optional[str] = None
        device_info: Optional[str] = None
        token: Optional[str] = None

    @app.post("/api/feedback", summary="Submit user feedback or bug report")
    async def api_submit_feedback(payload: FeedbackPayload, request: Request):
        if not payload.message or not payload.message.strip():
            raise HTTPException(status_code=400, detail="Feedback message cannot be empty.")

        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = payload.token or (auth_header[7:] if auth_header.startswith("Bearer ") else None) or request.cookies.get("session_token")
        
        user_id = None
        user_email = payload.email
        if session_token:
            session = auth_mgr.get_session(session_token)
            if session:
                user_id = session.get("id")
                user_email = session.get("email") or user_email

        if not user_id:
            raise HTTPException(status_code=401, detail="Please sign in with your OmniTactica account to submit feedback.")

        db = get_database()
        fb_id = db.save_feedback(
            feedback_type=payload.feedback_type or "bug",
            message=payload.message.strip(),
            user_id=user_id,
            user_email=user_email,
            page_url=payload.page_url,
            device_info=payload.device_info
        )
        return {"success": True, "id": fb_id, "message": "Thank you! Your feedback has been received."}

    @app.get("/api/feedback", summary="Get recent user feedbacks (Admin)")
    async def api_get_feedbacks(request: Request, limit: int = Query(50)):
        db = get_database()
        return db.get_feedbacks(limit=limit)

    def _is_admin_feedback_request(request: Request, token: Optional[str] = None) -> bool:
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = token or (auth_header[7:] if auth_header.startswith("Bearer ") else None) or request.cookies.get("session_token")
        if not session_token:
            return False
        session = auth_mgr.get_session(session_token)
        if not session:
            return False
        user_role = (session.get("role") or "player").strip().lower()
        return user_role in ("admin", "superuser", "developer", "owner", "to", "referee")

    class FeedbackUpdatePayload(BaseModel):
        status: Optional[str] = None
        admin_notes: Optional[str] = None
        message: Optional[str] = None
        feedback_type: Optional[str] = None
        token: Optional[str] = None

    @app.get("/api/admin/feedback", summary="Get filtered user feedbacks (Admin)")
    async def api_admin_get_feedbacks(request: Request, limit: int = Query(100), status: Optional[str] = Query(None), feedback_type: Optional[str] = Query(None), token: Optional[str] = Query(None)):
        if not _is_admin_feedback_request(request, token=token):
            raise HTTPException(status_code=403, detail="Admin access restricted to authorized administrators.")
        db = get_database()
        feedbacks = db.get_feedbacks(limit=limit, status=status, feedback_type=feedback_type)
        return {"success": True, "feedbacks": feedbacks}

    @app.post("/api/admin/feedback/{feedback_id}/update", summary="Update feedback status, admin notes, or message")
    async def api_admin_update_feedback(feedback_id: str, payload: FeedbackUpdatePayload, request: Request, token: Optional[str] = Query(None)):
        if not _is_admin_feedback_request(request, token=payload.token or token):
            raise HTTPException(status_code=403, detail="Admin access restricted to authorized administrators.")
        db = get_database()
        ok = db.update_feedback(
            feedback_id=feedback_id,
            status=payload.status,
            admin_notes=payload.admin_notes,
            message=payload.message,
            feedback_type=payload.feedback_type
        )
        if not ok:
            raise HTTPException(status_code=404, detail="Feedback entry not found")
        return {"success": True, "message": "Feedback updated successfully"}

    @app.delete("/api/admin/feedback/{feedback_id}", summary="Delete feedback entry from database")
    async def api_admin_delete_feedback(feedback_id: str, request: Request, token: Optional[str] = Query(None)):
        if not _is_admin_feedback_request(request, token=token):
            raise HTTPException(status_code=403, detail="Admin access restricted to authorized administrators.")
        db = get_database()
        ok = db.delete_feedback(feedback_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Feedback entry not found")
        return {"success": True, "message": "Feedback deleted successfully"}

    # =========================================================================
    # INVITATION CODES & PLATFORM GOVERNANCE (USER & ADMIN)
    # =========================================================================

    def _get_admin_session_or_403(request: Request, token: Optional[str] = None) -> Dict[str, Any]:
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        if not session_token:
            raise HTTPException(status_code=401, detail="Authentication required")
        session = auth_mgr.get_session(session_token)
        if not session:
            raise HTTPException(status_code=401, detail="Invalid session")
        user_role = (session.get("role") or "player").strip().lower()
        user_email = (session.get("email") or "").strip().lower()
        admin_emails = ('swimgeek751@gmail.com', 'hsiehjun@umich.edu', 'hsiehjun@google.com', 'hsiehjun@gmail.com')
        if user_role not in ("admin", "superuser", "developer", "owner") or user_email not in admin_emails:
            raise HTTPException(status_code=403, detail="Administrator privileges required")
        return session

    def _get_user_session_or_401(request: Request, token: Optional[str] = None) -> Dict[str, Any]:
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        if not session_token:
            raise HTTPException(status_code=401, detail="Authentication required")
        session = auth_mgr.get_session(session_token)
        if not session:
            raise HTTPException(status_code=401, detail="Invalid or expired session")
        return session

    @app.get("/api/auth/invite/my-code", summary="Get or generate user's active 24-hour invitation code")
    async def api_auth_my_invite_code(request: Request, token: Optional[str] = Query(None)):
        session = _get_user_session_or_401(request, token)
        auth_mgr = get_auth_manager()
        return auth_mgr.generate_user_invite_code(session["id"])

    @app.post("/api/auth/invite/generate", summary="Generate a fresh 24-hour invitation code")
    async def api_auth_generate_invite_code(request: Request, token: Optional[str] = Query(None)):
        session = _get_user_session_or_401(request, token)
        auth_mgr = get_auth_manager()
        return auth_mgr.generate_user_invite_code(session["id"])

    # --- ADMIN GOVERNANCE SCHEMAS & ROUTES ---
    class AdminCreateInvitePayload(BaseModel):
        code: str
        max_uses: Optional[int] = None
        expires_in_days: Optional[int] = None

    class AdminToggleInvitePayload(BaseModel):
        is_active: bool

    class AdminToggleSystemInvitesPayload(BaseModel):
        enabled: bool

    @app.get("/api/admin/metrics", summary="Platform KPIs & Registration Metrics (Admin)")
    async def api_admin_metrics(request: Request, token: Optional[str] = Query(None)):
        _get_admin_session_or_403(request, token)
        return get_auth_manager().get_admin_dashboard_metrics()

    @app.get("/api/admin/settings", summary="Get System Settings (Admin)")
    async def api_admin_get_settings(request: Request, token: Optional[str] = Query(None)):
        _get_admin_session_or_403(request, token)
        auth_mgr = get_auth_manager()
        return {
            "invites_enabled": auth_mgr.get_system_setting("invites_enabled", "true") == "true"
        }

    @app.post("/api/admin/settings/toggle-invites", summary="Global Master Kill Switch for Registrations (Admin)")
    async def api_admin_toggle_invites(payload: AdminToggleSystemInvitesPayload, request: Request, token: Optional[str] = Query(None)):
        admin = _get_admin_session_or_403(request, token)
        auth_mgr = get_auth_manager()
        val_str = "true" if payload.enabled else "false"
        ok = auth_mgr.set_system_setting("invites_enabled", val_str, user_id=admin.get("id"))
        return {"success": ok, "invites_enabled": payload.enabled}

    @app.get("/api/admin/invites", summary="List All Invitation Codes (Admin)")
    async def api_admin_get_invites(request: Request, token: Optional[str] = Query(None)):
        _get_admin_session_or_403(request, token)
        return {"codes": get_auth_manager().get_admin_invite_codes()}

    @app.post("/api/admin/invites/create", summary="Create Persistent / Custom Invitation Code (Admin)")
    async def api_admin_create_invite(payload: AdminCreateInvitePayload, request: Request, token: Optional[str] = Query(None)):
        admin = _get_admin_session_or_403(request, token)
        res = get_auth_manager().create_admin_invite_code(
            admin_user_id=admin.get("id"),
            code_str=payload.code,
            max_uses=payload.max_uses,
            expires_in_days=payload.expires_in_days
        )
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to create code"))
        return res

    @app.delete("/api/admin/invites/{code}", summary="Delete Invitation Code (Admin)")
    async def api_admin_delete_invite(code: str, request: Request, token: Optional[str] = Query(None)):
        _get_admin_session_or_403(request, token)
        return get_auth_manager().delete_admin_invite_code(code)

    @app.post("/api/admin/invites/{code}/toggle", summary="Toggle Active Status of Invitation Code (Admin)")
    async def api_admin_toggle_invite(code: str, payload: AdminToggleInvitePayload, request: Request, token: Optional[str] = Query(None)):
        _get_admin_session_or_403(request, token)
        return get_auth_manager().toggle_invite_code(code, payload.is_active)

    @app.get("/api/admin/referrals", summary="Get Referral Audit Log & Who-Invited-Who (Admin)")
    async def api_admin_get_referrals(request: Request, token: Optional[str] = Query(None)):
        _get_admin_session_or_403(request, token)
        return {"referrals": get_auth_manager().get_admin_referrals()}

    @app.get("/api/admin/users", summary="Get User Directory with Inviter Lineage (Admin)")
    async def api_admin_get_users(request: Request, token: Optional[str] = Query(None)):
        _get_admin_session_or_403(request, token)
        return {"users": get_auth_manager().get_admin_users()}



def start_server(port: int = 8080, host: str = "0.0.0.0"):
    """Starts the FastAPI Uvicorn ASGI server."""
    logger.info(f"Starting Warhammer 40k Elo Ranking FastAPI Server on http://{host}:{port}")
    logger.info(f"Swagger API Documentation available at http://{host}:{port}/docs")
    if FASTAPI_AVAILABLE:
        uvicorn.run(app, host=host, port=port, log_level="info")
    else:
        logger.error("FastAPI or Uvicorn not installed. Please run 'pip install -r requirements.txt'.")
        raise RuntimeError("FastAPI or Uvicorn not installed. Run 'pip3 install -r requirements.txt'.")


if __name__ == "__main__":
    import sys
    port = 8080
    host = "0.0.0.0"
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    if len(sys.argv) > 2:
        host = sys.argv[2]
    start_server(port=port, host=host)
