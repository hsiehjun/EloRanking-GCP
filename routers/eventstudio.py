"""Event Studio, Swiss Pairings Engine & BCP Integration Router."""
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
from typing import Any, Dict, List, Optional, Tuple, Union
from pathlib import Path

from core import (
    APIRouter, BaseModel, HTTPException, Query, Request, Response, BackgroundTasks,
    FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse, StreamingResponse,
    get_database, get_auth_manager, get_elo_engine, get_firestore_engine, get_army_parser,
    _get_user_session_or_401, _get_admin_session_or_403, _get_to_session_or_403,
    NO_CACHE_HEADERS, VERIFIED_TOURNAMENT_CITIES, web_dir, package_dir, logger,
    BestCoastPairingsScraper, _decode_jwt_payload, init_tracker_room_from_chat, _roster_cache, extras,
    DEFAULT_GAME_SYSTEM_ID, AOS_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR, MIN_MATCHES_FOR_RANKING,
    BCP_API_BASE, DEFAULT_HEADERS, BCP_CLIENT_ID, BCP_USER_AGENT, GOOGLE_MAPS_API_KEY,
    TRACKER_ROOMS, TRACKER_LISTENERS, generate_unique_match_id, normalize_tracker_match_id
)

try:
    from google3.experimental.users.hsiehjun.EloRanking.bcp_adapter import bcp_adapter, BcpAdapter
except ImportError:
    try:
        from experimental.users.hsiehjun.EloRanking.bcp_adapter import bcp_adapter, BcpAdapter
    except ImportError:
        from bcp_adapter import bcp_adapter, BcpAdapter

router = APIRouter(tags=["Event Studio & TO Suite"])

# =========================================================================
# EVENT STUDIO & BCP LIVE MATCH SYNC APIS
# =========================================================================

class SubmitScorePayload(BaseModel):
    event_id: str
    table: Optional[int] = None
    table_num: Optional[int] = None
    round_num: Optional[int] = 1
    p1_score: int
    p2_score: int
    p1_name: Optional[str] = "Player 1"
    p2_name: Optional[str] = "Player 2"
    p1_id: Optional[str] = None
    p2_id: Optional[str] = None
    winner_id: Optional[str] = None
    source_app: Optional[str] = "EventStudio"
    game_details: Optional[Dict[str, Any]] = None
    bcp_token: Optional[str] = None
    pairing_id: Optional[str] = None
    first_turn: Optional[str] = None
    layout: Optional[str] = None
    terrain_layout: Optional[str] = None

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
    address: Optional[str] = ""
    postal_code: Optional[str] = ""
    place_id: Optional[str] = ""
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

    # BCP Online Registration & Ticketing Configuration
    using_online_reg: Optional[bool] = True
    num_tickets: Optional[int] = None
    ticket_price: Optional[float] = 0.0
    ticket_currency: Optional[str] = "usd"
    disable_checkin: Optional[bool] = False
    private_event: Optional[bool] = False
    collect_shipping: Optional[bool] = False
    shipping_mandatory: Optional[bool] = False
    shipping_description: Optional[str] = ""
    lists_locked: Optional[bool] = False
    list_submission_locked: Optional[bool] = False
    lists_at_checkin: Optional[bool] = False
    factions_locked: Optional[bool] = False
    ranked_tables: Optional[bool] = False
    require_pairing_publish: Optional[bool] = False

    time_zone: Optional[str] = "America/Los_Angeles"
    bcp_token: Optional[str] = None
    event_type: Optional[str] = "Singles Event"  # "Singles Event", "Doubles Event", "Teams Event"
    team_size: Optional[int] = 1
    circuit_id: Optional[str] = None
    circuit_token: Optional[str] = None
    circuit_name: Optional[str] = None



class RegisterPlayerPayload(BaseModel):
    name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    faction: Optional[str] = None
    detachment: Optional[str] = None
    team: Optional[str] = None
    army_list: Optional[str] = None
    checked_in: Optional[bool] = True
    bcp_token: Optional[str] = None
    bcp_user_id: Optional[str] = None
    player_id: Optional[str] = None
    access_code: Optional[str] = None
    accessCode: Optional[str] = None

class SwapPairingPayload(BaseModel):
    round: int = 1
    table1: int
    slot1: str = "p1"  # "p1" or "p2"
    table2: int
    slot2: str = "p2"  # "p1" or "p2"

class ApplyPairingsBcpPayload(BaseModel):
    round: int = 1

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
    2. Automatic token refresh fallback on 401/403
    """
    return bcp_adapter.execute_call(
        url=url,
        method=method,
        json_data=json_data,
        user_id=user_id,
        explicit_token=explicit_token
    )

def _get_to_session_or_403(request: Request, token: Optional[str] = None) -> Dict[str, Any]:
    """Validates that session is active and user has Tournament Organizer (TO) or Admin role."""
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    if not session_token:
        raise HTTPException(status_code=401, detail="Authentication required to access Event Studio.")
    session = auth_mgr.get_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")
    user_role = (session.get("role") or "player").strip().lower()
    user_email = (session.get("email") or "").strip().lower()
    superadmin_email = os.environ.get("SUPERADMIN_EMAIL", "swimgeek751@gmail.com").strip().lower()
    is_admin = session.get("is_admin") is True or (user_role in ("admin", "superuser", "developer", "owner")) or (bool(superadmin_email) and user_email == superadmin_email)
    is_to = session.get("can_access_to") is True or user_role in ("to", "organizer", "referee") or is_admin
    if not (is_admin or is_to):
        raise HTTPException(
            status_code=403,
            detail="Tournament Organizer (TO) or Administrator role required to access Event Studio."
        )
    return session

def _normalize_bcp_pairing(
    pairing: Dict[str, Any],
    default_table: int = 1,
    roster_by_id: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Normalizes a Best Coast Pairings pairing object to ensure all fields expected by
    Event Studio UI (p1_name, p1_faction, p1_team, p1_elo, p1_win_prob, p1_score,
    p2_name, p2_faction, p2_team, p2_elo, p2_win_prob, p2_score, table, is_bye, is_done)
    are present while preserving all raw BCP keys.
    """
    if not isinstance(pairing, dict):
        return {}

    table_num = pairing.get("table") or pairing.get("tableNumber") or default_table
    try:
        table_num = int(table_num)
    except Exception:
        table_num = default_table

    p1_obj = pairing.get("player1") or {}
    p2_obj = pairing.get("player2") or {}
    p1_user = p1_obj.get("user") if isinstance(p1_obj.get("user"), dict) else {}
    p2_user = p2_obj.get("user") if isinstance(p2_obj.get("user"), dict) else {}

    p1_id = str(p1_obj.get("id") or p1_user.get("id") or pairing.get("player1Id") or "")
    p2_id = str(p2_obj.get("id") or p2_user.get("id") or pairing.get("player2Id") or "")

    p1_first = p1_user.get("firstName") or p1_obj.get("firstName") or ""
    p1_last = p1_user.get("lastName") or p1_obj.get("lastName") or ""
    p1_full = f"{p1_first} {p1_last}".strip()
    p1_name = p1_obj.get("name") or p1_full or pairing.get("p1_name") or pairing.get("p1Name") or "Player 1"

    p2_first = p2_user.get("firstName") or p2_obj.get("firstName") or ""
    p2_last = p2_user.get("lastName") or p2_obj.get("lastName") or ""
    p2_full = f"{p2_first} {p2_last}".strip()
    p2_name = p2_obj.get("name") or p2_full or pairing.get("p2_name") or pairing.get("p2Name") or ("Player 2" if p2_id else "BYE")

    r1 = (roster_by_id or {}).get(p1_id)
    r2 = (roster_by_id or {}).get(p2_id)

    p1_fac = p1_obj.get("army") or p1_obj.get("faction") or (r1.get("faction") if r1 else "") or ""
    if isinstance(p1_fac, dict):
        p1_fac = p1_fac.get("name") or ""

    p2_fac = p2_obj.get("army") or p2_obj.get("faction") or (r2.get("faction") if r2 else "") or ""
    if isinstance(p2_fac, dict):
        p2_fac = p2_fac.get("name") or ""

    p1_team = p1_obj.get("team") or (r1.get("team") if r1 else "") or ""
    if isinstance(p1_team, dict):
        p1_team = p1_team.get("name") or ""

    p2_team = p2_obj.get("team") or (r2.get("team") if r2 else "") or ""
    if isinstance(p2_team, dict):
        p2_team = p2_team.get("name") or ""

    p1_game = pairing.get("player1Game") or {}
    p2_game = pairing.get("player2Game") or {}
    meta = pairing.get("metaData") or {}

    p1_score = None
    if p1_game.get("points") is not None:
        p1_score = p1_game.get("points")
    elif meta.get("p1-gamePoints") is not None:
        try: p1_score = int(meta.get("p1-gamePoints"))
        except Exception: pass
    elif pairing.get("player1Score") is not None:
        p1_score = pairing.get("player1Score")
    elif pairing.get("p1_score") is not None:
        p1_score = pairing.get("p1_score")
    if p1_score is None:
        p1_score = 0

    p2_score = None
    if p2_game.get("points") is not None:
        p2_score = p2_game.get("points")
    elif meta.get("p2-gamePoints") is not None:
        try: p2_score = int(meta.get("p2-gamePoints"))
        except Exception: pass
    elif pairing.get("player2Score") is not None:
        p2_score = pairing.get("player2Score")
    elif pairing.get("p2_score") is not None:
        p2_score = pairing.get("p2_score")
    if p2_score is None:
        p2_score = 0

    is_bye = bool(pairing.get("isBye") or not p2_id or p2_name == "BYE" or not p2_obj)
    has_meta_scores = bool(meta.get("p1-gamePoints") is not None and meta.get("p2-gamePoints") is not None)
    is_done = bool(pairing.get("isDone", False) or has_meta_scores or (p1_game.get("points") is not None and p2_game.get("points") is not None and not is_bye))

    res = dict(pairing)
    res.update({
        "id": str(pairing.get("id") or f"bcp-pairing-{table_num}"),
        "table": table_num,
        "player1GameId": pairing.get("player1GameId") or (p1_game.get("id") if isinstance(p1_game, dict) else None),
        "player2GameId": pairing.get("player2GameId") or (p2_game.get("id") if isinstance(p2_game, dict) else None),
        "metaData": meta,
        "p1_id": p1_id,
        "p1_name": p1_name,
        "p1_faction": str(p1_fac or "Unassigned"),
        "p1_team": str(p1_team or ""),
        "p1_elo": float(r1.get("elo") or 1500.0) if r1 else 1500.0,
        "p1_win_prob": 50.0,
        "p1_score": int(p1_score or 0),
        "p2_id": p2_id if not is_bye else None,
        "p2_name": p2_name if not is_bye else "BYE",
        "p2_faction": str(p2_fac or "") if not is_bye else "",
        "p2_team": str(p2_team or "") if not is_bye else "",
        "p2_elo": 0.0 if is_bye else (float(r2.get("elo") or 1500.0) if r2 else 1500.0),
        "p2_win_prob": 50.0 if not is_bye else 0.0,
        "p2_score": int(p2_score or 0) if not is_bye else 0,
        "is_bye": is_bye,
        "is_done": is_done,
        "is_rematch": False,
        "rematch_rounds": [],
        "same_team": bool(p1_team and p2_team and str(p1_team).strip().lower() == str(p2_team).strip().lower() and not is_bye),
    })
    return res

def _resolve_canonical_event_id(
    raw_event_id: str,
    user: Optional[Dict[str, Any]] = None,
    explicit_token: Optional[str] = None
) -> str:
    """
    BCP event IDs are case-sensitive (e.g. PQa9c4QnLmcF vs PQa9c4QnLmcf).
    If a direct BCP fetch fails with 404, check:
    1. Local database for known events matching case-insensitively.
    2. Organizer's active BCP events list matching case-insensitively.
    Returns canonical event ID if found, otherwise returns original raw_event_id.
    """
    if not raw_event_id or raw_event_id.startswith("ES-"):
        return raw_event_id

    clean_target = str(raw_event_id).strip()
    target_lower = clean_target.lower()

    # 1. Check local DB case-insensitively
    try:
        db = get_database()
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM tournaments WHERE LOWER(id) = %s OR LOWER(id) = %s LIMIT 1;", 
                    (target_lower, f"event/{target_lower}")
                )
                row = cur.fetchone()
                if row and row[0]:
                    clean = str(row[0]).replace("event/", "").strip()
                    if clean and clean.lower() == target_lower:
                        return clean
                cur.execute(
                    "SELECT id FROM studio_events WHERE LOWER(id) = %s LIMIT 1;", 
                    (target_lower,)
                )
                srow = cur.fetchone()
                if srow and srow[0]:
                    clean = str(srow[0]).replace("event/", "").strip()
                    if clean and clean.lower() == target_lower:
                        return clean
    except Exception as e:
        logger.debug(f"Notice resolving canonical event ID from DB: {e}")

    # 2. Check organizer's active BCP events list
    try:
        tok = explicit_token
        if not tok and user and user.get("id"):
            try:
                from core import get_auth_manager
                auth_mgr = get_auth_manager()
                tok_dict = auth_mgr.get_valid_bcp_tokens(user["id"])
                tok = tok_dict.get("id_token") or tok_dict.get("access_token")
            except Exception:
                pass

        if tok:
            url = f"{BCP_API_BASE}/events?limit=100&toEvents=true"
            data, _ = bcp_adapter.execute_call(url, method="GET", explicit_token=tok)
            if isinstance(data, dict):
                data = data.get("data") or data.get("events") or []
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict):
                        iid = str(item.get("id") or "").strip()
                        if iid.lower() == target_lower:
                            return iid
    except Exception as e:
        logger.debug(f"Notice resolving canonical event ID from BCP organizer events: {e}")

    return raw_event_id

def _fetch_bcp_event_workspace(
    event_id: str,
    user: Optional[Dict[str, Any]] = None,
    explicit_token: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Directly queries Best Coast Pairings API for event details, live competitor roster,
    and round pairings. Zero backend DB mutation.
    """
    try:
        from scraper import BestCoastPairingsScraper
        db = None
        try:
            db = get_database()
        except Exception:
            pass
        scraper = BestCoastPairingsScraper(db=db)

        canonical_id = event_id
        bcp_event = scraper.fetch_event_details(canonical_id)
        if not bcp_event or not isinstance(bcp_event, dict):
            resolved_id = _resolve_canonical_event_id(canonical_id, user=user, explicit_token=explicit_token)
            if resolved_id != canonical_id:
                canonical_id = resolved_id
                bcp_event = scraper.fetch_event_details(canonical_id)
        if not bcp_event or not isinstance(bcp_event, dict):
            return None

        event_id = canonical_id

        loc = bcp_event.get("location") if isinstance(bcp_event.get("location"), dict) else {}
        raw_rounds = bcp_event.get("numberOfRounds") or bcp_event.get("numRounds") or 5
        raw_pts = bcp_event.get("points") or 2000
        raw_cap = bcp_event.get("numTickets") or bcp_event.get("capacity") or 32
        cur_round = bcp_event.get("activeRound") or bcp_event.get("currentRound") or bcp_event.get("round") or 1
        started = bool(bcp_event.get("started") or (bcp_event.get("currentRound", 0) > 0) or (bcp_event.get("activeRound", 0) > 0))
        ended = bool(bcp_event.get("ended"))

        # 1. Fetch live roster directly from BCP API
        raw_roster = scraper.fetch_event_players(event_id)
        if not raw_roster:
            raw_roster = scraper.fetch_event_teams(event_id)

        roster = []
        roster_by_id = {}
        for idx, p in enumerate(raw_roster or []):
            if not isinstance(p, dict):
                continue
            u = p.get("user") if isinstance(p.get("user"), dict) else {}
            fn = u.get("firstName") or p.get("firstName") or ""
            ln = u.get("lastName") or p.get("lastName") or ""
            full_name = p.get("name") or f"{fn} {ln}".strip() or "Competitor"
            team_val = p.get("team")
            if isinstance(team_val, dict):
                team_name = team_val.get("name") or ""
            else:
                team_name = str(team_val or p.get("teamName") or p.get("club") or "")

            pid = str(p.get("id") or u.get("id") or f"P-{idx}")
            player_dict = {
                "id": pid,
                "player_id": pid,
                "user_id": str(p.get("userId") or u.get("id") or ""),
                "name": full_name,
                "first_name": fn,
                "last_name": ln,
                "email": u.get("email") or p.get("email") or "",
                "faction": p.get("army") or p.get("faction") or p.get("armyName") or "Unassigned",
                "detachment": p.get("detachment") or "",
                "team": team_name,
                "checked_in": bool(p.get("checkedIn") or p.get("checked_in")),
                "dropped": bool(p.get("dropped")),
                "army_list": p.get("armyList") or p.get("army_list") or "",
                "paid": bool(p.get("paid", True)),
                "placing": p.get("placing") or p.get("place") or p.get("rank"),
                "points": p.get("points") or p.get("battlePoints") or 0,
            }
            roster.append(player_dict)
            roster_by_id[pid] = player_dict
            if player_dict["user_id"]:
                roster_by_id[player_dict["user_id"]] = player_dict

        # 2. Fetch live round pairings if event has started or pairings exist
        pairings_map = {}
        max_round_to_check = max(1, int(cur_round))
        for r in range(1, max_round_to_check + 1):
            ok, p_err, raw_r_pairings = bcp_adapter.fetch_event_pairings(
                event_id=event_id,
                round_num=r,
                pairing_type="Pairing",
                user_id=user["id"] if user else None,
                explicit_token=explicit_token
            )
            if not raw_r_pairings:
                raw_r_pairings = scraper.fetch_event_pairings_for_round(event_id, r)
            if raw_r_pairings:
                norm_pairings = []
                for idx, pairing in enumerate(raw_r_pairings):
                    norm = _normalize_bcp_pairing(pairing, default_table=idx + 1, roster_by_id=roster_by_id)
                    norm_pairings.append(norm)
                pairings_map[str(r)] = norm_pairings
                started = True

        return {
            "id": event_id,
            "name": bcp_event.get("name", "BCP Tournament"),
            "tier": bcp_event.get("eventType") or bcp_event.get("tier") or "Grand Tournament",
            "event_date": bcp_event.get("eventDate") or bcp_event.get("startDate"),
            "end_date": bcp_event.get("endDate") or bcp_event.get("eventEndDate"),
            "city": bcp_event.get("city") or loc.get("city"),
            "state": bcp_event.get("state") or loc.get("state"),
            "country": bcp_event.get("country") or loc.get("country"),
            "venue": bcp_event.get("venueName") or loc.get("venueName") or loc.get("name") or bcp_event.get("venue"),
            "num_rounds": raw_rounds,
            "points": raw_pts,
            "capacity": raw_cap,
            "current_round": cur_round,
            "started": started,
            "is_ended": ended,
            "bcp_synced": True,
            "bcp_status": "synced",
            "organizer_id": user["id"] if user else None,
            "organizer_bcp_id": bcp_event.get("ownerId") or bcp_event.get("owner_Id"),
            "raw_json": bcp_event,
            "using_online_reg": bcp_event.get("usingOnlineReg", True),
            "num_tickets": bcp_event.get("numTickets", raw_cap),
            "ticket_price": bcp_event.get("ticketPrice", 0.0),
            "ticket_currency": bcp_event.get("ticketCurrency", "usd"),
            "disable_checkin": bcp_event.get("disableCheckin", False),
            "private_event": bcp_event.get("privateEvent", False),
            "hide_lists": bcp_event.get("hideLists", False),
            "hide_roster": bcp_event.get("hideRoster", False),
            "hide_placings": bcp_event.get("hidePlacings", False),
            "lists_locked": bcp_event.get("listsLocked", False),
            "factions_locked": bcp_event.get("factionsLocked", False),
            "passwordless_scoring": bcp_event.get("passwordlessScoring", True),
            "ranked_tables": bcp_event.get("rankedTables", False),
            "roster": roster,
            "total_players": len(roster) if roster else (bcp_event.get("totalPlayers") or 0),
            "pairings": pairings_map,
        }
    except Exception as err:
        logger.warning(f"Error fetching live BCP event {event_id}: {err}")
        return None

@router.get("/api/eventstudio/events", summary="List organizer tournaments")
async def api_eventstudio_list_events(request: Request, bcp_token: Optional[str] = Query(None)):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]
    bcp_user_id = user.get("bcp_user_id")
    player_id = user.get("player_id")
    effective_bcp_token = bcp_token or request.headers.get("X-BCP-Token") or (auth_mgr.get_valid_bcp_token(user_id) if user_id else None)

    if not user_id and not bcp_user_id and not player_id:
        return {"success": True, "count": 0, "events": []}

    bcp_events = []
    seen_ids = set()

    # Query BCP directly for tournaments hosted by this organizer (zero DB mutations)
    if user_id or effective_bcp_token:
        try:
            start_range = "2025-09-01T07:00:00.000Z"
            end_range = "2027-09-02T06:59:59.999Z"
            sync_url = f"https://newprod-api.bestcoastpairings.com/v2/events?limit=50&eventSearchType=organizer&sortKey=eventDate&sortAscending=false&startDate={start_range}&endDate={end_range}"
            bcp_raw, err = execute_bcp_api_call(sync_url, method="GET", user_id=user_id, explicit_token=effective_bcp_token)

            if not bcp_raw:
                sync_url_v1 = f"{BCP_API_BASE}/events?limit=100&toEvents=true"
                bcp_raw, err = execute_bcp_api_call(sync_url_v1, method="GET", user_id=user_id, explicit_token=effective_bcp_token)

            if bcp_raw:
                items = bcp_raw.get("data", bcp_raw.get("events", [])) if isinstance(bcp_raw, dict) else bcp_raw
                for item in (items if isinstance(items, list) else []):
                    if not isinstance(item, dict): continue
                    bcp_id = str(item.get("id") or item.get("_id") or "")
                    if not bcp_id or bcp_id in seen_ids:
                        continue
                    seen_ids.add(bcp_id)
                    loc = item.get("location") if isinstance(item.get("location"), dict) else {}
                    capacity = int(item.get("numTickets") or item.get("capacity") or 32)
                    reg_players = int(item.get("totalPlayers") if item.get("totalPlayers") is not None else (item.get("numPlayers") or item.get("checkedInPlayers") or 0))
                    bcp_events.append({
                        "id": bcp_id,
                        "name": item.get("name", "BCP Tournament"),
                        "tier": item.get("eventType") or item.get("tier") or "Grand Tournament",
                        "event_date": item.get("eventDate") or item.get("startDate") or item.get("eventStartDate"),
                        "end_date": item.get("endDate") or item.get("eventEndDate"),
                        "city": item.get("city") or loc.get("city"),
                        "state": item.get("state") or loc.get("state"),
                        "country": item.get("country") or loc.get("country"),
                        "venue": item.get("venueName") or loc.get("venueName") or loc.get("name") or loc.get("venue"),
                        "num_rounds": item.get("numberOfRounds") or item.get("numRounds") or 5,
                        "points": item.get("points") or 2000,
                        "capacity": capacity,
                        "total_players": reg_players,
                        "organizer_id": user_id,
                        "organizer_bcp_id": item.get("ownerId") or item.get("owner_Id") or bcp_user_id or player_id,
                        "bcp_synced": True,
                        "bcp_status": "synced"
                    })
        except Exception as se:
            logger.info(f"Notice querying BCP organizer events: {se}")

    # Also include local ES- events (if any exist) or fallback to DB if BCP query didn't return events
    local_events = [
        ev for ev in db.get_studio_events(organizer_id=user_id, organizer_bcp_id=bcp_user_id, player_id=player_id)
        if str(ev.get("id", "")).startswith("ES-") and str(ev.get("id", "")) not in seen_ids
    ]
    all_events = bcp_events + local_events

    if not all_events:
        all_events = db.get_studio_events(organizer_id=user_id, organizer_bcp_id=bcp_user_id, player_id=player_id)

    # Enrich events with live BCP metadata (accurate date, rounds, capacity, registered competitors)
    from scraper import BestCoastPairingsScraper
    scraper = BestCoastPairingsScraper(db=db)
    for ev in all_events:
        eid = str(ev.get("id") or "").strip()
        if not eid or eid.startswith("ES-"):
            continue
        try:
            bcp_info = scraper.fetch_event_details(eid)
            if bcp_info and isinstance(bcp_info, dict):
                ev["name"] = bcp_info.get("name") or ev.get("name")
                b_date = bcp_info.get("eventDate") or bcp_info.get("startDate") or bcp_info.get("eventStartDate")
                if b_date:
                    ev["event_date"] = b_date
                b_end = bcp_info.get("endDate") or bcp_info.get("eventEndDate")
                if b_end:
                    ev["end_date"] = b_end
                b_rounds = bcp_info.get("numberOfRounds") or bcp_info.get("numRounds")
                if b_rounds is not None:
                    ev["num_rounds"] = int(b_rounds)
                b_pts = bcp_info.get("points")
                if b_pts is not None:
                    ev["points"] = int(b_pts)
                b_cap = bcp_info.get("numTickets") or bcp_info.get("capacity")
                if b_cap is not None:
                    ev["capacity"] = int(b_cap)
                    ev["num_tickets"] = int(b_cap)
                b_tot = bcp_info.get("totalPlayers")
                if b_tot is not None and int(b_tot) > 0:
                    ev["total_players"] = int(b_tot)
                elif not ev.get("total_players") or int(ev.get("total_players") or 0) == 0:
                    raw_players = scraper.fetch_event_players(eid)
                    if raw_players:
                        ev["total_players"] = len(raw_players)
                ev["bcp_synced"] = True
                ev["bcp_status"] = "synced"
        except Exception as enrich_err:
            logger.debug(f"Notice enriching BCP event {eid} for directory list: {enrich_err}")

    return {
        "success": True,
        "count": len(all_events),
        "events": all_events
    }

@router.get("/api/eventstudio/event/{event_id}", summary="Get tournament details, roster, and round pairings")
async def api_eventstudio_get_event(event_id: str, request: Request):
    db = get_database()
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    x_bcp_token = request.headers.get("X-BCP-Token") or request.query_params.get("bcp_token") or (auth_mgr.get_valid_bcp_token(user["id"]) if user else None)

    # For BCP events, query directly from BCP API without relying on or mutating backend DB
    if not event_id.startswith("ES-"):
        bcp_ev = _fetch_bcp_event_workspace(event_id, user, explicit_token=x_bcp_token)
        if bcp_ev:
            return {"success": True, "event": bcp_ev}

    ev = db.get_studio_event(event_id)
    if not ev:
        # Fallback to standard event lookup
        full_ev = db.get_tournament_details(event_id)
        if full_ev:
            return {"success": True, "event": full_ev}
        raise HTTPException(status_code=404, detail=f"Tournament '{event_id}' not found")

    if ev and isinstance(ev.get("raw_json"), dict):
        rj = ev["raw_json"]
        if "using_online_reg" not in ev:
            ev["using_online_reg"] = rj.get("usingOnlineReg", True)
        if "num_tickets" not in ev:
            ev["num_tickets"] = rj.get("numTickets", ev.get("capacity", 32))
        if "ticket_price" not in ev:
            ev["ticket_price"] = rj.get("ticketPrice", 0.0)
        if "ticket_currency" not in ev:
            ev["ticket_currency"] = rj.get("ticketCurrency", "usd")
        if "disable_checkin" not in ev:
            ev["disable_checkin"] = rj.get("disableCheckin", False)
        if "private_event" not in ev:
            ev["private_event"] = rj.get("privateEvent", False)
        if "shipping_details" not in ev:
            ev["shipping_details"] = rj.get("shippingDetails", {"requested": False, "mandatory": False, "description": ""})
        if "hide_lists" not in ev:
            ev["hide_lists"] = rj.get("hideLists", False)
        if "lists_at_checkin" not in ev:
            ev["lists_at_checkin"] = rj.get("listsAtCheckin", False)
        if "lists_locked" not in ev:
            ev["lists_locked"] = rj.get("listsLocked", False)
        if "factions_locked" not in ev:
            ev["factions_locked"] = rj.get("factionsLocked", False)
        if "hide_roster" not in ev:
            ev["hide_roster"] = rj.get("hideRoster", False)
        if "hide_placings" not in ev:
            ev["hide_placings"] = rj.get("hidePlacings", False)
        if "passwordless_scoring" not in ev:
            ev["passwordless_scoring"] = rj.get("passwordlessScoring", True)
        if "ranked_tables" not in ev:
            ev["ranked_tables"] = rj.get("rankedTables", False)

    return {
        "success": True,
        "event": ev
    }

@router.get("/api/eventstudio/event/{event_id}/round/{round_num}/pairings", summary="Get live pairings and scores for a specific tournament round (lightweight single-call)")
async def api_eventstudio_get_round_pairings(
    event_id: str,
    round_num: int,
    request: Request,
    bcp_token: Optional[str] = Query(None)
):
    db = get_database()
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    x_bcp_token = bcp_token or request.headers.get("X-BCP-Token") or request.query_params.get("bcp_token") or (auth_mgr.get_valid_bcp_token(user["id"]) if user else None)

    round_str = str(round_num)

    # 1. Local event (ES-...)
    if event_id.startswith("ES-"):
        ev = db.get_studio_event(event_id)
        if not ev:
            raise HTTPException(status_code=404, detail=f"Tournament '{event_id}' not found")
        pairings_map = ev.get("pairings") or {}
        round_pairings = pairings_map.get(round_str) or pairings_map.get(round_num) or []
        return {
            "success": True,
            "event_id": event_id,
            "round": round_num,
            "pairings": round_pairings,
            "current_round": ev.get("current_round") or 1,
            "is_ended": bool(ev.get("is_ended"))
        }

    # 2. BCP event - single fast call for this round
    canonical_id = _resolve_canonical_event_id(event_id, user=user, explicit_token=x_bcp_token)
    ok, p_err, raw_r_pairings = bcp_adapter.fetch_event_pairings(
        event_id=canonical_id,
        round_num=round_num,
        pairing_type="Pairing",
        user_id=user["id"] if user else None,
        explicit_token=x_bcp_token
    )
    if not raw_r_pairings:
        try:
            from scraper import BestCoastPairingsScraper
            scraper = BestCoastPairingsScraper(db=db)
            raw_r_pairings = scraper.fetch_event_pairings_for_round(canonical_id, round_num)
        except Exception as sc_err:
            logger.debug(f"Notice fetching round pairings fallback for {canonical_id}: {sc_err}")

    norm_pairings = []
    if raw_r_pairings:
        for idx, pairing in enumerate(raw_r_pairings):
            norm = _normalize_bcp_pairing(pairing, default_table=idx + 1)
            norm_pairings.append(norm)

    return {
        "success": True,
        "event_id": canonical_id,
        "round": round_num,
        "pairings": norm_pairings
    }

@router.post("/api/eventstudio/event/create", summary="Create new tournament and register to BCP")
async def api_eventstudio_create_event(payload: CreateEventPayload, request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]
    bcp_user_id = user.get("bcp_user_id")
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

            # In BCP, ownerId must be the 10-char BCP userId attribute from user record, ID token, or BCP profile
            bcp_owner_id = (
                (user.get("player_id") if user and user.get("player_id") and len(str(user.get("player_id"))) <= 15 else None)
                or id_claims.get("userId")
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
                    "address": payload.address or venue_str,
                    "city": city_str,
                    "state": state_str,
                    "country": country_str,
                    "postalCode": payload.postal_code or "",
                    "timeZone": tz_str,
                    **({"coordinate": [float(payload.lng), float(payload.lat)]} if payload.lat is not None and payload.lng is not None else {})
                },
                "ticketPrice": float(payload.ticket_price or 0.0),
                "amount": float(payload.ticket_price or 0.0),
                "currency": str(payload.ticket_currency or "usd").lower(),
                "ticketCurrency": str(payload.ticket_currency or "usd").lower(),
                "availableCurrencies": [str(payload.ticket_currency or "usd").lower()],
                "pricingDict": {str(payload.ticket_currency or "usd").lower(): float(payload.ticket_price or 0.0)},
                "numTickets": int(payload.num_tickets or payload.capacity or 32),
                "usingOnlineReg": bool(payload.using_online_reg),
                "disableCheckin": bool(payload.disable_checkin),
                "privateEvent": bool(payload.private_event),
                "shippingDetails": {
                    "requested": bool(payload.collect_shipping),
                    "mandatory": bool(payload.shipping_mandatory),
                    "description": str(payload.shipping_description or "")
                },
                "listsLocked": bool(payload.lists_locked),
                "listSubmissionLocked": bool(payload.list_submission_locked or payload.lists_locked),
                "listsAtCheckin": bool(payload.lists_at_checkin or payload.require_lists),
                "factionsLocked": bool(payload.factions_locked),
                "rankedTables": bool(payload.ranked_tables),
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

                    # Configure event registration, ticketing, and rules on BCP
                    try:
                        cfg_dict = payload.model_dump() if hasattr(payload, "model_dump") else (payload.dict() if hasattr(payload, "dict") else vars(payload))
                        bcp_adapter.configure_event_registration(
                            event_id,
                            cfg_dict,
                            user_id=user_id,
                            explicit_token=acc_tok
                        )
                    except Exception as cfg_err:
                        logger.warning(f"Notice configuring BCP event registration for {event_id}: {cfg_err}")

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
    team_sz_local = int(payload.team_size or (2 if is_doubles_local else (5 if is_teams_local else 1)))
    now_date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    start_date_str = str(payload.start_date or now_date_str)
    end_date_str = str(payload.end_date or start_date_str)

    raw_event_cfg = {
        "usingOnlineReg": bool(payload.using_online_reg),
        "using_online_reg": bool(payload.using_online_reg),
        "numTickets": int(payload.num_tickets or payload.capacity or 32),
        "num_tickets": int(payload.num_tickets or payload.capacity or 32),
        "ticketPrice": float(payload.ticket_price or 0.0),
        "ticket_price": float(payload.ticket_price or 0.0),
        "amount": float(payload.ticket_price or 0.0),
        "currency": str(payload.ticket_currency or "usd").lower(),
        "ticketCurrency": str(payload.ticket_currency or "usd").lower(),
        "ticket_currency": str(payload.ticket_currency or "usd").lower(),
        "disableCheckin": bool(payload.disable_checkin),
        "disable_checkin": bool(payload.disable_checkin),
        "privateEvent": bool(payload.private_event),
        "private_event": bool(payload.private_event),
        "shippingDetails": {
            "requested": bool(payload.collect_shipping),
            "mandatory": bool(payload.shipping_mandatory),
            "description": str(payload.shipping_description or "")
        },
        "shipping_details": {
            "requested": bool(payload.collect_shipping),
            "mandatory": bool(payload.shipping_mandatory),
            "description": str(payload.shipping_description or "")
        },
        "hideLists": bool(payload.hide_lists),
        "hide_lists": bool(payload.hide_lists),
        "hideRoster": bool(payload.hide_roster),
        "hide_roster": bool(payload.hide_roster),
        "hidePlacings": bool(payload.hide_placings),
        "hide_placings": bool(payload.hide_placings),
        "listsLocked": bool(payload.lists_locked),
        "lists_locked": bool(payload.lists_locked),
        "listSubmissionLocked": bool(payload.list_submission_locked or payload.lists_locked),
        "list_submission_locked": bool(payload.list_submission_locked or payload.lists_locked),
        "listsAtCheckin": bool(payload.lists_at_checkin or payload.require_lists),
        "lists_at_checkin": bool(payload.lists_at_checkin or payload.require_lists),
        "factionsLocked": bool(payload.factions_locked),
        "factions_locked": bool(payload.factions_locked),
        "rankedTables": bool(payload.ranked_tables),
        "ranked_tables": bool(payload.ranked_tables),
        "passwordlessScoring": bool(payload.passwordless_scoring if payload.passwordless_scoring is not None else True),
        "passwordless_scoring": bool(payload.passwordless_scoring if payload.passwordless_scoring is not None else True)
    }

    event_dict = {
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
        "venue_name": payload.venue,
        "address": payload.address or payload.venue,
        "postal_code": payload.postal_code,
        "lat": payload.lat,
        "lng": payload.lng,
        "place_id": payload.place_id,
        "num_rounds": payload.rounds,
        "points": payload.points,
        "capacity": payload.capacity,
        "mission_pack": payload.mission_pack,
        "organizer_id": user_id,
        "organizer_bcp_id": bcp_user_id,
        "game_system_id": game_sys,
        "game_system": "aos" if (game_sys == AOS_GAME_SYSTEM_ID or game_sys in ("23qDprPABN", "OY8FCPBf6O")) else "40k",
        "using_online_reg": bool(payload.using_online_reg),
        "num_tickets": int(payload.num_tickets or payload.capacity or 32),
        "ticket_price": float(payload.ticket_price or 0.0),
        "ticket_currency": str(payload.ticket_currency or "usd").lower(),
        "disable_checkin": bool(payload.disable_checkin),
        "private_event": bool(payload.private_event),
        "collect_shipping": bool(payload.collect_shipping),
        "shipping_details": raw_event_cfg["shippingDetails"],
        "hide_lists": bool(payload.hide_lists),
        "hide_roster": bool(payload.hide_roster),
        "hide_placings": bool(payload.hide_placings),
        "lists_locked": bool(payload.lists_locked),
        "lists_at_checkin": bool(payload.lists_at_checkin or payload.require_lists),
        "factions_locked": bool(payload.factions_locked),
        "passwordless_scoring": bool(payload.passwordless_scoring if payload.passwordless_scoring is not None else True),
        "ranked_tables": bool(payload.ranked_tables),
        "raw_json": raw_event_cfg,
        "roster": [],
        "pairings": {str(r): [] for r in range(1, (payload.rounds or 5) + 1)}
    }

    if bcp_created:
        # BCP registration succeeded: strictly live on BCP, zero DB mutation. Scraper will pick it up.
        saved = event_dict
    else:
        saved = db.save_studio_event(event_dict)

    return {
        "success": True,
        "event_id": event_id,
        "bcp_registered": bcp_created,
        "bcp_error": bcp_error,
        "event": saved
    }



@router.put("/api/eventstudio/event/{event_id}", summary="Modify tournament details and push to BCP")
async def api_eventstudio_update_event(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

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
        if "capacity" in payload:
            bcp_set_fields["totalPlayers"] = int(payload["capacity"])
            if "num_tickets" not in payload and "numTickets" not in payload:
                bcp_set_fields["numTickets"] = int(payload["capacity"])
        if "num_rounds" in payload or "rounds" in payload:
            bcp_set_fields["numberOfRounds"] = int(payload.get("num_rounds") or payload.get("rounds"))
        if "default_round_length" in payload or "defaultRoundLength" in payload:
            bcp_set_fields["defaultRoundLength"] = int(payload.get("default_round_length") or payload.get("defaultRoundLength"))
        if "pairing_style" in payload or "pairingStyle" in payload:
            bcp_set_fields["pairingStyle"] = str(payload.get("pairing_style") or payload.get("pairingStyle")).title()
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

        # Registration, Ticketing, and Player Access Controls
        if "using_online_reg" in payload or "usingOnlineReg" in payload:
            bcp_set_fields["usingOnlineReg"] = bool(payload.get("using_online_reg", payload.get("usingOnlineReg")))
        if "num_tickets" in payload or "numTickets" in payload:
            bcp_set_fields["numTickets"] = int(payload.get("num_tickets", payload.get("numTickets")))

        if "ticket_price" in payload or "ticketPrice" in payload:
            tp = float(payload.get("ticket_price", payload.get("ticketPrice") or 0.0))
            curr = str(payload.get("ticket_currency") or payload.get("currency") or "usd").lower()
            bcp_set_fields["ticketPrice"] = tp
            bcp_set_fields["amount"] = tp
            bcp_set_fields["currency"] = curr
            bcp_set_fields["ticketCurrency"] = curr
            bcp_set_fields["availableCurrencies"] = [curr]
            bcp_set_fields["pricingDict"] = {curr: tp}

        if "disable_checkin" in payload or "disableCheckin" in payload:
            bcp_set_fields["disableCheckin"] = bool(payload.get("disable_checkin", payload.get("disableCheckin")))
        if "private_event" in payload or "privateEvent" in payload:
            bcp_set_fields["privateEvent"] = bool(payload.get("private_event", payload.get("privateEvent")))

        if "collect_shipping" in payload or "shipping_details" in payload or "shippingDetails" in payload:
            s_req = bool(payload.get("collect_shipping", False))
            s_mand = False
            s_desc = ""
            if isinstance(payload.get("shipping_details"), dict):
                s_req = bool(payload["shipping_details"].get("requested", s_req))
                s_mand = bool(payload["shipping_details"].get("mandatory", False))
                s_desc = str(payload["shipping_details"].get("description", ""))
            elif isinstance(payload.get("shippingDetails"), dict):
                s_req = bool(payload["shippingDetails"].get("requested", s_req))
                s_mand = bool(payload["shippingDetails"].get("mandatory", False))
                s_desc = str(payload["shippingDetails"].get("description", ""))
            bcp_set_fields["shippingDetails"] = {
                "requested": s_req,
                "mandatory": s_mand,
                "description": s_desc
            }

        # Rules, Privacy, and List Controls
        if "hide_lists" in payload or "hideLists" in payload:
            bcp_set_fields["hideLists"] = bool(payload.get("hide_lists", payload.get("hideLists")))
        if "hide_roster" in payload or "hideRoster" in payload:
            bcp_set_fields["hideRoster"] = bool(payload.get("hide_roster", payload.get("hideRoster")))
        if "hide_placings" in payload or "hidePlacings" in payload:
            bcp_set_fields["hidePlacings"] = bool(payload.get("hide_placings", payload.get("hidePlacings")))
        if "lists_locked" in payload or "listsLocked" in payload:
            bcp_set_fields["listsLocked"] = bool(payload.get("lists_locked", payload.get("listsLocked")))
        if "list_submission_locked" in payload or "listSubmissionLocked" in payload:
            bcp_set_fields["listSubmissionLocked"] = bool(payload.get("list_submission_locked", payload.get("listSubmissionLocked")))
        if "lists_at_checkin" in payload or "listsAtCheckin" in payload or "require_lists" in payload:
            bcp_set_fields["listsAtCheckin"] = bool(payload.get("lists_at_checkin", payload.get("listsAtCheckin", payload.get("require_lists"))))
        if "factions_locked" in payload or "factionsLocked" in payload:
            bcp_set_fields["factionsLocked"] = bool(payload.get("factions_locked", payload.get("factionsLocked")))
        if "passwordless_scoring" in payload or "passwordlessScoring" in payload:
            bcp_set_fields["passwordlessScoring"] = bool(payload.get("passwordless_scoring", payload.get("passwordlessScoring")))
        if "ranked_tables" in payload or "rankedTables" in payload:
            bcp_set_fields["rankedTables"] = bool(payload.get("ranked_tables", payload.get("rankedTables")))

        bcp_set_fields["listOptions"] = {"allowsFiles": True, "allowsText": True, "allowsImages": True}

        if bcp_set_fields:
            bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}"
            resp_data, err_msg = execute_bcp_api_call(
                bcp_url,
                method="POST",
                json_data={"set": bcp_set_fields, "unset": {"placingRecordType": True, "eventFormat": True}},
                user_id=user_id
            )
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

@router.get("/api/config/maps-key", summary="Get Maps client configuration")
async def api_get_maps_key():
    # Supports separate GOOGLE_MAPS_CLIENT_KEY (restricted to omnitactica.com) or GOOGLE_MAPS_API_KEY
    key = os.environ.get("GOOGLE_MAPS_CLIENT_KEY", os.environ.get("GOOGLE_MAPS_API_KEY", GOOGLE_MAPS_API_KEY))
    clean_key = (key or "").strip()
    return {"key": clean_key, "configured": bool(clean_key)}




@router.get("/api/eventstudio/locations/search", summary="Search verified cities for event creation")
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

@router.get("/api/eventstudio/circuits", summary="Get available Warhammer circuits from BCP")
async def api_eventstudio_get_circuits(request: Request, game_system: Optional[str] = Query("40k")):
    target_sys = (game_system or "40k").strip().lower()
    bcp_sys_id = AOS_GAME_SYSTEM_ID if target_sys == "aos" else DEFAULT_GAME_SYSTEM_ID
    try:
        import urllib.request, json
        url = f"{BCP_API_BASE}/leagues?limit=50&gameSystemId={bcp_sys_id}&active=true"
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
        if target_sys == "aos":
            return {"success": True, "circuits": [
                {"id": "AOS-ITC", "name": "ITC - Age of Sigmar Circuit"},
                {"id": "AOS-UKTC", "name": "UKTC - Age of Sigmar Circuit"},
                {"id": "AOS-US-OPEN", "name": "GW Warhammer Open - Age of Sigmar"}
            ]}
        return {"success": True, "circuits": [
            {"id": "NvjgICBwiP", "name": "ITC - Independent Tournament Circuit"},
            {"id": "247D2CRUW2", "name": "The U.K. Tournament Circuit (UKTC)"},
            {"id": "FHM0PJHRE7", "name": "California Championship Circuit"},
            {"id": "D6XLCWELAP", "name": "Northeast 40k Tournament Circuit"},
            {"id": "0J24UL9C46", "name": "The Great Lakes 40K Circuit"},
            {"id": "VHAD284QP4", "name": "The France Tournament Circuit"}
        ]}

@router.get("/api/eventstudio/event/{event_id}/circuits", summary="Get circuits linked to this event")
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

@router.post("/api/eventstudio/event/{event_id}/circuits/submit", summary="Link tournament to circuit on BCP")
async def api_eventstudio_submit_circuit(event_id: str, payload: SubmitCircuitPayload, request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

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

@router.delete("/api/eventstudio/event/{event_id}", summary="Delete tournament from Event Studio and BCP")
async def api_eventstudio_delete_event(event_id: str, request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]
    bcp_token = auth_mgr.get_valid_bcp_token(user_id) if user_id else None

    db.delete_studio_event(event_id, organizer_id=user_id)

    # 1. Cascade delete all corresponding table game rooms and tournament records in Firestore
    canonical_eid = _resolve_canonical_event_id(event_id, user=user, explicit_token=bcp_token)
    target_eids = {event_id}
    if canonical_eid:
        target_eids.add(canonical_eid)

    fs_engine = get_firestore_engine()
    total_rooms_deleted = 0
    for eid in target_eids:
        res = fs_engine.delete_tournament_and_rooms(eid)
        total_rooms_deleted += res.get("rooms_deleted", 0)

    # 2. Clean up in-memory TRACKER_ROOMS and broadcast termination to connected table clients
    clean_id = (
        event_id.replace("bcp_", "")
        .replace("BCP_", "")
        .replace("ES-", "")
        .replace("es-", "")
        .replace("event/", "")
        .strip()
    )
    id_variants = {
        event_id,
        event_id.upper(),
        event_id.lower(),
        clean_id,
        clean_id.upper(),
        clean_id.lower(),
        f"ES-{clean_id.upper()}",
        f"es-{clean_id.lower()}",
        f"BCP-{clean_id.upper()}",
        f"bcp_{clean_id}",
        f"BCP_{clean_id}",
    }
    if canonical_eid:
        id_variants.update({canonical_eid, canonical_eid.upper(), canonical_eid.lower()})
    id_variants.discard("")

    match_prefixes = tuple(
        [f"BCP-{v}-" for v in id_variants] +
        [f"ES-{v}-" for v in id_variants] +
        [f"WH40K-BCP-{v}-" for v in id_variants] +
        [f"WH40K-ES-{v}-" for v in id_variants] +
        [f"{v}-R" for v in id_variants] +
        [f"MATCH-{v}-" for v in id_variants]
    )
    match_exacts = tuple(
        [f"BCP-{v}" for v in id_variants] +
        [f"ES-{v}" for v in id_variants] +
        list(id_variants)
    )

    try:
        from routers.tracker import TRACKER_LISTENERS
    except Exception:
        TRACKER_LISTENERS = {}

    for mid in list(TRACKER_ROOMS.keys()):
        mid_u = str(mid).upper()
        room_data = TRACKER_ROOMS.get(mid) or {}
        r_eid = str(room_data.get("eventId") or "").strip()
        r_eid2 = str(room_data.get("event_id") or "").strip()
        r_tid = str(room_data.get("tournament_id") or "").strip()
        r_game_eid = str((room_data.get("state") or {}).get("game", {}).get("eventId") or "").strip()

        matched = (
            any(mid_u.startswith(p.upper()) for p in match_prefixes) or
            any(mid_u == x.upper() for x in match_exacts) or
            any(x in id_variants for x in (r_eid, r_eid2, r_tid, r_game_eid) if x)
        )
        if matched:
            # Notify any active listeners that the room has been closed / deleted
            listeners = TRACKER_LISTENERS.get(mid, [])
            term_msg = {"type": "match_finalized", "is_finished": True, "event_deleted": True}
            for q in list(listeners):
                try:
                    q.put_nowait(term_msg)
                except Exception:
                    pass
            TRACKER_ROOMS.pop(mid, None)

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
        "rooms_deleted": total_rooms_deleted,
        "bcp_deleted": bcp_deleted,
        "message": "Tournament and corresponding table rooms deleted successfully."
    }

@router.post("/api/eventstudio/event/{event_id}/start", summary="Start tournament on OmniTactica and BCP")
async def api_eventstudio_start_event(event_id: str, request: Request):
    user = _get_to_session_or_403(request)
    auth_mgr = get_auth_manager()
    user_id = user["id"]

    # 1. BCP Managed Tournament Flow (Direct & Decoupled, zero DB mutation)
    if not event_id.startswith("ES-"):
        bcp_token = None
        if user_id:
            bcp_token = auth_mgr.get_valid_bcp_token(user_id)

        # Trigger POST /v1/events/{id}/generatePairings on BCP
        bcp_started, bcp_err, bcp_res = bcp_adapter.start_event_or_generate_pairings(
            event_id,
            user_id=user_id,
            explicit_token=bcp_token,
            is_league=False
        )
        if not bcp_started and bcp_err:
            raise HTTPException(status_code=400, detail=f"BCP tournament start failed: {bcp_err}")

        # Poll/query GET /v1/events/{id}/pairingsStatus on BCP
        _, _, status_data = bcp_adapter.get_pairings_status(
            event_id,
            user_id=user_id,
            explicit_token=bcp_token
        )

        # Fetch updated live workspace directly from BCP API
        bcp_ev = _fetch_bcp_event_workspace(event_id, user)
        if not bcp_ev:
            bcp_ev = {
                "id": event_id,
                "started": True,
                "status": "active",
                "current_round": 1,
                "bcp_synced": True,
                "pairings_bcp_synced": True,
                "roster": [],
                "pairings": {}
            }
        else:
            bcp_ev["started"] = True
            bcp_ev["status"] = "active"
            bcp_ev["pairings_bcp_synced"] = True

        return {
            "success": True,
            "event_id": event_id,
            "started": True,
            "current_round": bcp_ev.get("current_round", 1),
            "bcp_started": True,
            "pairings_status": status_data or {"eventId": event_id, "status": "completed"},
            "event": bcp_ev,
            "message": "Tournament started successfully! Round 1 pairings generated on Best Coast Pairings."
        }

    # 2. Local Studio Event Flow (Native OmniTactica)
    db = get_database()
    ev = db.get_studio_event(event_id)
    if not ev:
        details = db.get_event_details(event_id)
        if details:
            ev = db.save_studio_event(details)
        else:
            raise HTTPException(status_code=404, detail="Tournament not found")

    roster = [p for p in (ev.get("roster") or []) if not p.get("dropped")]
    if len(roster) < 2:
        raise HTTPException(status_code=400, detail="At least 2 active competitors are required to start the tournament")

    ev["started"] = True
    ev["is_ended"] = False
    ev["status"] = "active"
    if int(ev.get("current_round") or 0) < 1:
        ev["current_round"] = 1

    # Auto-generate Round 1 Swiss pairings locally if not already generated
    pairings_map = ev.get("pairings") or {}
    if not pairings_map.get("1"):
        try:
            r1_pairings = generate_swiss_pairings_for_event(ev, 1)
            pairings_map["1"] = r1_pairings
            ev["pairings"] = pairings_map
            ev["pairings_status"] = "staged"
        except Exception as pe:
            logger.warning(f"Notice auto-generating round 1 pairings on start: {pe}")

    saved = db.save_studio_event(ev)

    return {
        "success": True,
        "event_id": event_id,
        "started": True,
        "current_round": ev.get("current_round", 1),
        "bcp_started": False,
        "event": saved,
        "message": "Tournament started successfully! Round 1 is active."
    }

@router.get("/api/eventstudio/event/{event_id}/pairings_status", summary="Get pairings generation status from BCP")
async def api_eventstudio_get_pairings_status(event_id: str, request: Request):
    user = _get_to_session_or_403(request)
    auth_mgr = get_auth_manager()
    user_id = user["id"] if user else None

    if event_id.startswith("ES-"):
        return {"success": True, "event_id": event_id, "status": "completed", "data": {"status": "completed"}}

    bcp_token = auth_mgr.get_valid_bcp_token(user_id) if user_id else None
    ok, err, data = bcp_adapter.get_pairings_status(
        event_id,
        user_id=user_id,
        explicit_token=bcp_token
    )
    if not ok and err:
        return {"success": False, "event_id": event_id, "error": err, "status": "unknown"}

    status_val = (data or {}).get("status") or "completed"
    return {
        "success": True,
        "event_id": event_id,
        "status": status_val,
        "data": data or {"status": status_val}
    }

@router.post("/api/eventstudio/event/{event_id}/register", summary="Register player for tournament on OmniTactica and BCP")
@router.post("/api/tournaments/{event_id}/register", summary="Self-register player for tournament")
@router.post("/api/event/{event_id}/register", summary="Register player for tournament")
async def api_eventstudio_register_player(event_id: str, payload: RegisterPlayerPayload, request: Request):
    db = get_database()
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    user_id = user["id"] if user else None

    ev = db.get_studio_event(event_id)
    if not ev:
        details = db.get_event_details(event_id)
        if details:
            ev = db.save_studio_event(details)
        else:
            try:
                import urllib.request, json
                bcp_url = f"{BCP_API_BASE}/events/{event_id}"
                req = urllib.request.Request(bcp_url, headers=DEFAULT_HEADERS)
                with urllib.request.urlopen(req, timeout=8) as resp:
                    if resp.status == 200:
                        bcp_data = json.loads(resp.read().decode())
                        ev = db.save_studio_event({
                            "id": event_id,
                            "name": bcp_data.get("name", "Tournament"),
                            "event_date": bcp_data.get("eventDate") or bcp_data.get("startDate"),
                            "city": bcp_data.get("city"),
                            "state": bcp_data.get("state"),
                            "country": bcp_data.get("country")
                        })
            except Exception as ex:
                logger.debug(f"Direct BCP fetch notice in register: {ex}")
        if not ev:
            raise HTTPException(status_code=404, detail="Tournament not found")

    full_name = (payload.name or "").strip()
    fn = (payload.first_name or "").strip()
    ln = (payload.last_name or "").strip()
    if not full_name and (fn or ln):
        full_name = f"{fn} {ln}".strip()
    elif full_name and not fn and not ln:
        parts = full_name.split(" ", 1)
        fn = parts[0]
        ln = parts[1] if len(parts) > 1 else ""

    if not full_name:
        if user:
            full_name = user.get("name") or user.get("full_name") or user.get("username") or "Competitor"
            parts = full_name.split(" ", 1)
            fn = parts[0]
            ln = parts[1] if len(parts) > 1 else ""
        else:
            raise HTTPException(status_code=400, detail="Player name is required")

    email = (payload.email or (user.get("email") if user else "") or "").strip()
    faction = (payload.faction or "Unassigned").strip()
    detachment = (payload.detachment or "").strip()
    team = (payload.team or "").strip()
    army_list = (payload.army_list or "").strip()
    checked_in = True if payload.checked_in is None else bool(payload.checked_in)

    # Generate or resolve player ID
    player_id = None
    if user:
        player_id = user.get("player_id") or user.get("bcp_user_id")

    # Look up Elo rating in DB
    player_elo = 1500.0
    with db.get_connection() as conn:
        with conn.cursor() as cur:
            if player_id:
                cur.execute("SELECT current_elo, player_name FROM player_ratings WHERE player_id = %s LIMIT 1;", (player_id,))
                p_row = cur.fetchone()
                if p_row:
                    player_elo = float(p_row[0] or 1500.0)
            if player_elo == 1500.0 and full_name:
                cur.execute("SELECT player_id, current_elo FROM player_ratings WHERE LOWER(player_name) = LOWER(%s) LIMIT 1;", (full_name,))
                p_row = cur.fetchone()
                if p_row:
                    if not player_id and p_row[0]:
                        player_id = str(p_row[0])
                    player_elo = float(p_row[1] or 1500.0)

    if not player_id:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT player_id FROM event_participants WHERE event_id = %s AND LOWER(full_name) = LOWER(%s) LIMIT 1;", (event_id, full_name))
                ep_row = cur.fetchone()
                if ep_row and ep_row[0]:
                    player_id = str(ep_row[0])

    if not player_id:
        player_id = f"PL-{secrets.token_hex(4).upper()}"

    # Link player_id to authenticated user profile if missing
    if user and not user.get("player_id") and player_id:
        try:
            with db.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("UPDATE users SET player_id = %s WHERE id = %s AND (player_id IS NULL OR player_id = '');", (player_id, user_id))
                conn.commit()
        except Exception as ue:
            logger.debug(f"User player_id link notice: {ue}")

    # Reflect registration on Best Coast Pairings API using TO Organizer authority
    bcp_registered = False
    bcp_err = None
    if not event_id.startswith("ES-"):
        # We need the TO / Organizer's token to perform manual player registration on BCP
        to_user_id = ev.get("organizer_id")
        to_bcp_token = None

        # 1. Check if the event's organizer ID is an OmniTactica user
        if to_user_id:
            to_bcp_token = auth_mgr.get_valid_bcp_token(to_user_id)

        # 2. If not, check if any OmniTactica user matches organizer_bcp_id
        if not to_bcp_token and ev.get("organizer_bcp_id"):
            with db.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT id FROM users WHERE bcp_user_id = %s LIMIT 1;", (ev.get("organizer_bcp_id"),))
                    urow = cur.fetchone()
                    if urow and urow[0]:
                        to_user_id = urow[0]
                        to_bcp_token = auth_mgr.get_valid_bcp_token(to_user_id)

        # 3. If still not found, check if payload provided explicit token or if calling user is TO/Admin
        if not to_bcp_token:
            if payload.bcp_token:
                to_bcp_token = payload.bcp_token
            elif user_id and (user.get("role") in ("ORGANIZER", "ADMIN") or user_id == ev.get("organizer_id")):
                to_bcp_token = auth_mgr.get_valid_bcp_token(user_id)
                to_user_id = user_id

        # 4. Fallback to caller's token
        if not to_bcp_token and user_id:
            to_bcp_token = auth_mgr.get_valid_bcp_token(user_id)
            to_user_id = user_id

        player_data_for_bcp = {
            "first_name": fn,
            "last_name": ln,
            "name": full_name,
            "email": email,
            "faction": faction,
            "army": faction,
            "detachment": detachment,
            "team": team,
            "checkedIn": checked_in,
            "checked_in": checked_in,
            "armyList": army_list,
            "army_list": army_list,
            "userId": (user.get("bcp_user_id") if user else None) or payload.bcp_user_id,
            "bcp_user_id": (user.get("bcp_user_id") if user else None) or payload.bcp_user_id,
            "access_code": payload.access_code or payload.accessCode,
            "accessCode": payload.access_code or payload.accessCode
        }

        if to_bcp_token:
            bcp_registered, bcp_err, bcp_resp = bcp_adapter.register_player(
                event_id,
                player_data_for_bcp,
                user_id=to_user_id,
                explicit_token=to_bcp_token,
                is_team=bool(ev.get("team_size", 1) > 1 or ev.get("event_type") in ("Teams Event", "Doubles Event"))
            )
        else:
            bcp_err = "Registration recorded in OmniTactica. BCP sync requires linked Tournament Organizer credentials."

    # Update OmniTactica roster
    roster = list(ev.get("roster") or [])
    existing_idx = next(
        (i for i, p in enumerate(roster) if str(p.get("id") or "") == player_id or (p.get("name") or "").strip().lower() == full_name.lower()),
        -1
    )

    player_record = {
        "id": player_id,
        "name": full_name,
        "first_name": fn,
        "last_name": ln,
        "email": email,
        "faction": faction,
        "detachment": detachment,
        "team": team,
        "checked_in": checked_in,
        "checkedIn": checked_in,
        "dropped": False,
        "currentElo": round(player_elo, 1),
        "elo": round(player_elo, 1),
        "listSubmitted": bool(army_list or detachment),
        "army_list": army_list
    }

    if existing_idx >= 0:
        roster[existing_idx].update(player_record)
    else:
        roster.append(player_record)

    ev["roster"] = roster
    ev["total_players"] = len(roster)
    saved = db.save_studio_event(ev)

    try:
        db.upsert_event_participant(
            event_id=event_id,
            player_id=player_id,
            first_name=fn,
            last_name=ln,
            full_name=full_name,
            faction=faction,
            team=team,
            dropped=False,
            checked_in=checked_in
        )
    except Exception as pe:
        logger.warning(f"Error upserting participant: {pe}")

    try:
        from routers.leaderboard import api_events_recommended
        if hasattr(api_events_recommended, "_roster_cache") and event_id in api_events_recommended._roster_cache:
            del api_events_recommended._roster_cache[event_id]
    except Exception:
        pass

    return {
        "success": True,
        "event_id": event_id,
        "player": player_record,
        "total_players": len(roster),
        "bcp_registered": bcp_registered,
        "bcp_synced": bcp_registered,
        "bcp_notice": bcp_err if not bcp_registered and not event_id.startswith("ES-") else None,
        "event": saved,
        "message": f"Successfully registered {full_name} for tournament."
    }

@router.post("/api/eventstudio/event/{event_id}/pairings", summary="Save round pairings and sync game rooms")
async def api_eventstudio_save_pairings(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

    round_num = str(payload.get("round") or payload.get("round_num") or 1)
    pairings_list = payload.get("pairings") or []

    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    pairings_map = ev.get("pairings") or {}

    # Enrich pairings with Elo win probability and rematch warnings if missing
    roster_map = {str(p.get("id") or p.get("name")): p for p in (ev.get("roster") or [])}
    for p in pairings_list:
        p1_id = str(p.get("p1_id") or p.get("p1") or "")
        p2_id = str(p.get("p2_id") or p.get("p2") or "")
        p1_rec = roster_map.get(p1_id, {})
        p2_rec = roster_map.get(p2_id, {})

        p1_elo = float(p.get("p1_elo") or p1_rec.get("currentElo") or p1_rec.get("elo") or 1500.0)
        p2_elo = float(p.get("p2_elo") or p2_rec.get("currentElo") or p2_rec.get("elo") or 1500.0)
        p["p1_elo"] = round(p1_elo, 1)
        p["p2_elo"] = round(p2_elo, 1)

        if not p.get("p1_win_prob"):
            p["p1_win_prob"] = round(1.0 / (1.0 + 10.0 ** ((p2_elo - p1_elo) / 400.0)) * 100.0, 1)
            p["p2_win_prob"] = round(100.0 - p["p1_win_prob"], 1)

        if "is_rematch" not in p and p2_id:
            rematch_r = []
            for prev_r, p_prev in pairings_map.items():
                if prev_r != round_num:
                    for pm in (p_prev or []):
                        ids = {str(pm.get("p1_id") or pm.get("p1") or ""), str(pm.get("p2_id") or pm.get("p2") or "")}
                        if p1_id in ids and p2_id in ids:
                            try: rematch_r.append(int(prev_r))
                            except Exception: pass
            p["is_rematch"] = len(rematch_r) > 0
            p["rematch_rounds"] = sorted(rematch_r)

    pairings_map[round_num] = pairings_list
    ev["pairings"] = pairings_map
    ev["current_round"] = int(round_num)
    ev["pairings_status"] = "staged"

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

    # If explicit apply_bcp requested, push to BCP
    bcp_pushed = False
    if payload.get("apply_bcp") and not event_id.startswith("ES-"):
        bcp_token = payload.get("bcp_token") or (auth_mgr.get_valid_bcp_token(user_id) if user_id else None)
        bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}/rounds/{round_num}/pairings"
        data, err = execute_bcp_api_call(bcp_url, method="POST", json_data={"pairings": pairings_list}, user_id=user_id, explicit_token=bcp_token)
        if data is not None or not err:
            bcp_pushed = True
            ev["pairings_status"] = "applied"
            ev["pairings_bcp_synced"] = True

    saved = db.save_studio_event(ev)

    return {
        "success": True,
        "event_id": event_id,
        "round": round_num,
        "pairings_count": len(pairings_list),
        "bcp_pushed": bcp_pushed,
        "pairings_status": ev.get("pairings_status", "staged"),
        "event": saved
    }

@router.post("/api/eventstudio/event/{event_id}/roster", summary="Update event competitor roster")
async def api_eventstudio_save_roster(event_id: str, payload: Dict[str, Any], request: Request):
    _get_to_session_or_403(request)
    roster = payload.get("roster") or []
    if not event_id.startswith("ES-"):
        # Strictly BCP event: do not mutate local DB
        return {
            "success": True,
            "roster_count": len(roster),
            "event": {"id": event_id, "roster": roster, "total_players": len(roster)}
        }

    db = get_database()
    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    ev["roster"] = roster
    ev["total_players"] = len(roster)
    saved = db.save_studio_event(ev)

    return {
        "success": True,
        "roster_count": len(roster),
        "event": saved
    }

@router.delete("/api/eventstudio/event/{event_id}/player/{player_id}", summary="Remove competitor from tournament roster (OmniTactica & BCP)")
async def api_eventstudio_remove_player(event_id: str, player_id: str, request: Request):
    session = _get_to_session_or_403(request)
    user_id = session.get("id")
    auth_mgr = get_auth_manager()
    db = get_database()

    bcp_deleted = False
    bcp_err = None

    if not event_id.startswith("ES-"):
        # 1. Resolve BCP token: check caller's token first, then organizer token if available
        to_bcp_token = request.headers.get("X-BCP-Token") or request.query_params.get("bcp_token")
        if not to_bcp_token and user_id:
            to_bcp_token = auth_mgr.get_valid_bcp_token(user_id)

        ev = db.get_studio_event(event_id)
        if not to_bcp_token and ev and ev.get("organizer_id"):
            to_bcp_token = auth_mgr.get_valid_bcp_token(ev.get("organizer_id"))

        if not to_bcp_token and ev and ev.get("organizer_bcp_id"):
            with db.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT id FROM users WHERE bcp_user_id = %s LIMIT 1;", (ev.get("organizer_bcp_id"),))
                    urow = cur.fetchone()
                    if urow and urow[0]:
                        to_bcp_token = auth_mgr.get_valid_bcp_token(urow[0])

        is_team = False
        if isinstance(ev, dict):
            try:
                team_sz = int(ev.get("team_size") or 1)
                is_team = team_sz > 1 or ev.get("event_type") in ("Teams Event", "Doubles Event")
            except (ValueError, TypeError):
                is_team = False

        bcp_deleted, bcp_err = bcp_adapter.delete_player(
            player_id=player_id,
            event_id=event_id,
            user_id=user_id,
            explicit_token=to_bcp_token,
            is_team=is_team
        )
        if not bcp_deleted:
            logger.warning(f"Notice: BCP competitor removal returned: {bcp_err}")
            if bcp_err and "not found" not in bcp_err.lower():
                raise HTTPException(status_code=400, detail=f"Failed to remove competitor from BCP: {bcp_err}")

        # Invalidate any in-memory roster cache
        try:
            if _roster_cache and event_id in _roster_cache:
                del _roster_cache[event_id]
        except Exception:
            pass

        return {
            "success": True,
            "event_id": event_id,
            "player_id": player_id,
            "bcp_deleted": bcp_deleted
        }

    # OmniTactica-only event (ES-)
    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    roster = [p for p in (ev.get("roster") or []) if str(p.get("id") or p.get("player_id") or p.get("name") or "") != player_id]
    ev["roster"] = roster
    ev["total_players"] = len(roster)
    saved = db.save_studio_event(ev)

    return {
        "success": True,
        "event_id": event_id,
        "player_id": player_id,
        "roster_count": len(roster),
        "event": saved
    }

def generate_swiss_pairings_for_event(ev: Dict[str, Any], target_round: int) -> List[Dict[str, Any]]:
    """
    Computes Elo-enhanced Swiss pairings with rematch and team conflict avoidance.
    Can be called during event start (round 1) or subsequent rounds.
    """
    roster = [p for p in (ev.get("roster") or []) if not p.get("dropped")]
    if not roster or len(roster) < 2:
        return []

    pairings_map = ev.get("pairings") or {}

    # Calculate historical records and past opponents
    records: Dict[str, Dict[str, Any]] = {}
    past_opponents: Dict[str, set] = {}
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
            -float(p.get("elo") or p.get("current_elo") or p.get("currentElo") or 1500)
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

    # Swiss pairing algorithm (greedy with rematch avoidance and team conflict avoidance)
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

    # Format pairings list with Elo win probabilities and rematch warnings
    generated_pairings = []
    table_num = int(ev.get("startingTable") or 1)
    for p1, p2 in pairs:
        p1_id = str(p1.get("id") or p1.get("player_id") or p1.get("name"))
        p2_id = str(p2.get("id") or p2.get("player_id") or p2.get("name"))
        p1_elo = float(p1.get("elo") or p1.get("current_elo") or p1.get("currentElo") or 1500.0)
        p2_elo = float(p2.get("elo") or p2.get("current_elo") or p2.get("currentElo") or 1500.0)
        p1_team = (p1.get("team") or p1.get("club") or "").strip()
        p2_team = (p2.get("team") or p2.get("club") or "").strip()

        p1_prob = round(1.0 / (1.0 + 10.0 ** ((p2_elo - p1_elo) / 400.0)) * 100.0, 1)
        p2_prob = round(100.0 - p1_prob, 1)
        is_rematch = p2_id in past_opponents.get(p1_id, set())
        same_team = bool(p1_team and p2_team and p1_team.lower() == p2_team.lower())

        rematch_r = []
        for prev_r, p_list in pairings_map.items():
            if int(prev_r) < target_round:
                for pm in (p_list or []):
                    ids = {str(pm.get("p1_id") or ""), str(pm.get("p2_id") or "")}
                    if p1_id in ids and p2_id in ids:
                        try:
                            rematch_r.append(int(prev_r))
                        except Exception:
                            pass

        generated_pairings.append({
            "table": table_num,
            "p1_id": p1_id,
            "p1_name": p1.get("name") or "Player 1",
            "p1_faction": p1.get("faction") or "Unknown Faction",
            "p1_team": p1_team,
            "p1_elo": round(p1_elo, 1),
            "p1_win_prob": p1_prob,
            "p1_army_list": p1.get("army_list") or "",
            "p1_score": 0,
            "p2_id": p2_id,
            "p2_name": p2.get("name") or "Player 2",
            "p2_faction": p2.get("faction") or "Unknown Faction",
            "p2_team": p2_team,
            "p2_elo": round(p2_elo, 1),
            "p2_win_prob": p2_prob,
            "p2_army_list": p2.get("army_list") or "",
            "p2_score": 0,
            "is_rematch": is_rematch,
            "rematch_rounds": sorted(rematch_r),
            "same_team": same_team,
            "is_done": False,
            "is_bye": False
        })
        table_num += 1

    if bye_player:
        b_elo = float(bye_player.get("elo") or bye_player.get("current_elo") or bye_player.get("currentElo") or 1500.0)
        generated_pairings.append({
            "table": table_num,
            "p1_id": str(bye_player.get("id") or bye_player.get("player_id") or bye_player.get("name")),
            "p1_name": bye_player.get("name") or "Player",
            "p1_faction": bye_player.get("faction") or "Unknown Faction",
            "p1_team": bye_player.get("team") or "",
            "p1_elo": round(b_elo, 1),
            "p1_win_prob": 100.0,
            "p1_army_list": bye_player.get("army_list") or "",
            "p1_score": 100,
            "p2_id": None,
            "p2_name": "BYE",
            "p2_faction": "",
            "p2_team": "",
            "p2_elo": 0.0,
            "p2_win_prob": 0.0,
            "p2_army_list": "",
            "p2_score": 0,
            "is_rematch": False,
            "rematch_rounds": [],
            "same_team": False,
            "is_done": True,
            "is_bye": True
        })

    return generated_pairings

@router.post("/api/eventstudio/event/{event_id}/pairings/generate", summary="Generate automated Swiss pairings for tournament round (staged locally)")
async def api_eventstudio_generate_pairings(event_id: str, payload: Dict[str, Any], request: Request):
    _get_to_session_or_403(request)
    db = get_database()
    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    target_round = int(payload.get("round") or payload.get("round_num") or (ev.get("current_round") or 1))
    roster = [p for p in (ev.get("roster") or []) if not p.get("dropped")]
    if not roster or len(roster) < 2:
        raise HTTPException(status_code=400, detail="At least 2 active players required in roster to generate pairings")

    generated_pairings = generate_swiss_pairings_for_event(ev, target_round)

    pairings_map = ev.get("pairings") or {}
    pairings_map[str(target_round)] = generated_pairings
    ev["pairings"] = pairings_map
    ev["current_round"] = target_round
    ev["pairings_status"] = "staged"
    saved = db.save_studio_event(ev)

    return {
        "success": True,
        "round": target_round,
        "pairings": generated_pairings,
        "pairings_status": "staged",
        "bcp_generated": False,
        "event": saved,
        "message": f"Generated Round {target_round} Swiss pairings (staged locally). TO can inspect, swap players, and apply to BCP."
    }

@router.post("/api/eventstudio/event/{event_id}/pairings/swap", summary="Dynamically swap two competitors between tables before applying to BCP")
async def api_eventstudio_swap_pairings(event_id: str, payload: SwapPairingPayload, request: Request):
    _get_to_session_or_403(request)
    db = get_database()
    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    r_str = str(payload.round)
    pairings_map = ev.get("pairings") or {}
    round_pairings = list(pairings_map.get(r_str) or [])
    if not round_pairings:
        raise HTTPException(status_code=400, detail=f"No pairings found for Round {payload.round}")

    m1 = next((m for m in round_pairings if m.get("table") == payload.table1), None)
    m2 = next((m for m in round_pairings if m.get("table") == payload.table2), None)
    if not m1 or not m2:
        raise HTTPException(status_code=404, detail="One or both tables not found in round pairings")

    s1 = payload.slot1.lower()
    s2 = payload.slot2.lower()
    if s1 not in ("p1", "p2") or s2 not in ("p1", "p2"):
        raise HTTPException(status_code=400, detail="Invalid slot: must be 'p1' or 'p2'")

    fields = ["id", "name", "faction", "team", "elo", "army_list"]
    for f in fields:
        k1 = f"{s1}_{f}" if f != "army_list" else f"{s1}_army_list"
        k2 = f"{s2}_{f}" if f != "army_list" else f"{s2}_army_list"
        val1 = m1.get(k1)
        val2 = m2.get(k2)
        m1[k1] = val2
        m2[k2] = val1

    # Recalculate win probabilities and warnings for both modified tables
    for m in (m1, m2):
        e1 = float(m.get("p1_elo") or 1500.0)
        e2 = float(m.get("p2_elo") or 1500.0)
        m["p1_win_prob"] = round(1.0 / (1.0 + 10.0 ** ((e2 - e1) / 400.0)) * 100.0, 1)
        m["p2_win_prob"] = round(100.0 - m["p1_win_prob"], 1)

        t1 = (m.get("p1_team") or "").strip().lower()
        t2 = (m.get("p2_team") or "").strip().lower()
        m["same_team"] = bool(t1 and t2 and t1 == t2)

        pid1 = str(m.get("p1_id") or "")
        pid2 = str(m.get("p2_id") or "")
        rematch_r = []
        for prev_r, p_list in pairings_map.items():
            if prev_r != r_str:
                for pm in (p_list or []):
                    ids = {str(pm.get("p1_id") or ""), str(pm.get("p2_id") or "")}
                    if pid1 in ids and pid2 in ids:
                        try: rematch_r.append(int(prev_r))
                        except Exception: pass
        m["is_rematch"] = len(rematch_r) > 0
        m["rematch_rounds"] = sorted(rematch_r)

    ev["pairings"][r_str] = round_pairings
    ev["pairings_status"] = "staged"
    saved = db.save_studio_event(ev)

    return {
        "success": True,
        "round": payload.round,
        "pairings": round_pairings,
        "pairings_status": "staged",
        "message": f"Successfully swapped Table {payload.table1} ({payload.slot1.upper()}) and Table {payload.table2} ({payload.slot2.upper()}).",
        "event": saved
    }

@router.post("/api/eventstudio/event/{event_id}/pairings/apply_bcp", summary="Apply staged tournament pairings to Best Coast Pairings")
async def api_eventstudio_apply_pairings_bcp(event_id: str, payload: ApplyPairingsBcpPayload, request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    round_num = str(payload.round)
    pairings_map = ev.get("pairings") or {}
    pairings_list = pairings_map.get(round_num) or []
    if not pairings_list:
        raise HTTPException(status_code=400, detail=f"No pairings found for Round {round_num}")

    # Pre-seed deterministic tracker rooms for each table
    for p in pairings_list:
        t_num = p.get("table") or 1
        mid = f"BCP-{event_id}-R{round_num}-T{t_num}".upper()
        p1_name = p.get("p1_name") or "Player 1"
        p2_name = p.get("p2_name") or "Player 2"
        p1_fac = p.get("p1_faction") or ""
        p2_fac = p.get("p2_faction") or ""
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

    # Push to BCP
    bcp_pushed = False
    bcp_err = None
    if not event_id.startswith("ES-"):
        bcp_token = None
        if user_id:
            bcp_token = auth_mgr.get_valid_bcp_token(user_id)
        if not bcp_token and ev.get("organizer_id"):
            bcp_token = auth_mgr.get_valid_bcp_token(ev.get("organizer_id"))

        bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}/rounds/{round_num}/pairings"
        data, err = execute_bcp_api_call(bcp_url, method="POST", json_data={"pairings": pairings_list}, user_id=user_id, explicit_token=bcp_token)
        if data is not None or not err:
            bcp_pushed = True
            logger.info(f"✅ Pushed Round {round_num} pairings to BCP for {event_id}")
        else:
            bcp_err = err
            bcp_url2 = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}/pairings"
            data2, err2 = execute_bcp_api_call(bcp_url2, method="POST", json_data={"round": int(round_num), "pairings": pairings_list}, user_id=user_id, explicit_token=bcp_token)
            if data2 is not None or not err2:
                bcp_pushed = True
                logger.info(f"✅ Pushed Round {round_num} pairings to BCP fallback for {event_id}")

    ev["pairings_status"] = "applied"
    ev["pairings_bcp_synced"] = bcp_pushed
    saved = db.save_studio_event(ev)

    return {
        "success": True,
        "round": int(round_num),
        "pairings_count": len(pairings_list),
        "bcp_applied": bcp_pushed,
        "bcp_notice": bcp_err if not bcp_pushed and not event_id.startswith("ES-") else None,
        "pairings_status": "applied",
        "event": saved,
        "message": f"Round {round_num} pairings successfully applied to Best Coast Pairings!"
    }

@router.post("/api/eventstudio/event/{event_id}/pairings/publish", summary="Publish tournament round pairings on OmniTactica and BCP")
async def api_eventstudio_publish_pairings(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

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

@router.post("/api/eventstudio/event/{event_id}/pairings/unpublish", summary="Unpublish tournament round pairings on OmniTactica and BCP")
async def api_eventstudio_unpublish_pairings(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

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

@router.post("/api/eventstudio/event/{event_id}/round/finalize", summary="Finalize and lock round, advancing tournament round")
async def api_eventstudio_finalize_round(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

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

@router.post("/api/eventstudio/event/{event_id}/round/reset", summary="Reset a round for corrections")
async def api_eventstudio_reset_round(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

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

@router.post("/api/eventstudio/event/{event_id}/end", summary="End and archive tournament on OmniTactica and BCP")
async def api_eventstudio_end_tournament(event_id: str, request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

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

@router.get("/api/eventstudio/event/{event_id}/standings", summary="Compute live Swiss standings and tiebreaker metrics")
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

@router.post("/api/eventstudio/submit_score", summary="Submit table match score and sync with BCP")
async def api_eventstudio_submit_score(payload: SubmitScorePayload, request: Request):
    db = get_database()
    auth_mgr = get_auth_manager()
    
    # 1. Resolve native session & user
    auth_header = request.headers.get("Authorization", "")
    bearer_tok = auth_header[7:].strip() if auth_header.startswith("Bearer ") else None
    session_token = request.cookies.get("session_token")
    user = None
    if session_token:
        user = auth_mgr.get_session(session_token)
    if not user and bearer_tok:
        user = auth_mgr.get_session(bearer_tok)
    user_id = user["id"] if user else None

    # 2. Resolve BCP token (Payload > X-BCP-Token > User Linked Token > Bearer if not native session)
    bcp_token = payload.bcp_token or request.headers.get("X-BCP-Token")
    if not bcp_token and user_id:
        tok_dict = auth_mgr.get_valid_bcp_tokens(user_id)
        bcp_token = tok_dict.get("id_token") or tok_dict.get("access_token")
    if not bcp_token and not user and bearer_tok and bearer_tok.startswith("eyJ"):
        bcp_token = bearer_tok

    # 3. Fallback to event organizer BCP token if caller has none
    if not bcp_token and not payload.event_id.startswith("ES-"):
        try:
            ev_data, _ = bcp_adapter.fetch_event_details(payload.event_id)
            if ev_data and ev_data.get("ownerId"):
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT id FROM users WHERE bcp_user_id = %s LIMIT 1;", (ev_data["ownerId"],))
                        orow = cur.fetchone()
                        if orow:
                            to_toks = auth_mgr.get_valid_bcp_tokens(orow[0])
                            bcp_token = to_toks.get("id_token") or to_toks.get("access_token")
                            if not user_id:
                                user_id = orow[0]
        except Exception as oe:
            logger.debug(f"Notice resolving TO BCP token for event {payload.event_id}: {oe}")

    table_val = int(payload.table if payload.table is not None else (payload.table_num or 1))
    logger.info(f"EventStudio: Submitting Table {table_val} Round {payload.round_num} Score ({payload.p1_score} - {payload.p2_score}) Source: {payload.source_app}")
    
    # 4. Resolve live BCP pairing ID if missing for BCP-synced tournaments & extract competitor info
    bcp_pairing_id = payload.pairing_id if (payload.pairing_id and not str(payload.pairing_id).isdigit() and len(str(payload.pairing_id)) > 3) else None
    p1_id = getattr(payload, "p1_id", None)
    p2_id = getattr(payload, "p2_id", None)
    p1_name = payload.p1_name or "Player 1"
    p2_name = payload.p2_name or "Player 2"
    p1_fac = (payload.game_details or {}).get("p1_faction") or ""
    p2_fac = (payload.game_details or {}).get("p2_faction") or ""
    p1_gid = None
    p2_gid = None
    if isinstance(payload.game_details, dict):
        p1_gid = payload.game_details.get("p1_game_id") or payload.game_details.get("player1GameId")
        p2_gid = payload.game_details.get("p2_game_id") or payload.game_details.get("player2GameId")
        if not p1_id:
            p1_id = payload.game_details.get("p1_id") or payload.game_details.get("player1Id")
        if not p2_id:
            p2_id = payload.game_details.get("p2_id") or payload.game_details.get("player2Id")

    if (not bcp_pairing_id or not p1_gid or not p2_gid or not p1_id or not p2_id) and not payload.event_id.startswith("ES-"):
        canonical_event_id = _resolve_canonical_event_id(payload.event_id, user=user, explicit_token=bcp_token)
        try:
            res_p = bcp_adapter.fetch_event_pairings(canonical_event_id, payload.round_num, user_id=user_id, explicit_token=bcp_token)
            p_list = res_p[2] if isinstance(res_p, tuple) and len(res_p) >= 3 else (res_p if isinstance(res_p, list) else [])
            for p in p_list:
                t_val = p.get("table") or p.get("tableNumber") or p.get("table_number")
                p1_obj = p.get("player1") or {}
                p2_obj = p.get("player2") or {}
                u1 = p1_obj.get("user") if isinstance(p1_obj.get("user"), dict) else {}
                u2 = p2_obj.get("user") if isinstance(p2_obj.get("user"), dict) else {}

                pid_match = bool(bcp_pairing_id and (str(p.get("id") or "") == str(bcp_pairing_id) or str(p.get("bcp_pairing_id") or "") == str(bcp_pairing_id)))
                table_matches = (t_val == table_val or str(t_val) == str(table_val))
                p1_name_match = bool(payload.p1_name and (payload.p1_name.lower() in (str(p1_obj.get("name") or "").lower(), str(p2_obj.get("name") or "").lower())))

                if pid_match or table_matches or p1_name_match:
                    bcp_pairing_id = bcp_pairing_id or p.get("id") or p.get("bcp_pairing_id")
                    p1_id = p1_id or str(p1_obj.get("id") or p.get("player1Id") or u1.get("id") or "")
                    p2_id = p2_id or str(p2_obj.get("id") or p.get("player2Id") or u2.get("id") or "")
                    p1_name = payload.p1_name or p1_obj.get("name") or "Player 1"
                    p2_name = payload.p2_name or p2_obj.get("name") or "Player 2"
                    p1_fac = p1_fac or p1_obj.get("faction") or ""
                    p2_fac = p2_fac or p2_obj.get("faction") or ""
                    p1_g = p.get("player1Game") or {}
                    p2_g = p.get("player2Game") or {}
                    p1_gid = p1_gid or p.get("player1GameId") or (p1_g.get("id") if isinstance(p1_g, dict) else None)
                    p2_gid = p2_gid or p.get("player2GameId") or (p2_g.get("id") if isinstance(p2_g, dict) else None)
                    break
        except Exception as pe:
            logger.warning(f"Notice resolving live BCP pairing ID for table {table_val}: {pe}")

    p1_score = int(payload.p1_score)
    p2_score = int(payload.p2_score)
    is_draw = (p1_score == p2_score)
    winner_id = payload.winner_id
    if not winner_id and not is_draw:
        if p1_score > p2_score:
            winner_id = p1_id
        elif p2_score > p1_score:
            winner_id = p2_id
    loser_id = p2_id if (winner_id and winner_id == p1_id) else (p1_id if (winner_id and winner_id == p2_id) else None)

    # 5. Persist match scores immediately to OmniTactica database
    match_id = bcp_pairing_id or f"BCP-{payload.event_id}-R{payload.round_num}-T{table_val}"
    match_record = {
        "id": match_id,
        "event_id": payload.event_id,
        "round": int(payload.round_num),
        "table_number": int(table_val),
        "match_date": datetime.now(timezone.utc).isoformat(),
        "player1_id": p1_id or None,
        "player1_name": p1_name,
        "player1_faction": p1_fac,
        "player1_score": p1_score,
        "player2_id": p2_id or None,
        "player2_name": p2_name,
        "player2_faction": p2_fac,
        "player2_score": p2_score,
        "winner_id": winner_id,
        "loser_id": loser_id,
        "is_draw": is_draw,
        "is_bye": False,
        "is_done": True,
        "raw_json": {
            "source_app": payload.source_app,
            "pairing_id": bcp_pairing_id,
            "game_details": payload.game_details or {}
        }
    }
    # 5. Strictly for native EventStudio tournaments (ES-*), persist local match record
    if payload.event_id.startswith("ES-"):
        try:
            if hasattr(db, "upsert_match"):
                db.upsert_match(match_record)
        except Exception as me:
            logger.debug(f"Notice upserting match {match_id} into DB: {me}")

    # Tournament games retain their verified digital scorecard in PostgreSQL tracker_games and Firestore rooms.
    fs_engine = get_firestore_engine()
    target_rooms = {
        match_id,
        f"BCP-{payload.event_id}-R{payload.round_num}-T{table_val}",
        f"ES-{payload.event_id}-R{payload.round_num}-T{table_val}",
        f"WH40K-BCP-{payload.event_id}-R{payload.round_num}-T{table_val}"
    }
    if isinstance(payload.game_details, dict) and payload.game_details.get("match_id"):
        target_rooms.add(str(payload.game_details["match_id"]).strip().upper())

    persisted_state = None
    for mid_clean in target_rooms:
        if mid_clean:
            norm_mid = normalize_tracker_match_id(mid_clean)
            r = fs_engine.get_room(norm_mid) or TRACKER_ROOMS.get(norm_mid)
            if r and isinstance(r.get("state"), dict):
                persisted_state = dict(r["state"])
                break

    if not persisted_state:
        persisted_state = {
            "event_id": payload.event_id,
            "round_num": int(payload.round_num),
            "table_num": int(table_val),
            "started": True,
            "is_finished": True,
            "bcp_submitted": True,
            "p1Score": int(payload.p1_score),
            "p2Score": int(payload.p2_score),
            "game": {
                "eventId": payload.event_id,
                "roundNum": int(payload.round_num),
                "tableNum": int(table_val),
                "p1Name": p1_name,
                "p2Name": p2_name,
                "p1Faction": p1_fac,
                "p2Faction": p2_fac,
                "p1Score": int(payload.p1_score),
                "p2Score": int(payload.p2_score),
                "primary": (payload.game_details or {}).get("primary") or "Take & Hold",
                "deployment": (payload.game_details or {}).get("deployment") or "Search & Destroy",
                "firstTurn": (payload.game_details or {}).get("first_turn") or (payload.game_details or {}).get("firstTurn") or 1,
            },
            "p1": {
                "name": p1_name,
                "faction": p1_fac,
                "score": int(payload.p1_score),
                "battleReady": True,
                "rounds": [{"round": r, "primaryScore": int(payload.p1_score) // 5} for r in range(1, 6)]
            },
            "p2": {
                "name": p2_name,
                "faction": p2_fac,
                "score": int(payload.p2_score),
                "battleReady": True,
                "rounds": [{"round": r, "primaryScore": int(payload.p2_score) // 5} for r in range(1, 6)]
            }
        }
    else:
        persisted_state["is_finished"] = True
        persisted_state["started"] = True
        persisted_state["bcp_submitted"] = True
        persisted_state["event_id"] = payload.event_id
        persisted_state["round_num"] = int(payload.round_num)
        persisted_state["table_num"] = int(table_val)
        if "game" in persisted_state and isinstance(persisted_state["game"], dict):
            persisted_state["game"]["p1Score"] = int(payload.p1_score)
            persisted_state["game"]["p2Score"] = int(payload.p2_score)
        if "p1" in persisted_state and isinstance(persisted_state["p1"], dict):
            persisted_state["p1"]["score"] = int(payload.p1_score)
        if "p2" in persisted_state and isinstance(persisted_state["p2"], dict):
            persisted_state["p2"]["score"] = int(payload.p2_score)

    # 1. Permanently persist verified digital scorecard in PostgreSQL tracker_games
    try:
        db.save_tracker_game(match_id, persisted_state, user_id_p1=p1_id, user_id_p2=p2_id)
    except Exception as se:
        logger.warning(f"Notice saving tracker game to DB from Event Studio: {se}")

    # 2. Concluded match room is discarded / removed from Firestore and memory
    for mid_clean in target_rooms:
        if mid_clean:
            norm_mid = normalize_tracker_match_id(mid_clean)
            try:
                fs_engine.discard_room(norm_mid)
            except Exception as fe:
                logger.debug(f"Notice discarding Firestore room {norm_mid}: {fe}")
            if norm_mid in TRACKER_ROOMS:
                try:
                    del TRACKER_ROOMS[norm_mid]
                except KeyError:
                    pass

    try:
        from routers.tracker import TRACKER_LISTENERS
        for mid_clean in target_rooms:
            norm_mid = normalize_tracker_match_id(mid_clean)
            for q in list(TRACKER_LISTENERS.get(norm_mid, [])):
                try:
                    q.put_nowait({
                        "type": "match_finalized",
                        "match_id": norm_mid,
                        "status": "completed",
                        "is_finished": True,
                        "bcp_submitted": True,
                        "scorecard_url": f"/scorecard/{urllib.parse.quote(match_id)}"
                    })
                except Exception:
                    pass
    except Exception as le:
        logger.debug(f"Notice notifying listeners of match finalization: {le}")
    except Exception:
        pass

    # 6. Strictly for native EventStudio tournaments (ES-*), update local draft
    if payload.event_id.startswith("ES-"):
        ev = db.get_studio_event(payload.event_id)
        if ev:
            pairings_map = ev.get("pairings") or {}
            round_pairings = pairings_map.get(str(payload.round_num)) or []
            for match in round_pairings:
                if match.get("table") == table_val or str(match.get("table")) == str(table_val):
                    match["p1_score"] = payload.p1_score
                    match["p2_score"] = payload.p2_score
                    match["is_done"] = True
                    if not bcp_pairing_id:
                        bcp_pairing_id = match.get("bcp_pairing_id") or match.get("id")
                    break
            pairings_map[str(payload.round_num)] = round_pairings
            ev["pairings"] = pairings_map
            db.save_studio_event(ev)

    # 7. Push to BCP via BcpAdapter if pairing ID is known
    bcp_synced = False
    bcp_notice = None
    if bcp_pairing_id and not payload.event_id.startswith("ES-"):
        submit_game_data = dict(payload.game_details or {})
        if winner_id and "winner_id" not in submit_game_data:
            submit_game_data["winner_id"] = str(winner_id)
        if p1_gid and "p1_game_id" not in submit_game_data:
            submit_game_data["p1_game_id"] = str(p1_gid)
        if p2_gid and "p2_game_id" not in submit_game_data:
            submit_game_data["p2_game_id"] = str(p2_gid)
        if p1_id and "p1_id" not in submit_game_data:
            submit_game_data["p1_id"] = str(p1_id)
        if p2_id and "p2_id" not in submit_game_data:
            submit_game_data["p2_id"] = str(p2_id)
        first_turn_val = payload.first_turn or submit_game_data.get("first_turn") or submit_game_data.get("firstTurn")
        if first_turn_val:
            submit_game_data["first_turn"] = first_turn_val
            submit_game_data["firstTurn"] = first_turn_val
        layout_val = payload.layout or payload.terrain_layout or submit_game_data.get("layout") or submit_game_data.get("terrain_layout") or submit_game_data.get("terrainLayout")
        if layout_val:
            submit_game_data["layout"] = str(layout_val)
            submit_game_data["terrain_layout"] = str(layout_val)
            submit_game_data["terrainLayout"] = str(layout_val)
        bcp_synced, bcp_err = bcp_adapter.submit_pairing_scores(
            pairing_id=bcp_pairing_id,
            p1_score=payload.p1_score,
            p2_score=payload.p2_score,
            game_data=submit_game_data,
            user_id=user_id,
            explicit_token=bcp_token,
            winner_id=winner_id
        )
        if not bcp_synced:
            bcp_notice = bcp_err
    elif not payload.event_id.startswith("ES-"):
        bcp_notice = f"Could not resolve BCP pairing ID for table {table_val} round {payload.round_num}"
        logger.warning(f"⚠️ {bcp_notice}")

    return {
        "success": True,
        "event_id": payload.event_id,
        "table": table_val,
        "round_num": payload.round_num,
        "p1_score": payload.p1_score,
        "p2_score": payload.p2_score,
        "pairing_id": bcp_pairing_id,
        "p1_game_id": p1_gid,
        "p2_game_id": p2_gid,
        "p1_id": p1_id,
        "p2_id": p2_id,
        "winner_id": winner_id,
        "source_app": payload.source_app,
        "bcp_synced": bcp_synced,
        "bcp_notice": bcp_notice
    }

class JudgeCallCreatePayload(BaseModel):
    event_id: Optional[str] = None
    eventId: Optional[str] = None
    call_id: Optional[str] = None
    callId: Optional[str] = None
    id: Optional[str] = None
    table_num: Optional[Union[int, str]] = None
    tableNum: Optional[Union[int, str]] = None
    tableNumber: Optional[Union[int, str]] = None
    table: Optional[Union[int, str]] = None
    match_id: Optional[str] = None
    matchId: Optional[str] = None
    player_name: Optional[str] = "Competitor"
    playerName: Optional[str] = None
    caller_name: Optional[str] = None
    callerName: Optional[str] = None
    category: Optional[str] = "Rules Dispute"
    note: Optional[str] = ""
    notes: Optional[str] = None
    caller: Optional[Union[str, Dict[str, Any]]] = None
    opponent: Optional[Union[str, Dict[str, Any]]] = None
    created_at: Optional[Union[int, float, str]] = None
    createdAt: Optional[Union[int, float, str]] = None

class JudgeCallResolvePayload(BaseModel):
    call_id: Optional[str] = None
    callId: Optional[str] = None
    id: Optional[str] = None
    event_id: Optional[str] = None
    eventId: Optional[str] = None
    match_id: Optional[str] = None
    matchId: Optional[str] = None
    status: Optional[str] = "resolved"
    assigned_judge: Optional[Union[str, Dict[str, Any]]] = None
    assignedJudge: Optional[Union[str, Dict[str, Any]]] = None

class StudioMasterClockPayload(BaseModel):
    status: Optional[str] = "running"
    round: Optional[int] = 1
    duration_minutes: Optional[int] = None
    durationMinutes: Optional[int] = None
    target_end_time: Optional[float] = None
    targetEndTime: Optional[float] = None
    remaining_seconds: Optional[int] = None
    remainingSeconds: Optional[int] = None
    updated_at: Optional[float] = None
    updatedAt: Optional[float] = None

class StudioBroadcastPayload(BaseModel):
    message: str
    type: Optional[str] = "info"
    round: Optional[int] = None

@router.post("/api/eventstudio/judge_call", summary="Submit judge / TO floor assistance call from game room")
async def api_eventstudio_create_judge_call(payload: JudgeCallCreatePayload):
    raw_t = payload.table_num if payload.table_num is not None else (payload.tableNum if payload.tableNum is not None else (payload.tableNumber if payload.tableNumber is not None else payload.table))
    t_num = None
    if raw_t is not None:
        try:
            t_num = int(raw_t)
        except Exception:
            t_num = 1
            
    import uuid as _uuid
    call_id = payload.call_id or payload.callId or payload.id or f"JC-{_uuid.uuid4().hex[:8].upper()}"
    eid = payload.event_id or payload.eventId or ""
    mid = payload.match_id or payload.matchId or ""
    if not eid and mid:
        import re as _re
        m_eid = _re.search(r'(?:BCP|ES)-([A-Za-z0-9_-]+)-R\d+', str(mid))
        if m_eid:
            eid = m_eid.group(1)
    if eid:
        canonical_eid = _resolve_canonical_event_id(eid)
        if canonical_eid:
            eid = canonical_eid
    p_name = payload.player_name or payload.playerName or payload.caller_name or payload.callerName or (payload.caller.get("playerName") if isinstance(payload.caller, dict) else (payload.caller if isinstance(payload.caller, str) else "Competitor"))
    c_note = payload.note or payload.notes or ""
    fs_engine = get_firestore_engine()
    
    call_record = {
        "id": call_id,
        "call_id": call_id,
        "eventId": eid,
        "event_id": eid,
        "tableNum": t_num or 1,
        "table_num": t_num or 1,
        "matchId": mid,
        "match_id": mid,
        "caller": payload.caller or {"playerName": p_name},
        "callerName": p_name,
        "player_name": p_name,
        "opponent": payload.opponent,
        "category": payload.category or "Rules Dispute",
        "note": c_note,
        "notes": c_note,
        "status": "pending",
        "assignedJudge": None,
        "assigned_judge": None,
        "createdAt": int(datetime.now(timezone.utc).timestamp() * 1000),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    # Primary: Save to Firestore
    res = fs_engine.save_judge_call(eid, call_record)
    
    # Broadcast to in-memory & Firestore tracker room if match_id is present
    if payload.match_id:
        mid = normalize_tracker_match_id(payload.match_id)
        if mid in TRACKER_ROOMS:
            TRACKER_ROOMS[mid]["active_judge_call"] = res
        try:
            fs_engine.update_room(mid, {"active_judge_call": res})
        except Exception:
            pass
        try:
            from routers.tracker import TRACKER_LISTENERS
            listeners = TRACKER_LISTENERS.get(mid, [])
            j_msg = {"type": "judge_call_update", "active_judge_call": res}
            for q in list(listeners):
                try:
                    q.put_nowait(j_msg)
                except Exception:
                    pass
        except Exception:
            pass

    return {"success": True, "call": res}

@router.get("/api/eventstudio/judge_calls", summary="List active judge calls for a tournament")
async def api_eventstudio_get_judge_calls(event_id: str, active_only: bool = False):
    fs_engine = get_firestore_engine()
    canonical_eid = _resolve_canonical_event_id(event_id) if event_id else event_id
    calls = fs_engine.list_judge_calls(event_id=canonical_eid or event_id, active_only=active_only)
    return {"success": True, "event_id": canonical_eid or event_id, "calls": calls}

@router.post("/api/eventstudio/judge_call/resolve", summary="Update judge call status (en_route, resolved, cancelled)")
async def api_eventstudio_resolve_judge_call(payload: JudgeCallResolvePayload):
    fs_engine = get_firestore_engine()
    event_id = payload.event_id or payload.eventId or ""
    call_id = payload.call_id or payload.callId or payload.id or ""
    
    if event_id:
        canonical_eid = _resolve_canonical_event_id(event_id)
        if canonical_eid:
            event_id = canonical_eid
    # Look up call if event_id not provided
    if not event_id:
        for eid, calls in fs_engine._fallback_judge_calls.items():
            if call_id in calls:
                event_id = eid
                break
                
    status = payload.status or "resolved"
    assigned = payload.assigned_judge or payload.assignedJudge
    if isinstance(assigned, str):
        assigned = {"name": assigned}
        
    ok = fs_engine.update_judge_call_status(
        event_id=event_id,
        call_id=call_id,
        status=status,
        assigned_judge=assigned
    )
    
    # Also update match room if match_id is known
    match_id = payload.match_id or payload.matchId
    if not match_id and event_id and event_id in fs_engine._fallback_judge_calls:
        match_id = fs_engine._fallback_judge_calls[event_id].get(call_id, {}).get("matchId")
        
    if match_id:
        mid = normalize_tracker_match_id(match_id)
        if status in ("resolved", "cancelled"):
            if mid in TRACKER_ROOMS:
                TRACKER_ROOMS[mid]["active_judge_call"] = None
            try:
                fs_engine.update_room(mid, {"active_judge_call": None})
            except Exception:
                pass
            try:
                from routers.tracker import TRACKER_LISTENERS
                listeners = TRACKER_LISTENERS.get(mid, [])
                j_msg = {
                    "type": "judge_call_update",
                    "active_judge_call": None,
                    "judge_call": None,
                    "call_id": call_id,
                    "status": status
                }
                for q in list(listeners):
                    try:
                        q.put_nowait(j_msg)
                    except Exception:
                        pass
            except Exception:
                pass
        else:
            room_judge_state = {
                "id": call_id,
                "call_id": call_id,
                "status": status,
                "assignedJudge": assigned,
                "assigned_judge": payload.assigned_judge if isinstance(payload.assigned_judge, str) else (assigned.get("name") if isinstance(assigned, dict) else None)
            }
            if mid in TRACKER_ROOMS:
                TRACKER_ROOMS[mid]["active_judge_call"] = room_judge_state
            try:
                fs_engine.update_room(mid, {"active_judge_call": room_judge_state})
            except Exception:
                pass
            try:
                from routers.tracker import TRACKER_LISTENERS
                listeners = TRACKER_LISTENERS.get(mid, [])
                j_msg = {
                    "type": "judge_call_update",
                    "active_judge_call": room_judge_state,
                    "judge_call": room_judge_state,
                    "call_id": call_id,
                    "status": status
                }
                for q in list(listeners):
                    try:
                        q.put_nowait(j_msg)
                    except Exception:
                        pass
            except Exception:
                pass

    return {"success": True, "call_id": call_id, "status": status, "assigned_judge": assigned}

@router.post("/api/eventstudio/event/{event_id}/clock", summary="Update tournament round master clock")
async def api_eventstudio_update_clock(event_id: str, payload: StudioMasterClockPayload):
    fs_engine = get_firestore_engine()
    dur = payload.durationMinutes if payload.durationMinutes is not None else (payload.duration_minutes or 150)
    target_end = payload.targetEndTime if payload.targetEndTime is not None else payload.target_end_time
    rem_sec = payload.remainingSeconds if payload.remainingSeconds is not None else payload.remaining_seconds
    clock_data = {
        "status": payload.status or "running",
        "round": payload.round or 1,
        "durationMinutes": dur,
        "duration_minutes": dur,
        "targetEndTime": target_end,
        "target_end_time": target_end,
        "remainingSeconds": rem_sec,
        "remaining_seconds": rem_sec,
    }
    updated = fs_engine.update_tournament_master_clock(event_id, clock_data)

    # Propagate to in-memory table rooms and notify active SSE listeners
    try:
        from routers.tracker import TRACKER_ROOMS, TRACKER_LISTENERS
        clean_eid = event_id.replace("bcp_", "").replace("ES-", "").replace("es-", "").strip().upper()
        for mid, rdata in list(TRACKER_ROOMS.items()):
            mid_u = str(mid).upper()
            if (
                rdata.get("eventId") == event_id or
                rdata.get("event_id") == event_id or
                rdata.get("tournament_id") == event_id or
                clean_eid in mid_u
            ):
                rdata["masterClock"] = updated
                listeners = TRACKER_LISTENERS.get(mid, [])
                clock_msg = {"type": "master_clock_update", "masterClock": updated}
                for q in list(listeners):
                    try:
                        q.put_nowait(clock_msg)
                    except Exception:
                        pass
    except Exception as e:
        logger.debug(f"Notice broadcasting clock to room listeners: {e}")

    return {"success": True, "event_id": event_id, "masterClock": updated, "clock": updated}

@router.get("/api/eventstudio/event/{event_id}/clock", summary="Get tournament round master clock")
async def api_eventstudio_get_clock(event_id: str):
    fs_engine = get_firestore_engine()
    clock = fs_engine.get_tournament_master_clock(event_id) or {"status": "stopped", "round": 1, "remainingSeconds": 9000}
    return {"success": True, "event_id": event_id, "masterClock": clock, "clock": clock}

@router.post("/api/eventstudio/event/{event_id}/broadcast", summary="Publish tournament live broadcast announcement")
async def api_eventstudio_publish_broadcast(event_id: str, payload: StudioBroadcastPayload):
    fs_engine = get_firestore_engine()
    broadcast_data = {
        "message": payload.message,
        "type": payload.type or "info",
        "round": payload.round
    }
    res = fs_engine.publish_tournament_broadcast(event_id, broadcast_data)

    # Propagate broadcast to active table rooms and SSE listeners
    try:
        from routers.tracker import TRACKER_ROOMS, TRACKER_LISTENERS
        clean_eid = event_id.replace("bcp_", "").replace("ES-", "").replace("es-", "").strip().upper()
        for mid, rdata in list(TRACKER_ROOMS.items()):
            mid_u = str(mid).upper()
            if (
                rdata.get("eventId") == event_id or
                rdata.get("event_id") == event_id or
                rdata.get("tournament_id") == event_id or
                clean_eid in mid_u
            ):
                rdata["broadcast"] = res
                listeners = TRACKER_LISTENERS.get(mid, [])
                b_msg = {"type": "broadcast_update", "broadcast": res}
                for q in list(listeners):
                    try:
                        q.put_nowait(b_msg)
                    except Exception:
                        pass
    except Exception:
        pass

    return {"success": True, "event_id": event_id, "broadcast": res}

@router.get("/api/eventstudio/event/{event_id}/broadcast", summary="Get tournament live broadcast announcement")
async def api_eventstudio_get_broadcast(event_id: str):
    fs_engine = get_firestore_engine()
    b = fs_engine.get_tournament_broadcast(event_id)
    return {"success": True, "event_id": event_id, "broadcast": b}

class PodGeneratePayload(BaseModel):
    pod_size: Optional[int] = 4
    num_pods: Optional[int] = 2
    target_round: Optional[int] = None

@router.post("/api/eventstudio/event/{event_id}/pods/generate", summary="Automate multi-day Pod & Bracket progression")
async def api_eventstudio_generate_pods(event_id: str, payload: PodGeneratePayload):
    db = get_database()
    res = db.generate_day2_pod_brackets(
        event_id=event_id,
        pod_size=payload.pod_size or 4,
        num_pods=payload.num_pods or 2,
        target_round=payload.target_round
    )
    return res

@router.get("/api/eventstudio/match_predictor", summary="Predict tactical matchup outcome, win probability, and score differential")
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

@router.post("/api/eventstudio/wtc_draft", summary="Save active WTC team captain pairing draft state")
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

@router.get("/api/eventstudio/wtc_draft", summary="Get WTC team captain pairing draft state")
async def api_eventstudio_get_wtc_draft(event_id: str, round_num: int):
    db = get_database()
    res = db.get_wtc_draft(event_id=event_id, round_num=round_num)
    return {"success": True, "event_id": event_id, "round_num": round_num, "draft": res}


