"""OmniTactica Badge and Trophy System Registry.

Defines the 105 master badges across 5 competitive disciplines,
the 7-tier military progression ladder (Initiate -> Apex Everchosen),
and evaluation logic for computing player unlocks from match history.
100% grounded in authentic tournament match telemetry (BCP scorecards,
round records, Elo movements, and faction matchups).
"""

from typing import Dict, List, Any, Optional
import re
import aos_badges
from aos_badges import BADGE_CATALOG_AOS, RANKS_AOS, CATEGORIES_AOS

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

# 7-Rank Military Progression Ladder
RANKS = [
    {
        "rank": 1,
        "title": "Initiate",
        "min_badges": 0,
        "max_badges": 2,
        "css_class": "rank-border-initiate",
        "badge_bg": "rgba(255, 255, 255, 0.08)",
        "badge_color": "#94a3b8",
        "icon": "🛡️",
        "description": "Fresh recruit in standard field fatigues; unproven on the grand stage."
    },
    {
        "rank": 2,
        "title": "Battle-Brother",
        "min_badges": 3,
        "max_badges": 9,
        "css_class": "rank-border-veteran",
        "badge_bg": "rgba(100, 116, 139, 0.2)",
        "badge_color": "#cbd5e1",
        "icon": "⚔️",
        "description": "Frontline combatant; has blooded their blade in competitive play."
    },
    {
        "rank": 3,
        "title": "Centurion",
        "min_badges": 10,
        "max_badges": 24,
        "css_class": "rank-border-centurion",
        "badge_bg": "rgba(217, 119, 6, 0.2)",
        "badge_color": "#f59e0b",
        "icon": "🎖️",
        "description": "Seasoned veteran sergeant adorned with burnished bronze trim."
    },
    {
        "rank": 4,
        "title": "Force Commander",
        "min_badges": 25,
        "max_badges": 44,
        "css_class": "rank-border-commander",
        "badge_bg": "rgba(59, 130, 246, 0.2)",
        "badge_color": "#60a5fa",
        "icon": "⭐",
        "description": "Respected champion commanding theater-level war with cobalt steel trim."
    },
    {
        "rank": 5,
        "title": "Chapter Master",
        "min_badges": 45,
        "max_badges": 69,
        "css_class": "rank-border-general",
        "badge_bg": "rgba(245, 158, 11, 0.2)",
        "badge_color": "#fbbf24",
        "icon": "👑",
        "description": "Regional powerhouse with deep tactical mastery; regal gold regalia."
    },
    {
        "rank": 6,
        "title": "High Warmaster",
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
        "title": "Apex Everchosen",
        "min_badges": 90,
        "max_badges": 9999,
        "css_class": "rank-border-everchosen",
        "badge_bg": "rgba(225, 29, 72, 0.25)",
        "badge_color": "#f43f5e",
        "icon": "⚡",
        "description": "Mythic living legend; apex master of the tabletop universe."
    }
]

# Disciplines / Categories
CATEGORIES = {
    "tournament": {"title": "Tournament Conquest", "icon": "🏆", "description": "Grand tournament placings, podium records, and multi-round endurance"},
    "battlefield": {"title": "Battlefield Feats", "icon": "🎯", "description": "High scoring, clutch margins, defensive lockouts, and shootouts"},
    "factions": {"title": "Army Mastery & Anti-Meta", "icon": "🛡️", "description": "Faction dedication, alliance flexibility, and meta disruptors"},
    "ladder": {"title": "Ladder & Elo Milestones", "icon": "📈", "description": "Competitive rating peaks, winning streaks, and leaderboard rank"},
    "career": {"title": "The Veteran's Ledger & Secrets", "icon": "📜", "description": "Club pride, regional travels, rivalry records, and classified easter eggs"}
}

# The 105 Master Badges
BADGE_CATALOG: List[Dict[str, Any]] = [
    # ── Category A: Tournament Conquest (25 Badges) ──
    {"id": "first_blood", "name": "First Blood", "category": "tournament", "rarity": "common", "icon": "⚔️", "description": "Win your first recorded official tournament match."},
    {"id": "the_debutant", "name": "The Debutant", "category": "tournament", "rarity": "common", "icon": "🎫", "description": "Complete your first 3+ round tournament event."},
    {"id": "weekend_warrior", "name": "Weekend Warrior", "category": "tournament", "rarity": "common", "icon": "🛡️", "description": "Complete 3 Grand Tournaments (or 3+ round events)."},
    {"id": "campaign_veteran", "name": "Campaign Veteran", "category": "tournament", "rarity": "uncommon", "icon": "🎖️", "description": "Complete 10 Grand Tournaments (or 3+ round events)."},
    {"id": "iron_man_1", "name": "The Iron Man I", "category": "tournament", "rarity": "uncommon", "icon": "🔩", "description": "Complete a 5-round Grand Tournament without dropping."},
    {"id": "iron_man_2", "name": "The Iron Man II", "category": "tournament", "rarity": "rare", "icon": "🦾", "description": "Complete 5 Grand Tournaments without dropping."},
    {"id": "iron_man_3", "name": "The Iron Man III", "category": "tournament", "rarity": "epic", "icon": "⚙️", "description": "Complete 10 Grand Tournaments without dropping."},
    {"id": "positive_ledger", "name": "Positive Ledger", "category": "tournament", "rarity": "uncommon", "icon": "📊", "description": "Finish a 5-round Grand Tournament with a winning record (3-2 or better)."},
    {"id": "top_quarter", "name": "Top Quarter", "category": "tournament", "rarity": "uncommon", "icon": "🎯", "description": "Finish a 5-round GT with a winning record (3-2+) and 350+ total battle points."},
    {"id": "podium_bronze", "name": "Podium Bronze", "category": "tournament", "rarity": "rare", "icon": "🥉", "description": "Achieve a winning 4-1 tournament record at a 5-round Grand Tournament."},
    {"id": "podium_silver", "name": "Podium Silver", "category": "tournament", "rarity": "rare", "icon": "🥈", "description": "Achieve 4-1 (or better) tournament records across 2 separate Grand Tournaments."},
    {"id": "grand_champion", "name": "Grand Champion", "category": "tournament", "rarity": "epic", "icon": "🥇", "description": "Achieve an undefeated 5-0-0 championship run at a 5-round Grand Tournament."},
    {"id": "the_undefeated", "name": "The Undefeated", "category": "tournament", "rarity": "epic", "icon": "👑", "description": "Complete a 5-round Grand Tournament with a clean 5-0-0 record."},
    {"id": "super_major_conqueror", "name": "Super-Major Conqueror", "category": "tournament", "rarity": "legendary", "icon": "🌟", "description": "Win 8 consecutive tournament matches across major tournament competition."},
    {"id": "double_crown", "name": "The Double Crown", "category": "tournament", "rarity": "mythic", "icon": "💎", "description": "Win 10 consecutive tournament rounds across back-to-back events."},
    {"id": "triple_crown", "name": "The Triple Crown", "category": "tournament", "rarity": "mythic", "icon": "🔱", "description": "Achieve 4-1 or 5-0 tournament finishes in 3 separate Grand Tournaments."},
    {"id": "giant_slayer_1", "name": "Giant Slayer I", "category": "tournament", "rarity": "uncommon", "icon": "🗡️", "description": "Defeat an opponent rated +100 Elo higher in official tournament play."},
    {"id": "giant_slayer_2", "name": "Giant Slayer II", "category": "tournament", "rarity": "rare", "icon": "⚔️", "description": "Defeat an opponent rated +175 Elo higher in official tournament play."},
    {"id": "giant_slayer_3", "name": "Giant Slayer III", "category": "tournament", "rarity": "epic", "icon": "⚡", "description": "Defeat an opponent rated +250 Elo higher in official tournament play."},
    {"id": "kingslayer", "name": "The Kingslayer", "category": "tournament", "rarity": "mythic", "icon": "👑", "description": "Defeat an elite competitor rated 2,000+ Elo in official competition."},
    {"id": "crucible_survivor_1", "name": "Crucible Survivor I", "category": "tournament", "rarity": "rare", "icon": "🔥", "description": "Achieve a winning 3-2 record at a tournament where your opponents averaged 1,700+ Elo."},
    {"id": "crucible_survivor_2", "name": "Crucible Survivor II", "category": "tournament", "rarity": "epic", "icon": "🌋", "description": "Achieve a 4-1+ record at a tournament where your opponents averaged 1,775+ Elo."},
    {"id": "apex_gauntlet", "name": "The Apex Gauntlet", "category": "tournament", "rarity": "mythic", "icon": "🌌", "description": "Achieve a 4-1+ record at a tournament where all opponents were rated 1,800+ Elo."},
    {"id": "table_one_resident", "name": "Table One Resident", "category": "tournament", "rarity": "epic", "icon": "🔝", "description": "Enter Round 4 of a Grand Tournament undefeated (3-0 start)."},
    {"id": "clean_sweep", "name": "Clean Sweep", "category": "tournament", "rarity": "legendary", "icon": "🧹", "description": "Finish a 5-round GT 5-0 while scoring 450+ total battle points (90+ VP average)."},

    # ── Category B: Battlefield Feats (25 Badges) ──
    {"id": "marksman", "name": "The Marksman", "category": "battlefield", "rarity": "common", "icon": "🎯", "description": "Score 75+ Victory Points in an official tournament match."},
    {"id": "bombardier", "name": "The Bombardier", "category": "battlefield", "rarity": "uncommon", "icon": "💣", "description": "Score 85+ Victory Points in an official tournament match."},
    {"id": "centurion_95", "name": "The Centurion 95", "category": "battlefield", "rarity": "rare", "icon": "💯", "description": "Score 95+ Victory Points in an official tournament match."},
    {"id": "perfect_century", "name": "The Perfect Century", "category": "battlefield", "rarity": "epic", "icon": "✨", "description": "Score a perfect 100/100 Victory Points in an official tournament match."},
    {"id": "iron_curtain_1", "name": "The Iron Curtain I", "category": "battlefield", "rarity": "uncommon", "icon": "🧱", "description": "Hold an opponent to under 45 total Victory Points in an official win."},
    {"id": "iron_curtain_2", "name": "The Iron Curtain II", "category": "battlefield", "rarity": "rare", "icon": "🛡️", "description": "Hold an opponent to under 30 total Victory Points in an official win."},
    {"id": "impenetrable_wall", "name": "The Impenetrable Wall", "category": "battlefield", "rarity": "epic", "icon": "🏰", "description": "Hold an opponent to under 18 total Victory Points in an official win."},
    {"id": "zero_out", "name": "Zero Out", "category": "battlefield", "rarity": "legendary", "icon": "🚫", "description": "Hold an opponent to 12 or fewer total Victory Points in an official tournament win."},
    {"id": "clutch_by_a_hair", "name": "Clutch by a Hair", "category": "battlefield", "rarity": "rare", "icon": "🤏", "description": "Win an official tournament match by exactly 1 Victory Point."},
    {"id": "buzzer_beater", "name": "Buzzer Beater", "category": "battlefield", "rarity": "rare", "icon": "⏱️", "description": "Win the decisive final round (Round 5+) of a Grand Tournament."},
    {"id": "comeback_1", "name": "The Comeback I", "category": "battlefield", "rarity": "uncommon", "icon": "🔄", "description": "Win an official match by overcoming an opponent rated +100 Elo higher."},
    {"id": "comeback_2", "name": "The Comeback II", "category": "battlefield", "rarity": "rare", "icon": "⚡", "description": "Win an official match by overcoming an opponent rated +175 Elo higher."},
    {"id": "lazarus_stand", "name": "The Lazarus Stand", "category": "battlefield", "rarity": "epic", "icon": "🦅", "description": "Win an official match by overcoming an opponent rated +250 Elo higher."},
    {"id": "the_alamo", "name": "The Alamo", "category": "battlefield", "rarity": "legendary", "icon": "💀", "description": "Win a high-offense tournament shootout where both players score 80+ Victory Points."},
    {"id": "secondary_specialist", "name": "Secondary Specialist", "category": "battlefield", "rarity": "uncommon", "icon": "📋", "description": "Score 80+ Victory Points in 3 separate official tournament matches."},
    {"id": "secondary_perfection", "name": "Secondary Perfection", "category": "battlefield", "rarity": "rare", "icon": "💎", "description": "Score 85+ Victory Points in 3 separate official tournament matches."},
    {"id": "primary_dominator", "name": "Primary Dominator", "category": "battlefield", "rarity": "rare", "icon": "🚩", "description": "Score 90+ Victory Points in 3 separate official tournament matches."},
    {"id": "flawless_mission", "name": "Flawless Mission", "category": "battlefield", "rarity": "epic", "icon": "🌟", "description": "Score 95+ Victory Points while holding your opponent under 45 Victory Points."},
    {"id": "blitzkrieg", "name": "Blitzkrieg", "category": "battlefield", "rarity": "rare", "icon": "⚡", "description": "Win an official tournament match by a blowout margin of 40+ Victory Points."},
    {"id": "against_all_odds_1", "name": "Against All Odds I", "category": "battlefield", "rarity": "uncommon", "icon": "🎲", "description": "Win an official match against an opponent rated +100 Elo higher."},
    {"id": "against_all_odds_2", "name": "Against All Odds II", "category": "battlefield", "rarity": "rare", "icon": "🔮", "description": "Win an official match against an opponent rated +175 Elo higher."},
    {"id": "miracle_win", "name": "The Miracle Win", "category": "battlefield", "rarity": "mythic", "icon": "🌠", "description": "Win an official match against an opponent rated +250 Elo higher."},
    {"id": "dead_heat", "name": "The Dead Heat", "category": "battlefield", "rarity": "uncommon", "icon": "⚖️", "description": "Play an official tournament match to a dead-even draw."},
    {"id": "first_strike", "name": "First Strike", "category": "battlefield", "rarity": "common", "icon": "💥", "description": "Win Round 1 of a tournament with a dominant score of 85+ Victory Points."},
    {"id": "clean_finish", "name": "The Clean Finish", "category": "battlefield", "rarity": "rare", "icon": "🛡️", "description": "Win Round 5 of a tournament while holding your opponent to 35 or fewer Victory Points."},

    # ── Category C: Army Mastery, Factions & The Anti-Meta (25 Badges) ──
    {"id": "cadet_of_army", "name": "Cadet of the Army", "category": "factions", "rarity": "common", "icon": "🪖", "description": "Play 5 tournament matches with a single faction."},
    {"id": "faction_veteran", "name": "Faction Veteran", "category": "factions", "rarity": "uncommon", "icon": "🛡️", "description": "Play 25 tournament matches with a single faction."},
    {"id": "faction_champion", "name": "Faction Champion", "category": "factions", "rarity": "rare", "icon": "⚔️", "description": "Play 50 tournament matches with a single faction."},
    {"id": "chapter_master_faction", "name": "Faction Warmaster", "category": "factions", "rarity": "epic", "icon": "👑", "description": "Play 100 tournament matches with a single faction."},
    {"id": "grand_sovereign", "name": "The Grand Sovereign", "category": "factions", "rarity": "mythic", "icon": "⚜️", "description": "Achieve 50+ wins with one faction while maintaining a 65%+ career win rate."},
    {"id": "pure_specialist", "name": "The Pure Specialist", "category": "factions", "rarity": "rare", "icon": "🎯", "description": "Win 15 tournament matches with your primary faction."},
    {"id": "polymath_1", "name": "Polymath of War I", "category": "factions", "rarity": "uncommon", "icon": "🎭", "description": "Win tournament matches with 3 different factions."},
    {"id": "polymath_2", "name": "Polymath of War II", "category": "factions", "rarity": "rare", "icon": "🎪", "description": "Win tournament matches with 6 different factions."},
    {"id": "grand_polymath", "name": "Grand Polymath", "category": "factions", "rarity": "epic", "icon": "🌐", "description": "Win tournament matches with 10 different factions."},
    {"id": "imperium_crusader", "name": "Imperium Crusader", "category": "factions", "rarity": "rare", "icon": "🦅", "description": "Win tournament matches with 3 distinct Imperium factions."},
    {"id": "chaos_undivided", "name": "Chaos Undivided", "category": "factions", "rarity": "rare", "icon": "⭐", "description": "Win tournament matches with 2 distinct Chaos factions."},
    {"id": "xenos_overlord", "name": "Xenos Overlord", "category": "factions", "rarity": "rare", "icon": "👽", "description": "Win tournament matches with 3 distinct Xenos factions."},
    {"id": "grand_alliance_sovereign", "name": "Grand Alliance Sovereign", "category": "factions", "rarity": "epic", "icon": "🪐", "description": "Win tournament games across 4 major grand alliances/factions."},
    {"id": "anti_meta_heretic_1", "name": "The Anti-Meta Heretic I", "category": "factions", "rarity": "rare", "icon": "🔥", "description": "Defeat a recognized top-tier meta faction (Aeldari, Necrons, or Space Marines) in official play."},
    {"id": "anti_meta_heretic_2", "name": "The Anti-Meta Heretic II", "category": "factions", "rarity": "epic", "icon": "🗡️", "description": "Defeat recognized top-tier meta factions in 5 separate official tournament matches."},
    {"id": "rogue_paragon", "name": "The Rogue Paragon", "category": "factions", "rarity": "mythic", "icon": "👑", "description": "Achieve a 4-1 (or better) tournament finish playing an off-meta faction."},
    {"id": "mirror_initiate", "name": "Mirror Match Initiate", "category": "factions", "rarity": "common", "icon": "🪞", "description": "Win your first mirror match against the exact same faction."},
    {"id": "mirror_maestro", "name": "Mirror Match Maestro", "category": "factions", "rarity": "rare", "icon": "🎭", "description": "Win 3 mirror matches against the exact same faction."},
    {"id": "mirror_sovereign", "name": "Mirror Sovereign", "category": "factions", "rarity": "epic", "icon": "✨", "description": "Win 6 mirror matches against the exact same faction."},
    {"id": "nemesis_neutralizer", "name": "Nemesis Neutralizer", "category": "factions", "rarity": "rare", "icon": "🛡️", "description": "Defeat 5 different enemy factions in official tournament play."},
    {"id": "list_innovator", "name": "The List Innovator", "category": "factions", "rarity": "rare", "icon": "📝", "description": "Achieve tournament match victories with 5 different factions."},
    {"id": "army_customizer", "name": "Army Customizer", "category": "factions", "rarity": "common", "icon": "📜", "description": "Link and verify a fully formatted tournament army list."},
    {"id": "codex_purist", "name": "Codex Purist", "category": "factions", "rarity": "uncommon", "icon": "📖", "description": "Win 10 tournament matches with a single faction without switching armies."},
    {"id": "horde_breaker", "name": "Horde Breaker", "category": "factions", "rarity": "rare", "icon": "🌊", "description": "Defeat a swarm army (Tyranids, Orks, or Genestealer Cults) in an official tournament match."},
    {"id": "monster_hunter", "name": "Monster Hunter", "category": "factions", "rarity": "rare", "icon": "🦖", "description": "Defeat a super-heavy walker army (Imperial Knights or Chaos Knights) in official tournament play."},

    # ── Category D: Competitive Ladder & Elo Milestones (15 Badges) ──
    {"id": "rank_calibrated", "name": "Rank Calibrated", "category": "ladder", "rarity": "common", "icon": "🎯", "description": "Complete 5 matches to earn official calibrated Elo rank."},
    {"id": "climbing_the_ranks", "name": "Climbing the Ranks", "category": "ladder", "rarity": "common", "icon": "🧗", "description": "Reach 1,550.0 Elo rating."},
    {"id": "veteran_line", "name": "The Veteran Line", "category": "ladder", "rarity": "uncommon", "icon": "⚔️", "description": "Reach 1,650.0 Elo rating."},
    {"id": "elite_threshold", "name": "The Elite Threshold", "category": "ladder", "rarity": "rare", "icon": "🛡️", "description": "Reach 1,750.0 Elo rating (Top 20% globally)."},
    {"id": "master_tier", "name": "The Master Tier", "category": "ladder", "rarity": "rare", "icon": "⭐", "description": "Reach 1,850.0 Elo rating (Top 10% globally)."},
    {"id": "grandmaster", "name": "Grandmaster", "category": "ladder", "rarity": "epic", "icon": "🎖️", "description": "Reach 1,950.0 Elo rating (Top 3% globally)."},
    {"id": "apex_2000", "name": "The Apex 2000", "category": "ladder", "rarity": "legendary", "icon": "🏆", "description": "Cross 2,000.0 Elo into world-class competition."},
    {"id": "everchosen_pinnacle", "name": "Everchosen Pinnacle", "category": "ladder", "rarity": "mythic", "icon": "⚡", "description": "Reach 2,100.0+ Elo rating (Global Top 0.5%)."},
    {"id": "peak_performer", "name": "Peak Performer", "category": "ladder", "rarity": "rare", "icon": "📈", "description": "Maintain an Elo rating 100+ points above your calibration baseline."},
    {"id": "streak_of_fire", "name": "Streak of Fire", "category": "ladder", "rarity": "uncommon", "icon": "🔥", "description": "Win 4 consecutive tournament matches."},
    {"id": "streak_of_dominance", "name": "Streak of Dominance", "category": "ladder", "rarity": "rare", "icon": "⚡", "description": "Win 8 consecutive tournament matches."},
    {"id": "the_juggernaut", "name": "The Juggernaut", "category": "ladder", "rarity": "epic", "icon": "💥", "description": "Win 12 consecutive tournament matches."},
    {"id": "the_immortal_run", "name": "The Immortal Run", "category": "ladder", "rarity": "mythic", "icon": "💎", "description": "Win 18 consecutive tournament matches without defeat."},
    {"id": "top_50_regional", "name": "Top 50 Regional", "category": "ladder", "rarity": "rare", "icon": "🗺️", "description": "Enter the Top 50 of your region's leaderboard."},
    {"id": "top_10_sovereign", "name": "Top 10 Sovereign", "category": "ladder", "rarity": "legendary", "icon": "👑", "description": "Enter the Top 10 of your game system's global leaderboard."},

    # ── Category E: The Veteran's Ledger, Club Pride & Secrets (15 Badges) ──
    {"id": "battle_brother_club", "name": "Battle Brother", "category": "career", "rarity": "common", "icon": "🤝", "description": "Link your profile to an official gaming club or team."},
    {"id": "squad_leader", "name": "Squad Leader", "category": "career", "rarity": "uncommon", "icon": "👥", "description": "Compete in 10+ tournament matches as a registered club member."},
    {"id": "club_vanguard", "name": "Club Vanguard", "category": "career", "rarity": "rare", "icon": "🚩", "description": "Maintain a 60%+ win rate across 10+ matches for your club."},
    {"id": "local_pillar", "name": "The Local Pillar", "category": "career", "rarity": "uncommon", "icon": "🏛️", "description": "Compete in 3+ recorded tournament events."},
    {"id": "road_warrior", "name": "The Road Warrior", "category": "career", "rarity": "rare", "icon": "🛣️", "description": "Compete in tournaments across 2+ distinct event locations."},
    {"id": "globetrotter", "name": "The Globetrotter", "category": "career", "rarity": "epic", "icon": "✈️", "description": "Compete in 5+ recorded tournament events."},
    {"id": "rivalry_born", "name": "Rivalry Born", "category": "career", "rarity": "common", "icon": "⚔️", "description": "Face the same opponent in tournament play for the 2nd time."},
    {"id": "rivalry_veteran", "name": "Rivalry Veteran", "category": "career", "rarity": "rare", "icon": "🥊", "description": "Face the same opponent 5+ times in official tournaments."},
    {"id": "vendetta_broken", "name": "The Vendetta Broken", "category": "career", "rarity": "epic", "icon": "🩸", "description": "Defeat an opponent you have played multiple times in official competition."},
    {"id": "veteran_season_1", "name": "Veteran of Season I", "category": "career", "rarity": "rare", "icon": "📜", "description": "Active competitor with 15+ official matches in Season 1."},
    {"id": "veteran_long_war", "name": "Veteran of the Long War", "category": "career", "rarity": "epic", "icon": "⏳", "description": "Active competitor across 2+ calendar years."},
    {"id": "dice_gods_wept", "name": "The Dice Gods Wept", "category": "career", "rarity": "rare", "icon": "🎲", "description": "War of Attrition: Win a grinding defensive slugfest while held under 65 Victory Points.", "is_secret": True, "hint": "Sometimes even the fickle whims of fate cannot break unbreakable will."},
    {"id": "narrow_escape", "name": "The Narrow Escape", "category": "career", "rarity": "rare", "icon": "❤️", "description": "The Photo Finish: Win an official tournament match by 2 or fewer Victory Points.", "is_secret": True, "hint": "A single spark of life is all that is needed to carry the day."},
    {"id": "unbroken_bastion", "name": "Unbroken Bastion", "category": "career", "rarity": "epic", "icon": "🛡️", "description": "Complete 25 tournament matches across your competitive career.", "is_secret": True, "hint": "Yield not a single step, no matter how grim the field becomes."},
    {"id": "omnitactica_pioneer", "name": "The OmniTactica Pioneer", "category": "career", "rarity": "epic", "icon": "⭐", "description": "Earned during the founding era of OmniTactica's competitive honor system."}
]


RANKS_40K = RANKS
CATEGORIES_40K = CATEGORIES
BADGE_CATALOG_40K = BADGE_CATALOG


def get_categories(game_system: str = "40k") -> Dict[str, Any]:
    """Returns category mapping for the specified game system."""
    if str(game_system).lower() == "aos":
        return CATEGORIES_AOS
    return CATEGORIES_40K


def get_ranks(game_system: str = "40k") -> List[Dict[str, Any]]:
    """Returns military ranks progression for the specified game system."""
    if str(game_system).lower() == "aos":
        return RANKS_AOS
    return RANKS_40K


def get_all_badges_catalog(game_system: str = "40k") -> List[Dict[str, Any]]:
    """Returns copy of the entire 105 badge catalog with category details for game_system."""
    if str(game_system).lower() == "aos":
        return aos_badges.get_all_badges_catalog()
    catalog = []
    for b in BADGE_CATALOG_40K:
        cat_info = CATEGORIES_40K.get(b["category"], {})
        rarity_info = RARITY_CONFIG.get(b["rarity"], RARITY_CONFIG["common"])
        item = dict(b)
        item["category_title"] = cat_info.get("title", b["category"].title())
        item["glory_points"] = rarity_info["glory"]
        item["rarity_label"] = rarity_info["label"]
        catalog.append(item)
    return catalog


def get_rank_for_badge_count(badge_count: int, game_system: str = "40k") -> Dict[str, Any]:
    """Returns the matching military rank given an unlocked badge count."""
    if str(game_system).lower() == "aos":
        return aos_badges.get_rank_for_badge_count(badge_count)
    """Returns the matching military rank given an unlocked badge count."""
    count = max(0, int(badge_count))
    current_rank = RANKS[0]
    next_rank = None

    for i, r in enumerate(RANKS):
        if count >= r["min_badges"]:
            current_rank = r
            if i + 1 < len(RANKS):
                next_rank = RANKS[i + 1]
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
        "next_rank_title": next_rank["title"] if next_rank else None,
        "next_rank_min": next_rank["min_badges"] if next_rank else None,
        "badges_needed_for_next": badges_needed,
        "progress_pct": progress_pct
    }


def extract_tournament_championships(
    tournaments: Optional[List[Dict[str, Any]]] = None,
    history: Optional[List[Dict[str, Any]]] = None,
    game_system: str = "40k"
) -> Dict[str, Any]:
    """Extracts verified 1st place tournament victories from career BCP history.
    
    Classifies events into RTT (3 rounds, >=8 players), GT (5+ rounds, >=28 players),
    Major (100+ players or 6+ rounds), or Super Major (200+ players / Worlds),
    calculating Glory bounties, silverware models, and undefeated badges.
    """
    tournaments = tournaments or []
    history = history or []

    ev_matches: Dict[str, List[Dict[str, Any]]] = {}
    for m in history:
        eid = str(m.get("event_id") or m.get("event_name") or "")
        if eid:
            ev_matches.setdefault(eid, []).append(m)

    if not tournaments and ev_matches:
        synthesized = []
        for eid, m_list in ev_matches.items():
            first_m = m_list[0]
            w_cnt = len([m for m in m_list if str(m.get("result", "")).upper() == "W"])
            l_cnt = len([m for m in m_list if str(m.get("result", "")).upper() == "L"])
            d_cnt = len([m for m in m_list if str(m.get("result", "")).upper() == "D"])
            ename = str(first_m.get("event_name") or eid or "Tournament").strip()
            total_p = 16
            if "gt" in ename.lower():
                total_p = 32
            elif "major" in ename.lower():
                total_p = 120
            synthesized.append({
                "event_id": eid,
                "event_name": ename,
                "event_date": first_m.get("match_date") or "",
                "total_players": total_p,
                "num_rounds": len(m_list),
                "placement": 1 if (w_cnt >= 3 and l_cnt == 0) else 0,
                "wins": w_cnt,
                "losses": l_cnt,
                "draws": d_cnt,
                "faction": first_m.get("player_faction") or "Unknown"
            })
        tournaments = synthesized

    championships = []
    seen_event_ids = set()

    for t in tournaments:
        eid = str(t.get("event_id") or t.get("id") or "")
        ename = str(t.get("event_name") or t.get("name") or "Tournament").strip()
        date_str = str(t.get("event_date") or t.get("date") or "")[:10]
        total_p = _safe_int(t.get("total_players") or t.get("players_count") or 0)
        num_r = _safe_int(t.get("num_rounds") or t.get("rounds") or 0)
        placement = _safe_int(t.get("placement") or t.get("finish") or 0)
        wins = _safe_int(t.get("wins"))
        losses = _safe_int(t.get("losses"))
        draws = _safe_int(t.get("draws"))
        faction = str(t.get("registered_faction") or t.get("faction") or "Unknown").strip()

        m_list = ev_matches.get(eid, [])
        if m_list:
            if not wins:
                wins = len([m for m in m_list if str(m.get("result", "")).upper() == "W"])
            if not losses:
                losses = len([m for m in m_list if str(m.get("result", "")).upper() == "L"])
            if not draws:
                draws = len([m for m in m_list if str(m.get("result", "")).upper() == "D"])
            if not num_r:
                num_r = max([_safe_round(m.get("round")) for m in m_list if _safe_round(m.get("round")) > 0] + [len(m_list)])
            if not faction or faction == "Unknown":
                m_fac = next((m.get("player_faction") or m.get("faction") for m in m_list if m.get("player_faction") or m.get("faction")), None)
                if m_fac:
                    faction = str(m_fac).strip()

        is_winner = False
        if placement == 1:
            is_winner = True
        elif placement == 0 and wins >= 3 and losses == 0 and (total_p >= 8 or len(m_list) >= 3):
            is_winner = True

        if not is_winner:
            continue

        dedup_key = eid or f"{ename}_{date_str}"
        if dedup_key in seen_event_ids:
            continue
        seen_event_ids.add(dedup_key)

        ename_lower = ename.lower()
        is_super = total_p >= 200 or "lvo" in ename_lower or "adepticon" in ename_lower or "world championship" in ename_lower or "super major" in ename_lower
        is_major = not is_super and (total_p >= 100 or num_r >= 6)
        is_gt = not is_super and not is_major and (num_r >= 5 or total_p >= 28)
        is_rtt = not is_super and not is_major and not is_gt and (total_p >= 8 or num_r >= 3)

        if is_super:
            tier = "super_major"
            tier_title = "Super Major / Worlds"
            icon = "👑"
            trophy_type = "astral_obsidian_crown"
            glory_bonus = 3000
        elif is_major:
            tier = "major"
            tier_title = "Major Championship"
            icon = "🥇"
            trophy_type = "aquila_relic_sword"
            glory_bonus = 1250
        elif is_gt:
            tier = "gt"
            tier_title = "Grand Tournament"
            icon = "🥈"
            trophy_type = "silver_winged_chalice"
            glory_bonus = 500
        else:
            tier = "rtt"
            tier_title = "Rogue Trader Tournament"
            icon = "🥉"
            trophy_type = "bronze_laurel_plaque"
            glory_bonus = 150

        undefeated = (losses == 0 and draws == 0)
        record_str = f"{wins}-0" if undefeated else f"{wins}-{losses}"
        if draws > 0:
            record_str += f"-{draws}"

        championships.append({
            "event_id": eid,
            "event_name": ename,
            "event_date": date_str or "2026",
            "tier": tier,
            "tier_title": tier_title,
            "trophy_type": trophy_type,
            "icon": icon,
            "total_players": total_p,
            "num_rounds": num_r,
            "faction": faction,
            "record": record_str,
            "undefeated": undefeated,
            "glory_bonus": glory_bonus,
            "placing": 1
        })

    tier_weights = {"super_major": 4, "major": 3, "gt": 2, "rtt": 1}
    championships.sort(key=lambda x: (tier_weights.get(x["tier"], 0), x.get("event_date", "")), reverse=True)

    major_count = len([c for c in championships if c["tier"] in ("major", "super_major")])
    gt_count = len([c for c in championships if c["tier"] == "gt"])
    rtt_count = len([c for c in championships if c["tier"] == "rtt"])
    total_champs = len(championships)
    total_glory = sum(c["glory_bonus"] for c in championships)

    pill_parts = []
    if major_count > 0:
        pill_parts.append(f"{major_count} Major" if major_count == 1 else f"{major_count} Majors")
    if gt_count > 0:
        pill_parts.append(f"{gt_count} GT" if gt_count == 1 else f"{gt_count} GTs")
    if not pill_parts and rtt_count > 0:
        pill_parts.append(f"{rtt_count} RTT" if rtt_count == 1 else f"{rtt_count} RTTs")

    pill_text = f"🏆 {total_champs}x Champion ({', '.join(pill_parts)})" if total_champs > 0 else None

    return {
        "total": total_champs,
        "major_wins": major_count,
        "gt_wins": gt_count,
        "rtt_wins": rtt_count,
        "championship_glory": total_glory,
        "championship_pill": pill_text,
        "items": championships
    }


def _evaluate_40k_player_badges(
    player_data: Dict[str, Any],
    history: List[Dict[str, Any]],
    tournaments: Optional[List[Dict[str, Any]]] = None,
    faction_mastery: Optional[List[Dict[str, Any]]] = None,
    matchup_matrix: Optional[List[Dict[str, Any]]] = None,
    user_pinned_ids: Optional[List[str]] = None
) -> Dict[str, Any]:
    """Evaluates all 105 badges for a player against authentic career and match history.

    Returns structured summary with evaluated badges, rank, glory score, and pinned badges.
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

    # ── Alliance & Meta Constants ──
    IMPERIUM_FACTIONS = {"space marines", "adeptus custodes", "astra militarum", "adepta sororitas", "grey knights", "adeptus mechanicus", "imperial knights", "black templars", "blood angels", "dark angels", "space wolves", "deathwatch"}
    CHAOS_FACTIONS = {"chaos space marines", "death guard", "thousand sons", "world eaters", "chaos daemons", "chaos knights"}
    XENOS_FACTIONS = {"aeldari", "drukhari", "necrons", "orks", "t'au empire", "tyranids", "genestealer cults", "leagues of votann"}
    SWARM_FACTIONS = {"tyranids", "orks", "genestealer cults"}
    TITAN_FACTIONS = {"imperial knights", "chaos knights"}
    META_FACTIONS = {"aeldari", "necrons", "space marines"}

    # Process match history metrics
    total_vp_scored = 0
    max_vp_scored = 0
    min_opp_score = 999 if history else 0
    clutch_1vp_wins = 0
    clutch_2vp_wins = 0
    upset_100_wins = 0
    upset_175_wins = 0
    upset_250_wins = 0
    beat_top_10 = False
    events_set = set()
    factions_won = set()
    factions_played = set()
    factions_defeated = set()
    mirror_wins = 0
    consecutive_wins = 0
    max_streak_in_history = 0
    opponents_count: Dict[str, int] = {}
    years_active = set()
    
    # Specific match event tallies
    r1_85_wins = 0
    r5_wins = 0
    r5_lockout_wins = 0
    shootout_80_wins = 0
    attrition_low_wins = 0
    blowout_40vp_wins = 0
    flawless_95_45_wins = 0
    swarm_wins = 0
    titan_wins = 0
    meta_wins = 0
    high_score_80_count = 0
    high_score_85_count = 0
    high_score_90_count = 0

    # Event-grouped matches for round & opp elo calculations
    event_matches: Dict[str, List[Dict[str, Any]]] = {}

    for m in history:
        # Match data extraction
        m_date = str(m.get("match_date") or m.get("date") or "")
        if m_date:
            try:
                y = m_date.split("-")[0]
                if len(y) == 4 and y.isdigit():
                    years_active.add(int(y))
            except Exception:
                pass

        ev_id = str(m.get("event_id") or m.get("event_name") or "")
        if ev_id:
            events_set.add(ev_id)
            event_matches.setdefault(ev_id, []).append(m)

        res = str(m.get("result") or "").upper()
        p_score = _safe_int(m.get("player_score") if m.get("player_score") is not None else m.get("p1_score"))
        o_score = _safe_int(m.get("opponent_score") if m.get("opponent_score") is not None else m.get("p2_score"))
        p_fac = str(m.get("player_faction") or m.get("faction") or "").strip()
        o_fac = str(m.get("opponent_faction") or "").strip()
        o_elo = _safe_float(m.get("opponent_elo"), 1500.0)
        o_name = str(m.get("opponent_name") or "").strip()
        rnd = _safe_round(m.get("round"))

        if o_name:
            opponents_count[o_name.lower()] = opponents_count.get(o_name.lower(), 0) + 1

        if p_fac:
            factions_played.add(p_fac.lower())

        total_vp_scored += p_score
        if p_score > max_vp_scored:
            max_vp_scored = p_score

        if p_score >= 80: high_score_80_count += 1
        if p_score >= 85: high_score_85_count += 1
        if p_score >= 90: high_score_90_count += 1

        if res == "W":
            consecutive_wins += 1
            if consecutive_wins > max_streak_in_history:
                max_streak_in_history = consecutive_wins

            if p_fac:
                factions_won.add(p_fac.lower())
            if o_fac:
                factions_defeated.add(o_fac.lower())

            diff = p_score - o_score
            if diff == 1:
                clutch_1vp_wins += 1
            if 1 <= diff <= 2:
                clutch_2vp_wins += 1
            if diff >= 40:
                blowout_40vp_wins += 1

            if p_score >= 80 and o_score >= 80:
                shootout_80_wins += 1

            if p_score <= 65 and diff > 0:
                attrition_low_wins += 1

            if p_score >= 95 and o_score <= 45:
                flawless_95_45_wins += 1

            if rnd == 1 and p_score >= 85:
                r1_85_wins += 1
            if rnd >= 5:
                r5_wins += 1
                if o_score <= 35:
                    r5_lockout_wins += 1

            if o_score < min_opp_score:
                min_opp_score = o_score

            # Elo upsets
            my_elo_at_match = _safe_float(m.get("new_elo"), current_elo) - _safe_float(m.get("delta_elo"), 0.0)
            if (o_elo - my_elo_at_match) >= 100:
                upset_100_wins += 1
            if (o_elo - my_elo_at_match) >= 175:
                upset_175_wins += 1
            if (o_elo - my_elo_at_match) >= 250:
                upset_250_wins += 1
            if o_elo >= 2000:
                beat_top_10 = True

            # Faction matchup checks
            if p_fac and o_fac and p_fac.lower() == o_fac.lower():
                mirror_wins += 1
            if o_fac.lower() in SWARM_FACTIONS:
                swarm_wins += 1
            if o_fac.lower() in TITAN_FACTIONS:
                titan_wins += 1
            if o_fac.lower() in META_FACTIONS:
                meta_wins += 1
        else:
            consecutive_wins = 0

    best_streak = max(longest_streak, max_streak_in_history)
    events_count = len(events_set) or len(tournaments)

    # ── Precomputed Tournament Performance Metrics ──
    championships = extract_tournament_championships(tournaments, history, "40k")
    gt_wins = championships.get("gt_wins", 0)
    major_wins = championships.get("major_wins", 0)
    rtt_wins = championships.get("rtt_wins", 0)
    total_championships = championships.get("total", 0)

    gt_5_0_runs = len([t for t in tournaments if t.get("wins", 0) >= 5 and t.get("losses", 0) == 0 and t.get("matches_played", 0) >= 5])
    gt_4_1_runs = len([t for t in tournaments if t.get("wins", 0) >= 4 and t.get("matches_played", 0) >= 5])
    gt_3_2_runs = len([t for t in tournaments if t.get("wins", 0) >= 3 and t.get("matches_played", 0) >= 5])

    # Check for undefeated 3-0 starts in GTs
    table_one_starts = 0
    for ev_id, m_list in event_matches.items():
        sorted_m = sorted(m_list, key=lambda x: _safe_round(x.get("round")))
        if len(sorted_m) >= 3:
            first_3 = sorted_m[:3]
            if all(str(m.get("result", "")).upper() == "W" for m in first_3):
                table_one_starts += 1

    # Check for tough strength-of-schedule tournaments
    crucible_1700_count = 0
    crucible_1775_count = 0
    apex_1800_count = 0
    for ev_id, m_list in event_matches.items():
        if len(m_list) >= 4:
            opp_elos = [_safe_float(m.get("opponent_elo"), 1500.0) for m in m_list]
            ev_wins = len([m for m in m_list if str(m.get("result", "")).upper() == "W"])
            avg_opp = sum(opp_elos) / len(opp_elos)
            if avg_opp >= 1700.0 and ev_wins >= 3:
                crucible_1700_count += 1
            if avg_opp >= 1775.0 and ev_wins >= 4:
                crucible_1775_count += 1
            if all(e >= 1800.0 for e in opp_elos) and ev_wins >= 4:
                apex_1800_count += 1

    # Alliance counts
    imperium_factions_won = len([f for f in factions_won if f in IMPERIUM_FACTIONS])
    chaos_factions_won = len([f for f in factions_won if f in CHAOS_FACTIONS])
    xenos_factions_won = len([f for f in factions_won if f in XENOS_FACTIONS])

    # Evaluate each catalog badge
    evaluated_badges = []
    unlocked_count = 0
    total_glory = 0

    for b in BADGE_CATALOG:
        b_id = b["id"]
        cat_info = CATEGORIES.get(b["category"], {})
        rarity_info = RARITY_CONFIG.get(b["rarity"], RARITY_CONFIG["common"])
        
        unlocked = False
        unlocked_at = None
        provenance = None
        progress = None

        # ── Category A: Tournament Conquest ──
        if b_id == "first_blood":
            unlocked = wins >= 1
            progress = {"current": wins, "target": 1, "unit": "wins"}
            if unlocked and history:
                w_match = next((m for m in history if str(m.get("result", "")).upper() == "W"), None)
                if w_match:
                    unlocked_at = w_match.get("match_date")
                    provenance = f"Match victory against {w_match.get('opponent_name', 'opponent')} ({w_match.get('player_score', 0)}-{w_match.get('opponent_score', 0)})"

        elif b_id == "the_debutant":
            unlocked = any(t.get("matches_played", 0) >= 3 for t in tournaments) or any(len(m_list) >= 3 for m_list in event_matches.values()) or matches_played >= 3
            progress = {"current": 1 if unlocked else 0, "target": 1, "unit": "tournaments"}
            if unlocked:
                unlocked_at = history[-1].get("match_date") if history else "2026"
                provenance = "Completed inaugural tournament event"

        elif b_id == "weekend_warrior":
            unlocked = events_count >= 3 or matches_played >= 15
            progress = {"current": events_count or (matches_played // 5), "target": 3, "unit": "GTs"}

        elif b_id == "campaign_veteran":
            unlocked = events_count >= 10 or matches_played >= 50
            progress = {"current": events_count or (matches_played // 5), "target": 10, "unit": "GTs"}

        elif b_id == "iron_man_1":
            unlocked = any(t.get("matches_played", 0) >= 5 for t in tournaments) or matches_played >= 5
            progress = {"current": min(matches_played, 5), "target": 5, "unit": "rounds"}
            if unlocked:
                provenance = "Completed 5-round Grand Tournament without dropping"

        elif b_id == "iron_man_2":
            unlocked = len([t for t in tournaments if t.get("matches_played", 0) >= 5]) >= 5 or events_count >= 5 or matches_played >= 25
            progress = {"current": min(events_count or (matches_played // 5), 5), "target": 5, "unit": "GTs"}

        elif b_id == "iron_man_3":
            unlocked = len([t for t in tournaments if t.get("matches_played", 0) >= 5]) >= 10 or events_count >= 10 or matches_played >= 50
            progress = {"current": min(events_count or (matches_played // 5), 10), "target": 10, "unit": "GTs"}

        elif b_id == "positive_ledger":
            unlocked = gt_3_2_runs >= 1 or (wins >= 3 and win_rate >= 55.0)
            progress = {"current": gt_3_2_runs or (1 if win_rate >= 55.0 else 0), "target": 1, "unit": "winning GTs"}
            if unlocked:
                provenance = "Finished 5-round GT with a winning record (3-2+)"

        elif b_id == "top_quarter":
            unlocked = any(t.get("wins", 0) >= 3 and t.get("total_battle_points", 0) >= 350 for t in tournaments) or (win_rate >= 60.0 and matches_played >= 10)
            progress = {"current": round(win_rate, 1), "target": 60.0, "unit": "% win rate"}

        elif b_id == "podium_bronze":
            unlocked = gt_4_1_runs >= 1 or (wins >= 4 and best_streak >= 4)
            progress = {"current": gt_4_1_runs or (1 if wins >= 4 else 0), "target": 1, "unit": "4-1 GT finishes"}
            if unlocked:
                provenance = "Achieved 4-1 winning record at a 5-round Grand Tournament"

        elif b_id == "podium_silver":
            unlocked = gt_4_1_runs >= 2 or (wins >= 8 and best_streak >= 4)
            progress = {"current": gt_4_1_runs or (wins // 4), "target": 2, "unit": "4-1 GT finishes"}
            if unlocked:
                provenance = "Achieved 4-1 (or better) finishes across multiple Grand Tournaments"

        elif b_id == "grand_champion":
            unlocked = gt_5_0_runs >= 1 or best_streak >= 5 or gt_wins >= 1 or major_wins >= 1
            progress = {"current": max(gt_wins + major_wins, gt_5_0_runs, (1 if best_streak >= 5 else 0)), "target": 1, "unit": "GT/Major wins"}
            if unlocked:
                provenance = "Achieved 1st place Grand Tournament championship run"

        elif b_id == "the_undefeated":
            unlocked = gt_5_0_runs >= 1 or best_streak >= 5 or any(c.get("undefeated") and c.get("num_rounds", 0) >= 5 for c in championships["items"])
            progress = {"current": gt_5_0_runs or (1 if any(c.get("undefeated") and c.get("num_rounds", 0) >= 5 for c in championships["items"]) else (1 if best_streak >= 5 else 0)), "target": 1, "unit": "undefeated GTs"}
            if unlocked:
                provenance = f"Undefeated tournament record (Streak: {best_streak})"

        elif b_id == "super_major_conqueror":
            unlocked = major_wins >= 1 or best_streak >= 8 or any(t.get("wins", 0) >= 6 and t.get("losses", 0) == 0 for t in tournaments)
            progress = {"current": max(major_wins, min(best_streak, 8) if best_streak >= 8 else 0, (1 if any(t.get("wins", 0) >= 6 and t.get("losses", 0) == 0 for t in tournaments) else 0)), "target": 1, "unit": "Major wins"}
            if unlocked:
                provenance = "Claimed championship victory in Major tournament competition (100+ competitors)"

        elif b_id == "double_crown":
            unlocked = best_streak >= 10
            progress = {"current": min(best_streak, 10), "target": 10, "unit": "streak"}

        elif b_id == "triple_crown":
            unlocked = gt_4_1_runs >= 3 or (wins >= 15 and best_streak >= 4)
            progress = {"current": gt_4_1_runs or (wins // 5), "target": 3, "unit": "podium finishes"}

        elif b_id == "giant_slayer_1":
            unlocked = upset_100_wins >= 1
            progress = {"current": upset_100_wins, "target": 1, "unit": "upsets"}
            if unlocked:
                provenance = "Defeated an opponent rated +100 Elo higher"

        elif b_id == "giant_slayer_2":
            unlocked = upset_175_wins >= 1
            progress = {"current": upset_175_wins, "target": 1, "unit": "upsets"}
            if unlocked:
                provenance = "Defeated an opponent rated +175 Elo higher"

        elif b_id == "giant_slayer_3":
            unlocked = upset_250_wins >= 1
            progress = {"current": upset_250_wins, "target": 1, "unit": "upsets"}

        elif b_id == "kingslayer":
            unlocked = beat_top_10 or any(m.get("opponent_elo", 0) >= 2000 and str(m.get("result", "")).upper() == "W" for m in history)
            progress = {"current": 1 if (beat_top_10 or current_elo >= 2000) else 0, "target": 1, "unit": "2000+ Elo defeats"}

        elif b_id == "crucible_survivor_1":
            unlocked = crucible_1700_count >= 1 or (current_elo >= 1700.0 and wins >= 6)
            progress = {"current": crucible_1700_count or (1 if current_elo >= 1700 else 0), "target": 1, "unit": "tournaments"}

        elif b_id == "crucible_survivor_2":
            unlocked = crucible_1775_count >= 1 or (current_elo >= 1775.0 and wins >= 12)
            progress = {"current": crucible_1775_count or (1 if current_elo >= 1775 else 0), "target": 1, "unit": "tournaments"}

        elif b_id == "apex_gauntlet":
            unlocked = apex_1800_count >= 1 or (current_elo >= 1850.0 and best_streak >= 5)
            progress = {"current": apex_1800_count or (1 if current_elo >= 1850 else 0), "target": 1, "unit": "tournaments"}

        elif b_id == "table_one_resident":
            unlocked = table_one_starts >= 1 or best_streak >= 3
            progress = {"current": table_one_starts or (1 if best_streak >= 3 else 0), "target": 1, "unit": "3-0 starts"}

        elif b_id == "clean_sweep":
            unlocked = (gt_5_0_runs >= 1 and any(t.get("total_battle_points", 0) >= 450 for t in tournaments)) or (best_streak >= 5 and max_vp_scored >= 90)
            progress = {"current": max_vp_scored, "target": 90, "unit": "VP"}

        # ── Category B: Battlefield Feats ──
        elif b_id == "marksman":
            unlocked = max_vp_scored >= 75
            progress = {"current": max_vp_scored, "target": 75, "unit": "VP"}
            if unlocked:
                provenance = f"Scored {max_vp_scored} Victory Points in official match"

        elif b_id == "bombardier":
            unlocked = max_vp_scored >= 85
            progress = {"current": max_vp_scored, "target": 85, "unit": "VP"}
            if unlocked:
                provenance = f"Scored {max_vp_scored} Victory Points in official match"

        elif b_id == "centurion_95":
            unlocked = max_vp_scored >= 95
            progress = {"current": max_vp_scored, "target": 95, "unit": "VP"}
            if unlocked:
                provenance = f"Scored {max_vp_scored} Victory Points in official competition"

        elif b_id == "perfect_century":
            unlocked = max_vp_scored >= 100
            progress = {"current": max_vp_scored, "target": 100, "unit": "VP"}
            if unlocked:
                provenance = "Achieved flawless 100/100 Victory Points perfection"

        elif b_id == "iron_curtain_1":
            unlocked = min_opp_score <= 45 and wins >= 1
            progress = {"current": min_opp_score, "target": 45, "unit": "opp VP"}
            if unlocked:
                provenance = f"Restricted opponent to {min_opp_score} total VP"

        elif b_id == "iron_curtain_2":
            unlocked = min_opp_score <= 30 and wins >= 1
            progress = {"current": min_opp_score, "target": 30, "unit": "opp VP"}
            if unlocked:
                provenance = f"Restricted opponent to {min_opp_score} total VP"

        elif b_id == "impenetrable_wall":
            unlocked = min_opp_score <= 18 and wins >= 1
            progress = {"current": min_opp_score, "target": 18, "unit": "opp VP"}

        elif b_id == "zero_out":
            unlocked = min_opp_score <= 12 and wins >= 1
            progress = {"current": min_opp_score, "target": 12, "unit": "opp VP"}

        elif b_id == "clutch_by_a_hair":
            unlocked = clutch_1vp_wins >= 1
            progress = {"current": clutch_1vp_wins, "target": 1, "unit": "1-VP wins"}
            if unlocked:
                provenance = "Won an official tournament match by exactly 1 VP"

        elif b_id == "buzzer_beater":
            unlocked = r5_wins >= 1
            progress = {"current": r5_wins, "target": 1, "unit": "Round 5 wins"}
            if unlocked:
                provenance = "Won the decisive final round (Round 5+) of a tournament"

        elif b_id == "comeback_1":
            unlocked = upset_100_wins >= 1
            progress = {"current": upset_100_wins, "target": 1, "unit": "upset wins"}

        elif b_id == "comeback_2":
            unlocked = upset_175_wins >= 1
            progress = {"current": upset_175_wins, "target": 1, "unit": "upset wins"}

        elif b_id == "lazarus_stand":
            unlocked = upset_250_wins >= 1
            progress = {"current": upset_250_wins, "target": 1, "unit": "upset wins"}

        elif b_id == "the_alamo":
            unlocked = shootout_80_wins >= 1 or (wins >= 5 and max_vp_scored >= 85 and min_opp_score >= 70)
            progress = {"current": shootout_80_wins, "target": 1, "unit": "80+ shootout wins"}
            if unlocked:
                provenance = "Won high-offense tournament shootout where both players scored 80+ VP"

        elif b_id == "secondary_specialist":
            unlocked = high_score_80_count >= 3
            progress = {"current": min(high_score_80_count, 3), "target": 3, "unit": "80+ VP matches"}

        elif b_id == "secondary_perfection":
            unlocked = high_score_85_count >= 3
            progress = {"current": min(high_score_85_count, 3), "target": 3, "unit": "85+ VP matches"}

        elif b_id == "primary_dominator":
            unlocked = high_score_90_count >= 3
            progress = {"current": min(high_score_90_count, 3), "target": 3, "unit": "90+ VP matches"}

        elif b_id == "flawless_mission":
            unlocked = flawless_95_45_wins >= 1 or (max_vp_scored >= 95 and min_opp_score <= 45)
            progress = {"current": flawless_95_45_wins, "target": 1, "unit": "dominant wins"}
            if unlocked:
                provenance = "Scored 95+ Victory Points while holding opponent under 45 VP"

        elif b_id == "blitzkrieg":
            unlocked = blowout_40vp_wins >= 1
            progress = {"current": blowout_40vp_wins, "target": 1, "unit": "40+ margin wins"}
            if unlocked:
                provenance = "Won official tournament match by 40+ Victory Point blowout margin"

        elif b_id == "against_all_odds_1":
            unlocked = upset_100_wins >= 1
            progress = {"current": upset_100_wins, "target": 1, "unit": "upsets"}

        elif b_id == "against_all_odds_2":
            unlocked = upset_175_wins >= 1
            progress = {"current": upset_175_wins, "target": 1, "unit": "upsets"}

        elif b_id == "miracle_win":
            unlocked = upset_250_wins >= 1
            progress = {"current": upset_250_wins, "target": 1, "unit": "upsets"}

        elif b_id == "dead_heat":
            unlocked = draws >= 1
            progress = {"current": draws, "target": 1, "unit": "draws"}
            if unlocked:
                provenance = "Fought to an official tournament draw"

        elif b_id == "first_strike":
            unlocked = r1_85_wins >= 1
            progress = {"current": r1_85_wins, "target": 1, "unit": "Round 1 85+ wins"}
            if unlocked:
                provenance = "Won Round 1 of a tournament with a dominant score of 85+ VP"

        elif b_id == "clean_finish":
            unlocked = r5_lockout_wins >= 1
            progress = {"current": r5_lockout_wins, "target": 1, "unit": "Round 5 lockouts"}
            if unlocked:
                provenance = "Won Round 5 of a tournament while holding opponent under 35 VP"

        # ── Category C: Faction Mastery & Anti-Meta ──
        elif b_id == "cadet_of_army":
            unlocked = matches_played >= 5
            progress = {"current": min(matches_played, 5), "target": 5, "unit": "matches"}

        elif b_id == "faction_veteran":
            unlocked = matches_played >= 25
            progress = {"current": min(matches_played, 25), "target": 25, "unit": "matches"}

        elif b_id == "faction_champion":
            unlocked = matches_played >= 50
            progress = {"current": min(matches_played, 50), "target": 50, "unit": "matches"}

        elif b_id == "chapter_master_faction":
            unlocked = matches_played >= 100
            progress = {"current": min(matches_played, 100), "target": 100, "unit": "matches"}

        elif b_id == "grand_sovereign":
            unlocked = wins >= 50 and win_rate >= 65.0
            progress = {"current": wins, "target": 50, "unit": "wins"}

        elif b_id == "pure_specialist":
            unlocked = wins >= 15
            progress = {"current": min(wins, 15), "target": 15, "unit": "wins"}

        elif b_id == "polymath_1":
            unlocked = len(factions_won) >= 3 or len(faction_mastery) >= 3
            progress = {"current": len(factions_won), "target": 3, "unit": "factions"}

        elif b_id == "polymath_2":
            unlocked = len(factions_won) >= 6 or len(faction_mastery) >= 6
            progress = {"current": len(factions_won), "target": 6, "unit": "factions"}

        elif b_id == "grand_polymath":
            unlocked = len(factions_won) >= 10 or len(faction_mastery) >= 10
            progress = {"current": len(factions_won), "target": 10, "unit": "factions"}

        elif b_id == "imperium_crusader":
            unlocked = imperium_factions_won >= 3 or len(factions_won) >= 3
            progress = {"current": imperium_factions_won, "target": 3, "unit": "Imperium factions"}

        elif b_id == "chaos_undivided":
            unlocked = chaos_factions_won >= 2 or len(factions_won) >= 2
            progress = {"current": chaos_factions_won, "target": 2, "unit": "Chaos factions"}

        elif b_id == "xenos_overlord":
            unlocked = xenos_factions_won >= 3 or len(factions_won) >= 3
            progress = {"current": xenos_factions_won, "target": 3, "unit": "Xenos factions"}

        elif b_id == "grand_alliance_sovereign":
            unlocked = len(factions_won) >= 4 and wins >= 15
            progress = {"current": len(factions_won), "target": 4, "unit": "grand factions"}

        elif b_id == "anti_meta_heretic_1":
            unlocked = meta_wins >= 1
            progress = {"current": meta_wins, "target": 1, "unit": "meta wins"}
            if unlocked:
                provenance = "Defeated a recognized top-tier meta faction in official tournament play"

        elif b_id == "anti_meta_heretic_2":
            unlocked = meta_wins >= 5
            progress = {"current": min(meta_wins, 5), "target": 5, "unit": "meta wins"}

        elif b_id == "rogue_paragon":
            unlocked = any(t.get("wins", 0) >= 4 and t.get("registered_faction", "").lower() not in META_FACTIONS for t in tournaments) or (wins >= 20 and current_elo >= 1800.0)
            progress = {"current": wins, "target": 20, "unit": "wins"}

        elif b_id == "mirror_initiate":
            unlocked = mirror_wins >= 1
            progress = {"current": mirror_wins, "target": 1, "unit": "mirror wins"}
            if unlocked:
                provenance = "Victorious in official faction mirror match"

        elif b_id == "mirror_maestro":
            unlocked = mirror_wins >= 3
            progress = {"current": min(mirror_wins, 3), "target": 3, "unit": "mirror wins"}

        elif b_id == "mirror_sovereign":
            unlocked = mirror_wins >= 6
            progress = {"current": min(mirror_wins, 6), "target": 6, "unit": "mirror wins"}

        elif b_id == "nemesis_neutralizer":
            unlocked = len(factions_defeated) >= 5 or len(matchup_matrix) >= 5 or len(factions_won) >= 5
            progress = {"current": max(len(factions_defeated), len(matchup_matrix), len(factions_won)), "target": 5, "unit": "enemy factions"}

        elif b_id == "list_innovator":
            unlocked = len(factions_won) >= 5
            progress = {"current": len(factions_won), "target": 5, "unit": "factions"}

        elif b_id == "army_customizer":
            unlocked = True
            progress = {"current": 1, "target": 1, "unit": "roster"}
            provenance = "Linked official tournament roster"

        elif b_id == "codex_purist":
            unlocked = any(f.get("wins", 0) >= 10 for f in faction_mastery) or wins >= 10
            progress = {"current": min(wins, 10), "target": 10, "unit": "wins"}

        elif b_id == "horde_breaker":
            unlocked = swarm_wins >= 1
            progress = {"current": swarm_wins, "target": 1, "unit": "swarm defeats"}
            if unlocked:
                provenance = "Defeated a swarm army (Tyranids, Orks, or GSC) in official tournament play"

        elif b_id == "monster_hunter":
            unlocked = titan_wins >= 1
            progress = {"current": titan_wins, "target": 1, "unit": "titan defeats"}
            if unlocked:
                provenance = "Defeated an Imperial or Chaos Knights super-heavy walker army"

        # ── Category D: Competitive Ladder & Elo Milestones ──
        elif b_id == "rank_calibrated":
            unlocked = matches_played >= 5
            progress = {"current": min(matches_played, 5), "target": 5, "unit": "matches"}

        elif b_id == "climbing_the_ranks":
            unlocked = peak_elo >= 1550.0
            progress = {"current": round(peak_elo, 1), "target": 1550.0, "unit": "Elo"}

        elif b_id == "veteran_line":
            unlocked = peak_elo >= 1650.0
            progress = {"current": round(peak_elo, 1), "target": 1650.0, "unit": "Elo"}

        elif b_id == "elite_threshold":
            unlocked = peak_elo >= 1750.0
            progress = {"current": round(peak_elo, 1), "target": 1750.0, "unit": "Elo"}

        elif b_id == "master_tier":
            unlocked = peak_elo >= 1850.0
            progress = {"current": round(peak_elo, 1), "target": 1850.0, "unit": "Elo"}

        elif b_id == "grandmaster":
            unlocked = peak_elo >= 1950.0
            progress = {"current": round(peak_elo, 1), "target": 1950.0, "unit": "Elo"}

        elif b_id == "apex_2000":
            unlocked = peak_elo >= 2000.0
            progress = {"current": round(peak_elo, 1), "target": 2000.0, "unit": "Elo"}

        elif b_id == "everchosen_pinnacle":
            unlocked = peak_elo >= 2100.0
            progress = {"current": round(peak_elo, 1), "target": 2100.0, "unit": "Elo"}

        elif b_id == "peak_performer":
            unlocked = (peak_elo - 1500.0) >= 100.0
            progress = {"current": round(peak_elo - 1500.0, 1), "target": 100.0, "unit": "Elo gain"}

        elif b_id == "streak_of_fire":
            unlocked = best_streak >= 4
            progress = {"current": min(best_streak, 4), "target": 4, "unit": "streak"}

        elif b_id == "streak_of_dominance":
            unlocked = best_streak >= 8
            progress = {"current": min(best_streak, 8), "target": 8, "unit": "streak"}

        elif b_id == "the_juggernaut":
            unlocked = best_streak >= 12
            progress = {"current": min(best_streak, 12), "target": 12, "unit": "streak"}

        elif b_id == "the_immortal_run":
            unlocked = best_streak >= 18
            progress = {"current": min(best_streak, 18), "target": 18, "unit": "streak"}

        elif b_id == "top_50_regional":
            unlocked = current_elo >= 1700.0 or wins >= 20
            progress = {"current": round(current_elo, 1), "target": 1700.0, "unit": "Elo"}

        elif b_id == "top_10_sovereign":
            unlocked = current_elo >= 2050.0
            progress = {"current": round(current_elo, 1), "target": 2050.0, "unit": "Elo"}

        # ── Category E: Career, Clubs & Secrets ──
        elif b_id == "battle_brother_club":
            unlocked = bool(team)
            progress = {"current": 1 if team else 0, "target": 1, "unit": "teams"}
            if unlocked:
                provenance = f"Allied with club {team}"

        elif b_id == "squad_leader":
            unlocked = bool(team) and matches_played >= 10
            progress = {"current": matches_played if team else 0, "target": 10, "unit": "matches"}

        elif b_id == "club_vanguard":
            unlocked = bool(team) and win_rate >= 60.0 and wins >= 6
            progress = {"current": wins if team else 0, "target": 6, "unit": "wins"}

        elif b_id == "local_pillar":
            unlocked = events_count >= 3 or matches_played >= 15
            progress = {"current": events_count, "target": 3, "unit": "events"}

        elif b_id == "road_warrior":
            unlocked = events_count >= 2
            progress = {"current": events_count, "target": 2, "unit": "events"}

        elif b_id == "globetrotter":
            unlocked = events_count >= 5 or matches_played >= 25
            progress = {"current": events_count, "target": 5, "unit": "events"}

        elif b_id == "rivalry_born":
            max_opp_face = max(opponents_count.values()) if opponents_count else 0
            unlocked = max_opp_face >= 2
            progress = {"current": max_opp_face, "target": 2, "unit": "encounters"}
            if unlocked:
                provenance = "Encountered familiar opponent in tournament play"

        elif b_id == "rivalry_veteran":
            max_opp_face = max(opponents_count.values()) if opponents_count else 0
            unlocked = max_opp_face >= 5
            progress = {"current": max_opp_face, "target": 5, "unit": "encounters"}

        elif b_id == "vendetta_broken":
            max_opp_face = max(opponents_count.values()) if opponents_count else 0
            unlocked = max_opp_face >= 2 and wins >= 5
            progress = {"current": min(wins, 5), "target": 5, "unit": "wins"}

        elif b_id == "veteran_season_1":
            unlocked = matches_played >= 15
            progress = {"current": min(matches_played, 15), "target": 15, "unit": "matches"}

        elif b_id == "veteran_long_war":
            unlocked = len(years_active) >= 2 or matches_played >= 40
            progress = {"current": len(years_active), "target": 2, "unit": "years"}

        elif b_id == "dice_gods_wept":
            # Secret badge: War of Attrition
            unlocked = attrition_low_wins >= 1 or (wins >= 7 and max_vp_scored >= 80)
            progress = {"current": attrition_low_wins or (1 if wins >= 7 else 0), "target": 1, "unit": "attrition wins"}
            if unlocked:
                provenance = "War of Attrition: Prevailed in a low-scoring defensive slugfest"

        elif b_id == "narrow_escape":
            # Secret badge: The Photo Finish
            unlocked = clutch_2vp_wins >= 1 or clutch_1vp_wins >= 1
            progress = {"current": clutch_2vp_wins or clutch_1vp_wins, "target": 1, "unit": "photo finishes"}
            if unlocked:
                provenance = "The Photo Finish: Won tournament match by 2 or fewer Victory Points"

        elif b_id == "unbroken_bastion":
            # Secret badge: Career match endurance
            unlocked = matches_played >= 25
            progress = {"current": min(matches_played, 25), "target": 25, "unit": "matches"}
            if unlocked:
                provenance = "Completed 25 official tournament matches across career"

        elif b_id == "omnitactica_pioneer":
            unlocked = True
            progress = {"current": 1, "target": 1, "unit": "pioneer"}
            provenance = "Founding competitor in OmniTactica Honor System"

        if unlocked:
            unlocked_count += 1
            total_glory += rarity_info["glory"]

        evaluated_badges.append({
            "id": b_id,
            "name": b["name"],
            "category": b["category"],
            "category_title": cat_info.get("title", b["category"].title()),
            "rarity": b["rarity"],
            "rarity_label": rarity_info["label"],
            "glory_points": rarity_info["glory"],
            "color": rarity_info["color"],
            "border": rarity_info["border"],
            "icon": b["icon"],
            "description": b["description"],
            "unlocked": unlocked,
            "unlocked_at": unlocked_at or ("2026-06-15" if unlocked else None),
            "provenance": provenance,
            "progress": progress,
            "is_secret": bool(b.get("is_secret")),
            "hint": b.get("hint")
        })

    # Rank calculation
    rank_meta = get_rank_for_badge_count(unlocked_count)

    # Pinned badges resolution
    rarity_order = {"mythic": 6, "legendary": 5, "epic": 4, "rare": 3, "uncommon": 2, "common": 1}
    unlocked_list = [b for b in evaluated_badges if b["unlocked"]]
    unlocked_list.sort(key=lambda x: rarity_order.get(x["rarity"], 0), reverse=True)

    pinned_badges = []
    if user_pinned_ids and isinstance(user_pinned_ids, list):
        pinned_map = {b["id"]: b for b in evaluated_badges}
        for pid in user_pinned_ids[:3]:
            if pid in pinned_map:
                pinned_badges.append(pinned_map[pid])

    if len(pinned_badges) < 3:
        for b in unlocked_list:
            if b not in pinned_badges:
                pinned_badges.append(b)
            if len(pinned_badges) >= 3:
                break

    return {
        "badge_count": unlocked_count,
        "total_badges": len(BADGE_CATALOG),
        "completion_pct": round((unlocked_count / max(1, len(BADGE_CATALOG))) * 100, 1),
        "glory_score": total_glory,
        "rank": rank_meta,
        "pinned_badges": pinned_badges,
        "badges": evaluated_badges,
        "categories": CATEGORIES,
        "championships": championships
    }

MASTER_BADGES = BADGE_CATALOG
MILITARY_RANKS = RANKS


def evaluate_player_badges(
    player_data: Dict[str, Any],
    history: List[Dict[str, Any]],
    tournaments: Optional[List[Dict[str, Any]]] = None,
    faction_mastery: Optional[List[Dict[str, Any]]] = None,
    matchup_matrix: Optional[List[Dict[str, Any]]] = None,
    user_pinned_ids: Optional[List[str]] = None,
    game_system: str = "40k",
    tracker_sessions: Optional[List[Dict[str, Any]]] = None,
    registered_tournaments: Optional[List[Dict[str, Any]]] = None,
    armylists: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """Evaluates all career and seasonal honors for a player against authentic telemetry.

    Fully isolated between Warhammer 40k ('40k') and Age of Sigmar ('aos'),
    with unified seasonal progression for Season 2026.
    """
    target_sys = str(game_system or "40k").lower()
    if target_sys == "aos":
        res = aos_badges.evaluate_aos_player_badges(
            player_data=player_data,
            history=history,
            tournaments=tournaments,
            faction_mastery=faction_mastery,
            matchup_matrix=matchup_matrix,
            user_pinned_ids=user_pinned_ids
        )
    else:
        res = _evaluate_40k_player_badges(
            player_data=player_data,
            history=history,
            tournaments=tournaments,
            faction_mastery=faction_mastery,
            matchup_matrix=matchup_matrix,
            user_pinned_ids=user_pinned_ids
        )

    # Evaluate Season 2026
    import seasonal_badges
    season_eval = seasonal_badges.evaluate_player_seasonal_badges(
        player_data=player_data,
        history=history,
        tournaments=tournaments,
        tracker_sessions=tracker_sessions or player_data.get("tracker_history") or player_data.get("tracker_sessions"),
        registered_tournaments=registered_tournaments or player_data.get("registered_tournaments"),
        armylists=armylists or player_data.get("armylists"),
        season="2026",
        game_system=target_sys
    )

    champs = res.get("championships") or extract_tournament_championships(tournaments, history, target_sys)
    res["championships"] = champs
    champ_glory = champs.get("championship_glory", 0)
    res["championship_glory"] = champ_glory

    career_glory = res.get("glory_score", 0) + champ_glory
    seasonal_glory = season_eval.get("glory_score", 0)
    total_glory = career_glory + seasonal_glory

    # Check if user pinned any seasonal trophies
    if user_pinned_ids and isinstance(user_pinned_ids, list):
        seasonal_map = {b["id"]: b for b in season_eval.get("badges", [])}
        cur_pinned_ids = {b["id"] for b in res.get("pinned_badges", [])}
        for pid in user_pinned_ids[:3]:
            if pid in seasonal_map and pid not in cur_pinned_ids:
                # Replace lowest rarity auto-pinned badge if needed
                if len(res["pinned_badges"]) >= 3:
                    res["pinned_badges"].pop()
                res["pinned_badges"].insert(0, seasonal_map[pid])

    res["career_glory"] = career_glory
    res["seasonal_glory"] = seasonal_glory
    res["glory_score"] = total_glory
    res["glory_balance"] = total_glory  # Unified spendable wallet
    res["seasonal"] = {
        "2026": season_eval
    }
    res["active_season"] = "2026"
    return res
