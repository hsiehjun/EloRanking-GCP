"""CLI entrypoint script for Cloud Run Job: Historical Tournament Scrape.

Supports scraping tournaments across a custom date range for Warhammer 40,000,
Age of Sigmar, or both, with flexible parameters passed via CLI flags or environment variables.
"""

import os
import sys

# Ensure repository root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import argparse
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from config import DEFAULT_GAME_SYSTEM_ID, AOS_GAME_SYSTEM_ID
from database import get_database
from scraper import BestCoastPairingsScraper
from elo import get_elo_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.historical_scrape")


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


def run_historical_scrape(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    game_system: str = "40k",
    game_system_id: Optional[str] = None,
    max_events: Optional[int] = None,
    delay: float = 0.4,
    reconstruct: bool = False,
    reconstruct_all: bool = False,
    days: int = 30
):
    logger.info("🚀 Starting Cloud Run Job: BCP Historical Tournament Scrape")
    db = get_database()
    logger.info(f"💾 Target Database: {db.db_path}")
    scraper = BestCoastPairingsScraper(db=db, request_delay=delay)

    # Resolve date boundaries
    if start_date or end_date:
        start_str = format_iso_date(start_date, is_end=False) or (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT00:00:00.000Z")
        end_str = format_iso_date(end_date, is_end=True) or datetime.now(timezone.utc).strftime("%Y-%m-%dT23:59:59.999Z")
    else:
        end_dt = datetime.now(timezone.utc)
        start_dt = end_dt - timedelta(days=days)
        start_str = start_dt.strftime("%Y-%m-%dT00:00:00.000Z")
        end_str = end_dt.strftime("%Y-%m-%dT23:59:59.999Z")

    sys_target = (game_system or "40k").lower()
    total_events = 0
    total_matches = 0

    systems_to_scrape = []
    if game_system_id:
        # Custom ID override
        systems_to_scrape.append((sys_target, game_system_id))
    elif sys_target in ("40k", "wh40k"):
        systems_to_scrape.append(("40k", DEFAULT_GAME_SYSTEM_ID))
    elif sys_target in ("aos", "warhammer_aos", "sigmar"):
        systems_to_scrape.append(("aos", AOS_GAME_SYSTEM_ID))
    elif sys_target == "all":
        systems_to_scrape.append(("40k", DEFAULT_GAME_SYSTEM_ID))
        systems_to_scrape.append(("aos", AOS_GAME_SYSTEM_ID))
    else:
        logger.warning(f"Unknown game system '{sys_target}', defaulting to 40k")
        systems_to_scrape.append(("40k", DEFAULT_GAME_SYSTEM_ID))

    for sys_name, sys_id in systems_to_scrape:
        logger.info(f"📅 Scraping {sys_name.upper()} tournaments (GameSystemID: {sys_id}) from {start_str} to {end_str} (Max: {max_events or 'Unlimited'})...")
        res = scraper.scrape_date_range(start_date=start_str, end_date=end_str, game_system_id=sys_id, max_events=max_events)
        ev_count = res.get("events_scraped", 0)
        ma_count = res.get("matches_scraped", 0)
        total_events += ev_count
        total_matches += ma_count
        logger.info(f"✅ {sys_name.upper()} Scraped: {ev_count} events, {ma_count} matches.")

    logger.info(f"🎉 Historical Scrape Finished: {total_events} events, {total_matches} matches stored.")

    if reconstruct_all:
        logger.info(f"🏆 Performing FULL Elo reconstruction from scratch for game system(s): {sys_target}...")
        engine = get_elo_engine()
        recon_res = engine.reconstruct_all_rankings(game_system=sys_target)
        logger.info(f"🏆 Full Elo Reconstruction complete: {recon_res}")
    elif reconstruct:
        logger.info(f"📈 Automatically recomputing incremental Elo ratings for game system(s): {sys_target}...")
        engine = get_elo_engine()
        recon_res = engine.reconstruct_incremental(game_system=sys_target)
        logger.info(f"🏆 Elo Reconstruction complete: {recon_res}")

    return {
        "game_system": sys_target,
        "start_date": start_str,
        "end_date": end_str,
        "events_scraped": total_events,
        "matches_scraped": total_matches
    }


def main():
    parser = argparse.ArgumentParser(description="BCP Historical Tournament Scrape Job")
    parser.add_argument("--start-date", "--from", dest="start_date", default=os.getenv("START_DATE"), help="Start date (YYYY-MM-DD or ISO8601)")
    parser.add_argument("--end-date", "--to", dest="end_date", default=os.getenv("END_DATE"), help="End date (YYYY-MM-DD or ISO8601)")
    parser.add_argument("--game-system", choices=["40k", "aos", "all"], default=os.getenv("GAME_SYSTEM", "40k"), help="Game system to scrape (default: 40k)")
    parser.add_argument("--game-system-id", default=os.getenv("GAME_SYSTEM_ID"), help="Explicit BCP gameSystemId override")
    parser.add_argument("--days", type=int, default=int(os.getenv("DAYS", "30")), help="Past days if start date omitted (default: 30)")
    parser.add_argument("--max-events", type=int, default=int(os.getenv("MAX_EVENTS")) if os.getenv("MAX_EVENTS") else None, help="Max events to scrape")
    parser.add_argument("--delay", type=float, default=float(os.getenv("DELAY", "0.4")), help="API request delay in seconds")
    parser.add_argument("--reconstruct", action="store_true", default=os.getenv("RECONSTRUCT", "").lower() in ("true", "1", "yes"), help="Recompute incremental Elo after scraping")
    parser.add_argument("--reconstruct-all", "--full-reconstruct", action="store_true", default=os.getenv("RECONSTRUCT_ALL", "").lower() in ("true", "1", "yes"), help="Replay all historical matches chronologically from scratch")
    args = parser.parse_args()

    try:
        run_historical_scrape(
            start_date=args.start_date,
            end_date=args.end_date,
            game_system=args.game_system,
            game_system_id=args.game_system_id,
            max_events=args.max_events,
            delay=args.delay,
            reconstruct=args.reconstruct,
            reconstruct_all=args.reconstruct_all,
            days=args.days
        )
    except Exception as e:
        logger.error(f"❌ Historical scrape failed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
