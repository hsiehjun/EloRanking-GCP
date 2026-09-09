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
    StudioMasterClockPayload,
    StudioBroadcastPayload,
    JudgeCallCreatePayload,
    JudgeCallResolvePayload,
    TRACKER_ROOMS,
    normalize_tracker_match_id,
)

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
    assert "firebase-firestore-compat.js" in html_content

    studio_js = root_dir / "web" / "js" / "eventstudio.js"
    assert studio_js.exists()
    studio_content = studio_js.read_text(encoding="utf-8")
    assert "function subscribeStudioTournament" in studio_content
    assert "function subscribeStudioJudgeCalls" in studio_content
    assert "function markJudgeCallEnRoute" in studio_content
    assert "function markJudgeCallResolved" in studio_content
    assert "function handleSendBroadcast" in studio_content
    assert "function playStudioJudgeChime" in studio_content

    tracker_js = root_dir / "web" / "tracker" / "tracker_sync.js"
    assert tracker_js.exists()
    tracker_content = tracker_js.read_text(encoding="utf-8")
    assert "function initTournamentDirectSync" in tracker_content
    assert "function applyRemoteMasterClock" in tracker_content
    assert "function applyRemoteBroadcast" in tracker_content
    assert "function showBroadcastBanner" in tracker_content
    assert "function playBroadcastAudioChime" in tracker_content
    assert "window.gtSubmitJudgeCall" in tracker_content
    assert "window.gtCancelJudgeCall" in tracker_content
    assert 'id="gt-master-clock-pill"' in tracker_content


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
    print("\nAll 6 real-time tournament operations bridge tests passed successfully!")
