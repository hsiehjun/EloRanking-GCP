"""CLI entrypoint script for Cloud Run Job: Tournament scraping & Elo recalculation."""

import os
import sys

# Ensure repository root is on sys.path so top-level modules are importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import argparse
import logging
from typing import Optional
from datetime import datetime, timezone, timedelta

from config import DEFAULT_GAME_SYSTEM_ID, AOS_GAME_SYSTEM_ID
from database import get_database
from scraper import BestCoastPairingsScraper
from elo import get_elo_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.tournament_sync")

def run_tournament_sync(game_system: str = "all", days: int = 3, max_events: Optional[int] = None):
    logger.info("🚀 Starting Cloud Run Job: BCP Tournament Scraper & Elo Recalculation")
    db = get_database()
    logger.info(f"💾 Database target: {db.db_path}")
    scraper = BestCoastPairingsScraper(db=db)
    
    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=days)
    start_str = start_dt.strftime("%Y-%m-%dT00:00:00.000Z")
    end_str = end_dt.strftime("%Y-%m-%dT23:59:59.999Z")
    
    target_sys = (game_system or "all").lower()
    total_events = 0
    total_matches = 0

    if target_sys in ("40k", "all"):
        logger.info(f"📅 [40K] Scraping Warhammer 40k tournaments from {start_str} to {end_str}...")
        res_40k = scraper.scrape_date_range(start_date=start_str, end_date=end_str, game_system_id=DEFAULT_GAME_SYSTEM_ID, max_events=max_events)
        e_40k = res_40k.get('events_scraped', 0)
        m_40k = res_40k.get('matches_scraped', 0)
        total_events += e_40k
        total_matches += m_40k
        logger.info(f"✅ [40K] Scraped {e_40k} events, {m_40k} matches.")

    if target_sys in ("aos", "warhammer_aos", "all"):
        logger.info(f"📅 [AOS] Scraping Age of Sigmar tournaments from {start_str} to {end_str}...")
        res_aos = scraper.scrape_date_range(start_date=start_str, end_date=end_str, game_system_id=AOS_GAME_SYSTEM_ID, max_events=max_events)
        e_aos = res_aos.get('events_scraped', 0)
        m_aos = res_aos.get('matches_scraped', 0)
        total_events += e_aos
        total_matches += m_aos
        logger.info(f"✅ [AOS] Scraped {e_aos} events, {m_aos} matches.")

    logger.info(f"📈 Recalculating Elo ratings incrementally for game system(s): {target_sys}...")
    engine = get_elo_engine()
    recon_res = engine.reconstruct_incremental(game_system=target_sys)
    logger.info(f"🏆 Elo Reconstruction complete: {recon_res}")

    # Programmatic sweep of expired Firestore documents across rooms, connect_chats, and connect_user_sync
    try:
        from firestore_db import get_firestore_engine
        fs_engine = get_firestore_engine()
        cleaned = fs_engine.cleanup_expired_documents()
        logger.info(f"🧹 Cleaned up expired Firestore documents: {cleaned}")
    except Exception as e:
        logger.warning(f"Notice during Firestore cleanup: {e}")

    logger.info(f"🎉 Cloud Run Job finished successfully! (Total events: {total_events}, Total matches: {total_matches})")
    return {
        "game_system": target_sys,
        "events_scraped": total_events,
        "matches_scraped": total_matches,
        "reconstruction": recon_res
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cloud Run Job: Tournament scraping & Elo recalculation")
    parser.add_argument("--game-system", choices=["40k", "aos", "all"], default=os.getenv("GAME_SYSTEM", "all"), help="Game system to sync (default: all)")
    parser.add_argument("--days", type=int, default=int(os.getenv("DAYS", "3")), help="Days of past tournaments to scrape (default: 3)")
    parser.add_argument("--max-events", type=int, default=int(os.getenv("MAX_EVENTS")) if os.getenv("MAX_EVENTS") else None, help="Max tournaments to scrape per game system (default: None for unlimited)")
    args = parser.parse_args()

    try:
        run_tournament_sync(game_system=args.game_system, days=args.days, max_events=args.max_events)
    except Exception as e:
        logger.error(f"❌ Tournament sync job failed: {e}", exc_info=True)
        sys.exit(1)
