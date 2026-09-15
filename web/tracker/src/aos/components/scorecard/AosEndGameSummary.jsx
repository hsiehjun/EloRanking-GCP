import React from "react";
import { Modal } from "../common/Modal.jsx";
import { useAosTracker } from "../../context/AosTrackerContext.jsx";
import {
  getTotalPrimaryScore,
  getTotalTacticsScore,
  getTotalAosMatchScore,
  getCompletedTacticsCount
} from "../../data/aosScoringRules.js";
import { TrophyIcon } from "../common/Icons.jsx";

export function AosEndGameSummary({ isOpen, onClose }) {
  const { state, resetGame } = useAosTracker();
  const { p1, p2, battleplan } = state;

  const s1 = getTotalAosMatchScore(p1);
  const s2 = getTotalAosMatchScore(p2);
  const p1Tactics = getCompletedTacticsCount(p1);
  const p2Tactics = getCompletedTacticsCount(p2);

  let winnerTitle = "🤝 BATTLE DRAW / TIE";
  if (s1 > s2) winnerTitle = `🏆 ${p1.name.toUpperCase()} VICTORIOUS`;
  else if (s2 > s1) winnerTitle = `🏆 ${p2.name.toUpperCase()} VICTORIOUS`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="🏁 Battle Final Scorecard & Tiebreakers"
      maxWidth="max-w-2xl"
      footer={
        <div className="flex justify-between items-center w-full">
          <button
            onClick={() => {
              if (confirm("Reset this match and start a new game?")) {
                resetGame();
                onClose();
              }
            }}
            className="px-4 py-2 rounded-xl border border-[#ef4444]/40 text-[#ef4444] text-xs font-bold hover:bg-[#ef4444]/10 transition-colors"
          >
            🔄 New Match
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-black font-bold text-xs"
          >
            Close Summary
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Outcome Header Banner */}
        <div className="text-center p-4 rounded-2xl bg-gradient-to-r from-[#181d28] via-[#1e2533] to-[#181d28] border border-[#f59e0b]/30">
          <div className="inline-flex p-3 rounded-full bg-[#f59e0b]/10 text-[#f59e0b] mb-2">
            <TrophyIcon className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-black text-white tracking-tight">{winnerTitle}</h2>
          <div className="text-xs font-mono text-[#f59e0b] mt-1">
            {battleplan.name} • 5 Battle Rounds Completed
          </div>
        </div>

        {/* Versus Final Score Comparison */}
        <div className="grid grid-cols-2 gap-4">
          {/* Player 1 Card */}
          <div className="p-4 rounded-xl bg-[#0e131d] border border-[#3b82f6]/40 text-center">
            <div className="text-xs font-bold text-[#38bdf8] uppercase tracking-wide">{p1.name}</div>
            <div className="text-3xl font-black font-mono text-white my-2">{s1} <span className="text-xs text-[#94a3b8]">/ 50 VP</span></div>
            <div className="text-xs text-[#cbd5e1] space-y-1 font-mono pt-2 border-t border-[#273042]">
              <div>Primary: <strong>{getTotalPrimaryScore(p1)} / 30</strong></div>
              <div>Tactics VP: <strong>{getTotalTacticsScore(p1)} / 20</strong></div>
              <div className="text-[#38bdf8] font-bold">Tactics Done: {p1Tactics} / 5 (Tiebreaker)</div>
            </div>
          </div>

          {/* Player 2 Card */}
          <div className="p-4 rounded-xl bg-[#0e131d] border border-[#ef4444]/40 text-center">
            <div className="text-xs font-bold text-[#ef4444] uppercase tracking-wide">{p2.name}</div>
            <div className="text-3xl font-black font-mono text-white my-2">{s2} <span className="text-xs text-[#94a3b8]">/ 50 VP</span></div>
            <div className="text-xs text-[#cbd5e1] space-y-1 font-mono pt-2 border-t border-[#273042]">
              <div>Primary: <strong>{getTotalPrimaryScore(p2)} / 30</strong></div>
              <div>Tactics VP: <strong>{getTotalTacticsScore(p2)} / 20</strong></div>
              <div className="text-[#ef4444] font-bold">Tactics Done: {p2Tactics} / 5 (Tiebreaker)</div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
