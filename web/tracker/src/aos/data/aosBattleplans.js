/**
 * Age of Sigmar (4th Edition / General's Handbook 2024-2025) Battleplans
 */

export const AOS_BATTLEPLANS = [
  {
    id: "border-war",
    name: "Border War",
    subtitle: "Classic 4-Objective Frontier Skirmish",
    objectivesCount: 4,
    deployment: "Vanguard Clash (Long Edges)",
    maxPrimaryPerRound: 6,
    description: "Hold your home turf while breaching the opponent's fortified border.",
    scoringConditions: [
      { id: "hold1", label: "Control 1 or more objectives", vp: 2 },
      { id: "hold2", label: "Control 2 or more objectives", vp: 2 },
      { id: "holdMore", label: "Control more objectives than opponent", vp: 2 }
    ]
  },
  {
    id: "shifting-objectives",
    name: "Shifting Objectives",
    subtitle: "Dynamic 3-Objective Arcane Pulse",
    objectivesCount: 3,
    deployment: "Hammer and Anvil",
    maxPrimaryPerRound: 6,
    description: "At the start of battle round 2, one objective surges with prime magical energy.",
    scoringConditions: [
      { id: "hold1", label: "Control 1 or more objectives", vp: 2 },
      { id: "hold2", label: "Control 2 or more objectives", vp: 2 },
      { id: "holdMore", label: "Control more objectives than opponent", vp: 2 }
    ]
  },
  {
    id: "the-jaws-of-gallet",
    name: "The Jaws of Gallet",
    subtitle: "5-Objective Choke Point Meatgrinder",
    objectivesCount: 5,
    deployment: "Flank Assault",
    maxPrimaryPerRound: 6,
    description: "Fight for control of narrow canyon passes and ancient nexus ruins.",
    scoringConditions: [
      { id: "hold1", label: "Control 1 or more objectives", vp: 2 },
      { id: "hold2", label: "Control 2 or more objectives", vp: 2 },
      { id: "holdMore", label: "Control more objectives than opponent", vp: 2 }
    ]
  },
  {
    id: "focal-points",
    name: "Focal Points",
    subtitle: "Central High-Value Nexus",
    objectivesCount: 5,
    deployment: "Dawn Attack",
    maxPrimaryPerRound: 6,
    description: "The central objective radiates raw realm energy and awards escalated points.",
    scoringConditions: [
      { id: "hold1", label: "Control 1 or more objectives", vp: 2 },
      { id: "hold2", label: "Control 2 or more objectives", vp: 2 },
      { id: "holdMore", label: "Control more objectives than opponent", vp: 2 }
    ]
  },
  {
    id: "battle-for-the-pass",
    name: "Battle for the Pass",
    subtitle: "Narrow Corridor Deep Incursion",
    objectivesCount: 4,
    deployment: "Short Edge Standoff",
    maxPrimaryPerRound: 6,
    description: "Battle down the long axis of the realm with deep territory penetrations.",
    scoringConditions: [
      { id: "hold1", label: "Control 1 or more objectives", vp: 2 },
      { id: "hold2", label: "Control 2 or more objectives", vp: 2 },
      { id: "holdMore", label: "Control more objectives than opponent", vp: 2 }
    ]
  },
  {
    id: "the-lurking-fiend",
    name: "The Lurking Fiend",
    subtitle: "Wild Ghur Ambush Battlefield",
    objectivesCount: 4,
    deployment: "Diagonal Deployment",
    maxPrimaryPerRound: 6,
    description: "A subterranean predator stalks the realm floor, shifting the safest control zones.",
    scoringConditions: [
      { id: "hold1", label: "Control 1 or more objectives", vp: 2 },
      { id: "hold2", label: "Control 2 or more objectives", vp: 2 },
      { id: "holdMore", label: "Control more objectives than opponent", vp: 2 }
    ]
  },
  {
    id: "scorch-the-earth",
    name: "Scorch the Earth",
    subtitle: "Raze and Ransack Hostile Turf",
    objectivesCount: 4,
    deployment: "Dawn Raid",
    maxPrimaryPerRound: 6,
    description: "Players can burn and despoil enemy territory objectives for tactical denial.",
    scoringConditions: [
      { id: "hold1", label: "Control 1 or more objectives", vp: 2 },
      { id: "hold2", label: "Control 2 or more objectives", vp: 2 },
      { id: "holdMore", label: "Control more objectives than opponent", vp: 2 }
    ]
  },
  {
    id: "vice",
    name: "Vice",
    subtitle: "Encroaching Realm Borders",
    objectivesCount: 4,
    deployment: "Converging Pincer",
    maxPrimaryPerRound: 6,
    description: "The battlefield constricts inward round by round, pushing generals into bloody melee.",
    scoringConditions: [
      { id: "hold1", label: "Control 1 or more objectives", vp: 2 },
      { id: "hold2", label: "Control 2 or more objectives", vp: 2 },
      { id: "holdMore", label: "Control more objectives than opponent", vp: 2 }
    ]
  }
];

export function getBattleplanById(id) {
  return AOS_BATTLEPLANS.find(b => b.id === id) || AOS_BATTLEPLANS[0];
}
