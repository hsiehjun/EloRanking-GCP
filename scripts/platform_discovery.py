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


def fetch_live_multiplatform_event_preview(event_id: str, db: Optional[Any] = None) -> Optional[Dict[str, Any]]:
    """
    Fetches live tournament metadata (and pre-registered competitor roster when published) for
    upcoming / unstarted `melee:`, `ltcg:`, and `td:` tournaments that have 0 matches in PostgreSQL.
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

    # 1. Melee.gg Upcoming Preview
    if prefix == "melee":
        try:
            from scripts.melee_client import MeleeClient, _HttpTransport

            mc = MeleeClient(transport="http")
            if isinstance(mc._transport, _HttpTransport):
                mc._transport.timeout = 4.5
                mc._transport.retries = 1
            try:
                page_html = mc.get_text(f"/Tournament/View/{urllib.parse.quote(raw_tid)}")
                from scripts.melee_client import parse_tournament_view

                meta = parse_tournament_view(page_html, raw_tid)
            finally:
                mc.close()

            g_low = str(meta.get("game_name") or "").strip().lower()
            sys_slug = MELEE_DESC_TO_SYSTEM.get(g_low, "mtg")
            status_low = str(meta.get("status") or "").strip().lower()
            is_ended = status_low in ("ended", "completed", "complete", "closed")
            is_started = status_low in ("in progress", "started", "active")
            enrolled = int(meta.get("enrolled_players") or 0)
            cap = int(meta.get("player_cap") or 0)
            is_online = str(meta.get("platform_type") or "").strip().lower() in ("online", "mtgo", "mtg arena", "digital")
            venue = meta.get("venue_name") or meta.get("organization_name") or "Melee.gg"
            ext_url = f"https://melee.gg/Tournament/View/{urllib.parse.quote(raw_tid)}"

            return {
                "id": eid,
                "name": meta.get("title") or f"Melee Tournament {raw_tid}",
                "event_date": meta.get("start_date") or "",
                "end_date": None,
                "city": "Online" if is_online else "",
                "state": "",
                "country": "Global" if is_online else "",
                "venue": venue,
                "venue_name": venue,
                "total_players": enrolled,
                "num_tickets": cap,
                "num_rounds": max(len(meta.get("pairing_rounds") or []), _estimate_swiss_rounds(enrolled)),
                "numberOfRounds": max(len(meta.get("pairing_rounds") or []), _estimate_swiss_rounds(enrolled)),
                "current_round": len(meta.get("pairing_rounds") or []) if is_started else 0,
                "is_started": is_started,
                "is_ended": is_ended,
                "ended": is_ended,
                "status": {"ended": is_ended, "started": is_started},
                "source_platform": "melee",
                "external_event_id": raw_tid,
                "event_url": ext_url,
                "external_url": ext_url,
                "using_online_reg": False,
                "game_system": sys_slug,
                "players": [],
                "matches": [],
                "teams": [],
                "sync_in_progress": False,
                "raw_json": meta,
            }
        except Exception as e:
            logger.debug(f"[PlatformDiscovery] Melee preview failed for {eid}: {e}")
            return None

    # 2. Limitless TCG Upcoming Preview
    if prefix == "ltcg":
        if not _HEX24_RE.match(raw_tid.lower()):
            return None
        tid = raw_tid.lower()
        try:
            det_html = _http_get_text(f"https://play.limitlesstcg.com/tournament/{tid}/details", timeout=4.5)
            title_m = re.search(r"<title>(.*?)\s*\|\s*Limitless</title>", det_html, re.S)
            title = html_lib.unescape(title_m.group(1)).strip() if title_m else ""
            if not title or "not found" in title.lower():
                return None

            tm_m = re.search(r'data-time="(\d+)"', det_html)
            if tm_m and int(tm_m.group(1)) > 0:
                ev_date = datetime.fromtimestamp(int(tm_m.group(1)) / 1000.0, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            else:
                ev_date = datetime.fromtimestamp(int(tid[:8], 16), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

            org_m = re.search(r"by\s*<a[^>]*href=\"/organizer/[^\"]*\"[^>]*>(.*?)</a>", det_html, re.S)
            org_name = html_lib.unescape(re.sub(r"<[^>]+>", "", org_m.group(1))).strip() if org_m else "Limitless TCG"
            pl_m = re.search(r"(\d+)\s+players?\s+registered", det_html, re.I) or re.search(r"(\d+)\s+players?", det_html, re.I)
            enrolled = int(pl_m.group(1)) if pl_m else 0

            sys_slug = "pokemon"
            low_html = det_html.lower()
            for slug, code in LIMITLESS_SYSTEM_TO_CODE.items():
                if f"game={code.lower()}" in low_html or f"/{code.lower()}/" in low_html:
                    sys_slug = slug
                    break

            ext_url = f"https://play.limitlesstcg.com/tournament/{tid}/details"
            return {
                "id": eid,
                "name": title,
                "event_date": ev_date,
                "end_date": None,
                "city": "Online",
                "state": "",
                "country": "Global",
                "venue": org_name,
                "venue_name": org_name,
                "total_players": enrolled,
                "num_rounds": _estimate_swiss_rounds(enrolled),
                "numberOfRounds": _estimate_swiss_rounds(enrolled),
                "current_round": 0,
                "is_started": False,
                "is_ended": False,
                "ended": False,
                "status": {"ended": False, "started": False},
                "source_platform": "limitless",
                "external_event_id": tid,
                "event_url": ext_url,
                "external_url": ext_url,
                "using_online_reg": False,
                "game_system": sys_slug,
                "players": [],
                "matches": [],
                "teams": [],
                "sync_in_progress": False,
                "raw_json": {"id": tid, "name": title, "organizer": org_name, "players": enrolled},
            }
        except Exception as e:
            logger.debug(f"[PlatformDiscovery] Limitless preview failed for {eid}: {e}")
            return None

    # 3. TopDeck.gg Upcoming Preview (with Pre-Registered Roster + Elo Lookup!)
    if prefix == "td":
        try:
            doc_url = f"{FIRESTORE_BASE_URL}/tournaments/{urllib.parse.quote(raw_tid)}"
            fs_doc = json.loads(_http_get_text(doc_url, timeout=4.0))
            flds = fs_doc.get("fields") or {}
            if not flds:
                return None

            name = str((flds.get("Name") or {}).get("stringValue") or raw_tid).strip()
            sys_slug = _map_topdeck_game((flds.get("Game") or {}).get("stringValue")) or "mtg"
            fmt_str = str((flds.get("Format") or {}).get("stringValue") or "").strip()
            is_ffa = fmt_str.upper() in ("EDH", "CEDH", "COMMANDER")
            sd_raw = int((flds.get("StartDate") or {}).get("integerValue") or 0)
            if sd_raw > 10_000_000_000:
                sd_raw //= 1000
            ev_date = datetime.fromtimestamp(sd_raw, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if sd_raw > 0 else ""

            owner_uid = ""
            enrolled_uids: List[str] = []
            for k, v in flds.items():
                if re.match(r"^E\d+:P1$", k):
                    uval = str((v or {}).get("stringValue") or "").strip()
                    if uval and uval != "_x_":
                        enrolled_uids.append(uval)
                elif k.startswith("X:") and not owner_uid:
                    owner_uid = k[2:]

            pdata: Dict[str, Any] = {}
            try:
                pdata = json.loads(_http_get_text(f"https://topdeck.gg/PublicPData/{urllib.parse.quote(raw_tid)}", timeout=3.5)) or {}
            except Exception:
                pdata = {}

            all_uids = list(dict.fromkeys(enrolled_uids + [k for k in pdata.keys() if isinstance(pdata, dict)]))
            pids = [f"td:{u}"[:64] for u in all_uids]
            elo_map = _lookup_existing_player_ratings(db, pids, sys_slug)

            players_out: List[Dict[str, Any]] = []
            for idx, uid in enumerate(all_uids, start=1):
                p_obj = pdata.get(uid) if isinstance(pdata, dict) and isinstance(pdata.get(uid), dict) else {}
                pname = str(p_obj.get("name") or p_obj.get("username") or f"Competitor {idx}").strip()
                pid = f"td:{uid}"[:64]
                dl_raw = str(p_obj.get("decklist") or "").strip()
                cur_elo = elo_map.get(pid, 1500.0)
                players_out.append(
                    {
                        "player_id": pid,
                        "id": pid,
                        "full_name": pname,
                        "first_name": pname.split(" ")[0],
                        "last_name": " ".join(pname.split(" ")[1:]),
                        "faction": fmt_str or ("Commander Deck" if is_ffa else "Registered"),
                        "detachment": "cEDH Pod" if is_ffa else (fmt_str or "Constructed"),
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
            ext_url = f"https://topdeck.gg/bracket/{urllib.parse.quote(raw_tid)}"
            has_end = "End" in flds
            tot_p = len(players_out)

            return {
                "id": eid,
                "name": name,
                "event_date": ev_date,
                "end_date": ev_date if has_end else None,
                "city": hub.get("city") or "",
                "state": hub.get("state") or "",
                "country": "",
                "venue": hub.get("venue") or "TopDeck.gg",
                "venue_name": hub.get("venue") or "TopDeck.gg",
                "address": hub.get("address") or "",
                "latitude": hub.get("lat"),
                "longitude": hub.get("lng"),
                "total_players": tot_p,
                "num_rounds": _estimate_swiss_rounds(tot_p),
                "numberOfRounds": _estimate_swiss_rounds(tot_p),
                "current_round": 0,
                "is_started": False,
                "is_ended": has_end,
                "ended": has_end,
                "is_ffa_event": is_ffa,
                "match_format": "ffa" if is_ffa else "1v1",
                "status": {"ended": has_end, "started": False},
                "source_platform": "topdeck",
                "external_event_id": raw_tid,
                "event_url": ext_url,
                "external_url": ext_url,
                "using_online_reg": False,
                "game_system": sys_slug,
                "players": players_out,
                "matches": [],
                "teams": [],
                "sync_in_progress": False,
                "raw_json": {"platform": "topdeck", "tid": raw_tid, "name": name, "format": fmt_str},
            }
        except Exception as e:
            logger.debug(f"[PlatformDiscovery] TopDeck preview failed for {eid}: {e}")
            return None

    # 4. Longshanks Upcoming / Ongoing Preview
    if prefix == "ls" and raw_tid.isdigit():
        try:
            from scripts.sync_multiplatform import LONGSHANKS_HOST_BY_SYSTEM, _ls_get_text

            ev_html = _ls_get_text(f"https://www.longshanks.org/event/{raw_tid}/", timeout=5.0, retries=1)
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

            dt_m = _LS_DATE_RE.search(ev_html)
            ev_date = f"{dt_m.group(1)}T12:00:00Z" if dt_m else ""
            sz_m = _LS_SIZE_RE.search(ev_html)
            enrolled = int(sz_m.group(1)) if sz_m else 0
            cap = int(sz_m.group(2)) if (sz_m and sz_m.group(2)) else 0
            loc_m = _LS_LOC_RE.search(ev_html)
            venue = (
                " ".join(html_lib.unescape(re.sub(r"<[^>]+>", " ", loc_m.group(1))).split())[:140]
                if loc_m
                else "Longshanks"
            )
            flag_m = _LS_FLAG_RE.search(ev_html)
            region = html_lib.unescape(flag_m.group(1)).strip() if flag_m else ""
            is_online = region.lower() == "virtual" or venue.lower().startswith("virtual ")
            host_url = LONGSHANKS_HOST_BY_SYSTEM.get(sys_slug, "https://www.longshanks.org")
            ext_url = f"{host_url}/event/{raw_tid}/"

            return {
                "id": eid,
                "name": raw_title,
                "event_date": ev_date,
                "end_date": None,
                "city": "Online" if is_online else "",
                "state": "",
                "country": "Global" if is_online else region,
                "venue": "Longshanks Virtual" if is_online else (venue or "Longshanks"),
                "venue_name": "Longshanks Virtual" if is_online else (venue or "Longshanks"),
                "total_players": enrolled,
                "num_tickets": cap,
                "num_rounds": _estimate_swiss_rounds(max(enrolled, cap)),
                "numberOfRounds": _estimate_swiss_rounds(max(enrolled, cap)),
                "current_round": 0,
                "is_started": False,
                "is_ended": False,
                "ended": False,
                "status": {"ended": False, "started": False},
                "source_platform": "longshanks",
                "external_event_id": raw_tid,
                "event_url": ext_url,
                "external_url": ext_url,
                "using_online_reg": True,
                "game_system": sys_slug,
                "players": [],
                "matches": [],
                "teams": [],
                "sync_in_progress": False,
                "raw_json": {"platform": "longshanks", "tid": raw_tid, "name": raw_title, "region": region},
            }
        except Exception as e:
            logger.debug(f"[PlatformDiscovery] Longshanks preview failed for {eid}: {e}")
            return None

    return None
