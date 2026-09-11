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
        self.assertIn("joinData.role === 'spectator'", sync_js)
        self.assertNotIn("joinData.role === 'referee'", sync_js)

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
        """Verify only the specific TO of that tournament gets referee; other TOs get spectator."""
        from routers.tracker import determine_existing_room_role, check_user_is_tournament_staff

        room = {
            "match_id": "BCP-GT2026-R1-T1",
            "is_tournament": True,
            "tournament_id": "GT2026",
            "organizer_id": "uid_john_to",
            "table_num": 1,
            "p1_uid": "uid_john3",
            "p1_name": "John3 Hsieh3",
            "p2_uid": "uid_john4",
            "p2_name": "John4 Hsieh4",
            "state": {
                "organizer_id": "uid_john_to",
                "game": {
                    "p1Name": "John3 Hsieh3",
                    "p2Name": "John4 Hsieh4",
                    "tournament_id": "GT2026",
                    "table_num": 1
                }
            }
        }

        # 1. John Hsieh (the actual TO of this specific tournament)
        to_user = {"id": "uid_john_to", "name": "John Hsieh", "display_name": "John Hsieh", "role": "to"}
        role, slot = determine_existing_room_role(to_user, room, "BCP-GT2026-R1-T1", None)
        self.assertEqual(role, "referee", f"Expected referee for actual tournament TO, got {role}")
        self.assertIsNone(slot, f"Expected slot None for TO referee, got {slot}")
        self.assertTrue(check_user_is_tournament_staff(to_user, room))

        # 1b. Another user who is ALSO a TO, but NOT the organizer of this event
        other_to_user = {"id": "uid_other_to", "name": "Other TO", "display_name": "Other TO", "role": "to", "can_access_to": True}
        other_role, other_slot = determine_existing_room_role(other_to_user, room, "BCP-GT2026-R1-T1", None)
        self.assertEqual(other_role, "spectator", f"Expected spectator for other tournament's TO, got {other_role}")
        self.assertIsNone(other_slot)
        self.assertFalse(check_user_is_tournament_staff(other_to_user, room))

        # 1c. Platform Admin user (global superuser)
        admin_user = {"id": "uid_admin", "name": "Admin User", "display_name": "Admin", "role": "admin"}
        a_role, a_slot = determine_existing_room_role(admin_user, room, "BCP-GT2026-R1-T1", None)
        self.assertEqual(a_role, "referee", f"Expected referee for platform admin, got {a_role}")
        self.assertTrue(check_user_is_tournament_staff(admin_user, room))

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
        print("✓ test_to_and_admin_referee_role_in_tournament_match passed")

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

    def test_event_deletion_purges_firestore_tournaments_events_and_subcollections(self):
        """Verify delete_tournament_and_rooms and delete_tournament_document purge Firestore tournaments, events, and room records."""
        from firestore_db import get_firestore_engine
        from unittest.mock import MagicMock

        fs = get_firestore_engine()

        # 1. Verify in-memory fallback purging for tournaments, judge calls, and rooms
        test_eid = "ES-test-del-123"
        clean_id = "test-del-123"
        upper_eid = test_eid.upper()

        fs._fallback_tournaments[test_eid] = {"id": test_eid, "name": "Deletion Test"}
        fs._fallback_tournaments[clean_id] = {"id": clean_id, "name": "Deletion Test Clean"}
        fs._fallback_judge_calls[test_eid] = [{"call_id": "call1"}]
        fs._fallback_judge_calls[upper_eid] = [{"call_id": "call2"}]

        test_room_1 = f"ES-{clean_id.upper()}-R1-T1"
        test_room_2 = "CUSTOM_ROOM_MATCH"
        fs._fallback_rooms[test_room_1] = {"eventId": test_eid, "match_id": test_room_1}
        fs._fallback_rooms[test_room_2] = {"state": {"game": {"eventId": clean_id}}, "match_id": test_room_2}

        result = fs.delete_tournament_and_rooms(test_eid)
        self.assertTrue(result.get("tournament_deleted"))
        self.assertEqual(result.get("event_id"), test_eid)
        self.assertNotIn(test_eid, fs._fallback_tournaments)
        self.assertNotIn(clean_id, fs._fallback_tournaments)
        self.assertNotIn(test_eid, fs._fallback_judge_calls)
        self.assertNotIn(upper_eid, fs._fallback_judge_calls)
        self.assertNotIn(test_room_1, fs._fallback_rooms)
        self.assertNotIn(test_room_2, fs._fallback_rooms)

        # 2. Verify mock client interactions delete from both 'tournaments' and 'events' collections and subcollections
        mock_client = MagicMock()
        mock_collections = {}

        def get_mock_col(col_name):
            if col_name not in mock_collections:
                mock_col = MagicMock()
                mock_collections[col_name] = mock_col
            return mock_collections[col_name]

        mock_client.collection.side_effect = get_mock_col

        old_client = fs._client
        fs._client = mock_client
        try:
            fs.delete_tournament_document("bcp_abc999")
            called_collections = [call[0][0] for call in mock_client.collection.call_args_list]
            self.assertIn("tournaments", called_collections)
            self.assertIn("events", called_collections)
        finally:
            fs._client = old_client

        # 3. Verify eventstudio.js has client-side cleanup across tournaments and events
        es_js = (ROOT_DIR / "web" / "js" / "eventstudio.js").read_text(encoding="utf-8")
        self.assertIn("['tournaments', 'events'].forEach(colName =>", es_js)
        self.assertIn("['judge_calls', 'pairings', 'rounds', 'messages', 'flags', 'players', 'participants']", es_js)
        self.assertIn("['eventId', 'event_id', 'tournament_id'].forEach(field =>", es_js)

        # 4. Verify routers/eventstudio.py calls delete_tournament_and_rooms on canonical and raw eids
        es_py = (ROOT_DIR / "routers" / "eventstudio.py").read_text(encoding="utf-8")
        self.assertIn("res = fs_engine.delete_tournament_and_rooms(eid)", es_py)
        self.assertIn('term_msg = {"type": "match_finalized", "is_finished": True, "event_deleted": True}', es_py)

        print("✓ test_event_deletion_purges_firestore_tournaments_events_and_subcollections passed")

    def test_strict_per_tournament_organizer_isolation(self):
        """Verify strict TO isolation: only the organizer of THAT specific tournament gets referee rights."""
        import asyncio
        from routers.tracker import (
            check_user_is_tournament_staff,
            api_tracker_check_room,
            api_tracker_save_state,
            TrackerStatePayload,
            TRACKER_ROOMS,
            TOURNAMENT_ORGANIZER_CACHE
        )
        from core import HTTPException

        event_id = "ISO-TEST-EV"
        match_id = f"BCP-{event_id}-R1-T1"

        TOURNAMENT_ORGANIZER_CACHE[event_id] = {
            "organizer_id": "to_alice",
            "organizer_bcp_id": "bcp_alice",
            "referee_ids": ["ref_charlie"],
            "cached_at": 9999999999.0
        }

        room = {
            "match_id": match_id,
            "event_id": event_id,
            "organizer_id": "to_alice",
            "organizer_bcp_id": "bcp_alice",
            "referee_ids": ["ref_charlie"],
            "user_id_p1": "p1_david",
            "user_id_p2": "p2_emily",
            "p1_name": "David",
            "p2_name": "Emily",
            "version": 1,
            "state": {
                "event_id": event_id,
                "game": {"p1Name": "David", "p2Name": "Emily", "eventId": event_id}
            }
        }
        TRACKER_ROOMS[match_id] = room

        try:
            alice = {"id": "to_alice", "name": "Alice", "role": "to"}
            alice_bcp = {"bcp_id": "bcp_alice", "name": "Alice BCP", "role": "to"}
            charlie = {"id": "ref_charlie", "name": "Charlie", "role": "referee"}
            bob_other_to = {"id": "to_bob", "name": "Bob", "role": "to", "can_access_to": True}
            superadmin = {"id": "admin_eve", "name": "Eve", "role": "admin"}
            competitor_p1 = {"id": "p1_david", "name": "David", "role": "user"}
            random_spectator = {"id": "user_frank", "name": "Frank", "role": "user"}

            # 1. Verify check_user_is_tournament_staff
            self.assertTrue(check_user_is_tournament_staff(alice, room, match_id=match_id))
            self.assertTrue(check_user_is_tournament_staff(alice_bcp, room, match_id=match_id))
            self.assertTrue(check_user_is_tournament_staff(charlie, room, match_id=match_id))
            self.assertTrue(check_user_is_tournament_staff(superadmin, room, match_id=match_id))
            # Bob is a TO for another event, NOT this one -> MUST be False!
            self.assertFalse(check_user_is_tournament_staff(bob_other_to, room, match_id=match_id))
            self.assertFalse(check_user_is_tournament_staff(competitor_p1, room, match_id=match_id))
            self.assertFalse(check_user_is_tournament_staff(random_spectator, room, match_id=match_id))

            # 2. Verify api_tracker_check_room (/check endpoint)
            check_alice = asyncio.run(api_tracker_check_room(match_id, user=alice))
            self.assertTrue(check_alice["is_referee"])
            self.assertFalse(check_alice["is_spectator"])
            self.assertEqual(check_alice["role"], "referee")

            check_bob = asyncio.run(api_tracker_check_room(match_id, user=bob_other_to))
            self.assertFalse(check_bob["is_referee"])
            self.assertTrue(check_bob["is_spectator"])
            self.assertEqual(check_bob["role"], "spectator")

            # 3. Verify api_tracker_save_state (/save_state endpoint)
            save_payload = TrackerStatePayload(match_id=match_id, state={"game": {"p1Name": "David", "p2Name": "Emily"}, "p1": {"score": 10}}, version=2)

            # Bob (other TO) is blocked with 403
            with self.assertRaises(HTTPException) as cm:
                asyncio.run(api_tracker_save_state(match_id, payload=save_payload, user=bob_other_to))
            self.assertEqual(cm.exception.status_code, 403)
            self.assertIn("Permission denied", cm.exception.detail)

            # Alice (actual TO) is authorized to save state
            save_res = asyncio.run(api_tracker_save_state(match_id, payload=save_payload, user=alice))
            self.assertTrue(save_res["success"])
            self.assertEqual(save_res["version"], 2)

        finally:
            if match_id in TRACKER_ROOMS:
                del TRACKER_ROOMS[match_id]
            if event_id in TOURNAMENT_ORGANIZER_CACHE:
                del TOURNAMENT_ORGANIZER_CACHE[event_id]

        print("✓ test_strict_per_tournament_organizer_isolation passed")

    def test_tournaments_js_strict_to_isolation(self):
        """Verify web/js/tournaments.js restricts isStaff to eventOrganizerIds or global admins."""
        js_content = (ROOT_DIR / "web" / "js" / "tournaments.js").read_text(encoding="utf-8")
        self.assertIn("const eventOrganizerIds = [", js_content)
        self.assertIn("currentEventData?.organizer_id", js_content)
        self.assertIn("currentEventData?.organizer_bcp_id", js_content)
        self.assertIn("const isEventOrganizer = Boolean(u && eventOrganizerIds.length > 0 && (", js_content)
        self.assertIn("const isStaff = Boolean(isGlobalAdmin || isEventOrganizer);", js_content)
        self.assertNotIn("userRole === 'to' || Boolean(u.can_access_to)", js_content)
        print("✓ test_tournaments_js_strict_to_isolation passed")

    def test_tournaments_js_pairings_render_user_role_defined(self):
        """Verify renderEventPairingsRows defines userRole before use so pairings render for all users."""
        js_content = (ROOT_DIR / "web" / "js" / "tournaments.js").read_text(encoding="utf-8")
        render_fn = js_content.split("function renderEventPairingsRows")[1].split("async function launchTournamentTracker")[0]
        
        # Verify userRole is declared
        self.assertIn("const userRole =", render_fn)
        user_role_idx = render_fn.find("const userRole =")
        is_admin_idx = render_fn.find("const isGlobalAdmin =")
        self.assertTrue(user_role_idx < is_admin_idx, "userRole must be defined BEFORE isGlobalAdmin is evaluated")
        
        # Verify row rendering is protected with try-catch
        self.assertIn("try {", render_fn)
        self.assertIn("catch (rowErr)", render_fn)
        print("✓ test_tournaments_js_pairings_render_user_role_defined passed")


if __name__ == "__main__":
    unittest.main()

