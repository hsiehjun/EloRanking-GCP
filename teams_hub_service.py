"""
teams_hub_service.py - Authoritative Teams & Clubs System Service for OmniTactica.

Handles:
1. Sovereign Team Hub data models (Art of War, Team Zero Comp, etc.)
2. Upgraded Power Rating Engine:
   - Skill Baseline (40% Top 5 + 40% All Active + 20% Top Ace)
   - Active Roster Maturity Curve (10% -> 100% at 30 players)
   - Team Combat Factor (Win % multiplier: 0.850x to 1.150x, 20-match volume gated)
3. 6-Tab Team Hub Data:
   - Starting 5 & Roster (lineups, internal ladder, faction distribution)
   - Battlefield Feed (live match feed & team round scores)
   - Trajectory (historical power rating graph data)
   - War Room (faction matchups & head-to-head club rivalries)
   - Trophy Room (championship banners & club milestones)
   - Locker Room (messages, pinned captain announcements, squad event travel)
4. Player Onboarding Affiliation ("Claim Your Team" modal, provisional vs confirmed)
5. Zero-external-dependency persistence (auto-seeded JSON database with PostgreSQL compatibility)
"""

import os
import json
import time
import math
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any

DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
TEAMS_DB_PATH = DATA_DIR / "teams_hub_db.json"


def compute_combat_factor(total_wins: int, total_matches: int) -> float:
    """
    Computes the Team Combat Record Factor (Win % multiplier).
    Combat Factor = CLAMP(1.000 + (WinRate - 0.50) * 0.50, 0.850, 1.150)
    Gated by a 20-match volume requirement.
    """
    if total_matches <= 0:
        return 1.000
    win_rate = total_wins / total_matches
    raw_factor = 1.000 + (win_rate - 0.50) * 0.50
    clamped_factor = max(0.850, min(1.150, raw_factor))

    # Volume gating for < 20 matches: scale towards neutral 1.0
    if total_matches < 20:
        volume_weight = total_matches / 20.0
        return round(1.000 + (clamped_factor - 1.000) * volume_weight, 3)
    return round(clamped_factor, 3)


def compute_power_rating(active_roster: List[Dict[str, Any]], total_wins: int, total_matches: int) -> Dict[str, Any]:
    """
    Computes:
    Power Rating = Skill Baseline * Roster Maturity % * Team Combat Factor
    """
    active_count = len(active_roster)
    if active_count <= 0:
        return {
            "power_rating": 0.0,
            "skill_baseline": 0.0,
            "maturity_pct": 0.10,
            "combat_factor": 1.000,
            "top5_avg": 0.0,
            "top_ace": 0.0,
            "all_active_avg": 0.0
        }

    sorted_roster = sorted(active_roster, key=lambda p: float(p.get("current_elo", 1500.0)), reverse=True)
    top_ace = float(sorted_roster[0].get("current_elo", 1500.0))
    top5 = sorted_roster[:5]
    top5_avg = sum(float(p.get("current_elo", 1500.0)) for p in top5) / len(top5)
    all_active_avg = sum(float(p.get("current_elo", 1500.0)) for p in sorted_roster) / active_count

    skill_baseline = 0.40 * top5_avg + 0.40 * all_active_avg + 0.20 * top_ace

    # Logarithmic Roster Maturity Curve (10% -> 100%)
    if active_count <= 1:
        maturity_pct = 0.10
    elif active_count >= 30:
        maturity_pct = 1.00
    else:
        maturity_pct = 0.10 + 0.90 * ((math.log10(active_count) / math.log10(30.0)) ** 0.65)

    combat_factor = compute_combat_factor(total_wins, total_matches)
    final_power = round(skill_baseline * maturity_pct * combat_factor, 1)

    return {
        "power_rating": final_power,
        "skill_baseline": round(skill_baseline, 1),
        "maturity_pct": round(maturity_pct * 100.0, 1),
        "combat_factor": combat_factor,
        "top5_avg": round(top5_avg, 1),
        "top_ace": round(top_ace, 1),
        "all_active_avg": round(all_active_avg, 1)
    }


def get_default_teams_seed() -> Dict[str, Any]:
    """Generates the rich initial seed of established clubs, rosters, feeds, and war room data."""
    now_iso = datetime.now(timezone.utc).isoformat()
    yesterday_iso = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    last_week_iso = (datetime.now(timezone.utc) - timedelta(days=6)).isoformat()

    return {
        "teams": [
            {
                "id": "team_art_of_war",
                "name": "Art of War",
                "short_tag": "AOW",
                "bcp_team_id": "T12UL81TWD",
                "owner_player_id": "p_innes",
                "captain_name": "Innes Wilson",
                "home_venue": "At Ease Games",
                "home_city": "San Diego",
                "home_state": "CA",
                "home_country": "USA",
                "game_system": "40k",
                "logo_url": "/assets/badges/badge_tier1_legend.svg",
                "bio": "Discipline. Precision. Mastery. Premier competitive wargaming coaching network and multiple-time Super Major championship organization.",
                "discord_url": "https://discord.gg/artofwar40k",
                "membership_mode": "approval_required",
                "created_at": "2024-01-01T00:00:00Z",
                "total_wins": 345,
                "total_losses": 62,
                "total_draws": 4,
                "roster": [
                    {
                        "player_id": "p_innes",
                        "player_name": "Innes Wilson",
                        "current_elo": 2375.2,
                        "peak_elo": 2390.0,
                        "faction": "Dark Angels",
                        "role": "Captain",
                        "status": "confirmed",
                        "is_active": True,
                        "win_rate": 87.6,
                        "matches_played": 137,
                        "form": "🔥 6W Streak"
                    },
                    {
                        "player_id": "p_folger_pyles",
                        "player_name": "Folger Pyles",
                        "current_elo": 2350.0,
                        "peak_elo": 2365.0,
                        "faction": "Adeptus Custodes",
                        "role": "Core",
                        "status": "confirmed",
                        "is_active": True,
                        "win_rate": 87.3,
                        "matches_played": 166,
                        "form": "🔥 5W Streak"
                    },
                    {
                        "player_id": "p_jack_harpster",
                        "player_name": "Jack Harpster",
                        "current_elo": 2280.4,
                        "peak_elo": 2310.0,
                        "faction": "Blood Angels",
                        "role": "Core",
                        "status": "confirmed",
                        "is_active": True,
                        "win_rate": 84.1,
                        "matches_played": 128,
                        "form": "🔥 4W Streak"
                    },
                    {
                        "player_id": "p_john_lennon",
                        "player_name": "John Lennon",
                        "current_elo": 2240.0,
                        "peak_elo": 2260.0,
                        "faction": "Ultramarines",
                        "role": "Core",
                        "status": "confirmed",
                        "is_active": True,
                        "win_rate": 82.5,
                        "matches_played": 115,
                        "form": "⚡ +18 Elo"
                    },
                    {
                        "player_id": "p_kenny_boucher",
                        "player_name": "Kenny Boucher",
                        "current_elo": 2190.5,
                        "peak_elo": 2210.0,
                        "faction": "Aeldari",
                        "role": "Core",
                        "status": "confirmed",
                        "is_active": True,
                        "win_rate": 80.0,
                        "matches_played": 98,
                        "form": "⚡ +14 Elo"
                    },
                    {
                        "player_id": "p_jack_billing",
                        "player_name": "Jack Billing",
                        "current_elo": 1980.2,
                        "peak_elo": 2010.0,
                        "faction": "Necrons",
                        "role": "Member",
                        "status": "confirmed",
                        "is_active": True,
                        "win_rate": 74.0,
                        "matches_played": 72,
                        "form": "Steady"
                    },
                    {
                        "player_id": "p_quinton",
                        "player_name": "Quinton Johnson",
                        "current_elo": 1940.0,
                        "peak_elo": 1960.0,
                        "faction": "Chaos Space Marines",
                        "role": "Member",
                        "status": "confirmed",
                        "is_active": True,
                        "win_rate": 71.5,
                        "matches_played": 64,
                        "form": "Steady"
                    },
                    {
                        "player_id": "p_markus_stone",
                        "player_name": "Markus Stone",
                        "current_elo": 1890.5,
                        "peak_elo": 1910.0,
                        "faction": "T'au Empire",
                        "role": "Member",
                        "status": "provisional",
                        "is_active": True,
                        "win_rate": 68.0,
                        "matches_played": 45,
                        "form": "Provisional"
                    }
                ],
                "battlefield_feed": [
                    {
                        "id": "feed-1",
                        "date": now_iso,
                        "tournament": "Las Vegas Open 2026",
                        "round": "Championship Finals",
                        "player_name": "Innes Wilson",
                        "faction": "Dark Angels",
                        "opponent_name": "David Gaylard",
                        "opponent_team": "Team Zero Comp",
                        "score": "95 - 42",
                        "result": "win",
                        "elo_delta": "+14.8 Elo",
                        "is_team_round": False
                    },
                    {
                        "id": "feed-2",
                        "date": yesterday_iso,
                        "tournament": "American Team Championship (ATC)",
                        "round": "Round 5 Team Match",
                        "match_title": "ATC Round 5: Art of War def. Team Zero Comp (3 - 2)",
                        "is_team_round": True,
                        "result": "team_win",
                        "round_score": "3 tables to 2",
                        "notes": "Jack Harpster, John Lennon, and Innes Wilson secured table victories to lock 1st place."
                    },
                    {
                        "id": "feed-3",
                        "date": last_week_iso,
                        "tournament": "SoCal Open Major",
                        "round": "Round 4",
                        "player_name": "Folger Pyles",
                        "faction": "Adeptus Custodes",
                        "opponent_name": "Marcus Vance",
                        "opponent_team": "Independent",
                        "score": "88 - 50",
                        "result": "win",
                        "elo_delta": "+11.2 Elo",
                        "is_team_round": False
                    }
                ],
                "war_room": {
                    "faction_matchups": [
                        {"enemy_faction": "Space Marines (Astartes)", "encounters": 38, "wins": 32, "losses": 6, "win_rate": 84.2},
                        {"enemy_faction": "Aeldari", "encounters": 24, "wins": 19, "losses": 5, "win_rate": 79.2},
                        {"enemy_faction": "Necrons", "encounters": 22, "wins": 17, "losses": 5, "win_rate": 77.3},
                        {"enemy_faction": "Orks", "encounters": 18, "wins": 16, "losses": 2, "win_rate": 88.9},
                        {"enemy_faction": "Imperial Knights", "encounters": 16, "wins": 14, "losses": 2, "win_rate": 87.5},
                        {"enemy_faction": "Drukhari", "encounters": 12, "wins": 7, "losses": 5, "win_rate": 58.3}
                    ],
                    "club_rivalries": [
                        {"rival_team": "Team Zero Comp", "matches_played": 22, "wins": 14, "losses": 8, "win_rate": 63.6, "last_played": "ATC 2026"},
                        {"rival_team": "Vanguard Tactics", "matches_played": 16, "wins": 12, "losses": 4, "win_rate": 75.0, "last_played": "LVO 2026"},
                        {"rival_team": "Team Ignite", "matches_played": 14, "wins": 11, "losses": 3, "win_rate": 78.6, "last_played": "Nova Open 2025"}
                    ]
                },
                "trophy_room": [
                    {"id": "tr-1", "title": "2026 LVO Champions", "icon": "👑", "category": "Super Major Title", "awarded_date": "Jan 2026", "significance": "Undefeated 8-0 run by Innes Wilson"},
                    {"id": "tr-2", "title": "2025 WTC Champions", "icon": "🏆", "category": "World Championship", "awarded_date": "Aug 2025", "significance": "Team USA Anchor Squad (Jack Harpster, John Lennon)"},
                    {"id": "tr-3", "title": "2025 Nova Open Champions", "icon": "🥇", "category": "Major GT Title", "awarded_date": "Sep 2025", "significance": "Folger Pyles 1st Place overall"},
                    {"id": "tr-4", "title": "Century Club: 300+ Wins", "icon": "🎖️", "category": "Club Milestone", "awarded_date": "2025", "significance": "Over 300 sanctioned tournament wins under the AOW banner"},
                    {"id": "tr-5", "title": "Elite Powerhouse", "icon": "⭐", "category": "Squad Caliber", "awarded_date": "2026", "significance": "Five active competitors over 2,100 Elo"}
                ],
                "locker_room": {
                    "pinned_message": {
                        "id": "msg-pinned",
                        "sender_name": "Innes Wilson",
                        "role": "Captain",
                        "message": "📌 Practice session this Thursday 6:30 PM at At Ease Games. Bringing Pariah Nexus Layout 2. Testing against Custodes and Necrons.",
                        "timestamp": now_iso
                    },
                    "messages": [
                        {
                            "id": "msg-1",
                            "sender_name": "Folger Pyles",
                            "role": "Core",
                            "message": "Running the double Warden brick list on Table 3. Need high AP sparring partners.",
                            "timestamp": yesterday_iso
                        },
                        {
                            "id": "msg-2",
                            "sender_name": "Jack Harpster",
                            "role": "Core",
                            "message": "Blood Angels Vanguard is tuned for ATC. Ready for round 1 pairings.",
                            "timestamp": last_week_iso
                        }
                    ],
                    "squad_events": [
                        {
                            "event_id": "Xeqy73dRB0LL",
                            "event_name": "Bay Area Open 2026 Grand Tournament",
                            "event_date": "2026-06-14",
                            "venue": "San Jose McEnery Convention Center",
                            "city": "San Jose, CA",
                            "confirmed_attendees": ["Innes Wilson", "Folger Pyles", "Jack Harpster", "John Lennon"],
                            "notes": "Carpool leaving San Diego Friday 9:00 AM."
                        }
                    ]
                }
            },
            {
                "id": "team_zero_comp",
                "name": "Team Zero Comp",
                "short_tag": "TZC",
                "bcp_team_id": "tzc_bcp_99",
                "owner_player_id": "p_david_g",
                "captain_name": "David Gaylard",
                "home_venue": "Element Games NW",
                "home_city": "Manchester",
                "home_state": "Greater Manchester",
                "home_country": "UK",
                "game_system": "40k",
                "logo_url": "/assets/badges/badge_tier1_legend.svg",
                "bio": "European competitive juggernaut. Masters of tempo, tactical positioning, and WTC team tournament preparation.",
                "discord_url": "https://discord.gg/teamzerocomp",
                "membership_mode": "approval_required",
                "created_at": "2024-02-15T00:00:00Z",
                "total_wins": 210,
                "total_losses": 48,
                "total_draws": 2,
                "roster": [
                    {"player_id": "p_david_g", "player_name": "David Gaylard", "current_elo": 2280.4, "peak_elo": 2295.0, "faction": "World Eaters", "role": "Captain", "status": "confirmed", "is_active": True, "win_rate": 85.0, "matches_played": 110, "form": "🔥 4W Streak"},
                    {"player_id": "p_alex_h", "player_name": "Alex Harrison", "current_elo": 2210.0, "peak_elo": 2230.0, "faction": "Necrons", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 81.2, "matches_played": 96, "form": "Steady"},
                    {"player_id": "p_matt_r", "player_name": "Matt Robertson", "current_elo": 2185.5, "peak_elo": 2200.0, "faction": "Aeldari", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 80.4, "matches_played": 88, "form": "⚡ +12 Elo"},
                    {"player_id": "p_vik_v", "player_name": "Vik Vijay", "current_elo": 2150.0, "peak_elo": 2170.0, "faction": "Chaos Space Marines", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 78.5, "matches_played": 84, "form": "Steady"},
                    {"player_id": "p_tom_c", "player_name": "Tom Chen", "current_elo": 2110.0, "peak_elo": 2130.0, "faction": "Thousand Sons", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 77.0, "matches_played": 78, "form": "Steady"},
                    {"player_id": "p_sam_p", "player_name": "Sam Pearson", "current_elo": 1950.0, "peak_elo": 1970.0, "faction": "Drukhari", "role": "Member", "status": "confirmed", "is_active": True, "win_rate": 72.0, "matches_played": 58, "form": "Steady"},
                    {"player_id": "p_oliver_w", "player_name": "Oliver Ward", "current_elo": 1920.0, "peak_elo": 1940.0, "faction": "Grey Knights", "role": "Member", "status": "confirmed", "is_active": True, "win_rate": 70.0, "matches_played": 52, "form": "Steady"}
                ],
                "battlefield_feed": [],
                "war_room": {"faction_matchups": [], "club_rivalries": []},
                "trophy_room": [
                    {"id": "tr-tzc-1", "title": "2025 European Team Champions", "icon": "🏆", "category": "Major Team Title", "awarded_date": "2025", "significance": "1st Place at European Team Invitational"}
                ],
                "locker_room": {"pinned_message": None, "messages": [], "squad_events": []}
            },
            {
                "id": "team_ignite",
                "name": "Team Ignite",
                "short_tag": "IGN",
                "bcp_team_id": "ign_bcp_88",
                "owner_player_id": "p_manning",
                "captain_name": "Manning Feinleib",
                "home_venue": "Battleground Games",
                "home_city": "Boston",
                "home_state": "MA",
                "home_country": "USA",
                "game_system": "40k",
                "logo_url": "/assets/badges/badge_tier1_legend.svg",
                "bio": "Northeastern tournament powerhouse known for relentless offense and data-driven tournament preparation.",
                "discord_url": "https://discord.gg/teamignite",
                "membership_mode": "open",
                "created_at": "2024-03-01T00:00:00Z",
                "total_wins": 180,
                "total_losses": 55,
                "total_draws": 3,
                "roster": [
                    {"player_id": "p_manning", "player_name": "Manning Feinleib", "current_elo": 2170.2, "peak_elo": 2190.0, "faction": "Genestealer Cults", "role": "Captain", "status": "confirmed", "is_active": True, "win_rate": 81.0, "matches_played": 90, "form": "🔥 3W Streak"},
                    {"player_id": "p_ben_c", "player_name": "Ben Cherwien", "current_elo": 2125.0, "peak_elo": 2145.0, "faction": "Adeptus Mechanicus", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 78.0, "matches_played": 82, "form": "Steady"},
                    {"player_id": "p_josh_k", "player_name": "Josh K", "current_elo": 2080.0, "peak_elo": 2100.0, "faction": "Tyranids", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 76.5, "matches_played": 76, "form": "Steady"},
                    {"player_id": "p_seth_m", "player_name": "Seth M", "current_elo": 2040.0, "peak_elo": 2060.0, "faction": "Space Marines", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 74.0, "matches_played": 70, "form": "Steady"},
                    {"player_id": "p_ryan_s", "player_name": "Ryan S", "current_elo": 1980.0, "peak_elo": 2000.0, "faction": "Orks", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 72.0, "matches_played": 64, "form": "Steady"},
                    {"player_id": "p_chris_b", "player_name": "Chris B", "current_elo": 1910.0, "peak_elo": 1930.0, "faction": "Chaos Daemons", "role": "Member", "status": "confirmed", "is_active": True, "win_rate": 69.0, "matches_played": 54, "form": "Steady"}
                ],
                "battlefield_feed": [],
                "war_room": {"faction_matchups": [], "club_rivalries": []},
                "trophy_room": [],
                "locker_room": {"pinned_message": None, "messages": [], "squad_events": []}
            },
            {
                "id": "team_down_under",
                "name": "Down Under Wargaming",
                "short_tag": "DUW",
                "bcp_team_id": "duw_bcp_77",
                "owner_player_id": "p_liam_h",
                "captain_name": "Liam Hackett",
                "home_venue": "Good Games Central",
                "home_city": "Sydney",
                "home_state": "NSW",
                "home_country": "Australia",
                "game_system": "40k",
                "logo_url": "/assets/badges/badge_tier1_legend.svg",
                "bio": "Australasia's foremost competitive club. Regular representatives for Team Australia at the WTC.",
                "discord_url": "https://discord.gg/downunder40k",
                "membership_mode": "approval_required",
                "created_at": "2024-03-10T00:00:00Z",
                "total_wins": 140,
                "total_losses": 60,
                "total_draws": 1,
                "roster": [
                    {"player_id": "p_liam_h", "player_name": "Liam Hackett", "current_elo": 2110.5, "peak_elo": 2130.0, "faction": "Aeldari", "role": "Captain", "status": "confirmed", "is_active": True, "win_rate": 78.0, "matches_played": 75, "form": "Steady"},
                    {"player_id": "p_matt_m", "player_name": "Matt Morosoli", "current_elo": 2085.0, "peak_elo": 2105.0, "faction": "Chaos Space Marines", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 75.0, "matches_played": 68, "form": "Steady"},
                    {"player_id": "p_adam_c", "player_name": "Adam Camilleri", "current_elo": 2050.0, "peak_elo": 2070.0, "faction": "Death Guard", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 73.5, "matches_played": 64, "form": "Steady"},
                    {"player_id": "p_erik_l", "player_name": "Erik L", "current_elo": 1990.0, "peak_elo": 2010.0, "faction": "Necrons", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 70.0, "matches_played": 58, "form": "Steady"},
                    {"player_id": "p_trent_n", "player_name": "Trent N", "current_elo": 1940.0, "peak_elo": 1960.0, "faction": "Space Marines", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 68.0, "matches_played": 52, "form": "Steady"}
                ],
                "battlefield_feed": [],
                "war_room": {"faction_matchups": [], "club_rivalries": []},
                "trophy_room": [],
                "locker_room": {"pinned_message": None, "messages": [], "squad_events": []}
            },
            {
                "id": "team_vanguard_tactics",
                "name": "Vanguard Tactics",
                "short_tag": "VT",
                "bcp_team_id": "vt_bcp_66",
                "owner_player_id": "p_stephen_box",
                "captain_name": "Stephen Box",
                "home_venue": "Firestorm Games",
                "home_city": "Cardiff",
                "home_state": "Wales",
                "home_country": "UK",
                "game_system": "40k",
                "logo_url": "/assets/badges/badge_tier1_legend.svg",
                "bio": "Competitive academy and tournament squad dedicated to sportsmanship, tactical excellence, and precision play.",
                "discord_url": "https://discord.gg/vanguardtactics",
                "membership_mode": "approval_required",
                "created_at": "2024-01-20T00:00:00Z",
                "total_wins": 125,
                "total_losses": 65,
                "total_draws": 2,
                "roster": [
                    {"player_id": "p_stephen_box", "player_name": "Stephen Box", "current_elo": 2040.0, "peak_elo": 2065.0, "faction": "Blood Angels", "role": "Captain", "status": "confirmed", "is_active": True, "win_rate": 74.0, "matches_played": 68, "form": "Steady"},
                    {"player_id": "p_colin_s", "player_name": "Colin S", "current_elo": 2010.0, "peak_elo": 2030.0, "faction": "Adeptus Custodes", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 72.0, "matches_played": 62, "form": "Steady"},
                    {"player_id": "p_rich_s", "player_name": "Rich S", "current_elo": 1970.0, "peak_elo": 1990.0, "faction": "Space Marines", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 70.0, "matches_played": 58, "form": "Steady"},
                    {"player_id": "p_dan_g", "player_name": "Dan G", "current_elo": 1930.0, "peak_elo": 1950.0, "faction": "Necrons", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 67.0, "matches_played": 52, "form": "Steady"},
                    {"player_id": "p_luke_h", "player_name": "Luke H", "current_elo": 1880.0, "peak_elo": 1900.0, "faction": "Aeldari", "role": "Member", "status": "confirmed", "is_active": True, "win_rate": 65.0, "matches_played": 46, "form": "Steady"}
                ],
                "battlefield_feed": [],
                "war_room": {"faction_matchups": [], "club_rivalries": []},
                "trophy_room": [],
                "locker_room": {"pinned_message": None, "messages": [], "squad_events": []}
            },
            # ── AGE OF SIGMAR (AoS) PREMIER COMPETITIVE CLUBS ──
            {
                "id": "team_hammerhal_vanguard",
                "name": "Hammerhal Vanguard",
                "short_tag": "HVG",
                "owner_player_id": "p_nico_t",
                "captain_name": "Nicolas Tassone",
                "home_venue": "Sanctuary Gaming Centre",
                "home_city": "Nottingham",
                "home_state": "England",
                "home_country": "UK",
                "game_system": "aos",
                "logo_url": "/assets/badges/badge_tier1_legend.svg",
                "bio": "Premier competitive Age of Sigmar team competing across European and US Grand Tournaments. Masters of celestial lightning and Sigmarite battle tactics.",
                "discord_url": "https://discord.gg/hammerhal",
                "membership_mode": "approval_required",
                "created_at": "2024-02-01T00:00:00Z",
                "total_wins": 210,
                "total_losses": 45,
                "total_draws": 3,
                "roster": [
                    {"player_id": "p_nico_t", "player_name": "Nicolas Tassone", "current_elo": 2280.0, "peak_elo": 2310.0, "faction": "Stormcast Eternals", "role": "Captain", "status": "confirmed", "is_active": True, "win_rate": 82.5, "matches_played": 110, "form": "⚡ +16 Elo"},
                    {"player_id": "p_matt_d", "player_name": "Matthew Davies", "current_elo": 2210.0, "peak_elo": 2240.0, "faction": "Cities of Sigmar", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 79.0, "matches_played": 92, "form": "Steady"},
                    {"player_id": "p_jack_a", "player_name": "Jack Armstrong", "current_elo": 2170.0, "peak_elo": 2195.0, "faction": "Sylvaneth", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 77.0, "matches_played": 84, "form": "Steady"},
                    {"player_id": "p_jeremy_v", "player_name": "Jeremy Veysseire", "current_elo": 2140.0, "peak_elo": 2160.0, "faction": "Lumineth Realm-lords", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 75.5, "matches_played": 78, "form": "Steady"},
                    {"player_id": "p_dan_f", "player_name": "Dan Ford", "current_elo": 2090.0, "peak_elo": 2110.0, "faction": "Kharadron Overlords", "role": "Member", "status": "confirmed", "is_active": True, "win_rate": 73.0, "matches_played": 70, "form": "Steady"},
                    {"player_id": "p_adam_e", "player_name": "Adam Ellis", "current_elo": 1980.0, "peak_elo": 2010.0, "faction": "Fyreslayers", "role": "Member", "status": "confirmed", "is_active": True, "win_rate": 69.5, "matches_played": 56, "form": "Steady"}
                ],
                "battlefield_feed": [
                    {
                        "id": "feed-aos-1",
                        "date": now_iso,
                        "tournament": "London Grand Tournament (AoS)",
                        "round": "Finals",
                        "player_name": "Nicolas Tassone",
                        "faction": "Stormcast Eternals",
                        "opponent_name": "Will Brittain",
                        "opponent_team": "Aqshy Reavers",
                        "score": "28 - 14",
                        "result": "win",
                        "elo_delta": "+15.2 Elo",
                        "is_team_round": False
                    },
                    {
                        "id": "feed-aos-2",
                        "date": yesterday_iso,
                        "tournament": "European Team Championship (ETC AoS)",
                        "round": "Round 5 Team Match",
                        "match_title": "ETC Round 5: Hammerhal Vanguard def. Aqshy Reavers (4 - 1)",
                        "is_team_round": True,
                        "result": "team_win",
                        "round_score": "4 tables to 1",
                        "notes": "Decisive battle tactic completion in battle rounds 3 and 4."
                    }
                ],
                "war_room": {
                    "faction_matchups": [
                        {"enemy_faction": "Slaves to Darkness", "encounters": 28, "wins": 23, "losses": 5, "win_rate": 82.1},
                        {"enemy_faction": "Soulblight Gravelords", "encounters": 25, "wins": 20, "losses": 5, "win_rate": 80.0},
                        {"enemy_faction": "Skaven", "encounters": 20, "wins": 17, "losses": 3, "win_rate": 85.0},
                        {"enemy_faction": "Ossiarch Bonereapers", "encounters": 16, "wins": 12, "losses": 4, "win_rate": 75.0}
                    ],
                    "club_rivalries": [
                        {
                            "rival_team": "Aqshy Reavers",
                            "matches_played": 18,
                            "wins": 13,
                            "losses": 5,
                            "win_rate": 72.2,
                            "last_played": "ETC 2026",
                            "team_rounds": {"wins": 3, "losses": 1, "played": 4},
                            "singles_clashes": {"wins": 10, "losses": 4, "played": 14}
                        },
                        {
                            "rival_team": "Shyish Deathlords",
                            "matches_played": 12,
                            "wins": 9,
                            "losses": 3,
                            "win_rate": 75.0,
                            "last_played": "London Open 2025",
                            "team_rounds": {"wins": 2, "losses": 0, "played": 2},
                            "singles_clashes": {"wins": 7, "losses": 3, "played": 10}
                        }
                    ]
                },
                "trophy_room": [
                    {"id": "tr-aos-1", "title": "2025 AoS Worlds Team Champions", "icon": "🏆", "category": "World Championship", "awarded_date": "Aug 2025", "significance": "Undefeated 5v5 team tournament victory", "glory_points": 1000},
                    {"id": "tr-aos-2", "title": "2026 London AoS GT Champions", "icon": "👑", "category": "Super Major Title", "awarded_date": "Jan 2026", "significance": "Nicolas Tassone 1st Place overall", "glory_points": 500},
                    {"id": "tr-aos-3", "title": "Century Club: 200+ AoS Wins", "icon": "🎖️", "category": "Club Milestone", "awarded_date": "2025", "significance": "Over 200 competitive wins under the HVG crest", "glory_points": 250},
                    {"id": "tr-aos-4", "title": "Azyrite Elite", "icon": "⭐", "category": "Squad Caliber", "awarded_date": "2026", "significance": "Four active players over 2,100 Elo", "glory_points": 100}
                ],
                "locker_room": {
                    "pinned_message": {
                        "id": "msg-pinned-aos",
                        "sender_name": "Nicolas Tassone",
                        "role": "Captain",
                        "message": "📌 Practice session this Tuesday at Sanctuary Gaming Centre. Bringing General's Handbook 2025-26 Battlepack.",
                        "timestamp": now_iso
                    },
                    "messages": [
                        {
                            "id": "msg-aos-1",
                            "sender_name": "Matthew Davies",
                            "role": "Core",
                            "message": "Testing the Fusil-Major screen deployment against Slaves to Darkness cavalry.",
                            "timestamp": yesterday_iso
                        }
                    ],
                    "squad_events": [
                        {
                            "event_id": "aos_gt_2026",
                            "event_name": "Warhammer Age of Sigmar European Open 2026",
                            "event_date": "2026-07-12",
                            "venue": "Nottingham Convention Hall",
                            "city": "Nottingham",
                            "confirmed_attendees": ["Nicolas Tassone", "Matthew Davies", "Jack Armstrong"],
                            "notes": "Full 5-man squad attending."
                        }
                    ]
                }
            },
            {
                "id": "team_aqshy_reavers",
                "name": "Aqshy Reavers",
                "short_tag": "AQR",
                "owner_player_id": "p_will_b",
                "captain_name": "Will Brittain",
                "home_venue": "Element Games North West Gaming Centre",
                "home_city": "Stockport",
                "home_state": "England",
                "home_country": "UK",
                "game_system": "aos",
                "logo_url": "/assets/badges/badge_tier1_legend.svg",
                "bio": "Ferocious Realm of Fire aggression. Specialized in high-impact melee pressure and relentless objective domination.",
                "discord_url": "https://discord.gg/aqshyreavers",
                "membership_mode": "approval_required",
                "created_at": "2024-03-10T00:00:00Z",
                "total_wins": 140,
                "total_losses": 55,
                "total_draws": 2,
                "roster": [
                    {"player_id": "p_will_b", "player_name": "Will Brittain", "current_elo": 2180.0, "peak_elo": 2200.0, "faction": "Blades of Khorne", "role": "Captain", "status": "confirmed", "is_active": True, "win_rate": 78.0, "matches_played": 80, "form": "Steady"},
                    {"player_id": "p_tom_m", "player_name": "Tom Mawdsley", "current_elo": 2120.0, "peak_elo": 2140.0, "faction": "Ironjawz", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 74.0, "matches_played": 72, "form": "Steady"},
                    {"player_id": "p_liam_w", "player_name": "Liam Watt", "current_elo": 2050.0, "peak_elo": 2075.0, "faction": "Fyreslayers", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 71.0, "matches_played": 64, "form": "Steady"},
                    {"player_id": "p_chris_bo", "player_name": "Chris Bond", "current_elo": 1990.0, "peak_elo": 2010.0, "faction": "Ogor Mawtribes", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 68.0, "matches_played": 58, "form": "Steady"},
                    {"player_id": "p_dave_g", "player_name": "Dave Grant", "current_elo": 1940.0, "peak_elo": 1960.0, "faction": "Kruleboyz", "role": "Member", "status": "confirmed", "is_active": True, "win_rate": 66.0, "matches_played": 50, "form": "Steady"}
                ],
                "battlefield_feed": [],
                "war_room": {"faction_matchups": [], "club_rivalries": []},
                "trophy_room": [
                    {"id": "tr-aqr-1", "title": "2025 Blood & Glory Major Champions", "icon": "🏆", "category": "Major GT Title", "awarded_date": "Nov 2025", "significance": "Will Brittain 1st Place overall", "glory_points": 500},
                    {"id": "tr-aqr-2", "title": "Century Club: 100+ AoS Wins", "icon": "🎖️", "category": "Club Milestone", "awarded_date": "2025", "significance": "Over 100 competitive wins under AQR banner", "glory_points": 250},
                    {"id": "tr-aqr-3", "title": "Charter Foundation", "icon": "📜", "category": "Club Foundation", "awarded_date": "2024", "significance": "Founded in the Realm of Fire", "glory_points": 100}
                ],
                "locker_room": {"pinned_message": None, "messages": [], "squad_events": []}
            },
            {
                "id": "team_shyish_deathlords",
                "name": "Shyish Deathlords",
                "short_tag": "SDL",
                "owner_player_id": "p_terry_p",
                "captain_name": "Terry Pike",
                "home_venue": "Bad Moon Cafe",
                "home_city": "London",
                "home_state": "England",
                "home_country": "UK",
                "game_system": "aos",
                "logo_url": "/assets/badges/badge_tier1_legend.svg",
                "bio": "Unending legions of death. Master tacticians of the Amethyst Realm and competitive European circuit veterans.",
                "discord_url": "https://discord.gg/shyishdeathlords",
                "membership_mode": "open",
                "created_at": "2024-04-15T00:00:00Z",
                "total_wins": 115,
                "total_losses": 50,
                "total_draws": 1,
                "roster": [
                    {"player_id": "p_terry_p", "player_name": "Terry Pike", "current_elo": 2150.0, "peak_elo": 2170.0, "faction": "Soulblight Gravelords", "role": "Captain", "status": "confirmed", "is_active": True, "win_rate": 76.0, "matches_played": 74, "form": "Steady"},
                    {"player_id": "p_rob_s", "player_name": "Rob Symes", "current_elo": 2080.0, "peak_elo": 2100.0, "faction": "Nighthaunt", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 72.0, "matches_played": 66, "form": "Steady"},
                    {"player_id": "p_dan_st", "player_name": "Dan Street", "current_elo": 2020.0, "peak_elo": 2040.0, "faction": "Ossiarch Bonereapers", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 69.5, "matches_played": 58, "form": "Steady"},
                    {"player_id": "p_sam_p", "player_name": "Sam Pearson", "current_elo": 1970.0, "peak_elo": 1990.0, "faction": "Flesh-eater Courts", "role": "Core", "status": "confirmed", "is_active": True, "win_rate": 67.0, "matches_played": 52, "form": "Steady"},
                    {"player_id": "p_ben_j", "player_name": "Ben Johnson", "current_elo": 1920.0, "peak_elo": 1940.0, "faction": "Soulblight Gravelords", "role": "Member", "status": "confirmed", "is_active": True, "win_rate": 65.0, "matches_played": 44, "form": "Steady"}
                ],
                "battlefield_feed": [],
                "war_room": {"faction_matchups": [], "club_rivalries": []},
                "trophy_room": [
                    {"id": "tr-sdl-1", "title": "2025 Sheffield Slaughter GT Champions", "icon": "🏆", "category": "Major GT Title", "awarded_date": "Oct 2025", "significance": "Terry Pike 1st Place overall", "glory_points": 500},
                    {"id": "tr-sdl-2", "title": "Century Club: 100+ AoS Wins", "icon": "🎖️", "category": "Club Milestone", "awarded_date": "2025", "significance": "100+ sanctioned tournament wins", "glory_points": 250}
                ],
                "locker_room": {"pinned_message": None, "messages": [], "squad_events": []}
            }
        ],
        "player_affiliations": {
            # Default dev competitor Innes Wilson is confirmed captain of Art of War
            "p_innes": {
                "team_id": "team_art_of_war",
                "team_name": "Art of War",
                "short_tag": "AOW",
                "role": "Captain",
                "status": "confirmed",
                "confirmed_at": "2024-01-01T00:00:00Z"
            }
        },
        "detected_history_presets": {
            "p_innes": [
                {"team_id": "team_art_of_war", "name": "Art of War", "short_tag": "AOW", "match_count": 137, "last_played": "LVO 2026", "is_current": True},
                {"team_id": "team_usa", "name": "Team USA", "short_tag": "USA", "match_count": 12, "last_played": "WTC 2025", "is_current": False}
            ],
            "p_dev_commander": [
                {"team_id": "team_art_of_war", "name": "Art of War", "short_tag": "AOW", "match_count": 18, "last_played": "LVO 2026", "is_current": False},
                {"team_id": "team_zero_comp", "name": "Team Zero Comp", "short_tag": "TZC", "match_count": 8, "last_played": "ATC 2025", "is_current": False},
                {"team_id": "team_ignite", "name": "Team Ignite", "short_tag": "IGN", "match_count": 5, "last_played": "Nova Open", "is_current": False}
            ]
        }
    }


class TeamsHubService:
    def __init__(self, db_file: Path = TEAMS_DB_PATH):
        self.db_file = db_file
        self.state = self._load()

    def _load(self) -> Dict[str, Any]:
        if self.db_file.exists():
            try:
                with open(self.db_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if data and isinstance(data.get("teams"), list) and len(data["teams"]) > 0:
                        return data
            except Exception as e:
                print(f"Notice loading teams DB: {e}")
        seed = get_default_teams_seed()
        self._save_raw(seed)
        return seed

    def _save(self):
        self._save_raw(self.state)

    def _save_raw(self, data: Dict[str, Any]):
        try:
            temp = str(self.db_file) + ".tmp"
            with open(temp, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            os.replace(temp, self.db_file)
        except Exception as e:
            print(f"Error saving teams DB: {e}")

    def _recalculate_team(self, team: Dict[str, Any]) -> Dict[str, Any]:
        """Runs the power rating engine and formats team stats."""
        roster = team.get("roster", [])
        active_roster = [p for p in roster if p.get("is_active", True)]
        total_wins = team.get("total_wins", 0)
        total_losses = team.get("total_losses", 0)
        total_draws = team.get("total_draws", 0)
        total_matches = total_wins + total_losses + total_draws

        pwr_metrics = compute_power_rating(active_roster, total_wins, total_matches)
        win_rate = round((total_wins / total_matches) * 100.0, 1) if total_matches > 0 else 0.0

        top_player = sorted(roster, key=lambda p: float(p.get("current_elo", 1500.0)), reverse=True)[0] if roster else {}

        team["power_rating"] = pwr_metrics["power_rating"]
        team["skill_baseline"] = pwr_metrics["skill_baseline"]
        team["maturity_pct"] = pwr_metrics["maturity_pct"]
        team["combat_factor"] = pwr_metrics["combat_factor"]
        team["top5_avg"] = pwr_metrics["top5_avg"]
        team["top_player_elo"] = pwr_metrics["top_ace"]
        team["top_player_name"] = top_player.get("player_name", "Top Player")
        team["top_player_id"] = top_player.get("player_id", "")
        team["active_avg_elo"] = pwr_metrics["all_active_avg"]
        team["active_roster_count"] = len(active_roster)
        team["roster_count"] = len(roster)
        team["team_win_rate"] = win_rate
        team["total_matches"] = total_matches
        team["is_qualified"] = (len(active_roster) >= 3 and total_matches >= 15)

        return team

    def get_all_teams(self, game_system: str = "40k") -> List[Dict[str, Any]]:
        sys_key = (game_system or "40k").lower()
        teams = self.state.get("teams", [])
        filtered = [t for t in teams if (t.get("game_system", "40k") or "40k").lower() == sys_key]
        for t in filtered:
            self._recalculate_team(t)
        # Sort naturally by power rating DESC
        filtered.sort(key=lambda t: (t.get("power_rating", 0.0), t.get("active_avg_elo", 0.0)), reverse=True)
        for i, t in enumerate(filtered, 1):
            t["rank"] = i
        return filtered

    def get_teams_leaderboard(
        self,
        game_system: str = "40k",
        page: int = 1,
        page_size: int = 25,
        query: Optional[str] = None,
        sort_by: str = "power_rating",
        order: str = "DESC",
        min_roster: int = 1
    ) -> Dict[str, Any]:
        all_teams = self.get_all_teams(game_system)

        if query:
            q = query.strip().lower()
            all_teams = [
                t for t in all_teams
                if q in t.get("name", "").lower() or q in t.get("short_tag", "").lower() or q in t.get("captain_name", "").lower()
            ]

        if min_roster > 1:
            all_teams = [t for t in all_teams if t.get("active_roster_count", 0) >= min_roster]

        reverse = (order.upper() == "DESC")
        valid_fields = ["power_rating", "glory_score", "active_avg_elo", "top_player_elo", "active_roster_count", "roster_count", "team_win_rate", "total_wins", "total_matches"]
        field = sort_by if sort_by in valid_fields else "power_rating"
        all_teams.sort(key=lambda t: t.get(field, 0.0), reverse=reverse)

        total = len(all_teams)
        total_pages = max(1, math.ceil(total / page_size))
        start = (page - 1) * page_size
        end = start + page_size
        items = all_teams[start:end]

        return {
            "teams": items,
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "game_system": game_system
        }

    def get_team_hub(self, team_id_or_name: str, game_system: str = "40k") -> Optional[Dict[str, Any]]:
        target = team_id_or_name.strip().lower()
        all_teams = self.get_all_teams(game_system)
        for t in all_teams:
            if t.get("id", "").lower() == target or t.get("name", "").lower() == target or t.get("short_tag", "").lower() == target:
                hub = dict(t)
                # Starting 5 slice
                active_sorted = sorted([p for p in hub.get("roster", []) if p.get("is_active", True)], key=lambda p: p.get("current_elo", 0), reverse=True)
                hub["starting_5"] = active_sorted[:5]

                # Faction breakdown
                factions_count: Dict[str, int] = {}
                for p in hub.get("roster", []):
                    fac = p.get("faction") or "Unknown"
                    factions_count[fac] = factions_count.get(fac, 0) + 1
                hub["faction_distribution"] = [{"faction": k, "count": v} for k, v in sorted(factions_count.items(), key=lambda x: x[1], reverse=True)]

                # Trajectory chart points with seasonal circuit milestones
                if not hub.get("trajectory_points"):
                    now_yr = datetime.now().year
                    cur_pr = hub.get("power_rating", 1950.0)
                    cur_rk = hub.get("rank", 1)
                    hub["trajectory_points"] = [
                        {"month": f"Oct {now_yr - 1}", "power_rating": round(cur_pr * 0.92, 1), "rank": cur_rk + 2, "milestone": "Post-SoCal Open & Chicago Grand Tournament"},
                        {"month": f"Nov {now_yr - 1}", "power_rating": round(cur_pr * 0.95, 1), "rank": cur_rk + 1, "milestone": "Mid-Season Roster Expansion & 180-Day Calibration"},
                        {"month": f"Dec {now_yr - 1}", "power_rating": round(cur_pr * 0.98, 1), "rank": cur_rk + 1, "milestone": "Pre-LVO Boot Camp & Pariah Nexus Testing"},
                        {"month": f"Jan {now_yr}", "power_rating": cur_pr, "rank": cur_rk, "milestone": "Las Vegas Open Championship (Undefeated 8-0 Top Cut)"}
                    ]
                return hub
        return None

    def get_player_affiliation(self, player_id: str) -> Optional[Dict[str, Any]]:
        affs = self.state.get("player_affiliations", {})
        return affs.get(player_id)

    def get_player_detected_history(self, player_id: str) -> List[Dict[str, Any]]:
        presets = self.state.get("detected_history_presets", {})
        if player_id in presets:
            return presets[player_id]

        # Check if player is on any team roster
        detected = []
        for t in self.state.get("teams", []):
            for p in t.get("roster", []):
                if p.get("player_id") == player_id:
                    detected.append({
                        "team_id": t["id"],
                        "name": t["name"],
                        "short_tag": t["short_tag"],
                        "match_count": p.get("matches_played", 10),
                        "last_played": "Recent Tournament",
                        "is_current": True
                    })
        if not detected:
            detected = [
                {"team_id": "team_art_of_war", "name": "Art of War", "short_tag": "AOW", "match_count": 14, "last_played": "LVO 2026", "is_current": False},
                {"team_id": "team_zero_comp", "name": "Team Zero Comp", "short_tag": "TZC", "match_count": 6, "last_played": "SoCal Open", "is_current": False}
            ]
        return detected

    def confirm_player_affiliation(self, player_id: str, team_id: str, player_name: str = "Player") -> Dict[str, Any]:
        """Confirms a player's official team affiliation from the onboarding modal."""
        if team_id == "independent" or not team_id:
            return self.set_player_independent(player_id)

        target_team = None
        for t in self.state.get("teams", []):
            if t["id"] == team_id or t["name"].lower() == team_id.lower() or t["short_tag"].lower() == team_id.lower():
                target_team = t
                break

        if not target_team:
            raise ValueError(f"Team not found: {team_id}")

        # Update or add to team roster
        existing_roster_p = None
        for p in target_team.get("roster", []):
            if p.get("player_id") == player_id:
                existing_roster_p = p
                break

        now_iso = datetime.now(timezone.utc).isoformat()
        if existing_roster_p:
            existing_roster_p["status"] = "confirmed"
        else:
            target_team.setdefault("roster", []).append({
                "player_id": player_id,
                "player_name": player_name,
                "current_elo": 1850.0,
                "peak_elo": 1850.0,
                "faction": "Space Marines",
                "role": "Member",
                "status": "confirmed",
                "is_active": True,
                "win_rate": 65.0,
                "matches_played": 15,
                "form": "Confirmed"
            })

        aff = {
            "team_id": target_team["id"],
            "team_name": target_team["name"],
            "short_tag": target_team["short_tag"],
            "role": "Member",
            "status": "confirmed",
            "confirmed_at": now_iso
        }
        self.state.setdefault("player_affiliations", {})[player_id] = aff
        self._save()
        return aff

    def set_player_independent(self, player_id: str) -> Dict[str, Any]:
        """Sets a player to independent (no team)."""
        now_iso = datetime.now(timezone.utc).isoformat()
        # Remove from any confirmed team
        for t in self.state.get("teams", []):
            t["roster"] = [p for p in t.get("roster", []) if p.get("player_id") != player_id]

        aff = {
            "team_id": None,
            "team_name": "Independent",
            "short_tag": "",
            "role": "Independent",
            "status": "confirmed",
            "confirmed_at": now_iso
        }
        self.state.setdefault("player_affiliations", {})[player_id] = aff
        self._save()
        return aff

    def create_team(self, owner_player_id: str, name: str, short_tag: str, game_system: str = "40k", **kwargs) -> Dict[str, Any]:
        name_clean = name.strip()
        tag_clean = short_tag.strip().upper()[:8]
        t_id = f"team_{name_clean.lower().replace(' ', '_').replace('-', '_')}"

        for t in self.state.get("teams", []):
            if t["id"] == t_id or t["name"].lower() == name_clean.lower():
                raise ValueError("A club with this name already exists.")

        now_iso = datetime.now(timezone.utc).isoformat()
        new_team = {
            "id": t_id,
            "name": name_clean,
            "short_tag": tag_clean,
            "bcp_team_id": kwargs.get("bcp_team_id", ""),
            "owner_player_id": owner_player_id,
            "captain_name": kwargs.get("captain_name", "Captain"),
            "home_venue": kwargs.get("home_venue", "Local Game Store"),
            "home_city": kwargs.get("home_city", "San Diego"),
            "home_state": kwargs.get("home_state", "CA"),
            "home_country": kwargs.get("home_country", "USA"),
            "game_system": (game_system or "40k").lower(),
            "logo_url": kwargs.get("logo_url", "/assets/badges/badge_tier1_legend.svg"),
            "bio": kwargs.get("bio", "Tabletop gaming club and tournament squad."),
            "discord_url": kwargs.get("discord_url", ""),
            "membership_mode": kwargs.get("membership_mode", "approval_required"),
            "created_at": now_iso,
            "total_wins": 0,
            "total_losses": 0,
            "total_draws": 0,
            "roster": [
                {
                    "player_id": owner_player_id,
                    "player_name": kwargs.get("captain_name", "Captain"),
                    "current_elo": 1850.0,
                    "peak_elo": 1850.0,
                    "faction": "Space Marines",
                    "role": "Captain",
                    "status": "confirmed",
                    "is_active": True,
                    "win_rate": 0.0,
                    "matches_played": 0,
                    "form": "Founder"
                }
            ],
            "battlefield_feed": [],
            "war_room": {"faction_matchups": [], "club_rivalries": []},
            "trophy_room": [
                {"id": f"tr-found-{t_id}", "title": "Club Founded", "icon": "🛡️", "category": "Milestone", "awarded_date": now_iso[:10], "significance": f"Founded on OmniTactica by {kwargs.get('captain_name', 'Captain')}"}
            ],
            "locker_room": {
                "pinned_message": {
                    "id": f"msg-init-{t_id}",
                    "sender_name": kwargs.get("captain_name", "Captain"),
                    "role": "Captain",
                    "message": f"Welcome to the official {name_clean} Team Hub! Let's get our squad ready for tournaments.",
                    "timestamp": now_iso
                },
                "messages": [],
                "squad_events": []
            }
        }
        self.state.setdefault("teams", []).append(new_team)
        self.confirm_player_affiliation(owner_player_id, t_id, kwargs.get("captain_name", "Captain"))
        self._save()
        return new_team

    def add_team_message(self, team_id: str, sender_player_id: str, sender_name: str, message: str, role: str = "Member", is_pinned: bool = False) -> Dict[str, Any]:
        now_iso = datetime.now(timezone.utc).isoformat()
        msg_obj = {
            "id": f"msg_{int(time.time() * 1000)}",
            "sender_player_id": sender_player_id,
            "sender_name": sender_name,
            "role": role,
            "message": message.strip(),
            "timestamp": now_iso
        }
        for t in self.state.get("teams", []):
            if t["id"] == team_id:
                lr = t.setdefault("locker_room", {"pinned_message": None, "messages": [], "squad_events": []})
                if is_pinned:
                    lr["pinned_message"] = msg_obj
                else:
                    lr.setdefault("messages", []).append(msg_obj)
                self._save()
                return msg_obj
        raise ValueError("Team not found")

    def toggle_event_attendance(self, team_id: str, event_id: str, player_name: str) -> Dict[str, Any]:
        for t in self.state.get("teams", []):
            if t["id"] == team_id:
                lr = t.setdefault("locker_room", {"pinned_message": None, "messages": [], "squad_events": []})
                events = lr.setdefault("squad_events", [])
                ev = next((e for e in events if e.get("event_id") == event_id), None)
                if not ev:
                    ev = {
                        "event_id": event_id,
                        "event_name": "Tournament",
                        "event_date": "Upcoming",
                        "confirmed_attendees": []
                    }
                    events.append(ev)
                attendees = ev.setdefault("confirmed_attendees", [])
                if player_name in attendees:
                    attendees.remove(player_name)
                    attending = False
                else:
                    attendees.append(player_name)
                    attending = True
                self._save()
                return {"attending": attending, "attendees": attendees}
        raise ValueError("Team not found")


# Singleton accessor
_service_instance = None


def get_teams_hub_service() -> TeamsHubService:
    global _service_instance
    if _service_instance is None:
        _service_instance = TeamsHubService()
    return _service_instance

