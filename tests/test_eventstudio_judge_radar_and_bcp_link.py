"""
Unit tests for Event Studio Floor Judge Radar dual-case synchronization,
BCP Public Listing link handlers, and Competitor Elo default initialization.
"""
import sys
import asyncio
from pathlib import Path
from unittest.mock import patch, MagicMock

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from firestore_db import get_firestore_engine, FirestoreRoomEngine
from routers.eventstudio import (
    _normalize_bcp_pairing,
    api_eventstudio_create_judge_call,
    api_eventstudio_get_judge_calls,
    api_eventstudio_resolve_judge_call,
    JudgeCallCreatePayload,
    JudgeCallResolvePayload,
)


def test_normalize_bcp_pairing_p2_elo_defaults():
    """Verify that an unranked P2 gets standard 1500.0 Elo, while a true BYE gets 0.0."""
    pairing_dict = {
        "id": "pair_101",
        "table": 1,
        "round": 1,
        "player1": {"id": "p1", "user": {"firstName": "John", "lastName": "Doe"}, "army": "Necrons"},
        "player2": {"id": "p2", "user": {"firstName": "Jane", "lastName": "Smith"}, "army": "Aeldari"},
    }
    roster_map = {
        "p1": {"name": "John Doe", "elo": 1650.0},
        # "p2" is intentionally not in roster_map (unranked new player)
    }

    norm = _normalize_bcp_pairing(pairing_dict, default_table=1, roster_by_id=roster_map)
    assert norm["p1_name"] == "John Doe"
    assert norm["p1_elo"] == 1650.0
    assert norm["p2_name"] == "Jane Smith"
    # An unranked player must default to 1500.0, NOT 0.0!
    assert norm["p2_elo"] == 1500.0, f"Expected 1500.0 for unranked p2, got {norm['p2_elo']}"
    assert norm["is_bye"] is False

    # Test BYE pairing
    bye_pairing_dict = {
        "id": "pair_102",
        "table": 2,
        "round": 1,
        "player1": {"id": "p1", "user": {"firstName": "John", "lastName": "Doe"}, "army": "Necrons"},
        "player2": None,
    }
    norm_bye = _normalize_bcp_pairing(bye_pairing_dict, default_table=2, roster_by_id=roster_map)
    assert norm_bye["is_bye"] is True
    assert norm_bye["p2_name"] == "BYE"
    assert norm_bye["p2_elo"] == 0.0, f"Expected 0.0 for BYE, got {norm_bye['p2_elo']}"
    print("✅ test_normalize_bcp_pairing_p2_elo_defaults passed!")


def test_firestore_cross_case_judge_call_sync():
    """Verify FirestoreRoomEngine transparently bridges calls across mixed-case and uppercase event IDs."""
    fs = FirestoreRoomEngine()
    mixed_case_id = "K0mczlQ3fDnw"
    upper_case_id = "K0MCZLQ3FDNW"

    # Save a judge call using the uppercase ID (e.g. from table tracker)
    call_payload = {
        "call_id": "call_test_123",
        "id": "call_test_123",
        "table_number": 1,
        "match_id": f"BCP-{upper_case_id}-R1-T1",
        "caller_name": "John3 Hsieh3",
        "category": "Rules Dispute",
        "notes": "Line of sight dispute on objective 3",
        "status": "pending",
        "created_at": "2026-09-11T16:17:28.256075+00:00",
    }

    saved = fs.save_judge_call(upper_case_id, call_payload)
    assert isinstance(saved, dict)
    assert saved.get("id") == "call_test_123"

    # 1. Event Studio queries using the mixed-case BCP event ID
    calls_for_mixed = fs.list_judge_calls(mixed_case_id, active_only=True)
    assert len(calls_for_mixed) == 1, f"Expected 1 call retrieved under {mixed_case_id}, got {len(calls_for_mixed)}"
    assert calls_for_mixed[0]["call_id"] == "call_test_123"

    # 2. Event Studio marks call en_route using mixed-case ID
    updated = fs.update_judge_call_status(mixed_case_id, "call_test_123", "en_route", assigned_judge="Head Judge Steve")
    assert updated is True

    # 3. Table tracker queries uppercase ID and sees status updated to en_route
    calls_for_upper = fs.list_judge_calls(upper_case_id, active_only=True)
    assert len(calls_for_upper) == 1
    assert calls_for_upper[0]["status"] == "en_route"
    assert calls_for_upper[0]["assigned_judge"] == "Head Judge Steve"

    # 4. Resolve the call from mixed_case_id
    resolved = fs.update_judge_call_status(mixed_case_id, "call_test_123", "resolved")
    assert resolved is True

    # Active only should now return empty list for both
    active_mixed = fs.list_judge_calls(mixed_case_id, active_only=True)
    active_upper = fs.list_judge_calls(upper_case_id, active_only=True)
    assert len(active_mixed) == 0
    assert len(active_upper) == 0

    print("✅ test_firestore_cross_case_judge_call_sync passed!")


def test_eventstudio_judge_call_api_endpoints():
    """Verify Event Studio REST endpoints resolve canonical event IDs and synchronize."""
    mixed_case_id = "K0mczlQ3fDnw"
    upper_case_id = "K0MCZLQ3FDNW"

    # Mock canonical lookup
    with patch("routers.eventstudio._resolve_canonical_event_id", return_value=mixed_case_id):
        # 1. Create judge call specifying uppercase eventId in payload
        payload = JudgeCallCreatePayload(
            callId="jc-api-999",
            eventId=upper_case_id,
            matchId=f"BCP-{upper_case_id}-R1-T2",
            tableNumber=2,
            callerName="Competitor Bob",
            category="Ruling",
            notes="Need dice roll check",
        )
        res_create = asyncio.run(api_eventstudio_create_judge_call(payload))
        assert res_create.get("success") is True

        # 2. Query calls using mixed-case ID
        res_get = asyncio.run(api_eventstudio_get_judge_calls(event_id=mixed_case_id, active_only=True))
        assert res_get.get("success") is True
        call_ids = [c.get("id") or c.get("call_id") for c in res_get.get("calls", [])]
        assert "jc-api-999" in call_ids, f"Call jc-api-999 not found in calls: {call_ids}"

        # 3. Resolve call
        res_resolve = asyncio.run(api_eventstudio_resolve_judge_call(JudgeCallResolvePayload(
            callId="jc-api-999",
            eventId=upper_case_id,
            status="resolved"
        )))
        assert res_resolve.get("success") is True

        # 4. Verify no longer active
        res_get_after = asyncio.run(api_eventstudio_get_judge_calls(event_id=mixed_case_id, active_only=True))
        active_ids = [c.get("id") or c.get("call_id") for c in res_get_after.get("calls", [])]
        assert "jc-api-999" not in active_ids

    print("✅ test_eventstudio_judge_call_api_endpoints passed!")


def test_frontend_public_listing_link_and_handlers():
    """Verify HTML and JS bindings for BCP Public Listing and radar cross-case synchronization."""
    app_html = (root_dir / "web" / "app.html").read_text()
    studio_html = (root_dir / "web" / "eventstudio.html").read_text()
    studio_js = (root_dir / "web" / "js" / "eventstudio.js").read_text()
    tracker_sync_js = (root_dir / "web" / "tracker" / "tracker_sync.js").read_text()

    # Public listing button verification in HTML
    assert 'id="manage-event-bcp-link"' in app_html
    assert 'onclick="openStudioPublicListing(event)"' in app_html
    assert 'id="manage-event-bcp-link"' in studio_html
    assert 'onclick="openStudioPublicListing(event)"' in studio_html

    # Public listing handler in JS
    assert "function openStudioPublicListing(event)" in studio_js
    assert "window.openStudioPublicListing = openStudioPublicListing" in studio_js
    assert "https://www.bestcoastpairings.com/event/" in studio_js

    # Radar cross-case subscriptions
    assert "docIds" in studio_js
    assert "ev.id.toUpperCase()" in studio_js or "eventId.toUpperCase()" in studio_js
    assert "window.api.getJudgeCalls" in studio_js

    # Table tracker case preservation and dual dispatch
    assert "BCP-${evId}-R${rNum}-T${tNum}" in tracker_sync_js
    assert "targetTournamentIds" in tracker_sync_js

    print("✅ test_frontend_public_listing_link_and_handlers passed!")



from routers.tracker import api_get_scorecard, TRACKER_ROOMS

def test_scorecard_retention_and_no_judge_polling():
    """Verify that scorecards are retained and retrievable, and no REST polling of judge calls exists in quiet polls."""
    studio_js = (root_dir / "web" / "js" / "eventstudio.js").read_text()
    
    # 1. Verify pollTournamentWorkspaceQuietly does NOT contain getJudgeCalls polling
    poll_fn_start = studio_js.find("async function pollTournamentWorkspaceQuietly")
    poll_fn_end = studio_js.find("async function pollStudioEventsQuietly")
    assert poll_fn_start != -1 and poll_fn_end != -1
    poll_fn_body = studio_js[poll_fn_start:poll_fn_end]
    assert "getJudgeCalls" not in poll_fn_body, "pollTournamentWorkspaceQuietly must not poll getJudgeCalls!"

    # 2. Verify api_get_scorecard finds completed match in Firestore
    fs = get_firestore_engine()
    test_match_id = "BCP-K0mczlQ3fDnw-R1-T1"
    norm_mid = test_match_id.strip().upper()
    fs.create_room(norm_mid, {
        "match_id": test_match_id,
        "status": "completed",
        "is_finished": True,
        "state": {
            "is_finished": True,
            "round": 5,
            "p1": {"score": 85, "name": "Player 1"},
            "p2": {"score": 70, "name": "Player 2"},
            "game": {"p1Name": "Player 1", "p2Name": "Player 2", "primary": "Take & Hold"}
        }
    })

    mock_db = MagicMock()
    mock_db.get_tracker_game.return_value = None

    with patch("routers.tracker.get_database", return_value=mock_db):
        # Test retrieval by mixed-case ID
        res_sc = asyncio.run(api_get_scorecard(test_match_id))
        assert res_sc.get("success") is True
        assert res_sc.get("state") is not None
        assert res_sc["state"]["p1"]["score"] == 85
        assert res_sc["state"]["p2"]["score"] == 70

        # Test retrieval by uppercase ID
        res_sc_upper = asyncio.run(api_get_scorecard(norm_mid))
        assert res_sc_upper.get("success") is True
        assert res_sc_upper["state"]["p1"]["score"] == 85

        # Test retrieval when only in database tracker_games
        mock_db.get_tracker_game.return_value = {
            "match_id": "BCP-SAVED-IN-DB-R1-T1",
            "state_json": {
                "is_finished": True,
                "round": 5,
                "p1": {"score": 90, "name": "Winner"},
                "p2": {"score": 60, "name": "Runner Up"}
            }
        }
        res_db = asyncio.run(api_get_scorecard("BCP-SAVED-IN-DB-R1-T1"))
        assert res_db.get("success") is True
        assert res_db["state"]["p1"]["score"] == 90

    print("✅ test_scorecard_retention_and_no_judge_polling passed!")


if __name__ == "__main__":
    test_normalize_bcp_pairing_p2_elo_defaults()
    test_firestore_cross_case_judge_call_sync()
    test_eventstudio_judge_call_api_endpoints()
    test_frontend_public_listing_link_and_handlers()
    test_scorecard_retention_and_no_judge_polling()
    print("\n🎉 ALL EVENT STUDIO JUDGE RADAR, SCORECARD RETENTION & BCP LINK TESTS PASSED!")
