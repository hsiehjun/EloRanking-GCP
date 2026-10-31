"""Comprehensive unit, integration, UX, and <1000ms latency tests for the Community Hub Tournament Recommendation & Search Engine."""
import sys
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

try:
    from fastapi.testclient import TestClient
except ImportError:
    TestClient = None

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))


class TestCommunityRecommendationEngineLogic(unittest.TestCase):
    """Tests noise filtering, word-boundary tier classification, drive-time modeling, regional affinity, and scoring."""

    def test_word_boundary_tier_classification(self):
        from routers.community import classify_tournament_tier

        # Substring false positives must NEVER promote small RTTs to Super Major / Major
        mwtc = classify_tournament_tier("MWTC Monthly Local RTT", total_players=16, num_tickets=24, num_rounds=3)
        self.assertEqual(mwtc["tier"], "rtt")

        open_play = classify_tournament_tier("Saturday Open Play 40k", total_players=10, num_tickets=16, num_rounds=3)
        self.assertEqual(open_play["tier"], "rtt")

        grand_opening = classify_tournament_tier("Store Grand Opening Tournament", total_players=18, num_tickets=24, num_rounds=3)
        self.assertEqual(grand_opening["tier"], "rtt")

        # Real Super Majors, Majors & GTs must classify accurately
        lvo = classify_tournament_tier("Las Vegas Open 2027", total_players=850, num_tickets=1000, num_rounds=6)
        self.assertEqual(lvo["tier"], "super_major")

        cal_cup = classify_tournament_tier("The California Cup 2026", total_players=167, num_tickets=192, num_rounds=8)
        self.assertEqual(cal_cup["tier"], "major")

        gt = classify_tournament_tier("SoCal Tactical GT", total_players=42, num_tickets=64, num_rounds=5)
        self.assertEqual(gt["tier"], "gt")

    def test_casual_and_irrelevant_noise_filter(self):
        from routers.community import is_casual_or_irrelevant_event

        future_dt = (datetime.now(timezone.utc) + timedelta(days=14)).strftime("%Y-%m-%d")
        league_end = (datetime.now(timezone.utc) + timedelta(days=45)).strftime("%Y-%m-%d")

        # 1. Synthetic bcp_* IDs must always be rejected
        self.assertTrue(is_casual_or_irrelevant_event({"id": "bcp_fake_1", "name": "Fake GT", "total_players": 60, "event_date": future_dt})[0])

        # 2. Casual Open Play / Learn to Play / Crusade / Combat Patrol / TTS
        for noisy_name in (
            "Thursday Night Open Play",
            "Warhammer 40k Learn to Play Demo",
            "Spring Escalation League",
            "Crusade Narrative Campaign",
            "Combat Patrol Skirmish Day",
            "TTS Online Discord GT",
        ):
            self.assertTrue(
                is_casual_or_irrelevant_event({"id": "REAL123", "name": noisy_name, "total_players": 20, "event_date": future_dt})[0],
                f"Expected '{noisy_name}' to be filtered as casual/non-tournament noise",
            )

        # 3. Multi-week duration (>4 days)
        self.assertTrue(
            is_casual_or_irrelevant_event({
                "id": "REAL_LEAGUE",
                "name": "Summer 40K Championship",
                "event_date": future_dt,
                "end_date": league_end,
                "total_players": 32,
            })[0]
        )

        # 4. Dead 0-player, 0-ticket, unpriced stub
        self.assertTrue(
            is_casual_or_irrelevant_event({
                "id": "DEAD_STUB",
                "name": "Test Draft Event",
                "event_date": future_dt,
                "total_players": 0,
                "num_tickets": 0,
                "ticket_price": 0,
            })[0]
        )

        # 5. Legitimate local RTT & regional Major must NOT be filtered
        self.assertFalse(
            is_casual_or_irrelevant_event({
                "id": "LOCAL_RTT_1",
                "name": "At Ease Games Monthly 40k RTT",
                "event_date": future_dt,
                "total_players": 22,
                "num_tickets": 32,
                "num_rounds": 3,
            })[0]
        )
        self.assertFalse(
            is_casual_or_irrelevant_event({
                "id": "CAL_CUP_26",
                "name": "The California Cup 2026",
                "event_date": future_dt,
                "end_date": (datetime.now(timezone.utc) + timedelta(days=16)).strftime("%Y-%m-%d"),
                "total_players": 167,
                "num_tickets": 192,
                "num_rounds": 8,
            })[0]
        )

    def test_drive_time_estimation_and_border_buffer(self):
        from routers.community import estimate_drive_time

        # Local ~12 miles -> ~19 mins
        local_d = estimate_drive_time(12.0, user_country="US", event_country="US")
        self.assertIsNotNone(local_d["drive_minutes"])
        self.assertLessEqual(local_d["drive_minutes"], 30)

        # Poway, CA to Pomona, CA (~88 straight-line miles) -> ~1h 50m drive (<= 120 mins = 2h drive!)
        pomona_d = estimate_drive_time(88.0, user_country="US", event_country="US")
        self.assertGreaterEqual(pomona_d["drive_minutes"], 95)
        self.assertLessEqual(pomona_d["drive_minutes"], 120)
        self.assertIn("drive", pomona_d["drive_label"])

        # Cross-border Poway, CA to Tijuana, MX (~28 miles) adds +45m border crossing penalty
        mx_d = estimate_drive_time(28.0, user_country="US", event_country="MX")
        us_d = estimate_drive_time(28.0, user_country="US", event_country="US")
        self.assertEqual(mx_d["drive_minutes"] - us_d["drive_minutes"], 45)

    def test_score_and_categorize_buckets_poway_scenario(self):
        from routers.community import score_and_categorize_community_events

        now = datetime.now(timezone.utc)
        in_10d = (now + timedelta(days=10)).strftime("%Y-%m-%d")
        in_12d = (now + timedelta(days=12)).strftime("%Y-%m-%d")
        in_30d = (now + timedelta(days=30)).strftime("%Y-%m-%d")
        past_14d = (now - timedelta(days=14)).strftime("%Y-%m-%d")

        # User centered in Poway, CA (32.9628, -117.0359)
        candidates = [
            # 1. Local RTT in Miramar / San Diego (~9 mi away)
            {
                "id": "SD_RTT_1",
                "name": "Miramar Strike Force RTT",
                "event_date": in_10d,
                "city": "San Diego",
                "state": "CA",
                "country": "US",
                "venue_name": "At Ease Games",
                "latitude": 32.8850,
                "longitude": -117.1500,
                "total_players": 26,
                "num_tickets": 32,
                "num_rounds": 3,
            },
            # 2. Driveable Major in Pomona, CA (~88 mi away -> ~1h 52m drive <= 2h!)
            {
                "id": "CAL_CUP_2026",
                "name": "The California Cup 2026",
                "event_date": in_10d,
                "end_date": in_12d,
                "city": "Pomona",
                "state": "CA",
                "country": "US",
                "venue_name": " Sheraton Fairplex",
                "latitude": 34.0825,
                "longitude": -117.7660,
                "total_players": 167,
                "num_tickets": 192,
                "num_rounds": 8,
            },
            # 3. US Super Major outside 2h drive (Las Vegas, ~255 mi)
            {
                "id": "LVO_2027",
                "name": "Las Vegas Open 40K Championship",
                "event_date": in_30d,
                "city": "Las Vegas",
                "state": "NV",
                "country": "US",
                "latitude": 36.1362,
                "longitude": -115.1512,
                "total_players": 650,
                "num_tickets": 900,
                "num_rounds": 6,
            },
            # 4. US Major (Dallas Open)
            {
                "id": "DALLAS_OPEN",
                "name": "Lone Star Open Major",
                "event_date": in_30d,
                "city": "Dallas",
                "state": "TX",
                "country": "US",
                "latitude": 32.7767,
                "longitude": -96.7970,
                "total_players": 210,
                "num_tickets": 256,
                "num_rounds": 6,
            },
            # 5. US Major (Tacoma Open)
            {
                "id": "TACOMA_OPEN",
                "name": "US Open Tacoma",
                "event_date": in_30d,
                "city": "Tacoma",
                "state": "WA",
                "country": "US",
                "latitude": 47.2529,
                "longitude": -122.4443,
                "total_players": 240,
                "num_tickets": 300,
                "num_rounds": 6,
            },
            # 6. Overseas European GT (should NOT appear in regional US scope when >=4 NA Majors exist, but SHOULD appear in global scope)
            {
                "id": "GERMAN_GT_1",
                "name": "Bavarian Warhammer GT",
                "event_date": in_30d,
                "city": "Munich",
                "country": "Germany",
                "latitude": 48.1351,
                "longitude": 11.5820,
                "total_players": 64,
                "num_tickets": 80,
                "num_rounds": 5,
            },
            # 7. Casual noise (Open Play) -> must be excluded everywhere
            {
                "id": "NOISE_OPEN_PLAY",
                "name": "Friday Night Open Play",
                "event_date": in_10d,
                "city": "Poway",
                "state": "CA",
                "country": "US",
                "latitude": 32.9628,
                "longitude": -117.0359,
                "total_players": 12,
                "num_rounds": 0,
            },
            # 8. Completed past local tournament -> strictly in past_results, NEVER in local_events or driveable_events
            {
                "id": "PAST_SD_GT",
                "name": "San Diego Autumn GT",
                "event_date": past_14d,
                "city": "San Diego",
                "state": "CA",
                "country": "US",
                "latitude": 32.7157,
                "longitude": -117.1611,
                "total_players": 48,
                "num_rounds": 5,
                "is_ended": True,
            },
        ]

        res_reg = score_and_categorize_community_events(
            raw_candidates=candidates,
            user_lat=32.9628,
            user_lng=-117.0359,
            local_radius_miles=50.0,
            max_drive_hours=2.0,
            majors_scope="regional",
            game_system="40k",
            user_elo=1680.0,
            familiar_venues={"at ease games"},
            field_stats_map={"SD_RTT_1": {"avg_field_elo": 1655.0, "top_seed_elo": 1890.0, "rated_players_count": 18, "total_enrolled": 26}},
        )

        local_ids = [e["id"] for e in res_reg["local_events"]]
        drive_ids = [e["id"] for e in res_reg["driveable_events"]]
        major_ids = [e["id"] for e in res_reg["destination_majors"]]
        past_ids = [e["id"] for e in res_reg["past_results"]]

        self.assertEqual(local_ids, ["SD_RTT_1"])
        self.assertEqual(drive_ids, ["CAL_CUP_2026"])
        self.assertIn("LVO_2027", major_ids)
        self.assertIn("CAL_CUP_2026", major_ids)
        self.assertNotIn("GERMAN_GT_1", major_ids, "European GT should not clutter North American Regional Majors")
        self.assertEqual(past_ids, ["PAST_SD_GT"])
        self.assertGreaterEqual(res_reg["summary"]["filtered_noise_count"], 1)

        # Worldwide scope must include the German GT
        res_global = score_and_categorize_community_events(
            raw_candidates=candidates,
            user_lat=32.9628,
            user_lng=-117.0359,
            local_radius_miles=50.0,
            max_drive_hours=2.0,
            majors_scope="global",
            game_system="40k",
        )
        global_major_ids = [e["id"] for e in res_global["destination_majors"]]
        self.assertIn("GERMAN_GT_1", global_major_ids)


class TestCommunityRecommendationEndpointsAndFrontend(unittest.TestCase):
    """Tests handler functions & FastAPI endpoints (/recommendations, /search, /field-stats) for schema & <1000ms latency, plus static frontend checks."""

    @classmethod
    def setUpClass(cls):
        if TestClient is not None:
            import server
            cls.client = TestClient(server.app)
        else:
            cls.client = None

    def test_recommendations_and_search_endpoints_sub_1s(self):
        from routers import community

        community._community_recs_cache.clear()
        community._community_search_cache.clear()

        future_dt = (datetime.now(timezone.utc) + timedelta(days=20)).strftime("%Y-%m-%d")
        sample_up = [
            {
                "id": "POWAY_RTT_99",
                "name": "North County Strike Force RTT",
                "event_date": future_dt,
                "city": "Escondido",
                "state": "CA",
                "country": "US",
                "venue_name": "Pair A Dice Games",
                "latitude": 33.1192,
                "longitude": -117.0864,
                "total_players": 24,
                "num_tickets": 32,
                "num_rounds": 3,
            },
            {
                "id": "CAL_CUP_LIVE_TEST",
                "name": "The California Cup 2026",
                "event_date": future_dt,
                "city": "Pomona",
                "state": "CA",
                "country": "US",
                "venue_name": "Fairplex",
                "latitude": 34.0825,
                "longitude": -117.7660,
                "total_players": 167,
                "num_tickets": 192,
                "num_rounds": 8,
            },
        ]
        sample_majors = [
            {
                "id": "LVO_CHAMPS_TEST",
                "name": "Las Vegas Open 40K Champs",
                "event_date": future_dt,
                "city": "Las Vegas",
                "state": "NV",
                "country": "US",
                "latitude": 36.1362,
                "longitude": -115.1512,
                "total_players": 800,
                "num_tickets": 1000,
                "num_rounds": 6,
                "tier": "super_major",
                "tier_weight": 4,
            }
        ]

        mock_db = MagicMock()
        mock_db._pool = None
        mock_db.fetch_bcp_upcoming_events.return_value = sample_up
        mock_db.get_events_field_stats.return_value = {}
        mock_db._bcp_upcoming_cache_dict = {
            (32.96, -117.04, 104, 120, "40k", True): (sample_up, time.time())
        }

        dummy_req = MagicMock()
        dummy_req.headers = {}
        dummy_req.cookies = {}

        with patch.object(community, "get_database", return_value=mock_db), \
             patch.object(community, "fetch_live_bcp_majors", return_value=sample_majors):
            community._bcp_majors_cache["40k"] = (time.time(), sample_majors)

            t0 = time.perf_counter()
            if self.client is not None:
                resp = self.client.get(
                    "/api/community/events/recommendations?lat=32.9628&lng=-117.0359&local_radius_miles=50&max_drive_hours=2&majors_scope=regional&game_system=40k"
                )
                self.assertEqual(resp.status_code, 200)
                body = resp.json()
            else:
                body = community.api_community_event_recommendations(
                    request=dummy_req,
                    lat=32.9628,
                    lng=-117.0359,
                    location_name="Poway, CA",
                    local_radius_miles=50.0,
                    max_drive_hours=2.0,
                    majors_scope="regional",
                    game_system="40k",
                    force_refresh=False,
                )
            rec_ms = (time.perf_counter() - t0) * 1000.0
            self.assertLess(rec_ms, 950.0, f"Recommendations endpoint took {rec_ms:.1f}ms (>950ms)")
            self.assertTrue(body["success"])
            self.assertEqual([e["id"] for e in body["local_events"]], ["POWAY_RTT_99"])
            self.assertEqual([e["id"] for e in body["driveable_events"]], ["CAL_CUP_LIVE_TEST"])
            self.assertIn("LVO_CHAMPS_TEST", [e["id"] for e in body["destination_majors"]])

            # Test warm L1 cache hit (<5ms)
            tw = time.perf_counter()
            warm_body = community.api_community_event_recommendations(
                request=dummy_req,
                lat=32.9628,
                lng=-117.0359,
                location_name="Poway, CA",
                local_radius_miles=50.0,
                max_drive_hours=2.0,
                majors_scope="regional",
                game_system="40k",
                force_refresh=False,
            )
            warm_ms = (time.perf_counter() - tw) * 1000.0
            self.assertLess(warm_ms, 10.0)
            self.assertTrue(warm_body["success"])

            # Test search endpoint (<1s)
            t1 = time.perf_counter()
            if self.client is not None:
                s_resp = self.client.get(
                    "/api/community/events/search?q=California%20Cup&lat=32.9628&lng=-117.0359&game_system=40k"
                )
                self.assertEqual(s_resp.status_code, 200)
                s_body = s_resp.json()
            else:
                s_body = community.api_community_event_search(
                    q="California Cup",
                    lat=32.9628,
                    lng=-117.0359,
                    game_system="40k",
                    include_past=True,
                    limit=40,
                )
            search_ms = (time.perf_counter() - t1) * 1000.0
            self.assertLess(search_ms, 950.0, f"Search endpoint took {search_ms:.1f}ms (>950ms)")
            self.assertTrue(s_body["success"])
            self.assertEqual(s_body["total"], 1)
            self.assertEqual(s_body["upcoming"][0]["id"], "CAL_CUP_LIVE_TEST")
            self.assertIn("drive", s_body["upcoming"][0]["drive_label"])

    def test_field_stats_cold_bcp_cap_under_1s(self):
        """api_community_events_field_stats must return in <850ms even when upstream BCP hangs for 3s."""
        from routers import community

        community._community_field_stats_cache.clear()
        mock_db = MagicMock()
        mock_db.get_events_field_stats.return_value = {}
        mock_elo = MagicMock()

        class _SlowScraper:
            def fetch_event_placings(self, eid):
                time.sleep(3.0)
                return []

        import asyncio

        with patch.object(community, "get_database", return_value=mock_db), \
             patch.object(community, "get_elo_engine", return_value=mock_elo), \
             patch.object(community, "BestCoastPairingsScraper", _SlowScraper):
            t0 = time.perf_counter()
            res = asyncio.run(
                community.api_community_events_field_stats(request=MagicMock(), event_ids="UNCACHED_EV_1,UNCACHED_EV_2", game_system="40k")
            )
            elapsed_ms = (time.perf_counter() - t0) * 1000.0

        self.assertLess(elapsed_ms, 850.0, f"Field stats cold path took {elapsed_ms:.1f}ms (>850ms)")
        self.assertTrue(res["success"])

    def test_frontend_recommendation_wiring_and_bundles(self):
        app_html = (ROOT_DIR / "web" / "app.html").read_text(encoding="utf-8")
        comm_js = (ROOT_DIR / "web" / "js" / "community.js").read_text(encoding="utf-8")
        bundle_js = (ROOT_DIR / "web" / "js" / "app.bundle.min.js").read_text(encoding="utf-8")
        styles_min = (ROOT_DIR / "web" / "css" / "styles.min.css").read_text(encoding="utf-8")

        for dom_id in (
            'id="comm-tournaments-search"',
            'id="comm-rec-tab-for_you"',
            'id="comm-rec-tab-driveable"',
            'id="comm-rec-tab-majors"',
            'id="comm-rec-tab-past"',
            'id="comm-drive-selector-wrap"',
            'id="comm-majors-scope-wrap"',
        ):
            self.assertIn(dom_id, app_html, f"Missing {dom_id} in web/app.html")

        for fn_name in (
            "loadCommunityEventRecommendations",
            "setCommunityRecTab",
            "setCommunityMaxDriveHours",
            "setCommunityMajorsScope",
            "clearCommunityTournamentsSearch",
        ):
            self.assertIn(fn_name, comm_js)
            self.assertIn(fn_name, bundle_js)

        self.assertIn(".comm-rec-header-shell", styles_min)
        self.assertIn(".comm-rec-tabs", styles_min)


if __name__ == "__main__":
    unittest.main()
