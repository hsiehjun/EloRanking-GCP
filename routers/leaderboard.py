"""Leaderboard, Player Directory, Tournaments & Faction Meta Router."""
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

router = APIRouter(tags=["Leaderboard & Analytics"])

_active_event_syncs: set = set()

# API: Summary Stats Ribbon
@router.get("/api/stats", summary="Get global summary statistics")
async def api_stats():
    return get_database().get_summary_stats()

# API: Individual Leaderboard Standings
@router.get("/api/leaderboard", summary="Get top ranked players (paginated)")
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
@router.get("/api/teams", summary="Get teams power rankings (paginated)")
@router.get("/api/leaderboard/teams", include_in_schema=False)
async def api_teams(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=5, le=200),
    min_roster: int = Query(1, ge=1),
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
@router.get("/api/team/{team_name}", summary="Get team member roster and power metrics")
async def api_team_roster(team_name: str):
    return get_database().get_team_roster(team_name.strip())

# API: Full Player Directory
@router.get("/api/players", summary="Search and browse player directory (paginated)")
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
@router.get("/api/players/search", summary="Search players for predictor autocomplete")
async def api_players_search(q: str = Query("", min_length=1), limit: int = Query(10, ge=1, le=50)):
    return get_database().search_players(q.strip(), limit=limit)

# API: Player Profile & Historical Win Path
@router.get("/api/player/{player_id}", summary="Get player profile, win path, and Elo trajectory")
async def api_player_profile(player_id: str, request: Request):
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    current_user = auth_mgr.get_session(session_token) if session_token else None

    pid = player_id.strip()
    data = get_elo_engine().get_player_win_path(pid)

    # Check if this player is registered on OmniTactica
    db = get_database()
    user_row = db.get_user_for_player(pid, data.get("player_name"))
    if user_row:
        data["has_account"] = True
        data["account_user_id"] = user_row["id"]
        data["can_chat"] = True
        data["is_self"] = bool(current_user and current_user["id"] == user_row["id"])
        if current_user and not data["is_self"]:
            req = db.get_existing_match_request(current_user["id"], user_row["id"])
            if req:
                data["existing_request_id"] = req["id"]
                data["existing_request_status"] = req["status"]
                data["existing_request_sender_id"] = req["sender_id"]
    else:
        data["has_account"] = False
        data["account_user_id"] = None
        data["can_chat"] = False
        data["is_self"] = False

    return data

# API: Tournaments List
@router.get("/api/events", summary="List tournaments with date and status filters (paginated)")
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
@router.get("/api/events/recommended", summary="Get real-time live upcoming events from BCP")
async def api_events_recommended(
    request: Request,
    player_id: Optional[str] = Query(None),
    query: Optional[str] = Query(None),
    tier: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    city: Optional[str] = Query(None),
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radius_miles: Optional[float] = Query(None),
    months_ahead: int = Query(2, ge=1, le=12),
    sort_by: str = Query("date"),
    limit: int = Query(35, ge=1, le=100)
):
    db = get_database()
    now_dt = datetime.now(timezone.utc)
    player_id_clean = player_id.strip() if player_id else None
    
    # 1. Resolve user location & Elo from database
    detected_state = None
    detected_city = None
    user_elo = None

    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    auth_user = auth_mgr.get_session(session_token) if session_token else None
    if auth_user:
        if not player_id_clean and auth_user.get("player_id"):
            player_id_clean = auth_user.get("player_id")
        if user_elo is None and auth_user.get("current_elo") is not None:
            user_elo = float(auth_user["current_elo"])
    
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
            # 1. First Priority: Check explicit user profile location (set in Account Settings / LFG)
            lfg_loc = None
            if auth_user and auth_user.get("id"):
                cursor.execute("""
                    SELECT latitude, longitude, city, state, country, home_venue_name
                    FROM player_lfg_profiles
                    WHERE player_id = %s;
                """, (auth_user["id"],))
                lfg_loc = cursor.fetchone()

            if not lfg_loc and player_id_clean:
                cursor.execute("""
                    SELECT p.latitude, p.longitude, p.city, p.state, p.country, p.home_venue_name
                    FROM player_lfg_profiles p
                    WHERE p.player_id = %s
                    UNION ALL
                    SELECT p.latitude, p.longitude, p.city, p.state, p.country, p.home_venue_name
                    FROM player_lfg_profiles p
                    JOIN users u ON u.id = p.player_id
                    WHERE u.player_id = %s
                    LIMIT 1;
                """, (player_id_clean, player_id_clean))
                lfg_loc = cursor.fetchone()

            if lfg_loc and (lfg_loc.get("city") or lfg_loc.get("latitude") is not None):
                detected_city = lfg_loc.get("city")
                detected_state = lfg_loc.get("state")
                if not lat and lfg_loc.get("latitude") is not None:
                    lat = float(lfg_loc["latitude"])
                if not lng and lfg_loc.get("longitude") is not None:
                    lng = float(lfg_loc["longitude"])
            elif player_id_clean:
                # 2. Fallback: only if explicit user location doesn't exist, check tournament history
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

            if player_id_clean:
                cursor.execute("SELECT current_elo FROM player_ratings WHERE player_id = %s;", (player_id_clean,))
                elo_row = cursor.fetchone()
                if elo_row and user_elo is None:
                    user_elo = float(elo_row.get("current_elo") or 1500.0)

    target_state = (state.strip() if state and state.strip() else detected_state)
    target_city = (city.strip() if city and city.strip() else detected_city)

    user_lat = lat
    user_lng = lng
    if not user_lat and target_city and target_city.strip().lower() in KNOWN_CITIES:
        user_lat, user_lng = KNOWN_CITIES[target_city.strip().lower()]

    # 2. Query live upcoming events from BCP API
    bcp_events = []
    now_ts = time.time()
    effective_radius = int(radius_miles) if radius_miles and radius_miles > 0 else 50
    days_ahead = max(30, int(months_ahead * 30.5))
    geo_key = f"{round(user_lat, 2) if user_lat else None}_{round(user_lng, 2) if user_lng else None}_{effective_radius}_{months_ahead}"
    
    if not hasattr(api_events_recommended, "_cache"):
        api_events_recommended._cache = {}

    cached_entry = api_events_recommended._cache.get(geo_key)
    if cached_entry and (now_ts - cached_entry["timestamp"] < 90) and cached_entry["events"]:
        bcp_events = list(cached_entry["events"])
    else:
        headers = DEFAULT_HEADERS.copy()
        fetched_bcp = []

        if user_lat and user_lng:
            # Direct BCP API server-side geospatial query (exact matching BCP web app)
            params = {
                "limit": 50,
                "gameSystemId": DEFAULT_GAME_SYSTEM_ID,
                "startDate": now_dt.strftime("%Y-%m-%dT00:00:00.000Z"),
                "endDate": (now_dt + timedelta(days=days_ahead)).strftime("%Y-%m-%dT23:59:59.999Z"),
                "excludeOnline": "true",
                "sortKey": "eventDate",
                "sortAscending": "true",
                "location": json.dumps({
                    "distance": effective_radius,
                    "distanceType": "miles",
                    "center": {
                        "lat": str(user_lat),
                        "long": str(user_lng)
                    }
                })
            }
            next_key = None
            for _ in range(4):  # Up to 200 events
                if next_key:
                    params["nextKey"] = next_key
                url = f"{BCP_API_BASE}/events?{urllib.parse.urlencode(params)}"
                try:
                    req = urllib.request.Request(url, headers=headers)
                    with urllib.request.urlopen(req, timeout=4.5) as resp:
                        data = json.loads(resp.read().decode())
                        evs = data.get("data", [])
                        fetched_bcp.extend(evs)
                        next_key = data.get("nextKey")
                        if not next_key:
                            break
                except Exception as e:
                    logger.warning(f"Live BCP geo query error: {e}")
                    break
        else:
            # Global / multi-window query when no GPS coordinates are active
            windows = [
                (now_dt.strftime("%Y-%m-%dT00:00:00.000Z"), (now_dt + timedelta(days=35)).strftime("%Y-%m-%dT23:59:59.999Z")),
                ((now_dt + timedelta(days=36)).strftime("%Y-%m-%dT00:00:00.000Z"), (now_dt + timedelta(days=75)).strftime("%Y-%m-%dT23:59:59.999Z")),
                ((now_dt + timedelta(days=76)).strftime("%Y-%m-%dT00:00:00.000Z"), (now_dt + timedelta(days=120)).strftime("%Y-%m-%dT23:59:59.999Z"))
            ]
            for s_iso, e_iso in windows:
                next_key = None
                params = {
                    "limit": 50,
                    "gameSystemId": DEFAULT_GAME_SYSTEM_ID,
                    "startDate": s_iso,
                    "endDate": e_iso
                }
                for _ in range(3):
                    if next_key:
                        params["nextKey"] = next_key
                    url = f"{BCP_API_BASE}/events?{urllib.parse.urlencode(params)}"
                    try:
                        req = urllib.request.Request(url, headers=headers)
                        with urllib.request.urlopen(req, timeout=3.5) as resp:
                            data = json.loads(resp.read().decode())
                            evs = data.get("data", [])
                            fetched_bcp.extend(evs)
                            next_key = data.get("nextKey")
                            if not next_key:
                                break
                    except Exception as e:
                        logger.warning(f"Live BCP query error: {e}")
                        break

        if fetched_bcp:
            api_events_recommended._cache[geo_key] = {"timestamp": now_ts, "events": fetched_bcp}
            bcp_events = list(fetched_bcp)

        # Also merge with events already synced in local database
        try:
            with db.get_connection() as conn:
                with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                    cursor.execute("""
                    SELECT id, name, event_date, city, state, country, total_players, num_rounds, is_ended, raw_json
                    FROM events
                    WHERE event_date >= CURRENT_DATE - INTERVAL '14 days'
                      AND event_date <= CURRENT_DATE + (INTERVAL '1 day' * %s)
                    ORDER BY event_date ASC
                    LIMIT 150;
                    """, (days_ahead,))
                    db_evs = [dict(r) for r in cursor.fetchall()]
                    seen_ids_temp = {e.get("id") or e.get("objectId") for e in bcp_events if e.get("id") or e.get("objectId")}
                    for dbev in db_evs:
                        if dbev.get("id") not in seen_ids_temp:
                            bcp_events.append(dbev)
        except Exception as e:
            logger.warning(f"Database query notice: {e}")

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
    except Exception as e:
        logger.warning(f"Notice querying field stats: {e}")
        field_stats = {}

    if not hasattr(api_events_recommended, "_roster_cache"):
        api_events_recommended._roster_cache = {}

    # For nearby upcoming events with enrolled players not yet in DB, fetch live roster from BCP
    headers = DEFAULT_HEADERS.copy()
    for ev in bcp_events[:20]:
        eid = str(ev.get("id") or ev.get("objectId") or "")
        enrolled_cnt = int(ev.get("totalPlayers") or ev.get("total_players") or ev.get("enrolled_count") or 0)
        if not eid or enrolled_cnt <= 0:
            continue

        # Check in-memory roster cache first (15-min TTL)
        roster_cached = api_events_recommended._roster_cache.get(eid)
        if roster_cached and (now_ts - roster_cached["timestamp"] < 900):
            field_stats[eid] = roster_cached["stats"]
            continue

        if eid not in field_stats or not field_stats[eid].get("avg_field_elo"):
            try:
                p_url = f"{BCP_API_BASE}/events/{eid}/players"
                p_req = urllib.request.Request(p_url, headers=headers)
                with urllib.request.urlopen(p_req, timeout=1.8) as p_resp:
                    p_data = json.loads(p_resp.read().decode())
                    active_p = p_data.get("active", [])
                    if active_p:
                        p_ids = []
                        p_names = []
                        for p in active_p:
                            u = p.get("user") or {}
                            fn = u.get("firstName") or p.get("firstName") or ""
                            ln = u.get("lastName") or p.get("lastName") or ""
                            nm = f"{fn} {ln}".strip() or p.get("name")
                            pid = u.get("id") or p.get("userId") or p.get("id")
                            if pid: p_ids.append(pid)
                            if nm: p_names.append(nm.lower())

                        # Query ratings from PostgreSQL for these enrolled players
                        with db.get_connection() as conn:
                            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cur:
                                cur.execute("""
                                    SELECT player_id, LOWER(player_name) as player_name, current_elo
                                    FROM player_ratings
                                    WHERE player_id = ANY(%s) OR LOWER(player_name) = ANY(%s);
                                """, (p_ids, p_names))
                                rated_rows = cur.fetchall()
                                found_ratings = {r["player_id"]: float(r["current_elo"]) for r in rated_rows if r.get("player_id")}
                                name_ratings = {r["player_name"]: float(r["current_elo"]) for r in rated_rows if r.get("player_name")}

                        elos = []
                        for p in active_p:
                            u = p.get("user") or {}
                            fn = u.get("firstName") or p.get("firstName") or ""
                            ln = u.get("lastName") or p.get("lastName") or ""
                            nm = f"{fn} {ln}".strip().lower()
                            pid = u.get("id") or p.get("userId") or p.get("id")
                            p_elo = found_ratings.get(pid) or name_ratings.get(nm)
                            elos.append(p_elo if p_elo else 1500.0)

                        if elos:
                            calculated_stats = {
                                "avg_field_elo": round(sum(elos) / len(elos), 1),
                                "top_seed_elo": round(max(elos), 1),
                                "total_enrolled": len(active_p),
                                "rated_players_count": sum(1 for e in elos if e != 1500.0)
                            }
                            field_stats[eid] = calculated_stats
                            api_events_recommended._roster_cache[eid] = {
                                "timestamp": now_ts,
                                "stats": calculated_stats
                            }
            except Exception as pe:
                logger.debug(f"Live roster fetch notice for {eid}: {pe}")

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

        # Tier strictly based on number of rounds: <=3 RTT/Local, 4-6 GT, >=7 Major, with capacity sanity check
        tp = max(enrolled, cap)
        if rounds >= 7 or tp >= 60:
            tier = "Major"
            tier_badge = "tier-S"
            tier_baseline = 1720.0
        elif rounds >= 4 or tp >= 28:
            tier = "Grand Tournament"
            tier_badge = "tier-A"
            tier_baseline = 1620.0
        else:
            tier = "RTT / Local"
            tier_badge = "tier-B"
            tier_baseline = 1530.0

        # Dynamic Field Avg Elo from Enrolled Roster in PostgreSQL / BCP
        stats_entry = field_stats.get(str(ev_id)) or field_stats.get(ev_id)
        if stats_entry and stats_entry.get("avg_field_elo"):
            avg_elo_val = float(stats_entry["avg_field_elo"])
        else:
            avg_elo_val = tier_baseline

        if user_elo:
            diff = avg_elo_val - user_elo
            diff_val = round(diff)
            diff_sign = "+" if diff_val > 0 else ""
            delta_str = f"{diff_sign}{diff_val} vs My Elo" if diff_val != 0 else "±0 vs My Elo"
            if enrolled <= 1:
                skill_label = f"👥 {enrolled} Reg ({delta_str})" if enrolled == 1 else delta_str
                skill_badge = "badge-match-prime"
            elif abs(diff) <= 35:
                skill_label = delta_str
                skill_badge = "badge-match-prime"
            elif diff > 35 and diff <= 110:
                skill_label = delta_str
                skill_badge = "badge-match-hard"
            elif diff > 110:
                skill_label = delta_str
                skill_badge = "badge-match-extreme"
            else:
                skill_label = delta_str
                skill_badge = "badge-match-favorable"
        else:
            if enrolled <= 1:
                skill_label = f"👥 {enrolled} Registered" if enrolled == 1 else "👥 Registration Open"
            else:
                skill_label = "⚔️ Open Field"
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
            "user_elo": round(user_elo, 1) if user_elo else None,
            "elo_delta": round(avg_elo_val - user_elo, 1) if user_elo else None,
            "skill_match_label": skill_label,
            "skill_match_badge": skill_badge,
            "bcp_url": f"https://www.bestcoastpairings.com/event/{ev_id}"
        })

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

    res = {
        "detected_state": detected_state,
        "detected_city": detected_city,
        "target_state": target_state,
        "user_elo": user_elo,
        "events": sorted_events[:limit],
        "total": len(sorted_events)
    }
    return res

_active_event_syncs: set = set()

def format_bcp_roster_to_players(raw_players: list, existing_players: list = None, db = None) -> list:
    """Formats raw BCP competitors preserving exact BCP tournament placing order,
    pulling Elo ratings from player_ratings DB, and official placings strictly from BCP."""
    existing_by_id = {}
    existing_by_name = {}
    for p in (existing_players or []):
        for k in ("player_id", "id", "user_id", "userId"):
            val = p.get(k)
            if val:
                existing_by_id[str(val)] = p
        fname = p.get("full_name")
        if fname:
            existing_by_name[fname.strip().lower()] = p

    # Determine if any player has an official placement from BCP
    has_any_placing = False
    for p in raw_players:
        for k in ("placing", "manualPlacing", "overallPlacing"):
            val = p.get(k)
            if val is not None and not isinstance(val, bool):
                try:
                    if int(val) > 0:
                        has_any_placing = True
                        break
                except (ValueError, TypeError):
                    pass
        if has_any_placing:
            break

    # Read-only query to player_ratings for fresh ratings
    candidate_pids = set()
    candidate_names = set()
    for p in raw_players:
        u = p.get("user") or {}
        for k in (u.get("id"), p.get("userId"), p.get("id"), u.get("userId")):
            if k:
                candidate_pids.add(str(k))
        fn = u.get("firstName") or p.get("firstName") or ""
        ln = u.get("lastName") or p.get("lastName") or ""
        name = f"{fn} {ln}".strip() or p.get("name")
        if name:
            candidate_names.add(name.strip().lower())

    db_ratings_by_id = {}
    db_ratings_by_name = {}
    if db and (candidate_pids or candidate_names):
        try:
            with db.get_connection() as conn:
                cursor_factory = getattr(extras, "RealDictCursor", None) if extras else None
                cursor_kw = {"cursor_factory": cursor_factory} if cursor_factory else {}
                with conn.cursor(**cursor_kw) as cursor:
                    cursor.execute("""
                        SELECT player_id, player_name, current_elo, peak_elo, win_rate, top_faction, team
                        FROM player_ratings
                        WHERE player_id = ANY(%s) OR (player_name IS NOT NULL AND LOWER(player_name) = ANY(%s));
                    """, (list(candidate_pids), list(candidate_names)))
                    for row in cursor.fetchall():
                        if isinstance(row, dict) or hasattr(row, "keys"):
                            r = dict(row)
                        elif isinstance(row, (list, tuple)):
                            r = {
                                "player_id": row[0] if len(row) > 0 else None,
                                "player_name": row[1] if len(row) > 1 else None,
                                "current_elo": row[2] if len(row) > 2 else 1500.0,
                                "peak_elo": row[3] if len(row) > 3 else 1500.0,
                                "win_rate": row[4] if len(row) > 4 else 0.0,
                                "top_faction": row[5] if len(row) > 5 else None,
                                "team": row[6] if len(row) > 6 else None,
                            }
                        else:
                            continue
                        if r.get("player_id"):
                            db_ratings_by_id[str(r["player_id"])] = r
                        if r.get("player_name"):
                            db_ratings_by_name[str(r["player_name"]).strip().lower()] = r
        except Exception as e:
            logger.debug(f"DB ratings read-only lookup notice: {e}")

    formatted = []
    for idx, p in enumerate(raw_players):
        u = p.get("user") or {}
        fname = u.get("firstName") or p.get("firstName") or ""
        lname = u.get("lastName") or p.get("lastName") or ""
        full_name = f"{fname} {lname}".strip() or p.get("name") or "Player"
        pid = str(u.get("id") or p.get("userId") or p.get("id") or f"bcp_{idx}")

        placing_num = None
        if has_any_placing:
            manual_val = p.get("manualPlacing")
            if manual_val is not None and not isinstance(manual_val, bool):
                try:
                    mv = int(manual_val)
                    if mv > 0: placing_num = mv
                except (ValueError, TypeError): pass

            if placing_num is None:
                comp_place = p.get("placing")
                if comp_place is not None and not isinstance(comp_place, bool):
                    try:
                        cp = int(comp_place)
                        if cp > 0: placing_num = cp
                    except (ValueError, TypeError): pass

            if placing_num is None:
                for ak in ("place", "rank", "placement", "ranking"):
                    val = p.get(ak)
                    if val is not None and not isinstance(val, bool):
                        try:
                            pv = int(val)
                            if pv > 0:
                                placing_num = pv
                                break
                        except (ValueError, TypeError): pass

            if placing_num is None:
                overall = p.get("overallPlacing")
                if overall is not None and not isinstance(overall, bool):
                    try:
                        ov = int(overall)
                        if ov > 0: placing_num = ov
                    except (ValueError, TypeError): pass

            if placing_num is None:
                placing_num = idx + 1

        faction_obj = p.get("faction") or {}
        faction_name = faction_obj.get("name") if isinstance(faction_obj, dict) else (str(faction_obj) if faction_obj else "Unknown")
        team_obj = p.get("team") or {}
        team_name = team_obj.get("name") if isinstance(team_obj, dict) else (str(team_obj) if team_obj else "")

        # Lookup candidate IDs in existing or DB ratings
        candidate_ids = [
            str(u.get("id")) if u.get("id") else None,
            str(p.get("userId")) if p.get("userId") else None,
            str(p.get("id")) if p.get("id") else None,
            str(u.get("userId")) if u.get("userId") else None
        ]
        cached = None
        for cid in candidate_ids:
            if cid and cid in existing_by_id:
                cached = existing_by_id[cid]
                break
        if not cached:
            cached = existing_by_name.get(full_name.strip().lower())

        db_rating = None
        for cid in candidate_ids:
            if cid and cid in db_ratings_by_id:
                db_rating = db_ratings_by_id[cid]
                break
        if not db_rating:
            db_rating = db_ratings_by_name.get(full_name.strip().lower())

        if cached:
            player_dict = dict(cached)
            player_dict["placement"] = placing_num
            player_dict["official_placement"] = placing_num
            player_dict["rank"] = placing_num or (idx + 1)
            player_dict["player_id"] = str(cached.get("player_id") or pid)
            if db_rating:
                player_dict["current_elo"] = float(db_rating.get("current_elo") or player_dict.get("current_elo") or 1500.0)
                player_dict["peak_elo"] = float(db_rating.get("peak_elo") or player_dict.get("peak_elo") or 1500.0)
            if not player_dict.get("full_name") or player_dict["full_name"] in ("Player", "Player 1", "Player 2"):
                player_dict["full_name"] = full_name
            if not player_dict.get("faction") or player_dict["faction"] == "Unknown":
                player_dict["faction"] = faction_name if faction_name != "Unknown" else (db_rating.get("top_faction") if db_rating else "Unknown")
            if not player_dict.get("team"):
                player_dict["team"] = team_name or (db_rating.get("team") if db_rating else "")
            if p.get("podNum") is not None:
                player_dict["pod_num"] = p.get("podNum")
            if p.get("dropped") is not None:
                player_dict["dropped"] = bool(p.get("dropped"))
            if p.get("checkedIn") is not None:
                player_dict["checked_in"] = bool(p.get("checkedIn"))
            player_dict["team_player_id"] = str(p.get("teamPlayerId") or p.get("team_player_id") or "")
            player_dict["teamPlayerId"] = player_dict["team_player_id"]
            player_dict["user_id"] = str(u.get("id") or p.get("userId") or "")
            player_dict["army_list"] = str(p.get("armyList") or p.get("army_list") or p.get("listUrl") or "")
            formatted.append(player_dict)
        else:
            tot_metrics = p.get("total_metrics") or p.get("metrics") or []
            wins = 0
            losses = 0
            draws = 0
            bps = 0
            for m in tot_metrics:
                if isinstance(m, dict):
                    mn = m.get("name")
                    mv = m.get("value", 0)
                    if mn in ("Wins", "wins", "numWins", "Games Won"):
                        try: wins = float(mv)
                        except (ValueError, TypeError): pass
                    elif mn in ("Losses", "losses", "numLosses", "Games Lost"):
                        try: losses = float(mv)
                        except (ValueError, TypeError): pass
                    elif mn in ("Battle Points", "battlePoints", "points"):
                        try: bps = int(mv)
                        except (ValueError, TypeError): pass

            current_elo = float(db_rating.get("current_elo") or 1500.0) if db_rating else 1500.0
            peak_elo = float(db_rating.get("peak_elo") or 1500.0) if db_rating else 1500.0
            resolved_fac = faction_name if faction_name != "Unknown" else (db_rating.get("top_faction") if db_rating else "Unknown")
            resolved_team = team_name or (db_rating.get("team") if db_rating else "")
            team_player_id = str(p.get("teamPlayerId") or p.get("team_player_id") or "")
            user_id = str(u.get("id") or p.get("userId") or "")
            army_list = str(p.get("armyList") or p.get("army_list") or p.get("listUrl") or "")

            formatted.append({
                "player_id": pid,
                "user_id": user_id,
                "team_player_id": team_player_id,
                "teamPlayerId": team_player_id,
                "army_list": army_list,
                "full_name": full_name,
                "faction": resolved_fac,
                "team": resolved_team,
                "placement": placing_num,
                "official_placement": placing_num,
                "rank": placing_num or (idx + 1),
                "pod_num": p.get("podNum") or p.get("pod_num"),
                "event_wins": wins,
                "event_losses": losses,
                "event_draws": draws,
                "event_matches_count": int(wins + losses + draws),
                "event_battle_points": bps or p.get("points") or 0,
                "current_elo": current_elo,
                "peak_elo": peak_elo,
                "dropped": bool(p.get("dropped")),
                "checked_in": bool(p.get("checkedIn"))
            })

    if not has_any_placing:
        formatted.sort(key=lambda x: -float(x.get("current_elo") or 1500.0))
        for rank_idx, p in enumerate(formatted, 1):
            p["rank"] = rank_idx
            p["placement"] = None
            p["official_placement"] = None
    else:
        formatted.sort(key=lambda x: (x.get("placement") or 999999, -float(x.get("current_elo") or 1500.0)))
        for rank_idx, p in enumerate(formatted, 1):
            p["rank"] = p.get("placement") or rank_idx

    return formatted


# API: Tournament Details & Round Pairings
@router.get("/api/event/{event_id}", summary="Get tournament metadata, placings, and round pairings")
async def api_event_details(event_id: str, force_sync: bool = False):
    db = get_database()
    event_id_str = event_id.strip()

    # Check existing data in DB
    event_details = db.get_event_details(event_id_str)
    is_native_studio = event_id_str.startswith("ES-")
    if not event_details and is_native_studio:
        studio_ev = db.get_studio_event(event_id_str)
        if studio_ev:
            event_details = studio_ev

    if is_native_studio:
        if not event_details:
            raise HTTPException(status_code=404, detail=f"Tournament '{event_id_str}' not found")
        event_details["sync_in_progress"] = False
        return event_details

    # If event is not yet in DB, fetch details directly from BCP API without mutating DB
    if not event_details:
        try:
            scraper = BestCoastPairingsScraper(db=db, request_delay=0.0)
            ev_data = scraper.fetch_event_details(event_id_str)
            if ev_data and isinstance(ev_data, dict):
                loc = ev_data.get("location") or {}
                event_details = {
                    "id": event_id_str,
                    "name": ev_data.get("name") or "Tournament Details",
                    "event_date": ev_data.get("eventDate") or ev_data.get("startDate") or "",
                    "end_date": ev_data.get("endDate") or "",
                    "city": loc.get("city") or "",
                    "state": loc.get("state") or "",
                    "country": loc.get("country") or "United States",
                    "total_players": ev_data.get("totalPlayers") or 0,
                    "num_rounds": ev_data.get("numberOfRounds") or ev_data.get("numRounds") or 0,
                    "current_round": ev_data.get("currentRound") or 0,
                    "is_ended": bool(ev_data.get("isEnded", False)),
                    "pairings_status": ev_data.get("pairingsStatus", "draft"),
                    "raw_json": ev_data,
                    "matches": [],
                    "players": [],
                    "roster": []
                }
        except Exception as e:
            logger.warning(f"Failed to fetch BCP details for event {event_id_str}: {e}")

        if not event_details:
            raise HTTPException(status_code=404, detail=f"Tournament '{event_id_str}' not found on Best Coast Pairings")

    # For BCP events: Event info / Matches come from DB.
    # Tournament placing and live roster come strictly from BCP API (strictly zero DB writes).
    try:
        scraper = BestCoastPairingsScraper(db=db, request_delay=0.0)

        # 1. Detect if event is a Team or Doubles event
        raw_ev = event_details.get("raw_json") or {}
        is_team_event = bool(
            raw_ev.get("teamEvent") or 
            (raw_ev.get("totalTeamPlayers", 0) > 0) or
            event_details.get("is_team_event")
        )
        is_doubles_event = bool(
            raw_ev.get("doublesEvent") or
            (is_team_event and raw_ev.get("totalTeamPlayers") and raw_ev.get("totalPlayers") and round(raw_ev.get("totalPlayers") / raw_ev.get("totalTeamPlayers")) == 2) or
            ("double" in (event_details.get("name") or "").lower())
        )

        bcp_players = scraper.fetch_event_players(event_id_str)
        bcp_teams = []
        if is_team_event or not bcp_players:
            bcp_teams = scraper.fetch_event_teams(event_id_str)
            if bcp_teams and not is_team_event:
                is_team_event = True
                if round(len(bcp_players or []) / max(1, len(bcp_teams))) == 2 or ("double" in (event_details.get("name") or "").lower()):
                    is_doubles_event = True

        if not bcp_players and bcp_teams:
            bcp_players = bcp_teams

        if bcp_players:
            existing_players = event_details.get("players", [])
            formatted_players = format_bcp_roster_to_players(bcp_players, existing_players, db=db)
            event_details["players"] = formatted_players
            event_details["total_players"] = len(formatted_players)
            elos = [float(p["current_elo"]) for p in formatted_players if p.get("current_elo") is not None]
            if elos:
                event_details["avg_field_elo"] = round(sum(elos) / len(elos), 1)
                event_details["top_seed_elo"] = max(elos)

        event_details["is_team_event"] = is_team_event
        event_details["is_doubles_event"] = is_doubles_event

        if is_team_event and bcp_teams:
            # Group competitors under their respective registered teams
            team_map = {}
            for t in bcp_teams:
                tid = str(t.get("id") or "").strip()
                if not tid:
                    continue
                cap = t.get("captain") if isinstance(t.get("captain"), dict) else {}
                cap_first = cap.get("firstName") or ""
                cap_last = cap.get("lastName") or ""
                cap_name = f"{cap_first} {cap_last}".strip() or t.get("captainName") or ""

                metrics = {m.get("name"): m.get("value") for m in (t.get("metrics") or t.get("total_metrics") or []) if isinstance(m, dict)}
                overall_metrics = {m.get("name"): m.get("value") for m in t.get("overall_metrics", []) if isinstance(m, dict)}
                games = t.get("games") or t.get("total_games") or []

                placing_num = None
                for pk in ("placing", "overallPlacing", "rank", "place"):
                    v = t.get(pk)
                    if v is not None and not isinstance(v, bool):
                        try:
                            pv = int(v)
                            if pv > 0:
                                placing_num = pv
                                break
                        except (ValueError, TypeError):
                            pass

                match_points = metrics.get("Match Points")
                game_wins = metrics.get("Game Wins")
                battle_points = metrics.get("Battle Points") or overall_metrics.get("Overall Score") or t.get("battlePoints") or t.get("battle_points") or t.get("points")
                wins = overall_metrics.get("Wins")

                formatted_games = []
                for g in games:
                    if isinstance(g, dict):
                        formatted_games.append({
                            "round": g.get("gameNum"),
                            "points": g.get("gamePoints"),
                            "result": g.get("gameResult")  # 2 = win, 0 = loss, 1 = draw
                        })

                team_map[tid] = {
                    "id": tid,
                    "team_id": tid,
                    "name": t.get("name") or "Unnamed Team",
                    "captain_id": str(t.get("captainId") or cap.get("id") or ""),
                    "captain_name": cap_name,
                    "checked_in": bool(t.get("checkedIn") or t.get("checked_in")),
                    "dropped": bool(t.get("dropped")),
                    "placing": placing_num,
                    "points": battle_points if battle_points is not None else 0,
                    "match_points": match_points,
                    "game_wins": game_wins,
                    "battle_points": battle_points,
                    "wins": wins,
                    "games": formatted_games,
                    "members": []
                }

            unassigned = []
            for p in event_details.get("players", []):
                tpid = str(p.get("team_player_id") or p.get("teamPlayerId") or "").strip()
                if tpid and tpid in team_map:
                    target_team = team_map[tpid]
                    is_cap = bool(
                        (target_team.get("captain_id") and target_team["captain_id"] in (p.get("user_id"), p.get("player_id"))) or
                        (target_team.get("captain_name") and target_team["captain_name"].lower() == p.get("full_name", "").lower())
                    )
                    p["is_captain"] = is_cap
                    target_team["members"].append(p)
                else:
                    unassigned.append(p)

            formatted_teams = list(team_map.values())
            for tm in formatted_teams:
                m_elos = [float(m["current_elo"]) for m in tm["members"] if m.get("current_elo") is not None]
                tm["avg_elo"] = round(sum(m_elos) / len(m_elos), 1) if m_elos else 1500.0
                tm["member_count"] = len(tm["members"])
                tm["members"].sort(key=lambda m: (not m.get("is_captain"), -float(m.get("current_elo") or 1500.0)))

            has_team_placings = any(tm.get("placing") for tm in formatted_teams)
            if has_team_placings:
                formatted_teams.sort(key=lambda tm: tm.get("placing") or 999999)
            else:
                formatted_teams.sort(key=lambda tm: tm.get("name", "").lower())

            event_details["teams"] = formatted_teams
            event_details["team_standings"] = formatted_teams
            event_details["total_teams"] = len(formatted_teams)
            if unassigned:
                event_details["unassigned_players"] = unassigned
    except Exception as e:
        logger.warning(f"BCP placings fetch notice for {event_id_str}: {e}")

    event_details["sync_in_progress"] = False
    return event_details


@router.post("/api/event/{event_id}/sync-roster", summary="Quietly persist raw BCP roster to backend DB")
async def api_sync_event_roster_payload(event_id: str, request: Request):
    """No-op endpoint: roster is fetched live via BCP API and DB updates are strictly via scheduled scraping."""
    return {"success": True, "notice": "Roster is fetched live via BCP API"}


# API: Cloud Scheduler Cron Sync
@router.post("/api/cron/sync-tournaments", summary="Cloud Scheduler cron to scrape latest tournaments and update Elo")
@router.get("/api/cron/sync-tournaments", summary="Manual trigger to scrape latest tournaments and update Elo")
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
@router.get("/api/head_to_head", summary="Get head-to-head encounters between two players")
async def api_head_to_head(p1: str = Query(...), p2: str = Query(...)):
    return get_database().get_head_to_head(p1.strip(), p2.strip())

# API: Unique Factions
@router.get("/api/factions", summary="List all active Warhammer 40k factions")
async def api_factions():
    stats = get_database().get_summary_stats()
    return stats.get("factions", [])

# API: Faction Meta & Balance Analytics
@router.get("/api/factions/meta", summary="Get global faction win rates and balance tier ratings")
async def api_faction_meta(
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    timeframe: Optional[str] = Query(None, description="Timeframe preset: '30d', '60d', '90d', 'ytd', 'all'")
):
    try:
        resolved_start = start_date
        resolved_end = end_date

        if timeframe == "all" or start_date == "all":
            resolved_start = None
            resolved_end = None
        elif not resolved_start and not resolved_end:
            now = datetime.now(timezone.utc)
            preset = (timeframe or "90d").lower()
            if preset == "30d":
                resolved_start = (now - timedelta(days=30)).strftime("%Y-%m-%d")
                resolved_end = now.strftime("%Y-%m-%d")
            elif preset == "60d":
                resolved_start = (now - timedelta(days=60)).strftime("%Y-%m-%d")
                resolved_end = now.strftime("%Y-%m-%d")
            elif preset == "ytd":
                resolved_start = f"{now.year}-01-01"
                resolved_end = now.strftime("%Y-%m-%d")
            elif preset == "all":
                resolved_start = None
                resolved_end = None
            else:  # Default to 90d (Last 3 Months)
                resolved_start = (now - timedelta(days=90)).strftime("%Y-%m-%d")
                resolved_end = now.strftime("%Y-%m-%d")

        return get_database().get_faction_meta_stats(start_date=resolved_start, end_date=resolved_end)
    except Exception as e:
        logger.error(f"Error in /api/factions/meta: {e}")
        return {"factions": [], "monthly_trends": [], "error": str(e)}

# API: Faction Details & Match History
@router.get("/api/faction/{faction_name}", summary="Get faction detailed metrics, top players, and match history")
async def api_faction_details(faction_name: str, limit: int = Query(100, ge=1, le=500)):
    return get_database().get_faction_details(faction_name.strip(), limit=limit)

# API: Match Win Probability Predictor
@router.get("/api/predict", summary="Calculate win odds and simulated Elo changes")
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



