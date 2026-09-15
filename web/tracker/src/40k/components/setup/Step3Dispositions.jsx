import React, { useState } from "react";
import { useTracker } from "../../context/TrackerContext.jsx";
import { PLAYER_COLORS } from "../../data/constants.js";
import {
  FORCE_DISPOSITIONS,
  DISPOSITION_ICONS,
  DISPOSITION_COLORS,
  toDeckSlug
} from "../../data/dispositions.js";
import { getDetachmentInfo } from "../../data/factions.js";
import { getPrimaryMissionCard } from "../../data/primaryMissions.js";
import { CardImageModal } from "../common/CardImageModal.jsx";
import { CheckIcon, ChevronRightIcon } from "../common/Icons.jsx";

export function Step3Dispositions() {
  const { state, selectDisposition } = useTracker();
  const game = state.game;
  const [viewingPrimary, setViewingPrimary] = useState(null);

  // Helper to determine which dispositions are granted by chosen detachments
  const getGrantedDispositions = (faction, detachments) => {
    const granted = new Set();
    for (const dName of detachments) {
      const info = getDetachmentInfo(faction, dName);
      if (info?.disposition) {
        granted.add(info.disposition);
      }
    }
    return granted;
  };

  const p1Granted = getGrantedDispositions(game.p1Faction, game.p1Detachments);
  const p2Granted = getGrantedDispositions(game.p2Faction, game.p2Detachments);

  const bothSelected = !!game.p1Disposition && !!game.p2Disposition;

  return (
    <section className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {[1, 2].map(playerNum => {
          const isP1 = playerNum === 1;
          const name = (isP1 ? game.p1Name : game.p2Name) || `Player ${playerNum}`;
          const currentVal = isP1 ? game.p1Disposition : game.p2Disposition;
          const grantedSet = isP1 ? p1Granted : p2Granted;
          const playerColor = PLAYER_COLORS[playerNum];

          return (
            <div key={playerNum} className="flex flex-col gap-2">
              <span
                className="gtk-mono text-[11px] font-bold uppercase tracking-[0.16em]"
                style={{ color: playerColor }}
              >
                {name}
              </span>

              <div className="gtk-tiles flex flex-col gap-2">
                {FORCE_DISPOSITIONS.map(dispo => {
                  const isSelected = currentVal === dispo.key;
                  // If one is selected, hide the others unless clicked to unselect
                  if (currentVal && !isSelected) return null;

                  const isGranted = grantedSet.has(dispo.key);
                  const color = dispo.color;

                  return (
                    <button
                      key={dispo.key}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => selectDisposition(playerNum, isSelected ? null : dispo.key)}
                      className={`gtk-tile flex items-center justify-between rounded-[12px] border-2 p-3 transition-colors ${
                        isSelected ? "gtk-on" : ""
                      }`}
                      style={{
                        borderColor: isSelected ? color : isGranted ? color : "var(--gtk-line)",
                        background: isSelected
                          ? `${color}28`
                          : isGranted
                          ? `${color}14`
                          : "var(--gtk-tile)"
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="gtk-ic flex h-7 w-7 items-center justify-center"
                          style={{ color: isSelected ? color : "var(--gtk-text)" }}
                        >
                          {DISPOSITION_ICONS[dispo.key]}
                        </span>
                        <span className="gtk-nm font-display text-[18px] font-bold uppercase leading-none">
                          {dispo.name}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {isGranted && !isSelected && (
                          <span
                            className="gtk-mono rounded-full px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.1em] text-white"
                            style={{ background: color }}
                          >
                            Detachment
                          </span>
                        )}
                        {isSelected && (
                          <CheckIcon className="h-5 w-5 flex-none" style={{ color }} />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Primary Mission Preview Cards once both are selected */}
      {bothSelected && game.p1Primary && game.p2Primary && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mt-2">
          {[1, 2].map(playerNum => {
            const isP1 = playerNum === 1;
            const name = (isP1 ? game.p1Name : game.p2Name) || `Player ${playerNum}`;
            const primaryName = isP1 ? game.p1Primary : game.p2Primary;
            const dispoKey = isP1 ? game.p1Disposition : game.p2Disposition;
            const dispoColor = DISPOSITION_COLORS[dispoKey] || "#8a2b2b";
            const cardData = getPrimaryMissionCard(primaryName);

            return (
              <button
                key={playerNum}
                type="button"
                onClick={() => setViewingPrimary({ name: primaryName, card: cardData, color: dispoColor })}
                className="gtk-card flex w-full items-center justify-between gap-3 p-3.5 text-left rounded-[12px] border-2 transition-colors hover:brightness-105"
                style={{ borderColor: dispoColor, background: "var(--gtk-tile)" }}
              >
                <div className="min-w-0">
                  <p
                    className="gtk-mono truncate text-[10px] font-bold uppercase tracking-[0.14em]"
                    style={{ color: PLAYER_COLORS[playerNum] }}
                  >
                    {name} · Primary
                  </p>
                  <p className="gtk-display text-[20px] font-bold uppercase leading-tight">
                    {primaryName}
                  </p>
                </div>
                <span
                  className="gtk-mono flex flex-none items-center gap-1 text-[11px] font-bold uppercase tracking-[0.12em]"
                  style={{ color: "var(--gtk-muted)" }}
                >
                  View <ChevronRightIcon className="h-4 w-4" />
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Primary Mission Full Card Modal */}
      {viewingPrimary && viewingPrimary.card && (
        <CardImageModal
          front={viewingPrimary.card.image}
          back={viewingPrimary.card.back}
          alt={viewingPrimary.name}
          title={`${viewingPrimary.name} · Primary Mission`}
          borderColor={viewingPrimary.color}
          onClose={() => setViewingPrimary(null)}
        />
      )}
    </section>
  );
}
