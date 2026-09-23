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
    <section className="flex flex-col gap-2.5">
      <p
        className="gtk-mono text-center text-[11px] leading-snug"
        style={{ color: "var(--gtk-muted)" }}
      >
        Pick a recommended terrain layout for your matchup, or skip for custom layout.
      </p>

      {/* Info Notice */}
      <div
        role="note"
        className="flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left"
        style={{
          borderColor: "var(--gtk-line)",
          background: "var(--gtk-tile)",
          color: "var(--gtk-text)"
        }}
      >
        <InfoIcon className="h-4 w-4 flex-none" style={{ color: "#3b82f6" }} />
        <p className="gtk-mono text-[11.5px] leading-snug">
          Terrain layouts from{" "}
          <a
            href="https://battlemaster.online"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline underline-offset-2"
          >
            Battlemaster
          </a>{" "}
          matching official competitive layouts.
        </p>
      </div>

      {/* 3 Layout Thumbnails Header & Measurements Toggle */}
      <div className="flex items-center justify-between px-0.5">
        <span className="gtk-mono text-[10.5px] font-bold text-[var(--gtk-muted)] uppercase tracking-wider">
          Recommended Layouts
        </span>
        <button
          type="button"
          onClick={toggleMeasurements}
          aria-pressed={measurements}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em] transition-all hover:brightness-110 active:scale-95"
          style={{
            background: measurements ? "#2563eb" : "rgba(255,255,255,0.08)",
            border: measurements ? "1px solid #60a5fa" : "1px solid var(--gtk-line)",
            color: "#fff",
            boxShadow: measurements ? "0 0 10px rgba(37, 99, 235, 0.4)" : "none"
          }}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full transition-colors"
            style={{ background: measurements ? "#60a5fa" : "rgba(255,255,255,0.4)" }}
          />
          {measurements ? "Measurements: On" : "Measurements: Off"}
        </button>
      </div>

      {/* 3 Layout Thumbnails */}
      <div className="grid grid-cols-3 gap-2.5">
        {matchup.layouts.map(layout => {
          const isSelected = game.terrainLayout === layout.number;
          return (
            <button
              key={layout.number}
              type="button"
              aria-pressed={isSelected}
              onClick={() => selectTerrainLayout(isSelected ? null : layout.number)}
              className="flex flex-col items-center gap-1.5 rounded-[10px] border-2 p-1.5 transition-colors"
              style={{
                borderColor: isSelected ? "var(--gtk-accent)" : "var(--gtk-line)",
                background: isSelected
                  ? "color-mix(in srgb, var(--gtk-accent) 15%, transparent)"
                  : "var(--gtk-tile)"
              }}
            >
              <div
                className="w-full overflow-hidden rounded-[7px] bg-black/25 flex items-center justify-center"
                style={{ maxHeight: "145px" }}
              >
                <img
                  src={measurements ? layout.measurementsImage : layout.image}
                  alt={`Layout ${layout.number}`}
                  loading="lazy"
                  className="w-full h-full object-contain"
                  style={{ maxHeight: "145px" }}
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="gtk-mono text-[10.5px] font-bold uppercase tracking-[0.08em]">
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
                src={measurements ? selectedLayoutObj.measurementsImage : selectedLayoutObj.image}
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
