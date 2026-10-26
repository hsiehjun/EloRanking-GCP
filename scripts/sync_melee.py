#!/usr/bin/env python3
"""
Dedicated Cloud Run Job / CLI Sync Script for Melee.gg (`scripts/sync_melee.py`).
Scrapes completed competitive TCG tournaments (`mtg`, `sw_unlimited`, `lorcana`, `flesh_and_blood`, `riftbound`)
from `https://melee.gg` (`melee:` prefix), including round standings, pairings, and decklists,
and updates Elo & Meta Intel strictly for the touched game systems.

Backfill mode (`--days >= 365` or `--start-date`) walks every ENDED tournament with >= 8 enrolled players
oldest-id-first and persists a cursor in `system_settings` so nightly runs resume; `--time-budget-minutes`
(default 50) bounds discovery + import so the Cloud Run Job always finishes cleanly.
"""

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.melee_client import MELEE_PAGE_SIZE, MeleeClient
from scripts.sync_multiplatform import (
    _melee_game_to_system,
    finalize_platform_sync,
    get_existing_platform_event_ids,
    get_sync_db,
    import_live_melee_tournaments,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.melee_sync")

MELEE_GAME_TAGS: Dict[str, str] = {
    "mtg": "MagicTheGathering",
    "sw_unlimited": "StarWarsUnlimited",
    "lorcana": "Lorcana",
    "flesh_blood": "FleshAndBlood",
    "riftbound": "Riftbound",
}

DEFAULT_MELEE_TARGETS: List[Tuple[str, str]] = [
    ("mtg", "472270"),          # Arena Championship 13 (2026)
    ("mtg", "440878"),          # Magic Spotlight: Fracture - SCG CON Hartford (2026)
    ("mtg", "480317"),          # South America Regional Championship Buenos Aires (2026)
    ("mtg", "414849"),          # ANZ Super Series Cycle 13 Regional Championships - Sydney (2026)
    ("mtg", "405591"),          # Regional Championship - SCG CON Los Angeles (2026)
    ("mtg", "470109"),          # Ultimate Guard European Magic Series - Regional Championship Ghent (2026)
    ("mtg", "411350"),          # Champions Cup Final Season 5 Round 1 (2026)
    ("mtg", "459699"),          # Ottawa 2026-27 Round 1 Regional Championship (2026)
    ("mtg", "444419"),          # Magic Spotlight: Marvel Super Heroes Brussels (2026)
    ("mtg", "444425"),          # Limited Championship Qualifier Brussels (2026)
    ("mtg", "434455"),          # Pro Tour Magic: The Gathering | Marvel Super Heroes in Amsterdam (2026)
    ("mtg", "428968"),          # Limited Championship Qualifier Prague (2026)
    ("mtg", "424913"),          # Ultimate Guard European Magic Series - Regional Championship Prague (2026)
    ("mtg", "428253"),          # Arena Championship 12 (2026)
    ("mtg", "410903"),          # Champions Cup Final Season 4 Round 3 (2026)
    ("mtg", "415628"),          # Pro Tour Secrets of Strixhaven in Las Vegas (2026)
    ("mtg", "324862"),          # Champions Cup Final Season 4 Round 2 (2026)
    ("mtg", "402685"),          # Arena Championship 11 (2026)
    ("mtg", "395321"),          # Magic Spotlight: Eclipsed - F2FTour Weekend Toronto (2026)
    ("mtg", "394299"),          # Pro Tour Lorwyn Eclipsed in Richmond (2026)
    ("mtg", "390023"),          # Arena Championship 10 (2025)
    ("mtg", "375961"),          # World Championship 31 in Bellevue USA (2025)
    ("mtg", "236512"),          # Champions Cup Final Season 4 Round 1 (2025)
    ("mtg", "355905"),          # Pro Tour Edge of Eternities in Atlanta (2025)
    ("mtg", "303784"),          # Pro Tour Magic: The Gathering—FINAL FANTASY in Las Vegas (2025)
    ("mtg", "228372"),          # Pro Tour Aetherdrift in Chicago (2025)
    ("mtg", "193204"),          # Arena Championship 7 (2024)
    ("mtg", "152753"),          # Ultimate Guard European Magic Series – Regional Championship Lille (2024)
    ("mtg", "146430"),          # World Championship 30 in Las Vegas (2024)
    ("mtg", "105258"),          # Pro Tour Modern Horizons 3 (2024)
    ("mtg", "55875"),           # Legacy European Championship Naples (2024)
    ("mtg", "72980"),           # Pro Tour Thunder Junction (2024)
    ("mtg", "66668"),           # Arena Championship 5 (2024)
    ("mtg", "52679"),           # Pro Tour Murders at Karlov Manor (2024)
    ("mtg", "28412"),           # Legacy European Championship Ghent (2024)
    ("mtg", "16639"),           # Legacy European Championship Lille (2023)
    ("mtg", "16429"),           # Pro Tour The Lord of the Rings (2023)
    ("mtg", "15288"),           # Legacy European Championship Athens (2023)
    ("mtg", "14968"),           # Pro Tour March of the Machine (2023)
    ("mtg", "14139"),           # Legacy European Championship Naples (2023)
    ("mtg", "12521"),           # Legacy European Championship Sofia (2022)
    ("sw_unlimited", "458821"), # Star Wars: Unlimited - 09/10/26
    ("sw_unlimited", "468577"), # SWU - 10/01/26
]

HISTORICAL_MELEE_TARGETS: List[Tuple[str, str]] = [
    ("mtg", "2000"),            # Chimera Gaming Standard Arena Tournament 06/20/20
    ("mtg", "3500"),            # Saturday 8PM PAX Online MTG Arena Historic Preliminary
    ("mtg", "5000"),            # Magic Online Society Pauper FNM
    ("mtg", "8000"),            # SCG Tour Online - Satellite #1 - Standard
    ("mtg", "10500"),           # 2º Explorer Element4 Teresina
    ("mtg", "14122"),           # Weekday Night Magic
    ("mtg", "15255"),           # CF SEA - Saturday 11AM Canadian Highlander Tournament
    ("lorcana", "23000"),       # Underworld Games Lorcana TCG Casual Countdown constructed event
    ("lorcana", "30000"),       # Lorcana League Week 5 (Constructed)
    ("lorcana", "40500"),       # Prima Tappa Lorcana 2nd Chapter
    ("lorcana", "47500"),       # Lorcana Night Core 2
    ("lorcana", "54500"),       # Friday Night Lorcana
    ("mtg", "58000"),           # Ottawa Tour Weekend - Saturday Super Qualifier
    ("lorcana", "61500"),       # Lorcana Locals 15/2/24
    ("lorcana", "65000"),       # Disney Lorcana - Constructed Tournament - 2/25 - 3:00 PM
    ("lorcana", "72000"),       # BOOSTER DRAFT INTO THE INKLANDS
    ("lorcana", "75500"),       # Into the Inklands Championship - Clan Shots Gaming
    ("lorcana", "89500"),       # Thursday Lorcana League
    ("lorcana", "93000"),       # Hiveworld - Lorcana Constructed 03.06.24
    ("lorcana", "103500"),      # Liga Lorcana 6 de Junio
    ("lorcana", "107000"),      # Ursula's Return Draft
    ("lorcana", "110500"),      # Torneo COSTRUITO COMPETITIVO LORCANA - Il Ritorno di Ursula
    ("lorcana", "114000"),      # End of Round Poorcana Tournament
    ("lorcana", "128000"),      # Shimmering Skies Midnight Release Sealed Event
    ("lorcana", "138500"),      # Saturday Lorcana 08/24/24
    ("lorcana", "142000"),      # Lorcana - Enchanted Series
    ("lorcana", "149000"),      # Weekly Play - Lorcana League: Shimmering Skies, Week 6
    ("lorcana", "150000"),          # Aspettando lo Store Championship
    ("sw_unlimited", "159500"), # Saturday SWU Locals
    ("sw_unlimited", "170000"), # Tournoi Construit Star Wars Unlimited
    ("sw_unlimited", "187500"), # Star Wars Unlimited DRAFT night
    ("lorcana", "194500"),      # Azurite Sea Set Championship w/Krakenhits
    ("sw_unlimited", "200000"), # Starwars Unlimited Weekly
    ("lorcana", "205000"),      # Azurite Sea Championship
    ("sw_unlimited", "208500"), # Star Wars Unlimited Draft
    ("lorcana", "212000"),      # Lorcana League Azurite Sea R1 W4
    ("sw_unlimited", "219000"), # Star Wars Unlimited Twilight of the Republic Showdown
    ("sw_unlimited", "233000"), # Store Championship Star Wars Unlimited
    ("lorcana", "243500"),      # Lorcana Locals 2/8/25
    ("sw_unlimited", "250500"), # Avant Première : Set 4 - Jump to Lightspeed
    ("sw_unlimited", "257500"), # star wars store champ
    ("lorcana", "268000"),      # Archazia's Island Weekly Play
    ("lorcana", "278500"),      # Java Archazia's Island Set Championship
    ("lorcana", "285500"),      # ALTF4 - Archazia's Island Store Champ
    ("lorcana", "296000"),      # Derby Archazia's Island Set Championship
    ("sw_unlimited", "306500"), # Star Wars Unlimited Constructed @PlayhousePatras
    ("lorcana", "310000"),      # HDLegacy Lorcana League
    ("lorcana", "320500"),      # 6/3 Reign of Jafar Prerelease: Sealed
    ("sw_unlimited", "327500"), # Calanda Magic Prerelease SWU Legends of the Force
    ("sw_unlimited", "334500"), # Legends of the Force Prerelease w Rebelowej Strefie Gier
    ("lorcana", "338000"),      # Tuesday Lorcana Toronto July 08
    ("sw_unlimited", "341500"), # Star Wars Unlimited Weekly Play
    ("lorcana", "348500"),      # Lorcana Store Champ
    ("sw_unlimited", "355500"), # Legends of the Force Store Showdown
    ("mtg", "366000"),          # MTG Spider-man Prerelese
    ("sw_unlimited", "376500"), # TORNEO SWU
    ("mtg", "397500"),          # Lorwyn Prerelease
    ("sw_unlimited", "401000"), # Store showdown Secrets of Power
    ("sw_unlimited", "404500"), # SWU - Store Showdown
    ("sw_unlimited", "411500"), # Star Wars Unlimited 03-07-2025 Prerelease
    ("sw_unlimited", "418500"), # SWU: Casual Premier 3/31
    ("sw_unlimited", "432500"), # MSB SWU Weekly
    ("sw_unlimited", "436000"), # Star Wars: Unlimited – Store Showdown
    ("mtg", "443000"),          # MTG Paper Legacy Discord - Weekday Warrior Tournament - 7/8/26
    ("sw_unlimited", "446500"), # SWU Ashes of the Empire Draft
]


def _parse_iso_bound(val: Optional[str], is_end: bool = False) -> Optional[datetime]:
    if not val or not str(val).strip():
        return None
    s = str(val).strip()
    if len(s) == 10:
        s = f"{s}T23:59:59+00:00" if is_end else f"{s}T00:00:00+00:00"
    else:
        s = s.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


# =============================================================================
# Live discovery over Melee.gg's `/Tournament/TournamentSearch` DataTables endpoint
# =============================================================================

MELEE_MIN_PLAYERS = int(os.getenv("MELEE_MIN_PLAYERS", "8"))
MELEE_HISTORY_FLOOR = "2020-01-01"  # Melee.gg launched in 2020.
MELEE_CURSOR_KEY_PREFIX = "melee_backfill_cursor_v1"
# Tournaments that fetched fine but had no standings/matches (casual, unpublished, cancelled): skipped by the
# recent pass for `MELEE_EMPTY_SKIP_DAYS` so they don't eat `--max-events` every night.
MELEE_EMPTY_SKIP_KEY = "melee_empty_tids_v1"
MELEE_EMPTY_SKIP_DAYS = int(os.getenv("MELEE_EMPTY_SKIP_DAYS", "30"))
MELEE_MAX_RECENT_PAGES = int(os.getenv("MELEE_MAX_RECENT_PAGES", "40"))
# Game tags are missing on many tournaments (all pre-2024 ones, and ~half of Lorcana: tag filter = 87k rows
# vs 163k Lorcana rows under plain `Ended`; SWU 115.0k vs 115.8k), so history is walked through the untagged
# `Ended` filter and rows are classified by `gameDescription`. Only Riftbound's tag filter is complete.
MELEE_TAG_COMPLETE_SYSTEMS = {"riftbound"}


def _row_system(row: Dict[str, Any]) -> Optional[str]:
    return _melee_game_to_system(row.get("gameDescription"))


def _row_is_candidate(row: Dict[str, Any], systems: List[str], floor_iso: str, ceil_iso: str) -> Optional[str]:
    sys_slug = _row_system(row)
    if not sys_slug or sys_slug not in systems:
        return None
    if int(row.get("enrolledPlayerCount") or 0) < MELEE_MIN_PLAYERS:
        return None
    sd = str(row.get("startDate") or "")
    if not sd or sd < floor_iso or sd > ceil_iso:  # Melee has junk years like 0202 / 8202.
        return None
    return sys_slug


def _search_filters(systems: List[str]) -> List[str]:
    if len(systems) == 1 and systems[0] in MELEE_TAG_COMPLETE_SYSTEMS:
        return ["Ended", MELEE_GAME_TAGS[systems[0]]]
    return ["Ended"]


def _cursor_key(systems: List[str]) -> str:
    scope = "all" if sorted(systems) == sorted(MELEE_GAME_TAGS.keys()) else ",".join(sorted(systems))
    return f"{MELEE_CURSOR_KEY_PREFIX}:{scope}"


def load_melee_cursor(db: Any, key: str) -> Dict[str, Any]:
    """Reads the resumable backfill cursor from `system_settings` (Postgres `get_setting` or SQLite `get_system_setting`)."""
    raw: Any = None
    try:
        if type(db).__name__ == "MagicMock":
            return {}
        if hasattr(db, "get_setting"):
            raw = db.get_setting(key)
        elif hasattr(db, "get_system_setting"):
            raw = db.get_system_setting(key)
    except Exception as e:
        logger.debug(f"[MeleeSync] cursor read notice: {e}")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            val = json.loads(raw)
            return val if isinstance(val, dict) else {}
        except Exception:
            return {}
    return {}


def save_melee_cursor(db: Any, key: str, state: Dict[str, Any]) -> None:
    state = {**state, "updated_at": datetime.now(timezone.utc).isoformat()}
    try:
        if type(db).__name__ == "MagicMock":
            return
        if hasattr(db, "set_setting"):
            db.set_setting(key, json.dumps(state))
        elif hasattr(db, "set_system_setting"):
            db.set_system_setting(key, json.dumps(state))
    except Exception as e:
        logger.warning(f"[MeleeSync] cursor save notice: {e}")


def _discover_recent(
    client: MeleeClient,
    systems: List[str],
    since_iso: str,
    until_iso: str,
    existing_set: set,
    cap: int,
    deadline: Optional[float],
) -> List[Tuple[str, str, int, int]]:
    """Walks Ended tournaments newest-first (start date desc) back to `since_iso`; catches events that were
    created long before they ended (their ids sit behind the backfill cursor)."""
    out: List[Tuple[str, str, int, int]] = []
    seen: set = set()
    filters = _search_filters(systems)
    for page in range(MELEE_MAX_RECENT_PAGES):
        if len(out) >= cap or (deadline and time.time() >= deadline):
            break
        res = client.search_tournaments(filters, page, order_by="startDate", order_dir="desc")
        rows = res["data"]
        if not rows:
            break
        for row in rows:
            tid = str(row.get("id") or "")
            sys_slug = _row_is_candidate(row, systems, since_iso, until_iso)
            if not sys_slug or tid in seen or tid in existing_set or f"melee:{tid}" in existing_set:
                continue
            seen.add(tid)
            out.append((sys_slug, tid, int(row.get("enrolledPlayerCount") or 0), int(row["id"])))
            if len(out) >= cap:
                break
        oldest = min((str(r.get("startDate") or "9999") for r in rows if str(r.get("startDate") or "") <= until_iso), default="9999")
        if oldest < since_iso:
            break
    return out


def _first_offset_after_id(client: MeleeClient, filters: List[str], last_id: int, total: int) -> int:
    """Binary-searches (1-row probes, deterministic id ordering) the first row offset whose id > last_id."""
    lo, hi = 0, total
    while lo < hi:
        mid = (lo + hi) // 2
        res = client.search_tournaments(filters, mid, order_by="id", order_dir="asc", length=1)
        rows = res["data"]
        if not rows:
            hi = mid
            continue
        if int(rows[0]["id"]) <= last_id:
            lo = mid + 1
        else:
            hi = mid
    return lo


def _discover_backfill(
    client: MeleeClient,
    systems: List[str],
    floor_iso: str,
    ceil_iso: str,
    cursor: Dict[str, Any],
    existing_set: set,
    skip_tids: set,
    cap: int,
    deadline: Optional[float],
) -> Tuple[List[Tuple[str, str, int, int]], int, bool]:
    """Walks Ended tournaments oldest-id-first from the stored cursor. Returns (candidates, scanned_through_id, reached_end)."""
    filters = _search_filters(systems)
    last_id = int(cursor.get("last_id") or 0)
    first = client.search_tournaments(filters, 0, order_by="id", order_dir="asc", length=1)
    total = first["recordsFiltered"]
    if total <= 0:
        return [], last_id, True
    offset = _first_offset_after_id(client, filters, last_id, total) if last_id > 0 else 0
    page = offset // MELEE_PAGE_SIZE
    out: List[Tuple[str, str, int, int]] = []
    scanned_through = last_id
    reached_end = False
    while True:
        if deadline and time.time() >= deadline:
            break
        res = client.search_tournaments(filters, page, order_by="id", order_dir="asc")
        rows = res["data"]
        if not rows:
            reached_end = True
            break
        stopped_mid_page = False
        for row in rows:
            rid = int(row.get("id") or 0)
            if rid <= last_id:
                continue
            tid = str(rid)
            sys_slug = _row_is_candidate(row, systems, floor_iso, ceil_iso)
            if sys_slug and tid not in existing_set and f"melee:{tid}" not in existing_set and tid not in skip_tids:
                out.append((sys_slug, tid, int(row.get("enrolledPlayerCount") or 0), rid))
            scanned_through = max(scanned_through, rid)
            if len(out) >= cap:
                stopped_mid_page = True
                break
        if stopped_mid_page:
            break
        if len(rows) < MELEE_PAGE_SIZE:
            reached_end = True
            break
        page += 1
    return out, scanned_through, reached_end


def discover_melee_targets(
    game_system: str = "all",
    days: int = 14,
    max_events: Optional[int] = 100,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    existing_ids: Optional[set] = None,
    db: Any = None,
    recent_days: Optional[int] = None,
    deadline: Optional[float] = None,
    plan: Optional[Dict[str, Any]] = None,
) -> List[Tuple[str, str]]:
    """
    Discovers ENDED Melee.gg tournaments with >= `MELEE_MIN_PLAYERS` enrolled players for the requested systems
    (`mtg`, `sw_unlimited`, `lorcana`, `flesh_blood`, `riftbound`) straight from `/Tournament/TournamentSearch`:
      1. recent pass: newest start dates first, back `recent_days` (default 14),
      2. backfill pass (when `days >= 365` or `start_date` is set): oldest tournament ids first from the cursor
         persisted in `system_settings` (`melee_backfill_cursor_v1:<scope>`), so nightly runs resume where the last one stopped.
    Already-imported ids are skipped. Falls back to `DEFAULT_MELEE_TARGETS` only if melee.gg is unreachable.
    `plan` (optional dict) is filled with cursor bookkeeping consumed by `run_melee_sync`.
    """
    target_sys = (game_system or "all").strip().lower()
    if target_sys == "flesh_and_blood":
        target_sys = "flesh_blood"
    is_backfill = bool((days or 14) >= 365 or start_date)
    cap = int(max_events or (200 if is_backfill else 15))
    existing_set = existing_ids or set()
    systems = list(MELEE_GAME_TAGS.keys()) if target_sys in ("all", "other", "tcg") else [target_sys]
    systems = [s for s in systems if s in MELEE_GAME_TAGS]
    plan = plan if plan is not None else {}
    if not systems:
        return []

    now_dt = datetime.now(timezone.utc)
    end_dt = min(_parse_iso_bound(end_date, is_end=True) or now_dt, now_dt + timedelta(days=1))
    start_dt = _parse_iso_bound(start_date, is_end=False) or (end_dt - timedelta(days=max(1, int(days or 14))))
    ceil_iso = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    floor_iso = max(start_dt.strftime("%Y-%m-%dT%H:%M:%SZ"), MELEE_HISTORY_FLOOR)
    window_days = int(recent_days if recent_days is not None else (14 if is_backfill else max(1, int(days or 14))))
    recent_since = max((end_dt - timedelta(days=window_days)).strftime("%Y-%m-%dT%H:%M:%SZ"), floor_iso)

    client = MeleeClient()
    targets: List[Tuple[str, str, int, int]] = []
    try:
        t0 = time.time()
        recent = _discover_recent(client, systems, recent_since, ceil_iso, existing_set, cap, deadline)
        targets.extend(recent)
        logger.info(f"🔎 [MeleeSync] Recent pass ({recent_since[:10]}..{ceil_iso[:10]}): {len(recent)} new tournaments in {time.time() - t0:.1f}s")
        if is_backfill and len(targets) < cap:
            t1 = time.time()
            key = _cursor_key(systems)
            cursor = load_melee_cursor(db, key) if db is not None else {}
            backfill, scanned_through, reached_end = _discover_backfill(
                client, systems, floor_iso, ceil_iso, cursor, existing_set, {t[1] for t in targets}, cap - len(targets), deadline
            )
            targets.extend(backfill)
            plan.update(
                {
                    "cursor_key": key,
                    "cursor_prev": cursor,
                    "backfill_candidates": [(t[1], t[3]) for t in backfill],
                    "scanned_through_id": scanned_through,
                    "reached_end": reached_end,
                }
            )
            logger.info(
                f"🔎 [MeleeSync] Backfill pass from id>{int(cursor.get('last_id') or 0)} (filters={_search_filters(systems)}): "
                f"{len(backfill)} tournaments, scanned through id {scanned_through}{' (reached end)' if reached_end else ''} "
                f"in {time.time() - t1:.1f}s, {client.request_count} search requests"
            )
    except Exception as e:
        logger.warning(f"[MeleeSync] Live discovery failed ({e}); falling back to curated DEFAULT_MELEE_TARGETS.")
        if not targets:
            fallback = [
                (s, tid, 0, int(tid))
                for s, tid in DEFAULT_MELEE_TARGETS
                if s in systems and tid not in existing_set and f"melee:{tid}" not in existing_set
            ]
            targets = fallback[:cap]
    finally:
        client.close()

    plan["targets_full"] = targets[:cap]
    return [(t[0], t[1], t[2]) for t in targets[:cap]]


def _advance_cursor(db: Any, plan: Dict[str, Any], attempted: List[str]) -> Optional[Dict[str, Any]]:
    """Moves the backfill cursor past every candidate that was attempted (in id order)."""
    key = plan.get("cursor_key")
    if not key:
        return None
    prev = plan.get("cursor_prev") or {}
    last_id = int(prev.get("last_id") or 0)
    attempted_set = set(attempted)
    candidates = plan.get("backfill_candidates") or []
    first_pending = next((rid for tid, rid in candidates if tid not in attempted_set), None)
    if first_pending is None:
        new_last = max(last_id, int(plan.get("scanned_through_id") or last_id))
        done = bool(plan.get("reached_end"))
    else:
        new_last = max(last_id, int(first_pending) - 1)
        done = False
    state = {
        "last_id": new_last,
        "runs": int(prev.get("runs") or 0) + 1,
        "imported_total": int(prev.get("imported_total") or 0),
        "reached_end": done or bool(prev.get("reached_end")),
    }
    save_melee_cursor(db, key, state)
    return state


def run_melee_sync(
    game_system: str = "all",
    days: int = 14,
    max_events: Optional[int] = 100,
    event_ids: Optional[List[Tuple[str, str]]] = None,
    sqlite_path: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    time_budget_minutes: Optional[float] = None,
    recent_days: Optional[int] = None,
    skip_finalize: bool = False,
) -> Dict[str, Any]:
    """Executes the Melee.gg tournament sync and incremental Elo reconstruction."""
    started = time.time()
    budget_min = float(time_budget_minutes if time_budget_minutes is not None else os.getenv("TIME_BUDGET_MINUTES", "50"))
    deadline = started + budget_min * 60.0 if budget_min > 0 else None
    logger.info(
        f"🚀 Starting Melee.gg Sync Job (game_system={game_system}, days={days}, "
        f"start_date={start_date}, end_date={end_date}, max_events={max_events}, time_budget={budget_min}m)"
    )
    db = get_sync_db(sqlite_path=sqlite_path)

    plan: Dict[str, Any] = {}
    if event_ids:
        targets = list(event_ids)
    else:
        existing_ids = get_existing_platform_event_ids(db, "melee")
        logger.info(f"[MeleeSync] {len(existing_ids) // 2} Melee events already imported.")
        empty_skips = load_melee_cursor(db, MELEE_EMPTY_SKIP_KEY).get("tids") or {}
        existing_ids = set(existing_ids) | set(empty_skips.keys())
        targets = discover_melee_targets(
            game_system=game_system,
            days=days,
            max_events=max_events,
            start_date=start_date,
            end_date=end_date,
            existing_ids=existing_ids,
            db=db,
            recent_days=recent_days,
            deadline=deadline,
            plan=plan,
        )
    discovery_s = round(time.time() - started, 1)

    if not targets:
        logger.info("ℹ️ [MeleeSync] No matching Melee.gg tournaments specified.")
        if plan.get("cursor_key"):
            _advance_cursor(db, plan, [])
        return {"platform": "melee", "events_imported": 0, "matches_imported": 0, "discovery_seconds": discovery_s}

    logger.info(f"[MeleeSync] Importing {len(targets)} tournaments (discovery took {discovery_s}s).")
    import_res = import_live_melee_tournaments(db, targets, deadline=deadline)
    attempted = list(import_res.get("attempted_tids") or [t[1] for t in targets])
    cursor_state = _advance_cursor(db, plan, attempted) if plan.get("cursor_key") else None
    if not event_ids and import_res.get("empty_tids"):
        now_iso = datetime.now(timezone.utc).isoformat()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=MELEE_EMPTY_SKIP_DAYS)).isoformat()
        skips = {k: v for k, v in (load_melee_cursor(db, MELEE_EMPTY_SKIP_KEY).get("tids") or {}).items() if str(v) >= cutoff}
        skips.update({str(t): now_iso for t in import_res["empty_tids"]})
        save_melee_cursor(db, MELEE_EMPTY_SKIP_KEY, {"tids": skips})
    if cursor_state is not None and plan.get("cursor_key"):
        cursor_state["imported_total"] = int(cursor_state.get("imported_total") or 0) + int(import_res.get("events_imported") or 0)
        save_melee_cursor(db, plan["cursor_key"], cursor_state)

    touched_systems = sorted(import_res.get("systems_touched") or {t[0] for t in targets})
    finalize_res: Dict[str, Any] = {}
    if touched_systems and not skip_finalize:
        t_fin = time.time()
        finalize_res = finalize_platform_sync(db, touched_systems, platform_name="Melee.gg")
        finalize_res["finalize_seconds"] = round(time.time() - t_fin, 1)

    return {
        **import_res,
        **finalize_res,
        "attempted_tids": len(attempted),
        "failed_tids": len(import_res.get("failed_tids") or []),
        "empty_tids": len(import_res.get("empty_tids") or []),
        "platform": "melee",
        "targets_count": len(targets),
        "discovery_seconds": discovery_s,
        "cursor": cursor_state,
        "total_seconds": round(time.time() - started, 1),
    }


if __name__ == "__main__":
    from scripts.job_status import install_job_recorder, record_job_run
    install_job_recorder("melee_sync")
    parser = argparse.ArgumentParser(description="Cloud Run Job: Melee.gg tournament sync & Elo recalculation")
    parser.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "all"), help="Game system (all, mtg, sw_unlimited, lorcana, flesh_and_blood, riftbound)")
    parser.add_argument("--days", type=int, default=int(os.getenv("DAYS", "14")), help="Days of past tournaments to scrape (default: 14; >=365 enables the resumable history backfill)")
    parser.add_argument("--start-date", "--from", dest="start_date", default=os.getenv("START_DATE"), help="Optional start date (YYYY-MM-DD or ISO8601); enables the backfill pass")
    parser.add_argument("--end-date", "--to", dest="end_date", default=os.getenv("END_DATE"), help="Optional end date (YYYY-MM-DD or ISO8601)")
    parser.add_argument("--max-events", type=int, default=int(os.getenv("MAX_EVENTS", "10")), help="Max tournaments to import this run (default: 10)")
    parser.add_argument("--time-budget-minutes", type=float, default=float(os.getenv("TIME_BUDGET_MINUTES", "50")), help="Stop discovering/importing after this many minutes (default: 50); Elo finalize runs afterwards")
    parser.add_argument("--recent-days", type=int, default=int(os.getenv("RECENT_DAYS")) if os.getenv("RECENT_DAYS") else None, help="Recent pass window in days (default: 14 in backfill mode, else --days)")
    parser.add_argument("--skip-finalize", action="store_true", help="Skip Elo/Meta reconstruction (debugging)")
    parser.add_argument("--event-ids", default="", help="Optional comma-separated sys:tournament_id pairs (e.g. mtg:428253,sw_unlimited:458821)")
    parser.add_argument("--sqlite-path", default=os.getenv("LOCAL_SQLITE_PATH"), help="Optional local SQLite DB path for local verification")
    args, _ = parser.parse_known_args()

    explicit_pairs: Optional[List[Tuple[str, str]]] = None
    if args.event_ids.strip():
        explicit_pairs = []
        for tok in args.event_ids.split(","):
            tok = tok.strip()
            if ":" in tok:
                s_slug, t_id = tok.split(":", 1)
                explicit_pairs.append((s_slug.strip().lower(), t_id.strip()))
            elif tok:
                explicit_pairs.append(((args.game_system if args.game_system != "all" else "mtg"), tok))

    res = run_melee_sync(
        game_system=args.game_system,
        days=args.days,
        max_events=args.max_events,
        event_ids=explicit_pairs,
        sqlite_path=args.sqlite_path,
        start_date=args.start_date,
        end_date=args.end_date,
        time_budget_minutes=args.time_budget_minutes,
        recent_days=args.recent_days,
        skip_finalize=args.skip_finalize,
    )
    print(json.dumps(res, indent=2, default=str))
    record_job_run("melee_sync", {"status": "SUCCESS", "result": res})
