import React from "react";
import { Modal } from "../common/Modal.jsx";
import { useTracker } from "../../context/TrackerContext.jsx";
import { PLAYER_COLORS } from "../../data/constants.js";
import { CloseIcon } from "../common/Icons.jsx";

export function GameSettingsModal({ onClose }) {
  const {
    state,
    settings,
    setPlayerName,
    setBattleReady,
    updateSettings,
    resetGame
  } = useTracker();
  const game = state.game;

  const handleReset = () => {
    if (window.confirm("Reset match and return to setup wizard?")) {
      resetGame();
      onClose();
    }
  };

  return (
    <Modal isOpen onClose={onClose} ariaLabel="Game Settings" maxWidth="460px">
      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: "var(--gtk-line)" }}
      >
        <h3 className="gtk-display text-[22px] font-bold uppercase leading-none">
          Game Settings
        </h3>
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
      <div className="flex flex-col gap-4 p-4 max-h-[65vh] overflow-y-auto">
        {/* Player Name and Battle Ready */}
        {[1, 2].map(playerNum => {
          const isP1 = playerNum === 1;
          const name = isP1 ? game.p1Name : game.p2Name;
          const battleReady = (isP1 ? state.p1 : state.p2).battleReady !== false;
          const playerColor = PLAYER_COLORS[playerNum];

          return (
            <div key={playerNum} className="flex flex-col gap-1.5">
              <span
                className="gtk-mono text-[11px] font-bold uppercase tracking-[0.16em]"
                style={{ color: playerColor }}
              >
                Player {playerNum}
              </span>
              <input
                type="text"
                value={name ?? ""}
                onChange={e => setPlayerName(playerNum, e.target.value)}
                maxLength={24}
                placeholder={`Player ${playerNum}`}
                className="gtk-display w-full rounded-[11px] border-2 px-3.5 py-2.5 text-[20px] font-bold uppercase leading-none outline-none"
                style={{
                  borderColor: playerColor,
                  background: "var(--gtk-tile)",
                  color: "var(--gtk-text)"
                }}
              />
              <button
                type="button"
                aria-pressed={battleReady}
                onClick={() => setBattleReady(playerNum, !battleReady)}
                className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-[9px] border-2 font-mono text-[11px] font-bold uppercase tracking-[0.1em] transition-colors"
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

        {/* Feature Switches */}
        <div
          className="flex flex-col gap-3 pt-3 border-t"
          style={{ borderColor: "var(--gtk-line)" }}
        >
          <div>
            <p className="gtk-mono mb-1 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--gtk-muted)" }}>
              Command Points
            </p>
            <button
              type="button"
              role="switch"
              aria-checked={settings.trackCP}
              onClick={() => updateSettings({ trackCP: !settings.trackCP })}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border-2 font-mono text-[12px] font-bold uppercase tracking-[0.08em] transition-colors"
              style={
                settings.trackCP
                  ? { background: "#1e9d52", borderColor: "#1e9d52", color: "#fff" }
                  : { borderColor: "var(--gtk-line)", color: "var(--gtk-muted)" }
              }
            >
              Track Command Points {settings.trackCP ? "On" : "Off"}
            </button>
          </div>

          <div>
            <p className="gtk-mono mb-1 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--gtk-muted)" }}>
              Scoreboard
            </p>
            <button
              type="button"
              role="switch"
              aria-checked={settings.showScoreGroups}
              onClick={() => updateSettings({ showScoreGroups: !settings.showScoreGroups })}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border-2 font-mono text-[12px] font-bold uppercase tracking-[0.08em] transition-colors"
              style={
                settings.showScoreGroups
                  ? { background: "#1e9d52", borderColor: "#1e9d52", color: "#fff" }
                  : { borderColor: "var(--gtk-line)", color: "var(--gtk-muted)" }
              }
            >
              Score Breakdown {settings.showScoreGroups ? "On" : "Off"}
            </button>
          </div>
        </div>

        {/* Reset & Done */}
        <div className="flex flex-col gap-2 pt-2 border-t" style={{ borderColor: "var(--gtk-line)" }}>
          <button
            type="button"
            onClick={handleReset}
            className="flex h-11 w-full items-center justify-center rounded-[10px] border font-mono text-[13px] font-bold uppercase tracking-[0.1em] transition-colors hover:bg-red-500/10"
            style={{ borderColor: "#ef4444", color: "#ef4444" }}
          >
            Reset & Start New Game
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-full items-center justify-center rounded-[10px] font-mono text-[13px] font-bold uppercase tracking-[0.1em]"
            style={{ background: "var(--gtk-accent)", color: "#15171b" }}
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
