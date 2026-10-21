#!/usr/bin/env python3
"""
Dedicated Cloud Run Job / CLI Sync Script for Limitless TCG (`scripts/sync_limitless.py`).
Scrapes completed tournaments (`pokemon`, `one_piece`, `digimon`, `sw_unlimited`, `lorcana`, `gundam_tcg`)
from `https://play.limitlesstcg.com/api/tournaments` (`ltcg:` prefix) and updates Elo & Meta Intel
strictly for the touched TCG game systems (never touching 40K or AoS).
"""

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.sync_multiplatform import (
    LIMITLESS_GAME_MAP,
    _http_get_json,
    finalize_platform_sync,
    get_sync_db,
    import_live_limitless_tournaments,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.limitless_sync")


def discover_limitless_targets(
    game_system: str = "all",
    days: int = 7,
    max_events: Optional[int] = 25,
    min_players: int = 8,
) -> List[Tuple[str, str]]:
    """Discovers completed Limitless TCG tournaments within the last `days` days."""
    target_sys = (game_system or "all").strip().lower()
    cutoff_dt = datetime.now(timezone.utc) - timedelta(days=max(1, int(days or 7)))
    limit_param = min(200, max(50, (max_events or 25) * 4))

    targets: List[Tuple[str, str]] = []
    try:
        catalog = _http_get_json(f"https://play.limitlesstcg.com/api/tournaments?limit={limit_param}")
        if isinstance(catalog, list):
            for item in catalog:
                g_code = str(item.get("game") or "").upper()
                sys_slug = LIMITLESS_GAME_MAP.get(g_code)
                if not sys_slug:
                    continue
                if target_sys not in ("all", "other", "tcg") and sys_slug != target_sys:
                    continue
                if int(item.get("players") or 0) < min_players:
                    continue
                raw_date = str(item.get("date") or "")[:19]
                if raw_date:
                    try:
                        ev_dt = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
                        if ev_dt.tzinfo is None:
                            ev_dt = ev_dt.replace(tzinfo=timezone.utc)
                        if ev_dt < cutoff_dt:
                            continue
                    except Exception:
                        pass
                tid = str(item.get("id") or "").strip()
                if tid:
                    targets.append((sys_slug, tid))
                    if max_events and len(targets) >= max_events:
                        break
    except Exception as e:
        logger.warning(f"⚠️ [LimitlessSync] Catalog discovery notice: {e}")

    return targets


def run_limitless_sync(
    game_system: str = "all",
    days: int = 7,
    max_events: Optional[int] = 25,
    event_ids: Optional[List[Tuple[str, str]]] = None,
    sqlite_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Executes the Limitless TCG tournament sync and incremental Elo reconstruction."""
    logger.info(f"🚀 Starting Limitless TCG Sync Job (game_system={game_system}, days={days}, max_events={max_events})")
    db = get_sync_db(sqlite_path=sqlite_path)

    targets = event_ids if event_ids else discover_limitless_targets(
        game_system=game_system,
        days=days,
        max_events=max_events,
    )
    if not targets:
        logger.info("ℹ️ [LimitlessSync] No matching Limitless TCG tournaments found in window.")
        return {"platform": "limitless", "events_imported": 0, "matches_imported": 0}

    import_res = import_live_limitless_tournaments(db, explicit_tournament_ids=targets)
    touched_systems = sorted({t[0] for t in targets})
    finalize_res = finalize_platform_sync(db, touched_systems, platform_name="LimitlessTCG")

    return {
        **import_res,
        **finalize_res,
        "platform": "limitless",
        "targets_count": len(targets),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cloud Run Job: Limitless TCG tournament sync & Elo recalculation")
    parser.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "all"), help="Game system (all, pokemon, one_piece, digimon, sw_unlimited, lorcana)")
    parser.add_argument("--days", type=int, default=int(os.getenv("DAYS", "7")), help="Days of past tournaments to scrape (default: 7)")
    parser.add_argument("--max-events", type=int, default=int(os.getenv("MAX_EVENTS", "25")), help="Max tournaments to scrape (default: 25)")
    parser.add_argument("--event-ids", default="", help="Optional comma-separated sys:tournament_id pairs (e.g. pokemon:6accac388a8383117e3ea166)")
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
                explicit_pairs.append(((args.game_system if args.game_system != "all" else "pokemon"), tok))

    res = run_limitless_sync(
        game_system=args.game_system,
        days=args.days,
        max_events=args.max_events,
        event_ids=explicit_pairs,
        sqlite_path=args.sqlite_path,
    )
    print(json.dumps(res, indent=2, default=str))
