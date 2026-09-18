"""OmniTactica Retribution Armory Catalog Registry.

Defines all purchasable items, skins, cosmetic enhancements, match reactions,
and tournament pick'em passes. Every item is 100% actionable and wired directly
into OmniTactica's frontend components (Dice Tray, Hero Card, Leaderboard, Scorecard).
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
    "titles": {
        "id": "titles",
        "title": "Munitorum Titles",
        "icon": "🏷️",
        "subtitle": "Equippable Player Identity Flairs",
        "description": "Tactical subtitles displayed beneath your player name on the Global Leaderboards, Tournament Pairings, and Scorecards."
    },
    "reactions": {
        "id": "reactions",
        "title": "Tactical Salutes",
        "icon": "🫡",
        "subtitle": "Live Match Reactions & Spectator Cheers",
        "description": "Consumable sportsmanship banners and match cheers broadcast across Table 1 during live games and spectator streams."
    },
    "oracle": {
        "id": "oracle",
        "title": "Tactica Oracle",
        "icon": "🔮",
        "subtitle": "Fantasy 40K & GT Tournament Pick'ems",
        "description": "Wager spendable Glory credits on upcoming Grand Tournaments. Predict podium finishers and dark horses for Glory bounties."
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

# ── 12 Fully Actionable Launch Products ──
ARMORY_ITEMS: List[Dict[str, Any]] = [
    # ── WING 1: THE DICE FORGE (3 Tray Skins) ──
    {
        "id": "dice_warpfire_plasma",
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

    # ── WING 2: PROFILE FORGE (3 Card Holo-Foils & Border Halos) ──
    {
        "id": "frame_astral_holofoil",
        "name": "Astral Holo-Foil Shimmer",
        "wing": "profile_forge",
        "slot": "active_card_frame",
        "rarity": "epic",
        "cost_glory": 500,
        "is_consumable": False,
        "prerequisite": {"career_crest_tier": 3, "label": "Requires Centurion (Crest Tier 3+)"},
        "icon": "🌈",
        "description": "Prismatic rainbow holographic foil overlay that refracts ambient light across your Hero Card and Public Profile.",
        "payload": {
            "css_class": "frame-astral-holofoil",
            "border_glow": "0 0 25px rgba(168, 85, 247, 0.45)",
            "border_color": "#c084fc"
        }
    },
    {
        "id": "frame_molten_core",
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

    # ── WING 3: MUNITORUM TITLES (4 Equippable Subtitles) ──
    {
        "id": "title_bane_of_warp",
        "name": "Title: Bane of the Warp",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 200,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "🛡️",
        "description": "Displays 'BANE OF THE WARP' beneath your username across Leaderboards, Tournament Pairings, and Scorecards.",
        "payload": {
            "title_text": "Bane of the Warp",
            "css_class": "title-badge-warp"
        }
    },
    {
        "id": "title_forge_father",
        "name": "Title: Forge Father",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "rare",
        "cost_glory": 200,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "🔨",
        "description": "Displays 'FORGE FATHER' beneath your username on your profile and leaderboards.",
        "payload": {
            "title_text": "Forge Father",
            "css_class": "title-badge-forge"
        }
    },
    {
        "id": "title_grand_strategist",
        "name": "Title: Grand Strategist",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "epic",
        "cost_glory": 350,
        "is_consumable": False,
        "prerequisite": {"career_crest_tier": 4, "label": "Requires Force Commander (Crest Tier 4+)"},
        "icon": "⭐",
        "description": "Prestigious high-command title awarded to master battlefield commanders.",
        "payload": {
            "title_text": "Grand Strategist",
            "css_class": "title-badge-strategist"
        }
    },
    {
        "id": "title_unbroken",
        "name": "Title: The Unbroken",
        "wing": "titles",
        "slot": "active_title",
        "rarity": "common",
        "cost_glory": 100,
        "is_consumable": False,
        "prerequisite": None,
        "icon": "🗡️",
        "description": "Displays 'THE UNBROKEN' beneath your username across OmniTactica.",
        "payload": {
            "title_text": "The Unbroken",
            "css_class": "title-badge-unbroken"
        }
    },

    # ── WING 4: TACTICAL SALUTES (2 Consumable Match Reaction Bundles) ──
    {
        "id": "salute_tactical_salute",
        "name": "Tactical Salute (5-Pack)",
        "wing": "reactions",
        "slot": "consumable_salute",
        "rarity": "common",
        "cost_glory": 25,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🫡",
        "description": "Broadcast an animated 🫡 Tactical Salute banner across Table 1 during live matches or spectator streams.",
        "payload": {
            "reaction_type": "salute",
            "icon": "🫡",
            "label": "Tactical Salute",
            "banner_text": "sent a Tactical Salute! 🫡"
        }
    },
    {
        "id": "salute_emperor_protects",
        "name": "The Emperor Protects (5-Pack)",
        "wing": "reactions",
        "slot": "consumable_salute",
        "rarity": "common",
        "cost_glory": 25,
        "is_consumable": True,
        "bundle_count": 5,
        "prerequisite": None,
        "icon": "🛡️",
        "description": "Send a protective blessing banner 🛡️ celebrating clutch invulnerable saves and round rallies.",
        "payload": {
            "reaction_type": "blessing",
            "icon": "🛡️",
            "label": "The Emperor Protects",
            "banner_text": "declares: The Emperor Protects! 🛡️"
        }
    },

    # ── WING 5: TACTICA ORACLE (1 Tournament Pick'em Pass) ──
    {
        "id": "oracle_gt_pickem_pass",
        "name": "AdeptiCon '26 Oracle Pass",
        "wing": "oracle",
        "slot": "tournament_wager",
        "rarity": "rare",
        "cost_glory": 50,
        "is_consumable": True,
        "bundle_count": 1,
        "prerequisite": None,
        "icon": "🔮",
        "description": "Tournament Pick'em entry ticket for the active Grand Tournament. Predict Podium & Top Factions for a 500 Glory Bounty.",
        "payload": {
            "type": "pickem_ticket",
            "target_event_id": "ev_ongoing_gt_live",
            "event_name": "Warhammer 40k US Open Series 2026",
            "bounty_glory": 500
        }
    }
]

# Quick Map for O(1) Catalog Lookups
ARMORY_INDEX: Dict[str, Dict[str, Any]] = {item["id"]: item for item in ARMORY_ITEMS}

def get_armory_catalog(user_vault: Optional[Dict[str, Any]] = None, user_crest_tier: int = 1) -> Dict[str, Any]:
    """Returns the full Armory catalog with user ownership flags, equipped status, and affordability."""
    vault = user_vault or {"inventory": {}, "equipped": {}}
    inventory = vault.get("inventory") or {}
    equipped = vault.get("equipped") or {}

    items_output = []
    for item in ARMORY_ITEMS:
        item_id = item["id"]
        is_owned = item_id in inventory
        is_equipped = False
        slot = item.get("slot")
        if slot and equipped.get(slot) == item_id:
            is_equipped = True

        # Check prerequisite
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
        "wings": ARMORY_WINGS,
        "rarity_config": ARMORY_RARITY,
        "items": items_output,
        "total_items": len(items_output)
    }

def get_item_by_id(item_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve an item by its unique ID."""
    return ARMORY_INDEX.get(item_id)
