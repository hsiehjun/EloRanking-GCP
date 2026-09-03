"""Native Authentication, Registration, 2FA & BCP Account Linking Router."""
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

router = APIRouter(tags=["Native Authentication & Accounts"])

# =========================================================================
# NATIVE AUTHENTICATION & BCP LINKING APIS
# =========================================================================

class RegisterPayload(BaseModel):
    email: str
    password: str
    display_name: Optional[str] = None
    invite_code: Optional[str] = None

class LoginPayload(BaseModel):
    email: str
    password: str

class BCPConnectPayload(BaseModel):
    bcp_email: Optional[str] = None
    bcp_password: Optional[str] = None
    bcp_token: Optional[str] = None
    refresh_token: Optional[str] = None

class ForgotPasswordPayload(BaseModel):
    email: str

class ResetPasswordPayload(BaseModel):
    new_password: str
    token: Optional[str] = None
    code: Optional[str] = None
    email: Optional[str] = None

class UserSettingsPayload(BaseModel):
    display_name: Optional[str] = None
    old_password: Optional[str] = None
    new_password: Optional[str] = None

class VerifyRegistrationPayload(BaseModel):
    email: str
    code: str

class ResendVerificationPayload(BaseModel):
    email: str

@router.get("/api/auth/registration-status", summary="Public check if account registrations are currently open")
async def api_auth_registration_status():
    auth_mgr = get_auth_manager()
    is_open = auth_mgr.are_registrations_open()
    return {
        "registrations_open": is_open,
        "message": "Registration open" if is_open else "Account registration is currently locked by the administrator. All invitation codes are suspended."
    }

@router.get("/api/auth/invite/validate", summary="Validate invitation code status")
async def api_auth_validate_invite(code: str):
    auth_mgr = get_auth_manager()
    if not auth_mgr.are_registrations_open():
        return {
            "valid": False,
            "error": "Account registration is currently locked by the administrator. All invitation codes are suspended.",
            "registration_locked": True
        }
    is_valid, err_msg, rec = auth_mgr.validate_invite_code(code)
    if not is_valid:
        return {"valid": False, "error": err_msg, "registration_locked": not auth_mgr.are_registrations_open()}
    return {
        "valid": True,
        "code": code.strip().upper(),
        "is_admin_code": rec.get("is_admin_code", False) if rec else False
    }

@router.post("/api/auth/register", summary="Register a new native user account with 2FA email verification")
async def api_auth_register(payload: RegisterPayload, response: Response):
    auth_mgr = get_auth_manager()
    if not auth_mgr.are_registrations_open():
        raise HTTPException(status_code=403, detail="Account registration is currently locked by the administrator. All invitation codes are suspended.")
    res = auth_mgr.initiate_registration(
        payload.email, 
        payload.password, 
        payload.display_name or "", 
        invite_code=payload.invite_code
    )
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Registration failed"))
    return res

@router.post("/api/auth/verify-registration", summary="Verify 6-digit email code to activate account")
async def api_auth_verify_registration(request: Request, payload: VerifyRegistrationPayload, response: Response):
    auth_mgr = get_auth_manager()
    if not auth_mgr.are_registrations_open():
        raise HTTPException(status_code=403, detail="Account registration is currently locked by the administrator. All invitation codes are suspended.")
    ua = request.headers.get("User-Agent")
    ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else None)
    if ip and "," in ip:
        ip = ip.split(",")[0].strip()
    res = auth_mgr.verify_registration_code(payload.email, payload.code, user_agent=ua, ip_address=ip)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Verification failed"))
    token = res.get("session_token")
    if token:
        response.set_cookie(key="session_token", value=token, max_age=2592000, path="/", httponly=False, samesite="lax")
    return res

@router.post("/api/auth/resend-verification", summary="Resend 6-digit email verification code")
async def api_auth_resend_verification(payload: ResendVerificationPayload):
    auth_mgr = get_auth_manager()
    res = auth_mgr.resend_registration_code(payload.email)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to resend code"))
    return res

@router.post("/api/auth/login", summary="Login to native user account")
async def api_auth_login(request: Request, payload: LoginPayload, response: Response):
    auth_mgr = get_auth_manager()
    ua = request.headers.get("User-Agent")
    ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else None)
    if ip and "," in ip:
        ip = ip.split(",")[0].strip()
    res = auth_mgr.login(payload.email, payload.password, user_agent=ua, ip_address=ip)
    if not res.get("success"):
        raise HTTPException(status_code=401, detail=res.get("error", "Invalid credentials"))
    token = res.get("session_token")
    if token:
        response.set_cookie(key="session_token", value=token, max_age=2592000, path="/", httponly=False, samesite="lax")
    return res

@router.post("/api/auth/forgot-password", summary="Request password reset link and verification code via email")
async def api_auth_forgot_password(payload: ForgotPasswordPayload):
    auth_mgr = get_auth_manager()
    res = auth_mgr.request_password_reset(payload.email)
    return res

@router.get("/api/auth/reset-password/validate", summary="Validate password reset token or code")
async def api_auth_validate_reset_token(token: Optional[str] = Query(None), code: Optional[str] = Query(None), email: Optional[str] = Query(None)):
    auth_mgr = get_auth_manager()
    res = auth_mgr.validate_reset_token(token=token, code=code, email=email)
    return res

@router.post("/api/auth/reset-password", summary="Reset account password using token or email & code")
async def api_auth_reset_password(payload: ResetPasswordPayload, response: Response):
    auth_mgr = get_auth_manager()
    res = auth_mgr.reset_password(
        new_password=payload.new_password,
        token=payload.token,
        code=payload.code,
        email=payload.email
    )
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Password reset failed"))
    token = res.get("session_token")
    if token:
        response.set_cookie(key="session_token", value=token, max_age=2592000, path="/", httponly=False, samesite="lax")
    return res

@router.get("/api/auth/me", summary="Check active user session and BCP link status")
async def api_auth_me(request: Request, token: Optional[str] = Query(None)):
    auth_header = request.headers.get("Authorization", "")
    session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    if not session_token:
        return {"authenticated": False}
    session = get_auth_manager().get_session(session_token)
    if not session:
        return {"authenticated": False}
    return {"authenticated": True, "user": session}

@router.post("/api/auth/logout", summary="Logout current user session")
async def api_auth_logout(request: Request, response: Response, token: Optional[str] = Query(None)):
    auth_header = request.headers.get("Authorization", "")
    session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    if session_token:
        get_auth_manager().logout(session_token)
    response.delete_cookie(key="session_token", path="/")
    return {"success": True}

@router.post("/api/auth/logout-all", summary="Sign out user from all active devices")
async def api_auth_logout_all(request: Request, response: Response, keep_current: bool = Query(False), token: Optional[str] = Query(None)):
    auth_header = request.headers.get("Authorization", "")
    session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    if not session_token:
        raise HTTPException(status_code=401, detail="Authentication required")
    auth_mgr = get_auth_manager()
    session = auth_mgr.get_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    user_id = session["id"]
    token_to_keep = session_token if keep_current else None
    count = auth_mgr.logout_all_sessions(user_id, keep_current_token=token_to_keep)

    if not keep_current:
        response.delete_cookie(key="session_token", path="/")

    return {
        "success": True,
        "revoked_count": count,
        "signed_out_current": not keep_current,
        "message": f"Successfully signed out of {count} active device session(s)."
    }

@router.get("/api/auth/sessions", summary="Get all active device sessions for current user")
async def api_auth_get_sessions(request: Request, token: Optional[str] = Query(None)):
    auth_header = request.headers.get("Authorization", "")
    session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    if not session_token:
        raise HTTPException(status_code=401, detail="Authentication required")
    auth_mgr = get_auth_manager()
    session = auth_mgr.get_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    sessions = auth_mgr.get_active_sessions(session["id"], current_token=session_token)
    return {
        "success": True,
        "sessions": sessions,
        "total_active": len(sessions)
    }

@router.delete("/api/auth/sessions/{target_token}", summary="Revoke specific device session")
async def api_auth_revoke_session(target_token: str, request: Request, token: Optional[str] = Query(None)):
    auth_header = request.headers.get("Authorization", "")
    session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    if not session_token:
        raise HTTPException(status_code=401, detail="Authentication required")
    auth_mgr = get_auth_manager()
    session = auth_mgr.get_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    revoked = auth_mgr.revoke_session(session["id"], target_token)
    return {"success": revoked, "message": "Session revoked." if revoked else "Session not found."}

@router.post("/api/user/settings", summary="Update user profile settings or change password")
async def api_user_settings(request: Request, payload: UserSettingsPayload, token: Optional[str] = Query(None)):
    auth_header = request.headers.get("Authorization", "")
    session_token = token or request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    if not session_token:
        raise HTTPException(status_code=401, detail="Authentication required")
    session = get_auth_manager().get_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    res = get_auth_manager().update_settings(
        session["id"],
        display_name=payload.display_name,
        old_password=payload.old_password,
        new_password=payload.new_password
    )
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to update settings"))
    return res

@router.post("/api/user/bcp/connect", summary="Connect and link Best Coast Pairings account")
async def api_user_bcp_connect(request: Request, payload: BCPConnectPayload, token: Optional[str] = Query(None)):
    auth_header = request.headers.get("Authorization", "")
    session_token = token or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    if not session_token:
        raise HTTPException(status_code=401, detail="Authentication required")
    session = get_auth_manager().get_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    if payload.bcp_token:
        res = get_auth_manager().link_bcp_token(session["id"], payload.bcp_token, refresh_token=payload.refresh_token)
    else:
        if not payload.bcp_email or not payload.bcp_password:
            raise HTTPException(status_code=400, detail="BCP email and password or token required")
        res = get_auth_manager().link_bcp_account(session["id"], payload.bcp_email, payload.bcp_password)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to connect BCP account"))
    return res

@router.post("/api/user/bcp/disconnect", summary="Unlink Best Coast Pairings account")
async def api_user_bcp_disconnect(request: Request, token: Optional[str] = Query(None)):
    auth_header = request.headers.get("Authorization", "")
    session_token = token or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    if not session_token:
        raise HTTPException(status_code=401, detail="Authentication required")
    session = get_auth_manager().get_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    return get_auth_manager().unlink_bcp_account(session["id"])

@router.get("/api/user/dashboard", summary="Get personalized competitor hub analytics")
async def api_user_dashboard(request: Request, player_id: Optional[str] = Query(None), token: Optional[str] = Query(None)):
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = token or (auth_header[7:] if auth_header.startswith("Bearer ") else None) or request.cookies.get("session_token")
    
    target_pid = player_id
    target_uid = None

    if session_token:
        session = auth_mgr.get_session(session_token)
        if session:
            target_uid = session.get("id")
            target_pid = target_pid or session.get("player_id")

    if not target_pid and not target_uid:
        top_p = get_database().get_top_ranked_players(limit=1)
        target_pid = top_p.get("items", [{}])[0].get("player_id", "demo") if isinstance(top_p, dict) else "demo"

    return auth_mgr.get_user_competitor_hub(player_id=target_pid, user_id=target_uid)

