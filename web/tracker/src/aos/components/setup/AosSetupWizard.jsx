import React, { useState } from "react";
import { useAosTracker } from "../../context/AosTrackerContext.jsx";
import { AOS_BATTLEPLANS } from "../../data/aosBattleplans.js";
import { AOS_FACTIONS, getFactionsByAlliance } from "../../data/aosFactions.js";
import { GRAND_ALLIANCES, GRAND_ALLIANCE_COLORS } from "../../data/aosConstants.js";
import { CheckIcon } from "../common/Icons.jsx";

const STEP_TITLES = [
  "Battleplan",
  "Player 1",
  "Player 2",
  "First Turn"
];

const STEP_SUBTITLES = [
  "Select the Matched Play Battleplan",
  "Grand Alliance, Faction & Formation",
  "Grand Alliance, Faction & Formation",
  "Determine Initiative for Battle Round 1"
];

export function AosSetupWizard() {
  const { state, updateGameSetup, startGame } = useAosTracker();
  const [step, setStep] = useState(1);

  // Local form state
  const [battleplanId, setBattleplanId] = useState(state.battleplan?.id || AOS_BATTLEPLANS[0].id);
  const [p1Name, setP1Name] = useState(state.p1.name || "Player 1");
  const [p1Alliance, setP1Alliance] = useState(state.p1.grandAlliance || "Order");
  const [p1Faction, setP1Faction] = useState(state.p1.faction || "stormcast-eternals");
  const [p1Formation, setP1Formation] = useState(state.p1.battleFormation || "Lightning Echelon");

  const [p2Name, setP2Name] = useState(state.p2.name || "Player 2");
  const [p2Alliance, setP2Alliance] = useState(state.p2.grandAlliance || "Chaos");
  const [p2Faction, setP2Faction] = useState(state.p2.faction || "skaven");
  const [p2Formation, setP2Formation] = useState(state.p2.battleFormation || "Warpcog Convocation");

  const [round1First, setRound1First] = useState("p1");

  const p1Factions = getFactionsByAlliance(p1Alliance);
  const p2Factions = getFactionsByAlliance(p2Alliance);

  const selectedP1FacObj = AOS_FACTIONS.find(f => f.id === p1Faction) || p1Factions[0];
  const selectedP2FacObj = AOS_FACTIONS.find(f => f.id === p2Faction) || p2Factions[0];

  function handleFinish() {
    updateGameSetup({
      battleplanId,
      p1: {
        name: p1Name.trim() || "Player 1",
        grandAlliance: p1Alliance,
        faction: p1Faction,
        battleFormation: p1Formation
      },
      p2: {
        name: p2Name.trim() || "Player 2",
        grandAlliance: p2Alliance,
        faction: p2Faction,
        battleFormation: p2Formation
      },
      firstTurn: round1First
    });
    startGame();
  }

  return (
    <div className="gtk gtk-page max-w-2xl mx-auto px-3 pb-28 pt-2">
      {/* Top Stepper Indicator (Matching 40k Circular Stepper) */}
      <div className="mb-6">
        <div className="flex items-center justify-center gap-1">
          {[1, 2, 3, 4].map(num => {
            const isCompleted = num < step;
            const isCurrent = num === step;

            return (
              <React.Fragment key={num}>
                <div
                  className="gtk-mono flex h-7 w-7 items-center justify-center rounded-full border text-[12px] font-bold transition-all"
                  style={
                    isCurrent
                      ? {
                          background: "var(--gtk-accent)",
                          color: "#15171b",
                          borderColor: "var(--gtk-accent)"
                        }
                      : isCompleted
                      ? {
                          background: "#1e9d52",
                          color: "#fff",
                          borderColor: "#1e9d52"
                        }
                      : {
                          color: "var(--gtk-muted)",
                          borderColor: "var(--gtk-line)",
                          background: "var(--gtk-tile)"
                        }
                  }
                >
                  {isCompleted ? <CheckIcon className="h-4 w-4" strokeWidth={3} /> : num}
                </div>
                {num < 4 && (
                  <span
                    className="h-px w-2.5"
                    style={{ background: "var(--gtk-line)" }}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Step Title & Subtitle */}
        <h2 className="gtk-h2 mt-3 text-center text-[28px] font-bold uppercase leading-tight text-white">
          {STEP_TITLES[step - 1]}
        </h2>
        <p
          className="gtk-mono mt-1 text-center text-[11px] font-bold uppercase tracking-[0.14em]"
          style={{ color: "var(--gtk-muted)" }}
        >
          Step {step} of 4 • {STEP_SUBTITLES[step - 1]}
        </p>
      </div>

      <div className="mb-6">
        {/* STEP 1: BATTLEPLAN SELECTION */}
        {step === 1 && (
          <section className="flex flex-col gap-4">
            <p className="gtk-mono text-center text-[12px] leading-snug" style={{ color: "var(--gtk-muted)" }}>
              Select an official General's Handbook 2024–2025 battleplan for scoring rules and deployment.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[460px] overflow-y-auto pr-1">
              {AOS_BATTLEPLANS.map(bp => {
                const isSelected = battleplanId === bp.id;
                return (
                  <div
                    key={bp.id}
                    onClick={() => setBattleplanId(bp.id)}
                    className="gtk-card p-3.5 cursor-pointer transition-all border rounded-[13px]"
                    style={{
                      borderColor: isSelected ? "var(--gtk-accent)" : "var(--gtk-line)",
                      background: isSelected ? "rgba(245, 158, 11, 0.08)" : "var(--gtk-tile)"
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="gtk-display text-[18px] font-bold uppercase text-white tracking-wide">
                        {bp.name}
                      </span>
                      <span
                        className="gtk-mono text-[10px] font-bold uppercase px-2 py-0.5 rounded border"
                        style={{
                          background: "var(--gtk-panel)",
                          color: "var(--gtk-accent)",
                          borderColor: "rgba(245, 158, 11, 0.3)"
                        }}
                      >
                        {bp.objectivesCount} Objs
                      </span>
                    </div>
                    <p className="text-[12px] line-clamp-2 leading-relaxed" style={{ color: "var(--gtk-muted)" }}>
                      {bp.description}
                    </p>
                    <div className="gtk-mono text-[10.5px] mt-2 font-bold uppercase" style={{ color: "var(--gtk-accent)" }}>
                      🗺️ {bp.deployment}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* STEP 2: PLAYER 1 SETUP */}
        {step === 2 && (
          <section className="flex flex-col gap-5">
            <p className="gtk-mono text-center text-[12px] leading-snug" style={{ color: "var(--gtk-muted)" }}>
              Name Player 1 and pick their Grand Alliance, Faction, and Battle Formation.
            </p>

            <div className="flex flex-col gap-2">
              <span className="gtk-mono text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "#38bdf8" }}>
                Player 1 Name
              </span>
              <input
                type="text"
                value={p1Name}
                onChange={e => setP1Name(e.target.value)}
                maxLength={24}
                placeholder="Player 1"
                aria-label="Player 1 name"
                className="gtk-display w-full rounded-[12px] border-2 px-4 py-3 text-[22px] font-bold uppercase leading-none outline-none"
                style={{
                  borderColor: "#38bdf8",
                  background: "var(--gtk-tile)",
                  color: "var(--gtk-text)"
                }}
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="gtk-mono text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--gtk-muted)" }}>
                Grand Alliance
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Object.values(GRAND_ALLIANCES).map(ga => (
                  <button
                    key={ga}
                    type="button"
                    onClick={() => {
                      setP1Alliance(ga);
                      const facs = getFactionsByAlliance(ga);
                      if (facs.length > 0) {
                        setP1Faction(facs[0].id);
                        setP1Formation(facs[0].battleFormations[0] || "");
                      }
                    }}
                    className="gtk-mono p-2.5 rounded-[12px] border text-[11px] font-bold uppercase transition-all text-center"
                    style={{
                      background: p1Alliance === ga ? "rgba(56, 189, 248, 0.12)" : "var(--gtk-tile)",
                      borderColor: p1Alliance === ga ? "#38bdf8" : "var(--gtk-line)",
                      color: p1Alliance === ga ? "#fff" : "var(--gtk-muted)",
                      borderLeftWidth: "4px",
                      borderLeftColor: GRAND_ALLIANCE_COLORS[ga]
                    }}
                  >
                    {ga}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <span className="gtk-mono text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--gtk-muted)" }}>
                  Faction
                </span>
                <select
                  value={p1Faction}
                  onChange={e => {
                    setP1Faction(e.target.value);
                    const f = AOS_FACTIONS.find(fac => fac.id === e.target.value);
                    if (f && f.battleFormations.length > 0) {
                      setP1Formation(f.battleFormations[0]);
                    }
                  }}
                  className="gtk-mono w-full rounded-[12px] border px-3 py-2.5 text-[12px] font-bold uppercase outline-none"
                  style={{
                    background: "var(--gtk-tile)",
                    borderColor: "var(--gtk-line)",
                    color: "var(--gtk-text)"
                  }}
                >
                  {p1Factions.map(f => (
                    <option key={f.id} value={f.id}>{f.icon} {f.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <span className="gtk-mono text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--gtk-muted)" }}>
                  Battle Formation
                </span>
                <select
                  value={p1Formation}
                  onChange={e => setP1Formation(e.target.value)}
                  className="gtk-mono w-full rounded-[12px] border px-3 py-2.5 text-[12px] font-bold uppercase outline-none"
                  style={{
                    background: "var(--gtk-tile)",
                    borderColor: "var(--gtk-line)",
                    color: "var(--gtk-text)"
                  }}
                >
                  {(selectedP1FacObj?.battleFormations || []).map(bf => (
                    <option key={bf} value={bf}>{bf}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>
        )}

        {/* STEP 3: PLAYER 2 SETUP */}
        {step === 3 && (
          <section className="flex flex-col gap-5">
            <p className="gtk-mono text-center text-[12px] leading-snug" style={{ color: "var(--gtk-muted)" }}>
              Name Player 2 and pick their Grand Alliance, Faction, and Battle Formation.
            </p>

            <div className="flex flex-col gap-2">
              <span className="gtk-mono text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "#ef4444" }}>
                Player 2 Name
              </span>
              <input
                type="text"
                value={p2Name}
                onChange={e => setP2Name(e.target.value)}
                maxLength={24}
                placeholder="Player 2"
                aria-label="Player 2 name"
                className="gtk-display w-full rounded-[12px] border-2 px-4 py-3 text-[22px] font-bold uppercase leading-none outline-none"
                style={{
                  borderColor: "#ef4444",
                  background: "var(--gtk-tile)",
                  color: "var(--gtk-text)"
                }}
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="gtk-mono text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--gtk-muted)" }}>
                Grand Alliance
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Object.values(GRAND_ALLIANCES).map(ga => (
                  <button
                    key={ga}
                    type="button"
                    onClick={() => {
                      setP2Alliance(ga);
                      const facs = getFactionsByAlliance(ga);
                      if (facs.length > 0) {
                        setP2Faction(facs[0].id);
                        setP2Formation(facs[0].battleFormations[0] || "");
                      }
                    }}
                    className="gtk-mono p-2.5 rounded-[12px] border text-[11px] font-bold uppercase transition-all text-center"
                    style={{
                      background: p2Alliance === ga ? "rgba(239, 68, 68, 0.12)" : "var(--gtk-tile)",
                      borderColor: p2Alliance === ga ? "#ef4444" : "var(--gtk-line)",
                      color: p2Alliance === ga ? "#fff" : "var(--gtk-muted)",
                      borderLeftWidth: "4px",
                      borderLeftColor: GRAND_ALLIANCE_COLORS[ga]
                    }}
                  >
                    {ga}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <span className="gtk-mono text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--gtk-muted)" }}>
                  Faction
                </span>
                <select
                  value={p2Faction}
                  onChange={e => {
                    setP2Faction(e.target.value);
                    const f = AOS_FACTIONS.find(fac => fac.id === e.target.value);
                    if (f && f.battleFormations.length > 0) {
                      setP2Formation(f.battleFormations[0]);
                    }
                  }}
                  className="gtk-mono w-full rounded-[12px] border px-3 py-2.5 text-[12px] font-bold uppercase outline-none"
                  style={{
                    background: "var(--gtk-tile)",
                    borderColor: "var(--gtk-line)",
                    color: "var(--gtk-text)"
                  }}
                >
                  {p2Factions.map(f => (
                    <option key={f.id} value={f.id}>{f.icon} {f.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <span className="gtk-mono text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--gtk-muted)" }}>
                  Battle Formation
                </span>
                <select
                  value={p2Formation}
                  onChange={e => setP2Formation(e.target.value)}
                  className="gtk-mono w-full rounded-[12px] border px-3 py-2.5 text-[12px] font-bold uppercase outline-none"
                  style={{
                    background: "var(--gtk-tile)",
                    borderColor: "var(--gtk-line)",
                    color: "var(--gtk-text)"
                  }}
                >
                  {(selectedP2FacObj?.battleFormations || []).map(bf => (
                    <option key={bf} value={bf}>{bf}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>
        )}

        {/* STEP 4: ROUND 1 TURN ORDER */}
        {step === 4 && (
          <section className="flex flex-col gap-5">
            <p className="gtk-mono text-center text-[12px] leading-snug" style={{ color: "var(--gtk-muted)" }}>
              The player who finished deploying first chooses who takes the first turn in Round 1.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-2">
              <div
                onClick={() => setRound1First("p1")}
                className="gtk-card p-4 cursor-pointer text-center transition-all border-2 rounded-[14px]"
                style={{
                  borderColor: round1First === "p1" ? "#38bdf8" : "var(--gtk-line)",
                  background: round1First === "p1" ? "rgba(56, 189, 248, 0.12)" : "var(--gtk-tile)"
                }}
              >
                <div
                  className="gtk-mono w-8 h-8 rounded-full mx-auto flex items-center justify-center font-bold text-sm mb-2"
                  style={{ background: "#38bdf8", color: "#070b14" }}
                >
                  1
                </div>
                <div className="gtk-display text-[20px] font-bold uppercase text-white">
                  {p1Name || "Player 1"}
                </div>
                <div className="gtk-mono text-[11px] uppercase font-bold mt-1" style={{ color: "#38bdf8" }}>
                  Takes First Turn
                </div>
              </div>

              <div
                onClick={() => setRound1First("p2")}
                className="gtk-card p-4 cursor-pointer text-center transition-all border-2 rounded-[14px]"
                style={{
                  borderColor: round1First === "p2" ? "#ef4444" : "var(--gtk-line)",
                  background: round1First === "p2" ? "rgba(239, 68, 68, 0.12)" : "var(--gtk-tile)"
                }}
              >
                <div
                  className="gtk-mono w-8 h-8 rounded-full mx-auto flex items-center justify-center font-bold text-sm mb-2"
                  style={{ background: "#ef4444", color: "#fff" }}
                >
                  2
                </div>
                <div className="gtk-display text-[20px] font-bold uppercase text-white">
                  {p2Name || "Player 2"}
                </div>
                <div className="gtk-mono text-[11px] uppercase font-bold mt-1" style={{ color: "#ef4444" }}>
                  Takes First Turn
                </div>
              </div>
            </div>

            <div
              className="gtk-card p-3 rounded-[12px] border text-[11.5px] flex items-center gap-2.5"
              style={{ background: "var(--gtk-tile)", borderColor: "var(--gtk-line)", color: "var(--gtk-muted)" }}
            >
              <span className="text-base">💡</span>
              <span>The player taking the <strong>second turn</strong> in Round 1 receives <strong>+1 bonus Command Point (2 CP total)</strong>.</span>
            </div>
          </section>
        )}
      </div>

      {/* Sticky Bottom Navigation Bar (Matching 40k) */}
      <div
        className="fixed bottom-0 left-0 right-0 z-20 border-t p-3 backdrop-blur-md"
        style={{
          background: "rgba(10, 12, 16, 0.95)",
          borderColor: "var(--gtk-line)"
        }}
      >
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep(prev => prev - 1)}
              className="gtk-display rounded-[12px] border px-6 py-2.5 text-[15px] font-bold uppercase tracking-wider transition-colors"
              style={{ borderColor: "var(--gtk-line)", color: "var(--gtk-muted)" }}
            >
              ← Back
            </button>
          ) : (
            <div />
          )}

          {step === 1 && (
            <button
              type="button"
              onClick={() => setStep(2)}
              className="gtk-display flex-1 sm:flex-initial rounded-[12px] px-8 py-2.5 text-[16px] font-bold uppercase tracking-wider text-black transition-all shadow-md"
              style={{ background: "var(--gtk-accent)" }}
            >
              Next: Player 1 →
            </button>
          )}

          {step === 2 && (
            <button
              type="button"
              onClick={() => setStep(3)}
              className="gtk-display flex-1 sm:flex-initial rounded-[12px] px-8 py-2.5 text-[16px] font-bold uppercase tracking-wider text-black transition-all shadow-md"
              style={{ background: "var(--gtk-accent)" }}
            >
              Next: Player 2 →
            </button>
          )}

          {step === 3 && (
            <button
              type="button"
              onClick={() => setStep(4)}
              className="gtk-display flex-1 sm:flex-initial rounded-[12px] px-8 py-2.5 text-[16px] font-bold uppercase tracking-wider text-black transition-all shadow-md"
              style={{ background: "var(--gtk-accent)" }}
            >
              Next: Round 1 →
            </button>
          )}

          {step === 4 && (
            <button
              type="button"
              onClick={handleFinish}
              className="gtk-display flex-1 sm:flex-initial rounded-[12px] px-8 py-2.5 text-[16px] font-bold uppercase tracking-wider text-black transition-all shadow-md"
              style={{ background: "var(--gtk-accent)" }}
            >
              ⚔️ Start Age of Sigmar Match
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
