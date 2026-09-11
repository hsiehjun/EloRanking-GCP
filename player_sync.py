"""BCP Player Name Synchronization & Data Correction Service.

Discovers competitors with placeholder names ('Player 1', 'Player 2', 'Player')
and enriches them with real names from:
1. Local database tables (event_participants, other matches, raw_json)
2. Best Coast Pairings public API (/v1/users/{id} and /v1/players/{id})

Updates:
- players (full_name, first_name, last_name)
- player_ratings (player_name)
- matches (player1_name, player2_name)
- rating_history (opponent_name)
- event_participants (full_name, first_name, last_name)
- tracker_games (p1_name, p2_name)
And clears application caches so the live web UI reflects real names immediately.
"""

import os
import sys
import json
import time
import logging
import argparse
import urllib.request
import urllib.parse
import urllib.error
import concurrent.futures
from typing import Dict, List, Set, Optional, Tuple, Any

from config import DEFAULT_HEADERS, BCP_API_BASE
from database import get_db, PostgresDatabase

logger = logging.getLogger("elo.player_sync")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

PLACEHOLDER_NAMES = {
    "player", "player 1", "player 2", "player 3", "player 4", "player 5",
    "player 6", "player 7", "player 8", "player 9", "player 10",
    "bye", "unknown", "none", "null", "tbd", "unassigned", ""
}


def is_placeholder_name(name: Optional[str], player_id: Optional[str] = None) -> bool:
    """Checks if a name is a generic placeholder or equal to the player ID."""
    if not name:
        return True
    cleaned = str(name).strip().lower()
    if cleaned in PLACEHOLDER_NAMES:
        return True
    if cleaned.startswith("player ") or cleaned.startswith("player_"):
        return True
    if player_id and str(name).strip() == str(player_id).strip():
        return True
    return False


def clean_name(name: Optional[str]) -> str:
    """Cleans and normalizes whitespace in names."""
    if not name:
        return ""
    return " ".join(str(name).strip().split())


class PlayerNameSync:
    """Discovers and heals placeholder player names across all database tables."""

    def __init__(self, db: Optional[PostgresDatabase] = None, request_delay: float = 0.08):
        self.db = db if db is not None else get_db()
        self.request_delay = request_delay
        self.headers = DEFAULT_HEADERS.copy()

    def find_placeholder_player_ids(self, game_system: Optional[str] = None) -> List[str]:
        """Finds all player IDs where their name is currently a placeholder across database tables.
        
        Prioritizes:
        1. Ranked & active players on the leaderboard (matches_played DESC, current_elo DESC).
        2. Players in recent matches (match_date DESC).
        3. Other placeholder players in the specified game system.
        """
        target_sys = (game_system or "all").lower()
        seen: Set[str] = set()
        ordered_ids: List[str] = []

        def add_id(raw_id: Any):
            pid = str(raw_id or "").strip()
            if pid and pid.lower() not in PLACEHOLDER_NAMES and pid not in seen:
                seen.add(pid)
                ordered_ids.append(pid)

        with self.db.get_connection() as conn:
            with conn.cursor() as cur:
                # 1. Tier 1: Ranked & active players on the Leaderboard (Highest Priority)
                if target_sys in ("40k", "wh40k"):
                    cur.execute("""
                    SELECT player_id FROM player_ratings 
                    WHERE (player_name ILIKE %s OR player_name ILIKE 'player' OR player_name = player_id)
                      AND COALESCE(game_system, '40k') = '40k'
                    ORDER BY matches_played DESC, current_elo DESC;
                    """, ('Player %',))
                elif target_sys in ("aos", "warhammer_aos", "sigmar"):
                    cur.execute("""
                    SELECT player_id FROM player_ratings 
                    WHERE (player_name ILIKE %s OR player_name ILIKE 'player' OR player_name = player_id)
                      AND COALESCE(game_system, '40k') = 'aos'
                    ORDER BY matches_played DESC, current_elo DESC;
                    """, ('Player %',))
                else:
                    cur.execute("""
                    SELECT player_id FROM player_ratings 
                    WHERE player_name ILIKE %s OR player_name ILIKE 'player' OR player_name = player_id
                    ORDER BY matches_played DESC, current_elo DESC;
                    """, ('Player %',))
                for r in cur.fetchall():
                    add_id(r[0])

                # 2. Tier 2: Recent match participants
                sys_clause = ""
                if target_sys in ("40k", "wh40k"):
                    sys_clause = "AND COALESCE(game_system, '40k') = '40k'"
                elif target_sys in ("aos", "warhammer_aos", "sigmar"):
                    sys_clause = "AND COALESCE(game_system, '40k') = 'aos'"

                cur.execute(f"""
                SELECT player1_id FROM matches 
                WHERE (player1_name ILIKE %s OR player1_name ILIKE 'player') {sys_clause}
                ORDER BY match_date DESC NULLS LAST;
                """, ('Player %',))
                for r in cur.fetchall():
                    add_id(r[0])

                cur.execute(f"""
                SELECT player2_id FROM matches 
                WHERE (player2_name ILIKE %s OR player2_name ILIKE 'player') {sys_clause}
                ORDER BY match_date DESC NULLS LAST;
                """, ('Player %',))
                for r in cur.fetchall():
                    add_id(r[0])

                # 3. Tier 3: Players table scoped by game system
                if target_sys in ("40k", "wh40k"):
                    cur.execute("""
                    SELECT DISTINCT p.id FROM players p
                    JOIN player_ratings pr ON p.id = pr.player_id
                    WHERE (p.full_name ILIKE %s OR p.full_name ILIKE 'player' OR p.full_name IS NULL OR TRIM(p.full_name) = '')
                      AND COALESCE(pr.game_system, '40k') = '40k';
                    """, ('Player %',))
                elif target_sys in ("aos", "warhammer_aos", "sigmar"):
                    cur.execute("""
                    SELECT DISTINCT p.id FROM players p
                    JOIN player_ratings pr ON p.id = pr.player_id
                    WHERE (p.full_name ILIKE %s OR p.full_name ILIKE 'player' OR p.full_name IS NULL OR TRIM(p.full_name) = '')
                      AND COALESCE(pr.game_system, '40k') = 'aos';
                    """, ('Player %',))
                else:
                    cur.execute("""
                    SELECT DISTINCT id FROM players 
                    WHERE full_name ILIKE %s OR full_name ILIKE 'player' OR full_name IS NULL OR TRIM(full_name) = '';
                    """, ('Player %',))
                for r in cur.fetchall():
                    add_id(r[0])

        logger.info(f"🔍 Discovered {len(ordered_ids)} distinct competitor ID(s) with placeholder names (prioritized by leaderboard activity).")
        return ordered_ids

    def resolve_from_local_db(self, player_ids: Set[str]) -> Dict[str, Dict[str, str]]:
        """Scans local database tables to resolve real names without hitting external BCP APIs."""
        if not player_ids:
            return {}

        resolved: Dict[str, Dict[str, str]] = {}
        target_list = list(player_ids)
        chunk_size = 1000

        with self.db.get_connection() as conn:
            with conn.cursor() as cur:
                for i in range(0, len(target_list), chunk_size):
                    chunk = target_list[i : i + chunk_size]

                    # 1. Check players table
                    cur.execute("""
                    SELECT id, first_name, last_name, full_name
                    FROM players
                    WHERE id = ANY(%s)
                      AND full_name IS NOT NULL
                      AND NOT (full_name ILIKE %s OR full_name ILIKE 'player' OR full_name ILIKE 'BYE');
                    """, (chunk, 'Player %'))
                    for r in cur.fetchall():
                        pid = str(r[0]).strip()
                        fn, ln, full = r[1] or "", r[2] or "", clean_name(r[3])
                        if full and not is_placeholder_name(full, pid):
                            resolved[pid] = {
                                "full_name": full,
                                "first_name": clean_name(fn),
                                "last_name": clean_name(ln),
                                "source": "local_players"
                            }

                    # 2. Check event_participants table
                    cur.execute("""
                    SELECT DISTINCT ON (player_id) player_id, first_name, last_name, full_name
                    FROM event_participants
                    WHERE player_id = ANY(%s)
                      AND full_name IS NOT NULL
                      AND NOT (full_name ILIKE %s OR full_name ILIKE 'player' OR full_name ILIKE 'BYE')
                    ORDER BY player_id;
                    """, (chunk, 'Player %'))
                    for r in cur.fetchall():
                        pid = str(r[0]).strip()
                        if pid not in resolved:
                            fn, ln, full = r[1] or "", r[2] or "", clean_name(r[3])
                            if full and not is_placeholder_name(full, pid):
                                resolved[pid] = {
                                    "full_name": full,
                                    "first_name": clean_name(fn),
                                    "last_name": clean_name(ln),
                                    "source": "local_event_participants"
                                }

                    # 3. Check matches table for non-placeholder occurrences
                    cur.execute("""
                    SELECT DISTINCT ON (player1_id) player1_id, player1_name
                    FROM matches
                    WHERE player1_id = ANY(%s)
                      AND player1_name IS NOT NULL
                      AND NOT (player1_name ILIKE %s OR player1_name ILIKE 'player' OR player1_name ILIKE 'BYE')
                    ORDER BY player1_id, match_date DESC NULLS LAST;
                    """, (chunk, 'Player %'))
                    for r in cur.fetchall():
                        pid = str(r[0]).strip()
                        if pid not in resolved:
                            full = clean_name(r[1])
                            if full and not is_placeholder_name(full, pid):
                                resolved[pid] = {
                                    "full_name": full,
                                    "first_name": full.split()[0] if full else "",
                                    "last_name": full.split()[-1] if len(full.split()) > 1 else "",
                                    "source": "local_matches_p1"
                                }

                    cur.execute("""
                    SELECT DISTINCT ON (player2_id) player2_id, player2_name
                    FROM matches
                    WHERE player2_id = ANY(%s)
                      AND player2_name IS NOT NULL
                      AND NOT (player2_name ILIKE %s OR player2_name ILIKE 'player' OR player2_name ILIKE 'BYE')
                    ORDER BY player2_id, match_date DESC NULLS LAST;
                    """, (chunk, 'Player %'))
                    for r in cur.fetchall():
                        pid = str(r[0]).strip()
                        if pid not in resolved:
                            full = clean_name(r[1])
                            if full and not is_placeholder_name(full, pid):
                                resolved[pid] = {
                                    "full_name": full,
                                    "first_name": full.split()[0] if full else "",
                                    "last_name": full.split()[-1] if len(full.split()) > 1 else "",
                                    "source": "local_matches_p2"
                                }

        logger.info(f"⚡ Resolved {len(resolved)} / {len(player_ids)} names directly from local DB (0 network calls).")
        return resolved

    def fetch_bcp_player_name(self, player_id: str) -> Optional[Dict[str, str]]:
        """Queries BCP public API (/v1/users/{id} with fallback to /v1/players/{id}) to retrieve player identity."""
        if not player_id or is_placeholder_name(player_id):
            return None

        # Step A: Query /v1/users/{id}
        user_url = f"{BCP_API_BASE}/users/{urllib.parse.quote(player_id)}"
        req_user = urllib.request.Request(user_url, headers=self.headers)
        try:
            time.sleep(self.request_delay)
            with urllib.request.urlopen(req_user, timeout=8) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    if isinstance(data, dict):
                        first = clean_name(data.get("firstName"))
                        last = clean_name(data.get("lastName"))
                        full = f"{first} {last}".strip() or clean_name(data.get("name"))
                        if full and not is_placeholder_name(full, player_id):
                            return {
                                "full_name": full,
                                "first_name": first,
                                "last_name": last,
                                "source": "bcp_users_api"
                            }
        except urllib.error.HTTPError as e:
            if e.code not in (404, 400, 401, 409):
                logger.debug(f"HTTP {e.code} querying BCP /users/{player_id}: {e}")
        except Exception as e:
            logger.debug(f"Error querying BCP /users/{player_id}: {e}")

        # Step B: Fallback to /v1/players/{id}
        player_url = f"{BCP_API_BASE}/players/{urllib.parse.quote(player_id)}"
        req_player = urllib.request.Request(player_url, headers=self.headers)
        try:
            time.sleep(self.request_delay)
            with urllib.request.urlopen(req_player, timeout=8) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    if isinstance(data, dict):
                        u = data.get("user") or {}
                        first = clean_name(u.get("firstName") or data.get("firstName"))
                        last = clean_name(u.get("lastName") or data.get("lastName"))
                        full = f"{first} {last}".strip() or clean_name(data.get("name") or data.get("playerName"))
                        if full and not is_placeholder_name(full, player_id):
                            return {
                                "full_name": full,
                                "first_name": first,
                                "last_name": last,
                                "source": "bcp_players_api"
                            }
        except urllib.error.HTTPError as e:
            if e.code not in (404, 400, 401, 409):
                logger.debug(f"HTTP {e.code} querying BCP /players/{player_id}: {e}")
        except Exception as e:
            logger.debug(f"Error querying BCP /players/{player_id}: {e}")

        return None

    def apply_name_updates(self, resolved_names: Dict[str, Dict[str, str]]) -> Dict[str, int]:
        """Applies name corrections across all database tables in transactional batches."""
        if not resolved_names:
            return {"players": 0, "player_ratings": 0, "matches_p1": 0, "matches_p2": 0, "history": 0, "participants": 0}

        counts = {
            "players": 0,
            "player_ratings": 0,
            "matches_p1": 0,
            "matches_p2": 0,
            "history": 0,
            "participants": 0,
            "tracker_games": 0
        }

        with self.db.get_connection() as conn:
            with conn.cursor() as cur:
                for pid, info in resolved_names.items():
                    full = info["full_name"]
                    first = info.get("first_name") or (full.split()[0] if full else "")
                    last = info.get("last_name") or (full.split()[-1] if len(full.split()) > 1 else "")

                    # 1. Upsert / update players table
                    cur.execute("""
                    INSERT INTO players (id, first_name, last_name, full_name, updated_at)
                    VALUES (%s, %s, %s, %s, NOW())
                    ON CONFLICT (id) DO UPDATE SET
                        full_name = EXCLUDED.full_name,
                        first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), players.first_name),
                        last_name = COALESCE(NULLIF(EXCLUDED.last_name, ''), players.last_name),
                        updated_at = NOW();
                    """, (pid, first, last, full))
                    counts["players"] += cur.rowcount

                    # 2. Update player_ratings
                    cur.execute("""
                    UPDATE player_ratings
                    SET player_name = %s, updated_at = NOW()
                    WHERE player_id = %s
                      AND (player_name ILIKE %s OR player_name ILIKE 'player' OR player_name = player_id);
                    """, (full, pid, 'Player %'))
                    counts["player_ratings"] += cur.rowcount

                    # 3. Update matches table (both player1 and player2)
                    cur.execute("""
                    UPDATE matches
                    SET player1_name = %s
                    WHERE player1_id = %s
                      AND (player1_name ILIKE %s OR player1_name ILIKE 'player');
                    """, (full, pid, 'Player %'))
                    counts["matches_p1"] += cur.rowcount

                    cur.execute("""
                    UPDATE matches
                    SET player2_name = %s
                    WHERE player2_id = %s
                      AND (player2_name ILIKE %s OR player2_name ILIKE 'player');
                    """, (full, pid, 'Player %'))
                    counts["matches_p2"] += cur.rowcount

                    # 4. Update rating_history (opponent_name for historical match timeline)
                    cur.execute("""
                    UPDATE rating_history
                    SET opponent_name = %s
                    WHERE opponent_id = %s
                      AND (opponent_name ILIKE %s OR opponent_name ILIKE 'player');
                    """, (full, pid, 'Player %'))
                    counts["history"] += cur.rowcount

                    # 5. Update event_participants table
                    cur.execute("""
                    UPDATE event_participants
                    SET full_name = %s,
                        first_name = COALESCE(NULLIF(%s, ''), first_name),
                        last_name = COALESCE(NULLIF(%s, ''), last_name)
                    WHERE player_id = %s
                      AND (full_name ILIKE %s OR full_name ILIKE 'player' OR full_name IS NULL OR full_name = '');
                    """, (full, first, last, pid, 'Player %'))
                    counts["participants"] += cur.rowcount

                    # 6. Update tracker_games (optional)
                    cur.execute("""
                    UPDATE tracker_games
                    SET p1_name = %s
                    WHERE user_id_p1 = %s AND (p1_name ILIKE %s OR p1_name ILIKE 'player');
                    """, (full, pid, 'Player %'))
                    cur.execute("""
                    UPDATE tracker_games
                    SET p2_name = %s
                    WHERE user_id_p2 = %s AND (p2_name ILIKE %s OR p2_name ILIKE 'player');
                    """, (full, pid, 'Player %'))
                    counts["tracker_games"] += cur.rowcount

            conn.commit()

        # Invalidate in-memory and Redis caches
        try:
            PostgresDatabase.invalidate_all_caches()
            logger.info("🧹 Invalidated all application and leaderboard caches.")
        except Exception as e:
            logger.warning(f"Notice during cache invalidation: {e}")

        logger.info(
            f"✅ Database Update Complete: "
            f"players: {counts['players']}, "
            f"player_ratings: {counts['player_ratings']}, "
            f"matches (p1+p2): {counts['matches_p1'] + counts['matches_p2']}, "
            f"rating_history: {counts['history']}, "
            f"event_participants: {counts['participants']}."
        )
        return counts

    def sync_names(
        self,
        game_system: str = "all",
        max_bcp_calls: Optional[int] = None,
        dry_run: bool = False,
        concurrency: int = 8,
        batch_commit_size: int = 100
    ) -> Dict[str, Any]:
        """Runs the complete name correction workflow."""
        start_time = time.time()
        logger.info(
            f"🚀 Starting BCP Player Name Sync (game_system={game_system}, "
            f"dry_run={dry_run}, concurrency={concurrency}, limit={max_bcp_calls})..."
        )

        # 1. Find all target IDs with placeholder names (ordered by leaderboard priority)
        placeholder_ids = self.find_placeholder_player_ids(game_system=game_system)
        if not placeholder_ids:
            logger.info("✨ No placeholder players found! Database is already clean.")
            return {
                "status": "CLEAN",
                "placeholders_found": 0,
                "resolved_total": 0,
                "updated": {}
            }

        # 2. Local DB fast-resolution first
        resolved_names = self.resolve_from_local_db(set(placeholder_ids))
        local_resolved_count = len(resolved_names)
        
        updated_counts = {
            "players": 0,
            "player_ratings": 0,
            "matches_p1": 0,
            "matches_p2": 0,
            "history": 0,
            "participants": 0,
            "tracker_games": 0
        }
        if not dry_run and resolved_names:
            c = self.apply_name_updates(resolved_names)
            for k in updated_counts:
                updated_counts[k] += c.get(k, 0)
            logger.info(f"⚡ Applied {local_resolved_count} local DB resolutions directly to database.")

        remaining_ids = [pid for pid in placeholder_ids if pid not in resolved_names]
        if max_bcp_calls and max_bcp_calls > 0:
            remaining_ids = remaining_ids[:max_bcp_calls]
            logger.info(f"🌐 Limiting BCP API lookups to top {len(remaining_ids)} highest-priority player(s).")
        else:
            logger.info(f"🌐 Remaining IDs requiring BCP API lookup: {len(remaining_ids)}")

        # 3. Parallel Concurrent Query BCP API
        bcp_resolved_count = 0
        bcp_calls = 0
        uncommitted_batch: Dict[str, Dict[str, str]] = {}
        
        if remaining_ids:
            workers = max(1, min(16, concurrency))
            logger.info(f"⚡ Launching {workers} concurrent worker threads for BCP API lookups...")

            with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
                future_to_pid = {executor.submit(self.fetch_bcp_player_name, pid): pid for pid in remaining_ids}
                
                completed_count = 0
                for future in concurrent.futures.as_completed(future_to_pid):
                    pid = future_to_pid[future]
                    completed_count += 1
                    bcp_calls += 1
                    try:
                        bcp_info = future.result()
                        if bcp_info:
                            resolved_names[pid] = bcp_info
                            uncommitted_batch[pid] = bcp_info
                            bcp_resolved_count += 1
                            logger.info(f"   [{completed_count}/{len(remaining_ids)}] 🎯 {pid} -> '{bcp_info['full_name']}' (via {bcp_info['source']})")
                        else:
                            logger.debug(f"   [{completed_count}/{len(remaining_ids)}] ⚪ {pid} -> No BCP user/player found")
                    except Exception as exc:
                        logger.warning(f"Notice fetching {pid}: {exc}")

                    # Incremental periodic commit
                    if not dry_run and len(uncommitted_batch) >= batch_commit_size:
                        c = self.apply_name_updates(uncommitted_batch)
                        for k in updated_counts:
                            updated_counts[k] += c.get(k, 0)
                        logger.info(f"💾 [Incremental Commit] Saved batch of {len(uncommitted_batch)} resolved names to database.")
                        uncommitted_batch.clear()

            # Commit any remaining uncommitted names
            if not dry_run and uncommitted_batch:
                c = self.apply_name_updates(uncommitted_batch)
                for k in updated_counts:
                    updated_counts[k] += c.get(k, 0)
                logger.info(f"💾 [Final Commit] Saved final batch of {len(uncommitted_batch)} resolved names to database.")
                uncommitted_batch.clear()

        total_resolved = len(resolved_names)
        logger.info(
            f"📊 Resolution Summary: {total_resolved} / {len(placeholder_ids)} resolved "
            f"({local_resolved_count} local, {bcp_resolved_count} via BCP API, {len(placeholder_ids) - total_resolved} remaining/unknown)."
        )

        duration = time.time() - start_time
        logger.info(f"🎉 Player Name Sync finished in {duration:.2f}s!")

        return {
            "status": "SUCCESS",
            "placeholders_found": len(placeholder_ids),
            "resolved_total": total_resolved,
            "resolved_local": local_resolved_count,
            "resolved_bcp": bcp_resolved_count,
            "unresolved": len(placeholder_ids) - total_resolved,
            "updated_rows": updated_counts,
            "duration_sec": round(duration, 2),
            "dry_run": dry_run
        }


def sync_player_names_job(
    game_system: str = "all",
    max_bcp_calls: Optional[int] = None,
    dry_run: bool = False,
    concurrency: int = 8,
    batch_commit_size: int = 100
) -> Dict[str, Any]:
    """Top-level entrypoint for scripts, CLI, or Cloud Run Jobs."""
    syncer = PlayerNameSync()
    return syncer.sync_names(
        game_system=game_system,
        max_bcp_calls=max_bcp_calls,
        dry_run=dry_run,
        concurrency=concurrency,
        batch_commit_size=batch_commit_size
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BCP Player Name Sync & Data Correction Job")
    parser.add_argument("script_name", nargs="*", help="Optional script name passed by Cloud Run args (ignored)")
    parser.add_argument("--game-system", choices=["40k", "aos", "all"], default=os.getenv("GAME_SYSTEM", "all"), help="Game system to check (default: all)")
    parser.add_argument("--limit", "--max-calls", dest="limit", type=int, default=None, help="Maximum number of player lookups to perform in this run (e.g. 500, 1000)")
    parser.add_argument("--concurrency", "--workers", dest="concurrency", type=int, default=8, help="Number of concurrent worker threads (default: 8)")
    parser.add_argument("--batch-commit", type=int, default=100, help="Commit to database every N resolved names (default: 100)")
    parser.add_argument("--dry-run", action="store_true", help="Scan and resolve names without writing to database")

    # Filter out redundant script filenames (e.g. 'player_sync.py') passed via Cloud Run --args
    clean_argv = [
        arg for arg in sys.argv[1:]
        if not (arg.endswith(".py") or arg in ("player_sync", "sync_players"))
    ]
    args, unknown = parser.parse_known_args(clean_argv)

    try:
        res = sync_player_names_job(
            game_system=args.game_system,
            max_bcp_calls=args.limit,
            dry_run=args.dry_run,
            concurrency=args.concurrency,
            batch_commit_size=args.batch_commit
        )
        print("Player Name Sync Result:", json.dumps(res, indent=2))
    except Exception as exc:
        logger.error(f"❌ Player Name Sync failed: {exc}", exc_info=True)
        sys.exit(1)
