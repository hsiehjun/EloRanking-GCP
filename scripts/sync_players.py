"""CLI entrypoint script for Cloud Run Job: BCP Player Name Sync & Data Correction.

Discovers competitors with placeholder names ('Player 1', 'Player 2', 'Player')
and enriches them with real names from local DB and BCP API, updating:
players, player_ratings, matches, rating_history, event_participants, tracker_games.
"""

import os
import sys

# Ensure repository root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import argparse
import logging
from player_sync import PlayerNameSync

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.player_sync")


def run_player_sync(game_system: str = "all", max_calls: int = None, dry_run: bool = False):
    logger.info(f"🚀 Starting Cloud Run Job: BCP Player Name Sync (game_system={game_system}, dry_run={dry_run})")
    syncer = PlayerNameSync()
    res = syncer.sync_names(game_system=game_system, max_bcp_calls=max_calls, dry_run=dry_run)
    logger.info(f"🎉 Player Name Sync Finished: {res}")
    return res


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BCP Player Name Sync Job")
    parser.add_argument("--game-system", choices=["40k", "aos", "all"], default=os.getenv("GAME_SYSTEM", "all"), help="Game system to sync (default: all)")
    parser.add_argument("--max-calls", type=int, default=None, help="Maximum BCP API calls")
    parser.add_argument("--dry-run", action="store_true", default=os.getenv("DRY_RUN", "").lower() in ("true", "1", "yes"), help="Scan and resolve without writing")
    args = parser.parse_args()

    try:
        run_player_sync(game_system=args.game_system, max_calls=args.max_calls, dry_run=args.dry_run)
    except Exception as e:
        logger.error(f"❌ Player Name Sync failed: {e}", exc_info=True)
        sys.exit(1)
