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


if __name__ == "__main__":
    unittest.main()




