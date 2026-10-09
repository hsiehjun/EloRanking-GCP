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
    guest_id: Optional[str] = None
    claim_role: Optional[str] = None
    faction: Optional[str] = None
    detachment: Optional[str] = None

class TrackerActionPayload(BaseModel):
    token: Optional[str] = None
    guest_id: Optional[str] = None
    match_id: Optional[str] = None
    state: Optional[Dict[str, Any]] = None

class TrackerStatePayload(BaseModel):
    match_id: str
    client_id: Optional[str] = "anon"
    token: Optional[str] = None
    guest_id: Optional[str] = None
    role: Optional[str] = "editor"
    version: int = 1
    state: Dict[str, Any]

class TrackerShareChatPayload(BaseModel):
    request_id: Optional[str] = None
    receiver_id: Optional[str] = None
    message: Optional[str] = None


_VALID_GUEST_ID_RE = re.compile(r"^guest_[A-Za-z0-9_\-]{3,60}$")

def _extract_guest_id(request: Optional[Request] = None, payload: Optional[Any] = None, body: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """Extract and strictly validate unauthenticated guest_id (must start with 'guest_') to prevent real user_id spoofing."""
    candidates = []
    if payload is not None:
        candidates.append(getattr(payload, "guest_id", None))
        candidates.append(getattr(payload, "player_id", None))
    if isinstance(body, dict):
        candidates.append(body.get("guest_id"))
        candidates.append(body.get("player_id"))
    if request is not None:
        try:
            if hasattr(request, "query_params") and request.query_params:
                candidates.append(request.query_params.get("guest_id"))
        except Exception:
            pass
        try:
            if hasattr(request, "headers") and request.headers:
                candidates.append(request.headers.get("X-Guest-Id") or request.headers.get("x-guest-id"))
        except Exception:
            pass
        try:
            if hasattr(request, "cookies") and request.cookies:
                candidates.append(request.cookies.get("gt_guest_id"))
        except Exception:
            pass
    for c in candidates:
        if c and isinstance(c, str):
            clean = c.strip()
            if clean and _VALID_GUEST_ID_RE.match(clean):
                return clean
    return None


def _is_guest_seat_id(val: Any) -> bool:
    """Return True if a seat's user_id belongs to an unauthenticated Guest (e.g. 'guest_...', 'p2_...', 'p1_...')."""
    if val is None:
        return False
    s = str(val).strip()
    return s.startswith("guest_") or s.startswith("p2_") or s.startswith("p1_")


def _maybe_rebind_guest_seat(room: Dict[str, Any], effective_uid: Optional[str], role: Optional[str] = None, fs_engine: Any = None, match_id: Optional[str] = None) -> Tuple[bool, bool]:
    """
    If a Guest loses connection or switches browsers/tabs and sends an action with their current
    guest_id and explicit role='player2'/'player1' while that seat is held by an unauthenticated guest_... ID,
    rebind the guest seat to their current guest_id so they are never locked out mid-match.
    Returns (is_p1, is_p2).
    """
    p1_uid = room.get("user_id_p1")
    p2_uid = room.get("user_id_p2")
    is_p1 = bool(effective_uid and p1_uid and str(p1_uid) == str(effective_uid))
    is_p2 = bool(effective_uid and p2_uid and str(p2_uid) == str(effective_uid))

    if not is_p1 and not is_p2 and effective_uid and _is_guest_seat_id(effective_uid):
        norm_role = str(role or "").strip().lower()
        if norm_role in ("player2", "p2") or (norm_role in ("editor", "") and p2_uid is None):
            if (p2_uid is None or _is_guest_seat_id(p2_uid)) and (not p1_uid or str(p1_uid) != str(effective_uid)):
                room["user_id_p2"] = effective_uid
                if isinstance(room.get("state"), dict):
                    room["state"]["user_id_p2"] = effective_uid
                is_p2 = True
                if fs_engine and match_id:
                    try:
                        fs_engine.update_room(match_id, {"user_id_p2": effective_uid})
                    except Exception:
                        pass
        elif norm_role in ("player1", "p1"):
            if (p1_uid is None or _is_guest_seat_id(p1_uid)) and (not p2_uid or str(p2_uid) != str(effective_uid)):
                room["user_id_p1"] = effective_uid
                if isinstance(room.get("state"), dict):
                    room["state"]["user_id_p1"] = effective_uid
                is_p1 = True
                if fs_engine and match_id:
                    try:
                        fs_engine.update_room(match_id, {"user_id_p1": effective_uid})
                    except Exception:
                        pass

    return is_p1, is_p2

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
    Supports:
    - Multi-device same-player access: if user/guest_id already matches user_id_p1 or user_id_p2, returns ('player1', None) or ('player2', None) without taking the opponent's slot.
    - Guest access without credentials: a guest with a valid 'guest_...' guest_id can claim the open player2 slot when player1 has set up the room.
    - 3rd+ person spectator routing: once both player1 and player2 slots are claimed, any subsequent distinct user/guest enters as 'spectator'.
    """
    guest_id = _extract_guest_id(payload=payload)
    candidate_user = user

    u_id = None
    if candidate_user:
        if isinstance(candidate_user, dict):
            u_id = candidate_user.get("id") or candidate_user.get("user_id")
        else:
            u_id = getattr(candidate_user, "id", None) or getattr(candidate_user, "user_id", None)
    elif guest_id:
        u_id = guest_id

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

    claim_role = str(getattr(payload, "claim_role", None) or "").strip().lower()
    if claim_role == "spectator":
        return ("spectator", None)
    if claim_role == "p2":
        claim_role = "player2"
    elif claim_role == "p1":
        claim_role = "player1"

    # Multi-device / returning player check: if this user or guest already owns Player 1 or Player 2,
    # always return their existing seat without claiming the other player's slot or becoming spectator.
    if u_id and p1_id and str(u_id) == str(p1_id):
        return ("player1", None)
    if u_id and p2_id and str(u_id) == str(p2_id):
        return ("player2", None)

    p1_is_guest_seat = _is_guest_seat_id(p1_id)
    p2_is_guest_seat = _is_guest_seat_id(p2_id)

    if is_tournament:
        # Strict table pairings: matched authenticated competitors claim their assigned slots
        matches_p1 = bool(candidate_user and check_user_matches_player(candidate_user, p1_assigned_name, p1_target_id))
        matches_p2 = bool(candidate_user and check_user_matches_player(candidate_user, p2_assigned_name, p2_target_id))

        if matches_p1:
            return ("player1", None if (p1_id and str(p1_id) == str(u_id)) else "user_id_p1")
        if matches_p2:
            return ("player2", None if (p2_id and str(p2_id) == str(u_id)) else "user_id_p2")
        # Strict staff check: ONLY this specific tournament's TO (or platform admin) enters as referee
        is_tournament_staff = check_user_is_tournament_staff(
            candidate_user,
            room_dict=room_dict,
            match_id=match_id,
            event_id=getattr(payload, "event_id", None) if payload else None
        )
        if is_tournament_staff:
            return ("referee", None)
        # If ONE player has already set up the game in the room (e.g. p1_id is claimed and p2_id is open),
        # allow an unauthenticated Guest with a valid guest_id (or if the opponent pairing is generic/unassigned)
        # to claim the open opponent slot, or reclaim a Guest seat if they lost connection and explicitly claim_role.
        is_guest_caller = bool(candidate_user is None and guest_id)
        has_unassigned_p2 = not p2_target_id and p2_assigned_name in ("", "Player 2", "Opponent", "Unknown")
        has_unassigned_p1 = not p1_target_id and p1_assigned_name in ("", "Player 1", "Unknown")
        if claim_role == "player2" and (not p2_id or p2_is_guest_seat) and (not p1_id or not u_id or str(u_id) != str(p1_id)) and (is_guest_caller or has_unassigned_p2):
            return ("player2", "user_id_p2")
        if claim_role == "player1" and (not p1_id or p1_is_guest_seat) and (not p2_id or not u_id or str(u_id) != str(p2_id)) and (is_guest_caller or has_unassigned_p1):
            return ("player1", "user_id_p1")
        if p1_id and not p2_id and (not u_id or str(u_id) != str(p1_id)) and (is_guest_caller or has_unassigned_p2):
            return ("player2", "user_id_p2")
        if p2_id and not p1_id and (not u_id or str(u_id) != str(p2_id)) and (is_guest_caller or has_unassigned_p1):
            return ("player1", "user_id_p1")
        return ("spectator", None)
    else:
        # Casual match logic:
        # - 1st distinct person gets player1
        # - 2nd distinct person (authenticated user OR Guest with guest_id != p1_id) gets player2
        # - Returning Guest who lost connection/session can reclaim a Guest seat when claim_role is specified
        # - 3rd+ person after both p1_id and p2_id are claimed gets spectator
        if claim_role == "player2" and (not p2_id or p2_is_guest_seat) and (not p1_id or not u_id or str(u_id) != str(p1_id)):
            return ("player2", "user_id_p2")
        if claim_role == "player1" and (not p1_id or p1_is_guest_seat) and (not p2_id or not u_id or str(u_id) != str(p2_id)):
            return ("player1", "user_id_p1")
        if not p1_id:
            return ("player1", "user_id_p1")
        if not p2_id and (not u_id or str(u_id) != str(p1_id)):
            return ("player2", "user_id_p2")
        if u_id and u_id in (room_dict.get("referee_ids") or []):
            return ("referee", None)
        return ("spectator", None)

@router.post("/api/tracker/room/create", summary="Create or connect to a multiplayer match room with host player")
async def api_tracker_create_room(request: Request, payload: Optional[TrackerCreatePayload] = None):
    return await asyncio.to_thread(_api_tracker_create_room_sync, request, payload)


def _api_tracker_create_room_sync(request: Request, payload: Optional[TrackerCreatePayload] = None):
    db = get_database()
    user = getattr(request, "_mock_user", None) if (request and isinstance(getattr(request, "_mock_user", None), dict)) else None
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
        if fs_doc and isinstance(fs_doc, dict) and fs_doc.get("state"):
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
        if saved_game and isinstance(saved_game, dict) and saved_game.get("state"):
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
def api_tracker_firestore_inspect(match_id: str, request: Request):
    _get_admin_session_or_403(request)
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
    return await asyncio.to_thread(_api_tracker_check_room_sync, match_id, request)


def _api_tracker_check_room_sync(match_id: str, request: Request):
    match_id = normalize_tracker_match_id(match_id)
        
    db = None
    try:
        db = get_database()
    except Exception:
        pass
    fs_engine = get_firestore_engine()
    user = getattr(request, "_mock_user", None) if (request and isinstance(getattr(request, "_mock_user", None), dict)) else None
    if user is None and request:
        try:
            auth_mgr = get_auth_manager()
            auth_header = request.headers.get("Authorization", "") if hasattr(request, "headers") else ""
            session_token = (request.cookies.get("session_token") if hasattr(request, "cookies") else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
            user = auth_mgr.get_session(session_token) if session_token else None
        except Exception:
            pass
    user_id = user["id"] if user else None
    guest_id = _extract_guest_id(request)
    effective_uid = user_id or guest_id
    
    if hasattr(fs_engine, "is_room_discarded") and fs_engine.is_room_discarded(match_id) is True:
        TRACKER_ROOMS.pop(match_id, None)
        return {"exists": False, "is_abandoned": True, "match_id": match_id, "error": f"Room key '{match_id}' was discarded."}

    if match_id in TRACKER_ROOMS and fs_engine.is_connected is not True:
        room = TRACKER_ROOMS[match_id]
    else:
        fs_doc = fs_engine.get_room(match_id)
        if fs_doc and isinstance(fs_doc, dict) and fs_doc.get("state"):
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
        elif match_id in TRACKER_ROOMS and fs_engine.is_connected is not True:
            room = TRACKER_ROOMS[match_id]
        else:
            if fs_engine.is_connected is True:
                TRACKER_ROOMS.pop(match_id, None)
            saved = db.get_tracker_game(match_id) if (db and hasattr(db, "get_tracker_game")) else None
            if saved and isinstance(saved, dict) and saved.get("state"):
                is_fin = bool(saved.get("is_finished") or (isinstance(saved.get("state"), dict) and saved["state"].get("is_finished")))
                if fs_engine.is_connected is True and not is_fin:
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

    is_p1 = bool(effective_uid and p1_id and str(effective_uid) == str(p1_id))
    is_p2 = bool(effective_uid and p2_id and str(effective_uid) == str(p2_id))
    is_finished = bool(room.get("is_finished") or (isinstance(room.get("state"), dict) and room["state"].get("is_finished")))
    is_tournament = (
        match_id.startswith("BCP-") or
        match_id.startswith("ES-") or
        bool(st.get("event_id")) or
        bool(game.get("eventId"))
    )

    room_sys = room.get("game_system") or st.get("game_system") or st.get("gameSystem") or ("aos" if match_id.startswith("AOS-") else "40k")

    p1_is_guest = _is_guest_seat_id(p1_id)
    p2_is_guest = _is_guest_seat_id(p2_id)
    can_reclaim_guest_p2 = bool(not is_finished and not is_p1 and p2_is_guest)
    can_reclaim_guest_p1 = bool(not is_finished and not is_p2 and p1_is_guest)

    if is_tournament:
        is_tournament_staff = check_user_is_tournament_staff(user, room, match_id=match_id)
        matches_p1 = is_p1 or bool(user and check_user_matches_player(user, p1_assigned_name, p1_target_id))
        matches_p2 = is_p2 or bool(user and check_user_matches_player(user, p2_assigned_name, p2_target_id))
        is_guest_caller = bool(user is None and guest_id)
        has_unassigned_p2 = not p2_target_id and p2_assigned_name in ("", "Player 2", "Opponent", "Unknown")
        has_unassigned_p1 = not p1_target_id and p1_assigned_name in ("", "Player 1", "Unknown")
        can_claim_open_p2 = bool(not is_finished and p1_id is not None and p2_id is None and not is_p1 and not is_tournament_staff and (is_guest_caller or has_unassigned_p2))
        can_claim_open_p1 = bool(not is_finished and p2_id is not None and p1_id is None and not is_p2 and not is_tournament_staff and (is_guest_caller or has_unassigned_p1))
        is_open_for_p2 = bool(not is_finished and p2_id is None and (matches_p2 or can_claim_open_p2))
        assigned_role = (
            "player1" if (matches_p1 or can_claim_open_p1)
            else ("player2" if (matches_p2 or can_claim_open_p2)
            else ("referee" if is_tournament_staff else "spectator"))
        )
        is_spectator = bool(assigned_role == "spectator")
        is_full = bool(is_finished or is_spectator)
        return {
            "exists": True,
            "match_id": match_id,
            "game_system": room_sys,
            "p1_name": p1_assigned_name,
            "p2_name": p2_assigned_name,
            "user_id_p1": p1_id,
            "user_id_p2": p2_id,
            "p1_is_guest": p1_is_guest,
            "p2_is_guest": p2_is_guest,
            "can_reclaim_guest_p1": bool(can_reclaim_guest_p1 and not is_tournament_staff and (is_guest_caller or has_unassigned_p1)),
            "can_reclaim_guest_p2": bool(can_reclaim_guest_p2 and not is_tournament_staff and (is_guest_caller or has_unassigned_p2)),
            "is_full": is_full,
            "is_open_for_p2": is_open_for_p2,
            "is_finished": is_finished,
            "is_spectator": is_spectator,
            "is_referee": is_tournament_staff,
            "is_participant": bool(assigned_role in ("player1", "player2", "referee")),
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
            "user_id_p1": p1_id,
            "user_id_p2": p2_id,
            "p1_is_guest": p1_is_guest,
            "p2_is_guest": p2_is_guest,
            "can_reclaim_guest_p1": can_reclaim_guest_p1,
            "can_reclaim_guest_p2": can_reclaim_guest_p2,
            "is_full": is_full,
            "is_open_for_p2": is_open_for_p2,
            "is_finished": is_finished,
            "is_spectator": is_spectator,
            "is_referee": is_staff,
            "is_participant": bool(assigned_role in ("player1", "player2", "referee")),
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
    if hasattr(fs_engine, "is_room_discarded") and fs_engine.is_room_discarded(match_id) is True:
        TRACKER_ROOMS.pop(match_id, None)
        raise HTTPException(status_code=404, detail="Match room was discarded or not found")
    
    user = getattr(request, "_mock_user", None) if (request and isinstance(getattr(request, "_mock_user", None), dict)) else None
    if user is None and request:
        try:
            auth_mgr = get_auth_manager()
            auth_header = request.headers.get("Authorization", "") if hasattr(request, "headers") else ""
            session_token = (payload.token if payload and payload.token else None) or (request.cookies.get("session_token") if hasattr(request, "cookies") else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
            user = auth_mgr.get_session(session_token) if session_token else None
        except Exception:
            pass
    user_id = user["id"] if user else None
    guest_id = _extract_guest_id(request, payload=payload)
    effective_uid = user_id or guest_id
    user_name = (user.get("display_name") or user.get("name")) if user else (payload.player_name if payload and payload.player_name else None)
    if guest_id:
        if payload is None:
            payload = TrackerJoinPayload(guest_id=guest_id)
        elif not payload.guest_id:
            payload.guest_id = guest_id
    
    if match_id not in TRACKER_ROOMS or fs_engine.is_connected is True:
        fs_doc = fs_engine.get_room(match_id)
        if fs_doc and isinstance(fs_doc, dict) and fs_doc.get("state"):
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
        elif match_id in TRACKER_ROOMS and fs_engine.is_connected is not True:
            pass
        else:
            if fs_engine.is_connected is True:
                TRACKER_ROOMS.pop(match_id, None)
            saved = db.get_tracker_game(match_id) if (db and hasattr(db, "get_tracker_game")) else None
            if saved and isinstance(saved, dict) and saved.get("state"):
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
                if fs_engine.is_connected is True:
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
        room["user_id_p1"] = effective_uid or f"p1_{secrets.token_hex(3)}"
        if isinstance(st, dict):
            st["user_id_p1"] = room["user_id_p1"]
        room["version"] = int(room.get("version") or 1) + 1
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
        room["user_id_p2"] = effective_uid or f"p2_{secrets.token_hex(3)}"
        if isinstance(st, dict):
            st["user_id_p2"] = room["user_id_p2"]
        if payload and payload.faction and not game.get("p2Faction"):
            game["p2Faction"] = payload.faction
        if payload and payload.detachment and not game.get("p2Detachment"):
            game["p2Detachment"] = payload.detachment
        if not is_tournament and payload and payload.player_name and payload.player_name != "Player 2":
            game["p2Name"] = payload.player_name
        room["version"] = int(room.get("version") or 1) + 1

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
        "user_id": effective_uid,
        "guest_id": guest_id,
        "is_guest": bool(user is None and guest_id),
        "user_name": user_name,
        "user_id_p1": room.get("user_id_p1"),
        "user_id_p2": room.get("user_id_p2"),
        "version": room.get("version", 1),
        "state": st,
        "chess_clock": room.get("chess_clock"),
        "is_finished": bool(room.get("is_finished") or (isinstance(st, dict) and st.get("is_finished"))),
        "scorecard_url": f"/scorecard/{match_id}"
    }

@router.post("/api/tracker/room/{match_id}/state", summary="Broadcast and persist multiplayer tracker state with role enforcement")
async def api_tracker_save_state(match_id: str, payload: TrackerStatePayload, request: Request):
    match_id = normalize_tracker_match_id(match_id)
    fs_engine = get_firestore_engine()
    if hasattr(fs_engine, "is_room_discarded") and fs_engine.is_room_discarded(match_id) is True:
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
    if saved_rec and isinstance(saved_rec, dict) and (saved_rec.get("is_finished") or (isinstance(saved_rec.get("state_json"), dict) and saved_rec["state_json"].get("is_finished"))):
        return {
            "success": False,
            "is_finished": True,
            "status": "finalized",
            "scorecard_url": f"/scorecard/{match_id}",
            "message": "Match has concluded and is locked."
        }
    
    user = getattr(request, "_mock_user", None) if (request and isinstance(getattr(request, "_mock_user", None), dict)) else None
    if user is None and request:
        try:
            auth_mgr = get_auth_manager()
            auth_header = request.headers.get("Authorization", "") if hasattr(request, "headers") else ""
            session_token = (payload.token if payload and payload.token else None) or (request.cookies.get("session_token") if hasattr(request, "cookies") else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
            user = auth_mgr.get_session(session_token) if session_token else None
        except Exception:
            pass
    user_id = user["id"] if user else None
    guest_id = _extract_guest_id(request, payload=payload)
    effective_uid = user_id or guest_id
    
    if match_id not in TRACKER_ROOMS or fs_engine.is_connected is True:
        fs_doc = fs_engine.get_room(match_id)
        if fs_doc and isinstance(fs_doc, dict) and fs_doc.get("state"):
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
        elif match_id in TRACKER_ROOMS and fs_engine.is_connected is not True:
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
    
    is_p1, is_p2 = _maybe_rebind_guest_seat(
        room, effective_uid, role=payload.role, fs_engine=fs_engine, match_id=match_id
    )
    is_tournament = (
        match_id.startswith("BCP-") or
        match_id.startswith("ES-") or
        bool(room.get("event_id")) or
        bool(room.get("eventId")) or
        bool(room.get("tournament_id")) or
        bool(room.get("state", {}).get("event_id")) or
        bool(room.get("state", {}).get("game", {}).get("eventId"))
    )
    
    if payload.role == "spectator":
        raise HTTPException(status_code=403, detail="Permission denied: Spectators cannot modify match state")

    if is_tournament:
        is_tournament_staff = check_user_is_tournament_staff(user, room, match_id=match_id)
        if not (is_p1 or is_p2 or is_tournament_staff):
            raise HTTPException(status_code=403, detail="Permission denied: Only matched competitors or tournament organizers can edit this tournament match.")
    else:
        is_ref = bool(user and (user_id in room.get("referee_ids", []) or user.get("role") in ("admin", "referee", "to", "organizer") or user.get("is_admin") or user.get("can_access_to")))
        if room.get("user_id_p1") and room.get("user_id_p2"):
            if not (is_p1 or is_p2 or is_ref):
                raise HTTPException(status_code=403, detail="Permission denied: Spectators cannot modify match state")
        elif room.get("user_id_p1") or room.get("user_id_p2"):
            if not (is_p1 or is_p2 or is_ref or payload.role in ("player1", "player2", "referee", "editor")):
                raise HTTPException(status_code=403, detail="Permission denied: Spectators cannot modify match state")
    
    new_ver = max(int(room.get("version") or 0) + 1, int(payload.version or 1))
    room["state"] = payload.state
    room["version"] = new_ver
    room["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    # Preserve authoritative user_id_p1 and user_id_p2 across multi-device / guest state saves
    # Never allow client state payload to overwrite an already-claimed seat!
    if not room.get("user_id_p1") and isinstance(payload.state, dict) and payload.state.get("user_id_p1"):
        room["user_id_p1"] = payload.state["user_id_p1"]
    if room.get("user_id_p1") and isinstance(payload.state, dict):
        payload.state["user_id_p1"] = room["user_id_p1"]
    if not room.get("user_id_p2") and isinstance(payload.state, dict) and payload.state.get("user_id_p2"):
        room["user_id_p2"] = payload.state["user_id_p2"]
    if room.get("user_id_p2") and isinstance(payload.state, dict):
        payload.state["user_id_p2"] = room["user_id_p2"]

    # Hot storage update in Cloud Firestore Native (ZERO PostgreSQL write)
    try:
        fs_engine.update_room(match_id, {
            "state": payload.state,
            "version": new_ver,
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
        "version": new_ver,
        "state": payload.state
    }
    for q in listeners:
        await q.put(msg)

    return {"success": True, "match_id": match_id, "version": new_ver}

@router.get("/api/tracker/room/{match_id}", summary="Get current match room state")
def api_tracker_get_state(match_id: str):
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

    online_count = max(1, sum(1 for l_q in TRACKER_LISTENERS.get(match_id, []) if not getattr(l_q, "_is_spectator", False)))
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

def _compute_tracker_side_score(side_obj: Any, state: Any = None, fallback_score: int = 0) -> int:
    if not isinstance(side_obj, dict):
        return int(fallback_score or 0)
    st = state if isinstance(state, dict) else {}
    game = st.get("game") if isinstance(st.get("game"), dict) else {}
    mid_str = str(st.get("match_id") or st.get("id") or "").upper()
    is_aos = (
        str(st.get("game_system") or st.get("gameSystem") or "").lower() == "aos"
        or mid_str.startswith("AOS-")
    )
    rounds = [r for r in (side_obj.get("rounds") or []) if isinstance(r, dict)]
    raw_ed = str(side_obj.get("edition") or st.get("edition") or game.get("edition") or "").strip().lower()

    if is_aos:
        pri = sum(int(r.get("primaryScore") or 0) for r in rounds)
        tac = sum(int(r.get("tacticScore") or r.get("secondaryScore") or 0) for r in rounds)
        if "3" in raw_ed or side_obj.get("grandStrategyScore") is not None:
            gs = int(side_obj.get("grandStrategyScore") or 0)
            tot = pri + tac + gs
            return tot if tot > 0 else int(side_obj.get("score") or side_obj.get("totalScore") or fallback_score or 0)
        tot = min(50, min(30, pri) + min(20, tac))
        return tot if tot > 0 else int(side_obj.get("score") or side_obj.get("totalScore") or fallback_score or 0)

    is_native_11th = bool(
        not st.get("imported_source")
        and (side_obj.get("deck") or game.get("p1Disposition") or game.get("p2Disposition") or not raw_ed or raw_ed in ("11th", "11e"))
    )
    if "8th" in raw_ed or "itc" in raw_ed or int(side_obj.get("primaryCap") or 0) == 36:
        pri_cap, sec_cap, max_tot, has_paint = 36, 12, 48, False
    elif not is_native_11th and (raw_ed in ("10th", "10e") or (st.get("imported_source") and raw_ed not in ("9th", "9e") and int(side_obj.get("primaryCap") or 0) != 45 and int(side_obj.get("secondaryCap") or 0) != 45)):
        pri_cap = int(side_obj.get("primaryCap") or 50)
        sec_cap = int(side_obj.get("secondaryCap") or 40)
        max_tot, has_paint = 100, True
    else:
        pri_cap = int(side_obj.get("primaryCap") or 45)
        sec_cap = int(side_obj.get("secondaryCap") or 45)
        max_tot, has_paint = 100, True

    raw_pri = sum(int(r.get("primaryScore") or 0) for r in rounds)
    if raw_pri == 0 and int(side_obj.get("primaryScore") or 0) > 0:
        raw_pri = int(side_obj.get("primaryScore") or 0)
    pri = min(pri_cap, raw_pri)

    hand = side_obj.get("hand") if isinstance(side_obj.get("hand"), list) else []
    raw_sec = 0
    for card in hand:
        if not isinstance(card, dict):
            continue
        if card.get("recurring"):
            r_scores = card.get("roundScores")
            if isinstance(r_scores, dict):
                for rv in r_scores.values():
                    if isinstance(rv, dict):
                        raw_sec += int(rv.get("points") or rv.get("score") or 0)
                    elif isinstance(rv, (int, float)):
                        raw_sec += int(rv)
        elif card.get("scoredRound") is not None:
            raw_sec += int(card.get("points") or card.get("score") or 0)

    if raw_sec == 0:
        for r in rounds:
            r_sec = int(r.get("secondaryScore") or 0)
            if r_sec == 0 and isinstance(r.get("secondaries"), list):
                r_sec = sum(int(s.get("score") or s.get("points") or 0) for s in r["secondaries"] if isinstance(s, dict))
            raw_sec += r_sec
    if raw_sec == 0 and int(side_obj.get("secondaryScore") or 0) > 0 and (not hand or st.get("imported_source")):
        raw_sec = int(side_obj.get("secondaryScore") or 0)

    sec = min(sec_cap, raw_sec)
    if not has_paint:
        paint = int(side_obj.get("paintScore") or 0)
    elif isinstance(side_obj.get("paintScore"), (int, float)):
        paint = int(side_obj["paintScore"])
    else:
        paint = 10 if side_obj.get("battleReady", True) is not False else 0

    has_detail = bool(
        any(int(r.get("primaryScore") or 0) > 0 or int(r.get("secondaryScore") or 0) > 0 or bool(r.get("secondaries")) for r in rounds)
        or len(hand) > 0
        or "battleReady" in side_obj
        or "deck" in side_obj
    )
    calc_tot = min(max_tot, pri + sec + paint)
    if not has_detail and int(side_obj.get("score") or side_obj.get("totalScore") or fallback_score or 0) > 0:
        return int(side_obj.get("score") or side_obj.get("totalScore") or fallback_score or 0)
    return calc_tot


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
    p1_score = _compute_tracker_side_score(p1, st, fallback_score=int(st.get("p1_score") or st.get("p1Score") or 0))
    p2_score = _compute_tracker_side_score(p2, st, fallback_score=int(st.get("p2_score") or st.get("p2Score") or 0))
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
def api_tracker_history(request: Request, limit: int = 500, search: Optional[str] = None, token: Optional[str] = Query(None), game_system: Optional[str] = Query(None)):
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
    return await asyncio.to_thread(_api_tracker_user_sessions_sync, request, token, game_system)


def _api_tracker_user_sessions_sync(
    request: Request,
    token: Optional[str] = None,
    game_system: Optional[str] = None
):
    user = getattr(request, "_mock_user", None) if (request and isinstance(getattr(request, "_mock_user", None), dict)) else None
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
            raw_completed_history = db.get_tracker_history(limit=500, user_id=user_id, user_name=user_name) or []
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
    user = getattr(request, "_mock_user", None) if (request and isinstance(getattr(request, "_mock_user", None), dict)) else None
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
    guest_id = _extract_guest_id(request, payload=payload)
    effective_uid = user_id or guest_id
    is_p1, is_p2 = _maybe_rebind_guest_seat(
        room, effective_uid, role="player2" if (guest_id and not user_id) else None, fs_engine=fs_engine, match_id=match_id
    )
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
                side_obj = state.get(side_key)
                fb = 0
                for k in (top_key, "p1Score" if side_key == "p1" else "p2Score"):
                    if state.get(k) is not None:
                        try:
                            fb = int(state[k])
                            break
                        except Exception:
                            pass
                if isinstance(side_obj, dict):
                    return _compute_tracker_side_score(side_obj, state, fallback_score=fb)
                if fb > 0:
                    return fb
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
def api_tracker_hide_game(match_id: str, request: Request, payload: Optional[TrackerActionPayload] = None):
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
def api_tracker_unhide_game(match_id: str, request: Request, payload: Optional[TrackerActionPayload] = None):
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
    return await asyncio.to_thread(_api_get_scorecard_sync, match_id)


def _event_id_case_variants(ev_id: str) -> List[str]:
    s = str(ev_id or "").strip()
    if not s:
        return []
    out = []
    for cand in (s, s.lower(), s.upper()):
        if cand and cand not in out:
            out.append(cand)
    return out


def _api_get_scorecard_sync(match_id: str):
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

    is_mock_db = bool(db and hasattr(db, "assert_called"))
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
    # Note: db.get_tracker_game(match_id) already checks all candidate IDs and (event_id, round_num, table_num) in a single indexed query!
    game_rec = None
    m_pat = re.match(r"^(?:WH40K-|AOS-)?(?:BCP|ES)-(.+)-R(\d+)-T(\d+)$", match_id.strip(), re.IGNORECASE)
    m_player_pat = None if m_pat else re.match(r"^(?:WH40K-|AOS-)?(?:BCP|ES)-(.+)-R(\d+)-P-(.+)$", match_id.strip(), re.IGNORECASE)

    if db and hasattr(db, "get_tracker_game"):
        try:
            rec = db.get_tracker_game(match_id)
            if rec and isinstance(rec, dict):
                game_rec = rec
        except Exception:
            pass
        if not game_rec and is_mock_db:
            for cand in candidates[1:]:
                try:
                    rec = db.get_tracker_game(cand)
                    if rec and isinstance(rec, dict):
                        game_rec = rec
                        break
                except Exception:
                    pass

    # 2. Check event & official BCP match record in our database if this is an event pairing or match ID
    bcp_match = None
    is_event_completed = False
    ev_id_raw = m_pat.group(1) if m_pat else (m_player_pat.group(1) if m_player_pat else None)

    is_es_event = bool(
        match_id.upper().startswith(("ES-", "WH40K-ES-", "AOS-ES-"))
        or (ev_id_raw and str(ev_id_raw).upper().startswith("ES-"))
    )
    if is_es_event and ev_id_raw and db and hasattr(db, "get_studio_event") and not is_mock_db:
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

    if db and hasattr(db, "get_connection") and not is_mock_db:
        try:
            with db.get_connection() as conn:
                with conn.cursor() as cur:
                    row = None
                    if m_pat:
                        ev_vars = _event_id_case_variants(m_pat.group(1))
                        cur.execute("""
                            SELECT m.id, m.event_id, m.round, m.table_number, m.match_date,
                                   m.player1_id, m.player1_name, m.player1_faction, m.player1_score,
                                   m.player2_id, m.player2_name, m.player2_faction, m.player2_score,
                                   m.winner_id, m.loser_id, m.is_draw, m.is_bye, m.is_done,
                                   e.name AS event_name, e.is_ended AS event_is_ended,
                                   e.event_date, e.end_date, e.raw_json AS event_raw_json
                            FROM matches m
                            LEFT JOIN events e ON e.id = m.event_id
                            WHERE m.event_id = ANY(%s)
                              AND m.round = %s
                              AND m.table_number = %s
                            LIMIT 1;
                        """, (ev_vars, int(m_pat.group(2)), int(m_pat.group(3))))
                        row = cur.fetchone()
                    elif m_player_pat:
                        ev_vars = _event_id_case_variants(m_player_pat.group(1))
                        p_tok = urllib.parse.unquote(m_player_pat.group(3)).strip()
                        cur.execute("""
                            SELECT m.id, m.event_id, m.round, m.table_number, m.match_date,
                                   m.player1_id, m.player1_name, m.player1_faction, m.player1_score,
                                   m.player2_id, m.player2_name, m.player2_faction, m.player2_score,
                                   m.winner_id, m.loser_id, m.is_draw, m.is_bye, m.is_done,
                                   e.name AS event_name, e.is_ended AS event_is_ended,
                                   e.event_date, e.end_date, e.raw_json AS event_raw_json
                            FROM matches m
                            LEFT JOIN events e ON e.id = m.event_id
                            WHERE m.event_id = ANY(%s)
                              AND m.round = %s
                              AND (
                                  LOWER(COALESCE(m.player1_id, '')) = LOWER(%s)
                                  OR LOWER(COALESCE(m.player2_id, '')) = LOWER(%s)
                                  OR LOWER(TRIM(COALESCE(m.player1_name, ''))) = LOWER(%s)
                                  OR LOWER(TRIM(COALESCE(m.player2_name, ''))) = LOWER(%s)
                              )
                            LIMIT 1;
                        """, (ev_vars, int(m_player_pat.group(2)), p_tok, p_tok, p_tok, p_tok))
                        row = cur.fetchone()

                    if not row and not m_pat and not m_player_pat:
                        raw_mid_lookup = match_id.strip()
                        cur.execute("""
                            SELECT m.id, m.event_id, m.round, m.table_number, m.match_date,
                                   m.player1_id, m.player1_name, m.player1_faction, m.player1_score,
                                   m.player2_id, m.player2_name, m.player2_faction, m.player2_score,
                                   m.winner_id, m.loser_id, m.is_draw, m.is_bye, m.is_done,
                                   e.name AS event_name, e.is_ended AS event_is_ended,
                                   e.event_date, e.end_date, e.raw_json AS event_raw_json
                            FROM matches m
                            LEFT JOIN events e ON e.id = m.event_id
                            WHERE m.id = %s
                            LIMIT 1;
                        """, (raw_mid_lookup,))
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

                        if not ev_id_raw and row_dict.get("event_id"):
                            ev_id_raw = str(row_dict["event_id"])

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

                        # If resolved via m.id or P-player and we haven't checked tracker_games for its (event_id, round, table_number), check now!
                        if not game_rec and not m_pat and bcp_match.get("event_id") and bcp_match.get("round") and bcp_match.get("table_number") and hasattr(db, "get_tracker_game"):
                            ev_vars2 = _event_id_case_variants(bcp_match["event_id"])
                            cur.execute("""
                                SELECT match_id
                                FROM tracker_games
                                WHERE event_id = ANY(%s)
                                  AND round_num = %s
                                  AND table_num = %s
                                ORDER BY
                                  COALESCE((state_json->>'event_match_locked')::boolean, FALSE) DESC,
                                  is_finished DESC,
                                  updated_at DESC
                                LIMIT 1;
                            """, (ev_vars2, int(bcp_match["round"]), int(bcp_match["table_number"])))
                            tg_row2 = cur.fetchone()
                            if tg_row2:
                                mapped_mid2 = tg_row2[0] if not isinstance(tg_row2, dict) else tg_row2.get("match_id")
                                if mapped_mid2:
                                    game_rec = db.get_tracker_game(str(mapped_mid2))

                    # Fallback to rating_history if matches table had no row
                    if not bcp_match and not game_rec:
                        if m_player_pat:
                            ev_vars = _event_id_case_variants(m_player_pat.group(1))
                            p_tok = urllib.parse.unquote(m_player_pat.group(3)).strip()
                            cur.execute("""
                                SELECT h.match_id, h.event_id, h.round, h.match_date,
                                       h.player_id, p.full_name AS player_name, h.player_faction, h.player_score,
                                       h.opponent_id, h.opponent_name, h.opponent_faction, h.opponent_score,
                                       h.result, e.name AS event_name
                                FROM rating_history h
                                LEFT JOIN events e ON e.id = h.event_id
                                LEFT JOIN players p ON p.id = h.player_id
                                WHERE h.event_id = ANY(%s)
                                  AND h.round = %s
                                  AND (LOWER(h.player_id) = LOWER(%s) OR LOWER(COALESCE(h.opponent_id, '')) = LOWER(%s) OR LOWER(TRIM(COALESCE(h.opponent_name, ''))) = LOWER(%s))
                                LIMIT 1;
                            """, (ev_vars, int(m_player_pat.group(2)), p_tok, p_tok, p_tok))
                        else:
                            cur.execute("""
                                SELECT h.match_id, h.event_id, h.round, h.match_date,
                                       h.player_id, p.full_name AS player_name, h.player_faction, h.player_score,
                                       h.opponent_id, h.opponent_name, h.opponent_faction, h.opponent_score,
                                       h.result, e.name AS event_name
                                FROM rating_history h
                                LEFT JOIN events e ON e.id = h.event_id
                                LEFT JOIN players p ON p.id = h.player_id
                                WHERE h.match_id = %s
                                LIMIT 1;
                            """, (match_id.strip(),))
                        rh_row = cur.fetchone()
                        if rh_row and getattr(cur, "description", None):
                            rh_cols = [desc[0] for desc in cur.description]
                            rh = dict(zip(rh_cols, rh_row)) if not isinstance(rh_row, dict) else dict(rh_row)
                            m_dt = rh.get("match_date")
                            if m_dt and hasattr(m_dt, "isoformat"):
                                m_dt = m_dt.isoformat()
                            res_ch = str(rh.get("result") or "").upper()
                            bcp_match = {
                                "id": rh.get("match_id") or match_id,
                                "event_id": rh.get("event_id"),
                                "event_name": rh.get("event_name") or rh.get("event_id") or "Tournament Match",
                                "round": rh.get("round") or 1,
                                "table_number": None,
                                "match_date": m_dt,
                                "player1_id": rh.get("player_id"),
                                "player1_name": rh.get("player_name") or "Player 1",
                                "player1_faction": rh.get("player_faction") or "",
                                "player1_score": rh.get("player_score"),
                                "player2_id": rh.get("opponent_id"),
                                "player2_name": rh.get("opponent_name") or "Player 2",
                                "player2_faction": rh.get("opponent_faction") or "",
                                "player2_score": rh.get("opponent_score"),
                                "winner_id": rh.get("player_id") if res_ch == "W" else (rh.get("opponent_id") if res_ch == "L" else None),
                                "is_draw": res_ch == "D",
                                "is_bye": False,
                                "is_done": True
                            }
                            is_event_completed = True
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
        for cand in candidates:
            TRACKER_ROOMS.pop(cand, None)
            if fs_engine and hasattr(fs_engine, "_fallback_rooms"):
                fs_engine._fallback_rooms.pop(cand, None)

        state = game_rec.get("state") or game_rec.get("state_json") or {}
        sys_id = (
            game_rec.get("game_system")
            or (state.get("game_system") if isinstance(state, dict) else None)
            or (state.get("gameSystem") if isinstance(state, dict) else None)
            or ("aos" if str(match_id).upper().startswith("AOS-") else "40k")
        )
        actual_mid = str(game_rec.get("match_id") or match_id).strip()
        return {
            "success": True,
            "match_id": actual_mid,
            "requested_match_id": match_id,
            "game_system": sys_id,
            "game_record": game_rec,
            "state": state,
            "bcp_match": bcp_match,
            "is_finished": True,
            "status": "completed",
            "source": "tracker_games"
        }

    # If the event is completed, evict any in-memory rooms and return the BCP score immediately
    # without running expensive Cloud Firestore collection scans on a GET request.
    if is_event_completed:
        for cand in candidates:
            TRACKER_ROOMS.pop(cand, None)
            if fs_engine and hasattr(fs_engine, "_fallback_rooms"):
                fs_engine._fallback_rooms.pop(cand, None)

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
    # Read live up-to-date game state from TRACKER_ROOMS / Firestore (check normalized room ID first, max 2 lookups)
    room_doc = None
    for cand in candidates:
        rdoc = TRACKER_ROOMS.get(cand)
        if rdoc and isinstance(rdoc, dict) and not rdoc.get("is_abandoned") and rdoc.get("status") != "abandoned":
            room_doc = rdoc
            break
    if not room_doc and fs_engine and hasattr(fs_engine, "get_room"):
        fs_lookup_keys = [norm_mid]
        if match_id != norm_mid and match_id not in fs_lookup_keys:
            fs_lookup_keys.append(match_id)
        for cand in fs_lookup_keys:
            try:
                rdoc = fs_engine.get_room(cand)
                if rdoc and isinstance(rdoc, dict):
                    room_doc = rdoc
                    break
            except Exception:
                pass

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
def view_scorecard_page(match_id: str):
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
    player_id: Optional[str] = None
    api_key: Optional[str] = None
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
    user = getattr(request, "_mock_user", None) if (request and isinstance(getattr(request, "_mock_user", None), dict)) else None
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
        ver = 1

        if db and hasattr(db, "get_tracker_game"):
            try:
                existing = db.get_tracker_game(mid)
            except Exception:
                existing = None
            if isinstance(existing, dict):
                ver = int(existing.get("version") or 1) + 1
                ex_st = existing.get("state")
                if isinstance(ex_st, str):
                    try:
                        ex_st = json.loads(ex_st)
                    except Exception:
                        ex_st = {}
                if not isinstance(ex_st, dict):
                    ex_st = {}

                if ex_st.get("event_id") or existing.get("event_id") or ex_st.get("event_match_locked"):
                    if ex_st.get("swapped_p1_p2"):
                        g_obj = st.get("game") if isinstance(st.get("game"), dict) else {}
                        st["p1"], st["p2"] = st.get("p2", {}), st.get("p1", {})
                        st["p1Score"], st["p2Score"] = st.get("p2Score"), st.get("p1Score")
                        item["p1_score"], item["p2_score"] = item.get("p2_score"), item.get("p1_score")
                        item["p1_faction"], item["p2_faction"] = item.get("p2_faction"), item.get("p1_faction")
                        item["p1_detachment"], item["p2_detachment"] = item.get("p2_detachment"), item.get("p1_detachment")
                        g_obj["p1Faction"], g_obj["p2Faction"] = g_obj.get("p2Faction"), g_obj.get("p1Faction")
                        g_obj["p1Detachments"], g_obj["p2Detachments"] = g_obj.get("p2Detachments") or [], g_obj.get("p1Detachments") or []
                        ft_curr = str(st.get("firstTurn") or g_obj.get("firstTurn") or "").lower()
                        if ft_curr in ("p1", "player1", "1"):
                            st["firstTurn"] = "p2"
                            g_obj["firstTurn"] = "p2"
                        elif ft_curr in ("p2", "player2", "2"):
                            st["firstTurn"] = "p1"
                            g_obj["firstTurn"] = "p1"
                        if isinstance(st.get("roundState"), dict):
                            for rv in st["roundState"].values():
                                if isinstance(rv, dict):
                                    r_ft = str(rv.get("firstTurn") or "").lower()
                                    if r_ft == "p1":
                                        rv["firstTurn"] = "p2"
                                    elif r_ft == "p2":
                                        rv["firstTurn"] = "p1"
                        st["game"] = g_obj
                        st["swapped_p1_p2"] = True

                    ex_g = ex_st.get("game") if isinstance(ex_st.get("game"), dict) else {}
                    ex_p1 = ex_st.get("p1") if isinstance(ex_st.get("p1"), dict) else {}
                    ex_p2 = ex_st.get("p2") if isinstance(ex_st.get("p2"), dict) else {}
                    g_obj = st.get("game") if isinstance(st.get("game"), dict) else {}

                    ev_p1_nm = existing.get("p1_name") or ex_g.get("p1Name") or ex_p1.get("name")
                    ev_p2_nm = existing.get("p2_name") or ex_g.get("p2Name") or ex_p2.get("name")
                    if ev_p1_nm and isinstance(st.get("p1"), dict):
                        st["p1"]["importedName"] = st["p1"].get("name")
                        st["p1"]["name"] = ev_p1_nm
                        g_obj["p1Name"] = ev_p1_nm
                        item["p1_name"] = ev_p1_nm
                    if ev_p2_nm and isinstance(st.get("p2"), dict):
                        st["p2"]["importedName"] = st["p2"].get("name")
                        st["p2"]["name"] = ev_p2_nm
                        g_obj["p2Name"] = ev_p2_nm
                        item["p2_name"] = ev_p2_nm

                    for k in ("p1Id", "p2Id", "eventId", "roundNum", "tableNum"):
                        if ex_g.get(k) is not None:
                            g_obj[k] = ex_g[k]
                    st["game"] = g_obj

                    st["event_id"] = ex_st.get("event_id") or existing.get("event_id")
                    st["round_num"] = ex_st.get("round_num") or existing.get("round_num")
                    st["table_num"] = ex_st.get("table_num") or existing.get("table_num")
                    st["mapped_event_name"] = ex_st.get("mapped_event_name")
                    st["event_match_locked"] = bool(ex_st.get("event_match_locked", True))
                    st["mapped_by_user_id"] = ex_st.get("mapped_by_user_id")
                    st["mapped_at"] = ex_st.get("mapped_at")
                    u_p1 = existing.get("user_id_p1") or ex_st.get("user_id_p1") or u_p1
                    u_p2 = existing.get("user_id_p2") or ex_st.get("user_id_p2") or u_p2
                    st["user_id_p1"] = u_p1
                    st["user_id_p2"] = u_p2

        if not dry_run and db and hasattr(db, "save_tracker_game"):
            db.save_tracker_game(
                mid,
                st,
                version=ver,
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
def api_tracker_import_ttb_sync(request: Request, body: TrackerImportSyncPayload):
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


@router.post("/api/tracker/import/battlebase-sync", summary="Download and import completed games from BattleBase (battlebase.app)")
def api_tracker_import_battlebase_sync(request: Request, body: TrackerImportSyncPayload):
    from tracker_importer import sync_battlebase_account_games
    user = _resolve_importing_user(request)
    email_or_user = (body.email or body.username or "").strip()
    try:
        res = sync_battlebase_account_games(
            email_or_user,
            body.password or "",
            importing_user=user,
        )
        saved = _persist_imported_games_to_db(res.get("games") or [], user, dry_run=bool(body.dry_run))
        return {
            "success": True,
            "source": "battlebase",
            "storage_target": "tracker_games",
            "dry_run": bool(body.dry_run),
            "imported_count": len(saved),
            "games": saved,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in /api/tracker/import/battlebase-sync: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to sync BattleBase games: {e}")


@router.post("/api/tracker/import/newrecruit-sync", summary="Download and import completed games & battle reports from NewRecruit (newrecruit.eu)")
def api_tracker_import_newrecruit_sync(request: Request, body: TrackerImportSyncPayload):
    from tracker_importer import sync_newrecruit_account_games
    user = _resolve_importing_user(request)
    email_or_user = (body.email or body.username or "").strip()
    try:
        res = sync_newrecruit_account_games(
            email_or_user,
            body.password or "",
            importing_user=user,
        )
        saved = _persist_imported_games_to_db(res.get("games") or [], user, dry_run=bool(body.dry_run))
        return {
            "success": True,
            "source": "newrecruit",
            "storage_target": "tracker_games",
            "dry_run": bool(body.dry_run),
            "imported_count": len(saved),
            "games": saved,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in /api/tracker/import/newrecruit-sync: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to sync NewRecruit games: {e}")


@router.post("/api/tracker/import/championshub-sync", summary="Download and import completed games from ChampionsHub (championshub.app)")
def api_tracker_import_championshub_sync(request: Request, body: TrackerImportSyncPayload):
    from tracker_importer import sync_championshub_account_games
    user = _resolve_importing_user(request)
    email_or_user = (body.email or body.username or "").strip()
    try:
        res = sync_championshub_account_games(
            email_or_user,
            body.password or "",
            importing_user=user,
        )
        saved = _persist_imported_games_to_db(res.get("games") or [], user, dry_run=bool(body.dry_run))
        return {
            "success": True,
            "source": "championshub",
            "storage_target": "tracker_games",
            "dry_run": bool(body.dry_run),
            "imported_count": len(saved),
            "games": saved,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in /api/tracker/import/championshub-sync: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to sync ChampionsHub games: {e}")


@router.post("/api/tracker/import/milarki-sync", summary="Download and import completed Age of Sigmar battles from Milarki (milarki.com)")
def api_tracker_import_milarki_sync(request: Request, body: TrackerImportSyncPayload):
    from tracker_importer import sync_milarki_account_games
    user = _resolve_importing_user(request)
    pid = (body.player_id or body.username or body.email or "").strip()
    key = (body.api_key or body.password or body.token or "").strip()
    try:
        res = sync_milarki_account_games(
            pid,
            key,
            importing_user=user,
        )
        saved = _persist_imported_games_to_db(res.get("games") or [], user, dry_run=bool(body.dry_run))
        return {
            "success": True,
            "source": "milarki",
            "storage_target": "tracker_games",
            "dry_run": bool(body.dry_run),
            "imported_count": len(saved),
            "games": saved,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in /api/tracker/import/milarki-sync: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to sync Milarki games: {e}")


@router.post("/api/tracker/import/ttb-code", summary="Download and import a Tabletop Battles game by Observer or Link Code")
def api_tracker_import_ttb_code(request: Request, body: TrackerImportCodePayload):
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
def api_tracker_import_parse(request: Request, body: TrackerImportParsePayload):
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


_COMMON_FIRST_NAME_EQUIV: Dict[str, str] = {
    "joe": "joseph", "joseph": "joe",
    "brad": "bradford", "bradford": "brad",
    "jon": "jonathan", "jonathan": "jon",
    "dan": "daniel", "daniel": "dan", "danny": "daniel",
    "matt": "matthew", "matthew": "matt",
    "mike": "michael", "michael": "mike",
    "alex": "alexander", "alexander": "alex",
    "ben": "benjamin", "benjamin": "ben",
    "tim": "timothy", "timothy": "tim",
    "chris": "christopher", "christopher": "chris",
    "nick": "nicholas", "nicholas": "nick",
    "dave": "david", "david": "dave",
    "rob": "robert", "robert": "rob", "bobby": "robert", "bob": "robert",
    "will": "william", "william": "will", "bill": "william",
    "josh": "joshua", "joshua": "josh",
    "jake": "jacob", "jacob": "jake",
    "drew": "andrew", "andy": "andrew", "andrew": "andy",
    "nate": "nathan", "nathan": "nate", "nathaniel": "nate",
    "zach": "zachary", "zack": "zachary", "zachary": "zach",
    "steve": "stephen", "stephen": "steve", "steven": "steve",
    "greg": "gregory", "gregory": "greg",
    "max": "maximosugus", "maximosugus": "max",
}


def _first_names_match(fa: str, fb: str) -> bool:
    if not fa or not fb:
        return False
    if fa == fb and len(fa) >= 2:
        return True
    if _COMMON_FIRST_NAME_EQUIV.get(fa) == fb or _COMMON_FIRST_NAME_EQUIV.get(fb) == fa:
        return True
    if len(fa) >= 3 and len(fb) >= 3 and (fa.startswith(fb) or fb.startswith(fa)):
        return True
    return False


def _names_roughly_match(name_a: Optional[str], name_b: Optional[str]) -> bool:
    if not name_a or not name_b:
        return False
    clean_a = re.sub(r"\s*\([^)]*\)\s*", " ", str(name_a).strip().lower())
    clean_b = re.sub(r"\s*\([^)]*\)\s*", " ", str(name_b).strip().lower())
    na = re.sub(r"[^a-z0-9\s]", "", clean_a).strip()
    nb = re.sub(r"[^a-z0-9\s]", "", clean_b).strip()
    if not na or not nb:
        return False
    if na in ("player 1", "player 2", "player1", "player2", "you", "opponent", "unknown", "bye"):
        return False
    if nb in ("player 1", "player 2", "player1", "player2", "you", "opponent", "unknown", "bye"):
        return False
    if na == nb:
        return True
    parts_a = na.split()
    parts_b = nb.split()
    if len(parts_a) >= 2 and len(parts_b) >= 2:
        return _first_names_match(parts_a[0], parts_b[0]) and parts_a[-1] == parts_b[-1]
    if len(parts_a) == 1 and len(parts_b) >= 1:
        return _first_names_match(parts_a[0], parts_b[0])
    if len(parts_b) == 1 and len(parts_a) >= 1:
        return _first_names_match(parts_b[0], parts_a[0])
    return False


_USER_PLAYER_IDS_CACHE: Dict[str, Tuple[float, List[str], List[str]]] = {}
_MAPPABLE_BASE_MATCHES_CACHE: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}
_MAPPABLE_CACHE_TTL_SEC = 180.0


def _invalidate_mappable_matches_cache() -> None:
    _MAPPABLE_BASE_MATCHES_CACHE.clear()


def _event_id_variants(event_id: str) -> List[str]:
    s = str(event_id or "").strip()
    if not s:
        return []
    out = [s]
    for v in (s.lower(), s.upper()):
        if v not in out:
            out.append(v)
    return out


def _parse_league_pairing_scores(pr: Dict[str, Any]) -> Tuple[Optional[int], Optional[int]]:
    ps = pr.get("player_score")
    os_val = pr.get("opponent_score")
    if ps is not None and os_val is not None:
        try:
            p_i, o_i = int(ps), int(os_val)
            if p_i > 0 or o_i > 0 or pr.get("is_completed"):
                return p_i, o_i
        except (ValueError, TypeError):
            pass
    raw_sc = str(pr.get("score") or pr.get("score_label") or "").strip()
    if raw_sc:
        m = re.search(r"(\d+)\s*-\s*(\d+)", raw_sc)
        if m:
            try:
                return int(m.group(1)), int(m.group(2))
            except (ValueError, TypeError):
                pass
    return None, None


def _lookup_event_pairing_record(
    db: Any,
    event_id: str,
    round_num: int,
    table_num: int,
    user: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Finds a specific tournament or league pairing from `matches`, `events.pairings`, or `native_league_standings`."""
    if not db or not event_id:
        return None
    from psycopg2 import extras
    ev_clean = str(event_id).strip()
    if ev_clean.upper().startswith("LEAGUE:"):
        # Format: LEAGUE:{slug_or_id}:S{season_num}:P{pod_num}
        parts = ev_clean.split(":")
        lg_key = parts[1].strip() if len(parts) >= 2 else ""
        s_num = None
        p_num = int(table_num or 1)
        for pt in parts[2:]:
            pt_u = pt.strip().upper()
            if pt_u.startswith("S") and pt_u[1:].isdigit():
                s_num = int(pt_u[1:])
            elif pt_u.startswith("P") and pt_u[1:].isdigit():
                p_num = int(pt_u[1:])
        try:
            with db.get_connection() as conn:
                with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                    if s_num is not None:
                        cur.execute("""
                            SELECT s.league_id, COALESCE(l.slug, s.league_id) AS league_slug,
                                   COALESCE(l.name, s.league_id) AS league_name,
                                   COALESCE(l.game_system, '40k') AS game_system,
                                   s.season_num, s.pod_num, s.player_name, s.primary_faction,
                                   s.bcp_player_id, s.player_id, s.user_id, s.pairings_json,
                                   COALESCE(ls.start_date::timestamptz, s.updated_at) AS event_date
                            FROM native_league_standings s
                            LEFT JOIN native_leagues l ON l.id = s.league_id OR l.slug = s.league_id
                            LEFT JOIN native_league_seasons ls ON ls.league_id = s.league_id AND ls.season_num = s.season_num
                            WHERE (LOWER(COALESCE(l.slug, '')) = LOWER(%s) OR LOWER(s.league_id) = LOWER(%s))
                              AND s.season_num = %s
                              AND s.pod_num = %s;
                        """, (lg_key, lg_key, int(s_num), int(p_num)))
                    else:
                        cur.execute("""
                            SELECT s.league_id, COALESCE(l.slug, s.league_id) AS league_slug,
                                   COALESCE(l.name, s.league_id) AS league_name,
                                   COALESCE(l.game_system, '40k') AS game_system,
                                   s.season_num, s.pod_num, s.player_name, s.primary_faction,
                                   s.bcp_player_id, s.player_id, s.user_id, s.pairings_json,
                                   COALESCE(ls.start_date::timestamptz, s.updated_at) AS event_date
                            FROM native_league_standings s
                            LEFT JOIN native_leagues l ON l.id = s.league_id OR l.slug = s.league_id
                            LEFT JOIN native_league_seasons ls ON ls.league_id = s.league_id AND ls.season_num = s.season_num
                            WHERE (LOWER(COALESCE(l.slug, '')) = LOWER(%s) OR LOWER(s.league_id) = LOWER(%s))
                              AND s.pod_num = %s
                            ORDER BY s.season_num DESC;
                        """, (lg_key, lg_key, int(p_num)))
                    rows = [dict(r) for r in (cur.fetchall() or [])]
                    fallback_cand = None
                    for r in rows:
                        p_json = r.get("pairings_json")
                        if isinstance(p_json, str):
                            try:
                                p_json = json.loads(p_json)
                            except Exception:
                                p_json = []
                        if not isinstance(p_json, list):
                            continue
                        for pr in p_json:
                            if not isinstance(pr, dict):
                                continue
                            if int(pr.get("round") or 0) == int(round_num):
                                p1_sc, p2_sc = _parse_league_pairing_scores(pr)
                                slug_val = r.get("league_slug") or lg_key
                                sn_val = int(r.get("season_num") or s_num or 1)
                                pn_val = int(r.get("pod_num") or p_num or 1)
                                canon_ev_id = f"LEAGUE:{slug_val}:S{sn_val}:P{pn_val}"
                                p1_id_val = r.get("player_id") or r.get("bcp_player_id") or r.get("user_id")
                                p1_nm_val = r.get("player_name") or "Player 1"
                                p2_id_val = pr.get("opponent_bcp_player_id") or pr.get("opponent_user_id")
                                p2_nm_val = pr.get("opponent_clean_name") or pr.get("opponent_name") or pr.get("scheduled_opponent_name") or "Player 2"
                                cand = {
                                    "id": f"{canon_ev_id}-R{round_num}",
                                    "event_id": canon_ev_id,
                                    "event_name": f"{r.get('league_name') or slug_val} • Season {sn_val} (Pod {pn_val})",
                                    "event_date": r.get("event_date"),
                                    "game_system": r.get("game_system") or "40k",
                                    "round": int(round_num),
                                    "table_number": pn_val,
                                    "player1_id": p1_id_val,
                                    "player1_name": p1_nm_val,
                                    "player1_faction": r.get("primary_faction") or "",
                                    "player1_score": p1_sc,
                                    "player2_id": p2_id_val,
                                    "player2_name": p2_nm_val,
                                    "player2_faction": pr.get("opponent_faction") or "",
                                    "player2_score": p2_sc,
                                    "is_bye": False,
                                    "is_done": bool(pr.get("is_completed") or p1_sc is not None),
                                }
                                if user and (
                                    check_user_matches_player(user, p1_nm_val, p1_id_val)
                                    or check_user_matches_player(user, p2_nm_val, p2_id_val)
                                ):
                                    return cand
                                if fallback_cand is None:
                                    fallback_cand = cand
                    if fallback_cand is not None:
                        return fallback_cand
        except Exception as e:
            logger.warning(f"Notice looking up league pairing ({event_id}, R{round_num}, T{table_num}): {e}")
        return None

    ev_variants = _event_id_variants(event_id)
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
                    WHERE m.event_id = ANY(%s)
                      AND m.round = %s
                      AND m.table_number = %s
                    LIMIT 1;
                """, (ev_variants, int(round_num), int(table_num)))
                row = cur.fetchone()
                if not row:
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
                    WHERE id = ANY(%s) OR LOWER(id) = LOWER(%s)
                    LIMIT 1;
                """, (ev_variants, event_id.strip()))
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
    ev_variants = _event_id_variants(ev_real_id)
    try:
        with db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT match_id, is_finished,
                           COALESCE((state_json->>'event_match_locked')::boolean, FALSE) AS event_match_locked
                    FROM tracker_games
                    WHERE event_id = ANY(%s)
                      AND round_num = %s
                      AND table_num = %s
                      AND UPPER(match_id) != UPPER(%s)
                    ORDER BY is_finished DESC, updated_at DESC
                    LIMIT 1;
                """, (ev_variants, int(r_num), int(t_num), str(exclude_match_id)))
                conflict_row = cur.fetchone()
                if conflict_row:
                    c_locked = bool(conflict_row.get("is_finished") or conflict_row.get("event_match_locked"))
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


def _parse_date_to_ordinal(val: Any) -> Optional[int]:
    if not val:
        return None
    if hasattr(val, "toordinal"):
        try:
            return int(val.toordinal())
        except Exception:
            pass
    s = str(val).strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        try:
            return datetime.strptime(s[:10], "%Y-%m-%d").toordinal()
        except Exception:
            pass
    for fmt in ("%b %d, %Y", "%B %d, %Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s[:20], fmt).toordinal()
        except Exception:
            pass
    return None


def _resolve_user_mappable_player_ids(cur: Any, user: Dict[str, Any], u_ids: List[str], u_names: List[str]) -> List[str]:
    """Resolves canonical player_id and player_name values for the user via indexed lookups (cached for 10 min)."""
    now_ts = time.time()
    cache_key = f"{'|'.join(sorted(u_ids))}::{'|'.join(sorted(u_names))}"
    cached = _USER_PLAYER_IDS_CACHE.get(cache_key)
    if cached and (now_ts - cached[0]) < 600.0:
        for nm in cached[2]:
            if nm and nm not in u_names:
                u_names.append(nm)
        if cached[2] and isinstance(user, dict) and not user.get("competitor_name"):
            user["competitor_name"] = cached[2][0].title()
        return list(cached[1])

    resolved = list(u_ids)
    resolved_names = list(u_names)

    # Step 1: Discover canonical competitor full_name from linked player_id(s) (e.g., OAuth "Jun Hsieh" -> BCP "John Hsieh")
    if resolved:
        try:
            cur.execute("""
                SELECT DISTINCT LOWER(TRIM(full_name)) AS nm
                FROM players
                WHERE id = ANY(%s)
                  AND full_name IS NOT NULL
                  AND TRIM(full_name) != ''
                LIMIT 10;
            """, (resolved,))
            for r in (cur.fetchall() or []):
                nm = str((r.get("nm") if isinstance(r, dict) else r[0]) or "").strip().lower()
                if nm and nm not in ("player", "player 1", "player 2", "unknown") and nm not in resolved_names:
                    resolved_names.append(nm)
        except Exception:
            pass
        try:
            cur.execute("""
                SELECT DISTINCT LOWER(TRIM(player_name)) AS nm
                FROM player_ratings
                WHERE player_id = ANY(%s)
                  AND player_name IS NOT NULL
                  AND TRIM(player_name) != ''
                LIMIT 10;
            """, (resolved,))
            for r in (cur.fetchall() or []):
                nm = str((r.get("nm") if isinstance(r, dict) else r[0]) or "").strip().lower()
                if nm and nm not in ("player", "player 1", "player 2", "unknown") and nm not in resolved_names:
                    resolved_names.append(nm)
        except Exception:
            pass

    # Step 2: Resolve all player_id aliases matching any known name via idx_pg_ratings_player_name_lower / idx_pg_ratings_player_name_btree
    if resolved_names:
        name_variants = []
        for n in resolved_names:
            for v in (n, n.title(), n.upper()):
                if v and v not in name_variants:
                    name_variants.append(v)
        try:
            cur.execute("""
                SELECT DISTINCT player_id
                FROM player_ratings
                WHERE (LOWER(TRIM(player_name)) = ANY(%s) OR player_name = ANY(%s))
                  AND player_id IS NOT NULL
                  AND player_id != ''
                LIMIT 35;
            """, (resolved_names, name_variants))
            for pr_row in (cur.fetchall() or []):
                pid = str((pr_row.get("player_id") if isinstance(pr_row, dict) else pr_row[0]) or "").strip()
                if pid and pid not in resolved:
                    resolved.append(pid)
        except Exception:
            pass

    for nm in resolved_names:
        if nm and nm not in u_names:
            u_names.append(nm)
    if resolved_names and isinstance(user, dict) and not user.get("competitor_name"):
        user["competitor_name"] = resolved_names[0].title()

    _USER_PLAYER_IDS_CACHE[cache_key] = (now_ts, resolved, resolved_names)
    return resolved


@router.get("/api/tracker/mappable_event_matches", summary="List tournament pairings where the authenticated user is a participant")
def api_get_mappable_event_matches(
    request: Request,
    match_id: Optional[str] = None,
    search: Optional[str] = None,
    game_system: Optional[str] = None,
    limit: int = 500,
):
    user = _resolve_importing_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required to map games to tournament matches.")

    db = get_database()
    target_game = None
    source_game_summary = None
    norm_mid = normalize_tracker_match_id(match_id) if match_id else None

    u_ids = []
    for k in ("id", "user_id", "player_id", "bcp_user_id", "bcp_id"):
        v = user.get(k)
        if v and str(v).strip() and str(v).strip() not in u_ids:
            u_ids.append(str(v).strip())

    u_names = []
    for k in ("display_name", "name", "username", "competitor_name"):
        v = user.get(k)
        if v and str(v).strip().lower() not in u_names:
            u_names.append(str(v).strip().lower())

    sys_val = None
    if game_system and game_system.lower() in ("40k", "aos"):
        sys_val = "aos" if "aos" in game_system.lower() else "40k"

    safe_limit = max(50, min(1000, int(limit)))
    search_clean = (search or "").strip().lower()

    from psycopg2 import extras
    candidates: List[Dict[str, Any]] = []
    seen_keys = set()

    try:
        with db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                # 1. Lightweight scalar lookup for target_game (avoids fetching/parsing full state_json blob)
                if norm_mid:
                    try:
                        cur.execute("""
                            SELECT match_id, p1_name, p2_name, p1_faction, p2_faction,
                                   p1_score, p2_score, primary_mission, user_id_p1, user_id_p2,
                                   updated_at, created_at,
                                   state_json->>'edition' AS edition,
                                   state_json->>'edition_label' AS edition_label,
                                   state_json->>'game_date' AS game_date,
                                   state_json->'game'->>'p1Name' AS g_p1_name,
                                   state_json->'game'->>'p2Name' AS g_p2_name,
                                   state_json->'game'->>'p1Faction' AS g_p1_faction,
                                   state_json->'game'->>'p2Faction' AS g_p2_faction,
                                   state_json->'game'->>'primary' AS g_primary
                            FROM tracker_games
                            WHERE match_id = %s
                            LIMIT 1;
                        """, (norm_mid,))
                        tg_meta = cur.fetchone()
                        if tg_meta:
                            tg_d = dict(tg_meta)
                            raw_dt = tg_d.get("game_date") or tg_d.get("updated_at") or tg_d.get("created_at")
                            dt_str = raw_dt.strftime("%b %d, %Y") if hasattr(raw_dt, "strftime") else (str(raw_dt)[:10] if raw_dt else "")
                            p1_nm = tg_d.get("p1_name") or tg_d.get("g_p1_name") or "Player 1"
                            p2_nm = tg_d.get("p2_name") or tg_d.get("g_p2_name") or "Player 2"
                            p1_fc = tg_d.get("p1_faction") or tg_d.get("g_p1_faction") or ""
                            p2_fc = tg_d.get("p2_faction") or tg_d.get("g_p2_faction") or ""
                            p1_sc = tg_d.get("p1_score") if tg_d.get("p1_score") is not None else 0
                            p2_sc = tg_d.get("p2_score") if tg_d.get("p2_score") is not None else 0
                            prim_m = tg_d.get("primary_mission") or tg_d.get("g_primary") or ""
                            target_game = {
                                "match_id": tg_d.get("match_id") or norm_mid,
                                "p1_name": p1_nm,
                                "p2_name": p2_nm,
                                "p1_faction": p1_fc,
                                "p2_faction": p2_fc,
                                "p1_score": p1_sc,
                                "p2_score": p2_sc,
                                "user_id_p1": tg_d.get("user_id_p1"),
                                "user_id_p2": tg_d.get("user_id_p2"),
                                "game_date": raw_dt,
                                "state": {},
                            }
                            source_game_summary = {
                                "match_id": target_game["match_id"],
                                "p1_name": p1_nm,
                                "p2_name": p2_nm,
                                "p1_faction": p1_fc,
                                "p2_faction": p2_fc,
                                "p1_score": p1_sc,
                                "p2_score": p2_sc,
                                "primary_mission": prim_m,
                                "edition": tg_d.get("edition") or "10th",
                                "edition_label": tg_d.get("edition_label") or "",
                                "game_date": dt_str,
                            }
                    except Exception:
                        conn.rollback()

                if norm_mid and not target_game and hasattr(db, "get_tracker_game"):
                    target_game = db.get_tracker_game(norm_mid)
                    if target_game:
                        t_st = target_game.get("state") if isinstance(target_game.get("state"), dict) else {}
                        t_g = t_st.get("game") if isinstance(t_st.get("game"), dict) else {}
                        t_p1 = t_st.get("p1") if isinstance(t_st.get("p1"), dict) else {}
                        t_p2 = t_st.get("p2") if isinstance(t_st.get("p2"), dict) else {}
                        raw_dt = t_st.get("game_date") or target_game.get("updated_at") or target_game.get("created_at")
                        dt_str = raw_dt.strftime("%b %d, %Y") if hasattr(raw_dt, "strftime") else (str(raw_dt)[:10] if raw_dt else "")
                        target_game["game_date"] = raw_dt
                        source_game_summary = {
                            "match_id": target_game.get("match_id") or norm_mid,
                            "p1_name": target_game.get("p1_name") or t_g.get("p1Name") or t_p1.get("name") or "Player 1",
                            "p2_name": target_game.get("p2_name") or t_g.get("p2Name") or t_p2.get("name") or "Player 2",
                            "p1_faction": target_game.get("p1_faction") or t_g.get("p1Faction") or t_p1.get("faction") or "",
                            "p2_faction": target_game.get("p2_faction") or t_g.get("p2Faction") or t_p2.get("faction") or "",
                            "p1_score": target_game.get("p1_score") if target_game.get("p1_score") is not None else (t_st.get("p1Score") or t_p1.get("score") or 0),
                            "p2_score": target_game.get("p2_score") if target_game.get("p2_score") is not None else (t_st.get("p2Score") or t_p2.get("score") or 0),
                            "primary_mission": target_game.get("primary_mission") or t_g.get("primary") or "",
                            "edition": t_st.get("edition") or "10th",
                            "edition_label": t_st.get("edition_label") or "",
                            "game_date": dt_str,
                        }

                # 2. Resolve all player_ids and canonical names for this user
                resolved_u_ids = _resolve_user_mappable_player_ids(cur, user, u_ids, u_names)
                for extra_id in resolved_u_ids:
                    if extra_id not in u_ids:
                        u_ids.append(extra_id)

                if not resolved_u_ids and not u_names:
                    return {"success": True, "match_id": norm_mid, "source_game": source_game_summary, "matches": []}

                now_ts = time.time()
                base_cache_key = f"{'|'.join(sorted(resolved_u_ids))}::{'|'.join(sorted(u_names))}::{sys_val or 'all'}"
                cached_base = _MAPPABLE_BASE_MATCHES_CACHE.get(base_cache_key)
                base_rows: Optional[List[Dict[str, Any]]] = None
                if cached_base and (now_ts - cached_base[0]) < _MAPPABLE_CACHE_TTL_SEC:
                    base_rows = cached_base[1]

                if base_rows is None:
                    base_rows = []
                    if resolved_u_ids:
                        sys_where = "WHERE COALESCE(e.game_system, cm.game_system, '40k') = %s" if sys_val else ""
                        q_params: List[Any] = [resolved_u_ids, resolved_u_ids]
                        if sys_val:
                            q_params.append(sys_val)
                        q_params.append(800)
                        cur.execute(f"""
                            WITH p1_matches AS (
                                SELECT m.id, m.event_id, m.round, m.table_number, m.match_date,
                                       m.player1_id, m.player1_name, m.player1_faction, m.player1_score,
                                       m.player2_id, m.player2_name, m.player2_faction, m.player2_score,
                                       m.is_done, m.game_system
                                FROM matches m
                                WHERE m.player1_id = ANY(%s)
                                  AND COALESCE(m.is_bye, FALSE) = FALSE
                                ORDER BY m.match_date DESC NULLS LAST, m.round DESC
                                LIMIT 600
                            ),
                            p2_matches AS (
                                SELECT m.id, m.event_id, m.round, m.table_number, m.match_date,
                                       m.player1_id, m.player1_name, m.player1_faction, m.player1_score,
                                       m.player2_id, m.player2_name, m.player2_faction, m.player2_score,
                                       m.is_done, m.game_system
                                FROM matches m
                                WHERE m.player2_id = ANY(%s)
                                  AND COALESCE(m.is_bye, FALSE) = FALSE
                                ORDER BY m.match_date DESC NULLS LAST, m.round DESC
                                LIMIT 600
                            ),
                            combined AS (
                                SELECT * FROM p1_matches
                                UNION ALL
                                SELECT * FROM p2_matches
                            )
                            SELECT cm.id, cm.event_id, cm.round, cm.table_number, cm.match_date,
                                   cm.player1_id, cm.player1_name, cm.player1_faction, cm.player1_score,
                                   cm.player2_id, cm.player2_name, cm.player2_faction, cm.player2_score,
                                   cm.is_done,
                                   COALESCE(e.name, cm.event_id) AS event_name,
                                   e.event_date,
                                   COALESCE(e.game_system, cm.game_system, '40k') AS game_system
                            FROM combined cm
                            LEFT JOIN events e ON e.id = cm.event_id
                            {sys_where}
                            ORDER BY COALESCE(e.event_date, cm.match_date) DESC NULLS LAST, cm.round DESC, cm.table_number ASC
                            LIMIT %s;
                        """, tuple(q_params))
                        base_rows = [dict(r) for r in (cur.fetchall() or [])]

                    # Also include Pod League matches (SD40K, The Gauntlet, etc.) where the user is a participant
                    if resolved_u_ids or u_names:
                        try:
                            cur.execute("""
                                SELECT s.league_id, COALESCE(l.slug, s.league_id) AS league_slug,
                                       COALESCE(l.name, s.league_id) AS league_name,
                                       COALESCE(l.game_system, '40k') AS game_system,
                                       s.season_num, s.pod_num, s.player_name, s.primary_faction,
                                       s.bcp_player_id, s.player_id, s.user_id, s.pairings_json,
                                       COALESCE(ls.start_date::timestamptz, s.updated_at) AS event_date
                                FROM native_league_standings s
                                LEFT JOIN native_leagues l ON l.id = s.league_id OR l.slug = s.league_id
                                LEFT JOIN native_league_seasons ls ON ls.league_id = s.league_id AND ls.season_num = s.season_num
                                WHERE (
                                    s.user_id = ANY(%s)
                                    OR s.player_id = ANY(%s)
                                    OR s.bcp_player_id = ANY(%s)
                                    OR LOWER(TRIM(s.player_name)) = ANY(%s)
                                )
                                ORDER BY s.season_num DESC, s.pod_num ASC
                                LIMIT 30;
                            """, (resolved_u_ids, resolved_u_ids, resolved_u_ids, u_names))
                            lg_rows = [dict(r) for r in (cur.fetchall() or [])]
                            seen_lg_sigs = set()
                            for lr in lg_rows:
                                lg_sys = str(lr.get("game_system") or "40k").lower()
                                if sys_val and lg_sys != sys_val:
                                    continue
                                p_json = lr.get("pairings_json")
                                if isinstance(p_json, str):
                                    try:
                                        p_json = json.loads(p_json)
                                    except Exception:
                                        p_json = []
                                if not isinstance(p_json, list):
                                    continue
                                slug_val = str(lr.get("league_slug") or lr.get("league_id") or "league").strip()
                                sn_val = int(lr.get("season_num") or 1)
                                pn_val = int(lr.get("pod_num") or 1)
                                p1_nm = str(lr.get("player_name") or "Player 1").strip()
                                p1_id_val = lr.get("player_id") or lr.get("bcp_player_id") or lr.get("user_id")
                                for pr in p_json:
                                    if not isinstance(pr, dict):
                                        continue
                                    r_num = int(pr.get("round") or 1)
                                    opp_nm = str(pr.get("opponent_clean_name") or pr.get("opponent_name") or pr.get("scheduled_opponent_name") or "").strip()
                                    if not opp_nm or opp_nm.lower() in ("bye", "tbd", "unassigned"):
                                        continue
                                    sig = (slug_val.lower(), pn_val, r_num, p1_nm.lower(), opp_nm.lower())
                                    if sig in seen_lg_sigs:
                                        continue
                                    seen_lg_sigs.add(sig)
                                    p1_sc, p2_sc = _parse_league_pairing_scores(pr)
                                    canon_ev_id = f"LEAGUE:{slug_val}:S{sn_val}:P{pn_val}"
                                    base_rows.append({
                                        "id": f"{canon_ev_id}-R{r_num}",
                                        "event_id": canon_ev_id,
                                        "event_name": f"{lr.get('league_name') or slug_val} • Season {sn_val} (Pod {pn_val})",
                                        "event_date": lr.get("event_date"),
                                        "match_date": lr.get("event_date"),
                                        "game_system": lg_sys,
                                        "round": r_num,
                                        "table_number": pn_val,
                                        "player1_id": p1_id_val,
                                        "player1_name": p1_nm,
                                        "player1_faction": lr.get("primary_faction") or "",
                                        "player1_score": p1_sc,
                                        "player2_id": pr.get("opponent_bcp_player_id") or pr.get("opponent_user_id"),
                                        "player2_name": opp_nm,
                                        "player2_faction": pr.get("opponent_faction") or "",
                                        "player2_score": p2_sc,
                                        "is_done": bool(pr.get("is_completed") or p1_sc is not None),
                                        "existing_scorecard_id": pr.get("scorecard_id"),
                                    })
                        except Exception:
                            conn.rollback()

                    _MAPPABLE_BASE_MATCHES_CACHE[base_cache_key] = (now_ts, base_rows)

                # Filter by search query in memory (instant on <=800 rows)
                if search_clean:
                    filtered_rows = [
                        r for r in base_rows
                        if search_clean in str(r.get("event_name") or "").lower()
                        or search_clean in str(r.get("event_id") or "").lower()
                        or search_clean in str(r.get("player1_name") or "").lower()
                        or search_clean in str(r.get("player2_name") or "").lower()
                        or search_clean in str(r.get("player1_faction") or "").lower()
                        or search_clean in str(r.get("player2_faction") or "").lower()
                    ][:safe_limit]
                else:
                    filtered_rows = base_rows[:safe_limit]

                # 3. Batch-lookup existing tracker_games mappings using idx_tracker_games_evt (no lateral full-table scan)
                locked_map: Dict[Tuple[str, int, int], Dict[str, Any]] = {}
                ev_id_set = set()
                for r in filtered_rows:
                    for v in _event_id_variants(r.get("event_id") or ""):
                        ev_id_set.add(v)
                if ev_id_set:
                    cur.execute("""
                        SELECT match_id, event_id, round_num, table_num, is_finished,
                               COALESCE((state_json->>'event_match_locked')::boolean, FALSE) AS existing_tracker_locked
                        FROM tracker_games
                        WHERE event_id = ANY(%s)
                          AND round_num IS NOT NULL
                          AND table_num IS NOT NULL
                        ORDER BY
                          COALESCE((state_json->>'event_match_locked')::boolean, FALSE) DESC,
                          CASE WHEN COALESCE(state_json->>'imported_source', '') != '' OR match_id LIKE '%%-TTB-%%' OR match_id LIKE '%%-GW-%%' THEN 1 ELSE 0 END DESC,
                          is_finished DESC,
                          updated_at DESC;
                    """, (list(ev_id_set),))
                    for tg_r in (cur.fetchall() or []):
                        tg_d = dict(tg_r)
                        k = (
                            str(tg_d.get("event_id") or "").lower(),
                            int(tg_d.get("round_num") or 1),
                            int(tg_d.get("table_num") or 1),
                        )
                        if k not in locked_map:
                            locked_map[k] = tg_d

                user_id_set = set(resolved_u_ids)
                tg_ord = _parse_date_to_ordinal(target_game.get("game_date") if target_game else (source_game_summary.get("game_date") if source_game_summary else None))

                for d in filtered_rows:
                    ev_id = str(d.get("event_id") or "")
                    r_num = int(d.get("round") or 1)
                    t_num = int(d.get("table_number") or 1)
                    key = (ev_id.lower(), r_num, t_num)
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)

                    p1_id_str = str(d.get("player1_id") or "").strip()
                    p2_id_str = str(d.get("player2_id") or "").strip()
                    is_p1 = (p1_id_str in user_id_set) or check_user_matches_player(user, d.get("player1_name"), p1_id_str or None)
                    is_p2 = (p2_id_str in user_id_set) or check_user_matches_player(user, d.get("player2_name"), p2_id_str or None)
                    if not (is_p1 or is_p2):
                        continue

                    tg_info = locked_map.get(key) or {}
                    existing_mid = tg_info.get("match_id") or d.get("existing_scorecard_id")
                    is_currently_mapped = bool(norm_mid and existing_mid and str(existing_mid).upper() == norm_mid.upper())
                    is_locked = bool(
                        existing_mid
                        and not is_currently_mapped
                        and (tg_info.get("existing_tracker_locked") or tg_info.get("is_finished") or d.get("existing_scorecard_id"))
                    )

                    ev_dt = d.get("event_date") or d.get("match_date")
                    date_str = ev_dt.strftime("%b %d, %Y") if hasattr(ev_dt, "strftime") else (str(ev_dt)[:10] if ev_dt else "")
                    sort_iso = ev_dt.strftime("%Y-%m-%d") if hasattr(ev_dt, "strftime") else (str(ev_dt)[:10] if ev_dt else "")

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
                        user_name_in_event = str((d.get("player1_name") if is_p1 else d.get("player2_name")) or "")
                        opp_name_in_event = str((d.get("player2_name") if is_p1 else d.get("player1_name")) or "")
                        tg_p1_nm = str(target_game.get("p1_name") or "")
                        tg_p2_nm = str(target_game.get("p2_name") or "")

                        # Identify which scorecard slot is the user so we don't match the user's own first name ("John") against opponents named "John"
                        p1_is_user = _names_roughly_match(tg_p1_nm, user_name_in_event) or check_user_matches_player(user, tg_p1_nm, target_game.get("user_id_p1"))
                        p2_is_user = _names_roughly_match(tg_p2_nm, user_name_in_event) or check_user_matches_player(user, tg_p2_nm, target_game.get("user_id_p2"))
                        if p1_is_user and not p2_is_user:
                            opp_matched = _names_roughly_match(tg_p2_nm, opp_name_in_event)
                        elif p2_is_user and not p1_is_user:
                            opp_matched = _names_roughly_match(tg_p1_nm, opp_name_in_event)
                        else:
                            opp_matched = _names_roughly_match(tg_p1_nm, opp_name_in_event) or _names_roughly_match(tg_p2_nm, opp_name_in_event)

                        if opp_matched:
                            relevance += 50
                        if d.get("player1_score") is not None and d.get("player2_score") is not None:
                            ev_s1, ev_s2 = int(d["player1_score"] or 0), int(d["player2_score"] or 0)
                            tg_s1, tg_s2 = int(target_game.get("p1_score") or 0), int(target_game.get("p2_score") or 0)
                            if (ev_s1 == tg_s1 and ev_s2 == tg_s2) or (ev_s1 == tg_s2 and ev_s2 == tg_s1):
                                relevance += 40
                        if tg_ord is not None:
                            ev_ord = _parse_date_to_ordinal(ev_dt)
                            if ev_ord is not None and abs(tg_ord - ev_ord) <= 4:
                                relevance += 35

                    candidates.append({
                        "event_id": ev_id,
                        "event_name": d.get("event_name") or ev_id,
                        "event_date": date_str,
                        "match_date": date_str,
                        "sort_date": sort_iso,
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
                        "recommended": bool(relevance >= 50 and not is_locked),
                    })
    except Exception as e:
        logger.warning(f"Error querying mappable event matches: {e}")

    candidates.sort(
        key=lambda x: (
            x.get("is_currently_mapped", False),
            not x.get("is_locked", False),
            x.get("relevance", 0),
            x.get("sort_date", ""),
            int(x.get("round") or 0),
        ),
        reverse=True,
    )
    return {
        "success": True,
        "match_id": norm_mid,
        "source_game": source_game_summary,
        "matches": candidates,
    }


@router.post("/api/tracker/games/{match_id}/map_event_match", summary="Map an imported or completed scorecard to a tournament match")
def api_map_tracker_game_to_event_match(
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

    # 0. Enrich user with canonical BCP competitor_name / resolved player_ids if needed
    u_ids = [str(user.get(k)).strip() for k in ("id", "user_id", "player_id", "bcp_user_id", "bcp_id") if user.get(k) and str(user.get(k)).strip()]
    u_names = [str(user.get(k)).strip().lower() for k in ("display_name", "name", "username", "competitor_name") if user.get(k) and str(user.get(k)).strip()]
    try:
        from psycopg2 import extras
        with db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                resolved_u_ids = _resolve_user_mappable_player_ids(cur, user, u_ids, u_names)
    except Exception:
        resolved_u_ids = list(u_ids)
    user_id_set = set(resolved_u_ids)

    # 1. Verify the tournament pairing exists
    pairing = _lookup_event_pairing_record(db, ev_id, r_num, t_num, user=user)
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
    user_is_p1 = (str(ev_p1_id or "").strip() in user_id_set) or check_user_matches_player(user, ev_p1_name, ev_p1_id)
    user_is_p2 = (str(ev_p2_id or "").strip() in user_id_set) or check_user_matches_player(user, ev_p2_name, ev_p2_id)
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

    # Invalidate event details & mappable matches caches so Tournament Standings / Pairings reflect the mapped scorecard immediately
    _invalidate_mappable_matches_cache()
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
def api_unmap_tracker_game_from_event_match(
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
    _invalidate_mappable_matches_cache()
    try:
        if hasattr(db, "_event_details_cache_dict") and isinstance(db._event_details_cache_dict, dict):
            db._event_details_cache_dict.clear()
    except Exception:
        pass

    return {"success": True, "match_id": actual_mid, "event_match_locked": False}



@router.get("/api/tracker/debug/test_save", summary="Diagnostics endpoint to test DB writes to tracker_games")
def api_tracker_debug_test_save(request: Request):
    _get_admin_session_or_403(request)
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

    user = getattr(request, "_mock_user", None) if (request and isinstance(getattr(request, "_mock_user", None), dict)) else None
    if user is None:
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "") if hasattr(request, "headers") else ""
        session_token = (request.cookies.get("session_token") if hasattr(request, "cookies") else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
    user_id = user["id"] if user else None
    guest_id = _extract_guest_id(request, body=body)
    effective_uid = user_id or guest_id

    fs_engine = get_firestore_engine()
    if match_id not in TRACKER_ROOMS:
        fs_doc = fs_engine.get_room(match_id) if fs_engine else None
        if fs_doc and isinstance(fs_doc, dict):
            TRACKER_ROOMS[match_id] = {
                "match_id": match_id,
                "user_id_p1": fs_doc.get("user_id_p1"),
                "user_id_p2": fs_doc.get("user_id_p2"),
                "referee_ids": fs_doc.get("referee_ids", []),
                "state": fs_doc.get("state", {}),
                "version": fs_doc.get("version", 1),
                "p1_army_list": fs_doc.get("p1_army_list"),
                "p2_army_list": fs_doc.get("p2_army_list")
            }
        else:
            TRACKER_ROOMS[match_id] = {
                "match_id": match_id,
                "state": {},
                "version": 1
            }

    room = TRACKER_ROOMS[match_id]
    if effective_uid:
        if role == "player1" and not room.get("user_id_p1"):
            room["user_id_p1"] = effective_uid
        elif role == "player2" and not room.get("user_id_p2"):
            room["user_id_p2"] = effective_uid
    is_p1, is_p2 = _maybe_rebind_guest_seat(
        room, effective_uid, role=role, fs_engine=fs_engine, match_id=match_id
    )
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
    is_ref = bool(user and (user_id in room.get("referee_ids", []) or user.get("role") in ("admin", "referee", "to", "organizer") or user.get("is_admin") or user.get("can_access_to")))
    if is_tournament:
        is_tournament_staff = check_user_is_tournament_staff(user, room, match_id=match_id)
        if not (is_p1 or is_p2 or is_tournament_staff):
            raise HTTPException(status_code=403, detail="Permission denied: Spectators cannot attach army lists.")
        is_ref = is_tournament_staff
    elif has_assigned_players and match_id not in ("MATCH", "AOS-LOCAL"):
        if not (is_p1 or is_p2 or is_ref):
            raise HTTPException(status_code=403, detail="Permission denied: Spectators cannot attach army lists.")
        # Prevent Guest Player 2 from overwriting Player 1's army list when Player 1 is a distinct user
        if user is None and guest_id:
            if role == "player1" and room.get("user_id_p1") and not is_p1:
                raise HTTPException(status_code=403, detail="Permission denied: Guest Player 2 cannot overwrite Player 1 army list.")
            if role == "player2" and room.get("user_id_p2") and not is_p2:
                raise HTTPException(status_code=403, detail="Permission denied: Guest cannot overwrite opponent army list.")

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
def api_tracker_get_armylists(match_id: str):
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

    user = getattr(request, "_mock_user", None) if (request and isinstance(getattr(request, "_mock_user", None), dict)) else None
    if user is None:
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "") if hasattr(request, "headers") else ""
        session_token = (request.cookies.get("session_token") if hasattr(request, "cookies") else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
    user_id = user["id"] if user else None
    guest_id = _extract_guest_id(request, body=body)
    effective_uid = user_id or guest_id

    fs_engine = get_firestore_engine()
    if fs_engine.is_room_discarded(match_id):
        return {"success": False, "status": "abandoned", "is_abandoned": True}

    if match_id not in TRACKER_ROOMS:
        fs_doc = fs_engine.get_room(match_id) if fs_engine else None
        if fs_doc and isinstance(fs_doc, dict):
            TRACKER_ROOMS[match_id] = {
                "match_id": match_id,
                "user_id_p1": fs_doc.get("user_id_p1"),
                "user_id_p2": fs_doc.get("user_id_p2"),
                "referee_ids": fs_doc.get("referee_ids", []),
                "state": fs_doc.get("state", {}),
                "version": fs_doc.get("version", 1)
            }
        else:
            TRACKER_ROOMS[match_id] = {
                "match_id": match_id,
                "state": {},
                "version": 1
            }

    room = TRACKER_ROOMS[match_id]
    is_p1, is_p2 = _maybe_rebind_guest_seat(
        room, effective_uid, role=body.get("role") if isinstance(body, dict) else None, fs_engine=fs_engine, match_id=match_id
    )
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


@router.post("/api/tracker/room/{match_id}/share_chat", summary="Share live Game Tracker room invite directly in OmniTactica Chat")
def api_tracker_share_chat(match_id: str, payload: TrackerShareChatPayload, request: Request):
    match_id = normalize_tracker_match_id(match_id)
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required to share in OmniTactica Chat")

    db = get_database()
    fs_engine = get_firestore_engine()
    sender_id = user["id"]
    sender_name = user.get("display_name") or user.get("email") or "Player 1"
    msg_text = (payload.message or "").strip() or f"⚔️ Join my live Game Tracker room ({match_id})!"

    req_id = (payload.request_id or "").strip()
    receiver_id = (payload.receiver_id or "").strip()

    # 1. If sharing to a group chat (grp_league_* or grp_pod_*)
    if req_id.lower().startswith("grp_league_") or req_id.lower().startswith("grp_pod_"):
        import leagues_hub_service
        svc = leagues_hub_service.get_leagues_hub_service()
        res = svc.send_group_chat_message(
            channel_id=req_id,
            sender_id=sender_id,
            sender_name=sender_name,
            message_text=msg_text,
            room_key=match_id
        )
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to share room in group chat"))
        return {"success": True, "request_id": req_id, "match_id": match_id, "message_id": res.get("message_id")}

    # 2. If receiver_id is provided without an active accepted request_id, find or create an accepted thread
    if not req_id and receiver_id:
        if str(receiver_id) == str(sender_id):
            raise HTTPException(status_code=400, detail="Cannot share a match room to yourself")
        try:
            with db.get_connection() as conn:
                with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                    cursor.execute("""
                        SELECT id, status FROM match_requests
                        WHERE ((sender_id = %s AND receiver_id = %s) OR (sender_id = %s AND receiver_id = %s))
                          AND status IN ('pending', 'accepted')
                        ORDER BY updated_at DESC LIMIT 1;
                    """, (sender_id, receiver_id, receiver_id, sender_id))
                    existing = cursor.fetchone()
                    if existing:
                        req_id = existing["id"]
                        if existing["status"] != "accepted":
                            cursor.execute("UPDATE match_requests SET status = 'accepted', updated_at = NOW() WHERE id = %s;", (req_id,))
                            conn.commit()
                    else:
                        import uuid
                        req_id = f"mrq_{uuid.uuid4().hex[:16]}"
                        cursor.execute("""
                            INSERT INTO match_requests (
                                id, sender_id, receiver_id, status, proposed_venue,
                                proposed_points, proposed_date, note, created_at, updated_at
                            ) VALUES (%s, %s, %s, 'accepted', 'Game Tracker Match', 2000, '', %s, NOW(), NOW());
                        """, (req_id, sender_id, receiver_id, msg_text))
                        conn.commit()
        except Exception as e:
            logger.warning(f"Error resolving/creating chat thread for share_chat: {e}")
            raise HTTPException(status_code=400, detail="Could not open chat thread with selected user")

    if not req_id:
        raise HTTPException(status_code=400, detail="Either request_id or receiver_id is required")

    # Ensure if the thread was 'pending', sharing a room invite activates it so the message can be delivered
    try:
        with db.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "UPDATE match_requests SET status = 'accepted', updated_at = NOW() WHERE id = %s AND status = 'pending' AND (sender_id = %s OR receiver_id = %s);",
                    (req_id, sender_id, sender_id)
                )
                conn.commit()
    except Exception:
        pass

    res = db.send_chat_message(req_id, sender_id, msg_text, room_key=match_id)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to send room invite in chat"))

    try:
        from routers.connect import _invalidate_unread_count
        chat_info = db.get_chat_messages(req_id, sender_id)
        req_info = chat_info.get("request", {}) or {}
        s_uid = req_info.get("sender_id")
        r_uid = req_info.get("receiver_id")
        other_id = r_uid if s_uid == sender_id else s_uid
        _invalidate_unread_count([sender_id, other_id])

        msg_obj = {
            "id": res.get("message_id"),
            "request_id": req_id,
            "sender_id": sender_id,
            "sender_name": sender_name,
            "message_text": msg_text,
            "room_key": match_id,
            "created_at": res.get("created_at") or datetime.now(timezone.utc).isoformat()
        }
        fs_engine.append_chat_message(req_id, msg_obj)
        if other_id:
            fs_engine.notify_user_requests_updated([sender_id, other_id], reason="room_invite")
    except Exception as fs_e:
        logger.warning(f"Notice syncing shared room chat message to Firestore: {fs_e}")

    return {
        "success": True,
        "request_id": req_id,
        "match_id": match_id,
        "message_id": res.get("message_id")
    }

@router.post("/api/tracker/room/{match_id}/dice_tray", summary="Synchronize live tabletop dice tray across players")
async def api_tracker_sync_dice_tray(match_id: str, request: Request):
    match_id = normalize_tracker_match_id(match_id)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    if body.get("role") == "spectator":
        raise HTTPException(status_code=403, detail="Permission denied: Spectators cannot modify dice tray.")

    user = getattr(request, "_mock_user", None) if (request and isinstance(getattr(request, "_mock_user", None), dict)) else None
    if user is None:
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "") if hasattr(request, "headers") else ""
        session_token = (request.cookies.get("session_token") if hasattr(request, "cookies") else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
    user_id = user["id"] if user else None
    guest_id = _extract_guest_id(request, body=body)
    effective_uid = user_id or guest_id

    fs_engine = get_firestore_engine()
    if fs_engine.is_room_discarded(match_id):
        return {"success": False, "status": "abandoned", "is_abandoned": True}

    if match_id not in TRACKER_ROOMS:
        fs_doc = fs_engine.get_room(match_id) if fs_engine else None
        if fs_doc and isinstance(fs_doc, dict):
            TRACKER_ROOMS[match_id] = {
                "match_id": match_id,
                "user_id_p1": fs_doc.get("user_id_p1"),
                "user_id_p2": fs_doc.get("user_id_p2"),
                "referee_ids": fs_doc.get("referee_ids", []),
                "state": fs_doc.get("state", {}),
                "version": fs_doc.get("version", 1)
            }
        else:
            TRACKER_ROOMS[match_id] = {
                "match_id": match_id,
                "state": {},
                "version": 1
            }

    room = TRACKER_ROOMS[match_id]
    is_p1, is_p2 = _maybe_rebind_guest_seat(
        room, effective_uid, role=body.get("role") if isinstance(body, dict) else None, fs_engine=fs_engine, match_id=match_id
    )
    is_ref = bool(user and (user_id in room.get("referee_ids", []) or user.get("role") in ("admin", "referee", "to", "organizer") or user.get("is_admin") or user.get("can_access_to")))
    if room.get("user_id_p1") and room.get("user_id_p2") and effective_uid:
        if not (is_p1 or is_p2 or is_ref or check_user_is_tournament_staff(user, room, match_id=match_id)):
            raise HTTPException(status_code=403, detail="Permission denied: Spectators cannot modify dice tray.")

    raw_tray = body.get("tray", [])
    tray = raw_tray[:100] if isinstance(raw_tray, list) else []
    trays = body.get("trays")
    if isinstance(trays, dict):
        for p_key in ("p1", "p2"):
            if isinstance(trays.get(p_key), dict) and isinstance(trays[p_key].get("tray"), list):
                trays[p_key]["tray"] = trays[p_key]["tray"][:100]
    target = int(body.get("target", 0))
    history = body.get("history")
    if isinstance(history, list):
        history = history[-200:]

    if "state" not in room or not isinstance(room["state"], dict):
        room["state"] = {}
    room["state"]["dice_tray"] = tray
    room["state"]["dice_target"] = target
    room["dice_tray"] = tray
    room["dice_target"] = target
    if isinstance(trays, dict):
        room["state"]["dice_trays"] = trays
        room["dice_trays"] = trays
    if history is not None:
        room["state"]["dice_history"] = history
        room["dice_history"] = history

    # Sync to Firestore Native
    try:
        update_fields = {
            "dice_tray": tray,
            "dice_target": target
        }
        if isinstance(trays, dict):
            update_fields["dice_trays"] = trays
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
        "trays": room.get("dice_trays"),
        "target": target
    }
    if history is not None:
        msg["history"] = history
    for l_q in list(listeners):
        try:
            await l_q.put(msg)
        except Exception:
            pass

    return {"success": True, "tray": tray, "trays": room.get("dice_trays"), "target": target}

@router.post("/api/tracker/room/{match_id}/dice_roll", summary="Broadcast live dice roll to both players in room")
async def api_tracker_roll_dice(match_id: str, request: Request):
    match_id = normalize_tracker_match_id(match_id)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    if body.get("role") == "spectator":
        raise HTTPException(status_code=403, detail="Permission denied: Spectators cannot roll dice in this match.")

    user = getattr(request, "_mock_user", None) if (request and isinstance(getattr(request, "_mock_user", None), dict)) else None
    if user is None:
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "") if hasattr(request, "headers") else ""
        session_token = (request.cookies.get("session_token") if hasattr(request, "cookies") else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        user = auth_mgr.get_session(session_token) if session_token else None
    user_id = user["id"] if user else None
    guest_id = _extract_guest_id(request, body=body)
    effective_uid = user_id or guest_id

    fs_engine = get_firestore_engine()
    if fs_engine.is_room_discarded(match_id):
        return {"success": False, "status": "abandoned", "is_abandoned": True}

    if match_id not in TRACKER_ROOMS:
        fs_doc = fs_engine.get_room(match_id) if fs_engine else None
        if fs_doc and isinstance(fs_doc, dict):
            TRACKER_ROOMS[match_id] = {
                "match_id": match_id,
                "user_id_p1": fs_doc.get("user_id_p1"),
                "user_id_p2": fs_doc.get("user_id_p2"),
                "referee_ids": fs_doc.get("referee_ids", []),
                "state": fs_doc.get("state", {}),
                "version": fs_doc.get("version", 1)
            }
        else:
            TRACKER_ROOMS[match_id] = {
                "match_id": match_id,
                "state": {},
                "version": 1
            }

    room = TRACKER_ROOMS[match_id]
    is_p1, is_p2 = _maybe_rebind_guest_seat(
        room, effective_uid, role=body.get("role") if isinstance(body, dict) else None, fs_engine=fs_engine, match_id=match_id
    )
    is_ref = bool(user and (user_id in room.get("referee_ids", []) or user.get("role") in ("admin", "referee", "to", "organizer") or user.get("is_admin") or user.get("can_access_to")))
    if room.get("user_id_p1") and room.get("user_id_p2") and effective_uid:
        if not (is_p1 or is_p2 or is_ref or check_user_is_tournament_staff(user, room, match_id=match_id)):
            raise HTTPException(status_code=403, detail="Permission denied: Spectators cannot roll dice in this match.")

    raw_results = body.get("results") or []
    bounded_results = raw_results[:100] if isinstance(raw_results, list) else []
    roll_data = {
        "id": str(body.get("id") or f"roll_{int(datetime.now(timezone.utc).timestamp() * 1000)}")[:64],
        "player_name": str(body.get("player_name") or "Player")[:64],
        "player_num": int(body.get("player_num") or 1),
        "label": str(body.get("label") or "Dice Roll")[:64],
        "mode": str(body.get("mode") or "roll")[:32],
        "dice_count": min(100, max(1, int(body.get("dice_count") or 1))),
        "die_type": str(body.get("die_type") or "D6")[:16],
        "target": int(body.get("target") or 0),
        "results": bounded_results,
        "success_count": int(body.get("success_count") or 0),
        "fail_count": int(body.get("fail_count") or 0),
        "crit_count": int(body.get("crit_count") or 0),
        "sum": int(body.get("sum") or 0),
        "timestamp": int(datetime.now(timezone.utc).timestamp() * 1000)
    }

    # Keep last 200 rolls in room history for accurate match-wide distribution
    if "dice_history" not in room:
        room["dice_history"] = []
    room["dice_history"].append(roll_data)
    if len(room["dice_history"]) > 200:
        room["dice_history"] = room["dice_history"][-200:]

    raw_tray = body.get("tray")
    tray = raw_tray[:100] if isinstance(raw_tray, list) else raw_tray
    trays = body.get("trays")
    if isinstance(trays, dict):
        for p_key in ("p1", "p2"):
            if isinstance(trays.get(p_key), dict) and isinstance(trays[p_key].get("tray"), list):
                trays[p_key]["tray"] = trays[p_key]["tray"][:100]
    target = int(body.get("target", 0))

    if "state" not in room or not isinstance(room["state"], dict):
        room["state"] = {}
    if tray is not None:
        room["state"]["dice_tray"] = tray
        room["dice_tray"] = tray
    if isinstance(trays, dict):
        room["state"]["dice_trays"] = trays
        room["dice_trays"] = trays
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
        if isinstance(trays, dict):
            fs_updates["dice_trays"] = trays
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
        "trays": room.get("dice_trays"),
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
        "trays": room.get("dice_trays"),
        "target": target
    }

@router.get("/api/tracker/room/{match_id}/stream", summary="Real-time Server-Sent Events stream for multiplayer match")
async def api_tracker_stream(match_id: str, client_id: str = "anon"):
    match_id = normalize_tracker_match_id(match_id)
    q = asyncio.Queue()
    q._is_spectator = str(client_id).startswith("spectator")
    if match_id not in TRACKER_LISTENERS:
        TRACKER_LISTENERS[match_id] = []
    TRACKER_LISTENERS[match_id].append(q)

    # Broadcast live presence count to ALL connected listeners in this room
    cur_count = max(1, sum(1 for l_q in TRACKER_LISTENERS[match_id] if not getattr(l_q, "_is_spectator", False)))
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
            rem_count = max(1, sum(1 for l_q in TRACKER_LISTENERS.get(match_id, []) if not getattr(l_q, "_is_spectator", False)))
            disconn_msg = {"type": "presence", "count": rem_count}
            for rem_q in list(TRACKER_LISTENERS.get(match_id, [])):
                try:
                    await rem_q.put(disconn_msg)
                except Exception:
                    pass

    return StreamingResponse(event_generator(), media_type="text/event-stream")

