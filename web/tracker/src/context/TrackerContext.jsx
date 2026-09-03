import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  STORAGE_KEY_TRACKER_STATE,
  STORAGE_KEY_TRACKER_SETTINGS,
  MAX_DETACHMENT_POINTS,
  FIXED_SELECTION_COUNT
} from "../data/constants.js";
import {
  createInitialPlayerState,
  drawCardFromDeck,
  createSecondaryInstance,
  discardSecondaryCard,
  getAvailableSecondaryPoints,
  getAvailablePrimaryPoints
} from "../data/scoringRules.js";
import { getPrimaryMissionName, normalizeDispositionKey } from "../data/dispositions.js";
import { checkReshuffleRules } from "../data/secondaryMissions.js";
import { getDetachmentInfo } from "../data/factions.js";

const TrackerContext = createContext(null);

function createInitialGameState() {
  return {
    id: `game-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    game: {
      p1Name: "Player 1",
      p2Name: "Player 2",
      p1Faction: null,
      p2Faction: null,
      p1Detachments: [],
      p2Detachments: [],
      p1Disposition: null,
      p2Disposition: null,
      p1Primary: null,
      p2Primary: null,
      p1Role: null,
      p2Role: null,
      p1MissionType: null,
      p2MissionType: null,
      rollOffWinner: null,
      firstTurn: null,
      terrainLayout: null
    },
    p1: createInitialPlayerState(),
    p2: createInitialPlayerState(),
    round: 1,
    started: false
  };
}

function createDefaultSettings() {
  return {
    trackCP: false,
    showScoreGroups: true,
    defaultName: "",
    defaultFaction: null,
    defaultDetachments: []
  };
}

function sanitizeLoadedState(raw) {
  const initial = createInitialGameState();
  if (!raw || typeof raw !== "object") return initial;

  const state = {
    id: typeof raw.id === "string" && raw.id ? raw.id : initial.id,
    game: { ...initial.game, ...(raw.game || {}) },
    p1: { ...initial.p1, ...(raw.p1 || {}) },
    p2: { ...initial.p2, ...(raw.p2 || {}) },
    round: typeof raw.round === "number" ? raw.round : 1,
    started: raw.started === true
  };

  // Ensure primaries are populated if dispositions exist
  const d1 = state.game.p1Disposition;
  const d2 = state.game.p2Disposition;
  if (d1 && d2) {
    if (!state.game.p1Primary) state.game.p1Primary = getPrimaryMissionName(d1, d2);
    if (!state.game.p2Primary) state.game.p2Primary = getPrimaryMissionName(d2, d1);
  }

  // Ensure sides on cards
  if (Array.isArray(state.p1.hand)) {
    state.p1.hand.forEach(c => {
      if (!c.side) c.side = state.game.p1Role || "attacker";
    });
  }
  if (Array.isArray(state.p2.hand)) {
    state.p2.hand.forEach(c => {
      if (!c.side) c.side = state.game.p2Role || "defender";
    });
  }

  return state;
}

export function TrackerProvider({ children }) {
  const [state, setState] = useState(createInitialGameState);
  const [settings, setSettings] = useState(createDefaultSettings);
  const [loaded, setLoaded] = useState(false);

  const stateRef = React.useRef(state);
  stateRef.current = state;

  // Load persisted state and settings on mount
  useEffect(() => {
    try {
      const savedState = localStorage.getItem(STORAGE_KEY_TRACKER_STATE);
      if (savedState) {
        setState(sanitizeLoadedState(JSON.parse(savedState)));
      }
    } catch (e) {
      console.error("Failed to load tracker state from localStorage:", e);
    }

    try {
      const savedSettings = localStorage.getItem(STORAGE_KEY_TRACKER_SETTINGS);
      if (savedSettings) {
        setSettings(prev => ({ ...prev, ...JSON.parse(savedSettings) }));
      }
    } catch (e) {
      console.error("Failed to load tracker settings from localStorage:", e);
    }

    setLoaded(true);

    // Global state hooks for multiplayer sync and external integrations
    window.__gdmSetTrackerState = newState => {
      try {
        setState(sanitizeLoadedState(newState));
      } catch (err) {
        console.error("Failed to set tracker state:", err);
      }
    };
    window.__gdmGetTrackerState = () => stateRef.current;

    const handleSyncEvent = (e) => {
      if (e.detail && typeof e.detail === "object") {
        try {
          setState(sanitizeLoadedState(e.detail));
        } catch (err) {
          console.error("Failed to handle gdm-state-sync event:", err);
        }
      }
    };
    window.addEventListener("gdm-state-sync", handleSyncEvent);

    return () => {
      window.removeEventListener("gdm-state-sync", handleSyncEvent);
    };
  }, []);

  // Save settings on change
  useEffect(() => {
    if (loaded) {
      try {
        localStorage.setItem(STORAGE_KEY_TRACKER_SETTINGS, JSON.stringify(settings));
      } catch (e) {
        console.error("Failed to save tracker settings:", e);
      }
    }
  }, [settings, loaded]);

  // Save game state on change
  useEffect(() => {
    if (loaded) {
      try {
        localStorage.setItem(STORAGE_KEY_TRACKER_STATE, JSON.stringify(state));
      } catch (e) {
        console.error("Failed to save tracker state:", e);
      }
    }
  }, [state, loaded]);

  // Helper getters
  const getPlayerState = useCallback((s, playerNum) => (playerNum === 1 ? s.p1 : s.p2), []);
  const getPlayerRole = useCallback(
    (s, playerNum) => (playerNum === 1 ? s.game.p1Role : s.game.p2Role) || (playerNum === 1 ? "attacker" : "defender"),
    []
  );

  // Update specific player
  const updatePlayer = useCallback((playerNum, updater) => {
    setState(prev => {
      const current = playerNum === 1 ? prev.p1 : prev.p2;
      const updated = typeof updater === "function" ? updater(current) : updater;
      return {
        ...prev,
        [playerNum === 1 ? "p1" : "p2"]: { ...current, ...updated }
      };
    });
  }, []);

  // Actions
  const setPlayerName = useCallback((playerNum, name) => {
    setState(prev => ({
      ...prev,
      game: {
        ...prev.game,
        [playerNum === 1 ? "p1Name" : "p2Name"]: name
      }
    }));
  }, []);

  const selectFaction = useCallback((playerNum, faction) => {
    setState(prev => ({
      ...prev,
      game: {
        ...prev.game,
        [playerNum === 1 ? "p1Faction" : "p2Faction"]: faction,
        [playerNum === 1 ? "p1Detachments" : "p2Detachments"]: []
      }
    }));
  }, []);

  const toggleDetachment = useCallback((playerNum, detachmentName) => {
    setState(prev => {
      const game = prev.game;
      const faction = playerNum === 1 ? game.p1Faction : game.p2Faction;
      const currentList = playerNum === 1 ? game.p1Detachments : game.p2Detachments;

      if (currentList.includes(detachmentName)) {
        return {
          ...prev,
          game: {
            ...game,
            [playerNum === 1 ? "p1Detachments" : "p2Detachments"]: currentList.filter(
              d => d !== detachmentName
            )
          }
        };
      }

      // Check detachment point budget limit
      const currentPoints = currentList.reduce((sum, dName) => {
        const info = getDetachmentInfo(faction, dName);
        return sum + (info?.dp || 0);
      }, 0);
      const newInfo = getDetachmentInfo(faction, detachmentName);
      const newPoints = newInfo?.dp || 0;

      if (currentPoints + newPoints > MAX_DETACHMENT_POINTS) {
        return prev;
      }

      return {
        ...prev,
        game: {
          ...game,
          [playerNum === 1 ? "p1Detachments" : "p2Detachments"]: [...currentList, detachmentName]
        }
      };
    });
  }, []);

  const selectDisposition = useCallback((playerNum, dispositionKey) => {
    setState(prev => {
      const p1Dispo = playerNum === 1 ? dispositionKey : prev.game.p1Disposition;
      const p2Dispo = playerNum === 2 ? dispositionKey : prev.game.p2Disposition;
      const newGame = {
        ...prev.game,
        p1Disposition: p1Dispo,
        p2Disposition: p2Dispo,
        terrainLayout: null
      };

      if (p1Dispo && p2Dispo) {
        newGame.p1Primary = getPrimaryMissionName(p1Dispo, p2Dispo);
        newGame.p2Primary = getPrimaryMissionName(p2Dispo, p1Dispo);
      } else {
        newGame.p1Primary = null;
        newGame.p2Primary = null;
      }

      return { ...prev, game: newGame };
    });
  }, []);

  const selectTerrainLayout = useCallback(layoutNumber => {
    setState(prev => ({
      ...prev,
      game: { ...prev.game, terrainLayout: layoutNumber }
    }));
  }, []);

  const selectRole = useCallback((playerNum, role) => {
    setState(prev => {
      const opposite = role === "attacker" ? "defender" : "attacker";
      return {
        ...prev,
        game: {
          ...prev.game,
          p1Role: playerNum === 1 ? role : opposite,
          p2Role: playerNum === 1 ? opposite : role
        }
      };
    });
  }, []);

  const selectMissionType = useCallback((playerNum, missionType) => {
    setState(prev => ({
      ...prev,
      game: {
        ...prev.game,
        [playerNum === 1 ? "p1MissionType" : "p2MissionType"]: missionType
      }
    }));
  }, []);

  const selectRollOffWinner = useCallback(winner => {
    setState(prev => ({
      ...prev,
      game: {
        ...prev.game,
        rollOffWinner: winner,
        firstTurn: winner
      }
    }));
  }, []);

  const startGame = useCallback(() => {
    setState(prev => ({
      ...prev,
      started: true,
      round: 1,
      p1: { ...prev.p1, currentRound: 1 },
      p2: { ...prev.p2, currentRound: 1 }
    }));
  }, []);

  const setRound = useCallback(round => {
    if (round < 1 || round > 5) return;
    setState(prev => ({
      ...prev,
      round,
      p1: { ...prev.p1, currentRound: round },
      p2: { ...prev.p2, currentRound: round }
    }));
  }, []);

  const drawSecondary = useCallback((playerNum) => {
    setState(prev => {
      const player = getPlayerState(prev, playerNum);
      const role = getPlayerRole(prev, playerNum);
      // Filter out mandatory reshuffle cards in round 1
      const filterFn = prev.round === 1 ? cardId => !checkReshuffleRules(cardId).mandatoryRound1 : null;
      const { card, remaining } = drawCardFromDeck(player.deck.available, filterFn);
      if (!card) return prev;

      const instance = createSecondaryInstance(card, role, prev.round);
      const updatedPlayer = {
        ...player,
        deck: { available: remaining },
        hand: [...player.hand, instance]
      };

      return {
        ...prev,
        [playerNum === 1 ? "p1" : "p2"]: updatedPlayer
      };
    });
  }, [getPlayerState, getPlayerRole]);

  const selectManualSecondary = useCallback((playerNum, cardId) => {
    setState(prev => {
      const player = getPlayerState(prev, playerNum);
      const role = getPlayerRole(prev, playerNum);
      if (!player.deck.available.includes(cardId)) return prev;

      const remaining = player.deck.available.filter(c => c !== cardId);
      const instance = createSecondaryInstance(cardId, role, prev.round);
      const updatedPlayer = {
        ...player,
        deck: { available: remaining },
        hand: [...player.hand, instance]
      };

      return {
        ...prev,
        [playerNum === 1 ? "p1" : "p2"]: updatedPlayer
      };
    });
  }, [getPlayerState, getPlayerRole]);

  const takeFixed = useCallback((playerNum, cardId) => {
    setState(prev => {
      const player = getPlayerState(prev, playerNum);
      const role = getPlayerRole(prev, playerNum);
      const existing = player.hand.find(c => c.cardId === cardId && c.recurring && c.status === "held");

      if (existing) {
        // Toggle off
        return {
          ...prev,
          [playerNum === 1 ? "p1" : "p2"]: {
            ...player,
            hand: player.hand.filter(c => c.instanceId !== existing.instanceId)
          }
        };
      }

      // Check max fixed count
      const activeFixed = player.hand.filter(c => c.recurring && c.status === "held");
      if (activeFixed.length >= FIXED_SELECTION_COUNT) return prev;

      const newFixed = {
        ...createSecondaryInstance(cardId, role, prev.round),
        recurring: true
      };

      return {
        ...prev,
        [playerNum === 1 ? "p1" : "p2"]: {
          ...player,
          hand: [...player.hand, newFixed]
        }
      };
    });
  }, [getPlayerState, getPlayerRole]);

  const scoreSecondary = useCallback((playerNum, instanceId, points, selection) => {
    setState(prev => {
      const player = getPlayerState(prev, playerNum);
      const availableCap = getAvailableSecondaryPoints(player.hand, instanceId, prev.round);
      const boundedPoints = Math.max(0, Math.min(points, availableCap));

      const updatedHand = player.hand.map(card => {
        if (card.instanceId !== instanceId) return card;

        if (card.recurring) {
          const roundScores = { ...(card.roundScores || {}) };
          if (boundedPoints <= 0) {
            delete roundScores[prev.round];
          } else {
            roundScores[prev.round] = { points: boundedPoints, selection };
          }
          return { ...card, roundScores };
        }

        if (boundedPoints <= 0) {
          return { ...card, scoredRound: null, points: 0, scoreSelection: null };
        } else {
          return { ...card, scoredRound: prev.round, points: boundedPoints, scoreSelection: selection };
        }
      });

      return {
        ...prev,
        [playerNum === 1 ? "p1" : "p2"]: { ...player, hand: updatedHand }
      };
    });
  }, [getPlayerState]);

  const discardSecondary = useCallback((playerNum, instanceId) => {
    setState(prev => {
      const player = getPlayerState(prev, playerNum);
      return {
        ...prev,
        [playerNum === 1 ? "p1" : "p2"]: {
          ...player,
          hand: discardSecondaryCard(player.hand, instanceId, prev.round)
        }
      };
    });
  }, [getPlayerState]);

  const restoreSecondary = useCallback((playerNum, instanceId) => {
    setState(prev => {
      const player = getPlayerState(prev, playerNum);
      const updatedHand = player.hand.map(c =>
        c.instanceId === instanceId ? { ...c, status: "held", discardedRound: null } : c
      );
      return {
        ...prev,
        [playerNum === 1 ? "p1" : "p2"]: { ...player, hand: updatedHand }
      };
    });
  }, [getPlayerState]);

  const returnToDeck = useCallback((playerNum, instanceId) => {
    setState(prev => {
      const player = getPlayerState(prev, playerNum);
      const card = player.hand.find(c => c.instanceId === instanceId);
      if (!card || card.recurring) return prev;

      return {
        ...prev,
        [playerNum === 1 ? "p1" : "p2"]: {
          ...player,
          deck: { available: [...player.deck.available, card.cardId] },
          hand: player.hand.filter(c => c.instanceId !== instanceId)
        }
      };
    });
  }, [getPlayerState]);

  const scorePrimary = useCallback((playerNum, roundIndex, points, selection) => {
    setState(prev => {
      const player = getPlayerState(prev, playerNum);
      const availableCap = getAvailablePrimaryPoints(player, roundIndex);
      const boundedPoints = Math.max(0, Math.min(points, availableCap));

      const updatedRounds = [...player.rounds];
      updatedRounds[roundIndex] = {
        ...updatedRounds[roundIndex],
        primaryScore: boundedPoints,
        selection
      };

      return {
        ...prev,
        [playerNum === 1 ? "p1" : "p2"]: { ...player, rounds: updatedRounds }
      };
    });
  }, [getPlayerState]);

  const setCP = useCallback((playerNum, cp) => {
    updatePlayer(playerNum, prev => ({ cp: Math.max(0, cp) }));
  }, [updatePlayer]);

  const setBattleReady = useCallback((playerNum, ready) => {
    updatePlayer(playerNum, () => ({ battleReady: ready }));
  }, [updatePlayer]);

  const updateSettings = useCallback(newSettings => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  }, []);

  const resetGame = useCallback(() => {
    setState(createInitialGameState());
  }, []);

  const game = state.game;
  const setupComplete =
    !!game.p1Disposition &&
    !!game.p2Disposition &&
    (!!game.p1Role || !!game.p2Role) &&
    !!game.p1MissionType &&
    !!game.p2MissionType &&
    !!game.rollOffWinner &&
    !!game.firstTurn;

  const value = {
    state,
    settings,
    loaded,
    setupComplete,
    setPlayerName,
    selectFaction,
    toggleDetachment,
    selectDisposition,
    selectTerrainLayout,
    selectRole,
    selectMissionType,
    selectRollOffWinner,
    startGame,
    setRound,
    drawSecondary,
    selectManualSecondary,
    takeFixed,
    scoreSecondary,
    discardSecondary,
    restoreSecondary,
    returnToDeck,
    scorePrimary,
    setCP,
    setBattleReady,
    updateSettings,
    resetGame
  };

  return <TrackerContext.Provider value={value}>{children}</TrackerContext.Provider>;
}

export function useTracker() {
  const context = useContext(TrackerContext);
  if (!context) {
    throw new Error("useTracker must be used within a TrackerProvider");
  }
  return context;
}
