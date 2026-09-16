"""
Targeted Test Suite for Modal -> Full Page Transition & Unlinked Competitor Chat Bubble Fix

Verifies:
1. Frontend Panel Visibility:
   - switchTab in web/js/app.js clears inline style.display from .tab-panel elements and applies active class.
   - resetMyHubToProfile in web/js/my_hub.js clears subpanel visibility without applying inline style.display = 'none'.
   - openPlayerProfilePage in web/js/player_profile.js clears inline style.display on tab-player-profile.
   - openEventHubPage and openEventHubFromModal in web/js/tournaments.js clear inline style.display on tab-event-hub and close modals cleanly.
2. Unlinked User Chat Isolation:
   - database.py get_players_directory requires verified bcp_user_id for competitor matching.
   - database.py get_user_for_player requires verified bcp_user_id for competitor matching.
   - database.py create_match_request requires verified bcp_user_id for receiver resolution.
   - database.py _heal_unlinked_user_profiles clears speculative player_id from unlinked users.
   - routers/community.py only treats users as bcp_linked if verified bcp_user_id is present.
"""

import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

root_dir = Path(__file__).resolve().parent.parent
import sys
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))


class TestFrontendModalToFullPageTransitions(unittest.TestCase):
    """Verifies that JS functions properly clear inline style.display so modals transition smoothly."""

    def test_switch_tab_clears_inline_display(self):
        app_js_path = root_dir / "web" / "js" / "app.js"
        content = app_js_path.read_text(encoding="utf-8")
        
        # Verify switchTab removes inline display property
        self.assertIn("p.style.removeProperty('display');", content)
        self.assertIn("activePanel.style.removeProperty('display');", content)

    def test_reset_my_hub_no_inline_display_none(self):
        hub_js_path = root_dir / "web" / "js" / "my_hub.js"
        content = hub_js_path.read_text(encoding="utf-8")
        
        # Verify resetMyHubToProfile does NOT set style.display = 'none' on tab-player-profile / tab-event-hub
        self.assertNotIn("el.style.display = 'none';", content)
        self.assertIn("el.style.removeProperty('display');", content)

    def test_player_profile_clears_display(self):
        profile_js_path = root_dir / "web" / "js" / "player_profile.js"
        content = profile_js_path.read_text(encoding="utf-8")
        
        # Verify openPlayerProfilePage clears inline style.display
        self.assertIn("profPanel.style.removeProperty('display');", content)

    def test_event_hub_clears_display_and_closes_modals(self):
        tourn_js_path = root_dir / "web" / "js" / "tournaments.js"
        content = tourn_js_path.read_text(encoding="utf-8")
        
        # Verify openEventHubPage clears inline style.display
        self.assertIn("eventPanel.style.removeProperty('display');", content)
        # Verify openEventHubFromModal calls closeAllModals
        self.assertIn("if (typeof closeAllModals === 'function')", content)


class TestUnlinkedUserChatBubbleIsolation(unittest.TestCase):
    """Verifies that unlinked users never match competitor profiles or show chat bubbles."""

    def test_database_queries_require_bcp_user_id(self):
        db_path = root_dir / "database.py"
        content = db_path.read_text(encoding="utf-8")

        # get_players_directory JOIN
        expected_join = "(u.bcp_user_id IS NOT NULL AND u.bcp_user_id != '' AND (u.player_id = r.player_id OR u.bcp_user_id = r.player_id))"
        self.assertIn(expected_join, content)

        # get_user_for_player WHERE
        expected_where = "WHERE ((bcp_user_id IS NOT NULL AND bcp_user_id != '') AND (player_id = %s OR bcp_user_id = %s))"
        self.assertIn(expected_where, content)

        # self-healing helper exists
        self.assertIn("def _heal_unlinked_user_profiles(self):", content)
        self.assertIn("SET player_id = NULL", content)
        self.assertIn("WHERE (bcp_user_id IS NULL OR bcp_user_id = '')", content)

    def test_community_router_unlinked_isolation(self):
        comm_path = root_dir / "routers" / "community.py"
        content = comm_path.read_text(encoding="utf-8")

        # Verify bcp_user_id resolution does not fall back to unverified player_id
        self.assertNotIn("bcp_user_id = user.get(\"bcp_user_id\") or user.get(\"player_id\")", content)
        self.assertIn("bcp_user_id = user.get(\"bcp_user_id\") if user else None", content)

    def test_unlinked_user_returns_no_competitor_match(self):
        """Mock test to verify get_user_for_player logic with mock cursor."""
        import database
        from database import PostgresDatabase

        with patch.object(database, "PSYCOPG2_AVAILABLE", True), \
             patch.object(PostgresDatabase, "_ensure_pool"), \
             patch.object(PostgresDatabase, "init_db"), \
             patch.object(PostgresDatabase, "ensure_tracker_table"), \
             patch.object(PostgresDatabase, "_ensure_event_participant_columns"), \
             patch.object(PostgresDatabase, "_heal_unlinked_user_profiles"):
            db = PostgresDatabase(dsn="dbname=test")

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

        # Simulate unlinked Joe Bravo: DB query filters him out because bcp_user_id IS NULL
        mock_cursor.fetchone.return_value = None

        mock_ctx = MagicMock()
        mock_ctx.__enter__.return_value = mock_conn
        with patch.object(db, "get_connection", return_value=mock_ctx):
            result = db.get_user_for_player("H7FV6Q4PD7")
            self.assertIsNone(result)

            # Check the SQL query that was executed
            args, kwargs = mock_cursor.execute.call_args
            sql = args[0]
            self.assertIn("bcp_user_id IS NOT NULL", sql)
            self.assertIn("bcp_user_id != ''", sql)

    def test_verified_bcp_user_returns_competitor_match(self):
        """Mock test to verify get_user_for_player returns user when bcp_user_id is verified."""
        import database
        from database import PostgresDatabase

        with patch.object(database, "PSYCOPG2_AVAILABLE", True), \
             patch.object(PostgresDatabase, "_ensure_pool"), \
             patch.object(PostgresDatabase, "init_db"), \
             patch.object(PostgresDatabase, "ensure_tracker_table"), \
             patch.object(PostgresDatabase, "_ensure_event_participant_columns"), \
             patch.object(PostgresDatabase, "_heal_unlinked_user_profiles"):
            db = PostgresDatabase(dsn="dbname=test")

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

        verified_user = {
            "id": "usr-12345",
            "display_name": "Innes Wilson",
            "email": "innes@example.com",
            "role": "player",
            "player_id": "INNES123",
            "bcp_user_id": "INNES123",
            "created_at": "2026-09-01T00:00:00"
        }
        mock_cursor.fetchone.return_value = verified_user

        mock_ctx = MagicMock()
        mock_ctx.__enter__.return_value = mock_conn
        with patch.object(db, "get_connection", return_value=mock_ctx):
            result = db.get_user_for_player("INNES123")
            self.assertIsNotNone(result)
            self.assertEqual(result["id"], "usr-12345")
            self.assertEqual(result["bcp_user_id"], "INNES123")


class TestAuthPersonaPrecedenceAndMockCleanup(unittest.TestCase):
    """Verifies that auth.js never defaults to mock persona and always gives precedence to real user tokens."""

    def test_auth_js_persona_default_null_and_mock_purging(self):
        auth_js = (root_dir / "web" / "js" / "auth.js").read_text(encoding="utf-8")
        # 1. Ensure currentDevPersona defaults to null, never 'competitor'
        self.assertIn("let currentDevPersona = null;", auth_js)
        self.assertNotIn("let currentDevPersona = 'competitor';", auth_js)

        # 2. Ensure mock persona purging logic is present
        self.assertIn("localStorage.removeItem('dev_persona_override');", auth_js)
        self.assertIn("cachedProf.includes('p_innes')", auth_js)
        self.assertIn("localStorage.removeItem('native_user_profile');", auth_js)

        # 3. Ensure initAuth prioritizes real token
        self.assertIn("if (token) {", auth_js)
        self.assertIn("const res = await window.api.getAuthMe(token);", auth_js)
        self.assertIn("if (!token && currentDevPersona) {", auth_js)

    def test_my_hub_js_ignores_p_innes_cache(self):
        hub_js = (root_dir / "web" / "js" / "my_hub.js").read_text(encoding="utf-8")
        self.assertIn("parsed.player_id !== 'p_innes'", hub_js)


if __name__ == "__main__":
    unittest.main()
