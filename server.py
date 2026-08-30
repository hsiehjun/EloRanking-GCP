"""Modern FastAPI Server and Async REST API for Warhammer 40k Elo Ranking UI."""

import logging
import os
import math
import json
import secrets
import asyncio
import re
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from pydantic import BaseModel

try:
    from psycopg2 import extras
except ImportError:
    extras = None


try:
    from fastapi import FastAPI, HTTPException, Query, Request, Response
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse, HTMLResponse, StreamingResponse
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
    if (web_dir / "assets").exists():
        app.mount("/assets", StaticFiles(directory=str(web_dir / "assets")), name="assets")
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
        venue: Optional[str] = ""
        points: Optional[int] = 2000
        capacity: Optional[int] = 32
        mission_pack: Optional[str] = "11th Edition Core"
        bcp_token: Optional[str] = None

    @app.get("/api/eventstudio/events", summary="List organizer tournaments with BCP auto-sync")
    async def api_eventstudio_list_events(request: Request):
        db = get_database()
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None
        bcp_user_id = user.get("bcp_user_id") if user else None

        # 1. Fetch from local database
        events = db.get_studio_events(organizer_id=user_id, organizer_bcp_id=bcp_user_id)

        # 2. If user is linked to BCP, pull events created on BCP as well
        if user_id and bcp_user_id:
            bcp_token = auth_mgr.get_valid_bcp_token(user_id)
            if bcp_token:
                try:
                    import urllib.request, json
                    bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events?userId={bcp_user_id}&limit=50"
                    req = urllib.request.Request(
                        bcp_url,
                        headers={
                            "Authorization": f"Bearer {bcp_token}",
                            "User-Agent": "EventStudio-Companion/1.0",
                            "Content-Type": "application/json"
                        }
                    )
                    with urllib.request.urlopen(req, timeout=8) as resp:
                        bcp_data = json.loads(resp.read().decode("utf-8"))
                        bcp_list = bcp_data if isinstance(bcp_data, list) else bcp_data.get("data", [])
                        
                        existing_ids = {e["id"] for e in events}
                        for be in bcp_list:
                            be_id = be.get("id") or be.get("_id")
                            if be_id and be_id not in existing_ids:
                                synced_ev = db.save_studio_event({
                                    "id": be_id,
                                    "name": be.get("name") or "BCP Tournament",
                                    "tier": be.get("eventType") or "Grand Tournament",
                                    "event_date": be.get("eventDate") or be.get("startDate"),
                                    "end_date": be.get("endDate"),
                                    "city": be.get("city") or "",
                                    "state": be.get("state") or "",
                                    "country": be.get("country") or "USA",
                                    "venue": be.get("venueName") or "",
                                    "total_players": int(be.get("totalPlayers") or be.get("numPlayers") or 0),
                                    "num_rounds": int(be.get("numberOfRounds") or be.get("numRounds") or 5),
                                    "organizer_id": user_id,
                                    "organizer_bcp_id": bcp_user_id,
                                    "raw_json": be
                                })
                                events.append(synced_ev)
                                existing_ids.add(be_id)
                except Exception as bcp_err:
                    logger.debug(f"BCP organizer events fetch notice: {bcp_err}")

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
            # Fallback to standard event lookup
            full_ev = db.get_tournament_details(event_id)
            if full_ev:
                return {"success": True, "event": full_ev}
            raise HTTPException(status_code=404, detail=f"Tournament '{event_id}' not found")

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

        # Attempt to register on Best Coast Pairings API if authenticated
        if bcp_token:
            try:
                import urllib.request, json
                bcp_url = "https://newprod-api.bestcoastpairings.com/v1/events"
                bcp_payload = {
                    "name": payload.name,
                    "eventType": payload.tier or "Grand Tournament",
                    "eventDate": payload.start_date or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    "endDate": payload.end_date or payload.start_date or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    "city": payload.city or "",
                    "state": payload.state or "",
                    "country": payload.country or "United States",
                    "venueName": payload.venue or "",
                    "numRounds": payload.rounds or 5,
                    "capacity": payload.capacity or 32,
                    "points": payload.points or 2000
                }
                req = urllib.request.Request(
                    bcp_url,
                    data=json.dumps(bcp_payload).encode("utf-8"),
                    headers={
                        "Authorization": f"Bearer {bcp_token}",
                        "Content-Type": "application/json"
                    },
                    method="POST"
                )
                with urllib.request.urlopen(req, timeout=10) as resp:
                    if resp.status in (200, 201):
                        res_data = json.loads(resp.read().decode("utf-8"))
                        if isinstance(res_data, dict) and res_data.get("id"):
                            event_id = res_data["id"]
                            bcp_created = True
            except Exception as e:
                logger.warning(f"BCP Event create notice (saving locally): {e}")

        # Save to local database
        saved = db.save_studio_event({
            "id": event_id,
            "name": payload.name,
            "tier": payload.tier,
            "event_date": payload.start_date or datetime.now(timezone.utc),
            "end_date": payload.end_date or payload.start_date or datetime.now(timezone.utc),
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
        bcp_token = auth_mgr.get_valid_bcp_token(user_id) if user_id else None

        ev = db.get_studio_event(event_id)
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")

        for k, v in payload.items():
            ev[k] = v

        saved = db.save_studio_event(ev)

        # Sync update to BCP if token available
        bcp_updated = False
        if bcp_token and not event_id.startswith("ES-"):
            try:
                import urllib.request, json
                bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}"
                req = urllib.request.Request(
                    bcp_url,
                    data=json.dumps(payload).encode("utf-8"),
                    headers={
                        "Authorization": f"Bearer {bcp_token}",
                        "Content-Type": "application/json"
                    },
                    method="PUT"
                )
                with urllib.request.urlopen(req, timeout=8) as resp:
                    if resp.status in (200, 201, 204):
                        bcp_updated = True
            except Exception as e:
                logger.debug(f"BCP event update notice: {e}")

        return {
            "success": True,
            "event": saved,
            "bcp_updated": bcp_updated
        }

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
        if bcp_token and not event_id.startswith("ES-"):
            try:
                import urllib.request
                bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}"
                req = urllib.request.Request(
                    bcp_url,
                    headers={"Authorization": f"Bearer {bcp_token}"},
                    method="DELETE"
                )
                with urllib.request.urlopen(req, timeout=8) as resp:
                    if resp.status in (200, 204):
                        bcp_deleted = True
            except Exception as e:
                logger.debug(f"BCP delete notice: {e}")

        return {
            "success": True,
            "event_id": event_id,
            "bcp_deleted": bcp_deleted
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

    class TrackerActionPayload(BaseModel):
        token: Optional[str] = None
        match_id: Optional[str] = None

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
                return {
                    "success": True,
                    "match_id": match_id,
                    "role": "player1" if (user and existing.get("user_id_p1") == user["id"]) else ("player2" if (user and existing.get("user_id_p2") == user["id"]) else "player1"),
                    "user_id_p1": existing.get("user_id_p1"),
                    "p1_name": existing.get("state", {}).get("game", {}).get("p1Name") or "Player 1",
                    "p2_name": existing.get("state", {}).get("game", {}).get("p2Name") or "Player 2",
                    "state": existing.get("state", {})
                }
            saved_game = db.get_tracker_game(match_id)
            if saved_game and saved_game.get("state"):
                TRACKER_ROOMS[match_id] = {
                    "match_id": match_id,
                    "user_id_p1": saved_game.get("user_id_p1"),
                    "user_id_p2": saved_game.get("user_id_p2"),
                    "referee_ids": saved_game.get("referee_ids", []),
                    "version": saved_game.get("version", 1),
                    "state": saved_game["state"],
                    "updated_at": saved_game.get("updated_at")
                }
                return {
                    "success": True,
                    "match_id": match_id,
                    "role": "player1" if (user and saved_game.get("user_id_p1") == user["id"]) else ("player2" if (user and saved_game.get("user_id_p2") == user["id"]) else "player1"),
                    "user_id_p1": saved_game.get("user_id_p1"),
                    "p1_name": saved_game.get("p1_name") or "Player 1",
                    "p2_name": saved_game.get("p2_name") or "Player 2",
                    "state": saved_game["state"]
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
            "p1": {"score": 0, "rounds": [], "battleReady": True, "cp": 0},
            "p2": {"score": 0, "rounds": [], "battleReady": True, "cp": 0},
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
        
        # Persist room creation to DB
        try:
            saved = db.save_tracker_game(
                match_id=match_id,
                state=initial_state,
                version=1,
                user_id_p1=user_id_p1
            )
            logger.info(f"💾 [CREATE ROOM] save_tracker_game for {match_id}: {saved}")
        except Exception as err:
            logger.error(f"❌ [CREATE ROOM] DB save error for {match_id}: {err}", exc_info=True)
            
        return {
            "success": True,
            "match_id": match_id,
            "role": "player1",
            "user_id_p1": user_id_p1,
            "p1_name": p1_name,
            "p2_name": p2_name,
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
        
        # Determine Role with Tournament Participant Validation:
        p1_assigned_name = (game.get("p1Name") or "").strip().lower()
        p2_assigned_name = (game.get("p2Name") or "").strip().lower()
        u_name = (user_name or "").strip().lower()
        is_tournament_match = match_id.startswith("BCP-") or bool(st.get("event_id"))
        
        # 1. Check if user is already registered Player 1 owner or matches P1 name
        if user_id and room.get("user_id_p1") == user_id:
            role = "player1"
        elif not room.get("user_id_p1") and u_name and p1_assigned_name and u_name == p1_assigned_name:
            room["user_id_p1"] = user_id or f"p1_{secrets.token_hex(3)}"
            st["user_id_p1"] = room["user_id_p1"]
            role = "player1"
            room["version"] += 1
        # 2. Check if user is already registered Player 2 owner or matches P2 name
        elif user_id and room.get("user_id_p2") == user_id:
            role = "player2"
        elif not room.get("user_id_p2") and u_name and p2_assigned_name and u_name == p2_assigned_name:
            room["user_id_p2"] = user_id or f"p2_{secrets.token_hex(3)}"
            st["user_id_p2"] = room["user_id_p2"]
            role = "player2"
            room["version"] += 1
        # 3. Check if user is Admin / TO / Referee
        elif (user_id and user_id in room.get("referee_ids", [])) or (user and user.get("role") in ("admin", "referee", "to")):
            role = "referee"
        # 4. If Casual Match (non-tournament), open P2 slot can be claimed by opponent
        elif not is_tournament_match and not room.get("user_id_p2"):
            room["user_id_p2"] = user_id or f"p2_{secrets.token_hex(3)}"
            st["user_id_p2"] = room["user_id_p2"]
            if user_name and user_name != game.get("p1Name"):
                game["p2Name"] = user_name
            role = "player2"
            room["version"] += 1
            
            try:
                db.save_tracker_game(
                    match_id=match_id,
                    state=st,
                    version=room["version"],
                    user_id_p1=room.get("user_id_p1"),
                    user_id_p2=room["user_id_p2"]
                )
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
        else:
            # Player 3, Player 4, or unauthorized user -> Spectator (View Only)
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
        db = get_database()
        
        # 1. Fetch latest DB state
        saved = None
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
                    "updated_at": saved.get("updated_at")
                }
            res = dict(TRACKER_ROOMS[match_id])
            res["online_count"] = online_count
            return res

        if match_id in TRACKER_ROOMS and TRACKER_ROOMS[match_id].get("state"):
            res = dict(TRACKER_ROOMS[match_id])
            res["online_count"] = online_count
            return res

        return {"match_id": match_id, "version": 0, "online_count": online_count, "state": {}}

    @app.get("/api/tracker/history", summary="Get persistent history of tracker games")
    async def api_tracker_history(request: Request, limit: int = 50, search: Optional[str] = None, token: Optional[str] = Query(None)):
        try:
            db = get_database()
            auth_mgr = get_auth_manager()
            
            auth_header = request.headers.get("Authorization", "")
            session_token = token or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
            user = auth_mgr.get_session(session_token) if session_token else None
            user_id = user["id"] if user else None
            user_name = user["display_name"] if user else None
            
            history = db.get_tracker_history(limit=limit, search=search, user_id=user_id, user_name=user_name)
            return {"success": True, "history": history}
        except Exception as err:
            logger.error(f"Error fetching tracker history: {err}")
            return {"success": False, "history": []}

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
                if match_id in TRACKER_ROOMS and TRACKER_ROOMS[match_id].get("state"):
                    r = TRACKER_ROOMS[match_id]
                    yield f"data: {json.dumps({'type': 'state_update', 'sender': 'server', 'version': r['version'], 'state': r['state']})}\n\n"

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
  <!-- GDM REAL-TIME MULTIPLAYER & DATABASE OVERLAY -->
  <link rel="stylesheet" href="/tracker/tracker_sync.css?v=11.7">
  <script src="/tracker/tracker_sync.js?v=11.7"></script>
  <style>
    header.tac-header, footer.tac-footer, .tac-header, .tac-footer, footer {
      display: none !important;
    }
    body:has(#gt-lobby-wrapper) main > :not(#gt-lobby-wrapper) {
      display: none !important;
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
    async def serve_tracker_sync_js():
        return FileResponse(str(web_dir / "tracker" / "tracker_sync.js"), media_type="application/javascript")

    @app.get("/tracker/tracker_sync.css", include_in_schema=False)
    async def serve_tracker_sync_css():
        return FileResponse(str(web_dir / "tracker" / "tracker_sync.css"), media_type="text/css")

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
    async def serve_tracker_alias():
        return RedirectResponse(url="/11th/tracker", status_code=303)

    @app.get("/tracker/play", include_in_schema=False)
    async def serve_tracker_play_alias(request: Request):
        query = f"?{request.url.query}" if request.url.query else ""
        return RedirectResponse(url=f"/11th/tracker/play{query}", status_code=303)

    # Dynamic Upstream Next.js Static Asset & Image Optimization Streaming
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
        return JSONResponse(
            content={
                "name": "Warhammer 40,000 Elo Rankings & Game Tracker",
                "short_name": "40k Elo",
                "description": "Competitive Warhammer 40k Elo Rankings, Faction Meta, & Live Multiplayer Match Tracker",
                "start_url": "/",
                "scope": "/",
                "display": "standalone",
                "background_color": "#070b14",
                "theme_color": "#0284c7",
                "icons": [
                    {
                        "src": "/assets/logo-192.png",
                        "sizes": "192x192",
                        "type": "image/png",
                        "purpose": "any maskable"
                    },
                    {
                        "src": "/assets/logo-512.png",
                        "sizes": "512x512",
                        "type": "image/png",
                        "purpose": "any maskable"
                    },
                    {
                        "src": "/logo192w.png",
                        "sizes": "192x192",
                        "type": "image/png"
                    },
                    {
                        "src": "/logo512w.png",
                        "sizes": "512x512",
                        "type": "image/png"
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

        # 2. Query upcoming & recent events directly from PostgreSQL database (100% fast, 0 network lag)
        with db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                cursor.execute("""
                SELECT id, name, event_date, city, state, country, total_players, num_rounds, is_ended
                FROM events
                WHERE event_date >= CURRENT_DATE - INTERVAL '30 days'
                ORDER BY event_date ASC
                LIMIT 300;
                """)
                bcp_events = [dict(r) for r in cursor.fetchall()]

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
        except Exception:
            field_stats = {}

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
                tier_baseline = 1680.0
            elif rounds >= 4:
                tier = "Grand Tournament"
                tier_badge = "tier-A"
                tier_baseline = 1580.0
            else:
                tier = "RTT / Local"
                tier_badge = "tier-B"
                tier_baseline = 1500.0

            # Dynamic Field Avg Elo from Enrolled Roster in PostgreSQL
            stats_entry = field_stats.get(str(ev_id)) or field_stats.get(ev_id)
            if stats_entry and stats_entry.get("avg_field_elo"):
                avg_elo_val = float(stats_entry["avg_field_elo"])
            else:
                avg_elo_val = tier_baseline

            if user_elo:
                diff = avg_elo_val - user_elo
                if abs(diff) <= 35:
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
    async def api_event_details(event_id: str, force_sync: bool = False):
        db = get_database()
        event_id_str = event_id.strip()
        # Only query BCP if user explicitly clicked the 'Refresh Live' button
        if force_sync:
            try:
                scraper = BestCoastPairingsScraper(db=db)
                scraper.scrape_event(event_id_str)
            except Exception as e:
                logger.warning(f"Failed to live refresh BCP details for event {event_id_str}: {e}")

        event_details = db.get_event_details(event_id_str)
        if not event_details:
            raise HTTPException(status_code=404, detail=f"Tournament '{event_id_str}' not found in database")

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

    class UserSettingsPayload(BaseModel):
        display_name: Optional[str] = None
        old_password: Optional[str] = None
        new_password: Optional[str] = None

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
