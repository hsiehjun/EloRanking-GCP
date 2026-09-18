"""OmniTactica Retribution Armory Catalog Registry.

Defines game-specific purchasable items across Warhammer 40,000 and Age of Sigmar:
- Custom Dice Skins with Critical Burst VFX
- Profile Card Holo-Foils, Molten Core & Telemetry Auras
- Faction Sigil Avatars (Space Marines, Chaos, Necrons, Aeldari, Orks, Tyranids, Custodes, Tau, Guard)
- Authentic Faction Titles & Identity Flairs
- Player Pokes (Inquisitorial Smite, WAAAGH! Club, Sigmar Zap, Squig Nibble)

All items are 100% functional, game-system isolated, and powered by a unified Glory wallet.
"""

from typing import Dict, List, Any, Optional

# ── Armory Wing Definitions (Per Game System) ──
ARMORY_WINGS_40K = {
    "dice_forge": {
        "id": "dice_forge",
        "title": "The Dice Forge",
        "icon": "🎲",
        "subtitle": "40K Tournament Dice & Crit 6 Particle VFX",
        "description": "Custom 40k resin materials, glowing pips, and ionized plasma/magma bursts on natural 6s in the Live Tracker."
    },
    "profile_forge": {
        "id": "profile_forge",
        "title": "Profile Forge",
        "icon": "✨",
        "subtitle": "Holo-Foil Finishes & Card Aura Halos",
        "description": "Prismatic animated holo-foil sweeps, molten volcanic borders, and neon telemetry grids for your Hero Card."
    },
    "avatars": {
        "id": "avatars",
        "title": "Faction Sigils",
        "icon": "👤",
        "subtitle": "Faction Heraldry & Crest Avatars",
        "description": "Authentic chapter, legion, dynasty, craftworld, and hive fleet sigils to replace your player avatar across the platform."
    },
    "titles": {
        "id": "titles",
        "title": "Munitorum Titles",
        "icon": "🏷️",
        "subtitle": "Faction & Mil-Spec Player Subtitles",
        "description": "Lore-accurate faction honors displayed beneath your username on the Global Leaderboard, Tournament Pairings, and Scorecards."
    },
    "pokes": {
        "id": "pokes",
        "title": "Tactical Pokes",
        "icon": "👉",
        "subtitle": "Interactive Opponent Pokes & Reactions",
        "description": "Fun tactical pokes (Inquisitorial Smite, Ork WAAAGH! Club, Nurgle Sneeze) to poke opponents in live matches and profiles."
    }
}

ARMORY_WINGS_AOS = {
    "dice_forge": {
        "id": "dice_forge",
        "title": "The Celestial Forge",
        "icon": "🎲",
        "subtitle": "Realm Dice & Critical Burst VFX",
        "description": "Azyrite lightning, Aqshy flame, and Realmstone crystal dice in the Mortal Realms Live Tracker."
    },
    "profile_forge": {
        "id": "profile_forge",
        "title": "Realmstone Forge",
        "icon": "✨",
        "subtitle": "Holo-Foil Finishes & Mortal Realm Auras",
        "description": "Shyish grave mist, Hysh celestial light, and Ghyran life-energy borders for your Hero Card."
    },
    "avatars": {
        "id": "avatars",
        "title": "Grand Alliance Sigils",
        "icon": "👤",
        "subtitle": "Realm Heraldry & Pantheon Avatars",
        "description": "Sigmarite, Bloodbound, Skaven, and Gloomspite emblems to adorn your player avatar."
    },
    "titles": {
        "id": "titles",
        "title": "Realm Titles",
        "icon": "🏷️",
        "subtitle": "Grand Alliance Player Subtitles",
        "description": "Mythic titles from the Eight Realms displayed beneath your username across OmniTactica."
    },
    "pokes": {
        "id": "pokes",
        "title": "Mortal Realm Pokes",
        "icon": "👉",
        "subtitle": "Realm Pokes & Challenges",
        "description": "Interactive pokes (Sigmarite Zap, Squig Nibble, Khorne Skull Challenge) to send to rivals and clubmates."
    }
}

ARMORY_RARITY = {
    "common": {
        "label": "Standard Issue",
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

ARMORY_ITEMS: List[Dict[str, Any]] = [
    # ── 40K DICE FORGE ──
    {
        "id": "dice_warpfire_plasma",
        "game_system": "40k",
        "name": "Warpfire Plasma Dice",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 450,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "🟢",
        "description": "Cast in unstable ionized green resin with radiant white pips. Rolling a natural 6 erupts in ionized plasma flares.",
        "payload": {
            "theme": "warpfire_plasma",
            "die_bg": "radial-gradient(circle at 30% 30%, #10b981 0%, #064e3b 85%, #022c22 100%)",
            "pip_color": "#ecfdf5",
            "pip_glow": "0 0 6px rgba(52, 211, 153, 0.9)",
            "crit_effect": "plasma_burst",
            "crit_color": "#34d399",
            "roll_sound": "plasma_surge"
        }
    },
    {
        "id": "dice_molten_magma",
        "game_system": "40k",
        "name": "Molten Magma Dice",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "rare",
        "cost_glory": 250,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "🌋",
        "description": "Obsidian volcanic stone laced with glowing heat fissures. Natural 6s trigger an incandescent ember blast.",
        "payload": {
            "theme": "molten_magma",
            "die_bg": "radial-gradient(circle at 30% 30%, #f97316 0%, #7c2d12 70%, #1c1917 100%)",
            "pip_color": "#fef08a",
            "pip_glow": "0 0 6px rgba(245, 158, 11, 0.9)",
            "crit_effect": "magma_blast",
            "crit_color": "#f59e0b",
            "roll_sound": "heavy_clatter"
        }
    },
    {
        "id": "dice_ceramite_white",
        "game_system": "40k",
        "name": "Imperial Ceramite Dice",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "common",
        "cost_glory": 100,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "⚪",
        "description": "Mil-spec tournament matte white ceramite with stark void-black pips. Crisp tournament acoustic resonance.",
        "payload": {
            "theme": "ceramite_white",
            "die_bg": "radial-gradient(circle at 35% 35%, #ffffff 0%, #e2e8f0 75%, #cbd5e1 100%)",
            "pip_color": "#0f172a",
            "pip_glow": "none",
            "crit_effect": "gold_spark",
            "crit_color": "#e2e8f0",
            "roll_sound": "crisp_resin"
        }
    },

    # ── 40K PROFILE FORGE ──
    {
        "id": "frame_astral_holofoil",
        "game_system": "40k",
        "name": "Astral Holo-Foil Shimmer",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "epic",
        "cost_glory": 500,
        "is_consumable": False,
        "prerequisite": {"career_crest_tier": 3, "label": "Requires Centurion (Crest Tier 3+)"},
        "icon": "🌈",
        "description": "Prismatic rainbow holographic foil overlay that sweeps across your Hero Card and Public Profile.",
        "payload": {
            "css_class": "frame-astral-holofoil",
            "border_glow": "0 0 25px rgba(168, 85, 247, 0.45)",
            "border_color": "#c084fc"
        }
    },
    {
        "id": "frame_molten_core",
        "game_system": "40k",
        "name": "Molten Core Aura",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "rare",
        "cost_glory": 300,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "🔥",
        "description": "Animated solar heat wave with drifting incandescent embers encasing your profile card border.",
        "payload": {
            "css_class": "frame-molten-core",
            "border_glow": "0 0 20px rgba(245, 158, 11, 0.4)",
            "border_color": "#f59e0b"
        }
    },
    {
        "id": "frame_cyber_matrix",
        "game_system": "40k",
        "name": "Tactica Neon Matrix",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "common",
        "cost_glory": 150,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "🌐",
        "description": "High-tech tactical cyan telemetry grid overlay with pulse sweep illumination.",
        "payload": {
            "css_class": "frame-cyber-matrix",
            "border_glow": "0 0 15px rgba(56, 189, 248, 0.35)",
            "border_color": "#38bdf8"
        }
    },

    # ── 40K FACTION SIGIL AVATARS ──
    {
        "id": "avatar_dark_angels",
        "game_system": "40k",
        "name": "Dark Angels Winged Sword",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
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
        "game_system": "40k",
        "name": "Necron Triarch Ankh",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
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
        "game_system": "40k",
        "name": "Imperial Aquila",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
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
        "game_system": "40k",
        "name": "Star of Chaos Undivided",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
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
        "game_system": "40k",
        "name": "Ork Iron Gob & WAAAGH! Skull",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
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
        "game_system": "40k",
        "name": "Black Templars Maltese Cross",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
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
        "game_system": "40k",
        "name": "Blood Angels Winged Drop",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
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
        "game_system": "40k",
        "name": "Space Wolves Iron Wolf",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
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
        "game_system": "40k",
        "name": "Auramite Custodes Raptor",
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
        "game_system": "40k",
        "name": "Mechanicus Opus Machina",
        "game_system": "40k",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
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
        "game_system": "40k",
        "name": "Hive Mind Synapse Carapace",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
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
        "game_system": "40k",
        "name": "T'au Fire Caste Sept Mark",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
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
        "game_system": "40k",
        "name": "Aeldari Rune of Ulthwé",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
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
        "game_system": "40k",
        "name": "Death Guard Corroded Helm",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "🪰",
        "description": "Corroded dark bronze Mark III power armour helmet with toxic orange visor and the three rotting spheres of Grandfather Nurgle.",
        "payload": {
            "avatar_icon": "🪰",
            "faction": "Death Guard",
            "badge_color": "#84cc16"
        }
    },

    # ── 40K MUNITORUM TITLES ──
    {
        "id": "title_40k_angel_of_death",
        "game_system": "40k",
        "name": "Title: Angel of Death",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 200,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "⚔️",
        "description": "Displays 'ANGEL OF DEATH' beneath your username across OmniTactica.",
        "payload": {
            "title_text": "Angel of Death",
            "css_class": "title-badge-astartes"
        }
    },
    {
        "id": "title_40k_shield_captain",
        "game_system": "40k",
        "name": "Title: Shield-Captain",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "epic",
        "cost_glory": 300,
        "is_consumable": False,
        "prerequisite": {"career_crest_tier": 3, "label": "Requires Centurion (Crest Tier 3+)"},
        "icon": "🦅",
        "description": "Displays 'SHIELD-CAPTAIN' in royal auramite gold beneath your username.",
        "payload": {
            "title_text": "Shield-Captain",
            "css_class": "title-badge-custodes"
        }
    },
    {
        "id": "title_40k_bane_of_warp",
        "game_system": "40k",
        "name": "Title: Bane of the Warp",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 200,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "🔮",
        "description": "Displays 'BANE OF THE WARP' with glowing violet void aura beneath your username.",
        "payload": {
            "title_text": "Bane of the Warp",
            "css_class": "title-badge-warp"
        }
    },
    {
        "id": "title_40k_warmaster_chaos",
        "game_system": "40k",
        "name": "Title: Warmaster of Chaos",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "epic",
        "cost_glory": 350,
        "is_consumable": False,
        "prerequisite": {"career_crest_tier": 4, "label": "Requires Force Commander (Crest Tier 4+)"},
        "icon": "⭐",
        "description": "Displays 'WARMASTER OF CHAOS' in deep obsidian and blood crimson.",
        "payload": {
            "title_text": "Warmaster of Chaos",
            "css_class": "title-badge-chaos"
        }
    },
    {
        "id": "title_40k_phaeron_infinite",
        "game_system": "40k",
        "name": "Title: Phaeron of the Infinite",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 250,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "⏳",
        "description": "Displays 'PHAERON OF THE INFINITE' in luminous dynastic green.",
        "payload": {
            "title_text": "Phaeron of the Infinite",
            "css_class": "title-badge-necron"
        }
    },
    {
        "id": "title_40k_waaagh_boss",
        "game_system": "40k",
        "name": "Title: Da Biggest Boss",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 200,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "💥",
        "description": "Displays 'DA BIGGEST BOSS' in bold ork glyph styling.",
        "payload": {
            "title_text": "Da Biggest Boss",
            "css_class": "title-badge-ork"
        }
    },
    {
        "id": "title_40k_grand_strategist",
        "game_system": "40k",
        "name": "Title: Grand Strategist",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "epic",
        "cost_glory": 350,
        "is_consumable": False,
        "prerequisite": {"career_crest_tier": 4, "label": "Requires Force Commander (Crest Tier 4+)"},
        "icon": "🎖️",
        "description": "Prestigious theater-level title awarded to veteran battlefield commanders.",
        "payload": {
            "title_text": "Grand Strategist",
            "css_class": "title-badge-strategist"
        }
    },
    {
        "id": "title_40k_the_unbroken",
        "game_system": "40k",
        "name": "Title: The Unbroken",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "common",
        "cost_glory": 100,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "🗡️",
        "description": "Displays 'THE UNBROKEN' in stark steel silver.",
        "payload": {
            "title_text": "The Unbroken",
            "css_class": "title-badge-unbroken"
        }
    },

    # ── 40K TACTICAL POKES ──
    {
        "id": "poke_40k_inquisitor_smite",
        "game_system": "40k",
        "name": "Inquisitorial Smite (5-Pack)",
        "wing": "pokes",
        "slot": "consumable_poke",
        "rarity": "common",
        "cost_glory": 25,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "⚡",
        "description": "Poke an opponent or clubmate with an Inquisitorial decree! Broadcasts an animated thunderbolt poke.",
        "payload": {
            "poke_type": "smite",
            "icon": "⚡",
            "label": "Inquisitorial Smite",
            "poke_banner": "zapped you with an Inquisitorial Smite! ⚡"
        }
    },
    {
        "id": "poke_40k_ork_waaagh",
        "game_system": "40k",
        "name": "WAAAGH! Club Poke (5-Pack)",
        "wing": "pokes",
        "slot": "consumable_poke",
        "rarity": "common",
        "cost_glory": 25,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "💥",
        "description": "OI! Pokes a player with an Ork Choppa clatter: 'GET BACK IN DA FIGHT, YA GIT!'",
        "payload": {
            "poke_type": "waaagh",
            "icon": "💥",
            "label": "WAAAGH! Club Poke",
            "poke_banner": "poked you with an Ork Choppa! OI! 💥"
        }
    },
    {
        "id": "poke_40k_commissar_blam",
        "game_system": "40k",
        "name": "Commissar's Warning (5-Pack)",
        "wing": "pokes",
        "slot": "consumable_poke",
        "rarity": "common",
        "cost_glory": 25,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🔫",
        "description": "A stern motivational poke: 'Eyes forward, soldier! The Emperor expects your duty!'",
        "payload": {
            "poke_type": "commissar",
            "icon": "🔫",
            "label": "Commissar's Warning",
            "poke_banner": "sent a Commissar's stern warning poke! 🔫"
        }
    },

    # ── AOS DICE FORGE ──
    {
        "id": "dice_aos_azyr_lightning",
        "game_system": "aos",
        "name": "Azyrite Celestial Dice",
        "wing": "dice_forge",
        "slot": "active_dice",
        "rarity": "epic",
        "cost_glory": 450,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "⚡",
        "description": "Forged in Sigmaron from celestial starlight. Natural 6s trigger an Azyrite thunder strike.",
        "payload": {
            "theme": "azyr_lightning",
            "die_bg": "radial-gradient(circle at 30% 30%, #38bdf8 0%, #0369a1 85%, #082f49 100%)",
            "pip_color": "#fef08a",
            "pip_glow": "0 0 6px rgba(56, 189, 248, 0.9)",
            "crit_effect": "lightning_blast",
            "crit_color": "#38bdf8",
            "roll_sound": "thunder_strike"
        }
    },

    # ── AOS PROFILE FORGE ──
    {
        "id": "frame_aos_shyish_grave",
        "game_system": "aos",
        "name": "Shyish Grave Mist Aura",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "epic",
        "cost_glory": 450,
        "is_consumable": False,
        "prerequisite": {"career_crest_tier": 3, "label": "Requires Centurion (Crest Tier 3+)"},
        "icon": "👻",
        "description": "Spectral ethereal mist of the Underworlds surrounding your profile card border.",
        "payload": {
            "css_class": "frame-shyish-grave",
            "border_glow": "0 0 25px rgba(45, 212, 191, 0.5)",
            "border_color": "#2dd4bf"
        }
    },

    # ── AOS FACTION SIGIL AVATARS ──
    {
        "id": "avatar_stormcast_eternals",
        "game_system": "aos",
        "name": "Twin-Tailed Comet",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "🔨",
        "description": "Sigmar's celestial twin-tailed herald with crossed Ghal Maraz warhammers of reforging and celestial justice.",
        "payload": {
            "avatar_icon": "🔨",
            "faction": "Stormcast Eternals",
            "badge_color": "#fbbf24"
        }
    },
    {
        "id": "avatar_khorne_bloodbound",
        "game_system": "aos",
        "name": "Khorne Skull Rune",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "💀",
        "description": "Blood for the Blood God! The eight-tiered brass rune carved in gore and glory of the Skull Throne.",
        "payload": {
            "avatar_icon": "💀",
            "faction": "Blades of Khorne",
            "badge_color": "#ef4444"
        }
    },
    {
        "id": "avatar_gloomspite_gitz",
        "game_system": "aos",
        "name": "Grinning Bad Moon",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "🌙",
        "description": "Da manic cackling visage of da Bad Moon with crooked nose and lunatic luck beaming down upon your grots.",
        "payload": {
            "avatar_icon": "🌙",
            "faction": "Gloomspite Gitz",
            "badge_color": "#eab308"
        }
    },
    {
        "id": "avatar_soulblight_gravelords",
        "game_system": "aos",
        "name": "Soulblight Crimson Bat Crest",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "🦇",
        "description": "Aristocratic vampiric crest with outstretched bat wings and the blood chalice of the Kastelai dynasty.",
        "payload": {
            "avatar_icon": "🦇",
            "faction": "Soulblight Gravelords",
            "badge_color": "#dc2626"
        }
    },
    {
        "id": "avatar_sylvaneth",
        "game_system": "aos",
        "name": "Sylvaneth Spirit-Pod Heart",
        "wing": "avatars",
        "slot": "active_avatar",
        "rarity": "rare",
        "cost_glory": 100,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "🍃",
        "description": "Living ironbark soul-rune resonant with the Spirit Song of Alarielle and the pulse of the Realm of Life.",
        "payload": {
            "avatar_icon": "🍃",
            "faction": "Sylvaneth",
            "badge_color": "#22c55e"
        }
    },

    # ── AOS REALM TITLES ──
    {
        "id": "title_aos_lord_celestant",
        "game_system": "aos",
        "name": "Title: Lord-Celestant",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 250,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "⚡",
        "description": "Displays 'LORD-CELESTANT' beneath your username across the Mortal Realms.",
        "payload": {
            "title_text": "Lord-Celestant",
            "css_class": "title-badge-stormcast"
        }
    },

    # ── AOS POKES ──
    {
        "id": "poke_aos_sigmar_zap",
        "game_system": "aos",
        "name": "Azyrite Lightning Zap (5-Pack)",
        "wing": "pokes",
        "slot": "consumable_poke",
        "rarity": "common",
        "cost_glory": 25,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "⚡",
        "description": "Zap a rival player with Azyrite celestial lightning!",
        "payload": {
            "poke_type": "lightning",
            "icon": "⚡",
            "label": "Azyrite Zap",
            "poke_banner": "zapped you with Azyrite celestial lightning! ⚡"
        }
    },
    {
        "id": "poke_aos_squig_bite",
        "game_system": "aos",
        "name": "Squig Nibble (5-Pack)",
        "wing": "pokes",
        "slot": "consumable_poke",
        "rarity": "common",
        "cost_glory": 25,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🍄",
        "description": "Send a hungry cave squig to give your opponent a friendly nibble!",
        "payload": {
            "poke_type": "squig",
            "icon": "🍄",
            "label": "Squig Nibble",
            "poke_banner": "sent a wild cave squig to nibble you! 🍄"
        }
    }
]

ARMORY_INDEX: Dict[str, Dict[str, Any]] = {item["id"]: item for item in ARMORY_ITEMS}

def get_armory_catalog(user_vault: Optional[Dict[str, Any]] = None, user_crest_tier: int = 1, game_system: str = "40k") -> Dict[str, Any]:
    """Returns the game-specific Armory catalog (40k or aos) with user ownership and equipped status."""
    gs = str(game_system or "40k").lower().strip()
    if gs not in ("40k", "aos"):
        gs = "40k"

    vault = user_vault or {"inventory": {}, "equipped": {}}
    inventory = vault.get("inventory") or {}
    equipped = vault.get("equipped") or {}

    wings = ARMORY_WINGS_AOS if gs == "aos" else ARMORY_WINGS_40K

    items_output = []
    for item in ARMORY_ITEMS:
        item_sys = item.get("game_system")
        if item_sys and item_sys != gs and item_sys != "universal":
            continue

        item_id = item["id"]
        is_owned = item_id in inventory
        is_equipped = False
        slot = item.get("slot")
        if slot and equipped.get(slot) == item_id:
            is_equipped = True

        prereq = item.get("prerequisite")
        meets_prereq = True
        prereq_reason = None
        if prereq:
            req_tier = prereq.get("career_crest_tier", 1)
            if user_crest_tier < req_tier:
                meets_prereq = False
                prereq_reason = prereq.get("label", f"Requires Crest Tier {req_tier}+")

        item_copy = dict(item)
        item_copy["is_owned"] = is_owned
        item_copy["is_equipped"] = is_equipped
        item_copy["meets_prerequisite"] = meets_prereq
        item_copy["prerequisite_reason"] = prereq_reason
        if item.get("is_consumable"):
            item_copy["charges_remaining"] = inventory.get(item_id, {}).get("quantity", 0) if is_owned else 0

        items_output.append(item_copy)

    return {
        "game_system": gs,
        "wings": wings,
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
    "avatar_aos_gloomspite": "avatar_gloomspite_gitz"
}

def get_item_by_id(item_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve an item by its unique ID with alias resolution."""
    if not item_id:
        return None
    canonical = ARMORY_ALIASES.get(item_id, item_id)
    return ARMORY_INDEX.get(canonical) or ARMORY_INDEX.get(item_id)
