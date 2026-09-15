import React, { useState } from "react";
import { Modal } from "../common/Modal.jsx";
import { useAosTracker } from "../../context/AosTrackerContext.jsx";

export function AosPrimaryScoreModal({ isOpen, onClose, playerKey, round }) {
  const { state, setPrimaryScore } = useAosTracker();
  const player = state[playerKey];
  const battleplan = state.battleplan;

  if (!player || !battleplan) return null;

  const roundData = player.rounds?.find(r => r.round === round) || {};
  const currentSelections = roundData.primarySelections || {};

  const [selections, setSelections] = useState(currentSelections);

  const scoringConditions = battleplan.scoringConditions || [
    { id: "hold1", label: "Control 1 or more objectives", vp: 2 },
    { id: "hold2", label: "Control 2 or more objectives", vp: 2 },
    { id: "holdMore", label: "Control more objectives than opponent", vp: 2 }
  ];

  function toggleCondition(condId) {
    setSelections(prev => ({
      ...prev,
      [condId]: !prev[condId]
    }));
  }

  // Calculate current score based on selections
  const computedScore = scoringConditions.reduce((sum, cond) => {
    return sum + (selections[cond.id] ? cond.vp : 0);
  }, 0);

  const clampedScore = Math.min(battleplan.maxPrimaryPerRound || 6, computedScore);

  function handleSave() {
    setPrimaryScore(playerKey, round, clampedScore, selections);
    onClose();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`🎯 Primary Scoring • Round ${round} (${battleplan.name})`}
      maxWidth="max-w-md"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="text-xs font-mono text-[#94a3b8]">
            Total: <span className="text-sm font-bold text-white font-mono">{clampedScore} / {battleplan.maxPrimaryPerRound || 6} VP</span>
          </div>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-xl bg-[#38bdf8] hover:bg-[#0284c7] text-black font-bold text-xs"
          >
            Save Primary Score
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="p-3 bg-[#0e131d] rounded-xl border border-[#273042] flex justify-between items-center">
          <span className="text-xs text-[#94a3b8]">Scoring for:</span>
          <span className="text-xs font-bold text-white">{player.name}</span>
        </div>

        <p className="text-xs text-[#94a3b8]">
          Select all primary conditions achieved this battle round (Max {battleplan.maxPrimaryPerRound || 6} VP):
        </p>

        <div className="space-y-2">
          {scoringConditions.map(cond => {
            const isChecked = Boolean(selections[cond.id]);
            return (
              <div
                key={cond.id}
                onClick={() => toggleCondition(cond.id)}
                className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                  isChecked
                    ? "bg-[#181d28] border-[#38bdf8]"
                    : "bg-[#0e131d] border-[#273042] hover:border-[#64748b]"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {}}
                    className="w-4 h-4 rounded text-[#38bdf8] bg-[#070b14] border-[#334155] focus:ring-0 cursor-pointer"
                  />
                  <span className="text-xs font-medium text-white">{cond.label}</span>
                </div>
                <span className="text-xs font-mono font-bold text-[#38bdf8]">
                  +{cond.vp} VP
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
