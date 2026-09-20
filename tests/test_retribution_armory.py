"""Comprehensive Backend Unit Tests for Retribution Armory.

Tests multi-system catalog isolation (40K vs AoS), faction avatars, munitorum titles,
player pokes, consumable stacking, prerequisite enforcement, active loadout equipping,
and calibrated Glory Point economic bounds.
"""

import unittest
import armory_catalog


class TestRetributionArmory(unittest.TestCase):

    def setUp(self):
        self.cat_40k = armory_catalog.get_armory_catalog(game_system="40k")
        self.cat_aos = armory_catalog.get_armory_catalog(game_system="aos")

    def test_catalog_structure_and_wings(self):
        """Verifies wings, schema integrity, and absence of removed Adepticon pickem."""
        wings_40k = self.cat_40k["wings"]
        self.assertIn("dice_forge", wings_40k)
        self.assertIn("profile_forge", wings_40k)
        self.assertIn("avatars", wings_40k)
        self.assertIn("titles", wings_40k)
        self.assertIn("pokes", wings_40k)

        # Ensure legacy Adepticon / Oracle pass is completely removed
        self.assertNotIn("oracle", wings_40k)
        self.assertIsNone(armory_catalog.get_item_by_id("oracle_gt_pickem_pass"))

        # Verify items exist: 94 for 40K (including 3 championship unlocks), 66 for AoS = 160 items total
        self.assertEqual(len(self.cat_40k["items"]), 94)
        self.assertEqual(len(self.cat_aos["items"]), 66)
        self.assertEqual(len(self.cat_40k["items"]) + len(self.cat_aos["items"]), 160)

    def test_game_system_isolation(self):
        """Verifies 40K and AoS items are strictly isolated to their own stores."""
        for item in self.cat_40k["items"]:
            self.assertEqual(item.get("game_system"), "40k")

        for item in self.cat_aos["items"]:
            self.assertEqual(item.get("game_system"), "aos")

        # Check specific items do not cross over
        ids_40k = {i["id"] for i in self.cat_40k["items"]}
        ids_aos = {i["id"] for i in self.cat_aos["items"]}
        self.assertIn("avatar_adeptus_astartes", ids_40k)
        self.assertNotIn("avatar_adeptus_astartes", ids_aos)
        self.assertIn("avatar_stormcast_eternals", ids_aos)
        self.assertNotIn("avatar_stormcast_eternals", ids_40k)

    def test_faction_avatars(self):
        """Verifies all 29 40K and 24 AoS faction avatars exist with active_avatar slot."""
        avatars_40k = [i for i in self.cat_40k["items"] if i["wing"] == "avatars"]
        avatars_aos = [i for i in self.cat_aos["items"] if i["wing"] == "avatars"]
        self.assertEqual(len(avatars_40k), 29)
        self.assertEqual(len(avatars_aos), 24)

        astartes = armory_catalog.get_item_by_id("avatar_adeptus_astartes")
        self.assertIsNotNone(astartes)
        self.assertEqual(astartes["slot"], "active_avatar")
        self.assertEqual(astartes["wing"], "avatars")
        self.assertEqual(astartes["payload"]["avatar_icon"], "🦅")
        self.assertEqual(astartes["payload"]["faction"], "Adeptus Astartes")

        stormcast = armory_catalog.get_item_by_id("avatar_stormcast_eternals")
        self.assertIsNotNone(stormcast)
        self.assertEqual(stormcast["slot"], "active_avatar")
        self.assertEqual(stormcast["payload"]["avatar_icon"], "⚡")
        self.assertEqual(stormcast["payload"]["faction"], "Stormcast Eternals")

    def test_faction_dice_custom_six_face(self):
        """Verifies faction dice include authentic colors and vector 6th face metadata."""
        dice_40k = [i for i in self.cat_40k["items"] if i["wing"] == "dice_forge"]
        dice_aos = [i for i in self.cat_aos["items"] if i["wing"] == "dice_forge"]
        self.assertEqual(len(dice_40k), 26)  # 4 standard + 22 faction
        self.assertEqual(len(dice_aos), 21)  # 2 standard + 19 faction

        # Faction dice have six_face_svg_id and six_face_label
        ultra = armory_catalog.get_item_by_id("dice_40k_ultramarines")
        self.assertIsNotNone(ultra)
        self.assertEqual(ultra["payload"]["six_face_svg_id"], "avatar_adeptus_astartes")
        self.assertEqual(ultra["payload"]["six_face_label"], "Imperial Aquila")
        self.assertIn("172554", ultra["payload"]["die_bg"])

        stormcast_dice = armory_catalog.get_item_by_id("dice_aos_stormcast")
        self.assertIsNotNone(stormcast_dice)
        self.assertEqual(stormcast_dice["payload"]["six_face_svg_id"], "avatar_stormcast_eternals")
        self.assertEqual(stormcast_dice["payload"]["six_face_label"], "Twin-Tailed Comet")

    def test_faction_titles(self):
        """Verifies authentic faction titles for 40K and AoS."""
        angel = armory_catalog.get_item_by_id("title_angel_of_death")
        self.assertIsNotNone(angel)
        self.assertEqual(angel["slot"], "active_title")
        self.assertEqual(angel["payload"]["title_text"], "Angel of Death")

        phaeron = armory_catalog.get_item_by_id("title_phaeron")
        self.assertIsNotNone(phaeron)
        self.assertEqual(phaeron["payload"]["title_text"], "Phaeron of the Infinite")

        celestant = armory_catalog.get_item_by_id("title_lord_celestant")
        self.assertIsNotNone(celestant)
        self.assertEqual(celestant["payload"]["title_text"], "Lord-Celestant")

    def test_player_pokes(self):
        """Verifies interactive consumable pokes in 5-packs."""
        smite = armory_catalog.get_item_by_id("poke_inquisition_smite")
        self.assertIsNotNone(smite)
        self.assertTrue(smite["is_consumable"])
        self.assertEqual(smite["bundle_count"], 5)
        self.assertEqual(smite["cost_glory"], 300)
        self.assertIn("⚡", smite["payload"]["toast_message"])

        waaagh = armory_catalog.get_item_by_id("poke_waaagh_club")
        self.assertIsNotNone(waaagh)
        self.assertEqual(waaagh["bundle_count"], 5)

        squig = armory_catalog.get_item_by_id("poke_squig_nibble")
        self.assertIsNotNone(squig)
        self.assertEqual(squig["bundle_count"], 5)

    def test_ownership_and_equipped_loadout(self):
        """Verifies vault ownership and active loadout flags including active_avatar."""
        mock_vault = {
            "inventory": {
                "dice_warpfire_plasma": {"acquired_at": "2026-09-18T00:00:00Z"},
                "avatar_adeptus_astartes": {"acquired_at": "2026-09-18T00:00:00Z"},
                "poke_inquisition_smite": {"acquired_at": "2026-09-18T00:00:00Z", "quantity": 5}
            },
            "equipped": {
                "active_dice": "dice_warpfire_plasma",
                "active_card_frame": None,
                "active_title": None,
                "active_avatar": "avatar_adeptus_astartes"
            }
        }
        cat = armory_catalog.get_armory_catalog(user_vault=mock_vault, user_crest_tier=5, game_system="40k")

        dice = next(i for i in cat["items"] if i["id"] == "dice_warpfire_plasma")
        self.assertTrue(dice["is_owned"])
        self.assertTrue(dice["is_equipped"])

        avatar = next(i for i in cat["items"] if i["id"] == "avatar_adeptus_astartes")
        self.assertTrue(avatar["is_owned"])
        self.assertTrue(avatar["is_equipped"])

        poke = next(i for i in cat["items"] if i["id"] == "poke_inquisition_smite")
        self.assertTrue(poke["is_owned"])
        self.assertEqual(poke.get("charges_remaining"), 5)

    def test_game_specific_loadout_isolation(self):
        """Verifies loadouts are strictly partitioned per game system without crossover."""
        mock_vault = {
            "inventory": {
                "dice_40k_ultramarines": {"acquired_at": "2026-09-18T00:00:00Z"},
                "dice_aos_stormcast": {"acquired_at": "2026-09-18T00:00:00Z"},
                "avatar_adeptus_astartes": {"acquired_at": "2026-09-18T00:00:00Z"},
                "avatar_stormcast_eternals": {"acquired_at": "2026-09-18T00:00:00Z"},
            },
            "equipped": {
                "40k": {
                    "active_dice": "dice_40k_ultramarines",
                    "active_avatar": "avatar_adeptus_astartes",
                    "active_title": None,
                    "active_card_frame": None,
                },
                "aos": {
                    "active_dice": "dice_aos_stormcast",
                    "active_avatar": "avatar_stormcast_eternals",
                    "active_title": None,
                    "active_card_frame": None,
                }
            }
        }
        cat_40k = armory_catalog.get_armory_catalog(user_vault=mock_vault, game_system="40k")
        cat_aos = armory_catalog.get_armory_catalog(user_vault=mock_vault, game_system="aos")

        ultra_40k = next(i for i in cat_40k["items"] if i["id"] == "dice_40k_ultramarines")
        self.assertTrue(ultra_40k["is_equipped"])

        storm_aos = next(i for i in cat_aos["items"] if i["id"] == "dice_aos_stormcast")
        self.assertTrue(storm_aos["is_equipped"])

    def test_glory_economy_calibration(self):
        """Verifies calibrated pricing model balances veteran bank against annual accrual."""
        all_items = self.cat_40k["items"] + self.cat_aos["items"]
        for item in all_items:
            wing = item["wing"]
            cost = item["cost_glory"]
            if cost == 0:
                # Championship victory unlocks are free prestige rewards
                self.assertTrue(bool(item.get("prerequisite", {}).get("championship_gt") or item.get("prerequisite", {}).get("championship_major")))
                continue
            if wing == "pokes":
                self.assertGreaterEqual(cost, 300)
                self.assertLessEqual(cost, 1500)
            elif wing == "avatars":
                self.assertGreaterEqual(cost, 1100)
                self.assertLessEqual(cost, 1900)
            elif wing == "titles":
                self.assertGreaterEqual(cost, 1000)
                self.assertLessEqual(cost, 2900)
            elif wing == "dice_forge":
                self.assertGreaterEqual(cost, 1500)
                self.assertLessEqual(cost, 3300)
            elif wing == "profile_forge":
                self.assertGreaterEqual(cost, 900)
                self.assertLessEqual(cost, 9700)

    def test_peak_elo_frame_prerequisites(self):
        """Verifies frames lock and unlock dynamically based on all-time career peak Elo."""
        # 1. Novice player at 1500 Peak Elo
        cat_1500 = armory_catalog.get_armory_catalog(user_crest_tier=1, game_system="40k", user_peak_elo=1500.0)
        items_1500 = {i["id"]: i for i in cat_1500["items"]}
        self.assertTrue(items_1500["frame_peak_veteran"]["meets_prerequisite"])
        self.assertFalse(items_1500["frame_peak_captain"]["meets_prerequisite"])
        self.assertFalse(items_1500["frame_peak_grand_marshal"]["meets_prerequisite"])
        self.assertIn("Requires All-Time Peak Elo 1600+", items_1500["frame_peak_captain"]["prerequisite_reason"])

        # 2. Seasoned Competitor at 1890 Peak Elo (Like Innes Wilson)
        cat_1890 = armory_catalog.get_armory_catalog(user_crest_tier=5, game_system="40k", user_peak_elo=1890.0)
        items_1890 = {i["id"]: i for i in cat_1890["items"]}
        self.assertTrue(items_1890["frame_peak_veteran"]["meets_prerequisite"])
        self.assertTrue(items_1890["frame_peak_captain"]["meets_prerequisite"])
        self.assertTrue(items_1890["frame_peak_commander"]["meets_prerequisite"])
        self.assertTrue(items_1890["frame_peak_dark_angels"]["meets_prerequisite"])
        self.assertTrue(items_1890["frame_peak_necrons"]["meets_prerequisite"])
        self.assertTrue(items_1890["frame_peak_grand_marshal"]["meets_prerequisite"])
        self.assertTrue(items_1890["frame_peak_high_warlord"]["meets_prerequisite"])
        # Locked: 1900, 2000, 2200
        self.assertFalse(items_1890["frame_peak_warmaster"]["meets_prerequisite"])
        self.assertFalse(items_1890["frame_peak_primarch"]["meets_prerequisite"])
        self.assertFalse(items_1890["frame_peak_everchosen"]["meets_prerequisite"])
        self.assertIn("Requires All-Time Peak Elo 1900+", items_1890["frame_peak_warmaster"]["prerequisite_reason"])
        self.assertIn("Requires All-Time Peak Elo 2000+", items_1890["frame_peak_primarch"]["prerequisite_reason"])

        # 3. Apex Everchosen at 2250 Peak Elo
        cat_2250 = armory_catalog.get_armory_catalog(user_crest_tier=7, game_system="40k", user_peak_elo=2250.0)
        items_2250 = {i["id"]: i for i in cat_2250["items"]}
        self.assertTrue(items_2250["frame_peak_everchosen"]["meets_prerequisite"])

    def test_trophy_glory_accumulation_and_wallet_sync(self):
        """Verifies that unlocking new badges/trophies accumulates Glory and syncs into spendable wallet."""
        import badges
        from unittest.mock import MagicMock
        from routers.armory import _calculate_user_glory_state

        # 1. Base player with pioneer badge only (Common: 10 glory)
        base_player = {"player_id": "p_test_competitor", "player_name": "Test Competitor", "current_elo": 1750.0, "peak_elo": 1750.0}
        eval_base = badges.evaluate_player_badges(player_data=base_player, history=[], tournaments=[], game_system="40k")
        base_glory = eval_base["glory_score"]
        self.assertGreaterEqual(base_glory, 10)

        # 2. Player accomplishes new milestone: 5 tournament matches (unlocks First Blood & Veteran Campaigner)
        matches = [
            {"match_date": f"2026-05-0{i}", "result": "W", "round": i, "player_score": 85, "opponent_score": 60, "event_name": "GT 2026"}
            for i in range(1, 6)
        ]
        eval_advanced = badges.evaluate_player_badges(player_data=base_player, history=matches, tournaments=[{"event_name": "GT 2026", "rounds": 5}], game_system="40k")
        advanced_glory = eval_advanced["glory_score"]

        # Earning new trophies MUST strictly accumulate glory honor points
        self.assertGreater(advanced_glory, base_glory)
        glory_delta = advanced_glory - base_glory
        self.assertGreater(glory_delta, 0)

        # 3. Verify _calculate_user_glory_state syncs newly earned points into user_data
        mock_auth = MagicMock()
        mock_auth.get_user_competitor_hub.return_value = {
            "glory_40k": advanced_glory,
            "glory_aos": 0,
            "unified_glory": advanced_glory,
            "total_glory": advanced_glory,
            "glory_balance": advanced_glory,
            "rank": {"rank": 3},
            "player": {"peak_elo": 1750.0}
        }
        mock_auth.db = None  # in-memory test

        user_record = {
            "id": "u_test_competitor",
            "player_id": "p_test_competitor",
            "total_glory": base_glory,
            "glory_spent": 50,
            "glory_balance": max(0, base_glory - 50)
        }
        state = _calculate_user_glory_state(mock_auth, user_record)

        # Newly earned trophy glory must be reflected in total_earned and spendable_glory
        self.assertEqual(state["total_earned"], advanced_glory)
        self.assertEqual(state["glory_spent"], 50)
        self.assertEqual(state["spendable_glory"], advanced_glory - 50)
        self.assertEqual(user_record["total_glory"], advanced_glory)
        self.assertEqual(user_record["glory_balance"], advanced_glory - 50)

    def test_equipped_cosmetics_persistence_across_profiles(self):
        """Verifies equipped cosmetic loadouts persist and are returned in profile payloads."""
        # Check vault loadout schema
        user_vault = {
            "inventory": {
                "frame_astral_holofoil": {"acquired_at": "2026-09-19T00:00:00Z"},
                "title_unbroken": {"acquired_at": "2026-09-19T00:00:00Z"},
                "avatar_necrons": {"acquired_at": "2026-09-19T00:00:00Z"}
            },
            "equipped": {
                "40k": {
                    "active_dice": None,
                    "active_card_frame": "frame_astral_holofoil",
                    "active_title": "title_unbroken",
                    "active_avatar": "avatar_necrons"
                },
                "active_card_frame": "frame_astral_holofoil",
                "active_title": "title_unbroken",
                "active_avatar": "avatar_necrons"
            }
        }
        cat = armory_catalog.get_armory_catalog(user_vault=user_vault, game_system="40k")
        equipped_items = [i for i in cat["items"] if i.get("is_equipped")]
        equipped_ids = {i["id"] for i in equipped_items}

        self.assertIn("frame_astral_holofoil", equipped_ids)
        self.assertIn("title_unbroken", equipped_ids)
        self.assertIn("avatar_necrons", equipped_ids)

        # Ensure alias resolution works for both old and new sigil/grid identifiers
        self.assertEqual(armory_catalog.get_item_by_id("avatar_sigil_necron")["id"], "avatar_necrons")
        self.assertEqual(armory_catalog.get_item_by_id("avatar_sigil_tau")["id"], "avatar_tau_empire")
        self.assertEqual(armory_catalog.get_item_by_id("frame_cyber_grid")["id"], "frame_cyber_matrix")

    def test_tournament_championships_detection_and_glory_bounties(self):
        """Verifies tournament wins are extracted by tier, award correct Glory bounties, and auto-unlock Armory rewards."""
        import badges
        tournaments = [
            {
                "event_id": "ev_lvo_2026",
                "event_name": "LVO 2026 Super Major Champs",
                "total_players": 256,
                "num_rounds": 8,
                "placement": 1,
                "wins": 8,
                "losses": 0,
                "draws": 0,
                "registered_faction": "Adeptus Custodes",
                "event_date": "2026-01-20"
            },
            {
                "event_id": "ev_tacoma_2026",
                "event_name": "US Open Tacoma Major",
                "total_players": 128,
                "num_rounds": 7,
                "placement": 1,
                "wins": 7,
                "losses": 0,
                "draws": 0,
                "registered_faction": "Adeptus Custodes",
                "event_date": "2026-09-02"
            },
            {
                "event_id": "ev_pnw_gt_2026",
                "event_name": "Pacific Northwest GT",
                "total_players": 56,
                "num_rounds": 5,
                "placement": 1,
                "wins": 5,
                "losses": 0,
                "draws": 0,
                "registered_faction": "Necrons",
                "event_date": "2026-06-15"
            },
            {
                "event_id": "ev_dicehead_rtt_2026",
                "event_name": "Dicehead Spring RTT",
                "total_players": 24,
                "num_rounds": 3,
                "placement": 1,
                "wins": 3,
                "losses": 0,
                "draws": 0,
                "registered_faction": "Space Marines",
                "event_date": "2026-03-22"
            }
        ]

        champs = badges.extract_tournament_championships(tournaments, [], "40k")
        self.assertEqual(champs["total"], 4)
        self.assertEqual(champs["major_wins"], 2)  # 1 Super Major + 1 Major
        self.assertEqual(champs["gt_wins"], 1)
        self.assertEqual(champs["rtt_wins"], 1)

        # Expected glory: 3000 (Super) + 1250 (Major) + 500 (GT) + 150 (RTT) = 4900 Glory
        self.assertEqual(champs["championship_glory"], 4900)
        self.assertIn("4x Champion", champs["championship_pill"])

        # Check full badge evaluation accrues championship glory into wallet
        player_mock = {"player_id": "p_champion", "player_name": "Tournament Champion", "current_elo": 2050.0}
        eval_res = badges.evaluate_player_badges(player_data=player_mock, history=[], tournaments=tournaments, game_system="40k")

        self.assertGreaterEqual(eval_res["glory_score"], 4900)
        self.assertEqual(eval_res["championship_glory"], 4900)
        self.assertEqual(eval_res["championships"]["total"], 4)

        # Verify Armory auto-unlocks GT/Major victory rewards for this champion
        cat = armory_catalog.get_armory_catalog(user_vault={"inventory": {}, "equipped": {}}, user_crest_tier=6, game_system="40k", user_peak_elo=2050.0, user_championships=champs)
        items_by_id = {i["id"]: i for i in cat["items"]}

        # GT Champion title & Major Conqueror title & Champion Laurel Frame must be owned
        self.assertTrue(items_by_id["title_gt_champion"]["is_owned"])
        self.assertTrue(items_by_id["title_gt_champion"]["meets_prerequisite"])
        self.assertTrue(items_by_id["title_major_conqueror"]["is_owned"])
        self.assertTrue(items_by_id["frame_champion_laurel"]["is_owned"])


if __name__ == "__main__":
    unittest.main()
