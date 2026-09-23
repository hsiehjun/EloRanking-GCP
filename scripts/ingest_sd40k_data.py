#!/usr/bin/env python3
"""
SD40K (San Diego Force Org) Ingestion Engine & Native League Synchronizer.
Fetches published Google Sheets from sd40k.com, parses Season 38 Pods,
player standings, pairings, career records, and historical Hall of Fame archives.
Saves structured JSON to data/sd40k_league_data.json and native_leagues_db.json.
"""

import os
import sys
import json
import csv
import io
import urllib.request
from datetime import datetime, timezone

WB_ACTIVE = "2PACX-1vT2AdP66fr7kgUC8JQUgebJOiO8N5TwNRESMjJTOAx6TvCWHlQR9PIgRS2-irUA_pLsUnA9KtENQDtt"
WB_HISTORY = "2PACX-1vQrgGrc78DQe0g1sHSr5hMbwkvO3v5tD5W6xBZ5AWvdD3Yl1kKLOPIAZrNrs5SuNHlj7dFEVK7SHnOm"

POD_GIDS = {
    1: {"gid": "0", "name": "Pod #1 - The Hard Boys", "tier": "Premier Division"},
    2: {"gid": "395337824", "name": "Pod #2 - The Deuce", "tier": "Challenger Division"},
    3: {"gid": "1427498145", "name": "Pod #3 - The Average Joes", "tier": "Mid Division A"},
    4: {"gid": "1513253485", "name": "Pod #4 - The F-Shack", "tier": "Mid Division B"},
    5: {"gid": "926348152", "name": "Pod #5 - Purgatory", "tier": "Veteran Relegation"},
    6: {"gid": "308653264", "name": "Pod #6 - The Kiddy Pool", "tier": "Apprentice Division"},
    7: {"gid": "1001329216", "name": "Pod #7 - The Thunderdome", "tier": "Entry & Open Division"}
}

HISTORY_GIDS = {
    "faction_titles": {"gid": "762479233", "title": "Most Pod Titles Won by Faction"},
    "most_games": {"gid": "1708185700", "title": "Most Games Played"},
    "most_wins": {"gid": "847664029", "title": "Most League Season Wins"},
    "titles_and_champs": {"gid": "833757938", "title": "Most Pod Titles & League Championships"},
    "finals_wins": {"gid": "337734355", "title": "Most Wins in the Finals"}
}

PAST_FINALS_CHAMPIONS = [
    {
        "season_label": "2026 Fall (Season 37)",
        "year": 2026,
        "champion": "Rock Liberty",
        "champion_faction": "Genestealer Cults",
        "runner_up": "David Susco",
        "third_place": "Tim Sweet",
        "fourth_place": "Victor Campos",
        "notes": "Rock Liberty swept the bracket 4-0 to claim his 3rd League Championship title."
    },
    {
        "season_label": "2025 Spring",
        "year": 2025,
        "champion": "Rock Liberty",
        "champion_faction": "Genestealer Cults",
        "runner_up": "Neil Braden",
        "notes": "Back-to-back championship appearance."
    },
    {
        "season_label": "2024 Fall",
        "year": 2024,
        "champion": "Ben Nicholls",
        "champion_faction": "Drukhari",
        "runner_up": "Jeremy Larson",
        "notes": "Ben Nicholls clinched the title piloting high-speed Drukhari."
    },
    {
        "season_label": "2023 Fall",
        "year": 2023,
        "champion": "Jason Lenore",
        "champion_faction": "Deathwatch",
        "runner_up": "Rock Liberty",
        "notes": "Jason Lenore capped a 10-win finals career with the championship."
    },
    {
        "season_label": "2023 Spring",
        "year": 2023,
        "champion": "Russell Jacobsen",
        "champion_faction": "Space Wolves",
        "runner_up": "Junior Aflleje",
        "notes": "Russell Jacobsen took Space Wolves to the top of the bracket."
    },
    {
        "season_label": "2022 Spring",
        "year": 2022,
        "champion": "Rock Liberty",
        "champion_faction": "Adeptus Custodes",
        "runner_up": "Junior Aflleje",
        "notes": "Dominant Golden Boys tournament run."
    },
    {
        "season_label": "2021 Fall",
        "year": 2021,
        "champion": "Junior Aflleje",
        "champion_faction": "Drukhari",
        "runner_up": "Jeremy Larson",
        "notes": "Junior Aflleje's 7th all-time SD40K League Championship title!"
    },
    {
        "season_label": "2019 Summer",
        "year": 2019,
        "champion": "Frankie Giampapa",
        "champion_faction": "Genestealer Cults",
        "runner_up": "Neil Braden",
        "notes": "Pre-9th edition tactical mastery by Frankie."
    },
    {
        "season_label": "2019 Winter",
        "year": 2019,
        "champion": "Jordan Román",
        "champion_faction": "Aeldari",
        "runner_up": "Junior Aflleje",
        "notes": "Craftworld Aeldari finals victor."
    }
]

def fetch_csv(wb, gid):
    url = f"https://docs.google.com/spreadsheets/d/e/{wb}/pub?single=true&output=csv&gid={gid}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        content = resp.read().decode("utf-8", errors="replace")
    reader = csv.reader(io.StringIO(content))
    return list(reader)

def parse_int(val, default=0):
    try:
        clean = val.strip().replace(",", "")
        return int(clean)
    except Exception:
        return default

def parse_float(val, default=0.0):
    try:
        clean = val.strip().replace(",", "").replace("%", "")
        return float(clean)
    except Exception:
        return default

def parse_pod(pod_num, pod_meta, rows):
    pod_title = pod_meta["name"]
    pod_tier = pod_meta["tier"]
    pct_played = "0%"
    round_layouts = ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B"]

    # Row 5 metadata
    if len(rows) > 5:
        r5 = rows[5]
        if len(r5) > 1 and r5[1].strip():
            pod_title = r5[1].strip()
        if len(r5) > 6 and "%" in r5[6]:
            pct_played = r5[6].strip()
        layouts = []
        for col_idx in [11, 13, 15, 17, 19]:
            if len(r5) > col_idx and r5[col_idx].strip():
                layouts.append(r5[col_idx].strip())
            else:
                layouts.append(f"Layout {'A' if len(layouts)%2==0 else 'B'}")
        if len(layouts) == 5:
            round_layouts = layouts

    # Career stats parser from row 19+
    career_stats = {}
    career_start_row = -1
    for r_idx, r in enumerate(rows):
        if len(r) > 4 and r[4].strip() == "Player" and any("Win" in cell for cell in r):
            career_start_row = r_idx + 1
            break

    if career_start_row != -1:
        for r in rows[career_start_row:]:
            if len(r) > 4 and r[4].strip() and not r[4].strip().startswith("#"):
                p_name = r[4].strip()
                poty_tot = parse_int(r[2]) if len(r) > 2 else 0
                recent_win_pct = r[5].strip() if len(r) > 5 else "0%"
                avg_pod = parse_float(r[6]) if len(r) > 6 else 0.0
                recent_record = r[8].strip() if len(r) > 8 else "0 - 0 - 0"
                pts_per_game = parse_float(r[10]) if len(r) > 10 else 0.0
                seasons_played = parse_int(r[12]) if len(r) > 12 else 0
                career_win_pct = r[14].strip() if len(r) > 14 else "0%"
                career_record = r[16].strip() if len(r) > 16 else "0 - 0 - 0"
                pod_titles = parse_int(r[18]) if len(r) > 18 else 0
                champs_str = r[20].strip() if len(r) > 20 else ""
                champs = champs_str.count("🏆") if "🏆" in champs_str else parse_int(champs_str)

                career_stats[p_name] = {
                    "poty_total": poty_tot,
                    "recent_win_pct": recent_win_pct,
                    "avg_pod": avg_pod,
                    "recent_record": recent_record,
                    "points_per_game": pts_per_game,
                    "seasons_played": seasons_played,
                    "career_win_pct": career_win_pct,
                    "career_record": career_record,
                    "pod_titles": pod_titles,
                    "championships": champs
                }

    # Players parser (rows 7 through before career stats)
    players = []
    end_row = career_start_row - 2 if career_start_row != -1 else len(rows)
    for r in rows[7:end_row]:
        if len(r) < 5 or not r[4].strip() or r[4].strip().startswith("#"):
            continue
        if "Stats over" in r[4] or "Player" in r[4] or "Bulletin" in r[4] or not r[2].strip().isdigit():
            continue
        relegation = r[1].strip() if len(r) > 1 else "None"
        rank = parse_int(r[2], len(players) + 1) if len(r) > 2 else len(players) + 1
        poty_pts = parse_int(r[3]) if len(r) > 3 else 0
        p_name = r[4].strip()
        primary_faction = r[5].strip() if len(r) > 5 and r[5].strip() else "Unassigned"
        w = parse_int(r[6]) if len(r) > 6 else 0
        l = parse_int(r[7]) if len(r) > 7 else 0
        d = parse_int(r[8]) if len(r) > 8 else 0
        bp = parse_int(r[9]) if len(r) > 9 else 0
        gp = parse_int(r[10]) if len(r) > 10 else 0

        # Pairings for rounds 1 to 5
        pairings = []
        col_pairs = [(11, 12), (13, 14), (15, 16), (17, 18), (19, 20)]
        for round_idx, (opp_col, score_col) in enumerate(col_pairs, start=1):
            opp_name = r[opp_col].strip() if len(r) > opp_col else ""
            score_str = r[score_col].strip() if len(r) > score_col else ""
            score = parse_int(score_str, None) if score_str else None
            is_done = score is not None
            layout = round_layouts[round_idx - 1]

            pairings.append({
                "round": round_idx,
                "layout": layout,
                "opponent_name": opp_name,
                "score": score,
                "is_completed": is_done
            })

        c_info = career_stats.get(p_name, {
            "poty_total": poty_pts,
            "recent_win_pct": "0.0%",
            "avg_pod": float(pod_num),
            "recent_record": f"{w} - {l} - {d}",
            "points_per_game": float(bp / gp) if gp > 0 else 0.0,
            "seasons_played": 1,
            "career_win_pct": "0.0%",
            "career_record": f"{w} - {l} - {d}",
            "pod_titles": 0,
            "championships": 0
        })

        players.append({
            "rank": rank,
            "name": p_name,
            "primary_faction": primary_faction,
            "relegation_status": relegation,
            "poty_points": poty_pts,
            "wins": w,
            "losses": l,
            "draws": d,
            "battle_points": bp,
            "games_played": gp,
            "pairings": pairings,
            "career": c_info
        })

    return {
        "pod_number": pod_num,
        "name": pod_title,
        "tier": pod_tier,
        "completion_rate": pct_played,
        "round_layouts": round_layouts,
        "player_count": len(players),
        "standings": players
    }

def parse_history_sheet(key, meta, rows):
    records = []
    # Find header row
    header_idx = -1
    for i, r in enumerate(rows[:5]):
        if any(c.strip() in ["Rank", "Player Name"] for c in r):
            header_idx = i
            break
    if header_idx == -1:
        header_idx = 2

    for r in rows[header_idx + 1:]:
        non_empty = [c.strip() for c in r if c.strip()]
        if not non_empty:
            continue
        # Extract rank, name, and metric values
        rank = parse_int(r[1]) if len(r) > 1 else len(records) + 1
        name = r[2].strip() if len(r) > 2 else ""
        if not name or name.startswith("#"):
            continue

        if key == "faction_titles":
            titles = parse_int(r[3]) if len(r) > 3 else 0
            wins = parse_int(r[4]) if len(r) > 4 else 0
            players = parse_int(r[5]) if len(r) > 5 else 0
            records.append({
                "rank": rank,
                "faction": name,
                "titles": titles,
                "wins": wins,
                "players": players
            })
        elif key == "most_games":
            games = parse_int(r[3]) if len(r) > 3 else 0
            seasons = parse_int(r[4]) if len(r) > 4 else 0
            records.append({
                "rank": rank,
                "player_name": name,
                "games_played": games,
                "seasons": seasons
            })
        elif key == "most_wins":
            wins = parse_int(r[3]) if len(r) > 3 else 0
            seasons = parse_int(r[4]) if len(r) > 4 else 0
            records.append({
                "rank": rank,
                "player_name": name,
                "league_wins": wins,
                "seasons": seasons
            })
        elif key == "titles_and_champs":
            pod_titles = parse_int(r[3]) if len(r) > 3 else 0
            champs = parse_int(r[4]) if len(r) > 4 else 0
            records.append({
                "rank": rank,
                "player_name": name,
                "pod_titles": pod_titles,
                "league_championships": champs
            })
        elif key == "finals_wins":
            wins = parse_int(r[3]) if len(r) > 3 else 0
            champs = parse_int(r[4]) if len(r) > 4 else 0
            apps = parse_int(r[5]) if len(r) > 5 else 0
            records.append({
                "rank": rank,
                "player_name": name,
                "finals_wins": wins,
                "championships": champs,
                "appearances": apps
            })

    return {
        "key": key,
        "title": meta["title"],
        "records": records
    }

def main():
    print("[SD40K Ingestion] Fetching live Season 38 Pod data...")
    parsed_pods = []
    total_players = 0

    for pod_num, meta in POD_GIDS.items():
        print(f" -> Fetching {meta['name']} (gid={meta['gid']})...")
        try:
            rows = fetch_csv(WB_ACTIVE, meta["gid"])
            pod_data = parse_pod(pod_num, meta, rows)
            parsed_pods.append(pod_data)
            total_players += pod_data["player_count"]
            print(f"    ✓ Extracted {pod_data['player_count']} players ({pod_data['completion_rate']} played)")
        except Exception as e:
            print(f"    ✗ Error fetching Pod {pod_num}: {e}")

    print(f"\n[SD40K Ingestion] Fetching Historical Archives and Hall of Fame...")
    history_data = {}
    for key, meta in HISTORY_GIDS.items():
        print(f" -> Fetching {meta['title']} (gid={meta['gid']})...")
        try:
            rows = fetch_csv(WB_HISTORY, meta["gid"])
            h_data = parse_history_sheet(key, meta, rows)
            history_data[key] = h_data
            print(f"    ✓ Extracted {len(h_data['records'])} entries")
        except Exception as e:
            print(f"    ✗ Error fetching history {key}: {e}")

    # Assemble complete SD40K League entity
    league_database = {
        "league_id": "lg_sd40k",
        "slug": "sd40k",
        "name": "San Diego Force Org (SD40K)",
        "short_name": "SD40K",
        "tagline": "The Premier 40k Pod League of Southern California • 38 Continuous Seasons",
        "city": "San Diego",
        "state": "CA",
        "region": "Southern California",
        "country": "USA",
        "website": "https://sd40k.com",
        "established_year": 2013,
        "commissioners": [
            {"name": "Cooper Waddell (Coop)", "role": "League Founder & Commissioner"},
            {"name": "Ben Nicholls", "role": "Co-Commissioner & Head of Rules"},
            {"name": "Victor Campos", "role": "Senior Advisor"},
            {"name": "Nick Card", "role": "Dicehammer Liaison"},
            {"name": "Jeremy Larson", "role": "Tournament Council"},
            {"name": "Rock Liberty", "role": "Council & Hall of Fame Rep"},
            {"name": "Junior Aflleje", "role": "7x Champion & Team Zero Comp Rep"}
        ],
        "partner_venues": [
            {
                "name": "At Ease Games",
                "address": "8980 Miramar Rd, San Diego, CA 92126",
                "phone": "(858) 549-4263",
                "role": "Primary Official Host Store (Dedicated Matched Play Tables)",
                "perks": "Table fees waived for SD40K league participants with prior booking"
            },
            {
                "name": "Pair A Dice Games",
                "address": "2020 S Rancho Santa Fe Rd #2, San Marcos, CA 92078",
                "role": "North County Venue Partner"
            },
            {
                "name": "Off The Shelf Games",
                "address": "1735 E Main St, El Cajon, CA 92021",
                "role": "East County Venue Partner"
            },
            {
                "name": "TC's Rockets",
                "address": "5155 Waring Rd, San Diego, CA 92120",
                "role": "Central San Diego Venue Partner"
            }
        ],
        "clubs": [
            {"name": "Rage On", "contact": "Cooper Waddell"},
            {"name": "Dicehammer", "contact": "Nick Card"},
            {"name": "Angron's Book Club", "contact": "Alvin Dean Collins"},
            {"name": "Grand Slam", "contact": "Brought to you by Denny's"}
        ],
        "methodology": {
            "title": "The SD40K Pod & Relegation System",
            "summary": "An 8-week season with 5 scheduled games inside tiered pods, featuring automatic promotion/relegation and a single-elimination seasonal finals tournament.",
            "points_limit": 2000,
            "season_duration_weeks": 8,
            "games_per_season": 5,
            "scoring_rule": "sd40k_1000_bonus",
            "scoring_breakdown": {
                "win": "Actual Game VP + 1,000 Bonus Battle Points (e.g. 93 VP = 1,093 BP)",
                "draw": "Actual Game VP + 500 Bonus Battle Points",
                "loss": "Actual Game VP + 0 Bonus Battle Points (e.g. 51 VP = 51 BP)",
                "in_pod_ringer_win": "Actual Game VP + 750 Bonus Battle Points"
            },
            "faction_rules": {
                "lock_policy": "Locked for the entire 8-week season. Must field at least 1,001 points of chosen primary faction in every match.",
                "list_policy": "Flexible lists between rounds. Detachments, units, and enhancements can be adjusted between games."
            },
            "promotion_relegation_rules": {
                "promotion": "Top 2 finishers in Pods 2–7 earn promotion (+1 or +2 pods)",
                "relegation": "Bottom 2 finishers in Pods 1–6 face relegation (-1 or -2 pods)",
                "finals_qualification": "Top Pod 1 competitors qualify for the prestigious 16-player Single Elimination Finals Championship"
            },
            "chess_clock_policy": "Mandatory in Pods 1–3 & Finals if requested by either player 24 hours prior. Pods 4–7 require mutual agreement. 2 hours per player.",
            "tiebreakers": [
                "1. Total Battle Points (inclusive of win bonuses)",
                "2. Head-to-Head result",
                "3. Fastest player to complete all 5 matches",
                "4. Coin toss"
            ]
        },
        "active_season": {
            "season_number": 38,
            "name": "Season 38 (Fall 2026)",
            "status": "active",
            "start_date": "2026-08-15",
            "end_date": "2026-10-15",
            "total_pods": len(parsed_pods),
            "total_players": total_players,
            "pods": parsed_pods
        },
        "hall_of_fame": {
            "finals_champions": PAST_FINALS_CHAMPIONS,
            "leaderboards": history_data
        },
        "meta": {
            "engine": "OmniTactica Native League Architecture v1.0",
            "source": "https://sd40k.com",
            "last_synced": datetime.now(timezone.utc).isoformat(),
            "bcp_isolation_guarantee": "100% Native isolated namespace. Zero writes or locks to BCP tournament tables."
        }
    }

    # Write to data/sd40k_league_data.json
    output_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
    os.makedirs(output_dir, exist_ok=True)
    out_file = os.path.join(output_dir, "sd40k_league_data.json")

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(league_database, f, indent=2, ensure_ascii=False)
    print(f"\n[SD40K Ingestion] Successfully written to {out_file} ({os.path.getsize(out_file):,} bytes)")

    # Also register in data/native_leagues_db.json
    leagues_db_file = os.path.join(output_dir, "native_leagues_db.json")
    leagues_db = {
        "version": "1.0",
        "leagues": [
            {
                "league_id": "lg_sd40k",
                "slug": "sd40k",
                "name": "San Diego Force Org (SD40K)",
                "region": "San Diego, CA",
                "active_season": 38,
                "active_players": total_players,
                "pods_count": len(parsed_pods),
                "commissioner": "Cooper Waddell (Coop) & Ben Nicholls",
                "template": "sd40k_standard_pod_system",
                "status": "active",
                "logo": "/static/images/badges/sd40k_emblem.png",
                "data_path": "sd40k_league_data.json"
            }
        ],
        "available_templates": [
            {
                "id": "sd40k_standard_pod_system",
                "name": "SD40K Pod & Relegation League (Standard 8-Week)",
                "description": "The battle-tested 38-season Southern California format: 8-week season, 5 matches per player, tiered pods of 8 players with 2-up/2-down promotion & relegation, 1,000 BP win bonus, and seasonal single-elimination finals.",
                "points_limit": 2000,
                "rounds": 5,
                "weeks": 8,
                "pod_size": 8,
                "promotion_count": 2,
                "relegation_count": 2,
                "win_bonus_bp": 1000,
                "draw_bonus_bp": 500,
                "ringer_bonus_bp": 750,
                "default_layouts": ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B"]
            },
            {
                "id": "open_community_escalation",
                "name": "Community Escalation League (4-Week / 500-2000 pts)",
                "description": "Gradual progression format starting at 500 points Combat Patrol up to 2,000 points Strike Force over 4 bi-weekly phases.",
                "rounds": 4,
                "weeks": 8,
                "pod_size": 12,
                "win_bonus_bp": 100,
                "draw_bonus_bp": 50
            }
        ]
    }
    with open(leagues_db_file, "w", encoding="utf-8") as f:
        json.dump(leagues_db, f, indent=2, ensure_ascii=False)
    print(f"[SD40K Ingestion] Registered in {leagues_db_file}")

if __name__ == "__main__":
    main()
