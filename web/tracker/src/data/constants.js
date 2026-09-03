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
  paper: "#f4f0e7",
  ink: "#11161c",
  rule: "#c9c0aa",
  foot: "#ece5d6",
  brass: "#d9a017",
  green: "#1e9d52",
  greenHover: "#27b35f",
  red: "#e23b3b",
  scoreDisabled: "#b9c2bb",
  back: "#cfc7b4",
  backInk: "#2c3138"
};

// Local storage key for persistent game state
export const STORAGE_KEY_TRACKER_STATE = "gdm-11e-tracker-state";
export const STORAGE_KEY_TRACKER_SETTINGS = "gdm-11e-tracker-settings";
export const STORAGE_KEY_TRACKER_HISTORY = "gdm-11e-tracker-history";
export const STORAGE_KEY_LAYOUT_MEASUREMENTS = "gdm-layout-measurements";
