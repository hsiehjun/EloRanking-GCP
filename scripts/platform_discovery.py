"""
Unified Multi-Platform Event Discovery & Upcoming Preview Engine (`scripts/platform_discovery.py`).

Discovers 100% real upcoming, live (in-progress), and premier recent tournaments across:
  - Melee.gg (`melee:{tid}`)
  - Limitless TCG (`ltcg:{tid}`)
  - TopDeck.gg (`td:{tid}`) — including store venue/city/state/GPS enrichment via Firestore `hubs`
  - Longshanks (`ls:{tid}`) — live ongoing & upcoming tabletop/miniature wargame events via `_ls_get_text` (with SiteGround PoW bypass)

All discovery queries use thread-safe in-memory caching (15-minute TTL, stale-while-revalidate)
and bounded HTTP timeouts so web endpoints remain fast (<500ms warm, <2.5s cold) with zero DB writes.
"""

from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timedelta, timezone
import html as html_lib
import json
import logging
import math
import re
import threading
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple
import urllib.parse
import urllib.request

from config import GAME_SYSTEM_BY_SLUG, normalize_game_system

logger = logging.getLogger("elo.platform_discovery")

FIRESTORE_BASE_URL = "https://firestore.googleapis.com/v1/projects/eminence-1b40b/databases/(default)/documents"
FIRESTORE_RUNQUERY_URL = f"{FIRESTORE_BASE_URL}:runQuery"
DISCOVERY_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

_TEST_EVENT_NAME_RE = re.compile(
    r"\b(test|testing|ignore|dummy|mock\s+tournamen|staff\s+mock|sandbox|do\s+not\s+join)\b",
    re.I,
)
_HEX24_RE = re.compile(r"^[0-9a-f]{24}$")

MELEE_SYSTEM_TO_TAG: Dict[str, str] = {
    "mtg": "MagicTheGathering",
    "lorcana": "Lorcana",
    "sw_unlimited": "StarWarsUnlimited",
    "flesh_blood": "FleshAndBlood",
    "riftbound": "Riftbound",
}

MELEE_DESC_TO_SYSTEM: Dict[str, str] = {
    "magic: the gathering": "mtg",
    "disney lorcana": "lorcana",
    "star wars: unlimited": "sw_unlimited",
    "flesh and blood tcg": "flesh_blood",
    "flesh and blood": "flesh_blood",
    "riftbound": "riftbound",
}

LIMITLESS_SYSTEM_TO_CODE: Dict[str, str] = {
    "pokemon": "PTCG",
    "one_piece": "OP",
    "digimon": "DCG",
    "gundam_tcg": "GUNDAM",
    "lorcana": "LORCANA",
    "sw_unlimited": "SWU",
    "riftbound": "RB",
}

TOPDECK_GAME_MAP: Dict[str, str] = {
    "magic: the gathering": "mtg",
    "mtg": "mtg",
    "pokemon": "pokemon",
    "pokémon": "pokemon",
    "one piece": "one_piece",
    "one piece card game": "one_piece",
    "star wars: unlimited": "sw_unlimited",
    "star wars unlimited": "sw_unlimited",
    "disney lorcana": "lorcana",
    "lorcana": "lorcana",
    "yu-gi-oh!": "yugioh",
    "yu-gi-oh": "yugioh",
    "yugioh": "yugioh",
    "flesh and blood": "flesh_blood",
    "riftbound": "riftbound",
    "digimon": "digimon",
    "digimon card game": "digimon",
    "gundam": "gundam_tcg",
    "gundam card game": "gundam_tcg",
    "warhammer 40,000": "40k",
    "warhammer 40k": "40k",
    "warhammer: age of sigmar": "aos",
    "age of sigmar": "aos",
    "marvel: crisis protocol": "mcp",
}
TOPDECK_EXCLUDED_GAMES = {"naruto", "naruto mythos tcg", "cookierun: braverse tcg", "lairen: la historia"}

_discovery_lock = threading.Lock()
_melee_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}
_limitless_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}
_topdeck_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}
_longshanks_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}
_topdeck_hubs_cache: Tuple[float, Dict[str, Dict[str, Any]]] = (0.0, {})
_refreshing_keys: set = set()

DISCOVERY_TTL_SECONDS = 900.0  # 15 minutes
HUBS_TTL_SECONDS = 3600.0      # 1 hour


def _haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 3958.8
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2.0) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2.0) ** 2
    )
    return r * 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))


def _classify_tier(name: str, total_players: int = 0, num_tickets: int = 0) -> Dict[str, Any]:
    n = f" {(name or '').lower()} "
    p = max(int(total_players or 0), int(num_tickets or 0))
    if p >= 200 or any(k in n for k in ("world championship", "pro tour", "regional championship", "super major", "grand open", "ic ", "international championship")):
        return {"tier": "super_major", "tier_badge": "👑 SUPER MAJOR", "tier_weight": 4}
    if p >= 64 or any(k in n for k in ("major", "championship", "invitational", "open", "qualifier", "challenge", "cup", "showdown", "treasure cup", "case")):
        return {"tier": "major", "tier_badge": "🌟 MAJOR", "tier_weight": 3}
    if p >= 24 or any(k in n for k in (" gt ", "grand tournament", "win a box", "win-a-box", "store championship", "prerelease", "pre-release", "summoner")):
        return {"tier": "gt", "tier_badge": "🏆 GRAND TOURNAMENT", "tier_weight": 2}
    return {"tier": "rtt", "tier_badge": "⚔️ TOURNAMENT", "tier_weight": 1}


def _estimate_swiss_rounds(total_players: int) -> int:
    p = int(total_players or 0)
    if p <= 8:
        return 3
    if p <= 16:
        return 4
    if p <= 32:
        return 5
    if p <= 64:
        return 6
    if p <= 128:
        return 7
    if p <= 256:
        return 8
    return 9


def _parse_fee_usd(raw_fee: Any) -> Tuple[float, str]:
    s = str(raw_fee or "").strip()
    if not s or s.lower() in ("free", "none", "null", "$0", "$0.00"):
        return 0.0, "usd"
    m = re.search(r"(\d+(?:\.\d{1,2})?)", s.replace(",", ""))
    if not m:
        return 0.0, "usd"
    cur = "eur" if ("€" in s or "eur" in s.lower()) else ("gbp" if ("£" in s or "gbp" in s.lower()) else "usd")
    try:
        return float(m.group(1)), cur
    except Exception:
        return 0.0, cur


def _http_get_text(url: str, timeout: float = 4.0) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": DISCOVERY_UA, "Accept": "text/html,application/json,*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def _http_post_json(url: str, payload: Any, timeout: float = 4.0) -> Any:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"User-Agent": DISCOVERY_UA, "Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


# =============================================================================
# 1. Melee.gg Live + Upcoming Discovery
# =============================================================================


def _fetch_melee_for_system(target_sys: str, days_ahead: int = 180) -> List[Dict[str, Any]]:
    game_tag = MELEE_SYSTEM_TO_TAG.get(target_sys)
    if not game_tag:
        return []

    from scripts.melee_client import MeleeClient, _HttpTransport

    mc = MeleeClient(transport="http")
    if isinstance(mc._transport, _HttpTransport):
        mc._transport.timeout = 3.5
        mc._transport.retries = 1

    now_utc = datetime.now(timezone.utc)
    min_live_iso = (now_utc - timedelta(hours=36)).strftime("%Y-%m-%dT%H:%M:%SZ")
    today_str = (now_utc - timedelta(hours=12)).strftime("%Y-%m-%d")
    max_future_str = (now_utc + timedelta(days=max(30, int(days_ahead or 180)))).strftime("%Y-%m-%d")

    out: List[Dict[str, Any]] = []
    seen_ids: set = set()
    try:
        # 1) Live / Started tournaments for this game
        try:
            started_res = mc.search_tournaments(["Started", game_tag], page=0, order_by="startDate", order_dir="desc", length=80)
        except Exception:
            started_res = {"data": []}
        # 2) Upcoming / Registration-open tournaments sorted chronologically
        try:
            upcoming_res = mc.search_tournaments(["NotStarted", game_tag], page=0, order_by="startDate", order_dir="asc", length=180)
        except Exception:
            upcoming_res = {"data": []}

        combined_rows = [(r, True) for r in (started_res.get("data") or [])] + [
            (r, False) for r in (upcoming_res.get("data") or [])
        ]

        for r, is_started_bucket in combined_rows:
            raw_id = r.get("id")
            if not raw_id:
                continue
            tid = str(raw_id).strip()
            eid = f"melee:{tid}"
            if eid in seen_ids:
                continue
            name = str(r.get("name") or "").strip()
            if not name or _TEST_EVENT_NAME_RE.search(name):
                continue

            g_desc = str(r.get("gameDescription") or "").strip().lower()
            mapped_sys = MELEE_DESC_TO_SYSTEM.get(g_desc, target_sys)
            if mapped_sys != target_sys:
                continue

            s_date = str(r.get("startDate") or "").strip()
            s_day = s_date[:10]
            if not s_day:
                continue
            if is_started_bucket:
                if (s_date < min_live_iso if "T" in s_date else s_day < min_live_iso[:10]) or s_day > (now_utc + timedelta(days=1)).strftime("%Y-%m-%d"):
                    continue
            else:
                if s_day < today_str or s_day > max_future_str:
                    continue

            seen_ids.add(eid)
            enrolled = int(r.get("enrolledPlayerCount") or 0)
            org_name = str(r.get("organizationName") or "").strip()
            tag_types = {
                str((t.get("type") if isinstance(t, dict) else t) or "").strip().lower()
                for t in (r.get("tags") or [])
            }
            is_online = ("online" in tag_types or "mtgo" in tag_types or "arena" in tag_types) and "tabletop" not in tag_types
            price_val, currency = _parse_fee_usd(r.get("entryFeeString"))
            tier_meta = _classify_tier(name, total_players=enrolled)
            ext_url = f"https://melee.gg/Tournament/View/{tid}"
            status_str = str(r.get("status") or "").strip().lower()
            is_started = bool(is_started_bucket or status_str in ("in progress", "started", "active"))

            out.append(
                {
                    "id": eid,
                    "name": name,
                    "event_date": s_date,
                    "end_date": None,
                    "city": "Online" if is_online else "",
                    "state": "",
                    "country": "Global" if is_online else "",
                    "venue": org_name or "Melee.gg",
                    "venue_name": org_name or "Melee.gg",
                    "address": "",
                    "formatted_address": "",
                    "street_address": "",
                    "postal_code": "",
                    "latitude": None,
                    "longitude": None,
                    "total_players": enrolled,
                    "num_rounds": _estimate_swiss_rounds(enrolled),
                    "current_round": 1 if is_started else 0,
                    "is_started": is_started,
                    "is_ended": False,
                    "is_online": is_online,
                    "tier": tier_meta["tier"],
                    "tier_badge": tier_meta["tier_badge"],
                    "tier_weight": tier_meta["tier_weight"],
                    "is_major": tier_meta["tier"] in ("super_major", "major", "gt"),
                    "circuits": [str(r.get("formatString"))] if r.get("formatString") else [],
                    "distance_miles": None,
                    "event_group": "upcoming",
                    "using_online_reg": False,
                    "ticket_price": price_val,
                    "ticket_currency": currency,
                    "num_tickets": 0,
                    "external_url": ext_url,
                    "event_url": ext_url,
                    "private_event": "invite" in str(r.get("registrationType") or "").lower(),
                    "source_platform": "melee",
                    "external_event_id": tid,
                    "game_system": target_sys,
                }
            )
    finally:
        mc.close()

    return out


# =============================================================================
# 2. Limitless TCG Live + Upcoming + Premier Recent Discovery
# =============================================================================


def _fetch_limitless_for_system(target_sys: str, days_ahead: int = 180) -> List[Dict[str, Any]]:
    g_code = LIMITLESS_SYSTEM_TO_CODE.get(target_sys)
    if not g_code:
        return []

    url = f"https://play.limitlesstcg.com/tournaments?game={urllib.parse.quote(g_code)}&format=all&type=all"
    html_text = _http_get_text(url, timeout=4.0)
    tables = re.findall(r"<table[^>]*>(.*?)</table>", html_text, re.S)
    now_ts = time.time()
    now_utc = datetime.now(timezone.utc)
    max_future_str = (now_utc + timedelta(days=max(30, int(days_ahead or 180)))).strftime("%Y-%m-%d")

    out: List[Dict[str, Any]] = []
    seen_ids: set = set()

    for tbl_idx, tbl_html in enumerate(tables):
        for tr_m in re.finditer(r"<tr\b([^>]*)>(.*?)</tr>", tbl_html, re.S):
            attrs, body = tr_m.group(1), tr_m.group(2)
            tid_m = re.search(r"/tournament/([0-9a-f]{24})(?:/|\"|\?)", body)
            if not tid_m:
                continue
            tid = tid_m.group(1).lower()
            eid = f"ltcg:{tid}"
            if eid in seen_ids:
                continue

            name_m = re.search(r'data-name="([^"]*)"', attrs)
            org_m = re.search(r'data-organizer="([^"]*)"', attrs)
            date_m = re.search(r'data-date="([^"]*)"', attrs)
            players_m = re.search(r'data-players="(\d+)"', attrs)
            winner_m = re.search(r'data-winner="([^"]*)"', attrs)
            reg_m = re.search(r'data-registration="([^"]*)"', attrs)

            name = html_lib.unescape(name_m.group(1)).strip() if name_m else ""
            if not name or _TEST_EVENT_NAME_RE.search(name):
                continue

            org_name = html_lib.unescape(org_m.group(1)).strip() if org_m else "Limitless TCG"
            players = int(players_m.group(1)) if players_m else 0
            ev_date = (date_m.group(1).strip() if date_m else "")

            # Determine tournament lifecycle state from table + attributes + ObjectId creation epoch
            try:
                oid_epoch = int(tid[:8], 16)
            except Exception:
                oid_epoch = int(now_ts)

            has_winner = bool(winner_m and winner_m.group(1).strip())
            is_details_link = ("/details" in body and "/standings" not in body) or bool(reg_m)

            if has_winner or tbl_idx >= 2:
                # Completed table: only keep substantial recent events (24+ players) for discovery/majors
                if players < 24:
                    continue
                is_started = True
                is_ended = True
            elif is_details_link:
                is_started = False
                is_ended = False
            else:
                # In-Progress table: drop abandoned zombie brackets created >5 days ago with no start date
                if not ev_date and oid_epoch < (now_ts - 5 * 86400):
                    continue
                is_started = True
                is_ended = False

            if not ev_date:
                ev_date = datetime.fromtimestamp(min(oid_epoch, int(now_ts)), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

            if not is_ended and ev_date[:10] > max_future_str:
                continue

            seen_ids.add(eid)
            tier_meta = _classify_tier(name, total_players=players)
            ext_url = (
                f"https://play.limitlesstcg.com/tournament/{tid}/details"
                if (not is_started and not is_ended)
                else f"https://play.limitlesstcg.com/tournament/{tid}/standings"
            )

            out.append(
                {
                    "id": eid,
                    "name": name,
                    "event_date": ev_date,
                    "end_date": ev_date if is_ended else None,
                    "city": "Online",
                    "state": "",
                    "country": "Global",
                    "venue": org_name or "Limitless TCG",
                    "venue_name": org_name or "Limitless TCG",
                    "address": "",
                    "formatted_address": "",
                    "street_address": "",
                    "postal_code": "",
                    "latitude": None,
                    "longitude": None,
                    "total_players": players,
                    "num_rounds": _estimate_swiss_rounds(players),
                    "current_round": 1 if (is_started and not is_ended) else 0,
                    "is_started": is_started,
                    "is_ended": is_ended,
                    "is_online": True,
                    "tier": tier_meta["tier"],
                    "tier_badge": tier_meta["tier_badge"],
                    "tier_weight": tier_meta["tier_weight"],
                    "is_major": tier_meta["tier"] in ("super_major", "major", "gt"),
                    "circuits": [],
                    "distance_miles": None,
                    "event_group": "recent" if is_ended else "upcoming",
                    "using_online_reg": False,
                    "ticket_price": 0.0,
                    "ticket_currency": "usd",
                    "num_tickets": 0,
                    "external_url": ext_url,
                    "event_url": ext_url,
                    "private_event": False,
                    "source_platform": "limitless",
                    "external_event_id": tid,
                    "game_system": target_sys,
                }
            )

    return out


# =============================================================================
# 3. TopDeck.gg Live + Upcoming Discovery (with Firestore `hubs` Geo Enrichment)
# =============================================================================


def get_topdeck_hubs_map() -> Dict[str, Dict[str, Any]]:
    global _topdeck_hubs_cache
    now_ts = time.time()
    cached_ts, cached_map = _topdeck_hubs_cache
    if cached_map and (now_ts - cached_ts < HUBS_TTL_SECONDS):
        return cached_map

    hubs: Dict[str, Dict[str, Any]] = {}
    try:
        sq = {
            "structuredQuery": {
                "from": [{"collectionId": "hubs"}],
                "select": {"fields": [{"fieldPath": f} for f in ("orgName", "orgLocation", "city", "state", "lat", "lng")]},
                "limit": 1000,
            }
        }
        rows = _http_post_json(FIRESTORE_RUNQUERY_URL, sq, timeout=4.0) or []
        for item in rows:
            doc = item.get("document") if isinstance(item, dict) else None
            if not doc:
                continue
            uid = str(doc.get("name") or "").split("/")[-1].strip()
            flds = doc.get("fields") or {}
            if not uid:
                continue

            def _s(k: str) -> str:
                v = flds.get(k) or {}
                return str(v.get("stringValue") or "").strip()

            def _num(k: str) -> Optional[float]:
                v = flds.get(k) or {}
                raw = v.get("doubleValue") if "doubleValue" in v else v.get("integerValue", v.get("stringValue"))
                if raw is None or raw == "":
                    return None
                try:
                    return float(raw)
                except Exception:
                    return None

            hubs[uid] = {
                "venue": _s("orgName"),
                "address": _s("orgLocation"),
                "city": _s("city"),
                "state": _s("state"),
                "lat": _num("lat"),
                "lng": _num("lng"),
            }
        if hubs:
            _topdeck_hubs_cache = (now_ts, hubs)
    except Exception as e:
        logger.debug(f"[TopDeck] Hubs geo lookup notice: {e}")
    return hubs or cached_map


def _map_topdeck_game(raw_game: Optional[str]) -> Optional[str]:
    low = str(raw_game or "").strip().lower()
    if not low or low in TOPDECK_EXCLUDED_GAMES:
        return None
    return TOPDECK_GAME_MAP.get(low)


def _fetch_topdeck_all_upcoming_and_live(days_ahead: int = 180) -> List[Dict[str, Any]]:
    now_ts = time.time()

    lo_epoch = int(now_ts - 36 * 3600)
    hi_epoch = int(now_ts + max(30, int(days_ahead or 180)) * 86400)
    sq = {
        "structuredQuery": {
            "from": [{"collectionId": "tournaments"}],
            "where": {
                "compositeFilter": {
                    "op": "AND",
                    "filters": [
                        {"fieldFilter": {"field": {"fieldPath": "StartDate"}, "op": "GREATER_THAN_OR_EQUAL", "value": {"integerValue": str(lo_epoch)}}},
                        {"fieldFilter": {"field": {"fieldPath": "StartDate"}, "op": "LESS_THAN_OR_EQUAL", "value": {"integerValue": str(hi_epoch)}}},
                    ],
                }
            },
            "orderBy": [{"field": {"fieldPath": "StartDate"}, "direction": "ASCENDING"}],
            "limit": 250,
        }
    }

    hubs_map = get_topdeck_hubs_map()
    rows = _http_post_json(FIRESTORE_RUNQUERY_URL, sq, timeout=4.5) or []
    out: List[Dict[str, Any]] = []
    seen_ids: set = set()

    for item in rows:
        doc = item.get("document") if isinstance(item, dict) else None
        if not doc:
            continue
        tid = str(doc.get("name") or "").split("/")[-1].strip()
        flds = doc.get("fields") or {}
        if not tid:
            continue
        eid = f"td:{tid}"
        if eid in seen_ids:
            continue

        name = str((flds.get("Name") or {}).get("stringValue") or "").strip()
        if not name or _TEST_EVENT_NAME_RE.search(name):
            continue
        sys_slug = _map_topdeck_game((flds.get("Game") or {}).get("stringValue"))
        if not sys_slug:
            continue

        sd_raw = int((flds.get("StartDate") or {}).get("integerValue") or 0)
        if sd_raw > 10_000_000_000:
            sd_raw //= 1000
        if sd_raw <= 0:
            continue
        ev_date = datetime.fromtimestamp(sd_raw, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        enrolled = 0
        owner_uid = ""
        max_round = 0
        is_ffa = False
        for k, v in flds.items():
            if k.startswith("E") and k.endswith(":P1") and re.match(r"^E\d+:P1$", k):
                uval = str((v or {}).get("stringValue") or "").strip()
                if uval and uval != "_x_":
                    enrolled += 1
            elif k.startswith("X:") and not owner_uid:
                role = str((((v or {}).get("mapValue") or {}).get("fields") or {}).get("role", {}).get("stringValue") or "")
                if role == "owner" or not owner_uid:
                    owner_uid = k[2:]
            elif k.startswith("S1:R") and ":T" in k and re.match(r"^S\d+:R\d+:T\d+$", k):
                nums = [int(n) for n in re.findall(r"\d+", k)]
                if len(nums) >= 2:
                    max_round = max(max_round, nums[1])
                pf = ((v or {}).get("mapValue") or {}).get("fields") or {}
                es_vals = ((pf.get("Es") or {}).get("arrayValue") or {}).get("values") or []
                if len(es_vals) >= 3:
                    is_ffa = True

        has_end = "End" in flds
        is_started = bool(max_round >= 1 and sd_raw <= int(now_ts + 3600))
        is_ended = bool(has_end or (sd_raw < int(now_ts - 18 * 3600) and not is_started))
        if is_ended and enrolled < 16:
            continue

        hub = hubs_map.get(owner_uid) or {}
        fmt_str = str((flds.get("Format") or {}).get("stringValue") or "").strip()
        if fmt_str.upper() in ("EDH", "CEDH", "COMMANDER"):
            is_ffa = True

        is_online_name = any(w in name.lower() for w in ("webcam", "spelltable", "online", "discord"))
        lat_val = None if is_online_name else hub.get("lat")
        lng_val = None if is_online_name else hub.get("lng")
        city_val = "Online" if is_online_name else (hub.get("city") or "")
        state_val = "" if is_online_name else (hub.get("state") or "")
        venue_val = hub.get("venue") or ("TopDeck Online" if is_online_name else "TopDeck.gg")
        addr_val = "" if is_online_name else (hub.get("address") or "")

        tier_meta = _classify_tier(name, total_players=enrolled)
        ext_url = f"https://topdeck.gg/bracket/{urllib.parse.quote(tid)}"
        seen_ids.add(eid)

        out.append(
            {
                "id": eid,
                "name": name,
                "event_date": ev_date,
                "end_date": ev_date if is_ended else None,
                "city": city_val,
                "state": state_val,
                "country": "Global" if is_online_name else "",
                "venue": venue_val,
                "venue_name": venue_val,
                "address": addr_val,
                "formatted_address": addr_val,
                "street_address": addr_val,
                "postal_code": "",
                "latitude": lat_val,
                "longitude": lng_val,
                "total_players": enrolled,
                "num_rounds": max(max_round, _estimate_swiss_rounds(enrolled)),
                "current_round": max_round if (is_started and not is_ended) else 0,
                "is_started": is_started,
                "is_ended": is_ended,
                "is_online": bool(is_online_name or (lat_val is None and not city_val)),
                "is_ffa_event": is_ffa,
                "match_format": "ffa" if is_ffa else "1v1",
                "tier": tier_meta["tier"],
                "tier_badge": tier_meta["tier_badge"],
                "tier_weight": tier_meta["tier_weight"],
                "is_major": tier_meta["tier"] in ("super_major", "major", "gt"),
                "circuits": [fmt_str] if fmt_str else [],
                "distance_miles": None,
                "event_group": "recent" if is_ended else "upcoming",
                "using_online_reg": False,
                "ticket_price": 0.0,
                "ticket_currency": "usd",
                "num_tickets": 0,
                "external_url": ext_url,
                "event_url": ext_url,
                "private_event": False,
                "source_platform": "topdeck",
                "external_event_id": tid,
                "game_system": sys_slug,
            }
        )

    return out


# =============================================================================
# 3b. Longshanks Live (Ongoing) + Upcoming Discovery
# =============================================================================

LONGSHANKS_DISCOVERY_ALL_SYSTEMS: Tuple[str, ...] = (
    "mcp",
    "sw_legion",
    "shatterpoint",
    "x_wing",
    "guild_ball",
    "warmachine",
    "malifaux",
    "infinity",
    "conquest",
)

_LS_BLOCK_RE = re.compile(r'<div class="event_display ([^"]*)">')
_LS_LINK_RE = re.compile(r'href="/event/(\d+)/">([^<]*)</a>')
_LS_DATE_RE = re.compile(r"event_date\.png[^>]*/?></td>\s*<td>\s*(\d{4}-\d{2}-\d{2})")
_LS_SIZE_RE = re.compile(r"event_size\.png[^>]*/?></td>\s*<td>\s*(\d+)(?:\s*of\s*(\d+))?")
_LS_LOC_RE = re.compile(r"event_location\.png[^>]*/?></td>\s*<td>(.*?)<br\s*/?>", re.S)
_LS_FLAG_RE = re.compile(r'class="flag" title="([^"]*)"')


def _fetch_longshanks_for_system(target_sys: str, days_ahead: int = 180) -> List[Dict[str, Any]]:
    from scripts.sync_multiplatform import LONGSHANKS_HOST_BY_SYSTEM, _ls_get_text

    host = LONGSHANKS_HOST_BY_SYSTEM.get(target_sys)
    if not host:
        return []

    now_utc = datetime.now(timezone.utc)
    min_live_day = (now_utc - timedelta(days=7)).strftime("%Y-%m-%d")
    today_day = (now_utc - timedelta(hours=12)).strftime("%Y-%m-%d")
    max_future_day = (now_utc + timedelta(days=max(30, int(days_ahead or 180)))).strftime("%Y-%m-%d")

    pages_html: List[str] = []
    try:
        pages_html.append(_ls_get_text(f"{host}/events/", timeout=4.5, retries=1))
    except Exception as exc:
        logger.debug(f"[Longshanks] Discovery /events/ notice ({target_sys}): {exc}")
        return []

    out: List[Dict[str, Any]] = []
    seen_ids: set = set()

    for page_html in pages_html:
        parts = _LS_BLOCK_RE.split(page_html or "")
        for i in range(1, len(parts) - 1, 2):
            classes = set((parts[i] or "").split())
            blk = parts[i + 1]
            link_m = _LS_LINK_RE.search(blk)
            if not link_m:
                continue
            tid = link_m.group(1).strip()
            eid = f"ls:{tid}"
            if eid in seen_ids:
                continue

            name = html_lib.unescape(link_m.group(2)).strip()
            if not name or _TEST_EVENT_NAME_RE.search(name):
                continue

            date_m = _LS_DATE_RE.search(blk)
            ev_day = date_m.group(1) if date_m else ""
            if not ev_day:
                continue

            size_m = _LS_SIZE_RE.search(blk)
            players = int(size_m.group(1)) if size_m else 0
            cap = int(size_m.group(2)) if (size_m and size_m.group(2)) else 0

            is_ended = "finished" in classes
            is_started = ("ongoing" in classes) or is_ended
            if is_ended:
                if players < 24:
                    continue
            elif is_started:
                if ev_day < min_live_day:
                    continue
            else:
                if ev_day < today_day or ev_day > max_future_day:
                    continue

            loc_m = _LS_LOC_RE.search(blk)
            raw_venue = (
                " ".join(html_lib.unescape(re.sub(r"<[^>]+>", " ", loc_m.group(1))).split())[:140]
                if loc_m
                else ""
            )
            flag_m = _LS_FLAG_RE.search(blk)
            region = html_lib.unescape(flag_m.group(1)).strip() if flag_m else ""
            is_online = region.lower() == "virtual" or raw_venue.lower().startswith("virtual ")
            if is_online:
                city, state, country = "Online", "", "Global"
                venue = "Longshanks Virtual"
            else:
                reg_parts = [p.strip() for p in region.split(",") if p.strip()]
                country = reg_parts[-1] if reg_parts else ""
                state = reg_parts[0] if len(reg_parts) >= 2 else ""
                city = ""
                venue = raw_venue or "Longshanks"

            seen_ids.add(eid)
            tier_meta = _classify_tier(name, total_players=players, num_tickets=cap)
            ext_url = f"{host}/event/{tid}/"
            ev_iso = f"{ev_day}T12:00:00Z"

            out.append(
                {
                    "id": eid,
                    "name": name,
                    "event_date": ev_iso,
                    "end_date": ev_iso if is_ended else None,
                    "city": city,
                    "state": state,
                    "country": country,
                    "venue": venue,
                    "venue_name": venue,
                    "address": "" if is_online else raw_venue,
                    "formatted_address": "" if is_online else raw_venue,
                    "street_address": "",
                    "postal_code": "",
                    "latitude": None,
                    "longitude": None,
                    "total_players": players,
                    "num_rounds": _estimate_swiss_rounds(max(players, cap)),
                    "current_round": 1 if (is_started and not is_ended) else 0,
                    "is_started": is_started,
                    "is_ended": is_ended,
                    "is_online": is_online,
                    "tier": tier_meta["tier"],
                    "tier_badge": tier_meta["tier_badge"],
                    "tier_weight": tier_meta["tier_weight"],
                    "is_major": tier_meta["tier"] in ("super_major", "major", "gt"),
                    "circuits": ["Teams"] if "team" in classes else [],
                    "distance_miles": None,
                    "event_group": "recent" if is_ended else "upcoming",
                    "using_online_reg": "open" in classes,
                    "ticket_price": 0.0,
                    "ticket_currency": "usd",
                    "num_tickets": cap,
                    "external_url": ext_url,
                    "event_url": ext_url,
                    "private_event": "locked" in classes and "open" not in classes,
                    "source_platform": "longshanks",
                    "external_event_id": tid,
                    "game_system": target_sys,
                }
            )

    return out


# =============================================================================
# 4. Unified Discovery Aggregator (Cached + Bounded Parallel Execution)
# =============================================================================


def _get_cached_or_fetch(
    cache_dict: Dict[str, Tuple[float, List[Dict[str, Any]]]],
    key: str,
    fetcher,
    timeout_s: float = 3.5,
) -> List[Dict[str, Any]]:
    now_ts = time.time()
    cached = cache_dict.get(key)
    if cached:
        ts, data = cached
        if now_ts - ts < DISCOVERY_TTL_SECONDS:
            return [dict(x) for x in data]
        # Stale-while-revalidate in background
        if key not in _refreshing_keys:
            _refreshing_keys.add(key)

            def _bg():
                try:
                    fresh = fetcher()
                    cache_dict[key] = (time.time(), fresh)
                except Exception as exc:
                    logger.debug(f"[PlatformDiscovery] Background refresh notice ({key}): {exc}")
                finally:
                    _refreshing_keys.discard(key)

            threading.Thread(target=_bg, daemon=True).start()
        return [dict(x) for x in data]

    pool = ThreadPoolExecutor(max_workers=1)
    fut = pool.submit(fetcher)
    try:
        done, _ = wait([fut], timeout=timeout_s)
        if done:
            fresh = fut.result() or []
            cache_dict[key] = (time.time(), fresh)
            return [dict(x) for x in fresh]
    except Exception as exc:
        logger.debug(f"[PlatformDiscovery] Cold fetch notice ({key}): {exc}")
    finally:
        pool.shutdown(wait=False)
    return []


def discover_multiplatform_events(
    game_system: Optional[str] = "40k",
    days_ahead: int = 180,
    user_lat: Optional[float] = None,
    user_lng: Optional[float] = None,
    radius_miles: Optional[float] = None,
    include_online: bool = True,
    majors_only: bool = False,
    timeout_s: float = 3.8,
) -> List[Dict[str, Any]]:
    """
    Discovers real upcoming, live, and premier tournaments across Melee.gg, Limitless TCG, and TopDeck.gg
    for `game_system` (or `"all"`). Zero DB reads/writes.
    """
    from scripts.sync_multiplatform import LONGSHANKS_HOST_BY_SYSTEM

    raw_gs = str(game_system or "40k").strip().lower()
    if raw_gs == "all":
        systems = sorted(
            {
                "mtg", "pokemon", "one_piece", "lorcana", "sw_unlimited", "digimon",
                "gundam_tcg", "flesh_blood", "riftbound", "yugioh", "40k", "aos", "mcp",
                *LONGSHANKS_DISCOVERY_ALL_SYSTEMS,
            }
        )
    else:
        systems = [normalize_game_system(raw_gs, default="40k")]

    tasks = []
    for sys_slug in systems:
        if sys_slug in MELEE_SYSTEM_TO_TAG:
            tasks.append(("melee", sys_slug))
        if sys_slug in LIMITLESS_SYSTEM_TO_CODE:
            tasks.append(("limitless", sys_slug))
        if sys_slug in LONGSHANKS_HOST_BY_SYSTEM and (raw_gs != "all" or sys_slug in LONGSHANKS_DISCOVERY_ALL_SYSTEMS):
            tasks.append(("longshanks", sys_slug))
    tasks.append(("topdeck", raw_gs))

    collected: List[Dict[str, Any]] = []

    def _run_one(kind_and_sys: Tuple[str, str]) -> List[Dict[str, Any]]:
        kind, s_slug = kind_and_sys
        if kind == "melee":
            return _get_cached_or_fetch(
                _melee_cache,
                f"melee:{s_slug}",
                lambda: _fetch_melee_for_system(s_slug, days_ahead=days_ahead),
                timeout_s=timeout_s,
            )
        if kind == "limitless":
            return _get_cached_or_fetch(
                _limitless_cache,
                f"ltcg:{s_slug}",
                lambda: _fetch_limitless_for_system(s_slug, days_ahead=days_ahead),
                timeout_s=timeout_s,
            )
        if kind == "longshanks":
            return _get_cached_or_fetch(
                _longshanks_cache,
                f"ls:{s_slug}",
                lambda: _fetch_longshanks_for_system(s_slug, days_ahead=days_ahead),
                timeout_s=timeout_s,
            )
        # TopDeck single shared Firestore query
        td_all = _get_cached_or_fetch(
            _topdeck_cache,
            "td:all",
            lambda: _fetch_topdeck_all_upcoming_and_live(days_ahead=days_ahead),
            timeout_s=timeout_s,
        )
        if s_slug == "all":
            return td_all
        norm_s = normalize_game_system(s_slug, default="40k")
        return [ev for ev in td_all if ev.get("game_system") == norm_s]

    if tasks:
        pool = ThreadPoolExecutor(max_workers=min(6, len(tasks)))
        futs = [pool.submit(_run_one, t) for t in tasks]
        try:
            done, _ = wait(futs, timeout=timeout_s)
            for f in done:
                try:
                    collected.extend(f.result() or [])
                except Exception:
                    pass
        finally:
            pool.shutdown(wait=False)

    out: List[Dict[str, Any]] = []
    seen: set = set()
    has_coords = user_lat is not None and user_lng is not None
    rad_val = float(radius_miles) if (radius_miles is not None and radius_miles > 0) else None

    for ev in collected:
        eid = ev.get("id")
        if not eid or eid in seen:
            continue
        ev_copy = dict(ev)
        ev_lat = ev_copy.get("latitude")
        ev_lng = ev_copy.get("longitude")
        if has_coords and ev_lat is not None and ev_lng is not None:
            try:
                dist = round(_haversine_miles(float(user_lat), float(user_lng), float(ev_lat), float(ev_lng)), 1)
                ev_copy["distance_miles"] = dist
            except Exception:
                ev_copy["distance_miles"] = None

        if rad_val is not None and not majors_only:
            dist_m = ev_copy.get("distance_miles")
            if dist_m is not None:
                if dist_m > rad_val:
                    continue
                ev_copy["is_local"] = True
            else:
                if not include_online:
                    continue
                ev_copy["is_local"] = False

        if majors_only:
            p_cnt = int(ev_copy.get("total_players") or 0)
            is_ended_ev = bool(ev_copy.get("is_ended"))
            is_prem_tier = ev_copy.get("tier") in ("super_major", "major", "gt")
            if is_ended_ev and p_cnt < 24:
                continue
            if p_cnt < 8 and ev_copy.get("tier") != "super_major":
                continue
            # Ensure upcoming/live multi-platform showcase events carry at least GT tier on the Premier carousel/calendar
            if not is_prem_tier and p_cnt >= 8:
                ev_copy["tier"] = "gt"
                ev_copy["tier_badge"] = "🏆 GRAND TOURNAMENT"
                ev_copy["tier_weight"] = 2
                ev_copy["is_major"] = True

        seen.add(eid)
        out.append(ev_copy)

    out.sort(
        key=lambda x: (
            1 if x.get("is_ended") else 0,
            0 if x.get("is_started") else 1,
            str(x.get("event_date") or "9999-12-31"),
            -int(x.get("total_players") or 0),
        )
    )
    return out


# =============================================================================
# 5. Live Upcoming Tournament Preview for `/api/event/{event_id}` (0 Matches Yet)
# =============================================================================


def _lookup_existing_player_ratings(db: Any, pids: Sequence[str], game_system: str) -> Dict[str, float]:
    if not db or not pids or not hasattr(db, "get_connection"):
        return {}
    out: Dict[str, float] = {}
    try:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT player_id, current_elo FROM player_ratings WHERE player_id = ANY(%s) AND COALESCE(game_system, '40k') = %s;",
                    (list(pids), game_system),
                )
                for row in (cur.fetchall() or []):
                    pid = row[0] if isinstance(row, (list, tuple)) else row.get("player_id")
                    elo = row[1] if isinstance(row, (list, tuple)) else row.get("current_elo")
                    if pid and elo is not None:
                        out[str(pid)] = float(elo)
    except Exception:
        pass
    return out


_preview_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_PREVIEW_TTL_SECONDS = 90.0


def fetch_live_multiplatform_event_preview(
    event_id: str,
    db: Optional[Any] = None,
    force_refresh: bool = False,
    include_standings: bool = True,
) -> Optional[Dict[str, Any]]:
    """
    Fetches live tournament metadata (and pre-registered competitor roster when published) for
    `melee:`, `ltcg:`, `td:`, and `ls:` tournaments.
    Makes ZERO database writes so Elo ratings are never polluted by unplayed events.
    """
    eid = str(event_id or "").strip()
    if ":" not in eid:
        return None
    prefix, raw_tid = eid.split(":", 1)
    prefix = prefix.lower().strip()
    raw_tid = raw_tid.strip()
    if not raw_tid:
        return None

    cache_key = f"{eid}:{'db' if db is not None else 'nodb'}:{'st' if include_standings else 'meta'}"
    now_ts = time.time()
    if not force_refresh:
        cached_prev = _preview_cache.get(cache_key)
        if cached_prev and (now_ts - cached_prev[0]) < _PREVIEW_TTL_SECONDS:
            return dict(cached_prev[1])

    def _cache_and_return(payload: Dict[str, Any]) -> Dict[str, Any]:
        _preview_cache[cache_key] = (time.time(), dict(payload))
        return payload

    # 1. Melee.gg Preview & Rich Details
    if prefix == "melee":
        try:
            from scripts.melee_client import MeleeClient, _HttpTransport, parse_tournament_view

            mc = MeleeClient(transport="http")
            if isinstance(mc._transport, _HttpTransport):
                mc._transport.timeout = 4.5
                mc._transport.retries = 1
            live_standings: List[Dict[str, Any]] = []
            try:
                page_html = mc.get_text(f"/Tournament/View/{urllib.parse.quote(raw_tid)}")
                meta = parse_tournament_view(page_html, raw_tid)
                if include_standings:
                    for rd in reversed(meta.get("standing_rounds") or []):
                        try:
                            live_standings = mc.fetch_round_standings(rd["id"])
                            if live_standings:
                                break
                        except Exception:
                            pass
            finally:
                mc.close()

            g_low = str(meta.get("game_name") or "").strip().lower()
            sys_slug = MELEE_DESC_TO_SYSTEM.get(g_low, "mtg")
            status_str = str(meta.get("status") or "").strip()
            status_low = status_str.lower()
            is_ended = status_low in ("ended", "completed", "complete", "closed")
            is_started = status_low in ("in progress", "started", "active", "ongoing")
            enrolled = int(meta.get("enrolled_players") or 0)
            cap = int(meta.get("player_cap") or 0)
            plat_type = str(meta.get("platform_type") or "").strip()
            is_online = plat_type.lower() in ("online", "mtgo", "mtg arena", "digital", "discord", "webcam")
            org_name = str(meta.get("organization_name") or "").strip()
            raw_venue = str(meta.get("venue_name") or "").strip()
            venue = raw_venue or org_name or "Melee.gg"
            ext_url = f"https://melee.gg/Tournament/View/{urllib.parse.quote(raw_tid)}"

            players_out: List[Dict[str, Any]] = []
            if live_standings:
                cand_pids: List[str] = []
                parsed_st: List[Tuple[str, str, str, int, int, int, int, float]] = []
                for idx_s, st in enumerate(live_standings, start=1):
                    t_players = ((st.get("Team") or {}).get("Players") or [])
                    p0 = t_players[0] if t_players else {}
                    uname = str(p0.get("Username") or p0.get("ID") or f"p{idx_s}").strip()
                    dname = str(p0.get("DisplayName") or uname).strip()
                    pid = f"melee:{uname}"[:64]
                    dks = st.get("Decklists") or []
                    dk_name = next(
                        (str(d.get("DecklistName")).strip() for d in dks if d.get("DecklistName") and d.get("DecklistName") != "Decklist"),
                        str(meta.get("format_name") or "Registered"),
                    )
                    rk = int(st.get("Rank") or idx_s)
                    mw = int(st.get("MatchWins") or 0)
                    ml = int(st.get("MatchLosses") or 0)
                    md = int(st.get("MatchDraws") or 0)
                    pts = float(st.get("Points") or (mw * 3 + md))
                    cand_pids.append(pid)
                    parsed_st.append((pid, dname, dk_name, rk, mw, ml, md, pts))
                elo_map = _lookup_existing_player_ratings(db, cand_pids, sys_slug)
                for pid, dname, dk_name, rk, mw, ml, md, pts in parsed_st:
                    players_out.append(
                        {
                            "player_id": pid,
                            "id": pid,
                            "full_name": dname,
                            "first_name": dname.split(" ")[0],
                            "last_name": " ".join(dname.split(" ")[1:]),
                            "faction": dk_name,
                            "detachment": str(meta.get("format_name") or ""),
                            "current_elo": elo_map.get(pid, 1500.0),
                            "placement": rk if (is_ended or mw + ml + md > 0) else None,
                            "checked_in": True,
                            "event_wins": mw,
                            "event_losses": ml,
                            "event_draws": md,
                            "event_battle_points": pts,
                            "has_list": False,
                        }
                    )
                enrolled = max(enrolled, len(players_out))

            eff_rounds = max(len(meta.get("pairing_rounds") or []), _estimate_swiss_rounds(max(enrolled, min(cap, 8) if cap else 0)))
            return _cache_and_return(
                {
                    "id": eid,
                    "name": meta.get("title") or f"Melee Tournament {raw_tid}",
                    "event_date": meta.get("start_date") or "",
                    "end_date": (meta.get("start_date") or None) if is_ended else None,
                    "city": "Online" if is_online else "",
                    "state": "",
                    "country": "Global" if is_online else "",
                    "venue": venue,
                    "venue_name": venue,
                    "organizer_name": org_name or None,
                    "organizer_url": meta.get("organization_url"),
                    "format_name": meta.get("format_name"),
                    "platform_type": plat_type or ("Online" if is_online else "Tabletop"),
                    "registration_status": status_str or None,
                    "registration_type": meta.get("registration_type"),
                    "entry_fee": meta.get("entry_fee"),
                    "decklists_required": meta.get("decklists_enabled"),
                    "description": meta.get("description"),
                    "prizes_html": meta.get("prizes_html"),
                    "total_players": enrolled,
                    "enrolled_players": enrolled,
                    "player_cap": cap,
                    "num_tickets": cap,
                    "num_rounds": eff_rounds,
                    "numberOfRounds": eff_rounds,
                    "current_round": len(meta.get("pairing_rounds") or []) if is_started else 0,
                    "is_started": is_started,
                    "is_ended": is_ended,
                    "ended": is_ended,
                    "status": {"ended": is_ended, "started": is_started, "label": status_str or "Registration"},
                    "source_platform": "melee",
                    "external_event_id": raw_tid,
                    "event_url": ext_url,
                    "external_url": ext_url,
                    "using_online_reg": True,
                    "game_system": sys_slug,
                    "players": players_out,
                    "matches": [],
                    "teams": [],
                    "sync_in_progress": False,
                    "raw_json": meta,
                }
            )
        except Exception as e:
            logger.debug(f"[PlatformDiscovery] Melee preview failed for {eid}: {e}")
            return None

    # 2. Limitless TCG Preview & Pre-Registered Roster
    if prefix == "ltcg":
        tid = raw_tid.lower() if _HEX24_RE.match(raw_tid.lower()) else raw_tid
        try:
            with ThreadPoolExecutor(max_workers=2 if include_standings else 1) as pool:
                f_det = pool.submit(
                    _http_get_text,
                    f"https://play.limitlesstcg.com/tournament/{urllib.parse.quote(tid)}/details",
                    4.5,
                )
                f_reg = (
                    pool.submit(
                        _http_get_text,
                        f"https://play.limitlesstcg.com/tournament/{urllib.parse.quote(tid)}/registrations",
                        4.0,
                    )
                    if include_standings
                    else None
                )
                det_html = f_det.result()
                reg_html = ""
                if f_reg is not None:
                    try:
                        reg_html = f_reg.result()
                    except Exception:
                        reg_html = ""

            title_m = re.search(r"<title>(?:Details:\s*)?(.*?)\s*\|\s*Limitless</title>", det_html, re.S)
            title = html_lib.unescape(title_m.group(1)).strip() if title_m else ""
            if not title or "not found" in title.lower():
                return None

            tm_m = re.search(r'data-time="(\d+)"', det_html)
            if tm_m and int(tm_m.group(1)) > 0:
                ev_date = datetime.fromtimestamp(int(tm_m.group(1)) / 1000.0, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            elif _HEX24_RE.match(tid):
                ev_date = datetime.fromtimestamp(int(tid[:8], 16), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            else:
                ev_date = ""

            meta_desc_m = re.search(r'<meta name="description" content="([^"]+)">', det_html)
            meta_parts = [p.strip() for p in (meta_desc_m.group(1).split(" - ") if meta_desc_m else [])]
            fmt_name = (
                meta_parts[1].replace(" format", "").strip()
                if len(meta_parts) >= 2
                else ""
            )
            fmt_row_m = re.search(
                r'<tr[^>]*class="format"[^>]*>(?:(?!</tr).)*?<td[^>]*>([^<]+)</td>\s*</tr>',
                det_html,
                re.S | re.I,
            )
            if fmt_row_m:
                parsed_fmt = html_lib.unescape(fmt_row_m.group(1)).replace(" format", "").strip()
                if parsed_fmt:
                    fmt_name = parsed_fmt

            org_m = re.search(r'<a[^>]*href="(/organizer/[^"]+)"[^>]*>(.*?)</a>', det_html, re.S | re.I)
            org_name = (
                html_lib.unescape(re.sub(r"<[^>]+>", "", org_m.group(2))).strip()
                if org_m
                else (meta_parts[2] if len(meta_parts) >= 3 else "Limitless TCG")
            )
            org_url = f"https://play.limitlesstcg.com{org_m.group(1).strip()}" if org_m else None

            plat_m = re.search(r'<img[^>]*class="platform"[^>]*>\s*</td>\s*<td[^>]*>(.*?)</td>', det_html, re.S | re.I)
            plat_type = html_lib.unescape(re.sub(r"<[^>]+>", "", plat_m.group(1))).strip() if plat_m else "Online"
            is_online = plat_type.lower() != "tabletop"

            disc_m = re.search(r'href="(https?://(?:discord\.gg|discord\.com/invite)/[^"]+)"', det_html, re.I)
            discord_url = disc_m.group(1).strip() if disc_m else None

            desc_html = ""
            desc_div_m = re.search(r'<div class="description">(.*?)</div>\s*</div>\s*</div>', det_html, re.S | re.I)
            if not desc_div_m:
                desc_div_m = re.search(r'<div class="description">(.*?)</div>\s*(?:<script|</div)', det_html, re.S | re.I)
            if desc_div_m:
                desc_html = re.sub(r"<script\b[^>]*>.*?</script>", "", desc_div_m.group(1), flags=re.S | re.I).strip()

            sys_slug = "pokemon"
            low_html = det_html.lower()
            for slug, code in LIMITLESS_SYSTEM_TO_CODE.items():
                if f"game={code.lower()}" in low_html or f"/{code.lower()}/" in low_html or f"/platforms/{code.lower()}/" in low_html:
                    sys_slug = slug
                    break

            reg_entries: List[Tuple[str, str, str, bool, bool]] = []
            if reg_html:
                for tr_m in re.finditer(r'<tr[^>]*data-uid="([^"]+)"[^>]*>(.*?)</tr>', reg_html, re.S | re.I):
                    uid = tr_m.group(1).strip()
                    tds = re.findall(r"<td([^>]*)>(.*?)</td>", tr_m.group(2), re.S | re.I)
                    if not uid or not tds:
                        continue
                    raw_nm = html_lib.unescape(re.sub(r"<[^>]+>", "", tds[0][1])).strip()
                    cc_m = re.search(r"\s*\[([A-Z]{2,3})\]\s*$", raw_nm)
                    country_code = cc_m.group(1) if cc_m else ""
                    clean_nm = raw_nm[: cc_m.start()].strip() if cc_m else raw_nm
                    ci_yes = bool(len(tds) >= 3 and 'data-tooltip="yes"' in f"{tds[2][0]} {tds[2][1]}".lower())
                    dl_yes = bool(len(tds) >= 4 and 'data-tooltip="yes"' in f"{tds[3][0]} {tds[3][1]}".lower())
                    reg_entries.append((uid, clean_nm or uid, country_code, ci_yes, dl_yes))

            pl_m = (
                re.search(r"(\d+)\s+registrations?", reg_html or "", re.I)
                or re.search(r"(\d+)\s+players?\s+registered", det_html, re.I)
                or re.search(r"(\d+)\s+players?", det_html, re.I)
            )
            enrolled = max(len(reg_entries), int(pl_m.group(1)) if pl_m else 0)

            players_out = []
            if reg_entries:
                pids = [f"ltcg:{u}"[:64] for u, _, _, _, _ in reg_entries]
                elo_map = _lookup_existing_player_ratings(db, pids, sys_slug)
                for uid, clean_nm, country_code, ci_yes, dl_yes in reg_entries:
                    pid = f"ltcg:{uid}"[:64]
                    players_out.append(
                        {
                            "player_id": pid,
                            "id": pid,
                            "full_name": clean_nm,
                            "first_name": clean_nm.split(" ")[0],
                            "last_name": " ".join(clean_nm.split(" ")[1:]),
                            "faction": fmt_name or "Registered",
                            "detachment": plat_type if plat_type and plat_type != "Online" else "",
                            "team": country_code,
                            "current_elo": elo_map.get(pid, 1500.0),
                            "placement": None,
                            "checked_in": ci_yes,
                            "event_wins": 0,
                            "event_losses": 0,
                            "event_draws": 0,
                            "has_list": dl_yes,
                        }
                    )
                players_out.sort(key=lambda x: -float(x.get("current_elo") or 1500.0))

            has_standings_nav = f"/tournament/{tid}/standings" in low_html
            is_started = bool(has_standings_nav and not reg_entries)
            ext_url = f"https://play.limitlesstcg.com/tournament/{urllib.parse.quote(tid)}/{'standings' if is_started else 'details'}"
            raw_meta_ltcg = {
                "platform": "limitless",
                "id": tid,
                "name": title,
                "organizer": org_name,
                "organizer_name": org_name,
                "organizer_url": org_url,
                "format": fmt_name or None,
                "format_name": fmt_name or None,
                "platform_type": plat_type,
                "discord_url": discord_url,
                "players": enrolled,
                "description": desc_html or None,
                "description_html": desc_html or None,
            }
            return _cache_and_return(
                {
                    "id": eid,
                    "name": title,
                    "event_date": ev_date,
                    "end_date": None,
                    "city": "Online" if is_online else "",
                    "state": "",
                    "country": "Global" if is_online else "",
                    "venue": org_name,
                    "venue_name": org_name,
                    "organizer_name": org_name,
                    "organizer_url": org_url,
                    "format_name": fmt_name or None,
                    "platform_type": plat_type,
                    "registration_status": "In Progress" if is_started else "Registration Open",
                    "discord_url": discord_url,
                    "description": desc_html or None,
                    "total_players": enrolled,
                    "enrolled_players": enrolled,
                    "num_rounds": _estimate_swiss_rounds(enrolled),
                    "numberOfRounds": _estimate_swiss_rounds(enrolled),
                    "current_round": 1 if is_started else 0,
                    "is_started": is_started,
                    "is_ended": False,
                    "ended": False,
                    "status": {"ended": False, "started": is_started},
                    "source_platform": "limitless",
                    "external_event_id": tid,
                    "event_url": ext_url,
                    "external_url": ext_url,
                    "using_online_reg": True,
                    "game_system": sys_slug,
                    "players": players_out,
                    "matches": [],
                    "teams": [],
                    "sync_in_progress": False,
                    "raw_json": raw_meta_ltcg,
                }
            )
        except Exception as e:
            logger.debug(f"[PlatformDiscovery] Limitless preview failed for {eid}: {e}")
            return None

    # 3. TopDeck.gg Preview (with Pre-Registered Roster + Elo Lookup + Rules Metadata)
    if prefix == "td":
        try:
            with ThreadPoolExecutor(max_workers=2 if include_standings else 1) as pool:
                f_doc = pool.submit(_http_get_text, f"{FIRESTORE_BASE_URL}/tournaments/{urllib.parse.quote(raw_tid)}", 4.0)
                f_pd = (
                    pool.submit(_http_get_text, f"https://topdeck.gg/PublicPData/{urllib.parse.quote(raw_tid)}", 3.5)
                    if include_standings
                    else None
                )
                fs_doc = json.loads(f_doc.result())
                pdata = {}
                if f_pd is not None:
                    try:
                        pdata = json.loads(f_pd.result()) or {}
                    except Exception:
                        pdata = {}

            flds = fs_doc.get("fields") or {}
            if not flds:
                return None

            name = str((flds.get("Name") or {}).get("stringValue") or raw_tid).strip()
            game_raw = str((flds.get("Game") or {}).get("stringValue") or "").strip()
            sys_slug = _map_topdeck_game(game_raw) or "mtg"
            fmt_str = str((flds.get("Format") or {}).get("stringValue") or "").strip()
            is_ffa = fmt_str.upper() in ("EDH", "CEDH", "COMMANDER")
            sd_raw = int((flds.get("StartDate") or {}).get("integerValue") or 0)
            if sd_raw > 10_000_000_000:
                sd_raw //= 1000
            ev_date = datetime.fromtimestamp(sd_raw, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if sd_raw > 0 else ""

            round_time = int((flds.get("C:RoundTime") or {}).get("integerValue") or 0)
            best_of = int((flds.get("C:BestOf") or {}).get("integerValue") or 0)
            win_pts = (flds.get("C:WinPoints") or {}).get("integerValue")
            draw_pts = (flds.get("C:DrawPoints") or {}).get("integerValue")
            pairing_type = str((flds.get("S1:R1:C:Type") or {}).get("stringValue") or "").strip()
            cap_val = int(
                (flds.get("PlayerCap") or flds.get("MaxPlayers") or flds.get("C:MaxPlayers") or {}).get("integerValue")
                or 0
            )
            custom_desc = ""
            for dk in ("Description", "Info", "Rules", "Details", "Notes"):
                cand_d = str((flds.get(dk) or {}).get("stringValue") or "").strip()
                if cand_d:
                    custom_desc = cand_d
                    break

            scoring_bits: List[str] = []
            if pairing_type:
                scoring_bits.append(pairing_type)
            if best_of > 0:
                scoring_bits.append(f"Best of {best_of}")
            if round_time > 0:
                scoring_bits.append(f"{round_time}m Rounds")
            if win_pts is not None:
                scoring_bits.append(f"Win {win_pts} pts" + (f" / Draw {draw_pts} pts" if draw_pts is not None else ""))
            scoring_summary = " • ".join(scoring_bits)

            owner_uid = ""
            enrolled_uids: List[str] = []
            has_started_round = False
            for k, v in flds.items():
                if re.match(r"^E\d+:P1$", k):
                    uval = str((v or {}).get("stringValue") or "").strip()
                    if uval and uval != "_x_":
                        enrolled_uids.append(uval)
                elif k.startswith("X:"):
                    role_s = str((((v or {}).get("mapValue") or {}).get("fields") or {}).get("role", {}).get("stringValue") or "")
                    if role_s == "owner" or not owner_uid:
                        owner_uid = k[2:]
                elif k == "S1:R1:Start":
                    has_started_round = True

            all_uids = list(dict.fromkeys(enrolled_uids + [k for k in pdata.keys() if isinstance(pdata, dict)]))
            pids = [f"td:{u}"[:64] for u in all_uids]
            elo_map = _lookup_existing_player_ratings(db, pids, sys_slug)

            from scripts.sync_multiplatform import _extract_topdeck_commander

            players_out = []
            for idx, uid in enumerate(all_uids, start=1):
                p_obj = pdata.get(uid) if isinstance(pdata, dict) and isinstance(pdata.get(uid), dict) else {}
                pname = str(p_obj.get("name") or p_obj.get("username") or f"Competitor {idx}").strip()
                pid = f"td:{uid}"[:64]
                dl_raw = str(p_obj.get("decklist") or "").strip()
                cmdr_name = _extract_topdeck_commander(dl_raw) if (is_ffa and dl_raw) else ""
                fac_label = cmdr_name or fmt_str or ("Commander Deck" if is_ffa else "Registered")
                cur_elo = elo_map.get(pid, 1500.0)
                players_out.append(
                    {
                        "player_id": pid,
                        "id": pid,
                        "full_name": pname,
                        "first_name": pname.split(" ")[0],
                        "last_name": " ".join(pname.split(" ")[1:]),
                        "faction": fac_label,
                        "detachment": "4P FFA Pod" if is_ffa else (fmt_str or "Constructed"),
                        "current_elo": cur_elo,
                        "placement": None,
                        "checked_in": True,
                        "event_wins": 0,
                        "event_losses": 0,
                        "event_draws": 0,
                        "army_list": dl_raw,
                        "list_url": f"https://topdeck.gg/deck/{raw_tid}/{uid}" if dl_raw else "",
                        "has_list": bool(dl_raw),
                    }
                )
            players_out.sort(key=lambda x: -float(x.get("current_elo") or 1500.0))

            hub = (get_topdeck_hubs_map() or {}).get(owner_uid) or {}
            is_online_td = any(w in (name or "").lower() for w in ("webcam", "spelltable", "online", "discord"))
            ext_url = f"https://topdeck.gg/bracket/{urllib.parse.quote(raw_tid)}"
            has_end = "End" in flds
            tot_p = len(players_out)
            venue_str = "Online / SpellTable" if is_online_td else (hub.get("venue") or hub.get("name") or "TopDeck.gg")
            org_str = hub.get("name") or hub.get("venue") or None

            raw_meta_td = {
                "platform": "topdeck",
                "tid": raw_tid,
                "name": name,
                "game_name": game_raw or None,
                "format": fmt_str or None,
                "format_name": fmt_str or None,
                "organizer_name": org_str,
                "platform_type": "Online" if is_online_td else "Tabletop",
                "round_time_minutes": round_time or None,
                "best_of": best_of or None,
                "pairing_type": pairing_type or None,
                "scoring_summary": scoring_summary or None,
                "player_cap": cap_val or None,
                "description": custom_desc or None,
            }

            return _cache_and_return(
                {
                    "id": eid,
                    "name": name,
                    "event_date": ev_date,
                    "end_date": ev_date if has_end else None,
                    "city": "Online" if is_online_td else (hub.get("city") or ""),
                    "state": "" if is_online_td else (hub.get("state") or ""),
                    "country": "Global" if is_online_td else "",
                    "venue": venue_str,
                    "venue_name": venue_str,
                    "address": "" if is_online_td else (hub.get("address") or ""),
                    "latitude": None if is_online_td else hub.get("lat"),
                    "longitude": None if is_online_td else hub.get("lng"),
                    "organizer_name": org_str,
                    "format_name": fmt_str or ("4P FFA Commander" if is_ffa else None),
                    "platform_type": "Online" if is_online_td else "Tabletop",
                    "registration_status": "Ended" if has_end else ("In Progress" if has_started_round else "Registration Open"),
                    "round_time_minutes": round_time or None,
                    "best_of": best_of or None,
                    "scoring_summary": scoring_summary or None,
                    "description": custom_desc or None,
                    "total_players": tot_p,
                    "enrolled_players": tot_p,
                    "player_cap": cap_val,
                    "num_tickets": cap_val,
                    "num_rounds": _estimate_swiss_rounds(tot_p),
                    "numberOfRounds": _estimate_swiss_rounds(tot_p),
                    "current_round": 1 if (has_started_round and not has_end) else 0,
                    "is_started": has_started_round and not has_end,
                    "is_ended": has_end,
                    "ended": has_end,
                    "is_ffa_event": is_ffa,
                    "match_format": "ffa" if is_ffa else "1v1",
                    "status": {"ended": has_end, "started": has_started_round},
                    "source_platform": "topdeck",
                    "external_event_id": raw_tid,
                    "event_url": ext_url,
                    "external_url": ext_url,
                    "using_online_reg": True,
                    "game_system": sys_slug,
                    "players": players_out,
                    "matches": [],
                    "teams": [],
                    "sync_in_progress": False,
                    "raw_json": raw_meta_td,
                }
            )
        except Exception as e:
            logger.debug(f"[PlatformDiscovery] TopDeck preview failed for {eid}: {e}")
            return None

    # 4. Longshanks Preview & Pre-Registered Roster
    if prefix == "ls" and raw_tid.isdigit():
        try:
            from config import resolve_canonical_faction
            from scripts.sync_multiplatform import LONGSHANKS_HOST_BY_SYSTEM, _ls_get_text

            with ThreadPoolExecutor(max_workers=2 if include_standings else 1) as pool:
                f_ev = pool.submit(_ls_get_text, f"https://www.longshanks.org/event/{raw_tid}/", 5.0, 1)
                f_st = (
                    pool.submit(
                        _ls_get_text,
                        f"https://www.longshanks.org/events/detail/panel_standings.php?event={raw_tid}&section=player",
                        4.5,
                        1,
                    )
                    if include_standings
                    else None
                )
                ev_html = f_ev.result()
                st_html = ""
                if f_st is not None:
                    try:
                        st_html = f_st.result()
                    except Exception:
                        st_html = ""

            title_m = re.search(r"<title>([^<]+)</title>", ev_html)
            raw_title = html_lib.unescape(title_m.group(1)).split("•")[0].strip() if title_m else ""
            if not raw_title or "not found" in raw_title.lower():
                return None

            sys_slug = "mcp"
            host_to_sys = {v.lower(): k for k, v in LONGSHANKS_HOST_BY_SYSTEM.items() if k != "mesbg"}
            for m_sub in re.findall(r"https://([a-z0-9-]+)\.longshanks\.org", ev_html.lower()):
                cand_host = f"https://{m_sub}.longshanks.org"
                if cand_host in host_to_sys:
                    sys_slug = host_to_sys[cand_host]
                    break
            sys_img_m = re.search(r'/systems/([a-z0-9_-]+)/logo\.png"\s+title="([^"]+)"', ev_html, re.I)
            game_display_name = html_lib.unescape(sys_img_m.group(2)).strip() if sys_img_m else ""

            dt_m = _LS_DATE_RE.search(ev_html)
            ev_date = f"{dt_m.group(1)}T12:00:00Z" if dt_m else ""

            # Parse Event Size: supports "20 of 20 players", "14 players", or "8 teams (23 players)"
            sz_cell_m = re.search(r"event_size\.png[^>]*></td>\s*<td>(.*?)</td>", ev_html, re.S | re.I)
            sz_text = " ".join(html_lib.unescape(re.sub(r"<[^>]+>", " ", sz_cell_m.group(1))).split()) if sz_cell_m else ""
            enrolled = 0
            cap = 0
            total_teams = 0
            tm_sz = re.search(r"(\d+)\s+teams?\s*\((\d+)\s+players?\)", sz_text, re.I)
            if tm_sz:
                total_teams = int(tm_sz.group(1))
                enrolled = int(tm_sz.group(2))
            else:
                sz_m = _LS_SIZE_RE.search(ev_html)
                if sz_m:
                    enrolled = int(sz_m.group(1))
                    cap = int(sz_m.group(2)) if sz_m.group(2) else 0

            # Parse Location: cell often has "Venue Name<br />City/State, Country <div class='flag'...>"
            flag_m = _LS_FLAG_RE.search(ev_html)
            region = html_lib.unescape(flag_m.group(1)).strip() if flag_m else ""
            loc_m = _LS_LOC_RE.search(ev_html)
            venue = "Longshanks"
            city_str = ""
            country_str = ""
            if loc_m:
                loc_lines = [
                    " ".join(html_lib.unescape(re.sub(r"<[^>]+>", " ", ln)).split()).strip()
                    for ln in re.split(r"<br\s*/?>", loc_m.group(1), flags=re.I)
                ]
                loc_lines = [ln for ln in loc_lines if ln]
                if len(loc_lines) >= 2:
                    venue = loc_lines[0][:140]
                    reg_line = region or loc_lines[1]
                    reg_parts = [p.strip() for p in reg_line.split(",") if p.strip()]
                    if len(reg_parts) >= 2:
                        city_str = ", ".join(reg_parts[:-1])
                        country_str = reg_parts[-1]
                    elif reg_parts:
                        country_str = reg_parts[0]
                elif len(loc_lines) == 1:
                    only_ln = loc_lines[0][:140]
                    if region and only_ln.lower() != region.lower():
                        venue = only_ln
                        reg_parts = [p.strip() for p in region.split(",") if p.strip()]
                        if len(reg_parts) >= 2:
                            city_str = ", ".join(reg_parts[:-1])
                            country_str = reg_parts[-1]
                        else:
                            city_str = only_ln
                            country_str = region
                    else:
                        venue = only_ln
                        country_str = region

            is_online = region.lower() == "virtual" or venue.lower().startswith("virtual")

            # Parse Host / Organizer(s)
            host_cell_m = re.search(r"event_host\.png[^>]*></td>\s*<td>(.*?)</td>", ev_html, re.S | re.I)
            hosts: List[str] = []
            if host_cell_m:
                for hm in re.finditer(r"<a[^>]*class=['\"]player_link['\"][^>]*>(.*?)</a>", host_cell_m.group(1), re.S | re.I):
                    h_raw = re.sub(r"<span class=['\"]nickname['\"]>.*?</span>", "", hm.group(1), flags=re.S | re.I)
                    h_clean = " ".join(html_lib.unescape(re.sub(r"<[^>]+>", " ", h_raw)).split()).strip()
                    if h_clean and h_clean not in hosts:
                        hosts.append(h_clean)
            org_name = ", ".join(hosts[:3]) if hosts else None

            # Parse Event Type & Registration Status badges
            type_m = re.search(r"event_type_icon[^>]*></div>\s*<div class=['\"]text['\"]>(.*?)</div>", ev_html, re.S | re.I)
            ev_type_str = " ".join(html_lib.unescape(re.sub(r"<[^>]+>", " ", type_m.group(1))).split()).strip() if type_m else ""
            reg_st_m = re.search(r"event_status_icon[^>]*></div>\s*<div class=['\"]text['\"]>(.*?)</div>", ev_html, re.S | re.I)
            reg_status_str = " ".join(html_lib.unescape(re.sub(r"<[^>]+>", " ", reg_st_m.group(1))).split()).strip() if reg_st_m else ""

            pair_method_m = re.search(r"<th>Pairing method</th>\s*<td>(.*?)</td>", ev_html, re.S | re.I)
            pair_method = " ".join(html_lib.unescape(re.sub(r"<[^>]+>", " ", pair_method_m.group(1))).split()).strip() if pair_method_m else ""
            fmt_detail_m = re.search(r"<th>Format</th>\s*<td>(.*?)</td>", ev_html, re.S | re.I)
            fmt_detail = " ".join(html_lib.unescape(re.sub(r"<[^>]+>", " ", fmt_detail_m.group(1))).split()).strip() if fmt_detail_m else ""
            tb_rows = re.findall(r"<tr>\s*<th>(1st|2nd|3rd)</th>\s*<td>(.*?)</td>\s*</tr>", ev_html, re.S | re.I)
            tb_summary = ", ".join(
                f"{rk}: {' '.join(html_lib.unescape(re.sub(r'<[^>]+>', ' ', tb)).split())}"
                for rk, tb in tb_rows
            )

            format_label = " • ".join(p for p in (ev_type_str or fmt_detail, pair_method) if p) or "Swiss Tournament"
            desc_lines: List[str] = []
            if ev_type_str or pair_method:
                desc_lines.append(f"<p><strong>Event Format:</strong> {html_lib.escape(format_label)}</p>")
            if sz_text:
                desc_lines.append(f"<p><strong>Field Size:</strong> {html_lib.escape(sz_text)}</p>")
            if tb_summary:
                desc_lines.append(f"<p><strong>Tiebreakers:</strong> {html_lib.escape(tb_summary)}</p>")
            ls_desc_html = "\n".join(desc_lines) or None

            # Parse Pre-Registered Players from panel_standings.php?section=player
            players_out = []
            if st_html:
                p_blocks = re.split(r'<div class="player" id="player_(\d+)">', st_html)
                raw_rows: List[Tuple[str, str, str, str, str]] = []
                for idx_b in range(1, len(p_blocks), 2):
                    r_pid = p_blocks[idx_b]
                    blk = p_blocks[idx_b + 1]
                    pid = f"ls:{r_pid}"[:64]
                    nm_m = re.search(r"pop_user\(" + re.escape(r_pid) + r",\d+\);['\"]>(.*?)</a>", blk, re.S)
                    r_nm = re.sub(r"<span class=['\"]nickname['\"]>.*?</span>", "", nm_m.group(1)) if nm_m else r_pid
                    clean_nm = " ".join(html_lib.unescape(re.sub(r"<[^>]+>", "", r_nm)).split()).strip() or f"Player {r_pid}"
                    comm_m = re.search(r"pop_community\(\d+\);['\"]>([^<]+)</a>", blk)
                    team_nm = html_lib.unescape(comm_m.group(1)).strip() if comm_m else ""
                    facs = re.findall(r'/systems/[a-z0-9_-]+/factions/[^"]+" title="([^"]+)"', blk)
                    fac_label = resolve_canonical_faction(facs[0], sys_slug, pid, resolve_placeholders=True) if facs else "Registered"
                    sec_fac = facs[1] if len(facs) > 1 else ""
                    raw_rows.append((pid, clean_nm, fac_label, sec_fac, team_nm))
                if raw_rows:
                    elo_map = _lookup_existing_player_ratings(db, [r[0] for r in raw_rows], sys_slug)
                    for pid, clean_nm, fac_label, sec_fac, team_nm in raw_rows:
                        players_out.append(
                            {
                                "player_id": pid,
                                "id": pid,
                                "full_name": clean_nm,
                                "first_name": clean_nm.split(" ")[0],
                                "last_name": " ".join(clean_nm.split(" ")[1:]),
                                "faction": fac_label,
                                "detachment": sec_fac,
                                "team": team_nm,
                                "current_elo": elo_map.get(pid, 1500.0),
                                "placement": None,
                                "checked_in": True,
                                "event_wins": 0,
                                "event_losses": 0,
                                "event_draws": 0,
                                "has_list": False,
                            }
                        )
                    players_out.sort(key=lambda x: -float(x.get("current_elo") or 1500.0))
                    enrolled = max(enrolled, len(players_out))

            is_ended_ls = "finished" in reg_status_str.lower() or "ended" in reg_status_str.lower()
            is_started_ls = "in progress" in reg_status_str.lower() or "round " in reg_status_str.lower()
            host_url = LONGSHANKS_HOST_BY_SYSTEM.get(sys_slug, "https://www.longshanks.org")
            ext_url = f"{host_url}/event/{raw_tid}/"
            raw_meta_ls = {
                "platform": "longshanks",
                "tid": raw_tid,
                "name": raw_title,
                "game_name": game_display_name or None,
                "region": region or None,
                "organizer_name": org_name,
                "venue_name": "Longshanks Virtual" if is_online else (venue or "Longshanks"),
                "format_name": format_label,
                "platform_type": "Online" if is_online else "Tabletop",
                "registration_status": reg_status_str or None,
                "enrolled_players": enrolled,
                "player_cap": cap or None,
                "description": ls_desc_html,
            }

            return _cache_and_return(
                {
                    "id": eid,
                    "name": raw_title,
                    "event_date": ev_date,
                    "end_date": ev_date if is_ended_ls else None,
                    "city": "Online" if is_online else city_str,
                    "state": "",
                    "country": "Global" if is_online else (country_str or region),
                    "venue": "Longshanks Virtual" if is_online else (venue or "Longshanks"),
                    "venue_name": "Longshanks Virtual" if is_online else (venue or "Longshanks"),
                    "organizer_name": org_name,
                    "format_name": format_label,
                    "platform_type": "Online" if is_online else "Tabletop",
                    "registration_status": reg_status_str or "Registration Open",
                    "description": ls_desc_html,
                    "total_players": enrolled,
                    "enrolled_players": enrolled,
                    "total_teams": total_teams,
                    "is_team_event": bool(total_teams > 0 or "team" in ev_type_str.lower()),
                    "player_cap": cap,
                    "num_tickets": cap,
                    "num_rounds": _estimate_swiss_rounds(max(enrolled, cap)),
                    "numberOfRounds": _estimate_swiss_rounds(max(enrolled, cap)),
                    "current_round": 1 if is_started_ls else 0,
                    "is_started": is_started_ls,
                    "is_ended": is_ended_ls,
                    "ended": is_ended_ls,
                    "status": {"ended": is_ended_ls, "started": is_started_ls},
                    "source_platform": "longshanks",
                    "external_event_id": raw_tid,
                    "event_url": ext_url,
                    "external_url": ext_url,
                    "using_online_reg": True,
                    "game_system": sys_slug,
                    "players": players_out,
                    "matches": [],
                    "teams": [],
                    "sync_in_progress": False,
                    "raw_json": raw_meta_ls,
                }
            )
        except Exception as e:
            logger.debug(f"[PlatformDiscovery] Longshanks preview failed for {eid}: {e}")
            return None

    return None
