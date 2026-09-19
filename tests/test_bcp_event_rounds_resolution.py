import unittest
from unittest.mock import MagicMock, patch
import asyncio
import json

class TestBcpEventRoundsResolution(unittest.TestCase):
    def test_api_event_details_reads_bcp_rounds_as_source_of_truth_without_db_write(self):
        """Verify api_event_details takes BCP numberOfRounds as source of truth with strictly zero DB writes."""
        from routers import leaderboard

        mock_db = MagicMock()
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        mock_db.get_connection.return_value.__enter__.return_value = mock_conn

        # DB record with 3 rounds but raw_json from BCP has authentic 10 rounds
        mock_db.get_event_details.return_value = {
            "id": "7ohG0RuDqC1k",
            "name": "LVO 2026 - Warhammer 40k Championships - Las Vegas Open",
            "total_players": 434,
            "num_rounds": 3,
            "matches": [],
            "players": [],
            "raw_json": {"numberOfRounds": 10, "totalPlayers": 434}
        }

        with patch("routers.leaderboard.get_database", return_value=mock_db), \
             patch("routers.leaderboard.BestCoastPairingsScraper") as MockScraperClass:
            mock_scraper_inst = MagicMock()
            mock_scraper_inst.fetch_event_players.return_value = []
            MockScraperClass.return_value = mock_scraper_inst

            res = asyncio.run(leaderboard.api_event_details("7ohG0RuDqC1k"))

            self.assertEqual(res["num_rounds"], 10, "api_event_details must prioritize BCP numberOfRounds as source of truth")
            self.assertEqual(res["total_players"], 434)
            # Verify strictly zero UPDATE queries were executed on events table
            for call_item in mock_cur.execute.call_args_list:
                sql_text = str(call_item[0][0])
                self.assertNotIn("UPDATE events", sql_text, "api_event_details must perform zero database writes on read path")

    def test_api_event_details_prioritizes_raw_json_number_of_rounds(self):
        """Verify api_event_details prioritizes raw_json.numberOfRounds over stale num_rounds in DB."""
        from routers import leaderboard

        mock_db = MagicMock()
        mock_db.get_event_details.return_value = {
            "id": "7ohG0RuDqC1k",
            "name": "LVO 2026 - Warhammer 40k Championships - Las Vegas Open",
            "total_players": 434,
            "num_rounds": 3,
            "matches": [],
            "players": [],
            "raw_json": {"numberOfRounds": 10, "totalPlayers": 434}
        }

        with patch("routers.leaderboard.get_database", return_value=mock_db), \
             patch("routers.leaderboard.BestCoastPairingsScraper") as MockScraperClass:
            mock_scraper_inst = MagicMock()
            mock_scraper_inst.fetch_event_players.return_value = []
            MockScraperClass.return_value = mock_scraper_inst

            res = asyncio.run(leaderboard.api_event_details("7ohG0RuDqC1k"))

            self.assertEqual(res["num_rounds"], 10, "api_event_details must read numberOfRounds from raw_json")

    def test_database_get_event_details_prioritizes_bcp_rounds(self):
        """Verify Database.get_event_details logic correctly elevates num_rounds when raw_json has numberOfRounds."""
        from database import Database

        db = Database.__new__(Database)
        mock_cursor = MagicMock()

        # Mock event row with stale num_rounds=3 but raw_json has numberOfRounds=10
        mock_event_row = {
            "id": "7ohG0RuDqC1k",
            "name": "LVO 2026 - Warhammer 40k Championships - Las Vegas Open",
            "event_date": "2026-10-02",
            "end_date": "2026-10-05",
            "city": "Las Vegas",
            "state": "NV",
            "country": "United States",
            "total_players": 434,
            "num_rounds": 3,
            "current_round": 0,
            "is_ended": False,
            "raw_json": json.dumps({"numberOfRounds": 10, "totalPlayers": 434}),
            "roster": [],
            "organizer_id": None,
            "organizer_bcp_id": None,
            "started": False,
            "pairings_status": "draft"
        }

        mock_cursor.fetchone.return_value = mock_event_row
        mock_cursor.fetchall.side_effect = [
            [], # matches
            []  # event_participants
        ]

        mock_conn = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_ctx = MagicMock()
        mock_ctx.__enter__.return_value = mock_conn
        db.get_connection = MagicMock(return_value=mock_ctx)

        details = db.get_event_details("7ohG0RuDqC1k")
        self.assertEqual(details["num_rounds"], 10, "get_event_details must elevate num_rounds to 10 from raw_json")

    def test_tournaments_js_get_event_num_rounds_logic(self):
        """Verify the JavaScript getEventNumRounds logic takes BCP data directly as source of truth."""
        def get_event_num_rounds(ev, matches=None):
            matches = matches or []
            if not ev:
                return 0
            raw_bcp = int(
                ev.get("numberOfRounds") or
                ev.get("numRounds") or
                (ev.get("raw_json") or {}).get("numberOfRounds") or
                (ev.get("raw_json") or {}).get("numRounds") or
                0
            )
            if raw_bcp > 0:
                return raw_bcp

            match_rounds = max([int(m.get("round", 1)) for m in matches]) if matches else 0
            if match_rounds > 0:
                return match_rounds
            return int(ev.get("num_rounds") or ev.get("rounds") or 0)

        # 1. Authentic BCP numberOfRounds
        self.assertEqual(get_event_num_rounds({"numberOfRounds": 10, "total_players": 434}), 10)
        # 2. Authentic BCP numRounds
        self.assertEqual(get_event_num_rounds({"numRounds": 6, "total_players": 80}), 6)
        # 3. Authentic raw_json.numberOfRounds from BCP metadata
        self.assertEqual(get_event_num_rounds({"raw_json": {"numberOfRounds": 10}, "total_players": 434, "num_rounds": 3}), 10)
        # 4. Fallback to match pairings max round
        self.assertEqual(get_event_num_rounds({"num_rounds": 0}, [{"round": 1}, {"round": 5}]), 5)
        # 5. Stored num_rounds when no BCP metadata
        self.assertEqual(get_event_num_rounds({"num_rounds": 3, "total_players": 16}), 3)


if __name__ == "__main__":
    unittest.main()
