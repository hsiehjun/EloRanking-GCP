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


def _parse_dt_utc(val):
    if not val:
        return None
    if hasattr(val, "timestamp"):
        from datetime import timezone
        return val if getattr(val, "tzinfo", None) else val.replace(tzinfo=timezone.utc)
    from datetime import datetime, timezone
    s = str(val).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s[:25] if "+" in s[10:] else s[:19])
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _load_pending_full_rebuild_systems(db) -> set:
    pending_full = set()
    try:
        from scripts.platform_sync_state import load_sync_state
        for st_key in ("sync_state_topdeck", "sync_state_longshanks", "sync_state_melee", "sync_state_limitless"):
            st = load_sync_state(db, st_key)
            if isinstance(st, dict) and st.get("pending_full_rebuild"):
                for sys_s in st["pending_full_rebuild"]:
                    if sys_s:
                        pending_full.add(str(sys_s).strip().lower())
    except Exception:
        pass
    return pending_full


def _choose_rebuild_strategy(db, sys_one: str, requested_mode: str = "auto", pending_full: set = None) -> tuple:
    """
    Returns (strategy, meta_dict) where strategy in {'skip', 'incremental', 'full'}.
    - 'full': replays entire match history chronologically (`reconstruct_system_ratings_fast`).
      Used when explicitly requested (`--mode=full`), when ratings are empty, when >25k unranked
      matches accumulated, or when a sync job flagged `pending_full_rebuild` after importing
      historical backfill events.
    - 'incremental': fast-path incremental Elo update (`reconstruct_incremental`) in seconds for
      normal daily rolling-window sync appends (bounded by `since_date = max_rated_date - 30d`
      so PostgreSQL scans only recent tail rows via `idx_pg_matches_system_chrono`).
    - 'skip': 0 recent unranked matches and ratings already populated -> skip in <50ms.
    """
    mode_norm = (requested_mode or "auto").strip().lower()
    if mode_norm == "full":
        return "full", {"reason": "explicit_full"}
    if mode_norm == "incremental":
        return "incremental", {"reason": "explicit_incremental"}
    if pending_full and sys_one in pending_full:
        return "full", {"reason": "pending_historical_backfill"}

    pr_cnt = 0
    max_rated_dt = None
    total_done_sample = 0
    try:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) FROM (SELECT 1 FROM player_ratings WHERE game_system = %s LIMIT 10) t;",
                    (sys_one,),
                )
                r0 = cur.fetchone()
                pr_cnt = int((r0[0] if isinstance(r0, (list, tuple)) else r0.get("count", 0)) or 0) if r0 else 0
                cur.execute(
                    "SELECT MAX(last_active_date) FROM player_ratings WHERE game_system = %s;",
                    (sys_one,),
                )
                r1 = cur.fetchone()
                raw_max = (r1[0] if isinstance(r1, (list, tuple)) else r1.get("max")) if r1 else None
                max_rated_dt = _parse_dt_utc(raw_max)
                if pr_cnt == 0:
                    cur.execute(
                        "SELECT COUNT(*) FROM (SELECT 1 FROM matches WHERE is_done = TRUE AND game_system = %s LIMIT 5) t;",
                        (sys_one,),
                    )
                    r2 = cur.fetchone()
                    total_done_sample = int((r2[0] if isinstance(r2, (list, tuple)) else r2.get("count", 0)) or 0) if r2 else 0
    except Exception as exc:
        logger.warning(f"Notice inspecting rating state for {sys_one}, falling back to full: {exc}")
        return "full", {"reason": "inspect_error"}

    if pr_cnt == 0 and total_done_sample == 0:
        return "skip", {"reason": "no_matches", "unranked_count": 0}
    if pr_cnt < 10 and total_done_sample > 0:
        return "full", {"reason": "sparse_or_empty_ratings", "pr_cnt": pr_cnt}

    since_iso = None
    if max_rated_dt is not None:
        from datetime import timedelta
        since_iso = (max_rated_dt - timedelta(days=30)).strftime("%Y-%m-%dT00:00:00+00:00")

    try:
        try:
            unranked = db.get_unranked_matches(limit=25001, game_system=sys_one, since_date=since_iso)
        except TypeError:
            unranked = db.get_unranked_matches(limit=25001, game_system=sys_one)
    except Exception as exc:
        logger.warning(f"Notice checking unranked matches for {sys_one}, falling back to full: {exc}")
        return "full", {"reason": "unranked_query_error"}

    n_unranked = len(unranked)
    if n_unranked == 0:
        return "skip", {"reason": "zero_unranked_matches", "unranked_count": 0, "since_date": since_iso}
    if n_unranked > 25000:
        return "full", {"reason": "large_unranked_backlog", "unranked_count": n_unranked}

    return "incremental", {"reason": "recent_append", "unranked_count": n_unranked, "since_date": since_iso}


def _clear_pending_finalize_for_systems(db, completed_systems: set) -> None:
    if not completed_systems:
        return
    try:
        from scripts.platform_sync_state import load_sync_state, save_sync_state
        for st_key in ("sync_state_topdeck", "sync_state_longshanks", "sync_state_melee", "sync_state_limitless"):
            st = load_sync_state(db, st_key)
            if not isinstance(st, dict):
                continue
            changed = False
            for fld in ("pending_finalize", "pending_full_rebuild"):
                if st.get(fld):
                    rem = [s for s in st[fld] if s not in completed_systems]
                    if rem != st[fld]:
                        st[fld] = rem
                        changed = True
            if changed:
                save_sync_state(db, st_key, st)
    except Exception:
        pass


def run_rebuild(game_systems, repair_melee_metadata: bool = False, prewarm_meta: bool = True, mode: str = "auto") -> dict:
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

    out = {"systems": {}, "repair": None, "purge": None, "mode": mode}
    repaired_systems = set()
    if repair_melee_metadata:
        from scripts.sync_multiplatform import purge_invalid_platform_events, repair_melee_event_metadata
        out["purge"] = purge_invalid_platform_events(db)
        out["repair"] = repair_melee_event_metadata(db)
        for t_sys in (out["repair"] or {}).get("touched_systems") or []:
            if t_sys:
                repaired_systems.add(t_sys)
                if t_sys not in game_systems:
                    game_systems.append(t_sys)
    pending_full = _load_pending_full_rebuild_systems(db)
    mutated_systems = set()
    completed_ok = set()
    for sys_one in game_systems:
        t0 = time.time()
        eff_mode = "full" if sys_one in repaired_systems else mode
        strategy, strat_meta = _choose_rebuild_strategy(
            db, sys_one, requested_mode=eff_mode, pending_full=pending_full
        )
        since_arg = strat_meta.get("since_date")
        try:
            if strategy == "skip":
                res = {
                    "status": "UP_TO_DATE",
                    "strategy": "skip",
                    "game_system": sys_one,
                    **strat_meta,
                }
                completed_ok.add(sys_one)
            elif sys_one in FULL_ENGINE_SYSTEMS:
                if strategy == "incremental":
                    res = engine.reconstruct_incremental(batch_limit=50000, game_system=sys_one, since_date=since_arg)
                else:
                    res = engine.reconstruct_all_rankings(game_system=sys_one)
                mutated_systems.add(sys_one)
                completed_ok.add(sys_one)
            elif strategy == "incremental":
                inc_res = engine.reconstruct_incremental(batch_limit=50000, game_system=sys_one, since_date=since_arg)
                res = {
                    "status": inc_res.get("status", "SUCCESS"),
                    "strategy": "incremental",
                    **strat_meta,
                    **(inc_res if isinstance(inc_res, dict) else {}),
                }
                if int((inc_res or {}).get("total_new_matches", 0) or 0) > 0 or (inc_res or {}).get("self_healed"):
                    mutated_systems.add(sys_one)
                completed_ok.add(sys_one)
            else:
                res = engine.reconstruct_system_ratings_fast(game_system=sys_one)
                if isinstance(res, dict):
                    res = {"strategy": "full", **strat_meta, **res}
                if not isinstance(res, dict) or res.get("status") != "NO_MATCHES":
                    mutated_systems.add(sys_one)
                completed_ok.add(sys_one)
            if not isinstance(res, dict):
                res = {"status": "SUCCESS", "result": str(res)[:500]}
        except Exception as err:
            logger.exception(f"Rebuild failed for {sys_one}")
            res = {"status": "FAILED", "strategy": strategy, "error": str(err)}
        res["wall_seconds"] = round(time.time() - t0, 1)
        out["systems"][sys_one] = res
        logger.info(f"Rebuild[{strategy}] {sys_one}: {res}")
        gc.collect()
        # Progress checkpoint so long multi-system runs are observable from /api/admin/job-status.
        record_job_run("rebuild", {"status": "RUNNING", "result": out})
    _clear_pending_finalize_for_systems(db, completed_ok)
    if mutated_systems:
        try:
            if hasattr(db, "invalidate_all_caches"):
                db.invalidate_all_caches(purge_l2=True)
        except Exception:
            pass
    if prewarm_meta and hasattr(db, "prewarm_meta_intel_presets"):
        targets_to_warm = [s for s in game_systems if (mode == "full" or s in mutated_systems)]
        for sys_one in targets_to_warm:
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
    parser.add_argument("--mode", choices=["auto", "incremental", "full"], default=os.getenv("REBUILD_MODE", "auto"))
    parser.add_argument("--repair-melee-metadata", action="store_true")
    parser.add_argument("--skip-prewarm-meta", action="store_true")
    args, _ = parser.parse_known_args()
    # "+" separates systems too, because Cloud Run job --args are themselves comma-separated.
    systems = [s.strip().lower() for s in re.split(r"[,+]", args.game_system) if s.strip()]
    result = run_rebuild(
        systems,
        repair_melee_metadata=args.repair_melee_metadata,
        prewarm_meta=not args.skip_prewarm_meta,
        mode=args.mode,
    )
    print(json.dumps(result, indent=2, default=str))
    failed = [k for k, v in result["systems"].items() if v.get("status") == "FAILED"]
    record_job_run("rebuild", {"status": "FAILED" if failed else "SUCCESS", "result": result})
    sys.exit(1 if failed else 0)
