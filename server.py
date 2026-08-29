"""Modern FastAPI Server and Async REST API for Warhammer 40k Elo Ranking UI."""

import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional
from pydantic import BaseModel

try:
    from fastapi import FastAPI, HTTPException, Query, Request, Response
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
    from fastapi.staticfiles import StaticFiles
    import uvicorn
    FASTAPI_AVAILABLE = True
except ImportError:
    FASTAPI_AVAILABLE = False

try:
    from google3.experimental.users.hsiehjun.EloRanking.config import (
        DEFAULT_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR,
        MIN_MATCHES_FOR_RANKING, get_package_dir, DATABASE_URL
    )
    from google3.experimental.users.hsiehjun.EloRanking.database import Database, get_db
    from google3.experimental.users.hsiehjun.EloRanking.scraper import BestCoastPairingsScraper
    from google3.experimental.users.hsiehjun.EloRanking.elo import EloEngine
except ImportError:
    try:
        from experimental.users.hsiehjun.EloRanking.config import (
            DEFAULT_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR,
            MIN_MATCHES_FOR_RANKING, get_package_dir, DATABASE_URL
        )
        from experimental.users.hsiehjun.EloRanking.database import Database, get_db
        from experimental.users.hsiehjun.EloRanking.scraper import BestCoastPairingsScraper
        from experimental.users.hsiehjun.EloRanking.elo import EloEngine
    except ImportError:
        from config import (
            DEFAULT_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR,
            MIN_MATCHES_FOR_RANKING, get_package_dir, DATABASE_URL
        )
        from database import Database, get_db
        from scraper import BestCoastPairingsScraper
        from elo import EloEngine
        from auth import get_auth_manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("EloAPI")

# Initialize Database & EloEngine Singletons
_db_instance = None
_engine_instance = None

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
        title="Warhammer 40,000 Elo Ranking API",
        version="2.0.0",
        description="High-performance async API for Best Coast Pairings match history, player Elo standings, and tournament pairings.",
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
    if (web_dir / "css").exists():
        app.mount("/css", StaticFiles(directory=str(web_dir / "css")), name="css")
    if (web_dir / "js").exists():
        app.mount("/js", StaticFiles(directory=str(web_dir / "js")), name="js")

    # Root & HTML routes
    @app.get("/", include_in_schema=False)
    @app.get("/index.html", include_in_schema=False)
    async def serve_index():
        idx_file = web_dir / "index.html"
        if idx_file.exists():
            return FileResponse(str(idx_file), media_type="text/html")
        raise HTTPException(status_code=404, detail="index.html not found")

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
        min_roster: int = Query(2, ge=1),
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
    @app.get("/api/events", summary="List tournaments with date and status filters")
    async def api_events(
        limit: int = Query(150, ge=1, le=500),
        query: Optional[str] = Query(None),
        status: str = Query("all"),
        sort_by: str = Query("event_date"),
        order: str = Query("DESC")
    ):
        return get_database().get_events_list(
            limit=limit,
            query=query.strip() if query else None,
            status=status,
            sort_by=sort_by,
            order=order
        )

    # API: Tournament Details & Round Pairings
    @app.get("/api/event/{event_id}", summary="Get tournament metadata, placings, and round pairings")
    async def api_event_details(event_id: str):
        db = get_database()
        event_details = db.get_event_details(event_id.strip())
        if event_details and len(event_details.get("players", [])) == 0:
            # On-demand roster fetch for in-progress tournaments
            try:
                scraper = BestCoastPairingsScraper(db=db)
                enrolled = scraper.fetch_event_players(event_id)
                if enrolled:
                    for p in enrolled:
                        user = p.get("user") or {}
                        user_id = user.get("id") or p.get("userId") or p.get("user_id") or p.get("id")
                        if not user_id:
                            continue
                        first_name = user.get("firstName") or p.get("firstName") or ""
                        last_name = user.get("lastName") or p.get("lastName") or ""
                        full_name = f"{first_name} {last_name}".strip() or p.get("name") or user.get("name") or "Player"
                        
                        faction_obj = p.get("faction") or p.get("parentFaction") or ""
                        faction_name = faction_obj.get("name", "") if isinstance(faction_obj, dict) else str(faction_obj or "")
                        team_obj = p.get("team") or ""
                        team_name = team_obj.get("name", "") if isinstance(team_obj, dict) else str(team_obj or "")

                        db.upsert_player(user_id, first_name, last_name, full_name, team_name)
                        db.upsert_event_participant(
                            event_id=event_id,
                            player_id=user_id,
                            first_name=first_name,
                            last_name=last_name,
                            full_name=full_name,
                            faction=faction_name,
                            dropped=bool(p.get("dropped")),
                            checked_in=bool(p.get("checkedIn"))
                        )
                    event_details = db.get_event_details(event_id.strip())
            except Exception as e:
                logger.warning(f"On-demand roster fetch failed for {event_id}: {e}")

        return event_details

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
    async def api_predict(p1: str = Query(...), p2: str = Query(...)):
        return get_elo_engine().predict_match_outcome(p1.strip(), p2.strip())



    # =========================================================================
    # NATIVE AUTHENTICATION & BCP LINKING APIS
    # =========================================================================

    class RegisterPayload(BaseModel):
        email: str
        password: str
        display_name: Optional[str] = None

    class LoginPayload(BaseModel):
        email: str
        password: str

    class BCPConnectPayload(BaseModel):
        bcp_email: str
        bcp_password: str

    @app.post("/api/auth/register", summary="Register a new native user account")
    async def api_auth_register(payload: RegisterPayload):
        auth_mgr = get_auth_manager()
        res = auth_mgr.register(payload.email, payload.password, payload.display_name or "")
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Registration failed"))
        return res

    @app.post("/api/auth/login", summary="Login to native user account")
    async def api_auth_login(payload: LoginPayload):
        auth_mgr = get_auth_manager()
        res = auth_mgr.login(payload.email, payload.password)
        if not res.get("success"):
            raise HTTPException(status_code=401, detail=res.get("error", "Invalid credentials"))
        return res

    @app.get("/api/auth/me", summary="Check active user session and BCP link status")
    async def api_auth_me(request: Request, token: Optional[str] = Query(None)):
        auth_header = request.headers.get("Authorization", "")
        session_token = token or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        if not session_token:
            return {"authenticated": False}
        session = get_auth_manager().get_session(session_token)
        if not session:
            return {"authenticated": False}
        return {"authenticated": True, "user": session}

    @app.post("/api/auth/logout", summary="Logout current user session")
    async def api_auth_logout(request: Request, token: Optional[str] = Query(None)):
        auth_header = request.headers.get("Authorization", "")
        session_token = token or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        if session_token:
            get_auth_manager().logout(session_token)
        return {"success": True}

    @app.post("/api/user/bcp/connect", summary="Connect and link Best Coast Pairings account")
    async def api_user_bcp_connect(request: Request, payload: BCPConnectPayload, token: Optional[str] = Query(None)):
        auth_header = request.headers.get("Authorization", "")
        session_token = token or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        if not session_token:
            raise HTTPException(status_code=401, detail="Authentication required")
        session = get_auth_manager().get_session(session_token)
        if not session:
            raise HTTPException(status_code=401, detail="Invalid session")

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
        session_token = token or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        
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
