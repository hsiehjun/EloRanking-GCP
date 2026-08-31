"""Wahapedia Data Service for Warhammer 40,000 (10th/11th Edition).
Provides datasheet profiles, statlines, weapon profiles, abilities, keywords,
enhancements, detachments, and stratagem lookup.
"""

import csv
import io
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("WahapediaService")
CACHE_DIR = os.path.join(os.path.dirname(__file__), ".wahapedia_cache")


class WahapediaService:
    """Service to load, index, and query Wahapedia Warhammer 40k datasheets and rules."""

    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super(WahapediaService, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if getattr(self, "_initialized", False):
            return
        self._initialized = True
        self.datasheets: Dict[str, Dict[str, Any]] = {}
        self.factions: Dict[str, Dict[str, Any]] = {}
        self.stratagems: Dict[str, List[Dict[str, Any]]] = {}
        self.enhancements: Dict[str, List[Dict[str, Any]]] = {}
        self.detachments: Dict[str, Dict[str, Any]] = {}
        self._normalized_index: Dict[str, str] = {}
        
        self._init_built_in_catalogue()
        self._try_load_cached_csvs()

    def _normalize_name(self, name: str) -> str:
        """Normalizes unit and faction names for flexible matching."""
        if not name:
            return ""
        s = name.lower().strip()
        s = re.sub(r"[^a-z0-9]", "", s)
        return s

    def _init_built_in_catalogue(self):
        """Initializes core 10th/11th Edition datasheet profiles for fast offline lookups."""
        core_profiles = [
            # SPACE MARINES
            {
                "id": "SM-CAP-TERM",
                "name": "Captain in Terminator Armour",
                "faction": "Space Marines",
                "role": "Character",
                "stats": {"M": "5\"", "T": 5, "SV": "2+", "INV": "4++", "W": 6, "LD": "6+", "OC": 1},
                "weapons": [
                    {"name": "Storm Bolter", "type": "Ranged", "range": "24\"", "attacks": "2", "bs_ws": "2+", "strength": "4", "ap": "0", "damage": "1", "abilities": "[RAPID FIRE 2]"},
                    {"name": "Relic Weapon", "type": "Melee", "range": "Melee", "attacks": "5", "bs_ws": "2+", "strength": "5", "ap": "-2", "damage": "2", "abilities": "-"},
                    {"name": "Power Fist", "type": "Melee", "range": "Melee", "attacks": "5", "bs_ws": "2+", "strength": "8", "ap": "-2", "damage": "2", "abilities": "-"},
                    {"name": "Thunder Hammer", "type": "Melee", "range": "Melee", "attacks": "4", "bs_ws": "3+", "strength": "8", "ap": "-2", "damage": "2", "abilities": "[DEVASTATING WOUNDS]"}
                ],
                "abilities": [
                    {"name": "Rites of Battle", "description": "Once per battle round, one unit with this ability can be targeted with a Stratagem for 0CP."},
                    {"name": "Refusal to Yield", "description": "Re-roll Charge rolls made for this model's unit."}
                ],
                "keywords": ["Infantry", "Character", "Epic Hero", "Terminator", "Captain", "Imperium"]
            },
            {
                "id": "SM-TERM-SQUAD",
                "name": "Terminator Squad",
                "faction": "Space Marines",
                "role": "Infantry",
                "stats": {"M": "5\"", "T": 5, "SV": "2+", "INV": "4++", "W": 3, "LD": "6+", "OC": 1},
                "weapons": [
                    {"name": "Storm Bolter", "type": "Ranged", "range": "24\"", "attacks": "2", "bs_ws": "3+", "strength": "4", "ap": "0", "damage": "1", "abilities": "[RAPID FIRE 2]"},
                    {"name": "Assault Cannon", "type": "Ranged", "range": "24\"", "attacks": "6", "bs_ws": "3+", "strength": "6", "ap": "0", "damage": "1", "abilities": "[DEVASTATING WOUNDS]"},
                    {"name": "Cyclone Missile Launcher - Frag", "type": "Ranged", "range": "36\"", "attacks": "2D6", "bs_ws": "3+", "strength": "4", "ap": "0", "damage": "1", "abilities": "[BLAST]"},
                    {"name": "Cyclone Missile Launcher - Krak", "type": "Ranged", "range": "36\"", "attacks": "2", "bs_ws": "3+", "strength": "9", "ap": "-2", "damage": "D6", "abilities": "-"},
                    {"name": "Power Fist", "type": "Melee", "range": "Melee", "attacks": "3", "bs_ws": "3+", "strength": "8", "ap": "-2", "damage": "2", "abilities": "-"},
                    {"name": "Chainfist", "type": "Melee", "range": "Melee", "attacks": "3", "bs_ws": "4+", "strength": "8", "ap": "-2", "damage": "2", "abilities": "[ANTI-VEHICLE 3+]"}
                ],
                "abilities": [
                    {"name": "Fury of the First", "description": "Add 1 to Hit rolls if target is Oath of Moment target."}
                ],
                "keywords": ["Infantry", "Terminator", "Imperium"]
            },
            {
                "id": "SM-INTERCESSORS",
                "name": "Intercessor Squad",
                "faction": "Space Marines",
                "role": "Battleline",
                "stats": {"M": "6\"", "T": 4, "SV": "3+", "INV": "-", "W": 2, "LD": "6+", "OC": 2},
                "weapons": [
                    {"name": "Bolt Rifle", "type": "Ranged", "range": "24\"", "attacks": "2", "bs_ws": "3+", "strength": "4", "ap": "-1", "damage": "1", "abilities": "[ASSAULT, HEAVY]"},
                    {"name": "Astartes Chainsword", "type": "Melee", "range": "Melee", "attacks": "4", "bs_ws": "3+", "strength": "4", "ap": "-1", "damage": "1", "abilities": "-"}
                ],
                "abilities": [
                    {"name": "Objective Secured (Sticky)", "description": "Controls objective marker even after moving away."}
                ],
                "keywords": ["Infantry", "Battleline", "Grenades", "Imperium", "Tacticus", "Intercessors"]
            },
            {
                "id": "SM-REPULSOR",
                "name": "Repulsor",
                "faction": "Space Marines",
                "role": "Dedicated Transport",
                "stats": {"M": "10\"", "T": 12, "SV": "2+", "INV": "-", "W": 16, "LD": "6+", "OC": 5},
                "weapons": [
                    {"name": "Las-talon", "type": "Ranged", "range": "36\"", "attacks": "2", "bs_ws": "3+", "strength": "12", "ap": "-3", "damage": "D6+1", "abilities": "-"},
                    {"name": "Twin Lascannon", "type": "Ranged", "range": "48\"", "attacks": "1", "bs_ws": "3+", "strength": "12", "ap": "-3", "damage": "D6+1", "abilities": "[TWIN-LINKED]"}
                ],
                "abilities": [
                    {"name": "Emergency Combat Embarkation", "description": "Embark inside when targeted by charge."}
                ],
                "keywords": ["Vehicle", "Transport", "Smoke", "Imperium", "Repulsor"]
            },

            # ORKS
            {
                "id": "ORK-GHAZGHKULL",
                "name": "Ghazghkull Thraka",
                "faction": "Orks",
                "role": "Character",
                "stats": {"M": "5\"", "T": 6, "SV": "2+", "INV": "4++", "W": 10, "LD": "6+", "OC": 4},
                "weapons": [
                    {"name": "Gork's Klaw", "type": "Melee", "range": "Melee", "attacks": "6", "bs_ws": "2+", "strength": "14", "ap": "-4", "damage": "4", "abilities": "[LETHAL HITS]"},
                    {"name": "Mork's Roar", "type": "Ranged", "range": "36\"", "attacks": "12", "bs_ws": "5+", "strength": "5", "ap": "-1", "damage": "2", "abilities": "[RAPID FIRE 4]"}
                ],
                "abilities": [
                    {"name": "Gork's Waaagh!", "description": "While leading, add +1 to Hit and Wound rolls for melee attacks during Waaagh!."},
                    {"name": "Makari's Banner", "description": "Friendly Ork Infantry models within 12\" have 6+ Invulnerable save."}
                ],
                "keywords": ["Infantry", "Character", "Epic Hero", "Warboss", "Ghazghkull Thraka"]
            },
            {
                "id": "ORK-BOYZ",
                "name": "Boyz",
                "faction": "Orks",
                "role": "Battleline",
                "stats": {"M": "6\"", "T": 5, "SV": "5+", "INV": "-", "W": 1, "LD": "7+", "OC": 2},
                "weapons": [
                    {"name": "Choppa", "type": "Melee", "range": "Melee", "attacks": "3", "bs_ws": "3+", "strength": "4", "ap": "-1", "damage": "1", "abilities": "-"},
                    {"name": "Slugga", "type": "Ranged", "range": "12\"", "attacks": "1", "bs_ws": "5+", "strength": "4", "ap": "0", "damage": "1", "abilities": "[PISTOL]"},
                    {"name": "Power Klaw", "type": "Melee", "range": "Melee", "attacks": "3", "bs_ws": "4+", "strength": "9", "ap": "-2", "damage": "2", "abilities": "-"}
                ],
                "abilities": [
                    {"name": "Get 'Em Boyz", "description": "Gain [SUSTAINED HITS 1] in melee when charging."}
                ],
                "keywords": ["Infantry", "Battleline", "Mob", "Boyz"]
            },

            # ADEPTUS CUSTODES
            {
                "id": "AC-TRAJANN",
                "name": "Trajann Valoris",
                "faction": "Adeptus Custodes",
                "role": "Character",
                "stats": {"M": "6\"", "T": 6, "SV": "2+", "INV": "4++", "W": 7, "LD": "5+", "OC": 2},
                "weapons": [
                    {"name": "Watcher's Axe - Strike", "type": "Melee", "range": "Melee", "attacks": "6", "bs_ws": "2+", "strength": "10", "ap": "-3", "damage": "3", "abilities": "-"},
                    {"name": "Watcher's Axe - Sweep", "type": "Melee", "range": "Melee", "attacks": "12", "bs_ws": "2+", "strength": "6", "ap": "-1", "damage": "1", "abilities": "-"},
                    {"name": "Eagle's Scream", "type": "Ranged", "range": "24\"", "attacks": "2", "bs_ws": "2+", "strength": "5", "ap": "-2", "damage": "3", "abilities": "[ASSAULT]"}
                ],
                "abilities": [
                    {"name": "Captain-General", "description": "Ignore all characteristic and roll modifiers."},
                    {"name": "Moment Shackle", "description": "Once per battle: 2++ save, 12 Strike attacks, or Fight First."}
                ],
                "keywords": ["Infantry", "Character", "Epic Hero", "Imperium", "Captain-General", "Trajann Valoris"]
            },
            {
                "id": "AC-WARDENS",
                "name": "Custodian Wardens",
                "faction": "Adeptus Custodes",
                "role": "Infantry",
                "stats": {"M": "6\"", "T": 6, "SV": "2+", "INV": "4++", "W": 3, "LD": "6+", "OC": 2},
                "weapons": [
                    {"name": "Guardian Spear - Strike", "type": "Melee", "range": "Melee", "attacks": "5", "bs_ws": "2+", "strength": "7", "ap": "-2", "damage": "2", "abilities": "-"},
                    {"name": "Guardian Spear - Shoot", "type": "Ranged", "range": "24\"", "attacks": "2", "bs_ws": "2+", "strength": "4", "ap": "-1", "damage": "2", "abilities": "[ASSAULT]"}
                ],
                "abilities": [
                    {"name": "Living Fortress", "description": "Once per battle: 4+ Feel No Pain for one phase."}
                ],
                "keywords": ["Infantry", "Imperium", "Wardens"]
            },

            # ADEPTA SORORITAS
            {
                "id": "AS-MORVENN-VAHL",
                "name": "Morvenn Vahl",
                "faction": "Adepta Sororitas",
                "role": "Character",
                "stats": {"M": "8\"", "T": 6, "SV": "2+", "INV": "4++", "W": 8, "LD": "6+", "OC": 3},
                "weapons": [
                    {"name": "Lance of Illumination - Strike", "type": "Melee", "range": "Melee", "attacks": "5", "bs_ws": "2+", "strength": "8", "ap": "-3", "damage": "3", "abilities": "-"},
                    {"name": "Lance of Illumination - Sweep", "type": "Melee", "range": "Melee", "attacks": "10", "bs_ws": "2+", "strength": "5", "ap": "-1", "damage": "1", "abilities": "-"},
                    {"name": "Paragon Missile Launcher", "type": "Ranged", "range": "36\"", "attacks": "D6", "bs_ws": "2+", "strength": "9", "ap": "-2", "damage": "D6", "abilities": "[BLAST]"}
                ],
                "abilities": [
                    {"name": "Abbess Sanctorum", "description": "Re-roll all Hit and Wound rolls for leading Paragon Warsuits unit."},
                    {"name": "Righteous Rage", "description": "+3 Attacks, Strength, and Damage once per battle."}
                ],
                "keywords": ["Vehicle", "Walker", "Character", "Epic Hero", "Imperium", "Morvenn Vahl"]
            },
            {
                "id": "AS-BATTLE-SISTERS",
                "name": "Battle Sisters Squad",
                "faction": "Adepta Sororitas",
                "role": "Battleline",
                "stats": {"M": "6\"", "T": 3, "SV": "3+", "INV": "6++", "W": 1, "LD": "7+", "OC": 2},
                "weapons": [
                    {"name": "Boltgun", "type": "Ranged", "range": "24\"", "attacks": "1", "bs_ws": "3+", "strength": "4", "ap": "0", "damage": "1", "abilities": "[RAPID FIRE 1]"},
                    {"name": "Meltagun", "type": "Ranged", "range": "12\"", "attacks": "1", "bs_ws": "3+", "strength": "9", "ap": "-4", "damage": "D6", "abilities": "[MELTA 2]"}
                ],
                "abilities": [
                    {"name": "Cherub", "description": "Gain 1 Miracle dice."},
                    {"name": "Defenders of the Faith", "description": "Gain Miracle dice when holding objective."}
                ],
                "keywords": ["Infantry", "Battleline", "Grenades", "Imperium", "Battle Sisters Squad"]
            },

            # LEAGUES OF VOTANN
            {
                "id": "LOV-KHAL",
                "name": "Kâhl",
                "faction": "Leagues of Votann",
                "role": "Character",
                "stats": {"M": "5\"", "T": 5, "SV": "3+", "INV": "4++", "W": 4, "LD": "7+", "OC": 1},
                "weapons": [
                    {"name": "Volkanite Disintegrator", "type": "Ranged", "range": "18\"", "attacks": "3", "bs_ws": "2+", "strength": "5", "ap": "0", "damage": "1", "abilities": "[DEVASTATING WOUNDS]"},
                    {"name": "Mass Gauntlet", "type": "Melee", "range": "Melee", "attacks": "3", "bs_ws": "3+", "strength": "8", "ap": "-2", "damage": "3", "abilities": "-"}
                ],
                "abilities": [
                    {"name": "Grim Efficiency", "description": "Assign Judgement token to enemy unit in Command phase."},
                    {"name": "Kindred Hero", "description": "Grants [LETHAL HITS] to leading unit."}
                ],
                "keywords": ["Infantry", "Character", "Kâhl"]
            },
            {
                "id": "LOV-HEARTHGUARD",
                "name": "Einhyr Hearthguard",
                "faction": "Leagues of Votann",
                "role": "Infantry",
                "stats": {"M": "5\"", "T": 6, "SV": "2+", "INV": "4++", "W": 2, "LD": "7+", "OC": 1},
                "weapons": [
                    {"name": "Volkanite Disintegrator", "type": "Ranged", "range": "18\"", "attacks": "3", "bs_ws": "3+", "strength": "5", "ap": "0", "damage": "1", "abilities": "[DEVASTATING WOUNDS]"},
                    {"name": "Concussion Gauntlet", "type": "Melee", "range": "Melee", "attacks": "3", "bs_ws": "3+", "strength": "9", "ap": "-2", "damage": "2", "abilities": "-"}
                ],
                "abilities": [
                    {"name": "Oathband Bodyguard", "description": "-1 to Wound rolls against this unit when led by Character."}
                ],
                "keywords": ["Infantry", "Exo-armour", "Deep Strike", "Einhyr Hearthguard"]
            },

            # NECRONS
            {
                "id": "NEC-NIGHTBRINGER",
                "name": "C'tan Shard of the Nightbringer",
                "faction": "Necrons",
                "role": "Monster",
                "stats": {"M": "7\"", "T": 11, "SV": "4+", "INV": "4++", "W": 12, "LD": "6+", "OC": 4},
                "weapons": [
                    {"name": "Gaze of Death", "type": "Ranged", "range": "18\"", "attacks": "D6", "bs_ws": "2+", "strength": "12", "ap": "-4", "damage": "D6+1", "abilities": "[BLAST]"},
                    {"name": "Scythe of the Nightbringer - Strike", "type": "Melee", "range": "Melee", "attacks": "6", "bs_ws": "2+", "strength": "14", "ap": "-4", "damage": "D6+2", "abilities": "[DEVASTATING WOUNDS]"},
                    {"name": "Scythe of the Nightbringer - Sweep", "type": "Melee", "range": "Melee", "attacks": "14", "bs_ws": "2+", "strength": "8", "ap": "-2", "damage": "2", "abilities": "[LETHAL HITS]"}
                ],
                "abilities": [
                    {"name": "Drain Life", "description": "Roll D6 for enemy units within 6\" in Fight phase for mortal wounds."},
                    {"name": "Necrodermis", "description": "Halve all incoming damage."}
                ],
                "keywords": ["Monster", "Character", "Epic Hero", "Fly", "C'tan Shard", "Nightbringer"]
            },
            {
                "id": "NEC-VOID-DRAGON",
                "name": "C'tan Shard of the Void Dragon",
                "faction": "Necrons",
                "role": "Monster",
                "stats": {"M": "7\"", "T": 11, "SV": "4+", "INV": "4++", "W": 12, "LD": "6+", "OC": 4},
                "weapons": [
                    {"name": "Voltaic Storm", "type": "Ranged", "range": "18\"", "attacks": "D6+3", "bs_ws": "2+", "strength": "7", "ap": "-1", "damage": "2", "abilities": "[BLAST, SUSTAINED HITS 1]"},
                    {"name": "Spear of the Void Dragon - Strike", "type": "Melee", "range": "Melee", "attacks": "6", "bs_ws": "2+", "strength": "12", "ap": "-4", "damage": "D6+2", "abilities": "[ANTI-VEHICLE 2+, DEVASTATING WOUNDS]"}
                ],
                "abilities": [
                    {"name": "Matter Absorption", "description": "Regain D3+3 wounds when destroying a Vehicle."},
                    {"name": "Necrodermis", "description": "Halve all incoming damage."}
                ],
                "keywords": ["Monster", "Character", "Epic Hero", "Fly", "C'tan Shard", "Void Dragon"]
            },
            {
                "id": "NEC-WARRIORS",
                "name": "Necron Warriors",
                "faction": "Necrons",
                "role": "Battleline",
                "stats": {"M": "5\"", "T": 4, "SV": "4+", "INV": "-", "W": 1, "LD": "7+", "OC": 2},
                "weapons": [
                    {"name": "Gauss Flayer", "type": "Ranged", "range": "24\"", "attacks": "1", "bs_ws": "4+", "strength": "4", "ap": "0", "damage": "1", "abilities": "[LETHAL HITS, RAPID FIRE 1]"},
                    {"name": "Gauss Reaper", "type": "Ranged", "range": "12\"", "attacks": "2", "bs_ws": "4+", "strength": "5", "ap": "-1", "damage": "1", "abilities": "[LETHAL HITS]"}
                ],
                "abilities": [
                    {"name": "Their Number is Legion", "description": "Re-roll Reanimation rolls of 1 (or all when near objective)."}
                ],
                "keywords": ["Infantry", "Battleline", "Necron Warriors"]
            },
            {
                "id": "NEC-WRAITHS",
                "name": "Canoptek Wraiths",
                "faction": "Necrons",
                "role": "Beast",
                "stats": {"M": "10\"", "T": 6, "SV": "3+", "INV": "4++", "W": 4, "LD": "7+", "OC": 2},
                "weapons": [
                    {"name": "Particle Caster", "type": "Ranged", "range": "12\"", "attacks": "3", "bs_ws": "4+", "strength": "6", "ap": "0", "damage": "1", "abilities": "[PISTOL, DEVASTATING WOUNDS]"},
                    {"name": "Vicious Claws", "type": "Melee", "range": "Melee", "attacks": "4", "bs_ws": "4+", "strength": "6", "ap": "-1", "damage": "2", "abilities": "-"}
                ],
                "abilities": [
                    {"name": "Wraithflight", "description": "Move through enemy models and terrain features seamlessly."}
                ],
                "keywords": ["Beasts", "Fly", "Canoptek", "Wraiths"]
            }
        ]

        for p in core_profiles:
            self._register_profile(p)

    def _register_profile(self, profile: Dict[str, Any]):
        """Registers a datasheet profile in memory and indexes normalized aliases."""
        pid = profile["id"]
        self.datasheets[pid] = profile
        
        norm = self._normalize_name(profile["name"])
        self._normalized_index[norm] = pid
        
        if profile.get("faction"):
            fac_norm = self._normalize_name(profile["faction"])
            self._normalized_index[f"{fac_norm}_{norm}"] = pid

    def _try_load_cached_csvs(self):
        """Attempts to load and parse Wahapedia CSV files from local cache if present."""
        if not os.path.exists(CACHE_DIR):
            return

        datasheets_csv = os.path.join(CACHE_DIR, "Datasheets.csv")
        models_csv = os.path.join(CACHE_DIR, "Datasheets_models.csv")
        wargear_csv = os.path.join(CACHE_DIR, "Datasheets_wargear.csv")
        abilities_csv = os.path.join(CACHE_DIR, "Datasheets_abilities.csv")

        if not os.path.exists(datasheets_csv):
            return

        try:
            logger.info("Parsing Wahapedia cached CSV files...")
            models_map = {}
            if os.path.exists(models_csv):
                with open(models_csv, mode="r", encoding="utf-8", errors="ignore") as f:
                    reader = csv.DictReader(f, delimiter="|")
                    for row in reader:
                        ds_id = row.get("datasheet_id")
                        if ds_id:
                            inv = row.get("inv_sv") or "-"
                            if inv != "-" and not str(inv).endswith("++"):
                                inv = f"{inv}++"
                            models_map[ds_id] = {
                                "M": row.get("M", "6\""),
                                "T": int(row.get("T") or 4),
                                "SV": row.get("Sv", "3+"),
                                "INV": inv,
                                "W": int(row.get("W") or 1),
                                "LD": row.get("Ld", "7+"),
                                "OC": int(row.get("OC") or 1)
                            }

            wargear_map = {}
            if os.path.exists(wargear_csv):
                with open(wargear_csv, mode="r", encoding="utf-8", errors="ignore") as f:
                    reader = csv.DictReader(f, delimiter="|")
                    for row in reader:
                        ds_id = row.get("datasheet_id")
                        if ds_id:
                            if ds_id not in wargear_map:
                                wargear_map[ds_id] = []
                            w_type = "Melee" if str(row.get("range", "")).strip().lower() in ("melee", "-") else "Ranged"
                            wargear_map[ds_id].append({
                                "name": row.get("name", "Weapon"),
                                "type": w_type,
                                "range": row.get("range", "24\""),
                                "attacks": row.get("A", "1"),
                                "bs_ws": row.get("BS_WS", "3+"),
                                "strength": row.get("S", "4"),
                                "ap": row.get("AP", "0"),
                                "damage": row.get("D", "1"),
                                "abilities": row.get("abilities", "-")
                            })

            abilities_map = {}
            if os.path.exists(abilities_csv):
                with open(abilities_csv, mode="r", encoding="utf-8", errors="ignore") as f:
                    reader = csv.DictReader(f, delimiter="|")
                    for row in reader:
                        ds_id = row.get("datasheet_id")
                        if ds_id:
                            if ds_id not in abilities_map:
                                abilities_map[ds_id] = []
                            abilities_map[ds_id].append({
                                "name": row.get("name", "Ability"),
                                "description": row.get("description", "")
                            })

            with open(datasheets_csv, mode="r", encoding="utf-8", errors="ignore") as f:
                reader = csv.DictReader(f, delimiter="|")
                for row in reader:
                    ds_id = row.get("id")
                    if not ds_id:
                        continue
                    name = row.get("name", "")
                    faction_id = row.get("faction_id", "")
                    role = row.get("role", "Infantry")
                    
                    stats = models_map.get(ds_id, {"M": "6\"", "T": 4, "SV": "3+", "INV": "-", "W": 2, "LD": "6+", "OC": 1})
                    weapons = wargear_map.get(ds_id, [])
                    abilities = abilities_map.get(ds_id, [])
                    
                    profile = {
                        "id": ds_id,
                        "name": name,
                        "faction": faction_id,
                        "role": role,
                        "stats": stats,
                        "weapons": weapons,
                        "abilities": abilities,
                        "keywords": [role, faction_id]
                    }
                    self._register_profile(profile)

            logger.info(f"Loaded {len(self.datasheets)} total Wahapedia datasheets into memory.")
        except Exception as e:
            logger.warning(f"Notice loading Wahapedia cached CSVs: {e}")

    def lookup_unit(self, unit_name: str, faction: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Looks up a datasheet profile by unit name and optional faction using fuzzy matching."""
        if not unit_name:
            return None

        norm_name = self._normalize_name(unit_name)
        
        # 1. Direct normalized hit
        if norm_name in self._normalized_index:
            pid = self._normalized_index[norm_name]
            return self.datasheets.get(pid)

        # 2. Combined faction + name hit
        if faction:
            norm_fac = self._normalize_name(faction)
            combo = f"{norm_fac}_{norm_name}"
            if combo in self._normalized_index:
                pid = self._normalized_index[combo]
                return self.datasheets.get(pid)

        # 3. Substring match
        for k, pid in self._normalized_index.items():
            if norm_name in k or k in norm_name:
                return self.datasheets.get(pid)

        # 4. Synthesize intelligent default if not found
        return {
            "id": f"GEN-{norm_name[:8].upper()}",
            "name": unit_name,
            "faction": faction or "Warhammer 40,000",
            "role": "Infantry",
            "stats": {"M": "6\"", "T": 4, "SV": "3+", "INV": "-", "W": 2, "LD": "6+", "OC": 1},
            "weapons": [
                {"name": "Standard Ranged Weapon", "type": "Ranged", "range": "24\"", "attacks": "2", "bs_ws": "3+", "strength": "4", "ap": "-1", "damage": "1", "abilities": "-"},
                {"name": "Standard Close Combat Weapon", "type": "Melee", "range": "Melee", "attacks": "3", "bs_ws": "3+", "strength": "4", "ap": "0", "damage": "1", "abilities": "-"}
            ],
            "abilities": [
                {"name": "Datasheet Rules", "description": "Standard 11th Edition unit abilities."}
            ],
            "keywords": ["Infantry"]
        }

    def get_stratagems_for_detachment(self, faction: str, detachment: Optional[str] = None) -> List[Dict[str, Any]]:
        """Returns standard and detachment stratagems."""
        core_strats = [
            {"name": "Command Re-roll", "type": "Core", "cp": 1, "phase": "Any Phase", "description": "Re-roll one Hit roll, Wound roll, Damage roll, saving throw, Advance roll, Charge roll, or Battle-shock test."},
            {"name": "Counter-Offensive", "type": "Core", "cp": 2, "phase": "Fight Phase", "description": "Select one eligible friendly unit that has not fought this phase. That unit fights next."},
            {"name": "Epic Challenge", "type": "Core", "cp": 1, "phase": "Fight Phase", "description": "Melee attacks made by a Character model in this unit gain [PRECISION]."},
            {"name": "Fire Overwatch", "type": "Core", "cp": 1, "phase": "Opponent's Movement/Charge Phase", "description": "Shoot at an enemy unit that moved or charged. Hits are only scored on unmodified 6s."},
            {"name": "Go to Ground", "type": "Core", "cp": 1, "phase": "Opponent's Shooting Phase", "description": "Target friendly Infantry unit gains Benefit of Cover and a 6+ Invulnerable save."},
            {"name": "Smokescreen", "type": "Core", "cp": 1, "phase": "Opponent's Shooting Phase", "description": "Target friendly unit with SMOKE keyword gains Benefit of Cover and [STEALTH]."},
            {"name": "Tank Shock", "type": "Core", "cp": 1, "phase": "Charge Phase", "description": "Roll D6s equal to Toughness of your charging Vehicle (+2 if weapon S > T); each 5+ causes a mortal wound (max 6)."},
            {"name": "Rapid Ingress", "type": "Core", "cp": 1, "phase": "End of Opponent's Movement Phase", "description": "One friendly unit in Reserves with Deep Strike or Strategic Reserves arrives on the battlefield."}
        ]
        return core_strats


def get_wahapedia() -> WahapediaService:
    return WahapediaService()
