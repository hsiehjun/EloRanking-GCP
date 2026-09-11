"""
Automated test suite verifying the real-time tournament operations bridge:
1. Tournament Master Clock (TO Event Studio <-> Table Tracker Sync)
2. Live Broadcast Announcements (Instant Dispatch & Fallback)
3. Live Floor Judge Radar (Real-time desk, En Route assignment, Resolution)
4. Table Clock Autonomy (rooms/{match_id} clocks are never altered by master round clock)
5. Frontend structural integrity (eventstudio.html, eventstudio.js, tracker_sync.js)
"""
import sys
import asyncio
import time
from pathlib import Path
from unittest.mock import patch, MagicMock

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from firestore_db import FirestoreRoomEngine, get_firestore_engine
from routers.eventstudio import (
    api_eventstudio_update_clock,
    api_eventstudio_get_clock,
    api_eventstudio_publish_broadcast,
    api_eventstudio_get_broadcast,
    api_eventstudio_create_judge_call,
    api_eventstudio_get_judge_calls,
    api_eventstudio_resolve_judge_call,
    api_eventstudio_delete_event,
    api_eventstudio_submit_score,
    StudioMasterClockPayload,
    StudioBroadcastPayload,
    JudgeCallCreatePayload,
    JudgeCallResolvePayload,
    SubmitScorePayload,
    TRACKER_ROOMS,
    normalize_tracker_match_id,
)
from routers.tracker import (
    api_tracker_discard_game,
    api_tracker_finalize_game,
)
from database import PostgresDatabase
from core import HTTPException

def test_firestore_engine_tournament_master_clock():
    engine = FirestoreRoomEngine()
    event_id = "test-tourn-clock-001"

    now_ms = int(time.time() * 1000)
    target_end = now_ms + (150 * 60 * 1000)
    clock_input = {
        "status": "running",
        "round": 2,
        "durationMinutes": 150,
        "remainingSeconds": 9000,
        "targetEndTime": target_end,
        "updatedAt": now_ms
    }

    saved = engine.update_tournament_master_clock(event_id, clock_input)
    assert saved["status"] == "running"
    assert saved["round"] == 2
    assert saved["targetEndTime"] == target_end

    fetched = engine.get_tournament_master_clock(event_id)
    assert fetched is not None
    assert fetched["status"] == "running"
    assert fetched["round"] == 2
    assert fetched["targetEndTime"] == target_end
    assert fetched["durationMinutes"] == 150

    pause_input = {
        "status": "paused",
        "round": 2,
        "durationMinutes": 150,
        "remainingSeconds": 7200,
        "targetEndTime": None,
        "updatedAt": int(time.time() * 1000)
    }
    paused = engine.update_tournament_master_clock(event_id, pause_input)
    assert paused["status"] == "paused"
    assert paused["targetEndTime"] is None
    assert paused["remainingSeconds"] == 7200


def test_api_master_clock_endpoints():
    event_id = "test-tourn-clock-002"
    now_ms = int(time.time() * 1000)

    payload = StudioMasterClockPayload(
        status="running",
        round=3,
        duration_minutes=165,
        remaining_seconds=9900,
        target_end_time=now_ms + (9900 * 1000)
    )

    post_res = asyncio.run(api_eventstudio_update_clock(event_id, payload))
    assert post_res["success"] is True
    assert post_res["clock"]["status"] == "running"
    assert post_res["clock"]["round"] == 3
    assert post_res["clock"]["durationMinutes"] == 165

    get_res = asyncio.run(api_eventstudio_get_clock(event_id))
    assert get_res["success"] is True
    assert get_res["clock"]["round"] == 3
    assert get_res["clock"]["status"] == "running"


def test_api_broadcast_announcements():
    event_id = "test-tourn-broadcast-001"

    payload = StudioBroadcastPayload(
        message="📢 15 Minutes Remaining in Round 2! Complete current battle round.",
        type="warning",
        round=2
    )

    post_res = asyncio.run(api_eventstudio_publish_broadcast(event_id, payload))
    assert post_res["success"] is True
    assert post_res["broadcast"]["message"] == payload.message
    assert post_res["broadcast"]["type"] == "warning"
    assert post_res["broadcast"]["round"] == 2
    assert "createdAt" in post_res["broadcast"]

    get_res = asyncio.run(api_eventstudio_get_broadcast(event_id))
    assert get_res["success"] is True
    assert get_res["broadcast"]["message"] == payload.message
    assert get_res["broadcast"]["type"] == "warning"


def test_floor_judge_radar_lifecycle():
    event_id = "test-tourn-radar-001"
    match_id = "BCP-tourn-radar-R1-T12"
    normalized_mid = normalize_tracker_match_id(match_id)

    TRACKER_ROOMS[normalized_mid] = {
        "match_id": match_id,
        "chess_clock": {
            "p1_time": 4200,
            "p2_time": 4150,
            "active_player": "p1",
            "is_running": True
        },
        "active_judge_call": None
    }

    call_payload = JudgeCallCreatePayload(
        call_id="call-test-radar-99",
        event_id=event_id,
        table_num=12,
        match_id=match_id,
        player_name="Brother Varek",
        caller={"playerName": "Brother Varek"},
        opponent="Warlord Ghazghkull",
        category="Rules Dispute",
        note="Dispute regarding line of sight through ruin base"
    )

    create_res = asyncio.run(api_eventstudio_create_judge_call(call_payload))
    assert create_res["success"] is True
    call = create_res["call"]
    assert call["status"] == "pending"
    assert call["table_num"] == 12
    assert call["category"] == "Rules Dispute"

    assert TRACKER_ROOMS[normalized_mid]["active_judge_call"] is not None
    assert TRACKER_ROOMS[normalized_mid]["active_judge_call"]["id"] == "call-test-radar-99"

    calls_res = asyncio.run(api_eventstudio_get_judge_calls(event_id, active_only=True))
    assert calls_res["success"] is True
    assert len(calls_res["calls"]) >= 1
    found = [c for c in calls_res["calls"] if c.get("id") == "call-test-radar-99" or c.get("call_id") == "call-test-radar-99"]
    assert len(found) == 1

    en_route_payload = JudgeCallResolvePayload(
        call_id="call-test-radar-99",
        event_id=event_id,
        match_id=match_id,
        status="en_route",
        assigned_judge="Judge Chris"
    )
    en_route_res = asyncio.run(api_eventstudio_resolve_judge_call(en_route_payload))
    assert en_route_res["success"] is True
    assert en_route_res["status"] == "en_route"

    assert TRACKER_ROOMS[normalized_mid]["active_judge_call"]["status"] == "en_route"
    assert TRACKER_ROOMS[normalized_mid]["active_judge_call"]["assigned_judge"] == "Judge Chris"

    resolve_payload = JudgeCallResolvePayload(
        call_id="call-test-radar-99",
        event_id=event_id,
        match_id=match_id,
        status="resolved",
        assigned_judge="Judge Chris"
    )
    resolve_res = asyncio.run(api_eventstudio_resolve_judge_call(resolve_payload))
    assert resolve_res["success"] is True
    assert resolve_res["status"] == "resolved"

    assert TRACKER_ROOMS[normalized_mid]["active_judge_call"]["status"] == "resolved"

    del TRACKER_ROOMS[normalized_mid]


def test_table_clock_remains_autonomous():
    event_id = "test-tourn-clock-autonomy"
    match_id = "BCP-tourn-autonomy-R1-T5"
    normalized_mid = normalize_tracker_match_id(match_id)

    initial_table_clock = {
        "p1_time": 4500,
        "p2_time": 4350,
        "active_player": "p2",
        "is_running": True,
        "increment": 0
    }

    TRACKER_ROOMS[normalized_mid] = {
        "match_id": match_id,
        "chess_clock": dict(initial_table_clock),
        "active_judge_call": None
    }

    now_ms = int(time.time() * 1000)
    master_clock_payload = StudioMasterClockPayload(
        status="stopped",
        round=2,
        duration_minutes=150,
        remaining_seconds=9000,
        target_end_time=None
    )
    asyncio.run(api_eventstudio_update_clock(event_id, master_clock_payload))

    room_clock = TRACKER_ROOMS[normalized_mid]["chess_clock"]
    assert room_clock["p1_time"] == initial_table_clock["p1_time"]
    assert room_clock["p2_time"] == initial_table_clock["p2_time"]
    assert room_clock["active_player"] == initial_table_clock["active_player"]
    assert room_clock["is_running"] is True

    del TRACKER_ROOMS[normalized_mid]


def test_frontend_files_integrity():
    html_file = root_dir / "web" / "eventstudio.html"
    assert html_file.exists()
    html_content = html_file.read_text(encoding="utf-8")
    assert 'id="btn-open-broadcast"' in html_content
    assert 'id="manage-subtab-judges"' in html_content
    assert 'id="modal-studio-broadcast"' in html_content
    assert 'id="studio-judge-radar-badge"' in html_content
    assert 'id="studio-judge-calls-container"' in html_content
    assert 'id="studio-active-judge-banner"' in html_content
    assert "firebase-firestore-compat.js" in html_content

    app_html = root_dir / "web" / "app.html"
    assert app_html.exists()
    app_content = app_html.read_text(encoding="utf-8")
    assert 'id="studio-active-judge-banner"' in app_content
    assert 'id="btn-timer-reset"' in app_content
    assert 'id="btn-open-broadcast"' in app_content
    assert 'id="btn-subtab-judges"' in app_content
    assert 'id="studio-judge-radar-badge"' in app_content
    assert 'id="manage-subtab-judges"' in app_content
    assert 'id="modal-studio-broadcast"' in app_content

    studio_js = root_dir / "web" / "js" / "eventstudio.js"
    assert studio_js.exists()
    studio_content = studio_js.read_text(encoding="utf-8")
    assert "function subscribeStudioTournament" in studio_content
    assert "function subscribeStudioJudgeCalls" in studio_content
    assert "function markJudgeCallEnRoute" in studio_content
    assert "function markJudgeCallResolved" in studio_content
    assert "function handleSendBroadcast" in studio_content
    assert "function playStudioJudgeChime" in studio_content
    assert "studio-active-judge-banner" in studio_content
    assert "propagateMasterClockToFirestoreRoomsDirectly" in studio_content
    assert "window.dispatchJudgeEnRoute" in studio_content
    assert "window.resolveJudgeCall" in studio_content

    tracker_js = root_dir / "web" / "tracker" / "tracker_sync.js"
    assert tracker_js.exists()
    tracker_content = tracker_js.read_text(encoding="utf-8")
    assert "function initTournamentDirectSync" in tracker_content
    assert "function startTournamentClockFallbackPoll" in tracker_content
    assert "function applyRemoteMasterClock" in tracker_content
    assert "function applyRemoteBroadcast" in tracker_content
    assert "function showBroadcastBanner" in tracker_content
    assert "function playBroadcastAudioChime" in tracker_content
    assert "window.gtSubmitJudgeCall" in tracker_content
    assert "window.gtCancelJudgeCall" in tracker_content
    assert 'id="gt-master-clock-pill"' in tracker_content
    assert "master_clock_update" in tracker_content
    assert "broadcast_update" in tracker_content
    assert "judge_call_update" in tracker_content


def test_player_cannot_delete_event_room():
    from routers.tracker import api_tracker_discard_game
    fs_engine = get_firestore_engine()

    match_id = "BCP-tourn-del-check-R1-T4"
    normalized_mid = normalize_tracker_match_id(match_id)

    fs_engine.create_room(normalized_mid, {
        "match_id": match_id,
        "user_id_p1": "player_competitor_1",
        "user_id_p2": "player_competitor_2",
        "p1_name": "Alice",
        "p2_name": "Bob",
        "state": {
            "game": {"p1Name": "Alice", "p2Name": "Bob", "eventId": "tourn-del-check"}
        }
    })
    TRACKER_ROOMS[normalized_mid] = fs_engine.get_room(normalized_mid)

    mock_req_player = MagicMock()
    mock_req_player.headers = {}
    mock_req_player.cookies = {"session_token": "token_competitor_1"}

    mock_auth = MagicMock()
    # Competitor session (role: player, not TO/admin)
    mock_auth.get_session.return_value = {
        "id": "player_competitor_1",
        "role": "player",
        "display_name": "Alice",
        "is_admin": False,
        "can_access_to": False
    }

    mock_db = MagicMock()
    mock_db.get_tracker_game.return_value = None

    # 1. Competitor attempts to discard event room -> Expect 403 Forbidden
    with patch("routers.tracker.get_database", return_value=mock_db), \
         patch("routers.tracker.get_auth_manager", return_value=mock_auth), \
         patch("routers.tracker.get_firestore_engine", return_value=fs_engine):
        try:
            asyncio.run(api_tracker_discard_game(match_id, mock_req_player))
            assert False, "Should have raised HTTPException 403"
        except HTTPException as exc:
            assert exc.status_code == 403
            assert "Tournament match rooms are managed by the event organizer" in exc.detail

    # Room must still exist in Firestore and memory!
    assert fs_engine.get_room(normalized_mid) is not None
    assert normalized_mid in TRACKER_ROOMS

    # 2. Tournament Organizer (TO) attempts to discard event room -> Allowed
    mock_req_to = MagicMock()
    mock_req_to.headers = {}
    mock_req_to.cookies = {"session_token": "token_to_1"}
    mock_auth.get_session.return_value = {
        "id": "organizer_1",
        "role": "to",
        "display_name": "Chief TO",
        "can_access_to": True
    }

    with patch("routers.tracker.get_database", return_value=mock_db), \
         patch("routers.tracker.get_auth_manager", return_value=mock_auth), \
         patch("routers.tracker.get_firestore_engine", return_value=fs_engine):
        res = asyncio.run(api_tracker_discard_game(match_id, mock_req_to))
        assert res["success"] is True

    # Now room should be deleted from Firestore and memory
    assert fs_engine.get_room(normalized_mid) is None
    assert normalized_mid not in TRACKER_ROOMS

    # 3. Casual game can be discarded by participant player
    casual_mid = "CASUAL-TEST-DISCARD-99"
    fs_engine.create_room(casual_mid, {
        "match_id": casual_mid,
        "user_id_p1": "player_competitor_1",
        "user_id_p2": "player_competitor_2",
        "state": {"round": 1}
    })
    TRACKER_ROOMS[casual_mid] = fs_engine.get_room(casual_mid)

    mock_auth.get_session.return_value = {
        "id": "player_competitor_1",
        "role": "player",
        "display_name": "Alice"
    }
    with patch("routers.tracker.get_database", return_value=mock_db), \
         patch("routers.tracker.get_auth_manager", return_value=mock_auth), \
         patch("routers.tracker.get_firestore_engine", return_value=fs_engine):
        res = asyncio.run(api_tracker_discard_game(casual_mid, mock_req_player))
        assert res["success"] is True

    assert fs_engine.get_room(casual_mid) is None
    assert casual_mid not in TRACKER_ROOMS


def test_event_deletion_cascades_to_firestore_rooms():
    fs_engine = get_firestore_engine()
    event_id = "evt-cascade-del-999"

    # Setup 3 event rooms and 1 casual room
    room1 = f"BCP-{event_id}-R1-T1"
    room2 = f"BCP-{event_id}-R1-T2"
    room3 = f"WH40K-BCP-{event_id}-R2-T1"
    casual_room = "CASUAL-KEEP-ALIVE-42"

    for r in [room1, room2, room3]:
        mid = normalize_tracker_match_id(r)
        fs_engine.create_room(mid, {"match_id": r, "eventId": event_id, "state": {"round": 1}})
        TRACKER_ROOMS[mid] = {"match_id": r, "eventId": event_id}

    fs_engine.create_room(casual_room, {"match_id": casual_room, "state": {"round": 1}})
    TRACKER_ROOMS[casual_room] = {"match_id": casual_room}

    # Setup tournament clock
    fs_engine.update_tournament_master_clock(event_id, {"status": "running", "round": 1})
    assert fs_engine.get_tournament_master_clock(event_id) is not None

    mock_req = MagicMock()
    mock_to_session = {
        "id": "to_user_999",
        "role": "to",
        "can_access_to": True
    }

    mock_db = MagicMock()
    mock_auth = MagicMock()
    mock_auth.get_valid_bcp_token.return_value = None

    with patch("routers.eventstudio._get_to_session_or_403", return_value=mock_to_session), \
         patch("routers.eventstudio.get_database", return_value=mock_db), \
         patch("routers.eventstudio.get_auth_manager", return_value=mock_auth), \
         patch("routers.eventstudio.get_firestore_engine", return_value=fs_engine), \
         patch("routers.eventstudio.execute_bcp_api_call", return_value=({}, None)):
        del_res = asyncio.run(api_eventstudio_delete_event(event_id, mock_req))
        assert del_res["success"] is True
        assert del_res["event_id"] == event_id
        assert del_res["rooms_deleted"] >= 3

    # Verify event rooms were deleted from Firestore
    assert fs_engine.get_room(normalize_tracker_match_id(room1)) is None
    assert fs_engine.get_room(normalize_tracker_match_id(room2)) is None
    assert fs_engine.get_room(normalize_tracker_match_id(room3)) is None

    # Verify casual room was untouched!
    assert fs_engine.get_room(casual_room) is not None
    assert casual_room in TRACKER_ROOMS

    # Verify tournament clock was cleaned up
    assert fs_engine.get_tournament_master_clock(event_id) is None

    # Verify memory TRACKER_ROOMS purged event rooms
    assert normalize_tracker_match_id(room1) not in TRACKER_ROOMS
    assert normalize_tracker_match_id(room2) not in TRACKER_ROOMS
    assert normalize_tracker_match_id(room3) not in TRACKER_ROOMS

    # Clean up casual room
    fs_engine.discard_room(casual_room)
    TRACKER_ROOMS.pop(casual_room, None)


def test_bcp_submission_retains_firestore_room_and_saves_tracker_games():
    fs_engine = get_firestore_engine()

    event_id = "evt-bcp-test-cleanup-88"
    table_num = 5
    match_id = f"BCP-{event_id}-R1-T{table_num}"
    normalized_mid = normalize_tracker_match_id(match_id)

    fs_engine.create_room(normalized_mid, {
        "match_id": match_id,
        "eventId": event_id,
        "state": {
            "game": {"eventId": event_id, "tableNum": table_num, "p1Name": "P1", "p2Name": "P2"},
            "round": 1
        }
    })
    TRACKER_ROOMS[normalized_mid] = {"match_id": match_id}

    payload = SubmitScorePayload(
        event_id=event_id,
        pairing_id="bcp-pairing-cleanup-99",
        p1_score=90,
        p2_score=70,
        round_num=1,
        table=table_num,
        table_num=table_num,
        bcp_token="mock_token",
        game_details={
            "match_id": match_id,
            "p1_id": "u1",
            "p2_id": "u2",
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
         patch("routers.eventstudio.get_firestore_engine", return_value=fs_engine), \
         patch("routers.eventstudio.bcp_adapter.submit_pairing_scores", return_value=(True, None)):
        res = asyncio.run(api_eventstudio_submit_score(payload, mock_req))
        assert res["success"] is True

    # Room must be marked completed in Firestore and memory (scorecard retained!)
    room_doc = fs_engine.get_room(normalized_mid)
    assert room_doc is not None
    assert room_doc.get("status") == "completed"
    assert room_doc.get("is_finished") is True

    # DB writes to tracker_games MUST be called to retain digital scorecard
    mock_db.save_tracker_game.assert_called_once()
    mock_db.upsert_match.assert_not_called()


def test_all_games_stored_in_tracker_games():
    fs_engine = get_firestore_engine()

    db = PostgresDatabase.__new__(PostgresDatabase)
    db.database_url = "postgresql://test:test@localhost:5432/test"
    db.pool = None

    # 1. Direct database.py test: Both event matches and casual matches proceed to DB tracker_games
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.__enter__.return_value = mock_conn
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    with patch.object(db, "get_connection", return_value=mock_conn):
        # BCP match ID -> writes to DB!
        res_bcp = db.save_tracker_game("BCP-EVT1-R1-T1", {
            "round": 1,
            "game": {"p1Name": "P1", "p2Name": "P2"},
            "p1": {"score": 80},
            "p2": {"score": 75}
        })
        assert res_bcp is True
        assert mock_cur.execute.call_count >= 1

        # ES match ID -> writes to DB!
        mock_cur.reset_mock()
        res_es = db.save_tracker_game("ES-EVT2-R1-T1", {
            "round": 1,
            "game": {"p1Name": "P1", "p2Name": "P2"},
            "p1": {"score": 90},
            "p2": {"score": 60}
        })
        assert res_es is True
        assert mock_cur.execute.call_count >= 1

        # Match with eventId in state -> writes to DB!
        mock_cur.reset_mock()
        res_custom_evt = db.save_tracker_game("MATCH-SOME-99", {
            "round": 1,
            "eventId": "evt-some-77",
            "game": {"p1Name": "Alice", "p2Name": "Bob"}
        })
        assert res_custom_evt is True
        assert mock_cur.execute.call_count >= 1

        # update_tracker_army_list for BCP -> writes to DB!
        mock_cur.reset_mock()
        res_list = db.update_tracker_army_list("BCP-EVT1-R1-T1", "p1", {"faction": "Necrons"})
        assert res_list is True
        assert mock_cur.execute.call_count >= 1

        # Casual local match -> writes to database!
        mock_cur.reset_mock()
        res_casual = db.save_tracker_game("WH40K-CASUAL-LOCAL-42", {
            "round": 1,
            "game": {"p1Name": "Alice", "p2Name": "Bob"},
            "p1": {"score": 40},
            "p2": {"score": 35}
        })
        assert res_casual is True
        assert mock_cur.execute.call_count >= 1

    # 2. Finalize endpoint test: api_tracker_finalize_game
    # Tournament match: persists to db.save_tracker_game, marks completed in Firestore
    tourn_mid = "BCP-FIN-TEST-R1-T1"
    norm_tourn_mid = normalize_tracker_match_id(tourn_mid)
    fs_engine.create_room(norm_tourn_mid, {
        "match_id": tourn_mid,
        "user_id_p1": "u1",
        "user_id_p2": "u2",
        "state": {"round": 5, "eventId": "tourn-fin-test"}
    })
    TRACKER_ROOMS[norm_tourn_mid] = fs_engine.get_room(norm_tourn_mid)

    mock_db_instance = MagicMock()
    mock_auth = MagicMock()
    mock_auth.get_session.return_value = {"id": "u1", "role": "player"}
    mock_req = MagicMock()
    mock_req.headers = {}
    mock_req.cookies = {"session_token": "token_u1"}

    with patch("routers.tracker.get_database", return_value=mock_db_instance), \
         patch("routers.tracker.get_auth_manager", return_value=mock_auth), \
         patch("routers.tracker.get_firestore_engine", return_value=fs_engine):
        fin_res = asyncio.run(api_tracker_finalize_game(tourn_mid, mock_req))
        assert fin_res["success"] is True

    # Verifications for tournament match finalize:
    mock_db_instance.save_tracker_game.assert_called_once()
    tourn_room = fs_engine.get_room(norm_tourn_mid)
    assert tourn_room is not None
    assert tourn_room.get("status") == "completed"
    assert tourn_room.get("is_finished") is True

    # Casual match: calls db.save_tracker_game, marks completed in Firestore
    mock_db_instance.reset_mock()
    casual_mid = "CASUAL-FIN-LOCAL-77"
    fs_engine.create_room(casual_mid, {
        "match_id": casual_mid,
        "user_id_p1": "u1",
        "user_id_p2": "u2",
        "state": {"round": 5}
    })
    TRACKER_ROOMS[casual_mid] = fs_engine.get_room(casual_mid)

    with patch("routers.tracker.get_database", return_value=mock_db_instance), \
         patch("routers.tracker.get_auth_manager", return_value=mock_auth), \
         patch("routers.tracker.get_firestore_engine", return_value=fs_engine):
        fin_casual = asyncio.run(api_tracker_finalize_game(casual_mid, mock_req))
        assert fin_casual["success"] is True

    # Verifications for casual match finalize:
    mock_db_instance.save_tracker_game.assert_called_once()
    casual_room = fs_engine.get_room(casual_mid)
    assert casual_room is not None
    assert casual_room.get("status") == "completed"
    assert casual_room.get("is_finished") is True


if __name__ == "__main__":
    test_firestore_engine_tournament_master_clock()
    print("✓ test_firestore_engine_tournament_master_clock passed")
    test_api_master_clock_endpoints()
    print("✓ test_api_master_clock_endpoints passed")
    test_api_broadcast_announcements()
    print("✓ test_api_broadcast_announcements passed")
    test_floor_judge_radar_lifecycle()
    print("✓ test_floor_judge_radar_lifecycle passed")
    test_table_clock_remains_autonomous()
    print("✓ test_table_clock_remains_autonomous passed")
    test_frontend_files_integrity()
    print("✓ test_frontend_files_integrity passed")
    test_player_cannot_delete_event_room()
    print("✓ test_player_cannot_delete_event_room passed")
    test_event_deletion_cascades_to_firestore_rooms()
    print("✓ test_event_deletion_cascades_to_firestore_rooms passed")
    test_bcp_submission_retains_firestore_room_and_saves_tracker_games()
    print("✓ test_bcp_submission_retains_firestore_room_and_saves_tracker_games passed")
    test_all_games_stored_in_tracker_games()
    print("✓ test_all_games_stored_in_tracker_games passed")
    print("\nAll 10 real-time tournament operations bridge & lifecycle tests passed successfully!")
