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


def test_bcp_player_id_resolution():
    """Verify authentic BCP player ID resolution, fast rejection of event/user IDs, and self-healing retries."""
    from bcp_adapter import BcpAdapter
    from routers.community import (
        api_community_update_player,
        api_community_event_registration,
        UpdateEventPlayerPayload
    )

    event_id = "Xeqy73dRB0LL"
    real_player_id = "9oEfu25ccjqE"
    user_id = "user_hsiehjun"

    mock_auth = MagicMock()
    mock_auth.get_user_by_id.return_value = {
        "id": user_id,
        "bcp_user_id": "3448a468-90c1-7094-1f63-b06190b0e2bd",
        "email": "swimgeek751@gmail.com",
        "display_name": "Jun Hsieh"
    }
    mock_auth.get_session.return_value = {
        "id": user_id,
        "bcp_user_id": "3448a468-90c1-7094-1f63-b06190b0e2bd",
        "email": "swimgeek751@gmail.com",
        "display_name": "Jun Hsieh"
    }
    mock_auth.get_valid_bcp_tokens.return_value = {"access_token": "mock_tok"}

    with patch("core.get_auth_manager", return_value=mock_auth), \
         patch("auth.get_auth_manager", return_value=mock_auth):

        # 1. Candidate is already a valid player ID
        res_valid = BcpAdapter.resolve_event_player_id(event_id, user_id, candidate_pid=real_player_id)
        assert res_valid == real_player_id, f"Expected {real_player_id}, got {res_valid}"

        # 2. Candidate is equal to event_id (the bug that caused 404!)
        with patch("bcp_adapter.BcpAdapter.fetch_user_registered_events") as mock_fetch:
            mock_fetch.return_value = (True, None, [
                {"bcp_event_id": event_id, "player_id": real_player_id, "bcp_player_id": real_player_id}
            ])
            res_resolved = BcpAdapter.resolve_event_player_id(event_id, user_id, candidate_pid=event_id)
            assert res_resolved == real_player_id, f"Expected {real_player_id}, got {res_resolved}"
            assert res_resolved != event_id

        # 3. Candidate is internal user ID
        with patch("bcp_adapter.BcpAdapter.fetch_user_registered_events") as mock_fetch:
            mock_fetch.return_value = (True, None, [
                {"bcp_event_id": event_id, "player_id": real_player_id, "bcp_player_id": real_player_id}
            ])
            res_user = BcpAdapter.resolve_event_player_id(event_id, user_id, candidate_pid="user_hsiehjun")
            assert res_user == real_player_id

        # 4. Strategy 2 resolution via /events/{event_id}/players endpoint
        with patch("bcp_adapter.BcpAdapter.fetch_user_registered_events", return_value=(False, "Failed", [])), \
             patch("bcp_adapter.BcpAdapter.execute_call") as mock_exec:
            mock_exec.return_value = ({
                "data": [
                    {
                        "id": real_player_id,
                        "userId": "3448a468-90c1-7094-1f63-b06190b0e2bd",
                        "user": {"firstName": "Jun", "lastName": "Hsieh", "email": "swimgeek751@gmail.com"}
                    }
                ]
            }, None)
            res_strat2 = BcpAdapter.resolve_event_player_id(event_id, user_id, candidate_pid=None)
            assert res_strat2 == real_player_id

    # 5. api_community_update_player with candidate equal to event_id resolves and self-heals
    mock_db = MagicMock()
    mock_db.get_tournament_by_id.return_value = {"id": event_id, "name": "hsiehjun test"}
    mock_req = MagicMock()
    mock_req.headers = {}
    mock_req.cookies = {}

    with patch("routers.community.get_database", return_value=mock_db), \
         patch("routers.community.get_auth_manager", return_value=mock_auth), \
         patch("core.get_auth_manager", return_value=mock_auth), \
         patch("bcp_adapter.BcpAdapter.resolve_event_player_id", return_value=real_player_id), \
         patch("bcp_adapter.bcp_adapter.update_player", return_value=(True, None, {"success": True})) as mock_upd:
        
        upd_payload = UpdateEventPlayerPayload(
            player_id=event_id,  # Client mistakenly passes event_id
            first_name="Jun",
            last_name="Hsieh"
        )
        res_upd = asyncio.run(api_community_update_player(event_id, upd_payload, mock_req, token="test_token"))
        assert res_upd["success"] is True
        assert res_upd["player_id"] == real_player_id
        # Verify bcp_adapter was called with the REAL player ID, NOT the event ID
        assert mock_upd.call_args[1]["player_id"] == real_player_id

    # 6. api_community_event_registration heals player_id in DB if it was event_id
    mock_db.get_user_registered_tournaments.return_value = [
        {"id": event_id, "bcp_event_id": event_id, "player_id": event_id}
    ]
    with patch("routers.community.get_database", return_value=mock_db), \
         patch("routers.community.get_auth_manager", return_value=mock_auth), \
         patch("core.get_auth_manager", return_value=mock_auth), \
         patch("bcp_adapter.BcpAdapter.resolve_event_player_id", return_value=real_player_id):
        
        reg_res = asyncio.run(api_community_event_registration(event_id, mock_req, token="test_token"))
        assert reg_res["success"] is True
        assert reg_res["player_registration"]["player_id"] == real_player_id
        # Verify db.add_user_registered_tournament was called to heal the DB
        assert mock_db.add_user_registered_tournament.called
        heal_call = mock_db.add_user_registered_tournament.call_args[0][1]
        assert heal_call["player_id"] == real_player_id
        assert heal_call["bcp_player_id"] == real_player_id

    print("✅ BCP authentic player ID resolution and self-healing verified!")


def test_player_registration_state_preservation():
    """Verify that updating player registration fields preserves previously submitted lists and checked-in status."""
    from routers.community import (
        api_community_update_player,
        api_community_submit_armylist,
        api_community_checkin_player,
        api_community_event_registration,
        UpdateEventPlayerPayload,
        SubmitArmylistPayload,
        CheckinPlayerPayload
    )

    event_id = "test_event_preserve"
    player_id = "test_player_preserve"
    user_id = "user_test_preserve"

    mock_auth = MagicMock()
    mock_auth.get_user_by_id.return_value = {
        "id": user_id,
        "bcp_user_id": "bcp_test_uid",
        "email": "test@example.com",
        "display_name": "Test General"
    }
    mock_auth.get_session.return_value = {
        "id": user_id,
        "bcp_user_id": "bcp_test_uid",
        "email": "test@example.com",
        "display_name": "Test General"
    }
    mock_auth.get_valid_bcp_tokens.return_value = {"access_token": "mock_tok"}

    mock_db = MagicMock()
    mock_req = MagicMock()
    mock_req.headers = {"Authorization": "Bearer test_token"}
    mock_req.cookies = {}

    # 1. Test update_player stores army_id and sub_faction_id into DB
    with patch("routers.community.get_database", return_value=mock_db), \
         patch("routers.community.get_auth_manager", return_value=mock_auth), \
         patch("core.get_auth_manager", return_value=mock_auth), \
         patch("bcp_adapter.BcpAdapter.resolve_event_player_id", return_value=player_id), \
         patch("bcp_adapter.BcpAdapter.update_player", return_value=(True, None, {"success": True})):

        upd_payload = UpdateEventPlayerPayload(
            player_id=player_id,
            first_name="Roboute",
            last_name="Guilliman",
            team_name="Ultramarine Champions",
            army_id="army_sm_01",
            sub_faction_id="sub_gladius_01",
            faction_name="Space Marines",
            detachment_name="Gladius Task Force"
        )
        upd_res = asyncio.run(api_community_update_player(event_id, upd_payload, mock_req, token="test_token"))
        assert upd_res["success"] is True

        # Verify db.add_user_registered_tournament was called with army_id and sub_faction_id
        assert mock_db.add_user_registered_tournament.called
        last_saved = mock_db.add_user_registered_tournament.call_args[0][1]
        assert last_saved["army_id"] == "army_sm_01"
        assert last_saved["sub_faction_id"] == "sub_gladius_01"
        assert last_saved["faction"] == "Space Marines"
        assert last_saved["detachment"] == "Gladius Task Force"
        assert last_saved["team"] == "Ultramarine Champions"

    # 2. Test submit_armylist preserves army_id/sub_faction_id and sets has_list_submitted
    mock_db.reset_mock()
    with patch("routers.community.get_database", return_value=mock_db), \
         patch("routers.community.get_auth_manager", return_value=mock_auth), \
         patch("core.get_auth_manager", return_value=mock_auth), \
         patch("bcp_adapter.BcpAdapter.resolve_event_player_id", return_value=player_id), \
         patch("bcp_adapter.BcpAdapter.submit_armylist", return_value=(True, None, {"success": True})):

        army_payload = SubmitArmylistPayload(
            player_id=player_id,
            list_text="++ Army List ++ 2000pts",
            army_id="army_sm_01",
            sub_faction_id="sub_gladius_01"
        )
        army_res = asyncio.run(api_community_submit_armylist(event_id, army_payload, mock_req, token="test_token"))
        assert army_res["success"] is True

        assert mock_db.add_user_registered_tournament.called
        saved_list = mock_db.add_user_registered_tournament.call_args[0][1]
        assert saved_list["army_list"] == "++ Army List ++ 2000pts"
        assert saved_list["has_list_submitted"] is True
        assert saved_list["army_id"] == "army_sm_01"
        assert saved_list["sub_faction_id"] == "sub_gladius_01"

    # 3. Test checkin_player marks checked_in True
    mock_db.reset_mock()
    with patch("routers.community.get_database", return_value=mock_db), \
         patch("routers.community.get_auth_manager", return_value=mock_auth), \
         patch("core.get_auth_manager", return_value=mock_auth), \
         patch("bcp_adapter.BcpAdapter.resolve_event_player_id", return_value=player_id), \
         patch("bcp_adapter.BcpAdapter.checkin_player", return_value=(True, None, {"success": True})):

        chk_payload = CheckinPlayerPayload(player_id=player_id, has_list=True)
        chk_res = asyncio.run(api_community_checkin_player(event_id, chk_payload, mock_req, token="test_token"))
        assert chk_res["success"] is True

        assert mock_db.add_user_registered_tournament.called
        saved_chk = mock_db.add_user_registered_tournament.call_args[0][1]
        assert saved_chk["checked_in"] is True

    # 4. Test api_community_event_registration returns all preserved fields
    mock_db.reset_mock()
    mock_db.get_user_registered_tournaments.return_value = [
        {
            "id": event_id,
            "bcp_event_id": event_id,
            "player_id": player_id,
            "first_name": "Roboute",
            "last_name": "Guilliman",
            "player_name": "Roboute Guilliman",
            "team_name": "Ultramarine Champions",
            "faction": "Space Marines",
            "detachment": "Gladius Task Force",
            "army_id": "army_sm_01",
            "sub_faction_id": "sub_gladius_01",
            "army_list": "++ Army List ++ 2000pts",
            "has_list_submitted": True,
            "checked_in": True,
            "dropped": False
        }
    ]
    with patch("routers.community.get_database", return_value=mock_db), \
         patch("routers.community.get_auth_manager", return_value=mock_auth), \
         patch("core.get_auth_manager", return_value=mock_auth), \
         patch("bcp_adapter.BcpAdapter.fetch_user_registered_events", return_value=(False, "offline", [])):

        reg_res = asyncio.run(api_community_event_registration(event_id, mock_req, token="test_token"))
        assert reg_res["success"] is True
        assert reg_res["is_registered"] is True
        p_reg = reg_res["player_registration"]
        assert p_reg["first_name"] == "Roboute"
        assert p_reg["last_name"] == "Guilliman"
        assert p_reg["team_name"] == "Ultramarine Champions"
        assert p_reg["faction"] == "Space Marines"
        assert p_reg["detachment"] == "Gladius Task Force"
        assert p_reg["army_id"] == "army_sm_01"
        assert p_reg["sub_faction_id"] == "sub_gladius_01"
        assert p_reg["army_list"] == "++ Army List ++ 2000pts"
        assert p_reg["has_list_submitted"] is True
        assert p_reg["checked_in"] is True

    print("✅ Player registration state preservation verified!")


def test_current_player_and_armylist_live_sync():
    """Verify BCP /events/{id}/currentPlayer and /armylists/{id} live sync for registration view."""
    from bcp_adapter import BcpAdapter
    from routers.community import api_community_event_registration

    raw_current_player = {
        "id": "rsoPZetp7Ejn",
        "eventId": "sy5pqLqvkdpU",
        "userId": "DxHDrz4LFzzb",
        "user": {"id": "DxHDrz4LFzzb", "firstName": "John4", "lastName": "Hsieh4", "email": "hsiehjun@google.com"},
        "checkedIn": True,
        "dropped": False,
        "parentFactionId": "SDmMBAJZf8",
        "factionId": "H1zsiowQJ9",
        "faction": {"id": "H1zsiowQJ9", "name": "Blood Angels"},
        "subFactionId": "6a348af284eb2fad86d6ead2",
        "subFaction": {"id": "6a348af284eb2fad86d6ead2", "name": "Disruption"},
        "listId": "BtRNRqITthMM",
        "listUrl": "/list/BtRNRqITthMM"
    }

    raw_armylist = {
        "id": "BtRNRqITthMM",
        "playerId": "rsoPZetp7Ejn",
        "armyListText": "BLOOOOD",
        "armyId": "H1zsiowQJ9",
        "subFactionId": "6a348af284eb2fad86d6ead2"
    }

    def mock_execute(url, method="POST", **kwargs):
        if "currentPlayer" in url:
            return raw_current_player, None
        elif "armylists/BtRNRqITthMM" in url:
            return raw_armylist, None
        return {}, None

    with patch("bcp_adapter.BcpAdapter.execute_call", side_effect=mock_execute):
        # 1. Direct adapter test
        succ, err, cp_data = BcpAdapter.fetch_event_current_player("sy5pqLqvkdpU", explicit_token="mock_tok")
        assert succ is True
        assert cp_data["id"] == "rsoPZetp7Ejn"
        assert cp_data["checkedIn"] is True
        assert cp_data["factionId"] == "H1zsiowQJ9"
        assert cp_data["armyListText"] == "BLOOOOD"

        # 2. Strategy 0 in resolve_event_player_id
        resolved_pid = BcpAdapter.resolve_event_player_id("sy5pqLqvkdpU", user_id="u1", ignore_candidate=True, explicit_token="mock_tok")
        assert resolved_pid == "rsoPZetp7Ejn"

        # 3. Community event registration endpoint test
        mock_db = MagicMock()
        mock_auth = MagicMock()
        mock_auth.get_session.return_value = {
            "id": "user_john",
            "display_name": "John4 Hsieh4",
            "email": "hsiehjun@google.com"
        }
        mock_db.get_event_details.return_value = {
            "id": "sy5pqLqvkdpU",
            "name": "Warhammer 40k Tournament",
            "using_online_reg": True,
            "ticket_price": 0.0,
            "total_players": 16,
            "gamesystem_id": "WGMSzfKFYA"
        }
        mock_db.get_user_registered_tournaments.return_value = []
        mock_db.get_user_army_lists.return_value = []

        mock_req = MagicMock()
        mock_req.headers = {"X-BCP-Token": "test_bcp_token"}
        mock_req.cookies = {}

        with patch("routers.community.get_database", return_value=mock_db), \
             patch("routers.community.get_auth_manager", return_value=mock_auth), \
             patch("core.get_auth_manager", return_value=mock_auth):

            res = asyncio.run(api_community_event_registration("sy5pqLqvkdpU", mock_req, token="session_123"))
            assert res["success"] is True
            assert res["is_registered"] is True
            p_reg = res["player_registration"]
            assert p_reg is not None
            assert p_reg["player_id"] == "rsoPZetp7Ejn"
            assert p_reg["first_name"] == "John4"
            assert p_reg["last_name"] == "Hsieh4"
            assert p_reg["faction"] == "Blood Angels"
            assert p_reg["army_id"] == "H1zsiowQJ9"
            assert p_reg["detachment"] == "Disruption"
            assert p_reg["sub_faction_id"] == "6a348af284eb2fad86d6ead2"
            assert p_reg["checked_in"] is True
            assert p_reg["army_list"] == "BLOOOOD"
            assert p_reg["has_list_submitted"] is True

    print("✅ /currentPlayer and /armylists live sync verified!")


if __name__ == "__main__":
    print("🚀 Running BCP Tournament Player Self-Management Test Suite...")
    test_bcp_adapter_player_methods()
    test_bcp_player_id_resolution()
    test_community_router_player_endpoints()
    test_frontend_player_registration_components()
    test_player_registration_state_preservation()
    test_current_player_and_armylist_live_sync()
    print("\n🎉 ALL BCP PLAYER REGISTRATION WORKFLOW TESTS PASSED SUCCESSFULLY!")

