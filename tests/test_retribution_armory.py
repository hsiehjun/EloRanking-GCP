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

        # Verify items exist: 86 for 40K, 61 for AoS = 147 items total
        self.assertEqual(len(self.cat_40k["items"]), 86)
        self.assertEqual(len(self.cat_aos["items"]), 61)
        self.assertEqual(len(self.cat_40k["items"]) + len(self.cat_aos["items"]), 147)

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
        self.assertEqual(smite["cost_glory"], 50)
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
            if wing == "pokes":
                self.assertEqual(cost, 50)
            elif wing == "avatars":
                self.assertGreaterEqual(cost, 350)
                self.assertLessEqual(cost, 500)
            elif wing == "titles":
                self.assertGreaterEqual(cost, 300)
                self.assertLessEqual(cost, 650)
            elif wing == "dice_forge":
                self.assertGreaterEqual(cost, 550)
                self.assertLessEqual(cost, 950)
            elif wing == "profile_forge":
                self.assertGreaterEqual(cost, 250)
                self.assertLessEqual(cost, 3500)

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


if __name__ == "__main__":
    unittest.main()
