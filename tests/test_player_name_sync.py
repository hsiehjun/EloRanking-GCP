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
    print("\n🎉 ALL PLAYER NAME SYNC TESTS PASSED 100%!")
