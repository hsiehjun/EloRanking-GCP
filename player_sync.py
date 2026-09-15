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

import re

PLACEHOLDER_NAMES = {
    "player", "player 1", "player 2", "player 3", "player 4", "player 5",
    "player 6", "player 7", "player 8", "player 9", "player 10",
    "bye", "unknown", "none", "null", "tbd", "unassigned", ""
}

PLACEHOLDER_REGEX_STR = r'^(player($|[^a-zA-Z])|fake\s*player|unknown(\s*player)?|bye|none|null|tbd|unassigned)'
_PLACEHOLDER_RE = re.compile(PLACEHOLDER_REGEX_STR, re.IGNORECASE)


def is_placeholder_name(name: Optional[str], player_id: Optional[str] = None) -> bool:
    """Checks if a name is a generic placeholder (e.g. 'Player 1', 'Player114', 'Unknown Player'), equal to player ID, or an oversized/corrupted payload."""
    if not name:
        return True
    cleaned = str(name).strip()
    if not cleaned or len(cleaned) > 100 or cleaned.startswith("{") or cleaned.startswith("["):
        return True
    if cleaned.lower() in PLACEHOLDER_NAMES:
        return True
    if _PLACEHOLDER_RE.match(cleaned):
        return True
    if player_id and cleaned == str(player_id).strip():
        return True
    return False


def is_bcp_placeholder_name(name: Optional[str], player_id: Optional[str] = None) -> bool:
    """Checks if a name returned by BCP API is an unlinked placeholder (e.g. 'Player114', 'Player 1'), while preserving real surnames like 'Andy Player'."""
    return is_placeholder_name(name, player_id)


def clean_name(name: Optional[str], max_length: int = 100) -> str:
    """Cleans and normalizes whitespace in names, parses JSON blobs, and enforces max length to prevent DB index page overflow."""
    if not name:
        return ""
    s = str(name).strip()
    if not s:
        return ""
    if s.startswith("{") and s.endswith("}"):
        try:
            parsed = json.loads(s)
            if isinstance(parsed, dict):
                s = str(parsed.get("name") or parsed.get("fullName") or parsed.get("full_name") or parsed.get("playerName") or "").strip()
        except Exception:
            s = ""
    elif s.startswith("{") or s.startswith("["):
        return ""
    if "\n" in s or "\r" in s:
        lines = [line.strip() for line in s.replace("\r", "\n").split("\n") if line.strip()]
        s = lines[0] if lines else ""
    cleaned = " ".join(s.split())
    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length].strip()
    return cleaned


class PlayerNameSync:
    """Discovers and heals placeholder player names across all database tables."""

    def __init__(self, db: Optional[PostgresDatabase] = None, request_delay: float = 0.08):
        self.db = db if db is not None else get_db()
        self.request_delay = request_delay
        self.headers = DEFAULT_HEADERS.copy()
        self._bcp_cache: Dict[str, Optional[Dict[str, str]]] = {}

    def find_placeholder_player_ids(self, game_system: Optional[str] = None) -> List[str]:
        """Finds all player IDs where their name contains 'player' (or is empty/placeholder).
        
        Prioritizes:
        1. Ranked & active players on the leaderboard with 'player' in name (matches_played DESC, current_elo DESC).
        2. Players in recent matches with 'player' in name (match_date DESC).
        3. Other players with 'player' in name in the specified game system.
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
                placeholder_regex = PLACEHOLDER_REGEX_STR
                # 1. Tier 1: Ranked & active players on the Leaderboard with placeholder name (Highest Priority)
                if target_sys in ("40k", "wh40k"):
                    cur.execute("""
                    SELECT player_id FROM player_ratings 
                    WHERE (player_name ~* %s OR player_name IS NULL OR TRIM(player_name) = '' OR player_name = player_id
                           OR LENGTH(player_name) > 100 OR player_name LIKE '{%%' OR player_name LIKE '[%%')
                      AND COALESCE(game_system, '40k') = '40k'
                    ORDER BY matches_played DESC, current_elo DESC;
                    """, (placeholder_regex,))
                elif target_sys in ("aos", "warhammer_aos", "sigmar"):
                    cur.execute("""
                    SELECT player_id FROM player_ratings 
                    WHERE (player_name ~* %s OR player_name IS NULL OR TRIM(player_name) = '' OR player_name = player_id
                           OR LENGTH(player_name) > 100 OR player_name LIKE '{%%' OR player_name LIKE '[%%')
                      AND COALESCE(game_system, '40k') = 'aos'
                    ORDER BY matches_played DESC, current_elo DESC;
                    """, (placeholder_regex,))
                else:
                    cur.execute("""
                    SELECT player_id FROM player_ratings 
                    WHERE (player_name ~* %s OR player_name IS NULL OR TRIM(player_name) = '' OR player_name = player_id
                           OR LENGTH(player_name) > 100 OR player_name LIKE '{%%' OR player_name LIKE '[%%')
                    ORDER BY matches_played DESC, current_elo DESC;
                    """, (placeholder_regex,))
                for r in cur.fetchall():
                    add_id(r[0])

                # 2. Tier 2: Recent match participants with placeholder name
                sys_clause = ""
                if target_sys in ("40k", "wh40k"):
                    sys_clause = "AND COALESCE(game_system, '40k') = '40k'"
                elif target_sys in ("aos", "warhammer_aos", "sigmar"):
                    sys_clause = "AND COALESCE(game_system, '40k') = 'aos'"

                cur.execute(f"""
                SELECT player1_id FROM matches 
                WHERE (player1_name ~* %s OR player1_name IS NULL OR TRIM(player1_name) = '' OR player1_name = player1_id
                       OR LENGTH(player1_name) > 100 OR player1_name LIKE '{{%%' OR player1_name LIKE '[%%')
                  AND NOT (player1_id ILIKE 'BYE')
                  {sys_clause}
                ORDER BY match_date DESC NULLS LAST;
                """, (placeholder_regex,))
                for r in cur.fetchall():
                    add_id(r[0])

                cur.execute(f"""
                SELECT player2_id FROM matches 
                WHERE (player2_name ~* %s OR player2_name IS NULL OR TRIM(player2_name) = '' OR player2_name = player2_id
                       OR LENGTH(player2_name) > 100 OR player2_name LIKE '{{%%' OR player2_name LIKE '[%%')
                  AND NOT (player2_id ILIKE 'BYE')
                  {sys_clause}
                ORDER BY match_date DESC NULLS LAST;
                """, (placeholder_regex,))
                for r in cur.fetchall():
                    add_id(r[0])

                # 3. Tier 3: Players table scoped by game system (join player_ratings so orphan unranked IDs are not queued)
                if target_sys in ("40k", "wh40k"):
                    cur.execute("""
                    SELECT DISTINCT p.id FROM players p
                    JOIN player_ratings pr ON p.id = pr.player_id
                    WHERE (p.full_name ~* %s OR p.full_name IS NULL OR TRIM(p.full_name) = '' OR p.full_name = p.id
                           OR LENGTH(p.full_name) > 100 OR p.full_name LIKE '{%%' OR p.full_name LIKE '[%%')
                      AND COALESCE(pr.game_system, '40k') = '40k';
                    """, (placeholder_regex,))
                elif target_sys in ("aos", "warhammer_aos", "sigmar"):
                    cur.execute("""
                    SELECT DISTINCT p.id FROM players p
                    JOIN player_ratings pr ON p.id = pr.player_id
                    WHERE (p.full_name ~* %s OR p.full_name IS NULL OR TRIM(p.full_name) = '' OR p.full_name = p.id
                           OR LENGTH(p.full_name) > 100 OR p.full_name LIKE '{%%' OR p.full_name LIKE '[%%')
                      AND COALESCE(pr.game_system, '40k') = 'aos';
                    """, (placeholder_regex,))
                else:
                    cur.execute("""
                    SELECT DISTINCT p.id FROM players p
                    JOIN player_ratings pr ON p.id = pr.player_id
                    WHERE (p.full_name ~* %s OR p.full_name IS NULL OR TRIM(p.full_name) = '' OR p.full_name = p.id
                           OR LENGTH(p.full_name) > 100 OR p.full_name LIKE '{%%' OR p.full_name LIKE '[%%');
                    """, (placeholder_regex,))
                for r in cur.fetchall():
                    add_id(r[0])

        logger.info(f"🔍 Discovered {len(ordered_ids)} distinct competitor ID(s) needing name or canonical user ID sync.")
        return ordered_ids

    def resolve_from_local_db(self, player_ids: Set[str]) -> Dict[str, Dict[str, str]]:
        """Scans local database tables to resolve real names without hitting external BCP APIs."""
        if not player_ids:
            return {}

        resolved: Dict[str, Dict[str, str]] = {}
        target_list = list(player_ids)
        chunk_size = 1000
        placeholder_regex = PLACEHOLDER_REGEX_STR

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
                      AND LENGTH(full_name) <= 100
                      AND full_name NOT LIKE '{%%' AND full_name NOT LIKE '[%%'
                      AND NOT (full_name ~* %s OR full_name ILIKE 'BYE');
                    """, (chunk, placeholder_regex))
                    for r in cur.fetchall():
                        pid = str(r[0]).strip()
                        fn, ln, full = r[1] or "", r[2] or "", clean_name(r[3], max_length=100)
                        if full and not is_placeholder_name(full, pid):
                            resolved[pid] = {
                                "full_name": full,
                                "first_name": clean_name(fn, max_length=50),
                                "last_name": clean_name(ln, max_length=50),
                                "source": "local_players"
                            }

                    # 1b. Check player_ratings table
                    cur.execute("""
                    SELECT DISTINCT ON (player_id) player_id, player_name
                    FROM player_ratings
                    WHERE player_id = ANY(%s)
                      AND player_name IS NOT NULL
                      AND LENGTH(player_name) <= 100
                      AND player_name NOT LIKE '{%%' AND player_name NOT LIKE '[%%'
                      AND NOT (player_name ~* %s OR player_name ILIKE 'BYE')
                    ORDER BY player_id, matches_played DESC NULLS LAST;
                    """, (chunk, placeholder_regex))
                    for r in cur.fetchall():
                        pid = str(r[0]).strip()
                        if pid not in resolved:
                            full = clean_name(r[1], max_length=100)
                            if full and not is_placeholder_name(full, pid):
                                resolved[pid] = {
                                    "full_name": full,
                                    "first_name": clean_name(full.split()[0] if full else "", max_length=50),
                                    "last_name": clean_name(full.split()[-1] if len(full.split()) > 1 else "", max_length=50),
                                    "source": "local_player_ratings"
                                }

                    # 2. Check event_participants table
                    cur.execute("""
                    SELECT DISTINCT ON (player_id) player_id, first_name, last_name, full_name
                    FROM event_participants
                    WHERE player_id = ANY(%s)
                      AND full_name IS NOT NULL
                      AND LENGTH(full_name) <= 100
                      AND full_name NOT LIKE '{%%' AND full_name NOT LIKE '[%%'
                      AND NOT (full_name ~* %s OR full_name ILIKE 'BYE')
                    ORDER BY player_id;
                    """, (chunk, placeholder_regex))
                    for r in cur.fetchall():
                        pid = str(r[0]).strip()
                        if pid not in resolved:
                            fn, ln, full = r[1] or "", r[2] or "", clean_name(r[3], max_length=100)
                            if full and not is_placeholder_name(full, pid):
                                resolved[pid] = {
                                    "full_name": full,
                                    "first_name": clean_name(fn, max_length=50),
                                    "last_name": clean_name(ln, max_length=50),
                                    "source": "local_event_participants"
                                }

                    # 3. Check matches table for non-placeholder occurrences
                    cur.execute("""
                    SELECT DISTINCT ON (player1_id) player1_id, player1_name
                    FROM matches
                    WHERE player1_id = ANY(%s)
                      AND player1_name IS NOT NULL
                      AND LENGTH(player1_name) <= 100
                      AND player1_name NOT LIKE '{%%' AND player1_name NOT LIKE '[%%'
                      AND NOT (player1_name ~* %s OR player1_name ILIKE 'BYE')
                    ORDER BY player1_id, match_date DESC NULLS LAST;
                    """, (chunk, placeholder_regex))
                    for r in cur.fetchall():
                        pid = str(r[0]).strip()
                        if pid not in resolved:
                            full = clean_name(r[1], max_length=100)
                            if full and not is_placeholder_name(full, pid):
                                resolved[pid] = {
                                    "full_name": full,
                                    "first_name": clean_name(full.split()[0] if full else "", max_length=50),
                                    "last_name": clean_name(full.split()[-1] if len(full.split()) > 1 else "", max_length=50),
                                    "source": "local_matches_p1"
                                }

                    cur.execute("""
                    SELECT DISTINCT ON (player2_id) player2_id, player2_name
                    FROM matches
                    WHERE player2_id = ANY(%s)
                      AND player2_name IS NOT NULL
                      AND LENGTH(player2_name) <= 100
                      AND player2_name NOT LIKE '{%%' AND player2_name NOT LIKE '[%%'
                      AND NOT (player2_name ~* %s OR player2_name ILIKE 'BYE')
                    ORDER BY player2_id, match_date DESC NULLS LAST;
                    """, (chunk, placeholder_regex))
                    for r in cur.fetchall():
                        pid = str(r[0]).strip()
                        if pid not in resolved:
                            full = clean_name(r[1], max_length=100)
                            if full and not is_placeholder_name(full, pid):
                                resolved[pid] = {
                                    "full_name": full,
                                    "first_name": clean_name(full.split()[0] if full else "", max_length=50),
                                    "last_name": clean_name(full.split()[-1] if len(full.split()) > 1 else "", max_length=50),
                                    "source": "local_matches_p2"
                                }

                # 4. Leave unresolved locally if the player's name is shared by multiple distinct IDs (COUNT(DISTINCT player_id) > 1)
                # so sync_names() queries BCP /v1/players/{id} to remap tournament-specific player IDs to global userIds.
                if resolved:
                    cur.execute("""
                    SELECT player_id, LOWER(TRIM(player_name))
                    FROM player_ratings
                    WHERE player_id = ANY(%s);
                    """, (list(resolved.keys()),))
                    pr_names = {str(r[0]).strip(): str(r[1] or "").strip() for r in cur.fetchall()}

                    cur.execute("""
                    SELECT LOWER(TRIM(player_name))
                    FROM player_ratings
                    WHERE player_name IS NOT NULL AND TRIM(player_name) != ''
                    GROUP BY LOWER(TRIM(player_name))
                    HAVING COUNT(DISTINCT player_id) > 1;
                    """)
                    dup_names = {str(r[0]).strip() for r in cur.fetchall() if r and r[0]}

                    for pid in list(resolved.keys()):
                        res_norm = resolved[pid]["full_name"].strip().lower()
                        if res_norm in dup_names:
                            resolved.pop(pid, None)

        logger.info(f"⚡ Resolved {len(resolved)} / {len(player_ids)} player identities directly from local DB (0 network calls).")
        return resolved

    def _query_bcp_users_endpoint(self, player_id: str) -> Optional[Dict[str, str]]:
        user_url = f"{BCP_API_BASE}/users/{urllib.parse.quote(player_id)}"
        req_user = urllib.request.Request(user_url, headers=self.headers)
        try:
            time.sleep(self.request_delay)
            with urllib.request.urlopen(req_user, timeout=8) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    if isinstance(data, dict):
                        first = clean_name(data.get("firstName"), max_length=50)
                        last = clean_name(data.get("lastName"), max_length=50)
                        full = clean_name(f"{first} {last}".strip() or data.get("name"), max_length=100)
                        if full and not is_bcp_placeholder_name(full, player_id):
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
        return None

    def _query_bcp_players_endpoint(self, player_id: str) -> Optional[Dict[str, str]]:
        player_url = f"{BCP_API_BASE}/players/{urllib.parse.quote(player_id)}"
        req_player = urllib.request.Request(player_url, headers=self.headers)
        try:
            time.sleep(self.request_delay)
            with urllib.request.urlopen(req_player, timeout=8) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    if isinstance(data, dict):
                        u = data.get("user") or {}
                        first = clean_name(u.get("firstName") or data.get("firstName"), max_length=50)
                        last = clean_name(u.get("lastName") or data.get("lastName"), max_length=50)
                        full = clean_name(f"{first} {last}".strip() or data.get("name") or data.get("playerName"), max_length=100)
                        canonical_uid = clean_name(u.get("id") or data.get("userId") or data.get("user_id"), max_length=64)
                        if canonical_uid and (not full or is_bcp_placeholder_name(full, player_id)):
                            usr_res = self._query_bcp_users_endpoint(canonical_uid)
                            if usr_res and usr_res.get("full_name"):
                                full = usr_res["full_name"]
                                first = usr_res.get("first_name") or first
                                last = usr_res.get("last_name") or last
                        if full and not is_bcp_placeholder_name(full, player_id):
                            res_info = {
                                "full_name": full,
                                "first_name": first,
                                "last_name": last,
                                "source": "bcp_players_api"
                            }
                            if canonical_uid and canonical_uid != player_id:
                                res_info["canonical_user_id"] = canonical_uid
                            return res_info
                        elif canonical_uid and canonical_uid != player_id:
                            return {
                                "full_name": "",
                                "first_name": "",
                                "last_name": "",
                                "canonical_user_id": canonical_uid,
                                "source": "bcp_players_api"
                            }
        except urllib.error.HTTPError as e:
            if e.code not in (404, 400, 401, 409):
                logger.debug(f"HTTP {e.code} querying BCP /players/{player_id}: {e}")
        except Exception as e:
            logger.debug(f"Error querying BCP /players/{player_id}: {e}")
        return None

    def fetch_bcp_player_name(self, player_id: str) -> Optional[Dict[str, str]]:
        """Queries BCP public API (/v1/players/{id} first to check for registration ID -> userId mapping, then /v1/users/{id})."""
        if not player_id or player_id.lower() in PLACEHOLDER_NAMES:
            return None

        if hasattr(self, "_bcp_cache") and player_id in self._bcp_cache:
            return self._bcp_cache[player_id]

        # Always check /v1/players/{id} first to see if this ID is a tournament registration ID with a canonical userId
        res = self._query_bcp_players_endpoint(player_id)
        if not res:
            res = self._query_bcp_users_endpoint(player_id)
        if hasattr(self, "_bcp_cache"):
            self._bcp_cache[player_id] = res
        return res

    def apply_name_updates(self, resolved_names: Dict[str, Dict[str, str]]) -> Dict[str, int]:
        """Applies name and canonical userId corrections across all database tables in transactional batches."""
        if not resolved_names:
            return {"players": 0, "player_ratings": 0, "matches_p1": 0, "matches_p2": 0, "history": 0, "participants": 0, "remapped_ids": 0}

        counts = {
            "players": 0,
            "player_ratings": 0,
            "matches_p1": 0,
            "matches_p2": 0,
            "history": 0,
            "participants": 0,
            "tracker_games": 0,
            "remapped_ids": 0
        }

        with self.db.get_connection() as conn:
            with conn.cursor() as cur:
                for pid, info in resolved_names.items():
                    pid = str(pid)[:64]
                    full = clean_name(info.get("full_name") or "", max_length=100)
                    first = clean_name(info.get("first_name") or (full.split()[0] if full else ""), max_length=50)
                    last = clean_name(info.get("last_name") or (full.split()[-1] if len(full.split()) > 1 else ""), max_length=50)
                    canonical_uid = str(info.get("canonical_user_id") or "").strip()[:64] or None
                    target_id = canonical_uid if (canonical_uid and canonical_uid != pid) else pid
                    target_id = str(target_id)[:64]
                    has_valid_name = bool(full and not is_bcp_placeholder_name(full, target_id))

                    if not has_valid_name and target_id == pid:
                        continue

                    # 1. Upsert / update target player row without clobbering existing real names
                    if has_valid_name:
                        cur.execute("""
                        INSERT INTO players (id, first_name, last_name, full_name, updated_at)
                        VALUES (%s, %s, %s, %s, NOW())
                        ON CONFLICT (id) DO UPDATE SET
                            full_name = CASE
                                WHEN EXCLUDED.full_name !~* %s
                                THEN EXCLUDED.full_name
                                ELSE COALESCE(NULLIF(players.full_name, ''), EXCLUDED.full_name)
                            END,
                            first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), players.first_name),
                            last_name = COALESCE(NULLIF(EXCLUDED.last_name, ''), players.last_name),
                            updated_at = NOW();
                        """, (target_id, first, last, full, PLACEHOLDER_REGEX_STR))
                        counts["players"] += cur.rowcount
                    else:
                        cur.execute("""
                        INSERT INTO players (id, first_name, last_name, full_name, updated_at)
                        SELECT %s, first_name, last_name, full_name, NOW() FROM players WHERE id = %s
                        ON CONFLICT (id) DO NOTHING;
                        """, (target_id, pid))

                    if target_id != pid:
                        # Remap registration ID pid -> canonical user ID target_id using indexed player1_id/player2_id lookups
                        cur.execute("""
                        UPDATE matches
                        SET player1_id = %s,
                            player1_name = CASE WHEN %s THEN %s ELSE player1_name END,
                            winner_id = CASE WHEN winner_id = %s THEN %s ELSE winner_id END,
                            loser_id  = CASE WHEN loser_id  = %s THEN %s ELSE loser_id  END
                        WHERE player1_id = %s
                          AND COALESCE(player2_id, '') != %s;
                        """, (target_id, has_valid_name, full, pid, target_id, pid, target_id, pid, target_id))
                        counts["matches_p1"] += cur.rowcount

                        cur.execute("""
                        UPDATE matches
                        SET player2_id = %s,
                            player2_name = CASE WHEN %s THEN %s ELSE player2_name END,
                            winner_id = CASE WHEN winner_id = %s THEN %s ELSE winner_id END,
                            loser_id  = CASE WHEN loser_id  = %s THEN %s ELSE loser_id  END
                        WHERE player2_id = %s
                          AND COALESCE(player1_id, '') != %s;
                        """, (target_id, has_valid_name, full, pid, target_id, pid, target_id, pid, target_id))
                        counts["matches_p2"] += cur.rowcount

                        cur.execute("""
                        DELETE FROM event_participants ep1
                        WHERE ep1.player_id = %s
                          AND EXISTS (
                              SELECT 1 FROM event_participants ep2
                              WHERE ep2.event_id = ep1.event_id AND ep2.player_id = %s
                          );
                        """, (pid, target_id))
                        cur.execute("""
                        UPDATE event_participants
                        SET player_id = %s,
                            full_name = CASE WHEN %s THEN %s ELSE full_name END
                        WHERE player_id = %s;
                        """, (target_id, has_valid_name, full, pid))
                        counts["participants"] += cur.rowcount

                        cur.execute("UPDATE tracker_games SET user_id_p1 = %s, p1_name = CASE WHEN %s THEN %s ELSE p1_name END WHERE user_id_p1 = %s;", (target_id, has_valid_name, full, pid))
                        counts["tracker_games"] += cur.rowcount
                        cur.execute("UPDATE tracker_games SET user_id_p2 = %s, p2_name = CASE WHEN %s THEN %s ELSE p2_name END WHERE user_id_p2 = %s;", (target_id, has_valid_name, full, pid))
                        counts["tracker_games"] += cur.rowcount

                        try:
                            cur.execute("UPDATE user_army_lists SET user_id = %s WHERE user_id = %s;", (target_id, pid))
                            cur.execute("UPDATE player_lfg_profiles SET player_id = %s WHERE player_id = %s;", (target_id, pid))
                        except Exception:
                            pass

                        cur.execute("DELETE FROM rating_history WHERE player_id = %s;", (pid,))
                        counts["history"] += cur.rowcount
                        cur.execute("DELETE FROM player_ratings WHERE player_id = %s;", (pid,))
                        cur.execute("DELETE FROM players WHERE id = %s;", (pid,))
                        counts["remapped_ids"] += 1
                        continue

                    # 2. Update player_ratings
                    cur.execute("""
                    UPDATE player_ratings
                    SET player_name = %s, updated_at = NOW()
                    WHERE player_id = %s
                      AND (player_name ~* %s OR player_name IS NULL OR TRIM(player_name) = '' OR player_name = player_id);
                    """, (full, pid, PLACEHOLDER_REGEX_STR))
                    counts["player_ratings"] += cur.rowcount

                    # 3. Update matches table (both player1 and player2)
                    cur.execute("""
                    UPDATE matches
                    SET player1_name = %s
                    WHERE player1_id = %s
                      AND (player1_name ~* %s OR player1_name IS NULL OR TRIM(player1_name) = '');
                    """, (full, pid, PLACEHOLDER_REGEX_STR))
                    counts["matches_p1"] += cur.rowcount

                    cur.execute("""
                    UPDATE matches
                    SET player2_name = %s
                    WHERE player2_id = %s
                      AND (player2_name ~* %s OR player2_name IS NULL OR TRIM(player2_name) = '');
                    """, (full, pid, PLACEHOLDER_REGEX_STR))
                    counts["matches_p2"] += cur.rowcount

                    # 4. Update rating_history (skip unindexed opponent_id scan; reconstruct_all_rankings maintains rating_history)
                    cur.execute("""
                    UPDATE rating_history
                    SET opponent_name = opponent_name
                    WHERE player_id = %s AND FALSE;
                    """, (pid,))
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
            f"remapped_ids: {counts['remapped_ids']}, "
            f"player_ratings: {counts['player_ratings']}, "
            f"matches (p1+p2): {counts['matches_p1'] + counts['matches_p2']}, "
            f"rating_history: {counts['history']}, "
            f"event_participants: {counts['participants']}."
        )
        return counts

    def _fetch_bcp_event_roster_and_pairings(self, event_id: str) -> Tuple[Dict[str, List[str]], Dict[str, str], Dict[str, Dict[str, str]]]:
        """Fetches BCP event roster and pairings for an event_id to verify true player userIds."""
        name_to_uids: Dict[str, List[str]] = {}
        reg_to_uid: Dict[str, str] = {}
        pairing_map: Dict[str, Dict[str, str]] = {}

        # 1. Fetch event players roster
        roster_url = f"{BCP_API_BASE}/events/{urllib.parse.quote(event_id)}/players?limit=2500"
        req = urllib.request.Request(roster_url, headers=self.headers)
        players_list = []
        try:
            time.sleep(self.request_delay)
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    if isinstance(data, dict):
                        players_list = data.get("active") or data.get("data") or data.get("players") or []
                    elif isinstance(data, list):
                        players_list = data
        except Exception as e:
            logger.debug(f"Notice fetching BCP event roster for {event_id}: {e}")

        for p in players_list:
            if not isinstance(p, dict):
                continue
            reg_id = str(p.get("id") or "").strip()
            user = p.get("user") or {}
            uid = str(user.get("id") or p.get("userId") or p.get("user_id") or "").strip()
            if not uid and reg_id:
                bcp_info = self.fetch_bcp_player_name(reg_id)
                if bcp_info and bcp_info.get("canonical_user_id"):
                    uid = bcp_info["canonical_user_id"]
            first = clean_name(user.get("firstName") or p.get("firstName"), max_length=50)
            last = clean_name(user.get("lastName") or p.get("lastName"), max_length=50)
            full = clean_name(f"{first} {last}".strip() or p.get("name"), max_length=100)
            if uid:
                if reg_id:
                    reg_to_uid[reg_id] = uid
                if full and not is_placeholder_name(full):
                    norm_n = full.lower()
                    if norm_n not in name_to_uids:
                        name_to_uids[norm_n] = []
                    if uid not in name_to_uids[norm_n]:
                        name_to_uids[norm_n].append(uid)

        # 2. Fetch event pairings
        pairings_url = f"{BCP_API_BASE}/pairings?eventId={urllib.parse.quote(event_id)}&limit=1000"
        req_pair = urllib.request.Request(pairings_url, headers=self.headers)
        pairings_list = []
        try:
            time.sleep(self.request_delay)
            with urllib.request.urlopen(req_pair, timeout=10) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    if isinstance(data, dict):
                        pairings_list = data.get("data") or data.get("active") or []
                    elif isinstance(data, list):
                        pairings_list = data
        except Exception as e:
            logger.debug(f"Notice fetching BCP pairings for {event_id}: {e}")

        for pr in pairings_list:
            if not isinstance(pr, dict):
                continue
            mid = str(pr.get("id") or "").strip()
            if not mid:
                continue
            p1_obj = pr.get("player1") or {}
            p2_obj = pr.get("player2") or {}
            p1_u = p1_obj.get("user") or {}
            p2_u = p2_obj.get("user") or {}
            p1_uid = str(p1_u.get("id") or p1_obj.get("userId") or p1_obj.get("user_id") or "").strip()
            p2_uid = str(p2_u.get("id") or p2_obj.get("userId") or p2_obj.get("user_id") or "").strip()
            p1_reg = str(p1_obj.get("id") or pr.get("player1Id") or "").strip()
            p2_reg = str(p2_obj.get("id") or pr.get("player2Id") or "").strip()
            if not p1_uid and p1_reg in reg_to_uid:
                p1_uid = reg_to_uid[p1_reg]
            elif not p1_uid and p1_reg:
                bcp_p1 = self.fetch_bcp_player_name(p1_reg)
                if bcp_p1 and bcp_p1.get("canonical_user_id"):
                    p1_uid = bcp_p1["canonical_user_id"]
            if not p2_uid and p2_reg in reg_to_uid:
                p2_uid = reg_to_uid[p2_reg]
            elif not p2_uid and p2_reg:
                bcp_p2 = self.fetch_bcp_player_name(p2_reg)
                if bcp_p2 and bcp_p2.get("canonical_user_id"):
                    p2_uid = bcp_p2["canonical_user_id"]
            pairing_map[mid] = {"p1_uid": p1_uid, "p2_uid": p2_uid}

        return name_to_uids, reg_to_uid, pairing_map

    def verify_and_fix_same_name_matches(
        self,
        game_system: Optional[str] = None,
        dry_run: bool = False,
        max_events: Optional[int] = None
    ) -> Dict[str, int]:
        """Verifies all matches for players who share a name across multiple distinct IDs (COUNT(DISTINCT pid) > 1) against BCP event data.
        
        Step 2 Architecture:
        - Sub-step 2A: Check candidate IDs directly with BCP (/v1/players/{id}) to merge registration IDs
          into canonical global userIds immediately.
        - Sub-step 2B: For any names that still have multiple userIds across events, audit match pairings
          from BCP event rosters and assign each match to the true BCP userId.
        """
        target_sys = (game_system or "all").lower()
        sys_clause = ""
        if target_sys in ("40k", "wh40k"):
            sys_clause = "AND COALESCE(game_system, '40k') = '40k'"
        elif target_sys in ("aos", "warhammer_aos", "sigmar"):
            sys_clause = "AND COALESCE(game_system, '40k') = 'aos'"

        candidate_map: Dict[str, Set[str]] = {}
        with self.db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(f"""
                WITH player_event_names AS (
                    SELECT LOWER(TRIM(player1_name)) AS norm_name, player1_id AS pid
                    FROM matches
                    WHERE player1_name IS NOT NULL AND TRIM(player1_name) != ''
                      AND NOT (player1_name ~* %s OR player1_name ILIKE 'BYE')
                      {sys_clause}
                    UNION ALL
                    SELECT LOWER(TRIM(player2_name)) AS norm_name, player2_id AS pid
                    FROM matches
                    WHERE player2_name IS NOT NULL AND TRIM(player2_name) != ''
                      AND NOT (player2_name ~* %s OR player2_name ILIKE 'BYE')
                      {sys_clause}
                    UNION ALL
                    SELECT LOWER(TRIM(player_name)) AS norm_name, player_id AS pid
                    FROM player_ratings
                    WHERE player_name IS NOT NULL AND TRIM(player_name) != ''
                      AND NOT (player_name ~* %s OR player_name ILIKE 'BYE')
                      {sys_clause}
                ),
                multi_id_names AS (
                    SELECT norm_name
                    FROM player_event_names
                    GROUP BY norm_name
                    HAVING COUNT(DISTINCT pid) > 1
                )
                SELECT pen.norm_name, pen.pid
                FROM player_event_names pen
                JOIN multi_id_names min ON pen.norm_name = min.norm_name
                GROUP BY pen.norm_name, pen.pid;
                """, (PLACEHOLDER_REGEX_STR, PLACEHOLDER_REGEX_STR, PLACEHOLDER_REGEX_STR))
                for r in cur.fetchall():
                    if not r or not r[0]:
                        continue
                    norm_n = str(r[0]).strip()
                    if norm_n not in candidate_map:
                        candidate_map[norm_n] = set()
                    if len(r) > 1 and r[1]:
                        pid = str(r[1]).strip()
                        if pid and pid.lower() not in PLACEHOLDER_NAMES:
                            candidate_map[norm_n].add(pid)

        if not candidate_map:
            logger.info("✅ No multi-ID same-name players found requiring BCP match verification.")
            return {"events_checked": 0, "matches_fixed": 0, "remapped_ids": 0}

        logger.info(f"🔍 [Same-Name Verification] Auditing {len(candidate_map)} shared player name(s) across distinct IDs...")

        # Sub-step 2A: Direct BCP lookup on candidate IDs to resolve registration IDs -> canonical userIds
        all_pids_to_check: Set[str] = set()
        for pids in candidate_map.values():
            all_pids_to_check.update(pids)

        remapped_in_step2 = 0
        for pid in all_pids_to_check:
            try:
                bcp_info = self.fetch_bcp_player_name(pid)
                if bcp_info and bcp_info.get("canonical_user_id") and bcp_info["canonical_user_id"] != pid:
                    canonical_uid = bcp_info["canonical_user_id"]
                    logger.info(f"   🎯 [Same-Name Sub-step 2A] Registration ID {pid} maps to canonical userId {canonical_uid}")
                    if not dry_run:
                        c = self.apply_name_updates({pid: bcp_info})
                        remapped_in_step2 += c.get("remapped_ids", 0)
                    else:
                        remapped_in_step2 += 1

                    for norm_n, pids in candidate_map.items():
                        if pid in pids:
                            pids.remove(pid)
                            pids.add(canonical_uid)
            except Exception as e:
                logger.debug(f"Notice during Sub-step 2A check for pid {pid}: {e}")

        # Filter candidate_map to only those names that STILL have > 1 distinct userIds (or had no pids passed from test fixtures)
        remaining_candidates = {norm_n: pids for norm_n, pids in candidate_map.items() if len(pids) != 1}
        logger.info(f"🔍 [Same-Name Verification] After Sub-step 2A: {len(remaining_candidates)} multi-ID name(s) remain for event roster audit.")

        if not remaining_candidates:
            return {"events_checked": 0, "matches_fixed": 0, "remapped_ids": remapped_in_step2}

        # Sub-step 2B: Match-level audit against BCP event rosters & pairings
        candidate_names = list(remaining_candidates.keys())
        events_to_matches: Dict[str, List[Tuple[str, str, str, str, str, str, str]]] = {}
        with self.db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(f"""
                SELECT id, event_id, player1_id, player1_name, player2_id, player2_name, winner_id
                FROM matches
                WHERE (LOWER(TRIM(player1_name)) = ANY(%s) OR LOWER(TRIM(player2_name)) = ANY(%s))
                  {sys_clause};
                """, (candidate_names, candidate_names))
                for r in cur.fetchall():
                    if len(r) < 7:
                        continue
                    mid, eid, p1_id, p1_name, p2_id, p2_name, win_id = (
                        str(r[0] or "").strip(),
                        str(r[1] or "").strip(),
                        str(r[2] or "").strip(),
                        str(r[3] or "").strip(),
                        str(r[4] or "").strip(),
                        str(r[5] or "").strip(),
                        str(r[6] or "").strip()
                    )
                    if eid and not eid.startswith("ES-"):
                        if eid not in events_to_matches:
                            events_to_matches[eid] = []
                        events_to_matches[eid].append((mid, eid, p1_id, p1_name, p2_id, p2_name, win_id))

        event_ids = list(events_to_matches.keys())
        if max_events and max_events > 0:
            event_ids = event_ids[:max_events]

        candidate_set = set(candidate_names)
        events_checked = 0
        matches_fixed = 0

        for eid in event_ids:
            events_checked += 1
            name_to_uids, reg_to_uid, pairing_map = self._fetch_bcp_event_roster_and_pairings(eid)
            updates_for_event = []

            for (mid, _, p1_id, p1_name, p2_id, p2_name, win_id) in events_to_matches[eid]:
                # Check Player 1
                norm_p1 = p1_name.lower()
                if norm_p1 in candidate_set:
                    true_p1_uid = pairing_map.get(mid, {}).get("p1_uid") or ""
                    if not true_p1_uid:
                        uids = name_to_uids.get(norm_p1, [])
                        if len(uids) == 1:
                            true_p1_uid = uids[0]
                    if true_p1_uid and true_p1_uid != p1_id:
                        logger.info(f"   🔧 [Same-Name Fix] Match {mid} (Event {eid}): P1 '{p1_name}' DB ID {p1_id} -> BCP true userId {true_p1_uid}")
                        updates_for_event.append(("p1", mid, eid, p1_id, true_p1_uid, p1_name))

                # Check Player 2
                norm_p2 = p2_name.lower()
                if norm_p2 in candidate_set:
                    true_p2_uid = pairing_map.get(mid, {}).get("p2_uid") or ""
                    if not true_p2_uid:
                        uids = name_to_uids.get(norm_p2, [])
                        if len(uids) == 1:
                            true_p2_uid = uids[0]
                    if true_p2_uid and true_p2_uid != p2_id:
                        logger.info(f"   🔧 [Same-Name Fix] Match {mid} (Event {eid}): P2 '{p2_name}' DB ID {p2_id} -> BCP true userId {true_p2_uid}")
                        updates_for_event.append(("p2", mid, eid, p2_id, true_p2_uid, p2_name))

            if updates_for_event and not dry_run:
                with self.db.get_connection() as conn:
                    with conn.cursor() as cur:
                        for (side, mid, ev_id, old_id, true_uid, full_name) in updates_for_event:
                            first = full_name.split()[0] if full_name else ""
                            last = full_name.split()[-1] if len(full_name.split()) > 1 else ""
                            # Ensure true_uid exists in players
                            cur.execute("""
                            INSERT INTO players (id, first_name, last_name, full_name)
                            VALUES (%s, %s, %s, %s)
                            ON CONFLICT (id) DO UPDATE
                            SET full_name = EXCLUDED.full_name,
                                first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), players.first_name),
                                last_name = COALESCE(NULLIF(EXCLUDED.last_name, ''), players.last_name);
                            """, (true_uid, first, last, full_name))

                            if side == "p1":
                                cur.execute("""
                                UPDATE matches
                                SET player1_id = %s,
                                    winner_id = CASE WHEN winner_id = %s THEN %s ELSE winner_id END,
                                    loser_id  = CASE WHEN loser_id  = %s THEN %s ELSE loser_id  END
                                WHERE id = %s
                                  AND COALESCE(player2_id, '') != %s;
                                """, (true_uid, old_id, true_uid, old_id, true_uid, mid, true_uid))
                                rowcount = cur.rowcount if isinstance(cur.rowcount, int) else 1
                                if rowcount > 0:
                                    matches_fixed += 1
                                cur.execute("UPDATE tracker_games SET user_id_p1 = %s WHERE match_id = %s AND user_id_p1 = %s;", (true_uid, mid, old_id))
                            else:
                                cur.execute("""
                                UPDATE matches
                                SET player2_id = %s,
                                    winner_id = CASE WHEN winner_id = %s THEN %s ELSE winner_id END,
                                    loser_id  = CASE WHEN loser_id  = %s THEN %s ELSE loser_id  END
                                WHERE id = %s
                                  AND COALESCE(player1_id, '') != %s;
                                """, (true_uid, old_id, true_uid, old_id, true_uid, mid, true_uid))
                                rowcount = cur.rowcount if isinstance(cur.rowcount, int) else 1
                                if rowcount > 0:
                                    matches_fixed += 1
                                cur.execute("UPDATE tracker_games SET user_id_p2 = %s WHERE match_id = %s AND user_id_p2 = %s;", (true_uid, mid, old_id))

                            # Fix event_participants for this specific event
                            cur.execute("""
                            DELETE FROM event_participants ep_old
                            WHERE ep_old.event_id = %s AND ep_old.player_id = %s
                              AND EXISTS (
                                  SELECT 1 FROM event_participants ep_new
                                  WHERE ep_new.event_id = %s AND ep_new.player_id = %s
                              );
                            """, (ev_id, old_id, ev_id, true_uid))
                            cur.execute("""
                            UPDATE event_participants
                            SET player_id = %s
                            WHERE event_id = %s AND player_id = %s;
                            """, (true_uid, ev_id, old_id))
                        conn.commit()
            elif updates_for_event and dry_run:
                matches_fixed += len(updates_for_event)

        logger.info(f"✅ [Same-Name Verification] Checked {events_checked} event(s); fixed {matches_fixed} match player ID assignment(s), remapped {remapped_in_step2} IDs.")
        return {"events_checked": events_checked, "matches_fixed": matches_fixed, "remapped_ids": remapped_in_step2}

    def sync_names(
        self,
        game_system: str = "all",
        max_bcp_calls: Optional[int] = None,
        dry_run: bool = False,
        concurrency: int = 8,
        batch_commit_size: int = 50
    ) -> Dict[str, Any]:
        """Runs the complete name and canonical userId correction workflow."""
        start_time = time.time()
        logger.info(
            f"🚀 Starting BCP Player Name & Canonical ID Sync (game_system={game_system}, "
            f"dry_run={dry_run}, concurrency={concurrency}, limit={max_bcp_calls})..."
        )

        if not dry_run:
            try:
                with self.db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("""
                        UPDATE players
                        SET full_name = SUBSTRING(TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))), 1, 100)
                        WHERE (full_name IS NULL OR TRIM(full_name) = '' OR full_name ~* %s OR LENGTH(full_name) > 100 OR full_name LIKE '{%%')
                          AND (first_name IS NOT NULL OR last_name IS NOT NULL)
                          AND TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) != ''
                          AND TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) !~* %s
                          AND LENGTH(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) <= 100;
                        """, (PLACEHOLDER_REGEX_STR, PLACEHOLDER_REGEX_STR))
                        cur.execute("""
                        UPDATE players p
                        SET full_name = SUBSTRING(TRIM(ep.full_name), 1, 100)
                        FROM event_participants ep
                        WHERE p.id = ep.player_id
                          AND (p.full_name IS NULL OR TRIM(p.full_name) = '' OR p.full_name ~* %s OR LENGTH(p.full_name) > 100 OR p.full_name LIKE '{%%')
                          AND ep.full_name IS NOT NULL AND TRIM(ep.full_name) != '' AND LENGTH(ep.full_name) <= 100
                          AND ep.full_name NOT LIKE '{%%' AND ep.full_name NOT LIKE '[%%'
                          AND NOT (ep.full_name ~* %s OR ep.full_name ILIKE 'BYE');
                        """, (PLACEHOLDER_REGEX_STR, PLACEHOLDER_REGEX_STR))
                        cur.execute("""
                        UPDATE players p
                        SET full_name = SUBSTRING(TRIM(m.player1_name), 1, 100)
                        FROM matches m
                        WHERE p.id = m.player1_id
                          AND (p.full_name IS NULL OR TRIM(p.full_name) = '' OR p.full_name ~* %s OR LENGTH(p.full_name) > 100 OR p.full_name LIKE '{%%')
                          AND m.player1_name IS NOT NULL AND TRIM(m.player1_name) != '' AND LENGTH(m.player1_name) <= 100
                          AND m.player1_name NOT LIKE '{%%' AND m.player1_name NOT LIKE '[%%'
                          AND NOT (m.player1_name ~* %s OR m.player1_name ILIKE 'BYE');
                        """, (PLACEHOLDER_REGEX_STR, PLACEHOLDER_REGEX_STR))
                        cur.execute("""
                        UPDATE players p
                        SET full_name = SUBSTRING(TRIM(m.player2_name), 1, 100)
                        FROM matches m
                        WHERE p.id = m.player2_id
                          AND (p.full_name IS NULL OR TRIM(p.full_name) = '' OR p.full_name ~* %s OR LENGTH(p.full_name) > 100 OR p.full_name LIKE '{%%')
                          AND m.player2_name IS NOT NULL AND TRIM(m.player2_name) != '' AND LENGTH(m.player2_name) <= 100
                          AND m.player2_name NOT LIKE '{%%' AND m.player2_name NOT LIKE '[%%'
                          AND NOT (m.player2_name ~* %s OR m.player2_name ILIKE 'BYE');
                        """, (PLACEHOLDER_REGEX_STR, PLACEHOLDER_REGEX_STR))
                        cur.execute("""
                        UPDATE players p
                        SET full_name = SUBSTRING(TRIM(pr.player_name), 1, 100)
                        FROM player_ratings pr
                        WHERE p.id = pr.player_id
                          AND (p.full_name IS NULL OR TRIM(p.full_name) = '' OR p.full_name ~* %s OR LENGTH(p.full_name) > 100 OR p.full_name LIKE '{%%')
                          AND pr.player_name IS NOT NULL AND TRIM(pr.player_name) != '' AND LENGTH(pr.player_name) <= 100
                          AND pr.player_name NOT LIKE '{%%' AND pr.player_name NOT LIKE '[%%'
                          AND NOT (pr.player_name ~* %s OR pr.player_name ILIKE 'BYE');
                        """, (PLACEHOLDER_REGEX_STR, PLACEHOLDER_REGEX_STR))
                        cur.execute("""
                        UPDATE player_ratings pr
                        SET player_name = SUBSTRING(TRIM(p.full_name), 1, 100)
                        FROM players p
                        WHERE pr.player_id = p.id
                          AND (pr.player_name IS NULL OR TRIM(pr.player_name) = '' OR pr.player_name ~* %s OR LENGTH(pr.player_name) > 100 OR pr.player_name LIKE '{%%')
                          AND p.full_name IS NOT NULL AND TRIM(p.full_name) != '' AND LENGTH(p.full_name) <= 100
                          AND p.full_name NOT LIKE '{%%' AND p.full_name NOT LIKE '[%%'
                          AND NOT (p.full_name ~* %s OR p.full_name ILIKE 'BYE');
                        """, (PLACEHOLDER_REGEX_STR, PLACEHOLDER_REGEX_STR))
                        cur.execute("""
                        UPDATE matches m
                        SET player1_name = SUBSTRING(TRIM(p.full_name), 1, 100)
                        FROM players p
                        WHERE m.player1_id = p.id
                          AND (m.player1_name IS NULL OR TRIM(m.player1_name) = '' OR m.player1_name ~* %s OR LENGTH(m.player1_name) > 100 OR m.player1_name LIKE '{%%')
                          AND p.full_name IS NOT NULL AND TRIM(p.full_name) != '' AND LENGTH(p.full_name) <= 100
                          AND p.full_name NOT LIKE '{%%' AND p.full_name NOT LIKE '[%%'
                          AND NOT (p.full_name ~* %s OR p.full_name ILIKE 'BYE');
                        """, (PLACEHOLDER_REGEX_STR, PLACEHOLDER_REGEX_STR))
                        cur.execute("""
                        UPDATE matches m
                        SET player2_name = SUBSTRING(TRIM(p.full_name), 1, 100)
                        FROM players p
                        WHERE m.player2_id = p.id
                          AND (m.player2_name IS NULL OR TRIM(m.player2_name) = '' OR m.player2_name ~* %s OR LENGTH(m.player2_name) > 100 OR m.player2_name LIKE '{%%')
                          AND p.full_name IS NOT NULL AND TRIM(p.full_name) != '' AND LENGTH(p.full_name) <= 100
                          AND p.full_name NOT LIKE '{%%' AND p.full_name NOT LIKE '[%%'
                          AND NOT (p.full_name ~* %s OR p.full_name ILIKE 'BYE');
                        """, (PLACEHOLDER_REGEX_STR, PLACEHOLDER_REGEX_STR))
                    conn.commit()
            except Exception as sync_col_err:
                logger.debug(f"Notice syncing players full_name column: {sync_col_err}")

        # 1. Find all target IDs with placeholder names (ordered by leaderboard priority)
        placeholder_ids = self.find_placeholder_player_ids(game_system=game_system)
        resolved_names = self.resolve_from_local_db(set(placeholder_ids)) if placeholder_ids else {}
        local_resolved_count = len(resolved_names)

        updated_counts = {
            "players": 0,
            "player_ratings": 0,
            "matches_p1": 0,
            "matches_p2": 0,
            "history": 0,
            "participants": 0,
            "tracker_games": 0,
            "remapped_ids": 0,
            "same_name_matches_fixed": 0
        }
        if not dry_run:
            try:
                with self.db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("""
                        SELECT pg_terminate_backend(pid)
                        FROM pg_stat_activity
                        WHERE pid != pg_backend_pid()
                          AND datname = current_database()
                          AND (
                              query ILIKE '%%idx_pg_history_opponent%%'
                              OR (state = 'idle in transaction' AND state_change < NOW() - INTERVAL '30 seconds')
                          );
                        """)
                        cur.execute("CREATE INDEX IF NOT EXISTS idx_pg_participants_player ON event_participants(player_id);")
                    conn.commit()
            except Exception as e:
                logger.warning(f"Notice ensuring sync indexes: {e}")

        if not dry_run and resolved_names:
            # Apply local DB resolutions in safe incremental batches of batch_commit_size
            local_items = list(resolved_names.items())
            for i in range(0, len(local_items), batch_commit_size):
                chunk_dict = dict(local_items[i : i + batch_commit_size])
                c = self.apply_name_updates(chunk_dict)
                for k in updated_counts:
                    updated_counts[k] += c.get(k, 0)
            logger.info(f"⚡ Applied {local_resolved_count} local DB resolutions in incremental batches (remapped {updated_counts['remapped_ids']} IDs).")

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
                            uid_note = f" -> canonical userId {bcp_info['canonical_user_id']}" if bcp_info.get("canonical_user_id") else ""
                            logger.info(f"   [{completed_count}/{len(remaining_ids)}] 🎯 {pid} -> '{bcp_info['full_name']}'{uid_note} (via {bcp_info['source']})")
                        else:
                            logger.debug(f"   [{completed_count}/{len(remaining_ids)}] ⚪ {pid} -> No BCP user/player found")
                    except Exception as exc:
                        logger.warning(f"Notice fetching {pid}: {exc}")

                    # Incremental periodic commit
                    if not dry_run and len(uncommitted_batch) >= batch_commit_size:
                        c = self.apply_name_updates(uncommitted_batch)
                        for k in updated_counts:
                            updated_counts[k] += c.get(k, 0)
                        logger.info(f"💾 [Incremental Commit] Saved batch of {len(uncommitted_batch)} resolved players to database.")
                        uncommitted_batch.clear()

            # Commit any remaining uncommitted names
            if not dry_run and uncommitted_batch:
                c = self.apply_name_updates(uncommitted_batch)
                for k in updated_counts:
                    updated_counts[k] += c.get(k, 0)
                logger.info(f"💾 [Final Commit] Saved final batch of {len(uncommitted_batch)} resolved players to database.")
                uncommitted_batch.clear()

        # 4. Verify all same-name players in matches against BCP event rosters/pairings (Part B)
        max_events_for_audit = min(50, max_bcp_calls) if (max_bcp_calls and max_bcp_calls > 0) else None
        same_name_res = self.verify_and_fix_same_name_matches(
            game_system=game_system,
            dry_run=dry_run,
            max_events=max_events_for_audit
        )
        updated_counts["same_name_matches_fixed"] = same_name_res.get("matches_fixed", 0)
        updated_counts["remapped_ids"] += same_name_res.get("remapped_ids", 0)

        # 5. Fast set-based update of rating_history opponent_name from matches
        if not dry_run:
            try:
                with self.db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("""
                        UPDATE rating_history rh
                        SET opponent_name = CASE
                            WHEN rh.player_id = m.player1_id THEN m.player2_name
                            WHEN rh.player_id = m.player2_id THEN m.player1_name
                            ELSE rh.opponent_name
                        END
                        FROM matches m
                        WHERE rh.match_id = m.id
                          AND (rh.opponent_name ~* %s OR rh.opponent_name IS NULL OR TRIM(rh.opponent_name) = '')
                          AND (
                              (rh.player_id = m.player1_id AND m.player2_name IS NOT NULL AND m.player2_name !~* %s)
                              OR
                              (rh.player_id = m.player2_id AND m.player1_name IS NOT NULL AND m.player1_name !~* %s)
                          );
                        """, (PLACEHOLDER_REGEX_STR, PLACEHOLDER_REGEX_STR, PLACEHOLDER_REGEX_STR))
                        hist_updated = cur.rowcount if isinstance(cur.rowcount, int) else 0
                        conn.commit()
                        if hist_updated > 0:
                            logger.info(f"✨ Updated {hist_updated} placeholder opponent name(s) in rating_history.")
                            updated_counts["history"] += hist_updated
            except Exception as e:
                logger.warning(f"Notice updating rating_history opponent names: {e}")

        if not dry_run and (len(resolved_names) > 0 or updated_counts["same_name_matches_fixed"] > 0 or updated_counts["remapped_ids"] > 0):
            PostgresDatabase.invalidate_all_caches()

        total_resolved = len(resolved_names)
        logger.info(
            f"📊 Resolution Summary: {total_resolved} / {len(placeholder_ids)} resolved "
            f"({local_resolved_count} local, {bcp_resolved_count} via BCP API, {updated_counts['remapped_ids']} IDs merged, "
            f"{updated_counts['same_name_matches_fixed']} same-name match IDs fixed)."
        )

        duration = time.time() - start_time
        logger.info(f"🎉 Player Name & ID Sync finished in {duration:.2f}s!")

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
