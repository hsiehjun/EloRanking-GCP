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

  return (
    <Modal isOpen onClose={onClose} ariaLabel={`Player ${player} Detachments`}>
      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: "var(--gtk-line)" }}
      >
        <div>
          <span
            className="gtk-mono text-[10px] font-bold uppercase tracking-[0.16em]"
            style={{ color: playerColor }}
          >
            {name} · {factionLabel}
          </span>
          <h3 className="gtk-display text-[22px] font-bold uppercase leading-none">
            Choose Detachments ({spentDP}/{MAX_DETACHMENT_POINTS} DP)
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-[9px] border"
          style={{ borderColor: "var(--gtk-line)", color: "var(--gtk-text)" }}
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Detachments List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 max-h-[60vh]">
        {detachments.map(det => {
          const isSelected = selected.includes(det.name);
          const tooExpensive = !isSelected && spentDP + det.dp > MAX_DETACHMENT_POINTS;
          const dispoColor = DISPOSITION_COLORS[det.disposition] || "var(--gtk-muted)";
          const dispoObj = FORCE_DISPOSITIONS.find(d => d.key === det.disposition);

          return (
            <button
              key={det.name}
              type="button"
              disabled={tooExpensive}
              onClick={() => onToggle(det.name)}
              className="flex w-full items-center justify-between gap-3 rounded-[11px] border-2 px-3.5 py-3 text-left transition-colors disabled:opacity-40"
              style={{
                borderColor: isSelected ? playerColor : "var(--gtk-line)",
                background: isSelected ? `${playerColor}14` : "var(--gtk-tile)"
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="gtk-num flex-none rounded-[7px] px-2.5 py-1 text-[13px] font-bold text-white"
                  style={{ background: dispoColor }}
                >
                  {det.dp} DP
                </span>
                <div className="min-w-0">
                  <span className="gtk-display block truncate text-[17px] font-bold leading-none">
                    {det.name}
                  </span>
                  <span
                    className="gtk-mono text-[10px] font-bold tracking-[0.06em]"
                    style={{ color: dispoColor }}
                  >
                    {dispoObj?.name || det.disposition}
                  </span>
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
        style={{ borderColor: "var(--gtk-line)" }}
      >
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 w-full items-center justify-center rounded-[10px] font-mono text-[13px] font-bold uppercase tracking-[0.1em]"
          style={{ background: "var(--gtk-accent)", color: "#15171b" }}
        >
          Done
        </button>
      </div>
    </Modal>
  );
}
