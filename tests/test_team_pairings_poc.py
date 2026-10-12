import asyncio
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

import firestore_db
import server


class TestTeamPairingsPoC(unittest.TestCase):
    def setUp(self):
        self.engine = firestore_db.FirestoreRoomEngine()
        # Use in-memory L1 mode without touching real Cloud Firestore during unit tests
        self.engine._db = None
        self.engine._init_attempted = True

    def test_admin_team_pairings_route_blocks_unauthenticated(self):
        """Unauthenticated requests to /admin/team-pairings or /team-pairings must redirect to /login."""
        mock_req = MagicMock()
        mock_req.headers = {}
        mock_req.cookies = {}
        mock_auth_mgr = MagicMock()
        mock_auth_mgr.get_session.return_value = None
        with patch.object(server, "get_auth_manager", return_value=mock_auth_mgr):
            resp = server.serve_admin_team_pairings(mock_req, token=None)
            status_code = getattr(resp, "status_code", None)
            self.assertEqual(status_code, 303)
            url = getattr(resp, "url", None) or (getattr(resp, "headers", {}) or {}).get("location", "")
            self.assertTrue(
                str(url).startswith("/login?redirect=/admin/team-pairings"),
                f"Unexpected redirect location: {url}",
            )

    def test_admin_team_pairings_route_blocks_non_admin_player(self):
        """Authenticated non-admin players must be redirected to /."""
        fake_player = {
            "user_id": "u_player_1",
            "email": "player@example.com",
            "display_name": "Regular Player",
            "role": "player",
            "is_admin": False,
        }
        mock_req = MagicMock()
        mock_req.headers = {}
        mock_req.cookies = {"session_token": "tok_player"}
        mock_auth_mgr = MagicMock()
        mock_auth_mgr.get_session.return_value = fake_player
        with patch.object(server, "get_auth_manager", return_value=mock_auth_mgr):
            resp = server.serve_admin_team_pairings(mock_req, token=None)
            status_code = getattr(resp, "status_code", None)
            self.assertEqual(status_code, 303)
            url = getattr(resp, "url", None) or (getattr(resp, "headers", {}) or {}).get("location", "")
            self.assertEqual(str(url), "/")

    def test_admin_team_pairings_route_serves_admin_and_static_assets(self):
        """Authenticated admin user can load /admin/team-pairings and its static assets."""
        fake_admin = {
            "user_id": "u_admin_1",
            "email": "hsiehjun@gmail.com",
            "display_name": "Admin Hsiehjun",
            "role": "admin",
            "is_admin": True,
        }
        mock_req = MagicMock()
        mock_req.headers = {}
        mock_req.cookies = {"session_token": "tok_admin"}
        mock_auth_mgr = MagicMock()
        mock_auth_mgr.get_session.return_value = fake_admin
        with patch.object(server, "get_auth_manager", return_value=mock_auth_mgr):
            resp = server.serve_admin_team_pairings(mock_req, token=None)
            tp_path = Path(str(getattr(resp, "path", "")))
            self.assertTrue(tp_path.is_file(), f"Expected FileResponse to index.html, got {tp_path}")
            html = tp_path.read_text(encoding="utf-8")
            self.assertIn("Team Pairings Lab", html)
            self.assertIn('id="roleSelectorPills"', html)
            self.assertIn('id="spectatorBanner"', html)
            self.assertIn('id="duelPodA"', html)
            self.assertIn('id="duelPodB"', html)
            self.assertIn('id="pairingsTableBody"', html)

        js_resp = server.serve_team_pairings_js()
        css_resp = server.serve_team_pairings_css()
        for file_resp, expected_name in [
            (js_resp, "app.js"),
            (css_resp, "styles.css"),
        ]:
            asset_path = Path(str(getattr(file_resp, "path", "")))
            self.assertTrue(asset_path.is_file(), f"Missing static asset: {asset_path}")
            self.assertEqual(asset_path.name, expected_name)

    def test_admin_only_navigation_buttons_wired(self):
        """Ensure Admin-only navigation entry points for Team Pairings exist across auth.js, app.html, admin.html, dice_tracker, and dev_server.py."""
        auth_js = (ROOT_DIR / "web" / "js" / "auth.js").read_text(encoding="utf-8")
        self.assertIn("header-admin-team-pairings-btn", auth_js)
        self.assertIn("/admin/team-pairings", auth_js)
        self.assertIn("mobile-opt-team-pairings", auth_js)
        self.assertIn("mobile-sheet-team-pairings-btn", auth_js)

        app_html = (ROOT_DIR / "web" / "app.html").read_text(encoding="utf-8")
        self.assertIn("val === 'team-pairings'", app_html)
        self.assertIn('id="mobile-opt-team-pairings"', app_html)
        self.assertIn('id="mobile-sheet-team-pairings-btn"', app_html)

        admin_html = (ROOT_DIR / "web" / "admin.html").read_text(encoding="utf-8")
        self.assertIn("/admin/team-pairings", admin_html)

        dice_html = (ROOT_DIR / "web" / "dice_tracker" / "index.html").read_text(encoding="utf-8")
        self.assertIn("/admin/team-pairings", dice_html)

        dev_server_py = (ROOT_DIR / "scripts" / "dev_server.py").read_text(encoding="utf-8")
        self.assertIn("admin/team-pairings", dev_server_py)

    def test_wtc_5v5_pairing_minigame_completes_all_5_tables_with_ai_captain_b(self):
        """Verify 5v5 WTC pairing state machine runs Cycle 1 + Cycle 2 and locks all 5 tables with 10 unique players."""
        room = self.engine.create_pairing_room(
            format_size="5v5",
            team_a_preset="art_of_war",
            team_b_preset="team_zero_comp",
            vs_ai=True,
            created_by="hsiehjun",
        )
        code = room["room_code"]
        tok_a = room["captain_a_token"]
        self.assertEqual(room["phase"], "STEP_1_DEFENDER")
        self.assertEqual(room["total_tables"], 5)
        self.assertEqual(len(room["team_a"]["roster"]), 5)
        self.assertEqual(len(room["team_b"]["roster"]), 5)

        # --- CYCLE 1: Step 1 (Put Defender) ---
        res1 = self.engine.apply_pairing_action(
            code,
            role="captain_a",
            captain_token=tok_a,
            action="lock_defender",
            payload={"player_id": "A1", "vs_ai": True},
        )
        self.assertTrue(res1["ok"])
        r1 = res1["room"]
        # Because vs_ai=True, Captain B also locked Defender and both revealed simultaneously!
        self.assertEqual(r1["phase"], "STEP_2_ATTACKERS")
        self.assertIsNotNone(r1["active_defender_a"])
        self.assertIsNotNone(r1["active_defender_b"])

        # --- CYCLE 1: Step 2 (Send 2 Attackers) ---
        bench_a = [p["id"] for p in r1["team_a"]["roster"] if p["status"] == "bench"]
        self.assertEqual(len(bench_a), 4)
        res2 = self.engine.apply_pairing_action(
            code,
            role="captain_a",
            captain_token=tok_a,
            action="lock_attackers",
            payload={"player_ids": bench_a[:2], "vs_ai": True},
        )
        self.assertTrue(res2["ok"])
        r2 = res2["room"]
        self.assertEqual(r2["phase"], "STEP_3_CHOOSE")
        self.assertEqual(len(r2["active_attackers_a"]), 2)
        self.assertEqual(len(r2["active_attackers_b"]), 2)

        # --- CYCLE 1: Step 3 (Defender Picks 1 of 2 Attackers) ---
        chosen_b_att = r2["active_attackers_b"][0]["id"]
        res3 = self.engine.apply_pairing_action(
            code,
            role="captain_a",
            captain_token=tok_a,
            action="lock_choice",
            payload={"player_id": chosen_b_att, "vs_ai": True},
        )
        self.assertTrue(res3["ok"])
        r3 = res3["room"]
        # Tables 1 & 2 are now locked, and we advance to Cycle 2 Step 1 with 3 bench players per team
        self.assertEqual(len(r3["pairings"]), 2)
        self.assertEqual(r3["cycle"], 2)
        self.assertEqual(r3["phase"], "STEP_1_DEFENDER")
        bench_a_c2 = [p["id"] for p in r3["team_a"]["roster"] if p["status"] == "bench"]
        self.assertEqual(len(bench_a_c2), 3)

        # --- CYCLE 2: Step 1 (Put Defender) -> Auto-promotes remaining 2 bench players as Attackers -> Advances to Step 3! ---
        res4 = self.engine.apply_pairing_action(
            code,
            role="captain_a",
            captain_token=tok_a,
            action="lock_defender",
            payload={"player_id": bench_a_c2[0], "vs_ai": True},
        )
        self.assertTrue(res4["ok"])
        r4 = res4["room"]
        self.assertEqual(r4["phase"], "STEP_3_CHOOSE")
        self.assertEqual(len(r4["active_attackers_a"]), 2)
        self.assertEqual(len(r4["active_attackers_b"]), 2)

        # --- CYCLE 2: Step 3 (Defender Picks 1 of 2 Attackers) -> Locks Tables 3, 4, and auto-locks Table 5! ---
        chosen_b_att_c2 = r4["active_attackers_b"][0]["id"]
        res5 = self.engine.apply_pairing_action(
            code,
            role="captain_a",
            captain_token=tok_a,
            action="lock_choice",
            payload={"player_id": chosen_b_att_c2, "vs_ai": True},
        )
        self.assertTrue(res5["ok"])
        r5 = res5["room"]
        self.assertEqual(r5["phase"], "COMPLETED")
        self.assertEqual(len(r5["pairings"]), 5)

        # Verify all 5 Team A players and all 5 Team B players are uniquely paired once
        paired_a_ids = {m["player_a"]["id"] for m in r5["pairings"]}
        paired_b_ids = {m["player_b"]["id"] for m in r5["pairings"]}
        self.assertEqual(paired_a_ids, {"A1", "A2", "A3", "A4", "A5"})
        self.assertEqual(paired_b_ids, {"B1", "B2", "B3", "B4", "B5"})

    def test_wtc_8v8_pairing_minigame_completes_all_8_tables(self):
        """Verify 8v8 WTC pairing state machine runs 3 cycles and locks all 8 tables (including Rejected vs Forgotten)."""
        room = self.engine.create_pairing_room(
            format_size="8v8",
            team_a_preset="stat_check",
            team_b_preset="team_ignite",
            vs_ai=True,
            created_by="hsiehjun",
        )
        code = room["room_code"]
        tok_a = room["captain_a_token"]
        self.assertEqual(room["total_tables"], 8)
        self.assertEqual(room["max_cycles"], 3)

        current = room
        for cycle_idx in range(3):
            self.assertEqual(current["phase"], "STEP_1_DEFENDER")
            bench_a = [p["id"] for p in current["team_a"]["roster"] if p["status"] == "bench"]
            res_def = self.engine.apply_pairing_action(
                code,
                role="captain_a",
                captain_token=tok_a,
                action="lock_defender",
                payload={"player_id": bench_a[0], "vs_ai": True},
            )
            self.assertTrue(res_def["ok"])
            current = res_def["room"]

            self.assertEqual(current["phase"], "STEP_2_ATTACKERS")
            bench_a2 = [p["id"] for p in current["team_a"]["roster"] if p["status"] == "bench"]
            res_att = self.engine.apply_pairing_action(
                code,
                role="captain_a",
                captain_token=tok_a,
                action="lock_attackers",
                payload={"player_ids": bench_a2[:2], "vs_ai": True},
            )
            self.assertTrue(res_att["ok"])
            current = res_att["room"]

            self.assertEqual(current["phase"], "STEP_3_CHOOSE")
            pick_b = current["active_attackers_b"][0]["id"]
            res_pick = self.engine.apply_pairing_action(
                code,
                role="captain_a",
                captain_token=tok_a,
                action="lock_choice",
                payload={"player_id": pick_b, "vs_ai": True},
            )
            self.assertTrue(res_pick["ok"])
            current = res_pick["room"]

        self.assertEqual(current["phase"], "COMPLETED")
        self.assertEqual(len(current["pairings"]), 8)
        paired_a_ids = {m["player_a"]["id"] for m in current["pairings"]}
        paired_b_ids = {m["player_b"]["id"] for m in current["pairings"]}
        self.assertEqual(paired_a_ids, {f"A{i}" for i in range(1, 9)})
        self.assertEqual(paired_b_ids, {f"B{i}" for i in range(1, 9)})

    def test_simultaneous_blind_pick_masking_and_spectator_read_only_enforcement(self):
        """Verify Spectators cannot act (403) and uncommitted secret picks are masked from opposing Captain and Spectators."""
        room = self.engine.create_pairing_room(
            format_size="5v5",
            team_a_preset="art_of_war",
            team_b_preset="team_zero_comp",
            vs_ai=False,  # Human Captain A vs Human Captain B
            created_by="hsiehjun",
        )
        code = room["room_code"]
        tok_a = room["captain_a_token"]
        tok_b = room["captain_b_token"]

        # 1. Spectator attempts to lock a Defender -> Must be rejected with 403 Forbidden
        spec_attempt = self.engine.apply_pairing_action(
            code,
            role="spectator",
            captain_token="",
            action="lock_defender",
            payload={"player_id": "A1", "vs_ai": False},
        )
        self.assertFalse(spec_attempt["ok"])
        self.assertEqual(spec_attempt["status_code"], 403)
        self.assertIn("Spectators are read-only", spec_attempt["error"])

        # 2. Captain A locks Defender A1 while Captain B has not locked yet
        cap_a_res = self.engine.apply_pairing_action(
            code,
            role="captain_a",
            captain_token=tok_a,
            action="lock_defender",
            payload={"player_id": "A1", "vs_ai": False},
        )
        self.assertTrue(cap_a_res["ok"])
        # Captain A can see their own secret pick ("A1")
        self.assertEqual(cap_a_res["room"]["secret_defender_a"], "A1")
        self.assertTrue(cap_a_res["room"]["secret_defender_a_locked"])
        self.assertIsNone(cap_a_res["room"]["active_defender_a"])

        # 3. Spectator and Captain B must NOT see which card Captain A picked ("secret_defender_a" is None),
        #    only that Captain A has locked in ("secret_defender_a_locked": True)
        raw_room = self.engine.get_pairing_room_raw(code)
        spec_view = self.engine.mask_pairing_room_for_viewer(raw_room, "spectator")
        cap_b_view = self.engine.mask_pairing_room_for_viewer(raw_room, "captain_b")
        self.assertTrue(spec_view["secret_defender_a_locked"])
        self.assertIsNone(spec_view["secret_defender_a"])
        self.assertTrue(cap_b_view["secret_defender_a_locked"])
        self.assertIsNone(cap_b_view["secret_defender_a"])

        # 4. Now Captain B locks Defender B1 -> Simultaneous reveal triggers!
        cap_b_res = self.engine.apply_pairing_action(
            code,
            role="captain_b",
            captain_token=tok_b,
            action="lock_defender",
            payload={"player_id": "B1", "vs_ai": False},
        )
        self.assertTrue(cap_b_res["ok"])
        revealed_room = cap_b_res["room"]
        self.assertEqual(revealed_room["phase"], "STEP_2_ATTACKERS")
        self.assertEqual(revealed_room["active_defender_a"]["id"], "A1")
        self.assertEqual(revealed_room["active_defender_b"]["id"], "B1")


if __name__ == "__main__":
    unittest.main()
