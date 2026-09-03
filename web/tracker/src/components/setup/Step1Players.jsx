import React, { useState } from "react";
import { useTracker } from "../../context/TrackerContext.jsx";
import { PLAYER_COLORS } from "../../data/constants.js";
import { getFactionName } from "../../data/factions.js";
import { FactionPickerModal } from "./FactionPickerModal.jsx";
import { ChevronRightIcon } from "../common/Icons.jsx";

export function Step1Players() {
  const { state, setPlayerName, selectFaction, setBattleReady } = useTracker();
  const game = state.game;
  const [editingFactionPlayer, setEditingFactionPlayer] = useState(null);

  return (
    <section className="flex flex-col gap-5">
      <p
        className="gtk-mono text-center text-[12px] leading-snug"
        style={{ color: "var(--gtk-muted)" }}
      >
        Name the players and pick their faction. These are used throughout the tracker.
      </p>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {[1, 2].map(playerNum => {
          const isP1 = playerNum === 1;
          const name = isP1 ? game.p1Name : game.p2Name;
          const faction = isP1 ? game.p1Faction : game.p2Faction;
          const factionLabel = getFactionName(faction);
          const battleReady = (isP1 ? state.p1 : state.p2).battleReady !== false;
          const playerColor = PLAYER_COLORS[playerNum];

          return (
            <div key={playerNum} className="flex flex-col gap-2">
              <span
                className="gtk-mono text-[11px] font-bold uppercase tracking-[0.16em]"
                style={{ color: playerColor }}
              >
                Player {playerNum}
              </span>

              {/* Player Name Input */}
              <input
                type="text"
                value={name ?? ""}
                onChange={e => setPlayerName(playerNum, e.target.value)}
                maxLength={24}
                placeholder={`Player ${playerNum}`}
                aria-label={`Player ${playerNum} name`}
                className="gtk-display w-full rounded-[12px] border-2 px-4 py-3 text-[22px] font-bold uppercase leading-none outline-none"
                style={{
                  borderColor: playerColor,
                  background: "var(--gtk-tile)",
                  color: "var(--gtk-text)"
                }}
              />

              {/* Faction Picker Trigger */}
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label={`Player ${playerNum} faction`}
                onClick={() => setEditingFactionPlayer(playerNum)}
                className="gtk-display flex w-full items-center justify-between gap-2 rounded-[12px] border-2 px-3.5 py-3 text-[17px] font-bold leading-none transition-colors"
                style={{
                  borderColor: "var(--gtk-line)",
                  background: "var(--gtk-tile)",
                  color: factionLabel ? "var(--gtk-text)" : "var(--gtk-muted)"
                }}
              >
                <span className="truncate">{factionLabel || "Faction (optional)"}</span>
                <ChevronRightIcon className="h-4 w-4 flex-none" style={{ color: "var(--gtk-muted)" }} />
              </button>

              {/* Battle Ready Toggle */}
              <button
                type="button"
                aria-pressed={battleReady}
                onClick={() => setBattleReady(playerNum, !battleReady)}
                className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-[10px] border-2 font-mono text-[11px] font-bold uppercase tracking-[0.1em] transition-colors"
                style={
                  battleReady
                    ? { background: "#1e9d52", borderColor: "#1e9d52", color: "#fff" }
                    : { borderColor: "var(--gtk-line)", color: "var(--gtk-muted)" }
                }
              >
                Battle Ready {battleReady ? "+10 VP" : "Off"}
              </button>
            </div>
          );
        })}
      </div>

      {editingFactionPlayer && (
        <FactionPickerModal
          player={editingFactionPlayer}
          value={editingFactionPlayer === 1 ? game.p1Faction : game.p2Faction}
          onPick={faction => {
            selectFaction(editingFactionPlayer, faction);
            setEditingFactionPlayer(null);
          }}
          onClose={() => setEditingFactionPlayer(null)}
        />
      )}
    </section>
  );
}
