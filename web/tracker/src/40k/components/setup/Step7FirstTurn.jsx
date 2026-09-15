import React from "react";
import { useTracker } from "../../context/TrackerContext.jsx";
import { PLAYER_COLORS } from "../../data/constants.js";

export function Step7FirstTurn() {
  const { state, selectRollOffWinner } = useTracker();
  const game = state.game;

  const p1Name = game.p1Name || "Player 1";
  const p2Name = game.p2Name || "Player 2";
  const winner = game.rollOffWinner;

  return (
    <section className="flex flex-col gap-5">
      <p
        className="gtk-mono text-center text-[12px] font-bold uppercase tracking-[0.12em]"
        style={{ color: "var(--gtk-muted)" }}
      >
        Who won the roll-off?
      </p>

      <div className="flex gap-3">
        {[
          { key: "player1", name: p1Name, color: PLAYER_COLORS[1] },
          { key: "player2", name: p2Name, color: PLAYER_COLORS[2] }
        ].map(opt => {
          const isActive = winner === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => selectRollOffWinner(opt.key)}
              className="flex flex-1 items-center justify-center rounded-[13px] border-2 py-5 px-3 transition-colors"
              style={
                isActive
                  ? {
                      background: opt.color,
                      borderColor: opt.color,
                      color: "#fff"
                    }
                  : {
                      borderColor: "var(--gtk-line)",
                      background: "var(--gtk-tile)",
                      color: "var(--gtk-text)"
                    }
              }
            >
              <span className="gtk-display text-[24px] font-bold uppercase leading-none">
                {opt.name}
              </span>
            </button>
          );
        })}
      </div>

      {winner && (
        <p
          className="gtk-mono mt-4 text-center text-[13px] font-bold uppercase tracking-[0.12em]"
          role="status"
          style={{ color: PLAYER_COLORS[winner === "player1" ? 1 : 2] }}
        >
          {winner === "player1" ? p1Name : p2Name} takes the first turn
        </p>
      )}
    </section>
  );
}
