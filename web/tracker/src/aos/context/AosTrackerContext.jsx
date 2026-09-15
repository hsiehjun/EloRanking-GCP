import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import {
  MAX_MATCH_VP,
  PRIMARY_MAX_VP,
  BATTLE_TACTIC_VP,
  ROUNDS_COUNT,
  STORAGE_KEY_AOS_TRACKER_STATE,
  STORAGE_KEY_AOS_TRACKER_SETTINGS
} from "../data/aosConstants.js";
import {
  createInitialAosPlayerState,
  getTotalPrimaryScore,
  getTotalTacticsScore,
  getTotalAosMatchScore,
  getCompletedTacticsCount,
  resolvePriorityRoll,
  determineUnderdogs
} from "../data/aosScoringRules.js";
import { AOS_BATTLEPLANS, getBattleplanById } from "../data/aosBattleplans.js";

const AosTrackerContext = createContext(null);

function createInitialAosGameState() {
  const defaultBp = AOS_BATTLEPLANS[0];
  return {
    id: `aos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    gameSystem: "aos",
    edition: "4e-ghb24",
    battleplan: defaultBp,
    round: 1,
    currentTurnPlayer: "p1",
    started: false,
    is_finished: false,
    winner: null,
    roundState: {
      1: {
        priorityWinner: "p1",
        chosenFirst: "p1",
        firstTurn: "p1",
        secondTurn: "p2",
        isDoubleTurn: false,
        forfeitsBattleTactic: false
      }
    },
    p1: createInitialAosPlayerState("Player 1", "Order"),
    p2: createInitialAosPlayerState("Player 2", "Chaos")
  };
}

export function AosTrackerProvider({ children }) {
  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_AOS_TRACKER_STATE);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.gameSystem === "aos") {
          return parsed;
        }
      }
    } catch (e) {
      console.warn("Failed to read AoS tracker state from localStorage:", e);
    }
    return createInitialAosGameState();
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  // Persist state mutations to localStorage and notify sync layer
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_AOS_TRACKER_STATE, JSON.stringify(state));
      window.dispatchEvent(new CustomEvent('aos_state_change', { detail: state }));
    } catch (e) {
      console.error("Failed to save AoS tracker state to localStorage:", e);
    }
  }, [state]);

  // Listen to remote multiplayer sync events
  useEffect(() => {
    function handleRemoteSync(e) {
      try {
        const incoming = e.detail || JSON.parse(localStorage.getItem(STORAGE_KEY_AOS_TRACKER_STATE));
        if (incoming && incoming.gameSystem === "aos") {
          setState(incoming);
        }
      } catch (err) {}
    }
    window.addEventListener("aos_remote_sync", handleRemoteSync);
    window.addEventListener("storage", (ev) => {
      if (ev.key === STORAGE_KEY_AOS_TRACKER_STATE) handleRemoteSync(ev);
    });
    return () => {
      window.removeEventListener("aos_remote_sync", handleRemoteSync);
    };
  }, []);

  // Update Game and Player Setup
  const updateGameSetup = useCallback((updates) => {
    setState((prev) => {
      const next = { ...prev };
      if (updates.battleplanId) {
        next.battleplan = getBattleplanById(updates.battleplanId);
      }
      if (updates.p1) {
        next.p1 = { ...next.p1, ...updates.p1 };
      }
      if (updates.p2) {
        next.p2 = { ...next.p2, ...updates.p2 };
      }
      return next;
    });
  }, []);

  // Start Battle
  const startGame = useCallback(() => {
    setState((prev) => ({
      ...prev,
      started: true,
      round: 1,
      currentTurnPlayer: prev.roundState[1]?.firstTurn || "p1"
    }));
  }, []);

  // Record Priority Roll at start of a round
  const recordPriorityRoll = useCallback(({ round, priorityWinner, chosenFirst }) => {
    setState((prev) => {
      const previousRoundSecondPlayer = prev.roundState[round - 1]?.secondTurn || "p2";
      const resolution = resolvePriorityRoll({
        round,
        priorityWinner,
        chosenFirst,
        previousRoundSecondPlayer
      });

      const nextRoundState = { ...prev.roundState, [round]: resolution };

      // CP Grant: +1 CP to each player, +1 bonus CP to the player going SECOND
      const nextP1 = { ...prev.p1 };
      const nextP2 = { ...prev.p2 };
      nextP1.cp = (nextP1.cp || 0) + 1 + (resolution.secondTurn === "p1" ? 1 : 0);
      nextP2.cp = (nextP2.cp || 0) + 1 + (resolution.secondTurn === "p2" ? 1 : 0);

      // Handle tactic forfeiture on double turn
      if (resolution.forfeitsBattleTactic) {
        const doubleTurnPlayerKey = resolution.firstTurn; // "p1" or "p2"
        const targetPlayer = doubleTurnPlayerKey === "p1" ? nextP1 : nextP2;
        targetPlayer.rounds = targetPlayer.rounds.map((r) =>
          r.round === round
            ? { ...r, tacticId: "forfeited_double_turn", tacticStatus: "forfeited_double_turn", tacticScore: 0 }
            : r
        );
      }

      return {
        ...prev,
        round,
        currentTurnPlayer: resolution.firstTurn,
        roundState: nextRoundState,
        p1: nextP1,
        p2: nextP2
      };
    });
  }, []);

  // Select Battle Tactic (Tactical Gambit)
  const selectBattleTactic = useCallback((playerKey, round, tacticId) => {
    setState((prev) => {
      const player = { ...prev[playerKey] };
      player.rounds = player.rounds.map((r) =>
        r.round === round
          ? { ...r, tacticId, tacticStatus: "selected", tacticScore: 0 }
          : r
      );
      return { ...prev, [playerKey]: player };
    });
  }, []);

  // Resolve Battle Tactic (Achieved = 4 VP, Failed = 0 VP)
  const resolveBattleTactic = useCallback((playerKey, round, status) => {
    setState((prev) => {
      const player = { ...prev[playerKey] };
      const score = status === "achieved" ? BATTLE_TACTIC_VP : 0;
      player.rounds = player.rounds.map((r) =>
        r.round === round
          ? { ...r, tacticStatus: status, tacticScore: score }
          : r
      );
      return { ...prev, [playerKey]: player };
    });
  }, []);

  // Set Primary Score for a Round
  const setPrimaryScore = useCallback((playerKey, round, score, selections = {}) => {
    setState((prev) => {
      const player = { ...prev[playerKey] };
      const clampedScore = Math.max(0, Math.min(6, score));
      player.rounds = player.rounds.map((r) =>
        r.round === round
          ? { ...r, primaryScore: clampedScore, primarySelections: selections }
          : r
      );
      return { ...prev, [playerKey]: player };
    });
  }, []);

  // Adjust Command Points (CP)
  const adjustCP = useCallback((playerKey, delta) => {
    setState((prev) => {
      const player = { ...prev[playerKey] };
      player.cp = Math.max(0, (player.cp || 0) + delta);
      return { ...prev, [playerKey]: player };
    });
  }, []);

  // Advance Turn or Round
  const advanceTurn = useCallback(() => {
    setState((prev) => {
      const currentR = prev.round;
      const rInfo = prev.roundState[currentR] || {};
      const firstTurnPlayer = rInfo.firstTurn || "p1";
      const secondTurnPlayer = rInfo.secondTurn || "p2";

      // If in First Turn, move to Second Turn
      if (prev.currentTurnPlayer === firstTurnPlayer) {
        return {
          ...prev,
          currentTurnPlayer: secondTurnPlayer
        };
      }

      // If in Second Turn, check if match is finished (after Round 5)
      if (currentR >= ROUNDS_COUNT) {
        const s1 = getTotalAosMatchScore(prev.p1);
        const s2 = getTotalAosMatchScore(prev.p2);
        let winner = "Tie / Draw";
        if (s1 > s2) winner = prev.p1.name;
        else if (s2 > s1) winner = prev.p2.name;

        return {
          ...prev,
          is_finished: true,
          winner
        };
      }

      // Otherwise advance to next round
      const nextR = currentR + 1;
      return {
        ...prev,
        round: nextR,
        currentTurnPlayer: null // Will be resolved by Priority Roll
      };
    });
  }, []);

  // Reset Game
  const resetGame = useCallback(() => {
    const fresh = createInitialAosGameState();
    setState(fresh);
    try {
      localStorage.removeItem(STORAGE_KEY_AOS_TRACKER_STATE);
    } catch (e) {}
  }, []);

  // Underdog calculation
  const underdogs = determineUnderdogs(state.p1, state.p2);

  return (
    <AosTrackerContext.Provider
      value={{
        state,
        underdogs,
        updateGameSetup,
        startGame,
        recordPriorityRoll,
        selectBattleTactic,
        resolveBattleTactic,
        setPrimaryScore,
        adjustCP,
        advanceTurn,
        resetGame
      }}
    >
      {children}
    </AosTrackerContext.Provider>
  );
}

export function useAosTracker() {
  const ctx = useContext(AosTrackerContext);
  if (!ctx) {
    throw new Error("useAosTracker must be used within an AosTrackerProvider");
  }
  return ctx;
}
