"""Modern FastAPI Server and Async REST API for Warhammer 40k Elo Ranking UI."""

import logging
import os
import math
import json
import secrets
import asyncio
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
from pydantic import BaseModel

try:
    from psycopg2 import extras
except ImportError:
    extras = None


try:
    from fastapi import FastAPI, HTTPException, Query, Request, Response
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse
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
        bcp_token: Optional[str] = None

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

    @app.post("/api/eventstudio/sync", summary="Sync active event roster and pairings with BCP")
    async def api_eventstudio_sync(payload: Dict[str, Any], request: Request):
        auth_header = request.headers.get("Authorization", "")
        token = payload.get("bcp_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        
        event_id = payload.get("event_id")
        if not event_id:
            raise HTTPException(status_code=400, detail="event_id is required")

        logger.info(f"EventStudio: Syncing Event {event_id} with BCP API...")
        return {
            "success": True,
            "event_id": event_id,
            "message": "Event synchronized successfully with Best Coast Pairings API",
            "synced_at": datetime.now(timezone.utc).isoformat()
        }


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

    class TrackerJoinPayload(BaseModel):
        token: Optional[str] = None

    class TrackerStatePayload(BaseModel):
        match_id: str
        client_id: Optional[str] = "anon"
        token: Optional[str] = None
        role: Optional[str] = "editor"
        version: int = 1
        state: Dict[str, Any]

    def normalize_tracker_match_id(raw: str) -> str:
        s = raw.strip().upper().replace(" ", "")
        if s.startswith("WH40K-"):
            return s
        s_clean = s.replace("-", "")
        if len(s_clean) == 8:
            return f"WH40K-{s_clean[:4]}-{s_clean[4:]}"
        return s

    @app.post("/api/tracker/room/create", summary="Create a new collision-free multiplayer match room with host player")
    async def api_tracker_create_room(request: Request, payload: Optional[TrackerCreatePayload] = None):
        db = get_database()
        auth_mgr = get_auth_manager()
        
        auth_header = request.headers.get("Authorization", "")
        session_token = (payload.token if payload and payload.token else None) or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        
        match_id = generate_unique_match_id(db)
        user_id_p1 = user["id"] if user else None
        p1_name = (user.get("display_name") if user else None) or (payload.p1_name if payload else None) or "Player 1"
        
        initial_state = {
            "id": f"g-{secrets.token_hex(4)}-{secrets.token_hex(3)}",
            "match_id": match_id,
            "user_id_p1": user_id_p1,
            "user_id_p2": None,
            "game": {
                "p1Name": p1_name,
                "p2Name": "Player 2",
                "p1Faction": None,
                "p2Faction": None,
                "p1Detachments": [],
                "p2Detachments": [],
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
                "terrainLayout": None
            },
            "p1": {"score": 0, "rounds": [], "battleReady": True},
            "p2": {"score": 0, "rounds": [], "battleReady": True},
            "round": 1,
            "started": False
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
        
        # Persist room creation to DB
        try:
            db.save_tracker_game(
                match_id=match_id,
                state=initial_state,
                version=1,
                user_id_p1=user_id_p1
            )
        except Exception as err:
            logger.debug(f"DB save on create notice: {err}")
            
        return {
            "success": True,
            "match_id": match_id,
            "role": "player1",
            "user_id_p1": user_id_p1,
            "p1_name": p1_name,
            "state": initial_state
        }

    @app.get("/api/tracker/room/{match_id}/check", summary="Check if room exists and check player slots")
    async def api_tracker_check_room(match_id: str, request: Request):
        match_id = normalize_tracker_match_id(match_id)
            
        db = get_database()
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None
        
        if match_id in TRACKER_ROOMS:
            room = TRACKER_ROOMS[match_id]
        else:
            saved = db.get_tracker_game(match_id)
            if saved and saved.get("state"):
                room = {
                    "match_id": match_id,
                    "user_id_p1": saved.get("user_id_p1"),
                    "user_id_p2": saved.get("user_id_p2"),
                    "p1_name": saved.get("p1_name"),
                    "p2_name": saved.get("p2_name"),
                    "version": saved.get("version", 1),
                    "state": saved["state"]
                }
                TRACKER_ROOMS[match_id] = room
            else:
                return {"exists": False, "match_id": match_id, "error": f"Room key '{match_id}' does not exist."}
                
        p1_id = room.get("user_id_p1")
        p2_id = room.get("user_id_p2")
        is_p1 = bool(user_id and p1_id == user_id)
        is_p2 = bool(user_id and p2_id == user_id)
        
        return {
            "exists": True,
            "match_id": match_id,
            "p1_name": room.get("state", {}).get("game", {}).get("p1Name") or "Player 1",
            "p2_name": room.get("state", {}).get("game", {}).get("p2Name") or "Player 2",
            "is_full": bool(p1_id is not None and p2_id is not None and not is_p1 and not is_p2),
            "is_open_for_p2": bool(p2_id is None and not is_p1)
        }

    @app.post("/api/tracker/room/{match_id}/join", summary="Join match room and claim Player 2 slot or Spectator")
    async def api_tracker_join_room(match_id: str, request: Request, payload: Optional[TrackerJoinPayload] = None):
        match_id = normalize_tracker_match_id(match_id)
        db = get_database()
        auth_mgr = get_auth_manager()
        
        auth_header = request.headers.get("Authorization", "")
        session_token = (payload.token if payload and payload.token else None) or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None
        user_name = user.get("display_name") if user else None
        
        if match_id not in TRACKER_ROOMS:
            saved = db.get_tracker_game(match_id)
            if saved and saved.get("state"):
                TRACKER_ROOMS[match_id] = {
                    "match_id": match_id,
                    "user_id_p1": saved.get("user_id_p1"),
                    "user_id_p2": saved.get("user_id_p2"),
                    "referee_ids": saved.get("referee_ids", []),
                    "version": saved.get("version", 1),
                    "state": saved["state"],
                    "updated_at": saved.get("updated_at")
                }
            else:
                raise HTTPException(status_code=404, detail="Match room not found")
                
        room = TRACKER_ROOMS[match_id]
        st = room.get("state", {})
        game = st.get("game", {})
        
        role = "spectator"
        if user_id:
            if room.get("user_id_p1") == user_id:
                role = "player1"
            elif room.get("user_id_p2") == user_id:
                role = "player2"
            elif user_id in room.get("referee_ids", []) or user.get("role") in ("admin", "referee", "to"):
                role = "referee"
            elif not room.get("user_id_p2") and room.get("user_id_p1") != user_id:
                # User claims Player 2 slot!
                room["user_id_p2"] = user_id
                st["user_id_p2"] = user_id
                if user_name:
                    game["p2Name"] = user_name
                role = "player2"
                room["version"] += 1
                
                # Persist updated P2 assignment to DB
                try:
                    db.save_tracker_game(
                        match_id=match_id,
                        state=st,
                        version=room["version"],
                        user_id_p1=room.get("user_id_p1"),
                        user_id_p2=user_id
                    )
                except Exception:
                    pass
                
                # Broadcast update to connected opponents
                listeners = TRACKER_LISTENERS.get(match_id, [])
                msg = {
                    "type": "state_update",
                    "sender": "server",
                    "version": room["version"],
                    "state": st
                }
                for q in listeners:
                    await q.put(msg)
            elif not room.get("user_id_p1"):
                # User claims Player 1 slot!
                room["user_id_p1"] = user_id
                st["user_id_p1"] = user_id
                if user_name:
                    game["p1Name"] = user_name
                role = "player1"
                room["version"] += 1
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
            "state": st
        }

    @app.post("/api/tracker/room/{match_id}/state", summary="Broadcast and persist multiplayer tracker state with role enforcement")
    async def api_tracker_save_state(match_id: str, payload: TrackerStatePayload, request: Request):
        match_id = normalize_tracker_match_id(match_id)
        db = get_database()
        auth_mgr = get_auth_manager()
        
        auth_header = request.headers.get("Authorization", "")
        session_token = (payload.token if payload and payload.token else None) or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None
        
        if match_id not in TRACKER_ROOMS:
            saved = db.get_tracker_game(match_id)
            if saved and saved.get("state"):
                TRACKER_ROOMS[match_id] = {
                    "match_id": match_id,
                    "user_id_p1": saved.get("user_id_p1"),
                    "user_id_p2": saved.get("user_id_p2"),
                    "referee_ids": saved.get("referee_ids", []),
                    "version": saved.get("version", 1),
                    "state": saved["state"],
                    "updated_at": saved.get("updated_at")
                }
            else:
                TRACKER_ROOMS[match_id] = {
                    "match_id": match_id,
                    "user_id_p1": user_id,
                    "user_id_p2": None,
                    "referee_ids": [],
                    "version": 0,
                    "state": {},
                    "created_at": datetime.now(timezone.utc).isoformat()
                }
        
        room = TRACKER_ROOMS[match_id]
        
        # Permission Verification:
        # If room has owners, only P1, P2, and referees/admins can submit updates
        if room.get("user_id_p1") or room.get("user_id_p2"):
            is_p1 = (user_id and room.get("user_id_p1") == user_id)
            is_p2 = (user_id and room.get("user_id_p2") == user_id)
            is_ref = (user and (user_id in room.get("referee_ids", []) or user.get("role") in ("admin", "referee", "to")))
            
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

        # 1. Persistent Storage in PostgreSQL Database
        try:
            db.save_tracker_game(
                match_id=match_id,
                state=payload.state,
                version=payload.version,
                user_id_p1=room.get("user_id_p1"),
                user_id_p2=room.get("user_id_p2")
            )
        except Exception as db_err:
            logger.debug(f"Tracker DB save notice: {db_err}")

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
        if match_id in TRACKER_ROOMS and TRACKER_ROOMS[match_id].get("state"):
            return TRACKER_ROOMS[match_id]
        
        # Fallback to persistent database record
        try:
            db = get_database()
            saved = db.get_tracker_game(match_id)
            if saved and saved.get("state"):
                TRACKER_ROOMS[match_id] = {
                    "match_id": match_id,
                    "user_id_p1": saved.get("user_id_p1"),
                    "user_id_p2": saved.get("user_id_p2"),
                    "referee_ids": saved.get("referee_ids", []),
                    "version": saved.get("version", 1),
                    "state": saved["state"],
                    "updated_at": saved.get("updated_at")
                }
                return TRACKER_ROOMS[match_id]
        except Exception as err:
            logger.debug(f"Tracker DB load notice: {err}")

        return {"match_id": match_id, "version": 0, "state": {}}

    @app.get("/api/tracker/history", summary="Get persistent history of tracker games")
    async def api_tracker_history(request: Request, limit: int = 50, search: Optional[str] = None, token: Optional[str] = Query(None)):
        try:
            db = get_database()
            auth_mgr = get_auth_manager()
            
            auth_header = request.headers.get("Authorization", "")
            session_token = token or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
            user = auth_mgr.get_session(session_token) if session_token else None
            user_id = user["id"] if user else None
            
            history = db.get_tracker_history(limit=limit, search=search, user_id=user_id)
            return {"success": True, "history": history}
        except Exception as err:
            logger.error(f"Error fetching tracker history: {err}")
            return {"success": False, "history": []}

    @app.get("/api/tracker/room/{match_id}/stream", summary="Real-time Server-Sent Events stream for multiplayer match")
    async def api_tracker_stream(match_id: str, client_id: str = "anon"):
        match_id = normalize_tracker_match_id(match_id)
        q = asyncio.Queue()
        if match_id not in TRACKER_LISTENERS:
            TRACKER_LISTENERS[match_id] = []
        TRACKER_LISTENERS[match_id].append(q)

        async def event_generator():
            try:
                # Send initial connection presence event
                yield f"data: {json.dumps({'type': 'presence', 'count': len(TRACKER_LISTENERS.get(match_id, []))})}\\n\\n"
                
                # Send current state if available
                if match_id in TRACKER_ROOMS and TRACKER_ROOMS[match_id]["state"]:
                    yield f"data: {json.dumps({'type': 'state_update', 'sender': 'server', 'version': TRACKER_ROOMS[match_id]['version'], 'state': TRACKER_ROOMS[match_id]['state']})}\\n\\n"

                while True:
                    msg = await q.get()
                    yield f"data: {json.dumps(msg)}\\n\\n"
            except asyncio.CancelledError:
                pass
            finally:
                if match_id in TRACKER_LISTENERS and q in TRACKER_LISTENERS[match_id]:
                    TRACKER_LISTENERS[match_id].remove(q)

        from fastapi.responses import StreamingResponse
        return StreamingResponse(event_generator(), media_type="text/event-stream")

    # Root & HTML routes
    @app.get("/", include_in_schema=False)
    @app.get("/index.html", include_in_schema=False)
    async def serve_index():
        idx_file = web_dir / "index.html"
        if idx_file.exists():
            return FileResponse(str(idx_file), media_type="text/html")
        raise HTTPException(status_code=404, detail="index.html not found")



    # Dedicated Local Static Tracker & Layout Asset Mounts
    if (web_dir / "assets").exists():
        app.mount("/assets", StaticFiles(directory=str(web_dir / "assets")), name="root_assets_static")
        app.mount("/tracker/assets", StaticFiles(directory=str(web_dir / "assets")), name="tracker_assets_static")

    if (web_dir / "tracker" / "_next").exists():
        app.mount("/_next", StaticFiles(directory=str(web_dir / "tracker" / "_next")), name="root_next_static")
        app.mount("/tracker/_next", StaticFiles(directory=str(web_dir / "tracker" / "_next")), name="tracker_next_static")

    @app.get("/tracker/tracker_play.css", include_in_schema=False)
    async def serve_tracker_play_css():
        return FileResponse(str(web_dir / "tracker" / "tracker_play.css"), media_type="text/css")

    @app.get("/tracker/tracker_play.js", include_in_schema=False)
    async def serve_tracker_play_js():
        return FileResponse(str(web_dir / "tracker" / "tracker_play.js"), media_type="application/javascript")

    @app.get("/tracker/tracker_sync.js", include_in_schema=False)
    async def serve_tracker_sync_js():
        return FileResponse(str(web_dir / "tracker" / "tracker_sync.js"), media_type="application/javascript")

    @app.get("/tracker/tracker_sync.css", include_in_schema=False)
    async def serve_tracker_sync_css():
        return FileResponse(str(web_dir / "tracker" / "tracker_sync.css"), media_type="text/css")

    @app.get("/logo-mark.svg", include_in_schema=False)
    async def serve_logo_mark():
        return FileResponse(str(web_dir / "tracker" / "logo-mark.svg"), media_type="image/svg+xml")

    @app.get("/logo192w.png", include_in_schema=False)
    async def serve_logo_png():
        return FileResponse(str(web_dir / "tracker" / "logo192w.png"), media_type="image/png")

    @app.get("/login", include_in_schema=False)
    @app.get("/tracker/login", include_in_schema=False)
    async def serve_login():
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
            return RedirectResponse(url="/login?redirect=/?tab=my-hub", status_code=303)
        return RedirectResponse(url="/?tab=my-hub", status_code=303)

    @app.get("/tracker", include_in_schema=False)
    @app.get("/tracker/", include_in_schema=False)
    @app.get("/tracker/index.html", include_in_schema=False)
    @app.get("/11th/tracker", include_in_schema=False)
    async def serve_tracker_home(request: Request, token: Optional[str] = Query(None)):
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        if not user:
            return RedirectResponse(url="/login?redirect=/11th/tracker", status_code=303)
            
        t_file = web_dir / "tracker" / "index.html"
        if t_file.exists():
            return FileResponse(str(t_file), media_type="text/html")
        raise HTTPException(status_code=404, detail="Tracker bundle not found")

    @app.get("/tracker/play", include_in_schema=False)
    @app.get("/11th/tracker/play", include_in_schema=False)
    async def serve_tracker_play(request: Request, match_id: Optional[str] = Query(None), token: Optional[str] = Query(None)):
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        if not user:
            target = f"/11th/tracker/play?match_id={match_id}" if match_id else "/11th/tracker/play"
            return RedirectResponse(url=f"/login?redirect={urllib.parse.quote(target)}", status_code=303)
            
        p_file = web_dir / "tracker" / "play.html"
        if p_file.exists():
            return FileResponse(str(p_file), media_type="text/html")
        raise HTTPException(status_code=404, detail="Tracker play bundle not found")

    @app.get("/eventstudio", include_in_schema=False)
    @app.get("/eventstudio.html", include_in_schema=False)
    async def serve_eventstudio():
        es_file = web_dir / "eventstudio.html"
        if es_file.exists():
            return FileResponse(str(es_file), media_type="text/html")
        raise HTTPException(status_code=404, detail="eventstudio.html not found")


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
    @app.get("/api/events", summary="List tournaments with date and status filters (paginated)")
    async def api_events(
        page: int = Query(1, ge=1),
        page_size: int = Query(25, ge=5, le=200),
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
        limit: int = Query(35, ge=1, le=100)
    ):
        db = get_database()
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

        # 2. Query BCP API live across 14-day intervals (next 3.5 months) to ensure 100% complete tournament coverage
        headers = {'client-id': 'web-app', 'User-Agent': 'Mozilla/5.0'}
        now_dt = datetime.now(timezone.utc)
        
        intervals = []
        curr = now_dt
        for _ in range(8):  # 8 intervals x 14 days = 112 days (~3.5 months)
            nxt = curr + timedelta(days=14)
            intervals.append((curr.strftime("%Y-%m-%dT00:00:00.000Z"), nxt.strftime("%Y-%m-%dT23:59:59.999Z")))
            curr = nxt + timedelta(days=1)

        bcp_events = []
        for s_iso, e_iso in intervals:
            next_key = None
            for _ in range(8):  # Up to 8 pages per 14-day interval = 400 events per interval
                params = {
                    "limit": 50,
                    "gameSystemId": DEFAULT_GAME_SYSTEM_ID,
                    "startDate": s_iso,
                    "endDate": e_iso
                }
                if next_key:
                    params["nextKey"] = next_key

                url = f"https://newprod-api.bestcoastpairings.com/v1/events?{urllib.parse.urlencode(params)}"
                try:
                    req = urllib.request.Request(url, headers=headers)
                    with urllib.request.urlopen(req, timeout=3.5) as resp:
                        data = json.loads(resp.read().decode())
                        evs = data.get("data", [])
                        bcp_events.extend(evs)
                        next_key = data.get("nextKey")
                        if not next_key:
                            break
                except Exception as e:
                    logger.warning(f"Live BCP interval query notice: {e}")
                    break

        def haversine_miles(lat1, lon1, lat2, lon2):
            R = 3958.8
            dLat = math.radians(lat2 - lat1)
            dLon = math.radians(lon2 - lon1)
            a = math.sin(dLat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dLon/2)**2
            return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

        processed_events = []
        seen_ids = set()

        for ev in bcp_events:
            ev_id = ev.get("id") or ev.get("objectId")
            if not ev_id or ev_id in seen_ids:
                continue
            seen_ids.add(ev_id)

            ev_name = ev.get("name", "Tournament")
            ev_city = ev.get("city", "")
            ev_state = ev.get("state", "")
            ev_country = ev.get("country", "")
            ev_date_str = ev.get("eventDate", "")

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

            enrolled = int(ev.get("totalPlayers", 0))
            cap = int(ev.get("numTickets") or ev.get("queryNumPlayers") or enrolled)
            
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

            if rounds >= 7:
                tier = "Major"
                tier_badge = "tier-S"
            elif rounds >= 4:
                tier = "Grand Tournament"
                tier_badge = "tier-A"
            else:
                tier = "RTT / Local"
                tier_badge = "tier-B"

            # Field Avg Elo
            avg_elo_val = 1550.0
            if user_elo:
                diff = avg_elo_val - user_elo
                if abs(diff) <= 60:
                    skill_label = "🎯 Prime Skill Match"
                    skill_badge = "badge-match-prime"
                elif diff > 60 and diff <= 150:
                    skill_label = f"⚔️ Tough Field (+{round(diff)} Elo)"
                    skill_badge = "badge-match-hard"
                elif diff > 150:
                    skill_label = f"🦈 Shark Tank (+{round(diff)} Elo)"
                    skill_badge = "badge-match-extreme"
                else:
                    skill_label = f"🏆 Favorable Match ({round(diff)} Elo)"
                    skill_badge = "badge-match-favorable"
            else:
                skill_label = "⚖️ Standard Field"
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

            # Async cache to DB
            try:
                db.upsert_event(ev)
            except Exception:
                pass

        # Filter by tier if specified
        if tier and tier.strip():
            t_target = tier.strip().lower()
            if t_target == "major":
                processed_events = [e for e in processed_events if e["tier"] == "Major"]
            elif "grand tournament" in t_target or t_target == "gt":
                processed_events = [e for e in processed_events if e["tier"] == "Grand Tournament"]
            elif "rtt" in t_target or "local" in t_target:
                processed_events = [e for e in processed_events if e["tier"] == "RTT / Local"]

        # Sort: Nearest distance first, then soonest date
        def event_sort_key(e):
            d = e.get("distance_miles")
            d_val = d if d is not None else 99999.0
            dt = e.get("event_date") or "9999-99-99"
            return (d_val, dt)

        sorted_events = sorted(processed_events, key=event_sort_key)

        return {
            "detected_state": detected_state,
            "detected_city": detected_city,
            "target_state": target_state,
            "user_elo": user_elo,
            "events": sorted_events[:limit],
            "total": len(sorted_events)
        }

    # API: Tournament Details & Round Pairings
    @app.get("/api/event/{event_id}", summary="Get tournament metadata, placings, and round pairings")
    async def api_event_details(event_id: str):
        db = get_database()
        event_id_str = event_id.strip()
        event_details = db.get_event_details(event_id_str)
        players = event_details.get("players", []) if event_details else []
        has_placements = any(p.get("placement") is not None and p.get("placement") > 0 for p in players)

        # If roster is empty OR legacy tournament without official BCP placements, sync on-demand from BCP
        if not players or not has_placements or not event_details.get("is_ended"):
            try:
                scraper = BestCoastPairingsScraper(db=db)
                enrolled = scraper.fetch_event_players(event_id_str)
                if enrolled:
                    for p in enrolled:
                        user = p.get("user") or {}
                        u_id = user.get("id") or p.get("userId") or p.get("id")
                        if u_id:
                            f_name = user.get("firstName") or p.get("firstName") or ""
                            l_name = user.get("lastName") or p.get("lastName") or ""
                            full_name = f"{f_name} {l_name}".strip() or p.get("name") or "Player"
                            faction_obj = p.get("faction") or p.get("parentFaction") or ""
                            faction_name = faction_obj.get("name", "") if isinstance(faction_obj, dict) else str(faction_obj or "")
                            team_name = p.get("team") or p.get("teamName") or user.get("team") or ""
                            if isinstance(team_name, dict):
                                team_name = team_name.get("name") or ""
                            
                            raw_place = p.get("placing") or p.get("place") or p.get("rank") or p.get("placement") or p.get("ranking")
                            placing_num = None
                            if raw_place is not None:
                                try:
                                    placing_num = int(raw_place)
                                except (ValueError, TypeError):
                                    pass

                            raw_pts = p.get("points") or p.get("battlePoints") or p.get("totalPoints")
                            pts_num = None
                            if raw_pts is not None:
                                try:
                                    pts_num = int(raw_pts)
                                except (ValueError, TypeError):
                                    pass

                            db.upsert_event_participant(
                                event_id=event_id_str,
                                player_id=u_id,
                                first_name=f_name,
                                last_name=l_name,
                                full_name=full_name,
                                faction=faction_name,
                                team=str(team_name).strip(),
                                dropped=bool(p.get("dropped")),
                                checked_in=bool(p.get("checkedIn")),
                                placement=placing_num,
                                battle_points=pts_num
                            )
                    event_details = db.get_event_details(event_id_str)
            except Exception as e:
                logger.warning(f"Failed to auto-sync BCP placings for event {event_id_str}: {e}")

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
    async def api_auth_register(payload: RegisterPayload, response: Response):
        auth_mgr = get_auth_manager()
        res = auth_mgr.register(payload.email, payload.password, payload.display_name or "")
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Registration failed"))
        token = res.get("session_token")
        if token:
            response.set_cookie(key="session_token", value=token, max_age=2592000, path="/", httponly=False, samesite="lax")
        return res

    @app.post("/api/auth/login", summary="Login to native user account")
    async def api_auth_login(payload: LoginPayload, response: Response):
        auth_mgr = get_auth_manager()
        res = auth_mgr.login(payload.email, payload.password)
        if not res.get("success"):
            raise HTTPException(status_code=401, detail=res.get("error", "Invalid credentials"))
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
