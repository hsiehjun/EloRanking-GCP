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
    include_bcp: bool = Query(False)
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
        include_bcp=include_bcp
    )

@router.get("/api/community/bcp_upcoming", summary="Fetch live BCP upcoming tournaments asynchronously")
async def api_community_bcp_upcoming(
    lat: float = Query(...),
    lng: float = Query(...),
    radius_miles: float = Query(50.0),
    days_ahead: int = Query(92)
):
    db = get_database()
    events = db.fetch_bcp_upcoming_events(user_lat=lat, user_lng=lng, radius_miles=radius_miles, days_ahead=days_ahead)
    return {"success": True, "events": events}

_community_field_stats_cache: Dict[str, Dict[str, Any]] = {}

def compute_live_bcp_field_stats(eid: str, db) -> Dict[str, Any]:
    """Fetches live roster from BCP API and computes field avg / top seed Elo without mutating backend DB."""
    try:
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
                            WHERE player_id = ANY(%s) OR (player_name IS NOT NULL AND LOWER(player_name) = ANY(%s));
                        """, (list(candidate_pids), list(candidate_names)))
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
    event_ids: Optional[str] = Query(None, description="Comma-separated event IDs")
):
    target_ids: List[str] = []
    if event_ids:
        target_ids.extend([eid.strip() for eid in event_ids.split(",") if eid.strip()])
    if request.method == "POST":
        try:
            body = await request.json()
            if isinstance(body, dict):
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
        cached = _community_field_stats_cache.get(eid)
        if cached:
            ttl = 900 if int(cached.get("stats", {}).get("total_enrolled") or 0) > 0 else 60
            if (now_ts - cached.get("timestamp", 0) < ttl):
                results[eid] = cached.get("stats", {})
                continue
        missing_ids.append(eid)

    if missing_ids:
        db = get_database()
        # 1. Query existing DB participants (read-only)
        db_stats = db.get_events_field_stats(missing_ids)
        need_bcp_sync: List[str] = []

        for eid in missing_ids:
            stat = db_stats.get(eid)
            # If DB already has participants from prior scraping, cache and return
            if stat and int(stat.get("total_enrolled") or 0) > 0:
                results[eid] = stat
                _community_field_stats_cache[eid] = {
                    "timestamp": now_ts,
                    "stats": stat
                }
            else:
                need_bcp_sync.append(eid)

        # 2. For events without participants in DB, compute live from BCP API (strictly zero DB writes)
        if need_bcp_sync:
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(need_bcp_sync))) as executor:
                future_map = {executor.submit(compute_live_bcp_field_stats, eid, db): eid for eid in need_bcp_sync}
                done, not_done = concurrent.futures.wait(future_map.keys(), timeout=6.0)
                for fut in done:
                    eid = future_map[fut]
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
                    _community_field_stats_cache[eid] = {
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
    detachment: Optional[str] = None
    army_list: Optional[str] = None
    army_list_id: Optional[str] = None
    system_id: Optional[str] = None
    bcp_token: Optional[str] = None


@router.get("/api/community/events/{event_id}/registration", summary="Get Event Registration Metadata, User Status & Saved Army Lists")
async def api_community_event_registration(
    event_id: str,
    request: Request,
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
    private_event = bool(ev.get("private_event") or ev.get("privateEvent") or rj.get("privateEvent") or False)

    is_sold_out = bool(num_tickets > 0 and total_players >= num_tickets)
    can_register_free = bool(using_online_reg and ticket_price == 0.0 and not is_sold_out)
    can_buy_ticket = bool(using_online_reg and ticket_price > 0.0 and not is_sold_out)

    # Check user registration status and army lists
    is_registered = False
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
        try:
            user_regs = db.get_user_registered_tournaments(user["id"])
            is_registered = any(str(r.get("id") or r.get("bcp_event_id") or "") == clean_eid for r in (user_regs or []))
        except Exception:
            is_registered = False

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
        "is_sold_out": is_sold_out,
        "can_register_free": can_register_free,
        "can_buy_ticket": can_buy_ticket,
        "is_registered": is_registered,
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
    faction = (payload.faction or "").strip() or "Unassigned"
    detachment = (payload.detachment or "").strip()
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
                if faction == "Unassigned" and matched.get("faction"):
                    faction = matched.get("faction")
        except Exception as e:
            logger.debug(f"Saved army list lookup notice: {e}")

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
        "detachment": detachment or None,
        "army_list": army_list or None,
        "system_id": system_id or None,
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

        already_reg = bool(bcp_resp and isinstance(bcp_resp, dict) and bcp_resp.get("already_registered"))
        success_msg = f"You are already registered for {ev.get('name') or 'Tournament'} on Best Coast Pairings!" if already_reg else f"Successfully registered for {ev.get('name') or 'Tournament'} on Best Coast Pairings!"

        return {
            "success": True,
            "message": success_msg,
            "event_id": clean_eid,
            "event_name": ev.get("name") or "Tournament",
            "player_name": full_name,
            "faction": faction,
            "detachment": detachment,
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
        "detachment": detachment,
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
            "detachment": detachment,
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
        "faction": faction,
        "detachment": detachment,
        "bcp_synced": False,
        "bcp_notice": None,
        "is_registered": True
    }




