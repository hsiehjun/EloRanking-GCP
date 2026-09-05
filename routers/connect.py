"""Community Hub LFG, Sparring Radar & Real-Time Chat Router."""
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

router = APIRouter(tags=["Community Hub & Sparring Radar"])

class LfgProfilePayload(BaseModel):
    is_active: bool = False
    home_venue_name: Optional[str] = ""
    address: Optional[str] = ""
    city: Optional[str] = ""
    state: Optional[str] = ""
    country: Optional[str] = "United States"
    postal_code: Optional[str] = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    radius_miles: Optional[int] = 30
    preferred_points: Optional[int] = 2000
    play_style: Optional[str] = "Competitive"
    availability_notes: Optional[str] = ""
    factions: Optional[str] = ""

class MatchRequestPayload(BaseModel):
    receiver_id: str
    proposed_venue: Optional[str] = ""
    proposed_points: Optional[int] = 2000
    proposed_date: Optional[str] = ""
    note: Optional[str] = ""

class MatchRespondPayload(BaseModel):
    action: str  # "accept", "decline", "block"
    message: Optional[str] = None

class ChatMessagePayload(BaseModel):
    message: str
    room_key: Optional[str] = None
    message_id: Optional[str] = None



# =========================================================================
# COMMUNITY HUB & LOCAL SPARRING RADAR ENDPOINTS
# =========================================================================

@router.get("/api/connect/profile", summary="Get user LFG profile")
async def api_get_connect_profile(request: Request):
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    
    db = get_database()
    profile = db.get_lfg_profile(user["id"])
    profile["display_name"] = user.get("display_name") or user.get("email")
    profile["email"] = user.get("email")
    profile["current_elo"] = float(user["current_elo"]) if user.get("current_elo") is not None else None
    profile["player_id"] = user.get("player_id") or user["id"]
    return {"success": True, "profile": profile}

@router.post("/api/connect/profile", summary="Update user LFG profile")
async def api_save_connect_profile(request: Request, payload: LfgProfilePayload):
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    db = get_database()
    ok = db.save_lfg_profile(user["id"], payload.dict())
    return {"success": ok}

@router.get("/api/connect/players", summary="Search nearby LFG players")
async def api_search_connect_players(
    request: Request,
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radius_miles: float = Query(50.0, ge=1.0, le=250.0),
    play_style: Optional[str] = Query(None)
):
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    user_id = user["id"] if user else ""

    db = get_database()
    if lat is None or lng is None:
        if user_id:
            prof = db.get_lfg_profile(user_id)
            lat = prof.get("latitude") or 32.7157
            lng = prof.get("longitude") or -117.1611
        else:
            lat = 32.7157
            lng = -117.1611

    players = db.search_nearby_lfg_players(
        current_user_id=user_id,
        lat=lat,
        lng=lng,
        radius_miles=radius_miles,
        play_style=play_style
    )
    return {"success": True, "players": players}

@router.get("/api/connect/requests", summary="Get user match requests and chats")
async def api_get_connect_requests(request: Request):
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    db = get_database()
    requests = db.get_user_match_requests(user["id"])
    return {"success": True, "requests": requests, "current_user_id": user["id"]}

@router.post("/api/connect/request", summary="Create sparring match request")
async def api_create_connect_request(request: Request, payload: MatchRequestPayload):
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    db = get_database()
    res = db.create_match_request(
        sender_id=user["id"],
        receiver_id=payload.receiver_id,
        proposed_venue=payload.proposed_venue or "",
        proposed_points=payload.proposed_points or 2000,
        proposed_date=payload.proposed_date or "",
        note=payload.note or ""
    )
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to create match request"))

    # Real-time Firestore notification
    try:
        fs_engine = get_firestore_engine()
        req_id = res.get("request_id")
        if req_id:
            fs_engine.update_chat_status(req_id, "pending", participants=[user["id"], payload.receiver_id])
        fs_engine.notify_user_requests_updated([user["id"], payload.receiver_id], reason="request_created")
    except Exception as e:
        logger.warning(f"Notice notifying Firestore on match request creation: {e}")

    return res

@router.post("/api/connect/request/{request_id}/respond", summary="Respond to match request")
async def api_respond_connect_request(request_id: str, payload: MatchRespondPayload, request: Request):
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    db = get_database()
    res = db.respond_match_request(request_id, user["id"], payload.action, getattr(payload, "message", None))
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to update match request"))

    # Real-time Firestore push for both participants
    try:
        fs_engine = get_firestore_engine()
        chat_info = db.get_chat_messages(request_id, user["id"])
        req_info = chat_info.get("request", {}) or {}
        sender_id = req_info.get("sender_id")
        receiver_id = req_info.get("receiver_id")
        participants = [p for p in [sender_id, receiver_id] if p]
        status = res.get("status") or ("accepted" if payload.action == "accept" else "declined")
        fs_engine.update_chat_status(request_id, status, participants=participants)
        fs_engine.notify_user_requests_updated(participants, reason=f"request_{payload.action}")
        if payload.action == "accept":
            fs_engine.sync_chat_history(request_id, chat_info.get("messages", []), req_info)
    except Exception as e:
        logger.warning(f"Notice notifying Firestore on match request response: {e}")

    return res

@router.get("/api/connect/request/{request_id}/messages", summary="Get messages in request thread")
async def api_get_connect_messages(request_id: str, request: Request):
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    db = get_database()
    res = db.get_chat_messages(request_id, user["id"])
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to load messages"))

    # Only sync into Firestore if messages were newly marked read to prevent infinite onSnapshot ping-pong loops
    if res.get("marked_read_count", 0) > 0:
        try:
            fs_engine = get_firestore_engine()
            fs_engine.sync_chat_history(request_id, res.get("messages", []), res.get("request"))
        except Exception as e:
            logger.warning(f"Notice syncing chat history to Firestore: {e}")

    return res

@router.post("/api/connect/request/{request_id}/message", summary="Send message in request thread")
async def api_send_connect_message(request_id: str, payload: ChatMessagePayload, request: Request):
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    db = get_database()
    res = db.send_chat_message(request_id, user["id"], payload.message, payload.room_key, payload.message_id)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to send message"))

    # Real-time Firestore synchronization
    try:
        fs_engine = get_firestore_engine()
        msg_obj = {
            "id": res.get("message_id") or payload.message_id,
            "request_id": request_id,
            "sender_id": user["id"],
            "sender_name": user.get("display_name") or "Player",
            "message_text": payload.message.strip() if payload.message else "",
            "room_key": payload.room_key.strip() if payload.room_key else None,
            "created_at": res.get("created_at") or datetime.now(timezone.utc).isoformat()
        }
        fs_engine.append_chat_message(request_id, msg_obj)
        # Also notify other participant in connect_user_sync so conversation list updates in real-time
        chat_info = db.get_chat_messages(request_id, user["id"])
        req_info = chat_info.get("request", {}) or {}
        sender_id = req_info.get("sender_id")
        receiver_id = req_info.get("receiver_id")
        other_id = receiver_id if sender_id == user["id"] else sender_id
        if other_id:
            fs_engine.notify_user_requests_updated([other_id], reason="new_message")

        # Ensure live multiplayer tracker room exists if a room_key was posted
        if payload.room_key:
            try:
                rkey = normalize_tracker_match_id(payload.room_key)
                if rkey not in TRACKER_ROOMS and not fs_engine.get_room(rkey) and not db.get_tracker_game(rkey):
                    s_name = user.get("display_name") or "Player 1"
                    r_name = req_info.get("receiver_name") if user["id"] == sender_id else (req_info.get("sender_name") or "Player 2")
                    s_fac = req_info.get("sender_faction") if user["id"] == sender_id else req_info.get("receiver_faction")
                    r_fac = req_info.get("receiver_faction") if user["id"] == sender_id else req_info.get("sender_faction")
                    init_tracker_room_from_chat(rkey, {
                        "sender_id": user["id"],
                        "req_sender_id": sender_id,
                        "req_receiver_id": receiver_id,
                        "sender_name": s_name,
                        "receiver_name": r_name,
                        "sender_faction": s_fac,
                        "receiver_faction": r_fac
                    }, fs_engine)
            except Exception as room_init_err:
                logger.warning(f"Notice auto-initializing tracker room from chat message: {room_init_err}")
    except Exception as e:
        logger.warning(f"Notice pushing chat message to Firestore: {e}")

    return res

@router.get("/api/connect/unread-count", summary="Get total unread requests and messages count")
async def api_get_connect_unread_count(request: Request):
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None
    if not user:
        return {"unread_count": 0}

    db = get_database()
    count = db.get_connect_unread_count(user["id"])
    return {"unread_count": count}
