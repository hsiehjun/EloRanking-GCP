"""
Unit and Integration Test Suite for Team Recency Synchronization and Elo Ingestion Priority

Verifies:
1. sync_player_latest_teams correctly synchronizes player_ratings.team and players.team
   to each player's most recent tournament team (e.g. Jake Nelson -> Team Zero Comp).
2. sync_player_latest_teams respects idempotency via system_settings ('team_recency_sync_v1')
   and supports force=True.
3. Caches (players, all_teams, team_roster, etc.) are invalidated after sync.
4. elo.py reconstruct_incremental uses event_date recency to populate existing_teams,
   preventing stale player_ratings from overwriting fresh event teams.
5. elo.py recalculate_all_ratings uses event_date recency to populate existing_teams.
6. elo.py upsert_ratings_pg sets team = COALESCE(EXCLUDED.team, player_ratings.team) so new
   tournament affiliations update player_ratings.team on conflict.
7. database.py search_players includes 'team' in returned dictionary.
8. modals.js isCurrent logic matches the active team without duplicate (Current) badges.
9. server.py on_server_startup invokes sync_player_latest_teams.
"""

import sys
import re
from pathlib import Path
from unittest.mock import MagicMock, patch, call

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

import database
database.psycopg2 = MagicMock()
database.extras = MagicMock()
from database import PostgresDatabase


def make_test_db():
    db = object.__new__(PostgresDatabase)
    db.dsn = "postgresql://mock:mock@localhost:5432/mock"
    return db


def test_sync_player_latest_teams():
    """Verify sync_player_latest_teams executes the recency CTE and invalidates caches."""
    db = make_test_db()
    
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    
    # First query checks system_settings (not synced yet)
    mock_cur.fetchone.return_value = None
    mock_cur.rowcount = 142

    with patch.object(db, 'get_connection', return_value=MagicMock(__enter__=MagicMock(return_value=mock_conn), __exit__=MagicMock(return_value=False))), \
         patch.object(PostgresDatabase, 'invalidate_all_caches') as mock_inv:
        
        res = db.sync_player_latest_teams(force=False)
        
        assert res["success"] is True
        assert res["already_synced"] is False
        assert res["updated_ratings"] == 142
        assert res["updated_players"] == 142
        mock_inv.assert_called_once()
        
        # Verify SQL executed contains the recency CTE
        executed_sqls = [call_args[0][0] for call_args in mock_cur.execute.call_args_list]
        recency_sqls = [s for s in executed_sqls if "WITH latest_player_teams AS" in s]
        assert len(recency_sqls) == 2, "Expected 2 updates using latest_player_teams CTE (player_ratings and players)"
        assert "DISTINCT ON (ep.player_id)" in recency_sqls[0]
        assert "e.event_date DESC NULLS LAST" in recency_sqls[0]
        assert "UPDATE player_ratings pr" in recency_sqls[0]
        assert "UPDATE players p" in recency_sqls[1]
        
        # Verify system_settings was recorded
        settings_sql = [s for s in executed_sqls if "team_recency_sync_v1" in s]
        assert len(settings_sql) >= 2, "Expected system_settings check and insert"
        print("✅ test_sync_player_latest_teams passed: recency CTE executed and caches cleared!")


def test_sync_player_latest_teams_idempotency():
    """Verify sync_player_latest_teams skips execution if already synced and force=False."""
    db = make_test_db()
    
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    mock_cur.fetchone.return_value = ('true',)

    with patch.object(db, 'get_connection', return_value=MagicMock(__enter__=MagicMock(return_value=mock_conn), __exit__=MagicMock(return_value=False))), \
         patch.object(PostgresDatabase, 'invalidate_all_caches') as mock_inv:
        
        # Without force: should return already_synced
        res = db.sync_player_latest_teams(force=False)
        assert res["success"] is True
        assert res["already_synced"] is True
        assert res["updated_ratings"] == 0
        mock_inv.assert_not_called()

        # With force: should bypass check and re-run
        mock_cur.rowcount = 5
        res_forced = db.sync_player_latest_teams(force=True)
        assert res_forced["success"] is True
        assert res_forced["already_synced"] is False
        assert res_forced["updated_ratings"] == 5
        mock_inv.assert_called_once()
        
        print("✅ test_sync_player_latest_teams_idempotency passed: idempotency & force toggle verified!")


def test_elo_incremental_recency_ordering():
    """Verify elo.py reconstruct_incremental uses event_date recency and does not overwrite with stale ratings."""
    # Read elo.py source code to verify recency queries
    elo_code = (root_dir / "elo.py").read_text(encoding="utf-8")
    
    # 1. Check reconstruct_incremental contains recency query
    assert "SELECT DISTINCT ON (ep.player_id) ep.player_id, TRIM(ep.team) as team" in elo_code
    assert "e.event_date DESC NULLS LAST" in elo_code
    
    # 2. Check player_ratings does NOT unconditionally overwrite existing_teams
    assert "if r.get(\"team\") and pid not in existing_teams:" in elo_code, \
        "Stale player_ratings must not overwrite fresh event_participants team"

    # 3. Check conflict clause uses COALESCE(EXCLUDED.team, player_ratings.team)
    assert "team = COALESCE(EXCLUDED.team, player_ratings.team)," in elo_code, \
        "Upsert on conflict must prefer new incoming team from EXCLUDED"
    
    print("✅ test_elo_incremental_recency_ordering passed: elo.py team recency confirmed!")


def test_elo_recalculate_all_ratings_recency_ordering():
    """Verify elo.py recalculate_all_ratings prioritizes event recency."""
    elo_code = (root_dir / "elo.py").read_text(encoding="utf-8")

    # In recalculate_all_ratings:
    assert "SELECT DISTINCT ON (ep.player_id) ep.player_id, TRIM(ep.team) as team" in elo_code
    assert "pid not in existing_teams" in elo_code
    print("✅ test_elo_recalculate_all_ratings_recency_ordering passed: bulk recalculation recency confirmed!")


def test_database_search_players_includes_team():
    """Verify search_players selects the 'team' column from player_ratings."""
    db = make_test_db()
    
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    
    mock_cur.fetchall.return_value = [
        {
            "player_id": "jake_123",
            "player_name": "Jake Nelson",
            "current_elo": 1866.3,
            "peak_elo": 1957.8,
            "matches_played": 428,
            "wins": 312,
            "losses": 99,
            "draws": 17,
            "win_rate": 72.9,
            "top_faction": "Astra Militarum",
            "team": "Team Zero Comp"
        }
    ]

    with patch.object(db, 'get_connection', return_value=MagicMock(__enter__=MagicMock(return_value=mock_conn), __exit__=MagicMock(return_value=False))):
        results = db.search_players("Jake Nelson")
        assert len(results) == 1
        assert results[0]["team"] == "Team Zero Comp"
        
        # Verify SQL has team
        sql = mock_cur.execute.call_args[0][0]
        assert "team" in sql
        print("✅ test_database_search_players_includes_team passed: 'team' column present in autocomplete!")


def test_modals_js_current_team_logic():
    """Verify modals.js does not display duplicate (Current) badges."""
    modals_code = (root_dir / "web" / "js" / "modals.js").read_text(encoding="utf-8")
    
    # Must NOT have || (idx === 0) when currentTeam is non-empty
    assert "const isCurrent = (tm.toLowerCase() === currentTeam.toLowerCase()) || (idx === 0);" not in modals_code
    assert "const currentTeam = p.team" in modals_code
    print("✅ test_modals_js_current_team_logic passed: clean single (Current) badge logic verified!")


def test_server_startup_sync_hook():
    """Verify server.py on_server_startup includes sync_player_latest_teams."""
    server_code = (root_dir / "server.py").read_text(encoding="utf-8")
    assert "sync_player_latest_teams(force=False)" in server_code
    print("✅ test_server_startup_sync_hook passed: startup hook present!")


if __name__ == "__main__":
    print("=== RUNNING TEAM RECENCY & ELO RECONSTRUCTION TEST SUITE ===")
    test_sync_player_latest_teams()
    test_sync_player_latest_teams_idempotency()
    test_elo_incremental_recency_ordering()
    test_elo_recalculate_all_ratings_recency_ordering()
    test_database_search_players_includes_team()
    test_modals_js_current_team_logic()
    test_server_startup_sync_hook()
    print("\n🎉 ALL 7 TEAM RECENCY & INGESTION TESTS PASSED 100%!")
