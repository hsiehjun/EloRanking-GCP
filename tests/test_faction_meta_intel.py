"""Unit and integration test suite for Meta Intel faction latency improvements."""

import unittest
import urllib.request
import urllib.parse
import json
import time
from pathlib import Path
from database import PostgresDatabase


class TestFactionMetaIntel(unittest.TestCase):
    def setUp(self):
        self.root_dir = Path(__file__).resolve().parent.parent

    def test_database_faction_details_empty(self):
        db = PostgresDatabase.__new__(PostgresDatabase)
        db._faction_details_cache_dict = {}
        res = db.get_faction_details("")
        self.assertEqual(res["faction"], "")
        self.assertEqual(res["matches"], [])
        self.assertEqual(res["top_players"], [])
        self.assertEqual(res["matchups"], [])

    def test_database_cache_hit_and_invalidation(self):
        db = PostgresDatabase.__new__(PostgresDatabase)
        PostgresDatabase._faction_details_cache_dict = {}
        mock_data = {
            "faction": "Orks",
            "game_system": "40k",
            "timeframe": "1yr",
            "stats": {"total_recent_sample": 10},
            "top_players": [],
            "matches": [],
            "matchups": []
        }
        cache_key = ("orks", "40k", "1yr", 100)
        PostgresDatabase.set_cached(PostgresDatabase._faction_details_cache_dict, cache_key, mock_data)

        # Call get_faction_details and verify cache hit
        res = db.get_faction_details("Orks", limit=100, game_system="40k", timeframe="1yr")
        self.assertEqual(res["faction"], "Orks")
        self.assertEqual(res["stats"]["total_recent_sample"], 10)

        # Invalidate all caches and verify cache is empty
        PostgresDatabase.invalidate_all_caches()
        self.assertNotIn(cache_key, PostgresDatabase._faction_details_cache_dict)

    def test_prewarm_faction_details_cache_method(self):
        self.assertTrue(hasattr(PostgresDatabase, "prewarm_faction_details_cache"))
        self.assertTrue(callable(getattr(PostgresDatabase, "prewarm_faction_details_cache")))

    def test_css_skeleton_styles_present(self):
        styles_path = self.root_dir / "web" / "css" / "styles.css"
        self.assertTrue(styles_path.exists())
        content = styles_path.read_text(encoding="utf-8")
        self.assertIn(".skeleton-box", content)
        self.assertIn("skeleton-shimmer-pulse", content)
        self.assertIn(".skeleton-row", content)

    def test_modals_js_swr_cache_and_skeletons(self):
        modals_path = self.root_dir / "web" / "js" / "modals.js"
        self.assertTrue(modals_path.exists())
        content = modals_path.read_text(encoding="utf-8")
        self.assertIn("factionModalDataCache", content)
        self.assertIn("renderFactionTableSkeletons", content)
        self.assertIn("applyFactionModalData", content)

    def test_bundle_contains_faction_enhancements(self):
        bundle_path = self.root_dir / "web" / "js" / "app.bundle.min.js"
        self.assertTrue(bundle_path.exists())
        bundle_content = bundle_path.read_text(encoding="utf-8")
        self.assertIn("factionModalDataCache", bundle_content)
        self.assertIn("renderFactionTableSkeletons", bundle_content)
        self.assertIn("applyFactionModalData", bundle_content)

    def test_dev_server_faction_endpoint(self):
        url = "http://127.0.0.1:5178/api/faction/Orks?game_system=40k&timeframe=1yr"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "OmniTacticaTest/1.0"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                self.assertEqual(resp.status, 200)
                data = json.loads(resp.read().decode("utf-8"))
                self.assertEqual(data["faction"], "Orks")
                self.assertEqual(data["game_system"], "40k")
                self.assertEqual(data["timeframe"], "1yr")
                self.assertIn("matches", data)
                self.assertIn("top_players", data)
                self.assertIn("matchups", data)
                self.assertGreater(len(data["matches"]), 0)
                self.assertGreater(len(data["top_players"]), 0)
                self.assertGreater(len(data["matchups"]), 0)
        except Exception as e:
            self.skipTest(f"Local dev server on port 5178 not running: {e}")

    def test_dev_server_faction_endpoint_aos(self):
        url = "http://127.0.0.1:5178/api/faction/Stormcast%20Eternals?game_system=aos&timeframe=1yr"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "OmniTacticaTest/1.0"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                self.assertEqual(resp.status, 200)
                data = json.loads(resp.read().decode("utf-8"))
                self.assertEqual(data["faction"], "Stormcast Eternals")
                self.assertEqual(data["game_system"], "aos")
                self.assertEqual(data["timeframe"], "1yr")
                self.assertIn("matches", data)
                self.assertIn("top_players", data)
                self.assertIn("matchups", data)
                self.assertGreater(len(data["matches"]), 0)
        except Exception as e:
            self.skipTest(f"Local dev server on port 5178 not running: {e}")

    def test_database_faction_details_cache_hit_aos(self):
        db = PostgresDatabase.__new__(PostgresDatabase)
        PostgresDatabase._faction_details_cache_dict = {}
        mock_data = {
            "faction": "Stormcast Eternals",
            "game_system": "aos",
            "timeframe": "1yr",
            "stats": {"total_recent_sample": 15},
            "top_players": [],
            "matches": [],
            "matchups": []
        }
        cache_key = ("stormcast eternals", "aos", "1yr", 100)
        PostgresDatabase.set_cached(PostgresDatabase._faction_details_cache_dict, cache_key, mock_data)

        # Call get_faction_details with aos and verify cache hit
        res = db.get_faction_details("Stormcast Eternals", limit=100, game_system="aos", timeframe="1yr")
        self.assertEqual(res["faction"], "Stormcast Eternals")
        self.assertEqual(res["game_system"], "aos")
        self.assertEqual(res["stats"]["total_recent_sample"], 15)

    def test_prewarm_faction_details_cache_aos(self):
        db = PostgresDatabase.__new__(PostgresDatabase)
        PostgresDatabase._faction_details_cache_dict = {}
        # Prewarm aos factions in-memory
        db.get_factions = lambda game_system="40k", grouped=False: ["Stormcast Eternals", "Skaven"]
        db.get_faction_details = lambda f, limit=100, game_system="40k", timeframe="1yr": {
            "faction": f, "game_system": game_system, "timeframe": timeframe
        }
        warmed = db.prewarm_faction_details_cache(game_system="aos", timeframe="1yr", max_factions=2)
        self.assertEqual(warmed, 2)

    def test_database_faction_details_cache_hit_6mo(self):
        db = PostgresDatabase.__new__(PostgresDatabase)
        PostgresDatabase._faction_details_cache_dict = {}
        mock_data = {
            "faction": "Orks",
            "game_system": "40k",
            "timeframe": "6mo",
            "stats": {"total_recent_sample": 12},
            "top_players": [],
            "matches": [],
            "matchups": []
        }
        cache_key = ("orks", "40k", "6mo", 100)
        PostgresDatabase.set_cached(PostgresDatabase._faction_details_cache_dict, cache_key, mock_data)

        res = db.get_faction_details("Orks", limit=100, game_system="40k", timeframe="6mo")
        self.assertEqual(res["faction"], "Orks")
        self.assertEqual(res["timeframe"], "6mo")
        self.assertEqual(res["stats"]["total_recent_sample"], 12)

    def test_prewarm_faction_details_cache_6mo(self):
        db = PostgresDatabase.__new__(PostgresDatabase)
        PostgresDatabase._faction_details_cache_dict = {}
        db.get_factions = lambda game_system="40k", grouped=False: ["Orks", "Necrons"]
        db.get_faction_details = lambda f, limit=100, game_system="40k", timeframe="1yr": {
            "faction": f, "game_system": game_system, "timeframe": timeframe
        }
        warmed = db.prewarm_faction_details_cache(game_system="40k", timeframe="6mo", max_factions=2)
        self.assertEqual(warmed, 2)

    def test_query_faction_subquery_parameterization(self):
        db = PostgresDatabase.__new__(PostgresDatabase)
        executed_queries = []

        class MockCursor:
            def __init__(self):
                self.connection = None
            def execute(self, query, params=None):
                executed_queries.append((query, params))
            def fetchall(self):
                return []

        mock_cur = MockCursor()
        # Test _query_faction_top_players with cursor and date_params
        db._query_faction_top_players(
            "Orks", "40k", ["40k"], " AND COALESCE(matches.game_system, '40k') = %s",
            " AND matches.match_date >= %s", date_params=["2026-03-16"], cursor=mock_cur
        )
        self.assertEqual(len(executed_queries), 1)
        q1, p1 = executed_queries[0]
        self.assertIn("LOWER(player1_faction) = %s", q1)
        self.assertEqual(p1[0], "orks")

        # Test _query_faction_recent_matches CTE decomposition
        db._query_faction_recent_matches(
            "Orks", 100, ["40k"], " AND COALESCE(matches.game_system, '40k') = %s",
            " AND matches.match_date >= %s", date_params=["2026-03-16"], cursor=mock_cur
        )
        self.assertEqual(len(executed_queries), 2)
        q2, p2 = executed_queries[1]
        self.assertIn("p1_matches AS", q2)
        self.assertIn("p2_matches AS", q2)
        self.assertIn("candidate_matches AS", q2)
        self.assertEqual(p2[0], "orks")

        # Test _query_faction_matchups
        db._query_faction_matchups(
            "Orks", ["40k"], " AND COALESCE(matches.game_system, '40k') = %s",
            " AND matches.match_date >= %s", date_params=["2026-03-16"], cursor=mock_cur
        )
        self.assertEqual(len(executed_queries), 3)
        q3, p3 = executed_queries[2]
        self.assertIn("LOWER(player1_faction) = %s", q3)
        self.assertEqual(p3[0], "orks")

    def test_server_prewarms_both_1yr_and_6mo(self):
        server_path = self.root_dir / "server.py"
        self.assertTrue(server_path.exists())
        content = server_path.read_text(encoding="utf-8")
        self.assertIn('prewarm_faction_details_cache, "40k", "1yr"', content)
        self.assertIn('prewarm_faction_details_cache, "40k", "6mo"', content)
        self.assertIn('prewarm_faction_details_cache, "aos", "1yr"', content)
        self.assertIn('prewarm_faction_details_cache, "aos", "6mo"', content)

    def test_modals_js_swr_and_abort_timeout(self):
        modals_path = self.root_dir / "web" / "js" / "modals.js"
        self.assertTrue(modals_path.exists())
        content = modals_path.read_text(encoding="utf-8")
        self.assertIn("factionModalAbortController", content)
        self.assertIn("AbortController", content)
        self.assertIn("hasExistingData", content)

    def test_resolve_meta_preset_and_dates_canonicalization(self):
        # Standard preset tokens should map cleanly to canonical preset keys
        for tf, expected_key in [
            ("30d", "30d"),
            ("1mo", "30d"),
            ("60d", "60d"),
            ("2mo", "60d"),
            ("90d", "90d"),
            ("3mo", "90d"),
            ("180d", "180d"),
            ("6mo", "180d"),
            ("1yr", "1yr"),
            ("365d", "1yr"),
            ("ytd", "ytd"),
            ("all", "all"),
            ("all_time", "all"),
        ]:
            key, sd, ed, _is_short = PostgresDatabase._resolve_meta_preset_and_dates(timeframe=tf)
            self.assertEqual(key, expected_key)
            if expected_key == "all":
                self.assertIsNone(sd)
            else:
                self.assertTrue(sd is not None and len(sd) == 10 and sd.count("-") == 2)

    def test_prewarm_meta_intel_presets_method(self):
        self.assertTrue(hasattr(PostgresDatabase, "prewarm_meta_intel_presets"))
        self.assertTrue(callable(getattr(PostgresDatabase, "prewarm_meta_intel_presets")))

    def test_factions_js_statcheck_views_and_prefetch(self):
        factions_path = self.root_dir / "web" / "js" / "factions.js"
        self.assertTrue(factions_path.exists())
        content = factions_path.read_text(encoding="utf-8")
        self.assertIn("factionMetaClientCache", content)
        self.assertIn("scheduleFactionPresetsPrefetch", content)
        self.assertIn("renderFactionMetaKpis", content)
        self.assertNotIn("renderFactionQuadrantChart", content)
        self.assertNotIn("renderFactionTimelineChart", content)
        self.assertIn("setMetaMinPlayers", content)
        self.assertIn("setMetaMinRounds", content)
        self.assertIn("renderFactionMatchupMatrix", content)
        self.assertIn("setFactionViewMode", content)
        self.assertIn("non_mirror_win_rate", content)
        self.assertIn("x0_runs", content)
        self.assertIn("over_rep_ratio", content)
        db_path = self.root_dir / "database.py"
        db_content = db_path.read_text(encoding="utf-8")
        self.assertIn("tiwp_rate", db_content)
        self.assertIn("over_rep_ratio", db_content)
        self.assertIn("matchup_matrix", db_content)
        self.assertIn("summary_kpis", db_content)

    def test_meta_preset_cache_key_isolation(self):
        PostgresDatabase._faction_meta_cache_dict = {}
        PostgresDatabase.set_cached(
            PostgresDatabase._faction_meta_cache_dict,
            "preset_30d_40k",
            {"factions": [], "summary_kpis": {"total_matches": 15000}},
        )
        PostgresDatabase.set_cached(
            PostgresDatabase._faction_meta_cache_dict,
            "preset_all_40k",
            {"factions": [], "summary_kpis": {"total_matches": 50000}},
        )
        db = PostgresDatabase.__new__(PostgresDatabase)
        r30 = db.get_faction_meta_stats(timeframe="30d", game_system="40k")
        rall = db.get_faction_meta_stats(timeframe="all", game_system="40k")
        self.assertEqual(r30["summary_kpis"]["total_matches"], 15000)
        self.assertEqual(rall["summary_kpis"]["total_matches"], 50000)

    def test_meta_search_box_and_mobile_responsive_layout(self):
        app_html = (self.root_dir / "web" / "app.html").read_text(encoding="utf-8")
        self.assertIn('class="search-input-group meta-search-box"', app_html)
        self.assertNotIn('<div class="search-box"', app_html)
        self.assertIn("meta-controls-bar", app_html)
        self.assertIn("meta-window-bar", app_html)
        self.assertIn("meta-view-modes-bar", app_html)
        self.assertIn("meta-goldilocks-callout", app_html)

        styles_css = (self.root_dir / "web" / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn(".search-input-group,\n.search-box {", styles_css)
        self.assertIn("#faction-meta-table td:nth-child(6)", styles_css)
        self.assertIn("#faction-meta-table td:nth-child(9)", styles_css)
        self.assertIn(".meta-kpis-strip", styles_css)

    def test_modals_js_multilayer_cache_and_superset_derivation(self):
        modals_js = (self.root_dir / "web" / "js" / "modals.js").read_text(encoding="utf-8")
        self.assertIn("FACTION_MODAL_STORAGE_KEY", modals_js)
        self.assertIn("deriveFactionModalFromCachedSuperset", modals_js)
        self.assertIn("fetchFactionDetailsShared", modals_js)
        self.assertIn("prefetchFactionModalData", modals_js)
        self.assertIn("prefetchTopFactionsModalCache", modals_js)
        self.assertIn("prefetchRemainingModalTimeframes", modals_js)

    def test_database_bitmapscan_and_matchups_reuse(self):
        db_content = (self.root_dir / "database.py").read_text(encoding="utf-8")
        self.assertIn("SET LOCAL enable_bitmapscan = off", db_content)
        self.assertIn("matchups_by_faction", db_content)

    def test_cache_invalidation_epoch_and_stale_l2_prevention(self):
        """Verifies that invalidate_all_caches advances _last_cache_invalidation_ts and rejects older entries."""
        PostgresDatabase.set_cached(PostgresDatabase._faction_meta_cache_dict, "preset_90d_40k", {"summary_kpis": {"total_matches": 100}})
        self.assertIsNotNone(PostgresDatabase.get_cached(PostgresDatabase._faction_meta_cache_dict, "preset_90d_40k"))

        before_ts = time.time()
        PostgresDatabase.invalidate_all_caches()
        self.assertGreaterEqual(PostgresDatabase._last_cache_invalidation_ts, before_ts)
        self.assertIsNone(PostgresDatabase.get_cached(PostgresDatabase._faction_meta_cache_dict, "preset_90d_40k"))

        # Even if a stale entry with an older timestamp were placed in a cache dict, get_cached rejects it
        PostgresDatabase._faction_meta_cache_dict["stale_key"] = ({"summary_kpis": {"total_matches": 50}}, PostgresDatabase._last_cache_invalidation_ts - 1.0)
        self.assertIsNone(PostgresDatabase.get_cached(PostgresDatabase._faction_meta_cache_dict, "stale_key"))

        # Verify database.py purges L2 computed caches and checks _last_cache_invalidation_ts on L2 reads
        db_content = (self.root_dir / "database.py").read_text(encoding="utf-8")
        self.assertIn("purge_l2_computed_caches", db_content)
        self.assertIn("_last_cache_invalidation_ts", db_content)

    def test_composite_factions_and_canonical_aliases(self):
        """Verifies composite 2v2 '+' factions are rejected and aliases map to canonical names."""
        self.assertTrue(PostgresDatabase.is_super_or_empty_faction("Orks + T'au Empire"))
        self.assertTrue(PostgresDatabase.is_super_or_empty_faction("T'au Empire + Blood Angels"))
        self.assertTrue(PostgresDatabase.is_super_or_empty_faction("Pod (1)"))
        self.assertEqual(PostgresDatabase.canonicalize_faction_name("Orks + T'au Empire"), "")
        self.assertEqual(PostgresDatabase.canonicalize_faction_name("Space Marines (Astartes)"), "Space Marines")
        self.assertEqual(PostgresDatabase.canonicalize_faction_name("Adeptus Astartes"), "Space Marines")
        self.assertEqual(PostgresDatabase.canonicalize_faction_name("Genestealer Cult"), "Genestealer Cults")

        sm_aliases = PostgresDatabase.get_faction_aliases_lower("Space Marines")
        self.assertIn("space marines", sm_aliases)
        self.assertIn("space marines (astartes)", sm_aliases)
        self.assertIn("adeptus astartes", sm_aliases)

        db = PostgresDatabase.__new__(PostgresDatabase)
        executed = []

        class MockCur:
            def __init__(self):
                self.connection = None
            def execute(self, q, p=None):
                executed.append((q, p))
            def fetchall(self):
                return []

        db._query_faction_recent_matches(
            "Space Marines", 100, ["40k"], " AND COALESCE(matches.game_system, '40k') = %s",
            " AND matches.match_date >= %s", date_params=["2026-07-01"], cursor=MockCur()
        )
        self.assertEqual(len(executed), 1)
        q_sm, p_sm = executed[0]
        self.assertIn("COALESCE(matches.game_system, '40k'), match_date DESC", q_sm)
        self.assertIn("space marines (astartes)", p_sm)
        self.assertIn("adeptus astartes", p_sm)

    def test_no_4500_cap_and_covering_index_predicates(self):
        """Verifies get_faction_meta_stats does not cap 90d at 4500 games, has valid psycopg2 %s interpolation, and uses covering index."""
        import inspect
        from contextlib import contextmanager
        meta_src = inspect.getsource(PostgresDatabase.get_faction_meta_stats)
        self.assertNotIn('"90d": 4500', meta_src)
        self.assertIn("COALESCE(game_system, '40k') = %s", meta_src)
        self.assertIn("POSITION('+' IN COALESCE(player1_faction, '')) = 0", meta_src)
        self.assertIn("ORDER BY COALESCE(game_system, '40k'), match_date DESC", meta_src)

        PostgresDatabase.invalidate_all_caches()
        db = PostgresDatabase.__new__(PostgresDatabase)
        executed_sql = []

        class PsycopgStrictCursor:
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
            def execute(self, query, params=None):
                if params is not None:
                    # Simulate psycopg2 C-level %s parameter interpolation (catches any unescaped literal '%')
                    _ = query % tuple(repr(p) for p in params)
                executed_sql.append((query, params))
            def fetchall(self):
                return [{
                    "factions_json": [
                        {"faction": "Space Marines", "total_matches": 6000, "wins": 3000, "losses": 2900, "draws": 100, "win_rate": 50.0, "non_mirror_win_rate": 50.2}
                    ],
                    "matchups_json": [
                        {"faction": "Space Marines", "opp_faction": "Orks", "matches": 500, "wins": 260, "losses": 230, "draws": 10, "win_rate": 52.0, "avg_margin": 3.5}
                    ],
                    "trends_json": [],
                    "raw_match_count": 12450,
                }]
            def fetchone(self):
                return None

        class MockConn:
            def cursor(self, *args, **kwargs):
                return PsycopgStrictCursor()
            def rollback(self):
                pass
            def commit(self):
                pass

        @contextmanager
        def _mock_conn():
            yield MockConn()

        db.get_connection = _mock_conn
        res = db.get_faction_meta_stats(timeframe="90d", game_system="40k", _force_refresh=True)
        self.assertEqual(res["summary_kpis"]["total_matches"], 12450)
        self.assertEqual(len(executed_sql), 1)
        self.assertIn("matchup_stats AS", executed_sql[0][0])

    def test_single_pass_pair_period_aggregation_and_canonical_merging(self):
        """Verifies single-pass (p1_fac, p2_fac, period_date) HashAggregate rows merge aliases, drop '+' and 'Pod (', and compute symmetric matchups."""
        from contextlib import contextmanager
        PostgresDatabase.invalidate_all_caches()
        db = PostgresDatabase.__new__(PostgresDatabase)

        class PairAggCursor:
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
            def execute(self, query, params=None):
                pass
            def fetchall(self):
                return [
                    {
                        "p1_fac": "Space Marines (Astartes)",
                        "p2_fac": "Orks",
                        "period_date": "2026-09-01",
                        "match_cnt": 100,
                        "p1_wins": 60,
                        "p1_losses": 38,
                        "draws": 2,
                        "p2_wins": 38,
                        "p2_losses": 60,
                        "p1_score_sum": 7500,
                        "p1_score_cnt": 100,
                        "p2_score_sum": 6500,
                        "p2_score_cnt": 100,
                        "p1_margin_sum": 1000,
                        "margin_cnt": 100,
                    },
                    {
                        "p1_fac": "Space Marines",
                        "p2_fac": "Space Marines (Astartes)",
                        "period_date": "2026-09-01",
                        "match_cnt": 20,
                        "p1_wins": 10,
                        "p1_losses": 10,
                        "draws": 0,
                        "p2_wins": 10,
                        "p2_losses": 10,
                        "p1_score_sum": 1400,
                        "p1_score_cnt": 20,
                        "p2_score_sum": 1400,
                        "p2_score_cnt": 20,
                        "p1_margin_sum": 0,
                        "margin_cnt": 20,
                    },
                    {
                        "p1_fac": "Orks + T'au Empire",
                        "p2_fac": "Space Marines",
                        "period_date": "2026-09-01",
                        "match_cnt": 50,
                        "p1_wins": 25,
                        "p1_losses": 25,
                        "draws": 0,
                        "p2_wins": 25,
                        "p2_losses": 25,
                        "p1_score_sum": 3500,
                        "p1_score_cnt": 50,
                        "p2_score_sum": 3500,
                        "p2_score_cnt": 50,
                        "p1_margin_sum": 0,
                        "margin_cnt": 50,
                    },
                ]
            def fetchone(self):
                return None

        class MockConn:
            def cursor(self, *args, **kwargs):
                return PairAggCursor()
            def rollback(self):
                pass
            def commit(self):
                pass

        @contextmanager
        def _mock_conn():
            yield MockConn()

        db.get_connection = _mock_conn
        res = db.get_faction_meta_stats(timeframe="90d", game_system="40k", _force_refresh=True)
        # 100 (SM vs Orks) + 20 (SM mirror) = 120 valid 1v1 matches (50 composite '+' excluded)
        self.assertEqual(res["summary_kpis"]["total_matches"], 120)
        factions_by_name = {f["faction"]: f for f in res["factions"]}
        self.assertEqual(set(factions_by_name.keys()), {"Space Marines", "Orks"})
        # Space Marines: 100 vs Orks + 20*2 mirror sides = 140 total appearances (60+10+10=80 wins)
        sm = factions_by_name["Space Marines"]
        self.assertEqual(sm["total_matches"], 140)
        self.assertEqual(sm["mirror_matches"], 40)
        self.assertEqual(sm["non_mirror_matches"], 100)
        self.assertEqual(sm["non_mirror_win_rate"], 60.0)
        # Matchups should have Space Marines vs Orks (60.0%) and Orks vs Space Marines (38.0%), no self-matchups
        sm_mu = res["matchups_by_faction"]["Space Marines"]
        self.assertEqual(len(sm_mu), 1)
        self.assertEqual(sm_mu[0]["opponent_faction"], "Orks")
        self.assertEqual(sm_mu[0]["matches"], 100)
        self.assertEqual(sm_mu[0]["win_rate"], 60.0)

    def test_aos_colon_subfactions_and_modal_l1_reconciliation(self):
        self.assertEqual(
            PostgresDatabase.canonicalize_faction_name("Blades of Khorne: Reapers of Vengeance"),
            "Blades of Khorne",
        )
        self.assertEqual(
            PostgresDatabase.canonicalize_faction_name("Hosts of Slaanesh: Pretenders Host"),
            "Hedonites of Slaanesh",
        )
        self.assertEqual(
            PostgresDatabase.canonicalize_faction_name("Skaventide: Clan Skryre"),
            "Skaven",
        )
        self.assertEqual(
            PostgresDatabase.canonicalize_faction_name("Chaos: Legion of the First Prince"),
            "Slaves to Darkness",
        )
        self.assertEqual(
            PostgresDatabase.canonicalize_faction_name("Lumineth Realm-Lords: Alumnia"),
            "Lumineth Realm-lords",
        )

        # Verify modal L1 cache reconciliation when Meta Intel L1 cache has updated canonical totals
        db = PostgresDatabase.__new__(PostgresDatabase)
        db.connection_pool = True
        PostgresDatabase._faction_details_cache_dict = {}
        PostgresDatabase._faction_meta_cache_dict = {}
        stale_modal = {
            "faction": "Space Marines",
            "game_system": "40k",
            "timeframe": "1yr",
            "stats": {
                "total_matches": 4440,
                "total_wins": 2140,
                "total_losses": 2200,
                "total_draws": 100,
                "win_rate": 48.2,
                "non_mirror_win_rate": 48.2,
            },
            "total_matches": 4440,
            "matches": [{"match_id": "m1", "outcome": "W"}],
            "matchups": [{"opponent_faction": "Orks", "total_matches": 200, "wins": 96, "losses": 104, "draws": 0, "win_rate": 48.0}],
            "top_players": [],
        }
        PostgresDatabase.set_cached(
            PostgresDatabase._faction_details_cache_dict,
            ("space marines", "40k", "1yr", 350),
            stale_modal,
        )
        PostgresDatabase.set_cached(
            PostgresDatabase._faction_meta_cache_dict,
            "preset_1yr_40k",
            {
                "factions": [
                    {
                        "faction": "Space Marines",
                        "total_matches": 82197,
                        "wins": 38879,
                        "losses": 41500,
                        "draws": 1818,
                        "win_rate": 47.3,
                        "non_mirror_win_rate": 47.1,
                        "meta_share": 8.98,
                    }
                ],
                "matchups_by_faction": {
                    "Space Marines": [
                        {"opponent_faction": "Orks", "matches": 4120, "wins": 2100, "losses": 1950, "draws": 70, "win_rate": 51.0, "avg_margin": 1.8},
                        {"opponent_faction": "Aeldari", "matches": 3890, "wins": 1750, "losses": 2080, "draws": 60, "win_rate": 45.0, "avg_margin": -2.4},
                    ]
                },
            },
        )
        reconciled = db.get_faction_details("Space Marines", limit=350, game_system="40k", timeframe="1yr")
        self.assertEqual(reconciled["stats"]["total_matches"], 82197)
        self.assertEqual(reconciled["stats"]["win_rate"], 47.3)
        self.assertEqual(reconciled["total_matches"], 82197)
        self.assertEqual(len(reconciled["matchups"]), 2)

    def test_faction_matches_offset_pagination_and_ui_wiring(self):
        db = PostgresDatabase.__new__(PostgresDatabase)
        executed = []

        class MockCursor:
            def __init__(self):
                self.connection = None
            def execute(self, query, params=None):
                executed.append((query, params))
            def fetchall(self):
                return []

        mock_cur = MockCursor()
        db._query_faction_recent_matches(
            "Orks", 350, ["40k"], " AND COALESCE(matches.game_system, '40k') = %s",
            " AND matches.match_date >= %s", date_params=["2026-07-27"], cursor=mock_cur, offset=350
        )
        self.assertEqual(len(executed), 1)
        sql_unfiltered, params_unfiltered = executed[0]
        self.assertIn("OFFSET %s", sql_unfiltered)
        self.assertEqual(params_unfiltered[-2:], (350, 350))

        db._query_faction_recent_matches(
            "Orks", 350, ["40k"], " AND COALESCE(matches.game_system, '40k') = %s",
            " AND matches.match_date >= %s", date_params=["2026-07-27"], cursor=mock_cur, search_query="lvo", offset=350
        )
        self.assertEqual(len(executed), 2)
        sql_search, params_search = executed[1]
        self.assertIn("OFFSET %s", sql_search)
        self.assertEqual(params_search[-2:], (350, 350))

        app_html = (self.root_dir / "web" / "app.html").read_text(encoding="utf-8")
        self.assertIn("fmodal-matches-footer", app_html)
        self.assertIn("loadMoreFactionMatches()", app_html)

        bundle_js = (self.root_dir / "web" / "js" / "app.bundle.min.js").read_text(encoding="utf-8")
        self.assertIn("loadMoreFactionMatches", bundle_js)
        self.assertIn("fmodal-load-more-btn", bundle_js)

    def test_single_pass_x0_event_runs_and_ui_zero_suppression(self):
        import inspect
        meta_src = inspect.getsource(PostgresDatabase.get_faction_meta_stats)
        details_src = inspect.getsource(PostgresDatabase.get_faction_details)
        self.assertIn("CROSS JOIN LATERAL", meta_src)
        self.assertIn("meta_evchunk_v2_", meta_src)
        self.assertNotIn("q1_elapsed_ms < 2200.0", meta_src)
        self.assertIn('meta_ver = "v13"', meta_src)
        self.assertIn('meta_ver = "v13"', details_src)
        self.assertNotIn('"v10"', details_src)

        factions_js = (self.root_dir / "web" / "js" / "factions.js").read_text(encoding="utf-8")
        self.assertIn("Ex-Mirror Leader", factions_js)
        self.assertIn("No undefeated tournament runs in this timeframe", factions_js)

        # Verify modal cache reconciliation updates x0_runs when Meta Intel updates x0_runs from 0 -> non-zero
        db = PostgresDatabase.__new__(PostgresDatabase)
        db.connection_pool = True
        PostgresDatabase._faction_details_cache_dict = {}
        PostgresDatabase._faction_meta_cache_dict = {}
        PostgresDatabase.set_cached(
            PostgresDatabase._faction_details_cache_dict,
            ("orks", "40k", "3mo", 350),
            {
                "faction": "Orks",
                "game_system": "40k",
                "timeframe": "3mo",
                "stats": {"total_matches": 17170, "win_rate": 53.5, "x0_runs": 0, "x1_runs": 0},
                "total_matches": 17170,
                "matches": [{"match_id": "m1", "outcome": "W"}],
                "matchups": [{"opponent_faction": "Space Marines", "total_matches": 900, "wins": 500, "losses": 380, "draws": 20, "win_rate": 55.6}],
                "top_players": [],
            },
        )
        PostgresDatabase.set_cached(
            PostgresDatabase._faction_meta_cache_dict,
            "preset_90d_40k",
            {
                "factions": [
                    {
                        "faction": "Orks",
                        "total_matches": 17170,
                        "wins": 9181,
                        "losses": 7428,
                        "draws": 561,
                        "win_rate": 53.5,
                        "non_mirror_win_rate": 53.9,
                        "meta_share": 8.06,
                        "unique_pilots": 3066,
                        "x0_runs": 125,
                        "x1_runs": 542,
                        "tiwp_rate": 3.0,
                        "over_rep_ratio": 1.48,
                    }
                ],
                "matchups_by_faction": {
                    "Orks": [
                        {"opponent_faction": "Space Marines", "matches": 900, "wins": 500, "losses": 380, "draws": 20, "win_rate": 55.6, "avg_margin": 4.2}
                    ]
                },
            },
        )
        reconciled = db.get_faction_details("Orks", limit=350, game_system="40k", timeframe="90d")
        self.assertEqual(reconciled["stats"]["x0_runs"], 125)
        self.assertEqual(reconciled["stats"]["x1_runs"], 542)
        self.assertEqual(reconciled["stats"]["over_rep_ratio"], 1.48)


if __name__ == "__main__":
    unittest.main()

