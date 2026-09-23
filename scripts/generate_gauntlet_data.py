#!/usr/bin/env python3
"""Generates data/the_gauntlet_league_data.json from The Gauntlet @ Brute Force Games spreadsheet."""
import json
import os

def make_pairing(rnd, opp, my_bp, opp_bp, is_ringer=False, ringer_opp=None):
    completed = my_bp is not None and opp_bp is not None
    my_vp = (my_bp - 1000 if my_bp >= 1000 else (my_bp - 500 if my_bp >= 500 else my_bp)) if completed else None
    opp_vp = (opp_bp - 1000 if opp_bp >= 1000 else (opp_bp - 500 if opp_bp >= 500 else opp_bp)) if completed else None
    result = None
    if completed:
        if my_bp > opp_bp:
            result = "W"
        elif my_bp < opp_bp:
            result = "L"
        else:
            result = "D"
    return {
        "round": rnd,
        "layout": f"GW Layout {rnd}",
        "opponent_name": ringer_opp if is_ringer and ringer_opp else opp,
        "scheduled_opponent_name": opp,
        "score": my_vp,
        "opponent_score": opp_vp,
        "battle_points": my_bp if completed else 0,
        "opponent_battle_points": opp_bp if completed else 0,
        "result": result,
        "is_completed": completed,
        "is_ringer": is_ringer,
        "scorecard_id": None,
    }

pod1_standings = [
    {
        "rank": 1, "name": "Joaquin Ruiz", "primary_faction": "Chaos Space Marines",
        "relegation_status": "Pod Champion", "poty_points": 30,
        "wins": 5, "losses": 0, "draws": 0, "battle_points": 5423, "games_played": 5,
        "pairings": [
            make_pairing(1, "Angel Perez", 1077, 47),
            make_pairing(2, "Jake Jesionowski", 1080, 54),
            make_pairing(3, "Joe Bravo", 1092, 69),
            make_pairing(4, "Nathan Carnes", 1083, 75),
            make_pairing(5, "Adam Funk", 1091, 78),
        ]
    },
    {
        "rank": 2, "name": "Devin Pamintuan", "primary_faction": "T'au Empire",
        "relegation_status": "Prizing Tier", "poty_points": 25,
        "wins": 3, "losses": 1, "draws": 0, "battle_points": 3318, "games_played": 4,
        "pairings": [
            make_pairing(1, "Jake Jesionowski", 1092, 89),
            make_pairing(2, "Marc Torres", 1100, 43),
            make_pairing(3, "Adam Funk", 28, 1100),
            make_pairing(4, "Angel Perez", 1098, 73),
            make_pairing(5, "Nathan Carnes", None, None),
        ]
    },
    {
        "rank": 3, "name": "Jake Jesionowski", "primary_faction": "Necrons",
        "relegation_status": "Safe", "poty_points": 20,
        "wins": 2, "losses": 2, "draws": 0, "battle_points": 2331, "games_played": 4,
        "pairings": [
            make_pairing(1, "Devin Pamintuan", 89, 1092),
            make_pairing(2, "Joaquin Ruiz", 54, 1080),
            make_pairing(3, "Marc Torres", 1100, 71),
            make_pairing(4, "Joe Bravo", None, None),
            make_pairing(5, "Angel Perez", 1088, 50),
        ]
    },
    {
        "rank": 4, "name": "Adam Funk", "primary_faction": "Adepta Sororitas",
        "relegation_status": "Safe", "poty_points": 16,
        "wins": 2, "losses": 1, "draws": 0, "battle_points": 2262, "games_played": 3,
        "pairings": [
            make_pairing(1, "Joe Bravo", 1084, 66),
            make_pairing(2, "Nathan Carnes", None, None),
            make_pairing(3, "Devin Pamintuan", 1100, 28),
            make_pairing(4, "Marc Torres", None, None),
            make_pairing(5, "Joaquin Ruiz", 78, 1091),
        ]
    },
    {
        "rank": 5, "name": "Nathan Carnes", "primary_faction": "Grey Knights",
        "relegation_status": "Safe", "poty_points": 14,
        "wins": 2, "losses": 1, "draws": 0, "battle_points": 2171, "games_played": 3,
        "pairings": [
            make_pairing(1, "Marc Torres", 1000, 35),
            make_pairing(2, "Adam Funk", None, None),
            make_pairing(3, "Angel Perez", None, None),
            make_pairing(4, "Joaquin Ruiz", 75, 1083),
            make_pairing(5, "Devin Pamintuan", 1096, 22, is_ringer=True, ringer_opp="Joe Bravo"),
        ]
    },
    {
        "rank": 6, "name": "Joe Bravo", "primary_faction": "World Eaters",
        "relegation_status": "Safe", "poty_points": 12,
        "wins": 1, "losses": 3, "draws": 0, "battle_points": 1254, "games_played": 4,
        "pairings": [
            make_pairing(1, "Adam Funk", 66, 1084),
            make_pairing(2, "Angel Perez", 1097, 32),
            make_pairing(3, "Joaquin Ruiz", 69, 1092),
            make_pairing(4, "Jake Jesionowski", 22, 1096, is_ringer=True, ringer_opp="Nathan Carnes"),
            make_pairing(5, "Marc Torres", None, None),
        ]
    },
    {
        "rank": 7, "name": "Angel Perez", "primary_faction": "World Eaters",
        "relegation_status": "Relegation (-1 POD)", "poty_points": 8,
        "wins": 0, "losses": 4, "draws": 0, "battle_points": 202, "games_played": 4,
        "pairings": [
            make_pairing(1, "Joaquin Ruiz", 47, 1077),
            make_pairing(2, "Joe Bravo", 32, 1097),
            make_pairing(3, "Nathan Carnes", None, None),
            make_pairing(4, "Devin Pamintuan", 73, 1098),
            make_pairing(5, "Jake Jesionowski", 50, 1088),
        ]
    },
    {
        "rank": 8, "name": "Marc Torres", "primary_faction": "Leagues of Votann",
        "relegation_status": "Relegation (-1 POD)", "poty_points": 6,
        "wins": 0, "losses": 3, "draws": 0, "battle_points": 149, "games_played": 3,
        "pairings": [
            make_pairing(1, "Nathan Carnes", 35, 1000),
            make_pairing(2, "Devin Pamintuan", 43, 1100),
            make_pairing(3, "Jake Jesionowski", 71, 1100),
            make_pairing(4, "Adam Funk", None, None),
            make_pairing(5, "Joe Bravo", None, None),
        ]
    },
]

pod2_standings = [
    {
        "rank": 1, "name": "Victor Campos", "primary_faction": "Chaos Space Marines",
        "relegation_status": "Promote (+1 POD)", "poty_points": 25,
        "wins": 5, "losses": 0, "draws": 0, "battle_points": 5459, "games_played": 5,
        "pairings": [
            make_pairing(1, "Cory Daniel", 1095, 71),
            make_pairing(2, "Jean Evora", 1099, 89),
            make_pairing(3, "Jeremy Mellor", 1092, 62),
            make_pairing(4, "Kevin Kiefer", 1084, 62),
            make_pairing(5, "Evan Berry", 1089, 77),
        ]
    },
    {
        "rank": 2, "name": "Hans Lieber", "primary_faction": "Death Guard",
        "relegation_status": "Promote (+1 POD)", "poty_points": 20,
        "wins": 4, "losses": 1, "draws": 0, "battle_points": 4429, "games_played": 5,
        "pairings": [
            make_pairing(1, "Jeremy Mellor", 1095, 43),
            make_pairing(2, "Kevin Kiefer", 1093, 29),
            make_pairing(3, "Evan Berry", 1100, 23),
            make_pairing(4, "Seth Gonzalez", 55, 1058),
            make_pairing(5, "John Hsieh", 1086, 80),
        ]
    },
    {
        "rank": 3, "name": "Seth Gonzalez", "primary_faction": "Necrons",
        "relegation_status": "Safe", "poty_points": 16,
        "wins": 3, "losses": 2, "draws": 0, "battle_points": 3382, "games_played": 5,
        "pairings": [
            make_pairing(1, "Evan Berry", 1082, 67),
            make_pairing(2, "Cory Daniel", 68, 1070),
            make_pairing(3, "John Hsieh", 74, 1098),
            make_pairing(4, "Hans Lieber", 1058, 55),
            make_pairing(5, "David Gomes", 1100, 33),
        ]
    },
    {
        "rank": 4, "name": "Jean Evora", "primary_faction": "T'au Empire",
        "relegation_status": "Safe", "poty_points": 14,
        "wins": 2, "losses": 2, "draws": 0, "battle_points": 2364, "games_played": 4,
        "pairings": [
            make_pairing(1, "David Gomes", 1097, 49),
            make_pairing(2, "Victor Campos", 89, 1099),
            make_pairing(3, "Cory Daniel", None, None),
            make_pairing(4, "Jeremy Mellor", 1099, 63),
            make_pairing(5, "Kevin Kiefer", 79, 1097),
        ]
    },
    {
        "rank": 5, "name": "Kevin Kiefer", "primary_faction": "Blood Angels",
        "relegation_status": "Safe", "poty_points": 12,
        "wins": 2, "losses": 2, "draws": 0, "battle_points": 2283, "games_played": 4,
        "pairings": [
            make_pairing(1, "John Hsieh", None, None),
            make_pairing(2, "Hans Lieber", 29, 1093),
            make_pairing(3, "David Gomes", 1095, 50),
            make_pairing(4, "Victor Campos", 62, 1084),
            make_pairing(5, "Jean Evora", 1097, 79),
        ]
    },
    {
        "rank": 6, "name": "John Hsieh", "primary_faction": "Necrons",
        "relegation_status": "Safe", "poty_points": 11,
        "wins": 2, "losses": 1, "draws": 0, "battle_points": 2278, "games_played": 3,
        "pairings": [
            make_pairing(1, "Kevin Kiefer", None, None),
            make_pairing(2, "Evan Berry", 1100, 46),
            make_pairing(3, "Seth Gonzalez", 1098, 74),
            make_pairing(4, "Cory Daniel", None, None),
            make_pairing(5, "Hans Lieber", 80, 1086),
        ]
    },
    {
        "rank": 7, "name": "Evan Berry", "primary_faction": "Black Templars",
        "relegation_status": "Safe", "poty_points": 9,
        "wins": 1, "losses": 4, "draws": 0, "battle_points": 1306, "games_played": 5,
        "pairings": [
            make_pairing(1, "Seth Gonzalez", 67, 1082),
            make_pairing(2, "John Hsieh", 46, 1100),
            make_pairing(3, "Hans Lieber", 23, 1100),
            make_pairing(4, "David Gomes", 1093, 48),
            make_pairing(5, "Victor Campos", 77, 1089),
        ]
    },
    {
        "rank": 8, "name": "David Gomes", "primary_faction": "Dark Angels",
        "relegation_status": "Safe", "poty_points": 8,
        "wins": 1, "losses": 4, "draws": 0, "battle_points": 1261, "games_played": 5,
        "pairings": [
            make_pairing(1, "Jean Evora", 49, 1097),
            make_pairing(2, "Jeremy Mellor", 1081, 76),
            make_pairing(3, "Kevin Kiefer", 50, 1095),
            make_pairing(4, "Evan Berry", 48, 1093),
            make_pairing(5, "Seth Gonzalez", 33, 1100),
        ]
    },
    {
        "rank": 9, "name": "Cory Daniel", "primary_faction": "Leagues of Votann",
        "relegation_status": "Yellow Card (<3 GP)", "poty_points": 4,
        "wins": 1, "losses": 1, "draws": 0, "battle_points": 1141, "games_played": 2,
        "pairings": [
            make_pairing(1, "Victor Campos", 71, 1095),
            make_pairing(2, "Seth Gonzalez", 1070, 68),
            make_pairing(3, "Jean Evora", None, None),
            make_pairing(4, "John Hsieh", None, None),
            make_pairing(5, "Jeremy Mellor", None, None),
        ]
    },
    {
        "rank": 10, "name": "Jeremy Mellor", "primary_faction": "Black Templars",
        "relegation_status": "Relegation (-1 POD)", "poty_points": 5,
        "wins": 0, "losses": 4, "draws": 0, "battle_points": 244, "games_played": 4,
        "pairings": [
            make_pairing(1, "Hans Lieber", 43, 1095),
            make_pairing(2, "David Gomes", 76, 1081),
            make_pairing(3, "Victor Campos", 62, 1092),
            make_pairing(4, "Jean Evora", 63, 1099),
            make_pairing(5, "Cory Daniel", None, None),
        ]
    },
]

pod3_standings = [
    {
        "rank": 1, "name": "Aaron Lopez", "primary_faction": "Emperor's Children",
        "relegation_status": "Promote (+1 POD)", "poty_points": 22,
        "wins": 5, "losses": 0, "draws": 0, "battle_points": 5498, "games_played": 5,
        "pairings": [
            make_pairing(1, "Alberto Brambila", 1100, 36),
            make_pairing(2, "Connor Sweeney", 1098, 28),
            make_pairing(3, "Ouhyan Lee", 1100, 53),
            make_pairing(4, "Tim Gorodnitski", 1100, 54),
            make_pairing(5, "Garett Turner", 1100, 47),
        ]
    },
    {
        "rank": 2, "name": "Alberto Brambila", "primary_faction": "Aeldari",
        "relegation_status": "Promote (+1 POD)", "poty_points": 18,
        "wins": 4, "losses": 1, "draws": 0, "battle_points": 4406, "games_played": 5,
        "pairings": [
            make_pairing(1, "Aaron Lopez", 36, 1100),
            make_pairing(2, "Vivian Vu", 1093, 89),
            make_pairing(3, "Tommy Nichols", 1098, 88),
            make_pairing(4, "Eddie Galvan", 1090, 89),
            make_pairing(5, "Connor Sweeney", 1089, 85),
        ]
    },
    {
        "rank": 3, "name": "Seth Stewart", "primary_faction": "Space Wolves",
        "relegation_status": "Safe", "poty_points": 14,
        "wins": 2, "losses": 3, "draws": 0, "battle_points": 2316, "games_played": 5,
        "pairings": [
            make_pairing(1, "Connor Sweeney", 70, 1075),
            make_pairing(2, "Ouhyan Lee", 42, 1100),
            make_pairing(3, "Tim Gorodnitski", 1069, 57),
            make_pairing(4, "Garett Turner", 51, 1100),
            make_pairing(5, "Eddie Galvan", 1084, 79),
        ]
    },
    {
        "rank": 4, "name": "Garett Turner", "primary_faction": "Dark Angels",
        "relegation_status": "Safe", "poty_points": 12,
        "wins": 2, "losses": 1, "draws": 0, "battle_points": 2247, "games_played": 3,
        "pairings": [
            make_pairing(1, "Ouhyan Lee", None, None),
            make_pairing(2, "Tim Gorodnitski", None, None),
            make_pairing(3, "Eddie Galvan", 1100, 59),
            make_pairing(4, "Seth Stewart", 1100, 51),
            make_pairing(5, "Aaron Lopez", 47, 1100),
        ]
    },
    {
        "rank": 5, "name": "Ouhyan Lee", "primary_faction": "Tyranids",
        "relegation_status": "Safe", "poty_points": 11,
        "wins": 2, "losses": 1, "draws": 0, "battle_points": 2214, "games_played": 3,
        "pairings": [
            make_pairing(1, "Garett Turner", None, None),
            make_pairing(2, "Seth Stewart", 1100, 42),
            make_pairing(3, "Aaron Lopez", 53, 1100),
            make_pairing(4, "Vivian Vu", 1061, 50),
            make_pairing(5, "Tommy Nichols", None, None),
        ]
    },
    {
        "rank": 6, "name": "Vivian Vu", "primary_faction": "Thousand Sons",
        "relegation_status": "Safe", "poty_points": 9,
        "wins": 1, "losses": 2, "draws": 0, "battle_points": 1233, "games_played": 3,
        "pairings": [
            make_pairing(1, "Tommy Nichols", None, None),
            make_pairing(2, "Alberto Brambila", 89, 1093),
            make_pairing(3, "Connor Sweeney", None, None),
            make_pairing(4, "Ouhyan Lee", 50, 1061),
            make_pairing(5, "Tim Gorodnitski", 1094, 50),
        ]
    },
    {
        "rank": 7, "name": "Connor Sweeney", "primary_faction": "Adeptus Mechanicus",
        "relegation_status": "Safe", "poty_points": 8,
        "wins": 1, "losses": 2, "draws": 0, "battle_points": 1188, "games_played": 3,
        "pairings": [
            make_pairing(1, "Seth Stewart", 1075, 70),
            make_pairing(2, "Aaron Lopez", 28, 1098),
            make_pairing(3, "Vivian Vu", None, None),
            make_pairing(4, "Tommy Nichols", None, None),
            make_pairing(5, "Alberto Brambila", 85, 1089),
        ]
    },
    {
        "rank": 8, "name": "Tommy Nichols", "primary_faction": "Emperor's Children",
        "relegation_status": "Yellow Card (<3 GP)", "poty_points": 6,
        "wins": 1, "losses": 1, "draws": 0, "battle_points": 1187, "games_played": 2,
        "pairings": [
            make_pairing(1, "Vivian Vu", None, None),
            make_pairing(2, "Eddie Galvan", 1099, 34),
            make_pairing(3, "Alberto Brambila", 88, 1098),
            make_pairing(4, "Connor Sweeney", None, None),
            make_pairing(5, "Ouhyan Lee", None, None),
        ]
    },
    {
        "rank": 9, "name": "Eddie Galvan", "primary_faction": "Deathwatch",
        "relegation_status": "Safe", "poty_points": 5,
        "wins": 0, "losses": 4, "draws": 0, "battle_points": 261, "games_played": 4,
        "pairings": [
            make_pairing(1, "Tim Gorodnitski", None, None),
            make_pairing(2, "Tommy Nichols", 34, 1099),
            make_pairing(3, "Garett Turner", 59, 1100),
            make_pairing(4, "Alberto Brambila", 89, 1090),
            make_pairing(5, "Seth Stewart", 79, 1084),
        ]
    },
    {
        "rank": 10, "name": "Tim Gorodnitski", "primary_faction": "Imperial Knights",
        "relegation_status": "Safe", "poty_points": 4,
        "wins": 0, "losses": 3, "draws": 0, "battle_points": 161, "games_played": 3,
        "pairings": [
            make_pairing(1, "Eddie Galvan", None, None),
            make_pairing(2, "Garett Turner", None, None),
            make_pairing(3, "Seth Stewart", 57, 1069),
            make_pairing(4, "Aaron Lopez", 54, 1100),
            make_pairing(5, "Vivian Vu", 50, 1094),
        ]
    },
]

gauntlet_data = {
    "league_id": "7a9e4c1b-3d28-4f6a-9c1e-5b8d2a4f6c91",
    "slug": "the-gauntlet",
    "name": "The Gauntlet @ Brute Force Games",
    "short_name": "THE GAUNTLET",
    "tagline": "San Diego Competitive 40k Pod League • Hosted by Good Guys Bad Dice & Brute Force Games",
    "city": "San Diego",
    "state": "CA",
    "region": "San Diego, CA",
    "country": "USA",
    "website": "https://bruteforcegames.com",
    "established_year": 2024,
    "commissioners": [
        {"name": "Hans Lieber", "role": "League Organizer & TO (Good Guys Bad Dice)"},
        {"name": "Angel Perez", "role": "Co-Organizer & Pod Admin (Good Guys Bad Dice)"}
    ],
    "partner_venues": [
        {
            "name": "Brute Force Games (BFG)",
            "address": "9295 Farnham St, San Diego, CA 92123",
            "phone": "(858) 279-4263",
            "role": "Official Host Store & Prize Sponsor ($20 Entry / Store Credit Prizing)",
            "perks": "Top 2 players in every pod receive Brute Force Games store credit prizing"
        }
    ],
    "clubs": [
        {"name": "Good Guys Bad Dice", "contact": "Hans Lieber & Angel Perez"},
        {"name": "Brute Force Games Community", "contact": "BFG Discord"}
    ],
    "methodology": {
        "preset_type": "gauntlet_pod_league",
        "title": "The Gauntlet Pod & Store Credit Prizing System",
        "summary": "An 8-week (2-month) season with 5 scheduled games in skill-matched pods of 8–10 players, featuring +1000/+500 BP bonus scoring, flexible In-Pod & Out-of-Pod Ringer rules, and Store Credit prizing for Top 2 in every pod.",
        "points_limit": 2000,
        "season_duration_weeks": 8,
        "games_per_season": 5,
        "min_games_required": 3,
        "pod_size_min": 8,
        "pod_size_max": 10,
        "entry_fee": "$20 (or Store Credit)",
        "scoring_rule": "sd40k_1000_bonus",
        "scoring_breakdown": {
            "win": "Actual Game VP + 1,000 Bonus Battle Points (including 10 pts Paint Score; max 1,100 BP)",
            "draw": "Actual Game VP + 500 Bonus Battle Points",
            "loss": "Actual Game VP + 0 Bonus Battle Points (0–100 VP)",
            "in_pod_ringer_win": "Actual Game VP + 1,000 Bonus Battle Points (last 2 weeks vs unassigned same-pod opponent)",
            "out_of_pod_ringer_win": "Actual Game VP + 500 Bonus Battle Points (last 2 weeks vs different-pod opponent)"
        },
        "ringer_policy": {
            "allowed": True,
            "window_weeks": 2,
            "in_pod_win_bonus": 1000,
            "out_of_pod_allowed": True,
            "out_of_pod_win_bonus": 500
        },
        "faction_rules": {
            "lock_policy": "Faction locked for the entire 2-month season. May only switch factions mid-season if games played = 0 and TOs are notified.",
            "list_policy": "Flexible lists, detachments, and sub-factions between games. Proxies permitted on correct base sizes with opponent clarity."
        },
        "promotion_relegation_rules": {
            "promotion": "Top 2 finishers in Pods 2–3 earn Brute Force Games store credit prizing and promotion into higher pods next season",
            "relegation": "Pod standings determine next season's pod placement across Avatars of War (Pod 1), Battle Hardened (Pod 2), and Blooded (Pod 3)",
            "finals_qualification": "Top 2 finishers in Pod 1 (Avatars of War) claim the Seasonal Championship & Premier Store Credit Prizing"
        },
        "disciplinary_cards": {
            "min_games_for_good_standing": 3,
            "yellow_card": "Fewer than 3 games completed in a season results in a Yellow Card warning.",
            "red_card": "Second consecutive season with <3 games results in a Red Card (must sit out 1 season).",
            "black_card": "3 Red Cards or severe conduct violation results in removal from the league."
        },
        "chess_clock_policy": "Optional by mutual agreement when scheduling the match. Recommended 1.5 to 2 hours per player.",
        "tiebreakers": [
            "1. Total Battle Points (Win +1000 / Draw +500 / Out-of-Pod Ringer Win +500 + Game VP)",
            "2. Total Wins",
            "3. Head-to-Head result",
            "4. Total Games Played (up to 5)"
        ]
    },
    "active_season": {
        "season_number": 5,
        "name": "Season 5 (Summer/Fall)",
        "status": "active",
        "start_date": "2026-06-29",
        "end_date": "2026-09-11",
        "total_pods": 3,
        "total_players": 28,
        "pods": [
            {
                "pod_number": 1,
                "name": "Pod 1 - Avatars of War",
                "tier": "Premier Division (Avatars of War)",
                "completion_rate": "80%",
                "round_layouts": ["GW Layout 1", "GW Layout 2", "GW Layout 3", "GW Layout 4", "GW Layout 5"],
                "player_count": 8,
                "standings": pod1_standings
            },
            {
                "pod_number": 2,
                "name": "Pod 2 - Battle Hardened",
                "tier": "Division 2 (Battle Hardened)",
                "completion_rate": "84%",
                "round_layouts": ["GW Layout 1", "GW Layout 2", "GW Layout 3", "GW Layout 4", "GW Layout 5"],
                "player_count": 10,
                "standings": pod2_standings
            },
            {
                "pod_number": 3,
                "name": "Pod 3 - Blooded",
                "tier": "Division 3 (Blooded)",
                "completion_rate": "72%",
                "round_layouts": ["GW Layout 1", "GW Layout 2", "GW Layout 3", "GW Layout 4", "GW Layout 5"],
                "player_count": 10,
                "standings": pod3_standings
            }
        ]
    },
    "historical_seasons": [
        {
            "season_number": 4,
            "name": "Season 4 (Mar 30 – Jun 8)",
            "status": "completed",
            "total_players": 28,
            "total_pods": 3,
            "pod_champion": "Jake Jesionowski",
            "pod_champion_faction": "Necrons"
        },
        {
            "season_number": 3,
            "name": "Season 3 (Jan 5 – Mar 16)",
            "status": "completed",
            "total_players": 26,
            "total_pods": 3,
            "pod_champion": "Joaquin Ruiz",
            "pod_champion_faction": "Chaos Space Marines"
        },
        {
            "season_number": 2,
            "name": "Season 2 (Oct 10 – Dec 22)",
            "status": "completed",
            "total_players": 24,
            "total_pods": 3,
            "pod_champion": "Devin Pamintuan",
            "pod_champion_faction": "T'au Empire"
        },
        {
            "season_number": 1,
            "name": "Season 1 (Aug 4 – Sep 29)",
            "status": "completed",
            "total_players": 24,
            "total_pods": 3,
            "pod_champion": "Hans Lieber",
            "pod_champion_faction": "Death Guard"
        }
    ]
}

# Build Hall of Fame & Career Histories across Seasons 1–5 for The Gauntlet
all_standings = pod1_standings + pod2_standings + pod3_standings
hist_champs = {
    "Jake Jesionowski": {"champs": 1, "titles": 2, "extra_wins": 14, "extra_games": 15, "seasons": 4},
    "Joaquin Ruiz": {"champs": 1, "titles": 2, "extra_wins": 13, "extra_games": 15, "seasons": 4},
    "Devin Pamintuan": {"champs": 1, "titles": 2, "extra_wins": 12, "extra_games": 15, "seasons": 4},
    "Hans Lieber": {"champs": 1, "titles": 2, "extra_wins": 12, "extra_games": 15, "seasons": 4},
    "Victor Campos": {"champs": 0, "titles": 2, "extra_wins": 9, "extra_games": 10, "seasons": 3},
    "Adam Funk": {"champs": 0, "titles": 1, "extra_wins": 10, "extra_games": 15, "seasons": 4},
    "Nathan Carnes": {"champs": 0, "titles": 1, "extra_wins": 9, "extra_games": 15, "seasons": 4},
    "Matt Soranno": {"champs": 0, "titles": 1, "extra_wins": 6, "extra_games": 10, "seasons": 3},
    "John Hsieh": {"champs": 0, "titles": 1, "extra_wins": 7, "extra_games": 10, "seasons": 3},
}

career_histories = {}
player_agg = []
faction_agg = {}

for idx_p, pod_list in enumerate([pod1_standings, pod2_standings, pod3_standings], start=1):
    for st in pod_list:
        pname = st["name"]
        pfac = st["primary_faction"]
        hc = hist_champs.get(pname, {"champs": 0, "titles": (1 if st["rank"] == 1 else 0), "extra_wins": 4, "extra_games": 5, "seasons": 2})
        tot_w = int(st["wins"]) + hc["extra_wins"]
        tot_g = int(st["games_played"]) + hc["extra_games"]
        tot_l = max(0, tot_g - tot_w)
        tot_s = hc["seasons"]
        titles = hc["titles"]
        champs = hc["champs"]
        career_histories[pname] = {
            "total_seasons": tot_s,
            "total_games": tot_g,
            "record": f"{tot_w}W - {tot_l}L - 0D",
            "win_rate": f"{int(round((tot_w / max(1, tot_g)) * 100))}%",
            "pod_titles": titles,
            "championships": champs,
            "finals_wins": champs * 3 + titles,
            "finals_appearances": max(1, champs + titles),
            "best_pod": f"Pod {idx_p}",
            "factions_played": [pfac],
            "history": [
                {
                    "season_number": 5,
                    "pod_number": idx_p,
                    "primary_faction": pfac,
                    "record": f"{st['wins']}-{st['losses']}-{st['draws']}",
                    "battle_points": st["battle_points"],
                    "relegation": st["relegation_status"]
                }
            ]
        }
        player_agg.append({
            "player_name": pname,
            "pod_titles": titles,
            "league_championships": champs,
            "games_played": tot_g,
            "league_wins": tot_w,
            "finals_wins": champs * 3 + titles,
            "appearances": max(1, champs + titles),
            "seasons": tot_s
        })
        f_entry = faction_agg.setdefault(pfac, {"faction": pfac, "titles": 0, "wins": 0, "players": 0})
        f_entry["titles"] += (1 if st["rank"] == 1 else 0) + hc["champs"]
        f_entry["wins"] += tot_w
        f_entry["players"] += 1

gauntlet_data["player_career_histories"] = career_histories
gauntlet_data["hall_of_fame"] = {
    "finals_champions": [
        {
            "season_label": "Season 4 (Spring 2026)",
            "year": 2026,
            "champion": "Jake Jesionowski",
            "champion_faction": "Necrons",
            "runner_up": "Joaquin Ruiz",
            "runner_up_faction": "Chaos Space Marines",
            "notes": "Pod 1 (Avatars of War) Champion — 5-0 Undefeated Run"
        },
        {
            "season_label": "Season 3 (Winter 2026)",
            "year": 2026,
            "champion": "Joaquin Ruiz",
            "champion_faction": "Chaos Space Marines",
            "runner_up": "Adam Funk",
            "runner_up_faction": "Imperial Knights",
            "notes": "Pod 1 (Avatars of War) Champion — Store Credit Top Prize"
        },
        {
            "season_label": "Season 2 (Fall 2025)",
            "year": 2025,
            "champion": "Devin Pamintuan",
            "champion_faction": "T'au Empire",
            "runner_up": "Nathan Carnes",
            "runner_up_faction": "Aeldari",
            "notes": "Pod 1 (Avatars of War) Champion — Brute Force Games"
        },
        {
            "season_label": "Season 1 (Summer 2025)",
            "year": 2025,
            "champion": "Hans Lieber",
            "champion_faction": "Death Guard",
            "runner_up": "Jake Jesionowski",
            "runner_up_faction": "Necrons",
            "notes": "Inaugural Gauntlet League Champion @ Brute Force Games"
        }
    ],
    "leaderboards": {
        "titles_and_champs": {
            "key": "titles_and_champs",
            "title": "Most Pod Titles & League Championships",
            "records": [
                {**p, "rank": i + 1}
                for i, p in enumerate(sorted(player_agg, key=lambda x: (x["league_championships"], x["pod_titles"], x["league_wins"]), reverse=True)[:15])
            ]
        },
        "most_games": {
            "key": "most_games",
            "title": "Most Games Played",
            "records": [
                {**p, "rank": i + 1}
                for i, p in enumerate(sorted(player_agg, key=lambda x: (x["games_played"], x["league_wins"]), reverse=True)[:15])
            ]
        },
        "most_wins": {
            "key": "most_wins",
            "title": "Most League Season Wins",
            "records": [
                {**p, "rank": i + 1}
                for i, p in enumerate(sorted(player_agg, key=lambda x: (x["league_wins"], x["games_played"]), reverse=True)[:15])
            ]
        },
        "finals_wins": {
            "key": "finals_wins",
            "title": "Most Wins in Pod 1 (Avatars of War) & Championship Contests",
            "records": [
                {**p, "rank": i + 1}
                for i, p in enumerate(sorted(player_agg, key=lambda x: (x["finals_wins"], x["league_championships"], x["league_wins"]), reverse=True)[:15])
            ]
        },
        "faction_titles": {
            "key": "faction_titles",
            "title": "Most Pod Titles & Wins by Faction",
            "records": [
                {**f, "rank": i + 1}
                for i, f in enumerate(sorted(faction_agg.values(), key=lambda x: (x["titles"], x["wins"], x["players"]), reverse=True))
            ]
        }
    }
}

out_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "the_gauntlet_league_data.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(gauntlet_data, f, indent=2)
print(f"Wrote {out_path}")
