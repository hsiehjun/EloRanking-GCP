/**
 * Warhammer 40k 11th Edition Match Rules and Tracker Constants
 */

// Scoring caps and maximums
export const BATTLE_READY_VP = 10;
export const PRIMARY_MAX_VP = 45;
export const PRIMARY_ROUND_CAP = 15;
export const SECONDARY_MAX_VP = 45;
export const SECONDARY_ROUND_CAP = 15;
export const SECONDARY_CARD_CAP = 15;
export const SECONDARY_FIXED_MAX_VP = 20;
export const FIXED_SELECTION_COUNT = 2;
export const MAX_MATCH_VP = 100;
export const MAX_DETACHMENT_POINTS = 3;

// Player identification colors
export const PLAYER_COLORS = {
  1: "#3b82f6", // Player 1 (Blue)
  2: "#ef4444"  // Player 2 (Red)
};

// Role theme colors
export const ROLE_COLORS = {
  attacker: "#8a2b2b",
  defender: "#2f6b4f"
};

// Theme and styling palette
export const THEME_PALETTE = {
  paper: "#12161f",
  ink: "#f0f4fc",
  rule: "#273042",
  foot: "#0e131d",
  brass: "#38bdf8",
  green: "#22c55e",
  greenHover: "#16a34a",
  red: "#ef4444",
  scoreDisabled: "#334155",
  back: "#1e2533",
  backInk: "#94a3b8"
};

// Local storage key for persistent game state
export const STORAGE_KEY_TRACKER_STATE = "gdm-11e-tracker-state";
export const STORAGE_KEY_TRACKER_SETTINGS = "gdm-11e-tracker-settings";
export const STORAGE_KEY_TRACKER_HISTORY = "gdm-11e-tracker-history";
export const STORAGE_KEY_LAYOUT_MEASUREMENTS = "gdm-layout-measurements";
