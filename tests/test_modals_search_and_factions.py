#!/usr/bin/env python3
"""Tests for Event Modal and Player Modal Search Bars and Faction Displays.

Verifies:
1. Event view pop-up search bar for players/teams/factions.
2. Player view pop-up search bar for players/teams/events/factions.
3. Event view pop-up match pairings display player 1 and player 2 factions.
4. Player view pop-up match history displays opponent faction.
"""

from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT_DIR / "web"
APP_HTML = WEB_DIR / "app.html"
TOURNAMENTS_JS = WEB_DIR / "js" / "tournaments.js"
MODALS_JS = WEB_DIR / "js" / "modals.js"
BUNDLE_JS = WEB_DIR / "js" / "app.bundle.min.js"


def test_event_modal_markup_and_search_bar():
    html = APP_HTML.read_text(encoding="utf-8")
    assert 'id="event-modal-search"' in html, "event-modal-search input missing in app.html"
    assert 'oninput="handleEventModalSearch(this.value)"' in html, "handleEventModalSearch missing on event-modal-search"
    assert 'id="event-modal-search-clear"' in html, "event-modal-search-clear button missing in app.html"
    assert 'id="event-modal-search-summary"' in html, "event-modal-search-summary missing in app.html"
    print("✅ Event modal search bar markup verified in app.html")


def test_player_modal_markup_and_search_bar():
    html = APP_HTML.read_text(encoding="utf-8")
    assert 'id="player-modal-search"' in html, "player-modal-search input missing in app.html"
    assert 'oninput="handlePlayerModalSearch(this.value)"' in html, "handlePlayerModalSearch missing on player-modal-search"
    assert 'id="player-modal-search-clear"' in html, "player-modal-search-clear button missing in app.html"
    assert 'id="player-modal-search-summary"' in html, "player-modal-search-summary missing in app.html"
    assert '<th>Opp Faction</th>' in html, "Opp Faction column header missing in player-matches-table"
    print("✅ Player modal search bar and Opp Faction header verified in app.html")


def test_tournaments_js_search_and_factions():
    js = TOURNAMENTS_JS.read_text(encoding="utf-8")
    assert "handleEventModalSearch" in js, "handleEventModalSearch missing in tournaments.js"
    assert "clearEventModalSearch" in js, "clearEventModalSearch missing in tournaments.js"
    assert "eventModalSearchQuery" in js, "eventModalSearchQuery missing in tournaments.js"

    # Verify event pairings show player 1 faction and player 2 faction
    assert "p1Faction" in js, "p1Faction missing in renderEventPairingsRows"
    assert "p2Faction" in js, "p2Faction missing in renderEventPairingsRows"

    # Verify search filters against player, faction, and team
    assert "p1Name.includes(eventModalSearchQuery)" in js, "Search query does not check player name"
    assert "p1Fac.includes(eventModalSearchQuery)" in js, "Search query does not check faction"
    assert "p1Team.includes(eventModalSearchQuery)" in js, "Search query does not check team"
    print("✅ tournaments.js search logic and match player factions verified")


def test_modals_js_search_and_factions():
    js = MODALS_JS.read_text(encoding="utf-8")
    assert "handlePlayerModalSearch" in js, "handlePlayerModalSearch missing in modals.js"
    assert "clearPlayerModalSearch" in js, "clearPlayerModalSearch missing in modals.js"
    assert "playerModalSearchQuery" in js, "playerModalSearchQuery missing in modals.js"

    # Verify player matches show opponent's faction
    assert "h.opponent_faction" in js, "h.opponent_faction missing in renderPlayerMatches"

    # Verify search filters against opponent name, event name, and factions
    assert "oppName.includes(playerModalSearchQuery)" in js, "Player search does not filter opponent name"
    assert "evName.includes(playerModalSearchQuery)" in js, "Player search does not filter event name"
    assert "oppFac.includes(playerModalSearchQuery)" in js, "Player search does not filter opponent faction"
    print("✅ modals.js search logic and opponent faction verified")


def test_minified_bundle_contains_features():
    bundle = BUNDLE_JS.read_text(encoding="utf-8")
    assert "handleEventModalSearch" in bundle, "handleEventModalSearch missing in app.bundle.min.js"
    assert "handlePlayerModalSearch" in bundle, "handlePlayerModalSearch missing in app.bundle.min.js"
    assert "opponent_faction" in bundle, "opponent_faction missing in app.bundle.min.js"
    print("✅ app.bundle.min.js includes all modal search and faction features")


if __name__ == "__main__":
    test_event_modal_markup_and_search_bar()
    test_player_modal_markup_and_search_bar()
    test_tournaments_js_search_and_factions()
    test_modals_js_search_and_factions()
    test_minified_bundle_contains_features()
    print("\n🎉 ALL MODAL SEARCH & FACTION DISPLAY TESTS PASSED!")
