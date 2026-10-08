import asyncio
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from firestore_db import get_firestore_engine
import bcp_adapter
from routers.auth import api_user_registered_tournaments
from routers.eventstudio import (
    api_get_active_event_announcements,
    api_get_event_to_hub_state,
    api_publish_event_to_hub_announcement,
    api_clear_event_to_hub_announcement,
    api_save_event_to_hub_news_post,
    api_delete_event_to_hub_news_post,
    ToHubAnnouncementPayload,
    ToHubNewsPostPayload,
)


class ToHubAndHostedEventsTest(unittest.TestCase):
    def setUp(self):
        self.test_event_id = "test_real_bcp_event_7ohG0RuDqC1k"
        self.fs = get_firestore_engine()
        self.fs.clear_tournament_broadcast(self.test_event_id)

    def tearDown(self):
        self.fs.clear_tournament_broadcast(self.test_event_id)

    def test_to_hub_state_announcements_news_and_performance(self):
        t0 = time.perf_counter()
        data = api_get_event_to_hub_state(self.test_event_id)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        self.assertLess(elapsed_ms, 50.0, f"GET /to-hub took {elapsed_ms:.1f}ms (> 50ms)")
        self.assertEqual(data["event_id"], self.test_event_id)
        self.assertIn("news_posts", data)
        self.assertIn("judge_calls", data)

        # Publish app-wide event announcement banner
        pub_json = api_publish_event_to_hub_announcement(
            self.test_event_id,
            ToHubAnnouncementPayload(
                message="Round 2 Pairings are LIVE! Report to your assigned table.",
                level="warning",
                author_name="Chief TO",
            ),
        )
        self.assertTrue(pub_json["ok"])
        self.assertEqual(
            pub_json["active_broadcast"]["message"],
            "Round 2 Pairings are LIVE! Report to your assigned table.",
        )

        # Query active announcements endpoint (used by Global Banner)
        t1 = time.perf_counter()
        act_res = api_get_active_event_announcements(event_ids=self.test_event_id)
        act_ms = (time.perf_counter() - t1) * 1000.0
        self.assertLess(act_ms, 50.0)
        act_list = act_res.get("announcements", [])
        self.assertEqual(len(act_list), 1)
        self.assertEqual(act_list[0]["event_id"], self.test_event_id)
        self.assertEqual(act_list[0]["level"], "warning")

        # Create a News Post for the public News & Info tab
        news_res = api_save_event_to_hub_news_post(
            self.test_event_id,
            ToHubNewsPostPayload(
                title="Round 2 Mission: Take and Hold (Search & Destroy)",
                body="Terrain Layout #1 is in effect for all tables.",
                category="mission",
                pinned=True,
                author="Chief TO",
            ),
        )
        self.assertTrue(news_res["ok"])
        post_obj = news_res["post"]
        self.assertEqual(post_obj["category"], "mission")
        self.assertTrue(post_obj["pinned"])
        post_id = post_obj["id"]

        # Verify state reflects both active broadcast and news post
        state_res = api_get_event_to_hub_state(self.test_event_id)
        self.assertIsNotNone(state_res["active_broadcast"])
        self.assertTrue(any(p["id"] == post_id for p in state_res["news_posts"]))

        # Delete the news post
        del_res = api_delete_event_to_hub_news_post(self.test_event_id, post_id)
        self.assertTrue(del_res["ok"])

        # Clear active broadcast
        clr_res = api_clear_event_to_hub_announcement(self.test_event_id)
        self.assertTrue(clr_res["ok"])
        act_after = api_get_active_event_announcements(event_ids=self.test_event_id)
        self.assertEqual(len(act_after.get("announcements", [])), 0)

    def test_bcp_hosted_events_and_registered_endpoint(self):
        bcp_adapter.BcpAdapter._last_hosted_events_by_user = {
            "u_to_1": [
                {
                    "event_id": "7ohG0RuDqC1k",
                    "event_name": "Try Hard - 40K RTT",
                    "event_date": "2025-11-23T08:00:00.000Z",
                    "is_hosted": True,
                    "is_owner": True,
                    "organizer_role": "Event Owner",
                }
            ]
        }
        cached = bcp_adapter.BcpAdapter.get_user_hosted_events_cached("u_to_1")
        self.assertEqual(len(cached), 1)
        self.assertEqual(cached[0]["event_id"], "7ohG0RuDqC1k")
        self.assertTrue(cached[0]["is_hosted"])

        mock_db = MagicMock()
        mock_db.get_user_registered_tournaments.return_value = [
            {
                "id": "ES-play-1",
                "event_id": "ES-play-1",
                "event_name": "Las Vegas Open",
                "event_date": "2027-11-01",
            }
        ]
        mock_db.get_user_hosted_tournaments.return_value = [
            {
                "id": "7ohG0RuDqC1k",
                "event_id": "7ohG0RuDqC1k",
                "event_name": "Try Hard - 40K RTT",
                "event_date": "2025-11-23T08:00:00.000Z",
                "is_hosted": True,
                "is_owner": True,
                "organizer_role": "Event Owner",
            }
        ]

        mock_auth = MagicMock()
        mock_auth.get_session.return_value = {"id": "u_to_1"}
        mock_auth.get_user_by_id.return_value = {
            "id": "u_to_1",
            "bcp_user_id": "bcp_to_user_99",
            "bcp_connected": True,
        }
        mock_req = MagicMock()
        mock_req.headers = {"Authorization": "Bearer test_tok_to_1"}
        mock_req.cookies = {}

        with patch("routers.auth.get_auth_manager", return_value=mock_auth), \
             patch("routers.auth.get_database", return_value=mock_db), \
             patch.object(bcp_adapter.BcpAdapter, "fetch_user_registered_events", return_value=(True, None, [])):
            res = asyncio.run(api_user_registered_tournaments(request=mock_req, force_sync=True))
            self.assertEqual(res["count"], 1)
            self.assertEqual(res["hosted_count"], 1)
            self.assertEqual(res["hosted_tournaments"][0]["event_id"], "7ohG0RuDqC1k")
            self.assertEqual(res["hosted_tournaments"][0]["organizer_role"], "Event Owner")


if __name__ == "__main__":
    unittest.main()
