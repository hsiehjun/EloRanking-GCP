#!/usr/bin/env python3
"""
Dedicated Cloud Run Job / CLI Sync Script for Longshanks (`scripts/sync_longshanks.py`).
Scrapes completed tabletop & miniature wargame tournaments (`mcp`, `aos`, `40k`, `the_old_world`,
`horus_heresy`, `kill_team`, `sw_legion`, `battletech`, etc.) from `https://www.longshanks.org`
(`ls:` prefix) with polite request pacing and updates Elo & Meta Intel for touched systems.
"""

import argparse
import json
import logging
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timedelta, timezone
from scripts.sync_multiplatform import (
    LONGSHANKS_HOST_BY_SYSTEM,
    _http_get_text,
    finalize_platform_sync,
    get_existing_platform_event_ids,
    get_sync_db,
    import_live_longshanks_tournaments,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.longshanks_sync")


DEFAULT_LONGSHANKS_TARGETS: List[Tuple[str, str]] = [
    ("mcp", "36154"),  # HoC MCP Tournament & Infinity Circuit Qualifier
    ("mcp", "38479"),  # LVO 2026 MCP GT & LCQ
]

# Multi-year historical Longshanks tournaments spanning 2016–2026 (10-year archive)
HISTORICAL_LONGSHANKS_TARGETS: List[Tuple[str, str]] = [
    ("guild_ball", "391"),       # 2016-11-27 Guild Ball World Championship
    ("guild_ball", "923"),       # 2017-03-11 JFJ 2017
    ("guild_ball", "2500"),      # 2019-06-21 Third Underground Tournament
    ("mcp", "12114"),            # 2023-12-30 MCP Year-End Tournament
    ("guild_ball", "20000"),     # 2024-09-29 It's Fall Y'all
    ("mcp", "28673"),            # 2025-10-25 Autumn MCP Open
    ("shatterpoint", "38251"),   # 2026-10-18 Premier Shatterpoint Event
    ("malifaux", "34151"),       # 2026-10-10 Malifaux Championship
    ("guild_ball", "37438"),     # 2026-10-17 October Tulsa Tourney
    ("x_wing", "38580"),         # 2026-10-18 12ª Etapa LPX X-Wing
    ("middle_earth", "31084"),   # 2026-10-18 Gondor in 60 Seconds Championship
    ("mcp", "38774"),            # 2026-10-18 STWC MCP October Tournament
    ("mcp", "37920"),            # 2026-10-18 MNDGMS Monthly MCP Event
]


def discover_longshanks_targets(
    game_system: str = "mcp",
    days: int = 7,
    max_events: int = 10,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    existing_ids: Optional[set] = None,
) -> List[Tuple[str, str]]:
    """
    Discovers completed Longshanks events from `/events/history/` with date range
    filtering (`date_from`..`date_to`), multi-page pagination (`&page=1..N`),
    and multi-year 2016–2026 historical coverage across Longshanks game systems.
    """
    target_sys = (game_system or "mcp").strip().lower()
    is_backfill = bool(days >= 365 or start_date)
    existing_set = existing_ids or set()
    if target_sys in ("all", "other"):
        systems = (
            [
                "mcp",
                "guild_ball",
                "shatterpoint",
                "malifaux",
                "x_wing",
                "middle_earth",
                "sw_legion",
                "warmachine",
                "infinity",
                "conquest",
                "bolt_action",
                "battletech",
                "blood_bowl",
                "kill_team",
                "horus_heresy",
                "the_old_world",
            ]
            if is_backfill
            else ["mcp"]
        )
    else:
        systems = [target_sys]

    now_dt = datetime.now(timezone.utc)
    from_str = (str(start_date).strip()[:10] if start_date else (now_dt - timedelta(days=max(1, int(days or 7)))).strftime("%Y-%m-%d"))
    to_str = (str(end_date).strip()[:10] if end_date else now_dt.strftime("%Y-%m-%d"))

    discovered: List[Tuple[str, str]] = []
    seen_eids: set = set()

    per_sys_quota = max(8, (max_events - len(discovered) + len(systems) - 1) // max(1, len(systems))) if is_backfill else max_events
    deferred_candidates: List[Tuple[str, str]] = []

    for sys_slug in systems:
        if len(discovered) >= max_events:
            break
        host = LONGSHANKS_HOST_BY_SYSTEM.get(sys_slug, "https://www.longshanks.org")
        added_for_sys = 0
        try:
            first_url = (
                f"{host}/events/history/?rated=rated&style=tournament&size_min=6"
                f"&date_from={from_str}&date_to={to_str}"
            )
            first_html = _http_get_text(first_url)
            first_eids = list(dict.fromkeys(m.group(1) for m in re.finditer(r"/event/(\d+)/", first_html)))
            if not first_eids:
                continue
            total_pages = max([int(p) for p in re.findall(r"[?&]page=(\d+)", first_html)] or [1])
            if is_backfill and total_pages > 1:
                step = max(1, total_pages // 10)
                milestones = sorted({1, total_pages} | {min(total_pages, 1 + i * step) for i in range(1, 10)})
                pages_to_scan = milestones + [p for p in range(2, min(total_pages + 1, 80)) if p not in milestones]
            else:
                pages_to_scan = [1, 2] if total_pages >= 2 else [1]

            for page in pages_to_scan:
                if len(discovered) >= max_events:
                    break
                html_txt = first_html if page == 1 else _http_get_text(first_url + f"&page={page}")
                page_eids = first_eids if page == 1 else list(dict.fromkeys(m.group(1) for m in re.finditer(r"/event/(\d+)/", html_txt)))
                if not page_eids:
                    break
                new_on_page = 0
                for eid in page_eids:
                    if eid not in seen_eids:
                        seen_eids.add(eid)
                        new_on_page += 1
                        if eid not in existing_set and f"ls:{eid}" not in existing_set:
                            if is_backfill and len(systems) > 1 and added_for_sys >= per_sys_quota:
                                deferred_candidates.append((sys_slug, eid))
                            else:
                                discovered.append((sys_slug, eid))
                                added_for_sys += 1
                                if len(discovered) >= max_events:
                                    break
                if new_on_page == 0 or (is_backfill and len(systems) > 1 and added_for_sys >= per_sys_quota and len(deferred_candidates) >= max_events):
                    break
        except Exception as e:
            logger.warning(f"⚠️ [LongshanksSync:{sys_slug.upper()}] Discovery notice: {e}")

    if len(discovered) < max_events and deferred_candidates:
        for item in deferred_candidates:
            if len(discovered) >= max_events:
                break
            discovered.append(item)

    if len(discovered) < max_events:
        for def_sys, def_eid in list(DEFAULT_LONGSHANKS_TARGETS) + (list(HISTORICAL_LONGSHANKS_TARGETS) if is_backfill else []):
            if (
                (target_sys in ("all", "other") or def_sys == target_sys)
                and def_eid not in seen_eids
                and def_eid not in existing_set
                and f"ls:{def_eid}" not in existing_set
            ):
                seen_eids.add(def_eid)
                discovered.append((def_sys, def_eid))
                if len(discovered) >= max_events:
                    break

    return discovered[: max(2, max_events)]


def run_longshanks_sync(
    game_system: str = "mcp",
    days: int = 7,
    max_events: Optional[int] = 10,
    event_ids: Optional[List[Tuple[str, str]]] = None,
    sqlite_path: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Dict[str, Any]:
    """Executes the Longshanks tournament sync and incremental Elo reconstruction."""
    logger.info(
        f"🚀 Starting Longshanks Sync Job (game_system={game_system}, days={days}, "
        f"start_date={start_date}, end_date={end_date}, max_events={max_events})"
    )
    db = get_sync_db(sqlite_path=sqlite_path)
    existing_ids = get_existing_platform_event_ids(db, "ls") if not event_ids else set()

    targets = event_ids if event_ids else discover_longshanks_targets(
        game_system=game_system,
        days=days,
        max_events=max_events or 10,
        start_date=start_date,
        end_date=end_date,
        existing_ids=existing_ids,
    )
    if not targets:
        logger.info("ℹ️ [LongshanksSync] No matching Longshanks events found.")
        return {"platform": "longshanks", "events_imported": 0, "matches_imported": 0}

    import_res = import_live_longshanks_tournaments(db, targets)
    touched_systems = sorted({t[0] for t in targets})
    finalize_res = finalize_platform_sync(db, touched_systems, platform_name="Longshanks")

    return {
        **import_res,
        **finalize_res,
        "platform": "longshanks",
        "targets_count": len(targets),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cloud Run Job: Longshanks tournament sync & Elo recalculation")
    parser.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "mcp"), help="Game system (mcp, aos, 40k, the_old_world, etc.)")
    parser.add_argument("--days", type=int, default=int(os.getenv("DAYS", "7")), help="Days of past tournaments to scrape (default: 7; use 3650 for 10yr backfill)")
    parser.add_argument("--start-date", "--from", dest="start_date", default=os.getenv("START_DATE"), help="Optional start date (YYYY-MM-DD or ISO8601)")
    parser.add_argument("--end-date", "--to", dest="end_date", default=os.getenv("END_DATE"), help="Optional end date (YYYY-MM-DD or ISO8601)")
    parser.add_argument("--max-events", type=int, default=int(os.getenv("MAX_EVENTS", "10")), help="Max tournaments to scrape (default: 10)")
    parser.add_argument("--event-ids", default="", help="Optional comma-separated sys:event_id pairs (e.g. mcp:36154,mcp:38479)")
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
                explicit_pairs.append(((args.game_system if args.game_system != "all" else "mcp"), tok))

    res = run_longshanks_sync(
        game_system=args.game_system,
        days=args.days,
        max_events=args.max_events,
        event_ids=explicit_pairs,
        sqlite_path=args.sqlite_path,
        start_date=args.start_date,
        end_date=args.end_date,
    )
    print(json.dumps(res, indent=2, default=str))
