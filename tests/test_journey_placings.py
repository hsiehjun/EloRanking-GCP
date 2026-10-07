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
        executed_params = mock_cursor.execute.call_args[0][1]
        # Verify psycopg2 % string formatting succeeds without raising TypeError from unescaped %
        interpolated_sql = executed_sql % executed_params
        self.assertIn("'Oppt. Game Win %'", interpolated_sql)
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

        # Also verify get_multiple_players_tournaments SQL escapes % properly for psycopg2
        mock_cursor.reset_mock()
        mock_cursor.fetchall.return_value = []
        db.get_multiple_players_tournaments(["UNCACHED_PID_2"], game_system="40k")
        multi_sql = mock_cursor.execute.call_args[0][0]
        multi_params = mock_cursor.execute.call_args[0][1]
        interpolated_multi_sql = multi_sql % multi_params
        self.assertIn("'Oppt. Game Win %'", interpolated_multi_sql)



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

    def test_get_faction_details_3mo_timeframe(self):
        PostgresDatabase._faction_details_cache_dict.clear()
        db = PostgresDatabase.__new__(PostgresDatabase)
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.__enter__.return_value = mock_conn
        mock_cursor.__enter__.return_value = mock_cursor
        db.get_connection = MagicMock(return_value=mock_conn)
        mock_conn.cursor.return_value = mock_cursor

        with patch.object(db, "_query_faction_top_players", return_value=[]) as mock_tp, \
             patch.object(db, "_query_faction_recent_matches", return_value=[]) as mock_rm, \
             patch.object(db, "_query_faction_matchups", return_value=[
                 {"opponent_faction": "Genestealer Cults", "total_matches": 24, "wins": 14, "losses": 9, "draws": 1, "win_rate": 58.3}
             ]) as mock_mu:
            res = db.get_faction_details("Chaos Space Marines", limit=25, game_system="40k", timeframe="3mo")

        self.assertEqual(res["timeframe"], "3mo")
        self.assertEqual(res["stats"]["total_matches"], 24)
        self.assertEqual(res["stats"]["total_wins"], 14)
        self.assertEqual(res["stats"]["win_rate"], 58.3)
        self.assertEqual(len(res["matchups"]), 1)
        # Verify 92-day date clause and parameter were passed
        _, kwargs = mock_mu.call_args
        self.assertEqual(len(kwargs["date_params"]), 1)
        self.assertIn("matches.match_date >= %s", mock_mu.call_args[0][3])

    def test_caster_desk_removed_roster_section_and_added_3mo_matchup(self):
        with open("web/js/tournaments.js", "r", encoding="utf-8") as f:
            js_code = f.read()

        # Verify "📋 Submitted Army Roster & Key Units" is completely removed
        self.assertNotIn("Submitted Army Roster & Key Units", js_code)
        self.assertNotIn("caster-dossier-roster-box-", js_code)

        # Verify Global Faction Matchup (Past 3 Months) is placed right underneath Past Head-to-Head Encounters
        self.assertIn("buildCasterFaction3MoMatchupCardHtml", js_code)
        h2h_idx = js_code.index('id="caster-past-h2h-container"')
        fac_3mo_idx = js_code.index('id="caster-faction-3mo-container"')
        dossiers_idx = js_code.index("Commander Dossiers: Faction Mastery, Army Rosters & Match History")
        self.assertLess(h2h_idx, fac_3mo_idx)
        self.assertLess(fac_3mo_idx, dossiers_idx)

    def test_stream_modal_renders_inline_scorecard_without_button(self):
        with open("web/js/tournaments.js", "r", encoding="utf-8") as f:
            js_code = f.read()

        # Verify buildInlineStreamScorecardHtml exists and is used in updateEventStreamModalContent
        self.assertIn("function buildInlineStreamScorecardHtml(", js_code)
        self.assertIn("Match Scorecard", js_code)
        self.assertIn("matchupContainer.innerHTML = buildInlineStreamScorecardHtml(", js_code)

        # Extract updateEventStreamModalContent body and verify no redundant "View Scorecard" button or stream-modal-versus-strip is rendered inside it
        fn_start = js_code.index("function updateEventStreamModalContent()")
        fn_end = js_code.index("window.updateEventStreamModalContent = updateEventStreamModalContent;")
        fn_body = js_code[fn_start:fn_end]
        self.assertNotIn("View Scorecard", fn_body)
        self.assertNotIn("stream-modal-versus-strip", fn_body)

    def test_open_scorecard_modal_populates_top_strip_before_async_fetch(self):
        with open("web/js/modals.js", "r", encoding="utf-8") as f:
            modals_js = f.read()

        fn_start = modals_js.index("async function openScorecardModal(matchId)")
        await_idx = modals_js.index("await window.api.getScorecard(matchId)", fn_start)
        pre_await_body = modals_js[fn_start:await_idx]

        # Verify top player names, factions, detachments, and scores are populated/reset BEFORE the async API call
        self.assertIn("if (evMatch)", pre_await_body)
        self.assertIn("p1NameEl.innerText = evMatch.player1_name", pre_await_body)
        self.assertIn("p2NameEl.innerText = evMatch.player2_name", pre_await_body)
        self.assertIn("p1ScoreEl.innerText = hasInitScore ? evMatch.player1_score : '-'", pre_await_body)
        self.assertIn("p1NameEl.innerText = 'Loading...'", pre_await_body)

    def test_event_details_bcp_list_id_and_placement_overlay_and_player_station_synthesis(self):
        db = PostgresDatabase.__new__(PostgresDatabase)
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.__enter__.return_value = mock_conn
        mock_cursor.__enter__.return_value = mock_cursor
        db.get_connection = MagicMock(return_value=mock_conn)
        mock_conn.cursor.return_value = mock_cursor

        mock_cursor.fetchone.return_value = {
            "id": "7ohG0RuDqC1k",
            "name": "Las Vegas Open XIV: Warhammer 40k Champs",
            "event_date": "2025-10-03",
            "city": "Las Vegas",
            "state": "NV",
            "country": "US",
            "total_players": 914,
            "num_rounds": 9,
            "game_system": "40k",
            "is_ended": True,
        }
        mock_cursor.fetchall.side_effect = [
            [
                {
                    "id": 1001,
                    "round": 1,
                    "table_number": 42,
                    "player1_id": "MEV83VFANA",
                    "player1_name": "John Hsieh",
                    "player1_faction": "Genestealer Cults",
                    "player1_score": 85,
                    "player1_elo_before": 1650.0,
                    "player1_elo_after": 1665.0,
                    "player1_elo_delta": 15.0,
                    "player2_id": "OPP1234567",
                    "player2_name": "Richard Siegler",
                    "player2_faction": "Adeptus Mechanicus",
                    "player2_score": 92,
                    "player2_elo_before": 1950.0,
                    "player2_elo_after": 1955.0,
                    "player2_elo_delta": 5.0,
                    "winner_id": "OPP1234567",
                    "is_draw": False,
                    "match_date": "2025-10-03",
                    "tracker_match_id": None,
                }
            ],
            [
                {
                    "player_id": "MEV83VFANA",
                    "full_name": "John Hsieh",
                    "faction": "Genestealer Cults",
                    "team": "Stat Check",
                    "placement": None,
                    "dropped": False,
                    "checked_in": True,
                    "bcp_player_id": "ep_john",
                    "detachment": "Host of Ascension",
                    "army_list": "/list/LIST_JOHN_123",
                    "has_list_submitted": True,
                    "battle_points": 410,
                    "current_elo": 1665.0,
                },
                {
                    "player_id": "OPP1234567",
                    "full_name": "Richard Siegler",
                    "faction": "Adeptus Mechanicus",
                    "team": "Art of War",
                    "placement": 1,
                    "dropped": False,
                    "checked_in": True,
                    "bcp_player_id": "ep_siegler",
                    "detachment": "Skitarii Hunter Cohort",
                    "army_list": None,
                    "has_list_submitted": False,
                    "battle_points": 850,
                    "current_elo": 1955.0,
                },
            ],
        ]

        # Pre-populate BCP placings cache for Richard Siegler's listId and John Hsieh's official placement
        PostgresDatabase.set_cached(
            PostgresDatabase._bcp_event_placings_cache_dict,
            "7ohG0RuDqC1k",
            {
                "by_id": {"MEV83VFANA": 112, "OPP1234567": 1},
                "by_name": {"john hsieh": 112, "richard siegler": 1},
                "meta_by_id": {
                    "MEV83VFANA": {"placement": 112, "list_id": "LIST_JOHN_123", "list_url": "https://www.bestcoastpairings.com/list/LIST_JOHN_123", "has_list": True},
                    "OPP1234567": {"placement": 1, "list_id": "LIST_SIEGLER_999", "list_url": "https://www.bestcoastpairings.com/list/LIST_SIEGLER_999", "has_list": True},
                },
                "meta_by_name": {},
                "active_count": 914,
                "fetched_ok": True,
            },
        )

        ev = db.get_event_details("7ohG0RuDqC1k")
        self.assertIsNotNone(ev)
        players_by_id = {p["player_id"]: p for p in ev["players"]}
        self.assertTrue(players_by_id["MEV83VFANA"]["has_list"])
        self.assertEqual(players_by_id["MEV83VFANA"]["list_id"], "LIST_JOHN_123")
        self.assertEqual(players_by_id["MEV83VFANA"]["placement"], 112)
        self.assertTrue(players_by_id["OPP1234567"]["has_list"])
        self.assertEqual(players_by_id["OPP1234567"]["list_id"], "LIST_SIEGLER_999")
        self.assertEqual(ev["matches"][0]["player1_list_id"], "LIST_JOHN_123")
        self.assertEqual(ev["matches"][0]["player2_list_id"], "LIST_SIEGLER_999")

        with open("web/js/tournaments.js", "r", encoding="utf-8") as f:
            js_code = f.read()
        self.assertIn("function synthesizeClientUserEventRegistration(ev, existingReg = null)", js_code)
        self.assertIn("userRegData = synthesizeClientUserEventRegistration(ev, userRegData);", js_code)
        self.assertIn("event-hub-participant-banner", js_code)


if __name__ == "__main__":
    unittest.main()

