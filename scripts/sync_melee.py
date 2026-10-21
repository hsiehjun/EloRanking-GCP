#!/usr/bin/env python3
"""
Dedicated Cloud Run Job / CLI Sync Script for Melee.gg (`scripts/sync_melee.py`).
Scrapes completed competitive TCG tournaments (`mtg`, `sw_unlimited`, `lorcana`, `flesh_and_blood`, `riftbound`)
from `https://melee.gg` (`melee:` prefix), including round standings, pairings, and decklists,
and updates Elo & Meta Intel strictly for the touched game systems.
"""

import argparse
import json
import logging
import os
import sys
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.sync_multiplatform import (
    finalize_platform_sync,
    get_sync_db,
    import_live_melee_tournaments,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.melee_sync")

DEFAULT_MELEE_TARGETS: List[Tuple[str, str]] = [
    ("mtg", "428253"),          # Arena Championship 12
    ("mtg", "72980"),           # Pro Tour Thunder Junction
    ("sw_unlimited", "458821"), # Star Wars: Unlimited - 09/10/26
    ("sw_unlimited", "468577"), # SWU - 10/01/26
]


def run_melee_sync(
    game_system: str = "all",
    days: int = 14,
    max_events: Optional[int] = 10,
    event_ids: Optional[List[Tuple[str, str]]] = None,
    sqlite_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Executes the Melee.gg tournament sync and incremental Elo reconstruction."""
    logger.info(f"🚀 Starting Melee.gg Sync Job (game_system={game_system}, days={days}, max_events={max_events})")
    db = get_sync_db(sqlite_path=sqlite_path)

    target_sys = (game_system or "all").strip().lower()
    if event_ids:
        targets = event_ids
    else:
        targets = [
            (s, tid)
            for s, tid in DEFAULT_MELEE_TARGETS
            if target_sys in ("all", "other", "tcg") or s == target_sys
        ][: (max_events or 10)]

    if not targets:
        logger.info("ℹ️ [MeleeSync] No matching Melee.gg tournaments specified.")
        return {"platform": "melee", "events_imported": 0, "matches_imported": 0}

    import_res = import_live_melee_tournaments(db, targets)
    touched_systems = sorted({t[0] for t in targets})
    finalize_res = finalize_platform_sync(db, touched_systems, platform_name="Melee.gg")

    return {
        **import_res,
        **finalize_res,
        "platform": "melee",
        "targets_count": len(targets),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cloud Run Job: Melee.gg tournament sync & Elo recalculation")
    parser.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "all"), help="Game system (all, mtg, sw_unlimited, lorcana, flesh_and_blood)")
    parser.add_argument("--days", type=int, default=int(os.getenv("DAYS", "14")), help="Days of past tournaments to scrape (default: 14)")
    parser.add_argument("--max-events", type=int, default=int(os.getenv("MAX_EVENTS", "10")), help="Max tournaments to scrape (default: 10)")
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
    )
    print(json.dumps(res, indent=2, default=str))
