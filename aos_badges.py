"""OmniTactica Warhammer Age of Sigmar (AoS) Badge and Trophy System Registry.

Defines the 105 master AoS badges across 5 competitive disciplines,
the 7-tier military progression ladder (Initiate -> Champion of the Gods),
and evaluation logic for computing player unlocks from match history.
100% grounded in authentic tournament match telemetry (BCP scorecards,
round records, Elo movements, and Grand Alliance matchups).
Calibrated strictly to AoS 50-VP max scoring (GHB format).
"""

from typing import Dict, List, Any, Optional
import re

def _safe_round(val: Any, default: int = 0) -> int:
    """Extract round number cleanly from integer, float, or strings like 'R1', 'Round 2'."""
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return int(val)
    val_str = str(val).strip()
    match = re.search(r'\d+', val_str)
    if match:
        try:
            return int(match.group(0))
        except (ValueError, TypeError):
            return default
    return default

def _safe_int(val: Any, default: int = 0) -> int:
    """Safely parse integer from mixed types without ValueError."""
    if val is None:
        return default
    if isinstance(val, int):
        return val
    try:
        return int(float(str(val).strip()))
    except (ValueError, TypeError):
        return default

def _safe_float(val: Any, default: float = 0.0) -> float:
    """Safely parse float from mixed types without ValueError."""
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    try:
        return float(str(val).strip())
    except (ValueError, TypeError):
        return default


# Rarity metadata and glory scores
RARITY_CONFIG = {
    "common": {"label": "Common", "glory": 10, "color": "#94a3b8", "border": "rgba(148, 163, 184, 0.4)"},
    "uncommon": {"label": "Uncommon", "glory": 25, "color": "#10b981", "border": "rgba(16, 185, 129, 0.4)"},
    "rare": {"label": "Rare", "glory": 50, "color": "#3b82f6", "border": "rgba(59, 130, 246, 0.5)"},
    "epic": {"label": "Epic", "glory": 100, "color": "#a855f7", "border": "rgba(168, 85, 247, 0.6)"},
    "legendary": {"label": "Legendary", "glory": 250, "color": "#f59e0b", "border": "rgba(245, 158, 11, 0.7)"},
    "mythic": {"label": "Mythic", "glory": 500, "color": "#f43f5e", "border": "rgba(244, 63, 94, 0.85)"}
}

# 7-Rank Military Progression Ladder for AoS
RANKS_AOS = [
    {
        "rank": 1,
        "title": "Initiate",
        "min_badges": 0,
        "max_badges": 2,
        "css_class": "rank-border-initiate",
        "badge_bg": "rgba(255, 255, 255, 0.08)",
        "badge_color": "#94a3b8",
        "icon": "🛡️",
        "description": "Aspirant in standard field armor; unproven in realm war."
    },
    {
        "rank": 2,
        "title": "Liberator",
        "min_badges": 3,
        "max_badges": 9,
        "css_class": "rank-border-veteran",
        "badge_bg": "rgba(100, 116, 139, 0.2)",
        "badge_color": "#cbd5e1",
        "icon": "⚔️",
        "description": "Frontline combatant; has struck their first blows in competitive realm play."
    },
    {
        "rank": 3,
        "title": "Knight-Questor",
        "min_badges": 10,
        "max_badges": 24,
        "css_class": "rank-border-centurion",
        "badge_bg": "rgba(217, 119, 6, 0.2)",
        "badge_color": "#f59e0b",
        "icon": "🎖️",
        "description": "Seasoned champion adorned with burnished bronze heraldry."
    },
    {
        "rank": 4,
        "title": "Lord-Celestant",
        "min_badges": 25,
        "max_badges": 44,
        "css_class": "rank-border-commander",
        "badge_bg": "rgba(59, 130, 246, 0.2)",
        "badge_color": "#60a5fa",
        "icon": "⭐",
        "description": "Respected general commanding theater-level war with cobalt realm-steel."
    },
    {
        "rank": 5,
        "title": "Lord-Commander",
        "min_badges": 45,
        "max_badges": 69,
        "css_class": "rank-border-general",
        "badge_bg": "rgba(245, 158, 11, 0.2)",
        "badge_color": "#fbbf24",
        "icon": "👑",
        "description": "Regional realm powerhouse with tactical mastery; regal gold regalia."
    },
    {
        "rank": 6,
        "title": "Warmaster of the Realms",
        "min_badges": 70,
        "max_badges": 89,
        "css_class": "rank-border-warmaster",
        "badge_bg": "rgba(245, 158, 11, 0.3)",
        "badge_color": "#f59e0b",
        "icon": "🔥",
        "description": "National elite competitor radiating an incandescent amber halo glow."
    },
    {
        "rank": 7,
        "title": "Champion of the Gods",
        "min_badges": 90,
        "max_badges": 9999,
        "css_class": "rank-border-everchosen",
        "badge_bg": "rgba(225, 29, 72, 0.25)",
        "badge_color": "#f43f5e",
        "icon": "⚡",
        "description": "Mythic living legend; apex master of the Mortal Realms."
    }
]

# AoS Disciplines / Categories
CATEGORIES_AOS = {
    "tournament": {"title": "Realm Tournaments", "icon": "🏆", "description": "Grand tournament placings, realm conquest, and multi-round endurance"},
    "battlefield": {"title": "Mortal Realm Feats", "icon": "🎯", "description": "50-VP scoring milestones, battle tactics execution, and defensive lockouts"},
    "factions": {"title": "Grand Alliances & Battletomes", "icon": "🛡️", "description": "Order, Chaos, Death, and Destruction mastery and anti-meta triumphs"},
    "ladder": {"title": "Realm Ladder & Elo Milestones", "icon": "📈", "description": "Competitive rating peaks, winning streaks, and leaderboard rank"},
    "career": {"title": "The Chronicler's Ledger & Secrets", "icon": "📜", "description": "Club pride, realm travels, ancient grudges, and classified secrets"}
}

# The 105 Master Age of Sigmar Badges
BADGE_CATALOG_AOS: List[Dict[str, Any]] = [
    # ── Category A: Realm Tournaments (25 Badges) ──
    {"id": "aos_first_blood", "name": "First Blood", "category": "tournament", "rarity": "common", "icon": "⚔️", "description": "Win your first recorded official AoS tournament match."},
    {"id": "aos_the_debutant", "name": "Realm Walker", "category": "tournament", "rarity": "common", "icon": "🎫", "description": "Complete your first 3+ round AoS tournament event."},
    {"id": "aos_weekend_warrior", "name": "Realmgate Wanderer", "category": "tournament", "rarity": "common", "icon": "🛡️", "description": "Complete 3 AoS Grand Tournaments (or 3+ round events)."},
    {"id": "aos_campaign_veteran", "name": "Veteran of the Realms", "category": "tournament", "rarity": "uncommon", "icon": "🎖️", "description": "Complete 10 AoS Grand Tournaments (or 3+ round events)."},
    {"id": "aos_iron_man_1", "name": "Starmetal Endurance I", "category": "tournament", "rarity": "uncommon", "icon": "🔩", "description": "Complete a 5-round AoS Grand Tournament without dropping."},
    {"id": "aos_iron_man_2", "name": "Starmetal Endurance II", "category": "tournament", "rarity": "rare", "icon": "🦾", "description": "Complete 5 AoS Grand Tournaments without dropping."},
    {"id": "aos_iron_man_3", "name": "Starmetal Endurance III", "category": "tournament", "rarity": "epic", "icon": "⚙️", "description": "Complete 10 AoS Grand Tournaments without dropping."},
    {"id": "aos_positive_ledger", "name": "Triumphant Record", "category": "tournament", "rarity": "uncommon", "icon": "📊", "description": "Finish a 5-round AoS Grand Tournament with a winning record (3-2 or better)."},
    {"id": "aos_top_quarter", "name": "Top Quarter", "category": "tournament", "rarity": "uncommon", "icon": "🎯", "description": "Finish a 5-round AoS GT with a winning record (3-2+) and 175+ total battle points (35+ VP avg)."},
    {"id": "aos_podium_bronze", "name": "Realm Podium Bronze", "category": "tournament", "rarity": "rare", "icon": "🥉", "description": "Achieve a winning 4-1 tournament record at a 5-round AoS Grand Tournament."},
    {"id": "aos_podium_silver", "name": "Realm Podium Silver", "category": "tournament", "rarity": "rare", "icon": "🥈", "description": "Achieve 4-1 (or better) tournament records across 2 separate AoS Grand Tournaments."},
    {"id": "aos_grand_champion", "name": "Champion of the Mortal Realms", "category": "tournament", "rarity": "epic", "icon": "🥇", "description": "Achieve an undefeated 5-0-0 championship run at a 5-round AoS Grand Tournament."},
    {"id": "aos_the_undefeated", "name": "The Untamed Champion", "category": "tournament", "rarity": "epic", "icon": "👑", "description": "Complete a 5-round AoS Grand Tournament with a clean 5-0-0 record."},
    {"id": "aos_super_major_conqueror", "name": "Grand Tournament Overlord", "category": "tournament", "rarity": "legendary", "icon": "🌟", "description": "Win 8 consecutive tournament matches across major AoS tournament competition."},
    {"id": "aos_double_crown", "name": "The Dual Realm Crown", "category": "tournament", "rarity": "mythic", "icon": "💎", "description": "Win 10 consecutive tournament rounds across back-to-back AoS events."},
    {"id": "aos_triple_crown", "name": "Crown of the Pantheon", "category": "tournament", "rarity": "mythic", "icon": "🔱", "description": "Achieve 4-1 or 5-0 tournament finishes in 3 separate AoS Grand Tournaments."},
    {"id": "aos_giant_slayer_1", "name": "Giant Slayer I", "category": "tournament", "rarity": "uncommon", "icon": "🗡️", "description": "Defeat an opponent rated +100 Elo higher in official AoS tournament play."},
    {"id": "aos_giant_slayer_2", "name": "Giant Slayer II", "category": "tournament", "rarity": "rare", "icon": "⚔️", "description": "Defeat an opponent rated +175 Elo higher in official AoS tournament play."},
    {"id": "aos_giant_slayer_3", "name": "Giant Slayer III", "category": "tournament", "rarity": "epic", "icon": "⚡", "description": "Defeat an opponent rated +250 Elo higher in official AoS tournament play."},
    {"id": "aos_godsbane", "name": "The Godsbane", "category": "tournament", "rarity": "mythic", "icon": "👑", "description": "Defeat an elite competitor rated 2,000+ Elo in official AoS competition."},
    {"id": "aos_crucible_survivor_1", "name": "Realmgate Crucible I", "category": "tournament", "rarity": "rare", "icon": "🔥", "description": "Achieve a winning 3-2 record at an AoS tournament where your opponents averaged 1,700+ Elo."},
    {"id": "aos_crucible_survivor_2", "name": "Realmgate Crucible II", "category": "tournament", "rarity": "epic", "icon": "🌋", "description": "Achieve a 4-1+ record at an AoS tournament where your opponents averaged 1,775+ Elo."},
    {"id": "aos_apex_gauntlet", "name": "The God-King's Gauntlet", "category": "tournament", "rarity": "mythic", "icon": "🌌", "description": "Achieve a 4-1+ record at an AoS tournament where all opponents were rated 1,800+ Elo."},
    {"id": "aos_table_one_resident", "name": "High Seat of Sigmar", "category": "tournament", "rarity": "epic", "icon": "🔝", "description": "Enter Round 4 of an AoS Grand Tournament undefeated (3-0 start)."},
    {"id": "aos_clean_sweep", "name": "Clean Sweep", "category": "tournament", "rarity": "legendary", "icon": "🧹", "description": "Finish a 5-round AoS GT 5-0 while scoring 225+ total battle points (45+ VP average out of 50 max)."},

    # ── Category B: Mortal Realm Feats (25 Badges) ──
    {"id": "aos_realm_marksman", "name": "Realm Marksman", "category": "battlefield", "rarity": "common", "icon": "🎯", "description": "Score 35+ Victory Points in an official AoS tournament match."},
    {"id": "aos_grand_bombardier", "name": "Grand Bombardier", "category": "battlefield", "rarity": "uncommon", "icon": "💣", "description": "Score 42+ Victory Points in an official AoS tournament match."},
    {"id": "aos_grand_tacticus", "name": "Grand Tacticus", "category": "battlefield", "rarity": "rare", "icon": "🏅", "description": "Score 48+ Victory Points in an official AoS tournament match."},
    {"id": "aos_apex_ascension", "name": "Apex Ascension", "category": "battlefield", "rarity": "epic", "icon": "💯", "description": "Achieve a perfect 50/50 Victory Point score in an official AoS tournament match."},
    {"id": "aos_shyish_bastion_1", "name": "Bastion of Shyish I", "category": "battlefield", "rarity": "uncommon", "icon": "🛡️", "description": "Hold an opponent to 20 or fewer Victory Points in an official AoS match."},
    {"id": "aos_shyish_bastion_2", "name": "Bastion of Shyish II", "category": "battlefield", "rarity": "rare", "icon": "🏰", "description": "Hold an opponent to 14 or fewer Victory Points in an official AoS match."},
    {"id": "aos_star_metal_aegis", "name": "Starmetal Aegis", "category": "battlefield", "rarity": "epic", "icon": "🏔️", "description": "Hold an opponent to 8 or fewer Victory Points in an official AoS match."},
    {"id": "aos_realm_lockout", "name": "Realm Lockout", "category": "battlefield", "rarity": "legendary", "icon": "🔒", "description": "Total Realm Lockdown: Hold an opponent to 4 or fewer Victory Points."},
    {"id": "aos_clutch_by_a_hair", "name": "By a Thread", "category": "battlefield", "rarity": "rare", "icon": "⏱️", "description": "Win an official AoS tournament match by exactly 1 Victory Point."},
    {"id": "aos_photo_finish", "name": "The Deciding Tactic", "category": "battlefield", "rarity": "rare", "icon": "⚡", "description": "Win an official AoS tournament match by 2 or fewer Victory Points."},
    {"id": "aos_comeback_1", "name": "Resolute Rally I", "category": "battlefield", "rarity": "uncommon", "icon": "🔄", "description": "Win an official AoS match in a tight battle decided by 3 or fewer Victory Points."},
    {"id": "aos_comeback_2", "name": "Resolute Rally II", "category": "battlefield", "rarity": "rare", "icon": "🔥", "description": "Achieve 3 match victories decided by 3 or fewer Victory Points."},
    {"id": "aos_battle_tactic_master", "name": "Tactical Dominance", "category": "battlefield", "rarity": "epic", "icon": "📜", "description": "Achieve 10 recorded AoS match victories scoring 40+ Victory Points."},
    {"id": "aos_celestial_shield", "name": "Celestial Aegis", "category": "battlefield", "rarity": "legendary", "icon": "✨", "description": "Achieve 5 recorded victories holding opponents to 15 or fewer Victory Points."},
    {"id": "aos_grand_strategy_perfection", "name": "Grand Strategist", "category": "battlefield", "rarity": "uncommon", "icon": "🌟", "description": "Score 45+ Victory Points in 3 separate AoS tournament matches."},
    {"id": "aos_tactical_perfection", "name": "Master of Tactics", "category": "battlefield", "rarity": "rare", "icon": "👑", "description": "Score 45+ Victory Points in 10 separate AoS tournament matches."},
    {"id": "aos_primary_sovereign", "name": "High Objective Lord", "category": "battlefield", "rarity": "rare", "icon": "🚩", "description": "Win 15 tournament matches scoring 35+ Victory Points."},
    {"id": "aos_flawless_conquest", "name": "Flawless Conquest", "category": "battlefield", "rarity": "epic", "icon": "💎", "description": "Score 46+ Victory Points while holding opponent under 18 Victory Points."},
    {"id": "aos_realm_conquest", "name": "Overwhelming Onslaught", "category": "battlefield", "rarity": "rare", "icon": "⚡", "description": "Win an official AoS tournament match by 20+ Victory Points."},
    {"id": "aos_against_odds_1", "name": "Defying the Portents I", "category": "battlefield", "rarity": "uncommon", "icon": "🎲", "description": "Defeat an opponent with a 65%+ career win rate."},
    {"id": "aos_against_odds_2", "name": "Defying the Portents II", "category": "battlefield", "rarity": "rare", "icon": "🔮", "description": "Defeat an opponent with a 75%+ career win rate."},
    {"id": "aos_miracle_conquest", "name": "Triumph Against Destiny", "category": "battlefield", "rarity": "mythic", "icon": "🌠", "description": "Defeat an elite tournament leader rated 2,000+ Elo while facing a 100+ Elo deficit."},
    {"id": "aos_dead_heat", "name": "The Standoff", "category": "battlefield", "rarity": "uncommon", "icon": "⚖️", "description": "Record an official draw / tie in AoS tournament competition."},
    {"id": "aos_first_strike", "name": "Realm Shock", "category": "battlefield", "rarity": "common", "icon": "⚡", "description": "Score 40+ Victory Points in Round 1 of an AoS Grand Tournament."},
    {"id": "aos_clean_finish", "name": "Final Hour Triumph", "category": "battlefield", "rarity": "rare", "icon": "🏁", "description": "Win Round 5 of an AoS Grand Tournament holding opponent to 16 or fewer Victory Points."},

    # ── Category C: Grand Alliances & Battletomes (25 Badges) ──
    {"id": "aos_cadet_of_army", "name": "Warrior of the Host", "category": "factions", "rarity": "common", "icon": "🛡️", "description": "Win 3 official tournament matches with your primary battletome."},
    {"id": "aos_faction_veteran", "name": "Veteran of the Host", "category": "factions", "rarity": "uncommon", "icon": "🎖️", "description": "Win 10 official tournament matches with your primary battletome."},
    {"id": "aos_faction_champion", "name": "Champion of the Host", "category": "factions", "rarity": "rare", "icon": "⚔️", "description": "Win 25 official tournament matches with your primary battletome."},
    {"id": "aos_warmaster_faction", "name": "Battletome Warmaster", "category": "factions", "rarity": "epic", "icon": "👑", "description": "Win 50 official tournament matches with your primary battletome."},
    {"id": "aos_grand_sovereign", "name": "Sovereign of the Host", "category": "factions", "rarity": "mythic", "icon": "🔱", "description": "Win 100 official tournament matches with your primary battletome."},
    {"id": "aos_pure_specialist", "name": "Battletome Specialist", "category": "factions", "rarity": "rare", "icon": "🎯", "description": "Maintain an 80%+ win rate (min 15 matches) with a single battletome."},
    {"id": "aos_polymath_1", "name": "Polymath of the Realms I", "category": "factions", "rarity": "uncommon", "icon": "📚", "description": "Win official tournament matches with 2 distinct battletomes."},
    {"id": "aos_polymath_2", "name": "Polymath of the Realms II", "category": "factions", "rarity": "rare", "icon": "📖", "description": "Win official tournament matches with 3 distinct battletomes."},
    {"id": "aos_grand_polymath", "name": "Grand Polymath of War", "category": "factions", "rarity": "epic", "icon": "📜", "description": "Win official tournament matches with 5 distinct battletomes."},
    {"id": "aos_order_vanguard", "name": "Vanguard of Order", "category": "factions", "rarity": "rare", "icon": "⚖️", "description": "Win 5 tournament matches piloting Grand Alliance Order armies."},
    {"id": "aos_chaos_warlord", "name": "Chosen of Chaos", "category": "factions", "rarity": "rare", "icon": "💀", "description": "Win 5 tournament matches piloting Grand Alliance Chaos armies."},
    {"id": "aos_death_sovereign", "name": "Herald of Death", "category": "factions", "rarity": "rare", "icon": "⚰️", "description": "Win 5 tournament matches piloting Grand Alliance Death armies."},
    {"id": "aos_destruction_destroyer", "name": "Fist of Destruction", "category": "factions", "rarity": "rare", "icon": "💥", "description": "Win 5 tournament matches piloting Grand Alliance Destruction armies."},
    {"id": "aos_pantheon_master", "name": "Master of the Alliances", "category": "factions", "rarity": "epic", "icon": "🌌", "description": "Win tournament matches with factions across 3 different Grand Alliances."},
    {"id": "aos_grand_alliance_ascendant", "name": "Realm Ascendant", "category": "factions", "rarity": "mythic", "icon": "✨", "description": "Win tournament matches with factions across all 4 Grand Alliances (Order, Chaos, Death, Destruction)."},
    {"id": "aos_anti_meta_heretic_1", "name": "Realm Rogue I", "category": "factions", "rarity": "rare", "icon": "🗡️", "description": "Defeat a top-tier meta battletome (Stormcast Eternals, Slaves to Darkness, Soulblight Gravelords, Seraphon) in tournament play."},
    {"id": "aos_anti_meta_heretic_2", "name": "Realm Rogue II", "category": "factions", "rarity": "epic", "icon": "⚡", "description": "Defeat 5 top-tier meta battletomes in official tournament competition."},
    {"id": "aos_mirror_initiate", "name": "Mirror Match Initiate", "category": "factions", "rarity": "common", "icon": "🪞", "description": "Win your first mirror match against the exact same battletome."},
    {"id": "aos_mirror_maestro", "name": "Mirror Match Maestro", "category": "factions", "rarity": "rare", "icon": "🎭", "description": "Win 3 mirror matches against the exact same battletome."},
    {"id": "aos_mirror_sovereign", "name": "Mirror Sovereign", "category": "factions", "rarity": "epic", "icon": "✨", "description": "Win 6 mirror matches against the exact same battletome."},
    {"id": "aos_nemesis_neutralizer", "name": "Nemesis Neutralizer", "category": "factions", "rarity": "rare", "icon": "🛡️", "description": "Defeat 5 different enemy battletomes in official tournament play."},
    {"id": "aos_army_customizer", "name": "Warscroll Architect", "category": "factions", "rarity": "common", "icon": "📜", "description": "Link and verify a fully formatted AoS tournament warscroll army list."},
    {"id": "aos_battletome_purist", "name": "Battletome Purist", "category": "factions", "rarity": "uncommon", "icon": "📖", "description": "Win 10 tournament matches with a single battletome without switching armies."},
    {"id": "aos_vermintide_breaker", "name": "Vermintide Breaker", "category": "factions", "rarity": "rare", "icon": "🐀", "description": "Defeat a horde army (Skaven, Gloomspite Gitz, or Flesh-eater Courts) in official tournament play."},
    {"id": "aos_gargant_slayer", "name": "Gargant Slayer", "category": "factions", "rarity": "rare", "icon": "🦶", "description": "Defeat a titanic monster army (Sons of Behemat or Ogor Mawtribes) in official tournament play."},

    # ── Category D: Realm Ladder & Elo Milestones (15 Badges) ──
    {"id": "aos_rank_calibrated", "name": "Rank Calibrated", "category": "ladder", "rarity": "common", "icon": "🎯", "description": "Complete 5 matches to earn official calibrated AoS Elo rank."},
    {"id": "aos_climbing_the_ranks", "name": "Climbing the Ranks", "category": "ladder", "rarity": "common", "icon": "🧗", "description": "Reach 1,550.0 Elo rating in AoS."},
    {"id": "aos_veteran_line", "name": "The Veteran Line", "category": "ladder", "rarity": "uncommon", "icon": "⚔️", "description": "Reach 1,650.0 Elo rating in AoS."},
    {"id": "aos_elite_threshold", "name": "The Elite Threshold", "category": "ladder", "rarity": "rare", "icon": "🛡️", "description": "Reach 1,750.0 Elo rating (Top 20% in AoS)."},
    {"id": "aos_master_tier", "name": "The Master Tier", "category": "ladder", "rarity": "rare", "icon": "⭐", "description": "Reach 1,850.0 Elo rating (Top 10% in AoS)."},
    {"id": "aos_grandmaster", "name": "Grandmaster of the Realms", "category": "ladder", "rarity": "epic", "icon": "🎖️", "description": "Reach 1,950.0 Elo rating (Top 3% in AoS)."},
    {"id": "aos_apex_2000", "name": "The Apex 2000", "category": "ladder", "rarity": "legendary", "icon": "🏆", "description": "Cross 2,000.0 Elo into elite AoS competition."},
    {"id": "aos_everchosen_pinnacle", "name": "Champion of the Gods", "category": "ladder", "rarity": "mythic", "icon": "⚡", "description": "Reach 2,100.0+ Elo rating in AoS (Global Top 0.5%)."},
    {"id": "aos_peak_performer", "name": "Peak Performer", "category": "ladder", "rarity": "rare", "icon": "📈", "description": "Maintain an Elo rating 100+ points above calibration baseline."},
    {"id": "aos_streak_of_fire", "name": "Streak of Aqshy", "category": "ladder", "rarity": "uncommon", "icon": "🔥", "description": "Win 4 consecutive AoS tournament matches."},
    {"id": "aos_streak_of_dominance", "name": "Streak of Conquest", "category": "ladder", "rarity": "rare", "icon": "⚡", "description": "Win 8 consecutive AoS tournament matches."},
    {"id": "aos_the_juggernaut", "name": "The Juggernaut", "category": "ladder", "rarity": "epic", "icon": "💥", "description": "Win 12 consecutive AoS tournament matches."},
    {"id": "aos_the_immortal_run", "name": "The Eternal March", "category": "ladder", "rarity": "mythic", "icon": "💎", "description": "Win 18 consecutive AoS tournament matches without defeat."},
    {"id": "aos_top_50_regional", "name": "Top 50 Regional", "category": "ladder", "rarity": "rare", "icon": "🗺️", "description": "Enter the Top 50 of your region's AoS leaderboard."},
    {"id": "aos_top_10_sovereign", "name": "Top 10 Sovereign", "category": "ladder", "rarity": "legendary", "icon": "👑", "description": "Enter the Top 10 of AoS global leaderboard."},

    # ── Category E: The Chronicler's Ledger & Secrets (15 Badges) ──
    {"id": "aos_brother_in_arms", "name": "Brother-in-Arms", "category": "career", "rarity": "common", "icon": "🤝", "description": "Link your profile to an official gaming club or team."},
    {"id": "aos_host_leader", "name": "Host Leader", "category": "career", "rarity": "uncommon", "icon": "👥", "description": "Compete in 10+ tournament matches as a registered club member."},
    {"id": "aos_club_vanguard", "name": "Club Vanguard", "category": "career", "rarity": "rare", "icon": "🚩", "description": "Maintain a 60%+ win rate across 10+ matches for your club."},
    {"id": "aos_local_pillar", "name": "The Local Pillar", "category": "career", "rarity": "uncommon", "icon": "🏛️", "description": "Compete in 3+ recorded AoS tournament events."},
    {"id": "aos_road_warrior", "name": "The Realmgate Traveler", "category": "career", "rarity": "rare", "icon": "🛣️", "description": "Compete in tournaments across 2+ distinct event locations."},
    {"id": "aos_globetrotter", "name": "Wandering Warlord", "category": "career", "rarity": "epic", "icon": "✈️", "description": "Compete in 5+ recorded AoS tournament events."},
    {"id": "aos_rivalry_born", "name": "Feud Born", "category": "career", "rarity": "common", "icon": "⚔️", "description": "Face the same opponent in AoS tournament play for the 2nd time."},
    {"id": "aos_rivalry_veteran", "name": "Ancient Grudge", "category": "career", "rarity": "rare", "icon": "🥊", "description": "Face the same opponent 5+ times in official AoS tournaments."},
    {"id": "aos_vendetta_broken", "name": "The Grudge Settled", "category": "career", "rarity": "epic", "icon": "🩸", "description": "Defeat an opponent you have played multiple times in official competition."},
    {"id": "aos_veteran_season_1", "name": "Veteran of Realm Season I", "category": "career", "rarity": "rare", "icon": "📜", "description": "Active competitor with 15+ official AoS matches in Season 1."},
    {"id": "aos_veteran_long_war", "name": "Veteran of the Mortal Realms", "category": "career", "rarity": "epic", "icon": "⏳", "description": "Active competitor across 2+ calendar years in AoS."},
    {"id": "aos_dice_gods_wept", "name": "The Dice Gods Wept", "category": "career", "rarity": "rare", "icon": "🎲", "description": "Grinding Defense: Win a defensive slugfest while held under 30 Victory Points.", "is_secret": True, "hint": "Even when the winds of magic falter, steadfast resolve endures."},
    {"id": "aos_narrow_escape", "name": "The Narrow Escape", "category": "career", "rarity": "rare", "icon": "❤️", "description": "The Photo Finish: Win an official AoS tournament match by 2 or fewer Victory Points.", "is_secret": True, "hint": "A single spark of life is all that is needed to carry the day."},
    {"id": "aos_unbroken_bastion", "name": "Unyielding Bastion", "category": "career", "rarity": "epic", "icon": "🛡️", "description": "Complete 25 tournament matches across your AoS competitive career.", "is_secret": True, "hint": "Yield not a single realm-gate, no matter how grim the field becomes."},
    {"id": "aos_omnitactica_pioneer", "name": "Realm Pioneer", "category": "career", "rarity": "epic", "icon": "⭐", "description": "Earned during the founding era of OmniTactica's AoS competitive honor system."}
]

def get_all_badges_catalog() -> List[Dict[str, Any]]:
    """Returns copy of the entire 105 AoS badge catalog with category details."""
    catalog = []
    for b in BADGE_CATALOG_AOS:
        cat_info = CATEGORIES_AOS.get(b["category"], {})
        rarity_info = RARITY_CONFIG.get(b["rarity"], RARITY_CONFIG["common"])
        item = dict(b)
        item["category_title"] = cat_info.get("title", b["category"].title())
        item["glory_points"] = rarity_info["glory"]
        item["rarity_label"] = rarity_info["label"]
        catalog.append(item)
    return catalog


def get_rank_for_badge_count(badge_count: int) -> Dict[str, Any]:
    """Returns the matching military rank given an unlocked AoS badge count."""
    count = max(0, _safe_int(badge_count))
    current_rank = RANKS_AOS[0]
    next_rank = None

    for i, r in enumerate(RANKS_AOS):
        if count >= r["min_badges"]:
            current_rank = r
            if i + 1 < len(RANKS_AOS):
                next_rank = RANKS_AOS[i + 1]
            else:
                next_rank = None

    if next_rank:
        badges_in_tier = next_rank["min_badges"] - current_rank["min_badges"]
        earned_in_tier = count - current_rank["min_badges"]
        progress_pct = min(100.0, round((earned_in_tier / max(1, badges_in_tier)) * 100.0, 1))
        badges_needed = next_rank["min_badges"] - count
    else:
        progress_pct = 100.0
        badges_needed = 0

    return {
        "rank": current_rank["rank"],
        "title": current_rank["title"],
        "min_badges": current_rank["min_badges"],
        "max_badges": current_rank["max_badges"],
        "css_class": current_rank["css_class"],
        "badge_bg": current_rank["badge_bg"],
        "badge_color": current_rank["badge_color"],
        "icon": current_rank["icon"],
        "description": current_rank["description"],
        "badge_count": count,
        "next_rank_title": next_rank["title"] if next_rank else None,
        "next_rank_min": next_rank["min_badges"] if next_rank else None,
        "badges_needed_for_next": badges_needed,
        "progress_pct": progress_pct
    }

def evaluate_aos_player_badges(
    player_data: Dict[str, Any],
    history: List[Dict[str, Any]],
    tournaments: Optional[List[Dict[str, Any]]] = None,
    faction_mastery: Optional[List[Dict[str, Any]]] = None,
    matchup_matrix: Optional[List[Dict[str, Any]]] = None,
    user_pinned_ids: Optional[List[str]] = None
) -> Dict[str, Any]:
    """Evaluates all 105 AoS badges for a player against authentic match history.

    Calibrated strictly to Age of Sigmar 50-VP max scoring (GHB format).
    """
    tournaments = tournaments or []
    history = history or []
    faction_mastery = faction_mastery or []
    matchup_matrix = matchup_matrix or []

    # Career aggregates
    current_elo = _safe_float(player_data.get("current_elo"), 1500.0)
    peak_elo = _safe_float(player_data.get("peak_elo"), current_elo)
    matches_played = _safe_int(player_data.get("matches_played") or player_data.get("total_matches") or len(history))
    history_wins = len([m for m in history if str(m.get("result") or "").upper() == "W"])
    history_losses = len([m for m in history if str(m.get("result") or "").upper() == "L"])
    history_draws = len([m for m in history if str(m.get("result") or "").upper() == "D"])
    wins = max(_safe_int(player_data.get("wins")), history_wins)
    losses = max(_safe_int(player_data.get("losses")), history_losses)
    draws = max(_safe_int(player_data.get("draws")), history_draws)
    matches_played = max(matches_played, wins + losses + draws)
    win_rate = _safe_float(player_data.get("win_rate") or (round(wins / max(1, matches_played) * 100, 1) if matches_played else 0))
    team = str(player_data.get("team") or "").strip()
    longest_streak = _safe_int(player_data.get("longest_win_streak"))

    # ── AoS Grand Alliances & Meta Constants ──
    ORDER_FACTIONS = {"stormcast eternals", "cities of sigmar", "seraphon", "idoneth deepkin", "daughters of khaine", "lumineth realm-lords", "fyreslayers", "kharadron overlords", "sylvaneth"}
    CHAOS_FACTIONS = {"slaves to darkness", "blades of khorne", "disciples of tzeentch", "maggotkin of nurgle", "hedonites of slaanesh", "skaven", "beasts of chaos"}
    DEATH_FACTIONS = {"soulblight gravelords", "ossiarch bonereapers", "flesh-eater courts", "nighthaunt"}
    DESTRUCTION_FACTIONS = {"orruk warclans", "gloomspite gitz", "sons of behemat", "ogor mawtribes"}
    SWARM_FACTIONS = {"skaven", "gloomspite gitz", "flesh-eater courts"}
    TITAN_FACTIONS = {"sons of behemat", "ogor mawtribes"}
    META_FACTIONS = {"stormcast eternals", "slaves to darkness", "soulblight gravelords", "seraphon"}

    # Process match history metrics
    total_vp_scored = 0
    max_vp_scored = 0
    min_opp_score = 999
    clutch_1vp_wins = 0
    clutch_2vp_wins = 0
    clutch_3vp_wins = 0
    blowout_20vp_wins = 0
    high_score_35_count = 0
    high_score_40_count = 0
    high_score_45_count = 0
    high_score_50_count = 0
    low_opp_15_count = 0
    wins_35plus = 0
    wins_40plus = 0
    flawless_46_18_wins = 0
    r1_40_wins = 0
    r5_lockout_wins = 0
    attrition_low_wins = 0
    upset_100_wins = 0
    upset_175_wins = 0
    upset_250_wins = 0
    beat_top_10 = False
    beat_65_wr_opp = 0
    beat_75_wr_opp = 0
    events_set = set()
    factions_won = set()
    factions_played = set()
    enemy_factions_defeated = set()
    mirror_wins = 0
    consecutive_wins = 0
    max_streak_in_history = 0
    opponents_count: Dict[str, int] = {}
    years_active = set()
    locations_set = set()

    order_wins = 0
    chaos_wins = 0
    death_wins = 0
    destruction_wins = 0
    alliances_won = set()
    swarm_wins = 0
    titan_wins = 0
    meta_wins = 0

    event_matches: Dict[str, List[Dict[str, Any]]] = {}

    for m in history:
        p_score = _safe_int(m.get("player_score") if m.get("player_score") is not None else m.get("p1_score"))
        o_score = _safe_int(m.get("opponent_score") if m.get("opponent_score") is not None else m.get("p2_score"))
        res = str(m.get("result") or "").upper()
        rnd = _safe_round(m.get("round"))
        p_fac = str(m.get("player_faction") or m.get("faction") or "").strip().lower()
        o_fac = str(m.get("opponent_faction") or "").strip().lower()
        o_elo = _safe_float(m.get("opponent_elo"), 1500.0)
        o_name = str(m.get("opponent_name") or m.get("opponent_id") or "").strip()
        ev_id = str(m.get("event_id") or m.get("tournament_id") or "").strip()
        loc = str(m.get("location") or m.get("city") or "").strip()
        m_date = str(m.get("match_date") or "")

        if p_fac: factions_played.add(p_fac)
        if ev_id:
            events_set.add(ev_id)
            event_matches.setdefault(ev_id, []).append(m)
        if loc: locations_set.add(loc)
        if m_date and len(m_date) >= 4:
            years_active.add(m_date[:4])
        if o_name:
            opponents_count[o_name] = opponents_count.get(o_name, 0) + 1

        total_vp_scored += p_score
        if p_score > max_vp_scored: max_vp_scored = p_score
        if p_score >= 35: high_score_35_count += 1
        if p_score >= 40: high_score_40_count += 1
        if p_score >= 45: high_score_45_count += 1
        if p_score >= 50: high_score_50_count += 1
        if o_score <= 15 and res == "W": low_opp_15_count += 1

        if res == "W":
            consecutive_wins += 1
            if consecutive_wins > max_streak_in_history:
                max_streak_in_history = consecutive_wins

            if p_fac: factions_won.add(p_fac)
            if o_fac: enemy_factions_defeated.add(o_fac)

            diff = p_score - o_score
            if diff == 1: clutch_1vp_wins += 1
            if 1 <= diff <= 2: clutch_2vp_wins += 1
            if 1 <= diff <= 3: clutch_3vp_wins += 1
            if diff >= 20: blowout_20vp_wins += 1
            if p_score <= 30 and diff > 0: attrition_low_wins += 1
            if p_score >= 46 and o_score <= 18: flawless_46_18_wins += 1
            if p_score >= 35: wins_35plus += 1
            if p_score >= 40: wins_40plus += 1

            if rnd == 1 and p_score >= 40: r1_40_wins += 1
            if rnd >= 5 and o_score <= 16: r5_lockout_wins += 1

            if o_score < min_opp_score: min_opp_score = o_score

            my_elo_at_match = _safe_float(m.get("new_elo"), current_elo) - _safe_float(m.get("delta_elo"), 0.0)
            if (o_elo - my_elo_at_match) >= 100: upset_100_wins += 1
            if (o_elo - my_elo_at_match) >= 175: upset_175_wins += 1
            if (o_elo - my_elo_at_match) >= 250: upset_250_wins += 1
            if o_elo >= 2000: beat_top_10 = True

            opp_wr = _safe_float(m.get("opponent_win_rate"), 0.0)
            if opp_wr >= 65.0: beat_65_wr_opp += 1
            if opp_wr >= 75.0: beat_75_wr_opp += 1

            if p_fac and o_fac and p_fac == o_fac: mirror_wins += 1
            if o_fac in SWARM_FACTIONS: swarm_wins += 1
            if o_fac in TITAN_FACTIONS: titan_wins += 1
            if o_fac in META_FACTIONS: meta_wins += 1

            if p_fac in ORDER_FACTIONS:
                order_wins += 1
                alliances_won.add("order")
            if p_fac in CHAOS_FACTIONS:
                chaos_wins += 1
                alliances_won.add("chaos")
            if p_fac in DEATH_FACTIONS:
                death_wins += 1
                alliances_won.add("death")
            if p_fac in DESTRUCTION_FACTIONS:
                destruction_wins += 1
                alliances_won.add("destruction")
        else:
            consecutive_wins = 0

    best_streak = max(longest_streak, max_streak_in_history)
    events_count = len(events_set) or len(tournaments)

    # Tournament aggregates
    gt_5_0_runs = len([t for t in tournaments if t.get("wins", 0) >= 5 and t.get("losses", 0) == 0 and t.get("matches_played", 0) >= 5])
    gt_4_1_runs = len([t for t in tournaments if t.get("wins", 0) >= 4 and t.get("matches_played", 0) >= 5])
    gt_3_2_runs = len([t for t in tournaments if t.get("wins", 0) >= 3 and t.get("matches_played", 0) >= 5])

    table_one_starts = 0
    for ev_id, m_list in event_matches.items():
        sorted_m = sorted(m_list, key=lambda x: _safe_round(x.get("round")))
        if len(sorted_m) >= 3:
            first_3 = sorted_m[:3]
            if all(str(m.get("result", "")).upper() == "W" for m in first_3):
                table_one_starts += 1

    crucible_1700_count = 0
    crucible_1775_count = 0
    apex_1800_count = 0
    for ev_id, m_list in event_matches.items():
        if len(m_list) >= 4:
            opp_elos = [_safe_float(m.get("opponent_elo"), 1500.0) for m in m_list]
            ev_wins = len([m for m in m_list if str(m.get("result", "")).upper() == "W"])
            avg_opp = sum(opp_elos) / len(opp_elos)
            if avg_opp >= 1700.0 and ev_wins >= 3: crucible_1700_count += 1
            if avg_opp >= 1775.0 and ev_wins >= 4: crucible_1775_count += 1
            if all(e >= 1800.0 for e in opp_elos) and ev_wins >= 4: apex_1800_count += 1

    max_faction_wins = 0
    if faction_mastery:
        max_faction_wins = max([_safe_int(f.get("wins", 0)) for f in faction_mastery] or [0])
    max_faction_wins = max(max_faction_wins, wins)

    regional_rank = _safe_int(player_data.get("regional_rank") or player_data.get("region_rank"))
    global_rank = _safe_int(player_data.get("global_rank"))
    max_vs_opponent = max(opponents_count.values()) if opponents_count else 0

    evaluated_badges = []
    unlocked_count = 0
    total_glory = 0

    for b in BADGE_CATALOG_AOS:
        b_id = b["id"]
        cat_info = CATEGORIES_AOS.get(b["category"], {})
        rarity_info = RARITY_CONFIG.get(b["rarity"], RARITY_CONFIG["common"])

        unlocked = False
        unlocked_at = None
        provenance = None
        progress = None

        # ── Category A: Realm Tournaments ──
        if b_id == "aos_first_blood":
            unlocked = wins >= 1
            progress = {"current": wins, "target": 1, "unit": "wins"}
            if unlocked and history:
                w_m = next((m for m in history if str(m.get("result", "")).upper() == "W"), None)
                if w_m:
                    unlocked_at = w_m.get("match_date")
                    provenance = f"Match victory against {w_m.get('opponent_name', 'opponent')} ({w_m.get('player_score', 0)}-{w_m.get('opponent_score', 0)})"

        elif b_id == "aos_the_debutant":
            unlocked = any(t.get("matches_played", 0) >= 3 for t in tournaments) or any(len(m_list) >= 3 for m_list in event_matches.values()) or matches_played >= 3
            progress = {"current": 1 if unlocked else 0, "target": 1, "unit": "events"}
            if unlocked: provenance = "Completed inaugural AoS tournament event"

        elif b_id == "aos_weekend_warrior":
            unlocked = events_count >= 3 or matches_played >= 15
            progress = {"current": events_count or (matches_played // 5), "target": 3, "unit": "GTs"}

        elif b_id == "aos_campaign_veteran":
            unlocked = events_count >= 10 or matches_played >= 50
            progress = {"current": events_count or (matches_played // 5), "target": 10, "unit": "GTs"}

        elif b_id == "aos_iron_man_1":
            unlocked = any(t.get("matches_played", 0) >= 5 for t in tournaments) or matches_played >= 5
            progress = {"current": min(matches_played, 5), "target": 5, "unit": "rounds"}
            if unlocked: provenance = "Completed 5-round AoS Grand Tournament without dropping"

        elif b_id == "aos_iron_man_2":
            unlocked = len([t for t in tournaments if t.get("matches_played", 0) >= 5]) >= 5 or events_count >= 5 or matches_played >= 25
            progress = {"current": min(events_count or (matches_played // 5), 5), "target": 5, "unit": "GTs"}

        elif b_id == "aos_iron_man_3":
            unlocked = len([t for t in tournaments if t.get("matches_played", 0) >= 5]) >= 10 or events_count >= 10 or matches_played >= 50
            progress = {"current": min(events_count or (matches_played // 5), 10), "target": 10, "unit": "GTs"}

        elif b_id == "aos_positive_ledger":
            unlocked = gt_3_2_runs >= 1 or (wins >= 3 and win_rate >= 55.0)
            progress = {"current": gt_3_2_runs or (1 if win_rate >= 55.0 else 0), "target": 1, "unit": "winning GTs"}
            if unlocked: provenance = "Finished 5-round AoS GT with a winning record (3-2+)"

        elif b_id == "aos_top_quarter":
            unlocked = any(t.get("wins", 0) >= 3 and t.get("total_battle_points", 0) >= 175 for t in tournaments) or (win_rate >= 60.0 and matches_played >= 10)
            progress = {"current": round(win_rate, 1), "target": 60.0, "unit": "% win rate"}

        elif b_id == "aos_podium_bronze":
            unlocked = gt_4_1_runs >= 1 or (wins >= 4 and best_streak >= 4)
            progress = {"current": gt_4_1_runs or (1 if wins >= 4 else 0), "target": 1, "unit": "4-1 GT finishes"}
            if unlocked: provenance = "Achieved 4-1 winning record at a 5-round AoS Grand Tournament"

        elif b_id == "aos_podium_silver":
            unlocked = gt_4_1_runs >= 2 or (wins >= 8 and best_streak >= 4)
            progress = {"current": gt_4_1_runs or (wins // 4), "target": 2, "unit": "4-1 GT finishes"}
            if unlocked: provenance = "Achieved 4-1 (or better) finishes across multiple AoS Grand Tournaments"

        elif b_id == "aos_grand_champion":
            unlocked = gt_5_0_runs >= 1 or best_streak >= 5
            progress = {"current": gt_5_0_runs or (1 if best_streak >= 5 else 0), "target": 1, "unit": "5-0 GT runs"}
            if unlocked: provenance = "Achieved flawless 5-0-0 undefeated AoS Grand Tournament championship run"

        elif b_id == "aos_the_undefeated":
            unlocked = gt_5_0_runs >= 1 or (longest_streak >= 5 and wins >= 5)
            progress = {"current": gt_5_0_runs or (1 if longest_streak >= 5 else 0), "target": 1, "unit": "undefeated runs"}
            if unlocked: provenance = "Completed 5-round AoS Grand Tournament with a clean 5-0-0 record"

        elif b_id == "aos_super_major_conqueror":
            unlocked = best_streak >= 8 or any(t.get("matches_played", 0) >= 6 and t.get("wins", 0) >= 6 for t in tournaments)
            progress = {"current": min(best_streak, 8), "target": 8, "unit": "consecutive wins"}

        elif b_id == "aos_double_crown":
            unlocked = best_streak >= 10
            progress = {"current": min(best_streak, 10), "target": 10, "unit": "consecutive wins"}

        elif b_id == "aos_triple_crown":
            unlocked = gt_4_1_runs >= 3 or (wins >= 12 and best_streak >= 5)
            progress = {"current": gt_4_1_runs, "target": 3, "unit": "podium GTs"}

        elif b_id == "aos_giant_slayer_1":
            unlocked = upset_100_wins >= 1
            progress = {"current": upset_100_wins, "target": 1, "unit": "+100 Elo upsets"}

        elif b_id == "aos_giant_slayer_2":
            unlocked = upset_175_wins >= 1
            progress = {"current": upset_175_wins, "target": 1, "unit": "+175 Elo upsets"}

        elif b_id == "aos_giant_slayer_3":
            unlocked = upset_250_wins >= 1
            progress = {"current": upset_250_wins, "target": 1, "unit": "+250 Elo upsets"}

        elif b_id == "aos_godsbane":
            unlocked = beat_top_10 or any(_safe_float(m.get("opponent_elo")) >= 2000.0 and str(m.get("result", "")).upper() == "W" for m in history)
            progress = {"current": 1 if unlocked else 0, "target": 1, "unit": "2000+ Elo victories"}

        elif b_id == "aos_crucible_survivor_1":
            unlocked = crucible_1700_count >= 1
            progress = {"current": crucible_1700_count, "target": 1, "unit": "1700+ Elo GTs"}

        elif b_id == "aos_crucible_survivor_2":
            unlocked = crucible_1775_count >= 1
            progress = {"current": crucible_1775_count, "target": 1, "unit": "1775+ Elo GTs"}

        elif b_id == "aos_apex_gauntlet":
            unlocked = apex_1800_count >= 1
            progress = {"current": apex_1800_count, "target": 1, "unit": "1800+ Elo Gauntlets"}

        elif b_id == "aos_table_one_resident":
            unlocked = table_one_starts >= 1
            progress = {"current": table_one_starts, "target": 1, "unit": "3-0 starts"}

        elif b_id == "aos_clean_sweep":
            unlocked = any(t.get("wins", 0) >= 5 and t.get("total_battle_points", 0) >= 225 for t in tournaments)
            progress = {"current": 1 if unlocked else 0, "target": 1, "unit": "clean sweeps"}

        # ── Category B: Mortal Realm Feats (50 VP Max Scale) ──
        elif b_id == "aos_realm_marksman":
            unlocked = max_vp_scored >= 35
            progress = {"current": max_vp_scored, "target": 35, "unit": "VP"}

        elif b_id == "aos_grand_bombardier":
            unlocked = max_vp_scored >= 42
            progress = {"current": max_vp_scored, "target": 42, "unit": "VP"}

        elif b_id == "aos_grand_tacticus":
            unlocked = max_vp_scored >= 48
            progress = {"current": max_vp_scored, "target": 48, "unit": "VP"}

        elif b_id == "aos_apex_ascension":
            unlocked = max_vp_scored >= 50
            progress = {"current": max_vp_scored, "target": 50, "unit": "VP"}

        elif b_id == "aos_shyish_bastion_1":
            unlocked = min_opp_score <= 20 and wins >= 1
            progress = {"current": min_opp_score if min_opp_score < 999 else 0, "target": 20, "unit": "opp VP"}

        elif b_id == "aos_shyish_bastion_2":
            unlocked = min_opp_score <= 14 and wins >= 1
            progress = {"current": min_opp_score if min_opp_score < 999 else 0, "target": 14, "unit": "opp VP"}

        elif b_id == "aos_star_metal_aegis":
            unlocked = min_opp_score <= 8 and wins >= 1
            progress = {"current": min_opp_score if min_opp_score < 999 else 0, "target": 8, "unit": "opp VP"}

        elif b_id == "aos_realm_lockout":
            unlocked = min_opp_score <= 4 and wins >= 1
            progress = {"current": min_opp_score if min_opp_score < 999 else 0, "target": 4, "unit": "opp VP"}

        elif b_id == "aos_clutch_by_a_hair":
            unlocked = clutch_1vp_wins >= 1
            progress = {"current": clutch_1vp_wins, "target": 1, "unit": "1-VP wins"}

        elif b_id == "aos_photo_finish":
            unlocked = clutch_2vp_wins >= 1
            progress = {"current": clutch_2vp_wins, "target": 1, "unit": "2-VP wins"}

        elif b_id == "aos_comeback_1":
            unlocked = clutch_3vp_wins >= 1 or attrition_low_wins >= 1
            progress = {"current": clutch_3vp_wins or attrition_low_wins, "target": 1, "unit": "comeback wins"}

        elif b_id == "aos_comeback_2":
            unlocked = clutch_3vp_wins >= 3
            progress = {"current": min(clutch_3vp_wins, 3), "target": 3, "unit": "comeback wins"}

        elif b_id == "aos_battle_tactic_master":
            unlocked = wins_40plus >= 10 or (high_score_40_count >= 10 and wins >= 10)
            progress = {"current": min(wins_40plus, 10), "target": 10, "unit": "40+ VP wins"}

        elif b_id == "aos_celestial_shield":
            unlocked = low_opp_15_count >= 5
            progress = {"current": min(low_opp_15_count, 5), "target": 5, "unit": "defensive lockouts"}

        elif b_id == "aos_grand_strategy_perfection":
            unlocked = high_score_45_count >= 3
            progress = {"current": min(high_score_45_count, 3), "target": 3, "unit": "45+ VP matches"}

        elif b_id == "aos_tactical_perfection":
            unlocked = high_score_45_count >= 10
            progress = {"current": min(high_score_45_count, 10), "target": 10, "unit": "45+ VP matches"}

        elif b_id == "aos_primary_sovereign":
            unlocked = wins_35plus >= 15 or (high_score_35_count >= 15 and wins >= 15)
            progress = {"current": min(wins_35plus, 15), "target": 15, "unit": "35+ VP wins"}

        elif b_id == "aos_flawless_conquest":
            unlocked = flawless_46_18_wins >= 1
            progress = {"current": flawless_46_18_wins, "target": 1, "unit": "flawless conquests"}

        elif b_id == "aos_realm_conquest":
            unlocked = blowout_20vp_wins >= 1
            progress = {"current": blowout_20vp_wins, "target": 1, "unit": "20+ VP margin wins"}

        elif b_id == "aos_against_odds_1":
            unlocked = beat_65_wr_opp >= 1 or upset_100_wins >= 1
            progress = {"current": beat_65_wr_opp or upset_100_wins, "target": 1, "unit": "upset wins"}

        elif b_id == "aos_against_odds_2":
            unlocked = beat_75_wr_opp >= 1 or upset_175_wins >= 1
            progress = {"current": beat_75_wr_opp or upset_175_wins, "target": 1, "unit": "upset wins"}

        elif b_id == "aos_miracle_conquest":
            unlocked = upset_250_wins >= 1 or (upset_175_wins >= 1 and beat_top_10)
            progress = {"current": upset_250_wins or (1 if beat_top_10 and upset_175_wins else 0), "target": 1, "unit": "miracle wins"}

        elif b_id == "aos_dead_heat":
            unlocked = draws >= 1 or any(str(m.get("result", "")).upper() == "D" for m in history)
            progress = {"current": draws, "target": 1, "unit": "draws"}

        elif b_id == "aos_first_strike":
            unlocked = r1_40_wins >= 1
            progress = {"current": r1_40_wins, "target": 1, "unit": "R1 40+ VP wins"}

        elif b_id == "aos_clean_finish":
            unlocked = r5_lockout_wins >= 1
            progress = {"current": r5_lockout_wins, "target": 1, "unit": "R5 lockouts"}

        # ── Category C: Grand Alliances & Battletomes ──
        elif b_id == "aos_cadet_of_army":
            unlocked = max_faction_wins >= 3
            progress = {"current": min(max_faction_wins, 3), "target": 3, "unit": "faction wins"}

        elif b_id == "aos_faction_veteran":
            unlocked = max_faction_wins >= 10
            progress = {"current": min(max_faction_wins, 10), "target": 10, "unit": "faction wins"}

        elif b_id == "aos_faction_champion":
            unlocked = max_faction_wins >= 25
            progress = {"current": min(max_faction_wins, 25), "target": 25, "unit": "faction wins"}

        elif b_id == "aos_warmaster_faction":
            unlocked = max_faction_wins >= 50
            progress = {"current": min(max_faction_wins, 50), "target": 50, "unit": "faction wins"}

        elif b_id == "aos_grand_sovereign":
            unlocked = max_faction_wins >= 100
            progress = {"current": min(max_faction_wins, 100), "target": 100, "unit": "faction wins"}

        elif b_id == "aos_pure_specialist":
            unlocked = any(f.get("wins", 0) >= 12 and f.get("win_rate", 0) >= 80.0 for f in faction_mastery) or (max_faction_wins >= 15 and win_rate >= 80.0)
            progress = {"current": round(win_rate, 1), "target": 80.0, "unit": "% win rate"}

        elif b_id == "aos_polymath_1":
            unlocked = len(factions_won) >= 2
            progress = {"current": len(factions_won), "target": 2, "unit": "battletomes"}

        elif b_id == "aos_polymath_2":
            unlocked = len(factions_won) >= 3
            progress = {"current": len(factions_won), "target": 3, "unit": "battletomes"}

        elif b_id == "aos_grand_polymath":
            unlocked = len(factions_won) >= 5
            progress = {"current": len(factions_won), "target": 5, "unit": "battletomes"}

        elif b_id == "aos_order_vanguard":
            unlocked = order_wins >= 5
            progress = {"current": min(order_wins, 5), "target": 5, "unit": "Order wins"}

        elif b_id == "aos_chaos_warlord":
            unlocked = chaos_wins >= 5
            progress = {"current": min(chaos_wins, 5), "target": 5, "unit": "Chaos wins"}

        elif b_id == "aos_death_sovereign":
            unlocked = death_wins >= 5
            progress = {"current": min(death_wins, 5), "target": 5, "unit": "Death wins"}

        elif b_id == "aos_destruction_destroyer":
            unlocked = destruction_wins >= 5
            progress = {"current": min(destruction_wins, 5), "target": 5, "unit": "Destruction wins"}

        elif b_id == "aos_pantheon_master":
            unlocked = len(alliances_won) >= 3
            progress = {"current": len(alliances_won), "target": 3, "unit": "Grand Alliances"}

        elif b_id == "aos_grand_alliance_ascendant":
            unlocked = len(alliances_won) >= 4
            progress = {"current": len(alliances_won), "target": 4, "unit": "Grand Alliances"}

        elif b_id == "aos_anti_meta_heretic_1":
            unlocked = meta_wins >= 1
            progress = {"current": meta_wins, "target": 1, "unit": "meta wins"}

        elif b_id == "aos_anti_meta_heretic_2":
            unlocked = meta_wins >= 5
            progress = {"current": min(meta_wins, 5), "target": 5, "unit": "meta wins"}

        elif b_id == "aos_mirror_initiate":
            unlocked = mirror_wins >= 1
            progress = {"current": mirror_wins, "target": 1, "unit": "mirror wins"}

        elif b_id == "aos_mirror_maestro":
            unlocked = mirror_wins >= 3
            progress = {"current": min(mirror_wins, 3), "target": 3, "unit": "mirror wins"}

        elif b_id == "aos_mirror_sovereign":
            unlocked = mirror_wins >= 6
            progress = {"current": min(mirror_wins, 6), "target": 6, "unit": "mirror wins"}

        elif b_id == "aos_nemesis_neutralizer":
            unlocked = len(enemy_factions_defeated) >= 5
            progress = {"current": len(enemy_factions_defeated), "target": 5, "unit": "battletomes defeated"}

        elif b_id == "aos_army_customizer":
            unlocked = True
            progress = {"current": 1, "target": 1, "unit": "verified list"}
            provenance = "Warscroll roster verified on OmniTactica"

        elif b_id == "aos_battletome_purist":
            unlocked = max_faction_wins >= 10
            progress = {"current": min(max_faction_wins, 10), "target": 10, "unit": "matches with main faction"}

        elif b_id == "aos_vermintide_breaker":
            unlocked = swarm_wins >= 1
            progress = {"current": swarm_wins, "target": 1, "unit": "horde victories"}

        elif b_id == "aos_gargant_slayer":
            unlocked = titan_wins >= 1
            progress = {"current": titan_wins, "target": 1, "unit": "monster victories"}

        # ── Category D: Realm Ladder & Elo Milestones ──
        elif b_id == "aos_rank_calibrated":
            unlocked = matches_played >= 5
            progress = {"current": min(matches_played, 5), "target": 5, "unit": "matches"}

        elif b_id == "aos_climbing_the_ranks":
            unlocked = current_elo >= 1550.0 or peak_elo >= 1550.0
            progress = {"current": round(max(current_elo, peak_elo), 1), "target": 1550.0, "unit": "Elo"}

        elif b_id == "aos_veteran_line":
            unlocked = current_elo >= 1650.0 or peak_elo >= 1650.0
            progress = {"current": round(max(current_elo, peak_elo), 1), "target": 1650.0, "unit": "Elo"}

        elif b_id == "aos_elite_threshold":
            unlocked = current_elo >= 1750.0 or peak_elo >= 1750.0
            progress = {"current": round(max(current_elo, peak_elo), 1), "target": 1750.0, "unit": "Elo"}

        elif b_id == "aos_master_tier":
            unlocked = current_elo >= 1850.0 or peak_elo >= 1850.0
            progress = {"current": round(max(current_elo, peak_elo), 1), "target": 1850.0, "unit": "Elo"}

        elif b_id == "aos_grandmaster":
            unlocked = current_elo >= 1950.0 or peak_elo >= 1950.0
            progress = {"current": round(max(current_elo, peak_elo), 1), "target": 1950.0, "unit": "Elo"}

        elif b_id == "aos_apex_2000":
            unlocked = current_elo >= 2000.0 or peak_elo >= 2000.0
            progress = {"current": round(max(current_elo, peak_elo), 1), "target": 2000.0, "unit": "Elo"}

        elif b_id == "aos_everchosen_pinnacle":
            unlocked = current_elo >= 2100.0 or peak_elo >= 2100.0
            progress = {"current": round(max(current_elo, peak_elo), 1), "target": 2100.0, "unit": "Elo"}

        elif b_id == "aos_peak_performer":
            unlocked = (current_elo - 1500.0) >= 100.0 or (peak_elo - 1500.0) >= 100.0
            progress = {"current": round(max(current_elo - 1500.0, peak_elo - 1500.0), 1), "target": 100.0, "unit": "Elo gain"}

        elif b_id == "aos_streak_of_fire":
            unlocked = best_streak >= 4
            progress = {"current": min(best_streak, 4), "target": 4, "unit": "win streak"}

        elif b_id == "aos_streak_of_dominance":
            unlocked = best_streak >= 8
            progress = {"current": min(best_streak, 8), "target": 8, "unit": "win streak"}

        elif b_id == "aos_the_juggernaut":
            unlocked = best_streak >= 12
            progress = {"current": min(best_streak, 12), "target": 12, "unit": "win streak"}

        elif b_id == "aos_the_immortal_run":
            unlocked = best_streak >= 18
            progress = {"current": min(best_streak, 18), "target": 18, "unit": "win streak"}

        elif b_id == "aos_top_50_regional":
            unlocked = (regional_rank > 0 and regional_rank <= 50) or current_elo >= 1750.0
            progress = {"current": regional_rank if regional_rank > 0 else 0, "target": 50, "unit": "rank"}

        elif b_id == "aos_top_10_sovereign":
            unlocked = (global_rank > 0 and global_rank <= 10) or current_elo >= 1950.0
            progress = {"current": global_rank if global_rank > 0 else 0, "target": 10, "unit": "rank"}

        # ── Category E: The Chronicler's Ledger & Secrets ──
        elif b_id == "aos_brother_in_arms":
            unlocked = bool(team)
            progress = {"current": 1 if unlocked else 0, "target": 1, "unit": "club"}
            if unlocked: provenance = f"Member of club: {team}"

        elif b_id == "aos_host_leader":
            unlocked = bool(team) and matches_played >= 10
            progress = {"current": min(matches_played, 10) if team else 0, "target": 10, "unit": "club matches"}

        elif b_id == "aos_club_vanguard":
            unlocked = bool(team) and matches_played >= 10 and win_rate >= 60.0
            progress = {"current": round(win_rate, 1) if team and matches_played >= 10 else 0, "target": 60.0, "unit": "% win rate"}

        elif b_id == "aos_local_pillar":
            unlocked = events_count >= 3 or matches_played >= 15
            progress = {"current": events_count, "target": 3, "unit": "events"}

        elif b_id == "aos_road_warrior":
            unlocked = len(locations_set) >= 2 or events_count >= 2
            progress = {"current": len(locations_set) or events_count, "target": 2, "unit": "locations"}

        elif b_id == "aos_globetrotter":
            unlocked = events_count >= 5 or matches_played >= 25
            progress = {"current": events_count, "target": 5, "unit": "events"}

        elif b_id == "aos_rivalry_born":
            unlocked = max_vs_opponent >= 2
            progress = {"current": min(max_vs_opponent, 2), "target": 2, "unit": "matches vs same rival"}

        elif b_id == "aos_rivalry_veteran":
            unlocked = max_vs_opponent >= 5
            progress = {"current": min(max_vs_opponent, 5), "target": 5, "unit": "matches vs same rival"}

        elif b_id == "aos_vendetta_broken":
            unlocked = max_vs_opponent >= 2 and wins >= 1
            progress = {"current": 1 if unlocked else 0, "target": 1, "unit": "vendetta triumphs"}

        elif b_id == "aos_veteran_season_1":
            unlocked = matches_played >= 15
            progress = {"current": min(matches_played, 15), "target": 15, "unit": "Season 1 matches"}

        elif b_id == "aos_veteran_long_war":
            unlocked = len(years_active) >= 2 or matches_played >= 30
            progress = {"current": len(years_active) if len(years_active) >= 1 else (1 if matches_played >= 30 else 0), "target": 2, "unit": "calendar years"}

        elif b_id == "aos_dice_gods_wept":
            unlocked = attrition_low_wins >= 1
            progress = {"current": attrition_low_wins, "target": 1, "unit": "sub-30 VP wins"}

        elif b_id == "aos_narrow_escape":
            unlocked = clutch_2vp_wins >= 1
            progress = {"current": clutch_2vp_wins, "target": 1, "unit": "photo finish wins"}

        elif b_id == "aos_unbroken_bastion":
            unlocked = matches_played >= 25
            progress = {"current": min(matches_played, 25), "target": 25, "unit": "career matches"}

        elif b_id == "aos_omnitactica_pioneer":
            unlocked = True
            progress = {"current": 1, "target": 1, "unit": "founder status"}
            provenance = "Registered during OmniTactica Realm Pioneer Era"

        if unlocked:
            unlocked_count += 1
            total_glory += rarity_info["glory"]

        b_entry = {
            "id": b_id,
            "name": b["name"],
            "category": b["category"],
            "category_title": cat_info.get("title", b["category"].title()),
            "rarity": b["rarity"],
            "rarity_label": rarity_info["label"],
            "glory_points": rarity_info["glory"],
            "icon": b["icon"],
            "description": b["description"],
            "is_secret": b.get("is_secret", False),
            "hint": b.get("hint"),
            "unlocked": unlocked,
            "unlocked_at": unlocked_at,
            "provenance": provenance,
            "progress": progress
        }
        evaluated_badges.append(b_entry)

    rank_data = get_rank_for_badge_count(unlocked_count)

    pinned_badges = []
    if user_pinned_ids:
        for pid in user_pinned_ids[:3]:
            match = next((b for b in evaluated_badges if b["id"] == pid), None)
            if match:
                pinned_badges.append(match)

    if not pinned_badges:
        unlocked_list = [b for b in evaluated_badges if b["unlocked"]]
        rarity_weights = {"mythic": 6, "legendary": 5, "epic": 4, "rare": 3, "uncommon": 2, "common": 1}
        unlocked_list.sort(key=lambda x: (rarity_weights.get(x["rarity"], 0), x.get("glory_points", 0)), reverse=True)
        pinned_badges = unlocked_list[:3]

    return {
        "badge_count": unlocked_count,
        "total_badges": len(BADGE_CATALOG_AOS),
        "completion_pct": round((unlocked_count / max(1, len(BADGE_CATALOG_AOS))) * 100.0, 1),
        "glory_score": total_glory,
        "rank": rank_data,
        "pinned_badges": pinned_badges,
        "badges": evaluated_badges,
        "categories": CATEGORIES_AOS
    }
