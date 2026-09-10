"""Unit tests for 180-Day Rolling Window Active Filter on the Individual Leaderboard."""
import unittest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone, timedelta

import database
database.psycopg2 = MagicMock()
database.extras = MagicMock()
from database import PostgresDatabase


def make_test_db():
    db = object.__new__(PostgresDatabase)
    db.pool = None
    return db


class TestLeaderboardActiveFilter(unittest.TestCase):
    def setUp(self):
        PostgresDatabase._players_cache_dict.clear()

    def test_get_top_ranked_players_defaults_to_active_only(self):
        db = make_test_db()
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_cursor.fetchone.return_value = {"total_count": 5}
        mock_cursor.fetchall.return_value = []

        with patch.object(db, "get_connection") as mock_get_conn:
            mock_get_conn.return_value.__enter__.return_value = mock_conn

            # Call get_top_ranked_players (defaults to active_only=True)
            res = db.get_top_ranked_players(page=1, page_size=25)

            executed_sqls = [call[0][0] for call in mock_cursor.execute.call_args_list]
            # Verify both count query and select query include the 180-day active filter
            count_sql = executed_sqls[0]
            select_sql = executed_sqls[1]

            self.assertIn("180 days", count_sql)
            self.assertIn("r.last_active_date", count_sql)
            self.assertIn("180 days", select_sql)
            self.assertIn("r.last_active_date", select_sql)

    def test_get_top_ranked_players_with_active_only_false(self):
        db = make_test_db()
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_cursor.fetchone.return_value = {"total_count": 10}
        mock_cursor.fetchall.return_value = []

        with patch.object(db, "get_connection") as mock_get_conn:
            mock_get_conn.return_value.__enter__.return_value = mock_conn

            # Explicitly pass active_only=False
            res = db.get_top_ranked_players(page=1, page_size=25, active_only=False)

            executed_sqls = [call[0][0] for call in mock_cursor.execute.call_args_list]
            count_sql = executed_sqls[0]
            select_sql = executed_sqls[1]

            self.assertNotIn("180 days", count_sql)
            self.assertNotIn("180 days", select_sql)

    def test_get_players_directory_defaults_to_active_only_false(self):
        db = make_test_db()
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_cursor.fetchone.return_value = {"total_count": 20}
        mock_cursor.fetchall.return_value = []

        with patch.object(db, "get_connection") as mock_get_conn:
            mock_get_conn.return_value.__enter__.return_value = mock_conn

            # Full directory browse should default to including all historical players
            res = db.get_players_directory(page=1, page_size=25)

            executed_sqls = [call[0][0] for call in mock_cursor.execute.call_args_list]
            count_sql = executed_sqls[0]
            select_sql = executed_sqls[1]

            self.assertNotIn("180 days", count_sql)
            self.assertNotIn("180 days", select_sql)

    def test_faction_leaderboard_active_filter(self):
        db = make_test_db()
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_cursor.fetchone.return_value = {"total_count": 3}
        mock_cursor.fetchall.return_value = []

        with patch.object(db, "get_connection") as mock_get_conn:
            mock_get_conn.return_value.__enter__.return_value = mock_conn

            # Faction active filter
            res = db.get_top_ranked_players(page=1, page_size=25, faction="Necrons", active_only=True)

            executed_sqls = [call[0][0] for call in mock_cursor.execute.call_args_list]
            count_sql = executed_sqls[0]
            select_sql = executed_sqls[1]

            self.assertIn("180 days", count_sql)
            self.assertIn("COALESCE(MAX(fpm.m_date)", count_sql)
            self.assertIn("180 days", select_sql)
            self.assertIn("COALESCE(MAX(fpm.m_date)", select_sql)

    def test_caching_differentiates_active_only(self):
        db = make_test_db()
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_cursor.fetchone.return_value = {"total_count": 1}
        mock_cursor.fetchall.return_value = [{"player_id": "p1", "player_name": "Active Player"}]

        with patch.object(db, "get_connection") as mock_get_conn:
            mock_get_conn.return_value.__enter__.return_value = mock_conn

            # Query with active_only=True
            db.get_top_ranked_players(page=1, page_size=25, active_only=True)
            self.assertEqual(mock_cursor.execute.call_count, 2)

            # Query with active_only=False should NOT hit the active_only=True cache
            db.get_top_ranked_players(page=1, page_size=25, active_only=False)
            self.assertEqual(mock_cursor.execute.call_count, 4)


if __name__ == "__main__":
    unittest.main()
