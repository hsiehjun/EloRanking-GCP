import React from "react";
import { useAosTracker } from "./context/AosTrackerContext.jsx";
import { AosSetupWizard } from "./components/setup/AosSetupWizard.jsx";
import { AosBattleScorecard } from "./components/scorecard/AosBattleScorecard.jsx";

export function AosApp() {
  const { state } = useAosTracker();

  return (
    <div className="min-h-screen bg-[#070b14] text-[#f0f4fc]">
      {!state.started ? <AosSetupWizard /> : <AosBattleScorecard />}
    </div>
  );
}
