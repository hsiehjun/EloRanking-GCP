"""
Comprehensive Multi-Game Data Isolation Test Suite
Verifies complete, leak-free partition between Warhammer 40K and Age of Sigmar (AoS)
across:
1. Leaderboard (Players & Teams)
2. Player Search & Team Search / Rosters
3. Community Hub (Tournaments, Local Competitors, Local Leaderboard, Local Teams)
4. My Hub / Competitor Hub (Ratings, Trajectory History, Faction Mastery, Matchup Matrix, Events Attended)
5. Army Lists Storage & Retrieval
6. Frontend Cache Invalidation & Pagination Reset
"""

import os
import sys
import unittest
from unittest.mock import MagicMock, patch

# Add repository root to path
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from database import PostgresDatabase
from auth import AuthManager
from elo import EloEngine


class TestLeaderboardDataIsolation(unittest.TestCase):
    """Verifies that Leaderboard player and team queries strictly isolate 40k and AoS."""

    def setUp(self):
        self.db = PostgresDatabase.__new__(PostgresDatabase)

    def test_players_leaderboard_query_isolation(self):
        """Ensure get_top_ranked_players / get_players_directory isolates 40k vs aos."""
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        mock_cur.fetchall.return_value = []
        mock_cur.fetchone.return_value = {"total_count": 0}

        with patch.object(self.db, "get_connection") as mock_get_conn:
            mock_get_conn.return_value.__enter__.return_value = mock_conn

            # 1. 40k request
            self.db.get_top_ranked_players(page=1, page_size=25, game_system="40k")
            sql_40k, params_40k = mock_cur.execute.call_args[0]
            self.assertIn("COALESCE(r.game_system, '40k') = %s", sql_40k)
            self.assertIn("40k", params_40k)
            self.assertNotIn("aos", params_40k)

            # 2. AoS request
            self.db.get_top_ranked_players(page=1, page_size=25, game_system="aos")
            sql_aos, params_aos = mock_cur.execute.call_args[0]
            self.assertIn("COALESCE(r.game_system, '40k') = %s", sql_aos)
            self.assertIn("aos", params_aos)
            self.assertNotIn("40k", params_aos)

    def test_faction_filtered_leaderboard_isolation(self):
        """Ensure faction-filtered leaderboard queries isolate match data and rating data."""
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        mock_cur.fetchall.return_value = []
        mock_cur.fetchone.return_value = {"total_count": 0}

        with patch.object(self.db, "get_connection") as mock_get_conn:
            mock_get_conn.return_value.__enter__.return_value = mock_conn

            # AoS Stormcast Eternals
            self.db.get_players_directory(faction="Stormcast Eternals", game_system="aos")
            sql_call = mock_cur.execute.call_args[0]
            sql, params = sql_call
            self.assertIn("COALESCE(game_system, '40k') = %s", sql)
            self.assertIn("COALESCE(r.game_system, '40k') = %s", sql)
            self.assertIn("aos", params)
            self.assertNotIn("40k", params)

    def test_teams_leaderboard_cache_and_query_isolation(self):
        """Ensure _get_all_teams_list partitions in-memory cache and SQL queries by game system."""
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        mock_cur.fetchall.return_value = []

        with patch.object(self.db, "get_connection") as mock_get_conn:
            mock_get_conn.return_value.__enter__.return_value = mock_conn

            # Clear static caches
            PostgresDatabase._all_teams_cache_map = {}

            # Query 40k
            self.db._get_all_teams_list(game_system="40k")
            self.assertIn("40k", PostgresDatabase._all_teams_cache_map)
            self.assertNotIn("aos", PostgresDatabase._all_teams_cache_map)

            sql_40k, params_40k = mock_cur.execute.call_args[0]
            self.assertIn("COALESCE(game_system, '40k') = %s", sql_40k)
            self.assertIn("40k", params_40k)

            # Query AoS
            self.db._get_all_teams_list(game_system="aos")
            self.assertIn("aos", PostgresDatabase._all_teams_cache_map)

            sql_aos, params_aos = mock_cur.execute.call_args[0]
            self.assertIn("COALESCE(game_system, '40k') = %s", sql_aos)
            self.assertIn("aos", params_aos)


class TestSearchAndDirectoryDataIsolation(unittest.TestCase):
    """Verifies that Player Search, Team Search, and Team Rosters enforce strict isolation."""

    def setUp(self):
        self.db = PostgresDatabase.__new__(PostgresDatabase)

    def test_search_players_query_isolation(self):
        """Ensure search_players autocomplete filters by game_system."""
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        mock_cur.fetchall.return_value = []

        with patch.object(self.db, "get_connection") as mock_get_conn:
            mock_get_conn.return_value.__enter__.return_value = mock_conn

            # 40k Search
            self.db.search_players("John", game_system="40k")
            sql_40k, params_40k = mock_cur.execute.call_args[0]
            self.assertIn("COALESCE(game_system, '40k') = %s", sql_40k)
            self.assertIn("40k", params_40k)
            self.assertNotIn("aos", params_40k)

            # AoS Search
            self.db.search_players("Sigmar", game_system="aos")
            sql_aos, params_aos = mock_cur.execute.call_args[0]
            self.assertIn("COALESCE(game_system, '40k') = %s", sql_aos)
            self.assertIn("aos", params_aos)
            self.assertNotIn("40k", params_aos)

    def test_get_team_roster_query_isolation(self):
        """Ensure get_team_roster retrieves only members belonging to the specified game system."""
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        mock_cur.fetchall.return_value = []

        with patch.object(self.db, "get_connection") as mock_get_conn:
            mock_get_conn.return_value.__enter__.return_value = mock_conn

            PostgresDatabase._team_roster_cache_dict = {}

            # Query 40k roster
            res_40k = self.db.get_team_roster("Art of War", game_system="40k")
            sql_40k, params_40k = mock_cur.execute.call_args[0]
            self.assertIn("COALESCE(game_system, '40k') = %s", sql_40k)
            self.assertEqual(params_40k[1], "40k")
            self.assertEqual(res_40k["game_system"], "40k")

            # Query AoS roster
            res_aos = self.db.get_team_roster("Art of War", game_system="aos")
            sql_aos, params_aos = mock_cur.execute.call_args[0]
            self.assertIn("COALESCE(game_system, '40k') = %s", sql_aos)
            self.assertEqual(params_aos[1], "aos")
            self.assertEqual(res_aos["game_system"], "aos")


class TestCommunityHubDataIsolation(unittest.TestCase):
    """Verifies that Regional Community Hub events, competitors, standings, and cache are isolated."""

    def setUp(self):
        self.db = PostgresDatabase.__new__(PostgresDatabase)

    def test_community_overview_cache_key_isolation(self):
        """Ensure cache keys for community overview are strictly tagged by target_sys."""
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        mock_cur.fetchall.return_value = []
        mock_cur.fetchone.return_value = None

        with patch.object(self.db, "get_connection") as mock_get_conn, \
             patch.object(self.db, "reverse_geocode_coordinates", return_value={"formatted": "San Diego, CA"}):
            mock_get_conn.return_value.__enter__.return_value = mock_conn

            PostgresDatabase._community_overview_cache_dict = {}

            # Execute for 40k
            self.db.get_community_overview(lat=32.7157, lng=-117.1611, radius_miles=50, game_system="40k")
            executed_sqls_40k = [c[0][0] for c in mock_cur.execute.call_args_list]
            self.assertTrue(any("COALESCE(e.game_system, '40k') = %s" in sql for sql in executed_sqls_40k))

            # Check cache keys in _community_overview_cache_dict
            cache_keys = list(PostgresDatabase._community_overview_cache_dict.keys())
            self.assertTrue(any(k[-1] == "40k" for k in cache_keys))
            self.assertFalse(any(k[-1] == "aos" for k in cache_keys))

            # Execute for AoS
            mock_cur.execute.reset_mock()
            self.db.get_community_overview(lat=32.7157, lng=-117.1611, radius_miles=50, game_system="aos")
            executed_sqls_aos = [c[0][0] for c in mock_cur.execute.call_args_list]
            self.assertTrue(any("COALESCE(e.game_system, '40k') = %s" in sql for sql in executed_sqls_aos))

            cache_keys_after = list(PostgresDatabase._community_overview_cache_dict.keys())
            self.assertTrue(any(k[-1] == "aos" for k in cache_keys_after))

    def test_community_frontend_request_key(self):
        """Ensure web/js/community.js includes game_system prefix in requestKey."""
        with open(os.path.join(ROOT_DIR, "web", "js", "community.js"), "r", encoding="utf-8") as f:
            content = f.read()

        self.assertIn("const gs = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';", content)
        self.assertIn("const requestKey = `${gs}_${communityState.lat", content)


class TestMyHubDataIsolation(unittest.TestCase):
    """Verifies that My Hub (Competitor Hub) queries, rankings, history, and cache are strictly isolated."""

    def setUp(self):
        self.db = PostgresDatabase.__new__(PostgresDatabase)
        self.auth_mgr = AuthManager.__new__(AuthManager)
        self.auth_mgr.db = self.db

    def test_user_competitor_hub_query_isolation(self):
        """Ensure get_user_competitor_hub executes with COALESCE(game_system, '40k') = target_sys."""
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        mock_cur.fetchall.return_value = []
        mock_cur.fetchone.return_value = {
            "player_id": "p_tester",
            "player_name": "Test Commander",
            "current_elo": 1650.0,
            "peak_elo": 1700.0,
            "top_faction": "Space Marines",
            "team": "Legion",
            "matches_played": 10,
            "wins": 8,
            "losses": 2,
            "draws": 0,
            "win_rate": 80.0,
            "game_system": "40k"
        }

        with patch.object(self.db, "get_connection") as mock_get_conn, \
             patch.object(self.db, "get_tracker_history", return_value=[{"match_id": "tr_1"}]):
            mock_get_conn.return_value.__enter__.return_value = mock_conn

            # 1. 40k Competitor Hub
            res_40k = self.auth_mgr.get_user_competitor_hub(player_id="p_tester", game_system="40k")
            executed_sqls_40k = [call[0][0] for call in mock_cur.execute.call_args_list]

            # Verify ratings query
            self.assertTrue(any("COALESCE(game_system, '40k') = %s" in sql for sql in executed_sqls_40k))
            # Verify history trajectory query
            self.assertTrue(any("COALESCE(rh.game_system, '40k') = %s" in sql for sql in executed_sqls_40k))
            # Verify events attended query
            self.assertTrue(any("COALESCE(e.game_system, '40k') = %s" in sql for sql in executed_sqls_40k))
            # 40k tracker sessions queried
            self.db.get_tracker_history.assert_called()

            # 2. AoS Competitor Hub
            self.db.get_tracker_history.reset_mock()
            mock_cur.execute.reset_mock()
            mock_cur.fetchone.return_value = {
                "player_id": "p_tester",
                "player_name": "Test Commander",
                "current_elo": 1550.0,
                "peak_elo": 1550.0,
                "top_faction": "Stormcast Eternals",
                "team": "AoS Guild",
                "matches_played": 4,
                "wins": 3,
                "losses": 1,
                "draws": 0,
                "win_rate": 75.0,
                "game_system": "aos"
            }

            res_aos = self.auth_mgr.get_user_competitor_hub(player_id="p_tester", game_system="aos")
            executed_sqls_aos = [call[0][0] for call in mock_cur.execute.call_args_list]

            self.assertTrue(any("COALESCE(game_system, '40k') = %s" in sql for sql in executed_sqls_aos))
            self.assertTrue(any("COALESCE(rh.game_system, '40k') = %s" in sql for sql in executed_sqls_aos))
            # 11th Edition 40k tracker MUST NEVER be queried for AoS
            self.db.get_tracker_history.assert_not_called()
            self.assertEqual(res_aos["player"]["game_system"], "aos")

    def test_my_hub_frontend_caching_isolation(self):
        """Ensure web/js/my_hub.js partitions storage keys and provides resetMyHubState."""
        with open(os.path.join(ROOT_DIR, "web", "js", "my_hub.js"), "r", encoding="utf-8") as f:
            content = f.read()

        self.assertIn("const cacheStorageKey = `my_hub_cache_${gs}`;", content)
        self.assertIn("window.resetMyHubState = function()", content)


class TestArmyListsDataIsolation(unittest.TestCase):
    """Verifies that Army Lists are saved and retrieved per game system."""

    def setUp(self):
        self.db = PostgresDatabase.__new__(PostgresDatabase)

    def test_get_user_army_lists_query_isolation(self):
        """Ensure get_user_army_lists uses COALESCE(game_system, '40k') = %s."""
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        mock_cur.fetchall.return_value = []

        with patch.object(self.db, "get_connection") as mock_get_conn:
            mock_get_conn.return_value.__enter__.return_value = mock_conn

            # 40k lists
            self.db.get_user_army_lists(user_id="user_123", game_system="40k")
            sql_40k, params_40k = mock_cur.execute.call_args[0]
            self.assertIn("COALESCE(game_system, '40k') = %s", sql_40k)
            self.assertEqual(params_40k[1], "40k")

            # AoS lists
            self.db.get_user_army_lists(user_id="user_123", game_system="aos")
            sql_aos, params_aos = mock_cur.execute.call_args[0]
            self.assertIn("COALESCE(game_system, '40k') = %s", sql_aos)
            self.assertEqual(params_aos[1], "aos")


class TestFrontendSwitchingAndCacheReset(unittest.TestCase):
    """Verifies that switchGameSystem flushes all caches, resets pagination, and reloads views."""

    def test_switch_game_system_implementation(self):
        """Inspect web/js/app.js to confirm complete reset routines on system switch."""
        with open(os.path.join(ROOT_DIR, "web", "js", "app.js"), "r", encoding="utf-8") as f:
            content = f.read()

        # Caches cleared
        self.assertIn("window.resetFactionState()", content)
        self.assertIn("window.resetMyHubState()", content)
        self.assertIn("communityState.overview = null", content)
        self.assertIn("communityState.overviewKey = null", content)

        # Pagination reset
        self.assertIn("leaderboardPagination.page = 1", content)
        self.assertIn("leaderboardTeamsPagination.page = 1", content)
        self.assertIn("playersPagination.page = 1", content)
        self.assertIn("teamsPagination.page = 1", content)

        # Directory data flushed
        self.assertIn("playersDirectoryData = []", content)
        self.assertIn("teamsDirectoryData = []", content)

        # View reloads
        self.assertIn("loadLeaderboard()", content)
        self.assertIn("loadLeaderboardTeams()", content)
        self.assertIn("loadMyHubDashboard()", content)
        self.assertIn("loadCommunityHub(null, null, null, null, true)", content)
        self.assertIn("loadPlayersDirectory()", content)
        self.assertIn("loadTeamsDirectory()", content)

        # Match Predictor reset on game system switch
        self.assertIn("window.resetPredictorState()", content)

        # Browser back / forward navigation popstate listener
        self.assertIn("window.addEventListener('popstate'", content)

    def test_my_hub_resets_saved_lists(self):
        """Ensure resetMyHubState clears hubSavedLists to prevent cross-game list display."""
        with open(os.path.join(ROOT_DIR, "web", "js", "my_hub.js"), "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("hubSavedLists = [];", content)

    def test_database_lfg_query_isolation(self):
        """Ensure search_nearby_lfg_players uses COALESCE(pr.game_system, '40k') = %s."""
        with open(os.path.join(ROOT_DIR, "database.py"), "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("AND COALESCE(pr.game_system, '40k') = %s", content)
        self.assertIn("AND (%s = ANY(COALESCE(p.game_systems, ARRAY['40k'])) OR COALESCE(p.game_system, '40k') = %s)", content)


if __name__ == "__main__":
    unittest.main()
