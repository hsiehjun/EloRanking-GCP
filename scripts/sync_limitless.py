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
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.sync_multiplatform import (
    LIMITLESS_GAME_MAP,
    _fetch_limitless_catalog_page,
    _fetch_limitless_ongoing_catalog_html,
    _is_limitless_catalog_slug,
    _is_valid_limitless_tid,
    finalize_platform_sync,
    get_existing_platform_event_ids,
    get_open_platform_event_targets,
    get_sync_db,
    import_live_limitless_tournaments,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.limitless_sync")

# Cloud Run task timeout is 60m; stop discovery+import early enough to leave room for the single
# finalize_platform_sync rating rebuild at the end.
DEFAULT_TIME_BUDGET_MINUTES = float(os.getenv("TIME_BUDGET_MINUTES", "45"))


DEFAULT_LIMITLESS_TARGETS: List[Tuple[str, str]] = [
    ("pokemon", "6accac388a8383117e3ea166"),
    ("pokemon", "6aced505115c12b73a5a37c5"),
    ("one_piece", "6ad092d98a8383117e3ec310"),
    ("one_piece", "6ac7892d245696afb3518d6b"),
    ("digimon", "6acfbc37115c12b73a5a3ee1"),
    ("gundam_tcg", "6aba51d7880ed327106de5f2"),
    ("pokemon", "682dd50ab1af51fdf4343c1c"),  # 2025-05-24 Historical PTCG
    ("pokemon", "648f2eecc15757099a88d1f9"),  # 2023-06-19 Historical PTCG
    ("pokemon", "6024c3f95dee5a0b00611968"),  # 2021-02-20 Historical PTCG
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


# Limitless catalog game codes -> local game system slugs (walk order for discovery).
LIMITLESS_CATALOG_GAMES: List[Tuple[str, str]] = [
    ("PTCG", "pokemon"),
    ("OP", "one_piece"),
    ("DCG", "digimon"),
    ("GUNDAM", "gundam_tcg"),
    ("LORCANA", "lorcana"),
    ("SWU", "sw_unlimited"),
    ("RB", "riftbound"),
]


def _parse_catalog_date(raw: Any) -> Optional[datetime]:
    raw_date = str(raw or "")[:19]
    if not raw_date:
        return None
    try:
        ev_dt = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
        return ev_dt if ev_dt.tzinfo else ev_dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def discover_limitless_targets(
    game_system: str = "all",
    days: int = 7,
    max_events: Optional[int] = 25,
    min_players: int = 0,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    existing_ids: Optional[set] = None,
    deadline: Optional[float] = None,
    catalog_workers: int = 8,
    stats: Optional[Dict[str, Any]] = None,
) -> List[Tuple[str, str]]:
    """
    Discovers completed Limitless TCG tournaments not yet imported, walking EVERY catalog page.

    For each game the `/tournaments/completed?format=all&type=all&time=all&show=100` catalog is
    walked newest -> oldest (pages fetched `catalog_workers` at a time) until the game has
    `max_events` new candidates, the catalog is exhausted, or the page dates fall before the
    requested window. Already-imported ids (`existing_ids`) are skipped, so repeated runs resume
    the backfill where the previous one stopped. Candidates are interleaved round-robin across
    games (newest first) and capped at `max_events` overall.

    No player-count filter is applied by default (`min_players=0`); tournaments with fewer than
    2 players cannot have pairings and are skipped without being fetched.
    """
    from concurrent.futures import ThreadPoolExecutor
    import itertools

    t0 = time.time()
    target_sys = (game_system or "all").strip().lower()
    start_dt = _parse_iso_bound(start_date, is_end=False) or (
        datetime.now(timezone.utc) - timedelta(days=max(1, int(days or 7)))
    )
    end_dt = _parse_iso_bound(end_date, is_end=True) or datetime.now(timezone.utc)
    is_backfill = bool((days or 7) >= 365 or start_date)
    time_param = "all" if is_backfill or (days or 7) > 28 else ("7days" if (days or 7) <= 7 else "4weeks")
    existing_set = existing_ids or set()
    cap = int(max_events) if max_events else None
    min_pl = max(2, int(min_players or 0))
    workers = max(1, int(catalog_workers or 1))

    games = [(g, s) for g, s in LIMITLESS_CATALOG_GAMES if target_sys in ("all", "other", "tcg") or s == target_sys]
    seen_tids: set = set()
    by_game: Dict[str, List[Tuple[str, str]]] = {}
    game_stats: Dict[str, Dict[str, Any]] = {}

    def _fetch(g_code: str, page: int) -> Tuple[int, List[Dict[str, Any]], int]:
        try:
            items, max_page = _fetch_limitless_catalog_page(
                game_code=g_code, page=page, show=100, time_filter=time_param
            )
            return page, items, max_page
        except Exception as e:
            logger.warning(f"⚠️ [LimitlessSync] Catalog page {g_code} p{page} failed: {e}")
            return page, [], -1

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for g_code, sys_slug in games:
            bucket: List[Tuple[str, str]] = []
            gs = {"pages_total": 0, "pages_scanned": 0, "listed": 0, "existing": 0, "too_small": 0, "out_of_window": 0, "new": 0, "page_errors": 0}
            game_stats[sys_slug] = gs
            by_game[sys_slug] = bucket
            if deadline is not None and time.time() >= deadline:
                logger.warning(f"⏱️ [LimitlessSync] Discovery deadline reached before {g_code}.")
                break
            try:
                ongoing_items = _fetch_limitless_ongoing_catalog_html(game_code=g_code)
            except Exception:
                ongoing_items = []
            live_cap_game = min(cap, max(4, cap // 2)) if cap is not None else 25
            for item in ongoing_items:
                tid = str(item.get("id") or "").strip().lower()
                if not (_is_valid_limitless_tid(tid) or _is_limitless_catalog_slug(tid)) or tid in seen_tids:
                    continue
                if int(item.get("players") or 0) > 0 and int(item.get("players") or 0) < min_pl:
                    continue
                seen_tids.add(tid)
                bucket.append((sys_slug, tid))
                gs["new"] += 1
                if len(bucket) >= live_cap_game:
                    break
            _, first_items, max_page = _fetch(g_code, 1)
            if max_page < 0:
                gs["page_errors"] += 1
                max_page = 1
            gs["pages_total"] = max_page
            page_batches = [[(1, first_items, False)]]
            next_page = 2
            done = False
            while not done:
                if not page_batches:
                    if next_page > max_page:
                        break
                    if deadline is not None and time.time() >= deadline:
                        logger.warning(f"⏱️ [LimitlessSync] Discovery deadline reached in {g_code} at page {next_page}/{max_page}.")
                        break
                    pages = list(range(next_page, min(max_page, next_page + workers - 1) + 1))
                    next_page = pages[-1] + 1
                    results = list(pool.map(lambda pg: _fetch(g_code, pg), pages))
                    batch = []
                    for pg, items, mp in results:
                        if mp < 0:
                            gs["page_errors"] += 1
                        batch.append((pg, items, mp < 0))
                    page_batches.append(batch)
                for pg, items, page_err in page_batches.pop(0):
                    gs["pages_scanned"] += 1
                    oldest: Optional[datetime] = None
                    for item in items:
                        gs["listed"] += 1
                        tid = str(item.get("id") or "").strip().lower()
                        if not (_is_valid_limitless_tid(tid) or _is_limitless_catalog_slug(tid)) or tid in seen_tids:
                            continue
                        seen_tids.add(tid)
                        ev_dt = _parse_catalog_date(item.get("date"))
                        if ev_dt is not None and (oldest is None or ev_dt < oldest):
                            oldest = ev_dt
                        if tid in existing_set or f"ltcg:{tid}" in existing_set:
                            gs["existing"] += 1
                            continue
                        if int(item.get("players") or 0) < min_pl:
                            gs["too_small"] += 1
                            continue
                        if ev_dt is not None and (ev_dt > end_dt or ev_dt < start_dt):
                            gs["out_of_window"] += 1
                            continue
                        if cap is None or len(bucket) < cap:
                            bucket.append((sys_slug, tid))
                            gs["new"] += 1
                    # Catalog is newest-first: stop once a whole page is older than the window or the
                    # game already has enough candidates (or the page came back empty).
                    if (
                        (cap is not None and len(bucket) >= cap)
                        or (not items and not page_err)
                        or (oldest is not None and oldest < start_dt)
                    ):
                        done = True
                        break
            logger.info(
                f"🔎 [LimitlessSync:{sys_slug}] scanned {gs['pages_scanned']}/{gs['pages_total']} pages, "
                f"{gs['listed']} listed, {gs['existing']} already imported, {gs['new']} new candidates"
            )

    targets: List[Tuple[str, str]] = []
    non_empty = [b for b in by_game.values() if b]
    for row in itertools.zip_longest(*non_empty):
        for pair in row:
            if pair is None:
                continue
            if cap is not None and len(targets) >= cap:
                break
            targets.append(pair)

    if cap is None or len(targets) < cap:
        for def_sys, def_tid in DEFAULT_LIMITLESS_TARGETS:
            if cap is not None and len(targets) >= cap:
                break
            if (
                (target_sys in ("all", "other", "tcg") or def_sys == target_sys)
                and def_tid not in seen_tids
                and def_tid not in existing_set
                and f"ltcg:{def_tid}" not in existing_set
            ):
                seen_tids.add(def_tid)
                targets.append((def_sys, def_tid))

    if stats is not None:
        stats["discovery_seconds"] = round(time.time() - t0, 1)
        stats["per_game"] = game_stats
    logger.info(f"🔎 [LimitlessSync] Discovery finished in {time.time() - t0:.1f}s: {len(targets)} targets")
    return targets


def run_limitless_sync(
    game_system: str = "all",
    days: int = 7,
    max_events: Optional[int] = 25,
    event_ids: Optional[List[Tuple[str, str]]] = None,
    sqlite_path: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    time_budget_minutes: Optional[float] = None,
    workers: int = 8,
    min_players: int = 0,
    skip_finalize: bool = False,
) -> Dict[str, Any]:
    """
    Executes the Limitless TCG tournament sync (resumable full backfill) and Elo reconstruction.

    `time_budget_minutes` bounds discovery + import so a Cloud Run Job stops cleanly (with time left
    for the single `finalize_platform_sync` rating rebuild) before its task timeout.
    """
    t0 = time.time()
    budget = DEFAULT_TIME_BUDGET_MINUTES if time_budget_minutes is None else float(time_budget_minutes)
    deadline = (t0 + budget * 60.0) if budget and budget > 0 else None
    logger.info(
        f"🚀 Starting Limitless TCG Sync Job (game_system={game_system}, days={days}, max_events={max_events}, "
        f"time_budget_minutes={budget}, workers={workers})"
    )
    db = get_sync_db(sqlite_path=sqlite_path)
    existing_ids = get_existing_platform_event_ids(db, "ltcg") if not event_ids else set()
    logger.info(f"ℹ️ [LimitlessSync] {len(existing_ids) // 2} Limitless tournaments already imported.")

    discovery_stats: Dict[str, Any] = {}
    if event_ids:
        targets = list(event_ids)
    else:
        open_targets = get_open_platform_event_targets(db, "ltcg", game_system=game_system, limit=50)
        # Discovery is cheap (one catalog page per 100 tournaments) but cap it to a fraction of the budget.
        disc_deadline = None if deadline is None else min(deadline, t0 + max(60.0, budget * 60.0 * 0.25))
        disc_targets = discover_limitless_targets(
            game_system=game_system,
            days=days,
            max_events=max_events,
            min_players=min_players,
            start_date=start_date,
            end_date=end_date,
            existing_ids=existing_ids,
            deadline=disc_deadline,
            catalog_workers=workers,
            stats=discovery_stats,
        )
        seen_open = {t[1] for t in open_targets}
        targets = list(open_targets) + [t for t in disc_targets if t[1] not in seen_open]
    if not targets:
        logger.info("ℹ️ [LimitlessSync] No matching Limitless TCG tournaments found in window.")
        return {"platform": "limitless", "events_imported": 0, "matches_imported": 0, "discovery": discovery_stats}

    import_res = import_live_limitless_tournaments(
        db, explicit_tournament_ids=targets, deadline=deadline, max_workers=workers
    )
    if not isinstance(import_res, dict):
        import_res = {}
    touched_systems = import_res.get("systems_imported")
    if touched_systems is None:
        touched_systems = sorted({t[0] for t in targets})
    finalize_res: Dict[str, Any] = {}
    if skip_finalize and touched_systems:
        # Ratings for touched systems are rebuilt by the nightly elo-rebuild-job instead.
        finalize_res = {"finalize_deferred": sorted(touched_systems)}
    elif touched_systems and int(import_res.get("events_imported") or 0) > 0:
        t_fin = time.time()
        finalize_res = finalize_platform_sync(db, sorted(touched_systems), platform_name="LimitlessTCG")
        finalize_res = {**(finalize_res or {}), "finalize_seconds": round(time.time() - t_fin, 1)}

    return {
        **import_res,
        **finalize_res,
        "platform": "limitless",
        "targets_count": len(targets),
        "discovery": discovery_stats,
        "total_seconds": round(time.time() - t0, 1),
    }


if __name__ == "__main__":
    from scripts.job_status import install_job_recorder, record_job_run
    install_job_recorder("limitless_sync")
    parser = argparse.ArgumentParser(description="Cloud Run Job: Limitless TCG tournament sync & Elo recalculation")
    parser.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "all"), help="Game system (all, pokemon, one_piece, digimon, sw_unlimited, lorcana)")
    parser.add_argument("--days", type=int, default=int(os.getenv("DAYS", "7")), help="Days of past tournaments to scrape (default: 7; use 3650 for 10yr backfill)")
    parser.add_argument("--start-date", "--from", dest="start_date", default=os.getenv("START_DATE"), help="Optional start date (YYYY-MM-DD or ISO8601)")
    parser.add_argument("--end-date", "--to", dest="end_date", default=os.getenv("END_DATE"), help="Optional end date (YYYY-MM-DD or ISO8601)")
    parser.add_argument("--max-events", type=int, default=int(os.getenv("MAX_EVENTS", "25")), help="Max tournaments to scrape (default: 25)")
    parser.add_argument("--event-ids", default="", help="Optional comma-separated sys:tournament_id pairs (e.g. pokemon:6accac388a8383117e3ea166)")
    parser.add_argument("--skip-finalize", action="store_true", default=os.getenv("SKIP_FINALIZE", "0") == "1", help="Skip Elo rebuild (left to elo-rebuild-job)")
    parser.add_argument("--time-budget-minutes", type=float, default=DEFAULT_TIME_BUDGET_MINUTES, help="Stop discovery/import after this many minutes so the job ends before the Cloud Run timeout (default: 45; 0 = unlimited)")
    parser.add_argument("--workers", type=int, default=int(os.getenv("LIMITLESS_WORKERS", "8")), help="Concurrent HTTP fetch threads for catalog pages and tournaments (default: 8)")
    parser.add_argument("--min-players", type=int, default=int(os.getenv("MIN_PLAYERS", "0")), help="Optional minimum player count (default: 0 = all sizes)")
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
        start_date=args.start_date,
        end_date=args.end_date,
        time_budget_minutes=args.time_budget_minutes,
        workers=args.workers,
        min_players=args.min_players,
        skip_finalize=args.skip_finalize,
    )
    print(json.dumps(res, indent=2, default=str))
    record_job_run("limitless_sync", {"status": "SUCCESS", "result": res})
