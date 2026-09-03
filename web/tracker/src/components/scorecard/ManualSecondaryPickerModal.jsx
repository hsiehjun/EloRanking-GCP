import React from "react";
import { Modal } from "../common/Modal.jsx";
import { getSecondaryCardName, checkReshuffleRules } from "../../data/secondaryMissions.js";
import { PLAYER_COLORS } from "../../data/constants.js";
import { CloseIcon } from "../common/Icons.jsx";

export function ManualSecondaryPickerModal({ player, available = [], round = 1, onSelect, onClose }) {
  const playerColor = PLAYER_COLORS[player];

  const cards = [...available]
    .sort((a, b) => getSecondaryCardName(a).localeCompare(getSecondaryCardName(b)))
    .map(slug => ({
      slug,
      name: getSecondaryCardName(slug),
      disabled: round === 1 && checkReshuffleRules(slug).mandatoryRound1
    }));

  return (
    <Modal isOpen onClose={onClose} ariaLabel={`Player ${player} Secondary Selection`}>
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
            Player {player} · Round {round}
          </span>
          <h3 className="gtk-display text-[22px] font-bold uppercase leading-none">
            Select Secondary
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

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 max-h-[55vh]">
        {cards.length === 0 ? (
          <p className="gtk-mono text-[12px] text-center py-4" style={{ color: "var(--gtk-muted)" }}>
            No secondaries left in the deck.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {cards.map(c => (
              <button
                key={c.slug}
                type="button"
                disabled={c.disabled}
                onClick={() => {
                  onSelect(c.slug);
                  onClose();
                }}
                className="flex items-center justify-between rounded-[11px] border-2 px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed"
                style={{
                  borderColor: "var(--gtk-line)",
                  background: "var(--gtk-tile)",
                  opacity: c.disabled ? 0.4 : 1
                }}
              >
                <span className="gtk-display text-[17px] font-bold uppercase leading-none truncate min-w-0">
                  {c.name}
                </span>
                {c.disabled && (
                  <span
                    className="gtk-mono flex-none text-[10px] font-bold uppercase tracking-[0.06em]"
                    style={{ color: "var(--gtk-muted)" }}
                  >
                    R1 N/A
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
