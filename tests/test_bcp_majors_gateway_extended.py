"""Extended Unit and Resilience Tests for BCP Majors Discovery Gateway.
Tests:
1. Thread-safe concurrency and single cache fill under load.
2. Network failure resilience: upstream HTTP 500, timeouts, and URLError graceful fallbacks.
3. Cache invalidation on TTL expiry (2 hours).
4. Edge-case parameter handling (negative values, extreme values, invalid systems).
5. Zero database mutation invariant (no DB connections or write queries).
"""
import concurrent.futures
import time
import unittest
from unittest.mock import patch, MagicMock
import urllib.error

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routers.community import (
    classify_tournament_tier,
    fetch_live_bcp_majors,
    get_fallback_majors,
    _bcp_majors_cache
)

class TestBcpMajorsGatewayExtended(unittest.TestCase):

    def setUp(self):
        _bcp_majors_cache.clear()

    def test_concurrent_requests_thread_safety(self):
        """Verify multiple threads calling fetch_live_bcp_majors simultaneously populate cache cleanly."""
        results = []
        def worker(sys_name):
            return fetch_live_bcp_majors(sys_name)

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            futures = [executor.submit(worker, "40k") for _ in range(16)]
            for f in concurrent.futures.as_completed(futures):
                results.append(f.result())

        self.assertEqual(len(results), 16)
        # All results should have identical length
        first_len = len(results[0])
        self.assertGreaterEqual(first_len, 3)
        for r in results:
            self.assertEqual(len(r), first_len)

        # Cache should have exactly 1 entry for 40k
        self.assertIn("40k", _bcp_majors_cache)
        self.assertEqual(len(_bcp_majors_cache["40k"][1]), first_len)

    def test_upstream_http_error_graceful_fallback(self):
        """Verify upstream HTTP error (500/503) does not crash and returns fallback majors."""
        with patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError("http://bcp", 500, "Internal Server Error", {}, None)):
            majors = fetch_live_bcp_majors("40k")
            self.assertIsInstance(majors, list)
            self.assertGreaterEqual(len(majors), 3)
            # Verify fallback has expected premiere events
            names = [m["name"] for m in majors]
            self.assertTrue(any("Las Vegas Open" in n for n in names))

    def test_upstream_timeout_graceful_fallback(self):
        """Verify upstream connection timeout does not hang or raise an exception."""
        with patch("urllib.request.urlopen", side_effect=TimeoutError("Connection timed out")):
            majors = fetch_live_bcp_majors("aos")
            self.assertIsInstance(majors, list)
            self.assertGreaterEqual(len(majors), 3)
            for m in majors:
                self.assertEqual(m["game_system"], "aos")

    def test_cache_ttl_invalidation(self):
        """Verify cache expires after 2 hours (7200s) and triggers re-fetch."""
        # Prime cache with fake past timestamp
        fake_events = [{"id": "test_old", "name": "Old Event", "tier": "major", "game_system": "40k"}]
        _bcp_majors_cache["40k"] = (time.time() - 7250, fake_events)

        # Fetching now should notice cache is > 7200s old and refresh
        majors = fetch_live_bcp_majors("40k")
        self.assertNotEqual(majors, fake_events)
        # Cached timestamp should now be fresh
        new_ts = _bcp_majors_cache["40k"][0]
        self.assertGreater(new_ts, time.time() - 10)

    def test_edge_case_parameters(self):
        """Verify extreme days_ahead and min_players parameters work gracefully."""
        # Extreme days ahead
        m1 = fetch_live_bcp_majors("40k", days_ahead=9999, min_players=10)
        self.assertIsInstance(m1, list)

        # min_players=0
        m2 = fetch_live_bcp_majors("40k", days_ahead=30, min_players=0)
        self.assertIsInstance(m2, list)

        # Non-standard game system fallback
        m3 = fetch_live_bcp_majors("unknown_system_xyz", days_ahead=60)
        self.assertIsInstance(m3, list)

    def test_zero_db_mutation_guarantee(self):
        """Verify fetch_live_bcp_majors makes ZERO database calls or mutations."""
        with patch("database.get_db") as mock_conn:
            majors = fetch_live_bcp_majors("40k")
            self.assertGreaterEqual(len(majors), 3)
            # database.get_db must NEVER be called by discovery gateway
            mock_conn.assert_not_called()

    def test_tier_classifier_edge_cases(self):
        """Verify tier classifier with empty strings, None, negative numbers."""
        t_none = classify_tournament_tier(None, 0, 0)
        self.assertEqual(t_none["tier"], "rtt")

        t_empty = classify_tournament_tier("", None, None)
        self.assertEqual(t_empty["tier"], "rtt")

        t_neg = classify_tournament_tier("Negative Players Event", -10, -5)
        self.assertEqual(t_neg["tier"], "rtt")

        # Mixed casing and spacing
        t_case = classify_tournament_tier("   lAs VeGaS oPeN 2027   ", 10, 10)
        self.assertEqual(t_case["tier"], "super_major")

if __name__ == "__main__":
    unittest.main()
