"""
Extended Multi-Game Edge Cases & Resilience Test Suite
Tests:
1. SQL Injection defense across all game_system parameters
2. Zero-match player profile resilience (no ZeroDivisionError)
3. Player team history isolation between 40k and AoS in EloEngine
4. EventStudio circuits endpoint multi-game partitioning
5. Concurrent multi-thread cache access across game systems
"""

import os
import sys
import unittest
import threading
from unittest.mock import MagicMock, patch

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from database import PostgresDatabase
from elo import EloEngine
from routers.eventstudio import api_eventstudio_get_circuits


class TestSqlInjectionDefense(unittest.TestCase):
    """Verifies that all methods using game_system are immune to SQL injection via parameterization."""

    def setUp(self):
        self.db = PostgresDatabase.__new__(PostgresDatabase)

    def test_sql_injection_payloads_parameterized(self):
        """Ensure malicious game_system inputs are strictly passed as parameters and not string-concatenated."""
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        mock_cur.fetchall.return_value = []
        mock_cur.fetchone.return_value = {"total_count": 0}

        malicious_payloads = [
            "' OR '1'='1",
            "'; DROP TABLE player_ratings; --",
            "40k' UNION SELECT id, password_hash, 1, 1 FROM users --",
            "aos' OR 1=1; --"
        ]

        with patch.object(self.db, "get_connection") as mock_get_conn:
            mock_get_conn.return_value.__enter__.return_value = mock_conn

            for payload in malicious_payloads:
                norm = payload.strip().lower()
                # 1. get_top_ranked_players
                self.db.get_top_ranked_players(game_system=payload)
                sql, params = mock_cur.execute.call_args[0]
                self.assertNotIn(payload, sql, "SQL injection vulnerability: payload concatenated into SQL string!")
                self.assertIn(norm, params, "Payload not parameterized!")

                # 2. get_players_directory
                self.db.get_players_directory(game_system=payload)
                sql, params = mock_cur.execute.call_args[0]
                self.assertNotIn(payload, sql, "SQL injection in get_players_directory!")
                self.assertIn(norm, params)

                # 3. get_events_list
                self.db.get_events_list(game_system=payload)
                sql, params = mock_cur.execute.call_args[0]
                self.assertNotIn(payload, sql, "SQL injection in get_events_list!")
                self.assertIn(norm, params)

                # 4. search_players
                self.db.search_players("Test", game_system=payload)
                sql, params = mock_cur.execute.call_args[0]
                self.assertNotIn(payload, sql, "SQL injection in search_players!")
                self.assertIn(norm, params)


class TestZeroMatchProfileResilience(unittest.TestCase):
    """Verifies that player profiles with 0 matches in a given game system do not raise errors."""

    def setUp(self):
        self.db = PostgresDatabase.__new__(PostgresDatabase)
        self.elo_engine = EloEngine.__new__(EloEngine)
        self.elo_engine.db = self.db
        self.elo_engine.initial_elo = 1500.0

    def test_player_with_zero_matches_in_aos(self):
        """Player with 40k rating but 0 AoS matches should safely return clean profile without ZeroDivisionError."""
        with patch.object(self.db, "get_player_history", return_value=[]), \
             patch.object(self.db, "get_player_matches", return_value=[]), \
             patch.object(self.db, "search_players", return_value=[]), \
             patch.object(self.db, "get_connection") as mock_get_conn:

            mock_conn = MagicMock()
            mock_cur = MagicMock()
            mock_conn.cursor.return_value.__enter__.return_value = mock_cur
            mock_cur.fetchall.return_value = []
            mock_get_conn.return_value.__enter__.return_value = mock_conn

            profile = self.elo_engine.get_player_win_path("p_new_to_aos", game_system="aos")

            self.assertEqual(profile["player_id"], "p_new_to_aos")
            self.assertEqual(profile["current_elo"], 1500.0)
            self.assertEqual(profile["total_matches"], 0)
            self.assertEqual(profile["wins"], 0)
            self.assertEqual(profile["losses"], 0)
            self.assertEqual(profile["win_rate"], 0.0)
            self.assertEqual(profile["trajectory"], [])
            self.assertEqual(profile["factions_breakdown"], [])


class TestPlayerTeamHistoryIsolation(unittest.TestCase):
    """Verifies that EloEngine isolates team history by game_system."""

    def setUp(self):
        self.db = PostgresDatabase.__new__(PostgresDatabase)
        self.elo_engine = EloEngine.__new__(EloEngine)
        self.elo_engine.db = self.db
        self.elo_engine.initial_elo = 1500.0

    def test_team_history_query_partitions_by_system(self):
        """Ensure team history query includes COALESCE(e.game_system, '40k') = %s with target_sys."""
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        mock_cur.fetchall.return_value = [("AoS Champions",)]

        with patch.object(self.db, "get_player_history", return_value=[]), \
             patch.object(self.db, "get_player_matches", return_value=[]), \
             patch.object(self.db, "search_players", return_value=[{"player_name": "Sigmarite", "current_elo": 1520}]), \
             patch.object(self.db, "get_connection") as mock_get_conn:

            mock_get_conn.return_value.__enter__.return_value = mock_conn

            profile = self.elo_engine.get_player_win_path("p_multi", game_system="aos")

            sql, params = mock_cur.execute.call_args[0]
            self.assertIn("COALESCE(e.game_system, '40k') = %s", sql)
            self.assertEqual(params[0], "p_multi")
            self.assertEqual(params[1], "aos")
            self.assertEqual(profile["team"], "AoS Champions")


class TestEventStudioCircuitsPartitioning(unittest.IsolatedAsyncioTestCase):
    """Verifies that EventStudio circuits endpoint partitions 40k and AoS circuits."""

    async def test_circuits_fallback_partitioning(self):
        """When BCP is unavailable, fallback circuits return AoS circuits for aos and 40k for 40k."""
        mock_req = MagicMock()

        # 1. 40k circuits
        with patch("urllib.request.urlopen", side_effect=Exception("BCP unreachable")):
            res_40k = await api_eventstudio_get_circuits(mock_req, game_system="40k")
            circuits_40k = [c["name"] for c in res_40k["circuits"]]
            self.assertTrue(any("40k" in name or "ITC" in name or "UKTC" in name for name in circuits_40k))
            self.assertFalse(any("Sigmar" in name for name in circuits_40k))

            # 2. AoS circuits
            res_aos = await api_eventstudio_get_circuits(mock_req, game_system="aos")
            circuits_aos = [c["name"] for c in res_aos["circuits"]]
            self.assertTrue(all("Sigmar" in name for name in circuits_aos))


class TestConcurrentCacheAccess(unittest.TestCase):
    """Verifies that concurrent requests for 40k and AoS do not corrupt in-memory caches."""

    def setUp(self):
        self.db = PostgresDatabase.__new__(PostgresDatabase)

    def test_concurrent_threads_community_cache(self):
        """Simulate concurrent threads fetching 40k and AoS community overviews simultaneously."""
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        mock_cur.fetchall.return_value = []
        mock_cur.fetchone.return_value = None

        PostgresDatabase._community_overview_cache_dict = {}

        errors = []

        def worker(sys_name):
            try:
                with patch.object(self.db, "get_connection") as mock_gc, \
                     patch.object(self.db, "reverse_geocode_coordinates", return_value={"formatted": "Austin, TX"}):
                    mock_gc.return_value.__enter__.return_value = mock_conn
                    self.db.get_community_overview(lat=30.2672, lng=-97.7431, radius_miles=50, game_system=sys_name)
            except Exception as e:
                errors.append(e)

        threads = []
        for _ in range(10):
            threads.append(threading.Thread(target=worker, args=("40k",)))
            threads.append(threading.Thread(target=worker, args=("aos",)))

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(errors), 0, f"Thread errors encountered: {errors}")
        keys = list(PostgresDatabase._community_overview_cache_dict.keys())
        has_40k = any(k[-1] == "40k" for k in keys)
        has_aos = any(k[-1] == "aos" for k in keys)
        self.assertTrue(has_40k, "40k cache key missing after concurrent runs")
        self.assertTrue(has_aos, "AoS cache key missing after concurrent runs")


if __name__ == "__main__":
    unittest.main()
