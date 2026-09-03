import React, { useState, useEffect } from "react";
import { useTracker } from "./context/TrackerContext.jsx";
import { GameSetupWizard } from "./components/setup/GameSetupWizard.jsx";
import { BattleScorecard } from "./components/scorecard/BattleScorecard.jsx";

export function App() {
  const { state, loaded } = useTracker();

  // Read view mode from URL hash or query: '#setup', '#scorecard'
  const getViewFromLocation = () => {
    if (typeof window === "undefined") return "auto";
    const hash = window.location.hash.toLowerCase();
    const search = window.location.search.toLowerCase();
    if (hash === "#setup" || search.includes("view=setup")) return "setup";
    if (hash === "#scorecard" || search.includes("view=scorecard")) return "scorecard";
    return "auto";
  };

  const [overrideView, setOverrideView] = useState(getViewFromLocation);

  useEffect(() => {
    const onLocationChange = () => setOverrideView(getViewFromLocation());
    window.addEventListener("hashchange", onLocationChange);
    window.addEventListener("popstate", onLocationChange);
    return () => {
      window.removeEventListener("hashchange", onLocationChange);
      window.removeEventListener("popstate", onLocationChange);
    };
  }, []);

  if (!loaded) {
    return <div className="min-h-screen" aria-hidden="true" />;
  }

  const activeView =
    overrideView === "auto"
      ? state.started
        ? "scorecard"
        : "setup"
      : overrideView;

  const handleSelectView = view => {
    setOverrideView(view);
    window.location.hash = view === "auto" ? "" : view;
  };

  return (
    <div className="min-h-screen flex flex-col font-sans">
      {/* Minimal clean mode switcher bar - NO headers, no branding, isolated module selector */}
      <header
        className="sticky top-0 z-50 flex items-center justify-between border-b px-4 py-2.5 backdrop-blur-md transition-colors"
        style={{
          background: "rgba(237, 234, 226, 0.94)",
          borderColor: "var(--gtk-line)"
        }}
      >
        <div
          className="flex items-center gap-1 p-0.5 rounded-lg border"
          style={{
            borderColor: "var(--gtk-line)",
            background: "var(--gtk-tile)"
          }}
        >
          <button
            type="button"
            onClick={() => handleSelectView("setup")}
            className="px-3.5 py-1.5 rounded-md font-mono text-[12px] font-bold uppercase tracking-[0.1em] transition-all"
            style={
              activeView === "setup"
                ? {
                    background: "var(--gtk-accent)",
                    color: "#15171b"
                  }
                : {
                    color: "var(--gtk-muted)"
                  }
            }
          >
            7-Step Setup
          </button>
          <button
            type="button"
            onClick={() => handleSelectView("scorecard")}
            className="px-3.5 py-1.5 rounded-md font-mono text-[12px] font-bold uppercase tracking-[0.1em] transition-all"
            style={
              activeView === "scorecard"
                ? {
                    background: "var(--gtk-accent)",
                    color: "#15171b"
                  }
                : {
                    color: "var(--gtk-muted)"
                  }
            }
          >
            Score Keeping
          </button>
        </div>

        <div className="flex items-center gap-3">
          {state.started && activeView === "setup" && (
            <button
              type="button"
              onClick={() => handleSelectView("scorecard")}
              className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] underline cursor-pointer"
              style={{ color: "var(--gtk-accent)" }}
            >
              Resume Match &rarr;
            </button>
          )}
          <span
            className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: "var(--gtk-muted)" }}
          >
            {activeView === "setup" ? "Setup Wizard" : `Round ${state.round} · Scorekeeper`}
          </span>
        </div>
      </header>

      {/* Main Content: Isolated Setup Wizard OR Isolated Scorecard */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-2 sm:p-4">
        {activeView === "setup" ? (
          <GameSetupWizard onGameStarted={() => handleSelectView("scorecard")} />
        ) : (
          <BattleScorecard />
        )}
      </main>
    </div>
  );
}
