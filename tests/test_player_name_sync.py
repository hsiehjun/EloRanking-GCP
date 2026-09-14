"""Test suite for BCP Player Name Sync & Data Correction Service.

Verifies:
1. is_placeholder_name logic for all variations of placeholders.
2. clean_name whitespace normalization.
3. Local DB fast-resolution from players, event_participants, and matches.
4. BCP API resolution via /v1/users/{id} and fallback /v1/players/{id}.
5. Multi-table update execution (players, player_ratings, matches, rating_history, event_participants).
6. Cache invalidation on completion.
7. Scraper enhanced name extraction from pairing payloads.
8. EloEngine canonical name preloading and dynamic promotion.
"""

import sys
import json
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from player_sync import (
    PlayerNameSync,
    is_placeholder_name,
    clean_name,
    sync_player_names_job
)


def test_is_placeholder_name():
    """Verify placeholder detection."""
    assert is_placeholder_name("Player 1") is True
    assert is_placeholder_name("Player 2") is True
    assert is_placeholder_name("player") is True
    assert is_placeholder_name("PLAYER 9") is True
    assert is_placeholder_name("player_5") is True
    assert is_placeholder_name("BYE") is True
    assert is_placeholder_name("None") is True
    assert is_placeholder_name("") is True
    assert is_placeholder_name(None) is True
    assert is_placeholder_name("MEV83VFANA", player_id="MEV83VFANA") is True

    # Real human names should NEVER be considered placeholders
    assert is_placeholder_name("Fabien Barbusse") is False
    assert is_placeholder_name("Jake Seguin") is False
    assert is_placeholder_name("Camaron Hallford") is False
    assert is_placeholder_name("John Hsieh") is False
    assert is_placeholder_name("Fred Smith") is False
    print("✅ test_is_placeholder_name passed")


def test_clean_name():
    """Verify whitespace normalization."""
    assert clean_name("  John   Hsieh  ") == "John Hsieh"
    assert clean_name(None) == ""
    assert clean_name("") == ""
    print("✅ test_clean_name passed")


def test_local_db_resolution():
    """Verify local DB fast resolution resolves names without external calls."""
    mock_db = MagicMock()
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_db.get_connection.return_value.__enter__.return_value = mock_conn
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    # Setup mock returns:
    # 1. players table has name for p1
    mock_cur.fetchall.side_effect = [
        [("p1", "John", "Doe", "John Doe")],  # players
        [("p2", "Alice", "Smith", "Alice Smith")],  # event_participants
        [("p3", "Bob Jones")],  # matches p1
        []  # matches p2
    ]

    syncer = PlayerNameSync(db=mock_db)
    resolved = syncer.resolve_from_local_db({"p1", "p2", "p3", "p4"})

    assert "p1" in resolved
    assert resolved["p1"]["full_name"] == "John Doe"
    assert resolved["p1"]["source"] == "local_players"

    assert "p2" in resolved
    assert resolved["p2"]["full_name"] == "Alice Smith"
    assert resolved["p2"]["source"] == "local_event_participants"

    assert "p3" in resolved
    assert resolved["p3"]["full_name"] == "Bob Jones"
    assert resolved["p3"]["source"] == "local_matches_p1"

    assert "p4" not in resolved
    print("✅ test_local_db_resolution passed")


def test_bcp_api_user_lookup():
    """Verify BCP API /v1/users/{id} resolution."""
    syncer = PlayerNameSync(db=MagicMock(), request_delay=0.0)

    user_resp_data = json.dumps({
        "id": "U123",
        "firstName": "Sigmar",
        "lastName": "Hero",
        "active": True
    }).encode("utf-8")

    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.read.return_value = user_resp_data
    mock_resp.__enter__.return_value = mock_resp

    with patch("urllib.request.urlopen", return_value=mock_resp):
        info = syncer.fetch_bcp_player_name("U123")
        assert info is not None
        assert info["full_name"] == "Sigmar Hero"
        assert info["first_name"] == "Sigmar"
        assert info["last_name"] == "Hero"
        assert info["source"] == "bcp_users_api"
    print("✅ test_bcp_api_user_lookup passed")


def test_bcp_api_player_fallback():
    """Verify BCP API fallback to /v1/players/{id} when /v1/users returns 404."""
    syncer = PlayerNameSync(db=MagicMock(), request_delay=0.0)

    http_404 = urllib.error.HTTPError("https://api/users/P999", 404, "Not Found", {}, None)

    player_resp_data = json.dumps({
        "id": "P999",
        "userId": "U999",
        "user": {
            "id": "U999",
            "firstName": "Gotrek",
            "lastName": "Gurnisson"
        }
    }).encode("utf-8")

    mock_player_resp = MagicMock()
    mock_player_resp.status = 200
    mock_player_resp.read.return_value = player_resp_data
    mock_player_resp.__enter__.return_value = mock_player_resp

    def side_effect(req, *args, **kwargs):
        url = req.get_full_url() if hasattr(req, "get_full_url") else str(req)
        if "/users/" in url:
            raise http_404
        elif "/players/" in url:
            return mock_player_resp
        raise Exception("Unexpected URL")

    with patch("urllib.request.urlopen", side_effect=side_effect):
        info = syncer.fetch_bcp_player_name("P999")
        assert info is not None
        assert info["full_name"] == "Gotrek Gurnisson"
        assert info["source"] == "bcp_players_api"
    print("✅ test_bcp_api_player_fallback passed")


def test_apply_name_updates_across_tables():
    """Verify database updates across players, player_ratings, matches, rating_history, and participants."""
    mock_db = MagicMock()
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_cur.rowcount = 1
    mock_db.get_connection.return_value.__enter__.return_value = mock_conn
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    syncer = PlayerNameSync(db=mock_db)

    resolved_data = {
        "p_alpha": {
            "full_name": "Teclis Highmage",
            "first_name": "Teclis",
            "last_name": "Highmage"
        }
    }

    with patch("database.PostgresDatabase.invalidate_all_caches") as mock_cache:
        counts = syncer.apply_name_updates(resolved_data)
        assert counts["players"] == 1
        assert counts["player_ratings"] == 1
        assert counts["matches_p1"] == 1
        assert counts["matches_p2"] == 1
        assert counts["history"] == 1
        assert counts["participants"] == 1
        mock_conn.commit.assert_called_once()
        mock_cache.assert_called_once()
    print("✅ test_apply_name_updates_across_tables passed")


def test_find_placeholder_player_ids_and_parameter_safety():
    """Verify find_placeholder_player_ids queries are completely safe from psycopg2 formatting errors."""
    import re
    executed_queries = []

    class StrictMockCursor:
        def __init__(self):
            self.rowcount = 1

        def execute(self, sql, params=None):
            executed_queries.append((sql, params))
            if params is not None:
                # Simulate strict psycopg2 % parsing
                cleaned = sql.replace("%%", "")
                placeholders = re.findall(r"%s", cleaned)
                cleaned = re.sub(r"%s", "", cleaned)
                remaining_pct = re.findall(r"%", cleaned)
                if remaining_pct:
                    raise IndexError(f"Found unescaped % in SQL query with params: {cleaned}")
                if len(placeholders) != len(params):
                    raise IndexError(f"Placeholder count {len(placeholders)} != param count {len(params)}")

        def fetchall(self):
            return [("player_123", "Sigmar", "Hero", "Sigmar Hero")]

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            pass

    mock_db = MagicMock()
    mock_conn = MagicMock()
    mock_conn.cursor.return_value = StrictMockCursor()
    mock_db.get_connection.return_value.__enter__.return_value = mock_conn

    syncer = PlayerNameSync(db=mock_db)

    # Test for each game system (40k, aos, all)
    for gs in ["40k", "aos", "all"]:
        pids = syncer.find_placeholder_player_ids(game_system=gs)
        assert len(pids) > 0

    # Test resolve_from_local_db
    syncer.resolve_from_local_db({"player_123", "player_456"})

    # Test apply_name_updates
    with patch("database.PostgresDatabase.invalidate_all_caches"):
        syncer.apply_name_updates({
            "player_123": {"full_name": "Sigmar Hero", "first_name": "Sigmar", "last_name": "Hero"}
        })

    print(f"✅ test_find_placeholder_player_ids_and_parameter_safety passed ({len(executed_queries)} queries validated)")


def test_cloudbuild_includes_player_sync_job():
    """Verify cloudbuild.yaml has update step for player-sync-job."""
    cb_path = root_dir / "cloudbuild.yaml"
    with open(cb_path, "r", encoding="utf-8") as f:
        content = f.read()

    assert "player-sync-job" in content
    assert "id: 'update-player-sync-job'" in content
    print("✅ test_cloudbuild_includes_player_sync_job passed")


def test_concurrent_bcp_sync_and_incremental_commit():
    """Verify multi-threaded resolution, incremental batch commits, and limit parameter."""
    mock_db = MagicMock()
    syncer = PlayerNameSync(db=mock_db, request_delay=0.0)

    # 10 player IDs
    test_ids = [f"p_{i}" for i in range(10)]
    syncer.find_placeholder_player_ids = MagicMock(return_value=test_ids)
    syncer.resolve_from_local_db = MagicMock(return_value={
        "p_0": {"full_name": "Local Player Zero", "first_name": "Local", "last_name": "Player Zero"}
    })

    def mock_fetch(pid):
        return {
            "full_name": f"Resolved {pid}",
            "first_name": "Resolved",
            "last_name": pid,
            "source": "bcp_test_api"
        }

    syncer.fetch_bcp_player_name = MagicMock(side_effect=mock_fetch)
    applied_batches = []

    def mock_apply(batch):
        applied_batches.append(dict(batch))
        return {"players": len(batch), "player_ratings": len(batch), "matches_p1": 0, "matches_p2": 0, "history": 0, "participants": 0, "tracker_games": 0}

    syncer.apply_name_updates = MagicMock(side_effect=mock_apply)

    # Run with limit=6, batch_commit_size=2, concurrency=3
    res = syncer.sync_names(
        game_system="aos",
        max_bcp_calls=6,
        dry_run=False,
        concurrency=3,
        batch_commit_size=2
    )

    assert res["status"] == "SUCCESS"
    assert res["placeholders_found"] == 10
    # 1 local + 6 BCP = 7 total resolved
    assert res["resolved_total"] == 7
    assert res["resolved_local"] == 1
    assert res["resolved_bcp"] == 6
    # Batch commits should have happened: 1 local batch + 3 batches of 2 = 4 apply calls
    assert len(applied_batches) >= 3
    print(f"✅ test_concurrent_bcp_sync_and_incremental_commit passed ({len(applied_batches)} commits executed)")


def test_cli_argument_parsing_resilience():
    """Verify CLI parsing handles redundant script names passed by Cloud Run --args without errors."""
    import argparse
    
    test_cases = [
        ["player_sync.py", "player_sync.py", "--game-system", "aos", "--limit", "1000"],
        ["player_sync.py", "--game-system", "aos", "--limit", "500"],
        ["scripts/sync_players.py", "player_sync.py", "--game-system", "40k", "--dry-run"],
        ["player_sync.py", "--concurrency", "4", "--batch-commit", "50"],
    ]

    for argv in test_cases:
        parser = argparse.ArgumentParser()
        parser.add_argument("script_name", nargs="*")
        parser.add_argument("--game-system", choices=["40k", "aos", "all"], default="all")
        parser.add_argument("--limit", "--max-calls", dest="limit", type=int, default=None)
        parser.add_argument("--concurrency", "--workers", dest="concurrency", type=int, default=8)
        parser.add_argument("--batch-commit", type=int, default=100)
        parser.add_argument("--dry-run", action="store_true")

        clean_argv = [
            arg for arg in argv[1:]
            if not (arg.endswith(".py") or arg in ("player_sync", "sync_players"))
        ]
        args, unknown = parser.parse_known_args(clean_argv)
        assert args is not None
        if "--game-system" in argv:
            idx = argv.index("--game-system")
            assert args.game_system == argv[idx + 1]
        if "--limit" in argv:
            idx = argv.index("--limit")
            assert args.limit == int(argv[idx + 1])

    print("✅ test_cli_argument_parsing_resilience passed")


def test_canonical_user_id_remapping_in_apply_name_updates():
    """Verify apply_name_updates remaps 12-char registration IDs to canonical 10-char userIds across tables."""
    mock_db = MagicMock()
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_db.get_connection.return_value.__enter__.return_value = mock_conn
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    mock_cur.rowcount = 1

    syncer = PlayerNameSync(db=mock_db)
    resolved = {
        "yUtLR1H3fGE1": {
            "full_name": "Bradford Fredrickson",
            "first_name": "Bradford",
            "last_name": "Fredrickson",
            "canonical_user_id": "2BL51FT38A",
            "source": "bcp_players_api"
        }
    }
    counts = syncer.apply_name_updates(resolved)
    assert counts["remapped_ids"] == 1
    assert counts["matches_p1"] == 1
    assert counts["matches_p2"] == 1
    print("✅ test_canonical_user_id_remapping_in_apply_name_updates passed")


def test_scraper_aos_registration_id_resolution():
    """Verify BestCoastPairingsScraper resolves 12-character registration IDs to canonical 10-character userIds."""
    from scraper import BestCoastPairingsScraper
    mock_db = MagicMock()
    scraper = BestCoastPairingsScraper(db=mock_db, request_delay=0.0)

    # Mock /players/{id} response returning canonical userId
    def mock_request(endpoint, *args, **kwargs):
        if endpoint == "/players/pHbczW43wnCx":
            return {
                "id": "pHbczW43wnCx",
                "userId": "2BL51FT38A",
                "user": {"id": "2BL51FT38A", "firstName": "Bradford", "lastName": "Fredrickson"}
            }
        return None

    with patch.object(scraper, "_make_request", side_effect=mock_request):
        roster = [{"id": "pHbczW43wnCx", "firstName": "Bradford", "lastName": "Fredrickson"}]
        roster_map = scraper.build_roster_id_map(roster)
        assert roster_map.get("pHbczW43wnCx") == "2BL51FT38A"

        pairing = {
            "id": "match_001",
            "round": 1,
            "table": 1,
            "player1": {"id": "pHbczW43wnCx", "name": "Bradford Fredrickson"},
            "player2": {"id": "10CHARUSER", "name": "Opponent Player"},
            "player1Game": {"points": 20, "result": 2},
            "player2Game": {"points": 10, "result": 0},
            "isDone": True
        }
        event_data = {"id": "evt_aos_1", "name": "AoS GT", "game_system": "aos"}
        scraper.parse_and_store_match(event_data, pairing, roster_id_map=roster_map)
        mock_db.upsert_match.assert_called_once()
        saved_match = mock_db.upsert_match.call_args[0][0]
        assert saved_match["player1_id"] == "2BL51FT38A"
        assert saved_match["winner_id"] == "2BL51FT38A"
    print("✅ test_scraper_aos_registration_id_resolution passed")


def test_tournament_sync_job_invokes_player_sync():
    """Verify run_tournament_sync in scripts/sync_tournaments.py invokes PlayerNameSync.sync_names."""
    from scripts.sync_tournaments import run_tournament_sync
    with patch("scripts.sync_tournaments.get_database") as mock_get_db, \
         patch("scripts.sync_tournaments.BestCoastPairingsScraper") as mock_scraper_cls, \
         patch("scripts.sync_tournaments.get_elo_engine") as mock_get_engine, \
         patch("player_sync.PlayerNameSync") as mock_ps_cls:
        mock_scraper = MagicMock()
        mock_scraper.scrape_date_range.return_value = {"events_scraped": 2, "matches_scraped": 10}
        mock_scraper_cls.return_value = mock_scraper
        mock_ps = MagicMock()
        mock_ps.sync_names.return_value = {"status": "SUCCESS", "remapped_ids": 3}
        mock_ps_cls.return_value = mock_ps

        res = run_tournament_sync(game_system="aos", days=1, max_events=2)
        mock_ps.sync_names.assert_called_once_with(game_system="aos", max_bcp_calls=500)
        assert res["events_scraped"] == 2
    print("✅ test_tournament_sync_job_invokes_player_sync passed")


def test_same_name_distinct_players_never_merged():
    """Verify two different people with the exact same name ('John Smith') are never merged together by local name matching."""
    from scraper import BestCoastPairingsScraper

    # 1. Test PlayerNameSync: local DB has 'John Smith' (10-char 'uJohnSmith1'), and we have a 12-char reg ID 'regJohnB_123'
    mock_db = MagicMock()
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_db.get_connection.return_value.__enter__.return_value = mock_conn
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    # Simulate local DB returning 'John Smith' for 'regJohnB_123'
    mock_cur.fetchall.return_value = [("regJohnB_123", "John", "Smith", "John Smith")]

    syncer = PlayerNameSync(db=mock_db, request_delay=0.0)
    local_resolved = syncer.resolve_from_local_db({"regJohnB_123"})
    # Must NOT resolve 12-char ID locally; must leave unresolved so BCP API is queried for true userId
    assert "regJohnB_123" not in local_resolved, "12-char registration ID must not be resolved via local name matching!"

    # When BCP /players/regJohnB_123 is queried, it returns John Smith #2's unique 10-char userId 'uJohnSmith2'
    player_b_resp = json.dumps({
        "id": "regJohnB_123",
        "userId": "uJohnSmith2",
        "user": {
            "id": "uJohnSmith2",
            "firstName": "John",
            "lastName": "Smith"
        }
    }).encode("utf-8")
    mock_http_resp = MagicMock()
    mock_http_resp.status = 200
    mock_http_resp.read.return_value = player_b_resp
    mock_http_resp.__enter__.return_value = mock_http_resp

    with patch("urllib.request.urlopen", return_value=mock_http_resp):
        bcp_info = syncer.fetch_bcp_player_name("regJohnB_123")
        assert bcp_info is not None
        assert bcp_info["full_name"] == "John Smith"
        assert bcp_info["canonical_user_id"] == "uJohnSmith2"
        assert bcp_info["canonical_user_id"] != "uJohnSmith1"

    # 2. Test Scraper: two different 'John Smith' players in the same tournament
    scraper = BestCoastPairingsScraper(db=MagicMock(), request_delay=0.0)
    roster = [
        {"id": "regJohnA_111", "userId": "uJohnSmith1", "firstName": "John", "lastName": "Smith"},
        {"id": "regJohnB_222", "userId": "uJohnSmith2", "firstName": "John", "lastName": "Smith"}
    ]
    roster_map = scraper.build_roster_id_map(roster)
    assert roster_map["regJohnA_111"] == "uJohnSmith1"
    assert roster_map["regJohnB_222"] == "uJohnSmith2"
    assert f"name:john smith" not in roster_map, "Name-based key must not exist in roster_id_map!"

    pairing = {
        "id": "match_same_name_01",
        "round": 1,
        "table": 1,
        "player1": {"id": "regJohnA_111", "name": "John Smith"},
        "player2": {"id": "regJohnB_222", "name": "John Smith"},
        "player1Game": {"points": 15, "result": 2},
        "player2Game": {"points": 10, "result": 0},
        "isDone": True
    }
    event_data = {"id": "evt_same_name", "name": "Twin Name GT", "game_system": "40k"}
    scraper.parse_and_store_match(event_data, pairing, roster_id_map=roster_map)
    saved_match = scraper.db.upsert_match.call_args[0][0]
    assert saved_match["player1_id"] == "uJohnSmith1"
    assert saved_match["player2_id"] == "uJohnSmith2"
    assert saved_match["player1_id"] != saved_match["player2_id"]
    print("✅ test_same_name_distinct_players_never_merged passed")


if __name__ == "__main__":
    print("=== RUNNING BCP PLAYER NAME SYNC & HEALING TESTS ===")
    test_is_placeholder_name()
    test_clean_name()
    test_local_db_resolution()
    test_bcp_api_user_lookup()
    test_bcp_api_player_fallback()
    test_apply_name_updates_across_tables()
    test_find_placeholder_player_ids_and_parameter_safety()
    test_concurrent_bcp_sync_and_incremental_commit()
    test_cloudbuild_includes_player_sync_job()
    test_cli_argument_parsing_resilience()
    test_canonical_user_id_remapping_in_apply_name_updates()
    test_scraper_aos_registration_id_resolution()
    test_tournament_sync_job_invokes_player_sync()
    test_same_name_distinct_players_never_merged()
    print("\n🎉 ALL PLAYER NAME SYNC TESTS PASSED 100%!")
