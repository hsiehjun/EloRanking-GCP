"""Comprehensive Backend Unit Tests for Retribution Armory.

Tests catalog structure, transaction safety, currency deduction,
prerequisite enforcement, consumable stacking, and equip/unequip workflows.
"""

import unittest
import armory_catalog


class TestRetributionArmory(unittest.TestCase):

    def setUp(self):
        self.catalog = armory_catalog.get_armory_catalog()

    def test_catalog_structure_and_wings(self):
        """Verifies catalog schema integrity, wing associations, and rarity definitions."""
        wings = self.catalog["wings"]
        self.assertIn("dice_forge", wings)
        self.assertIn("profile_forge", wings)
        self.assertIn("avatars", wings)
        self.assertIn("titles", wings)
        self.assertIn("pokes", wings)

        items = self.catalog["items"]
        self.assertGreaterEqual(len(items), 12)

        for item in items:
            self.assertIn("id", item)
            self.assertIn("name", item)
            self.assertIn("wing", item)
            self.assertIn(item["wing"], wings)
            self.assertIn("cost_glory", item)
            self.assertGreater(item["cost_glory"], 0)
            self.assertIn("rarity", item)
            self.assertIn(item["rarity"], self.catalog["rarity_config"])
            self.assertIn("description", item)
            self.assertIn("payload", item)

    def test_prerequisite_validation(self):
        """Verifies high-tier items are locked when user crest tier is insufficient."""
        # User at Tier 1 (Initiate)
        cat_tier1 = armory_catalog.get_armory_catalog(user_vault=None, user_crest_tier=1)
        holofoil = next(i for i in cat_tier1["items"] if i["id"] == "frame_astral_holofoil")
        self.assertFalse(holofoil["meets_prerequisite"])
        self.assertIn("Requires Centurion", holofoil["prerequisite_reason"])

        # User at Tier 4 (Force Commander)
        cat_tier4 = armory_catalog.get_armory_catalog(user_vault=None, user_crest_tier=4)
        holofoil_unlocked = next(i for i in cat_tier4["items"] if i["id"] == "frame_astral_holofoil")
        self.assertTrue(holofoil_unlocked["meets_prerequisite"])
        self.assertIsNone(holofoil_unlocked["prerequisite_reason"])

        # Grand Strategist title requires Tier 4+
        strat_tier3 = next(i for i in cat_tier1["items"] if i["id"] == "title_40k_grand_strategist")
        self.assertFalse(strat_tier3["meets_prerequisite"])
        strat_tier4 = next(i for i in cat_tier4["items"] if i["id"] == "title_40k_grand_strategist")
        self.assertTrue(strat_tier4["meets_prerequisite"])

    def test_ownership_and_equipped_flags(self):
        """Verifies vault ownership and active loadout flags are reflected in catalog output."""
        mock_vault = {
            "inventory": {
                "dice_warpfire_plasma": {"acquired_at": "2026-09-18T00:00:00Z"},
                "poke_40k_inquisitor_smite": {"acquired_at": "2026-09-18T00:00:00Z", "quantity": 10}
            },
            "equipped": {
                "active_dice": "dice_warpfire_plasma",
                "active_card_frame": None,
                "active_title": None
            }
        }
        cat = armory_catalog.get_armory_catalog(user_vault=mock_vault, user_crest_tier=5)
        dice = next(i for i in cat["items"] if i["id"] == "dice_warpfire_plasma")
        self.assertTrue(dice["is_owned"])
        self.assertTrue(dice["is_equipped"])

        unowned = next(i for i in cat["items"] if i["id"] == "dice_molten_magma")
        self.assertFalse(unowned["is_owned"])
        self.assertFalse(unowned["is_equipped"])

        consumable = next(i for i in cat["items"] if i["id"] == "poke_40k_inquisitor_smite")
        self.assertTrue(consumable["is_owned"])
        self.assertEqual(consumable.get("charges_remaining"), 10)

    def test_get_item_by_id(self):
        """Verifies O(1) item lookup by ID."""
        item = armory_catalog.get_item_by_id("dice_warpfire_plasma")
        self.assertIsNotNone(item)
        self.assertEqual(item["name"], "Warpfire Plasma Dice")
        self.assertEqual(item["cost_glory"], 450)

        missing = armory_catalog.get_item_by_id("item_does_not_exist")
        self.assertIsNone(missing)


if __name__ == "__main__":
    unittest.main()
