"""
Unit & Integration Tests for Phase 1: BCP newapi Adapter & Registration Reliability
"""
import os
import sys
import json
from pathlib import Path
from unittest.mock import patch, MagicMock

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from bcp_adapter import bcp_adapter, BcpAdapter
from config import BCP_API_BASE
from routers.eventstudio import (
    generate_swiss_pairings_for_event,
    api_eventstudio_start_event,
    api_eventstudio_register_player,
    api_eventstudio_submit_score,
    RegisterPlayerPayload,
    SubmitScorePayload
)
from core import HTTPException

def test_bcp_adapter_start_event_url():
    """Verify start_event_or_generate_pairings calls real newapi /generatePairings endpoint."""
    with patch.object(BcpAdapter, 'execute_call') as mock_exec:
        mock_exec.return_value = ({'success': True, 'round': 1}, None)
        success, err, data = bcp_adapter.start_event_or_generate_pairings('EV123')
        assert success is True
        assert err is None
        mock_exec.assert_called_once_with(
            f"{BCP_API_BASE}/events/EV123/generatePairings",
            method="POST",
            user_id=None,
            explicit_token=None
        )
    print("✅ test_bcp_adapter_start_event_url passed!")

def test_bcp_adapter_register_player_payload():
    """Verify register_player formats payload matching BCP newapi /players schema."""
    with patch.object(BcpAdapter, 'execute_call') as mock_exec:
        mock_exec.return_value = ({'id': 'PL_999'}, None)
        player_info = {
            'name': 'Roboute Guilliman',
            'email': 'primarch@ultramar.com',
            'faction': 'Ultramarines',
            'detachment': 'Gladius Task Force',
            'checked_in': True,
            'army_list': '10x Intercessors'
        }
        success, err, data = bcp_adapter.register_player('EV123', player_info)
        assert success is True
        assert data == {'id': 'PL_999'}
        
        args, kwargs = mock_exec.call_args
        assert args[0] == f"{BCP_API_BASE}/players"
        assert kwargs['method'] == 'POST'
        body = kwargs['json_data']
        assert body['eventId'] == 'EV123'
        assert body['checkedIn'] is True
        assert body['user']['firstName'] == 'Roboute'
        assert body['user']['lastName'] == 'Guilliman'
        assert body['user']['email'] == 'primarch@ultramar.com'
        assert body['army'] == 'Ultramarines'
        assert body['detachment'] == 'Gladius Task Force'
    print("✅ test_bcp_adapter_register_player_payload passed!")

def test_bcp_adapter_submit_scores_url():
    """Verify submit_pairing_scores targets /pairings/{id}/submitScores."""
    with patch.object(BcpAdapter, 'execute_call') as mock_exec:
        mock_exec.return_value = ({'success': True}, None)
        success, err = bcp_adapter.submit_pairing_scores('PAIR_456', 85, 72)
        assert success is True
        args, kwargs = mock_exec.call_args
        assert args[0] == f"{BCP_API_BASE}/pairings/PAIR_456/submitScores"
        assert kwargs['json_data']['gameData']['player1Score'] == 85
        assert kwargs['json_data']['gameData']['player2Score'] == 72
    print("✅ test_bcp_adapter_submit_scores_url passed!")

def test_swiss_pairings_generation():
    """Verify local Swiss pairing generator creates valid, Elo-predicted table matchups."""
    test_event = {
        "id": "ES-TEST-1",
        "startingTable": 1,
        "roster": [
            {"id": "P1", "name": "Alice", "faction": "Aeldari", "elo": 1650, "team": "Team Alpha"},
            {"id": "P2", "name": "Bob", "faction": "Necrons", "elo": 1550, "team": "Team Beta"},
            {"id": "P3", "name": "Charlie", "faction": "Orks", "elo": 1500, "team": "Team Alpha"},
            {"id": "P4", "name": "Dave", "faction": "Space Marines", "elo": 1400, "team": "Team Gamma"}
        ],
        "pairings": {}
    }
    pairings = generate_swiss_pairings_for_event(test_event, 1)
    assert len(pairings) == 2
    assert pairings[0]["table"] == 1
    assert pairings[1]["table"] == 2
    for p in pairings:
        assert "p1_name" in p and "p2_name" in p
        assert "p1_win_prob" in p and "p2_win_prob" in p
        assert abs(p["p1_win_prob"] + p["p2_win_prob"] - 100.0) < 0.2
    print("✅ test_swiss_pairings_generation passed!")

def test_start_event_local_first():
    """Verify starting an event auto-generates round 1 pairings and marks event active."""
    mock_db = MagicMock()
    mock_auth = MagicMock()
    
    mock_event = {
        "id": "ES-LOCAL-1",
        "name": "Test Tournament",
        "current_round": 0,
        "started": False,
        "status": "upcoming",
        "roster": [
            {"id": "P1", "name": "Alice", "faction": "Aeldari", "elo": 1600},
            {"id": "P2", "name": "Bob", "faction": "Necrons", "elo": 1500}
        ],
        "pairings": {}
    }
    mock_db.get_studio_event.return_value = mock_event
    mock_db.save_studio_event.side_effect = lambda e: e

    mock_req = MagicMock()
    mock_req.headers = {"Authorization": "Bearer test_token"}
    mock_req.cookies = {}
    
    admin_session = {
        "id": "admin_user",
        "email": "swimgeek751@gmail.com",
        "role": "admin"
    }
    mock_auth.get_session.return_value = admin_session

    import asyncio
    with patch('routers.eventstudio.get_database', return_value=mock_db),          patch('routers.eventstudio.get_auth_manager', return_value=mock_auth):
        res = asyncio.run(api_eventstudio_start_event('ES-LOCAL-1', mock_req))
        assert res['success'] is True
        assert res['started'] is True
        assert res['current_round'] == 1
        assert 'pairings' in res['event']
        assert '1' in res['event']['pairings']
        assert len(res['event']['pairings']['1']) == 1
        assert res['event']['pairings']['1'][0]['table'] == 1
    print("✅ test_start_event_local_first passed!")

def test_score_submission_local_save():
    """Verify submitting a score updates local event database."""
    mock_db = MagicMock()
    mock_auth = MagicMock()
    
    mock_event = {
        "id": "ES-SCORE-1",
        "pairings": {
            "1": [
                {"table": 1, "p1_name": "Alice", "p2_name": "Bob", "p1_score": 0, "p2_score": 0, "is_done": False}
            ]
        }
    }
    mock_db.get_studio_event.return_value = mock_event
    mock_db.save_studio_event.side_effect = lambda e: e

    mock_req = MagicMock()
    mock_req.headers = {}
    mock_req.cookies = {}
    mock_auth.get_session.return_value = None

    payload = SubmitScorePayload(
        event_id="ES-SCORE-1",
        table=1,
        round_num=1,
        p1_score=92,
        p2_score=68
    )

    import asyncio
    with patch('routers.eventstudio.get_database', return_value=mock_db),          patch('routers.eventstudio.get_auth_manager', return_value=mock_auth):
        res = asyncio.run(api_eventstudio_submit_score(payload, mock_req))
        assert res['success'] is True
        assert res['p1_score'] == 92
        assert res['p2_score'] == 68
        
        # Verify local event in DB was updated
        updated_match = mock_event['pairings']['1'][0]
        assert updated_match['p1_score'] == 92
        assert updated_match['p2_score'] == 68
        assert updated_match['is_done'] is True
    print("✅ test_score_submission_local_save passed!")

def test_eventstudio_create_and_delete_flow():
    """Verify tournament creation and deletion push directly to BCP API without headless browser."""
    from routers.eventstudio import api_eventstudio_create_event, api_eventstudio_delete_event, CreateEventPayload
    from core import Request
    import asyncio

    req = MagicMock(spec=Request)
    req.headers = {"Authorization": "Bearer test_token"}
    req.cookies = {}

    mock_user = {
        "id": "user_john_123",
        "email": "swimgeek751@gmail.com",
        "role": "admin",
        "player_id": "MEV83VFANA",
        "bcp_user_id": "sub_john_uuid"
    }

    with patch("routers.eventstudio._get_to_session_or_403", return_value=mock_user), \
         patch("routers.eventstudio.get_auth_manager") as mock_auth, \
         patch("routers.eventstudio.get_database") as mock_db, \
         patch("routers.eventstudio.execute_bcp_api_call") as mock_bcp:
        
        auth_inst = MagicMock()
        auth_inst.get_valid_bcp_tokens.return_value = {"access_token": "acc_tok_123", "id_token": "id_tok_123"}
        auth_inst.get_valid_bcp_token.return_value = "acc_tok_123"
        mock_auth.return_value = auth_inst

        db_inst = MagicMock()
        db_inst.save_studio_event.return_value = True
        mock_db.return_value = db_inst

        mock_bcp.return_value = ({"id": "BCP_EV_999", "name": "SoCal Open"}, None)

        payload = CreateEventPayload(
            name="SoCal Open",
            venue="San Diego Convention Center",
            city="San Diego",
            state="CA",
            rounds=5,
            points=2000
        )

        res = asyncio.run(api_eventstudio_create_event(payload, req))
        assert res["success"] is True
        assert res["bcp_registered"] is True
        assert res["event_id"] == "BCP_EV_999"

        # Verify BCP call arguments
        call_args = mock_bcp.call_args
        assert call_args[0][0] == f"{BCP_API_BASE}/events"
        assert call_args[1]["json_data"]["ownerId"] == "MEV83VFANA"
        assert call_args[1]["explicit_token"] == "acc_tok_123"

        # Verify Event Deletion
        mock_bcp.return_value = ({"success": True}, None)
        del_res = asyncio.run(api_eventstudio_delete_event("BCP_EV_999", req))
        assert del_res["success"] is True
        assert del_res["bcp_deleted"] is True
        del_call_args = mock_bcp.call_args
        assert del_call_args[0][0] == "https://newprod-api.bestcoastpairings.com/v1/events/BCP_EV_999"
        assert del_call_args[1]["method"] == "DELETE"

    print("✅ test_eventstudio_create_and_delete_flow passed!")

if __name__ == '__main__':
    test_bcp_adapter_start_event_url()
    test_bcp_adapter_register_player_payload()
    test_bcp_adapter_submit_scores_url()
    test_swiss_pairings_generation()
    test_start_event_local_first()
    test_score_submission_local_save()
    test_eventstudio_create_and_delete_flow()
    print("🎉 ALL PHASE 1 BCP ADAPTER & EVENT STUDIO TESTS PASSED!")
