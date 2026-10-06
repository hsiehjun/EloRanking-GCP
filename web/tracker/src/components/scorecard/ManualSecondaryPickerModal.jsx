import React from "react";
import { Modal } from "../common/Modal.jsx";
import { getSecondaryCardName, checkReshuffleRules } from "../../data/secondaryMissions.js";
import { PLAYER_COLORS } from "../../data/constants.js";
import { CloseIcon, DiceIcon } from "../common/Icons.jsx";

export function ManualSecondaryPickerModal({ player, available = [], round = 1, onSelect, onDrawRandom, onClose }) {
  const playerColor = PLAYER_COLORS[player];

  const cards = [...available]
    .sort((a, b) => getSecondaryCardName(a).localeCompare(getSecondaryCardName(b)))
    .map(slug => ({
      slug,
      name: getSecondaryCardName(slug),
      disabled: round === 1 && checkReshuffleRules(slug).mandatoryRound1
    }));

  const eligibleCards = cards.filter(c => !c.disabled);

  const handleRandomDraw = () => {
    if (eligibleCards.length === 0) return;
    if (onDrawRandom) {
      onDrawRandom();
    } else {
      const pick = eligibleCards[Math.floor(Math.random() * eligibleCards.length)];
      if (pick && onSelect) {
        onSelect(pick.slug);
      }
    }
    onClose();
  };

  return (
    <Modal isOpen onClose={onClose} ariaLabel={`Player ${player} Secondary Selection`}>
      {/* Header */}
      <div
        className="flex flex-none items-center justify-between border-b px-4 py-3"
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

      {/* Pinned Random Draw Option */}
      {cards.length > 0 && (
        <div
          className="flex-none border-b px-4 py-3"
          style={{ borderColor: "var(--gtk-line)" }}
        >
          <button
            type="button"
            disabled={eligibleCards.length === 0}
            onClick={handleRandomDraw}
            className="flex w-full items-center justify-between gap-3 rounded-[11px] border-2 px-4 py-3 text-left transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              borderColor: playerColor,
              background: playerColor,
              color: "#fff"
            }}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <DiceIcon className="h-5 w-5 flex-none" />
              <span className="gtk-display truncate text-[18px] font-bold uppercase leading-none">
                Random Secondary
              </span>
            </span>
            <span className="gtk-mono flex-none rounded-[6px] bg-black/25 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em]">
              Draw 1 of {eligibleCards.length}
            </span>
          </button>
        </div>
      )}

      {/* Body */}
      <div
        className="flex-1 overflow-y-auto p-4"
        style={{ flex: "1 1 auto", minHeight: 0, maxHeight: "calc(100dvh - 230px)", overflowY: "auto" }}
      >
        {cards.length === 0 ? (
          <p className="gtk-mono py-4 text-center text-[12px]" style={{ color: "var(--gtk-muted)" }}>
            No secondaries left in the deck.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p
              className="gtk-mono mb-1 text-[10px] font-bold uppercase tracking-[0.14em]"
              style={{ color: "var(--gtk-muted)" }}
            >
              Or Choose Manually ({eligibleCards.length} Eligible)
            </p>
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
                <span className="gtk-display min-w-0 truncate text-[17px] font-bold uppercase leading-none">
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
