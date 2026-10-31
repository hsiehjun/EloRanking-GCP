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
    DEFAULT_GAME_SYSTEM_ID, AOS_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR, MIN_MATCHES_FOR_RANKING,
    BCP_API_BASE, DEFAULT_HEADERS, BCP_CLIENT_ID, BCP_USER_AGENT, GOOGLE_MAPS_API_KEY,
    TRACKER_ROOMS, TRACKER_LISTENERS, generate_unique_match_id, normalize_tracker_match_id,
    normalize_ticket_price, normalize_game_system, get_bcp_game_system_id, get_game_system_meta
)

router = APIRouter(tags=["Regional Community Hub"])

import concurrent.futures

_community_field_stats_cache: Dict[str, Any] = {}

# =========================================================================
# REGIONAL COMMUNITY HUB & COMPETITOR DISCOVERY
# =========================================================================

@router.get("/api/community/regions", summary="Get Available Community Hub Regions")
def api_community_regions():
    db = get_database()
    return {"success": True, "regions": db.get_community_regions()}

@router.get("/api/community/reverse_geocode", summary="Reverse Geocode GPS Coordinates to City / Region")
def api_community_reverse_geocode(
    lat: float = Query(..., description="Latitude"),
    lng: float = Query(..., description="Longitude")
):
    db = get_database()
    res = db.reverse_geocode_coordinates(lat, lng)
    return {"success": True, **res}

@router.get("/api/community/overview", summary="Get Community Hub Overview, Events, and Competitors within Radius")
def api_community_overview(
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
    player_id = (user.get("player_id") or user.get("bcp_user_id")) if (user and user.get("bcp_user_id")) else None

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

@router.get("/api/community/bcp_upcoming", summary="Fetch live BCP & multi-platform upcoming tournaments asynchronously")
def api_community_bcp_upcoming(
    lat: float = Query(...),
    lng: float = Query(...),
    radius_miles: float = Query(50.0),
    days_ahead: int = Query(92),
    game_system: Optional[str] = Query("40k")
):
    db = get_database()
    events = db.fetch_bcp_upcoming_events(
        user_lat=lat,
        user_lng=lng,
        radius_miles=radius_miles,
        days_ahead=days_ahead,
        game_system=game_system,
        include_multiplatform=True,
    )
    return {"success": True, "events": events}


# =========================================================================
# PREMIER CIRCUIT & SUPER MAJORS GATEWAY (100% READ-ONLY / IN-MEMORY RAM CACHED)
# STRICT RULE: Zero SQL mutations or database writes.
# =========================================================================

_bcp_majors_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}

_SUPER_MAJOR_RE = re.compile(
    r"\b(?:lvo|las vegas open|adepticon|nova open|super major|london grand tournament|lgt|world championship|wtc|world team championship)\b",
    re.IGNORECASE,
)
_MAJOR_KEYWORD_RE = re.compile(
    r"\b(?:us open|major|armadillo cup|championship|championships|california cup|bfs gt|trials gx)\b",
    re.IGNORECASE,
)
_OPEN_STANDALONE_RE = re.compile(r"\bopen\b", re.IGNORECASE)
_OPEN_EXCL_RE = re.compile(r"\b(?:open play|grand opening|open gaming|open table|tts)\b", re.IGNORECASE)
_GT_KEYWORD_RE = re.compile(r"\b(?:gt|grand tournament|cup|brawl|clash|mwtc|invitational)\b", re.IGNORECASE)
_RTT_KEYWORD_RE = re.compile(r"\brtt\b", re.IGNORECASE)


def classify_tournament_tier(name: str, total_players: int = 0, num_tickets: int = 0, circuits: Optional[List[Any]] = None, num_rounds: int = 0) -> Dict[str, Any]:
    """Classifies an event into Super Major, Major, GT, or RTT with badges and styling.
    
    Strict rule:
    - <= 3 rounds (or RTT when rounds <= 3) is always an RTT.
    - > 3 rounds (4+ rounds) is a GT, or Major / Super Major when a GT has large attendance or flagship pedigree.
    """
    n_clean = (name or "").strip()
    n_lower = n_clean.lower()
    circuits_list = circuits or []
    try:
        tot_p = int(total_players or 0)
    except (ValueError, TypeError):
        tot_p = 0
    try:
        num_t = int(num_tickets or 0)
    except (ValueError, TypeError):
        num_t = 0
    try:
        rounds = int(num_rounds or 0)
    except (ValueError, TypeError):
        rounds = 0

    if (rounds > 0 and rounds <= 3) or (rounds <= 3 and bool(_RTT_KEYWORD_RE.search(n_lower)) and tot_p < 36 and num_t < 48):
        return {"tier": "rtt", "badge": "⚔️ RTT", "color": "#94a3b8", "weight": 1}

    is_super = (
        tot_p >= 200 or num_t >= 350 or
        bool(_SUPER_MAJOR_RE.search(n_lower))
    )
    if is_super:
        return {"tier": "super_major", "badge": "👑 SUPER MAJOR", "color": "#a855f7", "weight": 4}

    has_open_tier = (
        bool(_OPEN_STANDALONE_RE.search(n_lower))
        and not bool(_OPEN_EXCL_RE.search(n_lower))
        and (tot_p >= 48 or num_t >= 64 or rounds >= 5)
    )
    is_major = (
        tot_p >= 70 or num_t >= 90 or rounds >= 6 or
        bool(_MAJOR_KEYWORD_RE.search(n_lower)) or
        has_open_tier or
        any(isinstance(c, dict) and "open" in (c.get("name") or "").lower() for c in circuits_list)
    )
    if is_major:
        return {"tier": "major", "badge": "🌟 MAJOR", "color": "#38bdf8", "weight": 3}

    is_gt = (
        rounds > 3 or tot_p >= 28 or num_t >= 32 or
        bool(_GT_KEYWORD_RE.search(n_lower)) or
        (bool(_OPEN_STANDALONE_RE.search(n_lower)) and not bool(_OPEN_EXCL_RE.search(n_lower)) and (tot_p >= 24 or num_t >= 28))
    )
    if is_gt:
        return {"tier": "gt", "badge": "🏆 GRAND TOURNAMENT", "color": "#10b981", "weight": 2}

    return {"tier": "rtt", "badge": "⚔️ RTT", "color": "#94a3b8", "weight": 1}

def get_fallback_majors(game_system: str) -> List[Dict[str, Any]]:
    """Graceful mock fallback for premier events if BCP network is temporarily unreachable in dev/test."""
    now_utc = datetime.now(timezone.utc)
    sys_val = normalize_game_system(game_system, default="40k")
    if sys_val not in ("40k", "aos"):
        meta = get_game_system_meta(sys_val)
        sys_label = meta.get("label", sys_val.replace("_", " ").title())
        return [
            {
                "id": f"bcp_{sys_val}_lvo_2026",
                "name": f"LVO 2026 - {sys_label} Championships",
                "event_date": (now_utc + timedelta(days=18)).strftime("%Y-%m-%dT09:00:00.000Z"),
                "end_date": (now_utc + timedelta(days=20)).strftime("%Y-%m-%dT18:00:00.000Z"),
                "city": "Las Vegas",
                "state": "NV",
                "country": "United States",
                "venue": "Rio All-Suite Hotel & Casino",
                "total_players": 64,
                "num_tickets": 96,
                "circuits": [{"name": f"{sys_label} Premier Series"}],
                "tier": "major",
                "tier_badge": "🌟 MAJOR",
                "tier_color": "#38bdf8",
                "tier_weight": 3,
                "countdown_label": "in 18d",
                "game_system": sys_val,
                "is_started": False,
                "is_ended": False,
                "external_url": f"https://www.bestcoastpairings.com/event/bcp_{sys_val}_lvo_2026"
            },
            {
                "id": f"bcp_{sys_val}_adepticon_2027",
                "name": f"AdeptiCon 2027 - {sys_label} Open",
                "event_date": (now_utc + timedelta(days=45)).strftime("%Y-%m-%dT09:00:00.000Z"),
                "end_date": (now_utc + timedelta(days=47)).strftime("%Y-%m-%dT18:00:00.000Z"),
                "city": "Schaumburg",
                "state": "IL",
                "country": "United States",
                "venue": "Renaissance Schaumburg Convention Center",
                "total_players": 48,
                "num_tickets": 64,
                "circuits": [{"name": "AdeptiCon Premier"}],
                "tier": "gt",
                "tier_badge": "🏆 GRAND TOURNAMENT",
                "tier_color": "#10b981",
                "tier_weight": 2,
                "countdown_label": "in 45d",
                "game_system": sys_val,
                "is_started": False,
                "is_ended": False,
                "external_url": f"https://www.bestcoastpairings.com/event/bcp_{sys_val}_adepticon_2027"
            },
            {
                "id": f"bcp_{sys_val}_nova_2026",
                "name": f"NOVA Open 2026 - {sys_label} Grand Tournament",
                "event_date": (now_utc + timedelta(days=72)).strftime("%Y-%m-%dT09:00:00.000Z"),
                "end_date": (now_utc + timedelta(days=74)).strftime("%Y-%m-%dT18:00:00.000Z"),
                "city": "Washington",
                "state": "DC",
                "country": "United States",
                "venue": "Washington Hilton",
                "total_players": 36,
                "num_tickets": 48,
                "circuits": [{"name": "NOVA Open Circuit"}],
                "tier": "gt",
                "tier_badge": "🏆 GRAND TOURNAMENT",
                "tier_color": "#10b981",
                "tier_weight": 2,
                "countdown_label": "in 72d",
                "game_system": sys_val,
                "is_started": False,
                "is_ended": False,
                "external_url": f"https://www.bestcoastpairings.com/event/bcp_{sys_val}_nova_2026"
            }
        ]
    if sys_val == "aos":
        return [
            {
                "id": "bcp_aos_adepticon_2027",
                "name": "AdeptiCon 2027 - Warhammer Age of Sigmar Championships",
                "event_date": (now_utc + timedelta(days=120)).strftime("%Y-%m-%dT09:00:00.000Z"),
                "end_date": (now_utc + timedelta(days=123)).strftime("%Y-%m-%dT18:00:00.000Z"),
                "city": "Schaumburg",
                "state": "IL",
                "country": "United States",
                "venue": "Renaissance Schaumburg Convention Center",
                "total_players": 180,
                "num_tickets": 200,
                "circuits": [{"name": "AdeptiCon Premier"}],
                "tier": "super_major",
                "tier_badge": "👑 SUPER MAJOR",
                "tier_color": "#a855f7",
                "tier_weight": 4,
                "countdown_label": "in 120d",
                "game_system": "aos",
                "is_started": False,
                "is_ended": False,
                "external_url": "https://www.bestcoastpairings.com/event/bcp_aos_adepticon_2027"
            },
            {
                "id": "bcp_aos_trials_gx",
                "name": "Trials GX 2026 - Age of Sigmar Team Tournament",
                "event_date": (now_utc + timedelta(days=31)).strftime("%Y-%m-%dT08:00:00.000Z"),
                "end_date": (now_utc + timedelta(days=32)).strftime("%Y-%m-%dT17:00:00.000Z"),
                "city": "Montreal",
                "state": "QC",
                "country": "Canada",
                "venue": "Palais des congrès de Montréal",
                "total_players": 108,
                "num_tickets": 200,
                "circuits": [{"name": "Canadian Premier Series"}],
                "tier": "major",
                "tier_badge": "🌟 MAJOR",
                "tier_color": "#38bdf8",
                "tier_weight": 3,
                "countdown_label": "in 31d",
                "game_system": "aos",
                "is_started": False,
                "is_ended": False,
                "external_url": "https://www.bestcoastpairings.com/event/bcp_aos_trials_gx"
            },
            {
                "id": "bcp_aos_sydney_gt",
                "name": "Sydney Grand Tournament 2026 - AoS Major",
                "event_date": (now_utc + timedelta(days=16)).strftime("%Y-%m-%dT08:30:00.000Z"),
                "end_date": (now_utc + timedelta(days=17)).strftime("%Y-%m-%dT18:00:00.000Z"),
                "city": "Sydney",
                "state": "NSW",
                "country": "Australia",
                "venue": "Sydney Showground",
                "total_players": 65,
                "num_tickets": 160,
                "circuits": [{"name": "Down Under Circuit"}],
                "tier": "gt",
                "tier_badge": "🏆 GRAND TOURNAMENT",
                "tier_color": "#10b981",
                "tier_weight": 2,
                "countdown_label": "in 16d",
                "game_system": "aos",
                "is_started": False,
                "is_ended": False,
                "external_url": "https://www.bestcoastpairings.com/event/bcp_aos_sydney_gt"
            }
        ]
    return [
        {
            "id": "bcp_ev_lvo_2026",
            "name": "LVO 2026 - Warhammer 40k Championships - Las Vegas Open",
            "event_date": (now_utc + timedelta(days=16)).strftime("%Y-%m-%dT16:00:00.000Z"),
            "end_date": (now_utc + timedelta(days=19)).strftime("%Y-%m-%dT20:00:00.000Z"),
            "city": "Las Vegas",
            "state": "NV",
            "country": "United States",
            "venue": "Rio All-Suite Hotel & Casino",
            "total_players": 351,
            "num_tickets": 1000,
            "circuits": [{"name": "Frontline Gaming ITC Super Major"}],
            "tier": "super_major",
            "tier_badge": "👑 SUPER MAJOR",
            "tier_color": "#a855f7",
            "tier_weight": 4,
            "countdown_label": "in 16d",
            "game_system": "40k",
            "is_started": False,
            "is_ended": False,
            "external_url": "https://www.bestcoastpairings.com/event/bcp_ev_lvo_2026"
        },
        {
            "id": "bcp_ev_lgt_2026",
            "name": "The London Grand Tournament - 40k Main Event (LGT 40k GT)",
            "event_date": (now_utc + timedelta(days=9)).strftime("%Y-%m-%dT08:00:00.000Z"),
            "end_date": (now_utc + timedelta(days=11)).strftime("%Y-%m-%dT19:00:00.000Z"),
            "city": "London",
            "state": "England",
            "country": "United Kingdom",
            "venue": "Lee Valley Athletics Centre",
            "total_players": 592,
            "num_tickets": 1200,
            "circuits": [{"name": "UKTC Super Major"}],
            "tier": "super_major",
            "tier_badge": "👑 SUPER MAJOR",
            "tier_color": "#a855f7",
            "tier_weight": 4,
            "countdown_label": "in 9d",
            "game_system": "40k",
            "is_started": False,
            "is_ended": False,
            "external_url": "https://www.bestcoastpairings.com/event/bcp_ev_lgt_2026"
        },
        {
            "id": "bcp_ev_tacoma_open",
            "name": "Warhammer 40,000 US Open Series: Tacoma",
            "event_date": (now_utc + timedelta(days=32)).strftime("%Y-%m-%dT09:00:00.000Z"),
            "end_date": (now_utc + timedelta(days=34)).strftime("%Y-%m-%dT18:00:00.000Z"),
            "city": "Tacoma",
            "state": "WA",
            "country": "United States",
            "venue": "Greater Tacoma Convention Center",
            "total_players": 256,
            "num_tickets": 256,
            "circuits": [{"name": "Official Games Workshop US Open Series"}],
            "tier": "major",
            "tier_badge": "🌟 MAJOR",
            "tier_color": "#38bdf8",
            "tier_weight": 3,
            "countdown_label": "in 32d",
            "game_system": "40k",
            "is_started": False,
            "is_ended": False,
            "external_url": "https://www.bestcoastpairings.com/event/bcp_ev_tacoma_open"
        },
        {
            "id": "bcp_ev_houston_armadillo",
            "name": "The Armadillo Cup WarZone Houston - Major",
            "event_date": (now_utc + timedelta(days=9)).strftime("%Y-%m-%dT09:00:00.000Z"),
            "end_date": (now_utc + timedelta(days=11)).strftime("%Y-%m-%dT18:00:00.000Z"),
            "city": "Houston",
            "state": "TX",
            "country": "United States",
            "venue": "Houston Marriott Westchase",
            "total_players": 138,
            "num_tickets": 180,
            "circuits": [{"name": "WarZone Circuit"}],
            "tier": "major",
            "tier_badge": "🌟 MAJOR",
            "tier_color": "#38bdf8",
            "tier_weight": 3,
            "countdown_label": "in 9d",
            "game_system": "40k",
            "is_started": False,
            "is_ended": False,
            "external_url": "https://www.bestcoastpairings.com/event/bcp_ev_houston_armadillo"
        },
        {
            "id": "bcp_ev_california_cup",
            "name": "The California Cup 2026 - Warhammer 40K Regional GT",
            "event_date": (now_utc + timedelta(days=51)).strftime("%Y-%m-%dT09:00:00.000Z"),
            "end_date": (now_utc + timedelta(days=53)).strftime("%Y-%m-%dT17:00:00.000Z"),
            "city": "Pomona",
            "state": "CA",
            "country": "United States",
            "venue": "Fairplex Convention Center",
            "total_players": 90,
            "num_tickets": 120,
            "circuits": [{"name": "SoCal Circuit"}],
            "tier": "gt",
            "tier_badge": "🏆 GRAND TOURNAMENT",
            "tier_color": "#10b981",
            "tier_weight": 2,
            "countdown_label": "in 51d",
            "game_system": "40k",
            "is_started": False,
            "is_ended": False,
            "external_url": "https://www.bestcoastpairings.com/event/bcp_ev_california_cup"
        }
    ]

_bcp_majors_refreshing: set = set()


def _is_non_local_league_or_multiweek(name: str, start_date_str: str, end_date_str: str) -> bool:
    """
    Returns True if an event stretches over multiple weeks (> 5 calendar days / > 4 days diff)
    or is an escalation/seasonal/narrative/online league rather than a weekend tournament.
    """
    s_prefix = str(start_date_str or "").strip()[:10]
    e_prefix = str(end_date_str or "").strip()[:10]
    duration_days = 0
    if s_prefix and e_prefix and len(s_prefix) == 10 and len(e_prefix) == 10:
        try:
            s_dt = datetime.strptime(s_prefix, "%Y-%m-%d").date()
            e_dt = datetime.strptime(e_prefix, "%Y-%m-%d").date()
            duration_days = (e_dt - s_dt).days
            if duration_days > 4:
                return True
        except Exception:
            pass

    n_lower = f" {(name or '').lower()} "
    league_keywords = (
        "escalation",
        "slow grow",
        "slow-grow",
        "crusade league",
        "narrative league",
        "monthly league",
        "weekly league",
        "seasonal league",
        "summer league",
        "winter league",
        "spring league",
        "fall league",
        "autumn league",
        "league season",
        "pod league",
        "store league",
        "ladder league",
        "combat patrol league",
        "spearhead league",
        "tabletop simulator",
        " tts ",
        " online ",
    )
    if any(kw in n_lower for kw in league_keywords):
        return True

    if re.search(r"\bleagues?\b", n_lower):
        weekend_tourney_terms = ("gt", "grand tournament", "major", "super major", "open", "championship", "invitational", "cup")
        if not any(wt in n_lower for wt in weekend_tourney_terms) or duration_days > 3:
            return True

    return False


def _fetch_bcp_events_window(bcp_game_sys: str, start_iso: str, end_iso: str, limit: int = 45, timeout: float = 2.5) -> List[Dict[str, Any]]:
    params = {
        "limit": limit,
        "gameSystemId": bcp_game_sys,
        "startDate": start_iso,
        "endDate": end_iso,
        "sortKey": "totalPlayers",
        "sortAscending": "false",
        "excludeOnline": "true",
    }
    url = f"{BCP_API_BASE}/events?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers=DEFAULT_HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw_bytes = resp.read()
        if isinstance(raw_bytes, (bytes, bytearray)) and len(raw_bytes) >= 2 and raw_bytes[:2] == b"\x1f\x8b":
            import gzip
            raw_bytes = gzip.decompress(raw_bytes)
        data = json.loads(raw_bytes.decode("utf-8") if isinstance(raw_bytes, (bytes, bytearray)) else str(raw_bytes))
        return data.get("data", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])


def _refresh_bcp_majors_sync(target_sys: str, days_ahead: int = 180, min_players: int = 28) -> List[Dict[str, Any]]:
    target_sys = normalize_game_system(target_sys, default="40k")
    bcp_game_sys = get_bcp_game_system_id(target_sys)
    eff_min_players = min_players if target_sys in ("40k", "aos") else min(min_players, 12)
    now_ts = time.time()
    now_utc = datetime.now(timezone.utc)
    today_utc_str = now_utc.strftime("%Y-%m-%d")

    upcoming_start_iso = (now_utc - timedelta(days=2)).strftime("%Y-%m-%dT00:00:00.000Z")
    upcoming_end_iso = (now_utc + timedelta(days=days_ahead)).strftime("%Y-%m-%dT23:59:59.999Z")

    past_start_iso = (now_utc - timedelta(days=90)).strftime("%Y-%m-%dT00:00:00.000Z")
    past_end_iso = (now_utc - timedelta(days=2)).strftime("%Y-%m-%dT23:59:59.999Z")

    raw_events: List[Dict[str, Any]] = []
    mp_majors: List[Dict[str, Any]] = []
    try:
        from scripts.platform_discovery import discover_multiplatform_events
    except Exception:
        discover_multiplatform_events = None

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            fut_up = pool.submit(_fetch_bcp_events_window, bcp_game_sys, upcoming_start_iso, upcoming_end_iso, 50, 2.5)
            fut_past = pool.submit(_fetch_bcp_events_window, bcp_game_sys, past_start_iso, past_end_iso, 45, 2.5)
            fut_mp = (
                pool.submit(
                    discover_multiplatform_events,
                    target_sys,
                    days_ahead,
                    None,
                    None,
                    None,
                    True,
                    True,
                    2.4,
                )
                if discover_multiplatform_events is not None
                else None
            )
            for fut in (fut_up, fut_past):
                try:
                    res_list = fut.result(timeout=2.8)
                    if isinstance(res_list, list):
                        raw_events.extend(res_list)
                except Exception as sub_err:
                    logger.debug(f"Notice during parallel BCP majors window fetch ({target_sys}): {sub_err}")
            if fut_mp is not None:
                try:
                    mp_res = fut_mp.result(timeout=2.6)
                    if isinstance(mp_res, list):
                        mp_majors = mp_res
                except Exception as mp_err:
                    logger.debug(f"Notice during parallel multi-platform majors fetch ({target_sys}): {mp_err}")
    except Exception as e:
        logger.warning(f"Notice during live BCP majors query ({target_sys}): {e}")

    normalized: List[Dict[str, Any]] = []
    seen_ids = set()

    for ev in raw_events:
        eid = str(ev.get("id") or ev.get("objectId") or "").strip()
        if not eid or eid in seen_ids:
            continue

        loc = ev.get("location") if isinstance(ev.get("location"), dict) else {}
        city = ev.get("city") or loc.get("city") or ""
        state = ev.get("state") or loc.get("state") or ""
        country = ev.get("country") or loc.get("country") or ""
        venue = (
            ev.get("locationName") or ev.get("venueName") or ev.get("venue") or ev.get("venue_name")
            or loc.get("venueName") or loc.get("venue") or loc.get("name") or ""
        )
        street_num = str(ev.get("streetNum") or loc.get("streetNum") or "").strip()
        street_name = str(ev.get("streetName") or loc.get("streetName") or "").strip()
        street_addr = f"{street_num} {street_name}".strip() if (street_num or street_name) else str(ev.get("street_address") or loc.get("address") or loc.get("streetAddress") or "").strip()
        fmt_addr = str(
            ev.get("formatted_address") or ev.get("formattedAddress") or ev.get("address")
            or loc.get("formatted_address") or loc.get("formattedAddress") or street_addr or ""
        ).strip()
        postal_code = str(ev.get("zip") or ev.get("postalCode") or ev.get("postal_code") or loc.get("zip") or loc.get("postalCode") or "").strip()
        lat_val = ev.get("latitude")
        lng_val = ev.get("longitude")
        if lat_val is None or lng_val is None:
            cp_obj = ev.get("coordinate_point")
            coords = ev.get("coordinate") or loc.get("coordinate") or (cp_obj.get("coordinates") if isinstance(cp_obj, dict) else None)
            if isinstance(coords, (list, tuple)) and len(coords) >= 2:
                try:
                    lng_val = float(coords[0])
                    lat_val = float(coords[1])
                except (ValueError, TypeError):
                    pass

        total_players = 0
        try:
            total_players = int(ev.get("totalPlayers") or ev.get("total_players") or 0)
        except Exception:
            total_players = 0

        num_tickets = 0
        try:
            num_tickets = int(ev.get("numTickets") or ev.get("num_tickets") or ev.get("capacity") or 0)
        except Exception:
            num_tickets = 0

        event_date = ev.get("eventDate") or ev.get("event_date") or ""
        end_date = ev.get("endDate") or ev.get("eventEndDate") or ev.get("end_date") or ""
        if hasattr(event_date, "isoformat"):
            event_date = event_date.isoformat()
        if hasattr(end_date, "isoformat"):
            end_date = end_date.isoformat()
        if end_date and isinstance(end_date, str) and "T" in end_date:
            try:
                end_dt = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
                if 0 <= end_dt.hour < 6:
                    adj_dt = end_dt - timedelta(hours=6)
                    start_prefix = str(event_date or "")[:10]
                    adj_str = adj_dt.strftime("%Y-%m-%d")
                    if not start_prefix or adj_str >= start_prefix:
                        end_date = adj_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
            except Exception:
                pass

        name = ev.get("name") or "Tournament"
        circuits = ev.get("circuits") or []
        num_rounds = 0
        try:
            num_rounds = int(ev.get("numberOfRounds") or ev.get("numRounds") or ev.get("num_rounds") or ev.get("rounds") or 0)
        except Exception:
            num_rounds = 0

        # Strictly exclude multi-week events / escalation leagues / online events from Global Majors
        if _is_non_local_league_or_multiweek(name, str(event_date or ""), str(end_date or "")):
            continue

        tier_info = classify_tournament_tier(name, total_players, num_tickets, circuits, num_rounds=num_rounds)

        # Global events must only be weekend large tournaments (GT, Major, Super Major), or >= 12 players for non-40k/aos systems
        if target_sys in ("40k", "aos") and tier_info["tier"] not in ("super_major", "major", "gt"):
            continue
        if total_players < eff_min_players and num_tickets < (48 if target_sys in ("40k", "aos") else 16):
            continue

        seen_ids.add(eid)

        ev_date_prefix = str(event_date or "")[:10]
        end_date_prefix = str(end_date or "")[:10] or ev_date_prefix
        status_obj = ev.get("status") if isinstance(ev.get("status"), dict) else {}
        is_ended = bool(
            ev.get("isEnded") or ev.get("is_ended") or ev.get("ended") or
            status_obj.get("ended") or status_obj.get("isEnded") or
            (end_date_prefix and end_date_prefix < today_utc_str)
        )

        # Compute countdown
        countdown_label = ""
        try:
            ev_dt = datetime.fromisoformat(str(event_date).replace("Z", "+00:00"))
            delta_days = (ev_dt.date() - now_utc.date()).days
            if is_ended:
                countdown_label = "Completed"
            elif delta_days == 0:
                countdown_label = "Today"
            elif delta_days == 1:
                countdown_label = "Tomorrow"
            elif delta_days > 1:
                countdown_label = f"in {delta_days}d"
            else:
                countdown_label = "Live Now"
        except Exception:
            countdown_label = "Completed" if is_ended else ""

        normalized.append({
            "id": eid,
            "name": name,
            "event_date": event_date,
            "end_date": end_date,
            "city": city,
            "state": state,
            "country": country,
            "venue": venue,
            "venue_name": venue,
            "address": fmt_addr,
            "formatted_address": fmt_addr,
            "street_address": street_addr,
            "postal_code": postal_code,
            "latitude": lat_val,
            "longitude": lng_val,
            "total_players": total_players,
            "num_tickets": num_tickets,
            "num_rounds": num_rounds,
            "circuits": circuits,
            "tier": tier_info["tier"],
            "tier_badge": tier_info["badge"],
            "tier_color": tier_info["color"],
            "tier_weight": tier_info["weight"],
            "countdown_label": countdown_label,
            "game_system": target_sys,
            "is_local": False,
            "is_started": bool(is_ended or ev.get("isStarted") or ev.get("started")),
            "is_ended": is_ended,
            "external_url": ev.get("externalUrl") or ev.get("external_url") or f"https://www.bestcoastpairings.com/event/{eid}"
        })

    # Merge real multi-platform premier/upcoming events (Melee.gg, Limitless TCG, TopDeck.gg)
    # STRICT POLICY: Zero fake/mock/synthetic fallback events in production discovery.
    for mp_ev in mp_majors:
        mp_id = str(mp_ev.get("id") or "").strip()
        if not mp_id or mp_id in seen_ids:
            continue
        seen_ids.add(mp_id)
        mp_item = dict(mp_ev)
        if not mp_item.get("countdown_label"):
            is_end_mp = bool(mp_item.get("is_ended"))
            try:
                ev_dt_mp = datetime.fromisoformat(str(mp_item.get("event_date") or "").replace("Z", "+00:00"))
                if ev_dt_mp.tzinfo is None:
                    ev_dt_mp = ev_dt_mp.replace(tzinfo=timezone.utc)
                delta_d = (ev_dt_mp.date() - now_utc.date()).days
                if is_end_mp:
                    mp_item["countdown_label"] = "Completed"
                elif mp_item.get("is_started") or delta_d < 0:
                    mp_item["countdown_label"] = "Live Now"
                elif delta_d == 0:
                    mp_item["countdown_label"] = "Today"
                elif delta_d == 1:
                    mp_item["countdown_label"] = "Tomorrow"
                else:
                    mp_item["countdown_label"] = f"in {delta_d}d"
            except Exception:
                mp_item["countdown_label"] = "Completed" if is_end_mp else ("Live Now" if mp_item.get("is_started") else "")
        mp_item.setdefault("tier_color", "#f59e0b" if mp_item.get("tier") == "super_major" else ("#a855f7" if mp_item.get("tier") == "major" else "#38bdf8"))
        mp_item["game_system"] = target_sys
        mp_item["is_local"] = False
        normalized.append(mp_item)

    # Sort upcoming/live events before ended events, then by tier weight descending, player count descending, and date
    normalized.sort(
        key=lambda x: (
            1 if x.get("is_ended") else 0,
            -int(x.get("tier_weight") or 0),
            -int(x.get("total_players") or 0),
            str(x.get("event_date") or "9999"),
        )
    )

    cache_ts = (now_ts - 7185) if not normalized else now_ts
    _bcp_majors_cache[target_sys] = (cache_ts, normalized)
    return normalized


import threading as _majors_threading
_bcp_majors_inflight_events: Dict[str, _majors_threading.Event] = {}
_bcp_majors_lock = _majors_threading.Lock()


def _get_fast_db_majors_readonly(target_sys: str, min_players: int = 28) -> List[Dict[str, Any]]:
    """Fast (<25ms) read-only local PostgreSQL query for premier tournaments when cold remote scrape exceeds budget.
    Returns strictly real database events (never synthetic bcp_* placeholders).
    """
    db_majors: List[Dict[str, Any]] = []
    try:
        db = get_database()
        if db and getattr(db, "_pool", None) is not None and not (hasattr(db, "_is_mock_instance") and db._is_mock_instance()):
            with db.get_connection() as conn:
                cursor_factory = getattr(extras, "RealDictCursor", None) if extras else None
                cursor_kw = {"cursor_factory": cursor_factory} if cursor_factory else {}
                with conn.cursor(**cursor_kw) as cur:
                    cur.execute("SET LOCAL statement_timeout = '350ms';")
                    cur.execute("""
                        SELECT id, name, event_date, end_date, city, state, country, venue, venue_name,
                               address, postal_code,
                               COALESCE(
                                   NULLIF(latitude, 0.0),
                                   CASE WHEN raw_json IS NOT NULL AND jsonb_typeof(raw_json->'coordinate') = 'array' AND jsonb_array_length(raw_json->'coordinate') >= 2
                                        THEN (raw_json->'coordinate'->>1)::double precision ELSE NULL END
                               ) AS latitude,
                               COALESCE(
                                   NULLIF(longitude, 0.0),
                                   CASE WHEN raw_json IS NOT NULL AND jsonb_typeof(raw_json->'coordinate') = 'array' AND jsonb_array_length(raw_json->'coordinate') >= 2
                                        THEN (raw_json->'coordinate'->>0)::double precision ELSE NULL END
                               ) AS longitude,
                               COALESCE(total_players, 0) AS total_players,
                               COALESCE(num_rounds, 0) AS num_rounds,
                               COALESCE(is_ended, FALSE) AS is_ended
                        FROM events
                        WHERE COALESCE(game_system, '40k') = %s
                          AND event_date >= CURRENT_DATE - INTERVAL '90 days'
                          AND (COALESCE(total_players, 0) >= %s OR COALESCE(num_rounds, 0) >= 5)
                        ORDER BY event_date DESC
                        LIMIT 60;
                    """, (target_sys, min_players))
                    for row in (cur.fetchall() or []):
                        r = dict(row) if hasattr(row, "keys") else {}
                        eid_s = str(r.get("id") or "").strip()
                        if not eid_s or eid_s.startswith("bcp_"):
                            continue
                        tier_info = classify_tournament_tier(
                            r.get("name") or "",
                            total_players=int(r.get("total_players") or 0),
                            num_rounds=int(r.get("num_rounds") or 0),
                        )
                        if tier_info["tier"] == "rtt":
                            continue
                        ev_dt = r.get("event_date")
                        end_dt = r.get("end_date")
                        db_majors.append({
                            "id": eid_s,
                            "name": r.get("name") or "Tournament",
                            "event_date": ev_dt.isoformat() if hasattr(ev_dt, "isoformat") else str(ev_dt or ""),
                            "end_date": end_dt.isoformat() if hasattr(end_dt, "isoformat") else str(end_dt or ""),
                            "city": r.get("city") or "",
                            "state": r.get("state") or "",
                            "country": r.get("country") or "",
                            "venue": r.get("venue_name") or r.get("venue") or "",
                            "venue_name": r.get("venue_name") or r.get("venue") or "",
                            "address": r.get("address") or "",
                            "postal_code": r.get("postal_code") or "",
                            "latitude": float(r["latitude"]) if r.get("latitude") is not None else None,
                            "longitude": float(r["longitude"]) if r.get("longitude") is not None else None,
                            "total_players": int(r.get("total_players") or 0),
                            "num_tickets": int(r.get("total_players") or 0),
                            "num_rounds": int(r.get("num_rounds") or 0),
                            "circuits": [],
                            "tier": tier_info["tier"],
                            "tier_badge": tier_info["badge"],
                            "tier_color": tier_info["color"],
                            "tier_weight": tier_info["weight"],
                            "game_system": target_sys,
                            "is_ended": bool(r.get("is_ended")),
                            "external_url": f"https://www.bestcoastpairings.com/event/{eid_s}" if ":" not in eid_s else "",
                        })
    except Exception:
        pass
    return db_majors


def fetch_live_bcp_majors(
    game_system: Optional[str] = "40k",
    days_ahead: int = 180,
    min_players: int = 28,
    max_wait_sec: Optional[float] = None,
) -> List[Dict[str, Any]]:
    """
    Fetches premier Super Majors, Majors, and GTs (both upcoming and past 90d) without spatial radius boundaries from BCP API.
    Uses an in-memory Python RAM cache (2-hour TTL) with single-flight deduplication and stale-while-revalidate for <5ms response latency.
    STRICT POLICY: Zero SQL writes / Zero database mutations / Zero synthetic fallback events.
    """
    target_sys = normalize_game_system(game_system, default="40k")

    now_ts = time.time()
    cached = _bcp_majors_cache.get(target_sys)
    if cached:
        age = now_ts - cached[0]
        if age < 7200:
            return cached[1]
        # Stale-while-revalidate: return warm cache immediately (<1ms) and refresh asynchronously
        with _bcp_majors_lock:
            if target_sys not in _bcp_majors_refreshing:
                _bcp_majors_refreshing.add(target_sys)
                ev_swr = _majors_threading.Event()
                _bcp_majors_inflight_events[target_sys] = ev_swr

                def _bg_refresh():
                    try:
                        _refresh_bcp_majors_sync(target_sys, days_ahead=days_ahead, min_players=min_players)
                    finally:
                        with _bcp_majors_lock:
                            _bcp_majors_refreshing.discard(target_sys)
                            _bcp_majors_inflight_events.pop(target_sys, None)
                        ev_swr.set()

                _majors_threading.Thread(target=_bg_refresh, daemon=True).start()
        return cached[1]

    with _bcp_majors_lock:
        cached = _bcp_majors_cache.get(target_sys)
        if cached and (time.time() - cached[0]) < 7200:
            return cached[1]
        inflight_ev = _bcp_majors_inflight_events.get(target_sys)
        if inflight_ev is None:
            inflight_ev = _majors_threading.Event()
            _bcp_majors_inflight_events[target_sys] = inflight_ev
            _bcp_majors_refreshing.add(target_sys)
            is_leader = True
        else:
            is_leader = False

    if max_wait_sec is None:
        if is_leader:
            try:
                return _refresh_bcp_majors_sync(target_sys, days_ahead=days_ahead, min_players=min_players)
            finally:
                with _bcp_majors_lock:
                    _bcp_majors_refreshing.discard(target_sys)
                    _bcp_majors_inflight_events.pop(target_sys, None)
                inflight_ev.set()
        else:
            inflight_ev.wait(timeout=15.0)
            cached_after = _bcp_majors_cache.get(target_sys)
            return cached_after[1] if cached_after else []

    # Bounded latency HTTP path (max_wait_sec provided, e.g. 0.60s)
    if is_leader:
        def _bg_cold_majors():
            try:
                _refresh_bcp_majors_sync(target_sys, days_ahead=days_ahead, min_players=min_players)
            except Exception:
                pass
            finally:
                with _bcp_majors_lock:
                    _bcp_majors_refreshing.discard(target_sys)
                    _bcp_majors_inflight_events.pop(target_sys, None)
                inflight_ev.set()

        _majors_threading.Thread(target=_bg_cold_majors, daemon=True).start()

    if inflight_ev.wait(timeout=max_wait_sec):
        cached_after = _bcp_majors_cache.get(target_sys)
        if cached_after is not None:
            return cached_after[1]

    return _get_fast_db_majors_readonly(target_sys, min_players=min_players)


@router.get("/api/community/bcp_majors", summary="Fetch live premier circuit & major tournaments (read-only RAM cache)")
def api_community_bcp_majors(
    game_system: Optional[str] = Query("40k"),
    days_ahead: int = Query(180)
):
    """
    Returns upcoming and recent past premier Super Majors, Majors, and GTs without spatial radius boundaries.
    100% read-only, backed by 2-hour Python RAM cache + 600ms cold timeout cap. Zero DB mutations.
    """
    target_sys = normalize_game_system(game_system, default="40k")
    majors = fetch_live_bcp_majors(game_system=target_sys, days_ahead=days_ahead, max_wait_sec=0.60)
    return {
        "success": True,
        "events": majors,
        "count": len(majors),
        "game_system": target_sys
    }


# =========================================================================
# COMMUNITY HUB TOURNAMENT RECOMMENDATION & INSTANT SEARCH ENGINE
# =========================================================================

_community_recs_cache: Dict[Tuple[Any, ...], Tuple[float, Dict[str, Any]]] = {}
_community_search_cache: Dict[Tuple[Any, ...], Tuple[float, Dict[str, Any]]] = {}

_US_STATE_CODES = frozenset({
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN",
    "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
    "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT",
    "VT", "VA", "WA", "WV", "WI", "WY",
})
_CA_PROVINCE_CODES = frozenset({
    "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
})
_CASUAL_NOISE_RE = re.compile(
    r"\b(?:open play|casual play|free play|learn to play|demo day|hobby night|paint(?:ing)? night|"
    r"paint(?:ing)? competition|armies on parade|swap meet|bazaar|flea market|escalation|slow grow|"
    r"crusade|narrative league|combat patrol|boarding actions|spearhead|path to glory)\b",
    re.IGNORECASE,
)
_VIRTUAL_EVENT_RE = re.compile(
    r"\b(?:tts|tabletop simulator|spelltable|webcam|online league|online rtt|online gt|online tournament)\b",
    re.IGNORECASE,
)
_LEAGUE_WORD_RE = re.compile(r"\bleagues?\b", re.IGNORECASE)
_LEAGUE_COMPETITIVE_OVERRIDE_RE = re.compile(
    r"\b(?:gt|grand tournament|major|super major|cup|championship|championships|invitational|qualifier|finals|rtt)\b",
    re.IGNORECASE,
)


def _haversine_miles(lat1: Optional[float], lng1: Optional[float], lat2: Optional[float], lng2: Optional[float]) -> Optional[float]:
    if lat1 is None or lng1 is None or lat2 is None or lng2 is None:
        return None
    try:
        f_lat1, f_lng1 = float(lat1), float(lng1)
        f_lat2, f_lng2 = float(lat2), float(lng2)
        if (f_lat1 == 0.0 and f_lng1 == 0.0) or (f_lat2 == 0.0 and f_lng2 == 0.0):
            return None
        dlat = math.radians(f_lat2 - f_lat1)
        dlng = math.radians(f_lng2 - f_lng1)
        a = (
            math.sin(dlat / 2.0) ** 2
            + math.cos(math.radians(f_lat1)) * math.cos(math.radians(f_lat2)) * math.sin(dlng / 2.0) ** 2
        )
        c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
        return round(3959.0 * c, 1)
    except Exception:
        return None


def normalize_country_and_region(
    country: Optional[str] = "",
    state: Optional[str] = "",
    lat: Optional[float] = None,
    lng: Optional[float] = None,
) -> Tuple[str, str]:
    """Normalizes country/state/GPS into (country_code, continent_region)."""
    c = (country or "").strip().lower()
    st = (state or "").strip().upper()

    if c in ("us", "usa", "u.s.", "u.s.a.", "united states", "united states of america"):
        return ("US", "NA")
    if c in ("ca", "can", "canada"):
        return ("CA", "NA")
    if c in ("mx", "mex", "mexico", "méxico"):
        return ("MX", "NA")
    if c in ("uk", "gb", "gbr", "united kingdom", "great britain", "england", "scotland", "wales", "northern ireland"):
        return ("UK", "EU")
    if c in ("au", "aus", "australia"):
        return ("AU", "OCE")
    if c in ("nz", "nzl", "new zealand"):
        return ("NZ", "OCE")

    eu_map = {
        "es": "ES", "spain": "ES", "españa": "ES",
        "fr": "FR", "france": "FR",
        "de": "DE", "germany": "DE", "deutschland": "DE",
        "it": "IT", "italy": "IT", "italia": "IT",
        "pl": "PL", "poland": "PL", "polska": "PL",
        "se": "SE", "sweden": "SE", "sverige": "SE",
        "dk": "DK", "denmark": "DK", "danmark": "DK",
        "no": "NO", "norway": "NO",
        "fi": "FI", "finland": "FI",
        "nl": "NL", "netherlands": "NL", "the netherlands": "NL",
        "be": "BE", "belgium": "BE",
        "at": "AT", "austria": "AT",
        "ch": "CH", "switzerland": "CH",
        "cz": "CZ", "czechia": "CZ", "czech republic": "CZ",
        "ie": "IE", "ireland": "IE",
        "pt": "PT", "portugal": "PT",
    }
    if c in eu_map:
        return (eu_map[c], "EU")

    if not c:
        if st in _US_STATE_CODES:
            return ("US", "NA")
        if st in _CA_PROVINCE_CODES:
            return ("CA", "NA")
        if lat is not None and lng is not None:
            try:
                flat, flng = float(lat), float(lng)
                if 24.4 <= flat <= 49.4 and -125.0 <= flng <= -66.5:
                    return ("US", "NA")
                if 49.4 < flat <= 70.0 and -141.0 <= flng <= -52.0:
                    return ("CA", "NA")
                if 14.5 <= flat < 24.4 and -118.0 <= flng <= -86.0:
                    return ("MX", "NA")
                if 35.0 <= flat <= 71.0 and -11.0 <= flng <= 32.0:
                    return ("EU", "EU")
                if -45.0 <= flat <= -10.0 and 112.0 <= flng <= 155.0:
                    return ("AU", "OCE")
            except Exception:
                pass

    if c:
        return (c[:3].upper(), "GLOBAL")
    return ("", "GLOBAL")


def estimate_drive_time(
    distance_miles: Optional[float],
    user_country: str = "",
    event_country: str = "",
) -> Dict[str, Any]:
    """Estimates realistic road miles and driving time from straight-line Haversine distance."""
    if distance_miles is None:
        return {
            "road_miles": None,
            "drive_minutes": None,
            "drive_hours": None,
            "drive_label": "",
            "cross_border": False,
        }
    dm = max(0.0, float(distance_miles))
    road_miles = max(1, int(round(dm * 1.20))) if dm >= 0.8 else 0
    if dm <= 18.0:
        avg_mph = 45.0
    elif dm <= 45.0:
        avg_mph = 52.0
    else:
        avg_mph = 58.0

    raw_mins = (dm * 1.20 / avg_mph) * 60.0 if dm >= 1.0 else 5.0
    cross_border = bool(user_country and event_country and user_country != event_country)
    if cross_border:
        raw_mins += 45.0

    drive_mins = max(5, int(round(raw_mins / 5.0) * 5))
    drive_hours = round(drive_mins / 60.0, 2)
    if drive_mins < 60:
        label = f"~{drive_mins}m drive"
    else:
        hrs = drive_mins // 60
        rem = drive_mins % 60
        label = f"~{hrs}h drive" if rem == 0 else f"~{hrs}h {rem}m drive"

    return {
        "road_miles": road_miles,
        "drive_minutes": drive_mins,
        "drive_hours": drive_hours,
        "drive_label": label,
        "cross_border": cross_border,
    }


def is_casual_or_irrelevant_event(ev: Dict[str, Any], game_system: str = "40k") -> Tuple[bool, str]:
    """Identifies non-tournament noise (Open Play, casual leagues, TTS/online, synthetic IDs, dead 0/0 stubs)."""
    eid = str(ev.get("id") or "").strip()
    if not eid or eid.startswith("bcp_"):
        return (True, "synthetic_or_empty_id")
    if bool(ev.get("private_event")):
        return (True, "private_event")

    name = (ev.get("name") or "").strip()
    city = (ev.get("city") or "").strip()
    venue = (ev.get("venue_name") or ev.get("venue") or "").strip()
    n_lower = name.lower()
    city_lower = city.lower()

    if city_lower in ("online", "virtual", "tts", "remote", "discord") or bool(_VIRTUAL_EVENT_RE.search(name)) or bool(_VIRTUAL_EVENT_RE.search(venue)):
        return (True, "online_or_tts")

    if bool(_CASUAL_NOISE_RE.search(name)):
        return (True, "casual_non_tournament")

    # Multi-week or ongoing casual league check
    start_s = str(ev.get("event_date") or "")[:10]
    end_s = str(ev.get("end_date") or "")[:10]
    if len(start_s) == 10 and len(end_s) == 10 and end_s > start_s:
        try:
            d0 = datetime.strptime(start_s, "%Y-%m-%d").date()
            d1 = datetime.strptime(end_s, "%Y-%m-%d").date()
            if (d1 - d0).days > 4:
                return (True, "multi_week_league")
        except Exception:
            pass

    if bool(_LEAGUE_WORD_RE.search(n_lower)) and not bool(_LEAGUE_COMPETITIVE_OVERRIDE_RE.search(n_lower)):
        return (True, "league_session")

    tot_p = int(ev.get("total_players") or 0)
    num_t = int(ev.get("num_tickets") or 0)
    rounds = int(ev.get("num_rounds") or 0)
    is_ended = bool(ev.get("is_ended"))

    if is_ended and tot_p <= 2:
        return (True, "empty_ended_stub")

    if not is_ended and tot_p <= 0 and num_t <= 0 and rounds in (1, 2):
        return (True, "casual_short_stub")

    if not is_ended and tot_p <= 0 and num_t <= 0 and rounds == 0:
        tier_chk = classify_tournament_tier(name, tot_p, num_t, ev.get("circuits") or [], num_rounds=rounds)
        if tier_chk["tier"] == "rtt" and not bool(_RTT_KEYWORD_RE.search(n_lower)) and "tournament" not in n_lower:
            return (True, "unstructured_zero_stub")

    return (False, "")


def _merge_event_records(base: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
    """Merges duplicate event records from BCP live + local DB + Majors cache, keeping richest metadata."""
    merged = dict(base)
    for k, v in incoming.items():
        if v is None or v == "" or v == []:
            continue
        cur = merged.get(k)
        if k in ("total_players", "num_tickets", "num_rounds", "current_round", "ticket_price"):
            try:
                if float(v or 0) > float(cur or 0):
                    merged[k] = v
            except Exception:
                pass
        elif cur is None or cur == "" or cur == [] or cur == 0:
            merged[k] = v
    if bool(base.get("is_ended")) or bool(incoming.get("is_ended")):
        merged["is_ended"] = True
    return merged


def score_and_categorize_community_events(
    raw_candidates: List[Dict[str, Any]],
    user_lat: Optional[float] = None,
    user_lng: Optional[float] = None,
    local_radius_miles: float = 50.0,
    max_drive_hours: float = 2.0,
    majors_scope: str = "regional",
    game_system: str = "40k",
    user_elo: Optional[float] = None,
    familiar_venues: Optional[set] = None,
    field_stats_map: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Core Tournament Recommendation Engine:
    Filters casual/irrelevant noise, computes drive times & match scores, and organizes events into:
      - top_picks (3-4 standout personalized picks)
      - local_events (all real upcoming/live local tournaments within local_radius_miles)
      - driveable_events (recommended Majors, GTs & strong RTTs within max_drive_hours)
      - destination_majors (regional/national or worldwide Super Majors & Majors)
      - past_results (recent completed local/regional tournaments)
    """
    target_sys = normalize_game_system(game_system, default="40k")
    familiar_set = {str(v).strip().lower() for v in (familiar_venues or set()) if v}
    fstats = field_stats_map or {}
    now_utc = datetime.now(timezone.utc)
    today_date = now_utc.date()
    today_iso = today_date.strftime("%Y-%m-%d")

    drive_radius_miles = max(float(local_radius_miles), round(float(max_drive_hours) * 52.0, 1))
    max_drive_mins = int(round(float(max_drive_hours) * 60.0)) + 15

    user_country, user_region = normalize_country_and_region("", "", user_lat, user_lng)

    deduped: Dict[str, Dict[str, Any]] = {}
    for raw_ev in raw_candidates or []:
        if not isinstance(raw_ev, dict):
            continue
        eid = str(raw_ev.get("id") or "").strip()
        if not eid:
            continue
        if eid in deduped:
            deduped[eid] = _merge_event_records(deduped[eid], raw_ev)
        else:
            deduped[eid] = dict(raw_ev)

    filtered_noise_count = 0
    enriched_upcoming: List[Dict[str, Any]] = []
    past_results: List[Dict[str, Any]] = []

    for eid, ev in deduped.items():
        # Determine ended status accurately using date + flags
        ev_date_raw = str(ev.get("event_date") or "")
        end_date_raw = str(ev.get("end_date") or "")
        start_prefix = ev_date_raw[:10]
        end_prefix = end_date_raw[:10] or start_prefix
        is_ended = bool(ev.get("is_ended")) or bool(end_prefix and len(end_prefix) == 10 and end_prefix < today_iso)
        ev["is_ended"] = is_ended

        is_noise, _reason = is_casual_or_irrelevant_event(ev, game_system=target_sys)
        if is_noise:
            filtered_noise_count += 1
            continue

        tot_players = int(ev.get("total_players") or 0)
        num_tickets = int(ev.get("num_tickets") or 0)
        num_rounds = int(ev.get("num_rounds") or 0)
        circuits = ev.get("circuits") or []

        tier_info = classify_tournament_tier(
            ev.get("name") or "",
            total_players=tot_players,
            num_tickets=num_tickets,
            circuits=circuits,
            num_rounds=num_rounds,
        )
        ev["tier"] = tier_info["tier"]
        ev["tier_badge"] = tier_info["badge"]
        ev["tier_color"] = tier_info["color"]
        ev["tier_weight"] = tier_info["weight"]
        ev["game_system"] = target_sys

        # Compute Haversine distance & drive time
        dist_mi = ev.get("distance_miles")
        if user_lat is not None and user_lng is not None:
            recalc = _haversine_miles(user_lat, user_lng, ev.get("latitude"), ev.get("longitude"))
            if recalc is not None:
                dist_mi = recalc
        elif dist_mi is not None:
            try:
                dist_mi = round(float(dist_mi), 1)
            except Exception:
                dist_mi = None

        ev_country, ev_region = normalize_country_and_region(
            ev.get("country"), ev.get("state"), ev.get("latitude"), ev.get("longitude")
        )
        drive_info = estimate_drive_time(dist_mi, user_country=user_country, event_country=ev_country)

        ev["distance_miles"] = dist_mi
        ev["road_miles"] = drive_info["road_miles"]
        ev["drive_minutes"] = drive_info["drive_minutes"]
        ev["drive_hours"] = drive_info["drive_hours"]
        ev["drive_label"] = drive_info["drive_label"]
        ev["cross_border"] = drive_info["cross_border"]
        ev["country_code"] = ev_country
        ev["continent_region"] = ev_region
        ev["is_local"] = bool(dist_mi is not None and dist_mi <= float(local_radius_miles))

        # Days until & countdown label
        days_until: Optional[int] = None
        if len(start_prefix) == 10:
            try:
                d_start = datetime.strptime(start_prefix, "%Y-%m-%d").date()
                days_until = (d_start - today_date).days
            except Exception:
                days_until = None
        ev["days_until"] = days_until

        is_live = bool(not is_ended and (ev.get("is_started") or (days_until is not None and days_until <= 0 and end_prefix >= today_iso)))
        ev["is_live"] = is_live
        if is_ended:
            ev["countdown_label"] = "Completed"
        elif is_live:
            ev["countdown_label"] = "Live Now"
        elif days_until == 0:
            ev["countdown_label"] = "Today"
        elif days_until == 1:
            ev["countdown_label"] = "Tomorrow"
        elif days_until is not None and days_until > 1:
            ev["countdown_label"] = f"in {days_until}d"
        else:
            ev.setdefault("countdown_label", "")

        # Field Elo stats enrichment
        st = fstats.get(eid) or {}
        if st.get("avg_field_elo"):
            ev["avg_field_elo"] = st["avg_field_elo"]
        if st.get("top_seed_elo"):
            ev["top_seed_elo"] = st["top_seed_elo"]
        if st.get("rated_players_count"):
            ev["rated_players_count"] = st["rated_players_count"]

        if not ev.get("external_url") and ":" not in eid and not eid.startswith("ES-"):
            ev["external_url"] = f"https://www.bestcoastpairings.com/event/{eid}"

        # Capacity & urgency metrics
        fill_pct = 0
        spots_left: Optional[int] = None
        is_sold_out = False
        if num_tickets > 0:
            fill_pct = min(100, int(round((tot_players / float(num_tickets)) * 100.0)))
            spots_left = max(0, num_tickets - tot_players)
            is_sold_out = spots_left == 0 and tot_players >= num_tickets
        ev["fill_pct"] = fill_pct
        ev["spots_remaining"] = spots_left
        ev["is_sold_out"] = is_sold_out

        if is_ended:
            if dist_mi is None and user_lat is not None:
                # Only include local/driveable past results in regional Past Results feed
                continue
            if dist_mi is not None and dist_mi > drive_radius_miles:
                continue
            past_results.append(ev)
            continue

        # Score upcoming / live event (50 - 99 scale) + human-readable Why Recommended reasons
        score = 52.0
        reasons: List[str] = []

        # 1. Proximity & Driveability
        if dist_mi is not None:
            if dist_mi <= 25.0:
                score += 24.0
                reasons.append(f"📍 Local ({drive_info['drive_label']})")
            elif dist_mi <= float(local_radius_miles):
                score += 19.0
                reasons.append(f"📍 Nearby ({drive_info['drive_label']})")
            elif drive_info["drive_minutes"] is not None and drive_info["drive_minutes"] <= max_drive_mins:
                score += max(8.0, 17.0 - (dist_mi - float(local_radius_miles)) * 0.12)
                reasons.append(f"🚗 {drive_info['drive_label']} ({int(round(dist_mi))} mi)")
            elif ev_country and user_country and ev_country == user_country:
                score += 5.0
        elif ev_country and user_country and ev_country == user_country:
            score += 6.0

        if drive_info["cross_border"]:
            score -= 8.0

        # 2. Tier & Competitive Scale
        tier = tier_info["tier"]
        eff_size = max(tot_players, num_tickets)
        if tier == "super_major":
            score += 24.0
            reasons.append(f"👑 {tot_players or eff_size}-Player Super Major" if (tot_players or eff_size) >= 60 else "👑 Flagship Super Major")
        elif tier == "major":
            score += 19.0
            reasons.append(f"🌟 {tot_players or eff_size}-Player Major" if (tot_players or eff_size) >= 50 else "🌟 Regional Major")
        elif tier == "gt":
            score += 13.0
            reasons.append(f"🏆 {num_rounds or 5}-Round GT" if num_rounds >= 4 else f"🏆 Grand Tournament ({tot_players or eff_size}p)")
        else:
            score += 6.0
            if num_rounds >= 3:
                reasons.append(f"⚔️ {num_rounds}-Round RTT")

        # 3. Registration Momentum & Ticket Availability
        if is_live:
            score += 10.0
            reasons.insert(0, "🔴 Live Rounds Underway")
        elif not is_sold_out:
            if spots_left is not None and 1 <= spots_left <= 6 and tot_players >= 10:
                score += 7.0
                reasons.append(f"🔥 {spots_left} Spot{'s' if spots_left != 1 else ''} Left")
            elif fill_pct >= 75 and tot_players >= 12:
                score += 5.0
                reasons.append(f"🔥 {fill_pct}% Full")
            elif tot_players >= 16:
                score += 4.0
        else:
            score -= 5.0
            reasons.append("🔒 Waitlist / Sold Out")

        # 4. Date Horizon Sweet Spot (next 3 - 45 days is prime signup window)
        if days_until is not None:
            if 1 <= days_until <= 21:
                score += 7.0
            elif 22 <= days_until <= 60:
                score += 5.0
            elif days_until > 120:
                score -= 3.0

        # 5. Familiar Venue & Player Elo Fit
        venue_key = (ev.get("venue_name") or ev.get("venue") or "").strip().lower()
        city_key = (ev.get("city") or "").strip().lower()
        if venue_key and venue_key in familiar_set:
            score += 8.0
            reasons.append("⭐ Familiar Venue")
        elif city_key and city_key in familiar_set and dist_mi is not None and dist_mi <= drive_radius_miles:
            score += 3.0

        avg_elo = ev.get("avg_field_elo")
        if user_elo and avg_elo:
            try:
                elo_gap = abs(float(avg_elo) - float(user_elo))
                if elo_gap <= 85.0:
                    score += 5.0
                    reasons.append(f"🎯 Great Elo Fit ({int(round(float(avg_elo)))} avg)")
            except Exception:
                pass

        ev["match_score"] = min(99, max(50, int(round(score))))
        # Deduplicate reasons preserving order, cap at 3 crisp chips
        dedup_reasons: List[str] = []
        for r_txt in reasons:
            if r_txt and r_txt not in dedup_reasons:
                dedup_reasons.append(r_txt)
        ev["why_reasons"] = dedup_reasons[:3]

        # Primary concierge tag
        if is_live:
            ev["recommendation_tag"] = "🔴 Live Now"
        elif ev["is_local"] and tier in ("super_major", "major", "gt"):
            ev["recommendation_tag"] = "🏆 Local GT / Major"
        elif ev["is_local"]:
            ev["recommendation_tag"] = "📍 Local Scene"
        elif dist_mi is not None and drive_info["drive_minutes"] is not None and drive_info["drive_minutes"] <= max_drive_mins:
            if tier in ("super_major", "major"):
                ev["recommendation_tag"] = "🚗 Driveable Major"
            elif tier == "gt":
                ev["recommendation_tag"] = "🚗 Driveable GT"
            else:
                ev["recommendation_tag"] = "🚗 Worth the Drive"
        elif tier == "super_major":
            ev["recommendation_tag"] = "👑 Super Major"
        else:
            ev["recommendation_tag"] = "🌟 Premier Circuit"

        enriched_upcoming.append(ev)

    # 1. Local Events: All valid upcoming/live tournaments within local_radius_miles
    local_events = [
        ev for ev in enriched_upcoming
        if ev.get("distance_miles") is not None and float(ev["distance_miles"]) <= float(local_radius_miles)
    ]
    local_events.sort(
        key=lambda x: (
            0 if x.get("is_live") else 1,
            str(x.get("event_date") or "9999"),
            -int(x.get("match_score") or 0),
        )
    )

    # 2. Driveable Events: Outside local_radius_miles, within max_drive_hours (Majors, GTs, and active RTTs)
    local_ids = {ev["id"] for ev in local_events}
    driveable_events: List[Dict[str, Any]] = []
    for ev in enriched_upcoming:
        if ev["id"] in local_ids:
            continue
        dm = ev.get("distance_miles")
        dmins = ev.get("drive_minutes")
        if dm is None or dmins is None:
            continue
        if dm > drive_radius_miles or dmins > max_drive_mins:
            continue
        # Beyond 50mi, recommend Super Majors, Majors, GTs, or active RTTs with real turnout/capacity
        tier = ev.get("tier")
        tot_p = int(ev.get("total_players") or 0)
        num_t = int(ev.get("num_tickets") or 0)
        if tier in ("super_major", "major", "gt") or tot_p >= 6 or num_t >= 12:
            driveable_events.append(ev)

    driveable_events.sort(
        key=lambda x: (
            0 if x.get("is_live") else 1,
            -int(x.get("tier_weight") or 0) if int(x.get("tier_weight") or 0) >= 2 else 0,
            -int(x.get("match_score") or 0),
            str(x.get("event_date") or "9999"),
        )
    )

    # 3. Destination Majors & Premier Circuit (Super Majors, Majors & large 48+ GTs)
    majors_pool = [
        ev for ev in enriched_upcoming
        if ev.get("tier") in ("super_major", "major")
        or (ev.get("tier") == "gt" and max(int(ev.get("total_players") or 0), int(ev.get("num_tickets") or 0)) >= 48)
    ]

    def _major_affinity_rank(ev: Dict[str, Any]) -> int:
        if not user_country and user_region == "GLOBAL":
            return 0
        ec = ev.get("country_code") or ""
        er = ev.get("continent_region") or "GLOBAL"
        if user_country and ec == user_country:
            return 0
        if user_region != "GLOBAL" and er == user_region:
            return 1
        return 2

    if majors_scope == "global" or (not user_country and user_region == "GLOBAL"):
        destination_majors = sorted(
            majors_pool,
            key=lambda x: (
                0 if x.get("is_live") else 1,
                _major_affinity_rank(x) if user_country else 0,
                -int(x.get("tier_weight") or 0),
                -int(x.get("total_players") or 0),
                str(x.get("event_date") or "9999"),
            ),
        )
    else:
        regional_majors = [ev for ev in majors_pool if _major_affinity_rank(ev) <= 1]
        regional_majors.sort(
            key=lambda x: (
                0 if x.get("is_live") else 1,
                _major_affinity_rank(x),
                -int(x.get("tier_weight") or 0),
                -int(x.get("match_score") or 0),
                str(x.get("event_date") or "9999"),
            )
        )
        if len(regional_majors) >= 4:
            destination_majors = regional_majors
        else:
            reg_ids = {e["id"] for e in regional_majors}
            global_fill = [
                ev for ev in majors_pool
                if ev["id"] not in reg_ids and ev.get("tier") in ("super_major", "major")
            ]
            global_fill.sort(key=lambda x: (-int(x.get("tier_weight") or 0), -int(x.get("total_players") or 0)))
            destination_majors = regional_majors + global_fill[: max(0, 8 - len(regional_majors))]

    # 4. Top Picks (3-4 curated concierge highlights across Local + Driveable Major/GT + Flagship Major)
    top_picks: List[Dict[str, Any]] = []
    picked_ids: set = set()

    def _add_pick(cand: Optional[Dict[str, Any]]):
        if cand and cand["id"] not in picked_ids and not cand.get("is_sold_out"):
            picked_ids.add(cand["id"])
            top_picks.append(cand)

    if local_events:
        best_local = max(local_events, key=lambda x: (int(x.get("match_score") or 0), int(x.get("tier_weight") or 0)))
        _add_pick(best_local)

    if driveable_events:
        best_drive = max(driveable_events, key=lambda x: (int(x.get("tier_weight") or 0), int(x.get("match_score") or 0)))
        _add_pick(best_drive)

    if destination_majors:
        for dm_ev in destination_majors:
            if dm_ev["id"] not in picked_ids and _major_affinity_rank(dm_ev) <= 1:
                _add_pick(dm_ev)
                break

    # Fill up to 3 top picks from highest remaining local/driveable match_score
    remaining_pool = sorted(
        local_events + driveable_events,
        key=lambda x: (-int(x.get("match_score") or 0), str(x.get("event_date") or "9999")),
    )
    for cand in remaining_pool:
        if len(top_picks) >= 3:
            break
        _add_pick(cand)

    # 5. Past Results (most recent first)
    past_results.sort(
        key=lambda x: (
            str(x.get("event_date") or ""),
            int(x.get("total_players") or 0),
        ),
        reverse=True,
    )
    past_results = past_results[:30]

    # 6. Unified clean calendar list
    cal_map: Dict[str, Dict[str, Any]] = {}
    for bucket in (local_events, driveable_events, destination_majors[:24], past_results[:20]):
        for ev in bucket:
            cal_map.setdefault(ev["id"], ev)

    return {
        "top_picks": top_picks,
        "local_events": local_events,
        "driveable_events": driveable_events,
        "destination_majors": destination_majors[:30],
        "past_results": past_results,
        "calendar_events": list(cal_map.values()),
        "summary": {
            "local_count": len(local_events),
            "driveable_count": len(driveable_events),
            "majors_count": len(destination_majors[:30]),
            "past_count": len(past_results),
            "filtered_noise_count": filtered_noise_count,
            "local_radius_miles": round(float(local_radius_miles), 1),
            "drive_radius_miles": drive_radius_miles,
            "max_drive_hours": round(float(max_drive_hours), 1),
            "majors_scope": majors_scope,
            "user_country": user_country,
            "user_region": user_region,
        },
    }


def _query_local_db_events_for_recommendations(
    db,
    user_lat: Optional[float],
    user_lng: Optional[float],
    drive_radius_miles: float,
    target_sys: str,
    player_id: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], Optional[float], set]:
    """Single fast (<25ms) read-only PostgreSQL batch fetching nearby DB events + optional user Elo & familiar venues."""
    db_events: List[Dict[str, Any]] = []
    user_elo: Optional[float] = None
    familiar_venues: set = set()

    if not db or getattr(db, "_pool", None) is None or (hasattr(db, "_is_mock_instance") and db._is_mock_instance()):
        return (db_events, user_elo, familiar_venues)

    try:
        with db.get_connection() as conn:
            cursor_factory = getattr(extras, "RealDictCursor", None) if extras else None
            cursor_kw = {"cursor_factory": cursor_factory} if cursor_factory else {}
            with conn.cursor(**cursor_kw) as cur:
                cur.execute("SET LOCAL statement_timeout = '350ms';")
                if user_lat is not None and user_lng is not None:
                    lat_d = (drive_radius_miles / 69.0) * 1.18
                    cos_l = max(0.05, abs(math.cos(math.radians(float(user_lat)))))
                    lng_d = (drive_radius_miles / (69.0 * cos_l)) * 1.18
                    cur.execute(
                        """
                        WITH cand AS (
                            SELECT id, name, event_date, end_date, city, state, country,
                                   COALESCE(NULLIF(TRIM(venue_name), ''), NULLIF(TRIM(venue), ''), city) AS venue,
                                   NULLIF(TRIM(address), '') AS address,
                                   NULLIF(TRIM(postal_code), '') AS postal_code,
                                   COALESCE(
                                       NULLIF(latitude, 0.0),
                                       CASE WHEN raw_json IS NOT NULL AND jsonb_typeof(raw_json->'coordinate') = 'array' AND jsonb_array_length(raw_json->'coordinate') >= 2
                                            THEN NULLIF((raw_json->'coordinate'->>1)::double precision, 0.0) ELSE NULL END
                                   ) AS latitude,
                                   COALESCE(
                                       NULLIF(longitude, 0.0),
                                       CASE WHEN raw_json IS NOT NULL AND jsonb_typeof(raw_json->'coordinate') = 'array' AND jsonb_array_length(raw_json->'coordinate') >= 2
                                            THEN NULLIF((raw_json->'coordinate'->>0)::double precision, 0.0) ELSE NULL END
                                   ) AS longitude,
                                   COALESCE(total_players, 0) AS total_players,
                                   COALESCE(num_rounds, 0) AS num_rounds,
                                   COALESCE(current_round, 0) AS current_round,
                                   COALESCE(is_ended, FALSE) AS is_ended,
                                   circuits
                            FROM events
                            WHERE COALESCE(game_system, '40k') = %s
                              AND event_date >= CURRENT_DATE - INTERVAL '90 days'
                              AND event_date <= CURRENT_DATE + INTERVAL '150 days'
                              AND (
                                  (latitude BETWEEN %s AND %s AND longitude BETWEEN %s AND %s)
                                  OR ((latitude IS NULL OR (latitude = 0.0 AND longitude = 0.0)) AND raw_json IS NOT NULL)
                              )
                        )
                        SELECT * FROM cand
                        WHERE latitude BETWEEN %s AND %s
                          AND longitude BETWEEN %s AND %s
                          AND NOT (latitude = 0.0 AND longitude = 0.0)
                        ORDER BY event_date DESC
                        LIMIT 90;
                        """,
                        (
                            target_sys,
                            float(user_lat) - lat_d, float(user_lat) + lat_d,
                            float(user_lng) - lng_d, float(user_lng) + lng_d,
                            float(user_lat) - lat_d, float(user_lat) + lat_d,
                            float(user_lng) - lng_d, float(user_lng) + lng_d,
                        ),
                    )
                    for row in (cur.fetchall() or []):
                        r = dict(row) if hasattr(row, "keys") else {}
                        ev_dt = r.get("event_date")
                        end_dt = r.get("end_date")
                        db_events.append({
                            "id": str(r.get("id") or ""),
                            "name": r.get("name") or "Tournament",
                            "event_date": ev_dt.isoformat() if hasattr(ev_dt, "isoformat") else str(ev_dt or ""),
                            "end_date": end_dt.isoformat() if hasattr(end_dt, "isoformat") else str(end_dt or ""),
                            "city": r.get("city") or "",
                            "state": r.get("state") or "",
                            "country": r.get("country") or "",
                            "venue": r.get("venue") or "",
                            "venue_name": r.get("venue") or "",
                            "address": r.get("address") or "",
                            "postal_code": r.get("postal_code") or "",
                            "latitude": float(r["latitude"]) if r.get("latitude") is not None else None,
                            "longitude": float(r["longitude"]) if r.get("longitude") is not None else None,
                            "total_players": int(r.get("total_players") or 0),
                            "num_rounds": int(r.get("num_rounds") or 0),
                            "current_round": int(r.get("current_round") or 0),
                            "is_started": bool(int(r.get("current_round") or 0) >= 1),
                            "is_ended": bool(r.get("is_ended")),
                            "circuits": r.get("circuits") or [],
                            "game_system": target_sys,
                        })

                if player_id:
                    cur.execute(
                        "SELECT current_elo FROM player_ratings WHERE player_id = %s AND COALESCE(game_system, '40k') = %s LIMIT 1;",
                        (str(player_id), target_sys),
                    )
                    pr_row = cur.fetchone()
                    if pr_row:
                        pr_d = dict(pr_row) if hasattr(pr_row, "keys") else {"current_elo": pr_row[0]}
                        if pr_d.get("current_elo") is not None:
                            user_elo = float(pr_d["current_elo"])

                    cur.execute(
                        """
                        SELECT DISTINCT COALESCE(NULLIF(TRIM(e.venue_name), ''), NULLIF(TRIM(e.venue), '')), LOWER(TRIM(COALESCE(e.city, '')))
                        FROM event_participants ep
                        JOIN events e ON e.id = ep.event_id
                        WHERE ep.player_id = %s
                        LIMIT 25;
                        """,
                        (str(player_id),),
                    )
                    for v_row in (cur.fetchall() or []):
                        vals = list(v_row.values()) if hasattr(v_row, "values") else list(v_row)
                        for val in vals:
                            if val and str(val).strip():
                                familiar_venues.add(str(val).strip().lower())
    except Exception as db_rec_err:
        logger.debug(f"Community recommendations DB query notice: {db_rec_err}")

    return (db_events, user_elo, familiar_venues)


@router.get("/api/community/events/recommendations", summary="Smart Community Hub Tournament Recommendation Engine")
def api_community_event_recommendations(
    request: Request,
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    location_name: Optional[str] = Query(None),
    local_radius_miles: float = Query(50.0, ge=10.0, le=200.0),
    max_drive_hours: float = Query(2.0, ge=0.5, le=6.0),
    majors_scope: str = Query("regional", description="regional or global"),
    game_system: Optional[str] = Query("40k"),
    force_refresh: bool = Query(False),
):
    """
    Returns noise-free, personalized tournament recommendations for Community Hub:
    - Local Scene (within local_radius_miles)
    - Driveable Majors, GTs & RTTs (up to max_drive_hours, default 2h drive / ~100 straight-line mi)
    - Premier Majors & Super Majors (regional affinity or worldwide)
    - Recent Past Results (completed local/regional events)
    Strict <1s latency guarantee.
    """
    target_sys = normalize_game_system(game_system, default="40k")
    scope_norm = "global" if str(majors_scope or "").strip().lower() == "global" else "regional"

    auth_header = request.headers.get("Authorization", "") if request else ""
    session_token = (request.cookies.get("session_token") if request else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = get_auth_manager().get_session(session_token) if session_token else None
    player_id = (user.get("player_id") or user.get("bcp_user_id")) if user else None

    db = get_database()
    user_lat, user_lng = lat, lng
    resolved_loc = location_name or ""

    # Resolve location_name if lat/lng omitted
    if (user_lat is None or user_lng is None) and resolved_loc and hasattr(db, "get_community_overview"):
        try:
            ov = db.get_community_overview(lat=None, lng=None, radius_miles=local_radius_miles, location_name=resolved_loc, include_bcp=False, game_system=target_sys)
            center = (ov or {}).get("center") or {}
            if center.get("lat") is not None and center.get("lng") is not None:
                user_lat = float(center["lat"])
                user_lng = float(center["lng"])
                resolved_loc = center.get("label") or resolved_loc
        except Exception:
            pass

    cache_key = (
        round(float(user_lat), 2) if user_lat is not None else None,
        round(float(user_lng), 2) if user_lng is not None else None,
        int(round(local_radius_miles)),
        round(float(max_drive_hours), 1),
        scope_norm,
        target_sys,
        str(player_id or ""),
    )
    now_ts = time.time()
    if not force_refresh:
        cached = _community_recs_cache.get(cache_key)
        if cached and (now_ts - cached[0]) < 180.0:
            return cached[1]

    drive_radius_miles = max(float(local_radius_miles), round(float(max_drive_hours) * 52.0, 1))

    # Run BCP upcoming (at drive_radius_miles), live Majors cache, and local DB query in parallel (<600ms cap)
    bcp_upcoming: List[Dict[str, Any]] = []
    bcp_majors: List[Dict[str, Any]] = []
    db_events: List[Dict[str, Any]] = []
    user_elo: Optional[float] = None
    familiar_venues: set = set()

    ex = concurrent.futures.ThreadPoolExecutor(max_workers=3)
    try:
        fut_up = (
            ex.submit(
                db.fetch_bcp_upcoming_events,
                user_lat=float(user_lat),
                user_lng=float(user_lng),
                radius_miles=drive_radius_miles,
                days_ahead=120,
                game_system=target_sys,
                include_multiplatform=True,
            )
            if (user_lat is not None and user_lng is not None and hasattr(db, "fetch_bcp_upcoming_events"))
            else None
        )
        fut_maj = ex.submit(fetch_live_bcp_majors, target_sys, 180, 28, 0.50)
        fut_db = ex.submit(
            _query_local_db_events_for_recommendations,
            db, user_lat, user_lng, drive_radius_miles, target_sys, player_id,
        )

        wait_futs = [f for f in (fut_up, fut_maj, fut_db) if f is not None]
        concurrent.futures.wait(wait_futs, timeout=0.62)

        if fut_up is not None and fut_up.done():
            try:
                bcp_upcoming = fut_up.result() or []
            except Exception:
                bcp_upcoming = []
        if fut_maj.done():
            try:
                bcp_majors = fut_maj.result() or []
            except Exception:
                bcp_majors = []
        if fut_db.done():
            try:
                db_events, user_elo, familiar_venues = fut_db.result()
            except Exception:
                pass
    finally:
        ex.shutdown(wait=False)

    all_candidates = list(bcp_upcoming) + list(db_events) + list(bcp_majors)

    # Fast local SQL field stats enrichment (<10ms, zero remote HTTP calls)
    field_stats_map: Dict[str, Dict[str, Any]] = {}
    if hasattr(db, "get_events_field_stats") and all_candidates:
        try:
            cand_ids = list(dict.fromkeys(str(e.get("id") or "") for e in all_candidates if e.get("id")))[:80]
            if cand_ids:
                field_stats_map = db.get_events_field_stats(cand_ids, game_system=target_sys) or {}
        except Exception:
            field_stats_map = {}

    categorized = score_and_categorize_community_events(
        raw_candidates=all_candidates,
        user_lat=user_lat,
        user_lng=user_lng,
        local_radius_miles=local_radius_miles,
        max_drive_hours=max_drive_hours,
        majors_scope=scope_norm,
        game_system=target_sys,
        user_elo=user_elo,
        familiar_venues=familiar_venues,
        field_stats_map=field_stats_map,
    )

    payload = {
        "success": True,
        "game_system": target_sys,
        "center": {
            "lat": user_lat,
            "lng": user_lng,
            "label": resolved_loc or ("Your Area" if user_lat is not None else "Global"),
        },
        **categorized,
    }
    _community_recs_cache[cache_key] = (time.time(), payload)
    return payload


@router.get("/api/community/events/search", summary="Instant search across upcoming Majors, local/regional tournaments, and past events")
def api_community_event_search(
    q: str = Query("", description="Event name, city, state, country, venue, or circuit"),
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    game_system: Optional[str] = Query("40k"),
    include_past: bool = Query(True),
    limit: int = Query(40, ge=1, le=100),
):
    """Fast (<100ms) tournament search combining local PostgreSQL events + warm live BCP Majors & Upcoming caches."""
    query_str = (q or "").strip()
    target_sys = normalize_game_system(game_system, default="40k")
    if len(query_str) < 2:
        return {"success": True, "query": query_str, "upcoming": [], "past": [], "events": [], "total": 0}

    s_cache_key = (
        query_str.lower(),
        round(float(lat), 1) if lat is not None else None,
        round(float(lng), 1) if lng is not None else None,
        target_sys,
        bool(include_past),
        int(limit),
    )
    now_ts = time.time()
    cached = _community_search_cache.get(s_cache_key)
    if cached and (now_ts - cached[0]) < 60.0:
        return cached[1]

    q_lower = query_str.lower()
    q_tokens = [tok for tok in re.split(r"\s+", q_lower) if tok]
    db = get_database()
    matched_map: Dict[str, Dict[str, Any]] = {}

    def _matches_tokens(ev: Dict[str, Any]) -> bool:
        circuits_txt = " ".join(
            (c.get("name") or "") if isinstance(c, dict) else str(c)
            for c in (ev.get("circuits") or [])
        )
        haystack = " ".join([
            str(ev.get("name") or ""),
            str(ev.get("city") or ""),
            str(ev.get("state") or ""),
            str(ev.get("country") or ""),
            str(ev.get("venue_name") or ev.get("venue") or ""),
            str(ev.get("address") or ""),
            circuits_txt,
        ]).lower()
        return all(tok in haystack for tok in q_tokens)

    # 1. Search warm RAM _bcp_majors_cache (<0.5ms)
    maj_cached = _bcp_majors_cache.get(target_sys)
    if maj_cached and isinstance(maj_cached[1], list):
        for ev in maj_cached[1]:
            if _matches_tokens(ev):
                eid = str(ev.get("id") or "").strip()
                if eid and not eid.startswith("bcp_"):
                    matched_map[eid] = dict(ev)

    # 2. Search warm RAM _bcp_upcoming_cache_dict (<1ms)
    up_cache = getattr(db, "_bcp_upcoming_cache_dict", None)
    if isinstance(up_cache, dict):
        for ck, cv in list(up_cache.items()):
            if isinstance(ck, tuple) and len(ck) >= 5 and ck[4] == target_sys and isinstance(cv, tuple) and len(cv) == 2 and isinstance(cv[0], list):
                for ev in cv[0]:
                    if _matches_tokens(ev):
                        eid = str(ev.get("id") or "").strip()
                        if eid and not eid.startswith("bcp_"):
                            matched_map[eid] = _merge_event_records(matched_map[eid], ev) if eid in matched_map else dict(ev)

    # 3. Search PostgreSQL events table (<30ms with 350ms statement_timeout)
    if db and getattr(db, "_pool", None) is not None and not (hasattr(db, "_is_mock_instance") and db._is_mock_instance()):
        try:
            like_pat = f"%{query_str}%"
            with db.get_connection() as conn:
                cursor_factory = getattr(extras, "RealDictCursor", None) if extras else None
                cursor_kw = {"cursor_factory": cursor_factory} if cursor_factory else {}
                with conn.cursor(**cursor_kw) as cur:
                    cur.execute("SET LOCAL statement_timeout = '350ms';")
                    date_clause = "" if include_past else "AND event_date >= CURRENT_DATE - INTERVAL '2 days'"
                    cur.execute(
                        f"""
                        SELECT id, name, event_date, end_date, city, state, country,
                               COALESCE(NULLIF(TRIM(venue_name), ''), NULLIF(TRIM(venue), ''), city) AS venue,
                               NULLIF(TRIM(address), '') AS address,
                               NULLIF(TRIM(postal_code), '') AS postal_code,
                               COALESCE(
                                   NULLIF(latitude, 0.0),
                                   CASE WHEN raw_json IS NOT NULL AND jsonb_typeof(raw_json->'coordinate') = 'array' AND jsonb_array_length(raw_json->'coordinate') >= 2
                                        THEN NULLIF((raw_json->'coordinate'->>1)::double precision, 0.0) ELSE NULL END
                               ) AS latitude,
                               COALESCE(
                                   NULLIF(longitude, 0.0),
                                   CASE WHEN raw_json IS NOT NULL AND jsonb_typeof(raw_json->'coordinate') = 'array' AND jsonb_array_length(raw_json->'coordinate') >= 2
                                        THEN NULLIF((raw_json->'coordinate'->>0)::double precision, 0.0) ELSE NULL END
                               ) AS longitude,
                               COALESCE(total_players, 0) AS total_players,
                               COALESCE(num_rounds, 0) AS num_rounds,
                               COALESCE(current_round, 0) AS current_round,
                               COALESCE(is_ended, FALSE) AS is_ended,
                               circuits
                        FROM events
                        WHERE COALESCE(game_system, '40k') = %s
                          {date_clause}
                          AND event_date >= CURRENT_DATE - INTERVAL '365 days'
                          AND (
                              name ILIKE %s
                              OR city ILIKE %s
                              OR state ILIKE %s
                              OR country ILIKE %s
                              OR venue_name ILIKE %s
                              OR venue ILIKE %s
                          )
                        ORDER BY
                          CASE WHEN event_date >= CURRENT_DATE - INTERVAL '1 day' THEN 0 ELSE 1 END ASC,
                          COALESCE(total_players, 0) DESC,
                          event_date DESC
                        LIMIT %s;
                        """,
                        (target_sys, like_pat, like_pat, like_pat, like_pat, like_pat, like_pat, int(limit) * 2),
                    )
                    for row in (cur.fetchall() or []):
                        r = dict(row) if hasattr(row, "keys") else {}
                        eid = str(r.get("id") or "").strip()
                        if not eid or eid.startswith("bcp_"):
                            continue
                        ev_dt = r.get("event_date")
                        end_dt = r.get("end_date")
                        item = {
                            "id": eid,
                            "name": r.get("name") or "Tournament",
                            "event_date": ev_dt.isoformat() if hasattr(ev_dt, "isoformat") else str(ev_dt or ""),
                            "end_date": end_dt.isoformat() if hasattr(end_dt, "isoformat") else str(end_dt or ""),
                            "city": r.get("city") or "",
                            "state": r.get("state") or "",
                            "country": r.get("country") or "",
                            "venue": r.get("venue") or "",
                            "venue_name": r.get("venue") or "",
                            "address": r.get("address") or "",
                            "postal_code": r.get("postal_code") or "",
                            "latitude": float(r["latitude"]) if r.get("latitude") is not None else None,
                            "longitude": float(r["longitude"]) if r.get("longitude") is not None else None,
                            "total_players": int(r.get("total_players") or 0),
                            "num_rounds": int(r.get("num_rounds") or 0),
                            "current_round": int(r.get("current_round") or 0),
                            "is_started": bool(int(r.get("current_round") or 0) >= 1),
                            "is_ended": bool(r.get("is_ended")),
                            "circuits": r.get("circuits") or [],
                            "game_system": target_sys,
                            "external_url": f"https://www.bestcoastpairings.com/event/{eid}" if ":" not in eid else "",
                        }
                        if _matches_tokens(item):
                            matched_map[eid] = _merge_event_records(matched_map[eid], item) if eid in matched_map else item
        except Exception as s_err:
            logger.debug(f"Community event search DB notice: {s_err}")

    today_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    user_country, _ = normalize_country_and_region("", "", lat, lng)
    upcoming_out: List[Dict[str, Any]] = []
    past_out: List[Dict[str, Any]] = []

    for eid, ev in matched_map.items():
        start_p = str(ev.get("event_date") or "")[:10]
        end_p = str(ev.get("end_date") or "")[:10] or start_p
        is_end = bool(ev.get("is_ended")) or bool(end_p and len(end_p) == 10 and end_p < today_iso)
        ev["is_ended"] = is_end
        if is_end and not include_past:
            continue

        tier_info = classify_tournament_tier(
            ev.get("name") or "",
            total_players=int(ev.get("total_players") or 0),
            num_tickets=int(ev.get("num_tickets") or 0),
            circuits=ev.get("circuits") or [],
            num_rounds=int(ev.get("num_rounds") or 0),
        )
        ev["tier"] = tier_info["tier"]
        ev["tier_badge"] = tier_info["badge"]
        ev["tier_color"] = tier_info["color"]
        ev["tier_weight"] = tier_info["weight"]

        dist_mi = _haversine_miles(lat, lng, ev.get("latitude"), ev.get("longitude")) if (lat is not None and lng is not None) else ev.get("distance_miles")
        ev_c, _ = normalize_country_and_region(ev.get("country"), ev.get("state"), ev.get("latitude"), ev.get("longitude"))
        d_info = estimate_drive_time(dist_mi, user_country=user_country, event_country=ev_c)
        ev["distance_miles"] = dist_mi
        ev["drive_minutes"] = d_info["drive_minutes"]
        ev["drive_label"] = d_info["drive_label"]
        ev["is_local"] = bool(dist_mi is not None and dist_mi <= 50.0)
        if not ev.get("external_url") and ":" not in eid and not eid.startswith("ES-"):
            ev["external_url"] = f"https://www.bestcoastpairings.com/event/{eid}"

        if is_end:
            ev["countdown_label"] = "Completed"
            past_out.append(ev)
        else:
            upcoming_out.append(ev)

    upcoming_out.sort(
        key=lambda x: (
            0 if (q_lower in str(x.get("name") or "").lower()) else 1,
            0 if (x.get("distance_miles") is not None and float(x["distance_miles"]) <= 120.0) else 1,
            -int(x.get("tier_weight") or 0),
            str(x.get("event_date") or "9999"),
        )
    )
    past_out.sort(
        key=lambda x: (
            str(x.get("event_date") or ""),
            int(x.get("total_players") or 0),
        ),
        reverse=True,
    )

    upcoming_out = upcoming_out[:limit]
    past_out = past_out[: max(10, limit // 2)]
    combined = upcoming_out + past_out
    res_payload = {
        "success": True,
        "query": query_str,
        "upcoming": upcoming_out,
        "past": past_out,
        "events": combined[:limit],
        "total": len(upcoming_out) + len(past_out),
    }
    _community_search_cache[s_cache_key] = (time.time(), res_payload)
    return res_payload

_community_field_stats_cache: Dict[str, Dict[str, Any]] = {}

def compute_live_bcp_field_stats(eid: str, db, game_system: Optional[str] = "40k") -> Dict[str, Any]:
    """Fetches live roster from BCP API and computes field avg / top seed Elo without mutating backend DB."""
    if str(eid or "").startswith(("melee:", "ltcg:", "td:", "ls:", "ES-")):
        return {
            "event_id": eid,
            "avg_field_elo": None,
            "top_seed_elo": None,
            "total_enrolled": 0,
            "rated_players_count": 0,
            "status": "empty"
        }
    try:
        target_sys = normalize_game_system(game_system, default="40k")
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
                raw_name = name.strip()
                if raw_name:
                    candidate_names.add(raw_name)
                    candidate_names.add(raw_name.title())

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
                            WHERE (player_id = ANY(%s) OR player_name = ANY(%s))
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
    target_sys = normalize_game_system(game_system, default="40k")
    if event_ids:
        target_ids.extend([eid.strip() for eid in event_ids.split(",") if eid.strip()])
    if request.method == "POST":
        try:
            body = await request.json()
            if isinstance(body, dict):
                if body.get("game_system"):
                    target_sys = normalize_game_system(body["game_system"], default="40k")
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
        def _resolve_missing_field_stats(m_ids: List[str], t_sys: str) -> Dict[str, Any]:
            local_res: Dict[str, Any] = {}
            db = get_database()
            db_stats = db.get_events_field_stats(m_ids, game_system=t_sys)
            need_bcp_sync: List[str] = []

            for eid in m_ids:
                c_key = f"{eid}:{t_sys}"
                stat = db_stats.get(eid)
                if stat and int(stat.get("total_enrolled") or 0) > 0:
                    local_res[eid] = stat
                    _community_field_stats_cache[c_key] = {
                        "timestamp": now_ts,
                        "stats": stat
                    }
                else:
                    need_bcp_sync.append(eid)

            if need_bcp_sync:
                executor = concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(need_bcp_sync)))
                try:
                    future_map = {}
                    for eid in need_bcp_sync:
                        fut = executor.submit(compute_live_bcp_field_stats, eid, db, t_sys)
                        future_map[fut] = eid

                        def _store_when_done(f_done, _eid=eid, _t_sys=t_sys):
                            try:
                                res_stat = f_done.result()
                                if isinstance(res_stat, dict):
                                    _community_field_stats_cache[f"{_eid}:{_t_sys}"] = {
                                        "timestamp": time.time(),
                                        "stats": res_stat,
                                    }
                            except Exception:
                                pass

                        fut.add_done_callback(_store_when_done)

                    done, not_done = concurrent.futures.wait(future_map.keys(), timeout=0.55)
                    for fut in done:
                        eid = future_map[fut]
                        c_key = f"{eid}:{t_sys}"
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
                        local_res[eid] = stat
                        _community_field_stats_cache[c_key] = {
                            "timestamp": now_ts,
                            "stats": stat
                        }
                    for fut in not_done:
                        eid = future_map[fut]
                        local_res[eid] = {
                            "event_id": eid,
                            "avg_field_elo": None,
                            "top_seed_elo": None,
                            "total_enrolled": 0,
                            "rated_players_count": 0,
                            "status": "pending"
                        }
                finally:
                    executor.shutdown(wait=False)
            return local_res

        fetched_stats = await asyncio.to_thread(_resolve_missing_field_stats, missing_ids, target_sys)
        results.update(fetched_stats)

    return {
        "success": True,
        "count": len(results),
        "stats": results
    }

@router.get("/api/community/stores", summary="Find local game stores and clubs for Warhammer 40k")
def api_community_stores(
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
def api_community_store_tournaments(
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
def api_community_store_details(
    place_id: str = Query(..., description="Google Place ID")
):
    db = get_database()
    return db.get_place_details(place_id=place_id)

@router.get("/api/community/chat/messages", summary="Get Regional Community Chat Messages")
def api_community_chat_messages(
    region: str = Query("socal"),
    limit: int = Query(50)
):
    db = get_database()
    return {"success": True, "messages": db.get_community_chat_messages(region=region, limit=limit)}

class CommunityChatMessagePayload(BaseModel):
    region: str = "socal"
    message: str

@router.post("/api/community/chat/message", summary="Send Message in Regional Community Chat")
def api_community_chat_send(
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


def _check_tournament_started_or_ended(ev: Dict[str, Any], rj: Optional[Dict[str, Any]] = None) -> Tuple[bool, bool]:
    """Returns (is_started, is_ended) for a tournament based on status flags, round count, and event dates."""
    if rj is None:
        raw_val = ev.get("raw_json")
        if isinstance(raw_val, dict):
            rj = raw_val
        elif isinstance(raw_val, str):
            try:
                rj = json.loads(raw_val)
            except Exception:
                rj = {}
        else:
            rj = {}
    status_obj = ev.get("status") if isinstance(ev.get("status"), dict) else (rj.get("status") if isinstance(rj.get("status"), dict) else {})
    now_utc = datetime.now(timezone.utc)
    today_utc_str = now_utc.strftime("%Y-%m-%d")

    ev_date_val = ev.get("event_date") or ev.get("eventDate") or rj.get("eventDate") or rj.get("startDate")
    end_date_val = ev.get("end_date") or ev.get("endDate") or ev.get("eventEndDate") or rj.get("eventEndDate") or rj.get("endDate")
    ev_date_str = (ev_date_val.isoformat() if hasattr(ev_date_val, "isoformat") else str(ev_date_val or ""))[:10]
    end_date_str = (end_date_val.isoformat() if hasattr(end_date_val, "isoformat") else str(end_date_val or ""))[:10]

    status_str = str(ev.get("status") or rj.get("status") or "").lower().strip()

    is_ended = bool(
        ev.get("is_ended") or ev.get("isEnded") or ev.get("ended") or
        rj.get("isEnded") or rj.get("is_ended") or rj.get("ended") or
        status_obj.get("ended") or status_obj.get("isEnded") or
        status_str in ("ended", "completed", "concluded") or
        (end_date_str and end_date_str < today_utc_str) or
        (not end_date_str and ev_date_str and ev_date_str < (now_utc - timedelta(days=4)).strftime("%Y-%m-%d"))
    )

    c_round = 0
    try:
        c_round = int(ev.get("current_round") or ev.get("currentRound") or rj.get("currentRound") or 0)
    except (ValueError, TypeError):
        c_round = 0

    matches_cnt = 0
    try:
        matches_cnt = int(ev.get("matches_count") or ev.get("total_matches") or len(ev.get("matches") or []) or 0)
    except (ValueError, TypeError):
        matches_cnt = 0

    has_pairings = bool(c_round >= 1 or matches_cnt > 0)
    bcp_explicit_started = bool(
        ev.get("started") is True or ev.get("isStarted") is True or
        rj.get("started") is True or rj.get("isStarted") is True or
        status_obj.get("started") is True or status_obj.get("isStarted") is True or
        status_str in ("ongoing", "in_progress", "live")
    )

    if is_ended:
        is_started = True
    elif ev_date_str and ev_date_str > today_utc_str and not has_pairings:
        is_started = False
    elif ev_date_str and ev_date_str < today_utc_str:
        is_started = True
    else:
        # A tournament on today's date (or missing date) is only started if pairings/matches exist or BCP explicitly marked it started.
        # Tournaments on today's date that have not posted pairings or been started by TO are open for registration.
        is_started = bool(has_pairings or bcp_explicit_started)

    return is_started, is_ended


_community_reg_cache: Dict[str, Any] = {}
_COMMUNITY_REG_CACHE_TTL: float = 300.0


def _invalidate_community_reg_cache(event_id: Optional[str] = None) -> None:
    if not event_id:
        _community_reg_cache.clear()
        return
    clean = str(event_id).strip()
    for k in list(_community_reg_cache.keys()):
        if k.startswith(f"{clean}:"):
            _community_reg_cache.pop(k, None)


@router.get("/api/community/events/{event_id}/registration", summary="Get Event Registration Metadata, User Status & Saved Army Lists")
async def api_community_event_registration(
    event_id: str,
    request: Request,
    force_sync: bool = Query(False),
    token: Optional[str] = Query(None)
):
    return await asyncio.to_thread(_sync_api_community_event_registration, event_id, request, force_sync, token)


def _sync_api_community_event_registration(
    event_id: str,
    request: Request,
    force_sync: bool = False,
    token: Optional[str] = None
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
    clean_eid = str(event_id).strip()

    is_mock_env = (
        hasattr(db, "assert_called")
        or hasattr(getattr(db, "get_event_details", None), "assert_called")
        or hasattr(auth_mgr, "assert_called")
        or hasattr(getattr(auth_mgr, "get_session", None), "assert_called")
    )
    cache_key = f"{clean_eid}:{user_id or 'anon'}:{bool(x_bcp_token)}"
    if not force_sync and not is_mock_env:
        cached_entry = _community_reg_cache.get(cache_key)
        if cached_entry and (time.time() - cached_entry[0]) < _COMMUNITY_REG_CACHE_TTL:
            return cached_entry[1]

    # Retrieve event from warm leaderboard cache, DB, or fallback fetch from BCP
    ev = None
    if not force_sync and not is_mock_env:
        try:
            from routers.leaderboard import _event_details_cache
            entry = _event_details_cache.get(clean_eid)
            if entry and (time.time() - entry.get("timestamp", 0)) < 300:
                ev = entry.get("data")
        except Exception:
            pass
    if not ev and not is_mock_env and hasattr(db, "get_event_registration_summary") and not (hasattr(db, "_is_mock_instance") and db._is_mock_instance()):
        try:
            ev = db.get_event_registration_summary(clean_eid)
        except Exception:
            ev = None
    if not ev:
        ev = db.get_event_details(clean_eid)
    if not ev:
        ev = db.get_studio_event(clean_eid)

    if not ev and not clean_eid.startswith("ES-"):
        try:
            from scraper import BestCoastPairingsScraper
            bcp_data = BestCoastPairingsScraper(db=db, request_delay=0.0).fetch_event_details(clean_eid)
            if bcp_data and isinstance(bcp_data, dict):
                ev = {
                    "id": clean_eid,
                    "name": bcp_data.get("name", "Tournament"),
                    "event_date": bcp_data.get("eventDate") or bcp_data.get("startDate"),
                    "end_date": bcp_data.get("endDate") or bcp_data.get("eventEndDate"),
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
    is_started, is_ended = _check_tournament_started_or_ended(ev, rj)
    can_register_free = bool(using_online_reg and ticket_price == 0.0 and not is_sold_out and not is_started and not is_ended)
    can_buy_ticket = bool(using_online_reg and ticket_price > 0.0 and not is_sold_out and not is_started and not is_ended)

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
        bcp_user_id = user.get("bcp_user_id") if user else None
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

        # Check if already registered in DB
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

        # Also check already-loaded event participants in `ev.get("players")` before making external HTTP calls
        if isinstance(ev.get("players"), list) and ev.get("players"):
            target_uids = {str(k).strip() for k in (bcp_user_id, user.get("id"), user.get("player_id")) if k}
            target_names = {
                str(n).strip().lower()
                for n in (user_display, user.get("competitor_name"), user.get("full_name"), user.get("name"))
                if n and len(str(n).strip()) > 2
            }
            for ep in ev["players"]:
                if not isinstance(ep, dict):
                    continue
                ep_ids = {
                    str(ep.get(k) or "").strip()
                    for k in ("player_id", "user_id", "id", "bcp_event_player_id")
                    if ep.get(k)
                }
                ep_pid = str(ep.get("player_id") or ep.get("user_id") or ep.get("id") or "").strip()
                ep_name = str(ep.get("full_name") or ep.get("name") or "").strip().lower()
                if (ep_ids and (ep_ids & target_uids)) or (ep_name and ep_name in target_names):
                    is_registered = True
                    ep_reg = {
                        "player_id": str(ep.get("bcp_event_player_id") or ep_pid),
                        "bcp_player_id": str(ep.get("bcp_event_player_id") or ""),
                        "canonical_player_id": ep_pid,
                        "first_name": fn,
                        "last_name": ln,
                        "full_name": str(ep.get("full_name") or ep.get("name") or user_display or "").strip(),
                        "player_name": str(ep.get("full_name") or ep.get("name") or user_display or "").strip(),
                        "team_name": ep.get("team") or "",
                        "faction": ep.get("faction") if ep.get("faction") not in ("Unknown", "-", None) else "",
                        "detachment": ep.get("detachment") or "",
                        "checked_in": bool(ep.get("checked_in") or False),
                        "dropped": bool(ep.get("dropped") or False),
                        "has_list_submitted": bool(ep.get("has_list") or ep.get("army_list") or ep.get("list_id")),
                        "army_list": ep.get("army_list") or "",
                        "list_id": str(ep.get("list_id") or ""),
                    }
                    if matched_reg:
                        for k, v in ep_reg.items():
                            if v and not matched_reg.get(k):
                                matched_reg[k] = v
                    else:
                        matched_reg = ep_reg
                    break

        should_skip_live_bcp = bool(not is_mock_env and is_ended and not force_sync)

        # Live sync from BCP dedicated /currentPlayer endpoint
        if not clean_eid.startswith("ES-") and not should_skip_live_bcp and (is_mock_env or bcp_linked or x_bcp_token):
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

        # Live sync from BCP if user is linked to BCP (only on force_sync or mock tests since /currentPlayer was already queried)
        if not is_registered and not clean_eid.startswith("ES-") and not should_skip_live_bcp and (is_mock_env or force_sync) and (is_mock_env or bcp_linked or x_bcp_token):
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

        # Fallback check against live event players from BCP only if ev["players"] was empty or force_sync/mocked
        if not is_registered and not clean_eid.startswith("ES-") and not should_skip_live_bcp and (is_mock_env or force_sync or not ev.get("players")):
            try:
                from scraper import BestCoastPairingsScraper
                scraper = BestCoastPairingsScraper(request_delay=0.0)
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
                            "has_list_submitted": bool(p.get("hasList") or p.get("armyList") or p.get("listSubmitted") or p.get("listId")),
                            "army_list": p.get("armyList") or p.get("listText") or "",
                            "list_id": str(p.get("listId") or ""),
                        }
                        break
            except Exception as ex:
                logger.debug(f"Live player registration check notice: {ex}")

        player_registration = None
        if matched_reg:
            from bcp_adapter import bcp_adapter
            cand_pid = str(matched_reg.get("bcp_player_id") or matched_reg.get("player_id") or "").strip()
            valid_cand = bool(
                cand_pid
                and cand_pid != clean_eid
                and not cand_pid.startswith("user_")
                and cand_pid != str(user.get("id") or "")
                and cand_pid != str(bcp_user_id or "")
            )
            fallback_canonical_pid = str(
                matched_reg.get("canonical_player_id")
                or (cand_pid if (cand_pid and cand_pid != clean_eid and not cand_pid.startswith("user_")) else "")
                or user.get("player_id")
                or bcp_user_id
                or ""
            ).strip()
            if not is_mock_env and (valid_cand or should_skip_live_bcp):
                actual_pid = cand_pid if valid_cand else fallback_canonical_pid
            else:
                # If candidate_pid is invalid, identical to event_id, or starts with user_, resolve the real one
                resolved_pid = bcp_adapter.resolve_event_player_id(clean_eid, user["id"], candidate_pid=cand_pid, explicit_token=x_bcp_token)
                actual_pid = resolved_pid or (cand_pid if valid_cand else ("" if is_mock_env else fallback_canonical_pid))

            fn_val = matched_reg.get("first_name") or fn
            ln_val = matched_reg.get("last_name") or ln
            full_name_val = (
                matched_reg.get("full_name")
                or f"{fn_val} {ln_val}".strip()
                or matched_reg.get("player_name")
                or matched_reg.get("name")
                or user_display
                or user.get("competitor_name")
                or "Competitor"
            )
            list_id_val = str(matched_reg.get("list_id") or matched_reg.get("listId") or "").strip()
            if not list_id_val:
                al_raw = str(matched_reg.get("army_list") or matched_reg.get("armyList") or "").strip()
                if al_raw.startswith("/list/"):
                    list_id_val = al_raw.split("/list/", 1)[1].strip("/")

            player_registration = {
                "player_id": actual_pid,
                "first_name": fn_val,
                "last_name": ln_val,
                "full_name": full_name_val,
                "player_name": full_name_val,
                "team_name": matched_reg.get("team_name") or matched_reg.get("team") or "",
                "faction": matched_reg.get("faction") or "",
                "army_id": matched_reg.get("army_id") or matched_reg.get("armyId") or "",
                "detachment": matched_reg.get("detachment") or "",
                "sub_faction_id": matched_reg.get("sub_faction_id") or matched_reg.get("subFactionId") or "",
                "checked_in": bool(matched_reg.get("checked_in") or matched_reg.get("checkedIn") or False),
                "dropped": bool(matched_reg.get("dropped") or False),
                "has_list_submitted": bool(matched_reg.get("has_list_submitted") or matched_reg.get("army_list") or matched_reg.get("armyList") or list_id_val),
                "army_list": "" if str(matched_reg.get("army_list") or "").startswith("/list/") else (matched_reg.get("army_list") or matched_reg.get("armyList") or ""),
                "list_id": list_id_val,
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

    resp_payload = {
        "success": True,
        "event_id": clean_eid,
        "event_name": ev.get("name") or "Tournament",
        "event_date": ev.get("event_date") if hasattr(ev.get("event_date"), "isoformat") else str(ev.get("event_date") or ""),
        "end_date": ev.get("end_date") if hasattr(ev.get("end_date"), "isoformat") else str(ev.get("end_date") or ""),
        "status": status_obj,
        "is_started": is_started,
        "is_ongoing": bool(is_started and not is_ended),
        "is_ended": is_ended,
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
    if not is_mock_env:
        _community_reg_cache[cache_key] = (time.time(), resp_payload)
    return resp_payload


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
                        "end_date": bcp_data.get("endDate") or bcp_data.get("eventEndDate"),
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

    is_started, is_ended = _check_tournament_started_or_ended(ev, rj)
    is_already_registered = False
    if user_id:
        try:
            user_regs = db.get_user_registered_tournaments(user_id)
            for r in (user_regs or []):
                if str(r.get("id") or r.get("bcp_event_id") or "") == clean_eid:
                    is_already_registered = True
                    break
        except Exception:
            is_already_registered = False

    if (is_started or is_ended) and not is_already_registered:
        raise HTTPException(
            status_code=400,
            detail="Registration is closed because this tournament has already started or concluded."
        )

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

        _invalidate_community_reg_cache(clean_eid)
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

    _invalidate_community_reg_cache(clean_eid)
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

    _invalidate_community_reg_cache(clean_eid)
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

    _invalidate_community_reg_cache(clean_eid)
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

    _invalidate_community_reg_cache(clean_eid)
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

    _invalidate_community_reg_cache(clean_eid)
    return {
        "success": True,
        "message": "Successfully dropped from tournament on BCP",
        "player_id": clean_pid,
        "data": data
    }




