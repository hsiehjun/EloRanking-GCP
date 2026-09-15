"""Unit tests for BCP Army List endpoint and tournament roster integration."""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio
import unittest
from unittest.mock import patch, MagicMock
from core import HTTPException

os.environ["PORT"] = "8080"
from routers.armylists import api_get_bcp_armylist
from routers.leaderboard import format_bcp_roster_to_players

class MockRequest:
    def __init__(self, headers=None, cookies=None):
        self.headers = headers or {}
        self.cookies = cookies or {}

class TestBcpArmylistIntegration(unittest.TestCase):
    def test_bcp_armylist_missing_id(self):
        req = MockRequest()
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(api_get_bcp_armylist("   ", req))
        self.assertEqual(ctx.exception.status_code, 400)

    @patch("routers.armylists.get_auth_manager")
    def test_bcp_armylist_unlinked_requires_bcp_link(self, mock_auth_mgr):
        mgr = MagicMock()
        mgr.get_session.return_value = None
        mgr.get_valid_bcp_token.return_value = None
        mgr.get_any_valid_bcp_token.return_value = None
        mock_auth_mgr.return_value = mgr

        req = MockRequest()
        data = asyncio.run(api_get_bcp_armylist("fnC5PtZin8ev", req))
        self.assertFalse(data["success"])
        self.assertTrue(data["requires_bcp_link"])
        self.assertEqual(data["list_id"], "fnC5PtZin8ev")

    @patch("routers.armylists.get_auth_manager")
    @patch("bcp_adapter.BcpAdapter.fetch_armylist")
    def test_bcp_armylist_success_with_token(self, mock_fetch, mock_auth_mgr):
        mgr = MagicMock()
        mgr.get_session.return_value = {"id": "user_42"}
        mgr.get_valid_bcp_token.return_value = "bcp_jwt_token_123"
        mock_auth_mgr.return_value = mgr

        mock_fetch.return_value = (
            True,
            None,
            {
                "id": "fnC5PtZin8ev",
                "name": "Alex Chaos List",
                "armyListText": "++ Army Roster ++ (Chaos - Chaos Space Marines) [2,000 pts]\nCharacters:\nChaos Lord",
                "armyId": "csm_id",
                "subFactionId": "raiders_id"
            }
        )

        req = MockRequest(headers={"Authorization": "Bearer session_token_123"})
        data = asyncio.run(api_get_bcp_armylist("fnC5PtZin8ev", req))
        self.assertTrue(data["success"])
        self.assertEqual(data["list_id"], "fnC5PtZin8ev")
        self.assertIn("Chaos Space Marines", data["text"])
        self.assertEqual(data["name"], "Alex Chaos List")

    @patch("routers.armylists.get_auth_manager")
    @patch("bcp_adapter.BcpAdapter.fetch_armylist")
    def test_bcp_armylist_auth_failure_triggers_requires_link(self, mock_fetch, mock_auth_mgr):
        mgr = MagicMock()
        mgr.get_session.return_value = {"id": "user_42"}
        mgr.get_valid_bcp_token.return_value = "expired_token"
        mock_auth_mgr.return_value = mgr

        mock_fetch.return_value = (False, "HTTP 401: Unauthorized access", None)

        req = MockRequest(headers={"X-BCP-Token": "expired_token"})
        data = asyncio.run(api_get_bcp_armylist("fnC5PtZin8ev", req))
        self.assertFalse(data["success"])
        self.assertTrue(data["requires_bcp_link"])

    def test_leaderboard_format_bcp_roster_extracts_list_id(self):
        raw_players = [
            {
                "id": "bcp_p1",
                "firstName": "Alex",
                "lastName": "Spathopoulos",
                "armyList": "/list/fnC5PtZin8ev",
                "army": {"name": "Chaos Space Marines"}
            },
            {
                "id": "bcp_p2",
                "firstName": "Folger",
                "lastName": "Pyles",
                "armyList": "++ Army Roster ++ Custodes [2000 pts]",
                "army": {"name": "Adeptus Custodes"}
            },
            {
                "id": "bcp_p3",
                "firstName": "Empty",
                "lastName": "Player"
            }
        ]

        formatted = format_bcp_roster_to_players(raw_players, [], is_ended=False)
        self.assertEqual(len(formatted), 3)

        # Alex: has list_id and list_url, army_list is cleaned of URL
        alex = formatted[0]
        self.assertEqual(alex["list_id"], "fnC5PtZin8ev")
        self.assertEqual(alex["list_url"], "https://www.bestcoastpairings.com/list/fnC5PtZin8ev")
        self.assertEqual(alex["army_list"], "")
        self.assertTrue(alex["has_list"])

        # Folger: has text list, no list_url
        folger = formatted[1]
        self.assertEqual(folger["list_id"], "")
        self.assertIn("Custodes", folger["army_list"])
        self.assertTrue(folger["has_list"])

        # Empty: no list
        empty = formatted[2]
        self.assertEqual(empty["list_id"], "")
        self.assertFalse(empty["has_list"])
        self.assertEqual(empty["faction"], "-")

if __name__ == "__main__":
    unittest.main()
