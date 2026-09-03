import React, { useState } from "react";
import { useTracker } from "../../context/TrackerContext.jsx";
import { PLAYER_COLORS, PRIMARY_MAX_VP, SECONDARY_MAX_VP } from "../../data/constants.js";
import { getTotalMatchScore, getTotalPrimaryScore, getTotalSecondaryScore } from "../../data/scoringRules.js";
import { getMatchupTerrain, getShowMeasurements, setShowMeasurements } from "../../data/terrainLayouts.js";
import { PlayerScorecard } from "./PlayerScorecard.jsx";
import { EndGameSummary } from "./EndGameSummary.jsx";
import { GameSettingsModal } from "./GameSettingsModal.jsx";
import { CardImageModal } from "../common/CardImageModal.jsx";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MapIcon,
  SettingsIcon
} from "../common/Icons.jsx";

function ScoreProgressBar({ label, value, max, color, mirror }) {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;

  return (
    <div className={`flex items-center gap-2 ${mirror ? "flex-row-reverse" : ""}`}>
      <span className="gtk-mono flex-none text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: "var(--gtk-muted)" }}>
        {label}
      </span>
      <div
        className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
        style={{
          background: "var(--gtk-line)",
          justifyContent: mirror ? "flex-end" : "flex-start"
        }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${percent}%`, background: color }}
        />
      </div>
      <span className="gtk-num flex-none text-[10px] font-bold" style={{ color: "var(--gtk-muted)" }}>
        {value}/{max}
      </span>
    </div>
  );
}

export function BattleScorecard() {
  const { state, settings, setRound } = useTracker();
  const game = state.game;
  const currentRound = state.round;

  const firstTurnPlayer = game.firstTurn === "player2" ? 2 : 1;
  const playerOrder = firstTurnPlayer === 1 ? [1, 2] : [2, 1];

  const [activeMobilePlayer, setActiveMobilePlayer] = useState(firstTurnPlayer);
  const [showingSettings, setShowingSettings] = useState(false);
  const [showingLayout, setShowingLayout] = useState(false);
  const [showingSummary, setShowingSummary] = useState(false);
  const [measurements, setMeasurements] = useState(getShowMeasurements);

  const p1Total = getTotalMatchScore(state.p1);
  const p2Total = getTotalMatchScore(state.p2);
  const leader = p1Total === p2Total ? 0 : p1Total > p2Total ? 1 : 2;

  const matchup = game.p1Disposition && game.p2Disposition
    ? getMatchupTerrain(game.p1Disposition, game.p2Disposition)
    : null;
  const currentTerrainLayout = matchup?.layouts.find(l => l.number === game.terrainLayout);

  const toggleMeasurements = () => {
    const next = !measurements;
    setMeasurements(next);
    setShowMeasurements(next);
  };

  const getPlayerName = num => (num === 1 ? game.p1Name : game.p2Name) || `Player ${num}`;

  return (
    <div className="gtk gtk-page max-w-3xl mx-auto px-3 pb-12 pt-2">
      {/* Match Header Scoreboard */}
      <div className="gtk-card mb-3 flex items-stretch overflow-hidden rounded-[14px] border" style={{ borderColor: "var(--gtk-line)" }}>
        {playerOrder.map((playerNum, idx) => {
          const isLeader = leader === playerNum;
          const pState = playerNum === 1 ? state.p1 : state.p2;
          const primaryVP = getTotalPrimaryScore(pState);
          const secondaryVP = Math.min(getTotalSecondaryScore(pState.hand), SECONDARY_MAX_VP);
          const pColor = PLAYER_COLORS[playerNum];
          const isRight = idx > 0;
          const currentTotal = playerNum === 1 ? p1Total : p2Total;

          return (
            <div
              key={playerNum}
              className={`flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-3.5 py-3 ${
                !settings.trackCP && !settings.showScoreGroups ? "items-center" : ""
              }`}
              style={{
                borderLeft: idx > 0 ? "1px solid var(--gtk-line)" : undefined,
                background: isLeader ? `${pColor}14` : undefined
              }}
            >
              <div className={`flex w-full items-center gap-2 ${isRight ? "flex-row-reverse" : ""}`}>
                <span
                  className="gtk-mono min-w-0 flex-1 truncate text-[12px] font-bold uppercase tracking-[0.12em]"
                  style={{
                    color: pColor,
                    textAlign: isRight ? "right" : "left"
                  }}
                >
                  {getPlayerName(playerNum)}
                </span>
                {settings.trackCP && (
                  <span
                    className="gtk-chip flex-none rounded-full px-2 py-0.5 text-[9px] font-bold"
                    style={{ background: "var(--gtk-line)", color: "var(--gtk-text)" }}
                  >
                    CP {pState.cp || 0}
                  </span>
                )}
              </div>

              {settings.showScoreGroups ? (
                <div className={`flex items-center gap-3 ${isRight ? "flex-row-reverse" : ""}`}>
                  <span className="gtk-num flex-none text-[38px] font-bold leading-none" style={{ color: "var(--gtk-text)" }}>
                    {currentTotal}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <ScoreProgressBar
                      label="Pri"
                      value={primaryVP}
                      max={PRIMARY_MAX_VP}
                      color={pColor}
                      mirror={isRight}
                    />
                    <ScoreProgressBar
                      label="Sec"
                      value={secondaryVP}
                      max={SECONDARY_MAX_VP}
                      color={pColor}
                      mirror={isRight}
                    />
                  </div>
                </div>
              ) : (
                <span
                  className="gtk-num text-[38px] font-bold leading-none"
                  style={{ color: "var(--gtk-text)", textAlign: isRight ? "right" : "left" }}
                >
                  {currentTotal}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Round Stepper and Control Buttons */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="gtk-card flex flex-1 items-center justify-between px-2 py-1.5 rounded-[12px] border" style={{ borderColor: "var(--gtk-line)" }}>
          <button
            type="button"
            aria-label={showingSummary ? "Back to round 5" : "Previous round"}
            disabled={!showingSummary && currentRound <= 1}
            onClick={() => (showingSummary ? setShowingSummary(false) : setRound(currentRound - 1))}
            className="flex h-10 w-10 items-center justify-center rounded-[9px] disabled:opacity-30"
          >
            <ChevronLeftIcon className="h-6 w-6" />
          </button>

          <div className="text-center">
            {showingSummary ? (
              <span className="gtk-display text-[22px] font-bold uppercase leading-none">
                Summary
              </span>
            ) : (
              <>
                <span className="gtk-mono block text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--gtk-muted)" }}>
                  Battle Round
                </span>
                <span className="gtk-num text-[26px] font-bold leading-none">
                  {currentRound}{" "}
                  <span className="text-[14px]" style={{ color: "var(--gtk-muted)" }}>
                    of 5
                  </span>
                </span>
              </>
            )}
          </div>

          <button
            type="button"
            aria-label={currentRound >= 5 && !showingSummary ? "View summary" : "Next round"}
            disabled={showingSummary}
            onClick={() => {
              if (currentRound >= 5) {
                setShowingSummary(true);
              } else {
                setRound(currentRound + 1);
              }
            }}
            className="flex h-10 w-10 items-center justify-center rounded-[9px] disabled:opacity-30"
          >
            <ChevronRightIcon className="h-6 w-6" />
          </button>
        </div>

        {currentTerrainLayout && (
          <button
            type="button"
            aria-label={`View terrain layout (${matchup.name} · ${currentTerrainLayout.number})`}
            onClick={() => setShowingLayout(true)}
            className="gtk-card flex h-[54px] w-[52px] flex-none items-center justify-center rounded-[12px] border transition-colors hover:brightness-105"
            style={{ borderColor: "var(--gtk-line)" }}
          >
            <MapIcon className="h-5 w-5" />
          </button>
        )}

        <button
          type="button"
          aria-label="Game settings"
          onClick={() => setShowingSettings(true)}
          className="gtk-card flex h-[54px] w-[52px] flex-none items-center justify-center rounded-[12px] border transition-colors hover:brightness-105"
          style={{ borderColor: "var(--gtk-line)" }}
        >
          <SettingsIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Main Body */}
      {showingSummary ? (
        <div className="space-y-4">
          <EndGameSummary />
          <button
            type="button"
            onClick={() => setShowingSummary(false)}
            className="flex h-12 w-full items-center justify-center rounded-[11px] font-mono text-[13px] font-bold uppercase tracking-[0.1em] transition-colors"
            style={{ background: "var(--gtk-accent)", color: "#15171b" }}
          >
            Back to Match
          </button>
        </div>
      ) : (
        <>
          {/* Mobile Player Tabs */}
          <div className="mb-3 flex gap-2 md:hidden">
            {playerOrder.map(num => (
              <button
                key={num}
                type="button"
                aria-pressed={activeMobilePlayer === num}
                onClick={() => setActiveMobilePlayer(num)}
                className="flex-1 truncate rounded-[10px] border-2 py-2.5 px-3 font-mono text-[12px] font-bold uppercase tracking-[0.08em] transition-colors"
                style={
                  activeMobilePlayer === num
                    ? {
                        background: PLAYER_COLORS[num],
                        borderColor: PLAYER_COLORS[num],
                        color: "#fff"
                      }
                    : {
                        borderColor: "var(--gtk-line)",
                        background: "var(--gtk-tile)",
                        color: "var(--gtk-muted)"
                      }
                }
              >
                {getPlayerName(num)}
              </button>
            ))}
          </div>

          {/* Mobile Single Column View */}
          <div className="md:hidden">
            <PlayerScorecard player={activeMobilePlayer} />
          </div>

          {/* Desktop 2-Column Grid View */}
          <div className="hidden gap-3 md:grid md:grid-cols-2">
            <PlayerScorecard player={playerOrder[0]} />
            <PlayerScorecard player={playerOrder[1]} />
          </div>
        </>
      )}

      {/* Settings Modal */}
      {showingSettings && (
        <GameSettingsModal onClose={() => setShowingSettings(false)} />
      )}

      {/* Terrain Layout Modal */}
      {showingLayout && currentTerrainLayout && (
        <CardImageModal
          front={currentTerrainLayout.image}
          back={currentTerrainLayout.measurementsImage}
          title={`${matchup.name} · Layout ${currentTerrainLayout.number}`}
          showMeasurementsToggle
          measurementsEnabled={measurements}
          onToggleMeasurements={toggleMeasurements}
          onClose={() => setShowingLayout(false)}
        />
      )}
    </div>
  );
}
