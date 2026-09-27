"""Army Lists Parsing, Wahapedia 11th Edition Reference & New Recruit Proxy Router."""
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

router = APIRouter(tags=["Army Lists & Wahapedia"])

# ==========================================
# ARMY LISTS & WAHAPEDIA DATASHEET ENDPOINTS
# ==========================================

@router.post("/api/armylists/parse", summary="Parse army list from text or JSON for NewRecruit Play Mode")
async def api_parse_armylist(req: Request):
    from newrecruit_integration import build_synthetic_nr_row
    try:
        body = await req.json()
    except Exception:
        body = {}
    raw_text = body.get("text") or body.get("raw_text") or ""
    source_format = body.get("format")
    parser = get_army_parser()
    parsed = parser.parse(raw_text, source_hint=source_format, enrich=bool(body.get("enrich")))
    nr_row = build_synthetic_nr_row(parsed)
    parsed["list_key"] = nr_row.get("list_key")
    parsed["nr_row"] = nr_row
    return {"success": True, "army_list": parsed}

@router.post("/api/armylists/upload", summary="Upload and parse army list file (.json, .ros, .rosz, .txt)")
async def api_upload_armylist(request: Request):
    from newrecruit_integration import build_synthetic_nr_row
    content_type = request.headers.get("content-type", "")
    filename = request.headers.get("x-filename", "")
    file_bytes = b""

    if "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
        try:
            form = await request.form()
            file_obj = form.get("file")
            if file_obj and hasattr(file_obj, "read"):
                file_bytes = await file_obj.read()
                filename = getattr(file_obj, "filename", "") or filename
            elif file_obj:
                file_bytes = file_obj.encode("utf-8") if isinstance(file_obj, str) else bytes(file_obj)
        except Exception as e:
            logger.warning(f"Form parse error: {e}")
            file_bytes = await request.body()
    else:
        file_bytes = await request.body()
        
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file payload")
    
    parser = get_army_parser()
    parsed = parser.parse_file(file_bytes, filename=filename, enrich=False)
    nr_row = build_synthetic_nr_row(parsed)
    parsed["list_key"] = nr_row.get("list_key")
    parsed["nr_row"] = nr_row
    return {"success": True, "army_list": parsed}

def _resolve_user_id(request: Request) -> Optional[str]:
    auth_mgr = get_auth_manager()
    candidates: List[str] = []
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        tok = auth_header.split(" ", 1)[1].strip()
        if tok and tok not in ("null", "undefined"):
            candidates.append(tok)
    for cookie_name in ("session_token", "elo_auth_token", "native_session_token"):
        c_val = request.cookies.get(cookie_name)
        if c_val and c_val not in ("null", "undefined") and c_val not in candidates:
            candidates.append(c_val)
    for tok in candidates:
        try:
            user = auth_mgr.get_session(tok)
            if user and user.get("id"):
                return str(user["id"])
        except Exception:
            pass
    return None


@router.get("/api/armylists", summary="Get saved army lists for current user")
async def api_get_armylists(request: Request, game_system: Optional[str] = Query(None)):
    user_id = _resolve_user_id(request)
    db = get_database()
    lists = db.get_user_army_lists(user_id=user_id, game_system=game_system)
    return {"success": True, "army_lists": lists}

@router.post("/api/armylists", summary="Save or create user army list")
async def api_save_armylist(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    
    user_id = _resolve_user_id(request)
    db = get_database()
    saved = db.save_user_army_list(user_id=user_id, list_data=body)
    return {"success": True, "army_list": saved}

@router.get("/api/armylists/nr_state", summary="Get NewRecruit IndexedDB hydration state and cloud connection status")
async def api_get_nr_state(request: Request):
    from newrecruit_integration import get_nr_state_payload
    user_id = _resolve_user_id(request)

    db = get_database()
    saved_lists = list(db.get_user_army_lists(user_id=user_id) or [])
    saved_ids = {str(x.get("id") or "") for x in saved_lists if isinstance(x, dict)}
    saved_keys = {str(x.get("list_key") or "") for x in saved_lists if isinstance(x, dict) and x.get("list_key")}
    lists = list(saved_lists)
    # Also include any active Game Tracker room lists (Player 1 & Player 2) as ephemeral so Opponent's List opens in Play Mode
    for room_data in list(TRACKER_ROOMS.values()):
        if isinstance(room_data, dict):
            for k in ("p1_army_list", "p2_army_list"):
                r_list = room_data.get(k)
                if isinstance(r_list, dict):
                    rl_id = str(r_list.get("id") or "")
                    rl_key = str(r_list.get("list_key") or "")
                    if rl_id not in saved_ids and (not rl_key or rl_key not in saved_keys):
                        lists.append(dict(r_list, _ephemeral_view=True))
    return get_nr_state_payload(lists, user_key=user_id or "default")


@router.post("/api/armylists/nr_sync", summary="Sync army list creation, modification, or deletion from embedded NewRecruit Studio")
async def api_post_nr_sync(request: Request):
    from newrecruit_integration import process_nr_sync_payload
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    user_id = _resolve_user_id(request)
    db = get_database()

    def _save_and_propagate(item: Dict[str, Any]) -> Dict[str, Any]:
        saved = db.save_user_army_list(user_id=user_id, list_data=item)
        if isinstance(saved, dict):
            s_id = str(saved.get("id") or "")
            s_key = str(saved.get("list_key") or (s_id[3:] if s_id.startswith("nr_") else ""))
            for room_data in list(TRACKER_ROOMS.values()):
                if not isinstance(room_data, dict):
                    continue
                for slot_key in ("p1_army_list", "p2_army_list"):
                    cur_slot = room_data.get(slot_key)
                    if isinstance(cur_slot, dict):
                        c_id = str(cur_slot.get("id") or "")
                        c_key = str(cur_slot.get("list_key") or (c_id[3:] if c_id.startswith("nr_") else ""))
                        if (s_id and c_id == s_id) or (s_key and c_key == s_key):
                            room_data[slot_key] = saved
        return saved

    return await asyncio.to_thread(
        process_nr_sync_payload,
        body,
        _save_and_propagate,
        lambda lid: db.delete_user_army_list(lid, user_id=user_id),
        lambda: db.get_user_army_lists(user_id=user_id),
    )


@router.post("/api/armylists/nr_cloud_connect", summary="Connect NewRecruit Cloud account and sync cloud army lists")
async def api_post_nr_cloud_connect(request: Request):
    from newrecruit_integration import handle_nr_cloud_connect
    try:
        body = await request.json()
    except Exception:
        body = {}

    user_id = _resolve_user_id(request)
    db = get_database()
    return await asyncio.to_thread(
        handle_nr_cloud_connect,
        body,
        lambda item: db.save_user_army_list(user_id=user_id, list_data=item),
        lambda lid: db.delete_user_army_list(lid, user_id=user_id),
        lambda: db.get_user_army_lists(user_id=user_id),
        user_id or "default",
    )


@router.get("/api/armylists/{list_id}", summary="Get single army list by ID")
async def api_get_armylist(list_id: str, request: Request):
    user_id = _resolve_user_id(request)
    db = get_database()
    item = db.get_user_army_list(list_id, user_id=user_id)
    if not item:
        raise HTTPException(status_code=404, detail="Army list not found")
    return {"success": True, "army_list": item}

@router.get("/api/bcp/armylist/{list_id}", summary="Fetch official army list text from Best Coast Pairings")
async def api_get_bcp_armylist(list_id: str, request: Request, bcp_token: Optional[str] = Query(None)):
    """
    Fetches raw army list text from BCP via GET /v1/armylists/{list_id}.
    Requires user BCP authorization token. If unauthenticated, returns requires_bcp_link=True.
    """
    clean_lid = str(list_id or "").strip()
    if clean_lid.startswith("/list/"):
        clean_lid = clean_lid.replace("/list/", "")
    clean_lid = clean_lid.strip()

    if not clean_lid:
        raise HTTPException(status_code=400, detail="Missing list_id")

    # 1. Resolve BCP Token from header or query param
    tok = bcp_token or request.headers.get("X-BCP-Token")
    auth_mgr = get_auth_manager()

    user_id = None
    session_token = request.cookies.get("session_token")
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        bearer_val = auth_header.split(" ", 1)[1].strip()
        if not tok and (bearer_val.startswith("eyJ") and len(bearer_val) > 100):
            try:
                claims = _decode_jwt_payload(bearer_val)
                if claims and ("cognito:username" in claims or "sub" in claims):
                    tok = bearer_val
            except Exception:
                pass
        if not tok:
            session_token = bearer_val

    if session_token:
        user = auth_mgr.get_session(session_token)
        if user:
            user_id = user["id"]

    # 2. If no explicit BCP token passed, try resolving from authenticated user's profile
    if not tok and user_id:
        tok = auth_mgr.get_valid_bcp_token(user_id)

    # 3. If still no BCP token, check if any active BCP token is on the server
    if not tok:
        tok = auth_mgr.get_any_valid_bcp_token()

    if not tok:
        return {
            "success": False,
            "requires_bcp_link": True,
            "error": "Best Coast Pairings subscription is required to view this roster",
            "list_id": clean_lid
        }

    # 4. Fetch from BCP via BcpAdapter
    from bcp_adapter import BcpAdapter
    succ, err, data = BcpAdapter.fetch_armylist(clean_lid, user_id=user_id, explicit_token=tok)
    if not succ or not data:
        is_auth_err = any(w in str(err).lower() for w in ["401", "403", "unauthorized", "invalid authorization", "token"])
        return {
            "success": False,
            "requires_bcp_link": is_auth_err,
            "error": err or "Failed to fetch army list from Best Coast Pairings",
            "list_id": clean_lid
        }

    # Extract raw text from BCP payload
    raw_text = (
        data.get("armyListText") or
        data.get("listText") or
        data.get("rawText") or
        data.get("raw_text") or
        data.get("text") or
        data.get("body") or
        ""
    )
    if isinstance(raw_text, dict):
        raw_text = raw_text.get("text") or raw_text.get("raw_text") or ""
    raw_text = str(raw_text).strip()

    return {
        "success": True,
        "list_id": clean_lid,
        "text": raw_text,
        "name": data.get("name") or data.get("armyName") or "",
        "army_id": data.get("armyId") or data.get("army_id") or "",
        "sub_faction_id": data.get("subFactionId") or data.get("sub_faction_id") or ""
    }

# =========================================================================
# WAHAPEDIA 11TH EDITION REFERENCE & SYNC ENDPOINTS
# =========================================================================

@router.get("/api/wahapedia/status", summary="Get Wahapedia sync status & stats across 40k and AoS")
async def api_wahapedia_status(game_system: Optional[str] = Query("all")):
    db = get_database()
    return db.waha_get_sync_status(game_system=game_system)

@router.post("/api/wahapedia/sync", summary="Trigger sync of Wahapedia datasets into PostgreSQL")
async def api_wahapedia_sync(force: bool = Query(False), game_system: Optional[str] = Query("all")):
    from wahapedia_sync import sync_wahapedia_job
    try:
        res = await asyncio.to_thread(sync_wahapedia_job, force=force, game_system=game_system)
        return res
    except Exception as e:
        logger.error(f"Error in api_wahapedia_sync: {e}", exc_info=True)
        return {"success": False, "error": str(e)}

@router.get("/api/wahapedia/stratagems", summary="Get detachment and core stratagems from Wahapedia")
async def api_wahapedia_stratagems(detachment: str = Query(...), faction: Optional[str] = Query(None)):
    db = get_database()
    return {"detachment": detachment, "stratagems": db.waha_get_stratagems(detachment, faction_id=faction)}

@router.get("/api/wahapedia/enhancements", summary="Get detachment enhancements from Wahapedia")
async def api_wahapedia_enhancements(detachment: str = Query(...)):
    db = get_database()
    return {"detachment": detachment, "enhancements": db.waha_get_enhancements(detachment)}

@router.get("/api/wahapedia/unit", summary="Find unit datasheet or warscroll from Wahapedia")
async def api_wahapedia_unit(name: str = Query(...), faction: Optional[str] = Query(None), game_system: Optional[str] = Query("40k")):
    db = get_database()
    unit = db.waha_find_unit(name, faction_name=faction, game_system=game_system)
    if not unit:
        raise HTTPException(status_code=404, detail=f"Unit '{name}' not found in Wahapedia database ({game_system})")
    return unit

@router.get("/api/wahapedia/warscroll", summary="Find Age of Sigmar warscroll by name from Wahapedia")
async def api_wahapedia_warscroll(name: str = Query(...), faction: Optional[str] = Query(None)):
    db = get_database()
    ws = db.waha_aos_find_warscroll(name, faction_name=faction)
    if not ws:
        raise HTTPException(status_code=404, detail=f"Warscroll '{name}' not found in Wahapedia AoS database")
    return ws

@router.delete("/api/armylists/{list_id}", summary="Delete an army list")
async def api_delete_armylist(list_id: str, request: Request):
    user_id = _resolve_user_id(request)
    db = get_database()
    success = db.delete_user_army_list(list_id, user_id=user_id)
    clean_key = str(list_id or "").strip()
    raw_key = clean_key[3:] if clean_key.startswith("nr_") else clean_key
    nr_key = f"nr_{raw_key}"
    for room_data in list(TRACKER_ROOMS.values()):
        if isinstance(room_data, dict):
            for slot_key in ("p1_army_list", "p2_army_list"):
                cur_slot = room_data.get(slot_key)
                if isinstance(cur_slot, dict):
                    c_id = str(cur_slot.get("id") or "")
                    c_key = str(cur_slot.get("list_key") or "")
                    if c_id in (clean_key, raw_key, nr_key) or c_key in (clean_key, raw_key):
                        room_data[slot_key] = None
    return {"success": success, "deleted_id": list_id}

@router.get("/nr/app", include_in_schema=False)
@router.get("/nr/app/{subpath:path}", include_in_schema=False)
@router.get("/app/Lists", include_in_schema=False)
@router.get("/app/Lists/{subpath:path}", include_in_schema=False)
@router.get("/app/MyLists", include_in_schema=False)
@router.get("/app/MyLists/{subpath:path}", include_in_schema=False)
@router.get("/app/Login", include_in_schema=False)
@router.get("/app/MySystems", include_in_schema=False)
@router.get("/app/MySystems/{subpath:path}", include_in_schema=False)
@router.get("/app/MyBooks", include_in_schema=False)
@router.get("/app/list/{subpath:path}", include_in_schema=False)
async def api_nr_studio_shell(request: Request, subpath: Optional[str] = None):
    """Serves the Same-Origin NewRecruit Studio SPA shell with the OmniTactica IndexedDB live sync bridge."""
    from newrecruit_integration import fetch_nr_html_shell
    try:
        html = await asyncio.to_thread(fetch_nr_html_shell)
        return HTMLResponse(content=html, status_code=200)
    except Exception as e:
        logger.warning(f"Notice serving NewRecruit Studio shell: {e}")
        return RedirectResponse(url="https://www.newrecruit.eu/app/Lists", status_code=302)


@router.get("/_nuxt/{subpath:path}", include_in_schema=False)
@router.get("/settings/{subpath:path}", include_in_schema=False)
@router.get("/api/book/{subpath:path}", include_in_schema=False)
@router.get("/assets.json", include_in_schema=False)
async def api_nr_static_get_proxy(request: Request, subpath: Optional[str] = None):
    from newrecruit_integration import proxy_nr_request
    full_path = request.url.path
    if request.url.query:
        full_path = f"{full_path}?{request.url.query}"
    status, data, content_type = await asyncio.to_thread(
        proxy_nr_request, full_path, "GET", None, dict(request.headers)
    )
    resp_headers: Dict[str, str] = {}
    if status == 200:
        if request.url.path.startswith("/_nuxt/"):
            resp_headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            resp_headers["Cache-Control"] = "public, max-age=3600"
    return Response(content=data, status_code=status, media_type=content_type.split(";")[0], headers=resp_headers)


@router.post("/api/rpc", include_in_schema=False)
@router.post("/api/token", include_in_schema=False)
async def api_nr_rpc_post_proxy(request: Request):
    from newrecruit_integration import proxy_nr_request
    full_path = request.url.path
    if request.url.query:
        full_path = f"{full_path}?{request.url.query}"
    body = await request.body()
    status, data, content_type = await asyncio.to_thread(
        proxy_nr_request, full_path, "POST", body, dict(request.headers)
    )
    return Response(content=data, status_code=status, media_type=content_type.split(";")[0])


@router.get("/nr_proxy/{share_id}", summary="Proxy NewRecruit share page and automatically import list")
@router.get("/api/armylist/nr_proxy/{share_id}", include_in_schema=False)
@router.get("/api/armylists/nr_proxy/{share_id}", include_in_schema=False)
async def api_nr_proxy(share_id: str):
    """Proxies NewRecruit share page with auto-import and direct interactive mode script injection."""
    from newrecruit_integration import fetch_nr_html_shell
    try:
        html = await asyncio.to_thread(fetch_nr_html_shell)
        return HTMLResponse(content=html, status_code=200)
    except Exception as e:
        logger.warning(f"Notice proxying NewRecruit auto-import: {e}")
        return RedirectResponse(url=f"https://www.newrecruit.eu/app/list/{share_id.strip()}", status_code=302)


