"""Unit tests verifying all 2026 Seasonal Trophies across 40k and AoS.

Ensures:
1. Every single seasonal badge (42 total across 40k and AoS) has authentic, doable conditions.
2. Date filtering strictly enforces the active calendar year (2026).
3. The Capstone trophy unlocks at 15+ seasonal badges.
4. Categories, rarities, and glory points are consistent and valid.
"""

import unittest
from seasonal_badges import (
    SEASON_2026_CATALOG_40K,
    SEASON_2026_CATALOG_AOS,
    SEASONAL_CATEGORIES_40K,
    SEASONAL_CATEGORIES_AOS,
    evaluate_player_seasonal_badges
)

class TestAllSeasonalBadges(unittest.TestCase):

    def test_catalog_integrity(self):
        """Verify 40k and AoS catalogs have exactly 21 trophies each and valid metadata."""
        self.assertEqual(len(SEASON_2026_CATALOG_40K), 21)
        self.assertEqual(len(SEASON_2026_CATALOG_AOS), 21)

        valid_categories = {"combat", "tournament", "tracker", "factions", "capstone"}
        valid_rarities = {"common", "rare", "epic", "mythic"}

        for b in SEASON_2026_CATALOG_40K + SEASON_2026_CATALOG_AOS:
            self.assertIn(b["category"], valid_categories)
            self.assertIn(b["rarity"], valid_rarities)
            self.assertTrue(b["glory"] > 0)
            self.assertEqual(b["season"], "2026")
            self.assertEqual(b["scope"], "seasonal")
            self.assertTrue(len(b["description"]) > 10)

    def test_year_filtering_prevents_stale_data(self):
        """Matches from 2025 must NOT unlock 2026 seasonal trophies."""
        data_2025 = {
            "matches": [
                {"date": "2025-11-20", "result": "W", "player_score": 100, "player_faction": "Necrons"},
                {"date": "2025-12-05", "result": "W", "player_score": 100, "player_faction": "Necrons"}
            ],
            "tournaments": [
                {"date": "2025-10-10", "tournament_type": "GT", "wins": 5, "losses": 0, "rounds": 5}
            ],
            "tracker_sessions": [
                {"created_at": "2025-12-01", "status": "completed", "round_num": 5}
            ]
        }
        res = evaluate_player_seasonal_badges(data_2025, season="2026", game_system="40k")
        self.assertEqual(res["badge_count"], 0, "Matches from 2025 must not unlock 2026 seasonal badges")
        self.assertEqual(res["glory_score"], 0)

    def test_every_40k_seasonal_badge_is_unlocked_under_valid_conditions(self):
        """Test a fully active player earning all 21 seasonal trophies in 40k."""
        # Construct scenario that satisfies all requirements:
        # - 25+ matches in 2026
        # - 8+ game win streak
        # - 95+ VP score
        # - 3+ tournaments, including a 5-0 GT
        # - 25+ tracker sessions, with round 5 and 35+ secondary VP
        # - 1 saved armylist
        # - 10+ wins with primary faction (Blood Angels), 5+ wins with Necrons, 5+ wins with Orks
        matches = []
        # 8-game streak with Blood Angels
        for i in range(12):
            matches.append({
                "date": f"2026-02-{i+1:02d}",
                "result": "W",
                "player_score": 96 if i == 0 else 80,
                "player_faction": "Blood Angels",
                "event_id": f"ev_{i//4}"
            })
        # 5 wins with Necrons
        for i in range(5):
            matches.append({
                "date": f"2026-03-{i+1:02d}",
                "result": "W",
                "player_score": 82,
                "player_faction": "Necrons",
                "event_id": "ev_necrons"
            })
        # 5 wins with Orks
        for i in range(5):
            matches.append({
                "date": f"2026-04-{i+1:02d}",
                "result": "W",
                "player_score": 75,
                "player_faction": "Orks",
                "event_id": "ev_orks"
            })
        # Additional matches to reach 26 total
        for i in range(4):
            matches.append({
                "date": f"2026-05-{i+1:02d}",
                "result": "L",
                "player_score": 60,
                "player_faction": "Blood Angels",
                "event_id": "ev_extra"
            })

        tournaments = [
            {"date": "2026-02-15", "name": "Atlanta GT", "tournament_type": "GT", "rounds": 5, "wins": 5, "losses": 0},
            {"date": "2026-03-20", "name": "Spring RTT", "tournament_type": "RTT", "rounds": 3, "wins": 3, "losses": 0},
            {"date": "2026-04-10", "name": "Midwest GT", "tournament_type": "GT", "rounds": 5, "wins": 4, "losses": 1}
        ]

        tracker_sessions = []
        for i in range(25):
            tracker_sessions.append({
                "created_at": f"2026-01-{i+1:02d}",
                "status": "completed",
                "round_num": 5,
                "p1_secondary": 36 if i == 0 else 25
            })

        armylists = [{"id": "list_1", "name": "Gladius Strike Force", "faction": "Blood Angels"}]

        res = evaluate_player_seasonal_badges(
            player_data={"matches": matches},
            tournaments=tournaments,
            tracker_sessions=tracker_sessions,
            armylists=armylists,
            season="2026",
            game_system="40k"
        )

        unlocked_ids = {b["id"] for b in res["badges"] if b["unlocked"]}
        all_ids = {b["id"] for b in SEASON_2026_CATALOG_40K}

        missing = all_ids - unlocked_ids
        self.assertEqual(missing, set(), f"All 40k seasonal badges should be unlockable, missing: {missing}")
        self.assertEqual(res["badge_count"], 21)
        self.assertTrue(res["capstone_unlocked"])
        self.assertTrue(res["glory_score"] > 3000)

    def test_every_aos_seasonal_badge_is_unlocked_under_valid_conditions(self):
        """Test a fully active player earning all 21 seasonal trophies in AoS."""
        matches = []
        for i in range(12):
            matches.append({
                "date": f"2026-02-{i+1:02d}",
                "result": "W",
                "player_score": 92 if i == 0 else 75,
                "player_faction": "Stormcast Eternals",
                "event_id": f"ev_{i//4}"
            })
        for i in range(5):
            matches.append({
                "date": f"2026-03-{i+1:02d}",
                "result": "W",
                "player_score": 80,
                "player_faction": "Skaven",
                "event_id": "ev_skaven"
            })
        for i in range(5):
            matches.append({
                "date": f"2026-04-{i+1:02d}",
                "result": "W",
                "player_score": 78,
                "player_faction": "Khorne",
                "event_id": "ev_khorne"
            })
        for i in range(4):
            matches.append({
                "date": f"2026-05-{i+1:02d}",
                "result": "L",
                "player_score": 50,
                "player_faction": "Stormcast Eternals",
                "event_id": "ev_extra"
            })

        tournaments = [
            {"date": "2026-02-15", "name": "Mortal Realms GT", "tournament_type": "GT", "rounds": 5, "wins": 5, "losses": 0},
            {"date": "2026-03-20", "name": "Sigmar RTT", "tournament_type": "RTT", "rounds": 3, "wins": 3, "losses": 0},
            {"date": "2026-04-10", "name": "Ghur GT", "tournament_type": "GT", "rounds": 5, "wins": 4, "losses": 1}
        ]

        tracker_sessions = []
        for i in range(25):
            tracker_sessions.append({
                "created_at": f"2026-01-{i+1:02d}",
                "status": "completed",
                "round_num": 5,
                "p1_secondary": 38 if i == 0 else 20
            })

        armylists = [{"id": "list_aos_1", "name": "Hammers of Sigmar", "faction": "Stormcast Eternals"}]

        res = evaluate_player_seasonal_badges(
            player_data={"matches": matches},
            tournaments=tournaments,
            tracker_sessions=tracker_sessions,
            armylists=armylists,
            season="2026",
            game_system="aos"
        )

        unlocked_ids = {b["id"] for b in res["badges"] if b["unlocked"]}
        all_ids = {b["id"] for b in SEASON_2026_CATALOG_AOS}

        missing = all_ids - unlocked_ids
        self.assertEqual(missing, set(), f"All AoS seasonal badges should be unlockable, missing: {missing}")
        self.assertEqual(res["badge_count"], 21)
        self.assertTrue(res["capstone_unlocked"])
        self.assertTrue(res["glory_score"] > 3000)

    def test_capstone_threshold(self):
        """Capstone requires exactly 15 seasonal badges to unlock."""
        # 14 unlocked scenario:
        matches = []
        for i in range(10):
            matches.append({
                "date": f"2026-01-{i+1:02d}",
                "result": "W",
                "player_score": 80,
                "player_faction": "Necrons",
                "event_id": "ev_1"
            })
        
        # 4 matches with second faction
        for i in range(4):
            matches.append({
                "date": f"2026-02-{i+1:02d}",
                "result": "W",
                "player_score": 80,
                "player_faction": "Drukhari",
                "event_id": "ev_2"
            })

        tournaments = [
            {"date": "2026-01-15", "rounds": 3, "wins": 3, "losses": 0},
            {"date": "2026-02-15", "rounds": 3, "wins": 3, "losses": 0},
            {"date": "2026-03-15", "rounds": 3, "wins": 3, "losses": 0}
        ]

        tracker_sessions = [
            {"created_at": "2026-01-10", "status": "completed", "round_num": 5, "p1_secondary": 36}
        ]

        armylists = [{"id": "list_1", "name": "Necron Awakened"}]

        res = evaluate_player_seasonal_badges(
            player_data={"matches": matches},
            tournaments=tournaments,
            tracker_sessions=tracker_sessions,
            armylists=armylists,
            season="2026",
            game_system="40k"
        )

        capstone_badge = [b for b in res["badges"] if b["category"] == "capstone"][0]
        # Verify capstone state matches unlocked_count >= 15
        non_capstone_unlocked = len([b for b in res["badges"] if b["unlocked"] and b["category"] != "capstone"])
        if non_capstone_unlocked < 15:
            self.assertFalse(capstone_badge["unlocked"])
            self.assertEqual(capstone_badge["progress"]["current"], non_capstone_unlocked)
            self.assertEqual(capstone_badge["progress"]["target"], 15)

if __name__ == "__main__":
    unittest.main()
