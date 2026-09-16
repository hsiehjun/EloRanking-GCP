import React, { useState } from "react";
import { Modal } from "../common/Modal.jsx";
import { DiceIcon } from "../common/Icons.jsx";
import { useAosTracker } from "../../context/AosTrackerContext.jsx";

export function PriorityRollModal({ isOpen, onClose, round }) {
  const { state, recordPriorityRoll, underdogs } = useAosTracker();

  const [p1Roll, setP1Roll] = useState(4);
  const [p2Roll, setP2Roll] = useState(3);
  const [winner, setWinner] = useState("p1");
  const [chosenFirst, setChosenFirst] = useState("p1");

  const prevRoundSecond = state.roundState[round - 1]?.secondTurn || "p2";

  // Check if chosenFirst creates a double turn
  const isDoubleTurn = (chosenFirst === prevRoundSecond);
  const isForfeit = isDoubleTurn && (winner === chosenFirst);

  function handleRollDice() {
    const r1 = Math.floor(Math.random() * 6) + 1;
    const r2 = Math.floor(Math.random() * 6) + 1;
    setP1Roll(r1);
    setP2Roll(r2);
    if (r1 > r2) {
      setWinner("p1");
      setChosenFirst("p1");
    } else if (r2 > r1) {
      setWinner("p2");
      setChosenFirst("p2");
    } else {
      // Tie goes to underdog
      const tieWinner = underdogs.p1IsUnderdog ? "p1" : "p2";
      setWinner(tieWinner);
      setChosenFirst(tieWinner);
    }
  }

  function handleConfirm() {
    recordPriorityRoll({
      round,
      priorityWinner: winner,
      chosenFirst
    });
    onClose();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`🎲 Round ${round} Priority Roll-Off`}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <button
            onClick={handleRollDice}
            className="px-3.5 py-2 rounded-xl bg-[#181d28] hover:bg-[#273042] text-xs font-mono text-[#38bdf8] flex items-center gap-1.5 border border-[#273042]"
          >
            <DiceIcon className="w-4 h-4" /> Roll Random D6
          </button>
          <button
            onClick={handleConfirm}
            className="px-5 py-2 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-black font-bold text-xs"
          >
            Confirm Turn Order →
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-[#94a3b8]">
          At the start of Battle Round {round}, players roll a D6 to determine who dictates turn order.
          Underdogs win ties.
        </p>

        {/* Dice Score Inputs */}
        <div className="grid grid-cols-2 gap-3">
          <div className={`p-3.5 rounded-xl border text-center ${winner === "p1" ? "border-[#3b82f6] bg-[#181d28]" : "border-[#273042] bg-[#0e131d]"}`}>
            <div className="text-xs font-bold text-[#38bdf8] mb-1">{state.p1.name}</div>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => { const v = Math.max(1, p1Roll - 1); setP1Roll(v); if (v > p2Roll) setWinner("p1"); else if (p2Roll > v) setWinner("p2"); }}
                className="w-7 h-7 rounded bg-[#273042] text-white font-bold text-xs"
              >-</button>
              <span className="font-mono text-2xl font-black text-white w-8">{p1Roll}</span>
              <button
                onClick={() => { const v = Math.min(6, p1Roll + 1); setP1Roll(v); if (v > p2Roll) setWinner("p1"); else if (p2Roll > v) setWinner("p2"); }}
                className="w-7 h-7 rounded bg-[#273042] text-white font-bold text-xs"
              >+</button>
            </div>
            {underdogs.p1IsUnderdog && (
              <span className="inline-block mt-2 text-[10px] font-mono px-2 py-0.5 rounded bg-[#f59e0b]/20 text-[#f59e0b] border border-[#f59e0b]/40">
                ⭐ UNDERDOG
              </span>
            )}
          </div>

          <div className={`p-3.5 rounded-xl border text-center ${winner === "p2" ? "border-[#ef4444] bg-[#181d28]" : "border-[#273042] bg-[#0e131d]"}`}>
            <div className="text-xs font-bold text-[#ef4444] mb-1">{state.p2.name}</div>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => { const v = Math.max(1, p2Roll - 1); setP2Roll(v); if (p1Roll > v) setWinner("p1"); else if (v > p1Roll) setWinner("p2"); }}
                className="w-7 h-7 rounded bg-[#273042] text-white font-bold text-xs"
              >-</button>
              <span className="font-mono text-2xl font-black text-white w-8">{p2Roll}</span>
              <button
                onClick={() => { const v = Math.min(6, p2Roll + 1); setP2Roll(v); if (p1Roll > v) setWinner("p1"); else if (v > p1Roll) setWinner("p2"); }}
                className="w-7 h-7 rounded bg-[#273042] text-white font-bold text-xs"
              >+</button>
            </div>
            {underdogs.p2IsUnderdog && (
              <span className="inline-block mt-2 text-[10px] font-mono px-2 py-0.5 rounded bg-[#f59e0b]/20 text-[#f59e0b] border border-[#f59e0b]/40">
                ⭐ UNDERDOG
              </span>
            )}
          </div>
        </div>

        {/* Priority Winner Selection */}
        <div className="pt-2">
          <label className="block text-xs font-mono text-[#94a3b8] mb-1.5 uppercase">Who Won Priority?</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setWinner("p1")}
              className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                winner === "p1" ? "bg-[#3b82f6]/20 border-[#3b82f6] text-white" : "bg-[#0e131d] border-[#273042] text-[#94a3b8]"
              }`}
            >
              {state.p1.name} (Won Priority)
            </button>
            <button
              onClick={() => setWinner("p2")}
              className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                winner === "p2" ? "bg-[#ef4444]/20 border-[#ef4444] text-white" : "bg-[#0e131d] border-[#273042] text-[#94a3b8]"
              }`}
            >
              {state.p2.name} (Won Priority)
            </button>
          </div>
        </div>

        {/* First Turn Choice */}
        <div className="pt-2">
          <label className="block text-xs font-mono text-[#94a3b8] mb-1.5 uppercase">
            Priority Winner Decides: Who Goes First?
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setChosenFirst("p1")}
              className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all ${
                chosenFirst === "p1" ? "bg-[#181d28] border-[#38bdf8] text-white" : "bg-[#0e131d] border-[#273042] text-[#94a3b8]"
              }`}
            >
              {state.p1.name} Goes First
            </button>
            <button
              onClick={() => setChosenFirst("p2")}
              className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all ${
                chosenFirst === "p2" ? "bg-[#181d28] border-[#38bdf8] text-white" : "bg-[#0e131d] border-[#273042] text-[#94a3b8]"
              }`}
            >
              {state.p2.name} Goes First
            </button>
          </div>
        </div>

        {/* Double Turn Warning Banner */}
        {isForfeit && (
          <div className="p-3.5 rounded-xl bg-[#ef4444]/15 border border-[#ef4444]/50 text-xs text-[#fca5a5] flex items-start gap-2.5">
            <span className="text-base">⚠️</span>
            <div>
              <div className="font-bold text-[#f87171] uppercase tracking-wide">
                Double Turn Battle Tactic Penalty (AoS 4e Rules)
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed">
                <strong>{chosenFirst === "p1" ? state.p1.name : state.p2.name}</strong> won priority and elected to take consecutive turns (Double Turn).
                Per General's Handbook rules, this player <strong>forfeits their Battle Tactic</strong> for Round {round} (0 VP).
              </p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
