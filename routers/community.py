"""Regional Community Hub, Local Game Stores & Discovery Router."""
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
    TRACKER_ROOMS, TRACKER_LISTENERS, generate_unique_match_id, normalize_tracker_match_id,
    normalize_ticket_price
)

router = APIRouter(tags=["Regional Community Hub"])

import concurrent.futures

_community_field_stats_cache: Dict[str, Any] = {}

# =========================================================================
# REGIONAL COMMUNITY HUB & COMPETITOR DISCOVERY
# =========================================================================

@router.get("/api/community/regions", summary="Get Available Community Hub Regions")
async def api_community_regions():
    db = get_database()
    return {"success": True, "regions": db.get_community_regions()}

@router.get("/api/community/reverse_geocode", summary="Reverse Geocode GPS Coordinates to City / Region")
async def api_community_reverse_geocode(
    lat: float = Query(..., description="Latitude"),
    lng: float = Query(..., description="Longitude")
):
    db = get_database()
    res = db.reverse_geocode_coordinates(lat, lng)
    return {"success": True, **res}

@router.get("/api/community/overview", summary="Get Community Hub Overview, Events, and Competitors within Radius")
async def api_community_overview(
    request: Request,
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radius_miles: float = Query(50.0),
    location_name: Optional[str] = Query(None),
    region: Optional[str] = Query(None),
    token: Optional[str] = Query(None),
    include_bcp: bool = Query(False),
    game_system: Optional[str] = Query("40k")
):
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    user_id = user["id"] if user else None
    player_id = user.get("player_id") or user.get("bcp_user_id") if user else None

    db = get_database()
    return db.get_community_overview(
        lat=lat,
        lng=lng,
        radius_miles=radius_miles,
        location_name=location_name,
        region=region,
        current_user_id=user_id,
        current_player_id=player_id,
        include_bcp=include_bcp,
        game_system=game_system
    )

@router.get("/api/community/bcp_upcoming", summary="Fetch live BCP upcoming tournaments asynchronously")
async def api_community_bcp_upcoming(
    lat: float = Query(...),
    lng: float = Query(...),
    radius_miles: float = Query(50.0),
    days_ahead: int = Query(92),
    game_system: Optional[str] = Query("40k")
):
    db = get_database()
    events = db.fetch_bcp_upcoming_events(user_lat=lat, user_lng=lng, radius_miles=radius_miles, days_ahead=days_ahead, game_system=game_system)
    return {"success": True, "events": events}

_community_field_stats_cache: Dict[str, Dict[str, Any]] = {}

def compute_live_bcp_field_stats(eid: str, db, game_system: Optional[str] = "40k") -> Dict[str, Any]:
    """Fetches live roster from BCP API and computes field avg / top seed Elo without mutating backend DB."""
    try:
        target_sys = "aos" if (game_system or "").lower() == "aos" else "40k"
        s = BestCoastPairingsScraper(db=db, request_delay=0.0)
        roster = s.fetch_event_players(eid)
        if not roster:
            roster = s.fetch_event_teams(eid)
        if not roster:
            return {
                "event_id": eid,
                "avg_field_elo": None,
                "top_seed_elo": None,
                "total_enrolled": 0,
                "rated_players_count": 0,
                "status": "empty"
            }

        candidate_pids = set()
        candidate_names = set()
        for p in roster:
            u = p.get("user") or {}
            for k in (u.get("id"), p.get("userId"), p.get("id"), u.get("userId")):
                if k:
                    candidate_pids.add(str(k))
            fn = u.get("firstName") or p.get("firstName") or ""
            ln = u.get("lastName") or p.get("lastName") or ""
            name = f"{fn} {ln}".strip() or p.get("name")
            if name:
                candidate_names.add(name.strip().lower())

        ratings_by_id = {}
        ratings_by_name = {}
        if candidate_pids or candidate_names:
            try:
                with db.get_connection() as conn:
                    cursor_factory = getattr(extras, "RealDictCursor", None) if extras else None
                    cursor_kw = {"cursor_factory": cursor_factory} if cursor_factory else {}
                    with conn.cursor(**cursor_kw) as cursor:
                        cursor.execute("""
                            SELECT player_id, player_name, current_elo
                            FROM player_ratings
                            WHERE (player_id = ANY(%s) OR (player_name IS NOT NULL AND LOWER(player_name) = ANY(%s)))
                              AND COALESCE(game_system, '40k') = %s;
                        """, (list(candidate_pids), list(candidate_names), target_sys))
                        for row in cursor.fetchall():
                            if isinstance(row, dict) or hasattr(row, "keys"):
                                r = dict(row)
                                pid = r.get("player_id")
                                pname = r.get("player_name")
                                elo = r.get("current_elo")
                            elif isinstance(row, (list, tuple)):
                                pid = row[0] if len(row) > 0 else None
                                pname = row[1] if len(row) > 1 else None
                                elo = row[2] if len(row) > 2 else 1500.0
                            else:
                                continue
                            if pid:
                                ratings_by_id[str(pid)] = float(elo or 1500.0)
                            if pname:
                                ratings_by_name[str(pname).strip().lower()] = float(elo or 1500.0)
            except Exception as ex:
                logger.debug(f"Read-only player ratings query notice for {eid}: {ex}")

        elos = []
        rated_count = 0
        for p in roster:
            u = p.get("user") or {}
            matched_elo = None
            for k in (u.get("id"), p.get("userId"), p.get("id"), u.get("userId")):
                if k and str(k) in ratings_by_id:
                    matched_elo = ratings_by_id[str(k)]
                    break
            if matched_elo is None:
                fn = u.get("firstName") or p.get("firstName") or ""
                ln = u.get("lastName") or p.get("lastName") or ""
                name = f"{fn} {ln}".strip() or p.get("name")
                if name and name.strip().lower() in ratings_by_name:
                    matched_elo = ratings_by_name[name.strip().lower()]

            if matched_elo is not None:
                rated_count += 1
                elos.append(matched_elo)
            else:
                elos.append(1500.0)

        avg_field_elo = round(sum(elos) / len(elos), 1) if elos else 1500.0
        top_seed_elo = max(elos) if elos else 1500.0

        return {
            "event_id": eid,
            "avg_field_elo": avg_field_elo,
            "top_seed_elo": top_seed_elo,
            "total_enrolled": len(roster),
            "rated_players_count": rated_count,
            "status": "active"
        }
    except Exception as e:
        logger.debug(f"compute_live_bcp_field_stats notice for {eid}: {e}")
        return {
            "event_id": eid,
            "avg_field_elo": None,
            "top_seed_elo": None,
            "total_enrolled": 0,
            "rated_players_count": 0,
            "status": "empty"
        }


@router.get("/api/community/events/field_stats", summary="Get or compute live average field Elo and top seed Elo")
@router.post("/api/community/events/field_stats", summary="Get or compute live average field Elo and top seed Elo")
async def api_community_events_field_stats(
    request: Request,
    event_ids: Optional[str] = Query(None, description="Comma-separated event IDs"),
    game_system: Optional[str] = Query("40k")
):
    target_ids: List[str] = []
    target_sys = "aos" if (game_system or "").lower() == "aos" else "40k"
    if event_ids:
        target_ids.extend([eid.strip() for eid in event_ids.split(",") if eid.strip()])
    if request.method == "POST":
        try:
            body = await request.json()
            if isinstance(body, dict):
                if body.get("game_system"):
                    target_sys = "aos" if str(body["game_system"]).strip().lower() == "aos" else "40k"
                t_list = body.get("event_ids") or body.get("ids") or []
                if isinstance(t_list, list):
                    target_ids.extend([str(x).strip() for x in t_list if str(x).strip()])
            elif isinstance(body, list):
                target_ids.extend([str(x).strip() for x in body if str(x).strip()])
        except Exception:
            pass

    if not target_ids:
        return {"success": True, "stats": {}}

    # Deduplicate and cap at 30 events per request
    target_ids = list(dict.fromkeys(target_ids))[:30]

    now_ts = time.time()
    results: Dict[str, Any] = {}
    missing_ids: List[str] = []

    # Check in-memory cache first (15-minute TTL for populated stats, 60s for empty stats)
    for eid in target_ids:
        c_key = f"{eid}:{target_sys}"
        cached = _community_field_stats_cache.get(c_key)
        if cached:
            ttl = 900 if int(cached.get("stats", {}).get("total_enrolled") or 0) > 0 else 60
            if (now_ts - cached.get("timestamp", 0) < ttl):
                results[eid] = cached.get("stats", {})
                continue
        missing_ids.append(eid)

    if missing_ids:
        db = get_database()
        # 1. Query existing DB participants (read-only)
        db_stats = db.get_events_field_stats(missing_ids, game_system=target_sys)
        need_bcp_sync: List[str] = []

        for eid in missing_ids:
            c_key = f"{eid}:{target_sys}"
            stat = db_stats.get(eid)
            # If DB already has participants from prior scraping, cache and return
            if stat and int(stat.get("total_enrolled") or 0) > 0:
                results[eid] = stat
                _community_field_stats_cache[c_key] = {
                    "timestamp": now_ts,
                    "stats": stat
                }
            else:
                need_bcp_sync.append(eid)

        # 2. For events without participants in DB, compute live from BCP API (strictly zero DB writes)
        if need_bcp_sync:
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(need_bcp_sync))) as executor:
                future_map = {executor.submit(compute_live_bcp_field_stats, eid, db, target_sys): eid for eid in need_bcp_sync}
                done, not_done = concurrent.futures.wait(future_map.keys(), timeout=6.0)
                for fut in done:
                    eid = future_map[fut]
                    c_key = f"{eid}:{target_sys}"
                    try:
                        stat = fut.result()
                    except Exception:
                        stat = {
                            "event_id": eid,
                            "avg_field_elo": None,
                            "top_seed_elo": None,
                            "total_enrolled": 0,
                            "rated_players_count": 0,
                            "status": "empty"
                        }
                    results[eid] = stat
                    _community_field_stats_cache[c_key] = {
                        "timestamp": now_ts,
                        "stats": stat
                    }
                for fut in not_done:
                    eid = future_map[fut]
                    empty_stat = {
                        "event_id": eid,
                        "avg_field_elo": None,
                        "top_seed_elo": None,
                        "total_enrolled": 0,
                        "rated_players_count": 0,
                        "status": "empty"
                    }
                    results[eid] = empty_stat
                    _community_field_stats_cache[eid] = {
                        "timestamp": now_ts,
                        "stats": empty_stat
                    }

    return {
        "success": True,
        "count": len(results),
        "stats": results
    }

@router.get("/api/community/stores", summary="Find local game stores and clubs for Warhammer 40k")
async def api_community_stores(
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radius_miles: float = Query(50.0),
    query: Optional[str] = Query(None),
    location_name: Optional[str] = Query(None)
):
    db = get_database()
    return db.get_local_game_stores(
        lat=lat,
        lng=lng,
        radius_miles=radius_miles,
        query=query,
        location_name=location_name
    )

@router.get("/api/community/store/tournaments", summary="Get all tournaments hosted by a local game store")
async def api_community_store_tournaments(
    name: str = Query(..., description="Store or venue name"),
    lat: Optional[float] = Query(None, description="Store latitude"),
    lng: Optional[float] = Query(None, description="Store longitude"),
    place_id: Optional[str] = Query(None, description="Google Place ID")
):
    db = get_database()
    return db.get_store_tournaments(
        store_name=name,
        lat=lat,
        lng=lng,
        place_id=place_id
    )

@router.get("/api/community/store/details", summary="Get Google Place Details including store website")
async def api_community_store_details(
    place_id: str = Query(..., description="Google Place ID")
):
    db = get_database()
    return db.get_place_details(place_id=place_id)

@router.get("/api/community/chat/messages", summary="Get Regional Community Chat Messages")
async def api_community_chat_messages(
    region: str = Query("socal"),
    limit: int = Query(50)
):
    db = get_database()
    return {"success": True, "messages": db.get_community_chat_messages(region=region, limit=limit)}

class CommunityChatMessagePayload(BaseModel):
    region: str = "socal"
    message: str

@router.post("/api/community/chat/message", summary="Send Message in Regional Community Chat")
async def api_community_chat_send(
    payload: CommunityChatMessagePayload,
    request: Request,
    token: Optional[str] = Query(None)
):
    session = _get_user_session_or_401(request, token)
    db = get_database()
    res = db.save_community_chat_message(
        region=payload.region,
        sender_id=session["id"],
        sender_name=session.get("display_name") or session.get("email") or "Competitor",
        sender_role=session.get("role") or "player",
        sender_elo=session.get("current_elo"),
        message_text=payload.message
    )
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to send message"))
    return res


# =========================================================================
# COMMUNITY HUB: EVENT REGISTRATION FLOW (TIERED: FREE / PAID / EXTERNAL / CLOSED)
# =========================================================================

class CommunityEventRegisterPayload(BaseModel):
    name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    team: Optional[str] = None
    faction: Optional[str] = None
    army_id: Optional[str] = None
    faction_name: Optional[str] = None
    detachment: Optional[str] = None
    sub_faction_id: Optional[str] = None
    detachment_name: Optional[str] = None
    army_list: Optional[str] = None
    army_list_id: Optional[str] = None
    system_id: Optional[str] = None
    access_code: Optional[str] = None
    bcp_token: Optional[str] = None


class UpdateEventPlayerPayload(BaseModel):
    player_id: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    team_name: Optional[str] = None
    army_id: Optional[str] = None
    sub_faction_id: Optional[str] = None
    faction_name: Optional[str] = None
    detachment_name: Optional[str] = None


class SubmitArmylistPayload(BaseModel):
    player_id: Optional[str] = None
    list_text: str
    army_id: Optional[str] = None
    sub_faction_id: Optional[str] = None
    send_notification: bool = True


class CheckinPlayerPayload(BaseModel):
    player_id: Optional[str] = None
    has_list: Optional[bool] = None


class DropPlayerPayload(BaseModel):
    player_id: Optional[str] = None


@router.get("/api/community/events/{event_id}/registration", summary="Get Event Registration Metadata, User Status & Saved Army Lists")
async def api_community_event_registration(
    event_id: str,
    request: Request,
    force_sync: bool = Query(False),
    token: Optional[str] = Query(None)
):
    """
    Returns complete registration configuration for a tournament:
    - Tier status: Free native in-app, Paid ticket handoff, External ticket portal, or Closed / TO-only
    - Enrollment counts & capacity limits (is_sold_out)
    - Current authenticated user profile pre-fill & linked BCP account state
    - Current user registration status (is_registered)
    - User's saved army lists from My Hub with pre-parsed faction & detachment
    """
    db = get_database()
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    user_id = user["id"] if user else None
    x_bcp_token = request.headers.get("X-BCP-Token")

    # Retrieve event from DB or fallback fetch from BCP
    clean_eid = str(event_id).strip()
    ev = db.get_event_details(clean_eid)
    if not ev:
        ev = db.get_studio_event(clean_eid)

    if not ev and not clean_eid.startswith("ES-"):
        try:
            bcp_url = f"{BCP_API_BASE}/events/{clean_eid}"
            req = urllib.request.Request(bcp_url, headers=DEFAULT_HEADERS)
            with urllib.request.urlopen(req, timeout=8) as resp:
                if resp.status == 200:
                    bcp_data = json.loads(resp.read().decode())
                    ev = {
                        "id": clean_eid,
                        "name": bcp_data.get("name", "Tournament"),
                        "event_date": bcp_data.get("eventDate") or bcp_data.get("startDate"),
                        "end_date": bcp_data.get("endDate"),
                        "city": bcp_data.get("city"),
                        "state": bcp_data.get("state"),
                        "country": bcp_data.get("country"),
                        "venue": bcp_data.get("venue"),
                        "total_players": bcp_data.get("totalPlayers", 0),
                        "num_rounds": bcp_data.get("numberOfRounds", 5),
                        "raw_json": bcp_data
                    }
        except Exception as ex:
            logger.debug(f"Direct BCP fetch in registration metadata notice for {clean_eid}: {ex}")

    if not ev:
        raise HTTPException(status_code=404, detail="Tournament not found")

    # Extract registration parameters
    rj = ev.get("raw_json") if isinstance(ev.get("raw_json"), dict) else {}
    if isinstance(ev.get("raw_json"), str):
        try:
            rj = json.loads(ev.get("raw_json"))
        except Exception:
            rj = {}
    status_obj = ev.get("status") if isinstance(ev.get("status"), dict) else (rj.get("status") if isinstance(rj.get("status"), dict) else {})
    using_online_reg = bool(ev.get("using_online_reg", ev.get("usingOnlineReg", rj.get("usingOnlineReg", rj.get("using_online_reg", True)))))
    
    ticket_price = 0.0
    try:
        raw_price = ev.get("ticket_price") if ev.get("ticket_price") is not None else ev.get("ticketPrice", rj.get("ticketPrice", rj.get("ticket_price", 0.0)))
        ticket_price = normalize_ticket_price(raw_price)
    except (ValueError, TypeError):
        ticket_price = 0.0

    ticket_currency = str(ev.get("ticket_currency") or ev.get("currency") or rj.get("ticketCurrency") or rj.get("currency") or "usd").lower()

    num_tickets = 0
    try:
        raw_num = ev.get("num_tickets") or ev.get("numTickets") or ev.get("capacity") or rj.get("numTickets") or rj.get("capacity") or 0
        num_tickets = int(raw_num or 0)
    except (ValueError, TypeError):
        num_tickets = 0

    total_players = 0
    try:
        raw_players = ev.get("total_players") or ev.get("totalPlayers") or rj.get("totalPlayers") or len(ev.get("roster") or [])
        total_players = int(raw_players or 0)
    except (ValueError, TypeError):
        total_players = 0

    external_url = ev.get("external_url") or ev.get("externalUrl") or rj.get("externalUrl") or rj.get("external_url") or None
    private_event = bool(ev.get("private_event") or ev.get("privateEvent") or rj.get("privateEvent") or (isinstance(rj.get("ticketing"), dict) and rj["ticketing"].get("privateEvent")) or False)
    has_access_code = bool(ev.get("has_access_code") or ev.get("hasAccessCode") or rj.get("hasAccessCode") or rj.get("accessCode") or False)
    requires_access_code = bool(private_event or has_access_code or ev.get("requires_access_code") or ev.get("requireAccessCode") or rj.get("requireAccessCode") or (isinstance(rj.get("ticketing"), dict) and rj["ticketing"].get("requiresAccessCode")))

    is_sold_out = bool(num_tickets > 0 and total_players >= num_tickets)
    can_register_free = bool(using_online_reg and ticket_price == 0.0 and not is_sold_out)
    can_buy_ticket = bool(using_online_reg and ticket_price > 0.0 and not is_sold_out)

    # Check user registration status and army lists
    is_registered = False
    player_registration = None
    army_lists: List[Dict[str, Any]] = []
    user_profile = {
        "logged_in": bool(user),
        "name": "",
        "first_name": "",
        "last_name": "",
        "email": "",
        "bcp_linked": False,
        "bcp_user_id": None
    }

    if user:
        user_display = user.get("display_name") or user.get("full_name") or user.get("name") or ""
        user_email = user.get("email") or ""
        bcp_user_id = user.get("bcp_user_id") or user.get("player_id")
        bcp_linked = bool(user.get("bcp_token") or (bcp_user_id and not str(bcp_user_id).startswith("user_")))
        
        parts = user_display.split(" ", 1) if user_display else ["", ""]
        fn = parts[0]
        ln = parts[1] if len(parts) > 1 else ""

        user_profile = {
            "logged_in": True,
            "name": user_display,
            "first_name": fn,
            "last_name": ln,
            "email": user_email,
            "bcp_linked": bcp_linked,
            "bcp_user_id": bcp_user_id
        }

        # Check if already registered
        matched_reg = None
        try:
            user_regs = db.get_user_registered_tournaments(user["id"])
            for r in (user_regs or []):
                if str(r.get("id") or r.get("bcp_event_id") or "") == clean_eid:
                    is_registered = True
                    matched_reg = dict(r)
                    break
        except Exception:
            is_registered = False

        # Live sync from BCP dedicated /currentPlayer endpoint
        if not clean_eid.startswith("ES-"):
            try:
                from bcp_adapter import bcp_adapter
                succ_cp, _, cp = bcp_adapter.fetch_event_current_player(
                    clean_eid,
                    user_id=user["id"] if user else None,
                    explicit_token=x_bcp_token
                )
                if succ_cp and cp and cp.get("id"):
                    is_registered = True
                    cp_user = cp.get("user") if isinstance(cp.get("user"), dict) else {}

                    # Faction name & ID
                    fac_name = ""
                    if isinstance(cp.get("faction"), dict):
                        fac_name = cp["faction"].get("name") or ""
                    elif isinstance(cp.get("faction"), str):
                        fac_name = cp["faction"]
                    if not fac_name:
                        fac_name = cp.get("army") or ""

                    fac_id = cp.get("factionId") or cp.get("armyId") or ""
                    if not fac_id and isinstance(cp.get("faction"), dict):
                        fac_id = cp["faction"].get("id") or ""

                    # Subfaction / Detachment name & ID
                    det_name = ""
                    if isinstance(cp.get("subFaction"), dict):
                        det_name = cp["subFaction"].get("name") or ""
                    elif isinstance(cp.get("subFaction"), str):
                        det_name = cp["subFaction"]
                    if not det_name:
                        det_name = cp.get("detachment") or ""

                    sub_id = cp.get("subFactionId") or cp.get("sub_faction_id") or ""
                    if not sub_id and isinstance(cp.get("subFaction"), dict):
                        sub_id = cp["subFaction"].get("id") or ""

                    cp_list_text = cp.get("armyListText") or cp.get("listText") or cp.get("armyList") or ""

                    cp_reg = {
                        "player_id": str(cp.get("id")),
                        "first_name": cp_user.get("firstName") or fn,
                        "last_name": cp_user.get("lastName") or ln,
                        "team_name": (cp.get("team") or {}).get("name") if isinstance(cp.get("team"), dict) else (cp.get("teamName") or cp.get("team") or ""),
                        "faction": fac_name,
                        "army_id": fac_id,
                        "detachment": det_name,
                        "sub_faction_id": sub_id,
                        "checked_in": bool(cp.get("checkedIn") or False),
                        "dropped": bool(cp.get("dropped") or False),
                        "has_list_submitted": bool(cp.get("listId") or cp_list_text),
                        "army_list": cp_list_text,
                        "list_id": str(cp.get("listId") or ""),
                    }
                    if matched_reg:
                        for k, v in cp_reg.items():
                            if v or k not in matched_reg:
                                matched_reg[k] = v
                    else:
                        matched_reg = dict(cp_reg)

            except Exception as cp_err:
                logger.debug(f"Notice querying live /currentPlayer: {cp_err}")

        # Live sync from BCP if user is linked to BCP
        if not is_registered and not clean_eid.startswith("ES-"):
            try:
                from bcp_adapter import bcp_adapter
                succ, _, bcp_events = bcp_adapter.fetch_user_registered_events(user["id"], explicit_token=x_bcp_token)
                if succ and bcp_events:
                    for ev_item in bcp_events:
                        if str(ev_item.get("bcp_event_id") or ev_item.get("id") or "").strip() == clean_eid:
                            is_registered = True
                            if matched_reg:
                                for k, v in ev_item.items():
                                    if v or k not in matched_reg:
                                        matched_reg[k] = v
                            else:
                                matched_reg = dict(ev_item)

                            break
            except Exception as bcp_fetch_err:
                logger.debug(f"Notice querying live user registered events: {bcp_fetch_err}")

        # Fallback check against live event players from BCP with resilient matching
        if not is_registered and not clean_eid.startswith("ES-"):
            try:
                from scraper import BestCoastPairingsScraper
                scraper = BestCoastPairingsScraper()
                bcp_players = scraper.fetch_event_players(clean_eid)
                target_uids = {str(bcp_user_id), str(user.get("id"))} if bcp_user_id else {str(user.get("id"))}
                user_em = str(user_email or "").strip().lower()
                user_fn = str(fn or "").strip().lower()
                user_ln = str(ln or "").strip().lower()
                user_display_clean = str(user_display or "").strip().lower()
                user_pid = str(user.get("player_id") or "").strip()

                for p in (bcp_players or []):
                    p_uid = str(p.get("userId") or p.get("user_id") or "")
                    p_id = str(p.get("id") or p.get("_id") or p.get("playerId") or "").strip()
                    p_em = str((p.get("user") or {}).get("email") or p.get("email") or "").strip().lower()

                    p_user = p.get("user") if isinstance(p.get("user"), dict) else {}
                    p_fn = str(p_user.get("firstName") or p.get("firstName") or "").strip().lower()
                    p_ln = str(p_user.get("lastName") or p.get("lastName") or "").strip().lower()
                    p_full = str(f"{p_fn} {p_ln}".strip() or p.get("name") or p.get("fullName") or "").strip().lower()

                    matched = False
                    if p_uid and p_uid in target_uids:
                        matched = True
                    elif user_em and p_em and p_em == user_em:
                        matched = True
                    elif user_pid and p_id and (p_id == user_pid or p_id == str(bcp_user_id)):
                        matched = True
                    elif user_fn and user_ln and p_fn == user_fn and p_ln == user_ln:
                        matched = True
                    elif user_display_clean and p_full and user_display_clean == p_full and len(user_display_clean) > 3:
                        matched = True

                    if matched:
                        is_registered = True
                        matched_reg = {
                            "player_id": p_id,
                            "first_name": p_user.get("firstName") or p.get("firstName") or fn,
                            "last_name": p_user.get("lastName") or p.get("lastName") or ln,
                            "team_name": (p.get("team") or {}).get("name") or p.get("teamName") or "",
                            "faction": p.get("army") or p.get("faction") or "",
                            "army_id": p.get("armyId") or "",
                            "detachment": p.get("detachment") or "",
                            "sub_faction_id": p.get("subFactionId") or "",
                            "checked_in": bool(p.get("checkedIn") or p.get("checked_in") or False),
                            "dropped": bool(p.get("dropped") or False),
                            "has_list_submitted": bool(p.get("hasList") or p.get("armyList") or p.get("listSubmitted")),
                            "army_list": p.get("armyList") or p.get("listText") or "",
                        }
                        break
            except Exception as ex:
                logger.debug(f"Live player registration check notice: {ex}")

        player_registration = None
        if matched_reg:
            from bcp_adapter import bcp_adapter
            cand_pid = str(matched_reg.get("bcp_player_id") or matched_reg.get("player_id") or "").strip()
            # If candidate_pid is invalid, identical to event_id, or starts with user_, resolve the real one
            resolved_pid = bcp_adapter.resolve_event_player_id(clean_eid, user["id"], candidate_pid=cand_pid, explicit_token=x_bcp_token)
            actual_pid = resolved_pid or (cand_pid if (cand_pid and cand_pid != clean_eid and not cand_pid.startswith("user_")) else "")

            fn_val = matched_reg.get("first_name") or fn
            ln_val = matched_reg.get("last_name") or ln
            full_name_val = f"{fn_val} {ln_val}".strip() or matched_reg.get("player_name") or matched_reg.get("name") or user_display or "Competitor"

            player_registration = {
                "player_id": actual_pid,
                "first_name": fn_val,
                "last_name": ln_val,
                "player_name": full_name_val,
                "team_name": matched_reg.get("team_name") or matched_reg.get("team") or "",
                "faction": matched_reg.get("faction") or "",
                "army_id": matched_reg.get("army_id") or matched_reg.get("armyId") or "",
                "detachment": matched_reg.get("detachment") or "",
                "sub_faction_id": matched_reg.get("sub_faction_id") or matched_reg.get("subFactionId") or "",
                "checked_in": bool(matched_reg.get("checked_in") or matched_reg.get("checkedIn") or False),
                "dropped": bool(matched_reg.get("dropped") or False),
                "has_list_submitted": bool(matched_reg.get("has_list_submitted") or matched_reg.get("army_list") or matched_reg.get("armyList")),
                "army_list": matched_reg.get("army_list") or matched_reg.get("armyList") or "",
                "gamesystem_id": matched_reg.get("gamesystem_id") or ev.get("gamesystem_id") or rj.get("gameSystemId") or "WGMSzfKFYA",
            }
        else:
            player_registration = None

        # Load user saved army lists from My Hub
        try:
            saved_lists = db.get_user_army_lists(user["id"])
            for al in saved_lists:
                army_lists.append({
                    "id": al.get("id"),
                    "name": al.get("name") or "Saved List",
                    "faction": al.get("faction") or "",
                    "detachment": al.get("detachment") or "",
                    "points": al.get("points") or 2000,
                    "raw_text": al.get("raw_text") or al.get("list_text") or al.get("army_list") or ""
                })
        except Exception as e:
            logger.debug(f"Saved army lists fetch notice: {e}")

    return {
        "success": True,
        "event_id": clean_eid,
        "event_name": ev.get("name") or "Tournament",
        "event_date": ev.get("event_date") if hasattr(ev.get("event_date"), "isoformat") else str(ev.get("event_date") or ""),
        "end_date": ev.get("end_date") if hasattr(ev.get("end_date"), "isoformat") else str(ev.get("end_date") or ""),
        "status": status_obj,
        "is_ended": bool(status_obj.get("ended", ev.get("is_ended", False))),
        "city": ev.get("city") or "",
        "state": ev.get("state") or "",
        "country": ev.get("country") or "",
        "venue": ev.get("venue_name") or ev.get("venue") or "",
        "using_online_reg": using_online_reg,
        "ticket_price": ticket_price,
        "ticket_currency": ticket_currency,
        "num_tickets": num_tickets,
        "total_players": total_players,
        "external_url": external_url,
        "private_event": private_event,
        "has_access_code": has_access_code,
        "requires_access_code": requires_access_code,
        "is_sold_out": is_sold_out,
        "can_register_free": can_register_free,
        "can_buy_ticket": can_buy_ticket,
        "is_registered": is_registered,
        "player_registration": player_registration,
        "player": player_registration,
        "bcp_url": f"https://www.bestcoastpairings.com/event/{clean_eid}",
        "bcp_checkout_url": f"https://www.bestcoastpairings.com/event/{clean_eid}?checkout=true",
        "user_profile": user_profile,
        "army_lists": army_lists
    }


@router.post("/api/community/events/{event_id}/register", summary="Register Competitor for Free Tournament")
async def api_community_event_register(
    event_id: str,
    payload: CommunityEventRegisterPayload,
    request: Request,
    token: Optional[str] = Query(None)
):
    """
    Submits in-app competitor registration for a tournament:
    - Validates eligibility (must be using_online_reg and ticket_price == 0, not sold out)
    - Resolves competitor profile, army list, faction, detachment, ITC system ID
    - Submits registration to Best Coast Pairings API via BcpAdapter.register_player
    - Persists registration into OmniTactica events & event_participants (synced with My Hub)
    """
    db = get_database()
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    user_id = user["id"] if user else None

    clean_eid = str(event_id).strip()
    ev = db.get_event_details(clean_eid)
    if not ev:
        ev = db.get_studio_event(clean_eid)

    # If event not in DB, retrieve metadata from BCP
    if not ev and not clean_eid.startswith("ES-"):
        try:
            bcp_url = f"{BCP_API_BASE}/events/{clean_eid}"
            req = urllib.request.Request(bcp_url, headers=DEFAULT_HEADERS)
            with urllib.request.urlopen(req, timeout=8) as resp:
                if resp.status == 200:
                    bcp_data = json.loads(resp.read().decode())
                    ev = {
                        "id": clean_eid,
                        "name": bcp_data.get("name", "Tournament"),
                        "event_date": bcp_data.get("eventDate") or bcp_data.get("startDate"),
                        "end_date": bcp_data.get("endDate"),
                        "city": bcp_data.get("city"),
                        "state": bcp_data.get("state"),
                        "country": bcp_data.get("country"),
                        "venue": bcp_data.get("venue"),
                        "total_players": bcp_data.get("totalPlayers", 0),
                        "num_rounds": bcp_data.get("numberOfRounds", 5),
                        "raw_json": bcp_data
                    }
        except Exception as ex:
            logger.debug(f"Direct BCP fetch in register notice for {clean_eid}: {ex}")

    if not ev:
        raise HTTPException(status_code=404, detail="Tournament not found")

    rj = ev.get("raw_json") if isinstance(ev.get("raw_json"), dict) else {}
    using_online_reg = bool(ev.get("using_online_reg", ev.get("usingOnlineReg", rj.get("usingOnlineReg", rj.get("using_online_reg", True)))))
    
    ticket_price = 0.0
    try:
        raw_price = ev.get("ticket_price") if ev.get("ticket_price") is not None else ev.get("ticketPrice", rj.get("ticketPrice", rj.get("ticket_price", 0.0)))
        ticket_price = normalize_ticket_price(raw_price)
    except (ValueError, TypeError):
        ticket_price = 0.0

    num_tickets = 0
    try:
        raw_num = ev.get("num_tickets") or ev.get("numTickets") or ev.get("capacity") or rj.get("numTickets") or rj.get("capacity") or 0
        num_tickets = int(raw_num or 0)
    except (ValueError, TypeError):
        num_tickets = 0

    total_players = 0
    try:
        raw_players = ev.get("total_players") or ev.get("totalPlayers") or rj.get("totalPlayers") or len(ev.get("roster") or [])
        total_players = int(raw_players or 0)
    except (ValueError, TypeError):
        total_players = 0

    if not using_online_reg:
        raise HTTPException(
            status_code=400,
            detail="Online registration is closed for this tournament. Please register directly in-store with the Tournament Organizer."
        )

    if num_tickets > 0 and total_players >= num_tickets:
        raise HTTPException(
            status_code=400,
            detail=f"This tournament is sold out ({total_players}/{num_tickets} capacity reached)."
        )

    if ticket_price > 0.0:
        raise HTTPException(
            status_code=400,
            detail=f"This tournament requires a paid ticket (${ticket_price:.2f}). Please purchase your ticket via Best Coast Pairings checkout."
        )

    private_event = bool(ev.get("private_event") or ev.get("privateEvent") or rj.get("privateEvent") or (isinstance(rj.get("ticketing"), dict) and rj["ticketing"].get("privateEvent")) or False)
    has_access_code = bool(ev.get("has_access_code") or ev.get("hasAccessCode") or rj.get("hasAccessCode") or rj.get("accessCode") or False)
    requires_access_code = bool(private_event or has_access_code or ev.get("requires_access_code") or ev.get("requireAccessCode") or rj.get("requireAccessCode") or (isinstance(rj.get("ticketing"), dict) and rj["ticketing"].get("requiresAccessCode")))

    access_code = (payload.access_code or "").strip()
    if requires_access_code and not access_code:
        raise HTTPException(
            status_code=400,
            detail="This tournament requires an Access Code. Please enter the access code provided by your Tournament Organizer."
        )

    # Competitor name & email resolution
    full_name = (payload.name or "").strip()
    fn = (payload.first_name or "").strip()
    ln = (payload.last_name or "").strip()
    if not full_name and (fn or ln):
        full_name = f"{fn} {ln}".strip()
    elif full_name and not fn and not ln:
        parts = full_name.split(" ", 1)
        fn = parts[0]
        ln = parts[1] if len(parts) > 1 else ""

    if not full_name and user:
        full_name = user.get("display_name") or user.get("full_name") or user.get("name") or "Competitor"
        parts = full_name.split(" ", 1)
        fn = parts[0]
        ln = parts[1] if len(parts) > 1 else ""

    if not full_name:
        raise HTTPException(status_code=400, detail="Competitor name is required.")

    email = (payload.email or (user.get("email") if user else "") or "").strip()
    team = (payload.team or (user.get("team") if user else "") or "").strip()
    army_id = (payload.army_id or "").strip()
    sub_faction_id = (payload.sub_faction_id or "").strip()
    faction = (payload.faction_name or payload.faction or "").strip()
    detachment = (payload.detachment_name or payload.detachment or "").strip()
    army_list = (payload.army_list or "").strip()

    # If army_list_id is provided, pull saved list content if not provided inline
    if payload.army_list_id and user_id:
        try:
            saved_lists = db.get_user_army_lists(user_id)
            matched = next((l for l in saved_lists if str(l.get("id")) == str(payload.army_list_id)), None)
            if matched:
                if not detachment and matched.get("detachment"):
                    detachment = matched.get("detachment")
                if not army_list:
                    army_list = matched.get("raw_text") or matched.get("list_text") or matched.get("army_list") or ""
                if not faction and matched.get("faction"):
                    faction = matched.get("faction")
        except Exception as e:
            logger.debug(f"Saved army list lookup notice: {e}")

    # Resolve human-readable names and official BCP gamesystem ObjectIds
    gamesystem_id = ev.get("gamesystem_id") or rj.get("gameSystemId") or "WGMSzfKFYA"
    if army_id or sub_faction_id or faction or detachment:
        try:
            from bcp_adapter import BcpAdapter
            _, _, flist = BcpAdapter.fetch_gamesystem_factions(gamesystem_id)
            if flist:
                matched_f = None
                if army_id:
                    matched_f = next((f for f in flist if str(f.get("id")).strip() == army_id), None)
                if not matched_f and faction:
                    fac_lower = faction.lower()
                    matched_f = next((f for f in flist if f.get("name", "").lower() == fac_lower or fac_lower in f.get("name", "").lower()), None)
                if matched_f:
                    army_id = str(matched_f.get("id") or army_id).strip()
                    if not faction or faction.lower() == "select faction (optional)":
                        faction = matched_f.get("name") or faction
                    sfs = matched_f.get("subFactions") or []
                    matched_sf = None
                    if sub_faction_id:
                        matched_sf = next((sf for sf in sfs if str(sf.get("id")).strip() == sub_faction_id), None)
                    if not matched_sf and detachment:
                        det_lower = detachment.lower()
                        matched_sf = next((sf for sf in sfs if sf.get("name", "").lower() == det_lower or det_lower in sf.get("name", "").lower()), None)
                    if matched_sf:
                        sub_faction_id = str(matched_sf.get("id") or sub_faction_id).strip()
                        if not detachment or detachment.lower().startswith("select faction") or detachment.lower().startswith("-- select"):
                            detachment = matched_sf.get("name") or detachment
        except Exception as fac_res_err:
            logger.debug(f"Faction resolution notice in register: {fac_res_err}")

    if not faction:
        faction = "Unassigned"

    system_id = (payload.system_id or "").strip()

    # Prepare player data for BCP
    bcp_adapter_token = payload.bcp_token or (auth_mgr.get_valid_bcp_token(user_id) if user_id else None)
    bcp_user_id = user.get("bcp_user_id") if user else None

    player_data_for_bcp = {
        "name": full_name,
        "first_name": fn,
        "last_name": ln,
        "email": email,
        "team": team,
        "faction": faction if faction != "Unassigned" else None,
        "army": faction if faction != "Unassigned" else None,
        "army_id": army_id or None,
        "armyId": army_id or None,
        "detachment": detachment or None,
        "sub_faction_id": sub_faction_id or None,
        "subFactionId": sub_faction_id or None,
        "army_list": army_list or None,
        "armyList": army_list or None,
        "system_id": system_id or None,
        "access_code": access_code or None,
        "accessCode": access_code or None,
        "bcp_user_id": bcp_user_id,
        "checked_in": False
    }

    # 1. Best Coast Pairings Events: strictly register via BCP API (zero backend DB writes)
    if not clean_eid.startswith("ES-"):
        try:
            from bcp_adapter import BcpAdapter
            bcp_registered, bcp_err, bcp_resp = BcpAdapter.register_player(
                clean_eid,
                player_data_for_bcp,
                user_id=user_id,
                explicit_token=bcp_adapter_token,
                is_team=False
            )
            if not bcp_registered:
                raise HTTPException(
                    status_code=400,
                    detail=f"BCP registration failed: {bcp_err or 'Unable to complete registration with Best Coast Pairings'}"
                )
        except HTTPException:
            raise
        except Exception as bcp_ex:
            logger.warning(f"Error during BCP API registration for {clean_eid}: {bcp_ex}")
            raise HTTPException(
                status_code=400,
                detail=f"Failed to communicate with Best Coast Pairings: {bcp_ex}"
            )

        # Resolve authentic BCP player record ID for subsequent armylist submission or player update
        resolved_pid = None
        if bcp_resp and isinstance(bcp_resp, dict):
            resolved_pid = bcp_resp.get("id") or bcp_resp.get("_id") or (
                bcp_resp.get("player", {}).get("id") if isinstance(bcp_resp.get("player"), dict) else None
            )
        if not resolved_pid:
            try:
                resolved_pid = BcpAdapter.resolve_event_player_id(
                    clean_eid,
                    user_id=user_id,
                    candidate_pid=None,
                    explicit_token=bcp_adapter_token
                )
            except Exception as ex_resolve:
                logger.debug(f"Player ID resolution notice after registration: {ex_resolve}")

        # Update player details on BCP with army, detachment, armyId, subFactionId, team
        if resolved_pid and (army_id or sub_faction_id or (faction and faction != "Unassigned") or detachment or team):
            set_fields = {}
            if army_id:
                set_fields["armyId"] = army_id
            if sub_faction_id:
                set_fields["subFactionId"] = sub_faction_id
            if faction and faction != "Unassigned":
                set_fields["army"] = faction
                set_fields["faction"] = faction
            if detachment:
                set_fields["detachment"] = detachment
            if team:
                set_fields["teamName"] = team
            if set_fields:
                try:
                    BcpAdapter.update_player(
                        player_id=resolved_pid,
                        set_fields=set_fields,
                        user_id=user_id,
                        explicit_token=bcp_adapter_token
                    )
                except Exception as ex_upd:
                    logger.debug(f"BCP player update after registration notice: {ex_upd}")

        # Submit army list to BCP armylists collection
        if resolved_pid and army_list:
            try:
                BcpAdapter.submit_armylist(
                    player_id=resolved_pid,
                    list_text=army_list,
                    army_id=army_id or None,
                    sub_faction_id=sub_faction_id or None,
                    send_notification=True,
                    user_id=user_id,
                    explicit_token=bcp_adapter_token
                )
            except Exception as ex_list:
                logger.debug(f"BCP submit_armylist after registration notice: {ex_list}")

        already_reg = bool(bcp_resp and isinstance(bcp_resp, dict) and bcp_resp.get("already_registered"))
        success_msg = f"You are already registered for {ev.get('name') or 'Tournament'} on Best Coast Pairings!" if already_reg else f"Successfully registered for {ev.get('name') or 'Tournament'} on Best Coast Pairings!"

        return {
            "success": True,
            "message": success_msg,
            "event_id": clean_eid,
            "event_name": ev.get("name") or "Tournament",
            "player_name": full_name,
            "player_id": resolved_pid or "",
            "faction": faction,
            "army_id": army_id,
            "detachment": detachment,
            "sub_faction_id": sub_faction_id,
            "has_list_submitted": bool(army_list),
            "army_list": army_list,
            "bcp_synced": True,
            "bcp_notice": "Already registered on BCP" if already_reg else None,
            "is_registered": True
        }

    # 2. Native Event Studio Tournament: Persist locally in OmniTactica database
    effective_user_id = user_id or f"anon_{secrets.token_hex(6)}"
    event_reg_record = {
        "id": clean_eid,
        "bcp_event_id": clean_eid,
        "name": ev.get("name") or "Tournament",
        "event_date": ev.get("event_date"),
        "end_date": ev.get("end_date"),
        "venue": ev.get("venue_name") or ev.get("venue") or "",
        "city": ev.get("city") or "",
        "state": ev.get("state") or "",
        "country": ev.get("country") or "",
        "faction": faction,
        "army_id": army_id,
        "detachment": detachment,
        "sub_faction_id": sub_faction_id,
        "army_list": army_list,
        "has_list_submitted": bool(army_list),
        "checked_in": False,
        "points": ev.get("points") or 2000,
        "num_rounds": ev.get("num_rounds") or 5,
        "total_players": total_players + 1,
        "player_id": user.get("player_id") if user else effective_user_id,
        "player_name": full_name
    }

    saved_ok = db.add_user_registered_tournament(effective_user_id, event_reg_record)

    try:
        roster = list(ev.get("roster") or [])
        new_p = {
            "id": user.get("player_id") if user else effective_user_id,
            "name": full_name,
            "faction": faction,
            "army_id": army_id,
            "detachment": detachment,
            "sub_faction_id": sub_faction_id,
            "army_list": army_list,
            "checked_in": False
        }
        roster.append(new_p)
        db.save_studio_roster(clean_eid, roster)
    except Exception as es_err:
        logger.debug(f"Event Studio roster update notice: {es_err}")

    return {
        "success": True,
        "message": f"Successfully registered for {ev.get('name') or 'Tournament'}!",
        "event_id": clean_eid,
        "event_name": ev.get("name") or "Tournament",
        "player_name": full_name,
        "player_id": user.get("player_id") if user else effective_user_id,
        "faction": faction,
        "army_id": army_id,
        "detachment": detachment,
        "sub_faction_id": sub_faction_id,
        "has_list_submitted": bool(army_list),
        "army_list": army_list,
        "bcp_synced": False,
        "bcp_notice": None,
        "is_registered": True
    }


# =========================================================================
# BCP REGISTRATION MANAGEMENT & CHECK-IN FLOW
# =========================================================================

@router.get("/api/community/gamesystems/{gamesystem_id}/factions", summary="Get Official Factions and Detachments for Gamesystem")
async def api_community_gamesystem_factions(gamesystem_id: str):
    """
    Fetches the official list of factions and detachments (subfactions) for a gamesystem from BCP.
    """
    from bcp_adapter import bcp_adapter
    ok, err, factions = bcp_adapter.fetch_gamesystem_factions(gamesystem_id)
    if not ok:
        raise HTTPException(status_code=502, detail=err or "Failed to fetch factions from BCP")
    return {
        "success": True,
        "gamesystem_id": gamesystem_id,
        "count": len(factions or []),
        "factions": factions or []
    }


@router.post("/api/community/events/{event_id}/player", summary="Update Player Registration Details on BCP")
async def api_community_update_player(
    event_id: str,
    payload: UpdateEventPlayerPayload,
    request: Request,
    token: Optional[str] = Query(None)
):
    """
    Updates player registration fields (names, faction, detachment, team) on BCP via POST /v1/players/{player_id}.
    """
    session = _get_user_session_or_401(request, token)
    user_id = session["id"]
    clean_eid = str(event_id).strip()
    cand_pid = str(payload.player_id or "").strip()
    x_bcp_token = request.headers.get("X-BCP-Token")

    from bcp_adapter import bcp_adapter
    # Resolve authentic BCP tournament player record ID
    clean_pid = bcp_adapter.resolve_event_player_id(clean_eid, user_id, candidate_pid=cand_pid, explicit_token=x_bcp_token)
    if not clean_pid:
        raise HTTPException(
            status_code=400,
            detail="Could not find your player registration record for this tournament on Best Coast Pairings."
        )

    set_fields: Dict[str, Any] = {}
    if payload.first_name is not None:
        set_fields["firstName"] = payload.first_name.strip()
    if payload.last_name is not None:
        set_fields["lastName"] = payload.last_name.strip()
    if payload.army_id:
        set_fields["armyId"] = payload.army_id.strip()
    if payload.sub_faction_id:
        set_fields["subFactionId"] = payload.sub_faction_id.strip()

    unset_fields: Dict[str, Any] = {}
    if payload.team_name and payload.team_name.strip():
        set_fields["teamName"] = payload.team_name.strip()
    else:
        unset_fields["teamId"] = True
        unset_fields["teamName"] = True

    ok, err, data = bcp_adapter.update_player(
        player_id=clean_pid,
        set_fields=set_fields,
        unset_fields=unset_fields if unset_fields else None,
        user_id=user_id,
        explicit_token=x_bcp_token
    )

    # Self-healing retry: If BCP returns 404 / "No player record found", re-query BCP directly and retry
    if not ok and err and ("no player" in err.lower() or "404" in err.lower()):
        logger.warning(f"⚠️ BCP update_player returned '{err}' for player {clean_pid}. Attempting fresh resolution...")
        fresh_pid = bcp_adapter.resolve_event_player_id(clean_eid, user_id, ignore_candidate=True, explicit_token=x_bcp_token)
        if fresh_pid and fresh_pid != clean_pid:
            clean_pid = fresh_pid
            ok, err, data = bcp_adapter.update_player(
                player_id=clean_pid,
                set_fields=set_fields,
                unset_fields=unset_fields if unset_fields else None,
                user_id=user_id,
                explicit_token=x_bcp_token
            )

    if not ok:
        raise HTTPException(status_code=400, detail=err or "Failed to update player details on BCP")

    # For native Event Studio events, persist in OmniTactica database
    if clean_eid.startswith("ES-"):
        try:
            db = get_database()
            fn = payload.first_name or ""
            ln = payload.last_name or ""
            full_name = f"{fn} {ln}".strip() or session.get("display_name") or "Competitor"
            fac_name = payload.faction_name or ""
            det_name = payload.detachment_name or ""
            if (not fac_name or not det_name) and (payload.army_id or payload.sub_faction_id):
                try:
                    _, _, flist = bcp_adapter.fetch_gamesystem_factions("WGMSzfKFYA")
                    for f_item in (flist or []):
                        if str(f_item.get("id")) == str(payload.army_id):
                            if not fac_name:
                                fac_name = f_item.get("name") or ""
                            if payload.sub_faction_id and not det_name:
                                for sf_item in (f_item.get("subFactions") or []):
                                    if str(sf_item.get("id")) == str(payload.sub_faction_id):
                                        det_name = sf_item.get("name") or ""
                                        break
                            break
                except Exception:
                    pass

            db.add_user_registered_tournament(user_id, {
                "bcp_event_id": clean_eid,
                "id": clean_eid,
                "player_id": clean_pid,
                "bcp_player_id": clean_pid,
                "first_name": fn,
                "last_name": ln,
                "name": full_name,
                "faction": fac_name or set_fields.get("armyId") or "",
                "detachment": det_name or set_fields.get("subFactionId") or "",
                "army_id": payload.army_id or set_fields.get("armyId") or "",
                "sub_faction_id": payload.sub_faction_id or set_fields.get("subFactionId") or "",
                "team": payload.team_name or "",
            })
        except Exception as dberr:
            logger.debug(f"Event Studio participant sync notice: {dberr}")

    return {
        "success": True,
        "message": "Player details updated successfully",
        "player_id": clean_pid,
        "data": data
    }


@router.post("/api/community/events/{event_id}/armylist", summary="Submit Army List to BCP")
async def api_community_submit_armylist(
    event_id: str,
    payload: SubmitArmylistPayload,
    request: Request,
    token: Optional[str] = Query(None)
):
    """
    Submits or updates an army list on BCP via POST /v1/armylists.
    """
    session = _get_user_session_or_401(request, token)
    user_id = session["id"]
    clean_eid = str(event_id).strip()
    cand_pid = str(payload.player_id or "").strip()
    list_text = str(payload.list_text or "").strip()
    x_bcp_token = request.headers.get("X-BCP-Token")
    if not list_text:
        raise HTTPException(status_code=400, detail="Army list text cannot be empty")

    from bcp_adapter import bcp_adapter
    clean_pid = bcp_adapter.resolve_event_player_id(clean_eid, user_id, candidate_pid=cand_pid, explicit_token=x_bcp_token)
    if not clean_pid:
        raise HTTPException(
            status_code=400,
            detail="Could not find your player registration record for this tournament on Best Coast Pairings."
        )

    ok, err, data = bcp_adapter.submit_armylist(
        player_id=clean_pid,
        list_text=list_text,
        army_id=payload.army_id,
        sub_faction_id=payload.sub_faction_id,
        send_notification=payload.send_notification,
        user_id=user_id,
        explicit_token=x_bcp_token
    )

    # Self-healing retry if 404 / no player
    if not ok and err and ("no player" in err.lower() or "404" in err.lower()):
        logger.warning(f"⚠️ BCP submit_armylist returned '{err}' for player {clean_pid}. Attempting fresh resolution...")
        fresh_pid = bcp_adapter.resolve_event_player_id(clean_eid, user_id, ignore_candidate=True, explicit_token=x_bcp_token)
        if fresh_pid and fresh_pid != clean_pid:
            clean_pid = fresh_pid
            ok, err, data = bcp_adapter.submit_armylist(
                player_id=clean_pid,
                list_text=list_text,
                army_id=payload.army_id,
                sub_faction_id=payload.sub_faction_id,
                send_notification=payload.send_notification,
                user_id=user_id,
                explicit_token=x_bcp_token
            )

    if not ok:
        raise HTTPException(status_code=400, detail=err or "Failed to submit army list to BCP")

    # For native Event Studio events, persist in OmniTactica database
    if clean_eid.startswith("ES-"):
        try:
            db = get_database()
            reg_payload = {
                "bcp_event_id": clean_eid,
                "id": clean_eid,
                "player_id": clean_pid,
                "bcp_player_id": clean_pid,
                "army_list": list_text,
                "has_list_submitted": True
            }
            if payload.army_id:
                reg_payload["army_id"] = payload.army_id
            if payload.sub_faction_id:
                reg_payload["sub_faction_id"] = payload.sub_faction_id
            db.add_user_registered_tournament(user_id, reg_payload)
        except Exception as dberr:
            logger.debug(f"Event Studio participant list sync notice: {dberr}")

    return {
        "success": True,
        "message": "Army list submitted successfully to BCP",
        "player_id": clean_pid,
        "data": data
    }


@router.post("/api/community/events/{event_id}/checkin", summary="Check-in Player to Tournament on BCP")
async def api_community_checkin_player(
    event_id: str,
    payload: CheckinPlayerPayload,
    request: Request,
    token: Optional[str] = Query(None)
):
    """
    Checks in a competitor to a tournament on BCP via POST /v1/players/{player_id} with {"set": {"checkedIn": True}}.
    Guarded against checking in without a list when required.
    """
    session = _get_user_session_or_401(request, token)
    user_id = session["id"]
    clean_eid = str(event_id).strip()
    cand_pid = str(payload.player_id or "").strip()
    x_bcp_token = request.headers.get("X-BCP-Token")

    db = get_database()
    # Pre-validation: check if player has a list submitted
    has_list = payload.has_list
    if has_list is None:
        try:
            regs = db.get_user_registered_tournaments(user_id)
            for r in (regs or []):
                if str(r.get("id") or r.get("bcp_event_id") or "") == clean_eid:
                    has_list = bool(r.get("has_list_submitted") or r.get("army_list"))
                    break
        except Exception:
            pass

    # If explicitly flagged or known that no list exists, block and inform user
    if has_list is False:
        raise HTTPException(
            status_code=400,
            detail="An army list must be submitted before checking in to this tournament."
        )

    from bcp_adapter import bcp_adapter
    clean_pid = bcp_adapter.resolve_event_player_id(clean_eid, user_id, candidate_pid=cand_pid, explicit_token=x_bcp_token)
    if not clean_pid:
        raise HTTPException(
            status_code=400,
            detail="Could not find your player registration record for this tournament on Best Coast Pairings."
        )

    ok, err, data = bcp_adapter.checkin_player(
        player_id=clean_pid,
        user_id=user_id,
        explicit_token=x_bcp_token
    )

    # Self-healing retry if 404 / no player
    if not ok and err and ("no player" in err.lower() or "404" in err.lower()):
        logger.warning(f"⚠️ BCP checkin_player returned '{err}' for player {clean_pid}. Attempting fresh resolution...")
        fresh_pid = bcp_adapter.resolve_event_player_id(clean_eid, user_id, ignore_candidate=True, explicit_token=x_bcp_token)
        if fresh_pid and fresh_pid != clean_pid:
            clean_pid = fresh_pid
            ok, err, data = bcp_adapter.checkin_player(
                player_id=clean_pid,
                user_id=user_id,
                explicit_token=x_bcp_token
            )

    if not ok:
        err_msg = err or "Failed to check in to BCP"
        if "list" in err_msg.lower():
            err_msg = "BCP requires an army list to be submitted before checking in. Please submit your list first."
        raise HTTPException(status_code=400, detail=err_msg)

    # For native Event Studio events, persist in OmniTactica database
    if clean_eid.startswith("ES-"):
        try:
            db.add_user_registered_tournament(user_id, {
                "bcp_event_id": clean_eid,
                "id": clean_eid,
                "player_id": clean_pid,
                "bcp_player_id": clean_pid,
                "checked_in": True
            })
        except Exception as dberr:
            logger.debug(f"Event Studio participant checkin sync notice: {dberr}")

    return {
        "success": True,
        "message": "Successfully checked in to tournament on BCP",
        "player_id": clean_pid,
        "data": data
    }


@router.post("/api/community/events/{event_id}/drop", summary="Drop Player from Tournament on BCP")
async def api_community_drop_player(
    event_id: str,
    payload: DropPlayerPayload,
    request: Request,
    token: Optional[str] = Query(None)
):
    """
    Drops a competitor from a tournament on BCP via POST /v1/players/{player_id} with {"set": {"dropped": True}}.
    """
    session = _get_user_session_or_401(request, token)
    user_id = session["id"]
    clean_eid = str(event_id).strip()
    cand_pid = str(payload.player_id or "").strip()
    x_bcp_token = request.headers.get("X-BCP-Token")

    from bcp_adapter import bcp_adapter
    clean_pid = bcp_adapter.resolve_event_player_id(clean_eid, user_id, candidate_pid=cand_pid, explicit_token=x_bcp_token)
    if not clean_pid:
        raise HTTPException(
            status_code=400,
            detail="Could not find your player registration record for this tournament on Best Coast Pairings."
        )

    ok, err, data = bcp_adapter.drop_player(
        player_id=clean_pid,
        user_id=user_id,
        explicit_token=x_bcp_token
    )

    # Self-healing retry if 404 / no player
    if not ok and err and ("no player" in err.lower() or "404" in err.lower()):
        logger.warning(f"⚠️ BCP drop_player returned '{err}' for player {clean_pid}. Attempting fresh resolution...")
        fresh_pid = bcp_adapter.resolve_event_player_id(clean_eid, user_id, ignore_candidate=True, explicit_token=x_bcp_token)
        if fresh_pid and fresh_pid != clean_pid:
            clean_pid = fresh_pid
            ok, err, data = bcp_adapter.drop_player(
                player_id=clean_pid,
                user_id=user_id,
                explicit_token=x_bcp_token
            )

    if not ok:
        raise HTTPException(status_code=400, detail=err or "Failed to drop from tournament on BCP")

    # For native Event Studio events, persist in OmniTactica database
    if clean_eid.startswith("ES-"):
        try:
            db = get_database()
            db.add_user_registered_tournament(user_id, {
                "bcp_event_id": clean_eid,
                "id": clean_eid,
                "player_id": clean_pid,
                "bcp_player_id": clean_pid,
                "dropped": True
            })
        except Exception as dberr:
            logger.debug(f"Event Studio participant drop sync notice: {dberr}")

    return {
        "success": True,
        "message": "Successfully dropped from tournament on BCP",
        "player_id": clean_pid,
        "data": data
    }




