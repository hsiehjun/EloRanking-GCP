import React, { useState } from "react";
import { useTracker } from "../../context/TrackerContext.jsx";
import { PLAYER_COLORS, MAX_DETACHMENT_POINTS } from "../../data/constants.js";
import { getFactionName, getFactionDetachments, getDetachmentInfo } from "../../data/factions.js";
import { DISPOSITION_COLORS } from "../../data/dispositions.js";
import { DetachmentPickerModal } from "./DetachmentPickerModal.jsx";
import { PlusIcon } from "../common/Icons.jsx";

export function Step2Detachments() {
  const { state, toggleDetachment } = useTracker();
  const game = state.game;
  const [editingPlayer, setEditingPlayer] = useState(null);

  return (
    <section className="flex flex-col gap-5">
      <p
        className="gtk-mono text-center text-[12px] leading-snug"
        style={{ color: "var(--gtk-muted)" }}
      >
        Optional. Spend up to {MAX_DETACHMENT_POINTS} Detachment Points. Each detachment grants a
        force disposition. Skip to keep it open.
      </p>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {[1, 2].map(playerNum => {
          const isP1 = playerNum === 1;
          const name = (isP1 ? game.p1Name : game.p2Name) || `Player ${playerNum}`;
          const faction = isP1 ? game.p1Faction : game.p2Faction;
          const factionLabel = getFactionName(faction);
          const detachments = isP1 ? game.p1Detachments : game.p2Detachments;
          const availableDetachments = getFactionDetachments(faction);
          const hasFaction = !!faction && availableDetachments.length > 0;
          const playerColor = PLAYER_COLORS[playerNum];

          const totalDP = detachments.reduce((sum, dName) => {
            const d = getDetachmentInfo(faction, dName);
            return sum + (d?.dp || 0);
          }, 0);

          return (
            <div key={playerNum} className="flex flex-col gap-2">
              <span
                className="gtk-mono text-[11px] font-bold uppercase tracking-[0.16em]"
                style={{ color: playerColor }}
              >
                {name} {factionLabel ? `· ${factionLabel}` : ""}
              </span>

              {/* Detachment Chips */}
              {detachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-1">
                  {detachments.map(dName => {
                    const info = getDetachmentInfo(faction, dName);
                    if (!info) return null;
                    const dispoColor = DISPOSITION_COLORS[info.disposition];
                    return (
                      <span
                        key={dName}
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
                        style={{
                          background: `${dispoColor}1f`,
                          border: `1px solid ${dispoColor}`
                        }}
                      >
                        <span
                          className="gtk-display text-[13px] font-bold leading-none"
                          style={{ color: "var(--gtk-text)" }}
                        >
                          {info.name}
                        </span>
                        <span
                          className="gtk-num text-[10px] font-bold"
                          style={{ color: dispoColor }}
                        >
                          {info.dp}DP
                        </span>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Action Button */}
              <button
                type="button"
                disabled={!hasFaction}
                onClick={() => setEditingPlayer(playerNum)}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-[12px] border-2 font-mono text-[13px] font-bold uppercase tracking-[0.1em] transition-colors disabled:opacity-40"
                style={
                  detachments.length > 0
                    ? {
                        borderColor: playerColor,
                        background: `${playerColor}14`,
                        color: "var(--gtk-text)"
                      }
                    : {
                        borderColor: "var(--gtk-line)",
                        color: "var(--gtk-text)"
                      }
                }
              >
                <PlusIcon className="h-4 w-4" />
                {detachments.length > 0
                  ? `Edit detachments · ${totalDP}/${MAX_DETACHMENT_POINTS} DP`
                  : "Select detachment"}
              </button>

              {!faction && (
                <p className="gtk-mono text-[11px]" style={{ color: "var(--gtk-muted)" }}>
                  Pick a faction in step 1 to choose detachments.
                </p>
              )}
              {faction && availableDetachments.length === 0 && (
                <p className="gtk-mono text-[11px]" style={{ color: "var(--gtk-muted)" }}>
                  No detachment list for this faction yet.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {editingPlayer && (
        <DetachmentPickerModal
          player={editingPlayer}
          name={(editingPlayer === 1 ? game.p1Name : game.p2Name) || `Player ${editingPlayer}`}
          faction={editingPlayer === 1 ? game.p1Faction : game.p2Faction}
          selected={editingPlayer === 1 ? game.p1Detachments : game.p2Detachments}
          onToggle={dName => toggleDetachment(editingPlayer, dName)}
          onClose={() => setEditingPlayer(null)}
        />
      )}
    </section>
  );
}
