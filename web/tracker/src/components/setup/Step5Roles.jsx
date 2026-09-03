import React from "react";
import { useTracker } from "../../context/TrackerContext.jsx";
import { PLAYER_COLORS } from "../../data/constants.js";

export function Step5Roles() {
  const { state, selectRole } = useTracker();
  const game = state.game;

  return (
    <section className="flex flex-col gap-5">
      {[1, 2].map(playerNum => {
        const isP1 = playerNum === 1;
        const name = (isP1 ? game.p1Name : game.p2Name) || `Player ${playerNum}`;
        const currentRole = isP1 ? game.p1Role : game.p2Role;
        const playerColor = PLAYER_COLORS[playerNum];

        return (
          <div key={playerNum} className="flex flex-col gap-2">
            <span
              className="gtk-mono text-[11px] font-bold uppercase tracking-[0.16em]"
              style={{ color: playerColor }}
            >
              {name}
            </span>

            <div className="flex gap-3">
              {["attacker", "defender"].map(role => {
                const isActive = currentRole === role;
                const label = role.charAt(0).toUpperCase() + role.slice(1);

                return (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => selectRole(playerNum, role)}
                    className="flex flex-1 flex-col items-center justify-center gap-1 rounded-[13px] border-2 py-4 px-3 transition-colors"
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
                    <span className="gtk-display text-[22px] font-bold uppercase leading-none">
                      {label}
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
