import React, { useState, useMemo, useEffect } from "react";
import { Modal } from "../common/Modal.jsx";
import {
  CloseIcon,
  CheckIcon,
  PlusIcon,
  MinusIcon,
  InfoIcon,
  UndoIcon,
  EyeIcon,
  TrashIcon,
  AlertCircleIcon
} from "../common/Icons.jsx";
import { THEME_PALETTE } from "../../data/constants.js";

// Check if section applies to current round
function isSectionActive(section, round) {
  if (section.headerKind === "eob") {
    return round === 5;
  }
  const when = (section.when || "").trim().toUpperCase();
  const map = {
    "ANY BATTLE ROUND": [1, 2, 3, 4, 5],
    "ANY TURN (NOT PER BATTLE ROUND)": [1, 2, 3, 4, 5],
    "FIRST BATTLE ROUND": [1],
    "FIRST & SECOND BATTLE ROUND": [1, 2],
    "SECOND BATTLE ROUND ONWARDS": [2, 3, 4, 5],
    "SECOND & THIRD BATTLE ROUND": [2, 3],
    "SECOND TO FOURTH BATTLE ROUND": [2, 3, 4],
    "FOURTH BATTLE ROUND ONWARDS": [4, 5],
    "FIFTH BATTLE ROUND": [5],
    "END OF BATTLE": [5]
  };
  return !map[when] || map[when].includes(round);
}

// Convert markdown bold (**text**) to <strong>
function formatBoldText(text) {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+?\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={idx} className="font-extrabold">{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export function TallyModal({
  eyebrow,
  name,
  sections = [],
  accent = "#3b82f6",
  cap = 15,
  capNotice,
  round = 1,
  currentTotal,
  initialSelection,
  onConfirm,
  onDiscard,
  onShowCard,
  showCardLabel = "Full card",
  onReturnToDeck,
  reshuffleNote,
  onClose
}) {
  // Transform sections into grouped radio/toggle/stepper items
  const groups = useMemo(() => {
    return sections.flatMap((sec, secIdx) => {
      const cluster = [];
      sec.tiers.forEach((tier, tierIdx) => {
        const item = { id: `${secIdx}-${tierIdx}`, tier };
        if (tier.or && cluster.length > 0) {
          cluster[cluster.length - 1].tiers.push(item);
        } else {
          cluster.push({ tiers: [item] });
        }
      });
      return cluster.map((c, groupIdx) => {
        const kind = c.tiers.length > 1 ? "radio" : c.tiers[0].tier.perUnit ? "stepper" : "toggle";
        return {
          key: `${secIdx}-${groupIdx}`,
          sectionIdx: secIdx,
          kind,
          members: c.tiers
        };
      });
    });
  }, [sections]);

  // Selections state
  const [radioPicks, setRadioPicks] = useState(() => initialSelection?.radioPick || {});
  const [toggles, setToggles] = useState(() => initialSelection?.toggles || {});
  const [counts, setCounts] = useState(() => initialSelection?.counts || {});

  // Confirm discard/return to deck popups
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmReturnToDeck, setConfirmReturnToDeck] = useState(false);

  // Compute total scored
  const calculatedTotal = useMemo(() => {
    let total = 0;
    for (const group of groups) {
      if (isSectionActive(sections[group.sectionIdx], round)) {
        if (group.kind === "radio") {
          const selectedMember = group.members.find(m => m.id === radioPicks[group.key]);
          if (selectedMember) total += selectedMember.tier.vp;
        } else if (group.kind === "toggle") {
          const member = group.members[0];
          if (toggles[member.id]) total += member.tier.vp;
        } else if (group.kind === "stepper") {
          const member = group.members[0];
          const count = counts[member.id] || 0;
          const subtotal = count * member.tier.vp;
          total += member.tier.cap != null ? Math.min(subtotal, member.tier.cap) : subtotal;
        }
      }
    }
    return total;
  }, [groups, radioPicks, toggles, counts, round, sections]);

  const finalScore = Math.min(calculatedTotal, cap);

  return (
    <Modal isOpen onClose={onClose} ariaLabel={`Score ${name}`} maxWidth="560px">
      {/* Modal Header */}
      <div
        className="relative flex items-start justify-between gap-3 px-5 py-4 text-white"
        style={{
          background: accent,
          clipPath: "polygon(0 0, 100% 0, 100% 100%, 4% 100%, 0 calc(100% - 16px))"
        }}
      >
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <span className="gtk-mono flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/80">
            {eyebrow}
            <span className="h-px flex-1 bg-white/30" />
          </span>
          <h2 className="gtk-display text-[26px] font-bold uppercase leading-tight tracking-[0.02em] truncate">
            {name}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] border border-white/30 bg-white/20 text-white transition-colors hover:bg-white/30"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Reshuffle Notice banner if applicable */}
      {reshuffleNote && (
        <div
          className="mx-4 mt-3 flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5"
          style={{
            background: "color-mix(in srgb, #15314a 8%, #fff)",
            borderColor: "color-mix(in srgb, #15314a 30%, #fff)"
          }}
        >
          <InfoIcon className="mt-0.5 h-4 w-4 flex-none" style={{ color: "#15314a" }} />
          <span className="text-[13px] font-medium leading-snug" style={{ color: THEME_PALETTE.ink }}>
            {reshuffleNote}
          </span>
        </div>
      )}

      {/* Checklist Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 max-h-[55vh]">
        <p className="gtk-mono text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "#5a6068" }}>
          Tally what you scored
        </p>

        {sections.map((sec, secIdx) => {
          if (!isSectionActive(sec, round)) return null;
          const secGroups = groups.filter(g => g.sectionIdx === secIdx);

          return (
            <div key={secIdx} className="space-y-2.5">
              {/* Section Header Banner */}
              <div
                className="flex items-center justify-between gap-2 rounded-[6px] px-3 py-2 text-white"
                style={{ background: "#15314a" }}
              >
                <span className="font-display text-[14px] font-bold uppercase tracking-[0.06em] truncate">
                  {sec.when}
                </span>
                {sec.trigger && (
                  <span
                    className="gtk-mono flex-none rounded-[3px] px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.06em]"
                    style={{ background: THEME_PALETTE.paper, color: THEME_PALETTE.ink }}
                  >
                    {sec.trigger}
                  </span>
                )}
              </div>

              {/* Items */}
              {secGroups.map(group => {
                if (group.kind === "radio") {
                  return (
                    <div key={group.key} className="space-y-2">
                      {group.members.map((member, mIdx) => {
                        const isSelected = radioPicks[group.key] === member.id;
                        return (
                          <React.Fragment key={member.id}>
                            {mIdx > 0 && (
                              <div className="flex items-center gap-2" style={{ color: "#94896f" }}>
                                <span className="h-px flex-1" style={{ background: THEME_PALETTE.rule }} />
                                <span className="font-mono text-[10px] font-bold tracking-[0.15em]">OR</span>
                                <span className="h-px flex-1" style={{ background: THEME_PALETTE.rule }} />
                              </div>
                            )}
                            <button
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() =>
                                setRadioPicks(prev => ({
                                  ...prev,
                                  [group.key]: isSelected ? null : member.id
                                }))
                              }
                              className="flex w-full items-center gap-3 rounded-[12px] border-2 p-3 text-left transition-colors"
                              style={{
                                borderColor: isSelected ? accent : THEME_PALETTE.rule,
                                background: isSelected
                                  ? `color-mix(in srgb, ${accent} 10%, #fff)`
                                  : "#fff"
                              }}
                            >
                              <span
                                className="flex h-10 w-14 flex-none items-center justify-center rounded-[8px] font-display text-[24px] font-bold text-white leading-none"
                                style={{ background: accent }}
                              >
                                {member.tier.vp}
                                <small className="font-mono text-[9px] ml-0.5 font-bold">VP</small>
                              </span>
                              <span className="flex-1 text-[14px] font-medium leading-snug" style={{ color: THEME_PALETTE.ink }}>
                                {formatBoldText(member.tier.text)}
                              </span>
                              <span
                                className="flex h-8 w-8 flex-none items-center justify-center rounded-full border-2"
                                style={{
                                  borderColor: isSelected ? accent : THEME_PALETTE.rule,
                                  background: isSelected ? accent : "transparent"
                                }}
                              >
                                {isSelected && <CheckIcon className="h-4 w-4 text-white" />}
                              </span>
                            </button>
                          </React.Fragment>
                        );
                      })}
                    </div>
                  );
                }

                if (group.kind === "stepper") {
                  const member = group.members[0];
                  const count = counts[member.id] || 0;
                  const itemVp = count * member.tier.vp;
                  return (
                    <div
                      key={group.key}
                      className="flex flex-col gap-2 rounded-[12px] border-2 p-3"
                      style={{
                        borderColor: count > 0 ? accent : THEME_PALETTE.rule,
                        background: count > 0 ? `color-mix(in srgb, ${accent} 8%, #fff)` : "#fff"
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="flex h-10 w-14 flex-none items-center justify-center rounded-[8px] font-display text-[24px] font-bold text-white leading-none"
                          style={{ background: accent }}
                        >
                          {member.tier.vp}
                          <small className="font-mono text-[9px] ml-0.5 font-bold">VP</small>
                        </span>
                        <span className="flex-1 text-[14px] font-medium leading-snug" style={{ color: THEME_PALETTE.ink }}>
                          {formatBoldText(member.tier.text)}
                        </span>
                      </div>

                      <div className="flex items-center justify-end gap-3 pt-1">
                        <div
                          className="inline-flex items-stretch overflow-hidden rounded-[8px] border-2"
                          style={{ borderColor: THEME_PALETTE.rule, background: "#fff" }}
                        >
                          <button
                            type="button"
                            disabled={count <= 0}
                            onClick={() =>
                              setCounts(prev => ({
                                ...prev,
                                [member.id]: Math.max(0, count - 1)
                              }))
                            }
                            className="flex h-9 w-9 items-center justify-center transition-colors disabled:opacity-30"
                            style={{ borderRight: `1px solid ${THEME_PALETTE.rule}` }}
                          >
                            <MinusIcon className="h-4 w-4" />
                          </button>
                          <span
                            className="flex min-w-[2.5rem] items-center justify-center font-display text-[20px] font-bold"
                            style={{ color: THEME_PALETTE.ink }}
                          >
                            {count}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setCounts(prev => ({
                                ...prev,
                                [member.id]: count + 1
                              }))
                            }
                            className="flex h-9 w-9 items-center justify-center text-white transition-[filter]"
                            style={{ background: accent, borderLeft: `1px solid ${THEME_PALETTE.rule}` }}
                          >
                            <PlusIcon className="h-4 w-4" />
                          </button>
                        </div>
                        <span className="gtk-mono text-[12px] font-bold" style={{ color: "#5a6068" }}>
                          = {itemVp} VP
                        </span>
                      </div>
                    </div>
                  );
                }

                // Default: toggle checkbox
                const member = group.members[0];
                const isChecked = !!toggles[member.id];
                return (
                  <button
                    key={group.key}
                    type="button"
                    aria-pressed={isChecked}
                    onClick={() =>
                      setToggles(prev => ({ ...prev, [member.id]: !isChecked }))
                    }
                    className="flex w-full items-center gap-3 rounded-[12px] border-2 p-3 text-left transition-colors"
                    style={{
                      borderColor: isChecked ? accent : THEME_PALETTE.rule,
                      background: isChecked ? `color-mix(in srgb, ${accent} 10%, #fff)` : "#fff"
                    }}
                  >
                    <span
                      className="flex h-10 w-14 flex-none items-center justify-center rounded-[8px] font-display text-[24px] font-bold text-white leading-none"
                      style={{ background: accent }}
                    >
                      {member.tier.cumulative ? "+" : ""}
                      {member.tier.vp}
                      <small className="font-mono text-[9px] ml-0.5 font-bold">VP</small>
                    </span>
                    <span className="flex-1 text-[14px] font-medium leading-snug" style={{ color: THEME_PALETTE.ink }}>
                      {formatBoldText(member.tier.text)}
                    </span>
                    <span
                      className="flex h-8 w-8 flex-none items-center justify-center rounded-full border-2"
                      style={{
                        borderColor: isChecked ? accent : THEME_PALETTE.rule,
                        background: isChecked ? accent : "transparent"
                      }}
                    >
                      {isChecked && <CheckIcon className="h-4 w-4 text-white" />}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Footer Controls */}
      <div
        className="relative flex flex-col gap-3 border-t-2 px-4 py-3"
        style={{
          borderColor: THEME_PALETTE.rule,
          background: THEME_PALETTE.foot,
          paddingBottom: "calc(12px + env(safe-area-inset-bottom))"
        }}
      >
        {/* Cap notice */}
        {capNotice && calculatedTotal > cap && (
          <div
            className="flex items-center gap-2 rounded-[8px] border px-3 py-1.5"
            style={{
              background: "color-mix(in srgb, #c84a2b 10%, #fff)",
              borderColor: "color-mix(in srgb, #c84a2b 40%, #fff)"
            }}
          >
            <AlertCircleIcon className="h-4 w-4 flex-none" style={{ color: "#c84a2b" }} />
            <span className="gtk-mono text-[11px] font-bold uppercase tracking-[0.06em]" style={{ color: "#8a3115" }}>
              {capNotice}
            </span>
          </div>
        )}

        {/* Secondary options row: Previous score, Return to deck, Full card */}
        <div className="flex items-center justify-between gap-2">
          {currentTotal != null && currentTotal > 0 ? (
            <span className="gtk-mono text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: "#8a8270" }}>
              Was {currentTotal} VP
            </span>
          ) : <span />}

          <div className="flex items-center gap-2">
            {onReturnToDeck && (
              <button
                type="button"
                onClick={() => setConfirmReturnToDeck(true)}
                className="flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-white"
                style={{ background: THEME_PALETTE.backInk }}
              >
                <UndoIcon className="h-3.5 w-3.5" />
                To deck
              </button>
            )}
            {onShowCard && (
              <button
                type="button"
                onClick={onShowCard}
                className="flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-white"
                style={{ background: THEME_PALETTE.backInk }}
              >
                <EyeIcon className="h-3.5 w-3.5" />
                {showCardLabel}
              </button>
            )}
          </div>
        </div>

        {/* Action Buttons: Score VP, Discard, Cancel */}
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => onConfirm(finalScore, { radioPick: radioPicks, toggles, counts })}
            className="flex h-13 flex-1 items-center justify-center rounded-[10px] font-mono text-[15px] font-bold uppercase tracking-[0.1em] text-white transition-colors"
            style={{
              background: finalScore <= 0 ? THEME_PALETTE.backInk : THEME_PALETTE.green
            }}
          >
            Score {finalScore} VP
          </button>

          {onDiscard ? (
            <button
              type="button"
              aria-label="Discard secondary"
              onClick={() => setConfirmDiscard(true)}
              className="flex h-13 flex-none items-center justify-center px-4 rounded-[10px] text-white transition-colors"
              style={{ background: THEME_PALETTE.red }}
            >
              <TrashIcon className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="flex h-13 flex-none items-center justify-center px-5 rounded-[10px] font-mono text-[13px] font-bold uppercase tracking-[0.1em]"
              style={{ background: THEME_PALETTE.back, color: THEME_PALETTE.backInk }}
            >
              Back
            </button>
          )}
        </div>

        {/* Confirm Discard Modal */}
        {confirmDiscard && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm rounded-[16px]">
            <div className="w-full max-w-[280px] rounded-[12px] border p-4 text-center space-y-3" style={{ background: THEME_PALETTE.foot, borderColor: THEME_PALETTE.rule }}>
              <span className="gtk-display text-[18px] font-bold uppercase leading-tight block">
                Discard secondary?
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onDiscard}
                  className="flex-1 h-10 rounded-[8px] font-mono text-[12px] font-bold uppercase text-white"
                  style={{ background: THEME_PALETTE.red }}
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDiscard(false)}
                  className="px-4 h-10 rounded-[8px] font-mono text-[12px] font-bold uppercase"
                  style={{ background: THEME_PALETTE.back, color: THEME_PALETTE.backInk }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirm Return to Deck Modal */}
        {confirmReturnToDeck && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm rounded-[16px]">
            <div className="w-full max-w-[280px] rounded-[12px] border p-4 text-center space-y-3" style={{ background: THEME_PALETTE.foot, borderColor: THEME_PALETTE.rule }}>
              <span className="gtk-display text-[18px] font-bold uppercase leading-tight block">
                Return to deck?
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onReturnToDeck}
                  className="flex-1 h-10 rounded-[8px] font-mono text-[12px] font-bold uppercase text-white"
                  style={{ background: THEME_PALETTE.backInk }}
                >
                  Return
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReturnToDeck(false)}
                  className="px-4 h-10 rounded-[8px] font-mono text-[12px] font-bold uppercase"
                  style={{ background: THEME_PALETTE.back, color: THEME_PALETTE.backInk }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
