#!/usr/bin/env python3
"""
Dedicated Cloud Run Job / CLI Sync Script for Melee.gg (`scripts/sync_melee.py`).
Scrapes completed competitive TCG tournaments (`mtg`, `sw_unlimited`, `lorcana`, `flesh_and_blood`, `riftbound`)
from `https://melee.gg` (`melee:` prefix), including round standings, pairings, and decklists,
and updates Elo & Meta Intel strictly for the touched game systems.
"""

import argparse
import gzip
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.sync_multiplatform import (
    finalize_platform_sync,
    get_existing_platform_event_ids,
    get_sync_db,
    import_live_melee_tournaments,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.melee_sync")

DEFAULT_MELEE_TARGETS: List[Tuple[str, str]] = [
    ("mtg", "428253"),          # Arena Championship 12 (2026)
    ("mtg", "72980"),           # Pro Tour Thunder Junction (2024)
    ("sw_unlimited", "458821"), # Star Wars: Unlimited - 09/10/26
    ("sw_unlimited", "468577"), # SWU - 10/01/26
]

HISTORICAL_MELEE_TARGETS: List[Tuple[str, str]] = [
    ("mtg", "2000"),            # Chimera Gaming Standard Arena Tournament 06/20/20
    ("mtg", "3500"),            # Saturday 8PM PAX Online MTG Arena Historic Preliminary
    ("mtg", "5000"),            # Magic Online Society Pauper FNM
    ("mtg", "8000"),            # SCG Tour Online - Satellite #1 - Standard
    ("mtg", "10500"),           # 2º Explorer Element4 Teresina
    ("mtg", "14122"),           # Weekday Night Magic
    ("mtg", "15255"),           # CF SEA - Saturday 11AM Canadian Highlander Tournament
    ("lorcana", "23000"),       # Underworld Games Lorcana TCG Casual Countdown constructed event
    ("lorcana", "30000"),       # Lorcana League Week 5 (Constructed)
    ("lorcana", "40500"),       # Prima Tappa Lorcana 2nd Chapter
    ("lorcana", "47500"),       # Lorcana Night Core 2
    ("lorcana", "54500"),       # Friday Night Lorcana
    ("mtg", "58000"),           # Ottawa Tour Weekend - Saturday Super Qualifier
    ("lorcana", "61500"),       # Lorcana Locals 15/2/24
    ("lorcana", "65000"),       # Disney Lorcana - Constructed Tournament - 2/25 - 3:00 PM
    ("lorcana", "72000"),       # BOOSTER DRAFT INTO THE INKLANDS
    ("lorcana", "75500"),       # Into the Inklands Championship - Clan Shots Gaming
    ("lorcana", "89500"),       # Thursday Lorcana League
    ("lorcana", "93000"),       # Hiveworld - Lorcana Constructed 03.06.24
    ("lorcana", "103500"),      # Liga Lorcana 6 de Junio
    ("lorcana", "107000"),      # Ursula's Return Draft
    ("lorcana", "110500"),      # Torneo COSTRUITO COMPETITIVO LORCANA - Il Ritorno di Ursula
    ("lorcana", "114000"),      # End of Round Poorcana Tournament
    ("lorcana", "128000"),      # Shimmering Skies Midnight Release Sealed Event
    ("lorcana", "138500"),      # Saturday Lorcana 08/24/24
    ("lorcana", "142000"),      # Lorcana - Enchanted Series
    ("lorcana", "149000"),      # Weekly Play - Lorcana League: Shimmering Skies, Week 6
    ("mtg", "150000"),          # Aspettando lo Store Championship
    ("sw_unlimited", "159500"), # Saturday SWU Locals
    ("sw_unlimited", "170000"), # Tournoi Construit Star Wars Unlimited
    ("sw_unlimited", "187500"), # Star Wars Unlimited DRAFT night
    ("lorcana", "194500"),      # Azurite Sea Set Championship w/Krakenhits
    ("sw_unlimited", "200000"), # Starwars Unlimited Weekly
    ("lorcana", "205000"),      # Azurite Sea Championship
    ("sw_unlimited", "208500"), # Star Wars Unlimited Draft
    ("lorcana", "212000"),      # Lorcana League Azurite Sea R1 W4
    ("sw_unlimited", "219000"), # Star Wars Unlimited Twilight of the Republic Showdown
    ("sw_unlimited", "233000"), # Store Championship Star Wars Unlimited
    ("lorcana", "243500"),      # Lorcana Locals 2/8/25
    ("sw_unlimited", "250500"), # Avant Première : Set 4 - Jump to Lightspeed
    ("sw_unlimited", "257500"), # star wars store champ
    ("lorcana", "268000"),      # Archazia's Island Weekly Play
    ("lorcana", "278500"),      # Java Archazia's Island Set Championship
    ("lorcana", "285500"),      # ALTF4 - Archazia's Island Store Champ
    ("lorcana", "296000"),      # Derby Archazia's Island Set Championship
    ("sw_unlimited", "306500"), # Star Wars Unlimited Constructed @PlayhousePatras
    ("lorcana", "310000"),      # HDLegacy Lorcana League
    ("lorcana", "320500"),      # 6/3 Reign of Jafar Prerelease: Sealed
    ("sw_unlimited", "327500"), # Calanda Magic Prerelease SWU Legends of the Force
    ("sw_unlimited", "334500"), # Legends of the Force Prerelease w Rebelowej Strefie Gier
    ("lorcana", "338000"),      # Tuesday Lorcana Toronto July 08
    ("sw_unlimited", "341500"), # Star Wars Unlimited Weekly Play
    ("lorcana", "348500"),      # Lorcana Store Champ
    ("sw_unlimited", "355500"), # Legends of the Force Store Showdown
    ("mtg", "366000"),          # MTG Spider-man Prerelese
    ("sw_unlimited", "376500"), # TORNEO SWU
    ("mtg", "397500"),          # Lorwyn Prerelease
    ("sw_unlimited", "401000"), # Store showdown Secrets of Power
    ("sw_unlimited", "404500"), # SWU - Store Showdown
    ("sw_unlimited", "411500"), # Star Wars Unlimited 03-07-2025 Prerelease
    ("sw_unlimited", "418500"), # SWU: Casual Premier 3/31
    ("sw_unlimited", "432500"), # MSB SWU Weekly
    ("sw_unlimited", "436000"), # Star Wars: Unlimited – Store Showdown
    ("mtg", "443000"),          # MTG Paper Legacy Discord - Weekday Warrior Tournament - 7/8/26
    ("sw_unlimited", "446500"), # SWU Ashes of the Empire Draft
]


def discover_melee_targets(
    game_system: str = "all",
    days: int = 14,
    max_events: Optional[int] = 100,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    existing_ids: Optional[set] = None,
) -> List[Tuple[str, str]]:
    """
    Discovers completed Melee.gg tournaments across 2020–2026 (`mtg`, `sw_unlimited`, `lorcana`, `flesh_and_blood`).
    Prioritizes unimported events when `existing_ids` is provided so successive backfill runs advance through the archive.
    """
    target_sys = (game_system or "all").strip().lower()
    is_backfill = bool((days or 14) >= 365 or start_date)
    cap = max_events or (200 if is_backfill else 15)
    existing_set = existing_ids or set()

    candidate_pool: List[Tuple[str, str]] = list(DEFAULT_MELEE_TARGETS) + (
        list(HISTORICAL_MELEE_TARGETS) if is_backfill else []
    )
    seen_tids = {tid for _, tid in candidate_pool}

    cache_gz_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "melee_live_cache.json.gz")
    if is_backfill and os.path.exists(cache_gz_path):
        try:
            with gzip.open(cache_gz_path, "rt", encoding="utf-8") as gf:
                cached_by_tid = json.load(gf) or {}
            for raw_tid in sorted(cached_by_tid.keys(), key=lambda x: int(x) if str(x).isdigit() else 0):
                if raw_tid not in seen_tids:
                    gs_val = str((cached_by_tid.get(raw_tid) or {}).get("game_system") or "mtg").strip().lower()
                    seen_tids.add(raw_tid)
                    candidate_pool.append((gs_val, str(raw_tid)))
        except Exception:
            pass

    filtered = [
        (s, tid)
        for s, tid in candidate_pool
        if target_sys in ("all", "other", "tcg") or s == target_sys
    ]
    unimported = [
        (s, tid)
        for s, tid in filtered
        if tid not in existing_set and f"melee:{tid}" not in existing_set
    ]
    selected = unimported[:cap] if unimported else filtered[:cap]
    return selected


def run_melee_sync(
    game_system: str = "all",
    days: int = 14,
    max_events: Optional[int] = 100,
    event_ids: Optional[List[Tuple[str, str]]] = None,
    sqlite_path: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Dict[str, Any]:
    """Executes the Melee.gg tournament sync and incremental Elo reconstruction."""
    logger.info(
        f"🚀 Starting Melee.gg Sync Job (game_system={game_system}, days={days}, "
        f"start_date={start_date}, end_date={end_date}, max_events={max_events})"
    )
    db = get_sync_db(sqlite_path=sqlite_path)
    is_backfill = bool((days or 14) >= 365 or start_date)

    if event_ids:
        targets = event_ids
    else:
        existing_ids = get_existing_platform_event_ids(db, "melee") if is_backfill else set()
        targets = discover_melee_targets(
            game_system=game_system,
            days=days,
            max_events=max_events,
            start_date=start_date,
            end_date=end_date,
            existing_ids=existing_ids,
        )

    if not targets:
        logger.info("ℹ️ [MeleeSync] No matching Melee.gg tournaments specified.")
        return {"platform": "melee", "events_imported": 0, "matches_imported": 0}

    import_res = import_live_melee_tournaments(db, targets)
    touched_systems = sorted({t[0] for t in targets})
    finalize_res = finalize_platform_sync(db, touched_systems, platform_name="Melee.gg")

    return {
        **import_res,
        **finalize_res,
        "platform": "melee",
        "targets_count": len(targets),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cloud Run Job: Melee.gg tournament sync & Elo recalculation")
    parser.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "all"), help="Game system (all, mtg, sw_unlimited, lorcana, flesh_and_blood)")
    parser.add_argument("--days", type=int, default=int(os.getenv("DAYS", "14")), help="Days of past tournaments to scrape (default: 14; use 3650 for 10yr backfill)")
    parser.add_argument("--start-date", "--from", dest="start_date", default=os.getenv("START_DATE"), help="Optional start date (YYYY-MM-DD or ISO8601)")
    parser.add_argument("--end-date", "--to", dest="end_date", default=os.getenv("END_DATE"), help="Optional end date (YYYY-MM-DD or ISO8601)")
    parser.add_argument("--max-events", type=int, default=int(os.getenv("MAX_EVENTS", "10")), help="Max tournaments to scrape (default: 10)")
    parser.add_argument("--event-ids", default="", help="Optional comma-separated sys:tournament_id pairs (e.g. mtg:428253,sw_unlimited:458821)")
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

    res = run_melee_sync(
        game_system=args.game_system,
        days=args.days,
        max_events=args.max_events,
        event_ids=explicit_pairs,
        sqlite_path=args.sqlite_path,
        start_date=args.start_date,
        end_date=args.end_date,
    )
    print(json.dumps(res, indent=2, default=str))
