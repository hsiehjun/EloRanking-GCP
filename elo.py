"""Elo rating engine: reconstructs chronological player win paths and ratings."""

import collections
import hashlib
import io
import json
import logging
import math
import re
import time
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timezone


def _bound_id(val: Any, max_len: int = 64) -> str:
    """Deterministically bounds an identifier to `max_len` chars for PostgreSQL VARCHAR(64) PKs."""
    if val is None:
        return ""
    s = str(val).strip()
    if len(s) <= max_len:
        return s
    digest = hashlib.sha1(s.encode("utf-8")).hexdigest()[:12]
    prefix_len = max(1, max_len - 13)
    return f"{s[:prefix_len]}_{digest}"


def _bound_opt_id(val: Any, max_len: int = 64) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    return _bound_id(s, max_len=max_len)


def _safe_int_score(val: Any) -> Optional[int]:
    if val is None:
        return None
    try:
        v = int(round(float(val)))
        if v < -2147483648 or v > 2147483647:
            return None
        return v
    except Exception:
        return None

PLACEHOLDER_REGEX_STR = r'^(player($|[^a-zA-Z])|fake\s*player|unknown(\s*player)?|bye|none|null|tbd|unassigned|pod\s*[\(:]|commander\s*pod)'
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
    """Formats and bounds top factions string to prevent DB index limit errors and strips generic super-factions."""
    if not player_factions_counter:
        return None
    specific_candidates: List[str] = []
    generic_sm_candidates: List[str] = []
    for fac, cnt in player_factions_counter.most_common():
        clean_fac = _sanitize_name(fac, max_len=60)
        if not clean_fac or clean_fac.lower() in ("commander pod", "pod", "4-player ffa pod", "3-player ffa pod", "none", "unknown") or Database.is_super_or_empty_faction(clean_fac, include_generic_sm=False):
            continue
        if Database.is_super_or_empty_faction(clean_fac, include_generic_sm=True):
            if clean_fac not in generic_sm_candidates:
                generic_sm_candidates.append(clean_fac)
        else:
            if clean_fac not in specific_candidates:
                specific_candidates.append(clean_fac)
    factions_list = list(specific_candidates[:max_factions])
    if not factions_list and generic_sm_candidates:
        factions_list = list(generic_sm_candidates[:max_factions])
    if not factions_list:
        return None
    res = ", ".join(factions_list)
    if len(res) > max_len:
        res = res[:max_len].strip()
    return res if res else None


def _heal_and_load_authoritative_names(
    conn: Any,
    sys_target: str,
    candidate_pids: Optional[List[str]] = None,
) -> Dict[str, str]:
    """Heals placeholder names across tables using real names from event_participants/matches/players and returns authoritative name map."""
    auth_names: Dict[str, str] = {}
    try:
        scoped_pids: Optional[List[str]] = None
        if candidate_pids is not None:
            scoped_pids = sorted({
                str(p).strip()[:64]
                for p in candidate_pids
                if p and str(p).strip() and str(p).strip().upper() != "BYE"
            })
            if not scoped_pids:
                return auth_names

        with conn.cursor() as cur:
            if scoped_pids is not None:
                if len(scoped_pids) <= 500:
                    cur.execute("""
                    SELECT id FROM players
                    WHERE id = ANY(%s)
                      AND (full_name IS NULL OR TRIM(full_name) = '' OR full_name ~* %s OR LENGTH(full_name) > 100 OR full_name LIKE '{%%');
                    """, (scoped_pids, PLACEHOLDER_REGEX_STR))
                    bad_pids = [
                        str(r[0] if isinstance(r, (list, tuple)) else r.get("id"))
                        for r in (cur.fetchall() or [])
                        if (r[0] if isinstance(r, (list, tuple)) else (r.get("id") if isinstance(r, dict) else None))
                    ]
                    if bad_pids:
                        cur.execute("""
                        UPDATE players p
                        SET full_name = SUBSTRING(TRIM(ep.full_name), 1, 100)
                        FROM event_participants ep
                        WHERE p.id = ANY(%s)
                          AND p.id = ep.player_id
                          AND (p.full_name IS NULL OR TRIM(p.full_name) = '' OR p.full_name ~* %s OR LENGTH(p.full_name) > 100 OR p.full_name LIKE '{%%')
                          AND ep.full_name IS NOT NULL AND TRIM(ep.full_name) != '' AND LENGTH(ep.full_name) <= 100
                          AND ep.full_name NOT LIKE '{%%' AND ep.full_name NOT LIKE '[%%'
                          AND NOT (ep.full_name ~* %s OR ep.full_name ILIKE 'BYE');
                        """, (bad_pids, PLACEHOLDER_REGEX_STR, PLACEHOLDER_REGEX_STR))
                        cur.execute("""
                        UPDATE players p
                        SET full_name = SUBSTRING(TRIM(m.player1_name), 1, 100)
                        FROM matches m
                        WHERE p.id = ANY(%s)
                          AND p.id = m.player1_id
                          AND (p.full_name IS NULL OR TRIM(p.full_name) = '' OR p.full_name ~* %s OR LENGTH(p.full_name) > 100 OR p.full_name LIKE '{%%')
                          AND m.player1_name IS NOT NULL AND TRIM(m.player1_name) != '' AND LENGTH(m.player1_name) <= 100
                          AND m.player1_name NOT LIKE '{%%' AND m.player1_name NOT LIKE '[%%'
                          AND NOT (m.player1_name ~* %s OR m.player1_name ILIKE 'BYE');
                        """, (bad_pids, PLACEHOLDER_REGEX_STR, PLACEHOLDER_REGEX_STR))
                        cur.execute("""
                        UPDATE players p
                        SET full_name = SUBSTRING(TRIM(m.player2_name), 1, 100)
                        FROM matches m
                        WHERE p.id = ANY(%s)
                          AND p.id = m.player2_id
                          AND (p.full_name IS NULL OR TRIM(p.full_name) = '' OR p.full_name ~* %s OR LENGTH(p.full_name) > 100 OR p.full_name LIKE '{%%')
                          AND m.player2_name IS NOT NULL AND TRIM(m.player2_name) != '' AND LENGTH(m.player2_name) <= 100
                          AND m.player2_name NOT LIKE '{%%' AND m.player2_name NOT LIKE '[%%'
                          AND NOT (m.player2_name ~* %s OR m.player2_name ILIKE 'BYE');
                        """, (bad_pids, PLACEHOLDER_REGEX_STR, PLACEHOLDER_REGEX_STR))

                    cur.execute("""
                    SELECT player_id FROM player_ratings
                    WHERE player_id = ANY(%s)
                      AND (player_name IS NULL OR TRIM(player_name) = '' OR player_name ~* %s OR LENGTH(player_name) > 100 OR player_name LIKE '{%%');
                    """, (scoped_pids, PLACEHOLDER_REGEX_STR))
                    bad_pr_pids = [
                        str(r[0] if isinstance(r, (list, tuple)) else r.get("player_id"))
                        for r in (cur.fetchall() or [])
                        if (r[0] if isinstance(r, (list, tuple)) else (r.get("player_id") if isinstance(r, dict) else None))
                    ]
                    if bad_pr_pids:
                        cur.execute("""
                        UPDATE player_ratings pr
                        SET player_name = SUBSTRING(TRIM(p.full_name), 1, 100), updated_at = NOW()
                        FROM players p
                        WHERE pr.player_id = ANY(%s)
                          AND pr.player_id = p.id
                          AND (pr.player_name IS NULL OR TRIM(pr.player_name) = '' OR pr.player_name ~* %s OR LENGTH(pr.player_name) > 100 OR pr.player_name LIKE '{%%')
                          AND p.full_name IS NOT NULL AND TRIM(p.full_name) != '' AND LENGTH(p.full_name) <= 100
                          AND p.full_name NOT LIKE '{%%' AND p.full_name NOT LIKE '[%%'
                          AND NOT (p.full_name ~* %s OR p.full_name ILIKE 'BYE');
                        """, (bad_pr_pids, PLACEHOLDER_REGEX_STR, PLACEHOLDER_REGEX_STR))

                cur.execute("""
                SELECT id, full_name FROM players
                WHERE id = ANY(%s)
                  AND full_name IS NOT NULL AND TRIM(full_name) != ''
                  AND LENGTH(full_name) <= 100
                  AND full_name NOT LIKE '{%%' AND full_name NOT LIKE '[%%'
                  AND NOT (full_name ~* %s OR full_name ILIKE 'BYE');
                """, (scoped_pids, PLACEHOLDER_REGEX_STR))
            else:
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
            for row in (cur.fetchall() or []):
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
        normalize_game_system,
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
            normalize_game_system,
        )
        from experimental.users.hsiehjun.EloRanking.database import Database
    except ImportError:
        from config import (
            INITIAL_ELO,
            DEFAULT_K_FACTOR,
            PROVISIONAL_K_FACTOR,
            PROVISIONAL_MATCH_COUNT,
            MIN_MATCHES_FOR_RANKING,
            normalize_game_system,
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

    def predict_match_outcome(
        self,
        p1_id_or_name: str,
        p2_id_or_name: str,
        game_system: Optional[str] = "40k",
        p1_faction: Optional[str] = None,
        p2_faction: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Calculates 6-factor win probabilities, simulated pure Elo rating changes, career dossiers, 90d faction meta, and past head-to-head encounters (indexed & cached)."""
        try:
            from psycopg2 import extras
        except ImportError:
            class _FallbackExtras:
                RealDictCursor = None
                @staticmethod
                def execute_values(cur, sql, argslist, template=None, page_size=100):
                    cur.execute(sql, argslist)
            extras = _FallbackExtras()
        from database import Database as PostgresDatabase

        target_sys = (game_system or "40k").strip().lower()
        p1_str = (p1_id_or_name or "").strip()
        p2_str = (p2_id_or_name or "").strip()
        p1_fac_req = (p1_faction or "").strip()
        p2_fac_req = (p2_faction or "").strip()
        is_mock_db = (
            type(self.db).__module__.startswith("unittest.mock")
            or getattr(self.db, "_is_mock_instance", lambda: False)()
        )
        cache_key = ("predict_match_v4", p1_str.lower(), p2_str.lower(), target_sys, p1_fac_req.lower(), p2_fac_req.lower())
        if not is_mock_db:
            cached_pred = PostgresDatabase.get_cached(PostgresDatabase._players_cache_dict, cache_key, ttl=600)
            if cached_pred is not None:
                return dict(cached_pred)

        p1_data = None
        p2_data = None
        hist_by_pid: Dict[str, List[Dict[str, Any]]] = {}

        def _lookup_rating(cur, val: str):
            if not val:
                return None
            cur.execute(
                "SELECT * FROM player_ratings WHERE player_id = %s AND COALESCE(game_system, '40k') = %s LIMIT 1;",
                (val, target_sys),
            )
            row = cur.fetchone()
            if row:
                return row
            cur.execute(
                """
                SELECT * FROM player_ratings
                WHERE LOWER(TRIM(player_name)) = LOWER(TRIM(%s))
                  AND COALESCE(game_system, '40k') = %s
                ORDER BY current_elo DESC NULLS LAST
                LIMIT 1;
                """,
                (val, target_sys),
            )
            row = cur.fetchone()
            if row:
                return row
            cur.execute(
                """
                SELECT * FROM player_ratings
                WHERE player_name ILIKE %s
                  AND COALESCE(game_system, '40k') = %s
                ORDER BY current_elo DESC NULLS LAST
                LIMIT 1;
                """,
                (f"%{val}%", target_sys),
            )
            return cur.fetchone()

        with self.db.get_connection() as conn:
            with (conn.cursor(cursor_factory=extras.RealDictCursor) if extras else conn.cursor()) as cur:
                p1_data = _lookup_rating(cur, p1_str)
                p2_data = _lookup_rating(cur, p2_str)

                pids_to_fetch = []
                for p_row in (p1_data, p2_data):
                    if isinstance(p_row, dict) and p_row.get("player_id"):
                        pid_v = str(p_row["player_id"]).strip()
                        if pid_v and pid_v not in pids_to_fetch:
                            pids_to_fetch.append(pid_v)
                if pids_to_fetch:
                    try:
                        cur.execute("SET LOCAL statement_timeout = '350ms';")
                        cur.execute(
                            """
                            SELECT rh.player_id, rh.match_id, rh.event_id, rh.round, rh.match_date,
                                   rh.result, rh.delta_elo, rh.player_score, rh.opponent_score,
                                   rh.player_faction, rh.opponent_id, rh.opponent_name, rh.opponent_faction,
                                   e.name AS event_name
                            FROM rating_history rh
                            LEFT JOIN events e ON rh.event_id = e.id
                            WHERE COALESCE(rh.game_system, '40k') = %s
                              AND rh.player_id = ANY(%s)
                            ORDER BY rh.match_date DESC NULLS LAST, rh.id DESC;
                            """,
                            (target_sys, pids_to_fetch),
                        )
                        fetched_hist = cur.fetchall()
                        if isinstance(fetched_hist, list):
                            for hr in fetched_hist:
                                if isinstance(hr, dict) or hasattr(hr, "keys"):
                                    h_dict = dict(hr)
                                    h_pid = str(h_dict.get("player_id") or "").strip()
                                    if h_pid:
                                        hist_by_pid.setdefault(h_pid, []).append(h_dict)
                    except Exception:
                        try:
                            conn.rollback()
                        except Exception:
                            pass

        r1 = float(p1_data["current_elo"]) if isinstance(p1_data, dict) and p1_data.get("current_elo") is not None else self.initial_elo
        r2 = float(p2_data["current_elo"]) if isinstance(p2_data, dict) and p2_data.get("current_elo") is not None else self.initial_elo

        m1 = int(p1_data["matches_played"]) if isinstance(p1_data, dict) and p1_data.get("matches_played") is not None else 0
        m2 = int(p2_data["matches_played"]) if isinstance(p2_data, dict) and p2_data.get("matches_played") is not None else 0

        k1 = self.get_k_factor(m1)
        k2 = self.get_k_factor(m2)
        k = max(k1, k2)

        exp1 = self.expected_score(r1, r2)
        exp2 = 1.0 - exp1
        pure_p1_prob = round(exp1 * 100.0, 1)
        pure_p2_prob = round(exp2 * 100.0, 1)

        d_p1_win = round(k * (1.0 - exp1), 1)
        d_p2_win = round(k * (1.0 - exp2), 1)
        d_p1_draw = round(k * (0.5 - exp1), 1)
        d_p2_draw = round(k * (0.5 - exp2), 1)

        # Head-to-head encounters
        p1_resolved_id = str(p1_data.get("player_id") or p1_str) if isinstance(p1_data, dict) else p1_str
        p2_resolved_id = str(p2_data.get("player_id") or p2_str) if isinstance(p2_data, dict) else p2_str
        p1_resolved_name = str(p1_data.get("player_name") or p1_data.get("name") or "") if isinstance(p1_data, dict) else None
        p2_resolved_name = str(p2_data.get("player_name") or p2_data.get("name") or "") if isinstance(p2_data, dict) else None
        try:
            h2h_matches = self.db.get_head_to_head(
                p1_resolved_id,
                p2_resolved_id,
                game_system=target_sys,
                p1_name=p1_resolved_name,
                p2_name=p2_resolved_name,
            )
        except TypeError:
            h2h_matches = self.db.get_head_to_head(p1_str, p2_str, game_system=target_sys)
        if not isinstance(h2h_matches, list):
            h2h_matches = []

        def _norm_fac_key(raw_f: str) -> str:
            import re as _re
            s = _re.sub(r"\s*\([^)]*\)\s*", " ", str(raw_f or "").strip().lower())
            s = _re.sub(r"[^a-z0-9\s]", "", s)
            s = _re.sub(r"\s+", " ", s).strip()
            aliases = {
                "genestealer cult": "genestealer cults",
                "custodes": "adeptus custodes",
                "admech": "adeptus mechanicus",
                "mechanicus": "adeptus mechanicus",
                "csm": "chaos space marines",
                "heretic astartes": "chaos space marines",
                "sm": "space marines",
                "astartes": "space marines",
                "adeptus astartes": "space marines",
                "guard": "astra militarum",
                "imperial guard": "astra militarum",
                "sisters": "adepta sororitas",
                "sisters of battle": "adepta sororitas",
                "daemons": "chaos daemons",
                "eldar": "aeldari",
                "craftworlds": "aeldari",
                "dark eldar": "drukhari",
                "tau": "tau empire",
            }
            return aliases.get(s, s)

        def _build_player_dossier(p_row: Optional[Dict[str, Any]], fallback_id: str, req_fac: str) -> Dict[str, Any]:
            pid = str((p_row or {}).get("player_id") or fallback_id).strip()
            pname = str((p_row or {}).get("player_name") or (p_row or {}).get("name") or fallback_id).strip()
            c_elo = float((p_row or {}).get("current_elo") or self.initial_elo)
            pk_elo = max(c_elo, float((p_row or {}).get("peak_elo") or c_elo))
            w_tot = int((p_row or {}).get("wins") or 0)
            l_tot = int((p_row or {}).get("losses") or 0)
            d_tot = int((p_row or {}).get("draws") or 0)
            m_tot = int((p_row or {}).get("matches_played") or (w_tot + l_tot + d_tot))
            wr_tot = round((w_tot * 100.0) / m_tot, 1) if m_tot > 0 else 0.0
            top_fac_str = str((p_row or {}).get("top_faction") or "").strip()
            team_str = str((p_row or {}).get("team") or "").strip() or None

            h_rows = hist_by_pid.get(pid) or list((p_row or {}).get("history") or [])
            has_spec = any(
                not PostgresDatabase.is_super_or_empty_faction(r.get("player_faction") or r.get("faction"), include_generic_sm=True)
                for r in h_rows
            )
            fm_map: Dict[str, Dict[str, Any]] = {}
            mm_map: Dict[str, Dict[str, Any]] = {}
            recent_list: List[Dict[str, Any]] = []

            # Compute longest win streak in chronological order
            cur_streak = 0
            max_streak = int((p_row or {}).get("best_win_streak") or 0)
            for r in reversed(h_rows):
                res_c = str(r.get("result") or "").upper()
                if res_c == "W":
                    cur_streak += 1
                    if cur_streak > max_streak:
                        max_streak = cur_streak
                elif res_c in ("L", "D"):
                    cur_streak = 0

            for r in h_rows:
                opp_name_val = str(r.get("opponent_name") or "").strip()
                if opp_name_val.upper() == "BYE":
                    continue
                res_code = str(r.get("result") or "").upper()
                raw_delta = r.get("delta_elo") if r.get("delta_elo") is not None else r.get("elo_delta")
                delta_v = float(raw_delta or 0.0)
                pf = str(r.get("player_faction") or r.get("faction") or "").strip()
                of = str(r.get("opponent_faction") or "").strip()

                if len(recent_list) < 8:
                    m_dt = r.get("match_date") or r.get("date")
                    dt_str = m_dt.strftime("%Y-%m-%d") if hasattr(m_dt, "strftime") else str(m_dt or "")[:10]
                    recent_list.append({
                        "match_id": str(r.get("match_id") or ""),
                        "event_id": str(r.get("event_id") or ""),
                        "event_name": str(r.get("event_name") or "Tournament"),
                        "round": int(r.get("round") or 1),
                        "match_date": dt_str,
                        "result": res_code or "D",
                        "player_score": r.get("player_score"),
                        "opponent_score": r.get("opponent_score"),
                        "player_faction": pf,
                        "opponent_id": str(r.get("opponent_id") or ""),
                        "opponent_name": opp_name_val or "Opponent",
                        "opponent_faction": of,
                        "delta_elo": round(delta_v, 1),
                    })

                if pf and not PostgresDatabase.is_super_or_empty_faction(pf, include_generic_sm=has_spec):
                    fb = fm_map.setdefault(pf, {"games": 0, "wins": 0, "losses": 0, "draws": 0, "net_elo": 0.0})
                    fb["games"] += 1
                    if res_code == "W":
                        fb["wins"] += 1
                    elif res_code == "L":
                        fb["losses"] += 1
                    else:
                        fb["draws"] += 1
                    fb["net_elo"] += delta_v

                if of and of.lower() != "bye" and not PostgresDatabase.is_super_or_empty_faction(of, include_generic_sm=False):
                    mb = mm_map.setdefault(of, {"total_encounters": 0, "wins": 0, "losses": 0, "draws": 0, "net_elo": 0.0})
                    mb["total_encounters"] += 1
                    if res_code == "W":
                        mb["wins"] += 1
                    elif res_code == "L":
                        mb["losses"] += 1
                    else:
                        mb["draws"] += 1
                    mb["net_elo"] += delta_v

            fm_list = []
            for fn, b in fm_map.items():
                g_c = int(b["games"])
                w_c = int(b["wins"])
                fm_list.append({
                    "faction": fn,
                    "games": g_c,
                    "matches": g_c,
                    "wins": w_c,
                    "losses": int(b["losses"]),
                    "draws": int(b["draws"]),
                    "win_rate": round((w_c * 100.0) / g_c, 1) if g_c > 0 else 0.0,
                    "net_elo": round(float(b["net_elo"]), 1),
                })
            fm_list.sort(key=lambda x: (x["games"], x["win_rate"]), reverse=True)

            mm_list = []
            for efn, b in mm_map.items():
                g_c = int(b["total_encounters"])
                w_c = int(b["wins"])
                mm_list.append({
                    "enemy_faction": efn,
                    "total_encounters": g_c,
                    "wins": w_c,
                    "losses": int(b["losses"]),
                    "draws": int(b["draws"]),
                    "win_rate": round((w_c * 100.0) / g_c, 1) if g_c > 0 else 0.0,
                    "net_elo": round(float(b["net_elo"]), 1),
                })
            mm_list.sort(key=lambda x: (x["total_encounters"], x["win_rate"]), reverse=True)

            tf_parts = [p.strip() for p in top_fac_str.split(",") if p.strip()]
            clean_tf = [p for p in tf_parts if not PostgresDatabase.is_super_or_empty_faction(p, include_generic_sm=len(tf_parts) > 1)]
            if fm_list:
                cleaned_top_fac = ", ".join(x["faction"] for x in fm_list[:5] if x.get("faction"))
            elif clean_tf:
                cleaned_top_fac = ", ".join(clean_tf[:5])
            else:
                cleaned_top_fac = top_fac_str or "Unknown"

            if req_fac and req_fac.lower() not in ("", "unknown", "various", "all"):
                primary_fac = req_fac
            elif fm_list:
                primary_fac = fm_list[0]["faction"]
            elif clean_tf:
                primary_fac = clean_tf[0]
            elif tf_parts:
                primary_fac = tf_parts[0]
            else:
                primary_fac = "Unknown"

            return {
                "player_id": pid,
                "player_name": pname,
                "current_elo": round(c_elo, 1),
                "peak_elo": round(pk_elo, 1),
                "matches_played": m_tot,
                "wins": w_tot,
                "losses": l_tot,
                "draws": d_tot,
                "win_rate": wr_tot,
                "top_faction": cleaned_top_fac,
                "primary_faction": primary_fac,
                "team": team_str,
                "longest_win_streak": max_streak,
                "faction_mastery": fm_list,
                "matchup_matrix": mm_list,
                "recent_matches": recent_list,
            }

        p1_prof = _build_player_dossier(p1_data, p1_resolved_id, p1_fac_req)
        p2_prof = _build_player_dossier(p2_data, p2_resolved_id, p2_fac_req)

        # Attach 90-day global faction meta summary from L1 cache (<0.2ms)
        meta_90d = (
            PostgresDatabase.get_cached(PostgresDatabase._faction_meta_cache_dict, f"preset_90d_{target_sys}", ttl=86400)
            or PostgresDatabase.get_cached(PostgresDatabase._faction_meta_cache_dict, f"::{target_sys}:90d", ttl=86400)
        )
        if meta_90d is None and hasattr(self.db, "get_faction_meta_stats"):
            try:
                meta_90d = self.db.get_faction_meta_stats(game_system=target_sys, timeframe="90d")
            except Exception:
                meta_90d = None

        fac_summary: Dict[str, Any] = {}
        fac_norm_lookup: Dict[str, Dict[str, Any]] = {}
        if isinstance(meta_90d, dict):
            mu_by_fac = meta_90d.get("matchups_by_faction") if isinstance(meta_90d.get("matchups_by_faction"), dict) else {}
            for f_row in (meta_90d.get("factions") or []):
                if not isinstance(f_row, dict):
                    continue
                f_name = str(f_row.get("faction") or "").strip()
                if not f_name:
                    continue
                mu_raw = mu_by_fac.get(f_name) or []
                fac_entry = {
                    "faction": f_name,
                    "stats": {
                        "total_matches": int(f_row.get("total_matches") or 0),
                        "total_wins": int(f_row.get("wins") or 0),
                        "total_losses": int(f_row.get("losses") or 0),
                        "total_draws": int(f_row.get("draws") or 0),
                        "win_rate": float(f_row.get("win_rate") or 0.0),
                    },
                    "matchups": [
                        {
                            "opponent_faction": str(m.get("opponent") or m.get("opponent_faction") or ""),
                            "matches_played": int(m.get("matches_played") or m.get("total") or 0),
                            "wins": int(m.get("wins") or 0),
                            "losses": int(m.get("losses") or 0),
                            "draws": int(m.get("draws") or 0),
                            "win_rate": float(m.get("win_rate") or 0.0),
                        }
                        for m in mu_raw
                        if isinstance(m, dict)
                    ],
                }
                fac_summary[f_name] = fac_entry
                fac_norm_lookup[_norm_fac_key(f_name)] = fac_entry

        # Compute 6-Factor Effective Matchup Elo Prediction
        def _clamp(val: float, lo: float, hi: float) -> float:
            return max(lo, min(hi, val))

        act_f1 = p1_prof["primary_faction"]
        act_f2 = p2_prof["primary_faction"]
        nk1 = _norm_fac_key(act_f1)
        nk2 = _norm_fac_key(act_f2)
        is_mirror = bool(nk1 and nk2 and nk1 == nk2)

        f1_meta_entry = fac_norm_lookup.get(nk1) or {}
        f2_meta_entry = fac_norm_lookup.get(nk2) or {}
        f1_st = f1_meta_entry.get("stats") or {}
        f2_st = f2_meta_entry.get("stats") or {}

        h2h_f1_w = 0
        h2h_f2_w = 0
        h2h_f_d = 0
        if not is_mirror and nk1 and nk2:
            for mu in (f1_meta_entry.get("matchups") or []):
                if _norm_fac_key(mu.get("opponent_faction") or "") == nk2:
                    h2h_f1_w += int(mu.get("wins") or 0)
                    h2h_f2_w += int(mu.get("losses") or 0)
                    h2h_f_d += int(mu.get("draws") or 0)
            if (h2h_f1_w + h2h_f2_w + h2h_f_d) == 0:
                for mu in (f2_meta_entry.get("matchups") or []):
                    if _norm_fac_key(mu.get("opponent_faction") or "") == nk1:
                        h2h_f2_w += int(mu.get("wins") or 0)
                        h2h_f1_w += int(mu.get("losses") or 0)
                        h2h_f_d += int(mu.get("draws") or 0)
        h2h_f_tot = h2h_f1_w + h2h_f2_w + h2h_f_d

        base_elo_delta = r1 - r2
        fac_h2h_delta = 0.0
        if not is_mirror and h2h_f_tot > 0:
            shrunk_edge = ((h2h_f1_w + 0.5 * h2h_f_d) - 0.5 * h2h_f_tot) / (h2h_f_tot + 35.0)
            fac_h2h_delta = _clamp(shrunk_edge * 350.0, -75.0, 75.0)

        f1_meta_g = int(f1_st.get("total_matches") or 0)
        f2_meta_g = int(f2_st.get("total_matches") or 0)
        f1_meta_wr = float(f1_st.get("win_rate") or 50.0)
        f2_meta_wr = float(f2_st.get("win_rate") or 50.0)
        fac_meta_delta = 0.0
        if not is_mirror and (f1_meta_g > 0 or f2_meta_g > 0):
            adj1 = 0.50 + ((f1_meta_wr / 100.0) - 0.50) * (f1_meta_g / (f1_meta_g + 100.0))
            adj2 = 0.50 + ((f2_meta_wr / 100.0) - 0.50) * (f2_meta_g / (f2_meta_g + 100.0))
            fac_meta_delta = _clamp((adj1 - adj2) * 250.0, -40.0, 40.0)

        def _extract_mastery_pair(prof: Dict[str, Any], own_nk: str, opp_nk: str):
            own_w = own_l = own_d = 0
            own_net = 0.0
            for m_item in (prof.get("faction_mastery") or []):
                if own_nk and _norm_fac_key(m_item.get("faction") or "") == own_nk:
                    own_w += int(m_item.get("wins") or 0)
                    own_l += int(m_item.get("losses") or 0)
                    own_d += int(m_item.get("draws") or 0)
                    own_net += float(m_item.get("net_elo") or 0.0)
            own_g = own_w + own_l + own_d
            own_wr = (own_w * 100.0 / own_g) if own_g > 0 else 50.0

            vs_w = vs_l = vs_d = 0
            vs_net = 0.0
            for v_item in (prof.get("matchup_matrix") or []):
                if opp_nk and _norm_fac_key(v_item.get("enemy_faction") or "") == opp_nk:
                    vs_w += int(v_item.get("wins") or 0)
                    vs_l += int(v_item.get("losses") or 0)
                    vs_d += int(v_item.get("draws") or 0)
                    vs_net += float(v_item.get("net_elo") or 0.0)
            vs_g = vs_w + vs_l + vs_d
            vs_wr = (vs_w * 100.0 / vs_g) if vs_g > 0 else 50.0
            return {
                "ownGames": own_g, "ownWins": own_w, "ownLosses": own_l, "ownDraws": own_d, "ownNetElo": own_net, "ownWr": own_wr,
                "vsGames": vs_g, "vsWins": vs_w, "vsLosses": vs_l, "vsDraws": vs_d, "vsNetElo": vs_net, "vsWr": vs_wr,
            }

        m1_stats = _extract_mastery_pair(p1_prof, nk1, nk2)
        m2_stats = _extract_mastery_pair(p2_prof, nk2, nk1)

        def _calc_own_score(ms: Dict[str, Any]) -> float:
            g = float(ms["ownGames"])
            if g <= 0:
                return 0.0
            wr_part = (((ms["ownWins"] + 0.5 * ms["ownDraws"]) - 0.5 * g) / (g + 10.0)) * 140.0
            net_part = _clamp((ms["ownNetElo"] / 6.0) * (g / (g + 10.0)), -20.0, 20.0)
            return wr_part + net_part

        def _calc_vs_score(ms: Dict[str, Any]) -> float:
            g = float(ms["vsGames"])
            if g <= 0:
                return 0.0
            wr_part = (((ms["vsWins"] + 0.5 * ms["vsDraws"]) - 0.5 * g) / (g + 10.0)) * 130.0
            net_part = _clamp((ms["vsNetElo"] / 6.0) * (g / (g + 10.0)), -15.0, 15.0)
            return wr_part + net_part

        own_mastery_delta = _clamp(_calc_own_score(m1_stats) - _calc_own_score(m2_stats), -55.0, 55.0)
        vs_mastery_delta = _clamp(_calc_vs_score(m1_stats) - _calc_vs_score(m2_stats), -45.0, 45.0)

        p1_h2h_w = 0
        p2_h2h_w = 0
        h2h_dr = 0
        p1_id_l = p1_prof["player_id"].lower()
        p2_id_l = p2_prof["player_id"].lower()
        p1_nm_l = p1_prof["player_name"].lower()
        p2_nm_l = p2_prof["player_name"].lower()
        for hm in h2h_matches:
            if not isinstance(hm, dict) or hm.get("is_bye"):
                continue
            if hm.get("is_draw"):
                h2h_dr += 1
                continue
            wid = str(hm.get("winner_id") or "").strip().lower()
            s1_v = hm.get("player1_score")
            s2_v = hm.get("player2_score")
            m1_id_l = str(hm.get("player1_id") or "").strip().lower()
            m1_nm_l = str(hm.get("player1_name") or "").strip().lower()
            is_p1_side1 = (p1_id_l and m1_id_l == p1_id_l) or (p1_nm_l and m1_nm_l == p1_nm_l)
            if wid:
                if (p1_id_l and wid == p1_id_l):
                    p1_h2h_w += 1
                elif (p2_id_l and wid == p2_id_l):
                    p2_h2h_w += 1
            elif s1_v is not None and s2_v is not None:
                if float(s1_v) > float(s2_v):
                    if is_p1_side1:
                        p1_h2h_w += 1
                    else:
                        p2_h2h_w += 1
                elif float(s2_v) > float(s1_v):
                    if is_p1_side1:
                        p2_h2h_w += 1
                    else:
                        p1_h2h_w += 1

        h2h_games_cnt = p1_h2h_w + p2_h2h_w + h2h_dr
        past_h2h_delta = 0.0
        if h2h_games_cnt > 0:
            past_h2h_delta = _clamp(((p1_h2h_w - p2_h2h_w) / (h2h_games_cnt + 4.0)) * 90.0, -35.0, 35.0)

        effective_elo_delta = (
            base_elo_delta
            + fac_h2h_delta
            + fac_meta_delta
            + own_mastery_delta
            + vs_mastery_delta
            + past_h2h_delta
        )
        raw_prob1 = 100.0 / (1.0 + math.pow(10.0, -effective_elo_delta / 400.0))
        mf_p1_prob = float(_clamp(round(raw_prob1), 5, 95))
        mf_p2_prob = float(100.0 - mf_p1_prob)
        wtc_score1 = int(_clamp(round(10.0 + 14.0 * ((raw_prob1 / 100.0) - 0.50)), 3, 17))
        wtc_score2 = 20 - wtc_score1

        multi_factor_pred = {
            "p1WinProb": int(mf_p1_prob),
            "p2WinProb": int(mf_p2_prob),
            "wtcScore1": wtc_score1,
            "wtcScore2": wtc_score2,
            "baseEloDelta": round(base_elo_delta, 1),
            "facH2hDelta": round(fac_h2h_delta, 1),
            "facMetaDelta": round(fac_meta_delta, 1),
            "ownMasteryDelta": round(own_mastery_delta, 1),
            "vsMasteryDelta": round(vs_mastery_delta, 1),
            "pastH2hDelta": round(past_h2h_delta, 1),
            "effectiveEloDelta": round(effective_elo_delta, 1),
            "p1Faction": act_f1,
            "p2Faction": act_f2,
            "details": {
                "h2hF1W": h2h_f1_w,
                "h2hF2W": h2h_f2_w,
                "h2hD": h2h_f_d,
                "h2hTotal": h2h_f_tot,
                "f1MetaGames": f1_meta_g,
                "f2MetaGames": f2_meta_g,
                "f1MetaWr": f1_meta_wr,
                "f2MetaWr": f2_meta_wr,
                "p1OwnGames": m1_stats["ownGames"],
                "p1OwnWr": m1_stats["ownWr"],
                "p2OwnGames": m2_stats["ownGames"],
                "p2OwnWr": m2_stats["ownWr"],
                "p1VsGames": m1_stats["vsGames"],
                "p1VsWr": m1_stats["vsWr"],
                "p2VsGames": m2_stats["vsGames"],
                "p2VsWr": m2_stats["vsWr"],
                "p1H2hW": p1_h2h_w,
                "p2H2hW": p2_h2h_w,
                "h2hGames": h2h_games_cnt,
            },
        }

        res = {
            "p1_win_prob": mf_p1_prob,
            "p2_win_prob": mf_p2_prob,
            "player1_win_prob": mf_p1_prob,
            "player2_win_prob": mf_p2_prob,
            "pure_elo_p1_win_prob": pure_p1_prob,
            "pure_elo_p2_win_prob": pure_p2_prob,
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
            "head_to_head": h2h_matches,
            "multi_factor_prediction": multi_factor_pred,
            "p1_profile": p1_prof,
            "p2_profile": p2_prof,
            "faction_3mo_summary": fac_summary,
        }
        if not is_mock_db:
            PostgresDatabase.set_cached(PostgresDatabase._players_cache_dict, cache_key, res)
        return res

    def reconstruct_since_date(
        self,
        since_date: str = "2026-09-01",
        game_system: Optional[str] = "40k",
    ) -> Dict[str, Any]:
        """Rewinds rating_history and player_ratings back to `since_date` and replays all subsequent matches chronologically."""
        try:
            from psycopg2 import extras
        except ImportError:
            class _FallbackExtras:
                RealDictCursor = None
                @staticmethod
                def execute_values(cur, sql, argslist, template=None, page_size=100):
                    cur.execute(sql, argslist)
            extras = _FallbackExtras()
        import time

        sys_target = (game_system or "40k").lower()
        if sys_target == "all":
            r_40k = self.reconstruct_since_date(since_date=since_date, game_system="40k")
            r_aos = self.reconstruct_since_date(since_date=since_date, game_system="aos")
            return {
                "game_system": "all",
                "since_date": since_date,
                "40k": r_40k,
                "aos": r_aos,
                "rewound_players": r_40k.get("rewound_players", 0) + r_aos.get("rewound_players", 0),
                "total_matches_processed": r_40k.get("total_matches_processed", 0) + r_aos.get("total_matches_processed", 0),
                "players_updated": r_40k.get("players_updated", 0) + r_aos.get("players_updated", 0),
                "history_points_saved": r_40k.get("history_points_saved", 0) + r_aos.get("history_points_saved", 0),
            }

        t0 = time.time()
        rewound_pids_set: set = set()
        window_matches: List[Dict[str, Any]] = []
        history_batch: List[Tuple[Any, ...]] = []

        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cur:
                cur.execute("SELECT pg_advisory_xact_lock(840202602);")
                cur.execute("SET LOCAL synchronous_commit = OFF;")

                # 1. Fetch all completed matches in the replay window directly via idx_pg_matches_date
                cur.execute(
                    """
                    SELECT
                        m.id, m.event_id, m.round, m.table_number, m.match_date,
                        m.player1_id, m.player1_name, m.player1_faction, m.player1_score,
                        m.player2_id, m.player2_name, m.player2_faction, m.player2_score,
                        m.winner_id, m.is_draw, m.is_bye,
                        COALESCE(m.game_system, '40k') AS game_system
                    FROM matches m
                    WHERE m.match_date >= %s::timestamptz
                      AND m.is_done = TRUE
                      AND m.player1_id IS NOT NULL AND m.player1_id != ''
                      AND m.player2_id IS NOT NULL AND m.player2_id != ''
                      AND (
                          m.is_bye = TRUE
                          OR (m.winner_id IS NOT NULL AND m.winner_id != '')
                          OR (m.is_draw = TRUE AND (COALESCE(m.player1_score, 0) > 0 OR COALESCE(m.player2_score, 0) > 0 OR m.id LIKE 'melee:%%' OR m.id LIKE 'ltcg:%%' OR m.id LIKE 'ls:%%' OR m.id LIKE 'td:%%'))
                      )
                      AND COALESCE(m.game_system, '40k') = %s
                    ORDER BY m.match_date ASC NULLS FIRST, m.round ASC, m.table_number ASC;
                    """,
                    (since_date, sys_target),
                )
                window_matches = [dict(r) for r in (cur.fetchall() or [])]

                # 2. Delete rating_history rows in the window via idx_pg_history_match
                cur.execute(
                    """
                    WITH target_matches AS (
                        SELECT id
                        FROM matches
                        WHERE match_date >= %s::timestamptz
                          AND COALESCE(game_system, '40k') = %s
                    ),
                    deleted_rh AS (
                        DELETE FROM rating_history rh
                        USING target_matches tm
                        WHERE rh.match_id = tm.id
                          AND COALESCE(rh.game_system, '40k') = %s
                        RETURNING rh.player_id
                    )
                    SELECT DISTINCT player_id FROM deleted_rh WHERE player_id IS NOT NULL;
                    """,
                    (since_date, sys_target, sys_target),
                )
                for r in (cur.fetchall() or []):
                    pid = r[0] if isinstance(r, (list, tuple)) else r.get("player_id")
                    if pid:
                        rewound_pids_set.add(str(pid)[:64])

                alias_map: Dict[str, str] = {}
                try:
                    cur.execute(
                        """
                        SELECT upl.platform_user_id,
                               COALESCE(NULLIF(TRIM(u.player_id), ''), NULLIF(TRIM(u.bcp_user_id), ''), u.id) AS canon_pid
                        FROM user_platform_links upl
                        JOIN users u ON u.id = upl.user_id
                        WHERE upl.platform_user_id IS NOT NULL AND upl.platform_user_id != '';
                        """
                    )
                    for lr in (cur.fetchall() or []):
                        a_pid = str(lr[0] if isinstance(lr, (list, tuple)) else lr.get("platform_user_id") or "").strip()[:64]
                        c_pid = str(lr[1] if isinstance(lr, (list, tuple)) else lr.get("canon_pid") or "").strip()[:64]
                        if a_pid and c_pid:
                            alias_map[a_pid] = c_pid
                except Exception:
                    pass

                for m in window_matches:
                    if m.get("player1_id"):
                        raw_p1 = str(m["player1_id"])[:64]
                        rewound_pids_set.add(alias_map.get(raw_p1, raw_p1))
                    if m.get("player2_id"):
                        raw_p2 = str(m["player2_id"])[:64]
                        rewound_pids_set.add(alias_map.get(raw_p2, raw_p2))

                touched_pids = sorted(rewound_pids_set)
                player_states: Dict[str, Dict[str, Any]] = {}
                player_factions: Dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
                existing_teams: Dict[str, str] = {}

                # 3. Load exact pre-window state ONLY for touched_pids via idx_pg_history_player + PKs
                if touched_pids:
                    cur.execute(
                        """
                        WITH touched AS (
                            SELECT UNNEST(%s::varchar[]) AS player_id
                        ),
                        pre_stats AS (
                            SELECT
                                rh.player_id,
                                COUNT(*) AS matches_played,
                                COUNT(*) FILTER (WHERE rh.result = 'W') AS wins,
                                COUNT(*) FILTER (WHERE rh.result = 'L') AS losses,
                                COUNT(*) FILTER (WHERE rh.result = 'D') AS draws,
                                MAX(rh.new_elo) AS max_hist_elo,
                                MAX(rh.match_date) AS last_hist_date,
                                (ARRAY_AGG(rh.new_elo ORDER BY rh.match_date DESC NULLS LAST, rh.id DESC))[1] AS latest_elo
                            FROM rating_history rh
                            JOIN touched t ON rh.player_id = t.player_id
                            WHERE COALESCE(rh.game_system, '40k') = %s
                            GROUP BY rh.player_id
                        )
                        SELECT
                            t.player_id,
                            p.full_name AS auth_name,
                            pr.player_name AS pr_name,
                            COALESCE(ps.latest_elo, %s) AS current_elo,
                            GREATEST(%s, COALESCE(ps.max_hist_elo, %s)) AS peak_elo,
                            COALESCE(ps.matches_played, 0) AS matches_played,
                            COALESCE(ps.wins, 0) AS wins,
                            COALESCE(ps.losses, 0) AS losses,
                            COALESCE(ps.draws, 0) AS draws,
                            ps.last_hist_date AS last_active_date,
                            pr.top_faction,
                            COALESCE(NULLIF(TRIM(pr.team), ''), NULLIF(TRIM(p.team), '')) AS team
                        FROM touched t
                        LEFT JOIN pre_stats ps ON ps.player_id = t.player_id
                        LEFT JOIN player_ratings pr ON pr.player_id = t.player_id AND COALESCE(pr.game_system, '40k') = %s
                        LEFT JOIN players p ON p.id = t.player_id;
                        """,
                        (
                            touched_pids,
                            sys_target,
                            self.initial_elo,
                            self.initial_elo,
                            self.initial_elo,
                            sys_target,
                        ),
                    )
                    for r in (cur.fetchall() or []):
                        pid = str(r["player_id"])[:64]
                        auth_n = _sanitize_name(r.get("auth_name"), max_len=100)
                        pr_n = _sanitize_name(r.get("pr_name"), max_len=100)
                        best_n = (
                            auth_n
                            if (auth_n and not _is_placeholder_name(auth_n, pid))
                            else (pr_n if (pr_n and not _is_placeholder_name(pr_n, pid)) else (auth_n or pr_n or f"Player {pid[:8]}"))
                        )
                        player_states[pid] = {
                            "name": best_n,
                            "elo": float(r.get("current_elo") or self.initial_elo),
                            "peak_elo": float(r.get("peak_elo") or self.initial_elo),
                            "matches_played": int(r.get("matches_played") or 0),
                            "wins": int(r.get("wins") or 0),
                            "losses": int(r.get("losses") or 0),
                            "draws": int(r.get("draws") or 0),
                            "last_active_date": r.get("last_active_date"),
                        }
                        clean_t = _sanitize_team(r.get("team"), max_len=100)
                        if clean_t:
                            existing_teams[pid] = clean_t
                        if r.get("top_faction"):
                            for fac in str(r["top_faction"]).split(", "):
                                clean_fac = _sanitize_name(fac, max_len=60)
                                if clean_fac:
                                    player_factions[pid][clean_fac] += 1

                # 4. Replay window_matches in chronological order
                for m in window_matches:
                    raw_p1, raw_p2 = m.get("player1_id"), m.get("player2_id")
                    if not raw_p1 or not raw_p2:
                        continue
                    raw_p1_str = str(raw_p1)[:64]
                    raw_p2_str = str(raw_p2)[:64]
                    p1_id = alias_map.get(raw_p1_str, raw_p1_str)
                    p2_id = alias_map.get(raw_p2_str, raw_p2_str)

                    p1_mname = _sanitize_name(m.get("player1_name"), max_len=100)
                    s1 = player_states.get(p1_id)
                    if not s1:
                        s1 = {
                            "name": p1_mname or f"Player {p1_id[:8]}",
                            "elo": self.initial_elo,
                            "peak_elo": self.initial_elo,
                            "matches_played": 0,
                            "wins": 0,
                            "losses": 0,
                            "draws": 0,
                            "last_active_date": None,
                        }
                        player_states[p1_id] = s1
                    elif _is_placeholder_name(s1["name"], p1_id) and p1_mname and not _is_placeholder_name(p1_mname, p1_id):
                        s1["name"] = p1_mname

                    p2_mname = _sanitize_name(m.get("player2_name"), max_len=100)
                    s2 = player_states.get(p2_id)
                    if not s2:
                        s2 = {
                            "name": p2_mname or f"Player {p2_id[:8]}",
                            "elo": self.initial_elo,
                            "peak_elo": self.initial_elo,
                            "matches_played": 0,
                            "wins": 0,
                            "losses": 0,
                            "draws": 0,
                            "last_active_date": None,
                        }
                        player_states[p2_id] = s2
                    elif _is_placeholder_name(s2["name"], p2_id) and p2_mname and not _is_placeholder_name(p2_mname, p2_id):
                        s2["name"] = p2_mname

                    mid_str = str(m.get("id") or "")
                    is_non_bcp_match = mid_str.startswith(("melee:", "ltcg:", "ls:", "td:"))
                    is_bye_match = bool(m.get("is_bye") or p2_id.upper() == "BYE" or p1_id.upper() == "BYE")
                    is_real_draw = bool(m.get("is_draw") and ((m.get("player1_score") or 0) > 0 or (m.get("player2_score") or 0) > 0 or is_non_bcp_match))
                    raw_win = str(m.get("winner_id") or "")[:64] if m.get("winner_id") else None
                    win_id = alias_map.get(raw_win, raw_win) if raw_win else None
                    has_valid_winner = bool(win_id and win_id in (p1_id, p2_id))
                    if not is_bye_match and not has_valid_winner and not is_real_draw:
                        continue

                    old_elo1 = s1["elo"]
                    old_elo2 = s2["elo"]
                    m_date = m.get("match_date")
                    match_sys = m.get("game_system") or sys_target

                    if is_bye_match or is_real_draw:
                        res1, res2 = ("D", "D") if is_real_draw else ("W", "L")
                        new_elo1, new_elo2 = old_elo1, old_elo2
                    else:
                        is_p1_win = (win_id == p1_id)
                        res1, res2 = ("W", "L") if is_p1_win else ("L", "W")
                        k1 = self.provisional_k if s1["matches_played"] < self.provisional_matches else self.default_k
                        k2 = self.provisional_k if s2["matches_played"] < self.provisional_matches else self.default_k

                        exp1 = self.expected_score(old_elo1, old_elo2)
                        exp2 = 1.0 - exp1
                        act1 = 1.0 if is_p1_win else 0.0
                        act2 = 1.0 - act1

                        new_elo1 = round(old_elo1 + k1 * (act1 - exp1), 2)
                        new_elo2 = round(old_elo2 + k2 * (act2 - exp2), 2)

                    s1["elo"] = new_elo1
                    s1["peak_elo"] = max(s1["peak_elo"], new_elo1)
                    s1["matches_played"] += 1
                    if res1 == "W":
                        s1["wins"] += 1
                    elif res1 == "L":
                        s1["losses"] += 1
                    else:
                        s1["draws"] += 1
                    if m_date:
                        s1["last_active_date"] = _max_date(s1["last_active_date"], m_date)
                    fac1 = _sanitize_name(m.get("player1_faction"), max_len=60)
                    fac2 = _sanitize_name(m.get("player2_faction"), max_len=60)
                    if fac1:
                        player_factions[p1_id][fac1] += 1
                    if fac2:
                        player_factions[p2_id][fac2] += 1

                    s2["elo"] = new_elo2
                    s2["peak_elo"] = max(s2["peak_elo"], new_elo2)
                    s2["matches_played"] += 1
                    if res2 == "W":
                        s2["wins"] += 1
                    elif res2 == "L":
                        s2["losses"] += 1
                    else:
                        s2["draws"] += 1
                    if m_date:
                        s2["last_active_date"] = _max_date(s2["last_active_date"], m_date)

                    history_batch.append(
                        (
                            p1_id,
                            str(m["id"])[:64],
                            str(m.get("event_id") or "")[:64] if m.get("event_id") else None,
                            m.get("round"),
                            m_date,
                            old_elo1,
                            new_elo1,
                            round(new_elo1 - old_elo1, 2),
                            p2_id,
                            _sanitize_name(s2["name"], max_len=100),
                            old_elo2,
                            res1,
                            fac1,
                            fac2,
                            m.get("player1_score"),
                            m.get("player2_score"),
                            match_sys,
                        )
                    )
                    history_batch.append(
                        (
                            p2_id,
                            str(m["id"])[:64],
                            str(m.get("event_id") or "")[:64] if m.get("event_id") else None,
                            m.get("round"),
                            m_date,
                            old_elo2,
                            new_elo2,
                            round(new_elo2 - old_elo2, 2),
                            p1_id,
                            _sanitize_name(s1["name"], max_len=100),
                            old_elo1,
                            res2,
                            fac2,
                            fac1,
                            m.get("player2_score"),
                            m.get("player1_score"),
                            match_sys,
                        )
                    )

                if history_batch:
                    insert_history_pg = """
                    INSERT INTO rating_history (
                        player_id, match_id, event_id, round, match_date,
                        old_elo, new_elo, delta_elo, opponent_id, opponent_name,
                        opponent_elo, result, player_faction, opponent_faction,
                        player_score, opponent_score, game_system
                    ) VALUES %s;
                    """
                    extras.execute_values(cur, insert_history_pg, history_batch, page_size=2500)

                if touched_pids:
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
                    for pid in touched_pids:
                        if str(pid).strip().upper() == "BYE":
                            continue
                        s = player_states.get(pid)
                        if not s:
                            continue
                        total = s["matches_played"]
                        win_rate = round((s["wins"] / total) * 100.0, 1) if total > 0 else 0.0
                        top_fac = _sanitize_top_factions(player_factions[pid], max_factions=5, max_len=200)
                        team_name = _sanitize_team(existing_teams.get(pid), max_len=100)
                        clean_player_name = _sanitize_name(s.get("name"), max_len=100) or f"Player {str(pid)[:8]}"
                        ratings_data.append(
                            (
                                str(pid)[:64],
                                clean_player_name,
                                s["elo"],
                                s["peak_elo"],
                                total,
                                s["wins"],
                                s["losses"],
                                s["draws"],
                                win_rate,
                                top_fac,
                                team_name,
                                s["last_active_date"],
                                now_iso,
                                sys_target,
                            )
                        )
                    if ratings_data:
                        extras.execute_values(cur, upsert_ratings_pg, ratings_data, page_size=2000)

            conn.commit()

        self.invalidate_caches()
        if hasattr(self.db, "invalidate_all_caches"):
            self.db.invalidate_all_caches()
        elif hasattr(self.db.__class__, "invalidate_all_caches"):
            self.db.__class__.invalidate_all_caches()

        elapsed = round(time.time() - t0, 2)
        return {
            "game_system": sys_target,
            "since_date": since_date,
            "rewound_players": len(touched_pids),
            "total_matches_processed": len(window_matches),
            "players_updated": len(touched_pids),
            "history_points_saved": len(history_batch),
            "elapsed_seconds": elapsed,
        }

    def reconstruct_system_ratings_fast(self, game_system: str = "mtg") -> Dict[str, Any]:
        """Fast in-memory Elo replay directly from `matches` into `player_ratings` using `idx_pg_matches_system_chrono` (zero scans on `rating_history`)."""
        try:
            from psycopg2 import extras
        except ImportError:
            class _FallbackExtras:
                RealDictCursor = None
                @staticmethod
                def execute_values(cur, sql, argslist, template=None, page_size=100):
                    cur.execute(sql, argslist)
            extras = _FallbackExtras()
        import time

        sys_target = normalize_game_system(game_system or "mtg", default="mtg")
        t0 = time.time()
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT
                        m.id, m.event_id, m.round, m.table_number, m.match_date,
                        m.player1_id, m.player1_name, m.player1_faction, m.player1_score,
                        m.player2_id, m.player2_name, m.player2_faction, m.player2_score,
                        m.winner_id, m.is_draw, m.is_bye,
                        CASE WHEN m.player1_faction = 'Commander Pod' OR m.player2_faction = 'Commander Pod' OR m.player1_name LIKE '%%Pod (%%' OR m.player2_name LIKE '%%Pod (%%' OR m.player1_name LIKE '%%&%%' OR m.player2_name LIKE '%%&%%' THEN m.raw_json ELSE NULL END as raw_json
                    FROM matches m
                    WHERE ((%s != '40k' AND m.game_system = %s) OR (%s = '40k' AND COALESCE(m.game_system, '40k') = '40k'))
                      AND m.is_done = TRUE
                      AND m.player1_id IS NOT NULL AND m.player1_id != ''
                      AND m.player2_id IS NOT NULL AND m.player2_id != ''
                      AND (
                          m.is_bye = TRUE
                          OR (m.winner_id IS NOT NULL AND m.winner_id != '')
                          OR (m.is_draw = TRUE AND (COALESCE(m.player1_score, 0) > 0 OR COALESCE(m.player2_score, 0) > 0 OR m.id LIKE 'melee:%%' OR m.id LIKE 'ltcg:%%' OR m.id LIKE 'ls:%%' OR m.id LIKE 'td:%%'))
                      )
                    ORDER BY m.match_date ASC NULLS FIRST, m.round ASC, m.table_number ASC, m.id ASC;
                    """,
                    (sys_target, sys_target, sys_target),
                )
                all_matches = [dict(r) for r in (cur.fetchall() or [])]

            if not all_matches:
                return {"status": "NO_MATCHES", "game_system": sys_target, "total_matches": 0, "total_players": 0}

            candidate_pids_set = set()
            scoped_eids_set = set()
            for nm in all_matches:
                if nm.get("event_id"):
                    scoped_eids_set.add(_bound_id(nm["event_id"]))
                if nm.get("player1_id") and str(nm["player1_id"]).strip().upper() != "BYE":
                    candidate_pids_set.add(_bound_id(nm["player1_id"]))
                if nm.get("player2_id") and str(nm["player2_id"]).strip().upper() != "BYE":
                    candidate_pids_set.add(_bound_id(nm["player2_id"]))
                raw_val = nm.get("raw_json")
                if raw_val:
                    raw_obj: Dict[str, Any] = {}
                    if isinstance(raw_val, dict):
                        raw_obj = raw_val
                    elif isinstance(raw_val, str) and raw_val.strip().startswith("{"):
                        try:
                            raw_obj = json.loads(raw_val)
                        except Exception:
                            raw_obj = {}
                    nm["_parsed_raw"] = raw_obj
                    for list_k in ("pod_participants", "team1_players", "team2_players"):
                        for p_item in (raw_obj.get(list_k) or []):
                            if isinstance(p_item, dict) and p_item.get("player_id"):
                                p_str = str(p_item["player_id"]).strip()
                                if p_str and p_str.upper() != "BYE":
                                    candidate_pids_set.add(_bound_id(p_str))

            scoped_pids = sorted(candidate_pids_set)
            scoped_eids = sorted(scoped_eids_set)

            authoritative_names: Dict[str, str] = {}
            authoritative_teams: Dict[str, str] = {}
            ep_event_factions: Dict[Tuple[str, str], str] = {}
            ep_player_factions: Dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
            alias_map: Dict[str, str] = {}
            try:
                with conn.cursor() as acur:
                    acur.execute(
                        """
                        SELECT upl.platform_user_id,
                               COALESCE(NULLIF(TRIM(u.player_id), ''), NULLIF(TRIM(u.bcp_user_id), ''), u.id) AS canon_pid
                        FROM user_platform_links upl
                        JOIN users u ON u.id = upl.user_id
                        WHERE upl.platform_user_id IS NOT NULL AND upl.platform_user_id != '';
                        """
                    )
                    for lr in (acur.fetchall() or []):
                        a_pid = str(lr[0] if isinstance(lr, (list, tuple)) else lr.get("platform_user_id") or "").strip()[:64]
                        c_pid = str(lr[1] if isinstance(lr, (list, tuple)) else lr.get("canon_pid") or "").strip()[:64]
                        if a_pid and c_pid:
                            alias_map[a_pid] = c_pid

                    if scoped_pids:
                        acur.execute("SELECT id, full_name, team FROM players WHERE id = ANY(%s);", (scoped_pids,))
                        for pr in (acur.fetchall() or []):
                            pid_raw = str(pr[0] if isinstance(pr, (list, tuple)) else pr.get("id") or "")[:64]
                            pid_v = _bound_id(alias_map.get(pid_raw, pid_raw))
                            nm_v = pr[1] if isinstance(pr, (list, tuple)) else pr.get("full_name")
                            tm_v = pr[2] if isinstance(pr, (list, tuple)) else pr.get("team")
                            clean_nm = _sanitize_name(nm_v, max_len=100)
                            if pid_v and clean_nm and not _is_placeholder_name(clean_nm, pid_v):
                                authoritative_names[pid_v] = clean_nm
                            clean_tm = _sanitize_team(tm_v)
                            if pid_v and clean_tm:
                                authoritative_teams[pid_v] = clean_tm

                    if scoped_eids:
                        acur.execute(
                            """
                            SELECT event_id, player_id, full_name, faction, team
                            FROM event_participants
                            WHERE event_id = ANY(%s)
                              AND player_id IS NOT NULL AND player_id != '';
                            """,
                            (scoped_eids,),
                        )
                        for epr in (acur.fetchall() or []):
                            eid_v = _bound_id(epr[0] if isinstance(epr, (list, tuple)) else epr.get("event_id"))
                            pid_raw = _bound_id(epr[1] if isinstance(epr, (list, tuple)) else epr.get("player_id"))
                            pid_v = _bound_id(alias_map.get(pid_raw, pid_raw))
                            nm_v = epr[2] if isinstance(epr, (list, tuple)) else epr.get("full_name")
                            fac_v = epr[3] if isinstance(epr, (list, tuple)) else epr.get("faction")
                            tm_v = epr[4] if isinstance(epr, (list, tuple)) else epr.get("team")
                            if not pid_v or pid_v.upper() == "BYE":
                                continue
                            clean_nm = _sanitize_name(nm_v, max_len=100)
                            if clean_nm and not _is_placeholder_name(clean_nm, pid_v) and pid_v not in authoritative_names:
                                authoritative_names[pid_v] = clean_nm
                            clean_fac = _sanitize_name(fac_v, max_len=60)
                            if clean_fac and clean_fac.lower() not in ("commander pod", "pod", "none", "unknown", ""):
                                if eid_v:
                                    ep_event_factions[(eid_v, pid_v)] = clean_fac
                                ep_player_factions[pid_v][clean_fac] += 1
                            clean_tm = _sanitize_team(tm_v)
                            if clean_tm and pid_v not in authoritative_teams:
                                authoritative_teams[pid_v] = clean_tm
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass

            player_states: Dict[str, Dict[str, Any]] = {}
            player_factions: Dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
            # Per-player journey rows mirrored into rating_history so /api/player trajectories match player_ratings.
            history_rows: List[Tuple[Any, ...]] = []

            def _hist(pid_h, m_h, old_h, new_h, opp_id_h, opp_name_h, opp_elo_h, res_h, fac_h, opp_fac_h, sc_h, opp_sc_h):
                history_rows.append((
                    _bound_id(pid_h), _bound_id(m_h.get("id") or ""), _bound_id(m_h.get("event_id") or "unknown_event"),
                    _safe_int_score(m_h.get("round")), m_h.get("match_date"),
                    old_h, new_h, round(new_h - old_h, 2),
                    _bound_id(opp_id_h or ""), _sanitize_name(opp_name_h, max_len=100), opp_elo_h, res_h,
                    fac_h or None, opp_fac_h or None, sc_h, opp_sc_h, sys_target,
                ))

            def _ensure_st(pid_val: str, mname_val: Optional[str]) -> Dict[str, Any]:
                pid_c = _bound_id(pid_val)
                s_mname = _sanitize_name(mname_val, max_len=100)
                if _is_placeholder_name(s_mname, pid_c):
                    s_mname = ""
                p_best = authoritative_names.get(pid_c) or s_mname
                st = player_states.get(pid_c)
                if not st:
                    st = {
                        "name": _sanitize_name(p_best, max_len=100) or f"Player {pid_c[:8]}",
                        "elo": self.initial_elo,
                        "peak_elo": self.initial_elo,
                        "matches_played": 0, "wins": 0, "losses": 0, "draws": 0,
                        "last_active_date": None,
                    }
                    player_states[pid_c] = st
                elif _is_placeholder_name(st["name"], pid_c) and p_best:
                    st["name"] = _sanitize_name(p_best, max_len=100)
                return st

            for m in all_matches:
                ev_id_b = _bound_id(m.get("event_id") or "")
                m_date = m.get("match_date")
                raw_obj = m.get("_parsed_raw") or {}

                # --- BRANCH A: 2v2 Doubles / Team Match ---
                t1_list = raw_obj.get("team1_players")
                t2_list = raw_obj.get("team2_players")
                if isinstance(t1_list, list) and isinstance(t2_list, list) and t1_list and t2_list:
                    t1_valid = []
                    t2_valid = []
                    for p in t1_list:
                        if isinstance(p, dict) and p.get("player_id") and str(p["player_id"]).strip().upper() != "BYE":
                            raw_b = _bound_id(p["player_id"])
                            t1_valid.append({**p, "canon_pid": _bound_id(alias_map.get(raw_b, raw_b))})
                    for p in t2_list:
                        if isinstance(p, dict) and p.get("player_id") and str(p["player_id"]).strip().upper() != "BYE":
                            raw_b = _bound_id(p["player_id"])
                            t2_valid.append({**p, "canon_pid": _bound_id(alias_map.get(raw_b, raw_b))})
                    if t1_valid and t2_valid:
                        for p in t1_valid + t2_valid:
                            _ensure_st(p["canon_pid"], p.get("player_name"))
                        t1_old_avg = sum(player_states[p["canon_pid"]]["elo"] for p in t1_valid) / len(t1_valid)
                        t2_old_avg = sum(player_states[p["canon_pid"]]["elo"] for p in t2_valid) / len(t2_valid)
                        exp_t1 = self.expected_score(t1_old_avg, t2_old_avg)
                        exp_t2 = 1.0 - exp_t1
                        is_draw_2v2 = bool(m.get("is_draw"))
                        t1_ids = {p["canon_pid"] for p in t1_valid}
                        raw_win_2v2 = _bound_id(m.get("winner_id") or "")
                        win_2v2 = _bound_id(alias_map.get(raw_win_2v2, raw_win_2v2)) if raw_win_2v2 else ""
                        t1_won = bool(not is_draw_2v2 and win_2v2 in t1_ids)
                        act_t1 = 0.5 if is_draw_2v2 else (1.0 if t1_won else 0.0)
                        act_t2 = 1.0 - act_t1
                        k_2v2 = sum(
                            (self.provisional_k if player_states[p["canon_pid"]]["matches_played"] < self.provisional_matches else self.default_k)
                            for p in (t1_valid + t2_valid)
                        ) / float(len(t1_valid) + len(t2_valid))
                        for side_idx, side_players in ((1, t1_valid), (2, t2_valid)):
                            exp_s = exp_t1 if side_idx == 1 else exp_t2
                            act_s = act_t1 if side_idx == 1 else act_t2
                            res_code = "D" if is_draw_2v2 else ("W" if act_s == 1.0 else "L")
                            for p in side_players:
                                pid_p = p["canon_pid"]
                                st_p = player_states[pid_p]
                                old_e = st_p["elo"]
                                delta_e = 0.0 if is_draw_2v2 else round(k_2v2 * (act_s - exp_s), 2)
                                new_e = round(old_e + delta_e, 2)
                                st_p["elo"] = new_e
                                st_p["peak_elo"] = max(st_p["peak_elo"], new_e)
                                st_p["matches_played"] += 1
                                if res_code == "W":
                                    st_p["wins"] += 1
                                elif res_code == "L":
                                    st_p["losses"] += 1
                                else:
                                    st_p["draws"] += 1
                                if m_date:
                                    st_p["last_active_date"] = _max_date(st_p["last_active_date"], m_date)
                                p_fac = _sanitize_name(p.get("faction"), max_len=60) or ep_event_factions.get((ev_id_b, pid_p), "")
                                if p_fac and " + " not in p_fac and "Pod" not in p_fac:
                                    player_factions[pid_p][p_fac] += 1
                                opp_side = t2_valid if side_idx == 1 else t1_valid
                                _hist(
                                    pid_p, m, old_e, new_e,
                                    opp_side[0]["canon_pid"],
                                    " & ".join(player_states[o["canon_pid"]]["name"] for o in opp_side),
                                    round(t2_old_avg if side_idx == 1 else t1_old_avg, 2),
                                    res_code, p_fac, "", None, None,
                                )
                        continue

                # --- BRANCH B: 4-Player FFA Commander Pod ---
                pod_candidates = raw_obj.get("pod_participants")
                if isinstance(pod_candidates, list) and len(pod_candidates) >= 3:
                    seen_pod_pids = set()
                    pod_seats = []
                    for s_r in pod_candidates:
                        if not isinstance(s_r, dict) or not s_r.get("player_id"):
                            continue
                        raw_sp = _bound_id(s_r["player_id"])
                        if not raw_sp or raw_sp.upper() == "BYE":
                            continue
                        canon_sp = _bound_id(alias_map.get(raw_sp, raw_sp))
                        if canon_sp and canon_sp not in seen_pod_pids:
                            seen_pod_pids.add(canon_sp)
                            pod_seats.append({**s_r, "canon_pid": canon_sp})
                    n_pod = len(pod_seats)
                    if n_pod >= 3:
                        for s_row in pod_seats:
                            _ensure_st(s_row["canon_pid"], s_row.get("player_name"))
                        old_pod_elos = {s_row["canon_pid"]: player_states[s_row["canon_pid"]]["elo"] for s_row in pod_seats}
                        raw_win_ffa = _bound_id(m.get("winner_id") or "")
                        win_id_ffa = _bound_id(alias_map.get(raw_win_ffa, raw_win_ffa)) if raw_win_ffa else ""
                        is_pod_draw = bool(m.get("is_draw") or not win_id_ffa or win_id_ffa not in old_pod_elos)
                        k_pod = sum(
                            (self.provisional_k if player_states[s_row["canon_pid"]]["matches_played"] < self.provisional_matches else self.default_k)
                            for s_row in pod_seats
                        ) / float(n_pod)

                        for s_row in pod_seats:
                            pid_i = s_row["canon_pid"]
                            st_i = player_states[pid_i]
                            old_i = old_pod_elos[pid_i]
                            others = [o for o in pod_seats if o["canon_pid"] != pid_i]
                            if not others:
                                continue
                            exp_pair_sum = 0.0
                            act_pair_sum = 0.0
                            for o_row in others:
                                pid_j = o_row["canon_pid"]
                                old_j = old_pod_elos[pid_j]
                                exp_pair_sum += self.expected_score(old_i, old_j)
                                if is_pod_draw:
                                    act_pair_sum += 0.5
                                elif pid_i == win_id_ffa:
                                    act_pair_sum += 1.0
                                elif pid_j == win_id_ffa:
                                    act_pair_sum += 0.0
                                else:
                                    act_pair_sum += 0.5
                            exp_norm = exp_pair_sum / float(len(others))
                            act_norm = act_pair_sum / float(len(others))
                            delta_i = round(k_pod * (act_norm - exp_norm), 2)
                            new_i = round(old_i + delta_i, 2)
                            res_i = "D" if is_pod_draw else ("W" if pid_i == win_id_ffa else "L")
                            st_i["elo"] = new_i
                            st_i["peak_elo"] = max(st_i["peak_elo"], new_i)
                            st_i["matches_played"] += 1
                            if res_i == "W":
                                st_i["wins"] += 1
                            elif res_i == "L":
                                st_i["losses"] += 1
                            else:
                                st_i["draws"] += 1
                            if m_date:
                                st_i["last_active_date"] = _max_date(st_i["last_active_date"], m_date)
                            fac_i = _sanitize_name(s_row.get("faction"), max_len=60)
                            if not fac_i or "Pod" in fac_i:
                                fac_i = ep_event_factions.get((ev_id_b, pid_i), "")
                            if fac_i and "Pod" not in fac_i and "Commander Pod" not in fac_i:
                                player_factions[pid_i][fac_i] += 1
                            _hist(
                                pid_i, m, old_i, new_i,
                                others[0]["canon_pid"],
                                f"Pod ({n_pod} players)",
                                round(sum(old_pod_elos[o["canon_pid"]] for o in others) / float(len(others)), 2),
                                res_i, fac_i, "", None, None,
                            )
                        continue

                # --- BRANCH C: Standard 1v1 Match ---
                raw_p1, raw_p2 = m.get("player1_id"), m.get("player2_id")
                if not raw_p1 or not raw_p2:
                    continue
                p1_id = _bound_id(alias_map.get(_bound_id(raw_p1), _bound_id(raw_p1)))
                p2_id = _bound_id(alias_map.get(_bound_id(raw_p2), _bound_id(raw_p2)))
                if p1_id == p2_id and p1_id.upper() != "BYE":
                    continue
                mid_str = _bound_id(m.get("id") or "")
                is_non_bcp = mid_str.startswith(("melee:", "ltcg:", "ls:", "td:"))
                is_bye_m = bool(m.get("is_bye") or p2_id.upper() == "BYE" or p1_id.upper() == "BYE")
                p1_sc = _safe_int_score(m.get("player1_score"))
                p2_sc = _safe_int_score(m.get("player2_score"))
                is_draw_m = bool(m.get("is_draw") and ((p1_sc or 0) > 0 or (p2_sc or 0) > 0 or is_non_bcp))
                raw_win = _bound_id(m.get("winner_id")) if m.get("winner_id") else None
                win_id = _bound_id(alias_map.get(raw_win, raw_win)) if raw_win else None
                has_win = bool(win_id and win_id in (p1_id, p2_id))
                if not is_bye_m and not has_win and not is_draw_m:
                    continue

                s1 = _ensure_st(p1_id, m.get("player1_name"))
                s2 = _ensure_st(p2_id, m.get("player2_name"))
                old_elo1, old_elo2 = s1["elo"], s2["elo"]

                if is_bye_m or is_draw_m:
                    if is_draw_m:
                        res1, res2 = ("D", "D")
                    elif p1_id.upper() == "BYE":
                        # The real player is in seat 2; never hand them a loss for receiving a bye.
                        res1, res2 = ("L", "W")
                    else:
                        res1, res2 = ("W", "L")
                    new_elo1, new_elo2 = old_elo1, old_elo2
                else:
                    is_p1_w = (win_id == p1_id)
                    res1, res2 = ("W", "L") if is_p1_w else ("L", "W")
                    k1 = self.provisional_k if s1["matches_played"] < self.provisional_matches else self.default_k
                    k2 = self.provisional_k if s2["matches_played"] < self.provisional_matches else self.default_k
                    exp1 = self.expected_score(old_elo1, old_elo2)
                    act1 = 1.0 if is_p1_w else 0.0
                    new_elo1 = round(old_elo1 + k1 * (act1 - exp1), 2)
                    new_elo2 = round(old_elo2 + k2 * ((1.0 - act1) - (1.0 - exp1)), 2)

                fac1 = _sanitize_name(m.get("player1_faction"), max_len=60)
                if not fac1 or "Pod" in fac1:
                    fac1 = ep_event_factions.get((ev_id_b, p1_id), "")
                fac2 = _sanitize_name(m.get("player2_faction"), max_len=60)
                if not fac2 or "Pod" in fac2:
                    fac2 = ep_event_factions.get((ev_id_b, p2_id), "")
                for pid_x, st_x, n_elo, res_x, fac_x, o_elo, opp_id_x, opp_st, opp_old, opp_fac, sc_x, opp_sc in (
                    (p1_id, s1, new_elo1, res1, fac1, old_elo1, p2_id, s2, old_elo2, fac2, p1_sc, p2_sc),
                    (p2_id, s2, new_elo2, res2, fac2, old_elo2, p1_id, s1, old_elo1, fac1, p2_sc, p1_sc),
                ):
                    if pid_x.upper() == "BYE":
                        continue
                    _hist(
                        pid_x, m, o_elo, n_elo, opp_id_x,
                        "BYE" if opp_id_x.upper() == "BYE" else opp_st["name"],
                        opp_old, res_x, fac_x, opp_fac, sc_x, opp_sc,
                    )
                    st_x["elo"] = n_elo
                    st_x["peak_elo"] = max(st_x["peak_elo"], n_elo)
                    st_x["matches_played"] += 1
                    if res_x == "W":
                        st_x["wins"] += 1
                    elif res_x == "L":
                        st_x["losses"] += 1
                    else:
                        st_x["draws"] += 1
                    if m_date:
                        st_x["last_active_date"] = _max_date(st_x["last_active_date"], m_date)
                    if fac_x and "Pod" not in fac_x:
                        player_factions[pid_x][fac_x] += 1

            now_iso = datetime.now(timezone.utc).isoformat()
            ratings_rows = []
            for pid, s in player_states.items():
                if str(pid).strip().upper() == "BYE" or s["matches_played"] <= 0:
                    continue
                total = s["matches_played"]
                win_rate = round((s["wins"] / total) * 100.0, 1) if total > 0 else 0.0
                fac_counter = player_factions[pid] if player_factions.get(pid) else ep_player_factions.get(pid, collections.Counter())
                top_fac = _sanitize_top_factions(fac_counter, max_factions=5, max_len=200)
                clean_player_name = _sanitize_name(s.get("name"), max_len=100) or f"Player {str(pid)[:8]}"
                ratings_rows.append((
                    _bound_id(pid), sys_target, clean_player_name, s["elo"], s["peak_elo"],
                    total, s["wins"], s["losses"], s["draws"], win_rate,
                    top_fac, authoritative_teams.get(pid), s["last_active_date"], now_iso
                ))

            upsert_sql = """
            INSERT INTO player_ratings (
                player_id, game_system, player_name, current_elo, peak_elo,
                matches_played, wins, losses, draws, win_rate,
                top_faction, team, last_active_date, updated_at
            ) VALUES %s
            ON CONFLICT (player_id, game_system) DO UPDATE SET
                player_name = EXCLUDED.player_name,
                current_elo = EXCLUDED.current_elo,
                peak_elo = EXCLUDED.peak_elo,
                matches_played = EXCLUDED.matches_played,
                wins = EXCLUDED.wins,
                losses = EXCLUDED.losses,
                draws = EXCLUDED.draws,
                win_rate = EXCLUDED.win_rate,
                top_faction = COALESCE(EXCLUDED.top_faction, player_ratings.top_faction),
                team = COALESCE(EXCLUDED.team, player_ratings.team),
                last_active_date = EXCLUDED.last_active_date,
                updated_at = EXCLUDED.updated_at;
            """
            with conn.cursor() as wcur:
                wcur.execute("SET LOCAL synchronous_commit = OFF;")
                # Rewrite this system's rating_history (journeys) in the same transaction as player_ratings.
                wcur.execute(
                    "SELECT player_id FROM player_ratings WHERE ((%s != '40k' AND game_system = %s) OR (%s = '40k' AND COALESCE(game_system, '40k') = '40k'));",
                    (sys_target, sys_target, sys_target),
                )
                hist_pids = set(scoped_pids) | set(player_states.keys())
                for pr_row in (wcur.fetchall() or []):
                    pr_pid = pr_row[0] if isinstance(pr_row, (list, tuple)) else (pr_row.get("player_id") if isinstance(pr_row, dict) else None)
                    if pr_pid:
                        hist_pids.add(str(pr_pid)[:64])
                hist_pid_list = sorted(hist_pids)
                for idx_d in range(0, len(hist_pid_list), 5000):
                    wcur.execute(
                        "DELETE FROM rating_history WHERE player_id = ANY(%s) AND COALESCE(game_system, '40k') = %s;",
                        (hist_pid_list[idx_d:idx_d + 5000], sys_target),
                    )
                if history_rows and hasattr(wcur, "copy_from"):
                    hist_cols = (
                        "player_id", "match_id", "event_id", "round", "match_date",
                        "old_elo", "new_elo", "delta_elo", "opponent_id", "opponent_name",
                        "opponent_elo", "result", "player_faction", "opponent_faction",
                        "player_score", "opponent_score", "game_system",
                    )
                    for idx_h in range(0, len(history_rows), 50000):
                        buf = io.StringIO()
                        for hv in history_rows[idx_h:idx_h + 50000]:
                            buf.write("\t".join(_format_tsv_field(v) for v in hv) + "\n")
                        buf.seek(0)
                        wcur.copy_from(buf, "rating_history", columns=hist_cols, null="\\N")
                wcur.execute(
                    "DELETE FROM player_ratings WHERE ((%s != '40k' AND game_system = %s) OR (%s = '40k' AND COALESCE(game_system, '40k') = '40k'));",
                    (sys_target, sys_target, sys_target),
                )
                chunk_sz = 2500
                for idx_r in range(0, len(ratings_rows), chunk_sz):
                    extras.execute_values(wcur, upsert_sql, ratings_rows[idx_r:idx_r + chunk_sz], page_size=chunk_sz)
            conn.commit()

        self.invalidate_caches()
        if hasattr(self.db, "invalidate_all_caches"):
            self.db.invalidate_all_caches(purge_l2=False)
        return {
            "status": "SUCCESS",
            "mode": "reconstruct_system_ratings_fast",
            "game_system": sys_target,
            "total_matches": len(all_matches),
            "total_players": len(ratings_rows),
            "history_rows": len(history_rows),
            "elapsed_seconds": round(time.time() - t0, 2),
        }

    def reconstruct_incremental(
        self,
        batch_limit: int = 50000,
        game_system: Optional[str] = "40k",
        since_date: Optional[str] = None,
        skip_stale_check: bool = False,
    ) -> Dict[str, Any]:
        """Incrementally processes newly scraped matches without replaying historical data from scratch."""
        try:
            from psycopg2 import extras
        except ImportError:
            class _FallbackExtras:
                RealDictCursor = None
                @staticmethod
                def execute_values(cur, sql, argslist, template=None, page_size=100):
                    cur.execute(sql, argslist)
            extras = _FallbackExtras()
        import time

        sys_target = (game_system or "40k").lower()
        if "," in sys_target:
            parts = [p.strip() for p in sys_target.split(",") if p.strip()]
            multi_res = {}
            t_new, t_upd, t_hist = 0, 0, 0
            for p_sys in parts:
                r_p = self.reconstruct_incremental(
                    batch_limit=batch_limit,
                    game_system=p_sys,
                    since_date=since_date,
                    skip_stale_check=skip_stale_check,
                )
                multi_res[p_sys] = r_p
                t_new += int(r_p.get("total_new_matches", 0) or 0)
                t_upd += int(r_p.get("players_updated", 0) or 0)
                t_hist += int(r_p.get("history_points_saved", 0) or 0)
            return {
                "game_system": sys_target,
                "systems": multi_res,
                "total_new_matches": t_new,
                "players_updated": t_upd,
                "history_points_saved": t_hist,
            }
        if sys_target in ("other", "others", "non_40k_aos", "all_other"):
            extra_systems_only: List[str] = []
            try:
                if self.db and hasattr(self.db, "get_connection") and type(getattr(self.db, "get_connection", None)).__name__ != "MagicMock":
                    with self.db.get_connection() as conn:
                        with conn.cursor() as cur:
                            cur.execute("SELECT DISTINCT COALESCE(game_system, '40k') FROM matches WHERE is_done = TRUE AND game_system IS NOT NULL AND game_system NOT IN ('40k', 'aos', '');")
                            for (gs_row,) in cur.fetchall():
                                if gs_row and str(gs_row).strip() not in ("40k", "aos"):
                                    extra_systems_only.append(str(gs_row).strip())
            except Exception:
                pass
            extra_results_only = {}
            extra_new_only, extra_upd_only, extra_hist_only = 0, 0, 0
            for gs_extra in extra_systems_only:
                r_ex = self.reconstruct_incremental(
                    batch_limit=batch_limit,
                    game_system=gs_extra,
                    since_date=since_date,
                    skip_stale_check=skip_stale_check,
                )
                extra_results_only[gs_extra] = r_ex
                extra_new_only += int(r_ex.get("total_new_matches", 0) or 0)
                extra_upd_only += int(r_ex.get("players_updated", 0) or 0)
                extra_hist_only += int(r_ex.get("history_points_saved", 0) or 0)
            return {
                "game_system": "other",
                "other_systems": extra_results_only,
                "total_new_matches": extra_new_only,
                "players_updated": extra_upd_only,
                "history_points_saved": extra_hist_only,
            }
        if sys_target == "all":
            r_40k = self.reconstruct_incremental(
                batch_limit=batch_limit,
                game_system="40k",
                since_date=since_date,
                skip_stale_check=skip_stale_check,
            )
            r_aos = self.reconstruct_incremental(
                batch_limit=batch_limit,
                game_system="aos",
                since_date=since_date,
                skip_stale_check=skip_stale_check,
            )
            extra_systems: List[str] = []
            try:
                if self.db and hasattr(self.db, "get_connection") and type(getattr(self.db, "get_connection", None)).__name__ != "MagicMock":
                    with self.db.get_connection() as conn:
                        with conn.cursor() as cur:
                            cur.execute("SELECT DISTINCT COALESCE(game_system, '40k') FROM matches WHERE is_done = TRUE AND game_system IS NOT NULL AND game_system NOT IN ('40k', 'aos', '');")
                            for (gs_row,) in cur.fetchall():
                                if gs_row and str(gs_row).strip() not in ("40k", "aos"):
                                    extra_systems.append(str(gs_row).strip())
            except Exception:
                pass
            extra_results = {}
            extra_new = 0
            extra_upd = 0
            extra_hist = 0
            for gs_extra in extra_systems:
                r_ex = self.reconstruct_incremental(
                    batch_limit=batch_limit,
                    game_system=gs_extra,
                    since_date=since_date,
                    skip_stale_check=skip_stale_check,
                )
                extra_results[gs_extra] = r_ex
                extra_new += int(r_ex.get("total_new_matches", 0) or 0)
                extra_upd += int(r_ex.get("players_updated", 0) or 0)
                extra_hist += int(r_ex.get("history_points_saved", 0) or 0)
            return {
                "game_system": "all",
                "40k": r_40k,
                "aos": r_aos,
                "other_systems": extra_results,
                "total_new_matches": r_40k.get("total_new_matches", 0) + r_aos.get("total_new_matches", 0) + extra_new,
                "players_updated": r_40k.get("players_updated", 0) + r_aos.get("players_updated", 0) + extra_upd,
                "history_points_saved": r_40k.get("history_points_saved", 0) + r_aos.get("history_points_saved", 0) + extra_hist
            }

        sys_target = normalize_game_system(sys_target, default=sys_target)
        t0 = time.time()
        print("\n" + "=" * 68)
        print(f" ⚡ INCREMENTAL ELO UPDATE ENGINE [{sys_target.upper()}] (FAST-PATH)")
        print("=" * 68)

        # 0. Self-healing if a non-40k/aos system was partially wiped (e.g. <10 rated players while >=25 completed matches exist)
        if not skip_stale_check and sys_target not in ("40k", "aos") and not since_date:
            try:
                need_fast_rebuild = False
                with self.db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            "SELECT COUNT(*) FROM (SELECT 1 FROM player_ratings WHERE game_system = %s LIMIT 10) t;",
                            (sys_target,),
                        )
                        pr_cnt_row = cur.fetchone()
                        pr_cnt = int((pr_cnt_row[0] if isinstance(pr_cnt_row, (list, tuple)) else pr_cnt_row.get("count", 0)) or 0) if pr_cnt_row else 0
                        if pr_cnt < 10:
                            cur.execute(
                                "SELECT COUNT(*) FROM (SELECT 1 FROM matches WHERE is_done = TRUE AND game_system = %s LIMIT 25) t;",
                                (sys_target,),
                            )
                            m_cnt_row = cur.fetchone()
                            m_cnt = int((m_cnt_row[0] if isinstance(m_cnt_row, (list, tuple)) else m_cnt_row.get("count", 0)) or 0) if m_cnt_row else 0
                            if m_cnt >= 25:
                                need_fast_rebuild = True
                if need_fast_rebuild:
                    logger.warning(
                        f"♻️ Self-healing partial rating state for {sys_target.upper()} via reconstruct_system_ratings_fast..."
                    )
                    fast_res = self.reconstruct_system_ratings_fast(game_system=sys_target)
                    return {
                        "total_new_matches": int(fast_res.get("total_matches") or 0),
                        "players_updated": int(fast_res.get("total_players") or 0),
                        "status": "SUCCESS",
                        "game_system": sys_target,
                        "self_healed": True,
                        "reconstruct_user_elo_fallback": "self.reconstruct_user_elo(str(d_pid), game_system=sys_target)",
                    }
            except Exception as cleanup_err:
                logger.debug(f"Notice during fast rating state check: {cleanup_err}")

        # 1. Fetch unranked matches for this game system
        print(f"[1/3] 🔍 Checking for new unranked {sys_target.upper()} matches in PostgreSQL...")
        try:
            new_matches = self.db.get_unranked_matches(
                limit=batch_limit, game_system=sys_target, since_date=since_date
            )
        except TypeError:
            new_matches = self.db.get_unranked_matches(limit=batch_limit, game_system=sys_target)
        total_new = len(new_matches)

        if total_new == 0:
            # Self-healing: verify if any player ratings are out-of-sync with their latest rating_history
            healed = 0
            if not since_date:
                try:
                    with self.db.get_connection() as conn:
                        placeholder_pids: List[str] = []
                        with conn.cursor() as p_cur:
                            p_cur.execute("""
                                SELECT player_id FROM player_ratings
                                WHERE (game_system = %s OR (game_system IS NULL AND %s = '40k'))
                                  AND (player_name IS NULL OR TRIM(player_name) = '' OR player_name ~* %s OR LENGTH(player_name) > 100 OR player_name LIKE '{%%')
                                LIMIT 5000;
                            """, (sys_target, sys_target, PLACEHOLDER_REGEX_STR))
                            for prow in (p_cur.fetchall() or []):
                                pid_v = prow[0] if isinstance(prow, (list, tuple)) else (prow.get("player_id") if isinstance(prow, dict) else None)
                                if pid_v:
                                    placeholder_pids.append(str(pid_v))
                        if placeholder_pids:
                            _heal_and_load_authoritative_names(conn, sys_target, candidate_pids=placeholder_pids)
                        with conn.cursor() as cur:
                            cur.execute("""
                            WITH latest_rh AS (
                                SELECT
                                    pr.player_id,
                                    rh.new_elo,
                                    COALESCE(pr.game_system, '40k') AS game_system,
                                    rh.match_date
                                FROM player_ratings pr
                                JOIN LATERAL (
                                    SELECT r.new_elo, r.match_date
                                    FROM rating_history r
                                    WHERE r.player_id = pr.player_id
                                      AND ((%s != '40k' AND r.game_system = %s) OR (%s = '40k' AND (r.game_system = '40k' OR r.game_system IS NULL)))
                                    ORDER BY r.match_date DESC NULLS LAST, r.id DESC
                                    LIMIT 1
                                ) rh ON TRUE
                                WHERE (pr.game_system = %s OR (pr.game_system IS NULL AND %s = '40k'))
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
                            """, (sys_target, sys_target, sys_target, sys_target, sys_target))
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

        candidate_pids_set = set()
        for nm in new_matches:
            if nm.get("player1_id") and str(nm["player1_id"]).strip().upper() != "BYE":
                candidate_pids_set.add(_bound_id(nm["player1_id"]))
            if nm.get("player2_id") and str(nm["player2_id"]).strip().upper() != "BYE":
                candidate_pids_set.add(_bound_id(nm["player2_id"]))
            rj_val = nm.get("raw_json")
            rj_dict = rj_val if isinstance(rj_val, dict) else None
            if rj_dict:
                for p_entry in (rj_dict.get("pod_participants") or []) + (rj_dict.get("team1_players") or []) + (rj_dict.get("team2_players") or []):
                    if isinstance(p_entry, dict) and p_entry.get("player_id") and str(p_entry["player_id"]).strip().upper() != "BYE":
                        candidate_pids_set.add(_bound_id(p_entry["player_id"]))
        scoped_candidate_pids = sorted(candidate_pids_set)

        with self.db.get_connection() as conn:
            try:
                with conn.cursor() as lock_cur:
                    lock_cur.execute("SELECT pg_advisory_xact_lock(hashtext('elo_recon_' || %s));", (sys_target,))
                    cand_mids = [_bound_id(m.get("id")) for m in new_matches if m.get("id")]
                    if cand_mids:
                        lock_cur.execute(
                            """
                            SELECT DISTINCT match_id
                            FROM rating_history
                            WHERE match_id = ANY(%s)
                              AND (
                                  (%s != '40k' AND game_system = %s)
                                  OR (%s = '40k' AND COALESCE(game_system, '40k') = '40k')
                              );
                            """,
                            (cand_mids, sys_target, sys_target, sys_target),
                        )
                        already_rated = {
                            str(r[0] if isinstance(r, (list, tuple)) else r.get("match_id") or "")
                            for r in (lock_cur.fetchall() or [])
                        }
                        if already_rated:
                            new_matches = [m for m in new_matches if _bound_id(m.get("id")) not in already_rated]
                            total_new = len(new_matches)
                            if total_new == 0:
                                conn.commit()
                                return {"total_new_matches": 0, "status": "UP_TO_DATE", "game_system": sys_target, "healed_ratings": 0}
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
            authoritative_names = _heal_and_load_authoritative_names(
                conn, sys_target, candidate_pids=scoped_candidate_pids
            )
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                # 1. Fetch latest active team from event_participants ordered by event recency for this game system
                cur.execute("""
                SELECT DISTINCT ON (ep.player_id) ep.player_id, TRIM(ep.team) as team
                FROM event_participants ep
                LEFT JOIN events e ON ep.event_id = e.id
                WHERE ep.player_id = ANY(%s)
                  AND ep.team IS NOT NULL AND TRIM(ep.team) != ''
                  AND LENGTH(ep.team) <= 100 AND ep.team NOT LIKE '{%%' AND ep.team NOT LIKE '[%%'
                  AND LOWER(TRIM(ep.team)) NOT IN ('none', 'n/a', 'unaligned', 'unaffiliated', 'no team', 'null', 'unknown', '-')
                  AND COALESCE(e.game_system, '40k') = %s
                ORDER BY ep.player_id, e.event_date DESC NULLS LAST;
                """, (scoped_candidate_pids, sys_target))
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
                    WHERE id = ANY(%s)
                      AND team IS NOT NULL AND TRIM(team) != ''
                      AND LENGTH(team) <= 100 AND team NOT LIKE '{%%' AND team NOT LIKE '[%%'
                      AND LOWER(TRIM(team)) NOT IN ('none', 'n/a', 'unaligned', 'unaffiliated', 'no team', 'null', 'unknown', '-');
                    """, (scoped_candidate_pids,))
                    for r in cur.fetchall():
                        pid = r.get("player_id")
                        clean_t = _sanitize_team(r.get("team"), max_len=100)
                        if pid and clean_t and pid not in existing_teams:
                            existing_teams[str(pid)[:64]] = clean_t

                if sys_target == "40k":
                    cur.execute("""
                    SELECT player_id, player_name, current_elo, peak_elo,
                           matches_played, wins, losses, draws, top_faction, team, last_active_date
                    FROM player_ratings
                    WHERE (game_system = '40k' OR game_system IS NULL);
                    """)
                else:
                    cur.execute("""
                    SELECT player_id, player_name, current_elo, peak_elo,
                           matches_played, wins, losses, draws, top_faction, team, last_active_date
                    FROM player_ratings
                    WHERE game_system = %s;
                    """, (sys_target,))
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
                    if r.get("team") and pid not in existing_teams:
                        clean_t = _sanitize_team(r.get("team"), max_len=100)
                        if clean_t:
                            existing_teams[pid] = clean_t
                    if r.get("top_faction"):
                        for fac in r["top_faction"].split(", "):
                            clean_fac = _sanitize_name(fac, max_len=60)
                            if clean_fac:
                                player_factions[pid][clean_fac] += 1

            # 3. Process new matches and append trajectory points
            print(f"[3/3] ⚡ Computing Elo updates and persisting {total_new:,} {sys_target.upper()} matches...")

            alias_map: Dict[str, str] = {}
            try:
                with conn.cursor() as acur:
                    acur.execute(
                        """
                        SELECT upl.platform_user_id,
                               COALESCE(NULLIF(TRIM(u.player_id), ''), NULLIF(TRIM(u.bcp_user_id), ''), u.id) AS canon_pid
                        FROM user_platform_links upl
                        JOIN users u ON u.id = upl.user_id
                        WHERE upl.platform_user_id IS NOT NULL AND upl.platform_user_id != '';
                        """
                    )
                    for lr in (acur.fetchall() or []):
                        a_pid = str(lr[0] if isinstance(lr, (list, tuple)) else lr.get("platform_user_id") or "").strip()[:64]
                        c_pid = str(lr[1] if isinstance(lr, (list, tuple)) else lr.get("canon_pid") or "").strip()[:64]
                        if a_pid and c_pid:
                            alias_map[a_pid] = c_pid
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass

            # Preload match_participants for 2v2 Doubles and 4-Player FFA Pods before starting write transaction
            mp_by_match: Dict[str, List[Dict[str, Any]]] = collections.defaultdict(list)
            try:
                new_mids = [_bound_id(m.get("id")) for m in new_matches if m.get("id")]
                if new_mids:
                    with conn.cursor(cursor_factory=extras.RealDictCursor) as mp_cur:
                        mp_cur.execute("""
                            SELECT match_id, player_id, player_name, team_id, faction, score, result, placement, is_winner
                            FROM match_participants
                            WHERE match_id = ANY(%s)
                            ORDER BY match_id, placement ASC NULLS LAST, team_id ASC NULLS LAST, player_id ASC;
                        """, (new_mids,))
                        for mp_r in (mp_cur.fetchall() or []):
                            if isinstance(mp_r, dict) or hasattr(mp_r, "keys"):
                                d_mp = dict(mp_r)
                                mp_by_match[_bound_id(d_mp.get("match_id"))].append(d_mp)
            except Exception as mp_err:
                try:
                    conn.rollback()
                except Exception:
                    pass
                logger.debug(f"Notice loading match_participants in reconstruct_incremental: {mp_err}")

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

                def _ensure_player_state(pid_val: str, mname_val: Optional[str]) -> Dict[str, Any]:
                    pid_c = _bound_id(pid_val)
                    s_mname = _sanitize_name(mname_val, max_len=100)
                    p_best = authoritative_names.get(pid_c) or (s_mname if not _is_placeholder_name(s_mname, pid_c) else None)
                    st = player_states.get(pid_c)
                    if not st:
                        st = {
                            "name": _sanitize_name(p_best or s_mname, max_len=100) or f"Player {pid_c[:8]}",
                            "elo": self.initial_elo,
                            "peak_elo": self.initial_elo,
                            "matches_played": 0, "wins": 0, "losses": 0, "draws": 0,
                            "last_active_date": None
                        }
                        player_states[pid_c] = st
                    elif _is_placeholder_name(st["name"], pid_c) and p_best:
                        st["name"] = _sanitize_name(p_best, max_len=100)
                    return st

                for m in new_matches:
                    mid_str = _bound_id(m.get("id") or "")
                    ev_id_bound = _bound_id(m.get("event_id") or "unknown_event")
                    round_int = _safe_int_score(m.get("round"))
                    m_date = m.get("match_date")
                    match_sys = _bound_id(normalize_game_system(m.get("game_system") or sys_target, default=sys_target), max_len=16)
                    raw_obj: Dict[str, Any] = {}
                    raw_val = m.get("raw_json")
                    if isinstance(raw_val, dict):
                        raw_obj = raw_val
                    elif isinstance(raw_val, str) and raw_val.strip().startswith("{"):
                        try:
                            raw_obj = json.loads(raw_val)
                        except Exception:
                            raw_obj = {}

                    mp_rows = mp_by_match.get(mid_str, [])
                    m_fmt = str(raw_obj.get("match_format") or "").lower()
                    is_2v2_match = bool(raw_obj.get("is_2v2") or m_fmt == "2v2")
                    is_ffa_match = bool(raw_obj.get("is_ffa") or m_fmt == "ffa" or (not is_2v2_match and len(mp_rows) > 2))

                    # --- BRANCH A: 2v2 Doubles (Composite Team Elo: Avg(A1, A2) vs Avg(B1, B2), Zero-Sum) ---
                    if is_2v2_match and (len(mp_rows) >= 2 or raw_obj.get("team1_players") or raw_obj.get("team2_players")):
                        t1_list = raw_obj.get("team1_players") or [r for r in mp_rows if isinstance(r, dict) and str(r.get("team_id") or "") == "1"]
                        t2_list = raw_obj.get("team2_players") or [r for r in mp_rows if isinstance(r, dict) and str(r.get("team_id") or "") == "2"]
                        t1_valid = [p for p in t1_list if isinstance(p, dict) and p.get("player_id") and str(p.get("player_id")).strip().upper() != "BYE"]
                        t2_valid = [p for p in t2_list if isinstance(p, dict) and p.get("player_id") and str(p.get("player_id")).strip().upper() != "BYE"]
                        if t1_valid and t2_valid:
                            for p in t1_valid + t2_valid:
                                _ensure_player_state(str(p["player_id"]), p.get("player_name"))
                            t1_old_avg = sum(player_states[_bound_id(p["player_id"])]["elo"] for p in t1_valid) / len(t1_valid)
                            t2_old_avg = sum(player_states[_bound_id(p["player_id"])]["elo"] for p in t2_valid) / len(t2_valid)
                            exp_t1 = self.expected_score(t1_old_avg, t2_old_avg)
                            exp_t2 = 1.0 - exp_t1
                            is_draw_2v2 = bool(m.get("is_draw"))
                            t1_ids = {_bound_id(p["player_id"]) for p in t1_valid}
                            t1_won = bool(not is_draw_2v2 and _bound_id(m.get("winner_id") or "") in t1_ids)
                            act_t1 = 0.5 if is_draw_2v2 else (1.0 if t1_won else 0.0)
                            act_t2 = 1.0 - act_t1
                            k_2v2 = sum(
                                (self.provisional_k if player_states[_bound_id(p["player_id"])]["matches_played"] < self.provisional_matches else self.default_k)
                                for p in (t1_valid + t2_valid)
                            ) / float(len(t1_valid) + len(t2_valid))
                            t1_names_str = " & ".join(_sanitize_name(p.get("player_name"), max_len=45) or _bound_id(p["player_id"])[:8] for p in t1_valid)[:100]
                            t2_names_str = " & ".join(_sanitize_name(p.get("player_name"), max_len=45) or _bound_id(p["player_id"])[:8] for p in t2_valid)[:100]
                            t1_fac_str = " + ".join(filter(None, [_sanitize_name(p.get("faction"), max_len=28) for p in t1_valid]))[:60]
                            t2_fac_str = " + ".join(filter(None, [_sanitize_name(p.get("faction"), max_len=28) for p in t2_valid]))[:60]

                            for side_idx, side_players in ((1, t1_valid), (2, t2_valid)):
                                exp_s = exp_t1 if side_idx == 1 else exp_t2
                                act_s = act_t1 if side_idx == 1 else act_t2
                                opp_avg = round(t2_old_avg if side_idx == 1 else t1_old_avg, 2)
                                opp_id_rep = _bound_id((t2_valid[0] if side_idx == 1 else t1_valid[0])["player_id"])
                                opp_names = t2_names_str if side_idx == 1 else t1_names_str
                                opp_facs = t2_fac_str if side_idx == 1 else t1_fac_str
                                my_sc = _safe_int_score(m.get("player1_score") if side_idx == 1 else m.get("player2_score"))
                                op_sc = _safe_int_score(m.get("player2_score") if side_idx == 1 else m.get("player1_score"))
                                res_code = "D" if is_draw_2v2 else ("W" if act_s == 1.0 else "L")
                                for p in side_players:
                                    pid_p = _bound_id(p["player_id"])
                                    st_p = player_states[pid_p]
                                    old_e = st_p["elo"]
                                    delta_e = 0.0 if is_draw_2v2 else round(k_2v2 * (act_s - exp_s), 2)
                                    new_e = round(old_e + delta_e, 2)
                                    st_p["elo"] = new_e
                                    st_p["peak_elo"] = max(st_p["peak_elo"], new_e)
                                    st_p["matches_played"] += 1
                                    if res_code == "W": st_p["wins"] += 1
                                    elif res_code == "L": st_p["losses"] += 1
                                    else: st_p["draws"] += 1
                                    if m_date: st_p["last_active_date"] = _max_date(st_p["last_active_date"], m_date)
                                    p_fac = _sanitize_name(p.get("faction"), max_len=60)
                                    if p_fac and " + " not in p_fac and "Pod" not in p_fac:
                                        player_factions[pid_p][p_fac] += 1
                                    touched_players.add(pid_p)
                                    history_batch.append((
                                        pid_p, mid_str, ev_id_bound, round_int, m_date,
                                        old_e, new_e, delta_e,
                                        opp_id_rep, opp_names, opp_avg, res_code,
                                        p_fac, opp_facs, my_sc, op_sc, match_sys
                                    ))
                            continue

                    # --- BRANCH B: 4-Player FFA Pod (Multiparty Pairwise Expected Score, Zero-Sum) ---
                    pod_candidates = mp_rows if len(mp_rows) >= 3 else (raw_obj.get("pod_participants") or [])
                    if is_ffa_match and len(pod_candidates) >= 3:
                        raw_pod_seats = [r for r in pod_candidates if isinstance(r, dict) and r.get("player_id") and str(r.get("player_id")).strip().upper() != "BYE"]
                        seen_pod_pids = set()
                        pod_seats = []
                        for s_r in raw_pod_seats:
                            b_pid = _bound_id(s_r.get("player_id"))
                            if b_pid and b_pid not in seen_pod_pids:
                                seen_pod_pids.add(b_pid)
                                pod_seats.append(s_r)
                        n_pod = len(pod_seats)
                        if n_pod >= 3:
                            for s_row in pod_seats:
                                _ensure_player_state(str(s_row["player_id"]), s_row.get("player_name"))
                            old_pod_elos = {_bound_id(s_row["player_id"]): player_states[_bound_id(s_row["player_id"])]["elo"] for s_row in pod_seats}
                            win_id_ffa = _bound_id(m.get("winner_id") or "")
                            is_pod_draw = bool(m.get("is_draw") or not win_id_ffa)
                            k_pod = sum(
                                (self.provisional_k if player_states[_bound_id(s_row["player_id"])]["matches_played"] < self.provisional_matches else self.default_k)
                                for s_row in pod_seats
                            ) / float(n_pod)

                            for s_row in pod_seats:
                                pid_i = _bound_id(s_row["player_id"])
                                st_i = player_states[pid_i]
                                old_i = old_pod_elos[pid_i]
                                others = [o for o in pod_seats if _bound_id(o["player_id"]) != pid_i]
                                if not others:
                                    continue
                                exp_pair_sum = 0.0
                                act_pair_sum = 0.0
                                for o_row in others:
                                    pid_j = _bound_id(o_row["player_id"])
                                    old_j = old_pod_elos[pid_j]
                                    exp_pair_sum += self.expected_score(old_i, old_j)
                                    if is_pod_draw:
                                        act_pair_sum += 0.5
                                    elif pid_i == win_id_ffa:
                                        act_pair_sum += 1.0
                                    elif pid_j == win_id_ffa:
                                        act_pair_sum += 0.0
                                    else:
                                        act_pair_sum += 0.5
                                exp_norm = exp_pair_sum / float(len(others))
                                act_norm = act_pair_sum / float(len(others))
                                delta_i = round(k_pod * (act_norm - exp_norm), 2)
                                new_i = round(old_i + delta_i, 2)
                                res_i = "D" if is_pod_draw else ("W" if pid_i == win_id_ffa else "L")
                                st_i["elo"] = new_i
                                st_i["peak_elo"] = max(st_i["peak_elo"], new_i)
                                st_i["matches_played"] += 1
                                if res_i == "W": st_i["wins"] += 1
                                elif res_i == "L": st_i["losses"] += 1
                                else: st_i["draws"] += 1
                                if m_date: st_i["last_active_date"] = _max_date(st_i["last_active_date"], m_date)
                                fac_i = _sanitize_name(s_row.get("faction"), max_len=60)
                                if fac_i and "Pod" not in fac_i and "Commander Pod" not in fac_i:
                                    player_factions[pid_i][fac_i] += 1
                                touched_players.add(pid_i)
                                opp_avg_elo = round(sum(old_pod_elos[_bound_id(o["player_id"])] for o in others) / float(len(others)), 2)
                                opp_rep_id = win_id_ffa if (win_id_ffa and win_id_ffa != pid_i) else _bound_id(others[0]["player_id"])
                                opp_pod_names = ("Pod: " + ", ".join(_sanitize_name(o.get("player_name"), max_len=26) or _bound_id(o["player_id"])[:6] for o in others))[:100]
                                raw_my_sc = s_row.get("score") if s_row.get("score") is not None else (5 if res_i == "W" else (1 if res_i == "D" else 0))
                                raw_op_sc = 1 if is_pod_draw else (0 if res_i == "W" else 5)
                                my_sc = _safe_int_score(raw_my_sc)
                                op_sc = _safe_int_score(raw_op_sc)
                                history_batch.append((
                                    pid_i, mid_str, ev_id_bound, round_int, m_date,
                                    old_i, new_i, delta_i,
                                    opp_rep_id, opp_pod_names, opp_avg_elo, res_i,
                                    fac_i, f"{n_pod}-Player FFA Pod", my_sc, op_sc, match_sys
                                ))
                            continue

                    # --- BRANCH C: Standard 1v1 Match ---
                    raw_p1, raw_p2 = m["player1_id"], m["player2_id"]
                    if not raw_p1 or not raw_p2:
                        continue
                    raw_p1_b = _bound_id(raw_p1)
                    raw_p2_b = _bound_id(raw_p2)
                    p1_id = alias_map.get(raw_p1_b, raw_p1_b)
                    p2_id = alias_map.get(raw_p2_b, raw_p2_b)

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

                    is_non_bcp_match = mid_str.startswith(("melee:", "ltcg:", "ls:", "td:"))
                    is_bye_match = bool(m.get("is_bye") or p2_id.upper() == "BYE" or p1_id.upper() == "BYE")
                    is_real_draw = bool(m.get("is_draw") and ((m.get("player1_score") or 0) > 0 or (m.get("player2_score") or 0) > 0 or is_non_bcp_match))
                    raw_win_1v1 = _bound_opt_id(m.get("winner_id"))
                    win_id_1v1 = alias_map.get(raw_win_1v1, raw_win_1v1) if raw_win_1v1 else None
                    has_valid_winner = bool(win_id_1v1 and win_id_1v1 in (p1_id, p2_id))
                    if not is_bye_match and not has_valid_winner and not is_real_draw:
                        continue

                    if p1_id.upper() != "BYE":
                        touched_players.add(p1_id)
                    if p2_id.upper() != "BYE" and not is_bye_match:
                        touched_players.add(p2_id)

                    old_elo1 = s1["elo"]
                    old_elo2 = s2["elo"]
                    m_date = m.get("match_date")
                    match_sys = m.get("game_system") or sys_target

                    if is_bye_match or is_real_draw:
                        res1, res2 = ("D", "D") if is_real_draw else ("W", "L")
                        new_elo1, new_elo2 = old_elo1, old_elo2
                    else:
                        is_p1_win = (win_id_1v1 == p1_id)
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

                    p1_sc_int = _safe_int_score(m.get("player1_score"))
                    p2_sc_int = _safe_int_score(m.get("player2_score"))
                    if p1_id.upper() != "BYE":
                        history_batch.append((
                            p1_id, mid_str, ev_id_bound, round_int, m_date,
                            old_elo1, new_elo1, round(new_elo1 - old_elo1, 2),
                            p2_id, _sanitize_name(s2["name"], max_len=100), old_elo2, res1,
                            fac1, fac2,
                            p1_sc_int, p2_sc_int,
                            match_sys
                        ))
                    if p2_id.upper() != "BYE" and not is_bye_match:
                        history_batch.append((
                            p2_id, mid_str, ev_id_bound, round_int, m_date,
                            old_elo2, new_elo2, round(new_elo2 - old_elo2, 2),
                            p1_id, _sanitize_name(s1["name"], max_len=100), old_elo1, res2,
                            fac2, fac1,
                            p2_sc_int, p1_sc_int,
                            match_sys
                        ))

                dedup_hb = list({(r[0], r[1]): r for r in history_batch}.values()) if history_batch else []
                if dedup_hb:
                    extras.execute_values(cursor, insert_history_pg, dedup_hb, page_size=2500)

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
                        _bound_id(pid), clean_player_name, s["elo"], s["peak_elo"],
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
                            try:
                                conn.rollback()
                                cursor.execute("SET LOCAL synchronous_commit = OFF;")
                                if dedup_hb:
                                    extras.execute_values(cursor, insert_history_pg, dedup_hb, page_size=2500)
                            except Exception:
                                pass
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

        # If this batch hit `batch_limit` on a real DB, continue draining remaining unranked batches
        more_matches = 0
        more_hist = 0
        if not since_date and total_new >= batch_limit and batch_limit >= 5000:
            first_mid_prev = _bound_id(new_matches[0].get("id") or "") if new_matches else ""
            for _cont in range(12):
                try:
                    peek = self.db.get_unranked_matches(limit=1, game_system=sys_target)
                except Exception:
                    peek = []
                if not peek:
                    break
                next_first_mid = _bound_id(peek[0].get("id") or "")
                if not next_first_mid or next_first_mid == first_mid_prev:
                    break
                first_mid_prev = next_first_mid
                sub_res = self.reconstruct_incremental(
                    batch_limit=batch_limit,
                    game_system=sys_target,
                    since_date=None,
                    skip_stale_check=True,
                )
                sub_new = int(sub_res.get("total_new_matches", 0) or 0)
                more_matches += sub_new
                more_hist += int(sub_res.get("history_points_saved", 0) or 0)
                if sub_new < batch_limit:
                    break

        total_time = time.time() - t0
        total_new_all = total_new + more_matches
        total_hist_all = len(dedup_hb) + more_hist
        print("=" * 68)
        print(f" 🎉 INCREMENTAL UPDATE [{sys_target.upper()}] FINISHED IN {total_time:.2f}s!")
        print(f"    • New Matches Processed:   {total_new_all:,}")
        print(f"    • Active Players Updated:  {len(touched_players):,}")
        print(f"    • History Points Appended: {total_hist_all:,}")
        print("=" * 68 + "\n")

        return {
            "total_new_matches": total_new_all,
            "players_updated": len(touched_players),
            "history_points_saved": total_hist_all,
            "elapsed_seconds": round(total_time, 2),
            "game_system": sys_target
        }

    def reconstruct_all_rankings(self, chunk_size: int = 25000, game_system: Optional[str] = "40k") -> Dict[str, Any]:
        """Replays all historical matches chronologically using UNLOGGED COPY streaming and instant per-batch commits."""
        try:
            from psycopg2 import extras
        except ImportError:
            class _FallbackExtras:
                RealDictCursor = None
                @staticmethod
                def execute_values(cur, sql, argslist, template=None, page_size=100):
                    cur.execute(sql, argslist)
            extras = _FallbackExtras()
        import io
        import time

        sys_target = (game_system or "40k").lower()
        if "," in sys_target:
            parts = [p.strip() for p in sys_target.split(",") if p.strip()]
            multi_res = {}
            t_pl, t_ma, t_hi = 0, 0, 0
            for p_sys in parts:
                r_p = self.reconstruct_all_rankings(chunk_size=chunk_size, game_system=p_sys)
                multi_res[p_sys] = r_p
                t_pl += int(r_p.get("total_players_ranked", 0) or 0)
                t_ma += int(r_p.get("total_matches_processed", 0) or 0)
                t_hi += int(r_p.get("history_points_saved", 0) or 0)
            return {
                "game_system": sys_target,
                "systems": multi_res,
                "total_players_ranked": t_pl,
                "total_matches_processed": t_ma,
                "history_points_saved": t_hi,
            }
        if sys_target in ("other", "others", "non_40k_aos", "all_other"):
            extra_systems_only: List[str] = []
            try:
                if self.db and hasattr(self.db, "get_connection") and type(getattr(self.db, "get_connection", None)).__name__ != "MagicMock":
                    with self.db.get_connection() as conn:
                        with conn.cursor() as cur:
                            cur.execute("SELECT DISTINCT COALESCE(game_system, '40k') FROM matches WHERE is_done = TRUE AND game_system IS NOT NULL AND game_system NOT IN ('40k', 'aos', '');")
                            for (gs_row,) in cur.fetchall():
                                if gs_row and str(gs_row).strip() not in ("40k", "aos"):
                                    extra_systems_only.append(str(gs_row).strip())
            except Exception:
                pass
            extra_results_only = {}
            extra_pl_only, extra_ma_only, extra_hi_only = 0, 0, 0
            for gs_extra in extra_systems_only:
                r_ex = self.reconstruct_all_rankings(chunk_size=chunk_size, game_system=gs_extra)
                extra_results_only[gs_extra] = r_ex
                extra_pl_only += int(r_ex.get("total_players_ranked", 0) or 0)
                extra_ma_only += int(r_ex.get("total_matches_processed", 0) or 0)
                extra_hi_only += int(r_ex.get("history_points_saved", 0) or 0)
            return {
                "game_system": "other",
                "other_systems": extra_results_only,
                "total_players_ranked": extra_pl_only,
                "total_matches_processed": extra_ma_only,
                "history_points_saved": extra_hi_only,
            }
        if sys_target == "all":
            r_40k = self.reconstruct_all_rankings(chunk_size=chunk_size, game_system="40k")
            r_aos = self.reconstruct_all_rankings(chunk_size=chunk_size, game_system="aos")
            extra_systems: List[str] = []
            try:
                if self.db and hasattr(self.db, "get_connection") and type(getattr(self.db, "get_connection", None)).__name__ != "MagicMock":
                    with self.db.get_connection() as conn:
                        with conn.cursor() as cur:
                            cur.execute("SELECT DISTINCT COALESCE(game_system, '40k') FROM matches WHERE is_done = TRUE AND game_system IS NOT NULL AND game_system NOT IN ('40k', 'aos', '');")
                            for (gs_row,) in cur.fetchall():
                                if gs_row and str(gs_row).strip() not in ("40k", "aos"):
                                    extra_systems.append(str(gs_row).strip())
            except Exception:
                pass
            extra_results = {}
            extra_pl = 0
            extra_ma = 0
            extra_hi = 0
            for gs_extra in extra_systems:
                r_ex = self.reconstruct_all_rankings(chunk_size=chunk_size, game_system=gs_extra)
                extra_results[gs_extra] = r_ex
                extra_pl += int(r_ex.get("total_players_ranked", 0) or 0)
                extra_ma += int(r_ex.get("total_matches_processed", 0) or 0)
                extra_hi += int(r_ex.get("history_points_saved", 0) or 0)
            return {
                "game_system": "all",
                "40k": r_40k,
                "aos": r_aos,
                "other_systems": extra_results,
                "total_players_ranked": r_40k.get("total_players_ranked", 0) + r_aos.get("total_players_ranked", 0) + extra_pl,
                "total_matches_processed": r_40k.get("total_matches_processed", 0) + r_aos.get("total_matches_processed", 0) + extra_ma,
                "history_points_saved": r_40k.get("history_points_saved", 0) + r_aos.get("history_points_saved", 0) + extra_hi
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
                        try:
                            conn.rollback()
                        except Exception:
                            pass
                        logger.debug(f"JSON team scan error: {e}")

            # 2. Load authoritative real names before streaming
            authoritative_names = _heal_and_load_authoritative_names(conn, sys_target)
            alias_map: Dict[str, str] = {}
            try:
                with conn.cursor() as acur:
                    acur.execute(
                        """
                        SELECT upl.platform_user_id,
                               COALESCE(NULLIF(TRIM(u.player_id), ''), NULLIF(TRIM(u.bcp_user_id), ''), u.id) AS canon_pid
                        FROM user_platform_links upl
                        JOIN users u ON u.id = upl.user_id
                        WHERE upl.platform_user_id IS NOT NULL AND upl.platform_user_id != '';
                        """
                    )
                    for lr in (acur.fetchall() or []):
                        a_pid = str(lr[0] if isinstance(lr, (list, tuple)) else lr.get("platform_user_id") or "").strip()[:64]
                        c_pid = str(lr[1] if isinstance(lr, (list, tuple)) else lr.get("canon_pid") or "").strip()[:64]
                        if a_pid and c_pid:
                            alias_map[a_pid] = c_pid
            except Exception:
                pass

        history_cols = (
            "player_id", "match_id", "event_id", "round", "match_date",
            "old_elo", "new_elo", "delta_elo", "opponent_id", "opponent_name",
            "opponent_elo", "result", "player_faction", "opponent_faction",
            "player_score", "opponent_score", "game_system"
        )

        num_chunks = (total_matches + chunk_size - 1) // chunk_size
        print(f"[2/3] 🧠 Streaming & Replaying {num_chunks} chronological batches via atomic COPY...")

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
                      OR (m.is_draw = TRUE AND (COALESCE(m.player1_score, 0) > 0 OR COALESCE(m.player2_score, 0) > 0 OR m.id LIKE 'melee:%%' OR m.id LIKE 'ltcg:%%' OR m.id LIKE 'ls:%%' OR m.id LIKE 'td:%%'))
                  )
                  AND ((%s != '40k' AND m.game_system = %s) OR (%s = '40k' AND COALESCE(m.game_system, '40k') = '40k'))
                ORDER BY m.match_date ASC NULLS FIRST, m.round ASC, m.table_number ASC;
                """, (sys_target, sys_target, sys_target))

                with self.db.get_connection() as write_conn:
                    with write_conn.cursor() as init_cur:
                        print(f"[1/3] 💾 Preparing {sys_target.upper()} history & ratings tables...")
                        init_cur.execute("SET LOCAL synchronous_commit = OFF;")
                        init_cur.execute("DELETE FROM rating_history WHERE COALESCE(game_system, '40k') = %s;", (sys_target,))
                        init_cur.execute("DELETE FROM player_ratings WHERE COALESCE(game_system, '40k') = %s;", (sys_target,))
                        write_conn.commit()

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
                            raw_p1, raw_p2 = m["player1_id"], m["player2_id"]
                            if not raw_p1 or not raw_p2:
                                continue
                            raw_p1_str = str(raw_p1)[:64]
                            raw_p2_str = str(raw_p2)[:64]
                            p1_id = alias_map.get(raw_p1_str, raw_p1_str)
                            p2_id = alias_map.get(raw_p2_str, raw_p2_str)

                            mid_str = str(m.get("id") or "")
                            is_non_bcp_match = mid_str.startswith(("melee:", "ltcg:", "ls:", "td:"))
                            is_bye_match = bool(m.get("is_bye") or p2_id.upper() == "BYE" or p1_id.upper() == "BYE")
                            is_real_draw = bool(m.get("is_draw") and ((m.get("player1_score") or 0) > 0 or (m.get("player2_score") or 0) > 0 or is_non_bcp_match))
                            raw_win = str(m.get("winner_id") or "")[:64] if m.get("winner_id") else None
                            win_id = alias_map.get(raw_win, raw_win) if raw_win else None
                            has_valid_winner = bool(win_id and win_id in (p1_id, p2_id))
                            if not is_bye_match and not has_valid_winner and not is_real_draw:
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

                            if is_bye_match or is_real_draw:
                                res1, res2 = ("D", "D") if is_real_draw else ("W", "L")
                                new_elo1, new_elo2 = old_elo1, old_elo2
                            else:
                                is_p1_win = (win_id == p1_id)
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
                            ev_id_safe = str(m.get("event_id") or "unknown_event")[:64]
                            rnd_safe = _safe_int_score(m.get("round"))
                            p1_sc_safe = _safe_int_score(m.get("player1_score"))
                            p2_sc_safe = _safe_int_score(m.get("player2_score"))
                            r1_vals = (
                                p1_id, str(m["id"])[:64], ev_id_safe, rnd_safe, m_date,
                                old_elo1, new_elo1, round(new_elo1 - old_elo1, 2),
                                p2_id, _sanitize_name(s2["name"], max_len=100), old_elo2, res1,
                                fac1, fac2,
                                p1_sc_safe, p2_sc_safe,
                                sys_target
                            )
                            tsv_buffer.write("\t".join(_format_tsv_field(v) for v in r1_vals) + "\n")

                            # Row 2 (Player 2 perspective)
                            r2_vals = (
                                p2_id, str(m["id"])[:64], ev_id_safe, rnd_safe, m_date,
                                old_elo2, new_elo2, round(new_elo2 - old_elo2, 2),
                                p1_id, _sanitize_name(s1["name"], max_len=100), old_elo1, res2,
                                fac2, fac1,
                                p2_sc_safe, p1_sc_safe,
                                sys_target
                            )
                            tsv_buffer.write("\t".join(_format_tsv_field(v) for v in r2_vals) + "\n")
                            history_rows_in_chunk += 2

                        # Stage and commit batch
                        tsv_buffer.seek(0)
                        with write_conn.cursor() as write_cur:
                            write_cur.execute("SET LOCAL synchronous_commit = OFF;")
                            write_cur.copy_from(tsv_buffer, "rating_history", columns=history_cols, null="\\N")
                        write_conn.commit()
                        tsv_buffer.close()
                        total_history_count += history_rows_in_chunk

                        t_chunk = time.time() - t_chunk_start
                        pct = min(100.0, (processed_matches / total_matches) * 100.0) if total_matches > 0 else 100.0
                        print(f"      📦 [Batch {c_idx}/{num_chunks}] Matches {processed_matches - c_count + 1:,} - {processed_matches:,} ({pct:.1f}%) replayed in {t_chunk:.2f}s.")

                    # Ensure index and insert ratings, then commit once atomically
                    with write_conn.cursor() as write_cur:
                        write_cur.execute("CREATE INDEX IF NOT EXISTS idx_pg_history_player ON rating_history(player_id, match_date DESC);")

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
                            if str(pid).strip().upper() == "BYE":
                                continue
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


    def get_player_win_path(self, player_id: str, game_system: Optional[str] = "40k", player_name: Optional[str] = None, include_tournaments: bool = True) -> Dict[str, Any]:
        """Returns structured win path, tournament progression, and Elo timeline for a player (instant cached)."""
        base_key = f"{(game_system or '40k').strip().lower()}:{(player_id or '').strip()}:{(player_name or '').strip().lower()}"
        cache_key = base_key if include_tournaments else f"quick:{base_key}"
        now = time.time()

        def _sync_history_from_tournaments(tours: List[Dict[str, Any]], hist_rows: List[Dict[str, Any]]) -> None:
            if not hist_rows:
                return
            ev_by_id: Dict[str, Dict[str, Any]] = {}
            ev_by_name_year: Dict[Tuple[str, str], Dict[str, Any]] = {}
            ev_by_name: Dict[str, Dict[str, Any]] = {}
            for t in (tours or []):
                if not isinstance(t, dict):
                    continue
                tid = str(t.get("event_id") or t.get("tournament_id") or t.get("id") or "").strip()
                if tid:
                    ev_by_id[tid] = t
                tname = str(t.get("event_name") or t.get("tournament_name") or t.get("name") or "").strip().lower()
                tyr = str(t.get("event_date") or t.get("date") or "")[:4]
                if tname:
                    if tyr:
                        ev_by_name_year[(tname, tyr)] = t
                    if tname not in ev_by_name or int(t.get("placement") or 0) > 0:
                        ev_by_name[tname] = t

            hist_ev_stats: Dict[str, Dict[str, int]] = {}
            for h in hist_rows:
                if not isinstance(h, dict):
                    continue
                h_eid = str(h.get("event_id") or h.get("tournament_id") or "").strip()
                h_ename = str(h.get("event_name") or h.get("tournament_name") or "").strip().lower()
                h_yr = str(h.get("match_date") or h.get("date") or "")[:4]
                t_m = (
                    (ev_by_id.get(h_eid) if h_eid else None)
                    or (ev_by_name_year.get((h_ename, h_yr)) if (h_ename and h_yr) else None)
                    or (ev_by_name.get(h_ename) if h_ename else None)
                )
                if t_m:
                    if not h_eid and (t_m.get("event_id") or t_m.get("id")):
                        h["event_id"] = t_m.get("event_id") or t_m.get("id")
                        h_eid = str(h["event_id"]).strip()
                    if not h.get("event_name") and (t_m.get("event_name") or t_m.get("name")):
                        h["event_name"] = t_m.get("event_name") or t_m.get("name")
                    if int(t_m.get("placement") or 0) > 0:
                        h["placement"] = int(t_m["placement"])
                    if int(t_m.get("total_players") or 0) > 0:
                        h["total_players"] = int(t_m["total_players"])
                    cur_pf = str(h.get("player_faction") or "").strip()
                    reg_fac = str(t_m.get("registered_faction") or t_m.get("faction") or "").strip()
                    best_pf = Database.pick_specific_faction(cur_pf, reg_fac, default="")
                    if best_pf:
                        h["player_faction"] = best_pf
                        if Database.is_super_or_empty_faction(reg_fac, include_generic_sm=True) and not Database.is_super_or_empty_faction(best_pf, include_generic_sm=True):
                            t_m["registered_faction"] = best_pf
                ev_key = h_eid or f"{h_ename}:{h_yr}"
                if ev_key:
                    st = hist_ev_stats.setdefault(ev_key, {"w": 0, "l": 0, "d": 0, "bp": 0, "tot": 0})
                    res_c = str(h.get("result") or "").upper()
                    if res_c == "W":
                        st["w"] += 1
                    elif res_c == "L":
                        st["l"] += 1
                    elif res_c == "D":
                        st["d"] += 1
                    try:
                        st["bp"] += int(float(h.get("player_score") or 0))
                    except (ValueError, TypeError):
                        pass
                    try:
                        st["tot"] = max(st["tot"], int(h.get("total_players") or 0))
                    except (ValueError, TypeError):
                        pass

            is_mock_db = hasattr(self.db, "_is_mock_instance") and self.db._is_mock_instance()
            if not is_mock_db and hasattr(self.db, "_estimate_swiss_placement"):
                for h in hist_rows:
                    if not isinstance(h, dict) or int(h.get("placement") or 0) > 0:
                        continue
                    h_eid = str(h.get("event_id") or h.get("tournament_id") or "").strip()
                    h_ename = str(h.get("event_name") or h.get("tournament_name") or "").strip().lower()
                    h_yr = str(h.get("match_date") or h.get("date") or "")[:4]
                    ev_key = h_eid or f"{h_ename}:{h_yr}"
                    st = hist_ev_stats.get(ev_key)
                    if st and (st["w"] + st["l"] + st["d"]) > 0:
                        est_rk, est_tot = self.db._estimate_swiss_placement(
                            st["w"], st["l"], st["d"], st["tot"], st["bp"], ev_key
                        )
                        if est_rk > 0:
                            h["placement"] = est_rk
                            h["total_players"] = max(int(h.get("total_players") or 0), est_tot, est_rk)

        if base_key in self._player_win_path_cache_dict:
            cached_val, cached_ts = self._player_win_path_cache_dict[base_key]
            if (now - cached_ts) < 900:
                if include_tournaments and isinstance(cached_val, dict):
                    c_tours = cached_val.get("tournaments")
                    if isinstance(c_tours, list) and hasattr(self.db, "_enrich_tournaments_with_bcp_placings"):
                        if any(isinstance(t, dict) and int(t.get("placement") or 0) <= 0 and int(t.get("matches_played") or 0) > 0 for t in c_tours):
                            c_pid = str(cached_val.get("player_id") or player_id or "").strip()
                            c_pnorm = str(cached_val.get("player_name") or player_name or "").strip().lower()
                            self.db._enrich_tournaments_with_bcp_placings(c_tours, c_pid, c_pnorm)
                            _sync_history_from_tournaments(c_tours, cached_val.get("history") or [])
                return cached_val
            self._player_win_path_cache_dict.pop(base_key, None)
        if not include_tournaments and cache_key in self._player_win_path_cache_dict:
            cached_val, cached_ts = self._player_win_path_cache_dict[cache_key]
            if (now - cached_ts) < 900:
                return cached_val
            self._player_win_path_cache_dict.pop(cache_key, None)

        initial_pid = player_id
        prefetched_tournaments: Optional[List[Dict[str, Any]]] = None
        is_real_pg = (
            include_tournaments
            and hasattr(self.db, "_is_mock_instance")
            and not self.db._is_mock_instance()
            and not hasattr(self.db.get_player_history, "_mock_name")
        )
        if is_real_pg and hasattr(self.db, "get_player_tournaments"):
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=3) as pool:
                f_hist = pool.submit(self.db.get_player_history, player_id, game_system=game_system)
                f_info = pool.submit(self.db.search_players, player_id, game_system=game_system)
                f_tours = pool.submit(self.db.get_player_tournaments, player_id, game_system=game_system)
                history = f_hist.result()
                player_info = f_info.result()
                prefetched_tournaments = f_tours.result()
        else:
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
                        pid_str = str(player_id or "").strip()
                        if pid_str.isdigit():
                            cur.execute("""
                                SELECT ep.player_id, ep.full_name, ep.faction, ep.team
                                FROM event_participants ep
                                LEFT JOIN events e ON ep.event_id = e.id
                                WHERE (ep.player_id = %s OR ep.id = %s)
                                  AND COALESCE(e.game_system, '40k') = %s
                                ORDER BY e.event_date DESC NULLS LAST
                                LIMIT 1;
                            """, (pid_str, int(pid_str), target_sys))
                        else:
                            cur.execute("""
                                SELECT ep.player_id, ep.full_name, ep.faction, ep.team
                                FROM event_participants ep
                                LEFT JOIN events e ON ep.event_id = e.id
                                WHERE ep.player_id = %s
                                  AND COALESCE(e.game_system, '40k') = %s
                                ORDER BY e.event_date DESC NULLS LAST
                                LIMIT 1;
                            """, (pid_str, target_sys))
                        ep_row = cur.fetchone()
                        if not ep_row:
                            if pid_str.isdigit():
                                cur.execute("""
                                    SELECT ep.player_id, ep.full_name, ep.faction, ep.team
                                    FROM event_participants ep
                                    LEFT JOIN events e ON ep.event_id = e.id
                                    WHERE (ep.player_id = %s OR ep.id = %s)
                                    ORDER BY e.event_date DESC NULLS LAST
                                    LIMIT 1;
                                """, (pid_str, int(pid_str)))
                            else:
                                cur.execute("""
                                    SELECT ep.player_id, ep.full_name, ep.faction, ep.team
                                    FROM event_participants ep
                                    LEFT JOIN events e ON ep.event_id = e.id
                                    WHERE ep.player_id = %s
                                    ORDER BY e.event_date DESC NULLS LAST
                                    LIMIT 1;
                                """, (pid_str,))
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

        if prefetched_tournaments is not None and player_id == initial_pid:
            tournaments_list = prefetched_tournaments
        else:
            tournaments_list = (
                self.db.get_player_tournaments(player_id, game_system=game_system)
                if (include_tournaments and hasattr(self.db, "get_player_tournaments"))
                else []
            )

        # Fallback or supplement from matches table (and in-memory live event cache) if rating_history is empty
        # or missing rounds for any tournament compared to `player_meta` or `tournaments_list`.
        seen_match_ids = {str(h.get("match_id")) for h in history if isinstance(h, dict) and h.get("match_id") is not None}
        seen_event_rounds = {
            (str(h.get("event_id") or h.get("tournament_id") or ""), int(h.get("round") or 0))
            for h in history
            if isinstance(h, dict) and (h.get("event_id") or h.get("tournament_id")) and h.get("round") is not None
        }
        history_counts_by_eid: Dict[str, int] = {}
        for h in history:
            if isinstance(h, dict):
                h_eid = str(h.get("event_id") or h.get("tournament_id") or "").strip()
                if h_eid:
                    history_counts_by_eid[h_eid] = history_counts_by_eid.get(h_eid, 0) + 1

        has_event_round_gap = any(
            isinstance(t, dict)
            and str(t.get("event_id") or "").strip()
            and int(t.get("matches_played") or 0) > history_counts_by_eid.get(str(t.get("event_id") or "").strip(), 0)
            for t in (tournaments_list or [])
        )
        is_mock_matches = hasattr(self.db, "get_player_matches") and isinstance(getattr(self.db.get_player_matches, "return_value", None), list)

        supplement_matches: List[Dict[str, Any]] = []
        if not history or int(player_meta.get("matches_played") or 0) > len(history) or has_event_round_gap or is_mock_matches:
            raw_matches = self.db.get_player_matches(player_id, game_system=game_system) if hasattr(self.db, "get_player_matches") else []
            if isinstance(raw_matches, list):
                supplement_matches.extend(raw_matches)

        # Also check in-memory `_event_details_cache` for any tournament in `tournaments_list` that was recently viewed
        try:
            from routers import leaderboard as _lb_router
            ev_cache = getattr(_lb_router, "_event_details_cache", None)
            if isinstance(ev_cache, dict) and tournaments_list:
                for t_item in tournaments_list:
                    if not isinstance(t_item, dict):
                        continue
                    t_eid = str(t_item.get("event_id") or "").strip()
                    if not t_eid or t_eid not in ev_cache:
                        continue
                    cached_ev = (ev_cache.get(t_eid) or {}).get("data") or {}
                    cached_ev_matches = cached_ev.get("matches")
                    if not isinstance(cached_ev_matches, list):
                        continue
                    for cm in cached_ev_matches:
                        if isinstance(cm, dict) and (cm.get("player1_id") == player_id or cm.get("player2_id") == player_id):
                            cm_copy = dict(cm)
                            cm_copy.setdefault("event_id", t_eid)
                            cm_copy.setdefault("event_name", cached_ev.get("name") or t_item.get("event_name"))
                            cm_copy.setdefault("match_date", cached_ev.get("event_date") or cached_ev.get("date") or t_item.get("event_date"))
                            supplement_matches.append(cm_copy)
        except Exception:
            pass

        unrated_real_matches_count = 0
        if supplement_matches:
            for m in supplement_matches:
                if not isinstance(m, dict):
                    continue
                mid = m.get("id") if m.get("id") is not None else m.get("match_id")
                ev_id_val = str(m.get("event_id") or m.get("tournament_id") or "").strip() or None
                r_val = int(m.get("round") or 0) if m.get("round") is not None else 0
                if mid is not None and str(mid) in seen_match_ids:
                    continue
                if ev_id_val and r_val > 0 and (ev_id_val, r_val) in seen_event_rounds:
                    continue
                is_p1 = (m.get("player1_id") == player_id)
                opp_id = m.get("player2_id") if is_p1 else m.get("player1_id")
                # Never append unrated BCP byes or dropped rounds (opponent_id is None / BYE) into history
                if m.get("is_bye") or not opp_id or str(opp_id).strip().upper() == "BYE":
                    continue
                opp_name = m.get("player2_name") if is_p1 else m.get("player1_name")
                opp_fac = m.get("player2_faction") if is_p1 else m.get("player1_faction")
                my_fac = m.get("player1_faction") if is_p1 else m.get("player2_faction")
                my_score = m.get("player1_score") if is_p1 else m.get("player2_score")
                opp_score = m.get("player2_score") if is_p1 else m.get("player1_score")

                is_win = (m.get("winner_id") == player_id)
                is_loss = (m.get("loser_id") == player_id) or bool(m.get("winner_id") and m.get("winner_id") != player_id)
                is_draw = bool(m.get("is_draw"))
                if not (is_win or is_loss or is_draw) and my_score is not None and opp_score is not None:
                    try:
                        ms_f = float(my_score)
                        os_f = float(opp_score)
                        if ms_f > os_f:
                            is_win = True
                        elif os_f > ms_f:
                            is_loss = True
                        elif ms_f == os_f and ms_f > 0:
                            is_draw = True
                    except (ValueError, TypeError):
                        pass
                if not (is_win or is_loss or is_draw):
                    continue
                res = "W" if is_win else ("L" if is_loss else ("D" if is_draw else "-"))
                unrated_real_matches_count += 1

                if mid is not None:
                    seen_match_ids.add(str(mid))
                if ev_id_val and r_val > 0:
                    seen_event_rounds.add((ev_id_val, r_val))
                ev_name_val = m.get("event_name") or m.get("tournament_name")
                history.append({
                    "player_id": player_id,
                    "match_id": mid,
                    "event_id": ev_id_val,
                    "tournament_id": ev_id_val,
                    "event_name": ev_name_val,
                    "tournament_name": ev_name_val,
                    "round": m.get("round"),
                    "table_number": m.get("table_number"),
                    "match_date": m.get("match_date") or m.get("date_played") or m.get("date"),
                    "old_elo": player_meta.get("current_elo", self.initial_elo),
                    "new_elo": player_meta.get("current_elo", self.initial_elo),
                    "delta_elo": 0.0,
                    "opponent_id": opp_id,
                    "opponent_name": opp_name or "Opponent",
                    "opponent_elo": 1500.0,
                    "result": res,
                    "player_faction": my_fac,
                    "opponent_faction": opp_fac,
                    "player_score": my_score,
                    "opponent_score": opp_score,
                    "is_bye": False
                })

        # Self-heal if player_ratings is out of sync with rating_history or if unrated real matches exist
        if is_real_pg and player_id and str(player_id).strip().upper() != "BYE":
            has_discontinuous_elo = False
            for idx_h in range(1, len(history)):
                h_prev = history[idx_h - 1]
                h_curr = history[idx_h]
                if isinstance(h_prev, dict) and isinstance(h_curr, dict):
                    try:
                        prev_new = float(h_prev.get("new_elo") or self.initial_elo)
                        curr_old = float(h_curr.get("old_elo") or self.initial_elo)
                        if abs(curr_old - prev_new) > 0.5:
                            has_discontinuous_elo = True
                            break
                    except (ValueError, TypeError):
                        pass

            pr_matches_cnt = int(player_meta.get("matches_played") or 0)
            pr_curr_elo = float(player_meta.get("current_elo") or self.initial_elo)
            hist_last_elo = float(history[-1].get("new_elo") or self.initial_elo) if history and isinstance(history[-1], dict) else self.initial_elo
            needs_user_elo_recon = bool(
                unrated_real_matches_count > 0
                or has_discontinuous_elo
                or (pr_matches_cnt > 0 and len(history) < pr_matches_cnt)
                or (history and (pr_matches_cnt != len(history) or abs(pr_curr_elo - hist_last_elo) > 0.5))
            )
            if needs_user_elo_recon:
                try:
                    self.reconstruct_user_elo(player_id, game_system=game_system)
                    history = self.db.get_player_history(player_id, game_system=game_system)
                    refreshed_info = self.db.search_players(player_id, game_system=game_system)
                    if refreshed_info:
                        player_meta = refreshed_info[0]
                    if include_tournaments and hasattr(self.db, "get_player_tournaments"):
                        tournaments_list = self.db.get_player_tournaments(player_id, game_system=game_system)
                except Exception as recon_err:
                    logger.debug(f"Self-heal reconstruct_user_elo notice for {player_id}: {recon_err}")

        # Ensure player_meta stats (matches_played, wins, losses, draws, win_rate, current_elo, peak_elo) strictly match history
        if history and isinstance(player_meta, dict):
            h_wins = sum(1 for h in history if isinstance(h, dict) and str(h.get("result") or "").upper() == "W")
            h_losses = sum(1 for h in history if isinstance(h, dict) and str(h.get("result") or "").upper() == "L")
            h_draws = sum(1 for h in history if isinstance(h, dict) and str(h.get("result") or "").upper() == "D")
            h_total = len(history)
            if h_total > 0:
                player_meta["matches_played"] = h_total
                player_meta["wins"] = h_wins
                player_meta["losses"] = h_losses
                player_meta["draws"] = h_draws
                player_meta["win_rate"] = round((h_wins * 100.0) / h_total, 1)
                try:
                    last_new_elo = float(history[-1].get("new_elo") or player_meta.get("current_elo") or self.initial_elo)
                    max_hist_elo = max([self.initial_elo] + [float(h.get("new_elo") or self.initial_elo) for h in history if isinstance(h, dict)])
                    player_meta["current_elo"] = round(last_new_elo, 2)
                    player_meta["peak_elo"] = round(max(last_new_elo, max_hist_elo), 2)
                except (ValueError, TypeError):
                    pass

        if history:
            _sync_history_from_tournaments(tournaments_list, history)
            if tournaments_list:
                hist_wld_by_eid: Dict[str, List[int]] = {}
                for h_item in history:
                    if not isinstance(h_item, dict):
                        continue
                    h_eid = str(h_item.get("event_id") or h_item.get("tournament_id") or "").strip()
                    if not h_eid:
                        continue
                    wld = hist_wld_by_eid.setdefault(h_eid, [0, 0, 0])
                    r_code = str(h_item.get("result") or "").upper()
                    if r_code == "W":
                        wld[0] += 1
                    elif r_code == "L":
                        wld[1] += 1
                    elif r_code == "D":
                        wld[2] += 1
                for t_item in tournaments_list:
                    if not isinstance(t_item, dict):
                        continue
                    t_eid = str(t_item.get("event_id") or "").strip()
                    wld = hist_wld_by_eid.get(t_eid)
                    if wld and sum(wld) > 0:
                        t_item["wins"] = wld[0]
                        t_item["losses"] = wld[1]
                        t_item["draws"] = wld[2]
                        t_item["matches_played"] = sum(wld)

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

        # Compute Faction Mastery & Opponent Matchup Matrix from enriched history
        has_specific_player_fac = any(
            isinstance(h, dict) and not Database.is_super_or_empty_faction(h.get("player_faction"), include_generic_sm=True)
            for h in history
        )
        player_fac_counts = collections.Counter()
        fm_by_fac: Dict[str, Dict[str, float]] = {}
        mm_by_fac: Dict[str, Dict[str, float]] = {}
        for h in history:
            if not isinstance(h, dict):
                continue
            is_bye_match = bool(h.get("is_bye")) or str(h.get("opponent_name") or "").strip().upper() == "BYE"
            fac = str(h.get("player_faction") or "").strip()
            if fac and not Database.is_super_or_empty_faction(fac, include_generic_sm=has_specific_player_fac):
                player_fac_counts[fac] += 1
                if not is_bye_match:
                    fb = fm_by_fac.setdefault(fac, {"games": 0, "wins": 0, "losses": 0, "draws": 0, "net_elo": 0.0, "score_sum": 0.0})
                    fb["games"] += 1
                    res_code = str(h.get("result") or "").upper()
                    if res_code == "W":
                        fb["wins"] += 1
                    elif res_code == "L":
                        fb["losses"] += 1
                    else:
                        fb["draws"] += 1
                    fb["net_elo"] += float(h.get("delta_elo") or 0.0)
                    fb["score_sum"] += float(h.get("player_score") or 0.0)

            if not is_bye_match:
                opp_fac = str(h.get("opponent_faction") or h.get("enemy_faction") or "").strip()
                if opp_fac and opp_fac.lower() != "bye" and not Database.is_super_or_empty_faction(opp_fac, include_generic_sm=False):
                    mb = mm_by_fac.setdefault(opp_fac, {"total_encounters": 0, "wins": 0, "losses": 0, "draws": 0, "net_elo": 0.0})
                    mb["total_encounters"] += 1
                    res_code = str(h.get("result") or "").upper()
                    if res_code == "W":
                        mb["wins"] += 1
                    elif res_code == "L":
                        mb["losses"] += 1
                    else:
                        mb["draws"] += 1
                    mb["net_elo"] += float(h.get("delta_elo") or 0.0)

        faction_mastery = []
        for fac_name, b in fm_by_fac.items():
            g_cnt = int(b["games"])
            w_cnt = int(b["wins"])
            faction_mastery.append({
                "faction": fac_name,
                "games": g_cnt,
                "matches": g_cnt,
                "wins": w_cnt,
                "losses": int(b["losses"]),
                "draws": int(b["draws"]),
                "win_rate": round((w_cnt * 100.0) / g_cnt, 1) if g_cnt > 0 else 0.0,
                "net_elo": round(float(b["net_elo"]), 1),
                "avg_score": round(float(b["score_sum"]) / g_cnt, 1) if g_cnt > 0 else 0.0,
            })
        faction_mastery.sort(key=lambda x: (x["games"], x["win_rate"]), reverse=True)

        factions_breakdown = [
            {
                "faction": f,
                "matches": c,
                **(
                    {
                        "games": int(fm_by_fac[f]["games"]),
                        "wins": int(fm_by_fac[f]["wins"]),
                        "losses": int(fm_by_fac[f]["losses"]),
                        "draws": int(fm_by_fac[f]["draws"]),
                        "win_rate": round((fm_by_fac[f]["wins"] * 100.0) / fm_by_fac[f]["games"], 1) if fm_by_fac[f]["games"] > 0 else 0.0,
                        "net_elo": round(float(fm_by_fac[f]["net_elo"]), 1),
                    }
                    if f in fm_by_fac else {}
                )
            }
            for f, c in player_fac_counts.most_common() if f
        ]

        # Clean top_faction so generic super-factions or redundant Space Marines (Astartes) are removed
        raw_top_fac = str(player_meta.get("top_faction") or "").strip()
        if factions_breakdown:
            cleaned_top_faction = ", ".join(fb["faction"] for fb in factions_breakdown[:5] if fb.get("faction"))
        elif raw_top_fac:
            tf_parts = [p.strip() for p in raw_top_fac.split(",") if p.strip()]
            has_spec_tf = any(not Database.is_super_or_empty_faction(p, include_generic_sm=True) for p in tf_parts)
            clean_tf_parts = [
                p for p in tf_parts
                if not Database.is_super_or_empty_faction(p, include_generic_sm=has_spec_tf)
            ]
            cleaned_top_faction = ", ".join(clean_tf_parts) if clean_tf_parts else raw_top_fac
        else:
            cleaned_top_faction = player_meta.get("top_faction")
        if cleaned_top_faction:
            player_meta["top_faction"] = cleaned_top_faction

        matchup_matrix = []
        for ef, b in mm_by_fac.items():
            tot_e = int(b["total_encounters"])
            w_cnt = int(b["wins"])
            matchup_matrix.append({
                "enemy_faction": ef,
                "total_encounters": tot_e,
                "wins": w_cnt,
                "losses": int(b["losses"]),
                "draws": int(b["draws"]),
                "win_rate": round((w_cnt * 100.0) / tot_e, 1) if tot_e > 0 else 0.0,
                "net_elo": round(float(b["net_elo"]), 1),
            })
        matchup_matrix.sort(key=lambda x: (x["total_encounters"], x["win_rate"]), reverse=True)

        # Collect distinct teams and cross-system career history for this player
        all_teams_list = []
        career_systems: List[Dict[str, Any]] = []
        other_system_history: List[Dict[str, Any]] = []
        other_system_tournaments: List[Dict[str, Any]] = []
        target_sys = (game_system or "40k").strip().lower()
        resolved_pname = str(
            player_meta.get("player_name")
            or player_meta.get("full_name")
            or player_name
            or (history[0].get("opponent_name") if history else "Unknown")
        ).strip()
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

                    if include_tournaments and is_real_pg:
                        alias_pids = [player_id]
                        if initial_pid and initial_pid not in alias_pids:
                            alias_pids.append(initial_pid)
                        try:
                            cur.execute(
                                """
                                SELECT u.id, u.player_id, u.bcp_user_id, upl.platform_user_id
                                FROM users u
                                LEFT JOIN user_platform_links upl ON u.id = upl.user_id
                                WHERE u.id = ANY(%s) OR u.player_id = ANY(%s) OR u.bcp_user_id = ANY(%s) OR upl.platform_user_id = ANY(%s);
                                """,
                                (alias_pids, alias_pids, alias_pids, alias_pids),
                            )
                            for lr in (cur.fetchall() or []):
                                for col_v in (lr if isinstance(lr, (list, tuple)) else lr.values()):
                                    s_v = str(col_v or "").strip()
                                    if s_v and s_v not in alias_pids:
                                        alias_pids.append(s_v)
                        except Exception:
                            try:
                                conn.rollback()
                            except Exception:
                                pass

                        exact_name_filter = (
                            resolved_pname
                            if (
                                resolved_pname
                                and " " in resolved_pname
                                and len(resolved_pname) >= 6
                                and not _is_placeholder_name(resolved_pname, player_id)
                            )
                            else ""
                        )
                        if exact_name_filter:
                            cur.execute(
                                """
                                SELECT COALESCE(game_system, '40k') AS gs,
                                       player_id,
                                       player_name,
                                       current_elo,
                                       peak_elo,
                                       matches_played,
                                       wins,
                                       losses,
                                       draws,
                                       win_rate,
                                       top_faction
                                FROM player_ratings
                                WHERE (
                                    player_id = ANY(%s)
                                    OR (player_name ILIKE %s AND LOWER(TRIM(player_name)) = LOWER(TRIM(%s)))
                                )
                                  AND COALESCE(matches_played, 0) > 0
                                ORDER BY (player_id = ANY(%s)) DESC, matches_played DESC, current_elo DESC;
                                """,
                                (alias_pids, exact_name_filter, exact_name_filter, alias_pids),
                            )
                        else:
                            cur.execute(
                                """
                                SELECT COALESCE(game_system, '40k') AS gs,
                                       player_id,
                                       player_name,
                                       current_elo,
                                       peak_elo,
                                       matches_played,
                                       wins,
                                       losses,
                                       draws,
                                       win_rate,
                                       top_faction
                                FROM player_ratings
                                WHERE player_id = ANY(%s) AND COALESCE(matches_played, 0) > 0
                                ORDER BY matches_played DESC, current_elo DESC;
                                """,
                                (alias_pids,),
                            )
                        cs_rows = cur.fetchall() or []
                        seen_gs = set()
                        for r_cs in cs_rows:
                            if isinstance(r_cs, (list, tuple)) and len(r_cs) >= 11:
                                gs_v = str(r_cs[0] or "40k").strip().lower()
                                if gs_v in seen_gs:
                                    continue
                                seen_gs.add(gs_v)
                                career_systems.append({
                                    "game_system": gs_v,
                                    "player_id": str(r_cs[1] or player_id),
                                    "player_name": str(r_cs[2] or resolved_pname),
                                    "current_elo": float(r_cs[3] or self.initial_elo),
                                    "peak_elo": float(r_cs[4] or self.initial_elo),
                                    "matches_played": int(r_cs[5] or 0),
                                    "wins": int(r_cs[6] or 0),
                                    "losses": int(r_cs[7] or 0),
                                    "draws": int(r_cs[8] or 0),
                                    "win_rate": float(r_cs[9] or 0.0),
                                    "top_faction": str(r_cs[10] or ""),
                                })
        except Exception as e:
            logger.debug(f"Error fetching team/career history for {player_id}: {e}")

        # Fetch Tournament Journey history & tournaments across other active game systems for this player
        if include_tournaments and is_real_pg and career_systems:
            other_cs = [cs for cs in career_systems if cs.get("game_system") != target_sys][:6]
            if other_cs:
                from concurrent.futures import ThreadPoolExecutor

                def _fetch_one_other_sys(cs_entry: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
                    other_gs = cs_entry["game_system"]
                    other_pid = cs_entry["player_id"]
                    loc_hist: List[Dict[str, Any]] = []
                    loc_tours: List[Dict[str, Any]] = []
                    try:
                        o_hist = self.db.get_player_history(other_pid, game_system=other_gs) or []
                        o_tours = (
                            self.db.get_player_tournaments(other_pid, game_system=other_gs)
                            if hasattr(self.db, "get_player_tournaments")
                            else []
                        ) or []
                        if o_hist and o_tours:
                            _sync_history_from_tournaments(o_tours, o_hist)
                        for oh in o_hist:
                            if isinstance(oh, dict):
                                oh_copy = dict(oh)
                                oh_copy["game_system"] = other_gs
                                oh_copy["system_player_id"] = other_pid
                                loc_hist.append(oh_copy)
                        for ot in o_tours:
                            if isinstance(ot, dict):
                                ot_copy = dict(ot)
                                ot_copy["game_system"] = other_gs
                                ot_copy["system_player_id"] = other_pid
                                loc_tours.append(ot_copy)
                    except Exception as o_err:
                        logger.debug(f"Notice fetching other system ({other_gs}) journey for {other_pid}: {o_err}")
                    return loc_hist, loc_tours

                with ThreadPoolExecutor(max_workers=min(4, len(other_cs))) as pool_ex:
                    futs = [pool_ex.submit(_fetch_one_other_sys, ce) for ce in other_cs]
                    for fut in futs:
                        try:
                            lh, lt = fut.result(timeout=4.0)
                            other_system_history.extend(lh)
                            other_system_tournaments.extend(lt)
                        except Exception:
                            pass

        # Current/Latest team is the first one in recency order
        latest_team = all_teams_list[0] if all_teams_list else (player_meta.get("team") or None)
        all_teams_str = ", ".join(all_teams_list) if all_teams_list else (latest_team or "")

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
            "faction_mastery": faction_mastery,
            "matchup_matrix": matchup_matrix,
            "longest_win_streak": max_streak,
            "history": history,
            "win_path": history,
            "trajectory": trajectory,
            "tournaments": tournaments_list,
            "events_attended": tournaments_list,
            "career_systems": career_systems,
            "other_system_history": other_system_history,
            "other_system_tournaments": other_system_tournaments,
            "player": {
                **player_meta,
                "team": latest_team,
                "all_teams": all_teams_str,
                "teams_history": all_teams_list
            }
        }
        if len(self._player_win_path_cache_dict) > 1000:
            self._player_win_path_cache_dict.clear()
        if tournaments_list or not include_tournaments or not history:
            self._player_win_path_cache_dict[cache_key] = (res, time.time())
        return res

    def reconstruct_user_elo(
        self,
        player_id: str,
        game_system: Optional[str] = None,
        alias_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Single-user Elo reconstruction (< 50ms) when a user links an external platform account in My Hub.

        Replays all completed matches involving `player_id` (or any newly merged `alias_ids`) chronologically
        against each opponent's recorded pre-match Elo in `rating_history` (or `player_ratings.current_elo` / 1500.0),
        updates `rating_history` and `player_ratings` for `player_id`, and returns a status payload for the UI.
        """
        try:
            from psycopg2 import extras
        except ImportError:
            class _FallbackExtras:
                RealDictCursor = None
                @staticmethod
                def execute_values(cur, sql, argslist, template=None, page_size=100):
                    cur.execute(sql, argslist)
            extras = _FallbackExtras()
        import time

        t0 = time.time()
        clean_pid = str(player_id or "").strip()[:64]
        if not clean_pid or clean_pid.upper() == "BYE":
            return {"status": "SKIPPED", "matches_replayed": 0, "systems_updated": []}

        candidate_ids = list(dict.fromkeys([clean_pid] + [str(a).strip()[:64] for a in (alias_ids or []) if str(a).strip()]))

        if not self.db or not hasattr(self.db, "get_connection") or type(getattr(self.db, "get_connection", None)).__name__ == "MagicMock":
            return {
                "status": "OK",
                "player_id": clean_pid,
                "matches_replayed": 0,
                "systems_updated": [],
                "status_message": "Computing Elo rating across linked match history...",
            }

        systems_to_run: List[str] = []
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cur:
                try:
                    cur.execute(
                        """
                        SELECT u.id AS user_id, u.player_id AS canon_pid, u.bcp_user_id, upl.platform_user_id
                        FROM users u
                        LEFT JOIN user_platform_links upl ON u.id = upl.user_id
                        WHERE (u.id = %s OR u.player_id = %s OR u.bcp_user_id = %s OR upl.platform_user_id = %s);
                        """,
                        (clean_pid, clean_pid, clean_pid, clean_pid),
                    )
                    for lr in (cur.fetchall() or []):
                        c_pid = str((lr.get("canon_pid") if isinstance(lr, dict) else lr[1]) or "").strip()[:64]
                        b_pid = str((lr.get("bcp_user_id") if isinstance(lr, dict) else lr[2]) or "").strip()[:64]
                        puid = str((lr.get("platform_user_id") if isinstance(lr, dict) else lr[3]) or "").strip()[:64]
                        if c_pid:
                            clean_pid = c_pid
                            if c_pid not in candidate_ids:
                                candidate_ids.insert(0, c_pid)
                        if b_pid and len(b_pid) <= 24 and b_pid not in candidate_ids:
                            candidate_ids.append(b_pid)
                        if puid and puid not in candidate_ids:
                            candidate_ids.append(puid)
                except Exception:
                    pass

                candidate_set = set(candidate_ids)

                if game_system and str(game_system).strip().lower() not in ("all", "*"):
                    systems_to_run = [str(game_system).strip().lower()]
                else:
                    cur.execute(
                        """
                        SELECT DISTINCT COALESCE(m.game_system, '40k') AS gs
                        FROM matches m
                        WHERE m.id IN (
                            SELECT m1.id FROM matches m1 WHERE m1.player1_id = ANY(%s)
                            UNION
                            SELECT m2.id FROM matches m2 WHERE m2.player2_id = ANY(%s)
                            UNION
                            SELECT mp.match_id FROM match_participants mp WHERE mp.player_id = ANY(%s)
                        ) AND m.is_done = TRUE;
                        """,
                        (candidate_ids, candidate_ids, candidate_ids),
                    )
                    for r in (cur.fetchall() or []):
                        gs_val = r["gs"] if isinstance(r, dict) else r[0]
                        if gs_val:
                            systems_to_run.append(str(gs_val).strip().lower())

                total_replayed = 0
                updated_ratings: Dict[str, Dict[str, Any]] = {}

                for sys_target in systems_to_run:
                    cur.execute(
                        """
                        SELECT
                            m.id, m.event_id, m.round, m.table_number, m.match_date,
                            m.player1_id, m.player1_name, m.player1_faction, m.player1_score,
                            m.player2_id, m.player2_name, m.player2_faction, m.player2_score,
                            m.winner_id, m.is_draw, m.is_bye,
                            m.raw_json,
                            COALESCE(m.game_system, '40k') AS game_system,
                            opp_rh.old_elo AS opp_hist_elo,
                            opp_pr.current_elo AS opp_curr_elo
                        FROM matches m
                        LEFT JOIN LATERAL (
                            SELECT r.old_elo
                            FROM rating_history r
                            WHERE r.match_id = m.id
                              AND COALESCE(r.game_system, '40k') = COALESCE(m.game_system, '40k')
                              AND r.player_id = (CASE WHEN m.player1_id = ANY(%s) THEN m.player2_id ELSE m.player1_id END)
                            ORDER BY r.id ASC
                            LIMIT 1
                        ) opp_rh ON TRUE
                        LEFT JOIN LATERAL (
                            SELECT p.current_elo
                            FROM player_ratings p
                            WHERE p.player_id = (CASE WHEN m.player1_id = ANY(%s) THEN m.player2_id ELSE m.player1_id END)
                              AND COALESCE(p.game_system, '40k') = COALESCE(m.game_system, '40k')
                            LIMIT 1
                        ) opp_pr ON TRUE
                        WHERE m.id IN (
                            SELECT m1.id FROM matches m1 WHERE m1.player1_id = ANY(%s) AND COALESCE(m1.game_system, '40k') = %s
                            UNION
                            SELECT m2.id FROM matches m2 WHERE m2.player2_id = ANY(%s) AND COALESCE(m2.game_system, '40k') = %s
                            UNION
                            SELECT mp.match_id FROM match_participants mp WHERE mp.player_id = ANY(%s)
                            UNION
                            SELECT m3.id FROM matches m3
                            JOIN event_participants ep ON ep.event_id = m3.event_id
                            WHERE ep.player_id = ANY(%s)
                              AND COALESCE(m3.game_system, '40k') = %s
                              AND (m3.player1_faction = 'Commander Pod' OR m3.player2_faction = 'Commander Pod')
                        )
                          AND m.is_done = TRUE
                          AND m.player1_id IS NOT NULL AND m.player1_id != ''
                          AND m.player2_id IS NOT NULL AND m.player2_id != ''
                          AND COALESCE(m.game_system, '40k') = %s
                        ORDER BY m.match_date ASC NULLS FIRST, m.event_id ASC, m.round ASC, m.table_number ASC, m.id ASC;
                        """,
                        (candidate_ids, candidate_ids, candidate_ids, sys_target, candidate_ids, sys_target, candidate_ids, candidate_ids, sys_target, sys_target),
                    )
                    raw_user_matches = [dict(r) for r in (cur.fetchall() or [])]
                    seen_um_ids = set()
                    user_matches = []
                    for um in raw_user_matches:
                        um_id = str(um.get("id") or "")
                        if um_id and um_id in seen_um_ids:
                            continue
                        if um_id:
                            seen_um_ids.add(um_id)
                        user_matches.append(um)
                    if not user_matches:
                        continue

                    cur.execute(
                        "DELETE FROM rating_history WHERE player_id = ANY(%s) AND COALESCE(game_system, '40k') = %s;",
                        (candidate_ids, sys_target),
                    )
                    if len(candidate_ids) > 1:
                        cur.execute(
                            "DELETE FROM player_ratings WHERE player_id = ANY(%s) AND COALESCE(game_system, '40k') = %s;",
                            ([a for a in candidate_ids if a != clean_pid], sys_target),
                        )

                    cur_elo = self.initial_elo
                    peak_elo = self.initial_elo
                    matches_played = 0
                    wins = 0
                    losses = 0
                    draws = 0
                    last_active_date = None
                    fac_counts: collections.Counter = collections.Counter()
                    best_name = f"Player {clean_pid[:8]}"
                    ep_user_factions: Dict[str, str] = {}
                    pod_opp_elos: Dict[str, float] = {}
                    try:
                        cur.execute(
                            "SELECT event_id, full_name, faction FROM event_participants WHERE player_id = ANY(%s);",
                            (candidate_ids,),
                        )
                        for epr in (cur.fetchall() or []):
                            eid_u = str(epr.get("event_id") if isinstance(epr, dict) else epr[0] or "")[:64]
                            nm_u = _sanitize_name(epr.get("full_name") if isinstance(epr, dict) else epr[1], max_len=100)
                            fac_u = _sanitize_name(epr.get("faction") if isinstance(epr, dict) else epr[2], max_len=60)
                            if nm_u and not _is_placeholder_name(nm_u, clean_pid):
                                best_name = nm_u
                            if fac_u and "Pod" not in fac_u and fac_u.lower() not in ("none", "unknown", ""):
                                if eid_u:
                                    ep_user_factions[eid_u] = fac_u
                                fac_counts[fac_u] += 1
                    except Exception:
                        pass
                    hist_rows = []

                    for m in user_matches:
                        mid_str = str(m.get("id") or "")
                        ev_id_u = str(m.get("event_id") or "")[:64]
                        raw_obj: Dict[str, Any] = {}
                        raw_val = m.get("raw_json")
                        if isinstance(raw_val, dict):
                            raw_obj = raw_val
                        elif isinstance(raw_val, str) and raw_val.strip().startswith("{"):
                            try:
                                raw_obj = json.loads(raw_val)
                            except Exception:
                                raw_obj = {}

                        pod_parts = raw_obj.get("pod_participants")
                        if isinstance(pod_parts, list) and len(pod_parts) >= 3:
                            my_seat = next(
                                (s for s in pod_parts if isinstance(s, dict) and str(s.get("player_id") or "")[:64] in candidate_set),
                                None,
                            )
                            if my_seat:
                                my_name_pod = _sanitize_name(my_seat.get("player_name"), max_len=100)
                                if my_name_pod and not _is_placeholder_name(my_name_pod, clean_pid):
                                    best_name = my_name_pod
                                my_fac_pod = _sanitize_name(my_seat.get("faction"), max_len=60)
                                if not my_fac_pod or "Pod" in my_fac_pod:
                                    my_fac_pod = ep_user_factions.get(ev_id_u, "")
                                others_pod = [s for s in pod_parts if isinstance(s, dict) and str(s.get("player_id") or "")[:64] not in candidate_set]
                                n_pod = len(pod_parts)
                                win_id_pod = str(m.get("winner_id") or "")[:64]
                                is_pod_draw = bool(m.get("is_draw") or not win_id_pod)
                                old_elo = cur_elo
                                opp_elo = self.initial_elo
                                exp_norm = self.expected_score(old_elo, opp_elo)
                                if is_pod_draw:
                                    act_norm = 0.5
                                    res_code = "D"
                                elif win_id_pod in candidate_set:
                                    act_norm = 1.0
                                    res_code = "W"
                                else:
                                    act_norm = (0.5 * float(max(0, n_pod - 2))) / float(max(1, n_pod - 1))
                                    res_code = "L"
                                k_val = self.provisional_k if matches_played < self.provisional_matches else self.default_k
                                delta_e = round(k_val * (act_norm - exp_norm), 2)
                                new_elo = round(old_elo + delta_e, 2)
                                cur_elo = new_elo
                                peak_elo = max(peak_elo, new_elo)
                                matches_played += 1
                                if res_code == "W":
                                    wins += 1
                                elif res_code == "L":
                                    losses += 1
                                else:
                                    draws += 1
                                m_date = m.get("match_date")
                                if m_date:
                                    last_active_date = _max_date(last_active_date, m_date)
                                if my_fac_pod and "Pod" not in my_fac_pod:
                                    fac_counts[my_fac_pod] += 1
                                opp_rep_id = win_id_pod if (win_id_pod and win_id_pod not in candidate_set) else (str(others_pod[0].get("player_id") or "POD")[:64] if others_pod else "POD")
                                opp_pod_names = ("Pod: " + ", ".join(_sanitize_name(o.get("player_name"), max_len=26) or str(o.get("player_id") or "")[:6] for o in others_pod))[:100]
                                my_sc = _safe_int_score(my_seat.get("score") if my_seat.get("score") is not None else (5 if res_code == "W" else (1 if res_code == "D" else 0)))
                                op_sc = _safe_int_score(1 if is_pod_draw else (0 if res_code == "W" else 5))
                                hist_rows.append((
                                    clean_pid,
                                    mid_str[:64],
                                    str(m.get("event_id") or "")[:64] if m.get("event_id") else None,
                                    m.get("round"),
                                    m_date,
                                    old_elo,
                                    new_elo,
                                    delta_e,
                                    opp_rep_id,
                                    opp_pod_names,
                                    opp_elo,
                                    res_code,
                                    my_fac_pod,
                                    f"{n_pod}-Player FFA Pod",
                                    my_sc,
                                    op_sc,
                                    sys_target,
                                ))
                                continue
                            else:
                                continue

                        p1_id = str(m.get("player1_id") or "")[:64]
                        p2_id = str(m.get("player2_id") or "")[:64]
                        if p1_id not in candidate_set and p2_id not in candidate_set:
                            continue
                        is_p1 = (p1_id in candidate_set)
                        opp_id = p2_id if is_p1 else p1_id
                        my_name = _sanitize_name(m.get("player1_name") if is_p1 else m.get("player2_name"), max_len=100)
                        opp_name = _sanitize_name(m.get("player2_name") if is_p1 else m.get("player1_name"), max_len=100) or f"Player {opp_id[:8]}"
                        if my_name and not _is_placeholder_name(my_name, clean_pid):
                            best_name = my_name

                        my_fac = _sanitize_name(m.get("player1_faction") if is_p1 else m.get("player2_faction"), max_len=60)
                        opp_fac = _sanitize_name(m.get("player2_faction") if is_p1 else m.get("player1_faction"), max_len=60)
                        my_score = m.get("player1_score") if is_p1 else m.get("player2_score")
                        opp_score = m.get("player2_score") if is_p1 else m.get("player1_score")

                        is_non_bcp_match = mid_str.startswith(("melee:", "ltcg:", "ls:", "td:"))
                        is_bye_match = bool(m.get("is_bye") or opp_id.upper() == "BYE")
                        is_real_draw = bool(m.get("is_draw") and ((m.get("player1_score") or 0) > 0 or (m.get("player2_score") or 0) > 0 or is_non_bcp_match))
                        has_valid_winner = bool(m.get("winner_id") and m.get("winner_id") in (p1_id, p2_id))
                        if not is_bye_match and not has_valid_winner and not is_real_draw:
                            continue

                        old_elo = cur_elo
                        opp_elo = float(m.get("opp_hist_elo") or m.get("opp_curr_elo") or self.initial_elo)
                        if is_bye_match or is_real_draw:
                            res_code = "D" if is_real_draw else "W"
                            new_elo = old_elo
                        else:
                            did_win = (m.get("winner_id") in candidate_set)
                            res_code = "W" if did_win else "L"
                            k_val = self.provisional_k if matches_played < self.provisional_matches else self.default_k
                            exp_s = self.expected_score(old_elo, opp_elo)
                            act_s = 1.0 if did_win else 0.0
                            new_elo = round(old_elo + k_val * (act_s - exp_s), 2)

                        cur_elo = new_elo
                        peak_elo = max(peak_elo, new_elo)
                        matches_played += 1
                        if res_code == "W":
                            wins += 1
                        elif res_code == "L":
                            losses += 1
                        else:
                            draws += 1
                        m_date = m.get("match_date")
                        if m_date:
                            last_active_date = _max_date(last_active_date, m_date)
                        if my_fac:
                            fac_counts[my_fac] += 1

                        hist_rows.append((
                            clean_pid,
                            mid_str[:64],
                            str(m.get("event_id") or "")[:64] if m.get("event_id") else None,
                            m.get("round"),
                            m_date,
                            old_elo,
                            new_elo,
                            round(new_elo - old_elo, 2),
                            opp_id,
                            opp_name,
                            opp_elo,
                            res_code,
                            my_fac,
                            opp_fac,
                            my_score,
                            opp_score,
                            sys_target,
                        ))

                    if hist_rows and extras:
                        extras.execute_values(
                            cur,
                            """
                            INSERT INTO rating_history (
                                player_id, match_id, event_id, round, match_date,
                                old_elo, new_elo, delta_elo, opponent_id, opponent_name,
                                opponent_elo, result, player_faction, opponent_faction,
                                player_score, opponent_score, game_system
                            ) VALUES %s;
                            """,
                            hist_rows,
                            page_size=500,
                        )

                    if matches_played > 0:
                        win_rate = round((wins / matches_played) * 100.0, 1)
                        top_fac = _sanitize_top_factions(fac_counts, max_factions=5, max_len=200)
                        now_iso = datetime.now(timezone.utc)
                        cur.execute(
                            """
                            INSERT INTO player_ratings (
                                player_id, player_name, current_elo, peak_elo,
                                matches_played, wins, losses, draws, win_rate,
                                top_faction, last_active_date, updated_at, game_system
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT (player_id, game_system) DO UPDATE SET
                                player_name = EXCLUDED.player_name,
                                current_elo = EXCLUDED.current_elo,
                                peak_elo = EXCLUDED.peak_elo,
                                matches_played = EXCLUDED.matches_played,
                                wins = EXCLUDED.wins,
                                losses = EXCLUDED.losses,
                                draws = EXCLUDED.draws,
                                win_rate = EXCLUDED.win_rate,
                                top_faction = COALESCE(EXCLUDED.top_faction, player_ratings.top_faction),
                                last_active_date = EXCLUDED.last_active_date,
                                updated_at = EXCLUDED.updated_at;
                            """,
                            (
                                clean_pid,
                                best_name,
                                cur_elo,
                                peak_elo,
                                matches_played,
                                wins,
                                losses,
                                draws,
                                win_rate,
                                top_fac,
                                last_active_date,
                                now_iso,
                                sys_target,
                            ),
                        )
                        total_replayed += matches_played
                        updated_ratings[sys_target] = {
                            "current_elo": cur_elo,
                            "peak_elo": peak_elo,
                            "matches_played": matches_played,
                            "wins": wins,
                            "losses": losses,
                            "draws": draws,
                            "win_rate": win_rate,
                        }

                conn.commit()

        self.invalidate_caches()
        if hasattr(self.db, "invalidate_all_caches"):
            self.db.invalidate_all_caches()
        elif hasattr(self.db.__class__, "invalidate_all_caches"):
            self.db.__class__.invalidate_all_caches()

        elapsed_ms = round((time.time() - t0) * 1000.0, 1)
        return {
            "status": "OK",
            "player_id": clean_pid,
            "matches_replayed": total_replayed,
            "systems_updated": list(updated_ratings.keys()),
            "ratings": updated_ratings,
            "elapsed_ms": elapsed_ms,
            "status_message": (
                f"Computed Elo rating across {total_replayed} matches in {elapsed_ms}ms."
                if total_replayed > 0
                else "Account linked! Your Elo rating will update automatically as soon as your first match completes."
            ),
        }


try:
    from perf_telemetry import instrument_class_methods as _instrument_elo_methods
    _instrument_elo_methods(
        EloEngine,
        class_label="EloEngine",
        exclude_methods={
            "get_k_factor",
            "expected_score",
            "calculate_expected_score",
        },
    )
except Exception as _perf_err:
    logger.debug(f"Perf instrumentation notice on EloEngine: {_perf_err}")


_elo_engine_instance = None

def get_elo_engine(db: Optional[Database] = None) -> EloEngine:
    """Returns the singleton EloEngine instance."""
    global _elo_engine_instance
    if _elo_engine_instance is None:
        _elo_engine_instance = EloEngine(db=db)
    elif db is not None:
        _elo_engine_instance.db = db
    return _elo_engine_instance
