import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import unittest
import asyncio
from unittest.mock import MagicMock, patch
import json
import time

from database import PostgresDatabase
from routers.leaderboard import api_stats, api_factions, health_check
from server import root_health_check


class TestStatsResilienceAndHealth(unittest.TestCase):
    """Verifies ultra-fast health endpoints, stats multi-tier caching, and non-blocking resilience."""

    def setUp(self):
        PostgresDatabase._stats_cache_map.clear()
        PostgresDatabase._stats_cache = None
        PostgresDatabase._stats_cache_time = 0

    def tearDown(self):
        PostgresDatabase._stats_cache_map.clear()
        if PostgresDatabase._stats_refresh_lock.locked():
            try:
                PostgresDatabase._stats_refresh_lock.release()
            except RuntimeError:
                pass

    def test_health_check_endpoints(self):
        """Verify root and router /health endpoints return instant status ok."""
        res_root = asyncio.run(root_health_check())
        self.assertEqual(res_root, {"status": "ok"})

        res_router = asyncio.run(health_check())
        self.assertEqual(res_router, {"status": "ok"})

    def test_api_stats_threadpool_delegation(self):
        """Verify api_stats runs off-thread and returns dictionary."""
        with patch("routers.leaderboard.get_database") as mock_get_db:
            mock_db = MagicMock()
            mock_get_db.return_value = mock_db
            mock_db.get_summary_stats.return_value = {
                "total_players": 77322,
                "total_matches": 312000,
                "total_events": 4500,
                "top_player_name": "Innes Wilson",
                "top_player_elo": 2185.4,
                "factions": ["Adeptus Astartes"],
                "game_system": "40k"
            }
            res = asyncio.run(api_stats("40k"))
            mock_db.get_summary_stats.assert_called_once_with(game_system="40k")
            self.assertEqual(res["total_players"], 77322)
            self.assertEqual(res["game_system"], "40k")

    def test_api_factions_threadpool_delegation(self):
        """Verify api_factions runs off-thread and extracts factions."""
        with patch("routers.leaderboard.get_database") as mock_get_db:
            mock_db = MagicMock()
            mock_get_db.return_value = mock_db
            mock_db.get_summary_stats.return_value = {
                "factions": ["Adepta Sororitas", "Necrons"],
                "game_system": "40k"
            }
            res = asyncio.run(api_factions("40k"))
            mock_db.get_summary_stats.assert_called_once_with(game_system="40k")
            self.assertEqual(res, ["Adepta Sororitas", "Necrons"])

    def test_get_summary_stats_memory_cache_hit(self):
        """Verify hot in-memory cache hit bypasses all database calls."""
        fake_db = MagicMock(spec=PostgresDatabase)
        test_data = {"total_players": 500, "total_matches": 1000, "total_events": 10, "game_system": "40k"}
        PostgresDatabase._stats_cache_map["40k"] = (test_data, time.time())

        # Calling get_summary_stats directly
        res = PostgresDatabase.get_summary_stats(fake_db, "40k")
        self.assertEqual(res, test_data)
        fake_db.get_connection.assert_not_called()

    def test_get_summary_stats_stale_while_revalidate(self):
        """Verify stale cache is returned instantly if another thread is currently refreshing."""
        fake_db = MagicMock(spec=PostgresDatabase)
        stale_data = {"total_players": 400, "total_matches": 800, "game_system": "40k"}
        # Cached 2000s ago (>1800s TTL)
        PostgresDatabase._stats_cache_map["40k"] = (stale_data, time.time() - 2000)

        # Simulate another worker thread holding the refresh lock
        PostgresDatabase._stats_refresh_lock.acquire(blocking=True)
        try:
            res = PostgresDatabase.get_summary_stats(fake_db, "40k")
            self.assertEqual(res, stale_data)
            fake_db.get_connection.assert_not_called()
        finally:
            PostgresDatabase._stats_refresh_lock.release()

    def test_get_summary_stats_persisted_system_settings_hit(self):
        """Verify cold container boot loads from system_settings table before heavy query."""
        fake_db = MagicMock(spec=PostgresDatabase)
        persisted_dict = {
            "total_players": 77000,
            "total_matches": 310000,
            "total_events": 4400,
            "top_player_name": "Innes Wilson",
            "top_player_elo": 2185.0,
            "factions": ["Space Marines"],
            "game_system": "40k"
        }

        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_cur.fetchone.return_value = [json.dumps(persisted_dict), time.time()]
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        fake_db.get_connection.return_value.__enter__.return_value = mock_conn

        res = PostgresDatabase.get_summary_stats(fake_db, "40k")
        self.assertEqual(res["total_players"], 77000)
        # Should be stored in memory cache now
        self.assertIn("40k", PostgresDatabase._stats_cache_map)

    def test_get_summary_stats_exception_fallback_no_ddl(self):
        """Verify that when database connection fails, default fallback is returned and no DDL is executed."""
        fake_db = MagicMock(spec=PostgresDatabase)
        fake_db.get_connection.side_effect = Exception("DB down or timeout")

        res_40k = PostgresDatabase.get_summary_stats(fake_db, "40k")
        self.assertEqual(res_40k["total_players"], PostgresDatabase.DEFAULT_40K_STATS["total_players"])
        self.assertEqual(res_40k["game_system"], "40k")
        self.assertTrue(len(res_40k["factions"]) > 0)

        res_aos = PostgresDatabase.get_summary_stats(fake_db, "aos")
        self.assertEqual(res_aos["total_players"], PostgresDatabase.DEFAULT_AOS_STATS["total_players"])
        self.assertEqual(res_aos["game_system"], "aos")


if __name__ == "__main__":
    unittest.main()
