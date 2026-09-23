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


_LEAGUE_DB_SYNCED = False

@router.get("/api/league/{league_id}", summary="Get full league data and active or historical season")
@router.get("/api/leagues/{league_id}", summary="Get full league data and active or historical season")
async def get_league_details(league_id: str, season: Optional[int] = None):
    global _LEAGUE_DB_SYNCED
    norm_lid = leagues_hub_service._normalize_league_id(league_id)
    if not _LEAGUE_DB_SYNCED:
        try:
            from core import get_database
            db = get_database()
            if hasattr(db, "sync_league_participant_identities"):
                db.sync_league_participant_identities(norm_lid, 38)
            _LEAGUE_DB_SYNCED = True
        except Exception as e:
            logger.warning(f"Auto league DB sync notice: {e}")

    svc = leagues_hub_service.get_leagues_hub_service()
    league = svc.get_league(norm_lid, season_number=season)
    if not league:
        raise HTTPException(status_code=404, detail=f"League '{league_id}' not found")
    return {
        "success": True,
        "league": league
    }


@router.get("/api/league/{league_id}/db-sync", summary="Force sync and audit Cloud SQL native_league_participants")
@router.post("/api/league/{league_id}/db-sync", summary="Force sync and audit Cloud SQL native_league_participants")
async def sync_and_audit_league_db(league_id: str, force_seed: bool = False):
    from core import get_database
    db = get_database()
    norm_lid = leagues_hub_service._normalize_league_id(league_id)
    if hasattr(db, "seed_sd40k_league_tables"):
        db.seed_sd40k_league_tables(force=force_seed)
    if hasattr(db, "sync_league_participant_identities"):
        db.sync_league_participant_identities(norm_lid, 38)

    rows_s38 = []
    fake_count = 0
    legacy_concat_id_count = 0
    total_count = 0
    try:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, season_num, pod_num, participant_name, primary_faction, bcp_player_id, user_id, is_db_matched, match_method
                    FROM native_league_participants
                    WHERE league_id = %s AND season_num = 38
                    ORDER BY pod_num ASC, participant_name ASC;
                """, (norm_lid,))
                for r in cur.fetchall():
                    rows_s38.append({
                        "id": r[0],
                        "season_num": r[1],
                        "pod_num": r[2],
                        "participant_name": r[3],
                        "primary_faction": r[4],
                        "bcp_player_id": r[5],
                        "user_id": r[6],
                        "is_db_matched": r[7],
                        "match_method": r[8]
                    })
                cur.execute("""
                    SELECT COUNT(*) FROM native_league_participants
                    WHERE LEFT(COALESCE(bcp_player_id, ''), 4) = 'bcp_'
                       OR LEFT(COALESCE(bcp_player_id, ''), 2) = 'p_'
                       OR LEFT(COALESCE(user_id, ''), 2) = 'u_';
                """)
                fake_count = cur.fetchone()[0]
                cur.execute("""
                    SELECT COUNT(*) FROM native_league_participants
                    WHERE LEFT(id, 7) = 'league_' OR LEFT(id, 3) = 'lg_';
                """)
                legacy_concat_id_count = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM native_league_participants;")
                total_count = cur.fetchone()[0]
    except Exception as e:
        return {"success": False, "error": str(e)}

    return {
        "success": True,
        "league_uuid": norm_lid,
        "total_participants_all_seasons": total_count,
        "fake_bcp_slug_count": fake_count,
        "legacy_concatenated_id_count": legacy_concat_id_count,
        "season_38_count": len(rows_s38),
        "season_38_matched_count": sum(1 for r in rows_s38 if r["is_db_matched"]),
        "season_38_unmatched_count": sum(1 for r in rows_s38 if not r["is_db_matched"]),
        "pod_1_rows": [r for r in rows_s38 if r["pod_num"] == 1],
        "pod_7_rows": [r for r in rows_s38 if r["pod_num"] == 7],
        "pod_8_rows": [r for r in rows_s38 if r["pod_num"] == 8]
    }


@router.get("/api/league/{league_id}/seasons", summary="Get catalog of all 38 historical seasons")
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


@router.get("/api/league/{league_id}/player/{player_name}/history", summary="Get player career history across all 38 seasons")
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


