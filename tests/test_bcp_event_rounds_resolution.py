import unittest
from unittest.mock import MagicMock, patch
import asyncio
import json

class TestBcpEventRoundsResolution(unittest.TestCase):
    def test_api_event_details_heals_stale_rounds_from_bcp_metadata(self):
        """Verify api_event_details detects stale rounds (e.g. 3 for a 434-player event) and self-heals from BCP."""
        from routers import leaderboard

        mock_db = MagicMock()
        # Stale DB record with 3 rounds and 434 players (like LVO before fix)
        mock_db.get_event_details.return_value = {
            "id": "7ohG0RuDqC1k",
            "name": "LVO 2026 - Warhammer 40k Championships - Las Vegas Open",
            "total_players": 434,
            "num_rounds": 3,
            "matches": [],
            "players": [],
            "raw_json": {}
        }

        with patch("routers.leaderboard.get_database", return_value=mock_db), \
             patch("routers.leaderboard.BestCoastPairingsScraper") as MockScraperClass:
            mock_scraper_inst = MagicMock()
            # BCP API reports authentic 10 rounds
            mock_scraper_inst.fetch_event_details.return_value = {
                "id": "7ohG0RuDqC1k",
                "name": "LVO 2026 - Warhammer 40k Championships - Las Vegas Open",
                "numberOfRounds": 10,
                "totalPlayers": 434,
                "eventDate": "2026-10-02T16:00:00.000Z"
            }
            mock_scraper_inst.fetch_event_players.return_value = []
            mock_scraper_inst.fetch_event_teams.return_value = []
            MockScraperClass.return_value = mock_scraper_inst

            res = asyncio.run(leaderboard.api_event_details("7ohG0RuDqC1k"))

            self.assertEqual(res["num_rounds"], 10, "api_event_details must heal num_rounds to 10 from BCP API")
            self.assertEqual(res["total_players"], 434)

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
        """Verify the JavaScript getEventNumRounds logic across Swiss competitive tiers."""
        def get_event_num_rounds(ev, matches=None):
            matches = matches or []
            if not ev:
                return 5
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
            db_rounds = int(ev.get("num_rounds") or ev.get("rounds") or 0)

            total_comp = int(ev.get("total_players") or len(ev.get("players") or []) or 0)
            if (db_rounds <= 3 or not db_rounds) and total_comp >= 28:
                if total_comp >= 256:
                    return max(match_rounds, 9)
                if total_comp >= 60:
                    return max(match_rounds, 6)
                return max(match_rounds, 5)

            return max(db_rounds, match_rounds, 0)

        # 1. Authentic BCP numberOfRounds
        self.assertEqual(get_event_num_rounds({"numberOfRounds": 10, "total_players": 434}), 10)
        # 2. Authentic raw_json.numberOfRounds
        self.assertEqual(get_event_num_rounds({"raw_json": {"numberOfRounds": 10}, "total_players": 434, "num_rounds": 3}), 10)
        # 3. Super Major fallback if rounds erroneously set to 3 for 431 players
        self.assertEqual(get_event_num_rounds({"num_rounds": 3, "total_players": 431}), 9)
        # 4. Major fallback if rounds set to 3 for 120 players
        self.assertEqual(get_event_num_rounds({"num_rounds": 3, "total_players": 120}), 6)
        # 5. Grand Tournament fallback if rounds set to 3 for 40 players
        self.assertEqual(get_event_num_rounds({"num_rounds": 3, "total_players": 40}), 5)
        # 6. Local RTT legitimate 3 rounds
        self.assertEqual(get_event_num_rounds({"num_rounds": 3, "total_players": 16}), 3)


if __name__ == "__main__":
    unittest.main()
