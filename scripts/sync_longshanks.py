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

from scripts.sync_multiplatform import (
    _http_get_text,
    finalize_platform_sync,
    get_sync_db,
    import_live_longshanks_tournaments,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.longshanks_sync")

LONGSHANKS_HOST_BY_SYSTEM = {
    "mcp": "https://mcp.longshanks.org",
    "aos": "https://aos.longshanks.org",
    "40k": "https://40k.longshanks.org",
    "the_old_world": "https://tow.longshanks.org",
    "horus_heresy": "https://hh.longshanks.org",
    "kill_team": "https://kt.longshanks.org",
    "sw_legion": "https://legion.longshanks.org",
    "battletech": "https://bt.longshanks.org",
}


def discover_longshanks_targets(
    game_system: str = "mcp",
    max_events: int = 10,
) -> List[Tuple[str, str]]:
    """Discovers recent completed Longshanks events from the system subdomain."""
    target_sys = (game_system or "mcp").strip().lower()
    systems = ["mcp"] if target_sys in ("all", "other") else [target_sys]
    discovered: List[Tuple[str, str]] = []

    for sys_slug in systems:
        host = LONGSHANKS_HOST_BY_SYSTEM.get(sys_slug, "https://www.longshanks.org")
        try:
            html_txt = _http_get_text(f"{host}/events/")
            eids = []
            for m in re.finditer(r"/event/(\d+)/", html_txt):
                eid = m.group(1)
                if eid not in eids:
                    eids.append(eid)
            for eid in eids[: max(1, max_events)]:
                discovered.append((sys_slug, eid))
        except Exception as e:
            logger.warning(f"⚠️ [LongshanksSync:{sys_slug.upper()}] Discovery notice: {e}")

    return discovered


def run_longshanks_sync(
    game_system: str = "mcp",
    days: int = 7,
    max_events: Optional[int] = 10,
    event_ids: Optional[List[Tuple[str, str]]] = None,
    sqlite_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Executes the Longshanks tournament sync and incremental Elo reconstruction."""
    logger.info(f"🚀 Starting Longshanks Sync Job (game_system={game_system}, days={days}, max_events={max_events})")
    db = get_sync_db(sqlite_path=sqlite_path)

    targets = event_ids if event_ids else discover_longshanks_targets(
        game_system=game_system,
        max_events=max_events or 10,
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
    parser.add_argument("--days", type=int, default=int(os.getenv("DAYS", "7")), help="Days of past tournaments to scrape (default: 7)")
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
    )
    print(json.dumps(res, indent=2, default=str))
