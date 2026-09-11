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

    def find_placeholder_player_ids(self, game_system: Optional[str] = None) -> Set[str]:
        """Finds all player IDs where their name is currently a placeholder across database tables."""
        target_sys = (game_system or "all").lower()
        placeholder_ids: Set[str] = set()

        with self.db.get_connection() as conn:
            with conn.cursor() as cur:
                # 1. From player_ratings
                if target_sys in ("40k", "wh40k"):
                    cur.execute("""
                    SELECT DISTINCT player_id FROM player_ratings 
                    WHERE (player_name ILIKE 'Player %' OR player_name ILIKE 'player' OR player_name = player_id)
                      AND COALESCE(game_system, '40k') = '40k';
                    """)
                elif target_sys in ("aos", "warhammer_aos", "sigmar"):
                    cur.execute("""
                    SELECT DISTINCT player_id FROM player_ratings 
                    WHERE (player_name ILIKE 'Player %' OR player_name ILIKE 'player' OR player_name = player_id)
                      AND COALESCE(game_system, '40k') = 'aos';
                    """)
                else:
                    cur.execute("""
                    SELECT DISTINCT player_id FROM player_ratings 
                    WHERE player_name ILIKE 'Player %' OR player_name ILIKE 'player' OR player_name = player_id;
                    """)
                for r in cur.fetchall():
                    pid = str(r[0] or "").strip()
                    if pid and pid.lower() not in PLACEHOLDER_NAMES:
                        placeholder_ids.add(pid)

                # 2. From players table
                cur.execute("""
                SELECT DISTINCT id FROM players 
                WHERE full_name ILIKE 'Player %' OR full_name ILIKE 'player' OR full_name IS NULL OR TRIM(full_name) = '';
                """)
                for r in cur.fetchall():
                    pid = str(r[0] or "").strip()
                    if pid and pid.lower() not in PLACEHOLDER_NAMES:
                        placeholder_ids.add(pid)

                # 3. From matches table (player1 and player2)
                sys_clause = ""
                params = ()
                if target_sys in ("40k", "wh40k"):
                    sys_clause = "AND COALESCE(game_system, '40k') = '40k'"
                elif target_sys in ("aos", "warhammer_aos", "sigmar"):
                    sys_clause = "AND COALESCE(game_system, '40k') = 'aos'"

                cur.execute(f"""
                SELECT DISTINCT player1_id FROM matches 
                WHERE (player1_name ILIKE 'Player %' OR player1_name ILIKE 'player') {sys_clause};
                """, params)
                for r in cur.fetchall():
                    pid = str(r[0] or "").strip()
                    if pid and pid.lower() not in PLACEHOLDER_NAMES:
                        placeholder_ids.add(pid)

                cur.execute(f"""
                SELECT DISTINCT player2_id FROM matches 
                WHERE (player2_name ILIKE 'Player %' OR player2_name ILIKE 'player') {sys_clause};
                """, params)
                for r in cur.fetchall():
                    pid = str(r[0] or "").strip()
                    if pid and pid.lower() not in PLACEHOLDER_NAMES:
                        placeholder_ids.add(pid)

        logger.info(f"🔍 Discovered {len(placeholder_ids)} distinct competitor ID(s) with placeholder names.")
        return placeholder_ids

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
                      AND NOT (full_name ILIKE 'Player %' OR full_name ILIKE 'player' OR full_name ILIKE 'BYE');
                    """, (chunk,))
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
                      AND NOT (full_name ILIKE 'Player %' OR full_name ILIKE 'player' OR full_name ILIKE 'BYE')
                    ORDER BY player_id;
                    """, (chunk,))
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
                      AND NOT (player1_name ILIKE 'Player %' OR player1_name ILIKE 'player' OR player1_name ILIKE 'BYE')
                    ORDER BY player1_id, match_date DESC NULLS LAST;
                    """, (chunk,))
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
                      AND NOT (player2_name ILIKE 'Player %' OR player2_name ILIKE 'player' OR player2_name ILIKE 'BYE')
                    ORDER BY player2_id, match_date DESC NULLS LAST;
                    """, (chunk,))
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
                      AND (player_name ILIKE 'Player %' OR player_name ILIKE 'player' OR player_name = player_id);
                    """, (full, pid))
                    counts["player_ratings"] += cur.rowcount

                    # 3. Update matches table (both player1 and player2)
                    cur.execute("""
                    UPDATE matches
                    SET player1_name = %s
                    WHERE player1_id = %s
                      AND (player1_name ILIKE 'Player %' OR player1_name ILIKE 'player');
                    """, (full, pid))
                    counts["matches_p1"] += cur.rowcount

                    cur.execute("""
                    UPDATE matches
                    SET player2_name = %s
                    WHERE player2_id = %s
                      AND (player2_name ILIKE 'Player %' OR player2_name ILIKE 'player');
                    """, (full, pid))
                    counts["matches_p2"] += cur.rowcount

                    # 4. Update rating_history (opponent_name for historical match timeline)
                    cur.execute("""
                    UPDATE rating_history
                    SET opponent_name = %s
                    WHERE opponent_id = %s
                      AND (opponent_name ILIKE 'Player %' OR opponent_name ILIKE 'player');
                    """, (full, pid))
                    counts["history"] += cur.rowcount

                    # 5. Update event_participants table
                    cur.execute("""
                    UPDATE event_participants
                    SET full_name = %s,
                        first_name = COALESCE(NULLIF(%s, ''), first_name),
                        last_name = COALESCE(NULLIF(%s, ''), last_name)
                    WHERE player_id = %s
                      AND (full_name ILIKE 'Player %' OR full_name ILIKE 'player' OR full_name IS NULL OR full_name = '');
                    """, (full, first, last, pid))
                    counts["participants"] += cur.rowcount

                    # 6. Update tracker_games (optional)
                    cur.execute("""
                    UPDATE tracker_games
                    SET p1_name = %s
                    WHERE user_id_p1 = %s AND (p1_name ILIKE 'Player %' OR p1_name ILIKE 'player');
                    """, (full, pid))
                    cur.execute("""
                    UPDATE tracker_games
                    SET p2_name = %s
                    WHERE user_id_p2 = %s AND (p2_name ILIKE 'Player %' OR p2_name ILIKE 'player');
                    """, (full, pid))
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
        dry_run: bool = False
    ) -> Dict[str, Any]:
        """Runs the complete name correction workflow."""
        start_time = time.time()
        logger.info(f"🚀 Starting BCP Player Name Sync (game_system={game_system}, dry_run={dry_run})...")

        # 1. Find all target IDs with placeholder names
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
        resolved_names = self.resolve_from_local_db(placeholder_ids)
        remaining_ids = [pid for pid in placeholder_ids if pid not in resolved_names]
        logger.info(f"🌐 Remaining IDs requiring BCP API lookup: {len(remaining_ids)}")

        # 3. Query BCP API for the remainder
        bcp_resolved_count = 0
        bcp_calls = 0
        for i, pid in enumerate(remaining_ids, 1):
            if max_bcp_calls and bcp_calls >= max_bcp_calls:
                logger.info(f"Reached max BCP API calls limit ({max_bcp_calls}). Stopping API lookups.")
                break

            bcp_info = self.fetch_bcp_player_name(pid)
            bcp_calls += 1
            if bcp_info:
                resolved_names[pid] = bcp_info
                bcp_resolved_count += 1
                logger.info(f"   [{i}/{len(remaining_ids)}] 🎯 {pid} -> '{bcp_info['full_name']}' (via {bcp_info['source']})")
            else:
                logger.debug(f"   [{i}/{len(remaining_ids)}] ⚪ {pid} -> No BCP user/player found")

        total_resolved = len(resolved_names)
        logger.info(
            f"📊 Resolution Summary: {total_resolved} / {len(placeholder_ids)} resolved "
            f"({len(resolved_names) - bcp_resolved_count} local, {bcp_resolved_count} via BCP API, {len(placeholder_ids) - total_resolved} unknown/guest)."
        )

        # 4. Apply database updates
        counts = {}
        if not dry_run and resolved_names:
            counts = self.apply_name_updates(resolved_names)
        elif dry_run:
            logger.info("⚠️ DRY-RUN active: database updates were skipped.")

        duration = time.time() - start_time
        logger.info(f"🎉 Player Name Sync finished in {duration:.2f}s!")

        return {
            "status": "SUCCESS",
            "placeholders_found": len(placeholder_ids),
            "resolved_total": total_resolved,
            "resolved_local": total_resolved - bcp_resolved_count,
            "resolved_bcp": bcp_resolved_count,
            "unresolved": len(placeholder_ids) - total_resolved,
            "updated_rows": counts,
            "duration_sec": round(duration, 2),
            "dry_run": dry_run
        }


def sync_player_names_job(
    game_system: str = "all",
    max_bcp_calls: Optional[int] = None,
    dry_run: bool = False
) -> Dict[str, Any]:
    """Top-level entrypoint for scripts, CLI, or Cloud Run Jobs."""
    syncer = PlayerNameSync()
    return syncer.sync_names(game_system=game_system, max_bcp_calls=max_bcp_calls, dry_run=dry_run)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BCP Player Name Sync & Data Correction Job")
    parser.add_argument("--game-system", choices=["40k", "aos", "all"], default=os.getenv("GAME_SYSTEM", "all"), help="Game system to check (default: all)")
    parser.add_argument("--max-calls", type=int, default=None, help="Maximum BCP API calls to perform")
    parser.add_argument("--dry-run", action="store_true", help="Scan and resolve names without writing to database")
    args = parser.parse_args()

    try:
        res = sync_player_names_job(
            game_system=args.game_system,
            max_bcp_calls=args.max_calls,
            dry_run=args.dry_run
        )
        print("Player Name Sync Result:", json.dumps(res, indent=2))
    except Exception as exc:
        logger.error(f"❌ Player Name Sync failed: {exc}", exc_info=True)
        sys.exit(1)
