"""OmniTactica Retribution Armory Catalog Registry.

Defines all purchasable cosmetic enhancements, dice skins, faction sigils/avatars,
munitorum titles, and interactive player pokes. Every item is 100% actionable and wired
directly into OmniTactica's frontend components (Dice Tray, Hero Card, Leaderboard, Scorecard).

Supports distinct catalogs for Warhammer 40,000 (40k) and Age of Sigmar (aos) with a
unified spendable Glory wallet balance.
"""

from typing import Dict, List, Any, Optional

# Armory Department / Wing Configurations
ARMORY_WINGS = {
    "dice_forge": {
        "id": "dice_forge",
        "title": "The Dice Forge",
        "icon": "🎲",
        "subtitle": "Dice Tray Skins & Critical Burst VFX",
        "description": "Custom die materials, pip illumination, and natural 6 critical burst particle FX in the Live Match Companion."
    },
    "profile_forge": {
        "id": "profile_forge",
        "title": "Profile Forge",
        "icon": "✨",
        "subtitle": "Holo-Foil Finishes & Card Aura Halos",
        "description": "Prismatic holo-foil overlays, molten borders, and animated prestige halos for your Hero Card and Public Profile."
    },
    "avatars": {
        "id": "avatars",
        "title": "Faction Sigils",
        "icon": "👤",
        "subtitle": "Faction Emblems & Profile Sigils",
        "description": "Official faction heraldry displayed as your active profile avatar across tournament pairings, club rosters, and match cards."
    },
    "titles": {
        "id": "titles",
        "title": "Munitorum Titles",
        "icon": "🏷️",
        "subtitle": "Equippable Player Identity Flairs",
        "description": "Tactical subtitles displayed beneath your player name on the Global Leaderboards, Tournament Pairings, and Scorecards."
    },
    "pokes": {
        "id": "pokes",
        "title": "Player Pokes",
        "icon": "👉",
        "subtitle": "Interactive Player Pokes & Table Interactions",
        "description": "Playful and competitive pokes to nudge, tease, or challenge rivals before or after tournament rounds."
    }
}

# Rarity Styling and Color Palette
ARMORY_RARITY = {
    "common": {
        "label": "Standard Requisition",
        "color": "#94a3b8",
        "border": "rgba(148, 163, 184, 0.35)",
        "badge_bg": "rgba(148, 163, 184, 0.12)"
    },
    "rare": {
        "label": "Veteran Issue",
        "color": "#38bdf8",
        "border": "rgba(56, 189, 248, 0.4)",
        "badge_bg": "rgba(56, 189, 248, 0.14)"
    },
    "epic": {
        "label": "Master Crafted",
        "color": "#c084fc",
        "border": "rgba(192, 132, 252, 0.5)",
        "badge_bg": "rgba(192, 132, 252, 0.16)"
    },
    "legendary": {
        "label": "Relic Sanctified",
        "color": "#fbbf24",
        "border": "rgba(251, 191, 36, 0.6)",
        "badge_bg": "rgba(251, 191, 36, 0.18)"
    }
}

# Master List of Requisition Items
ARMORY_ITEMS: List[Dict[str, Any]] = [
    # =========================================================================
    # WARHAMMER 40,000 (40K) REQUISITIONS
    # =========================================================================

    # ── WING 1: DICE FORGE (40K) ──
    {
        "id": "dice_warpfire_plasma",
        "name": "Warpfire Plasma Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "rare",
        "cost_glory": 150,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Cyan plasma cores with electric blue glow. Triggers an ion flare critical burst explosion on natural 6s in the Live Tracker.",
        "payload": {
            "die_bg": "linear-gradient(135deg, #0f172a 0%, #0369a1 100%)",
            "pip_color": "#38bdf8",
            "crit_particle": "warpfire_cyan",
            "crit_sound": "plasma_discharge"
        }
    },
    {
        "id": "dice_molten_magma",
        "name": "Molten Magma Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 250,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Charred volcanic basalt with fiery glowing fissures. Natural 6s unleash an erupting molten slag particle shockwave.",
        "payload": {
            "die_bg": "linear-gradient(135deg, #1c1917 0%, #b45309 100%)",
            "pip_color": "#fbbf24",
            "crit_particle": "molten_slag",
            "crit_sound": "magma_blast"
        }
    },
    {
        "id": "dice_ceramite_white",
        "name": "Sanctified Ceramite Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "rare",
        "cost_glory": 120,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Polished Imperial ceramite dice with gold leaf pips. Sanctified purity seal burst triggers on all critical wound 6s.",
        "payload": {
            "die_bg": "linear-gradient(135deg, #f8fafc 0%, #cbd5e1 100%)",
            "pip_color": "#d97706",
            "crit_particle": "golden_glory_sparks",
            "crit_sound": "chime_sanctified"
        }
    },
    {
        "id": "dice_void_obsidian",
        "name": "Void Obsidian Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "legendary",
        "cost_glory": 350,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {
            "career_crest_tier": 2,
            "label": "Requires Career Crest Tier II+"
        },
        "icon": "🎲",
        "description": "Deep void black obsidian with shifting cosmic purple undertones. Natural 6s detonate in a supernova warp shockwave.",
        "payload": {
            "die_bg": "linear-gradient(135deg, #09090b 0%, #3b0764 100%)",
            "pip_color": "#c084fc",
            "crit_particle": "void_supernova",
            "crit_sound": "void_implosion"
        }
    },

    # ── WING 2: PROFILE FORGE (40K) ──
    {
        "id": "frame_peak_veteran",
        "name": "Veteran's Iron Plate",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "common",
        "cost_glory": 75,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {
            "peak_elo": 1500.0,
            "label": "Requires All-Time Peak Elo 1500+"
        },
        "icon": "🛡️",
        "description": "Reinforced gunmetal steel plate with cold-forged corner rivets. Awarded to commanders who reached Veteran rank.",
        "payload": {
            "css_class": "frame-peak-veteran",
            "border_color": "#64748b",
            "border_glow": "0 0 14px rgba(100, 116, 139, 0.45)"
        }
    },
    {
        "id": "frame_peak_captain",
        "name": "Captain's Emerald Chevron",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {
            "peak_elo": 1600.0,
            "label": "Requires All-Time Peak Elo 1600+"
        },
        "icon": "⚔️",
        "description": "Vibrant tactical emerald green border with glowing strike company chevrons and battle honors.",
        "payload": {
            "css_class": "frame-peak-captain",
            "border_color": "#10b981",
            "border_glow": "0 0 16px rgba(16, 185, 129, 0.45)"
        }
    },
    {
        "id": "frame_peak_commander",
        "name": "Commander's Ion Sky",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "rare",
        "cost_glory": 150,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {
            "peak_elo": 1700.0,
            "label": "Requires All-Time Peak Elo 1700+"
        },
        "icon": "🌐",
        "description": "Electrified sky-blue plasma rim with sweeping sensor telemetry pulse across your profile card.",
        "payload": {
            "css_class": "frame-peak-commander",
            "border_color": "#38bdf8",
            "border_glow": "0 0 20px rgba(56, 189, 248, 0.5)"
        }
    },
    {
        "id": "frame_peak_dark_angels",
        "name": "Caliban Knight's Bastion",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "epic",
        "cost_glory": 175,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {
            "peak_elo": 1750.0,
            "label": "Requires All-Time Peak Elo 1750+"
        },
        "icon": "⚔️",
        "description": "Dark Angels dark emerald and antique silver frame with crossed sword-hilt corners and radiant Caliban green ambient halo.",
        "payload": {
            "css_class": "frame-peak-dark-angels",
            "border_color": "#059669",
            "border_glow": "0 0 22px rgba(5, 150, 105, 0.55)"
        }
    },
    {
        "id": "frame_peak_necrons",
        "name": "Necron Dynastic Gauss Rim",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "epic",
        "cost_glory": 175,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {
            "peak_elo": 1750.0,
            "label": "Requires All-Time Peak Elo 1750+"
        },
        "icon": "⏳",
        "description": "Ancient black necrodermis frame with pulsating Gauss green circuit traces and glowing dynastic hieroglyphs.",
        "payload": {
            "css_class": "frame-peak-necrons",
            "border_color": "#34d399",
            "border_glow": "0 0 22px rgba(52, 211, 153, 0.55)"
        }
    },
    {
        "id": "frame_peak_grand_marshal",
        "name": "Grand Marshal's Amethyst Halo",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "epic",
        "cost_glory": 200,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {
            "peak_elo": 1800.0,
            "label": "Requires All-Time Peak Elo 1800+"
        },
        "icon": "👑",
        "description": "Royal purple auric frame with ambient amethyst halo. Proclaiming commanding tabletop supremacy.",
        "payload": {
            "css_class": "frame-peak-grand-marshal",
            "border_color": "#c084fc",
            "border_glow": "0 0 24px rgba(192, 132, 252, 0.6)"
        }
    },
    {
        "id": "frame_peak_high_warlord",
        "name": "High Warlord's Crucible",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "epic",
        "cost_glory": 225,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {
            "peak_elo": 1850.0,
            "label": "Requires All-Time Peak Elo 1850+"
        },
        "icon": "🔥",
        "description": "Pulsing volcanic molten basalt border with glowing ember slag trim, forged in high tournament warfare.",
        "payload": {
            "css_class": "frame-peak-high-warlord",
            "border_color": "#fb923c",
            "border_glow": "0 0 25px rgba(251, 146, 60, 0.65)"
        }
    },
    {
        "id": "frame_peak_warmaster",
        "name": "Warmaster's Blood-Iron",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "legendary",
        "cost_glory": 275,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {
            "peak_elo": 1900.0,
            "label": "Requires All-Time Peak Elo 1900+"
        },
        "icon": "🩸",
        "description": "Barbed crimson-and-black iron frame with radiating chaos warp flare. The mark of true warlords.",
        "payload": {
            "css_class": "frame-peak-warmaster",
            "border_color": "#f43f5e",
            "border_glow": "0 0 28px rgba(244, 63, 94, 0.7)"
        }
    },
    {
        "id": "frame_peak_primarch",
        "name": "Primarch's Celestial Corona",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "legendary",
        "cost_glory": 350,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {
            "peak_elo": 2000.0,
            "label": "Requires All-Time Peak Elo 2000+"
        },
        "icon": "⚡",
        "description": "Prismatic celestial cyan and indigo corona with radiant solar rays. For demigods of the competitive meta.",
        "payload": {
            "css_class": "frame-peak-primarch",
            "border_color": "#38bdf8",
            "border_glow": "0 0 32px rgba(56, 189, 248, 0.75), inset 0 0 16px rgba(129, 140, 248, 0.3)"
        }
    },
    {
        "id": "frame_peak_everchosen",
        "name": "Apex Everchosen's Dominion",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "legendary",
        "cost_glory": 500,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {
            "peak_elo": 2200.0,
            "label": "Requires All-Time Peak Elo 2200+"
        },
        "icon": "👑",
        "description": "Relic 24k gold foil filigree with mythic pulsing aura and crown insignias. The ultimate competitive pinnacle.",
        "payload": {
            "css_class": "frame-peak-everchosen",
            "border_color": "#fbbf24",
            "border_glow": "0 0 35px rgba(251, 191, 36, 0.85), inset 0 0 20px rgba(244, 63, 94, 0.25)"
        }
    },
    {
        "id": "frame_astral_holofoil",
        "name": "Astral Holo-Foil Finish",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "epic",
        "cost_glory": 200,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "✨",
        "description": "Shimmering prismatic diffraction sheen across your Hero Profile Card. Bends ambient light as you tilt or inspect.",
        "payload": {
            "css_class": "frame-astral-holofoil",
            "border_glow": "0 0 25px rgba(236, 72, 153, 0.45)"
        }
    },
    {
        "id": "frame_cyber_matrix",
        "name": "Tactica Cyber-Matrix",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "rare",
        "cost_glory": 140,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🌐",
        "description": "Neo-cyber cyan grid lines with scanner sweep pulse across your profile header and live scorecard.",
        "payload": {
            "css_class": "frame-cyber-matrix",
            "border_glow": "0 0 20px rgba(56, 189, 248, 0.45)"
        }
    },
    {
        "id": "frame_warp_corruption",
        "name": "Warp Tendril Corruption",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "legendary",
        "cost_glory": 300,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {
            "career_crest_tier": 3,
            "label": "Requires Career Crest Tier III+"
        },
        "icon": "🔮",
        "description": "Shifting purple-magenta chaotic tendrils radiating from your hero card border. For servants of Chaos and dark renegades.",
        "payload": {
            "css_class": "frame-warp-corruption",
            "border_glow": "0 0 30px rgba(168, 85, 247, 0.6)"
        }
    },

    # ── WING 3: FACTION SIGILS & AVATARS (40K) ──
    {
        "id": "avatar_dark_angels",
        "name": "Dark Angels Winged Sword",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "⚔️",
        "description": "The sacred downward broadsword of Caliban flanked by dark emerald angelic wings. Unforgiven standard of the First Legion.",
        "payload": {
            "avatar_icon": "⚔️",
            "faction": "Dark Angels",
            "badge_color": "#10b981"
        }
    },
    {
        "id": "avatar_necrons",
        "name": "Necron Triarch Ankh",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "⏳",
        "description": "The undying dynastic hieroglyphic ankh cartouche glowing with Gauss-green eldritch eternity. Sovereign sigil of the Silent King.",
        "payload": {
            "avatar_icon": "⏳",
            "faction": "Necrons",
            "badge_color": "#34d399"
        }
    },
    {
        "id": "avatar_adeptus_astartes",
        "name": "Imperial Aquila",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🛡️",
        "description": "The double-headed Imperial Eagle of the Space Marines with crowned and blind heads, clutching the thunderbolts of the Imperium.",
        "payload": {
            "avatar_icon": "🛡️",
            "faction": "Adeptus Astartes",
            "badge_color": "#fbbf24"
        }
    },
    {
        "id": "avatar_chaos_space_marines",
        "name": "Star of Chaos Undivided",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🩸",
        "description": "The barbed eight-pointed star of Chaos Undivided surrounding a horned daemon skull burning with crimson warp flame.",
        "payload": {
            "avatar_icon": "🩸",
            "faction": "Chaos Space Marines",
            "badge_color": "#ef4444"
        }
    },
    {
        "id": "avatar_orks",
        "name": "Ork Iron Gob & WAAAGH! Skull",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "💥",
        "description": "A savage green Ork skull wearing a riveted iron jaw plate with jagged steel teeth and a slash of 'Go Fasta' red warpaint.",
        "payload": {
            "avatar_icon": "💥",
            "faction": "Orks",
            "badge_color": "#22c55e"
        }
    },
    {
        "id": "avatar_black_templars",
        "name": "Black Templars Maltese Cross",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "✝️",
        "description": "The sharp black and silver crusader cross with holy iron rivets and centered skull relic. Suffer not the unclean to live.",
        "payload": {
            "avatar_icon": "✝️",
            "faction": "Black Templars",
            "badge_color": "#f8fafc"
        }
    },
    {
        "id": "avatar_blood_angels",
        "name": "Blood Angels Winged Drop",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🩸",
        "description": "Graceful angelic golden wings framing a multifaceted glowing ruby blood teardrop, honoring the sacrifice of Sanguinius.",
        "payload": {
            "avatar_icon": "🩸",
            "faction": "Blood Angels",
            "badge_color": "#f43f5e"
        }
    },
    {
        "id": "avatar_space_wolves",
        "name": "Space Wolves Iron Wolf",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🐺",
        "description": "The fearsome silhouette of the dire wolf that stalks the stars with bared fangs and a piercing Fenrisian frost-blue eye.",
        "payload": {
            "avatar_icon": "🐺",
            "faction": "Space Wolves",
            "badge_color": "#38bdf8"
        }
    },
    {
        "id": "avatar_adeptus_custodes",
        "name": "Auramite Custodes Raptor",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "epic",
        "cost_glory": 150,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🦅",
        "description": "Majestic auramite raptor eagle of the Emperor's Bodyguard, encircled with solar halo rays and lightning bundles.",
        "payload": {
            "avatar_icon": "🦅",
            "faction": "Adeptus Custodes",
            "badge_color": "#fbbf24"
        }
    },
    {
        "id": "avatar_adeptus_mechanicus",
        "name": "Mechanicus Opus Machina",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "⚙️",
        "description": "The sacred half-human, half-bionic skull enclosed inside the 16-toothed crimson and white cog of the Omnissiah.",
        "payload": {
            "avatar_icon": "⚙️",
            "faction": "Adeptus Mechanicus",
            "badge_color": "#ef4444"
        }
    },
    {
        "id": "avatar_tyranids",
        "name": "Hive Mind Synapse Carapace",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🧬",
        "description": "Interlocking bio-chitinous exoskeleton shell plates with ribbed horns and pulsating lime/magenta psychic synapse nodes.",
        "payload": {
            "avatar_icon": "🧬",
            "faction": "Tyranids",
            "badge_color": "#a855f7"
        }
    },
    {
        "id": "avatar_tau_empire",
        "name": "T'au Fire Caste Sept Mark",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "⚪",
        "description": "The aerodynamic segmented caste disc with precision aerodynamic cutouts and ochre core of the Greater Good.",
        "payload": {
            "avatar_icon": "⚪",
            "faction": "T'au Empire",
            "badge_color": "#ea580c"
        }
    },
    {
        "id": "avatar_aeldari",
        "name": "Aeldari Rune of Ulthwé",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🧝",
        "description": "Graceful psychoplastic wraithbone rune with curved crests and a radiant celestial spirit stone glowing with ancient starlight.",
        "payload": {
            "avatar_icon": "🧝",
            "faction": "Aeldari",
            "badge_color": "#38bdf8"
        }
    },
    {
        "id": "avatar_death_guard",
        "name": "Death Guard Corroded Helm",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🪰",
        "description": "Corroded dark bronze Mark III power armour helmet with toxic orange visor and the three rotting spheres of Grandfather Nurgle.",
        "payload": {
            "avatar_icon": "🪰",
            "faction": "Death Guard",
            "badge_color": "#84cc16"
        }
    },

    # ── WING 4: MUNITORUM TITLES (40K) ──
    {
        "id": "title_bane_of_warp",
        "name": "Bane of the Warp",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "common",
        "cost_glory": 75,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Title subtitle displayed under your name: 'BANE OF THE WARP'. Marks your prowess against psychic and daemon threats.",
        "payload": {
            "title_text": "Bane of the Warp",
            "css_class": "title-badge-warp"
        }
    },
    {
        "id": "title_forge_father",
        "name": "Forge Father",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 110,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Title subtitle displayed under your name: 'FORGE FATHER'. Sacred rank of mechanised assault and armoured dreadnoughts.",
        "payload": {
            "title_text": "Forge Father",
            "css_class": "title-badge-forge"
        }
    },
    {
        "id": "title_grand_strategist",
        "name": "Grand Strategist",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "epic",
        "cost_glory": 180,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Title subtitle displayed under your name: 'GRAND STRATEGIST'. Honoring master tacticians with supreme secondary objective execution.",
        "payload": {
            "title_text": "Grand Strategist",
            "css_class": "title-badge-strategist"
        }
    },
    {
        "id": "title_unbroken",
        "name": "The Unbroken",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "legendary",
        "cost_glory": 250,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {
            "career_crest_tier": 2,
            "label": "Requires Career Crest Tier II+"
        },
        "icon": "🏷️",
        "description": "Prestigious title: 'THE UNBROKEN'. Sanctified in gold foil script on your player profile and match result sheets.",
        "payload": {
            "title_text": "The Unbroken",
            "css_class": "title-badge-unbroken"
        }
    },
    {
        "id": "title_angel_of_death",
        "name": "Angel of Death",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 125,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Title subtitle: 'ANGEL OF DEATH'. The fearsome moniker bestowed upon the Emperor's foremost warriors.",
        "payload": {
            "title_text": "Angel of Death",
            "css_class": "title-badge-death"
        }
    },
    {
        "id": "title_warmaster",
        "name": "Warmaster of Chaos",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "epic",
        "cost_glory": 200,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Title subtitle: 'WARMASTER OF CHAOS'. Proclaiming supreme dominion over the Long War and tabletop ruin.",
        "payload": {
            "title_text": "Warmaster of Chaos",
            "css_class": "title-badge-chaos"
        }
    },
    {
        "id": "title_phaeron",
        "name": "Phaeron of the Infinite",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "epic",
        "cost_glory": 200,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Title subtitle: 'PHAERON OF THE INFINITE'. Ruler of dynastic tombs and master of sovereign eternity.",
        "payload": {
            "title_text": "Phaeron of the Infinite",
            "css_class": "title-badge-necron"
        }
    },
    {
        "id": "title_da_biggest_boss",
        "name": "Da Biggest Boss",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 125,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Title subtitle: 'DA BIGGEST BOSS'. Demands respect across da entire gaming club and WAAAGH! horde.",
        "payload": {
            "title_text": "Da Biggest Boss",
            "css_class": "title-badge-ork"
        }
    },
    {
        "id": "title_shield_captain",
        "name": "Shield-Captain",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 130,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Title subtitle: 'SHIELD-CAPTAIN'. Guardian of the Golden Throne and tactical commander of demigods.",
        "payload": {
            "title_text": "Shield-Captain",
            "css_class": "title-badge-custodes"
        }
    },

    # ── WING 5: PLAYER POKES (40K) ──
    {
        "id": "poke_inquisition_smite",
        "name": "Inquisitorial Smite Poke (5x Pack)",
        "game_system": "40k",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "common",
        "cost_glory": 25,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "⚡",
        "description": "Poke a player with a miniature psychic reprimand for suspected heresy! Triggers an animated lightning spark toast on their device.",
        "payload": {
            "verb": "Smited",
            "icon": "⚡",
            "toast_message": "⚡ An Inquisitorial Smite descends upon you! Purge the alien, the mutant, the heretic!",
            "css_glow": "#38bdf8"
        }
    },
    {
        "id": "poke_waaagh_club",
        "name": "WAAAGH! Krump Poke (5x Pack)",
        "game_system": "40k",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "common",
        "cost_glory": 25,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🏏",
        "description": "Poke a rival with a noisy foam choppa to hurry up their movement phase or celebrate a brutal charge!",
        "payload": {
            "verb": "Krumped",
            "icon": "🏏",
            "toast_message": "🏏 WAAAGH! A rival Ork commander krumped you across the ear! Roll faster ya git!",
            "css_glow": "#22c55e"
        }
    },
    {
        "id": "poke_commissar_stare",
        "name": "Commissar Death Glare (5x Pack)",
        "game_system": "40k",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "common",
        "cost_glory": 25,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "👁️",
        "description": "Poke an opponent with an unblinking, stern Commissarial gaze reminding them to take their Battle-shock tests.",
        "payload": {
            "verb": "Glared",
            "icon": "👁️",
            "toast_message": "👁️ The Commissar glares at you with icy judgement. Failure is not an option.",
            "css_glow": "#ef4444"
        }
    },
    {
        "id": "poke_nurgle_sneeze",
        "name": "Nurgle's Blessing Poke (5x Pack)",
        "game_system": "40k",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "common",
        "cost_glory": 25,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🪰",
        "description": "Poke an opponent with a friendly cloud of buzzing flies and foul grandfatherly warmth.",
        "payload": {
            "verb": "Blessed",
            "icon": "🪰",
            "toast_message": "🪰 Grandfather Nurgle sneezes a shower of buzzing flies upon your dice!",
            "css_glow": "#84cc16"
        }
    },

    # =========================================================================
    # AGE OF SIGMAR (AOS) REQUISITIONS
    # =========================================================================

    # ── WING 1: DICE FORGE (AOS) ──
    {
        "id": "dice_celestial_sigmarite",
        "name": "Celestial Sigmarite Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 220,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Azyrite gold alloy with crackling blue celestial lightning. Natural 6s detonate a heavenly thunderburst.",
        "payload": {
            "die_bg": "linear-gradient(135deg, #1e3a8a 0%, #d97706 100%)",
            "pip_color": "#fef08a",
            "crit_particle": "celestial_lightning",
            "crit_sound": "thunder_strike"
        }
    },
    {
        "id": "dice_death_bone",
        "name": "Ossiarch Death Bone Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "rare",
        "cost_glory": 140,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Carved from enchanted tithe-bone from Shyish. Critical rolls glow with pale amethyst spectral luminescence.",
        "payload": {
            "die_bg": "linear-gradient(135deg, #27272a 0%, #581c87 100%)",
            "pip_color": "#e9d5ff",
            "crit_particle": "spectral_amethyst",
            "crit_sound": "bone_rattle"
        }
    },

    # ── WING 2: PROFILE FORGE (AOS) ──
    {
        "id": "frame_realm_chamon",
        "name": "Realm of Chamon Quicksilver Frame",
        "game_system": "aos",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "epic",
        "cost_glory": 190,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "✨",
        "description": "Alchemical liquid gold and shimmering quicksilver trim shifting dynamically around your Mortal Realms profile card.",
        "payload": {
            "css_class": "frame-realm-chamon",
            "border_glow": "0 0 24px rgba(234, 179, 8, 0.55)"
        }
    },
    {
        "id": "frame_ghur_feral",
        "name": "Ghur Feral Amber Border",
        "game_system": "aos",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "rare",
        "cost_glory": 150,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🐾",
        "description": "Primal amber-bone and beast claw frame radiating the fierce savagery of the Realm of Beasts.",
        "payload": {
            "css_class": "frame-ghur-feral",
            "border_glow": "0 0 20px rgba(217, 119, 6, 0.5)"
        }
    },

    # ── WING 3: FACTION SIGILS & AVATARS (AOS) ──
    {
        "id": "avatar_stormcast_eternals",
        "name": "Twin-Tailed Comet",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🔨",
        "description": "Sigmar's celestial twin-tailed herald of reforging and celestial justice across the Mortal Realms.",
        "payload": {
            "avatar_icon": "🔨",
            "faction": "Stormcast Eternals",
            "badge_color": "#fbbf24"
        }
    },
    {
        "id": "avatar_khorne_bloodbound",
        "name": "Khorne Skull Rune",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "💀",
        "description": "Blood for the Blood God! The eight-tiered brass rune carved in gore and glory.",
        "payload": {
            "avatar_icon": "💀",
            "faction": "Blades of Khorne",
            "badge_color": "#ef4444"
        }
    },
    {
        "id": "avatar_gloomspite_gitz",
        "name": "Grinning Bad Moon",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🌙",
        "description": "Da manic cackling visage of da Bad Moon beaming fungal madness and lunatic luck down upon your grots.",
        "payload": {
            "avatar_icon": "🌙",
            "faction": "Gloomspite Gitz",
            "badge_color": "#eab308"
        }
    },
    {
        "id": "avatar_soulblight_gravelords",
        "name": "Soulblight Crimson Bat Crest",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🦇",
        "description": "Aristocratic vampiric crest of the Kastelai and Vyrkos bloodlines ruling the night.",
        "payload": {
            "avatar_icon": "🦇",
            "faction": "Soulblight Gravelords",
            "badge_color": "#dc2626"
        }
    },
    {
        "id": "avatar_sylvaneth",
        "name": "Sylvaneth Spirit-Pod Heart",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🍃",
        "description": "Living ironbark soul-rune resonant with the Spirit Song of Alarielle.",
        "payload": {
            "avatar_icon": "🍃",
            "faction": "Sylvaneth",
            "badge_color": "#22c55e"
        }
    },

    # ── WING 4: MUNITORUM TITLES (AOS) ──
    {
        "id": "title_lord_celestant",
        "name": "Lord-Celestant",
        "game_system": "aos",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 120,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Title subtitle: 'LORD-CELESTANT'. The noble commanders of the Sigmarite Stormhosts.",
        "payload": {
            "title_text": "Lord-Celestant",
            "css_class": "title-badge-stormcast"
        }
    },
    {
        "id": "title_everchosen_herald",
        "name": "Herald of the Everchosen",
        "game_system": "aos",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "epic",
        "cost_glory": 190,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Title subtitle: 'HERALD OF THE EVERCHOSEN'. Direct herald of Archaon bearing doom across the realms.",
        "payload": {
            "title_text": "Herald of the Everchosen",
            "css_class": "title-badge-everchosen"
        }
    },
    {
        "id": "title_ghoul_king",
        "name": "Abhorrant Ghoul King",
        "game_system": "aos",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 110,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Title subtitle: 'ABHORRANT GHOUL KING'. High chivalry masked by flesh-eating madness.",
        "payload": {
            "title_text": "Abhorrant Ghoul King",
            "css_class": "title-badge-ghoul"
        }
    },
    {
        "id": "title_bad_moon_chosen",
        "name": "Touched by da Bad Moon",
        "game_system": "aos",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 125,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Title subtitle: 'TOUCHED BY DA BAD MOON'. Blessed with lunatic cunning and spored shrooms.",
        "payload": {
            "title_text": "Touched by da Bad Moon",
            "css_class": "title-badge-badmoon"
        }
    },

    # ── WING 5: PLAYER POKES (AOS) ──
    {
        "id": "poke_sigmar_bolt",
        "name": "Azyrite Lightning Zap (5x Pack)",
        "game_system": "aos",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "common",
        "cost_glory": 25,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "⚡",
        "description": "Zaps target rival with a playful celestial spark of Azyrite thunder! Shakes their screen with golden sparks.",
        "payload": {
            "verb": "Zapped",
            "icon": "⚡",
            "toast_message": "⚡ A celestial Azyrite jolt crackles through your armor! Sigmar demands action!",
            "css_glow": "#fbbf24"
        }
    },
    {
        "id": "poke_squig_nibble",
        "name": "Squig Nibble Poke (5x Pack)",
        "game_system": "aos",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "common",
        "cost_glory": 25,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🍄",
        "description": "Releases a hungry bouncing red squig to playfully bite the ankles of an opposing general!",
        "payload": {
            "verb": "Nibbled",
            "icon": "🍄",
            "toast_message": "🍄 CHOMP! A runaway red squig bounded across the table and bit your leg!",
            "css_glow": "#ef4444"
        }
    }
]

# Quick Map for O(1) Catalog Lookups across all systems
ARMORY_INDEX: Dict[str, Dict[str, Any]] = {item["id"]: item for item in ARMORY_ITEMS}


def get_armory_catalog(
    user_vault: Optional[Dict[str, Any]] = None,
    user_crest_tier: int = 1,
    game_system: str = "40k",
    user_peak_elo: float = 1500.0
) -> Dict[str, Any]:
    """Returns the game-specific Armory catalog with user ownership flags, equipped status, and affordability."""
    vault = user_vault or {"inventory": {}, "equipped": {}}
    inventory = vault.get("inventory") or {}
    equipped = vault.get("equipped") or {}

    req_sys = (game_system or "40k").lower().strip()
    if req_sys not in ("40k", "aos"):
        req_sys = "40k"

    # Filter items by the requested game system
    system_items = [item for item in ARMORY_ITEMS if item.get("game_system") == req_sys]

    items_output = []
    for item in system_items:
        item_id = item["id"]
        is_owned = item_id in inventory
        is_equipped = False
        slot = item.get("slot")
        if slot and equipped.get(slot) == item_id:
            is_equipped = True

        # Check prerequisite (Crest Tier and All-Time Peak Elo)
        prereq = item.get("prerequisite")
        meets_prereq = True
        prereq_reason = None
        if prereq:
            req_tier = prereq.get("career_crest_tier")
            if req_tier is not None and user_crest_tier < req_tier:
                meets_prereq = False
                prereq_reason = prereq.get("label", f"Requires Crest Tier {req_tier}+")

            req_peak = prereq.get("peak_elo")
            if req_peak is not None and user_peak_elo < req_peak:
                meets_prereq = False
                prereq_reason = prereq.get("label", f"Requires All-Time Peak Elo {req_peak:.0f}+ (Your Peak: {user_peak_elo:.0f})")

        item_copy = dict(item)
        item_copy["is_owned"] = is_owned
        item_copy["is_equipped"] = is_equipped
        item_copy["meets_prerequisite"] = meets_prereq
        item_copy["prerequisite_reason"] = prereq_reason
        if item.get("is_consumable"):
            item_copy["charges_remaining"] = inventory.get(item_id, {}).get("quantity", 0) if is_owned else 0

        items_output.append(item_copy)

    return {
        "game_system": req_sys,
        "wings": ARMORY_WINGS,
        "rarity_config": ARMORY_RARITY,
        "items": items_output,
        "total_items": len(items_output)
    }


ARMORY_ALIASES: Dict[str, str] = {
    "avatar_40k_ultramarines": "avatar_adeptus_astartes",
    "avatar_40k_world_eaters": "avatar_chaos_space_marines",
    "avatar_40k_necrons": "avatar_necrons",
    "avatar_40k_orks": "avatar_orks",
    "avatar_40k_custodes": "avatar_adeptus_custodes",
    "avatar_aos_stormcast": "avatar_stormcast_eternals",
    "avatar_aos_gloomspite": "avatar_gloomspite_gitz",
    "frame_molten_core": "frame_peak_high_warlord"
}


def get_item_by_id(item_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve an item by its unique ID with alias resolution."""
    if not item_id:
        return None
    canonical = ARMORY_ALIASES.get(item_id, item_id)
    return ARMORY_INDEX.get(canonical) or ARMORY_INDEX.get(item_id)
