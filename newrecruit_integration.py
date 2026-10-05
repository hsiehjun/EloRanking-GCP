"""
Seamless NewRecruit Integration (Option 3 Hybrid Architecture + Native Play Mode):
1. Same-Origin Embedded NewRecruit Studio & Play Mode Proxy + Real-Time IndexedDB Auto-Sync Bridge
2. Linked NewRecruit Cloud Account RPC Sync (login, user_get_data, get_list_bulk)
3. Zero-Backend-Storage Datasheet & Stratagem Rendering via NewRecruit Play Mode (/nr/app/Lists/{list_key}?view=play)
"""

import hashlib
import json
import logging
import mimetypes
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from army_list_parser import get_parser

logger = logging.getLogger("NewRecruitIntegration")

NR_BASE_URL = os.environ.get("NR_BASE_URL", "https://www.newrecruit.eu").rstrip("/")
NR_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Real NewRecruit Warhammer 40,000 & Age of Sigmar system and faction catalogue IDs
# Latest editions default: Warhammer 40,000 11th Edition (827374861) & Age of Sigmar 4.0 (4255553472)
NR_40K_SYSTEM_ID = 827374861
NR_40K_SYSTEM_BSID = "sys-352e-adc2-7639-d610"
NR_40K_10E_SYSTEM_ID = 2821148162
NR_40K_10E_SYSTEM_BSID = "sys-352e-adc2-7639-d6a9"
NR_40K_9E_SYSTEM_ID = 176797394
NR_40K_9E_SYSTEM_BSID = "28ec-711c-d87f-3aeb"

NR_AOS_SYSTEM_ID = 4255553472
NR_AOS_SYSTEM_BSID = "e51d-b1a3-75fc-dc3g"
NR_AOS_3E_SYSTEM_ID = 4194757354
NR_AOS_3E_SYSTEM_BSID = "e51d-b1a3-75fc-dc33"

NR_SYSTEM_METADATA: Dict[int, Dict[str, Any]] = {
    NR_40K_SYSTEM_ID: {
        "id_system": NR_40K_SYSTEM_ID,
        "bsid_system": NR_40K_SYSTEM_BSID,
        "game_system": "40k",
        "edition_label": "11th Ed",
        "short": "wh40k-11e",
        "name": "Warhammer 40,000 11th Edition",
        "is_latest": True,
    },
    NR_40K_10E_SYSTEM_ID: {
        "id_system": NR_40K_10E_SYSTEM_ID,
        "bsid_system": NR_40K_10E_SYSTEM_BSID,
        "game_system": "40k",
        "edition_label": "10th Ed",
        "short": "wh40k-10e",
        "name": "Warhammer 40,000 10th Edition",
        "is_latest": False,
    },
    NR_40K_9E_SYSTEM_ID: {
        "id_system": NR_40K_9E_SYSTEM_ID,
        "bsid_system": NR_40K_9E_SYSTEM_BSID,
        "game_system": "40k",
        "edition_label": "9th Ed",
        "short": "wh40k",
        "name": "Warhammer 40,000 9th Edition",
        "is_latest": False,
    },
    NR_AOS_SYSTEM_ID: {
        "id_system": NR_AOS_SYSTEM_ID,
        "bsid_system": NR_AOS_SYSTEM_BSID,
        "game_system": "aos",
        "edition_label": "AoS 4.0",
        "short": "age-of-sigmar-4th",
        "name": "Age of Sigmar 4.0",
        "is_latest": True,
    },
    NR_AOS_3E_SYSTEM_ID: {
        "id_system": NR_AOS_3E_SYSTEM_ID,
        "bsid_system": NR_AOS_3E_SYSTEM_BSID,
        "game_system": "aos",
        "edition_label": "AoS 3.0",
        "short": "warhammer-age-of-sigmar",
        "name": "Age of Sigmar 3.0",
        "is_latest": False,
    },
}

NR_40K_FACTION_BOOKS: Dict[str, Tuple[int, str, str]] = {
    "adepta sororitas": (2058815731, "b39e-4401-8f3e-fdf7", "Imperium - Adepta Sororitas"),
    "sisters of battle": (2058815731, "b39e-4401-8f3e-fdf7", "Imperium - Adepta Sororitas"),
    "black templars": (142652252, "36d3-36bc-68dd-68dd", "Imperium - Adeptus Astartes - Black Templars"),
    "blood angels": (3811889199, "4ef9-15ce-e3e6-36de", "Imperium - Adeptus Astartes - Blood Angels"),
    "dark angels": (331927583, "470a-6daa-9014-12df", "Imperium - Adeptus Astartes - Dark Angels"),
    "deathwatch": (1708061280, "f89b-84e0-6e3b-f1e2", "Imperium - Adeptus Astartes - Deathwatch"),
    "imperial fists": (2373215974, "5d6e-fd3-330a-11dd", "Imperium - Adeptus Astartes - Imperial Fists"),
    "iron hands": (2663644003, "f27e-18c0-b73e-748e", "Imperium - Adeptus Astartes - Iron Hands"),
    "raven guard": (61125968, "6e59-e1ee-47ad-6ce5", "Imperium - Adeptus Astartes - Raven Guard"),
    "salamanders": (3812267311, "2261-79a5-19d9-1668", "Imperium - Adeptus Astartes - Salamanders"),
    "space marines": (455211524, "e0af-67df-9d63-8fb7", "Imperium - Adeptus Astartes - Space Marines"),
    "adeptus astartes": (455211524, "e0af-67df-9d63-8fb7", "Imperium - Adeptus Astartes - Space Marines"),
    "space wolves": (2975519365, "94bb-3284-ee14-57a1", "Imperium - Adeptus Astartes - Space Wolves"),
    "ultramarines": (599543230, "4029-9237-e8db-af55", "Imperium - Adeptus Astartes - Ultramarines"),
    "white scars": (1852695118, "67c1-fc13-f9a1-cbbf", "Imperium - Adeptus Astartes - White Scars"),
    "adeptus custodes": (2461408627, "1f19-6509-d906-ca10", "Imperium - Adeptus Custodes"),
    "adeptus mechanicus": (1915182632, "77b9-2f66-3f9b-5cf3", "Imperium - Adeptus Mechanicus"),
    "agents of the imperium": (394010041, "b00-cd86-4b4c-97ba", "Imperium - Agents of the Imperium"),
    "imperial agents": (394010041, "b00-cd86-4b4c-97ba", "Imperium - Agents of the Imperium"),
    "astra militarum": (3188869395, "b0ae-12a5-c84-ea45", "Imperium - Astra Militarum"),
    "imperial guard": (3188869395, "b0ae-12a5-c84-ea45", "Imperium - Astra Militarum"),
    "grey knights": (3875817488, "50c4-3e83-fe54-97c4", "Imperium - Grey Knights"),
    "imperial knights": (1799226443, "25dd-7aa0-6bf4-f2d5", "Imperium - Imperial Knights"),
    "chaos daemons": (1418017000, "d265-877b-e03d-30ca", "Chaos - Chaos Daemons"),
    "chaos knights": (2126900523, "46d8-abc8-ef3a-9f85", "Chaos - Chaos Knights"),
    "chaos space marines": (4171985849, "c8da-e875-58f7-f6d6", "Chaos - Chaos Space Marines"),
    "heretic astartes": (4171985849, "c8da-e875-58f7-f6d6", "Chaos - Chaos Space Marines"),
    "death guard": (253717870, "5108-f98-63c2-53cb", "Chaos - Death Guard"),
    "emperor's children": (708977740, "03fe-a162-4c02-f07b", "Chaos - Emperor's Children"),
    "emperors children": (708977740, "03fe-a162-4c02-f07b", "Chaos - Emperor's Children"),
    "thousand sons": (164965956, "1069-10ff-3ba9-873b", "Chaos - Thousand Sons"),
    "world eaters": (3934587149, "df9a-59b2-f464-59ad", "Chaos - World Eaters"),
    "aeldari": (1194327035, "34a5-8c7e-f468-82d1", "Xenos - Aeldari"),
    "craftworlds": (1194327035, "34a5-8c7e-f468-82d1", "Xenos - Aeldari"),
    "ynnari": (1760867348, "1f1-47f9-a3a4-9bfb", "Aeldari - Ynnari"),
    "drukhari": (1007559722, "38de-521f-1ce0-44a0", "Xenos - Drukhari"),
    "genestealer cults": (3339098360, "3bdf-a114-5035-c6ac", "Xenos - Genestealer Cults"),
    "leagues of votann": (3439666802, "f616-3f08-ee8e-3349", "Xenos - Leagues of Votann"),
    "necrons": (1694145926, "b654-a18a-ea1-3bf2", "Xenos - Necrons"),
    "orks": (3898668199, "a55f-b7b3-6c65-a05f", "Xenos - Orks"),
    "t'au empire": (3882515956, "d81a-61dd-6d27-a3ce", "Xenos - T'au Empire"),
    "tau empire": (3882515956, "d81a-61dd-6d27-a3ce", "Xenos - T'au Empire"),
    "tyranids": (1071245710, "b984-7317-81cc-20f", "Xenos - Tyranids"),
}

# Real NewRecruit Age of Sigmar 4.0 (id_system = 4255553472) faction catalogue IDs
NR_AOS_FACTION_BOOKS: Dict[str, Tuple[int, str, str]] = {
    "blades of khorne": (2430265077, "d545-cdca-9e60-ad27", "Blades of Khorne"),
    "khorne": (2430265077, "d545-cdca-9e60-ad27", "Blades of Khorne"),
    "cities of sigmar": (1760185752, "42ad-8ca7-4b48-7df1", "Cities of Sigmar"),
    "daughters of khaine": (2065050843, "5232-3bab-5562-3172", "Daughters of Khaine"),
    "disciples of tzeentch": (3079939502, "d731-9058-b0e5-6ff5", "Disciples of Tzeentch"),
    "tzeentch": (3079939502, "d731-9058-b0e5-6ff5", "Disciples of Tzeentch"),
    "flesh-eater courts": (833854484, "b53b-1217-df2e-66d2", "Flesh-eater Courts"),
    "flesh eater courts": (833854484, "b53b-1217-df2e-66d2", "Flesh-eater Courts"),
    "fyreslayers": (2762353561, "b3f9-6c96-b99a-1e71", "Fyreslayers"),
    "gloomspite gitz": (2962537137, "9baf-c109-f621-e60", "Gloomspite Gitz"),
    "hedonites of slaanesh": (2859114640, "afdb-68a1-283e-3bf2", "Hedonites of Slaanesh"),
    "slaanesh": (2859114640, "afdb-68a1-283e-3bf2", "Hedonites of Slaanesh"),
    "helsmiths of hashut": (392328091, "b7b7-cf58-4189-56ec", "Helsmiths of Hashut"),
    "chaos dwarfs": (392328091, "b7b7-cf58-4189-56ec", "Helsmiths of Hashut"),
    "idoneth deepkin": (3467102999, "40a4-1c1c-8a00-bb65", "Idoneth Deepkin"),
    "ironjawz": (207065146, "832c-fd6-a535-ffae", "Ironjawz"),
    "orruk warclans": (207065146, "832c-fd6-a535-ffae", "Ironjawz"),
    "kharadron overlords": (1912747296, "1100-a22f-15c6-bdea", "Kharadron Overlords"),
    "kruleboyz": (2752358123, "8aef-b85d-b63a-ef05", "Kruleboyz"),
    "lumineth realm-lords": (3664181305, "efc5-b8d-894c-67c6", "Lumineth Realm-lords"),
    "lumineth realm lords": (3664181305, "efc5-b8d-894c-67c6", "Lumineth Realm-lords"),
    "lumineth": (3664181305, "efc5-b8d-894c-67c6", "Lumineth Realm-lords"),
    "maggotkin of nurgle": (3159505906, "5079-92b5-4879-69f8", "Maggotkin of Nurgle"),
    "nurgle": (3159505906, "5079-92b5-4879-69f8", "Maggotkin of Nurgle"),
    "nighthaunt": (250802668, "640e-6bc1-c83d-13c", "Nighthaunt"),
    "ogor mawtribes": (1060811875, "6353-cb84-ac7f-9a15", "Ogor Mawtribes"),
    "ossiarch bonereapers": (1475362429, "8e0e-5e8c-5824-89c9", "Ossiarch Bonereapers"),
    "seraphon": (2426044300, "4e3-e1a7-a8d4-8719", "Seraphon"),
    "skaven": (794864200, "231a-2a83-26f0-a718", "Skaven"),
    "slaves to darkness": (3504641722, "2c23-a678-196b-ad69", "Slaves to Darkness"),
    "sons of behemat": (2684306298, "de5f-588b-ea57-d6b5", "Sons of Behemat"),
    "soulblight gravelords": (2411478563, "405e-c5f4-8579-b05c", "Soulblight Gravelords"),
    "stormcast eternals": (1531352143, "1bd9-ad7d-68ee-3b53", "Stormcast Eternals"),
    "stormcast": (1531352143, "1bd9-ad7d-68ee-3b53", "Stormcast Eternals"),
    "sylvaneth": (1920653173, "bb7e-b0da-5c2-a980", "Sylvaneth"),
    "beasts of chaos": (62299914, "6cc-9eb2-c5b4-2877", "Beasts of Chaos [LEGENDS]"),
    "bonesplitterz": (2247251353, "7acb-3141-6008-1c09", "Bonesplitterz [LEGENDS]"),
}

# In-memory cache for static NewRecruit assets (/_nuxt/*, /settings/*, /assets/*, /api/book/*, HTML shell)
_NR_STATIC_CACHE: Dict[str, Tuple[float, bytes, str]] = {}
_NR_HTML_SHELL_CACHE: Optional[Tuple[float, str]] = None
_NR_CACHE_TTL_SECONDS = 86400  # 24 hours

# Local offline bundle (data/nr_offline_bundle.zip) containing NewRecruit SPA shell, /_nuxt/*, /settings/*,
# /assets/*, get_library, and all 40K/AoS catalogue books so Cloud Run never depends on outbound TCP to www.newrecruit.eu
_NR_OFFLINE_BUNDLE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "data", "nr_offline_bundle.zip"
)
_NR_OFFLINE_LOCK = threading.Lock()
_NR_OFFLINE_ZIP: Optional[zipfile.ZipFile] = None
_NR_OFFLINE_NAMES: Set[str] = set()
_NR_OFFLINE_BOOK_BY_ID: Dict[str, str] = {}
_NR_OFFLINE_CT_MAP: Dict[str, str] = {}
_NR_OFFLINE_BOOK_VERSIONS: Dict[Tuple[int, int], int] = {}
_NR_LIVE_BOOK_VERSIONS: Dict[Tuple[int, int], int] = {}
_NR_OFFLINE_BOOK_DATES: Dict[Tuple[int, int], str] = {}
_NR_LIVE_BOOK_DATES: Dict[Tuple[int, int], str] = {}


def _index_library_book_versions(
    lib_bytes: bytes,
    target_map: Dict[Tuple[int, int], int],
    date_map: Optional[Dict[Tuple[int, int], str]] = None,
) -> None:
    """Indexes (id_system, id_book) -> nrversion (and last_updated) from a get_library JSON payload."""
    try:
        lib_data = json.loads(lib_bytes.decode("utf-8", errors="ignore"))
        lib_arr = lib_data if isinstance(lib_data, list) else (lib_data.get("array", []) if isinstance(lib_data, dict) else [])
        for sys_obj in lib_arr:
            if not isinstance(sys_obj, dict):
                continue
            sys_id = sys_obj.get("id")
            if sys_id is None:
                continue
            books = sys_obj.get("books", [])
            if isinstance(books, dict):
                books = books.get("array", [])
            if not isinstance(books, list):
                continue
            for b in books:
                if isinstance(b, dict) and b.get("id") is not None and b.get("nrversion") is not None:
                    try:
                        key_pair = (int(sys_id), int(b["id"]))
                        target_map[key_pair] = int(b["nrversion"])
                        if date_map is not None and b.get("last_updated"):
                            date_map[key_pair] = str(b["last_updated"]).strip()
                    except Exception:
                        pass
    except Exception:
        pass


def _canonical_nr_rpc_cache_key(clean_path: str, body: Optional[bytes], body_str: str) -> str:
    """Normalizes cacheable NewRecruit RPC cache keys so pre-warmed and browser requests share the same key."""
    if '"get_library"' in body_str:
        return "POST:/api/rpc:get_library"
    if '"books_get_book_row"' in body_str and body:
        try:
            payload = json.loads(body_str or body.decode("utf-8", errors="ignore"))
            params = payload.get("params") if isinstance(payload, dict) else None
            if isinstance(params, list) and len(params) >= 2:
                sys_id = int(params[0])
                book_id = int(params[1])
                req_date = str(params[2] or "").strip() if len(params) > 2 and params[2] is not None else ""
                live_dt = _NR_LIVE_BOOK_DATES.get((sys_id, book_id))
                off_dt = _NR_OFFLINE_BOOK_DATES.get((sys_id, book_id))
                if not req_date or req_date == live_dt or req_date == off_dt:
                    return f"POST:/api/rpc:books_get_book_row:{sys_id}:{book_id}:latest"
                return f"POST:/api/rpc:books_get_book_row:{sys_id}:{book_id}:{req_date}"
        except Exception:
            pass
    return f"POST:{clean_path}:{body_str}"


def _ensure_nr_offline_bundle() -> Optional[zipfile.ZipFile]:
    """Lazily opens and indexes data/nr_offline_bundle.zip in a thread-safe manner."""
    global _NR_OFFLINE_ZIP, _NR_OFFLINE_NAMES, _NR_OFFLINE_BOOK_BY_ID, _NR_OFFLINE_CT_MAP
    if _NR_OFFLINE_ZIP is not None:
        return _NR_OFFLINE_ZIP
    with _NR_OFFLINE_LOCK:
        if _NR_OFFLINE_ZIP is not None:
            return _NR_OFFLINE_ZIP
        if not os.path.exists(_NR_OFFLINE_BUNDLE_PATH):
            return None
        try:
            zf = zipfile.ZipFile(_NR_OFFLINE_BUNDLE_PATH, "r")
            names = set(zf.namelist())
            book_by_id: Dict[str, str] = {}
            for name in names:
                if name.startswith("books/") and name.endswith(".json"):
                    base = name[6:-5]  # "{sys_id}_{book_id}"
                    parts = base.split("_", 1)
                    if len(parts) == 2:
                        book_by_id[parts[1]] = name
            ct_map: Dict[str, str] = {}
            for mf_name in ("manifest.json", "manifest_extra.json"):
                if mf_name in names:
                    try:
                        mf_data = json.loads(zf.read(mf_name).decode("utf-8", errors="ignore"))
                        if isinstance(mf_data, dict):
                            for k, v in mf_data.items():
                                if isinstance(v, str):
                                    ct_map[k] = v
                    except Exception:
                        pass
            if "rpc/get_library.json" in names:
                try:
                    _index_library_book_versions(
                        zf.read("rpc/get_library.json"),
                        _NR_OFFLINE_BOOK_VERSIONS,
                        _NR_OFFLINE_BOOK_DATES,
                    )
                except Exception:
                    pass
            _NR_OFFLINE_NAMES = names
            _NR_OFFLINE_BOOK_BY_ID = book_by_id
            _NR_OFFLINE_CT_MAP = ct_map
            _NR_OFFLINE_ZIP = zf
            return zf
        except Exception as e:
            logger.warning("Failed to open nr_offline_bundle.zip: %s", e)
            return None


def _read_nr_offline_entry(arcname: str) -> Optional[bytes]:
    """Reads an entry from data/nr_offline_bundle.zip in a thread-safe manner."""
    zf = _ensure_nr_offline_bundle()
    if zf is None or arcname not in _NR_OFFLINE_NAMES:
        return None
    with _NR_OFFLINE_LOCK:
        try:
            return zf.read(arcname)
        except Exception as e:
            logger.warning("Error reading %s from nr_offline_bundle.zip: %s", arcname, e)
            return None


def _guess_nr_content_type(clean_path: str) -> str:
    """Determines MIME Content-Type for a static NewRecruit asset path."""
    if clean_path in _NR_OFFLINE_CT_MAP:
        return _NR_OFFLINE_CT_MAP[clean_path]
    low = clean_path.lower()
    if low.endswith(".js") or low.endswith(".mjs"):
        return "application/javascript; charset=utf-8"
    if low.endswith(".css"):
        return "text/css; charset=utf-8"
    if low.endswith(".json"):
        return "application/json; charset=utf-8"
    if low.endswith(".svg"):
        return "image/svg+xml"
    if low.endswith(".png"):
        return "image/png"
    if low.endswith(".webp"):
        return "image/webp"
    if low.endswith(".jpg") or low.endswith(".jpeg"):
        return "image/jpeg"
    if low.endswith(".ico"):
        return "image/x-icon"
    if low.endswith(".ttf"):
        return "font/ttf"
    if low.endswith(".woff2"):
        return "font/woff2"
    if low.endswith(".woff"):
        return "font/woff"
    guessed, _ = mimetypes.guess_type(clean_path)
    return guessed or "application/octet-stream"


def _lookup_nr_offline_static(clean_path: str) -> Optional[Tuple[bytes, str]]:
    """Looks up a static asset (/_nuxt/*, /settings/*, /assets/*, /icons/*) in data/nr_offline_bundle.zip."""
    path_no_q = clean_path.split("?")[0]
    if not path_no_q.startswith("/"):
        path_no_q = "/" + path_no_q
    arcname = f"static{path_no_q}"
    data = _read_nr_offline_entry(arcname)
    if data is not None:
        return data, _guess_nr_content_type(path_no_q)
    return None


def _lookup_nr_fast_stub_rpc(body: Optional[bytes]) -> Optional[Tuple[bytes, str]]:
    """Serves static non-catalogue RPCs (get_countries, get_timezones) and telemetry no-ops locally."""
    if not body:
        return None
    try:
        payload = json.loads(body.decode("utf-8", errors="ignore"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    rpc_method = str(payload.get("method") or "")

    if rpc_method in ("get_countries", "get_timezones"):
        data = _read_nr_offline_entry(f"rpc/{rpc_method}.json")
        if data is not None:
            return data, "application/json"

    if rpc_method in (
        "get_games",
        "get_websocket_port",
        "restore_purchases_check",
        "get_products_twa",
        "trackEvent",
        "report_client_error",
        "error_snapshot_save",
    ):
        return b"{}", "application/json"

    return None


def _lookup_nr_offline_rpc(body: Optional[bytes]) -> Optional[Tuple[bytes, str]]:
    """Fallback-only lookup for get_library and books_get_book_row from data/nr_offline_bundle.zip when live upstream is unreachable."""
    if not body:
        return None
    stmt = _lookup_nr_fast_stub_rpc(body)
    if stmt is not None:
        return stmt
    try:
        payload = json.loads(body.decode("utf-8", errors="ignore"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    rpc_method = str(payload.get("method") or "")
    params = payload.get("params")

    if rpc_method == "get_library":
        data = _read_nr_offline_entry("rpc/get_library.json")
        if data is not None:
            return data, "application/json"

    if rpc_method == "books_get_book_row" and isinstance(params, list) and len(params) >= 1:
        _ensure_nr_offline_bundle()
        if len(params) >= 2:
            arcname = f"books/{params[0]}_{params[1]}.json"
            data = _read_nr_offline_entry(arcname)
            if data is not None:
                return data, "application/json"
            fallback_arc = _NR_OFFLINE_BOOK_BY_ID.get(str(params[1]))
            if fallback_arc:
                data = _read_nr_offline_entry(fallback_arc)
                if data is not None:
                    return data, "application/json"
        else:
            fallback_arc = _NR_OFFLINE_BOOK_BY_ID.get(str(params[0]))
            if fallback_arc:
                data = _read_nr_offline_entry(fallback_arc)
                if data is not None:
                    return data, "application/json"

    return None


def _lookup_nr_offline_book_if_version_current(body: Optional[bytes]) -> Optional[Tuple[bytes, str]]:
    """
    Returns the book JSON from data/nr_offline_bundle.zip in <1ms if and only if
    live get_library has confirmed that the book's nrversion on www.newrecruit.eu
    matches the offline bundle's nrversion. Updated books (where live nrversion != offline nrversion)
    return None so they are fetched live from www.newrecruit.eu.
    """
    if not body or not _NR_LIVE_BOOK_VERSIONS:
        return None
    try:
        payload = json.loads(body.decode("utf-8", errors="ignore"))
    except Exception:
        return None
    if not isinstance(payload, dict) or str(payload.get("method") or "") != "books_get_book_row":
        return None
    params = payload.get("params")
    if not isinstance(params, list) or len(params) < 2:
        return None
    try:
        sys_id = int(params[0])
        book_id = int(params[1])
    except Exception:
        return None
    _ensure_nr_offline_bundle()
    live_v = _NR_LIVE_BOOK_VERSIONS.get((sys_id, book_id))
    off_v = _NR_OFFLINE_BOOK_VERSIONS.get((sys_id, book_id))
    if live_v is not None and off_v is not None and live_v == off_v:
        arcname = f"books/{sys_id}_{book_id}.json"
        data = _read_nr_offline_entry(arcname)
        if data is not None:
            return data, "application/json"
    return None


# Bounded cache of ephemeral parsed competitor rows so /nr/app/Lists/{list_key}?view=play always has immediate access
_EPHEMERAL_NR_ROWS: Dict[str, Dict[str, Any]] = {}
_EPHEMERAL_NR_ROWS_MAX = 200

try:
    import urllib3
    _NR_HTTP_POOL: Optional[Any] = urllib3.PoolManager(
        maxsize=16,
        retries=urllib3.Retry(total=1, connect=1, read=1, backoff_factor=0.1),
    )
except Exception:
    _NR_HTTP_POOL = None

# Per-user NewRecruit Cloud Account session store (keyed by user_id or 'default')
_NR_CLOUD_ACCOUNTS: Dict[str, Dict[str, Any]] = {}


def detect_nr_game_system_and_edition(data: Dict[str, Any]) -> Tuple[str, str]:
    """
    Accurately resolves ('40k' | 'aos', edition_label) from a NewRecruit list row or OmniTactica roster dict.
    Inspects id_system, bsid_system, _omnitactica_system_name, id_book, bsid_book, and faction.
    """
    raw_sys_id = data.get("id_system")
    try:
        sys_id_int = int(raw_sys_id) if raw_sys_id is not None else None
    except Exception:
        sys_id_int = None

    if sys_id_int in NR_SYSTEM_METADATA:
        meta = NR_SYSTEM_METADATA[sys_id_int]
        return str(meta["game_system"]), str(meta["edition_label"])

    bsid_sys = str(data.get("bsid_system") or "").strip().lower()
    if bsid_sys.startswith("e51d-b1a3-75fc-dc3g"):
        return "aos", "AoS 4.0"
    if bsid_sys.startswith("e51d-b1a3-75fc-"):
        return "aos", "AoS 3.0"
    if bsid_sys == NR_40K_SYSTEM_BSID.lower():
        return "40k", "11th Ed"
    if bsid_sys == NR_40K_10E_SYSTEM_BSID.lower():
        return "40k", "10th Ed"

    sys_name_hint = str(data.get("_omnitactica_system_name") or data.get("system_name") or "").lower()
    if "sigmar" in sys_name_hint or "aos" in sys_name_hint:
        edition = "AoS 3.0" if ("3.0" in sys_name_hint or "3rd" in sys_name_hint) else "AoS 4.0"
        return "aos", edition
    if "10th" in sys_name_hint or "10e" in sys_name_hint:
        return "40k", "10th Ed"
    if "11th" in sys_name_hint or "11e" in sys_name_hint:
        return "40k", "11th Ed"

    target_book_id = data.get("id_book")
    target_bsid_book = str(data.get("bsid_book") or "").strip()
    if target_book_id or target_bsid_book:
        for _, (bid, bsid, _) in NR_AOS_FACTION_BOOKS.items():
            if (target_book_id and str(bid) == str(target_book_id)) or (target_bsid_book and bsid == target_bsid_book):
                return "aos", "AoS 4.0"
        for _, (bid, bsid, _) in NR_40K_FACTION_BOOKS.items():
            if (target_book_id and str(bid) == str(target_book_id)) or (target_bsid_book and bsid == target_bsid_book):
                return "40k", "11th Ed"

    explicit_gs = str(data.get("game_system") or "").strip().lower()
    if explicit_gs == "aos":
        return "aos", str(data.get("system_edition") or "AoS 4.0")
    if explicit_gs == "40k":
        return "40k", str(data.get("system_edition") or "11th Ed")

    fac_low = str(data.get("faction") or data.get("_omnitactica_book_name") or data.get("book_name") or "").strip().lower()
    if fac_low and fac_low in NR_AOS_FACTION_BOOKS and fac_low not in NR_40K_FACTION_BOOKS:
        return "aos", "AoS 4.0"

    return "40k", "11th Ed"


def resolve_nr_40k_book(faction: str) -> Tuple[int, str, str]:
    """Resolves a faction name to its NewRecruit 40k (id_book, bsid_book, book_name)."""
    f_clean = (faction or "").strip().lower()
    if f_clean in NR_40K_FACTION_BOOKS:
        return NR_40K_FACTION_BOOKS[f_clean]
    for key, val in NR_40K_FACTION_BOOKS.items():
        if key in f_clean or f_clean in key:
            return val
    return NR_40K_FACTION_BOOKS["space marines"]


def resolve_nr_aos_book(faction: str) -> Tuple[int, str, str]:
    """Resolves a faction name to its NewRecruit Age of Sigmar 4.0 (id_book, bsid_book, book_name)."""
    f_clean = (faction or "").strip().lower()
    if " - " in f_clean:
        f_clean = f_clean.split(" - ")[-1].strip()
    if f_clean in NR_AOS_FACTION_BOOKS:
        return NR_AOS_FACTION_BOOKS[f_clean]
    for key, val in NR_AOS_FACTION_BOOKS.items():
        if key in f_clean or f_clean in key:
            return val
    return NR_AOS_FACTION_BOOKS["stormcast eternals"]


def resolve_nr_book(faction: str, game_system: str = "40k") -> Tuple[int, str, str]:
    """Resolves a faction name to its NewRecruit (id_book, bsid_book, book_name) for either '40k' or 'aos'."""
    if str(game_system or "").strip().lower() == "aos":
        return resolve_nr_aos_book(faction)
    return resolve_nr_40k_book(faction)


def build_roster_text_for_nr_compiler(roster: Dict[str, Any], book_name: str) -> str:
    """Builds a normalized Warhammer 40,000 or Age of Sigmar text export from parsed units for NewRecruit's native text compiler."""
    raw_text = str(roster.get("raw_text") or "").strip()
    raw_up = raw_text.upper()

    # Preserve native NewRecruit WTC-Compact or GW / Warhammer App text directly if already valid
    if raw_text and not raw_text.startswith(("{", "<")):
        if "FACTION KEYWORD:" in raw_up and ("CHAR1:" in raw_up or " WITH " in raw_up or "CREATED WITH NEWRECRUIT" in raw_up):
            return raw_text
        if any(
            hdr in raw_up
            for hdr in ("CHARACTERS", "BATTLELINE", "OTHER DATASHEETS", "ATTACHED UNITS", "DEDICATED TRANSPORTS")
        ):
            return raw_text

    gw_txt = str(roster.get("gw_text") or roster.get("_omnitactica_gw_text") or "").strip()
    if gw_txt and len(gw_txt) > 20:
        return gw_txt

    nr_txt = str(roster.get("nr_text") or roster.get("_omnitactica_nr_text") or "").strip()
    if nr_txt and len(nr_txt) > 20:
        return nr_txt

    units = [u for u in (roster.get("units") or []) if isinstance(u, dict) and u.get("name")]
    if not units and raw_text and not raw_text.startswith("{"):
        return raw_text

    try:
        from army_list_parser import ArmyListParser
        parser = ArmyListParser()
        roster_copy = dict(roster)
        if book_name and (not roster_copy.get("faction") or roster_copy.get("faction") == "Warhammer 40,000"):
            roster_copy["faction"] = book_name.split(" - ")[-1].strip() if " - " in book_name else book_name
        formatted_gw = parser.format_roster_gw_text(roster_copy)
        if formatted_gw:
            return formatted_gw
    except Exception:
        pass

    gs, _ = detect_nr_game_system_and_edition(roster)
    default_det = "Sentinels of the Bleak Citadels" if gs == "aos" else "Gladius Task Force"
    detachment = str(roster.get("detachment") or default_det).strip()
    if detachment in ("Core Detachment", "Unknown Detachment", "Tournament Standard", "Battle Formation"):
        detachment = ""
    pts = int(roster.get("points") or 2000)

    lines = [
        f"{roster.get('name') or 'Army Roster'} ({pts:,} Points)",
        "",
        book_name.split(" - ")[-1].strip() if " - " in book_name else book_name,
    ]
    if detachment:
        lines.append(detachment)
    lines.append(f"Strike Force ({pts:,} Points)")
    lines.append("")
    lines.append("OTHER DATASHEETS")
    lines.append("")

    for u in units:
        u_name = re.sub(r"^\d+x\s+", "", str(u.get("name") or "Unit").strip(), flags=re.I)
        u_pts = int(u.get("points") or 0)
        u_models = max(1, int(u.get("model_count") or 1))
        lines.append(f"{u_name} ({u_pts} Points)")
        if u.get("is_warlord"):
            lines.append("  • Warlord")
        if u_models > 1:
            singular = u_name[:-1] if (u_name.endswith("s") and not u_name.endswith("ss") and len(u_name) > 4) else u_name
            lines.append(f"  • {u_models}x {singular}")
        for wg in (u.get("wargear") or []):
            wg_s = str(wg).strip()
            if wg_s and wg_s.lower() not in ("warlord",):
                has_cnt_prefix = bool(re.match(r"^\d+x\s+", wg_s, re.I))
                if u_models > 1:
                    wg_item = wg_s if has_cnt_prefix else f"{u_models}x {wg_s}"
                    lines.append(f"     ◦ {wg_item}")
                else:
                    wg_item = wg_s if has_cnt_prefix else f"1x {wg_s}"
                    lines.append(f"  • {wg_item}")
        if u.get("enhancement"):
            lines.append(f"  • Enhancements: {u['enhancement']}")
        lines.append("")

    return "\n".join(lines).strip()


OMNITACTICA_NR_BRIDGE_SCRIPT = r"""
<style id="omnitactica-nr-clean-ui">
  /* 1. Hide all ad banners, supporter prompts, and subscription/payment clutter */
  .support-banner,
  .ad-banner,
  .adbanner,
  [class*="SupportNewRecruit"],
  [class*="playwire"],
  [id^="google_ads"],
  [id^="div-gpt-ad"],
  [id^="tyche"],
  .pw-tag,
  [data-v-2c249119],
  iframe[src*="googlesyndication"],
  iframe[src*="doubleclick"],
  iframe[src*="intergient"],
  iframe[src*="playwire"] {
    display: none !important;
    height: 0 !important;
    max-height: 0 !important;
    overflow: hidden !important;
    pointer-events: none !important;
  }

  /* 2. Hide NewRecruit's Top/Bottom Menu Bar — Controls live in OmniTactica's own header */
  header,
  .menu.mainMenu {
    display: none !important;
    height: 0 !important;
    max-height: 0 !important;
    overflow: hidden !important;
    pointer-events: none !important;
  }
  html,
  body,
  #__nuxt {
    height: 100% !important;
    max-height: 100% !important;
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    margin: 0 !important;
    background-color: #0f1524 !important;
    color: #e5eaf3 !important;
  }
  #mainContent,
  .mainContent {
    top: 0 !important;
    bottom: 0 !important;
    height: 100% !important;
    max-height: 100% !important;
  }
  .main-view {
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    margin-top: 0 !important;
    background-color: #0f1524 !important;
  }

  /* 3. MyLists (/app/MyLists): Hide all controls above the actual list table (Create List, Any, Search, Group/Sort checkboxes, Import/Sync/Delete buttons) */
  .box.noaccount,
  [data-v-b9210782] > div > .boutons.mobilePadding,
  [data-v-b9210782] .boutons.mobilePadding,
  .main-view > div > div > .boutons.mobilePadding,
  button.createToolbarBtn,
  button.createFab,
  .listsView > .mobilePadding:not(.listsList),
  .listsView .listViewHeader,
  .listsView .checkboxes,
  .listsView[data-v-7711fa10] > .mobilePadding:not(.listsList),
  .listsView[data-v-7711fa10] .listViewHeader,
  .listsView[data-v-7711fa10] .checkboxes,
  [data-v-2b034e2c],
  .importButtons,
  .importRow,
  .folder > .boutons,
  .folder[data-v-7711fa10] > .boutons,
  .listsView > .boutons > button.bouton,
  [data-v-7711fa10] > .boutons > button.bouton,
  .omnitactica-hidden-nr-btn {
    display: none !important;
  }
  .listsView .listsList.mobilePadding,
  .listsView[data-v-7711fa10] .listsList.mobilePadding {
    padding-top: 8px !important;
  }
  .main-view > [data-v-b9210782],
  .main-view > [data-v-ecdec291] {
    display: block !important;
  }

  /* 4. Direct-List Loading Screen & Embedded Play Mode Viewer Cleanup */
  html.omnitactica-nr-embedded-viewer header,
  html.omnitactica-nr-embedded-viewer .menu.mainMenu,
  html.omnitactica-nr-embedded-viewer .errorWindow {
    display: none !important;
  }
  html.omnitactica-nr-embedded-viewer.omnitactica-nr-target-list-mode .listsView {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
  html.omnitactica-nr-embedded-viewer .main-view {
    padding-top: 0 !important;
    margin-top: 0 !important;
  }
  html.omnitactica-nr-direct-list-loading,
  html.omnitactica-nr-direct-list-loading body {
    background: #090d16 !important;
    overflow: hidden !important;
  }
  html.omnitactica-nr-direct-list-loading #__nuxt {
    opacity: 0 !important;
    pointer-events: none !important;
  }
  #omnitactica-nr-direct-loader {
    position: fixed;
    inset: 0;
    z-index: 999999;
    background: radial-gradient(circle at center, #0f172a 0%, #070b14 100%);
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    color: #f8fafc;
    text-align: center;
    padding: 24px;
  }
  html.omnitactica-nr-direct-list-loading #omnitactica-nr-direct-loader {
    display: flex !important;
  }
  @keyframes omniNrSpin {
    to { transform: rotate(360deg); }
  }
  .omnitactica-nr-spinner {
    width: 40px;
    height: 40px;
    border: 3.5px solid rgba(56, 189, 248, 0.2);
    border-top-color: #38bdf8;
    border-radius: 50%;
    animation: omniNrSpin 0.75s linear infinite;
  }

  /* 5. Login / Account Page (/app/Login): Keep ONLY the Login Form / Welcome + Logout button */
  .connectForm .nrversion,
  .connectForm .section,
  .connectForm .section.boutons,
  .connectForm a[href="/app/Options"],
  .connectForm a[href="/app/MySystems"],
  .connectForm a[href="/app/MyModels"],
  .connectForm a[href="/app/combat"],
  .connectForm a[href="/app/wh40kSimulator"],
  .connectForm a[href="/app/wh40kDeployment"],
  .connectForm a[href="/app/tourny"],
  .connectForm a[href="/app/Profile"],
  .connectForm a[href="/app/changelog"],
  .connectForm a[href="/app/Contact"],
  .connectForm a[href="/app/Paths"],
  .connectForm .modal {
    display: none !important;
  }

  #mainContent.connectForm,
  .connectForm {
    position: relative !important;
    top: auto !important;
    bottom: auto !important;
    left: auto !important;
    right: auto !important;
    display: block !important;
    max-width: 380px !important;
    width: 92% !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: calc(100dvh - 24px) !important;
    margin: 24px auto !important;
    padding: 24px 28px !important;
    background: #1d2740 !important;
    color: #e5eaf3 !important;
    border: 1px solid #33405c !important;
    border-radius: 14px !important;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45) !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    -webkit-overflow-scrolling: touch !important;
    box-sizing: border-box !important;
  }
  .connectForm #loginform {
    height: auto !important;
    min-height: 0 !important;
    margin: 0 auto !important;
    width: 100% !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
  }
  /* Ensure 16px font size on login inputs so mobile iOS/Android browsers never auto-zoom/reflow or dismiss the virtual keyboard */
  .connectForm #loginform input[type="text"],
  .connectForm #loginform input[type="password"],
  .connectForm #loginform input#login,
  .connectForm #loginform input#password {
    font-size: 16px !important;
    line-height: 1.35 !important;
    padding: 10px 12px !important;
    border-radius: 8px !important;
    background-color: #243049 !important;
    color: #f8fafc !important;
    border: 1px solid #475569 !important;
    width: 100% !important;
    max-width: 280px !important;
    box-sizing: border-box !important;
    touch-action: manipulation !important;
  }
</style>
<script id="omnitactica-nr-bridge">
(function() {
  if (window.__omnitacticaNrBridgeInstalled) return;
  window.__omnitacticaNrBridgeInstalled = true;

  // Unified OmniTactica Dark Slate Theme (matches NewRecruit's built-in "Dark" preset_dark & OmniTactica #0f1524 UI)
  var OMNI_NR_DARK_THEME = {
    background: { colors: ['#0f1524', '#0f1524'], alpha: 100 },
    hue: 0,
    title: { colors: ['#1d2740', '#1d2740'], alpha: 100 },
    forcesBackground: { colors: ['#1d2740', '#1d2740'], alpha: 100 },
    unitsBackground: { colors: ['#ffffff'], alpha: 7 },
    costsBackground: { colors: ['#ffffff'], alpha: 10 },
    dropdownStyle: 2,
    inputRadius: 8,
    inputHighlights: '#818cf8',
    fontHeaderSize: 18,
    borderColor: '#33405c',
    colorGray: '#9aa7bd',
    colorBlue: '#60a5fa',
    hoverColor: { colors: ['#ffffff'], alpha: 9 },
    backgroundRepeat: 'no-repeat',
    lightblue: '#67e8f9',
    italic: 'italic',
    backgroundTexture: 'url(/assets/images/no.jpg)',
    highlight: '#fffef1',
    inputBackground: '#243049',
    categoryIcons: true,
    costsLeft: false,
    invertColors: false,
    invertImages: false,
    invertImagesBrightness: '75',
    font: 'sans-serif',
    fontSize: 16,
    fontHeader: 'sans-serif',
    headerTransform: 'none',
    fontButton: 'sans-serif',
    fontButtonSize: 16,
    fontColor: '#e5eaf3',
    fontColorUnits: '#e5eaf3',
    fontColorForces: '#e5eaf3',
    fontColorTitle: '#eef1f8',
    colorRed: '#f87171',
    colorGreen: '#4ade80',
    colorLightblue: '#67e8f9',
    costColor: '#a5b4fc',
    dark: true,
    fitBackground: false,
    titleBarColor: 'red',
    backgroundSize: '',
    bga: 100,
    hoverTransparency: 15
  };

  function applyOmniNrDarkTheme(optStore) {
    try {
      var rawOpt = localStorage.getItem('options');
      var parsedOpt = rawOpt ? JSON.parse(rawOpt) : {};
      if (!parsedOpt || typeof parsedOpt !== 'object') parsedOpt = {};
      if (!parsedOpt.appearence || !parsedOpt.appearence.dark || parsedOpt.themePopup !== false) {
        parsedOpt.appearence = Object.assign({}, parsedOpt.appearence || {}, OMNI_NR_DARK_THEME);
        parsedOpt.themePopup = false;
        localStorage.setItem('options', JSON.stringify(parsedOpt));
      }
    } catch (e) {}
    if (optStore) {
      if (optStore.__omniDarkThemeApplied) return;
      try {
        optStore.__omniDarkThemeApplied = true;
        if (optStore.options) {
          optStore.options.themePopup = false;
          optStore.options.appearence = Object.assign({}, optStore.options.appearence || {}, OMNI_NR_DARK_THEME);
        }
        optStore.themeEnabled = true;
        if (typeof optStore.setThemeOverride === 'function') {
          optStore.setThemeOverride(OMNI_NR_DARK_THEME);
        } else if (typeof optStore.updateAppearance === 'function') {
          optStore.themeOverride = OMNI_NR_DARK_THEME;
          optStore.updateAppearance();
        }
      } catch (e) {}
    }
  }
  applyOmniNrDarkTheme(null);

  // 0. Persist & restore NewRecruit JWT auth tokens across Cloud Run deploys/reloads & multiple devices
  // and stabilize /app/Login inputs so autofill or field switching never minimizes the mobile keyboard.
  var AUTH_BACKUP_KEY = 'omni_nr_auth_backup_v1';
  var lastPushedNrAccess = '';

  function decodeNrJwtPayload(tokenStr) {
    if (!tokenStr || typeof tokenStr !== 'string') return null;
    try {
      var cleanTok = tokenStr.replace(/^JWT\s+/i, '').replace(/^Bearer\s+/i, '').trim();
      var parts = cleanTok.split('.');
      if (parts.length < 2) return null;
      var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4 !== 0) b64 += '=';
      var jsonStr = decodeURIComponent(escape(window.atob(b64)));
      var payload = JSON.parse(jsonStr);
      return (payload && typeof payload === 'object') ? payload : null;
    } catch (e) {
      return null;
    }
  }

  function pushNrAuthToOmniServer(loginStr, accessTok, refreshTok, clientKeyStr) {
    try {
      if (!accessTok || window.__omniExplicitLogout || isEphemeralViewer) return;
      if (lastPushedNrAccess === accessTok) return;
      lastPushedNrAccess = accessTok;
      var hdrs = { 'Content-Type': 'application/json' };
      try {
        var sessTok = localStorage.getItem('native_session_token') || localStorage.getItem('elo_auth_token') || '';
        if (!sessTok && document.cookie) {
          var m = document.cookie.match(/(?:^|;\s*)(?:session_token|elo_auth_token|native_session_token)=([^;]+)/);
          if (m && m[1]) sessTok = decodeURIComponent(m[1]);
        }
        if (sessTok) hdrs['Authorization'] = 'Bearer ' + sessTok;
      } catch (e2) {}
      fetch('/api/armylists/nr_cloud_connect', {
        method: 'POST',
        headers: hdrs,
        credentials: 'same-origin',
        body: JSON.stringify({
          action: 'save_tokens',
          login: loginStr || '',
          access_token: accessTok,
          refresh_token: refreshTok || '',
          client_key: clientKeyStr || ''
        })
      }).then(function(r) {
        if (r && r.ok) {
          try {
            var rawB = localStorage.getItem(AUTH_BACKUP_KEY);
            if (rawB) {
              var bObj = JSON.parse(rawB);
              if (bObj && typeof bObj === 'object') {
                bObj.synced_to_server = true;
                localStorage.setItem(AUTH_BACKUP_KEY, JSON.stringify(bObj));
              }
            }
          } catch (e3) {}
        }
      }).catch(function() {});
    } catch (e) {}
  }

  try {
    var origLsSetItem = Storage.prototype.setItem;
    var origLsRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.setItem = function(k, v) {
      if (this === window.localStorage && (k === 'access' || k === 'refresh')) {
        var strV = String(v);
        if (!v || strV === 'null' || strV === 'undefined') {
          if (!window.__omniExplicitLogout) {
            return;
          }
          return origLsRemoveItem.call(this, k);
        }
      }
      return origLsSetItem.apply(this, arguments);
    };
    Storage.prototype.removeItem = function(k) {
      if (this === window.localStorage && (k === 'access' || k === 'refresh') && !window.__omniExplicitLogout) {
        var hasBak = this.getItem(AUTH_BACKUP_KEY);
        if (hasBak) return;
      }
      return origLsRemoveItem.apply(this, arguments);
    };
  } catch (e) {}

  function backupOrRestoreNrAuth(userStore) {
    try {
      if (window.__omniExplicitLogout) return;
      var curAccess = localStorage.getItem('access') || '';
      if (curAccess === 'null' || curAccess === 'undefined') curAccess = '';
      var curRefresh = localStorage.getItem('refresh') || '';
      if (curRefresh === 'null' || curRefresh === 'undefined') curRefresh = '';
      var rawBackup = localStorage.getItem(AUTH_BACKUP_KEY);
      var backup = rawBackup ? JSON.parse(rawBackup) : null;

      if (curAccess) {
        var jwtUser = decodeNrJwtPayload(curAccess);
        var resolvedLogin = (userStore && userStore.user && userStore.user.login) ||
                            (backup && backup.user && backup.user.login) ||
                            (jwtUser && (jwtUser.login || jwtUser.username || jwtUser.name)) || '';
        var resolvedId = (userStore && userStore.user && (userStore.user._id || userStore.user.id)) ||
                         (jwtUser && (jwtUser.user_id || jwtUser.id)) ||
                         (backup && backup.user && (backup.user._id || backup.user.id)) || 1;
        var userObj = resolvedLogin ? {
          _id: resolvedId,
          id: resolvedId,
          login: resolvedLogin,
          email: (userStore && userStore.user && userStore.user.email) || (jwtUser && jwtUser.email) || '',
          permission: (userStore && userStore.user && userStore.user.permission) || (jwtUser && jwtUser.role) || 10,
          patreon_tier: (userStore && userStore.user && userStore.user.patreon_tier) || 3,
          sub: { expiration: (jwtUser && jwtUser.expiration) || undefined }
        } : null;
        var wasAlreadySynced = Boolean(backup && backup.access === curAccess && backup.synced_to_server);
        var nextBackup = {
          access: curAccess,
          refresh: curRefresh || (backup && backup.refresh) || '',
          user: userObj,
          synced_to_server: wasAlreadySynced,
          updated_at: (backup && backup.access === curAccess && backup.updated_at) ? backup.updated_at : Date.now()
        };
        localStorage.setItem(AUTH_BACKUP_KEY, JSON.stringify(nextBackup));
        if (userStore && !userStore.user && userObj && userObj.login) {
          userStore.user = userObj;
        }
        if (!wasAlreadySynced) {
          pushNrAuthToOmniServer(
            (userObj && userObj.login) || '',
            curAccess,
            nextBackup.refresh,
            (userStore && userStore.client_key) || localStorage.getItem('client-key') || ''
          );
        }
      } else if (backup && backup.access && backup.access !== 'null' && backup.access !== 'undefined') {
        localStorage.setItem('access', backup.access);
        if (backup.refresh && !curRefresh) {
          localStorage.setItem('refresh', backup.refresh);
        }
        if (userStore && !userStore.user && backup.user && backup.user.login) {
          userStore.user = backup.user;
        }
      }
    } catch (e) {}
  }
  backupOrRestoreNrAuth(null);

  function stabilizeLoginFormInputs() {
    try {
      var form = document.getElementById('loginform');
      if (!form) return;
      if (!form.__omniLoginStabilized) {
        form.__omniLoginStabilized = true;
        form.setAttribute('novalidate', 'novalidate');
        // Prevent @focusout="validateField" from calling reportValidity() when tapping between fields or using password manager autofill
        form.addEventListener('focusout', function(ev) {
          var t = ev && ev.target;
          if (t && (t.id === 'login' || t.id === 'password' || t.tagName === 'INPUT')) {
            ev.stopImmediatePropagation();
          }
        }, true);
      }
      var loginInput = document.getElementById('login');
      if (loginInput && !loginInput.__omniInputStabilized) {
        loginInput.__omniInputStabilized = true;
        loginInput.setAttribute('autocomplete', 'username');
        loginInput.setAttribute('autocapitalize', 'none');
        loginInput.setAttribute('autocorrect', 'off');
        loginInput.setAttribute('spellcheck', 'false');
        loginInput.removeAttribute('required');
        loginInput.removeAttribute('min');
        loginInput.removeAttribute('max');
        loginInput.reportValidity = function() { return true; };
      }
      var passInput = document.getElementById('password');
      if (passInput && !passInput.__omniInputStabilized) {
        passInput.__omniInputStabilized = true;
        passInput.setAttribute('autocomplete', 'current-password');
        passInput.removeAttribute('required');
        passInput.removeAttribute('min');
        passInput.removeAttribute('max');
        passInput.reportValidity = function() { return true; };
      }
    } catch (e) {}
  }
  document.addEventListener('focusin', function(ev) {
    var t = ev && ev.target;
    if (t && (t.id === 'login' || t.id === 'password' || (t.closest && t.closest('#loginform')))) {
      stabilizeLoginFormInputs();
    }
  }, true);

  // 0a. Prevent NewRecruit from registering /worker.js as a root Service Worker on OmniTactica's origin,
  // and immediately unregister any legacy Service Worker & 'newrecruit' CacheStorage bucket.
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker) {
      if (typeof navigator.serviceWorker.getRegistrations === 'function') {
        navigator.serviceWorker.getRegistrations().then(function(regs) {
          regs.forEach(function(r) { try { r.unregister(); } catch (e) {} });
        }).catch(function() {});
      }
      navigator.serviceWorker.register = function() {
        return Promise.resolve({
          installing: null,
          waiting: null,
          active: null,
          scope: '/',
          updateViaCache: 'none',
          addEventListener: function() {},
          removeEventListener: function() {},
          update: function() { return Promise.resolve(); },
          unregister: function() { return Promise.resolve(true); }
        });
      };
    }
    if ('caches' in window && window.caches && typeof window.caches.delete === 'function') {
      window.caches.delete('newrecruit').catch(function() {});
    }
  } catch (e) {}

  // 0b. Block all 3rd-party Ad/RTB/Telemetry requests (Playwire, Prebid, OpenX, Rubicon, GTag, Sentry)
  // so 0 red "(blocked:other)" errors occur and page load is never delayed by ad auctions.
  var AD_BLOCK_RE = /playwire|intergient|prebid|openx|rubiconproject|doubleclick|googlesyndication|googletagmanager|google-analytics|gtag\/js|btloader|adnxs|criteo|pubmatic|sonobi|sharethrough|gumgum|3lift|casalemedia|amazon-adsystem|indexexchange|smartadserver|yieldmo|kargo|teads|onetag|medianet|bidswitch|taboola|outbrain|sentry\.io|report_client_error|error_snapshot_save/i;
  var initialSearchEarly = window.location.search || '';
  var isFastPlayViewer = Boolean(
    (initialSearchEarly.indexOf('embed=hub') !== -1 || initialSearchEarly.indexOf('embed=tracker') !== -1) &&
    (initialSearchEarly.indexOf('ephemeral=1') !== -1 || initialSearchEarly.indexOf('view=play') !== -1 || initialSearchEarly.indexOf('play=1') !== -1)
  );
  function getFastPlayStubJson(urlStr) {
    if (!isFastPlayViewer || !urlStr) return null;
    if (/\/api\/token(?:\?|$)/i.test(urlStr)) {
      return JSON.stringify({
        access: localStorage.getItem('access') || '',
        refresh: localStorage.getItem('refresh') || ''
      });
    }
    if (/[?&]m=getUser\b/i.test(urlStr)) {
      return JSON.stringify({ id: 1, login: 'Commander', patreon_tier: 3, supporter: 2, tier: 2 });
    }
    if (/[?&]m=(?:user_get_data|get_list_bulk)\b/i.test(urlStr)) {
      return JSON.stringify({ lists: [] });
    }
    if (/[?&]m=user_get_list\b/i.test(urlStr)) {
      return 'null';
    }
    return null;
  }

  try {
    var origFetch = window.fetch ? window.fetch.bind(window) : null;
    if (origFetch) {
      window.fetch = function(input, init) {
        var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
        if (url && AD_BLOCK_RE.test(url)) {
          return Promise.resolve(new Response('{}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
        var fastPlayStub = getFastPlayStubJson(url);
        if (fastPlayStub !== null) {
          return Promise.resolve(new Response(fastPlayStub, {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
        if (typeof input === 'string' && /^https?:\/\/(?:api|www)\.newrecruit\.eu(\/.*)$/i.test(input)) {
          input = input.replace(/^https?:\/\/(?:api|www)\.newrecruit\.eu/i, '');
        }
        return origFetch(input, init);
      };
    }

    var origXhrOpen = XMLHttpRequest.prototype.open;
    var origXhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      var urlStr = String(url || '');
      this.__omniBlockedAd = AD_BLOCK_RE.test(urlStr);
      if (this.__omniBlockedAd) {
        return origXhrOpen.call(this, method, 'data:application/json,%7B%7D', true);
      }
      var fastStub = getFastPlayStubJson(urlStr);
      if (fastStub !== null) {
        this.__omniBlockedAd = true;
        return origXhrOpen.call(this, method, 'data:application/json,' + encodeURIComponent(fastStub), true);
      }
      if (/^https?:\/\/(?:api|www)\.newrecruit\.eu(\/.*)$/i.test(urlStr)) {
        arguments[1] = urlStr.replace(/^https?:\/\/(?:api|www)\.newrecruit\.eu/i, '');
      }
      return origXhrOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
      if (this.__omniBlockedAd) {
        var self = this;
        setTimeout(function() {
          try {
            if (typeof self.onload === 'function') self.onload();
            if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
          } catch (e) {}
        }, 0);
        return;
      }
      return origXhrSend.apply(this, arguments);
    };

    var origCreateElement = document.createElement.bind(document);
    document.createElement = function(tagName, options) {
      var el = origCreateElement(tagName, options);
      if (String(tagName || '').toLowerCase() === 'script') {
        var origSetAttr = el.setAttribute.bind(el);
        el.setAttribute = function(name, val) {
          if (String(name || '').toLowerCase() === 'src' && AD_BLOCK_RE.test(String(val || ''))) {
            return origSetAttr('src', 'data:text/javascript,//');
          }
          return origSetAttr(name, val);
        };
        try {
          var protoDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
          if (protoDesc && protoDesc.set) {
            Object.defineProperty(el, 'src', {
              configurable: true,
              enumerable: true,
              get: function() { return protoDesc.get ? protoDesc.get.call(this) : this.getAttribute('src'); },
              set: function(v) {
                if (AD_BLOCK_RE.test(String(v || ''))) {
                  v = 'data:text/javascript,//';
                }
                if (protoDesc.set) protoDesc.set.call(this, v);
                else origSetAttr('src', v);
              }
            });
          }
        } catch (e) {}
      }
      return el;
    };
  } catch (e) {}

  // Heal any corrupt legacy 'nr' IndexedDB (version < 200 created before Dexie) so Dexie never hits VersionError
  try {
    if (window.indexedDB && typeof window.indexedDB.databases === 'function') {
      window.indexedDB.databases().then(function(dbs) {
        if (!Array.isArray(dbs)) return;
        dbs.forEach(function(d) {
          if (d && d.name === 'nr' && d.version && d.version < 200) {
            try { window.indexedDB.deleteDatabase('nr'); } catch (e) {}
          }
        });
      }).catch(function() {});
    }
  } catch (e) {}

  // 0b. Inline NewRecruit UI SVG icons & cache-bust /assets/*, /icons/*, /settings/* <img> src
  // so stale 404 entries in the browser HTTP disk cache can never cause broken image icons.
  var NR_INLINE_SVG_ICONS = {
    '/assets/icons/eye.svg': 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNS4yIiBoZWlnaHQ9IjE3IiB2aWV3Qm94PSI4LjUgMCA5NS4wIDY0Ij48cGF0aCBkPSJNMTIuMCwzMi4wIFE1Ni4wLC0xNi4wIDEwMC4wLDMyLjAgUTU2LjAsODAuMCAxMi4wLDMyLjAgWiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjQuNSIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjxjaXJjbGUgY3g9IjU2IiBjeT0iMzIiIHI9IjI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iNC41Ii8+PHBhdGggdHJhbnNmb3JtPSJ0cmFuc2xhdGUoNTYsMzIpIHNjYWxlKDAuNTYzMSkgcm90YXRlKC00NSkgdHJhbnNsYXRlKC02MS40NCwtNDMuNDgpIiBkPSJNNjAuNzksMjIuMTdsNC4wOCwwLjM5Yy0xLjQ1LDIuMTgtMi4zMSw0LjgyLTIuMzEsNy42N2MwLDcuNDgsNS44NiwxMy41NCwxMy4xLDEzLjU0YzIuMzIsMCw0LjUtMC42Miw2LjM5LTEuNzJjMC4wMywwLjQ3LDAuMDUsMC45NCwwLjA1LDEuNDJjMCwxMS43Ny05LjU0LDIxLjMxLTIxLjMxLDIxLjMxYy0xMS43NywwLTIxLjMxLTkuNTQtMjEuMzEtMjEuMzFDMzkuNDgsMzEuNzEsNDkuMDIsMjIuMTcsNjAuNzksMjIuMTdMNjAuNzksMjIuMTdMNjAuNzksMjIuMTd6Ii8+PC9zdmc+',
    '/assets/icons/compare-list.svg': 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIxNi43IiB2aWV3Qm94PSIwIDAgMjQgMjAiPgogIDxyZWN0IHg9IjEuNiIgeT0iMS42IiB3aWR0aD0iMjAuOCIgaGVpZ2h0PSIxNi44IiByeD0iMi42IiBmaWxsPSJub25lIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMS43Ii8+CiAgPHJlY3QgeD0iNiIgeT0iNiIgd2lkdGg9IjEyIiBoZWlnaHQ9IjIuNiIgcng9IjEuMyIgZmlsbD0iIzAwMCIvPgogIDxyZWN0IHg9IjYiIHk9IjExLjQiIHdpZHRoPSIxMiIgaGVpZ2h0PSIyLjYiIHJ4PSIxLjMiIGZpbGw9IiMwMDAiLz4KPC9zdmc+Cg==',
    '/assets/icons/i.svg': 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij4KICA8bWFzayBpZD0iaUJhZGdlIj4KICAgIDxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgZmlsbD0iI2ZmZiIvPgogICAgPGNpcmNsZSBjeD0iMTIiIGN5PSI3LjMiIHI9IjEuNSIgZmlsbD0iIzAwMCIvPgogICAgPHJlY3QgeD0iMTAuNiIgeT0iMTAuNSIgd2lkdGg9IjIuOCIgaGVpZ2h0PSI3IiByeD0iMS40IiBmaWxsPSIjMDAwIi8+CiAgPC9tYXNrPgogIDxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjExIiBmaWxsPSIjNTU1NTU1IiBtYXNrPSJ1cmwoI2lCYWRnZSkiLz4KPC9zdmc+Cg==',
    '/assets/icons/right1.svg': 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgdmlld0JveD0iMCAwIDIwIDIwIiBmaWxsPSJub25lIiBzdHJva2U9IiMyRjlBRDIiIHN0cm9rZS13aWR0aD0iMy44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPgogIDwhLS0gc2hhZnQgLS0+CiAgPHBhdGggZD0iTTEuNiAxMCBIMTMuNSIgLz4KICA8IS0tIGFycm93aGVhZCAtLT4KICA8cGF0aCBkPSJNMTAuNiAzIEwxOCAxMCBMMTAuNiAxNyIgLz4KPC9zdmc+Cg==',
    '/assets/icons/right2.svg': 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgdmlld0JveD0iMCAwIDIwIDIwIj4KICA8cGF0aCBkPSJNNC4zIDEuOSBMMTUuOCAxMCBMNC4zIDE4LjEgWiIgZmlsbD0iIzAwMDAwMCIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjAuNiIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgo8L3N2Zz4K',
    '/assets/icons/right3.svg': 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgdmlld0JveD0iMCAwIDIwIDIwIj4KICA8cGF0aCBkPSJNMCAyIEw1IDIgTDExIDEwIEw1IDE4IEwwIDE4IEw2IDEwIFoiIGZpbGw9IiMwMDIyM0YiLz4KICA8cGF0aCBkPSJNOCAyIEwxMyAyIEwxOSAxMCBMMTMgMTggTDggMTggTDE0IDEwIFoiIGZpbGw9IiMwMEE4RTMiLz4KPC9zdmc+Cg==',
    '/assets/icons/iconeplus.svg': 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgdmlld0JveD0iMCAwIDI0IDI0Ij4KICA8cGF0aCBkPSJNOCAyLjJIMTZWOEgyMS44VjE2SDE2VjIxLjhIOFYxNkgyLjJWOEg4WiIKICAgICAgICBmaWxsPSIjOTZkMzQxIiBzdHJva2U9IiM2NmFjMWMiIHN0cm9rZS13aWR0aD0iMS42IiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+Cjwvc3ZnPgo=',
    '/assets/icons/force2.svg': 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNSIgaGVpZ2h0PSIyNSIgdmlld0JveD0iMCAwIDI1IDI1IiBmaWxsPSIjMDAwMDAwIj4KICA8IS0tIGZpbmlhbCAtLT4KICA8Y2lyY2xlIGN4PSI1LjUiIGN5PSIyLjkiIHI9IjEuNiIvPgogIDwhLS0gcG9sZSAtLT4KICA8cmVjdCB4PSI0LjU1IiB5PSIzLjYiIHdpZHRoPSIxLjkiIGhlaWdodD0iMTkiIHJ4PSIwLjk1Ii8+CiAgPCEtLSBiYW5uZXIgd2l0aCBzd2FsbG93dGFpbCBlbmQgLS0+CiAgPHBhdGggZD0iTTYuNCw0LjYgTDIwLjYsNC42IEwxNi45LDkuMiBMMjAuNiwxMy44IEw2LjQsMTMuOCBaIi8+Cjwvc3ZnPgo=',
    '/assets/icons/helmet.svg': 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNSAyNSIgd2lkdGg9IjI1IiBoZWlnaHQ9IjI1Ij4KICA8IS0tIHZlY3RvciB0cmFjZSBvZiB0aGUgY2xhc3NpYyBoZWxtZXQucG5nIHVuaXQgaWNvbiAoZnJvbnQtZmFjaW5nIGNvcmludGhpYW4gaGVsbWV0KSAtLT4KICA8ZyBmaWxsPSJjdXJyZW50Q29sb3IiPgogICAgPHBhdGggZD0iTTEyLjUgMCBDNy42IDAgMy45IDEuOSAyLjcgNC42IEMyLjQgNS4zIDMgNS45IDMuNyA1LjcgQzYuMyA1IDkuMyA0LjYgMTIuNSA0LjYgQzE1LjcgNC42IDE4LjcgNSAyMS4zIDUuNyBDMjIgNS45IDIyLjYgNS4zIDIyLjMgNC42IEMyMS4xIDEuOSAxNy40IDAgMTIuNSAwIFoiLz4KICAgIDxwYXRoIGQ9Ik0xMi41IDYuNSBDOS4xIDYuNSA2LjYgOC43IDYuMSAxMi4yIEM2IDEzIDUuOSAxMy43IDUuODUgMTQuNCBMMTkuMTUgMTQuNCBDMTkuMSAxMy43IDE5IDEzIDE4LjkgMTIuMiBDMTguNCA4LjcgMTUuOSA2LjUgMTIuNSA2LjUgWiIvPgogICAgPHBhdGggZD0iTTUuODUgMTMuNSBMNi42IDEzLjUgQzcuMiAxNC4yIDcuNyAxNC45IDguMiAxNS42IEM5LjIgMTcgOS43NSAxOC42IDkuNzUgMjAuNCBMOS43NSAyMy42IEM5Ljc1IDI0LjUgOSAyNS4xIDguMSAyNSBDNy4xIDI0LjggNi4xIDI0LjQgNS4zIDIzLjggQzQuNTUgMjMuMyA0LjE1IDIyLjUgNC4xNSAyMS42IEM0LjE1IDIwLjcgNC42NSAxOS44IDUuNDUgMTkuMyBDNS41IDE3LjUgNS43IDE1LjMgNS44NSAxMy41IFoiLz4KICAgIDxwYXRoIGQ9Ik0xOS4xNSAxMy41IEwxOC40IDEzLjUgQzE3LjggMTQuMiAxNy4zIDE0LjkgMTYuOCAxNS42IEMxNS44IDE3IDE1LjI1IDE4LjYgMTUuMjUgMjAuNCBMMTUuMjUgMjMuNiBDMTUuMjUgMjQuNSAxNiAyNS4xIDE2LjkgMjUgQzE3LjkgMjQuOCAxOC45IDI0LjQgMTkuNyAyMy44IEMyMC40NSAyMy4zIDIwLjg1IDIyLjUgMjAuODUgMjEuNiBDMjAuODUgMjAuNyAyMC4zNSAxOS44IDE5LjU1IDE5LjMgQzE5LjUgMTcuNSAxOS4zIDE1LjMgMTkuMTUgMTMuNSBaIi8+CiAgICA8cGF0aCBkPSJNMTEuNyAxMy44IEwxMy4zIDEzLjggQzEzLjYgMTMuOCAxMy44IDE0IDEzLjggMTQuMyBMMTMuNiAxOSBDMTMuNiAxOS42IDEzLjEgMjAgMTIuNSAyMCBDMTEuOSAyMCAxMS40IDE5LjYgMTEuNCAxOSBMMTEuMiAxNC4zIEMxMS4yIDE0IDExLjQgMTMuOCAxMS43IDEzLjggWiIvPgogIDwvZz4KPC9zdmc+Cg==',
    '/assets/icons/discord.svg': 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMCIgaGVpZ2h0PSIzMCIgdmlld0JveD0iMCAwIDMwIDMwIj4KICA8Y2lyY2xlIGN4PSIxNSIgY3k9IjE1IiByPSIxNSIgZmlsbD0iIzU4NjVGMiIvPgogIDxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDUuNCw1LjMpIHNjYWxlKDAuOCkiPgogICAgPHBhdGggZmlsbD0iI2ZmZmZmZiIgZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNMjAuMzE3IDQuMzY5OGExOS43OTEzIDE5Ljc5MTMgMCAwMC00Ljg4NTEtMS41MTUyLjA3NDEuMDc0MSAwIDAwLS4wNzg1LjAzNzFjLS4yMTEuMzc1My0uNDQ0Ny44NjQ4LS42MDgzIDEuMjQ5NS0xLjg0NDctLjI3NjItMy42OC0uMjc2Mi01LjQ4NjggMC0uMTYzNi0uMzkzMy0uNDA1OC0uODc0Mi0uNjE3Ny0xLjI0OTVhLjA3Ny4wNzcgMCAwMC0uMDc4NS0uMDM3IDE5LjczNjMgMTkuNzM2MyAwIDAwLTQuODg1MiAxLjUxNS4wNjk5LjA2OTkgMCAwMC0uMDMyMS4wMjc3Qy41MzM0IDkuMDQ1OC0uMzE5IDEzLjU3OTkuMDk5MiAxOC4wNTc4YS4wODI0LjA4MjQgMCAwMC4wMzEyLjA1NjFjMi4wNTI4IDEuNTA3NiA0LjA0MTMgMi40MjI4IDUuOTkyOSAzLjAyOTRhLjA3NzcuMDc3NyAwIDAwLjA4NDItLjAyNzZjLjQ2MTYtLjYzMDQuODczMS0xLjI5NTIgMS4yMjYtMS45OTQyYS4wNzYuMDc2IDAgMDAtLjA0MTYtLjEwNTdjLS42NTI4LS4yNDc2LTEuMjc0My0uNTQ5NS0xLjg3MjItLjg5MjNhLjA3Ny4wNzcgMCAwMS0uMDA3Ni0uMTI3N2MuMTI1OC0uMDk0My4yNTE3LS4xOTIzLjM3MTgtLjI5MTRhLjA3NDMuMDc0MyAwIDAxLjA3NzYtLjAxMDVjMy45Mjc4IDEuNzkzMyA4LjE4IDEuNzkzMyAxMi4wNjE0IDBhLjA3MzkuMDczOSAwIDAxLjA3ODUuMDA5NWMuMTIwMi4wOTkuMjQ2LjE5ODEuMzcyOC4yOTI0YS4wNzcuMDc3IDAgMDEtLjAwNjYuMTI3NiAxMi4yOTg2IDEyLjI5ODYgMCAwMS0xLjg3My44OTE0LjA3NjYuMDc2NiAwIDAwLS4wNDA3LjEwNjdjLjM2MDQuNjk4Ljc3MTkgMS4zNjI4IDEuMjI1IDEuOTkzMmEuMDc2LjA3NiAwIDAwLjA4NDIuMDI4NmMxLjk2MS0uNjA2NyAzLjk0OTUtMS41MjE5IDYuMDAyMy0zLjAyOTRhLjA3Ny4wNzcgMCAwMC4wMzEzLS4wNTUyYy41MDA0LTUuMTc3LS44MzgyLTkuNjczOS0zLjU0ODUtMTMuNjYwNGEuMDYxLjA2MSAwIDAwLS4wMzEyLS4wMjg2ek04LjAyIDE1LjMzMTJjLTEuMTgyNSAwLTIuMTU2OS0xLjA4NTctMi4xNTY5LTIuNDE5IDAtMS4zMzMyLjk1NTUtMi40MTg5IDIuMTU3LTIuNDE4OSAxLjIxMDggMCAyLjE3NTcgMS4wOTUyIDIuMTU2OCAyLjQxOSAwIDEuMzMzMi0uOTU1NSAyLjQxODktMi4xNTY5IDIuNDE4OXptNy45NzQ4IDBjLTEuMTgyNSAwLTIuMTU2OS0xLjA4NTctMi4xNTY5LTIuNDE5IDAtMS4zMzMyLjk1NTQtMi40MTg5IDIuMTU2OS0yLjQxODkgMS4yMTA4IDAgMi4xNzU3IDEuMDk1MiAyLjE1NjggMi40MTkgMCAxLjMzMzItLjk0NiAyLjQxODktMi4xNTY4IDIuNDE4OVoiLz4KICA8L2c+Cjwvc3ZnPgo='
  };

  function resolveNrIconSrc(rawSrc) {
    if (!rawSrc || typeof rawSrc !== 'string') return rawSrc;
    if (rawSrc.indexOf('data:') === 0 || rawSrc.indexOf('blob:') === 0) return rawSrc;
    var cleanPath = rawSrc;
    try {
      if (rawSrc.indexOf('http://') === 0 || rawSrc.indexOf('https://') === 0) {
        var u = new URL(rawSrc, window.location.origin);
        if (u.origin === window.location.origin) {
          cleanPath = u.pathname;
        }
      } else {
        cleanPath = rawSrc.split('?')[0].split('#')[0];
      }
    } catch (e) {}
    if (cleanPath.indexOf('/nr/assets/') === 0) cleanPath = cleanPath.slice(3);
    else if (cleanPath.indexOf('/api/nr/assets/') === 0) cleanPath = cleanPath.slice(7);
    else if (cleanPath.indexOf('assets/') === 0) cleanPath = '/' + cleanPath;
    if (NR_INLINE_SVG_ICONS[cleanPath]) {
      return NR_INLINE_SVG_ICONS[cleanPath];
    }
    if (
      (cleanPath.indexOf('/assets/') === 0 || cleanPath.indexOf('/icons/') === 0 || cleanPath.indexOf('/settings/') === 0) &&
      rawSrc.indexOf('v=nr3') === -1
    ) {
      return cleanPath + (rawSrc.indexOf('?') !== -1 ? '&v=nr3' : '?v=nr3');
    }
    return rawSrc;
  }

  try {
    var origSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
      if (this && this.tagName === 'IMG' && (name === 'src' || name === 'SRC') && typeof value === 'string') {
        value = resolveNrIconSrc(value);
      }
      return origSetAttribute.call(this, name, value);
    };
    var imgSrcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (imgSrcDesc && imgSrcDesc.set && imgSrcDesc.get) {
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true,
        enumerable: true,
        get: function() { return imgSrcDesc.get.call(this); },
        set: function(val) {
          imgSrcDesc.set.call(this, typeof val === 'string' ? resolveNrIconSrc(val) : val);
        }
      });
    }
    window.addEventListener('error', function(ev) {
      var t = ev && ev.target;
      if (t && t.tagName === 'IMG') {
        var raw = t.getAttribute('src') || '';
        var fixed = resolveNrIconSrc(raw);
        if (fixed && fixed !== raw) {
          origSetAttribute.call(t, 'src', fixed);
        } else if (raw && raw.indexOf('data:') !== 0 && !t.dataset.omniRetried) {
          t.dataset.omniRetried = '1';
          var cleanImgPath = raw.split('?')[0];
          if (cleanImgPath.indexOf('http') !== 0) {
            origSetAttribute.call(t, 'src', 'https://www.newrecruit.eu' + (cleanImgPath.charAt(0) === '/' ? '' : '/') + cleanImgPath);
          } else {
            origSetAttribute.call(t, 'src', cleanImgPath + '?v=nr3_' + Date.now());
          }
        }
      }
    }, true);
  } catch (e) {}

  var initialSearch = window.location.search || '';
  var initialPath = window.location.pathname || '';
  var isEmbeddedViewer = (
    initialSearch.indexOf('embed=hub') !== -1 ||
    initialSearch.indexOf('embed=tracker') !== -1
  );
  if (isEmbeddedViewer) {
    try { document.documentElement.classList.add('omnitactica-nr-embedded-viewer'); } catch (e) {}
  }
  var wantPlayModeFromUrl = (
    initialSearch.indexOf('view=play') !== -1 ||
    initialSearch.indexOf('play=1') !== -1 ||
    initialSearch.indexOf('mode=play') !== -1
  );
  var isEphemeralViewer = (initialSearch.indexOf('ephemeral=1') !== -1);
  var preferredStudioSystemId = null;
  var mIdSysQuery = initialSearch.match(/[?&]id_system=(\d+)/i);
  var mSysQuery = initialSearch.match(/[?&]sys=([a-z0-9_-]+)/i);
  if (mIdSysQuery && mIdSysQuery[1]) {
    preferredStudioSystemId = Number(mIdSysQuery[1]);
  } else if (mSysQuery && mSysQuery[1]) {
    var sParam = mSysQuery[1].toLowerCase();
    if (sParam === 'aos' || sParam === 'aos4') preferredStudioSystemId = 4255553472;
    else if (sParam === 'aos3') preferredStudioSystemId = 4194757354;
    else if (sParam === '40k10' || sParam === '10e') preferredStudioSystemId = 2821148162;
    else if (sParam === '40k' || sParam === '11e') preferredStudioSystemId = 827374861;
  }
  if (preferredStudioSystemId) {
    try { sessionStorage.setItem('omni_nr_studio_id_system', String(preferredStudioSystemId)); } catch (e) {}
  }

  function getDefaultSystemIdForOmniGameSystem() {
    if (preferredStudioSystemId) return preferredStudioSystemId;
    try {
      var omniGs = (localStorage.getItem('omni_game_system') || '40k').toLowerCase();
      var savedStudioSys = Number(sessionStorage.getItem('omni_nr_studio_id_system') || 0);
      if (savedStudioSys) {
        var isSavedAos = (savedStudioSys === 4255553472 || savedStudioSys === 4194757354);
        if ((omniGs === 'aos' && isSavedAos) || (omniGs !== 'aos' && !isSavedAos)) {
          return savedStudioSys;
        }
      }
      if (omniGs === 'aos') return 4255553472; // Age of Sigmar 4.0 (Latest)
    } catch (e) {}
    return 827374861; // Warhammer 40,000 11th Edition (Latest)
  }

  var requestedListKeyFromUrl = null;
  var requestedListNameFromUrl = '';
  var mNameQuery = initialSearch.match(/[?&]name=([^&#]+)/i);
  if (mNameQuery && mNameQuery[1]) {
    try { requestedListNameFromUrl = decodeURIComponent(mNameQuery[1]).trim(); } catch (e) {}
  }
  var mListUrl = initialPath.match(/\/Lists\/([^\/\?\#]+)/i) || initialPath.match(/\/list\/([^\/\?\#]+)/i);
  if (mListUrl && mListUrl[1]) {
    requestedListKeyFromUrl = decodeURIComponent(mListUrl[1]);
  } else {
    var mQueryList = initialSearch.match(/[?&]list=([^&#]+)/i);
    if (mQueryList && mQueryList[1]) {
      requestedListKeyFromUrl = decodeURIComponent(mQueryList[1]);
    }
  }

  var directListLoaderTimer = null;
  var directListLookupRetries = 0;
  function showDirectListLoader(label, subLabel) {
    try {
      document.documentElement.classList.add('omnitactica-nr-direct-list-loading');
      document.documentElement.classList.add('omnitactica-nr-target-list-mode');
      var ensureDom = function() {
        if (!document.body) return;
        var el = document.getElementById('omnitactica-nr-direct-loader');
        if (!el) {
          el = document.createElement('div');
          el.id = 'omnitactica-nr-direct-loader';
          el.innerHTML = '<div class="omnitactica-nr-spinner"></div>' +
            '<div id="omnitactica-nr-direct-loader-title" style="font-size:15px;font-weight:800;color:#f8fafc;letter-spacing:0.01em;">Loading Army Roster...</div>' +
            '<div id="omnitactica-nr-direct-loader-subtitle" style="font-size:12px;color:#94a3b8;">Opening datasheet &amp; detachment view...</div>';
          document.body.appendChild(el);
        }
        if (label) {
          var tEl = document.getElementById('omnitactica-nr-direct-loader-title');
          if (tEl) tEl.textContent = label;
        }
        if (subLabel) {
          var sEl = document.getElementById('omnitactica-nr-direct-loader-subtitle');
          if (sEl) sEl.textContent = subLabel;
        }
      };
      if (document.body) ensureDom();
      else document.addEventListener('DOMContentLoaded', ensureDom, { once: true });
      if (directListLoaderTimer) clearTimeout(directListLoaderTimer);
      directListLoaderTimer = setTimeout(hideDirectListLoader, 30000);
    } catch (e) {}
  }

  function updateDirectListLoaderSubtitle(subLabel) {
    try {
      if (!subLabel) return;
      var sEl = document.getElementById('omnitactica-nr-direct-loader-subtitle');
      if (sEl) sEl.textContent = subLabel;
      notifyParent({ action: 'loading_progress', step: subLabel });
    } catch (e) {}
  }

  function hideDirectListLoader(clearTargetMode) {
    try {
      if (directListLoaderTimer) {
        clearTimeout(directListLoaderTimer);
        directListLoaderTimer = null;
      }
      document.documentElement.classList.remove('omnitactica-nr-direct-list-loading');
      if (clearTargetMode || !requestedListKeyFromUrl) {
        document.documentElement.classList.remove('omnitactica-nr-target-list-mode');
      }
    } catch (e) {}
  }

  if (requestedListKeyFromUrl) {
    showDirectListLoader(
      wantPlayModeFromUrl ? 'Loading Play Mode Datasheets...' : 'Opening Army Roster...',
      'Initializing game system & catalogue...'
    );
    try {
      ['/_nuxt/DzWbm3in.js', '/_nuxt/DGlI0FuJ.js', '/_nuxt/dclw41pw.js', '/_nuxt/D7n9-sfm.js'].forEach(function(modPath) {
        import(modPath).catch(function() {});
      });
    } catch (e) {}
  }

  // 1. Rewrite /nr/app/... path to clean /app/MyLists BEFORE Nuxt vue-router initializes
  // so Lists.vue never misinterprets cache-busting query params (e.g. _cb) as a broken list query.
  try {
    var curPath = window.location.pathname || '';
    if (requestedListKeyFromUrl || /^\/(?:nr\/)?app(?:\/Lists|\/MyLists|\/)?$/i.test(curPath)) {
      window.history.replaceState(null, '', '/app/MyLists');
    } else if (curPath.indexOf('/nr/app') === 0) {
      var mappedPath = curPath.replace(/^\/nr\/app/, '/app');
      window.history.replaceState(null, '', mappedPath);
    }
  } catch (err) {
    console.warn('[OmniTactica Bridge] Path rewrite notice:', err);
  }

  var isHydrating = false;
  var initialHydrationDone = false;
  var readyNotified = false;
  var playModeActivatedForKey = null;
  var compilingKeys = {};
  var knownListsMap = {}; // list_key -> signature string
  var syncInFlight = {};
  var lastLocalWriteAt = {}; // list_key -> timestamp ms of last local Pinia/IDB edit
  var navGeneration = 0;
  var isCompilingSave = false;
  var pendingNrRowFromParent = null;
  var cachedNrDb = null;

  try {
    if (requestedListKeyFromUrl && window.sessionStorage) {
      var savedPendingRow = window.sessionStorage.getItem('omni_pending_nr_row_' + requestedListKeyFromUrl);
      if (savedPendingRow) {
        pendingNrRowFromParent = JSON.parse(savedPendingRow);
        if (pendingNrRowFromParent && pendingNrRowFromParent._ephemeral_view) {
          isEphemeralViewer = true;
        } else if (isEphemeralViewer && pendingNrRowFromParent) {
          pendingNrRowFromParent._ephemeral_view = true;
        }
      }
    }
  } catch (e) {}

  try {
    var targetBootSysId = Number(preferredStudioSystemId) || Number(pendingNrRowFromParent && pendingNrRowFromParent.id_system) || getDefaultSystemIdForOmniGameSystem();
    if (targetBootSysId) {
      var rawOpts = localStorage.getItem('options');
      var optsObj = rawOpts ? JSON.parse(rawOpts) : null;
      if (!optsObj || typeof optsObj !== 'object') {
        optsObj = {
          lastSystem: targetBootSysId,
          installed_systems: [6, 4255553472, 827374861, 2607667884, 3859771559],
          nlanguage: 'en'
        };
        if (optsObj.installed_systems.indexOf(targetBootSysId) === -1) {
          optsObj.installed_systems.push(targetBootSysId);
        }
        localStorage.setItem('options', JSON.stringify(optsObj));
      } else if (isEmbeddedViewer && (isEphemeralViewer || wantPlayModeFromUrl || requestedListKeyFromUrl)) {
        optsObj.lastSystem = targetBootSysId;
        if (!Array.isArray(optsObj.installed_systems)) {
          optsObj.installed_systems = [6, 4255553472, 827374861, 2607667884, 3859771559];
        }
        if (optsObj.installed_systems.indexOf(targetBootSysId) === -1) {
          optsObj.installed_systems.push(targetBootSysId);
        }
        localStorage.setItem('options', JSON.stringify(optsObj));
      }
    }
  } catch (e) {}

  function getAuthHeaders(extraHeaders) {
    var hdrs = Object.assign({}, extraHeaders || {});
    try {
      var tok = localStorage.getItem('native_session_token') || localStorage.getItem('elo_auth_token') || '';
      if (!tok && document.cookie) {
        var m = document.cookie.match(/(?:^|;\s*)(?:session_token|elo_auth_token|native_session_token)=([^;]+)/);
        if (m && m[1]) tok = decodeURIComponent(m[1]);
      }
      if (tok) {
        hdrs['Authorization'] = 'Bearer ' + tok;
      }
    } catch (e) {}
    return hdrs;
  }

  function notifyParent(payload) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          Object.assign({ type: 'OMNITACTICA_NR_SYNC_EVENT', timestamp: Date.now() }, payload),
          '*'
        );
      }
    } catch (e) {}
  }

  function getRowArrayTotalCostsPts(row) {
    if (!row || !Array.isArray(row.totalCosts)) return 0;
    for (var i = 0; i < row.totalCosts.length; i++) {
      var c = row.totalCosts[i];
      if (c && (c.typeId === 'pts' || c.name === 'pts' || i === 0) && Number(c.value) > 0) {
        return Number(c.value);
      }
    }
    return 0;
  }

  function setRowPointsEverywhere(row, pts) {
    if (!row || !(pts > 0)) return;
    row.totalCost = pts;
    if (Array.isArray(row.totalCosts)) {
      var foundPts = false;
      for (var i = 0; i < row.totalCosts.length; i++) {
        if (row.totalCosts[i] && (row.totalCosts[i].typeId === 'pts' || row.totalCosts[i].name === 'pts')) {
          row.totalCosts[i].value = pts;
          foundPts = true;
        }
      }
      if (!foundPts && row.totalCosts.length > 0 && row.totalCosts[0]) {
        row.totalCosts[0].value = pts;
      }
    } else if (row.totalCosts && typeof row.totalCosts === 'object') {
      row.totalCosts.pts = pts;
    }
  }

  function computeSignature(row) {
    if (!row || !row.list_key) return '';
    var armyStr = '';
    var enrichedStr = '';
    try {
      armyStr = row.army ? JSON.stringify(row.army) : '';
      enrichedStr = row._omnitactica_enriched_units ? JSON.stringify(row._omnitactica_enriched_units) : '';
    } catch (e) {
      armyStr = String(row.date_mod || '');
    }
    var arrPts = getRowArrayTotalCostsPts(row);
    var effectivePts = (arrPts > 0 && !isSyntheticTextRow(row, arrPts)) ? arrPts : (row.totalCost || 0);
    return [
      row.list_key,
      row.name || '',
      effectivePts,
      row._omnitactica_book_name || '',
      row._omnitactica_detachment || '',
      row.version || 0,
      armyStr,
      enrichedStr,
      (row._omnitactica_gw_text || '').length,
      (row._omnitactica_nr_text || '').length
    ].join('|');
  }

  function getNrStores() {
    var s = globalThis.__nr_stores;
    if (!s || !s.system || !s.user) return null;
    try {
      s.user.isSupporter = function() { return true; };
    } catch (e) {}
    var pMap = (s.system._p && s.system._p._s) ? s.system._p._s : null;
    var listsStore = s.lists || s.list || (pMap ? pMap.get('lists') : null);
    var optionsStore = s.options || s.option || (pMap ? pMap.get('optionsStore') : null);
    var listsPageStore = s.listsPage || (pMap ? pMap.get('listsPage') : null);
    var mainStore = s.main || (pMap ? pMap.get('mainStore') : null);
    var figStore = pMap ? pMap.get('figurineStore') : null;
    if (figStore && isEmbeddedViewer && (isEphemeralViewer || wantPlayModeFromUrl)) {
      figStore.updateMatchedFigurines = function() {};
    }
    if (!listsStore) return null;
    s.list = listsStore;
    s.lists = listsStore;
    if (optionsStore) {
      s.option = optionsStore;
      s.options = optionsStore;
    }
    if (listsPageStore) {
      s.listsPage = listsPageStore;
    }
    if (mainStore) {
      s.main = mainStore;
    }
    if (!Object.getOwnPropertyDescriptor(listsStore, 'selectedList')) {
      try {
        Object.defineProperty(listsStore, 'selectedList', {
          get: function() { return this.currentList; },
          configurable: true
        });
      } catch (e) {}
    }
    return {
      user: s.user,
      system: s.system,
      list: listsStore,
      lists: listsStore,
      options: optionsStore,
      listsPage: listsPageStore,
      main: mainStore
    };
  }

  // Extract live unit summary, detachment/battle formation, and book metadata from a live Army instance or $debugOption
  function extractLiveArmyMetadata(targetListKey, explicitArmy, explicitBook) {
    var out = { units: null, detachment: '', bookName: '', systemName: '' };
    try {
      var stores = getNrStores();
      var inst = explicitArmy || null;
      var bookInst = explicitBook || null;
      if (!inst && stores && stores.list && stores.list.currentList) {
        var cl = stores.list.currentList;
        if (!targetListKey || (cl.row && cl.row.list_key === targetListKey)) {
          inst = cl.army || null;
          bookInst = bookInst || cl.book || null;
        }
      }
      if (!inst && window.$debugOption && typeof window.$debugOption.getForces === 'function') {
        var curUrl = window.location.pathname || '';
        if (!targetListKey || curUrl.indexOf('/Lists/') === -1 || curUrl.indexOf(targetListKey) !== -1) {
          inst = window.$debugOption;
        }
      }
      if (bookInst) {
        if (typeof bookInst.getName === 'function') out.bookName = bookInst.getName() || '';
        else if (bookInst.name) out.bookName = bookInst.name;
        var sysObj = typeof bookInst.getSystem === 'function' ? bookInst.getSystem() : bookInst.system;
        if (sysObj && (sysObj.name || sysObj.short)) out.systemName = sysObj.name || sysObj.short || '';
      }
      if (!inst || typeof inst.getForces !== 'function') return out;
      var enriched = [];
      var forces = inst.getForces() || [];
      for (var fIdx = 0; fIdx < forces.length; fIdx++) {
        var force = forces[fIdx];
        if (!force || typeof force.getCategories !== 'function') continue;
        if (!out.bookName && typeof force.getBook === 'function' && force.getBook()) {
          var fb = force.getBook();
          out.bookName = (typeof fb.getName === 'function' ? fb.getName() : fb.name) || '';
        }
        var cats = force.getCategories() || [];
        for (var cIdx = 0; cIdx < cats.length; cIdx++) {
          var cat = cats[cIdx];
          if (!cat || typeof cat.getUnits !== 'function') continue;
          var catName = cat.getName ? cat.getName() : (cat.name || 'Infantry');
          var catNameLow = String(catName || '').trim().toLowerCase();
          if (cat.isConfiguration || catNameLow === 'configuration' || catNameLow === 'army composition') {
            var cfgUnits = cat.getUnits() || [];
            for (var cuIdx = 0; cuIdx < cfgUnits.length; cuIdx++) {
              var cu = cfgUnits[cuIdx];
              if (!cu) continue;
              var cuName = (typeof cu.getName === 'function' ? cu.getName() : (cu.name || '')).toLowerCase();
              if (
                (cuName.indexOf('detachment') !== -1 ||
                 cuName.indexOf('battle formation') !== -1 ||
                 cuName.indexOf('subfaction') !== -1 ||
                 cuName.indexOf('allegiance') !== -1) &&
                typeof cu.getChildInstances === 'function'
              ) {
                var ch = cu.getChildInstances() || [];
                for (var chIdx = 0; chIdx < ch.length; chIdx++) {
                  var cInst = ch[chIdx];
                  if (cInst && (!cInst.getAmount || cInst.getAmount() > 0)) {
                    var detVal = typeof cInst.getName === 'function' ? cInst.getName() : (cInst.name || '');
                    var detLow = String(detVal || '').trim().toLowerCase();
                    if (detVal && detLow.indexOf('detachment') === -1 && detLow.indexOf('battle formation') === -1) {
                      out.detachment = String(detVal).replace(/^[0-9.]+[.:)-]\s*/, '').trim();
                    }
                  }
                }
                if (!out.detachment && typeof cu.calcOptionsList === 'function') {
                  var optListStr = String(cu.calcOptionsList(true) || '').trim();
                  if (optListStr) {
                    out.detachment = optListStr.replace(/^Battle Formations?:\s*/i, '').trim();
                  }
                }
              }
            }
            continue;
          }
          var units = cat.getUnits() || [];
          for (var uIdx = 0; uIdx < units.length; uIdx++) {
            var u = units[uIdx];
            if (!u) continue;
            var uName = (typeof u.getCustomName === 'function' && u.getCustomName()) ||
                        (typeof u.getName === 'function' ? u.getName() : (u.name || 'Unit'));
            var uNameLow = String(uName || '').trim().toLowerCase();
            if (
              uNameLow === 'battle formation' ||
              uNameLow === 'spell lore' ||
              uNameLow === 'prayer lore' ||
              uNameLow === 'manifestation lore'
            ) {
              continue;
            }
            var pts = typeof u.getPointsCost === 'function' ? u.getPointsCost() : 0;
            var models = typeof u.calcTotalUnitSize === 'function' ? u.calcTotalUnitSize() : 1;
            var isWarlord = false;
            try {
              isWarlord = Boolean(u.isWarlord && (typeof u.isWarlord === 'function' ? u.isWarlord() : u.isWarlord));
              if (!isWarlord && typeof u.getChildInstances === 'function') {
                var uCh = u.getChildInstances() || [];
                for (var ucIdx = 0; ucIdx < uCh.length; ucIdx++) {
                  var uc = uCh[ucIdx];
                  if (!uc || (uc.getAmount && uc.getAmount() <= 0)) continue;
                  var ucName = String(typeof uc.getName === 'function' ? uc.getName() : (uc.name || '')).trim().toLowerCase();
                  if (ucName === 'general' || ucName === 'warlord') {
                    isWarlord = true;
                    break;
                  }
                }
              }
            } catch (e) {}
            enriched.push({
              name: uName,
              role: catName,
              points: Number(pts) || 0,
              model_count: Math.max(1, Number(models) || 1),
              is_warlord: isWarlord
            });
          }
        }
      }
      if (enriched.length > 0) out.units = enriched;
    } catch (e) {}
    return out;
  }

  function isSyntheticTextRow(row, livePts) {
    if (!row || typeof row !== 'object') return false;
    var aid = String((row.army && row.army.id) || '');
    if (aid.indexOf('army-') === 0 || aid.indexOf('root-') === 0 || aid.indexOf('cat-') === 0) {
      return true;
    }
    if (row._compiled_by_nr) {
      var ptsSum = Number(livePts || row._compiled_pts_sum || getRowArrayTotalCostsPts(row) || 0);
      var headerCost = Number(row.totalCost || 0);
      if (ptsSum >= 1400 && headerCost > 0 && Math.abs(headerCost - ptsSum) <= 350) {
        return false;
      }
      return true;
    }
    return false;
  }

  function cloneCleanRow(row, explicitArmy, explicitBook) {
    if (!row || typeof row !== 'object') return null;
    try {
      var copy = JSON.parse(JSON.stringify(row));
      if (!copy.list_key && copy._id) {
        copy.list_key = String(copy._id);
      }
      var stores = getNrStores();
      var arrPts = getRowArrayTotalCostsPts(copy);
      var isSynth = isSyntheticTextRow(copy, arrPts);
      if (!isSynth && arrPts > 0 && arrPts !== copy.totalCost) {
        copy.totalCost = arrPts;
        row.totalCost = arrPts;
      }
      if (explicitArmy && typeof explicitArmy.toJson === 'function') {
        try {
          copy.army = explicitArmy.toJson();
          if (typeof explicitArmy.getPointsCost === 'function') {
            var expPts = explicitArmy.getPointsCost();
            if (expPts > 0 && (!isSyntheticTextRow(copy, expPts) || !copy.totalCost)) {
              setRowPointsEverywhere(copy, expPts);
              setRowPointsEverywhere(row, expPts);
            }
          }
        } catch (e) {}
      } else if (stores && stores.list && stores.list.currentList && stores.list.currentList.row && stores.list.currentList.row.list_key === copy.list_key && /\/Lists(\/|$)/i.test(window.location.pathname || '')) {
        var curArmy = stores.list.currentList.army;
        if (curArmy && typeof curArmy.toJson === 'function') {
          try {
            copy.army = curArmy.toJson();
            if (typeof curArmy.getPointsCost === 'function') {
              var curPts = curArmy.getPointsCost();
              if (curPts > 0 && (!isSyntheticTextRow(copy, curPts) || !copy.totalCost)) {
                setRowPointsEverywhere(copy, curPts);
                setRowPointsEverywhere(row, curPts);
              }
            }
          } catch (e) {}
        }
      }
      var meta = extractLiveArmyMetadata(copy.list_key, explicitArmy, explicitBook);
      if (meta.units && meta.units.length > 0) {
        copy._omnitactica_enriched_units = meta.units;
      }
      if (meta.detachment) {
        copy._omnitactica_detachment = meta.detachment;
      }
      if (meta.bookName) {
        copy._omnitactica_book_name = meta.bookName;
      }
      if (meta.systemName) {
        copy._omnitactica_system_name = meta.systemName;
      }
      // Also resolve book & system name from stores.system.library (index or array) if not set yet
      if (stores && stores.system && stores.system.library && (copy.id_system || copy.bsid_system)) {
        var lib = stores.system.library;
        var sysData = (lib.index && copy.id_system && lib.index[copy.id_system]) ? lib.index[copy.id_system] : null;
        if (!sysData && Array.isArray(lib.array)) {
          sysData = lib.array.find(function(n) {
            return n && (n.id == copy.id_system || (n.bsid != null && (n.bsid == copy.id_system || n.bsid == copy.bsid_system)));
          }) || null;
        }
        if (sysData) {
          if (!copy._omnitactica_system_name && (sysData.name || sysData.short)) {
            copy._omnitactica_system_name = sysData.name || sysData.short;
          }
          if (!copy._omnitactica_book_name && (copy.id_book || copy.bsid_book) && sysData.books) {
            if (sysData.books.index && copy.id_book && sysData.books.index[copy.id_book]) {
              copy._omnitactica_book_name = sysData.books.index[copy.id_book].name || '';
            } else if (Array.isArray(sysData.books.array)) {
              var bkMatch = sysData.books.array.find(function(d) {
                return d && (d.id == copy.id_book || (d.bsid != null && (d.bsid == copy.id_book || d.bsid == copy.bsid_book)));
              });
              if (bkMatch && bkMatch.name) {
                copy._omnitactica_book_name = bkMatch.name;
              }
            }
          }
        }
      }
      return copy;
    } catch (e) {
      return null;
    }
  }

  async function postSyncAction(action, payload) {
    try {
      var res = await fetch('/api/armylists/nr_sync', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'same-origin',
        body: JSON.stringify(Object.assign({ action: action }, payload))
      });
      if (!res.ok) return null;
      var data = await res.json();
      notifyParent({
        action: action,
        list_key: payload.list_key || (payload.list && payload.list.list_key) || null,
        army_list: data.army_list || null,
        army_lists: data.army_lists || null,
        deleted_id: data.deleted_id || null
      });
      return data;
    } catch (e) {
      console.warn('[OmniTactica Bridge] Sync error:', e);
      return null;
    }
  }

  var TOMBSTONE_STORAGE_KEY = 'omni_deleted_nr_lists_v3';
  var TOMBSTONE_TTL_MS = 300000; // 5 minutes
  try {
    localStorage.removeItem('omni_deleted_nr_lists');
    localStorage.removeItem('omni_deleted_nr_lists_v2');
  } catch (e) {}

  function getNrDeletedTombstones() {
    try {
      var raw = localStorage.getItem(TOMBSTONE_STORAGE_KEY);
      if (!raw) return { keys: {}, names: {} };
      var parsed = JSON.parse(raw);
      var keysObj = (parsed && typeof parsed.keys === 'object' && parsed.keys) ? parsed.keys : {};
      var now = Date.now();
      var pruned = false;
      Object.keys(keysObj).forEach(function(k) {
        var ts = Number(keysObj[k]) || 0;
        if (!ts || (now - ts) > TOMBSTONE_TTL_MS) {
          delete keysObj[k];
          pruned = true;
        }
      });
      if (pruned) {
        try { localStorage.setItem(TOMBSTONE_STORAGE_KEY, JSON.stringify({ keys: keysObj, names: {} })); } catch (e2) {}
      }
      return {
        keys: keysObj,
        names: {}
      };
    } catch (e) {
      return { keys: {}, names: {} };
    }
  }

  function addNrDeletedTombstone(listKey, listName, extraKeys) {
    try {
      var tomb = getNrDeletedTombstones();
      var now = Date.now();
      var allKeys = [];
      if (listKey) {
        var cleanK = String(listKey).replace(/^(nr_|list_)/, '').trim();
        if (cleanK) {
          tomb.keys[cleanK] = now;
          allKeys.push(cleanK);
        }
      }
      if (Array.isArray(extraKeys)) {
        for (var i = 0; i < extraKeys.length; i++) {
          var ek = String(extraKeys[i] || '').replace(/^(nr_|list_)/, '').trim();
          if (ek) {
            tomb.keys[ek] = now;
            if (allKeys.indexOf(ek) === -1) allKeys.push(ek);
          }
        }
      }
      localStorage.setItem(TOMBSTONE_STORAGE_KEY, JSON.stringify(tomb));
      if (allKeys.length > 0) {
        try {
          var remRaw = localStorage.getItem('remote-lists-state');
          if (remRaw) {
            var remObj = JSON.parse(remRaw);
            if (remObj && typeof remObj === 'object') {
              var changed = false;
              for (var kIdx = 0; kIdx < allKeys.length; kIdx++) {
                if (allKeys[kIdx] in remObj) {
                  delete remObj[allKeys[kIdx]];
                  changed = true;
                }
              }
              if (changed) localStorage.setItem('remote-lists-state', JSON.stringify(remObj));
            }
          }
        } catch (e2) {}
      }
    } catch (e) {}
  }

  function clearNrDeletedTombstone(listKey, listName) {
    try {
      var tomb = getNrDeletedTombstones();
      var changed = false;
      if (listKey) {
        var cleanK = String(listKey).replace(/^(nr_|list_)/, '').trim();
        if (cleanK && tomb.keys[cleanK]) {
          delete tomb.keys[cleanK];
          changed = true;
        }
      }
      if (changed) {
        localStorage.setItem(TOMBSTONE_STORAGE_KEY, JSON.stringify(tomb));
      }
    } catch (e) {}
  }

  function isTombstonedNrRow(r) {
    if (!r) return false;
    var tomb = getNrDeletedTombstones();
    var rk = String(r.list_key || r._id || '').replace(/^(nr_|list_)/, '').trim();
    var ts = (rk && tomb.keys[rk]) ? Number(tomb.keys[rk]) : 0;
    if (!ts) {
      var migTo = (r.metadata && r.metadata.migrated_to) ? String(r.metadata.migrated_to).trim() : '';
      if (migTo && tomb.keys[migTo]) ts = Number(tomb.keys[migTo]) || 0;
    }
    if (!ts) return false;
    if (r.date_mod) {
      var modMs = new Date(r.date_mod).getTime();
      if (!isNaN(modMs) && modMs > ts + 2000) {
        return false;
      }
    }
    return true;
  }

  async function deleteKeyFromNrServerRpc(listKey) {
    if (!listKey) return;
    var cleanK = String(listKey).replace(/^(nr_|list_)/, '').trim();
    if (!cleanK) return;
    var nrAccess = '';
    try { nrAccess = localStorage.getItem('access') || ''; } catch (e) {}
    if (!nrAccess) return;
    try {
      await fetch('/api/rpc?m=deleteList', {
        method: 'POST',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          'Authorization': nrAccess
        },
        body: JSON.stringify({ method: 'deleteList', params: [cleanK] })
      });
    } catch (e) {}
  }

  var purgingTombstones = false;
  async function purgeTombstonedRowsFromPiniaAndCloud(stores) {
    if (purgingTombstones || !stores || !stores.list || !Array.isArray(stores.list.listData)) return;
    var victimRows = stores.list.listData.filter(function(r) { return r && isTombstonedNrRow(r); });
    var leakedEphemeralRows = stores.list.listData.filter(function(r) {
      if (!r || !r._ephemeral_view) return false;
      if (isEphemeralViewer && requestedListKeyFromUrl && r.list_key === requestedListKeyFromUrl) return false;
      return true;
    });
    if (victimRows.length === 0 && leakedEphemeralRows.length === 0) return;
    purgingTombstones = true;
    var prevHyd = isHydrating;
    isHydrating = true;
    var keysToPurgeIdb = [];
    try {
      for (var eIdx = 0; eIdx < leakedEphemeralRows.length; eIdx++) {
        var er = leakedEphemeralRows[eIdx];
        var ek = String(er.list_key || er._id || '');
        if (ek && keysToPurgeIdb.indexOf(ek) === -1) keysToPurgeIdb.push(ek);
        delete knownListsMap[ek];
        var epIdx = stores.list.listData.findIndex(function(x) { return x && x.list_key === ek; });
        while (epIdx !== -1) {
          stores.list.listData.splice(epIdx, 1);
          epIdx = stores.list.listData.findIndex(function(x) { return x && x.list_key === ek; });
        }
      }
      for (var i = 0; i < victimRows.length; i++) {
        var vr = victimRows[i];
        var vk = String(vr.list_key || vr._id || '');
        var vn = vr.name ? String(vr.name) : '';
        var vExtra = (vr.metadata && vr.metadata.migrated_to) ? [String(vr.metadata.migrated_to)] : [];
        addNrDeletedTombstone(vk, vn, vExtra);
        if (vk && keysToPurgeIdb.indexOf(vk) === -1) keysToPurgeIdb.push(vk);
        for (var exIdx = 0; exIdx < vExtra.length; exIdx++) {
          if (vExtra[exIdx] && keysToPurgeIdb.indexOf(vExtra[exIdx]) === -1) keysToPurgeIdb.push(vExtra[exIdx]);
        }
        delete knownListsMap[vk];
        // IMPORTANT: Never call stores.list.removeList(vr) here because NewRecruit's native removeList
        // runs `this.listData.splice(findIndex, 1)` without checking `findIndex !== -1`, which deletes
        // the last element of listData if `vr` was already removed!
        var idx = stores.list.listData.findIndex(function(x) { return x && x.list_key === vk; });
        while (idx !== -1) {
          stores.list.listData.splice(idx, 1);
          idx = stores.list.listData.findIndex(function(x) { return x && x.list_key === vk; });
        }
        try {
          if (stores.user && stores.user.user && typeof stores.list.deleteListFromServer === 'function') {
            await stores.list.deleteListFromServer(vr);
          } else {
            await deleteKeyFromNrServerRpc(vk);
          }
        } catch (e) {
          await deleteKeyFromNrServerRpc(vk);
        }
      }
      var db = await openExistingNrDb();
      if (db) {
        await new Promise(function(resolve) {
          var done = false;
          var finish = function() { if (!done) { done = true; resolve(); } };
          setTimeout(finish, 600);
          try {
            var tx = db.transaction('lists', 'readwrite');
            var stObj = tx.objectStore('lists');
            for (var kIdx = 0; kIdx < keysToPurgeIdb.length; kIdx++) {
              try { stObj.delete(keysToPurgeIdb[kIdx]); } catch (e) {}
            }
            var curReq = stObj.openCursor();
            curReq.onsuccess = function(evCur) {
              var cursor = evCur.target.result;
              if (cursor) {
                var rVal = cursor.value;
                if (rVal && rVal._ephemeral_view) {
                  try { cursor.delete(); } catch (e) {}
                }
                cursor.continue();
              }
            };
            tx.oncomplete = finish;
            tx.onerror = finish;
          } catch (e) { finish(); }
        });
      }
      try {
        if (typeof stores.list.rebuildTreeData === 'function') {
          stores.list.rebuildTreeData();
        }
      } catch (e) {}
    } finally {
      isHydrating = prevHyd;
      purgingTombstones = false;
    }
  }

  var nativeExportsCache = {};

  function propagateLivePointsToPiniaAndIdb(listKey, livePts, armyJson) {
    if (!listKey || !(livePts > 0)) return;
    try {
      var st = getNrStores();
      var changedPinia = false;
      if (st && st.list) {
        if (Array.isArray(st.list.listData)) {
          for (var i = 0; i < st.list.listData.length; i++) {
            var pr = st.list.listData[i];
            if (pr && pr.list_key === listKey && !isSyntheticTextRow(pr, livePts)) {
              if (pr.totalCost !== livePts || getRowArrayTotalCostsPts(pr) !== livePts) {
                setRowPointsEverywhere(pr, livePts);
                changedPinia = true;
              }
              if (armyJson && !pr.army) {
                pr.army = armyJson;
              }
            }
          }
        }
        if (st.list.currentList && st.list.currentList.row && st.list.currentList.row.list_key === listKey && !isSyntheticTextRow(st.list.currentList.row, livePts)) {
          if (st.list.currentList.row.totalCost !== livePts || getRowArrayTotalCostsPts(st.list.currentList.row) !== livePts) {
            setRowPointsEverywhere(st.list.currentList.row, livePts);
            changedPinia = true;
          }
        }
        if (changedPinia && typeof st.list.rebuildTreeData === 'function') {
          st.list.rebuildTreeData();
        }
      }
      openExistingNrDb().then(function(db) {
        if (!db) return;
        try {
          var tx = db.transaction('lists', 'readwrite');
          var objStore = tx.objectStore('lists');
          var req = objStore.get(listKey);
          req.onsuccess = function() {
            var existing = req.result;
            if (existing && !isSyntheticTextRow(existing, livePts) && (existing.totalCost !== livePts || getRowArrayTotalCostsPts(existing) !== livePts || (armyJson && !existing.army))) {
              setRowPointsEverywhere(existing, livePts);
              if (armyJson && !existing.army) existing.army = armyJson;
              existing._omni_internal_put = true;
              try { objStore.put(existing); } catch (e2) {}
            }
          };
        } catch (e) {}
      });
    } catch (e) {}
  }

  async function fetchFullNrRowFallback(listKeyOrRow) {
    var listKey = (listKeyOrRow && typeof listKeyOrRow === 'object')
      ? String(listKeyOrRow.list_key || listKeyOrRow._id || '')
      : String(listKeyOrRow || '');
    if (!listKey) return null;
    try {
      var db = await openExistingNrDb();
      if (db) {
        var idbMatch = await new Promise(function(resolve) {
          try {
            var tx = db.transaction('lists', 'readonly');
            var req = tx.objectStore('lists').get(listKey);
            req.onsuccess = function() { resolve(req.result || null); };
            req.onerror = function() { resolve(null); };
          } catch (e) { resolve(null); }
        });
        if (idbMatch && idbMatch.army) return idbMatch;
      }
    } catch (e) {}
    try {
      var nrAccess = localStorage.getItem('access') || '';
      if (nrAccess) {
        var rpcRes = await fetch('/api/rpc?m=user_get_list', {
          method: 'POST',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'Authorization': nrAccess
          },
          body: JSON.stringify({ list_key: listKey })
        });
        if (rpcRes.ok) {
          var rpcData = await rpcRes.json();
          if (rpcData && rpcData.army) return rpcData;
        }
      }
    } catch (e) {}
    return null;
  }

  async function attachNativeArmyExports(cleanRow, explicitArmy) {
    if (!cleanRow || !cleanRow.list_key) return;
    var arrPtsPre = getRowArrayTotalCostsPts(cleanRow);
    if (arrPtsPre > 0 && !isSyntheticTextRow(cleanRow, arrPtsPre)) {
      cleanRow.totalCost = arrPtsPre;
    }
    var cacheKey = String(cleanRow.list_key) + ':' + String(cleanRow.date_mod || '');
    var cachedExp = nativeExportsCache[cacheKey];
    if (cachedExp && cachedExp.gw && cachedExp.nr && !explicitArmy) {
      cleanRow._omnitactica_gw_text = cachedExp.gw;
      cleanRow._omnitactica_nr_text = cachedExp.nr;
      if (cachedExp.livePts > 0 && !isSyntheticTextRow(cleanRow, cachedExp.livePts)) {
        setRowPointsEverywhere(cleanRow, cachedExp.livePts);
        propagateLivePointsToPiniaAndIdb(cleanRow.list_key, cachedExp.livePts, cachedExp.armyJson);
      }
      if (cachedExp.armyJson && !cleanRow.army) {
        cleanRow.army = cachedExp.armyJson;
      }
      if (cachedExp.units && cachedExp.units.length > 0 && (!cleanRow._omnitactica_enriched_units || cleanRow._omnitactica_enriched_units.length === 0)) {
        cleanRow._omnitactica_enriched_units = cachedExp.units;
      }
      if (cachedExp.detachment && !cleanRow._omnitactica_detachment) {
        cleanRow._omnitactica_detachment = cachedExp.detachment;
      }
      if (cachedExp.bookName && !cleanRow._omnitactica_book_name) {
        cleanRow._omnitactica_book_name = cachedExp.bookName;
      }
      return;
    }
    try {
      var stores = getNrStores();
      var armyInst = explicitArmy || null;
      var bookInst = null;
      if (!armyInst && stores && stores.list && stores.list.currentList && stores.list.currentList.row && stores.list.currentList.row.list_key === cleanRow.list_key) {
        armyInst = stores.list.currentList.army || null;
        bookInst = stores.list.currentList.book || null;
      }
      if (!armyInst && stores && stores.system && (cleanRow.id_system || cleanRow.bsid_system)) {
        var sysId = cleanRow.id_system || cleanRow.bsid_system;
        var sys = (stores.system.library && stores.system.library.index && stores.system.library.index[sysId]) ||
                  (stores.system.selectedSystem && (stores.system.selectedSystem.id == sysId || stores.system.selectedSystem.bsid == sysId) ? stores.system.selectedSystem : null);
        if (!sys && Array.isArray(stores.system.library && stores.system.library.array)) {
          sys = stores.system.library.array.find(function(s) {
            return s && (s.id == sysId || s.bsid == sysId || s.bsid == cleanRow.bsid_system);
          }) || null;
        }
        if ((!sys || typeof sys.loadList !== 'function') && typeof stores.system.getSystem === 'function') {
          try { sys = await stores.system.getSystem(sysId); } catch (e) {}
        }
        if ((!sys || typeof sys.loadList !== 'function') && typeof stores.system.selectSystem === 'function') {
          try {
            await stores.system.selectSystem(sysId);
            sys = stores.system.selectedSystem;
          } catch (e) {}
        }
        if (sys && typeof sys.loadList === 'function') {
          if (stores.list && typeof stores.list.loadTranslations === 'function') {
            try { await stores.list.loadTranslations(sys); } catch (e) {}
          }
          var rowForLoad = Object.assign({}, cleanRow);
          if (!rowForLoad.army) {
            var fullFb = await fetchFullNrRowFallback(cleanRow.list_key);
            if (fullFb && fullFb.army) {
              rowForLoad.army = fullFb.army;
              cleanRow.army = fullFb.army;
            }
          }
          var loaded = await sys.loadList(rowForLoad, fetchFullNrRowFallback);
          if ((!loaded || !loaded.army) && rowForLoad.booksDate) {
            delete rowForLoad.booksDate;
            loaded = await sys.loadList(rowForLoad, fetchFullNrRowFallback);
          }
          if (loaded && loaded.army) {
            armyInst = loaded.army;
            bookInst = loaded.book || null;
            if (!cleanRow.army && typeof armyInst.toJson === 'function') {
              try { cleanRow.army = armyInst.toJson(); } catch (e) {}
            }
          }
        }
      }
      if (!armyInst || typeof armyInst.exportArmy !== 'function') return;

      var resolvedLivePts = 0;
      try {
        var meta = extractLiveArmyMetadata(cleanRow.list_key, armyInst, bookInst);
        if (meta.units && meta.units.length > 0) {
          cleanRow._omnitactica_enriched_units = meta.units;
        }
        if (meta.detachment) {
          cleanRow._omnitactica_detachment = meta.detachment;
        }
        if (meta.bookName) {
          cleanRow._omnitactica_book_name = meta.bookName;
        }
        if (typeof armyInst.getPointsCost === 'function') {
          var livePts = armyInst.getPointsCost();
          if (livePts > 0) {
            resolvedLivePts = livePts;
            if (!cleanRow.totalCost || !isSyntheticTextRow(cleanRow, livePts)) {
              setRowPointsEverywhere(cleanRow, livePts);
              propagateLivePointsToPiniaAndIdb(cleanRow.list_key, livePts, cleanRow.army);
            }
          }
        }
      } catch (e) {}

      try {
        var gwOut = await armyInst.exportArmy({
          format: 'GW',
          asText: true,
          includeHeader: true,
          includeConstants: true,
          rosterName: cleanRow.name || ''
        });
        if (typeof gwOut === 'string' && gwOut.trim().length > 20) {
          var gwTrim = gwOut.trim();
          if (!/(Created|Exported) with [^\n]*$/i.test(gwTrim)) {
            gwTrim += '\n\nCreated with newrecruit.eu v36.27';
          }
          cleanRow._omnitactica_gw_text = gwTrim;
        }
      } catch (e) {}
      try {
        var nrOut = await armyInst.exportArmy({
          format: 'WTC-Compact',
          asText: true,
          includeHeader: true,
          includeConstants: true,
          rosterName: cleanRow.name || ''
        });
        if (typeof nrOut === 'string' && nrOut.trim().length > 20) {
          var nrTrim = nrOut.trim();
          if (!/(Created|Exported) with [^\n]*$/i.test(nrTrim)) {
            nrTrim += '\n\nCreated with newrecruit.eu v36.27';
          }
          cleanRow._omnitactica_nr_text = nrTrim;
        }
      } catch (e) {}

      if (cleanRow._omnitactica_gw_text && cleanRow._omnitactica_nr_text) {
        nativeExportsCache[cacheKey] = {
          gw: cleanRow._omnitactica_gw_text,
          nr: cleanRow._omnitactica_nr_text,
          livePts: resolvedLivePts || 0,
          armyJson: cleanRow.army || null,
          units: cleanRow._omnitactica_enriched_units || null,
          detachment: cleanRow._omnitactica_detachment || '',
          bookName: cleanRow._omnitactica_book_name || ''
        };
      }
    } catch (e) {}
  }

  var pendingSyncRow = {};

  function mirrorRowIntoPiniaListData(row) {
    try {
      if (!row || row._ephemeral_view || isTombstonedNrRow(row)) return;
      var k = String(row.list_key || row._id || '');
      if (!k) return;
      row.list_key = k;
      if (!isHydrating && !isCompilingSave) {
        lastLocalWriteAt[k] = Date.now();
        if (pendingNrRowFromParent && pendingNrRowFromParent.list_key === k) {
          pendingNrRowFromParent = null;
        }
      }
      var st = getNrStores();
      if (!st || !st.list || !Array.isArray(st.list.listData)) return;
      var idx = st.list.listData.findIndex(function(x) { return x && x.list_key === k; });
      if (idx === -1) {
        st.list.listData.push(row);
      } else if (st.list.listData[idx] !== row) {
        Object.assign(st.list.listData[idx], row);
      }
      if (st.list.currentList && st.list.currentList.row && st.list.currentList.row.list_key === k) {
        if (st.list.currentList.row !== row) {
          var prevCompiledSum = st.list.currentList.row._compiled_pts_sum;
          Object.assign(st.list.currentList.row, row);
          if (prevCompiledSum && !st.list.currentList.row._compiled_pts_sum) {
            st.list.currentList.row._compiled_pts_sum = prevCompiledSum;
          }
        }
      }
      if (typeof st.list.rebuildTreeData === 'function') {
        st.list.rebuildTreeData();
      }
    } catch (e) {}
  }

  async function syncUpsertRow(row, explicitArmy, explicitBook) {
    if (isHydrating || isEphemeralViewer || !row || row._ephemeral_view || isTombstonedNrRow(row)) return;
    var rKey = String(row.list_key || row._id || '');
    if (rKey && syncInFlight[rKey]) {
      pendingSyncRow[rKey] = { row: row, explicitArmy: explicitArmy, explicitBook: explicitBook };
      return;
    }
    var clean = cloneCleanRow(row, explicitArmy, explicitBook);
    if (!clean || !clean.list_key || clean._ephemeral_view) return;
    if (syncInFlight[clean.list_key]) {
      pendingSyncRow[clean.list_key] = { row: row, explicitArmy: explicitArmy, explicitBook: explicitBook };
      return;
    }
    syncInFlight[clean.list_key] = true;
    try {
      await attachNativeArmyExports(clean, explicitArmy);
      if (clean._omnitactica_gw_text || clean._omnitactica_nr_text) {
        row._omnitactica_gw_text = clean._omnitactica_gw_text || row._omnitactica_gw_text;
        row._omnitactica_nr_text = clean._omnitactica_nr_text || row._omnitactica_nr_text;
      }
      var sig = computeSignature(clean);
      if (knownListsMap[clean.list_key] === sig) {
        return;
      }
      knownListsMap[clean.list_key] = sig;
      await postSyncAction('upsert', { list: clean });
    } finally {
      syncInFlight[clean.list_key] = false;
      var nextPending = pendingSyncRow[clean.list_key];
      if (nextPending) {
        delete pendingSyncRow[clean.list_key];
        setTimeout(function() {
          syncUpsertRow(nextPending.row, nextPending.explicitArmy, nextPending.explicitBook);
        }, 15);
      }
    }
  }

  async function syncDeleteKey(listKey, listName) {
    if (isHydrating || !listKey) return;
    addNrDeletedTombstone(listKey, listName);
    delete knownListsMap[listKey];
    await postSyncAction('delete', {
      list_key: String(listKey),
      list_name: listName ? String(listName) : ''
    });
  }

  // 2. Hook IDBObjectStore.prototype.put / add for live upsert sync
  try {
    var origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      var isInternalPut = Boolean(value && value._omni_internal_put);
      if (isInternalPut) {
        delete value._omni_internal_put;
      }
      if (isFastPlayViewer && !readyNotified && this.name === 'books_data' && value && typeof value.content === 'string' && value.content.length > 10000) {
        arguments[0] = Object.assign({}, value, { content: '' });
      }
      var req = origPut.apply(this, arguments);
      try {
        if (!isHydrating && !isInternalPut && !isEphemeralViewer && this.name === 'lists' && value && !value._ephemeral_view && (value.list_key || value._id)) {
          var captured = value;
          req.addEventListener('success', function() {
            mirrorRowIntoPiniaListData(captured);
            setTimeout(function() { syncUpsertRow(captured); }, 40);
          });
        }
      } catch (e) {}
      return req;
    };

    var origAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function(value, key) {
      var isInternalAdd = Boolean(value && value._omni_internal_put);
      if (isInternalAdd) {
        delete value._omni_internal_put;
      }
      if (isFastPlayViewer && !readyNotified && this.name === 'books_data' && value && typeof value.content === 'string' && value.content.length > 10000) {
        arguments[0] = Object.assign({}, value, { content: '' });
      }
      var req = origAdd.apply(this, arguments);
      try {
        if (!isHydrating && !isInternalAdd && !isEphemeralViewer && this.name === 'lists' && value && !value._ephemeral_view && (value.list_key || value._id)) {
          var captured = value;
          req.addEventListener('success', function() {
            mirrorRowIntoPiniaListData(captured);
            setTimeout(function() { syncUpsertRow(captured); }, 40);
          });
        }
      } catch (e) {}
      return req;
    };
  } catch (err) {
    console.warn('[OmniTactica Bridge] IDB hook notice:', err);
  }

  // Safely open existing 'nr' IndexedDB ONLY after Dexie has initialized it (version >= 200)
  // and reuse the connection without calling db.close() so Dexie's on("close") handler never fires.
  async function openExistingNrDb() {
    if (cachedNrDb) {
      try {
        if (cachedNrDb.objectStoreNames && cachedNrDb.objectStoreNames.contains('lists')) {
          return cachedNrDb;
        }
      } catch (e) {
        cachedNrDb = null;
      }
    }
    try {
      var stores = getNrStores();
      if (!stores || !stores.list || !stores.list.listsInitiated) {
        return null;
      }
      if (indexedDB.databases) {
        var dbs = await indexedDB.databases();
        var nrExists = dbs && dbs.some(function(d) { return d && d.name === 'nr'; });
        if (!nrExists) return null;
      }
      return await new Promise(function(resolve) {
        var settled = false;
        var done = function(val) {
          if (settled) return;
          settled = true;
          resolve(val);
        };
        setTimeout(function() { done(null); }, 1000);
        var req = indexedDB.open('nr');
        req.onupgradeneeded = function(ev) {
          try { ev.target.transaction.abort(); } catch (e) {}
          done(null);
        };
        req.onsuccess = function() {
          var db = req.result;
          if (db && db.objectStoreNames && db.objectStoreNames.contains('lists')) {
            db.onversionchange = function() {
              try { db.close(); } catch (e) {}
              cachedNrDb = null;
            };
            cachedNrDb = db;
            done(db);
          } else {
            done(null);
          }
        };
        req.onerror = function() { done(null); };
        req.onblocked = function() { done(null); };
      });
    } catch (e) {
      return null;
    }
  }

  // Check whether a list row is active & visible in NewRecruit's MyLists view (not deleted book, not hidden folder, not superseded 10e pre-migration duplicate)
  function isActiveNrListRow(r, stores) {
    if (!r || !(r.list_key || r._id) || r._ephemeral_view || r.deleted || r.trashed || isTombstonedNrRow(r)) {
      return false;
    }
    if (!stores) return true;
    try {
      // 0. If this is a 10th-Ed row that was already migrated to an active 11th-Ed row, skip the legacy 10th-Ed copy
      if (stores.list && Array.isArray(stores.list.listData)) {
        if (r.metadata && r.metadata.migrated_to) {
          var migTargetKey = String(r.metadata.migrated_to);
          var hasMigTarget = stores.list.listData.some(function(x) {
            return x && x.list_key === migTargetKey && !isTombstonedNrRow(x);
          });
          if (hasMigTarget) return false;
        }
        if (r.id_system == 2821148162 && r.name && String((r.army && r.army.id) || '').indexOf('army-') === 0) {
          var rNameClean = String(r.name).trim().toLowerCase();
          var has11eSameName = stores.list.listData.some(function(x) {
            return x && x !== r && (x.id_system == 827374861 || x.bsid_system === 'sys-352e-adc2-7639-d610') &&
              String(x.name || '').trim().toLowerCase() === rNameClean && !isTombstonedNrRow(x);
          });
          if (has11eSameName) return false;
        }
      }
      // 1. Check hidden folder in optionsStore
      if (stores.options && typeof stores.options.getSystemOption === 'function' && r.id_system) {
        var folderName = (r.metadata && r.metadata.folder) ? String(r.metadata.folder) : 'Default';
        var sysFolders = stores.options.getSystemOption(r.id_system, 'folders', []);
        if (Array.isArray(sysFolders)) {
          var isHiddenFolder = sysFolders.some(function(f) {
            return f && f.name === folderName && Boolean(f.hidden);
          });
          if (isHiddenFolder) return false;
        }
      }
      // 2. Check valid system & book in library using NewRecruit's ListsView.getBookName logic
      if (stores.system && stores.system.library && (r.id_system || r.bsid_system) && (r.id_book || r.bsid_book)) {
        var lib = stores.system.library;
        if (lib.index && lib.index[r.id_system] && lib.index[r.id_system].books && lib.index[r.id_system].books.index && lib.index[r.id_system].books.index[r.id_book]) {
          return true;
        }
        if (Array.isArray(lib.array) && lib.array.length > 0) {
          var sysObj = lib.array.find(function(n) {
            return n && (
              n.id == r.id_system ||
              (n.bsid != null && (n.bsid == r.id_system || n.bsid == r.bsid_system))
            );
          });
          if (sysObj && sysObj.books && Array.isArray(sysObj.books.array) && sysObj.books.array.length > 0) {
            var bkObj = sysObj.books.array.find(function(d) {
              return d && (
                d.id == r.id_book ||
                (d.bsid != null && (d.bsid == r.id_book || d.bsid == r.bsid_book))
              );
            });
            if (!bkObj) return false;
          }
        }
      }
    } catch (e) {}
    return true;
  }

  // Read active lists from Pinia stores.list.listData (authoritative live UI state)
  async function readAllNrLists() {
    var mergedMap = {};
    var mergedList = [];
    var stores = getNrStores();
    var piniaInitiated = Boolean(stores && stores.list && stores.list.listsInitiated);
    if (stores && stores.list) {
      await purgeTombstonedRowsFromPiniaAndCloud(stores);
      if (Array.isArray(stores.list.listData)) {
        for (var i = 0; i < stores.list.listData.length; i++) {
          var r = stores.list.listData[i];
          if (r && (r.list_key || r._id)) {
            var k = String(r.list_key || r._id);
            r.list_key = k;
            if (!isActiveNrListRow(r, stores)) continue;
            mergedMap[k] = r;
            mergedList.push(r);
          }
        }
      }
      if (stores.list.currentList && stores.list.currentList.row && /\/Lists(\/|$)/i.test(window.location.pathname || '')) {
        var cr = stores.list.currentList.row;
        var ck = String(cr.list_key || cr._id || '');
        if (ck && mergedMap[ck] && isActiveNrListRow(cr, stores)) {
          cr.list_key = ck;
          if (stores.list.currentList.army && typeof stores.list.currentList.army.toJson === 'function') {
            try {
              cr.army = stores.list.currentList.army.toJson();
              if (!isSyntheticTextRow(cr) || !cr.totalCost) {
                var liveCurPts = stores.list.currentList.army.getPointsCost();
                if (liveCurPts > 0) cr.totalCost = liveCurPts;
              }
            } catch (e) {}
          }
          mergedMap[ck] = Object.assign(mergedMap[ck], cr);
        }
      }
    }

    var db = await openExistingNrDb();
    if (db) {
      var idbRows = await new Promise(function(resolve) {
        try {
          var tx = db.transaction('lists', 'readonly');
          var store = tx.objectStore('lists');
          var req = store.getAll();
          req.onsuccess = function() { resolve(req.result || []); };
          req.onerror = function() { resolve([]); };
        } catch (e) {
          resolve([]);
        }
      });
      for (var j = 0; j < idbRows.length; j++) {
        var ir = idbRows[j];
        if (ir && (ir.list_key || ir._id)) {
          var ik = String(ir.list_key || ir._id);
          ir.list_key = ik;
          if (piniaInitiated) {
            if (mergedMap[ik] && !mergedMap[ik].army && ir.army) {
              mergedMap[ik].army = ir.army;
            }
          } else if (!mergedMap[ik] && isActiveNrListRow(ir, stores)) {
            mergedMap[ik] = ir;
            mergedList.push(ir);
          }
        }
      }
    }

    if (mergedList.length > 0 || piniaInitiated) {
      return mergedList;
    }
    return null;
  }

  // 3. Hydrate NewRecruit from OmniTactica backend on startup AND reconcile active NewRecruit lists back to OmniTactica
  async function hydrateFromOmniTactica(force) {
    if (initialHydrationDone && !force) return;
    try {
      var stores = null;
      for (var attempt = 0; attempt < 240; attempt++) {
        stores = getNrStores();
        if (stores && stores.list && isEmbeddedViewer && (isEphemeralViewer || wantPlayModeFromUrl) && !stores.list.__omniStubbedCloudSync) {
          stores.list.__omniStubbedCloudSync = true;
          stores.list.syncAllLists = async function() { return; };
          stores.list.doSyncAllLists = async function() { return; };
        }
        if (stores && stores.list && stores.list.listsInitiated) break;
        await new Promise(function(r) { setTimeout(r, isFastPlayViewer ? 10 : 30); });
      }
      if (!stores || !stores.list) {
        initialHydrationDone = true;
        return;
      }

      if (isEmbeddedViewer && (isEphemeralViewer || wantPlayModeFromUrl) && !stores.list.__omniStubbedCloudSync) {
        stores.list.__omniStubbedCloudSync = true;
        stores.list.syncAllLists = async function() { return; };
        stores.list.doSyncAllLists = async function() { return; };
      }

      // Ensure live game library (MFM points, detachments, book nrversions) is refreshed from www.newrecruit.eu
      // even if this browser's IndexedDB previously cached an older offline library snapshot.
      // In embedded Play/Ephemeral viewers where the library is already populated, skip blocking on updateLibrary()
      // because applyLibraryRows() resets listStore.currentList = null mid-load.
      var hasPopulatedLibrary = Boolean(
        stores.system &&
        stores.system.library &&
        Array.isArray(stores.system.library.array) &&
        stores.system.library.array.length > 0
      );
      var skipBlockingLibRefresh = Boolean(isEmbeddedViewer && (isEphemeralViewer || wantPlayModeFromUrl) && !force);
      try {
        if (stores.system && !stores.system.__omniLiveLibRefreshed && !skipBlockingLibRefresh) {
          stores.system.__omniLiveLibRefreshed = true;
          if (typeof stores.system.updateLibrary === 'function') {
            await Promise.race([
              stores.system.updateLibrary(),
              new Promise(function(r) { setTimeout(r, 3500); })
            ]);
          } else if (stores.system.libraryUpdatePending && typeof stores.system.applyPendingLibrary === 'function') {
            await stores.system.applyPendingLibrary();
          }
        }
      } catch (e) {}

      // Fast-path for ephemeral competitor/opponent viewers: seed pendingNrRowFromParent directly and activate Play Mode immediately
      // without waiting on tombstone purges or /api/armylists/nr_state!
      if (isEphemeralViewer && !force && requestedListKeyFromUrl) {
        if (pendingNrRowFromParent && pendingNrRowFromParent.list_key) {
          var ephRow = Object.assign({}, pendingNrRowFromParent);
          ephRow._ephemeral_view = true;
          ephRow.synced = 0;
          ephRow.metadata = Object.assign(
            { builder_settings: {}, custom_categories: [], custom_view: false },
            ephRow.metadata || {},
            { play_mode: Boolean(wantPlayModeFromUrl) }
          );
          await upsertSingleRowToIdb(ephRow);
        }
        return;
      }

      await purgeTombstonedRowsFromPiniaAndCloud(stores);

      var isNrLoggedInPre = Boolean(
        (stores.user && stores.user.user && stores.user.user.login) ||
        localStorage.getItem('access')
      );

      // Actively sync with NewRecruit Cloud if logged in BEFORE fetching nr_state so nr_state is never stale while waiting on cloud sync
      try {
        if (isNrLoggedInPre && !isEmbeddedViewer && !isEphemeralViewer) {
          if (stores.user) stores.user.sessionExpired = false;
          if (typeof stores.list.syncAllLists === 'function') {
            await Promise.race([
              stores.list.syncAllLists(true),
              new Promise(function(r) { setTimeout(r, 3500); })
            ]);
          } else if (typeof stores.list.whenSynced === 'function') {
            await Promise.race([
              stores.list.whenSynced(),
              new Promise(function(r) { setTimeout(r, 2500); })
            ]);
          }
        }
      } catch (e) {}

      await purgeTombstonedRowsFromPiniaAndCloud(stores);

      var fetchStartedAt = Date.now();
      var res = await fetch('/api/armylists/nr_state', {
        headers: getAuthHeaders(),
        credentials: 'same-origin'
      });
      if (!res.ok) {
        initialHydrationDone = true;
        return;
      }
      var state = await res.json();
      if (state && state.cloud_account) {
        if (state.cloud_account.connected) {
          var restoredCloudTokens = false;
          if (state.cloud_account.access && localStorage.getItem('access') !== state.cloud_account.access) {
            localStorage.setItem('access', state.cloud_account.access);
            restoredCloudTokens = true;
          }
          if (state.cloud_account.refresh && localStorage.getItem('refresh') !== state.cloud_account.refresh) {
            localStorage.setItem('refresh', state.cloud_account.refresh);
            restoredCloudTokens = true;
          }
          if (state.cloud_account.client_key && !localStorage.getItem('client-key')) {
            localStorage.setItem('client-key', state.cloud_account.client_key);
          }
          if (stores.user && (!stores.user.user || !stores.user.user.login)) {
            var restoredLogin = state.cloud_account.login || 'NewRecruit Account';
            stores.user.user = { id: 1, login: restoredLogin, supporter: 2, tier: 2 };
            stores.user.sessionExpired = false;
            restoredCloudTokens = true;
          }
          try {
            var prevBak = JSON.parse(localStorage.getItem(AUTH_BACKUP_KEY) || '{}');
            localStorage.setItem(AUTH_BACKUP_KEY, JSON.stringify({
              access: localStorage.getItem('access') || state.cloud_account.access || '',
              refresh: localStorage.getItem('refresh') || state.cloud_account.refresh || '',
              clientKey: localStorage.getItem('client-key') || state.cloud_account.client_key || prevBak.clientKey || '',
              user: (stores.user && stores.user.user) ? stores.user.user : { id: 1, login: state.cloud_account.login || 'NewRecruit Account', supporter: 2, tier: 2 },
              synced_to_server: true
            }));
          } catch (e) {}
          backupOrRestoreNrAuth(stores.user);
          if (restoredCloudTokens && !isNrLoggedInPre && !isEmbeddedViewer && !isEphemeralViewer && typeof stores.list.syncAllLists === 'function') {
            try {
              await Promise.race([
                stores.list.syncAllLists(true),
                new Promise(function(r) { setTimeout(r, 3500); })
              ]);
            } catch (e) {}
            backupOrRestoreNrAuth(stores.user);
          }
        } else if (state.cloud_account.disconnected_at) {
          // Cross-device logout propagation: if this device was previously synced to the server
          // and another device explicitly logged out / disconnected, clear local tokens here too.
          var localBak = null;
          try { localBak = JSON.parse(localStorage.getItem(AUTH_BACKUP_KEY) || 'null'); } catch (e) {}
          if (localBak && localBak.synced_to_server) {
            try {
              window.__omniExplicitLogout = true;
              localStorage.removeItem(AUTH_BACKUP_KEY);
              localStorage.removeItem('access');
              localStorage.removeItem('refresh');
              if (stores.user) {
                stores.user.user = null;
                stores.user.sessionExpired = false;
              }
            } catch (e) {}
          }
        }
      }

      var isNrLoggedIn = Boolean(
        (stores.user && stores.user.user && stores.user.user.login) ||
        localStorage.getItem('access')
      );

      var serverRows = (state && Array.isArray(state.nr_rows)) ? state.nr_rows.slice() : [];
      if (pendingNrRowFromParent && pendingNrRowFromParent.list_key) {
        var alreadyInServer = serverRows.some(function(r) { return r && r.list_key === pendingNrRowFromParent.list_key; });
        if (!alreadyInServer) {
          serverRows.push(pendingNrRowFromParent);
        }
      }

      var currentListData = Array.isArray(stores.list.listData) ? stores.list.listData : [];
      var piniaKeyMap = {};
      var piniaNameMap = {};
      for (var pIdx = 0; pIdx < currentListData.length; pIdx++) {
        var pRow = currentListData[pIdx];
        if (!pRow || !pRow.list_key) continue;
        piniaKeyMap[pRow.list_key] = pRow;
        if (pRow.name) {
          piniaNameMap[String(pRow.name).trim().toLowerCase()] = pRow;
        }
      }

      // Merge any missing serverRows (e.g. lists created on Mobile or synced via OmniTactica backend) into Pinia & IndexedDB
      var allowSeedFromOmniServer = !isEphemeralViewer;
      var seededRowsForIdb = [];
      serverRows.forEach(function(sRow) {
        if (!sRow || !sRow.list_key || isTombstonedNrRow(sRow)) return;
        var sNameLow = String(sRow.name || '').trim().toLowerCase();
        var isTargetUrlRow = Boolean(
          (requestedListKeyFromUrl && requestedListKeyFromUrl === sRow.list_key) ||
          (requestedListNameFromUrl && sNameLow && sNameLow === requestedListNameFromUrl.toLowerCase())
        );
        if (sRow._ephemeral_view && !isTargetUrlRow) return;
        if (!isTargetUrlRow && !allowSeedFromOmniServer) return;
        if (isEphemeralViewer && isTargetUrlRow) {
          sRow._ephemeral_view = true;
        }

        // Only deduplicate by name when one row is an explicit migration partner or an uncompiled synthetic fallback of the same system
        if (!sRow._ephemeral_view && !isEphemeralViewer && sNameLow && piniaNameMap[sNameLow] && !piniaKeyMap[sRow.list_key]) {
          var existingByName = piniaNameMap[sNameLow];
          var isExplicitMigration = Boolean(
            (existingByName.metadata && existingByName.metadata.migrated_to === sRow.list_key) ||
            (sRow.metadata && sRow.metadata.migrated_to === existingByName.list_key)
          );
          var isSyntheticDup = Boolean(
            existingByName.id_system == sRow.id_system &&
            String((sRow.army && sRow.army.id) || '').indexOf('army-') === 0 &&
            String((existingByName.army && existingByName.army.id) || '').indexOf('army-') !== 0
          );
          if (isExplicitMigration || isSyntheticDup) {
            if (isTargetUrlRow) {
              existingByName.metadata = Object.assign({}, existingByName.metadata || {}, { play_mode: Boolean(wantPlayModeFromUrl) });
              requestedListKeyFromUrl = existingByName.list_key;
            }
            return;
          }
        }

        sRow.metadata = Object.assign(
          { builder_settings: {}, custom_categories: [], custom_view: false },
          sRow.metadata || {}
        );
        if (isTargetUrlRow) {
          sRow.metadata.play_mode = Boolean(wantPlayModeFromUrl);
        }
        var existingPinia = piniaKeyMap[sRow.list_key];
        if (!existingPinia) {
          if (isNrLoggedIn && !sRow._ephemeral_view) {
            sRow.synced = false;
          }
          stores.list.listData.push(sRow);
          piniaKeyMap[sRow.list_key] = sRow;
          if (sNameLow) piniaNameMap[sNameLow] = sRow;
          if (!sRow._ephemeral_view && !isEphemeralViewer) {
            knownListsMap[sRow.list_key] = computeSignature(cloneCleanRow(sRow) || sRow);
            seededRowsForIdb.push(sRow);
          }
        } else {
          if (isTargetUrlRow) {
            existingPinia.metadata = Object.assign({}, existingPinia.metadata || {}, { play_mode: Boolean(wantPlayModeFromUrl) });
          }
          var exArrPts = getRowArrayTotalCostsPts(existingPinia);
          if (exArrPts > 0 && !isSyntheticTextRow(existingPinia, exArrPts)) {
            existingPinia.totalCost = exArrPts;
          }
          var wasAlreadyKnown = Boolean(knownListsMap[sRow.list_key]);
          var sSig = computeSignature(cloneCleanRow(sRow) || sRow);
          var exSig = computeSignature(cloneCleanRow(existingPinia) || existingPinia);
          var hasUnsavedLocalEdit = Boolean(wasAlreadyKnown && knownListsMap[sRow.list_key] !== exSig);
          var hasRecentLocalWrite = Boolean(
            syncInFlight[sRow.list_key] ||
            pendingSyncRow[sRow.list_key] ||
            (lastLocalWriteAt[sRow.list_key] && (lastLocalWriteAt[sRow.list_key] >= fetchStartedAt - 500 || (Date.now() - lastLocalWriteAt[sRow.list_key]) < 2500))
          );
          var isCurrentlyEditingThisList = Boolean(
            (window.location.pathname || '').indexOf('/Lists/' + sRow.list_key) !== -1 &&
            !wantPlayModeFromUrl
          );
          var sArmyId = String((sRow.army && sRow.army.id) || '');
          var exArmyId = String((existingPinia.army && existingPinia.army.id) || '');
          var serverHasCompiledArmy = Boolean(sArmyId && sArmyId.indexOf('army-') !== 0 && sArmyId.indexOf('root-') !== 0 && sArmyId.indexOf('cat-') !== 0);
          var localHasCompiledArmy = Boolean(exArmyId && exArmyId.indexOf('army-') !== 0 && exArmyId.indexOf('root-') !== 0 && exArmyId.indexOf('cat-') !== 0);
          if (!wasAlreadyKnown) {
            // NewRecruit is the single source of truth on initial load: never clobber existing NewRecruit rows with cached OmniTactica backend rows.
            if (!existingPinia.army && sRow.army && serverHasCompiledArmy) {
              existingPinia.army = sRow.army;
            }
            if (!existingPinia._ephemeral_view && !isEphemeralViewer) {
              knownListsMap[sRow.list_key] = computeSignature(cloneCleanRow(existingPinia) || existingPinia);
              if (sSig !== exSig) {
                setTimeout(function() {
                  syncUpsertRow(existingPinia);
                }, 60);
              }
            }
          } else if (sSig !== exSig && !isCurrentlyEditingThisList && !hasUnsavedLocalEdit && !hasRecentLocalWrite) {
            var keepMeta = Object.assign({}, existingPinia.metadata || {}, sRow.metadata || {});
            if (isTargetUrlRow) {
              keepMeta.play_mode = Boolean(wantPlayModeFromUrl);
            }
            if (serverHasCompiledArmy || !localHasCompiledArmy || sRow._synthetic_text !== existingPinia._synthetic_text) {
              Object.assign(existingPinia, sRow, { metadata: keepMeta });
            } else {
              existingPinia.name = sRow.name || existingPinia.name;
              existingPinia.totalCost = sRow.totalCost != null ? sRow.totalCost : existingPinia.totalCost;
              existingPinia.metadata = keepMeta;
            }
            if (sNameLow) piniaNameMap[sNameLow] = existingPinia;
            if (!existingPinia._ephemeral_view && !isEphemeralViewer) {
              knownListsMap[sRow.list_key] = computeSignature(cloneCleanRow(existingPinia) || existingPinia);
              seededRowsForIdb.push(existingPinia);
            }
            if (
              stores.list.currentList &&
              stores.list.currentList.row &&
              stores.list.currentList.row.list_key === sRow.list_key &&
              (window.location.pathname || '').indexOf('/Lists/') === -1
            ) {
              stores.list.currentList = null;
            }
            if (
              stores.listsPage &&
              stores.listsPage.editedList &&
              stores.listsPage.editedList.row &&
              stores.listsPage.editedList.row.list_key === sRow.list_key &&
              (window.location.pathname || '').indexOf('/Lists/') === -1
            ) {
              stores.listsPage.editedList = null;
            }
          } else if (!existingPinia._ephemeral_view && !isEphemeralViewer && !hasUnsavedLocalEdit) {
            knownListsMap[sRow.list_key] = exSig;
          }
        }
      });

      if (seededRowsForIdb.length > 0) {
        var dbSeed = await openExistingNrDb();
        if (dbSeed) {
          var prevHydSeed = isHydrating;
          isHydrating = true;
          await new Promise(function(resolve) {
            var done = false;
            var finish = function() {
              if (!done) {
                done = true;
                isHydrating = prevHydSeed;
                resolve();
              }
            };
            setTimeout(finish, 800);
            try {
              var tx = dbSeed.transaction('lists', 'readwrite');
              var stObj = tx.objectStore('lists');
              for (var sIdx = 0; sIdx < seededRowsForIdb.length; sIdx++) {
                var toPut = Object.assign({}, seededRowsForIdb[sIdx]);
                delete toPut._id;
                try { stObj.put(toPut); } catch (e) {}
              }
              tx.oncomplete = finish;
              tx.onerror = finish;
            } catch (e) { finish(); }
          });
        }
      }

      try {
        if (typeof stores.list.rebuildTreeData === 'function') {
          stores.list.rebuildTreeData();
        }
      } catch (e) {}
    } catch (e) {
      console.warn('[OmniTactica Bridge] Hydration notice:', e);
    } finally {
      isHydrating = false;
      initialHydrationDone = true;
      await ensurePlayModeAndStoreHooks();
      if (!readyNotified && !requestedListKeyFromUrl) {
        readyNotified = true;
        notifyParent({ action: 'ready' });
      }
      if (!isEmbeddedViewer && !requestedListKeyFromUrl && !isEphemeralViewer) {
        await forceFullSync(false);
      }
    }
  }

  async function upsertSingleRowToIdb(row) {
    if (!row || !row.list_key) return false;
    var isEphemeralRow = Boolean(row._ephemeral_view || isEphemeralViewer);
    if (isEphemeralRow) {
      row._ephemeral_view = true;
      row.synced = 0;
    }
    var stores = getNrStores();
    if (stores && stores.list && Array.isArray(stores.list.listData)) {
      row.metadata = Object.assign(
        { builder_settings: {}, custom_categories: [], custom_view: false },
        row.metadata || {}
      );
      var idx = stores.list.listData.findIndex(function(r) { return r && r.list_key === row.list_key; });
      if (idx === -1) {
        stores.list.listData.unshift(row);
      } else {
        stores.list.listData.splice(idx, 1, Object.assign({}, stores.list.listData[idx], row));
      }
      try {
        if (!isEphemeralRow && !requestedListKeyFromUrl && typeof stores.list.rebuildTreeData === 'function') {
          stores.list.rebuildTreeData();
        }
      } catch (e) {}
    }
    // IMPORTANT: Never persist ephemeral competitor/opponent viewer rows into IndexedDB 'lists'!
    if (isEphemeralRow) {
      return true;
    }
    var db = await openExistingNrDb();
    if (!db) return true;
    var prevHydrating = isHydrating;
    isHydrating = true;
    return await new Promise(function(resolve) {
      try {
        var tx = db.transaction('lists', 'readwrite');
        var store = tx.objectStore('lists');
        var toPut = Object.assign({}, row);
        delete toPut._id;
        try { store.put(toPut); } catch (e) {}
        knownListsMap[row.list_key] = computeSignature(toPut);
        tx.oncomplete = function() {
          isHydrating = prevHydrating;
          resolve(true);
        };
        tx.onerror = function() {
          isHydrating = prevHydrating;
          resolve(false);
        };
      } catch (e) {
        isHydrating = prevHydrating;
        resolve(false);
      }
    });
  }

  function countCompiledUnitsInArmy(armyInst) {
    if (!armyInst || typeof armyInst.getForces !== 'function') return 0;
    try {
      var forces = armyInst.getForces() || [];
      var total = 0;
      for (var i = 0; i < forces.length; i++) {
        var f = forces[i];
        if (!f) continue;
        if (typeof f.getCategories === 'function') {
          var cats = f.getCategories() || [];
          for (var cIdx = 0; cIdx < cats.length; cIdx++) {
            var cat = cats[cIdx];
            if (!cat || cat.isConfiguration || typeof cat.getUnits !== 'function') continue;
            var catName = (typeof cat.getName === 'function') ? String(cat.getName() || '') : String(cat.name || '');
            if (catName.toLowerCase() === 'configuration') continue;
            var units = cat.getUnits() || [];
            total += units.length;
          }
        } else if (f.units && Array.isArray(f.units.array)) {
          for (var j = 0; j < f.units.array.length; j++) {
            var u = f.units.array[j];
            if (!u) continue;
            var uCat = (typeof u.getCategoryName === 'function') ? String(u.getCategoryName() || '') : '';
            if (uCat.toLowerCase() === 'configuration') continue;
            total++;
          }
        }
      }
      return total;
    } catch (e) {
      return 0;
    }
  }

  function isPlayModeActiveForRow(rowObj) {
    try {
      var st = getNrStores();
      var activeRow = (st && st.listsPage && st.listsPage.editedList && st.listsPage.editedList.row) ||
                      (st && st.list && st.list.currentList && st.list.currentList.row) ||
                      rowObj;
      if (activeRow && activeRow.metadata && typeof activeRow.metadata.play_mode === 'boolean') {
        return activeRow.metadata.play_mode;
      }
    } catch (e) {}
    if (rowObj && rowObj.metadata && typeof rowObj.metadata.play_mode === 'boolean') {
      return rowObj.metadata.play_mode;
    }
    return Boolean(
      (requestedListKeyFromUrl && wantPlayModeFromUrl) ||
      (window.location.search || '').indexOf('view=play') !== -1 ||
      (window.location.search || '').indexOf('play=1') !== -1
    );
  }

  function patchArmyAndBookForFastPlayMode(armyObj, bookObj, rowObj) {
    try {
      if (armyObj && !armyObj.__omniPatchedFastPlay) {
        armyObj.__omniPatchedFastPlay = true;
        if (typeof armyObj.validateArmy === 'function') {
          var origValidateArmy = armyObj.validateArmy.bind(armyObj);
          armyObj.validateArmy = function() {
            if (isPlayModeActiveForRow(rowObj)) return [];
            return origValidateArmy.apply(this, arguments);
          };
        }
        var forcesList = (typeof armyObj.getForces === 'function') ? (armyObj.getForces(!0) || []) : [];
        for (var fIdx = 0; fIdx < forcesList.length; fIdx++) {
          var fObj = forcesList[fIdx];
          if (!fObj || fObj.__omniPatchedFastPlay) continue;
          fObj.__omniPatchedFastPlay = true;
          if (typeof fObj.getAvailableCategories === 'function') {
            var origAvailCats = fObj.getAvailableCategories.bind(fObj);
            fObj.getAvailableCategories = function() {
              if (isPlayModeActiveForRow(rowObj)) return [];
              return origAvailCats.apply(this, arguments);
            };
          }
          if (typeof fObj.getAvailableChildForcesWithTracker === 'function') {
            var origChildForcesTracker = fObj.getAvailableChildForcesWithTracker.bind(fObj);
            fObj.getAvailableChildForcesWithTracker = function() {
              if (isPlayModeActiveForRow(rowObj)) return null;
              return origChildForcesTracker.apply(this, arguments);
            };
          }
          if (typeof fObj.getAvailableVisibleChildForces === 'function') {
            var origVisChildForces = fObj.getAvailableVisibleChildForces.bind(fObj);
            fObj.getAvailableVisibleChildForces = function() {
              if (isPlayModeActiveForRow(rowObj)) return [];
              return origVisChildForces.apply(this, arguments);
            };
          }
        }
      }
      if (bookObj && !bookObj.__omniPatchedFastPlay) {
        bookObj.__omniPatchedFastPlay = true;
        if (typeof bookObj.getForces === 'function') {
          var origBookForces = bookObj.getForces.bind(bookObj);
          bookObj.getForces = function() {
            if (isPlayModeActiveForRow(rowObj)) return [];
            return origBookForces.apply(this, arguments);
          };
        }
        if (typeof bookObj.getUnits === 'function') {
          var origBookUnits = bookObj.getUnits.bind(bookObj);
          bookObj.getUnits = function() {
            if (isPlayModeActiveForRow(rowObj)) return [];
            return origBookUnits.apply(this, arguments);
          };
        }
      }
    } catch (e) {}
  }

  // Compile synthetic/text-imported row into a real NewRecruit BattleScribe catalogue army using the live Nuxt entry module's system parser
  async function compileSyntheticRowIfNeeded(row, systemStore, listStore, forceCompile) {
    if (!row || !row.list_key || (!row._synthetic_text && !row._raw_text)) return row;
    if (row._compiled_by_nr && !forceCompile) return row;
    var rowArmyId = row.army ? String(row.army.id || '') : '';
    var hasSyntheticArmy = Boolean(
      forceCompile ||
      !row.army ||
      !row.nrversion ||
      rowArmyId.indexOf('army-') === 0 ||
      rowArmyId.indexOf('root-') === 0 ||
      rowArmyId.indexOf('cat-') === 0
    );
    if (!hasSyntheticArmy) return row;
    if (compilingKeys[row.list_key]) {
      return await compilingKeys[row.list_key];
    }
    var compileStartAt = Date.now();
    var compilePromise = (async function() {
      try {
        updateDirectListLoaderSubtitle('Initializing game system...');
        var targetSysId = Number(row.id_system) || getDefaultSystemIdForOmniGameSystem();
        var sys = (systemStore.selectedSystem && Number(systemStore.selectedSystem.id) === targetSysId)
          ? systemStore.selectedSystem
          : await systemStore.selectSystem(targetSysId);
        if (!sys) {
          var fallbackSysId = (targetSysId === 4255553472 || targetSysId === 4194757354) ? 4194757354 : 2821148162;
          sys = await systemStore.selectSystem(fallbackSysId);
        }
        if (!sys) return row;

        window.__omniNrAdapterCache = window.__omniNrAdapterCache || {};
        var adapter = window.__omniNrAdapterCache[sys.id] || null;
        if (!adapter) {
          var entryMod = window.__omniNrEntryMod || null;
          if (!entryMod) {
            var entryScriptEl = document.querySelector('script[type="module"][src*="/_nuxt/"]');
            var entrySrc = entryScriptEl ? entryScriptEl.getAttribute('src') : null;
            if (!entrySrc) return row;
            entryMod = await import(entrySrc);
            window.__omniNrEntryMod = entryMod;
          }
          if (entryMod && typeof entryMod.w === 'function') {
            try {
              var cand = entryMod.w(sys);
              if (cand && typeof cand.parseTextList === 'function') adapter = cand;
            } catch (e) {}
          }
          if (!adapter && entryMod) {
            var modVals = Object.values(entryMod);
            for (var mIdx = 0; mIdx < modVals.length; mIdx++) {
              var fn = modVals[mIdx];
              if (typeof fn === 'function' && fn.length === 1) {
                try {
                  var probe = fn(sys);
                  if (probe && typeof probe.parseTextList === 'function' && typeof probe.parseTextListHeader === 'function') {
                    adapter = probe;
                    break;
                  }
                } catch (e) {}
              }
            }
          }
          if (adapter && sys.id) {
            window.__omniNrAdapterCache[sys.id] = adapter;
          }
        }
        if (!adapter || typeof sys.getBook !== 'function') return row;

        var candidateTexts = [];
        if (row._omnitactica_gw_text && String(row._omnitactica_gw_text).trim()) {
          candidateTexts.push(String(row._omnitactica_gw_text));
        }
        if (row._omnitactica_nr_text && String(row._omnitactica_nr_text).trim() && candidateTexts.indexOf(String(row._omnitactica_nr_text)) === -1) {
          candidateTexts.push(String(row._omnitactica_nr_text));
        }
        var rawTextTrimmed = row._raw_text ? String(row._raw_text).trim() : '';
        var synthTextTrimmed = row._synthetic_text ? String(row._synthetic_text).trim() : '';
        var rawIsNativeNrExport = rawTextTrimmed.indexOf('+++') === 0;
        if (rawIsNativeNrExport && rawTextTrimmed && candidateTexts.indexOf(String(row._raw_text)) === -1) {
          candidateTexts.push(String(row._raw_text));
        }
        if (synthTextTrimmed && candidateTexts.indexOf(String(row._synthetic_text)) === -1) {
          candidateTexts.push(String(row._synthetic_text));
        }
        if (!rawIsNativeNrExport && rawTextTrimmed && candidateTexts.indexOf(String(row._raw_text)) === -1) {
          candidateTexts.push(String(row._raw_text));
        }
        if (candidateTexts.length === 0) return row;

        var firstLines = candidateTexts[0].match(/[^\r\n]+/g) || [];
        var firstHdr = (firstLines.length > 0 && typeof adapter.parseTextListHeader === 'function')
          ? await adapter.parseTextListHeader(firstLines.slice())
          : { start: 0 };

        var booksArr = (sys.books && Array.isArray(sys.books.array)) ? sys.books.array : [];
        var wantedBookNames = [];
        if (firstHdr && firstHdr.bookName) wantedBookNames.push(String(firstHdr.bookName).trim().toLowerCase());
        if (row._omnitactica_book_name) wantedBookNames.push(String(row._omnitactica_book_name).trim().toLowerCase());
        if (row.army && row.army.name) wantedBookNames.push(String(row.army.name).trim().toLowerCase());

        var fallbackBook = null;
        for (var wIdx = 0; wIdx < wantedBookNames.length && !fallbackBook; wIdx++) {
          var wn = wantedBookNames[wIdx];
          if (!wn) continue;
          fallbackBook = booksArr.find(function(b) {
            return b && String(b.name || '').trim().toLowerCase() === wn;
          }) || null;
        }
        if (!fallbackBook) {
          fallbackBook = booksArr.find(function(b) {
            return b && (b.id == row.id_book || b.bsid == row.bsid_book);
          }) || null;
        }
        if (!fallbackBook) {
          for (var wIdx2 = 0; wIdx2 < wantedBookNames.length && !fallbackBook; wIdx2++) {
            var wn2 = wantedBookNames[wIdx2];
            var shortWn = wn2.indexOf(' - ') !== -1 ? wn2.split(' - ').pop().trim() : wn2;
            if (!shortWn) continue;
            fallbackBook = booksArr.find(function(b) {
              if (!b || !b.name) return false;
              var bn = String(b.name).trim().toLowerCase();
              var shortBn = bn.indexOf(' - ') !== -1 ? bn.split(' - ').pop().trim() : bn;
              return shortBn === shortWn || bn.indexOf(shortWn) !== -1;
            });
          }
        }
        if (!fallbackBook) {
          fallbackBook = booksArr.find(function(b) { return b && b.playable; }) || null;
        }
        if (!fallbackBook) return row;

        updateDirectListLoaderSubtitle('Loading ' + (fallbackBook.name || 'faction') + ' catalogue...');
        window.__omniPerf = window.__omniPerf || [];
        window.__omniPerf.push({ t: Math.round(performance.now()), lbl: 'getBook_start:' + fallbackBook.id });
        var bookInst = await sys.getBook(fallbackBook.id);
        window.__omniPerf.push({ t: Math.round(performance.now()), lbl: 'getBook_end:' + Boolean(bookInst) });
        if (!bookInst) return row;

        updateDirectListLoaderSubtitle('Compiling army datasheets & detachment rules...');
        var bestParsed = null;
        var bestUnitCount = 0;
        var bestErrorCount = 999999;
        var lastErrors = [];
        var expectedUnits = Number(row._expected_unit_count) || 0;

        for (var cIdx = 0; cIdx < candidateTexts.length; cIdx++) {
          var rawLines = (cIdx === 0 && firstLines.length > 0) ? firstLines : (candidateTexts[cIdx].match(/[^\r\n]+/g) || []);
          if (rawLines.length === 0) continue;
          var hdr = (cIdx === 0 && firstHdr)
            ? firstHdr
            : ((typeof adapter.parseTextListHeader === 'function')
              ? await adapter.parseTextListHeader(rawLines.slice())
              : { start: 0 });
          var startIdx = (hdr && typeof hdr.start === 'number') ? hdr.start : 0;
          var maxCost = (hdr && hdr.maxCost) || Number(row.totalCost) || 2000;
          window.__omniPerf.push({ t: Math.round(performance.now()), lbl: 'parseText_start:' + cIdx });
          var parsed = await adapter.parseTextList(bookInst, rawLines, maxCost, startIdx);
          var pErrors = (parsed && Array.isArray(parsed.errors)) ? parsed.errors : [];
          if (pErrors.length > 0) {
            lastErrors = pErrors;
          }
          var uCount = (parsed && parsed.army) ? countCompiledUnitsInArmy(parsed.army) : 0;
          window.__omniPerf.push({ t: Math.round(performance.now()), lbl: 'parseText_end:' + cIdx + ':u=' + uCount + ':err=' + pErrors.length });
          if (uCount > bestUnitCount || (uCount === bestUnitCount && uCount > 0 && pErrors.length < bestErrorCount)) {
            bestParsed = parsed;
            bestUnitCount = uCount;
            bestErrorCount = pErrors.length;
            if (uCount > 0 && (pErrors.length === 0 || (expectedUnits > 0 && uCount >= Math.max(1, expectedUnits - 1)) || uCount >= 4)) {
              break;
            }
          }
          if (!bestParsed && parsed && parsed.army) {
            bestParsed = parsed;
          }
        }

        // If a newer local edit wrote to this list_key while compilation was running, do not clobber it!
        if (lastLocalWriteAt[row.list_key] && lastLocalWriteAt[row.list_key] > compileStartAt) {
          var newerRow = (listStore && Array.isArray(listStore.listData))
            ? listStore.listData.find(function(r) { return r && r.list_key === row.list_key; })
            : null;
          return newerRow || row;
        }

        if (bestParsed && bestParsed.army && bestUnitCount > 0) {
          row.id_system = sys.id;
          row.bsid_system = sys.bsid || row.bsid_system;
          row.id_book = fallbackBook.id || row.id_book;
          row.bsid_book = fallbackBook.bsid || row.bsid_book;
          row.nrversion = fallbackBook.nrversion || row.nrversion || 1;
          delete row.booksDate;
          if (bestParsed.leaders && typeof adapter.migrateLegacyLeaders === 'function') {
            row.metadata = row.metadata || {};
            row.metadata.leaders = bestParsed.leaders;
            try { adapter.migrateLegacyLeaders(row, bestParsed.army); } catch (e) {}
          }
          var wantPlayCompile = Boolean(
            (row.metadata && row.metadata.play_mode) ||
            wantPlayModeFromUrl ||
            (window.location.search || '').indexOf('view=play') !== -1
          );
          row.metadata = Object.assign(
            { builder_settings: {}, custom_categories: [], custom_view: false },
            row.metadata || {},
            { play_mode: wantPlayCompile }
          );
          try {
            if (row.note && typeof bestParsed.army.setNote === 'function') bestParsed.army.setNote(row.note);
            if (row.name && typeof bestParsed.army.setCustomName === 'function') bestParsed.army.setCustomName(row.name);
            if (row.metadata && row.metadata.builder_settings && typeof bestParsed.army.setBuilderSettings === 'function') {
              bestParsed.army.setBuilderSettings(row.metadata.builder_settings);
            }
          } catch (e) {}
          patchArmyAndBookForFastPlayMode(bestParsed.army, bookInst, row);
          var compiledListObj = { book: bookInst, row: row, army: bestParsed.army };
          try {
            Object.defineProperty(row, '_nr_compiled_list_obj', {
              value: compiledListObj,
              writable: true,
              configurable: true,
              enumerable: false
            });
          } catch (e) {}
          window.__omniCompiledListByKey = window.__omniCompiledListByKey || {};
          window.__omniCompiledListByKey[String(row.list_key)] = compiledListObj;
          row.army = bestParsed.army.toJson();
          var compiledUnitPts = (typeof bestParsed.army.getPointsCost === 'function' ? bestParsed.army.getPointsCost() : 0) || 0;
          row._compiled_pts_sum = compiledUnitPts;
          var explicitTotalCost = Number(row.totalCost) || 0;
          var keepSyntheticHeaderCost = Boolean(explicitTotalCost > 0 && isSyntheticTextRow(row, compiledUnitPts));
          var resolvedCompiledCost = keepSyntheticHeaderCost ? explicitTotalCost : (compiledUnitPts || explicitTotalCost || 2000);
          row.totalCost = resolvedCompiledCost;
          if (typeof bestParsed.army.calcTotalCosts === 'function') {
            row.totalCosts = bestParsed.army.calcTotalCosts();
          }
          if (keepSyntheticHeaderCost) {
            setRowPointsEverywhere(row, explicitTotalCost);
          } else if (compiledUnitPts > 0) {
            setRowPointsEverywhere(row, compiledUnitPts);
          }
          row._compiled_by_nr = true;
          row._compiled_unit_count = bestUnitCount;
          row._nr_compile_failed = false;
          if (!row._ephemeral_view && !isEphemeralViewer) {
            var prevCompSave = isCompilingSave;
            isCompilingSave = true;
            try {
              await listStore.saveListLocally({
                row: row,
                army: bestParsed.army,
                book: bookInst
              });
            } finally {
              isCompilingSave = prevCompSave;
            }
          }
          if (keepSyntheticHeaderCost) {
            setRowPointsEverywhere(row, explicitTotalCost);
          } else if (compiledUnitPts > 0) {
            setRowPointsEverywhere(row, compiledUnitPts);
          }
          if (listStore && Array.isArray(listStore.listData)) {
            var existingIdx = listStore.listData.findIndex(function(r) { return r && r.list_key === row.list_key; });
            if (existingIdx !== -1) {
              Object.assign(listStore.listData[existingIdx], row);
              setRowPointsEverywhere(listStore.listData[existingIdx], resolvedCompiledCost);
            }
          }
        } else {
          row._nr_compile_failed = true;
          row._compiled_unit_count = 0;
          row._nr_compile_errors = lastErrors;
          window.__omniCompileFailedForKey = row.list_key;
          hideDirectListLoader();
          notifyParent({
            action: 'compile_failed',
            list_key: row.list_key,
            name: row.name || '',
            errors: lastErrors
          });
        }
      } catch (err) {
        console.warn('[OmniTactica Bridge] Text-to-catalogue compile notice:', err);
      } finally {
        delete compilingKeys[row.list_key];
      }
      return row;
    })();
    compilingKeys[row.list_key] = compilePromise;
    return await compilePromise;
  }

  function cleanUpMyListsButtons() {
    try {
      var btns = document.querySelectorAll('.main-view button, .main-view .bouton');
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (!b || b.classList.contains('createToolbarBtn')) continue;
        var txt = String(b.textContent || '').trim();
        if (
          txt === 'Import file' ||
          txt === 'Text Import' ||
          /^Delete\s+\d+\s+Lists?$/i.test(txt)
        ) {
          b.classList.add('omnitactica-hidden-nr-btn');
          if (b.parentElement && b.parentElement.classList.contains('importButtons')) {
            b.parentElement.classList.add('omnitactica-hidden-nr-btn');
          }
        }
      }
    } catch (e) {}
  }

  var activatingPlayMode = false;

  // 4. Hook NewRecruit Pinia stores to unlock Play Mode, hook list mutations, and auto-open requested list
  async function ensurePlayModeAndStoreHooks() {
    cleanUpMyListsButtons();
    stabilizeLoginFormInputs();
    var stores = getNrStores();
    if (!stores || !stores.user || !stores.list || !stores.system) return;

    try {
      if (stores.system.libraryUpdatePending && typeof stores.system.applyPendingLibrary === 'function') {
        await stores.system.applyPendingLibrary();
      }
    } catch (e) {}

    try {
      stores.user.isSupporter = function() { return true; };
      if (stores.options) applyOmniNrDarkTheme(stores.options);
      backupOrRestoreNrAuth(stores.user);
      if (!stores.user.__omniPatchedUserAuth) {
        stores.user.__omniPatchedUserAuth = true;
        if (typeof stores.user.initLoggedUser === 'function') {
          var origInitLoggedUser = stores.user.initLoggedUser.bind(stores.user);
          stores.user.initLoggedUser = function(u) {
            if (u && u.login) {
              window.__omniExplicitLogout = false;
              var res = origInitLoggedUser(u);
              backupOrRestoreNrAuth(stores.user);
              return res;
            }
            if (!window.__omniExplicitLogout) {
              var hasToken = Boolean(localStorage.getItem('access') || localStorage.getItem(AUTH_BACKUP_KEY));
              if (hasToken) {
                backupOrRestoreNrAuth(stores.user);
                return;
              }
            }
            return origInitLoggedUser(u);
          };
        }
        if (typeof stores.user.logout === 'function') {
          var origUserLogout = stores.user.logout.bind(stores.user);
          stores.user.logout = async function() {
            window.__omniExplicitLogout = true;
            try {
              localStorage.removeItem(AUTH_BACKUP_KEY);
              localStorage.removeItem('access');
              localStorage.removeItem('refresh');
              fetch('/api/armylists/nr_cloud_connect', {
                method: 'POST',
                headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
                credentials: 'same-origin',
                body: JSON.stringify({ action: 'disconnect' })
              }).catch(function() {});
            } catch (e) {}
            return await origUserLogout.apply(this, arguments);
          };
        }
      }
    } catch (e) {}

    if (stores.list.listsInitiated) {
      await purgeTombstonedRowsFromPiniaAndCloud(stores);
    }

    // Auto-select the latest edition of the active game system (or preferredStudioSystemId) once hydration is complete
    if (!requestedListKeyFromUrl && initialHydrationDone && stores.list.listsInitiated) {
      var sysArr = (stores.system.library && Array.isArray(stores.system.library.array) && stores.system.library.array.length)
        ? stores.system.library.array
        : (Array.isArray(stores.system.installedSystems) ? stores.system.installedSystems : []);
      if (sysArr.length > 0) {
        try {
          var activeRows = Array.isArray(stores.list.listData)
            ? stores.list.listData.filter(function(r) { return isActiveNrListRow(r, stores); })
            : [];
          if (stores.options && typeof stores.options.addInstalledSystemVue === 'function') {
            var instSys = (stores.options.options && Array.isArray(stores.options.options.installed_systems))
              ? stores.options.options.installed_systems
              : [];
            var coreSystems = [827374861, 2821148162, 4255553472, 4194757354];
            coreSystems.forEach(function(cid) {
              if (instSys.indexOf(cid) === -1) {
                try { stores.options.addInstalledSystemVue(cid); } catch (e) {}
              }
            });
            activeRows.forEach(function(r) {
              if (r && r.id_system && instSys.indexOf(r.id_system) === -1) {
                try { stores.options.addInstalledSystemVue(r.id_system); } catch (e) {}
              }
            });
          }
          var curSel = stores.system.selectedSystem;
          var desiredSysId = Number(preferredStudioSystemId) || getDefaultSystemIdForOmniGameSystem();
          if (!curSel || !stores.system.__omniDefaultSysChecked || (preferredStudioSystemId && curSel.id != preferredStudioSystemId)) {
            stores.system.__omniDefaultSysChecked = true;
            var targetSys = sysArr.find(function(s) { return s && s.id == desiredSysId; }) ||
              sysArr.find(function(s) { return s && s.id == 827374861; }) ||
              sysArr.find(function(s) { return s && s.id == 4255553472; }) ||
              sysArr[0];
            if (targetSys) {
              if (stores.options && typeof stores.options.addInstalledSystemVue === 'function') {
                try { stores.options.addInstalledSystemVue(targetSys.id); } catch (e) {}
              }
              if (!curSel || curSel.id !== targetSys.id) {
                await stores.system.selectSystem(targetSys.id);
              }
              if (typeof stores.list.rebuildTreeData === 'function') {
                try { stores.list.rebuildTreeData(); } catch (e) {}
              }
            }
          }
        } catch (e) {}
      }
    }

    // Notify parent whenever the active NewRecruit system changes
    try {
      var curSysNow = stores.system && stores.system.selectedSystem;
      var curSysNowId = curSysNow ? Number(curSysNow.id) : 0;
      if (curSysNowId && stores.system.__omniLastNotifiedSysId !== curSysNowId) {
        stores.system.__omniLastNotifiedSysId = curSysNowId;
        notifyParent({
          action: 'system_status',
          id_system: curSysNowId,
          bsid_system: curSysNow.bsid || '',
          system_name: curSysNow.name || ''
        });
      }
    } catch (e) {}

    // Suppress transient "Downloaded list: ..." / "lists were synced" info banners so Play Mode & MyLists stay clean
    try {
      if (stores.main && stores.main.errorManager) {
        var em = stores.main.errorManager;
        if (!em.__omniPatchedShowMessages && typeof em.showMessages === 'function') {
          em.__omniPatchedShowMessages = true;
          var origShowMsgs = em.showMessages.bind(em);
          em.showMessages = function(msgs) {
            if (Array.isArray(msgs)) {
              msgs = msgs.filter(function(m) {
                var txt = String((m && m.msg) || m || '');
                if (/^Downloaded list:/i.test(txt) || /lists were synced/i.test(txt)) {
                  return false;
                }
                return true;
              });
              if (msgs.length === 0) return;
            }
            return origShowMsgs(msgs);
          };
        }
        if (Array.isArray(em.errors) && em.errors.length > 0) {
          for (var eIdx = em.errors.length - 1; eIdx >= 0; eIdx--) {
            var eItem = em.errors[eIdx];
            var eTxt = String((eItem && eItem.msg) || eItem || '');
            if (/^Downloaded list:/i.test(eTxt) || /lists were synced/i.test(eTxt)) {
              em.errors.splice(eIdx, 1);
            }
          }
        }
      }
    } catch (e) {}

    // Notify parent of live auth state and current route path
    try {
      var curLogin = (stores.user && stores.user.user && stores.user.user.login) ? String(stores.user.user.login) : '';
      var curRoutePath = window.location.pathname || '';
      var prevLogin = stores.user.__omniLastLoginNotified;
      if (prevLogin !== curLogin && stores.list.listsInitiated) {
        stores.user.__omniLastLoginNotified = curLogin;
        notifyParent({
          action: 'auth_status',
          logged_in: Boolean(curLogin),
          login: curLogin,
          path: curRoutePath
        });
        // If user just signed in while on /app/Login, return to /app/MyLists and sync
        if (!prevLogin && curLogin && curRoutePath.indexOf('/Login') !== -1) {
          var rtrAfterLogin = stores.list.$router || (window.$nuxt && window.$nuxt.$router);
          if (rtrAfterLogin) {
            setTimeout(function() {
              try { rtrAfterLogin.push('/app/MyLists'); } catch (e) {}
              forceFullSync();
            }, 250);
          }
        }
      }
      if (stores.user.__omniLastRouteNotified !== curRoutePath && stores.list.listsInitiated) {
        stores.user.__omniLastRouteNotified = curRoutePath;
        notifyParent({
          action: 'route_status',
          path: curRoutePath,
          logged_in: Boolean(curLogin),
          login: curLogin
        });
      }
    } catch (e) {}

    if (!readyNotified && stores.list.listsInitiated && !requestedListKeyFromUrl) {
      readyNotified = true;
      notifyParent({ action: 'ready' });
    }

    if (!stores.list.__omniPatchedFind) {
      stores.list.__omniPatchedFind = true;
      var origFind = stores.list.findListByKey.bind(stores.list);
      stores.list.findListByKey = function(listKey, sysFilter) {
        var found = origFind(listKey, sysFilter);
        if (!found && listKey && Array.isArray(this.listData)) {
          found = this.listData.find(function(n) { return n && n.list_key === listKey; }) || null;
        }
        if (!found && listKey && listKey === requestedListKeyFromUrl && requestedListNameFromUrl && Array.isArray(this.listData)) {
          var wantName = String(requestedListNameFromUrl).trim().toLowerCase();
          found = this.listData.find(function(n) {
            return n && !n._ephemeral_view && String(n.name || '').trim().toLowerCase() === wantName;
          }) || null;
        }
        return found;
      };

      // Hook system switching so changing game system in Studio updates My Hub to match
      if (stores.system && typeof stores.system.selectSystem === 'function' && !stores.system.__omniPatchedSelectSys) {
        stores.system.__omniPatchedSelectSys = true;
        var origSelectSystem = stores.system.selectSystem.bind(stores.system);
        stores.system.selectSystem = async function(sysId, forceReload) {
          var res = await origSelectSystem(sysId, forceReload);
          try {
            var selNow = this.selectedSystem;
            if (selNow && selNow.id) {
              this.__omniLastNotifiedSysId = Number(selNow.id);
              notifyParent({
                action: 'system_status',
                id_system: Number(selNow.id),
                bsid_system: selNow.bsid || '',
                system_name: selNow.name || ''
              });
            }
          } catch (e) {}
          if (!isEmbeddedViewer && !requestedListKeyFromUrl && initialHydrationDone) {
            setTimeout(function() { forceFullSync(); }, 180);
          }
          return res;
        };
      }

      // Hook addList, doSaveList, removeList, and syncAllLists directly on Pinia listsStore
      if (typeof stores.list.doSaveList === 'function') {
        var origDoSaveList = stores.list.doSaveList.bind(stores.list);
        stores.list.doSaveList = async function(listObj, localOnly) {
          if ((listObj && listObj.row && listObj.row._ephemeral_view) || isEphemeralViewer) {
            return listObj;
          }
          if (!isCompilingSave && listObj && listObj.row && listObj.row.list_key) {
            lastLocalWriteAt[String(listObj.row.list_key)] = Date.now();
          }
          var origGetPts = null;
          var preserveCost = 0;
          try {
            if (
              listObj &&
              listObj.row &&
              isSyntheticTextRow(listObj.row) &&
              Number(listObj.row.totalCost) > 0 &&
              listObj.army &&
              typeof listObj.army.getPointsCost === 'function'
            ) {
              var curArmyPts = listObj.army.getPointsCost() || 0;
              if (!listObj.row._compiled_pts_sum || curArmyPts === listObj.row._compiled_pts_sum) {
                preserveCost = Number(listObj.row.totalCost);
                origGetPts = listObj.army.getPointsCost;
                listObj.army.getPointsCost = function() { return preserveCost; };
              } else {
                listObj.row._compiled_pts_sum = curArmyPts;
              }
            }
          } catch (e) {}
          var res;
          try {
            res = await origDoSaveList(listObj, localOnly);
          } finally {
            if (origGetPts && listObj && listObj.army) {
              listObj.army.getPointsCost = origGetPts;
            }
            if (preserveCost > 0 && listObj && listObj.row) {
              listObj.row.totalCost = preserveCost;
              if (listObj.row.totalCosts && typeof listObj.row.totalCosts === 'object') {
                listObj.row.totalCosts.pts = preserveCost;
              }
            }
          }
          try {
            if (!isCompilingSave && listObj && listObj.row && !listObj.row._ephemeral_view && !isTombstonedNrRow(listObj.row)) {
              setTimeout(function() {
                syncUpsertRow(listObj.row, listObj.army, listObj.book);
              }, 20);
            }
          } catch (e) {}
          return res;
        };
      }

      if (typeof stores.list.addList === 'function') {
        var origAddList = stores.list.addList.bind(stores.list);
        stores.list.addList = async function(listObj, selectIt) {
          if ((listObj && listObj.row && listObj.row._ephemeral_view) || isEphemeralViewer) {
            return listObj;
          }
          try {
            if (listObj && listObj.row && !this.legacyMigration) {
              clearNrDeletedTombstone(listObj.row.list_key, listObj.row.name);
              if (listObj.row.list_key) {
                lastLocalWriteAt[String(listObj.row.list_key)] = Date.now();
              }
            }
          } catch (e) {}
          var res = await origAddList(listObj, selectIt);
          try {
            if (listObj && listObj.row && !listObj.row._ephemeral_view && !isTombstonedNrRow(listObj.row)) {
              setTimeout(function() {
                syncUpsertRow(listObj.row, listObj.army, listObj.book);
              }, 20);
            }
          } catch (e) {}
          return res;
        };
      }

      if (typeof stores.list.removeList === 'function') {
        var origRemoveList = stores.list.removeList.bind(stores.list);
        stores.list.removeList = async function(rowObj) {
          var keyToDelete = rowObj && (rowObj.list_key || rowObj._id);
          var nameToDelete = rowObj && rowObj.name ? String(rowObj.name) : '';
          var extraKeys = (rowObj && rowObj.metadata && rowObj.metadata.migrated_to) ? [String(rowObj.metadata.migrated_to)] : [];
          if (keyToDelete || nameToDelete) {
            addNrDeletedTombstone(keyToDelete, nameToDelete, extraKeys);
          }
          try {
            if (keyToDelete && this.currentList && this.currentList.row && this.currentList.row.list_key === keyToDelete) {
              this.currentList = null;
            }
            if (keyToDelete && stores.listsPage && stores.listsPage.editedList && stores.listsPage.editedList.row && stores.listsPage.editedList.row.list_key === keyToDelete) {
              stores.listsPage.editedList = null;
            }
          } catch (e) {}
          // Guard against NewRecruit's unguarded `this.listData.splice(findIndex, 1)` when `findIndex === -1`
          var existsInList = Boolean(
            keyToDelete &&
            Array.isArray(this.listData) &&
            this.listData.some(function(r) { return r && r.list_key == keyToDelete; })
          );
          var res = null;
          if (existsInList) {
            res = await origRemoveList(rowObj);
          }
          try {
            if (keyToDelete) {
              delete knownListsMap[String(keyToDelete)];
              setTimeout(function() {
                syncDeleteKey(String(keyToDelete), nameToDelete);
              }, 20);
            }
          } catch (e) {}
          return res;
        };
      }

      if (typeof stores.list.selectList === 'function') {
        var origSelectList = stores.list.selectList.bind(stores.list);
        stores.list.selectList = async function(rowOrKey, opts) {
          var rowObj = (typeof rowOrKey === 'string') ? this.findListByKey(rowOrKey) : rowOrKey;
          var wantPlayNow = requestedListKeyFromUrl
            ? Boolean(wantPlayModeFromUrl)
            : Boolean((window.location.search || '').indexOf('view=play') !== -1);
          if (rowObj && rowObj.list_key && this.currentList && this.currentList.row && this.currentList.row.list_key === rowObj.list_key && this.currentList.army) {
            if (requestedListKeyFromUrl) {
              this.currentList.row.metadata = Object.assign({}, this.currentList.row.metadata || {}, { play_mode: wantPlayNow });
            }
            return this.currentList;
          }
          if (rowObj) {
            if (requestedListKeyFromUrl) {
              rowObj.metadata = Object.assign({}, rowObj.metadata || {}, { play_mode: wantPlayNow });
            }
            if ((rowObj._synthetic_text || rowObj._raw_text) && !rowObj._compiled_by_nr) {
              if (stores.options && typeof stores.options.addInstalledSystemVue === 'function' && rowObj.id_system) {
                stores.options.addInstalledSystemVue(rowObj.id_system);
              }
              await compileSyntheticRowIfNeeded(rowObj, stores.system, stores.list, false);
            }
            var cachedCompiled = rowObj._nr_compiled_list_obj ||
              (rowObj._compiled_by_nr && rowObj.list_key && window.__omniCompiledListByKey && window.__omniCompiledListByKey[String(rowObj.list_key)]);
            if (cachedCompiled && cachedCompiled.army && cachedCompiled.book) {
              cachedCompiled.row = rowObj;
              if (requestedListKeyFromUrl) {
                rowObj.metadata = Object.assign({}, rowObj.metadata || {}, { play_mode: wantPlayNow });
              }
              this.lastSelectFailure = null;
              this.currentList = cachedCompiled;
              return cachedCompiled;
            }
          }
          var res = await origSelectList(rowObj || rowOrKey, opts);
          var activeList = res || ((this.currentList && this.currentList.row && (!rowObj || this.currentList.row.list_key === rowObj.list_key) && this.currentList.army) ? this.currentList : null);
          if (!activeList && rowObj) {
            if (rowObj.booksDate) {
              delete rowObj.booksDate;
              res = await origSelectList(rowObj, opts);
              activeList = res || ((this.currentList && this.currentList.row && this.currentList.row.list_key === rowObj.list_key && this.currentList.army) ? this.currentList : null);
            }
            if (!activeList && (rowObj._synthetic_text || rowObj._raw_text)) {
              rowObj._compiled_by_nr = false;
              await compileSyntheticRowIfNeeded(rowObj, stores.system, stores.list, true);
              res = await origSelectList(rowObj, opts);
              activeList = res || this.currentList;
            }
          }
          if (activeList && activeList.row && requestedListKeyFromUrl) {
            activeList.row.metadata = Object.assign({}, activeList.row.metadata || {}, { play_mode: wantPlayNow });
          }
          try {
            var cl = this.currentList || activeList;
            if (cl && cl.row && cl.army && !cl.row._ephemeral_view && !isEphemeralViewer) {
              var liveArmyPts = typeof cl.army.getPointsCost === 'function' ? cl.army.getPointsCost() : 0;
              if (liveArmyPts > 0 && !isSyntheticTextRow(cl.row, liveArmyPts)) {
                var armyJsonObj = typeof cl.army.toJson === 'function' ? cl.army.toJson() : cl.row.army;
                setRowPointsEverywhere(cl.row, liveArmyPts);
                if (armyJsonObj) cl.row.army = armyJsonObj;
                propagateLivePointsToPiniaAndIdb(cl.row.list_key, liveArmyPts, armyJsonObj);
                setTimeout(function() {
                  syncUpsertRow(cl.row, cl.army, cl.book);
                }, 30);
              }
            }
          } catch (e) {}
          return res;
        };
      }

      if (typeof stores.list.refreshAllListCosts === 'function') {
        var origRefreshCosts = stores.list.refreshAllListCosts.bind(stores.list);
        stores.list.refreshAllListCosts = async function() {
          var res = await origRefreshCosts.apply(this, arguments);
          try {
            if (Array.isArray(this.listData)) {
              for (var i = 0; i < this.listData.length; i++) {
                var r = this.listData[i];
                if (!r || r._ephemeral_view) continue;
                var tcPts = getRowArrayTotalCostsPts(r);
                if (tcPts > 0 && !isSyntheticTextRow(r, tcPts)) {
                  setRowPointsEverywhere(r, tcPts);
                  propagateLivePointsToPiniaAndIdb(r.list_key, tcPts, r.army);
                }
              }
            }
          } catch (e) {}
          setTimeout(function() {
            pollListsDiff();
            if (!isEmbeddedViewer) {
              forceFullSync();
            }
          }, 120);
          return res;
        };
      }

      if (typeof stores.list.doSyncAllLists === 'function') {
        var origDoSyncAll = stores.list.doSyncAllLists.bind(stores.list);
        stores.list.doSyncAllLists = async function() {
          if (isEmbeddedViewer && (isEphemeralViewer || wantPlayModeFromUrl)) {
            return;
          }
          var preservedRows = [];
          try {
            if (Array.isArray(this.listData)) {
              preservedRows = this.listData.filter(function(r) {
                return r && (r._ephemeral_view || (requestedListKeyFromUrl && r.list_key === requestedListKeyFromUrl));
              });
            }
          } catch (e) {}
          var res = await origDoSyncAll.apply(this, arguments);
          try {
            if (preservedRows.length > 0 && Array.isArray(this.listData)) {
              for (var pIdx = 0; pIdx < preservedRows.length; pIdx++) {
                var pr = preservedRows[pIdx];
                if (pr && pr.list_key && !this.listData.some(function(x) { return x && x.list_key === pr.list_key; })) {
                  this.listData.unshift(pr);
                }
              }
            }
          } catch (e) {}
          return res;
        };
      }

      if (typeof stores.list.syncAllLists === 'function') {
        var origSyncAll = stores.list.syncAllLists.bind(stores.list);
        stores.list.syncAllLists = async function() {
          if (isEmbeddedViewer && (isEphemeralViewer || wantPlayModeFromUrl)) {
            return;
          }
          var res = await origSyncAll.apply(this, arguments);
          await purgeTombstonedRowsFromPiniaAndCloud(stores);
          setTimeout(function() {
            pollListsDiff();
            if (!isEmbeddedViewer) {
              forceFullSync();
            }
            try {
              if ((window.location.pathname || '').indexOf('/Login') !== -1 && stores.user && stores.user.user) {
                var rtr = stores.list.$router || (window.$nuxt && window.$nuxt.$router);
                if (rtr) rtr.push('/app/MyLists');
              }
            } catch (e) {}
          }, 180);
          return res;
        };
      }
    }

    if (!initialHydrationDone || activatingPlayMode) return;

    var curPath = window.location.pathname || '';
    var curSearch = window.location.search || '';
    var mPathKey = curPath.match(/\/Lists\/([^\/\?\#]+)/i);
    var targetKey = requestedListKeyFromUrl || ((mPathKey && mPathKey[1]) ? decodeURIComponent(mPathKey[1]) : null);
    var wantPlay = requestedListKeyFromUrl
      ? Boolean(wantPlayModeFromUrl)
      : Boolean(curSearch.indexOf('view=play') !== -1 || curSearch.indexOf('play=1') !== -1);
    var modeToken = targetKey ? (targetKey + ':' + (wantPlay ? 'play' : 'edit')) : null;

    if (!targetKey) {
      hideDirectListLoader(true);
      return;
    }
    var curList = stores.list.currentList;
    var isOnListRoute = curPath.indexOf('/Lists/' + targetKey) !== -1;
    if (playModeActivatedForKey === modeToken && curList && curList.row && curList.row.list_key === targetKey) {
      if (curList.row) {
        curList.row.metadata = Object.assign({}, curList.row.metadata || {}, { play_mode: Boolean(wantPlay) });
      }
      if (stores.listsPage && stores.listsPage.editedList !== curList) {
        stores.listsPage.editedList = curList;
      }
      if (!isOnListRoute) {
        var rtr = stores.list.$router || (window.$nuxt && window.$nuxt.$router);
        if (rtr) {
          try {
            await rtr.replace({
              path: '/app/Lists/' + targetKey,
              query: wantPlay ? { view: 'play' } : {}
            });
          } catch (e) {}
        }
      }
      setTimeout(function() {
        hideDirectListLoader();
        readyNotified = true;
        notifyParent({ action: 'ready', list_key: targetKey });
      }, 40);
      return;
    }

    var myNavGen = navGeneration;
    var hookStartAt = Date.now();
    function isStaleActivation() {
      if (myNavGen !== navGeneration) return true;
      if (requestedListKeyFromUrl && requestedListKeyFromUrl !== targetKey) return true;
      if (!requestedListKeyFromUrl && (window.location.pathname || '').indexOf('/Lists/' + targetKey) === -1) return true;
      if (lastLocalWriteAt[targetKey] && lastLocalWriteAt[targetKey] > hookStartAt) return true;
      return false;
    }

    activatingPlayMode = true;
    try {
      var listArr = Array.isArray(stores.list.listData) ? stores.list.listData : [];
      var targetRow = listArr.find(function(r) { return r && r.list_key === targetKey; }) || null;

      // 1. Seed from pendingNrRowFromParent if targetRow is missing or if viewing an ephemeral roster
      if (
        pendingNrRowFromParent &&
        (pendingNrRowFromParent.list_key === targetKey || (!targetRow && (!pendingNrRowFromParent.list_key || listArr.length === 0)))
      ) {
        var capturedPending = pendingNrRowFromParent;
        pendingNrRowFromParent = null;
        var hasRecentLocalEditOnTarget = Boolean(lastLocalWriteAt[targetKey]);
        var shouldUpsertPending = Boolean(
          !hasRecentLocalEditOnTarget && (
            !targetRow ||
            isEphemeralViewer ||
            capturedPending._ephemeral_view
          )
        );
        if (shouldUpsertPending) {
          var rowToSeed = Object.assign({}, capturedPending);
          if (!rowToSeed.list_key) rowToSeed.list_key = targetKey;
          if (isEphemeralViewer || rowToSeed._ephemeral_view) {
            rowToSeed._ephemeral_view = true;
            rowToSeed.synced = 0;
          }
          rowToSeed.metadata = Object.assign({}, rowToSeed.metadata || {}, { play_mode: Boolean(wantPlay) });
          await upsertSingleRowToIdb(rowToSeed);
          if (isStaleActivation()) {
            return;
          }
          targetRow = Array.isArray(stores.list.listData)
            ? stores.list.listData.find(function(r) { return r && r.list_key === rowToSeed.list_key; })
            : null;
          if (targetRow) {
            targetKey = targetRow.list_key;
            requestedListKeyFromUrl = targetKey;
            modeToken = targetKey + ':' + (wantPlay ? 'play' : 'edit');
          }
        }
      }

      // 2. Fallback: match by list name ONLY for non-ephemeral lists when targetRow was not found by exact key (or was explicitly migrated)
      var searchName = (
        requestedListNameFromUrl ||
        (targetRow && targetRow.name) ||
        (pendingNrRowFromParent && pendingNrRowFromParent.name) ||
        ''
      ).trim().toLowerCase();

      var allowFallbackNameSearch = Boolean(
        !isEphemeralViewer &&
        !(targetRow && targetRow._ephemeral_view) &&
        !(pendingNrRowFromParent && pendingNrRowFromParent._ephemeral_view) &&
        (!targetRow || (targetRow.metadata && targetRow.metadata.migrated_to))
      );

      if (allowFallbackNameSearch && searchName && listArr.length > 0) {
        var nameMatches = listArr.filter(function(r) {
          return r && !r._ephemeral_view && String(r.name || '').trim().toLowerCase() === searchName;
        });
        if (nameMatches.length > 0) {
          nameMatches.sort(function(a, b) {
            var aReal = a._synthetic_text ? 0 : 1;
            var bReal = b._synthetic_text ? 0 : 1;
            if (aReal !== bReal) return bReal - aReal;
            var a11e = (a.id_system == 827374861) ? 1 : 0;
            var b11e = (b.id_system == 827374861) ? 1 : 0;
            if (a11e !== b11e) return b11e - a11e;
            return String(b.date_mod || '').localeCompare(String(a.date_mod || ''));
          });
          if (!targetRow || (targetRow.metadata && targetRow.metadata.migrated_to === nameMatches[0].list_key)) {
            targetRow = nameMatches[0];
            targetKey = targetRow.list_key;
            requestedListKeyFromUrl = targetKey;
            modeToken = targetKey + ':' + (wantPlay ? 'play' : 'edit');
          }
        }
      }

      if (!targetRow) {
        directListLookupRetries++;
        if (directListLookupRetries < 25) {
          return;
        }
        hideDirectListLoader();
        readyNotified = true;
        notifyParent({ action: 'ready' });
        return;
      }

      stores.system.__omniDefaultSysChecked = true;
      try {
        var rtrPre = getNrRouter(stores);
        if (rtrPre && typeof rtrPre.resolve === 'function') {
          var resolvedPre = rtrPre.resolve({
            path: '/app/Lists/' + targetKey,
            query: wantPlay ? { view: 'play' } : {}
          });
          if (resolvedPre && Array.isArray(resolvedPre.matched)) {
            resolvedPre.matched.forEach(function(m) {
              var comps = m && m.components;
              if (comps) {
                Object.keys(comps).forEach(function(ck) {
                  var fn = comps[ck];
                  if (typeof fn === 'function' && !fn.__omniPreloaded) {
                    fn.__omniPreloaded = true;
                    try { fn(); } catch (e) {}
                  }
                });
              }
            });
          }
        }
      } catch (e) {}
      if (stores.options && typeof stores.options.addInstalledSystemVue === 'function' && targetRow.id_system) {
        stores.options.addInstalledSystemVue(targetRow.id_system);
      }
      if (!stores.system.selectedSystem || stores.system.selectedSystem.id != targetRow.id_system) {
        updateDirectListLoaderSubtitle('Selecting game system...');
        await stores.system.selectSystem(targetRow.id_system);
        if (isStaleActivation()) {
          return;
        }
      }
      var rowArmyIdBefore = (targetRow && targetRow.army) ? String(targetRow.army.id || '') : '';
      if (targetRow && targetRow._nr_compile_failed) {
        hideDirectListLoader();
        playModeActivatedForKey = modeToken;
        notifyParent({
          action: 'compile_failed',
          list_key: targetKey,
          name: targetRow.name || '',
          errors: targetRow._nr_compile_errors || []
        });
        return;
      }
      var needsCompile = Boolean(
        targetRow && (targetRow._synthetic_text || targetRow._raw_text) && (
          !targetRow._compiled_by_nr ||
          !targetRow.army ||
          !targetRow.nrversion ||
          rowArmyIdBefore.indexOf('army-') === 0 ||
          rowArmyIdBefore.indexOf('root-') === 0 ||
          rowArmyIdBefore.indexOf('cat-') === 0
        )
      );
      window.__omniPerf = window.__omniPerf || [];
      var pLog = function(lbl) {
        window.__omniPerf.push({ t: Math.round(performance.now()), lbl: lbl });
      };
      pLog('ensure_start:' + targetKey);
      if (needsCompile) {
        pLog('compile_start');
        await compileSyntheticRowIfNeeded(targetRow, stores.system, stores.list, true);
        pLog('compile_end:compiled=' + Boolean(targetRow._compiled_by_nr) + ':hasObj=' + Boolean(targetRow._nr_compiled_list_obj));
        if (isStaleActivation()) {
          return;
        }
        if (targetRow._nr_compile_failed) {
          hideDirectListLoader();
          playModeActivatedForKey = modeToken;
          notifyParent({
            action: 'compile_failed',
            list_key: targetKey,
            name: targetRow.name || '',
            errors: targetRow._nr_compile_errors || []
          });
          return;
        }
      }

      targetRow.metadata = Object.assign({}, targetRow.metadata || {}, { play_mode: Boolean(wantPlay) });

      updateDirectListLoaderSubtitle('Rendering Play Mode view...');
      pLog('selectList_start');
      var loadedListObj = (await stores.list.selectList(targetRow)) || stores.list.currentList;
      pLog('selectList_end:hasArmy=' + Boolean(loadedListObj && loadedListObj.army));
      if (isStaleActivation()) {
        if (!requestedListKeyFromUrl && stores.list.currentList && stores.list.currentList.row && stores.list.currentList.row.list_key === targetKey) {
          stores.list.currentList = null;
        }
        return;
      }
      if (loadedListObj && loadedListObj.row) {
        loadedListObj.row.metadata = Object.assign({}, loadedListObj.row.metadata || {}, { play_mode: Boolean(wantPlay) });
      }
      if (loadedListObj) {
        patchArmyAndBookForFastPlayMode(loadedListObj.army, loadedListObj.book, loadedListObj.row);
      }
      stores.list.lastSelectedListKey = targetKey;
      var freshStores = getNrStores();
      if (freshStores && !freshStores.listsPage && stores.system && stores.system._p) {
        try {
          var lpMod = await import('/_nuxt/D7n9-sfm.js');
          if (lpMod && typeof lpMod.u === 'function') {
            var lpInst = lpMod.u(stores.system._p);
            if (lpInst) {
              if (globalThis.__nr_stores) globalThis.__nr_stores.listsPage = lpInst;
              freshStores.listsPage = lpInst;
            }
          }
        } catch (e) {}
      }
      if (freshStores && freshStores.listsPage && loadedListObj) {
        freshStores.listsPage.addUnitCollapsed = Boolean(wantPlay);
        freshStores.listsPage.editedList = loadedListObj;
      }

      var router = getNrRouter(stores);
      var nowPath = window.location.pathname || '';
      pLog('router_replace_start:' + nowPath + ':hasLp=' + Boolean(freshStores && freshStores.listsPage));
      if (router && !isStaleActivation()) {
        if (nowPath.indexOf('/Lists/' + targetKey) === -1) {
          await router.replace({
            path: '/app/Lists/' + targetKey,
            query: wantPlay ? { view: 'play' } : {}
          });
        } else if (wantPlay && (window.location.search || '').indexOf('view=play') === -1) {
          await router.replace({
            path: '/app/Lists/' + targetKey,
            query: { view: 'play' }
          });
        } else if (!wantPlay && (window.location.search || '').indexOf('view=play') !== -1) {
          await router.replace({
            path: '/app/Lists/' + targetKey,
            query: {}
          });
        }
      }
      pLog('router_replace_end:' + (window.location.pathname || ''));
      if (isStaleActivation()) {
        return;
      }
      var postNavStores = getNrStores();
      if (postNavStores && postNavStores.listsPage && loadedListObj) {
        if (loadedListObj.row) {
          loadedListObj.row.metadata = Object.assign({}, loadedListObj.row.metadata || {}, { play_mode: Boolean(wantPlay) });
        }
        postNavStores.listsPage.addUnitCollapsed = Boolean(wantPlay);
        postNavStores.listsPage.editedList = loadedListObj;
      }
      playModeActivatedForKey = modeToken;
      var finishReadyRetries = 0;
      function finishWhenDomMounted() {
        if (isStaleActivation()) return;
        finishReadyRetries++;
        var sAfter = getNrStores();
        if (sAfter && sAfter.listsPage && loadedListObj) {
          if (loadedListObj.row) {
            loadedListObj.row.metadata = Object.assign({}, loadedListObj.row.metadata || {}, { play_mode: Boolean(wantPlay) });
          }
          sAfter.listsPage.addUnitCollapsed = Boolean(wantPlay);
          sAfter.listsPage.editedList = loadedListObj;
        }
        var hasPlayDom = Boolean(document.querySelector('.tableList, .listControls, .armyList'));
        if (!hasPlayDom && finishReadyRetries < 100) {
          setTimeout(finishWhenDomMounted, 5);
          return;
        }
        pLog('finish_ready:retries=' + finishReadyRetries + ':hasPlayDom=' + hasPlayDom);
        hideDirectListLoader();
        readyNotified = true;
        notifyParent({ action: 'ready', list_key: targetKey });
      }
      setTimeout(finishWhenDomMounted, 5);

      // Compute native army exports asynchronously in background after Play Mode is already visible
      if (!targetRow._ephemeral_view && !isEphemeralViewer && loadedListObj && loadedListObj.army && (!targetRow._omnitactica_gw_text || !targetRow._omnitactica_nr_text)) {
        setTimeout(async function() {
          try {
            if (isStaleActivation()) return;
            await attachNativeArmyExports(targetRow, loadedListObj.army);
            if (isStaleActivation()) return;
            if (targetRow._omnitactica_gw_text || targetRow._omnitactica_nr_text) {
              notifyParent({
                action: 'native_exports',
                list_key: targetKey,
                gw_text: targetRow._omnitactica_gw_text || '',
                nr_text: targetRow._omnitactica_nr_text || ''
              });
              var cleanWithExp = cloneCleanRow(targetRow, loadedListObj.army, loadedListObj.book);
              if (cleanWithExp && !cleanWithExp._ephemeral_view) {
                cleanWithExp._omnitactica_gw_text = targetRow._omnitactica_gw_text || '';
                cleanWithExp._omnitactica_nr_text = targetRow._omnitactica_nr_text || '';
                knownListsMap[targetKey] = computeSignature(cleanWithExp);
                postSyncAction('upsert', { list: cleanWithExp });
              }
            }
          } catch (e) {}
        }, 250);
      }
    } catch (err) {
      console.warn('[OmniTactica Bridge] Play Mode activation notice:', err);
      hideDirectListLoader();
    } finally {
      activatingPlayMode = false;
    }
  }

  function getNrRouter(stores) {
    try {
      if (stores && stores.list && stores.list.$router) return stores.list.$router;
      if (window.$nuxt && window.$nuxt.$router) return window.$nuxt.$router;
      var nuxtRoot = document.getElementById('__nuxt');
      if (nuxtRoot && nuxtRoot.__vue_app__ && nuxtRoot.__vue_app__.config && nuxtRoot.__vue_app__.config.globalProperties) {
        return nuxtRoot.__vue_app__.config.globalProperties.$router || null;
      }
    } catch (e) {}
    return null;
  }

  // 5. Snapshot diff watcher to catch any edits or imports across Pinia listData & IndexedDB
  // Note: Deletions are handled explicitly by stores.list.removeList and deleteHubArmyList, never by polling diff!
  async function pollListsDiff() {
    await ensurePlayModeAndStoreHooks();
    if (!initialHydrationDone || isHydrating || isEphemeralViewer) return;
    var rows = await readAllNrLists();
    if (!rows) return;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !r.list_key || r._ephemeral_view) continue;
      if (isEmbeddedViewer && requestedListKeyFromUrl && r.list_key !== requestedListKeyFromUrl) continue;
      var clean = cloneCleanRow(r);
      var sig = computeSignature(clean || r);
      if (knownListsMap[r.list_key] !== sig) {
        await syncUpsertRow(clean || r);
      }
    }
  }

  async function forceFullSync(reconcileDeletions) {
    if (isEmbeddedViewer || isEphemeralViewer) return null;
    if (!initialHydrationDone) {
      await hydrateFromOmniTactica();
    }
    var st = getNrStores();
    try {
      var isNrCloudLogged = Boolean(
        (st && st.user && st.user.user && st.user.user.login) ||
        localStorage.getItem('access')
      );
      if (isNrCloudLogged && st && st.list && typeof st.list.whenSynced === 'function') {
        await Promise.race([
          st.list.whenSynced(),
          new Promise(function(r) { setTimeout(r, 2500); })
        ]);
      }
    } catch (e) {}
    if (st) {
      await purgeTombstonedRowsFromPiniaAndCloud(st);
    }
    var rows = await readAllNrLists();
    if (!rows) return null;
    var cleaned = rows.filter(function(r) { return r && !r._ephemeral_view && !isTombstonedNrRow(r); }).map(function(r) { return cloneCleanRow(r); }).filter(Boolean);
    if (cleaned.length === 0 && !(st && st.list && st.list.listsInitiated)) {
      return null;
    }
    for (var cIdx = 0; cIdx < cleaned.length; cIdx++) {
      await attachNativeArmyExports(cleaned[cIdx]);
    }
    knownListsMap = {};
    cleaned.forEach(function(r) {
      knownListsMap[r.list_key] = computeSignature(r);
    });
    return await postSyncAction('bulk_sync', {
      lists: cleaned,
      reconcile_deletions: Boolean(reconcileDeletions)
    });
  }

  window.__omnitacticaNrBridge = {
    forceFullSync: forceFullSync,
    pollListsDiff: pollListsDiff,
    hydrateFromOmniTactica: hydrateFromOmniTactica,
    ensurePlayModeAndStoreHooks: ensurePlayModeAndStoreHooks,
    getNrStores: getNrStores,
    readAllNrLists: readAllNrLists,
    attachNativeArmyExports: attachNativeArmyExports,
    compileSyntheticRowIfNeeded: compileSyntheticRowIfNeeded,
    upsertSingleRowToIdb: upsertSingleRowToIdb,
    propagateLivePointsToPiniaAndIdb: propagateLivePointsToPiniaAndIdb
  };

  window.addEventListener('message', async function(ev) {
    var msg = ev && ev.data;
    if (!msg || msg.type !== 'OMNITACTICA_NR_COMMAND') return;
    if (msg.command === 'force_sync') {
      await forceFullSync(msg.reconcile_deletions);
    } else if (msg.command === 'export_list_texts') {
      var expKey = String(msg.list_key || '').replace(/^(nr_|list_)/, '').trim();
      var stExp = getNrStores();
      var expRow = null;
      var isSavedInPinia = false;
      if (stExp && stExp.list && Array.isArray(stExp.list.listData)) {
        expRow = stExp.list.listData.find(function(r) { return r && r.list_key === expKey && !r._ephemeral_view; }) || null;
        if (expRow) isSavedInPinia = true;
      }
      if (!expRow && msg.nr_row && typeof msg.nr_row === 'object') {
        expRow = Object.assign({}, msg.nr_row);
        if (!expRow.list_key && expKey) expRow.list_key = expKey;
      }
      var isEphemeralExport = Boolean(
        msg.ephemeral ||
        isEphemeralViewer ||
        (msg.nr_row && msg.nr_row._ephemeral_view) ||
        (expRow && expRow._ephemeral_view) ||
        !isSavedInPinia
      );
      if (expRow) {
        if (isEphemeralExport) {
          expRow._ephemeral_view = true;
        }
        var cleanExp = cloneCleanRow(expRow) || expRow;
        await attachNativeArmyExports(cleanExp);
        if (cleanExp._omnitactica_gw_text || cleanExp._omnitactica_nr_text) {
          expRow._omnitactica_gw_text = cleanExp._omnitactica_gw_text || '';
          expRow._omnitactica_nr_text = cleanExp._omnitactica_nr_text || '';
          notifyParent({
            action: 'native_exports',
            list_key: cleanExp.list_key || expKey,
            gw_text: cleanExp._omnitactica_gw_text || '',
            nr_text: cleanExp._omnitactica_nr_text || ''
          });
          if (!isEphemeralExport && !expRow._ephemeral_view && !cleanExp._ephemeral_view) {
            postSyncAction('upsert', { list: cleanExp });
          }
        }
      }
    } else if (msg.command === 'delete_list' && (msg.list_key || msg.list_name)) {
      var delKey = String(msg.list_key || '').replace(/^(nr_|list_)/, '').trim();
      var delNameLow = msg.list_name ? String(msg.list_name).trim().toLowerCase() : '';
      var extraPurge = Array.isArray(msg.keys_to_purge) ? msg.keys_to_purge : [];
      addNrDeletedTombstone(delKey, delNameLow, extraPurge);
      if (delKey) delete knownListsMap[delKey];
      if (pendingNrRowFromParent && (pendingNrRowFromParent.list_key === delKey || (!delKey && delNameLow && String(pendingNrRowFromParent.name || '').trim().toLowerCase() === delNameLow))) {
        pendingNrRowFromParent = null;
      }
      var stDel = getNrStores();
      var keysToPurge = delKey ? [delKey] : [];
      for (var epIdx = 0; epIdx < extraPurge.length; epIdx++) {
        var epKey = String(extraPurge[epIdx] || '').replace(/^(nr_|list_)/, '').trim();
        if (epKey && keysToPurge.indexOf(epKey) === -1) keysToPurge.push(epKey);
      }
      if (stDel && stDel.list && Array.isArray(stDel.list.listData)) {
        var matchingRows = stDel.list.listData.filter(function(x) {
          if (!x) return false;
          if (delKey && x.list_key === delKey) return true;
          if (x.list_key && keysToPurge.indexOf(x.list_key) !== -1) return true;
          if (x.metadata && x.metadata.migrated_to && (x.metadata.migrated_to === delKey || keysToPurge.indexOf(x.metadata.migrated_to) !== -1)) return true;
          if (!delKey && delNameLow && String(x.name || '').trim().toLowerCase() === delNameLow) return true;
          return false;
        });
        for (var mIdx = 0; mIdx < matchingRows.length; mIdx++) {
          var rowToDel = matchingRows[mIdx];
          if (rowToDel.list_key && keysToPurge.indexOf(rowToDel.list_key) === -1) {
            keysToPurge.push(rowToDel.list_key);
          }
          if (rowToDel.metadata && rowToDel.metadata.migrated_to && keysToPurge.indexOf(rowToDel.metadata.migrated_to) === -1) {
            keysToPurge.push(rowToDel.metadata.migrated_to);
          }
          delete knownListsMap[rowToDel.list_key];
          try {
            if (stDel.list.currentList && stDel.list.currentList.row && stDel.list.currentList.row.list_key === rowToDel.list_key) {
              stDel.list.currentList = null;
            }
            if (stDel.listsPage && stDel.listsPage.editedList && stDel.listsPage.editedList.row && stDel.listsPage.editedList.row.list_key === rowToDel.list_key) {
              stDel.listsPage.editedList = null;
            }
          } catch (e) {}
          var prevH1 = isHydrating;
          isHydrating = true;
          try {
            // Safely splice only matching indices (where dIdx !== -1) — never call stDel.list.removeList here!
            var dIdx = stDel.list.listData.findIndex(function(x) { return x && x.list_key === rowToDel.list_key; });
            while (dIdx !== -1) {
              stDel.list.listData.splice(dIdx, 1);
              dIdx = stDel.list.listData.findIndex(function(x) { return x && x.list_key === rowToDel.list_key; });
            }
            if (stDel.user && stDel.user.user && typeof stDel.list.deleteListFromServer === 'function') {
              try { await stDel.list.deleteListFromServer(rowToDel); } catch (e) { await deleteKeyFromNrServerRpc(rowToDel.list_key); }
            } else {
              await deleteKeyFromNrServerRpc(rowToDel.list_key);
            }
          } catch (e) {} finally {
            isHydrating = prevH1;
          }
        }
        try { if (typeof stDel.list.rebuildTreeData === 'function') stDel.list.rebuildTreeData(); } catch (e) {}
      }
      addNrDeletedTombstone(delKey, delNameLow, keysToPurge);
      for (var kpIdx = 0; kpIdx < keysToPurge.length; kpIdx++) {
        await deleteKeyFromNrServerRpc(keysToPurge[kpIdx]);
      }
      var db = await openExistingNrDb();
      if (db) {
        var prevH = isHydrating;
        isHydrating = true;
        await new Promise(function(resolve) {
          var done = false;
          var finish = function() {
            if (done) return;
            done = true;
            isHydrating = prevH;
            resolve();
          };
          setTimeout(finish, 800);
          try {
            var tx = db.transaction('lists', 'readwrite');
            var store = tx.objectStore('lists');
            var curReq = store.openCursor();
            curReq.onsuccess = function(evCur) {
              var cursor = evCur.target.result;
              if (cursor) {
                var rVal = cursor.value;
                if (rVal && (keysToPurge.indexOf(String(rVal.list_key || '')) !== -1 || (!delKey && delNameLow && String(rVal.name || '').trim().toLowerCase() === delNameLow))) {
                  try { cursor.delete(); } catch (e) {}
                }
                cursor.continue();
              }
            };
            tx.oncomplete = finish;
            tx.onerror = finish;
          } catch (e) { finish(); }
        });
      }
    } else if (msg.command === 'open_play_mode' && msg.list_key) {
      var nextKey = String(msg.list_key);
      var nextPlay = msg.play !== false;
      var nextToken = nextKey + ':' + (nextPlay ? 'play' : 'edit');
      if (msg.ephemeral || (msg.nr_row && msg.nr_row._ephemeral_view)) {
        isEphemeralViewer = true;
        if (msg.nr_row) {
          msg.nr_row._ephemeral_view = true;
          msg.nr_row.synced = 0;
        }
      } else if (isEphemeralViewer && msg.nr_row) {
        msg.nr_row._ephemeral_view = true;
        msg.nr_row.synced = 0;
      }
      var stOpen = getNrStores();
      if (window.__omniCompileFailedForKey === nextKey) {
        hideDirectListLoader();
        notifyParent({
          action: 'compile_failed',
          list_key: nextKey,
          name: msg.list_name || (msg.nr_row && msg.nr_row.name) || ''
        });
        return;
      }
      if (playModeActivatedForKey === nextToken && stOpen && stOpen.list && stOpen.list.currentList && stOpen.list.currentList.row && stOpen.list.currentList.row.list_key === nextKey) {
        hideDirectListLoader();
        notifyParent({ action: 'ready', list_key: nextKey });
        return;
      }
      if ((activatingPlayMode || compilingKeys[nextKey] || !initialHydrationDone) && requestedListKeyFromUrl === nextKey && wantPlayModeFromUrl === nextPlay) {
        if (msg.nr_row && msg.nr_row.list_key && !pendingNrRowFromParent) {
          pendingNrRowFromParent = Object.assign({}, msg.nr_row);
          if (isEphemeralViewer) {
            pendingNrRowFromParent._ephemeral_view = true;
            pendingNrRowFromParent.synced = 0;
          }
        }
        return;
      }
      navGeneration++;
      requestedListKeyFromUrl = nextKey;
      if (msg.list_name) {
        requestedListNameFromUrl = String(msg.list_name).trim();
      } else if (msg.nr_row && msg.nr_row.name) {
        requestedListNameFromUrl = String(msg.nr_row.name).trim();
      }
      wantPlayModeFromUrl = nextPlay;
      playModeActivatedForKey = null;
      directListLookupRetries = 0;
      showDirectListLoader(wantPlayModeFromUrl ? 'Loading Play Mode Datasheets...' : 'Opening Army Roster...');
      if (msg.nr_row && msg.nr_row.list_key) {
        var cur = null;
        if (stOpen && stOpen.list && Array.isArray(stOpen.list.listData)) {
          cur = stOpen.list.listData.find(function(er) {
            return er && er.list_key === msg.nr_row.list_key;
          }) || null;
          if (!cur && !isEphemeralViewer && requestedListNameFromUrl) {
            cur = stOpen.list.listData.find(function(er) {
              return er && !er._ephemeral_view && String(er.name || '').trim().toLowerCase() === requestedListNameFromUrl.toLowerCase();
            }) || null;
          }
        }
        if (!cur && !isEphemeralViewer) {
          var existingRows = await readAllNrLists();
          var existingMap = {};
          var existingByName = {};
          (existingRows || []).forEach(function(er) {
            if (er && er.list_key) {
              existingMap[er.list_key] = er;
              if (er.name) existingByName[String(er.name).trim().toLowerCase()] = er;
            }
          });
          cur = existingMap[msg.nr_row.list_key] || (requestedListNameFromUrl ? existingByName[requestedListNameFromUrl.toLowerCase()] : null);
        }
        if (!cur || isEphemeralViewer || msg.nr_row._ephemeral_view) {
          pendingNrRowFromParent = Object.assign({}, msg.nr_row);
          if (isEphemeralViewer) {
            pendingNrRowFromParent._ephemeral_view = true;
            pendingNrRowFromParent.synced = 0;
          }
        }
        if (!cur) {
          var rowToWrite = Object.assign({}, msg.nr_row);
          if (isEphemeralViewer) {
            rowToWrite._ephemeral_view = true;
            rowToWrite.synced = 0;
          }
          rowToWrite.metadata = Object.assign({}, rowToWrite.metadata || {}, { play_mode: Boolean(wantPlayModeFromUrl) });
          await upsertSingleRowToIdb(rowToWrite);
        } else {
          if (!cur._synthetic_text && msg.nr_row._synthetic_text) {
            cur._synthetic_text = msg.nr_row._synthetic_text;
          }
          if (!cur._raw_text && msg.nr_row._raw_text) {
            cur._raw_text = msg.nr_row._raw_text;
          }
          if (!cur._omnitactica_book_name && msg.nr_row._omnitactica_book_name) {
            cur._omnitactica_book_name = msg.nr_row._omnitactica_book_name;
          }
        }
      }
      await ensurePlayModeAndStoreHooks();
    } else if (msg.command === 'select_system' && msg.id_system) {
      try {
        navGeneration++;
        var nextSysId = Number(msg.id_system);
        if (!nextSysId) return;
        preferredStudioSystemId = nextSysId;
        requestedListKeyFromUrl = null;
        playModeActivatedForKey = null;
        hideDirectListLoader(true);
        var stSys = getNrStores();
        var addListPopupWasOpen = Boolean(document.querySelector('[data-v-9ccd5431], .addListPopup, .popup_bg .createList'));
        if (stSys && stSys.system) {
          if (stSys.options && typeof stSys.options.addInstalledSystemVue === 'function') {
            try { stSys.options.addInstalledSystemVue(nextSysId); } catch (e) {}
          }
          await stSys.system.selectSystem(nextSysId);
          if (stSys.list && typeof stSys.list.rebuildTreeData === 'function') {
            try { stSys.list.rebuildTreeData(); } catch (e) {}
          }
        }
        var curSysPath = window.location.pathname || '';
        if (msg.return_to_mylists !== false && curSysPath.indexOf('/Lists/') !== -1) {
          var rtrSys = getNrRouter(stSys);
          if (rtrSys) {
            await rtrSys.push('/app/MyLists');
          }
        }
        if (addListPopupWasOpen) {
          var closeBtn = document.querySelector('.popup_bg .close_btn, .popup_bg button.close, .popup_bg .cross');
          if (closeBtn) {
            try { closeBtn.click(); } catch (e) {}
          }
          setTimeout(function() {
            var cBtn = document.querySelector('button.createToolbarBtn') || document.querySelector('button.createFab');
            if (cBtn && !document.querySelector('[data-v-9ccd5431]')) {
              try { cBtn.click(); } catch (e) {}
            }
          }, 120);
        }
      } catch (e) {}
    } else if (msg.command === 'navigate' && msg.path) {
      try {
        navGeneration++;
        var cleanTarget = String(msg.path).replace(/^\/nr\/app/, '/app');
        if (msg.id_system) {
          preferredStudioSystemId = Number(msg.id_system) || preferredStudioSystemId;
        }
        var mNavSys = cleanTarget.match(/[?&]sys_id=(\d+)/i);
        if (mNavSys && mNavSys[1]) {
          preferredStudioSystemId = Number(mNavSys[1]) || preferredStudioSystemId;
        }
        var mNavName = cleanTarget.match(/[?&]name=([^&#]+)/i);
        if (mNavName && mNavName[1]) {
          try { requestedListNameFromUrl = decodeURIComponent(mNavName[1]).trim(); } catch (e) {}
        } else if (msg.list_name) {
          requestedListNameFromUrl = String(msg.list_name).trim();
        } else {
          requestedListNameFromUrl = '';
        }
        if (msg.nr_row && msg.nr_row.list_key) {
          pendingNrRowFromParent = Object.assign({}, msg.nr_row);
        }
        var mNavList = cleanTarget.match(/\/Lists\/([^\/\?\#]+)/i);
        if (mNavList && mNavList[1]) {
          requestedListKeyFromUrl = decodeURIComponent(mNavList[1]);
          wantPlayModeFromUrl = cleanTarget.indexOf('view=play') !== -1;
          playModeActivatedForKey = null;
          directListLookupRetries = 0;
          showDirectListLoader(wantPlayModeFromUrl ? 'Loading Play Mode Datasheets...' : 'Opening Army Roster...');
          await ensurePlayModeAndStoreHooks();
          return;
        }
        requestedListKeyFromUrl = null;
        playModeActivatedForKey = null;
        hideDirectListLoader(true);
        var storesNav = getNrStores();
        var isMyListsTarget = /^\/app\/Lists(?:\?.*)?$/i.test(cleanTarget) || /^\/app\/MyLists(?:\?.*)?$/i.test(cleanTarget);
        if (isMyListsTarget) {
          cleanTarget = '/app/MyLists';
          if (storesNav && storesNav.list) {
            storesNav.list.currentList = null;
          }
          if (storesNav && storesNav.listsPage) {
            storesNav.listsPage.editedList = null;
          }
        }
        var curNavPath = (window.location.pathname || '').replace(/^\/nr\/app/, '/app');
        if (curNavPath !== cleanTarget) {
          var rtrNav = getNrRouter(storesNav);
          if (rtrNav) {
            await rtrNav.push(cleanTarget);
          } else {
            window.location.href = '/nr' + cleanTarget;
            return;
          }
        }
        if (preferredStudioSystemId && storesNav && storesNav.system) {
          if (storesNav.options && typeof storesNav.options.addInstalledSystemVue === 'function') {
            try { storesNav.options.addInstalledSystemVue(preferredStudioSystemId); } catch (e) {}
          }
          if (!storesNav.system.selectedSystem || storesNav.system.selectedSystem.id != preferredStudioSystemId) {
            await storesNav.system.selectSystem(preferredStudioSystemId);
            if (storesNav.list && typeof storesNav.list.rebuildTreeData === 'function') {
              try { storesNav.list.rebuildTreeData(); } catch (e) {}
            }
          }
        }
        if (isMyListsTarget) {
          hydrateFromOmniTactica(true).catch(function() {});
        }
      } catch (e) {}
    } else if (msg.command === 'create_list') {
      try {
        navGeneration++;
        requestedListKeyFromUrl = null;
        playModeActivatedForKey = null;
        hideDirectListLoader(true);
        if (msg.id_system) {
          preferredStudioSystemId = Number(msg.id_system) || preferredStudioSystemId;
        }
        var stCreate = getNrStores();
        if (stCreate && stCreate.system) {
          var sysList = (stCreate.system.library && Array.isArray(stCreate.system.library.array))
            ? stCreate.system.library.array
            : [];
          var curSys = stCreate.system.selectedSystem;
          var wantCreateSysId = Number(msg.id_system) || Number(preferredStudioSystemId) || (curSys && Number(curSys.id)) || getDefaultSystemIdForOmniGameSystem();
          if (!curSys || Number(curSys.id) !== wantCreateSysId) {
            var defSys = sysList.find(function(s) { return s && s.id == wantCreateSysId; }) ||
                         sysList.find(function(s) { return s && s.id == getDefaultSystemIdForOmniGameSystem(); }) ||
                         sysList[0];
            if (defSys) {
              if (stCreate.options && typeof stCreate.options.addInstalledSystemVue === 'function') {
                try { stCreate.options.addInstalledSystemVue(defSys.id); } catch (e) {}
              }
              await stCreate.system.selectSystem(defSys.id);
              if (stCreate.list && typeof stCreate.list.rebuildTreeData === 'function') {
                try { stCreate.list.rebuildTreeData(); } catch (e) {}
              }
            }
          }
        }
        var curP = window.location.pathname || '';
        if (curP.indexOf('/MyLists') === -1) {
          var rtrCreate = getNrRouter(stCreate);
          if (rtrCreate) {
            await rtrCreate.push('/app/MyLists');
            await new Promise(function(r) { setTimeout(r, 180); });
          }
        }
        var triggerCreateBtn = function() {
          var btn = document.querySelector('button.createToolbarBtn') ||
                    document.querySelector('button.createFab') ||
                    document.querySelector('.menu.mainMenu a.hideOnSmallScreen[href="#"]');
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        };
        if (!triggerCreateBtn()) {
          setTimeout(triggerCreateBtn, 220);
        }
      } catch (e) {}
    } else if (msg.command === 'toggle_auth') {
      try {
        requestedListKeyFromUrl = null;
        hideDirectListLoader(true);
        var stAuth = getNrStores();
        var rtrAuth = getNrRouter(stAuth);
        var isLoggedNow = Boolean(stAuth && stAuth.user && stAuth.user.user && stAuth.user.user.login);
        if (isLoggedNow || msg.force_logout) {
          window.__omniExplicitLogout = true;
          try {
            localStorage.removeItem(AUTH_BACKUP_KEY);
            localStorage.removeItem('access');
            localStorage.removeItem('refresh');
          } catch (e) {}
          if (stAuth && stAuth.user && typeof stAuth.user.logout === 'function') {
            try { await stAuth.user.logout(); } catch (e) {}
          }
          if (stAuth && stAuth.user) {
            stAuth.user.user = null;
            stAuth.user.__omniLastLoginNotified = '';
          }
          notifyParent({
            action: 'auth_status',
            logged_in: false,
            login: '',
            path: '/app/Login'
          });
          if (rtrAuth) {
            await rtrAuth.push('/app/Login');
          } else {
            window.location.href = '/nr/app/Login';
          }
        } else {
          window.__omniExplicitLogout = false;
          var nowAuthPath = window.location.pathname || '';
          var nextAuthPath = (nowAuthPath.indexOf('/Login') !== -1 && !msg.force_login) ? '/app/MyLists' : '/app/Login';
          if (rtrAuth) {
            await rtrAuth.push(nextAuthPath);
          } else {
            window.location.href = '/nr' + nextAuthPath;
          }
        }
      } catch (e) {}
    }
  });

  // Fast 25ms early hook to unlock Supporter mode and store hooks as soon as Pinia initializes
  var earlyHookCount = 0;
  var earlyHookTimer = setInterval(function() {
    earlyHookCount++;
    var s = getNrStores();
    if (s && s.user) {
      try { s.user.isSupporter = function() { return true; }; } catch (e) {}
      if (s.options) applyOmniNrDarkTheme(s.options);
      backupOrRestoreNrAuth(s.user);
      if (s.list && isEmbeddedViewer && (isEphemeralViewer || wantPlayModeFromUrl) && !s.list.__omniStubbedCloudSync) {
        s.list.__omniStubbedCloudSync = true;
        s.list.syncAllLists = async function() { return; };
        s.list.doSyncAllLists = async function() { return; };
      }
      if (s.list && s.list.listsInitiated) {
        ensurePlayModeAndStoreHooks();
        clearInterval(earlyHookTimer);
      }
    }
    if (earlyHookCount > 400) {
      clearInterval(earlyHookTimer);
    }
  }, isFastPlayViewer ? 10 : 25);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(hydrateFromOmniTactica, isFastPlayViewer ? 0 : 15);
    });
  } else {
    setTimeout(hydrateFromOmniTactica, isFastPlayViewer ? 0 : 15);
  }

  setInterval(pollListsDiff, 900);
})();
</script>
"""


def inject_nr_bridge_into_html(html: str) -> str:
    """Injects the OmniTactica <-> NewRecruit IndexedDB live sync & Play Mode bridge script at the top of <head> and strips 3rd-party tracker tags."""
    if "omnitactica-nr-bridge" in html:
        return html
    # Strip Google Tag Manager script tags from the shell HTML so the browser never requests them
    html = re.sub(r"<script[^>]+googletagmanager[^>]*></script>", "", html, flags=re.IGNORECASE)
    if "<head>" in html:
        return html.replace("<head>", "<head>" + OMNITACTICA_NR_BRIDGE_SCRIPT, 1)
    if "<head " in html:
        m = re.search(r"<head[^>]*>", html, re.IGNORECASE)
        if m:
            idx = m.end()
            return html[:idx] + OMNITACTICA_NR_BRIDGE_SCRIPT + html[idx:]
    return OMNITACTICA_NR_BRIDGE_SCRIPT + html


def fetch_nr_html_shell() -> str:
    """Fetches and caches NewRecruit's SPA HTML shell from data/nr_offline_bundle.zip (or upstream fallback) and injects the OmniTactica bridge."""
    global _NR_HTML_SHELL_CACHE
    now = time.time()
    if _NR_HTML_SHELL_CACHE and (now - _NR_HTML_SHELL_CACHE[0] < _NR_CACHE_TTL_SECONDS):
        return _NR_HTML_SHELL_CACHE[1]

    # Primary source: local offline bundle (zero latency, zero dependency on Cloud Run outbound TCP to www.newrecruit.eu)
    bundled_shell = _read_nr_offline_entry("shell.html")
    if bundled_shell:
        raw_html = bundled_shell.decode("utf-8", errors="ignore")
        injected = inject_nr_bridge_into_html(raw_html)
        _NR_HTML_SHELL_CACHE = (now, injected)
        return injected

    try:
        req = urllib.request.Request(
            f"{NR_BASE_URL}/app/Lists",
            headers={
                "User-Agent": NR_USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        )
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            raw_html = resp.read().decode("utf-8", errors="ignore")

        injected = inject_nr_bridge_into_html(raw_html)
        _NR_HTML_SHELL_CACHE = (now, injected)
        return injected
    except Exception as e:
        logger.warning("Notice fetching upstream NewRecruit HTML shell: %s", e)
        if _NR_HTML_SHELL_CACHE:
            return _NR_HTML_SHELL_CACHE[1]
        return inject_nr_bridge_into_html("<!DOCTYPE html><html><head><meta charset='utf-8'><title>NewRecruit Studio</title></head><body><div id='__nuxt'></div></body></html>")


_NR_DIRECT_BLOCKED_UNTIL: float = 0.0
_NR_INFLIGHT_LOCK_GUARD = threading.Lock()
_NR_INFLIGHT_LOCKS: Dict[str, threading.Lock] = {}


def _get_inflight_lock(key: str) -> threading.Lock:
    with _NR_INFLIGHT_LOCK_GUARD:
        lk = _NR_INFLIGHT_LOCKS.get(key)
        if lk is None:
            if len(_NR_INFLIGHT_LOCKS) > 256:
                _NR_INFLIGHT_LOCKS.clear()
            lk = threading.Lock()
            _NR_INFLIGHT_LOCKS[key] = lk
        return lk


def _exec_http_request(
    method_up: str,
    url: str,
    body: Optional[bytes],
    headers: Dict[str, str],
    connect_timeout: float = 2.5,
    read_timeout: float = 6.0,
    retries: Optional[Any] = None,
) -> Tuple[int, bytes, str]:
    """Executes an outbound HTTP request via urllib3 pool or urllib.request with gzip support."""
    req_headers = dict(headers)
    req_headers.setdefault("Accept-Encoding", "gzip")
    if _NR_HTTP_POOL is not None:
        req_kwargs: Dict[str, Any] = {
            "body": body if method_up != "GET" else None,
            "headers": req_headers,
            "timeout": urllib3.Timeout(connect_timeout, read=read_timeout),
        }
        if retries is not None:
            req_kwargs["retries"] = retries
        resp = _NR_HTTP_POOL.request(method_up, url, **req_kwargs)
        return (
            int(resp.status),
            bytes(resp.data or b""),
            resp.headers.get("Content-Type", "application/octet-stream"),
        )
    req = urllib.request.Request(url, data=body if method_up != "GET" else None, headers=req_headers, method=method_up)
    with urllib.request.urlopen(req, timeout=connect_timeout + read_timeout) as uresp:
        raw_bytes = uresp.read()
        if uresp.headers.get("Content-Encoding", "").lower() == "gzip":
            import gzip
            raw_bytes = gzip.decompress(raw_bytes)
        return (
            int(uresp.status),
            raw_bytes,
            uresp.headers.get("Content-Type", "application/octet-stream"),
        )


def _forward_via_nr_relay(
    clean_path: str,
    method_up: str,
    body: Optional[bytes],
    upstream_headers: Dict[str, str],
) -> Optional[Tuple[int, bytes, str]]:
    """
    Fallback for unauthenticated GET-compatible NewRecruit RPCs (login, login_from_email, getUser, resetPassword)
    when direct outbound requests are rate-limited by www.newrecruit.eu.
    """
    if method_up == "POST" and clean_path.startswith("/api/rpc") and body and not upstream_headers.get("Authorization"):
        try:
            rpc_obj = json.loads(body.decode("utf-8", errors="ignore"))
            rpc_m = str(rpc_obj.get("method") or "") if isinstance(rpc_obj, dict) else ""
            rpc_params = rpc_obj.get("params") if isinstance(rpc_obj, dict) else None
            if rpc_m in ("login", "login_from_email", "getUser", "resetPassword") and isinstance(rpc_params, list):
                q_parts = [f"p0={urllib.parse.quote(rpc_m, safe='')}"]
                for idx, p_val in enumerate(rpc_params, start=1):
                    q_parts.append(f"p{idx}={urllib.parse.quote(str(p_val), safe='')}")
                nr_get_url = f"https://www.newrecruit.eu/api/rpc?{'&'.join(q_parts)}"
                ao_url = f"https://api.allorigins.win/raw?url={urllib.parse.quote(nr_get_url, safe='')}"
                ao_status, ao_data, _ = _exec_http_request(
                    "GET",
                    ao_url,
                    None,
                    {"User-Agent": NR_USER_AGENT, "Accept": "application/json"},
                    connect_timeout=3.5,
                    read_timeout=7.0,
                )
                if ao_status == 200 and ao_data is not None:
                    return 200, ao_data, "application/json"
        except Exception as e:
            logger.warning("NR GET RPC fallback error for %s: %s", clean_path, e)

    return None


def _decode_jwt_user_fallback(auth_header: Optional[str]) -> Optional[bytes]:
    """Decodes a NewRecruit JWT token payload as a fallback for getUser RPC so transient upstream errors never log the user out."""
    if not auth_header:
        return None
    try:
        import base64
        clean_tok = re.sub(r"^(?:JWT|Bearer)\s+", "", str(auth_header).strip(), flags=re.I)
        parts = clean_tok.split(".")
        if len(parts) < 2:
            return None
        b64 = parts[1].replace("-", "+").replace("_", "/")
        b64 += "=" * ((4 - len(b64) % 4) % 4)
        payload = json.loads(base64.b64decode(b64).decode("utf-8", errors="ignore"))
        if isinstance(payload, dict) and payload.get("login"):
            return json.dumps({
                "id": payload.get("id") or 1,
                "login": payload["login"],
                "email": payload.get("email") or "",
                "patreon_tier": payload.get("patreon_tier") or 3,
            }).encode("utf-8")
    except Exception:
        pass
    return None


def proxy_nr_request(
    path_with_query: str,
    method: str = "GET",
    body: Optional[bytes] = None,
    req_headers: Optional[Dict[str, str]] = None,
) -> Tuple[int, bytes, str]:
    """
    Serves static assets (/_nuxt/*, /settings/*, /assets/*, /icons/*), library RPCs (get_library, get_countries, get_timezones),
    and all 40K/AoS catalogue books (books_get_book_row) directly from data/nr_offline_bundle.zip + in-memory cache,
    fetching live updates from https://www.newrecruit.eu.
    Returns (status_code, content_bytes, content_type).
    """
    global _NR_DIRECT_BLOCKED_UNTIL
    clean_path = path_with_query if path_with_query.startswith("/") else f"/{path_with_query}"
    if clean_path.startswith("/api/nr/"):
        clean_path = clean_path[7:]
    elif clean_path.startswith("/nr/"):
        clean_path = clean_path[3:]
    if (
        clean_path.startswith(("/assets/", "/icons/", "/settings/", "/fonts/"))
        and "v=nr3" in clean_path
    ):
        clean_path = clean_path.split("?")[0]
    method_up = method.upper()

    # Short-circuit client error telemetry RPCs so they never hit upstream
    if method_up == "POST" and ("report_client_error" in clean_path or "error_snapshot_save" in clean_path):
        return 200, b"{}", "application/json"

    is_cacheable_get = (
        method_up == "GET"
        and (
            clean_path.startswith("/_nuxt/")
            or clean_path.startswith("/settings/")
            or clean_path.startswith("/assets/")
            or clean_path.startswith("/icons/")
            or clean_path.startswith("/fonts/")
            or clean_path.startswith("/api/book/")
            or clean_path in ("/assets.json", "/favicon.ico", "/favicon-32x32.png", "/Tahoma.ttf", "/TahomaBold.ttf")
        )
    )
    body_str = body.decode("utf-8", errors="ignore") if (body and method_up == "POST" and len(body) < 512) else ""
    is_cacheable_rpc = (
        method_up == "POST"
        and clean_path.startswith("/api/rpc")
        and any(
            m_name in body_str
            for m_name in ('"get_library"', '"get_countries"', '"get_timezones"', '"get_games"', '"books_get_book_row"')
        )
    )

    cache_key = _canonical_nr_rpc_cache_key(clean_path, body, body_str) if is_cacheable_rpc else clean_path
    now = time.time()
    if (is_cacheable_get or is_cacheable_rpc) and cache_key in _NR_STATIC_CACHE:
        ts, cached_bytes, cached_ct = _NR_STATIC_CACHE[cache_key]
        if is_cacheable_rpc:
            ttl = 1800 if '"get_library"' in body_str else 21600
        else:
            ttl = _NR_CACHE_TTL_SECONDS
        if now - ts < ttl:
            return 200, cached_bytes, cached_ct

    # Static UI bundle assets (/_nuxt/*, /settings/*, /assets/*, /icons/*) match shell.html in data/nr_offline_bundle.zip,
    # whereas catalogue & library RPCs (get_library, books_get_book_row) MUST be fetched live from www.newrecruit.eu first
    # so MFM / Balance Dataslate updates are reflected automatically without manual maintenance.
    if method_up == "GET":
        bundled_static = _lookup_nr_offline_static(clean_path)
        if bundled_static is not None:
            b_data, b_ct = bundled_static
            if is_cacheable_get:
                _NR_STATIC_CACHE[cache_key] = (now, b_data, b_ct)
            return 200, b_data, b_ct
    elif method_up == "POST" and clean_path.startswith("/api/rpc"):
        fast_stub = _lookup_nr_fast_stub_rpc(body)
        if fast_stub is not None:
            b_data, b_ct = fast_stub
            if is_cacheable_rpc:
                _NR_STATIC_CACHE[cache_key] = (now, b_data, b_ct)
            return 200, b_data, b_ct
        cur_book = _lookup_nr_offline_book_if_version_current(body)
        if cur_book is not None:
            b_data, b_ct = cur_book
            if is_cacheable_rpc:
                _NR_STATIC_CACHE[cache_key] = (now, b_data, b_ct)
            return 200, b_data, b_ct

    target_url = f"{NR_BASE_URL}{clean_path}"
    headers: Dict[str, str] = {
        "User-Agent": NR_USER_AGENT,
        "Origin": "https://www.newrecruit.eu",
        "Referer": "https://www.newrecruit.eu/app/Lists",
    }
    if method_up == "POST":
        headers["Content-Type"] = "application/json"
    if req_headers:
        for hdr_key in ("Content-Type", "content-type", "Accept", "accept"):
            if hdr_key in req_headers and req_headers[hdr_key]:
                canonical = hdr_key.title() if hdr_key.islower() else hdr_key
                headers[canonical] = req_headers[hdr_key]
        if not is_cacheable_rpc:
            for auth_key in ("Authorization", "authorization", "X-NR-Authorization", "x-nr-authorization"):
                if auth_key in req_headers and req_headers[auth_key]:
                    headers["Authorization"] = req_headers[auth_key]

    has_auth_hdr = bool(headers.get("Authorization"))
    is_get_user_rpc = ("m=getUser" in clean_path) or ('"getUser"' in body_str)

    if now < _NR_DIRECT_BLOCKED_UNTIL:
        if method_up == "POST" and clean_path.startswith("/api/rpc"):
            if cache_key in _NR_STATIC_CACHE:
                return 200, _NR_STATIC_CACHE[cache_key][1], _NR_STATIC_CACHE[cache_key][2]
            offline_fb = _lookup_nr_offline_rpc(body)
            if offline_fb is not None:
                if is_cacheable_rpc:
                    _NR_STATIC_CACHE[cache_key] = (now, offline_fb[0], offline_fb[1])
                return 200, offline_fb[0], offline_fb[1]
            if is_get_user_rpc:
                jwt_fb = _decode_jwt_user_fallback(headers.get("Authorization"))
                if jwt_fb:
                    return 200, jwt_fb, "application/json"
        relayed = _forward_via_nr_relay(clean_path, method_up, body, headers)
        if relayed is not None:
            r_status, r_data, r_ct = relayed
            if (is_cacheable_get or is_cacheable_rpc) and r_status == 200 and r_data:
                _NR_STATIC_CACHE[cache_key] = (now, r_data, r_ct)
                if '"get_library"' in body_str:
                    _index_library_book_versions(r_data, _NR_LIVE_BOOK_VERSIONS, _NR_LIVE_BOOK_DATES)
            if is_get_user_rpc and (r_status != 200 or not r_data or r_data.strip() in (b"", b"null", b"{}")):
                jwt_fb = _decode_jwt_user_fallback(headers.get("Authorization"))
                if jwt_fb:
                    return 200, jwt_fb, "application/json"
            return r_status, r_data, r_ct
        return 500, b'{"error":"upstream_temporarily_unavailable"}', "application/json"

    inflight_lk = _get_inflight_lock(cache_key) if is_cacheable_rpc else None
    if inflight_lk is not None:
        inflight_lk.acquire()
    try:
        if (is_cacheable_get or is_cacheable_rpc) and cache_key in _NR_STATIC_CACHE:
            ts, cached_bytes, cached_ct = _NR_STATIC_CACHE[cache_key]
            ttl = (1800 if '"get_library"' in body_str else 21600) if is_cacheable_rpc else _NR_CACHE_TTL_SECONDS
            if time.time() - ts < ttl:
                return 200, cached_bytes, cached_ct
        if method_up == "POST" and clean_path.startswith("/api/rpc"):
            cur_book = _lookup_nr_offline_book_if_version_current(body)
            if cur_book is not None:
                b_data, b_ct = cur_book
                if is_cacheable_rpc:
                    _NR_STATIC_CACHE[cache_key] = (time.time(), b_data, b_ct)
                return 200, b_data, b_ct

        has_fast_fallback = is_cacheable_rpc or is_get_user_rpc
        req_conn_to = 1.0 if has_fast_fallback else 2.5
        req_read_to = 2.5 if has_fast_fallback else 6.0
        req_retries = False if has_fast_fallback else None
        status, data, content_type = _exec_http_request(
            method_up, target_url, body, headers, connect_timeout=req_conn_to, read_timeout=req_read_to, retries=req_retries
        )
        is_upstream_block = status in (429, 500, 502, 503, 504) or (status in (401, 403) and not has_auth_hdr)
        if is_upstream_block:
            _NR_DIRECT_BLOCKED_UNTIL = time.time() + 600.0
            relayed = _forward_via_nr_relay(clean_path, method_up, body, headers)
            if relayed is not None:
                status, data, content_type = relayed
        if (is_cacheable_get or is_cacheable_rpc) and status == 200 and data:
            _NR_STATIC_CACHE[cache_key] = (now, data, content_type)
            if '"get_library"' in body_str:
                _index_library_book_versions(data, _NR_LIVE_BOOK_VERSIONS, _NR_LIVE_BOOK_DATES)
        if is_get_user_rpc and (status != 200 or not data or data.strip() in (b"", b"null", b"{}")):
            jwt_fb = _decode_jwt_user_fallback(headers.get("Authorization"))
            if jwt_fb:
                return 200, jwt_fb, "application/json"
        if status != 200 and method_up == "POST" and clean_path.startswith("/api/rpc"):
            if cache_key in _NR_STATIC_CACHE:
                return 200, _NR_STATIC_CACHE[cache_key][1], _NR_STATIC_CACHE[cache_key][2]
            offline_fb = _lookup_nr_offline_rpc(body)
            if offline_fb is not None:
                return 200, offline_fb[0], offline_fb[1]
        return status, data, content_type
    except urllib.error.HTTPError as he:
        is_upstream_block = he.code in (429, 500, 502, 503, 504) or (he.code in (401, 403) and not has_auth_hdr)
        if is_upstream_block:
            _NR_DIRECT_BLOCKED_UNTIL = time.time() + 600.0
            relayed = _forward_via_nr_relay(clean_path, method_up, body, headers)
            if relayed is not None:
                r_status, r_data, r_ct = relayed
                if (is_cacheable_get or is_cacheable_rpc) and r_status == 200 and r_data:
                    _NR_STATIC_CACHE[cache_key] = (now, r_data, r_ct)
                    if '"get_library"' in body_str:
                        _index_library_book_versions(r_data, _NR_LIVE_BOOK_VERSIONS, _NR_LIVE_BOOK_DATES)
                if is_get_user_rpc and (r_status != 200 or not r_data or r_data.strip() in (b"", b"null", b"{}")):
                    jwt_fb = _decode_jwt_user_fallback(headers.get("Authorization"))
                    if jwt_fb:
                        return 200, jwt_fb, "application/json"
                if r_status == 200:
                    return r_status, r_data, r_ct
        if method_up == "POST" and clean_path.startswith("/api/rpc"):
            if cache_key in _NR_STATIC_CACHE:
                return 200, _NR_STATIC_CACHE[cache_key][1], _NR_STATIC_CACHE[cache_key][2]
            offline_fb = _lookup_nr_offline_rpc(body)
            if offline_fb is not None:
                return 200, offline_fb[0], offline_fb[1]
        if is_get_user_rpc:
            jwt_fb = _decode_jwt_user_fallback(headers.get("Authorization"))
            if jwt_fb:
                return 200, jwt_fb, "application/json"
        err_body = he.read() if hasattr(he, "read") else b""
        ct = he.headers.get("Content-Type", "application/json") if he.headers else "application/json"
        return he.code, err_body, ct
    except Exception as e:
        logger.warning("NewRecruit direct upstream error for %s: %s", clean_path, e)
        _NR_DIRECT_BLOCKED_UNTIL = time.time() + 600.0
        if method_up == "POST" and clean_path.startswith("/api/rpc"):
            if cache_key in _NR_STATIC_CACHE:
                return 200, _NR_STATIC_CACHE[cache_key][1], _NR_STATIC_CACHE[cache_key][2]
            offline_fb = _lookup_nr_offline_rpc(body)
            if offline_fb is not None:
                if is_cacheable_rpc:
                    _NR_STATIC_CACHE[cache_key] = (now, offline_fb[0], offline_fb[1])
                return 200, offline_fb[0], offline_fb[1]
            if is_get_user_rpc:
                jwt_fb = _decode_jwt_user_fallback(headers.get("Authorization"))
                if jwt_fb:
                    return 200, jwt_fb, "application/json"
        relayed = _forward_via_nr_relay(clean_path, method_up, body, headers)
        if relayed is not None:
            r_status, r_data, r_ct = relayed
            if (is_cacheable_get or is_cacheable_rpc) and r_status == 200 and r_data:
                _NR_STATIC_CACHE[cache_key] = (now, r_data, r_ct)
            if is_get_user_rpc and (r_status != 200 or not r_data or r_data.strip() in (b"", b"null", b"{}")):
                jwt_fb = _decode_jwt_user_fallback(headers.get("Authorization"))
                if jwt_fb:
                    return 200, jwt_fb, "application/json"
            if r_status == 200:
                return r_status, r_data, r_ct
        err_payload = json.dumps({"error": str(e)}).encode("utf-8")
        # Return 500 instead of 502 so NewRecruit's client XN() does not enter a 60-second retry loop
        return 500, err_payload, "application/json"
    finally:
        if inflight_lk is not None:
            inflight_lk.release()


def _prewarm_nr_live_library() -> None:
    """Pre-warms get_library and the 40k 11th Ed system book in a background daemon thread so Play Mode never blocks on cold upstream roundtrips."""
    try:
        _ensure_nr_offline_bundle()
        proxy_nr_request("/api/rpc?m=get_library", "POST", b'{"method":"get_library","params":[]}')
        proxy_nr_request(
            "/api/rpc?m=books_get_book_row",
            "POST",
            b'{"method":"books_get_book_row","params":[827374861,827374861]}',
        )
    except Exception:
        pass


threading.Thread(target=_prewarm_nr_live_library, daemon=True, name="nr-live-prewarmer").start()


def build_synthetic_nr_row(roster: Dict[str, Any]) -> Dict[str, Any]:
    """
    Builds a valid NewRecruit IndexedDB nr.lists row from an OmniTactica roster.
    If the roster already has an authentic NewRecruit `nr_row` (created in NewRecruit Studio or Cloud), preserves it.
    Otherwise maps the faction to its real NewRecruit 40k or AoS catalogue (id_system, id_book) and attaches
    `_synthetic_text` so NewRecruit's native engine compiles it into an interactive Play Mode roster with full datasheets and stratagems.
    """
    gs, edition = detect_nr_game_system_and_edition(roster)
    default_faction = "Stormcast Eternals" if gs == "aos" else "Space Marines"
    faction = str(roster.get("faction") or default_faction).strip()
    id_book, bsid_book, book_name = resolve_nr_book(faction, gs)
    expected_units = len([u for u in (roster.get("units") or []) if isinstance(u, dict)])

    if isinstance(roster.get("nr_row"), dict) and roster["nr_row"].get("list_key"):
        row = dict(roster["nr_row"])
        row["name"] = roster.get("name") or row.get("name") or "Army Roster"
        tc_raw = row.get("totalCosts")
        if isinstance(tc_raw, list):
            for tc_item in tc_raw:
                if isinstance(tc_item, dict) and (tc_item.get("typeId") == "pts" or tc_item.get("name") == "pts"):
                    try:
                        tc_val = int(float(tc_item.get("value") or 0))
                    except Exception:
                        tc_val = 0
                    if tc_val > 0 and (not row.get("_compiled_by_nr") or tc_val >= 1400):
                        row["totalCost"] = tc_val
                        break
        if row.get("totalCost") is None:
            row["totalCost"] = int(roster.get("points") or 0)
        if expected_units > 0 and not row.get("_expected_unit_count"):
            row["_expected_unit_count"] = expected_units
        if roster.get("_ephemeral_view"):
            row["_ephemeral_view"] = True
            row["synced"] = 0
        if roster.get("gw_text") and not row.get("_omnitactica_gw_text"):
            row["_omnitactica_gw_text"] = roster["gw_text"]
        if roster.get("nr_text") and not row.get("_omnitactica_nr_text"):
            row["_omnitactica_nr_text"] = roster["nr_text"]
        army_obj = row.get("army") if isinstance(row.get("army"), dict) else {}
        is_legacy_synthetic = (
            row.get("id_system") in (None, 1)
            or str(army_obj.get("id") or "").startswith("army-")
            or str(army_obj.get("id") or "").startswith("root-")
        )
        if is_legacy_synthetic or row.get("_compiled_by_nr"):
            if not row.get("_synthetic_text"):
                row["_synthetic_text"] = build_roster_text_for_nr_compiler(roster, book_name)
        else:
            row.pop("_synthetic_text", None)
        if not is_legacy_synthetic:
            return row

    raw_id = str(roster.get("list_key") or roster.get("id") or "").strip()
    if raw_id.startswith("nr_"):
        list_key = raw_id[3:]
    elif raw_id.startswith("list_"):
        list_key = raw_id[5:]
    elif raw_id:
        list_key = re.sub(r"[^a-zA-Z0-9_\-]", "", raw_id)[:64]
    else:
        list_key = uuid.uuid4().hex[:6]

    # Group units by role into NewRecruit's fallback Army Roster structure AND attach _synthetic_text for native compilation
    by_role: Dict[str, List[Dict[str, Any]]] = {}
    for u in roster.get("units") or []:
        if not isinstance(u, dict):
            continue
        role = str(u.get("role") or ("Hero" if gs == "aos" else "Infantry"))
        by_role.setdefault(role, []).append(u)

    cat_options = []
    det_default = "Battle Formation" if gs == "aos" else "Gladius Task Force"
    det_name = str(roster.get("detachment") or det_default)
    cfg_root_name = "Army Composition" if gs == "aos" else "Configuration"
    cfg_det_name = "Battle Formation" if gs == "aos" else "Detachment"
    cat_options.append({
        "id": "cfg-root",
        "name": cfg_root_name,
        "options": [
            {
                "id": "cfg-det",
                "name": cfg_det_name,
                "options": [{"id": "cfg-det-val", "name": det_name, "options": [{"id": "cfg-det-leaf", "name": det_name}]}],
            }
        ],
    })

    for role, u_list in by_role.items():
        unit_nodes = []
        for idx, u in enumerate(u_list):
            sub_opts = []
            if u.get("is_warlord"):
                sub_opts.append({"id": f"wl-{idx}", "name": "General" if gs == "aos" else "Warlord"})
            if u.get("enhancement"):
                sub_opts.append({
                    "id": f"enh-{idx}",
                    "name": "Heroic Traits" if gs == "aos" else "Enhancements",
                    "options": [{"id": f"enh-val-{idx}", "name": str(u["enhancement"])}],
                })
            for wg_idx, wg in enumerate(u.get("wargear") or []):
                sub_opts.append({"id": f"wg-{idx}-{wg_idx}", "name": str(wg)})
            unit_nodes.append({
                "id": str(u.get("id") or f"unit-{idx}"),
                "name": str(u.get("name") or "Unit"),
                "amount": int(u.get("model_count") or 1),
                "points": int(u.get("points") or 0),
                "options": sub_opts,
            })
        cat_options.append({
            "id": f"cat-{role.lower().replace(' ', '-')}",
            "name": role,
            "options": unit_nodes,
        })

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    raw_text_val = str(roster.get("raw_text") or "").strip()
    synthetic_text = build_roster_text_for_nr_compiler({**roster, "raw_text": ""}, book_name)
    if not synthetic_text and raw_text_val:
        synthetic_text = raw_text_val

    if roster.get("id_system"):
        sys_id = int(roster["id_system"])
    elif gs == "aos":
        sys_id = NR_AOS_3E_SYSTEM_ID if edition == "AoS 3.0" else NR_AOS_SYSTEM_ID
    else:
        sys_id = NR_40K_10E_SYSTEM_ID if edition == "10th Ed" else NR_40K_SYSTEM_ID

    if sys_id == NR_AOS_SYSTEM_ID:
        sys_bsid = NR_AOS_SYSTEM_BSID
    elif sys_id == NR_AOS_3E_SYSTEM_ID:
        sys_bsid = NR_AOS_3E_SYSTEM_BSID
    elif sys_id == NR_40K_SYSTEM_ID:
        sys_bsid = NR_40K_SYSTEM_BSID
    elif sys_id == NR_40K_10E_SYSTEM_ID:
        sys_bsid = NR_40K_10E_SYSTEM_BSID
    else:
        sys_bsid = str(roster.get("bsid_system") or (NR_AOS_SYSTEM_BSID if gs == "aos" else NR_40K_SYSTEM_BSID))

    is_eph = bool(roster.get("_ephemeral_view"))
    out_row = {
        "list_key": list_key,
        "name": str(roster.get("name") or f"{faction} - {det_name}"),
        "id_system": sys_id,
        "id_book": id_book,
        "bsid_system": sys_bsid,
        "bsid_book": bsid_book,
        "totalCost": int(roster.get("points") or 0),
        "totalCosts": {"pts": int(roster.get("points") or 0)},
        "date_mod": str(roster.get("date_mod") or now_str),
        "version": 1,
        "synced": 0 if is_eph else 1,
        "metadata": {"play_mode": True},
        "_raw_text": raw_text_val,
        "_synthetic_text": synthetic_text,
        "_omnitactica_gw_text": str(roster.get("gw_text") or ""),
        "_omnitactica_nr_text": str(roster.get("nr_text") or ""),
        "_omnitactica_book_name": book_name,
        "_expected_unit_count": expected_units,
        "_is_nr_compatible": bool(roster.get("is_newrecruit_compatible", True)),
        "_created_by_nr": bool(roster.get("created_by_newrecruit", False)),
        "army": {
            "id": f"army-{list_key}",
            "name": book_name,
            "options": [
                {
                    "id": f"roster-{list_key}",
                    "name": "Army Roster",
                    "options": cat_options,
                }
            ],
        },
    }
    if is_eph:
        out_row["_ephemeral_view"] = True
        if len(_EPHEMERAL_NR_ROWS) >= _EPHEMERAL_NR_ROWS_MAX:
            oldest_key = next(iter(_EPHEMERAL_NR_ROWS))
            _EPHEMERAL_NR_ROWS.pop(oldest_key, None)
        _EPHEMERAL_NR_ROWS[list_key] = out_row
    return out_row


def _resolve_nr_cloud_account(user_key: str = "default") -> Dict[str, Any]:
    """Resolves the per-user NewRecruit Cloud account state from memory or PostgreSQL AuthManager."""
    ukey = str(user_key or "default").strip() or "default"
    mem_acct = _NR_CLOUD_ACCOUNTS.get(ukey)
    if ukey != "default":
        try:
            from auth import get_auth_manager
            db_creds = get_auth_manager().get_nr_credentials(ukey)
            if isinstance(db_creds, dict) and (db_creds.get("connected") or db_creds.get("disconnected_at")):
                merged = dict(mem_acct or {})
                merged.update({
                    "connected": bool(db_creds.get("connected")),
                    "login": db_creds.get("login") or "",
                    "access": db_creds.get("access") or "",
                    "refresh": db_creds.get("refresh") or "",
                    "client_key": db_creds.get("client_key") or merged.get("client_key") or "",
                    "last_sync": db_creds.get("last_sync") or merged.get("last_sync"),
                    "disconnected_at": db_creds.get("disconnected_at"),
                })
                _NR_CLOUD_ACCOUNTS[ukey] = merged
                return merged
        except Exception:
            pass
    return dict(mem_acct or {})


def _persist_nr_cloud_account(user_key: str, acct: Dict[str, Any]) -> None:
    """Persists the per-user NewRecruit Cloud account state to memory and PostgreSQL AuthManager."""
    ukey = str(user_key or "default").strip() or "default"
    _NR_CLOUD_ACCOUNTS[ukey] = dict(acct)
    if ukey != "default":
        try:
            from auth import get_auth_manager
            if acct.get("connected") and acct.get("access"):
                get_auth_manager().save_nr_credentials(
                    user_id=ukey,
                    login=str(acct.get("login") or ""),
                    access_token=str(acct.get("access") or ""),
                    refresh_token=str(acct.get("refresh") or ""),
                    client_key=str(acct.get("client_key") or ""),
                )
            elif not acct.get("connected"):
                get_auth_manager().clear_nr_credentials(ukey)
        except Exception:
            pass


def get_nr_state_payload(
    current_lists: List[Dict[str, Any]],
    user_key: str = "default",
) -> Dict[str, Any]:
    """Returns the hydration payload for GET /api/armylists/nr_state."""
    nr_rows = []
    seen_keys = set()
    for item in current_lists:
        if not isinstance(item, dict) or item.get("_ephemeral_view"):
            continue
        row = build_synthetic_nr_row(item)
        lkey = row.get("list_key")
        if lkey and lkey not in seen_keys:
            seen_keys.add(lkey)
            nr_rows.append(row)

    acct = _resolve_nr_cloud_account(user_key)
    return {
        "success": True,
        "nr_rows": nr_rows,
        "cloud_account": {
            "connected": bool(acct.get("connected")),
            "login": acct.get("login") or "",
            "last_sync": acct.get("last_sync"),
            "disconnected_at": acct.get("disconnected_at"),
            "access": acct.get("access") or "",
            "refresh": acct.get("refresh") or "",
            "client_key": acct.get("client_key") or "",
        },
    }


def process_nr_sync_payload(
    body: Dict[str, Any],
    save_fn: Callable[[Dict[str, Any]], Dict[str, Any]],
    delete_fn: Callable[[str], bool],
    list_fn: Callable[[], List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """
    Processes a POST /api/armylists/nr_sync payload from the embedded NewRecruit Studio Bridge.
    Note: Wahapedia enrichment is intentionally NOT called (`enrich=False`) because NewRecruit Play Mode
    handles all datasheet and stratagem rendering directly.
    """
    action = str(body.get("action") or "upsert").strip().lower()
    parser = get_parser()

    if action == "delete":
        list_key = str(body.get("list_key") or body.get("id") or "").strip()
        list_name = str(body.get("list_name") or "").strip().lower()
        if not list_key and not list_name:
            return {"success": False, "error": "Missing list_key for delete"}
        raw_k = re.sub(r"^(nr_|list_)", "", list_key)
        if list_key:
            delete_fn(list_key)
            delete_fn(raw_k)
            delete_fn(f"nr_{raw_k}")
            delete_fn(f"list_{raw_k}")
        for item in list(list_fn() or []):
            if not isinstance(item, dict):
                continue
            item_id = str(item.get("id") or "")
            item_lkey = str(item.get("list_key") or "")
            item_name = str(item.get("name") or "").strip().lower()
            nr_meta = ((item.get("nr_row") or {}).get("metadata") or {}) if isinstance(item.get("nr_row"), dict) else {}
            mig_to = str(nr_meta.get("migrated_to") or "").strip() if isinstance(nr_meta, dict) else ""
            is_key_match = bool(
                raw_k and (
                    item_lkey in (list_key, raw_k)
                    or item_id in (list_key, raw_k, f"nr_{raw_k}", f"list_{raw_k}")
                    or (mig_to and mig_to in (list_key, raw_k))
                )
            )
            is_name_only_match = bool(not raw_k and list_name and item_name == list_name)
            if is_key_match or is_name_only_match:
                if item_id:
                    delete_fn(item_id)
        return {
            "success": True,
            "action": "delete",
            "deleted_id": f"nr_{raw_k}" if raw_k else list_key,
            "army_lists": list_fn(),
        }

    existing_by_key: Dict[str, Dict[str, Any]] = {}
    for item in list(list_fn() or []):
        if isinstance(item, dict):
            ik = str(item.get("list_key") or "").strip()
            iid = str(item.get("id") or "").strip()
            if ik:
                existing_by_key[ik] = item
            if iid.startswith("nr_"):
                existing_by_key[iid[3:]] = item

    def _merge_existing_native_texts(row_obj: Dict[str, Any], lkey_str: str) -> None:
        ex = existing_by_key.get(lkey_str)
        if not isinstance(ex, dict):
            return
        ex_nr_row = ex.get("nr_row") if isinstance(ex.get("nr_row"), dict) else {}
        eff_pts = 0
        tc_raw = row_obj.get("totalCosts")
        if isinstance(tc_raw, list):
            for tc_item in tc_raw:
                if isinstance(tc_item, dict) and (tc_item.get("typeId") == "pts" or tc_item.get("name") == "pts"):
                    try:
                        eff_pts = int(float(tc_item.get("value") or 0))
                        if eff_pts > 0:
                            break
                    except Exception:
                        pass
        if not eff_pts:
            try:
                eff_pts = int(float(row_obj.get("totalCost") or 0))
            except Exception:
                eff_pts = 0
        ex_pts = int(ex.get("points") or 0)
        if not row_obj.get("_omnitactica_gw_text"):
            ex_gw = str(ex_nr_row.get("_omnitactica_gw_text") or "").strip()
            if ex_gw and "(0 Points)" not in ex_gw and "(0 pts)" not in ex_gw:
                if eff_pts > 0 and ex_pts > 0 and eff_pts != ex_pts:
                    ex_gw = ex_gw.replace(f"({ex_pts} Points)", f"({eff_pts} Points)").replace(f"({ex_pts} pts)", f"({eff_pts} pts)")
                row_obj["_omnitactica_gw_text"] = ex_gw
        if not row_obj.get("_omnitactica_nr_text"):
            ex_nr = str(ex_nr_row.get("_omnitactica_nr_text") or "").strip()
            if ex_nr and "(0 Points)" not in ex_nr and "(0 pts)" not in ex_nr:
                if eff_pts > 0 and ex_pts > 0 and eff_pts != ex_pts:
                    ex_nr = ex_nr.replace(f"[{ex_pts}pts]", f"[{eff_pts}pts]").replace(f"({ex_pts} pts)", f"({eff_pts} pts)")
                row_obj["_omnitactica_nr_text"] = ex_nr

    if action == "bulk_sync":
        incoming_lists = body.get("lists")
        if not isinstance(incoming_lists, list):
            return {"success": True, "action": "bulk_sync", "army_lists": list_fn()}

        incoming_keys = set()
        for row in incoming_lists:
            if not isinstance(row, dict) or not row.get("list_key") or row.get("_ephemeral_view"):
                continue
            lkey = str(row["list_key"]).strip()
            if lkey in _EPHEMERAL_NR_ROWS and lkey not in existing_by_key:
                continue
            incoming_keys.add(lkey)
            _merge_existing_native_texts(row, lkey)
            parsed = parser.parse_newrecruit_dict(row, default_id=f"nr_{lkey}", enrich=False)
            parsed["source_format"] = "NewRecruit Studio"
            save_fn(parsed)

        if body.get("reconcile_deletions", True):
            existing = list_fn()
            for item in existing:
                if not isinstance(item, dict):
                    continue
                item_id = str(item.get("id") or "")
                item_lkey = str(item.get("list_key") or (item_id[3:] if item_id.startswith("nr_") else item_id))
                if item_lkey not in incoming_keys and item_id not in incoming_keys:
                    delete_fn(item_id)

        return {
            "success": True,
            "action": "bulk_sync",
            "army_lists": list_fn(),
        }

    # Default: 'upsert'
    row = body.get("list") or body
    if not isinstance(row, dict):
        return {"success": False, "error": "Invalid list payload"}
    if row.get("_ephemeral_view") or body.get("ephemeral"):
        return {
            "success": True,
            "action": "ephemeral_ignored",
            "army_lists": list_fn(),
        }
    lkey = str(row.get("list_key") or row.get("id") or uuid.uuid4().hex[:6]).strip()
    if lkey.startswith("nr_"):
        lkey = lkey[3:]
    if lkey in _EPHEMERAL_NR_ROWS and lkey not in existing_by_key:
        return {
            "success": True,
            "action": "ephemeral_ignored",
            "army_lists": list_fn(),
        }
    row["list_key"] = lkey
    _merge_existing_native_texts(row, lkey)

    parsed = parser.parse_newrecruit_dict(row, default_id=f"nr_{lkey}", enrich=False)
    parsed["source_format"] = row.get("source_format") or "NewRecruit Studio"
    saved = save_fn(parsed)
    return {
        "success": True,
        "action": "upsert",
        "army_list": saved,
        "army_lists": list_fn(),
    }


def _nr_rpc_call(method: str, params: List[Any], access_token: Optional[str] = None) -> Any:
    """Calls https://www.newrecruit.eu/api/rpc?m=<method> (with multi-region relay fallback) and returns parsed JSON."""
    path = f"/api/rpc?m={urllib.parse.quote(method)}"
    payload = json.dumps({"method": method, "params": params}).encode("utf-8")
    headers: Dict[str, str] = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
    }
    if access_token:
        headers["Authorization"] = access_token

    status, data, _ = proxy_nr_request(path, "POST", payload, headers)
    if status >= 400:
        raise RuntimeError(f"NewRecruit RPC {method} returned HTTP {status}: {data.decode('utf-8', errors='ignore')[:200]}")
    raw = data.decode("utf-8", errors="ignore")
    return json.loads(raw) if raw else {}


def hash_newrecruit_password(login: str, password: str) -> str:
    """
    Replicates NewRecruit's exact client-side password hash `vb(login, password)`:
    1. md5_hex = md5(f"{login}*{password}")
    2. sha256_hex = sha256(md5_hex)
    """
    step1 = hashlib.md5(f"{login}*{password}".encode("utf-8")).hexdigest()
    return hashlib.sha256(step1.encode("utf-8")).hexdigest()


def handle_nr_cloud_connect(
    body: Dict[str, Any],
    save_fn: Callable[[Dict[str, Any]], Dict[str, Any]],
    delete_fn: Callable[[str], bool],
    list_fn: Callable[[], List[Dict[str, Any]]],
    user_key: str = "default",
) -> Dict[str, Any]:
    """
    Handles NewRecruit Cloud Account Connection, Cross-Device Token Persistence, & Bidirectional Cloud List Sync.
    """
    action = str(body.get("action") or "connect").strip().lower()
    parser = get_parser()
    ukey = str(user_key or "default").strip() or "default"
    acct = _resolve_nr_cloud_account(ukey)

    if action == "status":
        return {
            "success": True,
            "connected": bool(acct.get("connected")),
            "login": acct.get("login") or "",
            "last_sync": acct.get("last_sync"),
            "disconnected_at": acct.get("disconnected_at"),
            "synced_count": acct.get("synced_count", 0),
        }

    if action == "disconnect":
        now_iso = datetime.now(timezone.utc).isoformat()
        disconnected_acct = {
            "connected": False,
            "login": "",
            "access": "",
            "refresh": "",
            "client_key": "",
            "last_sync": None,
            "disconnected_at": now_iso,
        }
        _persist_nr_cloud_account(ukey, disconnected_acct)
        return {
            "success": True,
            "connected": False,
            "login": "",
            "disconnected_at": now_iso,
            "army_lists": list_fn(),
        }

    if action == "save_tokens":
        access_tok = str(body.get("access_token") or body.get("access") or "").strip()
        refresh_tok = str(body.get("refresh_token") or body.get("refresh") or "").strip()
        login_val = str(body.get("login") or acct.get("login") or "").strip()
        client_key_val = str(body.get("client_key") or acct.get("client_key") or "").strip()
        if not access_tok:
            return {"success": False, "error": "Missing access_token"}
        if not login_val:
            try:
                jwt_fb = _decode_jwt_user_fallback(access_tok)
                if jwt_fb:
                    jwt_obj = json.loads(jwt_fb.decode("utf-8", errors="ignore"))
                    login_val = str(jwt_obj.get("login") or "NewRecruit Account")
            except Exception:
                login_val = "NewRecruit Account"
        now_iso = datetime.now(timezone.utc).isoformat()
        updated_acct = {
            "connected": True,
            "login": login_val or "NewRecruit Account",
            "access": access_tok,
            "refresh": refresh_tok,
            "client_key": client_key_val,
            "last_sync": now_iso,
            "disconnected_at": None,
            "synced_count": acct.get("synced_count", 0),
        }
        _persist_nr_cloud_account(ukey, updated_acct)
        return {
            "success": True,
            "connected": True,
            "login": updated_acct["login"],
            "last_sync": now_iso,
        }

    login_input = str(body.get("login") or body.get("username") or body.get("email") or acct.get("login") or "").strip()
    password_input = str(body.get("password") or "").strip()
    access_token = str(body.get("access_token") or acct.get("access") or "").strip()
    refresh_token = str(body.get("refresh_token") or acct.get("refresh") or "").strip()

    share_url_or_key = str(body.get("share_url") or body.get("list_key") or "").strip()
    if share_url_or_key and not password_input and action in ("sync_link", "connect"):
        parsed = parser.parse_url(share_url_or_key)
        parsed["source_format"] = "NewRecruit Cloud"
        saved = save_fn(parsed)
        return {
            "success": True,
            "connected": bool(acct.get("connected")),
            "login": acct.get("login") or "NewRecruit Share Link",
            "synced_count": 1,
            "army_list": saved,
            "army_lists": list_fn(),
        }

    if login_input and password_input:
        resolved_login = login_input
        try:
            if "@" in login_input:
                email_res = _nr_rpc_call("login_from_email", [login_input])
                if isinstance(email_res, dict) and email_res.get("login"):
                    resolved_login = str(email_res["login"]).strip()
                elif isinstance(email_res, dict) and email_res.get("error"):
                    return {"success": False, "error": str(email_res["error"])}

            pwd_hash = hash_newrecruit_password(resolved_login, password_input)
            client_key = acct.get("client_key") or uuid.uuid4().hex[:8]
            login_res = _nr_rpc_call("login", [resolved_login, pwd_hash, client_key, "36.25"])
            if isinstance(login_res, dict) and login_res.get("access"):
                access_token = str(login_res["access"])
                refresh_token = str(login_res.get("refresh") or "")
                acct = {
                    "connected": True,
                    "login": resolved_login,
                    "access": access_token,
                    "refresh": refresh_token,
                    "client_key": client_key,
                    "disconnected_at": None,
                }
            else:
                err_msg = (
                    (login_res.get("error") or login_res.get("message") or login_res.get("msg"))
                    if isinstance(login_res, dict)
                    else "Invalid NewRecruit username or password"
                )
                return {"success": False, "error": str(err_msg or "Invalid NewRecruit credentials")}
        except Exception as e:
            logger.warning("NewRecruit RPC login error: %s", e)
            return {"success": False, "error": f"Could not reach NewRecruit Cloud API: {e}"}

    if not access_token:
        return {
            "success": False,
            "error": "Please enter your NewRecruit username/email and password to connect your account.",
        }

    try:
        user_data = _nr_rpc_call("user_get_data", [], access_token=access_token)
        if isinstance(user_data, dict) and user_data.get("error"):
            return {"success": False, "error": str(user_data["error"])}

        cloud_list_stubs = user_data.get("lists") if isinstance(user_data, dict) else []
        if not isinstance(cloud_list_stubs, list):
            cloud_list_stubs = []

        list_keys = [str(item.get("list_key")).strip() for item in cloud_list_stubs if isinstance(item, dict) and item.get("list_key")]
        full_lists: List[Dict[str, Any]] = []
        if list_keys:
            bulk_res = _nr_rpc_call("get_list_bulk", [list_keys], access_token=access_token)
            if isinstance(bulk_res, list):
                full_lists = [r for r in bulk_res if isinstance(r, dict)]
            elif isinstance(bulk_res, dict) and isinstance(bulk_res.get("lists"), list):
                full_lists = [r for r in bulk_res["lists"] if isinstance(r, dict)]

        synced_keys = set()
        for row in full_lists:
            lkey = str(row.get("list_key") or "").strip()
            if not lkey:
                continue
            synced_keys.add(lkey)
            parsed = parser.parse_newrecruit_dict(row, default_id=f"nr_{lkey}", enrich=False)
            parsed["source_format"] = "NewRecruit Cloud"
            save_fn(parsed)

        for existing_item in list_fn():
            if not isinstance(existing_item, dict):
                continue
            if existing_item.get("source_format") == "NewRecruit Cloud":
                ex_id = str(existing_item.get("id") or "")
                ex_key = str(existing_item.get("list_key") or (ex_id[3:] if ex_id.startswith("nr_") else ""))
                if ex_key and ex_key not in synced_keys:
                    delete_fn(ex_id)

        now_iso = datetime.now(timezone.utc).isoformat()
        acct["connected"] = True
        acct["last_sync"] = now_iso
        acct["disconnected_at"] = None
        acct["synced_count"] = len(synced_keys)
        _persist_nr_cloud_account(ukey, acct)

        return {
            "success": True,
            "connected": True,
            "login": acct.get("login") or login_input,
            "last_sync": now_iso,
            "synced_count": len(synced_keys),
            "army_lists": list_fn(),
        }
    except Exception as e:
        logger.warning("NewRecruit Cloud sync error: %s", e)
        return {"success": False, "error": f"Failed to sync lists from NewRecruit Cloud: {e}"}
