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

        # 2. On join response role === 'spectator' or 'referee'
        self.assertIn("joinData.role === 'spectator'", sync_js)
        self.assertIn("joinData.role === 'referee'", sync_js)

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

    def test_to_spectator_role_in_tournament_match(self):
        """Verify John Hsieh (TO) entering John3 vs John4 room gets spectator role and is not interactive player."""
        from routers.tracker import determine_existing_room_role

        room = {
            "match_id": "BCP-GT2026-R1-T1",
            "is_tournament": True,
            "tournament_id": "GT2026",
            "table_num": 1,
            "p1_uid": "uid_john3",
            "p1_name": "John3 Hsieh3",
            "p2_uid": "uid_john4",
            "p2_name": "John4 Hsieh4",
            "state": {
                "game": {
                    "p1Name": "John3 Hsieh3",
                    "p2Name": "John4 Hsieh4",
                    "tournament_id": "GT2026",
                    "table_num": 1
                }
            }
        }

        # 1. John Hsieh (TO) with role 'to' or 'admin'
        to_user = {"id": "uid_john_to", "name": "John Hsieh", "display_name": "John Hsieh", "role": "to"}
        role, slot = determine_existing_room_role(to_user, room, "BCP-GT2026-R1-T1", None)
        self.assertEqual(role, "spectator", f"Expected spectator for TO, got {role}")
        self.assertIsNone(slot, f"Expected slot None for TO spectator, got {slot}")

        # 2. Competitor John3 (p1)
        p1_user = {"id": "uid_john3", "name": "John3 Hsieh3", "display_name": "John3 Hsieh3", "role": "user"}
        p1_role, p1_slot = determine_existing_room_role(p1_user, room, "BCP-GT2026-R1-T1", None)
        self.assertEqual(p1_role, "player1")
        self.assertEqual(p1_slot, "user_id_p1")

        # 3. Competitor John4 (p2)
        p2_user = {"id": "uid_john4", "name": "John4 Hsieh4", "display_name": "John4 Hsieh4", "role": "user"}
        p2_role, p2_slot = determine_existing_room_role(p2_user, room, "BCP-GT2026-R1-T1", None)
        self.assertEqual(p2_role, "player2")
        self.assertEqual(p2_slot, "user_id_p2")

        # 4. Another spectator
        random_user = {"id": "uid_random", "name": "Random Spectator", "role": "user"}
        spec_role, spec_slot = determine_existing_room_role(random_user, room, "BCP-GT2026-R1-T1", None)
        self.assertEqual(spec_role, "spectator")
        self.assertIsNone(spec_slot)
        print("✓ test_to_spectator_role_in_tournament_match passed")

    def test_judge_call_resolution_clears_active_call(self):
        """Verify resolving a judge call nullifies active_judge_call in room and does not leave stale call."""
        import asyncio
        from routers.eventstudio import api_eventstudio_resolve_judge_call, JudgeCallResolvePayload
        from routers.tracker import TRACKER_ROOMS
        from firestore_db import get_firestore_engine

        fs_engine = get_firestore_engine()
        test_mid = "BCP-JUDGE-TEST-R1-T1"
        test_call_id = "call_test_123"
        call_data = {
            "id": test_call_id,
            "call_id": test_call_id,
            "status": "pending",
            "table_num": 1,
            "match_id": test_mid,
            "event_id": "TEST_TOURNEY"
        }

        # Setup room in memory and firestore engine
        TRACKER_ROOMS[test_mid] = {
            "match_id": test_mid,
            "active_judge_call": call_data,
            "state": {}
        }
        fs_engine.update_room(test_mid, {"active_judge_call": call_data})

        try:
            # Resolve call via EventStudio API
            payload = JudgeCallResolvePayload(
                call_id=test_call_id,
                status="resolved",
                assigned_judge="Head Judge John",
                match_id=test_mid,
                event_id="TEST_TOURNEY"
            )
            res = asyncio.run(api_eventstudio_resolve_judge_call(payload))
            self.assertTrue(res.get("success"))

            # Verify TRACKER_ROOMS active_judge_call is cleared to None
            self.assertIsNone(TRACKER_ROOMS[test_mid].get("active_judge_call"))

            # Verify in Firestore engine room data
            room_snap = fs_engine.get_room(test_mid)
            self.assertIsNone(room_snap.get("active_judge_call"))
        finally:
            if test_mid in TRACKER_ROOMS:
                del TRACKER_ROOMS[test_mid]

        print("✓ test_judge_call_resolution_clears_active_call passed")

    def test_unified_firestore_collections_no_events_collection(self):
        """Verify no writes to Firestore 'events' collection exist across python and client js."""
        fs_py = (ROOT_DIR / "firestore_db.py").read_text(encoding="utf-8")
        self.assertNotIn("collection('events')", fs_py)
        self.assertNotIn('collection("events")', fs_py)
        self.assertIn('self._client.collection("tournaments")', fs_py)

        es_js = (ROOT_DIR / "web" / "js" / "eventstudio.js").read_text(encoding="utf-8")
        self.assertNotIn("collection('events')", es_js)
        self.assertNotIn('collection("events")', es_js)

        ts_js = (ROOT_DIR / "web" / "tracker" / "tracker_sync.js").read_text(encoding="utf-8")
        self.assertNotIn("collection('events')", ts_js)
        self.assertNotIn('collection("events")', ts_js)

        print("✓ test_unified_firestore_collections_no_events_collection passed")

        print("✓ test_unified_firestore_collections_no_events_collection passed")


if __name__ == "__main__":
    unittest.main()

