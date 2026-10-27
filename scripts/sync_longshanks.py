#!/usr/bin/env python3
"""
Dedicated Cloud Run Job / CLI Sync Script for Longshanks (`scripts/sync_longshanks.py`).
Scrapes completed tabletop & miniature wargame tournaments (`mcp`, `sw_legion`, `guild_ball`,
`warmachine`, `shatterpoint`, `x_wing`, `malifaux`, `middle_earth`, `40k`, `conquest`, ...) from the
Longshanks game-system subdomains (`https://<game>.longshanks.org`, `ls:` prefix) and updates Elo &
Meta Intel for the touched systems.

Resumable full-history backfill (designed for nightly Cloud Run Job runs, 60-minute timeout):
  * Discovery walks `/events/history/?date_from=..&date_to=..&page=N` per game system (newest first).
    Every run first scans a short recent window (new events), then continues the historical backfill
    from a per-system date cursor persisted in `system_settings[sync_state_longshanks]`.
  * Already imported (`ls:` events with matches) and known-unimportable ids are skipped.
  * `--max-events` caps imports per run; `--time-budget-minutes` (default 50) stops importing early
    enough to leave time for `finalize_platform_sync` (Elo rebuild + Meta Intel) of every touched system,
    using per-system finalize timings measured on previous runs.
  * Longshanks is hosted on SiteGround, which serves an `sgcaptcha` bot challenge (HTTP 202) to
    datacenter IPs such as Cloud Run egress. That is detected and reported as `status: BLOCKED`
    (instead of silently importing 0 events). Set `LONGSHANKS_PROXY_URL` to route Longshanks traffic
    through a non-datacenter egress proxy.
"""

import argparse
import html
import json
import logging
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.platform_sync_state import (
    SyncBudget,
    budgeted_import,
    load_sync_state,
    save_sync_state,
    update_finalize_estimates,
    update_resume_state,
)
from scripts.sync_multiplatform import (
    LONGSHANKS_CORE_SYSTEMS,
    LONGSHANKS_HOST_BY_SYSTEM,
    LONGSHANKS_UNLISTED_SYSTEMS,
    LongshanksBlockedError,
    _ls_get_text,
    finalize_platform_sync,
    get_existing_platform_event_ids,
    get_sync_db,
    import_live_longshanks_tournaments,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.longshanks_sync")

STATE_KEY = "sync_state_longshanks"
HISTORY_FLOOR_DATE = "2014-01-01"  # Longshanks launched in 2016; earlier floor is a cheap safety margin.
MAX_FAILS_BEFORE_SKIP = 3

DEFAULT_LONGSHANKS_TARGETS: List[Tuple[str, str]] = [
    ("mcp", "36154"),  # HoC MCP Tournament & Infinity Circuit Qualifier
    ("mcp", "38479"),  # LVO 2026 MCP GT & LCQ
]

_EVENT_BLOCK_RE = re.compile(r'<div class="event_display ([^"]*)">')
_EVENT_LINK_RE = re.compile(r'href="/event/(\d+)/">([^<]*)</a>')
_EVENT_DATE_RE = re.compile(r"event_date\.png[^>]*/?></td>\s*<td>\s*(\d{4}-\d{2}-\d{2})")
_EVENT_SIZE_RE = re.compile(r"event_size\.png[^>]*/?></td>\s*<td>\s*(\d+)(?:\s*of\s*(\d+))?")
_EVENT_LOC_RE = re.compile(r"event_location\.png[^>]*/?></td>\s*<td>(.*?)<br\s*/?>", re.S)
_EVENT_FLAG_RE = re.compile(r'class="flag" title="([^"]*)"')
_PAGE_RE = re.compile(r"[?&]page=(\d+)")


def parse_history_page(page_html: str) -> Tuple[List[Dict[str, Any]], int]:
    """Parses one `/events/history/` page into event cards and the highest page number linked."""
    cards: List[Dict[str, Any]] = []
    parts = _EVENT_BLOCK_RE.split(page_html or "")
    for i in range(1, len(parts) - 1, 2):
        classes = parts[i].split()
        blk = parts[i + 1]
        link_m = _EVENT_LINK_RE.search(blk)
        if not link_m:
            continue
        date_m = _EVENT_DATE_RE.search(blk)
        size_m = _EVENT_SIZE_RE.search(blk)
        loc_m = _EVENT_LOC_RE.search(blk)
        flag_m = _EVENT_FLAG_RE.search(blk)
        cards.append(
            {
                "eid": link_m.group(1),
                "name": html.unescape(link_m.group(2)).strip(),
                "date": date_m.group(1) if date_m else None,
                "classes": classes,
                "players": int(size_m.group(1)) if size_m else None,
                "address": " ".join(html.unescape(re.sub(r"<[^>]+>", " ", loc_m.group(1))).split())[:200] if loc_m else None,
                "region": html.unescape(flag_m.group(1)).strip() if flag_m else None,
            }
        )
    total_pages = max([int(p) for p in _PAGE_RE.findall(page_html or "")] or [1])
    return cards, total_pages


def _history_url(sys_slug: str, date_from: str, date_to: str, page: int, min_players: int) -> str:
    host = LONGSHANKS_HOST_BY_SYSTEM.get(sys_slug, "https://www.longshanks.org")
    url = f"{host}/events/history/?style=tournament&date_from={date_from}&date_to={date_to}"
    if min_players and min_players > 1:
        url += f"&size_min={int(min_players)}"
    if page > 1:
        url += f"&page={page}"
    return url


def _is_importable_card(card: Dict[str, Any], min_players: int, allow_in_progress: bool = False) -> bool:
    cls = card.get("classes") or []
    if not allow_in_progress and "finished" not in cls:
        return False  # upcoming / in progress / cancelled
    players = card.get("players")
    return players is None or players >= max(2, min_players)


def _scan_history(
    sys_slug: str,
    date_from: str,
    date_to: str,
    want: int,
    known: Set[str],
    min_players: int,
    max_pages: int = 400,
    allow_in_progress: bool = False,
) -> Tuple[List[Dict[str, Any]], bool, int]:
    """
    Walks history pages (newest first) collecting up to `want` importable cards not in `known`.
    Returns (candidates, exhausted, pages_fetched). `exhausted` = every page in the window was read.
    Raises `LongshanksBlockedError` when Longshanks serves its bot challenge.
    """
    out: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    page, total_pages, fetched = 1, 1, 0
    while page <= min(total_pages, max_pages):
        page_html = _ls_get_text(_history_url(sys_slug, date_from, date_to, page, min_players))
        fetched += 1
        cards, tp = parse_history_page(page_html)
        total_pages = max(total_pages, tp)
        if not cards:
            if page == 1 and "Event history" not in page_html:
                logger.warning(
                    f"⚠️ [LongshanksSync:{sys_slug.upper()}] Unexpected history page ({len(page_html)} bytes): {page_html[:200]!r}"
                )
            return out, True, fetched
        new_ids = 0
        for c in cards:
            if c["eid"] in seen:
                continue
            seen.add(c["eid"])
            new_ids += 1
            if c["eid"] in known or not _is_importable_card(c, min_players, allow_in_progress=allow_in_progress):
                continue
            c["system"] = sys_slug
            out.append(c)
            if len(out) >= want:
                return out, False, fetched
        if new_ids == 0:
            return out, True, fetched
        page += 1
    return out, page > total_pages, fetched


def _resolve_systems(game_system: str, include_unlisted: bool) -> List[str]:
    target = (game_system or "all").strip().lower()
    if target in ("all", "other"):
        systems = list(LONGSHANKS_CORE_SYSTEMS)
        if include_unlisted:
            systems += [s for s in LONGSHANKS_UNLISTED_SYSTEMS if s not in systems]
        return systems
    if target in ("everything", "all+unlisted"):
        return list(LONGSHANKS_CORE_SYSTEMS) + [s for s in LONGSHANKS_UNLISTED_SYSTEMS if s not in LONGSHANKS_CORE_SYSTEMS]
    systems = [s.strip() for s in target.split(",") if s.strip()]
    return [("middle_earth" if s == "mesbg" else s) for s in systems]


def discover_longshanks_targets(
    game_system: str = "all",
    days: int = 7,
    max_events: int = 10,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    existing_ids: Optional[set] = None,
    state: Optional[Dict[str, Any]] = None,
    include_unlisted: bool = False,
    min_players: int = 2,
    recent_days: int = 21,
    max_backfill_systems: int = 6,
) -> Dict[str, Any]:
    """
    Plans one run: recent events for every selected system + historical backfill (from the persisted
    per-system cursor) for up to `max_backfill_systems` systems that still have history left, rotating
    which systems get backfill attention across runs. Returns
    `{"targets": [(sys, eid), ...], "meta": {eid: card}, "backfill": {sys: {...}}, "blocked": str|None, ...}`.
    """
    state = state if state is not None else {}
    sys_state: Dict[str, Dict[str, Any]] = state.setdefault("systems", {})
    skip_ids = set(str(x) for x in (state.get("skip_ids") or []))
    known = set(existing_ids or set()) | skip_ids
    known |= {k.split(":", 1)[1] for k in list(known) if isinstance(k, str) and k.startswith("ls:")}

    systems = _resolve_systems(game_system, include_unlisted)
    now_dt = datetime.now(timezone.utc)
    to_str = str(end_date).strip()[:10] if end_date else now_dt.strftime("%Y-%m-%d")
    floor_str = str(start_date).strip()[:10] if start_date else (now_dt - timedelta(days=max(1, int(days or 7)))).strftime("%Y-%m-%d")
    floor_str = max(floor_str, HISTORY_FLOOR_DATE)
    recent_from = max(floor_str, (now_dt - timedelta(days=max(1, recent_days))).strftime("%Y-%m-%d"))

    # Rotate which systems get backfill attention so every game progresses across nightly runs.
    pending = [s for s in systems if not (sys_state.get(s) or {}).get("done") or (sys_state.get(s) or {}).get("floor", floor_str) > floor_str]
    offset = int(state.get("rotation_offset") or 0) % max(1, len(pending)) if pending else 0
    rotated = pending[offset:] + pending[:offset]
    backfill_systems = rotated[: max(1, int(max_backfill_systems))] if pending else []
    per_sys_want = max(4, int(max_events))

    blocked: List[str] = []
    stats = {"pages_fetched": 0}

    def _recent(sys_slug: str) -> List[Dict[str, Any]]:
        if blocked:
            return []  # one bot challenge means every further request from this IP will fail too
        try:
            cands, _, fetched = _scan_history(
                sys_slug, recent_from, to_str, per_sys_want, known, min_players, max_pages=6, allow_in_progress=True
            )
            stats["pages_fetched"] += fetched
            return cands
        except LongshanksBlockedError as e:
            blocked.append(str(e))
        except Exception as e:
            logger.warning(f"⚠️ [LongshanksSync:{sys_slug.upper()}] Recent discovery notice: {e}")
        return []

    def _backfill(sys_slug: str) -> Tuple[str, List[Dict[str, Any]], bool, str]:
        st = sys_state.get(sys_slug) or {}
        cursor = st.get("backfill_before") or to_str
        if st.get("floor") and st.get("floor") > floor_str:
            cursor = st.get("floor")  # floor was lowered since the system completed: continue below it
        cursor = min(cursor, to_str)
        try:
            cands, exhausted, fetched = _scan_history(sys_slug, floor_str, cursor, per_sys_want, known, min_players)
            stats["pages_fetched"] += fetched
            return sys_slug, cands, exhausted, cursor
        except LongshanksBlockedError as e:
            blocked.append(str(e))
        except Exception as e:
            logger.warning(f"⚠️ [LongshanksSync:{sys_slug.upper()}] Backfill discovery notice: {e}")
        return sys_slug, [], False, cursor

    with ThreadPoolExecutor(max_workers=4) as pool:
        recent_lists = list(pool.map(_recent, systems))
        backfill_results = list(pool.map(_backfill, backfill_systems)) if not blocked else []

    targets: List[Tuple[str, str]] = []
    meta: Dict[str, Dict[str, Any]] = {}
    queued: Set[str] = set()

    def _add(card: Dict[str, Any]) -> bool:
        if card["eid"] in queued or len(targets) >= max_events:
            return False
        queued.add(card["eid"])
        targets.append((card["system"], card["eid"]))
        meta[card["eid"]] = card
        return True

    # 1) Recent events first (oldest-first inside the window keeps Elo chronology tidy), round-robin by system.
    recent_lists = [sorted(lst, key=lambda c: c.get("date") or "") for lst in recent_lists if lst]
    for i in range(max((len(lst) for lst in recent_lists), default=0)):
        for lst in recent_lists:
            if i < len(lst):
                _add(lst[i])
    # 2) Historical backfill, round-robin across the rotated systems (newest-first = cursor order).
    backfill_info: Dict[str, Dict[str, Any]] = {}
    for sys_slug, cands, exhausted, cursor in backfill_results:
        backfill_info[sys_slug] = {"candidates": [c["eid"] for c in cands], "dates": {c["eid"]: c.get("date") for c in cands}, "exhausted": exhausted, "cursor": cursor}
    for i in range(max((len(v["candidates"]) for v in backfill_info.values()), default=0)):
        for sys_slug, cands, _, _ in backfill_results:
            if i < len(cands):
                _add(cands[i])

    return {
        "targets": targets,
        "meta": meta,
        "backfill": backfill_info,
        "backfill_systems": backfill_systems,
        "systems_scanned": systems,
        "blocked": blocked[0] if blocked else None,
        "pages_fetched": stats["pages_fetched"],
        "window": {"floor": floor_str, "recent_from": recent_from, "to": to_str},
    }


def _advance_cursors(state: Dict[str, Any], plan: Dict[str, Any], processed: Set[str], floor_str: str) -> Dict[str, Any]:
    """Moves each backfilled system's date cursor past the processed prefix of its candidate list."""
    sys_state = state.setdefault("systems", {})
    summary: Dict[str, Any] = {}
    for sys_slug, info in (plan.get("backfill") or {}).items():
        st = sys_state.setdefault(sys_slug, {})
        cands = info["candidates"]
        prefix = 0
        while prefix < len(cands) and cands[prefix] in processed:
            prefix += 1
        if prefix == len(cands) and info["exhausted"]:
            st["done"] = True
            st["floor"] = floor_str
            st["backfill_before"] = floor_str
        elif prefix > 0:
            # Inclusive date_to: same-day leftovers are re-listed next run and filtered as imported/skipped.
            st["backfill_before"] = info["dates"].get(cands[prefix - 1]) or info["cursor"]
            st["done"] = False
        summary[sys_slug] = {"cursor": st.get("backfill_before"), "done": bool(st.get("done")), "processed": prefix, "planned": len(cands)}
    return summary


def run_longshanks_sync(
    game_system: str = "all",
    days: int = 7,
    max_events: Optional[int] = 10,
    event_ids: Optional[List[Tuple[str, str]]] = None,
    sqlite_path: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    time_budget_minutes: float = 50.0,
    include_unlisted: bool = False,
    min_players: int = 2,
    recent_days: int = 21,
    max_backfill_systems: int = 6,
    defer_finalize: bool = False,
) -> Dict[str, Any]:
    """Executes the resumable Longshanks tournament sync and Elo / Meta Intel refresh for touched systems."""
    logger.info(
        f"🚀 Starting Longshanks Sync Job (game_system={game_system}, days={days}, start_date={start_date}, "
        f"end_date={end_date}, max_events={max_events}, time_budget_minutes={time_budget_minutes})"
    )
    db = get_sync_db(sqlite_path=sqlite_path)
    state = load_sync_state(db, STATE_KEY) if not event_ids else {}
    budget = SyncBudget(time_budget_minutes, finalize_estimates=state.get("finalize_s") or {}, reserve_finalize=not defer_finalize)
    existing_ids = get_existing_platform_event_ids(db, "ls") if not event_ids else set()
    max_ev = max(1, int(max_events or 10))

    plan: Dict[str, Any] = {"targets": list(event_ids or []), "meta": {}, "backfill": {}, "blocked": None}
    if not event_ids:
        t0 = time.time()
        plan = discover_longshanks_targets(
            game_system=game_system, days=days, max_events=max_ev, start_date=start_date, end_date=end_date,
            existing_ids=existing_ids, state=state, include_unlisted=include_unlisted, min_players=min_players,
            recent_days=recent_days, max_backfill_systems=max_backfill_systems,
        )
        logger.info(
            f"🔎 [LongshanksSync] Discovery: {len(plan['targets'])} targets from {len(plan.get('systems_scanned') or [])} systems "
            f"({plan.get('pages_fetched', 0)} pages, {time.time() - t0:.1f}s); backfill systems={plan.get('backfill_systems')}"
        )
        if not plan["targets"] and not plan["blocked"]:
            target_sys = (game_system or "all").strip().lower()
            plan["targets"] = [
                (s, e) for s, e in DEFAULT_LONGSHANKS_TARGETS
                if (target_sys in ("all", "other") or s == target_sys) and e not in existing_ids and f"ls:{e}" not in existing_ids
            ][:max_ev]

    blocked_reason: Optional[str] = plan.get("blocked")
    targets: List[Tuple[str, str]] = list(plan["targets"])
    if blocked_reason:
        logger.error(
            "⛔ [LongshanksSync] Longshanks is serving its SiteGround bot challenge to this egress IP "
            f"(set LONGSHANKS_PROXY_URL to a non-datacenter proxy). Detail: {blocked_reason}"
        )

    run = budgeted_import(
        db, targets, import_live_longshanks_tournaments, budget, label="LongshanksSync",
        chunk_size=12, initial_event_s=4.0, import_kwargs={"event_meta": plan.get("meta"), "invalidate_caches": False},
    ) if not blocked_reason else {"totals": {}, "imported": [], "skipped": [], "failed": [], "touched": set(), "unprocessed": len(targets), "blocked_reason": None, "avg_event_s": None}
    blocked_reason = blocked_reason or run["blocked_reason"]
    totals = {k: int(run["totals"].get(k) or 0) for k in ("events_imported", "participants_imported", "matches_imported")}
    imported, skipped, failed, touched = run["imported"], run["skipped"], run["failed"], run["touched"]

    if totals["events_imported"] > 0 and hasattr(db, "invalidate_all_caches"):
        try:
            db.invalidate_all_caches(db_inst=db)
        except TypeError:
            db.invalidate_all_caches()
        except Exception as e:
            logger.debug(f"[LongshanksSync] Cache invalidation notice: {e}")

    finalize_res: Dict[str, Any] = {}
    finalize_t0 = time.time()
    if touched and not defer_finalize:
        finalize_res = finalize_platform_sync(db, sorted(touched), platform_name="Longshanks")
    finalize_elapsed = time.time() - finalize_t0

    cursor_summary: Dict[str, Any] = {}
    if not event_ids:
        processed = update_resume_state(state, imported, skipped, failed, max_fails=MAX_FAILS_BEFORE_SKIP)
        if not end_date:  # ad-hoc --end-date windows keep the nightly cursors untouched
            cursor_summary = _advance_cursors(state, plan, processed, (plan.get("window") or {}).get("floor") or HISTORY_FLOOR_DATE)
        if plan.get("backfill_systems"):
            state["rotation_offset"] = int(state.get("rotation_offset") or 0) + len(plan["backfill_systems"])
        if touched and not defer_finalize:
            update_finalize_estimates(state, touched, finalize_res, finalize_elapsed)
        if defer_finalize and touched:
            state["pending_finalize"] = sorted(set(state.get("pending_finalize") or []) | set(touched))
        state["last_run"] = {
            "at": datetime.now(timezone.utc).isoformat(),
            "imported": totals["events_imported"],
            "skipped": len(skipped),
            "failed": len(failed),
            "blocked": bool(blocked_reason),
        }
        save_sync_state(db, STATE_KEY, state)
    unprocessed = run["unprocessed"]

    status = "BLOCKED" if blocked_reason else "SUCCESS"
    return {
        **totals,
        **finalize_res,
        "platform": "longshanks",
        "status": status,
        "blocked_reason": blocked_reason,
        "targets_count": len(targets),
        "events_skipped": len(skipped),
        "events_failed": len(failed),
        "events_unprocessed": unprocessed,
        "backfill": cursor_summary,
        "elapsed_seconds": round(budget.elapsed(), 1),
        "finalize_seconds": round(finalize_elapsed, 1),
        "finalize_deferred": sorted(touched) if defer_finalize else [],
        "touched_systems": sorted(touched),
    }


if __name__ == "__main__":
    from scripts.job_status import install_job_recorder, record_job_run
    install_job_recorder("longshanks_sync")
    parser = argparse.ArgumentParser(description="Cloud Run Job: Longshanks tournament sync & Elo recalculation")
    parser.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "all"), help="all | everything | comma list of slugs (mcp, sw_legion, guild_ball, ...)")
    parser.add_argument("--days", type=int, default=int(os.getenv("DAYS", "3650")), help="History floor in days when --start-date is not set (default: 3650)")
    parser.add_argument("--start-date", "--from", dest="start_date", default=os.getenv("START_DATE"), help="History floor (YYYY-MM-DD)")
    parser.add_argument("--end-date", "--to", dest="end_date", default=os.getenv("END_DATE"), help="Optional end date (YYYY-MM-DD)")
    parser.add_argument("--max-events", type=int, default=int(os.getenv("MAX_EVENTS", "400")), help="Max tournaments to import per run")
    parser.add_argument("--time-budget-minutes", type=float, default=float(os.getenv("TIME_BUDGET_MINUTES", "50")), help="Wall-clock budget incl. finalize (default: 50)")
    parser.add_argument("--max-backfill-systems", type=int, default=int(os.getenv("MAX_BACKFILL_SYSTEMS", "6")), help="Systems that get historical backfill per run (rotates)")
    parser.add_argument("--recent-days", type=int, default=int(os.getenv("RECENT_DAYS", "21")), help="Recent window scanned for every system each run")
    parser.add_argument("--min-players", type=int, default=int(os.getenv("MIN_PLAYERS", "2")), help="Minimum event size (default: 2 = all sizes)")
    parser.add_argument("--include-unlisted-systems", action="store_true", default=os.getenv("INCLUDE_UNLISTED_SYSTEMS", "") == "1", help="Also sync Longshanks games missing from config (bushido, judgement, ...)")
    parser.add_argument("--defer-finalize", action="store_true", default=os.getenv("DEFER_FINALIZE", "") == "1", help="Skip Elo/Meta refresh (leave it to elo-rebuild-job); touched systems are recorded in sync state")
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
                explicit_pairs.append(((args.game_system if args.game_system not in ("all", "everything") else "mcp"), tok))

    res = run_longshanks_sync(
        game_system=args.game_system,
        days=args.days,
        max_events=args.max_events,
        event_ids=explicit_pairs,
        sqlite_path=args.sqlite_path,
        start_date=args.start_date,
        end_date=args.end_date,
        time_budget_minutes=args.time_budget_minutes,
        include_unlisted=args.include_unlisted_systems,
        min_players=args.min_players,
        recent_days=args.recent_days,
        max_backfill_systems=args.max_backfill_systems,
        defer_finalize=args.defer_finalize,
    )
    print(json.dumps(res, indent=2, default=str))
    record_job_run("longshanks_sync", {"status": res.get("status", "SUCCESS"), "result": res})
