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

  return (
    <div className="min-h-screen flex flex-col font-sans">
      {/* Main Content: Isolated Setup Wizard OR Isolated Scorecard */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-2 sm:p-4">
        {activeView === "setup" ? (
          <GameSetupWizard onGameStarted={() => setOverrideView("scorecard")} />
        ) : (
          <BattleScorecard />
        )}
      </main>
    </div>
  );
}
