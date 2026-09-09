"""CLI entrypoint script for Cloud Run Job: Wahapedia rules and points sync.

Supports syncing Warhammer 40,000, Age of Sigmar, or both datasets into PostgreSQL.
"""

import os
import sys

# Ensure repository root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import argparse
import logging
from wahapedia_sync import WahapediaSync

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.wahapedia_sync")

def run_wahapedia_sync(game_system: str = "all", force: bool = False):
    logger.info(f"🚀 Starting Cloud Run Job: Wahapedia Sync (game_system={game_system}, force={force})")
    syncer = WahapediaSync()
    res = syncer.sync_all(force=force, game_system=game_system)
    logger.info(f"🎉 Wahapedia Sync Finished: {res}")
    return res

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Wahapedia PostgreSQL Sync Job")
    parser.add_argument("--game-system", choices=["40k", "aos", "all"], default=os.getenv("GAME_SYSTEM", "all"), help="Game system to sync (default: all)")
    parser.add_argument("--force", action="store_true", default=os.getenv("FORCE_SYNC", "").lower() in ("true", "1", "yes"), help="Force re-sync even if up-to-date")
    args = parser.parse_args()

    try:
        run_wahapedia_sync(game_system=args.game_system, force=args.force)
    except Exception as e:
        logger.error(f"❌ Wahapedia sync failed: {e}", exc_info=True)
        sys.exit(1)
