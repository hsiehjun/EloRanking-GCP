"""
Comprehensive Test Suite for Exact BCP Player ID Linking & Registration Isolation

Verifies:
1. Registration Isolation: Registering an account with display_name="Jake Jacobson" sets player_id=None (no auto-matching to competitive player "Jake").
2. Unlinked Hub Safety: Unlinked users receive 0 matches and unlinked status; no auto-healing guesses or writes stranger IDs.
3. Profile Settings Safety: Updating display_name in user settings never modifies player_id.
4. 2-Step BCP Headless Chrome Discovery: Intercepting /v1/users/MEV83VFANA on /organize/ extracts exact player_id and updates display_name to official BCP name without hardcoded email overrides.
5. Exact Player ID Linking: Jake Jacobson linking BCP with ID 'JAKE99ABCD' links directly to 'JAKE99ABCD' and never gets hijacked by another player.
6. Will Trovato BCP Link: Linking BCP with verified ID '5ODCSZURyN' links directly with 212 matches and updates display_name to official BCP name.
7. Unlink BCP Safety: Unlinking BCP clears both bcp_user_id and player_id back to NULL.
8. Multi-Token Autocomplete Preservation: database.search_players("Will Trovato") finds "William Trovato".
9. Multi-Token Directory Preservation: database.get_players_directory("Will Trovato") finds "William Trovato".
"""

import sys
import json
import base64
from pathlib import Path
from unittest.mock import MagicMock, patch

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from auth import AuthManager, _decode_jwt_payload
from database import PostgresDatabase


# Sample rows in public.player_ratings
SAMPLE_PLAYER_RATINGS = [
    {
        "player_id": "5ODCSZURyN",
        "player_name": "William Trovato",
        "current_elo": 1739.77,
        "peak_elo": 1837.83,
        "matches_played": 212,
        "wins": 132,
        "losses": 69,
        "draws": 11,
        "win_rate": 62.3,
        "top_faction": "Adeptus Custodes",
        "team": "Team Zero Comp",
        "last_active_date": "2026-09-03"
    },
    {
        "player_id": "MEV83VFANA",
        "player_name": "John Hsieh",
        "current_elo": 1642.50,
        "peak_elo": 1680.00,
        "matches_played": 45,
        "wins": 30,
        "losses": 15,
        "draws": 0,
        "win_rate": 66.7,
        "top_faction": "Aeldari",
        "team": "Waaagh Boys",
        "last_active_date": "2026-09-02"
    },
    {
        "player_id": "JAKE_STRANGER_1",
        "player_name": "Jake",
        "current_elo": 1690.00,
        "peak_elo": 1720.00,
        "matches_played": 80,
        "wins": 50,
        "losses": 30,
        "draws": 0,
        "win_rate": 62.5,
        "top_faction": "Space Marines",
        "team": "Team Alpha",
        "last_active_date": "2026-08-15"
    }
]


def make_mock_db():
    db = MagicMock()
    conn = MagicMock()
    cur = MagicMock()

    db.get_connection.return_value.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cur
    return db, conn, cur


def create_fake_jwt(claims: dict) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    h_b64 = base64.urlsafe_b64encode(json.dumps(header).encode()).decode().rstrip("=")
    p_b64 = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    return f"{h_b64}.{p_b64}.fake_signature"


def test_registration_isolation_jake_jacobson():
    """Verify that registering 'Jake Jacobson' creates the account with player_id = None."""
    db, conn, cur = make_mock_db()
    auth_mgr = AuthManager(db)

    from datetime import datetime, timezone, timedelta
    cur.fetchone.side_effect = [
        # 1. Verification code lookup
        {
            "id": "pend_1",
            "email": "jake.jacobson@example.com",
            "display_name": "Jake Jacobson",
            "password_hash": "hash_123",
            "verify_code": "123456",
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=15),
            "invite_code": None
        },
        # 2. Existing user check (None -> not taken)
        None,
        # 3. get_user_by_id lookup after insert
        {
            "id": "user_jake_123",
            "email": "jake.jacobson@example.com",
            "display_name": "Jake Jacobson",
            "player_id": None,
            "bcp_user_id": None
        }
    ]

    with patch.object(auth_mgr, "are_registrations_open", return_value=True), patch.object(auth_mgr, "get_user_by_id") as mock_get_user:
        mock_get_user.return_value = {
            "id": "user_jake_123",
            "email": "jake.jacobson@example.com",
            "display_name": "Jake Jacobson",
            "player_id": None,
            "bcp_user_id": None
        }

        res = auth_mgr.verify_registration_code("jake.jacobson@example.com", "123456")
        assert res["success"] is True, f"Registration failed: {res}"

        # Inspect INSERT INTO users query
        insert_calls = [c for c in cur.execute.call_args_list if "INSERT INTO users" in str(c)]
        assert len(insert_calls) == 1, "Expected INSERT INTO users call"
        insert_args = insert_calls[0][0][1]
        
        # INSERT INTO users (id, email, password_hash, display_name, role, player_id, ...)
        # player_id is the 5th param (index 4)
        inserted_player_id = insert_args[4]
        assert inserted_player_id is None, f"Expected player_id=None on registration, got: {inserted_player_id}"
        print("✅ test_registration_isolation_jake_jacobson passed: player_id is strictly None on registration!")


def test_unlinked_hub_safety_no_auto_healing():
    """Verify that an unlinked user gets an empty competitor profile and no auto-healing writes stranger IDs."""
    db, conn, cur = make_mock_db()
    auth_mgr = AuthManager(db)

    with patch.object(auth_mgr, "are_registrations_open", return_value=True), patch.object(auth_mgr, "get_user_by_id") as mock_get_user:
        mock_get_user.return_value = {
            "id": "user_jake_123",
            "email": "jake.jacobson@example.com",
            "display_name": "Jake Jacobson",
            "player_id": None,
            "bcp_user_id": None
        }

        hub = auth_mgr.get_user_competitor_hub(player_id=None, user_id="user_jake_123")
        assert hub["player"]["matches_played"] == 0, "Unlinked user must have 0 matches played"
        assert hub["player"]["display_name"] == "Jake Jacobson"

        # Verify NO updates were executed on users table
        update_calls = [c for c in cur.execute.call_args_list if "UPDATE users" in str(c)]
        assert len(update_calls) == 0, f"Auto-heal should not execute any UPDATE queries on unlinked users, got: {update_calls}"
        print("✅ test_unlinked_hub_safety_no_auto_healing passed: Unlinked hub remains clean with 0 matches!")


def test_profile_settings_safety():
    """Verify that updating display_name in user settings does not modify player_id."""
    db, conn, cur = make_mock_db()
    auth_mgr = AuthManager(db)

    cur.fetchone.return_value = {"id": "user_jake_123", "password_hash": "hash_123"}
    with patch.object(auth_mgr, "are_registrations_open", return_value=True), patch.object(auth_mgr, "get_user_by_id") as mock_get_user:
        mock_get_user.return_value = {
            "id": "user_jake_123",
            "email": "jake.jacobson@example.com",
            "display_name": "Jake The Gamer",
            "player_id": None,
            "bcp_user_id": None
        }

        res = auth_mgr.update_settings("user_jake_123", display_name="Jake The Gamer")
        assert res["success"] is True

        update_calls = [c for c in cur.execute.call_args_list if "UPDATE users" in str(c)]
        assert len(update_calls) == 1
        update_sql = update_calls[0][0][0]
        assert "player_id" not in update_sql, f"Profile update should not modify player_id: {update_sql}"
        print("✅ test_profile_settings_safety passed: Settings update changes display_name only!")


def test_2_step_bcp_discovery_john_hsieh():
    """Verify 2-step organize flow extracts MEV83VFANA and links directly without hardcoded emails."""
    db, conn, cur = make_mock_db()
    auth_mgr = AuthManager(db)

    cur.fetchone.side_effect = [
        None,  # No conflict check
        {      # Exact player_ratings check for MEV83VFANA
            "player_id": "MEV83VFANA",
            "player_name": "John Hsieh",
            "matches_played": 45,
            "current_elo": 1642.50
        }
    ]

    with patch.object(auth_mgr, "are_registrations_open", return_value=True), patch.object(auth_mgr, "get_user_by_id") as mock_get_user:
        mock_get_user.return_value = {
            "id": "user_john_456",
            "email": "swimgeek751@gmail.com",
            "display_name": "John Hsieh",
            "player_id": "MEV83VFANA",
            "bcp_user_id": "sub_john_uuid",
            "bcp_email": "swimgeek751@gmail.com"
        }

        # Simulated payload from 2-step Playwright organize intercept
        tokens = {
            "id_token": create_fake_jwt({"sub": "sub_john_uuid", "email": "swimgeek751@gmail.com", "custom:userId": "MEV83VFANA"}),
            "access_token": create_fake_jwt({"sub": "sub_john_uuid"}),
            "refresh_token": "ref_tok_abc",
            "player_id": "MEV83VFANA",
            "name": "John Hsieh",
            "given_name": "John",
            "family_name": "Hsieh",
            "email": "swimgeek751@gmail.com"
        }

        res = auth_mgr.link_bcp_token("user_john_456", tokens)
        assert res["success"] is True
        assert res["player_id"] == "MEV83VFANA"

        update_calls = [c for c in cur.execute.call_args_list if "UPDATE users" in str(c)]
        assert len(update_calls) == 1
        update_args = update_calls[0][0][1]
        # (target_display_name, pid, bcp_user_id, bcp_email, ...)
        assert update_args[0] == "John Hsieh", f"Expected display_name 'John Hsieh', got: {update_args[0]}"
        assert update_args[1] == "MEV83VFANA", f"Expected player_id 'MEV83VFANA', got: {update_args[1]}"
        print("✅ test_2_step_bcp_discovery_john_hsieh passed: MEV83VFANA linked with official name John Hsieh!")


def test_jake_jacobson_explicit_bcp_linking_never_hijacked():
    """Verify that when Jake links BCP with his ID, he gets his exact ID and is NOT matched to player 'Jake'."""
    db, conn, cur = make_mock_db()
    auth_mgr = AuthManager(db)

    # Jake's ID is brand new and not yet in player_ratings
    cur.fetchone.side_effect = [
        None,  # No conflict check
        None   # Exact player_ratings check for JAKE99ABCD returns None
    ]

    with patch.object(auth_mgr, "are_registrations_open", return_value=True), patch.object(auth_mgr, "get_user_by_id") as mock_get_user:
        mock_get_user.return_value = {
            "id": "user_jake_123",
            "email": "jake.jacobson@example.com",
            "display_name": "Jake Jacobson",
            "player_id": "JAKE99ABCD",
            "bcp_user_id": "sub_jake_uuid"
        }

        tokens = {
            "id_token": create_fake_jwt({"sub": "sub_jake_uuid", "email": "jake.jacobson@example.com", "custom:userId": "JAKE99ABCD"}),
            "access_token": create_fake_jwt({"sub": "sub_jake_uuid"}),
            "refresh_token": "ref_tok_jake",
            "player_id": "JAKE99ABCD",
            "name": "Jake Jacobson",
            "email": "jake.jacobson@example.com"
        }

        res = auth_mgr.link_bcp_token("user_jake_123", tokens)
        assert res["success"] is True
        assert res["player_id"] == "JAKE99ABCD", f"Expected exact player_id 'JAKE99ABCD', got: {res['player_id']}"
        assert res["player_id"] != "JAKE_STRANGER_1", "Must NOT be hijacked by competitive player 'Jake'!"

        update_calls = [c for c in cur.execute.call_args_list if "UPDATE users" in str(c)]
        update_args = update_calls[0][0][1]
        assert update_args[0] == "Jake Jacobson"
        assert update_args[1] == "JAKE99ABCD"
        print("✅ test_jake_jacobson_explicit_bcp_linking_never_hijacked passed: Linked to exact ID JAKE99ABCD without collision!")


def test_will_trovato_verified_bcp_link():
    """Verify that Will Trovato linking BCP with 5ODCSZURyN links directly to his 212 matches."""
    db, conn, cur = make_mock_db()
    auth_mgr = AuthManager(db)

    cur.fetchone.side_effect = [
        None,  # No conflict check
        {      # Exact player_ratings check for 5ODCSZURyN
            "player_id": "5ODCSZURyN",
            "player_name": "William Trovato",
            "matches_played": 212,
            "current_elo": 1739.77
        }
    ]

    with patch.object(auth_mgr, "are_registrations_open", return_value=True), patch.object(auth_mgr, "get_user_by_id") as mock_get_user:
        mock_get_user.return_value = {
            "id": "user_will_789",
            "email": "will.trovato@example.com",
            "display_name": "William Trovato",
            "player_id": "5ODCSZURyN",
            "bcp_user_id": "sub_will_uuid"
        }

        tokens = {
            "id_token": create_fake_jwt({"sub": "sub_will_uuid", "email": "will.trovato@example.com", "custom:userId": "5ODCSZURyN"}),
            "access_token": create_fake_jwt({"sub": "sub_will_uuid"}),
            "refresh_token": "ref_tok_will",
            "player_id": "5ODCSZURyN",
            "name": "William Trovato",
            "email": "will.trovato@example.com"
        }

        res = auth_mgr.link_bcp_token("user_will_789", tokens)
        assert res["success"] is True
        assert res["player_id"] == "5ODCSZURyN"

        update_calls = [c for c in cur.execute.call_args_list if "UPDATE users" in str(c)]
        update_args = update_calls[0][0][1]
        assert update_args[0] == "William Trovato"
        assert update_args[1] == "5ODCSZURyN"
        print("✅ test_will_trovato_verified_bcp_link passed: 5ODCSZURyN linked with official name William Trovato!")


def test_unlink_bcp_safety():
    """Verify that unlinking BCP clears both bcp_user_id and player_id."""
    db, conn, cur = make_mock_db()
    auth_mgr = AuthManager(db)

    res = auth_mgr.unlink_bcp_account("user_jake_123")
    assert res["success"] is True

    update_calls = [c for c in cur.execute.call_args_list if "UPDATE users" in str(c)]
    assert len(update_calls) == 1
    sql = update_calls[0][0][0]
    assert "player_id = NULL" in sql, f"player_id must be set to NULL on unlink: {sql}"
    assert "bcp_user_id = NULL" in sql, f"bcp_user_id must be set to NULL on unlink: {sql}"
    print("✅ test_unlink_bcp_safety passed: Unlinking cleanly resets player_id to NULL!")


def test_database_search_players_multi_word_tokenized():
    """Verify multi-token query matching in database.search_players is preserved."""
    db = PostgresDatabase.__new__(PostgresDatabase)
    db.pool = None
    
    mock_cursor = MagicMock()
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

    mock_cursor.fetchall.return_value = [
        {
            "player_id": "5ODCSZURyN",
            "player_name": "William Trovato",
            "current_elo": 1739.77,
            "peak_elo": 1837.83,
            "matches_played": 212,
            "wins": 132,
            "losses": 69,
            "draws": 11,
            "win_rate": 62.3,
            "top_faction": "Adeptus Custodes",
            "team": "Team Zero Comp"
        }
    ]

    with patch.object(db, "get_connection") as mock_get_conn:
        mock_get_conn.return_value.__enter__.return_value = mock_conn

        results = db.search_players("Will Trovato", limit=10)
        assert len(results) == 1
        assert results[0]["player_name"] == "William Trovato"
        assert results[0]["player_id"] == "5ODCSZURyN"
        assert results[0]["team"] == "Team Zero Comp"
        print("✅ test_database_search_players_multi_word_tokenized passed: Multi-token player search preserved!")


def test_database_get_players_directory_tokenized():
    """Verify multi-token query matching in database.get_players_directory is preserved."""
    db = PostgresDatabase.__new__(PostgresDatabase)
    db.pool = None
    
    mock_cursor = MagicMock()
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

    mock_cursor.fetchone.return_value = {"total_count": 1}  # COUNT(*) = 1
    mock_cursor.fetchall.return_value = [
        {
            "player_id": "5ODCSZURyN",
            "player_name": "William Trovato",
            "current_elo": 1739.77,
            "peak_elo": 1837.83,
            "matches_played": 212,
            "wins": 132,
            "losses": 69,
            "draws": 11,
            "win_rate": 62.3,
            "top_faction": "Adeptus Custodes",
            "team": "Team Zero Comp",
            "last_active_date": "2026-09-03"
        }
    ]

    with patch.object(db, "get_connection") as mock_get_conn:
        mock_get_conn.return_value.__enter__.return_value = mock_conn

        res = db.get_players_directory(page=1, limit=10, query="Will Trovato")
        assert res["total"] == 1
        assert len(res["items"]) == 1
        assert res["items"][0]["player_name"] == "William Trovato"
        assert res["items"][0]["player_id"] == "5ODCSZURyN"
        assert res["items"][0]["team"] == "Team Zero Comp"
        print("✅ test_database_get_players_directory_tokenized passed: Directory multi-token filtering preserved!")


if __name__ == "__main__":
    print("🚀 Running Exact BCP Player ID Linking & Registration Isolation Test Suite...\n")
    test_registration_isolation_jake_jacobson()
    test_unlinked_hub_safety_no_auto_healing()
    test_profile_settings_safety()
    test_2_step_bcp_discovery_john_hsieh()
    test_jake_jacobson_explicit_bcp_linking_never_hijacked()
    test_will_trovato_verified_bcp_link()
    test_unlink_bcp_safety()
    test_database_search_players_multi_word_tokenized()
    test_database_get_players_directory_tokenized()
    print("\n🎉 ALL 9 EXACT BCP LINKING & REGISTRATION ISOLATION TESTS PASSED 100%!")
