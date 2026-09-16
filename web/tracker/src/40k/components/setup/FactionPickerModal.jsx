import React, { useState } from "react";
import { FACTIONS_BY_CATEGORY, getFactionName } from "../../data/factions.js";
import { PLAYER_COLORS } from "../../data/constants.js";
import { Modal } from "../common/Modal.jsx";
import { SearchIcon, CheckIcon, CloseIcon } from "../common/Icons.jsx";

export function FactionPickerModal({ player, value, onPick, onClose }) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState(null);

  const playerColor = PLAYER_COLORS[player];
  const query = search.trim().toLowerCase();

  const filteredCategories = FACTIONS_BY_CATEGORY
    .filter(cat => activeCategory === null || cat.label === activeCategory)
    .map(cat => ({
      label: cat.label,
      factions: query
        ? cat.factions.filter(f => f.label.toLowerCase().includes(query))
        : cat.factions
    }))
    .filter(cat => cat.factions.length > 0);

  return (
    <Modal isOpen onClose={onClose} ariaLabel={`Player ${player} Faction`}>
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
            Player {player}
          </span>
          <h3 className="gtk-display text-[22px] font-bold uppercase leading-none">
            Select Faction
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

      {/* Search Bar */}
      <div className="relative px-4 pt-3 pb-2">
        <SearchIcon
          className="pointer-events-none absolute left-7 top-1/2 -translate-y-1/2 h-4 w-4"
          style={{ color: "var(--gtk-muted)" }}
        />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search factions..."
          className="w-full rounded-[10px] border-2 pl-9 pr-3 py-2 text-[14px] outline-none font-medium"
          style={{
            borderColor: "var(--gtk-line)",
            background: "var(--gtk-tile)",
            color: "var(--gtk-text)"
          }}
        />
      </div>

      {/* Category Pills */}
      <div className="flex gap-1.5 overflow-x-auto px-4 pb-2 scrollbar-none">
        <button
          type="button"
          onClick={() => setActiveCategory(null)}
          className="gtk-mono flex-none rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] transition-colors"
          style={
            activeCategory === null
              ? { background: playerColor, borderColor: playerColor, color: "#fff" }
              : { borderColor: "var(--gtk-line)", color: "var(--gtk-muted)" }
          }
        >
          All
        </button>
        {FACTIONS_BY_CATEGORY.map(cat => (
          <button
            key={cat.label}
            type="button"
            onClick={() => setActiveCategory(cat.label)}
            className="gtk-mono flex-none rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] transition-colors"
            style={
              activeCategory === cat.label
                ? { background: playerColor, borderColor: playerColor, color: "#fff" }
                : { borderColor: "var(--gtk-line)", color: "var(--gtk-muted)" }
            }
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Factions List */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4 max-h-[50vh]">
        {/* Clear selection option */}
        <button
          type="button"
          onClick={() => onPick(null)}
          className="flex w-full items-center justify-between rounded-[10px] border p-2.5 text-left transition-colors"
          style={{
            borderColor: !value ? playerColor : "var(--gtk-line)",
            background: !value ? `${playerColor}14` : "var(--gtk-tile)"
          }}
        >
          <span className="font-mono text-[13px] font-bold uppercase tracking-[0.06em]">
            None / Custom
          </span>
          {!value && <CheckIcon className="h-4 w-4" style={{ color: playerColor }} />}
        </button>

        {filteredCategories.map(cat => (
          <div key={cat.label} className="space-y-1.5">
            <h4
              className="gtk-mono text-[10px] font-bold uppercase tracking-[0.14em]"
              style={{ color: "var(--gtk-muted)" }}
            >
              {cat.label}
            </h4>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {cat.factions.map(f => {
                const isSelected = value === f.value;
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => onPick(f.value)}
                    className="flex items-center justify-between rounded-[10px] border p-2.5 text-left transition-colors"
                    style={{
                      borderColor: isSelected ? playerColor : "var(--gtk-line)",
                      background: isSelected ? `${playerColor}14` : "var(--gtk-tile)"
                    }}
                  >
                    <span className="gtk-display text-[15px] font-bold leading-none">
                      {f.label}
                    </span>
                    {isSelected && (
                      <CheckIcon className="h-4 w-4 flex-none" style={{ color: playerColor }} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
