import json
import unittest
from unittest.mock import MagicMock, patch

from database import PostgresDatabase


class TestJourneyPlacings(unittest.TestCase):
    def setUp(self):
        PostgresDatabase._player_tournaments_cache_dict.clear()
        PostgresDatabase._bcp_event_placings_cache_dict.clear()

    def test_sql_deduplicates_reg_id_and_computes_ptv_sos_tiebreakers(self):
        db = PostgresDatabase.__new__(PostgresDatabase)
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.__enter__.return_value = mock_conn
        mock_cursor.__enter__.return_value = mock_cursor
        db.get_connection = MagicMock(return_value=mock_conn)
        mock_conn.cursor.return_value = mock_cursor

        mock_cursor.fetchall.return_value = [
            {
                "event_id": "FKsBtHi4ZqHx",
                "event_name": "Bay Area Open 2026 - Warhammer 40k Champs",
                "event_date": "2026-05-24",
                "city": "Burlingame",
                "state": "CA",
                "country": "US",
                "total_players": 161,
                "num_rounds": 6,
                "registered_faction": "Aeldari",
                "placement": 9,
                "matches_played": 6,
                "wins": 5,
                "losses": 1,
                "draws": 0,
                "total_battle_points": 502,
                "_player_norm_name": "john hsieh",
            }
        ]

        with patch.object(db, "_enrich_tournaments_with_bcp_placings") as mock_enrich:
            res = db.get_player_tournaments("MEV83VFANA", game_system="40k")

        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]["event_id"], "FKsBtHi4ZqHx")
        self.assertEqual(res[0]["placement"], 9)
        self.assertEqual(res[0]["total_players"], 161)
        self.assertNotIn("_player_norm_name", res[0])
        mock_enrich.assert_called_once_with(res, "MEV83VFANA", "john hsieh")

        executed_sql = mock_cursor.execute.call_args[0][0]
        # Verify name-based deduplication of event_participants against match players
        self.assertIn("matched_ep AS", executed_sql)
        self.assertIn("unmatched_ep AS", executed_sql)
        self.assertIn("rep.norm_name = amp.norm_name", executed_sql)
        # Verify Path to Victory (ptv) and Opponent Game Win % (sos) tiebreakers
        self.assertIn("AS ptv", executed_sql)
        self.assertIn("match_player_sos AS", executed_sql)
        self.assertIn("placingMetrics", executed_sql)
        # Verify raw_json->>'totalPlayers' is prioritized over unmerged participant counts
        self.assertIn("e.raw_json->>'totalPlayers'", executed_sql)

    def test_enrich_tournaments_with_bcp_placings_by_id_and_name(self):
        db = PostgresDatabase.__new__(PostgresDatabase)
        tournaments = [
            {
                "event_id": "FKsBtHi4ZqHx",
                "event_name": "Bay Area Open 2026 - Warhammer 40k Champs",
                "placement": 16,
                "total_players": 161,
                "matches_played": 6,
            },
            {
                "event_id": "101RFqV6OOZa",
                "event_name": "Warhammer 40,000 GT - Warhammer Open Palm Springs",
                "placement": 32,
                "total_players": 177,
                "matches_played": 8,
            },
        ]

        fake_bcp_responses = {
            "FKsBtHi4ZqHx": {
                "active": [
                    {
                        "id": "I0bEyaRAKeHu",
                        "userId": "MEV83VFANA",
                        "user": {"id": "MEV83VFANA", "firstName": "John", "lastName": "Hsieh"},
                        "placing": 9,
                        "overallPlacing": 36,
                    }
                ]
            },
            "101RFqV6OOZa": {
                "active": [
                    {
                        "id": "regOnlyId999",
                        "user": {"firstName": "John", "lastName": "Hsieh"},
                        "placing": 38,
                        "overallPlacing": 52,
                    }
                ]
            },
        }

        def fake_urlopen(req, timeout=3.5):
            url = req.full_url if hasattr(req, "full_url") else str(req)
            for eid, payload in fake_bcp_responses.items():
                if eid in url:
                    m = MagicMock()
                    m.__enter__.return_value = m
                    m.read.return_value = json.dumps(payload).encode("utf-8")
                    return m
            raise RuntimeError(f"Unexpected URL: {url}")

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            db._enrich_tournaments_with_bcp_placings(tournaments, "MEV83VFANA", "john hsieh")

        self.assertEqual(tournaments[0]["placement"], 9)
        self.assertEqual(tournaments[1]["placement"], 38)


if __name__ == "__main__":
    unittest.main()
