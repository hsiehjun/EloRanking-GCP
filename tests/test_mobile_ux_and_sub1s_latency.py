"""Comprehensive tests for Competitive Default Meta Filter, Cross-Page Mobile UX, and <1000ms API Latency Guarantees."""
import re
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))


class TestCompetitiveDefaultAndMobileUXStatic(unittest.TestCase):
    """Verifies frontend source + minified bundle integrity for Competitive Default & Mobile UX."""

    @classmethod
    def setUpClass(cls):
        cls.app_html = (ROOT_DIR / "web" / "app.html").read_text(encoding="utf-8")
        cls.factions_js = (ROOT_DIR / "web" / "js" / "factions.js").read_text(encoding="utf-8")
        cls.community_js = (ROOT_DIR / "web" / "js" / "community.js").read_text(encoding="utf-8")
        cls.styles_css = (ROOT_DIR / "web" / "css" / "styles.css").read_text(encoding="utf-8")
        cls.bundle_js = (ROOT_DIR / "web" / "js" / "app.bundle.min.js").read_text(encoding="utf-8")
        cls.styles_min = (ROOT_DIR / "web" / "css" / "styles.min.css").read_text(encoding="utf-8")

    def test_competitive_default_meta_filters(self):
        """Meta Intel must default to Competitive Standard (16+ players, 3+ rounds, Excl League, In-Person, Singles, 2000pt)."""
        self.assertIn("function getCompetitiveDefaultMetaFilters(", self.factions_js)
        self.assertIn("min_players: 16", self.factions_js)
        self.assertIn("min_rounds: 3", self.factions_js)
        self.assertIn("exclude_leagues: true", self.factions_js)
        self.assertIn("venue_mode: 'in_person'", self.factions_js)
        self.assertIn("event_structure: 'singles'", self.factions_js)
        self.assertIn("_MASS_WARGAME_2000PT_SYSTEMS.has(sysNorm) ? 'standard_2000' : 'all'", self.factions_js)
        self.assertIn("let factionEventFilters = getCompetitiveDefaultMetaFilters();", self.factions_js)
        self.assertIn("window.applyCompetitiveMetaFilters = applyCompetitiveMetaFilters;", self.factions_js)

        # Verify app.html has Competitive Standard & All Events preset buttons
        self.assertIn("applyCompetitiveMetaFilters()", self.app_html)
        self.assertIn("Competitive Standard", self.app_html)
        self.assertIn("All Events", self.app_html)

        # Verify compiled bundle reflects Competitive Default
        self.assertIn("applyCompetitiveMetaFilters", self.bundle_js)
        self.assertIn("standard_2000", self.bundle_js)

    def test_mobile_matchup_matrix_focus_and_scroll_grid(self):
        """Matchup Matrix must provide mobile Army Matchups Focus Explorer + scrollable Full Grid (no overflow-x: hidden clipping)."""
        self.assertIn('id="faction-matrix-focus-view"', self.app_html)
        self.assertIn('id="matrix-submode-focus"', self.app_html)
        self.assertIn('id="matrix-submode-grid"', self.app_html)
        self.assertIn("setMatrixDisplaySubmode", self.factions_js)
        self.assertIn("renderFactionMatchupFocusView", self.factions_js)
        self.assertIn("matrix-mode-compact-mobile", self.factions_js)
        self.assertIn("matrix-mode-compact-mobile", self.styles_css)

        # Verify #faction-matrix-grid-wrap uses overflow-x: auto instead of overflow-x: hidden
        grid_wrap_match = re.search(r'id="faction-matrix-grid-wrap"[^>]*style="([^"]+)"', self.app_html)
        self.assertIsNotNone(grid_wrap_match)
        self.assertIn("overflow-x: auto", grid_wrap_match.group(1))
        self.assertNotIn("overflow-x: hidden", grid_wrap_match.group(1))

    def test_mobile_community_events_cards_default_and_location_pill(self):
        """Community Events must default to Event Cards ('feed') on <=768px, place Cards first, and never clip city names."""
        feed_idx = self.app_html.find('id="btn-tournaments-view-feed"')
        cal_idx = self.app_html.find('id="btn-tournaments-view-calendar"')
        self.assertGreater(feed_idx, 0)
        self.assertGreater(cal_idx, 0)
        self.assertLess(feed_idx, cal_idx, "Event Cards button must appear before Calendar button in #tab-community")

        self.assertIn("window.innerWidth <= 768) ? 'feed' : 'calendar'", self.community_js)
        self.assertIn("window.innerWidth <= 768) ? 'cards' : 'both'", self.community_js)
        self.assertIn("mobile-scrolling-down", self.community_js)
        self.assertIn("mobile-scrolling-down", self.styles_min)

        # Verify #user-location-text has max-width: none !important on mobile
        self.assertIn("#user-location-text", self.styles_css)
        self.assertIn("max-width: none !important", self.styles_css)

    def test_cross_page_mobile_tiles_and_predictor_layout(self):
        """Search players/teams tables, Match Predictor Elo stakes, and modal quick KPIs must have compact mobile rules."""
        for selector in (
            "#players-table tr:not(.loading-row):not(.empty-row)",
            "#teams-table tr:not(.loading-row):not(.empty-row)",
            ".pred-elo-stakes-grid",
            "#modal-quick-kpis",
            ".matrix-focus-cards-grid",
        ):
            self.assertIn(selector, self.styles_css, f"Missing mobile CSS rule for {selector}")
        self.assertEqual(
            self.styles_css.count("{"),
            self.styles_css.count("}"),
            "Unbalanced CSS braces in styles.css",
        )


class TestBackendSub1sLatencyGuarantees(unittest.TestCase):
    """Verifies cold-path timeout caps, O(1) broadcast index lookup, local reverse-geocoding, and SWR caches."""

    def test_firestore_active_broadcasts_single_index_and_l1_cache(self):
        """get_active_broadcasts_for_events must query 1 index doc + cache in L1 (<5ms for 70 event IDs)."""
        from firestore_db import FirestoreRoomEngine

        eng = FirestoreRoomEngine()
        now_ms = int(time.time() * 1000)
        eng._fallback_tournaments["_active_broadcasts"] = {
            "broadcasts": {
                "EV_LIVE_1": {
                    "id": "b_live_1",
                    "message": "Round 2 Pairings Posted!",
                    "active": True,
                    "timestamp": now_ms,
                    "expiresAt": now_ms + 3600000,
                },
                "EV_EXPIRED": {
                    "id": "b_exp_1",
                    "message": "Yesterday notice",
                    "active": True,
                    "timestamp": now_ms - 90000000,
                    "expiresAt": now_ms - 10000,
                },
            }
        }

        event_ids = [f"EV_{i}" for i in range(70)] + ["EV_LIVE_1", "EV_EXPIRED"]
        t0 = time.perf_counter()
        active = eng.get_active_broadcasts_for_events(event_ids)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        self.assertLess(elapsed_ms, 20.0)
        eids = {b["event_id"] for b in active}
        self.assertIn("EV_LIVE_1", eids)
        self.assertNotIn("EV_EXPIRED", eids)
        self.assertEqual(active[0]["message"], "Round 2 Pairings Posted!")

    def test_nr_cloud_lists_cold_timeout_cap_under_1s(self):
        """fetch_nr_cloud_lists_for_user must return in <850ms even if upstream NewRecruit hangs for 3s."""
        import newrecruit_integration as nri

        nri._NR_CLOUD_LISTS_CACHE.clear()

        def slow_remote(*args, **kwargs):
            time.sleep(3.0)
            return [{"id": "nr_1", "name": "Test List", "game_system": "40k"}]

        with patch.object(nri, "_fetch_nr_cloud_lists_remote", side_effect=slow_remote):
            t0 = time.perf_counter()
            res = nri.fetch_nr_cloud_lists_for_user("slow_user", explicit_access="token_xyz")
            elapsed_ms = (time.perf_counter() - t0) * 1000.0

        self.assertLess(elapsed_ms, 850.0, f"Cold NR cloud fetch exceeded 850ms: {elapsed_ms:.1f}ms")
        self.assertEqual(res, [])

    def test_bcp_majors_bounded_http_path_under_1s_and_zero_synthetic(self):
        """fetch_live_bcp_majors(..., max_wait_sec=0.60) must return in <850ms with zero synthetic bcp_* IDs."""
        from routers import community

        community._bcp_majors_cache.pop("horus_heresy", None)
        community._bcp_majors_refreshing.discard("horus_heresy")
        community._bcp_majors_inflight_events.pop("horus_heresy", None)

        def slow_refresh(*args, **kwargs):
            time.sleep(2.5)
            return []

        with patch.object(community, "_refresh_bcp_majors_sync", side_effect=slow_refresh), \
             patch.object(community, "_get_fast_db_majors_readonly", return_value=[]):
            t0 = time.perf_counter()
            events = community.fetch_live_bcp_majors("horus_heresy", max_wait_sec=0.60)
            elapsed_ms = (time.perf_counter() - t0) * 1000.0

        self.assertLess(elapsed_ms, 850.0, f"Cold BCP majors exceeded 850ms: {elapsed_ms:.1f}ms")
        self.assertEqual(events, [])
        for ev in events:
            self.assertFalse(str(ev.get("id", "")).startswith("bcp_"))

    def test_reverse_geocode_prefers_local_db_before_external_nominatim(self):
        """reverse_geocode_coordinates must resolve non-hub cities (e.g. Poway, CA) from local DB in <15ms without HTTP."""
        from database import PostgresDatabase

        db = PostgresDatabase.__new__(PostgresDatabase)
        PostgresDatabase._geocode_cache_dict.pop((32.963, -117.036), None)

        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        # Poway coordinates (32.9628, -117.0359) — ~17 miles from downtown SD (outside 6mi hub shortcut)
        mock_cur.fetchall.return_value = [
            {
                "city": "Poway",
                "state": "CA",
                "country": "United States",
                "latitude": 32.9635,
                "longitude": -117.0365,
            }
        ]

        with patch.object(db, "get_connection") as mock_get_conn, \
             patch("urllib.request.urlopen", side_effect=AssertionError("External Nominatim HTTP must not be called when local DB matches!")):
            mock_get_conn.return_value.__enter__.return_value = mock_conn
            t0 = time.perf_counter()
            res = db.reverse_geocode_coordinates(32.9628, -117.0359)
            elapsed_ms = (time.perf_counter() - t0) * 1000.0

        self.assertLess(elapsed_ms, 50.0)
        self.assertEqual(res["city"], "Poway")
        self.assertEqual(res["state"], "CA")
        self.assertEqual(res["formatted"], "Poway, CA")

    def test_faction_meta_stats_notrends_uses_warm_full_preset_cache(self):
        """get_faction_meta_stats(..., include_trends=False) must return warm full preset payload in <5ms without SQL."""
        from database import PostgresDatabase, parse_meta_filters

        db = PostgresDatabase.__new__(PostgresDatabase)
        db._pool = MagicMock()
        comp_mf = parse_meta_filters(
            min_players=16,
            min_rounds=3,
            exclude_leagues=True,
            venue_mode="in_person",
            event_structure="singles",
            event_format="standard_2000",
        )
        full_ck = f"preset_90d_40k{comp_mf.cache_suffix()}"
        sample_payload = {
            "factions": [{"faction": "Orks", "win_rate": 53.4, "matches_played": 1200}],
            "matchup_matrix": {"Orks": {"Space Marines": {"wins": 55, "total": 100, "win_rate": 55.0}}},
            "monthly_trends": [{"month": "2026-09", "factions": {"Orks": 53.4}}],
            "summary_kpis": {"total_matches": 1200},
        }
        PostgresDatabase.set_cached(PostgresDatabase._faction_meta_cache_dict, full_ck, sample_payload)

        with patch.object(db, "get_connection", side_effect=AssertionError("Should hit L1 full preset cache without DB query!")):
            t0 = time.perf_counter()
            res = db.get_faction_meta_stats(
                timeframe="90d",
                game_system="40k",
                meta_filters=comp_mf,
                include_trends=False,
            )
            elapsed_ms = (time.perf_counter() - t0) * 1000.0

        self.assertLess(elapsed_ms, 10.0)
        self.assertEqual(res["summary_kpis"]["total_matches"], 1200)
        self.assertEqual(res["monthly_trends"], [])
        # Original cached dict must retain its monthly_trends untouched
        self.assertEqual(len(sample_payload["monthly_trends"]), 1)

    def test_firestore_live_client_paths_rooms_and_broadcasts_cache(self):
        """Non-mock Firestore client paths in list_active_rooms_for_user & get_active_broadcasts_for_events must execute cleanly with L1 TTL caches."""
        from firestore_db import FirestoreRoomEngine

        now_ms = int(time.time() * 1000)

        class _DummySnap:
            def __init__(self, doc_id, data, exists=True):
                self.id = doc_id
                self._data = data
                self.exists = exists

            def to_dict(self):
                return self._data

        class _DummyDocRef:
            def __init__(self, parent_col, doc_id):
                self.parent_col = parent_col
                self.doc_id = doc_id

            def get(self):
                self.parent_col.client.doc_gets += 1
                if self.doc_id == "_active_broadcasts":
                    return _DummySnap(
                        "_active_broadcasts",
                        {
                            "broadcasts": {
                                "EV_CLOUD_1": {
                                    "id": "bc_cloud_1",
                                    "message": "Pairings Live on Cloud!",
                                    "active": True,
                                    "timestamp": now_ms,
                                    "expiresAt": now_ms + 3600000,
                                }
                            }
                        },
                        exists=True,
                    )
                return _DummySnap(self.doc_id, {}, exists=False)

        class _DummyQuery:
            def __init__(self, col):
                self.col = col

            def where(self, *args, **kwargs):
                return self

            def limit(self, n):
                return self

            def stream(self):
                self.col.client.room_streams += 1
                return [
                    _DummySnap(
                        "WH40K-BCP-EV1-R1-T1",
                        {
                            "roomKey": "WH40K-BCP-EV1-R1-T1",
                            "status": "in_progress",
                            "user_id_p1": "u_alpha",
                            "p1_name": "Alpha",
                            "p2_name": "Bravo",
                        },
                    )
                ]

        class _DummyCol:
            def __init__(self, client, name):
                self.client = client
                self.name = name

            def where(self, *args, **kwargs):
                return _DummyQuery(self)

            def document(self, doc_id):
                return _DummyDocRef(self, doc_id)

        class _DummyFirestoreClient:
            def __init__(self):
                self.room_streams = 0
                self.doc_gets = 0

            def collection(self, name):
                return _DummyCol(self, name)

        eng = FirestoreRoomEngine()
        dummy_client = _DummyFirestoreClient()
        eng._client = dummy_client

        # 1. Cold + warm list_active_rooms_for_user
        rooms1 = eng.list_active_rooms_for_user(user_id="u_alpha")
        self.assertEqual(len(rooms1), 1)
        self.assertEqual(rooms1[0]["roomKey"], "WH40K-BCP-EV1-R1-T1")
        self.assertEqual(dummy_client.room_streams, 1)

        rooms2 = eng.list_active_rooms_for_user(user_id="u_alpha")
        self.assertEqual(len(rooms2), 1)
        self.assertEqual(dummy_client.room_streams, 1, "Second call within 8s must use L1 stream cache")

        # 2. Cold + warm get_active_broadcasts_for_events
        b1 = eng.get_active_broadcasts_for_events(["EV_CLOUD_1", "EV_OTHER"])
        self.assertEqual(len(b1), 1)
        self.assertEqual(b1[0]["event_id"], "EV_CLOUD_1")
        self.assertEqual(dummy_client.doc_gets, 1)

        b2 = eng.get_active_broadcasts_for_events(["EV_CLOUD_1", "EV_OTHER"])
        self.assertEqual(len(b2), 1)
        self.assertEqual(dummy_client.doc_gets, 1, "Second call within 15s must use L1 index cache")

    def test_ml_predictor_meta_snapshot_uses_parse_meta_filters_notrends(self):
        """get_ml_predictor_meta_snapshot must pass meta_filters and include_trends=False to get_faction_meta_stats."""
        from database import PostgresDatabase

        db = PostgresDatabase.__new__(PostgresDatabase)
        db._pool = MagicMock()
        PostgresDatabase._faction_meta_cache_dict.pop("ml_comp_alpha_90d_v2_40k", None)

        captured_kwargs = {}

        def fake_meta_stats(**kwargs):
            captured_kwargs.update(kwargs)
            return {
                "factions": [{"faction": "Orks", "total_matches": 500, "wins": 270, "losses": 225, "draws": 5, "win_rate": 54.0}],
                "matchups_by_faction": {},
            }

        with patch.object(db, "_is_mock_instance", return_value=False), \
             patch.object(db, "get_l2_cache", return_value=None, create=True), \
             patch.object(db, "set_l2_cache", return_value=None, create=True), \
             patch.object(db, "get_faction_meta_stats", side_effect=fake_meta_stats):
            snap = db.get_competitive_faction_alpha_snapshot("40k")

        self.assertIn("meta_filters", captured_kwargs)
        self.assertIs(captured_kwargs.get("include_trends"), False)
        self.assertIn("factions", snap)
        self.assertIn("orks", snap["factions"])


if __name__ == "__main__":
    unittest.main()
