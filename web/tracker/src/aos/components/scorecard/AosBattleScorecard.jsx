import React, { useState } from "react";
import { useAosTracker } from "../../context/AosTrackerContext.jsx";
import {
  getTotalPrimaryScore,
  getTotalTacticsScore,
  getTotalAosMatchScore,
  getCompletedTacticsCount
} from "../../data/aosScoringRules.js";
import { AosPlayerScorecard } from "./AosPlayerScorecard.jsx";
import { PriorityRollModal } from "./PriorityRollModal.jsx";
import { AosEndGameSummary } from "./AosEndGameSummary.jsx";
import { DiceIcon, TrophyIcon } from "../common/Icons.jsx";

export function AosBattleScorecard() {
  const { state, advanceTurn, resetGame, setRound } = useAosTracker();
  const { p1, p2, round, currentTurnPlayer, roundState, battleplan, is_finished } = state;

  const [activeTabRound, setActiveTabRound] = useState(round || 1);
  const [isPriorityModalOpen, setIsPriorityModalOpen] = useState(false);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);

  // Sync window handlers for external mobile dock triggers
  React.useEffect(() => {
    window.__openScorecardModal = () => setIsSummaryOpen(true);
    window.__openCompleteModal = () => setIsSummaryOpen(true);
    return () => {
      delete window.__openScorecardModal;
      delete window.__openCompleteModal;
    };
  }, []);

  const currentRoundState = roundState[activeTabRound] || {};
  const isRoundRolled = Boolean(currentRoundState.priorityWinner);

  const s1 = getTotalAosMatchScore(p1);
  const s2 = getTotalAosMatchScore(p2);
  const p1Tactics = getCompletedTacticsCount(p1);
  const p2Tactics = getCompletedTacticsCount(p2);

  return (
    <div className="gtk gtk-page max-w-4xl mx-auto px-3 pb-12 pt-2">
      {/* Priority Roll Modal */}
      <PriorityRollModal
        isOpen={isPriorityModalOpen}
        onClose={() => setIsPriorityModalOpen(false)}
        round={activeTabRound}
      />

      {/* End Game Summary Modal */}
      <AosEndGameSummary
        isOpen={isSummaryOpen || is_finished}
        onClose={() => setIsSummaryOpen(false)}
      />

      {/* Score Header Comparison Card */}
      <div
        className="gtk-card p-4 sm:p-5 mb-4 rounded-[14px] border shadow-xl"
        style={{
          background: "var(--gtk-tile)",
          borderColor: "var(--gtk-line)"
        }}
      >
        <div className="grid grid-cols-3 items-center text-center">
          {/* Player 1 Left */}
          <div className="text-left sm:text-center">
            <div className="gtk-display text-[18px] font-bold uppercase text-[#38bdf8] truncate">{p1.name}</div>
            <div className="gtk-display text-[44px] font-bold text-white my-0.5 leading-none">{s1}</div>
            <div className="gtk-mono text-[10px] sm:text-[11px] uppercase" style={{ color: "var(--gtk-muted)" }}>
              PRI: {getTotalPrimaryScore(p1)}/30 • TAC: {getTotalTacticsScore(p1)}/20
            </div>
          </div>

          {/* Center VS & Round Pill */}
          <div className="flex flex-col items-center justify-center">
            <span className="gtk-mono text-[11px] font-bold text-[#64748b]">VS</span>
            <div
              className="gtk-mono my-1.5 px-3 py-1 rounded-full border text-[11px] font-bold uppercase tracking-wider"
              style={{
                background: "var(--gtk-panel)",
                borderColor: "rgba(245, 158, 11, 0.4)",
                color: "var(--gtk-accent)"
              }}
            >
              Round {round} / 5
            </div>
            <span className="gtk-mono text-[10px] uppercase font-semibold text-center" style={{ color: "var(--gtk-muted)" }}>
              {battleplan?.name || "Border War"} • 50 VP Cap
            </span>
          </div>

          {/* Player 2 Right */}
          <div className="text-right sm:text-center">
            <div className="gtk-display text-[18px] font-bold uppercase text-[#ef4444] truncate">{p2.name}</div>
            <div className="gtk-display text-[44px] font-bold text-white my-0.5 leading-none">{s2}</div>
            <div className="gtk-mono text-[10px] sm:text-[11px] uppercase" style={{ color: "var(--gtk-muted)" }}>
              PRI: {getTotalPrimaryScore(p2)}/30 • TAC: {getTotalTacticsScore(p2)}/20
            </div>
          </div>
        </div>
      </div>

      {/* Round Tabs Navigation & Utility Controls */}
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-1 overflow-x-auto pb-0.5">
          {[1, 2, 3, 4, 5].map(r => (
            <button
              key={r}
              onClick={() => {
                setActiveTabRound(r);
                setRound(r);
              }}
              className="gtk-mono flex-1 min-w-[60px] py-1.5 px-2 rounded-[10px] border text-[11px] font-bold uppercase transition-all text-center"
              style={{
                background: activeTabRound === r ? "var(--gtk-panel)" : "var(--gtk-tile)",
                borderColor: activeTabRound === r ? "var(--gtk-accent)" : "var(--gtk-line)",
                color: activeTabRound === r ? "#fff" : r <= round ? "#cbd5e1" : "#64748b"
              }}
            >
              Round {r}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 flex-none">
          <button
            onClick={() => setIsSummaryOpen(true)}
            className="gtk-mono px-3 py-1.5 rounded-[10px] border text-[11px] font-bold uppercase flex items-center gap-1.5 transition-colors"
            style={{
              background: "var(--gtk-tile)",
              borderColor: "var(--gtk-line)",
              color: "#38bdf8"
            }}
            title="View End Game Summary & Scorecard"
          >
            <TrophyIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Scorecard</span>
          </button>
          <button
            onClick={() => {
              if (confirm("Reset current AoS match and return to setup?")) resetGame();
            }}
            className="gtk-mono px-2.5 py-1.5 rounded-[10px] border text-[11px] font-bold uppercase hover:bg-[#ef4444]/10 transition-colors"
            style={{
              borderColor: "rgba(239, 68, 68, 0.4)",
              color: "#ef4444"
            }}
            title="Reset Match"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Priority Roll & Initiative Bar for Selected Round */}
      <div
        className="gtk-card p-3 mb-4 rounded-[12px] border flex items-center justify-between flex-wrap gap-2 text-xs"
        style={{
          background: "var(--gtk-tile)",
          borderColor: "var(--gtk-line)"
        }}
      >
        <div className="flex items-center gap-2">
          <span className="text-base">🎲</span>
          <div>
            <span className="gtk-mono text-[11px] uppercase font-bold" style={{ color: "var(--gtk-muted)" }}>
              Round {activeTabRound} Priority:
            </span>{" "}
            {isRoundRolled ? (
              <span className="gtk-display text-[15px] uppercase font-bold text-white tracking-wide">
                {currentRoundState.firstTurn === "p1" ? p1.name : p2.name} (1st Turn)
                {currentRoundState.isDoubleTurn && (
                  <span className="gtk-mono ml-2 text-[10px] px-1.5 py-0.5 rounded bg-[#ef4444]/20 text-[#ef4444] border border-[#ef4444]/40 font-bold uppercase">
                    ⚡ Double Turn
                  </span>
                )}
                <span className="gtk-mono ml-2 text-[11px] font-normal text-slate-400">
                  • Active: <strong className="text-amber-400">{currentTurnPlayer === "p1" ? p1.name : p2.name}</strong>
                </span>
              </span>
            ) : (
              <span className="gtk-mono text-[11px] font-bold uppercase" style={{ color: "var(--gtk-accent)" }}>
                Priority Roll Pending
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPriorityModalOpen(true)}
            className="gtk-mono px-3 py-1.5 rounded-[8px] border text-[11px] font-bold uppercase flex items-center gap-1.5 transition-colors"
            style={{
              background: "var(--gtk-panel)",
              borderColor: "var(--gtk-line)",
              color: "#38bdf8"
            }}
          >
            <DiceIcon className="w-3.5 h-3.5" />
            {isRoundRolled ? "Priority" : "Roll Priority"}
          </button>

          {isRoundRolled && (
            <button
              onClick={advanceTurn}
              className="gtk-mono px-3 py-1.5 rounded-[8px] text-[11px] font-bold uppercase transition-colors shadow-sm"
              style={{
                background: "var(--gtk-accent)",
                color: "#15171b"
              }}
            >
              {activeTabRound >= 5 && currentTurnPlayer === (currentRoundState.secondTurn || "p2")
                ? "🏁 Complete"
                : currentTurnPlayer === (currentRoundState.firstTurn || "p1")
                ? "Turn 2 →"
                : `Round ${activeTabRound + 1} →`}
            </button>
          )}
        </div>
      </div>

      {/* Player Scorecards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AosPlayerScorecard
          playerKey="p1"
          round={activeTabRound}
          isTurnActive={currentTurnPlayer === "p1" && activeTabRound === round}
          turnNumber={currentRoundState.firstTurn === "p1" ? 1 : 2}
        />
        <AosPlayerScorecard
          playerKey="p2"
          round={activeTabRound}
          isTurnActive={currentTurnPlayer === "p2" && activeTabRound === round}
          turnNumber={currentRoundState.firstTurn === "p2" ? 1 : 2}
        />
      </div>
    </div>
  );
}
