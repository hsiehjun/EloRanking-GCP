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
        """Ensure Admin-only navigation entry points for Team Pairings exist across auth.js, app.html, admin.html, dice_tracker, and dev_server.py, and top-right header Pairings button is removed."""
        auth_js = (ROOT_DIR / "web" / "js" / "auth.js").read_text(encoding="utf-8")
        self.assertNotIn("header-admin-team-pairings-btn", auth_js)
        self.assertNotIn("/admin/team-pairings", auth_js)
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

    def test_seat_selection_and_custom_searched_team_roster_builder(self):
        """Verify Captains can claim seats and build custom 5-card team hands via player search."""
        room = self.engine.create_pairing_room(
            format_size="5v5",
            team_a_preset="art_of_war",
            team_b_preset="team_zero_comp",
            vs_ai=True,
            created_by="hsiehjun",
        )
        code = room["room_code"]
        tok_a = room["captain_a_token"]

        # Claim Captain A seat
        seat_res = self.engine.apply_pairing_action(
            code,
            role="captain_a",
            captain_token="",
            action="claim_seat",
            payload={},
        )
        self.assertTrue(seat_res["ok"])
        self.assertEqual(seat_res["captain_token"], tok_a)

        # Build custom 5-player hand from searched players
        custom_players = [
            {"name": "Nemo", "faction": "Adeptus Custodes", "elo": 2145, "role_tag": "Blunt / Defender"},
            {"name": "conankun", "faction": "T'au Empire", "elo": 2120, "role_tag": "All-Rounder"},
            {"name": "Innes Wilson", "faction": "Genestealer Cults", "elo": 2180, "role_tag": "Spear / Attacker"},
            {"name": "Folger Pyles", "faction": "Adeptus Custodes", "elo": 2140, "role_tag": "Blunt / Defender"},
            {"name": "Vik Vijay", "faction": "Grey Knights", "elo": 2112, "role_tag": "All-Rounder"},
        ]
        roster_res = self.engine.apply_pairing_action(
            code,
            role="captain_a",
            captain_token=tok_a,
            action="set_team_roster",
            payload={
                "team_name": "SoCal Vanguard",
                "team_tag": "SCV",
                "roster": custom_players,
            },
        )
        self.assertTrue(roster_res["ok"])
        updated_room = roster_res["room"]
        self.assertEqual(updated_room["team_a"]["name"], "SoCal Vanguard")
        self.assertEqual(updated_room["team_a"]["tag"], "SCV")
        self.assertEqual(
            [p["name"] for p in updated_room["team_a"]["roster"]],
            ["Nemo", "conankun", "Innes Wilson", "Folger Pyles", "Vik Vijay"],
        )

    def test_real_teams_and_players_search_and_zero_mock_data(self):
        """Verify search_real_teams_and_players returns real players for both team and player queries, and empty query returns no pre-populated items."""
        app_js = (ROOT_DIR / "web" / "team_pairings" / "app.js").read_text(encoding="utf-8")
        self.assertNotIn("SEARCHABLE_PLAYERS_POOL", app_js)
        self.assertNotIn("isCustom: true", app_js)
        self.assertIn("/api/team-pairings/search", app_js)
        self.assertNotIn("teamRosterPlayersSection", app_js)

        # Empty query must return empty lists (never pre-populate bottom search tray)
        empty_res = self.engine.search_real_teams_and_players(query="", game_system="40k")
        self.assertTrue(empty_res["ok"])
        self.assertEqual(empty_res["players"], [])
        self.assertEqual(empty_res["teams"], [])

        # Searching a team name returns all matching players directly in `players`
        search_res = self.engine.search_real_teams_and_players(query="Team Zero Comp", game_system="40k")
        self.assertTrue(search_res["ok"])
        self.assertGreaterEqual(len(search_res["players"]), 5)
        self.assertTrue(any("Team Zero Comp" in p.get("team", "") for p in search_res["players"]))

        # Creating a room with empty_rosters=True starts with empty rosters (0 / 5 cards in hand)
        empty_room = self.engine.create_pairing_room({"format": "5v5", "empty_rosters": True, "ai_opponent": True})
        self.assertEqual(empty_room["team_a"]["roster"], [])
        self.assertEqual(empty_room["team_b"]["roster"], [])
        self.assertEqual(empty_room["bench_a"], [])
        self.assertEqual(empty_room["bench_b"], [])

    def test_retribution_armory_faction_svgs_and_clean_lobby_modal_wired(self):
        """Verify Retribution Armory faction SVGs, Game Tracker Share Room modal, and removal of Team Roster drawer / Your Name / Room Code."""
        html = (ROOT_DIR / "web" / "team_pairings" / "index.html").read_text(encoding="utf-8")
        self.assertIn('/js/armory_svgs.js', html)
        self.assertNotIn('id="teamRosterPlayersSection"', html)
        self.assertNotIn('id="lobbyUserNameInput"', html)
        self.assertNotIn('id="lobbyRoomCodeText"', html)
        self.assertNotIn('id="roomCodeBadge"', html)
        self.assertIn('id="btnLobbyShareModal"', html)
        self.assertIn('id="btnTopbarShareModal"', html)

        app_js = (ROOT_DIR / "web" / "team_pairings" / "app.js").read_text(encoding="utf-8")
        self.assertIn("getArmoryAvatarSvg", app_js)
        self.assertIn("gt-share-room-modal", app_js)
        self.assertIn("avatar_aeldari", app_js)
        self.assertIn("avatar_necrons", app_js)
        self.assertIn("avatar_adeptus_custodes", app_js)
        self.assertIn("avatar_world_eaters", app_js)
        self.assertNotIn("yc-stars", app_js)
        self.assertNotIn("starsCount", app_js)
        self.assertNotIn("shortRole", app_js)
        self.assertNotIn("role_tag", app_js)

    def test_game_tracker_style_seat_locking_and_room_lock_access(self):
        """Verify Game Tracker-style seat locking (409 when seat taken by another user), seat unlocking, room lock, and shared link access."""
        room = self.engine.create_pairing_room({
            "format_size": "5v5",
            "team_a_preset": "art_of_war",
            "team_b_preset": "team_zero_comp",
            "vs_ai": False,
            "owner_id": "user_alpha",
        })
        code = room["room_code"]

        # 1. User Alpha claims Team A Captain seat -> Seat A becomes locked to user_alpha
        claim_a = self.engine.apply_pairing_action(code, {
            "action": "claim_seat",
            "role": "captain_a",
            "user_id": "user_alpha",
            "user_name": "Alpha Cap",
        })
        self.assertTrue(claim_a["ok"])
        self.assertTrue(claim_a["room"]["seat_a_locked"])
        self.assertEqual(claim_a["room"]["user_id_cap_a"], "user_alpha")
        self.assertEqual(claim_a["room"]["seat_a_owner_name"], "Alpha Cap")

        # 2. User Beta tries to claim Team A Captain seat -> Rejected with 409 Conflict because seat is locked!
        steal_a = self.engine.apply_pairing_action(code, {
            "action": "claim_seat",
            "role": "captain_a",
            "user_id": "user_beta",
            "user_name": "Beta Cap",
            "captain_token": "",
        })
        self.assertFalse(steal_a["ok"])
        self.assertEqual(steal_a["status_code"], 409)
        self.assertIn("locked", steal_a["error"].lower())

        # 3. User Beta claims open Team B Captain seat -> Succeeds and locks Seat B!
        claim_b = self.engine.apply_pairing_action(code, {
            "action": "claim_seat",
            "role": "captain_b",
            "user_id": "user_beta",
            "user_name": "Beta Cap",
        })
        self.assertTrue(claim_b["ok"])
        self.assertTrue(claim_b["room"]["seat_b_locked"])
        self.assertEqual(claim_b["room"]["user_id_cap_b"], "user_beta")

        # 4. User Beta unlocks/leaves Seat B -> Seat B is open again
        unlock_b = self.engine.apply_pairing_action(code, {
            "action": "unlock_seat",
            "role": "captain_b",
            "user_id": "user_beta",
            "captain_token": claim_b["captain_token"],
        })
        self.assertTrue(unlock_b["ok"])
        self.assertFalse(unlock_b["room"]["seat_b_locked"])

        # 5. Room owner locks the room -> User Gamma cannot claim open Seat B (403 Forbidden)
        lock_room = self.engine.apply_pairing_action(code, {
            "action": "toggle_room_lock",
            "user_id": "user_alpha",
            "captain_token": claim_a["captain_token"],
        })
        self.assertTrue(lock_room["ok"])
        self.assertTrue(lock_room["room"]["is_locked"])

        gamma_claim = self.engine.apply_pairing_action(code, {
            "action": "claim_seat",
            "role": "captain_b",
            "user_id": "user_gamma",
            "user_name": "Gamma",
        })
        self.assertFalse(gamma_claim["ok"])
        self.assertEqual(gamma_claim["status_code"], 403)

        # 6. Shared room URL (?room=WTC-XXXX) allows any player/guest with the link to load the lobby HTML
        mock_req = MagicMock()
        mock_req.headers = {}
        mock_req.cookies = {}
        mock_req.query_params = {"room": code}
        mock_auth_mgr = MagicMock()
        mock_auth_mgr.get_session.return_value = None
        with patch.object(server, "get_auth_manager", return_value=mock_auth_mgr):
            resp = server.serve_admin_team_pairings(mock_req, token=None)
            tp_path = Path(str(getattr(resp, "path", "")))
            self.assertTrue(tp_path.is_file(), f"Expected shared room link to serve index.html, got {resp}")

    def test_all_team_pairings_apis_strict_sub_1s_latency(self):
        """Verify every Team Pairings API operation completes well under 1000ms (1.0s)."""
        import time

        # 1. Search empty query (cold + warm)
        t0 = time.perf_counter()
        s1 = self.engine.search_real_teams_and_players(query="", game_system="40k", limit=24)
        ms_s1 = (time.perf_counter() - t0) * 1000.0
        self.assertTrue(s1["ok"])
        self.assertLess(ms_s1, 1000.0, f"search_real_teams_and_players('') took {ms_s1:.1f}ms (> 1000ms)")

        # 2. Search specific team/player query
        t0 = time.perf_counter()
        s2 = self.engine.search_real_teams_and_players(query="Team Zero Comp", game_system="40k", limit=24)
        ms_s2 = (time.perf_counter() - t0) * 1000.0
        self.assertTrue(s2["ok"])
        self.assertLess(ms_s2, 1000.0, f"search_real_teams_and_players('Team Zero Comp') took {ms_s2:.1f}ms (> 1000ms)")

        # 3. Get real team roster
        t0 = time.perf_counter()
        r1 = self.engine.get_real_team_roster("Team Zero Comp", game_system="40k")
        ms_r1 = (time.perf_counter() - t0) * 1000.0
        self.assertTrue(r1["ok"])
        self.assertLess(ms_r1, 1000.0, f"get_real_team_roster('Team Zero Comp') took {ms_r1:.1f}ms (> 1000ms)")

        # 4. Create room + get room + apply action
        t0 = time.perf_counter()
        created = self.engine.create_pairing_room({"format": "5v5", "ai_opponent": True})
        ms_create = (time.perf_counter() - t0) * 1000.0
        self.assertLess(ms_create, 1000.0, f"create_pairing_room took {ms_create:.1f}ms (> 1000ms)")

        code = created["room_code"]
        t0 = time.perf_counter()
        raw_room = self.engine.get_pairing_room_raw(code)
        fetched = self.engine.mask_pairing_room_for_viewer(raw_room, "captain_a", created["captain_a_token"])
        ms_get = (time.perf_counter() - t0) * 1000.0
        self.assertIsNotNone(fetched)
        self.assertLess(ms_get, 1000.0, f"get_pairing_room_raw + mask_pairing_room_for_viewer took {ms_get:.1f}ms (> 1000ms)")

        t0 = time.perf_counter()
        act = self.engine.apply_pairing_action(code, {
            "action": "claim_seat",
            "role": "captain_a",
            "user_id": "perf_test_u",
            "user_name": "Perf Cap",
            "captain_token": created["captain_a_token"],
        })
        ms_act = (time.perf_counter() - t0) * 1000.0
        self.assertTrue(act["ok"])
        self.assertLess(ms_act, 1000.0, f"apply_pairing_action took {ms_act:.1f}ms (> 1000ms)")

    def test_switch_5v5_room_to_8v8_locks_8_cards_and_8_tables(self):
        """Verify switching a room created as 5v5 to 8v8 via set_format or set_team_roster sets 8 cards, 8 tables, and 3 cycles."""
        created = self.engine.create_pairing_room({"format_size": "5v5", "empty_rosters": True, "vs_ai": True, "user_id": "u_8v8"})
        code = created["room_code"]
        tok_a = created["captain_a_token"]
        self.assertEqual(created["team_size"], 5)
        self.assertEqual(created["total_tables"], 5)

        # 1. Switch format via set_format
        fmt_res = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": "u_8v8",
            "captain_token": tok_a,
            "action": "set_format",
            "payload": {"format_size": "8v8"},
        })
        self.assertTrue(fmt_res["ok"])
        self.assertEqual(fmt_res["room"]["format_size"], "8v8")
        self.assertEqual(fmt_res["room"]["team_size"], 8)
        self.assertEqual(fmt_res["room"]["total_tables"], 8)
        self.assertEqual(fmt_res["room"]["max_cycles"], 3)

        # 2. Submit 8-player roster via set_team_roster (even on a room originally created as 5v5)
        created2 = self.engine.create_pairing_room({"format_size": "5v5", "empty_rosters": True, "vs_ai": True, "user_id": "u_8v8_b"})
        code2 = created2["room_code"]
        tok2 = created2["captain_a_token"]
        eight_players = [
            {"name": f"Eight Card Duelist {i}", "faction": "Blood Angels", "elo": 2100 - i * 10}
            for i in range(1, 9)
        ]
        roster_res = self.engine.apply_pairing_action(code2, {
            "role": "captain_a",
            "user_id": "u_8v8_b",
            "captain_token": tok2,
            "action": "set_team_roster",
            "payload": {
                "format_size": "8v8",
                "team_name": "BATOOSKA",
                "team_tag": "BTK",
                "roster": eight_players,
            },
        })
        self.assertTrue(roster_res["ok"])
        r2 = roster_res["room"]
        self.assertEqual(r2["format_size"], "8v8")
        self.assertEqual(r2["team_size"], 8)
        self.assertEqual(r2["total_tables"], 8)
        self.assertEqual(r2["max_cycles"], 3)
        self.assertEqual(len(r2["team_a"]["roster"]), 8)
        self.assertEqual(len(r2["team_b"]["roster"]), 8)
        self.assertEqual([p["id"] for p in r2["team_a"]["roster"]], [f"A{i}" for i in range(1, 9)])
        self.assertEqual([p["id"] for p in r2["team_b"]["roster"]], [f"B{i}" for i in range(1, 9)])

    def test_coin_flip_and_alternating_defender_attacker_cycles(self):
        """Verify Coin Flip winner chooses Defender or Attacker (never defaulting Team A to Defender), AI responds automatically, and roles swap every cycle."""
        html = (ROOT_DIR / "web" / "team_pairings" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="coinFlipModalBackdrop"', html)
        self.assertIn('id="btnFlipCoinNow"', html)
        self.assertIn('id="btnChooseDefenderRole"', html)
        self.assertIn('id="btnChooseAttackerRole"', html)

        created = self.engine.create_pairing_room({"format_size": "5v5", "vs_ai": True, "user_id": "cap_a_coin"})
        code = created["room_code"]
        tok_a = created["captain_a_token"]
        self.assertFalse(created["coin_flip_done"])
        self.assertIsNone(created["defender_role"])
        self.assertIsNone(created["attacker_role"])

        # 1. Flip the coin
        flip_res = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": "cap_a_coin",
            "captain_token": tok_a,
            "action": "flip_coin",
            "payload": {"force_winner": "captain_a"},
        })
        self.assertTrue(flip_res["ok"])
        self.assertEqual(flip_res["room"]["coin_flip_winner"], "captain_a")

        # 2. Team A chooses ATTACKER for Cycle 1!
        #    -> Team B (AI) becomes DEFENDER for Cycle 1, immediately places 1 Defender on the mat,
        #       and advances phase to STEP_2_ATTACKERS so Team A can send 2 Attackers!
        choose_res = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": "cap_a_coin",
            "captain_token": tok_a,
            "action": "choose_coin_flip_role",
            "payload": {"choice": "attacker", "chooser_role": "captain_a", "vs_ai": True},
        })
        self.assertTrue(choose_res["ok"])
        r1 = choose_res["room"]
        self.assertTrue(r1["coin_flip_done"])
        self.assertEqual(r1["defender_role"], "captain_b")
        self.assertEqual(r1["attacker_role"], "captain_a")
        self.assertEqual(r1["cycle"], 1)
        self.assertEqual(r1["max_cycles"], 4)
        self.assertEqual(r1["phase"], "STEP_2_ATTACKERS")
        self.assertIsNotNone(r1["active_defender_b"])
        self.assertIsNone(r1["active_defender_a"])

        # 3. Team A (Attacker in Cycle 1) sends 2 Attackers (A1, A2).
        #    -> AI (Defender in Cycle 1) immediately picks 1 to fight (locks Table #1),
        #       returns the unchosen Attacker to Team A's hand, and SWAPS ROLES for Cycle 2!
        c1_att_res = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": "cap_a_coin",
            "captain_token": tok_a,
            "action": "lock_attackers",
            "payload": {"player_ids": ["A1", "A2"], "vs_ai": True},
        })
        self.assertTrue(c1_att_res["ok"])
        r2 = c1_att_res["room"]
        self.assertEqual(len(r2["pairings"]), 1)
        self.assertEqual(r2["cycle"], 2)
        self.assertEqual(r2["defender_role"], "captain_a")
        self.assertEqual(r2["attacker_role"], "captain_b")
        self.assertEqual(r2["phase"], "STEP_1_DEFENDER")

        # 4. Cycle 2: Team A is now DEFENDER! Team A places 1 Defender -> AI (now Attacker) immediately sends 2 Attackers -> STEP_3_CHOOSE
        bench_a_c2 = [p["id"] for p in r2["team_a"]["roster"] if p["status"] == "bench"]
        self.assertEqual(len(bench_a_c2), 4)
        c2_def_res = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": "cap_a_coin",
            "captain_token": tok_a,
            "action": "lock_defender",
            "payload": {"player_id": bench_a_c2[0], "vs_ai": True},
        })
        self.assertTrue(c2_def_res["ok"])
        r2_step3 = c2_def_res["room"]
        self.assertEqual(r2_step3["phase"], "STEP_3_CHOOSE")
        self.assertEqual(len(r2_step3["active_attackers_b"]), 2)

        # Team A (Defender in Cycle 2) picks 1 of AI's 2 Attackers -> locks Table #2, swaps roles for Cycle 3,
        # and AI (Defender in Cycle 3) immediately places its Defender for Cycle 3!
        c2_pick_res = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": "cap_a_coin",
            "captain_token": tok_a,
            "action": "lock_choice",
            "payload": {"player_id": r2_step3["active_attackers_b"][0]["id"], "vs_ai": True},
        })
        self.assertTrue(c2_pick_res["ok"])
        r3 = c2_pick_res["room"]
        self.assertEqual(len(r3["pairings"]), 2)
        self.assertEqual(r3["cycle"], 3)
        self.assertEqual(r3["defender_role"], "captain_b")
        self.assertEqual(r3["attacker_role"], "captain_a")
        self.assertEqual(r3["phase"], "STEP_2_ATTACKERS")
        self.assertIsNotNone(r3["active_defender_b"])

        # 5. Cycle 3: Team A (Attacker) sends 2 Attackers -> AI picks 1 (locks Table #3) -> swaps roles for Cycle 4 (Final)
        bench_a_c3 = [p["id"] for p in r3["team_a"]["roster"] if p["status"] == "bench"]
        self.assertEqual(len(bench_a_c3), 3)
        c3_att_res = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": "cap_a_coin",
            "captain_token": tok_a,
            "action": "lock_attackers",
            "payload": {"player_ids": bench_a_c3[:2], "vs_ai": True},
        })
        self.assertTrue(c3_att_res["ok"])
        r4 = c3_att_res["room"]
        self.assertEqual(len(r4["pairings"]), 3)
        self.assertEqual(r4["cycle"], 4)
        self.assertEqual(r4["defender_role"], "captain_a")
        self.assertEqual(r4["attacker_role"], "captain_b")
        self.assertEqual(r4["phase"], "STEP_1_DEFENDER")

        # 6. Cycle 4 (Final): Team A (Defender) places 1 of last 2 cards -> AI sends last 2 cards -> Team A picks 1 -> locks Tables #4 and #5!
        bench_a_c4 = [p["id"] for p in r4["team_a"]["roster"] if p["status"] == "bench"]
        self.assertEqual(len(bench_a_c4), 2)
        c4_def_res = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": "cap_a_coin",
            "captain_token": tok_a,
            "action": "lock_defender",
            "payload": {"player_id": bench_a_c4[0], "vs_ai": True},
        })
        self.assertTrue(c4_def_res["ok"])
        r4_step3 = c4_def_res["room"]
        self.assertEqual(r4_step3["phase"], "STEP_3_CHOOSE")
        self.assertEqual(len(r4_step3["active_attackers_b"]), 2)

        c4_pick_res = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": "cap_a_coin",
            "captain_token": tok_a,
            "action": "lock_choice",
            "payload": {"player_id": r4_step3["active_attackers_b"][0]["id"], "vs_ai": True},
        })
        self.assertTrue(c4_pick_res["ok"])
        r_done = c4_pick_res["room"]
        self.assertEqual(r_done["phase"], "COMPLETED")
        self.assertEqual(len(r_done["pairings"]), 5)
        self.assertEqual({m["player_a"]["id"] for m in r_done["pairings"]}, {"A1", "A2", "A3", "A4", "A5"})
        self.assertEqual({m["player_b"]["id"] for m in r_done["pairings"]}, {"B1", "B2", "B3", "B4", "B5"})

    def test_six_factor_predict_matchup_outcome_and_zero_elo_impact(self):
        """Verify 6-factor prediction engine uses Elo, 3M Faction H2H, 3M Meta Form, Career Mastery, and Player H2H without touching Elo or in-event stats."""
        player_a = {
            "id": "A_TEST",
            "name": "John Lennon",
            "faction": "Aeldari",
            "elo": 1850,
            "win_rate": 72.0,
            "matches_played": 45,
            "vs_faction_wr": 68.0,
            "vs_faction_games": 15,
            "past_h2h_wins": 4,
            "past_h2h_losses": 1,
            "past_h2h_draws": 0,
        }
        player_b = {
            "id": "B_TEST",
            "name": "Brian Pullen",
            "faction": "Imperial Knights",
            "elo": 1850,
            "win_rate": 48.0,
            "matches_played": 30,
            "vs_faction_wr": 35.0,
            "vs_faction_games": 12,
        }

        pred = self.engine.predict_matchup_outcome(player_a, player_b)
        self.assertIn("win_prob_a", pred)
        self.assertIn("win_prob_b", pred)
        self.assertEqual(pred["win_prob_a"] + pred["win_prob_b"], 100)
        self.assertEqual(pred["base_elo_delta"], 0)
        # Even at equal 1850 Elo, Aeldari's favorable 3M H2H vs Imperial Knights + higher faction mastery + 4-1 H2H gives Player A > 55% win prob
        self.assertGreater(pred["win_prob_a"], 55)
        self.assertGreater(pred["wtc_score_a"], 10)
        self.assertEqual(pred["wtc_score_a"] + pred["wtc_score_b"], 20)

        factors = pred["factors"]
        self.assertGreater(factors["fac_h2h_delta"], 0)
        self.assertGreater(factors["own_mastery_delta"], 0)
        self.assertGreater(factors["vs_mastery_delta"], 0)
        self.assertGreater(factors["past_h2h_delta"], 0)

        # Ensure player Elo ratings are never mutated by prediction
        self.assertEqual(player_a["elo"], 1850)
        self.assertEqual(player_b["elo"], 1850)

        # Ensure adding arbitrary in-event stats has zero effect on prediction output
        player_a_with_event = {**player_a, "ev_f1_wins": 99, "ev_f2_wins": 0, "in_event_wins": 5}
        pred_with_event = self.engine.predict_matchup_outcome(player_a_with_event, player_b)
        self.assertEqual(pred["win_prob_a"], pred_with_event["win_prob_a"])
        self.assertEqual(pred["effective_elo_delta"], pred_with_event["effective_elo_delta"])

        # Verify room payload includes matchup_predictions and paired table prediction details
        room = self.engine.create_pairing_room(
            format_size="5v5",
            team_a_preset="art_of_war",
            team_b_preset="team_zero_comp",
            vs_ai=True,
            created_by="hsiehjun",
        )
        masked = self.engine.mask_pairing_room_for_viewer(room, "captain_a")
        self.assertIn("matchup_matrix", masked)
        self.assertIn("matchup_predictions", masked)
        self.assertIn("A1", masked["matchup_predictions"])
        self.assertIn("B1", masked["matchup_predictions"]["A1"])
        cell_pred = masked["matchup_predictions"]["A1"]["B1"]
        self.assertIn("win_prob_a", cell_pred)
        self.assertIn("factors", cell_pred)

    def test_prediction_scoring_dice_combat_and_tactical_guarantees(self):
        """Verify 80%+ win rate yields 20-0 WTC, D100 dice combat with +-1 variance and underdog upsets, 2/2 Tactical Guarantees, and round-by-round WTC score summary."""
        # 1. Verify an 80%+ favorite predicts 20-0 WTC score
        heavy_fav = {
            "id": "A_FAV",
            "name": "Liam VSL",
            "faction": "Aeldari",
            "elo": 2150,
            "win_rate": 82.0,
            "matches_played": 60,
        }
        underdog = {
            "id": "B_DOG",
            "name": "Casual Rookie",
            "faction": "Imperial Agents",
            "elo": 1750,
            "win_rate": 42.0,
            "matches_played": 20,
        }
        pred_80 = self.engine.predict_matchup_outcome(heavy_fav, underdog)
        self.assertGreaterEqual(pred_80["win_prob_a"], 80)
        self.assertEqual(pred_80["wtc_score_a"], 20)
        self.assertEqual(pred_80["wtc_score_b"], 0)

        # 2. Verify Tactical Guarantee locks 20-0 without rolling dice (d100_roll=None, variance=0)
        guar_res = self.engine.resolve_table_dice_battle(pred_80, mode="guarantee", guaranteed_by="captain_a")
        self.assertEqual(guar_res["mode"], "guarantee")
        self.assertTrue(guar_res["guaranteed"])
        self.assertIsNone(guar_res["d100_roll"])
        self.assertEqual(guar_res["variance"], 0)
        self.assertEqual(guar_res["final_score_a"], 20)
        self.assertEqual(guar_res["final_score_b"], 0)

        # 3. Verify D100 dice roll allows low-probability underdog to win (upset) + bounded +-1 variance
        upset_res = self.engine.resolve_table_dice_battle(
            pred_80,
            mode="dice",
            forced_roll=99,       # > win_prob_a -> Player B pulls the upset!
            forced_variance=-1,   # bounded -1 variance on A's score
        )
        self.assertEqual(upset_res["mode"], "dice")
        self.assertFalse(upset_res["guaranteed"])
        self.assertEqual(upset_res["d100_roll"], 99)
        self.assertEqual(upset_res["roll_winner"], "B")
        self.assertTrue(upset_res["upset"])
        self.assertLess(upset_res["final_score_a"], 10)
        self.assertGreater(upset_res["final_score_b"], 10)
        self.assertEqual(upset_res["final_score_a"] + upset_res["final_score_b"], 20)

        # 4. Verify room creation defaults to prediction_scoring_enabled=True and 2/2 guarantees per team
        created = self.engine.create_pairing_room({"format_size": "5v5", "vs_ai": True, "user_id": "cap_sim"})
        code = created["room_code"]
        tok_a = created["captain_a_token"]
        self.assertTrue(created["prediction_scoring_enabled"])
        self.assertEqual(created["guarantees_remaining_a"], 2)
        self.assertEqual(created["guarantees_remaining_b"], 2)

        # Arm guarantee before locking first pairing -> Table #1 automatically consumes 1 guarantee charge
        arm_res = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": "cap_sim",
            "captain_token": tok_a,
            "action": "arm_guarantee",
            "payload": {"armed": True},
        })
        self.assertTrue(arm_res["ok"])
        self.assertTrue(arm_res["room"]["guarantee_armed_a"])

        # Complete Coin Flip (Team A chooses Defender for Cycle 1)
        self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": "cap_sim",
            "captain_token": tok_a,
            "action": "choose_coin_flip_role",
            "payload": {"choice": "defender", "chooser_role": "captain_a", "vs_ai": True},
        })

        # Complete Cycle 1 (Defender + AI Attackers -> Team A picks 1 -> Table #1 locked)
        def_res = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": "cap_sim",
            "captain_token": tok_a,
            "action": "lock_defender",
            "payload": {"player_id": "A1", "vs_ai": True},
        })
        self.assertTrue(def_res["ok"])
        att_b_id = def_res["room"]["active_attackers_b"][0]["id"]
        c1_pick = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": "cap_sim",
            "captain_token": tok_a,
            "action": "lock_choice",
            "payload": {"player_id": att_b_id, "vs_ai": True},
        })
        self.assertTrue(c1_pick["ok"])
        r_after_t1 = c1_pick["room"]
        self.assertEqual(len(r_after_t1["pairings"]), 1)
        t1 = r_after_t1["pairings"][0]
        self.assertEqual(t1["battle_result"]["mode"], "guarantee")
        self.assertEqual(r_after_t1["guarantees_remaining_a"], 1)
        self.assertFalse(r_after_t1["guarantee_armed_a"])

        # Lock remaining tables via Cycle 2, 3, 4
        # Cycle 2: Team A is Attacker
        bench_a = [p["id"] for p in r_after_t1["team_a"]["roster"] if p["status"] == "bench"]
        c2_res = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": "cap_sim",
            "captain_token": tok_a,
            "action": "lock_attackers",
            "payload": {"player_ids": bench_a[:2], "vs_ai": True},
        })
        r_after_t2 = c2_res["room"]
        self.assertEqual(len(r_after_t2["pairings"]), 2)
        t2 = r_after_t2["pairings"][1]
        self.assertEqual(t2["battle_result"]["mode"], "dice")

        # Use 2nd guarantee on Table #2 via use_guarantee action -> guarantees_remaining_a becomes 0
        g2_res = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": "cap_sim",
            "captain_token": tok_a,
            "action": "use_guarantee",
            "payload": {"table_num": 2},
        })
        self.assertTrue(g2_res["ok"])
        self.assertEqual(g2_res["room"]["guarantees_remaining_a"], 0)
        self.assertEqual(g2_res["room"]["pairings"][1]["battle_result"]["mode"], "guarantee")

        # Attempting a 3rd guarantee arm when 0 left is rejected with HTTP 400
        g3_fail = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": "cap_sim",
            "captain_token": tok_a,
            "action": "arm_guarantee",
            "payload": {"armed": True},
        })
        self.assertFalse(g3_fail["ok"])
        self.assertEqual(g3_fail["status_code"], 400)

        # Toggle Prediction Scoring OFF and verify score_summary switches to expected totals
        tog_off = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": "cap_sim",
            "captain_token": tok_a,
            "action": "toggle_prediction_scoring",
            "payload": {"enabled": False},
        })
        self.assertTrue(tog_off["ok"])
        self.assertFalse(tog_off["room"]["prediction_scoring_enabled"])
        summary_off = tog_off["room"]["score_summary"]
        self.assertEqual(summary_off["active_total_a"], summary_off["expected_total_a"])
        self.assertEqual(len(summary_off["round_by_round"]), 2)

    def test_unified_lobby_pairings_mode_history_spectate_and_top_hud(self):
        """Verify Match Lobby branding, Game Mode selector, Quick Launch, Spectator routing to /team-pairings, Active/Completed History, and Unified Top HUD + Mobile Dock (<1s latency)."""
        import time
        import routers.tracker as tracker_mod
        from routers.tracker import (
            TrackerCreatePayload,
            TrackerJoinPayload,
            api_tracker_check_room,
            api_tracker_create_room,
            api_tracker_discard_game,
            api_tracker_join_room,
            api_tracker_user_sessions,
        )

        # 1. Verify Lobby UI strings & controls in web/tracker/tracker_sync.js
        ts_js = (ROOT_DIR / "web" / "tracker" / "tracker_sync.js").read_text(encoding="utf-8")
        self.assertNotIn("2-PLAYER MATCH LOBBY", ts_js)
        self.assertNotIn("2 Players Max", ts_js)
        self.assertIn("MATCH LOBBY", ts_js)
        self.assertIn("Multiplayer & Spectate Ready", ts_js)
        self.assertIn('id="gt-mode-btn-40k"', ts_js)
        self.assertIn('id="gt-mode-btn-pairings"', ts_js)
        self.assertNotIn('id="gt-mode-btn-pairings-5v5"', ts_js)
        self.assertNotIn('id="gt-mode-btn-pairings-8v8"', ts_js)
        self.assertNotIn('id="gt-quick-launch-pairings-btn"', ts_js)
        self.assertNotIn('id="gt-quick-launch-aos-btn"', ts_js)
        self.assertNotIn("Quick Launch Team Pairings", ts_js)
        self.assertIn('id="gt-lobby-spectate-btn"', ts_js)
        self.assertIn("/team-pairings?room=${encodeURIComponent(targetMid)}&role=spectator", ts_js)

        # 2. Verify Unified Game Tracker Top HUD & Mobile Bottom Dock in web/team_pairings/index.html
        tp_html = (ROOT_DIR / "web" / "team_pairings" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="gt-sync-hud"', tp_html)
        self.assertIn('id="btnBackToTrackerLobby"', tp_html)
        self.assertIn('id="topbarRoomCodeBadge"', tp_html)
        self.assertIn('id="btnFinishPairingRoom"', tp_html)
        self.assertIn('id="gt-mobile-bottom-dock"', tp_html)
        # Ensure clutter sandbox controls (05:00 clock, Clash, Combat Score: ON, vs AI, Auto-Duel) are removed
        self.assertNotIn('id="btnTopbarClock"', tp_html)
        self.assertNotIn('id="btnTopbarDice"', tp_html)
        self.assertNotIn('id="pairingClockPopover"', tp_html)
        self.assertNotIn('id="chkPredictionScoring"', tp_html)
        self.assertNotIn('id="chkVsAi"', tp_html)
        self.assertNotIn('id="btnAutoFinish"', tp_html)

        # 3. Verify Tracker Lobby API create / check / join / spectate / sessions / finish / discard (< 1000ms each)
        def _mock_req(user_dict=None, guest_id="guest_cap_1"):
            r = MagicMock()
            r.headers = {"X-Guest-Id": guest_id, "X-Game-System": "40k"}
            r.cookies = {}
            r.query_params = {"guest_id": guest_id}
            r._mock_user = user_dict
            return r

        cap_a_user = {"id": "u_cap_a_lobby", "user_id": "u_cap_a_lobby", "display_name": "John Lennon"}
        cap_b_user = {"id": "u_cap_b_lobby", "user_id": "u_cap_b_lobby", "display_name": "Brian Pullen"}
        spec_user = {"id": "u_spec_lobby", "user_id": "u_spec_lobby", "display_name": "Live Viewer"}

        with patch.object(tracker_mod, "get_firestore_engine", return_value=self.engine), \
             patch.object(tracker_mod, "_get_user_session_or_401", side_effect=lambda req: getattr(req, "_mock_user", None)), \
             patch("routers.tracker.get_database", return_value=MagicMock(get_user_tracker_games=MagicMock(return_value=[]))):

            t0 = time.perf_counter()
            create_res = asyncio.run(
                api_tracker_create_room(
                    payload=TrackerCreatePayload(
                        game_mode="pairings",
                        format_size="8v8",
                        p1_name="Art of War",
                        user_id_p1="u_cap_a_lobby",
                    ),
                    request=_mock_req(cap_a_user, "guest_a"),
                )
            )
            ms_create = (time.perf_counter() - t0) * 1000.0
            self.assertLess(ms_create, 1000.0)
            self.assertTrue(create_res["success"])
            wtc_code = create_res["match_id"]
            self.assertTrue(wtc_code.startswith("WTC-"))
            self.assertEqual(create_res["game_mode"], "pairings")
            self.assertEqual(create_res["format_size"], "8v8")

            # Check room (< 1s)
            t0 = time.perf_counter()
            chk_res = asyncio.run(api_tracker_check_room(wtc_code, _mock_req(cap_b_user, "guest_b")))
            ms_chk = (time.perf_counter() - t0) * 1000.0
            self.assertLess(ms_chk, 1000.0)
            self.assertTrue(chk_res["exists"])
            self.assertEqual(chk_res["game_mode"], "pairings")
            self.assertTrue(chk_res["is_open_for_p2"])

            # Join room as Captain B (< 1s)
            t0 = time.perf_counter()
            join_b = asyncio.run(
                api_tracker_join_room(
                    wtc_code,
                    request=_mock_req(cap_b_user, "guest_b"),
                    payload=TrackerJoinPayload(player_name="Brian Pullen", player_id="u_cap_b_lobby", claim_role="captain_b"),
                )
            )
            ms_join_b = (time.perf_counter() - t0) * 1000.0
            self.assertLess(ms_join_b, 1000.0)
            self.assertEqual(join_b["role"], "captain_b")
            self.assertIn("/team-pairings?room=", join_b["redirect_url"])

            # Join room as Spectator (both seats taken -> routes to /team-pairings?room=...&role=spectator, NOT /scorecard/)
            t0 = time.perf_counter()
            join_spec = asyncio.run(
                api_tracker_join_room(
                    wtc_code,
                    request=_mock_req(spec_user, "guest_spec"),
                    payload=TrackerJoinPayload(player_name="Live Viewer", player_id="u_spec_lobby"),
                )
            )
            ms_join_spec = (time.perf_counter() - t0) * 1000.0
            self.assertLess(ms_join_spec, 1000.0)
            self.assertEqual(join_spec["role"], "spectator")
            self.assertEqual(join_spec["redirect_url"], f"/team-pairings?room={wtc_code}&role=spectator")

            # Server HTML route redirects WTC spectator directly to /team-pairings?room=...&role=spectator
            mock_srv_req = MagicMock()
            mock_srv_req.query_params = {"match_id": wtc_code, "role": "spectator"}
            srv_resp = asyncio.run(server.serve_tracker_play_alias(mock_srv_req))
            srv_loc = getattr(srv_resp, "url", None) or (getattr(srv_resp, "headers", {}) or {}).get("location", "")
            self.assertEqual(str(srv_loc), f"/team-pairings?room={wtc_code}&role=spectator")

            # Active sessions list includes the WTC room (< 1s)
            t0 = time.perf_counter()
            sess_active = asyncio.run(api_tracker_user_sessions(request=_mock_req(cap_a_user, "guest_a"), token=None, game_system="40k"))
            ms_sess = (time.perf_counter() - t0) * 1000.0
            self.assertLess(ms_sess, 1000.0)
            active_ids = [s["match_id"] for s in sess_active.get("active_sessions", [])]
            self.assertIn(wtc_code, active_ids)

            # Finish room -> moves from active_sessions to completed_games (< 1s)
            t0 = time.perf_counter()
            fin_res = self.engine.apply_pairing_action(wtc_code, {
                "role": "captain_a",
                "user_id": "u_cap_a_lobby",
                "captain_token": create_res.get("captain_a_token", ""),
                "action": "finish_room",
            })
            ms_fin = (time.perf_counter() - t0) * 1000.0
            self.assertLess(ms_fin, 1000.0)
            self.assertTrue(fin_res["ok"])
            self.assertTrue(fin_res["room"]["is_finished"])

            sess_after_fin = asyncio.run(api_tracker_user_sessions(request=_mock_req(cap_a_user, "guest_a"), token=None, game_system="40k"))
            active_ids_after = [s["match_id"] for s in sess_after_fin.get("active_sessions", [])]
            completed_ids_after = [s["match_id"] for s in sess_after_fin.get("completed_history", [])]
            self.assertNotIn(wtc_code, active_ids_after)
            self.assertIn(wtc_code, completed_ids_after)

            # Create a second active WTC room and discard it -> removed from active sessions (< 1s)
            create_res2 = asyncio.run(
                api_tracker_create_room(
                    payload=TrackerCreatePayload(
                        game_mode="pairings",
                        format_size="5v5",
                        p1_name="Art of War",
                        user_id_p1="u_cap_a_lobby",
                    ),
                    request=_mock_req(cap_a_user, "guest_a"),
                )
            )
            wtc_code2 = create_res2["match_id"]
            t0 = time.perf_counter()
            disc_res = asyncio.run(api_tracker_discard_game(wtc_code2, request=_mock_req(cap_a_user, "guest_a")))
            ms_disc = (time.perf_counter() - t0) * 1000.0
            self.assertLess(ms_disc, 1000.0)
            self.assertEqual(disc_res["status"], "abandoned")
            self.assertIsNone(self.engine.get_pairing_room_raw(wtc_code2))

    def test_tcg_starter_preset_28_factions_1450_to_1550_elo_no_player_name(self):
        """Verify every user starts with ONLY the 28 Starter Faction Cards (no pre-seeded non-starter cards, 0 pity, 1450-1550 randomized Elo) and legacy mock cards are scrubbed."""
        uid = "u_tcg_starter_fresh"
        state = self.engine.get_user_tcg_state(uid, glory_balance=5740)
        self.assertTrue(state["ok"])
        self.assertEqual(state["spendable_glory"], 5740)
        self.assertEqual(state["pity_counter"], 0, "Initial Mythic Pity counter must be 0, never hardcoded to 3")
        self.assertEqual(state["packs_opened"], 0)
        self.assertEqual(state["owned_pro_count"], 0, "Brand-new user must have 0 non-starter Pro cards")
        self.assertEqual(state["total_owned_collectibles"], 0)
        self.assertEqual(state["owned_total_count"], 28, "Brand-new user must own strictly the 28 Starter Faction cards")

        starters = state["starter_cards"]
        self.assertEqual(len(starters), 28, "Expected all 28 Warhammer 40K factions in pre-set Starter Card list")
        for c in starters:
            self.assertTrue(c["is_starter"])
            self.assertEqual(c["player_name"], "")
            self.assertEqual(c["name"], c["faction"])
            self.assertEqual(c["rarity"], "starter")
            self.assertGreaterEqual(c["elo"], 1450)
            self.assertLessEqual(c["elo"], 1550)
            self.assertTrue(c["owned"])

        # Default 5v5 and 8v8 decks for a brand-new user are built from Starter Faction Cards (1450-1550 Elo)
        self.assertEqual(len(state["deck_5v5_cards"]), 5)
        self.assertEqual(len(state["deck_8v8_cards"]), 8)
        for c in state["deck_5v5_cards"]:
            self.assertTrue(c["is_starter"])
            self.assertGreaterEqual(c["elo"], 1450)
            self.assertLessEqual(c["elo"], 1550)

        # Verify legacy pre-seeded "Starter Welcome Drop" / "2026-10-01T00:00:00Z" cards and wallet_glory are automatically scrubbed
        legacy_vault = {
            "tcg_vault": {
                "schema_v": 1,
                "wallet_glory": 9250,
                "pity_counter": 3,
                "packs_opened": 0,
                "owned_collectibles": {
                    "PRO_FOLGER_P_NECRONS": {"copies": 2, "acquired_at": "2026-10-01T00:00:00Z"},
                    "PRO_JOHN_HSIEH_NECRONS": {"copies": 1, "acquired_at": "Starter Welcome Drop"},
                },
            }
        }
        self.engine.sync_tcg_doc_from_armory_vault("u_legacy_scrub", legacy_vault)
        scrubbed_state = self.engine.get_user_tcg_state("u_legacy_scrub", glory_balance=5740)
        self.assertEqual(scrubbed_state["owned_pro_count"], 0, "Legacy pre-seeded welcome cards must be scrubbed")
        self.assertEqual(scrubbed_state["pity_counter"], 0, "Legacy hardcoded pity_counter=3 with 0 packs opened must be reset to 0")
        self.assertEqual(scrubbed_state["spendable_glory"], 5740)

    def test_tcg_multi_faction_real_player_cards_and_dynamic_live_elo_sync(self):
        """Verify a single real player has multiple faction cards (e.g. Folger P as Custodes & Necrons) and changing their live Elo dynamically updates all their cards and active rooms."""
        uid = "u_tcg_folger_sync"
        state0 = self.engine.get_user_tcg_state(uid)
        folger_cards = [
            c for c in state0["collectible_catalog"]
            if c["player_name"].lower() == "folger p"
        ]
        self.assertGreaterEqual(len(folger_cards), 2, "Expected Folger P to have multiple faction cards (Custodes, Necrons, etc.)")
        folger_factions = {c["faction"] for c in folger_cards}
        self.assertIn("Adeptus Custodes", folger_factions)
        self.assertIn("Necrons", folger_factions)

        # Equip Folger P (Adeptus Custodes) into a room roster
        created = self.engine.create_pairing_room({"format_size": "5v5", "vs_ai": True, "user_id": uid, "room_mode": "casual_tcg"})
        code = created["room_code"]
        tok_a = created["captain_a_token"]

        folger_custodes = next(c for c in folger_cards if c["faction"] == "Adeptus Custodes")
        starter_four = state0["starter_cards"][:4]
        custom_roster = [folger_custodes] + starter_four
        set_res = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": uid,
            "captain_token": tok_a,
            "action": "set_team_roster",
            "payload": {
                "format_size": "5v5",
                "team_name": "Folger Strike",
                "roster": custom_roster,
            },
        })
        self.assertTrue(set_res["ok"])

        try:
            # Update Folger P's live rating to 2165 (Mythic Warlord tier >= 2080)
            self.engine.update_live_player_elo_override("Folger P", 2165)

            state1 = self.engine.get_user_tcg_state(uid)
            updated_folger_cards = [
                c for c in state1["collectible_catalog"]
                if c["player_name"].lower() == "folger p"
            ]
            for fc in updated_folger_cards:
                self.assertEqual(fc["elo"], 2165, f"Expected {fc['card_id']} to sync live Elo 2165")
                self.assertEqual(fc["rarity"], "mythic", "Expected 2165 Elo to dynamically upgrade rarity to mythic")

            # Also verify active pairing room hydrates Folger P's new live Elo while preserving Starter 1450-1550 Elos
            raw_room = self.engine.get_pairing_room_raw(code)
            masked_room = self.engine.mask_pairing_room_for_viewer(raw_room, "captain_a", tok_a)
            roster_a = masked_room["team_a"]["roster"]
            self.assertEqual(roster_a[0]["name"], "Folger P")
            self.assertEqual(roster_a[0]["elo"], 2165)
            for sc in roster_a[1:]:
                self.assertTrue(sc["is_starter"])
                self.assertGreaterEqual(sc["elo"], 1450)
                self.assertLessEqual(sc["elo"], 1550)
        finally:
            self.engine.update_live_player_elo_override("Folger P", 2070)

    def test_tcg_pack_store_pricing_pity_guarantee_and_duplicate_glory_rebate(self):
        """Verify 3-tier pack pricing (150/380/850) in Retribution Store & TCG Engine, Warlord 0% Common & Guaranteed Epic/Mythic Slot 1, 10-point Mythic Pity guarantee, and duplicate Glory rebates."""
        import armory_catalog
        for item_id, expected_cost in (("tcg_pack_recruit", 150), ("tcg_pack_veteran", 380), ("tcg_pack_warlord", 850)):
            cat_item = armory_catalog.get_item_by_id(item_id)
            self.assertIsNotNone(cat_item, f"Expected {item_id} in Retribution Store armory_catalog")
            self.assertEqual(cat_item["wing"], "tcg_packs")
            self.assertEqual(cat_item["cost_glory"], expected_cost)

        uid = "u_tcg_pack_opener"
        st = self.engine.get_user_tcg_state(uid, glory_balance=5740)
        self.assertEqual(st["spendable_glory"], 5740)

        # 1. Open a Warlord Command Crate (850 Glory, 5 cards, 0% Common, Slot 1 Epic/Mythic, +3 Pity)
        res_w = self.engine.open_tcg_card_pack(uid, pack_type="tcg_pack_warlord", glory_balance=5740, seed=42)
        self.assertTrue(res_w["ok"])
        self.assertEqual(res_w["glory_spent"], 850)
        self.assertEqual(len(res_w["pulled_cards"]), 5)
        self.assertIn(res_w["pulled_cards"][0]["rarity"], ("epic", "mythic"))
        for c in res_w["pulled_cards"]:
            self.assertNotEqual(c["rarity"], "common", "Warlord Command Crate must have 0% Common cards")

        # 2. Push Pity Counter to >= 10 and verify next pack triggers 10/10 Mythic Pity on Slot 1 (2080+ Elo)
        doc = self.engine._get_or_init_tcg_doc(uid)
        doc["pity_counter"] = 9
        res_pity = self.engine.open_tcg_card_pack(uid, pack_type="tcg_pack_recruit", glory_balance=4890, seed=99)
        self.assertTrue(res_pity["ok"])
        self.assertTrue(res_pity["pity_triggered"], "Expected 9 + 1 = 10/10 Pity to trigger Guaranteed Mythic")
        self.assertEqual(res_pity["pulled_cards"][0]["rarity"], "mythic")
        self.assertGreaterEqual(res_pity["pulled_cards"][0]["elo"], 2080)
        self.assertEqual(res_pity["tcg_state"]["pity_counter"], 0, "Pity counter must reset to 0 after Mythic pull")

    def test_tcg_deck_construction_one_card_per_real_player_and_casual_vs_tournament_separation(self):
        """Verify 1-card-per-real-player deck rule and strict separation between Casual TCG Mode and Official Tournament Mode."""
        uid = "u_tcg_deck_rules"
        # Unlock both Folger P (Adeptus Custodes) and Folger P (Necrons) for this user
        st0 = self.engine.get_user_tcg_state(uid)
        folger_cards = [c for c in st0["collectible_catalog"] if c["player_name"].lower() == "folger p"]
        f_cust = next(c for c in folger_cards if c["faction"] == "Adeptus Custodes")
        f_nec = next(c for c in folger_cards if c["faction"] == "Necrons")
        doc = self.engine._get_or_init_tcg_doc(uid)
        doc["owned_collectibles"][f_cust["card_id"]] = {"copies": 1, "acquired_at": "2026-10-13 00:00:00"}
        doc["owned_collectibles"][f_nec["card_id"]] = {"copies": 1, "acquired_at": "2026-10-13 00:00:01"}

        # Attempt to save a 5v5 deck containing BOTH Folger Custodes and Folger Necrons
        starter_ids = [c["card_id"] for c in st0["starter_cards"][:4]]
        save_res = self.engine.save_user_tcg_deck(
            uid,
            format_size="5v5",
            card_ids=[f_cust["card_id"], f_nec["card_id"]] + starter_ids,
            deck_name="Folger Test Deck",
            mode="custom",
        )
        self.assertTrue(save_res["ok"])
        saved_cards = save_res["tcg_state"]["deck_5v5_cards"]
        self.assertEqual(len(saved_cards), 5)
        folger_in_deck = [c for c in saved_cards if c.get("player_name", "").lower() == "folger p"]
        self.assertEqual(len(folger_in_deck), 1, "Deck construction must enforce at most 1 card per real player")

        # Verify Casual TCG room creation vs Official Tournament room creation
        casual_room = self.engine.create_pairing_room({
            "format_size": "5v5",
            "user_id": uid,
            "room_mode": "casual_tcg",
            "vs_ai": True,
        })
        self.assertEqual(casual_room["room_mode"], "casual_tcg")
        self.assertEqual(len(casual_room["team_a"]["roster"]), 5)
        self.assertEqual(casual_room["team_a"]["roster"][0]["name"], "Folger P")

        tourney_room = self.engine.create_pairing_room({
            "format_size": "5v5",
            "user_id": uid,
            "room_mode": "tournament",
            "empty_rosters": False,
        })
        self.assertEqual(tourney_room["room_mode"], "tournament")
        self.assertTrue(all(not p.get("is_starter") for p in tourney_room["team_a"]["roster"]))

    def test_tcg_api_endpoints_sub_1s_latency(self):
        """Verify all TCG backend and HTTP handler calls execute well under 1000ms (< 1s)."""
        import time

        uid = "u_tcg_perf_bench"

        t0 = time.perf_counter()
        s_res = self.engine.get_user_tcg_state(uid, glory_balance=5740)
        ms_state = (time.perf_counter() - t0) * 1000.0
        self.assertTrue(s_res["ok"])
        self.assertLess(ms_state, 1000.0, f"get_user_tcg_state took {ms_state:.2f}ms (> 1000ms)")

        t0 = time.perf_counter()
        p_res = self.engine.open_tcg_card_pack(uid, pack_type="veteran", glory_balance=5740)
        ms_pack = (time.perf_counter() - t0) * 1000.0
        self.assertTrue(p_res["ok"])
        self.assertLess(ms_pack, 1000.0, f"open_tcg_card_pack took {ms_pack:.2f}ms (> 1000ms)")

        t0 = time.perf_counter()
        d_res = self.engine.save_user_tcg_deck(uid, format_size="5v5", mode="auto_best")
        ms_deck = (time.perf_counter() - t0) * 1000.0
        self.assertTrue(d_res["ok"])
        self.assertLess(ms_deck, 1000.0, f"save_user_tcg_deck took {ms_deck:.2f}ms (> 1000ms)")

    def test_on_field_combat_no_popup_no_skip_dice_and_universal_live_elo_sync(self):
        """Verify Master Duel on-field combat stage (no popup modal), removal of skip-dice-roll Tactical Guarantee UI, and universal live Elo sync across search, team rosters, and locked pairings."""
        tp_html = (ROOT_DIR / "web" / "team_pairings" / "index.html").read_text(encoding="utf-8")
        tp_js = (ROOT_DIR / "web" / "team_pairings" / "app.js").read_text(encoding="utf-8")

        # 1. Verify On-Field Combat Stage exists on the playmat and old popup / skip-dice-roll UI are gone
        self.assertIn('id="onFieldCombatStage"', tp_html)
        self.assertIn('id="ofcFighterMy"', tp_html)
        self.assertIn('id="ofcFighterOpp"', tp_html)
        self.assertIn('id="ofcWtcScoreCard"', tp_html)
        self.assertNotIn('id="battleClashModalBackdrop"', tp_html)
        self.assertNotIn('id="tacticalGuaranteeBox"', tp_html)
        self.assertNotIn('id="btnArmGuarantee"', tp_html)
        self.assertNotIn('id="btnClashUseGuarantee"', tp_html)
        self.assertIn("playOnFieldCombatAnimation", tp_js)
        self.assertIn("applyPendingFlightAnimations", tp_js)
        self.assertNotIn("toggleArmGuarantee", tp_js)

        # 2. Verify live Elo updates propagate everywhere (TCG state, search_real_teams_and_players, get_real_team_roster, and active room pairings)
        room = self.engine.create_pairing_room(
            format_size="5v5",
            team_a_preset="art_of_war",
            team_b_preset="team_zero_comp",
            vs_ai=True,
            created_by="hsiehjun",
        )
        code = room["room_code"]
        tok_a = room["captain_a_token"]

        # Complete Cycle 1 so Table #1 is locked with John Lennon
        res1 = self.engine.apply_pairing_action(code, role="captain_a", captain_token=tok_a, action="lock_defender", payload={"player_id": "A1", "vs_ai": True})
        r_step2 = res1["room"]
        bench_a = [p["id"] for p in r_step2["team_a"]["roster"] if p["status"] == "bench"]
        res2 = self.engine.apply_pairing_action(code, role="captain_a", captain_token=tok_a, action="lock_attackers", payload={"player_ids": bench_a[:2], "vs_ai": True})
        r_step3 = res2["room"]
        att_b = r_step3["active_attackers_b"][0]["id"]
        self.engine.apply_pairing_action(code, role="captain_a", captain_token=tok_a, action="lock_choice", payload={"player_id": att_b, "vs_ai": True})

        try:
            # Update John Lennon's live Elo to 2210
            self.engine.update_live_player_elo_override("John Lennon", 2210)

            # Check search_real_teams_and_players
            s_res = self.engine.search_real_teams_and_players(query="John Lennon", game_system="40k")
            jl_search = [p for p in s_res["players"] if p["name"].lower() == "john lennon"]
            self.assertTrue(len(jl_search) >= 1)
            self.assertEqual(jl_search[0]["elo"], 2210)

            # Check get_real_team_roster
            t_res = self.engine.get_real_team_roster("Art of War", game_system="40k")
            jl_team = [p for p in t_res["roster"] if p["name"].lower() == "john lennon"]
            if jl_team:
                self.assertEqual(jl_team[0]["elo"], 2210)

            # Check masked pairing room (both team_a.roster AND locked pairings)
            raw_after = self.engine.get_pairing_room_raw(code)
            masked_after = self.engine.mask_pairing_room_for_viewer(raw_after, "captain_a", tok_a)
            jl_roster = next(p for p in masked_after["team_a"]["roster"] if p["name"].lower() == "john lennon")
            self.assertEqual(jl_roster["elo"], 2210)
            jl_paired = [m["player_a"] for m in masked_after["pairings"] if m["player_a"]["name"].lower() == "john lennon"]
            self.assertTrue(len(jl_paired) >= 1)
            self.assertEqual(jl_paired[0]["elo"], 2210)
        finally:
            self.engine.update_live_player_elo_override("John Lennon", 2145)

    def test_unified_gt_hud_header_and_5v5_8v8_lobby_history_persistence(self):
        """Verify /team-pairings #gt-sync-hud matches /11th/tracker/play header and 5v5/8v8 pairing rooms appear in Game & Pairings History."""
        from routers.tracker import TrackerCreatePayload

        tp_html = (ROOT_DIR / "web" / "team_pairings" / "index.html").read_text(encoding="utf-8")
        tp_css = (ROOT_DIR / "web" / "team_pairings" / "styles.css").read_text(encoding="utf-8")
        tracker_sync_js = (ROOT_DIR / "web" / "tracker" / "tracker_sync.js").read_text(encoding="utf-8")

        # 1. Verify unified #gt-sync-hud header & mobile bottom dock structure matches /11th/tracker/play
        self.assertIn('id="gt-sync-hud"', tp_html)
        self.assertIn('id="hudMatchupDisplay"', tp_html)
        self.assertIn('id="hudStatusDot"', tp_html)
        self.assertIn('id="hudTeamALabel"', tp_html)
        self.assertIn('id="hudTeamBLabel"', tp_html)
        self.assertIn('class="gt-hud-nav-pill hub-pill"', tp_html)
        self.assertIn('class="gt-hud-nav-pill lobby-pill"', tp_html)
        self.assertIn('class="gt-hud-room-badge"', tp_html)
        self.assertIn('class="topbar-right gt-desktop-actions"', tp_html)
        self.assertIn('class="arena-controls-strip"', tp_html)
        self.assertIn('id="btnTopbarJudge"', tp_html)
        self.assertIn('id="btnDockJudge"', tp_html)
        self.assertNotIn('id="btnDockLobby"', tp_html)
        self.assertIn("#gt-sync-hud {", tp_css)

        # 2. Verify watchLobbyActiveMatches skips WTC- rooms so Firestore 'rooms' collection doesn't wipe them
        self.assertIn("String(mid).toUpperCase().startsWith('WTC-')", tracker_sync_js)

        # 3. Verify TrackerCreatePayload accepts both integer (5, 8) and string ("5v5", "8v8") format_size + guest_id
        p5_int = TrackerCreatePayload(game_system="team_pairings", format_size=5, guest_id="guest_test_abc")
        self.assertEqual(p5_int.format_size, 5)
        self.assertEqual(p5_int.guest_id, "guest_test_abc")
        p8_int = TrackerCreatePayload(game_system="team_pairings", format_size=8, guest_id="guest_test_abc")
        self.assertEqual(p8_int.format_size, 8)

        # 4. Verify 5v5 and 8v8 rooms created with guest_id or user_id appear in list_pairing_rooms_for_user
        r5 = self.engine.create_pairing_room(
            format_size="5v5",
            team_a_preset="art_of_war",
            team_b_preset="team_zero_comp",
            vs_ai=True,
            created_by="Guest Captain",
            user_id="",
            guest_id="guest_test_abc",
        )
        r8 = self.engine.create_pairing_room(
            format_size="8v8",
            team_a_preset="team_ignite",
            team_b_preset=" vanguard_tactics",
            vs_ai=True,
            created_by="Guest Captain",
            user_id="",
            guest_id="guest_test_abc",
        )
        # Finish the 8v8 room to verify completed status as well
        self.engine.apply_pairing_action(
            r8["room_code"],
            role="captain_a",
            captain_token=r8["captain_a_token"],
            action="finish_room",
            payload={},
        )

        listed = self.engine.list_pairing_rooms_for_user(
            user_id="",
            user_name="",
            guest_id="guest_test_abc",
            limit=50,
        )
        active_by_code = {item["match_id"]: item for item in listed.get("active", [])}
        completed_by_code = {item["match_id"]: item for item in listed.get("completed", [])}
        self.assertIn(r5["room_code"], active_by_code)
        self.assertIn(r8["room_code"], completed_by_code)
        self.assertEqual(active_by_code[r5["room_code"]]["format_size"], "5v5")
        self.assertEqual(active_by_code[r5["room_code"]]["status"], "active")
        self.assertEqual(completed_by_code[r8["room_code"]]["format_size"], "8v8")
        self.assertEqual(completed_by_code[r8["room_code"]]["status"], "completed")

    def test_ai_opponent_elo_matches_player_team_across_starter_casual_and_custom_rosters(self):
        """Verify AI Team B dynamically matches Team A's average Elo (~+-25 Elo) across Starter (~1500), Hybrid (~1650), Regional (~1820), and Elite (~2150) rosters."""
        def _avg_elo(roster):
            return sum(int(p.get("current_elo") or p.get("elo") or 1500) for p in roster) / max(1, len(roster))

        # 1. Starter Deck Room (1450-1550 Elo, avg ~1500) via create_pairing_room(room_mode="casual_tcg")
        uid_starter = "u_elo_match_starter"
        r_starter = self.engine.create_pairing_room({
            "format_size": "5v5",
            "user_id": uid_starter,
            "room_mode": "casual_tcg",
            "vs_ai": True,
        })
        avg_a_st = _avg_elo(r_starter["team_a"]["roster"])
        avg_b_st = _avg_elo(r_starter["team_b"]["roster"])
        self.assertGreaterEqual(avg_a_st, 1450)
        self.assertLessEqual(avg_a_st, 1550)
        self.assertLessEqual(
            abs(avg_a_st - avg_b_st),
            25.0,
            f"Starter Deck AI avg Elo ({avg_b_st:.1f}) must closely match player avg Elo ({avg_a_st:.1f})",
        )
        self.assertTrue(all(p.get("is_starter") for p in r_starter["team_b"]["roster"]))

        # 2. Equip Starter Deck via apply_tcg_deck(mode="starter") on an empty_rosters room
        r_empty = self.engine.create_pairing_room({
            "format_size": "5v5",
            "empty_rosters": True,
            "vs_ai": True,
            "user_id": uid_starter,
        })
        code = r_empty["room_code"]
        tok_a = r_empty["captain_a_token"]

        equip_starter = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": uid_starter,
            "captain_token": tok_a,
            "action": "apply_tcg_deck",
            "payload": {"format_size": "5v5", "mode": "starter", "also_set_ai_tcg": True},
        })
        self.assertTrue(equip_starter["ok"])
        rm_st = equip_starter["room"]
        self.assertEqual(len(rm_st["team_a"]["roster"]), 5)
        self.assertEqual(len(rm_st["team_b"]["roster"]), 5)
        self.assertLessEqual(abs(_avg_elo(rm_st["team_a"]["roster"]) - _avg_elo(rm_st["team_b"]["roster"])), 25.0)

        # 3. Custom Mid-Tier / Regional Contender Roster (~1760 avg Elo) via set_team_roster
        regional_roster = [
            {"name": "Tariq Al-Mansoor", "faction": "Thousand Sons", "elo": 1784},
            {"name": "Hana Takahashi", "faction": "Drukhari", "elo": 1770},
            {"name": "Garrett Cole", "faction": "Astra Militarum", "elo": 1758},
            {"name": "Caleb Mercer", "faction": "Space Marines", "elo": 1735},
            {"name": "Nolan Bishop", "faction": "Necrons", "elo": 1718},
        ]
        set_reg = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": uid_starter,
            "captain_token": tok_a,
            "action": "set_team_roster",
            "payload": {
                "format_size": "5v5",
                "team_name": "Regional Strike",
                "team_tag": "RGS",
                "roster": regional_roster,
            },
        })
        self.assertTrue(set_reg["ok"])
        rm_reg = set_reg["room"]
        avg_a_reg = _avg_elo(rm_reg["team_a"]["roster"])
        avg_b_reg = _avg_elo(rm_reg["team_b"]["roster"])
        self.assertLessEqual(
            abs(avg_a_reg - avg_b_reg),
            30.0,
            f"Regional AI avg Elo ({avg_b_reg:.1f}) must closely match player avg Elo ({avg_a_reg:.1f})",
        )
        # Ensure AI does not clone the exact same player names as Team A
        names_a = {p["name"].lower() for p in rm_reg["team_a"]["roster"]}
        names_b = {p["name"].lower() for p in rm_reg["team_b"]["roster"]}
        self.assertEqual(len(names_a.intersection(names_b)), 0, "AI Team B must not field duplicate clones of Team A's players")

        # 4. Verify expected matchup matrix on Starter Deck vs AI is competitive (~45-55 expected WTC points out of 100)
        mat = rm_st["matchup_matrix"]
        diagonal_exp_a = sum(mat[f"A{i}"][f"B{i}"] for i in range(1, 6))
        self.assertGreaterEqual(diagonal_exp_a, 42, f"Expected competitive ~50/50 WTC expectation vs AI, got {diagonal_exp_a}/100")
        self.assertLessEqual(diagonal_exp_a, 58, f"Expected competitive ~50/50 WTC expectation vs AI, got {diagonal_exp_a}/100")

    def test_two_player_room_sync_and_card_meta_stats_inspector(self):
        """Verify 2 human players in the same room synchronize cleanly without AI hijacking Seat B, and left panel renders Card Meta Stats instead of Pairing Steps."""
        import os
        # 1. Verify HTML & JS replaced PAIRING STEPS with CARD META STATS
        root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        html_path = os.path.join(root_dir, "web", "team_pairings", "index.html")
        js_path = os.path.join(root_dir, "web", "team_pairings", "app.js")
        with open(html_path, "r", encoding="utf-8") as fh:
            html_src = fh.read()
        with open(js_path, "r", encoding="utf-8") as fj:
            js_src = fj.read()

        self.assertIn("CARD META STATS", html_src)
        self.assertIn("cardMetaInspectorFrame", html_src)
        self.assertIn("metaInspectorStatsGrid", html_src)
        self.assertIn("metaInspectorFactorStrip", html_src)
        self.assertIn("metaInspectorMatchupList", html_src)
        self.assertNotIn("PAIRING STEPS", html_src)
        self.assertNotIn("pgCurrentCallout", html_src)
        self.assertIn("pollRoomState", js_src)
        self.assertIn("getRoomStateSignature", js_src)

        # 2. Player 1 creates a room & equips a Starter Deck
        p1_uid = "user_human_p1"
        p2_uid = "user_human_p2"
        created = self.engine.create_pairing_room({
            "format_size": "5v5",
            "empty_rosters": True,
            "vs_ai": True,
            "user_id": p1_uid,
            "user_name": "Alpha Captain",
        })
        code = created["room_code"]
        tok_a = created["captain_a_token"]
        rev0 = created["revision"]
        self.assertGreaterEqual(rev0, 1)

        # Player 1 equips starter deck while waiting for Player 2 (AI temporary placeholder populates Team B)
        eq1 = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": p1_uid,
            "captain_token": tok_a,
            "action": "apply_tcg_deck",
            "payload": {"format_size": "5v5", "mode": "starter", "also_set_ai_tcg": True},
        })
        self.assertTrue(eq1["ok"])
        self.assertGreater(eq1["room"]["revision"], rev0)

        # 3. Player 2 joins via share link and claims Captain B -> must lock Seat B, keep Seat A locked, disable vs_ai, and clear AI placeholder roster
        claim_b = self.engine.apply_pairing_action(code, {
            "role": "captain_b",
            "user_id": p2_uid,
            "action": "claim_seat",
            "payload": {"seat": "captain_b", "user_id": p2_uid, "user_name": "Bravo Captain"},
        })
        self.assertTrue(claim_b["ok"])
        tok_b = claim_b.get("captain_token")
        self.assertTrue(bool(tok_b))
        rm_after_claim = claim_b["room"]
        self.assertTrue(rm_after_claim["seat_a_locked"], "Claiming Seat B must NEVER unlock Seat A")
        self.assertTrue(rm_after_claim["seat_b_locked"])
        self.assertFalse(rm_after_claim["vs_ai"], "Human Seat B must disable vs_ai")
        self.assertNotIn("(AI", rm_after_claim["team_b"]["name"], "AI label must be stripped when Human Player 2 claims Seat B")

        # 4. Player 2 equips their own Starter Deck on Team B
        eq2 = self.engine.apply_pairing_action(code, {
            "role": "captain_b",
            "user_id": p2_uid,
            "captain_token": tok_b,
            "action": "apply_tcg_deck",
            "payload": {"format_size": "5v5", "mode": "starter", "team_name": "Bravo Vanguard"},
        })
        self.assertTrue(eq2["ok"])
        rm_ready = eq2["room"]
        self.assertEqual(len(rm_ready["team_a"]["roster"]), 5)
        self.assertEqual(len(rm_ready["team_b"]["roster"]), 5)
        self.assertFalse(rm_ready["vs_ai"])

        # Verify card meta stats enrichment on both rosters
        for c in rm_ready["team_a"]["roster"] + rm_ready["team_b"]["roster"]:
            self.assertIn("fac_meta_wr_pct", c)
            self.assertIn("fac_meta_games", c)
            self.assertIn("fac_meta_elo_shift", c)
            self.assertIn("fac_meta_tier", c)

        # 5. Coin Flip & Role Choice: even if client mistakenly passes vs_ai=True, seat_b_locked=True prevents AI from ever hijacking Player 2
        flip_res = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": p1_uid,
            "captain_token": tok_a,
            "action": "flip_coin",
            "payload": {"force_winner": "captain_a"},
        })
        self.assertTrue(flip_res["ok"])

        choose_res = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": p1_uid,
            "captain_token": tok_a,
            "action": "choose_coin_flip_role",
            "payload": {"choice": "defender", "chooser_role": "captain_a", "vs_ai": True},
        })
        self.assertTrue(choose_res["ok"])
        rm_c1 = choose_res["room"]
        self.assertFalse(rm_c1["vs_ai"], "seat_b_locked=True must keep vs_ai=False even if client payload passed vs_ai=True")
        self.assertEqual(rm_c1["defender_role"], "captain_a")
        self.assertEqual(rm_c1["attacker_role"], "captain_b")
        self.assertEqual(rm_c1["phase"], "STEP_1_DEFENDER")

        # 6. Step 1: Player 1 (Defender) locks A1 -> room advances to STEP_2_ATTACKERS and waits for Human Player 2 (AI does NOT auto-play!)
        def_res = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": p1_uid,
            "captain_token": tok_a,
            "action": "lock_defender",
            "payload": {"player_id": "A1", "vs_ai": True},
        })
        self.assertTrue(def_res["ok"])
        rm_step2 = def_res["room"]
        self.assertEqual(rm_step2["phase"], "STEP_2_ATTACKERS", "Must wait for Human Player 2 to nominate 2 attackers")
        self.assertIsNotNone(rm_step2["active_defender_a"])
        self.assertEqual(rm_step2["active_defender_a"]["id"], "A1")
        self.assertEqual(len(rm_step2["active_attackers_b"]), 0)

        # 7. Step 2: Player 2 (Attacker) nominates B1 & B2 -> room advances to STEP_3_CHOOSE for Player 1
        att_res = self.engine.apply_pairing_action(code, {
            "role": "captain_b",
            "user_id": p2_uid,
            "captain_token": tok_b,
            "action": "lock_attackers",
            "payload": {"player_ids": ["B1", "B2"]},
        })
        self.assertTrue(att_res["ok"])
        rm_step3 = att_res["room"]
        self.assertEqual(rm_step3["phase"], "STEP_3_CHOOSE")
        self.assertEqual([c["id"] for c in rm_step3["active_attackers_b"]], ["B1", "B2"])

        # 8. Step 3: Player 1 chooses B1 -> Table 1 locks (A1 vs B1) and roles swap for Cycle 2 (Captain B becomes Defender)
        pick_res = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": p1_uid,
            "captain_token": tok_a,
            "action": "lock_choice",
            "payload": {"player_id": "B1"},
        })
        self.assertTrue(pick_res["ok"])
        rm_c2 = pick_res["room"]
        self.assertEqual(len(rm_c2["pairings"]), 1)
        self.assertEqual(rm_c2["pairings"][0]["player_a"]["id"], "A1")
        self.assertEqual(rm_c2["pairings"][0]["player_b"]["id"], "B1")
        self.assertEqual(rm_c2["cycle"], 2)
        self.assertEqual(rm_c2["defender_role"], "captain_b")
        self.assertEqual(rm_c2["attacker_role"], "captain_a")
        self.assertEqual(rm_c2["phase"], "STEP_1_DEFENDER")

    def test_three_setup_modes_vs_player_vs_ai_and_tournament_tool(self):
        """Verify the 3 Setup Modes: (1) Play vs Player (created deck, vs_ai=False), (2) Play vs AI (auto-creates both decks with matched Avg Elo), (3) Pairing Tool (tournament use, prediction_scoring_enabled=False)."""
        uid = "user_setup_modes"
        room = self.engine.create_pairing_room({
            "format_size": "5v5",
            "empty_rosters": True,
            "user_id": uid,
        })
        code = room["room_code"]
        tok_a = room["captain_a_token"]

        # 1. Option 1: Play vs Player (vs_player)
        r_pvp = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": uid,
            "captain_token": tok_a,
            "action": "set_setup_mode",
            "payload": {"setup_mode": "vs_player", "format_size": "5v5"},
        })
        self.assertTrue(r_pvp["ok"])
        rm_pvp = r_pvp["room"]
        self.assertEqual(rm_pvp["setup_mode"], "vs_player")
        self.assertEqual(rm_pvp["room_mode"], "casual_tcg")
        self.assertFalse(rm_pvp["vs_ai"])
        self.assertTrue(rm_pvp["prediction_scoring_enabled"])
        self.assertEqual(len(rm_pvp["team_a"]["roster"]), 5)
        self.assertEqual(len(rm_pvp["team_b"]["roster"]), 0)

        # 2. Option 2: Play vs AI (vs_ai -> auto-creates both decks with similar Avg Elo)
        r_ai = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": uid,
            "captain_token": tok_a,
            "action": "set_setup_mode",
            "payload": {"setup_mode": "vs_ai", "format_size": "5v5"},
        })
        self.assertTrue(r_ai["ok"])
        rm_ai = r_ai["room"]
        self.assertEqual(rm_ai["setup_mode"], "vs_ai")
        self.assertTrue(rm_ai["vs_ai"])
        self.assertTrue(rm_ai["prediction_scoring_enabled"])
        self.assertEqual(len(rm_ai["team_a"]["roster"]), 5)
        self.assertEqual(len(rm_ai["team_b"]["roster"]), 5)
        avg_a = sum(int(p.get("elo") or 1500) for p in rm_ai["team_a"]["roster"]) / 5.0
        avg_b = sum(int(p.get("elo") or 1500) for p in rm_ai["team_b"]["roster"]) / 5.0
        self.assertLessEqual(abs(avg_a - avg_b), 25.0, f"Auto-created player avg Elo ({avg_a:.1f}) and AI avg Elo ({avg_b:.1f}) must be closely matched")

        # 3. Option 3: Pairing Tool (tournament -> pure WTC pairing tool, prediction_scoring_enabled=False)
        r_tourney = self.engine.apply_pairing_action(code, {
            "role": "captain_a",
            "user_id": uid,
            "captain_token": tok_a,
            "action": "set_setup_mode",
            "payload": {"setup_mode": "tournament", "format_size": "5v5"},
        })
        self.assertTrue(r_tourney["ok"])
        rm_tourney = r_tourney["room"]
        self.assertEqual(rm_tourney["setup_mode"], "tournament")
        self.assertEqual(rm_tourney["room_mode"], "tournament")
        self.assertFalse(rm_tourney["vs_ai"])
        self.assertFalse(rm_tourney["prediction_scoring_enabled"])
        self.assertEqual(len(rm_tourney["team_a"]["roster"]), 0)
        self.assertEqual(len(rm_tourney["team_b"]["roster"]), 0)

    def test_5d20_bell_curve_dice_combat_and_sequential_rolls(self):
        """Verify resolve_table_dice_battle rolls 5d20 (5 × D20, each 1..20) with a bell-curve sum so a 5% underdog has ~0% win probability."""
        pred_95_vs_5 = {"win_prob_a": 95, "wtc_score_a": 20}
        res = self.engine.resolve_table_dice_battle(pred_95_vs_5, mode="dice")
        self.assertEqual(res["dice_formula"], "5d20")
        self.assertIsInstance(res["d20_rolls"], list)
        self.assertEqual(len(res["d20_rolls"]), 5)
        for die_val in res["d20_rolls"]:
            self.assertGreaterEqual(die_val, 1)
            self.assertLessEqual(die_val, 20)
        self.assertEqual(res["dice_roll"], sum(res["d20_rolls"]))

        # Verify explicit forced_rolls sums the 5 D20 dice accurately
        custom_res = self.engine.resolve_table_dice_battle(
            {"win_prob_a": 55, "wtc_score_a": 12},
            mode="dice",
            forced_rolls=[11, 14, 9, 12, 8],
            forced_variance=0,
        )
        self.assertEqual(custom_res["d20_rolls"], [11, 14, 9, 12, 8])
        self.assertEqual(custom_res["dice_roll"], 54)
        self.assertEqual(custom_res["winner"], "A")
        self.assertFalse(custom_res["is_upset"])

        # Verify 5% underdog (needing > 95 on 5d20, i.e. 96..100, probability 126 / 3,200,000 = 0.0039%) has virtually 0% chance to win
        upsets_in_400 = 0
        for _ in range(400):
            r = self.engine.resolve_table_dice_battle(pred_95_vs_5, mode="dice")
            if r["winner"] == "B":
                upsets_in_400 += 1
        self.assertLessEqual(upsets_in_400, 1, "5% underdog on 5d20 bell curve should have ~0% win rate")


if __name__ == "__main__":
    unittest.main()


