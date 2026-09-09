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
    api_eventstudio_remove_player,
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

def test_eventstudio_remove_player_calls_bcp_delete():
    """Verify removing a player calls BCP DELETE /v1/players/{player_id}."""
    mock_db = MagicMock()
    mock_auth = MagicMock()

    mock_auth.get_session.return_value = {
        "id": "to_user_1",
        "role": "TO",
        "email": "swimgeek751@gmail.com",
        "is_admin": True
    }
    mock_auth.get_valid_bcp_token.return_value = "bcp_organizer_tok"

    mock_req = MagicMock()
    mock_req.headers = {"Authorization": "Bearer session_token"}
    mock_req.query_params = {}
    mock_req.cookies = {}

    with patch("routers.eventstudio.get_database", return_value=mock_db), \
         patch("routers.eventstudio.get_auth_manager", return_value=mock_auth), \
         patch("routers.eventstudio.bcp_adapter.delete_player", return_value=(True, None)) as mock_delete:

        res = asyncio.run(api_eventstudio_remove_player("Xeqy73dRB0LL", "CvS02OiDV5kJ", mock_req))

        assert res["success"] is True
        assert res["bcp_deleted"] is True
        assert res["player_id"] == "CvS02OiDV5kJ"
        mock_delete.assert_called_once_with(
            player_id="CvS02OiDV5kJ",
            event_id="Xeqy73dRB0LL",
            user_id="to_user_1",
            explicit_token="bcp_organizer_tok",
            is_team=False
        )

    print("✅ test_eventstudio_remove_player_calls_bcp_delete passed!")

def test_community_overview_no_unbound_local_elo():
    """Verify get_community_overview does not raise UnboundLocalError when no tournaments exist in region."""
    from database import Database
    db = Database.__new__(Database)
    db.COMMUNITY_REGIONS = {}
    db.get_events_field_stats = MagicMock(return_value={})

    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_cur.fetchall.return_value = []
    mock_cur.fetchone.return_value = None
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    db.get_connection = MagicMock(return_value=mock_conn)
    mock_conn.__enter__.return_value = mock_conn

    # Calling for Yakutsk with 0 tournaments/matches
    result = db.get_community_overview(
        lat=62.0396912,
        lng=129.7422193,
        radius_miles=50.0,
        current_player_id="test_player",
        current_user_id="test_user"
    )

    assert result["success"] is True
    assert result["user_local_elo"] is None
    assert result["local_leaderboard"] == []
    assert result["local_teams_leaderboard"] == []
    print("✅ test_community_overview_no_unbound_local_elo passed!")

def test_bcp_register_player_already_registered_check():
    """Verify register_player detects existing competitor and returns already_registered."""
    from bcp_adapter import BcpAdapter
    mock_scraper = MagicMock()
    mock_scraper.fetch_event_players.return_value = [
        {"id": "D2HF8EFWrSio", "user": {"firstName": "John", "lastName": "Hsieh", "email": "swimgeek751@gmail.com"}}
    ]

    with patch("scraper.BestCoastPairingsScraper", return_value=mock_scraper), \
         patch.object(BcpAdapter, "execute_call", return_value=(None, "HTTP 500: internal server error")):
        success, err, data = BcpAdapter.register_player(
            event_id="axW2U6A1JoZC",
            player_data={"first_name": "John", "last_name": "Hsieh", "email": "swimgeek751@gmail.com"}
        )
        assert success is True
        assert err is None
        assert data.get("already_registered") is True

    print("✅ test_bcp_register_player_already_registered_check passed!")

def test_managed_tournaments_refresh_button_and_player_counts():
    """Verify refresh button exists in UI, refreshStudioEvents is in bundle, and list API maps player count."""
    # 1. UI buttons exist
    app_html = (root_dir / "web" / "app.html").read_text()
    es_html = (root_dir / "web" / "eventstudio.html").read_text()
    assert "btn-refresh-managed-tournaments" in app_html
    assert "refreshStudioEvents(this)" in app_html
    assert "btn-refresh-managed-tournaments" in es_html
    assert "refreshStudioEvents(this)" in es_html

    # 2. Bundle contains refreshStudioEvents
    bundle_js = (root_dir / "web" / "js" / "app.bundle.min.js").read_text()
    assert "refreshStudioEvents" in bundle_js

    # 3. List events mapping
    from routers.eventstudio import api_eventstudio_list_events
    mock_req = MagicMock()
    mock_req.headers = {"Authorization": "Bearer tok"}
    mock_req.cookies = {}
    mock_auth = MagicMock()
    mock_auth.get_session.return_value = {"id": "to_1", "role": "TO"}
    mock_db = MagicMock()
    mock_db.get_studio_events.return_value = []

    bcp_mock_events = {
        "data": [
            {
                "id": "bcp_ev_test_1",
                "name": "Hsiehjun Test",
                "totalPlayers": 8,
                "numTickets": 32,
                "eventType": "Grand Tournament"
            }
        ]
    }

    with patch("routers.eventstudio.get_auth_manager", return_value=mock_auth), \
         patch("routers.eventstudio.get_database", return_value=mock_db), \
         patch("routers.eventstudio.execute_bcp_api_call", return_value=(bcp_mock_events, None)):
        res = asyncio.run(api_eventstudio_list_events(mock_req))
        assert res["success"] is True
        assert len(res["events"]) == 1
        ev = res["events"][0]
        assert ev["total_players"] == 8
        assert ev["capacity"] == 32

    print("✅ test_managed_tournaments_refresh_button_and_player_counts passed!")

def test_bcp_generate_pairings_and_content_length_zero():
    """Verify BcpAdapter sends POST /generatePairings with Content-Length: 0 and empty body."""
    from bcp_adapter import BcpAdapter
    import json

    captured_req = None
    def mock_urlopen(req, timeout=12):
        nonlocal captured_req
        captured_req = req
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = json.dumps({"eventId": "WQzWygYPwWfi", "status": "completed"}).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.__exit__.return_value = False
        return mock_resp

    with patch("urllib.request.urlopen", side_effect=mock_urlopen):
        ok, err, data = BcpAdapter.start_event_or_generate_pairings(
            event_id="WQzWygYPwWfi",
            explicit_token="token_abc_123"
        )
        assert ok is True
        assert err is None
        assert captured_req is not None
        assert captured_req.get_full_url() == "https://newprod-api.bestcoastpairings.com/v1/events/WQzWygYPwWfi/generatePairings"
        assert captured_req.get_method() == "POST"
        assert captured_req.data == b""
        # Headers check (case-insensitive in urllib)
        hdrs = {k.lower(): v for k, v in captured_req.headers.items()}
        assert hdrs.get("content-length") == "0"
        assert hdrs.get("content-type") == "application/json"
        assert hdrs.get("authorization") == "Bearer token_abc_123"
        assert hdrs.get("client-id") == "web-app"
        assert hdrs.get("env") == "bcp"

    print("✅ test_bcp_generate_pairings_and_content_length_zero passed!")

def test_bcp_get_pairings_status():
    """Verify BcpAdapter GET /pairingsStatus endpoint call."""
    from bcp_adapter import BcpAdapter
    import json

    captured_req = None
    def mock_urlopen(req, timeout=12):
        nonlocal captured_req
        captured_req = req
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = json.dumps({"eventId": "WQzWygYPwWfi", "status": "completed"}).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.__exit__.return_value = False
        return mock_resp

    with patch("urllib.request.urlopen", side_effect=mock_urlopen):
        ok, err, data = BcpAdapter.get_pairings_status(
            event_id="WQzWygYPwWfi",
            explicit_token="token_abc_123"
        )
        assert ok is True
        assert err is None
        assert data.get("status") == "completed"
        assert captured_req.get_full_url() == "https://newprod-api.bestcoastpairings.com/v1/events/WQzWygYPwWfi/pairingsStatus"
        assert captured_req.get_method() == "GET"

    print("✅ test_bcp_get_pairings_status passed!")

def test_eventstudio_start_event_decoupled_and_pairings_status():
    """Verify starting BCP tournament calls BCP directly, polls status, and does zero DB writes."""
    from routers.eventstudio import api_eventstudio_start_event, api_eventstudio_get_pairings_status
    mock_db = MagicMock()
    mock_auth = MagicMock()
    mock_auth.get_session.return_value = {
        "id": "to_user_1",
        "role": "TO",
        "email": "swimgeek751@gmail.com"
    }
    mock_auth.get_valid_bcp_token.return_value = "bcp_tok_123"

    mock_req = MagicMock()
    mock_req.headers = {"Authorization": "Bearer session_token"}
    mock_req.cookies = {}

    mock_bcp_event = {
        "id": "WQzWygYPwWfi",
        "name": "Hsiehjun Grand Tournament",
        "started": True,
        "activeRound": 1,
        "currentRound": 1
    }
    mock_bcp_players = [
        {"id": "p1", "user": {"firstName": "Player", "lastName": "One"}},
        {"id": "p2", "user": {"firstName": "Player", "lastName": "Two"}}
    ]
    mock_bcp_pairings = [
        {
            "id": "pair1",
            "table": 1,
            "player1": {"id": "p1", "user": {"firstName": "Player", "lastName": "One"}},
            "player2": {"id": "p2", "user": {"firstName": "Player", "lastName": "Two"}}
        }
    ]

    with patch("routers.eventstudio.get_database", return_value=mock_db), \
         patch("routers.eventstudio.get_auth_manager", return_value=mock_auth), \
         patch("bcp_adapter.BcpAdapter.start_event_or_generate_pairings", return_value=(True, None, {"status": "ok"})) as mock_start, \
         patch("bcp_adapter.BcpAdapter.get_pairings_status", return_value=(True, None, {"eventId": "WQzWygYPwWfi", "status": "completed"})) as mock_status, \
         patch("scraper.BestCoastPairingsScraper.fetch_event_details", return_value=mock_bcp_event), \
         patch("scraper.BestCoastPairingsScraper.fetch_event_players", return_value=mock_bcp_players), \
         patch("scraper.BestCoastPairingsScraper.fetch_event_pairings_for_round", return_value=mock_bcp_pairings):

        # 1. Start Event
        res = asyncio.run(api_eventstudio_start_event("WQzWygYPwWfi", mock_req))
        assert res["success"] is True
        assert res["bcp_started"] is True
        assert res["pairings_status"]["status"] == "completed"
        ev = res["event"]
        assert ev["started"] is True
        assert ev["current_round"] == 1
        assert "1" in ev["pairings"]
        r1_pairings = ev["pairings"]["1"]
        assert len(r1_pairings) == 1
        assert r1_pairings[0]["p1_name"] == "Player One"
        assert r1_pairings[0]["p2_name"] == "Player Two"

        # Verify zero DB reads or writes for BCP event!
        mock_db.get_studio_event.assert_not_called()
        mock_db.save_studio_event.assert_not_called()
        mock_start.assert_called_once()
        mock_status.assert_called_once()

        # 2. Pairings Status endpoint
        status_res = asyncio.run(api_eventstudio_get_pairings_status("WQzWygYPwWfi", mock_req))
        assert status_res["success"] is True
        assert status_res["status"] == "completed"

    print("✅ test_eventstudio_start_event_decoupled_and_pairings_status passed!")

def test_bcp_pairing_normalization_enriches_fields():
    """Verify _normalize_bcp_pairing enriches raw BCP pairings with fields needed by UI."""
    from routers.eventstudio import _normalize_bcp_pairing
    raw_bcp = {
        "id": "pairing_999",
        "table": 3,
        "player1": {
            "id": "p_alpha",
            "name": "Alpha Player",
            "army": "World Eaters",
            "team": "Team Red"
        },
        "player2": {
            "id": "p_beta",
            "user": {"firstName": "Beta", "lastName": "Gamer"},
            "faction": {"name": "Aeldari"}
        },
        "player1Game": {"points": 88},
        "player2Game": {"points": 65},
        "isDone": True
    }

    norm = _normalize_bcp_pairing(raw_bcp)
    assert norm["table"] == 3
    assert norm["p1_name"] == "Alpha Player"
    assert norm["p1_faction"] == "World Eaters"
    assert norm["p1_team"] == "Team Red"
    assert norm["p1_score"] == 88
    assert norm["p2_name"] == "Beta Gamer"
    assert norm["p2_faction"] == "Aeldari"
    assert norm["p2_score"] == 65
    assert norm["is_done"] is True
    assert norm["is_bye"] is False

    # Test BYE scenario
    bye_bcp = {
        "id": "pairing_bye",
        "table": 4,
        "player1": {"id": "p_solo", "name": "Solo Winner"},
        "isBye": True
    }
    norm_bye = _normalize_bcp_pairing(bye_bcp)
    assert norm_bye["p1_name"] == "Solo Winner"
    assert norm_bye["p2_name"] == "BYE"
    assert norm_bye["is_bye"] is True

    print("✅ test_bcp_pairing_normalization_enriches_fields passed!")

def test_bcp_adapter_fetch_event_pairings():
    """Verify BcpAdapter.fetch_event_pairings queries pairings with pairingType=Pairing."""
    from bcp_adapter import BcpAdapter
    import json

    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.read.return_value = json.dumps({
        "active": [
            {
                "id": "pair_test_1",
                "table": 1,
                "round": 1,
                "player1": {"id": "p1", "name": "John3 Hsieh3"},
                "player2": {"id": "p2", "name": "John4 Hsieh4"}
            }
        ]
    }).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.__exit__.return_value = False

    with patch("urllib.request.urlopen", return_value=mock_resp):
        ok, err, pairings = BcpAdapter.fetch_event_pairings(
            event_id="sy5pqLqvkdpU",
            round_num=1,
            pairing_type="Pairing"
        )
        assert ok is True
        assert err is None
        assert len(pairings) == 1
        assert pairings[0]["id"] == "pair_test_1"
        assert pairings[0]["table"] == 1
        assert pairings[0]["player1"]["name"] == "John3 Hsieh3"
        assert pairings[0]["player2"]["name"] == "John4 Hsieh4"

    print("✅ test_bcp_adapter_fetch_event_pairings passed!")

def test_eventstudio_list_events_enriches_from_bcp_details():
    """Verify api_eventstudio_list_events enriches managed BCP events with accurate capacity and roster counts."""
    from routers.eventstudio import api_eventstudio_list_events
    mock_req = MagicMock()
    mock_req.headers = {"Authorization": "Bearer session_token", "X-BCP-Token": "tok123"}
    mock_req.query_params = {}
    mock_req.cookies = {}

    mock_auth = MagicMock()
    mock_auth.get_session.return_value = {"id": "to_user_1", "role": "TO"}
    mock_auth.get_valid_bcp_token.return_value = "tok123"

    mock_db = MagicMock()
    # DB has stale/default values
    mock_db.get_studio_events.return_value = [
        {
            "id": "sy5pqLqvkdpU",
            "name": "hsiehjun test",
            "tier": "Grand Tournament",
            "total_players": 0,
            "capacity": 32,
            "num_rounds": 5,
            "event_date": None,
            "venue": "Yakutsk, Russia",
            "city": "Yakutsk",
            "state": "Sakha Republic"
        }
    ]

    mock_bcp_details = {
        "id": "sy5pqLqvkdpU",
        "name": "hsiehjun test",
        "totalPlayers": 2,
        "numTickets": 2,
        "numberOfRounds": 3,
        "eventDate": "2026-09-07T09:00:00.000Z",
        "venueName": "Yakutsk, Russia"
    }

    with patch("routers.eventstudio.get_auth_manager", return_value=mock_auth), \
         patch("routers.eventstudio.get_database", return_value=mock_db), \
         patch("routers.eventstudio.execute_bcp_api_call", return_value=(None, "No events on organizer search")), \
         patch("scraper.BestCoastPairingsScraper.fetch_event_details", return_value=mock_bcp_details):

        res = asyncio.run(api_eventstudio_list_events(mock_req))
        assert res["success"] is True
        assert len(res["events"]) == 1
        ev = res["events"][0]
        assert ev["id"] == "sy5pqLqvkdpU"
        assert ev["total_players"] == 2
        assert ev["capacity"] == 2
        assert ev["num_rounds"] == 3
        assert ev["event_date"] == "2026-09-07T09:00:00.000Z"

    print("✅ test_eventstudio_list_events_enriches_from_bcp_details passed!")

def test_leaderboard_event_details_populates_live_bcp_pairings():
    """Verify api_event_details populates matches array from live BCP pairings."""
    from routers.leaderboard import api_event_details

    mock_db = MagicMock()
    mock_db.get_event_details.return_value = {
        "id": "sy5pqLqvkdpU",
        "name": "hsiehjun test",
        "event_date": "2026-09-07",
        "total_players": 2,
        "num_rounds": 3,
        "current_round": 1,
        "is_ended": False,
        "matches": [],
        "players": [
            {"id": "J3dKgLjgoYsl", "player_id": "J3dKgLjgoYsl", "name": "John3 Hsieh3", "faction": "Adeptus Custodes"},
            {"id": "rsoPZetp7Ejn", "player_id": "rsoPZetp7Ejn", "name": "John4 Hsieh4", "faction": "Space Marines"}
        ]
    }

    mock_pairings = [
        {
            "id": "Dk3uJcya3Kjz",
            "pairingType": "Pairing",
            "eventId": "sy5pqLqvkdpU",
            "table": 1,
            "round": 1,
            "published": True,
            "isDone": False,
            "player1Id": "J3dKgLjgoYsl",
            "player2Id": "rsoPZetp7Ejn",
            "player1": {
                "id": "J3dKgLjgoYsl",
                "user": {"firstName": "John3", "lastName": "Hsieh3"}
            },
            "player2": {
                "id": "rsoPZetp7Ejn",
                "user": {"firstName": "John4", "lastName": "Hsieh4"}
            }
        }
    ]

    with patch("routers.leaderboard.get_database", return_value=mock_db), \
         patch("scraper.BestCoastPairingsScraper.fetch_event_pairings_for_round", return_value=mock_pairings), \
         patch("scraper.BestCoastPairingsScraper.fetch_event_players", return_value=[]):

        res = asyncio.run(api_event_details("sy5pqLqvkdpU", force_sync=True))
        assert res["id"] == "sy5pqLqvkdpU"
        assert len(res["matches"]) == 1
        m = res["matches"][0]
        assert m["round"] == 1
        assert m["table_number"] == 1
        assert m["player1_name"] == "John3 Hsieh3"
        assert m["player2_name"] == "John4 Hsieh4"
        assert m["player1_faction"] == "Adeptus Custodes"
        assert m["player2_faction"] == "Space Marines"
        assert m["is_done"] is False

    print("✅ test_leaderboard_event_details_populates_live_bcp_pairings passed!")

def test_workspace_refresh_live_button_exists():
    """Verify btn-refresh-tournament-workspace exists in HTML and bundle."""
    app_html = (root_dir / "web" / "app.html").read_text()
    es_html = (root_dir / "web" / "eventstudio.html").read_text()
    bundle_js = (root_dir / "web" / "js" / "app.bundle.min.js").read_text()

    assert "btn-refresh-tournament-workspace" in app_html
    assert "refreshTournamentWorkspace(this)" in app_html
    assert "btn-refresh-tournament-workspace" in es_html
    assert "refreshTournamentWorkspace(this)" in es_html
    assert "refreshTournamentWorkspace" in bundle_js

    print("✅ test_workspace_refresh_live_button_exists passed!")

def test_competitors_can_track_pairings():
    """Verify both competitor accounts and TO/staff can track pairings in tournaments.js and bundle."""
    tournaments_js = (root_dir / "web" / "js" / "tournaments.js").read_text()
    bundle_js = (root_dir / "web" / "js" / "app.bundle.min.js").read_text()

    # Check key identifiers and display_name matching in source & bundle
    assert "u.display_name" in tournaments_js
    assert "u.competitor_name" in tournaments_js
    assert "recordMatchesUser" in tournaments_js
    assert "launchTournamentTracker" in tournaments_js
    assert "launchTournamentTracker" in bundle_js

    # Emulate permission check logic
    def evaluate_can_edit(user, p1_name, p2_name, p1_id="", p2_id=""):
        user_names = []
        if user:
            for k in ("display_name", "competitor_name", "full_name", "name", "username"):
                v = user.get(k)
                if v: user_names.append(v.strip().lower())
        user_ids = []
        if user:
            for k in ("player_id", "bcp_user_id", "bcp_id", "id", "userId"):
                v = user.get(k)
                if v: user_ids.append(str(v).strip().lower())
        
        p1_clean = (p1_name or "").strip().lower()
        p2_clean = (p2_name or "").strip().lower()

        is_p1 = bool(user and ((p1_id and p1_id.lower() in user_ids) or any(un == p1_clean for un in user_names)))
        is_p2 = bool(user and ((p2_id and p2_id.lower() in user_ids) or any(un == p2_clean for un in user_names)))
        user_role = (user.get("role") or "").lower() if user else ""
        is_staff = bool(user and (user_role in ("admin", "to", "referee", "organizer") or user.get("is_admin") or user.get("can_access_to")))
        return is_p1 or is_p2 or is_staff

    p1 = "John3 Hsieh3"
    p2 = "John4 Hsieh4"

    # Player 1 (John3) logged in
    u1 = {"id": "uid-3", "display_name": "John3 Hsieh3", "role": "player"}
    assert evaluate_can_edit(u1, p1, p2) is True

    # Player 2 (John4) logged in
    u2 = {"id": "uid-4", "display_name": "John4 Hsieh4", "role": "player"}
    assert evaluate_can_edit(u2, p1, p2) is True

    # TO / Staff logged in
    u_to = {"id": "uid-to", "display_name": "TO Staff", "role": "to"}
    assert evaluate_can_edit(u_to, p1, p2) is True

    # Unrelated spectator
    u_spec = {"id": "uid-spec", "display_name": "Spectator Dave", "role": "player"}
    assert evaluate_can_edit(u_spec, p1, p2) is False

    print("✅ test_competitors_can_track_pairings passed!")

def test_tracker_room_creation_for_both_players():
    """Verify tracker room creation assigns correct player slot regardless of which competitor launches first."""
    from routers.tracker import api_tracker_create_room, api_tracker_join_room, TrackerCreatePayload, TrackerJoinPayload, TRACKER_ROOMS

    mock_db = MagicMock()
    mock_db.get_tracker_game.return_value = None

    # Test Player 2 launches Track first
    match_id = "BCP-TESTEV-R1-T1"
    TRACKER_ROOMS.pop(match_id, None)

    req_p2 = MagicMock()
    req_p2.headers = {}
    req_p2.cookies = {"session_token": "token_p2"}

    user_p2 = {"id": "u4_id", "display_name": "John4 Hsieh4", "role": "player"}
    mock_auth_p2 = MagicMock()
    mock_auth_p2.get_session.return_value = user_p2

    payload_create = TrackerCreatePayload(
        token="token_p2",
        match_id=match_id,
        event_id="TESTEV",
        round_num=1,
        table_num=1,
        p1_name="John3 Hsieh3",
        p2_name="John4 Hsieh4"
    )

    with patch("routers.tracker.get_database", return_value=mock_db), \
         patch("routers.tracker.get_auth_manager", return_value=mock_auth_p2):

        res_create = asyncio.run(api_tracker_create_room(req_p2, payload_create))
        assert res_create["success"] is True
        assert res_create["role"] == "player2"
        assert res_create["user_id_p2"] == "u4_id"
        assert res_create["user_id_p1"] is None
        assert res_create["p1_name"] == "John3 Hsieh3"
        assert res_create["p2_name"] == "John4 Hsieh4"

    # Now Player 1 joins the existing room
    req_p1 = MagicMock()
    req_p1.headers = {}
    req_p1.cookies = {"session_token": "token_p1"}

    user_p1 = {"id": "u3_id", "display_name": "John3 Hsieh3", "role": "player"}
    mock_auth_p1 = MagicMock()
    mock_auth_p1.get_session.return_value = user_p1

    payload_join = TrackerJoinPayload(
        token="token_p1",
        player_name="John3 Hsieh3"
    )

    with patch("routers.tracker.get_database", return_value=mock_db), \
         patch("routers.tracker.get_auth_manager", return_value=mock_auth_p1):

        res_join = asyncio.run(api_tracker_join_room(match_id, req_p1, payload_join))
        assert res_join["success"] is True
        assert res_join["role"] == "player1"

    # Clean up
    TRACKER_ROOMS.pop(match_id, None)
    print("✅ test_tracker_room_creation_for_both_players passed!")

def test_eventstudio_submit_score_resolves_live_bcp_pairing_id():
    """Verify that submit_score for a BCP tournament resolves live pairing ID when omitted."""
    from routers.eventstudio import api_eventstudio_submit_score, SubmitScorePayload
    from bcp_adapter import BcpAdapter

    mock_db = MagicMock()
    mock_db.get_studio_event.return_value = None  # Live BCP tournament not in studio_events DB

    mock_auth = MagicMock()
    mock_auth.get_session.return_value = {"id": "usr_999", "email": "to@example.com"}
    mock_auth.get_valid_bcp_tokens.return_value = {
        "id_token": "valid_bcp_id_token_xyz",
        "access_token": "valid_bcp_access_token_xyz"
    }

    mock_pairings = [
        {"id": "Dk3uJcya3Kjz", "table": 1, "round": 1, "player1Id": "p1", "player2Id": "p2"}
    ]

    req = MagicMock()
    req.headers = {"Authorization": "Bearer native_omnitactica_session_token"}
    req.cookies = {}

    payload = SubmitScorePayload(
        event_id="sy5pqLqvkdpU",
        table=1,
        round_num=1,
        p1_score=90,
        p2_score=60,
        source_app="GameTracker-OmniTactica"
    )

    with patch("routers.eventstudio.get_database", return_value=mock_db), \
         patch("routers.eventstudio.get_auth_manager", return_value=mock_auth), \
         patch.object(BcpAdapter, "fetch_event_pairings", return_value=(True, None, mock_pairings)) as mock_fetch, \
         patch.object(BcpAdapter, "submit_pairing_scores", return_value=(True, None)) as mock_submit:

        res = asyncio.run(api_eventstudio_submit_score(payload, req))
        assert res["success"] is True
        assert res["bcp_synced"] is True
        assert res["pairing_id"] == "Dk3uJcya3Kjz"

        # Verify submit_pairing_scores called with real BCP pairing ID, not "1"
        mock_submit.assert_called_once()
        _, kwargs = mock_submit.call_args
        assert kwargs["pairing_id"] == "Dk3uJcya3Kjz"
        assert kwargs["p1_score"] == 90
        assert kwargs["p2_score"] == 60
        # Verify it used BCP id_token, NOT the native session token
        assert kwargs["explicit_token"] == "valid_bcp_id_token_xyz"
        assert kwargs["user_id"] == "usr_999"

        # Verify zero DB interactions for BCP tournaments
        mock_db.get_studio_event.assert_not_called()
        mock_db.save_studio_event.assert_not_called()

    print("✅ test_eventstudio_submit_score_resolves_live_bcp_pairing_id passed!")

def test_eventstudio_submit_score_for_native_draft_saves_locally():
    """Verify that native draft tournaments (ES-*) save scores locally without BCP calls."""
    from routers.eventstudio import api_eventstudio_submit_score, SubmitScorePayload
    from bcp_adapter import BcpAdapter

    mock_db = MagicMock()
    mock_db.get_studio_event.return_value = {
        "id": "ES-TEST-123",
        "pairings": {
            "1": [
                {"table": 1, "p1_score": 0, "p2_score": 0, "is_done": False}
            ]
        }
    }

    mock_auth = MagicMock()
    mock_auth.get_session.return_value = {"id": "usr_local", "email": "local@example.com"}

    req = MagicMock()
    req.headers = {"Authorization": "Bearer session_token"}
    req.cookies = {}

    payload = SubmitScorePayload(
        event_id="ES-TEST-123",
        table=1,
        round_num=1,
        p1_score=75,
        p2_score=45,
        source_app="GameTracker-OmniTactica"
    )

    with patch("routers.eventstudio.get_database", return_value=mock_db), \
         patch("routers.eventstudio.get_auth_manager", return_value=mock_auth), \
         patch.object(BcpAdapter, "fetch_event_pairings") as mock_fetch, \
         patch.object(BcpAdapter, "submit_pairing_scores") as mock_submit:

        res = asyncio.run(api_eventstudio_submit_score(payload, req))
        assert res["success"] is True
        assert res["bcp_synced"] is False
        mock_db.get_studio_event.assert_called_once_with("ES-TEST-123")
        mock_db.save_studio_event.assert_called_once()
        mock_fetch.assert_not_called()
        mock_submit.assert_not_called()

    print("✅ test_eventstudio_submit_score_for_native_draft_saves_locally passed!")

def test_bcp_adapter_submit_pairing_scores_guards_and_payload():
    """Verify BcpAdapter.submit_pairing_scores rejects numeric table IDs and constructs correct gameData."""
    from bcp_adapter import BcpAdapter

    # Reject numeric table string
    ok, err = BcpAdapter.submit_pairing_scores("1", 80, 20)
    assert ok is False
    assert "Invalid pairing_id" in err

    # Valid pairing ID
    with patch.object(BcpAdapter, "execute_call", return_value=({"success": True}, None)) as mock_exec:
        ok, err = BcpAdapter.submit_pairing_scores("Dk3uJcya3Kjz", 85, 45, user_id="usr_123")
        assert ok is True
        mock_exec.assert_called_once()
        args, kwargs = mock_exec.call_args
        assert "pairings/Dk3uJcya3Kjz/submitScores" in args[0]
        payload = kwargs["json_data"]
        assert payload["gameData"]["player1Score"] == 85
        assert payload["gameData"]["player2Score"] == 45
        assert payload["gameData"]["player1Points"] == 85
        assert payload["gameData"]["player2Points"] == 45
        assert payload["gameData"]["player1Result"] == 2  # Win
        assert payload["gameData"]["player2Result"] == 0  # Loss

    print("✅ test_bcp_adapter_submit_pairing_scores_guards_and_payload passed!")

def test_event_modal_subtabs_hidden_on_mobile_and_desktop():
    """Verify that conditional subtabs (player details, team placings, elo rankings) are hidden by default and on mobile."""
    app_html = (root_dir / "web" / "app.html").read_text()
    styles_css = (root_dir / "web" / "css" / "styles.css").read_text()
    tournaments_js = (root_dir / "web" / "js" / "tournaments.js").read_text()

    # 1. Check HTML defaults
    assert 'id="event-subtab-player"' in app_html
    assert 'id="event-subtab-player" class="subtab-btn" onclick="switchEventModalTab(\'player\')" style="display: none !important;"' in app_html
    assert 'id="event-subtab-teams" class="subtab-btn" onclick="switchEventModalTab(\'teams\')" style="display: none !important;"' in app_html

    # 2. Check CSS guarantees hidden subtabs stay hidden
    assert '.subtab-btn[style*="display: none"]' in styles_css
    assert '#event-subtab-player[style*="display: none"]' in styles_css
    assert '#event-subtab-teams[style*="display: none"]' in styles_css

    # 3. Check tournaments.js resets subtabs on open
    assert "subtabPlayerInit.style.setProperty('display', (initialTab === 'player') ? 'inline-flex' : 'none', 'important')" in tournaments_js
    assert "subtabTeamsInit.style.setProperty('display', 'none', 'important')" in tournaments_js

    print("✅ test_event_modal_subtabs_hidden_on_mobile_and_desktop passed!")

def test_predictor_head_to_head_event_modal_link():
    """Verify that head-to-head match history in Match Predictor makes event names clickable to open the event modal."""
    predictor_js = (root_dir / "web" / "js" / "predictor.js").read_text()
    bundle_js = (root_dir / "web" / "js" / "app.bundle.min.js").read_text()

    # 1. Check predictor.js has h2h-event-cell, player-link, and openEventModal invocation
    assert "h2h-event-cell" in predictor_js
    assert "player-link" in predictor_js
    assert "openEventModal(eventId, false)" in predictor_js

    # 2. Check minified bundle has the click handler wired
    assert "h2h-event-cell" in bundle_js
    assert "openEventModal" in bundle_js

    print("✅ test_predictor_head_to_head_event_modal_link passed!")

def test_format_bcp_roster_unplaced_competitors_and_bcp_name_priority():
    """Verify format_bcp_roster_to_players prioritizes BCP human-readable names and leaves unplaced competitors without artificial placement collisions."""
    from routers.leaderboard import format_bcp_roster_to_players

    raw_players = [
        {
            "id": "twitty_bcp_id",
            "userId": "twitty_user_id",
            "user": {"id": "twitty_user_id", "firstName": "Daniel", "lastName": "Twitty"},
            "placing": 26,
            "checkedIn": True,
            "metrics": [{"name": "Wins", "value": 3}, {"name": "Losses", "value": 2}, {"name": "Battle Points", "value": 350}]
        },
        {
            "id": "wilson_bcp_id",
            "userId": "wilson_user_id",
            "user": {"id": "wilson_user_id", "firstName": "Joshua", "lastName": "Wilson"},
            "placing": None,
            "checkedIn": False,
            "dropped": False,
            "metrics": []
        },
        {
            "id": "work_bcp_id",
            "userId": "work_user_id",
            "user": {"id": "work_user_id", "firstName": "John", "lastName": "Work"},
            "placing": 5,
            "checkedIn": True,
            "metrics": [{"name": "Wins", "value": 5}, {"name": "Losses", "value": 0}, {"name": "Battle Points", "value": 500}]
        }
    ]

    existing_players = [
        {
            "player_id": "canonical_db_work_id",
            "user_id": "work_user_id",
            "full_name": "J W",  # Stale abbreviated name in DB
            "current_elo": 1820.0,
            "peak_elo": 1850.0
        }
    ]

    mock_db = MagicMock()
    mock_db.get_player_ratings_by_ids.return_value = {
        "work_user_id": {"current_elo": 1820.0, "peak_elo": 1850.0, "player_name": "J W"}
    }

    with patch("routers.leaderboard.get_database", return_value=mock_db):
        formatted = format_bcp_roster_to_players(raw_players, existing_players)

    # Verify 3 formatted players
    assert len(formatted) == 3

    # Check John Work
    work = next(p for p in formatted if p["user_id"] == "work_user_id")
    assert work["full_name"] == "John Work"  # Fresh name from BCP takes priority over "J W"
    assert work["player_id"] == "canonical_db_work_id"  # Preserved player_id for Elo
    assert work["placement"] == 5
    assert work["rank"] == 5

    # Check Daniel Twitty
    twitty = next(p for p in formatted if p["user_id"] == "twitty_user_id")
    assert twitty["full_name"] == "Daniel Twitty"
    assert twitty["placement"] == 26
    assert twitty["rank"] == 26

    # Check Joshua Wilson
    wilson = next(p for p in formatted if p["user_id"] == "wilson_user_id")
    assert wilson["full_name"] == "Joshua Wilson"
    assert wilson["placement"] is None  # Must NOT collide or be assigned idx + 1
    assert wilson["rank"] is None
    assert wilson["checked_in"] is False

    # Placed players should be at the top, unplaced at the bottom
    assert formatted[-1]["user_id"] == "wilson_user_id"

    print("✅ test_format_bcp_roster_unplaced_competitors_and_bcp_name_priority passed!")

def test_tournaments_js_unplaced_competitors_rendering():
    """Verify tournaments.js and bundle handle unplaced competitors with hyphen rank, no 0-0 record, and no 0 pts."""
    tournaments_js = (root_dir / "web" / "js" / "tournaments.js").read_text(encoding="utf-8")
    bundle_js = (root_dir / "web" / "js" / "app.bundle.min.js").read_text(encoding="utf-8")

    assert "⚠️ Not Checked In" in tournaments_js
    assert "🚫 Dropped" in tournaments_js
    assert "📋 0 Matches" in tournaments_js
    assert "Not Checked In" in bundle_js
    assert "0 Matches" in bundle_js

    print("✅ test_tournaments_js_unplaced_competitors_rendering passed!")

def test_tournament_tracker_table_pairing_role_enforcement():
    """
    Verify that in a tournament match (e.g. 3-player event with Player 2 and Player 3 paired on Table 1,
    and Player 4 on a bye), only Player 2 and Player 3 can claim competitor slots.
    Player 4 (or any non-table user) entering the room gets 'spectator' role and cannot modify state or finalize.
    """
    from routers.tracker import (
        api_tracker_create_room,
        api_tracker_join_room,
        api_tracker_save_state,
        api_tracker_finalize_game,
        TrackerCreatePayload,
        TrackerJoinPayload,
        TrackerStatePayload,
        TrackerActionPayload,
        TRACKER_ROOMS
    )
    from core import HTTPException

    mock_db = MagicMock()
    mock_db.get_tracker_game.return_value = None
    mock_fs = MagicMock()
    mock_fs.get_room.return_value = None
    mock_fs.is_connected = False

    match_id = "BCP-3PLAYEREV-R1-T1"
    if match_id in TRACKER_ROOMS:
        del TRACKER_ROOMS[match_id]

    # User sessions
    user_p2 = {"id": "usr_p2", "display_name": "Player 2"}
    user_p3 = {"id": "usr_p3", "display_name": "Player 3"}
    user_p4 = {"id": "usr_p4", "display_name": "Player 4"} # Player with Bye

    mock_auth = MagicMock()

    # Step 1: Room is initialized for Table 1: Player 2 vs Player 3
    # Either created by TO/Staff or by tournament system
    mock_auth.get_session.return_value = user_p2
    create_payload = TrackerCreatePayload(
        match_id=match_id,
        event_id="3PLAYEREV",
        round_num=1,
        table_num=1,
        p1_name="Player 2",
        p2_name="Player 3",
        p1_id="usr_p2",
        p2_id="usr_p3"
    )

    mock_req_p2 = MagicMock()
    mock_req_p2.headers = {"Authorization": "Bearer tok_p2"}
    mock_req_p2.cookies = {}

    with patch("routers.tracker.get_database", return_value=mock_db), \
         patch("routers.tracker.get_firestore_engine", return_value=mock_fs), \
         patch("routers.tracker.get_auth_manager", return_value=mock_auth):

        res_create = asyncio.run(api_tracker_create_room(mock_req_p2, create_payload))
        assert res_create["success"] is True
        assert res_create["role"] == "player1"
        assert res_create["user_id_p1"] == "usr_p2"
        assert res_create["user_id_p2"] is None # P2 slot still unclaimed!

        # Step 2: Player 4 (on a bye) enters Table 1's room
        mock_auth.get_session.return_value = user_p4
        mock_req_p4 = MagicMock()
        mock_req_p4.headers = {"Authorization": "Bearer tok_p4"}
        mock_req_p4.cookies = {}

        join_payload_p4 = TrackerJoinPayload(
            player_name="Player 4",
            player_id="usr_p4"
        )
        res_join_p4 = asyncio.run(api_tracker_join_room(match_id, mock_req_p4, join_payload_p4))
        
        # Player 4 MUST enter strictly as spectator!
        assert res_join_p4["role"] == "spectator", f"Expected spectator, got {res_join_p4['role']}"
        # Player 4 MUST NOT have claimed either player slot!
        assert res_join_p4["user_id_p1"] == "usr_p2"
        assert res_join_p4["user_id_p2"] is None, f"P2 slot must remain unclaimed, got {res_join_p4['user_id_p2']}"
        # Player 2 and Player 3 names must remain intact in state
        st = res_join_p4["state"]
        assert st["game"]["p1Name"] == "Player 2"
        assert st["game"]["p2Name"] == "Player 3"

        # Step 3: Player 4 attempts to modify game state - MUST receive HTTP 403 Forbidden!
        state_payload = TrackerStatePayload(
            match_id=match_id,
            role="spectator",
            version=2,
            state={"game": {"p1Name": "Hijacked", "p2Name": "Hijacked"}}
        )
        try:
            asyncio.run(api_tracker_save_state(match_id, state_payload, mock_req_p4))
            assert False, "Player 4 should be rejected with 403 Forbidden when trying to save state"
        except HTTPException as e:
            assert e.status_code == 403
            assert "Only matched competitors or tournament organizers can edit" in str(e.detail)

        # Step 4: Player 4 attempts to finalize game - MUST receive HTTP 403 Forbidden!
        finalize_payload = TrackerActionPayload(
            match_id=match_id
        )
        try:
            asyncio.run(api_tracker_finalize_game(match_id, mock_req_p4, finalize_payload))
            assert False, "Player 4 should be rejected with 403 Forbidden when trying to finalize game"
        except HTTPException as e:
            assert e.status_code == 403
            assert "Only matched competitors or tournament organizers can finalize" in str(e.detail)

        # Step 5: The actual assigned opponent (Player 3) enters Table 1's room
        mock_auth.get_session.return_value = user_p3
        mock_req_p3 = MagicMock()
        mock_req_p3.headers = {"Authorization": "Bearer tok_p3"}
        mock_req_p3.cookies = {}

        join_payload_p3 = TrackerJoinPayload(
            player_name="Player 3",
            player_id="usr_p3"
        )
        res_join_p3 = asyncio.run(api_tracker_join_room(match_id, mock_req_p3, join_payload_p3))

        # Player 3 MUST successfully claim player2!
        assert res_join_p3["role"] == "player2", f"Expected player2, got {res_join_p3['role']}"
        assert res_join_p3["user_id_p2"] == "usr_p3"
        assert TRACKER_ROOMS[match_id]["user_id_p2"] == "usr_p3"

        # Clean up
        if match_id in TRACKER_ROOMS:
            del TRACKER_ROOMS[match_id]

    print("✅ test_tournament_tracker_table_pairing_role_enforcement passed!")

def test_registration_popup_loading_screen_and_flow():
    """Verify loading screen markup in app.html, synchronous modal handling in community.js and bundle."""
    app_html = (root_dir / "web" / "app.html").read_text(encoding="utf-8")
    comm_js = (root_dir / "web" / "js" / "community.js").read_text(encoding="utf-8")
    bundle_js = (root_dir / "web" / "js" / "app.bundle.min.js").read_text(encoding="utf-8")

    # 1. Loading modal must exist in app.html
    assert 'id="event-reg-loading-modal"' in app_html, "event-reg-loading-modal missing in app.html"
    assert 'id="event-reg-loading-text"' in app_html, "event-reg-loading-text missing in app.html"
    assert 'Connecting to BCP...' in app_html, "Connecting to BCP... missing in app.html"

    # 2. Loading modal handling in community.js
    assert "closeEventRegistrationLoadingModal" in comm_js, "closeEventRegistrationLoadingModal missing in community.js"
    assert "event-reg-loading-modal" in comm_js, "event-reg-loading-modal reference missing in community.js"
    
    # Verify openEventRegistrationModal sets loadingModal to flex before fetching
    open_func = comm_js.split("async function openEventRegistrationModal")[1].split("function closeEventRegistrationModal")[0]
    assert "loadingModal.style.display = 'flex'" in open_func, "loading modal must be shown before BCP API call"
    assert "await window.api.getCommunityEventRegistration" in open_func, "API call missing"
    assert "loadingModal.style.display = 'none'" in open_func, "loading modal must be hidden after API call returns"

    # Verify bundle
    assert "event-reg-loading-modal" in bundle_js, "event-reg-loading-modal missing in bundle"
    assert "closeEventRegistrationLoadingModal" in bundle_js, "closeEventRegistrationLoadingModal missing in bundle"

    print("✅ test_registration_popup_loading_screen_and_flow passed!")

def test_tournament_details_popup_loading_screen_and_flow():
    """Verify tournament details loading screen markup in app.html, parallelized fetching, and modal lifecycle in tournaments.js and bundle."""
    app_html = (root_dir / "web" / "app.html").read_text(encoding="utf-8")
    tournaments_js = (root_dir / "web" / "js" / "tournaments.js").read_text(encoding="utf-8")
    styles_css = (root_dir / "web" / "css" / "styles.css").read_text(encoding="utf-8")
    bundle_js = (root_dir / "web" / "js" / "app.bundle.min.js").read_text(encoding="utf-8")

    # 1. Loading modal DOM must exist in app.html
    assert 'id="event-details-loading-modal"' in app_html, "event-details-loading-modal missing in app.html"
    assert 'id="event-details-loading-title"' in app_html, "event-details-loading-title missing in app.html"
    assert 'id="event-details-loading-text"' in app_html, "event-details-loading-text missing in app.html"
    assert 'Connecting to BCP...' in app_html, "Connecting to BCP... title missing in app.html"

    # 2. Responsive styling in styles.css
    assert ".event-details-loading-modal-content" in styles_css, "event-details-loading-modal-content missing in styles.css"

    # 3. Loading modal helper and parallelized fetching in tournaments.js
    assert "closeEventDetailsLoadingModal" in tournaments_js, "closeEventDetailsLoadingModal missing in tournaments.js"
    assert "window.closeEventDetailsLoadingModal = closeEventDetailsLoadingModal" in tournaments_js, "window binding missing in tournaments.js"
    assert "Promise.allSettled" in tournaments_js, "Parallelized Promise.allSettled missing in tournaments.js"
    assert "event-details-loading-modal" in tournaments_js, "event-details-loading-modal reference missing in tournaments.js"

    # 4. Verify openEventModal shows loadingModal before fetching and hides before revealing modal
    open_func = tournaments_js.split("async function openEventModal(eventId, forceSync = false, initialTab = null)")[1].split("function updateEventModalTabCountsForSearch")[0]
    assert "loadingModal.style.display = 'flex'" in open_func, "Loading modal must be displayed before fetching data"
    assert "Promise.allSettled" in open_func, "Promise.allSettled must be used in openEventModal"
    assert "loadingModal.style.display = 'none'" in open_func, "Loading modal must be hidden when data arrives"
    assert "bringModalToFront(modal)" in open_func, "event-modal must be brought to front after data is populated"

    # 5. Verify bundle has minified references
    assert "event-details-loading-modal" in bundle_js, "event-details-loading-modal missing in bundle"
    assert "closeEventDetailsLoadingModal" in bundle_js, "closeEventDetailsLoadingModal missing in bundle"

    print("✅ test_tournament_details_popup_loading_screen_and_flow passed!")

def test_bcp_adapter_submit_pairing_scores_root_and_game_payload():
    """Verify submit_pairing_scores includes isDone, winnerId, and points at both root and gameData levels."""
    from bcp_adapter import BcpAdapter

    with patch.object(BcpAdapter, "execute_call", return_value=({"success": True}, None)) as mock_exec:
        ok, err = BcpAdapter.submit_pairing_scores(
            pairing_id="test_pairing_999",
            p1_score=95,
            p2_score=60,
            winner_id="player_alpha",
            user_id="user_host"
        )
        assert ok is True
        mock_exec.assert_called_once()
        args, kwargs = mock_exec.call_args
        assert "pairings/test_pairing_999/submitScores" in args[0]
        payload = kwargs["json_data"]

        # Root-level properties (Required by BCP to transition pairing to finished)
        assert payload["isDone"] is True
        assert payload["player1Score"] == 95
        assert payload["player2Score"] == 60
        assert payload["player1Points"] == 95
        assert payload["player2Points"] == 60
        assert payload["player1Result"] == 2
        assert payload["player2Result"] == 0
        assert payload["winnerId"] == "player_alpha"
        assert payload["player1Game"]["points"] == 95
        assert payload["player1Game"]["gamePoints"] == 95
        assert payload["player1Game"]["result"] == 2
        assert payload["player1Game"]["gameResult"] == 2
        assert payload["player2Game"]["points"] == 60
        assert payload["player2Game"]["gamePoints"] == 60
        assert payload["player2Game"]["result"] == 0
        assert payload["player2Game"]["gameResult"] == 0

        # gameData nested payload
        gd = payload["gameData"]
        assert gd["player1Score"] == 95
        assert gd["player2Score"] == 60
        assert gd["player1Points"] == 95
        assert gd["player2Points"] == 60
        assert gd["player1Result"] == 2
        assert gd["player2Result"] == 0
        assert gd["winnerId"] == "player_alpha"
        assert gd["player1Game"]["points"] == 95
        assert gd["player1Game"]["gamePoints"] == 95
        assert gd["player1Game"]["result"] == 2
        assert gd["player1Game"]["gameResult"] == 2
        assert gd["player2Game"]["points"] == 60
        assert gd["player2Game"]["gamePoints"] == 60
        assert gd["player2Game"]["result"] == 0
        assert gd["player2Game"]["gameResult"] == 0

    print("✅ test_bcp_adapter_submit_pairing_scores_root_and_game_payload passed!")

def test_eventstudio_submit_score_saves_to_db_and_tracker_game():
    """Verify api_eventstudio_submit_score immediately updates local DB matches and tracker_games for live tournaments."""
    from routers.eventstudio import api_eventstudio_submit_score, SubmitScorePayload
    from bcp_adapter import BcpAdapter

    mock_db = MagicMock()
    mock_auth = MagicMock()
    mock_auth.get_session.return_value = {"id": "usr_p1", "role": "player"}
    mock_auth.get_valid_bcp_tokens.return_value = {"access_token": "mock_bcp_tok"}

    req = MagicMock()
    req.headers = {"Authorization": "Bearer tok"}
    req.cookies = {}

    payload = SubmitScorePayload(
        event_id="BCP-TOURNAMENT-42",
        round_num=1,
        table_num=1,
        p1_id="usr_p1",
        p2_id="usr_p2",
        p1_name="Alice",
        p2_name="Bob",
        p1_score=90,
        p2_score=70,
        pairing_id="bcp_pair_123",
        source_app="GameTracker-OmniTactica"
    )

    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    mock_conn.__enter__.return_value = mock_conn
    mock_db.get_connection.return_value = mock_conn

    with patch("routers.eventstudio.get_database", return_value=mock_db), \
         patch("routers.eventstudio.get_auth_manager", return_value=mock_auth), \
         patch.object(BcpAdapter, "fetch_event_pairings", return_value=[]), \
         patch.object(BcpAdapter, "submit_pairing_scores", return_value=(True, None)) as mock_bcp_sub:

        res = asyncio.run(api_eventstudio_submit_score(payload, req))
        assert res["success"] is True
        assert res["bcp_synced"] is True

        # Check DB upsert_match called
        mock_db.upsert_match.assert_called_once()
        match_call = mock_db.upsert_match.call_args[0][0]
        assert match_call["event_id"] == "BCP-TOURNAMENT-42"
        assert match_call["player1_name"] == "Alice"
        assert match_call["player2_name"] == "Bob"
        assert match_call["player1_score"] == 90
        assert match_call["player2_score"] == 70
        assert match_call["winner_id"] == "usr_p1"
        assert match_call["is_done"] is True

        # Check tracker_games updated via connection cursor execute
        tracker_calls = [c for c in mock_cur.execute.call_args_list if "UPDATE tracker_games" in str(c[0][0])]
        assert len(tracker_calls) == 1
        tracker_sql = tracker_calls[0][0][0]
        assert "UPDATE tracker_games" in tracker_sql
        assert "is_finished = TRUE" in tracker_sql
        assert "bcp_submitted = TRUE" in tracker_sql

        # Check BCP adapter called with winner_id, p1_id, p2_id in game_data
        mock_bcp_sub.assert_called_once_with(
            pairing_id="bcp_pair_123",
            p1_score=90,
            p2_score=70,
            game_data={"winner_id": "usr_p1", "p1_id": "usr_p1", "p2_id": "usr_p2"},
            user_id="usr_p1",
            explicit_token="mock_bcp_tok",
            winner_id="usr_p1"
        )

    print("✅ test_eventstudio_submit_score_saves_to_db_and_tracker_game passed!")

def test_spectate_tournament_tracker_and_pairings_button():
    """Verify spectateTournamentTracker is exported and pairings rows render Spectate for non-table users."""
    tournaments_js = (root_dir / "web" / "js" / "tournaments.js").read_text()
    bundle_js = (root_dir / "web" / "js" / "app.bundle.min.js").read_text()

    # 1. tournaments.js defines spectateTournamentTracker
    assert "async function spectateTournamentTracker" in tournaments_js
    assert "window.spectateTournamentTracker = spectateTournamentTracker" in tournaments_js

    # 2. tournaments.js renders Spectate button for non-editing users
    assert "👁️ Spectate" in tournaments_js
    assert "spectateTournamentTracker(" in tournaments_js

    # 3. app.bundle.min.js includes spectateTournamentTracker
    assert "spectateTournamentTracker" in bundle_js

    print("✅ test_spectate_tournament_tracker_and_pairings_button passed!")

def test_tournament_registration_mobile_styles_and_attributes():
    """Verify registration modal, loading modal, and player details form are styled for mobile."""
    app_html = (root_dir / "web" / "app.html").read_text()
    styles_css = (root_dir / "web" / "css" / "styles.css").read_text()

    # 1. HTML classes
    assert 'class="modal-content event-reg-loading-modal-content"' in app_html
    assert 'class="modal-content event-reg-modal-content"' in app_html
    assert 'class="modal-content tournament-reg-modal-content"' in app_html
    assert 'class="event-reg-grid-row"' in app_html
    assert 'class="player-details-grid-row"' in app_html

    # 2. CSS responsive rules
    assert ".event-reg-modal-content" in styles_css
    assert ".tournament-reg-modal-content" in styles_css
    assert ".event-reg-grid-row" in styles_css
    assert ".player-details-grid-row" in styles_css
    assert "@media (max-width: 640px)" in styles_css
    assert "grid-template-columns: 1fr !important" in styles_css
    assert "font-size: 16px !important" in styles_css

    print("✅ test_tournament_registration_mobile_styles_and_attributes passed!")

def test_eventstudio_bcp_case_healing_and_canonical_resolution():
    """Verify case-healing resolves BCP event IDs with mismatched casing."""
    from routers.eventstudio import _resolve_canonical_event_id, _fetch_bcp_event_workspace
    from bcp_adapter import BcpAdapter
    from scraper import BestCoastPairingsScraper

    # Mock organizer events with canonical casing
    mock_bcp_events = [
        {"id": "PQa9c4QnLmcF", "name": "Hsiehjun", "totalPlayers": 2}
    ]
    with patch.object(BcpAdapter, "execute_call", return_value=(mock_bcp_events, None)):
        canonical = _resolve_canonical_event_id("PQa9c4QnLmcf", explicit_token="dummy_token")
        assert canonical == "PQa9c4QnLmcF", f"Expected PQa9c4QnLmcF, got {canonical}"

    # Test _fetch_bcp_event_workspace heals casing on 404
    def mock_fetch_details(eid):
        if eid == "PQa9c4QnLmcF":
            return {"id": "PQa9c4QnLmcF", "name": "Hsiehjun", "totalPlayers": 2, "numberOfRounds": 3}
        return None

    with patch.object(BestCoastPairingsScraper, "fetch_event_details", side_effect=mock_fetch_details), \
         patch.object(BestCoastPairingsScraper, "fetch_event_players", return_value=[{"id": "p1", "name": "Alice"}, {"id": "p2", "name": "Bob"}]), \
         patch("routers.eventstudio._resolve_canonical_event_id", return_value="PQa9c4QnLmcF"):
        ws = _fetch_bcp_event_workspace("PQa9c4QnLmcf", explicit_token="dummy_token")
        assert ws is not None
        assert ws["id"] == "PQa9c4QnLmcF"
        assert ws["name"] == "Hsiehjun"
        assert len(ws["roster"]) == 2

    print("✅ test_eventstudio_bcp_case_healing_and_canonical_resolution passed!")

def test_bcp_metadata_scores_and_payload_wiring():
    """Verify pairing normalization extracts metaData scores and submit_pairing_scores includes metaData."""
    from routers.eventstudio import _normalize_bcp_pairing
    from bcp_adapter import BcpAdapter

    # Normalization fallback to metaData
    raw_pairing = {
        "id": "tS6xZ5SoIjgr",
        "table": 1,
        "player1Id": "H3LVYHvSuwOD",
        "player2Id": "SSR4aLbSI3fS",
        "player1": {"id": "H3LVYHvSuwOD", "name": "John4 Hsieh4"},
        "player2": {"id": "SSR4aLbSI3fS", "name": "John3 Hsieh3"},
        "player1GameId": "JooLPYpKNqg4",
        "player2GameId": "P6P6fDC5Nytj",
        "player1Game": {"id": "JooLPYpKNqg4", "points": None},
        "player2Game": {"id": "P6P6fDC5Nytj", "points": None},
        "metaData": {
            "p1-gamePoints": "32",
            "p2-gamePoints": "48",
            "p1-gameResult": "0",
            "p2-gameResult": "2"
        }
    }
    norm = _normalize_bcp_pairing(raw_pairing)
    assert norm["p1_score"] == 32
    assert norm["p2_score"] == 48
    assert norm["is_done"] is True
    assert norm["player1GameId"] == "JooLPYpKNqg4"
    assert norm["player2GameId"] == "P6P6fDC5Nytj"

    # submit_pairing_scores payload verification
    with patch.object(BcpAdapter, "execute_call", return_value=({"success": True}, None)) as mock_call:
        ok, err = BcpAdapter.submit_pairing_scores(
            pairing_id="tS6xZ5SoIjgr",
            p1_score=32,
            p2_score=48,
            game_data={
                "player1GameId": "JooLPYpKNqg4",
                "player2GameId": "P6P6fDC5Nytj"
            }
        )
        assert ok is True
        mock_call.assert_called_once()
        payload = mock_call.call_args[1]["json_data"]
        assert payload["player1Score"] == 32
        assert payload["player2Score"] == 48
        assert payload["player1GameId"] == "JooLPYpKNqg4"
        assert payload["player2GameId"] == "P6P6fDC5Nytj"
        assert payload["metaData"]["p1-gamePoints"] == "32"
        assert payload["metaData"]["p2-gamePoints"] == "48"
        assert payload["metaData"]["p1-gameResult"] == "0"
        assert payload["metaData"]["p2-gameResult"] == "2"
        assert payload["metaData"]["p1-marginOfVictory"] == -16
        assert payload["metaData"]["p2-marginOfVictory"] == 16

    print("✅ test_bcp_metadata_scores_and_payload_wiring passed!")

def test_eventstudio_quiet_polling_and_live_sync_ui():
    """Verify live polling functions and sync indicator are present in code and bundle."""
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent

    # Check web/js/eventstudio.js
    es_js = (root / "web" / "js" / "eventstudio.js").read_text()
    assert "startStudioPolling" in es_js
    assert "stopStudioPolling" in es_js
    assert "pollTournamentWorkspaceQuietly" in es_js
    assert "flashLiveSyncIndicator" in es_js
    assert "window.startStudioPolling = startStudioPolling" in es_js
    assert "pollStudioEventsQuietly" in es_js

    # Check web/app.html & web/eventstudio.html
    app_html = (root / "web" / "app.html").read_text()
    es_html = (root / "web" / "eventstudio.html").read_text()
    assert 'id="studio-live-sync-indicator"' in app_html
    assert 'id="studio-live-sync-dot"' in app_html
    assert 'id="studio-live-sync-indicator"' in es_html
    assert 'id="studio-live-sync-dot"' in es_html

    # Check app.bundle.min.js
    bundle_js = (root / "web" / "js" / "app.bundle.min.js").read_text()
    assert "startStudioPolling" in bundle_js
    assert "pollTournamentWorkspaceQuietly" in bundle_js

    print("✅ test_eventstudio_quiet_polling_and_live_sync_ui passed!")

def test_eventstudio_spectator_tracker_and_bcp_submit_scores():
    """Verify Event Studio links TOs to tracker in spectator mode, auto-provisions table rooms, and submits scores via BCP submitScores."""
    from pathlib import Path
    from routers.tracker import init_tracker_room_from_tournament
    root = Path(__file__).resolve().parent.parent

    # 1. Event Studio Pairing Spectator Link & ensureStudioTrackerRoom in eventstudio.js
    es_js = (root / "web" / "js" / "eventstudio.js").read_text()
    assert "role=spectator" in es_js, "eventstudio.js must include role=spectator in tracker link"
    assert 'target="_blank"' in es_js, "eventstudio.js must include target=_blank to preserve TO session"
    assert "ensureStudioTrackerRoom" in es_js, "eventstudio.js must define ensureStudioTrackerRoom"
    assert "window.ensureStudioTrackerRoom = ensureStudioTrackerRoom" in es_js
    assert "/v1/pairings/${encodeURIComponent(cleanTargetPid)}/submitScores" in es_js or "submitScores" in es_js

    # 2. bcp_adapter.py submitScores endpoint
    bcp_adapter_py = (root / "bcp_adapter.py").read_text()
    assert "/pairings/{clean_pid}/submitScores" in bcp_adapter_py
    assert "/v1/pairings?eventId=" in bcp_adapter_py or "/pairings?eventId=" in bcp_adapter_py

    # 3. tracker_sync.js table param fallback
    sync_js = (root / "web" / "tracker" / "tracker_sync.js").read_text()
    assert "params.get('eventId')" in sync_js
    assert "BCP-${evId}-R${rNum}-T${tNum}" in sync_js

    # 4. Auto-provisioning via init_tracker_room_from_tournament
    mock_db = MagicMock()
    mock_db.get_event_details.return_value = {
        "id": "SPEC-EV-1",
        "name": "Spectator Test Event",
        "matches": [
            {
                "round_num": 1,
                "table_num": 3,
                "player1_name": "Spectator Alpha",
                "player2_name": "Spectator Beta",
                "player1_id": "p_alpha",
                "player2_id": "p_beta",
                "bcp_pairing_id": "MOBhLa7EXspc"
            }
        ]
    }
    mock_fs = MagicMock()

    room = init_tracker_room_from_tournament("BCP-SPEC-EV-1-R1-T3", mock_fs, mock_db)
    assert room is not None
    assert isinstance(room, dict)
    assert room["p1_name"] == "Spectator Alpha"
    assert room["p2_name"] == "Spectator Beta"
    assert room["table_num"] == 3
    assert room["round_num"] == 1
    assert room["pairing_id"] == "MOBhLa7EXspc"

    mock_fs.create_room.assert_called_once()
    saved_doc = mock_fs.create_room.call_args[0][1]
    assert saved_doc["p1_name"] == "Spectator Alpha"
    assert saved_doc["p2_name"] == "Spectator Beta"

    print("✅ test_eventstudio_spectator_tracker_and_bcp_submit_scores passed!")

def test_game_tracker_bcp_submit_and_put_fallback():
    """Verify BcpAdapter.submit_pairing_scores forwards game IDs, competitor IDs, winner, and falls back to PUT on POST failure."""
    from bcp_adapter import BcpAdapter

    # 1. Verify PUT fallback in BcpAdapter.submit_pairing_scores
    calls = []
    def mock_exec(url, method="POST", json_data=None, user_id=None, explicit_token=None, **kwargs):
        calls.append((url, method, json_data))
        if method == "POST":
            return None, "HTTP 404: Endpoint not found"
        elif method == "PUT":
            return {"success": True}, None
        return None, "error"

    with patch.object(BcpAdapter, "execute_call", side_effect=mock_exec):
        ok, err = BcpAdapter.submit_pairing_scores(
            pairing_id="test_pid_888",
            p1_score=40,
            p2_score=25,
            game_data={
                "p1_game_id": "T75ksHkVRf9B",
                "p2_game_id": "mLs7f8wJMDXu",
                "p1_id": "f2avrXEHDb4y",
                "p2_id": "aNfUhm126Sas",
                "winner_id": "f2avrXEHDb4y"
            },
            explicit_token="mock_tok"
        )
        assert ok is True
        assert len(calls) == 2
        # First call POST
        assert calls[0][1] == "POST"
        assert "submitScores" in calls[0][0]
        # Second call PUT fallback
        assert calls[1][1] == "PUT"
        assert calls[1][0].endswith("/pairings/test_pid_888")
        put_payload = calls[1][2]
        assert put_payload["player1Score"] == 40
        assert put_payload["player2Score"] == 25
        assert put_payload["player1Result"] == 2
        assert put_payload["player2Result"] == 0
        assert put_payload["player1GameId"] == "T75ksHkVRf9B"
        assert put_payload["player2GameId"] == "mLs7f8wJMDXu"
        assert put_payload["player1Id"] == "f2avrXEHDb4y"
        assert put_payload["player2Id"] == "aNfUhm126Sas"
        assert put_payload["winnerId"] == "f2avrXEHDb4y"
        assert put_payload["player1Game"]["id"] == "T75ksHkVRf9B"
        assert put_payload["player2Game"]["id"] == "mLs7f8wJMDXu"

    # 2. Verify tracker_sync.js contains BCP primary action, automatic submit, and direct client fallback
    tracker_js = (root_dir / "web" / "tracker" / "tracker_sync.js").read_text()
    assert "🏆 SUBMIT SCORE TO BCP & FINISH MATCH" in tracker_js
    assert "window.__submitMatchToBcp()" in tracker_js
    assert "https://newprod-api.bestcoastpairings.com/v1/pairings/" in tracker_js
    assert "player1GameId: resolvedP1Gid" in tracker_js
    assert "player2GameId: resolvedP2Gid" in tracker_js

    print("✅ test_game_tracker_bcp_submit_and_put_fallback passed!")

if __name__ == "__main__":
    test_eventstudio_get_event_queries_bcp_directly()
    test_eventstudio_create_event_skips_db_save_when_bcp_succeeds()
    test_submit_btn_defined_in_community_js()
    test_sync_bcp_events_button_hidden_in_ui()
    test_eventstudio_remove_player_calls_bcp_delete()
    test_community_overview_no_unbound_local_elo()
    test_bcp_register_player_already_registered_check()
    test_managed_tournaments_refresh_button_and_player_counts()
    test_bcp_generate_pairings_and_content_length_zero()
    test_bcp_get_pairings_status()
    test_eventstudio_start_event_decoupled_and_pairings_status()
    test_bcp_pairing_normalization_enriches_fields()
    test_bcp_adapter_fetch_event_pairings()
    test_eventstudio_list_events_enriches_from_bcp_details()
    test_leaderboard_event_details_populates_live_bcp_pairings()
    test_workspace_refresh_live_button_exists()
    test_competitors_can_track_pairings()
    test_tracker_room_creation_for_both_players()
    test_eventstudio_submit_score_resolves_live_bcp_pairing_id()
    test_eventstudio_submit_score_for_native_draft_saves_locally()
    test_bcp_adapter_submit_pairing_scores_guards_and_payload()
    test_event_modal_subtabs_hidden_on_mobile_and_desktop()
    test_predictor_head_to_head_event_modal_link()
    test_format_bcp_roster_unplaced_competitors_and_bcp_name_priority()
    test_tournaments_js_unplaced_competitors_rendering()
    test_tournament_tracker_table_pairing_role_enforcement()
    test_registration_popup_loading_screen_and_flow()
    test_tournament_details_popup_loading_screen_and_flow()
    test_bcp_adapter_submit_pairing_scores_root_and_game_payload()
    test_eventstudio_submit_score_saves_to_db_and_tracker_game()
    test_spectate_tournament_tracker_and_pairings_button()
    test_tournament_registration_mobile_styles_and_attributes()
    test_eventstudio_bcp_case_healing_and_canonical_resolution()
    test_bcp_metadata_scores_and_payload_wiring()
    test_eventstudio_quiet_polling_and_live_sync_ui()
    test_eventstudio_spectator_tracker_and_bcp_submit_scores()
    test_game_tracker_bcp_submit_and_put_fallback()
    print("\n🎉 ALL EVENT STUDIO DIRECT BCP TESTS PASSED SUCCESSFULLY!")




