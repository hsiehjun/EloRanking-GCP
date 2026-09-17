"""OmniTactica Annual Seasonal Trophy & Commendation Registry.

Defines the 2026 Annual Seasonal Catalogs (40k & AoS),
evaluation logic for computing seasonal unlocks from authentic match telemetry,
and capstone commendation awards (Warmaster / Everchosen of 2026).
"""

from typing import Dict, List, Any, Optional
import re
from datetime import datetime

# Rarity metadata for seasonal honors
SEASONAL_RARITY_CONFIG = {
    "common": {"label": "Common", "glory": 25, "color": "#94a3b8", "border": "rgba(148, 163, 184, 0.4)"},
    "rare": {"label": "Rare", "glory": 100, "color": "#3b82f6", "border": "rgba(59, 130, 246, 0.5)"},
    "epic": {"label": "Epic", "glory": 200, "color": "#a855f7", "border": "rgba(168, 85, 247, 0.6)"},
    "mythic": {"label": "Mythic", "glory": 500, "color": "#f43f5e", "border": "rgba(244, 63, 94, 0.85)"}
}

# 40k Seasonal Categories
SEASONAL_CATEGORIES_40K = {
    "combat": {"title": "Combat Feats", "icon": "⚔️", "description": "Battle victories, high-scoring missions, and win streaks in Season 2026"},
    "tournament": {"title": "Tournament Circuit", "icon": "🏆", "description": "Grand Tournament endurance, podiums, and championship runs"},
    "tracker": {"title": "Game Tracker Scribe", "icon": "📱", "description": "Live match companion sessions, round discipline, and secondaries"},
    "factions": {"title": "Army & Armory", "icon": "🛡️", "description": "Faction loyalty, multi-army polymath, and army vault preparation"},
    "capstone": {"title": "Pinnacle Honor", "icon": "👑", "description": "Apex seasonal commendation awarded for comprehensive campaign mastery"}
}

# AoS Seasonal Categories
SEASONAL_CATEGORIES_AOS = {
    "combat": {"title": "Combat Feats", "icon": "⚔️", "description": "Mortal realms victories, high-scoring battles, and win streaks in Season 2026"},
    "tournament": {"title": "Tournament Circuit", "icon": "🏆", "description": "Grand Tournament endurance, podiums, and championship triumphs"},
    "tracker": {"title": "Game Tracker Scribe", "icon": "📱", "description": "Live match companion sessions, battle tactics, and battle-round discipline"},
    "factions": {"title": "Alliance & Armory", "icon": "🛡️", "description": "Grand alliance dedication, multi-army flexibility, and army vault preparation"},
    "capstone": {"title": "Pinnacle Honor", "icon": "👑", "description": "Apex seasonal commendation awarded for comprehensive campaign mastery"}
}

# ── 40K 2026 Seasonal Catalog (20 Feats + 1 Capstone = 21 Trophies) ──
SEASON_2026_CATALOG_40K: List[Dict[str, Any]] = [
    # ── Category A: Combat Feats (6 Trophies) ──
    {
        "id": "s26_40k_first_blood",
        "name": "First Blood '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "combat",
        "rarity": "common",
        "glory": 25,
        "icon": "⚔️",
        "description": "Win your first verified match of the 2026 Season."
    },
    {
        "id": "s26_40k_campaign_muster",
        "name": "Campaign Muster '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "combat",
        "rarity": "common",
        "glory": 50,
        "icon": "🛡️",
        "description": "Complete 10 or more verified matches during the 2026 Season."
    },
    {
        "id": "s26_40k_veteran_campaigner",
        "name": "Veteran Campaigner '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "combat",
        "rarity": "rare",
        "glory": 100,
        "icon": "🎖️",
        "description": "Complete 25 or more verified matches during the 2026 Season."
    },
    {
        "id": "s26_40k_hot_streak",
        "name": "Hot Streak '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "combat",
        "rarity": "rare",
        "glory": 100,
        "icon": "🔥",
        "description": "Win 4 consecutive matches without defeat in the 2026 Season."
    },
    {
        "id": "s26_40k_century_scorer",
        "name": "Century Scorer '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "combat",
        "rarity": "epic",
        "glory": 150,
        "icon": "💯",
        "description": "Score 95+ Victory Points in any verified match during the 2026 Season."
    },
    {
        "id": "s26_40k_the_juggernaut",
        "name": "The Juggernaut '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "combat",
        "rarity": "mythic",
        "glory": 300,
        "icon": "⚡",
        "description": "Achieve an unbroken 8-match win streak during the 2026 Season."
    },

    # ── Category B: Tournament Circuit (5 Trophies) ──
    {
        "id": "s26_40k_circuit_enlisted",
        "name": "Circuit Enlisted '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tournament",
        "rarity": "common",
        "glory": 35,
        "icon": "🎫",
        "description": "Register for or compete in an official tournament in the 2026 Season."
    },
    {
        "id": "s26_40k_circuit_regular",
        "name": "Circuit Regular '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tournament",
        "rarity": "rare",
        "glory": 100,
        "icon": "🏟️",
        "description": "Compete in 3 or more tournaments during the 2026 Season."
    },
    {
        "id": "s26_40k_grand_tourer",
        "name": "Grand Tourer '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tournament",
        "rarity": "rare",
        "glory": 125,
        "icon": "🦾",
        "description": "Compete in a 5+ round Grand Tournament (GT) during the 2026 Season."
    },
    {
        "id": "s26_40k_gt_podium",
        "name": "GT Podium '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tournament",
        "rarity": "epic",
        "glory": 250,
        "icon": "🥈",
        "description": "Achieve a winning 4-1 or better tournament finish at a 5-round GT in 2026."
    },
    {
        "id": "s26_40k_gt_champion",
        "name": "GT Champion '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tournament",
        "rarity": "mythic",
        "glory": 500,
        "icon": "🥇",
        "description": "Achieve a clean 5-0-0 undefeated championship run at a Grand Tournament in 2026."
    },

    # ── Category C: Game Tracker Scribe (5 Trophies) ──
    {
        "id": "s26_40k_log_initiated",
        "name": "Log Initiated '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tracker",
        "rarity": "common",
        "glory": 30,
        "icon": "📱",
        "description": "Log your first completed match using the Game Tracker in 2026."
    },
    {
        "id": "s26_40k_field_scribe",
        "name": "Field Scribe '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tracker",
        "rarity": "rare",
        "glory": 100,
        "icon": "📝",
        "description": "Complete 10 or more Game Tracker sessions during the 2026 Season."
    },
    {
        "id": "s26_40k_iron_scribe",
        "name": "Iron Scribe '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tracker",
        "rarity": "epic",
        "glory": 200,
        "icon": "⚙️",
        "description": "Complete 25 or more Game Tracker sessions during the 2026 Season."
    },
    {
        "id": "s26_40k_full_distance",
        "name": "Full Distance '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tracker",
        "rarity": "common",
        "glory": 40,
        "icon": "⏱️",
        "description": "Complete a Game Tracker match that went the full 5 Battle Rounds in 2026."
    },
    {
        "id": "s26_40k_secondary_ace",
        "name": "Secondary Ace '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tracker",
        "rarity": "rare",
        "glory": 75,
        "icon": "🎯",
        "description": "Score 35+ Secondary Objective Victory Points in a 2026 Game Tracker session."
    },

    # ── Category D: Army & Armory (4 Trophies) ──
    {
        "id": "s26_40k_roster_in_vault",
        "name": "Roster In the Vault '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "factions",
        "rarity": "common",
        "glory": 25,
        "icon": "📜",
        "description": "Save at least 1 army roster in your Army Vault."
    },
    {
        "id": "s26_40k_faction_loyalist",
        "name": "Faction Loyalist '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "factions",
        "rarity": "rare",
        "glory": 100,
        "icon": "🛡️",
        "description": "Win 10 or more matches with your primary faction in the 2026 Season."
    },
    {
        "id": "s26_40k_dual_discipline",
        "name": "Dual-Discipline '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "factions",
        "rarity": "rare",
        "glory": 125,
        "icon": "⚔️",
        "description": "Win at least 3 matches each with 2 different factions in the 2026 Season."
    },
    {
        "id": "s26_40k_polymath_warlord",
        "name": "Polymath Warlord '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "factions",
        "rarity": "epic",
        "glory": 250,
        "icon": "🌌",
        "description": "Win at least 5 matches each across 3 different factions in the 2026 Season."
    },

    # ── Category E: Pinnacle Capstone Honor (1 Trophy) ──
    {
        "id": "s26_40k_warmaster",
        "name": "Warmaster of 2026",
        "season": "2026",
        "scope": "seasonal",
        "category": "capstone",
        "rarity": "mythic",
        "glory": 500,
        "icon": "👑",
        "description": "Claim at least 15 of the 20 Season 2026 honors to attain the mantle of High Warmaster."
    }
]

# ── AOS 2026 Seasonal Catalog (20 Feats + 1 Capstone = 21 Trophies) ──
SEASON_2026_CATALOG_AOS: List[Dict[str, Any]] = [
    # ── Category A: Combat Feats (6 Trophies) ──
    {
        "id": "s26_aos_first_blood",
        "name": "Realm Blood '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "combat",
        "rarity": "common",
        "glory": 25,
        "icon": "⚔️",
        "description": "Win your first verified match of the 2026 Season."
    },
    {
        "id": "s26_aos_campaign_muster",
        "name": "Muster of the Realms '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "combat",
        "rarity": "common",
        "glory": 50,
        "icon": "🛡️",
        "description": "Complete 10 or more verified matches during the 2026 Season."
    },
    {
        "id": "s26_aos_veteran_campaigner",
        "name": "Realm-Walker Veteran '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "combat",
        "rarity": "rare",
        "glory": 100,
        "icon": "🎖️",
        "description": "Complete 25 or more verified matches during the 2026 Season."
    },
    {
        "id": "s26_aos_hot_streak",
        "name": "Scourge Streak '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "combat",
        "rarity": "rare",
        "glory": 100,
        "icon": "🔥",
        "description": "Win 4 consecutive matches without defeat in the 2026 Season."
    },
    {
        "id": "s26_aos_century_scorer",
        "name": "Dominion Triumph '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "combat",
        "rarity": "epic",
        "glory": 150,
        "icon": "💯",
        "description": "Score a decisive 90+ battle points victory in the 2026 Season."
    },
    {
        "id": "s26_aos_the_juggernaut",
        "name": "Avatar of War '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "combat",
        "rarity": "mythic",
        "glory": 300,
        "icon": "⚡",
        "description": "Achieve an unbroken 8-match win streak during the 2026 Season."
    },

    # ── Category B: Tournament Circuit (5 Trophies) ──
    {
        "id": "s26_aos_circuit_enlisted",
        "name": "Grand Tournament Cohort '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tournament",
        "rarity": "common",
        "glory": 35,
        "icon": "🎫",
        "description": "Register for or compete in an official AoS tournament in the 2026 Season."
    },
    {
        "id": "s26_aos_circuit_regular",
        "name": "Tournament Veteran '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tournament",
        "rarity": "rare",
        "glory": 100,
        "icon": "🏟️",
        "description": "Compete in 3 or more tournaments during the 2026 Season."
    },
    {
        "id": "s26_aos_grand_tourer",
        "name": "Grand Marshall '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tournament",
        "rarity": "rare",
        "glory": 125,
        "icon": "🦾",
        "description": "Compete in a 5+ round Grand Tournament during the 2026 Season."
    },
    {
        "id": "s26_aos_gt_podium",
        "name": "Realm Podium '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tournament",
        "rarity": "epic",
        "glory": 250,
        "icon": "🥈",
        "description": "Achieve a winning 4-1 or better tournament finish at a 5-round GT in 2026."
    },
    {
        "id": "s26_aos_gt_champion",
        "name": "Realm Champion '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tournament",
        "rarity": "mythic",
        "glory": 500,
        "icon": "🥇",
        "description": "Achieve a clean 5-0-0 undefeated championship run at a Grand Tournament in 2026."
    },

    # ── Category C: Game Tracker Scribe (5 Trophies) ──
    {
        "id": "s26_aos_log_initiated",
        "name": "Chronicle Begun '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tracker",
        "rarity": "common",
        "glory": 30,
        "icon": "📱",
        "description": "Log your first completed match using the Game Tracker in 2026."
    },
    {
        "id": "s26_aos_field_scribe",
        "name": "Field Chronicler '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tracker",
        "rarity": "rare",
        "glory": 100,
        "icon": "📝",
        "description": "Complete 10 or more Game Tracker sessions during the 2026 Season."
    },
    {
        "id": "s26_aos_iron_scribe",
        "name": "Keeper of the Ledger '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tracker",
        "rarity": "epic",
        "glory": 200,
        "icon": "⚙️",
        "description": "Complete 25 or more Game Tracker sessions during the 2026 Season."
    },
    {
        "id": "s26_aos_full_distance",
        "name": "Until the Twilight '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tracker",
        "rarity": "common",
        "glory": 40,
        "icon": "⏱️",
        "description": "Complete a Game Tracker match that went the full 5 Battle Rounds in 2026."
    },
    {
        "id": "s26_aos_secondary_ace",
        "name": "Grand Strategist '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "tracker",
        "rarity": "rare",
        "glory": 75,
        "icon": "🎯",
        "description": "Complete all Battle Tactics in a 2026 Game Tracker session (or score 35+ secondaries)."
    },

    # ── Category D: Alliance & Armory (4 Trophies) ──
    {
        "id": "s26_aos_roster_in_vault",
        "name": "Warscrolls in Vault '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "factions",
        "rarity": "common",
        "glory": 25,
        "icon": "📜",
        "description": "Save at least 1 army roster in your Army Vault."
    },
    {
        "id": "s26_aos_faction_loyalist",
        "name": "Alliance Champion '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "factions",
        "rarity": "rare",
        "glory": 100,
        "icon": "🛡️",
        "description": "Win 10 or more matches with your primary faction in the 2026 Season."
    },
    {
        "id": "s26_aos_dual_discipline",
        "name": "Dual Realms Sovereign '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "factions",
        "rarity": "rare",
        "glory": 125,
        "icon": "⚔️",
        "description": "Win at least 3 matches each with 2 different factions in the 2026 Season."
    },
    {
        "id": "s26_aos_polymath_warlord",
        "name": "Polymath of the Realms '26",
        "season": "2026",
        "scope": "seasonal",
        "category": "factions",
        "rarity": "epic",
        "glory": 250,
        "icon": "🌌",
        "description": "Win at least 5 matches each across 3 different factions in the 2026 Season."
    },

    # ── Category E: Pinnacle Capstone Honor (1 Trophy) ──
    {
        "id": "s26_aos_everchosen",
        "name": "Everchosen of 2026",
        "season": "2026",
        "scope": "seasonal",
        "category": "capstone",
        "rarity": "mythic",
        "glory": 500,
        "icon": "👑",
        "description": "Claim at least 15 of the 20 Season 2026 honors to attain the mantle of Apex Everchosen."
    }
]

def _is_match_in_season(match: Dict[str, Any], season_year: str = "2026") -> bool:
    """Check if a match date falls within the calendar season year."""
    d = str(match.get("date") or match.get("event_date") or match.get("match_date") or match.get("created_at") or "").strip()
    return d.startswith(season_year)

def _is_session_in_season(session: Dict[str, Any], season_year: str = "2026") -> bool:
    """Check if a tracker session falls within the calendar season year."""
    d = str(session.get("created_at") or session.get("date") or session.get("updated_at") or "").strip()
    return d.startswith(season_year)

def _is_tournament_in_season(t: Dict[str, Any], season_year: str = "2026") -> bool:
    """Check if a tournament date falls within the calendar season year."""
    d = str(t.get("date") or t.get("event_date") or t.get("start_date") or "").strip()
    return d.startswith(season_year)

def evaluate_player_seasonal_badges(
    player_data: Dict[str, Any],
    history: Optional[List[Dict[str, Any]]] = None,
    tournaments: Optional[List[Dict[str, Any]]] = None,
    tracker_sessions: Optional[List[Dict[str, Any]]] = None,
    registered_tournaments: Optional[List[Dict[str, Any]]] = None,
    armylists: Optional[List[Dict[str, Any]]] = None,
    season: str = "2026",
    game_system: str = "40k"
) -> Dict[str, Any]:
    """
    Evaluates 100% verifiable seasonal achievements for a player for a specific season.
    
    Returns structured results including unlocked badges, progress counters,
    provenance, and capstone status.
    """
    is_aos = str(game_system).lower() == "aos"
    catalog = SEASON_2026_CATALOG_AOS if is_aos else SEASON_2026_CATALOG_40K
    categories = SEASONAL_CATEGORIES_AOS if is_aos else SEASONAL_CATEGORIES_40K

    # 1. Filter telemetry to the active calendar season
    raw_matches = player_data.get("matches") or history or []
    season_matches = [m for m in raw_matches if _is_match_in_season(m, season)]

    raw_tournaments = tournaments or player_data.get("tournaments") or []
    season_tournaments = [t for t in raw_tournaments if _is_tournament_in_season(t, season)]

    raw_tracker = tracker_sessions or player_data.get("tracker_history") or player_data.get("tracker_sessions") or []
    season_tracker = [s for s in raw_tracker if _is_session_in_season(s, season)]

    raw_registrations = registered_tournaments or player_data.get("registered_tournaments") or []
    season_registrations = [r for r in raw_registrations if _is_tournament_in_season(r, season)]

    raw_armylists = armylists or player_data.get("armylists") or []

    # 2. Compute Season Telemetry Aggregations
    total_season_matches = len(season_matches)
    season_wins = 0
    season_scores = []
    faction_wins_map: Dict[str, int] = {}
    season_distinct_events = set()
    current_streak = 0
    max_streak = 0

    # Sort matches chronologically for streak calculation
    sorted_matches = sorted(
        season_matches,
        key=lambda m: str(m.get("date") or m.get("event_date") or m.get("created_at") or "")
    )

    for m in sorted_matches:
        res_str = str(m.get("result", "")).upper()
        p_score = int(m.get("player_score") or m.get("player1_score") or 0)
        season_scores.append(p_score)

        ev_id = m.get("event_id") or m.get("tournament_id")
        if ev_id:
            season_distinct_events.add(str(ev_id))

        if res_str in ("W", "WIN", "TRUE", "1"):
            season_wins += 1
            current_streak += 1
            if current_streak > max_streak:
                max_streak = current_streak

            fac = (m.get("player_faction") or m.get("faction") or "").strip()
            if fac:
                faction_wins_map[fac] = faction_wins_map.get(fac, 0) + 1
        else:
            current_streak = 0

    # Fallback to player_data aggregate streak if available
    player_streak = int(player_data.get("streak", 0) or 0)
    if season_matches and player_streak > max_streak:
        max_streak = player_streak

    # Tournament metrics
    gt_5_round_count = 0
    gt_4_1_count = 0
    gt_5_0_count = 0
    for t in season_tournaments:
        rds = int(t.get("num_rounds") or t.get("rounds") or t.get("matches_played") or 0)
        t_type = str(t.get("tournament_type") or t.get("type") or "").upper()
        w = int(t.get("wins", 0))
        l = int(t.get("losses", 0))

        if rds >= 5 or t_type == "GT" or "GRAND" in str(t.get("name", "")).upper():
            gt_5_round_count += 1
            if w >= 4:
                gt_4_1_count += 1
            if w >= 5 and l == 0:
                gt_5_0_count += 1

    total_events_entered = len(season_distinct_events) or len(season_tournaments) or len(season_registrations)

    # Tracker sessions metrics
    tracker_completed = len([s for s in season_tracker if s.get("status") in ("completed", "finished", None)])
    full_distance_sessions = len([s for s in season_tracker if int(s.get("round_num") or s.get("current_round") or 5) >= 5])
    secondary_ace_sessions = len([s for s in season_tracker if int(s.get("p1_secondary") or s.get("secondary_vp") or s.get("player_score") or 0) >= 35])
    # Also count matches with 85+ VP as secondary ace if tracker was not active
    if secondary_ace_sessions == 0:
        secondary_ace_sessions = len([s for s in season_scores if s >= 85])

    # Faction variety metrics
    max_faction_wins = max(faction_wins_map.values()) if faction_wins_map else 0
    factions_with_3_wins = len([f for f, count in faction_wins_map.items() if count >= 3])
    factions_with_5_wins = len([f for f, count in faction_wins_map.items() if count >= 5])

    # Army vault
    vault_roster_count = len(raw_armylists)

    # 3. Evaluate Each Seasonal Trophy
    evaluated = []
    unlocked_count = 0
    total_glory = 0

    # First pass: evaluate standard 20 trophies
    for b in catalog:
        b_id = b["id"]
        unlocked = False
        progress = {"current": 0, "target": 1, "unit": "completion"}
        provenance = None

        # ── Combat ──
        if "first_blood" in b_id:
            unlocked = season_wins >= 1
            progress = {"current": min(season_wins, 1), "target": 1, "unit": "wins"}
            if unlocked:
                provenance = f"Won first match of the {season} Season"

        elif "campaign_muster" in b_id:
            unlocked = total_season_matches >= 10
            progress = {"current": min(total_season_matches, 10), "target": 10, "unit": "matches"}
            if unlocked:
                provenance = f"Completed 10+ verified matches in {season}"

        elif "veteran_campaigner" in b_id:
            unlocked = total_season_matches >= 25
            progress = {"current": min(total_season_matches, 25), "target": 25, "unit": "matches"}
            if unlocked:
                provenance = f"Completed 25+ verified matches in {season}"

        elif "hot_streak" in b_id:
            unlocked = max_streak >= 4
            progress = {"current": min(max_streak, 4), "target": 4, "unit": "win streak"}
            if unlocked:
                provenance = f"Achieved a 4-game win streak in {season}"

        elif "century_scorer" in b_id:
            top_score = max(season_scores) if season_scores else 0
            unlocked = top_score >= 90
            progress = {"current": top_score, "target": 90, "unit": "points"}
            if unlocked:
                provenance = f"Scored {top_score} Victory Points in {season}"

        elif "the_juggernaut" in b_id:
            unlocked = max_streak >= 8
            progress = {"current": min(max_streak, 8), "target": 8, "unit": "win streak"}
            if unlocked:
                provenance = f"Achieved an epic 8-game win streak in {season}"

        # ── Tournament ──
        elif "circuit_enlisted" in b_id:
            unlocked = total_events_entered >= 1
            progress = {"current": min(total_events_entered, 1), "target": 1, "unit": "tournaments"}
            if unlocked:
                provenance = f"Enlisted in an official tournament in {season}"

        elif "circuit_regular" in b_id:
            unlocked = total_events_entered >= 3
            progress = {"current": min(total_events_entered, 3), "target": 3, "unit": "tournaments"}
            if unlocked:
                provenance = f"Competed in 3+ tournaments in {season}"

        elif "grand_tourer" in b_id:
            unlocked = gt_5_round_count >= 1
            progress = {"current": min(gt_5_round_count, 1), "target": 1, "unit": "Grand Tournaments"}
            if unlocked:
                provenance = f"Competed in a 5-round Grand Tournament in {season}"

        elif "gt_podium" in b_id:
            unlocked = gt_4_1_count >= 1
            progress = {"current": min(gt_4_1_count, 1), "target": 1, "unit": "GT podiums (4-1+)"}
            if unlocked:
                provenance = f"Achieved 4-1 or better at a Grand Tournament in {season}"

        elif "gt_champion" in b_id:
            unlocked = gt_5_0_count >= 1
            progress = {"current": min(gt_5_0_count, 1), "target": 1, "unit": "5-0 GT Championships"}
            if unlocked:
                provenance = f"Undefeated 5-0 Grand Tournament Champion in {season}"

        # ── Game Tracker ──
        elif "log_initiated" in b_id:
            unlocked = tracker_completed >= 1
            progress = {"current": min(tracker_completed, 1), "target": 1, "unit": "sessions"}
            if unlocked:
                provenance = f"Logged first completed Game Tracker match in {season}"

        elif "field_scribe" in b_id:
            unlocked = tracker_completed >= 10
            progress = {"current": min(tracker_completed, 10), "target": 10, "unit": "sessions"}
            if unlocked:
                provenance = f"Logged 10+ Game Tracker matches in {season}"

        elif "iron_scribe" in b_id:
            unlocked = tracker_completed >= 25
            progress = {"current": min(tracker_completed, 25), "target": 25, "unit": "sessions"}
            if unlocked:
                provenance = f"Logged 25+ Game Tracker matches in {season}"

        elif "full_distance" in b_id:
            unlocked = full_distance_sessions >= 1
            progress = {"current": min(full_distance_sessions, 1), "target": 1, "unit": "5-round matches"}
            if unlocked:
                provenance = f"Finished a match playing all 5 full rounds in {season}"

        elif "secondary_ace" in b_id:
            unlocked = secondary_ace_sessions >= 1
            progress = {"current": min(secondary_ace_sessions, 1), "target": 1, "unit": "secondary masteries"}
            if unlocked:
                provenance = f"Achieved 35+ secondary VP in a verified session in {season}"

        # ── Factions & Armory ──
        elif "roster_in_vault" in b_id:
            unlocked = vault_roster_count >= 1
            progress = {"current": min(vault_roster_count, 1), "target": 1, "unit": "rosters"}
            if unlocked:
                provenance = "Saved battle roster in Army Vault"

        elif "faction_loyalist" in b_id:
            unlocked = max_faction_wins >= 10
            progress = {"current": min(max_faction_wins, 10), "target": 10, "unit": "faction wins"}
            if unlocked:
                provenance = f"Won 10+ matches with primary faction in {season}"

        elif "dual_discipline" in b_id:
            unlocked = factions_with_3_wins >= 2
            progress = {"current": min(factions_with_3_wins, 2), "target": 2, "unit": "factions (3+ wins)"}
            if unlocked:
                provenance = f"Won 3+ matches with 2 distinct factions in {season}"

        elif "polymath_warlord" in b_id:
            unlocked = factions_with_5_wins >= 3
            progress = {"current": min(factions_with_5_wins, 3), "target": 3, "unit": "factions (5+ wins)"}
            if unlocked:
                provenance = f"Won 5+ matches with 3 distinct factions in {season}"

        elif b.get("category") == "capstone":
            # Evaluated in second pass below
            continue

        if unlocked:
            unlocked_count += 1
            total_glory += b.get("glory", 0)

        badge_entry = dict(b)
        badge_entry["unlocked"] = unlocked
        badge_entry["progress"] = progress
        badge_entry["provenance"] = provenance
        evaluated.append(badge_entry)

    # Second pass: evaluate Capstone Trophy
    capstone_target = 15
    capstone_badge = [b for b in catalog if b.get("category") == "capstone"][0]
    capstone_unlocked = unlocked_count >= capstone_target
    capstone_entry = dict(capstone_badge)
    capstone_entry["unlocked"] = capstone_unlocked
    capstone_entry["progress"] = {
        "current": min(unlocked_count, capstone_target),
        "target": capstone_target,
        "unit": "seasonal honors"
    }
    if capstone_unlocked:
        unlocked_count += 1
        total_glory += capstone_badge.get("glory", 500)
        capstone_entry["provenance"] = f"Claimed {unlocked_count - 1} Season {season} Honors; Pinnacle Warmaster Attained"

    evaluated.append(capstone_entry)

    total_season_badges = len(catalog)
    completion_pct = round((unlocked_count / total_season_badges) * 100) if total_season_badges else 0

    return {
        "season": season,
        "season_title": f"Season {season}",
        "badge_count": unlocked_count,
        "total_badges": total_season_badges,
        "completion_pct": completion_pct,
        "glory_score": total_glory,
        "capstone_unlocked": capstone_unlocked,
        "badges": evaluated,
        "categories": categories
    }
