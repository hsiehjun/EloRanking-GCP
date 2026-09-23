"""Elo rating engine: reconstructs chronological player win paths and ratings."""

import collections
import io
import json
import logging
import math
import re
import time
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

PLACEHOLDER_REGEX_STR = r'^(player($|[^a-zA-Z])|fake\s*player|unknown(\s*player)?|bye|none|null|tbd|unassigned)'
_PLACEHOLDER_RE = re.compile(PLACEHOLDER_REGEX_STR, re.IGNORECASE)


def _is_placeholder_name(name: Optional[str], player_id: Optional[str] = None) -> bool:
    if not name:
        return True
    cleaned = str(name).strip()
    if not cleaned or len(cleaned) > 100 or cleaned.startswith("{") or cleaned.startswith("["):
        return True
    if _PLACEHOLDER_RE.match(cleaned):
        return True
    if player_id and cleaned == str(player_id).strip():
        return True
    return False


def _sanitize_name(val: Any, max_len: int = 100) -> str:
    """Sanitizes player name string, extracting from JSON if needed, stripping newlines, and enforcing max length."""
    if val is None:
        return ""
    s = str(val).strip()
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
    s = s.replace("\t", " ").replace("\\", " ")
    cleaned = " ".join(s.split())
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len].strip()
    return cleaned


def _sanitize_team(val: Any, max_len: int = 100) -> Optional[str]:
    """Sanitizes team affiliation, rejecting JSON structures, invalid placeholders, and oversized strings."""
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    if s.startswith("{") and s.endswith("}"):
        try:
            parsed = json.loads(s)
            if isinstance(parsed, dict):
                s = str(parsed.get("name") or parsed.get("teamName") or parsed.get("team_name") or parsed.get("title") or "").strip()
        except Exception:
            return None
    elif s.startswith("{") or s.startswith("["):
        return None
    if "\n" in s or "\r" in s:
        lines = [line.strip() for line in s.replace("\r", "\n").split("\n") if line.strip()]
        s = lines[0] if lines else ""
    s = s.replace("\t", " ").replace("\\", " ")
    cleaned = " ".join(s.split())
    if not cleaned:
        return None
    if cleaned.lower() in ("none", "n/a", "unaligned", "unaffiliated", "no team", "null", "unknown", "-", "{}", "[]", "tbd"):
        return None
    if _PLACEHOLDER_RE.match(cleaned):
        return None
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len].strip()
    return cleaned if cleaned else None


def _sanitize_top_factions(player_factions_counter: collections.Counter, max_factions: int = 5, max_len: int = 200) -> Optional[str]:
    """Formats and bounds top factions string to prevent DB index limit errors."""
    if not player_factions_counter:
        return None
    factions_list: List[str] = []
    for fac, cnt in player_factions_counter.most_common(max_factions):
        clean_fac = _sanitize_name(fac, max_len=60)
        if clean_fac and clean_fac.lower() not in ("none", "null", "unknown", "n/a"):
            factions_list.append(clean_fac)
    if not factions_list:
        return None
    res = ", ".join(factions_list)
    if len(res) > max_len:
        res = res[:max_len].strip()
    return res if res else None


def _heal_and_load_authoritative_names(conn: Any, sys_target: str) -> Dict[str, str]:
    """Heals placeholder names across tables using real names from event_participants/matches/players and returns authoritative name map."""
    auth_names: Dict[str, str] = {}
    try:
        with conn.cursor() as cur:
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
            UPDATE player_ratings pr
            SET player_name = SUBSTRING(TRIM(p.full_name), 1, 100), updated_at = NOW()
            FROM players p
            WHERE pr.player_id = p.id
              AND (pr.player_name IS NULL OR TRIM(pr.player_name) = '' OR pr.player_name ~* %s OR LENGTH(pr.player_name) > 100 OR pr.player_name LIKE '{%%')
              AND p.full_name IS NOT NULL AND TRIM(p.full_name) != '' AND LENGTH(p.full_name) <= 100
              AND p.full_name NOT LIKE '{%%' AND p.full_name NOT LIKE '[%%'
              AND NOT (p.full_name ~* %s OR p.full_name ILIKE 'BYE');
            """, (PLACEHOLDER_REGEX_STR, PLACEHOLDER_REGEX_STR))
            cur.execute("""
            SELECT id, full_name FROM players
            WHERE full_name IS NOT NULL AND TRIM(full_name) != ''
              AND LENGTH(full_name) <= 100
              AND full_name NOT LIKE '{%%' AND full_name NOT LIKE '[%%'
              AND NOT (full_name ~* %s OR full_name ILIKE 'BYE');
            """, (PLACEHOLDER_REGEX_STR,))
            for row in cur.fetchall():
                pid = row[0] if isinstance(row, tuple) else row.get("id")
                fname = row[1] if isinstance(row, tuple) else row.get("full_name")
                if pid and fname:
                    clean_fname = _sanitize_name(fname, max_len=100)
                    if clean_fname and not _is_placeholder_name(clean_fname, str(pid)):
                        auth_names[str(pid)] = clean_fname
        conn.commit()
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        logging.getLogger("EloEngine").debug(f"Notice during _heal_and_load_authoritative_names: {e}")
    return auth_names

def _format_tsv_field(val: Any) -> str:
    if val is None:
        return "\\N"
    if isinstance(val, bool):
        return "t" if val else "f"
    if isinstance(val, (int, float)):
        return str(val)
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d %H:%M:%S%z")
    # Clean text: replace tabs, newlines, backslashes
    s = str(val).replace("\\", "\\\\").replace("\t", " ").replace("\n", " ").replace("\r", " ")
    # Universal fail-safe: never allow a single TSV column value to exceed 1000 characters
    if len(s) > 1000:
        s = s[:1000].strip()
    return s

try:
    from google3.experimental.users.hsiehjun.EloRanking.config import (
        INITIAL_ELO,
        DEFAULT_K_FACTOR,
        PROVISIONAL_K_FACTOR,
        PROVISIONAL_MATCH_COUNT,
        MIN_MATCHES_FOR_RANKING,
    )
    from google3.experimental.users.hsiehjun.EloRanking.database import Database
except ImportError:
    try:
        from experimental.users.hsiehjun.EloRanking.config import (
            INITIAL_ELO,
            DEFAULT_K_FACTOR,
            PROVISIONAL_K_FACTOR,
            PROVISIONAL_MATCH_COUNT,
            MIN_MATCHES_FOR_RANKING,
        )
        from experimental.users.hsiehjun.EloRanking.database import Database
    except ImportError:
        from config import (
            INITIAL_ELO,
            DEFAULT_K_FACTOR,
            PROVISIONAL_K_FACTOR,
            PROVISIONAL_MATCH_COUNT,
            MIN_MATCHES_FOR_RANKING,
        )
        from database import Database

logger = logging.getLogger("EloEngine")


def _max_date(d1, d2):
    if not d1:
        return d2
    if not d2:
        return d1
    s1 = d1.isoformat() if hasattr(d1, "isoformat") else str(d1)
    s2 = d2.isoformat() if hasattr(d2, "isoformat") else str(d2)
    return d1 if s1 >= s2 else d2


class EloEngine:
    """Reconstructs historical player trajectories, win paths, and post-constructed Elo ratings."""

    _player_win_path_cache_dict = {}

    @classmethod
    def invalidate_caches(cls):
        cls._player_win_path_cache_dict.clear()

    def __init__(
        self,
        db: Optional[Database] = None,
        initial_elo: float = INITIAL_ELO,
        default_k: float = DEFAULT_K_FACTOR,
        provisional_k: float = PROVISIONAL_K_FACTOR,
        provisional_matches: int = PROVISIONAL_MATCH_COUNT
    ):
        self.db = db or Database()
        self.initial_elo = initial_elo
        self.default_k = default_k
        self.provisional_k = provisional_k
        self.provisional_matches = provisional_matches

    def get_k_factor(self, matches_played: int) -> float:
        """Returns adaptive K-factor (higher K during provisional placement matches)."""
        if matches_played < self.provisional_matches:
            return self.provisional_k
        return self.default_k

    @staticmethod
    def expected_score(rating_a: float, rating_b: float) -> float:
        """Calculates expected score for player A facing player B using standard logistic curve."""
        return 1.0 / (1.0 + math.pow(10.0, (rating_b - rating_a) / 400.0))

    def calculate_expected_score(self, rating_a: float, rating_b: float) -> float:
        """Alias for expected_score."""
        return self.expected_score(rating_a, rating_b)

    def predict_matchup(self, r1: float, r2: float, k: Optional[float] = None) -> Dict[str, Any]:
        """Calculates expected probabilities and projected Elo deltas for a matchup."""
        k_val = k or self.default_k
        exp1 = self.expected_score(r1, r2)
        exp2 = 1.0 - exp1

        # If P1 wins
        d_p1_win = round(k_val * (1.0 - exp1), 2)
        # If P2 wins
        d_p2_win = round(k_val * (1.0 - exp2), 2)
        # If Draw
        d_p1_draw = round(k_val * (0.5 - exp1), 2)
        d_p2_draw = round(k_val * (0.5 - exp2), 2)

        return {
            "p1_win_prob": round(exp1 * 100.0, 1),
            "p2_win_prob": round(exp2 * 100.0, 1),
            "player1_rating": r1,
            "player2_rating": r2,
            "player1_win_prob": round(exp1 * 100.0, 1),
            "player2_win_prob": round(exp2 * 100.0, 1),
            "deltas": {
                "p1_win": d_p1_win,
                "p2_win": d_p2_win,
                "p1_draw": d_p1_draw,
                "p2_draw": d_p2_draw
            },
            "p1_win_deltas": {"p1": f"+{d_p1_win}", "p2": f"-{d_p1_win}"},
            "p2_win_deltas": {"p1": f"-{d_p2_win}", "p2": f"+{d_p2_win}"},
            "draw_deltas": {"p1": f"{d_p1_draw:+}", "p2": f"{d_p2_draw:+}"}
        }

    def predict_match_outcome(self, p1_id_or_name: str, p2_id_or_name: str, game_system: Optional[str] = "40k") -> Dict[str, Any]:
        """Calculates win probabilities, simulated Elo rating changes, and past head-to-head encounters."""
        from psycopg2 import extras

        target_sys = (game_system or "40k").lower()
        p1_data = None
        p2_data = None

        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT * FROM player_ratings WHERE (player_id = %s OR player_name ILIKE %s) AND COALESCE(game_system, '40k') = %s LIMIT 1;",
                    (p1_id_or_name, p1_id_or_name, target_sys)
                )
                p1_data = cur.fetchone()

                cur.execute(
                    "SELECT * FROM player_ratings WHERE (player_id = %s OR player_name ILIKE %s) AND COALESCE(game_system, '40k') = %s LIMIT 1;",
                    (p2_id_or_name, p2_id_or_name, target_sys)
                )
                p2_data = cur.fetchone()

        r1 = float(p1_data["current_elo"]) if p1_data else self.initial_elo
        r2 = float(p2_data["current_elo"]) if p2_data else self.initial_elo

        m1 = int(p1_data["matches_played"]) if p1_data else 0
        m2 = int(p2_data["matches_played"]) if p2_data else 0

        k1 = self.get_k_factor(m1)
        k2 = self.get_k_factor(m2)
        k = max(k1, k2)

        exp1 = self.expected_score(r1, r2)
        exp2 = 1.0 - exp1
        p1_prob = round(exp1 * 100.0, 1)
        p2_prob = round(exp2 * 100.0, 1)

        d_p1_win = round(k * (1.0 - exp1), 1)
        d_p2_win = round(k * (1.0 - exp2), 1)
        d_p1_draw = round(k * (0.5 - exp1), 1)
        d_p2_draw = round(k * (0.5 - exp2), 1)

        # Head-to-head encounters
        h2h_matches = self.db.get_head_to_head(p1_id_or_name, p2_id_or_name, game_system=target_sys)

        return {
            "p1_win_prob": p1_prob,
            "p2_win_prob": p2_prob,
            "player1_win_prob": p1_prob,
            "player2_win_prob": p2_prob,
            "player1_rating": r1,
            "player2_rating": r2,
            "deltas": {
                "p1_win": d_p1_win,
                "p2_win": d_p2_win,
                "p1_draw": d_p1_draw,
                "p2_draw": d_p2_draw
            },
            "p1_win_deltas": {"p1": f"+{d_p1_win}", "p2": f"-{d_p1_win}"},
            "p2_win_deltas": {"p1": f"-{d_p2_win}", "p2": f"+{d_p2_win}"},
            "draw_deltas": {"p1": f"{d_p1_draw:+}", "p2": f"{d_p2_draw:+}"},
            "head_to_head": h2h_matches
        }

    def reconstruct_incremental(self, batch_limit: int = 50000, game_system: Optional[str] = "40k") -> Dict[str, Any]:
        """Incrementally processes newly scraped matches without replaying historical data from scratch."""
        try:
            from psycopg2 import extras
        except ImportError:
            extras = None
        import time

        sys_target = (game_system or "40k").lower()
        if sys_target == "all":
            r_40k = self.reconstruct_incremental(batch_limit=batch_limit, game_system="40k")
            r_aos = self.reconstruct_incremental(batch_limit=batch_limit, game_system="aos")
            return {
                "game_system": "all",
                "40k": r_40k,
                "aos": r_aos,
                "total_new_matches": r_40k.get("total_new_matches", 0) + r_aos.get("total_new_matches", 0),
                "players_updated": r_40k.get("players_updated", 0) + r_aos.get("players_updated", 0),
                "history_points_saved": r_40k.get("history_points_saved", 0) + r_aos.get("history_points_saved", 0)
            }

        t0 = time.time()
        print("\n" + "=" * 68)
        print(f" ⚡ INCREMENTAL ELO UPDATE ENGINE [{sys_target.upper()}] (FAST-PATH)")
        print("=" * 68)

        # 0. Self-healing: revert and purge any stale rating_history rows from unscored/0-0 matches or updated outcomes
        try:
            with self.db.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                    WITH stale_rh AS (
                        SELECT rh.id, rh.match_id, rh.player_id, rh.delta_elo, rh.result, COALESCE(rh.game_system, '40k') as game_system
                        FROM rating_history rh
                        JOIN matches m ON rh.match_id = m.id
                        WHERE COALESCE(rh.game_system, '40k') = %s
                          AND (
                              m.is_done = FALSE
                              OR (
                                  COALESCE(m.is_bye, FALSE) = FALSE
                                  AND (m.winner_id IS NULL OR m.winner_id = '')
                                  AND (COALESCE(m.is_draw, FALSE) = FALSE OR (COALESCE(m.player1_score, 0) = 0 AND COALESCE(m.player2_score, 0) = 0))
                              )
                              OR (
                                  COALESCE(m.is_bye, FALSE) = FALSE
                                  AND COALESCE(m.is_draw, FALSE) = TRUE
                                  AND (COALESCE(m.player1_score, 0) > 0 OR COALESCE(m.player2_score, 0) > 0)
                                  AND rh.result != 'D'
                              )
                              OR (
                                  COALESCE(m.is_bye, FALSE) = FALSE
                                  AND COALESCE(m.is_draw, FALSE) = FALSE
                                  AND m.winner_id IS NOT NULL AND m.winner_id != ''
                                  AND ((rh.player_id = m.winner_id AND rh.result != 'W') OR (rh.player_id != m.winner_id AND rh.result != 'L'))
                              )
                              OR (
                                  rh.player_id != COALESCE(m.player1_id, '')
                                  AND rh.player_id != COALESCE(m.player2_id, '')
                              )
                          )
                    ),
                    agg_revert AS (
                        SELECT player_id, game_system,
                               SUM(COALESCE(delta_elo, 0)) as total_delta,
                               COUNT(*) as total_matches,
                               COUNT(*) FILTER (WHERE result = 'W') as total_wins,
                               COUNT(*) FILTER (WHERE result = 'L') as total_losses,
                               COUNT(*) FILTER (WHERE result = 'D') as total_draws
                        FROM stale_rh
                        GROUP BY player_id, game_system
                    ),
                    reverted_pr AS (
                        UPDATE player_ratings pr
                        SET current_elo = pr.current_elo - ar.total_delta,
                            matches_played = GREATEST(0, pr.matches_played - ar.total_matches),
                            wins = GREATEST(0, pr.wins - ar.total_wins),
                            losses = GREATEST(0, pr.losses - ar.total_losses),
                            draws = GREATEST(0, pr.draws - ar.total_draws)
                        FROM agg_revert ar
                        WHERE pr.player_id = ar.player_id
                          AND COALESCE(pr.game_system, '40k') = ar.game_system
                    )
                    DELETE FROM rating_history
                    WHERE id IN (SELECT id FROM stale_rh);
                    """, (sys_target,))
                    purged = int(cur.rowcount or 0)
                    conn.commit()
                    if purged > 0:
                        logger.info(f"🧹 Reverted and purged {purged} stale/unscored rating_history record(s) for {sys_target.upper()}.")
        except Exception as cleanup_err:
            logger.debug(f"Notice during stale rating_history cleanup: {cleanup_err}")

        # 1. Fetch unranked matches for this game system
        print(f"[1/3] 🔍 Checking for new unranked {sys_target.upper()} matches in PostgreSQL...")
        new_matches = self.db.get_unranked_matches(limit=batch_limit, game_system=sys_target)
        total_new = len(new_matches)

        if total_new == 0:
            # Self-healing: verify if any player ratings are out-of-sync with their latest rating_history
            healed = 0
            try:
                with self.db.get_connection() as conn:
                    _heal_and_load_authoritative_names(conn, sys_target)
                    with conn.cursor() as cur:
                        cur.execute("""
                        WITH latest_rh AS (
                            SELECT DISTINCT ON (player_id, game_system)
                                player_id, new_elo, game_system, match_date
                            FROM rating_history
                            WHERE COALESCE(game_system, '40k') = %s
                            ORDER BY player_id, game_system, match_date DESC NULLS LAST, id DESC
                        )
                        UPDATE player_ratings pr
                        SET current_elo = l.new_elo,
                            peak_elo = GREATEST(pr.peak_elo, l.new_elo),
                            last_active_date = COALESCE(l.match_date, pr.last_active_date),
                            updated_at = NOW()
                        FROM latest_rh l
                        WHERE pr.player_id = l.player_id
                          AND COALESCE(pr.game_system, '40k') = l.game_system
                          AND ABS(pr.current_elo - l.new_elo) > 0.01;
                        """, (sys_target,))
                        try:
                            healed = int(cur.rowcount)
                        except (ValueError, TypeError):
                            healed = 0
                        conn.commit()
                        if healed > 0:
                            logger.info(f"✨ Self-healed {healed} out-of-sync player rating(s) for {sys_target.upper()} from rating_history.")
            except Exception as heal_err:
                logger.debug(f"Notice during rating history alignment: {heal_err}")

            print(f"      ✅ Database is completely up to date for {sys_target.upper()}! Zero new matches to process (healed: {healed}).\n")
            return {"total_new_matches": 0, "status": "UP_TO_DATE", "game_system": sys_target, "healed_ratings": healed}

        print(f"      📥 Found {total_new:,} new {sys_target.upper()} matches to ingest incrementally.")

        # 2. Load existing player states for this game system
        print(f"[2/3] 🧠 Loading active player Elo ratings [{sys_target.upper()}] from PostgreSQL...")
        player_states: Dict[str, Dict[str, Any]] = {}
        player_factions: Dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
        existing_teams: Dict[str, str] = {}
        authoritative_names: Dict[str, str] = {}

        with self.db.get_connection() as conn:
            authoritative_names = _heal_and_load_authoritative_names(conn, sys_target)
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                # 1. Fetch latest active team from event_participants ordered by event recency for this game system
                cur.execute("""
                SELECT DISTINCT ON (ep.player_id) ep.player_id, TRIM(ep.team) as team
                FROM event_participants ep
                LEFT JOIN events e ON ep.event_id = e.id
                WHERE ep.team IS NOT NULL AND TRIM(ep.team) != ''
                  AND LENGTH(ep.team) <= 100 AND ep.team NOT LIKE '{%%' AND ep.team NOT LIKE '[%%'
                  AND LOWER(TRIM(ep.team)) NOT IN ('none', 'n/a', 'unaligned', 'unaffiliated', 'no team', 'null', 'unknown', '-')
                  AND COALESCE(e.game_system, '40k') = %s
                ORDER BY ep.player_id, e.event_date DESC NULLS LAST;
                """, (sys_target,))
                for r in cur.fetchall():
                    pid = r.get("player_id")
                    clean_t = _sanitize_team(r.get("team"), max_len=100)
                    if pid and clean_t:
                        existing_teams[str(pid)[:64]] = clean_t

                # 2. Fallback to players table ONLY for 40k (to prevent 40k teams from polluting AoS)
                if sys_target == "40k":
                    cur.execute("""
                    SELECT id as player_id, TRIM(team) as team
                    FROM players
                    WHERE team IS NOT NULL AND TRIM(team) != ''
                      AND LENGTH(team) <= 100 AND team NOT LIKE '{%%' AND team NOT LIKE '[%%'
                      AND LOWER(TRIM(team)) NOT IN ('none', 'n/a', 'unaligned', 'unaffiliated', 'no team', 'null', 'unknown', '-');
                    """)
                    for r in cur.fetchall():
                        pid = r.get("player_id")
                        clean_t = _sanitize_team(r.get("team"), max_len=100)
                        if pid and clean_t and pid not in existing_teams:
                            existing_teams[str(pid)[:64]] = clean_t

                cur.execute("""
                SELECT player_id, player_name, current_elo, peak_elo,
                       matches_played, wins, losses, draws, top_faction, team, last_active_date
                FROM player_ratings
                WHERE (game_system = %s OR (game_system IS NULL AND %s = '40k'));
                """, (sys_target, sys_target))
                for r in cur.fetchall():
                    pid = str(r["player_id"])[:64]
                    raw_name = r.get("player_name") or pid
                    if _is_placeholder_name(raw_name, pid) and pid in authoritative_names:
                        raw_name = authoritative_names[pid]
                    clean_name_val = _sanitize_name(raw_name, max_len=100) or f"Player {pid[:8]}"
                    player_states[pid] = {
                        "name": clean_name_val,
                        "elo": float(r.get("current_elo") or self.initial_elo),
                        "peak_elo": float(r.get("peak_elo") or self.initial_elo),
                        "matches_played": int(r.get("matches_played") or 0),
                        "wins": int(r.get("wins") or 0),
                        "losses": int(r.get("losses") or 0),
                        "draws": int(r.get("draws") or 0),
                        "last_active_date": r.get("last_active_date")
                    }
                    clean_t = _sanitize_team(r.get("team"), max_len=100)
                    if clean_t and pid not in existing_teams:
                        existing_teams[pid] = clean_t
                    if r.get("top_faction"):
                        for fac in r["top_faction"].split(", "):
                            clean_fac = _sanitize_name(fac, max_len=60)
                            if clean_fac:
                                player_factions[pid][clean_fac] += 1

            # 3. Process new matches and append trajectory points
            print(f"[3/3] ⚡ Computing Elo updates and persisting {total_new:,} {sys_target.upper()} matches...")
            with conn.cursor() as cursor:
                cursor.execute("SET LOCAL synchronous_commit = OFF;")
                insert_history_pg = """
                INSERT INTO rating_history (
                    player_id, match_id, event_id, round, match_date,
                    old_elo, new_elo, delta_elo, opponent_id, opponent_name,
                    opponent_elo, result, player_faction, opponent_faction,
                    player_score, opponent_score, game_system
                ) VALUES %s;
                """

                history_batch = []
                touched_players = set()

                for m in new_matches:
                    p1_id, p2_id = m["player1_id"], m["player2_id"]
                    if not p1_id or not p2_id:
                        continue
                    p1_id = str(p1_id)[:64]
                    p2_id = str(p2_id)[:64]

                    p1_mname = _sanitize_name(m.get("player1_name"), max_len=100)
                    p1_best = authoritative_names.get(p1_id) or (p1_mname if not _is_placeholder_name(p1_mname, p1_id) else None)
                    s1 = player_states.get(p1_id)
                    if not s1:
                        s1 = {
                            "name": _sanitize_name(p1_best or p1_mname, max_len=100) or f"Player {p1_id[:8]}",
                            "elo": self.initial_elo,
                            "peak_elo": self.initial_elo,
                            "matches_played": 0, "wins": 0, "losses": 0, "draws": 0,
                            "last_active_date": None
                        }
                        player_states[p1_id] = s1
                    elif _is_placeholder_name(s1["name"], p1_id) and p1_best:
                        s1["name"] = _sanitize_name(p1_best, max_len=100)

                    p2_mname = _sanitize_name(m.get("player2_name"), max_len=100)
                    p2_best = authoritative_names.get(p2_id) or (p2_mname if not _is_placeholder_name(p2_mname, p2_id) else None)
                    s2 = player_states.get(p2_id)
                    if not s2:
                        s2 = {
                            "name": _sanitize_name(p2_best or p2_mname, max_len=100) or f"Player {p2_id[:8]}",
                            "elo": self.initial_elo,
                            "peak_elo": self.initial_elo,
                            "matches_played": 0, "wins": 0, "losses": 0, "draws": 0,
                            "last_active_date": None
                        }
                        player_states[p2_id] = s2
                    elif _is_placeholder_name(s2["name"], p2_id) and p2_best:
                        s2["name"] = _sanitize_name(p2_best, max_len=100)

                    is_real_draw = bool(m.get("is_draw") and ((m.get("player1_score") or 0) > 0 or (m.get("player2_score") or 0) > 0))
                    has_valid_winner = bool(m.get("winner_id") and m.get("winner_id") in (p1_id, p2_id))
                    if not m.get("is_bye") and not has_valid_winner and not is_real_draw:
                        continue

                    touched_players.add(p1_id)
                    touched_players.add(p2_id)

                    old_elo1 = s1["elo"]
                    old_elo2 = s2["elo"]
                    m_date = m.get("match_date")
                    match_sys = m.get("game_system") or sys_target

                    if m.get("is_bye") or is_real_draw:
                        res1, res2 = ("D", "D") if is_real_draw else ("W", "L")
                        new_elo1, new_elo2 = old_elo1, old_elo2
                    else:
                        is_p1_win = (m.get("winner_id") == p1_id)
                        res1, res2 = ("W", "L") if is_p1_win else ("L", "W")
                        k1 = self.provisional_k if s1["matches_played"] < self.provisional_matches else self.default_k
                        k2 = self.provisional_k if s2["matches_played"] < self.provisional_matches else self.default_k

                        exp1 = self.expected_score(old_elo1, old_elo2)
                        exp2 = 1.0 - exp1
                        act1 = 1.0 if is_p1_win else 0.0
                        act2 = 1.0 - act1

                        new_elo1 = round(old_elo1 + k1 * (act1 - exp1), 2)
                        new_elo2 = round(old_elo2 + k2 * (act2 - exp2), 2)

                    # Update player 1
                    s1["elo"] = new_elo1
                    s1["peak_elo"] = max(s1["peak_elo"], new_elo1)
                    s1["matches_played"] += 1
                    if res1 == "W": s1["wins"] += 1
                    elif res1 == "L": s1["losses"] += 1
                    else: s1["draws"] += 1
                    if m_date: s1["last_active_date"] = _max_date(s1["last_active_date"], m_date)
                    fac1 = _sanitize_name(m.get("player1_faction"), max_len=60)
                    fac2 = _sanitize_name(m.get("player2_faction"), max_len=60)
                    if fac1: player_factions[p1_id][fac1] += 1
                    if fac2: player_factions[p2_id][fac2] += 1

                    # Update player 2
                    s2["elo"] = new_elo2
                    s2["peak_elo"] = max(s2["peak_elo"], new_elo2)
                    s2["matches_played"] += 1
                    if res2 == "W": s2["wins"] += 1
                    elif res2 == "L": s2["losses"] += 1
                    else: s2["draws"] += 1
                    if m_date: s2["last_active_date"] = _max_date(s2["last_active_date"], m_date)

                    history_batch.append((
                        p1_id, str(m["id"])[:64], str(m.get("event_id") or "")[:64] if m.get("event_id") else None, m.get("round"), m_date,
                        old_elo1, new_elo1, round(new_elo1 - old_elo1, 2),
                        p2_id, _sanitize_name(s2["name"], max_len=100), old_elo2, res1,
                        fac1, fac2,
                        m.get("player1_score"), m.get("player2_score"),
                        match_sys
                    ))
                    history_batch.append((
                        p2_id, str(m["id"])[:64], str(m.get("event_id") or "")[:64] if m.get("event_id") else None, m.get("round"), m_date,
                        old_elo2, new_elo2, round(new_elo2 - old_elo2, 2),
                        p1_id, _sanitize_name(s1["name"], max_len=100), old_elo1, res2,
                        fac2, fac1,
                        m.get("player2_score"), m.get("player1_score"),
                        match_sys
                    ))

                if history_batch:
                    extras.execute_values(cursor, insert_history_pg, history_batch, page_size=2500)

                # Upsert updated player ratings for touched players only into composite PK (player_id, game_system)
                now_iso = datetime.now(timezone.utc)
                upsert_ratings_pg = f"""
                INSERT INTO player_ratings (
                    player_id, player_name, current_elo, peak_elo,
                    matches_played, wins, losses, draws, win_rate,
                    top_faction, team, last_active_date, updated_at, game_system
                ) VALUES %s
                ON CONFLICT (player_id, game_system) DO UPDATE SET
                    player_name = CASE
                        WHEN EXCLUDED.player_name !~* '{PLACEHOLDER_REGEX_STR}'
                        THEN EXCLUDED.player_name
                        ELSE COALESCE(NULLIF(player_ratings.player_name, ''), EXCLUDED.player_name)
                    END,
                    current_elo = EXCLUDED.current_elo,
                    peak_elo = EXCLUDED.peak_elo,
                    matches_played = EXCLUDED.matches_played,
                    wins = EXCLUDED.wins,
                    losses = EXCLUDED.losses,
                    draws = EXCLUDED.draws,
                    win_rate = EXCLUDED.win_rate,
                    top_faction = EXCLUDED.top_faction,
                    team = COALESCE(EXCLUDED.team, player_ratings.team),
                    last_active_date = EXCLUDED.last_active_date,
                    updated_at = EXCLUDED.updated_at;
                """

                ratings_data = []
                for pid in touched_players:
                    s = player_states[pid]
                    total = s["matches_played"]
                    win_rate = round((s["wins"] / total) * 100.0, 1) if total > 0 else 0.0
                    top_fac = _sanitize_top_factions(player_factions[pid], max_factions=5, max_len=200)
                    team_name = _sanitize_team(existing_teams.get(pid), max_len=100)
                    clean_player_name = _sanitize_name(s.get("name"), max_len=100) or f"Player {str(pid)[:8]}"

                    ratings_data.append((
                        str(pid)[:64], clean_player_name, s["elo"], s["peak_elo"],
                        total, s["wins"], s["losses"], s["draws"], win_rate,
                        top_fac, team_name, s["last_active_date"], now_iso, sys_target
                    ))

                if ratings_data:
                    try:
                        extras.execute_values(cursor, upsert_ratings_pg, ratings_data, page_size=2000)
                    except Exception as up_err:
                        err_str = str(up_err).lower()
                        if "on conflict" in err_str or "constraint" in err_str or "unique" in err_str:
                            logger.warning(f"Notice: composite constraint missing; falling back to ON CONFLICT (player_id): {up_err}")
                            upsert_fallback = upsert_ratings_pg.replace("ON CONFLICT (player_id, game_system)", "ON CONFLICT (player_id)")
                            extras.execute_values(cursor, upsert_fallback, ratings_data, page_size=2000)
                        else:
                            raise

                conn.commit()

                # Invalidate caches
                self.invalidate_caches()
                if hasattr(self.db, "invalidate_all_caches"):
                    self.db.invalidate_all_caches()
                elif hasattr(self.db.__class__, "invalidate_all_caches"):
                    self.db.__class__.invalidate_all_caches()

        total_time = time.time() - t0
        print("=" * 68)
        print(f" 🎉 INCREMENTAL UPDATE [{sys_target.upper()}] FINISHED IN {total_time:.2f}s!")
        print(f"    • New Matches Processed:   {total_new:,}")
        print(f"    • Active Players Updated:  {len(touched_players):,}")
        print(f"    • History Points Appended: {len(history_batch):,}")
        print("=" * 68 + "\n")

        return {
            "total_new_matches": total_new,
            "players_updated": len(touched_players),
            "history_points_saved": len(history_batch),
            "elapsed_seconds": round(total_time, 2),
            "game_system": sys_target
        }

    def reconstruct_all_rankings(self, chunk_size: int = 25000, game_system: Optional[str] = "40k") -> Dict[str, Any]:
        """Replays all historical matches chronologically using UNLOGGED COPY streaming and instant per-batch commits."""
        try:
            from psycopg2 import extras
        except ImportError:
            extras = None
        import io
        import time

        sys_target = (game_system or "40k").lower()
        if sys_target == "all":
            r_40k = self.reconstruct_all_rankings(chunk_size=chunk_size, game_system="40k")
            r_aos = self.reconstruct_all_rankings(chunk_size=chunk_size, game_system="aos")
            return {
                "game_system": "all",
                "40k": r_40k,
                "aos": r_aos,
                "total_players_ranked": r_40k.get("total_players_ranked", 0) + r_aos.get("total_players_ranked", 0),
                "total_matches_processed": r_40k.get("total_matches_processed", 0) + r_aos.get("total_matches_processed", 0),
                "history_points_saved": r_40k.get("history_points_saved", 0) + r_aos.get("history_points_saved", 0)
            }

        t0 = time.time()
        total_matches = self.db.get_total_matches_count(game_system=sys_target)
        print("\n" + "=" * 68)
        print(f" 🏆 {sys_target.upper()} HIGH-THROUGHPUT ELO RECONSTRUCTION (GCP)")
        print("=" * 68)
        print(f"[*] Total chronological {sys_target.upper()} matches in database: {total_matches:,}")

        if total_matches == 0:
            print(f"⚠️ No matches found for {sys_target.upper()} in PostgreSQL database.")
            return {"total_players_ranked": 0, "total_matches_processed": 0, "history_points_saved": 0, "game_system": sys_target}

        player_states: Dict[str, Dict[str, Any]] = {}
        player_factions: Dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
        existing_teams: Dict[str, str] = {}

        # 0. Defensive Database Self-Healing: purge/clamp any oversized strings or raw JSON blobs from text columns
        # to prevent PostgreSQL B-tree index row limit exceptions (maximum 8191 bytes per index key).
        with self.db.get_connection() as conn:
            try:
                with conn.cursor() as heal_cur:
                    heal_cur.execute("""
                    UPDATE players SET full_name = SUBSTRING(TRIM(full_name), 1, 100) WHERE full_name IS NOT NULL AND LENGTH(full_name) > 100;
                    UPDATE players SET team = NULL WHERE team IS NOT NULL AND (LENGTH(team) > 100 OR team LIKE '{%' OR team LIKE '[%');
                    UPDATE matches SET player1_name = SUBSTRING(TRIM(player1_name), 1, 100) WHERE player1_name IS NOT NULL AND LENGTH(player1_name) > 100;
                    UPDATE matches SET player2_name = SUBSTRING(TRIM(player2_name), 1, 100) WHERE player2_name IS NOT NULL AND LENGTH(player2_name) > 100;
                    UPDATE event_participants SET full_name = SUBSTRING(TRIM(full_name), 1, 100) WHERE full_name IS NOT NULL AND LENGTH(full_name) > 100;
                    UPDATE event_participants SET team = NULL WHERE team IS NOT NULL AND (LENGTH(team) > 100 OR team LIKE '{%' OR team LIKE '[%');
                    """)
                    conn.commit()
            except Exception as heal_err:
                try:
                    conn.rollback()
                except Exception:
                    pass
                logger.debug(f"Pre-reconstruction database self-healing notice: {heal_err}")

        # 1. Fetch existing teams from permanent players & participants tables
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                # 1. Most recent active team from event_participants by event_date for this game system
                cur.execute("""
                SELECT DISTINCT ON (ep.player_id) ep.player_id, TRIM(ep.team) as team
                FROM event_participants ep
                LEFT JOIN events e ON ep.event_id = e.id
                WHERE ep.team IS NOT NULL AND TRIM(ep.team) != ''
                  AND LENGTH(ep.team) <= 100 AND ep.team NOT LIKE '{%%' AND ep.team NOT LIKE '[%%'
                  AND LOWER(TRIM(ep.team)) NOT IN ('none', 'n/a', 'unaligned', 'unaffiliated', 'no team', 'null', 'unknown', '-')
                  AND COALESCE(e.game_system, '40k') = %s
                ORDER BY ep.player_id, e.event_date DESC NULLS LAST;
                """, (sys_target,))
                for r in cur.fetchall():
                    pid = r.get("player_id")
                    clean_t = _sanitize_team(r.get("team"), max_len=100)
                    if pid and clean_t:
                        existing_teams[str(pid)[:64]] = clean_t

                # 2. Fallback to existing player_ratings for players not covered above
                cur.execute("""
                SELECT player_id, TRIM(team) as team
                FROM player_ratings
                WHERE team IS NOT NULL AND TRIM(team) != ''
                  AND LENGTH(team) <= 100 AND team NOT LIKE '{%%' AND team NOT LIKE '[%%'
                  AND LOWER(TRIM(team)) NOT IN ('none', 'n/a', 'unaligned', 'unaffiliated', 'no team', 'null', 'unknown', '-')
                  AND COALESCE(game_system, '40k') = %s;
                """, (sys_target,))
                for r in cur.fetchall():
                    pid = r.get("player_id")
                    clean_t = _sanitize_team(r.get("team"), max_len=100)
                    if pid and clean_t and str(pid)[:64] not in existing_teams:
                        existing_teams[str(pid)[:64]] = clean_t

                # 3. Fallback to players table ONLY for 40k (to prevent 40k teams from polluting AoS)
                if sys_target == "40k":
                    cur.execute("""
                    SELECT id as player_id, TRIM(team) as team
                    FROM players
                    WHERE team IS NOT NULL AND TRIM(team) != ''
                      AND LENGTH(team) <= 100 AND team NOT LIKE '{%%' AND team NOT LIKE '[%%'
                      AND LOWER(TRIM(team)) NOT IN ('none', 'n/a', 'unaligned', 'unaffiliated', 'no team', 'null', 'unknown', '-');
                    """)
                    for r in cur.fetchall():
                        pid = r.get("player_id")
                        clean_t = _sanitize_team(r.get("team"), max_len=100)
                        if pid and clean_t and str(pid)[:64] not in existing_teams:
                            existing_teams[str(pid)[:64]] = clean_t

                if not existing_teams:
                    print("      🔍 Scanning matches raw JSON for team affiliations...")
                    try:
                        cur.execute("""
                        SELECT DISTINCT 
                            player1_id as p_id, 
                            COALESCE(
                                raw_json->'player1'->>'teamName',
                                raw_json->'player1'->'team'->>'name',
                                raw_json->'player1'->'team'->>'teamName',
                                CASE WHEN raw_json->'player1'->>'team' NOT LIKE '{%%' AND raw_json->'player1'->>'team' NOT LIKE '[%%' THEN raw_json->'player1'->>'team' ELSE NULL END,
                                raw_json->'player1'->'user'->>'teamName',
                                raw_json->'player1'->'user'->'team'->>'name',
                                raw_json->'player1'->'user'->'team'->>'teamName',
                                CASE WHEN raw_json->'player1'->'user'->>'team' NOT LIKE '{%%' AND raw_json->'player1'->'user'->>'team' NOT LIKE '[%%' THEN raw_json->'player1'->'user'->>'team' ELSE NULL END
                            ) as t_name
                        FROM matches
                        WHERE player1_id IS NOT NULL 
                          AND COALESCE(game_system, '40k') = %s
                          AND (
                            raw_json->'player1'->>'teamName' IS NOT NULL OR
                            raw_json->'player1'->>'team' IS NOT NULL OR
                            raw_json->'player1'->'user'->>'teamName' IS NOT NULL OR
                            raw_json->'player1'->'user'->>'team' IS NOT NULL
                          )
                        UNION
                        SELECT DISTINCT 
                            player2_id as p_id, 
                            COALESCE(
                                raw_json->'player2'->>'teamName',
                                raw_json->'player2'->'team'->>'name',
                                raw_json->'player2'->'team'->>'teamName',
                                CASE WHEN raw_json->'player2'->>'team' NOT LIKE '{%%' AND raw_json->'player2'->>'team' NOT LIKE '[%%' THEN raw_json->'player2'->>'team' ELSE NULL END,
                                raw_json->'player2'->'user'->>'teamName',
                                raw_json->'player2'->'user'->'team'->>'name',
                                raw_json->'player2'->'user'->'team'->>'teamName',
                                CASE WHEN raw_json->'player2'->'user'->>'team' NOT LIKE '{%%' AND raw_json->'player2'->'user'->>'team' NOT LIKE '[%%' THEN raw_json->'player2'->'user'->>'team' ELSE NULL END
                            ) as t_name
                        FROM matches
                        WHERE player2_id IS NOT NULL 
                          AND COALESCE(game_system, '40k') = %s
                          AND (
                            raw_json->'player2'->>'teamName' IS NOT NULL OR
                            raw_json->'player2'->>'team' IS NOT NULL OR
                            raw_json->'player2'->'user'->>'teamName' IS NOT NULL OR
                            raw_json->'player2'->'user'->>'team' IS NOT NULL
                          );
                        """, (sys_target, sys_target))
                        for r in cur.fetchall():
                            t = _sanitize_team(r.get("t_name"), max_len=100)
                            p_id = str(r.get("p_id") or "").strip()[:64]
                            if p_id and t:
                                existing_teams[p_id] = t
                                cur.execute("UPDATE players SET team = %s WHERE id = %s;", (t, p_id))
                        conn.commit()
                        print(f"      🛡️ Discovered and mapped {len(existing_teams):,} player team memberships.")
                    except Exception as e:
                        logger.debug(f"JSON team scan error: {e}")

            # 2. Clear old history for target game_system and load authoritative real names
            authoritative_names = _heal_and_load_authoritative_names(conn, sys_target)
            with conn.cursor() as cursor:
                print(f"[1/3] 💾 Clearing old {sys_target.upper()} history and optimizing table buffers...")
                cursor.execute("SET LOCAL synchronous_commit = OFF;")
                cursor.execute("DELETE FROM rating_history WHERE COALESCE(game_system, '40k') = %s;", (sys_target,))
                cursor.execute("DELETE FROM player_ratings WHERE COALESCE(game_system, '40k') = %s;", (sys_target,))
                conn.commit()

        history_cols = (
            "player_id", "match_id", "event_id", "round", "match_date",
            "old_elo", "new_elo", "delta_elo", "opponent_id", "opponent_name",
            "opponent_elo", "result", "player_faction", "opponent_faction",
            "player_score", "opponent_score", "game_system"
        )

        num_chunks = (total_matches + chunk_size - 1) // chunk_size
        print(f"[2/3] 🧠 Streaming & Replaying {num_chunks} chronological batches via COPY...")

        total_history_count = 0
        processed_matches = 0
        c_idx = 0

        with self.db.get_connection() as stream_conn:
            with stream_conn.cursor(name="stream_recon_cursor", cursor_factory=extras.RealDictCursor) as stream_cur:
                stream_cur.itersize = chunk_size
                stream_cur.execute("""
                SELECT 
                    m.id, m.event_id, m.round, m.table_number, m.match_date,
                    m.player1_id, m.player1_name, m.player1_faction, m.player1_score,
                    m.player2_id, m.player2_name, m.player2_faction, m.player2_score,
                    m.winner_id, m.is_draw, m.is_bye
                FROM matches m
                WHERE m.is_done = TRUE
                  AND m.player1_id IS NOT NULL AND m.player1_id != ''
                  AND m.player2_id IS NOT NULL AND m.player2_id != ''
                  AND (
                      m.is_bye = TRUE
                      OR (m.winner_id IS NOT NULL AND m.winner_id != '')
                      OR (m.is_draw = TRUE AND (COALESCE(m.player1_score, 0) > 0 OR COALESCE(m.player2_score, 0) > 0))
                  )
                  AND COALESCE(m.game_system, '40k') = %s
                ORDER BY m.match_date ASC NULLS FIRST, m.round ASC, m.table_number ASC;
                """, (sys_target,))

                with self.db.get_connection() as write_conn:
                    while True:
                        t_chunk_start = time.time()
                        chunk_matches = stream_cur.fetchmany(chunk_size)
                        if not chunk_matches:
                            break

                        c_idx += 1
                        c_count = len(chunk_matches)
                        processed_matches += c_count
                        
                        tsv_buffer = io.StringIO()
                        history_rows_in_chunk = 0

                        for m in chunk_matches:
                            p1_id, p2_id = m["player1_id"], m["player2_id"]
                            if not p1_id or not p2_id:
                                continue
                            p1_id = str(p1_id)[:64]
                            p2_id = str(p2_id)[:64]

                            is_real_draw = bool(m.get("is_draw") and ((m.get("player1_score") or 0) > 0 or (m.get("player2_score") or 0) > 0))
                            has_valid_winner = bool(m.get("winner_id") and m.get("winner_id") in (p1_id, p2_id))
                            if not m.get("is_bye") and not has_valid_winner and not is_real_draw:
                                continue

                            p1_mname = _sanitize_name(m.get("player1_name"), max_len=100)
                            p1_best = authoritative_names.get(p1_id) or (p1_mname if not _is_placeholder_name(p1_mname, p1_id) else None)
                            s1 = player_states.get(p1_id)
                            if not s1:
                                s1 = {
                                    "name": _sanitize_name(p1_best or p1_mname, max_len=100) or f"Player {p1_id[:8]}",
                                    "elo": self.initial_elo,
                                    "peak_elo": self.initial_elo,
                                    "matches_played": 0, "wins": 0, "losses": 0, "draws": 0,
                                    "last_active_date": None
                                }
                                player_states[p1_id] = s1
                            elif _is_placeholder_name(s1["name"], p1_id) and p1_best:
                                s1["name"] = _sanitize_name(p1_best, max_len=100)

                            p2_mname = _sanitize_name(m.get("player2_name"), max_len=100)
                            p2_best = authoritative_names.get(p2_id) or (p2_mname if not _is_placeholder_name(p2_mname, p2_id) else None)
                            s2 = player_states.get(p2_id)
                            if not s2:
                                s2 = {
                                    "name": _sanitize_name(p2_best or p2_mname, max_len=100) or f"Player {p2_id[:8]}",
                                    "elo": self.initial_elo,
                                    "peak_elo": self.initial_elo,
                                    "matches_played": 0, "wins": 0, "losses": 0, "draws": 0,
                                    "last_active_date": None
                                }
                                player_states[p2_id] = s2
                            elif _is_placeholder_name(s2["name"], p2_id) and p2_best:
                                s2["name"] = _sanitize_name(p2_best, max_len=100)

                            old_elo1 = s1["elo"]
                            old_elo2 = s2["elo"]
                            m_date = m.get("match_date")

                            if m.get("is_bye") or is_real_draw:
                                res1, res2 = ("D", "D") if is_real_draw else ("W", "L")
                                new_elo1, new_elo2 = old_elo1, old_elo2
                            else:
                                is_p1_win = (m.get("winner_id") == p1_id)
                                res1, res2 = ("W", "L") if is_p1_win else ("L", "W")
                                k1 = self.provisional_k if s1["matches_played"] < self.provisional_matches else self.default_k
                                k2 = self.provisional_k if s2["matches_played"] < self.provisional_matches else self.default_k

                                exp1 = self.expected_score(old_elo1, old_elo2)
                                exp2 = 1.0 - exp1
                                act1 = 1.0 if is_p1_win else 0.0
                                act2 = 1.0 - act1

                                new_elo1 = round(old_elo1 + k1 * (act1 - exp1), 2)
                                new_elo2 = round(old_elo2 + k2 * (act2 - exp2), 2)

                            # Update player 1
                            s1["elo"] = new_elo1
                            s1["peak_elo"] = max(s1["peak_elo"], new_elo1)
                            s1["matches_played"] += 1
                            if res1 == "W": s1["wins"] += 1
                            elif res1 == "L": s1["losses"] += 1
                            else: s1["draws"] += 1
                            if m_date: s1["last_active_date"] = _max_date(s1["last_active_date"], m_date)
                            fac1 = _sanitize_name(m.get("player1_faction"), max_len=60)
                            fac2 = _sanitize_name(m.get("player2_faction"), max_len=60)
                            if fac1: player_factions[p1_id][fac1] += 1
                            if fac2: player_factions[p2_id][fac2] += 1

                            # Update player 2
                            s2["elo"] = new_elo2
                            s2["peak_elo"] = max(s2["peak_elo"], new_elo2)
                            s2["matches_played"] += 1
                            if res2 == "W": s2["wins"] += 1
                            elif res2 == "L": s2["losses"] += 1
                            else: s2["draws"] += 1
                            if m_date: s2["last_active_date"] = _max_date(s2["last_active_date"], m_date)

                            # Row 1 (Player 1 perspective)
                            r1_vals = (
                                p1_id, str(m["id"])[:64], str(m.get("event_id") or "")[:64] if m.get("event_id") else None, m.get("round"), m_date,
                                old_elo1, new_elo1, round(new_elo1 - old_elo1, 2),
                                p2_id, _sanitize_name(s2["name"], max_len=100), old_elo2, res1,
                                fac1, fac2,
                                m.get("player1_score"), m.get("player2_score"),
                                sys_target
                            )
                            tsv_buffer.write("\t".join(_format_tsv_field(v) for v in r1_vals) + "\n")

                            # Row 2 (Player 2 perspective)
                            r2_vals = (
                                p2_id, str(m["id"])[:64], str(m.get("event_id") or "")[:64] if m.get("event_id") else None, m.get("round"), m_date,
                                old_elo2, new_elo2, round(new_elo2 - old_elo2, 2),
                                p1_id, _sanitize_name(s1["name"], max_len=100), old_elo1, res2,
                                fac2, fac1,
                                m.get("player2_score"), m.get("player1_score"),
                                sys_target
                            )
                            tsv_buffer.write("\t".join(_format_tsv_field(v) for v in r2_vals) + "\n")
                            history_rows_in_chunk += 2

                        # Write and commit batch immediately to reset transaction buffers
                        tsv_buffer.seek(0)
                        with write_conn.cursor() as write_cur:
                            write_cur.copy_from(tsv_buffer, "rating_history", columns=history_cols, null="\\N")
                        write_conn.commit()
                        tsv_buffer.close()
                        total_history_count += history_rows_in_chunk

                        t_chunk = time.time() - t_chunk_start
                        pct = min(100.0, (processed_matches / total_matches) * 100.0) if total_matches > 0 else 100.0
                        print(f"      📦 [Batch {c_idx}/{num_chunks}] Matches {processed_matches - c_count + 1:,} - {processed_matches:,} ({pct:.1f}%) replayed & committed in {t_chunk:.2f}s.")

                    # Rebuild index and insert ratings
                    with write_conn.cursor() as write_cur:
                        t_idx = time.time()
                        write_cur.execute("CREATE INDEX IF NOT EXISTS idx_pg_history_player ON rating_history(player_id, match_date DESC);")
                        write_conn.commit()

                        # Step 3: Insert player_ratings via COPY
                        print(f"[3/3] 👑 Persisting {len(player_states):,} {sys_target.upper()} player standings & win rates in PostgreSQL...")
                        now_iso = datetime.now(timezone.utc)
                        ratings_cols = (
                            "player_id", "game_system", "player_name", "current_elo", "peak_elo",
                            "matches_played", "wins", "losses", "draws", "win_rate",
                            "top_faction", "team", "last_active_date", "updated_at"
                        )
                        ratings_buf = io.StringIO()
                        for pid, s in player_states.items():
                            total = s["matches_played"]
                            win_rate = round((s["wins"] / total) * 100.0, 1) if total > 0 else 0.0
                            top_fac = _sanitize_top_factions(player_factions[pid], max_factions=5, max_len=200)
                            team_name = _sanitize_team(existing_teams.get(pid), max_len=100)
                            clean_player_name = _sanitize_name(s.get("name"), max_len=100) or f"Player {str(pid)[:8]}"

                            r_vals = (
                                str(pid)[:64], sys_target, clean_player_name, s["elo"], s["peak_elo"],
                                total, s["wins"], s["losses"], s["draws"], win_rate,
                                top_fac, team_name, s["last_active_date"], now_iso
                            )
                            ratings_buf.write("\t".join(_format_tsv_field(v) for v in r_vals) + "\n")

                        ratings_buf.seek(0)
                        write_cur.copy_from(ratings_buf, "player_ratings", columns=ratings_cols, null="\\N")
                        ratings_buf.close()
                        write_conn.commit()

                        # Invalidate caches
                        self.invalidate_caches()
                        if hasattr(self.db, "invalidate_all_caches"):
                            self.db.invalidate_all_caches()
                        elif hasattr(self.db.__class__, "invalidate_all_caches"):
                            self.db.__class__.invalidate_all_caches()

        total_time = time.time() - t0
        top_player = max(player_states.values(), key=lambda x: x["elo"]) if player_states else None

        print("=" * 68)
        print(f" 🎉 {sys_target.upper()} RECONSTRUCTION FINISHED IN {total_time:.2f}s!")
        print(f"    • Total Matches Replayed:   {processed_matches:,}")
        print(f"    • Total Competitors Ranked: {len(player_states):,}")
        print(f"    • Trajectory Points Saved:  {total_history_count:,}")
        if top_player:
            print(f"    • 👑 Current World #1:      {top_player['name']} (Elo: {top_player['elo']:.1f})")
        print("=" * 68 + "\n")

        return {
            "game_system": sys_target,
            "total_players_ranked": len(player_states),
            "total_matches_processed": processed_matches,
            "history_points_saved": total_history_count,
            "elapsed_seconds": round(total_time, 2)
        }


    def get_player_win_path(self, player_id: str, game_system: Optional[str] = "40k", player_name: Optional[str] = None) -> Dict[str, Any]:
        """Returns structured win path, tournament progression, and Elo timeline for a player (instant cached)."""
        cache_key = f"{(game_system or '40k').strip().lower()}:{(player_id or '').strip()}:{(player_name or '').strip().lower()}"
        now = time.time()
        if cache_key in self._player_win_path_cache_dict:
            cached_val, cached_ts = self._player_win_path_cache_dict[cache_key]
            if (now - cached_ts) < 180:
                return cached_val
            self._player_win_path_cache_dict.pop(cache_key, None)

        history = self.db.get_player_history(player_id, game_system=game_system)
        player_info = self.db.search_players(player_id, game_system=game_system)
        player_meta = player_info[0] if player_info else {}

        # If player_id is an event registration ID or temporary ID not directly in player_ratings,
        # resolve canonical player_id and metadata via event_participants or player_name search
        if not player_meta:
            target_sys = (game_system or "40k").strip().lower()
            ep_fallback = None
            try:
                with self.db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("""
                            SELECT ep.player_id, ep.full_name, ep.faction, ep.team
                            FROM event_participants ep
                            LEFT JOIN events e ON ep.event_id = e.id
                            WHERE (ep.player_id = %s OR ep.id::text = %s)
                              AND COALESCE(e.game_system, '40k') = %s
                            ORDER BY e.event_date DESC NULLS LAST
                            LIMIT 1;
                        """, (player_id, player_id, target_sys))
                        ep_row = cur.fetchone()
                        if not ep_row:
                            cur.execute("""
                                SELECT ep.player_id, ep.full_name, ep.faction, ep.team
                                FROM event_participants ep
                                LEFT JOIN events e ON ep.event_id = e.id
                                WHERE (ep.player_id = %s OR ep.id::text = %s)
                                ORDER BY e.event_date DESC NULLS LAST
                                LIMIT 1;
                            """, (player_id, player_id))
                            ep_row = cur.fetchone()
                        if ep_row:
                            ep_fallback = {
                                "player_id": ep_row[0] or player_id,
                                "player_name": ep_row[1],
                                "top_faction": ep_row[2],
                                "team": ep_row[3]
                            }
            except Exception as e:
                logger.debug(f"Fallback event_participants lookup notice: {e}")

            search_name = player_name or (ep_fallback.get("player_name") if ep_fallback else None)
            if search_name and search_name.strip():
                name_matches = self.db.search_players(search_name.strip(), limit=5, game_system=game_system)
                exact_match = next(
                    (m for m in name_matches if str(m.get("player_name") or "").strip().lower() == search_name.strip().lower()),
                    name_matches[0] if name_matches else None
                )
                if exact_match and exact_match.get("player_id"):
                    player_id = str(exact_match["player_id"])
                    player_meta = exact_match
                    history = self.db.get_player_history(player_id, game_system=game_system)
            elif ep_fallback and ep_fallback.get("player_id") and ep_fallback["player_id"] != player_id:
                resolved_id = str(ep_fallback["player_id"])
                id_matches = self.db.search_players(resolved_id, game_system=game_system)
                if id_matches:
                    player_id = resolved_id
                    player_meta = id_matches[0]
                    history = self.db.get_player_history(player_id, game_system=game_system)

            if not player_meta and ep_fallback:
                player_meta = {
                    "player_id": ep_fallback.get("player_id") or player_id,
                    "player_name": ep_fallback.get("player_name") or player_name or "Unknown",
                    "current_elo": self.initial_elo,
                    "peak_elo": self.initial_elo,
                    "matches_played": 0,
                    "wins": 0,
                    "losses": 0,
                    "draws": 0,
                    "win_rate": 0.0,
                    "top_faction": ep_fallback.get("top_faction") or "Unknown",
                    "team": ep_fallback.get("team")
                }
            elif not player_meta and player_name:
                player_meta = {
                    "player_id": player_id,
                    "player_name": player_name,
                    "current_elo": self.initial_elo,
                    "peak_elo": self.initial_elo,
                    "matches_played": 0,
                    "wins": 0,
                    "losses": 0,
                    "draws": 0,
                    "win_rate": 0.0,
                    "top_faction": "Unknown",
                    "team": None
                }

        # Fallback to matches table if rating_history is empty
        if not history:
            raw_matches = self.db.get_player_matches(player_id, game_system=game_system)
            for m in raw_matches:
                is_p1 = (m.get("player1_id") == player_id)
                opp_id = m.get("player2_id") if is_p1 else m.get("player1_id")
                opp_name = m.get("player2_name") if is_p1 else m.get("player1_name")
                opp_fac = m.get("player2_faction") if is_p1 else m.get("player1_faction")
                my_fac = m.get("player1_faction") if is_p1 else m.get("player2_faction")
                my_score = m.get("player1_score") if is_p1 else m.get("player2_score")
                opp_score = m.get("player2_score") if is_p1 else m.get("player1_score")

                is_win = (m.get("winner_id") == player_id)
                is_loss = (m.get("loser_id") == player_id)
                is_draw = bool(m.get("is_draw"))
                res = "W" if is_win else ("L" if is_loss else ("D" if is_draw else "-"))

                history.append({
                    "player_id": player_id,
                    "match_id": m.get("id"),
                    "event_id": m.get("event_id"),
                    "event_name": m.get("event_name"),
                    "round": m.get("round"),
                    "match_date": m.get("match_date"),
                    "old_elo": player_meta.get("current_elo", self.initial_elo),
                    "new_elo": player_meta.get("current_elo", self.initial_elo),
                    "delta_elo": 0.0,
                    "opponent_id": opp_id,
                    "opponent_name": opp_name or ("BYE" if m.get("is_bye") else "Opponent"),
                    "opponent_elo": 1500.0,
                    "result": res,
                    "player_faction": my_fac,
                    "opponent_faction": opp_fac,
                    "player_score": my_score,
                    "opponent_score": opp_score
                })

        current_streak = 0
        max_streak = 0
        for h in history:
            if h.get("result") == "W":
                current_streak += 1
                max_streak = max(max_streak, current_streak)
            elif h.get("result") == "L":
                current_streak = 0

        # Form trajectory array: [ {round_idx, elo, date, opponent, result, delta} ]
        trajectory = []
        for idx, h in enumerate(history, 1):
            m_date = h.get("match_date")
            date_str = m_date.strftime("%Y-%m-%d") if isinstance(m_date, datetime) else (str(m_date)[:10] if m_date else "")
            trajectory.append({
                "match_index": idx,
                "elo": h.get("new_elo") or player_meta.get("current_elo", self.initial_elo),
                "delta": h.get("delta_elo", 0.0),
                "date": date_str,
                "event": h.get("event_name"),
                "opponent": h.get("opponent_name"),
                "opponent_elo": h.get("opponent_elo"),
                "result": h.get("result"),
                "score": f"{h.get('player_score') or 0}-{h.get('opponent_score') or 0}",
                "faction": h.get("player_faction"),
                "opponent_faction": h.get("opponent_faction")
            })

        # Collect all factions played with their counts
        player_fac_counts = collections.Counter()
        for h in history:
            fac = h.get("player_faction")
            if fac:
                player_fac_counts[fac] += 1
        factions_breakdown = [{"faction": f, "matches": c} for f, c in player_fac_counts.most_common() if f]

        # Collect distinct teams for this player ordered by recency
        all_teams_list = []
        target_sys = (game_system or "40k").strip().lower()
        try:
            with self.db.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                    SELECT DISTINCT TRIM(ep.team) as team_name, MAX(e.event_date) as last_seen
                    FROM event_participants ep
                    LEFT JOIN events e ON ep.event_id = e.id
                    WHERE ep.player_id = %s AND ep.team IS NOT NULL AND TRIM(ep.team) != '' 
                      AND LOWER(TRIM(ep.team)) NOT IN ('none', 'n/a', 'unaligned', 'unaffiliated', 'no team', 'null', 'unknown', '-')
                      AND COALESCE(e.game_system, '40k') = %s
                    GROUP BY TRIM(ep.team)
                    ORDER BY last_seen DESC NULLS LAST;
                    """, (player_id, target_sys))
                    all_teams_list = [r[0] for r in cur.fetchall() if r[0]]
        except Exception as e:
            logger.debug(f"Error fetching team history for {player_id}: {e}")

        # Current/Latest team is the first one in recency order
        latest_team = all_teams_list[0] if all_teams_list else (player_meta.get("team") or None)
        all_teams_str = ", ".join(all_teams_list) if all_teams_list else (latest_team or "")

        tournaments_list = self.db.get_player_tournaments(player_id, game_system=game_system) if hasattr(self.db, "get_player_tournaments") else []

        res = {
            "player_id": player_id,
            "player_name": player_meta.get("player_name") or player_meta.get("full_name") or (history[0].get("opponent_name") if history else "Unknown"),
            "current_elo": player_meta.get("current_elo", self.initial_elo),
            "peak_elo": player_meta.get("peak_elo", self.initial_elo),
            "total_matches": player_meta.get("matches_played", len(history)),
            "wins": player_meta.get("wins", 0),
            "losses": player_meta.get("losses", 0),
            "draws": player_meta.get("draws", 0),
            "win_rate": player_meta.get("win_rate", 0.0),
            "top_faction": player_meta.get("top_faction"),
            "team": latest_team,
            "all_teams": all_teams_str,
            "teams_history": all_teams_list,
            "factions_breakdown": factions_breakdown,
            "longest_win_streak": max_streak,
            "history": history,
            "win_path": history,
            "trajectory": trajectory,
            "tournaments": tournaments_list,
            "events_attended": tournaments_list,
            "player": {
                **player_meta,
                "team": latest_team,
                "all_teams": all_teams_str,
                "teams_history": all_teams_list
            }
        }
        if len(self._player_win_path_cache_dict) > 1000:
            self._player_win_path_cache_dict.clear()
        self._player_win_path_cache_dict[cache_key] = (res, time.time())
        return res


_elo_engine_instance = None

def get_elo_engine(db: Optional[Database] = None) -> EloEngine:
    """Returns the singleton EloEngine instance."""
    global _elo_engine_instance
    if _elo_engine_instance is None:
        _elo_engine_instance = EloEngine(db=db)
    elif db is not None:
        _elo_engine_instance.db = db
    return _elo_engine_instance
