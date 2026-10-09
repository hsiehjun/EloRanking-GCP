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
    api_send_event_to_hub_direct_chat,
    api_eventstudio_update_clock,
    StudioMasterClockPayload,
    ToHubAnnouncementPayload,
    ToHubDirectChatPayload,
    ToHubDirectChatTarget,
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
        self.assertEqual(
            data.get("sync_backends"),
            {
                "announcements": "firestore",
                "clocks": "firestore",
                "flags": "firestore",
                "news_posts": "postgresql",
            },
        )

        # Seed a simulated Game Tracker room for this event (uppercase matchId token)
        room_mid = f"BCP-{self.test_event_id.upper()}-R2-T1"
        self.fs._fallback_rooms[room_mid] = {"match_id": room_mid, "eventId": self.test_event_id}

        # Update Master Clock via TO Hub payload (round_num + running status)
        clk_res = api_eventstudio_update_clock(
            self.test_event_id,
            StudioMasterClockPayload(round_num=2, status="running", remaining_seconds=7200),
        )
        self.assertTrue(clk_res["success"])
        clk_obj = clk_res["clock"]
        self.assertEqual(clk_obj["status"], "running")
        self.assertEqual(clk_obj["round"], 2)
        self.assertEqual(clk_obj["round_num"], 2)
        self.assertIsNotNone(clk_obj.get("targetEndTime"))
        self.assertGreater(clk_obj["targetEndTime"], int(time.time() * 1000))
        # Verify room received masterClock
        self.assertEqual(self.fs._fallback_rooms[room_mid]["masterClock"]["round"], 2)

        # Publish app-wide & Game Tracker event announcement banner
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
        # Verify Game Tracker room received pop-up broadcast
        self.assertIsNotNone(self.fs._fallback_rooms[room_mid].get("broadcast"))
        self.assertEqual(
            self.fs._fallback_rooms[room_mid]["broadcast"]["message"],
            "Round 2 Pairings are LIVE! Report to your assigned table.",
        )

        # Query active announcements endpoint (used by Global Banner & Game Tracker)
        t1 = time.perf_counter()
        act_res = api_get_active_event_announcements(event_ids=self.test_event_id)
        act_ms = (time.perf_counter() - t1) * 1000.0
        self.assertLess(act_ms, 50.0)
        act_list = act_res.get("announcements", [])
        self.assertEqual(len(act_list), 1)
        self.assertEqual(act_list[0]["event_id"], self.test_event_id)
        self.assertEqual(act_list[0]["level"], "warning")

        # Also verify wildcard query for Game Tracker Lobby
        wildcard_res = api_get_active_event_announcements(event_ids="*")
        self.assertTrue(
            any(a.get("event_id") == self.test_event_id for a in wildcard_res.get("announcements", []))
        )

        # Create a News Post for the public News & Info tab (PostgreSQL storage)
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
        self.assertEqual(news_res.get("storage"), "postgresql")
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
        self.assertIsNone(self.fs._fallback_rooms[room_mid].get("broadcast"))

    def test_to_hub_table_and_player_direct_chat_and_targeted_banner(self):
        room_t1 = f"BCP-{self.test_event_id.upper()}-R1-T1"
        room_t2 = f"BCP-{self.test_event_id.upper()}-R1-T2"
        self.fs._fallback_rooms[room_t1] = {"match_id": room_t1, "eventId": self.test_event_id, "tableNumber": 1}
        self.fs._fallback_rooms[room_t2] = {"match_id": room_t2, "eventId": self.test_event_id, "tableNumber": 2}

        # 1. Targeted Table 1 announcement should push to Table 1 room and NOT Table 2 room
        pub_targeted = api_publish_event_to_hub_announcement(
            self.test_event_id,
            ToHubAnnouncementPayload(
                message="🎲 Table 1 (Anthony vs John): Please submit your final score now!",
                level="urgent",
                round=1,
                target_table="1",
                target_player_name="Anthony vs John",
                author_name="Chief TO",
            ),
        )
        self.assertTrue(pub_targeted["ok"])
        self.assertEqual(pub_targeted["active_broadcast"]["target_table"], "1")
        self.assertEqual(pub_targeted["active_broadcast"]["target_player_name"], "Anthony vs John")
        self.assertIsNotNone(self.fs._fallback_rooms[room_t1].get("broadcast"))
        self.assertIsNone(self.fs._fallback_rooms[room_t2].get("broadcast"))

        # 2. Direct Chat to Table 1 where Player 1 has an OmniChat account and Player 2 does not
        mock_db = MagicMock()
        mock_db.get_event_by_id.return_value = {"id": self.test_event_id, "name": "Try Hard - 40K RTT"}

        def fake_direct_chat(sender_id, player_id, player_name, event_name="", message_text=""):
            if player_name == "Anthony Vanella":
                return {
                    "ok": True,
                    "request_id": 777,
                    "recipient_id": "u_anthony",
                    "recipient_name": "Anthony Vanella",
                    "message": {
                        "id": 9001,
                        "request_id": 777,
                        "sender_id": sender_id,
                        "sender_name": "Chief TO",
                        "message": f"🏛️ [TO • {event_name}] {message_text}",
                        "created_at": "2026-10-08T22:55:00Z",
                    },
                }
            return {"ok": False, "reason": "no_linked_account"}

        mock_db.send_to_hub_direct_chat_message.side_effect = fake_direct_chat
        mock_auth = MagicMock()
        mock_auth.get_session.return_value = {"id": "u_to_admin", "display_name": "Chief TO"}
        mock_req = MagicMock()
        mock_req.headers = {"Authorization": "Bearer test_to_token"}
        mock_req.cookies = {}

        with patch("routers.eventstudio.get_database", return_value=mock_db), \
             patch("routers.eventstudio.get_auth_manager", return_value=mock_auth):
            chat_res = api_send_event_to_hub_direct_chat(
                self.test_event_id,
                ToHubDirectChatPayload(
                    message="Please submit your Round 1 score at the TO Desk.",
                    table_number="1",
                    round=1,
                    targets=[
                        ToHubDirectChatTarget(player_id="p_anthony", player_name="Anthony Vanella"),
                        ToHubDirectChatTarget(player_id="p_john", player_name="John Lennon"),
                    ],
                    fallback_to_banner=True,
                    level="warning",
                ),
                request=mock_req,
            )
            self.assertTrue(chat_res["ok"])
            self.assertEqual(chat_res["delivered_count"], 1)
            self.assertEqual(chat_res["delivered"][0]["request_id"], 777)
            self.assertEqual(chat_res["unmatched"], ["John Lennon"])
            self.assertTrue(chat_res["banner_fallback_used"])

    def test_news_and_info_tab_is_first_after_player_station(self):
        app_html = (root_dir / "web" / "app.html").read_text(encoding="utf-8")
        idx_player = app_html.find('id="event-subtab-player"')
        idx_news = app_html.find('id="event-subtab-news"')
        idx_results = app_html.find('id="event-subtab-results"')
        self.assertGreater(idx_player, 0)
        self.assertGreater(idx_news, idx_player, "News & Info tab must appear after Player Station/My Results")
        self.assertLess(idx_news, idx_results, "News & Info tab must appear before Standings & Placings")
        self.assertIn('id="player-station-clock-schedule-wrap"', app_html)
        self.assertIn('id="event-matches-clock-schedule-wrap"', app_html)

        tournaments_js = (root_dir / "web" / "js" / "tournaments.js").read_text(encoding="utf-8")
        self.assertNotIn("Tournament Organizers & Judges (", tournaments_js)
        fn_start = tournaments_js.find("async function renderEventNewsHub(")
        fn_end = tournaments_js.find("function isToHubMatchCompleted(", fn_start)
        news_fn_body = tournaments_js[fn_start:fn_end]
        self.assertNotIn("Round Clock & Schedule", news_fn_body)
        idx_details = news_fn_body.find("📜 Official Event Details & Player Pack Information")
        idx_bulletins = news_fn_body.find("📰 Tournament Bulletins & News Feed")
        self.assertGreater(idx_details, 0)
        self.assertGreater(idx_bulletins, idx_details, "Official Event Details must be on top of News & Info tab")

        # Verify TO Table & Player Comms Modal functions exist in tournaments.js
        self.assertIn("function openToHubTableCommsModal(", tournaments_js)
        self.assertIn("function openToHubPlayerCommsModal(", tournaments_js)
        self.assertIn("function sendToHubCommsDirectChat()", tournaments_js)
        self.assertIn("function sendToHubCommsBanner()", tournaments_js)

        # Verify Master Round Clock is only shown to players when status is 'running' or 'paused', and TO Hub has Start/Stop controls
        self.assertIn("if (clockStatus !== 'running' && clockStatus !== 'paused') {", tournaments_js)
        self.assertIn("updateToHubMasterClockAction('stop')", tournaments_js)
        self.assertIn("▶️ Start Round (Show Clock to Players)", tournaments_js)
        self.assertIn("⏹️ Stop Round (Hide Clock)", tournaments_js)
        self.assertNotIn("to-hub-clock-round-select", tournaments_js)

        # Verify syncGlobalEventAnnouncementBanner always queries wildcard '*' and runs on switchTab & startup
        sync_fn_start = tournaments_js.find("async function syncGlobalEventAnnouncementBanner(")
        sync_fn_body = tournaments_js[sync_fn_start:]
        self.assertIn("const queryIds = [...eventIds, '*'];", sync_fn_body)
        self.assertIn("function startGlobalAppAnnouncementSync()", sync_fn_body)

        app_js = (root_dir / "web" / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("syncGlobalEventAnnouncementBanner()", app_js)

        api_js = (root_dir / "web" / "js" / "api.js").read_text(encoding="utf-8")
        self.assertIn("url.includes('/active-announcements')", api_js)
        self.assertIn("url.includes('/to-hub')", api_js)
        self.assertIn("async sendEventToHubDirectChat(", api_js)

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

    def test_to_hub_self_direct_chat_and_merged_tournament_doc(self):
        from database import Database
        from firestore_db import FirestoreRoomEngine

        # 1. Verify send_to_hub_direct_chat_message allows TO to message themselves (e.g. when testing or playing in own event)
        db = Database.__new__(Database)
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        db.get_connection = MagicMock()
        db.get_connection.return_value.__enter__.return_value = mock_conn

        # Simulate: first query (by player_id) returns None, second query (by player_name via users/players/player_ratings) returns the TO's own user row
        mock_cursor.fetchone.side_effect = [
            None,
            {"id": "usr_john_1", "display_name": "John Hsieh"},
            None,  # No existing match_request
            {"id": "msg_test_1", "created_at": None},
        ]

        res = db.send_to_hub_direct_chat_message(
            sender_id="usr_john_1",
            player_id="bcp_roster_entry_99",
            player_name="John Hsieh",
            event_name="Try Hard - 40K RTT",
            message_text="👋 Table 16 • John Hsieh: Test message",
        )
        self.assertTrue(res["success"])
        self.assertTrue(res["delivered_chat"])
        self.assertEqual(res["receiver_id"], "usr_john_1")
        self.assertTrue(str(res["request_id"]).startswith("mrq_"))

        # 2. Verify Firestore _read_tournament_doc_dict merges uppercase and mixed-case docs when one has partial fields
        fs = FirestoreRoomEngine()
        mock_fs_client = MagicMock()
        fs._client = mock_fs_client

        doc_mixed = MagicMock()
        doc_mixed.exists = True
        doc_mixed.to_dict.return_value = {
            "id": "7ohG0RuDqC1k",
            "broadcast": {"id": "msg_1", "message": "Table 16 alert", "active": True},
        }
        doc_upper = MagicMock()
        doc_upper.exists = True
        doc_upper.to_dict.return_value = {
            "id": "7OHG0RUDQC1K",
            "name": "Try Hard - 40K RTT",
            "masterClock": {"status": "running", "durationMinutes": 180},
        }

        def _get_doc(doc_id):
            m = MagicMock()
            if doc_id == "7ohG0RuDqC1k":
                m.get.return_value = doc_mixed
            elif doc_id == "7OHG0RUDQC1K":
                m.get.return_value = doc_upper
            else:
                empty = MagicMock()
                empty.exists = False
                m.get.return_value = empty
            return m

        mock_fs_client.collection.return_value.document.side_effect = _get_doc
        merged = fs._read_tournament_doc_dict("7ohG0RuDqC1k")
        self.assertEqual(merged["broadcast"]["message"], "Table 16 alert")
        self.assertEqual(merged["masterClock"]["status"], "running")
        self.assertEqual(merged["name"], "Try Hard - 40K RTT")


if __name__ == "__main__":
    unittest.main()


