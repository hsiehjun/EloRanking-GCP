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
        DEFAULT_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR,
        MIN_MATCHES_FOR_RANKING, get_package_dir, DATABASE_URL
    )
    from google3.experimental.users.hsiehjun.EloRanking.database import Database
    from google3.experimental.users.hsiehjun.EloRanking.scraper import BestCoastPairingsScraper
    from google3.experimental.users.hsiehjun.EloRanking.elo import EloEngine
except ImportError:
    try:
        from experimental.users.hsiehjun.EloRanking.config import (
            DEFAULT_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR,
            MIN_MATCHES_FOR_RANKING, get_package_dir, DATABASE_URL
        )
        from experimental.users.hsiehjun.EloRanking.database import Database
        from experimental.users.hsiehjun.EloRanking.scraper import BestCoastPairingsScraper
        from experimental.users.hsiehjun.EloRanking.elo import EloEngine
    except ImportError:
        from config import (
            DEFAULT_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR,
            MIN_MATCHES_FOR_RANKING, get_package_dir, DATABASE_URL
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
        start_arg = args.start_date or getattr(args, "from_date", None)
        end_arg = args.end_date or getattr(args, "to_date", None)

        if start_arg or end_arg:
            start_date = format_iso_date(start_arg, is_end=False) or (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%dT00:00:00.000Z")
            end_date = format_iso_date(end_arg, is_end=True) or datetime.now(timezone.utc).strftime("%Y-%m-%dT23:59:59.999Z")
        else:
            end_date = datetime.now(timezone.utc).strftime("%Y-%m-%dT23:59:59.999Z")
            start_dt = datetime.now(timezone.utc) - timedelta(days=args.days)
            start_date = start_dt.strftime("%Y-%m-%dT00:00:00.000Z")

        print(f"[*] Scraping Warhammer 40,000 events between {start_date} and {end_date} (Max: {args.max_events or 'Unlimited'})...")
        print(f"[*] Writing to database: {db.db_path}")
        res = scraper.scrape_date_range(start_date=start_date, end_date=end_date, max_events=args.max_events)
        print(f"[+] Scraping finished: {res['events_scraped']} events, {res['matches_scraped']} matches stored in database at:")
        print(f"    {db.db_path}")

    # Optional auto-reconstruct
    if getattr(args, "reconstruct", False):
        print("\n[*] Automatically recomputing Elo ratings across all historical matches...")
        engine = EloEngine(db=db)
        res_recon = engine.reconstruct_incremental()
        print(f"[+] Elo Reconstruction Finished:")
        print(f"    - Total Matches Processed: {res_recon['total_matches_processed']}")
        print(f"    - Total Players Ranked:    {res_recon['total_players_ranked']}")
        print(f"    - History Points Saved:    {res_recon['history_points_saved']}")


def cmd_reconstruct(args):
    """Reconstructs historical Elo ratings and win paths (chunked or incremental)."""
    db = get_db(dsn=getattr(args, "dsn", None))
    engine = EloEngine(
        db=db,
        initial_elo=args.initial_elo,
        default_k=args.k_factor
    )
    if getattr(args, "incremental", False):
        res = engine.reconstruct_incremental()
    else:
        chunk_size = getattr(args, "chunk_size", 50000) or 50000
        res = engine.reconstruct_all_rankings(chunk_size=chunk_size)


def cmd_leaderboard(args):
    """Displays top ranked players."""
    db = get_db(dsn=getattr(args, "dsn", None))
    players = db.get_top_ranked_players(limit=args.top, min_matches=args.min_matches)
    if not players:
        print(f"No ranked players with at least {args.min_matches} matches found. Try running 'reconstruct' or lowering '--min-matches'.")
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
    print(f"\n=== Warhammer 40k Top {len(rows)} Leaderboard (Min {args.min_matches} Matches) ===")
    format_table(headers, rows)


def cmd_player(args):
    """Displays a player's win path and rating history."""
    db = Database()
    matches = db.search_players(args.name)
    if not matches:
        print(f"[-] No player found matching query '{args.name}'.")
        return

    player = matches[0]
    pid = player["id"]
    pname = player["full_name"] or player["id"]

    print(f"\n=======================================================")
    print(f" Player Profile: {pname} (ID: {pid})")
    print(f" Current Elo:    {player.get('current_elo', INITIAL_ELO):.1f}")
    print(f" Peak Elo:       {player.get('peak_elo', INITIAL_ELO):.1f}")
    print(f" Record:         {player.get('wins', 0)}W - {player.get('losses', 0)}L - {player.get('draws', 0)}D ({player.get('win_rate', 0):.1f}%)")
    print(f"=======================================================\n")

    engine = EloEngine(db=db)
    path_data = engine.get_player_win_path(pid)
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


def cmd_stats(args):
    """Displays overall database statistics."""
    db = Database()
    stats = db.get_summary_stats()
    print("\n=== Best Coast Pairings Scraper Statistics ===")
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

    if args.type == "rankings":
        data = db.get_top_ranked_players(limit=100000, min_matches=0)
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
        data = db.get_all_matches_chronological()
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


def main():
    parser = argparse.ArgumentParser(description="Warhammer 40k Best Coast Pairings Scraper & Elo Ranking Engine")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # Scrape command
    p_scrape = subparsers.add_parser("scrape", help="Scrape events and matches from BCP")
    p_scrape.add_argument("--start-date", "--from", dest="start_date", help="Start date (e.g. 2026-08-01 or 2026-08-01T00:00:00.000Z)")
    p_scrape.add_argument("--end-date", "--to", dest="end_date", help="End date (e.g. 2026-08-15 or 2026-08-15T23:59:59.999Z)")
    p_scrape.add_argument("--days", type=int, default=30, help="Number of past days to scrape if start-date not set (default: 30)")
    p_scrape.add_argument("--max-events", type=int, default=None, help="Maximum number of events to scrape")
    p_scrape.add_argument("--event-id", help="Scrape a single specific event by BCP ID")
    p_scrape.add_argument("--delay", type=float, default=0.4, help="Delay between API calls in seconds")
    p_scrape.add_argument("--db", help="PostgreSQL connection string (DSN) (e.g. /tmp/scrape_july.db)")
    p_scrape.add_argument("--reconstruct", action="store_true", default=False, help="Automatically recompute Elo ratings after scraping")

    # Reconstruct command
    p_recon = subparsers.add_parser("reconstruct", help="Reconstruct Elo ratings from historical matches")
    p_recon.add_argument("-i", "--incremental", action="store_true", help="Incrementally update ratings for newly scraped matches only (blazing fast)")
    p_recon.add_argument("--chunk-size", type=int, default=50000, help="Chronological window chunk size for memory-safe replay (default: 50000)")
    p_recon.add_argument("--initial-elo", type=float, default=INITIAL_ELO, help="Base starting Elo (default: 1500)")
    p_recon.add_argument("--k-factor", type=float, default=DEFAULT_K_FACTOR, help="Default K-factor (default: 32)")
    p_recon.add_argument("--db", help="PostgreSQL connection string (DSN)")

    # Leaderboard command
    p_lead = subparsers.add_parser("leaderboard", help="View player Elo rankings")
    p_lead.add_argument("--top", type=int, default=30, help="Number of top players to display")
    p_lead.add_argument("--min-matches", type=int, default=MIN_MATCHES_FOR_RANKING, help="Minimum matches to qualify")
    p_lead.add_argument("--db", help="PostgreSQL connection string (DSN)")

    # Player command
    p_player = subparsers.add_parser("player", help="Inspect a player's win path and match progression")
    p_player.add_argument("name", help="Player full name, partial name, or User ID")
    p_player.add_argument("--db", help="PostgreSQL connection string (DSN)")

    # Stats command
    p_stats = subparsers.add_parser("stats", help="View database statistics")
    p_stats.add_argument("--db", help="PostgreSQL connection string (DSN)")

    # Export command
    p_export = subparsers.add_parser("export", help="Export data to CSV or JSON")
    p_export.add_argument("--type", choices=["rankings", "matches"], default="rankings", help="Data type to export")
    p_export.add_argument("--output", default="rankings.csv", help="Output file path (.csv or .json)")
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
    elif args.command == "leaderboard":
        cmd_leaderboard(args)
    elif args.command == "player":
        cmd_player(args)
    elif args.command == "stats":
        cmd_stats(args)
    elif args.command == "export":
        cmd_export(args)
    elif args.command == "serve":
        cmd_serve(args)


if __name__ == "__main__":
    main()
