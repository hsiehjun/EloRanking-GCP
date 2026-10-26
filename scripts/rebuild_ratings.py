#!/usr/bin/env python3
"""
Cloud Run Job entrypoint (`elo-rebuild-job`): rebuilds player_ratings + rating_history for one or
more game systems outside the web service (no 300s request limit, dedicated memory).

Usage:
  python3 scripts/rebuild_ratings.py --game-system=mtg,pokemon [--repair-melee-metadata]
"""

import argparse
import json
import logging
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.rebuild")

FULL_ENGINE_SYSTEMS = {"40k", "aos"}


def run_rebuild(game_systems, repair_melee_metadata: bool = False) -> dict:
    from database import get_database
    from elo import get_elo_engine
    from scripts.job_status import record_job_run

    db = get_database()
    engine = get_elo_engine()
    out = {"systems": {}, "repair": None, "purge": None}
    if repair_melee_metadata:
        from scripts.sync_multiplatform import purge_invalid_platform_events, repair_melee_event_metadata
        out["purge"] = purge_invalid_platform_events(db)
        out["repair"] = repair_melee_event_metadata(db)
        for t_sys in (out["repair"] or {}).get("touched_systems") or []:
            if t_sys and t_sys not in game_systems:
                game_systems.append(t_sys)
    for sys_one in game_systems:
        t0 = time.time()
        try:
            if sys_one in FULL_ENGINE_SYSTEMS:
                # Multi-million-match systems use the chunked streaming engine (bounded memory).
                res = engine.reconstruct_all_rankings(game_system=sys_one)
            else:
                res = engine.reconstruct_system_ratings_fast(game_system=sys_one)
            if not isinstance(res, dict):
                res = {"status": "SUCCESS", "result": str(res)[:500]}
        except Exception as err:
            logger.exception(f"Rebuild failed for {sys_one}")
            res = {"status": "FAILED", "error": str(err)}
        res["wall_seconds"] = round(time.time() - t0, 1)
        out["systems"][sys_one] = res
        logger.info(f"Rebuilt {sys_one}: {res}")
        # Progress checkpoint so long multi-system runs are observable from /api/admin/job-status.
        record_job_run("rebuild", {"status": "RUNNING", "result": out})
    try:
        if hasattr(db, "invalidate_all_caches"):
            db.invalidate_all_caches(purge_l2=True)
    except Exception:
        pass
    return out


if __name__ == "__main__":
    from scripts.job_status import install_job_recorder, record_job_run

    install_job_recorder("rebuild")
    parser = argparse.ArgumentParser(description="Rebuild Elo ratings & journeys for game systems")
    parser.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "mtg"))
    parser.add_argument("--repair-melee-metadata", action="store_true")
    args, _ = parser.parse_known_args()
    systems = [s.strip().lower() for s in args.game_system.split(",") if s.strip()]
    result = run_rebuild(systems, repair_melee_metadata=args.repair_melee_metadata)
    print(json.dumps(result, indent=2, default=str))
    failed = [k for k, v in result["systems"].items() if v.get("status") == "FAILED"]
    record_job_run("rebuild", {"status": "FAILED" if failed else "SUCCESS", "result": result})
    sys.exit(1 if failed else 0)
