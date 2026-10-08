import sys
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

try:
    import psycopg2
except ImportError:
    sys.modules["psycopg2"] = MagicMock()
    sys.modules["psycopg2.extras"] = MagicMock()
    sys.modules["psycopg2.pool"] = MagicMock()

import database
from database import PostgresDatabase


class TestItcGlobalLeaderboard(unittest.TestCase):
    def setUp(self):
        # Reset in-memory caches before each test to test both cold and warm paths
        PostgresDatabase._itc_rankings_cache_map = {}
        PostgresDatabase._itc_seed_cache = None

    def _create_mock_db(self):
        db = PostgresDatabase.__new__(PostgresDatabase)
        db.get_connection = MagicMock()
        return db

    def test_seed_file_exists_and_populated(self):
        seed_path = root_dir / "data" / "itc_global_rankings_seed.json"
        self.assertTrue(seed_path.exists(), "data/itc_global_rankings_seed.json must exist")
        db = self._create_mock_db()

        res_40k_p = db.get_itc_leaderboard(category="players", page=1, page_size=25, game_system="40k")
        self.assertGreaterEqual(res_40k_p["total"], 100)
        self.assertEqual(len(res_40k_p["items"]), 25)
        self.assertEqual(res_40k_p["category"], "players")
        self.assertEqual(res_40k_p["game_system"], "40k")
        top_p = res_40k_p["items"][0]
        self.assertEqual(top_p["rank"], 1)
        self.assertIn("player_name", top_p)
        self.assertGreater(top_p["itc_points"], 1000.0)

        res_40k_t = db.get_itc_leaderboard(category="teams", page=1, page_size=25, game_system="40k")
        self.assertGreaterEqual(res_40k_t["total"], 100)
        self.assertEqual(len(res_40k_t["items"]), 25)
        self.assertEqual(res_40k_t["category"], "teams")
        top_t = res_40k_t["items"][0]
        self.assertEqual(top_t["rank"], 1)
        self.assertIn("team", top_t)
        self.assertGreater(top_t["itc_points"], 1000.0)

        res_aos_p = db.get_itc_leaderboard(category="players", page=1, page_size=25, game_system="aos")
        self.assertGreaterEqual(res_aos_p["total"], 100)
        self.assertEqual(res_aos_p["game_system"], "aos")

        res_aos_t = db.get_itc_leaderboard(category="teams", page=1, page_size=25, game_system="aos")
        self.assertGreaterEqual(res_aos_t["total"], 100)
        self.assertEqual(res_aos_t["game_system"], "aos")

    def test_latency_strictly_under_one_second(self):
        """Verifies cold-start and warm-cache latencies are well under the <1s (1000ms) requirement."""
        db = self._create_mock_db()

        # 1. Cold start latency (reading & parsing seed file + sorting + paginating)
        t0 = time.perf_counter()
        res_cold = db.get_itc_leaderboard(category="players", page=1, page_size=50, game_system="40k")
        cold_ms = (time.perf_counter() - t0) * 1000.0
        print(f"\n[Latency] Cold start (40k/players): {cold_ms:.2f}ms")
        self.assertLess(cold_ms, 1000.0, f"Cold start took {cold_ms:.2f}ms (must be < 1000ms)")
        self.assertLess(cold_ms, 150.0, f"Cold start took {cold_ms:.2f}ms (expected < 150ms)")
        self.assertEqual(len(res_cold["items"]), 50)

        # 2. Warm L1 cache latency across players & teams, 40k & AoS
        for gs in ("40k", "aos"):
            for cat in ("players", "teams"):
                # Prime cache once
                db.get_itc_leaderboard(category=cat, page=1, page_size=25, game_system=gs)
                t_warm_start = time.perf_counter()
                res_warm = db.get_itc_leaderboard(category=cat, page=2, page_size=25, game_system=gs)
                warm_ms = (time.perf_counter() - t_warm_start) * 1000.0
                print(f"[Latency] Warm L1 cache ({gs}/{cat}): {warm_ms:.2f}ms")
                self.assertLess(warm_ms, 1000.0, f"Warm call ({gs}/{cat}) took {warm_ms:.2f}ms (must be < 1000ms)")
                self.assertLess(warm_ms, 25.0, f"Warm call ({gs}/{cat}) took {warm_ms:.2f}ms (expected < 25ms)")
                self.assertEqual(len(res_warm["items"]), 25)

    def test_search_and_sorting(self):
        db = self._create_mock_db()

        # Search Individual 40k for "Innes"
        res_search = db.get_itc_leaderboard(category="players", query="Innes", game_system="40k")
        self.assertGreaterEqual(res_search["total"], 1)
        self.assertTrue(any("innes" in r["player_name"].lower() for r in res_search["items"]))

        # Search Team 40k for "Warmasters"
        res_team_search = db.get_itc_leaderboard(category="teams", query="Warmasters", game_system="40k")
        self.assertGreaterEqual(res_team_search["total"], 1)
        self.assertTrue(any("warmasters" in r["team"].lower() for r in res_team_search["items"]))

        # Sort by win_rate DESC
        res_wr = db.get_itc_leaderboard(category="players", sort_by="win_rate", order="DESC", page_size=10, game_system="40k")
        wrs = [r["win_rate"] for r in res_wr["items"]]
        self.assertEqual(wrs, sorted(wrs, reverse=True))

        # Sort by rank ASC
        res_rank = db.get_itc_leaderboard(category="teams", sort_by="rank", order="ASC", page_size=10, game_system="40k")
        ranks = [r["rank"] for r in res_rank["items"]]
        self.assertEqual(ranks, sorted(ranks))

    def test_frontend_and_router_wiring_present(self):
        router_py = (root_dir / "routers" / "leaderboard.py").read_text(encoding="utf-8")
        self.assertIn('"/api/leaderboard/itc"', router_py)
        self.assertIn('"/api/itc"', router_py)
        self.assertIn("get_itc_leaderboard", router_py)

        dev_server_py = (root_dir / "scripts" / "dev_server.py").read_text(encoding="utf-8")
        self.assertIn("api/leaderboard/itc", dev_server_py)
        self.assertIn("get_itc_leaderboard", dev_server_py)

        app_html = (root_dir / "web" / "app.html").read_text(encoding="utf-8")
        self.assertIn('id="lead-subtab-itc"', app_html)
        self.assertIn("switchLeaderboardSubtab('itc')", app_html)
        self.assertIn('id="lead-view-itc"', app_html)
        self.assertIn("setItcLeaderboardCategory('players')", app_html)
        self.assertIn("setItcLeaderboardCategory('teams')", app_html)
        self.assertIn('id="lead-itc-table"', app_html)

        bundle_js = (root_dir / "web" / "js" / "app.bundle.min.js").read_text(encoding="utf-8")
        self.assertIn("getItcLeaderboard", bundle_js)
        self.assertIn("loadLeaderboardItc", bundle_js)
        self.assertIn("setItcLeaderboardCategory", bundle_js)

    def test_uncapped_45k_rows_pagination_and_search_under_15ms(self):
        """Verifies that all 45,000+ BCP ITC rows are preserved without any 300/500 cap and paginate in <15ms."""
        db = self._create_mock_db()
        total_rows = 45000
        synthetic_45k = [
            {
                "rank": i,
                "player_id": f"bcp_user_{i}",
                "player_name": f"Commander {i}",
                "itc_points": round(2500.0 - (i * 0.05), 2),
                "events_scored": 6,
                "max_events": 6,
                "wins": 25,
                "losses": 5,
                "draws": 0,
                "matches_played": 30,
                "win_rate": 83.3,
                "current_elo": 1850.0,
                "peak_elo": 1900.0,
                "factions": "Space Marines",
                "top_faction": "Space Marines",
                "team": "Omni Vanguard",
                "game_system": "40k",
                "region_id": "76Z23pN941",
            }
            for i in range(1, total_rows + 1)
        ]
        PostgresDatabase._itc_rankings_cache_map["40k:player:76Z23pN941"] = (synthetic_45k, time.time())

        # Page 1 (1..100 of 45,000)
        t0 = time.perf_counter()
        res_p1 = db.get_itc_leaderboard(
            category="players", page=1, page_size=100, game_system="40k", region_id="76Z23pN941"
        )
        p1_ms = (time.perf_counter() - t0) * 1000.0
        self.assertEqual(res_p1["total"], 45000)
        self.assertEqual(res_p1["total_pages"], 450)
        self.assertEqual(len(res_p1["items"]), 100)
        self.assertEqual(res_p1["items"][0]["rank"], 1)
        self.assertEqual(res_p1["items"][99]["rank"], 100)
        self.assertLess(p1_ms, 15.0, f"Page 1 of 45,000 rows took {p1_ms:.2f}ms (expected <15ms)")

        # Page 450 (44,901..45,000 of 45,000)
        t1 = time.perf_counter()
        res_p450 = db.get_itc_leaderboard(
            category="players", page=450, page_size=100, game_system="40k", region_id="76Z23pN941"
        )
        p450_ms = (time.perf_counter() - t1) * 1000.0
        self.assertEqual(res_p450["total"], 45000)
        self.assertEqual(len(res_p450["items"]), 100)
        self.assertEqual(res_p450["items"][0]["rank"], 44901)
        self.assertEqual(res_p450["items"][99]["rank"], 45000)
        self.assertLess(p450_ms, 15.0, f"Page 450 of 45,000 rows took {p450_ms:.2f}ms (expected <15ms)")

        # Search across all 45,000 rows
        t2 = time.perf_counter()
        res_search = db.get_itc_leaderboard(
            category="players", query="Commander 44999", page=1, page_size=25, game_system="40k", region_id="76Z23pN941"
        )
        search_ms = (time.perf_counter() - t2) * 1000.0
        self.assertEqual(res_search["total"], 1)
        self.assertEqual(res_search["items"][0]["rank"], 44999)
        self.assertLess(search_ms, 100.0, f"Search across 45,000 rows took {search_ms:.2f}ms (expected <100ms)")

    def test_multi_page_bcp_nextkey_cursor_pagination(self):
        """Verifies _fetch_itc_rankings_from_bcp(fetch_all=True) follows nextKey cursors across all pages."""
        import json
        from unittest.mock import patch

        db = self._create_mock_db()
        pages_data = [
            {
                "data": [
                    {"rank": i, "points": 2000 - i, "userId": f"u_{i}", "user": {"firstName": "Player", "lastName": str(i)}}
                    for i in range(1, 401)
                ],
                "nextKey": "cursor_page_2",
            },
            {
                "data": [
                    {"rank": i, "points": 2000 - i, "userId": f"u_{i}", "user": {"firstName": "Player", "lastName": str(i)}}
                    for i in range(401, 801)
                ],
                "nextKey": "cursor_page_3",
            },
            {
                "data": [
                    {"rank": i, "points": 2000 - i, "userId": f"u_{i}", "user": {"firstName": "Player", "lastName": str(i)}}
                    for i in range(801, 1051)
                ],
                "nextKey": None,
            },
        ]
        call_idx = {"idx": 0}
        progress_counts = []

        class FakeResp:
            def __init__(self, payload):
                self._bytes = json.dumps(payload).encode("utf-8")
            def read(self):
                return self._bytes
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass

        def fake_urlopen(req, timeout=None):
            idx = call_idx["idx"]
            call_idx["idx"] += 1
            return FakeResp(pages_data[idx])

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            rows = db._fetch_itc_rankings_from_bcp(
                ptype="player",
                sys_key="40k",
                region_id="76Z23pN941",
                fetch_all=True,
                batch_size=400,
                on_page_callback=lambda partial, is_last: progress_counts.append((len(partial), is_last)),
            )

        self.assertEqual(len(rows), 1050)
        self.assertEqual(rows[0]["rank"], 1)
        self.assertEqual(rows[-1]["rank"], 1050)
        self.assertEqual(progress_counts, [(400, False), (800, False), (1050, True)])


if __name__ == "__main__":
    unittest.main()
