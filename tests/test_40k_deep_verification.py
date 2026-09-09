import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import unittest
import asyncio
from unittest.mock import MagicMock, patch
import json
from datetime import datetime, timezone

from config import DEFAULT_GAME_SYSTEM_ID, AOS_GAME_SYSTEM_ID, INITIAL_ELO, DEFAULT_K_FACTOR
from database import Database, PostgresDatabase
from scraper import BestCoastPairingsScraper
from elo import EloEngine
from army_list_parser import ArmyListParser
from services.places_service import PlacesService
from routers.leaderboard import api_stats, api_leaderboard, api_faction_meta


class Test40kDeepBackendVerification(unittest.TestCase):
    """Deep tests for 40k scraper, API routes, parsing, and rating engine."""

    def setUp(self):
        self.mock_db = MagicMock(spec=PostgresDatabase)
        self.mock_db.game_system = "40k"
        self.mock_db.pool = MagicMock()
        self.scraper = BestCoastPairingsScraper(db=self.mock_db, request_delay=0)
        self.elo_engine = EloEngine(db=self.mock_db, initial_elo=INITIAL_ELO, default_k=DEFAULT_K_FACTOR)

    def test_scraper_fetch_events_40k_default(self):
        """Verify scraper fetch_events uses 40k game system by default."""
        mock_response = {
            "data": [
                {
                    "id": "ev_40k_tacoma",
                    "name": "US Open Tacoma GT 2026",
                    "eventDate": "2026-07-18T09:00:00.000Z",
                    "endDate": "2026-07-20T18:00:00.000Z",
                    "gameSystemId": DEFAULT_GAME_SYSTEM_ID,
                    "totalPlayers": 128,
                    "numRounds": 5,
                    "city": "Tacoma",
                    "state": "WA",
                    "country": "USA"
                }
            ],
            "nextKey": None
        }

        with patch.object(self.scraper, "_make_request", return_value=mock_response) as mock_req:
            events = list(self.scraper.fetch_events(start_date="2026-07-01", end_date="2026-07-31"))
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["id"], "ev_40k_tacoma")
            self.assertEqual(events[0]["name"], "US Open Tacoma GT 2026")
            
            mock_req.assert_called_once()
            called_params = mock_req.call_args[1]["params"]
            self.assertEqual(called_params["gameSystemId"], DEFAULT_GAME_SYSTEM_ID)
            self.assertEqual(called_params["gameSystemId"], "WGMSzfKFYA")

    def test_scraper_parse_and_store_match_40k(self):
        """Verify scraper parses match pairing and calls upsert_match with game_system=40k."""
        event_data = {
            "id": "ev_40k_001",
            "name": "SoCal Open 40k GT",
            "eventDate": "2026-06-15T09:00:00.000Z",
            "gameSystemId": DEFAULT_GAME_SYSTEM_ID,
            "game_system": "40k"
        }
        pairing = {
            "id": "pair_001",
            "round": 2,
            "tableNumber": 3,
            "player1": {"id": "p_alice", "user": {"id": "p_alice", "firstName": "Alice", "lastName": "Smith"}, "faction": "Space Marines"},
            "player1Game": {"points": 90, "result": 2},
            "player2": {"id": "p_bob", "user": {"id": "p_bob", "firstName": "Bob", "lastName": "Jones"}, "faction": "Necrons"},
            "player2Game": {"points": 65, "result": 0},
            "winnerId": "p_alice",
            "gameSystemId": DEFAULT_GAME_SYSTEM_ID,
            "isDone": True
        }

        match = self.scraper.parse_and_store_match(event_data, pairing)
        self.assertIsNotNone(match)
        self.assertEqual(match["event_id"], "ev_40k_001")
        self.assertEqual(match["player1_id"], "p_alice")
        self.assertEqual(match["player2_id"], "p_bob")
        self.assertEqual(match["player1_score"], 90)
        self.assertEqual(match["player2_score"], 65)
        self.assertEqual(match["winner_id"], "p_alice")
        
        self.mock_db.upsert_match.assert_called_once()
        saved_match = self.mock_db.upsert_match.call_args[0][0]
        self.assertEqual(saved_match.get("game_system"), "40k")

    def test_elo_reconstruct_40k_isolation(self):
        """Verify reconstruct_incremental for 40k only processes 40k matches and isolates ratings."""
        self.mock_db.get_unranked_matches.return_value = []

        result = self.elo_engine.reconstruct_incremental(batch_limit=1000, game_system="40k")
        self.mock_db.get_unranked_matches.assert_called_once_with(limit=1000, game_system="40k")
        self.assertEqual(result["total_new_matches"], 0)
        self.assertEqual(result["game_system"], "40k")
        self.assertEqual(result["status"], "UP_TO_DATE")

    def test_40k_army_list_parser(self):
        """Verify 40k army list parser accurately parses detachments, points, and units."""
        raw_40k_text = """
        +++++++++++++++++++++++++++++++++++++++++++++++
        + FACTION KEYWORD: Imperium - Adeptus Astartes - Ultramarines
        + DETACHMENT: Gladius Task Force
        + TOTAL ARMY POINTS: 2000pts
        + WARLORD: Captain in Terminator Armour
        +++++++++++++++++++++++++++++++++++++++++++++++
        CHARACTER
        Captain in Terminator Armour (95 pts)
          • 1x Relic Weapon
          • 1x Storm Bolter
          • Enhancement: The Honour Vehement (+15 pts)
        
        BATTLELINE
        Intercessor Squad (80 pts)
          • 1x Intercessor Sergeant: Bolt Rifle, Close combat weapon
          • 4x Intercessor: 4x Bolt Pistol, 4x Bolt Rifle, 4x Close combat weapon
        
        OTHER DATASHEETS
        Redemptor Dreadnought (210 pts)
          • 1x Heavy Onslaught Gatling Cannon
          • 1x Heavy Flamer
        """
        parser = ArmyListParser()
        parsed = parser.parse(raw_40k_text)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.get("detachment"), "Gladius Task Force")
        self.assertTrue(len(parsed.get("units", [])) >= 3)
        unit_names = [u.get("name") for u in parsed.get("units", [])]
        self.assertTrue(any("Captain" in name for name in unit_names))
        self.assertTrue(any("Intercessor" in name for name in unit_names))
        self.assertTrue(any("Redemptor" in name for name in unit_names))

    def test_places_service_game_store_filtering(self):
        """Verify PlacesService heuristics validate legitimate 40k hobby stores."""
        svc = PlacesService()
        self.assertTrue(svc.is_valid_game_store_name("The Dice Dojo"))
        self.assertTrue(svc.is_valid_game_store_name("Pair A Dice Games"))
        self.assertTrue(svc.is_valid_game_store_name("Warhammer - San Diego"))
        self.assertFalse(svc.is_valid_game_store_name("GameStop #1402"))
        self.assertFalse(svc.is_valid_game_store_name("Target Electronics"))

    def test_api_stats_default_40k(self):
        """Verify /api/stats defaults to 40k and delegates with game_system=40k."""
        with patch("routers.leaderboard.get_database") as mock_get_db:
            mock_db_instance = MagicMock()
            mock_get_db.return_value = mock_db_instance
            mock_db_instance.get_summary_stats.return_value = {"total_players": 77322, "total_matches": 312000, "game_system": "40k"}
            
            res = asyncio.run(api_stats())
            mock_db_instance.get_summary_stats.assert_called_once_with(game_system="40k")
            self.assertEqual(res["game_system"], "40k")
            self.assertEqual(res["total_players"], 77322)

    def test_api_leaderboard_default_40k(self):
        """Verify /api/leaderboard defaults to 40k and passes game_system=40k."""
        with patch("routers.leaderboard.get_database") as mock_get_db:
            mock_db_instance = MagicMock()
            mock_get_db.return_value = mock_db_instance
            mock_db_instance.get_top_ranked_players.return_value = {"players": [{"player_id": "p1", "name": "Folger Pyles"}], "total_count": 1}
            
            res = asyncio.run(api_leaderboard())
            mock_db_instance.get_top_ranked_players.assert_called_once()
            called_kwargs = mock_db_instance.get_top_ranked_players.call_args[1]
            self.assertEqual(called_kwargs["game_system"], "40k")
            self.assertEqual(res["total_count"], 1)

    def test_api_faction_meta_default_40k(self):
        """Verify /api/factions/meta defaults to 40k and passes game_system=40k."""
        with patch("routers.leaderboard.get_database") as mock_get_db:
            mock_db_instance = MagicMock()
            mock_get_db.return_value = mock_db_instance
            mock_db_instance.get_faction_meta_stats.return_value = [{"faction": "Adeptus Custodes", "win_rate": 56.4}]
            
            res = asyncio.run(api_faction_meta())
            mock_db_instance.get_faction_meta_stats.assert_called_once()
            called_kwargs = mock_db_instance.get_faction_meta_stats.call_args[1]
            self.assertEqual(called_kwargs["game_system"], "40k")
            self.assertEqual(res[0]["faction"], "Adeptus Custodes")

if __name__ == "__main__":
    unittest.main()
