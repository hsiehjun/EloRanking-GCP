/**
 * OmniTactica — 40K Team Pairings Duel Arena (Yu-Gi-Oh! First-Person Card Game UI)
 * - Player-specific perspective: Your Team Hand is ALWAYS at the bottom; Opponent is across the top.
 * - Clean Lobby & Roster Builder: Starts completely empty (no pre-populated teams or players in search or hand).
 * - Real Player Search: Queries live backend (/api/team-pairings/search) by player name or team name and displays ONLY matching players.
 * - Game Tracker Share Match Room Pop-up Modal (#gt-share-room-modal): Identical Share Room & Lock modal to Game Tracker.
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
    this._shareChatThreadsCache = [];
    this._shareUserSearchTimer = null;

    // Persistent User / Guest Identity for Seat Locking
    this.userId = this.initGuestUserId();
    this.userName = this.initUserName();

    // Lobby draft state starts completely EMPTY (nothing pre-populated!)
    this.lobbyDraftTeam = {
      captain_a: [],
      captain_b: []
    };
    this.lobbyTeamNames = {
      captain_a: "",
      captain_b: ""
    };

    // Real Player Search State (populated only when user types in #playerSearchInput)
    this.searchResultsPlayers = [];

    // Expose Game Tracker-compatible global helpers for the Share Room modal
    window.__openShareRoomModal = (mid) => this.openShareRoomModal(mid);
    window.__copyRoomShareLink = (mid, btn) => this.copyRoomShareLink(mid, btn);
    window.__toggleRoomLock = (mid, nextLocked, btn) => this.toggleRoomLock(nextLocked, btn);
    window.__sendRoomInviteToChat = (mid, opts, btn) => this.sendRoomInviteToChat(mid, opts, btn);

    this.bindEvents();
    this.bootstrap();
  }

  initGuestUserId() {
    try {
      const rawUser = localStorage.getItem("omnitactica_user") || localStorage.getItem("currentUser");
      if (rawUser) {
        const parsed = JSON.parse(rawUser);
        if (parsed && (parsed.id || parsed.user_id)) return String(parsed.id || parsed.user_id);
      }
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
      const rawUser = localStorage.getItem("omnitactica_user") || localStorage.getItem("currentUser");
      if (rawUser) {
        const parsed = JSON.parse(rawUser);
        if (parsed && (parsed.display_name || parsed.username)) {
          return String(parsed.display_name || parsed.username).trim();
        }
      }
    } catch (_) {}
    return "";
  }

  getAuthToken() {
    try {
      return localStorage.getItem("omnitactica_token") || localStorage.getItem("auth_token") || "";
    } catch (_) {
      return "";
    }
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

    // Topbar & Lobby Share Modal buttons (opens Game Tracker Share Match Room modal)
    const btnTopShare = document.getElementById("btnTopbarShareModal");
    if (btnTopShare) {
      btnTopShare.addEventListener("click", () => this.openShareRoomModal());
    }
    const btnLobbyShare = document.getElementById("btnLobbyShareModal");
    if (btnLobbyShare) {
      btnLobbyShare.addEventListener("click", () => this.openShareRoomModal());
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
          this.lobbyTeamNames[this.activeRole] = teamNameInput.value.trim();
        }
      });
    }

    const selectFormat = document.getElementById("selectFormat");
    if (selectFormat) {
      selectFormat.addEventListener("change", () => {
        this.onFormatChanged(selectFormat.value);
      });
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

    // Real Player Search Input (only populates players when user types!)
    const searchInput = document.getElementById("playerSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        clearTimeout(this._searchDebounce);
        const val = searchInput.value;
        if (!val || !val.trim()) {
          this.searchResultsPlayers = [];
          this.renderSearchResults();
          return;
        }
        this._searchDebounce = setTimeout(() => {
          this.performRealSearch(val);
        }, 100);
      });
    }

    // Start Duel from Lobby
    const btnStartDuel = document.getElementById("btnStartDuelFromLobby");
    if (btnStartDuel) {
      btnStartDuel.addEventListener("click", () => this.confirmLobbyAndEnterArena());
    }

    // Coin Flip Modal Controls
    const btnOpenCoinFlip = document.getElementById("btnOpenCoinFlipModal");
    if (btnOpenCoinFlip) {
      btnOpenCoinFlip.addEventListener("click", () => this.openCoinFlipModal());
    }
    const btnCloseCoinFlip = document.getElementById("btnCloseCoinFlipModal");
    if (btnCloseCoinFlip) {
      btnCloseCoinFlip.addEventListener("click", () => this.closeCoinFlipModal());
    }
    const btnFlipCoinNow = document.getElementById("btnFlipCoinNow");
    if (btnFlipCoinNow) {
      btnFlipCoinNow.addEventListener("click", () => this.flipCoinForRole());
    }
    const btnChooseDef = document.getElementById("btnChooseDefenderRole");
    if (btnChooseDef) {
      btnChooseDef.addEventListener("click", () => this.chooseCoinFlipRole("defender", this.activeRole));
    }
    const btnChooseAtt = document.getElementById("btnChooseAttackerRole");
    if (btnChooseAtt) {
      btnChooseAtt.addEventListener("click", () => this.chooseCoinFlipRole("attacker", this.activeRole));
    }
    const btnAcceptAiCoin = document.getElementById("btnAcceptAiCoinChoice");
    if (btnAcceptAiCoin) {
      btnAcceptAiCoin.addEventListener("click", () => this.acceptAiCoinChoice());
    }

    // Main Duel Confirm Button
    const btnLock = document.getElementById("btnLockSelection");
    if (btnLock) {
      btnLock.addEventListener("click", () => this.submitStagedSelection());
    }

    // Auto-Duel / New Room / Copy Pairings
    const btnAutoFinish = document.getElementById("btnAutoFinish");
    if (btnAutoFinish) {
      btnAutoFinish.addEventListener("click", () => this.autoCompleteRemainingPhases());
    }

    const btnNewMatch = document.getElementById("btnNewMatch");
    if (btnNewMatch) {
      btnNewMatch.addEventListener("click", () => {
        this.createNewRoom({ openLobby: true, emptyRosters: true });
      });
    }

    const btnCopyPairings = document.getElementById("btnCopyPairings");
    if (btnCopyPairings) {
      btnCopyPairings.addEventListener("click", () => this.copyPairingsSummary());
    }

    const btnToggleLandscape = document.getElementById("btnToggleLandscape");
    if (btnToggleLandscape) {
      btnToggleLandscape.addEventListener("click", () => {
        const isForced = document.body.classList.toggle("force-landscape-mobile");
        btnToggleLandscape.textContent = isForced ? "📱 Portrait" : "🔄 Landscape";
        if (isForced && screen.orientation && typeof screen.orientation.lock === "function") {
          screen.orientation.lock("landscape").catch(() => {});
        } else if (!isForced && screen.orientation && typeof screen.orientation.unlock === "function") {
          try { screen.orientation.unlock(); } catch (_) {}
        }
      });
    }
  }

  async bootstrap() {
    const params = new URLSearchParams(window.location.search);
    const urlRoom = (params.get("room") || "").trim().toUpperCase();
    const urlRole = (params.get("role") || "").trim().toLowerCase();
    const demoState = (params.get("demo_state") || "").trim().toLowerCase();
    const urlFmt = (params.get("format") || params.get("format_size") || "").trim().toLowerCase();
    const urlLandscape = (params.get("landscape") || "").trim();

    if (urlLandscape === "1" || urlLandscape === "true") {
      document.body.classList.add("force-landscape-mobile");
      const btnToggleLandscape = document.getElementById("btnToggleLandscape");
      if (btnToggleLandscape) btnToggleLandscape.textContent = "📱 Portrait";
    }

    if (urlFmt === "8v8" || urlFmt === "5v5") {
      const selectFormat = document.getElementById("selectFormat");
      if (selectFormat) selectFormat.value = urlFmt;
    }

    if (urlRole === "captain_a" || urlRole === "captain_b" || urlRole === "spectator") {
      this.activeRole = urlRole;
    }

    // Do NOT pre-populate teams or players unless demo_state specifically tests mid-duel field steps
    const needsFieldDemoPreset =
      demoState === "step2" ||
      demoState === "step3_spectator" ||
      demoState === "completed" ||
      demoState === "8v8_field" ||
      demoState === "coin_flip" ||
      demoState === "attacker_view" ||
      demoState === "defender_view";

    if (urlRoom) {
      await this.joinExistingRoom(urlRoom, { openLobby: !demoState || demoState === "lobby" });
    } else {
      await this.createNewRoom({
        openLobby: !demoState || demoState === "lobby",
        emptyRosters: !needsFieldDemoPreset
      });
    }

    if (demoState) {
      await this.applyDemoState(demoState);
    }

    this.pollTimer = setInterval(() => this.pollRoomState(), 2500);
  }

  /**
   * Queries live backend `/api/team-pairings/search` for real Players (matching player name OR team name).
   * When query is empty, nothing is shown under the search bar!
   */
  async performRealSearch(query = "") {
    const q = String(query || "").trim();
    if (!q) {
      this.searchResultsPlayers = [];
      this.renderSearchResults();
      return;
    }
    try {
      const resp = await fetch(`/api/team-pairings/search?q=${encodeURIComponent(q)}&limit=24`);
      if (!resp.ok) return;
      const data = await resp.json();
      this.searchResultsPlayers = Array.isArray(data.players) ? data.players : [];
      this.renderSearchResults();
    } catch (err) {
      console.error("Real player search failed:", err);
    }
  }

  renderSearchResults() {
    const container = document.getElementById("playerSearchResults");
    if (!container) return;

    const searchInput = document.getElementById("playerSearchInput");
    const q = (searchInput ? searchInput.value : "").trim();

    // Do NOT populate anything underneath the search bar when search input is empty!
    if (!q) {
      container.innerHTML = "";
      container.classList.add("hidden");
      return;
    }

    container.classList.remove("hidden");

    const roleKey = this.activeRole === "captain_b" ? "captain_b" : "captain_a";
    const currentHand = this.lobbyDraftTeam[roleKey] || [];
    const inHandNames = new Set(currentHand.map((p) => String(p.name || "").toLowerCase()));

    // Render ONLY Players (never Team pills or a separate Team Roster drawer)
    const playersHtml = this.searchResultsPlayers.slice(0, 24).map((p, idx) => {
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

    if (playersHtml.length === 0) {
      container.innerHTML = `
        <div style="color:var(--text-dim);font-family:var(--font-mono);font-size:0.72rem;padding:8px 6px;">
          No matching players found for "${this.escapeHtml(q)}".
        </div>
      `;
      return;
    }

    container.innerHTML = playersHtml.join("");

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

  getTargetHandSize() {
    const sel = document.getElementById("selectFormat");
    const fmt = sel ? sel.value : (this.room?.format_size || "5v5");
    return fmt === "8v8" ? 8 : 5;
  }

  async onFormatChanged(newFormatValue) {
    const fmt = String(newFormatValue || "5v5").toLowerCase() === "8v8" ? "8v8" : "5v5";
    const tSize = fmt === "8v8" ? 8 : 5;
    this.trimLobbyDraftToFormat();
    this.renderLobbyDeckBuilder();

    if (this.room) {
      this.room.format_size = fmt;
      this.room.format = fmt;
      this.room.team_size = tSize;
      this.room.total_tables = tSize;
      this.room.max_cycles = tSize === 8 ? 3 : 2;
      this.renderAll();
    }

    if (this.roomCode && this.activeRole !== "spectator") {
      try {
        const tok = this.captainTokens[this.activeRole] || this.loadRoomTokenFromStorage(this.roomCode, this.activeRole);
        const resp = await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: this.activeRole,
            user_id: this.userId,
            captain_token: tok,
            action: "set_format",
            payload: { format_size: fmt }
          })
        });
        const data = await resp.json();
        if (data && (data.ok || data.success) && data.room) {
          this.room = data.room;
          this.renderAll();
        }
      } catch (_) {}
    }
  }

  syncLobbyDraftFromRoom() {
    if (!this.room) return;
    const roomFmt = (this.room.format_size === "8v8" || this.room.team_size === 8 || this.room.total_tables === 8) ? "8v8" : "5v5";
    const selectFormat = document.getElementById("selectFormat");
    if (selectFormat) {
      selectFormat.value = roomFmt;
    }
    if (this.room.team_a && Array.isArray(this.room.team_a.roster)) {
      this.lobbyDraftTeam.captain_a = this.room.team_a.roster.map((p) => {
        const meta = resolveFactionMeta(p.faction);
        return {
          name: p.name,
          faction: p.faction,
          detachment: p.detachment || meta.detachment,
          elo: p.elo || 2100
        };
      });
      const nameA = this.room.team_a.name || "";
      this.lobbyTeamNames.captain_a = (nameA === "Team A" && this.lobbyDraftTeam.captain_a.length === 0) ? "" : nameA;
    }
    if (this.room.team_b && Array.isArray(this.room.team_b.roster)) {
      this.lobbyDraftTeam.captain_b = this.room.team_b.roster.map((p) => {
        const meta = resolveFactionMeta(p.faction);
        return {
          name: p.name,
          faction: p.faction,
          detachment: p.detachment || meta.detachment,
          elo: p.elo || 2100
        };
      });
      const nameB = this.room.team_b.name || "";
      this.lobbyTeamNames.captain_b = (nameB === "Team B" && this.lobbyDraftTeam.captain_b.length === 0) ? "" : nameB;
    }
  }

  trimLobbyDraftToFormat() {
    const target = this.getTargetHandSize();
    ["captain_a", "captain_b"].forEach((roleKey) => {
      const list = this.lobbyDraftTeam[roleKey] || [];
      if (list.length > target) {
        this.lobbyDraftTeam[roleKey] = list.slice(0, target);
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

    const defaultCapLabel = seat === "captain_a" ? "Team A Captain" : "Team B Captain";
    const savedTok = this.captainTokens[seat] || this.loadRoomTokenFromStorage(this.roomCode, seat);
    try {
      const resp = await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "claim_seat",
          role: seat,
          user_id: this.userId,
          user_name: this.userName || defaultCapLabel,
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
        this.showToast(`🔒 Seat locked as ${defaultCapLabel}!`);
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

  async toggleRoomLock(nextLocked, btnEl) {
    if (!this.roomCode || !this.room) return;
    const desired = typeof nextLocked === "boolean" ? nextLocked : !this.room.is_locked;
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.style.opacity = "0.65";
    }
    try {
      const resp = await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_room_lock",
          is_locked: desired,
          user_id: this.userId,
          captain_token: this.captainTokens.captain_a || this.captainTokens.captain_b || ""
        })
      });
      const data = await resp.json();
      if (resp.ok && data && data.room) {
        this.room = data.room;
        this.renderLobbySeatLockState();
        this.renderAll();
        if (document.getElementById("gt-share-room-modal")) {
          this.openShareRoomModal(this.roomCode);
        }
        this.showToast(
          this.room.is_locked
            ? "🔒 Room Locked — Unclaimed seats cannot be taken by new visitors."
            : "🔓 Room Unlocked — Anyone with the room link can claim an open seat."
        );
      } else {
        this.showToast(data?.error || "Only the room owner or a seated Captain can toggle room lock.");
        if (btnEl) {
          btnEl.disabled = false;
          btnEl.style.opacity = "1";
        }
      }
    } catch (err) {
      console.error("Failed to toggle room lock:", err);
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.style.opacity = "1";
      }
    }
  }

  /**
   * Exact Game Tracker Share Match Room Pop-Up Modal (#gt-share-room-modal)
   */
  getCleanRoomShareUrl(mid) {
    const targetId = mid || this.roomCode || "";
    return targetId
      ? `${window.location.origin}/team-pairings?room=${encodeURIComponent(targetId)}`
      : `${window.location.origin}/team-pairings`;
  }

  copyRoomShareLink(mid, silentBtn) {
    const shareUrl = this.getCleanRoomShareUrl(mid);
    try {
      navigator.clipboard.writeText(shareUrl);
    } catch (_) {}
    if (silentBtn && silentBtn.tagName) {
      const orig = silentBtn.innerHTML;
      silentBtn.innerHTML = "✅ COPIED!";
      setTimeout(() => { silentBtn.innerHTML = orig; }, 1800);
      return;
    }
    this.showToast("🔗 Room Link Copied! Share with the opposing Team Captain.");
  }

  async sendRoomInviteToChat(matchId, opts, btnEl) {
    const targetMid = matchId || this.roomCode;
    if (!targetMid) return;
    const token = this.getAuthToken();
    if (!token) {
      this.showToast("Sign in to OmniTactica to send invites in Chat, or use Copy Link above.");
      return;
    }
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = "Sending...";
    }
    try {
      const resp = await fetch(`/api/tracker/room/${encodeURIComponent(targetMid)}/share_chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          token: token,
          request_id: (opts && opts.requestId) || undefined,
          receiver_id: (opts && opts.receiverId) || undefined
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.success) {
        if (btnEl) {
          btnEl.style.background = "#10b981";
          btnEl.style.color = "#070b14";
          btnEl.style.borderColor = "#10b981";
          btnEl.textContent = "✅ Sent in Chat!";
        }
        const statusBanner = document.getElementById("gt-share-modal-status");
        if (statusBanner) {
          statusBanner.style.display = "block";
          statusBanner.style.background = "rgba(16,185,129,0.14)";
          statusBanner.style.border = "1px solid rgba(16,185,129,0.4)";
          statusBanner.style.color = "#34d399";
          statusBanner.innerHTML = `✅ Room <b>#${this.escapeHtml(targetMid)}</b> invite sent to <b>${this.escapeHtml((opts && opts.targetLabel) || data.target_label || "Chat")}</b>!`;
        }
      } else {
        throw new Error(data.detail || "Could not send invite");
      }
    } catch (err) {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.textContent = "📨 Send Invite";
      }
      const statusBanner = document.getElementById("gt-share-modal-status");
      if (statusBanner) {
        statusBanner.style.display = "block";
        statusBanner.style.background = "rgba(239,68,68,0.14)";
        statusBanner.style.border = "1px solid rgba(239,68,68,0.4)";
        statusBanner.style.color = "#f87171";
        statusBanner.textContent = `⚠️ ${err.message || "Error sending chat invite"}`;
      }
    }
  }

  renderShareChatTargets(matchId, threads, searchedUsers, queryStr) {
    const listEl = document.getElementById("gt-share-chat-list");
    if (!listEl) return;
    const token = this.getAuthToken();
    if (!token) {
      listEl.innerHTML = `
        <div style="padding:14px; text-align:center; color:#94a3b8; font-size:12px; background:#070b14; border:1px dashed #334155; border-radius:10px;">
          🔒 Sign in to an OmniTactica account to send interactive room cards in Chat, or use <b>Copy Link</b> above to share with anyone!
        </div>
      `;
      return;
    }

    const q = (queryStr || "").trim().toLowerCase();
    const myUid = this.userId || "";
    const items = [];
    const seenUserIds = new Set();

    (threads || []).forEach((r) => {
      if (!r || r.status === "declined") return;
      const isGroup = r.is_group || String(r.id || "").startsWith("grp_");
      const isOut = r.sender_id === myUid;
      const peerId = isGroup ? null : (isOut ? r.receiver_id : r.sender_id);
      if (peerId) seenUserIds.add(peerId);
      const name = isGroup
        ? (r.receiver_name || "Group Chat")
        : ((isOut ? r.receiver_name : r.sender_name) || "Player");
      const sub = isGroup
        ? (r.group_type === "league" ? "🏆 League Chat" : "⚔️ Pod Group Chat")
        : ((isOut ? r.receiver_factions : r.sender_factions) || "OmniTactica Player Chat");
      if (q && !name.toLowerCase().includes(q) && !sub.toLowerCase().includes(q)) return;
      items.push({
        requestId: r.id,
        receiverId: peerId,
        name,
        subtitle: sub,
        badge: isGroup ? "GROUP" : "CHAT"
      });
    });

    (searchedUsers || []).forEach((u) => {
      if (!u || !u.id || u.id === myUid || seenUserIds.has(u.id)) return;
      seenUserIds.add(u.id);
      items.push({
        requestId: null,
        receiverId: u.id,
        name: u.display_name || "Player",
        subtitle: [u.factions, u.location_name].filter(Boolean).join(" • ") || "OmniTactica Player",
        badge: "PLAYER"
      });
    });

    if (items.length === 0) {
      listEl.innerHTML = `
        <div style="padding:14px; text-align:center; color:#94a3b8; font-size:12px; background:#070b14; border:1px solid #1e293b; border-radius:10px;">
          ${q ? `No players or chats matching "${this.escapeHtml(queryStr)}".` : "No active chats yet. Type a player name above to search OmniTactica players!"}
        </div>
      `;
      return;
    }

    listEl.innerHTML = items.slice(0, 15).map((item) => `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; background:#070b14; border:1px solid #1e293b; border-radius:10px; padding:9px 12px;">
        <div style="min-width:0; text-align:left;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:12.5px; font-weight:800; color:#f8fafc; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${this.escapeHtml(item.name)}</span>
            <span style="font-size:9.5px; font-weight:800; padding:1px 6px; border-radius:4px; font-family:'JetBrains Mono',monospace; background:${item.badge === "GROUP" ? "rgba(245,158,11,0.16)" : "rgba(56,189,248,0.14)"}; color:${item.badge === "GROUP" ? "#fbbf24" : "#38bdf8"};">${item.badge}</span>
          </div>
          <div style="font-size:11px; color:#64748b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:1px;">${this.escapeHtml(item.subtitle)}</div>
        </div>
        <button type="button" onclick="window.__sendRoomInviteToChat('${this.escapeHtml(matchId)}', { requestId: '${this.escapeHtml(item.requestId || "")}', receiverId: '${this.escapeHtml(item.receiverId || "")}', targetLabel: '${this.escapeHtml(item.name)}' }, this)" style="background:#0284c7; color:#fff; border:1px solid #38bdf8; border-radius:8px; padding:6px 11px; font-size:11px; font-weight:800; cursor:pointer; font-family:'JetBrains Mono',monospace; white-space:nowrap; flex-shrink:0;">
          📨 Send Invite
        </button>
      </div>
    `).join("");
  }

  async openShareRoomModal(mid) {
    const matchId = mid || this.roomCode || "";
    if (!matchId) return;

    const shareUrl = this.getCleanRoomShareUrl(matchId);
    const spectatorUrl = `${shareUrl}&role=spectator`;
    const isRoomLocked = Boolean(this.room && this.room.is_locked);

    let modal = document.getElementById("gt-share-room-modal");
    if (modal) modal.remove();

    modal = document.createElement("div");
    modal.id = "gt-share-room-modal";
    modal.style.cssText = "position:fixed; inset:0; z-index:1000000; background:rgba(4,7,14,0.92); backdrop-filter:blur(14px); display:flex; align-items:center; justify-content:center; padding:14px; font-family:'Inter',sans-serif; box-sizing:border-box;";
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    const lockSectionHtml = `
      <div style="background:#090f1e; border:1px solid ${isRoomLocked ? "rgba(244,63,94,0.45)" : "rgba(16,185,129,0.4)"}; border-radius:14px; padding:13px 14px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
        <div style="flex:1; min-width:210px; text-align:left;">
          <div style="display:flex; align-items:center; gap:7px; margin-bottom:4px;">
            <span style="font-size:14px;">${isRoomLocked ? "🔒" : "🔓"}</span>
            <span style="font-size:11.5px; font-weight:800; color:${isRoomLocked ? "#fb7185" : "#34d399"}; font-family:'JetBrains Mono',monospace; text-transform:uppercase;">
              ${isRoomLocked ? "ROOM LOCKED (Owners Only)" : "ROOM UNLOCKED (Guests & Link Allowed)"}
            </span>
          </div>
          <div style="font-size:11px; color:#94a3b8; line-height:1.4;">
            ${isRoomLocked
              ? "Only the <b>seated Team Captains</b> can act. New visitors opening the link are routed to Spectator Mode."
              : "Anyone with the room link (including <b>Guests without an account</b>) can join an open Captain seat."}
          </div>
        </div>
        <button type="button" id="gt-room-lock-toggle-btn" onclick="window.__toggleRoomLock('${this.escapeHtml(matchId)}', ${!isRoomLocked}, this)" style="background:${isRoomLocked ? "#10b981" : "#e11d48"}; color:${isRoomLocked ? "#071318" : "#fff"}; border:none; border-radius:9px; padding:8px 13px; font-size:11px; font-weight:800; cursor:pointer; font-family:'JetBrains Mono',monospace; white-space:nowrap; flex-shrink:0;">
          ${isRoomLocked ? "🔓 UNLOCK FOR GUESTS" : "🔒 LOCK ROOM"}
        </button>
      </div>
    `;

    modal.innerHTML = `
      <div style="background:#0e1526; border:1px solid #1e293b; border-radius:20px; width:100%; max-width:520px; max-height:92vh; display:flex; flex-direction:column; box-shadow:0 25px 70px rgba(0,0,0,0.88); overflow:hidden; color:#f8fafc; box-sizing:border-box;">
        <div style="padding:16px 20px; background:#090f1e; border-bottom:1px solid #1e293b; display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:22px;">🔗</span>
            <div style="text-align:left;">
              <h2 style="font-size:16px; font-weight:800; color:#f8fafc; font-family:'JetBrains Mono',monospace; margin:0; letter-spacing:0.03em;">SHARE MATCH ROOM</h2>
              <div style="font-size:11px; color:#38bdf8; font-family:'JetBrains Mono',monospace;">${isRoomLocked ? "🔒 Locked (Owners Only)" : "🔓 Unlocked (Guest Ready)"}</div>
            </div>
          </div>
          <button type="button" onclick="document.getElementById('gt-share-room-modal').remove()" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#cbd5e1; width:30px; height:30px; border-radius:8px; cursor:pointer; font-size:15px;">✕</button>
        </div>

        <div style="padding:18px 20px; overflow-y:auto; display:flex; flex-direction:column; gap:16px;">
          <!-- Room Lock & Guest Access Control -->
          ${lockSectionHtml}

          <!-- Option 1: Share via Direct Link (No Account Needed) -->
          <div style="background:#090f1e; border:1px solid rgba(245,158,11,0.35); border-radius:14px; padding:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
              <span style="font-size:11.5px; font-weight:800; color:#f59e0b; text-transform:uppercase; font-family:'JetBrains Mono',monospace;">1. Share via Direct Link</span>
              <span style="font-size:10px; font-weight:700; color:${isRoomLocked ? "#fb7185" : "#10b981"}; background:${isRoomLocked ? "rgba(244,63,94,0.12)" : "rgba(16,185,129,0.12)"}; border:1px solid ${isRoomLocked ? "rgba(244,63,94,0.35)" : "rgba(16,185,129,0.3)"}; padding:2px 7px; border-radius:999px;">
                ${isRoomLocked ? "🔒 Locked • Owners Only" : "✓ No Account Required for Opponent"}
              </span>
            </div>
            <p style="font-size:11.5px; color:#94a3b8; margin:0 0 10px; line-height:1.45; text-align:left;">
              ${isRoomLocked
                ? "This room is currently <b>Locked</b>. Unlock the room above if you want an unauthenticated <b>Guest Captain</b> to join via this link."
                : "Your opponent can open this link in any browser without signing in to join as <b>Team B Captain (Guest)</b>. Once both seats are filled, any 3rd+ person opening the link is automatically routed to <b>Spectator Mode</b>."}
            </p>
            <div style="display:flex; gap:8px; margin-bottom:8px;">
              <input id="gt-share-modal-url-input" readonly value="${shareUrl}" style="flex:1; min-width:0; background:#070b14; border:1px solid #334155; border-radius:8px; padding:9px 10px; font-size:11px; color:#e2e8f0; font-family:'JetBrains Mono',monospace; outline:none;" onclick="this.select()" />
              <button type="button" id="gt-share-copy-link-btn" onclick="window.__copyRoomShareLink('${this.escapeHtml(matchId)}', this)" style="background:#f59e0b; color:#090d16; font-weight:800; font-size:11px; border:none; padding:9px 14px; border-radius:8px; cursor:pointer; font-family:'JetBrains Mono',monospace; white-space:nowrap;">
                📋 COPY LINK
              </button>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button type="button" id="gt-share-copy-spectator-btn" onclick="navigator.clipboard.writeText('${spectatorUrl}'); this.innerHTML='✅ SPECTATOR LINK COPIED!'; setTimeout(()=>this.innerHTML='👀 Copy Spectator Link', 1600);" style="flex:1; background:#1e293b; color:#38bdf8; border:1px solid rgba(56,189,248,0.35); border-radius:8px; padding:7px 10px; font-size:11px; font-weight:700; cursor:pointer; font-family:'JetBrains Mono',monospace;">
                👀 Copy Spectator Link
              </button>
            </div>
          </div>

          <!-- Option 2: Share in OmniTactica Chat -->
          <div style="background:#090f1e; border:1px solid rgba(56,189,248,0.35); border-radius:14px; padding:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
              <span style="font-size:11.5px; font-weight:800; color:#38bdf8; text-transform:uppercase; font-family:'JetBrains Mono',monospace;">2. Share in OmniTactica Chat</span>
              <span style="font-size:10px; color:#94a3b8;">Direct &amp; League/Pod Chats</span>
            </div>
            <div id="gt-share-modal-status" style="display:none; margin-bottom:10px; padding:8px 11px; border-radius:8px; font-size:11.5px; font-weight:600; text-align:left;"></div>
            <div style="margin-bottom:10px;">
              <input id="gt-share-chat-search" type="text" placeholder="Search opponent name, active chat, or league group..." style="width:100%; box-sizing:border-box; background:#070b14; border:1px solid #334155; border-radius:8px; padding:8px 11px; font-size:12px; color:#f8fafc; outline:none;" />
            </div>
            <div id="gt-share-chat-list" style="display:flex; flex-direction:column; gap:7px; max-height:210px; overflow-y:auto;">
              <div style="padding:12px; text-align:center; color:#94a3b8; font-size:12px;">Loading your OmniTactica chats...</div>
            </div>
          </div>

          <!-- Multi-Device Same-Player Info Banner -->
          <div style="background:rgba(56,189,248,0.07); border:1px solid rgba(56,189,248,0.22); border-radius:10px; padding:10px 12px; font-size:11px; color:#cbd5e1; line-height:1.45; text-align:left;">
            📱 <b>Using an iPad + Phone?</b> Sign into the same OmniTactica account on both devices and open this room. Both devices sync live as <b>your Captain seat</b> without taking the opponent's slot.
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const token = this.getAuthToken();
    const searchInput = document.getElementById("gt-share-chat-search");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        const q = searchInput.value || "";
        this.renderShareChatTargets(matchId, this._shareChatThreadsCache, [], q);
        if (this._shareUserSearchTimer) clearTimeout(this._shareUserSearchTimer);
        if (q.trim().length >= 1 && token) {
          this._shareUserSearchTimer = setTimeout(async () => {
            try {
              const uResp = await fetch(`/api/connect/users/search?q=${encodeURIComponent(q.trim())}`, {
                headers: { "Authorization": `Bearer ${token}` }
              });
              if (uResp.ok) {
                const uData = await uResp.json();
                this.renderShareChatTargets(matchId, this._shareChatThreadsCache, uData.users || [], q);
              }
            } catch (_) {}
          }, 220);
        }
      });
    }

    if (!token) {
      this.renderShareChatTargets(matchId, [], [], "");
      return;
    }

    try {
      const resp = await fetch("/api/connect/requests", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (resp.ok) {
        const data = await resp.json();
        this._shareChatThreadsCache = (data && data.requests) ? data.requests : [];
      }
    } catch (_) {}
    this.renderShareChatTargets(matchId, this._shareChatThreadsCache, [], searchInput ? searchInput.value : "");
  }

  renderLobbySeatLockState() {
    if (!this.room) return;
    const isRoomLocked = !!this.room.is_locked;

    // Topbar lock pill
    const topLockBtn = document.getElementById("btnTopbarRoomLock");
    if (topLockBtn) {
      topLockBtn.classList.toggle("locked", isRoomLocked);
      topLockBtn.classList.toggle("unlocked", !isRoomLocked);
      topLockBtn.textContent = isRoomLocked ? "🔒 Locked" : "🔓 Unlocked";
    }

    // Lobby lock toggle button & status badge
    const lobbyLockBtn = document.getElementById("btnLobbyToggleLock");
    if (lobbyLockBtn) {
      lobbyLockBtn.classList.toggle("locked", isRoomLocked);
      lobbyLockBtn.classList.toggle("unlocked", !isRoomLocked);
      lobbyLockBtn.textContent = isRoomLocked ? "🔒 Locked" : "🔓 Unlocked";
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
        ownerName: this.room.seat_a_owner_name || this.room.team_a?.captain_name || "Team A Captain",
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
        ownerName: this.room.seat_b_owner_name || this.room.team_b?.captain_name || "Team B Captain",
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
          ownerText.textContent = "Seated: You";
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
        teamNameInput.value = this.lobbyTeamNames[seat] || "";
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
        elo: playerObj.elo || 2080
      });
    } else {
      list[targetSize - 1] = {
        name: playerObj.name,
        faction: chosenFaction,
        detachment: playerObj.detachment || meta.detachment,
        elo: playerObj.elo || 2080
      };
      this.showToast(`Swapped ${playerObj.name} into slot #${targetSize}`);
    }

    // Auto-fill Team Name input if blank and player belongs to a known team
    if (playerObj.team_name && !this.lobbyTeamNames[this.activeRole]) {
      this.lobbyTeamNames[this.activeRole] = playerObj.team_name;
      const teamNameInput = document.getElementById("lobbyTeamNameInput");
      if (teamNameInput && !teamNameInput.value.trim()) {
        teamNameInput.value = playerObj.team_name;
      }
    }

    this.lobbyDraftTeam[this.activeRole] = list;
    this.renderLobbyDeckBuilder();
  }

  renderLobbyDeckBuilder() {
    const roleKey = this.activeRole === "captain_b" ? "captain_b" : "captain_a";
    const targetSize = this.getTargetHandSize();
    const hand = this.lobbyDraftTeam[roleKey] || [];

    const countLbl = document.getElementById("lobbyDeckCountLabel");
    if (countLbl) countLbl.textContent = `${hand.length} / ${targetSize}`;

    const statusHint = document.getElementById("lobbyStatusHint");
    if (statusHint) {
      if (hand.length === 0) {
        statusHint.textContent = `Search players or a team name above to add ${targetSize} cards to your hand.`;
      } else if (hand.length < targetSize) {
        statusHint.textContent = `Select ${targetSize - hand.length} more player(s) via search above.`;
      } else {
        statusHint.textContent = `Ready! ${targetSize}/${targetSize} Player Cards in your hand. Click ENTER DUEL ARENA.`;
      }
    }

    this.renderSearchResults();

    const tray = document.getElementById("lobbyHandTray");
    if (!tray) return;
    tray.classList.toggle("format-8v8", targetSize === 8);

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
              elo: p.elo
            })}
          </div>
        `);
      } else {
        slotsHtml.push(`
          <div class="lobby-empty-slot">
            <span style="font-size:1.3rem;">➕</span>
            <span>EMPTY CARD SLOT #${i + 1}</span>
            <span>Search player above</span>
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

    const fmt = (document.getElementById("selectFormat")?.value || this.room?.format_size || "5v5").toLowerCase() === "8v8" ? "8v8" : "5v5";
    const finalHand = this.lobbyDraftTeam[this.activeRole] || [];
    if (finalHand.length === 0) {
      await this.onFormatChanged(fmt);
      this.closeLobbyModal();
      this.renderAll();
      if (this.room && !this.room.coin_flip_done && this.room.phase !== "COMPLETED") {
        this.openCoinFlipModal();
      }
      return;
    }

    const defaultTeamLbl = this.activeRole === "captain_a" ? "Team A" : "Team B";
    const teamName = (document.getElementById("lobbyTeamNameInput")?.value || "").trim() ||
      this.lobbyTeamNames[this.activeRole] ||
      defaultTeamLbl;
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
            user_name: this.userName || finalHand[0]?.name || `${defaultTeamLbl} Captain`,
            captain_token: tok,
            action: "set_team_roster",
            payload: {
              format_size: fmt,
              format: fmt,
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
          this.syncLobbyDraftFromRoom();
        }
      } catch (_) {}
    }

    const lockedCount = (this.lobbyDraftTeam[this.activeRole] || finalHand).length;
    this.closeLobbyModal();
    this.renderAll();
    this.showToast(`Locked ${lockedCount} players for ${teamName} (${fmt.toUpperCase()})!`);

    if (this.room && !this.room.coin_flip_done && this.room.phase !== "COMPLETED") {
      this.openCoinFlipModal();
    }
  }

  openCoinFlipModal() {
    const modal = document.getElementById("coinFlipModalBackdrop");
    if (!modal) return;
    modal.classList.remove("hidden");
    this.renderCoinFlipModal();
  }

  closeCoinFlipModal() {
    const modal = document.getElementById("coinFlipModalBackdrop");
    if (modal) modal.classList.add("hidden");
  }

  renderCoinFlipModal() {
    if (!this.room) return;
    const teamA = this.room.team_a || {};
    const teamB = this.room.team_b || {};
    const winner = this.room.coin_flip_winner;
    const done = !!this.room.coin_flip_done;
    const defRole = this.room.defender_role;
    const aiChoice = this.room.ai_coin_choice;

    const tagA = document.getElementById("coinFlipTeamATag");
    const nameA = document.getElementById("coinFlipTeamAName");
    const capA = document.getElementById("coinFlipTeamACap");
    const boxA = document.getElementById("coinFlipTeamABox");
    if (tagA) tagA.textContent = teamA.tag || "TMA";
    if (nameA) nameA.textContent = teamA.name || "Team A";
    if (capA) capA.textContent = `Cap: ${teamA.captain_name || "Team A Captain"}`;
    if (boxA) boxA.classList.toggle("winner", winner === "captain_a");

    const tagB = document.getElementById("coinFlipTeamBTag");
    const nameB = document.getElementById("coinFlipTeamBName");
    const capB = document.getElementById("coinFlipTeamBCap");
    const boxB = document.getElementById("coinFlipTeamBBox");
    if (tagB) tagB.textContent = teamB.tag || "TMB";
    if (nameB) nameB.textContent = teamB.name || "Team B";
    if (capB) capB.textContent = `Cap: ${teamB.captain_name || "Team B Captain"}`;
    if (boxB) boxB.classList.toggle("winner", winner === "captain_b");

    const faceLbl = document.getElementById("coinFaceFrontLabel");
    if (faceLbl) {
      if (winner === "captain_a") {
        faceLbl.textContent = teamA.tag || "TMA";
      } else if (winner === "captain_b") {
        faceLbl.textContent = teamB.tag || "TMB";
      } else {
        faceLbl.textContent = "TOSS";
      }
    }

    const headline = document.getElementById("coinFlipStatusHeadline");
    const sub = document.getElementById("coinFlipStatusSub");
    const btnFlip = document.getElementById("btnFlipCoinNow");
    const aiBanner = document.getElementById("coinFlipAiChoiceBanner");
    const aiText = document.getElementById("coinFlipAiChoiceText");
    const choiceGrid = document.getElementById("coinFlipRoleChoiceSection");

    if (!winner) {
      if (headline) headline.textContent = "READY TO FLIP FOR CYCLE 1 ROLE SELECTION";
      if (sub) {
        sub.textContent = "Neither team defaults to Defender — flip the coin to decide who chooses Defender or Attacker first!";
      }
      if (btnFlip) {
        btnFlip.disabled = this.activeRole === "spectator";
        btnFlip.textContent = "🪙 FLIP COIN";
      }
      aiBanner?.classList.add("hidden");
      choiceGrid?.classList.add("hidden");
      return;
    }

    const winTeamName = winner === "captain_a" ? (teamA.name || "Team A") : (teamB.name || "Team B");
    if (btnFlip) {
      btnFlip.disabled = this.activeRole === "spectator";
      btnFlip.textContent = "🔄 RE-FLIP COIN";
    }

    if (done && defRole) {
      const defTeamName = defRole === "captain_a" ? (teamA.name || "Team A") : (teamB.name || "Team B");
      const attTeamName = defRole === "captain_a" ? (teamB.name || "Team B") : (teamA.name || "Team A");
      if (headline) {
        headline.textContent = `🪙 ${winTeamName.toUpperCase()} WON THE TOSS!`;
      }
      if (sub) {
        sub.textContent = `Cycle 1 Roles Locked: 🛡️ ${defTeamName} is DEFENDER • ⚔️ ${attTeamName} is ATTACKER (roles swap each cycle).`;
      }
    } else if (winner === "captain_b" && this.room.vs_ai && this.activeRole === "captain_a") {
      const aiPicked = (aiChoice || "defender").toUpperCase();
      const myStartRole = aiPicked === "DEFENDER" ? "ATTACKER" : "DEFENDER";
      if (headline) {
        headline.textContent = `🪙 ${winTeamName.toUpperCase()} WON THE COIN FLIP!`;
      }
      if (sub) {
        sub.textContent = `AI Captain chose ${aiPicked} for Cycle 1 — You will start Cycle 1 as ${myStartRole} (or pick below to override in practice mode).`;
      }
      if (aiBanner) aiBanner.classList.remove("hidden");
      if (aiText) {
        aiText.innerHTML = `🤖 <strong>${this.escapeHtml(winTeamName)}</strong> won the coin toss and chose <strong>${aiPicked}</strong> (you start Cycle 1 as <strong>${myStartRole}</strong>)!`;
      }
    } else {
      if (headline) {
        headline.textContent = `🪙 ${winTeamName.toUpperCase()} WON THE COIN FLIP!`;
      }
      if (sub) {
        sub.textContent = "Select whether you want to start Cycle 1 as DEFENDER (place 1 card first) or ATTACKER (send 2 cards against enemy Defender):";
      }
      aiBanner?.classList.add("hidden");
    }

    if (this.activeRole !== "spectator") {
      choiceGrid?.classList.remove("hidden");
    } else {
      choiceGrid?.classList.add("hidden");
    }
  }

  async flipCoinForRole(forceWinner = null) {
    if (!this.roomCode || this.activeRole === "spectator") return;
    const coinEl = document.getElementById("coinFlipCoin3d");
    if (coinEl) {
      coinEl.classList.remove("spinning");
      void coinEl.offsetWidth;
      coinEl.classList.add("spinning");
    }
    const tok = this.captainTokens[this.activeRole] || this.loadRoomTokenFromStorage(this.roomCode, this.activeRole);
    try {
      const payload = {};
      if (forceWinner) payload.force_winner = forceWinner;
      const resp = await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: this.activeRole,
          user_id: this.userId,
          captain_token: tok,
          action: "flip_coin",
          payload
        })
      });
      const data = await resp.json();
      if (data && (data.ok || data.success) && data.room) {
        this.room = data.room;
        this.syncLobbyDraftFromRoom();
        setTimeout(() => {
          this.renderCoinFlipModal();
          this.renderAll();
        }, 420);
      }
    } catch (err) {
      console.error("Coin flip failed:", err);
    }
  }

  async chooseCoinFlipRole(choice, chooserOverride = null) {
    if (!this.roomCode || this.activeRole === "spectator") return;
    const tok = this.captainTokens[this.activeRole] || this.loadRoomTokenFromStorage(this.roomCode, this.activeRole);
    const chooserRole = chooserOverride || this.room?.coin_flip_winner || this.activeRole;
    try {
      const resp = await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: this.activeRole,
          user_id: this.userId,
          captain_token: tok,
          action: "choose_coin_flip_role",
          payload: {
            choice,
            chooser_role: chooserRole,
            vs_ai: document.getElementById("chkVsAi")?.checked ?? true
          }
        })
      });
      const data = await resp.json();
      if (data && (data.ok || data.success) && data.room) {
        this.room = data.room;
        this.selectedIds = [];
        this.syncLobbyDraftFromRoom();
        this.closeCoinFlipModal();
        this.renderAll();
        const p = this.getPerspective();
        const myRoleLabel = p?.amIDefender ? "🛡️ DEFENDER" : "⚔️ ATTACKER";
        this.showToast(`🪙 Cycle 1 Started! You are ${myRoleLabel} (roles swap every cycle).`);
      }
    } catch (err) {
      console.error("Failed to lock coin flip role:", err);
    }
  }

  async acceptAiCoinChoice() {
    if (!this.room) return;
    const aiChoice = this.room.ai_coin_choice || "defender";
    await this.chooseCoinFlipRole(aiChoice, "captain_b");
  }

  async createNewRoom({ openLobby = false, emptyRosters = true } = {}) {
    const fmt = document.getElementById("selectFormat")?.value || "5v5";
    const vsAi = document.getElementById("chkVsAi")?.checked ?? true;

    try {
      const resp = await fetch("/api/team-pairings/room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format_size: fmt,
          empty_rosters: emptyRosters,
          vs_ai: vsAi,
          owner_id: this.userId,
          user_id: this.userId,
          user_name: this.userName || "Team A Captain",
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
        this.inspectedPlayer = null;
        this.syncLobbyDraftFromRoom();

        const searchInp = document.getElementById("playerSearchInput");
        if (searchInp) searchInp.value = "";
        this.searchResultsPlayers = [];
        this.renderSearchResults();

        this.renderLobbySeatLockState();
        this.closeCoinFlipModal();
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
          this.renderCoinFlipModal();
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
    const myRoleKey = isCapB ? "captain_b" : "captain_a";
    const isAlternating = r.defender_role === "captain_a" || r.defender_role === "captain_b";
    const amIDefender = isAlternating ? (r.defender_role === myRoleKey) : true;
    const amIAttacker = isAlternating ? (r.attacker_role === myRoleKey) : true;
    let isMyActionTurn = true;
    if (isAlternating) {
      if (r.phase === "STEP_1_DEFENDER" || r.phase === "STEP_3_CHOOSE") {
        isMyActionTurn = amIDefender;
      } else if (r.phase === "STEP_2_ATTACKERS") {
        isMyActionTurn = amIAttacker;
      } else {
        isMyActionTurn = false;
      }
    }

    return {
      isCapB,
      myRoleKey,
      isAlternating,
      amIDefender,
      amIAttacker,
      isMyActionTurn,
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

    const specBanner = document.getElementById("spectatorBanner");
    if (specBanner) {
      specBanner.classList.toggle("hidden", !p.isSpectator);
    }

    const coinBtn = document.getElementById("btnOpenCoinFlipModal");
    if (coinBtn) {
      if (p.isAlternating && this.room.phase !== "COMPLETED") {
        coinBtn.textContent = p.amIDefender ? "🪙 Role: 🛡️ DEF" : "🪙 Role: ⚔️ ATK";
      } else {
        coinBtn.textContent = "🪙 Coin Flip";
      }
    }

    this.renderLobbySeatLockState();
    this.renderDuelistHud(p);
    this.renderBattleLine(p);
    this.renderPlaymatZones(p);
    this.renderHands(p);
    this.renderPairedTables();
    this.renderPairingProcessGuide(p);
  }

  renderDuelistHud(p) {
    const oppTag = document.getElementById("oppHudTag");
    const oppName = document.getElementById("oppHudTeamName");
    const oppCap = document.getElementById("oppHudCaptain");
    const oppStatus = document.getElementById("capBStatusPill");
    const oppAvatar = document.getElementById("oppHudAvatar");

    if (oppTag) oppTag.textContent = p.oppTeam.tag || "TMB";
    if (oppName) oppName.textContent = p.oppTeam.name || "Team B";
    if (oppCap) oppCap.textContent = `Cap: ${p.oppTeam.captain_name || "Waiting..."}`;
    if (oppAvatar) {
      const oppLeadFac = p.oppDef?.faction || p.oppTeam.roster?.[0]?.faction || "Necrons";
      oppAvatar.innerHTML = getFactionSvgHtml(oppLeadFac, "armory-faction-svg");
    }

    const myTag = document.getElementById("myHudTag");
    const myName = document.getElementById("myHudTeamName");
    const myCap = document.getElementById("myHudCaptain");
    const myStatus = document.getElementById("capAStatusPill");
    const myAvatar = document.getElementById("myHudAvatar");

    if (myTag) myTag.textContent = p.myTeam.tag || "TMA";
    if (myName) myName.textContent = p.myTeam.name || "Team A";
    if (myCap) myCap.textContent = `Cap: ${p.myTeam.captain_name || "You"} (${p.isSpectator ? "Spectating" : "LOCKED"})`;
    if (myAvatar) {
      const myLeadFac = p.myDef?.faction || p.myTeam.roster?.[0]?.faction || "Aeldari";
      myAvatar.innerHTML = getFactionSvgHtml(myLeadFac, "armory-faction-svg");
    }

    const phase = this.room.phase;
    if (p.isAlternating && phase !== "COMPLETED") {
      if (oppStatus) {
        oppStatus.textContent = !p.amIDefender ? "🛡️ DEFENDER" : "⚔️ ATTACKER";
        oppStatus.classList.toggle("ready", !p.isMyActionTurn);
      }
      if (myStatus) {
        const myRoleIcon = p.amIDefender ? "🛡️ DEFENDER" : "⚔️ ATTACKER";
        myStatus.textContent = p.isSpectator
          ? `👁️ ${myRoleIcon}`
          : (p.isMyActionTurn ? `${myRoleIcon} • YOUR TURN` : `${myRoleIcon} • WAITING`);
        myStatus.classList.toggle("ready", p.isMyActionTurn);
      }
      return;
    }

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
      if (phase === "COMPLETED") {
        cycleBadge.textContent = "DUEL COMPLETE";
      } else if (p.isAlternating) {
        cycleBadge.textContent = `CYCLE ${this.room.cycle}/${this.room.max_cycles} • ${p.amIDefender ? "🛡️ DEF" : "⚔️ ATK"}`;
      } else {
        cycleBadge.textContent = `CYCLE ${this.room.cycle}/${this.room.max_cycles}`;
      }
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

    if (p.isAlternating && !p.isMyActionTurn && phase !== "COMPLETED") {
      if (hintBadge) hintBadge.textContent = "WAIT";
      if (promptEl) {
        if (phase === "STEP_1_DEFENDER") {
          promptEl.textContent = "⏳ WAITING FOR ENEMY DEFENDER TO PLACE 1 DEFENDER CARD...";
        } else if (phase === "STEP_2_ATTACKERS") {
          promptEl.textContent = "⏳ WAITING FOR ENEMY ATTACKER TO SEND 2 ATTACKERS AGAINST YOUR DEFENDER...";
        } else {
          promptEl.textContent = "⏳ WAITING FOR ENEMY DEFENDER TO PICK 1 OF YOUR 2 ATTACKERS...";
        }
      }
      if (btnLock) {
        btnLock.disabled = true;
        btnLock.textContent = "⏳ OPPONENT'S TURN";
      }
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
            : (p.isAlternating
                ? "🛡️ YOU ARE DEFENDER: CLICK 1 CARD IN YOUR BOTTOM HAND TO PLACE AS DEFENDER"
                : "PHASE 1: CLICK 1 CARD IN YOUR BOTTOM HAND TO PLACE AS DEFENDER");
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
            : (p.isAlternating
                ? `⚔️ YOU ARE ATTACKER: CLICK 2 CARDS IN YOUR HAND TO CHALLENGE ${(p.oppDef?.name || "ENEMY DEFENDER").toUpperCase()}`
                : "PHASE 2: CLICK 2 CARDS IN YOUR BOTTOM HAND TO ATTACK ENEMY DEFENDER");
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
            : (p.isAlternating
                ? "🎯 DEFENDER'S CHOICE: CLICK 1 OF THE 2 ENEMY ATTACKERS FOR YOUR DEFENDER TO FIGHT"
                : "PHASE 3: CLICK 1 PULSING ENEMY ATTACKER ON THE TOP FIELD FOR YOUR DEFENDER");
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
    myDefSlot?.classList.toggle("active-target-zone", phase === "STEP_1_DEFENDER" && !p.isSpectator && p.isMyActionTurn);
    myAttSlot?.classList.toggle("active-target-zone", phase === "STEP_2_ATTACKERS" && !p.isSpectator && p.isMyActionTurn);
    oppAttSlot?.classList.toggle("active-target-zone", phase === "STEP_3_CHOOSE" && !p.isSpectator && p.isMyActionTurn);

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
          const canPick = phase === "STEP_3_CHOOSE" && !p.isSpectator && !p.mySecChoiceLocked && p.isMyActionTurn;
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
            if (phase === "STEP_3_CHOOSE" && !p.isSpectator && !p.mySecChoiceLocked && p.isMyActionTurn) {
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
      if (phase === "STEP_1_DEFENDER" && p.isMyActionTurn) {
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
            if (phase === "STEP_1_DEFENDER" && !p.mySecDefLocked && p.isMyActionTurn) {
              this.toggleHandCardSelection(cardToShow.id);
            }
          });
        }
      } else if (p.mySecDefLocked) {
        myDefMount.innerHTML = this.buildFaceDownFieldCardHtml("LOCKED DEF");
      } else {
        const emptyDefHint = (p.isAlternating && !p.amIDefender) ? "ATTACKER ROLE" : "CLICK HAND CARD";
        myDefMount.innerHTML = `<div class="empty-zone-sigil"><span class="sigil-icon">🛡️</span><span>${emptyDefHint}</span></div>`;
      }
    }

    // 4. YOUR 2 ATTACKERS MOUNT
    const myAttMount = document.getElementById("myAttackersMount");
    if (myAttMount) {
      let cardsToShow = [];
      if (p.myAtts && p.myAtts.length > 0) {
        cardsToShow = p.myAtts;
      } else if (phase === "STEP_2_ATTACKERS" && p.isMyActionTurn) {
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
              if (phase === "STEP_2_ATTACKERS" && !p.mySecAttsLocked && p.isMyActionTurn) {
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
      const teamLabel = (p.myTeam.name || "YOUR TEAM").toUpperCase();
      handTitle.textContent = p.isSpectator
        ? `${teamLabel} HAND (${myBench.length} CARDS REMAINING)`
        : `YOUR HAND — ${teamLabel} (${myBench.length} CARDS IN HAND • CLICK TO PLACE ON FIELD)`;
    }

    const myFan = document.getElementById("myHandFan");
    if (!myFan) return;
    const is8v8 = (this.room?.team_size === 8 || this.room?.total_tables === 8 || myBench.length > 5);
    myFan.classList.toggle("format-8v8", is8v8);

    if ((p.myTeam.roster || []).length === 0) {
      myFan.innerHTML = "";
      return;
    }

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

    if (p.isAlternating && !p.isMyActionTurn) {
      this.showToast("Wait for the opposing Captain to complete their step first.");
      return;
    }

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
    // If rosters are empty or don't match the selected format when Auto-Duel is clicked, initialize a room with rosters first
    const targetTables = this.getTargetHandSize();
    if (
      !(this.room.team_a?.roster?.length) ||
      !(this.room.team_b?.roster?.length) ||
      this.room.team_a.roster.length !== targetTables ||
      this.room.team_b.roster.length !== targetTables
    ) {
      await this.createNewRoom({ openLobby: false, emptyRosters: false });
    }
    this.closeCoinFlipModal();
    const roleToUse = this.activeRole === "spectator" ? "captain_a" : this.activeRole;
    const tok = this.captainTokens[roleToUse] || this.captainTokens.captain_a || "";

    for (let guard = 0; guard < 25; guard++) {
      if (!this.room || this.room.phase === "COMPLETED") break;
      const isAlternating = this.room.defender_role === "captain_a" || this.room.defender_role === "captain_b";
      let actingRole = roleToUse;
      if (isAlternating) {
        if (this.room.phase === "STEP_1_DEFENDER" || this.room.phase === "STEP_3_CHOOSE") {
          actingRole = this.room.defender_role;
        } else if (this.room.phase === "STEP_2_ATTACKERS") {
          actingRole = this.room.attacker_role;
        }
      }
      const isCapB = actingRole === "captain_b";
      const myTeam = isCapB ? this.room.team_b : this.room.team_a;
      const oppAtts = isCapB ? (this.room.active_attackers_a || []) : (this.room.active_attackers_b || []);
      const bench = (myTeam.roster || []).filter((c) => c.status === "bench");
      const actingTok = this.captainTokens[actingRole] || tok;

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
          role: actingRole,
          user_id: this.userId,
          captain_token: actingTok,
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

  inspectCard(player) {
    if (player) this.inspectedPlayer = player;
  }

  renderPairingProcessGuide(p) {
    if (!this.room || !p) return;
    const phase = this.room.phase;
    const cycle = Number(this.room.cycle || 1);
    const maxCycles = Number(this.room.max_cycles || 2);
    const totalTables = Number(this.room.total_tables || 5);
    const pairedCount = (this.room.pairings || []).length;
    const roleBanner = p.isAlternating
      ? (p.amIDefender ? " • 🛡️ YOU: DEFENDER" : " • ⚔️ YOU: ATTACKER")
      : "";
    const fmtLabel = `${totalTables === 8 ? "8v8" : "5v5"} WTC Format • ${totalTables} Tables${roleBanner}`;

    const cycleBadge = document.getElementById("pgCycleBadge");
    if (cycleBadge) {
      cycleBadge.textContent = phase === "COMPLETED" ? "COMPLETED" : `CYCLE ${cycle} / ${maxCycles}`;
    }

    const fmtSub = document.getElementById("pgFormatSub");
    if (fmtSub) fmtSub.textContent = fmtLabel;

    const tablesProg = document.getElementById("pgTablesProgress");
    if (tablesProg) tablesProg.textContent = `${pairedCount} / ${totalTables} Paired`;

    const tagEl = document.getElementById("pgActiveStepTag");
    const headlineEl = document.getElementById("pgActiveStepHeadline");
    const descEl = document.getElementById("pgActiveStepDesc");
    const myChip = document.getElementById("pgMyLockChip");
    const oppChip = document.getElementById("pgOppLockChip");

    const sCard1 = document.getElementById("pgStepCard1");
    const sCard2 = document.getElementById("pgStepCard2");
    const sCard3 = document.getElementById("pgStepCard3");
    const sState1 = document.getElementById("pgStepState1");
    const sState2 = document.getElementById("pgStepState2");
    const sState3 = document.getElementById("pgStepState3");

    [sCard1, sCard2, sCard3].forEach((el) => el?.classList.remove("active", "done"));

    let myLocked = false;
    let oppLocked = false;

    if (phase === "STEP_1_DEFENDER") {
      myLocked = p.isAlternating ? !p.isMyActionTurn : !!p.mySecDefLocked;
      oppLocked = p.isAlternating ? p.isMyActionTurn : !!p.oppSecDefLocked;
      if (tagEl) {
        tagEl.textContent = p.isAlternating
          ? `CYCLE ${cycle} • ${p.amIDefender ? "🛡️ DEFENDER" : "⚔️ ATTACKER"}`
          : `CYCLE ${cycle} • STEP 1 OF 3`;
      }
      if (headlineEl) {
        headlineEl.textContent = p.isAlternating
          ? (p.amIDefender ? "Step 1: Place Your Defender" : "Step 1: Enemy Places Defender")
          : "Step 1: Blind Defender";
      }
      if (descEl) {
        descEl.textContent = p.isAlternating
          ? (p.amIDefender
              ? "You are DEFENDER this cycle! Select 1 player card from your bottom hand to place in your Defender Zone, then click Lock In Defender."
              : "You are ATTACKER this cycle! Waiting for the Defender team to put forward 1 Defender card first.")
          : (myLocked
              ? "Your Defender is locked face-down. Waiting for opponent Captain to lock their Defender so both reveal simultaneously."
              : "Select 1 player card from your bottom hand to place face-down in your Defender Zone, then click Lock In Defender.");
      }
      sCard1?.classList.add("active");
      if (sState1) sState1.textContent = "ACTIVE";
      if (sState2) sState2.textContent = "NEXT";
      if (sState3) sState3.textContent = "PENDING";
    } else if (phase === "STEP_2_ATTACKERS") {
      myLocked = p.isAlternating ? !p.isMyActionTurn : !!p.mySecAttsLocked;
      oppLocked = p.isAlternating ? p.isMyActionTurn : !!p.oppSecAttsLocked;
      if (tagEl) {
        tagEl.textContent = p.isAlternating
          ? `CYCLE ${cycle} • ${p.amIDefender ? "🛡️ DEFENDER" : "⚔️ ATTACKER"}`
          : `CYCLE ${cycle} • STEP 2 OF 3`;
      }
      if (headlineEl) headlineEl.textContent = "Step 2: Send 2 Attackers";
      if (descEl) {
        descEl.textContent = p.isAlternating
          ? (p.amIAttacker
              ? `Enemy Defender (${p.oppDef?.name || "Revealed"}) is on the mat! As ATTACKER, select 2 cards from your hand to challenge them, then click Lock In 2 Attackers.`
              : `Your Defender (${p.myDef?.name || "Revealed"}) is on the mat. Waiting for the Attacker team to send 2 Attackers against you.`)
          : (myLocked
              ? "Your 2 Attackers are locked face-down. Waiting for opponent Captain to lock their 2 Attackers."
              : `Enemy Defender (${p.oppDef?.name || "Revealed"}) is on the mat! Select 2 cards from your bottom hand to challenge them, then click Lock In 2 Attackers.`);
      }
      sCard1?.classList.add("done");
      sCard2?.classList.add("active");
      if (sState1) sState1.textContent = "DONE";
      if (sState2) sState2.textContent = "ACTIVE";
      if (sState3) sState3.textContent = "NEXT";
    } else if (phase === "STEP_3_CHOOSE") {
      myLocked = p.isAlternating ? !p.isMyActionTurn : !!p.mySecChoiceLocked;
      oppLocked = p.isAlternating ? p.isMyActionTurn : !!p.oppSecChoiceLocked;
      const isFinalCycle = cycle >= maxCycles;
      if (tagEl) {
        tagEl.textContent = p.isAlternating
          ? `CYCLE ${cycle} • ${p.amIDefender ? "🛡️ DEFENDER" : "⚔️ ATTACKER"}`
          : `CYCLE ${cycle} • STEP 3 OF 3`;
      }
      if (headlineEl) headlineEl.textContent = "Step 3: Defender's Choice";
      if (descEl) {
        descEl.textContent = p.isAlternating
          ? (p.amIDefender
              ? "Click 1 of the 2 pulsing enemy Attackers on the top mat for your Defender to fight. The unchosen Attacker returns to their hand, and roles swap next cycle!"
              : "Waiting for the enemy Defender to pick 1 of your 2 Attackers to fight. Your unchosen Attacker will return to your hand, and you become DEFENDER next cycle!")
          : (myLocked
              ? "Your Defender's matchup choice is locked. Waiting for opponent Captain."
              : isFinalCycle
                ? "Click 1 of the 2 pulsing enemy Attackers on the top mat for your Defender to fight. Unchosen Attackers automatically pair on the final table!"
                : "Click 1 of the 2 pulsing enemy Attackers on the top mat for your Defender to fight. The unchosen Attacker returns to their Captain's hand.");
      }
      sCard1?.classList.add("done");
      sCard2?.classList.add("done");
      sCard3?.classList.add("active");
      if (sState1) sState1.textContent = "DONE";
      if (sState2) sState2.textContent = "DONE";
      if (sState3) sState3.textContent = "ACTIVE";
    } else {
      myLocked = true;
      oppLocked = true;
      if (tagEl) tagEl.textContent = "PAIRINGS COMPLETE";
      if (headlineEl) headlineEl.textContent = `All ${totalTables} Tables Locked!`;
      if (descEl) {
        descEl.textContent = "Every matchup has been finalized. Review the full table pairings on the right dock or start a new room.";
      }
      sCard1?.classList.add("done");
      sCard2?.classList.add("done");
      sCard3?.classList.add("done");
      if (sState1) sState1.textContent = "DONE";
      if (sState2) sState2.textContent = "DONE";
      if (sState3) sState3.textContent = "DONE";
    }

    if (myChip) {
      if (p.isAlternating && phase !== "COMPLETED") {
        myChip.textContent = p.isMyActionTurn
          ? `⚡ You (${p.amIDefender ? "DEF" : "ATK"}): Acting`
          : `⏳ You (${p.amIDefender ? "DEF" : "ATK"}): Waiting`;
        myChip.classList.toggle("ready", !p.isMyActionTurn);
      } else {
        myChip.textContent = myLocked
          ? "✓ You: Locked In"
          : (p.isSpectator ? "👁️ Spectator Mode" : `⚡ You: Selecting (${this.selectedIds.length} chosen)`);
        myChip.classList.toggle("ready", myLocked);
      }
    }
    if (oppChip) {
      if (p.isAlternating && phase !== "COMPLETED") {
        oppChip.textContent = !p.isMyActionTurn
          ? `⚡ Enemy (${!p.amIDefender ? "DEF" : "ATK"}): Acting`
          : `✓ Enemy (${!p.amIDefender ? "DEF" : "ATK"}): Ready`;
        oppChip.classList.toggle("ready", p.isMyActionTurn);
      } else {
        oppChip.textContent = oppLocked ? "✓ Enemy: Locked In" : "⏳ Enemy: Thinking...";
        oppChip.classList.toggle("ready", oppLocked);
      }
    }

    const summaryRows = document.getElementById("pgCycleSummaryRows");
    if (summaryRows) {
      if (p.isAlternating) {
        const rows = [];
        for (let c = 1; c <= maxCycles; c++) {
          const isFinal = c === maxCycles;
          const tblDesc = isFinal
            ? `Locks Tables #${c} – #${totalTables}`
            : `Locks Table #${c} (Roles Swap)`;
          const cls = phase === "COMPLETED" || cycle > c ? "done" : (cycle === c ? "active" : "");
          rows.push(`<div class="pg-summary-row ${cls}"><span>Cycle ${c}${isFinal ? " (Final)" : ""}</span><strong>${tblDesc}</strong></div>`);
        }
        summaryRows.innerHTML = rows.join("");
      } else if (totalTables === 8) {
        summaryRows.innerHTML = [
          { c: 1, lbl: "Cycle 1", desc: "Locks Tables #1 – #2" },
          { c: 2, lbl: "Cycle 2", desc: "Locks Tables #3 – #4" },
          { c: 3, lbl: "Cycle 3 (Final)", desc: "Locks Tables #5 – #8" }
        ].map((row) => {
          const cls = phase === "COMPLETED" || cycle > row.c ? "done" : (cycle === row.c ? "active" : "");
          return `<div class="pg-summary-row ${cls}"><span>${row.lbl}</span><strong>${row.desc}</strong></div>`;
        }).join("");
      } else {
        summaryRows.innerHTML = [
          { c: 1, lbl: "Cycle 1", desc: "Locks Tables #1 – #2" },
          { c: 2, lbl: "Cycle 2 (Final)", desc: "Locks Tables #3 – #5" }
        ].map((row) => {
          const cls = phase === "COMPLETED" || cycle > row.c ? "done" : (cycle === row.c ? "active" : "");
          return `<div class="pg-summary-row ${cls}"><span>${row.lbl}</span><strong>${row.desc}</strong></div>`;
        }).join("");
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
        <div class="yc-art">
          ${matchupChipHtml}
          <span class="yc-emblem">${svgHtml}</span>
          <span class="yc-faction">${this.escapeHtml(player.faction)}</span>
        </div>
        <div class="yc-bottom">
          <span>ELO <strong>${player.elo || 2100}</strong></span>
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
      return;
    }
    if (demoState === "lobby_search") {
      this.openLobbyModal();
      const inp = document.getElementById("playerSearchInput");
      if (inp) inp.value = "Team Zero Comp";
      await this.performRealSearch("Team Zero Comp");
      return;
    }
    if (demoState === "share_modal") {
      this.openLobbyModal();
      this.openShareRoomModal(this.roomCode);
      return;
    }

    if (!(this.room.team_a?.roster?.length) || !(this.room.team_b?.roster?.length)) {
      await this.createNewRoom({ openLobby: false, emptyRosters: false });
    }
    this.closeLobbyModal();

    if (demoState === "coin_flip") {
      await this.flipCoinForRole("captain_a");
      this.openCoinFlipModal();
      return;
    }
    if (demoState === "attacker_view") {
      await this.chooseCoinFlipRole("attacker", "captain_a");
      this.selectedIds = ["A1"];
      this.renderAll();
      return;
    }
    if (demoState === "defender_view") {
      await this.chooseCoinFlipRole("defender", "captain_a");
      this.selectedIds = ["A1"];
      this.renderAll();
      return;
    }

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
