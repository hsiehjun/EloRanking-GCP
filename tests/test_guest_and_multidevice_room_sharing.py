#!/usr/bin/env python3
"""Automated verification suite for:
1. Unauthenticated Guest Access via Shared Room Link (No OmniTactica credentials required).
2. Two Sharing Options ("Share in OmniTactica Chat" + "Share via Link / Room Key").
3. Player 1, Player 2, and Spectator (3rd+ person) routing + Real-Time Scorecard.
4. Multi-Device Same-Player Support (e.g., Player 1 on iPad Center Console + Phone signed into same account).
"""

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from routers.tracker import (
    TRACKER_LISTENERS,
    TRACKER_ROOMS,
    TrackerCreatePayload,
    TrackerJoinPayload,
    TrackerShareChatPayload,
    TrackerStatePayload,
    api_get_scorecard,
    api_tracker_check_room,
    api_tracker_create_room,
    api_tracker_join_room,
    api_tracker_save_state,
    api_tracker_share_chat,
)


class DummyRequest:
    def __init__(self, headers=None, query_params=None, cookies=None):
        self.headers = headers or {}
        self.query_params = query_params or {}
        self.cookies = cookies or {}


class TestGuestAndMultiDeviceRoomSharing(unittest.TestCase):
    def setUp(self):
        TRACKER_ROOMS.clear()
        TRACKER_LISTENERS.clear()

    def _make_mock_auth_mgr(self):
        mgr = MagicMock()

        def get_session(tok):
            if tok == "token_p1":
                return {
                    "id": "user_p1_account",
                    "email": "commander1@omnitactica.com",
                    "display_name": "Commander Alpha",
                    "is_admin": False,
                }
            if tok == "token_p2":
                return {
                    "id": "user_p2_account",
                    "email": "commander2@omnitactica.com",
                    "display_name": "Commander Beta",
                    "is_admin": False,
                }
            if tok == "token_p3":
                return {
                    "id": "user_p3_account",
                    "email": "spectator3@omnitactica.com",
                    "display_name": "Observer Gamma",
                    "is_admin": False,
                }
            return None

        mgr.get_session.side_effect = get_session
        return mgr

    @patch("routers.tracker.get_auth_manager")
    def test_p1_two_devices_same_account_and_unauthenticated_guest_p2_and_spectator_3rd(self, mock_get_auth):
        mock_get_auth.return_value = self._make_mock_auth_mgr()

        # 1. Player 1 creates the room on Device 1 (e.g. iPad Center Console)
        req_p1_ipad = DummyRequest(headers={"Authorization": "Bearer token_p1", "X-Guest-Id": "guest_ipad_p1"})
        create_data = asyncio.run(
            api_tracker_create_room(
                req_p1_ipad,
                TrackerCreatePayload(token="token_p1", p1_name="Commander Alpha"),
            )
        )
        match_id = create_data["match_id"]
        self.assertEqual(create_data["role"], "player1")

        # 2. Player 1 opens the same room on Device 2 (e.g. Phone) signed into the same account
        req_p1_phone = DummyRequest(
            headers={"Authorization": "Bearer token_p1", "X-Guest-Id": "guest_phone_p1"},
            query_params={"guest_id": "guest_phone_p1"},
        )
        chk_phone_data = asyncio.run(
            api_tracker_check_room(match_id, req_p1_phone)
        )
        self.assertEqual(chk_phone_data["role"], "player1")
        self.assertFalse(chk_phone_data["is_spectator"])
        self.assertFalse(chk_phone_data["is_full"])
        self.assertIsNone(chk_phone_data["user_id_p2"])

        join_phone_data = asyncio.run(
            api_tracker_join_room(
                match_id,
                req_p1_phone,
                TrackerJoinPayload(token="token_p1", guest_id="guest_phone_p1", player_name="Commander Alpha"),
            )
        )
        # Crucial: P1's second device MUST remain player1 and MUST NOT claim user_id_p2!
        self.assertEqual(join_phone_data["role"], "player1")
        self.assertEqual(join_phone_data["user_id_p1"], "user_p1_account")
        self.assertIsNone(join_phone_data["user_id_p2"])

        # 3. Unauthenticated Guest (no OmniTactica account) opens shared link and joins as Player 2
        guest_p2_id = "guest_opponent_xyz987"
        req_guest_p2 = DummyRequest(
            headers={"X-Guest-Id": guest_p2_id},
            query_params={"guest_id": guest_p2_id},
        )
        chk_guest_data = asyncio.run(
            api_tracker_check_room(match_id, req_guest_p2)
        )
        self.assertEqual(chk_guest_data["role"], "player2")
        self.assertFalse(chk_guest_data["is_spectator"])
        self.assertTrue(chk_guest_data["is_open_for_p2"])

        join_guest_data = asyncio.run(
            api_tracker_join_room(
                match_id,
                req_guest_p2,
                TrackerJoinPayload(guest_id=guest_p2_id),
            )
        )
        self.assertEqual(join_guest_data["role"], "player2")
        self.assertEqual(join_guest_data["user_id_p1"], "user_p1_account")
        self.assertEqual(join_guest_data["user_id_p2"], guest_p2_id)

        # 4. Unauthenticated Guest P2 refreshes page -> keeps Player 2 seat!
        rejoin_guest_data = asyncio.run(
            api_tracker_join_room(
                match_id,
                req_guest_p2,
                TrackerJoinPayload(guest_id=guest_p2_id),
            )
        )
        self.assertEqual(rejoin_guest_data["role"], "player2")

        # 5. Player 1 refreshes on both iPad and Phone -> both still stay Player 1 even after P2 is filled!
        rejoin_p1_ipad = asyncio.run(
            api_tracker_join_room(
                match_id,
                req_p1_ipad,
                TrackerJoinPayload(token="token_p1", guest_id="guest_ipad_p1"),
            )
        )
        self.assertEqual(rejoin_p1_ipad["role"], "player1")
        rejoin_p1_phone = asyncio.run(
            api_tracker_join_room(
                match_id,
                req_p1_phone,
                TrackerJoinPayload(token="token_p1", guest_id="guest_phone_p1"),
            )
        )
        self.assertEqual(rejoin_p1_phone["role"], "player1")

        # 6. Guest P2 can push live score updates without an OmniTactica token
        updated_state = dict(join_guest_data["state"])
        updated_state["p1"] = {"rounds": [{"round": 1, "primaryScore": 10, "secondaryScore": 5}]}
        updated_state["p2"] = {"rounds": [{"round": 1, "primaryScore": 15, "secondaryScore": 8}]}
        state_res = asyncio.run(
            api_tracker_save_state(
                match_id,
                TrackerStatePayload(
                    match_id=match_id,
                    version=50,
                    state=updated_state,
                    guest_id=guest_p2_id,
                ),
                req_guest_p2,
            )
        )
        self.assertTrue(state_res["success"])

        # 7. Any 3rd person (authenticated or unauthenticated guest) entering is routed to Spectator!
        third_guest_id = "guest_spectator_333"
        req_third_guest = DummyRequest(
            headers={"X-Guest-Id": third_guest_id},
            query_params={"guest_id": third_guest_id},
        )
        chk_third_data = asyncio.run(
            api_tracker_check_room(match_id, req_third_guest)
        )
        self.assertEqual(chk_third_data["role"], "spectator")
        self.assertTrue(chk_third_data["is_spectator"])
        self.assertTrue(chk_third_data["is_full"])
        self.assertFalse(chk_third_data["is_open_for_p2"])

        join_third_data = asyncio.run(
            api_tracker_join_room(
                match_id,
                req_third_guest,
                TrackerJoinPayload(guest_id=third_guest_id),
            )
        )
        self.assertEqual(join_third_data["role"], "spectator")

        # Authenticated 3rd user also becomes spectator
        req_third_auth = DummyRequest(headers={"Authorization": "Bearer token_p3"})
        join_auth_third = asyncio.run(
            api_tracker_join_room(
                match_id,
                req_third_auth,
                TrackerJoinPayload(token="token_p3"),
            )
        )
        self.assertEqual(join_auth_third["role"], "spectator")

        # 8. Real-time Scorecard endpoint returns the live updated state for spectators
        mock_db = MagicMock()
        mock_db.get_tracker_game.return_value = None
        with patch("routers.tracker.get_database", return_value=mock_db):
            sc_data = asyncio.run(api_get_scorecard(match_id))
            self.assertTrue(sc_data["success"])
            self.assertEqual(sc_data["status"], "in_progress")
            self.assertEqual(sc_data["state"]["p2"]["rounds"][0]["primaryScore"], 15)

        print("✓ test_p1_two_devices_same_account_and_unauthenticated_guest_p2_and_spectator_3rd passed")

    @patch("routers.tracker.get_database")
    @patch("routers.tracker.get_auth_manager")
    def test_share_room_in_omnitactica_chat_endpoint(self, mock_get_auth, mock_get_db):
        mock_get_auth.return_value = self._make_mock_auth_mgr()
        mock_db = MagicMock()
        mock_db.send_chat_message.return_value = {
            "success": True,
            "message_id": "msg_999",
            "created_at": "2026-10-08T00:00:00Z",
        }
        mock_db.get_chat_messages.return_value = {
            "request": {"sender_id": "user_p1_account", "receiver_id": "user_p2_account"}
        }
        mock_get_db.return_value = mock_db

        # Host creates room
        req_p1 = DummyRequest(headers={"Authorization": "Bearer token_p1"})
        create_data = asyncio.run(
            api_tracker_create_room(
                req_p1,
                TrackerCreatePayload(token="token_p1", p1_name="Commander Alpha"),
            )
        )
        match_id = create_data["match_id"]

        # Host shares room in OmniTactica chat thread
        share_data = api_tracker_share_chat(
            match_id,
            TrackerShareChatPayload(token="token_p1", request_id="req_12345"),
            req_p1,
        )
        self.assertTrue(share_data["success"])
        self.assertEqual(share_data["match_id"], match_id)
        self.assertEqual(share_data["request_id"], "req_12345")
        self.assertEqual(share_data["message_id"], "msg_999")
        mock_db.send_chat_message.assert_called_once()
        print("✓ test_share_room_in_omnitactica_chat_endpoint passed")

    def test_frontend_guest_bypass_and_share_modal_wired(self):
        sync_40k = (ROOT_DIR / "web" / "tracker" / "tracker_sync.js").read_text(encoding="utf-8")
        sync_aos = (ROOT_DIR / "web" / "tracker" / "tracker_sync_aos.js").read_text(encoding="utf-8")
        scorecard_html = (ROOT_DIR / "web" / "scorecard.html").read_text(encoding="utf-8")

        # 1. Guest ID persistence and unauthenticated room link bypass
        self.assertIn("function getOrCreateGuestId()", sync_40k)
        self.assertIn("function hasSharedMatchParams()", sync_40k)
        self.assertIn("const canJoinAsGuest = isPlay && hasSharedMatchParams();", sync_40k)
        self.assertIn("function getOrCreateGuestId()", sync_aos)

        # 2. Share Room Modal (Share via Link + Share in OmniTactica Chat)
        self.assertIn("window.__openShareRoomModal", sync_40k)
        self.assertIn("window.__sendRoomInviteToChat", sync_40k)
        self.assertIn("1. Share via Direct Link or Room Key", sync_40k)
        self.assertIn("2. Share in OmniTactica Chat", sync_40k)
        self.assertIn("window.__openShareRoomModal", sync_aos)

        # 3. Multi-device P1 check uses userIdP2 instead of onlineCount >= 2
        self.assertIn("const isP2Ready = Boolean(clientState.userIdP2 || stateObj.user_id_p2", sync_40k)
        self.assertIn("Using an iPad + Phone?", sync_40k)

        # 4. Real-time Scorecard SSE + Firestore onSnapshot
        self.assertIn("new EventSource(`/api/tracker/room/${encodeURIComponent(matchId)}/stream", scorecard_html)
        self.assertIn("applyLiveScorecardStatePatch", scorecard_html)
        print("✓ test_frontend_guest_bypass_and_share_modal_wired passed")

    def test_server_html_guest_access_on_shared_match_id_and_sso_on_lobby(self):
        """Verify server.py serves play.html/aos.html to unauthenticated Guest P2 ONLY when a valid shared match_id is in the URL, and enforces /login on Lobby or bare /play."""
        import server
        from types import SimpleNamespace

        def make_server_req(query_dict=None, query_str=""):
            req = DummyRequest(query_params=query_dict or {})
            req.url = SimpleNamespace(query=query_str)
            return req

        with patch.object(server, "_get_request_user", return_value=None):
            # 1. Shared 40k match URL in Incognito (no user session) -> 200 HTMLResponse (NOT redirected to /login!)
            resp_play = asyncio.run(
                server.serve_tracker_html(
                    "11th/tracker/play",
                    make_server_req({"match_id": "WH40K-54E7-04BE"}, "match_id=WH40K-54E7-04BE"),
                )
            )
            self.assertEqual(resp_play.status_code, 200)

            # 2. Shared AoS match URL in Incognito -> 200 HTMLResponse
            resp_aos = asyncio.run(
                server.serve_tracker_html(
                    "11th/tracker/aos",
                    make_server_req({"match_id": "AOS-54E7-04BE"}, "match_id=AOS-54E7-04BE"),
                )
            )
            self.assertEqual(resp_aos.status_code, 200)

            def _redirect_loc(r):
                return getattr(r, "url", None) or (r.headers.get("location", "") if hasattr(r, "headers") else "")

            # 3. /tracker?match_id=WH40K-54E7-04BE alias in Incognito -> 303 redirect to /11th/tracker/play?match_id=WH40K-54E7-04BE
            resp_alias = server.serve_tracker_alias(
                make_server_req({"match_id": "WH40K-54E7-04BE"}, "match_id=WH40K-54E7-04BE"),
                token=None,
            )
            self.assertEqual(resp_alias.status_code, 303)
            self.assertEqual(_redirect_loc(resp_alias), "/11th/tracker/play?match_id=WH40K-54E7-04BE")

            # 4. Unauthenticated access to Tracker Lobby (/11th/tracker) -> MUST redirect to /login!
            resp_lobby = asyncio.run(
                server.serve_tracker_html("11th/tracker", make_server_req({}, ""))
            )
            self.assertEqual(resp_lobby.status_code, 303)
            self.assertTrue(_redirect_loc(resp_lobby).startswith("/login?redirect="))

            # 5. Unauthenticated access to bare /11th/tracker/play (no match_id) -> MUST redirect to /login!
            resp_bare_play = asyncio.run(
                server.serve_tracker_html("11th/tracker/play", make_server_req({}, ""))
            )
            self.assertEqual(resp_bare_play.status_code, 303)
            self.assertTrue(_redirect_loc(resp_bare_play).startswith("/login?redirect="))

            # 6. Malformed/injected match_id -> rejected by _has_valid_shared_match_params and redirected to /login
            resp_bad_mid = asyncio.run(
                server.serve_tracker_html(
                    "11th/tracker/play",
                    make_server_req({"match_id": "../../etc/passwd"}, "match_id=../../etc/passwd"),
                )
            )
            self.assertEqual(resp_bad_mid.status_code, 303)
            self.assertTrue(_redirect_loc(resp_bad_mid).startswith("/login?redirect="))

        print("✓ test_server_html_guest_access_on_shared_match_id_and_sso_on_lobby passed")

    @patch("core.get_auth_manager")
    @patch("routers.tracker.get_auth_manager")
    def test_guest_endpoint_security_and_anti_spoofing(self, mock_get_auth, mock_core_auth):
        """Verify guest endpoints reject user_id spoofing, prevent P1 seat/list overwrite, block 3rd-party writes, and gate debug endpoints."""
        from core import HTTPException
        from routers.tracker import (
            _extract_guest_id,
            api_tracker_attach_armylist,
            api_tracker_debug_test_save,
            api_tracker_firestore_inspect,
            api_tracker_roll_dice,
            api_tracker_sync_dice_tray,
            api_tracker_update_clock,
        )

        mock_get_auth.return_value = self._make_mock_auth_mgr()
        mock_core_auth.return_value = self._make_mock_auth_mgr()

        # 1. _extract_guest_id MUST reject non-guest_ strings (prevents spoofing real user IDs like 'user_p1_account')
        spoof_req = DummyRequest(
            headers={"X-Guest-Id": "user_p1_account"},
            query_params={"guest_id": "user_p1_account"},
        )
        self.assertIsNone(_extract_guest_id(spoof_req))
        valid_req = DummyRequest(headers={"X-Guest-Id": "guest_valid_abc123"})
        self.assertEqual(_extract_guest_id(valid_req), "guest_valid_abc123")

        # 2. P1 creates room, Guest P2 joins
        req_p1 = DummyRequest(headers={"Authorization": "Bearer token_p1"})
        create_data = asyncio.run(
            api_tracker_create_room(
                req_p1,
                TrackerCreatePayload(token="token_p1", p1_name="Commander Alpha"),
            )
        )
        match_id = create_data["match_id"]

        guest_p2_id = "guest_p2_legit_999"
        req_guest_p2 = DummyRequest(headers={"X-Guest-Id": guest_p2_id})
        join_p2 = asyncio.run(
            api_tracker_join_room(
                match_id,
                req_guest_p2,
                TrackerJoinPayload(guest_id=guest_p2_id, player_name="Guest Opponent"),
            )
        )
        self.assertEqual(join_p2["role"], "player2")

        # 3. Attacker tries to spoof P1's user_id via X-Guest-Id after both seats are claimed -> gets spectator, and 403 on state save!
        chk_spoof = asyncio.run(api_tracker_check_room(match_id, spoof_req))
        self.assertEqual(chk_spoof["role"], "spectator")
        self.assertTrue(chk_spoof["is_spectator"])

        with self.assertRaises(HTTPException) as ctx_state:
            asyncio.run(
                api_tracker_save_state(
                    match_id,
                    TrackerStatePayload(
                        match_id=match_id,
                        role="editor",  # Even if attacker sends role='editor'
                        version=99,
                        state={"p1": {"score": 99}},
                        guest_id="user_p1_account",
                    ),
                    spoof_req,
                )
            )
        self.assertEqual(ctx_state.exception.status_code, 403)

        # 4. Guest P2 tries to overwrite room['user_id_p1'] inside state payload -> server preserves true user_id_p1!
        tamper_res = asyncio.run(
            api_tracker_save_state(
                match_id,
                TrackerStatePayload(
                    match_id=match_id,
                    role="player2",
                    version=10,
                    state={"user_id_p1": guest_p2_id, "user_id_p2": guest_p2_id, "p2": {"score": 25}},
                    guest_id=guest_p2_id,
                ),
                req_guest_p2,
            )
        )
        self.assertTrue(tamper_res["success"])
        self.assertEqual(TRACKER_ROOMS[match_id]["user_id_p1"], "user_p1_account")
        self.assertEqual(TRACKER_ROOMS[match_id]["state"]["user_id_p1"], "user_p1_account")

        # 5. Guest P2 CAN update clock, dice tray, dice roll, and P2 army list, but CANNOT overwrite P1's army list
        def make_json_req(body_dict, headers=None):
            r = DummyRequest(headers=headers or {})
            async def _json():
                return body_dict
            r.json = _json
            return r

        clock_res = asyncio.run(
            api_tracker_update_clock(
                match_id,
                make_json_req({"running": True, "active_player": 2, "guest_id": guest_p2_id}, {"X-Guest-Id": guest_p2_id}),
            )
        )
        self.assertTrue(clock_res["success"])

        tray_res = asyncio.run(
            api_tracker_sync_dice_tray(
                match_id,
                make_json_req({"tray": [{"id": 1, "val": 6, "rolled": True}], "guest_id": guest_p2_id}, {"X-Guest-Id": guest_p2_id}),
            )
        )
        self.assertTrue(tray_res["success"])

        roll_res = asyncio.run(
            api_tracker_roll_dice(
                match_id,
                make_json_req({"player_num": 2, "dice_count": 5, "results": [6, 5, 4, 3, 2], "guest_id": guest_p2_id}, {"X-Guest-Id": guest_p2_id}),
            )
        )
        self.assertTrue(roll_res["success"])

        # Guest P2 attaches P2 army list -> allowed
        p2_list_res = asyncio.run(
            api_tracker_attach_armylist(
                match_id,
                make_json_req({"role": "player2", "army_list": {"faction": "Necrons"}, "guest_id": guest_p2_id}, {"X-Guest-Id": guest_p2_id}),
            )
        )
        self.assertTrue(p2_list_res["success"])

        # Guest P2 attempts to overwrite P1 army list -> 403 Forbidden!
        with self.assertRaises(HTTPException) as ctx_list:
            asyncio.run(
                api_tracker_attach_armylist(
                    match_id,
                    make_json_req({"role": "player1", "army_list": {"faction": "Hacked"}, "guest_id": guest_p2_id}, {"X-Guest-Id": guest_p2_id}),
                )
            )
        self.assertEqual(ctx_list.exception.status_code, 403)

        # 3rd-party guest attempts to modify clock or dice -> 403 Forbidden!
        third_guest = "guest_outsider_777"
        with self.assertRaises(HTTPException):
            asyncio.run(
                api_tracker_update_clock(
                    match_id,
                    make_json_req({"running": False, "guest_id": third_guest}, {"X-Guest-Id": third_guest}),
                )
            )
        with self.assertRaises(HTTPException):
            asyncio.run(
                api_tracker_sync_dice_tray(
                    match_id,
                    make_json_req({"tray": [], "guest_id": third_guest}, {"X-Guest-Id": third_guest}),
                )
            )

        # 6. Debug endpoints reject unauthenticated callers
        with self.assertRaises(HTTPException):
            api_tracker_debug_test_save(DummyRequest())
        with self.assertRaises(HTTPException):
            api_tracker_firestore_inspect(match_id, DummyRequest())

        print("✓ test_guest_endpoint_security_and_anti_spoofing passed")


if __name__ == "__main__":
    unittest.main()
