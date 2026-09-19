"""
Unit and regression test suite verifying tournament round resolution integrity,
ensuring premier Super Majors and GTs (e.g. LVO 2026, Nova, etc.) never display stale
or default 3-round placeholders when 8-10 rounds are configured on BCP or in descriptions.
"""
import unittest
from unittest.mock import MagicMock, patch
import json
from pathlib import Path
import sys

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

import database
database.PSYCOPG2_AVAILABLE = True
database.psycopg2 = MagicMock()
database.extras = MagicMock()


class TestTournamentRoundsResolution(unittest.TestCase):
    @patch("database.PostgresDatabase._ensure_pool")
    def test_database_get_event_details_rounds_resolution(self, mock_pool):
        """Verify get_event_details resolves numberOfRounds from raw_json when DB num_rounds is 3."""
        db = database.PostgresDatabase()
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.__enter__.return_value = mock_conn

        mock_cursor.fetchone.return_value = {
            "id": "7ohG0RuDqC1k",
            "name": "LVO 2026 - Warhammer 40k Championships - Las Vegas Open",
            "event_date": "2026-10-02",
            "end_date": "2026-10-05",
            "num_rounds": 3,
            "total_players": 432,
            "raw_json": json.dumps({"numberOfRounds": 10, "totalPlayers": 432, "name": "LVO 2026"})
        }
        mock_cursor.fetchall.side_effect = [[], [], []]

        with patch.object(db, "get_connection", return_value=mock_conn):
            res = db.get_event_details("7ohG0RuDqC1k")
            self.assertEqual(res["num_rounds"], 10)

    @patch("database.PostgresDatabase._ensure_pool")
    def test_database_super_major_description_fallback(self, mock_pool):
        """Verify get_event_details parses 10 rounds from LVO description when DB has 3."""
        db = database.PostgresDatabase()
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.__enter__.return_value = mock_conn

        mock_cursor.fetchone.return_value = {
            "id": "7ohG0RuDqC1k",
            "name": "LVO 2026 - Warhammer 40k Championships - Las Vegas Open",
            "event_date": "2026-10-02",
            "end_date": "2026-10-05",
            "num_rounds": 3,
            "total_players": 432,
            "raw_json": json.dumps({
                "numberOfRounds": 3,
                "totalPlayers": 432,
                "eventDescriptionMarkup": "Friday: Rounds 1 through 3. Saturday: Rounds 4 through 6, followed by Round 7. Sunday: Top 8 Finals only, Rounds 8, 9, and 10"
            })
        }
        mock_cursor.fetchall.side_effect = [[], [], []]

        with patch.object(db, "get_connection", return_value=mock_conn):
            res = db.get_event_details("7ohG0RuDqC1k")
            self.assertEqual(res["num_rounds"], 10)

    def test_tournaments_js_contains_get_event_resolved_rounds(self):
        """Verify web/js/tournaments.js defines getEventResolvedRounds and guards against 3-round placeholders."""
        t_file = root_dir / "web" / "js" / "tournaments.js"
        content = t_file.read_text(encoding="utf-8")
        self.assertIn("function getEventResolvedRounds", content)
        self.assertIn("isSuperMajor", content)
        self.assertIn("las vegas open", content)

    def test_community_js_uses_resolved_rounds(self):
        """Verify web/js/community.js references resolved rounds in cards."""
        c_file = root_dir / "web" / "js" / "community.js"
        content = c_file.read_text(encoding="utf-8")
        self.assertIn("getEventResolvedRounds", content)


if __name__ == "__main__":
    unittest.main()
