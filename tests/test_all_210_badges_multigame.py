"""Unified Multi-Game Test Suite for All 210 Master Badges.

Verifies complete isolation and accurate awarding across:
  - Warhammer 40k (105 badges)
  - Warhammer Age of Sigmar (105 badges)
Total = 210 master badges tested against concrete mock data.
"""

import sys
import unittest
import urllib.request
import json
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

import badges
import aos_badges

# Import test classes
from tests.test_all_105_badges_mock import TestAll105BadgesMock
from tests.test_all_aos_badges_mock import TestAllAosBadgesMock


class TestCrossGameIsolation(unittest.TestCase):
    """Verify strict separation between 40k and AoS systems."""

    def test_catalog_separation(self):
        cat_40k = badges.get_all_badges_catalog("40k")
        cat_aos = badges.get_all_badges_catalog("aos")

        self.assertEqual(len(cat_40k), 105, "40k must have 105 badges")
        self.assertEqual(len(cat_aos), 105, "AoS must have 105 badges")

        ids_40k = {b["id"] for b in cat_40k}
        ids_aos = {b["id"] for b in cat_aos}

        # Zero ID overlap
        overlap = ids_40k.intersection(ids_aos)
        self.assertEqual(len(overlap), 0, f"Forbidden badge ID collision between 40k and AoS: {overlap}")

        # All AoS IDs have aos_ prefix
        for b in cat_aos:
            self.assertTrue(b["id"].startswith("aos_"), f"AoS badge ID {b['id']} missing aos_ prefix")

        # Zero 40k IDs have aos_ prefix
        for b in cat_40k:
            self.assertFalse(b["id"].startswith("aos_"), f"40k badge ID {b['id']} has aos_ prefix")

    def test_ranks_separation(self):
        ranks_40k = badges.get_ranks("40k")
        ranks_aos = badges.get_ranks("aos")

        self.assertEqual(len(ranks_40k), 7)
        self.assertEqual(len(ranks_aos), 7)

        titles_40k = [r["title"] for r in ranks_40k]
        titles_aos = [r["title"] for r in ranks_aos]

        self.assertEqual(titles_40k[4], "Chapter Master")
        self.assertEqual(titles_aos[4], "Lord-Commander")

        self.assertEqual(titles_40k[6], "Apex Everchosen")
        self.assertEqual(titles_aos[6], "Champion of the Gods")

    def test_live_dev_server_endpoints(self):
        """Verify live dev server on port 5177 returns isolated catalogs."""
        try:
            req_40k = urllib.request.urlopen("http://127.0.0.1:5177/api/badges/catalog?game_system=40k", timeout=2)
            data_40k = json.loads(req_40k.read())
            self.assertEqual(data_40k["game_system"], "40k")
            self.assertEqual(data_40k["total"], 105)
            self.assertEqual(len(data_40k["badges"]), 105)
            self.assertEqual(data_40k["ranks"][4]["title"], "Chapter Master")

            req_aos = urllib.request.urlopen("http://127.0.0.1:5177/api/badges/catalog?game_system=aos", timeout=2)
            data_aos = json.loads(req_aos.read())
            self.assertEqual(data_aos["game_system"], "aos")
            self.assertEqual(data_aos["total"], 105)
            self.assertEqual(len(data_aos["badges"]), 105)
            self.assertEqual(data_aos["ranks"][4]["title"], "Lord-Commander")
        except Exception as e:
            self.fail(f"Dev server request failed: {e}")


if __name__ == '__main__':
    unittest.main()
