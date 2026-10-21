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


def discover_topdeck_targets(
    game_system: str = "mtg",
    days: int = 14,
    max_events: int = 10,
) -> List[Tuple[str, str]]:
    """
    Discovers recent completed TopDeck.gg tournaments using either:
      1. Official TopDeck.gg v2 REST API (`POST https://topdeck.gg/api/v2/tournaments`) if `TOPDECK_API_KEY` is set, OR
      2. TopDeck Firestore REST `:runQuery` endpoint (`https://firestore.googleapis.com/v1/projects/eminence-1b40b/databases/(default)/documents:runQuery`)
         filtering by `StartDate` in the past `days` window plus flagship cEDH events.
    """
    import time

    target_sys = (game_system or "mtg").strip().lower()
    api_key = os.getenv("TOPDECK_API_KEY", "").strip()
    discovered: List[Tuple[str, str]] = []
    seen_tids = set()

    if api_key:
        systems = ["mtg"] if target_sys in ("all", "other") else [target_sys]
        for sys_slug in systems:
            g_name = TOPDECK_V2_GAME_NAMES.get(sys_slug, "Magic: The Gathering")
            try:
                req = urllib.request.Request(
                    "https://topdeck.gg/api/v2/tournaments",
                    data=json.dumps({
                        "last": max(1, int(days or 14)),
                        "game": g_name,
                        "columns": ["name", "id"],
                    }).encode("utf-8"),
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
            try:
                now_s = int(time.time())
                cutoff_s = now_s - max(1, int(days or 14)) * 86400
                fs_rows = _http_post_json(
                    "https://firestore.googleapis.com/v1/projects/eminence-1b40b/databases/(default)/documents:runQuery",
                    {
                        "structuredQuery": {
                            "from": [{"collectionId": "tournaments"}],
                            "where": {
                                "compositeFilter": {
                                    "op": "AND",
                                    "filters": [
                                        {"fieldFilter": {"field": {"fieldPath": "StartDate"}, "op": "GREATER_THAN_OR_EQUAL", "value": {"integerValue": str(cutoff_s)}}},
                                        {"fieldFilter": {"field": {"fieldPath": "StartDate"}, "op": "LESS_THAN_OR_EQUAL", "value": {"integerValue": str(now_s)}}},
                                    ],
                                }
                            },
                            "orderBy": [{"field": {"fieldPath": "StartDate"}, "direction": "DESCENDING"}],
                            "limit": max(20, max_events * 3),
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
                        if (
                            tid
                            and tid not in seen_tids
                            and "S1:R1:T1" in fields
                            and "naruto" not in ev_title
                            and "test" not in ev_title
                        ):
                            seen_tids.add(tid)
                            discovered.append(("mtg", tid))
                            if len(discovered) >= max_events:
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
) -> Dict[str, Any]:
    """Executes the TopDeck.gg tournament sync, 4P FFA Pod normalization, and multiparty Elo reconstruction."""
    logger.info(f"🚀 Starting TopDeck.gg Sync Job (game_system={game_system}, days={days}, max_events={max_events})")
    db = get_sync_db(sqlite_path=sqlite_path)

    targets = event_ids if event_ids else discover_topdeck_targets(
        game_system=game_system,
        days=days,
        max_events=max_events or 10,
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
    parser.add_argument("--days", type=int, default=int(os.getenv("DAYS", "14")), help="Days of past tournaments to scrape (default: 14)")
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
    )
    print(json.dumps(res, indent=2, default=str))
