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

# API: Tournament Details & Round Pairings
@router.get("/api/event/{event_id}", summary="Get tournament metadata, placings, and round pairings")
async def api_event_details(event_id: str, force_sync: bool = False):
    import threading
    db = get_database()
    event_id_str = event_id.strip()

    # Check existing data in DB
    event_details = db.get_event_details(event_id_str)

    # Auto-query BCP if:
    # 1) User explicitly requested force_sync
    # 2) Event is not yet in DB
    # 3) Event is ongoing/in-progress (is_ended is False)
    # 4) Event has 0 participants or matches scraped
    has_data = bool(event_details and event_details.get("players") and event_details.get("matches"))
    needs_roster_sync = (
        force_sync or 
        not has_data or 
        (event_details and all(p.get("pod_num") is None for p in event_details.get("players", [])) and (event_details.get("num_rounds", 0) >= 6 or event_details.get("total_players", 0) >= 48))
    )

    # If event details exist in DB, NEVER block HTTP response! Return immediately (<15ms)
    # and trigger BCP sync in a background thread.
    if event_details:
        is_syncing = event_id_str in _active_event_syncs
        if needs_roster_sync and not is_syncing:
            _active_event_syncs.add(event_id_str)
            is_syncing = True
            def bg_roster_sync(eid: str, scrape_full: bool):
                try:
                    scraper = BestCoastPairingsScraper(db=db)
                    scraper.sync_event_roster(eid)
                    if scrape_full:
                        scraper.scrape_event(eid)
                except Exception as e:
                    logger.warning(f"Failed to sync BCP details in background for event {eid}: {e}")
                finally:
                    _active_event_syncs.discard(eid)
            threading.Thread(target=bg_roster_sync, args=(event_id_str, not has_data), daemon=True).start()
        elif not event_details.get("is_ended", True) and not is_syncing:
            # Background refresh for live ongoing tournament
            _active_event_syncs.add(event_id_str)
            is_syncing = True
            def bg_live_scrape(eid: str):
                try:
                    scraper = BestCoastPairingsScraper(db=db)
                    scraper.scrape_event(eid)
                except Exception:
                    pass
                finally:
                    _active_event_syncs.discard(eid)
            threading.Thread(target=bg_live_scrape, args=(event_id_str,), daemon=True).start()

        event_details["sync_in_progress"] = is_syncing
        return event_details

    # Event is not yet in database: do initial fetch/scrape synchronously so we have data
    try:
        scraper = BestCoastPairingsScraper(db=db)
        scraper.sync_event_roster(event_id_str)
        scraper.scrape_event(event_id_str)
        event_details = db.get_event_details(event_id_str)
    except Exception as e:
        logger.warning(f"Failed to sync BCP details for event {event_id_str}: {e}")

    if not event_details:
        raise HTTPException(status_code=404, detail=f"Tournament '{event_id_str}' not found in database or on BCP")

    event_details["sync_in_progress"] = False
    return event_details

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
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)")
):
    try:
        return get_database().get_faction_meta_stats(start_date=start_date, end_date=end_date)
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



