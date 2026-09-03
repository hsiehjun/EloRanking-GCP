import React from "react";

export const FORCE_DISPOSITIONS = [
  { key: "hold", name: "Take and Hold", color: "#2f6b4f" },
  { key: "purge", name: "Purge the Foe", color: "#8a2b2b" },
  { key: "disruption", name: "Disruption", color: "#1f4f8a" },
  { key: "recon", name: "Reconnaissance", color: "#1f7a82" },
  { key: "priority", name: "Priority Assets", color: "#a17b14" }
];

export const DISPOSITION_KEY_ALIASES = {
  hold: "take-and-hold",
  purge: "purge-the-foe",
  disruption: "disruption",
  recon: "reconnaissance",
  priority: "priority-assets",
  "take-and-hold": "take-and-hold",
  "purge-the-foe": "purge-the-foe",
  reconnaissance: "reconnaissance",
  "priority-assets": "priority-assets"
};

export function normalizeDispositionKey(key) {
  if (!key) return null;
  const shortMap = {
    "take-and-hold": "hold",
    "purge-the-foe": "purge",
    reconnaissance: "recon",
    "priority-assets": "priority",
    disruption: "disruption",
    hold: "hold",
    purge: "purge",
    recon: "recon",
    priority: "priority"
  };
  return shortMap[key] || key;
}

export function toDeckSlug(key) {
  return DISPOSITION_KEY_ALIASES[key] || key;
}

export const DISPOSITION_COLORS = {
  hold: "#2f6b4f",
  purge: "#8a2b2b",
  disruption: "#1f4f8a",
  recon: "#1f7a82",
  priority: "#a17b14",
  "take-and-hold": "#2f6b4f",
  "purge-the-foe": "#8a2b2b",
  reconnaissance: "#1f7a82",
  "priority-assets": "#a17b14"
};

export const PRIMARY_MISSION_MATRIX = {
  hold: {
    hold: "Battlefield Dominance",
    purge: "Immovable Object",
    disruption: "Determined Acquisition",
    recon: "Purge and Secure",
    priority: "Inescapable Dominion"
  },
  purge: {
    hold: "Unstoppable Force",
    purge: "Meatgrinder",
    disruption: "Punishment",
    recon: "Consecrate",
    priority: "Destroyer's Wrath"
  },
  disruption: {
    hold: "Death Trap",
    purge: "Delaying Action",
    disruption: "Outmanoeuvre",
    recon: "Smoke and Mirrors",
    priority: "Locate and Deny"
  },
  recon: {
    hold: "Reconnaissance Sweep",
    purge: "Triangulation",
    disruption: "Surveil the Foe",
    recon: "Gather Intel",
    priority: "Search and Scour"
  },
  priority: {
    hold: "Secure Asset",
    purge: "Vital Link",
    disruption: "Extract Relic",
    recon: "Vanguard Operation",
    priority: "Sabotage"
  }
};

export function getPrimaryMissionName(p1Disposition, p2Disposition) {
  const k1 = normalizeDispositionKey(p1Disposition);
  const k2 = normalizeDispositionKey(p2Disposition);
  if (!k1 || !k2 || !PRIMARY_MISSION_MATRIX[k1]) return null;
  return PRIMARY_MISSION_MATRIX[k1][k2] || null;
}

export const DISPOSITION_ICONS = {
  hold: (
    <svg viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" stroke="currentColor">
      <path d="M22 20v-9H2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2Z" />
      <path d="M18 11V4H6v7" />
      <path d="M15 22v-4a3 3 0 0 0-3-3a3 3 0 0 0-3 3v4" />
      <path d="M22 11V9M2 11V9M6 4V2M18 4V2M10 4V2M14 4V2" />
    </svg>
  ),
  purge: (
    <svg viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" stroke="currentColor">
      <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
      <line x1="13" y1="19" x2="19" y2="13" />
      <line x1="16" y1="16" x2="20" y2="20" />
      <line x1="19" y1="21" x2="21" y2="19" />
    </svg>
  ),
  disruption: (
    <svg viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" stroke="currentColor">
      <circle cx="11" cy="13" r="9" />
      <path d="M14.35 4.65 16.3 2.7a2.41 2.41 0 0 1 3.4 0l1.6 1.6a2.4 2.4 0 0 1 0 3.4l-1.95 1.95" />
      <path d="m22 2-1.5 1.5" />
    </svg>
  ),
  recon: (
    <svg viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" stroke="currentColor">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  priority: (
    <svg viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" stroke="currentColor">
      <polygon points="3 11 22 2 13 21 11 13 3 11" />
    </svg>
  )
};
