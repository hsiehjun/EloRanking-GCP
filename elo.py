"""Elo rating engine: reconstructs chronological player win paths and ratings."""

import collections
import json
import logging
import math
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

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


class EloEngine:
    """Reconstructs historical player trajectories, win paths, and post-constructed Elo ratings."""

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

    def predict_match_outcome(self, p1_id_or_name: str, p2_id_or_name: str) -> Dict[str, Any]:
        """Calculates win probabilities, simulated Elo rating changes, and past head-to-head encounters."""
        from psycopg2 import extras

        p1_data = None
        p2_data = None

        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("SELECT * FROM player_ratings WHERE player_id = %s OR player_name ILIKE %s LIMIT 1;", (p1_id_or_name, p1_id_or_name))
                p1_data = cur.fetchone()

                cur.execute("SELECT * FROM player_ratings WHERE player_id = %s OR player_name ILIKE %s LIMIT 1;", (p2_id_or_name, p2_id_or_name))
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
        h2h_matches = self.db.get_head_to_head(p1_id_or_name, p2_id_or_name)

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

    def reconstruct_incremental(self, batch_limit: int = 50000) -> Dict[str, Any]:
        """Incrementally processes newly scraped matches without replaying historical data from scratch."""
        from psycopg2 import extras
        import time

        t0 = time.time()
        print("\n" + "=" * 68)
        print(" ⚡ INCREMENTAL ELO UPDATE ENGINE (FAST-PATH)")
        print("=" * 68)

        # 1. Fetch unranked matches
        print("[1/3] 🔍 Checking for new unranked matches in PostgreSQL...")
        new_matches = self.db.get_unranked_matches(limit=batch_limit)
        total_new = len(new_matches)

        if total_new == 0:
            print("      ✅ Database is completely up to date! Zero new matches to process.\n")
            return {"total_new_matches": 0, "status": "UP_TO_DATE"}

        print(f"      📥 Found {total_new:,} new matches to ingest incrementally.")

        # 2. Load existing player states
        print("[2/3] 🧠 Loading active player Elo ratings from PostgreSQL...")
        player_states: Dict[str, Dict[str, Any]] = {}
        player_factions: Dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
        existing_teams: Dict[str, str] = {}

        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("""
                SELECT id as player_id, team FROM players WHERE team IS NOT NULL AND TRIM(team) != ''
                UNION
                SELECT player_id, team FROM event_participants WHERE team IS NOT NULL AND TRIM(team) != '';
                """)
                for r in cur.fetchall():
                    if r.get("player_id") and r.get("team"):
                        existing_teams[r["player_id"]] = r["team"]

                cur.execute("""
                SELECT player_id, player_name, current_elo, peak_elo,
                       matches_played, wins, losses, draws, top_faction, team, last_active_date
                FROM player_ratings;
                """)
                for r in cur.fetchall():
                    pid = r["player_id"]
                    player_states[pid] = {
                        "name": r.get("player_name") or pid,
                        "elo": float(r.get("current_elo") or self.initial_elo),
                        "peak_elo": float(r.get("peak_elo") or self.initial_elo),
                        "matches_played": int(r.get("matches_played") or 0),
                        "wins": int(r.get("wins") or 0),
                        "losses": int(r.get("losses") or 0),
                        "draws": int(r.get("draws") or 0),
                        "last_active_date": r.get("last_active_date")
                    }
                    if r.get("team"):
                        existing_teams[pid] = r["team"]
                    if r.get("top_faction"):
                        for fac in r["top_faction"].split(", "):
                            if fac.strip():
                                player_factions[pid][fac.strip()] += 1

            # 3. Process new matches and append trajectory points
            print(f"[3/3] ⚡ Computing Elo updates and persisting {total_new:,} matches...")
            with conn.cursor() as cursor:
                cursor.execute("SET LOCAL synchronous_commit = OFF;")
                insert_history_pg = """
                INSERT INTO rating_history (
                    player_id, match_id, event_id, round, match_date,
                    old_elo, new_elo, delta_elo, opponent_id, opponent_name,
                    opponent_elo, result, player_faction, opponent_faction,
                    player_score, opponent_score
                ) VALUES %s;
                """

                history_batch = []
                touched_players = set()

                for m in new_matches:
                    p1_id, p2_id = m["player1_id"], m["player2_id"]
                    if not p1_id or not p2_id:
                        continue

                    s1 = player_states.get(p1_id)
                    if not s1:
                        s1 = {
                            "name": m.get("player1_name") or p1_id,
                            "elo": self.initial_elo,
                            "peak_elo": self.initial_elo,
                            "matches_played": 0, "wins": 0, "losses": 0, "draws": 0,
                            "last_active_date": None
                        }
                        player_states[p1_id] = s1

                    s2 = player_states.get(p2_id)
                    if not s2:
                        s2 = {
                            "name": m.get("player2_name") or p2_id,
                            "elo": self.initial_elo,
                            "peak_elo": self.initial_elo,
                            "matches_played": 0, "wins": 0, "losses": 0, "draws": 0,
                            "last_active_date": None
                        }
                        player_states[p2_id] = s2

                    touched_players.add(p1_id)
                    touched_players.add(p2_id)

                    old_elo1 = s1["elo"]
                    old_elo2 = s2["elo"]
                    m_date = m.get("match_date")

                    if m.get("is_bye") or m.get("is_draw"):
                        res1, res2 = ("D", "D") if m.get("is_draw") else ("W", "L")
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
                    if m_date: s1["last_active_date"] = m_date
                    if m.get("player1_faction"): player_factions[p1_id][m.get("player1_faction")] += 1

                    # Update player 2
                    s2["elo"] = new_elo2
                    s2["peak_elo"] = max(s2["peak_elo"], new_elo2)
                    s2["matches_played"] += 1
                    if res2 == "W": s2["wins"] += 1
                    elif res2 == "L": s2["losses"] += 1
                    else: s2["draws"] += 1
                    if m_date: s2["last_active_date"] = m_date
                    if m.get("player2_faction"): player_factions[p2_id][m.get("player2_faction")] += 1

                    history_batch.append((
                        p1_id, m["id"], m.get("event_id"), m.get("round"), m_date,
                        old_elo1, new_elo1, round(new_elo1 - old_elo1, 2),
                        p2_id, s2["name"], old_elo2, res1,
                        m.get("player1_faction"), m.get("player2_faction"),
                        m.get("player1_score"), m.get("player2_score")
                    ))
                    history_batch.append((
                        p2_id, m["id"], m.get("event_id"), m.get("round"), m_date,
                        old_elo2, new_elo2, round(new_elo2 - old_elo2, 2),
                        p1_id, s1["name"], old_elo1, res2,
                        m.get("player2_faction"), m.get("player1_faction"),
                        m.get("player2_score"), m.get("player1_score")
                    ))

                if history_batch:
                    extras.execute_values(cursor, insert_history_pg, history_batch, page_size=2500)
                    conn.commit()
                    cursor.execute("SET LOCAL synchronous_commit = OFF;")

                # Upsert updated player ratings for touched players only
                now_iso = datetime.now(timezone.utc)
                upsert_ratings_pg = """
                INSERT INTO player_ratings (
                    player_id, player_name, current_elo, peak_elo,
                    matches_played, wins, losses, draws, win_rate,
                    top_faction, team, last_active_date, updated_at
                ) VALUES %s
                ON CONFLICT (player_id) DO UPDATE SET
                    player_name = EXCLUDED.player_name,
                    current_elo = EXCLUDED.current_elo,
                    peak_elo = EXCLUDED.peak_elo,
                    matches_played = EXCLUDED.matches_played,
                    wins = EXCLUDED.wins,
                    losses = EXCLUDED.losses,
                    draws = EXCLUDED.draws,
                    win_rate = EXCLUDED.win_rate,
                    top_faction = EXCLUDED.top_faction,
                    team = COALESCE(player_ratings.team, EXCLUDED.team),
                    last_active_date = EXCLUDED.last_active_date,
                    updated_at = EXCLUDED.updated_at;
                """

                ratings_data = []
                for pid in touched_players:
                    s = player_states[pid]
                    total = s["matches_played"]
                    win_rate = round((s["wins"] / total) * 100.0, 1) if total > 0 else 0.0
                    factions_list = [fac for fac, cnt in player_factions[pid].most_common() if fac]
                    top_fac = ", ".join(factions_list) if factions_list else None
                    team_name = existing_teams.get(pid)

                    ratings_data.append((
                        pid, s["name"], s["elo"], s["peak_elo"],
                        total, s["wins"], s["losses"], s["draws"], win_rate,
                        top_fac, team_name, s["last_active_date"], now_iso
                    ))

                if ratings_data:
                    extras.execute_values(cursor, upsert_ratings_pg, ratings_data, page_size=2000)
                    conn.commit()

                # Invalidate caches
                if hasattr(self.db.__class__, "_stats_cache"):
                    self.db.__class__._stats_cache = None
                if hasattr(self.db.__class__, "_faction_meta_cache"):
                    self.db.__class__._faction_meta_cache = None

        total_time = time.time() - t0
        print("=" * 68)
        print(f" 🎉 INCREMENTAL UPDATE FINISHED IN {total_time:.2f}s!")
        print(f"    • New Matches Processed:   {total_new:,}")
        print(f"    • Active Players Updated:  {len(touched_players):,}")
        print(f"    • History Points Appended: {len(history_batch):,}")
        print("=" * 68 + "\n")

        return {
            "total_new_matches": total_new,
            "players_updated": len(touched_players),
            "history_points_saved": len(history_batch),
            "elapsed_seconds": round(total_time, 2)
        }

    def reconstruct_all_rankings(self, chunk_size: int = 25000) -> Dict[str, Any]:
        """Replays all historical matches chronologically using UNLOGGED COPY streaming and instant per-batch commits."""
        from psycopg2 import extras
        import io
        import time

        t0 = time.time()
        total_matches = self.db.get_total_matches_count()
        print("\n" + "=" * 68)
        print(" 🏆 WARHAMMER 40,000 HIGH-THROUGHPUT ELO RECONSTRUCTION (GCP FREE TIER)")
        print("=" * 68)
        print(f"[*] Total chronological matches in database: {total_matches:,}")

        if total_matches == 0:
            print("⚠️ No matches found in PostgreSQL database. Run a scrape first!")
            return {"total_players_ranked": 0, "total_matches_processed": 0, "history_points_saved": 0}

        player_states: Dict[str, Dict[str, Any]] = {}
        player_factions: Dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
        existing_teams: Dict[str, str] = {}

        # 1. Fetch existing teams from permanent players & participants tables
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("""
                SELECT id as player_id, team FROM players WHERE team IS NOT NULL AND TRIM(team) != ''
                UNION
                SELECT player_id, team FROM event_participants WHERE team IS NOT NULL AND TRIM(team) != ''
                UNION
                SELECT player_id, team FROM player_ratings WHERE team IS NOT NULL AND TRIM(team) != '';
                """)
                for r in cur.fetchall():
                    if r.get("player_id") and r.get("team"):
                        existing_teams[r["player_id"]] = r["team"]

                if not existing_teams:
                    print("      🔍 Scanning matches raw JSON for team affiliations...")
                    try:
                        cur.execute("""
                        SELECT DISTINCT 
                            player1_id as p_id, 
                            COALESCE(
                                raw_json->'player1'->>'teamName',
                                raw_json->'player1'->>'team',
                                raw_json->'player1'->'user'->>'teamName',
                                raw_json->'player1'->'user'->>'team'
                            ) as t_name
                        FROM matches
                        WHERE player1_id IS NOT NULL 
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
                                raw_json->'player2'->>'team',
                                raw_json->'player2'->'user'->>'teamName',
                                raw_json->'player2'->'user'->>'team'
                            ) as t_name
                        FROM matches
                        WHERE player2_id IS NOT NULL 
                          AND (
                            raw_json->'player2'->>'teamName' IS NOT NULL OR
                            raw_json->'player2'->>'team' IS NOT NULL OR
                            raw_json->'player2'->'user'->>'teamName' IS NOT NULL OR
                            raw_json->'player2'->'user'->>'team' IS NOT NULL
                          );
                        """)
                        for r in cur.fetchall():
                            t = (r.get("t_name") or "").strip()
                            if r.get("p_id") and t and t != "None" and t != "null":
                                existing_teams[r["p_id"]] = t
                                cur.execute("UPDATE players SET team = %s WHERE id = %s;", (t, r["p_id"]))
                        conn.commit()
                        print(f"      🛡️ Discovered and mapped {len(existing_teams):,} player team memberships.")
                    except Exception as e:
                        logger.debug(f"JSON team scan error: {e}")

            # 2. Prepare high-speed UNLOGGED tables for zero WAL overhead during bulk ingestion
            with conn.cursor() as cursor:
                print("[1/3] 💾 Clearing old history and optimizing table buffers...")
                cursor.execute("SET LOCAL synchronous_commit = OFF;")
                cursor.execute("DROP INDEX IF EXISTS idx_pg_history_player;")
                cursor.execute("ALTER TABLE rating_history SET UNLOGGED;")
                cursor.execute("ALTER TABLE player_ratings SET UNLOGGED;")
                cursor.execute("DELETE FROM rating_history; DELETE FROM player_ratings;")
                conn.commit()

        history_cols = (
            "player_id", "match_id", "event_id", "round", "match_date",
            "old_elo", "new_elo", "delta_elo", "opponent_id", "opponent_name",
            "opponent_elo", "result", "player_faction", "opponent_faction",
            "player_score", "opponent_score"
        )

        num_chunks = (total_matches + chunk_size - 1) // chunk_size
        print(f"[2/3] 🧠 Streaming & Replaying {num_chunks} chronological batches via UNLOGGED COPY...")

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
                ORDER BY m.match_date ASC NULLS FIRST, m.round ASC, m.table_number ASC;
                """)

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

                            s1 = player_states.get(p1_id)
                            if not s1:
                                s1 = {
                                    "name": m.get("player1_name") or p1_id,
                                    "elo": self.initial_elo,
                                    "peak_elo": self.initial_elo,
                                    "matches_played": 0, "wins": 0, "losses": 0, "draws": 0,
                                    "last_active_date": None
                                }
                                player_states[p1_id] = s1

                            s2 = player_states.get(p2_id)
                            if not s2:
                                s2 = {
                                    "name": m.get("player2_name") or p2_id,
                                    "elo": self.initial_elo,
                                    "peak_elo": self.initial_elo,
                                    "matches_played": 0, "wins": 0, "losses": 0, "draws": 0,
                                    "last_active_date": None
                                }
                                player_states[p2_id] = s2

                            old_elo1 = s1["elo"]
                            old_elo2 = s2["elo"]
                            m_date = m.get("match_date")

                            if m.get("is_bye") or m.get("is_draw"):
                                res1, res2 = ("D", "D") if m.get("is_draw") else ("W", "L")
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
                            if m_date: s1["last_active_date"] = m_date
                            if m.get("player1_faction"): player_factions[p1_id][m.get("player1_faction")] += 1

                            # Update player 2
                            s2["elo"] = new_elo2
                            s2["peak_elo"] = max(s2["peak_elo"], new_elo2)
                            s2["matches_played"] += 1
                            if res2 == "W": s2["wins"] += 1
                            elif res2 == "L": s2["losses"] += 1
                            else: s2["draws"] += 1
                            if m_date: s2["last_active_date"] = m_date
                            if m.get("player2_faction"): player_factions[p2_id][m.get("player2_faction")] += 1

                            # Row 1 (Player 1 perspective)
                            r1_vals = (
                                p1_id, m["id"], m.get("event_id"), m.get("round"), m_date,
                                old_elo1, new_elo1, round(new_elo1 - old_elo1, 2),
                                p2_id, s2["name"], old_elo2, res1,
                                m.get("player1_faction"), m.get("player2_faction"),
                                m.get("player1_score"), m.get("player2_score")
                            )
                            tsv_buffer.write("\t".join(_format_tsv_field(v) for v in r1_vals) + "\n")

                            # Row 2 (Player 2 perspective)
                            r2_vals = (
                                p2_id, m["id"], m.get("event_id"), m.get("round"), m_date,
                                old_elo2, new_elo2, round(new_elo2 - old_elo2, 2),
                                p1_id, s1["name"], old_elo1, res2,
                                m.get("player2_faction"), m.get("player1_faction"),
                                m.get("player2_score"), m.get("player1_score")
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
                        pct = min(100.0, (processed_matches / total_matches) * 100.0)
                        print(f"      📦 [Batch {c_idx}/{num_chunks}] Matches {processed_matches - c_count + 1:,} - {processed_matches:,} ({pct:.1f}%) replayed & committed in {t_chunk:.2f}s.")

                    # Re-enable LOGGED durability and build index
                    with write_conn.cursor() as write_cur:
                        print(f"      🛡️ Restoring full durability (LOGGED) and rebuilding indexes...")
                        write_cur.execute("ALTER TABLE rating_history SET LOGGED;")
                        write_cur.execute("ALTER TABLE player_ratings SET LOGGED;")
                        write_conn.commit()

                        t_idx = time.time()
                        write_cur.execute("CREATE INDEX IF NOT EXISTS idx_pg_history_player ON rating_history(player_id, match_date DESC);")
                        write_conn.commit()
                        print(f"      ✅ Index rebuilt in {time.time() - t_idx:.2f}s.")

                        # Step 3: Insert player_ratings via COPY
                        print(f"[3/3] 👑 Persisting {len(player_states):,} player standings & win rates in PostgreSQL...")
                        now_iso = datetime.now(timezone.utc)
                        ratings_cols = (
                            "player_id", "player_name", "current_elo", "peak_elo",
                            "matches_played", "wins", "losses", "draws", "win_rate",
                            "top_faction", "team", "last_active_date", "updated_at"
                        )
                        ratings_buf = io.StringIO()
                        for pid, s in player_states.items():
                            total = s["matches_played"]
                            win_rate = round((s["wins"] / total) * 100.0, 1) if total > 0 else 0.0
                            factions_list = [fac for fac, cnt in player_factions[pid].most_common() if fac]
                            top_fac = ", ".join(factions_list) if factions_list else None
                            team_name = existing_teams.get(pid)

                            r_vals = (
                                pid, s["name"], s["elo"], s["peak_elo"],
                                total, s["wins"], s["losses"], s["draws"], win_rate,
                                top_fac, team_name, s["last_active_date"], now_iso
                            )
                            ratings_buf.write("\t".join(_format_tsv_field(v) for v in r_vals) + "\n")

                        ratings_buf.seek(0)
                        write_cur.copy_from(ratings_buf, "player_ratings", columns=ratings_cols, null="\\N")
                        ratings_buf.close()
                        write_conn.commit()

                        # Invalidate caches
                        if hasattr(self.db.__class__, "_stats_cache"):
                            self.db.__class__._stats_cache = None
                        if hasattr(self.db.__class__, "_faction_meta_cache"):
                            self.db.__class__._faction_meta_cache = None

        total_time = time.time() - t0
        top_player = max(player_states.values(), key=lambda x: x["elo"]) if player_states else None

        print("=" * 68)
        print(f" 🎉 RECONSTRUCTION FINISHED IN {total_time:.2f}s!")
        print(f"    • Total Matches Replayed:   {processed_matches:,}")
        print(f"    • Total Competitors Ranked: {len(player_states):,}")
        print(f"    • Trajectory Points Saved:  {total_history_count:,}")
        if top_player:
            print(f"    • 👑 Current World #1:      {top_player['name']} (Elo: {top_player['elo']:.1f})")
        print("=" * 68 + "\n")

        return {
            "total_players_ranked": len(player_states),
            "total_matches_processed": processed_matches,
            "history_points_saved": total_history_count,
            "elapsed_seconds": round(total_time, 2)
        }


    def get_player_win_path(self, player_id: str) -> Dict[str, Any]:
        """Returns structured win path, tournament progression, and Elo timeline for a player."""
        history = self.db.get_player_history(player_id)
        player_info = self.db.search_players(player_id)
        player_meta = player_info[0] if player_info else {}

        # Fallback to matches table if rating_history is empty
        if not history:
            raw_matches = self.db.get_player_matches(player_id)
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

        return {
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
            "team": player_meta.get("team"),
            "factions_breakdown": factions_breakdown,
            "longest_win_streak": max_streak,
            "history": history,
            "win_path": history,
            "trajectory": trajectory,
            "player": player_meta
        }
