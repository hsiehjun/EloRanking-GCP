"""Test suite for live BCP roster loading, field avg Elo calculation,
zero DB mutations on live events/registration, ticket price normalization, and unified modal tab.
"""
import sys
import os
import json
import asyncio
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from database import normalize_ticket_price
from routers.community import compute_live_bcp_field_stats
from routers.leaderboard import format_bcp_roster_to_players, api_event_details


def test_ticket_price_normalization():
    """Verify cents-to-dollars normalization across integer and float values."""
    assert normalize_ticket_price(3000) == 30.0
    assert normalize_ticket_price(3500) == 35.0
    assert normalize_ticket_price(2500) == 25.0
    assert normalize_ticket_price("3000") == 30.0
    assert normalize_ticket_price("3500") == 35.0
    assert normalize_ticket_price(30.0) == 30.0
    assert normalize_ticket_price(35.0) == 35.0
    assert normalize_ticket_price(0) == 0.0
    assert normalize_ticket_price(None) == 0.0
    assert normalize_ticket_price("invalid") == 0.0
    print("✅ Ticket price normalization verified!")


def test_live_roster_field_stats_zero_db_writes():
    """Verify live field stats computation from BCP roster and read-only ratings with zero DB mutations."""
    mock_db = MagicMock()
    mock_cursor = MagicMock()
    mock_db.get_connection.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor

    # Mock player_ratings query in DB
    mock_cursor.fetchall.return_value = [
        {"player_id": "u1", "player_name": "Alice Smith", "current_elo": 1820.5},
        {"player_id": "u2", "player_name": "Bob Jones", "current_elo": 1640.0}
    ]

    sample_roster = [
        {
            "id": "p1",
            "userId": "u1",
            "user": {"id": "u1", "firstName": "Alice", "lastName": "Smith"},
            "faction": {"name": "Aeldari"}
        },
        {
            "id": "p2",
            "userId": "u2",
            "user": {"id": "u2", "firstName": "Bob", "lastName": "Jones"},
            "faction": {"name": "Orks"}
        },
        {
            "id": "p3",
            "userId": "u3_unrated",
            "user": {"id": "u3_unrated", "firstName": "Charlie", "lastName": "Brown"},
            "faction": {"name": "Necrons"}
        }
    ]

    with patch("scraper.BestCoastPairingsScraper.fetch_event_players", return_value=sample_roster):
        stats = compute_live_bcp_field_stats("ev_live_123", mock_db)

    assert stats["event_id"] == "ev_live_123"
    assert stats["total_enrolled"] == 3
    assert stats["rated_players_count"] == 2
    # Elos: 1820.5, 1640.0, 1500.0 -> sum = 4960.5 / 3 = 1653.5
    assert stats["avg_field_elo"] == 1653.5
    assert stats["top_seed_elo"] == 1820.5

    # CRITICAL: Verify NO database write operations were executed
    assert not mock_db.save_event_participants.called
    assert not mock_db.add_user_registered_tournament.called
    assert not mock_db.save_tournament.called
    print("✅ Live field stats computation with zero DB writes verified!")


def test_format_bcp_roster_unstarted_event_seeding():
    """Verify that unstarted/ongoing events without placings assign seeds by Elo and leave placement as None."""
    mock_db = MagicMock()
    mock_cursor = MagicMock()
    mock_db.get_connection.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor

    mock_cursor.fetchall.return_value = [
        {"player_id": "u_high", "player_name": "High Elo", "current_elo": 1950.0, "peak_elo": 1980.0, "top_faction": "Space Marines", "team": "Team A"},
        {"player_id": "u_mid", "player_name": "Mid Elo", "current_elo": 1700.0, "peak_elo": 1720.0, "top_faction": "Tyranids", "team": "Team B"}
    ]

    raw_roster = [
        # Note: no placings or rank keys in raw competitors
        {"user": {"id": "u_mid", "firstName": "Mid", "lastName": "Elo"}, "checkedIn": True},
        {"user": {"id": "u_high", "firstName": "High", "lastName": "Elo"}, "checkedIn": True},
        {"user": {"id": "u_unrated", "firstName": "New", "lastName": "Player"}, "checkedIn": False}
    ]

    formatted = format_bcp_roster_to_players(raw_roster, existing_players=None, db=mock_db)

    assert len(formatted) == 3
    # Sorted by Elo descending
    assert formatted[0]["full_name"] == "High Elo"
    assert formatted[0]["rank"] == 1
    assert formatted[0]["placement"] is None
    assert formatted[0]["official_placement"] is None
    assert formatted[0]["current_elo"] == 1950.0

    assert formatted[1]["full_name"] == "Mid Elo"
    assert formatted[1]["rank"] == 2
    assert formatted[1]["placement"] is None
    assert formatted[1]["current_elo"] == 1700.0

    assert formatted[2]["full_name"] == "New Player"
    assert formatted[2]["rank"] == 3
    assert formatted[2]["placement"] is None
    assert formatted[2]["current_elo"] == 1500.0
    print("✅ format_bcp_roster_to_players unstarted event seeding verified!")


def test_api_event_details_live_bcp_roster():
    """Verify api_event_details fetches live roster from BCP API and computes stats without DB writes."""
    mock_db = MagicMock()
    mock_cursor = MagicMock()
    mock_db.get_connection.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
    mock_cursor.fetchall.return_value = []

    mock_db.get_event_details.return_value = {
        "id": "ev_live_bcp",
        "name": "Second City Games 40k RTT",
        "event_date": "2026-09-12T10:00:00Z",
        "total_players": 0,
        "matches": [],
        "players": []
    }

    live_bcp_players = [
        {"user": {"id": "p_1", "firstName": "Sarah", "lastName": "Connor"}, "checkedIn": True},
        {"user": {"id": "p_2", "firstName": "John", "lastName": "Connor"}, "checkedIn": False}
    ]

    with patch("scraper.BestCoastPairingsScraper.fetch_event_players", return_value=live_bcp_players), \
         patch("routers.leaderboard.get_database", return_value=mock_db):
        details = asyncio.run(api_event_details("ev_live_bcp"))

    assert details["id"] == "ev_live_bcp"
    assert details["total_players"] == 2
    assert len(details["players"]) == 2
    assert details["avg_field_elo"] == 1500.0
    assert details["top_seed_elo"] == 1500.0

    # Ensure zero DB write calls
    assert not mock_db.save_event_participants.called
    assert not mock_db.save_tournament.called
    print("✅ api_event_details live BCP roster integration verified!")


def test_unified_frontend_modal_tab():
    """Verify app.html and tournaments.js unified Standings & Competitors tab configuration."""
    app_html = (ROOT_DIR / "web" / "app.html").read_text(encoding="utf-8")
    tournaments_js = (ROOT_DIR / "web" / "js" / "tournaments.js").read_text(encoding="utf-8")
    bundle_js = (ROOT_DIR / "web" / "js" / "app.bundle.min.js").read_text(encoding="utf-8")

    # 1. Verify unified tab in app.html
    assert '<span>🏆 Standings & Competitors</span>' in app_html
    assert 'id="event-subtab-elo" class="subtab-btn" onclick="switchEventModalTab(\'elo\')" style="display: none;"' in app_html

    # 2. Verify tournaments.js handles both unstarted and started rows
    assert "renderEventResultsRows" in tournaments_js
    assert "switchEventModalTab" in tournaments_js
    assert "#${p.rank || (idx + 1)} Seed" in tournaments_js
    assert "✅ Checked In" in tournaments_js
    assert "📋 Enrolled" in tournaments_js

    # 3. Verify app.bundle.min.js is updated
    assert "Standings & Competitors" in bundle_js

    print("✅ Unified frontend modal tab verified!")


if __name__ == "__main__":
    test_ticket_price_normalization()
    test_live_roster_field_stats_zero_db_writes()
    test_format_bcp_roster_unstarted_event_seeding()
    test_api_event_details_live_bcp_roster()
    test_unified_frontend_modal_tab()
    print("\n🎉 ALL LIVE ROSTER, FIELD AVG, ZERO-DB-MUTATION, AND UNIFIED TAB TESTS PASSED!")
