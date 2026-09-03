"""Admin, Feedback, System Settings & Invitations Router."""
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

router = APIRouter(tags=["Admin & Governance"])

class FeedbackPayload(BaseModel):
    feedback_type: str = "bug"
    message: str
    email: Optional[str] = None
    page_url: Optional[str] = None
    device_info: Optional[str] = None
    token: Optional[str] = None

@router.post("/api/feedback", summary="Submit user feedback or bug report")
async def api_submit_feedback(payload: FeedbackPayload, request: Request):
    if not payload.message or not payload.message.strip():
        raise HTTPException(status_code=400, detail="Feedback message cannot be empty.")

    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = payload.token or (auth_header[7:] if auth_header.startswith("Bearer ") else None) or request.cookies.get("session_token")
    
    user_id = None
    user_email = payload.email
    if session_token:
        session = auth_mgr.get_session(session_token)
        if session:
            user_id = session.get("id")
            user_email = session.get("email") or user_email

    if not user_id:
        raise HTTPException(status_code=401, detail="Please sign in with your OmniTactica account to submit feedback.")

    db = get_database()
    fb_id = db.save_feedback(
        feedback_type=payload.feedback_type or "bug",
        message=payload.message.strip(),
        user_id=user_id,
        user_email=user_email,
        page_url=payload.page_url,
        device_info=payload.device_info
    )
    return {"success": True, "id": fb_id, "message": "Thank you! Your feedback has been received."}

@router.get("/api/feedback", summary="Get recent user feedbacks (Admin)")
async def api_get_feedbacks(request: Request, limit: int = Query(50)):
    db = get_database()
    return db.get_feedbacks(limit=limit)

def _is_admin_feedback_request(request: Request, token: Optional[str] = None) -> bool:
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = token or (auth_header[7:] if auth_header.startswith("Bearer ") else None) or request.cookies.get("session_token")
    if not session_token:
        return False
    session = auth_mgr.get_session(session_token)
    if not session:
        return False
    user_role = (session.get("role") or "player").strip().lower()
    return user_role in ("admin", "superuser", "developer", "owner", "to", "referee")

class FeedbackUpdatePayload(BaseModel):
    status: Optional[str] = None
    admin_notes: Optional[str] = None
    message: Optional[str] = None
    feedback_type: Optional[str] = None
    token: Optional[str] = None

@router.get("/api/admin/feedback", summary="Get filtered user feedbacks (Admin)")
async def api_admin_get_feedbacks(request: Request, limit: int = Query(100), status: Optional[str] = Query(None), feedback_type: Optional[str] = Query(None), token: Optional[str] = Query(None)):
    if not _is_admin_feedback_request(request, token=token):
        raise HTTPException(status_code=403, detail="Admin access restricted to authorized administrators.")
    db = get_database()
    feedbacks = db.get_feedbacks(limit=limit, status=status, feedback_type=feedback_type)
    return {"success": True, "feedbacks": feedbacks}

@router.post("/api/admin/feedback/{feedback_id}/update", summary="Update feedback status, admin notes, or message")
async def api_admin_update_feedback(feedback_id: str, payload: FeedbackUpdatePayload, request: Request, token: Optional[str] = Query(None)):
    if not _is_admin_feedback_request(request, token=payload.token or token):
        raise HTTPException(status_code=403, detail="Admin access restricted to authorized administrators.")
    db = get_database()
    ok = db.update_feedback(
        feedback_id=feedback_id,
        status=payload.status,
        admin_notes=payload.admin_notes,
        message=payload.message,
        feedback_type=payload.feedback_type
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Feedback entry not found")
    return {"success": True, "message": "Feedback updated successfully"}

@router.delete("/api/admin/feedback/{feedback_id}", summary="Delete feedback entry from database")
async def api_admin_delete_feedback(feedback_id: str, request: Request, token: Optional[str] = Query(None)):
    if not _is_admin_feedback_request(request, token=token):
        raise HTTPException(status_code=403, detail="Admin access restricted to authorized administrators.")
    db = get_database()
    ok = db.delete_feedback(feedback_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Feedback entry not found")
    return {"success": True, "message": "Feedback deleted successfully"}

# =========================================================================
# INVITATION CODES & PLATFORM GOVERNANCE (USER & ADMIN)
# =========================================================================

def _get_admin_session_or_403(request: Request, token: Optional[str] = None) -> Dict[str, Any]:
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    if not session_token:
        raise HTTPException(status_code=401, detail="Authentication required")
    session = auth_mgr.get_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    user_role = (session.get("role") or "player").strip().lower()
    user_email = (session.get("email") or "").strip().lower()
    admin_emails = ('swimgeek751@gmail.com',)
    if user_role not in ("admin", "superuser", "developer", "owner") or user_email not in admin_emails:
        raise HTTPException(status_code=403, detail="Administrator privileges required")
    return session

def _get_user_session_or_401(request: Request, token: Optional[str] = None) -> Dict[str, Any]:
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    if not session_token:
        raise HTTPException(status_code=401, detail="Authentication required")
    session = auth_mgr.get_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return session

@router.get("/api/auth/invite/my-code", summary="Get or generate user's active 24-hour invitation code")
async def api_auth_my_invite_code(request: Request, token: Optional[str] = Query(None)):
    session = _get_user_session_or_401(request, token)
    auth_mgr = get_auth_manager()
    return auth_mgr.generate_user_invite_code(session["id"])

@router.post("/api/auth/invite/generate", summary="Generate a fresh 24-hour invitation code")
async def api_auth_generate_invite_code(request: Request, token: Optional[str] = Query(None)):
    session = _get_user_session_or_401(request, token)
    auth_mgr = get_auth_manager()
    return auth_mgr.generate_user_invite_code(session["id"])

# --- ADMIN GOVERNANCE SCHEMAS & ROUTES ---
class AdminCreateInvitePayload(BaseModel):
    code: str
    max_uses: Optional[int] = None
    expires_in_days: Optional[int] = None

class AdminToggleInvitePayload(BaseModel):
    is_active: bool

class AdminToggleSystemInvitesPayload(BaseModel):
    enabled: bool

@router.get("/api/admin/metrics", summary="Platform KPIs & Registration Metrics (Admin)")
async def api_admin_metrics(request: Request, token: Optional[str] = Query(None)):
    _get_admin_session_or_403(request, token)
    return get_auth_manager().get_admin_dashboard_metrics()

@router.get("/api/admin/settings", summary="Get System Settings (Admin)")
async def api_admin_get_settings(request: Request, token: Optional[str] = Query(None)):
    _get_admin_session_or_403(request, token)
    auth_mgr = get_auth_manager()
    return {
        "invites_enabled": auth_mgr.are_registrations_open()
    }

@router.post("/api/admin/settings/toggle-invites", summary="Global Master Kill Switch for Registrations (Admin)")
async def api_admin_toggle_invites(payload: AdminToggleSystemInvitesPayload, request: Request, token: Optional[str] = Query(None)):
    admin = _get_admin_session_or_403(request, token)
    auth_mgr = get_auth_manager()
    val_str = "true" if payload.enabled else "false"
    ok = auth_mgr.set_system_setting("invites_enabled", val_str, user_id=admin.get("id"))
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to save registration lock state to database.")
    return {"success": True, "invites_enabled": auth_mgr.are_registrations_open()}

@router.get("/api/admin/invites", summary="List All Invitation Codes (Admin)")
async def api_admin_get_invites(request: Request, token: Optional[str] = Query(None)):
    _get_admin_session_or_403(request, token)
    return {"codes": get_auth_manager().get_admin_invite_codes()}

@router.post("/api/admin/invites/create", summary="Create Persistent / Custom Invitation Code (Admin)")
async def api_admin_create_invite(payload: AdminCreateInvitePayload, request: Request, token: Optional[str] = Query(None)):
    admin = _get_admin_session_or_403(request, token)
    res = get_auth_manager().create_admin_invite_code(
        admin_user_id=admin.get("id"),
        code_str=payload.code,
        max_uses=payload.max_uses,
        expires_in_days=payload.expires_in_days
    )
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to create code"))
    return res

@router.delete("/api/admin/invites/{code}", summary="Delete Invitation Code (Admin)")
async def api_admin_delete_invite(code: str, request: Request, token: Optional[str] = Query(None)):
    _get_admin_session_or_403(request, token)
    return get_auth_manager().delete_admin_invite_code(code)

@router.post("/api/admin/invites/{code}/toggle", summary="Toggle Active Status of Invitation Code (Admin)")
async def api_admin_toggle_invite(code: str, payload: AdminToggleInvitePayload, request: Request, token: Optional[str] = Query(None)):
    _get_admin_session_or_403(request, token)
    return get_auth_manager().toggle_invite_code(code, payload.is_active)

@router.get("/api/admin/referrals", summary="Get Referral Audit Log & Who-Invited-Who (Admin)")
async def api_admin_get_referrals(request: Request, token: Optional[str] = Query(None)):
    _get_admin_session_or_403(request, token)
    return {"referrals": get_auth_manager().get_admin_referrals()}

@router.get("/api/admin/users", summary="Get User Directory with Inviter Lineage (Admin)")
async def api_admin_get_users(request: Request, token: Optional[str] = Query(None)):
    _get_admin_session_or_403(request, token)
    return {"users": get_auth_manager().get_admin_users()}

# =========================================================================
# ROLE MANAGEMENT & TO STATUS REQUESTS
# =========================================================================

class AdminSetUserRolePayload(BaseModel):
    role: str

@router.post("/api/admin/users/{user_id}/role", summary="Update User Role (Admin)")
async def api_admin_set_user_role(user_id: str, payload: AdminSetUserRolePayload, request: Request, token: Optional[str] = Query(None)):
    _get_admin_session_or_403(request, token)
    valid_roles = ("player", "to", "organizer", "admin", "referee")
    new_role = payload.role.strip().lower()
    if new_role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(valid_roles)}")
    ok = get_auth_manager().set_user_role(user_id, new_role)
    if not ok:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True, "user_id": user_id, "role": new_role}

class RequestToPayload(BaseModel):
    organization: Optional[str] = ""
    venue_or_store: Optional[str] = ""
    details: Optional[str] = ""

@router.post("/api/auth/request-to", summary="Request Tournament Organizer (TO) Status")
async def api_auth_request_to(payload: RequestToPayload, request: Request, token: Optional[str] = Query(None)):
    session = _get_user_session_or_401(request, token)
    db = get_database()
    user_id = session.get("id")
    user_email = session.get("email") or ""
    msg = f"TO Verification Request:\nOrganization/Club: {payload.organization}\nStore/Venue: {payload.venue_or_store}\nDetails: {payload.details}"
    import uuid
    fb_id = str(uuid.uuid4())
    try:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO user_feedbacks (id, user_id, user_email, feedback_type, message, status, created_at)
                    VALUES (%s, %s, %s, 'to_request', %s, 'open', NOW());
                """, (fb_id, user_id, user_email, msg))
                conn.commit()
    except Exception as e:
        logger.warning(f"Notice saving TO request to feedback: {e}")
    return {"success": True, "message": "TO verification request submitted successfully. An administrator will review your application."}

