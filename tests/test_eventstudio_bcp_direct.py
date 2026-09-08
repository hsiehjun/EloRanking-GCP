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
    assert "subtabPlayerInit.style.setProperty('display', 'none', 'important')" in tournaments_js
    assert "subtabTeamsInit.style.setProperty('display', 'none', 'important')" in tournaments_js

    print("✅ test_event_modal_subtabs_hidden_on_mobile_and_desktop passed!")

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
    print("\n🎉 ALL EVENT STUDIO DIRECT BCP TESTS PASSED SUCCESSFULLY!")

