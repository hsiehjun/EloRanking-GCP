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


def run_player_sync(
    game_system: str = "all",
    limit: int = None,
    dry_run: bool = False,
    concurrency: int = 8,
    batch_commit_size: int = 100
):
    logger.info(
        f"🚀 Starting Cloud Run Job: BCP Player Name Sync (game_system={game_system}, "
        f"dry_run={dry_run}, concurrency={concurrency}, limit={limit})"
    )
    syncer = PlayerNameSync()
    res = syncer.sync_names(
        game_system=game_system,
        max_bcp_calls=limit,
        dry_run=dry_run,
        concurrency=concurrency,
        batch_commit_size=batch_commit_size
    )
    logger.info(f"🎉 Player Name Sync Finished: {res}")
    return res


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BCP Player Name Sync Job")
    parser.add_argument("script_name", nargs="*", help="Optional script name passed by Cloud Run args (ignored)")
    parser.add_argument("--game-system", choices=["40k", "aos", "all"], default=os.getenv("GAME_SYSTEM", "all"), help="Game system to sync (default: all)")
    parser.add_argument("--limit", "--max-calls", dest="limit", type=int, default=None, help="Maximum BCP API calls (e.g. 500, 1000)")
    parser.add_argument("--concurrency", "--workers", dest="concurrency", type=int, default=8, help="Number of concurrent worker threads (default: 8)")
    parser.add_argument("--batch-commit", type=int, default=100, help="Commit to database every N resolved names (default: 100)")
    parser.add_argument("--dry-run", action="store_true", default=os.getenv("DRY_RUN", "").lower() in ("true", "1", "yes"), help="Scan and resolve without writing")

    # Filter out redundant script filenames (e.g. 'player_sync.py') passed via Cloud Run --args
    clean_argv = [
        arg for arg in sys.argv[1:]
        if not (arg.endswith(".py") or arg in ("player_sync", "sync_players"))
    ]
    args, unknown = parser.parse_known_args(clean_argv)

    try:
        run_player_sync(
            game_system=args.game_system,
            limit=args.limit,
            dry_run=args.dry_run,
            concurrency=args.concurrency,
            batch_commit_size=args.batch_commit
        )
    except Exception as e:
        logger.error(f"❌ Player Name Sync failed: {e}", exc_info=True)
        sys.exit(1)
