import React, { useState } from "react";
import { useTracker } from "../../context/TrackerContext.jsx";
import {
  PLAYER_COLORS,
  PRIMARY_ROUND_CAP,
  SECONDARY_ROUND_CAP,
  FIXED_SELECTION_COUNT
} from "../../data/constants.js";
import {
  DISPOSITION_COLORS,
  FORCE_DISPOSITIONS,
  toDeckSlug
} from "../../data/dispositions.js";
import {
  getSecondaryCardName,
  FIXED_SECONDARY_OPTIONS
} from "../../data/secondaryMissions.js";
import {
  getTotalMatchScore,
  getRoundSecondaryTotal,
  getCardRoundPoints,
  getCardRoundScore,
  getAvailableSecondaryPoints,
  getCapReason,
  getAvailablePrimaryPoints
} from "../../data/scoringRules.js";
import { PrimaryScoreModal } from "./PrimaryScoreModal.jsx";
import { SecondaryScoreModal } from "./SecondaryScoreModal.jsx";
import { SecondaryCardModal } from "./SecondaryCardModal.jsx";
import { ManualSecondaryPickerModal } from "./ManualSecondaryPickerModal.jsx";
import { PlusIcon, MinusIcon } from "../common/Icons.jsx";

export function PlayerScorecard({ player }) {
  const {
    state,
    settings,
    drawSecondary,
    selectManualSecondary,
    takeFixed,
    scoreSecondary,
    discardSecondary,
    restoreSecondary,
    returnToDeck,
    scorePrimary,
    setCP
  } = useTracker();

  const game = state.game;
  const currentRound = state.round;
  const isP1 = player === 1;
  const playerState = isP1 ? state.p1 : state.p2;

  const playerName = (isP1 ? game.p1Name : game.p2Name) || `Player ${player}`;
  const factionDisposition = isP1 ? game.p1Disposition : game.p2Disposition;
  const primaryMissionName = isP1 ? game.p1Primary : game.p2Primary;
  const missionType = (isP1 ? game.p1MissionType : game.p2MissionType) || "tactical";
  const playerColor = PLAYER_COLORS[player];

  const dispositionObj = FORCE_DISPOSITIONS.find(d => d.key === factionDisposition);
  const accentColor = dispositionObj?.color || playerColor;

  // Modals state
  const [scoringPrimary, setScoringPrimary] = useState(false);
  const [activeSecondaryCard, setActiveSecondaryCard] = useState(null);
  const [selectingManualSecondary, setSelectingManualSecondary] = useState(false);

  // Scores
  const totalVP = getTotalMatchScore(playerState);
  const primaryRoundScore = playerState.rounds[currentRound - 1]?.primaryScore || 0;
  const secondaryRoundScore = getRoundSecondaryTotal(playerState.hand, currentRound);
  const commandPoints = playerState.cp || 0;

  // Active secondaries list for current round
  const activeSecondaries = playerState.hand.filter(card => {
    if (card.recurring) return card.status !== "discarded";
    if (card.scoredRound != null) return card.scoredRound === currentRound;
    return card.status !== "discarded" || card.discardedRound === currentRound;
  });

  const fixedChosenCount = playerState.hand.filter(
    c => c.recurring && c.status === "held"
  ).length;

  return (
    <div className="gtk-card overflow-hidden rounded-[14px] border" style={{ borderColor: "var(--gtk-line)" }}>
      {/* Player Header Banner */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 border-b"
        style={{ borderColor: "var(--gtk-line)" }}
      >
        <div className="min-w-0">
          <p
            className="gtk-mono truncate text-[12px] font-bold uppercase tracking-[0.14em]"
            style={{ color: playerColor }}
          >
            {playerName}
          </p>
          {dispositionObj && (
            <span
              className="gtk-chip mt-1 inline-block rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase text-white"
              style={{ background: accentColor }}
            >
              {dispositionObj.name}
            </span>
          )}
        </div>

        <div className="text-right">
          <p className="gtk-num text-[34px] font-bold leading-none" style={{ color: "var(--gtk-text)" }}>
            {totalVP}
          </p>
          <p className="gtk-mono text-[9.5px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--gtk-muted)" }}>
            Total VP
          </p>
        </div>
      </div>

      {/* Optional Command Points Bar */}
      {settings.trackCP && (
        <div
          className="flex items-center justify-between px-4 py-2.5 border-b"
          style={{ borderColor: "var(--gtk-line)" }}
        >
          <span className="gtk-mono text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--gtk-muted)" }}>
            Command Points
          </span>
          <div
            className="inline-flex items-stretch overflow-hidden rounded-[8px] border-2"
            style={{ borderColor: "var(--gtk-line)" }}
          >
            <button
              type="button"
              disabled={commandPoints <= 0}
              onClick={() => setCP(player, commandPoints - 1)}
              className="flex w-9 items-center justify-center transition-colors disabled:opacity-30"
              style={{ borderRight: "1px solid var(--gtk-line)" }}
            >
              <MinusIcon className="h-4 w-4" />
            </button>
            <span
              className="gtk-num flex min-w-[2.5rem] items-center justify-center text-[18px] font-bold"
              style={{ color: "var(--gtk-text)" }}
            >
              {commandPoints}
            </span>
            <button
              type="button"
              onClick={() => setCP(player, commandPoints + 1)}
              className="flex w-9 items-center justify-center text-white transition-[filter]"
              style={{ background: playerColor, borderLeft: "1px solid var(--gtk-line)" }}
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Primary Mission Row */}
      <div className="px-4 py-3.5 border-b" style={{ borderColor: "var(--gtk-line)" }}>
        <div className="mb-2 flex items-center justify-between">
          <span className="gtk-mono text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--gtk-muted)" }}>
            Primary Mission
          </span>
          <span className="gtk-num text-[13px] font-bold" style={{ color: "var(--gtk-muted)" }}>
            {primaryRoundScore} / {PRIMARY_ROUND_CAP}
          </span>
        </div>

        <button
          type="button"
          disabled={!primaryMissionName}
          onClick={() => setScoringPrimary(true)}
          className="flex w-full items-center justify-between gap-3 rounded-[10px] border-2 px-3 py-2 text-left transition-colors disabled:opacity-40"
          style={{
            borderColor: primaryRoundScore > 0 ? "#1e9d52" : accentColor,
            background: primaryRoundScore > 0 ? "#1e9d5214" : "var(--gtk-tile)"
          }}
        >
          <span className="gtk-display min-w-0 flex-1 truncate text-[18px] font-bold uppercase leading-tight">
            {primaryMissionName || "No Primary Assigned"}
          </span>
          <span
            className="gtk-mono flex-none rounded-[7px] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-white"
            style={{ background: primaryRoundScore > 0 ? "#1e9d52" : accentColor }}
          >
            {primaryRoundScore > 0 ? `+${primaryRoundScore} VP · R${currentRound}` : `Score R${currentRound}`}
          </span>
        </button>
      </div>

      {/* Secondaries Section */}
      <div className="px-4 py-3.5">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="gtk-mono text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--gtk-muted)" }}>
            Secondaries · {missionType}
          </span>
          <span className="gtk-num text-[13px] font-bold" style={{ color: "var(--gtk-muted)" }}>
            {secondaryRoundScore} / {SECONDARY_ROUND_CAP}
          </span>
        </div>

        {/* List of active cards */}
        <div className="flex flex-col gap-2">
          {activeSecondaries.length === 0 && (
            <p className="gtk-mono py-2 text-center text-[11px]" style={{ color: "var(--gtk-muted)" }}>
              No active secondaries
            </p>
          )}

          {activeSecondaries.map(card => {
            const isDiscarded = card.status === "discarded";
            const roundScore = getCardRoundScore(card, currentRound);
            const isScored = roundScore != null || card.scoredRound != null;
            const points = getCardRoundPoints(card, currentRound) || card.points || 0;

            let badgeText = `Held · R${card.drawnRound}`;
            let badgeTone = "held";

            if (isDiscarded) {
              badgeText = `Discarded R${card.discardedRound}`;
              badgeTone = "discarded";
            } else if (card.recurring) {
              if (roundScore != null) {
                badgeText = `+${points} VP · R${currentRound}`;
                badgeTone = "scored";
              } else {
                badgeText = `Fixed · R${currentRound}`;
              }
            } else if (card.scoredRound != null) {
              badgeText = `+${card.points} VP · R${card.scoredRound}`;
              badgeTone = "scored";
            }

            const borderCol =
              badgeTone === "scored" ? "#1e9d52" : isDiscarded ? "var(--gtk-line)" : playerColor;
            const textCol =
              badgeTone === "scored" ? "#1e9d52" : isDiscarded ? "var(--gtk-muted)" : playerColor;

            return (
              <button
                key={card.instanceId}
                type="button"
                onClick={() => setActiveSecondaryCard(card)}
                className="flex items-center justify-between gap-2 rounded-[10px] border-2 px-3 py-2.5 text-left transition-colors"
                style={{
                  borderColor: borderCol,
                  opacity: isDiscarded ? 0.55 : 1,
                  background: "var(--gtk-tile)"
                }}
              >
                <span className="gtk-display min-w-0 flex-1 truncate text-[16px] font-bold uppercase leading-none">
                  {getSecondaryCardName(card.cardId)}
                </span>
                <span
                  className="gtk-mono text-[10px] font-bold uppercase tracking-[0.08em]"
                  style={{ color: textCol }}
                >
                  {badgeText}
                </span>
              </button>
            );
          })}
        </div>

        {/* Bottom draw / fixed selection buttons */}
        <div className="mt-3">
          {missionType === "fixed" ? (
            <div className="flex flex-col gap-2">
              <span className="gtk-mono text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--gtk-muted)" }}>
                Fixed · Select {fixedChosenCount}/{FIXED_SELECTION_COUNT}
              </span>
              <div className="grid grid-cols-2 gap-2">
                {FIXED_SECONDARY_OPTIONS.map(slug => {
                  const isChosen = playerState.hand.some(
                    c => c.cardId === slug && c.recurring && c.status === "held"
                  );
                  const isMaxReached = fixedChosenCount >= FIXED_SELECTION_COUNT && !isChosen;

                  return (
                    <button
                      key={slug}
                      type="button"
                      disabled={isMaxReached}
                      onClick={() => takeFixed(player, slug)}
                      className="flex h-10 items-center justify-center rounded-[9px] border font-mono text-[11px] font-bold uppercase tracking-[0.06em] transition-colors disabled:opacity-35"
                      style={
                        isChosen
                          ? {
                              borderColor: "#1e9d52",
                              background: "#1e9d5226",
                              color: "var(--gtk-text)"
                            }
                          : {
                              borderColor: "var(--gtk-line)",
                              color: "var(--gtk-text)"
                            }
                      }
                    >
                      {getSecondaryCardName(slug)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : missionType === "manual" ? (
            <button
              type="button"
              disabled={playerState.deck.available.length === 0}
              onClick={() => setSelectingManualSecondary(true)}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-white transition-[filter] disabled:opacity-40"
              style={{ background: playerColor }}
            >
              <PlusIcon className="h-4 w-4" />
              Select Secondary ({playerState.deck.available.length})
            </button>
          ) : (
            <button
              type="button"
              disabled={playerState.deck.available.length === 0}
              onClick={() => drawSecondary(player)}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-white transition-[filter] disabled:opacity-40"
              style={{ background: playerColor }}
            >
              <PlusIcon className="h-4 w-4" />
              Draw Secondary ({playerState.deck.available.length})
            </button>
          )}
        </div>
      </div>

      {/* Primary Scoring Modal */}
      {scoringPrimary && primaryMissionName && (
        <PrimaryScoreModal
          missionName={primaryMissionName}
          deckSlug={toDeckSlug(factionDisposition)}
          accentColor={accentColor}
          round={currentRound}
          currentTotal={primaryRoundScore}
          cap={getAvailablePrimaryPoints(playerState, currentRound - 1)}
          initialSelection={playerState.rounds[currentRound - 1]?.selection}
          onConfirm={(points, selection) => {
            scorePrimary(player, currentRound - 1, points, selection);
            setScoringPrimary(false);
          }}
          onClose={() => setScoringPrimary(false)}
        />
      )}

      {/* Secondary Scoring Modal (for held or scored cards) */}
      {activeSecondaryCard && activeSecondaryCard.status !== "discarded" && (
        <SecondaryScoreModal
          card={activeSecondaryCard}
          mode={missionType === "fixed" ? "fixed" : "tactical"}
          round={currentRound}
          cap={getAvailableSecondaryPoints(playerState.hand, activeSecondaryCard.instanceId, currentRound)}
          capReason={getCapReason(playerState.hand, activeSecondaryCard.instanceId, currentRound)}
          onScore={(instId, pts, sel) => {
            scoreSecondary(player, instId, pts, sel);
            setActiveSecondaryCard(null);
          }}
          onDiscard={
            activeSecondaryCard.recurring
              ? null
              : instId => {
                  discardSecondary(player, instId);
                  setActiveSecondaryCard(null);
                }
          }
          onReturnToDeck={
            activeSecondaryCard.recurring || activeSecondaryCard.scoredRound != null
              ? null
              : instId => {
                  returnToDeck(player, instId);
                  setActiveSecondaryCard(null);
                }
          }
          onClose={() => setActiveSecondaryCard(null)}
        />
      )}

      {/* Secondary Card Modal (for discarded cards with restore action) */}
      {activeSecondaryCard && activeSecondaryCard.status === "discarded" && (
        <SecondaryCardModal
          card={activeSecondaryCard}
          mode={missionType === "fixed" ? "fixed" : "tactical"}
          onRestore={instId => {
            restoreSecondary(player, instId);
            setActiveSecondaryCard(null);
          }}
          onClose={() => setActiveSecondaryCard(null)}
        />
      )}

      {/* Manual Secondary Selection Modal */}
      {selectingManualSecondary && (
        <ManualSecondaryPickerModal
          player={player}
          available={playerState.deck.available}
          round={currentRound}
          onSelect={cardId => selectManualSecondary(player, cardId)}
          onClose={() => setSelectingManualSecondary(false)}
        />
      )}
    </div>
  );
}
