import React, { useState } from "react";
import { TallyModal } from "./TallyModal.jsx";
import { SecondaryCardModal } from "./SecondaryCardModal.jsx";
import {
  getSecondaryMission,
  getSecondaryCardName,
  parseVpValue,
  parseCapValue
} from "../../data/secondaryMissions.js";
import { ROLE_COLORS } from "../../data/constants.js";
import { getCardRoundScore } from "../../data/scoringRules.js";

function cleanHtmlTags(str) {
  if (!str) return "";
  return str
    .replace(/<\s*b\s*>([\s\S]*?)<\s*\/\s*b\s*>/gi, "**$1**")
    .replace(/<span[^>]*class="[^"]*cB__mark[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, "**$1**")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function SecondaryScoreModal({
  card,
  mode = "tactical",
  round = 1,
  cap = 15,
  capReason,
  onScore,
  onDiscard,
  onReturnToDeck,
  reshuffleNote,
  onClose
}) {
  const [viewingFullCard, setViewingFullCard] = useState(false);
  const mission = getSecondaryMission(card.cardId);
  const cardName = mission?.name || getSecondaryCardName(card.cardId);

  // Filter sections by tactical vs fixed mode
  const filteredSections = (mission?.sections || [])
    .filter(sec => {
      const isFixed = sec.chip === "FIXED" || sec.headerKind === "fixed";
      const isTactical = sec.chip === "TACTICAL";
      return mode === "tactical" ? !isFixed : !isTactical;
    })
    .map(sec => {
      const parsedCap = parseCapValue(sec.cap);
      const isPerEvent = parsedCap != null || !!sec.perEvent;

      const rows = sec.rows
        .filter(r => !!r.vp)
        .map(r => ({
          text: cleanHtmlTags(r.text),
          vp: parseVpValue(r.vp),
          or: r.or,
          perUnit: isPerEvent || undefined,
          cap: parsedCap || undefined,
          cumulative: r.cumulative,
          kind: r.kind
        }));

      return {
        when: sec.when,
        trigger: sec.trigger ? cleanHtmlTags(sec.trigger) : undefined,
        chip: sec.chip,
        headerKind: sec.headerKind,
        tiers: rows
      };
    })
    .filter(sec => sec.tiers.length > 0);

  const roundScore = round != null ? getCardRoundScore(card, round) : null;
  const currentTotal = roundScore ? roundScore.points : card.scoredRound != null ? card.points : undefined;
  const initialSelection = roundScore?.selection || card.scoreSelection;

  const capNoticeMap = {
    round: "Maximum of 15 per round",
    fixed: "Maximum of 20 per fixed secondary"
  };

  return (
    <>
      <TallyModal
        eyebrow="SECONDARY MISSION"
        name={cardName}
        sections={filteredSections}
        accent={ROLE_COLORS[card.side] || "#8a2b2b"}
        cap={cap}
        capNotice={capReason ? capNoticeMap[capReason] : undefined}
        round={round}
        currentTotal={currentTotal}
        initialSelection={initialSelection}
        onConfirm={(points, selection) => onScore(card.instanceId, points, selection)}
        onDiscard={onDiscard}
        onReturnToDeck={onReturnToDeck}
        reshuffleNote={reshuffleNote}
        onShowCard={() => setViewingFullCard(true)}
        showCardLabel="Full card"
        onClose={onClose}
      />

      {viewingFullCard && (
        <SecondaryCardModal
          card={card}
          mode={mode}
          onClose={() => setViewingFullCard(false)}
        />
      )}
    </>
  );
}
