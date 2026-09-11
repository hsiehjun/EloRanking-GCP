"""Test suite for Phase 1 of OmniTactica Multi-Game Expansion (Warhammer 40k & Age of Sigmar).
Verifies:
1. Config constants: game systems, BCP IDs, and backward-compatible defaults.
2. Database DDL: additive schema columns, composite PK (player_id, game_system), indexes.
3. Database Query Parameterization: all queries default to '40k' with strict data isolation for 'aos'.
4. Leaderboard & Stats Router: every endpoint defaults to '40k' with optional game_system query param.
5. Event Studio: AoS tournament creation correctly sets game_system='aos' and game_system_id='23qDprPABN'.
6. Frontend files: AoS option unlocked in eventstudio.html & app.html, onGameSystemChange handler present.
"""
import inspect
import json
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

import config
import database
from database import PostgresDatabase
from scraper import BestCoastPairingsScraper
from routers import leaderboard, eventstudio
from routers.eventstudio import CreateEventPayload, api_eventstudio_create_event


def test_config_game_systems():
    """Verify config constants and game system identifiers."""
    assert config.GAME_SYSTEMS["warhammer_40k"] == "WGMSzfKFYA"
    assert config.GAME_SYSTEMS["warhammer_aos"] in ("OY8FCPBf6O", "23qDprPABN")
    assert config.DEFAULT_GAME_SYSTEM_ID == "WGMSzfKFYA"
    assert config.AOS_GAME_SYSTEM_ID in ("OY8FCPBf6O", "23qDprPABN")
    assert config.DEFAULT_GAME_SYSTEM == "40k"
    assert "40k" in config.SUPPORTED_GAME_SYSTEMS
    assert "aos" in config.SUPPORTED_GAME_SYSTEMS
    assert config.ENABLE_AOS is True
    print("✅ test_config_game_systems passed")


def test_database_schema_ddl_and_indexes():
    """Verify that PostgresDatabase schema initialization contains game_system columns and composite PK."""
    with open(ROOT_DIR / "database.py", "r", encoding="utf-8") as f:
        db_src = f.read()

    # Verify additive columns on tables
    assert "ALTER TABLE events ADD COLUMN IF NOT EXISTS game_system VARCHAR(16) DEFAULT '40k';" in db_src
    assert "ALTER TABLE matches ADD COLUMN IF NOT EXISTS game_system VARCHAR(16) DEFAULT '40k';" in db_src
    assert "ALTER TABLE rating_history ADD COLUMN IF NOT EXISTS game_system VARCHAR(16) DEFAULT '40k';" in db_src
    assert "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS game_system VARCHAR(16) DEFAULT '40k';" in db_src
    assert "ALTER TABLE player_ratings ADD COLUMN IF NOT EXISTS game_system VARCHAR(16) DEFAULT '40k';" in db_src

    # Verify composite primary key logic
    assert "ALTER TABLE player_ratings ADD CONSTRAINT player_ratings_pk_composite PRIMARY KEY (player_id, game_system);" in db_src

    # Verify performance indexes
    assert "idx_pg_ratings_system_elo" in db_src
    assert "idx_pg_matches_system_chrono" in db_src
    assert "idx_pg_events_system_date" in db_src

    print("✅ test_database_schema_ddl_and_indexes passed")


def test_database_methods_parameterization_defaults():
    """Verify that DB querying methods accept game_system with '40k' default."""
    db = PostgresDatabase.__new__(PostgresDatabase)

    # Inspect function signatures
    methods_to_check = [
        ("get_top_ranked_players", "game_system", "40k"),
        ("get_players_directory", "game_system", "40k"),
        ("get_events_list", "game_system", "40k"),
        ("get_summary_stats", "game_system", "40k"),
        ("get_teams_leaderboard", "game_system", "40k"),
        ("get_team_roster", "game_system", "40k"),
        ("get_head_to_head", "game_system", "40k"),
        ("get_faction_meta_stats", "game_system", "40k"),
        ("get_faction_details", "game_system", "40k"),
        ("get_all_matches_chronological", "game_system", "40k"),
        ("get_player_history", "game_system", "40k"),
        ("get_player_matches", "game_system", "40k"),
        ("search_players", "game_system", "40k"),
    ]

    for meth_name, param_name, default_val in methods_to_check:
        assert hasattr(db, meth_name), f"PostgresDatabase missing method {meth_name}"
        sig = inspect.signature(getattr(db, meth_name))
        assert param_name in sig.parameters, f"{meth_name} missing {param_name} parameter"
        assert sig.parameters[param_name].default == default_val, f"{meth_name} default {param_name} is not {default_val}"

    print("✅ test_database_methods_parameterization_defaults passed")


def test_database_queries_filter_game_system():
    """Verify that DB queries execute with game_system filtering."""
    db = PostgresDatabase.__new__(PostgresDatabase)
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
    mock_cursor.fetchall.return_value = []
    mock_cursor.fetchone.return_value = {"total_count": 0}

    with patch.object(db, "get_connection") as mock_get_conn:
        mock_get_conn.return_value.__enter__.return_value = mock_conn

        # Test get_top_ranked_players with default 40k
        db.get_top_ranked_players(limit=10)
        call_args = mock_cursor.execute.call_args
        sql, params = call_args[0]
        assert ("game_system" in sql and "= %s" in sql)
        assert "40k" in params

        # Test get_top_ranked_players with explicit aos
        db.get_top_ranked_players(limit=10, game_system="aos")
        call_args = mock_cursor.execute.call_args
        sql, params = call_args[0]
        assert ("game_system" in sql and "= %s" in sql)
        assert "aos" in params

        # Test get_team_roster with aos
        db.get_team_roster("Art of War", game_system="aos")
        call_args = mock_cursor.execute.call_args
        sql, params = call_args[0]
        assert ("game_system" in sql and "= %s" in sql)
        assert "aos" in params

    print("✅ test_database_queries_filter_game_system passed")


def test_save_studio_event_persists_game_system():
    """Verify save_studio_event persists game_system and game_system_id into events table."""
    db = PostgresDatabase.__new__(PostgresDatabase)
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
    mock_cursor.fetchone.return_value = None

    with patch.object(db, "get_connection") as mock_get_conn, \
         patch.object(db, "get_studio_event", return_value={"id": "ES-TEST-1", "name": "AoS Open"}):
        mock_get_conn.return_value.__enter__.return_value = mock_conn

        # Save an AoS event
        event_data_aos = {
            "id": "ES-TEST-AOS",
            "name": "Sigmar Open 2026",
            "game_system_id": "23qDprPABN",
            "game_system": "aos",
            "tier": "Grand Tournament"
        }
        db.save_studio_event(event_data_aos)

        call_args = mock_cursor.execute.call_args
        sql, params = call_args[0]
        assert "game_system" in sql
        assert "game_system_id" in sql
        assert "aos" in params
        assert "23qDprPABN" in params

        # Save a 40k event
        event_data_40k = {
            "id": "ES-TEST-40K",
            "name": "Warhammer 40k Open 2026",
            "game_system_id": "WGMSzfKFYA",
            "tier": "Grand Tournament"
        }
        db.save_studio_event(event_data_40k)

        call_args = mock_cursor.execute.call_args
        sql, params = call_args[0]
        assert "40k" in params
        assert "WGMSzfKFYA" in params

    print("✅ test_save_studio_event_persists_game_system passed")


def test_leaderboard_router_parameterization_defaults():
    """Verify leaderboard router endpoints have default game_system='40k'."""
    routes_to_verify = [
        (leaderboard.api_stats, "40k"),
        (leaderboard.api_leaderboard, "40k"),
        (leaderboard.api_teams, "40k"),
        (leaderboard.api_team_roster, "40k"),
        (leaderboard.api_players_directory, "40k"),
        (leaderboard.api_players_search, "40k"),
        (leaderboard.api_player_profile, "40k"),
        (leaderboard.api_events, "40k"),
        (leaderboard.api_events_recommended, "40k"),
        (leaderboard.api_factions, "40k"),
        (leaderboard.api_faction_meta, "40k"),
        (leaderboard.api_faction_details, "40k"),
        (leaderboard.api_head_to_head, "40k"),
    ]

    for handler, expected_default in routes_to_verify:
        sig = inspect.signature(handler)
        assert "game_system" in sig.parameters, f"{handler.__name__} missing game_system parameter"
        param = sig.parameters["game_system"]
        default_val = param.default.default if hasattr(param.default, "default") else param.default
        assert default_val == expected_default, f"{handler.__name__} default game_system is {default_val}, expected {expected_default}"

    print("✅ test_leaderboard_router_parameterization_defaults passed")


def test_eventstudio_create_event_aos_support():
    """Verify Event Studio creation endpoint accepts AoS game system ID and tags event properly."""
    mock_db = MagicMock()
    mock_request = MagicMock()
    mock_request.headers = {}
    mock_request.cookies = {}

    to_session = {
        "id": "user_to_1",
        "role": "to",
        "is_to": True,
        "is_admin": False,
        "bcp_token": "mock_tok"
    }

    mock_auth = MagicMock()
    mock_auth.get_session.return_value = to_session

    with patch("routers.eventstudio.get_database", return_value=mock_db), \
         patch("routers.eventstudio.get_auth_manager", return_value=mock_auth), \
         patch("routers.eventstudio._get_to_session_or_403", return_value=to_session), \
         patch("routers.eventstudio.execute_bcp_api_call", return_value=({"id": "bcp_aos_123"}, None)):

        import asyncio

        # Create AoS event
        payload_aos = CreateEventPayload(
            name="AoS San Diego GT 2026",
            game_system_id="23qDprPABN",
            venue="SD Tabletop Gaming",
            rounds=5,
            points=2000
        )

        res = asyncio.run(api_eventstudio_create_event(payload_aos, mock_request))
        assert res["success"] is True
        assert res["event_id"] == "bcp_aos_123"

        # Verify fallback local event dict tags
        assert res["event"]["game_system_id"] == "23qDprPABN"
        assert res["event"]["game_system"] == "aos"

        # Create standard 40k event
        payload_40k = CreateEventPayload(
            name="40k Pacific GT 2026",
            venue="SD Tabletop Gaming",
            rounds=5,
            points=2000
        )
        res_40k = asyncio.run(api_eventstudio_create_event(payload_40k, mock_request))
        assert res_40k["success"] is True
        assert res_40k["event"]["game_system"] == "40k"
        assert res_40k["event"]["game_system_id"] == "WGMSzfKFYA"

    print("✅ test_eventstudio_create_event_aos_support passed")


def test_frontend_eventstudio_aos_unlocked():
    """Verify frontend HTML files unlock Age of Sigmar in game-system dropdown and define onGameSystemChange."""
    with open(ROOT_DIR / "web" / "eventstudio.html", "r", encoding="utf-8") as f:
        es_html = f.read()
    with open(ROOT_DIR / "web" / "app.html", "r", encoding="utf-8") as f:
        app_html = f.read()
    with open(ROOT_DIR / "web" / "js" / "eventstudio.js", "r", encoding="utf-8") as f:
        es_js = f.read()
    with open(ROOT_DIR / "web" / "js" / "app.bundle.min.js", "r", encoding="utf-8") as f:
        bundle_js = f.read()

    # Verify AoS is selectable and not disabled
    assert ('<option value="OY8FCPBf6O">Warhammer: Age of Sigmar</option>' in es_html or '<option value="23qDprPABN">Warhammer: Age of Sigmar</option>' in es_html)
    assert 'disabled' not in es_html or ('value="OY8FCPBf6O" disabled' not in es_html and 'value="23qDprPABN" disabled' not in es_html)
    assert ('<option value="OY8FCPBf6O">Warhammer: Age of Sigmar</option>' in app_html or '<option value="23qDprPABN">Warhammer: Age of Sigmar</option>' in app_html)

    # Verify onGameSystemChange logic
    assert "onGameSystemChange" in es_js
    assert "window.onGameSystemChange = onGameSystemChange" in es_js
    assert "onGameSystemChange" in bundle_js
    assert "window.onGameSystemChange=onGameSystemChange" in bundle_js

    print("✅ test_frontend_eventstudio_aos_unlocked passed")


def test_database_upsert_event_multigame_support():
    """Verify upsert_event properly sets game_system based on game_system_id."""
    db = PostgresDatabase.__new__(PostgresDatabase)
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

    with patch.object(db, "get_connection") as mock_get_conn:
        mock_get_conn.return_value.__enter__.return_value = mock_conn

        # 1. AoS tournament
        ev_aos = {
            "id": "ev_aos_999",
            "name": "Sigmar Open 2026",
            "gameSystemId": config.AOS_GAME_SYSTEM_ID,
            "eventDate": "2026-09-09T00:00:00.000Z",
            "location": {"city": "Austin", "state": "TX"}
        }
        db.upsert_event(ev_aos)
        call_args = mock_cursor.execute.call_args
        sql, params = call_args[0]
        assert "game_system" in sql
        assert "aos" in params
        assert config.AOS_GAME_SYSTEM_ID in params

        # 2. 40k tournament
        ev_40k = {
            "id": "ev_40k_999",
            "name": "Warhammer 40k Grand Tournament",
            "gameSystemId": config.DEFAULT_GAME_SYSTEM_ID,
            "eventDate": "2026-09-09T00:00:00.000Z",
            "location": {"city": "San Diego", "state": "CA"}
        }
        db.upsert_event(ev_40k)
        call_args = mock_cursor.execute.call_args
        sql, params = call_args[0]
        assert "40k" in params
        assert config.DEFAULT_GAME_SYSTEM_ID in params

    print("✅ test_database_upsert_event_multigame_support passed")


def test_scraper_multigame_support():
    """Verify BCP scraper parses and stores matches with correct game_system isolation."""
    mock_db = MagicMock()
    scraper = BestCoastPairingsScraper(db=mock_db, request_delay=0.0)

    # 1. AoS match parsing
    aos_event = {
        "id": "ev_aos_1",
        "name": "AoS Championship",
        "gameSystemId": config.AOS_GAME_SYSTEM_ID,
        "eventDate": "2026-09-09"
    }
    aos_pairing = {
        "id": "pair_aos_1",
        "round": 1,
        "table": 1,
        "player1Id": "p1_aos",
        "player2Id": "p2_aos",
        "player1": {"id": "p1_aos", "name": "AoS Player 1", "faction": "Stormcast Eternals"},
        "player2": {"id": "p2_aos", "name": "AoS Player 2", "faction": "Skaven"},
        "player1Game": {"points": 85, "result": 2},
        "player2Game": {"points": 60, "result": 0},
        "isDone": True
    }

    match_record = scraper.parse_and_store_match(aos_event, aos_pairing)
    assert match_record is not None
    assert match_record["game_system"] == "aos"
    assert match_record["game_system_id"] == config.AOS_GAME_SYSTEM_ID
    mock_db.upsert_match.assert_called_with(match_record)

    # 2. 40k match parsing
    k40_event = {
        "id": "ev_40k_1",
        "name": "40k Open",
        "gameSystemId": config.DEFAULT_GAME_SYSTEM_ID,
        "eventDate": "2026-09-09"
    }
    k40_pairing = {
        "id": "pair_40k_1",
        "round": 1,
        "table": 1,
        "player1Id": "p1_40k",
        "player2Id": "p2_40k",
        "player1": {"id": "p1_40k", "name": "40k Player 1", "faction": "Space Marines"},
        "player2": {"id": "p2_40k", "name": "40k Player 2", "faction": "Aeldari"},
        "player1Game": {"points": 90, "result": 2},
        "player2Game": {"points": 70, "result": 0},
        "isDone": True
    }

    match_record_40k = scraper.parse_and_store_match(k40_event, k40_pairing)
    assert match_record_40k is not None
    assert match_record_40k["game_system"] == "40k"
    assert match_record_40k["game_system_id"] == config.DEFAULT_GAME_SYSTEM_ID

    # 3. Method signatures and parameterization
    sig_scrape_range = inspect.signature(scraper.scrape_date_range)
    assert "game_system_id" in sig_scrape_range.parameters
    assert sig_scrape_range.parameters["game_system_id"].default == config.DEFAULT_GAME_SYSTEM_ID

    sig_sync_upcoming = inspect.signature(scraper.sync_upcoming_events)
    assert "game_system_id" in sig_sync_upcoming.parameters
    assert sig_sync_upcoming.parameters["game_system_id"].default == config.DEFAULT_GAME_SYSTEM_ID

    print("✅ test_scraper_multigame_support passed")


if __name__ == "__main__":
    print("=== RUNNING MULTI-GAME PHASE 1 COMPATIBILITY & ISOLATION TESTS ===")
    test_config_game_systems()
    test_database_schema_ddl_and_indexes()
    test_database_methods_parameterization_defaults()
    test_database_queries_filter_game_system()
    test_save_studio_event_persists_game_system()
    test_leaderboard_router_parameterization_defaults()
    test_eventstudio_create_event_aos_support()
    test_frontend_eventstudio_aos_unlocked()
    test_database_upsert_event_multigame_support()
    test_scraper_multigame_support()
    print("\n🎉 ALL PHASE 1 MULTI-GAME COMPATIBILITY TESTS PASSED 100%!")
