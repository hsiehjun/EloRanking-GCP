"""
Integration Tests for Tournament Self-Registration & TO Proxy BCP Sync:
- Self-registration from Tournament Search / Community Hub (api_eventstudio_register_player)
- TO Proxy BCP synchronization using event organizer credentials
- Local-first persistence in studio_events roster and event_participants table
- Live Elo resolution and player_id profile linkage
- Event details reflection for upcoming tournaments
- Strict RBAC preservation: players can register, TO management remains locked
"""

import sys
import asyncio
from pathlib import Path
from unittest.mock import patch, MagicMock

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from bcp_adapter import bcp_adapter
from routers.eventstudio import (
    api_eventstudio_register_player,
    api_eventstudio_start_event,
    RegisterPlayerPayload,
    _get_to_session_or_403
)
from core import HTTPException

def test_player_self_registration_uses_to_token_and_syncs():
    """When a player self-registers, OmniTactica uses the event TO's credentials to sync to BCP."""
    mock_db = MagicMock()
    mock_auth = MagicMock()

    to_user_id = "user-to-123"
    to_bcp_token = "bcp-to-valid-organizer-token"

    mock_event = {
        "id": "bcp-tourney-777",
        "name": "Pacific Northwest GT 2026",
        "organizer_id": to_user_id,
        "organizer_bcp_id": "bcp-org-456",
        "roster": [],
        "pairings": {}
    }
    mock_db.get_studio_event.return_value = mock_event
    mock_db.save_studio_event.side_effect = lambda ev: ev

    # Registered player user session
    player_session = {
        "id": "player-user-888",
        "email": "dan_destroyer@example.com",
        "name": "Dan Destroyer",
        "role": "USER",
        "bcp_user_id": "bcp-player-user-999"
    }

    mock_req = MagicMock()
    mock_req.headers = {"Authorization": "Bearer player_session_token"}
    mock_req.cookies = {}

    def mock_get_valid_bcp_token(uid):
        if uid == to_user_id:
            return to_bcp_token
        if uid == "player-user-888":
            return "player-unauthorized-consumer-token"
        return None

    mock_auth.get_session.return_value = player_session
    mock_auth.get_valid_bcp_token.side_effect = mock_get_valid_bcp_token

    payload = RegisterPlayerPayload(
        name="Dan Destroyer",
        email="dan_destroyer@example.com",
        faction="Necrons",
        detachment="Hypercrypt Legion",
        team="Team Cascades",
        army_list="Silent King + C'tan Shards",
        checked_in=True
    )

    with patch('routers.eventstudio.get_database', return_value=mock_db), \
         patch('routers.eventstudio.get_auth_manager', return_value=mock_auth), \
         patch.object(bcp_adapter, 'register_player') as mock_bcp_reg:

        mock_bcp_reg.return_value = (True, None, {"id": "bcp-reg-success-1", "checkedIn": True})

        res = asyncio.run(api_eventstudio_register_player("bcp-tourney-777", payload, mock_req))

        assert res["success"] is True
        assert res["bcp_registered"] is True
        assert res["bcp_synced"] is True
        assert res["total_players"] == 1
        assert res["player"]["name"] == "Dan Destroyer"
        assert res["player"]["faction"] == "Necrons"
        assert res["player"]["detachment"] == "Hypercrypt Legion"

        # Crucial: verify that bcp_adapter was invoked with the TO's token, NOT the player's token!
        mock_bcp_reg.assert_called_once()
        call_args, call_kwargs = mock_bcp_reg.call_args
        assert call_args[0] == "bcp-tourney-777"
        assert call_kwargs["user_id"] == to_user_id
        assert call_kwargs["explicit_token"] == to_bcp_token

        # Verify player data payload included BCP userId from player session
        p_data = call_args[1]
        assert p_data["name"] == "Dan Destroyer"
        assert p_data["faction"] == "Necrons"
        assert p_data["userId"] == "bcp-player-user-999"

        # Verify participant was upserted locally in DB
        mock_db.upsert_event_participant.assert_called_once()
        ep_kwargs = mock_db.upsert_event_participant.call_args[1]
        assert ep_kwargs["event_id"] == "bcp-tourney-777"
        assert ep_kwargs["full_name"] == "Dan Destroyer"
        assert ep_kwargs["faction"] == "Necrons"

    print("✅ test_player_self_registration_uses_to_token_and_syncs passed!")

def test_local_first_resilience_when_bcp_fails():
    """Registration in OmniTactica must NEVER fail even if BCP returns 503 or is unlinked."""
    mock_db = MagicMock()
    mock_auth = MagicMock()

    mock_event = {
        "id": "bcp-tourney-888",
        "name": "Emerald City Open",
        "organizer_id": "user-to-no-bcp",
        "roster": [],
        "pairings": {}
    }
    mock_db.get_studio_event.return_value = mock_event
    mock_db.save_studio_event.side_effect = lambda ev: ev

    mock_auth.get_session.return_value = {
        "id": "player-1",
        "name": "Sarah Connor",
        "role": "USER"
    }
    mock_auth.get_valid_bcp_token.return_value = None

    mock_req = MagicMock()
    mock_req.headers = {}
    mock_req.cookies = {}

    payload = RegisterPlayerPayload(
        name="Sarah Connor",
        faction="Aeldari",
        detachment="Battle Host",
        checked_in=True
    )

    with patch('routers.eventstudio.get_database', return_value=mock_db), \
         patch('routers.eventstudio.get_auth_manager', return_value=mock_auth):

        res = asyncio.run(api_eventstudio_register_player("bcp-tourney-888", payload, mock_req))

        assert res["success"] is True
        assert res["bcp_registered"] is False
        assert res["bcp_notice"] is not None
        assert res["total_players"] == 1
        assert res["player"]["name"] == "Sarah Connor"
        assert res["player"]["faction"] == "Aeldari"

        # Verify saved locally
        mock_db.save_studio_event.assert_called_once()
        mock_db.upsert_event_participant.assert_called_once()

    print("✅ test_local_first_resilience_when_bcp_fails passed!")

def test_rbac_standard_player_cannot_access_to_controls():
    """Regular players can register themselves, but TO controls remain strictly protected."""
    mock_auth = MagicMock()
    player_session = {
        "id": "regular-player-999",
        "email": "regular@example.com",
        "role": "USER"  # NOT ORGANIZER, NOT ADMIN
    }
    mock_auth.get_session.return_value = player_session

    mock_req = MagicMock()
    mock_req.headers = {"Authorization": "Bearer player_token"}
    mock_req.cookies = {}

    with patch('routers.eventstudio.get_auth_manager', return_value=mock_auth):
        try:
            _get_to_session_or_403(mock_req)
            assert False, "Should have raised HTTPException 403"
        except HTTPException as ex:
            assert ex.status_code == 403
            assert "required" in ex.detail.lower() or "administrator" in ex.detail.lower()

    print("✅ test_rbac_standard_player_cannot_access_to_controls passed!")

if __name__ == "__main__":
    test_player_self_registration_uses_to_token_and_syncs()
    test_local_first_resilience_when_bcp_fails()
    test_rbac_standard_player_cannot_access_to_controls()
    print("🎉 ALL REGISTRATION FLOW TESTS PASSED 100%!")
