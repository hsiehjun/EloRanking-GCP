import React from "react";
import { getFactionDetachments, getFactionName } from "../../data/factions.js";
import { PLAYER_COLORS, MAX_DETACHMENT_POINTS } from "../../data/constants.js";
import { DISPOSITION_COLORS, FORCE_DISPOSITIONS } from "../../data/dispositions.js";
import { Modal } from "../common/Modal.jsx";
import { CheckIcon, CloseIcon } from "../common/Icons.jsx";

export function DetachmentPickerModal({ player, name, faction, selected, onToggle, onClose }) {
  const playerColor = PLAYER_COLORS[player];
  const factionLabel = getFactionName(faction);
  const detachments = getFactionDetachments(faction);

  const spentDP = selected.reduce((sum, dName) => {
    const d = detachments.find(item => item.name === dName);
    return sum + (d?.dp || 0);
  }, 0);

  const activeUniqueTags = new Set(
    selected
      .map(dName => detachments.find(item => item.name === dName)?.unique)
      .filter(Boolean)
  );

  return (
    <Modal isOpen onClose={onClose} ariaLabel={`Player ${player} Detachments`}>
      {/* Header */}
      <div
        className="flex items-center justify-between gap-2 border-b px-4 py-2.5"
        style={{ flexShrink: 0, borderColor: "var(--gtk-line)" }}
      >
        <div className="min-w-0">
          <span
            className="gtk-mono block truncate text-[10px] font-bold uppercase tracking-[0.16em]"
            style={{ color: playerColor }}
          >
            {name} · {factionLabel}
          </span>
          <h3
            className="gtk-display whitespace-nowrap font-bold uppercase leading-none"
            style={{ fontSize: "clamp(16px, 4.5vw, 20px)" }}
          >
            Choose Detachments ({spentDP}/{MAX_DETACHMENT_POINTS} DP)
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-8 w-8 flex-none items-center justify-center rounded-[8px] border"
          style={{ borderColor: "var(--gtk-line)", color: "var(--gtk-text)" }}
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Detachments List */}
      <div
        className="flex-1 overflow-y-auto p-3 space-y-2"
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          maxHeight: "calc(100dvh - 150px)",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch"
        }}
      >
        {detachments.map(det => {
          const isSelected = selected.includes(det.name);
          const tooExpensive = !isSelected && spentDP + det.dp > MAX_DETACHMENT_POINTS;
          const uniqueConflict = !isSelected && !!det.unique && activeUniqueTags.has(det.unique);
          const isDisabled = tooExpensive || uniqueConflict;

          const dispoKeys =
            Array.isArray(det.dispositions) && det.dispositions.length > 0
              ? det.dispositions
              : [det.disposition];
          const primaryDispoColor = DISPOSITION_COLORS[dispoKeys[0]] || "var(--gtk-muted)";
          const secondaryDispoColor = dispoKeys[1] ? DISPOSITION_COLORS[dispoKeys[1]] : null;
          const dpBadgeBackground = secondaryDispoColor
            ? `linear-gradient(135deg, ${primaryDispoColor} 50%, ${secondaryDispoColor} 50%)`
            : primaryDispoColor;

          return (
            <button
              key={det.name}
              type="button"
              disabled={isDisabled}
              onClick={() => onToggle(det.name)}
              className="flex w-full items-center justify-between gap-3 rounded-[10px] border-2 px-3 py-2.5 text-left transition-colors disabled:opacity-40"
              style={{
                borderColor: isSelected ? playerColor : "var(--gtk-line)",
                background: isSelected ? `${playerColor}14` : "var(--gtk-tile)"
              }}
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <span
                  className="gtk-num flex-none rounded-[6px] px-2 py-0.5 text-[12px] font-bold text-white"
                  style={{ background: dpBadgeBackground }}
                >
                  {det.dp} DP
                </span>
                <div className="min-w-0 flex-1">
                  <span className="gtk-display block truncate text-[16px] font-bold leading-tight">
                    {det.name}
                  </span>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex flex-wrap items-center gap-1">
                      {dispoKeys.map((dKey, idx) => {
                        const dObj = FORCE_DISPOSITIONS.find(d => d.key === dKey);
                        const dCol = DISPOSITION_COLORS[dKey] || "var(--gtk-muted)";
                        return (
                          <React.Fragment key={dKey}>
                            {idx > 0 && (
                              <span
                                className="gtk-mono text-[9.5px] font-bold"
                                style={{ color: "var(--gtk-muted)" }}
                              >
                                ·
                              </span>
                            )}
                            <span
                              className="gtk-mono text-[9.5px] font-bold tracking-[0.06em]"
                              style={{ color: dCol }}
                            >
                              {dObj?.name || dKey}
                            </span>
                          </React.Fragment>
                        );
                      })}
                    </span>
                    {det.unique && (
                      <span
                        className="gtk-mono flex-none rounded px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.06em] leading-none"
                        style={{
                          background: uniqueConflict
                            ? "rgba(239, 68, 68, 0.18)"
                            : "rgba(255, 255, 255, 0.08)",
                          color: uniqueConflict ? "#f87171" : "var(--gtk-muted)",
                          border: `1px solid ${
                            uniqueConflict ? "rgba(239, 68, 68, 0.4)" : "var(--gtk-line)"
                          }`
                        }}
                      >
                        UNIQUE: {det.unique}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {isSelected && (
                <CheckIcon className="h-5 w-5 flex-none" style={{ color: playerColor }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Done Button */}
      <div
        className="border-t p-3"
        style={{
          flexShrink: 0,
          borderColor: "var(--gtk-line)",
          background: "var(--gtk-panel, #12161f)"
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-full items-center justify-center rounded-[10px] font-mono text-[13px] font-bold uppercase tracking-[0.1em]"
          style={{ background: "var(--gtk-accent)", color: "#15171b" }}
        >
          Done ({selected.length} Selected · {spentDP}/{MAX_DETACHMENT_POINTS} DP)
        </button>
      </div>
    </Modal>
  );
}
