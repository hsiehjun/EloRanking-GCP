"""
Test suite verifying database unified sync architecture for registered tournaments:
- Syncs directly into canonical events and event_participants tables (no user_tournament_registrations)
- Safe execution of /api/user/registered-tournaments and /api/user/registered-tournaments/sync
- Schema initialization precheck verifying canonical events and event_participants presence
"""
import sys
import asyncio
from pathlib import Path
from unittest.mock import patch, MagicMock

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from routers.auth import (
    api_user_registered_tournaments,
    api_user_sync_registered_tournaments
)


def test_database_unified_events_sync_methods():
    """Verify that PostgresDatabase defines unified event sync methods and doesn't rely on custom table."""
    from database import PostgresDatabase
    assert hasattr(PostgresDatabase, 'get_user_registered_tournaments'), \
        'PostgresDatabase must define get_user_registered_tournaments'
    assert hasattr(PostgresDatabase, 'save_user_registered_tournaments'), \
        'PostgresDatabase must define save_user_registered_tournaments'

    db_content = (root_dir / 'database.py').read_text(encoding='utf-8')
    assert 'user_tournament_registrations' not in db_content, \
        'database.py must not contain user_tournament_registrations table references'
    assert 'FROM events e' in db_content, \
        'database.py must query from canonical events table'
    assert 'JOIN event_participants ep' in db_content, \
        'database.py must join with canonical event_participants table'
    print('✅ PostgresDatabase unified events sync methods verified!')


def test_database_sync_events_and_participants_sql_execution():
    """Verify that save_user_registered_tournaments writes to events and event_participants tables."""
    from database import PostgresDatabase
    db = PostgresDatabase.__new__(PostgresDatabase)

    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.__enter__.return_value = mock_conn
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

    executed_sqls = []
    def record_execute(sql, params=None):
        executed_sqls.append(str(sql))
        if 'SELECT player_id' in str(sql):
            mock_cursor.fetchone.return_value = ('player_456', 'Competitor Name')
        elif 'SELECT' in str(sql) and 'FROM events' in str(sql):
            mock_cursor.fetchall.return_value = [
                {
                    'id': 'bcp_ev_999',
                    'bcp_event_id': 'bcp_ev_999',
                    'event_name': 'Las Vegas Open 2026',
                    'name': 'Las Vegas Open 2026',
                    'event_date': '2026-11-01T10:00:00Z',
                    'end_date': '2026-11-03T18:00:00Z',
                    'venue_name': 'Rio Convention Center',
                    'city': 'Las Vegas',
                    'state': 'NV',
                    'country': 'US',
                    'faction': 'Aeldari',
                    'detachment': 'Battle Host',
                    'army_list': '2000 pts list',
                    'has_list_submitted': True,
                    'checked_in': True,
                    'points_limit': 2000,
                    'rounds': 6,
                    'total_players': 256,
                    'bcp_url': 'https://www.bestcoastpairings.com/event/bcp_ev_999'
                }
            ]

    mock_cursor.execute.side_effect = record_execute

    with patch.object(db, 'get_connection', return_value=mock_conn):
        sample_events = [{
            'bcp_event_id': 'bcp_ev_999',
            'event_name': 'Las Vegas Open 2026',
            'event_date': '2026-11-01T10:00:00Z',
            'venue_name': 'Rio Convention Center',
            'city': 'Las Vegas',
            'state': 'NV',
            'country': 'US',
            'faction': 'Aeldari',
            'detachment': 'Battle Host',
            'army_list': '2000 pts list',
            'has_list_submitted': True,
            'checked_in': True,
            'points_limit': 2000,
            'rounds': 6,
            'total_players': 256
        }]
        res = db.save_user_registered_tournaments('user_123', sample_events)

        combined_sql = ' '.join(executed_sqls)
        assert 'INSERT INTO events' in combined_sql, 'Must insert into canonical events table'
        assert 'INSERT INTO event_participants' in combined_sql, 'Must insert into canonical event_participants table'
        assert 'user_tournament_registrations' not in combined_sql, 'Must not touch user_tournament_registrations'
        assert len(res) == 1
        assert res[0]['bcp_event_id'] == 'bcp_ev_999'
        print('✅ save_user_registered_tournaments SQL execution on events & event_participants verified!')


def test_api_user_sync_registered_tournaments_resilience():
    """Verify that /api/user/registered-tournaments/sync operates cleanly."""
    mock_db = MagicMock()
    mock_auth = MagicMock()

    user_id = 'user_bcp_player_1'
    session = {
        'id': user_id,
        'email': 'player@example.com',
        'display_name': 'Test Player',
        'bcp_connected': True,
        'bcp_user_id': 'bcp_uid_999'
    }

    mock_auth.get_session.return_value = session
    mock_auth.get_user_by_id.return_value = session

    mock_db.get_user_registered_tournaments.return_value = []
    mock_db.save_user_registered_tournaments.return_value = [
        {
            'id': 'bcp_ev_100',
            'bcp_event_id': 'bcp_ev_100',
            'event_name': 'Bay Area Open 2026',
            'event_date': '2026-10-15T09:00:00Z',
            'venue_name': 'San Jose Convention Center',
            'city': 'San Jose',
            'state': 'CA',
            'country': 'US',
            'faction': 'Aeldari',
            'rounds': 5,
            'total_players': 128
        }
    ]

    mock_req = MagicMock()
    mock_req.headers = {'Authorization': 'Bearer valid_token'}
    mock_req.cookies = {}

    with patch('routers.auth.get_database', return_value=mock_db), \
         patch('routers.auth.get_auth_manager', return_value=mock_auth), \
         patch('bcp_adapter.bcp_adapter.fetch_user_registered_events') as mock_fetch:

        mock_fetch.return_value = (True, None, [{
            'id': 'bcp_ev_100',
            'name': 'Bay Area Open 2026',
            'eventDate': '2026-10-15T09:00:00Z',
            'venue': 'San Jose Convention Center',
            'city': 'San Jose',
            'state': 'CA',
            'country': 'US',
            'army': 'Aeldari',
            'numRounds': 5,
            'totalPlayers': 128
        }])

        # Test GET /api/user/registered-tournaments
        res_get = asyncio.run(api_user_registered_tournaments(mock_req))
        assert res_get['success'] is True
        assert res_get['bcp_connected'] is True
        assert res_get['count'] == 1
        assert res_get['tournaments'][0]['event_name'] == 'Bay Area Open 2026'
        print('✅ GET /api/user/registered-tournaments succeeded with sync!')

        # Test POST /api/user/registered-tournaments/sync
        res_sync = asyncio.run(api_user_sync_registered_tournaments(mock_req))
        assert res_sync['success'] is True
        assert res_sync['bcp_connected'] is True
        assert res_sync['count'] == 1
        assert res_sync['tournaments'][0]['bcp_event_id'] == 'bcp_ev_100'
        print('✅ POST /api/user/registered-tournaments/sync succeeded!')


def test_schema_precheck_uses_events_and_participants():
    """Verify that database.py includes canonical events and event_participants in init_db pre-check."""
    db_file = root_dir / 'database.py'
    content = db_file.read_text(encoding='utf-8')
    assert "to_regclass('public.events') IS NOT NULL" in content, \
        'database.py init_db pre-check must verify events table presence'
    assert "to_regclass('public.event_participants') IS NOT NULL" in content, \
        'database.py init_db pre-check must verify event_participants table presence'
    assert "user_tournament_registrations" not in content, \
        'database.py must not contain user_tournament_registrations'
    print('✅ Canonical schema pre-check verified in database.py!')


if __name__ == '__main__':
    test_database_unified_events_sync_methods()
    test_database_sync_events_and_participants_sql_execution()
    test_api_user_sync_registered_tournaments_resilience()
    test_schema_precheck_uses_events_and_participants()
    print('ALL UNIFIED REGISTERED TOURNAMENTS SYNC TESTS PASSED!')
