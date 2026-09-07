"""
Test suite verifying Event Studio queries BCP directly for events, live roster,
and event creation without mutating or querying backend DB.
"""
import sys
import asyncio
from pathlib import Path
from unittest.mock import patch, MagicMock

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from routers.eventstudio import (
    api_eventstudio_get_event,
    api_eventstudio_list_events,
    api_eventstudio_create_event,
    CreateEventPayload,
)

def test_eventstudio_get_event_queries_bcp_directly():
    """Event Studio GET /event/{id} must fetch directly from BCP API without reading local DB."""
    mock_db = MagicMock()
    mock_auth = MagicMock()

    mock_auth.get_session.return_value = {
        "id": "to_user_1",
        "role": "TO",
        "email": "swimgeek751@gmail.com"
    }

    mock_bcp_event = {
        "id": "Xeqy73dRB0LL",
        "name": "Hsiehjun Test Tournament",
        "eventType": "Grand Tournament",
        "startDate": "2026-09-07T09:00:00.000Z",
        "numberOfRounds": 5,
        "points": 2000,
        "capacity": 32,
        "city": "Yakutsk",
        "currentRound": 0,
        "started": False,
        "ended": False
    }

    mock_bcp_players = [
        {"id": "p1", "userId": "u1", "user": {"firstName": "Team", "lastName": "Player"}, "checkedIn": False, "dropped": False},
        {"id": "p2", "userId": "u2", "user": {"firstName": "Test", "lastName": "Player"}, "checkedIn": False, "dropped": False},
        {"id": "p3", "userId": "u3", "user": {"firstName": "John", "lastName": "Hsieh"}, "team": {"name": "Team Zero Comp"}, "checkedIn": False, "dropped": False}
    ]

    mock_req = MagicMock()
    mock_req.headers = {"Authorization": "Bearer token123"}
    mock_req.cookies = {}

    with patch("routers.eventstudio.get_database", return_value=mock_db), \
         patch("routers.eventstudio.get_auth_manager", return_value=mock_auth), \
         patch("scraper.BestCoastPairingsScraper.fetch_event_details", return_value=mock_bcp_event), \
         patch("scraper.BestCoastPairingsScraper.fetch_event_players", return_value=mock_bcp_players):

        res = asyncio.run(api_eventstudio_get_event("Xeqy73dRB0LL", mock_req))

        assert res["success"] is True
        ev = res["event"]
        assert ev["name"] == "Hsiehjun Test Tournament"
        assert ev["total_players"] == 3
        assert len(ev["roster"]) == 3
        assert ev["roster"][0]["name"] == "Team Player"
        assert ev["roster"][1]["name"] == "Test Player"
        assert ev["roster"][2]["name"] == "John Hsieh"
        assert ev["roster"][2]["team"] == "Team Zero Comp"

        # Verify DB was NEVER queried for the studio event!
        mock_db.get_studio_event.assert_not_called()
        mock_db.save_studio_event.assert_not_called()

    print("✅ test_eventstudio_get_event_queries_bcp_directly passed!")

def test_eventstudio_create_event_skips_db_save_when_bcp_succeeds():
    """When an event is registered to BCP, it must not be pushed to backend DB."""
    mock_db = MagicMock()
    mock_auth = MagicMock()

    mock_auth.get_session.return_value = {
        "id": "to_user_1",
        "role": "TO",
        "email": "swimgeek751@gmail.com",
        "is_admin": True
    }
    mock_auth.get_valid_bcp_token.return_value = "bcp_token_xyz"
    mock_auth.get_valid_bcp_tokens.return_value = {"access_token": "bcp_token_xyz"}

    mock_req = MagicMock()
    mock_req.headers = {"Authorization": "Bearer session_token"}
    mock_req.cookies = {}

    payload = CreateEventPayload(
        name="New BCP Event",
        tier="Grand Tournament",
        rounds=5,
        points=2000,
        venue="Local Store",
        city="San Diego",
        state="CA"
    )

    with patch("routers.eventstudio.get_database", return_value=mock_db), \
         patch("routers.eventstudio.get_auth_manager", return_value=mock_auth), \
         patch("routers.eventstudio.execute_bcp_api_call", return_value=({"id": "BCP-NEW-999"}, None)), \
         patch("routers.eventstudio.bcp_adapter.configure_event_registration", return_value=(True, None, None)):

        res = asyncio.run(api_eventstudio_create_event(payload, mock_req))

        assert res["success"] is True
        assert res["bcp_registered"] is True
        assert res["event_id"] == "BCP-NEW-999"

        # Verify DB save was NOT called!
        mock_db.save_studio_event.assert_not_called()

    print("✅ test_eventstudio_create_event_skips_db_save_when_bcp_succeeds passed!")

def test_submit_btn_defined_in_community_js():
    """Verify submitBtn is explicitly defined in submitEventRegistration to prevent ReferenceError."""
    comm_js = (root_dir / "web" / "js" / "community.js").read_text(encoding="utf-8")
    assert "async function submitEventRegistration()" in comm_js
    sub_func = comm_js.split("async function submitEventRegistration()")[1].split("window.openEventRegistrationModal")[0]
    assert "const submitBtn = document.getElementById('event-reg-submit-btn');" in sub_func

    print("✅ test_submit_btn_defined_in_community_js passed!")

def test_sync_bcp_events_button_hidden_in_ui():
    """Verify Sync BCP Events button is hidden from top banner."""
    app_html = (root_dir / "web" / "app.html").read_text(encoding="utf-8")
    es_html = (root_dir / "web" / "eventstudio.html").read_text(encoding="utf-8")

    assert 'id="btn-sync-bcp-events"' in app_html
    assert "display: none !important;" in app_html
    assert 'id="btn-sync-bcp-events"' in es_html
    assert "display: none !important;" in es_html

    print("✅ test_sync_bcp_events_button_hidden_in_ui passed!")

if __name__ == "__main__":
    test_eventstudio_get_event_queries_bcp_directly()
    test_eventstudio_create_event_skips_db_save_when_bcp_succeeds()
    test_submit_btn_defined_in_community_js()
    test_sync_bcp_events_button_hidden_in_ui()
    print("\n🎉 ALL EVENT STUDIO DIRECT BCP TESTS PASSED SUCCESSFULLY!")
