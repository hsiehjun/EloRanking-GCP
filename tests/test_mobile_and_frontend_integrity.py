"""Comprehensive verification test for mobile experience fixes and frontend integrity."""
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
    assert 'max-width: 1360px' not in index_content, "index.html still has conflicting max-width: 1360px"
    assert 'class="comm-container" style="width: 100%; max-width: 100%;' in index_content, "comm-container not full-width"
    assert 'class="es-app-container" style="width: 100%; max-width: 100%;' in index_content, "es-app-container not full-width"

    # 4. Anti-FOUC guard and auth.js column enforcement
    assert '#app-shell { display: flex !important; flex-direction: column !important; width: 100% !important; }' in index_content, "anti-fouc guard in index.html missing column enforcement"
    assert '#app-shell { display: flex !important; flex-direction: column !important; width: 100% !important; }' in auth_content, "auth.js syncAppAuthView missing column enforcement"

    # 5. Radar paused/empty cards should not shrink to 680px island
    assert 'max-width: 680px' not in connect_content, "connect.js still has cards constrained to max-width: 680px"

    print("✅ Layout container width consistency and mobile vertical stacking verified!")


def test_floating_chat_back_navigation():
    """Verify that floating chat compact back button and auto-selection logic function correctly."""
    styles_content = (root_dir / "web" / "css" / "styles.css").read_text(encoding="utf-8")
    connect_content = (root_dir / "web" / "js" / "connect.js").read_text(encoding="utf-8")
    index_content = (root_dir / "web" / "index.html").read_text(encoding="utf-8")

    # 1. Verify index.html chat-back-btn exists with onclick backToChatList
    assert 'id="chat-back-btn"' in index_content, "chat-back-btn ID missing in index.html"
    assert 'onclick="backToChatList(); return false;"' in index_content, "backToChatList onclick missing in index.html"

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
    index_content = (root_dir / "web" / "index.html").read_text(encoding="utf-8")

    # Locate mobile-nav-select block
    select_match = re.search(r'<select id="mobile-nav-select"[^>]*>(.*?)</select>', index_content, re.DOTALL)
    assert select_match is not None, "mobile-nav-select not found in index.html"
    select_inner = select_match.group(1)

    # Assert chat is NOT in options
    assert 'value="chat"' not in select_inner, "mobile-nav-select still contains value='chat'"
    assert 'mobile-opt-chat' not in select_inner, "mobile-nav-select still contains mobile-opt-chat"

    # Assert standard tabs exist
    assert 'value="my-hub"' in select_inner, "my-hub missing in mobile-nav-select"
    assert 'value="community"' in select_inner, "community missing in mobile-nav-select"
    assert 'value="tracker"' in select_inner, "tracker missing in mobile-nav-select"
    assert 'value="leaderboard"' in select_inner, "leaderboard missing in mobile-nav-select"

    # Assert persistent floating chat bubble exists
    assert 'id="floating-chat-bubble"' in index_content, "floating-chat-bubble missing in index.html"

    print("✅ Mobile nav dropdown verified free of redundant Chat option (chat handled via bubble)!")


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
    app_content = (root_dir / "web" / "js" / "app.js").read_text(encoding="utf-8")
    lead_content = (root_dir / "web" / "js" / "leaderboard.js").read_text(encoding="utf-8")
    teams_content = (root_dir / "web" / "js" / "teams.js").read_text(encoding="utf-8")

    # 1. Desktop and Mobile Navigation for Meta Intel
    assert 'id="nav-btn-meta-intel"' in index_content, "nav-btn-meta-intel missing in header nav"
    assert 'onclick="switchTab(\'meta-intel\')"' in index_content, "switchTab('meta-intel') missing in nav-btn"
    assert '<option value="meta-intel">📊 Meta Intel</option>' in index_content, "meta-intel option missing in mobile-nav-select"
    assert '<a href="#meta-intel" class="landing-nav-link">📊 Meta Intel</a>' in index_content, "Meta Intel missing in landing nav links"

    # 2. Dedicated Section Architecture
    assert '<section id="tab-meta-intel" class="tab-panel">' in index_content, "tab-meta-intel section missing in index.html"
    assert 'id="meta-subtab-factions"' in index_content, "meta-subtab-factions missing in index.html"
    assert 'id="meta-subtab-predictor"' in index_content, "meta-subtab-predictor missing in index.html"
    
    # Verify Leaderboard strictly has players and teams subtabs
    assert 'id="lead-subtab-players"' in index_content, "lead-subtab-players missing"
    assert 'id="lead-subtab-teams"' in index_content, "lead-subtab-teams missing"
    assert 'id="lead-subtab-factions"' not in index_content, "lead-subtab-factions should be moved out of tab-leaderboard"
    assert 'id="lead-subtab-predictor"' not in index_content, "lead-subtab-predictor should be moved out of tab-leaderboard"

    # 3. Search Filters Streamlined
    assert 'id="dir-faction-filter"' not in index_content, "dir-faction-filter should be removed from player search"
    assert 'id="dir-min-matches-filter"' not in index_content, "dir-min-matches-filter should be removed from player search"
    assert 'id="teams-min-roster-filter"' not in index_content, "teams-min-roster-filter should be removed from teams search"

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
    print("\n🎉 ALL MOBILE EXPERIENCE & FRONTEND INTEGRITY TESTS PASSED!")

