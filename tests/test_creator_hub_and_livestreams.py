"""
Automated unit tests for Creator Hub, Creator Role, and Livestream Studio Engine.
"""
import sys
import unittest
import asyncio
from pathlib import Path
from unittest.mock import patch, MagicMock

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from core import HTTPException, Request
from auth import AuthManager
from firestore_db import (
    _parse_stream_embed,
    get_firestore_engine,
    get_event_livestreams,
    save_event_livestream,
    delete_event_livestream,
)
from routers.admin import api_admin_set_user_role, AdminSetUserRolePayload
from routers.eventstudio import (
    api_get_event_livestreams,
    api_save_event_livestream,
    api_delete_event_livestream,
    EventLivestreamPayload,
)


class TestCreatorHubAndLivestreams(unittest.TestCase):

    def test_creator_role_and_cc_session_flags(self):
        """Verify creator role grants can_access_cc and is_cc in AuthManager.get_user_by_id."""
        mock_db = MagicMock()
        auth_mgr = AuthManager(db=mock_db)
        
        # Test direct role calculation logic
        row_creator = {
            "id": "u_creator_01",
            "email": "caster@wargameslive.com",
            "display_name": "Live Caster",
            "role": "creator",
            "player_id": "p_01"
        }
        cursor_mock = MagicMock()
        cursor_mock.__enter__.return_value = cursor_mock
        cursor_mock.fetchone.return_value = row_creator
        mock_db.get_connection.return_value.__enter__.return_value.cursor.return_value = cursor_mock

        user = auth_mgr.get_user_by_id("u_creator_01")
        self.assertIsNotNone(user)
        self.assertEqual(user["role"], "creator")
        self.assertTrue(user["can_access_cc"])
        self.assertTrue(user["is_cc"])
        self.assertFalse(user["is_admin"])

        # Regular competitor user
        row_player = {
            "id": "u_player_01",
            "email": "player@test.com",
            "display_name": "Competitive Player",
            "role": "player",
            "player_id": "p_02"
        }
        cursor_mock.fetchone.return_value = row_player
        user_p = auth_mgr.get_user_by_id("u_player_01")
        self.assertIsNotNone(user_p)
        self.assertEqual(user_p["role"], "player")
        self.assertFalse(user_p["can_access_cc"])
        self.assertFalse(user_p["is_cc"])

    def test_admin_set_user_role_accepts_creator(self):
        """Verify Admin role manager allows assigning the creator role and normalizes cc aliases."""
        mock_request = MagicMock(spec=Request)
        mock_admin_sess = {"id": "admin_1", "role": "admin", "is_admin": True}

        with patch("routers.admin._get_admin_session_or_403", return_value=mock_admin_sess), \
             patch("routers.admin.get_auth_manager") as mock_get_auth:

            mock_auth_instance = MagicMock()
            mock_auth_instance.set_user_role.return_value = True
            mock_get_auth.return_value = mock_auth_instance

            payload = AdminSetUserRolePayload(role="creator")
            res = api_admin_set_user_role("u_test", payload, mock_request)
            self.assertTrue(res.get("success"))
            self.assertEqual(res.get("role"), "creator")
            mock_auth_instance.set_user_role.assert_called_with("u_test", "creator")

            # Alias cc normalizes to creator
            payload_alias = AdminSetUserRolePayload(role="cc")
            res_alias = api_admin_set_user_role("u_test", payload_alias, mock_request)
            self.assertEqual(res_alias.get("role"), "creator")

    def test_john_hsieh_can_switch_to_non_admin_roles(self):
        """Verify John Hsieh (swimgeek751@gmail.com) is not forced to admin when role is set to player, creator, or to."""
        mock_db = MagicMock()
        auth_mgr = AuthManager(db=mock_db)
        cursor_mock = MagicMock()
        cursor_mock.__enter__.return_value = cursor_mock
        mock_db.get_connection.return_value.__enter__.return_value.cursor.return_value = cursor_mock

        for target_role, exp_admin, exp_to, exp_cc in [
            ("player", False, False, False),
            ("creator", False, False, True),
            ("to", False, True, False),
            ("admin", True, True, True),
        ]:
            auth_mgr._invalidate_session_user_cache()
            row_john = {
                "id": "u_john_hsieh",
                "email": "swimgeek751@gmail.com",
                "display_name": "John Hsieh",
                "role": target_role,
                "player_id": "MEV83VFANA",
            }
            cursor_mock.fetchone.return_value = row_john
            user = auth_mgr.get_user_by_id("u_john_hsieh")
            self.assertEqual(user["role"], target_role)
            self.assertEqual(user["is_admin"], exp_admin)
            self.assertEqual(user["can_access_to"], exp_to)
            self.assertEqual(user["can_access_cc"], exp_cc)
            self.assertTrue(user["can_switch_role"])

            auth_mgr._invalidate_session_user_cache()
            sess = auth_mgr.get_session(f"tok_{target_role}")
            self.assertEqual(sess["role"], target_role)
            self.assertEqual(sess["is_admin"], exp_admin)
            self.assertEqual(sess["can_access_to"], exp_to)
            self.assertEqual(sess["can_access_cc"], exp_cc)
            self.assertTrue(sess["can_switch_role"])

            cursor_mock.fetchall.return_value = [dict(row_john, created_at=None)]
            admin_users = auth_mgr.get_admin_users()
            self.assertEqual(admin_users[0]["role"], target_role)

    def test_test_account_cannot_switch_role_or_pretend_admin(self):
        """Verify hsiehjun@google.com preserves its DB-assigned role (including admin) while keeping can_switch_role=False and blocking self-role-switch."""
        from core import HTTPException
        mock_db = MagicMock()
        auth_mgr = AuthManager(db=mock_db)
        cursor_mock = MagicMock()
        cursor_mock.__enter__.return_value = cursor_mock
        mock_db.get_connection.return_value.__enter__.return_value.cursor.return_value = cursor_mock

        row_test_acct = {
            "id": "u_john4_test",
            "email": "hsiehjun@google.com",
            "display_name": "John4 Hsieh4",
            "role": "admin",  # DB-assigned admin role must be preserved on refresh
            "player_id": "DxHDrz4LFzzb",
        }
        cursor_mock.fetchone.return_value = row_test_acct
        user_t = auth_mgr.get_user_by_id("u_john4_test", bypass_cache=True)
        self.assertEqual(user_t["role"], "admin")
        self.assertTrue(user_t["is_admin"])
        self.assertFalse(user_t["can_switch_role"])
        self.assertFalse(user_t["is_superadmin"])

        auth_mgr._invalidate_session_user_cache()
        sess_t = auth_mgr.get_session("tok_test_acct", bypass_cache=True)
        self.assertEqual(sess_t["role"], "admin")
        self.assertTrue(sess_t["is_admin"])
        self.assertFalse(sess_t["can_switch_role"])
        self.assertFalse(sess_t["is_superadmin"])

        # Attempting to call api_admin_set_user_role on oneself as hsiehjun@google.com (non-superadmin) raises 403
        mock_request = MagicMock(spec=Request)
        with patch("routers.admin._get_admin_session_or_403", return_value={"id": "u_john4_test", "email": "hsiehjun@google.com", "role": "admin", "is_admin": True}):
            with self.assertRaises(HTTPException) as ctx:
                api_admin_set_user_role("u_john4_test", AdminSetUserRolePayload(role="player"), mock_request)
            self.assertEqual(ctx.exception.status_code, 403)

        # Attempting self-role switch as any non-superadmin raises 403
        with patch("routers.admin._get_admin_session_or_403", return_value={"id": "u_other_admin", "email": "other@example.com", "role": "admin", "is_admin": True}):
            with self.assertRaises(HTTPException) as ctx2:
                api_admin_set_user_role("u_other_admin", AdminSetUserRolePayload(role="to"), mock_request)
            self.assertEqual(ctx2.exception.status_code, 403)

    def test_parse_stream_embed_youtube_and_twitch(self):
        """Verify embed URL generation for YouTube watch, youtu.be, and Twitch channels."""
        yt_watch = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        p, embed_yt = _parse_stream_embed(yt_watch, "youtube")
        self.assertEqual(p, "youtube")
        self.assertIn("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", embed_yt)
        self.assertIn("autoplay=1", embed_yt)

        yt_short = "https://youtu.be/dQw4w9WgXcQ?si=test123"
        p, embed_short = _parse_stream_embed(yt_short, "youtube")
        self.assertEqual(p, "youtube")
        self.assertIn("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", embed_short)

        twitch = "https://www.twitch.tv/wargameslive"
        p, embed_twitch = _parse_stream_embed(twitch, "twitch")
        self.assertEqual(p, "twitch")
        self.assertIn("player.twitch.tv/?channel=wargameslive", embed_twitch)
        self.assertIn("parent=localhost", embed_twitch)

    def test_firestore_db_livestream_crud(self):
        """Verify saving, fetching, and deleting livestreams directly in FirestoreRoomEngine."""
        engine = get_firestore_engine()
        test_ev = "ev_unit_test_creator_999"

        # 1. Initially empty
        streams = engine.get_event_livestreams(test_ev)
        self.assertEqual(len(streams), 0)

        # 2. Add livestream
        new_stream = engine.save_event_livestream(
            test_ev,
            {
                "table_number": 1,
                "channel": "Wargames Live",
                "stream_url": "https://youtube.com/watch?v=dQw4w9WgXcQ",
                "platform": "youtube",
                "title": "Feature Table"
            }
        )
        self.assertEqual(new_stream["table_number"], 1)
        self.assertEqual(new_stream["channel"], "Wargames Live")
        self.assertIn("youtube-nocookie.com", new_stream["embed_url"])

        # Fetch
        streams_after = engine.get_event_livestreams(test_ev)
        self.assertEqual(len(streams_after), 1)
        self.assertEqual(streams_after[0]["id"], new_stream["id"])

        # 3. Add table 0 (Main Desk) and table 250 (Large 500-player tournament table)
        main_desk_stream = engine.save_event_livestream(
            test_ev,
            {
                "table_number": 0,
                "channel": "OmniTactica Desk",
                "stream_url": "https://youtube.com/watch?v=dQw4w9WgXcQ",
                "platform": "youtube"
            }
        )
        self.assertEqual(main_desk_stream["table_number"], 0)
        self.assertEqual(main_desk_stream["title"], "Main Desk Live Broadcast")

        table_250_stream = engine.save_event_livestream(
            test_ev,
            {
                "table_number": 250,
                "channel": "Community Streamer",
                "stream_url": "https://youtube.com/watch?v=dQw4w9WgXcQ",
                "platform": "youtube"
            }
        )
        self.assertEqual(table_250_stream["table_number"], 250)
        self.assertEqual(table_250_stream["title"], "Table 250 Live Broadcast")

        # 4. Delete livestreams
        engine.delete_event_livestream(test_ev, new_stream["id"])
        engine.delete_event_livestream(test_ev, main_desk_stream["id"])
        engine.delete_event_livestream(test_ev, table_250_stream["id"])
        streams_empty = engine.get_event_livestreams(test_ev)
        self.assertEqual(len(streams_empty), 0)

    def test_livestream_router_auth_permissions(self):
        """Verify that only creator, admin, or TO can add/delete livestreams."""
        creator_sess = {"id": "c1", "role": "creator", "can_access_cc": True, "name": "Caster 1"}

        payload = EventLivestreamPayload(
            channel="MiniWarGaming",
            stream_url="https://youtube.com/watch?v=test",
            table_number=3,
            platform="youtube"
        )
        mock_req = MagicMock(spec=Request)

        with patch("routers.eventstudio.get_firestore_engine") as mock_get_fs:
            mock_fs = mock_get_fs.return_value
            mock_fs.save_event_livestream.return_value = {"id": "s_new", "channel": "MiniWarGaming"}
            mock_fs.get_event_livestreams.return_value = [{"id": "s_new"}]

            with patch("routers.eventstudio._get_creator_or_to_session_or_403", return_value=creator_sess):
                res = api_save_event_livestream("ev_test", payload, mock_req)
                self.assertTrue(res.get("success"))

            with patch("routers.eventstudio._get_creator_or_to_session_or_403", side_effect=HTTPException(status_code=403, detail="Forbidden")):
                with self.assertRaises(HTTPException) as ctx:
                    api_save_event_livestream("ev_test", payload, mock_req)
                self.assertEqual(ctx.exception.status_code, 403)

    def test_superadmin_mock_player_security_and_profile_sanitization(self):
        """Verify POST /api/admin/mock-player strictly rejects non-superadmins (including other admins like hsiehjun@google.com) and returns a sanitized player profile for swimgeek751@gmail.com."""
        from routers.admin import api_admin_mock_player, AdminMockPlayerPayload

        mock_req = MagicMock(spec=Request)
        mock_req.headers = {"Authorization": "Bearer test_tok"}
        mock_req.cookies = {}

        payload = AdminMockPlayerPayload(
            mode="player",
            player_id="p_marco",
            full_name="Marco Esteban",
            team_name="Wargames Adictos",
            faction="Chaos Knights",
            detachment="Traitoris Lance",
            event_id="goVnKElgpZXE",
            is_captain=True,
            elo=1820.0,
        )

        # 1. Non-superadmin Admin (hsiehjun@google.com) MUST be blocked with 403 Forbidden
        other_admin_sess = {
            "id": "u_john4",
            "email": "hsiehjun@google.com",
            "role": "admin",
            "is_admin": True,
            "is_superadmin": False,
            "can_switch_role": False,
        }
        with patch("routers.admin.get_auth_manager") as mock_get_auth:
            mock_get_auth.return_value.get_session.return_value = other_admin_sess
            with self.assertRaises(HTTPException) as ctx:
                api_admin_mock_player(payload, mock_req)
            self.assertEqual(ctx.exception.status_code, 403)

        # 2. Normal Player MUST be blocked with 403 Forbidden
        player_sess = {
            "id": "u_player1",
            "email": "player@example.com",
            "role": "player",
            "is_admin": False,
            "is_superadmin": False,
        }
        with patch("routers.admin.get_auth_manager") as mock_get_auth:
            mock_get_auth.return_value.get_session.return_value = player_sess
            with self.assertRaises(HTTPException) as ctx:
                api_admin_mock_player(payload, mock_req)
            self.assertEqual(ctx.exception.status_code, 403)

        # 3. Primary Superadmin (swimgeek751@gmail.com) succeeds and gets a strictly non-admin player mock profile
        superadmin_sess = {
            "id": "u_super",
            "email": "swimgeek751@gmail.com",
            "role": "admin",
            "is_admin": True,
            "is_superadmin": True,
            "can_switch_role": True,
        }
        with patch("routers.admin.get_auth_manager") as mock_get_auth:
            mock_get_auth.return_value.get_session.return_value = superadmin_sess
            res = api_admin_mock_player(payload, mock_req)
            self.assertTrue(res["success"])
            self.assertTrue(res["mock_active"])
            prof = res["mock_profile"]
            self.assertEqual(prof["full_name"], "Marco Esteban")
            self.assertEqual(prof["team_name"], "Wargames Adictos")
            self.assertEqual(prof["role"], "player")
            self.assertFalse(prof["is_admin"])
            self.assertFalse(prof["is_superadmin"])
            self.assertFalse(prof["can_switch_role"])
            self.assertFalse(prof["can_access_to"])
            self.assertFalse(prof["can_access_cc"])
            self.assertTrue(prof["is_mock_player"])
            self.assertEqual(prof["mocked_by_superadmin"], "swimgeek751@gmail.com")
            self.assertNotIn("token", res)
            self.assertNotIn("email", prof)


if __name__ == "__main__":
    unittest.main()
