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
                    bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events?eventOrganizerId={bcp_user_id}&limit=25"
                    req = urllib.request.Request(
                        bcp_url,
                        headers={
                            "Authorization": f"Bearer {bcp_token}",
                            "User-Agent": "EventStudio-Companion/1.0",
                            "Content-Type": "application/json"
                        }
                    )
                    with urllib.request.urlopen(req, timeout=2.0) as resp:
                        if resp.status == 200:
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

    @app.post("/api/eventstudio/import", summary="Import any tournament from BCP into Event Studio")
    async def api_eventstudio_import_bcp(payload: Dict[str, Any], request: Request):
        db = get_database()
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "")
        session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None
        bcp_user_id = user.get("bcp_user_id") if user else None

        raw_id_or_url = payload.get("event_id") or payload.get("url") or ""
        event_id = raw_id_or_url.strip()
        if "/event/" in event_id:
            event_id = event_id.split("/event/")[1].split("?")[0].split("/")[0]

        if not event_id:
            raise HTTPException(status_code=400, detail="Invalid BCP Event ID or URL")

        # Sync roster & pairings from BCP
        from scraper import BestCoastPairingsScraper
        scraper = BestCoastPairingsScraper(db)
        try:
            scraper.sync_event_roster(event_id)
        except Exception as e:
            logger.debug(f"Sync event notice for {event_id}: {e}")

        # Hydrate full studio event
        ev = db.get_studio_event(event_id)
        if not ev:
            ev_details = db.get_event_details(event_id)
            if not ev_details:
                raise HTTPException(status_code=404, detail=f"Could not load event '{event_id}' from BCP")
            ev = {
                "id": event_id,
                "name": ev_details.get("name") or "BCP Tournament",
                "tier": ev_details.get("tier") or "Grand Tournament",
                "event_date": ev_details.get("event_date"),
                "end_date": ev_details.get("end_date") or ev_details.get("event_date"),
                "city": ev_details.get("city") or "",
                "state": ev_details.get("state") or "",
                "country": ev_details.get("country") or "USA",
                "venue": ev_details.get("venue") or "",
                "total_players": int(ev_details.get("total_players") or 0),
                "num_rounds": int(ev_details.get("num_rounds") or 5),
                "current_round": int(ev_details.get("current_round") or 1),
                "points": int(ev_details.get("points") or 2000),
                "capacity": int(ev_details.get("capacity") or ev_details.get("max_capacity") or 32),
                "organizer_id": user_id,
                "organizer_bcp_id": bcp_user_id,
                "roster": [],
                "pairings": {},
                "raw_json": ev_details.get("raw_json") or {}
            }
            ev = db.save_studio_event(ev)

        # Mark with current organizer
        if user_id or bcp_user_id:
            ev["organizer_id"] = user_id
            ev["organizer_bcp_id"] = bcp_user_id
            ev = db.save_studio_event(ev)

        return {
            "success": True,
            "event_id": event_id,
            "event": ev,
            "message": f"Successfully imported '{ev.get('name')}'!"
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
            
            # Sync to Firestore Native without touching PostgreSQL
            try:
                fs_engine.update_room(match_id, {
                    "user_id_p2": room["user_id_p2"],
                    "p2_name": game.get("p2Name", "Player 2"),
                    "state": st,
                    "version": room["version"],
                    "participants.player2": {
                        "uid": room["user_id_p2"],
                        "name": game.get("p2Name", "Player 2")
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
            "state": st,
            "chess_clock": room.get("chess_clock")
        }

    @app.post("/api/tracker/room/{match_id}/state", summary="Broadcast and persist multiplayer tracker state with role enforcement")
    async def api_tracker_save_state(match_id: str, payload: TrackerStatePayload, request: Request):
        match_id = normalize_tracker_match_id(match_id)
        fs_engine = get_firestore_engine()
        auth_mgr = get_auth_manager()
        
        auth_header = request.headers.get("Authorization", "")
        session_token = (payload.token if payload and payload.token else None) or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
        user_id = user["id"] if user else None
        
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
        active_docs = fs_engine.list_active_rooms_for_user(user_id=user_id, user_name=user_name)
        
        seen_matches = set()
        active_sessions = []
        for doc in active_docs:
            mid = (doc.get("roomKey") or doc.get("matchId") or (doc.get("state", {}).get("match_id") if isinstance(doc.get("state"), dict) else "") or "").strip().upper()
            if mid and mid not in seen_matches:
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

        # 2. Delete / remove from Cloud Firestore (active session is concluded!)
        try:
            fs_engine.discard_room(match_id)
        except Exception as e:
            logger.warning(f"Notice discarding Firestore room on conclusion {match_id}: {e}")

        # 3. Clean up Memory Cache
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
  <link rel="stylesheet" href="/tracker/tracker_sync.css?v=34.0">
  <script src="/tracker/tracker_sync.js?v=34.0"></script>
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

        # 2. Trigger non-blocking background sync of all upcoming pages if cache is cold (>15m)
        global _LAST_UPCOMING_SYNC_TIME
        import time, threading
        now_ts = time.time()
        if (now_ts - _LAST_UPCOMING_SYNC_TIME) > 900:
            def sync_bcp_worker():
                global _LAST_UPCOMING_SYNC_TIME
                _LAST_UPCOMING_SYNC_TIME = time.time()
                try:
                    now_dt = datetime.now(timezone.utc)
                    start_iso = (now_dt - timedelta(days=7)).strftime("%Y-%m-%dT00:00:00Z")
                    end_iso = (now_dt + timedelta(days=120)).strftime("%Y-%m-%dT23:59:59Z")
                    next_key = None
                    for _ in range(12):
                        url = f"{BCP_API_BASE}/events?limit=100&gameSystemId={DEFAULT_GAME_SYSTEM_ID}&startDate={start_iso}&endDate={end_iso}"
                        if next_key:
                            url += f"&nextKey={urllib.parse.quote(next_key)}"
                        req = urllib.request.Request(url, headers=DEFAULT_HEADERS)
                        with urllib.request.urlopen(req, timeout=6) as resp:
                            data = json.loads(resp.read().decode("utf-8"))
                            items = data.get("data", [])
                            for it in items:
                                try:
                                    db.upsert_event(it)
                                except Exception:
                                    pass
                            next_key = data.get("nextKey")
                            if not next_key or not items:
                                break
                except Exception as e:
                    logger.warning(f"Background BCP upcoming events sync notice: {e}")

            threading.Thread(target=sync_bcp_worker, daemon=True).start()

        # 3. Query all upcoming & recent events directly from PostgreSQL database (<10ms)
        with db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                cursor.execute("""
                SELECT id, name, event_date, city, state, country, total_players, num_rounds, is_ended, raw_json
                FROM events
                WHERE event_date >= CURRENT_DATE - INTERVAL '14 days' AND event_date <= CURRENT_DATE + INTERVAL '120 days'
                ORDER BY event_date ASC
                LIMIT 2000;
                """)
                bcp_events = [dict(r) for r in cursor.fetchall()]

        # If DB had 0 events (e.g. cold start), fetch first 6 pages synchronously
        if not bcp_events:
            try:
                now_dt = datetime.now(timezone.utc)
                start_iso = (now_dt - timedelta(days=7)).strftime("%Y-%m-%dT00:00:00Z")
                end_iso = (now_dt + timedelta(days=120)).strftime("%Y-%m-%dT23:59:59Z")
                next_key = None
                for _ in range(6):
                    url = f"{BCP_API_BASE}/events?limit=100&gameSystemId={DEFAULT_GAME_SYSTEM_ID}&startDate={start_iso}&endDate={end_iso}"
                    if next_key:
                        url += f"&nextKey={urllib.parse.quote(next_key)}"
                    req = urllib.request.Request(url, headers=DEFAULT_HEADERS)
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        data = json.loads(resp.read().decode("utf-8"))
                        items = data.get("data", [])
                        for it in items:
                            try:
                                db.upsert_event(it)
                            except Exception:
                                pass
                        bcp_events.extend(items)
                        next_key = data.get("nextKey")
                        if not next_key or not items:
                            break
            except Exception as e:
                logger.warning(f"Initial sync notice: {e}")

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
