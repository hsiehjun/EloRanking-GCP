import React, { useState } from "react";
import { useTracker } from "../../context/TrackerContext.jsx";
import { getMatchupTerrain, getShowMeasurements, setShowMeasurements } from "../../data/terrainLayouts.js";
import { CardImageModal } from "../common/CardImageModal.jsx";
import { InfoIcon, CheckIcon, ChevronRightIcon } from "../common/Icons.jsx";

export function Step4Terrain() {
  const { state, selectTerrainLayout } = useTracker();
  const game = state.game;
  const [viewingLayout, setViewingLayout] = useState(null);
  const [measurements, setMeasurements] = useState(getShowMeasurements);

  const matchup = game.p1Disposition && game.p2Disposition
    ? getMatchupTerrain(game.p1Disposition, game.p2Disposition)
    : null;

  if (!matchup) {
    return (
      <div className="py-8 text-center gtk-mono text-[12px]" style={{ color: "var(--gtk-muted)" }}>
        Please select Force Dispositions in step 3 to view recommended terrain layouts.
      </div>
    );
  }

  const selectedLayoutObj = matchup.layouts.find(l => l.number === game.terrainLayout);

  const toggleMeasurements = () => {
    const next = !measurements;
    setMeasurements(next);
    setShowMeasurements(next);
  };

  return (
    <section className="flex flex-col gap-4">
      <p
        className="gtk-mono text-center text-[12px] leading-snug"
        style={{ color: "var(--gtk-muted)" }}
      >
        These are the recommended terrain layouts for your matchup — pick the one on your table,
        or skip this step if you create your own battlefield layout.
      </p>

      {/* Info Notice */}
      <div
        role="note"
        className="flex items-start gap-3 rounded-xl border p-3.5 text-left"
        style={{
          borderColor: "var(--gtk-line)",
          background: "var(--gtk-tile)",
          color: "var(--gtk-text)"
        }}
      >
        <InfoIcon className="mt-0.5 h-5 w-5 flex-none" style={{ color: "#3b82f6" }} />
        <p className="gtk-mono text-[13px] leading-snug">
          The terrain layouts come from{" "}
          <a
            href="https://battlemaster.online"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline underline-offset-2"
          >
            Battlemaster
          </a>{" "}
          and match official layouts.
        </p>
      </div>

      {/* 3 Layout Thumbnails */}
      <div className="grid grid-cols-3 gap-3">
        {matchup.layouts.map(layout => {
          const isSelected = game.terrainLayout === layout.number;
          return (
            <button
              key={layout.number}
              type="button"
              aria-pressed={isSelected}
              onClick={() => selectTerrainLayout(isSelected ? null : layout.number)}
              className="flex flex-col items-center gap-2 rounded-[12px] border-2 p-2 transition-colors"
              style={{
                borderColor: isSelected ? "var(--gtk-accent)" : "var(--gtk-line)",
                background: isSelected
                  ? "color-mix(in srgb, var(--gtk-accent) 15%, transparent)"
                  : "var(--gtk-tile)"
              }}
            >
              <div className="w-full aspect-[9/16] overflow-hidden rounded-[8px] bg-black/25 flex items-center justify-center">
                <img
                  src={layout.image}
                  alt={`Layout ${layout.number}`}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="gtk-mono text-[11px] font-bold uppercase tracking-[0.1em]">
                  Layout {layout.number}
                </span>
                {isSelected && (
                  <CheckIcon className="h-4 w-4" style={{ color: "var(--gtk-accent)" }} />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Detailed Layout Card Preview */}
      {selectedLayoutObj && (
        <button
          type="button"
          onClick={() => setViewingLayout(selectedLayoutObj)}
          className="gtk-card mt-2 flex w-full items-center justify-between gap-3.5 p-3 text-left rounded-[12px] border-2 transition-colors hover:border-[var(--gtk-accent)]"
          style={{ borderColor: "var(--gtk-line)", background: "var(--gtk-tile)" }}
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-10 aspect-[9/16] flex-none overflow-hidden rounded-[6px] border border-[var(--gtk-line)] bg-black/30">
              <img
                src={selectedLayoutObj.image}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <p
                className="gtk-mono truncate text-[10px] font-bold uppercase tracking-[0.14em]"
                style={{ color: "var(--gtk-muted)" }}
              >
                Terrain Layout
              </p>
              <p className="gtk-display text-[19px] sm:text-[20px] font-bold uppercase leading-tight truncate">
                {matchup.name} · {selectedLayoutObj.number}
              </p>
            </div>
          </div>
          <span
            className="gtk-mono flex flex-none items-center gap-1 text-[11px] font-bold uppercase tracking-[0.12em]"
            style={{ color: "var(--gtk-muted)" }}
          >
            View <ChevronRightIcon className="h-4 w-4" />
          </span>
        </button>
      )}

      {/* Modal image viewer */}
      {viewingLayout && (
        <CardImageModal
          front={viewingLayout.image}
          back={viewingLayout.measurementsImage}
          title={`${matchup.name} · Layout ${viewingLayout.number}`}
          borderColor="var(--gtk-accent, #38bdf8)"
          showMeasurementsToggle
          measurementsEnabled={measurements}
          onToggleMeasurements={toggleMeasurements}
          onClose={() => setViewingLayout(null)}
        />
      )}
    </section>
  );
}
