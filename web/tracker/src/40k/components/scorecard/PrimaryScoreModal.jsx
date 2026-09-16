import React, { useState } from "react";
import { TallyModal } from "./TallyModal.jsx";
import { getPrimaryMission, getPrimaryMissionCard } from "../../data/primaryMissions.js";
import { CardImageModal } from "../common/CardImageModal.jsx";

export function PrimaryScoreModal({
  missionName,
  deckSlug,
  accentColor = "#7a1c1c",
  round = 1,
  currentTotal = 0,
  cap = 15,
  initialSelection,
  onConfirm,
  onClose
}) {
  const [viewingCard, setViewingCard] = useState(false);
  const mission = getPrimaryMission(missionName);
  const cardData = getPrimaryMissionCard(missionName);

  return (
    <>
      <TallyModal
        eyebrow="PRIMARY MISSION"
        name={missionName}
        sections={mission?.sections || []}
        accent={accentColor}
        cap={cap}
        round={round}
        currentTotal={currentTotal}
        initialSelection={initialSelection}
        onConfirm={onConfirm}
        onShowCard={cardData?.image ? () => setViewingCard(true) : null}
        showCardLabel="Full card"
        onClose={onClose}
      />

      {viewingCard && cardData && (
        <CardImageModal
          front={cardData.image}
          back={cardData.back}
          alt={missionName}
          title={`${missionName} · Primary Mission`}
          borderColor={accentColor}
          onClose={() => setViewingCard(false)}
        />
      )}
    </>
  );
}
