"""Test suite for Team Tournaments and Doubles Events support in OmniTactica.
Verifies:
1. Scraper TeamPairing fallback and team pairings retrieval.
2. Roster format preserving teamPlayerId, team_player_id, user_id, army_list.
3. api_event_details grouping competitors under teams, captain identification, avg Elo, check-in status.
4. Detection of team events and doubles events.
5. Zero DB writes for live BCP team events.
6. Frontend app.html, tournaments.js, and app.bundle.min.js integrity.
"""
import sys
import os
import json
import asyncio
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from scraper import BestCoastPairingsScraper
from routers.leaderboard import format_bcp_roster_to_players, api_event_details


def test_scraper_team_pairings_fallback():
    """Verify scraper falls back to TeamPairing if standard Pairing is empty, and fetch_event_team_pairings_for_round."""
    scraper = BestCoastPairingsScraper(db=MagicMock(), request_delay=0.0)

    # When Pairing returns empty list, should fallback to TeamPairing
    def mock_make_request(endpoint, params=None):
        params = params or {}
        if endpoint == "/events/ev_team_1/pairings":
            if params.get("pairingType") == "Pairing":
                return {"active": []}
            elif params.get("pairingType") == "TeamPairing":
                return {"active": [{"id": "tp1", "table": 1, "team1": "Team Alpha", "team2": "Team Beta"}]}
        return {}

    with patch.object(scraper, "_make_request", side_effect=mock_make_request):
        pairings = scraper.fetch_event_pairings_for_round("ev_team_1", 1)
        assert len(pairings) == 1
        assert pairings[0]["team1"] == "Team Alpha"

        team_pairings = scraper.fetch_event_team_pairings_for_round("ev_team_1", 1)
        assert len(team_pairings) == 1
        assert team_pairings[0]["team2"] == "Team Beta"

    print("✅ Scraper TeamPairing fallback verified!")


def test_format_bcp_roster_preserves_team_linking_fields():
    """Verify format_bcp_roster_to_players preserves teamPlayerId, team_player_id, user_id, army_list."""
    mock_db = MagicMock()
    mock_cursor = MagicMock()
    mock_db.get_connection.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
    mock_cursor.fetchall.return_value = []

    raw_players = [
        {
            "id": "p_alpha",
            "userId": "u_alpha",
            "teamPlayerId": "team_101",
            "armyList": "2000 pts Space Marines Gladius",
            "user": {"id": "u_alpha", "firstName": "Alice", "lastName": "Smith"},
            "army": {"name": "Space Marines"},
            "checkedIn": True
        },
        {
            "id": "p_beta",
            "userId": "u_beta",
            "team_player_id": "team_101",
            "user": {"id": "u_beta", "firstName": "Bob", "lastName": "Jones"},
            "army": {"name": "Necrons"},
            "checkedIn": False
        }
    ]

    formatted = format_bcp_roster_to_players(raw_players, existing_players=None, db=mock_db)
    assert len(formatted) == 2
    assert formatted[0]["teamPlayerId"] == "team_101"
    assert formatted[0]["team_player_id"] == "team_101"
    assert formatted[0]["user_id"] == "u_alpha"
    assert "Space Marines Gladius" in formatted[0]["army_list"]

    assert formatted[1]["team_player_id"] == "team_101"
    assert formatted[1]["user_id"] == "u_beta"
    print("✅ format_bcp_roster_to_players team linking fields preserved!")


def test_team_tournament_linking_and_captain_assignment():
    """Verify api_event_details groups players by team, identifies captain, computes avg Elo, and performs zero DB writes."""
    mock_db = MagicMock()
    mock_cursor = MagicMock()
    mock_db.get_connection.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor

    # Player ratings mock
    mock_cursor.fetchall.return_value = [
        {"player_id": "u_cap", "player_name": "Captain John", "current_elo": 1800.0, "peak_elo": 1850.0, "top_faction": "Aeldari", "team": "Phoenix"},
        {"player_id": "u_m2", "player_name": "Member Two", "current_elo": 1600.0, "peak_elo": 1620.0, "top_faction": "Tau Empire", "team": "Phoenix"},
        {"player_id": "u_m3", "player_name": "Member Three", "current_elo": 1400.0, "peak_elo": 1450.0, "top_faction": "Tyranids", "team": "Phoenix"},
    ]

    mock_db.get_event_details.return_value = {
        "id": "pAMTczKfdGuc",
        "name": "3-Player Team Warhammer Championship",
        "event_date": "2026-09-20T10:00:00Z",
        "total_players": 0,
        "matches": [],
        "players": [],
        "raw_json": {
            "teamEvent": True,
            "totalTeamPlayers": 1,
            "totalPlayers": 3
        }
    }

    mock_teamplayers = [
        {
            "id": "t_storm",
            "name": "A Storm of Blades",
            "captainId": "u_cap",
            "captain": {"id": "u_cap", "firstName": "Captain", "lastName": "John"},
            "checkedIn": True,
            "placing": 1,
            "battlePoints": 150
        }
    ]

    mock_players = [
        {
            "id": "p_m2",
            "userId": "u_m2",
            "teamPlayerId": "t_storm",
            "user": {"id": "u_m2", "firstName": "Member", "lastName": "Two"},
            "army": {"name": "Tau Empire"},
            "checkedIn": True
        },
        {
            "id": "p_cap",
            "userId": "u_cap",
            "teamPlayerId": "t_storm",
            "user": {"id": "u_cap", "firstName": "Captain", "lastName": "John"},
            "army": {"name": "Aeldari"},
            "checkedIn": True
        },
        {
            "id": "p_m3",
            "userId": "u_m3",
            "teamPlayerId": "t_storm",
            "user": {"id": "u_m3", "firstName": "Member", "lastName": "Three"},
            "army": {"name": "Tyranids"},
            "checkedIn": False
        },
    ]

    with patch("scraper.BestCoastPairingsScraper.fetch_event_players", return_value=mock_players), \
         patch("scraper.BestCoastPairingsScraper.fetch_event_teams", return_value=mock_teamplayers), \
         patch("routers.leaderboard.get_database", return_value=mock_db):
        details = asyncio.run(api_event_details("pAMTczKfdGuc"))

    assert details["is_team_event"] is True
    assert details["is_doubles_event"] is False
    assert details["total_teams"] == 1
    assert "teams" in details
    assert len(details["teams"]) == 1

    team = details["teams"][0]
    assert team["id"] == "t_storm"
    assert team["name"] == "A Storm of Blades"
    assert team["captain_name"] == "Captain John"
    assert team["checked_in"] is True
    assert team["placing"] == 1
    assert team["points"] == 150
    # Average Elo of members: (1800 + 1600 + 1400) / 3 = 1600.0
    assert team["avg_elo"] == 1600.0
    assert len(team["members"]) == 3

    # Captain must be sorted first
    first_member = team["members"][0]
    assert first_member["full_name"] == "Captain John"
    assert first_member["is_captain"] is True
    assert first_member["current_elo"] == 1800.0

    # Non-captains have is_captain False
    assert team["members"][1]["is_captain"] is False
    assert team["members"][2]["is_captain"] is False

    # Ensure zero DB write calls
    assert not mock_db.save_event_participants.called
    assert not mock_db.save_tournament.called
    print("✅ Team tournament linking, captain assignment, and zero DB writes verified!")


def test_doubles_event_detection_and_grouping():
    """Verify Doubles event detection (doublesEvent flag or 2:1 ratio) and pair formatting."""
    mock_db = MagicMock()
    mock_cursor = MagicMock()
    mock_db.get_connection.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
    mock_cursor.fetchall.return_value = []

    mock_db.get_event_details.return_value = {
        "id": "dhfex1f04bEC",
        "name": "Summer Doubles Clash 2026",
        "event_date": "2026-09-25T10:00:00Z",
        "total_players": 0,
        "matches": [],
        "players": [],
        "raw_json": {
            "teamEvent": True,
            "doublesEvent": True,
            "totalTeamPlayers": 2,
            "totalPlayers": 4
        }
    }

    mock_teams = [
        {"id": "pair_1", "name": "Dynamic Duo", "captain": {"id": "u1", "firstName": "Tom", "lastName": "Hardy"}, "checkedIn": True},
        {"id": "pair_2", "name": "Thunder & Lightning", "captain": {"id": "u3", "firstName": "Thor", "lastName": "Odinson"}, "checkedIn": False},
    ]

    mock_players = [
        {"id": "p1", "userId": "u1", "teamPlayerId": "pair_1", "user": {"id": "u1", "firstName": "Tom", "lastName": "Hardy"}, "faction": {"name": "Custodes"}},
        {"id": "p2", "userId": "u2", "teamPlayerId": "pair_1", "user": {"id": "u2", "firstName": "Bruce", "lastName": "Wayne"}, "faction": {"name": "Dark Angels"}},
        {"id": "p3", "userId": "u3", "teamPlayerId": "pair_2", "user": {"id": "u3", "firstName": "Thor", "lastName": "Odinson"}, "faction": {"name": "Space Wolves"}},
        {"id": "p4", "userId": "u4", "teamPlayerId": "pair_2", "user": {"id": "u4", "firstName": "Loki", "lastName": "Laufeyson"}, "faction": {"name": "Thousand Sons"}},
    ]

    with patch("scraper.BestCoastPairingsScraper.fetch_event_players", return_value=mock_players), \
         patch("scraper.BestCoastPairingsScraper.fetch_event_teams", return_value=mock_teams), \
         patch("routers.leaderboard.get_database", return_value=mock_db):
        details = asyncio.run(api_event_details("dhfex1f04bEC"))

    assert details["is_team_event"] is True
    assert details["is_doubles_event"] is True
    assert details["total_teams"] == 2
    assert len(details["teams"]) == 2

    for tm in details["teams"]:
        assert len(tm["members"]) == 2

    assert details["teams"][0]["name"] == "Dynamic Duo"
    assert details["teams"][0]["members"][0]["is_captain"] is True
    print("✅ Doubles event detection and duo pair formatting verified!")


def test_frontend_team_and_doubles_markup_and_bundle():
    """Verify app.html, tournaments.js, and app.bundle.min.js contain team roster card markup and logic."""
    app_html = (ROOT_DIR / "web" / "app.html").read_text(encoding="utf-8")
    tournaments_js = (ROOT_DIR / "web" / "js" / "tournaments.js").read_text(encoding="utf-8")
    bundle_js = (ROOT_DIR / "web" / "js" / "app.bundle.min.js").read_text(encoding="utf-8")

    # 1. app.html checks
    assert 'id="event-subtab-teams-label"' in app_html
    assert 'id="event-teams-container"' in app_html
    assert 'id="event-teams-table-wrap"' in app_html

    # 2. tournaments.js checks
    assert "isDoublesEvent" in tournaments_js
    assert "team-roster-card" in tournaments_js
    assert "👥 Doubles Rosters" in tournaments_js
    assert "🛡️ Team Rosters" in tournaments_js
    assert "Duo Avg Elo" in tournaments_js
    assert "Team Avg Elo" in tournaments_js
    assert "👑 CAPTAIN" in tournaments_js
    assert "Awaiting Check-in" in tournaments_js

    # 3. app.bundle.min.js checks
    assert "team-roster-card" in bundle_js
    assert "Doubles Rosters" in bundle_js or "event-subtab-teams" in bundle_js

    print("✅ Frontend team and doubles markup and bundle integrity verified!")


if __name__ == "__main__":
    test_scraper_team_pairings_fallback()
    test_format_bcp_roster_preserves_team_linking_fields()
    test_team_tournament_linking_and_captain_assignment()
    test_doubles_event_detection_and_grouping()
    test_frontend_team_and_doubles_markup_and_bundle()
    print("\n🎉 ALL TEAM TOURNAMENT AND DOUBLES TESTS PASSED!")
