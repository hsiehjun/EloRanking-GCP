"""
Test suite verifying auto-migration of user badge columns, query self-healing,
and resilient fallbacks in AuthManager to eliminate HTTP 500 errors on /api/user/dashboard
and /api/user/registered-tournaments.
"""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from auth import AuthManager


class TestAuthBadgeColumnsMigrationResilience(unittest.TestCase):
    """Test suite for AuthManager schema migration resilience and column self-healing."""

    def setUp(self):
        self.mock_db = MagicMock()
        self.mock_conn = MagicMock()
        self.mock_cursor = MagicMock()
        self.mock_conn.__enter__.return_value = self.mock_conn
        self.mock_conn.cursor.return_value.__enter__.return_value = self.mock_cursor
        self.mock_db.get_connection.return_value = self.mock_conn

    def test_ensure_user_columns_executes_ddl_with_lock_timeout(self):
        """Verify _ensure_user_columns executes safe DDL with lock_timeout = 2s."""
        auth_mgr = AuthManager.__new__(AuthManager)
        auth_mgr.db = self.mock_db

        self.mock_cursor.fetchone.return_value = (True,)  # table exists
        auth_mgr._ensure_user_columns()

        executed_sql = "".join(str(call[0][0]) for call in self.mock_cursor.execute.call_args_list)
        self.assertIn("lock_timeout = '2s'", executed_sql)
        self.assertIn("ALTER TABLE users ADD COLUMN IF NOT EXISTS pinned_badges TEXT", executed_sql)
        self.assertIn("ALTER TABLE users ADD COLUMN IF NOT EXISTS badges_celebrated BOOLEAN", executed_sql)
        self.assertIn("ALTER TABLE users ADD COLUMN IF NOT EXISTS acknowledged_badge_ids TEXT", executed_sql)
        self.mock_conn.commit.assert_called()

    def test_ensure_tables_precheck_requires_badge_columns(self):
        """Verify _ensure_tables does NOT return early if badge columns are missing from users table."""
        auth_mgr = AuthManager.__new__(AuthManager)
        auth_mgr.db = self.mock_db

        call_count = 0
        def fake_fetchone():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return (True,)  # tables exist
            elif call_count == 2:
                return (4,)  # only 4 columns exist (badge columns missing!)
            elif call_count == 3:
                return ("true",)  # auth_schema_ready is true
            elif call_count == 4:
                return (True,)  # advisory lock acquired
            return (True,)

        self.mock_cursor.fetchone.side_effect = fake_fetchone

        with patch.object(auth_mgr, "_ensure_user_columns") as mock_ensure_cols:
            auth_mgr._ensure_tables()
            executed_sqls = [str(call[0][0]) for call in self.mock_cursor.execute.call_args_list]
            has_advisory_lock = any("pg_try_advisory_lock" in sql for sql in executed_sqls)
            self.assertTrue(has_advisory_lock, "Should have proceeded to advisory lock and DDL because columns were missing")

    def test_get_user_by_id_handles_missing_column_and_falls_back_cleanly(self):
        """Verify get_user_by_id falls back to baseline query when pinned_badges column does not exist."""
        auth_mgr = AuthManager.__new__(AuthManager)
        auth_mgr.db = self.mock_db

        query_count = 0
        def fake_execute(sql, params=None):
            nonlocal query_count
            query_count += 1
            if "pinned_badges" in str(sql):
                import psycopg2
                raise Exception("column u.pinned_badges does not exist")

        self.mock_cursor.execute.side_effect = fake_execute
        self.mock_cursor.fetchone.return_value = {
            "id": "u_test_123",
            "email": "player@example.com",
            "display_name": "Test Commander",
            "role": "player",
            "player_id": "p_999",
            "bcp_user_id": "bcp_999",
            "bcp_email": "player@example.com",
            "bcp_linked_at": None,
            "competitor_name": "Test Commander",
            "current_elo": 1650.0,
            "peak_elo": 1700.0,
            "matches_played": 10,
            "wins": 7,
            "losses": 3,
            "win_rate": 70.0,
            "top_faction": "Aeldari",
            "team": "Warp Runners"
        }

        with patch.object(auth_mgr, "_ensure_user_columns") as mock_ensure:
            user = auth_mgr.get_user_by_id("u_test_123")
            self.assertIsNotNone(user)
            self.assertEqual(user["id"], "u_test_123")
            self.assertEqual(user["pinned_badges"], [])
            self.assertEqual(user["badges_celebrated"], False)
            self.assertEqual(user["acknowledged_badge_ids"], [])
            mock_ensure.assert_called_once()

    def test_get_user_by_id_parses_existing_badge_columns(self):
        """Verify get_user_by_id parses JSON badge fields when columns are present."""
        auth_mgr = AuthManager.__new__(AuthManager)
        auth_mgr.db = self.mock_db

        self.mock_cursor.fetchone.return_value = {
            "id": "u_test_456",
            "email": "veteran@example.com",
            "display_name": "Veteran Champ",
            "role": "player",
            "player_id": "p_456",
            "bcp_user_id": "bcp_456",
            "bcp_email": "veteran@example.com",
            "bcp_linked_at": None,
            "pinned_badges": '["grand_tournament_victor", "undefeated_champion"]',
            "badges_celebrated": True,
            "acknowledged_badge_ids": '["founding_warrior", "veteran_tier"]',
            "competitor_name": "Veteran Champ",
            "current_elo": 1950.0,
            "peak_elo": 2000.0,
            "matches_played": 40,
            "wins": 35,
            "losses": 5,
            "win_rate": 87.5,
            "top_faction": "Necrons",
            "team": "Dynasty"
        }

        user = auth_mgr.get_user_by_id("u_test_456")
        self.assertIsNotNone(user)
        self.assertEqual(user["pinned_badges"], ["grand_tournament_victor", "undefeated_champion"])
        self.assertTrue(user["badges_celebrated"])
        self.assertEqual(user["acknowledged_badge_ids"], ["founding_warrior", "veteran_tier"])

    def test_update_settings_resilient_badge_update(self):
        """Verify update_settings successfully updates badge preferences without transaction abortion."""
        auth_mgr = AuthManager.__new__(AuthManager)
        auth_mgr.db = self.mock_db

        auth_mgr.get_user_by_id = MagicMock(return_value={
            "id": "u_test_789",
            "email": "badge_user@example.com",
            "display_name": "Badge User",
            "role": "player",
            "pinned_badges": ["medal_1"],
            "badges_celebrated": False,
            "acknowledged_badge_ids": ["medal_1"]
        })

        self.mock_cursor.fetchone.return_value = {
            "id": "u_test_789",
            "password_hash": "hash123"
        }

        res = auth_mgr.update_settings(
            user_id="u_test_789",
            pinned_badges=["medal_2", "medal_3"],
            badges_celebrated=True,
            acknowledged_badge_ids=["medal_2"]
        )

        self.assertTrue(res.get("success"))
        executed_sqls = [str(call[0][0]) for call in self.mock_cursor.execute.call_args_list]
        update_sql = [s for s in executed_sqls if "UPDATE users SET" in s]
        self.assertTrue(len(update_sql) > 0)
        self.assertIn("pinned_badges = %s", update_sql[0])
        self.assertIn("badges_celebrated = %s", update_sql[0])
        self.assertIn("acknowledged_badge_ids = %s", update_sql[0])



import asyncio
from unittest.mock import AsyncMock
from routers.auth import api_user_dashboard, api_user_registered_tournaments


import asyncio
from unittest.mock import patch, MagicMock
from routers.auth import api_user_dashboard, api_user_registered_tournaments

class TestEndpointResilience(unittest.TestCase):
    """Verify /api/user/dashboard and /api/user/registered-tournaments never throw 500."""

    @patch("routers.auth.get_auth_manager")
    def test_dashboard_endpoint_succeeds_with_fallback_user(self, mock_get_auth):
        mock_auth = MagicMock()
        mock_get_auth.return_value = mock_auth
        mock_auth.get_session.return_value = {
            "id": "u_test_999",
            "player_id": "p_999",
            "email": "user@example.com"
        }
        mock_auth.get_user_competitor_hub.return_value = {
            "player": {"player_name": "Test Player", "current_elo": 1600.0},
            "pinned_badges": [],
            "badges_celebrated": False,
            "acknowledged_badge_ids": []
        }

        mock_req = MagicMock()
        mock_req.headers = {}
        mock_req.cookies = {}
        res = asyncio.run(api_user_dashboard(mock_req, player_id="p_999", token="tok_123"))
        self.assertIn("player", res)
        self.assertEqual(res["pinned_badges"], [])

    @patch("routers.auth.get_database")
    @patch("routers.auth.get_auth_manager")
    def test_registered_tournaments_endpoint_succeeds_with_fallback_user(self, mock_get_auth, mock_get_db):
        mock_auth = MagicMock()
        mock_get_auth.return_value = mock_auth
        mock_auth.get_session.return_value = {
            "id": "u_test_999",
            "player_id": "p_999",
            "bcp_user_id": "bcp_999"
        }
        mock_auth.get_user_by_id.return_value = {
            "id": "u_test_999",
            "player_id": "p_999",
            "bcp_user_id": "bcp_999",
            "bcp_connected": True,
            "pinned_badges": [],
            "badges_celebrated": False,
            "acknowledged_badge_ids": []
        }
        mock_db = MagicMock()
        mock_get_db.return_value = mock_db
        mock_db.get_user_registered_tournaments.return_value = []

        with patch("bcp_adapter.bcp_adapter.fetch_user_registered_events", return_value=(True, None, [])):
            mock_req = MagicMock()
            mock_req.headers = {}
            mock_req.cookies = {}
            res = asyncio.run(api_user_registered_tournaments(mock_req, token="tok_123"))
            self.assertTrue(res["success"])
            self.assertEqual(res["tournaments"], [])

if __name__ == "__main__":
    unittest.main()
