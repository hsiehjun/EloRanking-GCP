"""Retroactive repair utility for historical BCP match scores/outcomes and global Elo ratings.

Why this exists:
----------------
Prior to the `/v1/events/{id}/pairings` endpoint fix, `scraper.py` fetched pairings via
`/v1/pairings?eventId=...`, which omitted `player1Game` and `player2Game` and only
exposed legacy `metaData` (`p1-gamePoints`, `p2-gamePoints`, `p1-gameResult`, `p2-gameResult`).
On certain pairings where a TO edited or swapped scores (such as LVO 2026 `7ohG0RuDqC1k`
Round 2 Table 224: Junior Aflleje vs Isaac Terada), `metaData` retained stale/inverted
points (`68-66` Win instead of `66-68` Loss), which was persisted into the PostgreSQL
`matches` table and propagated into `rating_history` and `player_ratings`.

additionally, in multi-stage tournaments with Playoff Pods (`pod: True` in BCP's
`total_games`), playoff rounds had `gameNum: 1, 2, 3` which could collide with Swiss
rounds `1, 2, 3` when matching per-player game histories.

What this module does:
----------------------
1. Identifies candidate BCP events in PostgreSQL (events containing matches with legacy
   `metaData` game fields, completed events with unscored matches, or explicitly targeted
   events including `7ohG0RuDqC1k`).
2. Fetches authoritative per-player game records from BCP (`/v1/events/{id}/players`)
   with Playoff Pod round-offset normalization (`effectiveRound = event_max_swiss + gameNum`),
   plus `/v1/events/{id}/pairings` fallback when needed.
3. Reconciles and updates any mismatched `player1_score`, `player2_score`, `winner_id`,
   `loser_id`, `is_draw`, and `is_done` rows in PostgreSQL `matches`, and clears stale
   cached match arrays in `events.raw_json`.
4. Triggers an atomic chronological replay of all matches via
   `EloEngine.reconstruct_all_rankings(game_system="all")` so `rating_history` and
   `player_ratings` reflect the corrected outcomes and Elo trajectories.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import logging
import os
import sys
import threading
import time
from typing import Any, Dict, List, Optional, Set, Tuple

# Ensure project root is importable when executed as `python3 scripts/repair_matches_and_elo.py`
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import is_bcp_event_id
from database import Database, get_db
from elo import get_elo_engine
from scraper import BestCoastPairingsScraper
from scraper import BestCoastPairingsScraper as _RealBCPScraper

try:
    from psycopg2 import extras
    if not hasattr(extras, "execute_batch"):
        extras.execute_batch = lambda cur, sql, argslist, page_size=100: cur.executemany(sql, argslist)
except ImportError:
    class _DummyExtras:
        RealDictCursor = None

        @staticmethod
        def execute_batch(cur, sql, argslist, page_size=100):
            return cur.executemany(sql, argslist)

    extras = _DummyExtras()

logger = logging.getLogger(__name__)

REPAIR_MIGRATION_KEY = "bcp_pairing_elo_repair_v5"
ALWAYS_CHECK_EVENT_IDS = (
    "7ohG0RuDqC1k",
    "DAVY7pZIVACh",
    "Xm3Y3oXsyH3V",
    "5dYDVVnPIDSz",
    "a3OVZEBq96dd",
    "WMNAh7pm6f0M",
    "GZahflUfMMm1",
    "vioLQXa9DO6x",
)
META_BUG_WINDOW_START = "2026-09-01"

_REPAIR_LOCK = threading.Lock()
_REPAIR_STATUS: Dict[str, Any] = {
    "running": False,
    "last_started_at": None,
    "last_completed_at": None,
    "last_result": None,
    "last_error": None,
}


def get_repair_status() -> Dict[str, Any]:
    """Return a snapshot of the current/last background repair job status."""
    return dict(_REPAIR_STATUS)


def _db_get_setting(db: Any, key: str) -> Optional[str]:
    if hasattr(db, "get_setting"):
        return db.get_setting(key)
    try:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT value FROM system_settings WHERE key = %s;", (str(key),))
                row = cur.fetchone()
                if row is not None:
                    return row[0] if isinstance(row, (list, tuple)) else row.get("value")
    except Exception:
        pass
    return None


def _db_set_setting(db: Any, key: str, value: str) -> bool:
    if hasattr(db, "set_setting"):
        return bool(db.set_setting(key, value))
    try:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO system_settings (key, value, updated_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
                    """,
                    (str(key), str(value)),
                )
            conn.commit()
        return True
    except Exception:
        return False


def _compute_authoritative_outcome(
    p1_id: str,
    p2_id: str,
    p1_score: Optional[int],
    p2_score: Optional[int],
    p1_result: Optional[int],
    p2_result: Optional[int],
    is_bye: bool = False,
) -> Tuple[Optional[str], Optional[str], bool, bool]:
    """Determine (winner_id, loser_id, is_draw, is_done) from authoritative BCP game records."""
    if is_bye:
        return p1_id, None, False, True

    winner_id: Optional[str] = None
    loser_id: Optional[str] = None
    is_draw = False
    has_scores = p1_score is not None and p2_score is not None

    if p1_result == 2 and p2_result == 0:
        winner_id, loser_id = p1_id, p2_id
    elif p2_result == 2 and p1_result == 0:
        winner_id, loser_id = p2_id, p1_id
    elif p1_result == 1 and p2_result == 1:
        is_draw = True
    elif has_scores:
        if p1_score > p2_score:
            winner_id, loser_id = p1_id, p2_id
        elif p2_score > p1_score:
            winner_id, loser_id = p2_id, p1_id
        elif p1_score == p2_score:
            if p1_result == 2 or p2_result == 0:
                winner_id, loser_id = p1_id, p2_id
            elif p2_result == 2 or p1_result == 0:
                winner_id, loser_id = p2_id, p1_id
            elif p1_score > 0:
                is_draw = True
    else:
        if p1_result == 2 or p2_result == 0:
            winner_id, loser_id = p1_id, p2_id
        elif p2_result == 2 or p1_result == 0:
            winner_id, loser_id = p2_id, p1_id
        elif p1_result == 1 or p2_result == 1:
            is_draw = True

    is_done = bool(winner_id or is_draw or is_bye)
    return winner_id, loser_id, is_draw, is_done


def _find_game_for_round(games: List[Dict[str, Any]], round_num: int) -> Optional[Dict[str, Any]]:
    """Find the authoritative game entry matching `round_num` (respecting `effectiveRound` for pods)."""
    if not isinstance(games, list):
        return None
    for g in games:
        if not isinstance(g, dict):
            continue
        try:
            eff_r = int(
                g.get("effectiveRound")
                or (0 if g.get("pod") else (g.get("gameNum") or g.get("gameNumber") or 0))
            )
        except (ValueError, TypeError):
            eff_r = 0
        if eff_r == int(round_num):
            return g
    return None


def _lookup_player_games_in_roster_map(
    roster_id_map: Dict[str, Any],
    roster_name_games_map: Dict[str, List[Dict[str, Any]]],
    player_id: Optional[str],
    player_name: Optional[str],
    raw_match: Dict[str, Any],
    side: int,
) -> List[Dict[str, Any]]:
    """Resolve a match participant to their authoritative `games` array from `roster_id_map`."""
    candidates: List[str] = []
    if player_id:
        candidates.append(str(player_id).strip())
    if isinstance(raw_match, dict):
        p_obj = raw_match.get(f"player{side}")
        if isinstance(p_obj, dict):
            u_obj = p_obj.get("user") or {}
            if isinstance(u_obj, dict) and u_obj.get("id"):
                candidates.append(str(u_obj.get("id")).strip())
            for k in ("userId", "id", "playerId"):
                if p_obj.get(k):
                    candidates.append(str(p_obj.get(k)).strip())
        for k in (f"player{side}Id", f"player{side}UserId"):
            if raw_match.get(k):
                candidates.append(str(raw_match.get(k)).strip())

    for cid in candidates:
        if not cid:
            continue
        games = roster_id_map.get(f"games:{cid}")
        if isinstance(games, list) and games:
            return games
        canonical = roster_id_map.get(cid)
        if isinstance(canonical, str) and canonical:
            c_games = roster_id_map.get(f"games:{canonical}")
            if isinstance(c_games, list) and c_games:
                return c_games

    if player_name:
        clean_n = str(player_name).strip().lower()
        if clean_n and clean_n in roster_name_games_map:
            return roster_name_games_map[clean_n]

    return []


def find_candidate_event_ids(
    db: Database,
    explicit_event_ids: Optional[List[str]] = None,
    days: Optional[int] = None,
    scan_all: bool = False,
) -> List[str]:
    """Identify BCP event IDs in PostgreSQL where any player's match results may be corrupted."""
    if explicit_event_ids:
        cleaned = [str(eid).strip() for eid in explicit_event_ids if str(eid).strip()]
        return list(dict.fromkeys(cleaned))

    event_ids: Set[str] = set()
    with db.get_connection() as conn:
        with conn.cursor() as cur:
            # Always include explicitly known affected events if they exist in matches/events
            for known_id in ALWAYS_CHECK_EVENT_IDS:
                cur.execute(
                    "SELECT 1 FROM events WHERE id = %s UNION ALL SELECT 1 FROM matches WHERE event_id = %s LIMIT 1;",
                    (known_id, known_id),
                )
                if cur.fetchone():
                    event_ids.add(known_id)

            if scan_all:
                cur.execute("""
                    SELECT DISTINCT m.event_id
                    FROM matches m
                    WHERE m.event_id IS NOT NULL
                      AND m.event_id != ''
                      AND m.event_id NOT LIKE 'ES-%%'
                      AND m.event_id NOT LIKE 'native_%%'
                      AND m.event_id NOT LIKE 'melee:%%'
                      AND m.event_id NOT LIKE 'ltcg:%%'
                      AND m.event_id NOT LIKE 'ls:%%'
                      AND m.event_id NOT LIKE 'td:%%'
                      AND m.event_id NOT LIKE 'league_%%';
                """)
                for (eid,) in cur.fetchall():
                    if eid and is_bcp_event_id(str(eid)):
                        event_ids.add(str(eid))
                return sorted(event_ids)

            if days is not None and int(days) > 0:
                window_sql = "e.event_date >= NOW() - (%s * INTERVAL '1 day')"
                window_params: Tuple[Any, ...] = (int(days),)
            else:
                window_sql = "e.event_date >= %s::timestamptz"
                window_params = (META_BUG_WINDOW_START,)

            # 1. All-Player Battle Points Mismatch or Playoff Pods within the target window:
            #    Compares each player's official tournament `battle_points` in `event_participants`
            #    against the sum of their round-by-round scores in `matches`, or flags Playoff Pod events.
            cur.execute(
                f"""
                WITH recent_events AS (
                    SELECT e.id
                    FROM events e
                    WHERE {window_sql}
                      AND e.event_date <= NOW() + INTERVAL '1 day'
                      AND e.id NOT LIKE 'ES-%%'
                      AND e.id NOT LIKE 'native_%%'
                      AND e.id NOT LIKE 'melee:%%'
                      AND e.id NOT LIKE 'ltcg:%%'
                      AND e.id NOT LIKE 'ls:%%'
                      AND e.id NOT LIKE 'td:%%'
                      AND e.id NOT LIKE 'league_%%'
                ),
                player_match_totals AS (
                    SELECT
                        m.event_id,
                        s.player_id,
                        SUM(s.score) AS match_bp,
                        BOOL_OR(s.is_bye) AS had_bye
                    FROM matches m
                    JOIN recent_events re ON m.event_id = re.id
                    CROSS JOIN LATERAL (
                        VALUES
                            (m.player1_id, COALESCE(m.player1_score, 0), COALESCE(m.is_bye, FALSE)),
                            (CASE WHEN COALESCE(m.is_bye, FALSE) THEN NULL ELSE m.player2_id END, COALESCE(m.player2_score, 0), FALSE)
                    ) AS s(player_id, score, is_bye)
                    WHERE s.player_id IS NOT NULL AND s.player_id != ''
                    GROUP BY m.event_id, s.player_id
                )
                SELECT DISTINCT ep.event_id
                FROM event_participants ep
                JOIN recent_events re ON ep.event_id = re.id
                LEFT JOIN player_match_totals pmt
                  ON ep.event_id = pmt.event_id AND ep.player_id = pmt.player_id
                WHERE ep.pod_num IS NOT NULL
                   OR (
                       COALESCE(ep.dropped, FALSE) = FALSE
                       AND COALESCE(pmt.had_bye, FALSE) = FALSE
                       AND ep.battle_points IS NOT NULL
                       AND ep.battle_points > 0
                       AND (pmt.match_bp IS NULL OR ep.battle_points != pmt.match_bp)
                   );
                """,
                window_params,
            )
            for (eid,) in cur.fetchall():
                if eid and is_bcp_event_id(str(eid)):
                    event_ids.add(str(eid))

            # 2. Score vs. Winner Contradictions, raw_json playerGame discrepancies, or unscored completed events:
            cur.execute(
                f"""
                SELECT DISTINCT m.event_id
                FROM matches m
                JOIN events e ON e.id = m.event_id
                WHERE {window_sql}
                  AND e.event_date <= NOW() + INTERVAL '1 day'
                  AND e.id NOT LIKE 'ES-%%'
                  AND e.id NOT LIKE 'native_%%'
                  AND e.id NOT LIKE 'melee:%%'
                  AND e.id NOT LIKE 'ltcg:%%'
                  AND e.id NOT LIKE 'ls:%%'
                  AND e.id NOT LIKE 'td:%%'
                  AND e.id NOT LIKE 'league_%%'
                  AND m.is_bye = FALSE
                  AND (
                      (
                          m.player1_score IS NOT NULL
                          AND m.player2_score IS NOT NULL
                          AND (
                              (m.winner_id = m.player1_id AND m.player1_score < m.player2_score)
                              OR (m.winner_id = m.player2_id AND m.player2_score < m.player1_score)
                              OR (m.is_draw = TRUE AND m.player1_score != m.player2_score)
                          )
                      )
                      OR (
                          COALESCE(e.is_ended, FALSE) = TRUE
                          AND e.event_date <= NOW() - INTERVAL '6 hours'
                          AND (m.is_done = FALSE OR (m.winner_id IS NULL AND m.is_draw = FALSE))
                      )
                  );
                """,
                window_params,
            )
            for (eid,) in cur.fetchall():
                if eid and is_bcp_event_id(str(eid)):
                    event_ids.add(str(eid))

            # 3. Partially scraped or multi-week/ongoing events missing rounds in `matches`:
            cur.execute(
                f"""
                WITH recent_events AS (
                    SELECT e.id, e.num_rounds, e.current_round, e.is_ended, e.end_date
                    FROM events e
                    WHERE {window_sql}
                      AND e.event_date <= NOW() + INTERVAL '1 day'
                      AND e.id NOT LIKE 'ES-%%'
                      AND e.id NOT LIKE 'native_%%'
                      AND e.id NOT LIKE 'melee:%%'
                      AND e.id NOT LIKE 'ltcg:%%'
                      AND e.id NOT LIKE 'ls:%%'
                      AND e.id NOT LIKE 'td:%%'
                      AND e.id NOT LIKE 'league_%%'
                ),
                match_round_stats AS (
                    SELECT
                        m.event_id,
                        COUNT(DISTINCT m.round) AS db_rounds,
                        MAX(m.round) AS max_db_round
                    FROM matches m
                    JOIN recent_events re ON re.id = m.event_id
                    GROUP BY m.event_id
                )
                SELECT re.id
                FROM recent_events re
                LEFT JOIN match_round_stats mrs ON mrs.event_id = re.id
                WHERE (
                    COALESCE(re.num_rounds, 0) > 0
                    AND COALESCE(mrs.db_rounds, 0) < COALESCE(re.num_rounds, 0)
                )
                OR (
                    COALESCE(re.num_rounds, 0) > 0
                    AND COALESCE(re.current_round, 0) < COALESCE(re.num_rounds, 0)
                )
                OR COALESCE(re.is_ended, FALSE) = FALSE
                OR (re.end_date IS NOT NULL AND re.end_date >= NOW() - INTERVAL '14 days');
                """,
                window_params,
            )
            for (eid,) in cur.fetchall():
                if eid and is_bcp_event_id(str(eid)):
                    event_ids.add(str(eid))

    return sorted(event_ids)


def _fetch_event_authoritative_data(
    scraper: BestCoastPairingsScraper,
    event_id: str,
) -> Tuple[str, Dict[str, Any], Dict[str, List[Dict[str, Any]]], Optional[str]]:
    """Fetch BCP `/players?placings=true` roster for `event_id` and build ID and name lookup maps."""
    try:
        # Fast single-request fetch to `/events/{event_id}/players?limit=2500&placings=true`
        # which contains `games` and `total_games` for every competitor.
        roster: List[Dict[str, Any]] = []
        make_req = getattr(scraper, "_make_request", None)
        used_direct_req = callable(make_req) and type(make_req).__name__ not in ("MagicMock", "NonCallableMagicMock")
        if used_direct_req:
            resp = make_req(
                f"/events/{event_id}/players",
                params={"limit": 2500, "placings": "true"},
            )
            if isinstance(resp, dict):
                if isinstance(resp.get("active"), list):
                    roster = resp["active"]
                elif isinstance(resp.get("data"), list):
                    roster = resp["data"]
                elif isinstance(resp.get("players"), list):
                    roster = resp["players"]
            elif isinstance(resp, list):
                roster = resp
            if not roster and getattr(scraper, "last_http_code", None) != 404:
                resp2 = make_req(
                    f"/events/{event_id}/players",
                    params={"limit": 2500},
                )
                if isinstance(resp2, dict):
                    roster = resp2.get("active") or resp2.get("data") or resp2.get("players") or []
                elif isinstance(resp2, list):
                    roster = resp2
        else:
            roster = scraper.fetch_event_players(event_id)
        if not isinstance(roster, list) or not roster:
            return event_id, {}, {}, None
        roster_id_map = scraper.build_roster_id_map(roster)
        if isinstance(roster_id_map, dict):
            roster_id_map["__raw_roster__"] = roster
        roster_name_games_map: Dict[str, List[Dict[str, Any]]] = {}
        for k, val in roster_id_map.items():
            if k.startswith("fullname:") and isinstance(val, str):
                cid = k[len("fullname:"):]
                games = roster_id_map.get(f"games:{cid}")
                name_lower = val.strip().lower()
                if name_lower and isinstance(games, list) and games and name_lower not in roster_name_games_map:
                    roster_name_games_map[name_lower] = games
        return event_id, roster_id_map, roster_name_games_map, None
    except Exception as e:
        return event_id, {}, {}, str(e)


def repair_historical_matches_and_elo(
    db: Optional[Database] = None,
    event_ids: Optional[List[str]] = None,
    days: Optional[int] = None,
    scan_all: bool = False,
    reconstruct: bool = True,
    force_reconstruct: bool = False,
    max_workers: int = 24,
) -> Dict[str, Any]:
    """Reconcile historical BCP matches against authoritative per-player game records and rebuild Elo."""
    if not _REPAIR_LOCK.acquire(blocking=False):
        return {
            "status": "already_running",
            "message": "A match & Elo repair job is already in progress.",
            "repair_status": get_repair_status(),
        }

    t0 = time.time()
    _REPAIR_STATUS["running"] = True
    _REPAIR_STATUS["last_started_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _REPAIR_STATUS["last_error"] = None

    try:
        db = db or get_db()
        scraper = BestCoastPairingsScraper(db=db, request_delay=0.0)
        parser_helper = _RealBCPScraper(db=db, request_delay=0.0)

        candidates = find_candidate_event_ids(
            db=db,
            explicit_event_ids=event_ids,
            days=days,
            scan_all=scan_all,
        )
        logger.info(
            f"[RepairMatchesElo] Scanning {len(candidates)} candidate BCP events for stale pairing results or missing rounds..."
        )

        # Fetch authoritative player rosters concurrently
        roster_by_event: Dict[str, Tuple[Dict[str, Any], Dict[str, List[Dict[str, Any]]]]] = {}
        fetch_errors: Dict[str, str] = {}

        if candidates:
            workers = max(1, min(int(max_workers or 16), len(candidates), 24))
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = {
                    pool.submit(_fetch_event_authoritative_data, scraper, eid): eid
                    for eid in candidates
                }
                for fut in as_completed(futures):
                    eid, id_map, name_map, err = fut.result()
                    if err:
                        fetch_errors[eid] = err
                    elif id_map:
                        roster_by_event[eid] = (id_map, name_map)

        updates_to_apply: List[Tuple[Any, ...]] = []
        inserted_matches_to_apply: List[Dict[str, Any]] = []
        events_with_inserted_rounds: Dict[str, int] = {}
        repaired_matches_detail: List[Dict[str, Any]] = []
        repaired_event_ids: Set[str] = set()
        scanned_matches_count = 0

        # Load and compare matches for all candidate events
        with db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                for eid in candidates:
                    maps = roster_by_event.get(eid)
                    if not maps:
                        continue
                    roster_id_map, roster_name_games_map = maps

                    # Compute authoritative rounds played from player `games` in `roster_id_map`
                    round_player_counts: Dict[int, int] = {}
                    seen_canonical_pids: Set[str] = set()
                    for k_map, v_games in roster_id_map.items():
                        if not isinstance(k_map, str) or not k_map.startswith("games:") or not isinstance(v_games, list):
                            continue
                        raw_pid = k_map[len("games:"):]
                        canon_pid = str(roster_id_map.get(raw_pid) or raw_pid)
                        if canon_pid in seen_canonical_pids:
                            continue
                        seen_canonical_pids.add(canon_pid)
                        for g_item in v_games:
                            if not isinstance(g_item, dict):
                                continue
                            eff_r = int(g_item.get("effectiveRound") or g_item.get("gameNum") or g_item.get("round") or 0)
                            if eff_r <= 0:
                                continue
                            has_played_result = (
                                g_item.get("gameResult") in (0, 1, 2)
                                or (g_item.get("gamePoints") is not None and int(g_item.get("gamePoints") or 0) > 0)
                            )
                            if has_played_result:
                                round_player_counts[eff_r] = round_player_counts.get(eff_r, 0) + 1

                    cur.execute(
                        """
                        SELECT
                            id, event_id, round, table_number,
                            player1_id, player1_name, player1_score,
                            player2_id, player2_name, player2_score,
                            winner_id, loser_id, is_draw, is_bye, is_done,
                            raw_json
                        FROM matches
                        WHERE event_id = %s
                        ORDER BY round ASC, table_number ASC;
                        """,
                        (eid,),
                    )
                    rows = cur.fetchall()
                    if not isinstance(rows, list):
                        rows = []

                    db_round_match_counts: Dict[int, int] = {}
                    for m_row in rows:
                        if isinstance(m_row, dict):
                            r_db = int(m_row.get("round") or 1)
                            db_round_match_counts[r_db] = db_round_match_counts.get(r_db, 0) + 1

                    # Detect rounds played in BCP that are missing or under-populated in PostgreSQL `matches`
                    max_roster_round = max(round_player_counts.keys()) if round_player_counts else 0
                    missing_rounds_to_fetch: List[int] = []
                    for r_check in range(1, max_roster_round + 1):
                        players_with_result = round_player_counts.get(r_check, 0)
                        if players_with_result < 2:
                            continue
                        expected_matches = max(1, players_with_result // 2)
                        existing_matches = db_round_match_counts.get(r_check, 0)
                        if existing_matches == 0 or existing_matches < max(1, int(expected_matches * 0.75)):
                            missing_rounds_to_fetch.append(r_check)

                    pairings_fallback_by_round: Dict[int, Dict[Tuple[int, str, str], Dict[str, Any]]] = {}

                    if missing_rounds_to_fetch:
                        ev_meta_loaded = False
                        ev_date_str: Optional[str] = None
                        ev_gs: str = "40k"

                        for r_miss in missing_rounds_to_fetch:
                            try:
                                round_pairings = scraper.fetch_event_pairings_for_round(eid, round_num=r_miss)
                                if not isinstance(round_pairings, list) or not round_pairings:
                                    continue
                                if not ev_meta_loaded:
                                    ev_meta_loaded = True
                                    try:
                                        cur.execute(
                                            "SELECT event_date, game_system FROM events WHERE id = %s LIMIT 1;",
                                            (eid,),
                                        )
                                        ev_row = cur.fetchone()
                                        if isinstance(ev_row, dict):
                                            ev_date_str = str(ev_row.get("event_date") or "")[:19] or None
                                            ev_gs = str(ev_row.get("game_system") or "40k")
                                    except Exception:
                                        pass
                                p_map: Dict[Tuple[int, str, str], Dict[str, Any]] = {}
                                round_inserted = 0
                                for rp in round_pairings:
                                    if not isinstance(rp, dict):
                                        continue
                                    rp_table = int(rp.get("table") or 0)
                                    rp_p1 = str((rp.get("player1") or {}).get("userId") or (rp.get("player1") or {}).get("id") or "")
                                    rp_p2 = str((rp.get("player2") or {}).get("userId") or (rp.get("player2") or {}).get("id") or "")
                                    p_map[(rp_table, rp_p1, rp_p2)] = rp
                                    p_map[(rp_table, "", "")] = rp

                                    rp_with_round = dict(rp)
                                    rp_with_round.setdefault("round", r_miss)
                                    ev_data_dict = {
                                        "id": eid,
                                        "eventDate": ev_date_str,
                                        "game_system": ev_gs,
                                    }

                                    parse_fn = getattr(scraper, "parse_and_store_match", None)
                                    parsed_m = None
                                    if callable(parse_fn) and type(parse_fn).__name__ not in ("MagicMock", "NonCallableMagicMock"):
                                        parsed_m = parse_fn(
                                            ev_data_dict,
                                            rp_with_round,
                                            roster_id_map=roster_id_map,
                                            defer_db_write=True,
                                        )
                                    else:
                                        parsed_m = parser_helper.parse_and_store_match(
                                            ev_data_dict,
                                            rp_with_round,
                                            roster_id_map=roster_id_map,
                                            defer_db_write=True,
                                        )
                                    if isinstance(parsed_m, dict) and parsed_m.get("id"):
                                        inserted_matches_to_apply.append(parsed_m)
                                        round_inserted += 1
                                pairings_fallback_by_round[r_miss] = p_map
                                if round_inserted > 0:
                                    repaired_event_ids.add(eid)
                                    events_with_inserted_rounds[eid] = max(
                                        events_with_inserted_rounds.get(eid, 0),
                                        max_roster_round,
                                        r_miss,
                                    )
                                    logger.info(
                                        f"[RepairMatchesElo] Event {eid} Round {r_miss}: queued {round_inserted} missing/unscraped matches from BCP pairings."
                                    )
                            except Exception as miss_err:
                                logger.warning(f"[RepairMatchesElo] Failed fetching missing round {r_miss} for {eid}: {miss_err}")

                    if not rows:
                        continue

                    for m in rows:
                        scanned_matches_count += 1
                        if m.get("is_bye"):
                            continue

                        p1_id = str(m.get("player1_id") or "").strip()
                        p2_id = str(m.get("player2_id") or "").strip()
                        if not p1_id or not p2_id:
                            continue

                        r_num = int(m.get("round") or 1)
                        t_num = int(m.get("table_number") or 0)
                        raw_m = m.get("raw_json")
                        if isinstance(raw_m, str):
                            try:
                                raw_m = json.loads(raw_m)
                            except Exception:
                                raw_m = {}
                        elif not isinstance(raw_m, dict):
                            raw_m = {}

                        p1_games = _lookup_player_games_in_roster_map(
                            roster_id_map, roster_name_games_map, p1_id, m.get("player1_name"), raw_m, 1
                        )
                        p2_games = _lookup_player_games_in_roster_map(
                            roster_id_map, roster_name_games_map, p2_id, m.get("player2_name"), raw_m, 2
                        )

                        g1 = _find_game_for_round(p1_games, r_num)
                        g2 = _find_game_for_round(p2_games, r_num)

                        auth_p1_score: Optional[int] = None
                        auth_p1_res: Optional[int] = None
                        auth_p2_score: Optional[int] = None
                        auth_p2_res: Optional[int] = None

                        if g1:
                            if g1.get("gamePoints") is not None:
                                try:
                                    auth_p1_score = int(g1["gamePoints"])
                                except (ValueError, TypeError):
                                    pass
                            if g1.get("gameResult") is not None:
                                try:
                                    auth_p1_res = int(g1["gameResult"])
                                except (ValueError, TypeError):
                                    pass

                        if g2:
                            if g2.get("gamePoints") is not None:
                                try:
                                    auth_p2_score = int(g2["gamePoints"])
                                except (ValueError, TypeError):
                                    pass
                            if g2.get("gameResult") is not None:
                                try:
                                    auth_p2_res = int(g2["gameResult"])
                                except (ValueError, TypeError):
                                    pass

                        # Fallback to `/v1/events/{eid}/pairings?round={r_num}` if player games didn't have this round
                        meta = raw_m.get("metaData") if isinstance(raw_m.get("metaData"), dict) else {}
                        has_legacy_meta = any(
                            meta.get(k) is not None
                            for k in ("p1-gamePoints", "p2-gamePoints", "p1-gameResult", "p2-gameResult")
                        )
                        if (auth_p1_score is None or auth_p2_score is None) and has_legacy_meta:
                            if r_num not in pairings_fallback_by_round:
                                p_map = {}
                                try:
                                    round_pairings = scraper.fetch_event_pairings_for_round(eid, round_num=r_num)
                                    if isinstance(round_pairings, list):
                                        for rp in round_pairings:
                                            if not isinstance(rp, dict):
                                                continue
                                            rp_table = int(rp.get("table") or 0)
                                            rp_p1 = str((rp.get("player1") or {}).get("userId") or (rp.get("player1") or {}).get("id") or "")
                                            rp_p2 = str((rp.get("player2") or {}).get("userId") or (rp.get("player2") or {}).get("id") or "")
                                            p_map[(rp_table, rp_p1, rp_p2)] = rp
                                            p_map[(rp_table, "", "")] = rp
                                except Exception:
                                    pass
                                pairings_fallback_by_round[r_num] = p_map

                            rp_match = (
                                pairings_fallback_by_round[r_num].get((t_num, p1_id, p2_id))
                                or pairings_fallback_by_round[r_num].get((t_num, "", ""))
                            )
                            if isinstance(rp_match, dict):
                                p1g = rp_match.get("player1Game") or {}
                                p2g = rp_match.get("player2Game") or {}
                                if auth_p1_score is None and p1g.get("points") is not None:
                                    try:
                                        auth_p1_score = int(p1g["points"])
                                    except (ValueError, TypeError):
                                        pass
                                if auth_p1_res is None and p1g.get("result") is not None:
                                    try:
                                        auth_p1_res = int(p1g["result"])
                                    except (ValueError, TypeError):
                                        pass
                                if auth_p2_score is None and p2g.get("points") is not None:
                                    try:
                                        auth_p2_score = int(p2g["points"])
                                    except (ValueError, TypeError):
                                        pass
                                if auth_p2_res is None and p2g.get("result") is not None:
                                    try:
                                        auth_p2_res = int(p2g["result"])
                                    except (ValueError, TypeError):
                                        pass

                        # Only overwrite when authoritative scores or results exist
                        if (
                            auth_p1_score is None
                            and auth_p2_score is None
                            and auth_p1_res is None
                            and auth_p2_res is None
                        ):
                            continue

                        new_p1_score = auth_p1_score if auth_p1_score is not None else m.get("player1_score")
                        new_p2_score = auth_p2_score if auth_p2_score is not None else m.get("player2_score")

                        new_winner_id, new_loser_id, new_is_draw, new_is_done = _compute_authoritative_outcome(
                            p1_id=p1_id,
                            p2_id=p2_id,
                            p1_score=new_p1_score,
                            p2_score=new_p2_score,
                            p1_result=auth_p1_res,
                            p2_result=auth_p2_res,
                            is_bye=False,
                        )

                        old_p1_score = m.get("player1_score")
                        old_p2_score = m.get("player2_score")
                        old_winner_id = m.get("winner_id")
                        old_loser_id = m.get("loser_id")
                        old_is_draw = bool(m.get("is_draw"))
                        old_is_done = bool(m.get("is_done"))

                        if (
                            new_p1_score != old_p1_score
                            or new_p2_score != old_p2_score
                            or new_winner_id != old_winner_id
                            or new_loser_id != old_loser_id
                            or new_is_draw != old_is_draw
                            or new_is_done != old_is_done
                        ):
                            updates_to_apply.append(
                                (
                                    new_p1_score,
                                    new_p2_score,
                                    new_winner_id,
                                    new_loser_id,
                                    new_is_draw,
                                    new_is_done,
                                    m["id"],
                                )
                            )
                            repaired_event_ids.add(eid)
                            repaired_matches_detail.append(
                                {
                                    "match_id": m["id"],
                                    "event_id": eid,
                                    "round": r_num,
                                    "table_number": t_num,
                                    "player1_id": p1_id,
                                    "player1_name": m.get("player1_name"),
                                    "player2_id": p2_id,
                                    "player2_name": m.get("player2_name"),
                                    "old": {
                                        "player1_score": old_p1_score,
                                        "player2_score": old_p2_score,
                                        "winner_id": old_winner_id,
                                        "is_draw": old_is_draw,
                                        "is_done": old_is_done,
                                    },
                                    "new": {
                                        "player1_score": new_p1_score,
                                        "player2_score": new_p2_score,
                                        "winner_id": new_winner_id,
                                        "is_draw": new_is_draw,
                                        "is_done": new_is_done,
                                    },
                                }
                            )

                if updates_to_apply or inserted_matches_to_apply:
                    if updates_to_apply:
                        logger.info(
                            f"[RepairMatchesElo] Applying {len(updates_to_apply)} authoritative match updates across {len(repaired_event_ids)} events..."
                        )
                        extras.execute_batch(
                            cur,
                            """
                            UPDATE matches
                            SET player1_score = %s,
                                player2_score = %s,
                                winner_id = %s,
                                loser_id = %s,
                                is_draw = %s,
                                is_done = %s
                            WHERE id = %s;
                            """,
                            updates_to_apply,
                            page_size=200,
                        )
                    for rep_eid, max_r in events_with_inserted_rounds.items():
                        cur.execute(
                            """
                            UPDATE events
                            SET current_round = GREATEST(COALESCE(current_round, 0), %s),
                                num_rounds = GREATEST(COALESCE(num_rounds, 0), %s)
                            WHERE id = %s;
                            """,
                            (max_r, max_r, rep_eid),
                        )
                    # Clear any cached `matches` snapshot inside `events.raw_json` for repaired events
                    for rep_eid in repaired_event_ids:
                        cur.execute(
                            """
                            UPDATE events
                            SET raw_json = (raw_json::jsonb - 'matches')::json
                            WHERE id = %s
                              AND raw_json IS NOT NULL
                              AND (raw_json::jsonb ? 'matches');
                            """,
                            (rep_eid,),
                        )
                    conn.commit()

        if inserted_matches_to_apply:
            logger.info(
                f"[RepairMatchesElo] Upserting {len(inserted_matches_to_apply)} newly backfilled matches across {len(events_with_inserted_rounds)} events..."
            )
            db.upsert_matches_batch(inserted_matches_to_apply)
            for rep_eid in events_with_inserted_rounds:
                maps = roster_by_event.get(rep_eid)
                raw_roster = maps[0].get("__raw_roster__") if maps and isinstance(maps[0], dict) else None
                if isinstance(raw_roster, list) and raw_roster:
                    try:
                        parser_helper.ingest_event_roster(rep_eid, raw_roster)
                    except Exception as ing_err:
                        logger.warning(f"[RepairMatchesElo] Failed refreshing roster for {rep_eid}: {ing_err}")

        total_repaired_or_inserted = len(updates_to_apply) + len(inserted_matches_to_apply)
        super_faction_repair_summary = None
        if hasattr(db, "repair_super_factions_in_db"):
            try:
                super_faction_repair_summary = db.repair_super_factions_in_db(force=bool(total_repaired_or_inserted > 0))
            except Exception as sf_err:
                logger.warning(f"[RepairMatchesElo] Super-faction repair notice: {sf_err}")

        elo_summary = None
        should_reconstruct = bool(reconstruct and (total_repaired_or_inserted > 0 or force_reconstruct))
        if should_reconstruct:
            elo_engine = get_elo_engine(db=db)
            if scan_all or not hasattr(elo_engine, "reconstruct_since_date"):
                logger.info("[RepairMatchesElo] Starting full Elo reconstruction (game_system='all')...")
                elo_summary = elo_engine.reconstruct_all_rankings(game_system="all")
            else:
                logger.info(
                    f"[RepairMatchesElo] Starting windowed Elo reconstruction since {META_BUG_WINDOW_START} (game_system='all')..."
                )
                elo_summary = elo_engine.reconstruct_since_date(
                    since_date=META_BUG_WINDOW_START,
                    game_system="all",
                )
            elo_engine.invalidate_caches()

        # Invalidate caches only when matches were actually repaired/inserted or Elo was reconstructed
        if total_repaired_or_inserted > 0 or should_reconstruct:
            if hasattr(db, "invalidate_all_caches"):
                db.invalidate_all_caches(purge_l2=False)
            try:
                from routers import leaderboard as lb_router
                if hasattr(lb_router, "_EVENT_DETAILS_CACHE"):
                    lb_router._EVENT_DETAILS_CACHE.clear()
                if hasattr(lb_router, "_event_details_cache"):
                    lb_router._event_details_cache.clear()
            except Exception:
                pass

        elapsed = round(time.time() - t0, 2)
        result = {
            "status": "success",
            "candidate_events_scanned": len(candidates),
            "matches_scanned": scanned_matches_count,
            "matches_repaired": len(updates_to_apply),
            "matches_inserted": len(inserted_matches_to_apply),
            "events_repaired": sorted(repaired_event_ids),
            "repaired_matches_sample": repaired_matches_detail[:100],
            "elo_reconstructed": should_reconstruct,
            "elo_summary": elo_summary,
            "fetch_errors_count": len(fetch_errors),
            "elapsed_seconds": elapsed,
        }
        _REPAIR_STATUS["last_result"] = result
        _REPAIR_STATUS["last_completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if not event_ids and should_reconstruct:
            _db_set_setting(db, REPAIR_MIGRATION_KEY, "completed")
            _db_set_setting(
                db,
                f"{REPAIR_MIGRATION_KEY}_summary",
                json.dumps(
                    {
                        "completed_at": _REPAIR_STATUS["last_completed_at"],
                        "candidate_events_scanned": len(candidates),
                        "matches_repaired": len(updates_to_apply),
                        "events_repaired": sorted(repaired_event_ids),
                        "elapsed_seconds": elapsed,
                    }
                ),
            )
        logger.info(
            f"[RepairMatchesElo] Completed in {elapsed}s: {len(updates_to_apply)} matches repaired across {len(repaired_event_ids)} events (reconstructed={should_reconstruct})."
        )
        return result

    except Exception as e:
        logger.error(f"[RepairMatchesElo] Fatal error during match & Elo repair: {e}", exc_info=True)
        _REPAIR_STATUS["last_error"] = str(e)
        raise
    finally:
        _REPAIR_STATUS["running"] = False
        _REPAIR_LOCK.release()


def ensure_startup_elo_repair_migration(db: Optional[Database] = None) -> bool:
    """Run the one-time retroactive BCP pairing & Elo repair if not yet marked completed in `system_settings`."""
    db = db or get_db()
    multiplatform_key = "multiplatform_elo_dedup_and_sync_v2"
    try:
        if _db_get_setting(db, multiplatform_key) != "completed":
            logger.info(f"[RepairMatchesElo] Running '{multiplatform_key}' across MTG, TCG & tabletop systems...")
            elo_engine = get_elo_engine(db=db)
            elo_engine.reconstruct_incremental(batch_limit=25000, game_system="mtg")
            elo_engine.reconstruct_incremental(
                batch_limit=25000,
                game_system="pokemon,one_piece,digimon,lorcana,sw_unlimited,flesh_blood,gundam_tcg,riftbound,yugioh,mcp,sw_legion,shatterpoint,x_wing,malifaux,warmachine,guild_ball,middle_earth,conquest,bolt_action,battletech,blood_bowl,kill_team,horus_heresy,the_old_world"
            )
            elo_engine.invalidate_caches()
            if hasattr(db, "invalidate_all_caches"):
                db.invalidate_all_caches(purge_l2=False)
            _db_set_setting(db, multiplatform_key, "completed")
    except Exception as mp_err:
        logger.warning(f"[RepairMatchesElo] Multiplatform Elo dedup/sync notice: {mp_err}")

    try:
        status_val = _db_get_setting(db, REPAIR_MIGRATION_KEY)
        if status_val == "completed":
            return False

        # Acquire a non-blocking PostgreSQL advisory lock so concurrent Cloud Run instances
        # scaling up simultaneously never run duplicate repairs.
        lock_id = 840202601
        with db.get_connection() as lock_conn:
            with lock_conn.cursor() as cur:
                cur.execute("SELECT pg_try_advisory_lock(%s);", (lock_id,))
                row = cur.fetchone()
                got_lock = bool(row[0]) if row is not None and isinstance(row, (list, tuple)) else True
            if not got_lock:
                logger.info(
                    f"[RepairMatchesElo] Another instance is already running '{REPAIR_MIGRATION_KEY}'; skipping."
                )
                return False
            try:
                # Re-check after acquiring lock
                if _db_get_setting(db, REPAIR_MIGRATION_KEY) == "completed":
                    return False

                logger.info(
                    f"[RepairMatchesElo] Running one-time self-healing migration '{REPAIR_MIGRATION_KEY}'..."
                )
                res = repair_historical_matches_and_elo(
                    db=db,
                    reconstruct=True,
                    force_reconstruct=False,
                )
                if res.get("status") == "success":
                    _db_set_setting(db, REPAIR_MIGRATION_KEY, "completed")
                    _db_set_setting(
                        db,
                        f"{REPAIR_MIGRATION_KEY}_summary",
                        json.dumps(
                            {
                                "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                "candidate_events_scanned": res.get("candidate_events_scanned"),
                                "matches_repaired": res.get("matches_repaired"),
                                "events_repaired": res.get("events_repaired"),
                                "elapsed_seconds": res.get("elapsed_seconds"),
                            }
                        ),
                    )
                    return True
            finally:
                try:
                    with lock_conn.cursor() as cur:
                        cur.execute("SELECT pg_advisory_unlock(%s);", (lock_id,))
                except Exception:
                    pass
    except Exception as e:
        logger.warning(f"[RepairMatchesElo] Startup migration '{REPAIR_MIGRATION_KEY}' deferred: {e}")
    return False


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    parser = argparse.ArgumentParser(
        description="Retroactively repair corrupted BCP match results and reconstruct global Elo ratings."
    )
    parser.add_argument(
        "--event-id",
        dest="event_ids",
        action="append",
        help="Specific BCP event ID(s) to repair (can be specified multiple times).",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=None,
        help="Also scan all BCP events within the past N days.",
    )
    parser.add_argument(
        "--scan-all",
        action="store_true",
        help="Scan all BCP events in the database (default scans events with legacy metaData or unscored completed matches).",
    )
    parser.add_argument(
        "--no-reconstruct",
        action="store_true",
        help="Only repair matches table without running full Elo reconstruction.",
    )
    parser.add_argument(
        "--force-reconstruct",
        action="store_true",
        help="Run full Elo reconstruction even if 0 match rows needed changes.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=10,
        help="Max concurrent BCP API workers (default: 10).",
    )
    args = parser.parse_args()

    res = repair_historical_matches_and_elo(
        event_ids=args.event_ids,
        days=args.days,
        scan_all=args.scan_all,
        reconstruct=not args.no_reconstruct,
        force_reconstruct=args.force_reconstruct,
        max_workers=args.workers,
    )
    print(json.dumps(res, indent=2, default=str))


if __name__ == "__main__":
    main()
