"""
Comprehensive Mock Test Suite for All 105 Master Badges
======================================================
Tests each of the 105 badges individually against authentic, concrete mock
tournament match data, verifying:
  1. Each badge unlocks when its specific condition is met.
  2. Each badge remains locked under baseline/empty player data (except founding badges).
  3. Strict boundary & negative testing for critical telemetry metrics.
  4. 7-tier military progression ladder calculation.
"""

import sys
import unittest
from pathlib import Path
from typing import Dict, Any, List

# Ensure repository root is on path
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

import badges
from badges import BADGE_CATALOG, evaluate_player_badges, get_rank_for_badge_count, RANKS


class TestAll105BadgesMock(unittest.TestCase):
    """Rigorous mock-driven verification for every single one of the 105 badges."""

    def setUp(self):
        self.catalog = {b["id"]: b for b in BADGE_CATALOG}
        self.assertEqual(len(self.catalog), 105, "Catalog must contain exactly 105 badges")

    def test_catalog_integrity(self):
        """Verify all 105 badges have required fields, valid rarities, and non-empty descriptions."""
        valid_rarities = {"common", "uncommon", "rare", "epic", "legendary", "mythic"}
        valid_categories = {"tournament", "battlefield", "factions", "ladder", "career"}

        category_counts = {}
        for b in BADGE_CATALOG:
            self.assertIn("id", b)
            self.assertIn("name", b)
            self.assertIn("category", b)
            self.assertIn("rarity", b)
            self.assertIn("icon", b)
            self.assertIn("description", b)
            self.assertIn(b["rarity"], valid_rarities)
            self.assertIn(b["category"], valid_categories)
            self.assertTrue(len(b["description"]) > 10, f"Badge {b['id']} has empty/short description")
            category_counts[b["category"]] = category_counts.get(b["category"], 0) + 1

        self.assertEqual(category_counts["tournament"], 25)
        self.assertEqual(category_counts["battlefield"], 25)
        self.assertEqual(category_counts["factions"], 25)
        self.assertEqual(category_counts["ladder"], 15)
        self.assertEqual(category_counts["career"], 15)

    def test_baseline_empty_player(self):
        """A brand new player with 0 matches should only unlock founding badges."""
        player_data = {
            "current_elo": 1500.0,
            "peak_elo": 1500.0,
            "matches_played": 0,
            "wins": 0,
            "losses": 0,
            "draws": 0,
            "win_rate": 0.0,
            "team": ""
        }
        res = evaluate_player_badges(player_data, history=[], tournaments=[])
        unlocked_ids = {b["id"] for b in res["badges"] if b["unlocked"]}
        
        # Only founding badges are unlocked day one
        self.assertEqual(unlocked_ids, {"omnitactica_pioneer", "army_customizer"})
        self.assertEqual(res["badge_count"], 2)
        self.assertEqual(res["rank"]["title"], "Initiate")

    def test_all_105_badges_mock_fixtures(self):
        """Test each of the 105 badges individually with crafted mock telemetry."""
        
        fixtures: Dict[str, Dict[str, Any]] = {
            # ── Tournament Conquest (25) ──
            "first_blood": {
                "player_data": {"wins": 1, "matches_played": 1},
                "history": [{"result": "W", "player_score": 75, "opponent_score": 60, "match_date": "2026-06-01"}]
            },
            "the_debutant": {
                "player_data": {"matches_played": 3},
                "tournaments": [{"event_name": "Summer Open", "matches_played": 3}]
            },
            "weekend_warrior": {
                "player_data": {"matches_played": 15},
                "tournaments": [{"event_id": f"gt_{i}", "matches_played": 5} for i in range(3)]
            },
            "campaign_veteran": {
                "player_data": {"matches_played": 50},
                "tournaments": [{"event_id": f"gt_{i}", "matches_played": 5} for i in range(10)]
            },
            "iron_man_1": {
                "tournaments": [{"event_id": "gt_1", "matches_played": 5}]
            },
            "iron_man_2": {
                "tournaments": [{"event_id": f"gt_{i}", "matches_played": 5} for i in range(5)]
            },
            "iron_man_3": {
                "tournaments": [{"event_id": f"gt_{i}", "matches_played": 5} for i in range(10)]
            },
            "positive_ledger": {
                "tournaments": [{"event_id": "gt_1", "wins": 3, "losses": 2, "matches_played": 5}]
            },
            "top_quarter": {
                "tournaments": [{"event_id": "gt_32", "wins": 3, "losses": 2, "matches_played": 5, "total_battle_points": 380}]
            },
            "podium_bronze": {
                "tournaments": [{"event_id": "gt_1", "wins": 4, "losses": 1, "matches_played": 5, "total_battle_points": 420}]
            },
            "podium_silver": {
                "tournaments": [
                    {"event_id": "gt_1", "wins": 4, "losses": 1, "matches_played": 5},
                    {"event_id": "gt_2", "wins": 4, "losses": 1, "matches_played": 5}
                ]
            },
            "grand_champion": {
                "tournaments": [{"event_id": "gt_1", "wins": 5, "losses": 0, "matches_played": 5}]
            },
            "the_undefeated": {
                "player_data": {"longest_win_streak": 5},
                "tournaments": [{"event_id": "gt_1", "wins": 5, "losses": 0, "matches_played": 5}]
            },
            "super_major_conqueror": {
                "tournaments": [{"event_id": "major_1", "wins": 6, "losses": 0, "matches_played": 6}]
            },
            "double_crown": {
                "player_data": {"longest_win_streak": 10}
            },
            "triple_crown": {
                "tournaments": [
                    {"event_id": f"gt_{i}", "wins": 4, "losses": 1, "matches_played": 5} for i in range(3)
                ]
            },
            "giant_slayer_1": {
                "player_data": {"current_elo": 1500.0},
                "history": [{"result": "W", "opponent_elo": 1620.0, "new_elo": 1515.0, "delta_elo": 15.0}]
            },
            "giant_slayer_2": {
                "player_data": {"current_elo": 1500.0},
                "history": [{"result": "W", "opponent_elo": 1700.0, "new_elo": 1520.0, "delta_elo": 20.0}]
            },
            "giant_slayer_3": {
                "player_data": {"current_elo": 1500.0},
                "history": [{"result": "W", "opponent_elo": 1800.0, "new_elo": 1530.0, "delta_elo": 30.0}]
            },
            "kingslayer": {
                "history": [{"result": "W", "opponent_elo": 2045.0}]
            },
            "crucible_survivor_1": {
                "history": [
                    {"event_id": "hard_gt", "result": "W", "opponent_elo": 1720.0, "round": 1},
                    {"event_id": "hard_gt", "result": "W", "opponent_elo": 1710.0, "round": 2},
                    {"event_id": "hard_gt", "result": "W", "opponent_elo": 1705.0, "round": 3},
                    {"event_id": "hard_gt", "result": "L", "opponent_elo": 1750.0, "round": 4}
                ]
            },
            "crucible_survivor_2": {
                "history": [
                    {"event_id": "elite_gt", "result": "W", "opponent_elo": 1780.0, "round": 1},
                    {"event_id": "elite_gt", "result": "W", "opponent_elo": 1790.0, "round": 2},
                    {"event_id": "elite_gt", "result": "W", "opponent_elo": 1800.0, "round": 3},
                    {"event_id": "elite_gt", "result": "W", "opponent_elo": 1775.0, "round": 4},
                    {"event_id": "elite_gt", "result": "L", "opponent_elo": 1850.0, "round": 5}
                ]
            },
            "apex_gauntlet": {
                "history": [
                    {"event_id": "apex_gt", "result": "W", "opponent_elo": 1820.0, "round": 1},
                    {"event_id": "apex_gt", "result": "W", "opponent_elo": 1840.0, "round": 2},
                    {"event_id": "apex_gt", "result": "W", "opponent_elo": 1810.0, "round": 3},
                    {"event_id": "apex_gt", "result": "W", "opponent_elo": 1860.0, "round": 4},
                    {"event_id": "apex_gt", "result": "L", "opponent_elo": 1900.0, "round": 5}
                ]
            },
            "table_one_resident": {
                "history": [
                    {"event_id": "gt_1", "round": 1, "result": "W"},
                    {"event_id": "gt_1", "round": 2, "result": "W"},
                    {"event_id": "gt_1", "round": 3, "result": "W"}
                ]
            },
            "clean_sweep": {
                "tournaments": [{"event_id": "gt_sweep", "wins": 5, "losses": 0, "matches_played": 5, "total_battle_points": 465}]
            },

            # ── Battlefield Feats (25) ──
            "marksman": {
                "history": [{"result": "W", "player_score": 75, "opponent_score": 50}]
            },
            "bombardier": {
                "history": [{"result": "W", "player_score": 85, "opponent_score": 60}]
            },
            "centurion_95": {
                "history": [{"result": "W", "player_score": 95, "opponent_score": 40}]
            },
            "perfect_century": {
                "history": [{"result": "W", "player_score": 100, "opponent_score": 35}]
            },
            "iron_curtain_1": {
                "history": [{"result": "W", "player_score": 70, "opponent_score": 45}]
            },
            "iron_curtain_2": {
                "history": [{"result": "W", "player_score": 70, "opponent_score": 30}]
            },
            "impenetrable_wall": {
                "history": [{"result": "W", "player_score": 65, "opponent_score": 18}]
            },
            "zero_out": {
                "history": [{"result": "W", "player_score": 65, "opponent_score": 10}]
            },
            "clutch_by_a_hair": {
                "history": [{"result": "W", "player_score": 71, "opponent_score": 70}]
            },
            "buzzer_beater": {
                "history": [{"result": "W", "round": 5, "player_score": 80, "opponent_score": 60}]
            },
            "comeback_1": {
                "player_data": {"current_elo": 1500.0},
                "history": [{"result": "W", "opponent_elo": 1610.0, "new_elo": 1515.0, "delta_elo": 15.0}]
            },
            "comeback_2": {
                "player_data": {"current_elo": 1500.0},
                "history": [{"result": "W", "opponent_elo": 1700.0, "new_elo": 1520.0, "delta_elo": 20.0}]
            },
            "lazarus_stand": {
                "player_data": {"current_elo": 1500.0},
                "history": [{"result": "W", "opponent_elo": 1800.0, "new_elo": 1530.0, "delta_elo": 30.0}]
            },
            "the_alamo": {
                "history": [{"result": "W", "player_score": 82, "opponent_score": 80}]
            },
            "secondary_specialist": {
                "history": [
                    {"result": "W", "player_score": 80, "opponent_score": 50},
                    {"result": "W", "player_score": 81, "opponent_score": 50},
                    {"result": "W", "player_score": 82, "opponent_score": 50}
                ]
            },
            "secondary_perfection": {
                "history": [
                    {"result": "W", "player_score": 85, "opponent_score": 50},
                    {"result": "W", "player_score": 86, "opponent_score": 50},
                    {"result": "W", "player_score": 88, "opponent_score": 50}
                ]
            },
            "primary_dominator": {
                "history": [
                    {"result": "W", "player_score": 90, "opponent_score": 50},
                    {"result": "W", "player_score": 92, "opponent_score": 50},
                    {"result": "W", "player_score": 94, "opponent_score": 50}
                ]
            },
            "flawless_mission": {
                "history": [{"result": "W", "player_score": 96, "opponent_score": 40}]
            },
            "blitzkrieg": {
                "history": [{"result": "W", "player_score": 85, "opponent_score": 40}]
            },
            "against_all_odds_1": {
                "player_data": {"current_elo": 1500.0},
                "history": [{"result": "W", "opponent_elo": 1620.0, "new_elo": 1515.0, "delta_elo": 15.0}]
            },
            "against_all_odds_2": {
                "player_data": {"current_elo": 1500.0},
                "history": [{"result": "W", "opponent_elo": 1700.0, "new_elo": 1520.0, "delta_elo": 20.0}]
            },
            "miracle_win": {
                "player_data": {"current_elo": 1500.0},
                "history": [{"result": "W", "opponent_elo": 1800.0, "new_elo": 1530.0, "delta_elo": 30.0}]
            },
            "dead_heat": {
                "player_data": {"draws": 1}
            },
            "first_strike": {
                "history": [{"result": "W", "round": 1, "player_score": 88, "opponent_score": 50}]
            },
            "clean_finish": {
                "history": [{"result": "W", "round": 5, "player_score": 75, "opponent_score": 30}]
            },

            # ── Faction Mastery & Anti-Meta (25) ──
            "cadet_of_army": {
                "player_data": {"matches_played": 5}
            },
            "faction_veteran": {
                "player_data": {"matches_played": 25}
            },
            "faction_champion": {
                "player_data": {"matches_played": 50}
            },
            "chapter_master_faction": {
                "player_data": {"matches_played": 100}
            },
            "grand_sovereign": {
                "player_data": {"wins": 50, "matches_played": 70, "win_rate": 71.4}
            },
            "pure_specialist": {
                "player_data": {"wins": 15}
            },
            "polymath_1": {
                "history": [
                    {"result": "W", "player_faction": "Space Marines"},
                    {"result": "W", "player_faction": "Necrons"},
                    {"result": "W", "player_faction": "Aeldari"}
                ]
            },
            "polymath_2": {
                "history": [
                    {"result": "W", "player_faction": f"Faction_{i}"} for i in range(6)
                ]
            },
            "grand_polymath": {
                "history": [
                    {"result": "W", "player_faction": f"Faction_{i}"} for i in range(10)
                ]
            },
            "imperium_crusader": {
                "history": [
                    {"result": "W", "player_faction": "Space Marines"},
                    {"result": "W", "player_faction": "Adeptus Custodes"},
                    {"result": "W", "player_faction": "Astra Militarum"}
                ]
            },
            "chaos_undivided": {
                "history": [
                    {"result": "W", "player_faction": "Chaos Space Marines"},
                    {"result": "W", "player_faction": "Death Guard"}
                ]
            },
            "xenos_overlord": {
                "history": [
                    {"result": "W", "player_faction": "Necrons"},
                    {"result": "W", "player_faction": "Aeldari"},
                    {"result": "W", "player_faction": "Tyranids"}
                ]
            },
            "grand_alliance_sovereign": {
                "player_data": {"wins": 15},
                "history": [
                    {"result": "W", "player_faction": f"Faction_{i}"} for i in range(4)
                ]
            },
            "anti_meta_heretic_1": {
                "history": [{"result": "W", "opponent_faction": "Aeldari"}]
            },
            "anti_meta_heretic_2": {
                "history": [{"result": "W", "opponent_faction": "Necrons"} for _ in range(5)]
            },
            "rogue_paragon": {
                "tournaments": [{"wins": 4, "matches_played": 5, "registered_faction": "Genestealer Cults"}]
            },
            "mirror_initiate": {
                "history": [{"result": "W", "player_faction": "Necrons", "opponent_faction": "Necrons"}]
            },
            "mirror_maestro": {
                "history": [{"result": "W", "player_faction": "Necrons", "opponent_faction": "Necrons"} for _ in range(3)]
            },
            "mirror_sovereign": {
                "history": [{"result": "W", "player_faction": "Necrons", "opponent_faction": "Necrons"} for _ in range(6)]
            },
            "nemesis_neutralizer": {
                "matchup_matrix": [{"opp": f"f_{i}"} for i in range(5)]
            },
            "list_innovator": {
                "history": [{"result": "W", "player_faction": f"Fac_{i}"} for i in range(5)]
            },
            "army_customizer": {
                "player_data": {}
            },
            "codex_purist": {
                "player_data": {"wins": 10}
            },
            "horde_breaker": {
                "history": [{"result": "W", "opponent_faction": "Tyranids"}]
            },
            "monster_hunter": {
                "history": [{"result": "W", "opponent_faction": "Imperial Knights"}]
            },

            # ── Ladder & Elo Milestones (15) ──
            "rank_calibrated": {
                "player_data": {"matches_played": 5}
            },
            "climbing_the_ranks": {
                "player_data": {"peak_elo": 1550.0}
            },
            "veteran_line": {
                "player_data": {"peak_elo": 1650.0}
            },
            "elite_threshold": {
                "player_data": {"peak_elo": 1750.0}
            },
            "master_tier": {
                "player_data": {"peak_elo": 1850.0}
            },
            "grandmaster": {
                "player_data": {"peak_elo": 1950.0}
            },
            "apex_2000": {
                "player_data": {"peak_elo": 2000.0}
            },
            "everchosen_pinnacle": {
                "player_data": {"peak_elo": 2100.0}
            },
            "peak_performer": {
                "player_data": {"peak_elo": 1610.0}
            },
            "streak_of_fire": {
                "player_data": {"longest_win_streak": 4}
            },
            "streak_of_dominance": {
                "player_data": {"longest_win_streak": 8}
            },
            "the_juggernaut": {
                "player_data": {"longest_win_streak": 12}
            },
            "the_immortal_run": {
                "player_data": {"longest_win_streak": 18}
            },
            "top_50_regional": {
                "player_data": {"current_elo": 1710.0}
            },
            "top_10_sovereign": {
                "player_data": {"current_elo": 2055.0}
            },

            # ── Career, Clubs & Secrets (15) ──
            "battle_brother_club": {
                "player_data": {"team": "Iron Hands Syndicate"}
            },
            "squad_leader": {
                "player_data": {"team": "Iron Hands Syndicate", "matches_played": 10}
            },
            "club_vanguard": {
                "player_data": {"team": "Iron Hands Syndicate", "wins": 6, "matches_played": 10, "win_rate": 60.0}
            },
            "local_pillar": {
                "tournaments": [{"event_id": f"ev_{i}"} for i in range(3)]
            },
            "road_warrior": {
                "tournaments": [{"event_id": f"ev_{i}"} for i in range(2)]
            },
            "globetrotter": {
                "tournaments": [{"event_id": f"ev_{i}"} for i in range(5)]
            },
            "rivalry_born": {
                "history": [
                    {"opponent_name": "Inquisitor Gray"},
                    {"opponent_name": "Inquisitor Gray"}
                ]
            },
            "rivalry_veteran": {
                "history": [
                    {"opponent_name": "Inquisitor Gray"} for _ in range(5)
                ]
            },
            "vendetta_broken": {
                "player_data": {"wins": 5},
                "history": [
                    {"opponent_name": "Inquisitor Gray"},
                    {"opponent_name": "Inquisitor Gray"}
                ]
            },
            "veteran_season_1": {
                "player_data": {"matches_played": 15}
            },
            "veteran_long_war": {
                "history": [
                    {"match_date": "2024-05-10"},
                    {"match_date": "2026-06-15"}
                ]
            },
            "dice_gods_wept": {
                "history": [{"result": "W", "player_score": 62, "opponent_score": 58}]
            },
            "narrow_escape": {
                "history": [{"result": "W", "player_score": 76, "opponent_score": 74}]
            },
            "unbroken_bastion": {
                "player_data": {"matches_played": 25}
            },
            "omnitactica_pioneer": {
                "player_data": {}
            }
        }

        self.assertEqual(len(fixtures), 105, "Mock fixtures must cover exactly 105 badges")

        tested_count = 0
        for badge_id, fixture in fixtures.items():
            p_data = fixture.get("player_data", {})
            hist = fixture.get("history", [])
            tourns = fixture.get("tournaments", [])
            f_mast = fixture.get("faction_mastery", [])
            m_mat = fixture.get("matchup_matrix", [])

            res = evaluate_player_badges(
                player_data=p_data,
                history=hist,
                tournaments=tourns,
                faction_mastery=f_mast,
                matchup_matrix=m_mat
            )

            badge_res = next((b for b in res["badges"] if b["id"] == badge_id), None)
            self.assertIsNotNone(badge_res, f"Badge {badge_id} not found in evaluated badges")
            self.assertTrue(
                badge_res["unlocked"],
                f"Badge {badge_id} failed to unlock with mock fixture: {fixture}"
            )
            self.assertIsNotNone(badge_res["progress"], f"Badge {badge_id} missing progress object")
            self.assertGreater(badge_res["glory_points"], 0, f"Badge {badge_id} has 0 glory points")
            tested_count += 1

        self.assertEqual(tested_count, 105, "All 105 badges must be tested and confirmed unlocked")

    def test_strict_boundary_negatives(self):
        """Test boundary conditions to ensure badges do NOT trigger prematurely."""

        # 1. Grand Champion: 4-1 at a GT must NOT trigger Grand Champion
        res = evaluate_player_badges(
            player_data={},
            history=[],
            tournaments=[{"event_id": "gt_1", "wins": 4, "losses": 1, "matches_played": 5}]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["grand_champion"]["unlocked"])
        self.assertTrue(b_map["podium_bronze"]["unlocked"])

        # 2. Super Major Conqueror: 5-0 does NOT trigger (requires 6-0 or streak 8)
        res = evaluate_player_badges(
            player_data={},
            history=[],
            tournaments=[{"event_id": "gt_1", "wins": 5, "losses": 0, "matches_played": 5}]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["super_major_conqueror"]["unlocked"])

        # 3. First Strike: Round 1 win with 84 VP (target is 85) must NOT trigger
        res = evaluate_player_badges(
            player_data={},
            history=[{"result": "W", "round": 1, "player_score": 84, "opponent_score": 40}]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["first_strike"]["unlocked"])

        # 4. Clean Finish: Round 5 win where opponent scores 36 VP (target is <= 35) must NOT trigger
        res = evaluate_player_badges(
            player_data={},
            history=[{"result": "W", "round": 5, "player_score": 80, "opponent_score": 36}]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["clean_finish"]["unlocked"])

        # 5. Blitzkrieg: 39 VP blowout (target is 40) must NOT trigger
        res = evaluate_player_badges(
            player_data={},
            history=[{"result": "W", "player_score": 79, "opponent_score": 40}]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["blitzkrieg"]["unlocked"])

        # 6. Clutch By A Hair: 2 VP diff (target is exactly 1) must NOT trigger
        res = evaluate_player_badges(
            player_data={},
            history=[{"result": "W", "player_score": 72, "opponent_score": 70}]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["clutch_by_a_hair"]["unlocked"])

        # 7. The Photo Finish (narrow_escape): 3 VP difference (target is <= 2) must NOT trigger
        res = evaluate_player_badges(
            player_data={},
            history=[{"result": "W", "player_score": 75, "opponent_score": 72}]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["narrow_escape"]["unlocked"])

        # 8. War of Attrition (dice_gods_wept): Win with 66 VP (target is <= 65) must NOT trigger attrition
        res = evaluate_player_badges(
            player_data={},
            history=[{"result": "W", "player_score": 66, "opponent_score": 60}]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["dice_gods_wept"]["unlocked"])

        # 9. The Alamo: Win with 79-78 (target is both 80+) must NOT trigger shootout
        res = evaluate_player_badges(
            player_data={},
            history=[{"result": "W", "player_score": 79, "opponent_score": 78}]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["the_alamo"]["unlocked"])

        # 10. Flawless Mission: 94 VP (target 95+) must NOT trigger
        res = evaluate_player_badges(
            player_data={},
            history=[{"result": "W", "player_score": 94, "opponent_score": 40}]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["flawless_mission"]["unlocked"])

        # 11. Iron Curtain 1: Opponent 46 VP (target <= 45) must NOT trigger
        res = evaluate_player_badges(
            player_data={},
            history=[{"result": "W", "player_score": 75, "opponent_score": 46}]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["iron_curtain_1"]["unlocked"])

        # 12. Iron Curtain 2: Opponent 31 VP (target <= 30) must NOT trigger
        res = evaluate_player_badges(
            player_data={},
            history=[{"result": "W", "player_score": 75, "opponent_score": 31}]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["iron_curtain_2"]["unlocked"])

        # 13. Giant Slayer 1: +90 Elo opponent (target +100) must NOT trigger
        res = evaluate_player_badges(
            player_data={"current_elo": 1500.0},
            history=[{"result": "W", "opponent_elo": 1590.0, "new_elo": 1515.0, "delta_elo": 15.0}]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["giant_slayer_1"]["unlocked"])

        # 14. Kingslayer: 1990 Elo opponent (target 2000+) must NOT trigger
        res = evaluate_player_badges(
            player_data={},
            history=[{"result": "W", "opponent_elo": 1990.0}]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["kingslayer"]["unlocked"])

        # 15. Horde Breaker: Defeating Space Marines (not swarm) must NOT trigger
        res = evaluate_player_badges(
            player_data={},
            history=[{"result": "W", "opponent_faction": "Space Marines"}]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["horde_breaker"]["unlocked"])

        # 16. Monster Hunter: Defeating Aeldari (not knights) must NOT trigger
        res = evaluate_player_badges(
            player_data={},
            history=[{"result": "W", "opponent_faction": "Aeldari"}]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["monster_hunter"]["unlocked"])

        # 17. Anti-Meta Heretic: Defeating Orks (not meta) must NOT trigger
        res = evaluate_player_badges(
            player_data={},
            history=[{"result": "W", "opponent_faction": "Orks"}]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["anti_meta_heretic_1"]["unlocked"])

        # 18. Mirror Initiate: Different factions must NOT trigger
        res = evaluate_player_badges(
            player_data={},
            history=[{"result": "W", "player_faction": "Necrons", "opponent_faction": "Orks"}]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["mirror_initiate"]["unlocked"])

        # 19. Rivalry Born: 1 encounter must NOT trigger (requires 2+)
        res = evaluate_player_badges(
            player_data={},
            history=[{"opponent_name": "John Doe"}]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["rivalry_born"]["unlocked"])

        # 20. Streak of Fire: Streak of 3 must NOT trigger (requires 4+)
        res = evaluate_player_badges(
            player_data={"longest_win_streak": 3},
            history=[]
        )
        b_map = {b["id"]: b for b in res["badges"]}
        self.assertFalse(b_map["streak_of_fire"]["unlocked"])

    def test_military_ranks_ladder(self):
        """Verify the 7 military ranks compute exactly at their thresholds."""
        expected_ranks = [
            (0, "Initiate"),
            (2, "Initiate"),
            (3, "Battle-Brother"),
            (9, "Battle-Brother"),
            (10, "Centurion"),
            (24, "Centurion"),
            (25, "Force Commander"),
            (44, "Force Commander"),
            (45, "Chapter Master"),
            (69, "Chapter Master"),
            (70, "High Warmaster"),
            (89, "High Warmaster"),
            (90, "Apex Everchosen"),
            (105, "Apex Everchosen")
        ]
        for count, expected_title in expected_ranks:
            rank_info = get_rank_for_badge_count(count)
            self.assertEqual(
                rank_info["title"],
                expected_title,
                f"Count {count} should map to {expected_title}, got {rank_info['title']}"
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
