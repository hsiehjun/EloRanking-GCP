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


@router.get("/api/league/{league_id}", summary="Get full league data and active or historical season")
async def get_league_details(league_id: str, season: Optional[int] = None):
    svc = leagues_hub_service.get_leagues_hub_service()
    league = svc.get_league(league_id, season_number=season)
    if not league:
        raise HTTPException(status_code=404, detail=f"League '{league_id}' not found")
    return {
        "success": True,
        "league": league
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
        result = svc.report_match(
            league_id=league_id,
            pod_number=int(body.get("pod_number", 1)),
            round_number=int(body.get("round_number", 1)),
            p1_name=body.get("p1_name", ""),
            p2_name=body.get("p2_name", ""),
            p1_score=int(body.get("p1_score", 0)),
            p2_score=int(body.get("p2_score", 0)),
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


