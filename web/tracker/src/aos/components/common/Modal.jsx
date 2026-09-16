import React, { useEffect } from "react";

export function Modal({ isOpen, onClose, title, children, maxWidth = "max-w-xl", footer = null }) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape" && isOpen && onClose) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      style={{ backgroundColor: "rgba(7, 11, 20, 0.85)", backdropFilter: "blur(6px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div
        className={`w-full ${maxWidth} bg-[#12161f] border border-[#273042] rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto`}
        style={{ maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#273042] bg-gradient-to-b from-[#181d28] to-[#12161f]">
          <h3 className="text-base sm:text-lg font-bold text-white tracking-wide flex items-center gap-2">
            {title}
          </h3>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#94a3b8] hover:text-white hover:bg-[#181d28] transition-colors"
              aria-label="Close modal"
            >
              ✕
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 text-sm text-[#f0f4fc]">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-[#273042] bg-[#0e131d]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
