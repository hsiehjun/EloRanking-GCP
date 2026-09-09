"""
Test suite verifying floor judge dispatch error handling & room synchronization,
plus BCP score submission with first turn, terrain layout, and match verification.
"""
import sys
import asyncio
from pathlib import Path
from unittest.mock import patch, MagicMock

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from database import PostgresDatabase
from bcp_adapter import BcpAdapter
from routers.eventstudio import (
    api_eventstudio_create_judge_call,
    api_eventstudio_submit_score,
    JudgeCallCreatePayload,
    SubmitScorePayload,
    TRACKER_ROOMS,
    normalize_tracker_match_id,
)

def test_database_create_judge_call_resilience():
    """Database create_judge_call must generate valid JC- ID and handle offline DB gracefully."""
    db = PostgresDatabase.__new__(PostgresDatabase)
    db.database_url = "postgresql://test:test@localhost:5432/test"
    db.pool = None

    with patch.object(db, "get_connection", side_effect=Exception("Database offline")):
        call = db.create_judge_call(
            event_id="evt-123",
            table_num=4,
            match_id="mid-789",
            player_name="Competitor One",
            category="Line of Sight",
            note="Measurement dispute"
        )
        assert call is not None
        assert call["id"].startswith("JC-")
        assert call["status"] == "pending"
        assert call["event_id"] == "evt-123"
        assert call["table_num"] == 4
        assert call["category"] == "Line of Sight"
        assert call["note"] == "Measurement dispute"
        assert "created_at" in call

def test_database_get_judge_calls_resilience():
    """Database get_judge_calls should return empty list on connection error."""
    db = PostgresDatabase.__new__(PostgresDatabase)
    db.database_url = "postgresql://test:test@localhost:5432/test"
    db.pool = None

    with patch.object(db, "get_connection", side_effect=Exception("Database offline")):
        calls = db.get_judge_calls(event_id="evt-123", active_only=True)
        assert calls == []

def test_api_eventstudio_create_judge_call_endpoint_and_room_sync():
    """API endpoint must accept string or int table_num and broadcast to active tracker room."""
    match_id = "tracker-test-judge-room-1"
    normalized_mid = normalize_tracker_match_id(match_id)
    TRACKER_ROOMS[normalized_mid] = {
        "match_id": match_id,
        "players": {},
        "active_judge_call": None
    }

    payload = JudgeCallCreatePayload(
        event_id="evt-bcp-456",
        table_num="7",
        match_id=match_id,
        player_name="Brother Captain",
        category="Rules Dispute",
        note="Ruins obscuring interaction"
    )

    res = asyncio.run(api_eventstudio_create_judge_call(payload))
    assert res["success"] is True
    assert res["call"]["table_num"] == 7
    assert res["call"]["category"] == "Rules Dispute"
    assert res["call"]["id"].startswith("JC-")

    # Verify tracker room received the broadcast
    assert TRACKER_ROOMS[normalized_mid]["active_judge_call"] is not None
    assert TRACKER_ROOMS[normalized_mid]["active_judge_call"]["id"] == res["call"]["id"]
    assert TRACKER_ROOMS[normalized_mid]["active_judge_call"]["category"] == "Rules Dispute"

    del TRACKER_ROOMS[normalized_mid]

def test_bcp_adapter_submit_pairing_scores_player1_first_and_layout():
    """BCP submit_pairing_scores must populate first turn, layout, and verified completion flags."""
    adapter = BcpAdapter()

    with patch.object(BcpAdapter, "execute_call") as mock_exec:
        mock_exec.return_value = ({"success": True, "message": "Scores recorded"}, None)

        ok, err = adapter.submit_pairing_scores(
            pairing_id="pair-abc-123",
            p1_score=85,
            p2_score=60,
            explicit_token="test-bcp-jwt",
            game_data={
                "p1_id": "p1_id_111",
                "p2_id": "p2_id_222",
                "first_turn": "player1",
                "layout": "Layout 4",
                "winner_id": "p1_id_111"
            }
        )

        assert ok is True
        assert err is None

        _, kwargs = mock_exec.call_args
        captured_payload = kwargs["json_data"]

        # Root payload verification
        assert captured_payload["firstTurn"] == 1
        assert captured_payload["player1FirstTurn"] is True
        assert captured_payload["player2FirstTurn"] is False
        assert captured_payload["firstTurnPlayerId"] == "p1_id_111"
        assert captured_payload["layout"] == "Layout 4"
        assert captured_payload["terrainLayout"] == "Layout 4"
        assert captured_payload["winnerId"] == "p1_id_111"
        assert captured_payload["verified"] is True
        assert captured_payload["isVerified"] is True
        assert captured_payload["status"] == "completed"
        assert captured_payload["pairingStatus"] == "Completed"

        # Game payloads
        p1_game = captured_payload["player1Game"]
        p2_game = captured_payload["player2Game"]
        assert p1_game["firstTurn"] is True
        assert p1_game["wentFirst"] is True
        assert p1_game["layout"] == "Layout 4"
        assert p1_game["terrainLayout"] == "Layout 4"
        assert p2_game["firstTurn"] is False
        assert p2_game["wentFirst"] is False
        assert p2_game["layout"] == "Layout 4"
        assert p2_game["terrainLayout"] == "Layout 4"

        # MetaData
        meta = captured_payload["metaData"]
        assert meta["p1-firstTurn"] == "true"
        assert meta["p2-firstTurn"] == "false"
        assert meta["whoWentFirst"] == "player1"
        assert meta["firstTurn"] == "player1"
        assert meta["firstTurnPlayerId"] == "p1_id_111"
        assert meta["layout"] == "Layout 4"
        assert meta["terrainLayout"] == "Layout 4"

        # gameData sync
        g_data = captured_payload["gameData"]
        assert g_data["verified"] is True
        assert g_data["isVerified"] is True
        assert g_data["status"] == "completed"
        assert g_data["pairingStatus"] == "Completed"
        assert g_data["firstTurn"] == 1
        assert g_data["firstTurnPlayerId"] == "p1_id_111"
        assert g_data["layout"] == "Layout 4"
        assert g_data["player1Game"]["firstTurn"] is True
        assert g_data["player2Game"]["firstTurn"] is False

def test_bcp_adapter_submit_pairing_scores_player2_first():
    """BCP submit_pairing_scores must properly set player 2 first turn when p2 went first."""
    adapter = BcpAdapter()

    with patch.object(BcpAdapter, "execute_call") as mock_exec:
        mock_exec.return_value = ({"success": True}, None)

        ok, _ = adapter.submit_pairing_scores(
            pairing_id="pair-xyz-789",
            p1_score=70,
            p2_score=92,
            explicit_token="test-bcp-jwt",
            game_data={
                "p1_id": "p1_id_111",
                "p2_id": "p2_id_222",
                "first_turn": "player2",
                "terrain_layout": "GW Layout 1",
                "winner_id": "p2_id_222"
            }
        )

        assert ok is True
        _, kwargs = mock_exec.call_args
        captured_payload = kwargs["json_data"]

        assert captured_payload["firstTurn"] == 2
        assert captured_payload["player1FirstTurn"] is False
        assert captured_payload["player2FirstTurn"] is True
        assert captured_payload["firstTurnPlayerId"] == "p2_id_222"
        assert captured_payload["player1Game"]["firstTurn"] is False
        assert captured_payload["player2Game"]["firstTurn"] is True
        assert captured_payload["metaData"]["whoWentFirst"] == "player2"
        assert captured_payload["metaData"]["p1-firstTurn"] == "false"
        assert captured_payload["metaData"]["p2-firstTurn"] == "true"
        assert captured_payload["layout"] == "GW Layout 1"
        assert captured_payload["terrainLayout"] == "GW Layout 1"
        assert captured_payload["winnerId"] == "p2_id_222"

def test_api_eventstudio_submit_score_forwards_first_turn_and_layout():
    """api_eventstudio_submit_score must extract first_turn and layout and forward to bcp_adapter."""
    payload = SubmitScorePayload(
        event_id="test-bcp-evt-id",
        pairing_id="pairing-999",
        p1_score=75,
        p2_score=50,
        first_turn="player1",
        layout="Layout 5",
        bcp_token="mock_bcp_token",
        game_details={
            "match_id": "match-m-123",
            "p1_id": "user_p1",
            "p2_id": "user_p2",
            "p1_game_id": "gid-1",
            "p2_game_id": "gid-2"
        }
    )

    mock_req = MagicMock()
    mock_req.headers = {}
    mock_req.cookies = {}

    mock_db = MagicMock()
    mock_auth = MagicMock()
    mock_auth.get_session.return_value = None

    with patch("routers.eventstudio.get_database", return_value=mock_db), \
         patch("routers.eventstudio.get_auth_manager", return_value=mock_auth), \
         patch("routers.eventstudio.bcp_adapter.submit_pairing_scores") as mock_submit:
        mock_submit.return_value = (True, None)

        res = asyncio.run(api_eventstudio_submit_score(payload, mock_req))
        assert res["success"] is True
        assert res["bcp_synced"] is True

        mock_submit.assert_called_once()
        _, kwargs = mock_submit.call_args
        submit_game_data = kwargs["game_data"]
        assert submit_game_data["first_turn"] == "player1"
        assert submit_game_data["firstTurn"] == "player1"
        assert submit_game_data["layout"] == "Layout 5"
        assert submit_game_data["terrainLayout"] == "Layout 5"
        assert submit_game_data["winner_id"] == "user_p1"

def test_tracker_sync_js_elements():
    """Verify tracker_sync.js defines required DOM elements, handlers, and resilient states."""
    js_path = root_dir / "web" / "tracker" / "tracker_sync.js"
    assert js_path.exists()
    content = js_path.read_text(encoding="utf-8")

    # Terrain layout selector in conclude modal
    assert 'id="gt-match-layout"' in content
    assert 'Layout 1' in content
    assert 'GW Layout 1' in content
    assert 'WTC Layout 1' in content

    # Judge dispatch button with loading state
    assert 'id="gt-btn-dispatch-judge"' in content
    assert '🚨 Dispatching...' in content
    assert '🚨 Judge Pending' in content
    assert 'judgeCallSig' in content

    # First turn extraction and BCP payload forwarding
    assert 'first_turn: firstTurnVal' in content
    assert 'terrain_layout: layoutVal' in content
    assert 'resolvedWinnerId' in content

if __name__ == "__main__":
    test_database_create_judge_call_resilience()
    print("✓ test_database_create_judge_call_resilience passed")
    test_database_get_judge_calls_resilience()
    print("✓ test_database_get_judge_calls_resilience passed")
    test_api_eventstudio_create_judge_call_endpoint_and_room_sync()
    print("✓ test_api_eventstudio_create_judge_call_endpoint_and_room_sync passed")
    test_bcp_adapter_submit_pairing_scores_player1_first_and_layout()
    print("✓ test_bcp_adapter_submit_pairing_scores_player1_first_and_layout passed")
    test_bcp_adapter_submit_pairing_scores_player2_first()
    print("✓ test_bcp_adapter_submit_pairing_scores_player2_first passed")
    test_api_eventstudio_submit_score_forwards_first_turn_and_layout()
    print("✓ test_api_eventstudio_submit_score_forwards_first_turn_and_layout passed")
    test_tracker_sync_js_elements()
    print("✓ test_tracker_sync_js_elements passed")
    print("\nAll 7 judge dispatch and BCP submission tests passed successfully!")
