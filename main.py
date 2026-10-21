#!/usr/bin/env python3
"""CLI interface for Best Coast Pairings scraper and Warhammer 40k Elo Ranking Engine."""

import argparse
import csv
import json
import os
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional

try:
    from google3.experimental.users.hsiehjun.EloRanking.config import (
        DEFAULT_GAME_SYSTEM_ID, AOS_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR,
        MIN_MATCHES_FOR_RANKING, get_package_dir, DATABASE_URL
    )
    from google3.experimental.users.hsiehjun.EloRanking.database import Database
    from google3.experimental.users.hsiehjun.EloRanking.scraper import BestCoastPairingsScraper
    from google3.experimental.users.hsiehjun.EloRanking.elo import EloEngine
except ImportError:
    try:
        from experimental.users.hsiehjun.EloRanking.config import (
            DEFAULT_GAME_SYSTEM_ID, AOS_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR,
            MIN_MATCHES_FOR_RANKING, get_package_dir, DATABASE_URL
        )
        from experimental.users.hsiehjun.EloRanking.database import Database
        from experimental.users.hsiehjun.EloRanking.scraper import BestCoastPairingsScraper
        from experimental.users.hsiehjun.EloRanking.elo import EloEngine
    except ImportError:
        from config import (
            DEFAULT_GAME_SYSTEM_ID, AOS_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR,
            MIN_MATCHES_FOR_RANKING, get_package_dir, DATABASE_URL,
            normalize_game_system, get_bcp_game_system_id
        )
        from database import Database, get_db
        from scraper import BestCoastPairingsScraper
        from elo import EloEngine


def resolve_output_path(path_str: str) -> Path:
    """Resolves relative file path inside experimental/users/hsiehjun/EloRanking."""
    p = Path(path_str)
    if p.is_absolute():
        return p
    return get_package_dir() / p


def format_table(headers, rows):
    """Formats and prints an ASCII table."""
    if not rows:
        print("No records found.")
        return

    col_widths = [len(h) for h in headers]
    for row in rows:
        for i, val in enumerate(row):
            col_widths[i] = max(col_widths[i], len(str(val)))

    header_line = " | ".join(h.ljust(col_widths[i]) for i, h in enumerate(headers))
    sep_line = "-+-".join("-" * col_widths[i] for i in range(len(headers)))

    print(header_line)
    print(sep_line)
    for row in rows:
        print(" | ".join(str(val).ljust(col_widths[i]) for i, val in enumerate(row)))


def format_iso_date(val: Optional[str], is_end: bool = False) -> Optional[str]:
    """Converts user input like '2026-08-01' or '2026-08-01T00:00:00.000Z' into valid BCP ISO8601 strings."""
    if not val:
        return None
    val = val.strip()
    if "T" in val:
        return val
    if len(val) == 10:  # YYYY-MM-DD
        if is_end:
            return f"{val}T23:59:59.999Z"
        return f"{val}T00:00:00.000Z"
    return val


def cmd_scrape(args):
    """Scrapes tournaments and matches from BCP."""
    db = get_db(dsn=getattr(args, "dsn", None))
    scraper = BestCoastPairingsScraper(db=db, request_delay=args.delay)

    if args.event_id:
        print(f"[*] Scraping single event: {args.event_id}...")
        matches_count = scraper.scrape_event(args.event_id)
        print(f"[+] Successfully scraped {matches_count} matches from event {args.event_id}.")
    else:
        start_arg = args.start_date or getattr(args, "from_date", None) or os.getenv("START_DATE")
        end_arg = args.end_date or getattr(args, "to_date", None) or os.getenv("END_DATE")
        max_events_arg = args.max_events or (int(os.getenv("MAX_EVENTS")) if os.getenv("MAX_EVENTS") else None)

        if start_arg or end_arg:
            start_date = format_iso_date(start_arg, is_end=False) or (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%dT00:00:00.000Z")
            end_date = format_iso_date(end_arg, is_end=True) or datetime.now(timezone.utc).strftime("%Y-%m-%dT23:59:59.999Z")
        else:
            end_date = datetime.now(timezone.utc).strftime("%Y-%m-%dT23:59:59.999Z")
            start_dt = datetime.now(timezone.utc) - timedelta(days=args.days)
            start_date = start_dt.strftime("%Y-%m-%dT00:00:00.000Z")

        game_system = (getattr(args, "game_system", None) or os.getenv("GAME_SYSTEM", "40k")).lower()
        game_system_id = getattr(args, "game_system_id", None) or os.getenv("GAME_SYSTEM_ID")

        systems_to_scrape = []
        if game_system_id:
            systems_to_scrape.append((normalize_game_system(game_system), game_system_id))
        elif "," in game_system:
            for part in [p.strip() for p in game_system.split(",") if p.strip()]:
                if part in ("other", "others", "non_40k_aos", "all_other"):
                    systems_to_scrape.append(("other", None))
                else:
                    norm_part = normalize_game_system(part)
                    systems_to_scrape.append((norm_part, get_bcp_game_system_id(norm_part)))
        elif game_system in ("40k", "wh40k"):
            systems_to_scrape.append(("40k", DEFAULT_GAME_SYSTEM_ID))
        elif game_system in ("aos", "warhammer_aos", "sigmar"):
            systems_to_scrape.append(("aos", AOS_GAME_SYSTEM_ID))
        elif game_system in ("other", "others", "non_40k_aos", "all_other"):
            systems_to_scrape.append(("other", None))
        elif game_system == "all":
            systems_to_scrape.append(("40k", DEFAULT_GAME_SYSTEM_ID))
            systems_to_scrape.append(("aos", AOS_GAME_SYSTEM_ID))
            systems_to_scrape.append(("other", None))
        else:
            norm_sys = normalize_game_system(game_system)
            systems_to_scrape.append((norm_sys, get_bcp_game_system_id(norm_sys)))

        total_ev = 0
        total_ma = 0
        for sys_name, sys_id in systems_to_scrape:
            if sys_name == "other" and sys_id is None:
                print(f"[*] Scraping ALL OTHER BCP game systems (excluding 40K & AoS) between {start_date} and {end_date} (Max: {max_events_arg or 'Unlimited'})...")
                res = scraper.scrape_other_systems_date_range(start_date=start_date, end_date=end_date, max_events=max_events_arg)
            else:
                print(f"[*] Scraping {sys_name.upper()} events between {start_date} and {end_date} (GameSystemId: {sys_id}, Max: {max_events_arg or 'Unlimited'})...")
                print(f"[*] Writing to database: {db.db_path}")
                res = scraper.scrape_date_range(start_date=start_date, end_date=end_date, game_system_id=sys_id, max_events=max_events_arg)
            total_ev += res.get("events_scraped", 0)
            total_ma += res.get("matches_scraped", 0)
            print(f"[+] {sys_name.upper()} scraping finished: {res['events_scraped']} events, {res['matches_scraped']} matches.")

        print(f"[+] All scraping finished: {total_ev} events, {total_ma} matches stored in database at:")
        print(f"    {db.db_path}")

    # Optional auto-reconstruct
    reconstruct_all = getattr(args, "reconstruct_all", False) or os.getenv("RECONSTRUCT_ALL", "").lower() in ("true", "1", "yes")
    reconstruct = getattr(args, "reconstruct", False) or os.getenv("RECONSTRUCT", "").lower() in ("true", "1", "yes")
    target_recon = (getattr(args, "game_system", None) or os.getenv("GAME_SYSTEM", "40k") or "40k").lower()
    if reconstruct_all:
        print(f"\n[*] Automatically recomputing FULL Elo ratings for {target_recon.upper()} from scratch...")
        engine = EloEngine(db=db)
        res_recon = engine.reconstruct_all_rankings(game_system=target_recon)
        print(f"[+] Full Elo Reconstruction Finished: {res_recon}")
    elif reconstruct or target_recon in ("other", "others", "non_40k_aos", "all_other"):
        print(f"\n[*] Automatically recomputing Elo ratings for {target_recon.upper()} across historical matches...")
        engine = EloEngine(db=db)
        res_recon = engine.reconstruct_incremental(game_system=target_recon)
        print(f"[+] Elo Reconstruction Finished:")
        print(f"    - Total Matches Processed: {res_recon.get('total_new_matches', res_recon.get('total_matches_processed', 0))}")
        print(f"    - Status:                  {res_recon.get('status', 'OK')}")


def cmd_reconstruct(args):
    """Reconstructs historical Elo ratings and win paths (chunked or incremental)."""
    db = get_db(dsn=getattr(args, "dsn", None))
    engine = EloEngine(
        db=db,
        initial_elo=args.initial_elo,
        default_k=args.k_factor
    )
    game_system = getattr(args, "game_system", "40k") or "40k"
    if getattr(args, "incremental", False):
        res = engine.reconstruct_incremental(game_system=game_system)
    else:
        chunk_size = getattr(args, "chunk_size", 50000) or 50000
        res = engine.reconstruct_all_rankings(chunk_size=chunk_size, game_system=game_system)


def cmd_leaderboard(args):
    """Displays top ranked players."""
    db = get_db(dsn=getattr(args, "dsn", None))
    game_system = getattr(args, "game_system", "40k") or "40k"
    players = db.get_top_ranked_players(limit=args.top, min_matches=args.min_matches, game_system=game_system)
    if not players:
        print(f"No ranked {game_system.upper()} players with at least {args.min_matches} matches found. Try running 'reconstruct' or lowering '--min-matches'.")
        return

    headers = ["Rank", "Player Name", "Elo", "Peak Elo", "Matches", "W", "L", "D", "Win %", "Last Active"]
    rows = []
    for rank, p in enumerate(players, 1):
        last_act = (p["last_active_date"] or "")[:10]
        rows.append([
            f"#{rank}",
            p["player_name"] or p["player_id"],
            f"{p['current_elo']:.1f}",
            f"{p['peak_elo']:.1f}",
            p["matches_played"],
            p["wins"],
            p["losses"],
            p["draws"],
            f"{p['win_rate']:.1f}%",
            last_act
        ])
    print(f"\n=== {game_system.upper()} Top {len(rows)} Leaderboard (Min {args.min_matches} Matches) ===")
    format_table(headers, rows)


def cmd_player(args):
    """Displays a player's win path and rating history."""
    db = Database()
    game_system = getattr(args, "game_system", "40k") or "40k"
    matches = db.search_players(args.name, game_system=game_system)
    if not matches:
        print(f"[-] No player found matching query '{args.name}' in {game_system.upper()}.")
        return

    player = matches[0]
    pid = player["id"]
    pname = player["full_name"] or player["id"]

    print(f"\n=======================================================")
    print(f" Player Profile: {pname} (ID: {pid}) [{game_system.upper()}]")
    print(f" Current Elo:    {player.get('current_elo', INITIAL_ELO):.1f}")
    print(f" Peak Elo:       {player.get('peak_elo', INITIAL_ELO):.1f}")
    print(f" Record:         {player.get('wins', 0)}W - {player.get('losses', 0)}L - {player.get('draws', 0)}D ({player.get('win_rate', 0):.1f}%)")
    print(f"=======================================================\n")

    engine = EloEngine(db=db)
    path_data = engine.get_player_win_path(pid, game_system=game_system)
    history = path_data.get("win_path", [])

    if not history:
        print("No historical match win path recorded.")
        return

    print("Historical Win Path & Elo Trajectory:")
    headers = ["Date", "Event", "Rnd", "Result", "Score", "Faction", "Opponent", "Opp Elo", "Delta", "New Elo"]
    rows = []
    for h in history:
        date_str = (h.get("match_date") or "")[:10]
        ev_name = (h.get("event_name") or "Tournament")[:20]
        res = h.get("result", "")
        p_score = h.get("player_score")
        o_score = h.get("opponent_score")
        score_str = f"{p_score or 0}-{o_score or 0}" if p_score is not None else "-"
        opp_name = (h.get("opponent_name") or "BYE")[:18]
        opp_elo = f"{h['opponent_elo']:.1f}" if h.get("opponent_elo") else "-"
        delta = f"{h['delta_elo']:+.1f}" if h.get("delta_elo") else "0.0"
        new_elo = f"{h['new_elo']:.1f}" if h.get("new_elo") else "-"
        p_faction = (h.get("player_faction") or "")[:16]

        rows.append([
            date_str,
            ev_name,
            h.get("round", 1),
            res,
            score_str,
            p_faction,
            opp_name,
            opp_elo,
            delta,
            new_elo
        ])
    format_table(headers, rows)


def cmd_sync(args):
    """Executes the automated tournament sync job."""
    from scripts.sync_tournaments import run_tournament_sync
    run_tournament_sync(
        game_system=args.game_system,
        days=args.days,
        max_events=args.max_events
    )


def cmd_sync_melee(args):
    """Executes the Melee.gg tournament sync job."""
    from scripts.sync_melee import run_melee_sync
    res = run_melee_sync(
        game_system=args.game_system,
        days=args.days,
        max_events=args.max_events,
    )
    print(json.dumps(res, indent=2, default=str))


def cmd_sync_limitless(args):
    """Executes the Limitless TCG tournament sync job."""
    from scripts.sync_limitless import run_limitless_sync
    res = run_limitless_sync(
        game_system=args.game_system,
        days=args.days,
        max_events=args.max_events,
    )
    print(json.dumps(res, indent=2, default=str))


def cmd_sync_longshanks(args):
    """Executes the Longshanks tournament sync job."""
    from scripts.sync_longshanks import run_longshanks_sync
    res = run_longshanks_sync(
        game_system=args.game_system,
        days=args.days,
        max_events=args.max_events,
    )
    print(json.dumps(res, indent=2, default=str))


def cmd_sync_topdeck(args):
    """Executes the TopDeck.gg tournament sync job."""
    from scripts.sync_topdeck import run_topdeck_sync
    res = run_topdeck_sync(
        game_system=args.game_system,
        days=args.days,
        max_events=args.max_events,
    )
    print(json.dumps(res, indent=2, default=str))


def cmd_player_sync(args):
    """Executes the BCP player name sync and data repair job."""
    from player_sync import sync_player_names_job
    res = sync_player_names_job(
        game_system=args.game_system,
        max_bcp_calls=getattr(args, "limit", None) or getattr(args, "max_calls", None),
        dry_run=getattr(args, "dry_run", False),
        concurrency=getattr(args, "concurrency", 8),
        batch_commit_size=getattr(args, "batch_commit", 100)
    )
    print("Player Name Sync Result:", json.dumps(res, indent=2))



def cmd_stats(args):
    """Displays overall database statistics."""
    db = Database()
    game_system = getattr(args, "game_system", "40k") or "40k"
    stats = db.get_summary_stats(game_system=game_system)
    print(f"\n=== Best Coast Pairings Scraper Statistics [{game_system.upper()}] ===")
    print(f"  Database Location:         {db.db_path}")
    print(f"  Total Tournaments Scraped: {stats['total_events']}")
    print(f"  Total Matches Stored:      {stats['total_matches']}")
    print(f"  Total Unique Players:      {stats['total_players']}")
    print(f"  Ranked Players (Elo):      {stats['ranked_players']}")
    print("==============================================\n")


def cmd_export(args):
    """Exports rankings or match history to CSV/JSON."""
    db = Database()
    out_path = resolve_output_path(args.output)
    out_path.parent.mkdir(exist_ok=True, parents=True)
    game_system = getattr(args, "game_system", "40k") or "40k"

    if args.type == "rankings":
        data = db.get_top_ranked_players(limit=100000, min_matches=0, game_system=game_system)
        if str(out_path).endswith(".json"):
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        else:
            if not data:
                print("No ranking data to export.")
                return
            keys = list(data[0].keys())
            with open(out_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=keys)
                writer.writeheader()
                writer.writerows(data)
    elif args.type == "matches":
        data = db.get_all_matches_chronological(game_system=game_system)
        if str(out_path).endswith(".json"):
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        else:
            if not data:
                print("No match data to export.")
                return
            keys = [k for k in data[0].keys() if k != "raw_json"]
            with open(out_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
                writer.writeheader()
                writer.writerows(data)

    print(f"[+] Exported {len(data)} {args.type} records to {out_path}")


def cmd_serve(args):
    """Starts the Web UI HTTP server."""
    try:
        from google3.experimental.users.hsiehjun.EloRanking.server import start_server
    except ImportError:
        try:
            from experimental.users.hsiehjun.EloRanking.server import start_server
        except ImportError:
            from server import start_server
    start_server(port=args.port, host=args.host)


def cmd_repair_elo(args):
    """Retroactively repairs corrupted BCP match results and reconstructs global Elo ratings."""
    db = get_db(dsn=getattr(args, "db", None))
    from scripts.repair_matches_and_elo import repair_historical_matches_and_elo

    res = repair_historical_matches_and_elo(
        db=db,
        event_ids=args.event_ids,
        days=args.days,
        scan_all=args.scan_all,
        reconstruct=not args.no_reconstruct,
        force_reconstruct=args.force_reconstruct,
        max_workers=args.workers,
    )
    print(json.dumps(res, indent=2, default=str))


def main():
    parser = argparse.ArgumentParser(description="Warhammer 40k & Age of Sigmar BCP Scraper & Elo Ranking Engine")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # Scrape command
    p_scrape = subparsers.add_parser("scrape", help="Scrape events and matches from BCP")
    p_scrape.add_argument("--start-date", "--from", dest="start_date", help="Start date (e.g. 2026-08-01 or 2026-08-01T00:00:00.000Z)")
    p_scrape.add_argument("--end-date", "--to", dest="end_date", help="End date (e.g. 2026-08-15 or 2026-08-15T23:59:59.999Z)")
    p_scrape.add_argument("--days", type=int, default=30, help="Number of past days to scrape if start-date not set (default: 30)")
    p_scrape.add_argument("--max-events", type=int, default=None, help="Maximum number of events to scrape")
    p_scrape.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "40k"), help="Game system to scrape (default: 40k)")
    p_scrape.add_argument("--game-system-id", default=os.getenv("GAME_SYSTEM_ID"), help="Explicit BCP gameSystemId override")
    p_scrape.add_argument("--event-id", help="Scrape a single specific event by BCP ID")
    p_scrape.add_argument("--delay", type=float, default=0.4, help="Delay between API calls in seconds")
    p_scrape.add_argument("--db", help="PostgreSQL connection string (DSN)")
    p_scrape.add_argument("--reconstruct", action="store_true", default=False, help="Automatically recompute Elo ratings after scraping")
    p_scrape.add_argument("--reconstruct-all", "--full-reconstruct", dest="reconstruct_all", action="store_true", default=False, help="Replay all historical matches chronologically from scratch")

    # Reconstruct command
    p_recon = subparsers.add_parser("reconstruct", help="Reconstruct Elo ratings from historical matches")
    p_recon.add_argument("-i", "--incremental", action="store_true", help="Incrementally update ratings for newly scraped matches only (blazing fast)")
    p_recon.add_argument("--chunk-size", type=int, default=50000, help="Chronological window chunk size for memory-safe replay (default: 50000)")
    p_recon.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "40k"), help="Game system to reconstruct (default: 40k)")
    p_recon.add_argument("--initial-elo", type=float, default=INITIAL_ELO, help="Base starting Elo (default: 1500)")
    p_recon.add_argument("--k-factor", type=float, default=DEFAULT_K_FACTOR, help="Default K-factor (default: 32)")
    p_recon.add_argument("--db", help="PostgreSQL connection string (DSN)")

    # Repair matches & Elo command
    p_repair = subparsers.add_parser("repair-elo", aliases=["repair-matches"], help="Retroactively repair corrupted BCP match results and reconstruct global Elo ratings")
    p_repair.add_argument("--event-id", dest="event_ids", action="append", help="Specific BCP event ID(s) to repair (can be passed multiple times)")
    p_repair.add_argument("--days", type=int, default=None, help="Also scan all BCP events within the past N days")
    p_repair.add_argument("--scan-all", action="store_true", help="Scan all BCP events in the database")
    p_repair.add_argument("--no-reconstruct", action="store_true", help="Only repair matches table without running full Elo reconstruction")
    p_repair.add_argument("--force-reconstruct", action="store_true", default=True, help="Run full Elo reconstruction even if 0 match rows needed changes")
    p_repair.add_argument("--workers", type=int, default=10, help="Max concurrent BCP API workers (default: 10)")
    p_repair.add_argument("--db", help="PostgreSQL connection string (DSN)")

    # Leaderboard command
    p_lead = subparsers.add_parser("leaderboard", help="View player Elo rankings")
    p_lead.add_argument("--top", type=int, default=30, help="Number of top players to display")
    p_lead.add_argument("--min-matches", type=int, default=MIN_MATCHES_FOR_RANKING, help="Minimum matches to qualify")
    p_lead.add_argument("--game-system", default="40k", help="Game system leaderboard (default: 40k)")
    p_lead.add_argument("--db", help="PostgreSQL connection string (DSN)")

    # Player command
    p_player = subparsers.add_parser("player", help="Inspect a player's win path and match progression")
    p_player.add_argument("name", help="Player full name, partial name, or User ID")
    p_player.add_argument("--game-system", default="40k", help="Game system profile (default: 40k)")
    p_player.add_argument("--db", help="PostgreSQL connection string (DSN)")

    # Sync command (Cloud Run Job wrapper)
    p_sync = subparsers.add_parser("sync", help="Run automated tournament sync and Elo recalculation")
    p_sync.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "all"), help="Game system to sync (default: all)")
    p_sync.add_argument("--days", type=int, default=int(os.getenv("DAYS", "3")), help="Days of past tournaments to scrape (default: 3)")
    p_sync.add_argument("--max-events", type=int, default=int(os.getenv("MAX_EVENTS")) if os.getenv("MAX_EVENTS") else None, help="Max tournaments to scrape per game system (default: None for unlimited)")

    # Melee.gg sync command (Cloud Run Job: elo-melee-sync-job)
    p_sync_melee = subparsers.add_parser("sync-melee", help="Run Melee.gg tournament sync and Elo recalculation")
    p_sync_melee.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "all"), help="Game system to sync (default: all)")
    p_sync_melee.add_argument("--days", type=int, default=int(os.getenv("DAYS", "14")), help="Days of past tournaments to scrape (default: 14)")
    p_sync_melee.add_argument("--max-events", type=int, default=int(os.getenv("MAX_EVENTS", "10")), help="Max tournaments to scrape (default: 10)")

    # Limitless TCG sync command (Cloud Run Job: elo-limitless-sync-job)
    p_sync_limitless = subparsers.add_parser("sync-limitless", help="Run Limitless TCG tournament sync and Elo recalculation")
    p_sync_limitless.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "all"), help="Game system to sync (default: all)")
    p_sync_limitless.add_argument("--days", type=int, default=int(os.getenv("DAYS", "14")), help="Days of past tournaments to scrape (default: 14)")
    p_sync_limitless.add_argument("--max-events", type=int, default=int(os.getenv("MAX_EVENTS", "15")), help="Max tournaments to scrape (default: 15)")

    # Longshanks sync command (Cloud Run Job: elo-longshanks-sync-job)
    p_sync_longshanks = subparsers.add_parser("sync-longshanks", help="Run Longshanks tournament sync and Elo recalculation")
    p_sync_longshanks.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "all"), help="Game system to sync (default: all)")
    p_sync_longshanks.add_argument("--days", type=int, default=int(os.getenv("DAYS", "14")), help="Days of past tournaments to scrape (default: 14)")
    p_sync_longshanks.add_argument("--max-events", type=int, default=int(os.getenv("MAX_EVENTS", "10")), help="Max tournaments to scrape (default: 10)")

    # TopDeck.gg sync command (Cloud Run Job: elo-topdeck-sync-job)
    p_sync_topdeck = subparsers.add_parser("sync-topdeck", help="Run TopDeck.gg tournament sync and Elo recalculation")
    p_sync_topdeck.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "mtg"), help="Game system to sync (default: mtg)")
    p_sync_topdeck.add_argument("--days", type=int, default=int(os.getenv("DAYS", "14")), help="Days of past tournaments to scrape (default: 14)")
    p_sync_topdeck.add_argument("--max-events", type=int, default=int(os.getenv("MAX_EVENTS", "10")), help="Max tournaments to scrape (default: 10)")

    # Player name sync command
    p_psync = subparsers.add_parser("sync-players", aliases=["player-sync"], help="Sync and repair placeholder player names ('Player 1', 'Player 2') from BCP")
    p_psync.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "all"), help="Game system to check (default: all)")
    p_psync.add_argument("--limit", "--max-calls", dest="limit", type=int, default=None, help="Maximum BCP API calls to perform (e.g. 500, 1000)")
    p_psync.add_argument("--concurrency", "--workers", dest="concurrency", type=int, default=8, help="Number of concurrent worker threads (default: 8)")
    p_psync.add_argument("--batch-commit", type=int, default=100, help="Commit to database every N resolved names (default: 100)")
    p_psync.add_argument("--dry-run", action="store_true", help="Scan and resolve names without writing to database")

    # Stats command
    p_stats = subparsers.add_parser("stats", help="View database statistics")
    p_stats.add_argument("--game-system", default="40k", help="Game system stats (default: 40k)")
    p_stats.add_argument("--db", help="PostgreSQL connection string (DSN)")

    # Export command
    p_export = subparsers.add_parser("export", help="Export data to CSV or JSON")
    p_export.add_argument("--type", choices=["rankings", "matches"], default="rankings", help="Data type to export")
    p_export.add_argument("--output", default="rankings.csv", help="Output file path (.csv or .json)")
    p_export.add_argument("--game-system", default="40k", help="Game system export (default: 40k)")
    p_export.add_argument("--db", help="PostgreSQL connection string (DSN)")

    # Serve command
    p_serve = subparsers.add_parser("serve", help="Start the Web UI server")
    p_serve.add_argument("--port", type=int, default=8080, help="Port to listen on (default: 8080)")
    p_serve.add_argument("--host", default="0.0.0.0", help="Host interface (default: 0.0.0.0)")

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    if args.command == "scrape":
        cmd_scrape(args)
    elif args.command == "reconstruct":
        cmd_reconstruct(args)
    elif args.command in ("repair-elo", "repair-matches"):
        cmd_repair_elo(args)
    elif args.command == "leaderboard":
        cmd_leaderboard(args)
    elif args.command == "player":
        cmd_player(args)
    elif args.command == "sync":
        cmd_sync(args)
    elif args.command == "sync-melee":
        cmd_sync_melee(args)
    elif args.command == "sync-limitless":
        cmd_sync_limitless(args)
    elif args.command == "sync-longshanks":
        cmd_sync_longshanks(args)
    elif args.command == "sync-topdeck":
        cmd_sync_topdeck(args)
    elif args.command in ("sync-players", "player-sync"):
        cmd_player_sync(args)
    elif args.command == "stats":
        cmd_stats(args)
    elif args.command == "export":
        cmd_export(args)
    elif args.command == "serve":
        cmd_serve(args)


if __name__ == "__main__":
    main()
