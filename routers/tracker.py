"""Multiplayer Real-Time Game Tracker & Cloud Firestore Engine Router."""
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
from typing import Any, Dict, List, Optional, Tuple
from pathlib import Path

from core import (
    APIRouter, BaseModel, HTTPException, Query, Request, Response, BackgroundTasks,
    FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse, StreamingResponse,
    get_database, get_auth_manager, get_elo_engine, get_firestore_engine, get_army_parser,
    _get_user_session_or_401, _get_admin_session_or_403, _get_to_session_or_403,
    NO_CACHE_HEADERS, VERIFIED_TOURNAMENT_CITIES, web_dir, package_dir, logger,
    BestCoastPairingsScraper, _decode_jwt_payload, init_tracker_room_from_chat, _roster_cache, extras,
    DEFAULT_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR, MIN_MATCHES_FOR_RANKING,
    BCP_API_BASE, DEFAULT_HEADERS, BCP_CLIENT_ID, BCP_USER_AGENT, GOOGLE_MAPS_API_KEY,
    TRACKER_ROOMS, TRACKER_LISTENERS, generate_unique_match_id, normalize_tracker_match_id
)

router = APIRouter(tags=["Game Tracker"])

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
    p1_id: Optional[str] = None
    p2_id: Optional[str] = None
    p1_faction: Optional[str] = None
    p2_faction: Optional[str] = None
    p1_detachment: Optional[str] = None
    p2_detachment: Optional[str] = None
    event_id: Optional[str] = None
    round_num: Optional[int] = None
    table_num: Optional[int] = None
    match_id: Optional[str] = None
    pairing_id: Optional[str] = None

class TrackerJoinPayload(BaseModel):
    token: Optional[str] = None
    player_name: Optional[str] = None
    player_id: Optional[str] = None
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

def check_user_matches_player(user: Optional[Dict[str, Any]], target_name: Optional[str], target_id: Optional[str] = None) -> bool:
    """Determine if an authenticated user corresponds to a specific tournament pairing participant."""
    if not user:
        return False

    # 1. Match by canonical ID or foreign BCP user ID
    candidate_ids = set()
    for k in ("id", "player_id", "bcp_user_id", "bcp_id", "userId", "user_id", "sub"):
        v = user.get(k)
        if v:
            candidate_ids.add(str(v).strip().lower())

    if target_id and str(target_id).strip().lower() in candidate_ids:
        return True

    if not target_name:
        return False

    t_clean = str(target_name).strip().lower()
    if not t_clean or t_clean in ("bye", "open", "tbd", "unassigned", "none"):
        return False

    t_nospace = t_clean.replace(" ", "")

    # 2. Match by player name attributes
    user_names = []
    for k in ("display_name", "competitor_name", "full_name", "name", "username"):
        v = user.get(k)
        if v and isinstance(v, str) and v.strip():
            user_names.append(v.strip().lower())

    fn = (user.get("first_name") or user.get("firstName") or "").strip().lower()
    ln = (user.get("last_name") or user.get("lastName") or "").strip().lower()
    if fn and ln:
        user_names.append(f"{fn} {ln}")
        user_names.append(f"{fn}{ln}")
    elif fn:
        user_names.append(fn)

    for un in user_names:
        un_clean = un.strip().lower()
        if un_clean == t_clean or un_clean.replace(" ", "") == t_nospace:
            return True

    return False

def normalize_tracker_match_id(raw: str) -> str:
    s = raw.strip().upper().replace(" ", "")
    if s.startswith("WH40K-") or s.startswith("BCP-") or s.startswith("ES-"):
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

def determine_existing_room_role(user: Optional[Dict[str, Any]], room_dict: Dict[str, Any], match_id: str, payload: Optional[Any] = None) -> Tuple[str, Optional[str]]:
    """
    Determines role ('player1', 'player2', 'referee', 'spectator') and slot to claim ('user_id_p1', 'user_id_p2', or None).
    Ensures that for event matches (BCP-*, ES-*, or rooms with event_id), ONLY the assigned table competitors
    can enter as player1 or player2. All other users (including players from different tables or byes) enter as spectator.
    """
    candidate_user = user
    if not candidate_user and payload and (getattr(payload, "player_id", None) or getattr(payload, "player_name", None)):
        candidate_user = {
            "id": getattr(payload, "player_id", None),
            "display_name": getattr(payload, "player_name", None)
        }

    u_id = candidate_user["id"] if candidate_user else None
    p1_id = room_dict.get("user_id_p1")
    p2_id = room_dict.get("user_id_p2")

    st = room_dict.get("state", {}) if isinstance(room_dict.get("state"), dict) else {}
    game = st.get("game", {}) if isinstance(st.get("game"), dict) else {}

    p1_assigned_name = room_dict.get("p1_name") or game.get("p1Name") or getattr(payload, "p1_name", None) or "Player 1"
    p2_assigned_name = room_dict.get("p2_name") or game.get("p2Name") or getattr(payload, "p2_name", None) or "Player 2"
    p1_target_id = game.get("p1Id") or getattr(payload, "p1_id", None)
    p2_target_id = game.get("p2Id") or getattr(payload, "p2_id", None)

    is_tournament = (
        match_id.startswith("BCP-") or
        match_id.startswith("ES-") or
        bool(payload and getattr(payload, "event_id", None)) or
        bool(st.get("event_id")) or
        bool(game.get("eventId"))
    )

    is_staff = bool(candidate_user and (
        (u_id and u_id in room_dict.get("referee_ids", [])) or
        candidate_user.get("role") in ("admin", "referee", "to", "organizer") or
        candidate_user.get("is_admin") or
        candidate_user.get("can_access_to")
    ))

    if u_id and p1_id == u_id:
        return ("player1", None)
    if u_id and p2_id == u_id:
        return ("player2", None)

    if is_tournament:
        # Strict table pairings: ONLY the two matched competitors can claim player slots
        matches_p1 = bool(candidate_user and check_user_matches_player(candidate_user, p1_assigned_name, p1_target_id))
        matches_p2 = bool(candidate_user and check_user_matches_player(candidate_user, p2_assigned_name, p2_target_id))

        if matches_p1 and not p1_id:
            return ("player1", "user_id_p1")
        if matches_p2 and not p2_id:
            return ("player2", "user_id_p2")
        if is_staff:
            return ("referee", None)
        return ("spectator", None)
    else:
        # Casual match logic
        claim_role = getattr(payload, "claim_role", None)
        if claim_role == "player2" and not p2_id:
            return ("player2", "user_id_p2")
        if claim_role == "player1" and not p1_id:
            return ("player1", "user_id_p1")
        if not p2_id and u_id != p1_id:
            return ("player2", "user_id_p2")
        if not p1_id:
            return ("player1", "user_id_p1")
        return ("spectator" if (p1_id and p2_id) else "player1", None)

@router.post("/api/tracker/room/create", summary="Create or connect to a multiplayer match room with host player")
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
            if payload and payload.pairing_id and not existing.get("pairing_id"):
                existing["pairing_id"] = payload.pairing_id
                if isinstance(existing.get("state"), dict):
                    existing["state"]["pairing_id"] = payload.pairing_id
                    if isinstance(existing["state"].get("game"), dict):
                        existing["state"]["game"]["pairingId"] = payload.pairing_id
            u_id = user["id"] if user else None
            role, claim_slot = determine_existing_room_role(user, existing, match_id, payload)
            if claim_slot == "user_id_p1":
                existing["user_id_p1"] = u_id
                try:
                    fs_engine = get_firestore_engine()
                    fs_engine.update_room(match_id, {"user_id_p1": u_id})
                except Exception:
                    pass
            elif claim_slot == "user_id_p2":
                existing["user_id_p2"] = u_id or f"p2_{secrets.token_hex(3)}"
                if user and user.get("display_name") and not (match_id.startswith("BCP-") or match_id.startswith("ES-")):
                    if isinstance(existing.get("state"), dict) and isinstance(existing["state"].get("game"), dict):
                        existing["state"]["game"]["p2Name"] = user["display_name"]
                try:
                    fs_engine = get_firestore_engine()
                    fs_engine.update_room(match_id, {
                        "user_id_p2": existing["user_id_p2"],
                        "p2_name": existing.get("state", {}).get("game", {}).get("p2Name") or (user.get("display_name") if user else "Player 2")
                    })
                except Exception:
                    pass

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

        # Check Firestore for multi-worker support
        fs_engine = get_firestore_engine()
        fs_doc = fs_engine.get_room(match_id)
        if fs_doc and fs_doc.get("state"):
            u_id = user["id"] if user else None
            role, claim_slot = determine_existing_room_role(user, fs_doc, match_id, payload)
            if claim_slot == "user_id_p1":
                fs_doc["user_id_p1"] = u_id
                try:
                    fs_engine.update_room(match_id, {"user_id_p1": u_id})
                except Exception:
                    pass
            elif claim_slot == "user_id_p2":
                fs_doc["user_id_p2"] = u_id or f"p2_{secrets.token_hex(3)}"
                if user and user.get("display_name") and not (match_id.startswith("BCP-") or match_id.startswith("ES-")):
                    if isinstance(fs_doc.get("state"), dict) and isinstance(fs_doc["state"].get("game"), dict):
                        fs_doc["state"]["game"]["p2Name"] = user["display_name"]
                try:
                    fs_engine.update_room(match_id, {
                        "user_id_p2": fs_doc["user_id_p2"],
                        "p2_name": fs_doc.get("state", {}).get("game", {}).get("p2Name") or (user.get("display_name") if user else "Player 2")
                    })
                except Exception:
                    pass

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
            return {
                "success": True,
                "match_id": match_id,
                "role": role,
                "user_id_p1": fs_doc.get("user_id_p1"),
                "user_id_p2": fs_doc.get("user_id_p2"),
                "p1_name": fs_doc.get("p1_name") or "Player 1",
                "p2_name": fs_doc.get("p2_name") or "Player 2",
                "state": fs_doc["state"],
                "chess_clock": fs_doc.get("chess_clock")
            }

        saved_game = db.get_tracker_game(match_id)
        if saved_game and saved_game.get("state"):
            u_id = user["id"] if user else None
            role, claim_slot = determine_existing_room_role(user, saved_game, match_id, payload)
            if claim_slot == "user_id_p1":
                saved_game["user_id_p1"] = u_id
            elif claim_slot == "user_id_p2":
                saved_game["user_id_p2"] = u_id or f"p2_{secrets.token_hex(3)}"

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

    p1_target = (payload.p1_name or "").strip() if payload else ""
    p2_target = (payload.p2_name or "").strip() if payload else ""
    p1_target_id = payload.p1_id if payload else None
    p2_target_id = payload.p2_id if payload else None

    is_tournament = (
        match_id.startswith("BCP-") or
        match_id.startswith("ES-") or
        bool(payload and payload.event_id)
    )

    is_staff = bool(user and (
        user.get("role") in ("admin", "referee", "to", "organizer") or
        user.get("is_admin") or
        user.get("can_access_to")
    ))

    is_p1_creator = bool(user and p1_target and check_user_matches_player(user, p1_target, p1_target_id))
    is_p2_creator = bool(user and p2_target and check_user_matches_player(user, p2_target, p2_target_id))

    if is_tournament:
        if is_p1_creator:
            user_id_p1 = user["id"] if user else None
            user_id_p2 = None
            created_role = "player1"
        elif is_p2_creator:
            user_id_p1 = None
            user_id_p2 = user["id"] if user else None
            created_role = "player2"
        elif is_staff:
            user_id_p1 = None
            user_id_p2 = None
            created_role = "referee"
        else:
            user_id_p1 = None
            user_id_p2 = None
            created_role = "spectator"
    else:
        if is_p2_creator and not is_p1_creator:
            user_id_p1 = None
            user_id_p2 = user["id"] if user else None
            created_role = "player2"
        elif is_p1_creator:
            user_id_p1 = user["id"] if user else None
            user_id_p2 = None
            created_role = "player1"
        else:
            # Non-competitor (e.g. TO/Staff) or casual room
            user_id_p1 = user["id"] if (user and not (p1_target or p2_target)) else None
            user_id_p2 = None
            created_role = "spectator" if (p1_target and p2_target) else "player1"

    p1_name = (payload.p1_name if payload and payload.p1_name else None) or (user.get("display_name") if user else None) or "Player 1"
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
        "pairing_id": payload.pairing_id if payload else None,
        "user_id_p1": user_id_p1,
        "user_id_p2": user_id_p2,
        "game": {
            "p1Name": p1_name,
            "p2Name": p2_name,
            "p1Id": p1_target_id,
            "p2Id": p2_target_id,
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
            "tableNum": payload.table_num if payload else None,
            "pairingId": payload.pairing_id if payload else None
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

    TRACKER_ROOMS[match_id] = {
        "match_id": match_id,
        "user_id_p1": user_id_p1,
        "user_id_p2": user_id_p2,
        "referee_ids": [],
        "version": 1,
        "state": initial_state,
        "chess_clock": initial_clock,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    # Persist hot ephemeral room to Cloud Firestore Native
    try:
        fs_engine = get_firestore_engine()
        fs_engine.create_room(match_id, {
            "user_id_p1": user_id_p1,
            "user_id_p2": user_id_p2,
            "referee_ids": [],
            "version": 1,
            "p1_name": p1_name,
            "p2_name": p2_name,
            "state": initial_state,
            "chess_clock": initial_clock
        })
        logger.info(f"🔥 [CREATE ROOM] Created Firestore document rooms/{match_id}")
    except Exception as err:
        logger.error(f"❌ [CREATE ROOM] Firestore save error for {match_id}: {err}", exc_info=True)
        
    return {
        "success": True,
        "match_id": match_id,
        "role": created_role,
        "user_id_p1": user_id_p1,
        "user_id_p2": user_id_p2,
        "p1_name": p1_name,
        "p2_name": p2_name,
        "state": initial_state
    }

@router.get("/api/tracker/firestore/rooms/{match_id}", summary="Diagnostics: Verify and inspect raw document from Cloud Firestore")
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

@router.get("/api/tracker/room/{match_id}/check", summary="Check if room exists and check player slots")
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
                chat_room = db.find_chat_room_key(match_id)
                if chat_room:
                    room = init_tracker_room_from_chat(match_id, chat_room, fs_engine)
                else:
                    return {"exists": False, "match_id": match_id, "error": f"Room key '{match_id}' does not exist."}
            
    p1_id = room.get("user_id_p1")
    p2_id = room.get("user_id_p2")
    st = room.get("state", {}) if isinstance(room.get("state"), dict) else {}
    game = st.get("game", {}) if isinstance(st.get("game"), dict) else {}
    p1_assigned_name = room.get("p1_name") or game.get("p1Name") or "Player 1"
    p2_assigned_name = room.get("p2_name") or game.get("p2Name") or "Player 2"
    p1_target_id = game.get("p1Id")
    p2_target_id = game.get("p2Id")

    is_p1 = bool(user_id and p1_id == user_id)
    is_p2 = bool(user_id and p2_id == user_id)
    is_finished = bool(room.get("is_finished") or (isinstance(room.get("state"), dict) and room["state"].get("is_finished")))
    is_tournament = (
        match_id.startswith("BCP-") or
        match_id.startswith("ES-") or
        bool(st.get("event_id")) or
        bool(game.get("eventId"))
    )

    if is_tournament:
        matches_p1 = bool(user and check_user_matches_player(user, p1_assigned_name, p1_target_id))
        matches_p2 = bool(user and check_user_matches_player(user, p2_assigned_name, p2_target_id))
        is_open_for_p2 = bool(not is_finished and p2_id is None and matches_p2)
        is_full = bool(is_finished or (p1_id is not None and p2_id is not None and not is_p1 and not is_p2) or (not matches_p1 and not matches_p2 and not is_p1 and not is_p2))
    else:
        is_open_for_p2 = bool(not is_finished and p2_id is None and not is_p1)
        is_full = bool(is_finished or (p1_id is not None and p2_id is not None and not is_p1 and not is_p2))
    
    return {
        "exists": True,
        "match_id": match_id,
        "p1_name": p1_assigned_name,
        "p2_name": p2_assigned_name,
        "is_full": is_full,
        "is_open_for_p2": is_open_for_p2,
        "is_finished": is_finished,
        "scorecard_url": f"/scorecard/{match_id}"
    }

@router.post("/api/tracker/room/{match_id}/join", summary="Join match room and claim Player 2 slot or Spectator")
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
                chat_room = db.find_chat_room_key(match_id)
                if chat_room:
                    room = init_tracker_room_from_chat(match_id, chat_room, fs_engine)
                else:
                    raise HTTPException(status_code=404, detail="Match room not found")
            
    room = TRACKER_ROOMS[match_id]
    st = room.get("state", {})
    game = st.get("game", {}) if isinstance(st.get("game"), dict) else {}

    role, claim_slot = determine_existing_room_role(user, room, match_id, payload)
    
    is_tournament = (
        match_id.startswith("BCP-") or
        match_id.startswith("ES-") or
        bool(st.get("event_id")) or
        bool(game.get("eventId"))
    )

    if claim_slot == "user_id_p1":
        room["user_id_p1"] = user_id or f"p1_{secrets.token_hex(3)}"
        room["version"] = room.get("version", 1) + 1
        try:
            fs_engine.update_room(match_id, {
                "user_id_p1": room["user_id_p1"],
                "p1_name": game.get("p1Name", room.get("p1_name", "Player 1")),
                "state": st,
                "version": room["version"]
            })
        except Exception:
            pass
    elif claim_slot == "user_id_p2":
        room["user_id_p2"] = user_id or f"p2_{secrets.token_hex(3)}"
        if payload and payload.faction and not game.get("p2Faction"):
            game["p2Faction"] = payload.faction
        if payload and payload.detachment and not game.get("p2Detachment"):
            game["p2Detachment"] = payload.detachment
        if not is_tournament and payload and payload.player_name and payload.player_name != "Player 2":
            game["p2Name"] = payload.player_name
        room["version"] = room.get("version", 1) + 1

        try:
            fs_engine.update_room(match_id, {
                "user_id_p2": room["user_id_p2"],
                "p2_name": game.get("p2Name", room.get("p2_name", "Player 2")),
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

@router.post("/api/tracker/room/{match_id}/state", summary="Broadcast and persist multiplayer tracker state with role enforcement")
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
    
    is_p1 = bool(user_id and room.get("user_id_p1") == user_id)
    is_p2 = bool(user_id and room.get("user_id_p2") == user_id)
    is_ref = bool(user and (user_id in room.get("referee_ids", []) or user.get("role") in ("admin", "referee", "to", "organizer") or user.get("is_admin") or user.get("can_access_to")))
    is_tournament = (
        match_id.startswith("BCP-") or
        match_id.startswith("ES-") or
        bool(room.get("state", {}).get("event_id")) or
        bool(room.get("state", {}).get("game", {}).get("eventId"))
    )
    
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
            "user_id_p2": room.get("user_id_p2")
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

@router.get("/api/tracker/room/{match_id}", summary="Get current match room state")
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

@router.get("/api/tracker/history", summary="Get persistent history of tracker games")
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

@router.get("/api/tracker/sessions", summary="Get user's 3-tier active slot management (primary active, unfinished, completed)")
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

@router.post("/api/tracker/room/{match_id}/discard", summary="Discard / abandon a casual test session with zero Elo penalty")
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

@router.post("/api/tracker/room/{match_id}/finalize", summary="Finalize and lock match scorecard and compute Elo")
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

    user_id = user["id"] if user else None
    is_p1 = bool(user_id and room.get("user_id_p1") == user_id)
    is_p2 = bool(user_id and room.get("user_id_p2") == user_id)
    is_ref = bool(user and (user_id in room.get("referee_ids", []) or user.get("role") in ("admin", "referee", "to", "organizer") or user.get("is_admin") or user.get("can_access_to")))
    is_tournament = (
        match_id.startswith("BCP-") or
        match_id.startswith("ES-") or
        bool(room.get("state", {}).get("event_id")) or
        bool(room.get("state", {}).get("game", {}).get("eventId"))
    )

    if is_tournament:
        if not (is_p1 or is_p2 or is_ref):
            raise HTTPException(status_code=403, detail="Permission denied: Only matched competitors or tournament organizers can finalize this tournament match.")
    else:
        if room.get("user_id_p1") or room.get("user_id_p2"):
            if not (is_p1 or is_p2 or is_ref):
                raise HTTPException(status_code=403, detail="Permission denied: Spectators cannot finalize match")
    
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

@router.post("/api/tracker/room/{match_id}/hide", summary="Soft-delete/hide a game from the user's personal history")
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

@router.post("/api/tracker/room/{match_id}/unhide", summary="Unhide a game in the user's personal history")
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

@router.get("/api/scorecard/{match_id}", summary="Get verified tournament digital scorecard data")
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

@router.get("/scorecard/{match_id}", summary="View digital scorecard page")
async def view_scorecard_page(match_id: str):
    scorecard_file = web_dir / "scorecard.html"
    if scorecard_file.exists():
        return FileResponse(scorecard_file)
    return RedirectResponse(f"/?scorecard={match_id}")


@router.get("/api/tracker/debug/test_save", summary="Diagnostics endpoint to test DB writes to tracker_games")
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



@router.post("/api/tracker/room/{match_id}/armylist", summary="Attach player army list to live match room")
async def api_tracker_attach_armylist(match_id: str, request: Request):
    match_id = normalize_tracker_match_id(match_id)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    
    role = body.get("role") or "player1"
    army_list = body.get("army_list") or {}

    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    user_id = user["id"] if user else None

    # 1. Update in-memory room
    if match_id not in TRACKER_ROOMS:
        TRACKER_ROOMS[match_id] = {
            "match_id": match_id,
            "state": {},
            "version": 1
        }

    room = TRACKER_ROOMS[match_id]
    is_p1 = bool(user_id and room.get("user_id_p1") == user_id)
    is_p2 = bool(user_id and room.get("user_id_p2") == user_id)
    is_ref = bool(user and (user_id in room.get("referee_ids", []) or user.get("role") in ("admin", "referee", "to", "organizer") or user.get("is_admin") or user.get("can_access_to")))
    is_tournament = (
        match_id.startswith("BCP-") or
        match_id.startswith("ES-") or
        bool(room.get("state", {}).get("event_id")) or
        bool(room.get("state", {}).get("game", {}).get("eventId"))
    )
    if is_tournament and not (is_p1 or is_p2 or is_ref):
        raise HTTPException(status_code=403, detail="Permission denied: Spectators cannot attach army lists.")

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

@router.get("/api/tracker/room/{match_id}/armylists", summary="Get attached army lists for Player 1 and Player 2")
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

@router.post("/api/tracker/room/{match_id}/clock", summary="Synchronize tournament dual chess clock state")
async def api_tracker_update_clock(match_id: str, request: Request):
    match_id = normalize_tracker_match_id(match_id)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    user_id = user["id"] if user else None

    if match_id not in TRACKER_ROOMS:
        TRACKER_ROOMS[match_id] = {
            "match_id": match_id,
            "state": {},
            "version": 1
        }

    room = TRACKER_ROOMS[match_id]
    is_p1 = bool(user_id and room.get("user_id_p1") == user_id)
    is_p2 = bool(user_id and room.get("user_id_p2") == user_id)
    is_ref = bool(user and (user_id in room.get("referee_ids", []) or user.get("role") in ("admin", "referee", "to", "organizer") or user.get("is_admin") or user.get("can_access_to")))
    is_tournament = (
        match_id.startswith("BCP-") or
        match_id.startswith("ES-") or
        bool(room.get("state", {}).get("event_id")) or
        bool(room.get("state", {}).get("game", {}).get("eventId"))
    )
    if is_tournament and not (is_p1 or is_p2 or is_ref):
        raise HTTPException(status_code=403, detail="Permission denied: Spectators cannot modify tournament clock.")
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
        fs_engine.update_room(match_id, {"chess_clock": clock_data})
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

@router.post("/api/tracker/room/{match_id}/dice_tray", summary="Synchronize live tabletop dice tray across players")
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
            "dice_target": target
        }
        if history is not None:
            update_fields["dice_history"] = history
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

@router.post("/api/tracker/room/{match_id}/dice_roll", summary="Broadcast live dice roll to both players in room")
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
            "dice_target": target
        }
        if tray is not None:
            fs_updates["dice_tray"] = tray
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

@router.get("/api/tracker/room/{match_id}/stream", summary="Real-time Server-Sent Events stream for multiplayer match")
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

