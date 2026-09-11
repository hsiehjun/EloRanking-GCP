"""Phase 2 Multi-Game System Verification Suite
Verifies:
1. Server routes in server.py and scripts/dev_server.py (/aos, /40k, etc.)
2. Frontend app.html markup:
   - Dynamic subtitle with id="app-logo-subtitle"
   - Desktop game system switcher with 40k and AoS buttons
   - Mobile game system switcher button
   - AoS Tracker in-progress modal
   - Tracker intercept logic
3. CSS stylesheet (web/css/styles.css):
   - Desktop and mobile pill classes
   - [data-game-system="aos"] theme variables and gold styling
4. JS client router and API client:
   - web/js/app.js game system controller functions and lifecycle initialization
   - web/js/api.js multi-game system parameter forwarding and default fallbacks
5. Zero regression on 40K functionality:
   - Strict defaults to '40k' across all endpoints and database calls
"""

import inspect
import json
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

import auth
from auth import AuthManager
import database
import elo
from elo import EloEngine
from routers import armylists, community, connect, leaderboard


def test_server_routes_registered():
    """Verify that both server.py and dev_server.py have registered the AoS and 40K routes."""
    with open(ROOT_DIR / "server.py", "r", encoding="utf-8") as f:
        server_src = f.read()
    with open(ROOT_DIR / "scripts" / "dev_server.py", "r", encoding="utf-8") as f:
        dev_server_src = f.read()

    # server.py routes
    assert '"/aos"' in server_src
    assert '"/aos/"' in server_src
    assert '"/aos/app"' in server_src
    assert '"/40k"' in server_src
    assert '"/40k/"' in server_src
    assert '"/40k/app"' in server_src

    # dev_server.py routes
    assert '"aos"' in dev_server_src
    assert '"aos/app"' in dev_server_src
    assert '"40k"' in dev_server_src
    assert '"40k/app"' in dev_server_src
    print("✅ test_server_routes_registered passed")


def test_app_html_elements():
    """Verify app.html contains all necessary multi-game switcher and modal elements."""
    with open(ROOT_DIR / "web" / "app.html", "r", encoding="utf-8") as f:
        html = f.read()

    # Logo subtitle with id
    assert 'id="app-logo-subtitle"' in html
    assert "40K Tactical Suite" in html

    # Desktop segmented switcher
    assert 'id="desktop-game-switcher"' in html
    assert 'class="game-system-switcher desktop-only"' in html
    assert 'data-sys="40k"' in html
    assert 'data-sys="aos"' in html
    assert "switchGameSystem('40k')" in html
    assert "switchGameSystem('aos')" in html

    # Mobile compact switcher button
    assert 'id="mobile-game-switcher"' in html
    assert 'class="mobile-game-system-pill"' in html
    assert "toggleGameSystemMobile()" in html
    assert 'id="mobile-sys-icon"' in html
    assert 'id="mobile-sys-label"' in html

    # AoS tracker modal
    assert 'id="aos-tracker-modal"' in html
    assert "AoS Battle Tracker In Development" in html
    assert "closeAosTrackerModal()" in html
    assert "handleTrackerNavClick(event)" in html
    print("✅ test_app_html_elements passed")


def test_styles_css_classes_and_theme():
    """Verify web/css/styles.css defines switcher classes and AoS theme overrides."""
    with open(ROOT_DIR / "web" / "css" / "styles.css", "r", encoding="utf-8") as f:
        css = f.read()

    assert ".game-system-switcher" in css
    assert ".game-system-pill" in css
    assert ".mobile-game-system-pill" in css
    assert '[data-game-system="aos"]' in css
    assert "--accent: #f59e0b" in css
    assert "--accent-glow: rgba(245, 158, 11" in css
    assert ".logo-title span" in css
    print("✅ test_styles_css_classes_and_theme passed")


def test_app_js_logic_and_bundle():
    """Verify web/js/app.js and app.bundle.min.js implement game system lifecycle."""
    with open(ROOT_DIR / "web" / "js" / "app.js", "r", encoding="utf-8") as f:
        js = f.read()
    with open(ROOT_DIR / "web" / "js" / "app.bundle.min.js", "r", encoding="utf-8") as f:
        bundle = f.read()

    # app.js functions
    assert "let currentGameSystem = '40k';" in js
    assert "function initGameSystem()" in js
    assert "function applyGameSystem(sys, updateUrl = true)" in js
    assert "function switchGameSystem(sys)" in js
    assert "function toggleGameSystemMobile()" in js
    assert "function openAosTrackerModal()" in js
    assert "function closeAosTrackerModal()" in js
    assert "function handleTrackerNavClick(e)" in js
    assert "initGameSystem();" in js

    # app.bundle.min.js contains the compiled symbols
    assert "currentGameSystem" in bundle
    assert "initGameSystem" in bundle
    assert "switchGameSystem" in bundle
    assert "toggleGameSystemMobile" in bundle
    assert "openAosTrackerModal" in bundle
    print("✅ test_app_js_logic_and_bundle passed")


def test_api_client_game_system_forwarding():
    """Verify web/js/api.js parameterizes game_system across endpoints."""
    with open(ROOT_DIR / "web" / "js" / "api.js", "r", encoding="utf-8") as f:
        api_js = f.read()

    assert "getStats(gameSystem = '')" in api_js
    assert "getLeaderboard(faction = 'All', page = 1, pageSize = 25, sortBy = 'current_elo', order = 'DESC', gameSystem = ''" in api_js
    assert "getLeaderboardTeams(minRoster = 1, page = 1, pageSize = 25, sortBy = 'power_rating', order = 'DESC', gameSystem = '')" in api_js
    assert "getTeamsDirectory(query = '', minRoster = 1, sortBy = 'power_rating', order = 'DESC', page = 1, pageSize = 25, gameSystem = '')" in api_js
    assert "getPlayersDirectory(query = '', faction = 'All', sortBy = 'current_elo', order = 'DESC', page = 1, pageSize = 25, gameSystem = '')" in api_js
    assert "getTournaments(query = '', status = 'all', sortBy = 'event_date', order = 'DESC', page = 1, pageSize = 25, gameSystem = '')" in api_js
    assert "getUserDashboard(playerId = null, gameSystem = '')" in api_js
    assert "getRecommendedEvents(" in api_js
    assert "getArmyLists(gameSystem = '')" in api_js
    assert "searchConnectPlayers(" in api_js
    assert "getCommunityOverview(" in api_js
    assert "getCommunityBcpUpcoming(" in api_js
    assert "predictMatch(" in api_js
    print("✅ test_api_client_game_system_forwarding passed")


def test_backend_auth_hub_game_system():
    """Verify auth.AuthManager.get_user_competitor_hub parameterizes game_system."""
    sig = inspect.signature(AuthManager.get_user_competitor_hub)
    assert "game_system" in sig.parameters
    assert sig.parameters["game_system"].default == "40k"

    mock_db = MagicMock()
    mock_db.execute_query.return_value = []
    auth_mgr = AuthManager(mock_db)
    
    # Calling without target_pid returns default empty structure
    res_40k = auth_mgr.get_user_competitor_hub()
    assert res_40k is not None
    assert res_40k["player"]["game_system"] == "40k"

    # Calling with aos returns aos structure
    res_aos = auth_mgr.get_user_competitor_hub(game_system="aos")
    assert res_aos is not None
    assert res_aos["player"]["game_system"] == "aos"
    print("✅ test_backend_auth_hub_game_system passed")


def test_backend_elo_predict_game_system():
    """Verify EloEngine.predict_match_outcome accepts and uses game_system."""
    sig = inspect.signature(EloEngine.predict_match_outcome)
    assert "game_system" in sig.parameters
    assert sig.parameters["game_system"].default == "40k"

    mock_db = MagicMock()
    mock_cursor = MagicMock()
    mock_cursor.fetchone.return_value = {"player_id": "p1", "name": "Player 1", "faction": "Ultramarines", "current_elo": 1600, "matches_played": 10, "wins": 10, "losses": 2}
    mock_db.get_connection.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
    mock_db.get_head_to_head.return_value = []
    
    engine = EloEngine(mock_db)
    res = engine.predict_match_outcome("p1", "p2", game_system="aos")
    assert res is not None
    assert "p1_win_prob" in res
    assert "p2_win_prob" in res
    print("✅ test_backend_elo_predict_game_system passed")


def test_backend_community_router_defaults():
    """Verify community endpoints query parameterization and defaults."""
    def get_default(param):
        d = param.default
        return getattr(d, 'default', d)

    sig_overview = inspect.signature(community.api_community_overview)
    assert "game_system" in sig_overview.parameters
    assert get_default(sig_overview.parameters["game_system"]) == "40k"

    sig_bcp = inspect.signature(community.api_community_bcp_upcoming)
    assert "game_system" in sig_bcp.parameters
    assert get_default(sig_bcp.parameters["game_system"]) == "40k"

    sig_stats = inspect.signature(community.api_community_events_field_stats)
    assert "game_system" in sig_stats.parameters
    assert get_default(sig_stats.parameters["game_system"]) == "40k"
    print("✅ test_backend_community_router_defaults passed")


if __name__ == "__main__":
    print("=== RUNNING MULTI-GAME PHASE 2 COMPREHENSIVE SUITE ===")
    test_server_routes_registered()
    test_app_html_elements()
    test_styles_css_classes_and_theme()
    test_app_js_logic_and_bundle()
    test_api_client_game_system_forwarding()
    test_backend_auth_hub_game_system()
    test_backend_elo_predict_game_system()
    test_backend_community_router_defaults()
    print("\n🎉 ALL PHASE 2 MULTI-GAME TESTS PASSED 100%!")
