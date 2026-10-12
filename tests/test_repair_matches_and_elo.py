"""Unit tests for retroactive BCP match score/winner repair and Elo reconstruction."""

import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routers.leaderboard import format_bcp_roster_to_players
from scraper import BestCoastPairingsScraper
from scripts.repair_matches_and_elo import (
    REPAIR_MIGRATION_KEY,
    _compute_authoritative_outcome,
    _find_game_for_round,
    _lookup_player_games_in_roster_map,
    ensure_startup_elo_repair_migration,
    repair_historical_matches_and_elo,
)


class TestRepairMatchesAndElo(unittest.TestCase):

    def test_pod_effective_round_normalization_in_scraper_and_leaderboard(self):
        """Verify playoff pod games (pod: True, gameNum: 1..3) are offset by event_max_swiss (6 -> 7..9)."""
        mock_db = MagicMock()
        scraper = BestCoastPairingsScraper(db=mock_db)

        enrolled_players = [
            {
                "id": "reg_pod_winner",
                "userId": "user_pod_winner",
                "firstName": "Jack",
                "lastName": "Harpster",
                "total_games": [
                    {"gameNum": 1, "gamePoints": 90, "gameResult": 2, "pod": False},
                    {"gameNum": 2, "gamePoints": 85, "gameResult": 2, "pod": False},
                    {"gameNum": 3, "gamePoints": 95, "gameResult": 2, "pod": False},
                    {"gameNum": 4, "gamePoints": 80, "gameResult": 2, "pod": False},
                    {"gameNum": 5, "gamePoints": 88, "gameResult": 2, "pod": False},
                    {"gameNum": 6, "gamePoints": 75, "gameResult": 1, "pod": False},
                    # Playoff pod rounds 1, 2, 3 -> should map to effectiveRound 7, 8, 9
                    {"gameNum": 1, "gamePoints": 100, "gameResult": 2, "pod": True},
                    {"gameNum": 2, "gamePoints": 92, "gameResult": 2, "pod": True},
                    {"gameNum": 3, "gamePoints": 98, "gameResult": 2, "pod": True},
                ],
            }
        ]

        roster_map = scraper.build_roster_id_map(enrolled_players)
        games = roster_map.get("games:user_pod_winner")
        self.assertIsNotNone(games)
        self.assertEqual(len(games), 9)

        # Round 1 must be the Swiss game (90 pts), Round 7 must be Pod Round 1 (100 pts)
        r1_game = _find_game_for_round(games, 1)
        r7_game = _find_game_for_round(games, 7)
        r9_game = _find_game_for_round(games, 9)
        self.assertEqual(r1_game["gamePoints"], 90)
        self.assertEqual(r7_game["gamePoints"], 100)
        self.assertEqual(r9_game["gamePoints"], 98)

        # Also verify format_bcp_roster_to_players preserves effectiveRound
        formatted = format_bcp_roster_to_players(enrolled_players, is_ended=True)
        self.assertEqual(len(formatted), 1)
        f_games = formatted[0]["games"]
        self.assertEqual(len(f_games), 9)
        self.assertEqual(_find_game_for_round(f_games, 1)["gamePoints"], 90)
        self.assertEqual(_find_game_for_round(f_games, 7)["gamePoints"], 100)

    def test_lvo_round2_table224_retroactive_repair(self):
        """Simulate LVO 2026 (7ohG0RuDqC1k) R2 Table 224 stale metaData (68-66 W -> 66-68 L) and verify repair."""
        # Corrupted DB row persisted before commit dcc9b15
        corrupted_db_row = {
            "id": "match_lvo_r2_t224",
            "event_id": "7ohG0RuDqC1k",
            "round": 2,
            "table_number": 224,
            "player1_id": "Te1Q9Ip3By",
            "player1_name": "Junior Aflleje",
            "player1_score": 68,
            "player2_id": "q1nU0cM8v9",
            "player2_name": "Isaac Terada",
            "player2_score": 66,
            "winner_id": "Te1Q9Ip3By",
            "loser_id": "q1nU0cM8v9",
            "is_draw": False,
            "is_bye": False,
            "is_done": True,
            "raw_json": json.dumps(
                {
                    "id": "match_lvo_r2_t224",
                    "round": 2,
                    "table": 224,
                    "player1": {"id": "reg_junior", "userId": "Te1Q9Ip3By"},
                    "player2": {"id": "reg_isaac", "userId": "q1nU0cM8v9"},
                    "player1Game": None,
                    "player2Game": None,
                    "metaData": {
                        "p1-gamePoints": 68,
                        "p1-gameResult": 2,
                        "p2-gamePoints": 66,
                        "p2-gameResult": 0,
                    },
                }
            ),
        }

        # Authoritative BCP /players payload for Junior Aflleje and Isaac Terada
        authoritative_bcp_roster = [
            {
                "id": "reg_junior",
                "userId": "Te1Q9Ip3By",
                "user": {"id": "Te1Q9Ip3By", "firstName": "Junior", "lastName": "Aflleje"},
                "total_games": [
                    {"gameNum": 1, "gamePoints": 83, "gameResult": 2, "pod": False},
                    {"gameNum": 2, "gamePoints": 66, "gameResult": 0, "pod": False},
                    {"gameNum": 3, "gamePoints": 90, "gameResult": 2, "pod": False},
                ],
            },
            {
                "id": "reg_isaac",
                "userId": "q1nU0cM8v9",
                "user": {"id": "q1nU0cM8v9", "firstName": "Isaac", "lastName": "Terada"},
                "total_games": [
                    {"gameNum": 1, "gamePoints": 75, "gameResult": 2, "pod": False},
                    {"gameNum": 2, "gamePoints": 68, "gameResult": 2, "pod": False},
                    {"gameNum": 3, "gamePoints": 60, "gameResult": 0, "pod": False},
                ],
            },
        ]

        mock_db = MagicMock()
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_db.get_connection.return_value.__enter__.return_value = mock_conn
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        mock_cur.fetchall.return_value = [corrupted_db_row]

        mock_elo_engine = MagicMock()
        mock_elo_engine.reconstruct_since_date.return_value = {"status": "success"}

        with patch("scripts.repair_matches_and_elo.BestCoastPairingsScraper") as MockScraperCls, \
             patch("scripts.repair_matches_and_elo.get_elo_engine", return_value=mock_elo_engine), \
             patch("scripts.repair_matches_and_elo.extras.execute_batch") as mock_exec_batch:
            real_helper = BestCoastPairingsScraper(db=mock_db)
            scraper_inst = MockScraperCls.return_value
            scraper_inst.fetch_event_players.return_value = authoritative_bcp_roster
            scraper_inst.build_roster_id_map.side_effect = real_helper.build_roster_id_map

            res = repair_historical_matches_and_elo(
                db=mock_db,
                event_ids=["7ohG0RuDqC1k"],
                reconstruct=True,
            )

        self.assertEqual(res["status"], "success")
        self.assertEqual(res["matches_repaired"], 1)
        self.assertEqual(res["events_repaired"], ["7ohG0RuDqC1k"])
        self.assertTrue(res["elo_reconstructed"])
        mock_elo_engine.reconstruct_since_date.assert_called_once_with(
            since_date="2026-09-01",
            game_system="all",
        )

        # Verify the exact SQL parameters passed to execute_batch
        self.assertTrue(mock_exec_batch.called)
        batch_args = mock_exec_batch.call_args[0][2]
        self.assertEqual(len(batch_args), 1)
        (
            new_p1_score,
            new_p2_score,
            new_winner_id,
            new_loser_id,
            new_is_draw,
            new_is_done,
            match_id,
        ) = batch_args[0]
        self.assertEqual(new_p1_score, 66)
        self.assertEqual(new_p2_score, 68)
        self.assertEqual(new_winner_id, "q1nU0cM8v9")
        self.assertEqual(new_loser_id, "Te1Q9Ip3By")
        self.assertFalse(new_is_draw)
        self.assertTrue(new_is_done)
        self.assertEqual(match_id, "match_lvo_r2_t224")

    def test_startup_migration_idempotency(self):
        """Verify ensure_startup_elo_repair_migration skips when already marked 'completed'."""
        mock_db = MagicMock()
        mock_db.get_setting.return_value = "completed"

        with patch("scripts.repair_matches_and_elo.repair_historical_matches_and_elo") as mock_repair:
            ran = ensure_startup_elo_repair_migration(db=mock_db)
            self.assertFalse(ran)
            mock_repair.assert_not_called()

    def test_bcp_specific_faction_extraction_over_grand_alliance_super_factions(self):
        """Verify BCP payloads with faction='Imperium'/'Chaos'/'Forces of the Hive Mind' extract specific army."""
        from scraper import extract_bcp_specific_faction
        from database import PostgresDatabase

        # Brian Benn at Fabricators Forge: faction='Imperium', army='Adepta Sororitas'
        brian_p_obj = {
            "id": "reg_brian",
            "userId": "user_brian",
            "firstName": "Brian",
            "lastName": "Benn",
            "faction": {"name": "Imperium"},
            "army": {"name": "Adepta Sororitas"},
        }
        self.assertEqual(extract_bcp_specific_faction(brian_p_obj), "Adepta Sororitas")

        # Logan Esler: faction='Chaos', army='World Eaters'
        logan_p_obj = {
            "id": "reg_logan",
            "userId": "user_logan",
            "firstName": "Logan",
            "lastName": "Esler",
            "faction": {"name": "Chaos"},
            "army": {"name": "World Eaters"},
        }
        self.assertEqual(extract_bcp_specific_faction(logan_p_obj), "World Eaters")

        # Forces of the Hive Mind vs Tyranids
        tyranid_p_obj = {
            "faction": {"name": "Forces of the Hive Mind"},
            "army": {"name": "Tyranids"},
        }
        self.assertEqual(extract_bcp_specific_faction(tyranid_p_obj), "Tyranids")

        # Space Marines (Astartes) vs Blood Angels
        ba_p_obj = {
            "faction": {"name": "Space Marines (Astartes)"},
            "army": {"name": "Blood Angels"},
        }
        self.assertEqual(extract_bcp_specific_faction(ba_p_obj), "Blood Angels")

        # format_bcp_roster_to_players also prefers specific army over super-faction
        formatted = format_bcp_roster_to_players([brian_p_obj, logan_p_obj], is_ended=True)
        self.assertEqual(formatted[0]["faction"], "Adepta Sororitas")
        self.assertEqual(formatted[1]["faction"], "World Eaters")

        # PostgresDatabase.pick_specific_faction priority checks
        self.assertEqual(
            PostgresDatabase.pick_specific_faction("Imperium", "Adepta Sororitas"),
            "Adepta Sororitas",
        )
        self.assertEqual(
            PostgresDatabase.pick_specific_faction("Space Marines (Astartes)", "Blood Angels"),
            "Blood Angels",
        )
        self.assertEqual(
            PostgresDatabase.pick_specific_faction("Imperium", "Space Marines (Astartes)"),
            "Space Marines (Astartes)",
        )

    def test_elo_win_path_strips_super_factions_and_maintains_sub_1s_latency(self):
        """Verify EloEngine.get_player_win_path enriches super-factions from tournaments and completes in <1s."""
        import time
        from elo import EloEngine, _sanitize_top_factions
        import collections

        # 1. Verify _sanitize_top_factions removes super-factions and redundant generic SM when specific chapter exists
        counts = collections.Counter({
            "Blood Angels": 12,
            "Adepta Sororitas": 6,
            "Necrons": 3,
            "Imperium": 3,
            "Space Marines (Astartes)": 2,
            "Forces of the Hive Mind": 1,
        })
        self.assertEqual(
            _sanitize_top_factions(counts),
            "Blood Angels, Adepta Sororitas, Necrons",
        )

        # 2. Verify get_player_win_path upgrades 'Imperium' round history from tournament 'Adepta Sororitas'
        # and strips 'Imperium'/'Chaos'/'Forces of the Hive Mind' from faction_mastery, matchup_matrix, and top_faction
        mock_db = MagicMock()
        mock_db._is_mock_instance.return_value = True
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_db.get_connection.return_value.__enter__.return_value = mock_conn
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        mock_cur.fetchone.return_value = {
            "player_id": "brian_benn_id",
            "player_name": "Brian Benn",
            "current_elo": 1617.0,
            "peak_elo": 1617.0,
            "matches_played": 4,
            "wins": 3,
            "losses": 1,
            "draws": 0,
            "win_rate": 75.0,
            "top_faction": "Blood Angels, Adepta Sororitas, Necrons, Imperium, Space Marines (Astartes)",
            "team": "Fabricators Forge",
        }
        mock_cur.fetchall.return_value = [("Fabricators Forge", "2026-03-07")]

        mock_db.get_player_history.return_value = [
            {
                "event_id": "ev_fab_forge",
                "event_name": "Fabricators Forge March 40K RTT",
                "round": 1,
                "match_date": "2026-03-07",
                "result": "W",
                "player_score": 89,
                "opponent_score": 57,
                "delta_elo": 16.0,
                "new_elo": 1590.0,
                "opponent_id": "opp_logan",
                "opponent_name": "Logan Esler",
                "opponent_elo": 1500.0,
                "player_faction": "Imperium",
                "opponent_faction": "World Eaters",
            },
            {
                "event_id": "ev_fab_forge",
                "event_name": "Fabricators Forge March 40K RTT",
                "round": 2,
                "match_date": "2026-03-07",
                "result": "W",
                "player_score": 80,
                "opponent_score": 73,
                "delta_elo": 14.2,
                "new_elo": 1604.2,
                "opponent_id": "opp_connor",
                "opponent_name": "Connor Riley",
                "opponent_elo": 1510.0,
                "player_faction": "Imperium",
                "opponent_faction": "Imperium",
            },
            {
                "event_id": "ev_gt",
                "event_name": "Mid-Winter GT",
                "round": 1,
                "match_date": "2026-02-14",
                "result": "W",
                "player_score": 95,
                "opponent_score": 45,
                "delta_elo": 15.0,
                "new_elo": 1617.0,
                "opponent_id": "opp_tyr",
                "opponent_name": "Hive Player",
                "opponent_elo": 1500.0,
                "player_faction": "Blood Angels",
                "opponent_faction": "Forces of the Hive Mind",
            },
        ]
        mock_db.get_player_tournaments.return_value = [
            {
                "event_id": "ev_fab_forge",
                "event_name": "Fabricators Forge March 40K RTT",
                "event_date": "2026-03-07",
                "registered_faction": "Adepta Sororitas",
                "placement": 1,
                "total_players": 26,
                "wins": 3,
                "losses": 0,
                "draws": 0,
            }
        ]

        engine = EloEngine(db=mock_db)
        t0 = time.perf_counter()
        profile = engine.get_player_win_path("brian_benn_id", game_system="40k", include_tournaments=True)
        elapsed_s = time.perf_counter() - t0

        # Strict latency requirement: < 1.0s
        self.assertLess(elapsed_s, 1.0)

        # Round 1 & 2 at Fabricators Forge must be upgraded from 'Imperium' to 'Adepta Sororitas'
        self.assertEqual(profile["history"][0]["player_faction"], "Adepta Sororitas")
        self.assertEqual(profile["history"][1]["player_faction"], "Adepta Sororitas")

        # Faction Mastery & Factions Breakdown must contain Adepta Sororitas & Blood Angels, NEVER Imperium
        fm_names = [f["faction"] for f in profile["faction_mastery"]]
        self.assertIn("Adepta Sororitas", fm_names)
        self.assertIn("Blood Angels", fm_names)
        self.assertNotIn("Imperium", fm_names)
        self.assertNotIn("Space Marines (Astartes)", fm_names)

        # Matchup Matrix must contain World Eaters, NEVER Imperium or Forces of the Hive Mind
        mm_names = [m["enemy_faction"] for m in profile["matchup_matrix"]]
        self.assertEqual(mm_names, ["World Eaters"])

        # top_faction must be cleaned of Imperium and Space Marines (Astartes)
        self.assertNotIn("Imperium", profile["top_faction"])
        self.assertNotIn("Space Marines (Astartes)", profile["top_faction"])

    def test_multi_week_league_missing_rounds_backfill(self):
        """Simulate Autumn Annihilation 2026 (DAVY7pZIVACh) where DB only has Round 1 and BCP has Rounds 1-3."""
        db_round1_only = [
            {
                "id": "RdkFsTLJ7Vc7",
                "event_id": "DAVY7pZIVACh",
                "round": 1,
                "table_number": 1,
                "player1_id": "CF1MBH6T87",
                "player1_name": "Nemo The Fish",
                "player1_score": 20,
                "player2_id": "mick_id",
                "player2_name": "Mick (Pyrothenia) Miller",
                "player2_score": 0,
                "winner_id": "CF1MBH6T87",
                "loser_id": "mick_id",
                "is_draw": False,
                "is_bye": False,
                "is_done": True,
                "raw_json": "{}",
            }
        ]

        authoritative_roster = [
            {
                "id": "reg_nemo",
                "userId": "CF1MBH6T87",
                "user": {"id": "CF1MBH6T87", "firstName": "Nemo", "lastName": "The Fish"},
                "faction": {"name": "Astra Militarum"},
                "total_games": [
                    {"gameNum": 1, "gamePoints": 20, "gameResult": 2, "pod": False},
                    {"gameNum": 2, "gamePoints": 20, "gameResult": 2, "pod": False},
                    {"gameNum": 3, "gamePoints": 19, "gameResult": 2, "pod": False},
                ],
            },
            {
                "id": "reg_mick",
                "userId": "mick_id",
                "user": {"id": "mick_id", "firstName": "Mick", "lastName": "Miller"},
                "total_games": [
                    {"gameNum": 1, "gamePoints": 0, "gameResult": 0, "pod": False},
                    {"gameNum": 2, "gamePoints": 10, "gameResult": 1, "pod": False},
                    {"gameNum": 3, "gamePoints": 15, "gameResult": 2, "pod": False},
                ],
            },
            {
                "id": "reg_blake",
                "userId": "blake_id",
                "user": {"id": "blake_id", "firstName": "Blake", "lastName": "Baker"},
                "total_games": [
                    {"gameNum": 1, "gamePoints": 15, "gameResult": 2, "pod": False},
                    {"gameNum": 2, "gamePoints": 0, "gameResult": 0, "pod": False},
                    {"gameNum": 3, "gamePoints": 12, "gameResult": 2, "pod": False},
                ],
            },
            {
                "id": "reg_rii",
                "userId": "rii_id",
                "user": {"id": "rii_id", "firstName": "Rii", "lastName": "Anderson"},
                "total_games": [
                    {"gameNum": 1, "gamePoints": 18, "gameResult": 2, "pod": False},
                    {"gameNum": 2, "gamePoints": 10, "gameResult": 1, "pod": False},
                    {"gameNum": 3, "gamePoints": 1, "gameResult": 0, "pod": False},
                ],
            },
        ]

        r2_pairings = [
            {
                "id": "tHUdTiYhD6UA",
                "round": 2,
                "table": 3,
                "player1": {"id": "reg_nemo", "userId": "CF1MBH6T87", "firstName": "Nemo", "lastName": "The Fish"},
                "player2": {"id": "reg_blake", "userId": "blake_id", "firstName": "Blake", "lastName": "Baker"},
                "player1Game": {"points": 20, "result": 2},
                "player2Game": {"points": 0, "result": 0},
            }
        ]
        r3_pairings = [
            {
                "id": "ER9qjVfy6tHZ",
                "round": 3,
                "table": 1,
                "player1": {"id": "reg_rii", "userId": "rii_id", "firstName": "Rii", "lastName": "Anderson"},
                "player2": {"id": "reg_nemo", "userId": "CF1MBH6T87", "firstName": "Nemo", "lastName": "The Fish"},
                "player1Game": {"points": 1, "result": 0},
                "player2Game": {"points": 19, "result": 2},
            }
        ]

        mock_db = MagicMock()
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_db.get_connection.return_value.__enter__.return_value = mock_conn
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        mock_cur.fetchall.return_value = db_round1_only
        mock_cur.fetchone.return_value = {"event_date": "2026-09-14T05:00:00Z", "game_system": "40k"}

        mock_elo_engine = MagicMock()
        mock_elo_engine.reconstruct_since_date.return_value = {"status": "success"}

        def _fake_fetch_pairings(eid, round_num=1):
            if round_num == 2:
                return r2_pairings
            if round_num == 3:
                return r3_pairings
            return []

        with patch("scripts.repair_matches_and_elo.BestCoastPairingsScraper") as MockScraperCls, \
             patch("scripts.repair_matches_and_elo.get_elo_engine", return_value=mock_elo_engine):
            real_helper = BestCoastPairingsScraper(db=mock_db)
            scraper_inst = MockScraperCls.return_value
            scraper_inst.fetch_event_players.return_value = authoritative_roster
            scraper_inst.build_roster_id_map.side_effect = real_helper.build_roster_id_map
            scraper_inst.fetch_event_pairings_for_round.side_effect = _fake_fetch_pairings
            scraper_inst.parse_and_store_match.side_effect = real_helper.parse_and_store_match

            res = repair_historical_matches_and_elo(
                db=mock_db,
                event_ids=["DAVY7pZIVACh"],
                reconstruct=True,
            )

        self.assertEqual(res["status"], "success")
        self.assertEqual(res["matches_inserted"], 2)
        self.assertEqual(res["events_repaired"], ["DAVY7pZIVACh"])
        self.assertTrue(res["elo_reconstructed"])
        self.assertTrue(mock_db.upsert_matches_batch.called)
        upserted = mock_db.upsert_matches_batch.call_args[0][0]
        self.assertEqual(len(upserted), 2)
        self.assertEqual({m["id"] for m in upserted}, {"tHUdTiYhD6UA", "ER9qjVfy6tHZ"})
        for m in upserted:
            self.assertEqual(m["winner_id"], "CF1MBH6T87")

    def test_nemo_player_profile_reconciles_missing_rounds_under_1s(self):
        """Verify EloEngine.get_player_win_path supplements missing rounds from matches/_event_details_cache in <1s."""
        import time
        from elo import EloEngine
        from routers import leaderboard as lb_router

        mock_db = MagicMock()
        mock_db._is_mock_instance.return_value = True
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_db.get_connection.return_value.__enter__.return_value = mock_conn
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        mock_cur.fetchone.return_value = {
            "player_id": "CF1MBH6T87",
            "player_name": "Nemo The Fish",
            "current_elo": 1919.8,
            "peak_elo": 1919.8,
            "matches_played": 250,
            "wins": 200,
            "losses": 50,
            "draws": 0,
            "win_rate": 80.0,
            "top_faction": "Astra Militarum",
            "team": "Wyvern",
        }
        mock_cur.fetchall.return_value = []

        # Suppose rating_history only had Round 1 of DAVY7pZIVACh
        mock_db.get_player_history.return_value = [
            {
                "match_id": "RdkFsTLJ7Vc7",
                "event_id": "DAVY7pZIVACh",
                "event_name": "Wyvern Wargaming Teams League - Autumn Annihilation 2026",
                "round": 1,
                "table_number": 1,
                "match_date": "2026-09-14",
                "result": "W",
                "player_score": 20,
                "opponent_score": 0,
                "delta_elo": 0.4,
                "new_elo": 1919.8,
                "opponent_id": "mick_id",
                "opponent_name": "Mick (Pyrothenia) Miller",
                "opponent_elo": 1500.0,
                "player_faction": "Astra Militarum",
                "opponent_faction": "Chaos Knights",
            }
        ]
        mock_db.get_player_matches.return_value = []
        mock_db.get_player_tournaments.return_value = [
            {
                "event_id": "DAVY7pZIVACh",
                "event_name": "Wyvern Wargaming Teams League - Autumn Annihilation 2026",
                "event_date": "2026-09-14",
                "registered_faction": "Astra Militarum",
                "placement": 2,
                "total_players": 87,
                "wins": 1,
                "losses": 0,
                "draws": 0,
                "matches_played": 1,
            }
        ]

        # And suppose _event_details_cache has the 3 completed rounds from Event Detail modal
        lb_router._event_details_cache["DAVY7pZIVACh"] = {
            "timestamp": time.time(),
            "is_ended": False,
            "data": {
                "id": "DAVY7pZIVACh",
                "name": "Wyvern Wargaming Teams League - Autumn Annihilation 2026",
                "event_date": "2026-09-14",
                "matches": [
                    {
                        "id": "RdkFsTLJ7Vc7",
                        "round": 1,
                        "table_number": 1,
                        "player1_id": "CF1MBH6T87",
                        "player1_name": "Nemo The Fish",
                        "player1_faction": "Astra Militarum",
                        "player1_score": 20,
                        "player2_id": "mick_id",
                        "player2_name": "Mick (Pyrothenia) Miller",
                        "player2_faction": "Chaos Knights",
                        "player2_score": 0,
                        "winner_id": "CF1MBH6T87",
                        "is_done": True,
                    },
                    {
                        "id": "tHUdTiYhD6UA",
                        "round": 2,
                        "table_number": 3,
                        "player1_id": "CF1MBH6T87",
                        "player1_name": "Nemo The Fish",
                        "player1_faction": "Astra Militarum",
                        "player1_score": 20,
                        "player2_id": "blake_id",
                        "player2_name": "Blake @bernafein Baker",
                        "player2_faction": "Thousand Sons",
                        "player2_score": 0,
                        "winner_id": "CF1MBH6T87",
                        "is_done": True,
                    },
                    {
                        "id": "ER9qjVfy6tHZ",
                        "round": 3,
                        "table_number": 1,
                        "player1_id": "rii_id",
                        "player1_name": "Rii Anderson",
                        "player1_faction": "Necrons",
                        "player1_score": 1,
                        "player2_id": "CF1MBH6T87",
                        "player2_name": "Nemo The Fish",
                        "player2_faction": "Astra Militarum",
                        "player2_score": 19,
                        "winner_id": "CF1MBH6T87",
                        "is_done": True,
                    },
                ],
            },
        }

        try:
            engine = EloEngine(db=mock_db)
            t0 = time.perf_counter()
            profile = engine.get_player_win_path("CF1MBH6T87", game_system="40k", include_tournaments=True)
            elapsed_s = time.perf_counter() - t0

            self.assertLess(elapsed_s, 1.0)
            davy_hist = [h for h in profile["history"] if h.get("event_id") == "DAVY7pZIVACh"]
            self.assertEqual(len(davy_hist), 3)
            self.assertEqual([h["round"] for h in sorted(davy_hist, key=lambda x: x["round"])], [1, 2, 3])
            self.assertEqual(profile["tournaments"][0]["wins"], 3)
            self.assertEqual(profile["tournaments"][0]["losses"], 0)
            self.assertEqual(profile["tournaments"][0]["matches_played"], 3)
        finally:
            lb_router._event_details_cache.pop("DAVY7pZIVACh", None)


if __name__ == "__main__":
    unittest.main()

