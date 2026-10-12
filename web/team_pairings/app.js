/**
 * OmniTactica — 40K Team Pairings Duel Arena (Yu-Gi-Oh! First-Person Card Game UI)
 * - Player-specific perspective: Your Team Hand is ALWAYS at the bottom; Opponent is across the top.
 * - Game Tracker-style Room Lobby: Shareable room code/link, Locked vs Unlocked room access, and individual Captain Seat Locking.
 * - Real Team & Real Player Search: Queries live backend (/api/team-pairings/search & /api/team-pairings/team/{name}) with ZERO mock/hardcoded data.
 *   Searching or clicking a Team populates its real players underneath!
 * - Authentic Retribution Armory Faction Sigils: Uses window.getArmoryAvatarSvg(avatarId) from /js/armory_svgs.js.
 */

const FACTION_META = {
  "Adepta Sororitas": { avatarId: "avatar_adepta_sororitas", accent: "rgba(251, 191, 36, 0.45)", detachment: "Hallowed Martyrs" },
  "Sisters of Battle": { avatarId: "avatar_adepta_sororitas", accent: "rgba(251, 191, 36, 0.45)", detachment: "Hallowed Martyrs" },
  "Adeptus Astartes": { avatarId: "avatar_adeptus_astartes", accent: "rgba(59, 130, 246, 0.45)", detachment: "Gladius Task Force" },
  "Space Marines": { avatarId: "avatar_space_marines", accent: "rgba(59, 130, 246, 0.45)", detachment: "Gladius Task Force" },
  "Adeptus Custodes": { avatarId: "avatar_adeptus_custodes", accent: "rgba(245, 185, 66, 0.50)", detachment: "Shield Host" },
  "Adeptus Mechanicus": { avatarId: "avatar_adeptus_mechanicus", accent: "rgba(239, 68, 68, 0.45)", detachment: "Skitarii Hunter" },
  "Aeldari": { avatarId: "avatar_aeldari", accent: "rgba(56, 189, 248, 0.45)", detachment: "Warhost" },
  "Craftworlds": { avatarId: "avatar_aeldari", accent: "rgba(56, 189, 248, 0.45)", detachment: "Warhost" },
  "Ynnari": { avatarId: "avatar_aeldari", accent: "rgba(56, 189, 248, 0.45)", detachment: "Devoted of Ynnead" },
  "Astra Militarum": { avatarId: "avatar_astra_militarum", accent: "rgba(148, 163, 184, 0.42)", detachment: "Combined Regiment" },
  "Imperial Guard": { avatarId: "avatar_astra_militarum", accent: "rgba(148, 163, 184, 0.42)", detachment: "Combined Regiment" },
  "Black Templars": { avatarId: "avatar_black_templars", accent: "rgba(226, 232, 240, 0.42)", detachment: "Righteous Crusaders" },
  "Blood Angels": { avatarId: "avatar_blood_angels", accent: "rgba(239, 68, 68, 0.48)", detachment: "Liberator Assault" },
  "Chaos Daemons": { avatarId: "avatar_chaos_daemons", accent: "rgba(244, 63, 94, 0.45)", detachment: "Daemonic Incursion" },
  "Chaos Knights": { avatarId: "avatar_chaos_knights", accent: "rgba(239, 68, 68, 0.45)", detachment: "Traitoris Lance" },
  "Chaos Space Marines": { avatarId: "avatar_chaos_space_marines", accent: "rgba(249, 115, 22, 0.45)", detachment: "Pactbound Zealots" },
  "Heretic Astartes": { avatarId: "avatar_chaos_space_marines", accent: "rgba(249, 115, 22, 0.45)", detachment: "Pactbound Zealots" },
  "Dark Angels": { avatarId: "avatar_dark_angels", accent: "rgba(5, 150, 105, 0.45)", detachment: "Inner Circle" },
  "Death Guard": { avatarId: "avatar_death_guard", accent: "rgba(132, 204, 22, 0.42)", detachment: "Plague Company" },
  "Deathwatch": { avatarId: "avatar_deathwatch", accent: "rgba(148, 163, 184, 0.45)", detachment: "Black Spear" },
  "Drukhari": { avatarId: "avatar_drukhari", accent: "rgba(217, 70, 239, 0.45)", detachment: "Skysplinter Assault" },
  "Emperor's Children": { avatarId: "avatar_emperors_children", accent: "rgba(236, 72, 153, 0.48)", detachment: "Peerless Bladesmen" },
  "Emperors Children": { avatarId: "avatar_emperors_children", accent: "rgba(236, 72, 153, 0.48)", detachment: "Peerless Bladesmen" },
  "Genestealer Cults": { avatarId: "avatar_genestealer_cults", accent: "rgba(192, 132, 252, 0.45)", detachment: "Host of Ascension" },
  "Grey Knights": { avatarId: "avatar_grey_knights", accent: "rgba(148, 163, 184, 0.48)", detachment: "Teleport Strike" },
  "Imperial Agents": { avatarId: "avatar_imperial_agents", accent: "rgba(234, 179, 8, 0.45)", detachment: "Ordo Hereticus" },
  "Agents of the Imperium": { avatarId: "avatar_imperial_agents", accent: "rgba(234, 179, 8, 0.45)", detachment: "Ordo Hereticus" },
  "Imperial Knights": { avatarId: "avatar_imperial_knights", accent: "rgba(59, 130, 246, 0.45)", detachment: "Noble Lance" },
  "Leagues of Votann": { avatarId: "avatar_leagues_of_votann", accent: "rgba(20, 184, 166, 0.45)", detachment: "Oathband" },
  "Necrons": { avatarId: "avatar_necrons", accent: "rgba(16, 185, 129, 0.45)", detachment: "Canoptek Court" },
  "Orks": { avatarId: "avatar_orks", accent: "rgba(34, 197, 94, 0.45)", detachment: "War Horde" },
  "Space Wolves": { avatarId: "avatar_space_wolves", accent: "rgba(56, 189, 248, 0.45)", detachment: "Champions of Russ" },
  "T'au Empire": { avatarId: "avatar_tau_empire", accent: "rgba(14, 165, 233, 0.45)", detachment: "Kauyon" },
  "Tau Empire": { avatarId: "avatar_tau_empire", accent: "rgba(14, 165, 233, 0.45)", detachment: "Kauyon" },
  "Thousand Sons": { avatarId: "avatar_thousand_sons", accent: "rgba(139, 92, 246, 0.48)", detachment: "Cult of Magic" },
  "Tyranids": { avatarId: "avatar_tyranids", accent: "rgba(168, 85, 247, 0.45)", detachment: "Invasion Fleet" },
  "World Eaters": { avatarId: "avatar_world_eaters", accent: "rgba(220, 38, 38, 0.52)", detachment: "Berzerker Warband" }
};

function resolveFactionMeta(rawFaction) {
  const clean = String(rawFaction || "").trim();
  if (FACTION_META[clean]) return FACTION_META[clean];
  const low = clean.toLowerCase();
  for (const [k, v] of Object.entries(FACTION_META)) {
    if (k.toLowerCase() === low || low.includes(k.toLowerCase()) || k.toLowerCase().includes(low)) {
      return v;
    }
  }
  const slug = low.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return {
    avatarId: slug ? `avatar_${slug}` : "avatar_space_marines",
    accent: "rgba(59, 130, 246, 0.45)",
    detachment: "Battle Host"
  };
}

function getFactionSvgHtml(factionName, customClass = "armory-faction-svg") {
  const meta = resolveFactionMeta(factionName);
  if (typeof window.getArmoryAvatarSvg === "function") {
    const svg = window.getArmoryAvatarSvg(meta.avatarId, customClass);
    if (svg) return svg;
  }
  return `<svg viewBox="0 0 100 100" class="${customClass}"><circle cx="50" cy="50" r="40" fill="none" stroke="#38bdf8" stroke-width="5"/><path d="M50 18 L62 46 L50 82 L38 46 Z" fill="#38bdf8"/></svg>`;
}

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
    this._searchDebounce = null;

    // Persistent Game Tracker-style User Identity for Seat Locking
    this.userId = this.initGuestUserId();
    this.userName = this.initUserName();

    // Lobby draft state
    this.lobbyDraftTeam = {
      captain_a: [],
      captain_b: []
    };
    this.lobbyTeamNames = {
      captain_a: "Art of War",
      captain_b: "Team Zero Comp"
    };

    // Real Search State (populated exclusively from live backend /api/team-pairings/search & /api/team-pairings/team/{name})
    this.searchResultsTeams = [];
    this.searchResultsPlayers = [];
    this.selectedTeamName = "";
    this.selectedTeamRosterPlayers = [];

    this.bindEvents();
    this.bootstrap();
  }

  initGuestUserId() {
    try {
      let id = localStorage.getItem("gt_guest_id");
      if (!id) {
        id = "cap_" + Math.random().toString(36).slice(2, 10);
        localStorage.setItem("gt_guest_id", id);
      }
      return id;
    } catch (_) {
      return "cap_" + Math.random().toString(36).slice(2, 10);
    }
  }

  initUserName() {
    try {
      const saved = localStorage.getItem("gt_user_name");
      if (saved && saved.trim()) return saved.trim();
    } catch (_) {}
    return "Captain";
  }

  saveUserName(name) {
    const clean = (name || "").trim() || "Captain";
    this.userName = clean;
    try {
      localStorage.setItem("gt_user_name", clean);
    } catch (_) {}
  }

  saveRoomTokenToStorage(roomCode, role, token) {
    if (!roomCode || !role || !token) return;
    try {
      localStorage.setItem(`tp_tok_${roomCode}_${role}`, token);
    } catch (_) {}
  }

  loadRoomTokenFromStorage(roomCode, role) {
    if (!roomCode || !role) return "";
    try {
      return localStorage.getItem(`tp_tok_${roomCode}_${role}`) || "";
    } catch (_) {
      return "";
    }
  }

  bindEvents() {
    // Topbar role pills
    document.querySelectorAll("#roleSelectorPills .seat-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const role = btn.getAttribute("data-role");
        if (role) this.claimOrSwitchSeat(role);
      });
    });

    // Topbar & Lobby Room Lock Toggle buttons
    const btnTopLock = document.getElementById("btnTopbarRoomLock");
    if (btnTopLock) {
      btnTopLock.addEventListener("click", () => this.toggleRoomLock());
    }
    const btnLobbyLock = document.getElementById("btnLobbyToggleLock");
    if (btnLobbyLock) {
      btnLobbyLock.addEventListener("click", () => this.toggleRoomLock());
    }

    // Lobby Share Link & Join Room buttons
    const btnLobbyCopy = document.getElementById("btnLobbyCopyLink");
    if (btnLobbyCopy) {
      btnLobbyCopy.addEventListener("click", () => this.copyShareUrl());
    }
    const btnLobbyJoin = document.getElementById("btnLobbyJoinRoom");
    if (btnLobbyJoin) {
      btnLobbyJoin.addEventListener("click", () => {
        const inp = document.getElementById("lobbyJoinCodeInput");
        const code = (inp ? inp.value : "").trim().toUpperCase();
        if (code) this.joinExistingRoom(code, { openLobby: true });
      });
    }

    const userNameInput = document.getElementById("lobbyUserNameInput");
    if (userNameInput) {
      userNameInput.value = this.userName;
      userNameInput.addEventListener("change", () => {
        this.saveUserName(userNameInput.value);
      });
    }

    // Open / Close Lobby Modal
    const btnOpenLobby = document.getElementById("btnOpenLobbyModal");
    if (btnOpenLobby) {
      btnOpenLobby.addEventListener("click", () => this.openLobbyModal());
    }
    const btnCloseLobby = document.getElementById("btnCloseLobbyModal");
    if (btnCloseLobby) {
      btnCloseLobby.addEventListener("click", () => this.closeLobbyModal());
    }

    // Lobby Seat Cards (Claim & Lock Seat)
    document.querySelectorAll(".lobby-seat-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".seat-unlock-btn")) return;
        const seat = card.getAttribute("data-seat");
        if (seat) this.claimOrSwitchSeat(seat);
      });
    });

    // Unlock / Leave Seat buttons
    document.querySelectorAll(".seat-unlock-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const seat = btn.getAttribute("data-unlock-seat");
        if (seat) this.unlockSeat(seat);
      });
    });

    // Lobby Team Name & Format
    const teamNameInput = document.getElementById("lobbyTeamNameInput");
    if (teamNameInput) {
      teamNameInput.addEventListener("input", () => {
        if (this.activeRole === "captain_a" || this.activeRole === "captain_b") {
          this.lobbyTeamNames[this.activeRole] = teamNameInput.value.trim() || "Art of War";
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
      btnQuickFill.addEventListener("click", () => this.loadRealTeamIntoHand());
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

    // Real Team & Player Search Input
    const searchInput = document.getElementById("playerSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        clearTimeout(this._searchDebounce);
        const val = searchInput.value;
        this._searchDebounce = setTimeout(() => {
          this.performRealSearch(val);
        }, 120);
      });
    }

    // Team Roster Drawer buttons
    const btnLoadFullTeam = document.getElementById("btnLoadFullTeamRoster");
    if (btnLoadFullTeam) {
      btnLoadFullTeam.addEventListener("click", () => {
        this.loadSelectedTeamRosterIntoHand();
      });
    }
    const btnCloseDrawer = document.getElementById("btnCloseTeamRosterDrawer");
    if (btnCloseDrawer) {
      btnCloseDrawer.addEventListener("click", () => {
        const drawer = document.getElementById("teamRosterPlayersSection");
        if (drawer) drawer.classList.add("hidden");
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
        if (code) this.joinExistingRoom(code, { openLobby: true });
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
    // Perform initial real search so real teams & players are ready immediately
    await this.performRealSearch("");

    const params = new URLSearchParams(window.location.search);
    const urlRoom = (params.get("room") || "").trim().toUpperCase();
    const urlRole = (params.get("role") || "").trim().toLowerCase();
    const demoState = (params.get("demo_state") || "").trim().toLowerCase();

    if (urlRole === "captain_a" || urlRole === "captain_b" || urlRole === "spectator") {
      this.activeRole = urlRole;
    }

    if (urlRoom) {
      await this.joinExistingRoom(urlRoom, { openLobby: !demoState || demoState === "lobby" });
    } else {
      await this.createNewRoom({ openLobby: !demoState || demoState === "lobby" });
    }

    if (demoState) {
      await this.applyDemoState(demoState);
    }

    this.pollTimer = setInterval(() => this.pollRoomState(), 2500);
  }

  /**
   * Queries live backend `/api/team-pairings/search` for real Teams and real Players.
   * Zero mock or custom placeholder players!
   */
  async performRealSearch(query = "") {
    const q = String(query || "").trim();
    try {
      const resp = await fetch(`/api/team-pairings/search?q=${encodeURIComponent(q)}&limit=24`);
      if (!resp.ok) return;
      const data = await resp.json();
      this.searchResultsTeams = Array.isArray(data.teams) ? data.teams : [];
      this.searchResultsPlayers = Array.isArray(data.players) ? data.players : [];
      this.renderSearchResults();

      // If the user searched for a team name and at least 1 real team matched, automatically populate its players underneath!
      if (q.length >= 2 && this.searchResultsTeams.length > 0) {
        const topTeam = this.searchResultsTeams[0];
        if (topTeam && topTeam.team_name) {
          await this.fetchAndShowTeamRosterUnderneath(topTeam.team_name, { silentToast: true });
        }
      }
    } catch (err) {
      console.error("Real team/player search failed:", err);
    }
  }

  async fetchAndShowTeamRosterUnderneath(teamName, { silentToast = false } = {}) {
    if (!teamName) return;
    try {
      const resp = await fetch(`/api/team-pairings/team/${encodeURIComponent(teamName)}`);
      if (!resp.ok) return;
      const data = await resp.json();
      const players = Array.isArray(data.players) ? data.players : [];
      this.selectedTeamName = data.team_name || teamName;
      this.selectedTeamRosterPlayers = players;
      this.renderTeamRosterDrawer();
      this.renderSearchResults();
      if (!silentToast) {
        this.showToast(`Loaded ${players.length} real players from ${this.selectedTeamName}`);
      }
    } catch (err) {
      console.error("Failed to fetch real team roster:", err);
    }
  }

  renderSearchResults() {
    const container = document.getElementById("playerSearchResults");
    if (!container) return;

    const roleKey = this.activeRole === "captain_b" ? "captain_b" : "captain_a";
    const currentHand = this.lobbyDraftTeam[roleKey] || [];
    const inHandNames = new Set(currentHand.map((p) => String(p.name || "").toLowerCase()));

    const teamsHtml = this.searchResultsTeams.slice(0, 6).map((t, idx) => {
      const isSelected = this.selectedTeamName && this.selectedTeamName.toLowerCase() === String(t.team_name || "").toLowerCase();
      const iconSvg = getFactionSvgHtml("Adeptus Custodes", "armory-faction-svg");
      return `
        <div class="search-result-pill team-pill ${isSelected ? "active-team" : ""}" data-team-idx="${idx}" title="Click to populate ${this.escapeHtml(t.team_name)} players underneath">
          <span class="srp-ico">${iconSvg}</span>
          <div class="srp-main">
            <span class="srp-name"><span class="srp-team-badge">TEAM</span>${this.escapeHtml(t.team_name)}</span>
            <span class="srp-sub">${t.member_count || 5} Players • Avg Elo ${t.avg_elo || 2050}</span>
          </div>
          <span class="srp-add">${isSelected ? "▼ ROSTER OPEN" : "▼ VIEW PLAYERS"}</span>
        </div>
      `;
    });

    const playersHtml = this.searchResultsPlayers.slice(0, 14).map((p, idx) => {
      const alreadyIn = inHandNames.has(String(p.name || "").toLowerCase());
      const iconSvg = getFactionSvgHtml(p.faction, "armory-faction-svg");
      const teamLabel = p.team_name ? ` • ${p.team_name}` : "";
      return `
        <div class="search-result-pill player-pill ${alreadyIn ? "in-hand" : ""}" data-player-idx="${idx}">
          <span class="srp-ico">${iconSvg}</span>
          <div class="srp-main">
            <span class="srp-name">${this.escapeHtml(p.name)}</span>
            <span class="srp-sub">${this.escapeHtml(p.faction)} • ${p.elo || 2050}${this.escapeHtml(teamLabel)}</span>
          </div>
          <span class="srp-add">${alreadyIn ? "✓ IN HAND" : "+ ADD"}</span>
        </div>
      `;
    });

    const combined = [...teamsHtml, ...playersHtml];
    if (combined.length === 0) {
      container.innerHTML = `
        <div style="color:var(--text-dim);font-family:var(--font-mono);font-size:0.72rem;padding:10px 6px;">
          No matching real teams or players found in database. Try searching a partial name or team (e.g. Art of War, Team Zero Comp, Siegler, Innes).
        </div>
      `;
      return;
    }

    container.innerHTML = combined.join("");

    container.querySelectorAll(".search-result-pill.team-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        const idx = Number(pill.getAttribute("data-team-idx"));
        const teamObj = this.searchResultsTeams[idx];
        if (teamObj && teamObj.team_name) {
          this.fetchAndShowTeamRosterUnderneath(teamObj.team_name);
        }
      });
    });

    container.querySelectorAll(".search-result-pill.player-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        const idx = Number(pill.getAttribute("data-player-idx"));
        const playerObj = this.searchResultsPlayers[idx];
        if (playerObj) {
          this.addPlayerToLobbyHand(playerObj);
        }
      });
    });
  }

  renderTeamRosterDrawer() {
    const drawer = document.getElementById("teamRosterPlayersSection");
    const titleEl = document.getElementById("selectedTeamRosterTitle");
    const metaEl = document.getElementById("selectedTeamRosterMeta");
    const listEl = document.getElementById("teamRosterPlayersList");
    if (!drawer || !listEl) return;

    if (!this.selectedTeamName || !this.selectedTeamRosterPlayers.length) {
      drawer.classList.add("hidden");
      return;
    }

    drawer.classList.remove("hidden");
    if (titleEl) titleEl.textContent = this.selectedTeamName;
    if (metaEl) metaEl.textContent = `(${this.selectedTeamRosterPlayers.length} real team players — click any player to add to your hand)`;

    const roleKey = this.activeRole === "captain_b" ? "captain_b" : "captain_a";
    const currentHand = this.lobbyDraftTeam[roleKey] || [];
    const inHandNames = new Set(currentHand.map((p) => String(p.name || "").toLowerCase()));

    listEl.innerHTML = this.selectedTeamRosterPlayers.map((p, idx) => {
      const alreadyIn = inHandNames.has(String(p.name || "").toLowerCase());
      const iconSvg = getFactionSvgHtml(p.faction, "armory-faction-svg");
      return `
        <div class="search-result-pill team-member-pill ${alreadyIn ? "in-hand" : ""}" data-roster-idx="${idx}">
          <span class="srp-ico">${iconSvg}</span>
          <div class="srp-main">
            <span class="srp-name">${this.escapeHtml(p.name)}</span>
            <span class="srp-sub">${this.escapeHtml(p.faction)} • Elo ${p.elo || 2050}</span>
          </div>
          <span class="srp-add">${alreadyIn ? "✓ IN HAND" : "+ ADD"}</span>
        </div>
      `;
    }).join("");

    listEl.querySelectorAll(".team-member-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        const idx = Number(pill.getAttribute("data-roster-idx"));
        const playerObj = this.selectedTeamRosterPlayers[idx];
        if (playerObj) {
          this.addPlayerToLobbyHand(playerObj);
        }
      });
    });
  }

  loadSelectedTeamRosterIntoHand() {
    if (this.activeRole !== "captain_a" && this.activeRole !== "captain_b") return;
    if (!this.selectedTeamRosterPlayers.length) return;

    const targetSize = this.getTargetHandSize();
    const loaded = this.selectedTeamRosterPlayers.slice(0, targetSize).map((p) => {
      const meta = resolveFactionMeta(p.faction);
      return {
        name: p.name,
        faction: p.faction || "Space Marines",
        detachment: p.detachment || meta.detachment,
        elo: p.elo || 2080,
        role_tag: p.role_tag || "All-Rounder"
      };
    });

    this.lobbyDraftTeam[this.activeRole] = loaded;
    this.lobbyTeamNames[this.activeRole] = this.selectedTeamName;
    const teamNameInput = document.getElementById("lobbyTeamNameInput");
    if (teamNameInput) teamNameInput.value = this.selectedTeamName;

    this.renderLobbyDeckBuilder();
    this.renderTeamRosterDrawer();
    this.showToast(`Loaded ${loaded.length} players from ${this.selectedTeamName}!`);
  }

  async loadRealTeamIntoHand() {
    if (this.activeRole !== "captain_a" && this.activeRole !== "captain_b") return;
    const typedTeam = (document.getElementById("lobbyTeamNameInput")?.value || "").trim() ||
      this.selectedTeamName ||
      (this.activeRole === "captain_a" ? "Art of War" : "Team Zero Comp");
    await this.fetchAndShowTeamRosterUnderneath(typedTeam, { silentToast: true });
    if (this.selectedTeamRosterPlayers.length > 0) {
      this.loadSelectedTeamRosterIntoHand();
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
      this.lobbyDraftTeam.captain_a = this.room.team_a.roster.map((p) => {
        const meta = resolveFactionMeta(p.faction);
        return {
          name: p.name,
          faction: p.faction,
          detachment: p.detachment || meta.detachment,
          elo: p.elo || 2100,
          role_tag: p.role_tag || "All-Rounder"
        };
      });
      this.lobbyTeamNames.captain_a = this.room.team_a.name || "Art of War";
    }
    if (this.room.team_b && Array.isArray(this.room.team_b.roster)) {
      this.lobbyDraftTeam.captain_b = this.room.team_b.roster.map((p) => {
        const meta = resolveFactionMeta(p.faction);
        return {
          name: p.name,
          faction: p.faction,
          detachment: p.detachment || meta.detachment,
          elo: p.elo || 2100,
          role_tag: p.role_tag || "All-Rounder"
        };
      });
      this.lobbyTeamNames.captain_b = this.room.team_b.name || "Team Zero Comp";
    }
  }

  trimOrPadLobbyDraft() {
    const target = this.getTargetHandSize();
    const realPool = this.selectedTeamRosterPlayers.length > 0
      ? this.selectedTeamRosterPlayers
      : this.searchResultsPlayers;
    ["captain_a", "captain_b"].forEach((roleKey, sideIdx) => {
      const list = this.lobbyDraftTeam[roleKey] || [];
      if (list.length > target) {
        this.lobbyDraftTeam[roleKey] = list.slice(0, target);
      } else if (list.length < target && realPool.length > 0) {
        const offset = sideIdx * 5;
        for (let i = list.length; i < target; i++) {
          const fallback = realPool[(offset + i) % realPool.length];
          if (fallback) list.push({ ...fallback });
        }
        this.lobbyDraftTeam[roleKey] = list;
      }
    });
  }

  openLobbyModal() {
    const modal = document.getElementById("lobbyModalBackdrop");
    if (modal) modal.classList.remove("hidden");
    this.renderLobbySeatLockState();
    this.selectLobbySeatUI(this.activeRole);
  }

  closeLobbyModal() {
    const modal = document.getElementById("lobbyModalBackdrop");
    if (modal) modal.classList.add("hidden");
  }

  /**
   * Game Tracker-Style Seat Claim & Locking:
   * - If seat is already locked by another user, prevents taking it and notifies viewer.
   * - If seat is open (and room is unlocked), claims & locks seat on backend.
   */
  async claimOrSwitchSeat(seat) {
    if (seat === "spectator") {
      this.activeRole = "spectator";
      this.selectedIds = [];
      this.selectLobbySeatUI("spectator");
      if (this.roomCode) await this.joinExistingRoom(this.roomCode);
      return;
    }

    if (!this.room || !this.roomCode) {
      this.activeRole = seat;
      this.selectLobbySeatUI(seat);
      return;
    }

    const nameInp = document.getElementById("lobbyUserNameInput");
    if (nameInp && nameInp.value.trim()) {
      this.saveUserName(nameInp.value.trim());
    }

    const savedTok = this.captainTokens[seat] || this.loadRoomTokenFromStorage(this.roomCode, seat);
    try {
      const resp = await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "claim_seat",
          role: seat,
          user_id: this.userId,
          user_name: this.userName,
          captain_token: savedTok
        })
      });
      const data = await resp.json();
      if (resp.ok && data && (data.ok || data.success) && data.room) {
        this.activeRole = seat;
        this.selectedIds = [];
        this.room = data.room;
        const tok = data.captain_token || (seat === "captain_a" ? data.room.captain_a_token : data.room.captain_b_token);
        if (tok) {
          this.captainTokens[seat] = tok;
          this.saveRoomTokenToStorage(this.roomCode, seat, tok);
        }
        this.selectLobbySeatUI(seat);
        this.renderLobbySeatLockState();
        this.showToast(`🔒 Seat locked as ${seat === "captain_a" ? "Team A Captain" : "Team B Captain"}!`);
      } else {
        this.showToast(data?.error || "That Captain seat is locked by another player.");
        this.renderLobbySeatLockState();
      }
    } catch (err) {
      console.error("Failed to claim seat:", err);
    }
  }

  async unlockSeat(seat) {
    if (!this.roomCode) return;
    const tok = this.captainTokens[seat] || this.loadRoomTokenFromStorage(this.roomCode, seat);
    try {
      const resp = await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "unlock_seat",
          role: seat,
          user_id: this.userId,
          captain_token: tok
        })
      });
      const data = await resp.json();
      if (resp.ok && data && data.room) {
        this.room = data.room;
        if (this.activeRole === seat) {
          this.activeRole = "spectator";
        }
        this.selectLobbySeatUI(this.activeRole);
        this.renderLobbySeatLockState();
        this.showToast("🔓 Seat unlocked and opened for others to join.");
      } else {
        this.showToast(data?.error || "Could not unlock seat.");
      }
    } catch (err) {
      console.error("Failed to unlock seat:", err);
    }
  }

  async toggleRoomLock() {
    if (!this.roomCode || !this.room) return;
    try {
      const resp = await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_room_lock",
          user_id: this.userId,
          captain_token: this.captainTokens.captain_a || this.captainTokens.captain_b || ""
        })
      });
      const data = await resp.json();
      if (resp.ok && data && data.room) {
        this.room = data.room;
        this.renderLobbySeatLockState();
        this.renderAll();
        this.showToast(
          this.room.is_locked
            ? "🔒 Room Locked — Unclaimed seats cannot be taken by new visitors."
            : "🔓 Room Unlocked — Anyone with the room link can claim an open seat."
        );
      } else {
        this.showToast(data?.error || "Only the room owner or a seated Captain can toggle room lock.");
      }
    } catch (err) {
      console.error("Failed to toggle room lock:", err);
    }
  }

  renderLobbySeatLockState() {
    if (!this.room) return;
    const isRoomLocked = !!this.room.is_locked;

    // Topbar lock pill
    const topLockBtn = document.getElementById("btnTopbarRoomLock");
    if (topLockBtn) {
      topLockBtn.classList.toggle("locked", isRoomLocked);
      topLockBtn.classList.toggle("unlocked", !isRoomLocked);
      topLockBtn.textContent = isRoomLocked ? "🔒 LOCKED" : "🔓 UNLOCKED";
    }

    // Lobby lock toggle button & status badge
    const lobbyLockBtn = document.getElementById("btnLobbyToggleLock");
    if (lobbyLockBtn) {
      lobbyLockBtn.classList.toggle("locked", isRoomLocked);
      lobbyLockBtn.classList.toggle("unlocked", !isRoomLocked);
      lobbyLockBtn.textContent = isRoomLocked
        ? "🔒 Room Locked (Spectators Only)"
        : "🔓 Room Unlocked (Open Access)";
    }

    const accessStatus = document.getElementById("lobbyRoomAccessStatusBadge");
    if (accessStatus) {
      accessStatus.classList.toggle("locked", isRoomLocked);
      accessStatus.textContent = isRoomLocked
        ? "🔒 LOCKED LOBBY — Only locked Captains can act"
        : "🟢 UNLOCKED LOBBY — Anyone with link can claim open seat";
    }

    // Update Captain A & Captain B seat cards
    const seats = [
      {
        role: "captain_a",
        cardId: "lobbySeatCapA",
        topBtnId: "btnRoleCapA",
        lockBadgeId: "seatLockBadgeCapA",
        ownerTextId: "seatOwnerTextCapA",
        actionBadgeId: "seatActionBadgeCapA",
        unlockBtnId: "btnUnlockSeatA",
        isLocked: !!this.room.seat_a_locked,
        ownerId: this.room.user_id_cap_a,
        ownerName: this.room.seat_a_owner_name || this.room.team_a?.captain_name || "Captain A",
        hasToken: !!(this.captainTokens.captain_a || this.loadRoomTokenFromStorage(this.roomCode, "captain_a"))
      },
      {
        role: "captain_b",
        cardId: "lobbySeatCapB",
        topBtnId: "btnRoleCapB",
        lockBadgeId: "seatLockBadgeCapB",
        ownerTextId: "seatOwnerTextCapB",
        actionBadgeId: "seatActionBadgeCapB",
        unlockBtnId: "btnUnlockSeatB",
        isLocked: !!this.room.seat_b_locked,
        ownerId: this.room.user_id_cap_b,
        ownerName: this.room.seat_b_owner_name || this.room.team_b?.captain_name || "Captain B",
        hasToken: !!(this.captainTokens.captain_b || this.loadRoomTokenFromStorage(this.roomCode, "captain_b"))
      }
    ];

    seats.forEach((s) => {
      const cardEl = document.getElementById(s.cardId);
      const topBtn = document.getElementById(s.topBtnId);
      const lockBadge = document.getElementById(s.lockBadgeId);
      const ownerText = document.getElementById(s.ownerTextId);
      const actionBadge = document.getElementById(s.actionBadgeId);
      const unlockBtn = document.getElementById(s.unlockBtnId);

      const isMine = s.isLocked && (s.ownerId === this.userId || s.hasToken);
      const isTakenByOther = s.isLocked && !isMine;

      if (cardEl) {
        cardEl.classList.toggle("locked-other", isTakenByOther);
        cardEl.classList.toggle("locked-mine", isMine);
      }

      if (lockBadge) {
        lockBadge.classList.remove("mine", "taken");
        if (isMine) {
          lockBadge.classList.add("mine");
          lockBadge.textContent = "🔒 LOCKED BY YOU";
        } else if (isTakenByOther) {
          lockBadge.classList.add("taken");
          lockBadge.textContent = "🔒 SEAT LOCKED";
        } else {
          lockBadge.textContent = "🟢 OPEN SEAT";
        }
      }

      if (ownerText) {
        if (isMine) {
          ownerText.textContent = `Seated: ${s.ownerName} (You)`;
        } else if (isTakenByOther) {
          ownerText.textContent = `Taken by: ${s.ownerName}`;
        } else {
          ownerText.textContent = isRoomLocked ? "Closed (Room Locked)" : "Available — Click to claim";
        }
      }

      if (actionBadge) {
        if (isMine) {
          actionBadge.textContent = "✓ YOUR ACTIVE SEAT";
        } else if (isTakenByOther) {
          actionBadge.textContent = "🔒 SEAT TAKEN";
        } else {
          actionBadge.textContent = "CLAIM & LOCK SEAT";
        }
      }

      if (unlockBtn) {
        unlockBtn.classList.toggle("hidden", !isMine);
      }

      if (topBtn) {
        const labelBase = s.role === "captain_a" ? "Team A Cap" : "Team B Cap";
        if (isMine) {
          topBtn.textContent = `👑 ${labelBase} (You)`;
        } else if (isTakenByOther) {
          topBtn.textContent = `🔒 ${labelBase} (${s.ownerName})`;
        } else {
          topBtn.textContent = `🟢 ${labelBase}`;
        }
      }
    });
  }

  selectLobbySeatUI(seat) {
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

  addPlayerToLobbyHand(playerObj) {
    if (this.activeRole !== "captain_a" && this.activeRole !== "captain_b") return;
    const targetSize = this.getTargetHandSize();
    const list = this.lobbyDraftTeam[this.activeRole] || [];

    const overrideSel = document.getElementById("playerSearchFactionOverride");
    const chosenFaction = (overrideSel && overrideSel.value) ? overrideSel.value : (playerObj.faction || "Space Marines");
    const meta = resolveFactionMeta(chosenFaction);

    const existingIdx = list.findIndex((p) => String(p.name || "").toLowerCase() === String(playerObj.name || "").toLowerCase());
    if (existingIdx >= 0) {
      list[existingIdx].faction = chosenFaction;
      list[existingIdx].detachment = meta.detachment;
      this.showToast(`Updated ${playerObj.name} (${chosenFaction})`);
    } else if (list.length < targetSize) {
      list.push({
        name: playerObj.name,
        faction: chosenFaction,
        detachment: playerObj.detachment || meta.detachment,
        elo: playerObj.elo || 2080,
        role_tag: playerObj.role_tag || "All-Rounder"
      });
    } else {
      list[targetSize - 1] = {
        name: playerObj.name,
        faction: chosenFaction,
        detachment: playerObj.detachment || meta.detachment,
        elo: playerObj.elo || 2080,
        role_tag: playerObj.role_tag || "All-Rounder"
      };
      this.showToast(`Swapped ${playerObj.name} into slot #${targetSize}`);
    }

    this.lobbyDraftTeam[this.activeRole] = list;
    this.renderLobbyDeckBuilder();
    this.renderTeamRosterDrawer();
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
        statusHint.textContent = `Select ${targetSize - hand.length} more real player(s) via search or Team Roster above.`;
      } else {
        statusHint.textContent = `Ready! ${targetSize}/${targetSize} Real Player Cards in your hand. Click ENTER DUEL ARENA.`;
      }
    }

    this.renderSearchResults();

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
            <span>Search a team or player above</span>
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
        this.renderTeamRosterDrawer();
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
      await this.loadRealTeamIntoHand();
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
        const tok = this.captainTokens[this.activeRole] || this.loadRoomTokenFromStorage(this.roomCode, this.activeRole);
        const resp = await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: this.activeRole,
            user_id: this.userId,
            user_name: this.userName,
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
            this.saveRoomTokenToStorage(this.roomCode, this.activeRole, data.captain_token);
          }
        }
      } catch (_) {}
    }

    this.closeLobbyModal();
    this.renderAll();
    this.showToast(`Seated & Locked as ${this.activeRole === "captain_a" ? "Team A Captain" : "Team B Captain"}!`);
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
          vs_ai: vsAi,
          owner_id: this.userId,
          user_id: this.userId,
          user_name: this.userName,
          claim_role: "captain_a"
        })
      });
      const data = await resp.json();
      if (data && (data.ok || data.success) && data.room) {
        this.room = data.room;
        this.roomCode = data.room.room_code;
        this.captainTokens.captain_a = data.captain_a_token || data.room.captain_a_token || "";
        this.captainTokens.captain_b = data.captain_b_token || data.room.captain_b_token || "";
        this.saveRoomTokenToStorage(this.roomCode, "captain_a", this.captainTokens.captain_a);
        this.selectedIds = [];
        this.syncLobbyDraftFromRoom();

        const lobbyCodeEl = document.getElementById("lobbyRoomCodeText");
        if (lobbyCodeEl) lobbyCodeEl.textContent = this.roomCode;

        this.renderLobbySeatLockState();
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

  async joinExistingRoom(code, { openLobby = false } = {}) {
    const cleanCode = String(code || "").trim().toUpperCase();
    if (!cleanCode) return;
    const savedTok = this.captainTokens[this.activeRole] || this.loadRoomTokenFromStorage(cleanCode, this.activeRole);
    try {
      const resp = await fetch(
        `/api/team-pairings/room/${encodeURIComponent(cleanCode)}?role=${encodeURIComponent(this.activeRole)}&captain_token=${encodeURIComponent(savedTok)}`
      );
      const data = await resp.json();
      if (data && (data.ok || data.success) && data.room) {
        this.room = data.room;
        this.roomCode = data.room.room_code;
        if (data.room.captain_a_token) {
          this.captainTokens.captain_a = data.room.captain_a_token;
          this.saveRoomTokenToStorage(this.roomCode, "captain_a", data.room.captain_a_token);
        }
        if (data.room.captain_b_token) {
          this.captainTokens.captain_b = data.room.captain_b_token;
          this.saveRoomTokenToStorage(this.roomCode, "captain_b", data.room.captain_b_token);
        }

        // If viewer tried to join as a Captain whose seat is already locked by someone else, auto-place in open seat or Spectator
        if (
          this.activeRole === "captain_a" &&
          this.room.seat_a_locked &&
          this.room.user_id_cap_a !== this.userId &&
          !this.captainTokens.captain_a
        ) {
          this.activeRole = !this.room.seat_b_locked ? "captain_b" : "spectator";
        } else if (
          this.activeRole === "captain_b" &&
          this.room.seat_b_locked &&
          this.room.user_id_cap_b !== this.userId &&
          !this.captainTokens.captain_b
        ) {
          this.activeRole = "spectator";
        }

        this.selectedIds = [];
        this.syncLobbyDraftFromRoom();
        const lobbyCodeEl = document.getElementById("lobbyRoomCodeText");
        if (lobbyCodeEl) lobbyCodeEl.textContent = this.roomCode;
        this.renderLobbySeatLockState();
        if (openLobby) this.openLobbyModal();
        this.renderAll();
      } else {
        this.showToast(`Room ${cleanCode} not found`);
      }
    } catch (err) {
      console.error("Failed to join room:", err);
    }
  }

  async pollRoomState() {
    if (!this.roomCode) return;
    const savedTok = this.captainTokens[this.activeRole] || this.loadRoomTokenFromStorage(this.roomCode, this.activeRole);
    try {
      const resp = await fetch(
        `/api/team-pairings/room/${encodeURIComponent(this.roomCode)}?role=${encodeURIComponent(this.activeRole)}&captain_token=${encodeURIComponent(savedTok)}`
      );
      if (!resp.ok) return;
      const data = await resp.json();
      if (data && (data.ok || data.success) && data.room) {
        const oldRev = this.room?.revision;
        this.room = data.room;
        if (oldRev !== this.room.revision) {
          this.renderLobbySeatLockState();
          this.renderAll();
        }
      }
    } catch (_) {}
  }

  async switchRole(newRole) {
    await this.claimOrSwitchSeat(newRole);
  }

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

    const roomBadge = document.getElementById("roomCodeBadge");
    if (roomBadge) roomBadge.textContent = `ROOM: ${this.room.room_code}`;

    const specBanner = document.getElementById("spectatorBanner");
    if (specBanner) {
      specBanner.classList.toggle("hidden", !p.isSpectator);
    }

    this.renderLobbySeatLockState();
    this.renderDuelistHud(p);
    this.renderBattleLine(p);
    this.renderPlaymatZones(p);
    this.renderHands(p);
    this.renderPairedTables();

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
    const oppAvatar = document.getElementById("oppHudAvatar");

    if (oppTag) oppTag.textContent = p.oppTeam.tag || "OPP";
    if (oppName) oppName.textContent = p.oppTeam.name || "Opponent Team";
    if (oppCap) oppCap.textContent = `Cap: ${p.oppTeam.captain_name || "Opponent"}`;
    if (oppAvatar) {
      const oppLeadFac = p.oppDef?.faction || p.oppTeam.roster?.[0]?.faction || "Necrons";
      oppAvatar.innerHTML = getFactionSvgHtml(oppLeadFac, "armory-faction-svg");
    }

    const myTag = document.getElementById("myHudTag");
    const myName = document.getElementById("myHudTeamName");
    const myCap = document.getElementById("myHudCaptain");
    const myStatus = document.getElementById("capAStatusPill");
    const myAvatar = document.getElementById("myHudAvatar");

    if (myTag) myTag.textContent = p.myTeam.tag || "YOU";
    if (myName) myName.textContent = p.myTeam.name || "Your Team";
    if (myCap) myCap.textContent = `Cap: ${p.myTeam.captain_name || "You"} (${p.isSpectator ? "Spectating" : "LOCKED"})`;
    if (myAvatar) {
      const myLeadFac = p.myDef?.faction || p.myTeam.roster?.[0]?.faction || "Aeldari";
      myAvatar.innerHTML = getFactionSvgHtml(myLeadFac, "armory-faction-svg");
    }

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

    // 2. OPPONENT 2 ATTACKERS MOUNT
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

    // 3. YOUR DEFENDER MOUNT
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

    // 4. YOUR 2 ATTACKERS MOUNT
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
    const stagedOnMatIds = new Set(
      (phase === "STEP_1_DEFENDER" || phase === "STEP_2_ATTACKERS") ? this.selectedIds : []
    );
    const myBench = rawMyBench.filter((c) => !stagedOnMatIds.has(c.id));

    const oppFan = document.getElementById("oppHandFan");
    if (oppFan) {
      oppFan.innerHTML = oppBench.map((_, i) => {
        const mid = (oppBench.length - 1) / 2;
        const deg = (i - mid) * 4;
        return `<div class="opp-card-back" style="transform: rotate(${deg}deg);"></div>`;
      }).join("");
    }

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
    const tok = this.captainTokens[this.activeRole] || this.loadRoomTokenFromStorage(this.roomCode, this.activeRole);

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
          user_id: this.userId,
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
          user_id: this.userId,
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
    const meta = resolveFactionMeta(player.faction);
    const starsCount = Math.max(4, Math.min(10, Math.round(((player.elo || 2050) - 1800) / 45)));
    const svgHtml = getFactionSvgHtml(player.faction, "armory-faction-svg");

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
    if (iconEl) iconEl.innerHTML = svgHtml;
    if (starsEl) starsEl.textContent = "★".repeat(starsCount);
    if (emblemEl) emblemEl.innerHTML = svgHtml;
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
    const meta = resolveFactionMeta(player.faction);
    const starsCount = Math.max(4, Math.min(9, Math.round(((player.elo || 2050) - 1800) / 48)));
    const rTag = (player.role_tag || "").toUpperCase();
    const shortRole = rTag.includes("DEF") ? "DEF" : (rTag.includes("ATK") || rTag.includes("SPEAR") ? "ATK" : "FLEX");
    const svgHtml = getFactionSvgHtml(player.faction, "armory-faction-svg");

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
          <span class="yc-attr">${svgHtml}</span>
        </div>
        <div class="yc-stars">${"★".repeat(starsCount)}</div>
        <div class="yc-art">
          ${matchupChipHtml}
          <span class="yc-emblem">${svgHtml}</span>
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
          const mySvg = getFactionSvgHtml(myP.faction, "armory-faction-svg");
          const oppSvg = getFactionSvgHtml(oppP.faction, "armory-faction-svg");
          return `
            <div class="clash-mini-card">
              <div class="clash-mini-top">
                <span>TABLE #${m.table_num}</span>
                <span>EST: ${myEst} - ${20 - myEst}</span>
              </div>
              <div class="clash-mini-players">
                <div class="clash-side-a">
                  <span class="clash-side-ico">${mySvg}</span>${this.escapeHtml(myP.name)}
                  <span class="clash-side-sub">${this.escapeHtml(myP.faction)}</span>
                </div>
                <span class="clash-vs-pill">⚡ VS</span>
                <div class="clash-side-b">
                  <span class="clash-side-ico">${oppSvg}</span>${this.escapeHtml(oppP.name)}
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
        sInp.value = "Team Zero Comp";
        await this.performRealSearch("Team Zero Comp");
      }
      return;
    }

    this.closeLobbyModal();

    if (demoState === "step2") {
      await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "captain_a",
          user_id: this.userId,
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
          user_id: this.userId,
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
          user_id: this.userId,
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
    const url = `${window.location.origin}/admin/team-pairings?room=${encodeURIComponent(this.roomCode)}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    this.showToast(`📋 Copied shareable room link (${this.roomCode})!`);
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
