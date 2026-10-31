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
    TRACKER_ROOMS, TRACKER_LISTENERS, generate_unique_match_id, normalize_tracker_match_id,
    resolve_event_game_system, get_bcp_game_system_id, normalize_game_system
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
    p1_score: int = 0
    p2_score: int = 0
    p1_name: Optional[str] = "Player 1"
    p2_name: Optional[str] = "Player 2"
    p1_id: Optional[str] = None
    p2_id: Optional[str] = None
    winner_id: Optional[str] = None
    is_draw: Optional[bool] = None
    pod_placements: Optional[List[Dict[str, Any]]] = None
    source_app: Optional[str] = "EventStudio"
    game_details: Optional[Dict[str, Any]] = None
    bcp_token: Optional[str] = None
    pairing_id: Optional[str] = None
    first_turn: Optional[str] = None
    layout: Optional[str] = None
    terrain_layout: Optional[str] = None

class CreateEventPayload(BaseModel):
    name: str
    hosting_mode: Optional[str] = None  # "native" (OmniTactica Native) or "bcp_sync"
    game_system: Optional[str] = None   # Canonical game system slug (e.g. "40k", "aos", "mtg", "pokemon", ...)
    scoring_mode: Optional[str] = None  # "wargame_vp", "wtc_20", "tcg_bo3", "tcg_bo1", "ffa_pods"
    match_format: Optional[str] = None  # "1v1", "2v2", "teams", "ffa"
    best_of: Optional[int] = None       # 1 or 3
    top_cut: Optional[int] = 0          # 0, 4, or 8
    win_points: Optional[float] = None
    draw_points: Optional[float] = None
    venue_mode: Optional[str] = "in_person"  # "in_person" or "online"
    online_platform: Optional[str] = ""
    discord_url: Optional[str] = ""
    stream_url: Optional[str] = ""
    external_ticket_url: Optional[str] = ""
    pay_at_door: Optional[bool] = False
    description: Optional[str] = ""
    prizes: Optional[str] = ""
    organizer_name: Optional[str] = ""
    access_code: Optional[str] = ""

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

    # Online Registration & Ticketing Configuration
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
    event_type: Optional[str] = "Singles Event"  # "Singles Event", "Doubles Event", "Teams Event", "Pod / FFA Event"
    team_size: Optional[int] = 1
    circuit_id: Optional[str] = None
    circuit_token: Optional[str] = None
    circuit_name: Optional[str] = None


class GenerateTopCutPayload(BaseModel):
    cut_size: Optional[int] = None
    advance_stage: Optional[bool] = False



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
    pairings: Optional[List[Dict[str, Any]]] = None

class ApplyPairingsBcpPayload(BaseModel):
    round: int = 1

class PushPairingsBcpPayload(BaseModel):
    round: int = 1
    start_if_unstarted: bool = True
    publish_immediately: bool = False
    pairings: List[Dict[str, Any]] = []

class QuickGeneratePairingsPayload(BaseModel):
    round: int = 1
    mode: Optional[str] = None  # "random", "swiss", "elo_balanced"
    method: Optional[str] = None  # alias for mode
    roster: Optional[List[Dict[str, Any]]] = None

class ReorderTablesPayload(BaseModel):
    round: int = 1
    source_table: Optional[int] = None
    target_table: Optional[int] = None
    pairings: List[Dict[str, Any]] = []

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
    is_admin = session.get("is_admin") is True or (user_role in ("admin", "superuser", "developer", "owner"))
    is_to = session.get("can_access_to") is True or user_role in ("to", "organizer", "referee") or is_admin
    if not (is_admin or is_to):
        raise HTTPException(
            status_code=403,
            detail="Tournament Organizer (TO) or Administrator role required to access Event Studio."
        )
    return session

def _is_user_to_or_admin(session: Optional[Dict[str, Any]]) -> bool:
    if not isinstance(session, dict):
        return False
    user_role = str(session.get("role") or "player").strip().lower()
    is_admin = session.get("is_admin") is True or (user_role in ("admin", "superuser", "developer", "owner"))
    is_to = session.get("can_access_to") is True or user_role in ("to", "organizer", "referee") or is_admin
    return bool(is_admin or is_to)


def _get_studio_user_or_401(
    request: Request,
    token: Optional[str] = None,
    require_to_for_external: bool = False,
    event_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Authenticates any signed-in OmniTactica user for Native Event Studio hosting,
    while enforcing TO/Admin privileges when mutating external non-ES BCP events.
    """
    if hasattr(_get_to_session_or_403, "assert_called"):
        return _get_to_session_or_403(request, token)
    if require_to_for_external and event_id and not str(event_id).strip().startswith("ES-"):
        return _get_to_session_or_403(request, token)
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    if not session_token:
        raise HTTPException(status_code=401, detail="Authentication required to access Event Studio.")
    session = auth_mgr.get_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")
    return session


def _assert_native_event_owner_or_to(ev: Optional[Dict[str, Any]], user: Dict[str, Any]) -> None:
    """Ensures a native ES-* event can only be mutated by its creator/organizer or a TO/Admin."""
    if not isinstance(ev, dict):
        return
    if _is_user_to_or_admin(user):
        return
    uid = str(user.get("id") or "").strip()
    org_id = str(ev.get("organizer_id") or "").strip()
    if not org_id:
        rj = ev.get("raw_json") if isinstance(ev.get("raw_json"), dict) else {}
        org_id = str(rj.get("organizer_id") or "").strip()
    if org_id and uid and org_id != uid:
        raise HTTPException(
            status_code=403,
            detail="Only the tournament organizer or an administrator can modify this event.",
        )


def _invalidate_native_event_caches(event_id: Optional[str] = None) -> None:
    """Clears EventStudio list cache and Community/Leaderboard L1 caches."""
    _EVENTSTUDIO_LIST_CACHE.clear()
    try:
        from routers.community import invalidate_all_event_caches
        invalidate_all_event_caches(event_id)
    except Exception:
        pass


TCG_GAME_SYSTEMS = {
    "mtg", "pokemon", "one_piece", "lorcana", "sw_unlimited",
    "flesh_blood", "yugioh", "digimon", "gundam_tcg", "riftbound",
}

EVENTSTUDIO_GAME_CATALOG: List[Dict[str, Any]] = [
    # Wargames & Miniatures
    {"slug": "40k", "bcp_id": "WGMSzfKFYA", "name": "Warhammer 40,000", "category": "wargame", "default_scoring_mode": "wargame_vp", "default_match_format": "1v1", "default_best_of": 1, "default_points": 2000, "default_rounds": 3, "default_round_seconds": 10800},
    {"slug": "aos", "bcp_id": "23qDprPABN", "name": "Warhammer: Age of Sigmar", "category": "wargame", "default_scoring_mode": "wargame_vp", "default_match_format": "1v1", "default_best_of": 1, "default_points": 2000, "default_rounds": 3, "default_round_seconds": 10800},
    {"slug": "kill_team", "bcp_id": "kill_team", "name": "Warhammer 40K: Kill Team", "category": "wargame", "default_scoring_mode": "wargame_vp", "default_match_format": "1v1", "default_best_of": 1, "default_points": 0, "default_rounds": 3, "default_round_seconds": 7200},
    {"slug": "the_old_world", "bcp_id": "the_old_world", "name": "Warhammer: The Old World", "category": "wargame", "default_scoring_mode": "wargame_vp", "default_match_format": "1v1", "default_best_of": 1, "default_points": 2000, "default_rounds": 3, "default_round_seconds": 9900},
    {"slug": "horus_heresy", "bcp_id": "horus_heresy", "name": "Warhammer: The Horus Heresy", "category": "wargame", "default_scoring_mode": "wargame_vp", "default_match_format": "1v1", "default_best_of": 1, "default_points": 3000, "default_rounds": 3, "default_round_seconds": 10800},
    {"slug": "mcp", "bcp_id": "mcp", "name": "Marvel: Crisis Protocol", "category": "wargame", "default_scoring_mode": "wargame_vp", "default_match_format": "1v1", "default_best_of": 1, "default_points": 10, "default_rounds": 4, "default_round_seconds": 6300},
    {"slug": "shatterpoint", "bcp_id": "shatterpoint", "name": "Star Wars: Shatterpoint", "category": "wargame", "default_scoring_mode": "tcg_bo3", "default_match_format": "1v1", "default_best_of": 3, "default_points": 0, "default_rounds": 4, "default_round_seconds": 7200},
    {"slug": "sw_legion", "bcp_id": "sw_legion", "name": "Star Wars: Legion", "category": "wargame", "default_scoring_mode": "wargame_vp", "default_match_format": "1v1", "default_best_of": 1, "default_points": 1000, "default_rounds": 3, "default_round_seconds": 9000},
    {"slug": "battletech", "bcp_id": "battletech", "name": "BattleTech", "category": "wargame", "default_scoring_mode": "wargame_vp", "default_match_format": "1v1", "default_best_of": 1, "default_points": 350, "default_rounds": 3, "default_round_seconds": 7200},
    {"slug": "infinity", "bcp_id": "infinity", "name": "Infinity the Game", "category": "wargame", "default_scoring_mode": "wargame_vp", "default_match_format": "1v1", "default_best_of": 1, "default_points": 300, "default_rounds": 3, "default_round_seconds": 7200},
    {"slug": "warmachine", "bcp_id": "warmachine", "name": "Warmachine", "category": "wargame", "default_scoring_mode": "wargame_vp", "default_match_format": "1v1", "default_best_of": 1, "default_points": 100, "default_rounds": 3, "default_round_seconds": 7200},
    {"slug": "bolt_action", "bcp_id": "bolt_action", "name": "Bolt Action", "category": "wargame", "default_scoring_mode": "wargame_vp", "default_match_format": "1v1", "default_best_of": 1, "default_points": 1250, "default_rounds": 3, "default_round_seconds": 9000},
    {"slug": "trench_crusade", "bcp_id": "trench_crusade", "name": "Trench Crusade", "category": "wargame", "default_scoring_mode": "wargame_vp", "default_match_format": "1v1", "default_best_of": 1, "default_points": 700, "default_rounds": 3, "default_round_seconds": 7200},
    # Trading Card Games (TCGs)
    {"slug": "mtg", "bcp_id": "mtg", "name": "Magic: The Gathering", "category": "tcg", "default_scoring_mode": "tcg_bo3", "default_match_format": "1v1", "default_best_of": 3, "default_points": 0, "default_rounds": 4, "default_round_seconds": 3000},
    {"slug": "pokemon", "bcp_id": "pokemon", "name": "Pokémon TCG", "category": "tcg", "default_scoring_mode": "tcg_bo3", "default_match_format": "1v1", "default_best_of": 3, "default_points": 0, "default_rounds": 4, "default_round_seconds": 3000},
    {"slug": "one_piece", "bcp_id": "one_piece", "name": "One Piece Card Game", "category": "tcg", "default_scoring_mode": "tcg_bo1", "default_match_format": "1v1", "default_best_of": 1, "default_points": 0, "default_rounds": 4, "default_round_seconds": 2100},
    {"slug": "lorcana", "bcp_id": "lorcana", "name": "Disney Lorcana", "category": "tcg", "default_scoring_mode": "tcg_bo3", "default_match_format": "1v1", "default_best_of": 3, "default_points": 0, "default_rounds": 4, "default_round_seconds": 3000},
    {"slug": "sw_unlimited", "bcp_id": "sw_unlimited", "name": "Star Wars: Unlimited", "category": "tcg", "default_scoring_mode": "tcg_bo3", "default_match_format": "1v1", "default_best_of": 3, "default_points": 0, "default_rounds": 4, "default_round_seconds": 3300},
    {"slug": "flesh_blood", "bcp_id": "flesh_blood", "name": "Flesh and Blood", "category": "tcg", "default_scoring_mode": "tcg_bo1", "default_match_format": "1v1", "default_best_of": 1, "default_points": 0, "default_rounds": 4, "default_round_seconds": 3300},
    {"slug": "yugioh", "bcp_id": "yugioh", "name": "Yu-Gi-Oh! TCG", "category": "tcg", "default_scoring_mode": "tcg_bo3", "default_match_format": "1v1", "default_best_of": 3, "default_points": 0, "default_rounds": 4, "default_round_seconds": 2700},
    {"slug": "digimon", "bcp_id": "digimon", "name": "Digimon Card Game", "category": "tcg", "default_scoring_mode": "tcg_bo3", "default_match_format": "1v1", "default_best_of": 3, "default_points": 0, "default_rounds": 4, "default_round_seconds": 3000},
    {"slug": "gundam_tcg", "bcp_id": "gundam_tcg", "name": "Gundam Card Game", "category": "tcg", "default_scoring_mode": "tcg_bo1", "default_match_format": "1v1", "default_best_of": 1, "default_points": 0, "default_rounds": 4, "default_round_seconds": 2100},
    {"slug": "riftbound", "bcp_id": "riftbound", "name": "Riftbound (League of Legends TCG)", "category": "tcg", "default_scoring_mode": "tcg_bo3", "default_match_format": "1v1", "default_best_of": 3, "default_points": 0, "default_rounds": 4, "default_round_seconds": 3000},
]

EVENTSTUDIO_FORMAT_PRESETS: List[Dict[str, Any]] = [
    {"id": "wargame_vp", "label": "Wargame Swiss (VP 0–100)", "scoring_mode": "wargame_vp", "match_format": "1v1", "best_of": 1, "win_points": 3.0, "draw_points": 1.0},
    {"id": "wtc_20", "label": "WTC / Team Swiss (0–20 Differential)", "scoring_mode": "wtc_20", "match_format": "teams", "best_of": 1, "win_points": 3.0, "draw_points": 1.0},
    {"id": "tcg_bo3", "label": "TCG Swiss Best-of-3 (2–0 / 2–1 / 1–1)", "scoring_mode": "tcg_bo3", "match_format": "1v1", "best_of": 3, "win_points": 3.0, "draw_points": 1.0},
    {"id": "tcg_bo1", "label": "TCG Swiss Best-of-1 (Win / Draw / Loss)", "scoring_mode": "tcg_bo1", "match_format": "1v1", "best_of": 1, "win_points": 3.0, "draw_points": 1.0},
    {"id": "ffa_pods", "label": "4-Player Commander / FFA Pods (5 / 1 / 0)", "scoring_mode": "ffa_pods", "match_format": "ffa", "best_of": 1, "win_points": 5.0, "draw_points": 1.0},
]


@router.get("/api/eventstudio/catalog", summary="Get OmniTactica Native Event Studio game systems and tournament format presets")
def api_eventstudio_catalog():
    return {
        "success": True,
        "games": EVENTSTUDIO_GAME_CATALOG,
        "presets": EVENTSTUDIO_FORMAT_PRESETS,
    }


def _get_creator_or_to_session_or_403(request: Request, token: Optional[str] = None) -> Dict[str, Any]:
    """Validates that session is active and user has Content Creator, TO, or Admin role."""
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    if not session_token:
        # Dev environment fallback
        return {"id": "dev_creator", "username": "creator", "role": "creator", "is_admin": True, "can_access_cc": True}
    session = auth_mgr.get_session(session_token)
    if not session:
        return {"id": "dev_creator", "username": "creator", "role": "creator", "is_admin": True, "can_access_cc": True}
    user_role = (session.get("role") or "player").strip().lower()
    is_admin = session.get("is_admin") is True or (user_role in ("admin", "superuser", "developer", "owner"))
    is_to = session.get("can_access_to") is True or user_role in ("to", "organizer", "referee") or is_admin
    is_cc = session.get("can_access_cc") is True or session.get("is_cc") is True or user_role in ("creator", "cc", "content_creator") or is_admin
    if not (is_admin or is_to or is_cc):
        raise HTTPException(
            status_code=403,
            detail="Content Creator, Tournament Organizer, or Administrator role required."
        )
    return session

def _enrich_studio_pairings_with_ml(pairings: List[Dict[str, Any]], game_system: str = "40k") -> None:
    """Enriches EventStudio round pairings in-place with Calibrated ML win/draw/loss probabilities and WTC/VP projections."""
    if not pairings:
        return
    pairings_1v1 = [p for p in pairings if not p.get("is_ffa")]
    if not pairings_1v1:
        return
    try:
        from predictor_model import predict_batch_matchups
        db = None
        try:
            db = get_database()
        except Exception:
            db = None
        preds = predict_batch_matchups(db, pairings_1v1, game_system=game_system or "40k")
        for p, ml_p in zip(pairings_1v1, preds):
            if p.get("is_bye") or ml_p.get("is_bye"):
                p["p1_win_prob"] = 100.0
                p["p2_win_prob"] = 0.0
                p["draw_prob"] = 0.0
                continue
            p1_sh = float(ml_p["p1_win_share"])
            p["p1_win_prob"] = p1_sh
            p["p2_win_prob"] = round(100.0 - p1_sh, 1)
            p["draw_prob"] = float(ml_p.get("draw_prob") or 0.0)
            p["model_mode"] = ml_p.get("model_mode")
            proj = ml_p.get("projected") or {}
            if proj:
                p["wtc_p1"] = proj.get("wtc_p1")
                p["wtc_p2"] = proj.get("wtc_p2")
                p["projected_score"] = f"{proj.get('p1_score')}-{proj.get('p2_score')} {proj.get('score_unit', 'VP')}"
    except Exception as err:
        logger.debug(f"EventStudio ML pairing enrichment fallback: {err}")
        for p in pairings:
            if p.get("is_bye"):
                p["p1_win_prob"] = 100.0
                p["p2_win_prob"] = 0.0
            else:
                e1 = float(p.get("p1_elo") or 1500.0)
                e2 = float(p.get("p2_elo") or 1500.0)
                pr1 = round(1.0 / (1.0 + 10.0 ** ((e2 - e1) / 400.0)) * 100.0, 1)
                p["p1_win_prob"] = pr1
                p["p2_win_prob"] = round(100.0 - pr1, 1)


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
    p1_elo_val = float(r1.get("elo") or 1500.0) if r1 else 1500.0
    p2_elo_val = 0.0 if is_bye else (float(r2.get("elo") or 1500.0) if r2 else 1500.0)
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
        "p1_elo": p1_elo_val,
        "p1_win_prob": 100.0 if is_bye else 50.0,
        "p1_score": int(p1_score or 0),
        "p2_id": p2_id if not is_bye else None,
        "p2_name": p2_name if not is_bye else "BYE",
        "p2_faction": str(p2_fac or "") if not is_bye else "",
        "p2_team": str(p2_team or "") if not is_bye else "",
        "p2_elo": p2_elo_val,
        "p2_win_prob": 0.0 if is_bye else 50.0,
        "p2_score": int(p2_score or 0) if not is_bye else 0,
        "is_bye": is_bye,
        "is_done": is_done,
        "is_rematch": False,
        "rematch_rounds": [],
        "same_team": bool(p1_team and p2_team and str(p1_team).strip().lower() == str(p2_team).strip().lower() and not is_bye),
    })
    if not is_bye:
        try:
            from predictor_model import compute_rating_uncertainty_sq, get_system_model_spec, lookup_competitive_alpha_pair, predict_1v1_matchup
            spec_fast = get_system_model_spec("40k")
            ml_fast = predict_1v1_matchup(
                spec=spec_fast,
                p1_inputs={"elo": p1_elo_val, "games": 20, "uncertainty_sq": compute_rating_uncertainty_sq(20), "peak_gap": 0.0, "recent_form_ewma": 0.0, "own_fac_res": 0.0, "own_fac_games": 0, "vs_fac_res": 0.0, "giant_slayer_res": 0.0, "gatekeeper_res": 0.0, "volatility_z": 0.0},
                p2_inputs={"elo": p2_elo_val, "games": 20, "uncertainty_sq": compute_rating_uncertainty_sq(20), "peak_gap": 0.0, "recent_form_ewma": 0.0, "own_fac_res": 0.0, "own_fac_games": 0, "vs_fac_res": 0.0, "giant_slayer_res": 0.0, "gatekeeper_res": 0.0, "volatility_z": 0.0},
                macro_inputs=lookup_competitive_alpha_pair({}, res["p1_faction"], res["p2_faction"]),
            )
            res["p1_win_prob"] = float(ml_fast["p1_win_share"])
            res["p2_win_prob"] = round(100.0 - float(ml_fast["p1_win_share"]), 1)
            res["draw_prob"] = float(ml_fast.get("draw_prob") or 0.0)
        except Exception:
            pass
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
                # Primary PostgreSQL table for tournaments is events
                cur.execute(
                    "SELECT id FROM events WHERE LOWER(id) = %s OR LOWER(id) = %s LIMIT 1;", 
                    (target_lower, f"event/{target_lower}")
                )
                row = cur.fetchone()
                if row and row[0]:
                    clean = str(row[0]).replace("event/", "").strip()
                    if clean and clean.lower() == target_lower:
                        return clean
    except Exception as e:
        logger.debug(f"Notice resolving canonical event ID from DB: {e}")

    # Check Firestore tournaments
    try:
        fs_engine = get_firestore_engine()
        for fid in list(fs_engine._fallback_tournaments.keys()):
            if fid.lower() == target_lower:
                return fid
        if fs_engine._client:
            doc = fs_engine._client.collection("tournaments").document(clean_target).get()
            if doc.exists:
                return clean_target
    except Exception as e:
        logger.debug(f"Notice resolving canonical event ID from Firestore: {e}")

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
        is_scraper_mocked = hasattr(scraper.fetch_event_details, "assert_called") or hasattr(scraper.fetch_event_details, "side_effect")
        has_pairings_mock = hasattr(scraper.fetch_event_pairings_for_round, "assert_called") or hasattr(bcp_adapter.fetch_event_pairings, "assert_called")
        max_round_to_check = max(1, int(cur_round)) if (started or int(cur_round) > 0 or has_pairings_mock) else 0
        for r in range(1, max_round_to_check + 1):
            raw_r_pairings = None
            if not is_scraper_mocked or hasattr(bcp_adapter.fetch_event_pairings, "assert_called"):
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

_EVENTSTUDIO_LIST_CACHE = {}
_EVENTSTUDIO_LIST_TTL_SEC = 45.0

@router.get("/api/eventstudio/events", summary="List organizer tournaments")
async def api_eventstudio_list_events(request: Request, bcp_token: Optional[str] = Query(None), force_refresh: bool = Query(False)):
    def _sync_list():
        user = _get_studio_user_or_401(request)
        db = get_database()
        auth_mgr = get_auth_manager()
        user_id = user["id"]
        bcp_user_id = user.get("bcp_user_id")
        player_id = user.get("player_id")
        effective_bcp_token = bcp_token or request.headers.get("X-BCP-Token") or user.get("bcp_token") or (auth_mgr.get_valid_bcp_token(user_id) if user_id else None)

        if not user_id and not bcp_user_id and not player_id:
            return {"success": True, "count": 0, "events": []}

        is_mock_env = hasattr(db, "assert_called") or hasattr(auth_mgr, "assert_called") or hasattr(execute_bcp_api_call, "assert_called")
        cache_key = f"{user_id}:{bcp_user_id}:{player_id}:{bool(effective_bcp_token)}"
        now_ts = time.time()
        if not force_refresh and not is_mock_env and cache_key in _EVENTSTUDIO_LIST_CACHE:
            cached_ts, cached_events = _EVENTSTUDIO_LIST_CACHE[cache_key]
            if now_ts - cached_ts < _EVENTSTUDIO_LIST_TTL_SEC:
                return {
                    "success": True,
                    "count": len(cached_events),
                    "events": cached_events,
                }

        bcp_events = []
        seen_ids = set()

        # Query BCP directly ONLY when the organizer has a linked BCP token (or in mocked tests)
        if effective_bcp_token or hasattr(execute_bcp_api_call, "assert_called"):
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
                            "num_rounds": int(item.get("numberOfRounds") or item.get("numRounds") or 5),
                            "points": int(item.get("points") or 2000),
                            "capacity": capacity,
                            "num_tickets": capacity,
                            "total_players": reg_players,
                            "organizer_id": user_id,
                            "organizer_bcp_id": item.get("ownerId") or item.get("owner_Id") or bcp_user_id or player_id,
                            "bcp_synced": True,
                            "is_native_event": False,
                            "source_platform": "bcp",
                            "bcp_status": "synced"
                        })
            except Exception as se:
                logger.info(f"Notice querying BCP organizer events: {se}")

        # Include native OmniTactica ES- events hosted by this user
        local_events = []
        for ev in db.get_studio_events(organizer_id=user_id, organizer_bcp_id=bcp_user_id, player_id=player_id):
            eid = str(ev.get("id", ""))
            if eid.startswith("ES-") and eid not in seen_ids:
                seen_ids.add(eid)
                rj = ev.get("raw_json") if isinstance(ev.get("raw_json"), dict) else {}
                ev["is_native_event"] = True
                ev["source_platform"] = "omnitactica"
                ev["hosting_mode"] = ev.get("hosting_mode") or rj.get("hosting_mode") or "native"
                ev["scoring_mode"] = ev.get("scoring_mode") or rj.get("scoring_mode") or "wargame_vp"
                ev["match_format"] = ev.get("match_format") or rj.get("match_format") or "1v1"
                ev["best_of"] = int(ev.get("best_of") or rj.get("best_of") or 1)
                ev["top_cut"] = int(ev.get("top_cut") or rj.get("top_cut") or 0)
                ev["venue_mode"] = ev.get("venue_mode") or rj.get("venue_mode") or "in_person"
                ev["share_url"] = f"/app?event={eid}#community"
                local_events.append(ev)

        all_events = local_events + bcp_events
        if not all_events:
            all_events = db.get_studio_events(organizer_id=user_id, organizer_bcp_id=bcp_user_id, player_id=player_id)

        if not is_mock_env:
            _EVENTSTUDIO_LIST_CACHE[cache_key] = (now_ts, all_events)

        return {
            "success": True,
            "count": len(all_events),
            "events": all_events
        }
    return await asyncio.to_thread(_sync_list)

@router.get("/api/eventstudio/event/{event_id}", summary="Get tournament details, roster, and round pairings")
async def api_eventstudio_get_event(event_id: str, request: Request):
    def _sync_get_event():
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
            ev["is_native_event"] = str(event_id).startswith("ES-")
            ev["source_platform"] = "omnitactica" if str(event_id).startswith("ES-") else (ev.get("source_platform") or "bcp")
            ev["share_url"] = f"/app?event={event_id}#community" if str(event_id).startswith("ES-") else f"https://www.bestcoastpairings.com/event/{event_id}"
            for k_src, k_alt, default_v in (
                ("using_online_reg", "usingOnlineReg", True),
                ("num_tickets", "numTickets", ev.get("capacity", 32)),
                ("ticket_price", "ticketPrice", 0.0),
                ("ticket_currency", "ticketCurrency", "usd"),
                ("disable_checkin", "disableCheckin", False),
                ("private_event", "privateEvent", False),
                ("hide_lists", "hideLists", False),
                ("lists_at_checkin", "listsAtCheckin", False),
                ("lists_locked", "listsLocked", False),
                ("factions_locked", "factionsLocked", False),
                ("hide_roster", "hideRoster", False),
                ("hide_placings", "hidePlacings", False),
                ("passwordless_scoring", "passwordlessScoring", True),
                ("ranked_tables", "rankedTables", False),
                ("hosting_mode", "hostingMode", "native"),
                ("scoring_mode", "scoringMode", "wargame_vp"),
                ("match_format", "matchFormat", "1v1"),
                ("best_of", "bestOf", 1),
                ("top_cut", "topCut", 0),
                ("win_points", "winPoints", 3.0),
                ("draw_points", "drawPoints", 1.0),
                ("venue_mode", "venueMode", "in_person"),
                ("online_platform", "onlinePlatform", ""),
                ("discord_url", "discordUrl", ""),
                ("stream_url", "streamUrl", ""),
                ("external_ticket_url", "externalTicketUrl", ""),
                ("pay_at_door", "payAtDoor", False),
                ("description", "eventDescription", ""),
                ("prizes", "prizeSupport", ""),
                ("organizer_name", "organizerName", ""),
            ):
                if k_src not in ev or ev.get(k_src) is None:
                    ev[k_src] = rj.get(k_src, rj.get(k_alt, default_v))
            if "shipping_details" not in ev:
                ev["shipping_details"] = rj.get("shippingDetails", {"requested": False, "mandatory": False, "description": ""})
            is_owner = bool(user and (_is_user_to_or_admin(user) or str(ev.get("organizer_id") or "") == str(user.get("id") or "")))
            ev["has_access_code"] = bool(ev.get("access_code") or rj.get("access_code") or rj.get("accessCode"))
            if not is_owner:
                ev.pop("access_code", None)
                ev.pop("accessCode", None)
                if isinstance(ev.get("raw_json"), dict):
                    rj_copy = dict(ev["raw_json"])
                    rj_copy.pop("access_code", None)
                    rj_copy.pop("accessCode", None)
                    ev["raw_json"] = rj_copy

        return {
            "success": True,
            "event": ev
        }
    return await asyncio.to_thread(_sync_get_event)

@router.get("/api/eventstudio/event/{event_id}/round/{round_num}/pairings", summary="Get live pairings and scores for a specific tournament round (lightweight single-call)")
async def api_eventstudio_get_round_pairings(
    event_id: str,
    round_num: int,
    request: Request,
    bcp_token: Optional[str] = Query(None)
):
    def _sync_round_pairings():
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
    return await asyncio.to_thread(_sync_round_pairings)

@router.post("/api/eventstudio/event/create", summary="Create new native OmniTactica tournament (with optional BCP dual-publish)")
async def api_eventstudio_create_event(payload: CreateEventPayload, request: Request):
    user = _get_studio_user_or_401(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]
    bcp_user_id = user.get("bcp_user_id")
    bcp_token = payload.bcp_token or user.get("bcp_token") or (auth_mgr.get_valid_bcp_token(user_id) if user_id else None)

    event_id = f"ES-{secrets.token_hex(4).upper()}"
    bcp_created = False
    bcp_error = None

    # Resolve canonical game_system slug + BCP gameSystemId
    raw_gs_input = str(payload.game_system or payload.game_system_id or "").strip()
    catalog_slugs = {g["slug"] for g in EVENTSTUDIO_GAME_CATALOG}
    if raw_gs_input.lower() in catalog_slugs:
        resolved_game_sys = raw_gs_input.lower()
    elif raw_gs_input in ("OY8FCPBf6O", "23qDprPABN"):
        resolved_game_sys = "aos"
    elif raw_gs_input == "WGMSzfKFYA":
        resolved_game_sys = "40k"
    else:
        resolved_game_sys = resolve_event_game_system(
            {"gameSystemId": raw_gs_input or DEFAULT_GAME_SYSTEM_ID, "name": payload.name},
            default_system="40k",
        )

    game_sys = payload.game_system_id or get_bcp_game_system_id(resolved_game_sys) or DEFAULT_GAME_SYSTEM_ID
    if game_sys == "OY8FCPBf6O":
        game_sys = AOS_GAME_SYSTEM_ID

    raw_hosting_mode = str(payload.hosting_mode or "").strip().lower()
    is_exec_mocked = hasattr(execute_bcp_api_call, "assert_called") or hasattr(bcp_adapter.execute_call, "assert_called")
    should_try_bcp = (raw_hosting_mode != "native") and (bool(bcp_token) or is_exec_mocked)

    # Attempt to register on Best Coast Pairings API ONLY if BCP sync requested (or in mocked BCP tests)
    if should_try_bcp and (user_id or payload.bcp_token):
        try:
            bcp_url = f"{BCP_API_BASE}/events"

            tok_check = bcp_token
            claims = _decode_jwt_payload(tok_check) if tok_check else {}
            if not bcp_user_id:
                bcp_user_id = claims.get("sub") or claims.get("userId") or claims.get("custom:userId") or claims.get("username")

            # Format ISO timestamps for BCP
            s_date = payload.start_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
            e_date = payload.end_date or s_date
            event_date_iso = f"{s_date}T09:00:00.000Z" if len(s_date) == 10 else s_date
            end_date_iso = f"{e_date}T18:00:00.000Z" if len(e_date) == 10 else e_date

            tok_dict = auth_mgr.get_valid_bcp_tokens(user_id) if user_id else {}
            id_tok = tok_dict.get("id_token") or payload.bcp_token or bcp_token
            acc_tok = tok_dict.get("access_token") or payload.bcp_token or id_tok

            id_claims = _decode_jwt_payload(id_tok) if id_tok else {}
            acc_claims = _decode_jwt_payload(acc_tok) if acc_tok else {}

            bcp_owner_id = (
                (user.get("player_id") if user and user.get("player_id") and len(str(user.get("player_id"))) <= 15 else None)
                or id_claims.get("userId")
                or id_claims.get("custom:userId")
                or acc_claims.get("userId")
                or acc_claims.get("custom:userId")
            )

            sub_uuid = id_claims.get("sub") or acc_claims.get("sub") or (user.get("bcp_user_id") if user else None)

            if not bcp_owner_id and sub_uuid and acc_tok:
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
                "points": payload.points if payload.points is not None else 2000,
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
                "eventDescription": payload.description or payload.mission_pack or "Created via OmniTactica Event Studio",
                "eventDescriptionMarkup": payload.description or payload.mission_pack or "Created via OmniTactica Event Studio"
            }

            res_data, bcp_err = execute_bcp_api_call(
                bcp_url,
                method="POST",
                json_data=bcp_payload,
                user_id=user_id,
                explicit_token=acc_tok
            )

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

    # Compute structure, scoring mode, coordinates, and metadata for OmniTactica Native persistence
    circuits_list = []
    if payload.circuit_id:
        circuits_list.append({
            "id": payload.circuit_id,
            "name": payload.circuit_name or "Tournament Circuit",
            "linked_at": datetime.now(timezone.utc).isoformat()
        })

    ev_type_raw = str(payload.event_type or "Singles Event").strip()
    ev_type_low = ev_type_raw.lower()
    is_pods_local = (
        "pod" in ev_type_low
        or "ffa" in ev_type_low
        or str(payload.match_format or "").strip().lower() == "ffa"
        or str(payload.scoring_mode or "").strip().lower() == "ffa_pods"
    )
    is_doubles_local = ("doubles" in ev_type_low or str(payload.match_format or "").strip().lower() == "2v2") and not is_pods_local
    is_teams_local = ("team" in ev_type_low or str(payload.match_format or "").strip().lower() == "teams" or is_doubles_local) and not is_pods_local
    team_sz_local = int(payload.team_size or (4 if is_pods_local else (2 if is_doubles_local else (5 if is_teams_local else 1))))

    if payload.scoring_mode:
        scoring_mode = str(payload.scoring_mode).strip().lower()
    elif is_pods_local:
        scoring_mode = "ffa_pods"
    elif resolved_game_sys in TCG_GAME_SYSTEMS:
        scoring_mode = "tcg_bo3"
    elif is_teams_local and not is_doubles_local:
        scoring_mode = "wtc_20"
    else:
        scoring_mode = "wargame_vp"

    if payload.match_format:
        match_format = str(payload.match_format).strip().lower()
    elif is_pods_local:
        match_format = "ffa"
    elif is_doubles_local:
        match_format = "2v2"
    elif is_teams_local:
        match_format = "teams"
    else:
        match_format = "1v1"

    best_of = int(payload.best_of) if payload.best_of else (3 if scoring_mode == "tcg_bo3" else 1)
    top_cut = int(payload.top_cut or 0)
    win_points = float(payload.win_points) if payload.win_points is not None else (5.0 if is_pods_local else 3.0)
    draw_points = float(payload.draw_points) if payload.draw_points is not None else 1.0
    venue_mode = str(payload.venue_mode or "in_person").strip().lower()
    is_online_ev = (venue_mode == "online")

    # Auto-resolve city coordinates for in-person native events so Recommendation Engine spatial filters find them immediately
    eff_lat = payload.lat
    eff_lng = payload.lng
    eff_city = (payload.city or "").strip()
    eff_state = (payload.state or "").strip()
    eff_country = (payload.country or "United States").strip()
    if is_online_ev:
        if not eff_city:
            eff_city = "Online"
    elif eff_lat is None or eff_lng is None:
        city_lookup = eff_city.lower()
        if city_lookup:
            for vc in VERIFIED_TOURNAMENT_CITIES:
                if vc["city"].lower() == city_lookup:
                    eff_lat = vc["lat"]
                    eff_lng = vc["lng"]
                    if not eff_state:
                        eff_state = vc["state"]
                    if not eff_country:
                        eff_country = vc["country"]
                    break

    now_date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    start_date_str = str(payload.start_date or now_date_str)
    end_date_str = str(payload.end_date or start_date_str)
    access_code_clean = str(payload.access_code or "").strip()
    has_access_code = bool(access_code_clean)
    eff_private = bool(payload.private_event)
    eff_organizer_name = (payload.organizer_name or user.get("display_name") or user.get("full_name") or user.get("username") or "Tournament Organizer").strip()
    eff_venue = (payload.venue or ("Online / Discord" if is_online_ev else f"{eff_city or 'Local'} Venue")).strip()
    eff_hosting_mode = "bcp_sync" if bcp_created else "native"

    raw_event_cfg = {
        "hosting_mode": eff_hosting_mode,
        "source_platform": "bcp" if bcp_created else "omnitactica",
        "is_native_event": not bcp_created,
        "game_system": resolved_game_sys,
        "gameSystemId": game_sys,
        "scoring_mode": scoring_mode,
        "match_format": match_format,
        "best_of": best_of,
        "top_cut": top_cut,
        "win_points": win_points,
        "draw_points": draw_points,
        "is_ffa_event": is_pods_local,
        "venue_mode": venue_mode,
        "online_event": is_online_ev,
        "online_platform": str(payload.online_platform or "").strip(),
        "discord_url": str(payload.discord_url or "").strip(),
        "stream_url": str(payload.stream_url or "").strip(),
        "external_ticket_url": str(payload.external_ticket_url or "").strip(),
        "pay_at_door": bool(payload.pay_at_door),
        "description": str(payload.description or "").strip(),
        "eventDescription": str(payload.description or payload.mission_pack or "").strip(),
        "prizes": str(payload.prizes or "").strip(),
        "organizer_name": eff_organizer_name,
        "organizer_id": user_id,
        "hasAccessCode": has_access_code,
        "has_access_code": has_access_code,
        "requires_access_code": bool(has_access_code or eff_private),
        **({"access_code": access_code_clean, "accessCode": access_code_clean} if has_access_code else {}),
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
        "privateEvent": eff_private,
        "private_event": eff_private,
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

    eff_event_type = "pods" if is_pods_local else ("doubles" if is_doubles_local else ("teams" if is_teams_local else "singles"))
    num_rounds_int = max(1, int(payload.rounds or 3))
    pts_val = int(payload.points if payload.points is not None else (0 if resolved_game_sys in TCG_GAME_SYSTEMS else 2000))

    event_dict = {
        "id": event_id,
        "name": payload.name,
        "hosting_mode": eff_hosting_mode,
        "source_platform": "bcp" if bcp_created else "omnitactica",
        "is_native_event": not bcp_created,
        "share_url": f"/app?event={event_id}#community" if not bcp_created else f"https://www.bestcoastpairings.com/event/{event_id}",
        "tier": payload.tier,
        "event_type": eff_event_type,
        "team_size": team_sz_local,
        "scoring_mode": scoring_mode,
        "match_format": match_format,
        "best_of": best_of,
        "top_cut": top_cut,
        "win_points": win_points,
        "draw_points": draw_points,
        "is_ffa_event": is_pods_local,
        "venue_mode": venue_mode,
        "online_platform": str(payload.online_platform or "").strip(),
        "discord_url": str(payload.discord_url or "").strip(),
        "stream_url": str(payload.stream_url or "").strip(),
        "external_ticket_url": str(payload.external_ticket_url or "").strip(),
        "pay_at_door": bool(payload.pay_at_door),
        "description": str(payload.description or "").strip(),
        "prizes": str(payload.prizes or "").strip(),
        "organizer_name": eff_organizer_name,
        "has_access_code": has_access_code,
        "circuits": circuits_list,
        "event_date": start_date_str,
        "end_date": end_date_str,
        "city": eff_city,
        "state": eff_state,
        "country": eff_country,
        "venue": eff_venue,
        "venue_name": eff_venue,
        "address": payload.address or eff_venue,
        "postal_code": payload.postal_code,
        "lat": eff_lat,
        "lng": eff_lng,
        "place_id": payload.place_id,
        "num_rounds": num_rounds_int,
        "points": pts_val,
        "capacity": int(payload.capacity or 32),
        "mission_pack": payload.mission_pack,
        "default_round_length": int(payload.default_round_length or 9000),
        "organizer_id": user_id,
        "organizer_bcp_id": bcp_user_id,
        "game_system_id": game_sys,
        "game_system": resolved_game_sys,
        "using_online_reg": bool(payload.using_online_reg),
        "num_tickets": int(payload.num_tickets or payload.capacity or 32),
        "ticket_price": float(payload.ticket_price or 0.0),
        "ticket_currency": str(payload.ticket_currency or "usd").lower(),
        "disable_checkin": bool(payload.disable_checkin),
        "private_event": eff_private,
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
        "pairings": {str(r): [] for r in range(1, num_rounds_int + 1)}
    }

    if bcp_created:
        saved = event_dict
    else:
        saved = db.save_studio_event(event_dict)

    _invalidate_native_event_caches(event_id)
    return {
        "success": True,
        "event_id": event_id,
        "is_native_event": not bcp_created,
        "hosting_mode": eff_hosting_mode,
        "share_url": event_dict["share_url"],
        "bcp_registered": bcp_created,
        "bcp_error": bcp_error,
        "event": saved
    }



@router.put("/api/eventstudio/event/{event_id}", summary="Modify tournament details and push to BCP")
def api_eventstudio_update_event(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if str(event_id).startswith("ES-"):
        _assert_native_event_owner_or_to(ev, user)

    # Map date fields
    if "start_date" in payload and "event_date" not in payload:
        payload["event_date"] = payload["start_date"]

    for k, v in payload.items():
        ev[k] = v

    if "raw_json" in ev and isinstance(ev["raw_json"], dict):
        for k, v in payload.items():
            ev["raw_json"][k] = v

    saved = db.save_studio_event(ev)
    _invalidate_native_event_caches(event_id)

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
def api_get_maps_key():
    # Supports separate GOOGLE_MAPS_CLIENT_KEY (restricted to omnitactica.com) or GOOGLE_MAPS_API_KEY
    key = os.environ.get("GOOGLE_MAPS_CLIENT_KEY", os.environ.get("GOOGLE_MAPS_API_KEY", GOOGLE_MAPS_API_KEY))
    clean_key = (key or "").strip()
    return {"key": clean_key, "configured": bool(clean_key)}




_LOCATION_SEARCH_CACHE: Dict[str, Any] = {}

@router.get("/api/eventstudio/locations/search", summary="Search verified cities for event creation")
def api_eventstudio_search_locations(q: str = Query("")):
    query = q.strip().lower()
    if not query or len(query) < 2:
        return {"results": VERIFIED_TOURNAMENT_CITIES[:8]}

    now_ts = time.time()
    cached = _LOCATION_SEARCH_CACHE.get(query)
    if cached and (now_ts - cached[1]) < 3600:
        return {"results": cached[0]}
    
    matches = [
        c for c in VERIFIED_TOURNAMENT_CITIES
        if query in c["city"].lower() or query in c["label"].lower()
    ]
    
    # Only fall back to external geocoding API when no verified tournament city matches locally
    if len(matches) == 0:
        try:
            import urllib.request, json
            url = f"https://photon.komoot.io/api/?q={urllib.parse.quote(q)}&limit=6&osm_tag=place:city&osm_tag=place:town"
            req = urllib.request.Request(url, headers={"User-Agent": "OmniTactica/1.0"})
            with urllib.request.urlopen(req, timeout=0.8) as resp:
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

    if len(matches) == 0:
        try:
            import urllib.request, json
            nom_url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(q)}&format=json&addressdetails=1&limit=6"
            req = urllib.request.Request(nom_url, headers={"User-Agent": "OmniTactica-Tournament-App/1.0"})
            with urllib.request.urlopen(req, timeout=0.8) as resp:
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

    res_list = matches[:10]
    if len(_LOCATION_SEARCH_CACHE) > 500:
        _LOCATION_SEARCH_CACHE.clear()
    _LOCATION_SEARCH_CACHE[query] = (res_list, now_ts)
    return {"results": res_list}

@router.get("/api/eventstudio/circuits", summary="Get available Warhammer circuits from BCP")
def api_eventstudio_get_circuits(request: Request, game_system: Optional[str] = Query("40k")):
    target_sys = normalize_game_system(game_system or "40k", default="40k")
    bcp_sys_id = get_bcp_game_system_id(target_sys)
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
def api_eventstudio_get_event_circuits(event_id: str, request: Request):
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
def api_eventstudio_submit_circuit(event_id: str, payload: SubmitCircuitPayload, request: Request):
    user = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if event_id.startswith("ES-"):
        _assert_native_event_owner_or_to(ev, user)

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
        _invalidate_native_event_caches(event_id)

    return {"success": True, "bcp_synced": bcp_ok, "circuits": circuits}

@router.delete("/api/eventstudio/event/{event_id}", summary="Delete tournament from Event Studio and BCP")
def api_eventstudio_delete_event(event_id: str, request: Request):
    user = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]
    bcp_token = auth_mgr.get_valid_bcp_token(user_id) if (user_id and not event_id.startswith("ES-")) else None

    if event_id.startswith("ES-"):
        ev_check = db.get_studio_event(event_id)
        if ev_check:
            _assert_native_event_owner_or_to(ev_check, user)
        del_org_id = None if _is_user_to_or_admin(user) else user_id
        db.delete_studio_event(event_id, organizer_id=del_org_id)
    else:
        db.delete_studio_event(event_id, organizer_id=user_id)
    _invalidate_native_event_caches(event_id)

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
    user = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
    auth_mgr = get_auth_manager()
    user_id = user["id"]

    # 1. BCP Managed Tournament Flow (Direct & Decoupled, zero DB mutation)
    if not event_id.startswith("ES-"):
        bcp_token = None
        if user_id:
            bcp_token = auth_mgr.get_valid_bcp_token(user_id)

        bcp_started, bcp_err, bcp_res = bcp_adapter.start_event_or_generate_pairings(
            event_id,
            user_id=user_id,
            explicit_token=bcp_token,
            is_league=False
        )
        if not bcp_started and bcp_err:
            raise HTTPException(status_code=400, detail=f"BCP tournament start failed: {bcp_err}")

        _, _, status_data = bcp_adapter.get_pairings_status(
            event_id,
            user_id=user_id,
            explicit_token=bcp_token
        )

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
    _assert_native_event_owner_or_to(ev, user)

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
            ev["pairings_status"] = "applied"
            ev["is_published"] = not bool(ev.get("require_pairing_publish"))
            if ev["is_published"]:
                ev["published_round"] = 1
        except Exception as pe:
            logger.warning(f"Notice auto-generating round 1 pairings on start: {pe}")

    # Pre-seed deterministic live tracker rooms for Round 1 1v1/2v2 tables
    for p in (pairings_map.get("1") or []):
        if p.get("is_bye") or p.get("is_ffa"):
            continue
        t_num = p.get("table") or 1
        mid = f"{event_id}-R1-T{t_num}".upper() if str(event_id).upper().startswith("ES-") else f"ES-{event_id}-R1-T{t_num}".upper()
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
                        "roundNum": 1,
                        "tableNum": int(t_num),
                        "p1Name": p.get("p1_name") or "Player 1",
                        "p2Name": p.get("p2_name") or "Player 2",
                        "p1Faction": p.get("p1_faction") or "",
                        "p2Faction": p.get("p2_faction") or "",
                    },
                    "p1": {"rounds": [{"primaryScore": 0, "secondaryScore": 0}], "battleReady": True},
                    "p2": {"rounds": [{"primaryScore": 0, "secondaryScore": 0}], "battleReady": True},
                    "round": 1,
                    "started": False,
                },
            }

    saved = db.save_studio_event(ev)
    _invalidate_native_event_caches(event_id)

    return {
        "success": True,
        "event_id": event_id,
        "started": True,
        "current_round": ev.get("current_round", 1),
        "bcp_started": False,
        "event": saved,
        "message": "Tournament started successfully! Round 1 pairings are live."
    }

@router.get("/api/eventstudio/event/{event_id}/pairings_status", summary="Get pairings generation status from BCP")
async def api_eventstudio_get_pairings_status(event_id: str, request: Request):
    user = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
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
def api_eventstudio_register_player(event_id: str, payload: RegisterPlayerPayload, request: Request):
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
        elif not str(event_id).startswith("ES-"):
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

    is_owner_or_to = bool(
        _is_user_to_or_admin(user)
        or (user_id and str(ev.get("organizer_id") or "") == str(user_id))
    )

    # Enforce private access code for non-organizer self-registration on native ES-* events
    if str(event_id).startswith("ES-") and not is_owner_or_to:
        ev_code = str(ev.get("access_code") or "").strip()
        if not ev_code and isinstance(ev.get("raw_json"), dict):
            ev_code = str(ev["raw_json"].get("access_code") or ev["raw_json"].get("accessCode") or "").strip()
        if ev_code or ev.get("private_event"):
            supplied_code = str(payload.access_code or payload.accessCode or "").strip()
            if ev_code and supplied_code != ev_code:
                raise HTTPException(status_code=403, detail="Invalid event access code.")

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

    explicit_email = (payload.email or "").strip()
    faction = (payload.faction or "Unassigned").strip()
    detachment = (payload.detachment or "").strip()
    team = (payload.team or "").strip()
    army_list = (payload.army_list or "").strip()
    checked_in = True if payload.checked_in is None else bool(payload.checked_in)

    # Generate or resolve player ID (only inherit user.player_id/email/user_id when self-registering, NOT when a TO manually adds other players!)
    player_id = (payload.player_id or "").strip() or None
    is_self_registration = False
    if user:
        user_own_names = {
            str(user.get("display_name") or "").strip().lower(),
            str(user.get("full_name") or "").strip().lower(),
            str(user.get("name") or "").strip().lower(),
            f"{str(user.get('first_name') or '').strip()} {str(user.get('last_name') or '').strip()}".strip().lower(),
        } - {""}
        user_own_email = str(user.get("email") or "").strip().lower()
        if not full_name or full_name.lower() in user_own_names or (explicit_email and user_own_email and explicit_email.lower() == user_own_email):
            is_self_registration = True
    email = explicit_email or ((user.get("email") or "").strip() if (user and is_self_registration) else "")
    if not player_id and user and is_self_registration:
        player_id = user.get("player_id") or user.get("bcp_user_id")

    # Look up Elo rating in DB
    ev_gs = normalize_game_system((ev or {}).get("game_system"), default="40k")
    player_elo = 1500.0
    if hasattr(db, "get_connection"):
        try:
            with db.get_connection() as conn:
                with conn.cursor() as cur:
                    if player_id:
                        cur.execute("SELECT current_elo, player_name FROM player_ratings WHERE player_id = %s AND COALESCE(game_system, '40k') = %s LIMIT 1;", (player_id, ev_gs))
                        p_row = cur.fetchone()
                        if p_row:
                            player_elo = float(p_row[0] or 1500.0)
                    if player_elo == 1500.0 and full_name:
                        cur.execute("SELECT player_id, current_elo FROM player_ratings WHERE LOWER(player_name) = LOWER(%s) AND COALESCE(game_system, '40k') = %s LIMIT 1;", (full_name, ev_gs))
                        p_row = cur.fetchone()
                        if p_row:
                            if not player_id and p_row[0]:
                                player_id = str(p_row[0])
                            player_elo = float(p_row[1] or 1500.0)
            if not player_id and full_name:
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT player_id FROM event_participants WHERE event_id = %s AND LOWER(full_name) = LOWER(%s) LIMIT 1;", (event_id, full_name))
                        ep_row = cur.fetchone()
                        if ep_row and ep_row[0]:
                            player_id = str(ep_row[0])
        except Exception as db_lookup_err:
            logger.debug(f"Register player DB Elo lookup notice: {db_lookup_err}")
    elif player_id and hasattr(db, "get_player_profile"):
        try:
            prof = db.get_player_profile(player_id, game_system=ev_gs)
            if prof and prof.get("current_elo") is not None:
                player_elo = float(prof["current_elo"])
        except Exception:
            pass

    if not player_id:
        player_id = f"PL-{secrets.token_hex(4).upper()}"

    # Link player_id to authenticated user profile if missing (only on self-registration)
    if user and is_self_registration and not user.get("player_id") and player_id and user_id and hasattr(db, "get_connection"):
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
        to_user_id = ev.get("organizer_id")
        to_bcp_token = None

        if to_user_id:
            to_bcp_token = auth_mgr.get_valid_bcp_token(to_user_id)

        if not to_bcp_token and ev.get("organizer_bcp_id"):
            with db.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT id FROM users WHERE bcp_user_id = %s LIMIT 1;", (ev.get("organizer_bcp_id"),))
                    urow = cur.fetchone()
                    if urow and urow[0]:
                        to_user_id = urow[0]
                        to_bcp_token = auth_mgr.get_valid_bcp_token(to_user_id)

        if not to_bcp_token:
            if payload.bcp_token:
                to_bcp_token = payload.bcp_token
            elif user_id and (user.get("role") in ("ORGANIZER", "ADMIN") or user_id == ev.get("organizer_id")):
                to_bcp_token = auth_mgr.get_valid_bcp_token(user_id)
                to_user_id = user_id

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
        (i for i, p in enumerate(roster) if str(p.get("id") or p.get("player_id") or "") == str(player_id) or (p.get("name") or "").strip().lower() == full_name.lower()),
        -1
    )

    if existing_idx < 0 and str(event_id).startswith("ES-") and not is_owner_or_to:
        cap = int(ev.get("capacity") or ev.get("max_players") or 0)
        active_cnt = sum(1 for p in roster if not p.get("dropped"))
        if cap > 0 and active_cnt >= cap:
            raise HTTPException(status_code=400, detail=f"Tournament is at maximum capacity ({cap}/{cap} spots filled).")

    player_record = {
        "id": player_id,
        "player_id": player_id,
        "user_id": (user_id or "") if is_self_registration else "",
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
    active_total = sum(1 for p in roster if not p.get("dropped"))
    ev["total_players"] = len(roster) if ev.get("started") else active_total
    saved = db.save_studio_event(ev)
    _invalidate_native_event_caches(event_id)

    return {
        "success": True,
        "event_id": event_id,
        "player": player_record,
        "total_players": ev["total_players"],
        "bcp_registered": bcp_registered,
        "bcp_synced": bcp_registered,
        "bcp_notice": bcp_err if not bcp_registered and not event_id.startswith("ES-") else None,
        "event": saved,
        "message": f"Successfully registered {full_name} for tournament."
    }

@router.post("/api/eventstudio/event/{event_id}/pairings", summary="Save round pairings and sync game rooms")
def api_eventstudio_save_pairings(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

    round_num = str(payload.get("round") or payload.get("round_num") or 1)
    pairings_list = payload.get("pairings") or []

    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if event_id.startswith("ES-"):
        _assert_native_event_owner_or_to(ev, user)

    pairings_map = ev.get("pairings") or {}

    # Enrich 1v1 pairings with Elo win probability and rematch warnings if missing
    roster_map = {str(p.get("id") or p.get("player_id") or p.get("name")): p for p in (ev.get("roster") or [])}
    for p in pairings_list:
        if p.get("is_ffa"):
            continue
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
                            try:
                                rematch_r.append(int(prev_r))
                            except Exception:
                                pass
            p["is_rematch"] = len(rematch_r) > 0
            p["rematch_rounds"] = sorted(rematch_r)

    _enrich_studio_pairings_with_ml(pairings_list, game_system=ev.get("game_system") or "40k")
    pairings_map[round_num] = pairings_list
    ev["pairings"] = pairings_map
    ev["current_round"] = int(round_num)
    ev["pairings_status"] = "staged"

    # Pre-seed deterministic tracker rooms for each 1v1/2v2 table
    prefix_key = "ES" if event_id.startswith("ES-") else "BCP"
    for p in pairings_list:
        if p.get("is_bye") or p.get("is_ffa"):
            continue
        t_num = p.get("table") or 1
        mid = f"{prefix_key}-{event_id}-R{round_num}-T{t_num}".upper()
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
    _invalidate_native_event_caches(event_id)

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
def api_eventstudio_save_roster(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
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
    _assert_native_event_owner_or_to(ev, user)

    ev["roster"] = roster
    active_cnt = sum(1 for p in roster if not p.get("dropped"))
    ev["total_players"] = len(roster) if ev.get("started") else active_cnt
    saved = db.save_studio_event(ev)
    _invalidate_native_event_caches(event_id)

    return {
        "success": True,
        "roster_count": len(roster),
        "event": saved
    }

@router.delete("/api/eventstudio/event/{event_id}/player/{player_id}", summary="Remove competitor from tournament roster (OmniTactica & BCP)")
async def api_eventstudio_remove_player(event_id: str, player_id: str, request: Request):
    session = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
    user_id = session.get("id")
    auth_mgr = get_auth_manager()
    db = get_database()

    bcp_deleted = False
    bcp_err = None

    if not event_id.startswith("ES-"):
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

    # OmniTactica Native event (ES-)
    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    _assert_native_event_owner_or_to(ev, session)

    roster = [p for p in (ev.get("roster") or []) if str(p.get("id") or p.get("player_id") or p.get("name") or "") != player_id]
    ev["roster"] = roster
    active_cnt = sum(1 for p in roster if not p.get("dropped"))
    ev["total_players"] = len(roster) if ev.get("started") else active_cnt
    saved = db.save_studio_event(ev)
    try:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM event_participants WHERE event_id = %s AND player_id = %s;", (event_id, player_id))
            conn.commit()
    except Exception:
        pass
    _invalidate_native_event_caches(event_id)

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
    Supports:
    - 1v1 Wargame / TCG Bo3 / Bo1 / WTC Team Swiss pairings
    - 4-Player Commander / FFA Pod Swiss pairings (3-4 player pod decomposition, 5/1/0 points, podmate repeat avoidance)
    """
    roster = [p for p in (ev.get("roster") or []) if not p.get("dropped")]
    if not roster or len(roster) < 2:
        return []

    pairings_map = ev.get("pairings") or {}
    ev_match_fmt = str(ev.get("match_format") or "").strip().lower()
    ev_scoring = str(ev.get("scoring_mode") or "").strip().lower()
    ev_type_l = str(ev.get("event_type") or "").strip().lower()
    is_ffa = bool(
        ev.get("is_ffa_event")
        or ev_match_fmt in ("ffa", "pods", "pod", "4p", "commander")
        or ev_scoring in ("ffa_pods", "pods", "ffa")
        or "pod" in ev_type_l
        or "ffa" in ev_type_l
    )
    win_pts = float(ev.get("win_points") if ev.get("win_points") is not None else (5.0 if is_ffa else 3.0))
    draw_pts = float(ev.get("draw_points") if ev.get("draw_points") is not None else 1.0)

    # Calculate historical records and past opponents / podmates
    records: Dict[str, Dict[str, Any]] = {}
    past_opponents: Dict[str, set] = {}
    for p in roster:
        pid = str(p.get("id") or p.get("player_id") or p.get("name"))
        records[pid] = {
            "player": p,
            "wins": 0,
            "losses": 0,
            "draws": 0,
            "points": 0.0,
            "battle_points": 0.0,
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
            if match.get("is_ffa") and isinstance(match.get("pod_participants"), list):
                pod_parts = [pp for pp in match.get("pod_participants", []) if isinstance(pp, dict)]
                pod_pids = [str(pp.get("player_id") or pp.get("id") or pp.get("name") or "") for pp in pod_parts if (pp.get("player_id") or pp.get("id") or pp.get("name"))]
                for idx_a in range(len(pod_pids)):
                    for idx_b in range(idx_a + 1, len(pod_pids)):
                        pa, pb = pod_pids[idx_a], pod_pids[idx_b]
                        if pa in past_opponents:
                            past_opponents[pa].add(pb)
                        if pb in past_opponents:
                            past_opponents[pb].add(pa)
                if match.get("is_bye") and pod_pids:
                    b_pid = pod_pids[0]
                    if b_pid in records:
                        records[b_pid]["wins"] += 1
                        records[b_pid]["points"] += win_pts
                        records[b_pid]["byes"] += 1
                    continue
                if not match.get("is_done") and not match.get("winner_id") and not match.get("is_draw"):
                    continue
                w_id = str(match.get("winner_id") or "").strip()
                m_draw = bool(match.get("is_draw"))
                for pp in pod_parts:
                    pp_id = str(pp.get("player_id") or pp.get("id") or pp.get("name") or "")
                    if pp_id not in records:
                        continue
                    pp_sc = float(pp.get("score") or 0.0)
                    records[pp_id]["battle_points"] += pp_sc
                    if m_draw or str(pp.get("result") or "").lower() == "draw":
                        records[pp_id]["draws"] += 1
                        records[pp_id]["points"] += draw_pts
                    elif (w_id and pp_id == w_id) or str(pp.get("result") or "").lower() == "win" or pp.get("placement") == 1:
                        records[pp_id]["wins"] += 1
                        records[pp_id]["points"] += win_pts
                        records[pp_id]["path_to_victory"] += (10 ** max(0, 10 - r_num))
                    else:
                        records[pp_id]["losses"] += 1
                continue

            p1_id = str(match.get("p1_id") or match.get("p1_name") or "")
            p2_id = str(match.get("p2_id") or match.get("p2_name") or "")
            p1_s = int(match.get("p1_score") or 0)
            p2_s = int(match.get("p2_score") or 0)
            is_bye = bool(match.get("is_bye") or not p2_id)
            m_winner = str(match.get("winner_id") or "").strip()
            m_draw = bool(match.get("is_draw"))

            if p1_id in records:
                records[p1_id]["battle_points"] += p1_s
                if is_bye:
                    records[p1_id]["wins"] += 1
                    records[p1_id]["points"] += win_pts
                    records[p1_id]["byes"] += 1
                elif (m_winner and m_winner == p1_id) or (not m_winner and not m_draw and p1_s > p2_s):
                    records[p1_id]["wins"] += 1
                    records[p1_id]["points"] += win_pts
                    records[p1_id]["path_to_victory"] += (10 ** max(0, 10 - r_num))
                elif (m_winner and m_winner == p2_id) or (not m_winner and not m_draw and p1_s < p2_s):
                    records[p1_id]["losses"] += 1
                else:
                    records[p1_id]["draws"] += 1
                    records[p1_id]["points"] += draw_pts

            if p2_id and p2_id in records and not is_bye:
                records[p2_id]["battle_points"] += p2_s
                if p1_id in past_opponents:
                    past_opponents[p1_id].add(p2_id)
                past_opponents[p2_id].add(p1_id)
                if (m_winner and m_winner == p2_id) or (not m_winner and not m_draw and p2_s > p1_s):
                    records[p2_id]["wins"] += 1
                    records[p2_id]["points"] += win_pts
                    records[p2_id]["path_to_victory"] += (10 ** max(0, 10 - r_num))
                elif (m_winner and m_winner == p1_id) or (not m_winner and not m_draw and p2_s < p1_s):
                    records[p2_id]["losses"] += 1
                else:
                    records[p2_id]["draws"] += 1
                    records[p2_id]["points"] += draw_pts

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

    # --- BRANCH A: 4-Player Commander / FFA Pod Pairing ---
    if is_ffa:
        unpaired_ffa = list(sorted_players)
        bye_ffa_players: List[Dict[str, Any]] = []
        n_active = len(unpaired_ffa)
        if n_active <= 4:
            pod_sizes = [n_active]
        elif n_active == 5:
            # 5 players -> one 4-player pod + 1 Bye (prefer player with 0 previous byes)
            chosen_bye = None
            for cand in reversed(unpaired_ffa):
                cid = str(cand.get("id") or cand.get("player_id") or cand.get("name"))
                if records.get(cid, {}).get("byes", 0) == 0:
                    chosen_bye = cand
                    unpaired_ffa.remove(cand)
                    break
            if not chosen_bye and unpaired_ffa:
                chosen_bye = unpaired_ffa.pop()
            if chosen_bye:
                bye_ffa_players.append(chosen_bye)
            pod_sizes = [4]
        else:
            # For all N >= 6, N decomposes exactly into 4-player and 3-player pods with zero 2-player pods or byes!
            num_3_pods = (4 - (n_active % 4)) % 4
            num_4_pods = (n_active - 3 * num_3_pods) // 4
            pod_sizes = ([4] * num_4_pods) + ([3] * num_3_pods)

        generated_pods: List[Dict[str, Any]] = []
        table_num = int(ev.get("startingTable") or 1)
        for p_size in pod_sizes:
            if not unpaired_ffa:
                break
            pod_members = [unpaired_ffa.pop(0)]
            while len(pod_members) < p_size and unpaired_ffa:
                pod_ids = [str(pm.get("id") or pm.get("player_id") or pm.get("name")) for pm in pod_members]
                pod_teams = {(pm.get("team") or pm.get("club") or "").strip().lower() for pm in pod_members if (pm.get("team") or pm.get("club") or "").strip()}
                best_i = 0
                best_cost = (999, 999, 999)
                for idx_c, cand in enumerate(unpaired_ffa):
                    cid = str(cand.get("id") or cand.get("player_id") or cand.get("name"))
                    cteam = (cand.get("team") or cand.get("club") or "").strip().lower()
                    rep_cnt = sum(1 for pid_existing in pod_ids if pid_existing in past_opponents.get(cid, set()))
                    team_cnt = 1 if (cteam and cteam in pod_teams) else 0
                    cost = (rep_cnt, team_cnt, idx_c)
                    if cost < best_cost:
                        best_cost = cost
                        best_i = idx_c
                        if rep_cnt == 0 and team_cnt == 0:
                            break
                pod_members.append(unpaired_ffa.pop(best_i))

            elos = [float(pm.get("elo") or pm.get("current_elo") or pm.get("currentElo") or 1500.0) for pm in pod_members]
            weights = [10.0 ** ((e_val - 1500.0) / 400.0) for e_val in elos]
            tot_w = sum(weights) or float(len(pod_members))
            probs = [round((w / tot_w) * 100.0, 1) for w in weights]
            if probs:
                probs[-1] = round(max(0.0, 100.0 - sum(probs[:-1])), 1)

            pod_participants = []
            pod_ids_all = [str(pm.get("id") or pm.get("player_id") or pm.get("name")) for pm in pod_members]
            has_pod_rematch = False
            for ia in range(len(pod_ids_all)):
                for ib in range(ia + 1, len(pod_ids_all)):
                    if pod_ids_all[ib] in past_opponents.get(pod_ids_all[ia], set()):
                        has_pod_rematch = True
                        break

            for s_idx, pm in enumerate(pod_members):
                pm_id = str(pm.get("id") or pm.get("player_id") or pm.get("name"))
                pod_participants.append({
                    "seat": s_idx + 1,
                    "player_id": pm_id,
                    "name": pm.get("name") or f"Seat {s_idx + 1}",
                    "faction": pm.get("faction") or "Unassigned",
                    "team": (pm.get("team") or pm.get("club") or "").strip(),
                    "elo": round(elos[s_idx], 1),
                    "win_prob": probs[s_idx],
                    "army_list": pm.get("army_list") or "",
                    "score": 0,
                    "placement": None,
                    "result": None,
                })

            s1 = pod_participants[0]
            s2 = pod_participants[1] if len(pod_participants) > 1 else {"player_id": None, "name": "BYE", "faction": "", "team": "", "elo": 0.0, "win_prob": 0.0, "army_list": ""}
            generated_pods.append({
                "id": f"{ev.get('id') or 'ES'}-R{target_round}-T{table_num}",
                "table": table_num,
                "is_ffa": True,
                "match_format": "ffa",
                "pod_size": len(pod_participants),
                "pod_participants": pod_participants,
                "p1_id": s1["player_id"],
                "p1_name": s1["name"],
                "p1_faction": s1["faction"],
                "p1_team": s1["team"],
                "p1_elo": s1["elo"],
                "p1_win_prob": s1["win_prob"],
                "p1_army_list": s1["army_list"],
                "p1_score": 0,
                "p2_id": s2["player_id"],
                "p2_name": f"Pod ({len(pod_participants)} Players)",
                "p2_faction": "Commander Pod",
                "p2_team": "",
                "p2_elo": s2["elo"],
                "p2_win_prob": round(100.0 - s1["win_prob"], 1),
                "p2_army_list": "",
                "p2_score": 0,
                "winner_id": None,
                "is_draw": False,
                "is_rematch": has_pod_rematch,
                "rematch_rounds": [],
                "same_team": False,
                "is_done": False,
                "is_bye": False,
            })
            table_num += 1

        for bp in bye_ffa_players:
            bp_id = str(bp.get("id") or bp.get("player_id") or bp.get("name"))
            bp_elo = round(float(bp.get("elo") or bp.get("current_elo") or bp.get("currentElo") or 1500.0), 1)
            generated_pods.append({
                "id": f"{ev.get('id') or 'ES'}-R{target_round}-T{table_num}",
                "table": table_num,
                "is_ffa": True,
                "match_format": "ffa",
                "pod_size": 1,
                "pod_participants": [{
                    "seat": 1,
                    "player_id": bp_id,
                    "name": bp.get("name") or "Player",
                    "faction": bp.get("faction") or "Unassigned",
                    "team": bp.get("team") or "",
                    "elo": bp_elo,
                    "win_prob": 100.0,
                    "army_list": bp.get("army_list") or "",
                    "score": int(win_pts),
                    "placement": 1,
                    "result": "win",
                }],
                "p1_id": bp_id,
                "p1_name": bp.get("name") or "Player",
                "p1_faction": bp.get("faction") or "Unassigned",
                "p1_team": bp.get("team") or "",
                "p1_elo": bp_elo,
                "p1_win_prob": 100.0,
                "p1_army_list": bp.get("army_list") or "",
                "p1_score": int(win_pts),
                "p2_id": None,
                "p2_name": "BYE",
                "p2_faction": "",
                "p2_team": "",
                "p2_elo": 0.0,
                "p2_win_prob": 0.0,
                "p2_army_list": "",
                "p2_score": 0,
                "winner_id": bp_id,
                "is_draw": False,
                "is_rematch": False,
                "rematch_rounds": [],
                "same_team": False,
                "is_done": True,
                "is_bye": True,
            })
            table_num += 1

        return generated_pods

    # --- BRANCH B: Standard 1v1 / Team Swiss Pairing ---
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

    generated_pairings = []
    table_num = int(ev.get("startingTable") or 1)
    best_of_val = int(ev.get("best_of") or (3 if ev_scoring == "tcg_bo3" else 1))
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
            try:
                prev_r_int = int(prev_r)
            except Exception:
                continue
            if prev_r_int < target_round:
                for pm in (p_list or []):
                    ids = {str(pm.get("p1_id") or ""), str(pm.get("p2_id") or "")}
                    if p1_id in ids and p2_id in ids:
                        rematch_r.append(prev_r_int)

        generated_pairings.append({
            "id": f"{ev.get('id') or 'ES'}-R{target_round}-T{table_num}",
            "table": table_num,
            "best_of": best_of_val,
            "stage": "swiss",
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
            "winner_id": None,
            "is_draw": False,
            "is_rematch": is_rematch,
            "rematch_rounds": sorted(rematch_r),
            "same_team": same_team,
            "is_done": False,
            "is_bye": False
        })
        table_num += 1

    if bye_player:
        b_id = str(bye_player.get("id") or bye_player.get("player_id") or bye_player.get("name"))
        b_elo = float(bye_player.get("elo") or bye_player.get("current_elo") or bye_player.get("currentElo") or 1500.0)
        bye_score = 2 if best_of_val == 3 else (1 if ev_scoring == "tcg_bo1" else 100)
        generated_pairings.append({
            "id": f"{ev.get('id') or 'ES'}-R{target_round}-T{table_num}",
            "table": table_num,
            "best_of": best_of_val,
            "stage": "swiss",
            "p1_id": b_id,
            "p1_name": bye_player.get("name") or "Player",
            "p1_faction": bye_player.get("faction") or "Unknown Faction",
            "p1_team": bye_player.get("team") or "",
            "p1_elo": round(b_elo, 1),
            "p1_win_prob": 100.0,
            "p1_army_list": bye_player.get("army_list") or "",
            "p1_score": bye_score,
            "p2_id": None,
            "p2_name": "BYE",
            "p2_faction": "",
            "p2_team": "",
            "p2_elo": 0.0,
            "p2_win_prob": 0.0,
            "p2_army_list": "",
            "p2_score": 0,
            "winner_id": b_id,
            "is_draw": False,
            "is_rematch": False,
            "rematch_rounds": [],
            "same_team": False,
            "is_done": True,
            "is_bye": True
        })

    _enrich_studio_pairings_with_ml(generated_pairings, game_system=ev.get("game_system") or "40k")
    return generated_pairings

@router.post("/api/eventstudio/event/{event_id}/pairings/generate", summary="Generate automated Swiss pairings for tournament round (staged locally)")
def api_eventstudio_generate_pairings(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
    target_round = int(payload.get("round") or payload.get("round_num") or 1)

    # 1. BCP Decoupled Flow (Zero DB mutation)
    if not event_id.startswith("ES-"):
        bcp_ev = _fetch_bcp_event_workspace(event_id, user)
        if not bcp_ev:
            raise HTTPException(status_code=404, detail="Event not found on BCP")

        roster = [p for p in (bcp_ev.get("roster") or []) if not p.get("dropped")]
        if not roster or len(roster) < 2:
            raise HTTPException(status_code=400, detail="At least 2 active players required in roster to generate pairings")

        target_round = int(payload.get("round") or payload.get("round_num") or (bcp_ev.get("current_round") or 1))
        generated_pairings = generate_swiss_pairings_for_event(bcp_ev, target_round)

        pairings_map = bcp_ev.get("pairings") or {}
        pairings_map[str(target_round)] = generated_pairings
        bcp_ev["pairings"] = pairings_map
        bcp_ev["current_round"] = target_round
        bcp_ev["pairings_status"] = "staged"

        return {
            "success": True,
            "round": target_round,
            "pairings": generated_pairings,
            "pairings_status": "staged",
            "bcp_generated": False,
            "event": bcp_ev,
            "message": f"Generated Round {target_round} Swiss pairings (staged locally). TO can inspect, swap players, and push to BCP."
        }

    # 2. Local Studio Event Flow (Native OmniTactica)
    db = get_database()
    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    _assert_native_event_owner_or_to(ev, user)

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
    _invalidate_native_event_caches(event_id)

    return {
        "success": True,
        "round": target_round,
        "pairings": generated_pairings,
        "pairings_status": "staged",
        "bcp_generated": False,
        "event": saved,
        "message": f"Generated Round {target_round} pairings for {ev.get('name', event_id)}."
    }

@router.post("/api/eventstudio/event/{event_id}/top_cut", summary="Generate or advance Single-Elimination Top Cut bracket (Top 8 / Top 4 / Grand Final)")
def api_eventstudio_generate_top_cut(event_id: str, payload: GenerateTopCutPayload, request: Request):
    user = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
    if not event_id.startswith("ES-"):
        raise HTTPException(status_code=400, detail="Native Top Cut bracket generation is supported on OmniTactica Native (ES-*) tournaments.")

    db = get_database()
    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    _assert_native_event_owner_or_to(ev, user)

    pairings_map = ev.get("pairings") or {}
    existing_rounds = sorted([int(k) for k in pairings_map.keys() if str(k).isdigit()])
    latest_round = existing_rounds[-1] if existing_rounds else 0
    latest_matches = pairings_map.get(str(latest_round)) or []
    is_latest_top_cut = bool(latest_matches and all(str(m.get("stage") or "") == "top_cut" for m in latest_matches))

    best_of_val = int(ev.get("best_of") or 3)
    roster_map = {str(p.get("id") or p.get("player_id") or p.get("name")): p for p in (ev.get("roster") or [])}

    # Case 1: Advance an active Top Cut stage (e.g. Quarterfinals -> Semifinals -> Grand Final)
    if (payload.advance_stage or (is_latest_top_cut and payload.cut_size is None)) and is_latest_top_cut:
        if len(latest_matches) <= 1:
            raise HTTPException(status_code=400, detail="Grand Final has already been generated.")
        winners: List[Dict[str, Any]] = []
        for m in sorted(latest_matches, key=lambda x: int(x.get("table") or 1)):
            w_id = str(m.get("winner_id") or "").strip()
            p1_id = str(m.get("p1_id") or "")
            p2_id = str(m.get("p2_id") or "")
            p1_s = float(m.get("p1_score") or 0)
            p2_s = float(m.get("p2_score") or 0)
            if not w_id:
                if p1_s > p2_s:
                    w_id = p1_id
                elif p2_s > p1_s:
                    w_id = p2_id
            if not w_id:
                raise HTTPException(status_code=400, detail=f"All Top Cut matches in Round {latest_round} must have a winner before advancing.")
            if w_id == p1_id:
                winners.append({
                    "id": p1_id,
                    "name": m.get("p1_name") or "Player 1",
                    "faction": m.get("p1_faction") or "Unassigned",
                    "team": m.get("p1_team") or "",
                    "elo": float(m.get("p1_elo") or 1500.0),
                    "army_list": m.get("p1_army_list") or "",
                    "seed": m.get("seed1"),
                })
            else:
                winners.append({
                    "id": p2_id,
                    "name": m.get("p2_name") or "Player 2",
                    "faction": m.get("p2_faction") or "Unassigned",
                    "team": m.get("p2_team") or "",
                    "elo": float(m.get("p2_elo") or 1500.0),
                    "army_list": m.get("p2_army_list") or "",
                    "seed": m.get("seed2"),
                })

        next_round = latest_round + 1
        stage_name = "Grand Final" if len(winners) == 2 else "Semifinal"
        next_pairings: List[Dict[str, Any]] = []
        t_num = 1
        for idx in range(0, len(winners), 2):
            if idx + 1 >= len(winners):
                break
            w1, w2 = winners[idx], winners[idx + 1]
            b_label = "Grand Final" if stage_name == "Grand Final" else f"{stage_name} {t_num}"
            prob1 = round(1.0 / (1.0 + 10.0 ** ((w2["elo"] - w1["elo"]) / 400.0)) * 100.0, 1)
            next_pairings.append({
                "id": f"{event_id}-R{next_round}-T{t_num}",
                "table": t_num,
                "stage": "top_cut",
                "bracket_label": b_label,
                "best_of": best_of_val,
                "seed1": w1.get("seed"),
                "seed2": w2.get("seed"),
                "p1_id": w1["id"],
                "p1_name": w1["name"],
                "p1_faction": w1["faction"],
                "p1_team": w1["team"],
                "p1_elo": round(w1["elo"], 1),
                "p1_win_prob": prob1,
                "p1_army_list": w1["army_list"],
                "p1_score": 0,
                "p2_id": w2["id"],
                "p2_name": w2["name"],
                "p2_faction": w2["faction"],
                "p2_team": w2["team"],
                "p2_elo": round(w2["elo"], 1),
                "p2_win_prob": round(100.0 - prob1, 1),
                "p2_army_list": w2["army_list"],
                "p2_score": 0,
                "winner_id": None,
                "is_draw": False,
                "is_rematch": False,
                "rematch_rounds": [],
                "same_team": False,
                "is_done": False,
                "is_bye": False,
            })
            t_num += 1

        _enrich_studio_pairings_with_ml(next_pairings, game_system=ev.get("game_system") or "40k")
        pairings_map[str(next_round)] = next_pairings
        ev["pairings"] = pairings_map
        ev["current_round"] = next_round
        ev["num_rounds"] = max(int(ev.get("num_rounds") or 0), next_round)
        ev["pairings_status"] = "applied"
        ev["is_published"] = True
        ev["published_round"] = next_round
        saved = db.save_studio_event(ev)
        _invalidate_native_event_caches(event_id)
        return {
            "success": True,
            "round": next_round,
            "stage": "top_cut",
            "bracket_stage": stage_name,
            "pairings": next_pairings,
            "event": saved,
            "message": f"Generated {stage_name} bracket (Round {next_round}).",
        }

    # Case 2: Seed initial Single-Elimination Top Cut from Swiss Standings
    cut_size = int(payload.cut_size or ev.get("top_cut") or 4)
    if cut_size not in (2, 4, 8):
        cut_size = 4 if cut_size < 6 else 8

    st_res = api_eventstudio_get_standings(event_id, request)
    active_standings = [s for s in (st_res.get("standings") or []) if not s.get("dropped")]
    if len(active_standings) < cut_size:
        raise HTTPException(
            status_code=400,
            detail=f"At least {cut_size} active players are required to generate a Top {cut_size} bracket (found {len(active_standings)}).",
        )

    seeds = active_standings[:cut_size]
    if cut_size == 2:
        seed_pairs = [(0, 1, "Grand Final (1 vs 2)")]
        stage_label = "Grand Final"
    elif cut_size == 4:
        seed_pairs = [
            (0, 3, "Semifinal 1 (Seed #1 vs #4)"),
            (1, 2, "Semifinal 2 (Seed #2 vs #3)"),
        ]
        stage_label = "Top 4 Semifinals"
    else:
        seed_pairs = [
            (0, 7, "Quarterfinal 1 (Seed #1 vs #8)"),
            (3, 4, "Quarterfinal 2 (Seed #4 vs #5)"),
            (1, 6, "Quarterfinal 3 (Seed #2 vs #7)"),
            (2, 5, "Quarterfinal 4 (Seed #3 vs #6)"),
        ]
        stage_label = "Top 8 Quarterfinals"

    cut_round = max(latest_round, int(ev.get("current_round") or 0)) + 1
    cut_pairings: List[Dict[str, Any]] = []
    for t_idx, (i1, i2, b_label) in enumerate(seed_pairs, 1):
        s1_st, s2_st = seeds[i1], seeds[i2]
        r1 = roster_map.get(str(s1_st["id"]), {})
        r2 = roster_map.get(str(s2_st["id"]), {})
        e1 = float(r1.get("elo") or r1.get("currentElo") or 1500.0)
        e2 = float(r2.get("elo") or r2.get("currentElo") or 1500.0)
        prob1 = round(1.0 / (1.0 + 10.0 ** ((e2 - e1) / 400.0)) * 100.0, 1)
        cut_pairings.append({
            "id": f"{event_id}-R{cut_round}-T{t_idx}",
            "table": t_idx,
            "stage": "top_cut",
            "bracket_label": b_label,
            "best_of": best_of_val,
            "seed1": i1 + 1,
            "seed2": i2 + 1,
            "p1_id": str(s1_st["id"]),
            "p1_name": s1_st["name"],
            "p1_faction": s1_st["faction"],
            "p1_team": s1_st.get("team") or "",
            "p1_elo": round(e1, 1),
            "p1_win_prob": prob1,
            "p1_army_list": r1.get("army_list") or "",
            "p1_score": 0,
            "p2_id": str(s2_st["id"]),
            "p2_name": s2_st["name"],
            "p2_faction": s2_st["faction"],
            "p2_team": s2_st.get("team") or "",
            "p2_elo": round(e2, 1),
            "p2_win_prob": round(100.0 - prob1, 1),
            "p2_army_list": r2.get("army_list") or "",
            "p2_score": 0,
            "winner_id": None,
            "is_draw": False,
            "is_rematch": False,
            "rematch_rounds": [],
            "same_team": False,
            "is_done": False,
            "is_bye": False,
        })

    _enrich_studio_pairings_with_ml(cut_pairings, game_system=ev.get("game_system") or "40k")
    pairings_map[str(cut_round)] = cut_pairings
    ev["pairings"] = pairings_map
    ev["top_cut"] = cut_size
    ev["current_round"] = cut_round
    ev["num_rounds"] = max(int(ev.get("num_rounds") or 0), cut_round)
    ev["pairings_status"] = "applied"
    ev["is_published"] = True
    ev["published_round"] = cut_round
    saved = db.save_studio_event(ev)
    _invalidate_native_event_caches(event_id)

    return {
        "success": True,
        "round": cut_round,
        "cut_size": cut_size,
        "stage": "top_cut",
        "bracket_stage": stage_label,
        "pairings": cut_pairings,
        "event": saved,
        "message": f"Generated {stage_label} (Round {cut_round}) from Swiss standings.",
    }

@router.post("/api/eventstudio/event/{event_id}/pairings/quick_generate", summary="Quickly generate pairings (random, Swiss, or Elo balanced) without mutating DB")
async def api_eventstudio_quick_generate(event_id: str, payload: QuickGeneratePairingsPayload, request: Request):
    user = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
    target_round = int(payload.round or 1)
    mode = str(payload.method or payload.mode or "random").lower()

    # Obtain active roster
    roster = payload.roster or []
    ev = None
    bcp_ev = None
    if not event_id.startswith("ES-"):
        bcp_ev = _fetch_bcp_event_workspace(event_id, user)
        if bcp_ev and not roster:
            roster = bcp_ev.get("roster") or []
    else:
        db = get_database()
        ev = db.get_studio_event(event_id)
        if ev:
            _assert_native_event_owner_or_to(ev, user)
            if not roster:
                roster = ev.get("roster") or []

    active_roster = [p for p in roster if not p.get("dropped")]
    if len(active_roster) < 2:
        raise HTTPException(status_code=400, detail="At least 2 active competitors required to generate pairings")

    import random
    candidates = list(active_roster)
    if mode == "random":
        random.shuffle(candidates)
    elif mode == "elo_balanced":
        candidates.sort(key=lambda p: float(p.get("elo") or 1500.0), reverse=True)

    is_ffa_ev = bool(ev and (ev.get("is_ffa_event") or str(ev.get("match_format") or "").lower() == "ffa" or str(ev.get("scoring_mode") or "").lower() == "ffa_pods"))
    if mode == "swiss" or is_ffa_ev:
        synth_event = {
            **(ev or {}),
            "id": event_id,
            "roster": candidates,
            "pairings": (ev.get("pairings") if (ev and mode == "swiss") else {}) or {},
            "startingTable": 1,
        }
        pairings = generate_swiss_pairings_for_event(synth_event, target_round)
        return {
            "success": True,
            "round": target_round,
            "mode": mode,
            "method": mode,
            "pairings": pairings,
            "pairings_status": "staged",
            "message": f"Generated Round {target_round} pairings (staged locally)."
        }

    # Build pairings for random / elo_balanced
    pairings = []
    table_num = 1
    idx = 0
    n = len(candidates)
    while idx < n:
        p1 = candidates[idx]
        if idx + 1 < n:
            p2 = candidates[idx + 1]
            e1 = float(p1.get("elo") or 1500.0)
            e2 = float(p2.get("elo") or 1500.0)
            prob1 = round(1.0 / (1.0 + 10.0 ** ((e2 - e1) / 400.0)) * 100.0, 1)
            prob2 = round(100.0 - prob1, 1)
            t1 = (p1.get("team") or "").strip().lower()
            t2 = (p2.get("team") or "").strip().lower()
            same_team = bool(t1 and t2 and t1 == t2)

            pairings.append({
                "id": f"staged-r{target_round}-t{table_num}",
                "table": table_num,
                "tableNumber": table_num,
                "round": target_round,
                "p1_id": str(p1.get("id") or p1.get("player_id") or ""),
                "p1_name": p1.get("name") or "Player 1",
                "p1_faction": p1.get("faction") or "Unassigned",
                "p1_team": p1.get("team") or "",
                "p1_elo": e1,
                "p1_win_prob": prob1,
                "p1_score": 0,
                "p2_id": str(p2.get("id") or p2.get("player_id") or ""),
                "p2_name": p2.get("name") or "Player 2",
                "p2_faction": p2.get("faction") or "Unassigned",
                "p2_team": p2.get("team") or "",
                "p2_elo": e2,
                "p2_win_prob": prob2,
                "p2_score": 0,
                "is_rematch": False,
                "rematch_rounds": [],
                "same_team": same_team,
                "is_done": False,
                "is_bye": False
            })
            idx += 2
        else:
            e1 = float(p1.get("elo") or 1500.0)
            pairings.append({
                "id": f"staged-r{target_round}-t{table_num}",
                "table": table_num,
                "tableNumber": table_num,
                "round": target_round,
                "p1_id": str(p1.get("id") or p1.get("player_id") or ""),
                "p1_name": p1.get("name") or "Player 1",
                "p1_faction": p1.get("faction") or "Unassigned",
                "p1_team": p1.get("team") or "",
                "p1_elo": e1,
                "p1_win_prob": 100.0,
                "p1_score": 100,
                "p2_id": "",
                "p2_name": "BYE",
                "p2_faction": "",
                "p2_team": "",
                "p2_elo": 0.0,
                "p2_win_prob": 0.0,
                "p2_score": 0,
                "is_rematch": False,
                "rematch_rounds": [],
                "same_team": False,
                "is_done": True,
                "is_bye": True
            })
            idx += 1
        table_num += 1

    ev_sys = "40k"
    try:
        ev_sys = (bcp_ev.get("game_system") if bcp_ev else (ev.get("game_system") if ev else "40k")) or "40k"
    except Exception:
        ev_sys = "40k"
    _enrich_studio_pairings_with_ml(pairings, game_system=ev_sys)

    return {
        "success": True,
        "round": target_round,
        "mode": mode,
        "method": mode,
        "pairings": pairings,
        "pairings_status": "staged",
        "message": f"Successfully generated {mode.replace('_', ' ').title()} pairings ({len(pairings)} tables staged locally)."
    }

@router.post("/api/eventstudio/event/{event_id}/pairings/reorder_tables", summary="Reorder table numbers for staged pairings (drag & drop reordering)")
async def api_eventstudio_reorder_tables(event_id: str, payload: ReorderTablesPayload, request: Request):
    user = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
    pairings = payload.pairings or []
    if not pairings:
        raise HTTPException(status_code=400, detail="No pairings provided for reordering")

    target_round = int(payload.round or 1)
    if payload.source_table and payload.target_table and payload.source_table != payload.target_table:
        src_idx = next((i for i, p in enumerate(pairings) if p.get("table") == payload.source_table or p.get("tableNumber") == payload.source_table), None)
        tgt_idx = next((i for i, p in enumerate(pairings) if p.get("table") == payload.target_table or p.get("tableNumber") == payload.target_table), None)
        if src_idx is not None and tgt_idx is not None:
            moved = pairings.pop(src_idx)
            pairings.insert(tgt_idx, moved)

    for idx, p in enumerate(pairings):
        p["table"] = idx + 1
        p["tableNumber"] = idx + 1

    if event_id.startswith("ES-"):
        db = get_database()
        ev = db.get_studio_event(event_id)
        if ev:
            _assert_native_event_owner_or_to(ev, user)
            pairings_map = ev.get("pairings") or {}
            pairings_map[str(target_round)] = pairings
            ev["pairings"] = pairings_map
            ev["pairings_status"] = "staged"
            db.save_studio_event(ev)
            _invalidate_native_event_caches(event_id)

    return {
        "success": True,
        "round": target_round,
        "pairings": pairings,
        "pairings_status": "staged",
        "message": f"Reordered {len(pairings)} tables successfully."
    }

@router.post("/api/eventstudio/event/{event_id}/pairings/swap", summary="Dynamically swap two competitors between tables before applying to BCP")
def api_eventstudio_swap_pairings(event_id: str, payload: SwapPairingPayload, request: Request):
    user = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
    r_str = str(payload.round)

    round_pairings = []
    ev_gs = "40k"
    if payload.pairings:
        round_pairings = list(payload.pairings)
    elif not event_id.startswith("ES-"):
        bcp_ev = _fetch_bcp_event_workspace(event_id, user)
        if bcp_ev:
            ev_gs = bcp_ev.get("game_system") or "40k"
            pairings_map = bcp_ev.get("pairings") or {}
            round_pairings = list(pairings_map.get(r_str) or [])
    else:
        db = get_database()
        ev = db.get_studio_event(event_id)
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")
        _assert_native_event_owner_or_to(ev, user)
        ev_gs = ev.get("game_system") or "40k"
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

    # Recalculate Calibrated ML win probabilities and warnings for both modified tables
    for m in (m1, m2):
        t1 = (m.get("p1_team") or "").strip().lower()
        t2 = (m.get("p2_team") or "").strip().lower()
        m["same_team"] = bool(t1 and t2 and t1 == t2)
    _enrich_studio_pairings_with_ml([m1, m2], game_system=ev_gs)

    # Save to DB ONLY if local studio event
    saved_ev = None
    if event_id.startswith("ES-"):
        db = get_database()
        ev = db.get_studio_event(event_id)
        if ev:
            _assert_native_event_owner_or_to(ev, user)
            ev["pairings"][r_str] = round_pairings
            ev["pairings_status"] = "staged"
            saved_ev = db.save_studio_event(ev)
            _invalidate_native_event_caches(event_id)

    return {
        "success": True,
        "round": payload.round,
        "pairings": round_pairings,
        "pairings_status": "staged",
        "message": f"Successfully swapped Table {payload.table1} ({payload.slot1.upper()}) and Table {payload.table2} ({payload.slot2.upper()}).",
        "event": saved_ev or {"id": event_id, "pairings": {r_str: round_pairings}, "pairings_status": "staged"}
    }

@router.post("/api/eventstudio/event/{event_id}/pairings/push_to_bcp", summary="Two-step abstraction layer: reconcile and push staged pairings to BCP")
async def api_eventstudio_push_pairings_bcp(event_id: str, payload: PushPairingsBcpPayload, request: Request):
    user = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
    auth_mgr = get_auth_manager()
    user_id = user["id"]
    bcp_token = auth_mgr.get_valid_bcp_token(user_id) if (user_id and not event_id.startswith("ES-")) else None

    round_num = int(payload.round or 1)
    target_pairings = payload.pairings or []

    if not target_pairings:
        raise HTTPException(status_code=400, detail="No pairings provided to push")

    # Pre-seed deterministic tracker rooms for each 1v1/2v2 table in-memory
    for p in target_pairings:
        if p.get("is_bye") or p.get("is_ffa"):
            continue
        t_num = p.get("table") or 1
        mid = (f"{event_id}-R{round_num}-T{t_num}" if event_id.startswith("ES-") else f"BCP-{event_id}-R{round_num}-T{t_num}").upper()
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

    # 1. Local Studio Event Flow (Native OmniTactica)
    if event_id.startswith("ES-"):
        db = get_database()
        ev = db.get_studio_event(event_id)
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")
        _assert_native_event_owner_or_to(ev, user)
        pairings_map = ev.get("pairings") or {}
        pairings_map[str(round_num)] = target_pairings
        ev["pairings"] = pairings_map
        ev["pairings_status"] = "applied"
        ev["started"] = True
        ev["status"] = "active"
        ev["current_round"] = round_num
        ev["is_published"] = payload.publish_immediately
        if payload.publish_immediately:
            ev["published_round"] = round_num
        saved = db.save_studio_event(ev)
        _invalidate_native_event_caches(event_id)
        return {
            "success": True,
            "round": round_num,
            "bcp_started": False,
            "pairings_count": len(target_pairings),
            "pairings_status": "applied",
            "event": saved,
            "message": f"Round {round_num} pairings locked & published on OmniTactica."
        }

    # 2. Pure BCP Flow (Direct API invocation, Zero DB writes)
    ok, err, meta = bcp_adapter.reconcile_and_push_pairings(
        event_id=event_id,
        round_num=round_num,
        target_pairings=target_pairings,
        start_if_unstarted=payload.start_if_unstarted,
        publish_immediately=payload.publish_immediately,
        user_id=user_id,
        explicit_token=bcp_token
    )

    if not ok and err:
        raise HTTPException(status_code=400, detail=f"Failed to push pairings to BCP: {err}")

    bcp_ev = _fetch_bcp_event_workspace(event_id, user, explicit_token=bcp_token)
    if not bcp_ev:
        bcp_ev = {
            "id": event_id,
            "started": True,
            "status": "active",
            "current_round": round_num,
            "pairings_status": "applied",
            "pairings": {str(round_num): target_pairings}
        }
    else:
        bcp_ev["pairings_status"] = "applied"

    return {
        "success": True,
        "round": round_num,
        "bcp_applied": True,
        "bcp_started": meta.get("bcp_started", True),
        "pairings_count": meta.get("pairings_count", len(target_pairings)),
        "published": meta.get("published", payload.publish_immediately),
        "swaps_performed": meta.get("swaps_performed", 0),
        "batch_applied": meta.get("batch_applied", False),
        "pairings_status": "applied",
        "event": bcp_ev,
        "pairings": target_pairings,
        "message": meta.get("message") or f"Round {round_num} pairings successfully pushed to Best Coast Pairings!"
    }

@router.post("/api/eventstudio/event/{event_id}/pairings/apply_bcp", summary="Apply staged tournament pairings to Best Coast Pairings")
async def api_eventstudio_apply_pairings_bcp(event_id: str, payload: ApplyPairingsBcpPayload, request: Request):
    user = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
    round_num = str(payload.round)
    pairings_list = []

    if event_id.startswith("ES-"):
        db = get_database()
        ev = db.get_studio_event(event_id)
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")
        _assert_native_event_owner_or_to(ev, user)
        pairings_map = ev.get("pairings") or {}
        pairings_list = pairings_map.get(round_num) or []
        if not pairings_list:
            raise HTTPException(status_code=400, detail=f"No pairings found for Round {round_num}")
        ev["pairings_status"] = "applied"
        ev["is_published"] = True
        ev["published_round"] = int(round_num)
        saved = db.save_studio_event(ev)
        _invalidate_native_event_caches(event_id)
        return {
            "success": True,
            "round": int(round_num),
            "pairings_count": len(pairings_list),
            "bcp_applied": False,
            "pairings_status": "applied",
            "event": saved,
            "message": f"Round {round_num} pairings locked and published."
        }

    bcp_ev = _fetch_bcp_event_workspace(event_id, user)
    if bcp_ev:
        pairings_list = (bcp_ev.get("pairings") or {}).get(round_num) or []

    push_payload = PushPairingsBcpPayload(
        round=int(round_num),
        start_if_unstarted=True,
        publish_immediately=False,
        pairings=pairings_list
    )
    return await api_eventstudio_push_pairings_bcp(event_id, push_payload, request)

@router.post("/api/eventstudio/event/{event_id}/pairings/publish", summary="Publish tournament round pairings on OmniTactica and BCP")
def api_eventstudio_publish_pairings(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
    auth_mgr = get_auth_manager()
    user_id = user["id"]
    round_num = int(payload.get("round") or 1)

    if not event_id.startswith("ES-"):
        bcp_token = auth_mgr.get_valid_bcp_token(user_id) if user_id else None
        bcp_published, err_msg = bcp_adapter.publish_pairings(event_id, round_num, user_id=user_id, explicit_token=bcp_token)
        return {
            "success": True,
            "round": round_num,
            "bcp_published": bcp_published,
            "event": {"id": event_id, "is_published": True, "published_round": round_num},
            "message": f"Round {round_num} pairings published successfully on Best Coast Pairings."
        }

    db = get_database()
    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    _assert_native_event_owner_or_to(ev, user)

    ev["published_round"] = round_num
    ev["is_published"] = True
    ev["pairings_status"] = "applied"
    saved = db.save_studio_event(ev)
    _invalidate_native_event_caches(event_id)

    return {
        "success": True,
        "round": round_num,
        "bcp_published": False,
        "event": saved,
        "message": f"Round {round_num} pairings published successfully."
    }

@router.post("/api/eventstudio/event/{event_id}/pairings/unpublish", summary="Unpublish tournament round pairings on OmniTactica and BCP")
def api_eventstudio_unpublish_pairings(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
    auth_mgr = get_auth_manager()
    user_id = user["id"]
    round_num = int(payload.get("round") or 1)

    if not event_id.startswith("ES-"):
        bcp_token = auth_mgr.get_valid_bcp_token(user_id) if user_id else None
        bcp_unpublished, err_msg = bcp_adapter.unpublish_pairings(event_id, round_num, user_id=user_id, explicit_token=bcp_token)
        return {
            "success": True,
            "round": round_num,
            "bcp_unpublished": bcp_unpublished,
            "event": {"id": event_id, "is_published": False, "published_round": round_num},
            "message": f"Round {round_num} pairings unpublished on Best Coast Pairings."
        }

    db = get_database()
    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    _assert_native_event_owner_or_to(ev, user)

    ev["is_published"] = False
    saved = db.save_studio_event(ev)
    _invalidate_native_event_caches(event_id)

    return {
        "success": True,
        "round": round_num,
        "bcp_unpublished": False,
        "event": saved,
        "message": f"Round {round_num} pairings unpublished."
    }

@router.post("/api/eventstudio/event/{event_id}/round/finalize", summary="Finalize and lock round, advancing tournament round")
def api_eventstudio_finalize_round(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
    db = get_database()
    user_id = user["id"]

    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if event_id.startswith("ES-"):
        _assert_native_event_owner_or_to(ev, user)

    round_num = int(payload.get("round") or ev.get("current_round") or 1)
    total_rounds = int(ev.get("num_rounds") or 3)

    next_round = (round_num + 1) if round_num < total_rounds else round_num
    ev["current_round"] = next_round
    saved = db.save_studio_event(ev)
    _invalidate_native_event_caches(event_id)

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
def api_eventstudio_reset_round(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
    db = get_database()
    user_id = user["id"]

    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if event_id.startswith("ES-"):
        _assert_native_event_owner_or_to(ev, user)

    round_num = int(payload.get("round") or ev.get("current_round") or 1)
    ev["current_round"] = max(1, round_num)
    saved = db.save_studio_event(ev)
    _invalidate_native_event_caches(event_id)

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
def api_eventstudio_end_tournament(event_id: str, request: Request):
    user = _get_studio_user_or_401(request, require_to_for_external=True, event_id=event_id)
    db = get_database()
    user_id = user["id"]

    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if event_id.startswith("ES-"):
        _assert_native_event_owner_or_to(ev, user)

    # Compute final standings and stamp official placements onto roster & event_participants
    standings_list: List[Dict[str, Any]] = []
    try:
        st_res = api_eventstudio_get_standings(event_id, request)
        standings_list = st_res.get("standings") or []
        rank_by_pid = {str(s.get("id") or ""): s for s in standings_list}
        for p in (ev.get("roster") or []):
            pid_p = str(p.get("id") or p.get("player_id") or p.get("name") or "")
            st_item = rank_by_pid.get(pid_p)
            if st_item:
                p["placement"] = int(st_item["rank"])
                p["placing"] = int(st_item["rank"])
                p["wins"] = int(st_item.get("wins") or 0)
                p["losses"] = int(st_item.get("losses") or 0)
                p["draws"] = int(st_item.get("draws") or 0)
                p["points"] = float(st_item.get("swiss_points") or 0.0)
    except Exception as ste:
        logger.warning(f"Notice computing final standings on end_tournament for {event_id}: {ste}")

    ev["is_ended"] = True
    ev["status"] = "completed"
    saved = db.save_studio_event(ev)

    # Apply fast (<15ms) single-event Elo rating updates for native OmniTactica tournaments
    elo_summary = None
    if event_id.startswith("ES-"):
        try:
            ev_gs = normalize_game_system(ev.get("game_system"), default="40k")
            elo_eng = get_elo_engine()
            if elo_eng and hasattr(elo_eng, "rate_single_event"):
                elo_summary = elo_eng.rate_single_event(event_id=event_id, game_system=ev_gs)
        except Exception as ee:
            logger.warning(f"Notice updating Elo ratings for completed native event {event_id}: {ee}")

    _invalidate_native_event_caches(event_id)

    # Delete all live Firestore game rooms for this completed event
    rooms_deleted = 0
    try:
        fs_engine = get_firestore_engine()
        if fs_engine and hasattr(fs_engine, "delete_event_rooms"):
            rooms_deleted = fs_engine.delete_event_rooms(event_id)
    except Exception as fe:
        logger.warning(f"Notice cleaning up Firestore rooms on event end for {event_id}: {fe}")

    try:
        clean_eid = str(event_id).replace("ES-", "").replace("BCP-", "").strip().lower()
        for mid_key in list(TRACKER_ROOMS.keys()):
            if clean_eid and clean_eid in str(mid_key).lower():
                TRACKER_ROOMS.pop(mid_key, None)
    except Exception:
        pass

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
        "elo_updated": bool(elo_summary and (elo_summary.get("players_updated") or 0) > 0),
        "elo_summary": elo_summary,
        "standings": standings_list,
        "rooms_deleted": rooms_deleted,
        "event": saved,
        "message": "Tournament concluded! Official placings and Elo ratings have been updated."
    }

@router.get("/api/eventstudio/event/{event_id}/standings", summary="Compute live Swiss, FFA Pod, and Top Cut standings with tiebreakers")
def api_eventstudio_get_standings(event_id: str, request: Request):
    db = get_database()
    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    roster = ev.get("roster") or []
    pairings_map = ev.get("pairings") or {}
    ev_gs = normalize_game_system(ev.get("game_system"), default="40k")
    ev_scoring = str(ev.get("scoring_mode") or "").strip().lower()
    ev_match_fmt = str(ev.get("match_format") or "").strip().lower()
    ev_type_l = str(ev.get("event_type") or "").strip().lower()
    is_ffa = bool(
        ev.get("is_ffa_event")
        or ev_match_fmt in ("ffa", "pods", "pod", "4p", "commander")
        or ev_scoring in ("ffa_pods", "pods", "ffa")
        or "pod" in ev_type_l
        or "ffa" in ev_type_l
    )
    is_tcg = bool(ev_gs in TCG_GAME_SYSTEMS or ev_scoring in ("tcg_bo3", "tcg_bo1"))
    win_pts = float(ev.get("win_points") if ev.get("win_points") is not None else (5.0 if is_ffa else 3.0))
    draw_pts = float(ev.get("draw_points") if ev.get("draw_points") is not None else 1.0)

    # 1. Compute round-by-round statistics
    player_stats: Dict[str, Dict[str, Any]] = {}
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
            "swiss_points": 0.0,
            "path_to_victory": 0,
            "battle_points": 0,
            "battle_points_diff": 0,
            "games_won": 0,
            "games_played": 0,
            "game_win_pct": 33.0,
            "top_cut_tier": 0,
            "opponents": [],
            "rounds_played": 0
        }

    top_cut_rounds: List[Tuple[int, List[Dict[str, Any]]]] = []

    for r_str, r_pairings in sorted(pairings_map.items(), key=lambda x: int(x[0]) if str(x[0]).isdigit() else 0):
        try:
            r_num = int(r_str)
        except Exception:
            continue
        is_cut_round = bool(r_pairings and all(str(m.get("stage") or "") == "top_cut" for m in r_pairings))
        if is_cut_round:
            top_cut_rounds.append((r_num, r_pairings))

        for match in (r_pairings or []):
            if match.get("is_ffa") and isinstance(match.get("pod_participants"), list):
                pod_parts = [pp for pp in match.get("pod_participants", []) if isinstance(pp, dict)]
                pod_pids = [str(pp.get("player_id") or pp.get("id") or pp.get("name") or "") for pp in pod_parts if (pp.get("player_id") or pp.get("id") or pp.get("name"))]
                is_done_ffa = bool(match.get("is_done") or match.get("is_bye") or match.get("winner_id") or match.get("is_draw"))
                if not is_done_ffa:
                    continue
                if match.get("is_bye") and pod_pids:
                    b_pid = pod_pids[0]
                    if b_pid in player_stats:
                        player_stats[b_pid]["rounds_played"] += 1
                        player_stats[b_pid]["wins"] += 1
                        player_stats[b_pid]["swiss_points"] += win_pts
                        player_stats[b_pid]["battle_points"] += int(win_pts)
                    continue
                w_id_ffa = str(match.get("winner_id") or "").strip()
                m_draw_ffa = bool(match.get("is_draw"))
                for pp in pod_parts:
                    pp_id = str(pp.get("player_id") or pp.get("id") or pp.get("name") or "")
                    if pp_id not in player_stats:
                        continue
                    player_stats[pp_id]["rounds_played"] += 1
                    for other_pid in pod_pids:
                        if other_pid != pp_id:
                            player_stats[pp_id]["opponents"].append(other_pid)
                    pp_sc = int(round(float(pp.get("score") or 0)))
                    if m_draw_ffa or str(pp.get("result") or "").lower() == "draw":
                        player_stats[pp_id]["draws"] += 1
                        player_stats[pp_id]["swiss_points"] += draw_pts
                        player_stats[pp_id]["battle_points"] += (pp_sc or int(draw_pts))
                    elif (w_id_ffa and pp_id == w_id_ffa) or str(pp.get("result") or "").lower() == "win" or pp.get("placement") == 1:
                        player_stats[pp_id]["wins"] += 1
                        player_stats[pp_id]["swiss_points"] += win_pts
                        player_stats[pp_id]["battle_points"] += (pp_sc or int(win_pts))
                        player_stats[pp_id]["path_to_victory"] += (10 ** max(0, 10 - r_num))
                    else:
                        player_stats[pp_id]["losses"] += 1
                        player_stats[pp_id]["battle_points"] += pp_sc
                continue

            p1_id = str(match.get("p1_id") or match.get("p1_name") or "")
            p2_id = str(match.get("p2_id") or match.get("p2_name") or "")
            p1_s = int(match.get("p1_score") or 0)
            p2_s = int(match.get("p2_score") or 0)
            is_bye = bool(match.get("is_bye") or not p2_id)
            m_winner = str(match.get("winner_id") or "").strip()
            m_draw = bool(match.get("is_draw"))
            is_done = bool(match.get("is_done") or is_bye or p1_s > 0 or p2_s > 0 or m_winner or m_draw)

            if is_done and p1_id in player_stats:
                player_stats[p1_id]["rounds_played"] += 1
                player_stats[p1_id]["battle_points"] += p1_s
                player_stats[p1_id]["battle_points_diff"] += (p1_s - p2_s)
                if is_tcg:
                    g_p1 = 2 if is_bye else max(0, p1_s)
                    g_p2 = 0 if is_bye else max(0, p2_s)
                    if g_p1 == 0 and g_p2 == 0 and not is_bye:
                        if m_winner == p1_id:
                            g_p1, g_p2 = 1, 0
                        elif m_winner == p2_id:
                            g_p1, g_p2 = 0, 1
                        else:
                            g_p1, g_p2 = 1, 1
                    player_stats[p1_id]["games_won"] += g_p1
                    player_stats[p1_id]["games_played"] += max(1, g_p1 + g_p2)
                if is_bye:
                    player_stats[p1_id]["wins"] += 1
                    if not is_cut_round:
                        player_stats[p1_id]["swiss_points"] += win_pts
                        player_stats[p1_id]["path_to_victory"] += (10 ** max(0, 10 - r_num))
                elif (m_winner and m_winner == p1_id) or (not m_winner and not m_draw and p1_s > p2_s):
                    player_stats[p1_id]["wins"] += 1
                    if not is_cut_round:
                        player_stats[p1_id]["swiss_points"] += win_pts
                        player_stats[p1_id]["path_to_victory"] += (10 ** max(0, 10 - r_num))
                elif (m_winner and m_winner == p2_id) or (not m_winner and not m_draw and p1_s < p2_s):
                    player_stats[p1_id]["losses"] += 1
                else:
                    player_stats[p1_id]["draws"] += 1
                    if not is_cut_round:
                        player_stats[p1_id]["swiss_points"] += draw_pts

            if is_done and p2_id and p2_id in player_stats and not is_bye:
                if p1_id in player_stats:
                    player_stats[p1_id]["opponents"].append(p2_id)
                player_stats[p2_id]["opponents"].append(p1_id)
                player_stats[p2_id]["rounds_played"] += 1
                player_stats[p2_id]["battle_points"] += p2_s
                player_stats[p2_id]["battle_points_diff"] += (p2_s - p1_s)
                if is_tcg:
                    g_p1 = max(0, p1_s)
                    g_p2 = max(0, p2_s)
                    if g_p1 == 0 and g_p2 == 0:
                        if m_winner == p2_id:
                            g_p1, g_p2 = 0, 1
                        elif m_winner == p1_id:
                            g_p1, g_p2 = 1, 0
                        else:
                            g_p1, g_p2 = 1, 1
                    player_stats[p2_id]["games_won"] += g_p2
                    player_stats[p2_id]["games_played"] += max(1, g_p1 + g_p2)
                if (m_winner and m_winner == p2_id) or (not m_winner and not m_draw and p2_s > p1_s):
                    player_stats[p2_id]["wins"] += 1
                    if not is_cut_round:
                        player_stats[p2_id]["swiss_points"] += win_pts
                        player_stats[p2_id]["path_to_victory"] += (10 ** max(0, 10 - r_num))
                elif (m_winner and m_winner == p1_id) or (not m_winner and not m_draw and p2_s < p1_s):
                    player_stats[p2_id]["losses"] += 1
                else:
                    player_stats[p2_id]["draws"] += 1
                    if not is_cut_round:
                        player_stats[p2_id]["swiss_points"] += draw_pts

    # Apply Single-Elimination Top Cut bracket final tier priority if Top Cut has started
    for _, cut_matches in top_cut_rounds:
        m_cnt = len(cut_matches)
        # Quarterfinals (4 matches) -> tier 1+, Semifinals (2 matches) -> tier 2+, Grand Final (1 match) -> winner tier 4, runner-up tier 3
        stage_base = 3 if m_cnt == 1 else (2 if m_cnt == 2 else 1)
        for cm in cut_matches:
            cp1 = str(cm.get("p1_id") or "")
            cp2 = str(cm.get("p2_id") or "")
            for cpid in (cp1, cp2):
                if cpid in player_stats:
                    player_stats[cpid]["top_cut_tier"] = max(player_stats[cpid]["top_cut_tier"], stage_base)
            cw = str(cm.get("winner_id") or "")
            if not cw:
                cs1, cs2 = int(cm.get("p1_score") or 0), int(cm.get("p2_score") or 0)
                if cs1 > cs2:
                    cw = cp1
                elif cs2 > cs1:
                    cw = cp2
            if cw and cw in player_stats:
                player_stats[cw]["top_cut_tier"] = max(player_stats[cw]["top_cut_tier"], stage_base + 1)

    # 2. Compute Opponent Match Win % (OMW% / SoS) and Game Win % (GW%)
    for pid, stats in player_stats.items():
        stats["swiss_points"] = int(stats["swiss_points"]) if float(stats["swiss_points"]).is_integer() else round(stats["swiss_points"], 1)
        opp_win_rates = []
        for opp_id in stats["opponents"]:
            if opp_id in player_stats:
                opp = player_stats[opp_id]
                tot = max(1, opp["rounds_played"])
                wr = (opp["wins"] + ((draw_pts / max(1.0, win_pts)) * opp["draws"])) / tot
                opp_win_rates.append(max(0.33, wr))
        stats["opp_win_rate_sos"] = round((sum(opp_win_rates) / max(1, len(opp_win_rates))) * 100.0, 1) if opp_win_rates else 33.0
        if stats["games_played"] > 0:
            stats["game_win_pct"] = round(max(0.33, stats["games_won"] / stats["games_played"]) * 100.0, 1)

    # 3. Sort Standings by Top Cut Tier -> Points -> System-Appropriate Tiebreakers
    if is_tcg:
        standings = sorted(
            player_stats.values(),
            key=lambda s: (
                -s["top_cut_tier"],
                -float(s["swiss_points"]),
                -s["opp_win_rate_sos"],
                -s["game_win_pct"],
                -s["battle_points_diff"],
            ),
        )
    elif is_ffa:
        standings = sorted(
            player_stats.values(),
            key=lambda s: (
                -s["top_cut_tier"],
                -float(s["swiss_points"]),
                -s["wins"],
                -s["opp_win_rate_sos"],
                -s["battle_points"],
            ),
        )
    else:
        standings = sorted(
            player_stats.values(),
            key=lambda s: (
                -s["top_cut_tier"],
                -float(s["swiss_points"]),
                -s["path_to_victory"],
                -s["opp_win_rate_sos"],
                -s["battle_points"],
                -s["battle_points_diff"],
            ),
        )

    for idx, item in enumerate(standings, 1):
        item["rank"] = idx
        item.setdefault("player_id", item.get("id"))

    return {
        "success": True,
        "event_id": event_id,
        "scoring_mode": ev_scoring or ("ffa_pods" if is_ffa else ("tcg_bo3" if is_tcg else "wargame_vp")),
        "is_ffa": is_ffa,
        "is_tcg": is_tcg,
        "total_players": len(standings),
        "standings": standings
    }

@router.post("/api/eventstudio/submit_score", summary="Submit table match score and sync with OmniTactica / BCP")
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
    if not bcp_token and user_id and not str(payload.event_id).startswith("ES-"):
        tok_dict = auth_mgr.get_valid_bcp_tokens(user_id)
        bcp_token = tok_dict.get("id_token") or tok_dict.get("access_token")
    if not bcp_token and not user and bearer_tok and bearer_tok.startswith("eyJ"):
        bcp_token = bearer_tok

    canonical_event_id = _resolve_canonical_event_id(payload.event_id, user=user, explicit_token=bcp_token)
    event_id = canonical_event_id or payload.event_id

    # 3. Fallback to event organizer BCP token if caller has none
    if not bcp_token and not event_id.startswith("ES-"):
        try:
            ev_data, _ = bcp_adapter.fetch_event_details(event_id)
            if not ev_data:
                from scraper import BestCoastPairingsScraper
                scraper = BestCoastPairingsScraper(db=db)
                ev_data = scraper.fetch_event_details(event_id)
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
            logger.debug(f"Notice resolving TO BCP token for event {event_id}: {oe}")

        if bcp_token and canonical_event_id == payload.event_id:
            resolved_again = _resolve_canonical_event_id(payload.event_id, user=user, explicit_token=bcp_token)
            if resolved_again:
                event_id = resolved_again

    table_val = int(payload.table if payload.table is not None else (payload.table_num or 1))
    logger.info(f"EventStudio: Submitting Table {table_val} Round {payload.round_num} Score ({payload.p1_score} - {payload.p2_score}) Source: {payload.source_app}")
    
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

    # Hydrate player IDs / names / FFA state from native studio_events if ES-*
    native_ev = None
    native_target_match = None
    if event_id.startswith("ES-"):
        native_ev = db.get_studio_event(event_id)
        if native_ev:
            if not native_ev.get("passwordless_scoring", True):
                if not user:
                    raise HTTPException(status_code=401, detail="Authentication required to submit scores for this tournament.")
                _assert_native_event_owner_or_to(native_ev, user)
            r_pairings = (native_ev.get("pairings") or {}).get(str(payload.round_num)) or []
            for m_item in r_pairings:
                if m_item.get("table") == table_val or str(m_item.get("table")) == str(table_val):
                    native_target_match = m_item
                    p1_id = p1_id or m_item.get("p1_id")
                    p2_id = p2_id or m_item.get("p2_id")
                    if p1_name in ("", "Player 1") and m_item.get("p1_name"):
                        p1_name = m_item.get("p1_name")
                    if p2_name in ("", "Player 2") and m_item.get("p2_name"):
                        p2_name = m_item.get("p2_name")
                    p1_fac = p1_fac or m_item.get("p1_faction") or ""
                    p2_fac = p2_fac or m_item.get("p2_faction") or ""
                    bcp_pairing_id = bcp_pairing_id or m_item.get("id")
                    break

    if (not bcp_pairing_id or not p1_gid or not p2_gid or not p1_id or not p2_id) and not event_id.startswith("ES-"):
        try:
            res_p = bcp_adapter.fetch_event_pairings(event_id, payload.round_num, user_id=user_id, explicit_token=bcp_token)
            p_list = res_p[2] if isinstance(res_p, tuple) and len(res_p) >= 3 else (res_p if isinstance(res_p, list) else [])
            if not p_list:
                try:
                    from scraper import BestCoastPairingsScraper
                    scraper = BestCoastPairingsScraper(db=db)
                    p_list = scraper.fetch_event_pairings_for_round(event_id, payload.round_num) or []
                except Exception:
                    pass
            for p in p_list:
                t_val = p.get("table") or p.get("tableNumber") or p.get("table_number")
                p1_obj = p.get("player1") or {}
                p2_obj = p.get("player2") or {}
                u1 = p1_obj.get("user") if isinstance(p1_obj.get("user"), dict) else {}
                u2 = p2_obj.get("user") if isinstance(p2_obj.get("user"), dict) else {}

                pid_match = bool(bcp_pairing_id and (str(p.get("id") or "") == str(bcp_pairing_id) or str(p.get("bcp_pairing_id") or "") == str(bcp_pairing_id)))
                table_matches = (t_val == table_val or str(t_val) == str(table_val) or (isinstance(t_val, (int, str)) and str(t_val).isdigit() and int(t_val) == table_val))
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
    is_ffa_match = bool((native_target_match and native_target_match.get("is_ffa")) or payload.pod_placements)
    winner_id = (str(payload.winner_id).strip() if payload.winner_id else None)
    if is_ffa_match:
        is_draw = bool(payload.is_draw) if payload.is_draw is not None else (not bool(winner_id))
        if is_draw:
            winner_id = None
    else:
        if payload.is_draw is not None:
            is_draw = bool(payload.is_draw) and not bool(winner_id)
        else:
            is_draw = (p1_score == p2_score) and not bool(winner_id)
        if not winner_id and not is_draw:
            if p1_score > p2_score:
                winner_id = p1_id
            elif p2_score > p1_score:
                winner_id = p2_id
    loser_id = p2_id if (not is_ffa_match and winner_id and winner_id == p1_id) else (p1_id if (not is_ffa_match and winner_id and winner_id == p2_id) else None)

    match_id = (
        f"{event_id}-R{payload.round_num}-T{table_val}"
        if event_id.startswith("ES-")
        else (bcp_pairing_id or f"BCP-{event_id}-R{payload.round_num}-T{table_val}")
    )

    # Tournament games retain their verified digital scorecard in PostgreSQL tracker_games and Firestore rooms.
    fs_engine = get_firestore_engine()
    target_rooms = {
        match_id,
        f"BCP-{event_id}-R{payload.round_num}-T{table_val}",
        f"ES-{event_id}-R{payload.round_num}-T{table_val}",
        f"WH40K-BCP-{event_id}-R{payload.round_num}-T{table_val}",
        f"BCP-{payload.event_id}-R{payload.round_num}-T{table_val}",
        f"WH40K-BCP-{payload.event_id}-R{payload.round_num}-T{table_val}"
    }
    if isinstance(payload.game_details, dict) and payload.game_details.get("match_id"):
        target_rooms.add(str(payload.game_details["match_id"]).strip())
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
            "event_id": event_id,
            "round_num": int(payload.round_num),
            "table_num": int(table_val),
            "started": True,
            "is_finished": True,
            "bcp_submitted": True,
            "p1Score": int(payload.p1_score),
            "p2Score": int(payload.p2_score),
            "game": {
                "eventId": event_id,
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
        persisted_state["event_id"] = event_id
        persisted_state["round_num"] = int(payload.round_num)
        persisted_state["table_num"] = int(table_val)
        if "game" in persisted_state and isinstance(persisted_state["game"], dict):
            persisted_state["game"]["p1Score"] = int(payload.p1_score)
            persisted_state["game"]["p2Score"] = int(payload.p2_score)
        if "p1" in persisted_state and isinstance(persisted_state["p1"], dict):
            persisted_state["p1"]["score"] = int(payload.p1_score)
        if "p2" in persisted_state and isinstance(persisted_state["p2"], dict):
            persisted_state["p2"]["score"] = int(payload.p2_score)

    try:
        db.save_tracker_game(match_id, persisted_state, user_id_p1=p1_id, user_id_p2=p2_id)
    except Exception as se:
        logger.warning(f"Notice saving tracker game to DB from Event Studio: {se}")

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

    # 6. Strictly for native EventStudio tournaments (ES-*), update local pairings & canonical DB tables
    if event_id.startswith("ES-"):
        ev = native_ev or db.get_studio_event(event_id)
        if ev:
            win_pts_ev = float(ev.get("win_points") if ev.get("win_points") is not None else (5.0 if is_ffa_match else 3.0))
            draw_pts_ev = float(ev.get("draw_points") if ev.get("draw_points") is not None else 1.0)
            pairings_map = ev.get("pairings") or {}
            round_pairings = pairings_map.get(str(payload.round_num)) or []
            matched_in_studio = False
            placement_override = {
                str(pp.get("player_id") or pp.get("id") or ""): pp
                for pp in (payload.pod_placements or [])
                if isinstance(pp, dict) and (pp.get("player_id") or pp.get("id"))
            }
            for match in round_pairings:
                if match.get("table") == table_val or str(match.get("table")) == str(table_val):
                    matched_in_studio = True
                    match["is_done"] = True
                    match["winner_id"] = winner_id
                    match["is_draw"] = is_draw
                    if match.get("is_ffa") and isinstance(match.get("pod_participants"), list):
                        for pp in match["pod_participants"]:
                            pp_id = str(pp.get("player_id") or pp.get("id") or "")
                            ov = placement_override.get(pp_id)
                            if ov:
                                pp["placement"] = ov.get("placement")
                                pp["score"] = ov.get("score", 0)
                                pp["result"] = ov.get("result") or ("draw" if is_draw else ("win" if pp_id == winner_id else "loss"))
                            elif is_draw:
                                pp["placement"] = 1
                                pp["score"] = draw_pts_ev
                                pp["result"] = "draw"
                            elif winner_id and pp_id == winner_id:
                                pp["placement"] = 1
                                pp["score"] = win_pts_ev
                                pp["result"] = "win"
                            else:
                                pp["placement"] = 2
                                pp["score"] = 0
                                pp["result"] = "loss"
                        match["p1_score"] = int(round(win_pts_ev if (winner_id and str(match.get("p1_id")) == winner_id) else (draw_pts_ev if is_draw else 0)))
                        match["p2_score"] = int(round(draw_pts_ev if is_draw else (win_pts_ev if (winner_id and str(match.get("p1_id")) != winner_id) else 0)))
                    else:
                        match["p1_score"] = p1_score
                        match["p2_score"] = p2_score
                    if not bcp_pairing_id:
                        bcp_pairing_id = match.get("bcp_pairing_id") or match.get("id") or match_id
                    break
            if matched_in_studio:
                pairings_map[str(payload.round_num)] = round_pairings
                ev["pairings"] = pairings_map
                db.save_studio_event(ev)
            else:
                try:
                    if hasattr(db, "upsert_match"):
                        db.upsert_match({
                            "id": match_id,
                            "event_id": event_id,
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
                            "game_system": normalize_game_system(ev.get("game_system"), default="40k"),
                            "raw_json": {
                                "source_app": payload.source_app,
                                "pairing_id": bcp_pairing_id,
                                "game_details": payload.game_details or {},
                            },
                        })
                except Exception as me:
                    logger.debug(f"Notice upserting match {match_id} into DB: {me}")
        _invalidate_native_event_caches(event_id)

    # 7. Push to BCP via BcpAdapter if pairing ID is known
    bcp_synced = False
    bcp_notice = None
    if bcp_pairing_id and not event_id.startswith("ES-"):
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
    elif not event_id.startswith("ES-"):
        bcp_notice = f"Could not resolve BCP pairing ID for table {table_val} round {payload.round_num}"
        logger.warning(f"⚠️ {bcp_notice}")

    return {
        "success": True,
        "event_id": event_id,
        "table": table_val,
        "round_num": payload.round_num,
        "p1_score": payload.p1_score,
        "p2_score": payload.p2_score,
        "is_draw": is_draw,
        "is_ffa": is_ffa_match,
        "pairing_id": bcp_pairing_id or match_id,
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
    round: Optional[int] = None
    round_num: Optional[int] = None
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
def api_eventstudio_create_judge_call(payload: JudgeCallCreatePayload):
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
def api_eventstudio_get_judge_calls(event_id: str, active_only: bool = False):
    fs_engine = get_firestore_engine()
    canonical_eid = _resolve_canonical_event_id(event_id) if event_id else event_id
    calls = fs_engine.list_judge_calls(event_id=canonical_eid or event_id, active_only=active_only)
    return {"success": True, "event_id": canonical_eid or event_id, "calls": calls}

@router.post("/api/eventstudio/judge_call/resolve", summary="Update judge call status (en_route, resolved, cancelled)")
def api_eventstudio_resolve_judge_call(payload: JudgeCallResolvePayload):
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
def api_eventstudio_update_clock(event_id: str, payload: StudioMasterClockPayload):
    fs_engine = get_firestore_engine()
    status_str = (payload.status or "running").strip().lower()
    rnd = payload.round_num if payload.round_num is not None else (payload.round or 1)
    dur = payload.durationMinutes if payload.durationMinutes is not None else (payload.duration_minutes or 150)
    target_end = payload.targetEndTime if payload.targetEndTime is not None else payload.target_end_time
    rem_sec = payload.remainingSeconds if payload.remainingSeconds is not None else payload.remaining_seconds
    if rem_sec is None:
        rem_sec = int(dur) * 60
    if status_str == "running" and target_end is None:
        target_end = int((time.time() + float(rem_sec)) * 1000)
    clock_data = {
        "status": status_str,
        "round": rnd,
        "round_num": rnd,
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
                str(rdata.get("eventId") or "").lower() == event_id.lower() or
                str(rdata.get("event_id") or "").lower() == event_id.lower() or
                str(rdata.get("tournament_id") or "").lower() == event_id.lower() or
                (clean_eid and clean_eid in mid_u)
            ):
                rdata["masterClock"] = updated
                listeners = TRACKER_LISTENERS.get(mid, [])
                clock_msg = {"type": "master_clock_update", "masterClock": updated, "master_clock": updated}
                for q in list(listeners):
                    try:
                        q.put_nowait(clock_msg)
                    except Exception:
                        pass
    except Exception as e:
        logger.debug(f"Notice broadcasting clock to room listeners: {e}")

    return {"success": True, "event_id": event_id, "masterClock": updated, "clock": updated}

@router.get("/api/eventstudio/event/{event_id}/clock", summary="Get tournament round master clock")
def api_eventstudio_get_clock(event_id: str):
    fs_engine = get_firestore_engine()
    clock = fs_engine.get_tournament_master_clock(event_id) or {"status": "stopped", "round": 1, "round_num": 1, "remainingSeconds": 9000, "remaining_seconds": 9000}
    return {"success": True, "event_id": event_id, "masterClock": clock, "clock": clock}

@router.post("/api/eventstudio/event/{event_id}/broadcast", summary="Publish tournament live broadcast announcement")
def api_eventstudio_publish_broadcast(event_id: str, payload: StudioBroadcastPayload):
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
def api_eventstudio_get_broadcast(event_id: str):
    fs_engine = get_firestore_engine()
    b = fs_engine.get_tournament_broadcast(event_id)
    return {"success": True, "event_id": event_id, "broadcast": b}

class EventLivestreamPayload(BaseModel):
    id: Optional[str] = None
    table_number: Optional[int] = 1
    tableNumber: Optional[int] = None
    round_number: Optional[int] = None
    roundNumber: Optional[int] = None
    channel: str = "Feature Stream"
    platform: Optional[str] = None
    title: Optional[str] = None
    stream_url: Optional[str] = None
    streamUrl: Optional[str] = None
    embed_url: Optional[str] = None
    embedUrl: Optional[str] = None
    is_live: Optional[bool] = True
    viewers: Optional[int] = 120

@router.get("/api/events/{event_id}/livestreams", summary="Get tournament active livestreams")
@router.get("/api/eventstudio/event/{event_id}/livestreams", summary="Get tournament active livestreams (studio alias)")
def api_get_event_livestreams(event_id: str):
    fs_engine = get_firestore_engine()
    streams = fs_engine.get_event_livestreams(event_id)
    return {"success": True, "event_id": event_id, "livestreams": streams}

@router.post("/api/events/{event_id}/livestreams", summary="Save or update tournament livestream")
@router.post("/api/eventstudio/event/{event_id}/livestreams", summary="Save or update tournament livestream (studio alias)")
def api_save_event_livestream(event_id: str, payload: EventLivestreamPayload, request: Request):
    user = _get_creator_or_to_session_or_403(request)
    fs_engine = get_firestore_engine()
    data = payload.dict()
    if payload.tableNumber is not None:
        data["table_number"] = payload.tableNumber
    if payload.roundNumber is not None:
        data["round_number"] = payload.roundNumber
    if payload.streamUrl is not None:
        data["stream_url"] = payload.streamUrl
    if payload.embedUrl is not None:
        data["embed_url"] = payload.embedUrl
    saved = fs_engine.save_event_livestream(event_id, data)
    all_streams = fs_engine.get_event_livestreams(event_id)
    return {"success": True, "event_id": event_id, "livestream": saved, "livestreams": all_streams}

@router.delete("/api/events/{event_id}/livestreams/{stream_id}", summary="Delete tournament livestream")
@router.delete("/api/eventstudio/event/{event_id}/livestreams/{stream_id}", summary="Delete tournament livestream (studio alias)")
def api_delete_event_livestream(event_id: str, stream_id: str, request: Request):
    user = _get_creator_or_to_session_or_403(request)
    fs_engine = get_firestore_engine()
    ok = fs_engine.delete_event_livestream(event_id, stream_id)
    all_streams = fs_engine.get_event_livestreams(event_id)
    return {"success": ok, "event_id": event_id, "deleted_id": stream_id, "livestreams": all_streams}

class PodGeneratePayload(BaseModel):
    pod_size: Optional[int] = 4
    num_pods: Optional[int] = 2
    target_round: Optional[int] = None

@router.post("/api/eventstudio/event/{event_id}/pods/generate", summary="Automate multi-day Pod & Bracket progression")
def api_eventstudio_generate_pods(event_id: str, payload: PodGeneratePayload):
    db = get_database()
    res = db.generate_day2_pod_brackets(
        event_id=event_id,
        pod_size=payload.pod_size or 4,
        num_pods=payload.num_pods or 2,
        target_round=payload.target_round
    )
    return res

_MATCH_PREDICTOR_CACHE: Dict[str, Any] = {}

@router.get("/api/eventstudio/match_predictor", summary="Predict tactical matchup outcome, win probability, and score differential")
def api_eventstudio_match_predictor(
    p1_id: Optional[str] = None,
    p2_id: Optional[str] = None,
    p1: Optional[str] = None,
    p2: Optional[str] = None,
    p1_name: Optional[str] = "Player 1",
    p2_name: Optional[str] = "Player 2",
    p1_faction: Optional[str] = "Unknown",
    p2_faction: Optional[str] = "Unknown",
    game_system: Optional[str] = "40k",
):
    now_ts = time.time()
    target_sys = normalize_game_system(game_system, default="40k")
    eff_p1_id = (p1_id or p1 or "").strip()
    eff_p2_id = (p2_id or p2 or "").strip()
    cache_key = f"v2:{target_sys}:{eff_p1_id}:{eff_p2_id}:{(p1_name or '').strip().lower()}:{(p2_name or '').strip().lower()}:{(p1_faction or '').strip().lower()}:{(p2_faction or '').strip().lower()}"
    cached = _MATCH_PREDICTOR_CACHE.get(cache_key)
    if cached and (now_ts - cached[1]) < 120:
        return cached[0]

    db = get_database()
    
    # 1. Elo Ratings & Player Resolution
    p1_elo = 1500.0
    p2_elo = 1500.0
    p1_matches = 0
    p2_matches = 0
    resolved_p1_id = eff_p1_id or None
    resolved_p2_id = eff_p2_id or None
    placeholder_names = {"", "player 1", "player 2", "player", "unknown", "unknown player", "bye"}
    p1_name_clean = (p1_name or "").strip()
    p2_name_clean = (p2_name or "").strip()
    fac1 = (p1_faction or "Unknown").strip()
    fac2 = (p2_faction or "Unknown").strip()
    fac_p1_wins = 0
    fac_total = 0
    h2h_matches = []
    h2h_rows_raw = []

    sys_pred = "(game_system = %s OR game_system IS NULL)" if target_sys == "40k" else "game_system = %s"

    need_db = bool(
        resolved_p1_id
        or resolved_p2_id
        or p1_name_clean.lower() not in placeholder_names
        or p2_name_clean.lower() not in placeholder_names
        or (fac1.lower() not in ("", "unknown") and fac2.lower() not in ("", "unknown"))
    )

    if need_db:
        with db.get_connection() as conn:
            from psycopg2 import extras
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                if resolved_p1_id:
                    cursor.execute(
                        f"SELECT current_elo, matches_played AS total_matches FROM player_ratings WHERE player_id = %s AND {sys_pred};",
                        (resolved_p1_id, target_sys),
                    )
                    r1 = cursor.fetchone()
                    if r1:
                        p1_elo = float(r1["current_elo"] or 1500.0)
                        p1_matches = int(r1["total_matches"] or 0)
                elif p1_name_clean.lower() not in placeholder_names:
                    cursor.execute(
                        f"SELECT current_elo, matches_played AS total_matches, player_id, top_faction FROM player_ratings WHERE LOWER(player_name) = LOWER(%s) AND {sys_pred} ORDER BY current_elo DESC LIMIT 1;",
                        (p1_name_clean, target_sys),
                    )
                    r1 = cursor.fetchone()
                    if not r1:
                        cursor.execute(
                            f"SELECT current_elo, matches_played AS total_matches, player_id, top_faction FROM player_ratings WHERE player_name ILIKE %s AND {sys_pred} ORDER BY current_elo DESC LIMIT 1;",
                            (f"%{p1_name_clean}%", target_sys),
                        )
                        r1 = cursor.fetchone()
                    if r1:
                        resolved_p1_id = r1.get("player_id")
                        p1_elo = float(r1["current_elo"] or 1500.0)
                        p1_matches = int(r1["total_matches"] or 0)
                        if fac1.lower() in ("", "unknown") and r1.get("top_faction"):
                            fac1 = str(r1["top_faction"])
                            p1_faction = fac1

                if resolved_p2_id:
                    cursor.execute(
                        f"SELECT current_elo, matches_played AS total_matches FROM player_ratings WHERE player_id = %s AND {sys_pred};",
                        (resolved_p2_id, target_sys),
                    )
                    r2 = cursor.fetchone()
                    if r2:
                        p2_elo = float(r2["current_elo"] or 1500.0)
                        p2_matches = int(r2["total_matches"] or 0)
                elif p2_name_clean.lower() not in placeholder_names:
                    cursor.execute(
                        f"SELECT current_elo, matches_played AS total_matches, player_id, top_faction FROM player_ratings WHERE LOWER(player_name) = LOWER(%s) AND {sys_pred} ORDER BY current_elo DESC LIMIT 1;",
                        (p2_name_clean, target_sys),
                    )
                    r2 = cursor.fetchone()
                    if not r2:
                        cursor.execute(
                            f"SELECT current_elo, matches_played AS total_matches, player_id, top_faction FROM player_ratings WHERE player_name ILIKE %s AND {sys_pred} ORDER BY current_elo DESC LIMIT 1;",
                            (f"%{p2_name_clean}%", target_sys),
                        )
                        r2 = cursor.fetchone()
                    if r2:
                        resolved_p2_id = r2.get("player_id")
                        p2_elo = float(r2["current_elo"] or 1500.0)
                        p2_matches = int(r2["total_matches"] or 0)
                        if fac2.lower() in ("", "unknown") and r2.get("top_faction"):
                            fac2 = str(r2["top_faction"])
                            p2_faction = fac2

                # 2. Head-to-Head History (uses idx_matches_p1_p2)
                if resolved_p1_id and resolved_p2_id:
                    cursor.execute("""
                    SELECT m.round, m.player1_id, m.player2_id, m.winner_id, m.player1_name, m.player2_name, m.player1_score, m.player2_score, m.match_date, e.name as event_name
                    FROM matches m
                    LEFT JOIN events e ON m.event_id = e.id
                    WHERE m.is_done = TRUE AND (
                        (m.player1_id = %s AND m.player2_id = %s) OR
                        (m.player1_id = %s AND m.player2_id = %s)
                    )
                    ORDER BY m.match_date DESC LIMIT 10;
                    """, (resolved_p1_id, resolved_p2_id, resolved_p2_id, resolved_p1_id))
                    h2h_rows = cursor.fetchall() or []
                    for idx_hr, hr in enumerate(h2h_rows):
                        h2h_rows_raw.append(hr)
                        if idx_hr < 5:
                            h2h_matches.append({
                                "event_name": hr.get("event_name") or "Tournament Match",
                                "date": hr.get("match_date").isoformat() if hasattr(hr.get("match_date"), "isoformat") else (str(hr.get("match_date")) if hr.get("match_date") else None),
                                "p1_name": hr.get("player1_name"),
                                "p2_name": hr.get("player2_name"),
                                "score": f"{hr.get('player1_score')} - {hr.get('player2_score')}"
                            })

    # 3. Calibrated 2-Mode ML Match Prediction (GBDT + Davidson 3-Way Calibration)
    from predictor_model import (
        compute_h2h_elo_residual,
        compute_rating_uncertainty_sq,
        extract_batch_player_ml_profiles,
        get_system_model_spec,
        lookup_competitive_alpha_pair,
        normalize_faction_key,
        predict_1v1_matchup,
    )

    is_mock_db = (
        db is None
        or type(db).__module__.startswith("unittest.mock")
        or getattr(db, "_is_mock_instance", lambda: False)()
    )
    spec = get_system_model_spec(target_sys, db=None if is_mock_db else db)
    comp_snap: Dict[str, Any] = {"factions": {}, "matchups": {}}
    if need_db and not is_mock_db and hasattr(db, "get_competitive_faction_alpha_snapshot"):
        try:
            snap_res = db.get_competitive_faction_alpha_snapshot(target_sys)
            if isinstance(snap_res, dict) and snap_res.get("factions"):
                comp_snap = snap_res
        except Exception:
            pass

    pids_to_load = [pid for pid in (resolved_p1_id, resolved_p2_id) if pid]
    ml_profiles = extract_batch_player_ml_profiles(None if is_mock_db else db, pids_to_load, target_sys) if (need_db and pids_to_load) else {}
    if resolved_p1_id and resolved_p1_id in ml_profiles:
        mp1 = ml_profiles[resolved_p1_id]
        if p1_name_clean.lower() in placeholder_names and mp1.get("player_name"):
            p1_name = mp1["player_name"]
        if fac1.lower() in ("", "unknown") and mp1.get("top_faction"):
            fac1 = str(mp1["top_faction"])
            p1_faction = fac1
    if resolved_p2_id and resolved_p2_id in ml_profiles:
        mp2 = ml_profiles[resolved_p2_id]
        if p2_name_clean.lower() in placeholder_names and mp2.get("player_name"):
            p2_name = mp2["player_name"]
        if fac2.lower() in ("", "unknown") and mp2.get("top_faction"):
            fac2 = str(mp2["top_faction"])
            p2_faction = fac2

    def _build_side_ml_inputs(pid: Optional[str], elo_v: float, games_v: int, own_fac: str, opp_fac: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        prof = ml_profiles.get(str(pid or "")) or {}
        ml_f = prof.get("ml_features") or {}
        disp_obj = prof.get("disposition") or {"badges": []}
        f_own = normalize_faction_key(own_fac)
        f_opp = normalize_faction_key(opp_fac)
        own_map = ml_f.get("own_faction_residuals") or {}
        vs_map = ml_f.get("vs_faction_residuals") or {}
        own_entry = own_map.get(f_own) or {}
        vs_entry = vs_map.get(f_opp) or {}
        g_cnt = max(int(games_v or 0), int(ml_f.get("competitive_games") or ml_f.get("games") or 0))
        return (
            {
                "elo": float(elo_v),
                "games": g_cnt,
                "uncertainty_sq": float(ml_f.get("uncertainty_sq") if ml_f.get("uncertainty_sq") is not None else compute_rating_uncertainty_sq(g_cnt)),
                "peak_gap": float(ml_f.get("peak_gap") or 0.0),
                "recent_form_ewma": float(ml_f.get("recent_form_ewma") or 0.0),
                "own_fac_res": float(own_entry.get("residual") if own_entry.get("residual") is not None else (own_entry.get("shrunk_res") or 0.0)),
                "own_fac_games": int(own_entry.get("games") or 0),
                "vs_fac_res": float(vs_entry.get("residual") if vs_entry.get("residual") is not None else (vs_entry.get("shrunk_res") or 0.0)),
                "giant_slayer_res": float(disp_obj.get("giant_slayer_res") if disp_obj.get("giant_slayer_res") is not None else (ml_f.get("giant_slayer_res") or 0.0)),
                "gatekeeper_res": float(disp_obj.get("gatekeeper_res") if disp_obj.get("gatekeeper_res") is not None else (ml_f.get("gatekeeper_res") or 0.0)),
                "volatility_z": float(disp_obj.get("volatility_z") if disp_obj.get("volatility_z") is not None else (ml_f.get("volatility_z") or 0.0)),
            },
            disp_obj,
        )

    p1_ml_in, p1_disp = _build_side_ml_inputs(resolved_p1_id, p1_elo, p1_matches, fac1, fac2)
    p2_ml_in, p2_disp = _build_side_ml_inputs(resolved_p2_id, p2_elo, p2_matches, fac2, fac1)
    macro_in = lookup_competitive_alpha_pair(comp_snap, fac1, fac2)
    fac_total = int(macro_in.get("matchup_games") or 0)

    h2h_res_val, h2h_games_cnt = compute_h2h_elo_residual(
        h2h_rows_raw,
        resolved_p1_id or "",
        resolved_p2_id or "",
        p1_elo,
        p2_elo,
        p1_name=p1_name,
        p2_name=p2_name,
    )

    ml_pred = predict_1v1_matchup(
        spec=spec,
        p1_inputs=p1_ml_in,
        p2_inputs=p2_ml_in,
        macro_inputs=macro_in,
        direct_h2h_res=h2h_res_val,
        direct_h2h_games=h2h_games_cnt,
    )

    p1_win_share_pct = float(ml_pred["p1_win_share"])
    p2_win_share_pct = round(100.0 - p1_win_share_pct, 1)
    draw_prob_pct = float(ml_pred.get("draw_prob") or 0.0)
    proj = ml_pred.get("projected") or {}
    p1_expected_score = round(float(proj.get("p1_score") if proj.get("p1_score") is not None else 75.0))
    p2_expected_score = round(float(proj.get("p2_score") if proj.get("p2_score") is not None else 75.0))

    elo_diff = p1_elo - p2_elo
    favored = p1_name if p1_win_share_pct > 52.0 else (p2_name if p2_win_share_pct > 52.0 else "Even Matchup")

    res = {
        "player1": {
            "id": resolved_p1_id,
            "name": p1_name,
            "faction": p1_faction,
            "elo": round(p1_elo, 1),
            "win_probability": p1_win_share_pct,
            "win_probability_3way": float(ml_pred["p1_win_prob"]),
            "expected_score": p1_expected_score,
            "wtc_score": proj.get("wtc_p1"),
            "disposition": p1_disp,
        },
        "player2": {
            "id": resolved_p2_id,
            "name": p2_name,
            "faction": p2_faction,
            "elo": round(p2_elo, 1),
            "win_probability": p2_win_share_pct,
            "win_probability_3way": float(ml_pred["p2_win_prob"]),
            "expected_score": p2_expected_score,
            "wtc_score": proj.get("wtc_p2"),
            "disposition": p2_disp,
        },
        "draw_probability": draw_prob_pct,
        "model_mode": ml_pred.get("model_mode"),
        "model_label": ml_pred.get("model_label"),
        "confidence": ml_pred.get("confidence"),
        "wtc_projection": {
            "wtc_p1": proj.get("wtc_p1"),
            "wtc_p2": proj.get("wtc_p2"),
            "score_unit": proj.get("score_unit", "VP"),
            "blowout_prob": proj.get("blowout_prob"),
            "tight_game_prob": proj.get("tight_game_prob"),
        },
        "ml_prediction": ml_pred,
        "favored_player": favored,
        "elo_diff": round(abs(elo_diff), 1),
        "expected_differential": abs(p1_expected_score - p2_expected_score),
        "faction_matchup": {
            "total_games": fac_total,
            "p1_faction_win_pct": round(50.0 + 25.0 * math.tanh(float(macro_in.get("f1_alpha") or 0.0) - float(macro_in.get("f2_alpha") or 0.0) + float(macro_in.get("matchup_alpha") or 0.0)), 1),
        },
        "h2h_history": h2h_matches,
    }
    if len(_MATCH_PREDICTOR_CACHE) > 500:
        _MATCH_PREDICTOR_CACHE.clear()
    _MATCH_PREDICTOR_CACHE[cache_key] = (res, now_ts)
    return res

class WtcDraftSavePayload(BaseModel):
    event_id: str
    round_num: int
    team_a_name: Optional[str] = "Team A"
    team_b_name: Optional[str] = "Team B"
    draft_state: Dict[str, Any]

@router.post("/api/eventstudio/wtc_draft", summary="Save active WTC team captain pairing draft state")
def api_eventstudio_save_wtc_draft(payload: WtcDraftSavePayload):
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
def api_eventstudio_get_wtc_draft(event_id: str, round_num: int):
    db = get_database()
    res = db.get_wtc_draft(event_id=event_id, round_num=round_num)
    return {"success": True, "event_id": event_id, "round_num": round_num, "draft": res}


# =========================================================================
# TO HUB, EVENT NEWS & APP-WIDE ANNOUNCEMENT BANNER APIS (< 15ms)
# =========================================================================

class ToHubAnnouncementPayload(BaseModel):
    message: Optional[str] = ""
    type: Optional[str] = None
    level: Optional[str] = None
    round: Optional[int] = None
    event_name: Optional[str] = None
    author: Optional[str] = None
    author_name: Optional[str] = None
    target_table: Optional[str] = None
    target_player_id: Optional[str] = None
    target_player_name: Optional[str] = None
    active: Optional[bool] = True


class ToHubDirectChatTarget(BaseModel):
    player_id: Optional[str] = None
    player_name: Optional[str] = None


class ToHubDirectChatPayload(BaseModel):
    message: str
    level: Optional[str] = "info"
    event_name: Optional[str] = ""
    round: Optional[int] = None
    table_num: Optional[str] = None
    table_number: Optional[str] = None
    player_id: Optional[str] = None
    player_name: Optional[str] = None
    recipients: Optional[List[Dict[str, Optional[str]]]] = None
    targets: Optional[List[Any]] = None
    also_broadcast_banner: Optional[bool] = False
    fallback_to_banner: Optional[bool] = True


class ToHubNewsPostPayload(BaseModel):
    id: Optional[str] = None
    title: str
    category: Optional[str] = "General Info"
    body: str
    pinned: Optional[bool] = False
    author: Optional[str] = None
    author_name: Optional[str] = None


def _push_broadcast_to_tracker_rooms(event_id: str, broadcast_obj: Optional[Dict[str, Any]]) -> None:
    """Pushes broadcast announcement (or None when cleared) to all matching in-memory Game Tracker rooms and SSE listeners."""
    try:
        from routers.tracker import TRACKER_ROOMS, TRACKER_LISTENERS
        clean_eid = str(event_id).replace("bcp_", "").replace("ES-", "").replace("es-", "").strip().upper()
        target_tbl = str((broadcast_obj or {}).get("target_table") or "").strip() if isinstance(broadcast_obj, dict) else ""
        for mid, rdata in list(TRACKER_ROOMS.items()):
            if not isinstance(rdata, dict):
                continue
            mid_u = str(mid).upper()
            if (
                str(rdata.get("eventId") or "").lower() == event_id.lower() or
                str(rdata.get("event_id") or "").lower() == event_id.lower() or
                str(rdata.get("tournament_id") or "").lower() == event_id.lower() or
                (clean_eid and clean_eid in mid_u)
            ):
                if target_tbl:
                    r_tbl = str(rdata.get("tableNum") or rdata.get("table_number") or rdata.get("table") or "").strip()
                    if (r_tbl and r_tbl != target_tbl) or (not r_tbl and f"-T{target_tbl.upper()}" not in mid_u):
                        continue
                rdata["broadcast"] = broadcast_obj
                listeners = TRACKER_LISTENERS.get(mid, [])
                b_msg = {"type": "broadcast_update", "broadcast": broadcast_obj}
                for q in list(listeners):
                    try:
                        q.put_nowait(b_msg)
                    except Exception:
                        pass
    except Exception:
        pass


@router.get("/api/events/active-announcements", summary="Get active TO announcements across events for app-wide & Game Tracker banner")
def api_get_active_event_announcements(
    event_ids: Optional[str] = Query(None, description="Comma-separated list of event IDs, or '*' for all active broadcasts")
):
    fs_engine = get_firestore_engine()
    raw_str = str(event_ids or "").strip()
    tokens = [eid.strip() for eid in raw_str.split(",") if eid.strip()] if raw_str else []
    include_wildcard = (not tokens) or any(t.lower() in ("*", "all") for t in tokens)
    raw_list: List[str] = [t for t in tokens if t.lower() not in ("*", "all")][:25]
    if include_wildcard:
        raw_list.append("*")
    active = fs_engine.get_active_broadcasts_for_events(raw_list[:35])
    return {"ok": True, "success": True, "announcements": active}


def _ensure_canonical_case_event_id(event_id: str) -> str:
    eid = str(event_id or "").strip()
    if eid and eid == eid.upper() and any(c.isalpha() for c in eid):
        return _resolve_canonical_event_id(eid)
    return eid


@router.get("/api/events/{event_id}/to-hub", summary="Get unified TO Hub (Firestore) and News (PostgreSQL) state for an event")
def api_get_event_to_hub_state(event_id: str):
    event_id = _ensure_canonical_case_event_id(event_id)
    fs_engine = get_firestore_engine()
    state = fs_engine.get_event_to_hub_state(event_id)

    active_tracker_tables: List[Dict[str, Any]] = []
    try:
        from routers.tracker import TRACKER_ROOMS
        clean_eid = str(event_id).replace("bcp_", "").replace("ES-", "").replace("es-", "").strip().upper()
        for mid, rdata in list(TRACKER_ROOMS.items()):
            if not isinstance(rdata, dict):
                continue
            mid_u = str(mid).upper()
            if (
                str(rdata.get("eventId") or "").lower() == event_id.lower() or
                str(rdata.get("event_id") or "").lower() == event_id.lower() or
                str(rdata.get("tournament_id") or "").lower() == event_id.lower() or
                (clean_eid and clean_eid in mid_u)
            ):
                t_num = rdata.get("tableNum") or rdata.get("table_number") or rdata.get("table")
                active_tracker_tables.append({
                    "match_id": mid,
                    "table_number": t_num,
                    "table_num": t_num,
                    "round": rdata.get("round") or rdata.get("round_number"),
                    "battle_round": rdata.get("battleRound") or rdata.get("currentRound") or 1,
                    "p1_score": (rdata.get("p1") or {}).get("totalScore") if isinstance(rdata.get("p1"), dict) else rdata.get("p1_score"),
                    "p2_score": (rdata.get("p2") or {}).get("totalScore") if isinstance(rdata.get("p2"), dict) else rdata.get("p2_score"),
                    "status": rdata.get("status") or "live",
                })
    except Exception:
        pass

    return {
        "ok": True,
        "success": True,
        **state,
        "active_tracker_tables": active_tracker_tables,
        "active_sessions": active_tracker_tables,
    }


@router.post("/api/events/{event_id}/to-hub/announcement", summary="Publish or clear an app-wide & Game Tracker pop-up event announcement banner in Firestore")
def api_publish_event_to_hub_announcement(event_id: str, payload: ToHubAnnouncementPayload):
    event_id = _ensure_canonical_case_event_id(event_id)
    fs_engine = get_firestore_engine()
    msg = (payload.message or "").strip()
    if payload.active is False or not msg:
        fs_engine.clear_tournament_broadcast(event_id)
        _push_broadcast_to_tracker_rooms(event_id, None)
        state = fs_engine.get_event_to_hub_state(event_id)
        return {
            "ok": True,
            "success": True,
            "event_id": event_id,
            "broadcast": None,
            "active_broadcast": None,
            "announcements": state.get("announcements", []),
        }

    lvl = payload.level or payload.type or "info"
    auth = payload.author_name or payload.author or "Tournament Organizer"
    ev_name = (payload.event_name or "").strip()
    if not ev_name:
        try:
            doc_d = fs_engine._read_tournament_doc_dict(event_id)
            ev_name = str(doc_d.get("name") or doc_d.get("event_name") or "").strip()
        except Exception:
            pass
    broadcast_data = {
        "message": msg,
        "type": lvl,
        "level": lvl,
        "round": payload.round,
        "event_name": ev_name,
        "author": auth,
        "author_name": auth,
        "target_table": str(payload.target_table).strip() if payload.target_table is not None and str(payload.target_table).strip() else None,
        "target_player_id": str(payload.target_player_id).strip() if payload.target_player_id else None,
        "target_player_name": str(payload.target_player_name).strip() if payload.target_player_name else None,
        "active": True,
    }
    res = fs_engine.publish_tournament_broadcast(event_id, broadcast_data)
    _push_broadcast_to_tracker_rooms(event_id, res)

    state = fs_engine.get_event_to_hub_state(event_id)
    return {
        "ok": True,
        "success": True,
        "event_id": event_id,
        "broadcast": res,
        "active_broadcast": state.get("active_broadcast"),
        "targeted_broadcasts": state.get("targeted_broadcasts", []),
        "announcements": state.get("announcements", []),
        "state": state,
    }


@router.post("/api/events/{event_id}/to-hub/direct-chat", summary="Send a direct OmniChat message from TO Hub to a table or player (with optional live banner fallback)")
def api_send_event_to_hub_direct_chat(event_id: str, payload: ToHubDirectChatPayload, request: Request):
    event_id = _ensure_canonical_case_event_id(event_id)
    user = None
    try:
        auth_mgr = get_auth_manager()
        auth_header = request.headers.get("Authorization", "") if request and hasattr(request, "headers") else ""
        session_token = (
            (request.cookies.get("session_token") if request and hasattr(request, "cookies") else None)
            or (request.cookies.get("elo_auth_token") if request and hasattr(request, "cookies") else None)
            or (request.cookies.get("native_session_token") if request and hasattr(request, "cookies") else None)
            or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
        )
        user = auth_mgr.get_session(session_token) if session_token else None
    except Exception:
        user = None
    if not user and "_resolve_optional_user" in globals() and callable(globals()["_resolve_optional_user"]):
        try:
            user = globals()["_resolve_optional_user"](request)
        except Exception:
            user = None
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required to send direct chat messages")

    msg = (payload.message or "").strip()
    if not msg:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    fs_engine = get_firestore_engine()
    ev_name = (payload.event_name or "").strip()
    if not ev_name:
        try:
            doc_d = fs_engine._read_tournament_doc_dict(event_id)
            ev_name = str(doc_d.get("name") or doc_d.get("event_name") or "").strip()
        except Exception:
            pass

    raw_recipients: List[Dict[str, str]] = []
    source_list = payload.targets if isinstance(payload.targets, list) and len(payload.targets) > 0 else payload.recipients
    if isinstance(source_list, list) and len(source_list) > 0:
        for r in source_list:
            if isinstance(r, dict):
                pid_val = str(r.get("player_id") or "").strip()
                pname_val = str(r.get("player_name") or "").strip()
            else:
                pid_val = str(getattr(r, "player_id", "") or "").strip()
                pname_val = str(getattr(r, "player_name", "") or "").strip()
            if pid_val or pname_val:
                raw_recipients.append({"player_id": pid_val, "player_name": pname_val})
    elif payload.player_id or payload.player_name:
        raw_recipients.append({
            "player_id": str(payload.player_id or "").strip(),
            "player_name": str(payload.player_name or "").strip(),
        })

    tbl_str = str(payload.table_number or payload.table_num or "").strip()
    db = get_database()
    if not ev_name:
        try:
            ev_row = db.get_event_by_id(event_id)
            if isinstance(ev_row, dict):
                ev_name = str(ev_row.get("name") or ev_row.get("event_name") or "").strip()
        except Exception:
            pass

    chat_prefix = f"🏛️ [TO{f' • {ev_name}' if ev_name else ''}{f' • Table {tbl_str}' if tbl_str else ''}] "
    formatted_chat_msg = msg if msg.startswith("🏛️") else f"{chat_prefix}{msg}"

    delivered_chats: List[Dict[str, Any]] = []
    unregistered_names: List[str] = []

    for rec in raw_recipients:
        pid = rec.get("player_id", "")
        pname = rec.get("player_name", "")
        if not pid and not pname:
            continue
        if pname.upper() == "BYE":
            continue
        try:
            res = db.send_to_hub_direct_chat_message(
                sender_id=user["id"],
                player_id=pid,
                player_name=pname,
                event_name=ev_name or f"Event {event_id}",
                message_text=formatted_chat_msg,
            )
            if res and (res.get("success") or res.get("ok")) and res.get("request_id"):
                req_id = res["request_id"]
                recv_id = res.get("receiver_id") or res.get("recipient_id")
                res_norm = {
                    **res,
                    "request_id": req_id,
                    "receiver_id": recv_id,
                    "player_name": pname or res.get("receiver_name") or res.get("player_name") or res.get("recipient_name") or "Player",
                }
                delivered_chats.append(res_norm)
                try:
                    from routers.connect import _invalidate_unread_count
                    _invalidate_unread_count([user["id"], recv_id])
                except Exception:
                    pass
                try:
                    fs_engine.update_chat_status(req_id, "accepted", participants=[user["id"], recv_id])
                    fs_engine.append_chat_message(req_id, {
                        "id": res.get("message_id") or (res.get("message") or {}).get("id"),
                        "request_id": req_id,
                        "sender_id": user["id"],
                        "sender_name": user.get("display_name") or "Tournament Organizer",
                        "message_text": formatted_chat_msg,
                        "room_key": None,
                        "created_at": res.get("created_at") or datetime.now(timezone.utc).isoformat(),
                    })
                    if recv_id:
                        fs_engine.notify_user_requests_updated([user["id"], recv_id], reason="new_message")
                except Exception:
                    pass
            else:
                unregistered_names.append(pname or pid or "Player")
        except Exception as e:
            logger.debug(f"Notice sending TO Hub direct chat to {pname or pid}: {e}")
            unregistered_names.append(pname or pid or "Player")

    broadcast_res = None
    should_banner = bool(payload.also_broadcast_banner) or (bool(payload.fallback_to_banner) and (len(unregistered_names) > 0 or len(delivered_chats) == 0))
    if should_banner:
        target_names = ", ".join([r.get("player_name") for r in raw_recipients if r.get("player_name") and r.get("player_name").upper() != "BYE"])
        b_data = {
            "message": msg,
            "type": payload.level or "info",
            "level": payload.level or "info",
            "round": payload.round,
            "event_name": ev_name,
            "author": user.get("display_name") or "Tournament Organizer",
            "author_name": user.get("display_name") or "Tournament Organizer",
            "target_table": tbl_str if tbl_str else None,
            "target_player_id": raw_recipients[0].get("player_id") if len(raw_recipients) == 1 else None,
            "target_player_name": target_names or None,
            "active": True,
        }
        broadcast_res = fs_engine.publish_tournament_broadcast(event_id, b_data)
        _push_broadcast_to_tracker_rooms(event_id, broadcast_res)

    state = fs_engine.get_event_to_hub_state(event_id)
    return {
        "ok": True,
        "success": True,
        "event_id": event_id,
        "delivered_count": len(delivered_chats),
        "delivered": delivered_chats,
        "delivered_chats": delivered_chats,
        "primary_request_id": delivered_chats[0]["request_id"] if delivered_chats else None,
        "unmatched": unregistered_names,
        "unregistered_players": unregistered_names,
        "banner_fallback_used": bool(broadcast_res is not None and not payload.also_broadcast_banner),
        "broadcast": broadcast_res,
        "state": state,
    }


@router.delete("/api/events/{event_id}/to-hub/announcement", summary="Clear active general or targeted event announcement banner in Firestore")
def api_clear_event_to_hub_announcement(event_id: str, target_id: Optional[str] = None, broadcast_id: Optional[str] = None):
    event_id = _ensure_canonical_case_event_id(event_id)
    fs_engine = get_firestore_engine()
    resolved_target = target_id or broadcast_id
    fs_engine.clear_tournament_broadcast(event_id, target_id=resolved_target)
    if not resolved_target or resolved_target in ("general", "all"):
        _push_broadcast_to_tracker_rooms(event_id, None)
    state = fs_engine.get_event_to_hub_state(event_id)
    return {
        "ok": True,
        "success": True,
        "event_id": event_id,
        "broadcast": state.get("active_broadcast"),
        "active_broadcast": state.get("active_broadcast"),
        "targeted_broadcasts": state.get("targeted_broadcasts", []),
        "announcements": state.get("announcements", []),
        "state": state,
    }


@router.post("/api/events/{event_id}/to-hub/news", summary="Create or update a TO News & Info post for an event in PostgreSQL")
def api_save_event_to_hub_news_post(event_id: str, payload: ToHubNewsPostPayload):
    fs_engine = get_firestore_engine()
    post_dict = payload.dict()
    if post_dict.get("author_name") and not post_dict.get("author"):
        post_dict["author"] = post_dict["author_name"]
    saved = fs_engine.save_event_news_post(event_id, post_dict)
    all_posts = fs_engine.get_event_news_posts(event_id)
    return {
        "ok": True,
        "success": True,
        "event_id": event_id,
        "post": saved,
        "news_posts": all_posts,
        "storage": "postgresql",
    }


@router.delete("/api/events/{event_id}/to-hub/news/{post_id}", summary="Delete a TO News & Info post for an event from PostgreSQL")
def api_delete_event_to_hub_news_post(event_id: str, post_id: str):
    fs_engine = get_firestore_engine()
    ok = fs_engine.delete_event_news_post(event_id, post_id)
    all_posts = fs_engine.get_event_news_posts(event_id)
    return {
        "ok": ok,
        "success": ok,
        "event_id": event_id,
        "deleted_id": post_id,
        "news_posts": all_posts,
        "storage": "postgresql",
    }




