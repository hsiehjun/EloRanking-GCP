import React, { useState } from "react";
import { useAosTracker } from "../../context/AosTrackerContext.jsx";
import { GRAND_ALLIANCE_COLORS } from "../../data/aosConstants.js";
import { getTacticById } from "../../data/aosBattleTactics.js";
import { AosPrimaryScoreModal } from "./AosPrimaryScoreModal.jsx";
import { BattleTacticPickerModal } from "./BattleTacticPickerModal.jsx";
import { SwordsIcon, ShieldIcon, CheckIcon } from "../common/Icons.jsx";

export function AosPlayerScorecard({ playerKey, round, isTurnActive, turnNumber }) {
  const { state, resolveBattleTactic, adjustCP } = useAosTracker();
  const player = state[playerKey];
  const roundData = player.rounds?.find(r => r.round === round) || {};

  const [isPrimaryModalOpen, setIsPrimaryModalOpen] = useState(false);
  const [isTacticModalOpen, setIsTacticModalOpen] = useState(false);

  const tacticObj = getTacticById(roundData.tacticId);
  const isP1 = playerKey === "p1";
  const playerColor = isP1 ? "#3b82f6" : "#ef4444";
  const roundTotal = (roundData.primaryScore || 0) + (roundData.tacticScore || 0);

  const isForfeited = roundData.tacticStatus === "forfeited_double_turn";

  return (
    <div
      className={`rounded-2xl border transition-all p-4 sm:p-5 flex flex-col justify-between ${
        isTurnActive
          ? "bg-[#141923] border-[#38bdf8] shadow-lg ring-1 ring-[#38bdf8]/40"
          : "bg-[#0e131d] border-[#273042]"
      }`}
    >
      {/* Modals */}
      <AosPrimaryScoreModal
        isOpen={isPrimaryModalOpen}
        onClose={() => setIsPrimaryModalOpen(false)}
        playerKey={playerKey}
        round={round}
      />
      <BattleTacticPickerModal
        isOpen={isTacticModalOpen}
        onClose={() => setIsTacticModalOpen(false)}
        playerKey={playerKey}
        round={round}
      />

      {/* Header Info */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: playerColor }}
            />
            <span className="font-mono text-[11px] uppercase font-bold tracking-wider text-[#94a3b8]">
              Turn {turnNumber || (isP1 ? 1 : 2)} • {isTurnActive ? "ACTIVE TURN" : "WAITING"}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded"
              style={{
                backgroundColor: `${GRAND_ALLIANCE_COLORS[player.grandAlliance]}20`,
                color: GRAND_ALLIANCE_COLORS[player.grandAlliance]
              }}
            >
              {player.grandAlliance}
            </span>
            {player.isUnderdog && (
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#f59e0b]/20 text-[#f59e0b] border border-[#f59e0b]/30">
                ⭐ Underdog
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base sm:text-lg font-black text-white">{player.name}</h3>
            <div className="text-xs text-[#94a3b8] flex items-center gap-1 mt-0.5">
              <span>{player.battleFormation || "Standard Formation"}</span>
            </div>
          </div>

          {/* Command Points Widget */}
          <div className="flex items-center gap-1.5 bg-[#181d28] px-2.5 py-1 rounded-xl border border-[#273042]">
            <span className="text-[10px] font-mono text-[#94a3b8] uppercase font-bold">CP</span>
            <button
              onClick={() => adjustCP(playerKey, -1)}
              className="w-5 h-5 rounded bg-[#273042] hover:bg-[#334155] text-xs font-bold text-white flex items-center justify-center"
            >
              -
            </button>
            <span className="font-mono text-sm font-bold text-[#f59e0b] px-1">{player.cp || 0}</span>
            <button
              onClick={() => adjustCP(playerKey, 1)}
              className="w-5 h-5 rounded bg-[#273042] hover:bg-[#334155] text-xs font-bold text-white flex items-center justify-center"
            >
              +
            </button>
          </div>
        </div>

        {/* Section 1: Primary Objectives (Max 6 VP) */}
        <div className="mt-4 pt-3 border-t border-[#273042]/70">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono font-bold text-[#94a3b8] uppercase">
              🎯 Primary Objectives
            </span>
            <span className="text-xs font-mono font-black text-[#38bdf8]">
              {roundData.primaryScore || 0} / 6 VP
            </span>
          </div>

          <button
            onClick={() => setIsPrimaryModalOpen(true)}
            className="w-full py-2 px-3 rounded-xl bg-[#181d28] hover:bg-[#273042] border border-[#273042] text-left text-xs font-medium text-white flex items-center justify-between transition-colors"
          >
            <span>Score Round {round} Battleplan Primaries</span>
            <span className="text-xs text-[#38bdf8] font-bold">Edit →</span>
          </button>
        </div>

        {/* Section 2: Battle Tactic (Tactical Gambit - 4 VP) */}
        <div className="mt-4 pt-3 border-t border-[#273042]/70">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono font-bold text-[#94a3b8] uppercase">
              ⚡ Tactical Gambit (4 VP)
            </span>
            <span className="text-xs font-mono font-black text-[#f59e0b]">
              {roundData.tacticScore || 0} / 4 VP
            </span>
          </div>

          {isForfeited ? (
            <div className="p-3 rounded-xl bg-[#ef4444]/15 border border-[#ef4444]/40 text-xs text-[#fca5a5]">
              <div className="font-bold flex items-center gap-1.5 text-[#f87171]">
                <span>⚠️ Forfeited (Double Turn)</span>
              </div>
              <p className="text-[11px] text-[#fca5a5] mt-0.5">
                Elected consecutive turns. Tactic forfeited (0 VP).
              </p>
            </div>
          ) : !roundData.tacticId || roundData.tacticId === "none" ? (
            <button
              onClick={() => setIsTacticModalOpen(true)}
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-[#1e2533] to-[#181d28] hover:border-[#f59e0b] border border-[#273042] text-xs font-bold text-[#f59e0b] flex items-center justify-center gap-2 transition-all shadow-sm"
            >
              <span>+ Select Battle Tactic for Round {round}</span>
            </button>
          ) : (
            <div className="p-3 rounded-xl bg-[#181d28] border border-[#273042]">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-white">
                    {tacticObj?.name || roundData.tacticId}
                  </span>
                  <div className="text-[11px] text-[#94a3b8] mt-0.5">
                    {tacticObj?.shortDesc || ""}
                  </div>
                </div>
                <button
                  onClick={() => setIsTacticModalOpen(true)}
                  className="text-[10px] text-[#38bdf8] underline ml-2"
                >
                  Change
                </button>
              </div>

              {/* Status Toggles: Achieved vs Failed */}
              <div className="grid grid-cols-2 gap-2 mt-3 pt-2.5 border-t border-[#273042]">
                <button
                  onClick={() => resolveBattleTactic(playerKey, round, roundData.tacticStatus === "achieved" ? "selected" : "achieved")}
                  className={`py-1.5 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    roundData.tacticStatus === "achieved"
                      ? "bg-[#10b981] text-black font-black"
                      : "bg-[#0e131d] border border-[#273042] text-[#94a3b8] hover:text-white"
                  }`}
                >
                  <CheckIcon className="w-3.5 h-3.5" />
                  Achieved (+4)
                </button>

                <button
                  onClick={() => resolveBattleTactic(playerKey, round, roundData.tacticStatus === "failed" ? "selected" : "failed")}
                  className={`py-1.5 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    roundData.tacticStatus === "failed"
                      ? "bg-[#ef4444] text-white font-black"
                      : "bg-[#0e131d] border border-[#273042] text-[#94a3b8] hover:text-white"
                  }`}
                >
                  ✕ Failed (0)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Round Subtotal Footer */}
      <div className="mt-4 pt-3 border-t border-[#273042] flex items-center justify-between text-xs font-mono">
        <span className="text-[#94a3b8]">Round {round} Total:</span>
        <span className="text-sm font-black text-white">{roundTotal} / 10 VP</span>
      </div>
    </div>
  );
}
