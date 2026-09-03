import React from "react";
import { useTracker } from "../../context/TrackerContext.jsx";
import { PLAYER_COLORS } from "../../data/constants.js";

const MISSION_TYPES = [
  { key: "tactical", name: "Tactical", desc: "Draw random secondaries" },
  { key: "fixed", name: "Fixed", desc: "Select two fixed secondaries" },
  { key: "manual", name: "Manual", desc: "You select tactical secondaries" }
];

export function Step6DeckType() {
  const { state, selectMissionType } = useTracker();
  const game = state.game;

  return (
    <section className="flex flex-col gap-5">
      {[1, 2].map(playerNum => {
        const isP1 = playerNum === 1;
        const name = (isP1 ? game.p1Name : game.p2Name) || `Player ${playerNum}`;
        const currentType = isP1 ? game.p1MissionType : game.p2MissionType;
        const playerColor = PLAYER_COLORS[playerNum];

        return (
          <div key={playerNum} className="flex flex-col gap-2">
            <span
              className="gtk-mono text-[11px] font-bold uppercase tracking-[0.16em]"
              style={{ color: playerColor }}
            >
              {name}
            </span>

            <div className="grid grid-cols-3 gap-2.5">
              {MISSION_TYPES.map(type => {
                const isActive = currentType === type.key;
                return (
                  <button
                    key={type.key}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => selectMissionType(playerNum, type.key)}
                    className="flex flex-col items-center justify-start gap-1 rounded-[13px] border-2 px-2.5 py-3 text-center transition-colors"
                    style={
                      isActive
                        ? {
                            background: playerColor,
                            borderColor: playerColor,
                            color: "#fff"
                          }
                        : {
                            borderColor: "var(--gtk-line)",
                            background: "var(--gtk-tile)",
                            color: "var(--gtk-text)"
                          }
                    }
                  >
                    <span className="gtk-display text-[20px] font-bold uppercase leading-none">
                      {type.name}
                    </span>
                    <span
                      className="gtk-mono text-[9.5px] font-semibold uppercase tracking-[0.06em]"
                      style={{ opacity: isActive ? 0.9 : 0.6 }}
                    >
                      {type.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
