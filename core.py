"""Core shared singletons, database access, authentication helpers, and state caches."""

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

try:
    from pydantic import BaseModel
except ImportError:
    class BaseModel:
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)

try:
    from psycopg2 import extras
except ImportError:
    extras = None

try:
    from fastapi import FastAPI, APIRouter, HTTPException, Query, Request, Response, BackgroundTasks, Depends
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse, HTMLResponse, StreamingResponse
    from fastapi.staticfiles import StaticFiles
    import uvicorn
    FASTAPI_AVAILABLE = True
except ImportError:
    class FastAPI:
        def __init__(self, *args, **kwargs):
            self.routes = []
        def middleware(self, *args, **kwargs): return lambda f: f
        def add_middleware(self, *args, **kwargs): pass
        def mount(self, *args, **kwargs): pass
        def on_event(self, *args, **kwargs): return lambda f: f
        def exception_handler(self, *args, **kwargs): return lambda f: f
        def include_router(self, router, *args, **kwargs):
            if hasattr(router, "routes"):
                self.routes.extend(router.routes)
        def get(self, path, *args, **kwargs):
            def dec(f):
                self.routes.append(("GET", path, f.__name__))
                return f
            return dec
        def post(self, path, *args, **kwargs):
            def dec(f):
                self.routes.append(("POST", path, f.__name__))
                return f
            return dec
        def put(self, path, *args, **kwargs):
            def dec(f):
                self.routes.append(("PUT", path, f.__name__))
                return f
            return dec
        def delete(self, path, *args, **kwargs):
            def dec(f):
                self.routes.append(("DELETE", path, f.__name__))
                return f
            return dec
        def patch(self, path, *args, **kwargs):
            def dec(f):
                self.routes.append(("PATCH", path, f.__name__))
                return f
            return dec
    class BackgroundTasks:
        def add_task(self, *args, **kwargs): pass
    class APIRouter:
        def __init__(self, *args, **kwargs):
            self.routes = []
        def get(self, path, *args, **kwargs):
            def dec(f):
                self.routes.append(("GET", path, f.__name__))
                return f
            return dec
        def post(self, path, *args, **kwargs):
            def dec(f):
                self.routes.append(("POST", path, f.__name__))
                return f
            return dec
        def put(self, path, *args, **kwargs):
            def dec(f):
                self.routes.append(("PUT", path, f.__name__))
                return f
            return dec
        def delete(self, path, *args, **kwargs):
            def dec(f):
                self.routes.append(("DELETE", path, f.__name__))
                return f
            return dec
        def patch(self, path, *args, **kwargs):
            def dec(f):
                self.routes.append(("PATCH", path, f.__name__))
                return f
            return dec
    class HTTPException(Exception):
        def __init__(self, status_code: int = 500, detail: str = ""):
            self.status_code = status_code
            self.detail = detail
    class Request: pass
    class Response: pass
    class FileResponse:
        def __init__(self, path: str = "", *args, **kwargs):
            self.path = path
            self.status_code = kwargs.get("status_code", 200)
            self.headers = kwargs.get("headers", {})
    class JSONResponse:
        def __init__(self, content=None, status_code: int = 200, headers: dict = None, *args, **kwargs):
            self.content = content
            self.status_code = status_code
            self.headers = headers or {}
    class PlainTextResponse:
        def __init__(self, content: str = "", status_code: int = 200, *args, **kwargs):
            self.content = content
            self.status_code = status_code
    class RedirectResponse:
        def __init__(self, url: str = "", status_code: int = 307, headers: dict = None, *args, **kwargs):
            self.url = url
            self.status_code = status_code
            self.headers = dict(headers or {})
            self.headers.setdefault("location", url)
    class HTMLResponse:
        def __init__(self, content: str = "", status_code: int = 200, headers: dict = None, *args, **kwargs):
            self.content = content
            self.status_code = status_code
            self.headers = headers or {}
    class StreamingResponse:
        def __init__(self, *args, **kwargs): pass
    class StaticFiles:
        def __init__(self, *args, **kwargs): pass
    class CORSMiddleware:
        def __init__(self, *args, **kwargs): pass
    def Query(default=None, *args, **kwargs): return default
    def Depends(dependency=None, *args, **kwargs): return dependency
    FASTAPI_AVAILABLE = False
    app = None

# Config and Domain Imports
try:
    from google3.experimental.users.hsiehjun.EloRanking.config import (
        DEFAULT_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR,
        MIN_MATCHES_FOR_RANKING, get_package_dir, DATABASE_URL,
        BCP_API_BASE, DEFAULT_HEADERS, BCP_CLIENT_ID, BCP_USER_AGENT,
        GOOGLE_MAPS_API_KEY
    )
    from google3.experimental.users.hsiehjun.EloRanking.database import Database, get_db
    from google3.experimental.users.hsiehjun.EloRanking.scraper import BestCoastPairingsScraper
    from google3.experimental.users.hsiehjun.EloRanking.elo import EloEngine
except ImportError:
    try:
        from experimental.users.hsiehjun.EloRanking.config import (
            DEFAULT_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR,
            MIN_MATCHES_FOR_RANKING, get_package_dir, DATABASE_URL,
            BCP_API_BASE, DEFAULT_HEADERS, BCP_CLIENT_ID, BCP_USER_AGENT,
            GOOGLE_MAPS_API_KEY
        )
        from experimental.users.hsiehjun.EloRanking.database import Database, get_db
        from experimental.users.hsiehjun.EloRanking.scraper import BestCoastPairingsScraper
        from experimental.users.hsiehjun.EloRanking.elo import EloEngine
    except ImportError:
        from config import (
            DEFAULT_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR,
            MIN_MATCHES_FOR_RANKING, get_package_dir, DATABASE_URL,
            BCP_API_BASE, DEFAULT_HEADERS, BCP_CLIENT_ID, BCP_USER_AGENT,
            GOOGLE_MAPS_API_KEY
        )
        from database import Database, get_db
        from scraper import BestCoastPairingsScraper
        from elo import EloEngine
        from auth import get_auth_manager, _decode_jwt_payload
        from army_list_parser import get_parser as get_army_parser
        from firestore_db import get_firestore_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("EloAPI")

# Singletons
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

# Base Paths
package_dir = get_package_dir()
web_dir = package_dir / "web"
if not web_dir.exists():
    web_dir = Path(__file__).resolve().parent / "web"

# Shared Realtime In-Memory Game Tracker State
TRACKER_ROOMS: Dict[str, Dict[str, Any]] = {}
TRACKER_LISTENERS: Dict[str, List[asyncio.Queue]] = {}
GDM_STATIC_CACHE: Dict[str, Tuple[bytes, str, Dict[str, str]]] = {}
_roster_cache: Dict[str, Any] = {}

NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}

def generate_unique_match_id(db) -> str:
    """Generates a cryptographically collision-free random match ID."""
    for _ in range(20):
        token = secrets.token_hex(4).upper()
        match_id = f"WH40K-{token[:4]}-{token[4:]}"
        if match_id not in TRACKER_ROOMS and not db.get_tracker_game(match_id):
            return match_id
    return f"WH40K-{secrets.token_hex(6).upper()}"

def normalize_tracker_match_id(raw: str) -> str:
    s = raw.strip().upper().replace(" ", "")
    if s.startswith("WH40K-") or s.startswith("BCP-"):
        return s
    s_clean = s.replace("-", "")
    if len(s_clean) == 8:
        return f"WH40K-{s_clean[:4]}-{s_clean[4:]}"
    return s

def init_tracker_room_from_chat(match_id: str, chat_info: Dict[str, Any], fs_engine) -> Dict[str, Any]:
    """Auto-recovers an uninitialized tracker room that was generated in chat."""
    sender_id = chat_info.get("sender_id") or chat_info.get("req_sender_id")
    receiver_id = chat_info.get("req_receiver_id") if sender_id == chat_info.get("req_sender_id") else chat_info.get("req_sender_id")
    sender_name = chat_info.get("sender_name") or "Player 1"
    receiver_name = chat_info.get("receiver_name") or "Player 2"
    sender_faction = chat_info.get("sender_faction")
    receiver_faction = chat_info.get("receiver_faction")

    initial_state = {
        "id": f"g-{secrets.token_hex(4)}-{secrets.token_hex(3)}",
        "match_id": match_id,
        "event_id": None,
        "round_num": 1,
        "table_num": None,
        "user_id_p1": sender_id,
        "user_id_p2": None,
        "game": {
            "p1Name": sender_name,
            "p2Name": receiver_name,
            "p1Faction": sender_faction,
            "p2Faction": receiver_faction,
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
            "terrainLayout": None,
            "trackCP": True,
            "showCP": True,
            "enableCP": True,
            "cpCounter": True,
            "cp": True,
            "eventId": None,
            "roundNum": 1,
            "tableNum": None
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

    initial_clock = {
        "visible": False,
        "running": False,
        "active_player": 1,
        "duration_minutes": 75,
        "p1_remaining": 4500,
        "p2_remaining": 4500,
        "round_remaining": 9000,
        "last_start_time": None,
        "updated_at": int(datetime.now(timezone.utc).timestamp() * 1000)
    }

    room = {
        "match_id": match_id,
        "user_id_p1": sender_id,
        "user_id_p2": None,
        "referee_ids": [],
        "version": 1,
        "p1_name": sender_name,
        "p2_name": receiver_name,
        "state": initial_state,
        "chess_clock": initial_clock,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    TRACKER_ROOMS[match_id] = room
    try:
        fs_engine.create_room(match_id, {
            "user_id_p1": sender_id,
            "user_id_p2": None,
            "referee_ids": [],
            "version": 1,
            "p1_name": sender_name,
            "p2_name": receiver_name,
            "state": initial_state,
            "chess_clock": initial_clock
        })
        logger.info(f"🔥 [CHAT RECOVERY] Auto-initialized chat tracker room {match_id} in Firestore")
    except Exception as err:
        logger.error(f"❌ [CHAT RECOVERY] Error persisting recovered room {match_id}: {err}")

    return room



def _get_user_session_or_401(request: Request, token: Optional[str] = None) -> Dict[str, Any]:
    auth_mgr = get_auth_manager()
    auth_header = getattr(request, "headers", {}).get("Authorization", "")
    cookies = getattr(request, "cookies", {})
    session_token = token or cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    if not session_token:
        raise HTTPException(status_code=401, detail="Authentication required")
    session = auth_mgr.get_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return session

def _get_admin_session_or_403(request: Request, token: Optional[str] = None) -> Dict[str, Any]:
    session = _get_user_session_or_401(request, token)
    user_role = (session.get("role") or "player").strip().lower()
    user_email = (session.get("email") or "").strip().lower()
    admin_emails = ("swimgeek751@gmail.com",)
    if user_role not in ("admin", "superuser", "developer", "owner") or user_email not in admin_emails:
        raise HTTPException(status_code=403, detail="Administrator privileges required")
    return session

def _get_to_session_or_403(request: Request, token: Optional[str] = None) -> Dict[str, Any]:
    session = _get_user_session_or_401(request, token)
    user_role = (session.get("role") or "player").strip().lower()
    user_email = (session.get("email") or "").strip().lower()
    admin_emails = ("swimgeek751@gmail.com",)
    if user_role not in ("admin", "superuser", "developer", "owner", "to", "organizer") and user_email not in admin_emails:
        raise HTTPException(status_code=403, detail="Tournament Organizer privileges required")
    return session

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
    {"city": "New Orleans", "state": "LA", "country": "United States", "lat": 29.9511, "lng": -90.0715, "label": "New Orleans, LA, United States"}
]
