/**
 * Warhammer 40,000 11th Edition Secondary Missions Data
 */

export const FIXED_SECONDARY_SLUGS = new Set([
  "a-grievous-blow",
  "assassination",
  "bring-it-down",
  "engage-on-all-fronts"
]);

export const ALL_SECONDARY_MISSIONS_LIST = [
  ["A Grievous Blow", "a-grievous-blow"],
  ["A Tempting Target", "a-tempting-target"],
  ["Assassination", "assassination"],
  ["Beacon", "beacon"],
  ["Behind Enemy Lines", "behind-enemy-lines"],
  ["Bring it Down", "bring-it-down"],
  ["Burden of Trust", "burden-of-trust"],
  ["Centre Ground", "centre-ground"],
  ["Cleanse", "cleanse"],
  ["Defend Stronghold", "defend-stronghold"],
  ["Display of Might", "display-of-might"],
  ["Engage on All Fronts", "engage-on-all-fronts"],
  ["Forward Position", "forward-position"],
  ["No Prisoners", "no-prisoners"],
  ["Outflank", "outflank"],
  ["Overwhelming Force", "overwhelming-force"],
  ["Plunder", "plunder"],
  ["Secure No Man's Land", "secure-no-man-s-land"]
];

export const SECONDARY_MISSION_SLUGS = ALL_SECONDARY_MISSIONS_LIST.map(([, slug]) => slug);

export const FIXED_SECONDARY_OPTIONS = ALL_SECONDARY_MISSIONS_LIST
  .map(([, slug]) => slug)
  .filter(slug => FIXED_SECONDARY_SLUGS.has(slug));

export function getSecondaryCardName(slug) {
  const item = ALL_SECONDARY_MISSIONS_LIST.find(([, s]) => s === slug);
  return item ? item[0] : slug;
}

const ANY_BATTLE_ROUND = "ANY BATTLE ROUND";
const END_OF_YOUR_TURN = "End of your turn";
const END_OF_A_TURN = "End of a turn";
const END_OF_OPPONENT_OR_R5 = "End of your opponent's turn or the end of the fifth battle round (whichever comes first)";

export const SECONDARY_MISSION_RULES = {
  beacon: {
    name: "Beacon",
    whenDrawn: "<b>WHEN DRAWN:</b> Select one friendly unit on the battlefield or embarked within a <b>TRANSPORT</b> on the battlefield to be your <span class=\"cB__mark\">beacon</span> unit.",
    sections: [{
      when: ANY_BATTLE_ROUND,
      trigger: END_OF_OPPONENT_OR_R5,
      rows: [
        { text: "Your <span class=\"cB__mark\">beacon</span> unit is on the battlefield and not within your deployment zone.", vp: "3" },
        { text: "Your <span class=\"cB__mark\">beacon</span> unit is on the battlefield and not within your territory.", vp: "5", or: true }
      ]
    }]
  },
  outflank: {
    name: "Outflank",
    designerNote: "<b>Designer's Note:</b> Opposite battlefield edges are those parallel to each other.",
    sections: [{
      when: ANY_BATTLE_ROUND,
      trigger: END_OF_YOUR_TURN,
      rows: [
        { text: "One or more friendly units (excluding <b>AIRCRAFT</b> and <b>battle-shocked</b> units) are within 6\" of one or more battlefield edges and not within your territory.", vp: "3" },
        { text: "Two or more friendly units (excluding <b>AIRCRAFT</b> and <b>battle-shocked</b> units) are within 6\" of opposite battlefield edges and one or more of those units is not within your territory.", vp: "5", or: true }
      ]
    }]
  },
  plunder: {
    name: "Plunder",
    whenDrawn: "<b>WHEN DRAWN:</b> If the Cleanse <b>Secondary Mission</b> is active for you, <u>you can</u> draw one new <b>Secondary Mission</b> card and shuffle this card back into your <b>Secondary Mission</b> deck.",
    action: {
      title: "PLUNDER",
      rows: [
        { k: "STARTS", v: "Your Shooting phase." },
        { k: "UNITS", v: "One unit within a <b>terrain area</b> that is not within your territory." },
        { k: "USE LIMIT", v: "Once per turn." },
        { k: "COMPLETES", v: "Immediately." },
        { k: "EFFECT", v: "That <b>terrain area</b> is <span class=\"cB__mark\">plundered</span>." }
      ]
    },
    sections: [{
      when: ANY_BATTLE_ROUND,
      trigger: END_OF_YOUR_TURN,
      rows: [
        { text: "A <b>terrain area</b> was <span class=\"cB__mark\">plundered</span> this turn.", vp: "5" }
      ]
    }]
  },
  "forward-position": {
    name: "Forward Position",
    whenDrawn: "<b>WHEN DRAWN:</b> If it is the first battle round, <u>you can</u> draw one new <b>Secondary Mission</b> card and shuffle this card back into your <b>Secondary</b> <b>Mission</b> deck.",
    sections: [{
      when: ANY_BATTLE_ROUND,
      trigger: END_OF_YOUR_TURN,
      rows: [
        { text: "You control your opponent's <b>home objective</b> and/or each <b>expansion objective</b>.", vp: "5" }
      ]
    }]
  },
  "burden-of-trust": {
    name: "Burden of Trust",
    whenDrawn: "<b>WHEN DRAWN/START OF YOUR TURN:</b> For each <b>objective</b>, you can select one friendly unit on the battlefield to <b>guard</b> that <b>objective</b>. Until the start of your next turn, while that unit is within range of that <b>objective</b> and while you control that <b>objective</b>, that <b>objective</b> is <span class=\"cB__mark\">guarded</span> by your army.",
    sections: [{
      when: ANY_BATTLE_ROUND,
      trigger: END_OF_OPPONENT_OR_R5,
      cap: "MAX 5VP",
      rows: [
        { text: "For each <b>objective</b> <span class=\"cB__mark\">guarded</span> by your army.", vp: "2" }
      ]
    }]
  },
  "secure-no-man-s-land": {
    name: "Secure No Man's Land",
    nameSize: 40,
    sections: [{
      when: ANY_BATTLE_ROUND,
      trigger: END_OF_YOUR_TURN,
      rows: [
        { text: "You control two or more <b>objectives</b> within No Man's Land (excluding your <b>home objective</b>).", vp: "5" }
      ]
    }]
  },
  "centre-ground": {
    name: "Centre Ground",
    sections: [{
      when: ANY_BATTLE_ROUND,
      trigger: END_OF_YOUR_TURN,
      rows: [
        { text: "One or more friendly units (excluding <b>AIRCRAFT</b> and <b>battle-shocked</b> units) are within 3\" of the centre of the battlefield, and <u>no</u> enemy units are within <u>3\"</u> of the centre of the battlefield.", vp: "3" },
        { text: "One or more friendly units (excluding <b>AIRCRAFT</b> and <b>battle-shocked</b> units) are within 3\" of the centre of the battlefield, and <u>no</u> enemy units are within <u>6\"</u> of the centre of the battlefield.", vp: "5", or: true }
      ]
    }]
  },
  "display-of-might": {
    name: "Display of Might",
    nameSize: 44,
    sections: [
      {
        when: ANY_BATTLE_ROUND,
        trigger: END_OF_YOUR_TURN,
        rows: [
          { text: "There are more friendly units than enemy units (excluding <b>AIRCRAFT</b> and <b>battle-shocked</b> units) wholly within No Man's Land.", vp: "2" }
        ]
      },
      {
        when: ANY_BATTLE_ROUND,
        trigger: "End of your opponent's turn",
        rows: [
          { text: "There are more friendly units than enemy units (excluding <b>AIRCRAFT</b> and <b>battle-shocked</b> units) wholly within No Man's Land.", vp: "5" }
        ]
      }
    ]
  },
  "engage-on-all-fronts": {
    name: "Engage on All Fronts",
    nameSize: 38,
    kindLabel: "SECONDARY · FIXED / TACTICAL",
    whenDrawn: "If one or more friendly units (excluding <b>AIRCRAFT</b> and <b>battle-shocked</b> units) are wholly within a table quarter, and those units are not within 6\" of the centre of the battlefield, you have a <span class=\"cB__mark\">presence</span> in that table quarter.",
    sections: [
      {
        when: ANY_BATTLE_ROUND,
        headerKind: "fixed",
        chip: "FIXED",
        trigger: END_OF_YOUR_TURN,
        rows: [
          { text: "You have a <span class=\"cB__mark\">presence</span> in <span class=\"cB__wmWord\" data-n=\"3\">three</span> table quarters.", vp: "2", kind: "fixed", wm: true },
          { text: "You have a <span class=\"cB__mark\">presence</span> in <span class=\"cB__wmWord\" data-n=\"4\">four</span> table quarters.", vp: "4", kind: "fixed", or: true, wm: true }
        ]
      },
      {
        when: ANY_BATTLE_ROUND,
        chip: "TACTICAL",
        trigger: END_OF_YOUR_TURN,
        rows: [
          { text: "You have a <span class=\"cB__mark\">presence</span> in <span class=\"cB__wmWord\" data-n=\"3\">three</span> table quarters.", vp: "3", wm: true },
          { text: "You have a <span class=\"cB__mark\">presence</span> in <span class=\"cB__wmWord\" data-n=\"4\">four</span> table quarters.", vp: "5", or: true, wm: true }
        ]
      }
    ]
  },
  "defend-stronghold": {
    name: "Defend Stronghold",
    nameSize: 42,
    whenDrawn: "<b>WHEN DRAWN:</b> If it is the first battle round, draw one new <b>Secondary Mission</b> card and shuffle this card back into your <b>Secondary Mission</b> deck.",
    sections: [{
      when: "SECOND BATTLE ROUND ONWARDS",
      trigger: END_OF_OPPONENT_OR_R5,
      rows: [
        { text: "You control your <b>home objective</b>.", vp: "3" },
        { text: "No enemy units are within your deployment zone.", vp: "+2", plus: true, cumulative: true }
      ]
    }]
  },
  "a-grievous-blow": {
    name: "A Grievous Blow",
    nameSize: 42,
    kindLabel: "SECONDARY · FIXED / TACTICAL",
    whenDrawn: "<b>WHEN DRAWN:</b> If there are no enemy units with a <b>starting strength</b> of 13 or more on the battlefield, <u>you can</u> discard this card and draw one new <b>Secondary Mission</b> card.",
    sections: [
      {
        when: ANY_BATTLE_ROUND,
        headerKind: "fixed",
        chip: "FIXED",
        trigger: END_OF_A_TURN,
        perEvent: true,
        rows: [
          { text: "For each enemy unit with a <b>starting strength</b> of 13 or more that is <b>destroyed</b> this turn.", vp: "4", kind: "fixed" }
        ]
      },
      {
        when: ANY_BATTLE_ROUND,
        chip: "TACTICAL",
        trigger: END_OF_A_TURN,
        rows: [
          { text: "One or more enemy units with a <b>starting strength</b> of 13 or more were <b>destroyed</b> this turn.", vp: "5" }
        ]
      }
    ]
  },
  "bring-it-down": {
    name: "Bring It Down",
    kindLabel: "SECONDARY · FIXED / TACTICAL",
    whenDrawn: "<b>WHEN DRAWN:</b> If there are no enemy models with a <b>Wounds</b> characteristic of 10 or more on the battlefield, <u>you can</u> discard this card and draw one new <b>Secondary Mission</b> card.",
    sections: [
      {
        when: ANY_BATTLE_ROUND,
        headerKind: "fixed",
        chip: "FIXED",
        trigger: END_OF_A_TURN,
        perEvent: true,
        rows: [
          { text: "For each enemy model with a <b>Wounds</b> characteristic of 10 or more that is <b>destroyed</b> this turn.", vp: "4", kind: "fixed" }
        ]
      },
      {
        when: ANY_BATTLE_ROUND,
        chip: "TACTICAL",
        trigger: END_OF_A_TURN,
        rows: [
          { text: "One or more enemy models with a <b>Wounds</b> characteristic of 10 or more were <b>destroyed</b> this turn.", vp: "5" }
        ]
      }
    ]
  },
  "behind-enemy-lines": {
    name: "Behind Enemy Lines",
    nameSize: 42,
    whenDrawn: "<b>WHEN DRAWN:</b> If it is the first battle round, <u>you can</u> draw one new <b>Secondary Mission</b> card and shuffle this card back into your <b>Secondary</b> <b>Mission</b> deck.",
    sections: [{
      when: ANY_BATTLE_ROUND,
      trigger: END_OF_YOUR_TURN,
      cap: "MAX 5VP",
      rows: [
        { text: "For each friendly unit (excluding <b>AIRCRAFT</b> and <b>battle-shocked</b> units) wholly within your opponent's deployment zone.", vp: "3" }
      ]
    }]
  },
  cleanse: {
    name: "Cleanse",
    whenDrawn: "<b>WHEN DRAWN:</b> If the Plunder <b>Secondary Mission</b> is active for you, <u>you can</u> draw one new <b>Secondary Mission</b> card and shuffle this card back into your <b>Secondary Mission</b> deck.",
    action: {
      title: "CLEANSE",
      rows: [
        { k: "STARTS", v: "Your Shooting phase." },
        { k: "UNITS", v: "One friendly unit within range of one <b>objective</b> (excluding your <b>home objective</b>)." },
        { k: "USE LIMIT", v: "Unlimited. Each unit that starts this <b>action</b> this phase must be within range of a different <b>objective</b>." },
        { k: "COMPLETES", v: "End of your turn, if that unit is controlling that <b>objective</b>." },
        { k: "EFFECT", v: "That <b>objective</b> is <span class=\"cB__mark\">cleansed</span> by your army." }
      ]
    },
    sections: [{
      when: ANY_BATTLE_ROUND,
      trigger: END_OF_YOUR_TURN,
      rows: [
        { text: "One <b>objective</b> was <span class=\"cB__mark\">cleansed</span> by your army this turn.", vp: "2" },
        { text: "Two or more <b>objectives</b> were <span class=\"cB__mark\">cleansed</span> by your army this turn.", vp: "5", or: true }
      ]
    }]
  },
  "overwhelming-force": {
    name: "Overwhelming Force",
    nameSize: 40,
    sections: [{
      when: ANY_BATTLE_ROUND,
      trigger: END_OF_A_TURN,
      cap: "MAX 5VP",
      rows: [
        { text: "For each enemy unit that started the turn within range of one or more <b>objectives</b> and is <b>destroyed</b>.", vp: "3" }
      ]
    }]
  },
  "no-prisoners": {
    name: "No Prisoners",
    sections: [{
      when: ANY_BATTLE_ROUND,
      trigger: END_OF_A_TURN,
      cap: "MAX 5VP",
      rows: [
        { text: "For each enemy unit <b>destroyed</b> this turn.", vp: "2" }
      ]
    }]
  },
  "a-tempting-target": {
    name: "A Tempting Target",
    nameSize: 42,
    whenDrawn: "<b>WHEN DRAWN:</b> Your opponent selects one <b>objective</b> (excluding <b>home objectives</b>) within No Man's Land to be your <b>tempting target</b>.",
    sections: [{
      when: ANY_BATTLE_ROUND,
      trigger: END_OF_YOUR_TURN,
      rows: [
        { text: "You control your <b>tempting target</b>.", vp: "5" }
      ]
    }]
  },
  assassination: {
    name: "Assassination",
    nameSize: 50,
    kindLabel: "SECONDARY · FIXED / TACTICAL",
    sections: [
      {
        when: ANY_BATTLE_ROUND,
        headerKind: "fixed",
        chip: "FIXED",
        trigger: "While this card is active",
        perEvent: true,
        rows: [
          { text: "For each enemy <b>CHARACTER</b> model <b>destroyed</b> this turn.", vp: "3", kind: "fixed" },
          { text: "For each of those models with a <b>W</b> of 4 or more.", vp: "+1", kind: "fixed", plus: true, cumulative: true }
        ]
      },
      {
        when: ANY_BATTLE_ROUND,
        chip: "TACTICAL",
        trigger: "End of either player's turn",
        rows: [
          { text: "One or more enemy <b>CHARACTER</b> models were <b>destroyed</b> this turn.", vp: "5" },
          { text: "All enemy <b>CHARACTER</b> models have been <b>destroyed</b> during the battle.", vp: "5", or: true }
        ]
      }
    ]
  }
};

export function getSecondaryMission(cardId) {
  return SECONDARY_MISSION_RULES[cardId] || null;
}

export function parseVpValue(vp) {
  const match = String(vp ?? "").match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

export function parseCapValue(capStr) {
  if (!capStr) return null;
  const match = String(capStr).match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

const NAME_TO_SLUG = Object.fromEntries(
  Object.entries(SECONDARY_MISSION_RULES).map(([slug, data]) => [data.name.toLowerCase(), slug])
);

export function checkReshuffleRules(cardId) {
  const data = SECONDARY_MISSION_RULES[cardId];
  const whenDrawn = data?.whenDrawn ?? "";
  if (!/shuffle this card back/i.test(whenDrawn)) {
    return {
      mandatoryRound1: false,
      optionalReshuffle: false,
      round1Only: false,
      requiresActiveSlug: null
    };
  }

  const isRound1 = /first battle round/i.test(whenDrawn);
  const isOptional = /you can/i.test(whenDrawn);

  let requiresActive = null;
  const match = whenDrawn.match(/if the\s+(.+?)\s+<b>secondary mission<\/b>\s+is active for you/i);
  if (match && NAME_TO_SLUG[match[1].trim().toLowerCase()]) {
    requiresActive = NAME_TO_SLUG[match[1].trim().toLowerCase()];
  }

  return {
    mandatoryRound1: !isOptional && isRound1,
    optionalReshuffle: isOptional,
    round1Only: isRound1,
    requiresActiveSlug: requiresActive
  };
}

export function getReshuffleNote(cardId) {
  const rules = checkReshuffleRules(cardId);
  if (!rules.optionalReshuffle) return null;
  const whenDrawn = SECONDARY_MISSION_RULES[cardId]?.whenDrawn ?? "";
  return whenDrawn
    .replace(/<b>\s*when drawn:\s*<\/b>/i, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim() || null;
}
