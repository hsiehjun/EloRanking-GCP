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

            # =========================================================================
            # NECRONS
            # =========================================================================
            {
                "id": "NEC-OVERLORD",
                "name": "Overlord",
                "faction": "Necrons",
                "role": "Character",
                "stats": {"M": "5\"", "T": 5, "SV": "2+", "INV": "4++", "W": 6, "LD": "6+", "OC": 1},
                "weapons": [
                    {"name": "Voidscythe", "type": "Melee", "range": "Melee", "attacks": "3", "bs_ws": "3+", "strength": "8", "ap": "-3", "damage": "3", "abilities": "[DEVASTATING WOUNDS]"},
                    {"name": "Overlord's Blade", "type": "Melee", "range": "Melee", "attacks": "4", "bs_ws": "2+", "strength": "5", "ap": "-2", "damage": "2", "abilities": "[DEVASTATING WOUNDS]"},
                    {"name": "Hyperphase Glaive", "type": "Melee", "range": "Melee", "attacks": "4", "bs_ws": "2+", "strength": "7", "ap": "-2", "damage": "2", "abilities": "-"},
                    {"name": "Tachyon Arrow", "type": "Ranged", "range": "72\"", "attacks": "1", "bs_ws": "2+", "strength": "16", "ap": "-5", "damage": "D6+2", "abilities": "[ONE SHOT]"},
                    {"name": "Resurrection Orb", "type": "Wargear", "range": "-", "attacks": "-", "bs_ws": "-", "strength": "-", "ap": "-", "damage": "-", "abilities": "Trigger extra Reanimation Protocols"}
                ],
                "abilities": [
                    {"name": "My Will Be Done", "description": "Once per battle round, one unit from your army with this ability can be targeted with a Stratagem for 0CP."},
                    {"name": "Resurrection Orb", "description": "In the Command phase or after an enemy unit attacks, you can trigger this model's unit's Reanimation Protocols, reanimating an extra D3 wounds/models."}
                ],
                "keywords": ["Infantry", "Character", "Noble", "Overlord", "Necrons"]
            },
            {
                "id": "NEC-DOOMSDAY-ARK",
                "name": "Doomsday Ark",
                "faction": "Necrons",
                "role": "Vehicle",
                "stats": {"M": "10\"", "T": 9, "SV": "3+", "INV": "4++", "W": 14, "LD": "7+", "OC": 5},
                "weapons": [
                    {"name": "Doomsday Cannon - Stationary", "type": "Ranged", "range": "72\"", "attacks": "D6+1", "bs_ws": "3+", "strength": "18", "ap": "-4", "damage": "4", "abilities": "[BLAST, DEVASTATING WOUNDS, HEAVY]"},
                    {"name": "Doomsday Cannon - Normal", "type": "Ranged", "range": "72\"", "attacks": "D6+1", "bs_ws": "3+", "strength": "15", "ap": "-4", "damage": "4", "abilities": "[BLAST]"},
                    {"name": "2x Gauss Flayer Array", "type": "Ranged", "range": "24\"", "attacks": "10", "bs_ws": "3+", "strength": "4", "ap": "0", "damage": "1", "abilities": "[LETHAL HITS, RAPID FIRE 5]"},
                    {"name": "Armoured Bulk", "type": "Melee", "range": "Melee", "attacks": "3", "bs_ws": "4+", "strength": "6", "ap": "0", "damage": "1", "abilities": "-"}
                ],
                "abilities": [
                    {"name": "Overwhelming Firepower", "description": "If this model remained stationary this turn, its Doomsday Cannon gains [DEVASTATING WOUNDS] and Strength 18."},
                    {"name": "Quantum Shielding", "description": "This model has a 4+ invulnerable save and cannot be wounded on a roll of 1-3 regardless of attacker Strength."}
                ],
                "keywords": ["Vehicle", "Fly", "Quantum Shielding", "Doomsday Ark", "Necrons"]
            },
            {
                "id": "NEC-FLAYED-ONES",
                "name": "Flayed Ones",
                "faction": "Necrons",
                "role": "Infantry",
                "stats": {"M": "5\"", "T": 4, "SV": "4+", "INV": "-", "W": 1, "LD": "7+", "OC": 1},
                "weapons": [
                    {"name": "Flayer Claws", "type": "Melee", "range": "Melee", "attacks": "4", "bs_ws": "3+", "strength": "4", "ap": "0", "damage": "1", "abilities": "[TWIN-LINKED, SUSTAINED HITS 1]"}
                ],
                "abilities": [
                    {"name": "Infiltrators", "description": "Can be set up anywhere that is more than 9\" away from enemy deployment zone and enemy models."},
                    {"name": "Stealth", "description": "Subtract 1 from Hit rolls for ranged attacks targeting this unit."},
                    {"name": "Flesh Hunger", "description": "Each time an attack made by this unit targets an enemy unit below Half-strength, critical hits are scored on an unmodified roll of 5+."}
                ],
                "keywords": ["Infantry", "Infiltrators", "Stealth", "Destroyer Cult", "Flayed Ones", "Necrons"]
            },
            {
                "id": "NEC-LOKHUST-HEAVY",
                "name": "Lokhust Heavy Destroyers",
                "faction": "Necrons",
                "role": "Mounted",
                "stats": {"M": "7\"", "T": 6, "SV": "3+", "INV": "-", "W": 4, "LD": "7+", "OC": 2},
                "weapons": [
                    {"name": "Enmitic Exterminator", "type": "Ranged", "range": "36\"", "attacks": "6", "bs_ws": "3+", "strength": "6", "ap": "-1", "damage": "1", "abilities": "[HEAVY, BLAST, SUSTAINED HITS 1]"},
                    {"name": "Gauss Destructor", "type": "Ranged", "range": "48\"", "attacks": "1", "bs_ws": "3+", "strength": "14", "ap": "-4", "damage": "6", "abilities": "[HEAVY, LETHAL HITS]"},
                    {"name": "Close Combat Weapon", "type": "Melee", "range": "Melee", "attacks": "2", "bs_ws": "3+", "strength": "4", "ap": "0", "damage": "1", "abilities": "-"}
                ],
                "abilities": [
                    {"name": "Heavy Firepower", "description": "Re-roll a Wound roll of 1 for attacks made by this unit (or re-roll all Wound rolls if targeting Monster or Vehicle)."}
                ],
                "keywords": ["Mounted", "Fly", "Destroyer Cult", "Lokhust Heavy Destroyers", "Necrons"]
            },
            {
                "id": "NEC-LYCHGUARD",
                "name": "Lychguard",
                "faction": "Necrons",
                "role": "Infantry",
                "stats": {"M": "5\"", "T": 5, "SV": "3+", "INV": "4++", "W": 2, "LD": "6+", "OC": 1},
                "weapons": [
                    {"name": "Hyperphase Sword", "type": "Melee", "range": "Melee", "attacks": "3", "bs_ws": "3+", "strength": "6", "ap": "-2", "damage": "1", "abilities": "-"},
                    {"name": "Dispersion Shield", "type": "Wargear", "range": "-", "attacks": "-", "bs_ws": "-", "strength": "-", "ap": "-", "damage": "-", "abilities": "Grants 4+ Invulnerable save"},
                    {"name": "Warscythe", "type": "Melee", "range": "Melee", "attacks": "3", "bs_ws": "3+", "strength": "8", "ap": "-3", "damage": "2", "abilities": "-"}
                ],
                "abilities": [
                    {"name": "Guardian Protocols", "description": "While a Noble or Character model is leading this unit, subtract 1 from Wound rolls made against this unit."}
                ],
                "keywords": ["Infantry", "Lychguard", "Noble Bodyguard", "Necrons"]
            },
            {
                "id": "NEC-OPHYDIAN-DESTROYERS",
                "name": "Ophydian Destroyers",
                "faction": "Necrons",
                "role": "Mounted",
                "stats": {"M": "9\"", "T": 4, "SV": "3+", "INV": "-", "W": 3, "LD": "7+", "OC": 1},
                "weapons": [
                    {"name": "Ophydian Hyperphase Weapons", "type": "Melee", "range": "Melee", "attacks": "5", "bs_ws": "3+", "strength": "4", "ap": "-2", "damage": "2", "abilities": "-"},
                    {"name": "Plasmacyte", "type": "Wargear", "range": "-", "attacks": "-", "bs_ws": "-", "strength": "-", "ap": "-", "damage": "-", "abilities": "Grants [DEVASTATING WOUNDS] once per battle"}
                ],
                "abilities": [
                    {"name": "Deep Strike", "description": "Can be set up anywhere that is more than 9\" horizontally away from all enemy models."},
                    {"name": "Tunnelling Horrors", "description": "At the end of your opponent's turn, if this unit is not in Engagement Range, remove it and place into Strategic Reserves."}
                ],
                "keywords": ["Mounted", "Deep Strike", "Destroyer Cult", "Ophydian Destroyers", "Necrons"]
            },
            {
                "id": "NEC-SKORPEKH-DESTROYERS",
                "name": "Skorpekh Destroyers",
                "faction": "Necrons",
                "role": "Infantry",
                "stats": {"M": "7\"", "T": 5, "SV": "3+", "INV": "-", "W": 3, "LD": "7+", "OC": 1},
                "weapons": [
                    {"name": "Skorpekh Hyperphase Weapons", "type": "Melee", "range": "Melee", "attacks": "4", "bs_ws": "3+", "strength": "7", "ap": "-2", "damage": "2", "abilities": "-"},
                    {"name": "Plasmacyte", "type": "Wargear", "range": "-", "attacks": "-", "bs_ws": "-", "strength": "-", "ap": "-", "damage": "-", "abilities": "Grants [LETHAL HITS] or [DEVASTATING WOUNDS]"}
                ],
                "abilities": [
                    {"name": "Whirling Onslaught", "description": "In the Fight phase, if this unit made a Charge move, subtract 1 from Wound rolls for attacks targeting this unit."},
                    {"name": "Lethal Precision", "description": "Critical hits in melee automatically wound the target."}
                ],
                "keywords": ["Infantry", "Destroyer Cult", "Skorpekh Destroyers", "Necrons"]
            },
            {
                "id": "NEC-TRIARCH-PRAETORIANS",
                "name": "Triarch Praetorians",
                "faction": "Necrons",
                "role": "Infantry",
                "stats": {"M": "10\"", "T": 5, "SV": "3+", "INV": "-", "W": 2, "LD": "6+", "OC": 2},
                "weapons": [
                    {"name": "Rod of Covenant - Ranged", "type": "Ranged", "range": "12\"", "attacks": "1", "bs_ws": "3+", "strength": "5", "ap": "-2", "damage": "2", "abilities": "[PISTOL]"},
                    {"name": "Rod of Covenant - Melee", "type": "Melee", "range": "Melee", "attacks": "4", "bs_ws": "3+", "strength": "5", "ap": "-2", "damage": "2", "abilities": "-"},
                    {"name": "Particle Caster", "type": "Ranged", "range": "12\"", "attacks": "3", "bs_ws": "3+", "strength": "6", "ap": "0", "damage": "1", "abilities": "[PISTOL, DEVASTATING WOUNDS]"},
                    {"name": "Voidblade", "type": "Melee", "range": "Melee", "attacks": "5", "bs_ws": "3+", "strength": "5", "ap": "-3", "damage": "1", "abilities": "-"}
                ],
                "abilities": [
                    {"name": "Deep Strike & Fly", "description": "Can deploy via Deep Strike and move over models and terrain seamlessly."},
                    {"name": "Judgement of the Triarch", "description": "Can re-roll Charge rolls and ignore all modifiers to Move, Advance, and Charge characteristics."}
                ],
                "keywords": ["Infantry", "Fly", "Deep Strike", "Triarch", "Triarch Praetorians", "Necrons"]
            },
            {
                "id": "NEC-IMMORTALS",
                "name": "Immortals",
                "faction": "Necrons",
                "role": "Battleline",
                "stats": {"M": "5\"", "T": 5, "SV": "3+", "INV": "-", "W": 1, "LD": "7+", "OC": 2},
                "weapons": [
                    {"name": "Tesla Carbine", "type": "Ranged", "range": "18\"", "attacks": "2", "bs_ws": "3+", "strength": "5", "ap": "0", "damage": "1", "abilities": "[ASSAULT, SUSTAINED HITS 2]"},
                    {"name": "Gauss Blaster", "type": "Ranged", "range": "24\"", "attacks": "2", "bs_ws": "3+", "strength": "5", "ap": "-1", "damage": "1", "abilities": "[LETHAL HITS]"},
                    {"name": "Close Combat Weapon", "type": "Melee", "range": "Melee", "attacks": "2", "bs_ws": "3+", "strength": "4", "ap": "0", "damage": "1", "abilities": "-"}
                ],
                "abilities": [
                    {"name": "Implacable Eradication", "description": "Re-roll Wound rolls of 1 (or all Wound rolls if target is on an objective marker)."}
                ],
                "keywords": ["Infantry", "Battleline", "Immortals", "Necrons"]
            },
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
                    {"name": "Necrodermis", "description": "Halve all incoming damage (round up) and gain 5+ Feel No Pain."}
                ],
                "keywords": ["Monster", "Character", "Epic Hero", "Fly", "C'tan Shard", "Nightbringer", "Necrons"]
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
                    {"name": "Matter Absorption", "description": "Regain D3+3 wounds when destroying an enemy Vehicle model."},
                    {"name": "Necrodermis", "description": "Halve all incoming damage (round up) and gain 5+ Feel No Pain."}
                ],
                "keywords": ["Monster", "Character", "Epic Hero", "Fly", "C'tan Shard", "Void Dragon", "Necrons"]
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
                    {"name": "Their Number is Legion", "description": "Re-roll Reanimation rolls of 1 (or all when near objective marker)."}
                ],
                "keywords": ["Infantry", "Battleline", "Necron Warriors", "Necrons"]
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
                "keywords": ["Beasts", "Fly", "Canoptek", "Wraiths", "Necrons"]
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

        # Clean unit name of quantity/char prefixes e.g. "10x Flayed Ones" -> "Flayed Ones", "Char1: 1x Overlord" -> "Overlord"
        cleaned_name = re.sub(r'^(?:char\d+:\s*)?(?:\d+x\s+)?', '', unit_name, flags=re.IGNORECASE).strip()
        cleaned_name = re.sub(r'\s*\(\d+\s*pts?\).*$', '', cleaned_name, flags=re.IGNORECASE).strip()
        
        norm_name = self._normalize_name(cleaned_name)
        
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
            if norm_name and (norm_name in k or k in norm_name):
                return self.datasheets.get(pid)

        # 4. Synthesize intelligent default if not found
        return {
            "id": f"GEN-{norm_name[:8].upper()}",
            "name": cleaned_name or unit_name,
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
        """Returns detachment-specific and core stratagems."""
        det_upper = (detachment or "").upper()
        fac_upper = (faction or "").upper()

        det_strats: List[Dict[str, Any]] = []

        # 1. NECRONS: Starshatter Arsenal / Relentless Onslaught
        if "STARSHATTER" in det_upper or "RELENTLESS" in det_upper:
            det_strats = [
                {"name": "Relentless Destruction", "type": "Detachment (Starshatter)", "cp": 1, "phase": "Shooting Phase", "description": "Target friendly Necrons unit. Ranged attacks gain [SUSTAINED HITS 1] (or [SUSTAINED HITS 2] against enemy units at Starting Strength)."},
                {"name": "Entropic Disintegration", "type": "Detachment (Starshatter)", "cp": 1, "phase": "Shooting Phase", "description": "Select one enemy unit hit by a friendly Vehicle or Destroyer Cult model. That enemy unit suffers -1 Toughness and -1 to save rolls until the end of the phase."},
                {"name": "Quantum Phalanx", "type": "Detachment (Starshatter)", "cp": 1, "phase": "Opponent's Shooting/Fight Phase", "description": "Target friendly Necrons unit; subtract 1 from Damage of allocated attacks (min 1) and models gain a 4+ invulnerable save."},
                {"name": "Dimensional Breach", "type": "Detachment (Starshatter)", "cp": 1, "phase": "Movement Phase", "description": "Select one Necrons unit arriving from Strategic Reserves or Deep Strike; it can be set up anywhere more than 6\" horizontally away from enemy models."},
                {"name": "Undying Protocols", "type": "Detachment (Starshatter)", "cp": 1, "phase": "Any Phase", "description": "When a Necrons unit is targeted by attacks, immediately trigger its Reanimation Protocols and re-roll any Reanimation dice of 1."},
                {"name": "Annihilation Protocols", "type": "Detachment (Starshatter)", "cp": 1, "phase": "Fight Phase", "description": "When a Destroyer Cult or Flayed Ones unit charges, its melee attacks gain [LETHAL HITS] and [LANCE] (+1 to wound)."}
            ]
        # 2. NECRONS: Canoptek Court
        elif "CANOPTEK" in det_upper:
            det_strats = [
                {"name": "Cynical Targeting", "type": "Detachment (Canoptek Court)", "cp": 1, "phase": "Shooting Phase", "description": "Re-roll Hit rolls for Canoptek and Cryptek units within the Power Matrix."},
                {"name": "Reactive Subroutines", "type": "Detachment (Canoptek Court)", "cp": 1, "phase": "Opponent's Movement Phase", "description": "Target Canoptek unit; move up to 6\" when an enemy ends a Normal, Advance or Fall Back move within 9\"."},
                {"name": "Solar Pulse", "type": "Detachment (Canoptek Court)", "cp": 1, "phase": "Shooting Phase", "description": "Target enemy unit loses the Benefit of Cover against attacks from friendly Necrons units."},
                {"name": "Immortal Protocol", "type": "Detachment (Canoptek Court)", "cp": 1, "phase": "Any Phase", "description": "When a Cryptek or Character model is destroyed, return it to life on a 2+ with D3 wounds at the end of the phase."},
                {"name": "Curse of the Cryptek", "type": "Detachment (Canoptek Court)", "cp": 1, "phase": "Fight/Shooting Phase", "description": "Inflict mortal wounds on enemy units attacking Cryptek bodyguard units."},
                {"name": "Dimensional Translocation", "type": "Detachment (Canoptek Court)", "cp": 1, "phase": "Movement Phase", "description": "Place a Canoptek unit into Strategic Reserves."}
            ]
        # 3. NECRONS: Awakened Dynasty
        elif "AWAKENED" in det_upper or ("NECRON" in fac_upper and not det_upper):
            det_strats = [
                {"name": "Protocol of the Undying Legions", "type": "Detachment (Awakened Dynasty)", "cp": 1, "phase": "Any Phase", "description": "Reanimate D3+1 wounds/models for target Necrons unit (or 2D3 if led by Character)."},
                {"name": "Protocol of the Sudden Storm", "type": "Detachment (Awakened Dynasty)", "cp": 1, "phase": "Movement Phase", "description": "Ranged weapons gain [ASSAULT], and eligible to shoot after advancing."},
                {"name": "Protocol of the Hungry Void", "type": "Detachment (Awakened Dynasty)", "cp": 1, "phase": "Fight Phase", "description": "Melee weapons gain +1 Strength and +1 AP."},
                {"name": "Protocol of the Conquering Tyrant", "type": "Detachment (Awakened Dynasty)", "cp": 1, "phase": "Shooting/Fight Phase", "description": "Re-roll Hit rolls of 1 (re-roll all Hit rolls if within range of an objective marker)."},
                {"name": "Protocol of the Vengeful Stars", "type": "Detachment (Awakened Dynasty)", "cp": 1, "phase": "Opponent's Shooting Phase", "description": "Shoot back when a friendly Character unit is targeted."},
                {"name": "Protocol of the Cryptothrall", "type": "Detachment (Awakened Dynasty)", "cp": 1, "phase": "Any Phase", "description": "Grant Feel No Pain 5+ to target Necrons unit."}
            ]
        # 4. NECRONS: Hypercrypt Legion
        elif "HYPERCRYPT" in det_upper:
            det_strats = [
                {"name": "Cosmic Precision", "type": "Detachment (Hypercrypt)", "cp": 1, "phase": "Movement Phase", "description": "Set up a Hyperphased unit anywhere more than 3\" horizontally from enemy models (cannot charge)."},
                {"name": "Hyperphasic Recall", "type": "Detachment (Hypercrypt)", "cp": 1, "phase": "End of Opponent's Turn", "description": "Place up to two friendly units into Hyperphasing reserves."},
                {"name": "Dimensional Corridor", "type": "Detachment (Hypercrypt)", "cp": 1, "phase": "Movement Phase", "description": "Arrive through a Monolith's Eternity Gate and make a charge this turn."},
                {"name": "Quantum Entanglement", "type": "Detachment (Hypercrypt)", "cp": 1, "phase": "Opponent's Shooting Phase", "description": "Target Necrons unit gains 4+ Invulnerable save."}
            ]
        # 5. SPACE MARINES: Gladius Task Force
        elif "GLADIUS" in det_upper or ("SPACE MARINE" in fac_upper and not det_upper):
            det_strats = [
                {"name": "Adaptive Strategy", "type": "Detachment (Gladius)", "cp": 1, "phase": "Command Phase", "description": "Select one Combat Doctrine (Devastator, Tactical, or Assault) for target Adeptus Astartes unit."},
                {"name": "Armour of Contempt", "type": "Detachment (Gladius)", "cp": 1, "phase": "Opponent's Shooting/Fight Phase", "description": "Worsen the Armour Penetration characteristic of incoming attacks by 1."},
                {"name": "Honour the Chapter", "type": "Detachment (Gladius)", "cp": 1, "phase": "Fight Phase", "description": "Melee weapons gain [LANCE] (+1 to wound on charge) and +1 AP in Assault Doctrine."},
                {"name": "Only in Death Does Duty End", "type": "Detachment (Gladius)", "cp": 2, "phase": "Fight Phase", "description": "Fight on death on a 4+ when destroyed in melee before fighting."},
                {"name": "Squad Tactics", "type": "Detachment (Gladius)", "cp": 1, "phase": "Opponent's Movement Phase", "description": "Make a Normal move of up to D6\" (or 6\" for Phobos) when enemy ends move within 9\"."},
                {"name": "Storm of Fire", "type": "Detachment (Gladius)", "cp": 1, "phase": "Shooting Phase", "description": "Ranged attacks gain [IGNORES COVER] and [LETHAL HITS] in Devastator Doctrine."}
            ]

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

        return det_strats + core_strats


def get_wahapedia() -> WahapediaService:
    return WahapediaService()

