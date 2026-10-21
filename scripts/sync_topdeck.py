#!/usr/bin/env python3
"""
Dedicated Cloud Run Job / CLI Sync Script for TopDeck.gg (`scripts/sync_topdeck.py`).
Scrapes completed 4-Player FFA Commander/cEDH Pod tournaments and 1v1 tournaments (`td:` prefix)
from TopDeck.gg (`https://topdeck.gg/api/v2/tournaments` / TopDeck Firestore + EDHTop16)
and computes zero-sum multiparty Elo & Meta Intel strictly for the touched game systems.
"""

import argparse
import json
import logging
import os
import sys
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.sync_multiplatform import (
    _http_post_json,
    finalize_platform_sync,
    get_sync_db,
    import_live_topdeck_tournaments,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.topdeck_sync")

TOPDECK_V2_GAME_NAMES = {
    "mtg": "Magic: The Gathering",
    "pokemon": "Pokemon",
    "one_piece": "One Piece Card Game",
    "sw_unlimited": "Star Wars: Unlimited",
    "lorcana": "Disney Lorcana",
    "yugioh": "Yu-Gi-Oh!",
    "flesh_and_blood": "Flesh and Blood",
    "riftbound": "Riftbound",
    "40k": "Warhammer 40,000",
    "aos": "Warhammer: Age of Sigmar",
    "mcp": "Marvel: Crisis Protocol",
}


DEFAULT_TOPDECK_TARGETS: List[Tuple[str, str]] = [
    ("mtg", "commander-invitational-qualifier-final-fortune-gaming-5"),
    ("mtg", "down-under-spring-scrimmage-1"),
    ("mtg", "PuntCity3"),
]


def _parse_epoch_bound(val: Optional[str], is_end: bool = False) -> Optional[int]:
    if not val or not str(val).strip():
        return None
    from datetime import datetime, timezone
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


def discover_topdeck_targets(
    game_system: str = "mtg",
    days: int = 14,
    max_events: int = 10,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> List[Tuple[str, str]]:
    """
    Discovers recent or historical completed TopDeck.gg tournaments using either:
      1. Official TopDeck.gg v2 REST API (`POST https://topdeck.gg/api/v2/tournaments`) if `TOPDECK_API_KEY` is set, OR
      2. TopDeck Firestore REST `:runQuery` endpoint (`https://firestore.googleapis.com/v1/projects/eminence-1b40b/databases/(default)/documents:runQuery`)
         filtering by `StartDate` in the past `days` / `start_date`..`end_date` window plus flagship cEDH events.
    """
    import time

    target_sys = (game_system or "mtg").strip().lower()
    api_key = os.getenv("TOPDECK_API_KEY", "").strip()
    discovered: List[Tuple[str, str]] = []
    seen_tids = set()

    now_s = int(time.time())
    end_s = _parse_epoch_bound(end_date, is_end=True) or now_s
    cutoff_s = _parse_epoch_bound(start_date, is_end=False) or (end_s - max(1, int(days or 14)) * 86400)

    if api_key:
        systems = ["mtg"] if target_sys in ("all", "other") else [target_sys]
        for sys_slug in systems:
            g_name = TOPDECK_V2_GAME_NAMES.get(sys_slug, "Magic: The Gathering")
            try:
                body_payload: Dict[str, Any] = {
                    "game": g_name,
                    "columns": ["name", "id"],
                }
                if start_date or end_date:
                    body_payload["start"] = cutoff_s
                    body_payload["end"] = end_s
                else:
                    body_payload["last"] = max(1, int(days or 14))
                req = urllib.request.Request(
                    "https://topdeck.gg/api/v2/tournaments",
                    data=json.dumps(body_payload).encode("utf-8"),
                    headers={
                        "Authorization": api_key,
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                        "User-Agent": "OmniTactica-TopDeckSync/1.0",
                    },
                )
                with urllib.request.urlopen(req, timeout=20) as resp:
                    rows = json.loads(resp.read().decode("utf-8", errors="ignore"))
                if isinstance(rows, list):
                    for r in rows:
                        tid = str(r.get("TID") or r.get("id") or "").strip()
                        if tid and tid not in seen_tids:
                            seen_tids.add(tid)
                            discovered.append((sys_slug, tid))
                            if len(discovered) >= max_events:
                                break
            except Exception as e:
                logger.warning(f"⚠️ [TopDeckSync] v2 API discovery notice for {sys_slug}: {e}")

    if not discovered and target_sys in ("all", "other", "mtg"):
        for s_slug, tid in DEFAULT_TOPDECK_TARGETS:
            if len(discovered) < max_events and tid not in seen_tids:
                seen_tids.add(tid)
                discovered.append((s_slug, tid))
        if len(discovered) < max_events:
            from datetime import datetime, timezone

            is_backfill = bool((days or 14) >= 365 or start_date)
            if is_backfill:
                checkpoints = [
                    end_s,
                    int(datetime(2026, 6, 15, tzinfo=timezone.utc).timestamp()),
                    int(datetime(2025, 12, 15, tzinfo=timezone.utc).timestamp()),
                    int(datetime(2025, 6, 15, tzinfo=timezone.utc).timestamp()),
                    int(datetime(2024, 12, 15, tzinfo=timezone.utc).timestamp()),
                    int(datetime(2024, 6, 15, tzinfo=timezone.utc).timestamp()),
                ]
                checkpoints = [cp for cp in checkpoints if cutoff_s <= cp <= end_s] or [end_s]
                per_cp_quota = max(2, (max_events - len(discovered) + len(checkpoints) - 1) // len(checkpoints))
            else:
                checkpoints = [end_s]
                per_cp_quota = max_events

            for cp_end in checkpoints:
                if len(discovered) >= max_events:
                    break
                cp_start = max(cutoff_s, cp_end - 180 * 86400) if is_backfill else cutoff_s
                added_in_cp = 0
                try:
                    fs_rows = _http_post_json(
                        "https://firestore.googleapis.com/v1/projects/eminence-1b40b/databases/(default)/documents:runQuery",
                        {
                            "structuredQuery": {
                                "from": [{"collectionId": "tournaments"}],
                                "where": {
                                    "compositeFilter": {
                                        "op": "AND",
                                        "filters": [
                                            {"fieldFilter": {"field": {"fieldPath": "StartDate"}, "op": "GREATER_THAN_OR_EQUAL", "value": {"integerValue": str(cp_start)}}},
                                            {"fieldFilter": {"field": {"fieldPath": "StartDate"}, "op": "LESS_THAN_OR_EQUAL", "value": {"integerValue": str(cp_end)}}},
                                        ],
                                    }
                                },
                                "orderBy": [{"field": {"fieldPath": "StartDate"}, "direction": "DESCENDING"}],
                                "limit": max(25, per_cp_quota * 4),
                            }
                        },
                        timeout=15,
                    )
                    if isinstance(fs_rows, list):
                        for r in fs_rows:
                            doc = (r or {}).get("document") or {}
                            fields = doc.get("fields") or {}
                            tid = str(doc.get("name") or "").split("/")[-1].strip()
                            ev_title = str((fields.get("Name") or {}).get("stringValue") or "").lower()
                            t1_fields = ((fields.get("S1:R1:T1") or {}).get("mapValue") or {}).get("fields") or {}
                            t1_es = ((t1_fields.get("Es") or {}).get("arrayValue") or {}).get("values") or []
                            if (
                                tid
                                and tid not in seen_tids
                                and len(t1_es) >= 3
                                and "Winner" in t1_fields
                                and "naruto" not in ev_title
                                and "test" not in ev_title
                            ):
                                seen_tids.add(tid)
                                discovered.append(("mtg", tid))
                                added_in_cp += 1
                                if len(discovered) >= max_events or added_in_cp >= per_cp_quota:
                                    break
                except Exception as e:
                    logger.warning(f"⚠️ [TopDeckSync] Firestore discovery notice: {e}")

    return discovered[:max_events]


def run_topdeck_sync(
    game_system: str = "mtg",
    days: int = 14,
    max_events: Optional[int] = 10,
    event_ids: Optional[List[Tuple[str, str]]] = None,
    sqlite_path: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Dict[str, Any]:
    """Executes the TopDeck.gg tournament sync, 4P FFA Pod normalization, and multiparty Elo reconstruction."""
    logger.info(f"🚀 Starting TopDeck.gg Sync Job (game_system={game_system}, days={days}, max_events={max_events})")
    db = get_sync_db(sqlite_path=sqlite_path)

    targets = event_ids if event_ids else discover_topdeck_targets(
        game_system=game_system,
        days=days,
        max_events=max_events or 10,
        start_date=start_date,
        end_date=end_date,
    )
    if not targets:
        logger.info("ℹ️ [TopDeckSync] No matching TopDeck.gg tournaments found in window.")
        return {"platform": "topdeck", "events_imported": 0, "matches_imported": 0}

    import_res = import_live_topdeck_tournaments(db, targets)
    touched_systems = sorted({t[0] for t in targets})
    finalize_res = finalize_platform_sync(db, touched_systems, platform_name="TopDeck.gg")

    return {
        **import_res,
        **finalize_res,
        "platform": "topdeck",
        "targets_count": len(targets),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cloud Run Job: TopDeck.gg tournament sync (4P FFA Pods & 1v1) & Elo recalculation")
    parser.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "mtg"), help="Game system (mtg, pokemon, one_piece, sw_unlimited, lorcana, etc.)")
    parser.add_argument("--days", type=int, default=int(os.getenv("DAYS", "14")), help="Days of past tournaments to scrape (default: 14; use 3650 for 10yr backfill)")
    parser.add_argument("--start-date", "--from", dest="start_date", default=os.getenv("START_DATE"), help="Optional start date (YYYY-MM-DD or ISO8601)")
    parser.add_argument("--end-date", "--to", dest="end_date", default=os.getenv("END_DATE"), help="Optional end date (YYYY-MM-DD or ISO8601)")
    parser.add_argument("--max-events", type=int, default=int(os.getenv("MAX_EVENTS", "10")), help="Max tournaments to scrape (default: 10)")
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
    )
    print(json.dumps(res, indent=2, default=str))
