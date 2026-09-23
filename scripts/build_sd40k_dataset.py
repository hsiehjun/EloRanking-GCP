import json
import os
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

with open("/tmp/sd40k_raw_datasheet.json", "r", encoding="utf-8") as f:
    raw_datasheet = json.load(f)

with open("/tmp/sd40k_raw_pod8.json", "r", encoding="utf-8") as f:
    raw_pod8 = json.load(f)

with open(DATA_DIR / "sd40k_league_data.json", "r", encoding="utf-8") as f:
    existing_league = json.load(f)

POD_NAMES = {
    1: "The Hard Boys",
    2: "The Deuce",
    3: "The Average Joes",
    4: "The F-Shack",
    5: "Purgatory",
    6: "The Kiddy Pool",
    7: "The Thunderdome",
    8: "The Scrub Tub",
    9: "The Punt Locker",
    10: "The Flat Earth Society"
}

POD_TIERS = {
    1: "Premier Division",
    2: "Challenger Division",
    3: "Contender Division",
    4: "Intermediate Division",
    5: "Reserves Division",
    6: "Entry Division",
    7: "Open Division",
    8: "Development Division",
    9: "Regional Division",
    10: "Foundational Division"
}

# 1. Parse all seasons from Data Sheet
header = raw_datasheet[0]
rows = raw_datasheet[1:]

seasons_dict = {}
player_careers = {}

for r in rows:
    while len(r) < 33:
        r.append("")
    s_num_str = r[30].strip()
    if not s_num_str or not s_num_str.isdigit():
        continue
    s_num = int(s_num_str)
    pod_str = r[7].strip()
    pod_num = int(pod_str) if pod_str.isdigit() else 1
    pname = r[8].strip()
    if not pname:
        continue
    
    faction = r[9].strip() or "Undeclared"
    allegiance = r[10].strip() or "Independent"
    w = int(r[11].strip()) if r[11].strip().isdigit() else 0
    l = int(r[12].strip()) if r[12].strip().isdigit() else 0
    d = int(r[13].strip()) if r[13].strip().isdigit() else 0
    bp = int(r[14].strip()) if r[14].strip().isdigit() else 0
    gp = int(r[15].strip()) if r[15].strip().isdigit() else 0
    relegation = r[1].strip() or "None"
    pod_rank = int(r[2].strip()) if r[2].strip().isdigit() else 1
    poty_pts = int(r[3].strip()) if r[3].strip().isdigit() else 0
    
    # Opponents
    opponents = []
    for idx, opp_col in enumerate([16, 18, 20, 22, 24]):
        opp_name = r[opp_col].strip() if len(r) > opp_col else ""
        score_val = r[opp_col+1].strip() if len(r) > opp_col+1 else ""
        score_int = int(score_val) if score_val.isdigit() else None
        opponents.append({
            "round": idx + 1,
            "layout": f"Layout {chr(65 + (idx % 3))}",
            "opponent_name": opp_name,
            "score": score_int,
            "is_completed": score_int is not None
        })

    if s_num not in seasons_dict:
        seasons_dict[s_num] = {
            "season_number": s_num,
            "name": f"Season {s_num}",
            "status": "active" if s_num == 38 else "completed",
            "total_players": 0,
            "total_pods": 0,
            "pods": {}
        }
    
    if pod_num not in seasons_dict[s_num]["pods"]:
        seasons_dict[s_num]["pods"][pod_num] = {
            "pod_number": pod_num,
            "name": f"POD #{pod_num} - {POD_NAMES.get(pod_num, f'Pod {pod_num}')}",
            "tier": POD_TIERS.get(pod_num, f"Division {pod_num}"),
            "round_layouts": ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B"],
            "player_count": 0,
            "standings": []
        }
    
    player_entry = {
        "rank": pod_rank,
        "name": pname,
        "primary_faction": faction,
        "allegiance": allegiance,
        "relegation_status": relegation,
        "poty_points": poty_pts,
        "wins": w,
        "losses": l,
        "draws": d,
        "battle_points": bp,
        "games_played": gp,
        "pairings": opponents
    }
    
    seasons_dict[s_num]["pods"][pod_num]["standings"].append(player_entry)
    seasons_dict[s_num]["pods"][pod_num]["player_count"] += 1
    seasons_dict[s_num]["total_players"] += 1

    # Career ledger
    if pname not in player_careers:
        player_careers[pname] = {
            "name": pname,
            "total_seasons": 0,
            "total_games": 0,
            "total_wins": 0,
            "total_losses": 0,
            "total_draws": 0,
            "total_bp": 0,
            "best_pod": 99,
            "pod_titles": 0,
            "championships": 0,
            "factions_played": set(),
            "history": []
        }
    
    c = player_careers[pname]
    c["total_seasons"] += 1
    c["total_games"] += gp
    c["total_wins"] += w
    c["total_losses"] += l
    c["total_draws"] += d
    c["total_bp"] += bp
    if pod_num < c["best_pod"]:
        c["best_pod"] = pod_num
    if pod_rank == 1:
        c["pod_titles"] += 1
    if faction and faction != "Undeclared":
        c["factions_played"].add(faction)
    
    c["history"].append({
        "season_number": s_num,
        "pod_number": pod_num,
        "pod_name": POD_NAMES.get(pod_num, f"Pod {pod_num}"),
        "primary_faction": faction,
        "rank": pod_rank,
        "relegation": relegation,
        "record": f"{w}W - {l}L - {d}D",
        "wins": w,
        "losses": l,
        "draws": d,
        "battle_points": bp,
        "poty_points": poty_pts
    })

# Format player careers
formatted_careers = {}
for pname, c in player_careers.items():
    tot_g = c["total_games"]
    win_pct = f"{(c['total_wins'] / tot_g * 100):.1f}%" if tot_g > 0 else "0.0%"
    formatted_careers[pname] = {
        "name": pname,
        "total_seasons": c["total_seasons"],
        "total_games": c["total_games"],
        "record": f"{c['total_wins']}W - {c['total_losses']}L - {c['total_draws']}D",
        "win_pct": win_pct,
        "total_bp": c["total_bp"],
        "best_pod": f"Pod {c['best_pod']}" if c["best_pod"] < 99 else "N/A",
        "pod_titles": c["pod_titles"],
        "factions": sorted(list(c["factions_played"])),
        "history": sorted(c["history"], key=lambda x: x["season_number"], reverse=True)
    }

# Known finals champions to add to career championships
CHAMPIONS_MAP = {
    "Rock Liberty": 3,
    "Junior Aflleje": 7,
    "Ben Nicholls": 2,
    "Jason Lenore": 1,
    "Russell Jacobsen": 1,
    "Frankie Giampapa": 1,
    "Jordan Román": 1,
    "Victor Campos": 1
}
for name, count in CHAMPIONS_MAP.items():
    if name in formatted_careers:
        formatted_careers[name]["championships"] = count

# Build Pod 8 for Season 38
pod8_standings = []
# From raw_pod8 rows 7 to 15 (8 players)
for r in raw_pod8[7:15]:
    # ['', '+ 2 POD', '1', '5', 'Dauntae Forrest', 'Black Templars', '0', '0', '0', '0', '0', 'Jacob', '', 'Deven']
    if len(r) > 8 and r[4].strip():
        releg = r[1].strip()
        prank = int(r[2].strip()) if r[2].strip().isdigit() else 1
        poty = int(r[3].strip()) if r[3].strip().isdigit() else 0
        pname = r[4].strip()
        pfaction = r[5].strip()
        w = int(r[6].strip()) if r[6].strip().isdigit() else 0
        l = int(r[7].strip()) if r[7].strip().isdigit() else 0
        d = int(r[8].strip()) if r[8].strip().isdigit() else 0
        bp = int(r[9].strip()) if r[9].strip().isdigit() else 0
        gp = int(r[10].strip()) if r[10].strip().isdigit() else 0
        
        # Pairings from datasheet or pod8
        # Opponents for pod8 players
        pairings = []
        opp_names = [r[11].strip() if len(r) > 11 else "TBD",
                     r[13].strip() if len(r) > 13 else "TBD",
                     "Round 3 Opponent",
                     "Round 4 Opponent",
                     "Round 5 Opponent"]
        
        if pname == "John Hsieh":
            opp_names = ["Deven Torres (Chaos Demons)", "Joseph Ahlstrom (Adeptus Astartes)", "David Nguyen (Adeptus Custodes)", "Dauntae Forrest (Black Templars)", "Kyle Hoogervorst (Tyranids)"]
        elif pname == "Dauntae Forrest":
            opp_names = ["Jacob Fischer (Adeptus Mechanicus)", "Deven Torres (Chaos Demons)", "Joseph Ahlstrom (Adeptus Astartes)", "John Hsieh (Necrons)", "David Nguyen (Adeptus Custodes)"]
        elif pname == "David Nguyen":
            opp_names = ["Joseph Ahlstrom (Adeptus Astartes)", "Gerardo Lazarte (Black Templars)", "John Hsieh (Necrons)", "Jacob Fischer (Adeptus Mechanicus)", "Dauntae Forrest (Black Templars)"]
        elif pname == "Deven Torres":
            opp_names = ["John Hsieh (Necrons)", "Dauntae Forrest (Black Templars)", "Kyle Hoogervorst (Tyranids)", "Gerardo Lazarte (Black Templars)", "Jacob Fischer (Adeptus Mechanicus)"]
        elif pname == "Gerardo Lazarte":
            opp_names = ["Kyle Hoogervorst (Tyranids)", "David Nguyen (Adeptus Custodes)", "Jacob Fischer (Adeptus Mechanicus)", "Deven Torres (Chaos Demons)", "Joseph Ahlstrom (Adeptus Astartes)"]
        elif pname == "Jacob Fischer":
            opp_names = ["Dauntae Forrest (Black Templars)", "Kyle Hoogervorst (Tyranids)", "Gerardo Lazarte (Black Templars)", "David Nguyen (Adeptus Custodes)", "Deven Torres (Chaos Demons)"]
        elif pname == "Joseph Ahlstrom":
            opp_names = ["David Nguyen (Adeptus Custodes)", "John Hsieh (Necrons)", "Dauntae Forrest (Black Templars)", "Kyle Hoogervorst (Tyranids)", "Gerardo Lazarte (Black Templars)"]
        elif pname == "Kyle Hoogervorst":
            opp_names = ["Gerardo Lazarte (Black Templars)", "Jacob Fischer (Adeptus Mechanicus)", "Deven Torres (Chaos Demons)", "Joseph Ahlstrom (Adeptus Astartes)", "John Hsieh (Necrons)"]

        for idx, opp in enumerate(opp_names):
            pairings.append({
                "round": idx + 1,
                "layout": f"Layout {chr(65 + (idx % 3))}",
                "opponent_name": opp,
                "score": None,
                "is_completed": False
            })

        # Career info for player
        career_stats = formatted_careers.get(pname, {
            "win_pct": "50.0%" if pname == "John Hsieh" else "0.0%",
            "best_pod": "Pod 8",
            "pod_titles": 0,
            "championships": 0,
            "record": "10W - 10L - 0D" if pname == "John Hsieh" else "0W - 0L - 0D",
            "total_seasons": 1
        })

        pod8_standings.append({
            "rank": prank,
            "name": pname,
            "primary_faction": pfaction,
            "allegiance": "Xenos" if pfaction in ["Necrons", "Tyranids", "T'au", "Orks", "Aeldari", "Drukhari"] else ("Chaos" if "Chaos" in pfaction or "Demons" in pfaction or "Heretic" in pfaction or "World Eaters" in pfaction else "Imperial"),
            "relegation_status": releg,
            "poty_points": poty,
            "wins": w,
            "losses": l,
            "draws": d,
            "battle_points": bp,
            "games_played": gp,
            "pairings": pairings,
            "career": career_stats
        })

pod8_obj = {
    "pod_number": 8,
    "name": "POD #8 - The Scrub Tub",
    "tier": "Development Division",
    "completion_rate": "0%",
    "round_layouts": ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B"],
    "player_count": len(pod8_standings),
    "standings": pod8_standings
}

# Add or replace Pod 8 in existing_league active_season
s38_pods = [p for p in existing_league["active_season"]["pods"] if p.get("pod_number") != 8]
s38_pods.append(pod8_obj)
s38_pods.sort(key=lambda p: p["pod_number"])
existing_league["active_season"]["pods"] = s38_pods

existing_league["active_season"]["total_pods"] = len(s38_pods)
existing_league["active_season"]["total_players"] = sum(p["player_count"] for p in s38_pods)

# Build seasons list with metadata
available_seasons_catalog = []
for s_num in sorted(seasons_dict.keys(), reverse=True):
    s_data = seasons_dict[s_num]
    sorted_pod_keys = sorted(s_data["pods"].keys())
    pods_list = [s_data["pods"][k] for k in sorted_pod_keys]
    
    champ = "In Progress" if s_num == 38 else (
        s_data["pods"][1]["standings"][0]["name"] if (1 in s_data["pods"] and len(s_data["pods"][1]["standings"]) > 0) else "N/A"
    )
    champ_faction = ""
    if s_num != 38 and 1 in s_data["pods"] and len(s_data["pods"][1]["standings"]) > 0:
        champ_faction = s_data["pods"][1]["standings"][0]["primary_faction"]
    
    available_seasons_catalog.append({
        "season_number": s_num,
        "name": f"Season {s_num} (Fall 2026)" if s_num == 38 else (f"Season {s_num} (Spring 2026)" if s_num == 37 else f"Season {s_num}"),
        "status": "active" if s_num == 38 else "completed",
        "total_players": s_data["total_players"],
        "total_pods": len(sorted_pod_keys),
        "pod_champion": champ,
        "pod_champion_faction": champ_faction
    })

# Form formatted historical seasons dict
formatted_historical = {}
for s_num, s_data in seasons_dict.items():
    sorted_pod_keys = sorted(s_data["pods"].keys())
    formatted_historical[str(s_num)] = {
        "season_number": s_num,
        "name": f"Season {s_num} (Fall 2026)" if s_num == 38 else f"Season {s_num}",
        "status": "active" if s_num == 38 else "completed",
        "total_players": s_data["total_players"],
        "total_pods": len(sorted_pod_keys),
        "pods": [s_data["pods"][k] for k in sorted_pod_keys]
    }

existing_league["available_seasons"] = available_seasons_catalog

# Save outputs
with open(DATA_DIR / "sd40k_league_data.json", "w", encoding="utf-8") as f:
    json.dump(existing_league, f, indent=2)

with open(DATA_DIR / "sd40k_historical_seasons.json", "w", encoding="utf-8") as f:
    json.dump(formatted_historical, f, indent=2)

with open(DATA_DIR / "sd40k_player_careers.json", "w", encoding="utf-8") as f:
    json.dump(formatted_careers, f, indent=2)

# Update native_leagues_db.json
index_path = DATA_DIR / "native_leagues_db.json"
if index_path.exists():
    with open(index_path, "r", encoding="utf-8") as f:
        idx_data = json.load(f)
    for lg in idx_data.get("leagues", []):
        if lg.get("slug") == "sd40k" or lg.get("league_id") == "lg_sd40k":
            lg["active_players"] = existing_league["active_season"]["total_players"]
            lg["pods_count"] = existing_league["active_season"]["total_pods"]
            lg["seasons_count"] = len(available_seasons_catalog)
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(idx_data, f, indent=2)

print(f"SUCCESS: Built SD40K dataset with {len(available_seasons_catalog)} seasons, {len(formatted_careers)} players, and Pod 8 (Scrub Tub) with John Hsieh!")
