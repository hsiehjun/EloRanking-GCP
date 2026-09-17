import sys
import unittest
from pathlib import Path
from typing import Dict, Any, List

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

import badges
import aos_badges
from aos_badges import BADGE_CATALOG_AOS, evaluate_aos_player_badges, get_rank_for_badge_count, RANKS_AOS


class TestAllAosBadgesMock(unittest.TestCase):
    """Rigorous mock-driven verification for every single one of the 105 AoS badges."""

    def setUp(self):
        self.catalog = {b["id"]: b for b in BADGE_CATALOG_AOS}
        self.assertEqual(len(self.catalog), 105, "Catalog must contain exactly 105 AoS badges")

    def test_catalog_integrity(self):
        """Verify all 105 AoS badges have required fields, valid rarities, and non-empty descriptions."""
        valid_rarities = {"common", "uncommon", "rare", "epic", "legendary", "mythic"}
        valid_categories = {"tournament", "battlefield", "factions", "ladder", "career"}

        category_counts = {}
        for b in BADGE_CATALOG_AOS:
            self.assertIn("id", b)
            self.assertIn("name", b)
            self.assertIn("category", b)
            self.assertIn("rarity", b)
            self.assertIn("icon", b)
            self.assertIn("description", b)
            self.assertTrue(b["id"].startswith("aos_"), f"AoS badge {b['id']} must start with aos_")
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
        """A brand new AoS player with 0 matches should only unlock founding badges."""
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
        res = badges.evaluate_player_badges(player_data, history=[], tournaments=[], game_system="aos")
        unlocked_ids = {b["id"] for b in res["badges"] if b["unlocked"]}

        self.assertEqual(unlocked_ids, {"aos_omnitactica_pioneer", "aos_army_customizer"})
        self.assertEqual(res["badge_count"], 2)
        self.assertEqual(res["rank"]["title"], "Initiate")

    def test_military_ranks_ladder(self):
        """Verify the 7 AoS military ranks compute exactly at their thresholds."""
        test_cases = [
            (0, "Initiate", 1),
            (2, "Initiate", 1),
            (3, "Liberator", 2),
            (9, "Liberator", 2),
            (10, "Knight-Questor", 3),
            (24, "Knight-Questor", 3),
            (25, "Lord-Celestant", 4),
            (44, "Lord-Celestant", 4),
            (45, "Lord-Commander", 5),
            (69, "Lord-Commander", 5),
            (70, "Warmaster of the Realms", 6),
            (89, "Warmaster of the Realms", 6),
            (90, "Champion of the Gods", 7),
            (105, "Champion of the Gods", 7),
        ]
        for badge_count, expected_title, expected_rank in test_cases:
            rank_data = badges.get_rank_for_badge_count(badge_count, game_system="aos")
            self.assertEqual(rank_data["title"], expected_title, f"Count {badge_count} expected {expected_title}")
            self.assertEqual(rank_data["rank"], expected_rank, f"Count {badge_count} expected rank {expected_rank}")

    def test_strict_boundary_negatives(self):
        """Test boundary conditions to ensure AoS badges do NOT trigger prematurely."""
        # 1. 47 VP does NOT unlock Grand Tacticus (needs 48+)
        res = badges.evaluate_player_badges(
            {}, history=[{"result": "W", "player_score": 47, "opponent_score": 20}], game_system="aos"
        )
        self.assertFalse(any(b["id"] == "aos_grand_tacticus" and b["unlocked"] for b in res["badges"]))

        # 2. Opponent score 21 does NOT unlock Bastion of Shyish I (needs <= 20)
        res = badges.evaluate_player_badges(
            {}, history=[{"result": "W", "player_score": 35, "opponent_score": 21}], game_system="aos"
        )
        self.assertFalse(any(b["id"] == "aos_shyish_bastion_1" and b["unlocked"] for b in res["badges"]))

        # 3. Opponent score 15 does NOT unlock Bastion of Shyish II (needs <= 14)
        res = badges.evaluate_player_badges(
            {}, history=[{"result": "W", "player_score": 35, "opponent_score": 15}], game_system="aos"
        )
        self.assertFalse(any(b["id"] == "aos_shyish_bastion_2" and b["unlocked"] for b in res["badges"]))

        # 4. Opponent score 9 does NOT unlock Starmetal Aegis (needs <= 8)
        res = badges.evaluate_player_badges(
            {}, history=[{"result": "W", "player_score": 35, "opponent_score": 9}], game_system="aos"
        )
        self.assertFalse(any(b["id"] == "aos_star_metal_aegis" and b["unlocked"] for b in res["badges"]))

        # 5. Opponent score 5 does NOT unlock Realm Lockout (needs <= 4)
        res = badges.evaluate_player_badges(
            {}, history=[{"result": "W", "player_score": 35, "opponent_score": 5}], game_system="aos"
        )
        self.assertFalse(any(b["id"] == "aos_realm_lockout" and b["unlocked"] for b in res["badges"]))

        # 6. Win margin 19 does NOT unlock Overwhelming Onslaught (needs 20+)
        res = badges.evaluate_player_badges(
            {}, history=[{"result": "W", "player_score": 39, "opponent_score": 20}], game_system="aos"
        )
        self.assertFalse(any(b["id"] == "aos_realm_conquest" and b["unlocked"] for b in res["badges"]))

        # 7. GT with 174 total battle points does NOT unlock Top Quarter (needs 175+)
        res = badges.evaluate_player_badges(
            {}, history=[], tournaments=[{"wins": 3, "losses": 2, "matches_played": 5, "total_battle_points": 174}], game_system="aos"
        )
        self.assertFalse(any(b["id"] == "aos_top_quarter" and b["unlocked"] for b in res["badges"]))

        # 8. GT with 224 total battle points does NOT unlock Clean Sweep (needs 225+)
        res = badges.evaluate_player_badges(
            {}, history=[], tournaments=[{"wins": 5, "losses": 0, "matches_played": 5, "total_battle_points": 224}], game_system="aos"
        )
        self.assertFalse(any(b["id"] == "aos_clean_sweep" and b["unlocked"] for b in res["badges"]))

        # 9. Win with 31 VP does NOT unlock secret The Dice Gods Wept (needs <= 30)
        res = badges.evaluate_player_badges(
            {}, history=[{"result": "W", "player_score": 31, "opponent_score": 28}], game_system="aos"
        )
        self.assertFalse(any(b["id"] == "aos_dice_gods_wept" and b["unlocked"] for b in res["badges"]))

        # 10. Win by 3 VP does NOT unlock By a Thread or The Deciding Tactic (needs 1 or <= 2 VP)
        res = badges.evaluate_player_badges(
            {}, history=[{"result": "W", "player_score": 35, "opponent_score": 32}], game_system="aos"
        )
        self.assertFalse(any(b["id"] == "aos_clutch_by_a_hair" and b["unlocked"] for b in res["badges"]))
        self.assertFalse(any(b["id"] == "aos_photo_finish" and b["unlocked"] for b in res["badges"]))

        # 11. 3 Grand Alliances won does NOT unlock Realm Ascendant (needs all 4)
        res = badges.evaluate_player_badges(
            {}, history=[
                {"result": "W", "player_faction": "Stormcast Eternals"},
                {"result": "W", "player_faction": "Slaves to Darkness"},
                {"result": "W", "player_faction": "Soulblight Gravelords"}
            ], game_system="aos"
        )
        self.assertTrue(any(b["id"] == "aos_pantheon_master" and b["unlocked"] for b in res["badges"]))
        self.assertFalse(any(b["id"] == "aos_grand_alliance_ascendant" and b["unlocked"] for b in res["badges"]))

    def test_all_105_aos_badges_mock_fixtures(self):
        """Test each of the 105 AoS badges individually with crafted mock telemetry."""

        fixtures: Dict[str, Dict[str, Any]] = {
            # ── Category A: Realm Tournaments (25 Badges) ──
            "aos_first_blood": {
                "player_data": {"wins": 1, "matches_played": 1},
                "history": [{"result": "W", "player_score": 38, "opponent_score": 30, "match_date": "2026-06-01"}]
            },
            "aos_the_debutant": {
                "player_data": {"matches_played": 3},
                "tournaments": [{"event_name": "Aqshy Open", "matches_played": 3}]
            },
            "aos_weekend_warrior": {
                "player_data": {"matches_played": 15},
                "tournaments": [{"event_id": f"aos_gt_{i}", "matches_played": 5} for i in range(3)]
            },
            "aos_campaign_veteran": {
                "player_data": {"matches_played": 50},
                "tournaments": [{"event_id": f"aos_gt_{i}", "matches_played": 5} for i in range(10)]
            },
            "aos_iron_man_1": {
                "tournaments": [{"event_id": "aos_gt_1", "matches_played": 5}]
            },
            "aos_iron_man_2": {
                "tournaments": [{"event_id": f"aos_gt_{i}", "matches_played": 5} for i in range(5)]
            },
            "aos_iron_man_3": {
                "tournaments": [{"event_id": f"aos_gt_{i}", "matches_played": 5} for i in range(10)]
            },
            "aos_positive_ledger": {
                "tournaments": [{"event_id": "aos_gt_1", "wins": 3, "losses": 2, "matches_played": 5}]
            },
            "aos_top_quarter": {
                "tournaments": [{"event_id": "aos_gt_32", "wins": 3, "losses": 2, "matches_played": 5, "total_battle_points": 180}]
            },
            "aos_podium_bronze": {
                "tournaments": [{"event_id": "aos_gt_1", "wins": 4, "losses": 1, "matches_played": 5, "total_battle_points": 210}]
            },
            "aos_podium_silver": {
                "tournaments": [
                    {"event_id": "aos_gt_1", "wins": 4, "losses": 1, "matches_played": 5},
                    {"event_id": "aos_gt_2", "wins": 4, "losses": 1, "matches_played": 5}
                ]
            },
            "aos_grand_champion": {
                "tournaments": [{"event_id": "aos_gt_1", "wins": 5, "losses": 0, "matches_played": 5}]
            },
            "aos_the_undefeated": {
                "player_data": {"longest_win_streak": 5, "wins": 5},
                "tournaments": [{"event_id": "aos_gt_1", "wins": 5, "losses": 0, "matches_played": 5}]
            },
            "aos_super_major_conqueror": {
                "tournaments": [{"event_id": "aos_major_1", "wins": 6, "losses": 0, "matches_played": 6}]
            },
            "aos_double_crown": {
                "player_data": {"longest_win_streak": 10}
            },
            "aos_triple_crown": {
                "tournaments": [
                    {"event_id": f"aos_gt_{i}", "wins": 4, "losses": 1, "matches_played": 5} for i in range(3)
                ]
            },
            "aos_giant_slayer_1": {
                "player_data": {"current_elo": 1500.0},
                "history": [{"result": "W", "opponent_elo": 1620.0, "new_elo": 1515.0, "delta_elo": 15.0}]
            },
            "aos_giant_slayer_2": {
                "player_data": {"current_elo": 1500.0},
                "history": [{"result": "W", "opponent_elo": 1700.0, "new_elo": 1520.0, "delta_elo": 20.0}]
            },
            "aos_giant_slayer_3": {
                "player_data": {"current_elo": 1500.0},
                "history": [{"result": "W", "opponent_elo": 1800.0, "new_elo": 1530.0, "delta_elo": 30.0}]
            },
            "aos_godsbane": {
                "player_data": {"current_elo": 1500.0},
                "history": [{"result": "W", "opponent_elo": 2025.0, "new_elo": 1532.0, "delta_elo": 32.0}]
            },
            "aos_crucible_survivor_1": {
                "history": [
                    {"event_id": "gt_crucible", "round": r, "result": "W" if r <= 3 else "L", "opponent_elo": 1720.0}
                    for r in range(1, 6)
                ]
            },
            "aos_crucible_survivor_2": {
                "history": [
                    {"event_id": "gt_crucible_hard", "round": r, "result": "W" if r <= 4 else "L", "opponent_elo": 1790.0}
                    for r in range(1, 6)
                ]
            },
            "aos_apex_gauntlet": {
                "history": [
                    {"event_id": "gt_apex", "round": r, "result": "W" if r <= 4 else "L", "opponent_elo": 1850.0}
                    for r in range(1, 6)
                ]
            },
            "aos_table_one_resident": {
                "history": [
                    {"event_id": "gt_t1", "round": 1, "result": "W"},
                    {"event_id": "gt_t1", "round": 2, "result": "W"},
                    {"event_id": "gt_t1", "round": 3, "result": "W"}
                ]
            },
            "aos_clean_sweep": {
                "tournaments": [{"event_id": "gt_sweep", "wins": 5, "losses": 0, "matches_played": 5, "total_battle_points": 235}]
            },

            # ── Category B: Mortal Realm Feats (25 Badges) ──
            "aos_realm_marksman": {
                "history": [{"result": "W", "player_score": 36, "opponent_score": 25}]
            },
            "aos_grand_bombardier": {
                "history": [{"result": "W", "player_score": 43, "opponent_score": 20}]
            },
            "aos_grand_tacticus": {
                "history": [{"result": "W", "player_score": 49, "opponent_score": 15}]
            },
            "aos_apex_ascension": {
                "history": [{"result": "W", "player_score": 50, "opponent_score": 12}]
            },
            "aos_shyish_bastion_1": {
                "history": [{"result": "W", "player_score": 35, "opponent_score": 19}]
            },
            "aos_shyish_bastion_2": {
                "history": [{"result": "W", "player_score": 35, "opponent_score": 13}]
            },
            "aos_star_metal_aegis": {
                "history": [{"result": "W", "player_score": 35, "opponent_score": 7}]
            },
            "aos_realm_lockout": {
                "history": [{"result": "W", "player_score": 40, "opponent_score": 3}]
            },
            "aos_clutch_by_a_hair": {
                "history": [{"result": "W", "player_score": 38, "opponent_score": 37}]
            },
            "aos_photo_finish": {
                "history": [{"result": "W", "player_score": 40, "opponent_score": 38}]
            },
            "aos_comeback_1": {
                "history": [{"result": "W", "player_score": 29, "opponent_score": 26}]
            },
            "aos_comeback_2": {
                "history": [
                    {"result": "W", "player_score": 35, "opponent_score": 33},
                    {"result": "W", "player_score": 38, "opponent_score": 36},
                    {"result": "W", "player_score": 40, "opponent_score": 38}
                ]
            },
            "aos_battle_tactic_master": {
                "history": [{"result": "W", "player_score": 42, "opponent_score": 20} for _ in range(10)]
            },
            "aos_celestial_shield": {
                "history": [{"result": "W", "player_score": 35, "opponent_score": 12} for _ in range(5)]
            },
            "aos_grand_strategy_perfection": {
                "history": [{"result": "W", "player_score": 46, "opponent_score": 20} for _ in range(3)]
            },
            "aos_tactical_perfection": {
                "history": [{"result": "W", "player_score": 47, "opponent_score": 22} for _ in range(10)]
            },
            "aos_primary_sovereign": {
                "history": [{"result": "W", "player_score": 38, "opponent_score": 20} for _ in range(15)]
            },
            "aos_flawless_conquest": {
                "history": [{"result": "W", "player_score": 48, "opponent_score": 14}]
            },
            "aos_realm_conquest": {
                "history": [{"result": "W", "player_score": 45, "opponent_score": 22}]
            },
            "aos_against_odds_1": {
                "history": [{"result": "W", "player_score": 35, "opponent_score": 25, "opponent_win_rate": 68.0}]
            },
            "aos_against_odds_2": {
                "history": [{"result": "W", "player_score": 35, "opponent_score": 25, "opponent_win_rate": 78.0}]
            },
            "aos_miracle_conquest": {
                "player_data": {"current_elo": 1500.0},
                "history": [{"result": "W", "player_score": 35, "opponent_score": 20, "opponent_elo": 2050.0, "new_elo": 1535.0, "delta_elo": 35.0}]
            },
            "aos_dead_heat": {
                "player_data": {"draws": 1}
            },
            "aos_first_strike": {
                "history": [{"result": "W", "round": 1, "player_score": 42, "opponent_score": 20}]
            },
            "aos_clean_finish": {
                "history": [{"result": "W", "round": 5, "player_score": 38, "opponent_score": 14}]
            },

            # ── Category C: Grand Alliances & Battletomes (25 Badges) ──
            "aos_cadet_of_army": {
                "player_data": {"wins": 3},
                "faction_mastery": [{"faction": "Stormcast Eternals", "wins": 3, "matches": 3}]
            },
            "aos_faction_veteran": {
                "player_data": {"wins": 10},
                "faction_mastery": [{"faction": "Stormcast Eternals", "wins": 10, "matches": 10}]
            },
            "aos_faction_champion": {
                "player_data": {"wins": 25},
                "faction_mastery": [{"faction": "Stormcast Eternals", "wins": 25, "matches": 25}]
            },
            "aos_warmaster_faction": {
                "player_data": {"wins": 50},
                "faction_mastery": [{"faction": "Stormcast Eternals", "wins": 50, "matches": 50}]
            },
            "aos_grand_sovereign": {
                "player_data": {"wins": 100},
                "faction_mastery": [{"faction": "Stormcast Eternals", "wins": 100, "matches": 100}]
            },
            "aos_pure_specialist": {
                "player_data": {"wins": 16, "matches_played": 20, "win_rate": 80.0},
                "faction_mastery": [{"faction": "Stormcast Eternals", "wins": 16, "matches": 20, "win_rate": 80.0}]
            },
            "aos_polymath_1": {
                "history": [
                    {"result": "W", "player_faction": "Stormcast Eternals"},
                    {"result": "W", "player_faction": "Slaves to Darkness"}
                ]
            },
            "aos_polymath_2": {
                "history": [
                    {"result": "W", "player_faction": "Stormcast Eternals"},
                    {"result": "W", "player_faction": "Slaves to Darkness"},
                    {"result": "W", "player_faction": "Soulblight Gravelords"}
                ]
            },
            "aos_grand_polymath": {
                "history": [
                    {"result": "W", "player_faction": "Stormcast Eternals"},
                    {"result": "W", "player_faction": "Slaves to Darkness"},
                    {"result": "W", "player_faction": "Soulblight Gravelords"},
                    {"result": "W", "player_faction": "Orruk Warclans"},
                    {"result": "W", "player_faction": "Seraphon"}
                ]
            },
            "aos_order_vanguard": {
                "history": [{"result": "W", "player_faction": "Stormcast Eternals"} for _ in range(5)]
            },
            "aos_chaos_warlord": {
                "history": [{"result": "W", "player_faction": "Slaves to Darkness"} for _ in range(5)]
            },
            "aos_death_sovereign": {
                "history": [{"result": "W", "player_faction": "Soulblight Gravelords"} for _ in range(5)]
            },
            "aos_destruction_destroyer": {
                "history": [{"result": "W", "player_faction": "Orruk Warclans"} for _ in range(5)]
            },
            "aos_pantheon_master": {
                "history": [
                    {"result": "W", "player_faction": "Stormcast Eternals"},
                    {"result": "W", "player_faction": "Slaves to Darkness"},
                    {"result": "W", "player_faction": "Soulblight Gravelords"}
                ]
            },
            "aos_grand_alliance_ascendant": {
                "history": [
                    {"result": "W", "player_faction": "Stormcast Eternals"},
                    {"result": "W", "player_faction": "Slaves to Darkness"},
                    {"result": "W", "player_faction": "Soulblight Gravelords"},
                    {"result": "W", "player_faction": "Orruk Warclans"}
                ]
            },
            "aos_anti_meta_heretic_1": {
                "history": [{"result": "W", "player_faction": "Sylvaneth", "opponent_faction": "Stormcast Eternals"}]
            },
            "aos_anti_meta_heretic_2": {
                "history": [{"result": "W", "player_faction": "Sylvaneth", "opponent_faction": "Stormcast Eternals"} for _ in range(5)]
            },
            "aos_mirror_initiate": {
                "history": [{"result": "W", "player_faction": "Stormcast Eternals", "opponent_faction": "Stormcast Eternals"}]
            },
            "aos_mirror_maestro": {
                "history": [{"result": "W", "player_faction": "Stormcast Eternals", "opponent_faction": "Stormcast Eternals"} for _ in range(3)]
            },
            "aos_mirror_sovereign": {
                "history": [{"result": "W", "player_faction": "Stormcast Eternals", "opponent_faction": "Stormcast Eternals"} for _ in range(6)]
            },
            "aos_nemesis_neutralizer": {
                "history": [
                    {"result": "W", "opponent_faction": f"Faction_{i}"} for i in range(5)
                ]
            },
            "aos_army_customizer": {},
            "aos_battletome_purist": {
                "player_data": {"wins": 10},
                "history": [{"result": "W", "player_faction": "Stormcast Eternals"} for _ in range(10)]
            },
            "aos_vermintide_breaker": {
                "history": [{"result": "W", "opponent_faction": "Skaven"}]
            },
            "aos_gargant_slayer": {
                "history": [{"result": "W", "opponent_faction": "Sons of Behemat"}]
            },

            # ── Category D: Realm Ladder & Elo Milestones (15 Badges) ──
            "aos_rank_calibrated": {"player_data": {"matches_played": 5}},
            "aos_climbing_the_ranks": {"player_data": {"current_elo": 1555.0}},
            "aos_veteran_line": {"player_data": {"current_elo": 1655.0}},
            "aos_elite_threshold": {"player_data": {"current_elo": 1755.0}},
            "aos_master_tier": {"player_data": {"current_elo": 1855.0}},
            "aos_grandmaster": {"player_data": {"current_elo": 1955.0}},
            "aos_apex_2000": {"player_data": {"current_elo": 2005.0}},
            "aos_everchosen_pinnacle": {"player_data": {"current_elo": 2105.0}},
            "aos_peak_performer": {"player_data": {"current_elo": 1610.0, "peak_elo": 1610.0}},
            "aos_streak_of_fire": {"player_data": {"longest_win_streak": 4}},
            "aos_streak_of_dominance": {"player_data": {"longest_win_streak": 8}},
            "aos_the_juggernaut": {"player_data": {"longest_win_streak": 12}},
            "aos_the_immortal_run": {"player_data": {"longest_win_streak": 18}},
            "aos_top_50_regional": {"player_data": {"regional_rank": 35}},
            "aos_top_10_sovereign": {"player_data": {"global_rank": 7}},

            # ── Category E: The Chronicler's Ledger & Secrets (15 Badges) ──
            "aos_brother_in_arms": {"player_data": {"team": "Azyr Vanguard"}},
            "aos_host_leader": {"player_data": {"team": "Azyr Vanguard", "matches_played": 10}},
            "aos_club_vanguard": {"player_data": {"team": "Azyr Vanguard", "matches_played": 10, "win_rate": 65.0}},
            "aos_local_pillar": {"tournaments": [{"event_id": f"ev_{i}"} for i in range(3)]},
            "aos_road_warrior": {"history": [{"location": "City_A"}, {"location": "City_B"}]},
            "aos_globetrotter": {"tournaments": [{"event_id": f"ev_{i}"} for i in range(5)]},
            "aos_rivalry_born": {"history": [{"opponent_name": "Rival_A"} for _ in range(2)]},
            "aos_rivalry_veteran": {"history": [{"opponent_name": "Rival_A"} for _ in range(5)]},
            "aos_vendetta_broken": {"player_data": {"wins": 1}, "history": [{"opponent_name": "Rival_A"}, {"opponent_name": "Rival_A", "result": "W"}]},
            "aos_veteran_season_1": {"player_data": {"matches_played": 15}},
            "aos_veteran_long_war": {"history": [{"match_date": "2025-05-01"}, {"match_date": "2026-06-01"}]},
            "aos_dice_gods_wept": {"history": [{"result": "W", "player_score": 28, "opponent_score": 24}]},
            "aos_narrow_escape": {"history": [{"result": "W", "player_score": 35, "opponent_score": 33}]},
            "aos_unbroken_bastion": {"player_data": {"matches_played": 25}},
            "aos_omnitactica_pioneer": {}
        }

        self.assertEqual(len(fixtures), 105, f"Must have exactly 105 fixtures, found {len(fixtures)}")

        for badge_id, fix in fixtures.items():
            res = badges.evaluate_player_badges(
                player_data=fix.get("player_data", {}),
                history=fix.get("history", []),
                tournaments=fix.get("tournaments", []),
                faction_mastery=fix.get("faction_mastery", []),
                matchup_matrix=fix.get("matchup_matrix", []),
                game_system="aos"
            )
            unlocked_map = {b["id"]: b["unlocked"] for b in res["badges"]}
            self.assertTrue(unlocked_map.get(badge_id), f"Badge '{badge_id}' failed to unlock with its mock fixture")


if __name__ == '__main__':
    unittest.main()
