import React, { useRef, useState, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { SecondaryCardGraphic } from "./SecondaryCardGraphic.jsx";
import { getSecondaryCardName } from "../../data/secondaryMissions.js";
import { CloseIcon, UndoIcon } from "../common/Icons.jsx";

export function SecondaryCardModal({ card, mode = "tactical", onRestore, onClose }) {
  const containerRef = useRef(null);
  const [mounted, setMounted] = useState(false);
  const [scale, setScale] = useState(0.65);

  const cardName = getSecondaryCardName(card.cardId);

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

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateScale = () => {
      const width = el.clientWidth;
      if (width > 0) {
        setScale(Math.min((width - 24) / 580, 0.85));
      }
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!mounted) return null;

  const statusLabel =
    card.status === "discarded"
      ? `Discarded · R${card.discardedRound}`
      : card.scoredRound != null
      ? `Scored +${card.points} VP · R${card.scoredRound}`
      : "Held";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${cardName} card`}
      className="fixed inset-0 z-[70] flex flex-col bg-black/85 backdrop-blur-sm"
    >
      {/* Header status */}
      <div className="flex flex-none items-center justify-center px-4 py-3">
        <span className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-white/80">
          {statusLabel}
        </span>
      </div>

      {/* Scaled Card Graphic */}
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto px-3 pb-4"
      >
        <div
          style={{ width: scale * 580, height: scale * 994 }}
          className="flex-none shadow-2xl rounded-[16px] overflow-hidden"
        >
          <div
            className="gd11-cardfit"
            style={{
              width: 580,
              height: 994,
              transform: `scale(${scale})`,
              transformOrigin: "top left"
            }}
          >
            <SecondaryCardGraphic slug={card.cardId} role={card.side} mode={mode} />
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex flex-none items-center gap-3 pb-4">
          {onRestore && card.status === "discarded" && (
            <button
              type="button"
              onClick={() => onRestore(card.instanceId)}
              className="flex items-center gap-2 rounded-full px-5 py-2.5 font-mono text-[13px] font-bold uppercase tracking-[0.1em] text-white transition-all hover:brightness-110"
              style={{ background: "#1e9d52" }}
            >
              <UndoIcon className="h-4 w-4" />
              Restore
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 rounded-full px-5 py-2.5 font-mono text-[13px] font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-white/25"
            style={{
              background: "rgba(255,255,255,0.14)",
              border: "1px solid rgba(255,255,255,0.3)"
            }}
          >
            <CloseIcon className="h-4 w-4" />
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
