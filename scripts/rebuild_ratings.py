#!/usr/bin/env python3
"""
Cloud Run Job entrypoint (`elo-rebuild-job`): rebuilds player_ratings + rating_history for one or
more game systems outside the web service (no 300s request limit, dedicated memory).

Usage:
  python3 scripts/rebuild_ratings.py --game-system=mtg,pokemon [--repair-melee-metadata]
"""

import argparse
import gc
import re
import json
import logging
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.rebuild")

FULL_ENGINE_SYSTEMS = {"40k", "aos"}
DEFAULT_MULTIPLATFORM_SYSTEMS = [
    # TCGs & Board Games (Melee.gg, LimitlessTCG, TopDeck.gg)
    "mtg", "pokemon", "lorcana", "sw_unlimited", "one_piece", "digimon", "flesh_blood",
    "riftbound", "gundam_tcg", "yugioh", "cardfight_vang", "union_arena", "chrono_core_tc",
    "dbs_fusion", "grand_archive", "beyblade", "catan",
    # Miniature Wargames (Longshanks)
    "mcp", "sw_legion", "guild_ball", "warmachine", "shatterpoint", "x_wing", "malifaux",
    "middle_earth", "conquest", "kill_team", "the_old_world", "bolt_action", "blood_bowl",
    "horus_heresy", "battletech", "infinity", "asoiaf", "halo_flashpt", "starcraft_tabl",
    "warcaster_neo_", "flames_of_war", "team_yankee", "blood_and_plun", "blood_red_skie",
    "monsterpocalyp", "warcry",
]


def _resolve_multiplatform_systems(db) -> list:
    discovered = list(DEFAULT_MULTIPLATFORM_SYSTEMS)
    try:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT DISTINCT LOWER(TRIM(game_system))
                    FROM events
                    WHERE game_system IS NOT NULL AND game_system != ''
                      AND (id LIKE 'melee:%' OR id LIKE 'ltcg:%' OR id LIKE 'ls:%' OR id LIKE 'td:%');
                    """
                )
                for row in (cur.fetchall() or []):
                    val = str(row[0] if isinstance(row, (list, tuple)) else row.get("lower") or "").strip().lower()
                    if val and val not in FULL_ENGINE_SYSTEMS and val not in discovered:
                        discovered.append(val)
    except Exception as exc:
        logger.warning(f"Notice discovering multiplatform game systems, using default list: {exc}")
    return discovered


def run_rebuild(game_systems, repair_melee_metadata: bool = False, prewarm_meta: bool = True) -> dict:
    from database import get_database
    from elo import get_elo_engine
    from scripts.job_status import record_job_run

    db = get_database()
    engine = get_elo_engine()
    resolved_systems = []
    for s_tok in game_systems:
        if s_tok in ("all_multiplatform", "multiplatform"):
            for d_sys in _resolve_multiplatform_systems(db):
                if d_sys not in resolved_systems:
                    resolved_systems.append(d_sys)
        elif s_tok not in resolved_systems:
            resolved_systems.append(s_tok)
    game_systems = resolved_systems

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
        gc.collect()
        # Progress checkpoint so long multi-system runs are observable from /api/admin/job-status.
        record_job_run("rebuild", {"status": "RUNNING", "result": out})
    try:
        if hasattr(db, "invalidate_all_caches"):
            db.invalidate_all_caches(purge_l2=True)
    except Exception:
        pass
    if prewarm_meta and hasattr(db, "prewarm_meta_intel_presets"):
        for sys_one in game_systems:
            sys_res = out["systems"].get(sys_one) or {}
            if sys_res.get("status") in ("FAILED", "NO_MATCHES"):
                continue
            try:
                db.prewarm_meta_intel_presets(sys_one, presets=["90d", "all"], force_refresh=True)
            except Exception as meta_err:
                logger.warning(f"Notice prewarming Meta Intel for {sys_one}: {meta_err}")
    return out


if __name__ == "__main__":
    from scripts.job_status import install_job_recorder, record_job_run

    install_job_recorder("rebuild")
    parser = argparse.ArgumentParser(description="Rebuild Elo ratings & journeys for game systems")
    parser.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "mtg"))
    parser.add_argument("--repair-melee-metadata", action="store_true")
    parser.add_argument("--skip-prewarm-meta", action="store_true")
    args, _ = parser.parse_known_args()
    # "+" separates systems too, because Cloud Run job --args are themselves comma-separated.
    systems = [s.strip().lower() for s in re.split(r"[,+]", args.game_system) if s.strip()]
    result = run_rebuild(
        systems,
        repair_melee_metadata=args.repair_melee_metadata,
        prewarm_meta=not args.skip_prewarm_meta,
    )
    print(json.dumps(result, indent=2, default=str))
    failed = [k for k, v in result["systems"].items() if v.get("status") == "FAILED"]
    record_job_run("rebuild", {"status": "FAILED" if failed else "SUCCESS", "result": result})
    sys.exit(1 if failed else 0)
