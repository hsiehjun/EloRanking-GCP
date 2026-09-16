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
            res = asyncio.run(api_admin_set_user_role("u_test", payload, mock_request))
            self.assertTrue(res.get("success"))
            self.assertEqual(res.get("role"), "creator")
            mock_auth_instance.set_user_role.assert_called_with("u_test", "creator")

            # Alias cc normalizes to creator
            payload_alias = AdminSetUserRolePayload(role="cc")
            res_alias = asyncio.run(api_admin_set_user_role("u_test", payload_alias, mock_request))
            self.assertEqual(res_alias.get("role"), "creator")

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

        # 3. Delete livestream
        del_ok = engine.delete_event_livestream(test_ev, new_stream["id"])
        self.assertTrue(del_ok)
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
                res = asyncio.run(api_save_event_livestream("ev_test", payload, mock_req))
                self.assertTrue(res.get("success"))

            with patch("routers.eventstudio._get_creator_or_to_session_or_403", side_effect=HTTPException(status_code=403, detail="Forbidden")):
                with self.assertRaises(HTTPException) as ctx:
                    asyncio.run(api_save_event_livestream("ev_test", payload, mock_req))
                self.assertEqual(ctx.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
