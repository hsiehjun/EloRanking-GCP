#!/usr/bin/env python3
"""
Comprehensive Automated Test Suite for BCP Tournament Player Self-Management
============================================================================
Verifies:
1. BCP Adapter Player Management Methods:
   - fetch_gamesystem_factions (caching, normalization of factions and detachments)
   - update_player (MongoDB set/unset syntax to POST /v1/players/{playerId})
   - submit_armylist (POST /v1/armylists with playerId and listInfo)
   - checkin_player (POST /v1/players/{playerId} with checkedIn: True)
   - drop_player (POST /v1/players/{playerId} with dropped: True)
2. Community Router Endpoints:
   - GET /api/community/gamesystems/{gamesystem_id}/factions
   - GET /api/community/events/{event_id}/registration (player_registration payload)
   - POST /api/community/events/{event_id}/player (update details)
   - POST /api/community/events/{event_id}/armylist (submit list)
   - POST /api/community/events/{event_id}/checkin (guarded against missing army list)
   - POST /api/community/events/{event_id}/drop (drop player)
3. Frontend UI Integrity & Bundling:
   - Modal player subtab & view in app.html
   - API client methods in api.js
   - Tournament handlers in tournaments.js
   - My Hub check-in badges & Manage button in my_hub.js
   - Minified bundle compilation in app.bundle.min.js
"""

import sys
import json
import asyncio
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from core import HTTPException


def test_bcp_adapter_player_methods():
    """Verify BCP adapter factions caching, player update, army list submission, check-in, and drop."""
    from bcp_adapter import BcpAdapter

    # 1. Test fetch_gamesystem_factions & caching
    mock_factions_data = {
        "data": [
            {
                "id": "army_necrons_1",
                "name": "Necrons",
                "subFactions": [
                    {"id": "sub_awakened", "name": "Awakened Dynasty"},
                    {"id": "sub_canoptek", "name": "Canoptek Court"}
                ]
            },
            {
                "id": "army_custodes_2",
                "name": "Adeptus Custodes",
                "subFactions": [
                    {"id": "sub_shieldhost", "name": "Shield Host"}
                ]
            }
        ]
    }

    # Clear memory cache for clean test
    BcpAdapter._factions_cache.clear()

    with patch("bcp_adapter.BcpAdapter.execute_call") as mock_exec:
        mock_exec.return_value = (mock_factions_data, None)

        succ, err, factions = BcpAdapter.fetch_gamesystem_factions("WGMSzfKFYA")
        assert succ is True, f"Failed to fetch factions: {err}"
        assert len(factions) == 2
        assert factions[0]["name"] == "Necrons"
        assert len(factions[0]["subFactions"]) == 2
        assert factions[0]["subFactions"][0]["name"] == "Awakened Dynasty"

        # Verify caching: second call should NOT hit execute_call
        mock_exec.reset_mock()
        succ2, err2, factions2 = BcpAdapter.fetch_gamesystem_factions("WGMSzfKFYA")
        assert succ2 is True
        assert len(factions2) == 2
        assert not mock_exec.called, "Factions should be returned from memory cache without network call"

    # 2. Test update_player (MongoDB-style set/unset payload)
    with patch("bcp_adapter.BcpAdapter.execute_call") as mock_exec:
        mock_exec.return_value = ({"id": "player_123", "success": True}, None)

        succ, err, res = BcpAdapter.update_player(
            player_id="player_123",
            set_fields={"firstName": "Bruce", "lastName": "Wayne", "armyId": "army_necrons_1"},
            unset_fields={"teamId": True, "teamName": True},
            user_id="user_batman"
        )
        assert succ is True
        assert mock_exec.called
        call_args = mock_exec.call_args
        assert "players/player_123" in call_args[0][0]
        assert call_args[1]["method"] == "POST"
        body = call_args[1]["json_data"]
        assert body["set"]["firstName"] == "Bruce"
        assert body["set"]["armyId"] == "army_necrons_1"
        assert body["unset"]["teamId"] is True

    # 3. Test submit_armylist
    with patch("bcp_adapter.BcpAdapter.execute_call") as mock_exec:
        mock_exec.return_value = ({"id": "list_789", "success": True}, None)

        succ, err, res = BcpAdapter.submit_armylist(
            player_id="player_123",
            list_text="Overlord with Translocation Shroud\n10x Immortals",
            army_id="army_necrons_1",
            sub_faction_id="sub_awakened",
            user_id="user_batman"
        )
        assert succ is True
        assert mock_exec.called
        call_args = mock_exec.call_args
        assert "armylists" in call_args[0][0]
        assert call_args[1]["method"] == "POST"
        body = call_args[1]["json_data"]
        assert body["playerId"] == "player_123"
        assert body["listInfo"]["listText"] == "Overlord with Translocation Shroud\n10x Immortals"
        assert body["armyId"] == "army_necrons_1"
        assert body["subFactionId"] == "sub_awakened"

    # 4. Test checkin_player
    with patch("bcp_adapter.BcpAdapter.execute_call") as mock_exec:
        mock_exec.return_value = ({"id": "player_123", "checkedIn": True}, None)

        succ, err, res = BcpAdapter.checkin_player(
            player_id="player_123",
            user_id="user_batman"
        )
        assert succ is True
        assert mock_exec.called
        call_args = mock_exec.call_args
        assert "players/player_123" in call_args[0][0]
        body = call_args[1]["json_data"]
        assert body["set"]["checkedIn"] is True

    # 5. Test drop_player
    with patch("bcp_adapter.BcpAdapter.execute_call") as mock_exec:
        mock_exec.return_value = ({"id": "player_123", "dropped": True}, None)

        succ, err, res = BcpAdapter.drop_player(
            player_id="player_123",
            user_id="user_batman"
        )
        assert succ is True
        assert mock_exec.called
        call_args = mock_exec.call_args
        assert "players/player_123" in call_args[0][0]
        body = call_args[1]["json_data"]
        assert body["set"]["dropped"] is True

    print("✅ BCP Adapter player management methods verified!")


def test_community_router_player_endpoints():
    """Verify community endpoints for factions, player details update, list submission, guarded check-in, and drop."""
    from routers.community import (
        api_community_gamesystem_factions,
        api_community_event_registration,
        api_community_update_player,
        api_community_submit_armylist,
        api_community_checkin_player,
        api_community_drop_player,
        UpdateEventPlayerPayload,
        SubmitArmylistPayload,
        CheckinPlayerPayload,
        DropPlayerPayload
    )

    mock_db = MagicMock()
    mock_auth = MagicMock()

    mock_auth.get_session.return_value = {
        "id": "user_batman_999",
        "display_name": "Bruce Wayne",
        "email": "bruce@wayne-enterprises.com",
        "bcp_user_id": "bcp_uid_456"
    }
    mock_auth.get_valid_bcp_tokens.return_value = {"access_token": "valid_mock_token"}

    mock_db.get_tournament_by_id.return_value = {
        "id": "ev_gotham_gt",
        "name": "Gotham City GT 2026",
        "event_date": "2026-11-15T09:00:00Z",
        "using_online_reg": True,
        "ticket_price": 0.0,
        "total_players": 32,
        "gamesystem_id": "WGMSzfKFYA"
    }

    mock_registered_event = {
        "bcp_event_id": "ev_gotham_gt",
        "player_id": "player_bruce_101",
        "first_name": "Bruce",
        "last_name": "Wayne",
        "team_name": "Wayne Enterprises",
        "faction": "Necrons",
        "army_id": "army_necrons_1",
        "detachment": "Awakened Dynasty",
        "sub_faction_id": "sub_awakened",
        "checked_in": False,
        "dropped": False,
        "has_list_submitted": False,
        "army_list": ""
    }
    mock_db.get_user_registered_tournaments.return_value = [mock_registered_event]
    mock_db.get_user_army_lists.return_value = [
        {
            "id": "vault_list_1",
            "name": "Hypercrypt Strike Force",
            "faction": "Necrons",
            "detachment": "Hypercrypt Legion",
            "points": 2000,
            "raw_text": "C'tan Shard of the Void Dragon\nMonolith"
        }
    ]

    mock_req = MagicMock()
    mock_req.headers = {}
    mock_req.cookies = {}

    with patch("routers.community.get_database", return_value=mock_db), \
         patch("routers.community.get_auth_manager", return_value=mock_auth), \
         patch("core.get_auth_manager", return_value=mock_auth), \
         patch("auth.get_auth_manager", return_value=mock_auth):

        # 1. GET /api/community/gamesystems/{gamesystem_id}/factions
        with patch("bcp_adapter.BcpAdapter.fetch_gamesystem_factions", return_value=(True, None, [
            {"id": "army_1", "name": "Necrons", "subFactions": [{"id": "sub_1", "name": "Awakened"}]}
        ])):
            res_fac = asyncio.run(api_community_gamesystem_factions("WGMSzfKFYA"))
            assert res_fac["success"] is True
            assert len(res_fac["factions"]) == 1
            assert res_fac["factions"][0]["name"] == "Necrons"

        # 2. GET /api/community/events/{event_id}/registration returns player_registration dict
        res_reg = asyncio.run(api_community_event_registration("ev_gotham_gt", mock_req, token="test_token"))
        assert res_reg["success"] is True
        assert res_reg["is_registered"] is True
        p_reg = res_reg["player_registration"]
        assert p_reg is not None
        assert p_reg["player_id"] == "player_bruce_101"
        assert p_reg["first_name"] == "Bruce"
        assert p_reg["faction"] == "Necrons"
        assert p_reg["checked_in"] is False
        assert p_reg["has_list_submitted"] is False
        assert len(res_reg["army_lists"]) == 1
        assert res_reg["army_lists"][0]["name"] == "Hypercrypt Strike Force"

        # 3. POST /api/community/events/{event_id}/player (update player info)
        with patch("bcp_adapter.bcp_adapter.update_player", return_value=(True, None, {"success": True})):
            update_payload = UpdateEventPlayerPayload(
                player_id="player_bruce_101",
                first_name="Bruce",
                last_name="Wayne",
                team_name="Justice League",
                faction_name="Necrons",
                army_id="army_necrons_1",
                detachment_name="Hypercrypt Legion",
                sub_faction_id="sub_hypercrypt"
            )
            res_update = asyncio.run(api_community_update_player("ev_gotham_gt", update_payload, mock_req, token="test_token"))
            assert res_update["success"] is True

        # 4. POST /api/community/events/{event_id}/armylist (submit army list)
        with patch("bcp_adapter.bcp_adapter.submit_armylist", return_value=(True, None, {"id": "list_999"})):
            list_payload = SubmitArmylistPayload(
                player_id="player_bruce_101",
                list_text="Nightbringer\nVoid Dragon\n6x Wraiths",
                army_id="army_necrons_1",
                sub_faction_id="sub_hypercrypt"
            )
            res_list = asyncio.run(api_community_submit_armylist("ev_gotham_gt", list_payload, mock_req, token="test_token"))
            assert res_list["success"] is True

        # 5. POST /api/community/events/{event_id}/checkin GUARD TEST:
        # A) Explicit has_list=False triggers 400 Bad Request
        checkin_fail_payload = CheckinPlayerPayload(
            player_id="player_bruce_101",
            has_list=False
        )
        try:
            asyncio.run(api_community_checkin_player("ev_gotham_gt", checkin_fail_payload, mock_req, token="test_token"))
            assert False, "Should have rejected check-in without army list"
        except HTTPException as ex:
            assert ex.status_code == 400
            assert "army list must be submitted" in ex.detail.lower()

        # B) Direct checkin when list was already submitted in event registration
        mock_registered_event["has_list_submitted"] = True
        mock_registered_event["army_list"] = "Existing submitted list text"
        with patch("bcp_adapter.bcp_adapter.checkin_player", return_value=(True, None, {"checkedIn": True})) as mock_chk:
            checkin_ok_payload = CheckinPlayerPayload(
                player_id="player_bruce_101",
                has_list=True
            )
            res_chk_direct = asyncio.run(api_community_checkin_player("ev_gotham_gt", checkin_ok_payload, mock_req, token="test_token"))
            assert res_chk_direct["success"] is True
            assert mock_chk.called

        # 6. POST /api/community/events/{event_id}/drop (drop from tournament)
        with patch("bcp_adapter.bcp_adapter.drop_player", return_value=(True, None, {"dropped": True})) as mock_drp:
            drop_payload = DropPlayerPayload(player_id="player_bruce_101")
            res_drp = asyncio.run(api_community_drop_player("ev_gotham_gt", drop_payload, mock_req, token="test_token"))
            assert res_drp["success"] is True
            assert mock_drp.called

    print("✅ Community router player endpoints and check-in guard verified!")


def test_frontend_player_registration_components():
    """Verify HTML elements, JS methods, My Hub cards, and bundle compilation."""
    app_html = (ROOT_DIR / "web" / "app.html").read_text(encoding="utf-8")
    tourn_js = (ROOT_DIR / "web" / "js" / "tournaments.js").read_text(encoding="utf-8")
    api_js = (ROOT_DIR / "web" / "js" / "api.js").read_text(encoding="utf-8")
    hub_js = (ROOT_DIR / "web" / "js" / "my_hub.js").read_text(encoding="utf-8")
    bundle_js = (ROOT_DIR / "web" / "js" / "app.bundle.min.js").read_text(encoding="utf-8")

    # 1. Check app.html elements
    assert 'id="event-subtab-player"' in app_html, "event-subtab-player missing in app.html"
    assert 'id="event-view-player"' in app_html, "event-view-player container missing in app.html"
    assert 'id="player-reg-faction"' in app_html, "player-reg-faction select missing in app.html"
    assert 'id="player-reg-detachment"' in app_html, "player-reg-detachment select missing in app.html"
    assert 'id="player-reg-list-text"' in app_html, "player-reg-list-text textarea missing in app.html"
    assert 'id="player-reg-saved-lists-select"' in app_html, "player-reg-saved-lists-select dropdown missing in app.html"
    assert 'id="btn-player-checkin"' in app_html, "btn-player-checkin missing in app.html"
    assert 'id="btn-player-drop"' in app_html, "btn-player-drop missing in app.html"

    # 2. Check api.js endpoints
    assert "getGamesystemFactions" in api_js, "getGamesystemFactions missing in api.js"
    assert "updateEventPlayer" in api_js, "updateEventPlayer missing in api.js"
    assert "submitEventArmylist" in api_js, "submitEventArmylist missing in api.js"
    assert "checkinEventPlayer" in api_js, "checkinEventPlayer missing in api.js"
    assert "dropEventPlayer" in api_js, "dropEventPlayer missing in api.js"

    # 3. Check tournaments.js logic & handlers
    assert "switchEventModalTab" in tourn_js
    assert "loadGamesystemFactions" in tourn_js
    assert "populateFactionDropdown" in tourn_js
    assert "onPlayerFactionChange" in tourn_js
    assert "applySavedListToPlayerDetails" in tourn_js
    assert "handleEventPlayerUpdate" in tourn_js
    assert "handleEventPlayerSubmitList" in tourn_js
    assert "handleEventPlayerCheckin" in tourn_js
    assert "handleEventPlayerDrop" in tourn_js

    # 4. Check my_hub.js checkin status badge and Manage button
    assert "Checked In" in hub_js, "Checked In badge missing in my_hub.js"
    assert "Not Checked In" in hub_js, "Not Checked In badge missing in my_hub.js"
    assert "👤 Manage / Check In" in hub_js, "Manage / Check In button missing in my_hub.js"
    assert "openEventModal('${encodeURIComponent(evId)}', false, 'player')" in hub_js

    # 5. Check app.bundle.min.js compilation
    assert "getGamesystemFactions" in bundle_js, "getGamesystemFactions missing in bundle"
    assert "updateEventPlayer" in bundle_js, "updateEventPlayer missing in bundle"
    assert "submitEventArmylist" in bundle_js, "submitEventArmylist missing in bundle"
    assert "checkinEventPlayer" in bundle_js, "checkinEventPlayer missing in bundle"
    assert "dropEventPlayer" in bundle_js, "dropEventPlayer missing in bundle"
    assert "handleEventPlayerCheckin" in bundle_js, "handleEventPlayerCheckin missing in bundle"
    assert "Manage / Check In" in bundle_js, "Manage / Check In button missing in bundle"

    print("✅ Frontend player registration components and minified bundle verified!")


if __name__ == "__main__":
    print("🚀 Running BCP Tournament Player Self-Management Test Suite...")
    test_bcp_adapter_player_methods()
    test_community_router_player_endpoints()
    test_frontend_player_registration_components()
    print("\n🎉 ALL BCP PLAYER REGISTRATION WORKFLOW TESTS PASSED SUCCESSFULLY!")
