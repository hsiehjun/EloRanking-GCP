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
NR_DEFAULT_RELAY_URL = "https://elo-nr-relay-911555823374.us-west1.run.app"
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


def _lookup_nr_offline_rpc(body: Optional[bytes]) -> Optional[Tuple[bytes, str]]:
    """Serves read-only NewRecruit RPCs (get_library, books_get_book_row, etc.) directly from data/nr_offline_bundle.zip."""
    if not body:
        return None
    try:
        payload = json.loads(body.decode("utf-8", errors="ignore"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    rpc_method = str(payload.get("method") or "")
    params = payload.get("params")

    if rpc_method in ("get_library", "get_countries", "get_timezones"):
        data = _read_nr_offline_entry(f"rpc/{rpc_method}.json")
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
    gs, _ = detect_nr_game_system_and_edition(roster)
    default_det = "Sentinels of the Bleak Citadels" if gs == "aos" else "Gladius Task Force"
    detachment = str(roster.get("detachment") or default_det).strip()
    if detachment in ("Core Detachment", "Unknown Detachment", "Tournament Standard", "Battle Formation"):
        detachment = ""
    pts = int(roster.get("points") or 2000)

    # If raw_text already has explicit NewRecruit "+ FACTION KEYWORD:" header, preserve it directly
    if raw_text and "FACTION KEYWORD:" in raw_text.upper() and not raw_text.startswith("{"):
        return raw_text

    units = [u for u in (roster.get("units") or []) if isinstance(u, dict) and u.get("name")]
    if not units and raw_text and not raw_text.startswith("{"):
        return raw_text

    lines = [
        "+++++++++++++++++++++++++++++++++++++++++++++++",
        f"+ FACTION KEYWORD: {book_name}",
    ]
    if detachment:
        lines.append(f"+ DETACHMENT: {detachment}")
    lines.append(f"+ TOTAL ARMY POINTS: {pts}pts")
    lines.append("+++++++++++++++++++++++++++++++++++++++++++++++")
    lines.append("")

    for u in units:
        u_name = str(u.get("name") or "Unit").strip()
        u_pts = int(u.get("points") or 0)
        u_models = int(u.get("model_count") or 1)
        prefix = f"{u_models}x " if u_models > 1 and not re.match(r"^\d+x\s+", u_name, re.I) else ""
        pts_str = f" [{u_pts} pts]" if u_pts > 0 else ""
        lines.append(f"{prefix}{u_name}{pts_str}")
        if u.get("is_warlord"):
            lines.append("• Warlord")
        if u.get("enhancement"):
            lines.append(f"• Enhancement: {u['enhancement']}")
        for wg in (u.get("wargear") or []):
            wg_s = str(wg).strip()
            if wg_s and wg_s.lower() not in ("warlord",):
                lines.append(f"• {wg_s}")
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
  }

  /* 3. MyLists (/app/MyLists): Hide all controls above the actual list table (Create List, Any, Search, Group/Sort checkboxes, Import/Sync/Delete buttons) */
  .box.noaccount,
  [data-v-b9210782] > div > .boutons.mobilePadding,
  [data-v-b9210782] .boutons.mobilePadding,
  button.createToolbarBtn,
  button.createFab,
  .listsView[data-v-7711fa10] > .mobilePadding:not(.listsList),
  .listsView[data-v-7711fa10] .listViewHeader,
  .listsView[data-v-7711fa10] .checkboxes,
  [data-v-2b034e2c],
  .importButtons,
  .importRow,
  .folder[data-v-7711fa10] > .boutons,
  [data-v-7711fa10] > .boutons > button.bouton,
  .omnitactica-hidden-nr-btn {
    display: none !important;
  }
  .listsView[data-v-7711fa10] .listsList.mobilePadding {
    padding-top: 8px !important;
  }
  .main-view > [data-v-b9210782] {
    display: block !important;
  }

  /* 4. Direct-List Loading Screen & Embedded Play Mode Viewer Cleanup */
  html.omnitactica-nr-embedded-viewer header,
  html.omnitactica-nr-embedded-viewer .menu.mainMenu,
  html.omnitactica-nr-embedded-viewer .errorWindow {
    display: none !important;
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

  .connectForm {
    display: block !important;
    max-width: 380px !important;
    width: 92% !important;
    height: fit-content !important;
    min-height: 0 !important;
    max-height: fit-content !important;
    margin: 48px auto !important;
    padding: 28px 32px !important;
    background: #f8fafc !important;
    color: #0f172a !important;
    border: 1px solid #cbd5e1 !important;
    border-radius: 14px !important;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12) !important;
    overflow: hidden !important;
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
</style>
<script id="omnitactica-nr-bridge">
(function() {
  if (window.__omnitacticaNrBridgeInstalled) return;
  window.__omnitacticaNrBridgeInstalled = true;

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
  var AD_BLOCK_RE = /playwire|intergient|prebid|openx|rubiconproject|doubleclick|googlesyndication|googletagmanager|google-analytics|btloader|adnxs|criteo|pubmatic|sonobi|sharethrough|gumgum|3lift|casalemedia|amazon-adsystem|indexexchange|smartadserver|yieldmo|kargo|teads|onetag|medianet|bidswitch|taboola|outbrain|sentry\.io|report_client_error|error_snapshot_save/i;

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
  function showDirectListLoader(label) {
    try {
      document.documentElement.classList.add('omnitactica-nr-direct-list-loading');
      var ensureDom = function() {
        if (!document.body) return;
        var el = document.getElementById('omnitactica-nr-direct-loader');
        if (!el) {
          el = document.createElement('div');
          el.id = 'omnitactica-nr-direct-loader';
          el.innerHTML = '<div class="omnitactica-nr-spinner"></div>' +
            '<div id="omnitactica-nr-direct-loader-title" style="font-size:15px;font-weight:800;color:#f8fafc;letter-spacing:0.01em;">Loading Army Roster...</div>' +
            '<div style="font-size:12px;color:#94a3b8;">Opening datasheet &amp; detachment view...</div>';
          document.body.appendChild(el);
        }
        if (label) {
          var tEl = document.getElementById('omnitactica-nr-direct-loader-title');
          if (tEl) tEl.textContent = label;
        }
      };
      if (document.body) ensureDom();
      else document.addEventListener('DOMContentLoaded', ensureDom, { once: true });
      if (directListLoaderTimer) clearTimeout(directListLoaderTimer);
      directListLoaderTimer = setTimeout(hideDirectListLoader, 7500);
    } catch (e) {}
  }

  function hideDirectListLoader() {
    try {
      if (directListLoaderTimer) {
        clearTimeout(directListLoaderTimer);
        directListLoaderTimer = null;
      }
      document.documentElement.classList.remove('omnitactica-nr-direct-list-loading');
    } catch (e) {}
  }

  if (requestedListKeyFromUrl) {
    showDirectListLoader(wantPlayModeFromUrl ? 'Loading Play Mode Datasheets...' : 'Opening Army Roster...');
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
  var pendingNrRowFromParent = null;
  var cachedNrDb = null;

  try {
    if (requestedListKeyFromUrl && window.sessionStorage) {
      var savedPendingRow = window.sessionStorage.getItem('omni_pending_nr_row_' + requestedListKeyFromUrl);
      if (savedPendingRow) {
        pendingNrRowFromParent = JSON.parse(savedPendingRow);
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
    return [
      row.list_key,
      row.name || '',
      row.totalCost || 0,
      row._omnitactica_book_name || '',
      row._omnitactica_detachment || '',
      row.version || 0,
      armyStr.length,
      enrichedStr
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

  function cloneCleanRow(row, explicitArmy, explicitBook) {
    if (!row || typeof row !== 'object') return null;
    try {
      var copy = JSON.parse(JSON.stringify(row));
      if (!copy.list_key && copy._id) {
        copy.list_key = String(copy._id);
      }
      var stores = getNrStores();
      if (explicitArmy && typeof explicitArmy.toJson === 'function') {
        try {
          copy.army = explicitArmy.toJson();
          if (typeof explicitArmy.getPointsCost === 'function') {
            copy.totalCost = explicitArmy.getPointsCost() || copy.totalCost || 0;
          }
        } catch (e) {}
      } else if (stores && stores.list && stores.list.currentList && stores.list.currentList.row && stores.list.currentList.row.list_key === copy.list_key) {
        var curArmy = stores.list.currentList.army;
        if (curArmy && typeof curArmy.toJson === 'function') {
          try {
            copy.army = curArmy.toJson();
            if (typeof curArmy.getPointsCost === 'function') {
              copy.totalCost = curArmy.getPointsCost() || copy.totalCost || 0;
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

  var TOMBSTONE_STORAGE_KEY = 'omni_deleted_nr_lists_v2';
  try { localStorage.removeItem('omni_deleted_nr_lists'); } catch (e) {}

  function getNrDeletedTombstones() {
    try {
      var raw = localStorage.getItem(TOMBSTONE_STORAGE_KEY);
      if (!raw) return { keys: {}, names: {} };
      var parsed = JSON.parse(raw);
      return {
        keys: (parsed && typeof parsed.keys === 'object' && parsed.keys) ? parsed.keys : {},
        names: (parsed && typeof parsed.names === 'object' && parsed.names) ? parsed.names : {}
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
      if (listName) {
        var cleanN = String(listName).trim().toLowerCase();
        if (cleanN) tomb.names[cleanN] = now;
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
      if (listName) {
        var cleanN = String(listName).trim().toLowerCase();
        if (cleanN && tomb.names[cleanN]) {
          delete tomb.names[cleanN];
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
    if (rk && tomb.keys[rk]) return true;
    var migTo = (r.metadata && r.metadata.migrated_to) ? String(r.metadata.migrated_to).trim() : '';
    if (migTo && tomb.keys[migTo]) return true;
    var rn = String(r.name || '').trim().toLowerCase();
    if (rn && tomb.names[rn]) return true;
    return false;
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
    if (victimRows.length === 0) return;
    purgingTombstones = true;
    var prevHyd = isHydrating;
    isHydrating = true;
    var keysToPurgeIdb = [];
    try {
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
      if (keysToPurgeIdb.length > 0) {
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
    } finally {
      isHydrating = prevHyd;
      purgingTombstones = false;
    }
  }

  async function syncUpsertRow(row, explicitArmy, explicitBook) {
    if (isHydrating || !row || row._ephemeral_view || isTombstonedNrRow(row)) return;
    var clean = cloneCleanRow(row, explicitArmy, explicitBook);
    if (!clean || !clean.list_key) return;
    var sig = computeSignature(clean);
    if (knownListsMap[clean.list_key] === sig) {
      return;
    }
    if (syncInFlight[clean.list_key]) return;
    knownListsMap[clean.list_key] = sig;
    syncInFlight[clean.list_key] = true;
    try {
      await postSyncAction('upsert', { list: clean });
    } finally {
      syncInFlight[clean.list_key] = false;
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
      var req = origPut.apply(this, arguments);
      try {
        if (!isHydrating && this.name === 'lists' && value && (value.list_key || value._id)) {
          var captured = value;
          req.addEventListener('success', function() {
            setTimeout(function() { syncUpsertRow(captured); }, 40);
          });
        }
      } catch (e) {}
      return req;
    };

    var origAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function(value, key) {
      var req = origAdd.apply(this, arguments);
      try {
        if (!isHydrating && this.name === 'lists' && value && (value.list_key || value._id)) {
          var captured = value;
          req.addEventListener('success', function() {
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
        if (r.id_system == 2821148162 && r.name) {
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
      if (stores.list.currentList && stores.list.currentList.row) {
        var cr = stores.list.currentList.row;
        var ck = String(cr.list_key || cr._id || '');
        if (ck && mergedMap[ck] && isActiveNrListRow(cr, stores)) {
          cr.list_key = ck;
          if (stores.list.currentList.army && typeof stores.list.currentList.army.toJson === 'function') {
            try {
              cr.army = stores.list.currentList.army.toJson();
              cr.totalCost = stores.list.currentList.army.getPointsCost() || cr.totalCost || 0;
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
  async function hydrateFromOmniTactica() {
    if (initialHydrationDone) return;
    try {
      var stores = null;
      for (var attempt = 0; attempt < 80; attempt++) {
        stores = getNrStores();
        if (stores && stores.list && stores.list.listsInitiated) break;
        await new Promise(function(r) { setTimeout(r, 120); });
      }
      if (!stores || !stores.list) {
        initialHydrationDone = true;
        return;
      }

      // Wait for NewRecruit cloud sync if running
      try {
        if (typeof stores.list.whenSynced === 'function') {
          await Promise.race([
            stores.list.whenSynced(),
            new Promise(function(r) { setTimeout(r, 2500); })
          ]);
        }
      } catch (e) {}

      await purgeTombstonedRowsFromPiniaAndCloud(stores);

      var res = await fetch('/api/armylists/nr_state', {
        headers: getAuthHeaders(),
        credentials: 'same-origin'
      });
      if (!res.ok) {
        initialHydrationDone = true;
        return;
      }
      var state = await res.json();
      if (state && state.cloud_account && state.cloud_account.connected) {
        if (state.cloud_account.access && !localStorage.getItem('access')) {
          localStorage.setItem('access', state.cloud_account.access);
        }
        if (state.cloud_account.refresh && !localStorage.getItem('refresh')) {
          localStorage.setItem('refresh', state.cloud_account.refresh);
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

      // Only seed serverRows into Pinia if:
      // - It is the explicitly requested list from URL (and no real list with that key/name is already in Pinia), OR
      // - The user is NOT logged into NewRecruit AND Pinia has no lists at all yet.
      var allowSeedFromOmniServer = (!isNrLoggedIn && currentListData.length === 0);
      serverRows.forEach(function(sRow) {
        if (!sRow || !sRow.list_key || isTombstonedNrRow(sRow)) return;
        var sNameLow = String(sRow.name || '').trim().toLowerCase();
        var isTargetUrlRow = Boolean(
          (requestedListKeyFromUrl && requestedListKeyFromUrl === sRow.list_key) ||
          (requestedListNameFromUrl && sNameLow && sNameLow === requestedListNameFromUrl.toLowerCase())
        );
        if (!isTargetUrlRow && !allowSeedFromOmniServer) return;

        // If Pinia already has a real list with the same name (e.g. migrated to 11th Ed), don't seed a duplicate synthetic row
        if (isTargetUrlRow && piniaNameMap[sNameLow] && !piniaKeyMap[sRow.list_key]) {
          var realMatch = piniaNameMap[sNameLow];
          realMatch.metadata = Object.assign({}, realMatch.metadata || {}, { play_mode: Boolean(wantPlayModeFromUrl) });
          requestedListKeyFromUrl = realMatch.list_key;
          return;
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
          stores.list.listData.push(sRow);
          piniaKeyMap[sRow.list_key] = sRow;
          knownListsMap[sRow.list_key] = computeSignature(sRow);
        } else if (isTargetUrlRow) {
          existingPinia.metadata = Object.assign({}, existingPinia.metadata || {}, { play_mode: Boolean(wantPlayModeFromUrl) });
          knownListsMap[sRow.list_key] = computeSignature(existingPinia);
        }
      });

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
      if (!isEmbeddedViewer && !requestedListKeyFromUrl) {
        await forceFullSync();
      }
    }
  }

  async function upsertSingleRowToIdb(row) {
    if (!row || !row.list_key) return false;
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
        if (typeof stores.list.rebuildTreeData === 'function') {
          stores.list.rebuildTreeData();
        }
      } catch (e) {}
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
    var compilePromise = (async function() {
      try {
        var targetSysId = Number(row.id_system) || getDefaultSystemIdForOmniGameSystem();
        var sys = await systemStore.selectSystem(targetSysId);
        if (!sys) {
          var fallbackSysId = (targetSysId === 4255553472 || targetSysId === 4194757354) ? 4194757354 : 2821148162;
          sys = await systemStore.selectSystem(fallbackSysId);
        }
        if (!sys) return row;

        var entryScriptEl = document.querySelector('script[type="module"][src*="/_nuxt/"]');
        var entrySrc = entryScriptEl ? entryScriptEl.getAttribute('src') : null;
        if (!entrySrc) return row;
        var entryMod = await import(entrySrc);
        var adapter = null;
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
        if (!adapter || typeof sys.getBook !== 'function') return row;

        var candidateTexts = [];
        if (row._raw_text && String(row._raw_text).trim()) {
          candidateTexts.push(String(row._raw_text));
        }
        if (row._synthetic_text && String(row._synthetic_text).trim() && String(row._synthetic_text) !== String(row._raw_text || '')) {
          candidateTexts.push(String(row._synthetic_text));
        }
        if (candidateTexts.length === 0) return row;

        var firstLines = candidateTexts[0].match(/[^\r\n]+/g) || [];
        var firstHdr = (firstLines.length > 0 && typeof adapter.parseTextListHeader === 'function')
          ? await adapter.parseTextListHeader(firstLines)
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
            }) || null;
          }
        }
        if (!fallbackBook) {
          fallbackBook = booksArr.find(function(b) { return b && b.playable; }) || null;
        }
        if (!fallbackBook) return row;

        var bookInst = await sys.getBook(fallbackBook.id);
        if (!bookInst) return row;

        var bestParsed = null;
        var bestUnitCount = 0;
        var lastErrors = [];

        for (var cIdx = 0; cIdx < candidateTexts.length; cIdx++) {
          var rawLines = candidateTexts[cIdx].match(/[^\r\n]+/g) || [];
          if (rawLines.length === 0) continue;
          var hdr = (typeof adapter.parseTextListHeader === 'function')
            ? await adapter.parseTextListHeader(rawLines)
            : { start: 0 };
          var startIdx = (hdr && typeof hdr.start === 'number') ? hdr.start : 0;
          var maxCost = (hdr && hdr.maxCost) || Number(row.totalCost) || 2000;
          var parsed = await adapter.parseTextList(bookInst, rawLines, maxCost, startIdx);
          if (parsed && Array.isArray(parsed.errors) && parsed.errors.length > 0) {
            lastErrors = parsed.errors;
          }
          var uCount = (parsed && parsed.army) ? countCompiledUnitsInArmy(parsed.army) : 0;
          if (uCount > bestUnitCount) {
            bestParsed = parsed;
            bestUnitCount = uCount;
            break;
          }
          if (!bestParsed && parsed && parsed.army) {
            bestParsed = parsed;
          }
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
          row.army = bestParsed.army.toJson();
          row.totalCost = bestParsed.army.getPointsCost() || row.totalCost || 2000;
          if (typeof bestParsed.army.calcTotalCosts === 'function') {
            row.totalCosts = bestParsed.army.calcTotalCosts();
          }
          row._compiled_by_nr = true;
          row._compiled_unit_count = bestUnitCount;
          row._nr_compile_failed = false;
          if (listStore && Array.isArray(listStore.listData)) {
            var existingIdx = listStore.listData.findIndex(function(r) { return r && r.list_key === row.list_key; });
            if (existingIdx !== -1) {
              Object.assign(listStore.listData[existingIdx], row);
            }
          }
          await listStore.saveListLocally({
            row: row,
            army: bestParsed.army,
            book: bookInst
          });
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
          txt === 'Sync Lists' ||
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
    var stores = getNrStores();
    if (!stores || !stores.user || !stores.list || !stores.system) return;

    try {
      stores.user.isSupporter = function() { return true; };
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
          var res = await origDoSaveList(listObj, localOnly);
          try {
            if (listObj && listObj.row && !isTombstonedNrRow(listObj.row)) {
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
          try {
            if (listObj && listObj.row && !this.legacyMigration) {
              clearNrDeletedTombstone(listObj.row.list_key, listObj.row.name);
            }
          } catch (e) {}
          var res = await origAddList(listObj, selectIt);
          try {
            if (listObj && listObj.row && !isTombstonedNrRow(listObj.row)) {
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
          var wantPlayNow = Boolean(wantPlayModeFromUrl || (window.location.search || '').indexOf('view=play') !== -1);
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
          }
          var res = await origSelectList(rowObj || rowOrKey, opts);
          if (!res && rowObj) {
            if (rowObj.booksDate) {
              delete rowObj.booksDate;
              res = await origSelectList(rowObj, opts);
            }
            if (!res && (rowObj._synthetic_text || rowObj._raw_text)) {
              rowObj._compiled_by_nr = false;
              await compileSyntheticRowIfNeeded(rowObj, stores.system, stores.list, true);
              res = await origSelectList(rowObj, opts);
            }
          }
          var activeList = res || this.currentList;
          if (activeList && activeList.row && requestedListKeyFromUrl) {
            activeList.row.metadata = Object.assign({}, activeList.row.metadata || {}, { play_mode: wantPlayNow });
          }
          return res;
        };
      }

      if (typeof stores.list.syncAllLists === 'function') {
        var origSyncAll = stores.list.syncAllLists.bind(stores.list);
        stores.list.syncAllLists = async function() {
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
    var wantPlay = Boolean(wantPlayModeFromUrl || curSearch.indexOf('view=play') !== -1 || curSearch.indexOf('play=1') !== -1);
    var modeToken = targetKey ? (targetKey + ':' + (wantPlay ? 'play' : 'edit')) : null;

    if (!targetKey) {
      hideDirectListLoader();
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
        notifyParent({ action: 'ready' });
      }, 80);
      return;
    }

    activatingPlayMode = true;
    try {
      var listArr = Array.isArray(stores.list.listData) ? stores.list.listData : [];
      var targetRow = listArr.find(function(r) { return r && r.list_key === targetKey; }) || null;

      // Fallback: match by list name (e.g. if the list was migrated to 11th Edition with a new list_key)
      var searchName = (
        requestedListNameFromUrl ||
        (targetRow && targetRow.name) ||
        (pendingNrRowFromParent && pendingNrRowFromParent.name) ||
        ''
      ).trim().toLowerCase();

      if (searchName && listArr.length > 0) {
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
          if (!targetRow || (targetRow._synthetic_text && !nameMatches[0]._synthetic_text)) {
            targetRow = nameMatches[0];
            targetKey = targetRow.list_key;
            requestedListKeyFromUrl = targetKey;
            modeToken = targetKey + ':' + (wantPlay ? 'play' : 'edit');
          }
        }
      }

      if (!targetRow && pendingNrRowFromParent && (pendingNrRowFromParent.list_key === targetKey || !pendingNrRowFromParent.list_key || listArr.length === 0)) {
        var rowToSeed = Object.assign({}, pendingNrRowFromParent);
        if (!rowToSeed.list_key) rowToSeed.list_key = targetKey;
        rowToSeed.metadata = Object.assign({}, rowToSeed.metadata || {}, { play_mode: Boolean(wantPlay) });
        await upsertSingleRowToIdb(rowToSeed);
        targetRow = Array.isArray(stores.list.listData)
          ? stores.list.listData.find(function(r) { return r && r.list_key === rowToSeed.list_key; })
          : null;
        if (targetRow) {
          targetKey = targetRow.list_key;
          requestedListKeyFromUrl = targetKey;
          modeToken = targetKey + ':' + (wantPlay ? 'play' : 'edit');
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
      if (stores.options && typeof stores.options.addInstalledSystemVue === 'function' && targetRow.id_system) {
        stores.options.addInstalledSystemVue(targetRow.id_system);
      }
      if (!stores.system.selectedSystem || stores.system.selectedSystem.id != targetRow.id_system) {
        await stores.system.selectSystem(targetRow.id_system);
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
      if (needsCompile) {
        await compileSyntheticRowIfNeeded(targetRow, stores.system, stores.list, true);
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

      var loadedListObj = (await stores.list.selectList(targetRow)) || stores.list.currentList;
      if (loadedListObj && loadedListObj.row) {
        loadedListObj.row.metadata = Object.assign({}, loadedListObj.row.metadata || {}, { play_mode: Boolean(wantPlay) });
      }
      stores.list.lastSelectedListKey = targetKey;
      var freshStores = getNrStores();
      if (freshStores && freshStores.listsPage && loadedListObj) {
        freshStores.listsPage.editedList = loadedListObj;
      }

      var router = getNrRouter(stores);
      var nowPath = window.location.pathname || '';
      if (router) {
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
      var postNavStores = getNrStores();
      if (postNavStores && postNavStores.listsPage && loadedListObj) {
        if (loadedListObj.row) {
          loadedListObj.row.metadata = Object.assign({}, loadedListObj.row.metadata || {}, { play_mode: Boolean(wantPlay) });
        }
        postNavStores.listsPage.editedList = loadedListObj;
      }
      playModeActivatedForKey = modeToken;
      setTimeout(function() {
        var sAfter = getNrStores();
        if (sAfter && sAfter.listsPage && loadedListObj) {
          if (loadedListObj.row) {
            loadedListObj.row.metadata = Object.assign({}, loadedListObj.row.metadata || {}, { play_mode: Boolean(wantPlay) });
          }
          sAfter.listsPage.editedList = loadedListObj;
        }
        hideDirectListLoader();
        readyNotified = true;
        notifyParent({ action: 'ready', list_key: targetKey });
      }, 90);
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
    if (!initialHydrationDone || isHydrating || isEmbeddedViewer) return;
    var rows = await readAllNrLists();
    if (!rows) return;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !r.list_key) continue;
      var clean = cloneCleanRow(r);
      var sig = computeSignature(clean || r);
      if (knownListsMap[r.list_key] !== sig) {
        await syncUpsertRow(clean || r);
      }
    }
  }

  async function forceFullSync() {
    if (isEmbeddedViewer) return null;
    if (!initialHydrationDone) {
      await hydrateFromOmniTactica();
    }
    var st = getNrStores();
    try {
      if (st && st.list && typeof st.list.whenSynced === 'function') {
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
    knownListsMap = {};
    cleaned.forEach(function(r) {
      knownListsMap[r.list_key] = computeSignature(r);
    });
    return await postSyncAction('bulk_sync', {
      lists: cleaned,
      reconcile_deletions: true
    });
  }

  window.__omnitacticaNrBridge = {
    forceFullSync: forceFullSync,
    pollListsDiff: pollListsDiff,
    hydrateFromOmniTactica: hydrateFromOmniTactica,
    ensurePlayModeAndStoreHooks: ensurePlayModeAndStoreHooks,
    getNrStores: getNrStores,
    readAllNrLists: readAllNrLists
  };

  window.addEventListener('message', async function(ev) {
    var msg = ev && ev.data;
    if (!msg || msg.type !== 'OMNITACTICA_NR_COMMAND') return;
    if (msg.command === 'force_sync') {
      await forceFullSync();
    } else if (msg.command === 'delete_list' && (msg.list_key || msg.list_name)) {
      var delKey = String(msg.list_key || '').replace(/^(nr_|list_)/, '').trim();
      var delNameLow = msg.list_name ? String(msg.list_name).trim().toLowerCase() : '';
      var extraPurge = Array.isArray(msg.keys_to_purge) ? msg.keys_to_purge : [];
      addNrDeletedTombstone(delKey, delNameLow, extraPurge);
      if (delKey) delete knownListsMap[delKey];
      if (pendingNrRowFromParent && (pendingNrRowFromParent.list_key === delKey || (delNameLow && String(pendingNrRowFromParent.name || '').trim().toLowerCase() === delNameLow))) {
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
          if (delNameLow && String(x.name || '').trim().toLowerCase() === delNameLow) return true;
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
                if (rVal && (keysToPurge.indexOf(String(rVal.list_key || '')) !== -1 || (delNameLow && String(rVal.name || '').trim().toLowerCase() === delNameLow))) {
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
      if ((activatingPlayMode || compilingKeys[nextKey]) && requestedListKeyFromUrl === nextKey && wantPlayModeFromUrl === nextPlay) {
        return;
      }
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
        pendingNrRowFromParent = Object.assign({}, msg.nr_row);
        var cur = null;
        if (stOpen && stOpen.list && Array.isArray(stOpen.list.listData)) {
          cur = stOpen.list.listData.find(function(er) {
            return er && er.list_key === msg.nr_row.list_key;
          }) || null;
          if (!cur && requestedListNameFromUrl) {
            cur = stOpen.list.listData.find(function(er) {
              return er && !er._ephemeral_view && String(er.name || '').trim().toLowerCase() === requestedListNameFromUrl.toLowerCase();
            }) || null;
          }
        }
        if (!cur) {
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
        if (!cur) {
          var rowToWrite = Object.assign({}, msg.nr_row);
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
        var nextSysId = Number(msg.id_system);
        if (!nextSysId) return;
        preferredStudioSystemId = nextSysId;
        requestedListKeyFromUrl = null;
        hideDirectListLoader();
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
        if (/^\/app\/Lists(?:\?.*)?$/i.test(cleanTarget) || /^\/app\/MyLists(?:\?.*)?$/i.test(cleanTarget)) {
          cleanTarget = '/app/MyLists';
        }
        requestedListKeyFromUrl = null;
        hideDirectListLoader();
        var storesNav = getNrStores();
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
        var curNavPath = (window.location.pathname || '').replace(/^\/nr\/app/, '/app');
        if (curNavPath === cleanTarget) {
          return;
        }
        var rtrNav = getNrRouter(storesNav);
        if (rtrNav) {
          await rtrNav.push(cleanTarget);
        } else {
          window.location.href = '/nr' + cleanTarget;
        }
      } catch (e) {}
    } else if (msg.command === 'create_list') {
      try {
        requestedListKeyFromUrl = null;
        hideDirectListLoader();
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
        hideDirectListLoader();
        var stAuth = getNrStores();
        var rtrAuth = getNrRouter(stAuth);
        var isLoggedNow = Boolean(stAuth && stAuth.user && stAuth.user.user && stAuth.user.user.login);
        if (isLoggedNow || msg.force_logout) {
          if (stAuth && stAuth.user && typeof stAuth.user.logout === 'function') {
            try { await stAuth.user.logout(); } catch (e) {}
          }
          if (stAuth && stAuth.user) {
            stAuth.user.user = null;
            stAuth.user.__omniLastLoginNotified = '';
          }
          try {
            localStorage.removeItem('access');
            localStorage.removeItem('refresh');
          } catch (e) {}
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

  // Fast 40ms early hook to unlock Supporter mode and store hooks as soon as Pinia initializes
  var earlyHookCount = 0;
  var earlyHookTimer = setInterval(function() {
    earlyHookCount++;
    var s = getNrStores();
    if (s && s.user) {
      try { s.user.isSupporter = function() { return true; }; } catch (e) {}
      if (s.list && s.list.listsInitiated) {
        ensurePlayModeAndStoreHooks();
        clearInterval(earlyHookTimer);
      }
    }
    if (earlyHookCount > 250) {
      clearInterval(earlyHookTimer);
    }
  }, 40);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(hydrateFromOmniTactica, 80);
    });
  } else {
    setTimeout(hydrateFromOmniTactica, 80);
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
_NR_RELAY_ID_TOKEN_CACHE: Dict[str, Tuple[float, str]] = {}


def _get_gcp_relay_id_token(audience: str) -> Optional[str]:
    """Fetches a Google Cloud OIDC identity token from the metadata server for Cloud Run service-to-service calls."""
    now = time.time()
    cached = _NR_RELAY_ID_TOKEN_CACHE.get(audience)
    if cached and now - cached[0] < 2400:
        return cached[1]
    meta_url = (
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience="
        + urllib.parse.quote(audience, safe="")
    )
    try:
        req = urllib.request.Request(meta_url, headers={"Metadata-Flavor": "Google"})
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            tok = resp.read().decode("utf-8", errors="ignore").strip()
            if tok:
                _NR_RELAY_ID_TOKEN_CACHE[audience] = (now, tok)
                return tok
    except Exception:
        pass
    return None


def _exec_http_request(
    method_up: str,
    url: str,
    body: Optional[bytes],
    headers: Dict[str, str],
    connect_timeout: float = 2.5,
    read_timeout: float = 6.0,
) -> Tuple[int, bytes, str]:
    """Executes an outbound HTTP request via urllib3 pool or urllib.request."""
    if _NR_HTTP_POOL is not None:
        resp = _NR_HTTP_POOL.request(
            method_up,
            url,
            body=body if method_up != "GET" else None,
            headers=headers,
            timeout=urllib3.Timeout(connect=connect_timeout, read=read_timeout),
        )
        return (
            int(resp.status),
            bytes(resp.data or b""),
            resp.headers.get("Content-Type", "application/octet-stream"),
        )
    req = urllib.request.Request(url, data=body if method_up != "GET" else None, headers=headers, method=method_up)
    with urllib.request.urlopen(req, timeout=connect_timeout + read_timeout) as uresp:
        return (
            int(uresp.status),
            uresp.read(),
            uresp.headers.get("Content-Type", "application/octet-stream"),
        )


def _forward_via_nr_relay(
    clean_path: str,
    method_up: str,
    body: Optional[bytes],
    upstream_headers: Dict[str, str],
) -> Optional[Tuple[int, bytes, str]]:
    """
    Forwards live NewRecruit RPC/token requests via the secondary region Cloud Run relay (us-west1)
    or public GET RPC fallback when the primary region's outbound IP is blocked by www.newrecruit.eu.
    """
    relay_base = (os.environ.get("NR_RELAY_URL") or NR_DEFAULT_RELAY_URL).strip().rstrip("/")
    if relay_base:
        relay_target = f"{relay_base}{clean_path}"
        relay_headers: Dict[str, str] = {
            "User-Agent": NR_USER_AGENT,
            "X-Omni-Relay": "1",
        }
        for k in ("Content-Type", "Accept"):
            if k in upstream_headers and upstream_headers[k]:
                relay_headers[k] = upstream_headers[k]
        if upstream_headers.get("Authorization"):
            relay_headers["X-NR-Authorization"] = upstream_headers["Authorization"]

        try:
            status, data, ct = _exec_http_request(
                method_up, relay_target, body, relay_headers, connect_timeout=3.0, read_timeout=8.0
            )
            if status in (401, 403):
                id_tok = _get_gcp_relay_id_token(relay_base)
                if id_tok:
                    relay_headers["Authorization"] = f"Bearer {id_tok}"
                    status, data, ct = _exec_http_request(
                        method_up, relay_target, body, relay_headers, connect_timeout=3.0, read_timeout=8.0
                    )
            if status < 500 and status != 404:
                if clean_path.startswith("/api/rpc") and status == 200:
                    ct = "application/json"
                return status, data, ct
        except urllib.error.HTTPError as he:
            if he.code in (401, 403):
                id_tok = _get_gcp_relay_id_token(relay_base)
                if id_tok:
                    try:
                        relay_headers["Authorization"] = f"Bearer {id_tok}"
                        status, data, ct = _exec_http_request(
                            method_up, relay_target, body, relay_headers, connect_timeout=3.0, read_timeout=8.0
                        )
                        if status < 500 and status != 404:
                            if clean_path.startswith("/api/rpc") and status == 200:
                                ct = "application/json"
                            return status, data, ct
                    except Exception:
                        pass
        except Exception as e:
            logger.warning("NR regional relay (%s) error for %s: %s", relay_base, clean_path, e)

    # Secondary fallback for unauthenticated GET-compatible NewRecruit RPCs (login, login_from_email, getUser, resetPassword)
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


def proxy_nr_request(
    path_with_query: str,
    method: str = "GET",
    body: Optional[bytes] = None,
    req_headers: Optional[Dict[str, str]] = None,
) -> Tuple[int, bytes, str]:
    """
    Serves static assets (/_nuxt/*, /settings/*, /assets/*, /icons/*), library RPCs (get_library, get_countries, get_timezones),
    and all 40K/AoS catalogue books (books_get_book_row) directly from data/nr_offline_bundle.zip + in-memory cache,
    falling back to https://www.newrecruit.eu (or us-west1 relay) only for unbundled or user-specific RPCs.
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

    cache_key = f"POST:{clean_path}:{body_str}" if is_cacheable_rpc else clean_path
    now = time.time()
    if (is_cacheable_get or is_cacheable_rpc) and cache_key in _NR_STATIC_CACHE:
        ts, cached_bytes, cached_ct = _NR_STATIC_CACHE[cache_key]
        ttl = 3600 if is_cacheable_rpc else _NR_CACHE_TTL_SECONDS
        if now - ts < ttl:
            return 200, cached_bytes, cached_ct

    # Primary source: serve static assets, library RPCs, and 40K/AoS books from local data/nr_offline_bundle.zip
    if method_up == "GET":
        bundled_static = _lookup_nr_offline_static(clean_path)
        if bundled_static is not None:
            b_data, b_ct = bundled_static
            if is_cacheable_get:
                _NR_STATIC_CACHE[cache_key] = (now, b_data, b_ct)
            return 200, b_data, b_ct
    elif method_up == "POST" and clean_path.startswith("/api/rpc"):
        bundled_rpc = _lookup_nr_offline_rpc(body)
        if bundled_rpc is not None:
            b_data, b_ct = bundled_rpc
            if is_cacheable_rpc:
                _NR_STATIC_CACHE[cache_key] = (now, b_data, b_ct)
            return 200, b_data, b_ct

    is_relay_hop = bool(
        req_headers and (req_headers.get("X-Omni-Relay") or req_headers.get("x-omni-relay"))
    )
    target_url = f"{NR_BASE_URL}{clean_path}"
    headers: Dict[str, str] = {
        "User-Agent": NR_USER_AGENT,
        "Origin": "https://www.newrecruit.eu",
        "Referer": "https://www.newrecruit.eu/app/Lists",
    }
    if req_headers:
        for hdr_key in ("Content-Type", "content-type", "Accept", "accept"):
            if hdr_key in req_headers and req_headers[hdr_key]:
                canonical = hdr_key.title() if hdr_key.islower() else hdr_key
                headers[canonical] = req_headers[hdr_key]
        if is_relay_hop:
            for nr_auth_key in ("X-NR-Authorization", "x-nr-authorization", "X-Nr-Authorization"):
                if nr_auth_key in req_headers and req_headers[nr_auth_key]:
                    headers["Authorization"] = req_headers[nr_auth_key]
        else:
            for auth_key in ("Authorization", "authorization", "X-NR-Authorization", "x-nr-authorization"):
                if auth_key in req_headers and req_headers[auth_key]:
                    headers["Authorization"] = req_headers[auth_key]

    # If direct connection from this region was recently blocked by www.newrecruit.eu, route straight to relay
    if not is_relay_hop and now < _NR_DIRECT_BLOCKED_UNTIL:
        relayed = _forward_via_nr_relay(clean_path, method_up, body, headers)
        if relayed is not None:
            r_status, r_data, r_ct = relayed
            if (is_cacheable_get or is_cacheable_rpc) and r_status == 200:
                _NR_STATIC_CACHE[cache_key] = (now, r_data, r_ct)
            return r_status, r_data, r_ct

    try:
        status, data, content_type = _exec_http_request(
            method_up, target_url, body, headers, connect_timeout=2.5, read_timeout=6.0
        )
        if (is_cacheable_get or is_cacheable_rpc) and status == 200:
            _NR_STATIC_CACHE[cache_key] = (now, data, content_type)
        return status, data, content_type
    except urllib.error.HTTPError as he:
        err_body = he.read() if hasattr(he, "read") else b""
        ct = he.headers.get("Content-Type", "application/json") if he.headers else "application/json"
        return he.code, err_body, ct
    except Exception as e:
        logger.warning("NewRecruit direct upstream error for %s: %s", clean_path, e)
        if not is_relay_hop:
            _NR_DIRECT_BLOCKED_UNTIL = time.time() + 600.0
            relayed = _forward_via_nr_relay(clean_path, method_up, body, headers)
            if relayed is not None:
                r_status, r_data, r_ct = relayed
                if (is_cacheable_get or is_cacheable_rpc) and r_status == 200:
                    _NR_STATIC_CACHE[cache_key] = (now, r_data, r_ct)
                return r_status, r_data, r_ct
        err_payload = json.dumps({"error": str(e)}).encode("utf-8")
        # Return 500 instead of 502 so NewRecruit's client XN() does not enter a 60-second retry loop
        return 500, err_payload, "application/json"


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

    if isinstance(roster.get("nr_row"), dict) and roster["nr_row"].get("list_key"):
        row = dict(roster["nr_row"])
        row["name"] = roster.get("name") or row.get("name") or "Army Roster"
        if row.get("totalCost") is None:
            row["totalCost"] = int(roster.get("points") or 0)
        if roster.get("_ephemeral_view"):
            row["_ephemeral_view"] = True
        if not row.get("_synthetic_text"):
            row["_synthetic_text"] = build_roster_text_for_nr_compiler(roster, book_name)
        army_obj = row.get("army") if isinstance(row.get("army"), dict) else {}
        is_legacy_synthetic = (
            row.get("id_system") in (None, 1)
            or str(army_obj.get("id") or "").startswith("army-")
            or str(army_obj.get("id") or "").startswith("root-")
        )
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
        "synced": 1,
        "metadata": {"play_mode": True},
        "_raw_text": raw_text_val,
        "_synthetic_text": synthetic_text,
        "_omnitactica_book_name": book_name,
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
    if roster.get("_ephemeral_view"):
        out_row["_ephemeral_view"] = True
        if len(_EPHEMERAL_NR_ROWS) >= _EPHEMERAL_NR_ROWS_MAX:
            oldest_key = next(iter(_EPHEMERAL_NR_ROWS))
            _EPHEMERAL_NR_ROWS.pop(oldest_key, None)
        _EPHEMERAL_NR_ROWS[list_key] = out_row
    return out_row


def get_nr_state_payload(
    current_lists: List[Dict[str, Any]],
    user_key: str = "default",
) -> Dict[str, Any]:
    """Returns the hydration payload for GET /api/armylists/nr_state."""
    nr_rows = []
    seen_keys = set()
    for item in current_lists:
        if not isinstance(item, dict):
            continue
        row = build_synthetic_nr_row(item)
        lkey = row.get("list_key")
        if lkey and lkey not in seen_keys:
            seen_keys.add(lkey)
            nr_rows.append(row)

    for ekey, erow in list(_EPHEMERAL_NR_ROWS.items()):
        if ekey and ekey not in seen_keys and isinstance(erow, dict):
            seen_keys.add(ekey)
            nr_rows.append(erow)

    acct = _NR_CLOUD_ACCOUNTS.get(user_key) or _NR_CLOUD_ACCOUNTS.get("default") or {}
    return {
        "success": True,
        "nr_rows": nr_rows,
        "cloud_account": {
            "connected": bool(acct.get("connected")),
            "login": acct.get("login") or "",
            "last_sync": acct.get("last_sync"),
            "access": acct.get("access") or "",
            "refresh": acct.get("refresh") or "",
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
            if (raw_k and (item_lkey in (list_key, raw_k) or item_id in (list_key, raw_k, f"nr_{raw_k}", f"list_{raw_k}"))) or (list_name and item_name == list_name):
                if item_id:
                    delete_fn(item_id)
        return {
            "success": True,
            "action": "delete",
            "deleted_id": f"nr_{raw_k}" if raw_k else list_key,
            "army_lists": list_fn(),
        }

    if action == "bulk_sync":
        incoming_lists = body.get("lists")
        if not isinstance(incoming_lists, list):
            return {"success": True, "action": "bulk_sync", "army_lists": list_fn()}

        incoming_keys = set()
        for row in incoming_lists:
            if not isinstance(row, dict) or not row.get("list_key"):
                continue
            lkey = str(row["list_key"]).strip()
            incoming_keys.add(lkey)
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
    lkey = str(row.get("list_key") or row.get("id") or uuid.uuid4().hex[:6]).strip()
    if lkey.startswith("nr_"):
        lkey = lkey[3:]
    row["list_key"] = lkey

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
    Handles Option 2: NewRecruit Cloud Account Connection & Bidirectional Cloud List Sync.
    """
    action = str(body.get("action") or "connect").strip().lower()
    parser = get_parser()

    if action == "status":
        acct = _NR_CLOUD_ACCOUNTS.get(user_key) or _NR_CLOUD_ACCOUNTS.get("default") or {}
        return {
            "success": True,
            "connected": bool(acct.get("connected")),
            "login": acct.get("login") or "",
            "last_sync": acct.get("last_sync"),
            "synced_count": acct.get("synced_count", 0),
        }

    if action == "disconnect":
        _NR_CLOUD_ACCOUNTS.pop(user_key, None)
        _NR_CLOUD_ACCOUNTS.pop("default", None)
        return {
            "success": True,
            "connected": False,
            "login": "",
            "army_lists": list_fn(),
        }

    acct = dict(_NR_CLOUD_ACCOUNTS.get(user_key) or _NR_CLOUD_ACCOUNTS.get("default") or {})
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
        acct["synced_count"] = len(synced_keys)
        _NR_CLOUD_ACCOUNTS[user_key] = acct
        _NR_CLOUD_ACCOUNTS["default"] = acct

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
