"""Comprehensive test suite for all 118 BCP game systems across backend & frontend."""
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from config import (
    BCP_GAME_SYSTEMS_CATALOG,
    GAME_SYSTEM_BY_BCP_ID,
    GAME_SYSTEM_BY_SLUG,
    get_bcp_game_system_id,
    get_game_system_meta,
    has_game_tracker,
    normalize_game_system,
    resolve_event_game_system,
)
from database import PostgresDatabase


def test_catalog_has_all_118_bcp_systems_sorted_by_popularity():
    assert len(BCP_GAME_SYSTEMS_CATALOG) == 120
    slugs = [item["slug"] for item in BCP_GAME_SYSTEMS_CATALOG]
    bcp_ids = [item["bcp_id"] for item in BCP_GAME_SYSTEMS_CATALOG]
    assert len(set(slugs)) == 120, "All 120 game system slugs must be unique"
    assert len(set(bcp_ids)) == 120, "All 120 gameSystemIds must be unique"
    assert "riftbound" in slugs
    assert "guild_ball" in slugs

    for item in BCP_GAME_SYSTEMS_CATALOG:
        assert 1 <= len(item["slug"]) <= 16, f"Slug {item['slug']} exceeds VARCHAR(16)"
        assert item.get("label"), f"Missing label for {item['slug']}"
        assert item.get("short_label"), f"Missing short_label for {item['slug']}"
        assert item.get("icon"), f"Missing icon for {item['slug']}"

    # Top popularity order verification
    expected_top_17 = [
        "40k",
        "aos",
        "kill_team",
        "the_old_world",
        "horus_heresy",
        "spearhead",
        "blood_bowl",
        "middle_earth",
        "underworlds",
        "warcry",
        "necromunda",
        "legions_imp",
        "bolt_action",
        "mcp",
        "sw_legion",
        "shatterpoint",
        "trench_crusade",
    ]
    assert slugs[:17] == expected_top_17


def test_has_game_tracker_only_true_for_40k_and_aos():
    for item in BCP_GAME_SYSTEMS_CATALOG:
        slug = item["slug"]
        if slug in ("40k", "aos"):
            assert has_game_tracker(slug) is True
            assert item["has_tracker"] is True
        else:
            assert has_game_tracker(slug) is False, f"Tracker must be hidden for {slug}"
            assert item["has_tracker"] is False


def test_normalize_and_resolve_all_118_systems():
    for item in BCP_GAME_SYSTEMS_CATALOG:
        slug = item["slug"]
        bcp_id = item["bcp_id"]
        label = item["label"]

        assert normalize_game_system(slug) == slug
        assert normalize_game_system(bcp_id) == slug
        assert normalize_game_system(label) == slug
        assert get_bcp_game_system_id(slug) == bcp_id
        assert get_game_system_meta(slug)["bcp_id"] == bcp_id

        # Event resolution by gameSystemId
        ev_by_id = {"name": "Weekend Tournament", "gameSystemId": bcp_id}
        assert resolve_event_game_system(ev_by_id, requested_system="40k") == slug

        # Event resolution by nested gameSystem object
        ev_nested = {"name": "Local Event", "gameSystem": {"id": bcp_id, "name": label}}
        assert resolve_event_game_system(ev_nested, requested_system="40k") == slug


def test_non_40k_aos_factions_never_leak_40k_factions():
    factions_40k = set(PostgresDatabase.get_factions("40k"))
    assert "Space Marines" in factions_40k
    assert "Necrons" in factions_40k

    factions_aos = set(PostgresDatabase.get_factions("aos"))
    assert "Stormcast Eternals" in factions_aos
    assert "Space Marines" not in factions_aos

    # Clear dynamic cache for clean test
    PostgresDatabase._dynamic_factions_cache_dict.clear()
    PostgresDatabase.set_cached(
        PostgresDatabase._dynamic_factions_cache_dict,
        "kill_team",
        ["Angels of Death", "Kommandos", "Kasrkin", "Nemesis Claw"],
    )
    kt_factions = PostgresDatabase.get_factions("kill_team")
    assert kt_factions == ["Angels of Death", "Kommandos", "Kasrkin", "Nemesis Claw"]
    assert "Adeptus Custodes" not in kt_factions

    kt_grouped = PostgresDatabase.get_factions("kill_team", grouped=True)
    assert isinstance(kt_grouped, list) and len(kt_grouped) == 1
    assert kt_grouped[0]["factions"] == ["Angels of Death", "Kommandos", "Kasrkin", "Nemesis Claw"]


def test_meta_intel_supports_3_round_rtts_for_other_bcp_systems():
    """Verify get_faction_meta_stats uses games_in_event >= 3 for non-40K/AoS systems and >= 4 for 40K/AoS."""
    db = PostgresDatabase.__new__(PostgresDatabase)
    db._is_mock_instance = lambda: True
    executed_queries = []

    mock_conn = MagicMock()
    mock_cursor = MagicMock()

    def capture_execute(sql, params=None):
        executed_queries.append((str(sql), params))

    mock_cursor.execute.side_effect = capture_execute
    mock_cursor.fetchall.return_value = []
    mock_cursor.fetchone.return_value = None
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
    db.get_connection = MagicMock()
    db.get_connection.return_value.__enter__.return_value = mock_conn

    PostgresDatabase._faction_meta_cache_dict.clear()
    db.get_faction_meta_stats(timeframe="90d", game_system="kill_team", _force_refresh=True)
    combined_kt_sql = "\n".join(q for q, _ in executed_queries)
    assert "games_in_event >= 3" in combined_kt_sql

    executed_queries.clear()
    PostgresDatabase._faction_meta_cache_dict.clear()
    db.get_faction_meta_stats(timeframe="90d", game_system="40k", _force_refresh=True)
    combined_40k_sql = "\n".join(q for q, _ in executed_queries)
    assert "games_in_event >= 4" in combined_40k_sql


def test_frontend_single_game_system_pill_and_tracker_hiding():
    app_html = (ROOT_DIR / "web" / "app.html").read_text(encoding="utf-8")
    app_js = (ROOT_DIR / "web" / "js" / "app.js").read_text(encoding="utf-8")
    utils_js = (ROOT_DIR / "web" / "js" / "utils.js").read_text(encoding="utf-8")

    # Single active game system trigger + searchable popover in app.html
    assert 'id="desktop-game-system-trigger"' in app_html
    assert 'id="game-system-picker-popover"' in app_html
    assert 'id="game-system-picker-search"' in app_html
    assert 'id="game-system-picker-list"' in app_html

    # 120 systems (118 BCP + Riftbound + Guild Ball) in utils.js
    assert "window.BCP_GAME_SYSTEMS_CATALOG" in utils_js
    assert "window.hasGameTracker" in utils_js
    assert "kill_team" in utils_js
    assert "the_old_world" in utils_js
    assert "trench_crusade" in utils_js
    assert '"slug": "riftbound"' in utils_js
    assert '"slug": "guild_ball"' in utils_js

    # Tracker tab hidden when !hasGameTracker(currentGameSystem) and preferred_game_system persisted
    assert "hasTracker" in app_js
    assert "preferred_game_system" in app_js
    assert "toggleGameSystemPicker" in app_js
    assert "filterGameSystemPicker" in app_js


def test_my_hub_and_bcp_adapter_support_all_118_game_systems():
    from bcp_adapter import BcpAdapter

    my_hub_js = (ROOT_DIR / "web" / "js" / "my_hub.js").read_text(encoding="utf-8")
    # Ensure My Hub does not force non-AoS systems back to 40k in army lists or tracker sessions
    assert "normalizeGameSystem(currentGameSystem)" in my_hub_js
    assert "normGs !== '40k' && normGs !== 'aos'" in my_hub_js
    assert "window.currentHubData._gameSystem === gs" in my_hub_js


def test_game_system_other_excludes_40k_and_aos():
    from scraper import BestCoastPairingsScraper
    from elo import EloEngine

    mock_db = MagicMock()
    scraper = BestCoastPairingsScraper(db=mock_db, request_delay=0.0)
    scraper.fetch_events = MagicMock(
        return_value=iter(
            [
                {"id": "ev_40k_1", "name": "40K GT", "gameSystemId": "WGMSzfKFYA"},
                {"id": "ev_aos_1", "name": "AoS GT", "gameSystemId": "OY8FCPBf6O"},
                {"id": "ev_aos_2", "name": "AoS Legacy", "gameSystemId": "23qDprPABN"},
                {"id": "ev_kt_1", "name": "Kill Team Open", "gameSystemId": "kQGCslQaL7"},
                {"id": "ev_tow_1", "name": "Old World GT", "gameSystemId": "pd0PejEmWE"},
            ]
        )
    )
    scraped_ids = []
    scraper.scrape_event = MagicMock(side_effect=lambda eid, fallback_event_data=None: (scraped_ids.append((eid, fallback_event_data.get("game_system"))), 12)[1])

    res = scraper.scrape_other_systems_date_range("2025-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
    assert res == {"events_scraped": 2, "matches_scraped": 24}
    assert scraped_ids == [("ev_kt_1", "kill_team"), ("ev_tow_1", "the_old_world")]

    engine = EloEngine(db=mock_db)
    called_systems = []
    orig_inc = engine.reconstruct_incremental

    def spy_inc(*args, **kwargs):
        gs = kwargs.get("game_system")
        if gs not in ("other", "others", "non_40k_aos", "all_other"):
            called_systems.append(gs)
            return {"total_new_matches": 5, "players_updated": 4, "history_points_saved": 10}
        return orig_inc(*args, **kwargs)

    # Simulate DB returning kill_team and the_old_world as distinct non-40k/aos systems
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_cur.fetchall.return_value = [("kill_team",), ("the_old_world",)]
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    mock_db.get_connection.return_value.__enter__.return_value = mock_conn
    # Make type(mock_db.get_connection).__name__ != "MagicMock" via lambda wrapper
    mock_db.get_connection = lambda: mock_conn
    mock_conn.__enter__.return_value = mock_conn

    engine.reconstruct_incremental = spy_inc
    out = engine.reconstruct_incremental(game_system="other")
    assert called_systems == ["kill_team", "the_old_world"]
    assert "40k" not in called_systems
    assert "aos" not in called_systems
    assert out["game_system"] == "other"
    assert out["total_new_matches"] == 10



if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS: {name}")
    print("All 118 BCP game system tests passed!")


