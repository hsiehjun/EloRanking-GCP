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
      className="gtk-card rounded-[14px] border transition-all p-4 sm:p-5 flex flex-col justify-between"
      style={
        isTurnActive
          ? {
              background: "rgba(18, 22, 31, 0.95)",
              borderColor: "#38bdf8",
              boxShadow: "0 0 16px rgba(56, 189, 248, 0.15)"
            }
          : {
              background: "var(--gtk-tile)",
              borderColor: "var(--gtk-line)"
            }
      }
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
            <span className="gtk-mono text-[11px] uppercase font-bold tracking-wider" style={{ color: "var(--gtk-muted)" }}>
              Turn {turnNumber || (isP1 ? 1 : 2)} • {isTurnActive ? "ACTIVE TURN" : "WAITING"}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className="gtk-mono text-[10px] font-bold uppercase px-2 py-0.5 rounded border"
              style={{
                backgroundColor: `${GRAND_ALLIANCE_COLORS[player.grandAlliance]}20`,
                borderColor: `${GRAND_ALLIANCE_COLORS[player.grandAlliance]}40`,
                color: GRAND_ALLIANCE_COLORS[player.grandAlliance]
              }}
            >
              {player.grandAlliance}
            </span>
            {player.isUnderdog && (
              <span
                className="gtk-mono text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border"
                style={{
                  background: "rgba(245, 158, 11, 0.15)",
                  borderColor: "rgba(245, 158, 11, 0.4)",
                  color: "var(--gtk-accent)"
                }}
              >
                ⭐ Underdog
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h3 className="gtk-display text-[22px] font-bold uppercase text-white tracking-wide leading-none">{player.name}</h3>
            <div className="gtk-mono text-[11px] uppercase flex items-center gap-1 mt-1" style={{ color: "var(--gtk-muted)" }}>
              <span>{player.battleFormation || "Standard Formation"}</span>
            </div>
          </div>

          {/* Command Points Widget */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] border"
            style={{
              background: "var(--gtk-panel)",
              borderColor: "var(--gtk-line)"
            }}
          >
            <span className="gtk-mono text-[10px] uppercase font-bold" style={{ color: "var(--gtk-muted)" }}>CP</span>
            <button
              onClick={() => adjustCP(playerKey, -1)}
              className="w-5 h-5 rounded border text-xs font-bold text-white flex items-center justify-center transition-colors hover:border-white"
              style={{ background: "var(--gtk-tile)", borderColor: "var(--gtk-line)" }}
            >
              -
            </button>
            <span className="gtk-display text-[16px] font-bold px-1 leading-none" style={{ color: "var(--gtk-accent)" }}>
              {player.cp || 0}
            </span>
            <button
              onClick={() => adjustCP(playerKey, 1)}
              className="w-5 h-5 rounded border text-xs font-bold text-white flex items-center justify-center transition-colors hover:border-white"
              style={{ background: "var(--gtk-tile)", borderColor: "var(--gtk-line)" }}
            >
              +
            </button>
          </div>
        </div>

        {/* Section 1: Primary Objectives (Max 6 VP) */}
        <div className="mt-4 pt-3 border-t" style={{ borderColor: "var(--gtk-line)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="gtk-mono text-[11px] font-bold uppercase" style={{ color: "var(--gtk-muted)" }}>
              🎯 Primary Objectives
            </span>
            <span className="gtk-display text-[15px] font-bold uppercase text-[#38bdf8]">
              {roundData.primaryScore || 0} / 6 VP
            </span>
          </div>

          <button
            onClick={() => setIsPrimaryModalOpen(true)}
            className="w-full py-2.5 px-3.5 rounded-[12px] border text-left text-[12px] font-bold uppercase flex items-center justify-between transition-colors"
            style={{
              background: "var(--gtk-panel)",
              borderColor: "var(--gtk-line)",
              color: "var(--gtk-text)"
            }}
          >
            <span className="gtk-mono text-[11.5px] uppercase">Score Round {round} Battleplan Primaries</span>
            <span className="gtk-display text-[13px] text-[#38bdf8] font-bold uppercase tracking-wide">Edit →</span>
          </button>
        </div>

        {/* Section 2: Battle Tactic (Tactical Gambit - 4 VP) */}
        <div className="mt-4 pt-3 border-t" style={{ borderColor: "var(--gtk-line)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="gtk-mono text-[11px] font-bold uppercase" style={{ color: "var(--gtk-muted)" }}>
              ⚡ Tactical Gambit (4 VP)
            </span>
            <span className="gtk-display text-[15px] font-bold uppercase" style={{ color: "var(--gtk-accent)" }}>
              {roundData.tacticScore || 0} / 4 VP
            </span>
          </div>

          {isForfeited ? (
            <div className="p-3 rounded-[12px] border text-xs" style={{ background: "rgba(239, 68, 68, 0.15)", borderColor: "rgba(239, 68, 68, 0.4)", color: "#fca5a5" }}>
              <div className="gtk-display text-[14px] font-bold uppercase flex items-center gap-1.5 text-[#f87171]">
                <span>⚠️ Forfeited (Double Turn)</span>
              </div>
              <p className="gtk-mono text-[10.5px] uppercase mt-0.5" style={{ color: "#fca5a5" }}>
                Elected consecutive turns. Tactic forfeited (0 VP).
              </p>
            </div>
          ) : !roundData.tacticId || roundData.tacticId === "none" ? (
            <button
              onClick={() => setIsTacticModalOpen(true)}
              className="gtk-display w-full py-2.5 px-3 rounded-[12px] border text-[13px] font-bold uppercase flex items-center justify-center gap-2 transition-all shadow-sm"
              style={{
                background: "var(--gtk-panel)",
                borderColor: "var(--gtk-line)",
                color: "var(--gtk-accent)"
              }}
            >
              <span>+ Select Battle Tactic for Round {round}</span>
            </button>
          ) : (
            <div className="gtk-card p-3 rounded-[12px] border" style={{ background: "var(--gtk-panel)", borderColor: "var(--gtk-line)" }}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="gtk-display text-[16px] font-bold uppercase text-white tracking-wide">
                    {tacticObj?.name || roundData.tacticId}
                  </span>
                  <div className="text-[11.5px] leading-snug mt-0.5" style={{ color: "var(--gtk-muted)" }}>
                    {tacticObj?.shortDesc || ""}
                  </div>
                </div>
                <button
                  onClick={() => setIsTacticModalOpen(true)}
                  className="gtk-mono text-[10.5px] font-bold uppercase text-[#38bdf8] underline ml-2"
                >
                  Change
                </button>
              </div>

              {/* Status Toggles: Achieved vs Failed */}
              <div className="grid grid-cols-2 gap-2 mt-3 pt-2.5 border-t" style={{ borderColor: "var(--gtk-line)" }}>
                <button
                  onClick={() => resolveBattleTactic(playerKey, round, roundData.tacticStatus === "achieved" ? "selected" : "achieved")}
                  className="gtk-display py-2 px-2.5 rounded-[10px] text-[13px] font-bold uppercase flex items-center justify-center gap-1.5 transition-all"
                  style={
                    roundData.tacticStatus === "achieved"
                      ? { background: "#10b981", color: "#000" }
                      : { background: "var(--gtk-tile)", borderColor: "var(--gtk-line)", color: "var(--gtk-muted)" }
                  }
                >
                  <CheckIcon className="w-3.5 h-3.5" />
                  Achieved (+4)
                </button>

                <button
                  onClick={() => resolveBattleTactic(playerKey, round, roundData.tacticStatus === "failed" ? "selected" : "failed")}
                  className="gtk-display py-2 px-2.5 rounded-[10px] text-[13px] font-bold uppercase flex items-center justify-center gap-1.5 transition-all"
                  style={
                    roundData.tacticStatus === "failed"
                      ? { background: "#ef4444", color: "#fff" }
                      : { background: "var(--gtk-tile)", borderColor: "var(--gtk-line)", color: "var(--gtk-muted)" }
                  }
                >
                  ✕ Failed (0)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Round Subtotal Footer */}
      <div className="mt-4 pt-3 border-t flex items-center justify-between" style={{ borderColor: "var(--gtk-line)" }}>
        <span className="gtk-mono text-[11px] uppercase font-bold" style={{ color: "var(--gtk-muted)" }}>Round {round} Total:</span>
        <span className="gtk-display text-[18px] font-bold text-white leading-none">{roundTotal} / 10 VP</span>
      </div>
    </div>
  );
}
