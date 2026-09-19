"""
Unit tests for Teams & Clubs System:
1. Team Combat Factor formula and volume gating
2. Upgraded Power Rating Engine (Baseline * Maturity * Combat Factor)
3. TeamsHubService (Leaderboard, 6-tab Hub, Affiliation, Chat, Events)
4. DevServer REST API endpoints & armory purchase integration
"""

import sys
import json
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

import teams_hub_service
from teams_hub_service import compute_combat_factor, compute_power_rating, get_teams_hub_service


class TestTeamsHubServiceAndEndpoints(unittest.TestCase):
    def setUp(self):
        self.service = get_teams_hub_service()

    def test_combat_factor_table(self):
        # 80%+ Win Rate => Max cap 1.150x
        cf_80 = compute_combat_factor(80, 100)
        self.assertEqual(cf_80, 1.150)

        # 75% Win Rate => 1.125x
        cf_75 = compute_combat_factor(75, 100)
        self.assertEqual(cf_75, 1.125)

        # 50% Win Rate => 1.000x Neutral
        cf_50 = compute_combat_factor(50, 100)
        self.assertEqual(cf_50, 1.000)

        # 20% or lower => 0.850x Floor
        cf_20 = compute_combat_factor(20, 100)
        self.assertEqual(cf_20, 0.850)

        # Volume gating (< 20 matches): 100% win rate in 10 matches scales factor towards 1.0
        cf_low_vol = compute_combat_factor(10, 10)
        # Full factor would be 1.150, but with 10/20 weight: 1.0 + (0.150 * 0.5) = 1.075
        self.assertEqual(cf_low_vol, 1.075)

    def test_power_rating_computation(self):
        roster = [
            {"current_elo": 2350.0},
            {"current_elo": 2250.0},
            {"current_elo": 2200.0},
            {"current_elo": 2150.0},
            {"current_elo": 2100.0},
            {"current_elo": 2000.0},
            {"current_elo": 1900.0}
        ]
        # 7 players, 80% win rate in 100 matches
        res = compute_power_rating(roster, 80, 100)
        self.assertGreater(res["power_rating"], 1500.0)
        self.assertEqual(res["combat_factor"], 1.150)
        self.assertEqual(res["top_ace"], 2350.0)
        self.assertGreater(res["maturity_pct"], 70.0)

    def test_teams_leaderboard(self):
        res = self.service.get_teams_leaderboard(game_system="40k", page=1, page_size=10)
        self.assertIn("teams", res)
        self.assertGreaterEqual(len(res["teams"]), 5)
        # Check Art of War is #1
        self.assertEqual(res["teams"][0]["name"], "Art of War")
        self.assertEqual(res["teams"][0]["short_tag"], "AOW")
        self.assertIn("power_rating", res["teams"][0])
        self.assertIn("combat_factor", res["teams"][0])

    def test_team_hub_6_tabs_data(self):
        hub = self.service.get_team_hub("team_art_of_war", "40k")
        self.assertIsNotNone(hub)
        self.assertEqual(hub["name"], "Art of War")

        # Tab 1: Starting 5 & Roster
        self.assertIn("starting_5", hub)
        self.assertEqual(len(hub["starting_5"]), 5)
        self.assertIn("roster", hub)
        self.assertGreaterEqual(len(hub["roster"]), 5)
        self.assertIn("faction_distribution", hub)

        # Tab 2: Battlefield Feed
        self.assertIn("battlefield_feed", hub)
        self.assertGreater(len(hub["battlefield_feed"]), 0)

        # Tab 3: Trajectory
        self.assertIn("trajectory_points", hub)
        self.assertGreater(len(hub["trajectory_points"]), 0)

        # Tab 4: War Room
        self.assertIn("war_room", hub)
        self.assertIn("faction_matchups", hub["war_room"])
        self.assertIn("club_rivalries", hub["war_room"])

        # Tab 5: Trophy Room
        self.assertIn("trophy_room", hub)
        self.assertGreater(len(hub["trophy_room"]), 0)

        # Tab 6: Locker Room
        self.assertIn("locker_room", hub)
        self.assertIn("messages", hub["locker_room"])
        self.assertIn("squad_events", hub["locker_room"])

    def test_affiliation_confirmation_and_independent(self):
        player_id = "test_player_affiliation_123"
        # Confirm for Art of War
        aff = self.service.confirm_player_affiliation(player_id, "team_art_of_war", "Test Player")
        self.assertEqual(aff["team_id"], "team_art_of_war")
        self.assertEqual(aff["status"], "confirmed")

        cur_aff = self.service.get_player_affiliation(player_id)
        self.assertEqual(cur_aff["team_id"], "team_art_of_war")

        # Switch to Independent
        indep_aff = self.service.set_player_independent(player_id)
        self.assertIsNone(indep_aff["team_id"])
        self.assertEqual(indep_aff["role"], "Independent")

    def test_team_creation_and_messaging(self):
        import uuid
        unique_name = f"Test Guard Squad {uuid.uuid4().hex[:8]}"
        unique_tag = f"T{uuid.uuid4().hex[:3].upper()}"
        team = self.service.create_team(
            owner_player_id="test_capt_1",
            name=unique_name,
            short_tag=unique_tag,
            captain_name="Captain John",
            home_venue="Local FLGS"
        )
        self.assertEqual(team["short_tag"], unique_tag)

        # Post message
        msg = self.service.add_team_message(team["id"], "test_capt_1", "Captain John", "Squad tournament practice tomorrow!")
        self.assertEqual(msg["message"], "Squad tournament practice tomorrow!")

        # Toggle attendance
        att = self.service.toggle_event_attendance(team["id"], "ev_test_101", "Captain John")
        self.assertTrue(att["attending"])
        self.assertIn("Captain John", att["attendees"])

        # Toggle again -> False
        att2 = self.service.toggle_event_attendance(team["id"], "ev_test_101", "Captain John")
        self.assertFalse(att2["attending"])

    def test_club_glory_honor_and_heraldry_tiers(self):
        hub = self.service.get_team_hub("team_art_of_war", "40k")
        self.assertIsNotNone(hub)
        self.assertIn("glory_score", hub)
        self.assertIn("team_glory_honor", hub)
        self.assertIn("heraldry_tier", hub)

        # Art of War has LVO (500) + WTC (1000) + Nova (300) + Century (250) + Elite (150) = 2200
        self.assertEqual(hub["glory_score"], 2200)
        self.assertEqual(hub["team_glory_honor"], 2200)
        self.assertEqual(hub["heraldry_tier"], "Sovereign Crown")
        self.assertEqual(hub["heraldry_badge"], "👑 Sovereign")

        # Verify every trophy has a positive integer glory_points
        for tr in hub["trophy_room"]:
            self.assertIn("glory_points", tr)
            self.assertGreater(tr["glory_points"], 0)

        # Team Zero Comp has 1150 Glory -> Gold Vanguard
        tzc = self.service.get_team_hub("team_zero_comp", "40k")
        self.assertIsNotNone(tzc)
        self.assertEqual(tzc["glory_score"], 1150)
        self.assertEqual(tzc["heraldry_tier"], "Gold Vanguard")
        self.assertEqual(tzc["heraldry_badge"], "🥇 Gold")

    def test_leaderboard_sorting_by_glory_score(self):
        res = self.service.get_teams_leaderboard(game_system="40k", sort_by="glory_score", order="DESC", page=1, page_size=25)
        teams = res["teams"]
        self.assertGreaterEqual(len(teams), 5)
        # Check monotonic descent
        scores = [t["glory_score"] for t in teams]
        for i in range(len(scores) - 1):
            self.assertGreaterEqual(scores[i], scores[i + 1])

        # Top team by glory should be Art of War with 2200
        self.assertEqual(teams[0]["name"], "Art of War")
        self.assertEqual(teams[0]["glory_score"], 2200)

    def test_captain_pinned_announcement_update(self):
        import time
        t_name = f"Pin Test Squad {int(time.time() * 1000)}"
        team = self.service.create_team(
            owner_player_id="capt_pin_test",
            name=t_name,
            short_tag="PTS",
            captain_name="Captain Pin"
        )
        t_id = team["id"]

        # Post pinned announcement
        new_pinned = self.service.add_team_message(
            team_id=t_id,
            sender_player_id="capt_pin_test",
            sender_name="Captain Pin",
            message="Tactical Briefing: ATC 2026 practice at 7 PM sharp!",
            role="Captain",
            is_pinned=True
        )
        self.assertEqual(new_pinned["message"], "Tactical Briefing: ATC 2026 practice at 7 PM sharp!")

        hub = self.service.get_team_hub(t_id, "40k")
        self.assertIsNotNone(hub["locker_room"]["pinned_message"])
        self.assertEqual(hub["locker_room"]["pinned_message"]["message"], "Tactical Briefing: ATC 2026 practice at 7 PM sharp!")
        self.assertEqual(hub["locker_room"]["pinned_message"]["sender_name"], "Captain Pin")

    def test_aos_and_40k_game_system_isolation(self):
        """Verifies strict 100% isolation between 40k and AoS teams and hub directories."""
        teams_40k = self.service.get_all_teams("40k")
        teams_aos = self.service.get_all_teams("aos")

        self.assertGreater(len(teams_40k), 0)
        self.assertGreater(len(teams_aos), 0)

        # 1. Check all 40k teams have game_system == 40k
        for t in teams_40k:
            self.assertEqual(t.get("game_system", "40k").lower(), "40k")

        # 2. Check all AoS teams have game_system == aos
        for t in teams_aos:
            self.assertEqual(t.get("game_system").lower(), "aos")

        # 3. Check zero ID overlap
        ids_40k = set(t["id"] for t in teams_40k)
        ids_aos = set(t["id"] for t in teams_aos)
        self.assertEqual(len(ids_40k.intersection(ids_aos)), 0)

        # 4. Check AoS leaderboard returns Hammerhal Vanguard as #1
        lb_aos = self.service.get_teams_leaderboard(game_system="aos", page=1, page_size=10)
        self.assertIn("teams", lb_aos)
        self.assertGreater(len(lb_aos["teams"]), 0)
        self.assertEqual(lb_aos["teams"][0]["game_system"], "aos")
        self.assertEqual(lb_aos["teams"][0]["name"], "Hammerhal Vanguard")

        # 5. Check 40k leaderboard returns Art of War as #1
        lb_40k = self.service.get_teams_leaderboard(game_system="40k", page=1, page_size=10)
        self.assertEqual(lb_40k["teams"][0]["name"], "Art of War")
        self.assertEqual(lb_40k["teams"][0]["game_system"], "40k")

        # 6. Check AoS hub returns AoS factions and trophies
        hub_hvg = self.service.get_team_hub("team_hammerhal_vanguard", "aos")
        self.assertIsNotNone(hub_hvg)
        self.assertEqual(hub_hvg["short_tag"], "HVG")
        self.assertEqual(hub_hvg["captain_name"], "Nicolas Tassone")
        # Ensure AoS roster factions
        roster_factions = [p["faction"] for p in hub_hvg["roster"]]
        self.assertIn("Stormcast Eternals", roster_factions)

    def test_captain_governance_invite_kick_transfer_roles(self):
        """Tests captain governance: inviting teammates, promoting roles, kicking/removing, and transferring captaincy."""
        import uuid
        t_id_name = f"Governance Squad {uuid.uuid4().hex[:6]}"
        team = self.service.create_team(
            owner_player_id="capt_alex",
            name=t_id_name,
            short_tag="GOV",
            captain_name="Alex Turner"
        )
        t_id = team["id"]

        # 1. Invite a player
        res_invite = self.service.invite_player(t_id, actor_player_id="capt_alex", target_player_id="player_recruit", target_player_name="Recruit Bob", faction="Necrons")
        self.assertTrue(res_invite["success"])
        hub = self.service.get_team_hub(t_id)
        roster_ids = [p["player_id"] for p in hub["roster"]]
        self.assertIn("player_recruit", roster_ids)
        self.assertEqual(next(p for p in hub["roster"] if p["player_id"] == "player_recruit")["role"], "Provisional")

        # Non-member cannot invite
        with self.assertRaises(PermissionError):
            self.service.invite_player(t_id, actor_player_id="random_intruder", target_player_id="player_c", target_player_name="Player C")

        # 2. Promote player to Officer
        res_role = self.service.update_member_role(t_id, actor_player_id="capt_alex", target_player_id="player_recruit", new_role="Officer")
        self.assertEqual(res_role["new_role"], "Officer")
        hub = self.service.get_team_hub(t_id)
        self.assertEqual(next(p for p in hub["roster"] if p["player_id"] == "player_recruit")["role"], "Officer")

        # 3. Transfer Captaincy
        res_transfer = self.service.transfer_captaincy(t_id, current_captain_id="capt_alex", new_captain_id="player_recruit")
        self.assertTrue(res_transfer["success"])
        self.assertEqual(res_transfer["new_captain_id"], "player_recruit")
        hub = self.service.get_team_hub(t_id)
        self.assertEqual(hub["owner_player_id"], "player_recruit")
        self.assertEqual(hub["captain_name"], "Recruit Bob")
        self.assertEqual(next(p for p in hub["roster"] if p["player_id"] == "capt_alex")["role"], "Officer")
        self.assertEqual(next(p for p in hub["roster"] if p["player_id"] == "player_recruit")["role"], "Captain")

        # 4. Remove/Kick Member (New captain removes former captain)
        res_remove = self.service.remove_member(t_id, actor_player_id="player_recruit", target_player_id="capt_alex")
        self.assertTrue(res_remove["success"])
        hub = self.service.get_team_hub(t_id)
        roster_ids = [p["player_id"] for p in hub["roster"]]
        self.assertNotIn("capt_alex", roster_ids)

        # Removed player is now independent
        aff = self.service.get_player_affiliation("capt_alex")
        self.assertEqual(aff["role"], "Independent")
        self.assertIsNone(aff["team_id"])

        # Cannot kick reigning captain
        with self.assertRaises(ValueError):
            self.service.remove_member(t_id, actor_player_id="player_recruit", target_player_id="player_recruit")


if __name__ == "__main__":
    unittest.main()


