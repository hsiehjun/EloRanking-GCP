"""
Unit & Integration Test Suite for OmniTactica 8 QoL Enhancements
"""
import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path

from database import PostgresDatabase


class TestQoLSuitePhase2(unittest.TestCase):
    def test_item1_chat_linking_security(self):
        """Item 1: Verification Security & Chat Linking - No name-based fallback."""
        db = PostgresDatabase.__new__(PostgresDatabase)

        mock_cursor = MagicMock()
        mock_conn = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.__enter__.return_value = mock_conn

        with patch.object(db, 'get_connection', return_value=mock_conn):
            mock_cursor.fetchone.return_value = None

            res = db.get_user_for_player("unlinked_p123", player_name="Joe Bravo")
            self.assertIsNone(res, "Unverified user should NOT be matched by name fallback!")

            executed_sql = mock_cursor.execute.call_args[0][0]
            self.assertNotIn("LOWER(display_name)", executed_sql)
            self.assertIn("bcp_user_id = %s", executed_sql)

        auth_js = Path("web/js/auth.js").read_text(encoding="utf-8")
        self.assertIn("Your BCP: ⚪ Not Linked", auth_js)

    def test_item2_mobile_tracker_bottom_dock(self):
        """Item 2: Mobile Game Tracker Bottom Action Dock."""
        tracker_css = Path("web/tracker/tracker_sync.css").read_text(encoding="utf-8")
        tracker_js = Path("web/tracker/tracker_sync.js").read_text(encoding="utf-8")

        self.assertIn("#gt-mobile-bottom-dock", tracker_css)
        self.assertIn("env(safe-area-inset-bottom", tracker_css)
        self.assertIn("height: 44px", tracker_css)
        self.assertIn("gt-mobile-bottom-dock", tracker_js)
        self.assertIn("gt-dock-finish", tracker_js)
        self.assertIn("gt-dock-dice", tracker_js)
        self.assertIn("gt-dock-judge", tracker_js)
        self.assertIn("gt-dock-clock", tracker_js)

    def test_item3_community_ongoing_tournaments(self):
        """Item 3: Community Hub Ongoing Tournaments - Round X Live & CTA."""
        comm_js = Path("web/js/community.js").read_text(encoding="utf-8")

        self.assertIn("function isTournamentOngoing(", comm_js)
        self.assertIn("Round ${currentRound} Live", comm_js)
        self.assertIn("⚔️ Live Pairings & Standings", comm_js)

    def test_item4_scorecard_mobile_breakdown(self):
        """Item 4: Scorecard Mobile Clean-Up."""
        sc_html = Path("web/scorecard.html").read_text(encoding="utf-8")

        self.assertIn("sc-mobile-rounds-container", sc_html)
        self.assertIn("toggleMobileRoundDrawer", sc_html)
        self.assertIn("escapeHtml", sc_html)
        self.assertIn("max-width: 640px", sc_html)

    def test_item5_my_hub_navigation_reset(self):
        """Item 5: My Hub Navigation Reset."""
        hub_js = Path("web/js/my_hub.js").read_text(encoding="utf-8")
        app_js = Path("web/js/app.js").read_text(encoding="utf-8")

        self.assertIn("function resetMyHubToProfile()", hub_js)
        self.assertIn("window.resetMyHubToProfile = resetMyHubToProfile", hub_js)
        self.assertIn("resetMyHubToProfile()", app_js)

    def test_item6_settings_factions_and_dynamic_switch(self):
        """Item 6: Emperor's Children & Dynamic 40k/AoS Switch."""
        app_html = Path("web/app.html").read_text(encoding="utf-8")
        auth_js = Path("web/js/auth.js").read_text(encoding="utf-8")

        self.assertIn("<option value=\"Emperor's Children\">Emperor's Children</option>", app_html)
        self.assertIn("<optgroup label=\"Chaos\">", app_html)

        self.assertIn("Emperor's Children", auth_js)
        self.assertIn("Stormcast Eternals", auth_js)
        self.assertIn("Daughters of Khaine", auth_js)
        self.assertIn("Orruk Warclans", auth_js)
        self.assertIn("Sons of Behemat", auth_js)
        self.assertIn("populateSettingsFactionDropdown", auth_js)

        db_factions = PostgresDatabase.DEFAULT_AOS_STATS["factions"]
        self.assertEqual(len(db_factions), 24)
        self.assertIn("Daughters of Khaine", db_factions)
        self.assertIn("Orruk Warclans", db_factions)
        self.assertIn("Sons of Behemat", db_factions)

    def test_item7_faction_meta_isolation_and_caching(self):
        """Item 7: Faction Meta Isolation, 1-Year Capping & Caching."""
        db_code = Path("database.py").read_text(encoding="utf-8")
        lead_router = Path("routers/leaderboard.py").read_text(encoding="utf-8")
        modals_js = Path("web/js/modals.js").read_text(encoding="utf-8")
        app_html = Path("web/app.html").read_text(encoding="utf-8")

        self.assertIn("COALESCE(game_system, '40k') = %s", db_code)
        self.assertIn("_faction_details_cache_dict", db_code)

        self.assertIn("timeframe: Optional[str] = \"1yr\"", db_code)
        self.assertIn("matches.match_date >= (CURRENT_DATE - INTERVAL '12 months')", db_code)
        self.assertIn("matches.match_date >= (CURRENT_DATE - INTERVAL '6 months')", db_code)

        self.assertIn("timeframe: Optional[str] = Query(\"1yr\")", lead_router)

        self.assertIn("changeFactionModalTimeframe", modals_js)
        self.assertIn("faction-tf-6mo", app_html)
        self.assertIn("faction-tf-1yr", app_html)
        self.assertIn("faction-tf-all", app_html)

    def test_item8_event_modal_pairings_default(self):
        """Item 8: Event Modal Pairings Default."""
        tourn_js = Path("web/js/tournaments.js").read_text(encoding="utf-8")

        self.assertIn("guessedOngoing = isTournamentOngoing(currentEventData)", tourn_js)
        self.assertIn("if (guessedOngoing) immediateTab = 'matches'", tourn_js)
        self.assertIn("} else if (isOngoing && eventMatchesCache.length > 0) {", tourn_js)
        self.assertIn("switchEventModalTab('matches');", tourn_js)


if __name__ == '__main__':
    unittest.main()
