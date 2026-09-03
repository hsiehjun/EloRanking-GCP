import React, { useState } from "react";
import { useTracker } from "../../context/TrackerContext.jsx";
import { Step1Players } from "./Step1Players.jsx";
import { Step2Detachments } from "./Step2Detachments.jsx";
import { Step3Dispositions } from "./Step3Dispositions.jsx";
import { Step4Terrain } from "./Step4Terrain.jsx";
import { Step5Roles } from "./Step5Roles.jsx";
import { Step6DeckType } from "./Step6DeckType.jsx";
import { Step7FirstTurn } from "./Step7FirstTurn.jsx";
import { CheckIcon, ArrowLeftIcon, ArrowRightIcon } from "../common/Icons.jsx";

const STEP_TITLES = [
  "Players",
  "Detachments",
  "Force Disposition",
  "Create the Battlefield",
  "Attacker / Defender",
  "Secondary Mission Type",
  "First Turn"
];

const STEP_SUBTITLES = {
  5: "Both players roll a D6 · Highest wins · Re-roll ties",
  7: "Both players roll a D6 · Highest wins · Re-roll ties"
};

export function GameSetupWizard({ onGameStarted }) {
  const { state, setPlayerName, startGame } = useTracker();
  const game = state.game;
  const [step, setStep] = useState(1);

  // Check whether current step allows proceeding
  const canProceed = {
    1: true,
    2: true,
    3: !!game.p1Disposition && !!game.p2Disposition,
    4: true,
    5: !!game.p1Role || !!game.p2Role,
    6: !!game.p1MissionType && !!game.p2MissionType,
    7: !!game.rollOffWinner && !!game.firstTurn
  }[step];

  const isLastStep = step === 7;

  const handleNext = () => {
    if (!canProceed) return;

    if (step === 1) {
      if (!(game.p1Name || "").trim()) setPlayerName(1, "Player 1");
      if (!(game.p2Name || "").trim()) setPlayerName(2, "Player 2");
    }

    if (isLastStep) {
      startGame();
      if (onGameStarted) onGameStarted();
    } else {
      setStep(prev => Math.min(7, prev + 1));
    }
  };

  const handleBack = () => {
    setStep(prev => Math.max(1, prev - 1));
  };

  return (
    <div className="gtk gtk-page max-w-2xl mx-auto px-3 pb-28 pt-2">
      {/* Top Stepper Indicator */}
      <div className="mb-6">
        <div className="flex items-center justify-center gap-1">
          {Array.from({ length: 7 }, (_, i) => i + 1).map(num => {
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
                {num < 7 && (
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
        <h2 className="gtk-h2 mt-3 text-center text-[28px] font-bold uppercase leading-tight">
          {STEP_TITLES[step - 1]}
        </h2>
        <p
          className="gtk-mono mt-1 text-center text-[11px] font-bold uppercase tracking-[0.14em]"
          style={{ color: "var(--gtk-muted)" }}
        >
          Step {step} of 7
        </p>
        {STEP_SUBTITLES[step] && (
          <p
            className="gtk-mono mt-1 text-center text-[10.5px] font-bold uppercase tracking-[0.12em]"
            style={{ color: "var(--gtk-accent)" }}
          >
            {STEP_SUBTITLES[step]}
          </p>
        )}
      </div>

      {/* Step Content */}
      <div className="mb-6">
        {step === 1 && <Step1Players />}
        {step === 2 && <Step2Detachments />}
        {step === 3 && <Step3Dispositions />}
        {step === 4 && <Step4Terrain />}
        {step === 5 && <Step5Roles />}
        {step === 6 && <Step6DeckType />}
        {step === 7 && <Step7FirstTurn />}
      </div>

      {/* Fixed Bottom Navigation Bar */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t px-4 pt-3.5"
        style={{
          background: "var(--gtk-panel)",
          borderColor: "var(--gtk-line)",
          paddingBottom: "calc(14px + env(safe-area-inset-bottom))",
          boxShadow: "0 -10px 30px rgba(0,0,0,.22)"
        }}
      >
        <div className="mx-auto flex max-w-[540px] items-center gap-3 md:max-w-[720px]">
          <button
            type="button"
            onClick={handleBack}
            disabled={step === 1}
            className="flex h-12 flex-none items-center justify-center gap-2 rounded-[11px] border-2 px-5 font-mono text-[13px] font-bold uppercase tracking-[0.12em] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              borderColor: "var(--gtk-line)",
              color: "var(--gtk-text)"
            }}
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back
          </button>

          <button
            type="button"
            onClick={handleNext}
            disabled={!canProceed}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[11px] px-6 font-mono text-[14px] font-bold uppercase tracking-[0.12em] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "var(--gtk-accent)",
              color: "#15171b"
            }}
          >
            {isLastStep ? "Start Game" : "Next"}
            <ArrowRightIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
