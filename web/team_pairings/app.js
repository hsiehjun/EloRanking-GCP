/**
 * OmniTactica — 40K Team Pairings Duel Arena (Yu-Gi-Oh! First-Person Card Game UI)
 * - Player-specific perspective: Your Team Hand is ALWAYS at the bottom; Opponent is across the top.
 * - Room Entry Lobby: Select your Seat (Team A Captain, Team B Captain, Spectator) & search players to build your hand.
 * - Zero walls of text: Visual Yu-Gi-Oh card frames, Left Card Inspector, 3D Playmat slots, and Right Paired Tables stack.
 */

const FACTION_META = {
  "Aeldari": { icon: "🔮", accent: "rgba(56, 189, 248, 0.45)", detachment: "Warhost" },
  "Necrons": { icon: "💀", accent: "rgba(16, 185, 129, 0.45)", detachment: "Canoptek Court" },
  "Adeptus Custodes": { icon: "🦅", accent: "rgba(245, 185, 66, 0.50)", detachment: "Shield Host" },
  "Space Marines": { icon: "⚡", accent: "rgba(59, 130, 246, 0.45)", detachment: "Gladius Task Force" },
  "Blood Angels": { icon: "🩸", accent: "rgba(239, 68, 68, 0.48)", detachment: "Liberator Assault" },
  "Dark Angels": { icon: "🗡️", accent: "rgba(5, 150, 105, 0.45)", detachment: "Inner Circle" },
  "World Eaters": { icon: "🩸", accent: "rgba(220, 38, 38, 0.52)", detachment: "Berzerker Warband" },
  "Thousand Sons": { icon: "👁️", accent: "rgba(139, 92, 246, 0.48)", detachment: "Cult of Magic" },
  "Death Guard": { icon: "☣️", accent: "rgba(132, 204, 22, 0.42)", detachment: "Plague Company" },
  "T'au Empire": { icon: "🎯", accent: "rgba(14, 165, 233, 0.45)", detachment: "Kauyon" },
  "Orks": { icon: "🪓", accent: "rgba(34, 197, 94, 0.45)", detachment: "War Horde" },
  "Tyranids": { icon: "🦂", accent: "rgba(168, 85, 247, 0.45)", detachment: "Invasion Fleet" },
  "Astra Militarum": { icon: "🛡️", accent: "rgba(148, 163, 184, 0.42)", detachment: "Combined Regiment" },
  "Chaos Daemons": { icon: "👹", accent: "rgba(244, 63, 94, 0.45)", detachment: "Daemonic Incursion" },
  "Chaos Space Marines": { icon: "🔥", accent: "rgba(249, 115, 22, 0.45)", detachment: "Pactbound Zealots" },
  "Drukhari": { icon: "🕷️", accent: "rgba(217, 70, 239, 0.45)", detachment: "Skysplinter Assault" },
  "Grey Knights": { icon: "⚔️", accent: "rgba(148, 163, 184, 0.48)", detachment: "Teleport Strike" },
  "Sisters of Battle": { icon: "⚜️", accent: "rgba(251, 191, 36, 0.45)", detachment: "Hallowed Martyrs" },
  "Imperial Knights": { icon: "🏰", accent: "rgba(59, 130, 246, 0.45)", detachment: "Noble Lance" },
  "Chaos Knights": { icon: "🤖", accent: "rgba(239, 68, 68, 0.45)", detachment: "Traitoris Lance" },
  "Leagues of Votann": { icon: "⛏️", accent: "rgba(20, 184, 166, 0.45)", detachment: "Oathband" },
  "Genestealer Cults": { icon: "🧬", accent: "rgba(192, 132, 252, 0.45)", detachment: "Host of Ascension" },
  "Adeptus Mechanicus": { icon: "⚙️", accent: "rgba(239, 68, 68, 0.45)", detachment: "Skitarii Hunter" }
};

// Instant searchable pool of top 40K tournament players (augmented live via /api/leaderboard)
const SEARCHABLE_PLAYERS_POOL = [
  { name: "Richard Siegler", faction: "Aeldari", detachment: "Warhost", elo: 2185, role_tag: "Blunt / Defender" },
  { name: "John Lennon", faction: "Space Marines", detachment: "Gladius Task Force", elo: 2170, role_tag: "All-Rounder" },
  { name: "Jack Harpster", faction: "Blood Angels", detachment: "Liberator Assault", elo: 2135, role_tag: "Spear / Attacker" },
  { name: "Nick Nanavati", faction: "Chaos Daemons", detachment: "Daemonic Incursion", elo: 2110, role_tag: "Spear / Attacker" },
  { name: "Brad Chester", faction: "Astra Militarum", detachment: "Combined Regiment", elo: 2125, role_tag: "Blunt / Defender" },
  { name: "Mani Cheema", faction: "Necrons", detachment: "Canoptek Court", elo: 2150, role_tag: "Blunt / Defender" },
  { name: "Innes Wilson", faction: "Genestealer Cults", detachment: "Host of Ascension", elo: 2180, role_tag: "All-Rounder" },
  { name: "Liam VSL", faction: "World Eaters", detachment: "Berzerker Warband", elo: 2165, role_tag: "Spear / Attacker" },
  { name: "nassick", faction: "Death Guard", detachment: "Plague Company", elo: 2115, role_tag: "Blunt / Defender" },
  { name: "David Gaylard", faction: "Thousand Sons", detachment: "Cult of Magic", elo: 2130, role_tag: "Spear / Attacker" },
  { name: "Nemo", faction: "Adeptus Custodes", detachment: "Shield Host", elo: 2145, role_tag: "All-Rounder" },
  { name: "Alex Harrison", faction: "Drukhari", detachment: "Skysplinter Assault", elo: 2095, role_tag: "Spear / Attacker" },
  { name: "Sean Nayden", faction: "Aeldari", detachment: "Ynnead", elo: 2105, role_tag: "Spear / Attacker" },
  { name: "Folger Pyles", faction: "Adeptus Custodes", detachment: "Talons", elo: 2140, role_tag: "Blunt / Defender" },
  { name: "conankun", faction: "T'au Empire", detachment: "Kauyon", elo: 2120, role_tag: "All-Rounder" },
  { name: "Anthony Vanella", faction: "Orks", detachment: "War Horde", elo: 2100, role_tag: "Spear / Attacker" },
  { name: "Ben Jurek", faction: "Imperial Knights", detachment: "Noble Lance", elo: 2088, role_tag: "Blunt / Defender" },
  { name: "dcummins", faction: "Tyranids", detachment: "Invasion Fleet", elo: 2092, role_tag: "Blunt / Defender" },
  { name: "Vik Vijay", faction: "Grey Knights", detachment: "Teleport Strike", elo: 2112, role_tag: "All-Rounder" },
  { name: "Thomas Byrd", faction: "Sisters of Battle", detachment: "Hallowed Martyrs", elo: 2108, role_tag: "Spear / Attacker" },
  { name: "Luka", faction: "Dark Angels", detachment: "Inner Circle", elo: 2098, role_tag: "Blunt / Defender" },
  { name: "Marshall Peterson", faction: "Chaos Space Marines", detachment: "Pactbound Zealots", elo: 2085, role_tag: "Spear / Attacker" },
  { name: "Mitch Pelham", faction: "Chaos Knights", detachment: "Traitoris Lance", elo: 2075, role_tag: "Blunt / Defender" },
  { name: "Sam Pope", faction: "Leagues of Votann", detachment: "Oathband", elo: 2090, role_tag: "All-Rounder" },
  { name: "Brian Seipp", faction: "Necrons", detachment: "Hypercrypt Legion", elo: 2104, role_tag: "All-Rounder" }
];

class YuGiOhPairingsArena {
  constructor() {
    this.room = null;
    this.roomCode = "";
    this.activeRole = "captain_a"; // 'captain_a' | 'captain_b' | 'spectator'
    this.captainTokens = {
      captain_a: "",
      captain_b: ""
    };
    this.selectedIds = [];
    this.inspectedPlayer = null;
    this.pollTimer = null;

    // Lobby state
    this.lobbyDraftTeam = {
      captain_a: [],
      captain_b: []
    };
    this.lobbyTeamNames = {
      captain_a: "Art of War",
      captain_b: "Team Zero Comp"
    };
    this.searchPool = [...SEARCHABLE_PLAYERS_POOL];

    this.bindEvents();
    this.bootstrap();
  }

  bindEvents() {
    // Topbar role pills
    document.querySelectorAll("#roleSelectorPills .seat-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const role = btn.getAttribute("data-role");
        if (role) this.switchRole(role);
      });
    });

    // Open / Close Lobby Modal
    const btnOpenLobby = document.getElementById("btnOpenLobbyModal");
    if (btnOpenLobby) {
      btnOpenLobby.addEventListener("click", () => this.openLobbyModal());
    }
    const btnCloseLobby = document.getElementById("btnCloseLobbyModal");
    if (btnCloseLobby) {
      btnCloseLobby.addEventListener("click", () => this.closeLobbyModal());
    }

    // Lobby Seat Cards
    document.querySelectorAll(".lobby-seat-card").forEach((card) => {
      card.addEventListener("click", () => {
        const seat = card.getAttribute("data-seat");
        if (seat) this.selectLobbySeat(seat);
      });
    });

    // Lobby Team Name & Format
    const teamNameInput = document.getElementById("lobbyTeamNameInput");
    if (teamNameInput) {
      teamNameInput.addEventListener("input", () => {
        if (this.activeRole === "captain_a" || this.activeRole === "captain_b") {
          this.lobbyTeamNames[this.activeRole] = teamNameInput.value.trim() || "Custom Team";
        }
      });
    }

    const selectFormat = document.getElementById("selectFormat");
    if (selectFormat) {
      selectFormat.addEventListener("change", () => {
        this.trimOrPadLobbyDraft();
        this.renderLobbyDeckBuilder();
      });
    }

    const btnQuickFill = document.getElementById("btnQuickFillTeam");
    if (btnQuickFill) {
      btnQuickFill.addEventListener("click", () => this.autoFillLobbyHand());
    }

    const btnClearHand = document.getElementById("btnClearTeamHand");
    if (btnClearHand) {
      btnClearHand.addEventListener("click", () => {
        if (this.activeRole === "captain_a" || this.activeRole === "captain_b") {
          this.lobbyDraftTeam[this.activeRole] = [];
          this.renderLobbyDeckBuilder();
        }
      });
    }

    // Player Search Input
    const searchInput = document.getElementById("playerSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        this.onPlayerSearchInput(searchInput.value);
      });
    }

    // Start Duel from Lobby
    const btnStartDuel = document.getElementById("btnStartDuelFromLobby");
    if (btnStartDuel) {
      btnStartDuel.addEventListener("click", () => this.confirmLobbyAndEnterArena());
    }

    // Main Duel Confirm Button
    const btnLock = document.getElementById("btnLockSelection");
    if (btnLock) {
      btnLock.addEventListener("click", () => this.submitStagedSelection());
    }

    // Auto-Duel / New Room / Join / Copy
    const btnAutoFinish = document.getElementById("btnAutoFinish");
    if (btnAutoFinish) {
      btnAutoFinish.addEventListener("click", () => this.autoCompleteRemainingPhases());
    }

    const btnNewMatch = document.getElementById("btnNewMatch");
    if (btnNewMatch) {
      btnNewMatch.addEventListener("click", () => {
        this.createNewRoom({ openLobby: true });
      });
    }

    const btnJoinRoom = document.getElementById("btnJoinRoom");
    if (btnJoinRoom) {
      btnJoinRoom.addEventListener("click", () => {
        const inp = document.getElementById("joinRoomInput");
        const code = (inp ? inp.value : "").trim().toUpperCase();
        if (code) this.joinExistingRoom(code);
      });
    }

    const btnCopyRoomLink = document.getElementById("btnCopyRoomLink");
    if (btnCopyRoomLink) {
      btnCopyRoomLink.addEventListener("click", () => this.copyShareUrl());
    }

    const btnCopyPairings = document.getElementById("btnCopyPairings");
    if (btnCopyPairings) {
      btnCopyPairings.addEventListener("click", () => this.copyPairingsSummary());
    }
  }

  async bootstrap() {
    // Load live leaderboard players in background to enrich player search
    this.fetchLiveLeaderboardPool();

    const params = new URLSearchParams(window.location.search);
    const urlRoom = (params.get("room") || "").trim().toUpperCase();
    const urlRole = (params.get("role") || "").trim().toLowerCase();
    const demoState = (params.get("demo_state") || "").trim().toLowerCase();

    if (urlRole === "captain_a" || urlRole === "captain_b" || urlRole === "spectator") {
      this.activeRole = urlRole;
    }

    if (urlRoom) {
      await this.joinExistingRoom(urlRoom);
    } else {
      await this.createNewRoom({ openLobby: !demoState || demoState === "lobby" });
    }

    if (demoState) {
      await this.applyDemoState(demoState);
    }

    this.pollTimer = setInterval(() => this.pollRoomState(), 2500);
  }

  async fetchLiveLeaderboardPool() {
    try {
      const resp = await fetch("/api/leaderboard?limit=60");
      if (!resp.ok) return;
      const data = await resp.json();
      const rows = Array.isArray(data) ? data : (data.players || data.leaderboard || []);
      const seen = new Set(this.searchPool.map((p) => p.name.toLowerCase()));
      const factions = Object.keys(FACTION_META);
      rows.forEach((r, idx) => {
        const name = (r.player_name || r.name || "").trim();
        if (!name || seen.has(name.toLowerCase())) return;
        seen.add(name.toLowerCase());
        const fac = r.faction || r.primary_faction || factions[idx % factions.length];
        const meta = FACTION_META[fac] || FACTION_META["Space Marines"];
        this.searchPool.push({
          name,
          faction: fac in FACTION_META ? fac : "Space Marines",
          detachment: meta.detachment,
          elo: Math.round(Number(r.elo || r.rating || 2050)),
          role_tag: idx % 2 === 0 ? "Spear / Attacker" : "Blunt / Defender"
        });
      });
      this.renderSearchResults(document.getElementById("playerSearchInput")?.value || "");
    } catch (_) {
      // Offline or local mode: fallback pool already loaded
    }
  }

  getTargetHandSize() {
    const sel = document.getElementById("selectFormat");
    const fmt = sel ? sel.value : (this.room?.format_size || "5v5");
    return fmt === "8v8" ? 8 : 5;
  }

  syncLobbyDraftFromRoom() {
    if (!this.room) return;
    if (this.room.team_a && Array.isArray(this.room.team_a.roster)) {
      this.lobbyDraftTeam.captain_a = this.room.team_a.roster.map((p) => ({
        name: p.name,
        faction: p.faction,
        detachment: p.detachment || (FACTION_META[p.faction]?.detachment || "Index"),
        elo: p.elo || 2100,
        role_tag: p.role_tag || "All-Rounder"
      }));
      this.lobbyTeamNames.captain_a = this.room.team_a.name || "Art of War";
    }
    if (this.room.team_b && Array.isArray(this.room.team_b.roster)) {
      this.lobbyDraftTeam.captain_b = this.room.team_b.roster.map((p) => ({
        name: p.name,
        faction: p.faction,
        detachment: p.detachment || (FACTION_META[p.faction]?.detachment || "Index"),
        elo: p.elo || 2100,
        role_tag: p.role_tag || "All-Rounder"
      }));
      this.lobbyTeamNames.captain_b = this.room.team_b.name || "Team Zero Comp";
    }
  }

  trimOrPadLobbyDraft() {
    const target = this.getTargetHandSize();
    ["captain_a", "captain_b"].forEach((roleKey, sideIdx) => {
      const list = this.lobbyDraftTeam[roleKey] || [];
      if (list.length > target) {
        this.lobbyDraftTeam[roleKey] = list.slice(0, target);
      } else if (list.length < target) {
        const offset = sideIdx * 5;
        for (let i = list.length; i < target; i++) {
          const fallback = this.searchPool[(offset + i) % this.searchPool.length];
          list.push({ ...fallback });
        }
        this.lobbyDraftTeam[roleKey] = list;
      }
    });
  }

  openLobbyModal() {
    const modal = document.getElementById("lobbyModalBackdrop");
    if (modal) modal.classList.remove("hidden");
    this.selectLobbySeat(this.activeRole);
  }

  closeLobbyModal() {
    const modal = document.getElementById("lobbyModalBackdrop");
    if (modal) modal.classList.add("hidden");
  }

  selectLobbySeat(seat) {
    this.activeRole = seat;
    this.selectedIds = [];

    document.querySelectorAll(".lobby-seat-card").forEach((c) => {
      c.classList.toggle("active", c.getAttribute("data-seat") === seat);
    });
    document.querySelectorAll("#roleSelectorPills .seat-chip").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-role") === seat);
    });

    const builderSec = document.getElementById("lobbyDeckBuilderSection");
    const statusHint = document.getElementById("lobbyStatusHint");
    const startBtn = document.getElementById("btnStartDuelFromLobby");

    if (seat === "spectator") {
      if (builderSec) builderSec.classList.add("hidden");
      if (statusHint) statusHint.textContent = "Spectator Seat selected — you will watch the live card duel in read-only mode.";
      if (startBtn) startBtn.textContent = "👁️ WATCH DUEL FIELD";
    } else {
      if (builderSec) builderSec.classList.remove("hidden");
      const teamNameInput = document.getElementById("lobbyTeamNameInput");
      if (teamNameInput) {
        teamNameInput.value = this.lobbyTeamNames[seat] || (seat === "captain_a" ? "Art of War" : "Team Zero Comp");
      }
      this.renderLobbyDeckBuilder();
      if (startBtn) startBtn.textContent = "⚔️ ENTER DUEL ARENA";
    }

    this.renderAll();
  }

  onPlayerSearchInput(query) {
    this.renderSearchResults(query);
  }

  renderSearchResults(query = "") {
    const container = document.getElementById("playerSearchResults");
    if (!container) return;

    const q = (query || "").trim().toLowerCase();
    const roleKey = this.activeRole === "captain_b" ? "captain_b" : "captain_a";
    const currentHand = this.lobbyDraftTeam[roleKey] || [];
    const inHandNames = new Set(currentHand.map((p) => p.name.toLowerCase()));

    let matches = this.searchPool.filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.faction.toLowerCase().includes(q) ||
        (p.detachment || "").toLowerCase().includes(q)
      );
    });

    // If user typed a custom player name not in pool, offer instant custom player creation!
    if (q.length >= 2 && !matches.some((p) => p.name.toLowerCase() === q)) {
      const customName = query.trim();
      matches = [
        {
          name: customName,
          faction: "Space Marines",
          detachment: "Gladius Task Force",
          elo: 2050,
          role_tag: "All-Rounder",
          isCustom: true
        },
        ...matches
      ];
    }

    container.innerHTML = matches.slice(0, 14).map((p, idx) => {
      const meta = FACTION_META[p.faction] || FACTION_META["Space Marines"];
      const alreadyIn = inHandNames.has(p.name.toLowerCase());
      return `
        <div class="search-result-pill ${alreadyIn ? "in-hand" : ""}" data-search-idx="${idx}">
          <span class="srp-ico">${meta.icon}</span>
          <div class="srp-main">
            <span class="srp-name">${this.escapeHtml(p.name)}</span>
            <span class="srp-sub">${this.escapeHtml(p.faction)} • ${p.elo}</span>
          </div>
          <span class="srp-add">${alreadyIn ? "✓ IN HAND" : "+ ADD"}</span>
        </div>
      `;
    }).join("");

    container.querySelectorAll(".search-result-pill").forEach((pill, i) => {
      pill.addEventListener("click", () => {
        const picked = matches[i];
        if (picked) this.addPlayerToLobbyHand(picked);
      });
    });
  }

  addPlayerToLobbyHand(playerObj) {
    if (this.activeRole !== "captain_a" && this.activeRole !== "captain_b") return;
    const targetSize = this.getTargetHandSize();
    const list = this.lobbyDraftTeam[this.activeRole] || [];

    const overrideSel = document.getElementById("playerSearchFactionOverride");
    const chosenFaction = (overrideSel && overrideSel.value) ? overrideSel.value : playerObj.faction;
    const meta = FACTION_META[chosenFaction] || FACTION_META["Space Marines"];

    const existingIdx = list.findIndex((p) => p.name.toLowerCase() === playerObj.name.toLowerCase());
    if (existingIdx >= 0) {
      // Update faction if already in hand
      list[existingIdx].faction = chosenFaction;
      list[existingIdx].detachment = meta.detachment;
      this.showToast(`Updated ${playerObj.name} (${chosenFaction})`);
    } else if (list.length < targetSize) {
      list.push({
        name: playerObj.name,
        faction: chosenFaction,
        detachment: meta.detachment,
        elo: playerObj.elo || 2080,
        role_tag: playerObj.role_tag || "All-Rounder"
      });
    } else {
      // Replace the last slot if hand is full
      list[targetSize - 1] = {
        name: playerObj.name,
        faction: chosenFaction,
        detachment: meta.detachment,
        elo: playerObj.elo || 2080,
        role_tag: playerObj.role_tag || "All-Rounder"
      };
      this.showToast(`Swapped ${playerObj.name} into slot #${targetSize}`);
    }

    this.lobbyDraftTeam[this.activeRole] = list;
    this.renderLobbyDeckBuilder();
  }

  autoFillLobbyHand() {
    if (this.activeRole !== "captain_a" && this.activeRole !== "captain_b") return;
    const targetSize = this.getTargetHandSize();
    const offset = this.activeRole === "captain_a" ? 0 : 5;
    const filled = [];
    for (let i = 0; i < targetSize; i++) {
      const p = this.searchPool[(offset + i) % this.searchPool.length];
      filled.push({ ...p });
    }
    this.lobbyDraftTeam[this.activeRole] = filled;
    this.renderLobbyDeckBuilder();
    this.showToast(`Auto-filled ${targetSize} pro player cards!`);
  }

  renderLobbyDeckBuilder() {
    const roleKey = this.activeRole === "captain_b" ? "captain_b" : "captain_a";
    const targetSize = this.getTargetHandSize();
    const hand = this.lobbyDraftTeam[roleKey] || [];

    const countLbl = document.getElementById("lobbyDeckCountLabel");
    if (countLbl) countLbl.textContent = `${hand.length} / ${targetSize}`;

    const statusHint = document.getElementById("lobbyStatusHint");
    if (statusHint) {
      if (hand.length < targetSize) {
        statusHint.textContent = `Select ${targetSize - hand.length} more player card(s) via search above, or click Auto-Fill.`;
      } else {
        statusHint.textContent = `Ready! ${targetSize}/${targetSize} Player Cards in your hand. Click ENTER DUEL ARENA.`;
      }
    }

    const searchInput = document.getElementById("playerSearchInput");
    this.renderSearchResults(searchInput ? searchInput.value : "");

    const tray = document.getElementById("lobbyHandTray");
    if (!tray) return;

    const slotsHtml = [];
    for (let i = 0; i < targetSize; i++) {
      const p = hand[i];
      if (p) {
        slotsHtml.push(`
          <div class="lobby-card-slot-wrap">
            <button type="button" class="lobby-remove-card-btn" data-remove-idx="${i}" title="Remove Player">✕</button>
            ${this.buildYuGiOhCardHtml({
              id: `DRAFT_${i + 1}`,
              name: p.name,
              faction: p.faction,
              detachment: p.detachment,
              elo: p.elo,
              role_tag: p.role_tag
            })}
          </div>
        `);
      } else {
        slotsHtml.push(`
          <div class="lobby-empty-slot">
            <span style="font-size:1.3rem;">➕</span>
            <span>EMPTY CARD SLOT #${i + 1}</span>
            <span>Click a player above</span>
          </div>
        `);
      }
    }
    tray.innerHTML = slotsHtml.join("");

    tray.querySelectorAll(".lobby-remove-card-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute("data-remove-idx"));
        const arr = this.lobbyDraftTeam[roleKey] || [];
        arr.splice(idx, 1);
        this.lobbyDraftTeam[roleKey] = arr;
        this.renderLobbyDeckBuilder();
      });
    });
  }

  async confirmLobbyAndEnterArena() {
    if (this.activeRole === "spectator") {
      this.closeLobbyModal();
      this.renderAll();
      return;
    }

    const targetSize = this.getTargetHandSize();
    const hand = this.lobbyDraftTeam[this.activeRole] || [];
    if (hand.length < targetSize) {
      this.autoFillLobbyHand();
    }

    const finalHand = this.lobbyDraftTeam[this.activeRole];
    const teamName = (document.getElementById("lobbyTeamNameInput")?.value || "").trim() ||
      (this.activeRole === "captain_a" ? "Art of War" : "Team Zero Comp");
    const tag = teamName
      .split(/\s+/)
      .map((w) => w[0] || "")
      .join("")
      .toUpperCase()
      .slice(0, 4) || (this.activeRole === "captain_a" ? "TMA" : "TMB");

    if (this.roomCode) {
      try {
        const tok = this.captainTokens[this.activeRole] || "";
        const resp = await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: this.activeRole,
            captain_token: tok,
            action: "set_team_roster",
            payload: {
              team_name: teamName,
              team_tag: tag,
              roster: finalHand
            }
          })
        });
        const data = await resp.json();
        if (data && (data.ok || data.success) && data.room) {
          this.room = data.room;
          if (data.captain_token) {
            this.captainTokens[this.activeRole] = data.captain_token;
          }
        }
      } catch (_) {
        // Ignore network error in offline mode
      }
    }

    this.closeLobbyModal();
    this.renderAll();
    this.showToast(`Seated as ${this.activeRole === "captain_a" ? "Team A Captain" : "Team B Captain"} — Your cards are at the bottom!`);
  }

  async createNewRoom({ openLobby = false } = {}) {
    const fmt = document.getElementById("selectFormat")?.value || "5v5";
    const vsAi = document.getElementById("chkVsAi")?.checked ?? true;

    try {
      const resp = await fetch("/api/team-pairings/room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format_size: fmt,
          team_a_preset: "art_of_war",
          team_b_preset: "team_zero_comp",
          vs_ai: vsAi
        })
      });
      const data = await resp.json();
      if (data && (data.ok || data.success) && data.room) {
        this.room = data.room;
        this.roomCode = data.room.room_code;
        this.captainTokens.captain_a = data.captain_a_token || data.room.captain_a_token || "";
        this.captainTokens.captain_b = data.captain_b_token || data.room.captain_b_token || "";
        this.selectedIds = [];
        this.syncLobbyDraftFromRoom();

        const lobbyCodeEl = document.getElementById("lobbyRoomCodeText");
        if (lobbyCodeEl) lobbyCodeEl.textContent = this.roomCode;

        if (openLobby) {
          this.openLobbyModal();
        } else {
          this.closeLobbyModal();
        }
        this.renderAll();
      }
    } catch (err) {
      console.error("Failed to create pairing room:", err);
    }
  }

  async joinExistingRoom(code) {
    try {
      const resp = await fetch(
        `/api/team-pairings/room/${encodeURIComponent(code)}?role=${encodeURIComponent(this.activeRole)}`
      );
      const data = await resp.json();
      if (data && (data.ok || data.success) && data.room) {
        this.room = data.room;
        this.roomCode = data.room.room_code;
        if (data.room.captain_a_token) this.captainTokens.captain_a = data.room.captain_a_token;
        if (data.room.captain_b_token) this.captainTokens.captain_b = data.room.captain_b_token;
        this.selectedIds = [];
        this.syncLobbyDraftFromRoom();
        const lobbyCodeEl = document.getElementById("lobbyRoomCodeText");
        if (lobbyCodeEl) lobbyCodeEl.textContent = this.roomCode;
        this.renderAll();
      } else {
        this.showToast(`Room ${code} not found`);
      }
    } catch (err) {
      console.error("Failed to join room:", err);
    }
  }

  async pollRoomState() {
    if (!this.roomCode) return;
    try {
      const resp = await fetch(
        `/api/team-pairings/room/${encodeURIComponent(this.roomCode)}?role=${encodeURIComponent(this.activeRole)}`
      );
      if (!resp.ok) return;
      const data = await resp.json();
      if (data && (data.ok || data.success) && data.room) {
        const oldRev = this.room?.revision;
        this.room = data.room;
        if (oldRev !== this.room.revision) {
          this.renderAll();
        }
      }
    } catch (_) {
      // Ignore transient poll errors
    }
  }

  async switchRole(newRole) {
    this.activeRole = newRole;
    this.selectedIds = [];
    document.querySelectorAll("#roleSelectorPills .seat-chip").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-role") === newRole);
    });
    if (this.roomCode) {
      await this.joinExistingRoom(this.roomCode);
    } else {
      this.renderAll();
    }
  }

  /**
   * Player-Specific Perspective Helper:
   * Maps `my` (Bottom of Playmat) and `opp` (Top of Playmat) based on `this.activeRole`.
   */
  getPerspective() {
    const r = this.room;
    if (!r) return null;
    const isCapB = this.activeRole === "captain_b";
    return {
      isCapB,
      isSpectator: this.activeRole === "spectator",
      myTeam: isCapB ? r.team_b : r.team_a,
      oppTeam: isCapB ? r.team_a : r.team_b,
      myDef: isCapB ? r.active_defender_b : r.active_defender_a,
      oppDef: isCapB ? r.active_defender_a : r.active_defender_b,
      myAtts: isCapB ? (r.active_attackers_b || []) : (r.active_attackers_a || []),
      oppAtts: isCapB ? (r.active_attackers_a || []) : (r.active_attackers_b || []),
      mySecDef: isCapB ? r.secret_defender_b : r.secret_defender_a,
      oppSecDefLocked: isCapB ? r.secret_defender_a_locked : r.secret_defender_b_locked,
      mySecDefLocked: isCapB ? r.secret_defender_b_locked : r.secret_defender_a_locked,
      mySecAtts: isCapB ? (r.secret_attackers_b || []) : (r.secret_attackers_a || []),
      oppSecAttsLocked: isCapB ? r.secret_attackers_a_locked : r.secret_attackers_b_locked,
      mySecAttsLocked: isCapB ? r.secret_attackers_b_locked : r.secret_attackers_a_locked,
      mySecChoice: isCapB ? r.secret_choice_b : r.secret_choice_a,
      oppSecChoiceLocked: isCapB ? r.secret_choice_a_locked : r.secret_choice_b_locked,
      mySecChoiceLocked: isCapB ? r.secret_choice_b_locked : r.secret_choice_a_locked
    };
  }

  getMatchupEstimate(myPlayer, oppPlayer) {
    if (!myPlayer || !oppPlayer) return 10;
    if (this.room && this.room.matchup_matrix) {
      const m = this.room.matchup_matrix;
      if (this.activeRole === "captain_b") {
        const aScore = m[oppPlayer.id]?.[myPlayer.id];
        if (typeof aScore === "number") return 20 - aScore;
      } else {
        const score = m[myPlayer.id]?.[oppPlayer.id];
        if (typeof score === "number") return score;
      }
    }
    const eloDiff = Number(myPlayer.elo || 2050) - Number(oppPlayer.elo || 2050);
    const f1 = String(myPlayer.faction || "");
    const f2 = String(oppPlayer.faction || "");
    let hash = 0;
    const pairStr = `${f1}__vs__${f2}`;
    for (let i = 0; i < pairStr.length; i++) {
      hash = (hash * 31 + pairStr.charCodeAt(i)) % 997;
    }
    const facBias = (f1 === f2) ? 0 : ((hash % 7) - 3);
    const raw = Math.round(10 + eloDiff / 45 + facBias);
    return Math.max(4, Math.min(16, raw));
  }

  renderAll() {
    if (!this.room) return;
    const p = this.getPerspective();
    if (!p) return;

    // Topbar Room Code
    const roomBadge = document.getElementById("roomCodeBadge");
    if (roomBadge) roomBadge.textContent = `ROOM: ${this.room.room_code}`;

    // Spectator Banner
    const specBanner = document.getElementById("spectatorBanner");
    if (specBanner) {
      specBanner.classList.toggle("hidden", !p.isSpectator);
    }

    // Update Right Duelist HUD
    this.renderDuelistHud(p);

    // Update Center Battle Line Phase Tokens & Action Button
    this.renderBattleLine(p);

    // Update 3D Playmat Slots (Opponent Top Half + Your Bottom Half)
    this.renderPlaymatZones(p);

    // Update Opponent's Fanned Face-Down Hand (Top) & Your Upright Player Card Hand (Bottom)
    this.renderHands(p);

    // Update Paired Tables Stack on Right Panel
    this.renderPairedTables();

    // Ensure Left Card Inspector displays a relevant card
    if (!this.inspectedPlayer) {
      const bench = (p.myTeam.roster || []).filter((c) => c.status === "bench");
      this.inspectCard(bench[0] || p.myDef || p.myTeam.roster?.[0], p.oppDef);
    } else {
      this.inspectCard(this.inspectedPlayer, p.oppDef);
    }
  }

  renderDuelistHud(p) {
    const oppTag = document.getElementById("oppHudTag");
    const oppName = document.getElementById("oppHudTeamName");
    const oppCap = document.getElementById("oppHudCaptain");
    const oppStatus = document.getElementById("capBStatusPill");

    if (oppTag) oppTag.textContent = p.oppTeam.tag || "OPP";
    if (oppName) oppName.textContent = p.oppTeam.name || "Opponent Team";
    if (oppCap) oppCap.textContent = `Cap: ${p.oppTeam.captain_name || "Opponent"}`;

    const myTag = document.getElementById("myHudTag");
    const myName = document.getElementById("myHudTeamName");
    const myCap = document.getElementById("myHudCaptain");
    const myStatus = document.getElementById("capAStatusPill");

    if (myTag) myTag.textContent = p.myTeam.tag || "YOU";
    if (myName) myName.textContent = p.myTeam.name || "Your Team";
    if (myCap) myCap.textContent = `Cap: ${p.myTeam.captain_name || "You"} (${p.isSpectator ? "Spectating" : "YOU"})`;

    const phase = this.room.phase;
    let oppLocked = false;
    let myLocked = false;
    if (phase === "STEP_1_DEFENDER") {
      oppLocked = !!p.oppSecDefLocked;
      myLocked = !!p.mySecDefLocked;
    } else if (phase === "STEP_2_ATTACKERS") {
      oppLocked = !!p.oppSecAttsLocked;
      myLocked = !!p.mySecAttsLocked;
    } else if (phase === "STEP_3_CHOOSE") {
      oppLocked = !!p.oppSecChoiceLocked;
      myLocked = !!p.mySecChoiceLocked;
    } else if (phase === "COMPLETED") {
      oppLocked = true;
      myLocked = true;
    }

    if (oppStatus) {
      oppStatus.textContent = oppLocked ? "✓ CARD SET" : "⏳ THINKING";
      oppStatus.classList.toggle("ready", oppLocked);
    }
    if (myStatus) {
      myStatus.textContent = myLocked ? "✓ LOCKED IN" : (p.isSpectator ? "👁️ VIEWING" : "⚡ YOUR TURN");
      myStatus.classList.toggle("ready", myLocked);
    }
  }

  renderBattleLine(p) {
    const phase = this.room.phase;
    const cycleBadge = document.getElementById("cycleBadge");
    if (cycleBadge) {
      cycleBadge.textContent = phase === "COMPLETED"
        ? "DUEL COMPLETE"
        : `CYCLE ${this.room.cycle}/${this.room.max_cycles}`;
    }

    const pDef = document.getElementById("stepPillDefender");
    const pAtt = document.getElementById("stepPillAttackers");
    const pCho = document.getElementById("stepPillChoose");
    const pCom = document.getElementById("stepPillComplete");

    [pDef, pAtt, pCho, pCom].forEach((el) => {
      if (el) el.classList.remove("active", "done");
    });

    if (phase === "STEP_1_DEFENDER") {
      pDef?.classList.add("active");
    } else if (phase === "STEP_2_ATTACKERS") {
      pDef?.classList.add("done");
      pAtt?.classList.add("active");
    } else if (phase === "STEP_3_CHOOSE") {
      pDef?.classList.add("done");
      pAtt?.classList.add("done");
      pCho?.classList.add("active");
    } else if (phase === "COMPLETED") {
      pDef?.classList.add("done");
      pAtt?.classList.add("done");
      pCho?.classList.add("done");
      pCom?.classList.add("active");
    }

    const promptEl = document.getElementById("phasePromptText");
    const btnLock = document.getElementById("btnLockSelection");
    const hintBadge = document.getElementById("selectionHintBadge");

    if (p.isSpectator) {
      if (promptEl) promptEl.textContent = "SPECTATOR MODE — WATCHING CAPTAINS PLACE CARDS";
      if (btnLock) {
        btnLock.disabled = true;
        btnLock.textContent = "👁️ SPECTATING";
      }
      if (hintBadge) hintBadge.textContent = "VIEW";
      return;
    }

    if (phase === "STEP_1_DEFENDER") {
      const ready = this.selectedIds.length === 1;
      if (hintBadge) hintBadge.textContent = `${this.selectedIds.length}/1`;
      if (p.mySecDefLocked) {
        if (promptEl) promptEl.textContent = "DEFENDER SET FACE-DOWN — WAITING FOR OPPONENT";
        if (btnLock) {
          btnLock.disabled = true;
          btnLock.textContent = "✓ DEFENDER LOCKED";
        }
      } else {
        if (promptEl) {
          promptEl.textContent = ready
            ? "DEFENDER PLACED ON FIELD — CLICK LOCK IN DEFENDER!"
            : "PHASE 1: CLICK 1 CARD IN YOUR BOTTOM HAND TO PLACE AS DEFENDER";
        }
        if (btnLock) {
          btnLock.disabled = !ready;
          btnLock.textContent = "🔒 LOCK IN DEFENDER";
        }
      }
    } else if (phase === "STEP_2_ATTACKERS") {
      const ready = this.selectedIds.length === 2;
      if (hintBadge) hintBadge.textContent = `${this.selectedIds.length}/2`;
      if (p.mySecAttsLocked) {
        if (promptEl) promptEl.textContent = "2 ATTACKERS SET — WAITING FOR OPPONENT";
        if (btnLock) {
          btnLock.disabled = true;
          btnLock.textContent = "✓ ATTACKERS LOCKED";
        }
      } else {
        if (promptEl) {
          promptEl.textContent = ready
            ? "2 ATTACKERS PLACED ON FIELD — CLICK LOCK IN 2 ATTACKERS!"
            : "PHASE 2: CLICK 2 CARDS IN YOUR BOTTOM HAND TO ATTACK ENEMY DEFENDER";
        }
        if (btnLock) {
          btnLock.disabled = !ready;
          btnLock.textContent = "🔒 LOCK IN 2 ATTACKERS";
        }
      }
    } else if (phase === "STEP_3_CHOOSE") {
      const ready = this.selectedIds.length === 1;
      if (hintBadge) hintBadge.textContent = `${this.selectedIds.length}/1`;
      if (p.mySecChoiceLocked) {
        if (promptEl) promptEl.textContent = "CLASH LOCKED — WAITING FOR OPPONENT";
        if (btnLock) {
          btnLock.disabled = true;
          btnLock.textContent = "✓ CLASH LOCKED";
        }
      } else {
        if (promptEl) {
          promptEl.textContent = ready
            ? "ENEMY ATTACKER TARGETED — CLICK LOCK IN CLASH!"
            : "PHASE 3: CLICK 1 PULSING ENEMY ATTACKER ON THE TOP FIELD FOR YOUR DEFENDER";
        }
        if (btnLock) {
          btnLock.disabled = !ready;
          btnLock.textContent = "🔒 LOCK IN CLASH";
        }
      }
    } else {
      if (hintBadge) hintBadge.textContent = "DONE";
      if (promptEl) promptEl.textContent = "ALL MATCH PAIRINGS COMPLETE!";
      if (btnLock) {
        btnLock.disabled = true;
        btnLock.textContent = "🏆 ALL TABLES SET";
      }
    }
  }

  renderPlaymatZones(p) {
    const phase = this.room.phase;
    const myBench = (p.myTeam.roster || []).filter((c) => c.status === "bench");
    const oppBench = (p.oppTeam.roster || []).filter((c) => c.status === "bench");

    const oppCountEl = document.getElementById("oppBenchCountBadge");
    if (oppCountEl) oppCountEl.textContent = String(oppBench.length);

    const stagedCount = (phase === "STEP_1_DEFENDER" || phase === "STEP_2_ATTACKERS") ? this.selectedIds.length : 0;
    const myCountEl = document.getElementById("myBenchCountBadge");
    if (myCountEl) myCountEl.textContent = String(Math.max(0, myBench.length - stagedCount));

    const pairedTop = document.getElementById("matPairedCountTop");
    if (pairedTop) {
      pairedTop.textContent = `${(this.room.pairings || []).length}/${this.room.total_tables || 5}`;
    }

    // Highlight active target slot on playmat
    const myDefSlot = document.getElementById("myDefenderSlot");
    const myAttSlot = document.getElementById("myAttackersSlot");
    const oppAttSlot = document.getElementById("oppAttackersSlot");
    myDefSlot?.classList.toggle("active-target-zone", phase === "STEP_1_DEFENDER" && !p.isSpectator);
    myAttSlot?.classList.toggle("active-target-zone", phase === "STEP_2_ATTACKERS" && !p.isSpectator);
    oppAttSlot?.classList.toggle("active-target-zone", phase === "STEP_3_CHOOSE" && !p.isSpectator);

    // 1. OPPONENT DEFENDER MOUNT
    const oppDefMount = document.getElementById("oppDefenderMount");
    if (oppDefMount) {
      if (p.oppDef) {
        oppDefMount.innerHTML = this.buildYuGiOhCardHtml(p.oppDef, { fieldSize: true });
        this.attachCardInspectHandler(oppDefMount, p.oppDef);
      } else if (p.oppSecDefLocked) {
        oppDefMount.innerHTML = this.buildFaceDownFieldCardHtml("ENEMY DEF SET");
      } else {
        oppDefMount.innerHTML = `<div class="empty-zone-sigil"><span class="sigil-icon">🛡️</span><span>DEFENDER</span></div>`;
      }
    }

    // 2. OPPONENT 2 ATTACKERS MOUNT (In Phase 3, YOU click 1 of these 2 to fight your Defender!)
    const oppAttMount = document.getElementById("oppAttackersMount");
    if (oppAttMount) {
      if (p.oppAtts && p.oppAtts.length > 0) {
        oppAttMount.innerHTML = p.oppAtts.map((att) => {
          const isChosen = phase === "STEP_3_CHOOSE" && (this.selectedIds.includes(att.id) || p.mySecChoice === att.id);
          const canPick = phase === "STEP_3_CHOOSE" && !p.isSpectator && !p.mySecChoiceLocked;
          const vsMyDefScore = p.myDef ? this.getMatchupEstimate(p.myDef, att) : null;
          return this.buildYuGiOhCardHtml(att, {
            fieldSize: true,
            selected: isChosen,
            clashChoice: canPick,
            matchupScore: vsMyDefScore
          });
        }).join("");

        oppAttMount.querySelectorAll(".ygo-card").forEach((cardEl, idx) => {
          const attObj = p.oppAtts[idx];
          cardEl.addEventListener("mouseenter", () => this.inspectCard(attObj, p.myDef));
          cardEl.addEventListener("click", () => {
            this.inspectCard(attObj, p.myDef);
            if (phase === "STEP_3_CHOOSE" && !p.isSpectator && !p.mySecChoiceLocked) {
              this.selectedIds = [attObj.id];
              this.renderAll();
            }
          });
        });
      } else if (p.oppSecAttsLocked) {
        oppAttMount.innerHTML =
          this.buildFaceDownFieldCardHtml("ATTACKER 1") +
          this.buildFaceDownFieldCardHtml("ATTACKER 2");
      } else {
        oppAttMount.innerHTML = `
          <div class="empty-zone-sigil"><span class="sigil-icon">⚔️</span><span>ATK 1</span></div>
          <div class="empty-zone-sigil"><span class="sigil-icon">⚔️</span><span>ATK 2</span></div>
        `;
      }
    }

    // 3. YOUR DEFENDER MOUNT (Shows revealed defender, or your staged card during STEP_1_DEFENDER!)
    const myDefMount = document.getElementById("myDefenderMount");
    if (myDefMount) {
      let stagedDef = null;
      if (phase === "STEP_1_DEFENDER") {
        const targetId = p.mySecDef || this.selectedIds[0];
        if (targetId) {
          stagedDef = (p.myTeam.roster || []).find((c) => c.id === targetId);
        }
      }
      const cardToShow = p.myDef || stagedDef;
      if (cardToShow) {
        myDefMount.innerHTML = this.buildYuGiOhCardHtml(cardToShow, {
          fieldSize: true,
          selected: !p.myDef
        });
        const cardEl = myDefMount.querySelector(".ygo-card");
        if (cardEl) {
          cardEl.addEventListener("mouseenter", () => this.inspectCard(cardToShow, p.oppDef));
          cardEl.addEventListener("click", () => {
            this.inspectCard(cardToShow, p.oppDef);
            if (phase === "STEP_1_DEFENDER" && !p.mySecDefLocked) {
              this.toggleHandCardSelection(cardToShow.id);
            }
          });
        }
      } else if (p.mySecDefLocked) {
        myDefMount.innerHTML = this.buildFaceDownFieldCardHtml("LOCKED DEF");
      } else {
        myDefMount.innerHTML = `<div class="empty-zone-sigil"><span class="sigil-icon">🛡️</span><span>CLICK HAND CARD</span></div>`;
      }
    }

    // 4. YOUR 2 ATTACKERS MOUNT (Shows revealed attackers, or your 1-2 staged cards during STEP_2_ATTACKERS!)
    const myAttMount = document.getElementById("myAttackersMount");
    if (myAttMount) {
      let cardsToShow = [];
      if (p.myAtts && p.myAtts.length > 0) {
        cardsToShow = p.myAtts;
      } else if (phase === "STEP_2_ATTACKERS") {
        const ids = (p.mySecAtts && p.mySecAtts.length > 0) ? p.mySecAtts : this.selectedIds;
        cardsToShow = ids
          .map((id) => (p.myTeam.roster || []).find((c) => c.id === id))
          .filter(Boolean);
      }

      if (cardsToShow.length > 0) {
        const slots = [];
        for (let i = 0; i < 2; i++) {
          const c = cardsToShow[i];
          if (c) {
            const mScore = p.oppDef ? this.getMatchupEstimate(c, p.oppDef) : null;
            slots.push(this.buildYuGiOhCardHtml(c, {
              fieldSize: true,
              selected: !(p.myAtts && p.myAtts.length > 0),
              matchupScore: mScore
            }));
          } else {
            slots.push(`<div class="empty-zone-sigil"><span class="sigil-icon">⚔️</span><span>PICK 2ND CARD</span></div>`);
          }
        }
        myAttMount.innerHTML = slots.join("");
        myAttMount.querySelectorAll(".ygo-card").forEach((el, idx) => {
          const cObj = cardsToShow[idx];
          if (cObj) {
            el.addEventListener("mouseenter", () => this.inspectCard(cObj, p.oppDef));
            el.addEventListener("click", () => {
              if (phase === "STEP_2_ATTACKERS" && !p.mySecAttsLocked) {
                this.toggleHandCardSelection(cObj.id);
              }
            });
          }
        });
      } else if (p.mySecAttsLocked) {
        myAttMount.innerHTML =
          this.buildFaceDownFieldCardHtml("LOCKED ATK 1") +
          this.buildFaceDownFieldCardHtml("LOCKED ATK 2");
      } else {
        myAttMount.innerHTML = `
          <div class="empty-zone-sigil"><span class="sigil-icon">⚔️</span><span>ATTACKER 1</span></div>
          <div class="empty-zone-sigil"><span class="sigil-icon">⚔️</span><span>ATTACKER 2</span></div>
        `;
      }
    }
  }

  renderHands(p) {
    const phase = this.room.phase;
    const oppBench = (p.oppTeam.roster || []).filter((c) => c.status === "bench");
    const rawMyBench = (p.myTeam.roster || []).filter((c) => c.status === "bench");
    // Cards currently placed onto a playmat slot leave the bottom hand fan until clicked back!
    const stagedOnMatIds = new Set(
      (phase === "STEP_1_DEFENDER" || phase === "STEP_2_ATTACKERS") ? this.selectedIds : []
    );
    const myBench = rawMyBench.filter((c) => !stagedOnMatIds.has(c.id));

    // Top: Opponent's Fanned Face-Down Hand
    const oppFan = document.getElementById("oppHandFan");
    if (oppFan) {
      oppFan.innerHTML = oppBench.map((_, i) => {
        const mid = (oppBench.length - 1) / 2;
        const deg = (i - mid) * 4;
        return `<div class="opp-card-back" style="transform: rotate(${deg}deg);"></div>`;
      }).join("");
    }

    // Bottom: Your Upright Collectible Player Card Hand
    const handTitle = document.getElementById("myHandOwnerTitle");
    if (handTitle) {
      handTitle.textContent = p.isSpectator
        ? `${p.myTeam.name.toUpperCase()} HAND (${myBench.length} CARDS REMAINING)`
        : `YOUR HAND — ${p.myTeam.name.toUpperCase()} (${myBench.length} CARDS IN HAND • CLICK TO PLACE ON FIELD)`;
    }

    const myFan = document.getElementById("myHandFan");
    if (!myFan) return;

    if (myBench.length === 0) {
      myFan.innerHTML = `<div style="color:var(--text-dim);font-family:var(--font-mono);font-size:0.75rem;align-self:center;">ALL CARDS PLACED ON FIELD</div>`;
      return;
    }

    myFan.innerHTML = myBench.map((card) => {
      const mScore = (phase === "STEP_2_ATTACKERS" && p.oppDef)
        ? this.getMatchupEstimate(card, p.oppDef)
        : null;
      return this.buildYuGiOhCardHtml(card, {
        selected: false,
        matchupScore: mScore
      });
    }).join("");

    myFan.querySelectorAll(".ygo-card").forEach((cardEl, idx) => {
      const cardObj = myBench[idx];
      cardEl.addEventListener("mouseenter", () => this.inspectCard(cardObj, p.oppDef));
      cardEl.addEventListener("click", () => {
        this.inspectCard(cardObj, p.oppDef);
        if (!p.isSpectator) {
          this.toggleHandCardSelection(cardObj.id);
        }
      });
    });
  }

  toggleHandCardSelection(cardId) {
    if (!this.room) return;
    const phase = this.room.phase;
    const p = this.getPerspective();
    if (!p || p.isSpectator) return;

    if (phase === "STEP_1_DEFENDER" && !p.mySecDefLocked) {
      if (this.selectedIds.includes(cardId)) {
        this.selectedIds = [];
      } else {
        this.selectedIds = [cardId];
      }
      this.renderAll();
    } else if (phase === "STEP_2_ATTACKERS" && !p.mySecAttsLocked) {
      if (this.selectedIds.includes(cardId)) {
        this.selectedIds = this.selectedIds.filter((id) => id !== cardId);
      } else if (this.selectedIds.length < 2) {
        this.selectedIds.push(cardId);
      } else {
        this.selectedIds = [this.selectedIds[1], cardId];
      }
      this.renderAll();
    }
  }

  async submitStagedSelection() {
    if (!this.room || !this.roomCode) return;
    const phase = this.room.phase;
    const p = this.getPerspective();
    if (!p || p.isSpectator) return;

    const vsAi = document.getElementById("chkVsAi")?.checked ?? true;
    const tok = this.captainTokens[this.activeRole] || "";

    let action = "";
    let payload = { vs_ai: vsAi };

    if (phase === "STEP_1_DEFENDER" && this.selectedIds.length === 1) {
      action = "lock_defender";
      payload.player_id = this.selectedIds[0];
    } else if (phase === "STEP_2_ATTACKERS" && this.selectedIds.length === 2) {
      action = "lock_attackers";
      payload.player_ids = [...this.selectedIds];
    } else if (phase === "STEP_3_CHOOSE" && this.selectedIds.length === 1) {
      action = "lock_choice";
      payload.player_id = this.selectedIds[0];
    } else {
      return;
    }

    try {
      const resp = await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: this.activeRole,
          captain_token: tok,
          action,
          payload
        })
      });
      const data = await resp.json();
      if (data && data.ok && data.room) {
        this.room = data.room;
        this.selectedIds = [];
        this.renderAll();
      } else if (data && data.error) {
        this.showToast(data.error);
      }
    } catch (err) {
      console.error("Failed to submit card action:", err);
    }
  }

  async autoCompleteRemainingPhases() {
    if (!this.room || !this.roomCode) return;
    const roleToUse = this.activeRole === "spectator" ? "captain_a" : this.activeRole;
    const tok = this.captainTokens[roleToUse] || this.captainTokens.captain_a || "";

    for (let guard = 0; guard < 12; guard++) {
      if (!this.room || this.room.phase === "COMPLETED") break;
      const isCapB = roleToUse === "captain_b";
      const myTeam = isCapB ? this.room.team_b : this.room.team_a;
      const oppAtts = isCapB ? (this.room.active_attackers_a || []) : (this.room.active_attackers_b || []);
      const bench = (myTeam.roster || []).filter((c) => c.status === "bench");

      let action = "";
      let payload = { vs_ai: true };

      if (this.room.phase === "STEP_1_DEFENDER" && bench.length >= 1) {
        action = "lock_defender";
        payload.player_id = bench[0].id;
      } else if (this.room.phase === "STEP_2_ATTACKERS" && bench.length >= 2) {
        action = "lock_attackers";
        payload.player_ids = [bench[0].id, bench[1].id];
      } else if (this.room.phase === "STEP_3_CHOOSE" && oppAtts.length >= 1) {
        action = "lock_choice";
        payload.player_id = oppAtts[0].id;
      } else {
        break;
      }

      const resp = await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: roleToUse,
          captain_token: tok,
          action,
          payload
        })
      });
      const data = await resp.json();
      if (!data || !data.ok || !data.room) break;
      this.room = data.room;
    }

    this.selectedIds = [];
    this.renderAll();
  }

  inspectCard(player, opponentContextCard = null) {
    if (!player) return;
    this.inspectedPlayer = player;
    const meta = FACTION_META[player.faction] || FACTION_META["Space Marines"];
    const starsCount = Math.max(4, Math.min(10, Math.round(((player.elo || 2050) - 1800) / 45)));

    const nameEl = document.getElementById("inspCardName");
    const iconEl = document.getElementById("inspCardIcon");
    const starsEl = document.getElementById("inspCardStars");
    const emblemEl = document.getElementById("inspBigEmblem");
    const facEl = document.getElementById("inspCardFaction");
    const typeEl = document.getElementById("inspCardTypeLine");
    const descEl = document.getElementById("inspCardDesc");
    const eloEl = document.getElementById("inspCardElo");
    const roleShortEl = document.getElementById("inspCardRoleShort");
    const matchupBox = document.getElementById("inspMatchupBox");
    const matchupVal = document.getElementById("inspMatchupVal");

    if (nameEl) nameEl.textContent = player.name;
    if (iconEl) iconEl.textContent = meta.icon;
    if (starsEl) starsEl.textContent = "★".repeat(starsCount);
    if (emblemEl) emblemEl.textContent = meta.icon;
    if (facEl) facEl.textContent = player.faction;
    if (typeEl) typeEl.textContent = `[ ${player.faction} / ${player.detachment || meta.detachment} ]`;
    if (descEl) {
      descEl.innerHTML = `Tactical Role: <strong>${this.escapeHtml(player.role_tag || "All-Rounder")}</strong>. Click this card in your bottom hand to place it onto the glowing field zone.`;
    }
    if (eloEl) eloEl.textContent = String(player.elo || 2100);
    if (roleShortEl) {
      const rTag = (player.role_tag || "").toUpperCase();
      roleShortEl.textContent = rTag.includes("DEF") ? "DEF" : (rTag.includes("ATK") || rTag.includes("SPEAR") ? "ATK" : "FLEX");
    }

    if (matchupBox && matchupVal) {
      if (opponentContextCard && opponentContextCard.id && player.id) {
        const est = this.getMatchupEstimate(player, opponentContextCard);
        matchupBox.classList.remove("hidden");
        const verdict = est >= 12 ? "FAVORED" : (est <= 8 ? "UNFAVORED" : "EVEN CLASH");
        matchupVal.textContent = `${est} - ${20 - est} (${verdict} vs ${opponentContextCard.name})`;
      } else {
        matchupBox.classList.add("hidden");
      }
    }
  }

  attachCardInspectHandler(container, cardObj, oppCard = null) {
    const el = container.querySelector(".ygo-card");
    if (el && cardObj) {
      el.addEventListener("mouseenter", () => this.inspectCard(cardObj, oppCard));
      el.addEventListener("click", () => this.inspectCard(cardObj, oppCard));
    }
  }

  buildYuGiOhCardHtml(player, opts = {}) {
    const meta = FACTION_META[player.faction] || FACTION_META["Space Marines"];
    const starsCount = Math.max(4, Math.min(9, Math.round(((player.elo || 2050) - 1800) / 48)));
    const rTag = (player.role_tag || "").toUpperCase();
    const shortRole = rTag.includes("DEF") ? "DEF" : (rTag.includes("ATK") || rTag.includes("SPEAR") ? "ATK" : "FLEX");

    let matchupChipHtml = "";
    if (typeof opts.matchupScore === "number") {
      const s = opts.matchupScore;
      const color = s >= 12 ? "#4ade80" : (s <= 8 ? "#fb7185" : "#fde047");
      matchupChipHtml = `<span class="yc-matchup-chip" style="color:${color}">${s}-${20 - s}</span>`;
    }

    const classes = [
      "ygo-card",
      opts.fieldSize ? "field-size" : "",
      opts.selected ? "selected" : "",
      opts.clashChoice ? "clash-choice" : ""
    ].filter(Boolean).join(" ");

    return `
      <div class="${classes}" data-card-id="${this.escapeHtml(player.id || "")}" style="--card-accent: ${meta.accent}">
        <div class="yc-top">
          <span class="yc-name">${this.escapeHtml(player.name)}</span>
          <span class="yc-attr">${meta.icon}</span>
        </div>
        <div class="yc-stars">${"★".repeat(starsCount)}</div>
        <div class="yc-art">
          ${matchupChipHtml}
          <span class="yc-emblem">${meta.icon}</span>
          <span class="yc-faction">${this.escapeHtml(player.faction)}</span>
        </div>
        <div class="yc-bottom">
          <span>ELO <strong>${player.elo || 2100}</strong></span>
          <span>${shortRole}</span>
        </div>
      </div>
    `;
  }

  buildFaceDownFieldCardHtml(label = "SET CARD") {
    return `
      <div class="ygo-card field-size face-down-field">
        <div class="face-down-vortex">
          <span class="vortex-ico">🌀</span>
          <span class="vortex-lbl">${this.escapeHtml(label)}</span>
        </div>
      </div>
    `;
  }

  renderPairedTables() {
    const pairings = this.room?.pairings || [];
    const total = this.room?.total_tables || 5;

    const countLbl = document.getElementById("lockedCountLabel");
    if (countLbl) countLbl.textContent = `${pairings.length} / ${total}`;

    let sumA = 0;
    let sumB = 0;
    pairings.forEach((m) => {
      const estA = Number(m.est_score_a ?? m.matchup?.expected_a ?? m.a_expected ?? 10);
      sumA += estA;
      sumB += (20 - estA);
    });

    const isCapB = this.activeRole === "captain_b";
    const myScore = isCapB ? sumB : sumA;
    const oppScore = isCapB ? sumA : sumB;

    const scoreEl = document.getElementById("projectedScoreValue");
    if (scoreEl) scoreEl.textContent = `${myScore} – ${oppScore}`;

    const verdictEl = document.getElementById("projectedVerdictBadge");
    if (verdictEl) {
      if (pairings.length === 0) {
        verdictEl.textContent = "No Tables Locked";
      } else if (myScore > oppScore + 3) {
        verdictEl.textContent = "Advantaged";
      } else if (myScore < oppScore - 3) {
        verdictEl.textContent = "Trailing";
      } else {
        verdictEl.textContent = "Tight Round";
      }
    }

    const listEl = document.getElementById("pairedClashesList");
    const tbody = document.getElementById("pairingsTableBody");

    if (listEl) {
      if (pairings.length === 0) {
        listEl.innerHTML = `
          <div style="text-align:center;color:var(--text-muted);font-family:var(--font-mono);font-size:0.68rem;padding:18px 8px;">
            Locked table clashes will stack here as cards are paired.
          </div>
        `;
      } else {
        listEl.innerHTML = pairings.map((m) => {
          const myP = isCapB ? m.player_b : m.player_a;
          const oppP = isCapB ? m.player_a : m.player_b;
          const rawA = Number(m.est_score_a ?? m.matchup?.expected_a ?? m.a_expected ?? 10);
          const myEst = isCapB ? (20 - rawA) : rawA;
          return `
            <div class="clash-mini-card">
              <div class="clash-mini-top">
                <span>TABLE #${m.table_num}</span>
                <span>EST: ${myEst} - ${20 - myEst}</span>
              </div>
              <div class="clash-mini-players">
                <div class="clash-side-a">
                  ${this.escapeHtml(myP.name)}
                  <span class="clash-side-sub">${this.escapeHtml(myP.faction)}</span>
                </div>
                <span class="clash-vs-pill">⚡ VS</span>
                <div class="clash-side-b">
                  ${this.escapeHtml(oppP.name)}
                  <span class="clash-side-sub">${this.escapeHtml(oppP.faction)}</span>
                </div>
              </div>
            </div>
          `;
        }).join("");
      }
    }

    if (tbody) {
      tbody.innerHTML = pairings.map((m) => `
        <tr>
          <td>#${m.table_num}</td>
          <td>${this.escapeHtml(m.player_a.name)} (${this.escapeHtml(m.player_a.faction)})</td>
          <td>vs</td>
          <td>${this.escapeHtml(m.player_b.name)} (${this.escapeHtml(m.player_b.faction)})</td>
        </tr>
      `).join("");
    }
  }

  async applyDemoState(demoState) {
    if (!this.room) return;
    if (demoState === "lobby") {
      this.openLobbyModal();
      const sInp = document.getElementById("playerSearchInput");
      if (sInp) {
        sInp.value = "Innes";
        this.renderSearchResults("Innes");
      }
      return;
    }

    // For active duel field demo states, close the Lobby Modal so the 3D playmat is front-and-center
    this.closeLobbyModal();

    if (demoState === "step2") {
      // Lock Defender A1 so both Defenders reveal and we enter STEP_2_ATTACKERS, then stage A2 on mat
      await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "captain_a",
          captain_token: this.captainTokens.captain_a,
          action: "lock_defender",
          payload: { player_id: "A1", vs_ai: true }
        })
      }).then((r) => r.json()).then((d) => {
        if (d && d.ok) this.room = d.room;
      });
      this.selectedIds = ["A2"];
      this.renderAll();
    } else if (demoState === "step3_spectator") {
      await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "captain_a",
          captain_token: this.captainTokens.captain_a,
          action: "lock_defender",
          payload: { player_id: "A1", vs_ai: true }
        })
      });
      const r2 = await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "captain_a",
          captain_token: this.captainTokens.captain_a,
          action: "lock_attackers",
          payload: { player_ids: ["A2", "A3"], vs_ai: true }
        })
      }).then((r) => r.json());
      if (r2 && r2.ok) this.room = r2.room;
      await this.switchRole("spectator");
    } else if (demoState === "completed") {
      await this.autoCompleteRemainingPhases();
    }
  }

  copyShareUrl() {
    if (!this.roomCode) return;
    const url = `${window.location.origin}/admin/team-pairings?room=${encodeURIComponent(this.roomCode)}&role=spectator`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    this.showToast(`Copied room link (${this.roomCode})!`);
  }

  copyPairingsSummary() {
    if (!this.room || !this.room.pairings) return;
    const lines = this.room.pairings.map(
      (m) => `Table ${m.table_num}: ${m.player_a.name} (${m.player_a.faction}) vs ${m.player_b.name} (${m.player_b.faction})`
    );
    const txt = lines.join("\n") || "No tables paired yet.";
    if (navigator.clipboard) {
      navigator.clipboard.writeText(txt).catch(() => {});
    }
    this.showToast("Copied pairings summary to clipboard!");
  }

  showToast(msg) {
    const el = document.getElementById("toastNotification");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      el.classList.add("hidden");
    }, 2800);
  }

  escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  window.ygoPairingsArena = new YuGiOhPairingsArena();
});
