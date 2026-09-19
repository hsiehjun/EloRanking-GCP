"""Comprehensive Backend Unit Tests for Retribution Armory.

Tests multi-system catalog isolation (40K vs AoS), faction avatars, munitorum titles,
player pokes, consumable stacking, prerequisite enforcement, and active loadout equipping.
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

        # Verify items exist
        self.assertEqual(len(self.cat_40k["items"]), 44)
        self.assertEqual(len(self.cat_aos["items"]), 15)

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
        """Verifies faction avatars across 40K and AoS with slot active_avatar."""
        astartes = armory_catalog.get_item_by_id("avatar_adeptus_astartes")
        self.assertIsNotNone(astartes)
        self.assertEqual(astartes["slot"], "active_avatar")
        self.assertEqual(astartes["wing"], "avatars")
        self.assertEqual(astartes["payload"]["avatar_icon"], "🛡️")

        stormcast = armory_catalog.get_item_by_id("avatar_stormcast_eternals")
        self.assertIsNotNone(stormcast)
        self.assertEqual(stormcast["slot"], "active_avatar")
        self.assertEqual(stormcast["payload"]["avatar_icon"], "🔨")

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
        self.assertEqual(smite["cost_glory"], 25)
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
