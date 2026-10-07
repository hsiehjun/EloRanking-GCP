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
    raw_text = str(body.get("text") or body.get("raw_text") or body.get("url") or "").strip()
    source_format = body.get("format")
    parser = get_army_parser()
    if raw_text.startswith(("http://", "https://")) and "newrecruit" in raw_text.lower() and hasattr(parser, "parse_url"):
        parsed = await asyncio.to_thread(parser.parse_url, raw_text)
    else:
        parsed = parser.parse(raw_text, source_hint=source_format, enrich=bool(body.get("enrich")))
    if not body.get("save"):
        parsed["_ephemeral_view"] = True
    nr_row = build_synthetic_nr_row(parsed)
    if not body.get("save"):
        nr_row["_ephemeral_view"] = True
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


@router.get("/api/nr/detachments", summary="Get live 40k 11th Edition detachments or AoS 4.0 Battle Formations from NewRecruit")
@router.get("/api/armylists/nr_detachments", include_in_schema=False)
async def api_get_nr_detachments(game_system: Optional[str] = None):
    if str(game_system or "").strip().lower() == "aos":
        from newrecruit_integration import get_nr_aos_formations_catalog
        return await asyncio.to_thread(get_nr_aos_formations_catalog)
    from newrecruit_integration import get_nr_detachments_catalog
    return await asyncio.to_thread(get_nr_detachments_catalog)


@router.get("/api/nr/aos/battle_formations", summary="Get live Age of Sigmar 4.0 Battle Formations & Armies of Renown from NewRecruit")
@router.get("/api/armylists/nr_aos_formations", include_in_schema=False)
async def api_get_nr_aos_formations():
    from newrecruit_integration import get_nr_aos_formations_catalog
    return await asyncio.to_thread(get_nr_aos_formations_catalog)


@router.get("/api/nr/bundle_status", summary="Get status of nr_offline_bundle.zip and last background refresh")
def api_get_nr_bundle_status():
    from newrecruit_integration import get_nr_offline_bundle_refresh_status
    return get_nr_offline_bundle_refresh_status()


@router.post("/api/nr/refresh_bundle", summary="Refresh nr_offline_bundle.zip from live www.newrecruit.eu and hot-reload in memory")
async def api_post_nr_refresh_bundle(force_books: bool = False):
    from newrecruit_integration import refresh_nr_offline_bundle_if_needed
    return await asyncio.to_thread(refresh_nr_offline_bundle_if_needed, force_books)


@router.get("/api/armylists", summary="Get army lists for current user directly from NewRecruit Cloud (if connected)")
async def api_get_armylists(request: Request, game_system: Optional[str] = Query(None)):
    from newrecruit_integration import fetch_nr_cloud_lists_for_user
    user_id = _resolve_user_id(request)
    explicit_access = request.headers.get("X-NR-Access")
    lists = await asyncio.to_thread(
        fetch_nr_cloud_lists_for_user,
        user_id or "default",
        explicit_access,
        game_system,
    )
    parser = get_army_parser()
    enriched = [
        parser._finalize_roster_compatibility(dict(item)) if isinstance(item, dict) else item
        for item in (lists or [])
    ]
    return {"success": True, "army_lists": enriched, "source": "newrecruit"}

def _normalize_in_memory_army_list(list_data: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(list_data, dict):
        return {}
    item = dict(list_data)
    raw_id = str(item.get("id") or "").strip()
    raw_lkey = str(item.get("list_key") or "").strip()
    if raw_lkey:
        clean_k = re.sub(r"^(nr_|list_)", "", raw_lkey)
        list_id = f"nr_{clean_k}"
    elif raw_id:
        clean_k = re.sub(r"^(nr_|list_)", "", raw_id)
        list_id = f"nr_{clean_k}" if raw_id.startswith("nr_") else raw_id
    else:
        clean_k = secrets.token_hex(5)
        list_id = f"nr_{clean_k}"
    item["id"] = list_id
    if not item.get("list_key"):
        item["list_key"] = clean_k
    try:
        from newrecruit_integration import build_synthetic_nr_row
        nr_row = build_synthetic_nr_row(item)
        item["list_key"] = nr_row.get("list_key") or item["list_key"]
        item["nr_row"] = nr_row
    except Exception:
        pass
    try:
        item = get_army_parser()._finalize_roster_compatibility(item)
    except Exception:
        pass
    return item


def _propagate_saved_list_to_tracker_rooms(saved: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(saved, dict):
        return saved
    saved = _normalize_in_memory_army_list(saved)
    s_id = str(saved.get("id") or "")
    s_key = str(saved.get("list_key") or (s_id[3:] if s_id.startswith("nr_") else ""))
    for match_id, room_data in list(TRACKER_ROOMS.items()):
        if not isinstance(room_data, dict):
            continue
        for slot_key, role_name in (("p1_army_list", "player1"), ("p2_army_list", "player2")):
            cur_slot = room_data.get(slot_key)
            if isinstance(cur_slot, dict):
                c_id = str(cur_slot.get("id") or "")
                c_key = str(
                    cur_slot.get("list_key")
                    or (cur_slot.get("nr_row") or {}).get("list_key")
                    or (c_id[3:] if c_id.startswith("nr_") else "")
                )
                if (s_id and c_id == s_id) or (s_key and c_key == s_key):
                    room_data[slot_key] = saved
                    try:
                        fs_engine = get_firestore_engine()
                        fs_engine.update_room(match_id, {
                            slot_key: saved,
                            f"rosters.{role_name}": saved,
                        })
                    except Exception:
                        pass
                    listeners = TRACKER_LISTENERS.get(match_id, [])
                    msg = {
                        "type": "army_list_updated",
                        "match_id": match_id,
                        "role": role_name,
                        "army_list": saved,
                        "sender": role_name,
                    }
                    for q in list(listeners):
                        try:
                            q.put_nowait(msg)
                        except Exception:
                            pass
    return saved


def _clear_deleted_list_from_tracker_rooms(list_id: str) -> bool:
    clean_key = str(list_id or "").strip()
    raw_key = re.sub(r"^(nr_|list_)", "", clean_key)
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
    return True


@router.post("/api/armylists", summary="Normalize army list in-memory (no backend DB storage)")
async def api_save_armylist(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    saved = _propagate_saved_list_to_tracker_rooms(body)
    return {"success": True, "army_list": saved}

@router.get("/api/armylists/nr_state", summary="Get NewRecruit cloud connection status (never injects backend DB lists)")
def api_get_nr_state(request: Request):
    from newrecruit_integration import get_nr_state_payload
    user_id = _resolve_user_id(request)
    return get_nr_state_payload([], user_key=user_id or "default")


@router.post("/api/armylists/nr_sync", summary="Statelessly parse NewRecruit lists and propagate live edits to active Game Tracker rooms")
async def api_post_nr_sync(request: Request):
    from newrecruit_integration import process_nr_sync_payload
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    return await asyncio.to_thread(
        process_nr_sync_payload,
        body,
        _propagate_saved_list_to_tracker_rooms,
        _clear_deleted_list_from_tracker_rooms,
        lambda: [],
    )


@router.post("/api/armylists/nr_cloud_connect", summary="Connect NewRecruit Cloud account and fetch cloud army lists without backend DB storage")
async def api_post_nr_cloud_connect(request: Request):
    from newrecruit_integration import handle_nr_cloud_connect
    try:
        body = await request.json()
    except Exception:
        body = {}

    user_id = _resolve_user_id(request)
    return await asyncio.to_thread(
        handle_nr_cloud_connect,
        body,
        _propagate_saved_list_to_tracker_rooms,
        _clear_deleted_list_from_tracker_rooms,
        lambda: [],
        user_id or "default",
    )


@router.get("/api/armylists/{list_id}", summary="Get single army list by ID from NewRecruit Cloud or active Game Tracker room")
async def api_get_armylist(list_id: str, request: Request):
    from newrecruit_integration import fetch_nr_cloud_lists_for_user
    clean_key = str(list_id or "").strip()
    raw_key = re.sub(r"^(nr_|list_)", "", clean_key)
    nr_key = f"nr_{raw_key}"
    for room_data in list(TRACKER_ROOMS.values()):
        if isinstance(room_data, dict):
            for slot_key in ("p1_army_list", "p2_army_list"):
                cur_slot = room_data.get(slot_key)
                if isinstance(cur_slot, dict):
                    c_id = str(cur_slot.get("id") or "")
                    c_key = str(cur_slot.get("list_key") or "")
                    if c_id in (clean_key, raw_key, nr_key) or c_key in (clean_key, raw_key):
                        item = get_army_parser()._finalize_roster_compatibility(dict(cur_slot))
                        return {"success": True, "army_list": item}
    user_id = _resolve_user_id(request)
    cloud_lists = await asyncio.to_thread(
        fetch_nr_cloud_lists_for_user,
        user_id or "default",
        request.headers.get("X-NR-Access"),
        None,
    )
    for item in (cloud_lists or []):
        if isinstance(item, dict):
            c_id = str(item.get("id") or "")
            c_key = str(item.get("list_key") or "")
            if c_id in (clean_key, raw_key, nr_key) or c_key in (clean_key, raw_key):
                return {"success": True, "army_list": get_army_parser()._finalize_roster_compatibility(dict(item))}
    raise HTTPException(status_code=404, detail="Army list not found")

@router.get("/api/bcp/armylist/{list_id}", summary="Fetch official army list text from Best Coast Pairings")
def api_get_bcp_armylist(list_id: str, request: Request, bcp_token: Optional[str] = Query(None)):
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

@router.delete("/api/armylists/{list_id}", summary="Delete an army list from NewRecruit Cloud (if connected) and active rooms")
async def api_delete_armylist(list_id: str, request: Request):
    from newrecruit_integration import _resolve_nr_cloud_account, _nr_rpc_call
    user_id = _resolve_user_id(request)
    _clear_deleted_list_from_tracker_rooms(list_id)
    clean_key = str(list_id or "").strip()
    raw_key = re.sub(r"^(nr_|list_)", "", clean_key)
    try:
        acct = _resolve_nr_cloud_account(user_id or "default") or {}
        nr_access = request.headers.get("X-NR-Access") or acct.get("access")
        if nr_access and raw_key:
            await asyncio.to_thread(_nr_rpc_call, "deleteList", [raw_key], nr_access)
    except Exception:
        pass
    return {"success": True, "deleted_id": list_id}

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
    no_cache_headers = {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
    }
    html = await asyncio.to_thread(fetch_nr_html_shell)
    return HTMLResponse(content=html, status_code=200, headers=no_cache_headers)


@router.get("/worker.js", include_in_schema=False)
@router.get("/nr/worker.js", include_in_schema=False)
@router.get("/sw.js", include_in_schema=False)
@router.get("/service-worker.js", include_in_schema=False)
def api_kill_stale_service_worker():
    """
    Serves a self-unregistering Service Worker script so NewRecruit's root-scoped /worker.js
    can never hijack OmniTactica's origin or cache stale HTML/JS in Browser or PWA mode.
    Any client that previously registered /worker.js will automatically install this script,
    purge all CacheStorage buckets, and unregister the Service Worker.
    """
    sw_killer_js = (
        "// OmniTactica Service Worker Unregister & Cache Cleaner\n"
        "self.addEventListener('install', function(event) {\n"
        "  self.skipWaiting();\n"
        "});\n"
        "self.addEventListener('activate', function(event) {\n"
        "  event.waitUntil(\n"
        "    caches.keys().then(function(keys) {\n"
        "      return Promise.all(keys.map(function(k) { return caches.delete(k); }));\n"
        "    }).then(function() {\n"
        "      return self.registration.unregister();\n"
        "    }).then(function() {\n"
        "      return self.clients.matchAll({ type: 'window' });\n"
        "    }).then(function(clients) {\n"
        "      clients.forEach(function(client) {\n"
        "        if (client.url && 'navigate' in client) {\n"
        "          client.navigate(client.url).catch(function() {});\n"
        "        }\n"
        "      });\n"
        "    })\n"
        "  );\n"
        "});\n"
    )
    return Response(
        content=sw_killer_js,
        status_code=200,
        media_type="application/javascript",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
            "Service-Worker-Allowed": "/",
        },
    )


@router.get("/_nuxt/{subpath:path}", include_in_schema=False)
@router.get("/settings/{subpath:path}", include_in_schema=False)
@router.get("/api/book/{subpath:path}", include_in_schema=False)
@router.get("/fonts/{subpath:path}", include_in_schema=False)
@router.get("/nr/assets/{subpath:path}", include_in_schema=False)
@router.get("/api/nr/assets/{subpath:path}", include_in_schema=False)
@router.get("/nr/icons/{subpath:path}", include_in_schema=False)
@router.get("/api/nr/icons/{subpath:path}", include_in_schema=False)
@router.get("/assets.json", include_in_schema=False)
@router.get("/Tahoma.ttf", include_in_schema=False)
@router.get("/TahomaBold.ttf", include_in_schema=False)
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
    no_cache_headers = {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
    }
    html = await asyncio.to_thread(fetch_nr_html_shell)
    return HTMLResponse(content=html, status_code=200, headers=no_cache_headers)


