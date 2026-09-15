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
  const { state, advanceTurn, resetGame } = useAosTracker();
  const { p1, p2, round, currentTurnPlayer, roundState, battleplan, is_finished } = state;

  const [activeTabRound, setActiveTabRound] = useState(round || 1);
  const [isPriorityModalOpen, setIsPriorityModalOpen] = useState(false);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);

  const currentRoundState = roundState[activeTabRound] || {};
  const isRoundRolled = Boolean(currentRoundState.priorityWinner);

  const s1 = getTotalAosMatchScore(p1);
  const s2 = getTotalAosMatchScore(p2);
  const p1Tactics = getCompletedTacticsCount(p1);
  const p2Tactics = getCompletedTacticsCount(p2);

  return (
    <div className="max-w-4xl mx-auto p-3 sm:p-5 pb-24">
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

      {/* Top Header Bar */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-black text-white text-lg tracking-tight">OmniTactica AoS</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#f59e0b]/20 text-[#f59e0b] border border-[#f59e0b]/30">
              GHB 2024-25
            </span>
          </div>
          <div className="text-xs text-[#94a3b8] mt-0.5">
            🎯 Battleplan: <strong className="text-white">{battleplan.name}</strong> • Max 50 VP
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsSummaryOpen(true)}
            className="px-3 py-1.5 rounded-xl bg-[#181d28] hover:bg-[#273042] border border-[#273042] text-xs text-[#38bdf8] font-bold flex items-center gap-1.5 transition-colors"
          >
            <TrophyIcon className="w-4 h-4" /> Scorecard
          </button>
          <button
            onClick={() => {
              if (confirm("Reset current match and return to setup?")) resetGame();
            }}
            className="px-3 py-1.5 rounded-xl border border-[#ef4444]/40 text-[#ef4444] text-xs font-bold hover:bg-[#ef4444]/10 transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Score Header Comparison Card */}
      <div className="bg-[#12161f] border border-[#273042] rounded-2xl p-4 sm:p-5 mb-4 shadow-xl">
        <div className="grid grid-cols-3 items-center text-center">
          {/* Player 1 Left */}
          <div className="text-left sm:text-center">
            <div className="text-xs font-bold text-[#38bdf8] truncate">{p1.name}</div>
            <div className="text-2xl sm:text-4xl font-black font-mono text-white my-1">{s1}</div>
            <div className="text-[10px] sm:text-xs text-[#94a3b8] font-mono">
              PRI: {getTotalPrimaryScore(p1)}/30 • TAC: {getTotalTacticsScore(p1)}/20
            </div>
          </div>

          {/* Center VS & Round Pill */}
          <div className="flex flex-col items-center justify-center">
            <span className="text-xs font-black font-mono text-[#64748b]">VS</span>
            <div className="my-1.5 px-3 py-1 rounded-full bg-[#181d28] border border-[#f59e0b]/40 text-[#f59e0b] text-[11px] font-mono font-bold">
              Round {round} / 5
            </div>
            <span className="text-[10px] text-[#94a3b8] font-mono">50 VP Cap</span>
          </div>

          {/* Player 2 Right */}
          <div className="text-right sm:text-center">
            <div className="text-xs font-bold text-[#ef4444] truncate">{p2.name}</div>
            <div className="text-2xl sm:text-4xl font-black font-mono text-white my-1">{s2}</div>
            <div className="text-[10px] sm:text-xs text-[#94a3b8] font-mono">
              PRI: {getTotalPrimaryScore(p2)}/30 • TAC: {getTotalTacticsScore(p2)}/20
            </div>
          </div>
        </div>
      </div>

      {/* Round Tabs Navigation */}
      <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1">
        {[1, 2, 3, 4, 5].map(r => (
          <button
            key={r}
            onClick={() => setActiveTabRound(r)}
            className={`flex-1 min-w-[65px] py-2 px-3 rounded-xl border text-xs font-mono font-bold transition-all text-center ${
              activeTabRound === r
                ? "bg-[#181d28] border-[#f59e0b] text-white shadow-md"
                : r <= round
                ? "bg-[#0e131d] border-[#273042] text-[#cbd5e1] hover:text-white"
                : "bg-[#0e131d]/60 border-[#1e2533] text-[#64748b]"
            }`}
          >
            Round {r}
          </button>
        ))}
      </div>

      {/* Priority Roll & Initiative Bar for Selected Round */}
      <div className="bg-[#12161f] border border-[#273042] rounded-xl p-3 mb-4 flex items-center justify-between flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-base">🎲</span>
          <div>
            <span className="text-[#94a3b8]">Round {activeTabRound} Priority:</span>{" "}
            {isRoundRolled ? (
              <strong className="text-white">
                {currentRoundState.firstTurn === "p1" ? p1.name : p2.name} (Takes 1st Turn)
                {currentRoundState.isDoubleTurn && (
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-[#ef4444]/20 text-[#ef4444] border border-[#ef4444]/40 font-mono">
                    ⚡ Double Turn
                  </span>
                )}
              </strong>
            ) : (
              <span className="text-[#f59e0b] font-mono">Priority Roll Pending</span>
            )}
          </div>
        </div>

        <button
          onClick={() => setIsPriorityModalOpen(true)}
          className="px-3 py-1 rounded-lg bg-[#181d28] hover:bg-[#273042] border border-[#273042] text-xs font-mono text-[#38bdf8] flex items-center gap-1"
        >
          <DiceIcon className="w-3.5 h-3.5" />
          {isRoundRolled ? "Edit Priority" : "Roll Priority"}
        </button>
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

      {/* Bottom Sticky Action Dock */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#0e131d]/95 backdrop-blur border-t border-[#273042] p-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="text-xs font-mono text-[#94a3b8] hidden sm:block">
            Round {round} • Active Turn: <strong className="text-white">{currentTurnPlayer === "p1" ? p1.name : p2.name}</strong>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <button
              onClick={() => setIsPriorityModalOpen(true)}
              className="px-3 py-2 rounded-xl bg-[#181d28] hover:bg-[#273042] border border-[#273042] text-xs text-[#38bdf8] font-mono font-bold flex items-center gap-1"
            >
              <DiceIcon className="w-4 h-4" /> Priority
            </button>

            <button
              onClick={advanceTurn}
              className="flex-1 sm:flex-initial px-6 py-2.5 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-black font-black text-xs tracking-wider shadow-lg transition-all"
              style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#000000' }}
            >
              {round >= 5 && currentTurnPlayer === (currentRoundState.secondTurn || "p2")
                ? "🏁 Complete Battle"
                : currentTurnPlayer === (currentRoundState.firstTurn || "p1")
                ? "Advance to Turn 2 →"
                : `Next Round (${round + 1}) →`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
