"""Unit tests for BCP Majors Gateway and Tournament Tier Classifier."""
import unittest
import time
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routers.community import (
    classify_tournament_tier,
    fetch_live_bcp_majors,
    get_fallback_majors,
    _bcp_majors_cache
)

class TestBcpMajorsGateway(unittest.TestCase):

    def test_classify_tournament_tier_super_major(self):
        t1 = classify_tournament_tier("LVO 2026 - Warhammer 40k Championships - Las Vegas Open", total_players=350, num_tickets=1000)
        self.assertEqual(t1["tier"], "super_major")
        self.assertEqual(t1["badge"], "👑 SUPER MAJOR")
        self.assertEqual(t1["weight"], 4)

        t2 = classify_tournament_tier("Mega Continental Open", total_players=260, num_tickets=300)
        self.assertEqual(t2["tier"], "super_major")

        t3 = classify_tournament_tier("AdeptiCon 2027 Warhammer Championships", total_players=150, num_tickets=200)
        self.assertEqual(t3["tier"], "super_major")

    def test_classify_tournament_tier_major(self):
        t1 = classify_tournament_tier("Warhammer 40,000 US Open Series: Tacoma", total_players=120, num_tickets=120)
        self.assertEqual(t1["tier"], "major")
        self.assertEqual(t1["badge"], "🌟 MAJOR")
        self.assertEqual(t1["weight"], 3)

        t2 = classify_tournament_tier("The Armadillo Cup WarZone Houston", total_players=138, num_tickets=150)
        self.assertEqual(t2["tier"], "major")

    def test_classify_tournament_tier_gt_and_rtt(self):
        t_gt = classify_tournament_tier("SoCal Autumn Grand Tournament", total_players=40, num_tickets=48)
        self.assertEqual(t_gt["tier"], "gt")
        self.assertEqual(t_gt["badge"], "🏆 GRAND TOURNAMENT")
        self.assertEqual(t_gt["weight"], 2)

        t_rtt = classify_tournament_tier("Store Saturday 3-Round RTT", total_players=16, num_tickets=16)
        self.assertEqual(t_rtt["tier"], "rtt")
        self.assertEqual(t_rtt["badge"], "⚔️ RTT")
        self.assertEqual(t_rtt["weight"], 1)

    def test_fetch_live_bcp_majors_40k(self):
        _bcp_majors_cache.clear()
        majors = fetch_live_bcp_majors("40k")
        self.assertIsInstance(majors, list)
        self.assertGreaterEqual(len(majors), 3)
        
        for m in majors:
            self.assertIn("id", m)
            self.assertIn("name", m)
            self.assertIn("tier", m)
            self.assertIn("tier_badge", m)
            self.assertIn("game_system", m)
            self.assertEqual(m["game_system"], "40k")

        self.assertIn("40k", _bcp_majors_cache)
        cached_ts, cached_list = _bcp_majors_cache["40k"]
        self.assertGreater(cached_ts, 0)
        self.assertEqual(len(cached_list), len(majors))

    def test_fetch_live_bcp_majors_aos(self):
        majors = fetch_live_bcp_majors("aos")
        self.assertIsInstance(majors, list)
        self.assertGreaterEqual(len(majors), 3)
        for m in majors:
            self.assertEqual(m["game_system"], "aos")
            self.assertIn("tier_badge", m)

    def test_fallback_majors_data_structure(self):
        fb_40k = get_fallback_majors("40k")
        self.assertGreaterEqual(len(fb_40k), 3)
        self.assertTrue(any("Las Vegas Open" in m["name"] for m in fb_40k))

        fb_aos = get_fallback_majors("aos")
        self.assertGreaterEqual(len(fb_aos), 3)
        self.assertTrue(any("AdeptiCon" in m["name"] for m in fb_aos))

if __name__ == "__main__":
    unittest.main()
