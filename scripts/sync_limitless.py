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
    _LIMITLESS_CATALOG_CACHE,
    _fetch_limitless_completed_catalog_html,
    _http_get_json,
    finalize_platform_sync,
    get_existing_platform_event_ids,
    get_sync_db,
    import_live_limitless_tournaments,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.limitless_sync")


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


def discover_limitless_targets(
    game_system: str = "all",
    days: int = 7,
    max_events: Optional[int] = 25,
    min_players: int = 8,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    existing_ids: Optional[set] = None,
) -> List[Tuple[str, str]]:
    """Discovers completed Limitless TCG tournaments within the requested date window (supports multi-page historical backfill)."""
    target_sys = (game_system or "all").strip().lower()
    start_dt = _parse_iso_bound(start_date, is_end=False) or (datetime.now(timezone.utc) - timedelta(days=max(1, int(days or 7))))
    end_dt = _parse_iso_bound(end_date, is_end=True) or datetime.now(timezone.utc)
    is_backfill = bool((days or 7) >= 365 or start_date)
    limit_param = 200 if is_backfill else min(200, max(50, (max_events or 25) * 4))
    existing_set = existing_ids or set()
    if is_backfill:
        # Stratified multi-year milestones (2026..2020 at limit=200) first, then sequential deep pagination 2..198
        milestone_pages = [1, 10, 25, 45, 70, 95, 120, 145, 165, 180, 190]
        pages_to_scan = milestone_pages + [p for p in range(2, 199) if p not in milestone_pages]
    else:
        milestone_pages = []
        pages_to_scan = [1, 2, 3]

    targets: List[Tuple[str, str]] = []
    deferred_from_milestones: List[Tuple[str, str]] = []
    seen_tids = set()

    # 1. Primary Zero-Rate-Limit Multi-Game HTML Catalog Discovery (`/tournaments/completed`)
    html_game_pairs = [
        (g, s)
        for g, s in (
            ("PTCG", "pokemon"),
            ("OP", "one_piece"),
            ("DCG", "digimon"),
            ("GUNDAM", "gundam_tcg"),
            ("LORCANA", "lorcana"),
            ("SWU", "sw_unlimited"),
            ("RB", "riftbound"),
        )
        if target_sys in ("all", "other", "tcg") or s == target_sys
    ]
    if html_game_pairs:
        from concurrent.futures import ThreadPoolExecutor
        import itertools

        html_pages = (
            [1, 3, 7, 15, 30, 50, 75, 100] + [p for p in range(2, 120) if p not in (1, 3, 7, 15, 30, 50, 75, 100)]
            if is_backfill
            else [1, 2, 3]
        )
        active_games = list(html_game_pairs)
        time_param = "all" if is_backfill or (days or 7) > 28 else ("7days" if (days or 7) <= 7 else "4weeks")
        for h_page in html_pages:
            if not active_games or (max_events and len(targets) >= max_events):
                break
            page_results: Dict[str, List[Dict[str, Any]]] = {}
            with ThreadPoolExecutor(max_workers=min(7, len(active_games))) as pool:
                futs = {
                    g_code: pool.submit(
                        _fetch_limitless_completed_catalog_html,
                        game_code=g_code,
                        page=h_page,
                        show=100,
                        time_filter=time_param,
                    )
                    for g_code, _ in active_games
                }
                for g_code, fut in futs.items():
                    try:
                        page_results[g_code] = fut.result() or []
                    except Exception:
                        page_results[g_code] = []

            next_active_games: List[Tuple[str, str]] = []
            per_game_candidates: List[List[Tuple[str, str]]] = []
            for g_code, sys_slug in active_games:
                h_items = page_results.get(g_code) or []
                if len(h_items) >= 50 or (is_backfill and h_page == 1 and len(h_items) > 0 and g_code in ("PTCG", "OP", "DCG", "GUNDAM")):
                    next_active_games.append((g_code, sys_slug))
                g_cands: List[Tuple[str, str]] = []
                for item in h_items:
                    if int(item.get("players") or 0) < min_players:
                        continue
                    raw_date = str(item.get("date") or "")[:19]
                    if raw_date:
                        try:
                            ev_dt = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
                            if ev_dt.tzinfo is None:
                                ev_dt = ev_dt.replace(tzinfo=timezone.utc)
                            if ev_dt > end_dt or ev_dt < start_dt:
                                continue
                        except Exception:
                            pass
                    tid = str(item.get("id") or "").strip()
                    if (
                        tid
                        and tid not in seen_tids
                        and tid not in existing_set
                        and f"ltcg:{tid}" not in existing_set
                    ):
                        seen_tids.add(tid)
                        g_cands.append((sys_slug, tid))
                if g_cands:
                    per_game_candidates.append(g_cands)

            for row_tuple in itertools.zip_longest(*per_game_candidates):
                for pair in row_tuple:
                    if pair is None:
                        continue
                    targets.append(pair)
                    if max_events and len(targets) >= max_events:
                        return targets
            active_games = next_active_games

    # 2. Secondary JSON API Catalog Fallback (`/api/tournaments`) if HTML catalog yielded fewer than max_events
    try:
        per_page_quota = max(12, ((max_events or 25) - len(targets) + len(milestone_pages) - 1) // max(1, len(milestone_pages))) if is_backfill else (max_events or 25)
        for page in pages_to_scan:
            if max_events and len(targets) >= max_events:
                return targets
            url = f"https://play.limitlesstcg.com/api/tournaments?limit={limit_param}" + (f"&page={page}" if page > 1 else "")
            catalog = _http_get_json(url)
            if not isinstance(catalog, list) or not catalog:
                if page in milestone_pages:
                    continue
                break
            oldest_on_page: Optional[datetime] = None
            added_on_page = 0
            for item in catalog:
                g_code = str(item.get("game") or "PTCG").upper()
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
                        if oldest_on_page is None or ev_dt < oldest_on_page:
                            oldest_on_page = ev_dt
                        if ev_dt > end_dt or ev_dt < start_dt:
                            continue
                    except Exception:
                        pass
                tid = str(item.get("id") or "").strip()
                if tid:
                    _LIMITLESS_CATALOG_CACHE[tid] = item
                if (
                    tid
                    and tid not in seen_tids
                    and tid not in existing_set
                    and f"ltcg:{tid}" not in existing_set
                ):
                    seen_tids.add(tid)
                    if is_backfill and page in milestone_pages and added_on_page >= per_page_quota:
                        deferred_from_milestones.append((sys_slug, tid))
                    else:
                        targets.append((sys_slug, tid))
                        added_on_page += 1
                        if max_events and len(targets) >= max_events:
                            return targets
            if is_backfill and page == milestone_pages[-1] and deferred_from_milestones and max_events and (len(targets) + len(deferred_from_milestones)) >= max_events:
                for item in deferred_from_milestones:
                    if len(targets) >= max_events:
                        return targets
                    targets.append(item)
            if oldest_on_page and oldest_on_page < start_dt and page not in milestone_pages:
                break
    except Exception as e:
        logger.warning(f"⚠️ [LimitlessSync] Catalog discovery notice: {e}")

    if max_events and len(targets) < max_events and deferred_from_milestones:
        for item in deferred_from_milestones:
            if len(targets) >= max_events:
                break
            targets.append(item)

    for def_sys, def_tid in DEFAULT_LIMITLESS_TARGETS:
        if max_events and len(targets) >= max_events:
            break
        if (
            (target_sys in ("all", "other", "tcg") or def_sys == target_sys)
            and def_tid not in seen_tids
            and def_tid not in existing_set
            and f"ltcg:{def_tid}" not in existing_set
        ):
            seen_tids.add(def_tid)
            targets.append((def_sys, def_tid))

    return targets


def run_limitless_sync(
    game_system: str = "all",
    days: int = 7,
    max_events: Optional[int] = 25,
    event_ids: Optional[List[Tuple[str, str]]] = None,
    sqlite_path: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Dict[str, Any]:
    """Executes the Limitless TCG tournament sync and incremental Elo reconstruction."""
    logger.info(f"🚀 Starting Limitless TCG Sync Job (game_system={game_system}, days={days}, max_events={max_events})")
    db = get_sync_db(sqlite_path=sqlite_path)
    existing_ids = get_existing_platform_event_ids(db, "ltcg") if not event_ids else set()

    targets = event_ids if event_ids else discover_limitless_targets(
        game_system=game_system,
        days=days,
        max_events=max_events,
        start_date=start_date,
        end_date=end_date,
        existing_ids=existing_ids,
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
    parser.add_argument("--days", type=int, default=int(os.getenv("DAYS", "7")), help="Days of past tournaments to scrape (default: 7; use 3650 for 10yr backfill)")
    parser.add_argument("--start-date", "--from", dest="start_date", default=os.getenv("START_DATE"), help="Optional start date (YYYY-MM-DD or ISO8601)")
    parser.add_argument("--end-date", "--to", dest="end_date", default=os.getenv("END_DATE"), help="Optional end date (YYYY-MM-DD or ISO8601)")
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
        start_date=args.start_date,
        end_date=args.end_date,
    )
    print(json.dumps(res, indent=2, default=str))
