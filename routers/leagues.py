"""
Community Leagues Router for OmniTactica.

Authoritative FastAPI endpoints for SD40K and native community leagues, pods,
standings, pairings, and match score reporting.
100% isolated namespace from BCP tables.
"""

import logging
from typing import Any, Dict, Optional
from core import APIRouter, HTTPException, Request, Response
import leagues_hub_service

logger = logging.getLogger("LeaguesRouter")
router = APIRouter(tags=["Community Leagues"])


@router.get("/api/leagues", summary="Get list of active community leagues")
async def get_leagues_list():
    svc = leagues_hub_service.get_leagues_hub_service()
    leagues = svc.get_leagues_list()
    templates = svc.get_available_templates()
    return {
        "success": True,
        "leagues": leagues,
        "count": len(leagues),
        "available_templates": templates
    }


@router.get("/api/leagues/managed", summary="Get leagues owned or commissioned by the active Event Studio user")
async def get_managed_leagues_for_user(
    user_id: Optional[str] = None,
    player_id: Optional[str] = None,
    email: Optional[str] = None,
    display_name: Optional[str] = None,
    is_admin: bool = False
):
    svc = leagues_hub_service.get_leagues_hub_service()
    managed = svc.get_managed_leagues(
        user_id=user_id,
        player_id=player_id,
        email=email,
        display_name=display_name,
        is_admin=is_admin
    )
    return {
        "success": True,
        "leagues": managed,
        "count": len(managed)
    }


@router.post("/api/league/{league_id}/assign-owner", summary="Assign or update the owner/commissioner of a native league")
async def assign_league_owner(league_id: str, request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    svc = leagues_hub_service.get_leagues_hub_service()
    result = svc.assign_league_owner(
        league_id_or_slug=league_id,
        owner_user_id=body.get("owner_user_id"),
        owner_player_id=body.get("owner_player_id"),
        owner_email=body.get("owner_email"),
        owner_name=body.get("owner_name")
    )
    if result.get("status") == "error":
        raise HTTPException(status_code=404, detail=result.get("message", "League not found"))
    return result


@router.get("/api/league/{league_id}", summary="Get full league data and active or historical season")
@router.get("/api/leagues/{league_id}", summary="Get full league data and active or historical season")
async def get_league_details(league_id: str, season: Optional[int] = None):
    norm_lid = leagues_hub_service._normalize_league_id(league_id)
    svc = leagues_hub_service.get_leagues_hub_service()
    league = svc.get_league(norm_lid, season_number=season)
    if not league:
        raise HTTPException(status_code=404, detail=f"League '{league_id}' not found")
    return {
        "success": True,
        "league": league
    }


@router.post("/api/league/{league_id}/sync-participants", summary="Synchronize league participant DB identities and ownership")
@router.get("/api/league/{league_id}/db-sync", summary="Synchronize league participant DB identities and ownership")
@router.post("/api/league/{league_id}/db-sync", summary="Synchronize league participant DB identities and ownership")
async def sync_and_audit_league_db(league_id: str, force_seed: bool = False):
    from core import get_database
    db = get_database()
    norm_lid = leagues_hub_service._normalize_league_id(league_id)
    if force_seed:
        if hasattr(db, "seed_sd40k_league_tables"):
            db.seed_sd40k_league_tables(force=True)
        if hasattr(db, "seed_the_gauntlet_league_tables"):
            db.seed_the_gauntlet_league_tables(force=True)
    if hasattr(db, "sync_league_participant_identities"):
        db.sync_league_participant_identities(norm_lid, 38 if norm_lid == leagues_hub_service.SD40K_LEAGUE_UUID else 5)

    try:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, slug, name, owner_user_id, owner_player_id, owner_email, owner_name, active_season_num
                    FROM native_leagues
                    WHERE id = %s
                    LIMIT 1;
                """, (norm_lid,))
                l_row = cur.fetchone()
                cur.execute("""
                    SELECT COUNT(*),
                           SUM(CASE WHEN is_db_matched THEN 1 ELSE 0 END)
                    FROM native_league_participants
                    WHERE league_id = %s AND season_num = COALESCE(%s, 38);
                """, (norm_lid, l_row[7] if l_row else 38))
                counts = cur.fetchone()
    except Exception as e:
        return {"success": False, "error": str(e)}

    return {
        "success": True,
        "league_uuid": norm_lid,
        "slug": l_row[1] if l_row else None,
        "name": l_row[2] if l_row else None,
        "owner": {
            "owner_user_id": l_row[3] if l_row else None,
            "owner_player_id": l_row[4] if l_row else None,
            "owner_email": l_row[5] if l_row else None,
            "owner_name": l_row[6] if l_row else None
        },
        "active_season": int(l_row[7] or 38) if l_row else 38,
        "season_participants_count": int(counts[0] or 0) if counts else 0,
        "season_matched_count": int(counts[1] or 0) if counts else 0
    }


@router.get("/api/league/{league_id}/seasons", summary="Get catalog of all historical seasons")
async def get_league_seasons(league_id: str):
    svc = leagues_hub_service.get_leagues_hub_service()
    seasons = svc.get_seasons_catalog(league_id)
    return {
        "success": True,
        "league_id": league_id,
        "seasons": seasons,
        "count": len(seasons)
    }


@router.get("/api/league/{league_id}/season/{season_num}", summary="Get specific historical season")
async def get_league_season(league_id: str, season_num: int):
    svc = leagues_hub_service.get_leagues_hub_service()
    league = svc.get_league(league_id, season_number=season_num)
    if not league:
        raise HTTPException(status_code=404, detail=f"Season {season_num} not found in league '{league_id}'")
    return {
        "success": True,
        "league": league
    }


@router.get("/api/league/{league_id}/player/{player_name}/history", summary="Get player career history across all seasons")
async def get_player_league_history(league_id: str, player_name: str):
    svc = leagues_hub_service.get_leagues_hub_service()
    career = svc.get_player_career(league_id, player_name)
    return {
        "success": True,
        "player": career
    }


@router.get("/api/league/{league_id}/pod/{pod_num}", summary="Get specific pod data")
async def get_pod_details(league_id: str, pod_num: int):
    svc = leagues_hub_service.get_leagues_hub_service()
    pod = svc.get_pod(league_id, pod_num)
    if not pod:
        raise HTTPException(status_code=404, detail=f"Pod {pod_num} not found in league '{league_id}'")
    return {
        "success": True,
        "pod": pod
    }


@router.get("/api/league/player/{player_name}", summary="Get active league matches for a player")
async def get_player_leagues(player_name: str):
    svc = leagues_hub_service.get_leagues_hub_service()
    summary = svc.get_player_league_summary(player_name)
    return {
        "success": True,
        "player_name": player_name,
        "active_leagues": summary
    }


@router.post("/api/league/create", summary="Create a new community league from template")
async def create_community_league(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    svc = leagues_hub_service.get_leagues_hub_service()
    try:
        result = svc.create_league(body)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/league/{league_id}/config", summary="Update community league methodology, pod rules, and scoring configuration")
async def update_community_league_config(league_id: str, request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    svc = leagues_hub_service.get_leagues_hub_service()
    try:
        return svc.update_league_config(league_id, body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/league/{league_id}/match/report", summary="Report a completed league match score")
async def report_league_match(league_id: str, request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    svc = leagues_hub_service.get_leagues_hub_service()
    try:
        p1_name = body.get("p1_name") or body.get("player1") or ""
        p2_name = body.get("p2_name") or body.get("player2") or ""
        p1_score = int(body.get("p1_score") if body.get("p1_score") is not None else body.get("score1", 0))
        p2_score = int(body.get("p2_score") if body.get("p2_score") is not None else body.get("score2", 0))
        result = svc.report_match(
            league_id=league_id,
            pod_number=int(body.get("pod_number", 1)),
            round_number=int(body.get("round_number", 1)),
            p1_name=p1_name,
            p2_name=p2_name,
            p1_score=p1_score,
            p2_score=p2_score,
            scorecard_id=body.get("scorecard_id"),
            is_ringer=bool(body.get("is_ringer", False))
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/league/{league_id}/rollover/preview", summary="Preview 2-up / 2-down promotion & relegation for the active season")
async def get_league_rollover_preview(league_id: str, season: Optional[int] = None):
    svc = leagues_hub_service.get_leagues_hub_service()
    try:
        preview = svc.calculate_promotion_relegation(league_id, season_number=season)
        return preview
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/league/{league_id}/season/rollover", summary="Execute automated season rollover and seed next season")
async def execute_league_season_rollover(league_id: str, request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    svc = leagues_hub_service.get_leagues_hub_service()
    try:
        result = svc.rollover_season(league_id, options=body)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/league/{league_id}/register", summary="Register player into the active season's bottom division pod")
async def register_player_into_league(league_id: str, request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    svc = leagues_hub_service.get_leagues_hub_service()
    try:
        result = svc.register_player_for_league(league_id, player_data=body)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/league/{league_id}/registration-window", summary="Toggle or configure league registration window for Sparring Radar exposure")
async def update_league_registration_window(league_id: str, request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    svc = leagues_hub_service.get_leagues_hub_service()
    try:
        result = svc.set_registration_window(league_id, payload=body)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/league/{league_id}/participants", summary="Get season/pod participants with user_id and bcp_player_id matching status")
async def get_league_participants_endpoint(league_id: str, season: Optional[int] = None):
    svc = leagues_hub_service.get_leagues_hub_service()
    try:
        return svc.get_season_participants(league_id, season_number=season)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/league/{league_id}/claim-participant", summary="Link an existing user_id/bcp_player_id to a participant row or declare 'I'm in this league'")
async def claim_league_participant_endpoint(league_id: str, request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    svc = leagues_hub_service.get_leagues_hub_service()
    try:
        return svc.claim_or_link_participant(league_id, payload=body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/league/{league_id}/announcements", summary="Get official TO announcements for a league")
async def get_league_announcements_endpoint(league_id: str):
    svc = leagues_hub_service.get_leagues_hub_service()
    league = svc.get_league(league_id)
    if not league:
        raise HTTPException(status_code=404, detail=f"League '{league_id}' not found")
    return {
        "success": True,
        "league_id": league.get("league_id", league_id),
        "announcements": league.get("announcements", []),
        "count": len(league.get("announcements", []))
    }


@router.post("/api/league/{league_id}/announcements", summary="Create or update an official TO announcement for a league")
async def save_league_announcement_endpoint(league_id: str, request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    svc = leagues_hub_service.get_leagues_hub_service()
    res = svc.save_league_announcement(league_id, payload=body)
    if res.get("error"):
        raise HTTPException(status_code=400, detail=res["error"])
    return res


@router.delete("/api/league/{league_id}/announcements/{announcement_id}", summary="Delete a league announcement by ID")
async def delete_league_announcement_endpoint(league_id: str, announcement_id: str):
    svc = leagues_hub_service.get_leagues_hub_service()
    res = svc.delete_league_announcement(league_id, announcement_id)
    if res.get("error"):
        raise HTTPException(status_code=400, detail=res["error"])
    return res


@router.post("/api/league/{league_id}/season-schedule", summary="Update season dates, registration windows, and round terrain layouts")
async def update_league_season_schedule_endpoint(league_id: str, request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    svc = leagues_hub_service.get_leagues_hub_service()
    res = svc.update_season_schedule_and_layouts(league_id, payload=body)
    if res.get("error"):
        raise HTTPException(status_code=400, detail=res["error"])
    return res


@router.post("/api/league/{league_id}/pairings/update", summary="Reassign/swap pod pairings, assign Ringers, or override match scores")
async def update_league_pod_pairings_endpoint(league_id: str, request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    svc = leagues_hub_service.get_leagues_hub_service()
    res = svc.update_pod_pairing_or_score(league_id, payload=body)
    if res.get("error"):
        raise HTTPException(status_code=400, detail=res["error"])
    return res


@router.post("/api/league/{league_id}/roster/update", summary="Add/move pod players or assign disciplinary cards (Yellow/Red/Black)")
async def update_league_pod_roster_endpoint(league_id: str, request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    svc = leagues_hub_service.get_leagues_hub_service()
    res = svc.update_pod_roster_and_discipline(league_id, payload=body)
    if res.get("error"):
        raise HTTPException(status_code=400, detail=res["error"])
    return res


