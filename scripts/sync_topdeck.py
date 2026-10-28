#!/usr/bin/env python3
"""
Dedicated Cloud Run Job / CLI Sync Script for TopDeck.gg (`scripts/sync_topdeck.py`).
Imports completed 4-Player FFA Commander/cEDH Pod tournaments and 1v1 tournaments (`td:` prefix) for every
TopDeck.gg game that maps to a known OmniTactica game system (MTG incl. Commander, Pokemon, One Piece,
Yu-Gi-Oh!, Star Wars: Unlimited, Riftbound, Lorcana, Digimon, Gundam, ...) and computes zero-sum multiparty
Elo & Meta Intel strictly for the touched game systems.

Resumable full-history backfill (designed for nightly Cloud Run Job runs, 60-minute timeout):
  * Discovery pages through TopDeck's public Firestore `tournaments` collection
    (`documents:runQuery`, field projection only, keyset pagination on `StartDate DESC, __name__ DESC`).
    Every run scans a recent window first, then continues the backfill from a keyset cursor persisted in
    `system_settings[sync_state_topdeck]`.
  * Only tournaments that started at least `--settle-days` ago and have a reported first table are queued;
    already-imported (`td:` events with matches) and known-unimportable ids are skipped.
  * `--max-events` caps imports per run; `--time-budget-minutes` (default 50) stops importing early enough
    to leave time for `finalize_platform_sync` of every touched system.
"""

import argparse
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import GAME_SYSTEM_BY_SLUG, normalize_game_system
from scripts.platform_sync_state import (
    SyncBudget,
    budgeted_import,
    load_sync_state,
    save_sync_state,
    update_finalize_estimates,
    update_resume_state,
)
from scripts.sync_multiplatform import (
    _bound_id,
    _http_post_json,
    _topdeck_table_winner,
    finalize_platform_sync,
    get_existing_platform_event_ids,
    get_open_platform_event_targets,
    get_sync_db,
    import_live_topdeck_tournaments,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.topdeck_sync")

STATE_KEY = "sync_state_topdeck"
FIRESTORE_RUNQUERY_URL = "https://firestore.googleapis.com/v1/projects/eminence-1b40b/databases/(default)/documents:runQuery"
FIRESTORE_PAGE_SIZE = 500
MAX_FAILS_BEFORE_SKIP = 3

# TopDeck `Game` (lower-cased) -> OmniTactica game system slug. Commander/cEDH stays under `mtg`
# (detachment "cEDH Pod") for consistency with the `td:` data already in production.
TOPDECK_FIRESTORE_GAME_MAP = {
    "magic: the gathering": "mtg",
    "mtg": "mtg",
    "pokemon": "pokemon",
    "pokémon": "pokemon",
    "one piece": "one_piece",
    "one piece card game": "one_piece",
    "star wars: unlimited": "sw_unlimited",
    "star wars unlimited": "sw_unlimited",
    "disney lorcana": "lorcana",
    "lorcana": "lorcana",
    "yu-gi-oh!": "yugioh",
    "yu-gi-oh": "yugioh",
    "yugioh": "yugioh",
    "flesh and blood": "flesh_blood",
    "riftbound": "riftbound",
    "digimon": "digimon",
    "digimon card game": "digimon",
    "gundam": "gundam_tcg",
    "gundam card game": "gundam_tcg",
    "union arena": "union_arena",
    "cardfight vanguard": "cardfight_vang",
    "dragon ball super card game fusion world": "dbs_fusion",
    "chrono core tcg": "chrono_core_tc",
    "shard bugs tcg": "shard_bugs_tcg",
    "vibes tcg": "vibes",
    "settlers of catan": "catan",
    "beyblade": "beyblade",
    "grand archive": "grand_archive",
    "warhammer 40,000": "40k",
    "warhammer 40k": "40k",
    "warhammer: age of sigmar": "aos",
    "age of sigmar": "aos",
    "marvel: crisis protocol": "mcp",
}
# Excluded on purpose (historically junk / not rated on OmniTactica yet).
TOPDECK_EXCLUDED_GAMES = {"naruto", "naruto mythos tcg"}
_TEST_NAME_RE = re.compile(r"\b(test|testing|ignore|dummy|practice)\b", re.I)

DEFAULT_TOPDECK_TARGETS: List[Tuple[str, str]] = [
    ("mtg", "commander-invitational-qualifier-final-fortune-gaming-5"),
    ("mtg", "down-under-spring-scrimmage-1"),
    ("mtg", "PuntCity3"),
]


def map_topdeck_game(raw_game: Optional[str]) -> Optional[str]:
    """Maps a TopDeck `Game` string to a known game system slug, or None when unsupported/excluded."""
    low = str(raw_game or "Magic: The Gathering").strip().lower()
    if not low or low in TOPDECK_EXCLUDED_GAMES:
        return None
    if low in TOPDECK_FIRESTORE_GAME_MAP:
        return TOPDECK_FIRESTORE_GAME_MAP[low]
    slug = normalize_game_system(low, default="")
    return slug if slug and slug in GAME_SYSTEM_BY_SLUG and slug not in TOPDECK_EXCLUDED_GAMES else None


def _parse_epoch_bound(val: Optional[str], is_end: bool = False) -> Optional[int]:
    if not val or not str(val).strip():
        return None
    s = str(val).strip()
    if len(s) == 10:
        s = f"{s}T23:59:59+00:00" if is_end else f"{s}T00:00:00+00:00"
    else:
        s = s.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except Exception:
        return None


def _known_variants(tid: str) -> Tuple[str, ...]:
    return (tid, f"td:{tid}", _bound_id(f"td:{tid}"), _bound_id(tid))


def _firestore_page(lo: int, hi: int, start_after: Optional[Tuple[int, str]], limit: int) -> List[Dict[str, Any]]:
    sq: Dict[str, Any] = {
        "from": [{"collectionId": "tournaments"}],
        "select": {"fields": [{"fieldPath": f} for f in ("Name", "Game", "Format", "StartDate", "End", "`S1:R1:T1`")]},
        "where": {
            "compositeFilter": {
                "op": "AND",
                "filters": [
                    {"fieldFilter": {"field": {"fieldPath": "StartDate"}, "op": "GREATER_THAN_OR_EQUAL", "value": {"integerValue": str(lo)}}},
                    {"fieldFilter": {"field": {"fieldPath": "StartDate"}, "op": "LESS_THAN_OR_EQUAL", "value": {"integerValue": str(hi)}}},
                ],
            }
        },
        "orderBy": [
            {"field": {"fieldPath": "StartDate"}, "direction": "DESCENDING"},
            {"field": {"fieldPath": "__name__"}, "direction": "DESCENDING"},
        ],
        "limit": int(limit),
    }
    if start_after:
        sq["startAt"] = {"values": [{"integerValue": str(start_after[0])}, {"referenceValue": start_after[1]}], "before": False}
    last_err: Optional[Exception] = None
    for attempt in range(3):
        try:
            rows = _http_post_json(FIRESTORE_RUNQUERY_URL, {"structuredQuery": sq}, timeout=60)
            return [r["document"] for r in (rows or []) if isinstance(r, dict) and r.get("document")]
        except Exception as e:
            last_err = e
            time.sleep(2 * (attempt + 1))
    raise last_err if last_err else RuntimeError("Firestore runQuery failed")


def _doc_candidate(doc: Dict[str, Any], target_sys: str, allow_in_progress: bool = False) -> Optional[Dict[str, Any]]:
    fields = doc.get("fields") or {}
    tid = str(doc.get("name") or "").split("/")[-1].strip()
    if not tid:
        return None
    name = str((fields.get("Name") or {}).get("stringValue") or "")
    if _TEST_NAME_RE.search(name):
        return None
    sys_slug = map_topdeck_game((fields.get("Game") or {}).get("stringValue"))
    if not sys_slug:
        return None
    if target_sys not in ("all", "other", "tcg") and sys_slug != target_sys:
        return None
    t1 = ((fields.get("S1:R1:T1") or {}).get("mapValue") or {}).get("fields") or {}
    es = [int(x["integerValue"]) for x in ((t1.get("Es") or {}).get("arrayValue") or {}).get("values") or [] if "integerValue" in x]
    if len(es) < 2:
        return None  # never started
    if not allow_in_progress and _topdeck_table_winner(t1, es) is None:
        return None  # first table not reported
    sd = int((fields.get("StartDate") or {}).get("integerValue") or 0)
    return {"tid": tid, "system": sys_slug, "name": name, "sd": sd, "ref": doc.get("name")}


def _scan_firestore(
    lo: int,
    hi: int,
    start_after: Optional[Tuple[int, str]],
    want: int,
    known: Set[str],
    target_sys: str,
    max_pages: int,
    stats: Dict[str, int],
    allow_in_progress: bool = False,
) -> Tuple[List[Dict[str, Any]], bool, Optional[Tuple[int, str]]]:
    """Keyset-walks [lo, hi] newest first; returns (candidates, exhausted, next_scan_cursor)."""
    out: List[Dict[str, Any]] = []
    cursor = start_after
    for _ in range(max_pages):
        docs = _firestore_page(lo, hi, cursor, FIRESTORE_PAGE_SIZE)
        stats["pages"] = stats.get("pages", 0) + 1
        stats["docs"] = stats.get("docs", 0) + len(docs)
        if not docs:
            return out, True, cursor
        for d_idx, doc in enumerate(docs):
            doc_sd = int(((doc.get("fields") or {}).get("StartDate") or {}).get("integerValue") or 0)
            doc_cursor = (doc_sd, str(doc.get("name") or ""))
            cand = _doc_candidate(doc, target_sys, allow_in_progress=allow_in_progress)
            if cand and not any(v in known for v in _known_variants(cand["tid"])):
                out.append(cand)
                if len(out) >= want:
                    exhausted_here = (d_idx == len(docs) - 1) and (len(docs) < FIRESTORE_PAGE_SIZE)
                    return out, exhausted_here, doc_cursor
        last = docs[-1]
        cursor = (int(((last.get("fields") or {}).get("StartDate") or {}).get("integerValue") or 0), str(last.get("name") or ""))
        if len(docs) < FIRESTORE_PAGE_SIZE:
            return out, True, cursor
    return out, False, cursor


def discover_topdeck_targets(
    game_system: str = "all",
    days: int = 3650,
    max_events: int = 10,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    existing_ids: Optional[set] = None,
    state: Optional[Dict[str, Any]] = None,
    recent_days: int = 10,
    settle_days: int = 2,
) -> Dict[str, Any]:
    """Plans one run: live in-progress tournaments first, then recent completed, then historical backfill from the persisted keyset cursor."""
    state = state if state is not None else {}
    target_sys = (game_system or "all").strip().lower()
    known: Set[str] = set(existing_ids or set()) | {str(x) for x in (state.get("skip_ids") or [])}

    now_s = int(time.time())
    settled_s = now_s - max(0, int(settle_days)) * 86400
    hi = min(_parse_epoch_bound(end_date, is_end=True) or settled_s, settled_s)
    floor_s = _parse_epoch_bound(start_date) or (now_s - max(1, int(days or 3650)) * 86400)
    floor_s = max(floor_s, int(datetime(2015, 1, 1, tzinfo=timezone.utc).timestamp()))
    recent_lo = max(floor_s, hi - max(1, int(recent_days)) * 86400)
    stats: Dict[str, int] = {}

    live_cands: List[Dict[str, Any]] = []
    if not end_date and settle_days > 0:
        live_want = min(max_events, max(3, max_events // 3))
        live_cands, _, _ = _scan_firestore(
            max(floor_s, settled_s), now_s + 3600, None, live_want, known, target_sys, max_pages=5, stats=stats, allow_in_progress=True
        )
    live_ids = {c["tid"] for c in live_cands}

    recent, _, _ = _scan_firestore(recent_lo, hi, None, max(0, max_events - len(live_cands)), known | live_ids, target_sys, max_pages=40, stats=stats)
    recent.sort(key=lambda c: c["sd"])  # oldest first inside the recent window
    recent = live_cands + recent

    bf = state.get("backfill") or {}
    if start_date and str(start_date).strip():
        bf_key = f"{target_sys}:from:{str(start_date).strip()[:10]}"
    elif int(days or 3650) >= 3650:
        bf_key = f"{target_sys}:full_10y"
    else:
        bf_key = f"{target_sys}:days:{int(days)}"
    backfill: List[Dict[str, Any]] = []
    exhausted = bool(bf.get("done")) and bf.get("key") == bf_key
    bf_cursor: Optional[Tuple[int, str]] = None
    if bf.get("key") == bf_key and bf.get("sd") and bf.get("ref"):
        bf_cursor = (int(bf["sd"]), str(bf["ref"]))
    scan_cursor: Optional[Tuple[int, str]] = bf_cursor
    if not exhausted:
        recent_ids = {c["tid"] for c in recent}
        want = max(0, max_events - len(recent))
        if want:
            backfill, exhausted, scan_cursor = _scan_firestore(
                floor_s, hi, bf_cursor, want, known | recent_ids, target_sys, max_pages=220, stats=stats
            )

    targets = [(c["system"], c["tid"]) for c in recent + backfill][:max_events]
    return {
        "targets": targets,
        "recent": recent,
        "backfill": backfill,
        "backfill_exhausted": exhausted,
        "backfill_scan_cursor": scan_cursor,
        "backfill_key": bf_key,
        "pages_fetched": stats.get("pages", 0),
        "docs_scanned": stats.get("docs", 0),
        "window": {"floor": floor_s, "recent_lo": recent_lo, "hi": hi},
    }


def run_topdeck_sync(
    game_system: str = "all",
    days: int = 3650,
    max_events: Optional[int] = 10,
    event_ids: Optional[List[Tuple[str, str]]] = None,
    sqlite_path: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    time_budget_minutes: float = 50.0,
    recent_days: int = 10,
    settle_days: int = 2,
    defer_finalize: bool = False,
) -> Dict[str, Any]:
    """Executes the resumable TopDeck.gg sync, 4P FFA Pod / 1v1 import, and Elo refresh for touched systems."""
    logger.info(
        f"🚀 Starting TopDeck.gg Sync Job (game_system={game_system}, days={days}, start_date={start_date}, "
        f"max_events={max_events}, time_budget_minutes={time_budget_minutes})"
    )
    db = get_sync_db(sqlite_path=sqlite_path)
    state = load_sync_state(db, STATE_KEY) if not event_ids else {}
    budget = SyncBudget(time_budget_minutes, finalize_estimates=state.get("finalize_s") or {}, reserve_finalize=not defer_finalize)
    existing_ids = get_existing_platform_event_ids(db, "td") if not event_ids else set()
    max_ev = max(1, int(max_events or 10))

    plan: Dict[str, Any] = {"targets": list(event_ids or []), "backfill": [], "recent": []}
    if not event_ids:
        t0 = time.time()
        try:
            plan = discover_topdeck_targets(
                game_system=game_system, days=days, max_events=max_ev, start_date=start_date, end_date=end_date,
                existing_ids=existing_ids, state=state, recent_days=recent_days, settle_days=settle_days,
            )
        except Exception as e:
            logger.warning(f"⚠️ [TopDeckSync] Firestore discovery notice: {e}")
            plan = {"targets": [], "backfill": [], "recent": [], "discovery_error": str(e)}
        logger.info(
            f"🔎 [TopDeckSync] Discovery: {len(plan['targets'])} targets ({len(plan.get('recent') or [])} recent, "
            f"{len(plan.get('backfill') or [])} backfill) from {plan.get('docs_scanned', 0)} docs / "
            f"{plan.get('pages_fetched', 0)} pages in {time.time() - t0:.1f}s"
        )
        if not plan["targets"]:
            target_sys = (game_system or "all").strip().lower()
            plan["targets"] = [
                (s, t) for s, t in DEFAULT_TOPDECK_TARGETS
                if (target_sys in ("all", "other", "tcg") or s == target_sys) and not any(v in existing_ids for v in _known_variants(t))
            ][:max_ev]

    if not event_ids:
        open_targets = get_open_platform_event_targets(db, "td", game_system=game_system, limit=40)
        seen_open = {t[1] for t in open_targets}
        targets = list(open_targets) + [t for t in plan["targets"] if t[1] not in seen_open]
    else:
        targets = list(plan["targets"])
    run = budgeted_import(
        db, targets, import_live_topdeck_tournaments, budget, label="TopDeckSync",
        chunk_size=12, initial_event_s=1.5, import_kwargs={"invalidate_caches": False},
    )
    totals = {k: int(run["totals"].get(k) or 0) for k in ("events_imported", "participants_imported", "pods_imported", "matches_imported")}
    imported, skipped, failed, touched = run["imported"], run["skipped"], run["failed"], run["touched"]

    if totals["events_imported"] > 0 and hasattr(db, "invalidate_all_caches"):
        try:
            db.invalidate_all_caches(db_inst=db)
        except TypeError:
            db.invalidate_all_caches()
        except Exception as e:
            logger.debug(f"[TopDeckSync] Cache invalidation notice: {e}")

    finalize_res: Dict[str, Any] = {}
    finalize_t0 = time.time()
    if touched and not defer_finalize:
        finalize_res = finalize_platform_sync(db, sorted(touched), platform_name="TopDeck.gg")
    finalize_elapsed = time.time() - finalize_t0

    backfill_summary: Dict[str, Any] = {}
    if not event_ids and plan.get("backfill_key"):
        latest_state = load_sync_state(db, STATE_KEY) or {}
        if end_date:
            # Ad-hoc bounded date-window shard: preserve nightly backfill cursor, merge skip/fail/pending_finalize
            processed = update_resume_state(latest_state, imported, skipped, failed, max_fails=MAX_FAILS_BEFORE_SKIP)
            if defer_finalize and touched:
                latest_state["pending_finalize"] = sorted(set(latest_state.get("pending_finalize") or []) | set(touched))
            save_sync_state(db, STATE_KEY, latest_state)
            bf_state = latest_state.get("backfill") or {}
            backfill_summary = {
                "cursor_start_date": datetime.fromtimestamp(int(bf_state["sd"]), tz=timezone.utc).strftime("%Y-%m-%d") if bf_state.get("sd") else None,
                "done": bool(bf_state.get("done")),
                "processed": len(imported) + len(skipped),
                "planned": len(plan.get("backfill") or []),
                "windowed_shard": True,
            }
        else:
            processed = update_resume_state(state, imported, skipped, failed, max_fails=MAX_FAILS_BEFORE_SKIP)
            bf_cands = plan.get("backfill") or []
            prefix = 0
            while prefix < len(bf_cands) and bf_cands[prefix]["tid"] in processed:
                prefix += 1
            bf_state = state.get("backfill") or {}
            if bf_state.get("key") != plan["backfill_key"]:
                bf_state = {"key": plan["backfill_key"]}
            scan_cur = plan.get("backfill_scan_cursor")
            if prefix == len(bf_cands) and plan.get("backfill_exhausted"):
                bf_state["done"] = True
            elif prefix == len(bf_cands) and scan_cur and scan_cur[0] and scan_cur[1]:
                bf_state.update({"sd": int(scan_cur[0]), "ref": str(scan_cur[1]), "done": False})
            elif prefix > 0:
                last = bf_cands[prefix - 1]
                bf_state.update({"sd": last["sd"], "ref": last["ref"], "done": False})
            state["backfill"] = bf_state
            if touched and not defer_finalize:
                update_finalize_estimates(state, touched, finalize_res, finalize_elapsed)
            if defer_finalize and touched:
                merged_pf = set(latest_state.get("pending_finalize") or []) | set(state.get("pending_finalize") or []) | set(touched)
                state["pending_finalize"] = sorted(merged_pf)
            state["last_run"] = {
                "at": datetime.now(timezone.utc).isoformat(),
                "imported": totals["events_imported"],
                "skipped": len(skipped),
                "failed": len(failed),
            }
            save_sync_state(db, STATE_KEY, state)
            backfill_summary = {
                "cursor_start_date": datetime.fromtimestamp(int(bf_state["sd"]), tz=timezone.utc).strftime("%Y-%m-%d") if bf_state.get("sd") else None,
                "done": bool(bf_state.get("done")),
                "processed": prefix,
                "planned": len(bf_cands),
            }

    return {
        **totals,
        **finalize_res,
        "platform": "topdeck",
        "status": "SUCCESS",
        "targets_count": len(targets),
        "events_skipped": len(skipped),
        "events_failed": len(failed),
        "events_unprocessed": run["unprocessed"],
        "backfill": backfill_summary,
        "elapsed_seconds": round(budget.elapsed(), 1),
        "finalize_seconds": round(finalize_elapsed, 1),
        "finalize_deferred": sorted(touched) if defer_finalize else [],
        "touched_systems": sorted(touched),
    }


if __name__ == "__main__":
    from scripts.job_status import install_job_recorder, record_job_run
    install_job_recorder("topdeck_sync")
    parser = argparse.ArgumentParser(description="Cloud Run Job: TopDeck.gg tournament sync (4P FFA Pods & 1v1) & Elo recalculation")
    parser.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "all"), help="all | mtg | pokemon | one_piece | yugioh | sw_unlimited | ...")
    parser.add_argument("--days", type=int, default=int(os.getenv("DAYS", "3650")), help="History floor in days when --start-date is not set (default: 3650)")
    parser.add_argument("--start-date", "--from", dest="start_date", default=os.getenv("START_DATE"), help="History floor (YYYY-MM-DD or ISO8601)")
    parser.add_argument("--end-date", "--to", dest="end_date", default=os.getenv("END_DATE"), help="Optional end date (YYYY-MM-DD or ISO8601)")
    parser.add_argument("--max-events", type=int, default=int(os.getenv("MAX_EVENTS", "1500")), help="Max tournaments to import per run")
    parser.add_argument("--time-budget-minutes", type=float, default=float(os.getenv("TIME_BUDGET_MINUTES", "50")), help="Wall-clock budget incl. finalize (default: 50)")
    parser.add_argument("--recent-days", type=int, default=int(os.getenv("RECENT_DAYS", "10")), help="Recent window scanned first every run")
    parser.add_argument("--settle-days", type=int, default=int(os.getenv("SETTLE_DAYS", "2")), help="Only import tournaments that started at least N days ago")
    parser.add_argument("--defer-finalize", action="store_true", default=os.getenv("DEFER_FINALIZE", "") == "1", help="Skip Elo/Meta refresh (leave it to elo-rebuild-job)")
    parser.add_argument("--event-ids", default="", help="Optional comma-separated sys:tid pairs (e.g. mtg:PuntCity3)")
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

    res = run_topdeck_sync(
        game_system=args.game_system,
        days=args.days,
        max_events=args.max_events,
        event_ids=explicit_pairs,
        sqlite_path=args.sqlite_path,
        start_date=args.start_date,
        end_date=args.end_date,
        time_budget_minutes=args.time_budget_minutes,
        recent_days=args.recent_days,
        settle_days=args.settle_days,
        defer_finalize=args.defer_finalize,
    )
    print(json.dumps(res, indent=2, default=str))
    record_job_run("topdeck_sync", {"status": res.get("status", "SUCCESS"), "result": res})
