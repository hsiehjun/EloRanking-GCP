import unittest
from unittest.mock import MagicMock
import inspect
from database import PostgresDatabase
import routers.eventstudio as eventstudio_router
import routers.leaderboard as leaderboard_router
import routers.community as community_router
import leagues_hub_service


class TestAppPerformanceAndQueryIndexes(unittest.TestCase):
    """Regression tests ensuring hot database queries use indexes, avoid full table scans, and never query non-existent columns."""

    def test_no_invalid_total_matches_column_on_player_ratings(self):
        """Ensure neither database.py nor routers/eventstudio.py queries non-existent total_matches column on player_ratings."""
        db_src = inspect.getsource(PostgresDatabase.get_event_details)
        self.assertNotIn("ORDER BY total_matches", db_src)
        self.assertIn("ORDER BY matches_played DESC NULLS LAST", db_src)

        es_src = inspect.getsource(eventstudio_router)
        self.assertNotIn("SELECT current_elo, total_matches FROM player_ratings", es_src)
        self.assertIn("SELECT current_elo, matches_played AS total_matches FROM player_ratings", es_src)

    def test_get_events_field_stats_avoids_or_lower_join_scan(self):
        """Ensure get_events_field_stats uses indexed player_id join instead of OR LOWER(pr.player_name) = LOWER(ep.full_name)."""
        src = inspect.getsource(PostgresDatabase.get_events_field_stats)
        self.assertNotIn("OR (pr.player_name IS NOT NULL AND LOWER(pr.player_name) = LOWER(ep.full_name))", src)
        self.assertIn("ON ep.player_id = pr.player_id", src)

    def test_get_community_overview_paginates_before_users_join(self):
        """Ensure get_community_overview groups and limits top_comp before joining users via LATERAL."""
        src = inspect.getsource(PostgresDatabase.get_community_overview)
        self.assertIn("WITH top_comp AS", src)
        self.assertIn("LEFT JOIN LATERAL", src)
        self.assertNotIn("GROUP BY e.id, e.name, e.event_date, e.end_date, e.city, e.state, e.country, e.total_players, e.num_rounds, e.current_round, e.is_ended, e.raw_json", inspect.getsource(PostgresDatabase.get_recommended_events))

    def test_batch_player_ratings_lookups_use_indexed_player_name(self):
        """Ensure leaderboard, community, and leagues_hub_service avoid unindexed OR LOWER(player_name) = ANY(%s) full table scans."""
        lb_src = inspect.getsource(leaderboard_router)
        self.assertNotIn("OR LOWER(player_name) = ANY(%s)", lb_src)

        comm_src = inspect.getsource(community_router)
        self.assertNotIn("LOWER(player_name) = ANY(%s)", comm_src)

        lh_src = inspect.getsource(leagues_hub_service)
        self.assertNotIn("OR LOWER(TRIM(player_name)) = ANY(%s)", lh_src)

    def test_get_players_directory_paginates_before_users_join(self):
        """Ensure get_players_directory paginates player_ratings inside WITH page_ratings AS (... LIMIT %s OFFSET %s) before joining users."""
        src = inspect.getsource(PostgresDatabase.get_players_directory)
        self.assertIn("WITH page_ratings AS", src)
        self.assertIn("LEFT JOIN LATERAL", src)

    def test_get_all_teams_list_uses_window_function_instead_of_array_agg(self):
        """Ensure _get_all_teams_list uses window function overall_rn instead of ARRAY_AGG sorts."""
        src = inspect.getsource(PostgresDatabase._get_all_teams_list)
        self.assertNotIn("ARRAY_AGG", src)
        self.assertIn("overall_rn", src)

    def test_init_db_defines_coalesce_functional_indexes_and_skips_full_table_updates(self):
        """Ensure init_db creates functional expression indexes for COALESCE(game_system, '40k') and skips boot-time full table UPDATEs."""
        src = inspect.getsource(PostgresDatabase.init_db)
        self.assertIn("idx_pg_ratings_coal_sys_elo", src)
        self.assertIn("idx_pg_ratings_coal_sys_pid", src)
        self.assertIn("idx_pg_ratings_coal_sys_team", src)
        self.assertIn("idx_pg_events_coal_sys_date", src)
        self.assertIn("idx_pg_history_coal_sys_pid", src)
        self.assertNotIn("UPDATE player_ratings SET game_system = '40k'", src)

    def test_get_player_tournaments_avoids_full_event_fanout(self):
        """Ensure get_player_tournaments filters strictly by player_id without OR te.needs_full_rank = TRUE fan-out."""
        src = inspect.getsource(PostgresDatabase.get_player_tournaments)
        self.assertNotIn("OR te.needs_full_rank = TRUE", src)

    def test_get_community_overview_bounds_event_dates_and_avoids_not_exists_team_subquery(self):
        """Ensure get_community_overview bounds events_filtered by date and avoids correlated NOT EXISTS subqueries."""
        src = inspect.getsource(PostgresDatabase.get_community_overview)
        self.assertIn("INTERVAL '180 days'", src)
        self.assertNotIn("SELECT 1 FROM event_participants ep2", src)

    def test_get_events_list_enforces_status_filter(self):
        """Ensure get_events_list applies SQL filtering for completed, upcoming, and live statuses."""
        src = inspect.getsource(PostgresDatabase.get_events_list)
        self.assertIn('s_norm == "completed"', src)
        self.assertIn('s_norm == "upcoming"', src)

    def test_ensure_critical_perf_schema_and_no_ddl_in_read_fallbacks(self):
        """Ensure _ensure_critical_perf_schema runs on startup and read query fallbacks never run ALTER TABLE."""
        init_src = inspect.getsource(PostgresDatabase.__init__)
        self.assertIn("_ensure_critical_perf_schema", init_src)
        perf_src = inspect.getsource(PostgresDatabase._ensure_critical_perf_schema)
        self.assertIn("idx_pg_ratings_coal_sys_team_ilike", perf_src)
        self.assertIn("ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS event_id TEXT", perf_src)

        for method in (
            PostgresDatabase.get_players_directory,
            PostgresDatabase.get_events_list,
            PostgresDatabase.get_faction_meta_stats,
            PostgresDatabase.get_player_history,
            PostgresDatabase.get_player_matches,
            PostgresDatabase.search_players,
            PostgresDatabase.get_head_to_head,
        ):
            self.assertNotIn("ALTER TABLE", inspect.getsource(method))

    def test_team_roster_and_matches_use_indexes_and_short_circuit_toast(self):
        """Ensure get_team_roster uses LOWER(TRIM(team)) = LOWER(%s), get_team_matches uses UNION ALL, and tournament queries short-circuit TOAST."""
        roster_src = inspect.getsource(PostgresDatabase.get_team_roster)
        self.assertIn("LOWER(TRIM(team)) = LOWER(%s)", roster_src)
        matches_src = inspect.getsource(PostgresDatabase.get_team_matches)
        self.assertIn("WITH raw_team_matches AS", matches_src)
        self.assertIn("UNION ALL", matches_src)
        multi_src = inspect.getsource(PostgresDatabase.get_multiple_players_tournaments)
        self.assertLess(multi_src.index("NULLIF(e.num_rounds, 0)"), multi_src.index("numberOfRounds"))
        self.assertLess(multi_src.index("NULLIF(e.total_players, 0)"), multi_src.index("totalPlayers"))
        perf_src = inspect.getsource(PostgresDatabase._ensure_critical_perf_schema)
        self.assertIn("(TRIM(team))", perf_src)
        self.assertIn("idx_pg_ratings_coal_sys_team_cov", perf_src)
        self.assertIn("VACUUM ANALYZE player_ratings", perf_src)
        teams_src = inspect.getsource(PostgresDatabase._get_all_teams_list)
        self.assertIn("SUM(tp.is_active) OVER", teams_src)
        self.assertIn("SET LOCAL work_mem = '64MB'", teams_src)
        self.assertIn("SET LOCAL enable_seqscan = off", teams_src)
        search_src = inspect.getsource(PostgresDatabase.search_players)
        self.assertIn("is_id_token", search_src)

    def test_slow_log_optimizations_pool_indexes_and_bcp_dedup(self):
        """Regression test for slow-log fixes: pool detection, player_tournaments index pushdown, BCP inflight locks, and dedup_ep CTE."""
        pool_src = inspect.getsource(PostgresDatabase._ensure_pool)
        self.assertIn("self.pool = PostgresDatabase._pool", pool_src)

        db_inst = PostgresDatabase.__new__(PostgresDatabase)
        old_pool = getattr(PostgresDatabase, "_pool", None)
        try:
            PostgresDatabase._pool = object()
            db_inst.pool = PostgresDatabase._pool
            self.assertFalse(db_inst._is_mock_instance())
        finally:
            PostgresDatabase._pool = old_pool

        pt_src = inspect.getsource(PostgresDatabase.get_player_tournaments)
        self.assertIn("WHERE m.player1_id = %(pid)s -- OR te.needs_full_rank", pt_src)
        self.assertIn("WHERE ep.player_id = %(pid)s -- OR te.needs_full_rank", pt_src)

        perf_src = inspect.getsource(PostgresDatabase._ensure_critical_perf_schema)
        self.assertIn("idx_pg_matches_p1_date", perf_src)
        self.assertIn("idx_pg_matches_p2_date", perf_src)

        fs_src = inspect.getsource(PostgresDatabase.get_events_field_stats)
        self.assertIn("WITH dedup_ep AS", fs_src)

        bcp_src = inspect.getsource(PostgresDatabase.fetch_and_cache_bcp_event_placings)
        self.assertIn("_bcp_placings_inflight_locks", bcp_src)
        self.assertIn("_bcp_fetch_semaphore", bcp_src)

    def test_in_progress_events_all_platforms(self):
        """Ensure in-progress tournaments across Melee, Limitless, TopDeck, and Longshanks preserve is_ended=False and is_done=False on unreported matches."""
        import tempfile
        from scripts.local_sqlite_db import LocalSqliteDatabase
        from datetime import datetime, timezone
        from scripts.sync_multiplatform import (
            _melee_write_tournament,
            _topdeck_table_winner,
            get_existing_platform_event_ids,
            get_open_platform_event_targets,
        )

        ev_list_src = inspect.getsource(PostgresDatabase.get_events_list)
        self.assertIn("in_progress", ev_list_src)
        self.assertIn("e.event_date <= NOW() + INTERVAL '14 hours'", ev_list_src)

        ev_det_src = inspect.getsource(PostgresDatabase.get_event_details)
        self.assertIn("isinstance(raw_st_val, dict)", ev_det_src)

        # Unreported TopDeck table returns None; PointMode finished table returns winner
        self.assertIsNone(_topdeck_table_winner({"Es": {"arrayValue": {"values": [{"integerValue": "1"}, {"integerValue": "2"}]}}}, [1, 2]))
        self.assertEqual(
            _topdeck_table_winner(
                {
                    "End": {"integerValue": "1793103931882"},
                    "Points": {"arrayValue": {"values": [{"integerValue": "0"}, {"integerValue": "5"}]}},
                },
                [4, 7],
            ),
            7,
        )

        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with tempfile.TemporaryDirectory() as tmpdir:
            db = LocalSqliteDatabase(db_path=f"{tmpdir}/live_test.sqlite")
            _melee_write_tournament(
                db,
                "999001",
                {
                    "title": "Live Melee Test",
                    "start_date": now_iso,
                    "game_name": "Magic: The Gathering",
                    "status": "In Progress",
                    "standings": [],
                    "roundMatches": [
                        {
                            "roundNum": 1,
                            "matches": [
                                {
                                    "Guid": "aaaa1111bbbb",
                                    "TableNumber": 1,
                                    "ResultString": "Alice won 2-0-0",
                                    "ByeReason": None,
                                    "Competitors": [
                                        {"Team": {"Players": [{"Username": "alice", "DisplayName": "Alice"}]}, "GameWins": 2, "GameWinsAndGameByes": 2},
                                        {"Team": {"Players": [{"Username": "bob", "DisplayName": "Bob"}]}, "GameWins": 0, "GameWinsAndGameByes": 0},
                                    ],
                                },
                                {
                                    "Guid": "cccc2222dddd",
                                    "TableNumber": 2,
                                    "ResultString": "Not reported",
                                    "ByeReason": None,
                                    "Competitors": [
                                        {"Team": {"Players": [{"Username": "carol", "DisplayName": "Carol"}]}, "GameWins": None, "GameWinsAndGameByes": 0},
                                        {"Team": {"Players": [{"Username": "dave", "DisplayName": "Dave"}]}, "GameWins": None, "GameWinsAndGameByes": 0},
                                    ],
                                },
                            ],
                        }
                    ],
                },
                "mtg",
            )
            conn = db._connect()
            ev_row = conn.execute("SELECT is_ended, current_round, end_date FROM events WHERE id = 'melee:999001';").fetchone()
            self.assertEqual(ev_row["is_ended"], 0)
            self.assertEqual(ev_row["current_round"], 1)

            m_rows = {
                r["table_number"]: dict(r)
                for r in conn.execute("SELECT table_number, winner_id, is_draw, is_done, player1_score FROM matches WHERE event_id = 'melee:999001';")
            }
            self.assertEqual(m_rows[1]["is_done"], 1)
            self.assertEqual(m_rows[1]["winner_id"], "melee:alice")
            self.assertEqual(m_rows[2]["is_done"], 0)
            self.assertEqual(m_rows[2]["is_draw"], 0)
            self.assertIsNone(m_rows[2]["winner_id"])
            self.assertIsNone(m_rows[2]["player1_score"])

            # In-progress event must NOT be skipped by get_existing_platform_event_ids, and MUST be returned by get_open_platform_event_targets
            self.assertEqual(get_existing_platform_event_ids(db, "melee"), set())
            self.assertEqual(get_open_platform_event_targets(db, "melee", game_system="mtg"), [("mtg", "999001")])

            # Elo reconstruction must rate ONLY the completed match (Table 1: Alice vs Bob), ignoring Table 2
            elo_res = db.reconstruct_elo_for_system("mtg")
            self.assertEqual(elo_res["matches_processed"], 1)
            self.assertEqual(elo_res["players_rated"], 2)

            # Transition event to Ended once Table 2 reports
            _melee_write_tournament(
                db,
                "999001",
                {
                    "title": "Live Melee Test",
                    "start_date": now_iso,
                    "game_name": "Magic: The Gathering",
                    "status": "Ended",
                    "standings": [],
                    "roundMatches": [
                        {
                            "roundNum": 1,
                            "matches": [
                                {
                                    "Guid": "aaaa1111bbbb",
                                    "TableNumber": 1,
                                    "ResultString": "Alice won 2-0-0",
                                    "ByeReason": None,
                                    "Competitors": [
                                        {"Team": {"Players": [{"Username": "alice", "DisplayName": "Alice"}]}, "GameWins": 2, "GameWinsAndGameByes": 2},
                                        {"Team": {"Players": [{"Username": "bob", "DisplayName": "Bob"}]}, "GameWins": 0, "GameWinsAndGameByes": 0},
                                    ],
                                },
                                {
                                    "Guid": "cccc2222dddd",
                                    "TableNumber": 2,
                                    "ResultString": "Carol won 2-1-0",
                                    "ByeReason": None,
                                    "Competitors": [
                                        {"Team": {"Players": [{"Username": "carol", "DisplayName": "Carol"}]}, "GameWins": 2, "GameWinsAndGameByes": 2},
                                        {"Team": {"Players": [{"Username": "dave", "DisplayName": "Dave"}]}, "GameWins": 1, "GameWinsAndGameByes": 1},
                                    ],
                                },
                            ],
                        }
                    ],
                },
                "mtg",
            )
            self.assertIn("999001", get_existing_platform_event_ids(db, "melee"))
            self.assertEqual(get_open_platform_event_targets(db, "melee", game_system="mtg"), [])
            elo_res2 = db.reconstruct_elo_for_system("mtg")
            self.assertEqual(elo_res2["matches_processed"], 2)
            self.assertEqual(elo_res2["players_rated"], 4)

    def test_no_unescaped_percent_in_parameterized_postgres_sql(self):
        """Prevents psycopg2 IndexError ('tuple index out of range') from unescaped % in parameterized SQL."""
        from pathlib import Path
        import ast
        import re

        repo_root = Path(__file__).resolve().parents[1]
        targets = [repo_root / "database.py"] + sorted((repo_root / "routers").glob("*.py"))
        offenders = []
        for path in targets:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and node.func.attr in ("execute", "executemany")
                    and len(node.args) >= 2
                ):
                    arg0 = node.args[0]
                    sql_str = None
                    if isinstance(arg0, ast.Constant) and isinstance(arg0.value, str):
                        sql_str = arg0.value
                    elif isinstance(arg0, ast.JoinedStr):
                        sql_str = "".join(
                            v.value for v in arg0.values if isinstance(v, ast.Constant) and isinstance(v.value, str)
                        )
                    if sql_str:
                        cleaned = re.sub(r"%%|%s|%\([a-zA-Z0-9_]+\)s", "", sql_str)
                        if "%" in cleaned:
                            offenders.append(f"{path.name}:{node.lineno}")
        self.assertEqual(offenders, [], f"Unescaped '%' in parameterized SQL: {offenders}")


if __name__ == "__main__":
    unittest.main()

