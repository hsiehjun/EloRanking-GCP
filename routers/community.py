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
    TRACKER_ROOMS, TRACKER_LISTENERS, generate_unique_match_id, normalize_tracker_match_id
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

    # Check in-memory cache first (15-minute TTL)
    for eid in target_ids:
        cached = _community_field_stats_cache.get(eid)
        if cached and (now_ts - cached.get("timestamp", 0) < 900):
            results[eid] = cached.get("stats", {})
        else:
            missing_ids.append(eid)

    if missing_ids:
        db = get_database()
        # 1. Query existing DB participants
        db_stats = db.get_events_field_stats(missing_ids)
        need_bcp_sync: List[str] = []

        for eid in missing_ids:
            stat = db_stats.get(eid)
            # If DB already has participants, cache and return
            if stat and int(stat.get("total_enrolled") or 0) > 0:
                results[eid] = stat
                _community_field_stats_cache[eid] = {
                    "timestamp": now_ts,
                    "stats": stat
                }
            else:
                need_bcp_sync.append(eid)

        # 2. For events without participants in DB, fetch live roster from BCP concurrently
        if need_bcp_sync:
            def fetch_and_sync_one(eid_to_sync: str):
                try:
                    s = BestCoastPairingsScraper(db=db, request_delay=0.0)
                    s.sync_event_roster(eid_to_sync)
                except Exception as err:
                    logger.debug(f"Async live roster sync notice for {eid_to_sync}: {err}")

            with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(need_bcp_sync))) as executor:
                futures = [executor.submit(fetch_and_sync_one, eid) for eid in need_bcp_sync]
                concurrent.futures.wait(futures, timeout=3.5)

            # Re-query DB for newly synced events
            newly_synced_stats = db.get_events_field_stats(need_bcp_sync)
            for eid in need_bcp_sync:
                stat = newly_synced_stats.get(eid)
                if stat and int(stat.get("total_enrolled") or 0) > 0:
                    results[eid] = stat
                    _community_field_stats_cache[eid] = {
                        "timestamp": now_ts,
                        "stats": stat
                    }
                else:
                    # Empty roster or unlisted event
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




