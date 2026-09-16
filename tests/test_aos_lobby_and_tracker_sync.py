"""Tests verifying Age of Sigmar (AoS) Match Lobby, Room Code Generation, Server Routing, and Session Sync Isolation."""

import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path
import sys

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from core import generate_unique_match_id
from routers.tracker import (
    TRACKER_ROOMS,
    TrackerCreatePayload,
    TrackerJoinPayload,
    api_tracker_create_room,
    api_tracker_check_room,
    api_tracker_join_room,
    _format_firestore_session_item
)


class TestAosLobbyAndTrackerSync(unittest.TestCase):

    def setUp(self):
        self.mock_db = MagicMock()
        self.mock_db.get_tracker_game.return_value = None

    def test_generate_unique_match_id_prefixes(self):
        """Verify AoS generates AOS- prefix and 40K generates WH40K- prefix."""
        aos_id = generate_unique_match_id(self.mock_db, game_system="aos")
        self.assertTrue(aos_id.startswith("AOS-"), f"Expected AOS- prefix, got {aos_id}")
        self.assertEqual(len(aos_id), 13)

        wh40k_id = generate_unique_match_id(self.mock_db, game_system="40k")
        self.assertTrue(wh40k_id.startswith("WH40K-"), f"Expected WH40K- prefix, got {wh40k_id}")
        self.assertEqual(len(wh40k_id), 15)

    @patch("routers.tracker.get_firestore_engine")
    @patch("routers.tracker.get_database")
    @patch("routers.tracker.get_auth_manager")
    async def _async_test_create_and_check_aos_room(self, mock_auth, mock_db, mock_fs):
        mock_auth.return_value.get_session.return_value = {
            "id": "u_test_aos",
            "display_name": "Sigmarite General"
        }
        mock_db.return_value.get_tracker_game.return_value = None
        mock_fs_inst = MagicMock()
        mock_fs.return_value = mock_fs_inst

        # 1. Create AoS Room
        req = MagicMock()
        req.headers = {"Authorization": "Bearer test-tok", "X-Game-System": "aos"}
        payload = TrackerCreatePayload(
            token="test-tok",
            game_system="aos",
            p1_name="Sigmarite General"
        )
        res = await api_tracker_create_room(req, payload)
        self.assertTrue(res["success"])
        self.assertTrue(res["match_id"].startswith("AOS-"))
        self.assertEqual(res["game_system"], "aos")
        self.assertEqual(res["role"], "player1")

        # 2. Check Room Status
        check_res = await api_tracker_check_room(res["match_id"], req)
        self.assertTrue(check_res["exists"])
        self.assertEqual(check_res["game_system"], "aos")
        self.assertTrue(check_res["is_open_for_p2"])

        # 3. Join Room as Player 2
        mock_auth.return_value.get_session.return_value = {
            "id": "u_test_p2",
            "display_name": "Chaos Warmaster"
        }
        join_payload = TrackerJoinPayload(
            token="test-p2-tok",
            player_name="Chaos Warmaster"
        )
        join_res = await api_tracker_join_room(res["match_id"], req, join_payload)
        self.assertTrue(join_res["success"])
        self.assertEqual(join_res["game_system"], "aos")
        self.assertEqual(join_res["role"], "player2")

    def test_create_and_check_aos_room(self):
        import asyncio
        asyncio.run(self._async_test_create_and_check_aos_room())

    def test_format_firestore_session_item_game_system(self):
        """Verify _format_firestore_session_item preserves or infers game_system correctly."""
        doc_aos = {
            "roomKey": "AOS-A1B2-C3D4",
            "p1_name": "Stormcast",
            "p2_name": "Skaven",
            "state": {"game_system": "aos", "round": 2}
        }
        fmt_aos = _format_firestore_session_item(doc_aos)
        self.assertEqual(fmt_aos["game_system"], "aos")

        doc_40k = {
            "roomKey": "WH40K-A1B2-C3D4",
            "p1_name": "Ultramarines",
            "p2_name": "Tyranids",
            "state": {"round": 1}
        }
        fmt_40k = _format_firestore_session_item(doc_40k)
        self.assertEqual(fmt_40k["game_system"], "40k")

    def test_server_tracker_routes_registration(self):
        """Verify server.py serves aos.html on active play/match sessions and lobby.html on landing."""
        with open(ROOT_DIR / "server.py", "r", encoding="utf-8") as f:
            server_src = f.read()

        self.assertIn("serve_tracker_sync_aos_js", server_src)
        self.assertIn("serve_tracker_bundle_aos_js", server_src)
        self.assertIn("serve_tracker_bundle_40k_js", server_src)
        self.assertIn("serve_tracker_aos_alias", server_src)
        self.assertIn('local_html_file = web_dir / "tracker" / "aos.html"', server_src)
        self.assertIn('local_html_file = web_dir / "tracker" / "lobby.html"', server_src)

    def test_dev_server_tracker_routes(self):
        """Verify scripts/dev_server.py serves aos.html on active play/match sessions and lobby.html on landing."""
        with open(ROOT_DIR / "scripts" / "dev_server.py", "r", encoding="utf-8") as f:
            dev_server_src = f.read()

        self.assertIn('TRACKER_DIR / "aos.html"', dev_server_src)
        self.assertIn('TRACKER_DIR / "lobby.html"', dev_server_src)
        self.assertIn('TRACKER_DIR / "bundle_aos.js"', dev_server_src)
        self.assertIn('TRACKER_DIR / "tracker_sync_aos.js"', dev_server_src)

    def test_tracker_sync_js_aos_lobby_logic(self):
        """Verify web/tracker/tracker_sync.js has dedicated AoS lobby handling."""
        with open(ROOT_DIR / "web" / "tracker" / "tracker_sync.js", "r", encoding="utf-8") as f:
            js_src = f.read()

        self.assertIn("⚡ AGE OF SIGMAR 2-PLAYER MATCH LOBBY", js_src)
        self.assertIn("CREATE & ENTER AOS MATCH ➔", js_src)
        self.assertIn("e.g. AOS-7A9B-3C4D", js_src)
        self.assertIn("AOS MATCH HISTORY", js_src)
        self.assertIn("window.location.href = `/11th/tracker/aos?match_id=", js_src)
        self.assertIn("window.location.href = `/11th/tracker/play?match_id=", js_src)
        self.assertIn("role=player2", js_src)


if __name__ == "__main__":
    unittest.main()
