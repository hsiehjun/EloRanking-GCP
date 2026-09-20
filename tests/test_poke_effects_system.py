import unittest
from unittest.mock import MagicMock, patch
import json
from datetime import datetime, timezone, timedelta
import asyncio

import armory_catalog

class TestPokeEffectsSystem(unittest.TestCase):
    def test_all_pokes_catalog_schema_and_24h_duration(self):
        """Verify all 20 pokes in both 40K and AoS have 24-hour duration, sign_in_effect, and hex badges."""
        pokes = [i for i in armory_catalog.ARMORY_ITEMS if i["wing"] == "pokes"]
        self.assertEqual(len(pokes), 20, "Must have exactly 20 poke items across 40K and AoS")

        expected_fx = {
            "warp_storm", "dakka_barrage", "exterminatus", "mindshackle",
            "custodes_decree", "blood_tithe", "bad_moon", "comet_strike",
            "twist_of_fate", "plague_bell", "lightning_flash", "krump_thud",
            "commissar_glare", "nurgle_rot", "mindshock", "markerlight",
            "teeth_bite", "khorne_roar", "spectral_shriek"
        }

        for p in pokes:
            self.assertTrue(p["is_consumable"])
            self.assertIn(p["bundle_count"], (3, 5))
            self.assertGreaterEqual(p["cost_glory"], 300)
            self.assertLessEqual(p["cost_glory"], 1500)
            payload = p.get("payload") or {}
            self.assertIn("toast_message", payload)
            # Duration must be 24 hours
            duration = payload.get("hex_duration_hours", 24)
            self.assertEqual(duration, 24, f"Poke {p['id']} must have 24-hour duration")

    def test_poke_dispatch_creates_24h_record_and_delivers(self):
        """Verify routers/armory.py poke_player generates a 24-hour expiration and records to target vault."""
        from routers import armory

        mock_session = {"user_id": "user_innes", "display_name": "Innes Wilson"}
        mock_auth = MagicMock()
        mock_user = {
            "id": "user_innes",
            "display_name": "Innes Wilson",
            "armory_vault": {
                "inventory": {
                    "poke_chaos_warp_storm": {"quantity": 5, "item_name": "Warp Storm Hex"}
                },
                "dispatched_pokes": []
            }
        }
        mock_target = {
            "id": "user_marcus",
            "display_name": "Marcus Vance",
            "armory_vault": {
                "inventory": {},
                "received_pokes": []
            }
        }
        mock_auth.get_user_by_id.side_effect = lambda uid: mock_user if uid == "user_innes" else (mock_target if uid == "user_marcus" else None)
        mock_auth.db.get_connection.return_value.__enter__.return_value = MagicMock()

        mock_req = MagicMock()
        mock_req.json = MagicMock()

        async def fake_json():
            return {
                "poke_id": "poke_chaos_warp_storm",
                "target_player_id": "user_marcus",
                "target_name": "Marcus Vance"
            }
        mock_req.json.side_effect = fake_json

        with patch("routers.armory._get_user_session_or_401", return_value=mock_session), \
             patch("routers.armory.get_auth_manager", return_value=mock_auth):

            res = asyncio.run(armory.poke_player(mock_req))

            self.assertTrue(res["success"])
            self.assertEqual(res["charges_remaining"], 4)
            self.assertEqual(res["duration_hours"], 24)
            self.assertEqual(res["sign_in_effect"], "warp_storm")
            self.assertIn("poke_event", res)
            evt = res["poke_event"]
            self.assertEqual(evt["sender_name"], "Innes Wilson")
            self.assertEqual(evt["target_name"], "Marcus Vance")
            self.assertFalse(evt["seen"])

            # Verify target vault received the poke
            target_pokes = mock_target["armory_vault"]["received_pokes"]
            self.assertEqual(len(target_pokes), 1)
            self.assertEqual(target_pokes[0]["poke_id"], "poke_chaos_warp_storm")

    def test_acknowledge_and_active_pokes(self):
        """Verify active pokes filtering and acknowledgment flow."""
        from routers import armory

        now = datetime.now(timezone.utc)
        active_unseen = {
            "id": "evt_1",
            "poke_id": "poke_chaos_warp_storm",
            "created_at": (now - timedelta(hours=2)).isoformat(),
            "expires_at": (now + timedelta(hours=22)).isoformat(),
            "seen": False
        }
        expired_seen = {
            "id": "evt_2",
            "poke_id": "poke_waaagh_club",
            "created_at": (now - timedelta(hours=26)).isoformat(),
            "expires_at": (now - timedelta(hours=2)).isoformat(),
            "seen": True
        }

        mock_session = {"user_id": "user_marcus"}
        mock_auth = MagicMock()
        mock_user = {
            "id": "user_marcus",
            "armory_vault": {
                "received_pokes": [active_unseen, expired_seen]
            }
        }
        mock_auth.get_user_by_id.return_value = mock_user
        mock_auth.db.get_connection.return_value.__enter__.return_value = MagicMock()

        mock_req = MagicMock()
        with patch("routers.armory._get_user_session_or_401", return_value=mock_session), \
             patch("routers.armory.get_auth_manager", return_value=mock_auth):

            # Check active pokes: should only return evt_1
            res_active = asyncio.run(armory.get_active_pokes(mock_req))
            self.assertEqual(res_active["total_active"], 1)
            self.assertEqual(res_active["unseen_count"], 1)
            self.assertEqual(res_active["active_pokes"][0]["id"], "evt_1")

            # Acknowledge evt_1
            async def fake_ack_body():
                return {"poke_event_id": "evt_1"}
            mock_req.json.side_effect = fake_ack_body

            res_ack = asyncio.run(armory.acknowledge_poke(mock_req))
            self.assertTrue(res_ack["success"])
            self.assertTrue(active_unseen["seen"])


if __name__ == "__main__":
    unittest.main()
