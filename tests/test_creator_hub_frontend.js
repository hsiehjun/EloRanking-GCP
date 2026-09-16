// Automated verification suite for Creator Hub frontend logic
const fs = require("fs");
const path = require("path");
const assert = require("assert");

// Setup browser mock environment
global.window = global;
global.escapeHtml = (str) => String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let downloadedBlobs = [];
global.Blob = class Blob {
  constructor(content, options) {
    this.content = Array.isArray(content) ? content.join("") : String(content);
    this.options = options;
    downloadedBlobs.push(this);
  }
};
global.URL = {
  createObjectURL: (blob) => "blob:test-url",
  revokeObjectURL: (url) => {}
};
global.document = {
  getElementById: (id) => null,
  body: {
    appendChild: (el) => {},
    removeChild: (el) => {}
  },
  createElement: (tag) => {
    return {
      setAttribute: (k, v) => {},
      click: () => {}
    };
  }
};

let mockStreams = [
  { id: "stream-1", table_number: 1, channel: "Wargames Live", stream_url: "https://youtube.com/watch?v=live1", is_live: true, viewers: 1400 },
  { id: "stream-2", table_number: 2, channel: "Art of War", stream_url: "https://twitch.tv/artofwar", is_live: true, viewers: 900 }
];

global.window.api = {
  getEventLivestreams: async (id) => ({ success: true, livestreams: mockStreams }),
  saveEventLivestream: async (id, data) => {
    const s = { id: `stream_${Date.now()}`, ...data };
    mockStreams.push(s);
    return { success: true, livestream: s, livestreams: mockStreams };
  },
  deleteEventLivestream: async (id, sId) => {
    mockStreams = mockStreams.filter(s => s.id !== sId);
    return { success: true, deleted_id: sId, livestreams: mockStreams };
  }
};

// Load tournaments.js
const code = fs.readFileSync(path.join(__dirname, "../web/js/tournaments.js"), "utf-8");
eval(code);

async function runTests() {
  console.log("🚀 Running Creator Hub & Livestreams Frontend Verification Tests...");

  // 1. normalizeStreamRecord
  const raw = {
    id: "test-stream",
    table_number: 3,
    channel: "SkaredCast",
    stream_url: "https://youtube.com/watch?v=abc",
    embed_url: "https://youtube.com/embed/abc",
    is_live: true
  };
  const norm = window.normalizeStreamRecord(raw);
  assert.strictEqual(norm.tableNumber, 3, "tableNumber should be normalized to 3");
  assert.strictEqual(norm.streamUrl, "https://youtube.com/watch?v=abc", "streamUrl should match stream_url");
  assert.strictEqual(norm.isLive, true, "isLive should be boolean true");
  console.log("  ✓ normalizeStreamRecord works for snake_case and camelCase");

  // 2. loadEventLivestreams
  const streams = await window.loadEventLivestreams("ev_test");
  assert.strictEqual(streams.length, 2, "Should load 2 streams from API");
  assert.strictEqual(streams[0].channel, "Wargames Live");
  assert.strictEqual(streams[0].tableNumber, 1);
  console.log("  ✓ loadEventLivestreams successfully fetches and normalizes streams");

  // 3. Dynamic Storylines & Upsets
  const mockPlayers = [
    { id: "p1", player_id: "p1", full_name: "Innes Wilson", faction: "Adeptus Custodes", detachment: "Shield Host", current_elo: 2200, event_wins: 3, event_losses: 0, event_battle_points: 290, army_list: "Trajann Valoris\nCustodian Guard\nCaladius Grav-tank" },
    { id: "p2", player_id: "p2", full_name: "Marcus Vance", faction: "Orks", detachment: "Dread Mob", current_elo: 1650, event_wins: 2, event_losses: 1, event_battle_points: 245, army_list: "Warboss\nGorkanaut\nGorkanaut\nGorkanaut" },
    { id: "p3", player_id: "p3", full_name: "Folger Pyles", faction: "Adeptus Custodes", detachment: "Auric Champions", current_elo: 2150, event_wins: 2, event_losses: 1, event_battle_points: 260, army_list: "Blade Champion\nWardens\nAllarus Terminators" },
    { id: "p4", player_id: "p4", full_name: "David Gaylard", faction: "Necrons", detachment: "Canoptek Court", current_elo: 1980, event_wins: 2, event_losses: 1, event_battle_points: 250, army_list: "Technomancer\nCanoptek Doomstalker\nCanoptek Doomstalker" }
  ];

  const mockMatches = [
    // Round 1: Innes beat Marcus
    { round: 1, table_number: 1, player1_id: "p1", player1_name: "Innes Wilson", player1_elo: 2200, player1_score: 95, player2_id: "p2", player2_name: "Marcus Vance", player2_elo: 1650, player2_score: 60, winner_id: "p1", winner_name: "Innes Wilson" },
    // Round 2: Marcus UPSETS Folger (+500 Elo gap!)
    { round: 2, table_number: 2, player1_id: "p2", player1_name: "Marcus Vance", player1_elo: 1650, player1_score: 88, player2_id: "p3", player2_name: "Folger Pyles", player2_elo: 2150, player2_score: 72, winner_id: "p2", winner_name: "Marcus Vance" },
    // Round 3: Innes beat David
    { round: 3, table_number: 1, player1_id: "p1", player1_name: "Innes Wilson", player1_elo: 2200, player1_score: 90, player2_id: "p4", player2_name: "David Gaylard", player2_elo: 1980, player2_score: 80, winner_id: "p1", winner_name: "Innes Wilson" }
  ];

  const storylinesHtml = window.renderStorylinesMode({ name: "Atlanta Open GT", current_round: 3 }, mockPlayers, mockMatches);
  assert(storylinesHtml.includes("#1 TOURNAMENT GIANT KILLER"), "Should render Giant Killer spotlight banner");
  assert(storylinesHtml.includes("Marcus Vance"), "Should identify Marcus Vance as the giant killer");
  assert(storylinesHtml.includes("Folger Pyles"), "Should identify Folger Pyles as defeated favorite");
  assert(storylinesHtml.includes("+500"), "Should calculate +500 Elo gap upset");
  assert(storylinesHtml.includes("UNDEFEATED"), "Should render undefeated gauntlet");
  assert(storylinesHtml.includes("Innes Wilson"), "Innes Wilson should be shown as undefeated");
  assert(storylinesHtml.includes("Avg Elo"), "Should calculate average opponent Elo for Innes");
  console.log("  ✓ renderStorylinesMode accurately calculates Elo gap upsets and Undefeated SoS");

  // 4. Dynamic Deep Meta & Spiciness Index
  const metaHtml = window.renderDeepMetaMode({ name: "Atlanta Open GT" }, mockPlayers, mockMatches);
  assert(metaHtml.includes("Detachment &amp; Force Disposition Power Grid") || metaHtml.includes("Detachment & Force Disposition Power Grid"), "Should render detachment grid");
  assert(metaHtml.includes("Shield Host"), "Should list Shield Host");
  assert(metaHtml.includes("Dread Mob"), "Should list Dread Mob");
  assert(metaHtml.includes("Spiciness"), "Should render Spiciness Index");
  assert(metaHtml.includes("GORKANAUT") || metaHtml.includes("CANOPTEK DOOMSTALKER"), "Should identify rare rogue datasheets");
  console.log("  ✓ renderDeepMetaMode dynamically groups detachments and identifies rogue list tech");

  // 5. Dynamic Media & Export Kit
  const exportHtml = window.renderMediaExportMode({ name: "Atlanta Open GT", venue: "Atlanta, GA", current_round: 3 }, mockPlayers, mockMatches);
  assert(exportHtml.includes("Atlanta Open GT"), "Should display event name");
  assert(exportHtml.includes("Innes Wilson"), "Should display top seed in infographic");
  assert(exportHtml.includes("Marcus Vance"), "Should display giant slayer");
  assert(exportHtml.includes("Copy Discord Post"), "Should have copy discord button");
  assert(exportHtml.includes("exportPairingsCsv()"), "Should have export pairings CSV button");
  assert(exportHtml.includes("exportRosterJson()"), "Should have export roster JSON button");
  console.log("  ✓ renderMediaExportMode renders dynamic preview card and export actions");

  // 6. CSV & JSON Downloaders
  downloadedBlobs = [];
  window.eventMatchesCache = mockMatches;
  window.eventPlayersCache = mockPlayers;
  window.currentEventData = { id: "ev_atlanta_2026", name: "Atlanta Open GT", matches: mockMatches, players: mockPlayers };

  window.exportPairingsCsv("ev_atlanta_2026");
  assert.strictEqual(downloadedBlobs.length, 1, "CSV export should create a blob");
  const csvText = downloadedBlobs[0].content;
  assert(csvText.includes("Round,Table,Player 1,P1 Faction"), "CSV should have standard pairings headers");
  assert(csvText.includes("Innes Wilson"), "CSV should include player 1");
  assert(csvText.includes("Marcus Vance"), "CSV should include player 2");
  assert(csvText.includes("88 - 72") || csvText.includes("88"), "CSV should include scores");

  window.exportRosterJson("ev_atlanta_2026");
  assert.strictEqual(downloadedBlobs.length, 2, "JSON export should create a blob");
  const jsonText = downloadedBlobs[1].content;
  const parsedJson = JSON.parse(jsonText);
  assert.strictEqual(parsedJson.event_id, "ev_atlanta_2026");
  assert.strictEqual(parsedJson.total_players, 4);
  assert.strictEqual(parsedJson.roster[0].name, "Innes Wilson");
  assert.strictEqual(parsedJson.roster[0].record.wins, 3);
  console.log("  ✓ exportPairingsCsv and exportRosterJson generate valid CSV and JSON downloads");

  console.log("\n🎉 ALL FRONTEND AND DATA INTEGRITY TESTS PASSED!");
}

runTests().catch(err => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
