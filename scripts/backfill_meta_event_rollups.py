#!/usr/bin/env python3
"""
Backfill and verify pre-aggregated Meta Intel tournament rollups (`events` classification columns,
`meta_event_matchups`, and `meta_event_runs`) across all game systems in PostgreSQL / Cloud SQL.

Idempotent, chunked, and safe to run live with zero downtime while web traffic serves uninterrupted.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import normalize_game_system
from database import get_database

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.backfill_meta_rollups")


def _discover_active_systems(db: Any) -> List[str]:
    if not hasattr(db, "get_connection"):
        return ["40k", "aos", "mtg", "pokemon", "one_piece"]
    with db.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT COALESCE(game_system, '40k') AS gs
                FROM events
                UNION
                SELECT DISTINCT COALESCE(game_system, '40k') AS gs
                FROM player_ratings;
                """
            )
            rows = cur.fetchall() or []
    priority = ["40k", "aos", "mtg", "pokemon", "one_piece", "sw_unlimited", "lorcana", "flesh_blood", "digimon", "mcp", "sw_legion"]
    found = sorted({normalize_game_system(str(r[0] or "40k"), default="40k") for r in rows if r and r[0]})
    ordered = [s for s in priority if s in found] + [s for s in found if s not in priority]
    return ordered or ["40k"]


def run_meta_rollup_backfill(
    game_system: str = "all",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    batch_size: int = 400,
    only_pending: bool = False,
    prewarm_meta: bool = True,
) -> Dict[str, Any]:
    t0 = time.time()
    db = get_database()
    if hasattr(db, "_ensure_meta_rollup_columns_and_tables"):
        db._ensure_meta_rollup_columns_and_tables()

    raw_arg = (game_system or "all").strip().lower()
    if raw_arg in ("all", "*"):
        systems = _discover_active_systems(db)
    else:
        systems = [
            normalize_game_system(tok.strip(), default=tok.strip())
            for tok in re.split(r"[,+]", raw_arg)
            if tok.strip()
        ]

    logger.info(f"🚀 Starting Meta Event Rollups backfill across {len(systems)} system(s): {systems}")
    per_system: Dict[str, Any] = {}
    total_events = 0
    total_mu_rows = 0
    total_run_rows = 0

    for sys_slug in systems:
        s_t0 = time.time()
        res = db.refresh_meta_event_rollups(
            game_system=sys_slug,
            start_date=start_date,
            end_date=end_date,
            batch_size=batch_size,
            mark_ready=True,
            only_pending=only_pending,
        )
        per_system[sys_slug] = res
        ev_c = int(res.get("events_classified") or res.get("events_processed") or 0)
        mu_c = int(res.get("matchup_rows_written") or res.get("matchup_rows") or 0)
        rn_c = int(res.get("run_rows_written") or res.get("run_rows") or 0)
        total_events += ev_c
        total_mu_rows += mu_c
        total_run_rows += rn_c
        logger.info(
            f"✅ [{sys_slug.upper()}] Classified {ev_c:,} events -> {mu_c:,} matchup rollup rows, "
            f"{rn_c:,} run rows in {time.time() - s_t0:.1f}s"
        )

    if raw_arg in ("all", "*") and hasattr(db, "get_connection") and not start_date:
        try:
            with db.get_connection() as conn:
                with conn.cursor() as cur:
                    # Clean up any wargame events previously tagged 'commander' before wargame format priority fix
                    cur.execute(
                        """
                        UPDATE events
                        SET format_tag = CASE
                            WHEN COALESCE(points, 2000) BETWEEN 250 AND 1500 THEN 'incursion_1000'
                            ELSE 'standard_2000'
                        END
                        WHERE COALESCE(game_system, '40k') IN (
                            '40k', 'aos', 'the_old_world', 'horus_heresy', 'kings_of_war', 'conquest', 'bolt_action'
                        )
                          AND format_tag = 'commander';
                        """
                    )
                    cur.execute(
                        """
                        INSERT INTO system_settings (key, value, updated_at)
                        VALUES ('meta_event_rollups_v1', 'ready', NOW())
                        ON CONFLICT (key) DO UPDATE SET value = 'ready', updated_at = NOW();
                        """
                    )
                conn.commit()
                old_autocommit = getattr(conn, "autocommit", False)
                try:
                    conn.autocommit = True
                    with conn.cursor() as vcur:
                        logger.info("🧹 Running VACUUM ANALYZE on events, meta_event_matchups, and meta_event_runs for instant Index-Only Scans...")
                        vcur.execute("VACUUM ANALYZE events;")
                        vcur.execute("VACUUM ANALYZE meta_event_matchups;")
                        vcur.execute("VACUUM ANALYZE meta_event_runs;")
                finally:
                    conn.autocommit = old_autocommit
            if hasattr(db, "invalidate_all_caches"):
                db.invalidate_all_caches(purge_l2=True)
        except Exception as mark_err:
            logger.warning(f"Notice marking global meta_event_rollups_v1 ready: {mark_err}")

    if prewarm_meta and hasattr(db, "prewarm_meta_intel_presets"):
        top_warm = [s for s in systems if s in ("40k", "aos", "mtg", "pokemon", "one_piece", "sw_unlimited", "lorcana", "flesh_blood", "mcp")]
        for sys_w in top_warm:
            try:
                warmed = db.prewarm_meta_intel_presets(sys_w, presets=["30d", "90d", "1yr", "all"], force_refresh=True)
                logger.info(f"🔥 Prewarmed {warmed} L2 Meta Intel presets for {sys_w.upper()}")
            except Exception as w_err:
                logger.warning(f"Notice prewarming {sys_w}: {w_err}")

    elapsed = round(time.time() - t0, 2)
    summary = {
        "status": "SUCCESS",
        "systems_count": len(systems),
        "total_events_classified": total_events,
        "total_matchup_rows": total_mu_rows,
        "total_run_rows": total_run_rows,
        "elapsed_seconds": elapsed,
        "systems": per_system,
    }
    logger.info(
        f"🎉 Backfill finished in {elapsed}s: {total_events:,} events, "
        f"{total_mu_rows:,} matchup rows, {total_run_rows:,} run rows."
    )
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill pre-aggregated Meta Event Rollups")
    parser.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "all"))
    parser.add_argument("--start-date", default=None)
    parser.add_argument("--end-date", default=None)
    parser.add_argument("--batch-size", type=int, default=400)
    parser.add_argument("--only-pending", action="store_true")
    parser.add_argument("--skip-prewarm-meta", action="store_true")
    args, _ = parser.parse_known_args()
    out = run_meta_rollup_backfill(
        game_system=args.game_system,
        start_date=args.start_date,
        end_date=args.end_date,
        batch_size=args.batch_size,
        only_pending=args.only_pending,
        prewarm_meta=not args.skip_prewarm_meta,
    )
    print(json.dumps(out, indent=2, default=str))
