#!/usr/bin/env python3
"""Automated verification suite for Spectator Scorecard Routing & Live Scorecard Sync.

Verifies:
1. Spectators entering or viewing match rooms are routed directly to the verified digital scorecard
   instead of loading the interactive game tracker editing UI.
2. FastAPI server.py redirects GET /11th/tracker/play?match_id=...&role=spectator directly to /scorecard/{match_id}.
3. dev_server.py redirects spectators to /scorecard/{match_id} and serves scorecard.html.
4. web/tracker/tracker_sync.js routes spectators immediately to /scorecard/{matchId} on play page initialization
   and when joining a room as spectator.
5. web/js/tournaments.js spectateTournamentTracker navigates directly to /scorecard/{matchId}.
6. api_get_scorecard provides is_finished and status for live in-memory/Firestore rooms and completed games.
7. web/scorecard.html features live vs completed state badges, live match in progress banner, and real-time streaming.
"""

import sys
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))


class TestSpectatorScorecardRouting(unittest.TestCase):

    def test_tournaments_js_spectate_routes_to_scorecard(self):
        """Verify spectateTournamentTracker in web/js/tournaments.js navigates to /scorecard/{matchId}."""
        tournaments_js = (ROOT_DIR / "web" / "js" / "tournaments.js").read_text(encoding="utf-8")
        self.assertIn("async function spectateTournamentTracker", tournaments_js)
        self.assertIn("window.location.href = `/scorecard/${encodeURIComponent(matchId)}`;", tournaments_js)
        fn_body = tournaments_js.split("async function spectateTournamentTracker")[1].split("/* ==========================================================================")[0]
        self.assertNotIn("window.location.href = `/11th/tracker/play?match_id=${encodeURIComponent(matchId)}", fn_body)
        print("✓ test_tournaments_js_spectate_routes_to_scorecard passed")

    def test_tracker_sync_js_spectator_scorecard_redirection(self):
        """Verify web/tracker/tracker_sync.js immediately redirects spectators to /scorecard/{matchId}."""
        sync_js = (ROOT_DIR / "web" / "tracker" / "tracker_sync.js").read_text(encoding="utf-8")
        
        # 1. Early exit on isSpectatorExplicit in init()
        self.assertIn("const isSpectatorExplicit = params.get('role') === 'spectator' || params.get('spectate') === 'true';", sync_js)
        self.assertIn("window.location.replace(`/scorecard/${encodeURIComponent(matchId)}`);", sync_js)

        # 2. On join response role === 'spectator'
        self.assertIn("if (joinData.is_finished || joinData.role === 'spectator')", sync_js)

        # 3. Guard in updateSpectatorModeUI
        self.assertIn("if (isPlay && clientState.matchId)", sync_js)
        self.assertIn("window.location.replace(`/scorecard/${encodeURIComponent(clientState.matchId)}`);", sync_js)

        # 4. Room full prompt routes to scorecard
        self.assertIn("View Scorecard as Spectator?", sync_js)
        self.assertIn("window.location.href = `/scorecard/${encodeURIComponent(data.match_id || code)}`;", sync_js)
        print("✓ test_tracker_sync_js_spectator_scorecard_redirection passed")

    def test_server_py_spectator_redirects(self):
        """Verify server.py serve_tracker_html and alias routes redirect spectators to /scorecard/{match_id}."""
        server_py = (ROOT_DIR / "server.py").read_text(encoding="utf-8")

        self.assertIn('if (role == "spectator" or spectate == "true") and match_id:', server_py)
        self.assertIn('return RedirectResponse(url=f"/scorecard/{urllib.parse.quote(match_id)}", status_code=303)', server_py)
        self.assertIn('target = f"/scorecard/{urllib.parse.quote_plus(match_id)}"', server_py)
        print("✓ test_server_py_spectator_redirects passed")

    def test_dev_server_spectator_redirects_and_scorecard_serving(self):
        """Verify scripts/dev_server.py redirects spectators and serves scorecard."""
        dev_server_py = (ROOT_DIR / "scripts" / "dev_server.py").read_text(encoding="utf-8")
        self.assertIn('if (role == "spectator" or spectate == "true") and match_id:', dev_server_py)
        self.assertIn('self.send_header("Location", f"/scorecard/{urllib.parse.quote(match_id)}")', dev_server_py)
        self.assertIn('if clean_path.startswith("scorecard"):', dev_server_py)
        self.assertIn('if clean_path.startswith("api/scorecard/"):', dev_server_py)
        print("✓ test_dev_server_spectator_redirects_and_scorecard_serving passed")

    def test_api_get_scorecard_live_and_completed_status(self):
        """Verify api_get_scorecard returns is_finished and status for live and finished rooms."""
        import asyncio
        from routers.tracker import api_get_scorecard, TRACKER_ROOMS

        # 1. Live active in-memory room
        test_mid = "SPEC-TEST-LIVE-R1-T1"
        TRACKER_ROOMS[test_mid] = {
            "match_id": test_mid,
            "status": "active",
            "is_finished": False,
            "state": {
                "game": {"p1Name": "Alpha", "p2Name": "Beta", "roundNum": 2},
                "p1": {"score": 24, "rounds": [{"round": 1, "primaryScore": 10}, {"round": 2, "primaryScore": 14}]},
                "p2": {"score": 15, "rounds": [{"round": 1, "primaryScore": 5}, {"round": 2, "primaryScore": 10}]}
            }
        }

        try:
            res = asyncio.run(api_get_scorecard(test_mid))
            self.assertTrue(res["success"])
            self.assertFalse(res["is_finished"])
            self.assertEqual(res["status"], "active")
            self.assertEqual(res["state"]["game"]["p1Name"], "Alpha")
            self.assertEqual(res["state"]["p1"]["score"], 24)

            # 2. Mark completed
            TRACKER_ROOMS[test_mid]["is_finished"] = True
            TRACKER_ROOMS[test_mid]["status"] = "completed"
            res_done = asyncio.run(api_get_scorecard(test_mid))
            self.assertTrue(res_done["is_finished"])
            self.assertEqual(res_done["status"], "completed")
        finally:
            if test_mid in TRACKER_ROOMS:
                del TRACKER_ROOMS[test_mid]

        print("✓ test_api_get_scorecard_live_and_completed_status passed")

    def test_scorecard_html_live_badges_and_streaming(self):
        """Verify web/scorecard.html has live UI indicators, real-time polling, and conditional winner banner."""
        sc_html = (ROOT_DIR / "web" / "scorecard.html").read_text(encoding="utf-8")

        # 1. Live vs Final styling & DOM
        self.assertIn(".sc-badge-live", sc_html)
        self.assertIn(".sc-badge-pulse", sc_html)
        self.assertIn(".sc-live-banner", sc_html)
        self.assertIn("LIVE IN PROGRESS", sc_html)
        self.assertIn("Verified Scorecard", sc_html)

        # 2. Live match banner vs winner outcome
        self.assertIn("🔴 LIVE SCORECARD • Battle Round", sc_html)
        self.assertIn("winnerBanner.className = 'sc-winner-banner';", sc_html)

        # 3. Real-time updates & resilience
        self.assertIn("pollLiveScorecardQuietly()", sc_html)
        self.assertIn("setupLiveScorecardUpdates", sc_html)
        self.assertIn("initFirestoreLiveListener", sc_html)
        self.assertIn("visibilitychange", sc_html)
        self.assertIn("firebase-firestore-compat.js", sc_html)

        # 4. Tournament back link
        self.assertIn('id="sc-event-back-btn"', sc_html)
        print("✓ test_scorecard_html_live_badges_and_streaming passed")


if __name__ == "__main__":
    unittest.main()
