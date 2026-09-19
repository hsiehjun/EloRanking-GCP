"""Official Teams & Clubs Router for OmniTactica (Production FastAPI).

Provides endpoints for:
1. Teams Directory & Leaderboard (/api/teams/detected-history, /api/teams/my-team, /api/teams/confirm-affiliation, /api/teams/leave, /api/teams/create)
2. Detailed Team Hub (/api/teams/{id})
3. Locker Room Messages (/api/teams/{id}/messages)
4. Squad Events (/api/teams/{id}/squad-events/attend)
5. Captain Governance (invite, remove, transfer captaincy, claim inactive captaincy, assign roles)
"""

import re
import logging
from typing import Any, Dict, List, Optional

from core import (
    APIRouter, HTTPException, Query, Request, Response,
    get_database, get_auth_manager, _get_user_session_or_401
)
import teams_hub_service

logger = logging.getLogger("TeamsRouter")
router = APIRouter(tags=["Teams & Clubs"])


@router.get("/api/teams/detected-history", summary="Get detected tournament teams for onboarding")
async def api_teams_detected_history(
    player_id: Optional[str] = Query(None),
    player_name: Optional[str] = Query(None),
    game_system: Optional[str] = Query("40k"),
    request: Request = None
):
    svc = teams_hub_service.get_teams_hub_service()

    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "") if request else ""
    session_token = (request.cookies.get("session_token") if request else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    current_user = auth_mgr.get_session(session_token) if (session_token and auth_mgr) else None

    pid = (player_id or (current_user.get("player_id") if current_user else None) or (current_user.get("bcp_user_id") if current_user else None) or (current_user.get("id") if current_user else None) or "").strip()
    pname = (player_name or (current_user.get("display_name") if current_user else None) or (current_user.get("name") if current_user else None) or "").strip()

    db_detected = []
    try:
        db = get_database()
        if hasattr(db, "get_connection"):
            with db.get_connection() as conn:
                with conn.cursor() as cur:
                    target_sys = (game_system or "40k").strip().lower()
                    cur.execute("""
                        SELECT DISTINCT TRIM(ep.team) as team_name, COUNT(*) as match_count, MAX(e.event_date) as last_seen, MAX(e.name) as last_event
                        FROM event_participants ep
                        LEFT JOIN events e ON ep.event_id = e.id
                        WHERE (ep.player_id = %s OR ep.id::text = %s OR (ep.full_name ILIKE %s AND %s != ''))
                          AND ep.team IS NOT NULL AND TRIM(ep.team) != '' 
                          AND LOWER(TRIM(ep.team)) NOT IN ('none', 'n/a', 'unaligned', 'unaffiliated', 'no team', 'null', 'unknown', '-')
                          AND COALESCE(e.game_system, '40k') = %s
                        GROUP BY TRIM(ep.team)
                        ORDER BY last_seen DESC NULLS LAST;
                    """, (pid, pid, f"%{pname}%" if pname else "", pname, target_sys))
                    rows = cur.fetchall()
                    for idx, r in enumerate(rows):
                        tm_name = r[0]
                        m_count = r[1]
                        last_dt = r[2].strftime('%b %Y') if (r[2] and hasattr(r[2], 'strftime')) else (str(r[2]) if r[2] else (r[3] or "Tournament"))
                        slug = "team_" + re.sub(r'[^a-z0-9]+', '_', tm_name.lower()).strip('_')
                        db_detected.append({
                            "team_id": slug,
                            "name": tm_name,
                            "short_tag": "".join([w[0] for w in tm_name.split() if w])[:4].upper() or "TEAM",
                            "match_count": m_count,
                            "last_played": last_dt,
                            "is_current": (idx == 0)
                        })
    except Exception as e:
        logger.debug(f"Notice querying DB for detected teams: {e}")

    svc_detected = svc.get_player_detected_history(pid, pname)

    combined = []
    seen = set()
    for d in svc_detected + db_detected:
        key = (d.get("name") or d.get("team_id") or "").lower().strip()
        if key and key not in seen:
            seen.add(key)
            combined.append(d)

    return {"success": True, "detected": combined}


@router.get("/api/teams/my-team", summary="Get current user's team affiliation and hub")
async def api_teams_my_team(
    player_id: Optional[str] = Query(None),
    game_system: Optional[str] = Query("40k"),
    request: Request = None
):
    svc = teams_hub_service.get_teams_hub_service()

    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "") if request else ""
    session_token = (request.cookies.get("session_token") if request else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    current_user = auth_mgr.get_session(session_token) if (session_token and auth_mgr) else None

    pid = (player_id or (current_user.get("player_id") if current_user else None) or (current_user.get("bcp_user_id") if current_user else None) or (current_user.get("id") if current_user else None) or "").strip()
    gs = (game_system or "40k").strip().lower()

    aff = svc.get_player_affiliation(pid)

    # Fallback to current_user.team or database if not explicitly affiliated in service
    if (not aff or not aff.get("team_id")) and current_user and current_user.get("team") and current_user["team"].lower() not in ("independent", "none", "n/a"):
        user_team = current_user["team"]
        hub = svc.get_team_hub(user_team, gs)
        if hub:
            aff = svc.confirm_player_affiliation(pid, hub["id"], current_user.get("display_name") or "Player")

    # Second fallback: check player_ratings table for team tag
    if (not aff or not aff.get("team_id")) and pid:
        try:
            db = get_database()
            if hasattr(db, "get_connection"):
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT team FROM player_ratings WHERE player_id = %s AND team IS NOT NULL AND TRIM(team) != '' LIMIT 1;", (pid,))
                        p_row = cur.fetchone()
                        if p_row and p_row[0] and p_row[0].lower() not in ("independent", "none", "n/a", "-"):
                            hub = svc.get_team_hub(p_row[0], gs)
                            if hub:
                                aff = svc.confirm_player_affiliation(pid, hub["id"], current_user.get("display_name") if current_user else "Player")
        except Exception as e:
            logger.debug(f"Notice querying player_ratings team for my-team: {e}")

    hub = None
    if aff and aff.get("team_id"):
        hub = svc.get_team_hub(aff["team_id"], gs)

    return {
        "success": True,
        "has_team": bool(aff and aff.get("team_id")),
        "affiliation": aff,
        "team": hub
    }


@router.post("/api/teams/confirm-affiliation", summary="Confirm official squad affiliation")
async def api_teams_confirm_affiliation(payload: Dict[str, Any], request: Request = None):
    svc = teams_hub_service.get_teams_hub_service()

    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "") if request else ""
    session_token = (request.cookies.get("session_token") if request else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    current_user = auth_mgr.get_session(session_token) if (session_token and auth_mgr) else None

    t_id = (payload.get("team_id") or "").strip()
    pid = (payload.get("player_id") or (current_user.get("player_id") if current_user else None) or (current_user.get("bcp_user_id") if current_user else None) or (current_user.get("id") if current_user else None) or "p_user").strip()
    pname = payload.get("player_name") or (current_user.get("display_name") if current_user else None) or (current_user.get("name") if current_user else None) or "Player"

    try:
        aff = svc.confirm_player_affiliation(pid, t_id, pname)
        if current_user:
            current_user["team"] = aff.get("team_name")

        # Persist team directly to Postgres users and player_ratings tables
        try:
            db = get_database()
            if hasattr(db, "get_connection"):
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("UPDATE users SET team = %s WHERE id = %s OR player_id = %s;", (aff.get("team_name"), pid, pid))
                        cur.execute("UPDATE player_ratings SET team = %s WHERE player_id = %s;", (aff.get("team_name"), pid))
        except Exception as e:
            logger.debug(f"DB update team notice: {e}")

        return {"success": True, "affiliation": aff}
    except Exception as e:
        logger.error(f"Error confirming team affiliation: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/teams/leave", summary="Leave team and compete as Independent")
async def api_teams_leave(payload: Dict[str, Any] = None, request: Request = None):
    svc = teams_hub_service.get_teams_hub_service()
    payload = payload or {}

    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "") if request else ""
    session_token = (request.cookies.get("session_token") if request else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    current_user = auth_mgr.get_session(session_token) if (session_token and auth_mgr) else None

    pid = (payload.get("player_id") or (current_user.get("player_id") if current_user else None) or (current_user.get("id") if current_user else None) or "p_user").strip()
    try:
        aff = svc.set_player_independent(pid)
        if current_user:
            current_user["team"] = None

        try:
            db = get_database()
            if hasattr(db, "get_connection"):
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("UPDATE users SET team = NULL WHERE id = %s OR player_id = %s;", (pid, pid))
        except Exception as e:
            logger.debug(f"DB leave team notice: {e}")

        return {"success": True, "affiliation": aff}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/teams/create", summary="Found a new team hub")
async def api_teams_create(payload: Dict[str, Any], request: Request = None):
    svc = teams_hub_service.get_teams_hub_service()

    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "") if request else ""
    session_token = (request.cookies.get("session_token") if request else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    current_user = auth_mgr.get_session(session_token) if (session_token and auth_mgr) else None

    if current_user and not payload.get("owner_player_id"):
        payload["owner_player_id"] = current_user.get("player_id") or current_user.get("id")
    if current_user and not payload.get("captain_name"):
        payload["captain_name"] = current_user.get("display_name") or current_user.get("name")

    try:
        res = svc.create_team(payload)
        return {"success": True, "team": res}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/teams/{team_id}", summary="Get detailed team hub")
async def api_team_hub(team_id: str, game_system: Optional[str] = Query("40k")):
    svc = teams_hub_service.get_teams_hub_service()
    gs = (game_system or "40k").strip().lower()
    hub = svc.get_team_hub(team_id, gs)
    if not hub:
        raise HTTPException(status_code=404, detail=f"Team {team_id} not found")
    return {"success": True, "team": hub}


@router.get("/api/teams/{team_id}/messages", summary="Get locker room messages")
async def api_team_messages(team_id: str):
    svc = teams_hub_service.get_teams_hub_service()
    hub = svc.get_team_hub(team_id)
    if not hub:
        raise HTTPException(status_code=404, detail="Team not found")
    locker = hub.get("locker_room", {})
    return {"messages": locker.get("messages", []), "pinned_message": locker.get("pinned_message")}


@router.post("/api/teams/{team_id}/messages", summary="Post locker room message")
async def api_team_post_message(team_id: str, payload: Dict[str, Any], request: Request = None):
    svc = teams_hub_service.get_teams_hub_service()
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "") if request else ""
    session_token = (request.cookies.get("session_token") if request else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    current_user = auth_mgr.get_session(session_token) if (session_token and auth_mgr) else None

    sender_id = payload.get("sender_player_id") or (current_user.get("player_id") if current_user else None) or "p_user"
    sender_name = payload.get("sender_name") or (current_user.get("display_name") if current_user else None) or "Player"
    msg = payload.get("message", "").strip()
    is_pinned = bool(payload.get("is_pinned", False))
    role = payload.get("role", "Member")

    try:
        res = svc.add_team_message(team_id, sender_id, sender_name, msg, role, is_pinned)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/teams/{team_id}/squad-events/attend", summary="Toggle squad event attendance")
async def api_team_squad_event_attend(team_id: str, payload: Dict[str, Any], request: Request = None):
    svc = teams_hub_service.get_teams_hub_service()
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "") if request else ""
    session_token = (request.cookies.get("session_token") if request else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    current_user = auth_mgr.get_session(session_token) if (session_token and auth_mgr) else None

    event_id = payload.get("event_id")
    pname = payload.get("player_name") or (current_user.get("display_name") if current_user else None) or "Teammate"
    try:
        res = svc.toggle_squad_event_attendance(team_id, event_id, pname)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/teams/{team_id}/members/remove", summary="Kick/remove member from squad")
async def api_team_remove_member(team_id: str, payload: Dict[str, Any], request: Request = None):
    svc = teams_hub_service.get_teams_hub_service()
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "") if request else ""
    session_token = (request.cookies.get("session_token") if request else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    current_user = auth_mgr.get_session(session_token) if (session_token and auth_mgr) else None

    actor_id = payload.get("actor_player_id") or (current_user.get("player_id") if current_user else None) or (current_user.get("id") if current_user else None) or "p_user"
    target_id = payload.get("target_player_id")
    try:
        res = svc.remove_member(team_id, actor_id, target_id)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/teams/{team_id}/members/invite", summary="Invite player to squad")
async def api_team_invite_member(team_id: str, payload: Dict[str, Any], request: Request = None):
    svc = teams_hub_service.get_teams_hub_service()
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "") if request else ""
    session_token = (request.cookies.get("session_token") if request else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    current_user = auth_mgr.get_session(session_token) if (session_token and auth_mgr) else None

    actor_id = payload.get("actor_player_id") or (current_user.get("player_id") if current_user else None) or (current_user.get("id") if current_user else None) or "p_user"
    target_id = payload.get("target_player_id")
    target_name = payload.get("target_player_name", "Teammate")
    faction = payload.get("faction", "Space Marines")
    try:
        res = svc.invite_player(team_id, actor_id, target_id, target_name, faction)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/teams/{team_id}/captain/transfer", summary="Transfer captaincy")
async def api_team_transfer_captaincy(team_id: str, payload: Dict[str, Any], request: Request = None):
    svc = teams_hub_service.get_teams_hub_service()
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "") if request else ""
    session_token = (request.cookies.get("session_token") if request else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    current_user = auth_mgr.get_session(session_token) if (session_token and auth_mgr) else None

    cur_capt_id = payload.get("current_captain_id") or (current_user.get("player_id") if current_user else None) or (current_user.get("id") if current_user else None) or "p_user"
    new_capt_id = payload.get("new_captain_id")
    try:
        res = svc.transfer_captaincy(team_id, cur_capt_id, new_capt_id)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/teams/{team_id}/captain/claim-inactive", summary="Claim inactive/AFK captaincy")
async def api_team_claim_inactive_captaincy(team_id: str, payload: Dict[str, Any], request: Request = None):
    svc = teams_hub_service.get_teams_hub_service()
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "") if request else ""
    session_token = (request.cookies.get("session_token") if request else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    current_user = auth_mgr.get_session(session_token) if (session_token and auth_mgr) else None

    claimant_id = payload.get("claimant_id") or (current_user.get("player_id") if current_user else None) or (current_user.get("id") if current_user else None) or "p_user"
    reason = payload.get("reason", "Leadership inactivity")
    try:
        res = svc.claim_inactive_captaincy(team_id, claimant_id, reason)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/teams/{team_id}/members/role", summary="Update squad member role")
async def api_team_update_member_role(team_id: str, payload: Dict[str, Any], request: Request = None):
    svc = teams_hub_service.get_teams_hub_service()
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "") if request else ""
    session_token = (request.cookies.get("session_token") if request else None) or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    current_user = auth_mgr.get_session(session_token) if (session_token and auth_mgr) else None

    actor_id = payload.get("actor_player_id") or (current_user.get("player_id") if current_user else None) or (current_user.get("id") if current_user else None) or "p_user"
    target_id = payload.get("target_player_id")
    new_role = payload.get("new_role", "Member")
    try:
        res = svc.update_member_role(team_id, actor_id, target_id, new_role)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
