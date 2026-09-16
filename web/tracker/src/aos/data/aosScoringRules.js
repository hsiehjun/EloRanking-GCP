/**
 * Age of Sigmar (4th Edition) Scoring Rules Engine
 */

import {
  MAX_MATCH_VP,
  PRIMARY_MAX_VP,
  PRIMARY_ROUND_CAP,
  BATTLE_TACTIC_VP,
  BATTLE_TACTICS_MAX_VP,
  ROUNDS_COUNT
} from "./aosConstants.js";

/**
 * Creates fresh initial player state for Age of Sigmar
 */
export function createInitialAosPlayerState(defaultName = "Player 1", defaultAlliance = "Order") {
  return {
    name: defaultName,
    grandAlliance: defaultAlliance,
    faction: "stormcast-eternals",
    battleFormation: "Lightning Echelon",
    cp: 1, // Start with 1 CP in Round 1
    isUnderdog: false,
    rounds: Array.from({ length: ROUNDS_COUNT }, (_, idx) => ({
      round: idx + 1,
      primaryScore: 0,
      primarySelections: {},
      tacticId: null,
      tacticStatus: "none", // "none" | "selected" | "achieved" | "failed" | "forfeited_double_turn"
      tacticScore: 0
    }))
  };
}

/**
 * Calculates total primary objective VP (capped at 30)
 */
export function getTotalPrimaryScore(playerState) {
  if (!playerState || !Array.isArray(playerState.rounds)) return 0;
  const rawSum = playerState.rounds.reduce((sum, r) => sum + (r.primaryScore || 0), 0);
  return Math.min(PRIMARY_MAX_VP, rawSum);
}

/**
 * Calculates total battle tactic VP (capped at 20)
 */
export function getTotalTacticsScore(playerState) {
  if (!playerState || !Array.isArray(playerState.rounds)) return 0;
  const rawSum = playerState.rounds.reduce((sum, r) => sum + (r.tacticScore || 0), 0);
  return Math.min(BATTLE_TACTICS_MAX_VP, rawSum);
}

/**
 * Returns total completed tactics count (Key tiebreaker in AoS tournaments)
 */
export function getCompletedTacticsCount(playerState) {
  if (!playerState || !Array.isArray(playerState.rounds)) return 0;
  return playerState.rounds.filter(r => r.tacticStatus === "achieved").length;
}

/**
 * Calculates total match VP out of 50
 */
export function getTotalAosMatchScore(playerState) {
  if (!playerState) return 0;
  const pri = getTotalPrimaryScore(playerState);
  const tac = getTotalTacticsScore(playerState);
  return Math.min(MAX_MATCH_VP, pri + tac);
}

/**
 * Resolves Priority Roll and determines turn order, double-turn, and tactic forfeiture
 * Rule (AoS 4e): If you win Priority AND choose to go first (taking a consecutive turn),
 * you forfeit your Battle Tactic for that round (0 VP).
 */
export function resolvePriorityRoll({ round, priorityWinner, chosenFirst, previousRoundSecondPlayer }) {
  const isDoubleTurn = (round > 1 && chosenFirst === previousRoundSecondPlayer);
  const forfeitsBattleTactic = isDoubleTurn && (priorityWinner === chosenFirst);

  const secondTurn = (chosenFirst === "p1") ? "p2" : "p1";

  return {
    round,
    priorityWinner,
    chosenFirst,
    firstTurn: chosenFirst,
    secondTurn,
    isDoubleTurn,
    forfeitsBattleTactic,
    doubleTurnPlayer: isDoubleTurn ? chosenFirst : null
  };
}

/**
 * Returns whether a player is currently the Underdog (trailing in VP)
 */
export function determineUnderdogs(p1State, p2State) {
  const s1 = getTotalAosMatchScore(p1State);
  const s2 = getTotalAosMatchScore(p2State);
  return {
    p1IsUnderdog: s1 < s2,
    p2IsUnderdog: s2 < s1,
    isTied: s1 === s2
  };
}
