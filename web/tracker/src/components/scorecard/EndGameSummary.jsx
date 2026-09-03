import React from "react";
import { useTracker } from "../../context/TrackerContext.jsx";
import { PLAYER_COLORS, PRIMARY_MAX_VP, SECONDARY_MAX_VP, BATTLE_READY_VP } from "../../data/constants.js";
import {
  getTotalPrimaryScore,
  getTotalSecondaryScore,
  getTotalMatchScore,
  getRoundSecondaryTotal,
  getCardRoundPoints
} from "../../data/scoringRules.js";
import { getSecondaryCardName } from "../../data/secondaryMissions.js";
import { getFactionName } from "../../data/factions.js";
import { TrophyIcon } from "../common/Icons.jsx";

const ROUNDS = [1, 2, 3, 4, 5];

export function EndGameSummary() {
  const { state } = useTracker();
  const game = state.game;
  const p1 = state.p1;
  const p2 = state.p2;

  const p1Total = getTotalMatchScore(p1);
  const p2Total = getTotalMatchScore(p2);
  const winner = p1Total === p2Total ? 0 : p1Total > p2Total ? 1 : 2;

  const p1Name = game.p1Name || "Player 1";
  const p2Name = game.p2Name || "Player 2";
  const p1Faction = getFactionName(game.p1Faction);
  const p2Faction = getFactionName(game.p2Faction);

  const getRoundPoints = (playerState, round) => {
    const primary = playerState.rounds[round - 1]?.primaryScore || 0;
    const secondary = getRoundSecondaryTotal(playerState.hand, round);
    return primary + secondary;
  };

  const maxRoundScore = Math.max(
    1,
    ...ROUNDS.flatMap(r => [getRoundPoints(p1, r), getRoundPoints(p2, r)])
  );

  const p1Primary = getTotalPrimaryScore(p1);
  const p2Primary = getTotalPrimaryScore(p2);
  const p1Secondary = Math.min(getTotalSecondaryScore(p1.hand), SECONDARY_MAX_VP);
  const p2Secondary = Math.min(getTotalSecondaryScore(p2.hand), SECONDARY_MAX_VP);
  const p1BattleReady = p1.battleReady === false ? 0 : BATTLE_READY_VP;
  const p2BattleReady = p2.battleReady === false ? 0 : BATTLE_READY_VP;

  const renderPlayerHeader = (playerNum, align = "left") => (
    <div className={`min-w-0 ${align === "left" ? "text-left" : "text-right"}`}>
      <p
        className="gtk-display truncate text-[18px] font-bold uppercase leading-tight"
        style={{ color: PLAYER_COLORS[playerNum] }}
      >
        {playerNum === 1 ? p1Name : p2Name}
      </p>
      {(playerNum === 1 ? p1Faction : p2Faction) && (
        <p className="gtk-mono truncate text-[9.5px] uppercase tracking-[0.08em]" style={{ color: "var(--gtk-muted)" }}>
          {playerNum === 1 ? p1Faction : p2Faction}
        </p>
      )}
    </div>
  );

  const renderBreakdownRow = (label, p1Val, p2Val, maxVal) => (
    <div className="grid grid-cols-[1fr_92px_1fr] items-center gap-2 py-1.5 border-b last:border-0" style={{ borderColor: "var(--gtk-line)" }}>
      <div className="flex items-center gap-2">
        <span className="gtk-num w-7 flex-none text-right text-[13px] font-bold tabular-nums">
          {p1Val}
        </span>
        <div className="relative h-2 flex-1 overflow-hidden rounded-[4px]" style={{ background: "rgba(0,0,0,0.06)" }}>
          <div
            className="absolute inset-y-0 right-0 rounded-l-[4px]"
            style={{
              width: `${Math.min(100, (p1Val / maxVal) * 100)}%`,
              background: PLAYER_COLORS[1]
            }}
          />
        </div>
      </div>

      <span className="gtk-mono text-center text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: "var(--gtk-muted)" }}>
        {label}
      </span>

      <div className="flex items-center gap-2">
        <div className="relative h-2 flex-1 overflow-hidden rounded-[4px]" style={{ background: "rgba(0,0,0,0.06)" }}>
          <div
            className="absolute inset-y-0 left-0 rounded-r-[4px]"
            style={{
              width: `${Math.min(100, (p2Val / maxVal) * 100)}%`,
              background: PLAYER_COLORS[2]
            }}
          />
        </div>
        <span className="gtk-num w-7 flex-none text-[13px] font-bold tabular-nums">
          {p2Val}
        </span>
      </div>
    </div>
  );

  return (
    <div className="gtk-card overflow-hidden rounded-[14px] border" style={{ borderColor: "var(--gtk-line)" }}>
      {/* Winner Banner */}
      <div
        className="flex items-center justify-center gap-2 px-4 py-3"
        style={{
          background: "color-mix(in srgb, var(--gtk-accent) 15%, transparent)",
          borderBottom: "1px solid var(--gtk-line)"
        }}
      >
        {winner !== 0 && <TrophyIcon className="h-5 w-5" style={{ color: "var(--gtk-accent)" }} />}
        <span className="gtk-display text-[20px] font-bold uppercase leading-none">
          {winner === 0 ? "Draw Match" : `${winner === 1 ? p1Name : p2Name} Wins`}
        </span>
      </div>

      {/* Match Score Display */}
      <div
        className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3.5 border-b"
        style={{ borderColor: "var(--gtk-line)" }}
      >
        {renderPlayerHeader(1, "left")}
        <div className="gtk-num text-center text-[36px] font-bold leading-none">
          <span style={{ color: winner === 2 ? "var(--gtk-muted)" : "var(--gtk-text)" }}>
            {p1Total}
          </span>
          <span className="mx-2 text-[20px]" style={{ color: "var(--gtk-muted)" }}>–</span>
          <span style={{ color: winner === 1 ? "var(--gtk-muted)" : "var(--gtk-text)" }}>
            {p2Total}
          </span>
        </div>
        {renderPlayerHeader(2, "right")}
      </div>

      {/* Round By Round Progression */}
      <div className="px-4 py-3.5 border-b space-y-2.5" style={{ borderColor: "var(--gtk-line)" }}>
        <p className="gtk-mono text-center text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--gtk-muted)" }}>
          Round by round
        </p>

        <div className="flex flex-col gap-2">
          {ROUNDS.map(r => {
            const p1RoundScore = getRoundPoints(p1, r);
            const p2RoundScore = getRoundPoints(p2, r);

            return (
              <div key={r} className="grid grid-cols-[1fr_34px_1fr] items-center gap-2">
                {/* P1 Bar */}
                <div className="flex items-center gap-2">
                  <span className="gtk-num w-7 text-right text-[13px] font-bold">
                    {p1RoundScore}
                  </span>
                  <div className="relative h-2.5 flex-1 overflow-hidden rounded-[4px]" style={{ background: "rgba(0,0,0,0.06)" }}>
                    <div
                      className="absolute inset-y-0 right-0 rounded-l-[4px]"
                      style={{
                        width: `${(p1RoundScore / maxRoundScore) * 100}%`,
                        background: PLAYER_COLORS[1]
                      }}
                    />
                  </div>
                </div>

                <span className="gtk-mono text-center text-[10px] font-bold uppercase" style={{ color: "var(--gtk-muted)" }}>
                  R{r}
                </span>

                {/* P2 Bar */}
                <div className="flex items-center gap-2 flex-row-reverse">
                  <span className="gtk-num w-7 text-left text-[13px] font-bold">
                    {p2RoundScore}
                  </span>
                  <div className="relative h-2.5 flex-1 overflow-hidden rounded-[4px]" style={{ background: "rgba(0,0,0,0.06)" }}>
                    <div
                      className="absolute inset-y-0 left-0 rounded-r-[4px]"
                      style={{
                        width: `${(p2RoundScore / maxRoundScore) * 100}%`,
                        background: PLAYER_COLORS[2]
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Category Breakdown */}
      <div className="px-4 py-3 space-y-1">
        {renderBreakdownRow("Primary", p1Primary, p2Primary, PRIMARY_MAX_VP)}
        {renderBreakdownRow("Secondary", p1Secondary, p2Secondary, SECONDARY_MAX_VP)}
        {renderBreakdownRow("Battle Ready", p1BattleReady, p2BattleReady, BATTLE_READY_VP)}

        <div className="grid grid-cols-[1fr_92px_1fr] items-center gap-2 pt-2 mt-1 border-t" style={{ borderColor: "var(--gtk-line)" }}>
          <span className="gtk-num text-right text-[22px] font-bold tabular-nums">
            {p1Total}
          </span>
          <span className="gtk-mono text-center text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: "var(--gtk-muted)" }}>
            Total
          </span>
          <span className="gtk-num text-[22px] font-bold tabular-nums">
            {p2Total}
          </span>
        </div>
      </div>
    </div>
  );
}
