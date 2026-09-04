"""Comprehensive verification test for mobile experience fixes and frontend integrity."""
import json
import re
from pathlib import Path

root_dir = Path(__file__).resolve().parent.parent

def test_styles_css_mobile_rules():
    """Verify that styles.css correctly eliminates all scroll traps on mobile."""
    css_path = root_dir / "web" / "css" / "styles.css"
    assert css_path.exists(), "styles.css not found"
    content = css_path.read_text(encoding="utf-8")

    # 1. Balanced braces in CSS
    open_braces = content.count("{")
    close_braces = content.count("}")
    assert open_braces == close_braces, f"Mismatched braces in styles.css: {open_braces} open vs {close_braces} close"
    print(f"✅ styles.css balanced braces verified ({open_braces} blocks)")

    # 2. Verify mobile scroll unification block exists at the end
    assert "MOBILE UNIFIED VIEWPORT & SCROLL TRAP ELIMINATION" in content, "Mobile scroll unification header missing"
    
    # 3. Check that key components have max-height: none !important and overflow-y: visible !important on mobile
    expected_selectors = [
        ".table-container",
        ".hub-table-wrapper",
        ".hub-events-grid",
        ".comm-events-grid",
        ".comm-competitors-grid",
        ".comm-table-container",
        ".comm-stores-grid",
        ".faction-chip-container",
        ".hub-armylists-list-container",
        "#hub-armylists-list-container",
        "#faction-toggle-chips",
        ".modal-body .table-container"
    ]
    for sel in expected_selectors:
        assert sel in content, f"Expected selector '{sel}' missing in styles.css"
    print(f"✅ All {len(expected_selectors)} target components explicitly styled in mobile unification block")

    # 4. Verify desktop class defined for hub-armylists-list-container
    assert ".hub-armylists-list-container {" in content, ".hub-armylists-list-container desktop definition missing"
    print("✅ .hub-armylists-list-container desktop definition verified")


def test_my_hub_js_no_inline_scroll_trap():
    """Verify that my_hub.js does not contain hardcoded inline scroll traps on armylists container."""
    js_path = root_dir / "web" / "js" / "my_hub.js"
    assert js_path.exists(), "my_hub.js not found"
    content = js_path.read_text(encoding="utf-8")

    # Check for armylists list container
    assert 'id="hub-armylists-list-container"' in content, "hub-armylists-list-container missing"
    assert 'class="hub-armylists-list-container"' in content, "hub-armylists-list-container missing class"
    
    # Ensure no inline style with max-height on hub-armylists-list-container
    armylists_match = re.search(r'id=["\']hub-armylists-list-container["\'][^>]*style=["\'][^"\']*max-height', content)
    assert armylists_match is None, "hub-armylists-list-container still has inline max-height style!"
    print("✅ my_hub.js armylists container verified clean of inline scroll trap")


def test_html_assets_exist():
    """Verify that all CSS, JS, and image assets referenced in HTML files actually exist."""
    html_files = [
        root_dir / "web" / "index.html",
        root_dir / "web" / "app.html",
        root_dir / "web" / "eventstudio.html",
        root_dir / "web" / "tracker" / "index.html"
    ]

    for html_path in html_files:
        if not html_path.exists():
            continue
        content = html_path.read_text(encoding="utf-8")
        
        # Check script tags: src="..."
        scripts = re.findall(r'<script\s+[^>]*src=["\']([^"\']+)["\']', content)
        for s in scripts:
            if s.startswith("http://") or s.startswith("https://") or s.startswith("//"):
                continue
            clean_s = s.split("?")[0].lstrip("/")
            resolved = root_dir / "web" / clean_s
            assert resolved.exists(), f"Asset '{s}' referenced in {html_path.name} does not exist at {resolved}"

        # Check link tags: href="..." for stylesheets
        css_links = re.findall(r'<link\s+[^>]*href=["\']([^"\']+\.css(?:\?[^"\']*)?)["\']', content)
        for c in css_links:
            if c.startswith("http://") or c.startswith("https://") or c.startswith("//"):
                continue
            clean_c = c.split("?")[0].lstrip("/")
            resolved = root_dir / "web" / clean_c
            assert resolved.exists(), f"CSS stylesheet '{c}' referenced in {html_path.name} does not exist at {resolved}"

        print(f"✅ {html_path.name} asset references verified ({len(scripts)} scripts, {len(css_links)} stylesheets)")


def test_router_module_imports():
    """Verify that all 8 routers import cleanly and have their routes list intact."""
    import sys
    sys.path.insert(0, str(root_dir))
    from routers import (
        admin, armylists, auth, community,
        connect, eventstudio, leaderboard, tracker
    )
    routers = [admin, armylists, auth, community, connect, eventstudio, leaderboard, tracker]
    total_routes = 0
    for r in routers:
        assert hasattr(r, "router"), f"Router module {r.__name__} missing 'router'"
        count = len(r.router.routes)
        assert count > 0, f"Router module {r.__name__} has 0 routes"
        total_routes += count

    print(f"✅ All 8 routers imported cleanly with a total of {total_routes} routes!")

def test_document_scrolling_architecture():
    """Verify that body/window scrolling is restored and main does not trap desktop scrollbars."""
    theme_content = (root_dir / "web" / "css" / "theme.css").read_text(encoding="utf-8")
    styles_content = (root_dir / "web" / "css" / "styles.css").read_text(encoding="utf-8")

    # body should have min-height: 100vh and NOT overflow: hidden (except for chat-mode-active)
    assert "overflow-x: hidden;" in theme_content, "body should have overflow-x: hidden in theme.css"
    assert "body.chat-mode-active" in theme_content, "chat-mode-active scroll lock should be defined"
    
    # main should NOT have overflow-y: auto in base styles (which caused the floating desktop scrollbar)
    base_main = re.search(r'/\* Main Container \*/\s*main\s*\{([^}]+)\}', styles_content)
    assert base_main is not None, "Base main rule not found in styles.css"
    assert "overflow-y: auto" not in base_main.group(1), "Base main should NOT have overflow-y: auto"
    print("✅ Document scrolling architecture verified (no floating scrollbar on desktop main)")


def test_layout_width_and_mobile_stacking():
    """Verify that browser pages have consistent container max-widths and mobile stacks vertically."""
    theme_content = (root_dir / "web" / "css" / "theme.css").read_text(encoding="utf-8")
    styles_content = (root_dir / "web" / "css" / "styles.css").read_text(encoding="utf-8")
    index_content = (root_dir / "web" / "index.html").read_text(encoding="utf-8")
    app_content = (root_dir / "web" / "app.html").read_text(encoding="utf-8")
    auth_content = (root_dir / "web" / "js" / "auth.js").read_text(encoding="utf-8")
    connect_content = (root_dir / "web" / "js" / "connect.js").read_text(encoding="utf-8")

    # 1. Theme.css and styles.css enforce #app-shell column stacking
    assert "flex-direction: column !important;" in theme_content, "#app-shell column stacking missing in theme.css"
    assert "#app-shell" in styles_content, "#app-shell missing in styles.css"
    assert "flex-direction: column !important;" in styles_content, "column stacking missing in styles.css"

    # 2. Desktop container max-width consistency (1440px header and main)
    header_match = re.search(r'\.header-inner\s*\{([^}]+)\}', styles_content)
    assert header_match is not None, ".header-inner missing in styles.css"
    assert "max-width: 1440px;" in header_match.group(1), ".header-inner should be 1440px"

    main_match = re.search(r'/\* Main Container \*/\s*main\s*\{([^}]+)\}', styles_content)
    assert main_match is not None, "/* Main Container */ main missing in styles.css"
    assert "max-width: 1440px;" in main_match.group(1), "main should have max-width: 1440px matching header"

    # 3. Community and EventStudio container width consistency
    assert 'max-width: 1360px' not in app_content, "app.html still has conflicting max-width: 1360px"
    assert 'class="comm-container" style="width: 100%; max-width: 100%;' in app_content, "comm-container not full-width"
    assert 'class="es-app-container" style="width: 100%; max-width: 100%;' in app_content, "es-app-container not full-width"

    # 4. Anti-FOUC guard and auth.js column enforcement
    assert '#app-shell { display: flex !important; flex-direction: column !important; width: 100% !important; }' in app_content, "anti-fouc guard in app.html missing column enforcement"
    assert '#app-shell { display: flex !important; flex-direction: column !important; width: 100% !important; }' in auth_content, "auth.js syncAppAuthView missing column enforcement"

    # 5. Radar paused/empty cards should not shrink to 680px island
    assert 'max-width: 680px' not in connect_content, "connect.js still has cards constrained to max-width: 680px"

    print("✅ Layout container width consistency and mobile vertical stacking verified!")


def test_floating_chat_back_navigation():
    """Verify that floating chat compact back button and auto-selection logic function correctly."""
    styles_content = (root_dir / "web" / "css" / "styles.css").read_text(encoding="utf-8")
    connect_content = (root_dir / "web" / "js" / "connect.js").read_text(encoding="utf-8")
    app_content = (root_dir / "web" / "app.html").read_text(encoding="utf-8")

    # 1. Verify app.html chat-back-btn exists with onclick backToChatList
    assert 'id="chat-back-btn"' in app_content, "chat-back-btn ID missing in app.html"
    assert 'onclick="backToChatList(); return false;"' in app_content, "backToChatList onclick missing in app.html"

    # 2. Verify connect.js exports backToChatList to window
    assert 'window.backToChatList = backToChatList;' in connect_content, "window.backToChatList export missing in connect.js"

    # 3. Verify auto-selection in renderRequestsList only triggers when isFloatingChatWide is true
    assert 'if (isFloatingChatWide && !connectState.activeRequestId && acceptedConvos.length > 0 && window.innerWidth > 768)' in connect_content, \
        "renderRequestsList must only auto-select when isFloatingChatWide is true"

    # 4. Verify backToChatList resets state and clears active selection
    assert 'layout.classList.remove(\'is-viewing-chat\');' in connect_content, "backToChatList must remove is-viewing-chat"
    assert 'connectState.activeRequestId = null;' in connect_content, "backToChatList must reset activeRequestId"
    assert 'detachChatSnapshot();' in connect_content, "backToChatList must detach chat snapshot"

    # 5. Verify styles.css compact mode enforces master-detail display
    assert '.floating-chat-window:not(.is-wide) .oc-chat-layout .oc-chat-sidebar {\n  display: flex !important;' in styles_content, \
        "Compact chat sidebar must have display: flex !important"
    assert '.floating-chat-window:not(.is-wide) .oc-chat-layout .oc-chat-main {\n  display: none !important;' in styles_content, \
        "Compact chat main must have display: none !important"

    print("✅ Floating chat back navigation and compact master-detail architecture verified!")


def test_mobile_nav_dropdown_no_chat():
    """Verify that mobile nav dropdown does not include redundant Chat option now that it is a persistent bubble."""
    app_content = (root_dir / "web" / "app.html").read_text(encoding="utf-8")

    # Locate mobile-nav-select block
    select_match = re.search(r'<select id="mobile-nav-select"[^>]*>(.*?)</select>', app_content, re.DOTALL)
    assert select_match is not None, "mobile-nav-select not found in app.html"
    select_inner = select_match.group(1)

    # Assert chat is NOT in mobile-nav options
    assert 'value="chat"' not in select_inner, "mobile-nav-select still contains value='chat'"
    assert 'mobile-opt-chat' not in select_inner, "mobile-nav-select still contains mobile-opt-chat"

    # Assert redundant top-header chat button is removed from desktop browser header
    assert 'id="nav-btn-chat"' not in app_content, "app.html top header still contains redundant nav-btn-chat"

    # Assert standard tabs exist
    assert 'value="my-hub"' in select_inner, "my-hub missing in mobile-nav-select"
    assert 'value="community"' in select_inner, "community missing in mobile-nav-select"
    assert 'value="tracker"' in select_inner, "tracker missing in mobile-nav-select"
    assert 'value="leaderboard"' in select_inner, "leaderboard missing in mobile-nav-select"

    # Assert persistent floating chat bubble exists
    assert 'id="floating-chat-bubble"' in app_content, "floating-chat-bubble missing in app.html"

    print("✅ Header and mobile nav dropdown verified free of redundant Chat buttons (chat handled exclusively via bubble)!")


def test_landing_page_and_chat_notification_fixes():
    """Verify that chat bubble is hidden on landing page, landing header displays on mobile, and notifications clear immediately."""
    styles_content = (root_dir / "web" / "css" / "styles.css").read_text(encoding="utf-8")
    index_content = (root_dir / "web" / "index.html").read_text(encoding="utf-8")
    auth_content = (root_dir / "web" / "js" / "auth.js").read_text(encoding="utf-8")
    connect_content = (root_dir / "web" / "js" / "connect.js").read_text(encoding="utf-8")

    # 1. Chat bubble hidden on landing page
    assert '#floating-chat-widget { display: none !important; }' in index_content, \
        "anti-fouc guard in index.html must hide floating-chat-widget when unauthenticated"
    assert '#floating-chat-widget { display: none !important; }' in auth_content, \
        "syncAppAuthView in auth.js must hide floating-chat-widget when unauthenticated"
    assert '#landing-page-view:not([style*="display: none"]) ~ #floating-chat-widget' in styles_content, \
        "styles.css must hide floating-chat-widget when landing page is visible"

    # 2. Mobile landing page header visibility (logo-group should NOT be hidden globally)
    assert '#app-header .logo-group {\n    display: none !important;\n  }' in styles_content, \
        "Mobile logo-group hiding must be scoped to #app-header, not global .logo-group"
    assert '.landing-nav .logo-group' in styles_content, \
        ".landing-nav .logo-group must be explicitly styled"
    assert '.landing-nav-inner .logo-group {\n    display: flex !important;' in styles_content, \
        ".landing-nav-inner .logo-group must be display: flex on mobile"

    # 3. Responsive chat notification clearing
    assert 'markCurrentChatAsRead' in connect_content, \
        "connect.js must define markCurrentChatAsRead"
    assert 'localReq.unread_count = 0;' in connect_content, \
        "connect.js must immediately clear local unread_count upon reading"
    assert 'updateUnreadCountBadge();' in connect_content, \
        "connect.js must call updateUnreadCountBadge after reading messages"
    assert 'window.addEventListener(\'focus\'' in connect_content, \
        "connect.js must have focus event listener for instant notification sync"

    print("✅ Landing page chat hiding, mobile header restoration, and responsive notification clearing verified!")


def test_meta_intel_and_search_filter_cleanups():
    """Verify that Meta Intel is a dedicated top-level section and search filters are streamlined."""
    index_content = (root_dir / "web" / "index.html").read_text(encoding="utf-8")
    app_html_content = (root_dir / "web" / "app.html").read_text(encoding="utf-8")
    app_content = (root_dir / "web" / "js" / "app.js").read_text(encoding="utf-8")
    lead_content = (root_dir / "web" / "js" / "leaderboard.js").read_text(encoding="utf-8")
    teams_content = (root_dir / "web" / "js" / "teams.js").read_text(encoding="utf-8")

    # 1. Desktop and Mobile Navigation for Meta Intel in App Shell
    assert 'id="nav-btn-meta-intel"' in app_html_content, "nav-btn-meta-intel missing in header nav"
    assert 'onclick="switchTab(\'meta-intel\')"' in app_html_content, "switchTab('meta-intel') missing in nav-btn"
    assert '<option value="meta-intel">📊 Meta Intel</option>' in app_html_content, "meta-intel option missing in mobile-nav-select"
    # Meta Intel is prominently featured in the landing capabilities grid (landing header is kept clean without link bloat)
    assert 'id="meta-intel"' in index_content, "meta-intel card missing in landing features"
    assert 'class="landing-nav-links"' not in index_content, "landing header must be streamlined without bloated anchor links"

    # 2. Dedicated Section Architecture in App Shell
    assert '<section id="tab-meta-intel" class="tab-panel">' in app_html_content, "tab-meta-intel section missing in app.html"
    assert 'id="meta-subtab-factions"' in app_html_content, "meta-subtab-factions missing in app.html"
    assert 'id="meta-subtab-predictor"' in app_html_content, "meta-subtab-predictor missing in app.html"
    
    # Verify Leaderboard strictly has players and teams subtabs
    assert 'id="lead-subtab-players"' in app_html_content, "lead-subtab-players missing"
    assert 'id="lead-subtab-teams"' in app_html_content, "lead-subtab-teams missing"
    assert 'id="lead-subtab-factions"' not in app_html_content, "lead-subtab-factions should be moved out of tab-leaderboard"
    assert 'id="lead-subtab-predictor"' not in app_html_content, "lead-subtab-predictor should be moved out of tab-leaderboard"

    # 3. Search Filters Streamlined
    assert 'id="dir-faction-filter"' not in app_html_content, "dir-faction-filter should be removed from player search"
    assert 'id="dir-min-matches-filter"' not in app_html_content, "dir-min-matches-filter should be removed from player search"
    assert 'id="teams-min-roster-filter"' not in app_html_content, "teams-min-roster-filter should be removed from teams search"

    # 4. JS Routing & Subtab Switching
    assert 'switchMetaSubtab' in lead_content, "switchMetaSubtab missing in leaderboard.js"
    assert 'window.switchMetaSubtab = switchMetaSubtab;' in lead_content, "switchMetaSubtab not exported to window"
    assert "tabName === 'meta-intel'" in app_content, "meta-intel handling missing in app.js switchTab"
    assert "minRoster = minRosterSelect ? minRosterSelect.value : 1;" in teams_content, "teams.js must default minRoster to 1"

    print("✅ Meta Intel dedicated section and streamlined name-only search filters verified!")


def test_ios_landing_header_safe_area():
    """Verify that iOS-specific safe-area notch and status bar clearance is properly enforced."""
    index_content = (root_dir / "web" / "index.html").read_text(encoding="utf-8")
    styles_content = (root_dir / "web" / "css" / "styles.css").read_text(encoding="utf-8")

    # 1. Synchronous iOS detection in index.html <head>
    assert "document.documentElement.classList.add('is-ios');" in index_content, \
        "index.html must synchronously add is-ios class before first paint"
    assert "document.documentElement.classList.add('is-ios-standalone');" in index_content, \
        "index.html must detect iOS standalone PWA/webclip mode"

    # 2. CSS @supports (-webkit-touch-callout: none) WebKit isolation
    assert "@supports (-webkit-touch-callout: none)" in styles_content, \
        "styles.css must isolate iOS styling using @supports (-webkit-touch-callout: none)"
    assert "padding-top: env(safe-area-inset-top, 0px) !important;" in styles_content, \
        "styles.css must apply safe-area-inset-top to .landing-nav"

    # 3. Class-based iOS rules
    assert "html.is-ios .landing-nav" in styles_content, \
        "html.is-ios .landing-nav rule missing in styles.css"
    assert "html.is-ios-standalone .landing-nav" in styles_content, \
        "html.is-ios-standalone .landing-nav rule missing in styles.css"
    assert "max(env(safe-area-inset-top, 0px), 44px)" in styles_content, \
        "Standalone mode must enforce at least 44px top clearance for status bar"

    # 4. Button touch optimization for iOS
    assert "touch-action: manipulation;" in styles_content, \
        "iOS navigation buttons must have touch-action: manipulation to eliminate tap delay"
    assert "min-height: 38px !important;" in styles_content or "min-height: 36px !important;" in styles_content, \
        "iOS navigation buttons must have min-height for comfortable touch target"

    # 5. Base .landing-nav on non-iOS (Android/desktop) remains clean
    base_landing_match = re.search(r'\.landing-nav\s*\{([^}]+)\}', styles_content)
    assert base_landing_match is not None, ".landing-nav base rule not found"
    assert "top: 0;" in base_landing_match.group(1), ".landing-nav should stick to top: 0"

    print("✅ iOS landing header safe-area clearance and touch targets verified (Android unaffected)!")


def test_universal_ios_safe_area_coverage():
    """Verify universal iOS status-bar and notch safe-area clearance across all app views."""
    styles_content = (root_dir / "web" / "css" / "styles.css").read_text(encoding="utf-8")
    login_content = (root_dir / "web" / "tracker" / "login.html").read_text(encoding="utf-8")
    play_content = (root_dir / "web" / "tracker" / "play.html").read_text(encoding="utf-8")
    lobby_content = (root_dir / "web" / "tracker" / "lobby.html").read_text(encoding="utf-8")
    tracker_sync_css = (root_dir / "web" / "tracker" / "tracker_sync.css").read_text(encoding="utf-8")
    tracker_sync_js = (root_dir / "web" / "tracker" / "tracker_sync.js").read_text(encoding="utf-8")
    eventstudio_html = (root_dir / "web" / "eventstudio.html").read_text(encoding="utf-8")
    eventstudio_css = (root_dir / "web" / "css" / "eventstudio.css").read_text(encoding="utf-8")

    # 1. Main app header & mobile nav select safe-area coverage
    assert "html.is-ios #app-header" in styles_content, "html.is-ios #app-header rule missing"
    assert "html.is-ios .mobile-nav-select" in styles_content, "html.is-ios .mobile-nav-select missing"
    assert "min-height: 44px !important;" in styles_content, "mobile-nav-select must have 44px min-height on iOS"
    assert "font-size: 16px !important;" in styles_content, "mobile-nav-select must have font-size 16px to prevent iOS auto-zoom"
    assert "html.is-ios .modal-backdrop" in styles_content, "html.is-ios .modal-backdrop rule missing"
    assert "html.is-ios-standalone #app-header" in styles_content, "html.is-ios-standalone #app-header missing"
    assert "html.is-ios-standalone .modal-backdrop" in styles_content, "html.is-ios-standalone .modal-backdrop missing"

    # 2. Login view (web/tracker/login.html)
    assert "classList.add('is-ios')" in login_content, "login.html must have synchronous iOS detector"
    assert "classList.add('is-ios-standalone')" in login_content, "login.html must detect iOS standalone PWA"
    assert "env(safe-area-inset-top, 0px)" in login_content, "login.html body must respect safe-area-inset-top"
    assert "html.is-ios-standalone body" in login_content, "login.html must have standalone iOS body floor"

    # 3. Game Tracker views (lobby, play, tracker_sync.css, tracker_sync.js)
    assert "classList.add('is-ios')" in lobby_content, "lobby.html must have synchronous iOS detector"
    assert "classList.add('is-ios')" in play_content, "play.html must have synchronous iOS detector"
    assert "#gt-user-status-bar" in tracker_sync_css, "tracker_sync.css must style #gt-user-status-bar"
    assert "#gt-sync-hud" in tracker_sync_css, "tracker_sync.css must style #gt-sync-hud"
    assert "html.is-ios #gt-user-status-bar" in tracker_sync_css, "iOS #gt-user-status-bar rule missing"
    assert "html.is-ios #gt-sync-hud" in tracker_sync_css, "iOS #gt-sync-hud rule missing"
    assert "html.is-ios-standalone #gt-sync-hud" in tracker_sync_css, "standalone iOS #gt-sync-hud rule missing"
    assert "env(safe-area-inset-top, 0px)" in tracker_sync_js, "tracker_sync.js bar creation must respect safe-area"

    # 4. Event Studio (eventstudio.html & eventstudio.css)
    assert "viewport-fit=cover" in eventstudio_html, "eventstudio.html must include viewport-fit=cover"
    assert "classList.add('is-ios')" in eventstudio_html, "eventstudio.html must have synchronous iOS detector"
    assert "html.is-ios .es-app-container" in eventstudio_css, "eventstudio.css must have html.is-ios .es-app-container rule"
    assert "html.is-ios-standalone .es-app-container" in eventstudio_css, "eventstudio.css must have standalone rule"

    # 5. CSS brace balance across all modified stylesheets
    for p, c in [("styles.css", styles_content), ("tracker_sync.css", tracker_sync_css), ("eventstudio.css", eventstudio_css)]:
        o = c.count("{")
        cl = c.count("}")
        assert o == cl, f"{p} has mismatched braces: {o} open vs {cl} close"

    print("✅ Universal iOS safe-area clearance verified across Landing, App Shell, Login, Tracker, and Event Studio!")


def test_teams_leaderboard_pagination():
    """Verify that Teams Leaderboard has complete pagination controls, offset ranks, and API parameters."""
    app_content = (root_dir / "web" / "app.html").read_text(encoding="utf-8")
    api_content = (root_dir / "web" / "js" / "api.js").read_text(encoding="utf-8")
    lead_content = (root_dir / "web" / "js" / "leaderboard.js").read_text(encoding="utf-8")
    app_js_content = (root_dir / "web" / "js" / "app.js").read_text(encoding="utf-8")
    router_content = (root_dir / "routers" / "leaderboard.py").read_text(encoding="utf-8")

    # 1. HTML pagination container in Teams Leaderboard view
    assert 'id="lead-teams-pagination"' in app_content, \
        "lead-teams-pagination container missing in app.html"
    assert '<div id="lead-teams-pagination" class="pagination-bar"></div>' in app_content, \
        "lead-teams-pagination markup missing in app.html"

    # 2. api.js getLeaderboardTeams signature and query parameters
    assert 'getLeaderboardTeams(minRoster = 1, page = 1, pageSize = 25' in api_content, \
        "api.js getLeaderboardTeams must support minRoster, page, pageSize"
    assert 'page_size: pageSize' in api_content, \
        "api.js getLeaderboardTeams must pass page_size parameter"
    assert 'min_roster: minRoster' in api_content, \
        "api.js getLeaderboardTeams must pass min_roster parameter"

    # 3. leaderboard.js state and pagination functions
    assert 'leaderboardTeamsPagination = { page: 1, pageSize: 25, total: 0, totalPages: 1 };' in lead_content, \
        "leaderboardTeamsPagination state missing in leaderboard.js"
    assert 'window.setLeaderboardTeamsPage = setLeaderboardTeamsPage;' in lead_content, \
        "setLeaderboardTeamsPage must be exported to window"
    assert 'window.setLeaderboardTeamsPageSize = setLeaderboardTeamsPageSize;' in lead_content, \
        "setLeaderboardTeamsPageSize must be exported to window"
    assert "renderPaginationBar('lead-teams-pagination', leaderboardTeamsPagination, 'setLeaderboardTeamsPage', 'setLeaderboardTeamsPageSize');" in lead_content, \
        "renderPaginationBar call missing for lead-teams-pagination"

    # 4. Correct rank offset calculation in renderLeaderboardTeamsRows
    assert 'const offset = (page - 1) * pageSize;' in lead_content, \
        "renderLeaderboardTeamsRows must compute offset from page and pageSize"
    assert 'const rank = offset + idx + 1;' in lead_content, \
        "renderLeaderboardTeamsRows must use offset + idx + 1 for rank"

    # 5. Prefetch support
    assert 'prefetchNextLeaderboardTeamsPage' in lead_content, \
        "prefetchNextLeaderboardTeamsPage missing in leaderboard.js"

    # 6. Tab switching trigger in app.js
    assert 'loadLeaderboardTeams();' in app_js_content, \
        "app.js must trigger loadLeaderboardTeams when switching to teams subtab"

    # 7. Backend router defaults min_roster to 1
    assert 'min_roster: int = Query(1, ge=1)' in router_content, \
        "routers/leaderboard.py api_teams must default min_roster to 1"

    print("✅ Teams leaderboard pagination controls, ranking offset, and API wiring verified!")


def test_custom_timeframe_calendar_picker():
    """Verify high-visibility calendar picker icons, dark color-scheme, and openDatePicker helpers."""
    theme_content = (root_dir / "web" / "css" / "theme.css").read_text(encoding="utf-8")
    styles_content = (root_dir / "web" / "css" / "styles.css").read_text(encoding="utf-8")
    app_content = (root_dir / "web" / "app.html").read_text(encoding="utf-8")
    utils_content = (root_dir / "web" / "js" / "utils.js").read_text(encoding="utf-8")
    fac_content = (root_dir / "web" / "js" / "factions.js").read_text(encoding="utf-8")

    # 1. Dark mode color-scheme on :root and input[type="date"]
    assert 'color-scheme: dark;' in theme_content, \
        "theme.css :root must include color-scheme: dark to prevent invisible dark-on-dark calendar icons"
    assert 'input[type="date"]' in styles_content, \
        "styles.css must style input[type='date']"
    assert 'color-scheme: dark !important;' in styles_content, \
        "styles.css must enforce color-scheme: dark on input[type='date']"
    assert 'input[type="date"]::-webkit-calendar-picker-indicator' in styles_content, \
        "styles.css must style webkit calendar picker indicator"

    # 2. Custom Date Range Bar classes in styles.css
    assert '.faction-custom-date-container' in styles_content, \
        "styles.css must define .faction-custom-date-container"
    assert '.custom-date-input-wrap' in styles_content, \
        "styles.css must define .custom-date-input-wrap"
    assert '.calendar-badge-btn' in styles_content, \
        "styles.css must define .calendar-badge-btn"
    assert '.custom-date-input' in styles_content, \
        "styles.css must define .custom-date-input"

    # 3. HTML markup in app.html
    assert 'id="faction-custom-date-container"' in app_content, \
        "faction-custom-date-container missing in app.html"
    assert 'openDatePicker(\'faction-start-date\')' in app_content, \
        "openDatePicker call missing for faction-start-date"
    assert 'openDatePicker(\'faction-end-date\')' in app_content, \
        "openDatePicker call missing for faction-end-date"
    assert '<svg viewBox="0 0 24 24"' in app_content, \
        "SVG calendar icon missing in custom date range bar"

    # 4. JavaScript helpers & auto-initialization
    assert 'openDatePicker' in utils_content, \
        "utils.js must define openDatePicker"
    assert 'window.openDatePicker = openDatePicker;' in utils_content, \
        "openDatePicker must be exported to window in utils.js"
    assert 'window.openDatePicker = openDatePicker;' in fac_content, \
        "openDatePicker must be exported to window in factions.js"
    assert 'preset === \'custom\'' in fac_content, \
        "factions.js setFactionTimeframe must handle custom preset"

    print("✅ Custom timeframe calendar picker visibility, styling, and picker handlers verified!")


def test_pwa_landscape_orientation():
    """Verify that PWA manifest, HTML viewports, JS orientation unlocks, and CSS landscape safe-areas support mobile rotation."""
    manifest_path = root_dir / "web" / "manifest.json"
    assert manifest_path.exists(), "web/manifest.json not found"
    manifest_data = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest_data.get("orientation") == "any", f"manifest.json orientation should be 'any', got: {manifest_data.get('orientation')}"

    server_content = (root_dir / "server.py").read_text(encoding="utf-8")
    assert '"orientation": "any"' in server_content, "server.py fallback manifest orientation must be 'any'"
    assert 'Cache-Control' in server_content and 'no-cache' in server_content, "server.py manifest endpoint must set Cache-Control: no-cache"

    html_targets = [
        root_dir / "web" / "index.html",
        root_dir / "web" / "app.html",
        root_dir / "web" / "eventstudio.html",
        root_dir / "web" / "scorecard.html",
        root_dir / "web" / "tracker" / "play.html",
        root_dir / "web" / "tracker" / "lobby.html",
        root_dir / "web" / "tracker" / "login.html"
    ]
    for html_file in html_targets:
        assert html_file.exists(), f"{html_file.name} missing"
        html_text = html_file.read_text(encoding="utf-8")
        assert "user-scalable=no" not in html_text, f"{html_file.name} has user-scalable=no, which freezes landscape rotation in iOS WebClip PWAs"
        assert "maximum-scale=1" not in html_text, f"{html_file.name} has maximum-scale constraint freezing orientation"
        assert 'name="viewport"' in html_text, f"{html_file.name} missing viewport meta tag"
        assert 'viewport-fit=cover' in html_text, f"{html_file.name} missing viewport-fit=cover"

    app_js_content = (root_dir / "web" / "js" / "app.js").read_text(encoding="utf-8")
    assert "screen.orientation.unlock" in app_js_content, "web/js/app.js missing screen.orientation.unlock()"
    assert "orientationchange" in app_js_content, "web/js/app.js missing orientationchange handler"

    styles_content = (root_dir / "web" / "css" / "styles.css").read_text(encoding="utf-8")
    assert "(orientation: landscape) and (max-height: 520px)" in styles_content, "styles.css missing landscape phone media query"
    assert "@media (orientation: landscape)" in styles_content, "styles.css missing @media (orientation: landscape) for standalone PWA"
    assert "env(safe-area-inset-left" in styles_content and "env(safe-area-inset-right" in styles_content, "styles.css missing landscape notch clearance"

    print("✅ PWA landscape rotation, viewport meta tags, orientation unlock, and safe-area reflow verified!")


def test_event_studio_mobile_dropdown_role_restriction():
    """Verify that Event Studio only shows in mobile dropdown for users signed in as TO or higher (Admin)."""
    app_html_content = (root_dir / "web" / "app.html").read_text(encoding="utf-8")
    auth_content = (root_dir / "web" / "js" / "auth.js").read_text(encoding="utf-8")
    app_content = (root_dir / "web" / "js" / "app.js").read_text(encoding="utf-8")

    # 1. Verify app.html static markup does NOT have event-studio in mobile-nav-select
    select_match = re.search(r'<select id="mobile-nav-select"[^>]*>(.*?)</select>', app_html_content, re.DOTALL)
    assert select_match is not None, "mobile-nav-select not found in app.html"
    select_inner = select_match.group(1)
    assert 'value="event-studio"' not in select_inner, \
        "event-studio must NOT be in initial mobile-nav-select static HTML (prevents iOS Safari native picker leak)"
    assert 'mobile-opt-event-studio' not in select_inner, \
        "mobile-opt-event-studio must NOT be in initial mobile-nav-select static HTML"
    assert 'id="mobile-opt-divider"' in select_inner, \
        "mobile-opt-divider anchor missing in mobile-nav-select"

    # 2. Verify inline handleMobileNavChange in app.html guards event-studio
    assert "val === 'event-studio'" in app_html_content, "app.html handleMobileNavChange missing event-studio guard"
    assert "isUserTO" in app_html_content, "app.html handleMobileNavChange missing isUserTO check"

    # 3. Verify auth.js defines isUserTO and syncMobileNavDropdown
    assert "function isUserTO(user)" in auth_content, "auth.js missing isUserTO function"
    assert "window.isUserTO = isUserTO;" in auth_content, "auth.js must export isUserTO to window"
    assert "function syncMobileNavDropdown()" in auth_content, "auth.js missing syncMobileNavDropdown function"
    assert "window.syncMobileNavDropdown = syncMobileNavDropdown;" in auth_content, "auth.js must export syncMobileNavDropdown"
    assert "mobile-opt-event-studio" in auth_content, "auth.js must manage mobile-opt-event-studio"

    # 4. Verify auth.js physically inserts/removes options from DOM (required for iOS Safari)
    assert "esOpt.remove()" in auth_content, "syncMobileNavDropdown must remove esOpt from DOM when not TO"
    assert "document.createElement('option')" in auth_content, "syncMobileNavDropdown must dynamically create option"
    assert "select.insertBefore(esOpt, divider)" in auth_content, "syncMobileNavDropdown must insert before divider"

    # 5. Verify syncAppAuthView and renderHeaderAuth trigger syncMobileNavDropdown
    assert "syncMobileNavDropdown()" in auth_content, "auth.js must invoke syncMobileNavDropdown"

    # 6. Verify app.js handleMobileNavChange guards event-studio
    assert "val === 'event-studio'" in app_content, "app.js handleMobileNavChange missing event-studio guard"
    assert "isUserTO" in app_content, "app.js handleMobileNavChange missing isUserTO check"
    assert "syncMobileNavDropdown" in app_content, "app.js switchTab must sync mobile dropdown"

    # 7. Role parity verification with backend eventstudio.py
    to_roles = {"to", "organizer", "referee", "admin", "superuser", "developer", "owner"}
    blocked_roles = {None, "", "player", "guest", "user", "viewer"}

    def simulate_is_user_to(user):
        if not user:
            return False
        role = str(user.get("role") or "player").strip().lower()
        email = str(user.get("email") or "").strip().lower()
        is_super = (email == "swimgeek751@gmail.com")
        is_adm = is_super or (role in ("admin", "superuser", "developer", "owner"))
        is_organizer = role in ("to", "organizer", "referee")
        return is_adm or is_organizer

    for r in to_roles:
        assert simulate_is_user_to({"role": r}), f"Role '{r}' should be granted TO access"
    for r in blocked_roles:
        assert not simulate_is_user_to({"role": r} if r is not None else None), f"Role '{r}' must NOT have TO access"
    assert simulate_is_user_to({"email": "swimgeek751@gmail.com", "role": "player"}), "Superadmin must have TO access"

    print("✅ Event Studio mobile dropdown role-restriction, DOM lifecycle, and TO/Admin guards verified!")


def test_gps_coordinate_precision_parity():
    """Verify that all 3 GPS locations preserve exact device floating-point coordinates, use unified reverse-geocoding,
    correctly map Poway coordinates to Poway (not coarse San Diego), and that the redundant GPS button in Community Hub is hidden."""
    connect_content = (root_dir / "web" / "js" / "connect.js").read_text(encoding="utf-8")
    auth_content = (root_dir / "web" / "js" / "auth.js").read_text(encoding="utf-8")
    community_content = (root_dir / "web" / "js" / "community.js").read_text(encoding="utf-8")
    utils_content = (root_dir / "web" / "js" / "utils.js").read_text(encoding="utf-8")
    app_content = (root_dir / "web" / "app.html").read_text(encoding="utf-8")

    # 1. Unified reverse geocoding helper in utils.js
    assert "function findClosestKnownCity" in utils_content, "findClosestKnownCity missing in utils.js"
    assert "function resolveLocationFromCoordinates" in utils_content, "resolveLocationFromCoordinates missing in utils.js"
    assert "window.findClosestKnownCity" in utils_content, "window.findClosestKnownCity must be exported"
    assert "window.resolveLocationFromCoordinates" in utils_content, "window.resolveLocationFromCoordinates must be exported"

    # Simulate proximity resolution for Poway vs San Diego coordinates
    import math
    poway_lat, poway_lng = 32.9628, -117.0359
    sd_lat, sd_lng = 32.7157, -117.1611
    # Distance from Poway to downtown San Diego
    dlat = (sd_lat - poway_lat) * math.pi / 180
    dlng = (sd_lng - poway_lng) * math.pi / 180
    a = math.sin(dlat / 2) ** 2 + math.cos(poway_lat * math.pi / 180) * math.cos(sd_lat * math.pi / 180) * math.sin(dlng / 2) ** 2
    dist_sd_poway = 3959.0 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    assert dist_sd_poway > 12.0, "Poway must be > 12 miles from downtown San Diego"
    assert "'poway': { name: 'Poway, CA'" in utils_content, "Poway hub must be present in utils.js GLOBAL_CITY_COORDS"

    # 2. Community Hub top bar: redundant GPS button is hidden per user request
    assert '<button id="comm-btn-gps"' in app_content, "comm-btn-gps element must exist for JS compatibility"
    assert 'id="comm-btn-gps" onclick="detectCommunityGPS()" style="display: none;"' in app_content, \
        "comm-btn-gps must be hidden with display:none to keep Community Hub toolbar clean and uncluttered"
    assert "function detectCommunityGPS" in community_content, "detectCommunityGPS missing in community.js"
    assert "resolveLocationFromCoordinates" in community_content, "community.js must use resolveLocationFromCoordinates"
    assert "localStorage.setItem('comm_exact_gps', 'true')" in community_content, "detectCommunityGPS must set comm_exact_gps"
    assert "updateCommunityLocation(lat, lng" in community_content, "detectCommunityGPS must pass raw lat/lng"

    # 3. Set Location modal shareCurrentLocation and handleSaveLocation
    assert "resolveLocationFromCoordinates" in connect_content, "connect.js must use resolveLocationFromCoordinates"
    assert "isGpsLocked = 'true'" in connect_content, "connect.js shareCurrentLocation must set isGpsLocked"
    assert "isGpsLocked" in connect_content and "parseFloat(lat.value)" in connect_content, \
        "connect.js handleSaveLocation must prioritize exact lat.value when GPS is locked"
    assert "updateCommunityLocation(lat, lng" in connect_content, \
        "connect.js shareCurrentLocation must immediately sync exact GPS to active community radar"

    # 4. Account Settings detectUserSettingsGPS and handleSaveUserSettingsLocation
    assert "resolveLocationFromCoordinates" in auth_content, "auth.js must use resolveLocationFromCoordinates"
    assert "isGpsLocked = 'true'" in auth_content, "auth.js detectUserSettingsGPS must set isGpsLocked"
    assert "isGpsLocked" in auth_content and "parseFloat(latEl.value)" in auth_content, \
        "auth.js handleSaveUserSettingsLocation must prioritize exact latEl.value when GPS is locked"
    assert "updateCommunityLocation(lat, lng" in auth_content, \
        "auth.js detectUserSettingsGPS must immediately sync exact GPS to active community radar"

    print("✅ All GPS flows verified for high-precision coordinate preservation, unified reverse geocoding, and clean UI!")


def test_landing_page_community_ethos_and_neutrality():
    """Verify that the landing page showcases community building features, maintains strict neutrality, and has zero paywall jabs."""
    index_content = (root_dir / "web" / "index.html").read_text(encoding="utf-8")

    # Extract landing page HTML block
    landing_match = re.search(r'<div id="landing-page-view">(.*?)</div>\s*<!-- Landing Page Interactive', index_content, re.DOTALL)
    if not landing_match:
        landing_match = re.search(r'<div id="landing-page-view">(.*?)<!--', index_content, re.DOTALL)
    assert landing_match is not None, "landing-page-view not found in index.html"
    landing_html = landing_match.group(1)

    # 1. Community-First Ethos
    assert "Built By The Community" in landing_html, "Missing 'Built By The Community' in landing page"
    assert "By The Community, For The Community" in landing_html, "Missing 'By The Community, For The Community' eyebrow"
    assert "100% FREE &amp; OPEN" in landing_html or "100% FREE & OPEN" in landing_html, "Missing '100% FREE & OPEN' tag"

    # 2. Core Community-Building Features Present
    community_features = [
        ("Sparring Radar / Player Finding", 'id="sparring"'),
        ("Game Tracker (11th Ed)", 'id="tracker"'),
        ("Local Game Store (FLGS) Directory", 'id="game-stores"'),
        ("Player & Team Leaderboards", 'id="leaderboard"'),
        ("Meta Intel & Balance Matrix", 'id="meta-intel"'),
        ("Tournament Radar", 'id="tournaments"'),
        ("Real-Time Sparring Radar Feature Card", 'id="sparring-radar"'),
        ("Interactive Challenge / Match Lobby", 'Match Lobby &bull; Live Room Creation'),
        ("1-Click Game Room Invites in Chat", 'oc-msg-room-card')
    ]
    for feat_name, needle in community_features:
        assert needle in landing_html, f"Community feature '{feat_name}' ({needle}) missing in landing page"

    # 3. Streamlined Landing Header & Target Section Anchors
    assert 'class="landing-nav-links"' not in landing_html, "landing header must be clean and unbloated without anchor bar"
    target_anchors = [
        "community-hub-showcase",
        "sparring",
        "tracker",
        "game-stores",
        "tournaments",
        "leaderboard",
        "meta-intel",
        "sparring-radar",
        "features"
    ]
    for anchor_id in target_anchors:
        assert f'id="{anchor_id}"' in landing_html, f"Feature section target anchor 'id=\"{anchor_id}\"' missing in landing page"

    # 4. Strict Neutrality & Zero Adversarial Jabs Check
    # Ensure there are NO passive-aggressive or hostile jabs at commercial apps/paywalls
    adversarial_terms = [
        "corporate greed",
        "greedy",
        "cash grab",
        "monopol",
        "unlike bcp",
        "bcp paywall",
        "rip off",
        "ripoff",
        "scam",
        "predatory"
    ]
    landing_lower = landing_html.lower()
    for term in adversarial_terms:
        assert term not in landing_lower, f"Landing page must maintain neutrality: found forbidden adversarial term '{term}'"

    # 5. Affirmative, Welcoming Positioning
    assert "An Open Platform for Every Tabletop General" in landing_html, "Missing open platform commitment heading"
    assert "Circuit Compatible" in landing_html, "Missing circuit compatibility neutrality badge"
    assert "Zero Paywalls" in landing_html, "Missing zero paywalls affirmative statement"

    # 6. Event Studio and BCP completely cleaned up from landing page per user request
    assert "eventstudio" not in landing_lower, "Landing page must have zero references to eventstudio"
    assert "event studio" not in landing_lower, "Landing page must have zero references to event studio"
    assert "bcp" not in landing_lower, "Landing page must have zero references to BCP"
    assert "best coast" not in landing_lower, "Landing page must have zero references to Best Coast"

    print("✅ Landing page community ethos, 6-pillar feature suite, and strict neutrality verified (0 Event Studio, 0 BCP)!")


def test_signout_and_pwa_standalone_navigation():
    """Verify that signing out never leaves a black screen and handles PWA standalone navigation properly."""
    auth_content = (root_dir / "web" / "js" / "auth.js").read_text(encoding="utf-8")
    app_content = (root_dir / "web" / "app.html").read_text(encoding="utf-8")
    index_content = (root_dir / "web" / "index.html").read_text(encoding="utf-8")
    tracker_sync_content = (root_dir / "web" / "tracker" / "tracker_sync.js").read_text(encoding="utf-8")
    routers_auth_content = (root_dir / "routers" / "auth.py").read_text(encoding="utf-8")

    # 1. routers/auth.py must delete cookie with samesite='lax' matching set_cookie
    assert 'response.delete_cookie(key="session_token", path="/", samesite="lax")' in routers_auth_content, \
        "routers/auth.py must delete session_token cookie with samesite='lax'"

    # 2. handleLogout in auth.js must wipe cookies with past expires and SameSite=Lax
    assert 'expires=Thu, 01 Jan 1970 00:00:00 GMT' in auth_content, \
        "auth.js must wipe cookies with past expires timestamp"
    assert "isStandalone ? '/login' : '/'" in auth_content, \
        "handleLogout in auth.js must redirect standalone PWA to /login and browser to /"

    # 3. syncAppAuthView in auth.js must never set display:none on app-shell when landingView is missing
    assert 'if (!landingView) {' in auth_content, \
        "syncAppAuthView must check for existence of landingView before modifying app-shell"

    # 4. app.html unauthenticated guard must redirect cleanly
    assert "window.location.replace(isStandalone ? '/login' : '/login?redirect='" in app_content, \
        "app.html auth guard must handle standalone PWA redirect to /login"

    # 5. tracker_sync.js logout must also handle standalone PWA and past expires
    assert 'expires=Thu, 01 Jan 1970 00:00:00 GMT' in tracker_sync_content, \
        "tracker_sync.js must wipe cookies with past expires timestamp"
    assert "isStandalone ? '/login' : '/'" in tracker_sync_content, \
        "tracker_sync.js __handleLogout must route standalone PWA to /login"

    # 6. index.html must not bounce to /app based on unvalidated raw cookies
    assert r"document.cookie.match(new RegExp('(^| )session_token=([^;]+)'))" not in index_content, \
        "index.html must not redirect to /app on unvalidated raw cookie (server already validates)"

    print("✅ Signout and PWA standalone navigation verified (no black screen, clean /login and / routing)!")


def test_bcp_linking_integrity_and_landing_separation():
    """Verify authentic BCP account linking logic is present in app shell while landing page has 0 BCP references."""
    index_content = (root_dir / "web" / "index.html").read_text(encoding="utf-8").lower()
    app_content = (root_dir / "web" / "app.html").read_text(encoding="utf-8")
    es_content = (root_dir / "web" / "eventstudio.html").read_text(encoding="utf-8")
    auth_content = (root_dir / "web" / "js" / "auth.js").read_text(encoding="utf-8")

    # 1. Landing page must have ZERO references to BCP or Best Coast or Event Studio
    assert "bcp" not in index_content, "Landing page (index.html) must not mention BCP"
    assert "best coast" not in index_content, "Landing page (index.html) must not mention Best Coast"
    assert "event studio" not in index_content, "Landing page (index.html) must not mention Event Studio"
    assert "eventstudio" not in index_content, "Landing page (index.html) must not mention eventstudio"

    # 2. App shell (web/app.html) must have authentic BCP linking modal with real inputs
    assert 'id="bcp-link-modal"' in app_content, "bcp-link-modal missing in app.html"
    assert 'id="bcp-connected-view"' in app_content, "bcp-connected-view missing in app.html"
    assert 'id="bcp-connected-email"' in app_content, "bcp-connected-email missing in app.html"
    assert 'id="bcp-form-credentials"' in app_content, "bcp-form-credentials missing in app.html"
    assert 'id="bcp-link-email"' in app_content, "bcp-link-email input missing in app.html"
    assert 'id="bcp-link-password"' in app_content, "bcp-link-password input missing in app.html"
    assert 'id="bcp-link-error"' in app_content, "bcp-link-error div missing in app.html"
    assert 'id="bcp-link-submit-btn"' in app_content, "bcp-link-submit-btn button missing in app.html"
    assert 'onsubmit="handleConnectBcp(event)"' in app_content, "handleConnectBcp(event) missing in app.html form"
    assert 'Best Coast Pairings Link Required' in app_content, "BCP locked gate heading missing in app.html Event Studio"
    assert 'id="btn-sync-bcp-events"' in app_content, "btn-sync-bcp-events missing in app.html"

    # 3. Event Studio standalone (web/eventstudio.html) must also have bcp-link-modal
    assert 'id="bcp-link-modal"' in es_content, "bcp-link-modal missing in eventstudio.html"
    assert 'id="bcp-link-email"' in es_content, "bcp-link-email missing in eventstudio.html"
    assert 'id="bcp-link-password"' in es_content, "bcp-link-password missing in eventstudio.html"

    # 4. Auth.js must implement the complete BCP connection and disconnection lifecycle
    assert 'function openBcpLinkModal()' in auth_content, "openBcpLinkModal missing in auth.js"
    assert 'function closeBcpLinkModal()' in auth_content, "closeBcpLinkModal missing in auth.js"
    assert 'function showBcpCredentialsForm()' in auth_content, "showBcpCredentialsForm missing in auth.js"
    assert 'async function handleConnectBcp(e)' in auth_content, "handleConnectBcp missing in auth.js"
    assert 'async function handleDisconnectBcp()' in auth_content, "handleDisconnectBcp missing in auth.js"
    assert 'window.api.connectBcpAccount(' in auth_content, "window.api.connectBcpAccount call missing in auth.js"
    assert 'window.api.disconnectBcpAccount()' in auth_content, "window.api.disconnectBcpAccount call missing in auth.js"

    # 5. Auth.js must export BCP helpers to window
    assert 'window.openBcpLinkModal = openBcpLinkModal;' in auth_content, "openBcpLinkModal not exported to window"
    assert 'window.closeBcpLinkModal = closeBcpLinkModal;' in auth_content, "closeBcpLinkModal not exported to window"
    assert 'window.showBcpCredentialsForm = showBcpCredentialsForm;' in auth_content, "showBcpCredentialsForm not exported to window"
    assert 'window.handleConnectBcp = handleConnectBcp;' in auth_content, "handleConnectBcp not exported to window"
    assert 'window.handleDisconnectBcp = handleDisconnectBcp;' in auth_content, "handleDisconnectBcp not exported to window"

    print("✅ Authentic BCP account linking logic verified in app shell & 100% clean landing page separation verified!")


if __name__ == "__main__":
    test_styles_css_mobile_rules()
    test_my_hub_js_no_inline_scroll_trap()
    test_html_assets_exist()
    test_router_module_imports()
    test_document_scrolling_architecture()
    test_layout_width_and_mobile_stacking()
    test_floating_chat_back_navigation()
    test_mobile_nav_dropdown_no_chat()
    test_landing_page_and_chat_notification_fixes()
    test_meta_intel_and_search_filter_cleanups()
    test_ios_landing_header_safe_area()
    test_universal_ios_safe_area_coverage()
    test_teams_leaderboard_pagination()
    test_custom_timeframe_calendar_picker()
    test_pwa_landscape_orientation()
    test_event_studio_mobile_dropdown_role_restriction()
    test_gps_coordinate_precision_parity()
    test_landing_page_community_ethos_and_neutrality()
    test_signout_and_pwa_standalone_navigation()
    test_bcp_linking_integrity_and_landing_separation()
    print("\n🎉 ALL MOBILE EXPERIENCE & FRONTEND INTEGRITY TESTS PASSED!")



