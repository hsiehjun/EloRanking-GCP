"""
OmniTactica Retribution Armory - Master Product Catalog
Supports game-specific multi-system isolation (Warhammer 40,000 & Age of Sigmar),
Peak Elo cosmetic locking, authentic faction vector avatars, custom 6-face faction dice,
and calibrated Glory Honor pricing.
"""

from typing import Dict, List, Optional, Any

# Rarity Styling Configuration
ARMORY_RARITY: Dict[str, Dict[str, Any]] = {
    "common": {
        "label": "Standard Issue",
        "color": "#94a3b8",
        "badge_bg": "rgba(148, 163, 184, 0.12)",
        "border": "rgba(148, 163, 184, 0.25)"
    },
    "rare": {
        "label": "Veteran Issue",
        "color": "#38bdf8",
        "badge_bg": "rgba(56, 189, 248, 0.12)",
        "border": "rgba(56, 189, 248, 0.3)"
    },
    "epic": {
        "label": "Master-Crafted",
        "color": "#c084fc",
        "badge_bg": "rgba(192, 132, 252, 0.14)",
        "border": "rgba(192, 132, 252, 0.35)"
    },
    "legendary": {
        "label": "Relic Sanctified",
        "color": "#fbbf24",
        "badge_bg": "rgba(251, 191, 36, 0.15)",
        "border": "rgba(251, 191, 36, 0.45)"
    }
}

ARMORY_WINGS: Dict[str, Dict[str, Any]] = {
    "dice_forge": {
        "id": "dice_forge",
        "name": "Dice Forge",
        "icon": "🎲",
        "description": "Faction-specific & elemental dice skins with custom 6th-face critical sigils."
    },
    "profile_forge": {
        "id": "profile_forge",
        "name": "Profile Forge",
        "icon": "✨",
        "description": "Prestige card frames locked behind career all-time peak Elo ratings."
    },
    "avatars": {
        "id": "avatars",
        "name": "Faction Sigils",
        "icon": "🛡️",
        "description": "Authentic vector heraldic crests for all 40K and AoS factions."
    },
    "titles": {
        "id": "titles",
        "name": "Titles",
        "icon": "🏷️",
        "description": "Lore-accurate competitive honorifics displayed on player profiles."
    },
    "pokes": {
        "id": "pokes",
        "name": "Player Pokes",
        "icon": "👉",
        "description": "Consumable social banter interactions with custom toast notifications and sounds."
    }
}

# =========================================================================
# MASTER PRODUCT CATALOG LIST
# =========================================================================
ARMORY_ITEMS: List[Dict[str, Any]] = [
    # =====================================================================
    # WARHAMMER 40,000 (40K) STORE
    # =====================================================================

    # ── WING 1: DICE FORGE (40K) ──
    # Classic Material Dice:
    {
        "id": "dice_warpfire_plasma",
        "name": "Warpfire Plasma Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "rare",
        "cost_glory": 750,
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
        "id": "dice_ceramite_white",
        "name": "Sanctified Ceramite Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "rare",
        "cost_glory": 750,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Polished Imperial ceramite dice with gold leaf pips. Sanctified purity seal burst triggers on all critical 6s.",
        "payload": {
            "die_bg": "linear-gradient(135deg, #f8fafc 0%, #cbd5e1 100%)",
            "pip_color": "#d97706",
            "crit_particle": "golden_glory_sparks",
            "crit_sound": "chime_sanctified"
        }
    },
    {
        "id": "dice_molten_magma",
        "name": "Molten Magma Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 1150,
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
        "id": "dice_void_obsidian",
        "name": "Void Obsidian Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "legendary",
        "cost_glory": 1650,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {"career_crest_tier": 2, "label": "Requires Career Crest Tier II+"},
        "icon": "🎲",
        "description": "Polished black glass from the Eye of Terror with iridescent violet facets. Releasing gravitational distortion waves on natural 6s.",
        "payload": {
            "die_bg": "linear-gradient(135deg, #09090b 0%, #4c1d95 100%)",
            "pip_color": "#c084fc",
            "crit_particle": "gravity_distortion",
            "crit_sound": "void_implosion"
        }
    },

    # Faction-Specific Dice (with custom 6th-face sigil!):
    {
        "id": "dice_40k_dark_angels",
        "name": "Dark Angels Caliban Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Deep Caliban forest green dice with bone-white pips. Features the sacred Winged Sword on the 6th face!",
        "payload": {
            "faction": "Dark Angels",
            "die_bg": "linear-gradient(135deg, #022c22 0%, #064e3b 100%)",
            "pip_color": "#fef08a",
            "six_face_svg_id": "avatar_dark_angels",
            "six_face_label": "Winged Sword",
            "crit_particle": "caliban_emerald_flare",
            "crit_sound": "blade_shing"
        }
    },
    {
        "id": "dice_40k_ultramarines",
        "name": "Ultramarines Macragge Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Macragge royal blue dice with auric gold pips. Features the Imperial Aquila and Ultima mark on the 6th face!",
        "payload": {
            "faction": "Adeptus Astartes",
            "die_bg": "linear-gradient(135deg, #172554 0%, #1e40af 100%)",
            "pip_color": "#fde047",
            "six_face_svg_id": "avatar_adeptus_astartes",
            "six_face_label": "Imperial Aquila",
            "crit_particle": "ultramar_gold_radiance",
            "crit_sound": "aquila_cry"
        }
    },
    {
        "id": "dice_40k_necrons",
        "name": "Necron Dynastic Gauss Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Black necrodermis dice with Gauss emerald pips. Displays the Triarch Ankh hieroglyph on the 6th face!",
        "payload": {
            "faction": "Necrons",
            "die_bg": "linear-gradient(135deg, #022c22 0%, #0f172a 100%)",
            "pip_color": "#10b981",
            "six_face_svg_id": "avatar_necrons",
            "six_face_label": "Triarch Ankh",
            "crit_particle": "gauss_vaporization",
            "crit_sound": "gauss_flayer"
        }
    },
    {
        "id": "dice_40k_chaos",
        "name": "Chaos Undivided Warp Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Blackened iron dice with blood-red pips. Features the Eight-Pointed Star of Chaos on the 6th face!",
        "payload": {
            "faction": "Chaos Space Marines",
            "die_bg": "linear-gradient(135deg, #18181b 0%, #7f1d1d 100%)",
            "pip_color": "#f87171",
            "six_face_svg_id": "avatar_chaos_space_marines",
            "six_face_label": "Chaos Star",
            "crit_particle": "warpfire_burst",
            "crit_sound": "warp_howl"
        }
    },
    {
        "id": "dice_40k_orks",
        "name": "Ork WAAAGH! Krumpin' Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Rough scrap metal green dice with yellow tooth pips. Features the Iron Gob skull on the 6th face!",
        "payload": {
            "faction": "Orks",
            "die_bg": "linear-gradient(135deg, #14532d 0%, #166534 100%)",
            "pip_color": "#fef08a",
            "six_face_svg_id": "avatar_orks",
            "six_face_label": "Iron Gob",
            "crit_particle": "ork_dakka_sparks",
            "crit_sound": "waaagh_yell"
        }
    },
    {
        "id": "dice_40k_blood_angels",
        "name": "Blood Angels Baal Crimson Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Baal ruby crimson dice with golden pips. Features the Winged Blood Drop of Sanguinius on the 6th face!",
        "payload": {
            "faction": "Blood Angels",
            "die_bg": "linear-gradient(135deg, #450a0a 0%, #991b1b 100%)",
            "pip_color": "#fde047",
            "six_face_svg_id": "avatar_blood_angels",
            "six_face_label": "Winged Blood Drop",
            "crit_particle": "angelic_ruby_burst",
            "crit_sound": "blade_shing"
        }
    },
    {
        "id": "dice_40k_black_templars",
        "name": "Black Templars Crusade Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Bone ivory dice with black crusader pips. Features the holy Maltese Cross on the 6th face!",
        "payload": {
            "faction": "Black Templars",
            "die_bg": "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
            "pip_color": "#09090b",
            "six_face_svg_id": "avatar_black_templars",
            "six_face_label": "Maltese Cross",
            "crit_particle": "zealot_flame",
            "crit_sound": "templar_chant"
        }
    },
    {
        "id": "dice_40k_custodes",
        "name": "Adeptus Custodes Auramite Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "legendary",
        "cost_glory": 1650,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Solid 24k auramite gold metallic dice with crimson pips. Displays the Imperial Raptor on the 6th face!",
        "payload": {
            "faction": "Adeptus Custodes",
            "die_bg": "linear-gradient(135deg, #78350f 0%, #eab308 100%)",
            "pip_color": "#ef4444",
            "six_face_svg_id": "avatar_adeptus_custodes",
            "six_face_label": "Custodes Raptor",
            "crit_particle": "auramite_solar_burst",
            "crit_sound": "guardian_spear"
        }
    },
    {
        "id": "dice_40k_space_wolves",
        "name": "Space Wolves Fenrisian Frost Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Slate blizzard storm grey dice with frost cyan pips. Displays the Wolf of Fenris on the 6th face!",
        "payload": {
            "faction": "Space Wolves",
            "die_bg": "linear-gradient(135deg, #1e293b 0%, #475569 100%)",
            "pip_color": "#38bdf8",
            "six_face_svg_id": "avatar_space_wolves",
            "six_face_label": "Iron Wolf",
            "crit_particle": "fenris_frost_shards",
            "crit_sound": "wolf_howl"
        }
    },
    {
        "id": "dice_40k_tyranids",
        "name": "Tyranid Hive Mind Synapse Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Bio-chitin purple dice with bio-acid green pips. Displays the Synapse Carapace crest on the 6th face!",
        "payload": {
            "faction": "Tyranids",
            "die_bg": "linear-gradient(135deg, #3b0764 0%, #581c87 100%)",
            "pip_color": "#a3e635",
            "six_face_svg_id": "avatar_tyranids",
            "six_face_label": "Synapse Carapace",
            "crit_particle": "bio_acid_spray",
            "crit_sound": "tyranid_screech"
        }
    },
    {
        "id": "dice_40k_tau",
        "name": "T'au Empire Sept Enclave Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Clean Vior'la white dice with cyan targeting telemetry pips. Displays the Fire Caste Sept Mark on the 6th face!",
        "payload": {
            "faction": "T'au Empire",
            "die_bg": "linear-gradient(135deg, #f8fafc 0%, #cbd5e1 100%)",
            "pip_color": "#0284c7",
            "six_face_svg_id": "avatar_tau_empire",
            "six_face_label": "Fire Caste Mark",
            "crit_particle": "pulse_rifle_cyan",
            "crit_sound": "railgun_shot"
        }
    },
    {
        "id": "dice_40k_aeldari",
        "name": "Aeldari Spirit-Stone Amber Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Craftworld deep teal dice with glowing psychic amber pips. Displays the Rune of Ulthwé on the 6th face!",
        "payload": {
            "faction": "Aeldari",
            "die_bg": "linear-gradient(135deg, #042f2e 0%, #0d9488 100%)",
            "pip_color": "#fbbf24",
            "six_face_svg_id": "avatar_aeldari",
            "six_face_label": "Rune of Ulthwé",
            "crit_particle": "shuriken_psychic_storm",
            "crit_sound": "shuriken_fire"
        }
    },
    {
        "id": "dice_40k_mechanicus",
        "name": "Adeptus Mechanicus Mars Cog Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Martian iron rust-red dice with binary silver pips. Displays the Opus Machina cog on the 6th face!",
        "payload": {
            "faction": "Adeptus Mechanicus",
            "die_bg": "linear-gradient(135deg, #450a0a 0%, #b91c1c 100%)",
            "pip_color": "#f8fafc",
            "six_face_svg_id": "avatar_adeptus_mechanicus",
            "six_face_label": "Opus Machina",
            "crit_particle": "rad_cleansing_hiss",
            "crit_sound": "canticle_binharic"
        }
    },
    {
        "id": "dice_40k_death_guard",
        "name": "Death Guard Plague Rot Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Putrid rotting olive-green dice with toxic bile pips. Displays the Corroded Horned Helm on the 6th face!",
        "payload": {
            "faction": "Death Guard",
            "die_bg": "linear-gradient(135deg, #14532d 0%, #4d7c0f 100%)",
            "pip_color": "#facc15",
            "six_face_svg_id": "avatar_death_guard",
            "six_face_label": "Corroded Helm",
            "crit_particle": "plague_cloud_burst",
            "crit_sound": "flesh_decay"
        }
    },
    {
        "id": "dice_40k_world_eaters",
        "name": "World Eaters Skull-Brass Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Heavy beaten brass dice with gore-crimson pips. Displays the Khorne Brass Maw and chainaxes on the 6th face!",
        "payload": {
            "faction": "World Eaters",
            "die_bg": "linear-gradient(135deg, #450a0a 0%, #78350f 100%)",
            "pip_color": "#ef4444",
            "six_face_svg_id": "avatar_world_eaters",
            "six_face_label": "Khorne Skull Maw",
            "crit_particle": "blood_frenzy_splatter",
            "crit_sound": "chainaxe_rev"
        }
    },
    {
        "id": "dice_40k_grey_knights",
        "name": "Grey Knights Sanctified Silver Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Burnished psychic silver dice with electric blue wards. Displays the Nemesis Force Sword and Tome on the 6th face!",
        "payload": {
            "faction": "Grey Knights",
            "die_bg": "linear-gradient(135deg, #0f172a 0%, #334155 100%)",
            "pip_color": "#60a5fa",
            "six_face_svg_id": "avatar_grey_knights",
            "six_face_label": "Nemesis Sword & Tome",
            "crit_particle": "psychic_banishment_nova",
            "crit_sound": "chime_sanctified"
        }
    },
    {
        "id": "dice_40k_sororitas",
        "name": "Adepta Sororitas Fleur-de-Lis Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Martyr black dice with alabaster pips. Features the sacred Fleur-de-lis on the 6th face!",
        "payload": {
            "faction": "Adepta Sororitas",
            "die_bg": "linear-gradient(135deg, #09090b 0%, #1c1917 100%)",
            "pip_color": "#fde047",
            "six_face_svg_id": "avatar_adepta_sororitas",
            "six_face_label": "Sacred Fleur-de-lis",
            "crit_particle": "holy_flame_burst",
            "crit_sound": "angelic_choir"
        }
    },
    {
        "id": "dice_40k_astramilitarum",
        "name": "Astra Militarum Cadia Green Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Military olive-drab dice with stencil white pips. Displays the Cadian Winged Skull Gate on the 6th face!",
        "payload": {
            "faction": "Astra Militarum",
            "die_bg": "linear-gradient(135deg, #052e16 0%, #14532d 100%)",
            "pip_color": "#fef08a",
            "six_face_svg_id": "avatar_astra_militarum",
            "six_face_label": "Cadian Gate",
            "crit_particle": "artillery_smoke_explosion",
            "crit_sound": "lasgun_volley"
        }
    },
    {
        "id": "dice_40k_votann",
        "name": "Leagues of Votann Magma Core Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Industrial turquoise and orange dice with steel pips. Displays the Ancestor Core Runic Octagon on the 6th face!",
        "payload": {
            "faction": "Leagues of Votann",
            "die_bg": "linear-gradient(135deg, #083344 0%, #0e7490 100%)",
            "pip_color": "#f97316",
            "six_face_svg_id": "avatar_leagues_of_votann",
            "six_face_label": "Ancestor Core",
            "crit_particle": "magna_rail_tracer",
            "crit_sound": "heavy_industry_clang"
        }
    },
    {
        "id": "dice_40k_drukhari",
        "name": "Drukhari Soul-Flayer Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Dark poison-jade dice with amethyst pips. Displays the Kabalite Soul-Talon blade on the 6th face!",
        "payload": {
            "faction": "Drukhari",
            "die_bg": "linear-gradient(135deg, #022c22 0%, #4a044e 100%)",
            "pip_color": "#2dd4bf",
            "six_face_svg_id": "avatar_drukhari",
            "six_face_label": "Soul-Talon Blade",
            "crit_particle": "venom_shards",
            "crit_sound": "torment_cry"
        }
    },
    {
        "id": "dice_40k_genestealercults",
        "name": "Genestealer Cults Wyrm Hazard Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Industrial mining hazard yellow and purple dice. Displays the Wyrm Patriarch claw on the 6th face!",
        "payload": {
            "faction": "Genestealer Cults",
            "die_bg": "linear-gradient(135deg, #2e1065 0%, #ca8a04 100%)",
            "pip_color": "#d8b4fe",
            "six_face_svg_id": "avatar_genestealer_cults",
            "six_face_label": "Wyrm Claw",
            "crit_particle": "mining_laser_blast",
            "crit_sound": "cult_hiss"
        }
    },
    {
        "id": "dice_40k_thousandsons",
        "name": "Thousand Sons Rubric Sorcery Dice",
        "game_system": "40k",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Lapis lazuli and gold leaf dice with cyan warpfire pips. Displays the Eye of Magnus on the 6th face!",
        "payload": {
            "faction": "Thousand Sons",
            "die_bg": "linear-gradient(135deg, #082f49 0%, #0369a1 100%)",
            "pip_color": "#facc15",
            "six_face_svg_id": "avatar_thousand_sons",
            "six_face_label": "Eye of Magnus",
            "crit_particle": "warp_sorcery_rings",
            "crit_sound": "sorcery_hum"
        }
    },

    # ── WING 2: PROFILE FORGE (40K PRESTIGE CARD FRAMES) ──
    {
        "id": "frame_peak_veteran",
        "name": "Veteran's Iron Plate",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "rare",
        "cost_glory": 450,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {"peak_elo": 1500.0, "label": "Requires All-Time Peak Elo 1500+"},
        "icon": "🛡️",
        "description": "Reinforced gunmetal steel plate with cold-forged corner rivets. Awarded to commanders who reached Veteran rank.",
        "payload": {
            "css_class": "frame-peak-veteran",
            "border_color": "#94a3b8",
            "border_glow": "0 0 16px rgba(148, 163, 184, 0.4)"
        }
    },
    {
        "id": "frame_peak_captain",
        "name": "Captain's Emerald Chevron",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "rare",
        "cost_glory": 750,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {"peak_elo": 1600.0, "label": "Requires All-Time Peak Elo 1600+"},
        "icon": "⚔️",
        "description": "Vibrant tactical emerald green border with glowing strike company chevrons and battle honors.",
        "payload": {
            "css_class": "frame-peak-captain",
            "border_color": "#10b981",
            "border_glow": "0 0 20px rgba(16, 185, 129, 0.45)"
        }
    },
    {
        "id": "frame_peak_commander",
        "name": "Commander's Ion Sky",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "epic",
        "cost_glory": 1050,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {"peak_elo": 1700.0, "label": "Requires All-Time Peak Elo 1700+"},
        "icon": "⚡",
        "description": "Electrified sky-blue plasma rim with sweeping sensor telemetry pulse across your profile card.",
        "payload": {
            "css_class": "frame-peak-commander",
            "border_color": "#38bdf8",
            "border_glow": "0 0 22px rgba(56, 189, 248, 0.5)"
        }
    },
    {
        "id": "frame_peak_dark_angels",
        "name": "Caliban Knight's Bastion",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "epic",
        "cost_glory": 1250,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {"peak_elo": 1750.0, "label": "Requires All-Time Peak Elo 1750+"},
        "icon": "🗡️",
        "description": "Dark Angels dark emerald and antique silver frame with crossed sword-hilt corners and radiant Caliban green ambient halo.",
        "payload": {
            "css_class": "frame-peak-dark-angels",
            "border_color": "#22c55e",
            "border_glow": "0 0 24px rgba(34, 197, 94, 0.6)"
        }
    },
    {
        "id": "frame_peak_necrons",
        "name": "Necron Dynastic Gauss Rim",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "epic",
        "cost_glory": 1250,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {"peak_elo": 1750.0, "label": "Requires All-Time Peak Elo 1750+"},
        "icon": "🟢",
        "description": "Ancient black necrodermis frame with pulsating Gauss green circuit traces and glowing dynastic hieroglyphs.",
        "payload": {
            "css_class": "frame-peak-necrons",
            "border_color": "#10b981",
            "border_glow": "0 0 26px rgba(16, 185, 129, 0.65)"
        }
    },
    {
        "id": "frame_peak_grand_marshal",
        "name": "Grand Marshal's Amethyst Halo",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "epic",
        "cost_glory": 1750,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {"peak_elo": 1800.0, "label": "Requires All-Time Peak Elo 1800+"},
        "icon": "👑",
        "description": "Royal purple auric frame with ambient amethyst halo. Proclaiming commanding tabletop supremacy.",
        "payload": {
            "css_class": "frame-peak-grand-marshal",
            "border_color": "#c084fc",
            "border_glow": "0 0 28px rgba(192, 132, 252, 0.65)"
        }
    },
    {
        "id": "frame_peak_high_warlord",
        "name": "High Warlord's Crucible",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "legendary",
        "cost_glory": 2250,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {"peak_elo": 1850.0, "label": "Requires All-Time Peak Elo 1850+"},
        "icon": "🔥",
        "description": "Pulsing volcanic molten basalt border with glowing ember slag trim, forged in high tournament warfare.",
        "payload": {
            "css_class": "frame-peak-high-warlord",
            "border_color": "#fb923c",
            "border_glow": "0 0 28px rgba(251, 146, 60, 0.65)"
        }
    },
    {
        "id": "frame_peak_warmaster",
        "name": "Warmaster's Blood-Iron",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "legendary",
        "cost_glory": 2850,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {"peak_elo": 1900.0, "label": "Requires All-Time Peak Elo 1900+"},
        "icon": "🩸",
        "description": "Barbed crimson-and-black iron frame with radiating chaos warp flare. The mark of true warlords.",
        "payload": {
            "css_class": "frame-peak-warmaster",
            "border_color": "#f43f5e",
            "border_glow": "0 0 30px rgba(244, 63, 94, 0.7)"
        }
    },
    {
        "id": "frame_peak_primarch",
        "name": "Primarch's Celestial Corona",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "legendary",
        "cost_glory": 3650,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {"peak_elo": 2000.0, "label": "Requires All-Time Peak Elo 2000+"},
        "icon": "⚡",
        "description": "Prismatic celestial cyan and indigo corona with radiant solar rays. For demigods of the competitive meta.",
        "payload": {
            "css_class": "frame-peak-primarch",
            "border_color": "#38bdf8",
            "border_glow": "0 0 35px rgba(56, 189, 248, 0.75), inset 0 0 18px rgba(129, 140, 248, 0.3)"
        }
    },
    {
        "id": "frame_peak_everchosen",
        "name": "Apex Everchosen's Dominion",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "legendary",
        "cost_glory": 4850,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {"peak_elo": 2200.0, "label": "Requires All-Time Peak Elo 2200+"},
        "icon": "👑",
        "description": "Relic 24k gold foil filigree with mythic pulsing aura and crown insignias. The ultimate competitive pinnacle.",
        "payload": {
            "css_class": "frame-peak-everchosen",
            "border_color": "#fbbf24",
            "border_glow": "0 0 40px rgba(251, 191, 36, 0.85), inset 0 0 22px rgba(244, 63, 94, 0.25)"
        }
    },
    {
        "id": "frame_astral_holofoil",
        "name": "Astral Holo-Foil Finish",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "master_crafted",
        "cost_glory": 1850,
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
        "cost_glory": 850,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🌐",
        "description": "Cyan glowing circuit trace perimeter with animated data telemetry streams running along card edges.",
        "payload": {
            "css_class": "frame-cyber-matrix",
            "border_glow": "0 0 20px rgba(56, 189, 248, 0.4)"
        }
    },
    {
        "id": "frame_warp_corruption",
        "name": "Warp Tendril Corruption",
        "game_system": "40k",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "epic",
        "cost_glory": 1550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {"career_crest_tier": 3, "label": "Requires Career Crest Tier III+"},
        "icon": "👁️",
        "description": "Dark violet warp tendrils creeping across your profile borders with pulsing psychic eye insignias.",
        "payload": {
            "css_class": "frame-warp-corruption",
            "border_glow": "0 0 25px rgba(192, 132, 252, 0.55)"
        }
    },

    # ── WING 3: FACTION SIGILS (ALL 29 40K FACTIONS!) ──
    {
        "id": "avatar_dark_angels",
        "name": "Dark Angels Winged Sword",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🗡️",
        "description": "The sacred downward broadsword of Caliban flanked by dark emerald angelic wings. First Legion honor.",
        "payload": {"faction": "Dark Angels", "badge_color": "#22c55e", "avatar_icon": "🗡️"}
    },
    {
        "id": "avatar_necrons",
        "name": "Necron Triarch Ankh",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🟢",
        "description": "Undying dynastic cartouche glowing with Gauss-green eldritch eternity. Sovereign sigil of the Silent King.",
        "payload": {"faction": "Necrons", "badge_color": "#10b981", "avatar_icon": "🟢"}
    },
    {
        "id": "avatar_adeptus_astartes",
        "name": "Imperial Aquila",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🦅",
        "description": "The double-headed Imperial Eagle of the Space Marines with crowned heads, clutching the thunderbolts of the Imperium.",
        "payload": {"faction": "Adeptus Astartes", "badge_color": "#38bdf8", "avatar_icon": "🦅"}
    },
    {
        "id": "avatar_chaos_space_marines",
        "name": "Star of Chaos Undivided",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "⭐",
        "description": "The dreaded Eight-Fold Path of Chaos with barbed arrows radiating from an abyssal void.",
        "payload": {"faction": "Chaos Space Marines", "badge_color": "#f43f5e", "avatar_icon": "⭐"}
    },
    {
        "id": "avatar_orks",
        "name": "Ork Iron Gob & WAAAGH! Skull",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "💀",
        "description": "Heavy riveted iron jaw gob with glaring red ocular lenses and jagged warboss tusks. WAAAGH!",
        "payload": {"faction": "Orks", "badge_color": "#84cc16", "avatar_icon": "💀"}
    },
    {
        "id": "avatar_black_templars",
        "name": "Black Templars Maltese Cross",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "⚔️",
        "description": "Monochrome Maltese cross of the Eternal Crusade, sanctified in holy silver with martyr red jewels.",
        "payload": {"faction": "Black Templars", "badge_color": "#f8fafc", "avatar_icon": "⚔️"}
    },
    {
        "id": "avatar_blood_angels",
        "name": "Blood Angels Winged Drop",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🩸",
        "description": "Ruby blood tear of Sanguinius flanked by pristine alabaster angelic wings. Sons of Baal.",
        "payload": {"faction": "Blood Angels", "badge_color": "#ef4444", "avatar_icon": "🩸"}
    },
    {
        "id": "avatar_space_wolves",
        "name": "Space Wolves Iron Wolf",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🐺",
        "description": "Howling Fenrisian Wolf silhouette wreathed in frost-blue runes. Sons of Russ.",
        "payload": {"faction": "Space Wolves", "badge_color": "#38bdf8", "avatar_icon": "🐺"}
    },
    {
        "id": "avatar_adeptus_custodes",
        "name": "Auramite Custodes Raptor",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "legendary",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🦅",
        "description": "Solid 24k Auramite gold Emperor's Raptor with glowing ruby eyes and lightning halo. The Ten Thousand.",
        "payload": {"faction": "Adeptus Custodes", "badge_color": "#fbbf24", "avatar_icon": "🦅"}
    },
    {
        "id": "avatar_adeptus_mechanicus",
        "name": "Mechanicus Opus Machina",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "⚙️",
        "description": "Martian black and white skull conjoined with the sacred Cog of the Omnissiah. Praise the Machine God.",
        "payload": {"faction": "Adeptus Mechanicus", "badge_color": "#f97316", "avatar_icon": "⚙️"}
    },
    {
        "id": "avatar_tyranids",
        "name": "Hive Mind Synapse Carapace",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🦗",
        "description": "Alien chitinous carapace pulsing with psychic bio-acid green synapse nodes. The Great Devourer.",
        "payload": {"faction": "Tyranids", "badge_color": "#c084fc", "avatar_icon": "🦗"}
    },
    {
        "id": "avatar_tau_empire",
        "name": "T'au Fire Caste Sept Mark",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🔵",
        "description": "Minimalist circular Sept insignia of the Fire Caste wreathed in cyan pulse glow. For the Greater Good.",
        "payload": {"faction": "T'au Empire", "badge_color": "#06b6d4", "avatar_icon": "🔵"}
    },
    {
        "id": "avatar_aeldari",
        "name": "Aeldari Rune of Ulthwé",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "👁️",
        "description": "The weeping Eye of Isha mourning rune in deep spirit-stone amber and Craftworld teal.",
        "payload": {"faction": "Aeldari", "badge_color": "#14b8a6", "avatar_icon": "👁️"}
    },
    {
        "id": "avatar_death_guard",
        "name": "Death Guard Corroded Helm",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🪰",
        "description": "Pitted Mk III horned helm oozing pestilence with the sacred Nurgle fly mark. Plaguelord honor.",
        "payload": {"faction": "Death Guard", "badge_color": "#84cc16", "avatar_icon": "🪰"}
    },
    {
        "id": "avatar_adepta_sororitas",
        "name": "Adepta Sororitas Fleur-de-lis",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "⚜️",
        "description": "Sacred ivory Fleur-de-lis with martyr thorn halo and ruby teardrop flame. Faith and Fire.",
        "payload": {"faction": "Adepta Sororitas", "badge_color": "#ef4444", "avatar_icon": "⚜️"}
    },
    {
        "id": "avatar_astra_militarum",
        "name": "Astra Militarum Cadian Gate",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎖️",
        "description": "Winged skull over the fortified Cadian gate flanked by crossed lasguns. Cadia Stands!",
        "payload": {"faction": "Astra Militarum", "badge_color": "#16a34a", "avatar_icon": "🎖️"}
    },
    {
        "id": "avatar_chaos_daemons",
        "name": "Chaos Daemons Warp Visage",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "👹",
        "description": "Fanged Daemon Prince visage with sweeping horns and burning warpfire eyes. Ruinous Powers.",
        "payload": {"faction": "Chaos Daemons", "badge_color": "#f43f5e", "avatar_icon": "👹"}
    },
    {
        "id": "avatar_chaos_knights",
        "name": "Chaos Knights Dread Visor",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🛡️",
        "description": "Barbed knightly helm silhouette with slit eye visor and defiled heraldic spikes. Despoiler.",
        "payload": {"faction": "Chaos Knights", "badge_color": "#ea580c", "avatar_icon": "🛡️"}
    },
    {
        "id": "avatar_deathwatch",
        "name": "Deathwatch Inquisitorial Crest",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🗡️",
        "description": "Polished silver Inquisitorial 'I' with Deathwatch skull. The shield that slays the alien.",
        "payload": {"faction": "Deathwatch", "badge_color": "#38bdf8", "avatar_icon": "🗡️"}
    },
    {
        "id": "avatar_drukhari",
        "name": "Drukhari Kabalite Talon",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🗡️",
        "description": "Barbed Kabalite soul-talon blade dripping with dark torment venom and arched Commorrite hooks.",
        "payload": {"faction": "Drukhari", "badge_color": "#10b981", "avatar_icon": "🗡️"}
    },
    {
        "id": "avatar_emperors_children",
        "name": "Emperor's Children Sonic Glyph",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎶",
        "description": "Slaaneshi barbed crescent with radiating sonic soundwave coils. Perfection and ecstasy.",
        "payload": {"faction": "Emperor's Children", "badge_color": "#ec4899", "avatar_icon": "🎶"}
    },
    {
        "id": "avatar_genestealer_cults",
        "name": "Genestealer Cults Patriarch Claw",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🦂",
        "description": "Three-armed Wyrm Patriarch claw encircling an industrial mining half-cog. Rise from below!",
        "payload": {"faction": "Genestealer Cults", "badge_color": "#a855f7", "avatar_icon": "🦂"}
    },
    {
        "id": "avatar_grey_knights",
        "name": "Grey Knights Aegis Tome",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "📖",
        "description": "Nemesis force sword piercing an open sanctified libram wreathed in psychic warding blue.",
        "payload": {"faction": "Grey Knights", "badge_color": "#60a5fa", "avatar_icon": "📖"}
    },
    {
        "id": "avatar_imperial_agents",
        "name": "Inquisition Grand Rosette",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "⚖️",
        "description": "Triple-barred Inquisitorial seal 'I' centered on a blood-red skull. By order of the Holy Ordos.",
        "payload": {"faction": "Imperial Agents", "badge_color": "#dc2626", "avatar_icon": "⚖️"}
    },
    {
        "id": "avatar_imperial_knights",
        "name": "Imperial Knights Chivalric Eagle",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🛡️",
        "description": "Chivalric heater shield bearing the sword of high honor and the cog of Mars. Freeblade pride.",
        "payload": {"faction": "Imperial Knights", "badge_color": "#3b82f6", "avatar_icon": "🛡️"}
    },
    {
        "id": "avatar_leagues_of_votann",
        "name": "Leagues of Votann Ancestor Core",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🧭",
        "description": "Octagonal runic Kinband wheel glowing with geothermal magma orange. The Ancestors are watching.",
        "payload": {"faction": "Leagues of Votann", "badge_color": "#f97316", "avatar_icon": "🧭"}
    },
    {
        "id": "avatar_space_marines",
        "name": "Space Marines Chapter Laurels",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🗡️",
        "description": "Chapter Master victory laurels encircling an upright Imperial gladius. Courage and Honour.",
        "payload": {"faction": "Space Marines", "badge_color": "#38bdf8", "avatar_icon": "🗡️"}
    },
    {
        "id": "avatar_thousand_sons",
        "name": "Thousand Sons Eye of Magnus",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "👁️",
        "description": "Lapis-gold horned crest of Tzeentch centered with the All-Seeing mystic eye of Magnus the Red.",
        "payload": {"faction": "Thousand Sons", "badge_color": "#06b6d4", "avatar_icon": "👁️"}
    },
    {
        "id": "avatar_world_eaters",
        "name": "World Eaters Khorne Brass Maw",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🪓",
        "description": "Heavy brass skull maw flanked by crossed chainaxes. Blood for the Blood God! Skulls for the Skull Throne!",
        "payload": {"faction": "World Eaters", "badge_color": "#dc2626", "avatar_icon": "🪓"}
    },

    # ── WING 4: TITLES (40K) ──
    {
        "id": "title_bane_of_warp",
        "name": "Bane of the Warp",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 500,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Styled subtitle badge declaring your mastery over Chaos and psychic threats.",
        "payload": {"css_class": "title-badge-warp", "title_text": "Bane of the Warp"}
    },
    {
        "id": "title_forge_father",
        "name": "Forge Father",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 500,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Title worn by masters of armor, vehicles, and mechanized strike doctrines.",
        "payload": {"css_class": "title-badge-forge", "title_text": "Forge Father"}
    },
    {
        "id": "title_grand_strategist",
        "name": "Grand Strategist",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "epic",
        "cost_glory": 850,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Awarded to seasoned tournament strategists with comprehensive tactical battlefield mastery.",
        "payload": {"css_class": "title-badge-strategist", "title_text": "Grand Strategist"}
    },
    {
        "id": "title_unbroken",
        "name": "The Unbroken",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "legendary",
        "cost_glory": 1450,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {"career_crest_tier": 2, "label": "Requires Career Crest Tier II+"},
        "icon": "🏷️",
        "description": "Mythic title declaring an unyielding will to fight through every turn and reverse impossible odds.",
        "payload": {"css_class": "title-badge-unbroken", "title_text": "The Unbroken"}
    },
    {
        "id": "title_angel_of_death",
        "name": "Angel of Death",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 500,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "First Legion battle honor marking relentless offensive shock assaults.",
        "payload": {"css_class": "title-badge-unbroken", "title_text": "Angel of Death"}
    },
    {
        "id": "title_warmaster",
        "name": "Warmaster of Chaos",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "legendary",
        "cost_glory": 1450,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "The title of warlords who bend the galaxy to ruin and crush all opposing armies.",
        "payload": {"css_class": "title-badge-warp", "title_text": "Warmaster of Chaos"}
    },
    {
        "id": "title_phaeron",
        "name": "Phaeron of the Infinite",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "legendary",
        "cost_glory": 1450,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Dynastic sovereignty proclaiming dominion over time, eternity, and tomb worlds.",
        "payload": {"css_class": "title-badge-forge", "title_text": "Phaeron of the Infinite"}
    },
    {
        "id": "title_da_biggest_boss",
        "name": "Da Biggest Boss",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 500,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Title for the biggest, 'ardest warboss who krumped all challengers.",
        "payload": {"css_class": "title-badge-unbroken", "title_text": "Da Biggest Boss"}
    },
    {
        "id": "title_shield_captain",
        "name": "Shield-Captain",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "epic",
        "cost_glory": 850,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Custodes officer title representing incomparable single-combat mastery.",
        "payload": {"css_class": "title-badge-strategist", "title_text": "Shield-Captain"}
    },
    {
        "id": "title_archon_of_commorragh",
        "name": "Archon of the Dark City",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "epic",
        "cost_glory": 850,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Supreme Kabalite overlord title of cruelty, deceit, and supreme speed.",
        "payload": {"css_class": "title-badge-warp", "title_text": "Archon of the Dark City"}
    },
    {
        "id": "title_inquisitor_lord",
        "name": "Inquisitor Lord",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "epic",
        "cost_glory": 850,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "High arbiter of the Holy Ordos, purging heretics, mutants, and xenos alike.",
        "payload": {"css_class": "title-badge-unbroken", "title_text": "Inquisitor Lord"}
    },
    {
        "id": "title_hive_tyrant",
        "name": "Apex Swarm Lord",
        "game_system": "40k",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "epic",
        "cost_glory": 850,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Bio-form apex conduit of the Hive Mind commanding the planetary invasion swarm.",
        "payload": {"css_class": "title-badge-warp", "title_text": "Apex Swarm Lord"}
    },

    # ── WING 5: PLAYER POKES (40K) ──
    {
        "id": "poke_inquisition_smite",
        "name": "Inquisitorial Smite Poke (5x Pack)",
        "game_system": "40k",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "common",
        "cost_glory": 150,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "⚡",
        "description": "Deliver a psychic smite of inquisitorial judgment upon an opponent's profile card. 5 charges per bundle.",
        "payload": {
            "toast_message": "⚡ Inquisitorial Smite cast on {target}! By the Throne!",
            "sound_cue": "thunder_zap",
            "visual_effect": "lightning_flash"
        }
    },
    {
        "id": "poke_waaagh_club",
        "name": "WAAAGH! Krump Poke (5x Pack)",
        "game_system": "40k",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "common",
        "cost_glory": 150,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🔨",
        "description": "Send an aggressive Ork krump bonk across the wire to rattle your rival. 5 charges per bundle.",
        "payload": {
            "toast_message": "🔨 WAAAGH! {target} got right proppa krumped!",
            "sound_cue": "krump_thud",
            "visual_effect": "shake_impact"
        }
    },
    {
        "id": "poke_commissar_stare",
        "name": "Commissar Death Glare (5x Pack)",
        "game_system": "40k",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "common",
        "cost_glory": 150,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "👁️",
        "description": "Fix your rival with an unblinking Commissar disciplinary glare. 5 charges per bundle.",
        "payload": {
            "toast_message": "👁️ Commissar stern death glare fixed upon {target} for morale inspection!",
            "sound_cue": "whistle_discipline",
            "visual_effect": "red_reticle"
        }
    },
    {
        "id": "poke_nurgle_sneeze",
        "name": "Nurgle's Blessing Poke (5x Pack)",
        "game_system": "40k",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "common",
        "cost_glory": 250,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🪰",
        "description": "Bestow Grandfather Nurgle's joyous festering cough upon your opponent. 5 charges per bundle.",
        "payload": {
            "toast_message": "🪰 Grandfather Nurgle sneezed gifts upon {target}! Fester in glory!",
            "sound_cue": "goo_splat",
            "visual_effect": "slime_spores"
        }
    },
    {
        "id": "poke_eldar_mindshock",
        "name": "Aeldari Mindshock Poke (5x Pack)",
        "game_system": "40k",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "common",
        "cost_glory": 250,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🔮",
        "description": "Send an elegant psychic mindshock pulse to unbalance your rival. 5 charges per bundle.",
        "payload": {
            "toast_message": "🔮 Aeldari mindshock pulse dazed {target}! Farseer precognition active!",
            "sound_cue": "psychic_hum",
            "visual_effect": "purple_rings"
        }
    },
    {
        "id": "poke_tau_markerlight",
        "name": "T'au Markerlight Lock (5x Pack)",
        "game_system": "40k",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "common",
        "cost_glory": 250,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🎯",
        "description": "Paint your rival with a high-intensity cyan markerlight laser. 5 charges per bundle.",
        "payload": {
            "toast_message": "🎯 Markerlight lock acquired on {target}! +1 to ballistic skill!",
            "sound_cue": "laser_ping",
            "visual_effect": "cyan_target"
        }
    },
    {
        "id": "poke_chaos_warp_storm",
        "name": "Warp Storm Hex (5x Pack)",
        "game_system": "40k",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "epic",
        "cost_glory": 450,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🌀",
        "description": "Summon an empyric warp breach upon a rival's command deck. Triggers screen glitch, purple lightning bloom, and a 24-hour Warp Incursion hex on sign-in.",
        "payload": {
            "toast_message": "🌀 Warp Storm invoked upon {target}! The empyrean tears open!",
            "sound_cue": "warp_thunder",
            "visual_effect": "warp_purple_bloom",
            "sign_in_effect": "warp_storm",
            "hex_duration_hours": 24,
            "hex_badge_title": "Warp Incursion",
            "hex_banner_desc": "Targeted by an empyric Warp Storm from {sender}.",
            "css_glow": "#c084fc"
        }
    },
    {
        "id": "poke_ork_dakka_salvo",
        "name": "Dakka Barrage Taunt (5x Pack)",
        "game_system": "40k",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "rare",
        "cost_glory": 250,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "💥",
        "description": "Unload a deafening volley of solid-slug shells at an opponent. Triggers screen rumble, bullet craters, and an active WAAAGH! Krumped hex for 24h.",
        "payload": {
            "toast_message": "💥 MOAR DAKKA! Unloaded an explosive bullet storm on {target}!",
            "sound_cue": "heavy_dakka",
            "visual_effect": "bullet_crater_rumble",
            "sign_in_effect": "dakka_barrage",
            "hex_duration_hours": 24,
            "hex_badge_title": "Dakka Barrage",
            "hex_banner_desc": "Pinned down by a relentless Ork Dakka Barrage from {sender}.",
            "css_glow": "#eab308"
        }
    },
    {
        "id": "poke_necrons_mindshackle",
        "name": "Mindshackle Scarab Parasite (5x Pack)",
        "game_system": "40k",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "epic",
        "cost_glory": 450,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🤖",
        "description": "Infiltrate target's cogitators with burrowing cybernetic scarabs. Triggers toxic green matrix data rain and glitching HUD for 24h.",
        "payload": {
            "toast_message": "🤖 Canoptek Scarabs burrowed into {target}'s neural helm!",
            "sound_cue": "scarab_scuttle",
            "visual_effect": "matrix_green_glitch",
            "sign_in_effect": "mindshackle",
            "hex_duration_hours": 24,
            "hex_badge_title": "Mindshackled",
            "hex_banner_desc": "Canoptek Mindshackle Scarabs deployed into command systems by {sender}.",
            "css_glow": "#22c55e"
        }
    },
    {
        "id": "poke_exterminatus_warning",
        "name": "Inquisitorial Exterminatus Sanction (3x Pack)",
        "game_system": "40k",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "legendary",
        "cost_glory": 750,
        "is_consumable": True,
        "bundle_count": 3,
        "prerequisite": None,
        "icon": "🚨",
        "description": "Issue an Alpha-Level Orbital Sanction from the Holy Ordos. Triggers flashing red emergency sirens, rotating targeting reticles, and a dire 24-hour condemned status.",
        "payload": {
            "toast_message": "🚨 EXTERMINATUS SANCTION ISSUED! {target} has been marked for purification!",
            "sound_cue": "orbital_siren",
            "visual_effect": "orbital_reticle_klaxon",
            "sign_in_effect": "exterminatus",
            "hex_duration_hours": 24,
            "hex_badge_title": "Under Exterminatus Order",
            "hex_banner_desc": "Designated for orbital cleansing by Inquisitor {sender}.",
            "css_glow": "#ef4444"
        }
    },
    {
        "id": "poke_custodes_decree",
        "name": "Imperial Custodes Decree (5x Pack)",
        "game_system": "40k",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "epic",
        "cost_glory": 450,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🦅",
        "description": "Proclaim the supreme judgment of the Golden Throne. Triggers radiant auramite gold lens flare with 'The Emperor Watches' challenge for 24h.",
        "payload": {
            "toast_message": "🦅 Golden decree delivered to {target}! By the will of the Emperor!",
            "sound_cue": "auramite_chime",
            "visual_effect": "golden_solar_flare",
            "sign_in_effect": "custodes_decree",
            "hex_duration_hours": 24,
            "hex_badge_title": "Imperial Condemnation",
            "hex_banner_desc": "Challenged under the solemn Imperial Decree of {sender}.",
            "css_glow": "#f59e0b"
        }
    },

    # =====================================================================
    # AGE OF SIGMAR (AOS) STORE
    # =====================================================================

    # ── WING 1: DICE FORGE (AOS) ──
    {
        "id": "dice_celestial_sigmarite",
        "name": "Celestial Sigmarite Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 1150,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Forged in the heart of Azyr from meteoric celestial gold. Natural 6s trigger lightning strikes.",
        "payload": {
            "die_bg": "linear-gradient(135deg, #1e3a8a 0%, #ca8a04 100%)",
            "pip_color": "#fde047",
            "crit_particle": "azyr_lightning",
            "crit_sound": "thunderclap"
        }
    },
    {
        "id": "dice_death_bone",
        "name": "Ossiarch Death Bone Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "rare",
        "cost_glory": 750,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Crafted from calcified bone-tithe osseous bricks with spectral teal pips.",
        "payload": {
            "die_bg": "linear-gradient(135deg, #fef3c7 0%, #134e4a 100%)",
            "pip_color": "#2dd4bf",
            "crit_particle": "soul_teal_flame",
            "crit_sound": "bone_clack"
        }
    },
    # AoS Faction Dice with 6th face custom vector sigils:
    {
        "id": "dice_aos_stormcast",
        "name": "Stormcast Eternals Azyrite Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Azyrite lightning gold dice with comet blue pips. Displays the Twin-Tailed Comet of Sigmar on the 6th face!",
        "payload": {
            "faction": "Stormcast Eternals",
            "die_bg": "linear-gradient(135deg, #1e3a8a 0%, #d97706 100%)",
            "pip_color": "#fef08a",
            "six_face_svg_id": "avatar_stormcast_eternals",
            "six_face_label": "Twin-Tailed Comet",
            "crit_particle": "azyr_lightning",
            "crit_sound": "thunderclap"
        }
    },
    {
        "id": "dice_aos_khorne",
        "name": "Blades of Khorne Blood-Brass Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Beaten brass dice quenched in gore with skull ivory pips. Displays the Khorne skull rune on the 6th face!",
        "payload": {
            "faction": "Blades of Khorne",
            "die_bg": "linear-gradient(135deg, #450a0a 0%, #991b1b 100%)",
            "pip_color": "#fde047",
            "six_face_svg_id": "avatar_khorne_bloodbound",
            "six_face_label": "Khorne Skull Rune",
            "crit_particle": "blood_frenzy_splatter",
            "crit_sound": "khorne_roar"
        }
    },
    {
        "id": "dice_aos_gloomspite",
        "name": "Gloomspite Gitz Bad Moon Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Fungus yellow and cave black dice with squinting red pips. Displays the Grinning Bad Moon on the 6th face!",
        "payload": {
            "faction": "Gloomspite Gitz",
            "die_bg": "linear-gradient(135deg, #18181b 0%, #ca8a04 100%)",
            "pip_color": "#ef4444",
            "six_face_svg_id": "avatar_gloomspite_gitz",
            "six_face_label": "Grinning Bad Moon",
            "crit_particle": "mushroom_spore_cloud",
            "crit_sound": "gitz_giggle"
        }
    },
    {
        "id": "dice_aos_soulblight",
        "name": "Soulblight Gravelords Blood Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Vampire crimson velvet and obsidian dice with bone pips. Displays the Vyrkos bat crest on the 6th face!",
        "payload": {
            "faction": "Soulblight Gravelords",
            "die_bg": "linear-gradient(135deg, #4c0519 0%, #881337 100%)",
            "pip_color": "#f8fafc",
            "six_face_svg_id": "avatar_soulblight_gravelords",
            "six_face_label": "Crimson Bat Crest",
            "crit_particle": "bat_swarm_burst",
            "crit_sound": "vampire_hiss"
        }
    },
    {
        "id": "dice_aos_sylvaneth",
        "name": "Sylvaneth Wyldwood Bark Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Petrified Ironwood bark dice with spirit emerald pips. Displays the Alarielle Spirit-Pod on the 6th face!",
        "payload": {
            "faction": "Sylvaneth",
            "die_bg": "linear-gradient(135deg, #14532d 0%, #15803d 100%)",
            "pip_color": "#86efac",
            "six_face_svg_id": "avatar_sylvaneth",
            "six_face_label": "Spirit-Pod Heart",
            "crit_particle": "wyldwood_leaf_burst",
            "crit_sound": "branch_snap"
        }
    },
    {
        "id": "dice_aos_skaven",
        "name": "Skaven Warpstone Toxic Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Radioactive warpstone green dice with sickly yellow pips. Displays the Horned Rat triangle on the 6th face!",
        "payload": {
            "faction": "Skaven",
            "die_bg": "linear-gradient(135deg, #14532d 0%, #4d7c0f 100%)",
            "pip_color": "#fef08a",
            "six_face_svg_id": "avatar_skaven",
            "six_face_label": "Horned Rat Rune",
            "crit_particle": "warpstone_sparks",
            "crit_sound": "screaming_bell"
        }
    },
    {
        "id": "dice_aos_bonereapers",
        "name": "Ossiarch Nadirite Legion Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Carved soul-tithe bone dice with mortuary teal pips. Displays the Katakros legion seal on the 6th face!",
        "payload": {
            "faction": "Ossiarch Bonereapers",
            "die_bg": "linear-gradient(135deg, #042f2e 0%, #0f766e 100%)",
            "pip_color": "#5eead4",
            "six_face_svg_id": "avatar_ossiarch_bonereapers",
            "six_face_label": "Nadirite Seal",
            "crit_particle": "soul_teal_flame",
            "crit_sound": "bone_clack"
        }
    },
    {
        "id": "dice_aos_seraphon",
        "name": "Seraphon Solar Star-Glyph Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Temple-city star-turquoise dice with Aztec solar gold pips. Displays the Old One Sun-Glyph on the 6th face!",
        "payload": {
            "faction": "Seraphon",
            "die_bg": "linear-gradient(135deg, #083344 0%, #0891b2 100%)",
            "pip_color": "#facc15",
            "six_face_svg_id": "avatar_seraphon",
            "six_face_label": "Solar Sun-Glyph",
            "crit_particle": "starborne_solar_beam",
            "crit_sound": "cosmic_chime"
        }
    },
    {
        "id": "dice_aos_maggotkin",
        "name": "Maggotkin of Nurgle Slime Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Diseased bilious yellow-green dice with scab pips. Displays the Nurgle Tri-Globe mark on the 6th face!",
        "payload": {
            "faction": "Maggotkin of Nurgle",
            "die_bg": "linear-gradient(135deg, #14532d 0%, #65a30d 100%)",
            "pip_color": "#fef08a",
            "six_face_svg_id": "avatar_maggotkin_of_nurgle",
            "six_face_label": "Tri-Globe Crest",
            "crit_particle": "plague_cloud_burst",
            "crit_sound": "goo_splat"
        }
    },
    {
        "id": "dice_aos_ironjawz",
        "name": "Ironjawz Megaboss Yellow Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Hammered 'Ardboy yellow iron plate dice with black tusk pips. Displays the Gorkamorka Iron Jaw on the 6th face!",
        "payload": {
            "faction": "Orruk Warclans",
            "die_bg": "linear-gradient(135deg, #713f12 0%, #ca8a04 100%)",
            "pip_color": "#09090b",
            "six_face_svg_id": "avatar_orruk_warclans",
            "six_face_label": "Iron Jaw Tusk",
            "crit_particle": "ork_dakka_sparks",
            "crit_sound": "waaagh_yell"
        }
    },
    {
        "id": "dice_aos_slavestodarkness",
        "name": "Slaves to Darkness Iron Star Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Pitiless Varanguard black iron dice with infernal flame pips. Displays Archaon's Chaos Star on the 6th face!",
        "payload": {
            "faction": "Slaves to Darkness",
            "die_bg": "linear-gradient(135deg, #1c1917 0%, #450a0a 100%)",
            "pip_color": "#f97316",
            "six_face_svg_id": "avatar_slaves_to_darkness",
            "six_face_label": "Chaos Ascendant Star",
            "crit_particle": "infernal_fire_storm",
            "crit_sound": "warp_howl"
        }
    },
    {
        "id": "dice_aos_nighthaunt",
        "name": "Nighthaunt Spectral Mist Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Ghostly pale aquamarine dice with banshee lime pips. Displays Lady Olynder's Weeping Skull on the 6th face!",
        "payload": {
            "faction": "Nighthaunt",
            "die_bg": "linear-gradient(135deg, #042f2e 0%, #0d9488 100%)",
            "pip_color": "#5eead4",
            "six_face_svg_id": "avatar_nighthaunt",
            "six_face_label": "Spectral Veiled Skull",
            "crit_particle": "spectral_shriek_mist",
            "crit_sound": "banshee_shriek"
        }
    },
    {
        "id": "dice_aos_daughtersofkhaine",
        "name": "Daughters of Khaine Dagger Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Polished obsidian and bloody crimson dice with silver pips. Displays Khaine's Sacrifice Dagger on the 6th face!",
        "payload": {
            "faction": "Daughters of Khaine",
            "die_bg": "linear-gradient(135deg, #4c0519 0%, #9f1239 100%)",
            "pip_color": "#f8fafc",
            "six_face_svg_id": "avatar_daughters_of_khaine",
            "six_face_label": "Khaine Sacrifice Dagger",
            "crit_particle": "blood_frenzy_splatter",
            "crit_sound": "blade_shing"
        }
    },
    {
        "id": "dice_aos_citiesofsigmar",
        "name": "Cities of Sigmar Freeguild Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Castelite shield-wall navy dice with gold pips. Displays the Freeguild Rampant Lion on the 6th face!",
        "payload": {
            "faction": "Cities of Sigmar",
            "die_bg": "linear-gradient(135deg, #172554 0%, #1d4ed8 100%)",
            "pip_color": "#fde047",
            "six_face_svg_id": "avatar_cities_of_sigmar",
            "six_face_label": "Freeguild Lion",
            "crit_particle": "castelite_bullet_sparks",
            "crit_sound": "cannon_fire"
        }
    },
    {
        "id": "dice_aos_kharadron",
        "name": "Kharadron Aether-Gold Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Sky-fleet burnished brass dice with aether-blue pips. Displays the Endrinrigger compass on the 6th face!",
        "payload": {
            "faction": "Kharadron Overlords",
            "die_bg": "linear-gradient(135deg, #78350f 0%, #d97706 100%)",
            "pip_color": "#38bdf8",
            "six_face_svg_id": "avatar_kharadron_overlords",
            "six_face_label": "Aether Compass",
            "crit_particle": "aether_steam_vent",
            "crit_sound": "sky_cannon"
        }
    },
    {
        "id": "dice_aos_fyreslayers",
        "name": "Fyreslayers Ur-Gold Forge Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Magma rock dice with burning Ur-Gold pips. Displays Grimnir's Flaming Greataxe on the 6th face!",
        "payload": {
            "faction": "Fyreslayers",
            "die_bg": "linear-gradient(135deg, #450a0a 0%, #c2410c 100%)",
            "pip_color": "#fef08a",
            "six_face_svg_id": "avatar_fyreslayers",
            "six_face_label": "Grimnir Greataxe",
            "crit_particle": "magma_blast",
            "crit_sound": "magma_blast"
        }
    },
    {
        "id": "dice_aos_idoneth",
        "name": "Idoneth Deepkin Abyssal Pearl Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Ethersea aquamarine sea-glass dice with shimmering pearl pips. Displays the Isharann Wave Rune on the 6th face!",
        "payload": {
            "faction": "Idoneth Deepkin",
            "die_bg": "linear-gradient(135deg, #083344 0%, #0891b2 100%)",
            "pip_color": "#e0f2fe",
            "six_face_svg_id": "avatar_idoneth_deepkin",
            "six_face_label": "Isharann Wave",
            "crit_particle": "abyssal_wave_crash",
            "crit_sound": "deep_surge"
        }
    },
    {
        "id": "dice_aos_lumineth",
        "name": "Lumineth Sunmetal Prism Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Hyshian crystal white dice with azure pips. Displays the Teclian Twin Sun Crescent on the 6th face!",
        "payload": {
            "faction": "Lumineth Realm-lords",
            "die_bg": "linear-gradient(135deg, #f8fafc 0%, #e0f2fe 100%)",
            "pip_color": "#0284c7",
            "six_face_svg_id": "avatar_lumineth_realm_lords",
            "six_face_label": "Twin Sun Crescent",
            "crit_particle": "solar_prism_flash",
            "crit_sound": "chime_sanctified"
        }
    },
    {
        "id": "dice_aos_flesheater",
        "name": "Flesh-eater Courts Bone Chalice Dice",
        "game_system": "aos",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🎲",
        "description": "Aged parchment and blood-spattered dice with marrow pips. Displays the Archregent Bone Chalice on the 6th face!",
        "payload": {
            "faction": "Flesh-eater Courts",
            "die_bg": "linear-gradient(135deg, #4c0519 0%, #fef3c7 100%)",
            "pip_color": "#991b1b",
            "six_face_svg_id": "avatar_flesh_eater_courts",
            "six_face_label": "Bone Chalice",
            "crit_particle": "bat_swarm_burst",
            "crit_sound": "ghoul_shriek"
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
        "cost_glory": 1250,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {"peak_elo": 1700.0, "label": "Requires All-Time Peak Elo 1700+"},
        "icon": "✨",
        "description": "Liquid metal borders pulsing with gold and silver transmutation alchemy from the Realm of Metal.",
        "payload": {
            "css_class": "frame-realm-chamon",
            "border_color": "#fbbf24",
            "border_glow": "0 0 24px rgba(251, 191, 36, 0.5), inset 0 0 14px rgba(251, 191, 36, 0.2)"
        }
    },
    {
        "id": "frame_ghur_feral",
        "name": "Ghur Feral Amber Border",
        "game_system": "aos",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "epic",
        "cost_glory": 1250,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {"peak_elo": 1850.0, "label": "Requires All-Time Peak Elo 1850+"},
        "icon": "🐾",
        "description": "Savage amber bone and beast-claw perimeter imbued with primeval predator fury from the Realm of Beasts.",
        "payload": {
            "css_class": "frame-ghur-feral",
            "border_color": "#d97706",
            "border_glow": "0 0 22px rgba(217, 119, 6, 0.5)"
        }
    },
    {
        "id": "frame_shyish_obsidian",
        "name": "Shyish Obsidian Death-Shroud",
        "game_system": "aos",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "legendary",
        "cost_glory": 1950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {"peak_elo": 1900.0, "label": "Requires All-Time Peak Elo 1900+"},
        "icon": "💀",
        "description": "Black amethyst obsidian frame weeping ghostly emerald ectoplasm from the Realm of Death.",
        "payload": {
            "css_class": "frame-peak-necrons",
            "border_color": "#14b8a6",
            "border_glow": "0 0 28px rgba(20, 184, 166, 0.65)"
        }
    },
    {
        "id": "frame_hysh_celestial",
        "name": "Hyshian Solar Corona",
        "game_system": "aos",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "legendary",
        "cost_glory": 2950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": {"peak_elo": 2000.0, "label": "Requires All-Time Peak Elo 2000+"},
        "icon": "☀️",
        "description": "Prismatic crystal corona radiating pure illumination light from the Realm of Light.",
        "payload": {
            "css_class": "frame-peak-primarch",
            "border_color": "#fde047",
            "border_glow": "0 0 35px rgba(253, 224, 71, 0.75)"
        }
    },

    # ── WING 3: FACTION SIGILS (ALL 24 AOS FACTIONS!) ──
    {
        "id": "avatar_stormcast_eternals",
        "name": "Twin-Tailed Comet",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "⚡",
        "description": "Blazing twin-tailed omen of the God-King Sigmar forged in Azyrite lightning gold.",
        "payload": {"faction": "Stormcast Eternals", "badge_color": "#f59e0b", "avatar_icon": "⚡"}
    },
    {
        "id": "avatar_khorne_bloodbound",
        "name": "Khorne Skull Rune",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🩸",
        "description": "Angular brazen skull rune quenched in the blood of mortal champions. Blood for the Blood God!",
        "payload": {"faction": "Blades of Khorne", "badge_color": "#dc2626", "avatar_icon": "🩸"}
    },
    {
        "id": "avatar_gloomspite_gitz",
        "name": "Grinning Bad Moon",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🌙",
        "description": "Cackling yellow sickle moon wreathed in subterranean gloom and hallucinogenic fungus spores.",
        "payload": {"faction": "Gloomspite Gitz", "badge_color": "#eab308", "avatar_icon": "🌙"}
    },
    {
        "id": "avatar_soulblight_gravelords",
        "name": "Soulblight Crimson Bat Crest",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🦇",
        "description": "Vampiric blood-chalice crowned with outspread midnight bat wings. The Dynasty of Death.",
        "payload": {"faction": "Soulblight Gravelords", "badge_color": "#be123c", "avatar_icon": "🦇"}
    },
    {
        "id": "avatar_sylvaneth",
        "name": "Sylvaneth Spirit-Pod Heart",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🌿",
        "description": "Living heart-pod of Ghyran spiraling with vibrant emerald growth and autumn thorns. Nature's wrath.",
        "payload": {"faction": "Sylvaneth", "badge_color": "#16a34a", "avatar_icon": "🌿"}
    },
    {
        "id": "avatar_beasts_of_chaos",
        "name": "Beasts of Chaos Herd-Horn",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🐏",
        "description": "Primeval curved horns of the Gor beast herdstone. Despoilers of civilization.",
        "payload": {"faction": "Beasts of Chaos", "badge_color": "#b45309", "avatar_icon": "🐏"}
    },
    {
        "id": "avatar_cities_of_sigmar",
        "name": "Cities of Sigmar Freeguild Lion",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🦁",
        "description": "Castelite shield wall bearing the golden Freeguild rampant lion of the Dawnbringer crusades.",
        "payload": {"faction": "Cities of Sigmar", "badge_color": "#3b82f6", "avatar_icon": "🦁"}
    },
    {
        "id": "avatar_daughters_of_khaine",
        "name": "Daughters of Khaine Morathi Dagger",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🗡️",
        "description": "Bloody sacrifice blade of the Shadow Queen Morathi flanked by serpentine wings.",
        "payload": {"faction": "Daughters of Khaine", "badge_color": "#e11d48", "avatar_icon": "🗡️"}
    },
    {
        "id": "avatar_disciples_of_tzeentch",
        "name": "Disciples of Tzeentch Fate Iris",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "👁️",
        "description": "Shifting nine-fold fate vortex with mystic iris and avian feather of the Architect of Fate.",
        "payload": {"faction": "Disciples of Tzeentch", "badge_color": "#06b6d4", "avatar_icon": "👁️"}
    },
    {
        "id": "avatar_flesh_eater_courts",
        "name": "Flesh-eater Courts Bone Chalice",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🍷",
        "description": "Deluded royal bone goblet overflowing with dark vintage blood. The Summercourt feast.",
        "payload": {"faction": "Flesh-eater Courts", "badge_color": "#be123c", "avatar_icon": "🍷"}
    },
    {
        "id": "avatar_fyreslayers",
        "name": "Fyreslayers Grimnir Axe",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🪓",
        "description": "Magma greataxe glowing with sacred molten Ur-Gold runes of the Shattered God.",
        "payload": {"faction": "Fyreslayers", "badge_color": "#f97316", "avatar_icon": "🪓"}
    },
    {
        "id": "avatar_hedonites_of_slaanesh",
        "name": "Hedonites Slaaneshi Curve",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🪞",
        "description": "Sensuous Slaaneshi curved glyph with golden mirror of obsession and excess.",
        "payload": {"faction": "Hedonites of Slaanesh", "badge_color": "#d946ef", "avatar_icon": "🪞"}
    },
    {
        "id": "avatar_idoneth_deepkin",
        "name": "Idoneth Ethersea Wave Rune",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🌊",
        "description": "Abyssal ocean wave rune with glowing ethersea pearl. Raiding from the depths of the trenches.",
        "payload": {"faction": "Idoneth Deepkin", "badge_color": "#06b6d4", "avatar_icon": "🌊"}
    },
    {
        "id": "avatar_kharadron_overlords",
        "name": "Kharadron Endrin Compass",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🧭",
        "description": "Aether-gold sky-fleet navigation compass with brass cogwork. Profit and progress.",
        "payload": {"faction": "Kharadron Overlords", "badge_color": "#eab308", "avatar_icon": "🧭"}
    },
    {
        "id": "avatar_lumineth_realm_lords",
        "name": "Lumineth Twin Sun Crescent",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "☀️",
        "description": "Teclian Twin Sun crescent with crystal prism rays of Hysh. Purity and martial balance.",
        "payload": {"faction": "Lumineth Realm-lords", "badge_color": "#38bdf8", "avatar_icon": "☀️"}
    },
    {
        "id": "avatar_maggotkin_of_nurgle",
        "name": "Maggotkin Nurgle Tri-Globe",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🪰",
        "description": "Three rotting bubo globes oozing virulent green gifts of decay. Grandfather's delight.",
        "payload": {"faction": "Maggotkin of Nurgle", "badge_color": "#84cc16", "avatar_icon": "🪰"}
    },
    {
        "id": "avatar_nighthaunt",
        "name": "Nighthaunt Veiled Skull",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "👻",
        "description": "Spectral veiled weeping ghost skull in pale banshee mist. Endless torment.",
        "payload": {"faction": "Nighthaunt", "badge_color": "#2dd4bf", "avatar_icon": "👻"}
    },
    {
        "id": "avatar_ogor_mawtribes",
        "name": "Ogor Gulping Tooth Ring",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🍖",
        "description": "Iron gut-plate tooth ring of the Gulping God with crossed butcher cleavers.",
        "payload": {"faction": "Ogor Mawtribes", "badge_color": "#b45309", "avatar_icon": "🍖"}
    },
    {
        "id": "avatar_orruk_warclans",
        "name": "Orruk Warclans Yellow Jaw",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🐗",
        "description": "Beaten yellow iron jaw plate with razor tusks. WAAAGH! for the Mortal Realms.",
        "payload": {"faction": "Orruk Warclans", "badge_color": "#eab308", "avatar_icon": "🐗"}
    },
    {
        "id": "avatar_ossiarch_bonereapers",
        "name": "Ossiarch Nadirite Soul-Seal",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "💀",
        "description": "Katakros mortuary shield seal in teal soul-flame and bone ivory. The Tithe is due.",
        "payload": {"faction": "Ossiarch Bonereapers", "badge_color": "#14b8a6", "avatar_icon": "💀"}
    },
    {
        "id": "avatar_seraphon",
        "name": "Seraphon Starborne Sun-Glyph",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🦎",
        "description": "Starborne temple-city turquoise solar disc with gold sun-rays. The Great Plan unfolds.",
        "payload": {"faction": "Seraphon", "badge_color": "#06b6d4", "avatar_icon": "🦎"}
    },
    {
        "id": "avatar_skaven",
        "name": "Skaven Horned Rat Bell",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🐀",
        "description": "Triangular warpstone rune with gnawing teeth and tolling toxic bell. Die-die man-things!",
        "payload": {"faction": "Skaven", "badge_color": "#84cc16", "avatar_icon": "🐀"}
    },
    {
        "id": "avatar_slaves_to_darkness",
        "name": "Slaves to Darkness Chaos Star",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "legendary",
        "cost_glory": 950,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "👑",
        "description": "Archaon's Eight-Pointed Star of Chaos Ascendant centered with the Crown of Domination.",
        "payload": {"faction": "Slaves to Darkness", "badge_color": "#ea580c", "avatar_icon": "👑"}
    },
    {
        "id": "avatar_sons_of_behemat",
        "name": "Sons of Behemat Gargant Footprint",
        "game_system": "aos",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 550,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "👣",
        "description": "Colossal mountain-crushing footprint of the Mega-Gargant flattening temple spires.",
        "payload": {"faction": "Sons of Behemat", "badge_color": "#d97706", "avatar_icon": "👣"}
    },

    # ── WING 4: TITLES (AOS) ──
    {
        "id": "title_lord_celestant",
        "name": "Lord-Celestant",
        "game_system": "aos",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "epic",
        "cost_glory": 850,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Supreme martial rank bestowed upon the commanders of the Stormhost chambers.",
        "payload": {"css_class": "title-badge-unbroken", "title_text": "Lord-Celestant"}
    },
    {
        "id": "title_everchosen_herald",
        "name": "Herald of the Everchosen",
        "game_system": "aos",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "legendary",
        "cost_glory": 1450,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "High honor proclaiming personal allegiance to the Grand Marshal of the Apocalypse.",
        "payload": {"css_class": "title-badge-warp", "title_text": "Herald of the Everchosen"}
    },
    {
        "id": "title_ghoul_king",
        "name": "Abhorrant Ghoul King",
        "game_system": "aos",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 500,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Deluded sovereign of the cannibal feasting halls. Noble in mind, horrific in flesh.",
        "payload": {"css_class": "title-badge-forge", "title_text": "Abhorrant Ghoul King"}
    },
    {
        "id": "title_bad_moon_chosen",
        "name": "Touched by da Bad Moon",
        "game_system": "aos",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 500,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Granted to loonbosses who received the cackling lunar lunacy of the Gloomspite.",
        "payload": {"css_class": "title-badge-unbroken", "title_text": "Touched by da Bad Moon"}
    },
    {
        "id": "title_anointed_of_khaine",
        "name": "Anointed of Khaine",
        "game_system": "aos",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "epic",
        "cost_glory": 850,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "High Priestess rank drenched in the sacred boiling blood cauldrons of Khaine.",
        "payload": {"css_class": "title-badge-warp", "title_text": "Anointed of Khaine"}
    },
    {
        "id": "title_arkanaut_admiral",
        "name": "Arkanaut Admiral",
        "game_system": "aos",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "epic",
        "cost_glory": 850,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Commander of the Kharadron sky-fleets, adhering strictly to the Chamonite Code.",
        "payload": {"css_class": "title-badge-forge", "title_text": "Arkanaut Admiral"}
    },
    {
        "id": "title_slann_starmaster",
        "name": "Slann Starmaster",
        "game_system": "aos",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "legendary",
        "cost_glory": 1450,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Ancient cosmic geomancer dreaming armies into physical reality across the stars.",
        "payload": {"css_class": "title-badge-strategist", "title_text": "Slann Starmaster"}
    },
    {
        "id": "title_clawlord_of_blight",
        "name": "Clawlord of the Under-Empire",
        "game_system": "aos",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 500,
        "is_consumable": False,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🏷️",
        "description": "Backstabbing Skaven warlord leading swarming vermin hordes through the gnawholes.",
        "payload": {"css_class": "title-badge-unbroken", "title_text": "Clawlord of the Under-Empire"}
    },

    # ── WING 5: PLAYER POKES (AOS) ──
    {
        "id": "poke_sigmar_bolt",
        "name": "Azyrite Lightning Zap (5x Pack)",
        "game_system": "aos",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "common",
        "cost_glory": 150,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "⚡",
        "description": "Hurl an Azyrite thunderbolt of holy judgment at a rival commander. 5 charges per bundle.",
        "payload": {
            "toast_message": "⚡ Azyrite lightning strike struck {target}! For the God-King Sigmar!",
            "sound_cue": "thunder_zap",
            "visual_effect": "lightning_flash"
        }
    },
    {
        "id": "poke_squig_nibble",
        "name": "Squig Nibble Poke (5x Pack)",
        "game_system": "aos",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "common",
        "cost_glory": 150,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🍄",
        "description": "Send a bounding red squig to chomp your opponent with razor teeth. 5 charges per bundle.",
        "payload": {
            "toast_message": "🍄 Gnasher squig took a juicy bite out of {target}! Gobbos rule!",
            "sound_cue": "chomp_snap",
            "visual_effect": "teeth_bite"
        }
    },
    {
        "id": "poke_khorne_roar",
        "name": "Khorne Blood Roar (5x Pack)",
        "game_system": "aos",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "common",
        "cost_glory": 150,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🩸",
        "description": "Bellow a savage war cry of Khorne to demand blood and skulls from your rival. 5 charges per bundle.",
        "payload": {
            "toast_message": "🩸 Blood roar bellowed at {target}! Skulls for the Skull Throne!",
            "sound_cue": "krump_thud",
            "visual_effect": "shake_impact"
        }
    },
    {
        "id": "poke_nighthaunt_shriek",
        "name": "Banshee Spectral Shriek (5x Pack)",
        "game_system": "aos",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "common",
        "cost_glory": 250,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "👻",
        "description": "Send a terrifying Tomb Banshee shriek through your rival's card. 5 charges per bundle.",
        "payload": {
            "toast_message": "👻 Tomb Banshee spectral shriek chilled {target} to the marrow!",
            "sound_cue": "banshee_shriek",
            "visual_effect": "spectral_mist"
        }
    },
    {
        "id": "poke_khorne_blood_tithe",
        "name": "Blood Tithe Challenge (5x Pack)",
        "game_system": "aos",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "epic",
        "cost_glory": 450,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🩸",
        "description": "Slam the brass brand of Khorne upon an opponent. Triggers burning blood embers, flaming skull runes, and a 24-hour Blood Tithe bounty.",
        "payload": {
            "toast_message": "🩸 Blood Tithe demanded from {target}! SKULLS FOR THE SKULL THRONE!",
            "sound_cue": "brass_clash",
            "visual_effect": "burning_blood_embers",
            "sign_in_effect": "blood_tithe",
            "hex_duration_hours": 24,
            "hex_badge_title": "Blood Tithed",
            "hex_banner_desc": "Marked for slaughter in Khorne's arena by {sender}.",
            "css_glow": "#b91c1c"
        }
    },
    {
        "id": "poke_bad_moon_looming",
        "name": "Bad Moon Looming Hex (5x Pack)",
        "game_system": "aos",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "rare",
        "cost_glory": 250,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🌙",
        "description": "Curse a rival with the lunatic grin of the Bad Moon. Triggers a glowing yellow crescent moon swinging down with lunatic cackles for 24h.",
        "payload": {
            "toast_message": "🌙 Da Bad Moon grins down on {target}! Loonies rise!",
            "sound_cue": "loonboss_giggle",
            "visual_effect": "bad_moon_swing",
            "sign_in_effect": "bad_moon",
            "hex_duration_hours": 24,
            "hex_badge_title": "Moonstruck Lunatic",
            "hex_banner_desc": "Bewitched by the lunatic cackling Bad Moon of {sender}.",
            "css_glow": "#facc15"
        }
    },
    {
        "id": "poke_sigmar_comet_strike",
        "name": "Sigmarite Comet Strike (3x Pack)",
        "game_system": "aos",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "legendary",
        "cost_glory": 750,
        "is_consumable": True,
        "bundle_count": 3,
        "prerequisite": None,
        "icon": "☄️",
        "description": "Summon the Twin-Tailed Comet blazing down from High Azyr. Blinding white-gold celestial explosion with 24-hour consecrated rival challenge.",
        "payload": {
            "toast_message": "☄️ Celestial comet crashed into {target}! Sigmar's thunder reigns!",
            "sound_cue": "comet_thunderclap",
            "visual_effect": "celestial_comet_blast",
            "sign_in_effect": "comet_strike",
            "hex_duration_hours": 24,
            "hex_badge_title": "Comet Struck",
            "hex_banner_desc": "Struck by the Twin-Tailed Comet called down by Lord {sender}.",
            "css_glow": "#38bdf8"
        }
    },
    {
        "id": "poke_tzeentch_twist",
        "name": "Tzeentchian Twist of Fate (5x Pack)",
        "game_system": "aos",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "epic",
        "cost_glory": 450,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🔮",
        "description": "Cast a kaleidoscopic mirror hex of the Architect of Fate. Screen subtly shifts with prismatic warp hues and twisted fate runes for 24h.",
        "payload": {
            "toast_message": "🔮 Threads of destiny severed around {target}! All according to plan!",
            "sound_cue": "fate_shimmer",
            "visual_effect": "prismatic_kaleidoscope",
            "sign_in_effect": "twist_of_fate",
            "hex_duration_hours": 24,
            "hex_badge_title": "Fate Twisted",
            "hex_banner_desc": "Destiny manipulated by the Tzeentchian warp sorcery of {sender}.",
            "css_glow": "#818cf8"
        }
    },
    {
        "id": "poke_nurgle_rot_bell",
        "name": "Toll of the Seventh Bell (5x Pack)",
        "game_system": "aos",
        "wing": "pokes",
        "slot": "player_interaction",
        "rarity": "rare",
        "cost_glory": 250,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🔔",
        "description": "Ring the corroded bronze bell of grandfather Nurgle. Triggers resonant tolling bell echoes with bubbling green miasma for 24h.",
        "payload": {
            "toast_message": "🔔 The Seventh Bell tolls for {target}! Seven blessings upon thee!",
            "sound_cue": "bell_toll",
            "visual_effect": "plague_miasma_bubble",
            "sign_in_effect": "plague_bell",
            "hex_duration_hours": 24,
            "hex_badge_title": "Tainted by Miasma",
            "hex_banner_desc": "Enveloped in grandfather's rotting plague miasma by {sender}.",
            "css_glow": "#84cc16"
        }
    }
]

# Fast Lookup Index
ARMORY_INDEX: Dict[str, Dict[str, Any]] = {item["id"]: item for item in ARMORY_ITEMS}

# Aliases for backwards compatibility
ARMORY_ALIASES: Dict[str, str] = {
    "avatar_40k_ultramarines": "avatar_adeptus_astartes",
    "avatar_40k_world_eaters": "avatar_world_eaters",
    "avatar_40k_necrons": "avatar_necrons",
    "avatar_40k_orks": "avatar_orks",
    "avatar_40k_custodes": "avatar_adeptus_custodes",
    "avatar_aos_stormcast": "avatar_stormcast_eternals",
    "avatar_aos_gloomspite": "avatar_gloomspite_gitz",
    "frame_molten_core": "frame_peak_high_warlord"
}


def get_armory_catalog(
    user_vault: Optional[Dict[str, Any]] = None,
    user_crest_tier: int = 1,
    game_system: str = "40k",
    user_peak_elo: float = 1500.0
) -> Dict[str, Any]:
    """Returns the game-specific Armory catalog with user ownership flags, equipped status, and affordability."""
    vault = user_vault or {"inventory": {}, "equipped": {}}
    inventory = vault.get("inventory", {})
    equipped_all = vault.get("equipped", {})

    req_sys = (game_system or "40k").lower().strip()
    if req_sys not in ("40k", "aos"):
        req_sys = "40k"

    # Support game-specific equipped isolation: vault["equipped"][sys] or fallback to flat equipped
    equipped = equipped_all.get(req_sys) if isinstance(equipped_all.get(req_sys), dict) else equipped_all

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


def get_item_by_id(item_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve an item by its unique ID with alias resolution."""
    if not item_id:
        return None
    canonical = ARMORY_ALIASES.get(item_id, item_id)
    return ARMORY_INDEX.get(canonical) or ARMORY_INDEX.get(item_id)