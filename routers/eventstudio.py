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
    table: int
    round_num: int
    p1_score: int
    p2_score: int
    p1_name: Optional[str] = "Player 1"
    p2_name: Optional[str] = "Player 2"
    winner_id: Optional[str] = None
    source_app: Optional[str] = "EventStudio"
    game_details: Optional[Dict[str, Any]] = None
    bcp_token: Optional[str] = None

class CreateEventPayload(BaseModel):
    name: str
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
    ticket_price: Optional[int] = 0
    using_online_reg: Optional[bool] = False
    time_zone: Optional[str] = "America/Los_Angeles"
    bcp_token: Optional[str] = None
    event_type: Optional[str] = "Singles Event"  # "Singles Event", "Doubles Event", "Teams Event"
    team_size: Optional[int] = 1
    circuit_id: Optional[str] = None
    circuit_token: Optional[str] = None
    circuit_name: Optional[str] = None



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

class SwapPairingPayload(BaseModel):
    round: int = 1
    table1: int
    slot1: str = "p1"  # "p1" or "p2"
    table2: int
    slot2: str = "p2"  # "p1" or "p2"

class ApplyPairingsBcpPayload(BaseModel):
    round: int = 1

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
    user_email = (session.get("email") or "").strip().lower()
    admin_emails = ('swimgeek751@gmail.com',)
    is_admin = (user_role in ("admin", "superuser", "developer", "owner")) or (user_email in admin_emails)
    is_to = user_role in ("to", "organizer", "referee")
    if not (is_admin or is_to):
        raise HTTPException(
            status_code=403,
            detail="Tournament Organizer (TO) or Administrator role required to access Event Studio."
        )
    return session

@router.get("/api/eventstudio/events", summary="List organizer tournaments")
async def api_eventstudio_list_events(request: Request, bcp_token: Optional[str] = Query(None)):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]
    bcp_user_id = user.get("bcp_user_id")
    player_id = user.get("player_id")

    if not user_id and not bcp_user_id and not player_id:
        return {"success": True, "count": 0, "events": []}

    # Check BCP for any tournaments hosted by this organizer
    if user_id or bcp_token:
        try:
            start_range = "2025-09-01T07:00:00.000Z"
            end_range = "2027-09-02T06:59:59.999Z"
            sync_url = f"https://newprod-api.bestcoastpairings.com/v2/events?limit=50&eventSearchType=organizer&sortKey=eventDate&sortAscending=false&startDate={start_range}&endDate={end_range}"
            bcp_raw, err = execute_bcp_api_call(sync_url, method="GET", user_id=user_id, explicit_token=bcp_token)

            bcp_event_ids = set()
            bcp_sync_succeeded = False

            if bcp_raw:
                bcp_sync_succeeded = True
                items = bcp_raw.get("data", bcp_raw.get("events", [])) if isinstance(bcp_raw, dict) else bcp_raw
                for item in (items if isinstance(items, list) else []):
                    if not isinstance(item, dict): continue
                    bcp_id = str(item.get("id") or item.get("_id"))
                    if db.is_event_deleted(bcp_id):
                        continue
                    bcp_event_ids.add(bcp_id)
                    loc = item.get("location") if isinstance(item.get("location"), dict) else {}
                    
                    # Preserve existing local fields/roster/pairings if present
                    existing = db.get_studio_event(bcp_id) or {}
                    merged = {
                        **existing,
                        "id": bcp_id,
                        "name": existing.get("name") or item.get("name", "BCP Tournament"),
                        "tier": existing.get("tier") or item.get("eventType") or item.get("tier") or "Grand Tournament",
                        "event_date": existing.get("event_date") or item.get("eventDate") or item.get("startDate"),
                        "end_date": existing.get("end_date") or item.get("endDate") or item.get("eventEndDate"),
                        "city": existing.get("city") or item.get("city") or loc.get("city"),
                        "state": existing.get("state") or item.get("state") or loc.get("state"),
                        "country": existing.get("country") or item.get("country") or loc.get("country"),
                        "venue": existing.get("venue") or item.get("venueName") or loc.get("venueName") or loc.get("name"),
                        "num_rounds": existing.get("num_rounds") or item.get("numberOfRounds") or item.get("numRounds") or 5,
                        "points": existing.get("points") or item.get("points") or 2000,
                        "capacity": existing.get("capacity") or item.get("totalPlayers") or item.get("capacity") or 32,
                        "organizer_id": user_id,
                        "organizer_bcp_id": item.get("ownerId") or item.get("owner_Id") or bcp_user_id or player_id,
                        "bcp_synced": True,
                        "bcp_status": "synced"
                    }
                    db.save_studio_event(merged)

                # If BCP sync succeeded, inspect existing tournaments in OmniTactica:
                # If an event has a BCP ID but is no longer present in the organizer's active BCP events,
                # mark it as deleted on BCP (preserving it locally in OmniTactica)
                if bcp_sync_succeeded:
                    existing_events = db.get_studio_events(organizer_id=user_id, organizer_bcp_id=bcp_user_id, player_id=player_id)
                    for ev in existing_events:
                        ev_id = ev.get("id", "")
                        if not ev_id.startswith("ES-") and ev_id not in bcp_event_ids:
                            db.delete_studio_event(ev_id, organizer_id=user_id)
        except Exception as se:
            logger.info(f"Notice syncing BCP organizer events: {se}")

    # Fetch tournaments created by or explicitly linked to this user/TO
    events = db.get_studio_events(organizer_id=user_id, organizer_bcp_id=bcp_user_id, player_id=player_id)

    return {
        "success": True,
        "count": len(events),
        "events": events
    }

@router.get("/api/eventstudio/event/{event_id}", summary="Get tournament details, roster, and round pairings")
async def api_eventstudio_get_event(event_id: str, request: Request):
    db = get_database()
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    session_token = request.cookies.get("session_token") or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    user = auth_mgr.get_session(session_token) if session_token else None

    ev = db.get_studio_event(event_id)
    if not ev:
        # Try direct BCP lookup and auto-link
        try:
            import urllib.request, json
            bcp_url = f"{BCP_API_BASE}/events/{event_id}"
            req = urllib.request.Request(bcp_url, headers=DEFAULT_HEADERS)
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status == 200:
                    item = json.loads(resp.read().decode("utf-8"))
                    if isinstance(item, dict) and item.get("name"):
                        loc = item.get("location") if isinstance(item.get("location"), dict) else {}
                        saved = db.save_studio_event({
                            "id": str(item.get("id") or item.get("_id") or event_id),
                            "name": item.get("name", "BCP Tournament"),
                            "tier": item.get("eventType") or item.get("tier") or "Grand Tournament",
                            "event_date": item.get("eventDate") or item.get("startDate"),
                            "end_date": item.get("endDate") or item.get("eventEndDate"),
                            "city": item.get("city") or loc.get("city"),
                            "state": item.get("state") or loc.get("state"),
                            "country": item.get("country") or loc.get("country"),
                            "venue": item.get("venueName") or loc.get("venueName") or loc.get("name"),
                            "num_rounds": item.get("numberOfRounds") or item.get("numRounds") or 5,
                            "points": item.get("points") or 2000,
                            "capacity": item.get("totalPlayers") or item.get("capacity") or 32,
                            "organizer_id": user["id"] if user else None,
                            "organizer_bcp_id": item.get("ownerId") or item.get("owner_Id") or (user.get("bcp_user_id") if user else None),
                            "bcp_synced": True,
                            "bcp_status": "synced"
                        })
                        return {"success": True, "event": saved}
        except Exception as fe:
            logger.info(f"Direct BCP event fetch notice for {event_id}: {fe}")

        # Fallback to standard event lookup
        full_ev = db.get_tournament_details(event_id)
        if full_ev:
            return {"success": True, "event": full_ev}
        raise HTTPException(status_code=404, detail=f"Tournament '{event_id}' not found")

    # If it's a BCP event, check if it's still alive on BCP
    if not event_id.startswith("ES-") and ev.get("bcp_status") != "deleted_on_bcp":
        try:
            import urllib.request
            bcp_check_url = f"{BCP_API_BASE}/events/{event_id}"
            req = urllib.request.Request(bcp_check_url, headers=DEFAULT_HEADERS)
            try:
                with urllib.request.urlopen(req, timeout=5) as check_resp:
                    if check_resp.status == 200:
                        if not ev.get("bcp_synced"):
                            ev["bcp_synced"] = True
                            ev["bcp_status"] = "synced"
                            db.save_studio_event(ev)
            except urllib.error.HTTPError as che:
                if che.code in (404, 400, 410):
                    ev["bcp_status"] = "deleted_on_bcp"
                    ev["bcp_synced"] = False
                    db.save_studio_event(ev)
        except Exception:
            pass

    return {
        "success": True,
        "event": ev
    }

@router.post("/api/eventstudio/event/create", summary="Create new tournament and register to BCP")
async def api_eventstudio_create_event(payload: CreateEventPayload, request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]
    bcp_user_id = user.get("bcp_user_id")
    bcp_token = payload.bcp_token or (auth_mgr.get_valid_bcp_token(user_id) if user_id else None)

    event_id = f"ES-{secrets.token_hex(4).upper()}"
    bcp_created = False
    bcp_error = None

    # Attempt to register on Best Coast Pairings API if token provided
    if user_id or payload.bcp_token:
        try:
            bcp_url = f"{BCP_API_BASE}/events"
            
            tok_check = payload.bcp_token or (auth_mgr.get_valid_bcp_token(user_id) if user_id else None)
            claims = _decode_jwt_payload(tok_check) if tok_check else {}
            if not bcp_user_id:
                bcp_user_id = claims.get("sub") or claims.get("userId") or claims.get("custom:userId") or claims.get("username")

            # Format ISO timestamps for BCP
            s_date = payload.start_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
            e_date = payload.end_date or s_date
            event_date_iso = f"{s_date}T09:00:00.000Z" if len(s_date) == 10 else s_date
            end_date_iso = f"{e_date}T18:00:00.000Z" if len(e_date) == 10 else e_date
            
            tok_dict = auth_mgr.get_valid_bcp_tokens(user_id) if user_id else {}
            id_tok = tok_dict.get("id_token") or payload.bcp_token
            acc_tok = tok_dict.get("access_token") or payload.bcp_token or id_tok
            
            id_claims = _decode_jwt_payload(id_tok) if id_tok else {}
            acc_claims = _decode_jwt_payload(acc_tok) if acc_tok else {}

            # In BCP, ownerId must be the BCP userId attribute from the ID token or BCP profile
            bcp_owner_id = (
                id_claims.get("userId")
                or id_claims.get("custom:userId")
                or acc_claims.get("userId")
                or acc_claims.get("custom:userId")
            )

            sub_uuid = id_claims.get("sub") or acc_claims.get("sub") or (user.get("bcp_user_id") if user else None)

            # If no direct userId in claims, fetch BCP user profile
            if not bcp_owner_id and sub_uuid:
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

            game_sys = payload.game_system_id or DEFAULT_GAME_SYSTEM_ID
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
                "points": payload.points or 2000,
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
                "ticketPrice": int((payload.ticket_price or 0) * 100) if payload.using_online_reg else 0,
                "usingOnlineReg": bool(payload.using_online_reg),
                "shippingDetails": {"requested": False},
                "eventDescription": payload.mission_pack or "Created via OmniTactica Event Studio",
                "eventDescriptionMarkup": payload.mission_pack or "Created via OmniTactica Event Studio"
            }

            res_data, bcp_err = execute_bcp_api_call(
                bcp_url,
                method="POST",
                json_data=bcp_payload,
                user_id=user_id,
                explicit_token=acc_tok
            )

            # If 403 Access Denied, attempt retry with alternate sub_uuid or bcp_owner_id
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

                    # Submit to circuit if chosen
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

    # Save to local database
    circuits_list = []
    if payload.circuit_id:
        circuits_list.append({
            "id": payload.circuit_id,
            "name": payload.circuit_name or "Tournament Circuit",
            "linked_at": datetime.now(timezone.utc).isoformat()
        })

    is_doubles_local = payload.event_type == "Doubles Event"
    is_teams_local = payload.event_type == "Teams Event" or is_doubles_local
    team_sz_local = int(payload.team_size or (2 if is_doubles_local else (5 if is_teams_local else 1)))
    now_date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    start_date_str = str(payload.start_date or now_date_str)
    end_date_str = str(payload.end_date or start_date_str)

    saved = db.save_studio_event({
        "id": event_id,
        "name": payload.name,
        "tier": payload.tier,
        "event_type": "doubles" if is_doubles_local else ("teams" if is_teams_local else "singles"),
        "team_size": team_sz_local,
        "circuits": circuits_list,
        "event_date": start_date_str,
        "end_date": end_date_str,
        "city": payload.city,
        "state": payload.state,
        "country": payload.country,
        "venue": payload.venue,
        "venue_name": payload.venue,
        "address": payload.address or payload.venue,
        "postal_code": payload.postal_code,
        "lat": payload.lat,
        "lng": payload.lng,
        "place_id": payload.place_id,
        "num_rounds": payload.rounds,
        "points": payload.points,
        "capacity": payload.capacity,
        "mission_pack": payload.mission_pack,
        "organizer_id": user_id,
        "organizer_bcp_id": bcp_user_id,
        "roster": [],
        "pairings": {str(r): [] for r in range(1, (payload.rounds or 5) + 1)}
    })

    return {
        "success": True,
        "event_id": event_id,
        "bcp_registered": bcp_created,
        "bcp_error": bcp_error,
        "event": saved
    }



@router.put("/api/eventstudio/event/{event_id}", summary="Modify tournament details and push to BCP")
async def api_eventstudio_update_event(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    # Map date fields
    if "start_date" in payload and "event_date" not in payload:
        payload["event_date"] = payload["start_date"]

    for k, v in payload.items():
        ev[k] = v

    if "raw_json" in ev and isinstance(ev["raw_json"], dict):
        for k, v in payload.items():
            ev["raw_json"][k] = v

    saved = db.save_studio_event(ev)

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
        if "capacity" in payload: bcp_set_fields["totalPlayers"] = int(payload["capacity"])
        if "num_rounds" in payload or "rounds" in payload:
            bcp_set_fields["numberOfRounds"] = int(payload.get("num_rounds") or payload.get("rounds"))
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

        if bcp_set_fields:
            bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}"
            resp_data, err_msg = execute_bcp_api_call(bcp_url, method="POST", json_data={"set": bcp_set_fields}, user_id=user_id)
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

@router.get("/api/config/maps-key", summary="Get Google Maps client API key for Places Autocomplete")
async def api_get_maps_key():
    key = os.environ.get("GOOGLE_MAPS_API_KEY", GOOGLE_MAPS_API_KEY)
    return {"key": key}




@router.get("/api/eventstudio/locations/search", summary="Search verified cities for event creation")
async def api_eventstudio_search_locations(q: str = Query("")):
    query = q.strip().lower()
    if not query or len(query) < 2:
        return {"results": VERIFIED_TOURNAMENT_CITIES[:8]}
    
    matches = [
        c for c in VERIFIED_TOURNAMENT_CITIES
        if query in c["city"].lower() or query in c["label"].lower()
    ]
    
    # If fewer than 5 local matches, try geocoding API fallback
    if len(matches) < 5:
        try:
            import urllib.request, json
            url = f"https://photon.komoot.io/api/?q={urllib.parse.quote(q)}&limit=6&osm_tag=place:city&osm_tag=place:town"
            req = urllib.request.Request(url, headers={"User-Agent": "OmniTactica/1.0"})
            with urllib.request.urlopen(req, timeout=2) as resp:
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

    if len(matches) < 3:
        try:
            import urllib.request, json
            nom_url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(q)}&format=json&addressdetails=1&limit=6"
            req = urllib.request.Request(nom_url, headers={"User-Agent": "OmniTactica-Tournament-App/1.0"})
            with urllib.request.urlopen(req, timeout=2) as resp:
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

    return {"results": matches[:10]}

@router.get("/api/eventstudio/circuits", summary="Get available Warhammer 40k circuits from BCP")
async def api_eventstudio_get_circuits(request: Request):
    try:
        import urllib.request, json
        url = f"{BCP_API_BASE}/leagues?limit=50&gameSystemId={DEFAULT_GAME_SYSTEM_ID}&active=true"
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
        return {"success": True, "circuits": [
            {"id": "NvjgICBwiP", "name": "ITC - Independent Tournament Circuit"},
            {"id": "247D2CRUW2", "name": "The U.K. Tournament Circuit (UKTC)"},
            {"id": "FHM0PJHRE7", "name": "California Championship Circuit"},
            {"id": "D6XLCWELAP", "name": "Northeast 40k Tournament Circuit"},
            {"id": "0J24UL9C46", "name": "The Great Lakes 40K Circuit"},
            {"id": "VHAD284QP4", "name": "The France Tournament Circuit"}
        ]}

@router.get("/api/eventstudio/event/{event_id}/circuits", summary="Get circuits linked to this event")
async def api_eventstudio_get_event_circuits(event_id: str, request: Request):
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
async def api_eventstudio_submit_circuit(event_id: str, payload: SubmitCircuitPayload, request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

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

    return {"success": True, "bcp_synced": bcp_ok, "circuits": circuits}

@router.delete("/api/eventstudio/event/{event_id}", summary="Delete tournament from Event Studio and BCP")
async def api_eventstudio_delete_event(event_id: str, request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]
    bcp_token = auth_mgr.get_valid_bcp_token(user_id) if user_id else None

    db.delete_studio_event(event_id, organizer_id=user_id)

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
        "bcp_deleted": bcp_deleted,
        "message": "Tournament deleted successfully."
    }

@router.post("/api/eventstudio/event/{event_id}/start", summary="Start tournament on OmniTactica and BCP")
async def api_eventstudio_start_event(event_id: str, request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

    ev = db.get_studio_event(event_id)
    if not ev:
        details = db.get_event_details(event_id)
        if details:
            ev = db.save_studio_event(details)
        else:
            raise HTTPException(status_code=404, detail="Tournament not found")

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
            ev["pairings_status"] = "staged"
        except Exception as pe:
            logger.warning(f"Notice auto-generating round 1 pairings on start: {pe}")

    bcp_started = False
    bcp_err = None
    if not event_id.startswith("ES-"):
        bcp_token = None
        if user_id:
            bcp_token = auth_mgr.get_valid_bcp_token(user_id)
        if not bcp_token and ev.get("organizer_id"):
            bcp_token = auth_mgr.get_valid_bcp_token(ev.get("organizer_id"))

        bcp_started, bcp_err, bcp_res = bcp_adapter.start_event_or_generate_pairings(
            event_id,
            user_id=user_id,
            explicit_token=bcp_token,
            is_league=bool(ev.get("is_league") or ev.get("leagueEvent"))
        )
        if bcp_started:
            ev["pairings_bcp_synced"] = True

    saved = db.save_studio_event(ev)

    return {
        "success": True,
        "event_id": event_id,
        "started": True,
        "current_round": ev.get("current_round", 1),
        "bcp_started": bcp_started,
        "bcp_notice": bcp_err if not bcp_started and not event_id.startswith("ES-") else None,
        "event": saved,
        "message": "Tournament started successfully! Round 1 is active."
    }

@router.post("/api/eventstudio/event/{event_id}/register", summary="Register player for tournament on OmniTactica and BCP")
@router.post("/api/tournaments/{event_id}/register", summary="Self-register player for tournament")
@router.post("/api/event/{event_id}/register", summary="Register player for tournament")
async def api_eventstudio_register_player(event_id: str, payload: RegisterPlayerPayload, request: Request):
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
        else:
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

    email = (payload.email or (user.get("email") if user else "") or "").strip()
    faction = (payload.faction or "Unassigned").strip()
    detachment = (payload.detachment or "").strip()
    team = (payload.team or "").strip()
    army_list = (payload.army_list or "").strip()
    checked_in = True if payload.checked_in is None else bool(payload.checked_in)

    # Generate or resolve player ID
    player_id = None
    if user:
        player_id = user.get("player_id") or user.get("bcp_user_id")

    # Look up Elo rating in DB
    player_elo = 1500.0
    with db.get_connection() as conn:
        with conn.cursor() as cur:
            if player_id:
                cur.execute("SELECT current_elo, player_name FROM player_ratings WHERE player_id = %s LIMIT 1;", (player_id,))
                p_row = cur.fetchone()
                if p_row:
                    player_elo = float(p_row[0] or 1500.0)
            if player_elo == 1500.0 and full_name:
                cur.execute("SELECT player_id, current_elo FROM player_ratings WHERE LOWER(player_name) = LOWER(%s) LIMIT 1;", (full_name,))
                p_row = cur.fetchone()
                if p_row:
                    if not player_id and p_row[0]:
                        player_id = str(p_row[0])
                    player_elo = float(p_row[1] or 1500.0)

    if not player_id:
        player_id = f"PL-{secrets.token_hex(4).upper()}"

    # Reflect registration on Best Coast Pairings API
    bcp_registered = False
    bcp_err = None
    if not event_id.startswith("ES-"):
        bcp_token = payload.bcp_token
        if not bcp_token and user_id:
            bcp_token = auth_mgr.get_valid_bcp_token(user_id)
        if not bcp_token and ev.get("organizer_id"):
            bcp_token = auth_mgr.get_valid_bcp_token(ev.get("organizer_id"))

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
            "userId": user.get("bcp_user_id") if user else None
        }

        bcp_registered, bcp_err, bcp_resp = bcp_adapter.register_player(
            event_id,
            player_data_for_bcp,
            user_id=user_id,
            explicit_token=bcp_token,
            is_team=bool(ev.get("team_size", 1) > 1 or ev.get("event_type") in ("Teams Event", "Doubles Event"))
        )

    # Update OmniTactica roster
    roster = list(ev.get("roster") or [])
    existing_idx = next(
        (i for i, p in enumerate(roster) if str(p.get("id") or "") == player_id or (p.get("name") or "").strip().lower() == full_name.lower()),
        -1
    )

    player_record = {
        "id": player_id,
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
    ev["total_players"] = len(roster)
    saved = db.save_studio_event(ev)

    try:
        db.upsert_event_participant(
            event_id=event_id,
            player_id=player_id,
            first_name=fn,
            last_name=ln,
            full_name=full_name,
            faction=faction,
            team=team,
            dropped=False,
            checked_in=checked_in
        )
    except Exception as pe:
        logger.warning(f"Error upserting participant: {pe}")

    if hasattr(api_events_recommended, "_roster_cache") and event_id in api_events_recommended._roster_cache:
        del api_events_recommended._roster_cache[event_id]

    return {
        "success": True,
        "event_id": event_id,
        "player": player_record,
        "total_players": len(roster),
        "bcp_synced": bcp_registered,
        "bcp_notice": bcp_err if not bcp_registered and not event_id.startswith("ES-") else None,
        "event": saved,
        "message": f"Successfully registered {full_name} for tournament."
    }

@router.post("/api/eventstudio/event/{event_id}/pairings", summary="Save round pairings and sync game rooms")
async def api_eventstudio_save_pairings(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

    round_num = str(payload.get("round") or payload.get("round_num") or 1)
    pairings_list = payload.get("pairings") or []

    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    pairings_map = ev.get("pairings") or {}

    # Enrich pairings with Elo win probability and rematch warnings if missing
    roster_map = {str(p.get("id") or p.get("name")): p for p in (ev.get("roster") or [])}
    for p in pairings_list:
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
                            try: rematch_r.append(int(prev_r))
                            except Exception: pass
            p["is_rematch"] = len(rematch_r) > 0
            p["rematch_rounds"] = sorted(rematch_r)

    pairings_map[round_num] = pairings_list
    ev["pairings"] = pairings_map
    ev["current_round"] = int(round_num)
    ev["pairings_status"] = "staged"

    # Pre-seed deterministic tracker rooms for each table
    for p in pairings_list:
        t_num = p.get("table") or 1
        mid = f"BCP-{event_id}-R{round_num}-T{t_num}".upper()
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
async def api_eventstudio_save_roster(event_id: str, payload: Dict[str, Any], request: Request):
    _get_to_session_or_403(request)
    db = get_database()
    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    roster = payload.get("roster") or []
    ev["roster"] = roster
    ev["total_players"] = len(roster)
    saved = db.save_studio_event(ev)

    return {
        "success": True,
        "roster_count": len(roster),
        "event": saved
    }

def generate_swiss_pairings_for_event(ev: Dict[str, Any], target_round: int) -> List[Dict[str, Any]]:
    """
    Computes Elo-enhanced Swiss pairings with rematch and team conflict avoidance.
    Can be called during event start (round 1) or subsequent rounds.
    """
    roster = [p for p in (ev.get("roster") or []) if not p.get("dropped")]
    if not roster or len(roster) < 2:
        return []

    pairings_map = ev.get("pairings") or {}

    # Calculate historical records and past opponents
    records: Dict[str, Dict[str, Any]] = {}
    past_opponents: Dict[str, set] = {}
    for p in roster:
        pid = str(p.get("id") or p.get("player_id") or p.get("name"))
        records[pid] = {
            "player": p,
            "wins": 0,
            "losses": 0,
            "draws": 0,
            "points": 0,
            "battle_points": 0,
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
            p1_id = str(match.get("p1_id") or match.get("p1_name") or "")
            p2_id = str(match.get("p2_id") or match.get("p2_name") or "")
            p1_s = int(match.get("p1_score") or 0)
            p2_s = int(match.get("p2_score") or 0)
            is_bye = bool(match.get("is_bye") or not p2_id)

            if p1_id in records:
                records[p1_id]["battle_points"] += p1_s
                if is_bye:
                    records[p1_id]["wins"] += 1
                    records[p1_id]["points"] += 3
                    records[p1_id]["byes"] += 1
                elif p1_s > p2_s:
                    records[p1_id]["wins"] += 1
                    records[p1_id]["points"] += 3
                    records[p1_id]["path_to_victory"] += (10 ** (10 - r_num))
                elif p1_s < p2_s:
                    records[p1_id]["losses"] += 1
                else:
                    records[p1_id]["draws"] += 1
                    records[p1_id]["points"] += 1

            if p2_id and p2_id in records and not is_bye:
                records[p2_id]["battle_points"] += p2_s
                past_opponents[p1_id].add(p2_id)
                past_opponents[p2_id].add(p1_id)
                if p2_s > p1_s:
                    records[p2_id]["wins"] += 1
                    records[p2_id]["points"] += 3
                    records[p2_id]["path_to_victory"] += (10 ** (10 - r_num))
                elif p2_s < p1_s:
                    records[p2_id]["losses"] += 1
                else:
                    records[p2_id]["draws"] += 1
                    records[p2_id]["points"] += 1

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

    # Handle Bye for odd players count
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

    # Swiss pairing algorithm (greedy with rematch avoidance and team conflict avoidance)
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

    # Format pairings list with Elo win probabilities and rematch warnings
    generated_pairings = []
    table_num = int(ev.get("startingTable") or 1)
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
            if int(prev_r) < target_round:
                for pm in (p_list or []):
                    ids = {str(pm.get("p1_id") or ""), str(pm.get("p2_id") or "")}
                    if p1_id in ids and p2_id in ids:
                        try:
                            rematch_r.append(int(prev_r))
                        except Exception:
                            pass

        generated_pairings.append({
            "table": table_num,
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
            "is_rematch": is_rematch,
            "rematch_rounds": sorted(rematch_r),
            "same_team": same_team,
            "is_done": False,
            "is_bye": False
        })
        table_num += 1

    if bye_player:
        b_elo = float(bye_player.get("elo") or bye_player.get("current_elo") or bye_player.get("currentElo") or 1500.0)
        generated_pairings.append({
            "table": table_num,
            "p1_id": str(bye_player.get("id") or bye_player.get("player_id") or bye_player.get("name")),
            "p1_name": bye_player.get("name") or "Player",
            "p1_faction": bye_player.get("faction") or "Unknown Faction",
            "p1_team": bye_player.get("team") or "",
            "p1_elo": round(b_elo, 1),
            "p1_win_prob": 100.0,
            "p1_army_list": bye_player.get("army_list") or "",
            "p1_score": 100,
            "p2_id": None,
            "p2_name": "BYE",
            "p2_faction": "",
            "p2_team": "",
            "p2_elo": 0.0,
            "p2_win_prob": 0.0,
            "p2_army_list": "",
            "p2_score": 0,
            "is_rematch": False,
            "rematch_rounds": [],
            "same_team": False,
            "is_done": True,
            "is_bye": True
        })

    return generated_pairings

@router.post("/api/eventstudio/event/{event_id}/pairings/generate", summary="Generate automated Swiss pairings for tournament round (staged locally)")
async def api_eventstudio_generate_pairings(event_id: str, payload: Dict[str, Any], request: Request):
    _get_to_session_or_403(request)
    db = get_database()
    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

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

    return {
        "success": True,
        "round": target_round,
        "pairings": generated_pairings,
        "pairings_status": "staged",
        "bcp_generated": False,
        "event": saved,
        "message": f"Generated Round {target_round} Swiss pairings (staged locally). TO can inspect, swap players, and apply to BCP."
    }

@router.post("/api/eventstudio/event/{event_id}/pairings/swap", summary="Dynamically swap two competitors between tables before applying to BCP")
async def api_eventstudio_swap_pairings(event_id: str, payload: SwapPairingPayload, request: Request):
    _get_to_session_or_403(request)
    db = get_database()
    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    r_str = str(payload.round)
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

    # Recalculate win probabilities and warnings for both modified tables
    for m in (m1, m2):
        e1 = float(m.get("p1_elo") or 1500.0)
        e2 = float(m.get("p2_elo") or 1500.0)
        m["p1_win_prob"] = round(1.0 / (1.0 + 10.0 ** ((e2 - e1) / 400.0)) * 100.0, 1)
        m["p2_win_prob"] = round(100.0 - m["p1_win_prob"], 1)

        t1 = (m.get("p1_team") or "").strip().lower()
        t2 = (m.get("p2_team") or "").strip().lower()
        m["same_team"] = bool(t1 and t2 and t1 == t2)

        pid1 = str(m.get("p1_id") or "")
        pid2 = str(m.get("p2_id") or "")
        rematch_r = []
        for prev_r, p_list in pairings_map.items():
            if prev_r != r_str:
                for pm in (p_list or []):
                    ids = {str(pm.get("p1_id") or ""), str(pm.get("p2_id") or "")}
                    if pid1 in ids and pid2 in ids:
                        try: rematch_r.append(int(prev_r))
                        except Exception: pass
        m["is_rematch"] = len(rematch_r) > 0
        m["rematch_rounds"] = sorted(rematch_r)

    ev["pairings"][r_str] = round_pairings
    ev["pairings_status"] = "staged"
    saved = db.save_studio_event(ev)

    return {
        "success": True,
        "round": payload.round,
        "pairings": round_pairings,
        "pairings_status": "staged",
        "message": f"Successfully swapped Table {payload.table1} ({payload.slot1.upper()}) and Table {payload.table2} ({payload.slot2.upper()}).",
        "event": saved
    }

@router.post("/api/eventstudio/event/{event_id}/pairings/apply_bcp", summary="Apply staged tournament pairings to Best Coast Pairings")
async def api_eventstudio_apply_pairings_bcp(event_id: str, payload: ApplyPairingsBcpPayload, request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    round_num = str(payload.round)
    pairings_map = ev.get("pairings") or {}
    pairings_list = pairings_map.get(round_num) or []
    if not pairings_list:
        raise HTTPException(status_code=400, detail=f"No pairings found for Round {round_num}")

    # Pre-seed deterministic tracker rooms for each table
    for p in pairings_list:
        t_num = p.get("table") or 1
        mid = f"BCP-{event_id}-R{round_num}-T{t_num}".upper()
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

    # Push to BCP
    bcp_pushed = False
    bcp_err = None
    if not event_id.startswith("ES-"):
        bcp_token = None
        if user_id:
            bcp_token = auth_mgr.get_valid_bcp_token(user_id)
        if not bcp_token and ev.get("organizer_id"):
            bcp_token = auth_mgr.get_valid_bcp_token(ev.get("organizer_id"))

        bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}/rounds/{round_num}/pairings"
        data, err = execute_bcp_api_call(bcp_url, method="POST", json_data={"pairings": pairings_list}, user_id=user_id, explicit_token=bcp_token)
        if data is not None or not err:
            bcp_pushed = True
            logger.info(f"✅ Pushed Round {round_num} pairings to BCP for {event_id}")
        else:
            bcp_err = err
            bcp_url2 = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}/pairings"
            data2, err2 = execute_bcp_api_call(bcp_url2, method="POST", json_data={"round": int(round_num), "pairings": pairings_list}, user_id=user_id, explicit_token=bcp_token)
            if data2 is not None or not err2:
                bcp_pushed = True
                logger.info(f"✅ Pushed Round {round_num} pairings to BCP fallback for {event_id}")

    ev["pairings_status"] = "applied"
    ev["pairings_bcp_synced"] = bcp_pushed
    saved = db.save_studio_event(ev)

    return {
        "success": True,
        "round": int(round_num),
        "pairings_count": len(pairings_list),
        "bcp_applied": bcp_pushed,
        "bcp_notice": bcp_err if not bcp_pushed and not event_id.startswith("ES-") else None,
        "pairings_status": "applied",
        "event": saved,
        "message": f"Round {round_num} pairings successfully applied to Best Coast Pairings!"
    }

@router.post("/api/eventstudio/event/{event_id}/pairings/publish", summary="Publish tournament round pairings on OmniTactica and BCP")
async def api_eventstudio_publish_pairings(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    round_num = int(payload.get("round") or ev.get("current_round") or 1)
    ev["published_round"] = round_num
    ev["is_published"] = True
    saved = db.save_studio_event(ev)

    # Sync publish to BCP
    bcp_published = False
    if user_id and not event_id.startswith("ES-"):
        bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}/publishPairings"
        resp_data, err_msg = execute_bcp_api_call(bcp_url, method="POST", json_data={"round": round_num}, user_id=user_id)
        if resp_data is not None or not err_msg:
            bcp_published = True
            logger.info(f"✅ Successfully published Round {round_num} pairings on BCP for event {event_id}")

    return {
        "success": True,
        "round": round_num,
        "bcp_published": bcp_published,
        "event": saved,
        "message": f"Round {round_num} pairings published successfully."
    }

@router.post("/api/eventstudio/event/{event_id}/pairings/unpublish", summary="Unpublish tournament round pairings on OmniTactica and BCP")
async def api_eventstudio_unpublish_pairings(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    round_num = int(payload.get("round") or ev.get("current_round") or 1)
    ev["is_published"] = False
    saved = db.save_studio_event(ev)

    # Sync unpublish to BCP
    bcp_unpublished = False
    if user_id and not event_id.startswith("ES-"):
        bcp_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{event_id}/unPublishPairings"
        resp_data, err_msg = execute_bcp_api_call(bcp_url, method="POST", json_data={"round": round_num}, user_id=user_id)
        if resp_data is not None or not err_msg:
            bcp_unpublished = True
            logger.info(f"✅ Successfully unpublished Round {round_num} pairings on BCP for event {event_id}")

    return {
        "success": True,
        "round": round_num,
        "bcp_unpublished": bcp_unpublished,
        "event": saved,
        "message": f"Round {round_num} pairings unpublished."
    }

@router.post("/api/eventstudio/event/{event_id}/round/finalize", summary="Finalize and lock round, advancing tournament round")
async def api_eventstudio_finalize_round(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    round_num = int(payload.get("round") or ev.get("current_round") or 1)
    total_rounds = int(ev.get("num_rounds") or 3)
    
    # Advance current round if not at end
    next_round = min(round_num + 1, total_rounds)
    ev["current_round"] = next_round
    saved = db.save_studio_event(ev)

    # Sync finalize to BCP
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
async def api_eventstudio_reset_round(event_id: str, payload: Dict[str, Any], request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    round_num = int(payload.get("round") or ev.get("current_round") or 1)
    ev["current_round"] = max(1, round_num)
    saved = db.save_studio_event(ev)

    # Sync reset to BCP
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
async def api_eventstudio_end_tournament(event_id: str, request: Request):
    user = _get_to_session_or_403(request)
    db = get_database()
    auth_mgr = get_auth_manager()
    user_id = user["id"]

    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    ev["is_ended"] = True
    saved = db.save_studio_event(ev)

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
        "event": saved,
        "message": "Tournament concluded and archived successfully."
    }

@router.get("/api/eventstudio/event/{event_id}/standings", summary="Compute live Swiss standings and tiebreaker metrics")
async def api_eventstudio_get_standings(event_id: str, request: Request):
    db = get_database()
    ev = db.get_studio_event(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    roster = ev.get("roster") or []
    pairings_map = ev.get("pairings") or {}

    # 1. Compute round-by-round statistics
    player_stats = {}
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
            "swiss_points": 0,
            "path_to_victory": 0,
            "battle_points": 0,
            "battle_points_diff": 0,
            "opponents": [],
            "rounds_played": 0
        }

    for r_str, r_pairings in sorted(pairings_map.items(), key=lambda x: int(x[0]) if str(x[0]).isdigit() else 0):
        try:
            r_num = int(r_str)
        except Exception:
            continue
        for match in (r_pairings or []):
            p1_id = str(match.get("p1_id") or match.get("p1_name") or "")
            p2_id = str(match.get("p2_id") or match.get("p2_name") or "")
            p1_s = int(match.get("p1_score") or 0)
            p2_s = int(match.get("p2_score") or 0)
            is_done = bool(match.get("is_done") or p1_s > 0 or p2_s > 0)
            is_bye = bool(match.get("is_bye") or not p2_id)

            if is_done and p1_id in player_stats:
                player_stats[p1_id]["rounds_played"] += 1
                player_stats[p1_id]["battle_points"] += p1_s
                player_stats[p1_id]["battle_points_diff"] += (p1_s - p2_s)
                if is_bye:
                    player_stats[p1_id]["wins"] += 1
                    player_stats[p1_id]["swiss_points"] += 3
                    player_stats[p1_id]["path_to_victory"] += (10 ** (10 - r_num))
                elif p1_s > p2_s:
                    player_stats[p1_id]["wins"] += 1
                    player_stats[p1_id]["swiss_points"] += 3
                    player_stats[p1_id]["path_to_victory"] += (10 ** (10 - r_num))
                elif p1_s < p2_s:
                    player_stats[p1_id]["losses"] += 1
                else:
                    player_stats[p1_id]["draws"] += 1
                    player_stats[p1_id]["swiss_points"] += 1

            if is_done and p2_id and p2_id in player_stats and not is_bye:
                player_stats[p1_id]["opponents"].append(p2_id)
                player_stats[p2_id]["opponents"].append(p1_id)
                player_stats[p2_id]["rounds_played"] += 1
                player_stats[p2_id]["battle_points"] += p2_s
                player_stats[p2_id]["battle_points_diff"] += (p2_s - p1_s)
                if p2_s > p1_s:
                    player_stats[p2_id]["wins"] += 1
                    player_stats[p2_id]["swiss_points"] += 3
                    player_stats[p2_id]["path_to_victory"] += (10 ** (10 - r_num))
                elif p2_s < p1_s:
                    player_stats[p2_id]["losses"] += 1
                else:
                    player_stats[p2_id]["draws"] += 1
                    player_stats[p2_id]["swiss_points"] += 1

    # 2. Compute Opponent Win % (Strength of Schedule)
    for pid, stats in player_stats.items():
        opp_win_rates = []
        for opp_id in stats["opponents"]:
            if opp_id in player_stats:
                opp = player_stats[opp_id]
                tot = max(1, opp["rounds_played"])
                wr = (opp["wins"] + (0.5 * opp["draws"])) / tot
                opp_win_rates.append(max(0.33, wr))
        stats["opp_win_rate_sos"] = round((sum(opp_win_rates) / max(1, len(opp_win_rates))) * 100.0, 1) if opp_win_rates else 33.0

    # 3. Sort Standings by Swiss Points -> Path to Victory -> SoS -> Battle Points
    standings = sorted(
        player_stats.values(),
        key=lambda s: (
            -s["swiss_points"],
            -s["path_to_victory"],
            -s["opp_win_rate_sos"],
            -s["battle_points"],
            -s["battle_points_diff"]
        )
    )

    for idx, item in enumerate(standings, 1):
        item["rank"] = idx

    return {
        "success": True,
        "event_id": event_id,
        "total_players": len(standings),
        "standings": standings
    }

@router.post("/api/eventstudio/submit_score", summary="Submit table match score and sync with BCP")
async def api_eventstudio_submit_score(payload: SubmitScorePayload, request: Request):
    db = get_database()
    auth_mgr = get_auth_manager()
    auth_header = request.headers.get("Authorization", "")
    token = payload.bcp_token or (auth_header[7:] if auth_header.startswith("Bearer ") else None)
    
    # If user has a native session with linked BCP token
    session_token = request.cookies.get("session_token")
    user = auth_mgr.get_session(session_token) if session_token else None
    user_id = user["id"] if user else None
    if not token and user:
        token = auth_mgr.get_valid_bcp_token(user_id)

    logger.info(f"EventStudio: Submitting Table {payload.table} Round {payload.round_num} Score ({payload.p1_score} - {payload.p2_score}) Source: {payload.source_app}")
    
    # 1. Update OmniTactica Local Studio Event Database FIRST (Local-First Guarantee)
    ev = db.get_studio_event(payload.event_id)
    bcp_pairing_id = None
    if ev:
        pairings_map = ev.get("pairings") or {}
        round_pairings = pairings_map.get(str(payload.round_num)) or []
        for match in round_pairings:
            if match.get("table") == payload.table:
                match["p1_score"] = payload.p1_score
                match["p2_score"] = payload.p2_score
                match["is_done"] = True
                bcp_pairing_id = match.get("bcp_pairing_id") or match.get("id")
                break
        pairings_map[str(payload.round_num)] = round_pairings
        ev["pairings"] = pairings_map
        db.save_studio_event(ev)

    # 2. Push to BCP via BcpAdapter if linked
    bcp_synced = False
    bcp_notice = None
    if token and not payload.event_id.startswith("ES-"):
        pairing_target = bcp_pairing_id or str(payload.table)
        bcp_synced, bcp_err = bcp_adapter.submit_pairing_scores(
            pairing_id=pairing_target,
            p1_score=payload.p1_score,
            p2_score=payload.p2_score,
            game_data=payload.game_details or {},
            user_id=user_id,
            explicit_token=token
        )
        if not bcp_synced:
            bcp_notice = bcp_err

    return {
        "success": True,
        "event_id": payload.event_id,
        "table": payload.table,
        "round_num": payload.round_num,
        "p1_score": payload.p1_score,
        "p2_score": payload.p2_score,
        "source_app": payload.source_app,
        "bcp_synced": bcp_synced,
        "bcp_notice": bcp_notice
    }

class JudgeCallCreatePayload(BaseModel):
    event_id: str
    table_num: Optional[int] = None
    match_id: Optional[str] = None
    player_name: Optional[str] = "Competitor"
    category: Optional[str] = "Rules Dispute"
    note: Optional[str] = ""

class JudgeCallResolvePayload(BaseModel):
    call_id: str
    status: Optional[str] = "resolved"

@router.post("/api/eventstudio/judge_call", summary="Submit judge / TO floor assistance call from game room")
async def api_eventstudio_create_judge_call(payload: JudgeCallCreatePayload):
    db = get_database()
    res = db.create_judge_call(
        event_id=payload.event_id,
        table_num=payload.table_num,
        match_id=payload.match_id,
        player_name=payload.player_name or "Competitor",
        category=payload.category or "Rules Dispute",
        note=payload.note or ""
    )
    return {"success": True, "call": res}

@router.get("/api/eventstudio/judge_calls", summary="List active judge calls for a tournament")
async def api_eventstudio_get_judge_calls(event_id: str, active_only: bool = False):
    db = get_database()
    calls = db.get_judge_calls(event_id=event_id, active_only=active_only)
    return {"success": True, "event_id": event_id, "calls": calls}

@router.post("/api/eventstudio/judge_call/resolve", summary="Update judge call status (en_route, resolved)")
async def api_eventstudio_resolve_judge_call(payload: JudgeCallResolvePayload):
    db = get_database()
    ok = db.resolve_judge_call(call_id=payload.call_id, status=payload.status or "resolved")
    return {"success": ok, "call_id": payload.call_id, "status": payload.status}

class PodGeneratePayload(BaseModel):
    pod_size: Optional[int] = 4
    num_pods: Optional[int] = 2
    target_round: Optional[int] = None

@router.post("/api/eventstudio/event/{event_id}/pods/generate", summary="Automate multi-day Pod & Bracket progression")
async def api_eventstudio_generate_pods(event_id: str, payload: PodGeneratePayload):
    db = get_database()
    res = db.generate_day2_pod_brackets(
        event_id=event_id,
        pod_size=payload.pod_size or 4,
        num_pods=payload.num_pods or 2,
        target_round=payload.target_round
    )
    return res

@router.get("/api/eventstudio/match_predictor", summary="Predict tactical matchup outcome, win probability, and score differential")
async def api_eventstudio_match_predictor(
    p1_id: Optional[str] = None,
    p2_id: Optional[str] = None,
    p1_name: Optional[str] = "Player 1",
    p2_name: Optional[str] = "Player 2",
    p1_faction: Optional[str] = "Unknown",
    p2_faction: Optional[str] = "Unknown"
):
    db = get_database()
    
    # 1. Elo Ratings
    p1_elo = 1500.0
    p2_elo = 1500.0
    p1_matches = 0
    p2_matches = 0

    with db.get_connection() as conn:
        from psycopg2 import extras
        with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
            if p1_id:
                cursor.execute("SELECT current_elo, total_matches FROM player_ratings WHERE player_id = %s;", (p1_id,))
                r1 = cursor.fetchone()
                if r1:
                    p1_elo = float(r1["current_elo"] or 1500.0)
                    p1_matches = int(r1["total_matches"] or 0)
            elif p1_name:
                cursor.execute("SELECT current_elo, total_matches FROM player_ratings WHERE player_name ILIKE %s ORDER BY current_elo DESC LIMIT 1;", (f"%{p1_name}%",))
                r1 = cursor.fetchone()
                if r1:
                    p1_elo = float(r1["current_elo"] or 1500.0)
                    p1_matches = int(r1["total_matches"] or 0)

            if p2_id:
                cursor.execute("SELECT current_elo, total_matches FROM player_ratings WHERE player_id = %s;", (p2_id,))
                r2 = cursor.fetchone()
                if r2:
                    p2_elo = float(r2["current_elo"] or 1500.0)
                    p2_matches = int(r2["total_matches"] or 0)
            elif p2_name:
                cursor.execute("SELECT current_elo, total_matches FROM player_ratings WHERE player_name ILIKE %s ORDER BY current_elo DESC LIMIT 1;", (f"%{p2_name}%",))
                r2 = cursor.fetchone()
                if r2:
                    p2_elo = float(r2["current_elo"] or 1500.0)
                    p2_matches = int(r2["total_matches"] or 0)

            # 2. Faction Matchup Win Rate
            fac1 = p1_faction or "Unknown"
            fac2 = p2_faction or "Unknown"
            fac_p1_wins = 0
            fac_total = 0
            if fac1 != "Unknown" and fac2 != "Unknown":
                cursor.execute("""
                SELECT 
                    COUNT(*) as total_games,
                    SUM(CASE WHEN (winner_id = player1_id AND player1_faction = %s) OR (winner_id = player2_id AND player2_faction = %s) THEN 1 ELSE 0 END) as fac1_wins
                FROM matches
                WHERE is_done = TRUE AND (
                    (player1_faction = %s AND player2_faction = %s) OR
                    (player1_faction = %s AND player2_faction = %s)
                );
                """, (fac1, fac1, fac1, fac2, fac2, fac1))
                fac_row = cursor.fetchone()
                if fac_row and fac_row.get("total_games"):
                    fac_total = int(fac_row["total_games"] or 0)
                    fac_p1_wins = int(fac_row["fac1_wins"] or 0)

            # 3. Head-to-Head History
            h2h_matches = []
            if (p1_id and p2_id) or (p1_name and p2_name):
                cursor.execute("""
                SELECT m.round, m.player1_name, m.player2_name, m.player1_score, m.player2_score, m.match_date, e.name as event_name
                FROM matches m
                LEFT JOIN events e ON m.event_id = e.id
                WHERE is_done = TRUE AND (
                    (m.player1_name ILIKE %s AND m.player2_name ILIKE %s) OR
                    (m.player1_name ILIKE %s AND m.player2_name ILIKE %s)
                )
                ORDER BY m.match_date DESC LIMIT 5;
                """, (f"%{p1_name}%", f"%{p2_name}%", f"%{p2_name}%", f"%{p1_name}%"))
                h2h_rows = cursor.fetchall()
                for hr in h2h_rows:
                    h2h_matches.append({
                        "event_name": hr.get("event_name") or "Tournament Match",
                        "date": hr.get("match_date").isoformat() if hr.get("match_date") else None,
                        "p1_name": hr.get("player1_name"),
                        "p2_name": hr.get("player2_name"),
                        "score": f"{hr.get('player1_score')} - {hr.get('player2_score')}"
                    })

    # Calculate Elo Win Probability: P(A) = 1 / (1 + 10^((R_B - R_A)/400))
    elo_diff = p1_elo - p2_elo
    p1_win_prob = 1.0 / (1.0 + math.pow(10.0, -elo_diff / 400.0))
    p2_win_prob = 1.0 - p1_win_prob

    # Adjust slightly for faction matchup if >10 recorded games
    if fac_total >= 10:
        fac_rate = fac_p1_wins / max(1, fac_total)
        p1_win_prob = 0.75 * p1_win_prob + 0.25 * fac_rate
        p1_win_prob = max(0.05, min(0.95, p1_win_prob))
        p2_win_prob = 1.0 - p1_win_prob

    # Expected score prediction (Base 75 pts average, +/- up to 18 pts)
    expected_diff = round((p1_win_prob - 0.5) * 36.0)
    p1_expected_score = max(40, min(100, 75 + int(expected_diff / 2)))
    p2_expected_score = max(40, min(100, 75 - int(expected_diff / 2)))

    favored = p1_name if p1_win_prob > 0.52 else (p2_name if p2_win_prob > 0.52 else "Even Matchup")

    return {
        "player1": {
            "name": p1_name,
            "faction": p1_faction,
            "elo": round(p1_elo, 1),
            "win_probability": round(p1_win_prob * 100, 1),
            "expected_score": p1_expected_score
        },
        "player2": {
            "name": p2_name,
            "faction": p2_faction,
            "elo": round(p2_elo, 1),
            "win_probability": round(p2_win_prob * 100, 1),
            "expected_score": p2_expected_score
        },
        "favored_player": favored,
        "elo_diff": round(abs(elo_diff), 1),
        "expected_differential": abs(p1_expected_score - p2_expected_score),
        "faction_matchup": {
            "total_games": fac_total,
            "p1_faction_win_pct": round((fac_p1_wins / max(1, fac_total)) * 100, 1) if fac_total > 0 else 50.0
        },
        "h2h_history": h2h_matches
    }

class WtcDraftSavePayload(BaseModel):
    event_id: str
    round_num: int
    team_a_name: Optional[str] = "Team A"
    team_b_name: Optional[str] = "Team B"
    draft_state: Dict[str, Any]

@router.post("/api/eventstudio/wtc_draft", summary="Save active WTC team captain pairing draft state")
async def api_eventstudio_save_wtc_draft(payload: WtcDraftSavePayload):
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
async def api_eventstudio_get_wtc_draft(event_id: str, round_num: int):
    db = get_database()
    res = db.get_wtc_draft(event_id=event_id, round_num=round_num)
    return {"success": True, "event_id": event_id, "round_num": round_num, "draft": res}


