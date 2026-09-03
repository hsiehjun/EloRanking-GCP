/**
 * Warhammer 40,000 11th Edition Primary Missions Data
 */

export const TIMING = {
  COMMAND_PHASE: "End of your Command phase",
  COMMAND_PHASE_OR_R5: "End of your Command phase (or the end of your turn in the fifth battle round)",
  END_OF_TURN: "End of your turn",
  ROUND_2_ONWARDS: "SECOND BATTLE ROUND ONWARDS",
  ANY_ROUND: "ANY BATTLE ROUND",
  END_OF_BATTLE: "END OF BATTLE"
};

export const PRIMARY_DECKS = [
  {
    "name": "Take and Hold",
    "slug": "take-and-hold",
    "description": "Hold the most objective markers across the battlefield.",
    "color": "#2f6b4f",
    "cards": [
      {
        "name": "Battlefield Dominance",
        "slug": "battlefield-dominance",
        "image": "/assets/11th/primary-missions/take-and-hold/battlefield-dominance.png"
      },
      {
        "name": "Determined Acquisition",
        "slug": "determined-acquisition",
        "image": "/assets/11th/primary-missions/take-and-hold/determined-acquisition.png"
      },
      {
        "name": "Immovable Object",
        "slug": "immovable-object",
        "image": "/assets/11th/primary-missions/take-and-hold/immovable-object.png"
      },
      {
        "name": "Inescapable Dominion",
        "slug": "inescapable-dominion",
        "image": "/assets/11th/primary-missions/take-and-hold/inescapable-dominion.png"
      },
      {
        "name": "Purge and Secure",
        "slug": "purge-and-secure",
        "image": "/assets/11th/primary-missions/take-and-hold/purge-and-secure.png"
      }
    ]
  },
  {
    "name": "Purge the Foe",
    "slug": "purge-the-foe",
    "description": "Destroy the enemy and dominate the battlefield through force.",
    "color": "#8a2b2b",
    "cards": [
      {
        "name": "Consecrate",
        "slug": "consecrate",
        "image": "/assets/11th/primary-missions/purge-the-foe/consecrate.png"
      },
      {
        "name": "Destroyer's Wrath",
        "slug": "destroyers-wrath",
        "image": "/assets/11th/primary-missions/purge-the-foe/destroyers-wrath.png"
      },
      {
        "name": "Meatgrinder",
        "slug": "meatgrinder",
        "image": "/assets/11th/primary-missions/purge-the-foe/meatgrinder.png"
      },
      {
        "name": "Punishment",
        "slug": "punishment",
        "image": "/assets/11th/primary-missions/purge-the-foe/punishment.png"
      },
      {
        "name": "Unstoppable Force",
        "slug": "unstoppable-force",
        "image": "/assets/11th/primary-missions/purge-the-foe/unstoppable-force.png"
      }
    ]
  },
  {
    "name": "Reconnaissance",
    "slug": "reconnaissance",
    "description": "Scout the battlefield and seize key intelligence positions.",
    "color": "#1f7a82",
    "cards": [
      {
        "name": "Gather Intel",
        "slug": "gather-intel",
        "image": "/assets/11th/primary-missions/reconnaissance/gather-intel.png",
        "back": "/assets/11th/primary-missions/reconnaissance/gather-intel-back.png"
      },
      {
        "name": "Reconnaissance Sweep",
        "slug": "reconnaissance-sweep",
        "image": "/assets/11th/primary-missions/reconnaissance/reconnaissance-sweep.png"
      },
      {
        "name": "Search and Scour",
        "slug": "search-and-scour",
        "image": "/assets/11th/primary-missions/reconnaissance/search-and-scour.png"
      },
      {
        "name": "Surveil the Foe",
        "slug": "surveil-the-foe",
        "image": "/assets/11th/primary-missions/reconnaissance/surveil-the-foe.png",
        "back": "/assets/11th/primary-missions/reconnaissance/surveil-the-foe-back.png"
      },
      {
        "name": "Triangulation",
        "slug": "triangulation",
        "image": "/assets/11th/primary-missions/reconnaissance/triangulation.png",
        "back": "/assets/11th/primary-missions/reconnaissance/triangulation-back.png"
      }
    ]
  },
  {
    "name": "Priority Assets",
    "slug": "priority-assets",
    "description": "Capture and hold the high value assets scattered across the field.",
    "color": "#a17b14",
    "cards": [
      {
        "name": "Extract Relic",
        "slug": "extract-relic",
        "image": "/assets/11th/primary-missions/priority-assets/extract-relic.png",
        "back": "/assets/11th/primary-missions/priority-assets/extract-relic-back.png"
      },
      {
        "name": "Sabotage",
        "slug": "sabotage",
        "image": "/assets/11th/primary-missions/priority-assets/sabotage.png",
        "back": "/assets/11th/primary-missions/priority-assets/sabotage-back.png"
      },
      {
        "name": "Secure Asset",
        "slug": "secure-asset",
        "image": "/assets/11th/primary-missions/priority-assets/secure-asset.png",
        "back": "/assets/11th/primary-missions/priority-assets/secure-asset-back.png"
      },
      {
        "name": "Vanguard Operation",
        "slug": "vanguard-operation",
        "image": "/assets/11th/primary-missions/priority-assets/vanguard-operation.png",
        "back": "/assets/11th/primary-missions/priority-assets/vanguard-operation-back.png"
      },
      {
        "name": "Vital Link",
        "slug": "vital-link",
        "image": "/assets/11th/primary-missions/priority-assets/vital-link.png",
        "back": "/assets/11th/primary-missions/priority-assets/vital-link-back.png"
      }
    ]
  },
  {
    "name": "Disruption",
    "slug": "disruption",
    "description": "Disrupt the enemy battle plan and deny them the field.",
    "color": "#1f4f8a",
    "cards": [
      {
        "name": "Death Trap",
        "slug": "death-trap",
        "image": "/assets/11th/primary-missions/disruption/death-trap.png",
        "back": "/assets/11th/primary-missions/disruption/death-trap-back.png"
      },
      {
        "name": "Delaying Action",
        "slug": "delaying-action",
        "image": "/assets/11th/primary-missions/disruption/delaying-action.png"
      },
      {
        "name": "Locate and Deny",
        "slug": "locate-and-deny",
        "image": "/assets/11th/primary-missions/disruption/locate-and-deny.png",
        "back": "/assets/11th/primary-missions/disruption/locate-and-deny-back.png"
      },
      {
        "name": "Outmanoeuvre",
        "slug": "outmanoeuvre",
        "image": "/assets/11th/primary-missions/disruption/outmanoeuvre.png"
      },
      {
        "name": "Smoke and Mirrors",
        "slug": "smoke-and-mirrors",
        "image": "/assets/11th/primary-missions/disruption/smoke-and-mirrors.png",
        "back": "/assets/11th/primary-missions/disruption/smoke-and-mirrors-back.png"
      }
    ]
  }
];

export const PRIMARY_MISSIONS = {
  "Unstoppable Force": {
    "name": "Unstoppable Force",
    "deck": "purge-the-foe",
    "vs": "take-and-hold",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "One or more enemy units were **destroyed** this turn.",
            "vp": 3
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "For each **objective** you control (excluding your **home objective**).",
            "vp": 4,
            "perUnit": true
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "You control one or more **objectives** you did not control at the start of the turn (excluding your **home objective**).",
            "vp": 3
          }
        ]
      },
      {
        "when": "END OF BATTLE",
        "headerKind": "eob",
        "tiers": [
          {
            "text": "You control one or more **central objectives**.",
            "vp": 5,
            "kind": "eob"
          }
        ]
      }
    ]
  },
  "Destroyer's Wrath": {
    "name": "Destroyer's Wrath",
    "deck": "purge-the-foe",
    "vs": "priority-assets",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "One or more enemy units were **destroyed** this turn.",
            "vp": 3
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "You control one or more **objectives** (excluding your **home objective**).",
            "vp": 4
          },
          {
            "text": "You control more **objectives** than your opponent.",
            "vp": 6
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "More enemy units were **destroyed** this turn than friendly units were **destroyed** in the previous turn.",
            "vp": 4
          }
        ]
      }
    ]
  },
  "Consecrate": {
    "name": "Consecrate",
    "deck": "purge-the-foe",
    "vs": "reconnaissance",
    "rule": "Each time a friendly unit **destroys** a unit, that friendly unit becomes a **consecration** unit. At the end of your turn, for each of your **consecration** units, you can select one **objective** it is within range of (excluding your **home objective**) that has not been **consecrated**. If you do, place one of your operation markers within range of that **objective** – that **objective** is **consecrated** and that unit is no longer a **consecration** unit.",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "One or two **objectives** are **consecrated**.",
            "vp": 3
          },
          {
            "text": "Three or more **objectives** are **consecrated**.",
            "vp": 6,
            "or": true
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "You control one or more **objectives** (excluding your **home objective**).",
            "vp": 4
          },
          {
            "text": "You control more **objectives** than your opponent.",
            "vp": 4
          }
        ]
      },
      {
        "when": "END OF BATTLE",
        "headerKind": "eob",
        "tiers": [
          {
            "text": "Your opponent's **home objective** is **consecrated**.",
            "vp": 5,
            "kind": "eob"
          }
        ]
      }
    ]
  },
  "Punishment": {
    "name": "Punishment",
    "deck": "purge-the-foe",
    "vs": "disruption",
    "rule": "**START OF YOUR TURN:** Select one to three enemy units that are on the battlefield and within range of **objectives** and/or that **destroyed** one or more friendly units in the previous turn. If you cannot, select one enemy unit that is on the battlefield. Until the start of your next turn, those units are **condemned**.",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of a turn",
        "tiers": [
          {
            "text": "One or more **condemned** enemy units left the battlefield this turn.",
            "vp": 5
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "You control one or more **objectives** (excluding your home **objective**).",
            "vp": 4
          },
          {
            "text": "You control more **objectives** than your opponent.",
            "vp": 5
          }
        ]
      },
      {
        "when": "END OF BATTLE",
        "headerKind": "eob",
        "tiers": [
          {
            "text": "You control your opponent's **home objective**.",
            "vp": 8,
            "kind": "eob"
          }
        ]
      }
    ]
  },
  "Meatgrinder": {
    "name": "Meatgrinder",
    "deck": "purge-the-foe",
    "vs": "purge-the-foe",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "One or more enemy units were **destroyed** this turn.",
            "vp": 3
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "You control one or more **objectives** (excluding your **home objective**).",
            "vp": 4
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "More enemy units were **destroyed** this turn than friendly units were **destroyed** in the previous turn.",
            "vp": 5
          },
          {
            "text": "You control your opponent's **home objective**.",
            "vp": 5
          }
        ]
      }
    ]
  },
  "Death Trap": {
    "name": "Death Trap",
    "deck": "disruption",
    "vs": "take-and-hold",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "For each **terrain area trapped** this turn.",
            "vp": 2,
            "perUnit": true
          },
          {
            "text": "For each of those **terrain areas** that is an **objective**.",
            "vp": 3,
            "perUnit": true,
            "cumulative": true
          }
        ]
      },
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "One or more enemy units that started the turn within a terrain area were destroyed, if that terrain area is **trapped**.",
            "vp": 3
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "You control one or more **objectives** (excluding your **home objective**).",
            "vp": 4
          }
        ]
      }
    ]
  },
  "Locate and Deny": {
    "name": "Locate and Deny",
    "deck": "disruption",
    "vs": "priority-assets",
    "rule": "**START OF THE BATTLE:** Select five **terrain areas** not within your deployment zone; for each one, place one of your **operation markers** within it. If you cannot, do so for each **terrain area** that is not within your deployment zone.",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "One or more enemy units that started the turn within range of one or more **objectives** are **destroyed**.",
            "vp": 4
          },
          {
            "text": "Only one of your **operation markers** is on the battlefield, if one or more of your units are within the same **terrain area** as that **marker**, and no enemy units are within that **terrain area**.",
            "vp": 4
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "You control one or more **objectives** (excluding your **home objective**).",
            "vp": 4
          }
        ]
      },
      {
        "when": "END OF BATTLE",
        "headerKind": "eob",
        "tiers": [
          {
            "text": "Only one of your **operation markers** is on the battlefield, if one or more of your units are within the same **terrain area** as that **marker**, and no enemy units are within that **terrain area**.",
            "vp": 5,
            "kind": "eob"
          }
        ]
      }
    ]
  },
  "Smoke and Mirrors": {
    "name": "Smoke and Mirrors",
    "deck": "disruption",
    "vs": "reconnaissance",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "For each **objective** that is **decoyed** (see reverse).",
            "vp": 2,
            "perUnit": true
          },
          {
            "text": "For each of those **objectives** that is within your opponent's territory.",
            "vp": 2,
            "perUnit": true,
            "cumulative": true
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "You control one or more **objectives** (excluding your **home objective**).",
            "vp": 4
          }
        ]
      },
      {
        "when": "END OF BATTLE",
        "headerKind": "eob",
        "tiers": [
          {
            "text": "**Four or more objectives** are **decoyed**.",
            "vp": 10,
            "kind": "eob"
          }
        ]
      }
    ]
  },
  "Outmanoeuvre": {
    "name": "Outmanoeuvre",
    "deck": "disruption",
    "vs": "disruption",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "You control your opponent's **home objective**.",
            "vp": 10
          }
        ]
      },
      {
        "when": "FIRST BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "For each **objective** you control (excluding your **home objective**).",
            "vp": 4,
            "perUnit": true
          }
        ]
      },
      {
        "when": "SECOND & THIRD BATTLE ROUND",
        "trigger": "End of your Command phase",
        "tiers": [
          {
            "text": "For each **objective** you control (excluding your **home objective**).",
            "vp": 5,
            "perUnit": true
          }
        ]
      },
      {
        "when": "FOURTH BATTLE ROUND ONWARDS",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "For each **objective** you control (excluding your **home objective**).",
            "vp": 6,
            "perUnit": true
          }
        ]
      }
    ]
  },
  "Delaying Action": {
    "name": "Delaying Action",
    "deck": "disruption",
    "vs": "purge-the-foe",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "For each enemy unit **destroyed** this turn.",
            "vp": 2,
            "perUnit": true
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "You control one or more **objectives** (excluding **home objectives**).",
            "vp": 4
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "You control one or more **central objectives** and one or more **expansion objectives**.",
            "vp": 3
          }
        ]
      }
    ]
  },
  "Secure Asset": {
    "name": "Secure Asset",
    "deck": "priority-assets",
    "vs": "take-and-hold",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "A friendly unit **secured the asset** this turn (see reverse).",
            "vp": 4
          },
          {
            "text": "One or more enemy units that started the turn within range of one or more **central objectives** are **destroyed**.",
            "vp": 2
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "You control one or more **objectives** (excluding your **home objective**).",
            "vp": 4
          },
          {
            "text": "You control three or more **objectives**.",
            "vp": 4
          }
        ]
      }
    ]
  },
  "Sabotage": {
    "name": "Sabotage",
    "deck": "priority-assets",
    "vs": "priority-assets",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "For each friendly unit that **committed sabotage** this turn (see reverse).",
            "vp": 3,
            "perUnit": true
          },
          {
            "text": "For each of those units that is within range of one or more **objectives** in your opponent's territory.",
            "vp": 2,
            "perUnit": true,
            "cumulative": true
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "You control one or more **objectives** (excluding your **home objective**).",
            "vp": 4
          }
        ]
      }
    ]
  },
  "Vanguard Operation": {
    "name": "Vanguard Operation",
    "deck": "priority-assets",
    "vs": "reconnaissance",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "A friendly unit **performed a vanguard operation** this turn.",
            "vp": 4
          },
          {
            "text": "One or more enemy units were **destroyed** this turn.",
            "vp": 2
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "You control one or more **objectives** (excluding your **home objective**).",
            "vp": 4
          }
        ]
      },
      {
        "when": "END OF BATTLE",
        "headerKind": "eob",
        "tiers": [
          {
            "text": "You control your opponent's **home objective**.",
            "vp": 10,
            "kind": "eob"
          }
        ]
      }
    ]
  },
  "Extract Relic": {
    "name": "Extract Relic",
    "deck": "priority-assets",
    "vs": "disruption",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "A friendly unit **performed a sensor sweep** this turn.",
            "vp": 4
          },
          {
            "text": "One or more enemy units that started the turn within range of one or more **objectives** are **destroyed**.",
            "vp": 3
          },
          {
            "text": "Only one of your opponent's **operation markers** is on the battlefield, if one or more of your units are within the same **terrain area** as that **operation marker**, and no enemy units are within that **terrain area**.",
            "vp": 4
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "You control one or more **objectives** (excluding your **home objective**).",
            "vp": 4
          }
        ]
      },
      {
        "when": "END OF BATTLE",
        "headerKind": "eob",
        "tiers": [
          {
            "text": "Only one of your opponent's **operation markers** is on the battlefield, if one or more of your units are within the same **terrain area** as that **operation marker**, and no enemy units are within that **terrain area**.",
            "vp": 5,
            "kind": "eob"
          }
        ]
      }
    ]
  },
  "Vital Link": {
    "name": "Vital Link",
    "deck": "priority-assets",
    "vs": "purge-the-foe",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "You control one or more **central objectives**.",
            "vp": 2
          },
          {
            "text": "For each of your **operation markers** within range of one of those **objectives** (see reverse).",
            "vp": 1,
            "perUnit": true,
            "cumulative": true
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "You control one or more **objectives** (excluding your **home objective**).",
            "vp": 4
          },
          {
            "text": "One or more of those **objectives** is a **central objective**.",
            "vp": 4,
            "cumulative": true
          }
        ]
      },
      {
        "when": "END OF BATTLE",
        "headerKind": "eob",
        "tiers": [
          {
            "text": "You control your opponent's **home objective**.",
            "vp": 10,
            "kind": "eob"
          }
        ]
      }
    ]
  },
  "Reconnaissance Sweep": {
    "name": "Reconnaissance Sweep",
    "deck": "reconnaissance",
    "vs": "take-and-hold",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "Three or more friendly units are wholly within three different table quarters and not within 6\" of the centre of the battlefield.",
            "vp": 3
          },
          {
            "text": "Four or more friendly units are wholly within four different table quarters and not within 6\" of the centre of the battlefield.",
            "vp": 6,
            "or": true
          }
        ]
      },
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "For each enemy unit **destroyed** this turn.",
            "vp": 1,
            "perUnit": true
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "You control one or more **objectives** (excluding your **home objective**).",
            "vp": 3
          }
        ]
      }
    ]
  },
  "Search and Scour": {
    "name": "Search and Scour",
    "deck": "reconnaissance",
    "vs": "priority-assets",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "You control one or more **central objectives**.",
            "vp": 3
          },
          {
            "text": "One or more enemy units that started the turn within a **terrain area** are **destroyed**.",
            "vp": 2
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "For each **objective** you control (excluding your **home objective**).",
            "vp": 4,
            "perUnit": true
          }
        ]
      },
      {
        "when": "END OF BATTLE",
        "headerKind": "eob",
        "tiers": [
          {
            "text": "No enemy units are wholly within your territory.",
            "vp": 5,
            "kind": "eob"
          }
        ]
      }
    ]
  },
  "Gather Intel": {
    "name": "Gather Intel",
    "deck": "reconnaissance",
    "vs": "reconnaissance",
    "sections": [
      {
        "when": "FIRST BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "You control one or more **central objectives**.",
            "vp": 6
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "You control one or more **objectives** (excluding your **home objective**).",
            "vp": 4
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "For each friendly unit that completed the **Extract Intelligence action** this turn.",
            "vp": 7,
            "perUnit": true
          }
        ]
      },
      {
        "when": "END OF BATTLE",
        "headerKind": "eob",
        "tiers": [
          {
            "text": "Three or more of your **operation markers** are on the battlefield.",
            "vp": 5,
            "kind": "eob"
          },
          {
            "text": "One of your **operation markers** is within range of your opponent's **home objective**.",
            "vp": 5,
            "kind": "eob"
          }
        ]
      }
    ]
  },
  "Surveil the Foe": {
    "name": "Surveil the Foe",
    "deck": "reconnaissance",
    "vs": "disruption",
    "rule": "Each time a friendly unit ends a move within range of one **objective** that has any of your **opponent's operation** markers within range of it, remove those **operation markers** from the battlefield.",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "One or more enemy units were **surveilled** this turn (see reverse), unless each of those units is within range of one or more **objectives** that have one or more **operation markers** within range of them.",
            "vp": 4
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "You control one or more **objectives** (excluding your **home objective**).",
            "vp": 4
          },
          {
            "text": "You control more **objectives** than your opponent.",
            "vp": 4
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "None of your opponent's **operation markers** are on the battlefield.",
            "vp": 5
          }
        ]
      }
    ]
  },
  "Triangulation": {
    "name": "Triangulation",
    "deck": "reconnaissance",
    "vs": "purge-the-foe",
    "sections": [
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "You control one or more **objectives** (excluding your **home objective**).",
            "vp": 4
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "One **objective** is **triangulated** (see reverse).",
            "vp": 3
          },
          {
            "text": "Two **objectives** are **triangulated**.",
            "vp": 6,
            "or": true
          },
          {
            "text": "Three or more **objectives** are **triangulated**.",
            "vp": 10,
            "or": true
          }
        ]
      },
      {
        "when": "END OF BATTLE",
        "headerKind": "eob",
        "tiers": [
          {
            "text": "You control four or more **objectives**.",
            "vp": 10,
            "kind": "eob"
          }
        ]
      }
    ]
  },
  "Battlefield Dominance": {
    "name": "Battlefield Dominance",
    "deck": "take-and-hold",
    "vs": "take-and-hold",
    "sections": [
      {
        "when": "FIRST & SECOND BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "You control more **objectives** than your opponent.",
            "vp": 2
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "For each **objective** you control.",
            "vp": 3,
            "perUnit": true
          },
          {
            "text": "For each of those **objectives** (excluding your **home objective**) if you control your **home objective**.",
            "vp": 2,
            "perUnit": true,
            "cumulative": true
          }
        ]
      }
    ]
  },
  "Inescapable Dominion": {
    "name": "Inescapable Dominion",
    "deck": "take-and-hold",
    "vs": "priority-assets",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "You control three or more **objectives**.",
            "vp": 4
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "You control two or more **objectives**.",
            "vp": 5
          },
          {
            "text": "You control more **objectives** than your opponent.",
            "vp": 4
          }
        ]
      },
      {
        "when": "END OF BATTLE",
        "headerKind": "eob",
        "tiers": [
          {
            "text": "You control your opponent's **home objective**.",
            "vp": 5,
            "kind": "eob"
          }
        ]
      }
    ]
  },
  "Purge and Secure": {
    "name": "Purge and Secure",
    "deck": "take-and-hold",
    "vs": "reconnaissance",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "One or more enemy units were **destroyed** this turn by a friendly unit that was within range of one or more **objectives**.",
            "vp": 3
          },
          {
            "text": "One or more enemy units that started the turn within range of one or more **objectives** were **destroyed** this turn.",
            "vp": 3,
            "or": true
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "For each **objective** you control (excluding your **home objective**).",
            "vp": 4,
            "perUnit": true
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "You control one or more **objectives** you did not control at the start of the turn (excluding your **home objective**).",
            "vp": 3
          }
        ]
      }
    ]
  },
  "Determined Acquisition": {
    "name": "Determined Acquisition",
    "deck": "take-and-hold",
    "vs": "disruption",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "For each **objective** you control that you did not control at the start of the turn (excluding your **home objective**).",
            "vp": 2,
            "perUnit": true
          }
        ]
      },
      {
        "when": "SECOND BATTLE ROUND ONWARDS",
        "trigger": "End of your Command phase (or the end of your turn in the fifth battle round)",
        "tiers": [
          {
            "text": "For each **objective** you control.",
            "vp": 3,
            "perUnit": true
          },
          {
            "text": "For each of those **objectives** that is within your opponent's territory.",
            "vp": 3,
            "perUnit": true,
            "cumulative": true
          }
        ]
      }
    ]
  },
  "Immovable Object": {
    "name": "Immovable Object",
    "deck": "take-and-hold",
    "vs": "purge-the-foe",
    "sections": [
      {
        "when": "ANY BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "You control one or more **central objectives**.",
            "vp": 3
          }
        ]
      },
      {
        "when": "SECOND TO FOURTH BATTLE ROUND",
        "trigger": "End of your Command phase",
        "tiers": [
          {
            "text": "For each **objective** you control (excluding your **home objective**).",
            "vp": 5,
            "perUnit": true
          }
        ]
      },
      {
        "when": "FIFTH BATTLE ROUND",
        "trigger": "End of your turn",
        "tiers": [
          {
            "text": "For each **objective** you control (excluding your **home objective**).",
            "vp": 5,
            "perUnit": true
          }
        ]
      }
    ]
  }
};

export function getPrimaryMission(missionName) {
  return PRIMARY_MISSIONS[missionName] || null;
}

export function getPrimaryMissionCard(missionName) {
  for (const deck of PRIMARY_DECKS) {
    const card = deck.cards.find(c => 
      c.name === missionName || 
      c.slug === missionName || 
      c.name.toLowerCase() === (missionName || "").toLowerCase()
    );
    if (card) {
      return {
        ...card,
        deckColor: deck.color,
        deckName: deck.name,
        deckSlug: deck.slug
      };
    }
  }
  return null;
}
