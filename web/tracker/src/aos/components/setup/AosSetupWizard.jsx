import React, { useState } from "react";
import { useAosTracker } from "../../context/AosTrackerContext.jsx";
import { AOS_BATTLEPLANS } from "../../data/aosBattleplans.js";
import { AOS_FACTIONS, getFactionsByAlliance } from "../../data/aosFactions.js";
import { GRAND_ALLIANCES, GRAND_ALLIANCE_COLORS } from "../../data/aosConstants.js";
import { SwordsIcon, ShieldIcon } from "../common/Icons.jsx";

export function AosSetupWizard() {
  const { state, updateGameSetup, startGame } = useAosTracker();
  const [step, setStep] = useState(1);

  // Local form state
  const [battleplanId, setBattleplanId] = useState(state.battleplan?.id || AOS_BATTLEPLANS[0].id);
  const [p1Name, setP1Name] = useState(state.p1.name);
  const [p1Alliance, setP1Alliance] = useState(state.p1.grandAlliance || "Order");
  const [p1Faction, setP1Faction] = useState(state.p1.faction || "stormcast-eternals");
  const [p1Formation, setP1Formation] = useState(state.p1.battleFormation || "Lightning Echelon");

  const [p2Name, setP2Name] = useState(state.p2.name);
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
      }
    });
    startGame();
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      {/* Wizard Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#181d28] border border-[#273042] text-xs font-mono text-[#f59e0b] mb-3">
          ⚡ AGE OF SIGMAR 4TH EDITION • MATCHED PLAY
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
          Game Setup Wizard
        </h1>
        <p className="text-xs sm:text-sm text-[#94a3b8] mt-1">
          Configure battleplan, grand alliances, and battle formations
        </p>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2 mt-6">
          {[1, 2, 3, 4].map(s => (
            <div
              key={s}
              className={`h-2 rounded-full transition-all ${
                s === step ? "w-8 bg-[#f59e0b]" : s < step ? "w-5 bg-[#10b981]" : "w-5 bg-[#273042]"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="bg-[#12161f] border border-[#273042] rounded-2xl p-5 sm:p-7 shadow-xl">
        {/* STEP 1: BATTLEPLAN SELECTION */}
        {step === 1 && (
          <div>
            <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
              📜 Step 1: Select General's Handbook Battleplan
            </h2>
            <p className="text-xs text-[#94a3b8] mb-5">
              Select the matched play battleplan for objective scoring criteria and layout.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
              {AOS_BATTLEPLANS.map(bp => (
                <div
                  key={bp.id}
                  onClick={() => setBattleplanId(bp.id)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    battleplanId === bp.id
                      ? "bg-[#181d28] border-[#f59e0b] ring-1 ring-[#f59e0b]"
                      : "bg-[#0e131d] border-[#273042] hover:border-[#38bdf8]"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-white text-sm">{bp.name}</span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#12161f] text-[#38bdf8] border border-[#273042]">
                      {bp.objectivesCount} Objectives
                    </span>
                  </div>
                  <p className="text-xs text-[#94a3b8] line-clamp-2">{bp.description}</p>
                  <div className="mt-2 text-[11px] text-[#f59e0b] font-mono">
                    🗺️ {bp.deployment}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setStep(2)}
                className="px-5 py-2.5 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-black font-bold text-sm transition-all"
              >
                Next: Player 1 Setup →
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: PLAYER 1 SETUP */}
        {step === 2 && (
          <div>
            <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#3b82f6]"></span> Step 2: Player 1 (Blue)
            </h2>
            <p className="text-xs text-[#94a3b8] mb-5">
              Choose Player 1's name, Grand Alliance, Faction, and Battle Formation.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-[#94a3b8] mb-1.5 uppercase">Player Name</label>
                <input
                  type="text"
                  value={p1Name}
                  onChange={e => setP1Name(e.target.value)}
                  className="w-full bg-[#0e131d] border border-[#273042] rounded-xl px-3.5 py-2 text-white text-sm focus:outline-none focus:border-[#38bdf8]"
                  placeholder="e.g. Innes Wilson"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-[#94a3b8] mb-1.5 uppercase">Grand Alliance</label>
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
                      className={`p-2.5 rounded-xl border text-xs font-bold transition-all text-center ${
                        p1Alliance === ga
                          ? "bg-[#181d28] border-[#38bdf8] text-white"
                          : "bg-[#0e131d] border-[#273042] text-[#94a3b8] hover:text-white"
                      }`}
                      style={{ borderLeftColor: GRAND_ALLIANCE_COLORS[ga], borderLeftWidth: "4px" }}
                    >
                      {ga}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono text-[#94a3b8] mb-1.5 uppercase">Faction</label>
                  <select
                    value={p1Faction}
                    onChange={e => {
                      setP1Faction(e.target.value);
                      const f = AOS_FACTIONS.find(fac => fac.id === e.target.value);
                      if (f && f.battleFormations.length > 0) {
                        setP1Formation(f.battleFormations[0]);
                      }
                    }}
                    className="w-full bg-[#0e131d] border border-[#273042] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#38bdf8]"
                  >
                    {p1Factions.map(f => (
                      <option key={f.id} value={f.id}>{f.icon} {f.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono text-[#94a3b8] mb-1.5 uppercase">Battle Formation</label>
                  <select
                    value={p1Formation}
                    onChange={e => setP1Formation(e.target.value)}
                    className="w-full bg-[#0e131d] border border-[#273042] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#38bdf8]"
                  >
                    {(selectedP1FacObj?.battleFormations || []).map(bf => (
                      <option key={bf} value={bf}>{bf}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-between">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2 rounded-xl border border-[#273042] text-sm text-[#94a3b8] hover:text-white"
              >
                ← Back
              </button>
              <button
                onClick={() => setStep(3)}
                className="px-5 py-2.5 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-black font-bold text-sm transition-all"
              >
                Next: Player 2 Setup →
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: PLAYER 2 SETUP */}
        {step === 3 && (
          <div>
            <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#ef4444]"></span> Step 3: Player 2 (Red)
            </h2>
            <p className="text-xs text-[#94a3b8] mb-5">
              Choose Player 2's name, Grand Alliance, Faction, and Battle Formation.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-[#94a3b8] mb-1.5 uppercase">Player Name</label>
                <input
                  type="text"
                  value={p2Name}
                  onChange={e => setP2Name(e.target.value)}
                  className="w-full bg-[#0e131d] border border-[#273042] rounded-xl px-3.5 py-2 text-white text-sm focus:outline-none focus:border-[#38bdf8]"
                  placeholder="e.g. David Gaylard"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-[#94a3b8] mb-1.5 uppercase">Grand Alliance</label>
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
                      className={`p-2.5 rounded-xl border text-xs font-bold transition-all text-center ${
                        p2Alliance === ga
                          ? "bg-[#181d28] border-[#38bdf8] text-white"
                          : "bg-[#0e131d] border-[#273042] text-[#94a3b8] hover:text-white"
                      }`}
                      style={{ borderLeftColor: GRAND_ALLIANCE_COLORS[ga], borderLeftWidth: "4px" }}
                    >
                      {ga}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono text-[#94a3b8] mb-1.5 uppercase">Faction</label>
                  <select
                    value={p2Faction}
                    onChange={e => {
                      setP2Faction(e.target.value);
                      const f = AOS_FACTIONS.find(fac => fac.id === e.target.value);
                      if (f && f.battleFormations.length > 0) {
                        setP2Formation(f.battleFormations[0]);
                      }
                    }}
                    className="w-full bg-[#0e131d] border border-[#273042] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#38bdf8]"
                  >
                    {p2Factions.map(f => (
                      <option key={f.id} value={f.id}>{f.icon} {f.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono text-[#94a3b8] mb-1.5 uppercase">Battle Formation</label>
                  <select
                    value={p2Formation}
                    onChange={e => setP2Formation(e.target.value)}
                    className="w-full bg-[#0e131d] border border-[#273042] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#38bdf8]"
                  >
                    {(selectedP2FacObj?.battleFormations || []).map(bf => (
                      <option key={bf} value={bf}>{bf}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-between">
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2 rounded-xl border border-[#273042] text-sm text-[#94a3b8] hover:text-white"
              >
                ← Back
              </button>
              <button
                onClick={() => setStep(4)}
                className="px-5 py-2.5 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-black font-bold text-sm transition-all"
              >
                Next: Round 1 Turn Order →
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: ROUND 1 TURN ORDER */}
        {step === 4 && (
          <div>
            <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
              🎲 Step 4: Round 1 Priority & Turn Order
            </h2>
            <p className="text-xs text-[#94a3b8] mb-5">
              In AoS 4th Edition, the player who finished deploying first chooses who takes the first turn in Round 1.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-6">
              <div
                onClick={() => setRound1First("p1")}
                className={`p-4 rounded-xl border cursor-pointer text-center transition-all ${
                  round1First === "p1"
                    ? "bg-[#181d28] border-[#3b82f6] ring-1 ring-[#3b82f6]"
                    : "bg-[#0e131d] border-[#273042]"
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-[#3b82f6]/20 text-[#3b82f6] mx-auto flex items-center justify-center font-bold text-lg mb-2">
                  1
                </div>
                <div className="font-bold text-white text-sm">{p1Name || "Player 1"}</div>
                <div className="text-xs text-[#38bdf8] font-mono mt-1">Takes First Turn</div>
              </div>

              <div
                onClick={() => setRound1First("p2")}
                className={`p-4 rounded-xl border cursor-pointer text-center transition-all ${
                  round1First === "p2"
                    ? "bg-[#181d28] border-[#ef4444] ring-1 ring-[#ef4444]"
                    : "bg-[#0e131d] border-[#273042]"
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-[#ef4444]/20 text-[#ef4444] mx-auto flex items-center justify-center font-bold text-lg mb-2">
                  2
                </div>
                <div className="font-bold text-white text-sm">{p2Name || "Player 2"}</div>
                <div className="text-xs text-[#ef4444] font-mono mt-1">Takes First Turn</div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#0e131d] border border-[#273042] text-xs text-[#94a3b8] flex items-center gap-3">
              <span className="text-lg">💡</span>
              <span>The player taking the <strong>second turn</strong> in Round 1 will receive <strong>+1 bonus Command Point (2 CP total)</strong>.</span>
            </div>

            <div className="mt-8 flex justify-between">
              <button
                onClick={() => setStep(3)}
                className="px-4 py-2 rounded-xl border border-[#273042] text-sm text-[#94a3b8] hover:text-white"
              >
                ← Back
              </button>
              <button
                onClick={handleFinish}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-[#f59e0b] to-[#d97706] text-black font-black text-sm tracking-wide shadow-lg hover:brightness-110 transition-all"
              >
                ⚔️ Start Age of Sigmar Match
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
