"""CLI entrypoint script for Cloud Run Job: Tournament scraping & Elo recalculation."""

import os
import sys

# Ensure repository root is on sys.path so top-level modules are importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import logging
from datetime import datetime, timezone, timedelta

from database import get_database
from scraper import BestCoastPairingsScraper
from elo import get_elo_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.tournament_sync")

def run_tournament_sync():
    logger.info("🚀 Starting Cloud Run Job: BCP Tournament Scraper & Elo Recalculation")
    db = get_database()
    scraper = BestCoastPairingsScraper(db=db)
    
    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=3)
    start_str = start_dt.strftime("%Y-%m-%dT00:00:00.000Z")
    end_str = end_dt.strftime("%Y-%m-%dT23:59:59.999Z")
    
    logger.info(f"📅 Scraping tournaments from {start_str} to {end_str}...")
    res = scraper.scrape_date_range(start_date=start_str, end_date=end_str, max_events=50)
    logger.info(f"✅ Scraped {res.get('events_scraped', 0)} events, {res.get('matches_scraped', 0)} matches.")
    
    logger.info("📈 Recalculating Elo ratings incrementally...")
    engine = get_elo_engine()
    recon_res = engine.reconstruct_incremental()
    logger.info(f"🏆 Elo Reconstruction complete: {recon_res}")
    logger.info("🎉 Cloud Run Job finished successfully!")

if __name__ == "__main__":
    try:
        run_tournament_sync()
    except Exception as e:
        logger.error(f"❌ Tournament sync job failed: {e}", exc_info=True)
        sys.exit(1)
