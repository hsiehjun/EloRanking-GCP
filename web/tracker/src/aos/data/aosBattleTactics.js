/**
 * Age of Sigmar (4th Edition / General's Handbook 2024-2025) Battle Tactics
 * Each tactic awards 4 VP upon completion and can only be attempted once per game.
 */

export const AOS_BATTLE_TACTICS = [
  // --- UNIVERSAL BATTLE TACTICS (GHB 2024-2025) ---
  {
    id: "take-the-flanks",
    name: "Take the Flanks",
    grandAlliance: "Universal",
    vp: 4,
    shortDesc: "Control both flank objectives",
    description: "You complete this tactic if you control both objectives furthest from the center of the battlefield at the end of your turn."
  },
  {
    id: "seize-the-centre",
    name: "Seize the Centre",
    grandAlliance: "Universal",
    vp: 4,
    shortDesc: "Control the central objective with a battleline unit",
    description: "You complete this tactic if you control the objective marker closest to the center of the battlefield and no enemy models contest it."
  },
  {
    id: "slay-the-warlord",
    name: "Slay the Warlord",
    grandAlliance: "Universal",
    vp: 4,
    shortDesc: "Destroy the enemy General",
    description: "You complete this tactic if the enemy General is destroyed during this turn."
  },
  {
    id: "attack-on-two-fronts",
    name: "Attack on Two Fronts",
    grandAlliance: "Universal",
    vp: 4,
    shortDesc: "Slay enemy models on two different objectives",
    description: "You complete this tactic if friendly units destroy enemy models on at least two separate objective markers during this turn."
  },
  {
    id: "brutal-dominance",
    name: "Brutal Dominance",
    grandAlliance: "Universal",
    vp: 4,
    shortDesc: "Destroy an enemy unit near an objective you control",
    description: "You complete this tactic if you destroy an enemy unit that was within 3\" of an objective marker you control."
  },
  {
    id: "restless-incursion",
    name: "Restless Incursion",
    grandAlliance: "Universal",
    vp: 4,
    shortDesc: "Move 3+ units into enemy territory",
    description: "You complete this tactic if 3 or more friendly units make a run or charge move and finish wholly within enemy territory."
  },
  {
    id: "surge-of-power",
    name: "Surge of Power",
    grandAlliance: "Universal",
    vp: 4,
    shortDesc: "Cast or chant successfully without being unbound",
    description: "You complete this tactic if you successfully cast a spell or chant a prayer and it is not unbound or banished."
  },
  {
    id: "bait-and-trap",
    name: "Bait and Trap",
    grandAlliance: "Universal",
    vp: 4,
    shortDesc: "Retreat with 1 unit and charge with another",
    description: "You complete this tactic if at least one friendly unit retreats and another friendly unit successfully completes a charge."
  },

  // --- GRAND ALLIANCE SPECIFIC TACTICS ---
  {
    id: "reclaim-the-realm",
    name: "Reclaim the Realm",
    grandAlliance: "Order",
    vp: 4,
    shortDesc: "Take an objective held by the enemy at start of turn",
    description: "You complete this tactic if you gain control of an objective marker that was controlled by your opponent at the start of your turn."
  },
  {
    id: "blood-for-the-dark-gods",
    name: "Blood for the Dark Gods",
    grandAlliance: "Chaos",
    vp: 4,
    shortDesc: "Destroy 2 or more enemy units in the Combat Phase",
    description: "You complete this tactic if 2 or more enemy units are destroyed by melee attacks in the combat phase of this turn."
  },
  {
    id: "endless-legions",
    name: "Endless Legions",
    grandAlliance: "Death",
    vp: 4,
    shortDesc: "Return slain models while contesting an objective",
    description: "You complete this tactic if you return slain models or a destroyed unit to the battlefield within 6\" of an objective you contest."
  },
  {
    id: "smash-and-bash",
    name: "Smash and Bash",
    grandAlliance: "Destruction",
    vp: 4,
    shortDesc: "Fight with 3+ friendly units in the Combat Phase",
    description: "You complete this tactic if at least 3 friendly units fight in the combat phase and each inflicts damage on an enemy unit."
  }
];

export function getTacticsForPlayer(grandAlliance) {
  return AOS_BATTLE_TACTICS.filter(
    t => t.grandAlliance === "Universal" || t.grandAlliance === grandAlliance
  );
}

export function getTacticById(id) {
  return AOS_BATTLE_TACTICS.find(t => t.id === id) || null;
}
