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
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6"
      style={{
        background: "rgba(4, 6, 10, 0.72)",
        backdropFilter: "blur(3px)"
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex max-h-full w-full flex-col overflow-hidden rounded-[16px] border shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
        style={{
          maxWidth,
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
