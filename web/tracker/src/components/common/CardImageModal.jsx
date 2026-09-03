import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./Icons.jsx";

export function CardImageModal({
  front,
  back,
  alt = "Card Image",
  title,
  borderColor = "#3b82f6",
  onClose,
  showMeasurementsToggle = false,
  measurementsEnabled = false,
  onToggleMeasurements
}) {
  const [mounted, setMounted] = useState(false);
  const [showingBack, setShowingBack] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = e => {
      if (e.key === "Escape" && onClose) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = original;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Preload front and back images for instant switching without flicker
  useEffect(() => {
    if (front) {
      const img = new Image();
      img.src = front;
    }
    if (back) {
      const img = new Image();
      img.src = back;
    }
  }, [front, back]);

  if (!mounted) return null;

  const currentImage = showMeasurementsToggle
    ? (measurementsEnabled && back ? back : front)
    : (showingBack && back ? back : front);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title || alt}
      onClick={onClose}
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 overflow-y-auto bg-black/90 p-4 backdrop-blur-sm"
    >
      {/* Title Header */}
      <div
        className="text-center font-mono text-[12px] font-bold uppercase tracking-[0.14em]"
        style={{ color: borderColor || "#fff" }}
      >
        {title || alt}
      </div>

      {/* Card Image Container */}
      <div
        onClick={e => e.stopPropagation()}
        className="relative flex items-center justify-center max-h-[72vh] sm:max-h-[80vh] max-w-[95vw]"
      >
        <img
          key={currentImage}
          src={currentImage}
          alt={alt}
          className="max-h-[68vh] sm:max-h-[76vh] w-auto rounded-[12px] border-2 shadow-2xl object-contain transition-all"
          style={{ borderColor: borderColor || "#fff" }}
        />
      </div>

      {/* Controls: Back/Front flip, Measurements toggle, Close */}
      <div
        onClick={e => e.stopPropagation()}
        className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 px-2 pb-2"
      >
        {!showMeasurementsToggle && back && (
          <button
            type="button"
            onClick={() => setShowingBack(prev => !prev)}
            className="flex items-center gap-2 rounded-full px-4 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-white transition-colors hover:bg-white/25"
            style={{
              background: "rgba(255,255,255,0.18)",
              border: "1px solid rgba(255,255,255,0.35)"
            }}
          >
            {showingBack ? "View Front" : "View Back"}
          </button>
        )}

        {showMeasurementsToggle && onToggleMeasurements && (
          <button
            type="button"
            onClick={onToggleMeasurements}
            aria-pressed={measurementsEnabled}
            className="flex items-center gap-2 rounded-full px-4 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-white transition-all hover:brightness-110 active:scale-95"
            style={{
              background: measurementsEnabled ? "#2563eb" : "rgba(255,255,255,0.18)",
              border: measurementsEnabled ? "1px solid #60a5fa" : "1px solid rgba(255,255,255,0.35)",
              boxShadow: measurementsEnabled ? "0 0 12px rgba(37, 99, 235, 0.45)" : "none"
            }}
          >
            <span
              className="inline-block h-2 w-2 rounded-full transition-colors"
              style={{ background: measurementsEnabled ? "#60a5fa" : "rgba(255,255,255,0.4)" }}
            />
            {measurementsEnabled ? "Measurements: On" : "Measurements: Off"}
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 rounded-full px-5 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-white/25"
          style={{
            background: "rgba(255,255,255,0.14)",
            border: "1px solid rgba(255,255,255,0.3)"
          }}
        >
          <CloseIcon className="h-4 w-4" />
          Close
        </button>
      </div>
    </div>,
    document.body
  );
}
