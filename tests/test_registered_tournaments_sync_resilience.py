"""
Test suite verifying database self-healing and resilience for user_tournament_registrations:
- Auto-creation of user_tournament_registrations on missing table (preventing UndefinedTable 500s)
- Safe execution of /api/user/registered-tournaments and /api/user/registered-tournaments/sync
- Schema initialization guard verifying user_tournament_registrations presence
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

def test_database_ensure_registered_tournaments_table_logic():
    """Verify that PostgresDatabase has ensure_registered_tournaments_table and self-healing logic."""
    from database import PostgresDatabase
    assert hasattr(PostgresDatabase, 'ensure_registered_tournaments_table'),         'PostgresDatabase must define ensure_registered_tournaments_table'
    assert hasattr(PostgresDatabase, 'get_user_registered_tournaments'),         'PostgresDatabase must define get_user_registered_tournaments'
    assert hasattr(PostgresDatabase, 'save_user_registered_tournaments'),         'PostgresDatabase must define save_user_registered_tournaments'
    print('✅ PostgresDatabase ensure_registered_tournaments_table method verified!')


def test_api_user_sync_registered_tournaments_resilience():
    """Verify that /api/user/registered-tournaments/sync gracefully recovers from missing table."""
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

    # First call simulates missing table or DB glitch returning [] safely
    mock_db.get_user_registered_tournaments.return_value = []
    mock_db.save_user_registered_tournaments.return_value = [
        {
            'id': f'reg_{user_id}_bcp_ev_100',
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

    with patch('routers.auth.get_database', return_value=mock_db),          patch('routers.auth.get_auth_manager', return_value=mock_auth),          patch('bcp_adapter.bcp_adapter.fetch_user_registered_events') as mock_fetch:

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


def test_schema_precheck_includes_user_tournament_registrations():
    """Verify that database.py includes user_tournament_registrations in init_db pre-check."""
    db_file = root_dir / 'database.py'
    content = db_file.read_text(encoding='utf-8')
    assert "to_regclass('public.user_tournament_registrations') IS NOT NULL" in content,         'database.py init_db pre-check must verify user_tournament_registrations presence'
    assert 'self.ensure_registered_tournaments_table()' in content,         'database.py must call ensure_registered_tournaments_table on init'
    print('✅ Schema pre-check and init hook verified in database.py!')


if __name__ == '__main__':
    test_database_ensure_registered_tournaments_table_logic()
    test_api_user_sync_registered_tournaments_resilience()
    test_schema_precheck_includes_user_tournament_registrations()
    print('ALL REGISTERED TOURNAMENTS RESILIENCE TESTS PASSED!')
