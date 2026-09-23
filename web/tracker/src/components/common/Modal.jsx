import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function Modal({ isOpen = true, onClose, ariaLabel, children, maxWidth = "560px" }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = e => {
      if (e.key === "Escape" && onClose) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!mounted || !isOpen) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={onClose}
      className="fixed inset-0 flex items-center justify-center p-3 sm:p-6"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100050,
        background: "rgba(4, 6, 10, 0.85)",
        backdropFilter: "blur(5px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "12px"
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex w-full flex-col overflow-hidden rounded-[16px] border shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
        style={{
          width: "100%",
          maxWidth,
          maxHeight: "calc(100dvh - 24px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--gtk-panel, #12161f)",
          borderColor: "var(--gtk-line, #273042)"
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
