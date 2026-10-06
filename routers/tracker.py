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

def generate_unique_match_id(db, game_system: str = "40k") -> str:
    """Generates a cryptographically collision-free random match ID."""
    prefix = "AOS" if str(game_system).lower() == "aos" else "WH40K"
    for _ in range(20):
        token = secrets.token_hex(4).upper()
        match_id = f"{prefix}-{token[:4]}-{token[4:]}"
        if match_id not in TRACKER_ROOMS and not (db and hasattr(db, "get_tracker_game") and db.get_tracker_game(match_id)):
            return match_id
    return f"{prefix}-{secrets.token_hex(6).upper()}"

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
    game_system: Optional[str] = "40k"

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
    if not raw:
        return ""
    clean = str(raw).strip().replace(" ", "")
    m = re.match(r"^(?:(WH40K-|AOS-))?(BCP|ES)-(.+)-R(\d+)-T(\d+)$", clean, re.IGNORECASE)
    if m:
        prefix = (m.group(1) or "").upper()
        system = m.group(2).upper()
        event_id = m.group(3).strip()
        r_num = m.group(4)
        t_num = m.group(5)
        return f"{prefix}{system}-{event_id}-R{r_num}-T{t_num}"

    s = clean.upper()
    if s.startswith("WH40K-") or s.startswith("BCP-") or s.startswith("ES-") or s.startswith("AOS-"):
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
        "id": match_id,
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

def extract_event_id_from_match_id(match_id: str) -> Optional[str]:
    """Extracts the event/tournament ID from standard match IDs like BCP-xyz-R1-T2 or ES-xyz-R1-T2."""
    if not match_id:
        return None
    m = re.match(r"^(?:WH40K-)?(?:AOS-)?(?:BCP|ES)-(.+)-R\d+-T\d+$", str(match_id).strip(), re.IGNORECASE)
    if m:
        return m.group(1)
    return None

TOURNAMENT_ORGANIZER_CACHE: Dict[str, Dict[str, Any]] = {}

def get_tournament_organizers(event_id: str) -> Dict[str, Any]:
    """
    Retrieves tournament organizer and referee IDs for a specific tournament event.
    Results are cached in-memory with a short TTL to prevent repeated DB/Firestore lookups.
    """
    if not event_id:
        return {}
    event_id_str = str(event_id).strip()
    now_ts = time.time()
    cached = TOURNAMENT_ORGANIZER_CACHE.get(event_id_str)
    if cached and (now_ts - cached.get("cached_at", 0) < 60.0):
        return cached

    org_id = None
    org_bcp_id = None
    referee_ids: List[str] = []

    try:
        db = get_database()
        if hasattr(db, "get_event_details"):
            ev = db.get_event_details(event_id_str)
            if ev and isinstance(ev, dict):
                org_id = ev.get("organizer_id") or org_id
                org_bcp_id = ev.get("organizer_bcp_id") or org_bcp_id
                raw_json = ev.get("raw_json") or {}
                if not org_bcp_id and isinstance(raw_json, dict):
                    org_bcp_id = raw_json.get("userId") or raw_json.get("organizerId") or raw_json.get("ownerId") or raw_json.get("owner_Id")
        if (not org_id or not org_bcp_id) and hasattr(db, "get_studio_event"):
            sev = db.get_studio_event(event_id_str)
            if sev and isinstance(sev, dict):
                org_id = org_id or sev.get("organizer_id")
                org_bcp_id = org_bcp_id or sev.get("organizer_bcp_id")
                raw_json = sev.get("raw_json") or {}
                if not org_bcp_id and isinstance(raw_json, dict):
                    org_bcp_id = raw_json.get("userId") or raw_json.get("organizerId") or raw_json.get("ownerId") or raw_json.get("owner_Id")
    except Exception as e:
        logger.debug(f"Notice looking up tournament organizer from DB for {event_id_str}: {e}")

    try:
        fs = get_firestore_engine()
        tourn_doc = None
        if hasattr(fs, "get_tournament_document"):
            tourn_doc = fs.get_tournament_document(event_id_str)
        elif hasattr(fs, "_fallback_tournaments"):
            tourn_doc = fs._fallback_tournaments.get(event_id_str)
        if tourn_doc and isinstance(tourn_doc, dict):
            org_id = org_id or tourn_doc.get("organizer_id") or tourn_doc.get("organizerId") or tourn_doc.get("created_by")
            org_bcp_id = org_bcp_id or tourn_doc.get("organizer_bcp_id") or tourn_doc.get("organizerBcpId")
            if tourn_doc.get("referee_ids") and isinstance(tourn_doc["referee_ids"], list):
                referee_ids.extend([str(r) for r in tourn_doc["referee_ids"] if r])
            if tourn_doc.get("referees") and isinstance(tourn_doc["referees"], list):
                for r in tourn_doc["referees"]:
                    if isinstance(r, dict):
                        rid = r.get("id") or r.get("user_id")
                        if rid:
                            referee_ids.append(str(rid))
    except Exception as e:
        logger.debug(f"Notice looking up tournament organizer from Firestore for {event_id_str}: {e}")

    result = {
        "organizer_id": str(org_id).strip() if org_id else None,
        "organizer_bcp_id": str(org_bcp_id).strip() if org_bcp_id else None,
        "referee_ids": [str(r).strip() for r in referee_ids if r],
        "cached_at": now_ts
    }
    TOURNAMENT_ORGANIZER_CACHE[event_id_str] = result
    return result

def check_user_is_tournament_staff(
    user: Optional[Dict[str, Any]],
    room_dict: Optional[Dict[str, Any]] = None,
    match_id: Optional[str] = None,
    event_id: Optional[str] = None
) -> bool:
    """
    Strict tournament staff authorization check:
    ONLY the specific Tournament Organizer of this tournament, an assigned match/tournament referee,
    or a global platform administrator/superuser can act as staff (referee role / score editor).
    Possessing a generic 'to' or 'organizer' role does NOT grant access to other organizers' tournaments.
    """
    if not user:
        return False

    # 1. Global superuser / platform administrator
    role = user.get("role") if isinstance(user, dict) else getattr(user, "role", None)
    role_str = str(role or "").strip().lower()
    is_admin = bool(
        (user.get("is_admin") if isinstance(user, dict) else getattr(user, "is_admin", False)) or
        role_str in ("admin", "superuser")
    )
    if is_admin:
        return True

    # 2. Gather user identifiers
    u_ids = set()
    for k in ("id", "user_id", "player_id", "bcp_user_id", "bcp_id", "sub", "userId"):
        v = user.get(k) if isinstance(user, dict) else getattr(user, k, None)
        if v is not None and str(v).strip():
            u_ids.add(str(v).strip().lower())
    if not u_ids:
        return False

    # 3. Check room-level assigned referees
    if room_dict and isinstance(room_dict, dict):
        room_referees = room_dict.get("referee_ids") or []
        for r in room_referees:
            if r and str(r).strip().lower() in u_ids:
                return True

    # 4. Check room-level organizer IDs
    if room_dict and isinstance(room_dict, dict):
        st = room_dict.get("state") if isinstance(room_dict.get("state"), dict) else {}
        game = st.get("game") if isinstance(st.get("game"), dict) else {}
        r_org_id = room_dict.get("organizer_id") or st.get("organizer_id") or game.get("organizer_id")
        r_org_bcp_id = room_dict.get("organizer_bcp_id") or st.get("organizer_bcp_id") or game.get("organizer_bcp_id")
        if r_org_id and str(r_org_id).strip().lower() in u_ids:
            return True
        if r_org_bcp_id and str(r_org_bcp_id).strip().lower() in u_ids:
            return True

    # 5. Check tournament event-level organizer and assigned referees
    eid = event_id
    if not eid and room_dict and isinstance(room_dict, dict):
        st = room_dict.get("state") if isinstance(room_dict.get("state"), dict) else {}
        game = st.get("game") if isinstance(st.get("game"), dict) else {}
        eid = (
            room_dict.get("event_id") or
            room_dict.get("eventId") or
            room_dict.get("tournament_id") or
            st.get("event_id") or
            st.get("tournament_id") or
            game.get("eventId") or
            game.get("tournament_id")
        )
    if not eid and match_id:
        eid = extract_event_id_from_match_id(match_id)

    if eid:
        org_info = get_tournament_organizers(str(eid).strip())
        ev_org_id = org_info.get("organizer_id")
        ev_org_bcp_id = org_info.get("organizer_bcp_id")
        ev_referees = org_info.get("referee_ids") or []

        if ev_org_id and str(ev_org_id).strip().lower() in u_ids:
            return True
        if ev_org_bcp_id and str(ev_org_bcp_id).strip().lower() in u_ids:
            return True
        for r in ev_referees:
            if r and str(r).strip().lower() in u_ids:
                return True

    return False

def init_tracker_room_from_tournament(match_id: str, fs_engine, db) -> Dict[str, Any]:
    """Auto-provisions a tournament match room when accessed directly via match_id."""
    m = re.match(r"^(?:WH40K-)?(?:AOS-)?(BCP|ES)-(.+)-R(\d+)-T(\d+)$", match_id, re.IGNORECASE)
    event_id = m.group(2) if m else None
    round_num = int(m.group(3)) if m else 1
    table_num = int(m.group(4)) if m else 1

    p1_name = "Player 1"
    p2_name = "Player 2"
    p1_fac = None
    p2_fac = None
    p1_id = None
    p2_id = None
    pairing_id = None
    details = None

    if event_id:
        try:
            details = db.get_event_details(event_id) if hasattr(db, "get_event_details") else None
            if details and details.get("matches"):
                for mt in details["matches"]:
                    mt_round = int(mt.get("round") or mt.get("round_num") or mt.get("round_number") or 1)
                    mt_table = int(mt.get("table_number") or mt.get("table_num") or mt.get("table") or 1)
                    if mt_round == round_num and mt_table == table_num:
                        p1_name = mt.get("player1_name") or mt.get("p1_name") or p1_name
                        p2_name = mt.get("player2_name") or mt.get("p2_name") or p2_name
                        p1_fac = mt.get("player1_faction") or mt.get("p1_faction") or p1_fac
                        p2_fac = mt.get("player2_faction") or mt.get("p2_faction") or p2_fac
                        p1_id = mt.get("player1_id") or mt.get("p1_id") or p1_id
                        p2_id = mt.get("player2_id") or mt.get("p2_id") or p2_id
                        pairing_id = mt.get("bcp_pairing_id") or mt.get("pairing_id") or mt.get("id") or pairing_id
                        break
        except Exception:
            pass

    org_info = get_tournament_organizers(event_id) if event_id else {}
    organizer_id = org_info.get("organizer_id") or (details.get("organizer_id") if details else None)
    organizer_bcp_id = org_info.get("organizer_bcp_id") or (details.get("organizer_bcp_id") if details else None)
    referee_ids = list(org_info.get("referee_ids") or [])

    initial_state = {
        "id": match_id,
        "match_id": match_id,
        "event_id": event_id,
        "round_num": round_num,
        "table_num": table_num,
        "pairing_id": pairing_id,
        "organizer_id": organizer_id,
        "organizer_bcp_id": organizer_bcp_id,
        "user_id_p1": None,
        "user_id_p2": None,
        "game": {
            "p1Name": p1_name,
            "p2Name": p2_name,
            "p1Faction": p1_fac,
            "p2Faction": p2_fac,
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
            "eventId": event_id,
            "roundNum": round_num,
            "tableNum": table_num,
            "pairingId": pairing_id,
            "organizerId": organizer_id,
            "p1Id": p1_id,
            "p2Id": p2_id
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
        "event_id": event_id,
        "round_num": round_num,
        "table_num": table_num,
        "pairing_id": pairing_id,
        "organizer_id": organizer_id,
        "organizer_bcp_id": organizer_bcp_id,
        "user_id_p1": None,
        "user_id_p2": None,
        "referee_ids": referee_ids,
        "version": 1,
        "p1_name": p1_name,
        "p2_name": p2_name,
        "state": initial_state,
        "chess_clock": initial_clock,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    TRACKER_ROOMS[match_id] = room
    try:
        fs_engine.create_room(match_id, {
            "event_id": event_id,
            "round_num": round_num,
            "table_num": table_num,
            "pairing_id": pairing_id,
            "organizer_id": organizer_id,
            "organizer_bcp_id": organizer_bcp_id,
            "user_id_p1": None,
            "user_id_p2": None,
            "referee_ids": referee_ids,
            "version": 1,
            "p1_name": p1_name,
            "p2_name": p2_name,
            "state": initial_state,
            "chess_clock": initial_clock,
            "created_at": room["created_at"],
            "updated_at": room["updated_at"]
        })
        logger.info(f"🏆 [TOURNAMENT TRACKER] Auto-initialized tournament room {match_id}")
    except Exception as err:
        logger.warning(f"Notice auto-initializing tournament room {match_id}: {err}")

    return room

def determine_existing_room_role(user: Optional[Dict[str, Any]], room_dict: Dict[str, Any], match_id: str, payload: Optional[Any] = None) -> Tuple[str, Optional[str]]:
    """
    Determines role ('player1', 'player2', 'referee', 'spectator') and slot to claim ('user_id_p1', 'user_id_p2', or None).
    Ensures that for event matches (BCP-*, ES-*, or rooms with event_id), ONLY the assigned table competitors
    can enter as player1 or player2.
    For referee role, ONLY the specific Tournament Organizer of this tournament (or platform superadmin / assigned referee)
    can enter as referee. All other users enter as spectator.
    """
    candidate_user = user
    if not candidate_user and payload and (getattr(payload, "player_id", None) or getattr(payload, "player_name", None)):
        candidate_user = {
            "id": getattr(payload, "player_id", None),
            "display_name": getattr(payload, "player_name", None)
        }

    u_id = None
    if candidate_user:
        if isinstance(candidate_user, dict):
            u_id = candidate_user.get("id") or candidate_user.get("user_id")
        else:
            u_id = getattr(candidate_user, "id", None) or getattr(candidate_user, "user_id", None)

    st = room_dict.get("state", {}) if isinstance(room_dict.get("state"), dict) else {}
    game = st.get("game", {}) if isinstance(st.get("game"), dict) else {}
    participants = room_dict.get("participants", {}) if isinstance(room_dict.get("participants"), dict) else {}

    p1_id = (
        room_dict.get("user_id_p1")
        or st.get("user_id_p1")
        or (participants.get("player1", {}).get("uid") if isinstance(participants.get("player1"), dict) else None)
    )
    p2_id = (
        room_dict.get("user_id_p2")
        or st.get("user_id_p2")
        or (participants.get("player2", {}).get("uid") if isinstance(participants.get("player2"), dict) else None)
    )

    p1_assigned_name = room_dict.get("p1_name") or game.get("p1Name") or getattr(payload, "p1_name", None) or "Player 1"
    p2_assigned_name = room_dict.get("p2_name") or game.get("p2Name") or getattr(payload, "p2_name", None) or "Player 2"
    p1_target_id = game.get("p1Id") or getattr(payload, "p1_id", None)
    p2_target_id = game.get("p2Id") or getattr(payload, "p2_id", None)

    is_tournament = (
        match_id.startswith("BCP-") or
        match_id.startswith("ES-") or
        bool(payload and getattr(payload, "event_id", None)) or
        bool(room_dict.get("event_id")) or
        bool(room_dict.get("eventId")) or
        bool(room_dict.get("tournament_id")) or
        bool(st.get("event_id")) or
        bool(game.get("eventId"))
    )

    claim_role = getattr(payload, "claim_role", None)
    if claim_role == "spectator":
        return ("spectator", None)

    if is_tournament:
        # Strict table pairings: ONLY the two matched competitors can claim player slots
        matches_p1 = bool(candidate_user and check_user_matches_player(candidate_user, p1_assigned_name, p1_target_id))
        matches_p2 = bool(candidate_user and check_user_matches_player(candidate_user, p2_assigned_name, p2_target_id))

        if matches_p1:
            return ("player1", None if p1_id == u_id else "user_id_p1")
        if matches_p2:
            return ("player2", None if p2_id == u_id else "user_id_p2")
        # Strict staff check: ONLY this specific tournament's TO (or platform admin) enters as referee
        is_tournament_staff = check_user_is_tournament_staff(
            candidate_user,
            room_dict=room_dict,
            match_id=match_id,
            event_id=getattr(payload, "event_id", None) if payload else None
        )
        if is_tournament_staff:
            return ("referee", None)
        return ("spectator", None)
    else:
        if u_id and p1_id == u_id:
            return ("player1", None)
        if u_id and p2_id == u_id:
            return ("player2", None)

        # Casual match logic: 1st user gets player1, 2nd user gets player2, 3rd user gets spectator
        if claim_role == "player2" and not p2_id:
            return ("player2", "user_id_p2")
        if claim_role == "player1" and not p1_id:
            return ("player1", "user_id_p1")
        if not p1_id:
            return ("player1", "user_id_p1")
        if not p2_id and u_id != p1_id:
            return ("player2", "user_id_p2")
        if u_id and u_id in (room_dict.get("referee_ids") or []):
            return ("referee", None)
        return ("spectator" if (p1_id and p2_id) else "player1", None)

@router.post("/api/tracker/room/create", summary="Create or connect to a multiplayer match room with host player")
async def api_tracker_create_room(request: Request, payload: Optional[TrackerCreatePayload] = None):
    db = get_database()
    user = getattr(request, "_mock_user", None) if request else None
    if user is None:
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "") if request and hasattr(request, "headers") else ""
        session_token = (payload.token if payload and payload.token else None) or (request.cookies.get("session_token") if request and hasattr(request, "cookies") else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
    
    req_sys = (payload.game_system if payload and payload.game_system else None) or request.headers.get("X-Game-System") or ("aos" if payload and payload.match_id and payload.match_id.startswith("AOS-") else "40k")
    sys_id = "aos" if "aos" in str(req_sys).lower() else "40k"

    # Check if deterministic tournament room was requested
    match_id = None
    if payload:
        if payload.match_id:
            match_id = normalize_tracker_match_id(payload.match_id)
        elif payload.event_id and payload.round_num is not None and payload.table_num is not None:
            prefix = "AOS-" if sys_id == "aos" else "BCP-"
            match_id = f"{prefix}{payload.event_id}-R{payload.round_num}-T{payload.table_num}".upper()
    
    # If room already exists in memory or DB, return existing state so opponent joins same room!
    if match_id:
        if match_id in TRACKER_ROOMS:
            existing = TRACKER_ROOMS[match_id]
            existing_sys = existing.get("game_system") or ("aos" if match_id.startswith("AOS-") else sys_id)
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
                "game_system": existing_sys,
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
                "game_system": fs_doc.get("game_system") or ("aos" if match_id.startswith("AOS-") else sys_id),
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
                "game_system": fs_doc.get("game_system") or ("aos" if match_id.startswith("AOS-") else sys_id),
                "user_id_p1": fs_doc.get("user_id_p1"),
                "user_id_p2": fs_doc.get("user_id_p2"),
                "p1_name": fs_doc.get("p1_name") or "Player 1",
                "p2_name": fs_doc.get("p2_name") or "Player 2",
                "state": fs_doc["state"],
                "chess_clock": fs_doc.get("chess_clock")
            }

        saved_game = db.get_tracker_game(match_id) if (db and hasattr(db, "get_tracker_game")) else None
        if saved_game and saved_game.get("state"):
            u_id = user["id"] if user else None
            role, claim_slot = determine_existing_room_role(user, saved_game, match_id, payload)
            if claim_slot == "user_id_p1":
                saved_game["user_id_p1"] = u_id
            elif claim_slot == "user_id_p2":
                saved_game["user_id_p2"] = u_id or f"p2_{secrets.token_hex(3)}"

            TRACKER_ROOMS[match_id] = {
                "match_id": match_id,
                "game_system": saved_game.get("game_system") or ("aos" if match_id.startswith("AOS-") else sys_id),
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
                "game_system": saved_game.get("game_system") or ("aos" if match_id.startswith("AOS-") else sys_id),
                "user_id_p1": saved_game.get("user_id_p1"),
                "user_id_p2": saved_game.get("user_id_p2"),
                "p1_name": saved_game.get("p1_name") or "Player 1",
                "p2_name": saved_game.get("p2_name") or "Player 2",
                "state": saved_game["state"],
                "chess_clock": saved_game.get("chess_clock")
            }
    else:
        match_id = generate_unique_match_id(db, game_system=sys_id)

    p1_target = (payload.p1_name or "").strip() if payload else ""
    p2_target = (payload.p2_name or "").strip() if payload else ""
    p1_target_id = payload.p1_id if payload else None
    p2_target_id = payload.p2_id if payload else None

    is_tournament = (
        match_id.startswith("BCP-") or
        match_id.startswith("ES-") or
        bool(payload and payload.event_id)
    )

    is_tournament_staff = check_user_is_tournament_staff(
        user,
        room_dict=None,
        match_id=match_id,
        event_id=payload.event_id if payload else None
    )

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
        elif is_tournament_staff:
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
        "id": match_id,
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

    # Seed tournament master clock and organizer metadata if available
    ev_id = (payload.event_id if payload else None)
    if not ev_id and match_id:
        ev_id = extract_event_id_from_match_id(match_id)

    org_info = get_tournament_organizers(ev_id) if ev_id else {}
    organizer_id = org_info.get("organizer_id")
    organizer_bcp_id = org_info.get("organizer_bcp_id")
    referee_ids = list(org_info.get("referee_ids") or [])

    master_clock = None
    if ev_id:
        try:
            fs_engine = get_firestore_engine()
            master_clock = fs_engine.get_tournament_master_clock(ev_id)
        except Exception:
            pass

    TRACKER_ROOMS[match_id] = {
        "match_id": match_id,
        "game_system": sys_id,
        "eventId": ev_id,
        "event_id": ev_id,
        "tournament_id": ev_id,
        "organizer_id": organizer_id,
        "organizer_bcp_id": organizer_bcp_id,
        "table_num": payload.table_num if payload else None,
        "user_id_p1": user_id_p1,
        "user_id_p2": user_id_p2,
        "referee_ids": referee_ids,
        "version": 1,
        "state": initial_state,
        "chess_clock": initial_clock,
        "masterClock": master_clock,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    # Persist hot ephemeral room to Cloud Firestore Native
    try:
        fs_engine = get_firestore_engine()
        fs_engine.create_room(match_id, {
            "game_system": sys_id,
            "eventId": ev_id,
            "event_id": ev_id,
            "tournament_id": ev_id,
            "organizer_id": organizer_id,
            "organizer_bcp_id": organizer_bcp_id,
            "table_num": payload.table_num if payload else None,
            "user_id_p1": user_id_p1,
            "user_id_p2": user_id_p2,
            "referee_ids": referee_ids,
            "version": 1,
            "p1_name": p1_name,
            "p2_name": p2_name,
            "state": initial_state,
            "chess_clock": initial_clock,
            "masterClock": master_clock
        })
        logger.info(f"🔥 [CREATE ROOM] Created Firestore document rooms/{match_id}")
    except Exception as err:
        logger.error(f"❌ [CREATE ROOM] Firestore save error for {match_id}: {err}", exc_info=True)
        
    return {
        "success": True,
        "match_id": match_id,
        "game_system": sys_id,
        "role": created_role,
        "user_id_p1": user_id_p1,
        "user_id_p2": user_id_p2,
        "p1_name": p1_name,
        "p2_name": p2_name,
        "state": initial_state,
        "masterClock": master_clock
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
        
    db = None
    try:
        db = get_database()
    except Exception:
        pass
    fs_engine = get_firestore_engine()
    user = getattr(request, "_mock_user", None) if request else None
    if user is None and request:
        try:
            auth_mgr = get_auth_manager()
            auth_header = request.headers.get("Authorization", "") if hasattr(request, "headers") else ""
            session_token = (request.cookies.get("session_token") if hasattr(request, "cookies") else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
            user = auth_mgr.get_session(session_token) if session_token else None
        except Exception:
            pass
    user_id = user["id"] if user else None
    
    if hasattr(fs_engine, "is_room_discarded") and fs_engine.is_room_discarded(match_id):
        TRACKER_ROOMS.pop(match_id, None)
        return {"exists": False, "is_abandoned": True, "match_id": match_id, "error": f"Room key '{match_id}' was discarded."}

    if match_id in TRACKER_ROOMS and not fs_engine.is_connected:
        room = TRACKER_ROOMS[match_id]
    else:
        fs_doc = fs_engine.get_room(match_id)
        if fs_doc and fs_doc.get("state"):
            room = {
                "match_id": match_id,
                "user_id_p1": fs_doc.get("user_id_p1") or (fs_doc["state"].get("user_id_p1") if isinstance(fs_doc.get("state"), dict) else None),
                "user_id_p2": fs_doc.get("user_id_p2") or (fs_doc["state"].get("user_id_p2") if isinstance(fs_doc.get("state"), dict) else None),
                "p1_name": fs_doc.get("p1_name"),
                "p2_name": fs_doc.get("p2_name"),
                "version": fs_doc.get("version", 1),
                "state": fs_doc["state"],
                "participants": fs_doc.get("participants", {})
            }
            TRACKER_ROOMS[match_id] = room
        elif match_id in TRACKER_ROOMS and not fs_engine.is_connected:
            room = TRACKER_ROOMS[match_id]
        else:
            if fs_engine.is_connected:
                TRACKER_ROOMS.pop(match_id, None)
            saved = db.get_tracker_game(match_id) if (db and hasattr(db, "get_tracker_game")) else None
            if saved and saved.get("state"):
                is_fin = bool(saved.get("is_finished") or (isinstance(saved.get("state"), dict) and saved["state"].get("is_finished")))
                if fs_engine.is_connected and not is_fin:
                    return {"exists": False, "is_abandoned": True, "match_id": match_id, "error": f"Room key '{match_id}' does not exist."}
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
                chat_room = db.find_chat_room_key(match_id) if (db and hasattr(db, "find_chat_room_key")) else None
                if chat_room:
                    room = init_tracker_room_from_chat(match_id, chat_room, fs_engine)
                elif match_id.startswith("BCP-") or match_id.startswith("ES-"):
                    room = init_tracker_room_from_tournament(match_id, fs_engine, db)
                else:
                    return {"exists": False, "match_id": match_id, "error": f"Room key '{match_id}' does not exist."}
            
    st = room.get("state", {}) if isinstance(room.get("state"), dict) else {}
    game = st.get("game", {}) if isinstance(st.get("game"), dict) else {}
    participants = room.get("participants", {}) if isinstance(room.get("participants"), dict) else {}
    p1_id = (
        room.get("user_id_p1")
        or st.get("user_id_p1")
        or (participants.get("player1", {}).get("uid") if isinstance(participants.get("player1"), dict) else None)
    )
    p2_id = (
        room.get("user_id_p2")
        or st.get("user_id_p2")
        or (participants.get("player2", {}).get("uid") if isinstance(participants.get("player2"), dict) else None)
    )
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

    user_id = user["id"] if user else None
    room_sys = room.get("game_system") or st.get("game_system") or st.get("gameSystem") or ("aos" if match_id.startswith("AOS-") else "40k")

    if is_tournament:
        is_tournament_staff = check_user_is_tournament_staff(user, room, match_id=match_id)
        matches_p1 = bool(user and check_user_matches_player(user, p1_assigned_name, p1_target_id))
        matches_p2 = bool(user and check_user_matches_player(user, p2_assigned_name, p2_target_id))
        is_open_for_p2 = bool(not is_finished and p2_id is None and matches_p2)
        is_full = bool(is_finished or (p1_id is not None and p2_id is not None and not is_p1 and not is_p2 and not is_tournament_staff) or (not matches_p1 and not matches_p2 and not is_p1 and not is_p2 and not is_tournament_staff))
        is_spectator = bool(not matches_p1 and not matches_p2 and not is_tournament_staff)
        assigned_role = "player1" if matches_p1 else ("player2" if matches_p2 else ("referee" if is_tournament_staff else "spectator"))
        return {
            "exists": True,
            "match_id": match_id,
            "game_system": room_sys,
            "p1_name": p1_assigned_name,
            "p2_name": p2_assigned_name,
            "is_full": is_full,
            "is_open_for_p2": is_open_for_p2,
            "is_finished": is_finished,
            "is_spectator": is_spectator,
            "is_referee": is_tournament_staff,
            "role": assigned_role,
            "scorecard_url": f"/scorecard/{match_id}"
        }
    else:
        is_staff = bool(user_id and user_id in (room.get("referee_ids") or []))
        is_open_for_p2 = bool(not is_finished and p2_id is None and not is_p1)
        is_full = bool(is_finished or (p1_id is not None and p2_id is not None and not is_p1 and not is_p2 and not is_staff))
        assigned_role = "player1" if (is_p1 or not p1_id) else ("player2" if (is_p2 or (not p2_id and not is_p1)) else ("referee" if is_staff else "spectator"))
        is_spectator = bool(assigned_role == "spectator")
        return {
            "exists": True,
            "match_id": match_id,
            "game_system": room_sys,
            "p1_name": p1_assigned_name,
            "p2_name": p2_assigned_name,
            "is_full": is_full,
            "is_open_for_p2": is_open_for_p2,
            "is_finished": is_finished,
            "is_spectator": is_spectator,
            "is_referee": is_staff,
            "role": assigned_role,
            "scorecard_url": f"/scorecard/{match_id}"
        }

@router.post("/api/tracker/room/{match_id}/join", summary="Join match room and claim Player 2 slot or Spectator")
async def api_tracker_join_room(match_id: str, request: Request, payload: Optional[TrackerJoinPayload] = None):
    match_id = normalize_tracker_match_id(match_id)
    db = None
    try:
        db = get_database()
    except Exception:
        pass
    fs_engine = get_firestore_engine()
    if hasattr(fs_engine, "is_room_discarded") and fs_engine.is_room_discarded(match_id):
        TRACKER_ROOMS.pop(match_id, None)
        raise HTTPException(status_code=404, detail="Match room was discarded or not found")
    
    user = getattr(request, "_mock_user", None) if request else None
    if user is None and request:
        try:
            auth_mgr = get_auth_manager()
            auth_header = request.headers.get("Authorization", "") if hasattr(request, "headers") else ""
            session_token = (payload.token if payload and payload.token else None) or (request.cookies.get("session_token") if hasattr(request, "cookies") else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
            user = auth_mgr.get_session(session_token) if session_token else None
        except Exception:
            pass
    user_id = user["id"] if user else None
    user_name = (user.get("display_name") or user.get("name")) if user else None
    
    if match_id not in TRACKER_ROOMS or fs_engine.is_connected:
        fs_doc = fs_engine.get_room(match_id)
        if fs_doc and fs_doc.get("state"):
            TRACKER_ROOMS[match_id] = {
                "match_id": match_id,
                "user_id_p1": fs_doc.get("user_id_p1") or (fs_doc["state"].get("user_id_p1") if isinstance(fs_doc.get("state"), dict) else None),
                "user_id_p2": fs_doc.get("user_id_p2") or (fs_doc["state"].get("user_id_p2") if isinstance(fs_doc.get("state"), dict) else None),
                "referee_ids": fs_doc.get("referee_ids", []),
                "version": fs_doc.get("version", 1),
                "state": fs_doc["state"],
                "participants": fs_doc.get("participants", {}),
                "updated_at": fs_doc.get("updated_at")
            }
        elif match_id in TRACKER_ROOMS and not fs_engine.is_connected:
            pass
        else:
            if fs_engine.is_connected:
                TRACKER_ROOMS.pop(match_id, None)
            saved = db.get_tracker_game(match_id) if (db and hasattr(db, "get_tracker_game")) else None
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
                if fs_engine.is_connected:
                    raise HTTPException(status_code=404, detail="Match room was discarded or not found")
                TRACKER_ROOMS[match_id] = {
                    "match_id": match_id,
                    "user_id_p1": saved.get("user_id_p1") or (saved["state"].get("user_id_p1") if isinstance(saved.get("state"), dict) else None),
                    "user_id_p2": saved.get("user_id_p2") or (saved["state"].get("user_id_p2") if isinstance(saved.get("state"), dict) else None),
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
                chat_room = db.find_chat_room_key(match_id) if (db and hasattr(db, "find_chat_room_key")) else None
                if chat_room:
                    room = init_tracker_room_from_chat(match_id, chat_room, fs_engine)
                elif match_id.startswith("BCP-") or match_id.startswith("ES-"):
                    room = init_tracker_room_from_tournament(match_id, fs_engine, db)
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
        if isinstance(st, dict):
            st["user_id_p1"] = room["user_id_p1"]
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
        if isinstance(st, dict):
            st["user_id_p2"] = room["user_id_p2"]
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
    elif role == "referee" and user_id:
        if "referee_ids" not in room or not isinstance(room["referee_ids"], list):
            room["referee_ids"] = []
        if user_id not in room["referee_ids"]:
            room["referee_ids"].append(user_id)
            try:
                fs_engine.update_room(match_id, {"referee_ids": room["referee_ids"]})
            except Exception:
                pass
        
    room_sys = room.get("game_system") or st.get("game_system") or st.get("gameSystem") or ("aos" if match_id.startswith("AOS-") else "40k")
    return {
        "success": True,
        "match_id": match_id,
        "game_system": room_sys,
        "role": role,
        "user_id": user_id,
        "user_name": user_name,
        "user_id_p1": room.get("user_id_p1"),
        "user_id_p2": room.get("user_id_p2"),
        "state": st,
        "chess_clock": room.get("chess_clock"),
        "is_finished": bool(room.get("is_finished") or (isinstance(st, dict) and st.get("is_finished"))),
        "scorecard_url": f"/scorecard/{match_id}"
    }

@router.post("/api/tracker/room/{match_id}/state", summary="Broadcast and persist multiplayer tracker state with role enforcement")
async def api_tracker_save_state(match_id: str, payload: TrackerStatePayload, request: Request):
    match_id = normalize_tracker_match_id(match_id)
    fs_engine = get_firestore_engine()
    if hasattr(fs_engine, "is_room_discarded") and fs_engine.is_room_discarded(match_id):
        TRACKER_ROOMS.pop(match_id, None)
        return {
            "success": False,
            "is_abandoned": True,
            "status": "abandoned",
            "message": "Match room has been discarded."
        }

    db = None
    try:
        db = get_database()
    except Exception:
        pass
    
    # Hard Guard: If match is already concluded in PostgreSQL, reject state write and NEVER re-create Firestore room!
    saved_rec = db.get_tracker_game(match_id) if (db and hasattr(db, "get_tracker_game")) else None
    if saved_rec and (saved_rec.get("is_finished") or (isinstance(saved_rec.get("state_json"), dict) and saved_rec["state_json"].get("is_finished"))):
        return {
            "success": False,
            "is_finished": True,
            "status": "finalized",
            "scorecard_url": f"/scorecard/{match_id}",
            "message": "Match has concluded and is locked."
        }
    
    user = getattr(request, "_mock_user", None) if request else None
    if user is None and request:
        try:
            auth_mgr = get_auth_manager()
            auth_header = request.headers.get("Authorization", "") if hasattr(request, "headers") else ""
            session_token = (payload.token if payload and payload.token else None) or (request.cookies.get("session_token") if hasattr(request, "cookies") else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
            user = auth_mgr.get_session(session_token) if session_token else None
        except Exception:
            pass
    user_id = user["id"] if user else None
    
    if match_id not in TRACKER_ROOMS or fs_engine.is_connected:
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
            if fs_doc.get("status") == "abandoned" or fs_doc.get("is_abandoned"):
                TRACKER_ROOMS.pop(match_id, None)
                return {
                    "success": False,
                    "is_abandoned": True,
                    "status": "abandoned",
                    "message": "Match room has been discarded."
                }
            if match_id not in TRACKER_ROOMS:
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
        elif match_id in TRACKER_ROOMS and not fs_engine.is_connected:
            pass
        else:
            # Room does not exist in Firestore -> do NOT resurrect a deleted room!
            TRACKER_ROOMS.pop(match_id, None)
            return {
                "success": False,
                "is_abandoned": True,
                "status": "abandoned",
                "message": "Match room no longer exists."
            }
    
    room = TRACKER_ROOMS[match_id]
    
    is_p1 = bool(user_id and room.get("user_id_p1") == user_id)
    is_p2 = bool(user_id and room.get("user_id_p2") == user_id)
    is_tournament = (
        match_id.startswith("BCP-") or
        match_id.startswith("ES-") or
        bool(room.get("event_id")) or
        bool(room.get("eventId")) or
        bool(room.get("tournament_id")) or
        bool(room.get("state", {}).get("event_id")) or
        bool(room.get("state", {}).get("game", {}).get("eventId"))
    )
    
    if is_tournament:
        is_tournament_staff = check_user_is_tournament_staff(user, room, match_id=match_id)
        if not (is_p1 or is_p2 or is_tournament_staff):
            raise HTTPException(status_code=403, detail="Permission denied: Only matched competitors or tournament organizers can edit this tournament match.")
    else:
        is_ref = bool(user and (user_id in room.get("referee_ids", []) or user.get("role") in ("admin", "referee", "to", "organizer") or user.get("is_admin") or user.get("can_access_to")))
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
    # Resolve event_id to dynamically attach live tournament master clock and judge calls
    ev_id = None
    if match_id in TRACKER_ROOMS:
        ev_id = TRACKER_ROOMS[match_id].get("eventId") or TRACKER_ROOMS[match_id].get("event_id") or TRACKER_ROOMS[match_id].get("tournament_id")
        if not ev_id and isinstance(TRACKER_ROOMS[match_id].get("state"), dict):
            ev_id = TRACKER_ROOMS[match_id]["state"].get("event_id") or (TRACKER_ROOMS[match_id]["state"].get("game", {}).get("eventId") if isinstance(TRACKER_ROOMS[match_id]["state"].get("game"), dict) else None)
    if not ev_id and fs_doc:
        ev_id = fs_doc.get("eventId") or fs_doc.get("event_id") or fs_doc.get("tournament_id")
    if not ev_id:
        m_ev = re.match(r'^(?:WH40K-)?(?:BCP|ES)-([A-Za-z0-9_-]+)-R\d+', match_id, re.IGNORECASE)
        if m_ev and m_ev.group(1):
            ev_id = m_ev.group(1)

    master_clock = None
    active_judge_call = None
    if ev_id:
        try:
            master_clock = fs_engine.get_tournament_master_clock(ev_id)
        except Exception:
            pass
        try:
            active_calls = fs_engine.list_judge_calls(ev_id, active_only=True)
            for c in active_calls:
                c_mid = c.get("matchId") or c.get("match_id")
                if c_mid and normalize_tracker_match_id(c_mid) == match_id:
                    active_judge_call = c
                    break
        except Exception:
            pass

    if saved and saved.get("state"):
        if match_id not in TRACKER_ROOMS or (saved.get("version", 1) >= TRACKER_ROOMS[match_id].get("version", 0)):
            TRACKER_ROOMS[match_id] = {
                "match_id": match_id,
                "eventId": ev_id,
                "event_id": ev_id,
                "user_id_p1": saved.get("user_id_p1"),
                "user_id_p2": saved.get("user_id_p2"),
                "referee_ids": saved.get("referee_ids", []),
                "version": saved.get("version", 1),
                "state": saved["state"],
                "chess_clock": saved.get("chess_clock"),
                "masterClock": master_clock or saved.get("masterClock"),
                "active_judge_call": active_judge_call or saved.get("active_judge_call"),
                "updated_at": saved.get("updated_at")
            }
        res = dict(TRACKER_ROOMS[match_id])
        res["online_count"] = online_count
        res["chess_clock"] = TRACKER_ROOMS[match_id].get("chess_clock")
        res["masterClock"] = master_clock or TRACKER_ROOMS[match_id].get("masterClock")
        res["active_judge_call"] = active_judge_call or TRACKER_ROOMS[match_id].get("active_judge_call")
        res["eventId"] = ev_id
        res["event_id"] = ev_id
        return res

    if match_id in TRACKER_ROOMS and TRACKER_ROOMS[match_id].get("state"):
        res = dict(TRACKER_ROOMS[match_id])
        res["online_count"] = online_count
        res["chess_clock"] = TRACKER_ROOMS[match_id].get("chess_clock")
        res["masterClock"] = master_clock or TRACKER_ROOMS[match_id].get("masterClock")
        res["active_judge_call"] = active_judge_call or TRACKER_ROOMS[match_id].get("active_judge_call")
        res["eventId"] = ev_id
        res["event_id"] = ev_id
        return res

    return {
        "match_id": match_id,
        "version": 0,
        "online_count": online_count,
        "state": {},
        "chess_clock": None,
        "masterClock": master_clock,
        "active_judge_call": active_judge_call,
        "eventId": ev_id,
        "event_id": ev_id
    }

def _format_firestore_session_item(doc: Dict[str, Any]) -> Dict[str, Any]:
    st = doc.get("state", {}) if isinstance(doc.get("state"), dict) else {}
    game = st.get("game", {}) if isinstance(st.get("game"), dict) else {}
    p1 = st.get("p1", {}) if isinstance(st.get("p1"), dict) else {}
    p2 = st.get("p2", {}) if isinstance(st.get("p2"), dict) else {}
    participants = doc.get("participants", {}) if isinstance(doc.get("participants"), dict) else {}
    
    match_id = doc.get("roomKey") or doc.get("matchId") or st.get("match_id") or ""
    p1_name = doc.get("p1_name") or game.get("p1Name") or "Player 1"
    p2_name = doc.get("p2_name") or game.get("p2Name") or "Player 2"
    p1_id = doc.get("user_id_p1") or st.get("user_id_p1") or (participants.get("player1", {}).get("uid") if isinstance(participants.get("player1"), dict) else None)
    p2_id = doc.get("user_id_p2") or st.get("user_id_p2") or (participants.get("player2", {}).get("uid") if isinstance(participants.get("player2"), dict) else None)
    p1_score = p1.get("score", 0) if isinstance(p1, dict) else 0
    p2_score = p2.get("score", 0) if isinstance(p2, dict) else 0
    p1_faction = game.get("p1Faction")
    p2_faction = game.get("p2Faction")
    primary_mission = game.get("p1Primary") or game.get("primary")
    current_round = st.get("round", 1) if isinstance(st, dict) else 1
    game_system = doc.get("game_system") or st.get("game_system") or st.get("gameSystem") or ("aos" if str(match_id).upper().startswith("AOS-") else "40k")
    
    updated_ts = doc.get("updatedAt") or doc.get("updated_at") or int(datetime.now(timezone.utc).timestamp() * 1000)
    created_ts = doc.get("createdAt") or doc.get("created_at") or updated_ts
    expires_ts = doc.get("expiresAt") or (created_ts + (14 * 24 * 60 * 60 * 1000))
    
    date_str = datetime.fromtimestamp(updated_ts / 1000, tz=timezone.utc).strftime("%b %d, %Y %H:%M")
    
    return {
        "id": match_id,
        "match_id": match_id,
        "game_system": game_system,
        "user_id_p1": p1_id,
        "user_id_p2": p2_id,
        "participants": participants,
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
async def api_tracker_history(request: Request, limit: int = 50, search: Optional[str] = None, token: Optional[str] = Query(None), game_system: Optional[str] = Query(None)):
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
        if game_system:
            sys_filter = "aos" if "aos" in game_system.lower() else "40k"
            if sys_filter == "aos":
                all_history = [h for h in all_history if h.get("game_system") == "aos" or str(h.get("match_id", "")).upper().startswith("AOS-")]
            else:
                all_history = [h for h in all_history if h.get("game_system") != "aos" and not str(h.get("match_id", "")).upper().startswith("AOS-")]
        return {"success": True, "history": all_history}
    except Exception as err:
        logger.error(f"Error fetching tracker history: {err}")
        return {"success": False, "history": []}

@router.get("/api/tracker/sessions", summary="Get user's 3-tier active slot management (primary active, unfinished, completed)")
async def api_tracker_user_sessions(
    request: Request,
    token: Optional[str] = Query(None),
    game_system: Optional[str] = Query(None)
):
    user = getattr(request, "_mock_user", None) if request else None
    if user is None and request:
        try:
            auth_mgr = get_auth_manager()
            auth_header = request.headers.get("Authorization", "") if hasattr(request, "headers") else ""
            session_token = token or (auth_header[7:] if auth_header.startswith("Bearer ") else None) or (request.cookies.get("session_token") if hasattr(request, "cookies") else None)
            user = auth_mgr.get_session(session_token) if session_token else None
        except Exception:
            pass
    
    user_id = user["id"] if user else None
    user_name = (user.get("display_name") or user.get("name") or user.get("competitor_name") or user.get("player_name")) if user else None
    player_id = user.get("player_id") if user else None
    
    fs_engine = get_firestore_engine()
    db = None
    try:
        db = get_database()
    except Exception:
        pass

    # 1. Fetch completed history in a SINGLE query (eliminates N*5 per-room SQL queries!)
    raw_completed_history = []
    completed_mids = set()
    if db and hasattr(db, "get_tracker_history"):
        try:
            raw_completed_history = db.get_tracker_history(limit=50, user_id=user_id, user_name=user_name) or []
            completed_mids = {
                (g.get("match_id") or "").strip().upper()
                for g in raw_completed_history
                if g.get("is_finished", True) and g.get("match_id")
            }
        except Exception as err:
            logger.debug(f"History fetch notice: {err}")

    # 2. Fetch active rooms from Firestore
    active_docs = fs_engine.list_active_rooms_for_user(user_id=user_id, user_name=user_name, player_id=player_id)
    
    seen_matches = set()
    active_sessions = []
    for doc in active_docs:
        mid = (doc.get("roomKey") or doc.get("matchId") or (doc.get("state", {}).get("match_id") if isinstance(doc.get("state"), dict) else "") or "").strip().upper()
        if mid and mid not in seen_matches:
            if hasattr(fs_engine, "is_room_discarded") and fs_engine.is_room_discarded(mid):
                TRACKER_ROOMS.pop(mid, None)
                continue

            # O(1) check against completed_mids; only query DB directly if not in user's top 50 and state claims finished
            is_already_concluded = mid in completed_mids
            if not is_already_concluded and db and hasattr(db, "get_tracker_game"):
                st_obj = doc.get("state") if isinstance(doc.get("state"), dict) else {}
                if doc.get("is_finished") or st_obj.get("is_finished") or doc.get("status") == "completed":
                    saved = db.get_tracker_game(mid)
                    if saved and (saved.get("is_finished") or (isinstance(saved.get("state_json"), dict) and saved["state_json"].get("is_finished"))):
                        is_already_concluded = True

            if is_already_concluded:
                try:
                    fs_engine.discard_room(mid)
                except Exception:
                    pass
                TRACKER_ROOMS.pop(mid, None)
                continue

            seen_matches.add(mid)
            formatted = _format_firestore_session_item(doc)
            if not formatted["is_abandoned"]:
                active_sessions.append(formatted)

    # Evict any stale casual rooms in TRACKER_ROOMS that are no longer in Firestore when connected
    if fs_engine.is_connected:
        for cached_mid in list(TRACKER_ROOMS.keys()):
            if cached_mid not in fs_engine._fallback_rooms:
                TRACKER_ROOMS.pop(cached_mid, None)

    if game_system:
        sys_filter = "aos" if "aos" in game_system.lower() else "40k"
        if sys_filter == "aos":
            active_sessions = [s for s in active_sessions if s.get("game_system") == "aos" or str(s.get("match_id", "")).upper().startswith("AOS-")]
        else:
            active_sessions = [s for s in active_sessions if s.get("game_system") != "aos" and not str(s.get("match_id", "")).upper().startswith("AOS-")]
                
    primary_active = active_sessions[0] if active_sessions else None
    primary_mid = (primary_active.get("match_id") or primary_active.get("id") or "").strip().upper() if primary_active else ""
    unfinished_sessions = [s for s in active_sessions[1:] if (s.get("match_id") or s.get("id") or "").strip().upper() != primary_mid]
    
    completed_history = [g for g in raw_completed_history if g.get("is_finished", True) and (g.get("match_id") or "").strip().upper() not in seen_matches]
    if game_system:
        sys_filter = "aos" if "aos" in game_system.lower() else "40k"
        if sys_filter == "aos":
            completed_history = [c for c in completed_history if c.get("game_system") == "aos" or str(c.get("match_id", "")).upper().startswith("AOS-")]
        else:
            completed_history = [c for c in completed_history if c.get("game_system") != "aos" and not str(c.get("match_id", "")).upper().startswith("AOS-")]
        
    return {
        "success": True,
        "active_sessions": active_sessions,
        "completed_history": completed_history,
        "primary_active": primary_active,
        "unfinished_sessions": unfinished_sessions,
        "total_games": len(completed_history) + len(active_sessions)
    }

@router.post("/api/tracker/room/{match_id}/discard", summary="Discard / abandon a casual test session with zero Elo penalty")
async def api_tracker_discard_game(match_id: str, request: Request, payload: Optional[TrackerActionPayload] = None):
    match_id = normalize_tracker_match_id(match_id)
    user = getattr(request, "_mock_user", None) if request else None
    if user is None and request:
        try:
            auth_mgr = get_auth_manager()
            auth_header = request.headers.get("Authorization", "") if hasattr(request, "headers") else ""
            session_token = (payload.token if payload else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None) or (request.cookies.get("session_token") if hasattr(request, "cookies") else None)
            user = auth_mgr.get_session(session_token) if session_token else None
        except Exception:
            pass
    
    # 1. Verify this is NOT a completed / permanent match record
    db = None
    try:
        db = get_database()
        if db and hasattr(db, "get_tracker_game"):
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
    room_doc = fs_engine.get_room(match_id) or TRACKER_ROOMS.get(match_id) or {}
    st_doc = room_doc.get("state", {}) if isinstance(room_doc.get("state"), dict) else {}

    # Verify: If this room belongs to an event/tournament, players CANNOT delete it.
    # Room creation and deletion must be managed strictly by the event (TO).
    is_event_room = (
        match_id.startswith("BCP-") or
        match_id.startswith("ES-") or
        match_id.startswith("WH40K-BCP-") or
        match_id.startswith("WH40K-ES-") or
        bool(room_doc.get("eventId")) or
        bool(room_doc.get("event_id")) or
        bool(room_doc.get("tournament_id")) or
        bool(st_doc.get("event_id")) or
        bool(st_doc.get("tournament_id")) or
        bool(st_doc.get("game", {}).get("eventId") if isinstance(st_doc.get("game"), dict) else False)
    )

    if is_event_room:
        is_to_or_admin = check_user_is_tournament_staff(user, room_doc, match_id=match_id)
        if not is_to_or_admin:
            raise HTTPException(
                status_code=403,
                detail="Tournament match rooms are managed by the event organizer (TO) and cannot be deleted by players."
            )
    
    p1_id = room_doc.get("user_id_p1") or st_doc.get("user_id_p1") or (room_doc.get("participants", {}).get("player1", {}).get("uid") if isinstance(room_doc.get("participants"), dict) else None)
    p2_id = room_doc.get("user_id_p2") or st_doc.get("user_id_p2") or (room_doc.get("participants", {}).get("player2", {}).get("uid") if isinstance(room_doc.get("participants"), dict) else None)

    # Verify authorization: ONLY the 2 registered players (Player 1 or Player 2) or admin can delete
    if room_doc:
        p1_name = (room_doc.get("p1_name") or (st_doc.get("game", {}).get("p1Name") if isinstance(st_doc.get("game"), dict) else "") or "").strip().lower()
        p2_name = (room_doc.get("p2_name") or (st_doc.get("game", {}).get("p2Name") if isinstance(st_doc.get("game"), dict) else "") or "").strip().lower()
        
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
    
    # 2. Update Firestore Native (Delete room from active collection & record tombstone)
    fs_engine.discard_room(match_id)
    
    # 3. Update memory cache
    TRACKER_ROOMS.pop(match_id, None)

    # 4. Broadcast room_discarded to all connected SSE listeners so opponent knows immediately
    listeners = TRACKER_LISTENERS.get(match_id, [])
    discard_msg = {
        "type": "room_discarded",
        "match_id": match_id,
        "status": "abandoned",
        "is_abandoned": True
    }
    for q in list(listeners):
        try:
            await q.put(discard_msg)
        except Exception:
            pass
        
    # 5. If in PostgreSQL, hide uncompleted draft for BOTH players
    if db and hasattr(db, "hide_tracker_game_for_user"):
        for target_uid in {user.get("id") if user else None, p1_id, p2_id}:
            if target_uid:
                try:
                    db.hide_tracker_game_for_user(match_id, str(target_uid))
                except Exception:
                    pass
            
    return {"success": True, "match_id": match_id, "status": "abandoned", "is_abandoned": True}

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
    is_tournament = (
        match_id.startswith("BCP-") or
        match_id.startswith("ES-") or
        match_id.startswith("WH40K-BCP-") or
        match_id.startswith("WH40K-ES-") or
        bool(room.get("eventId")) or
        bool(room.get("event_id")) or
        bool(room.get("tournament_id")) or
        bool(room.get("state", {}).get("event_id")) or
        bool(room.get("state", {}).get("tournament_id")) or
        bool(room.get("state", {}).get("game", {}).get("eventId")) or
        bool(state.get("event_id")) or
        bool(state.get("tournament_id")) or
        bool(state.get("game", {}).get("eventId"))
    )

    if is_tournament:
        is_tournament_staff = check_user_is_tournament_staff(user, room, match_id=match_id)
        if not (is_p1 or is_p2 or is_tournament_staff):
            raise HTTPException(status_code=403, detail="Permission denied: Only matched competitors or tournament organizers can finalize this tournament match.")
    else:
        is_ref = bool(user and (user_id in room.get("referee_ids", []) or user.get("role") in ("admin", "referee", "to", "organizer") or user.get("is_admin") or user.get("can_access_to")))
        if room.get("user_id_p1") or room.get("user_id_p2"):
            if not (is_p1 or is_p2 or is_ref):
                raise HTTPException(status_code=403, detail="Permission denied: Spectators cannot finalize match")
    
    if isinstance(state, dict):
        state["is_finished"] = True
        state["started"] = True
        state["round"] = 5
        if is_tournament:
            state["event_match_locked"] = True
        
    p1_id = room.get("user_id_p1") or (user["id"] if user else None)
    p2_id = room.get("user_id_p2")

    # 1. Update PostgreSQL permanently for both casual and tournament games
    try:
        if db and hasattr(db, "save_tracker_game"):
            db.save_tracker_game(match_id, state, user_id_p1=p1_id, user_id_p2=p2_id)
    except Exception as e:
        logger.warning(f"Notice saving finalized game to DB {match_id}: {e}")

    # 1b. Auto-submit to League Scoring System if this is a League Match
    league_submitted = False
    resolved_league_id = None
    try:
        game_info = (state.get("game") if isinstance(state, dict) else {}) or {}
        league_id = (
            (state.get("league_id") if isinstance(state, dict) else None)
            or game_info.get("leagueId")
            or game_info.get("league_id")
            or room.get("league_id")
            or ("league_sd40k_big_league" if ("LG-" in match_id.upper() or "SD40K" in match_id.upper()) else None)
        )
        p1_name = (
            (state.get("p1_name") if isinstance(state, dict) else None)
            or game_info.get("p1Name")
            or room.get("p1_name")
            or ""
        ).strip()
        p2_name = (
            (state.get("p2_name") if isinstance(state, dict) else None)
            or game_info.get("p2Name")
            or room.get("p2_name")
            or ""
        ).strip()

        def _extract_tracker_score(side_key: str, top_key: str) -> int:
            if isinstance(state, dict):
                if state.get(top_key) is not None:
                    try:
                        return int(state[top_key])
                    except Exception:
                        pass
                side_obj = state.get(side_key) or {}
                if isinstance(side_obj, dict):
                    if side_obj.get("score") is not None and int(side_obj.get("score") or 0) > 0:
                        return int(side_obj["score"])
                    rounds_arr = side_obj.get("rounds") or []
                    if isinstance(rounds_arr, list) and rounds_arr:
                        prim = sum(int(r.get("primaryScore") or 0) for r in rounds_arr if isinstance(r, dict))
                        sec = sum(int(r.get("secondaryScore") or 0) for r in rounds_arr if isinstance(r, dict))
                        paint = 10 if side_obj.get("battleReady") is not False else 0
                        return min(100, min(50, prim) + min(40, sec) + paint)
            return int(room.get(top_key) or 0)

        p1_score = _extract_tracker_score("p1", "p1_score")
        p2_score = _extract_tracker_score("p2", "p2_score")

        if p1_name and p2_name:
            import re as _re
            from leagues_hub_service import get_leagues_hub_service
            lh_svc = get_leagues_hub_service()

            pod_num = int(
                (state.get("pod_number") if isinstance(state, dict) else 0)
                or game_info.get("podNumber")
                or room.get("pod_number")
                or 0
            )
            round_num = int(
                (state.get("round_num") if isinstance(state, dict) else 0)
                or game_info.get("roundNum")
                or room.get("round_num")
                or 0
            )
            m_pod = _re.search(r"-P(\d+)-R(\d+)-", match_id.upper())
            if m_pod:
                if not pod_num:
                    pod_num = int(m_pod.group(1))
                if not round_num:
                    round_num = int(m_pod.group(2))

            p1_low = p1_name.lower()
            p2_low = p2_name.lower()

            # Auto-detect league, pod_number, and round_number from active leagues if not explicitly provided
            candidate_leagues = [league_id] if league_id else [lg.get("league_id") for lg in lh_svc.get_leagues_list() if lg.get("league_id")]
            for cand_lid in candidate_leagues:
                lg_data = lh_svc.get_league(cand_lid)
                if not lg_data or str(lg_data.get("status") or "active").lower() in ("ended", "completed", "archived"):
                    continue
                act_s = lg_data.get("active_season") or {}
                if str(act_s.get("status") or "active").lower() in ("ended", "completed", "archived"):
                    continue
                matched_in_league = False
                for p_obj in (act_s.get("pods") or []):
                    p_n = int(p_obj.get("pod_number") or 1)
                    if pod_num and p_n != pod_num:
                        continue
                    st_by_name = {(s.get("name") or s.get("player_name") or "").strip().lower(): s for s in (p_obj.get("standings") or [])}
                    if p1_low in st_by_name and p2_low in st_by_name:
                        league_id = lg_data.get("league_id") or cand_lid
                        pod_num = p_n
                        if not round_num:
                            for pr in (st_by_name[p1_low].get("pairings") or []):
                                opp_c = _re.sub(r"\s*\([^)]*\)\s*$", "", str(pr.get("opponent_name") or "")).strip().lower()
                                if opp_c == p2_low:
                                    round_num = int(pr.get("round") or 1)
                                    break
                        matched_in_league = True
                        break
                if matched_in_league:
                    break

            if league_id:
                resolved_league_id = league_id
                lh_svc.report_match(
                    league_id=league_id,
                    pod_number=pod_num or 1,
                    round_number=round_num or 1,
                    p1_name=p1_name,
                    p2_name=p2_name,
                    p1_score=p1_score,
                    p2_score=p2_score,
                    scorecard_id=match_id
                )
                league_submitted = True
    except Exception as le:
        logger.debug(f"Auto league score submit check on finalize ({match_id}): {le}")

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

    # 3. Clean up / discard concluded match room from Cloud Firestore
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
        "league_submitted": league_submitted,
        "league_id": resolved_league_id,
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
    db = None
    try:
        db = get_database()
    except Exception:
        pass
    fs_engine = None
    try:
        fs_engine = get_firestore_engine()
    except Exception:
        pass

    norm_mid = normalize_tracker_match_id(match_id)
    candidates = []
    for c in [
        match_id,
        match_id.upper(),
        match_id.lower(),
        norm_mid,
        norm_mid.upper(),
        norm_mid.lower(),
    ]:
        if c and c not in candidates:
            candidates.append(c)
    if not match_id.upper().startswith("BCP-"):
        for c in (f"BCP-{match_id}", f"BCP-{match_id}".upper()):
            if c not in candidates:
                candidates.append(c)
    if not match_id.upper().startswith("ES-"):
        for c in (f"ES-{match_id}", f"ES-{match_id}".upper()):
            if c not in candidates:
                candidates.append(c)
    if match_id.upper().startswith("BCP-"):
        c = match_id[4:]
        if c and c not in candidates:
            candidates.append(c)
    if match_id.upper().startswith("ES-"):
        c = match_id[3:]
        if c and c not in candidates:
            candidates.append(c)

    # 1. Check PostgreSQL tracker_games first (submitted & finalized scorecards in our backend DB)
    game_rec = None
    if db and hasattr(db, "get_tracker_game"):
        for cand in candidates:
            try:
                rec = db.get_tracker_game(cand)
                if rec and isinstance(rec, dict):
                    game_rec = rec
                    break
            except Exception:
                pass

    is_rec_finished = bool(
        game_rec and (
            game_rec.get("is_finished")
            or (isinstance(game_rec.get("state_json"), dict) and game_rec["state_json"].get("is_finished"))
            or (isinstance(game_rec.get("state"), dict) and game_rec["state"].get("is_finished"))
        )
    )
    if game_rec and is_rec_finished:
        # Ensure any leftover Firestore room for this finalized game is cleaned up
        if fs_engine and hasattr(fs_engine, "discard_room"):
            for cand in candidates:
                try:
                    fs_engine.discard_room(cand)
                except Exception:
                    pass
        for cand in candidates:
            TRACKER_ROOMS.pop(cand, None)

        state = game_rec.get("state") or game_rec.get("state_json") or {}
        sys_id = (
            game_rec.get("game_system")
            or (state.get("game_system") if isinstance(state, dict) else None)
            or (state.get("gameSystem") if isinstance(state, dict) else None)
            or ("aos" if str(match_id).upper().startswith("AOS-") else "40k")
        )
        return {
            "success": True,
            "match_id": match_id,
            "game_system": sys_id,
            "game_record": game_rec,
            "state": state,
            "is_finished": True,
            "status": "completed",
            "source": "tracker_games"
        }

    # 2. Check event & official BCP match record in our database if this is an event pairing
    bcp_match = None
    is_event_completed = False
    ev_id_raw = None
    m_pat = re.match(r"^(?:WH40K-|AOS-)?(?:BCP|ES)-(.+)-R(\d+)-T(\d+)$", match_id.strip(), re.IGNORECASE)
    if m_pat:
        ev_id_raw = m_pat.group(1)
        r_num = int(m_pat.group(2))
        t_num = int(m_pat.group(3))

        if db and hasattr(db, "get_studio_event"):
            try:
                st_ev = db.get_studio_event(ev_id_raw)
                if isinstance(st_ev, dict):
                    if (
                        st_ev.get("is_ended") is True
                        or st_ev.get("ended") is True
                        or str(st_ev.get("status") or "").lower() in ("ended", "completed", "finished", "concluded")
                    ):
                        is_event_completed = True
            except Exception:
                pass

        if db and hasattr(db, "get_connection"):
            try:
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("""
                            SELECT m.id, m.event_id, m.round, m.table_number, m.match_date,
                                   m.player1_id, m.player1_name, m.player1_faction, m.player1_score,
                                   m.player2_id, m.player2_name, m.player2_faction, m.player2_score,
                                   m.winner_id, m.loser_id, m.is_draw, m.is_bye, m.is_done,
                                   e.name AS event_name, e.is_ended AS event_is_ended,
                                   e.event_date, e.end_date, e.raw_json AS event_raw_json
                            FROM matches m
                            LEFT JOIN events e ON e.id = m.event_id
                            WHERE LOWER(m.event_id) = LOWER(%s)
                              AND m.round = %s
                              AND m.table_number = %s
                            LIMIT 1;
                        """, (ev_id_raw, r_num, t_num))
                        row = cur.fetchone()
                        if row and getattr(cur, "description", None):
                            cols = [desc[0] for desc in cur.description]
                            row_dict = dict(zip(cols, row)) if not isinstance(row, dict) else dict(row)
                            ev_is_ended = row_dict.pop("event_is_ended", False)
                            ev_date = row_dict.pop("event_date", None)
                            ev_end_date = row_dict.pop("end_date", None)
                            ev_raw = row_dict.pop("event_raw_json", None)
                            if isinstance(ev_raw, str):
                                try:
                                    ev_raw = json.loads(ev_raw)
                                except Exception:
                                    ev_raw = None

                            now_utc = datetime.now(timezone.utc)
                            if ev_is_ended is True:
                                is_event_completed = True
                            elif isinstance(ev_raw, dict) and (
                                ev_raw.get("ended") is True
                                or ev_raw.get("isEnded") is True
                                or (isinstance(ev_raw.get("status"), dict) and ev_raw["status"].get("ended") is True)
                                or str(ev_raw.get("status") or "").lower() in ("ended", "completed", "finished")
                            ):
                                is_event_completed = True
                            elif ev_end_date and hasattr(ev_end_date, "timestamp"):
                                end_dt = ev_end_date if ev_end_date.tzinfo else ev_end_date.replace(tzinfo=timezone.utc)
                                if end_dt < (now_utc - timedelta(hours=48)):
                                    is_event_completed = True
                            elif ev_date and hasattr(ev_date, "timestamp"):
                                start_dt = ev_date if ev_date.tzinfo else ev_date.replace(tzinfo=timezone.utc)
                                if start_dt < (now_utc - timedelta(days=3)):
                                    is_event_completed = True

                            bcp_match = row_dict
                            if bcp_match.get("match_date") and hasattr(bcp_match["match_date"], "isoformat"):
                                bcp_match["match_date"] = bcp_match["match_date"].isoformat()
            except Exception:
                pass

    # If the event is completed, delete any leftover Firestore room records for it
    # and return the BCP score (since tracker_games was already checked in Step 1).
    if is_event_completed:
        if fs_engine:
            try:
                if ev_id_raw and hasattr(fs_engine, "delete_event_rooms"):
                    fs_engine.delete_event_rooms(ev_id_raw)
                if hasattr(fs_engine, "discard_room"):
                    for cand in candidates:
                        fs_engine.discard_room(cand)
            except Exception:
                pass
        for cand in candidates:
            TRACKER_ROOMS.pop(cand, None)

        if bcp_match:
            has_bcp_score = (bcp_match.get("player1_score") is not None and bcp_match.get("player2_score") is not None)
            return {
                "success": True,
                "match_id": match_id,
                "game_record": None,
                "state": None,
                "bcp_match": bcp_match,
                "is_finished": True,
                "status": "completed" if (bcp_match.get("is_done") or has_bcp_score) else "completed",
                "source": "bcp"
            }
        raise HTTPException(status_code=404, detail="Completed scorecard not found in database for this match ID")

    # 3. Event is in progress (or standalone live tracker game like WH40K-DD52-6CA8):
    # Read live up-to-date game state from Firestore / TRACKER_ROOMS
    room_doc = None
    if fs_engine and hasattr(fs_engine, "get_room"):
        for cand in candidates:
            try:
                rdoc = fs_engine.get_room(cand)
                if rdoc and isinstance(rdoc, dict):
                    room_doc = rdoc
                    break
            except Exception:
                pass
    if not room_doc:
        for cand in candidates:
            rdoc = TRACKER_ROOMS.get(cand)
            if rdoc and isinstance(rdoc, dict) and not rdoc.get("is_abandoned") and rdoc.get("status") != "abandoned":
                room_doc = rdoc
                break

    if room_doc:
        state = (
            room_doc.get("state")
            if isinstance(room_doc.get("state"), dict)
            else (room_doc.get("state_json") if isinstance(room_doc.get("state_json"), dict) else room_doc)
        )
        is_room_finished = bool(
            room_doc.get("is_finished")
            or (isinstance(state, dict) and state.get("is_finished"))
            or room_doc.get("status") == "completed"
            or (isinstance(state, dict) and state.get("status") == "completed")
        )
        sys_id = (
            room_doc.get("game_system")
            or (state.get("game_system") if isinstance(state, dict) else None)
            or (state.get("gameSystem") if isinstance(state, dict) else None)
            or ("aos" if str(match_id).upper().startswith("AOS-") else "40k")
        )
        return {
            "success": True,
            "match_id": match_id,
            "game_system": sys_id,
            "game_record": room_doc,
            "state": state,
            "bcp_match": bcp_match,
            "is_finished": is_room_finished,
            "status": "completed" if is_room_finished else "in_progress",
            "source": "firestore"
        }

    # 4. Fallback to BCP match pairing if no live Firestore room exists yet for an in-progress event
    if bcp_match:
        has_bcp_score = (bcp_match.get("player1_score") is not None and bcp_match.get("player2_score") is not None)
        return {
            "success": True,
            "match_id": match_id,
            "game_record": None,
            "state": None,
            "bcp_match": bcp_match,
            "is_finished": bool(bcp_match.get("is_done") or has_bcp_score),
            "status": "completed" if (bcp_match.get("is_done") or has_bcp_score) else "pending",
            "source": "bcp"
        }

    raise HTTPException(status_code=404, detail="Scorecard not found")

@router.get("/scorecard/{match_id}", summary="View digital scorecard page")
async def view_scorecard_page(match_id: str):
    scorecard_file = web_dir / "scorecard.html"
    if scorecard_file.exists():
        return FileResponse(scorecard_file)
    return RedirectResponse(f"/?scorecard={match_id}")


# =========================================================================
# COMPLETED GAME HISTORY IMPORTER (TABLETOP BATTLES & OFFICIAL GW APP)
# =========================================================================

class TrackerImportSyncPayload(BaseModel):
    email: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    token: Optional[str] = None
    id_token: Optional[str] = None
    access_token: Optional[str] = None
    game_system: Optional[str] = "40k"
    dry_run: Optional[bool] = False

class TrackerImportCodePayload(BaseModel):
    code: str
    token: Optional[str] = None
    id_token: Optional[str] = None
    game_system: Optional[str] = "40k"
    dry_run: Optional[bool] = False

class TrackerImportParsePayload(BaseModel):
    payload: Optional[str] = None
    text: Optional[str] = None
    game_system: Optional[str] = "40k"
    source_hint: Optional[str] = None
    dry_run: Optional[bool] = False

def _resolve_importing_user(request: Request) -> Optional[Dict[str, Any]]:
    user = getattr(request, "_mock_user", None) if request else None
    if user is None and request:
        try:
            auth_mgr = get_auth_manager()
            auth_header = request.headers.get("Authorization", "") if hasattr(request, "headers") else ""
            session_token = (auth_header[7:] if auth_header.startswith("Bearer ") else None) or (request.cookies.get("session_token") if hasattr(request, "cookies") else None)
            user = auth_mgr.get_session(session_token) if session_token else None
        except Exception:
            pass
    return user

def _persist_imported_games_to_db(
    converted_games: List[Dict[str, Any]],
    user: Optional[Dict[str, Any]],
    dry_run: bool = False,
) -> List[Dict[str, Any]]:
    """
    Persists imported completed games strictly into PostgreSQL `tracker_games`
    (NEVER into Firestore, because imported games are completed historical games).
    """
    db = None
    if not dry_run:
        try:
            db = get_database()
        except Exception:
            db = None

    uid = user.get("id") if isinstance(user, dict) else None
    saved_items = []
    for item in converted_games:
        if not isinstance(item, dict) or not item.get("match_id"):
            continue
        mid = item["match_id"]
        st = item.get("state") or {}
        st["is_finished"] = True
        st["isFinished"] = True
        st["status"] = "completed"
        st["started"] = True
        u_p1 = item.get("user_id_p1") or uid
        u_p2 = item.get("user_id_p2")

        if not dry_run and db and hasattr(db, "save_tracker_game"):
            db.save_tracker_game(
                mid,
                st,
                version=1,
                user_id_p1=u_p1,
                user_id_p2=u_p2,
            )

        saved_items.append({
            "match_id": mid,
            "game_system": item.get("game_system", "40k"),
            "edition": item.get("edition") or st.get("edition") or ("aos_4e" if item.get("game_system") == "aos" else "10th"),
            "edition_label": item.get("edition_label") or st.get("edition_label") or ("AoS 4th Edition" if item.get("game_system") == "aos" else "10th Edition"),
            "p1_name": item.get("p1_name"),
            "p2_name": item.get("p2_name"),
            "p1_faction": item.get("p1_faction"),
            "p2_faction": item.get("p2_faction"),
            "p1_detachment": item.get("p1_detachment"),
            "p2_detachment": item.get("p2_detachment"),
            "p1_score": item.get("p1_score"),
            "p2_score": item.get("p2_score"),
            "primary_mission": item.get("primary_mission"),
            "deployment": item.get("deployment"),
            "game_date": item.get("game_date"),
            "imported_source": item.get("imported_source", "tabletop_battles"),
            "imported_app": st.get("imported_app", "Tabletop Battles"),
            "event_id": st.get("event_id"),
            "round_num": st.get("round_num"),
            "table_num": st.get("table_num"),
            "mapped_event_name": st.get("mapped_event_name"),
            "event_match_locked": bool(st.get("event_match_locked")),
            "is_finished": True,
            "status": "completed",
            "scorecard_url": f"/scorecard/{urllib.parse.quote(mid)}",
        })
    return saved_items

@router.post("/api/tracker/import/ttb-sync", summary="Download and import completed games from Tabletop Battles Cloud Sync")
async def api_tracker_import_ttb_sync(request: Request, body: TrackerImportSyncPayload):
    from tracker_importer import (
        authenticate_ttb_cognito,
        fetch_ttb_cloud_games,
        convert_ttb_game_to_omnitactica,
    )
    user = _resolve_importing_user(request)
    id_tok = (body.id_token or body.token or "").strip()
    acc_tok = (body.access_token or "").strip()
    email_or_user = (body.email or body.username or "").strip()

    try:
        if not id_tok and not acc_tok:
            auth_res = authenticate_ttb_cognito(email_or_user, body.password or "")
            id_tok = auth_res.get("id_token") or ""
            acc_tok = auth_res.get("access_token") or ""

        raw_games = fetch_ttb_cloud_games(id_token=id_tok, access_token=acc_tok)
        converted = []
        for rg in raw_games:
            c = convert_ttb_game_to_omnitactica(
                rg,
                importing_user=user,
                default_system=body.game_system or "40k",
                source_label="tabletop_battles",
            )
            if c:
                converted.append(c)

        saved = _persist_imported_games_to_db(converted, user, dry_run=bool(body.dry_run))
        return {
            "success": True,
            "source": "tabletop_battles_cloud",
            "storage_target": "tracker_games",
            "dry_run": bool(body.dry_run),
            "imported_count": len(saved),
            "games": saved,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in /api/tracker/import/ttb-sync: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to sync Tabletop Battles games: {e}")

@router.post("/api/tracker/import/ttb-code", summary="Download and import a Tabletop Battles game by Observer or Link Code")
async def api_tracker_import_ttb_code(request: Request, body: TrackerImportCodePayload):
    from tracker_importer import (
        fetch_ttb_game_by_code,
        convert_ttb_game_to_omnitactica,
    )
    user = _resolve_importing_user(request)
    try:
        raw_game = fetch_ttb_game_by_code(
            body.code,
            id_token=(body.id_token or body.token or None),
        )
        conv = convert_ttb_game_to_omnitactica(
            raw_game,
            importing_user=user,
            default_system=body.game_system or "40k",
            source_label="tabletop_battles",
        )
        if not conv:
            raise ValueError("Unable to parse Tabletop Battles game from the provided code.")

        saved = _persist_imported_games_to_db([conv], user, dry_run=bool(body.dry_run))
        return {
            "success": True,
            "source": "tabletop_battles_code",
            "storage_target": "tracker_games",
            "dry_run": bool(body.dry_run),
            "imported_count": len(saved),
            "games": saved,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in /api/tracker/import/ttb-code: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to import game by code: {e}")

@router.post("/api/tracker/import/parse", summary="Parse and import completed games from TTB JSON/text or GW App War Journal")
async def api_tracker_import_parse(request: Request, body: TrackerImportParsePayload):
    from tracker_importer import parse_imported_games_payload
    user = _resolve_importing_user(request)
    raw_text = (body.payload or body.text or "").strip()
    try:
        converted = parse_imported_games_payload(
            raw_text,
            importing_user=user,
            default_system=body.game_system or "40k",
            source_hint=body.source_hint,
        )
        saved = _persist_imported_games_to_db(converted, user, dry_run=bool(body.dry_run))
        return {
            "success": True,
            "source": body.source_hint or "parsed_import",
            "storage_target": "tracker_games",
            "dry_run": bool(body.dry_run),
            "imported_count": len(saved),
            "games": saved,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in /api/tracker/import/parse: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to parse and import games: {e}")


# =========================================================================
# EVENT MATCH MAPPING FOR IMPORTED / COMPLETED SCORECARDS
# =========================================================================

class TrackerMapEventMatchPayload(BaseModel):
    event_id: str
    round_num: int = 1
    table_num: int = 1


def _names_roughly_match(name_a: Optional[str], name_b: Optional[str]) -> bool:
    if not name_a or not name_b:
        return False
    na = re.sub(r"[^a-z0-9\s]", "", str(name_a).strip().lower()).strip()
    nb = re.sub(r"[^a-z0-9\s]", "", str(name_b).strip().lower()).strip()
    if not na or not nb:
        return False
    if na in ("player 1", "player 2", "player1", "player2", "you", "opponent", "unknown"):
        return False
    if nb in ("player 1", "player 2", "player1", "player2", "you", "opponent", "unknown"):
        return False
    if na == nb:
        return True
    parts_a = na.split()
    parts_b = nb.split()
    if len(parts_a) >= 2 and len(parts_b) >= 2 and parts_a[0] == parts_b[0] and parts_a[-1] == parts_b[-1]:
        return True
    return False


def _lookup_event_pairing_record(db: Any, event_id: str, round_num: int, table_num: int) -> Optional[Dict[str, Any]]:
    """Finds a specific tournament pairing from `matches` table or `events.pairings` JSONB."""
    if not db or not event_id:
        return None
    from psycopg2 import extras
    try:
        with db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT m.id, m.event_id, m.round, m.table_number, m.match_date,
                           m.player1_id, m.player1_name, m.player1_faction, m.player1_score,
                           m.player2_id, m.player2_name, m.player2_faction, m.player2_score,
                           m.is_bye, m.is_done,
                           e.name AS event_name, e.event_date, e.game_system
                    FROM matches m
                    LEFT JOIN events e ON e.id = m.event_id
                    WHERE LOWER(m.event_id) = LOWER(%s)
                      AND m.round = %s
                      AND m.table_number = %s
                    LIMIT 1;
                """, (event_id.strip(), int(round_num), int(table_num)))
                row = cur.fetchone()
                if row:
                    return dict(row)

                # Fallback: check `events.pairings` JSONB for Event Studio tournaments
                cur.execute("""
                    SELECT id, name, event_date, game_system, pairings
                    FROM events
                    WHERE LOWER(id) = LOWER(%s)
                    LIMIT 1;
                """, (event_id.strip(),))
                ev_row = cur.fetchone()
                if ev_row:
                    ev = dict(ev_row)
                    pairings = ev.get("pairings")
                    if isinstance(pairings, str):
                        try:
                            pairings = json.loads(pairings)
                        except Exception:
                            pairings = {}
                    if isinstance(pairings, dict):
                        r_list = pairings.get(str(round_num)) or pairings.get(int(round_num)) or []
                        if isinstance(r_list, list):
                            for pr in r_list:
                                if not isinstance(pr, dict):
                                    continue
                                t_val = int(pr.get("table") or pr.get("table_number") or pr.get("tableNum") or 0)
                                if t_val == int(table_num):
                                    p1_obj = pr.get("player1") if isinstance(pr.get("player1"), dict) else {}
                                    p2_obj = pr.get("player2") if isinstance(pr.get("player2"), dict) else {}
                                    return {
                                        "id": pr.get("id") or f"{ev['id']}-R{round_num}-T{table_num}",
                                        "event_id": ev["id"],
                                        "event_name": ev.get("name") or ev["id"],
                                        "event_date": ev.get("event_date"),
                                        "game_system": ev.get("game_system") or "40k",
                                        "round": int(round_num),
                                        "table_number": int(table_num),
                                        "player1_id": pr.get("player1_id") or pr.get("p1_id") or p1_obj.get("id"),
                                        "player1_name": pr.get("player1_name") or pr.get("p1_name") or p1_obj.get("name") or "Player 1",
                                        "player1_faction": pr.get("player1_faction") or pr.get("p1_faction") or p1_obj.get("faction") or "",
                                        "player1_score": pr.get("player1_score") if pr.get("player1_score") is not None else pr.get("p1_score"),
                                        "player2_id": pr.get("player2_id") or pr.get("p2_id") or p2_obj.get("id"),
                                        "player2_name": pr.get("player2_name") or pr.get("p2_name") or p2_obj.get("name") or "Player 2",
                                        "player2_faction": pr.get("player2_faction") or pr.get("p2_faction") or p2_obj.get("faction") or "",
                                        "player2_score": pr.get("player2_score") if pr.get("player2_score") is not None else pr.get("p2_score"),
                                        "is_bye": bool(pr.get("is_bye")),
                                        "is_done": bool(pr.get("is_done")),
                                    }
    except Exception as e:
        logger.warning(f"Notice looking up event pairing ({event_id}, R{round_num}, T{table_num}): {e}")
    return None


def _find_conflicting_locked_tracker_game_for_event_match(
    db: Any,
    ev_real_id: str,
    r_num: int,
    t_num: int,
    exclude_match_id: str,
) -> Optional[Dict[str, Any]]:
    """Returns any existing locked/completed tracker_games row mapped to (ev_real_id, r_num, t_num) other than exclude_match_id."""
    if not db or not hasattr(db, "get_connection"):
        return None
    from psycopg2 import extras
    try:
        with db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT match_id, is_finished, state_json
                    FROM tracker_games
                    WHERE LOWER(event_id) = LOWER(%s)
                      AND round_num = %s
                      AND table_num = %s
                      AND UPPER(match_id) != UPPER(%s)
                    ORDER BY is_finished DESC, updated_at DESC
                    LIMIT 1;
                """, (ev_real_id, int(r_num), int(t_num), str(exclude_match_id)))
                conflict_row = cur.fetchone()
                if conflict_row:
                    c_st = conflict_row.get("state_json")
                    if isinstance(c_st, str):
                        try:
                            c_st = json.loads(c_st)
                        except Exception:
                            c_st = {}
                    c_locked = bool(conflict_row.get("is_finished") or (isinstance(c_st, dict) and c_st.get("event_match_locked")))
                    if c_locked:
                        return dict(conflict_row)
    except Exception as e:
        logger.warning(f"Notice checking conflicting locked tracker game: {e}")
    return None


def _determine_p1_p2_alignment_swap(
    user: Dict[str, Any],
    user_is_event_p1: bool,
    user_is_event_p2: bool,
    ev_p1_name: str,
    ev_p2_name: str,
    game_rec: Dict[str, Any],
    state: Dict[str, Any],
) -> bool:
    """
    Determines whether `p1` and `p2` in the imported game must be swapped so that:
      - `p1` aligns with `player1` of the tournament pairing (`ev_p1_name`)
      - `p2` aligns with `player2` of the tournament pairing (`ev_p2_name`)
    """
    game_obj = state.get("game") if isinstance(state.get("game"), dict) else {}
    p1_obj = state.get("p1") if isinstance(state.get("p1"), dict) else {}
    p2_obj = state.get("p2") if isinstance(state.get("p2"), dict) else {}

    g_p1_name = str(game_obj.get("p1Name") or p1_obj.get("name") or game_rec.get("p1_name") or "").strip()
    g_p2_name = str(game_obj.get("p2Name") or p2_obj.get("name") or game_rec.get("p2_name") or "").strip()

    # 1. Direct name alignment check between imported game names and event match names
    p1_matches_ev1 = _names_roughly_match(g_p1_name, ev_p1_name)
    p2_matches_ev2 = _names_roughly_match(g_p2_name, ev_p2_name)
    p1_matches_ev2 = _names_roughly_match(g_p1_name, ev_p2_name)
    p2_matches_ev1 = _names_roughly_match(g_p2_name, ev_p1_name)

    if (p1_matches_ev2 or p2_matches_ev1) and not (p1_matches_ev1 or p2_matches_ev2):
        return True
    if (p1_matches_ev1 or p2_matches_ev2) and not (p1_matches_ev2 or p2_matches_ev1):
        return False

    # 2. Check which slot the authenticated user occupies in the imported game vs the event match
    uid = str(user.get("id") or user.get("user_id") or "").strip()
    g_uid1 = str(state.get("user_id_p1") or game_rec.get("user_id_p1") or "").strip()
    g_uid2 = str(state.get("user_id_p2") or game_rec.get("user_id_p2") or "").strip()

    user_in_game_p1 = (bool(uid and g_uid1 == uid) or check_user_matches_player(user, g_p1_name, g_uid1 or None))
    user_in_game_p2 = (bool(uid and g_uid2 == uid) or check_user_matches_player(user, g_p2_name, g_uid2 or None))

    if user_is_event_p2 and not user_is_event_p1:
        if user_in_game_p1 and not user_in_game_p2:
            return True
    if user_is_event_p1 and not user_is_event_p2:
        if user_in_game_p2 and not user_in_game_p1:
            return True

    return False


@router.get("/api/tracker/mappable_event_matches", summary="List tournament pairings where the authenticated user is a participant")
async def api_get_mappable_event_matches(
    request: Request,
    match_id: Optional[str] = None,
    search: Optional[str] = None,
    game_system: Optional[str] = None,
    limit: int = 50,
):
    user = _resolve_importing_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required to map games to tournament matches.")

    db = get_database()
    target_game = None
    norm_mid = normalize_tracker_match_id(match_id) if match_id else None
    if norm_mid and hasattr(db, "get_tracker_game"):
        target_game = db.get_tracker_game(norm_mid)

    u_ids = []
    for k in ("id", "user_id", "player_id", "bcp_user_id", "bcp_id"):
        v = user.get(k)
        if v and str(v).strip() and str(v).strip() not in u_ids:
            u_ids.append(str(v).strip())

    u_names = []
    for k in ("display_name", "name", "username"):
        v = user.get(k)
        if v and str(v).strip().lower() not in u_names:
            u_names.append(str(v).strip().lower())

    from psycopg2 import extras
    candidates: List[Dict[str, Any]] = []
    seen_keys = set()

    try:
        with db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                where_parts = ["COALESCE(m.is_bye, FALSE) = FALSE"]
                params: List[Any] = []

                part_clauses = []
                if u_ids:
                    part_clauses.append("m.player1_id = ANY(%s)")
                    params.append(u_ids)
                    part_clauses.append("m.player2_id = ANY(%s)")
                    params.append(u_ids)
                if u_names:
                    part_clauses.append("LOWER(TRIM(m.player1_name)) = ANY(%s)")
                    params.append(u_names)
                    part_clauses.append("LOWER(TRIM(m.player2_name)) = ANY(%s)")
                    params.append(u_names)

                if not part_clauses:
                    return {"success": True, "matches": []}

                where_parts.append("(" + " OR ".join(part_clauses) + ")")

                if search and search.strip():
                    s_pat = f"%{search.strip()}%"
                    where_parts.append("(e.name ILIKE %s OR m.player1_name ILIKE %s OR m.player2_name ILIKE %s OR m.event_id ILIKE %s)")
                    params.extend([s_pat, s_pat, s_pat, s_pat])

                if game_system and game_system.lower() in ("40k", "aos"):
                    sys_val = "aos" if "aos" in game_system.lower() else "40k"
                    where_parts.append("COALESCE(e.game_system, m.game_system, '40k') = %s")
                    params.append(sys_val)

                params.append(max(10, min(200, int(limit))))

                cur.execute(f"""
                    SELECT m.id, m.event_id, m.round, m.table_number, m.match_date,
                           m.player1_id, m.player1_name, m.player1_faction, m.player1_score,
                           m.player2_id, m.player2_name, m.player2_faction, m.player2_score,
                           m.is_done,
                           COALESCE(e.name, m.event_id) AS event_name,
                           e.event_date,
                           COALESCE(e.game_system, m.game_system, '40k') AS game_system,
                           tg.match_id AS existing_tracker_match_id,
                           COALESCE(tg.is_finished, FALSE) AS existing_tracker_finished,
                           COALESCE((tg.state_json->>'event_match_locked')::boolean, tg.is_finished, FALSE) AS existing_tracker_locked
                    FROM matches m
                    LEFT JOIN events e ON e.id = m.event_id
                    LEFT JOIN LATERAL (
                        SELECT match_id, is_finished, state_json
                        FROM tracker_games
                        WHERE LOWER(event_id) = LOWER(m.event_id)
                          AND round_num = m.round
                          AND table_num = m.table_number
                        ORDER BY is_finished DESC, updated_at DESC
                        LIMIT 1
                    ) tg ON TRUE
                    WHERE {" AND ".join(where_parts)}
                    ORDER BY COALESCE(e.event_date, m.match_date) DESC NULLS LAST, m.round DESC, m.table_number ASC
                    LIMIT %s;
                """, tuple(params))

                rows = cur.fetchall()
                for r in rows:
                    d = dict(r)
                    ev_id = str(d.get("event_id") or "")
                    r_num = int(d.get("round") or 1)
                    t_num = int(d.get("table_number") or 1)
                    key = (ev_id.lower(), r_num, t_num)
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)

                    is_p1 = check_user_matches_player(user, d.get("player1_name"), d.get("player1_id"))
                    is_p2 = check_user_matches_player(user, d.get("player2_name"), d.get("player2_id"))
                    if not (is_p1 or is_p2):
                        continue

                    existing_mid = d.get("existing_tracker_match_id")
                    is_currently_mapped = bool(norm_mid and existing_mid and str(existing_mid).upper() == norm_mid.upper())
                    is_locked = bool(
                        existing_mid
                        and not is_currently_mapped
                        and (d.get("existing_tracker_locked") or d.get("existing_tracker_finished"))
                    )

                    will_swap = False
                    relevance = 0
                    if target_game:
                        t_state = target_game.get("state") or {}
                        will_swap = _determine_p1_p2_alignment_swap(
                            user,
                            is_p1,
                            is_p2,
                            str(d.get("player1_name") or ""),
                            str(d.get("player2_name") or ""),
                            target_game,
                            t_state,
                        )
                        opp_name_in_event = d.get("player2_name") if is_p1 else d.get("player1_name")
                        if _names_roughly_match(target_game.get("p1_name"), opp_name_in_event) or _names_roughly_match(target_game.get("p2_name"), opp_name_in_event):
                            relevance += 50
                        if d.get("player1_score") is not None and d.get("player2_score") is not None:
                            ev_s1, ev_s2 = int(d["player1_score"] or 0), int(d["player2_score"] or 0)
                            tg_s1, tg_s2 = int(target_game.get("p1_score") or 0), int(target_game.get("p2_score") or 0)
                            if (ev_s1 == tg_s1 and ev_s2 == tg_s2) or (ev_s1 == tg_s2 and ev_s2 == tg_s1):
                                relevance += 40

                    ev_dt = d.get("event_date") or d.get("match_date")
                    date_str = ev_dt.strftime("%b %d, %Y") if hasattr(ev_dt, "strftime") else (str(ev_dt)[:10] if ev_dt else "")

                    candidates.append({
                        "event_id": ev_id,
                        "event_name": d.get("event_name") or ev_id,
                        "event_date": date_str,
                        "match_date": date_str,
                        "game_system": d.get("game_system") or "40k",
                        "round_num": r_num,
                        "round": r_num,
                        "table_num": t_num,
                        "table_number": t_num,
                        "player1_id": d.get("player1_id"),
                        "player1_name": d.get("player1_name") or "Player 1",
                        "player1_faction": d.get("player1_faction") or "",
                        "player1_score": d.get("player1_score"),
                        "player2_id": d.get("player2_id"),
                        "player2_name": d.get("player2_name") or "Player 2",
                        "player2_faction": d.get("player2_faction") or "",
                        "player2_score": d.get("player2_score"),
                        "user_slot": "player1" if is_p1 else "player2",
                        "opponent_name": d.get("player2_name") if is_p1 else d.get("player1_name"),
                        "opponent_faction": d.get("player2_faction") if is_p1 else d.get("player1_faction"),
                        "will_auto_swap_p1_p2": will_swap,
                        "is_locked": is_locked,
                        "is_currently_mapped": is_currently_mapped,
                        "locked_by_match_id": existing_mid if is_locked else None,
                        "relevance": relevance,
                        "recommended": bool(relevance >= 50),
                    })
    except Exception as e:
        logger.warning(f"Error querying mappable event matches: {e}")

    candidates.sort(key=lambda x: (x.get("is_currently_mapped", False), not x.get("is_locked", False), x.get("relevance", 0)), reverse=True)
    return {
        "success": True,
        "match_id": norm_mid,
        "matches": candidates,
    }


@router.post("/api/tracker/games/{match_id}/map_event_match", summary="Map an imported or completed scorecard to a tournament match")
async def api_map_tracker_game_to_event_match(
    match_id: str,
    body: TrackerMapEventMatchPayload,
    request: Request,
):
    user = _resolve_importing_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required to map a scorecard to a tournament match.")

    norm_mid = normalize_tracker_match_id(match_id)
    db = get_database()
    game_rec = db.get_tracker_game(norm_mid)
    if not game_rec:
        raise HTTPException(status_code=404, detail=f"Scorecard '{norm_mid}' not found.")

    actual_mid = str(game_rec.get("match_id") or norm_mid).strip().upper()
    state = game_rec.get("state") if isinstance(game_rec.get("state"), dict) else {}
    if not state and isinstance(game_rec.get("state_json"), dict):
        state = dict(game_rec["state_json"])

    ev_id = (body.event_id or "").strip()
    r_num = int(body.round_num or 1)
    t_num = int(body.table_num or 1)
    if not ev_id:
        raise HTTPException(status_code=400, detail="event_id is required.")

    # 1. Verify the tournament pairing exists
    pairing = _lookup_event_pairing_record(db, ev_id, r_num, t_num)
    if not pairing:
        raise HTTPException(
            status_code=404,
            detail=f"Tournament match not found for Event '{ev_id}', Round {r_num}, Table {t_num}.",
        )
    if pairing.get("is_bye"):
        raise HTTPException(status_code=400, detail="Cannot map a scorecard to a BYE pairing.")

    ev_real_id = str(pairing.get("event_id") or ev_id)
    ev_name = str(pairing.get("event_name") or ev_real_id)
    ev_p1_id = pairing.get("player1_id")
    ev_p1_name = str(pairing.get("player1_name") or "Player 1").strip()
    ev_p1_fac = str(pairing.get("player1_faction") or "").strip()
    ev_p2_id = pairing.get("player2_id")
    ev_p2_name = str(pairing.get("player2_name") or "Player 2").strip()
    ev_p2_fac = str(pairing.get("player2_faction") or "").strip()

    # 2. Strict Participant-Only Verification: ONLY player1 or player2 of the tournament match can map a scorecard to it
    user_is_p1 = check_user_matches_player(user, ev_p1_name, ev_p1_id)
    user_is_p2 = check_user_matches_player(user, ev_p2_name, ev_p2_id)
    if not (user_is_p1 or user_is_p2):
        raise HTTPException(
            status_code=403,
            detail="Only the two players who competed in this tournament match can map a scorecard to it.",
        )

    # 3. Strict Locking Verification:
    # 3a. Check if this scorecard is already locked to a DIFFERENT event match
    if state.get("event_match_locked") and game_rec.get("event_id"):
        same_target = (
            str(game_rec.get("event_id") or "").lower() == ev_real_id.lower()
            and int(game_rec.get("round_num") or 0) == r_num
            and int(game_rec.get("table_num") or 0) == t_num
        )
        if not same_target:
            raise HTTPException(
                status_code=409,
                detail=f"This scorecard is already locked to {state.get('mapped_event_name') or game_rec.get('event_id')} (Round {game_rec.get('round_num')}, Table {game_rec.get('table_num')}).",
            )

    # 3b. Check if the target tournament match already has another locked/completed scorecard in tracker_games
    conflict_row = _find_conflicting_locked_tracker_game_for_event_match(db, ev_real_id, r_num, t_num, actual_mid)
    if conflict_row:
        raise HTTPException(
            status_code=409,
            detail=f"This tournament match (Round {r_num}, Table {t_num}) already has a locked scorecard ({conflict_row['match_id']}) and cannot be overwritten.",
        )

    # 4. Auto P1 / P2 Alignment
    should_swap = _determine_p1_p2_alignment_swap(
        user,
        user_is_p1,
        user_is_p2,
        ev_p1_name,
        ev_p2_name,
        game_rec,
        state,
    )

    game_obj = state.get("game") if isinstance(state.get("game"), dict) else {}
    p1_obj = state.get("p1") if isinstance(state.get("p1"), dict) else {}
    p2_obj = state.get("p2") if isinstance(state.get("p2"), dict) else {}

    if should_swap:
        state["p1"], state["p2"] = p2_obj, p1_obj
        p1_obj, p2_obj = state["p1"], state["p2"]
        state["p1Score"], state["p2Score"] = state.get("p2Score", game_rec.get("p2_score")), state.get("p1Score", game_rec.get("p1_score"))
        state["user_id_p1"], state["user_id_p2"] = state.get("user_id_p2") or game_rec.get("user_id_p2"), state.get("user_id_p1") or game_rec.get("user_id_p1")
        if "p1_army_list" in state or "p2_army_list" in state:
            state["p1_army_list"], state["p2_army_list"] = state.get("p2_army_list"), state.get("p1_army_list")
        if isinstance(state.get("rosters"), dict):
            state["rosters"]["player1"], state["rosters"]["player2"] = state["rosters"].get("player2"), state["rosters"].get("player1")

        # Flip firstTurn indicators
        ft_curr = str(state.get("firstTurn") or game_obj.get("firstTurn") or "").lower()
        if ft_curr in ("p1", "player1", "1"):
            state["firstTurn"] = "p2"
            game_obj["firstTurn"] = "p2"
        elif ft_curr in ("p2", "player2", "2"):
            state["firstTurn"] = "p1"
            game_obj["firstTurn"] = "p1"

        if isinstance(state.get("roundState"), dict):
            for rk, rv in state["roundState"].items():
                if isinstance(rv, dict):
                    r_ft = str(rv.get("firstTurn") or "").lower()
                    if r_ft == "p1":
                        rv["firstTurn"] = "p2"
                    elif r_ft == "p2":
                        rv["firstTurn"] = "p1"

        game_obj["p1Name"], game_obj["p2Name"] = game_obj.get("p2Name") or p1_obj.get("name"), game_obj.get("p1Name") or p2_obj.get("name")
        game_obj["p1Faction"], game_obj["p2Faction"] = game_obj.get("p2Faction") or p1_obj.get("faction"), game_obj.get("p1Faction") or p2_obj.get("faction")
        game_obj["p1Detachments"], game_obj["p2Detachments"] = game_obj.get("p2Detachments") or [], game_obj.get("p1Detachments") or []

    # Preserve original imported names and align with official event pairing names
    if isinstance(p1_obj, dict):
        if not p1_obj.get("importedName") and p1_obj.get("name"):
            p1_obj["importedName"] = p1_obj.get("name")
        p1_obj["name"] = ev_p1_name
        if ev_p1_fac and (not p1_obj.get("faction") or p1_obj.get("faction") in ("Warhammer 40k", "Age of Sigmar")):
            p1_obj["faction"] = ev_p1_fac
    if isinstance(p2_obj, dict):
        if not p2_obj.get("importedName") and p2_obj.get("name"):
            p2_obj["importedName"] = p2_obj.get("name")
        p2_obj["name"] = ev_p2_name
        if ev_p2_fac and (not p2_obj.get("faction") or p2_obj.get("faction") in ("Warhammer 40k", "Age of Sigmar")):
            p2_obj["faction"] = ev_p2_fac

    game_obj["p1Name"] = ev_p1_name
    game_obj["p2Name"] = ev_p2_name
    if ev_p1_fac and (not game_obj.get("p1Faction") or game_obj.get("p1Faction") in ("Warhammer 40k", "Age of Sigmar")):
        game_obj["p1Faction"] = ev_p1_fac
    if ev_p2_fac and (not game_obj.get("p2Faction") or game_obj.get("p2Faction") in ("Warhammer 40k", "Age of Sigmar")):
        game_obj["p2Faction"] = ev_p2_fac
    game_obj["p1Id"] = ev_p1_id
    game_obj["p2Id"] = ev_p2_id
    game_obj["eventId"] = ev_real_id
    game_obj["roundNum"] = r_num
    game_obj["tableNum"] = t_num
    state["game"] = game_obj

    uid = str(user.get("id") or user.get("user_id") or "")
    if user_is_p1 and uid:
        state["user_id_p1"] = uid
    elif user_is_p2 and uid:
        state["user_id_p2"] = uid

    state["event_id"] = ev_real_id
    state["round_num"] = r_num
    state["table_num"] = t_num
    state["mapped_event_name"] = ev_name
    state["event_match_locked"] = True
    state["mapped_by_user_id"] = uid
    state["mapped_at"] = datetime.now(timezone.utc).isoformat()
    state["swapped_p1_p2"] = bool(should_swap)
    state["_force_uid_update"] = True
    state.pop("_clear_event_mapping", None)
    state["is_finished"] = True
    state["isFinished"] = True
    state["started"] = True

    new_ver = int(game_rec.get("version") or 1) + 1
    saved_ok = db.save_tracker_game(
        actual_mid,
        state,
        version=new_ver,
        user_id_p1=state.get("user_id_p1"),
        user_id_p2=state.get("user_id_p2"),
    )
    if not saved_ok:
        raise HTTPException(status_code=500, detail="Failed to persist tournament match mapping.")

    # Invalidate event details cache so Tournament Standings / Pairings reflect the mapped scorecard immediately
    try:
        if hasattr(db, "_event_details_cache_dict") and isinstance(db._event_details_cache_dict, dict):
            db._event_details_cache_dict.clear()
    except Exception:
        pass

    updated_rec = db.get_tracker_game(actual_mid) or {}
    return {
        "success": True,
        "match_id": actual_mid,
        "event_id": ev_real_id,
        "event_name": ev_name,
        "round_num": r_num,
        "table_num": t_num,
        "swapped_p1_p2": bool(should_swap),
        "locked": True,
        "event_match_locked": True,
        "mapped_by_user_id": uid,
        "p1_name": updated_rec.get("p1_name") or ev_p1_name,
        "p2_name": updated_rec.get("p2_name") or ev_p2_name,
        "p1_score": updated_rec.get("p1_score"),
        "p2_score": updated_rec.get("p2_score"),
        "event_scorecard_id": f"BCP-{ev_real_id}-R{r_num}-T{t_num}",
    }


@router.post("/api/tracker/games/{match_id}/unmap_event_match", summary="Unmap an imported scorecard (admin/organizer only once locked)")
async def api_unmap_tracker_game_from_event_match(
    match_id: str,
    request: Request,
):
    user = _resolve_importing_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")

    norm_mid = normalize_tracker_match_id(match_id)
    db = get_database()
    game_rec = db.get_tracker_game(norm_mid)
    if not game_rec:
        raise HTTPException(status_code=404, detail=f"Scorecard '{norm_mid}' not found.")

    actual_mid = str(game_rec.get("match_id") or norm_mid).strip().upper()
    state = game_rec.get("state") if isinstance(game_rec.get("state"), dict) else {}
    if not state and isinstance(game_rec.get("state_json"), dict):
        state = dict(game_rec["state_json"])

    is_staff = check_user_is_tournament_staff(user, game_rec, match_id=actual_mid, event_id=game_rec.get("event_id"))
    if state.get("event_match_locked") and not is_staff:
        raise HTTPException(
            status_code=403,
            detail="This scorecard is locked to a tournament match and can only be unlocked by the Tournament Organizer or an Administrator.",
        )

    state["event_id"] = None
    state["table_num"] = None
    state["mapped_event_name"] = None
    state["event_match_locked"] = False
    state["mapped_by_user_id"] = None
    state["_clear_event_mapping"] = True
    if isinstance(state.get("game"), dict):
        state["game"]["eventId"] = None
        state["game"]["tableNum"] = None

    new_ver = int(game_rec.get("version") or 1) + 1
    db.save_tracker_game(
        actual_mid,
        state,
        version=new_ver,
        user_id_p1=game_rec.get("user_id_p1"),
        user_id_p2=game_rec.get("user_id_p2"),
    )
    try:
        if hasattr(db, "_event_details_cache_dict") and isinstance(db._event_details_cache_dict, dict):
            db._event_details_cache_dict.clear()
    except Exception:
        pass

    return {"success": True, "match_id": actual_mid, "event_match_locked": False}



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
    if user_id:
        if role == "player1" and not room.get("user_id_p1"):
            room["user_id_p1"] = user_id
        elif role == "player2" and not room.get("user_id_p2"):
            room["user_id_p2"] = user_id
    is_p1 = bool(user_id and room.get("user_id_p1") == user_id)
    is_p2 = bool(user_id and room.get("user_id_p2") == user_id)
    has_assigned_players = bool(room.get("user_id_p1") or room.get("user_id_p2"))
    is_tournament = (
        match_id.startswith("BCP-") or
        match_id.startswith("ES-") or
        bool(room.get("event_id")) or
        bool(room.get("eventId")) or
        bool(room.get("tournament_id")) or
        bool(room.get("state", {}).get("event_id")) or
        bool(room.get("state", {}).get("game", {}).get("eventId"))
    )
    if is_tournament:
        is_tournament_staff = check_user_is_tournament_staff(user, room, match_id=match_id)
        if not (is_p1 or is_p2 or is_tournament_staff):
            raise HTTPException(status_code=403, detail="Permission denied: Spectators cannot attach army lists.")
    elif has_assigned_players and match_id not in ("MATCH", "AOS-LOCAL"):
        is_ref = bool(user and (user_id in room.get("referee_ids", []) or user.get("role") in ("admin", "referee", "to", "organizer") or user.get("is_admin") or user.get("can_access_to")))
        if not (is_p1 or is_p2 or is_ref):
            raise HTTPException(status_code=403, detail="Permission denied: Spectators cannot attach army lists.")

    if isinstance(army_list, dict) and army_list:
        from newrecruit_integration import build_synthetic_nr_row
        nr_row = build_synthetic_nr_row(army_list)
        army_list["list_key"] = nr_row.get("list_key")
        army_list["nr_row"] = nr_row

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
    from newrecruit_integration import build_synthetic_nr_row
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

    for r_item in (p1_list, p2_list):
        if isinstance(r_item, dict) and r_item and not r_item.get("list_key"):
            nr_row = build_synthetic_nr_row(r_item)
            r_item["list_key"] = nr_row.get("list_key")
            r_item["nr_row"] = nr_row

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

    fs_engine = get_firestore_engine()
    if fs_engine.is_room_discarded(match_id):
        return {"success": False, "status": "abandoned", "is_abandoned": True}

    if match_id not in TRACKER_ROOMS:
        TRACKER_ROOMS[match_id] = {
            "match_id": match_id,
            "state": {},
            "version": 1
        }

    room = TRACKER_ROOMS[match_id]
    is_p1 = bool(user_id and room.get("user_id_p1") == user_id)
    is_p2 = bool(user_id and room.get("user_id_p2") == user_id)
    is_tournament = (
        match_id.startswith("BCP-") or
        match_id.startswith("ES-") or
        bool(room.get("event_id")) or
        bool(room.get("eventId")) or
        bool(room.get("tournament_id")) or
        bool(room.get("state", {}).get("event_id")) or
        bool(room.get("state", {}).get("game", {}).get("eventId"))
    )
    if is_tournament:
        is_tournament_staff = check_user_is_tournament_staff(user, room, match_id=match_id)
        if not (is_p1 or is_p2 or is_tournament_staff):
            raise HTTPException(status_code=403, detail="Permission denied: Spectators cannot modify tournament clock.")
    else:
        is_ref = bool(user and (user_id in room.get("referee_ids", []) or user.get("role") in ("admin", "referee", "to", "organizer") or user.get("is_admin") or user.get("can_access_to")))
        if not (is_p1 or is_p2 or is_ref):
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

    fs_engine = get_firestore_engine()
    if fs_engine.is_room_discarded(match_id):
        return {"success": False, "status": "abandoned", "is_abandoned": True}

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

    fs_engine = get_firestore_engine()
    if fs_engine.is_room_discarded(match_id):
        return {"success": False, "status": "abandoned", "is_abandoned": True}

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
                if r.get("masterClock"):
                    yield f"data: {json.dumps({'type': 'master_clock_update', 'master_clock': r['masterClock']})}\n\n"
                if r.get("broadcast"):
                    yield f"data: {json.dumps({'type': 'broadcast_update', 'broadcast': r['broadcast']})}\n\n"
                if r.get("active_judge_call"):
                    yield f"data: {json.dumps({'type': 'judge_call_update', 'judge_call': r['active_judge_call']})}\n\n"
            else:
                # Attempt to load from Firestore if room exists
                try:
                    fs_engine = get_firestore_engine()
                    fs_doc = fs_engine.get_room(match_id)
                    if fs_doc:
                        if fs_doc.get("state"):
                            yield f"data: {json.dumps({'type': 'state_update', 'sender': 'server', 'version': fs_doc.get('version', 1), 'state': fs_doc['state']})}\n\n"
                        if fs_doc.get("chess_clock"):
                            yield f"data: {json.dumps({'type': 'clock_update', 'sender': 'server', 'chess_clock': fs_doc['chess_clock']})}\n\n"
                        if fs_doc.get("masterClock"):
                            yield f"data: {json.dumps({'type': 'master_clock_update', 'master_clock': fs_doc['masterClock']})}\n\n"
                except Exception:
                    pass

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

