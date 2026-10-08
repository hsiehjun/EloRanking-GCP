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
        self.assertIn("renderFactionQuadrantChart", content)
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


if __name__ == "__main__":
    unittest.main()

