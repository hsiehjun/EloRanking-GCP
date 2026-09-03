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

@router.post("/api/armylists/parse", summary="Parse and enrich army list from text or JSON")
async def api_parse_armylist(req: Request):
    try:
        body = await req.json()
    except Exception:
        body = {}
    raw_text = body.get("text") or body.get("raw_text") or ""
    source_format = body.get("format")
    parser = get_army_parser()
    parsed = parser.parse(raw_text, source_hint=source_format)
    return {"success": True, "army_list": parsed}

@router.post("/api/armylists/upload", summary="Upload and parse army list file (.json, .ros, .rosz, .txt)")
async def api_upload_armylist(request: Request):
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
    parsed = parser.parse_file(file_bytes, filename=filename)
    return {"success": True, "army_list": parsed}

@router.get("/api/armylists", summary="Get saved army lists for current user")
async def api_get_armylists(request: Request):
    auth_mgr = get_auth_manager()
    session_token = request.cookies.get("session_token")
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        session_token = auth_header.split(" ", 1)[1]
    user = auth_mgr.get_session(session_token) if session_token else None
    user_id = user["id"] if user else None

    db = get_database()
    lists = db.get_user_army_lists(user_id=user_id)
    return {"success": True, "army_lists": lists}

@router.post("/api/armylists", summary="Save or create user army list")
async def api_save_armylist(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    
    auth_mgr = get_auth_manager()
    session_token = request.cookies.get("session_token")
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        session_token = auth_header.split(" ", 1)[1]
    user = auth_mgr.get_session(session_token) if session_token else None
    user_id = user["id"] if user else None

    db = get_database()
    saved = db.save_user_army_list(user_id=user_id, list_data=body)
    return {"success": True, "army_list": saved}

@router.get("/api/armylists/{list_id}", summary="Get single army list by ID")
async def api_get_armylist(list_id: str, request: Request):
    auth_mgr = get_auth_manager()
    session_token = request.cookies.get("session_token")
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        session_token = auth_header.split(" ", 1)[1]
    user = auth_mgr.get_session(session_token) if session_token else None
    user_id = user["id"] if user else None

    db = get_database()
    item = db.get_user_army_list(list_id, user_id=user_id)
    if not item:
        raise HTTPException(status_code=404, detail="Army list not found")
    return {"success": True, "army_list": item}

# =========================================================================
# WAHAPEDIA 11TH EDITION REFERENCE & SYNC ENDPOINTS
# =========================================================================

@router.get("/api/wahapedia/status", summary="Get Wahapedia 11th Edition sync status & stats")
async def api_wahapedia_status():
    db = get_database()
    return db.waha_get_sync_status()

@router.post("/api/wahapedia/sync", summary="Trigger sync of Wahapedia 11th edition datasets into PostgreSQL")
async def api_wahapedia_sync(force: bool = Query(False)):
    from wahapedia_sync import sync_wahapedia_job
    try:
        res = await asyncio.to_thread(sync_wahapedia_job, force=force)
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

@router.get("/api/wahapedia/unit", summary="Find unit datasheet and statlines from Wahapedia")
async def api_wahapedia_unit(name: str = Query(...), faction: Optional[str] = Query(None)):
    db = get_database()
    unit = db.waha_find_unit(name, faction_name=faction)
    if not unit:
        raise HTTPException(status_code=404, detail=f"Unit '{name}' not found in Wahapedia database")
    return unit

@router.delete("/api/armylists/{list_id}", summary="Delete an army list")
async def api_delete_armylist(list_id: str, request: Request):
    auth_mgr = get_auth_manager()
    session_token = request.cookies.get("session_token")
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        session_token = auth_header.split(" ", 1)[1]
    user = auth_mgr.get_session(session_token) if session_token else None
    user_id = user["id"] if user else None

    db = get_database()
    success = db.delete_user_army_list(list_id, user_id=user_id)
    return {"success": success, "deleted_id": list_id}

@router.get("/nr/app/list/{share_id}", include_in_schema=False)
@router.get("/nr_proxy/{share_id}", summary="Proxy NewRecruit share page and automatically import list")
@router.get("/api/armylist/nr_proxy/{share_id}", include_in_schema=False)
@router.get("/api/armylists/nr_proxy/{share_id}", include_in_schema=False)
async def api_nr_proxy(share_id: str):
    """Proxies NewRecruit share page with auto-import and direct interactive mode script injection."""
    clean_id = share_id.strip()
    try:
        url = f"https://www.newrecruit.eu/app/list/{clean_id}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        def _fetch():
            with urllib.request.urlopen(req, timeout=4.0) as resp:
                return resp.read().decode("utf-8")
        html = await asyncio.to_thread(_fetch)
        
        # Rewrite relative paths to absolute newrecruit.eu
        html = html.replace('href="/_nuxt/', 'href="https://www.newrecruit.eu/_nuxt/')
        html = html.replace('src="/_nuxt/', 'src="https://www.newrecruit.eu/_nuxt/')
        html = html.replace('href="/favicon', 'href="https://www.newrecruit.eu/favicon')
        
        # Inject auto-import and auto-play script
        auto_script = """
        <script>
        (function() {
          let clickedImport = false;
          let clickedPlay = false;
          const timer = setInterval(() => {
            try {
              // 1. Auto-click 'Import List' on share preview page
              if (!clickedImport) {
                const btns = Array.from(document.querySelectorAll('button'));
                const importBtn = btns.find(b => (b.textContent || '').trim().toLowerCase() === 'import list');
                if (importBtn) {
                  clickedImport = true;
                  console.log('[Auto-Import] Found and auto-clicked Import List button');
                  importBtn.click();
                }
              }
              // 2. Auto-enable Play Mode once list is imported / loaded
              if (!clickedPlay && (window.location.href.includes('/app/Lists') || document.querySelector('.actionButtons, .unitName, .rosterHeader'))) {
                const playBtn = Array.from(document.querySelectorAll('button, a, div, span')).find(el => {
                  const txt = (el.textContent || '').trim().toLowerCase();
                  return txt === 'play mode' || txt === '🎮 play mode' || txt.includes('play mode');
                });
                if (playBtn) {
                  clickedPlay = true;
                  playBtn.click();
                  clearInterval(timer);
                }
              }
            } catch(e) {}
          }, 120);
          setTimeout(() => clearInterval(timer), 12000);
        })();
        </script>
        """
        html = html.replace("</body>", auto_script + "</body>")
        return HTMLResponse(content=html, status_code=200)
    except Exception as e:
        logger.warning(f"Notice proxying NewRecruit auto-import: {e}")
        return RedirectResponse(url=f"https://www.newrecruit.eu/app/list/{clean_id}", status_code=302)

