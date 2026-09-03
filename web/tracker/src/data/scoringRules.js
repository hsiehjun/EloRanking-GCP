import {
  BATTLE_READY_VP,
  PRIMARY_MAX_VP,
  PRIMARY_ROUND_CAP,
  SECONDARY_MAX_VP,
  SECONDARY_ROUND_CAP,
  SECONDARY_CARD_CAP,
  SECONDARY_FIXED_MAX_VP,
  MAX_MATCH_VP
} from "./constants.js";
import { SECONDARY_MISSION_SLUGS } from "./secondaryMissions.js";

let instanceCounter = 0;

/**
 * Draw a random card from available deck with optional filter
 */
export function drawCardFromDeck(deck, filterFn) {
  if (!deck || deck.length === 0) {
    return { card: null, remaining: [] };
  }
  const eligible = filterFn ? deck.filter(filterFn) : deck;
  if (eligible.length === 0) {
    return { card: null, remaining: deck };
  }
  const card = eligible[Math.floor(Math.random() * eligible.length)];
  const index = deck.indexOf(card);
  return {
    card,
    remaining: [...deck.slice(0, index), ...deck.slice(index + 1)]
  };
}

/**
 * Create a new secondary card instance in hand
 */
export function createSecondaryInstance(cardId, side, round) {
  instanceCounter += 1;
  const timestamp = Date.now().toString(36);
  const countStr = instanceCounter.toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return {
    instanceId: `sec-${timestamp}-${countStr}-${rand}`,
    cardId,
    side: side || "attacker",
    status: "held",
    drawnRound: round,
    scoredRound: null,
    discardedRound: null,
    points: 0
  };
}

/**
 * Discard a secondary card from hand
 */
export function discardSecondaryCard(hand, instanceId, round) {
  return hand.map(card =>
    card.instanceId === instanceId
      ? { ...card, status: "discarded", discardedRound: round }
      : card
  );
}

/**
 * Check if a card is currently held in hand
 */
export function isCardInHand(hand, cardId) {
  return hand.some(card => card.cardId === cardId && card.status !== "discarded");
}

/**
 * Retrieve the score entry for a card in a given round
 */
export function getCardRoundScore(card, round) {
  if (card.recurring) {
    return card.roundScores?.[round] ?? null;
  }
  if (card.scoredRound !== round) {
    return null;
  }
  return {
    points: card.points || 0,
    selection: card.scoreSelection
  };
}

/**
 * Retrieve the VP points for a card in a given round
 */
export function getCardRoundPoints(card, round) {
  return getCardRoundScore(card, round)?.points || 0;
}

/**
 * Calculate total secondary points scored in a given round
 */
export function getRoundSecondaryTotal(hand, round) {
  return hand.reduce((sum, card) => sum + getCardRoundPoints(card, round), 0);
}

/**
 * Calculate total secondary points scored across all rounds
 */
export function getTotalSecondaryScore(hand) {
  return hand.reduce((total, card) => {
    if (card.recurring) {
      const sum = Object.values(card.roundScores ?? {}).reduce(
        (acc, val) => acc + (val.points || 0),
        0
      );
      return total + sum;
    }
    return total + (card.scoredRound != null ? card.points || 0 : 0);
  }, 0);
}

/**
 * Calculate remaining secondary points available for a card in a given round
 */
export function getAvailableSecondaryPoints(hand, instanceId, round) {
  const roundPointsExcludingCurrent = hand.reduce((acc, card) => {
    return card.instanceId === instanceId ? acc : acc + getCardRoundPoints(card, round);
  }, 0);

  let cap = Math.min(
    SECONDARY_CARD_CAP,
    Math.max(0, SECONDARY_ROUND_CAP - roundPointsExcludingCurrent)
  );

  const targetCard = hand.find(c => c.instanceId === instanceId);
  if (targetCard?.recurring) {
    const cardPointsOtherRounds = Object.entries(targetCard.roundScores ?? {}).reduce(
      (acc, [r, val]) => (Number(r) === round ? acc : acc + (val.points || 0)),
      0
    );
    cap = Math.min(cap, Math.max(0, SECONDARY_FIXED_MAX_VP - cardPointsOtherRounds));
  }
  return cap;
}

/**
 * Determine the reason limiting the secondary cap ("fixed" or "round")
 */
export function getCapReason(hand, instanceId, round) {
  const targetCard = hand.find(c => c.instanceId === instanceId);
  const roundCap = Math.min(
    SECONDARY_CARD_CAP,
    Math.max(
      0,
      SECONDARY_ROUND_CAP -
        hand.reduce(
          (acc, card) =>
            card.instanceId === instanceId ? acc : acc + getCardRoundPoints(card, round),
          0
        )
    )
  );

  if (targetCard?.recurring) {
    const fixedRemaining = Math.max(
      0,
      SECONDARY_FIXED_MAX_VP -
        Object.entries(targetCard.roundScores ?? {}).reduce(
          (acc, [r, val]) => (Number(r) === round ? acc : acc + (val.points || 0)),
          0
        )
    );
    if (fixedRemaining < roundCap) {
      return "fixed";
    }
  }
  return "round";
}

/**
 * Calculate total primary mission score
 */
export function getTotalPrimaryScore(playerState) {
  if (!playerState?.rounds) return 0;
  const total = playerState.rounds.reduce((acc, r) => acc + (r.primaryScore || 0), 0);
  return Math.min(total, PRIMARY_MAX_VP);
}

/**
 * Calculate remaining primary points available for a round
 */
export function getAvailablePrimaryPoints(playerState, roundIndex) {
  if (!playerState?.rounds) return PRIMARY_ROUND_CAP;
  const scoredInOtherRounds = playerState.rounds.reduce(
    (sum, r, idx) => (idx === roundIndex ? sum : sum + (r.primaryScore || 0)),
    0
  );
  return Math.max(0, Math.min(PRIMARY_ROUND_CAP, PRIMARY_MAX_VP - scoredInOtherRounds));
}

/**
 * Calculate total match score (Primary + Secondary + Battle Ready, capped at 100)
 */
export function getTotalMatchScore(playerState, maxCap = MAX_MATCH_VP) {
  if (!playerState) return 0;
  const battleReady = playerState.battleReady === false ? 0 : BATTLE_READY_VP;
  const primary = getTotalPrimaryScore(playerState);
  const secondary = Math.min(getTotalSecondaryScore(playerState.hand ?? []), SECONDARY_MAX_VP);
  return Math.min(battleReady + primary + secondary, maxCap);
}

/**
 * Create fresh initial player state
 */
export function createInitialPlayerState() {
  return {
    deck: {
      available: [...SECONDARY_MISSION_SLUGS]
    },
    hand: [],
    rounds: Array.from({ length: 5 }, () => ({
      primaryScore: 0,
      selection: null
    })),
    cp: 0,
    battleReady: true,
    currentRound: 1
  };
}
