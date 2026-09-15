import React from "react";
import { Modal } from "../common/Modal.jsx";
import { useAosTracker } from "../../context/AosTrackerContext.jsx";
import { getTacticsForPlayer } from "../../data/aosBattleTactics.js";
import { GRAND_ALLIANCE_COLORS } from "../../data/aosConstants.js";

export function BattleTacticPickerModal({ isOpen, onClose, playerKey, round }) {
  const { state, selectBattleTactic } = useAosTracker();
  const player = state[playerKey];

  if (!player) return null;

  // Find tactics already attempted in ANY round
  const attemptedTacticIds = new Set(
    (player.rounds || [])
      .map(r => r.tacticId)
      .filter(id => id && id !== "none" && id !== "forfeited_double_turn")
  );

  const availableTactics = getTacticsForPlayer(player.grandAlliance).filter(
    t => !attemptedTacticIds.has(t.id)
  );

  const currentRoundTacticId = player.rounds?.find(r => r.round === round)?.tacticId;

  function handleSelect(tacticId) {
    selectBattleTactic(playerKey, round, tacticId);
    onClose();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`⚔️ Tactical Gambit • Select Battle Tactic (Round ${round})`}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between bg-[#0e131d] p-3 rounded-xl border border-[#273042]">
          <div>
            <span className="text-xs text-[#94a3b8]">Active Player:</span>{" "}
            <span className="text-xs font-bold text-white">{player.name}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[#94a3b8]">Alliance:</span>
            <span
              className="font-bold px-2 py-0.5 rounded text-[11px]"
              style={{
                backgroundColor: `${GRAND_ALLIANCE_COLORS[player.grandAlliance]}20`,
                color: GRAND_ALLIANCE_COLORS[player.grandAlliance]
              }}
            >
              {player.grandAlliance}
            </span>
          </div>
        </div>

        <p className="text-xs text-[#94a3b8]">
          Each Battle Tactic awards <strong>4 Victory Points</strong> upon completion and can only be attempted <strong>once per game</strong>.
        </p>

        <div className="space-y-2.5 max-h-[440px] overflow-y-auto pr-1">
          {availableTactics.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#94a3b8] bg-[#0e131d] rounded-xl border border-[#273042]">
              No available tactics remaining for this Grand Alliance.
            </div>
          ) : (
            availableTactics.map(t => {
              const isSelected = currentRoundTacticId === t.id;
              return (
                <div
                  key={t.id}
                  onClick={() => handleSelect(t.id)}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                    isSelected
                      ? "bg-[#181d28] border-[#f59e0b] ring-1 ring-[#f59e0b]"
                      : "bg-[#0e131d] border-[#273042] hover:border-[#38bdf8]"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-sm">{t.name}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#181d28] text-[#94a3b8] border border-[#273042]">
                        {t.grandAlliance}
                      </span>
                    </div>
                    <span className="text-xs font-black font-mono text-[#f59e0b] bg-[#f59e0b]/10 px-2 py-0.5 rounded border border-[#f59e0b]/30">
                      +{t.vp} VP
                    </span>
                  </div>
                  <p className="text-xs text-[#cbd5e1] mt-1">{t.description}</p>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
}
