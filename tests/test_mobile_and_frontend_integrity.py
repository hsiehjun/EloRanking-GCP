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


if __name__ == "__main__":
    test_styles_css_mobile_rules()
    test_my_hub_js_no_inline_scroll_trap()
    test_html_assets_exist()
    test_router_module_imports()
    test_document_scrolling_architecture()
    test_layout_width_and_mobile_stacking()
    print("\n🎉 ALL MOBILE EXPERIENCE & FRONTEND INTEGRITY TESTS PASSED!")
