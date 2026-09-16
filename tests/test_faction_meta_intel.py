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
            self.fail(f"Failed to connect to dev server on port 5178: {e}")


if __name__ == "__main__":
    unittest.main()
