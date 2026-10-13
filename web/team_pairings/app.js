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

    // Card Summon Flight & On-Field Combat Animation State (Master Duel style — no popup modal)
    this.lastRenderedFieldCardIds = new Set();
    this.pendingCardFlightMap = new Map();
    this.pendingClashQueue = [];
    this.activeClashTableNum = null;
    this._combatTimers = [];

    // WTC Captain Pairing Clock State (5:00 per team captain)
    this.pairingClock = {
      running: false,
      activeSide: "a",
      secA: 300,
      secB: 300,
      timerId: null
    };

    // OmniTactica TCG Player Card Vault, Glory Pack Store & Deck Construction State
    this.tcgState = null;
    this.activeTcgTab = "deck";
    this.selectedDeckSlotIdx = 0;
    this.tcgPickerFilter = "all";
    this.tcgBinderFilter = "all";
    this.lastPackReveal = null;

    // Live Floor Judge Dispatch State (matches /11th/tracker/play)
    this.activeJudgeCall = null;
    this.selectedJudgeCategory = "Rules / Pairing Dispute";

    // Expose Game Tracker-compatible global helpers for the Share Room & Judge modals
    window.__openShareRoomModal = (mid) => this.openShareRoomModal(mid);
    window.__copyRoomShareLink = (mid, btn) => this.copyRoomShareLink(mid, btn);
    window.__toggleRoomLock = (mid, nextLocked, btn) => this.toggleRoomLock(nextLocked, btn);
    window.__sendRoomInviteToChat = (mid, opts, btn) => this.sendRoomInviteToChat(mid, opts, btn);
    window.gtOpenJudgeModal = () => this.openJudgeModal();
    window.gtCloseJudgeModal = () => this.closeJudgeModal();
    window.gtSelectCategory = (el, cat) => this.selectJudgeCategory(el, cat);
    window.gtSubmitJudgeCall = (tournId) => this.submitJudgeCall(tournId);
    window.gtCancelJudgeCall = () => this.cancelJudgeCall();

    this.bindEvents();
    this.bootstrap();
  }

  initGuestUserId() {
    try {
      const rawUser =
        localStorage.getItem("native_user_profile") ||
        localStorage.getItem("bcp_user_profile") ||
        localStorage.getItem("omnitactica_user") ||
        localStorage.getItem("currentUser");
      if (rawUser) {
        const parsed = JSON.parse(rawUser);
        if (parsed && (parsed.id || parsed.user_id)) return String(parsed.id || parsed.user_id);
      }
      let id = localStorage.getItem("gt_guest_id") || sessionStorage.getItem("gt_guest_id");
      if (!id || !String(id).startsWith("guest_")) {
        id = "guest_" + Math.random().toString(36).slice(2, 10) + "_" + Date.now().toString(36);
        localStorage.setItem("gt_guest_id", id);
      }
      return id;
    } catch (_) {
      return "guest_" + Math.random().toString(36).slice(2, 10);
    }
  }

  getGuestId() {
    try {
      let gid = localStorage.getItem("gt_guest_id") || sessionStorage.getItem("gt_guest_id");
      if (!gid || !String(gid).startsWith("guest_")) {
        gid = "guest_" + Math.random().toString(36).slice(2, 10) + "_" + Date.now().toString(36);
        localStorage.setItem("gt_guest_id", gid);
      }
      return gid;
    } catch (_) {
      return "guest_fallback";
    }
  }

  initUserName() {
    try {
      const rawUser =
        localStorage.getItem("native_user_profile") ||
        localStorage.getItem("bcp_user_profile") ||
        localStorage.getItem("omnitactica_user") ||
        localStorage.getItem("currentUser");
      if (rawUser) {
        const parsed = JSON.parse(rawUser);
        if (parsed && (parsed.display_name || parsed.name || parsed.username)) {
          return String(parsed.display_name || parsed.name || parsed.username).trim();
        }
      }
    } catch (_) {}
    return "";
  }

  getAuthToken() {
    try {
      return (
        localStorage.getItem("elo_auth_token") ||
        localStorage.getItem("native_session_token") ||
        sessionStorage.getItem("elo_auth_token") ||
        localStorage.getItem("omnitactica_token") ||
        localStorage.getItem("auth_token") ||
        ""
      );
    } catch (_) {
      return "";
    }
  }

  saveRoomTokenToStorage(roomCode, role, token) {
    if (!roomCode || !role || !token) return;
    try {
      localStorage.setItem(`tp_tok_${roomCode}_${role}`, token);
      sessionStorage.setItem(`tp_tok_${roomCode}_${role}`, token);
      if (role === "captain_a") {
        localStorage.setItem(`tp_cap_token_${roomCode}`, token);
      }
    } catch (_) {}
  }

  loadRoomTokenFromStorage(roomCode, role) {
    if (!roomCode || !role) return "";
    try {
      return (
        sessionStorage.getItem(`tp_tok_${roomCode}_${role}`) ||
        localStorage.getItem(`tp_tok_${roomCode}_${role}`) ||
        (role === "captain_a" ? localStorage.getItem(`tp_cap_token_${roomCode}`) : "") ||
        ""
      );
    } catch (_) {
      return "";
    }
  }

  saveTabRoleForRoom(roomCode, role) {
    if (!roomCode || !role) return;
    try {
      sessionStorage.setItem(`tp_tab_role_${String(roomCode).trim().toUpperCase()}`, role);
    } catch (_) {}
  }

  loadTabRoleForRoom(roomCode) {
    if (!roomCode) return "";
    try {
      return sessionStorage.getItem(`tp_tab_role_${String(roomCode).trim().toUpperCase()}`) || "";
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
        if (e.target.closest(".seat-unlock-btn") || e.target.closest(".info-tip-btn")) return;
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
      btnChooseDef.addEventListener("click", (e) => {
        if (e.target.closest(".info-tip-btn")) return;
        this.chooseCoinFlipRole("defender", this.activeRole);
      });
    }
    const btnChooseAtt = document.getElementById("btnChooseAttackerRole");
    if (btnChooseAtt) {
      btnChooseAtt.addEventListener("click", (e) => {
        if (e.target.closest(".info-tip-btn")) return;
        this.chooseCoinFlipRole("attacker", this.activeRole);
      });
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

    // Prediction Scoring Toggle (On-Field Combat & Score Sim vs Pure Tournament Pairing Mode)
    const chkPredScore = document.getElementById("chkPredictionScoring");
    if (chkPredScore) {
      chkPredScore.addEventListener("change", () => {
        this.togglePredictionScoringMode(chkPredScore.checked);
      });
    }

    // Clicking the On-Field Combat Stage during score reveal advances/dismisses immediately
    const onFieldStage = document.getElementById("onFieldCombatStage");
    if (onFieldStage) {
      onFieldStage.addEventListener("click", () => {
        if (onFieldStage.classList.contains("phase-score")) {
          this.advanceOrHideOnFieldCombat();
        }
      });
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

    // Unified Game Tracker Top HUD & Mobile Bottom Dock Controls
    const topRoomBadge = document.getElementById("topbarRoomCodeBadge");
    if (topRoomBadge) {
      topRoomBadge.addEventListener("click", () => this.copyRoomShareLink(this.roomCode));
    }

    const btnTopClock = document.getElementById("btnTopbarClock");
    if (btnTopClock) {
      btnTopClock.addEventListener("click", () => this.toggleClockPopover());
    }
    const btnCloseClock = document.getElementById("btnCloseClockPopover");
    if (btnCloseClock) {
      btnCloseClock.addEventListener("click", () => this.toggleClockPopover(false));
    }
    const btnClockRun = document.getElementById("btnClockToggleRun");
    if (btnClockRun) {
      btnClockRun.addEventListener("click", () => this.toggleClockRun());
    }
    const btnClockSwitch = document.getElementById("btnClockSwitchSide");
    if (btnClockSwitch) {
      btnClockSwitch.addEventListener("click", () => this.switchClockSide());
    }
    const btnClockReset = document.getElementById("btnClockReset");
    if (btnClockReset) {
      btnClockReset.addEventListener("click", () => this.resetClock());
    }
    document.querySelectorAll("#pairingClockPopover .pcp-clock-box").forEach((box) => {
      box.addEventListener("click", () => {
        const side = box.getAttribute("data-clock-side");
        if (side === "a" || side === "b") {
          this.pairingClock.activeSide = side;
          this.renderPairingClock();
        }
      });
    });

    const btnTopDice = document.getElementById("btnTopbarDice");
    if (btnTopDice) {
      btnTopDice.addEventListener("click", () => this.openQuickDiceModal());
    }

    const btnTopJudge = document.getElementById("btnTopbarJudge");
    if (btnTopJudge) {
      btnTopJudge.addEventListener("click", () => this.openJudgeModal());
    }

    const btnFinishRoom = document.getElementById("btnFinishPairingRoom");
    if (btnFinishRoom) {
      btnFinishRoom.addEventListener("click", () => this.finishPairingRoom());
    }

    const btnFeedback = document.getElementById("btnTopbarFeedback");
    if (btnFeedback) {
      btnFeedback.addEventListener("click", () => {
        this.showToast("💬 Thanks! Send feedback anytime in OmniTactica Hub or Discord.");
      });
    }

    // Mobile Bottom Dock buttons
    const btnDockRoster = document.getElementById("btnDockOpenRoster");
    if (btnDockRoster) {
      btnDockRoster.addEventListener("click", () => this.openLobbyModal());
    }
    const btnDockTcg = document.getElementById("btnDockOpenTcg");
    if (btnDockTcg) {
      btnDockTcg.addEventListener("click", () => this.openTcgVaultModal("deck"));
    }
    const btnDockCoin = document.getElementById("btnDockOpenCoin");
    if (btnDockCoin) {
      btnDockCoin.addEventListener("click", () => this.openCoinFlipModal());
    }
    const btnDockJudge = document.getElementById("btnDockJudge");
    if (btnDockJudge) {
      btnDockJudge.addEventListener("click", () => this.openJudgeModal());
    }
    const btnDockClock = document.getElementById("btnDockToggleClock");
    if (btnDockClock) {
      btnDockClock.addEventListener("click", () => this.toggleClockPopover());
    }
    const btnDockDice = document.getElementById("btnDockOpenDice");
    if (btnDockDice) {
      btnDockDice.addEventListener("click", () => this.openQuickDiceModal());
    }
    const btnDockShare = document.getElementById("btnDockOpenShare");
    if (btnDockShare) {
      btnDockShare.addEventListener("click", () => this.openShareRoomModal());
    }
    const btnDockFinish = document.getElementById("btnDockFinishRoom");
    if (btnDockFinish) {
      btnDockFinish.addEventListener("click", () => this.finishPairingRoom());
    }

    // OmniTactica TCG Player Card Vault, Glory Pack Store & Deck Construction Events
    const btnOpenTcgTop = document.getElementById("btnOpenTcgVaultModal");
    if (btnOpenTcgTop) {
      btnOpenTcgTop.addEventListener("click", () => this.openTcgVaultModal("deck"));
    }
    const btnLobbyOpenTcg = document.getElementById("btnLobbyOpenTcgVault");
    if (btnLobbyOpenTcg) {
      btnLobbyOpenTcg.addEventListener("click", () => this.openTcgVaultModal("packs"));
    }
    const btnCloseTcg = document.getElementById("btnCloseTcgVaultModal");
    if (btnCloseTcg) {
      btnCloseTcg.addEventListener("click", () => this.closeTcgVaultModal());
    }
    document.querySelectorAll("#tcgVaultTabsBar .tcg-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-tcg-tab") || "deck";
        this.switchTcgTab(tab);
      });
    });

    const btnClaimDaily = document.getElementById("btnClaimDailyGlory");
    if (btnClaimDaily) {
      btnClaimDaily.addEventListener("click", () => this.claimDailyGlory());
    }

    const tcgFmtSel = document.getElementById("tcgDeckFormatSelect");
    if (tcgFmtSel) {
      tcgFmtSel.addEventListener("change", () => {
        this.selectedDeckSlotIdx = 0;
        this.renderTcgDeckTab();
      });
    }

    const btnAutoBest = document.getElementById("btnTcgAutoBestDeck");
    if (btnAutoBest) {
      btnAutoBest.addEventListener("click", () => this.saveOrModifyTcgDeck("auto_best"));
    }
    const btnResetStarter = document.getElementById("btnTcgResetStarterDeck");
    if (btnResetStarter) {
      btnResetStarter.addEventListener("click", () => this.saveOrModifyTcgDeck("reset_starter"));
    }
    const btnSaveTcgDeck = document.getElementById("btnTcgSaveDeck");
    if (btnSaveTcgDeck) {
      btnSaveTcgDeck.addEventListener("click", () => this.saveOrModifyTcgDeck("custom"));
    }
    const btnDeployTcg = document.getElementById("btnTcgDeployDeckToRoom");
    if (btnDeployTcg) {
      btnDeployTcg.addEventListener("click", () => this.deployTcgDeckToRoom("saved_deck", { enterArena: true }));
    }

    const btnEquipSavedTcg = document.getElementById("btnEquipSavedTcgDeck");
    if (btnEquipSavedTcg) {
      btnEquipSavedTcg.addEventListener("click", () => this.deployTcgDeckToRoom("saved_deck", { enterArena: false }));
    }
    const btnEquipStarter = document.getElementById("btnEquipStarterDeck");
    if (btnEquipStarter) {
      btnEquipStarter.addEventListener("click", () => this.deployTcgDeckToRoom("starter", { enterArena: false }));
    }

    document.querySelectorAll("#tcgDeckPickerFilters .tcg-filter-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        this.tcgPickerFilter = chip.getAttribute("data-picker-filter") || "all";
        document.querySelectorAll("#tcgDeckPickerFilters .tcg-filter-chip").forEach((c) => {
          c.classList.toggle("active", c === chip);
        });
        this.renderTcgDeckTab();
      });
    });

    const pickerSearch = document.getElementById("tcgDeckPickerSearch");
    if (pickerSearch) {
      pickerSearch.addEventListener("input", () => this.renderTcgDeckTab());
    }

    document.querySelectorAll("#tcgBinderRarityFilters .tcg-filter-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        this.tcgBinderFilter = chip.getAttribute("data-binder-filter") || "all";
        document.querySelectorAll("#tcgBinderRarityFilters .tcg-filter-chip").forEach((c) => {
          c.classList.toggle("active", c === chip);
        });
        this.renderTcgBinderTab();
      });
    });

    const binderSearch = document.getElementById("tcgBinderSearchInput");
    if (binderSearch) {
      binderSearch.addEventListener("input", () => this.renderTcgBinderTab());
    }

    // Global "i" Info Tooltip / Popover (Tap on mobile or click/hover on desktop)
    const btnCloseInfo = document.getElementById("btnCloseGlobalInfoPopover");
    if (btnCloseInfo) {
      btnCloseInfo.addEventListener("click", (e) => {
        e.stopPropagation();
        this.hideInfoPopover();
      });
    }
    document.addEventListener("click", (e) => {
      const infoBtn = e.target.closest(".info-tip-btn");
      if (infoBtn) {
        e.preventDefault();
        e.stopPropagation();
        this.toggleInfoPopover(infoBtn);
        return;
      }
      if (!e.target.closest("#globalInfoPopover")) {
        this.hideInfoPopover();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.hideInfoPopover();
        this.closeCardMetaPopup();
      }
    });

    // Card Meta Stats Popup / Hover Panel controls
    const metaPanel = document.getElementById("pairingProcessPanel");
    if (metaPanel) {
      metaPanel.addEventListener("mouseenter", () => {
        if (this._hideMetaHoverTimer) {
          clearTimeout(this._hideMetaHoverTimer);
          this._hideMetaHoverTimer = null;
        }
      });
      metaPanel.addEventListener("mouseleave", () => {
        this.scheduleHideCardMetaHover();
      });
    }
    const btnCloseMetaPopup = document.getElementById("btnCloseCardMetaPopup");
    if (btnCloseMetaPopup) {
      btnCloseMetaPopup.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeCardMetaPopup();
      });
    }
    const metaBackdrop = document.getElementById("cardMetaPopupBackdrop");
    if (metaBackdrop) {
      metaBackdrop.addEventListener("click", () => {
        this.closeCardMetaPopup();
      });
    }
    const btnMobileStats = document.getElementById("btnOpenMobileCardStats");
    if (btnMobileStats) {
      btnMobileStats.addEventListener("click", (e) => {
        e.stopPropagation();
        this.openCardMetaPopup(this.inspectedPlayer);
      });
    }
  }

  toggleInfoPopover(btnEl) {
    if (!btnEl) return;
    const pop = document.getElementById("globalInfoPopover");
    if (!pop) return;
    if (!pop.classList.contains("hidden") && this._activeInfoBtn === btnEl) {
      this.hideInfoPopover();
      return;
    }
    this.showInfoPopover(btnEl);
  }

  showInfoPopover(btnEl) {
    const pop = document.getElementById("globalInfoPopover");
    const titleEl = document.getElementById("globalInfoPopoverTitle");
    const bodyEl = document.getElementById("globalInfoPopoverBody");
    if (!pop || !titleEl || !bodyEl || !btnEl) return;

    this._activeInfoBtn = btnEl;
    const title = btnEl.getAttribute("data-info-title") || "Info";
    const rawBody = btnEl.getAttribute("data-info-body") || "";
    titleEl.textContent = title;
    bodyEl.innerHTML = rawBody
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => `<div class="ipc-line">${this.escapeHtml(line.trim())}</div>`)
      .join("");

    pop.classList.remove("hidden");

    const rect = btnEl.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const vw = window.innerWidth || 390;
    const vh = window.innerHeight || 844;

    let top = rect.bottom + 8;
    if (top + popRect.height > vh - 12) {
      top = Math.max(12, rect.top - popRect.height - 8);
    }
    let left = rect.left + rect.width / 2 - popRect.width / 2;
    left = Math.max(10, Math.min(vw - popRect.width - 10, left));

    pop.style.top = `${Math.round(top)}px`;
    pop.style.left = `${Math.round(left)}px`;
  }

  hideInfoPopover() {
    const pop = document.getElementById("globalInfoPopover");
    if (pop) pop.classList.add("hidden");
    this._activeInfoBtn = null;
  }

  async bootstrap() {
    const params = new URLSearchParams(window.location.search);
    const urlRoom = (params.get("room") || "").trim().toUpperCase();
    const urlRole = (params.get("role") || "").trim().toLowerCase();
    const demoState = (params.get("demo_state") || "").trim().toLowerCase();
    const urlFmt = (params.get("format") || params.get("format_size") || "").trim().toLowerCase();
    const urlLandscape = (params.get("landscape") || "").trim();
    const urlTcg = (params.get("tcg") || "").trim().toLowerCase();

    if (urlLandscape === "1" || urlLandscape === "true") {
      document.body.classList.add("force-landscape-mobile");
      const btnToggleLandscape = document.getElementById("btnToggleLandscape");
      if (btnToggleLandscape) btnToggleLandscape.textContent = "📱 Portrait";
    }

    if (urlFmt === "8v8" || urlFmt === "5v5") {
      const selectFormat = document.getElementById("selectFormat");
      if (selectFormat) selectFormat.value = urlFmt;
      const tcgFmtSel = document.getElementById("tcgDeckFormatSelect");
      if (tcgFmtSel) tcgFmtSel.value = urlFmt;
    }

    if (urlRole === "captain_a" || urlRole === "captain_b" || urlRole === "spectator") {
      this.activeRole = urlRole;
    }

    // Pre-fetch TCG state so Glory wallet, Pity counter & Starter/Pro cards are ready
    this.fetchTcgState().catch(() => {});

    // Do NOT pre-populate teams or players unless demo_state specifically tests mid-duel field steps
    const needsFieldDemoPreset =
      demoState === "step2" ||
      demoState === "step3_spectator" ||
      demoState === "completed" ||
      demoState === "clash_modal" ||
      demoState === "on_field_combat" ||
      demoState === "8v8_field" ||
      demoState === "coin_flip" ||
      demoState === "attacker_view" ||
      demoState === "defender_view" ||
      demoState === "tcg_duel";

    if (urlRoom) {
      await this.joinExistingRoom(urlRoom, { openLobby: demoState === "lobby" });
    } else {
      await this.createNewRoom({
        openLobby: (!demoState && !urlTcg) || demoState === "lobby",
        emptyRosters: !needsFieldDemoPreset
      });
    }

    if (urlTcg) {
      const targetTab = (urlTcg === "packs" || urlTcg === "binder") ? urlTcg : "deck";
      await this.openTcgVaultModal(targetTab);
    }

    if (demoState) {
      await this.applyDemoState(demoState);
    }

    this.pollTimer = setInterval(() => this.pollRoomState(), 1000);
    window.addEventListener("focus", () => this.pollRoomState());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.pollRoomState();
      }
    });
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

  async onFormatChanged(newFormatValue, { ensureRosters = false } = {}) {
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
            payload: { format_size: fmt, ensure_rosters: ensureRosters }
          })
        });
        const data = await resp.json();
        if (data && (data.ok || data.success) && data.room) {
          this.room = data.room;
          this.syncLobbyDraftFromRoom();
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
          card_id: p.card_id || "",
          name: p.name,
          player_name: p.player_name ?? "",
          faction: p.faction,
          detachment: p.detachment || meta.detachment,
          elo: p.elo || 2100,
          is_starter: Boolean(p.is_starter),
          rarity: p.rarity || "",
          rarity_label: p.rarity_label || "",
          copies: p.copies || 1,
          foil_tier: p.foil_tier || ""
        };
      });
      const nameA = this.room.team_a.name || "";
      this.lobbyTeamNames.captain_a = (nameA === "Team A" && this.lobbyDraftTeam.captain_a.length === 0) ? "" : nameA;
    }
    if (this.room.team_b && Array.isArray(this.room.team_b.roster)) {
      this.lobbyDraftTeam.captain_b = this.room.team_b.roster.map((p) => {
        const meta = resolveFactionMeta(p.faction);
        return {
          card_id: p.card_id || "",
          name: p.name,
          player_name: p.player_name ?? "",
          faction: p.faction,
          detachment: p.detachment || meta.detachment,
          elo: p.elo || 2100,
          is_starter: Boolean(p.is_starter),
          rarity: p.rarity || "",
          rarity_label: p.rarity_label || "",
          copies: p.copies || 1,
          foil_tier: p.foil_tier || ""
        };
      });
      const nameB = this.room.team_b.name || "";
      this.lobbyTeamNames.captain_b = (nameB === "Team B" && this.lobbyDraftTeam.captain_b.length === 0) ? "" : nameB;
    }
    this.renderRoomModeStrip();
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
  async claimOrSwitchSeat(seat, { silentToast = false } = {}) {
    if (seat === "spectator") {
      this.activeRole = "spectator";
      this.selectedIds = [];
      if (this.roomCode) this.saveTabRoleForRoom(this.roomCode, "spectator");
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
        this.saveTabRoleForRoom(this.roomCode, seat);
        const tok = data.captain_token || (seat === "captain_a" ? data.room.captain_a_token : data.room.captain_b_token);
        if (tok) {
          this.captainTokens[seat] = tok;
          this.saveRoomTokenToStorage(this.roomCode, seat, tok);
        }
        this.syncLobbyDraftFromRoom();
        this.selectLobbySeatUI(seat);
        this.renderLobbySeatLockState();
        if (!silentToast) {
          this.showToast(`🔒 Seat locked as ${defaultCapLabel}!`);
        }
      } else {
        if (!silentToast) {
          this.showToast(data?.error || "That Captain seat is locked by another player.");
        }
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
      accessStatus.textContent = isRoomLocked ? "🔒 Locked Room" : "🟢 Open Room";
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

      const isMine = s.isLocked && (
        this.activeRole === s.role
          ? (s.ownerId === this.userId || s.hasToken)
          : (s.ownerId === this.userId && s.ownerId !== (this.activeRole === "captain_a" ? this.room.user_id_cap_a : this.room.user_id_cap_b))
      );
      const isTakenByOther = s.isLocked && !isMine;

      if (cardEl) {
        cardEl.classList.toggle("locked-other", isTakenByOther);
        cardEl.classList.toggle("locked-mine", isMine);
      }

      if (lockBadge) {
        lockBadge.classList.remove("mine", "taken");
        if (isMine) {
          lockBadge.classList.add("mine");
          lockBadge.textContent = "🔒 YOU";
        } else if (isTakenByOther) {
          lockBadge.classList.add("taken");
          lockBadge.textContent = "🔒 TAKEN";
        } else {
          lockBadge.textContent = "🟢 OPEN";
        }
      }

      if (ownerText) {
        if (isMine) {
          ownerText.textContent = "Seated: You";
        } else if (isTakenByOther) {
          ownerText.textContent = s.ownerName;
        } else {
          ownerText.textContent = isRoomLocked ? "Room Locked" : "Open";
        }
      }

      if (actionBadge) {
        if (isMine) {
          actionBadge.textContent = "✓ YOUR SEAT";
        } else if (isTakenByOther) {
          actionBadge.textContent = "🔒 TAKEN";
        } else {
          actionBadge.textContent = "CLAIM SEAT";
        }
      }

      if (unlockBtn) {
        unlockBtn.classList.toggle("hidden", !isMine);
      }

      if (topBtn) {
        const labelBase = s.role === "captain_a" ? "Team A" : "Team B";
        if (isMine) {
          topBtn.textContent = `👑 ${labelBase} (You)`;
        } else if (isTakenByOther) {
          topBtn.textContent = `🔒 ${labelBase}`;
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
      if (statusHint) statusHint.textContent = "👁️ Spectator Mode";
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

    const chosenFaction = playerObj.faction || "Space Marines";
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
      if (hand.length >= targetSize) {
        statusHint.textContent = `✓ ${targetSize} / ${targetSize} Ready`;
      } else {
        statusHint.textContent = `${hand.length} / ${targetSize} Cards`;
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
              ...p,
              id: `DRAFT_${i + 1}`
            })}
          </div>
        `);
      } else {
        slotsHtml.push(`
          <div class="lobby-empty-slot" data-slot-idx="${i}" title="Click to pick a card from your TCG Deck">
            <span class="slot-plus">＋</span>
            <span class="slot-num">#${i + 1}</span>
          </div>
        `);
      }
    }
    tray.innerHTML = slotsHtml.join("");

    tray.querySelectorAll(".lobby-empty-slot").forEach((slot) => {
      slot.addEventListener("click", () => {
        const idx = Number(slot.getAttribute("data-slot-idx") || 0);
        this.selectedDeckSlotIdx = idx;
        this.openTcgVaultModal("deck");
      });
    });

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
      await this.onFormatChanged(fmt, { ensureRosters: true });
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
    const rosterA = this.room?.team_a?.roster || [];
    const rosterB = this.room?.team_b?.roster || [];
    const avgA = rosterA.length ? Math.round(rosterA.reduce((s, p) => s + (Number(p.elo) || 1500), 0) / rosterA.length) : 0;
    const avgB = rosterB.length ? Math.round(rosterB.reduce((s, p) => s + (Number(p.elo) || 1500), 0) / rosterB.length) : 0;
    this.closeLobbyModal();
    this.renderAll();
    if (this.room?.vs_ai && avgA > 0 && avgB > 0) {
      this.showToast(`⚔️ Locked ${teamName} (Avg ${avgA} Elo) vs AI (Avg ${avgB} Elo)!`);
    } else {
      this.showToast(`Locked ${lockedCount} players for ${teamName} (${fmt.toUpperCase()})!`);
    }

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
    if (capA) capA.textContent = teamA.captain_name || "Captain A";
    if (boxA) boxA.classList.toggle("winner", winner === "captain_a");

    const tagB = document.getElementById("coinFlipTeamBTag");
    const nameB = document.getElementById("coinFlipTeamBName");
    const capB = document.getElementById("coinFlipTeamBCap");
    const boxB = document.getElementById("coinFlipTeamBBox");
    if (tagB) tagB.textContent = teamB.tag || "TMB";
    if (nameB) nameB.textContent = teamB.name || "Team B";
    if (capB) capB.textContent = teamB.captain_name || "Captain B";
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
      if (headline) headline.textContent = "FLIP FOR CYCLE 1 ROLE";
      if (sub) sub.classList.add("hidden");
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
      btnFlip.textContent = "🔄 RE-FLIP";
    }

    if (done && defRole) {
      const defTeamName = defRole === "captain_a" ? (teamA.name || "Team A") : (teamB.name || "Team B");
      const attTeamName = defRole === "captain_a" ? (teamB.name || "Team B") : (teamA.name || "Team A");
      if (headline) {
        headline.textContent = `🪙 ${winTeamName.toUpperCase()} WON`;
      }
      if (sub) {
        sub.classList.remove("hidden");
        sub.textContent = `🛡️ ${defTeamName} = DEFENDER • ⚔️ ${attTeamName} = ATTACKER`;
      }
    } else if (winner === "captain_b" && this.room.vs_ai && this.activeRole === "captain_a") {
      const aiPicked = (aiChoice || "defender").toUpperCase();
      const myStartRole = aiPicked === "DEFENDER" ? "ATTACKER" : "DEFENDER";
      if (headline) {
        headline.textContent = `🪙 ${winTeamName.toUpperCase()} WON`;
      }
      if (sub) sub.classList.add("hidden");
      if (aiBanner) aiBanner.classList.remove("hidden");
      if (aiText) {
        aiText.innerHTML = `🤖 <strong>${this.escapeHtml(winTeamName)}</strong> chose <strong>${aiPicked}</strong> (You start as <strong>${myStartRole}</strong>)`;
      }
    } else {
      if (headline) {
        headline.textContent = `🪙 ${winTeamName.toUpperCase()} WON — PICK ROLE`;
      }
      if (sub) sub.classList.add("hidden");
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

  async chooseCoinFlipRole(choice, chooserOverride = null, { silentToast = false } = {}) {
    if (!this.roomCode || this.activeRole === "spectator") return;
    const tok = this.captainTokens[this.activeRole] || this.loadRoomTokenFromStorage(this.roomCode, this.activeRole);
    const chooserRole = chooserOverride || this.room?.coin_flip_winner || this.activeRole;
    const isVsAiRoom = Boolean(this.room ? (this.room.vs_ai && !this.room.seat_b_locked) : false);
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
            vs_ai: isVsAiRoom
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
        if (!silentToast) {
          const p = this.getPerspective();
          const myRoleLabel = p?.amIDefender ? "🛡️ DEFENDER" : "⚔️ ATTACKER";
          this.showToast(`🪙 Cycle 1 Started! You are ${myRoleLabel} (roles swap every cycle).`);
        }
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
    const token = this.getAuthToken();
    const guestId = this.getGuestId();
    const headers = {
      "Content-Type": "application/json",
      "X-Guest-Id": guestId
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const resp = await fetch("/api/team-pairings/room", {
        method: "POST",
        headers,
        body: JSON.stringify({
          format_size: fmt,
          empty_rosters: emptyRosters,
          vs_ai: vsAi,
          owner_id: this.userId,
          user_id: this.userId,
          guest_id: guestId,
          user_name: this.userName || "Team A Captain",
          claim_role: "captain_a"
        })
      });
      const data = await resp.json();
      if (data && (data.ok || data.success) && data.room) {
        this.room = data.room;
        this.roomCode = data.room.room_code;
        this.activeRole = "captain_a";
        this.captainTokens.captain_a = data.captain_a_token || data.room.captain_a_token || "";
        this.captainTokens.captain_b = data.captain_b_token || data.room.captain_b_token || "";
        this.saveRoomTokenToStorage(this.roomCode, "captain_a", this.captainTokens.captain_a);
        this.saveTabRoleForRoom(this.roomCode, "captain_a");
        try {
          const url = new URL(window.location.href);
          if (!url.searchParams.get("demo_state")) {
            url.searchParams.set("room", this.roomCode);
            window.history.replaceState({}, "", url.toString());
          }
        } catch (_) {}
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
    const params = new URLSearchParams(window.location.search);
    const explicitUrlRole = (params.get("role") || "").trim().toLowerCase();
    const fromLobby = params.get("from_lobby") === "1";
    const tabSavedRole = this.loadTabRoleForRoom(cleanCode);
    if (!explicitUrlRole && (tabSavedRole === "captain_a" || tabSavedRole === "captain_b" || tabSavedRole === "spectator")) {
      this.activeRole = tabSavedRole;
    }

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

        // Determine if this visitor/tab is Player 2 joining an open Seat B
        const seatATakenByOtherUser =
          this.room.seat_a_locked &&
          this.room.user_id_cap_a !== this.userId &&
          !this.captainTokens.captain_a;
        const isSecondTabViaShareLink =
          !explicitUrlRole &&
          !tabSavedRole &&
          !fromLobby &&
          this.room.seat_a_locked &&
          !this.room.seat_b_locked;

        if (this.activeRole === "captain_a" && (seatATakenByOtherUser || isSecondTabViaShareLink)) {
          if (!this.room.seat_b_locked && !this.room.is_locked) {
            await this.claimOrSwitchSeat("captain_b", { silentToast: true });
            // If Team B still has an empty roster or AI roster before any tables are paired, load Player 2's Starter/TCG deck
            const bRoster = this.room?.team_b?.roster || [];
            if ((bRoster.length === 0 || this.room?.room_mode === "casual_tcg") && !(this.room?.pairings?.length)) {
              await this.equipTcgDeckToRoom("starter", { closeModals: false, silentToast: true });
            }
            this.showToast("🔒 Joined room as Team B Captain!");
          } else {
            this.activeRole = "spectator";
            this.saveTabRoleForRoom(this.roomCode, "spectator");
          }
        } else if (
          this.activeRole === "captain_b" &&
          this.room.seat_b_locked &&
          this.room.user_id_cap_b !== this.userId &&
          !this.captainTokens.captain_b
        ) {
          this.activeRole = "spectator";
          this.saveTabRoleForRoom(this.roomCode, "spectator");
        } else if (this.activeRole === "captain_b" && !this.room.seat_b_locked && !this.room.is_locked) {
          await this.claimOrSwitchSeat("captain_b", { silentToast: true });
        } else {
          this.saveTabRoleForRoom(this.roomCode, this.activeRole);
        }

        this.selectedIds = [];
        this.syncLobbyDraftFromRoom();
        this.renderLobbySeatLockState();

        const myRoster = this.activeRole === "captain_b"
          ? (this.room.team_b?.roster || [])
          : (this.room.team_a?.roster || []);
        const shouldOpenLobbyModal = Boolean(
          openLobby || (this.activeRole !== "spectator" && myRoster.length === 0)
        );
        if (shouldOpenLobbyModal) {
          this.openLobbyModal();
        } else {
          this.closeLobbyModal();
        }
        this.renderAll();
      } else {
        this.showToast(`Room ${cleanCode} not found`);
      }
    } catch (err) {
      console.error("Failed to join room:", err);
    }
  }

  getRoomStateSignature(r) {
    if (!r) return "";
    const defA = r.active_defender_a?.id || r.defender_a || "";
    const defB = r.active_defender_b?.id || r.defender_b || "";
    const attsA = (r.active_attackers_a || []).map((p) => p.id).join(",");
    const attsB = (r.active_attackers_b || []).map((p) => p.id).join(",");
    const pairs = (r.pairings || []).map((m) => `${m.table || m.table_num}:${m.sim_score_a ?? m.est_score_a}`).join(",");
    const rostA = (r.team_a?.roster || []).map((p) => `${p.id}:${p.faction}:${p.elo}:${p.status}`).join(",");
    const rostB = (r.team_b?.roster || []).map((p) => `${p.id}:${p.faction}:${p.elo}:${p.status}`).join(",");
    return [
      r.revision || 0,
      r.updatedAt || 0,
      r.phase || "",
      r.cycle || 1,
      r.defender_role || "",
      r.attacker_role || "",
      r.coin_flip_done ? 1 : 0,
      r.coin_flip_winner || "",
      r.coin_flip_choice || "",
      r.seat_a_locked ? 1 : 0,
      r.seat_b_locked ? 1 : 0,
      r.seat_a_owner_name || "",
      r.seat_b_owner_name || "",
      r.vs_ai ? 1 : 0,
      r.is_locked ? 1 : 0,
      r.locked_a ? 1 : 0,
      r.locked_b ? 1 : 0,
      r.secret_defender_a_locked ? 1 : 0,
      r.secret_defender_b_locked ? 1 : 0,
      r.secret_attackers_a_locked ? 1 : 0,
      r.secret_attackers_b_locked ? 1 : 0,
      r.secret_choice_a_locked ? 1 : 0,
      r.secret_choice_b_locked ? 1 : 0,
      defA,
      defB,
      attsA,
      attsB,
      pairs,
      r.team_a?.name || "",
      r.team_b?.name || "",
      rostA,
      rostB
    ].join("|");
  }

  async pollRoomState() {
    if (!this.roomCode || this._isPollingRoom) return;
    this._isPollingRoom = true;
    const savedTok = this.captainTokens[this.activeRole] || this.loadRoomTokenFromStorage(this.roomCode, this.activeRole);
    try {
      const resp = await fetch(
        `/api/team-pairings/room/${encodeURIComponent(this.roomCode)}?role=${encodeURIComponent(this.activeRole)}&captain_token=${encodeURIComponent(savedTok)}&_t=${Date.now()}`,
        { cache: "no-store" }
      );
      if (!resp.ok) return;
      const data = await resp.json();
      if (data && (data.ok || data.success) && data.room) {
        const oldSig = this.getRoomStateSignature(this.room);
        const newSig = this.getRoomStateSignature(data.room);
        const prevPairingsCount = (this.room?.pairings || []).length;
        const prevPhase = this.room?.phase;
        const prevCoinDone = Boolean(this.room?.coin_flip_done);

        this.room = data.room;
        if (oldSig !== newSig) {
          if (prevPhase && prevPhase !== this.room.phase) {
            this.selectedIds = [];
          }
          const lobbyModal = document.getElementById("lobbyModalBackdrop");
          if (!lobbyModal || lobbyModal.classList.contains("hidden")) {
            this.syncLobbyDraftFromRoom();
          }
          this.renderLobbySeatLockState();
          if (!prevCoinDone && this.room.coin_flip_done) {
            this.closeCoinFlipModal();
          } else {
            this.renderCoinFlipModal();
          }
          this.renderAll();

          const newPairings = this.room.pairings || [];
          if (newPairings.length > prevPairingsCount) {
            const newTables = [];
            for (let i = prevPairingsCount; i < newPairings.length; i++) {
              const tNum = Number(newPairings[i].table_num || newPairings[i].table || (i + 1));
              newTables.push(tNum);
            }
            if (newTables.length > 0) {
              this.playOnFieldCombatAnimation(newTables[0], newTables.slice(1));
            }
          }
        }
      }
    } catch (_) {
    } finally {
      this._isPollingRoom = false;
    }
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

  getMatchupPrediction(myPlayer, oppPlayer) {
    if (!myPlayer || !oppPlayer) {
      return {
        wtcScore: 10,
        oppWtcScore: 10,
        winProb: 50,
        oppWinProb: 50,
        effectiveEloDelta: 0,
        factors: {},
        tooltip: "Even Matchup (50% Win • 10-10 WTC)"
      };
    }

    const fmtSigned = (n) => {
      const r = Math.round(Number(n) || 0);
      return r > 0 ? `+${r}` : `${r}`;
    };

    if (this.room && this.room.matchup_predictions) {
      const mp = this.room.matchup_predictions;
      const isCard1TeamB =
        String(myPlayer.id || "").startsWith("B") ||
        myPlayer.team === "B" ||
        (!String(myPlayer.id || "").startsWith("A") && this.activeRole === "captain_b");
      const rawPred = isCard1TeamB
        ? mp[oppPlayer.id]?.[myPlayer.id]
        : mp[myPlayer.id]?.[oppPlayer.id];
      if (rawPred && typeof rawPred === "object") {
        const wtcScore = isCard1TeamB ? Number(rawPred.wtc_score_b ?? (20 - rawPred.wtc_score_a)) : Number(rawPred.wtc_score_a ?? 10);
        const winProb = isCard1TeamB ? Number(rawPred.win_prob_b ?? (100 - rawPred.win_prob_a)) : Number(rawPred.win_prob_a ?? 50);
        const sign = isCard1TeamB ? -1 : 1;
        const f = rawPred.factors || {};
        const d = rawPred.details || {};
        const effDelta = sign * Number(rawPred.effective_elo_delta || 0);
        const signedFactors = {
          base_elo_delta: sign * Number(f.base_elo_delta || 0),
          fac_h2h_delta: sign * Number(f.fac_h2h_delta || 0),
          fac_meta_delta: sign * Number(f.fac_meta_delta || 0),
          own_mastery_delta: sign * Number(f.own_mastery_delta || 0),
          vs_mastery_delta: sign * Number(f.vs_mastery_delta || 0),
          past_h2h_delta: sign * Number(f.past_h2h_delta || 0)
        };
        const facH2hWr = isCard1TeamB ? Number(d.fac_h2h_wr_b ?? 50) : Number(d.fac_h2h_wr_a ?? 50);
        const facH2hGames = Number(d.fac_h2h_games || 0);
        const tooltip = [
          `6-Factor Prediction: ${winProb}% Win • Est. ${wtcScore}-${20 - wtcScore} WTC (${fmtSigned(effDelta)} Eff. Elo)`,
          `• Base Elo: ${fmtSigned(signedFactors.base_elo_delta)}`,
          `• 3M Faction H2H: ${fmtSigned(signedFactors.fac_h2h_delta)} (${facH2hWr.toFixed(1)}%)`,
          `• 3M Faction Meta: ${fmtSigned(signedFactors.fac_meta_delta)}`,
          `• Own-Faction Mastery: ${fmtSigned(signedFactors.own_mastery_delta)}`,
          `• Vs-Faction Mastery: ${fmtSigned(signedFactors.vs_mastery_delta)}`,
          `• Past Player H2H: ${fmtSigned(signedFactors.past_h2h_delta)}`
        ].join("\n");
        return {
          wtcScore,
          oppWtcScore: 20 - wtcScore,
          winProb,
          oppWinProb: 100 - winProb,
          effectiveEloDelta: effDelta,
          factors: signedFactors,
          facH2hWr,
          facH2hGames,
          tooltip
        };
      }
    }

    if (this.room && this.room.matchup_matrix) {
      const m = this.room.matchup_matrix;
      if (this.activeRole === "captain_b") {
        const aScore = m[oppPlayer.id]?.[myPlayer.id];
        if (typeof aScore === "number") {
          const wtcScore = 20 - aScore;
          const winProb = Math.max(5, Math.min(95, Math.round(50 + ((wtcScore - 10) / 33.34) * 100)));
          return {
            wtcScore,
            oppWtcScore: aScore,
            winProb,
            oppWinProb: 100 - winProb,
            effectiveEloDelta: 0,
            factors: {},
            tooltip: `6-Factor Prediction: ${winProb}% Win • Est. ${wtcScore}-${aScore} WTC`
          };
        }
      } else {
        const score = m[myPlayer.id]?.[oppPlayer.id];
        if (typeof score === "number") {
          const winProb = Math.max(5, Math.min(95, Math.round(50 + ((score - 10) / 33.34) * 100)));
          return {
            wtcScore: score,
            oppWtcScore: 20 - score,
            winProb,
            oppWinProb: 100 - winProb,
            effectiveEloDelta: 0,
            factors: {},
            tooltip: `6-Factor Prediction: ${winProb}% Win • Est. ${score}-${20 - score} WTC`
          };
        }
      }
    }

    // Client-side 6-Factor fallback
    const baseEloDelta = Math.round(Number(myPlayer.elo || 2000) - Number(oppPlayer.elo || 2000));
    const wrA = Number(myPlayer.win_rate || 50) > 1 ? Number(myPlayer.win_rate || 50) / 100 : Number(myPlayer.win_rate || 0.5);
    const wrB = Number(oppPlayer.win_rate || 50) > 1 ? Number(oppPlayer.win_rate || 50) / 100 : Number(oppPlayer.win_rate || 0.5);
    const gA = Number(myPlayer.matches_played || 24);
    const gB = Number(oppPlayer.matches_played || 24);
    const ownShiftA = Math.max(-35, Math.min(35, Math.round((wrA - 0.5) * (gA / (gA + 10)) * 140)));
    const ownShiftB = Math.max(-35, Math.min(35, Math.round((wrB - 0.5) * (gB / (gB + 10)) * 140)));
    const ownMasteryDelta = Math.max(-55, Math.min(55, ownShiftA - ownShiftB));
    const effDelta = baseEloDelta + ownMasteryDelta;
    const winProb = Math.max(5, Math.min(95, Math.round(100 / (1 + Math.pow(10, -effDelta / 400)))));
    const wtcScore = Math.max(0, Math.min(20, Math.round(10 + 33.34 * (winProb / 100 - 0.5))));
    return {
      wtcScore,
      oppWtcScore: 20 - wtcScore,
      winProb,
      oppWinProb: 100 - winProb,
      effectiveEloDelta: effDelta,
      factors: { base_elo_delta: baseEloDelta, own_mastery_delta: ownMasteryDelta },
      tooltip: `6-Factor Prediction: ${winProb}% Win • Est. ${wtcScore}-${20 - wtcScore} WTC`
    };
  }

  getMatchupEstimate(myPlayer, oppPlayer) {
    return this.getMatchupPrediction(myPlayer, oppPlayer).wtcScore;
  }

  renderAll() {
    if (!this.room) return;
    const p = this.getPerspective();
    if (!p) return;

    const isRoomLocked = Boolean(this.room.is_locked);
    const topRoomBadge = document.getElementById("topbarRoomCodeBadge");
    if (topRoomBadge) {
      topRoomBadge.textContent = `#${this.roomCode || this.room.room_code || "WTC"} ${isRoomLocked ? "🔒" : "🔓"}`;
    }

    // Update Center Matchup in #gt-sync-hud to match /11th/tracker/play
    const hudDot = document.getElementById("hudStatusDot");
    const hudTeamA = document.getElementById("hudTeamALabel");
    const hudTeamB = document.getElementById("hudTeamBLabel");
    const rawTeamA = this.room.team_a?.name || "Team A";
    const rawTeamB = this.room.team_b?.name || "Team B";
    const isBReady = Boolean(this.room.vs_ai || this.room.seat_b_locked || this.room.captain_b_claimed || (this.room.team_b?.roster?.length > 0));
    if (hudDot) {
      hudDot.style.background = isBReady ? "#10b981" : "#f59e0b";
    }
    if (hudTeamA) {
      hudTeamA.textContent = this.activeRole === "captain_a" ? `${rawTeamA} (You)` : rawTeamA;
    }
    if (hudTeamB) {
      if (!isBReady && this.activeRole !== "captain_b") {
        hudTeamB.textContent = "Waiting for Cap B...";
        hudTeamB.style.color = "#94a3b8";
        hudTeamB.style.fontStyle = "italic";
      } else {
        hudTeamB.textContent = this.activeRole === "captain_b" ? `${rawTeamB} (You)` : rawTeamB;
        hudTeamB.style.color = "#10b981";
        hudTeamB.style.fontStyle = "normal";
      }
    }

    const isDone = Boolean(
      this.room.is_finished ||
      this.room.status === "completed" ||
      this.room.phase === "COMPLETED"
    );
    const btnFinish = document.getElementById("btnFinishPairingRoom");
    if (btnFinish) {
      btnFinish.classList.toggle("completed-state", Boolean(this.room.is_finished || this.room.status === "completed"));
      if (this.room.is_finished || this.room.status === "completed") {
        btnFinish.textContent = "✅ Saved";
      } else if (isDone) {
        btnFinish.textContent = "🏁 Save & Exit";
      } else {
        btnFinish.textContent = "🏁 Finish";
      }
    }

    const specBanner = document.getElementById("spectatorBanner");
    if (specBanner) {
      specBanner.classList.toggle("hidden", !p.isSpectator);
    }

    const coinBtn = document.getElementById("btnOpenCoinFlipModal");
    if (coinBtn) {
      if (p.isAlternating && this.room.phase !== "COMPLETED") {
        coinBtn.textContent = p.amIDefender ? "🎲 Role: 🛡️ DEF" : "🎲 Role: ⚔️ ATK";
      } else {
        coinBtn.textContent = "🎲 Coin Flip";
      }
    }

    this.renderLobbySeatLockState();
    this.renderPairingClock();
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
        cycleBadge.textContent = "COMPLETE";
      } else if (p.isAlternating) {
        cycleBadge.textContent = `C${this.room.cycle}/${this.room.max_cycles} • ${p.amIDefender ? "🛡️ DEF" : "⚔️ ATK"}`;
      } else {
        cycleBadge.textContent = `C${this.room.cycle}/${this.room.max_cycles}`;
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
      if (promptEl) promptEl.textContent = "👁️ Spectating Live Match";
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
          promptEl.textContent = "⏳ Waiting for enemy Defender...";
        } else if (phase === "STEP_2_ATTACKERS") {
          promptEl.textContent = "⏳ Waiting for 2 enemy Attackers...";
        } else {
          promptEl.textContent = "⏳ Enemy picking 1 Attacker...";
        }
      }
      if (btnLock) {
        btnLock.disabled = true;
        btnLock.textContent = "⏳ ENEMY TURN";
      }
      return;
    }

    if (phase === "STEP_1_DEFENDER") {
      const ready = this.selectedIds.length === 1;
      if (hintBadge) hintBadge.textContent = `${this.selectedIds.length}/1`;
      if (p.mySecDefLocked) {
        if (promptEl) promptEl.textContent = "✓ Defender set — waiting for opponent";
        if (btnLock) {
          btnLock.disabled = true;
          btnLock.textContent = "✓ LOCKED";
        }
      } else {
        if (promptEl) {
          promptEl.textContent = ready
            ? "🛡️ Defender ready — Lock In!"
            : "🛡️ Select 1 Defender from hand";
        }
        if (btnLock) {
          btnLock.disabled = !ready;
          btnLock.textContent = "🔒 LOCK IN";
        }
      }
    } else if (phase === "STEP_2_ATTACKERS") {
      const ready = this.selectedIds.length === 2;
      if (hintBadge) hintBadge.textContent = `${this.selectedIds.length}/2`;
      if (p.mySecAttsLocked) {
        if (promptEl) promptEl.textContent = "✓ 2 Attackers set — waiting for opponent";
        if (btnLock) {
          btnLock.disabled = true;
          btnLock.textContent = "✓ LOCKED";
        }
      } else {
        if (promptEl) {
          promptEl.textContent = ready
            ? "⚔️ 2 Attackers ready — Lock In!"
            : `⚔️ Select 2 Attackers vs ${p.oppDef?.name || "Defender"}`;
        }
        if (btnLock) {
          btnLock.disabled = !ready;
          btnLock.textContent = "🔒 LOCK IN";
        }
      }
    } else if (phase === "STEP_3_CHOOSE") {
      const ready = this.selectedIds.length === 1;
      if (hintBadge) hintBadge.textContent = `${this.selectedIds.length}/1`;
      if (p.mySecChoiceLocked) {
        if (promptEl) promptEl.textContent = "✓ Clash locked — waiting for opponent";
        if (btnLock) {
          btnLock.disabled = true;
          btnLock.textContent = "✓ LOCKED";
        }
      } else {
        if (promptEl) {
          promptEl.textContent = ready
            ? "🎯 Attacker targeted — Lock In!"
            : "🎯 Pick 1 Enemy Attacker to fight";
        }
        if (btnLock) {
          btnLock.disabled = !ready;
          btnLock.textContent = "🔒 LOCK IN";
        }
      }
    } else {
      if (hintBadge) hintBadge.textContent = "DONE";
      if (promptEl) promptEl.textContent = "🏆 All Pairings Complete!";
      if (btnLock) {
        btnLock.disabled = true;
        btnLock.textContent = "🏆 DONE";
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

    const nextFieldIds = new Set();

    // 1. OPPONENT DEFENDER MOUNT
    const oppDefMount = document.getElementById("oppDefenderMount");
    if (oppDefMount) {
      if (p.oppDef) {
        const isNewSummon = !this.lastRenderedFieldCardIds.has(`oppDef_${p.oppDef.id}`);
        nextFieldIds.add(`oppDef_${p.oppDef.id}`);
        oppDefMount.innerHTML = this.buildYuGiOhCardHtml(p.oppDef, { fieldSize: true, summonSlam: isNewSummon });
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
          const vsMyDefPred = p.myDef ? this.getMatchupPrediction(p.myDef, att) : null;
          const isNewSummon = !this.lastRenderedFieldCardIds.has(`oppAtt_${att.id}`);
          nextFieldIds.add(`oppAtt_${att.id}`);
          return this.buildYuGiOhCardHtml(att, {
            fieldSize: true,
            selected: isChosen,
            clashChoice: canPick,
            summonSlam: isNewSummon,
            matchupScore: vsMyDefPred ? vsMyDefPred.wtcScore : null,
            matchupPred: vsMyDefPred
          });
        }).join("");

        oppAttMount.querySelectorAll(".ygo-card").forEach((cardEl, idx) => {
          const attObj = p.oppAtts[idx];
          cardEl.addEventListener("pointerenter", (e) => {
            if (e.pointerType === "mouse") {
              this.showCardMetaHover(attObj, p.myDef);
            }
          });
          cardEl.addEventListener("pointerleave", (e) => {
            if (e.pointerType === "mouse") {
              this.scheduleHideCardMetaHover();
            }
          });
          cardEl.addEventListener("click", () => {
            this.inspectCard(attObj, p.myDef);
            if (phase === "STEP_3_CHOOSE" && !p.isSpectator && !p.mySecChoiceLocked && p.isMyActionTurn) {
              this.selectedIds = [attObj.id];
              this.renderAll();
            } else if (window.innerWidth <= 900) {
              this.openCardMetaPopup(attObj, p.myDef);
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
        const isNewSummon = !this.lastRenderedFieldCardIds.has(`myDef_${cardToShow.id}`);
        nextFieldIds.add(`myDef_${cardToShow.id}`);
        myDefMount.innerHTML = this.buildYuGiOhCardHtml(cardToShow, {
          fieldSize: true,
          selected: !p.myDef,
          summonSlam: isNewSummon
        });
        const cardEl = myDefMount.querySelector(".ygo-card");
        if (cardEl) {
          cardEl.addEventListener("pointerenter", (e) => {
            if (e.pointerType === "mouse") {
              this.showCardMetaHover(cardToShow, p.oppDef);
            }
          });
          cardEl.addEventListener("pointerleave", (e) => {
            if (e.pointerType === "mouse") {
              this.scheduleHideCardMetaHover();
            }
          });
          cardEl.addEventListener("click", () => {
            this.inspectCard(cardToShow, p.oppDef);
            if (phase === "STEP_1_DEFENDER" && !p.mySecDefLocked && p.isMyActionTurn) {
              this.toggleHandCardSelection(cardToShow.id);
            } else if (window.innerWidth <= 900) {
              this.openCardMetaPopup(cardToShow, p.oppDef);
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
            const mPred = p.oppDef ? this.getMatchupPrediction(c, p.oppDef) : null;
            const isNewSummon = !this.lastRenderedFieldCardIds.has(`myAtt_${c.id}`);
            nextFieldIds.add(`myAtt_${c.id}`);
            slots.push(this.buildYuGiOhCardHtml(c, {
              fieldSize: true,
              selected: !(p.myAtts && p.myAtts.length > 0),
              summonSlam: isNewSummon,
              matchupScore: mPred ? mPred.wtcScore : null,
              matchupPred: mPred
            }));
          } else {
            slots.push(`<div class="empty-zone-sigil"><span class="sigil-icon">⚔️</span><span>PICK 2ND CARD</span></div>`);
          }
        }
        myAttMount.innerHTML = slots.join("");
        myAttMount.querySelectorAll(".ygo-card").forEach((el, idx) => {
          const cObj = cardsToShow[idx];
          if (cObj) {
            el.addEventListener("pointerenter", (e) => {
              if (e.pointerType === "mouse") {
                this.showCardMetaHover(cObj, p.oppDef);
              }
            });
            el.addEventListener("pointerleave", (e) => {
              if (e.pointerType === "mouse") {
                this.scheduleHideCardMetaHover();
              }
            });
            el.addEventListener("click", () => {
              if (phase === "STEP_2_ATTACKERS" && !p.mySecAttsLocked && p.isMyActionTurn) {
                this.toggleHandCardSelection(cObj.id);
              } else if (window.innerWidth <= 900) {
                this.openCardMetaPopup(cObj, p.oppDef);
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

    this.lastRenderedFieldCardIds = nextFieldIds;
    this.applyPendingFlightAnimations();
  }

  applyPendingFlightAnimations() {
    if (!this.pendingCardFlightMap || this.pendingCardFlightMap.size === 0) return;
    const matEl = document.getElementById("duelPodA");
    if (!matEl) {
      this.pendingCardFlightMap.clear();
      return;
    }
    this.pendingCardFlightMap.forEach((fromRect, cardId) => {
      const targetEl = matEl.querySelector(`.ygo-card[data-card-id="${CSS.escape(String(cardId))}"]`);
      if (targetEl && fromRect) {
        const toRect = targetEl.getBoundingClientRect();
        if (toRect.width > 0 && toRect.height > 0) {
          const dx = Math.round((fromRect.left + fromRect.width / 2) - (toRect.left + toRect.width / 2));
          const dy = Math.round((fromRect.top + fromRect.height / 2) - (toRect.top + toRect.height / 2));
          targetEl.classList.remove("card-summon-slam");
          targetEl.style.setProperty("--fly-dx", `${dx}px`);
          targetEl.style.setProperty("--fly-dy", `${dy}px`);
          targetEl.classList.add("card-fly-from-hand");
        }
      }
    });
    this.pendingCardFlightMap.clear();
  }

  renderHands(p) {
    const phase = this.room.phase;
    const oppBench = (p.oppTeam.roster || []).filter((c) => c.status === "bench");
    const rawMyBench = (p.myTeam.roster || []).filter((c) => c.status === "bench");
    const stagedOnMatIds = new Set(
      (phase === "STEP_1_DEFENDER" || phase === "STEP_2_ATTACKERS") ? this.selectedIds : []
    );
    const myBench = rawMyBench.filter((c) => !stagedOnMatIds.has(c.id));
    const is8v8 = (
      this.room?.team_size === 8 ||
      this.room?.total_tables === 8 ||
      (p.myTeam.roster || []).length > 5 ||
      (p.oppTeam.roster || []).length > 5
    );

    if (this.inspectedMyCard && !(p.myTeam.roster || []).some((c) => c.id === this.inspectedMyCard.id)) {
      this.inspectedMyCard = null;
    }
    if (this.inspectedOppCard && !oppBench.some((c) => c.id === this.inspectedOppCard.id)) {
      this.inspectedOppCard = null;
    }

    const stagedMyCard = this.selectedIds.length > 0
      ? (p.myTeam.roster || []).find((c) => c.id === this.selectedIds[0])
      : null;
    const myRefCard = stagedMyCard || p.myDef || this.inspectedMyCard || myBench[0] || null;
    const oppRefCard = (phase === "STEP_2_ATTACKERS" && p.oppDef)
      ? p.oppDef
      : (this.inspectedOppCard || p.oppDef || null);

    // 1. OPPONENT OPEN ROSTER HAND (TOP)
    const oppTitle = document.getElementById("oppHandOwnerTitle");
    if (oppTitle) {
      const oppTeamLabel = (p.oppTeam.name || "OPPONENT").toUpperCase();
      const vsHint = myRefCard ? ` • VS ${myRefCard.name.toUpperCase()}` : "";
      oppTitle.textContent = `OPPONENT — ${oppTeamLabel} (${oppBench.length}${vsHint})`;
    }

    const oppFan = document.getElementById("oppHandFan");
    if (oppFan) {
      oppFan.classList.toggle("format-8v8", is8v8);
      if ((p.oppTeam.roster || []).length === 0) {
        oppFan.innerHTML = "";
      } else if (oppBench.length === 0) {
        oppFan.innerHTML = `<div style="color:var(--text-dim);font-family:var(--font-mono);font-size:0.7rem;align-self:center;">ALL OPPONENT CARDS ON FIELD / PAIRED</div>`;
      } else {
        oppFan.innerHTML = oppBench.map((oppCard) => {
          const mPred = myRefCard ? this.getMatchupPrediction(myRefCard, oppCard) : null;
          const isTarget = this.inspectedOppCard && this.inspectedOppCard.id === oppCard.id;
          return this.buildYuGiOhCardHtml(oppCard, {
            oppHand: true,
            inspectedTarget: isTarget,
            matchupScore: mPred ? mPred.wtcScore : null,
            matchupPred: mPred
          });
        }).join("");

        oppFan.querySelectorAll(".ygo-card").forEach((cardEl, idx) => {
          const oppCardObj = oppBench[idx];
          cardEl.addEventListener("pointerenter", (e) => {
            if (e.pointerType === "mouse") {
              this.showCardMetaHover(oppCardObj, myRefCard);
              this.updateHandMatchupBadgesInPlace(p, null, oppCardObj);
            }
          });
          cardEl.addEventListener("pointerleave", (e) => {
            if (e.pointerType === "mouse") {
              this.scheduleHideCardMetaHover();
            }
          });
          cardEl.addEventListener("click", () => {
            if (this.inspectedOppCard && this.inspectedOppCard.id === oppCardObj.id) {
              this.inspectedOppCard = null;
            } else {
              this.inspectedOppCard = oppCardObj;
            }
            this.inspectCard(oppCardObj, myRefCard);
            this.renderHands(p);
            if (window.innerWidth <= 900) {
              this.openCardMetaPopup(oppCardObj, myRefCard);
            }
          });
        });
      }
    }

    // 2. YOUR OPEN ROSTER HAND (BOTTOM)
    const handTitle = document.getElementById("myHandOwnerTitle");
    if (handTitle) {
      const teamLabel = (p.myTeam.name || "YOUR TEAM").toUpperCase();
      const vsOppHint = oppRefCard ? ` • VS ${oppRefCard.name.toUpperCase()}` : "";
      handTitle.textContent = p.isSpectator
        ? `${teamLabel} (${myBench.length}${vsOppHint})`
        : `YOUR HAND — ${teamLabel} (${myBench.length}${vsOppHint})`;
    }

    const myFan = document.getElementById("myHandFan");
    if (!myFan) return;
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
      const mPred = oppRefCard
        ? this.getMatchupPrediction(card, oppRefCard)
        : null;
      return this.buildYuGiOhCardHtml(card, {
        selected: false,
        matchupScore: mPred ? mPred.wtcScore : null,
        matchupPred: mPred
      });
    }).join("");

    myFan.querySelectorAll(".ygo-card").forEach((cardEl, idx) => {
      const cardObj = myBench[idx];
      cardEl.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "mouse") {
          this.inspectedMyCard = cardObj;
          this.showCardMetaHover(cardObj, oppRefCard);
          this.updateHandMatchupBadgesInPlace(p, cardObj, null);
        }
      });
      cardEl.addEventListener("pointerleave", (e) => {
        if (e.pointerType === "mouse") {
          this.scheduleHideCardMetaHover();
        }
      });
      cardEl.addEventListener("click", () => {
        this.inspectedMyCard = cardObj;
        this.inspectCard(cardObj, oppRefCard);
        if (!p.isSpectator) {
          this.toggleHandCardSelection(cardObj.id, cardEl);
        } else {
          this.renderHands(p);
          if (window.innerWidth <= 900) {
            this.openCardMetaPopup(cardObj, oppRefCard);
          }
        }
      });
    });
  }

  updateHandMatchupBadgesInPlace(p, hoveredMyCard = null, hoveredOppCard = null) {
    const oppBench = (p.oppTeam.roster || []).filter((c) => c.status === "bench");
    const rawMyBench = (p.myTeam.roster || []).filter((c) => c.status === "bench");
    const phase = this.room?.phase;
    const stagedOnMatIds = new Set(
      (phase === "STEP_1_DEFENDER" || phase === "STEP_2_ATTACKERS") ? this.selectedIds : []
    );
    const myBench = rawMyBench.filter((c) => !stagedOnMatIds.has(c.id));

    if (hoveredMyCard) {
      const oppTitle = document.getElementById("oppHandOwnerTitle");
      if (oppTitle) {
        const oppTeamLabel = (p.oppTeam.name || "OPPONENT").toUpperCase();
        oppTitle.textContent = `OPPONENT — ${oppTeamLabel} (${oppBench.length} • VS ${hoveredMyCard.name.toUpperCase()})`;
      }
      const oppFan = document.getElementById("oppHandFan");
      if (oppFan) {
        oppFan.querySelectorAll(".ygo-card").forEach((cardEl, idx) => {
          const oppCard = oppBench[idx];
          if (!oppCard) return;
          const mPred = this.getMatchupPrediction(hoveredMyCard, oppCard);
          this.applyMatchupChipToCardElement(cardEl, mPred);
        });
      }
    }

    if (hoveredOppCard) {
      const handTitle = document.getElementById("myHandOwnerTitle");
      if (handTitle) {
        const teamLabel = (p.myTeam.name || "YOUR TEAM").toUpperCase();
        handTitle.textContent = p.isSpectator
          ? `${teamLabel} (${myBench.length} • VS ${hoveredOppCard.name.toUpperCase()})`
          : `YOUR HAND — ${teamLabel} (${myBench.length} • VS ${hoveredOppCard.name.toUpperCase()})`;
      }
      const myFan = document.getElementById("myHandFan");
      if (myFan) {
        myFan.querySelectorAll(".ygo-card").forEach((cardEl, idx) => {
          const myCard = myBench[idx];
          if (!myCard) return;
          const mPred = this.getMatchupPrediction(myCard, hoveredOppCard);
          this.applyMatchupChipToCardElement(cardEl, mPred);
        });
      }
    }
  }

  applyMatchupChipToCardElement(cardEl, mPred) {
    if (!cardEl || !mPred) return;
    const artEl = cardEl.querySelector(".yc-art");
    if (!artEl) return;
    const s = mPred.wtcScore;
    const color = s >= 12 ? "#4ade80" : (s <= 8 ? "#fb7185" : "#fde047");
    const winPct = mPred.winProb ?? Math.max(5, Math.min(95, Math.round(50 + ((s - 10) / 14) * 100)));
    const tip = mPred.tooltip || `6-Factor Prediction: ${winPct}% Win • Est. ${s}-${20 - s} WTC`;
    let chip = artEl.querySelector(".yc-matchup-chip");
    if (!chip) {
      chip = document.createElement("span");
      chip.className = "yc-matchup-chip";
      artEl.prepend(chip);
    }
    chip.style.color = color;
    chip.title = tip;
    chip.textContent = `${s}-${20 - s} • ${winPct}%`;
  }

  toggleHandCardSelection(cardId, sourceCardEl = null) {
    if (!this.room) return;
    const phase = this.room.phase;
    const p = this.getPerspective();
    if (!p || p.isSpectator) return;

    if (p.isAlternating && !p.isMyActionTurn) {
      this.showToast("Wait for the opposing Captain to complete their step first.");
      return;
    }

    const recordHandRect = () => {
      const el = sourceCardEl || document.querySelector(`#myHandFan .ygo-card[data-card-id="${CSS.escape(String(cardId))}"]`);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect && rect.width > 0) {
          this.pendingCardFlightMap.set(cardId, rect);
        }
      }
    };

    if (phase === "STEP_1_DEFENDER" && !p.mySecDefLocked) {
      if (this.selectedIds.includes(cardId)) {
        this.selectedIds = [];
      } else {
        recordHandRect();
        this.selectedIds = [cardId];
      }
      this.renderAll();
    } else if (phase === "STEP_2_ATTACKERS" && !p.mySecAttsLocked) {
      if (this.selectedIds.includes(cardId)) {
        this.selectedIds = this.selectedIds.filter((id) => id !== cardId);
      } else if (this.selectedIds.length < 2) {
        recordHandRect();
        this.selectedIds.push(cardId);
      } else {
        recordHandRect();
        this.selectedIds = [this.selectedIds[1], cardId];
      }
      this.renderAll();
    }
  }

  async submitStagedSelection() {
    if (!this.room || !this.roomCode) return;
    let phase = this.room.phase;
    const p = this.getPerspective();
    if (!p || p.isSpectator) return;

    // If neither Captain completed the Coin Flip modal before locking Cycle 1 Defender, auto-assign this Captain as Cycle 1 Defender
    if (phase === "STEP_1_DEFENDER" && !this.room.coin_flip_done && !this.room.defender_role) {
      await this.chooseCoinFlipRole("defender", this.activeRole, { silentToast: true });
      phase = this.room.phase;
    }

    const prevPairingsCount = (this.room.pairings || []).length;
    const isVsAiRoom = Boolean(this.room.vs_ai && !this.room.seat_b_locked);
    const tok = this.captainTokens[this.activeRole] || this.loadRoomTokenFromStorage(this.roomCode, this.activeRole);

    let action = "";
    let payload = { vs_ai: isVsAiRoom };

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

        const newPairings = this.room.pairings || [];
        if (newPairings.length > prevPairingsCount) {
          const newTables = [];
          for (let i = prevPairingsCount; i < newPairings.length; i++) {
            const tNum = Number(newPairings[i].table_num || newPairings[i].table || (i + 1));
            newTables.push(tNum);
          }
          if (newTables.length > 0) {
            this.playOnFieldCombatAnimation(newTables[0], newTables.slice(1));
          }
        }
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

  inspectCard(player, targetOpp = null) {
    if (!player) return;
    this.inspectedPlayer = player;
    if (targetOpp) {
      this.inspectedTargetCard = targetOpp;
    }
    const p = this.getPerspective();
    if (p) {
      this.renderPairingProcessGuide(p);
    }
  }

  showCardMetaHover(player, targetOpp = null) {
    if (this._hideMetaHoverTimer) {
      clearTimeout(this._hideMetaHoverTimer);
      this._hideMetaHoverTimer = null;
    }
    this.inspectCard(player, targetOpp);
    const panel = document.getElementById("pairingProcessPanel");
    if (panel) {
      panel.classList.add("meta-panel-visible");
    }
  }

  scheduleHideCardMetaHover() {
    if (this._hideMetaHoverTimer) {
      clearTimeout(this._hideMetaHoverTimer);
    }
    this._hideMetaHoverTimer = setTimeout(() => {
      this._hideMetaHoverTimer = null;
      const panel = document.getElementById("pairingProcessPanel");
      if (panel && !panel.classList.contains("meta-popup-open")) {
        panel.classList.remove("meta-panel-visible");
      }
    }, 90);
  }

  openCardMetaPopup(player = null, targetOpp = null) {
    if (player) {
      this.inspectCard(player, targetOpp);
    } else if (this.room) {
      const p = this.getPerspective();
      if (p) this.renderPairingProcessGuide(p);
    }
    const panel = document.getElementById("pairingProcessPanel");
    const backdrop = document.getElementById("cardMetaPopupBackdrop");
    if (panel) {
      panel.classList.add("meta-popup-open", "meta-panel-visible");
    }
    if (backdrop) {
      backdrop.classList.remove("hidden");
    }
  }

  closeCardMetaPopup() {
    const panel = document.getElementById("pairingProcessPanel");
    const backdrop = document.getElementById("cardMetaPopupBackdrop");
    if (panel) {
      panel.classList.remove("meta-popup-open", "meta-panel-visible");
    }
    if (backdrop) {
      backdrop.classList.add("hidden");
    }
  }

  renderPairingProcessGuide(p) {
    if (!this.room || !p) return;
    const myRoster = p.myTeam?.roster || [];
    const oppRoster = p.oppTeam?.roster || [];
    const allCards = [...myRoster, ...oppRoster];

    // Ensure inspectedPlayer still exists in the room rosters, or pick a sensible active card
    if (this.inspectedPlayer) {
      const refreshed = allCards.find((c) => c.id === this.inspectedPlayer.id);
      this.inspectedPlayer = refreshed || null;
    }
    if (!this.inspectedPlayer) {
      const stagedCard = this.selectedIds.length > 0
        ? myRoster.find((c) => c.id === this.selectedIds[0])
        : null;
      this.inspectedPlayer = stagedCard || p.myDef || p.oppDef || myRoster[0] || oppRoster[0] || null;
    }

    const card = this.inspectedPlayer;
    const ownerBadge = document.getElementById("metaInspectorOwnerBadge");
    const heroBox = document.getElementById("metaInspectorCardHero");
    const emblemEl = document.getElementById("metaInspectorEmblem");
    const nameEl = document.getElementById("metaInspectorName");
    const subEl = document.getElementById("metaInspectorSub");
    const eloBadge = document.getElementById("metaInspectorEloBadge");
    const rarityBadge = document.getElementById("metaInspectorRarityBadge");
    const tierBadge = document.getElementById("metaInspectorTierBadge");

    const facWrEl = document.getElementById("metaStatFactionWr");
    const facSubEl = document.getElementById("metaStatFactionSub");
    const careerLblEl = document.getElementById("metaStatCareerLbl");
    const careerValEl = document.getElementById("metaStatCareerVal");
    const careerSubEl = document.getElementById("metaStatCareerSub");
    const avgWtcEl = document.getElementById("metaStatAvgWtc");
    const avgWinEl = document.getElementById("metaStatAvgWin");
    const bestTargetEl = document.getElementById("metaStatBestTarget");
    const worstTargetEl = document.getElementById("metaStatWorstTarget");

    const factorVsTitle = document.getElementById("metaFactorVsTitle");
    const factorTotalDelta = document.getElementById("metaFactorTotalDelta");
    const factorStrip = document.getElementById("metaInspectorFactorStrip");
    const matchupListTitle = document.getElementById("metaMatchupListTitle");
    const matchupListEl = document.getElementById("metaInspectorMatchupList");

    if (!card) {
      if (nameEl) nameEl.textContent = "No Card Selected";
      if (subEl) subEl.textContent = "Hover or tap a card to view Meta Stats";
      if (matchupListEl) matchupListEl.innerHTML = "";
      return;
    }

    const isMyCard = myRoster.some((c) => c.id === card.id);
    const opposingPool = isMyCard ? oppRoster : myRoster;
    const meta = resolveFactionMeta(card.faction);
    const svgHtml = getFactionSvgHtml(card.faction, "armory-faction-svg");
    const rarity = this.resolveCardRarity(card);
    const isStarter = rarity === "starter";

    if (ownerBadge) {
      ownerBadge.textContent = isMyCard ? "YOUR CARD" : "ENEMY CARD";
      ownerBadge.classList.toggle("opp", !isMyCard);
    }
    if (heroBox) {
      heroBox.style.setProperty("--cmi-accent", meta.accent || "#38bdf8");
    }
    if (emblemEl) emblemEl.innerHTML = svgHtml;
    if (nameEl) nameEl.textContent = card.name || card.faction || "Commander";
    if (subEl) {
      const det = card.detachment || meta.detachment || "Strike Force";
      subEl.textContent = `${card.faction || "Warhammer 40K"} • ${det}`;
    }
    if (eloBadge) eloBadge.textContent = `ELO ${card.elo || 1500}`;
    if (rarityBadge) {
      rarityBadge.className = `cmi-pill rarity-pill ${rarity}`;
      rarityBadge.textContent = rarity.toUpperCase();
    }

    const facWr = Number(card.fac_meta_wr_pct ?? 50.0);
    const facGames = Number(card.fac_meta_games ?? 250);
    const facShift = Number(card.fac_meta_elo_shift ?? Math.round((facWr - 50) * 2.2));
    const facTier = card.fac_meta_tier || (facWr >= 53 ? "S-TIER" : (facWr >= 51 ? "A-TIER" : (facWr >= 49 ? "B-TIER" : "C-TIER")));

    if (tierBadge) {
      const tierCls = facTier.startsWith("S") ? "tier-s" : (facTier.startsWith("A") ? "tier-a" : "tier-b");
      tierBadge.className = `cmi-pill tier-pill ${tierCls}`;
      tierBadge.textContent = `${facTier} META`;
    }

    const fmtSigned = (n) => {
      const r = Math.round(Number(n) || 0);
      return r > 0 ? `+${r}` : `${r}`;
    };

    if (facWrEl) {
      facWrEl.textContent = `${facWr.toFixed(1)}%`;
      facWrEl.style.color = facWr >= 52 ? "#4ade80" : (facWr <= 48.5 ? "#fb7185" : "#f8fafc");
    }
    if (facSubEl) {
      facSubEl.textContent = `${facGames}g • ${fmtSigned(facShift)} Meta Elo`;
    }

    const gamesPlayed = Number(card.matches_played || card.own_faction_games || 0);
    const rawCareerWr = card.win_rate ?? card.own_faction_wr;
    const careerWrPct = rawCareerWr != null
      ? (Number(rawCareerWr) <= 1 ? Number(rawCareerWr) * 100 : Number(rawCareerWr))
      : null;

    if (!isStarter && (gamesPlayed > 0 || (careerWrPct != null && careerWrPct > 0))) {
      if (careerLblEl) careerLblEl.textContent = "PLAYER CAREER";
      if (careerValEl) {
        careerValEl.textContent = careerWrPct != null ? `${careerWrPct.toFixed(1)}% WR` : `${card.elo || 1800} Elo`;
        careerValEl.style.color = (careerWrPct || 50) >= 58 ? "#4ade80" : "#f8fafc";
      }
      if (careerSubEl) {
        careerSubEl.textContent = gamesPlayed > 0
          ? `${gamesPlayed} Career Games`
          : (card.detachment || meta.detachment || "Tournament Pro");
      }
    } else {
      if (careerLblEl) careerLblEl.textContent = "ARCHETYPE";
      if (careerValEl) {
        careerValEl.textContent = isStarter ? "Starter Base" : "Pro Card";
        careerValEl.style.color = "#f8fafc";
      }
      if (careerSubEl) {
        careerSubEl.textContent = card.detachment || meta.detachment || "Balanced Strike Force";
      }
    }

    // Compute matchups against all opposing cards
    const activeOpponents = opposingPool.filter((oc) => oc.status !== "paired");
    const evalPool = activeOpponents.length > 0 ? activeOpponents : opposingPool;
    const matchupRows = opposingPool.map((opp) => {
      const pred = this.getMatchupPrediction(card, opp);
      return { opp, pred };
    });

    if (evalPool.length > 0) {
      const evalPreds = evalPool.map((opp) => ({ opp, pred: this.getMatchupPrediction(card, opp) }));
      const avgWtc = evalPreds.reduce((s, x) => s + x.pred.wtcScore, 0) / evalPreds.length;
      const avgWin = Math.round(evalPreds.reduce((s, x) => s + x.pred.winProb, 0) / evalPreds.length);
      if (avgWtcEl) {
        avgWtcEl.textContent = `${avgWtc.toFixed(1)} / 20`;
        avgWtcEl.style.color = avgWtc >= 11.2 ? "#4ade80" : (avgWtc <= 8.8 ? "#fb7185" : "#fde047");
      }
      if (avgWinEl) avgWinEl.textContent = `${avgWin}% Avg Win`;

      const sortedByScore = [...evalPreds].sort((a, b) => (b.pred.wtcScore - a.pred.wtcScore) || (b.pred.winProb - a.pred.winProb));
      const best = sortedByScore[0];
      const worst = sortedByScore[sortedByScore.length - 1];
      if (bestTargetEl && best) {
        bestTargetEl.textContent = `${best.pred.wtcScore}-${20 - best.pred.wtcScore} vs ${best.opp.name}`;
        bestTargetEl.style.color = best.pred.wtcScore >= 11 ? "#4ade80" : "#f8fafc";
      }
      if (worstTargetEl && worst) {
        worstTargetEl.textContent = `Low: ${worst.pred.wtcScore}-${20 - worst.pred.wtcScore} vs ${worst.opp.name}`;
      }
    } else {
      if (avgWtcEl) avgWtcEl.textContent = "10.0 / 20";
      if (avgWinEl) avgWinEl.textContent = "50% Avg Win";
      if (bestTargetEl) bestTargetEl.textContent = "—";
      if (worstTargetEl) worstTargetEl.textContent = "—";
    }

    // Pick target card for the 6-Factor Breakdown Box
    let targetOpp = null;
    if (this.inspectedTargetCard && opposingPool.some((c) => c.id === this.inspectedTargetCard.id)) {
      targetOpp = opposingPool.find((c) => c.id === this.inspectedTargetCard.id);
    } else if (isMyCard && p.oppDef) {
      targetOpp = p.oppDef;
    } else if (!isMyCard && p.myDef) {
      targetOpp = p.myDef;
    } else if (evalPool.length > 0) {
      targetOpp = evalPool[0];
    } else if (opposingPool.length > 0) {
      targetOpp = opposingPool[0];
    }

    if (targetOpp && factorStrip) {
      const tPred = this.getMatchupPrediction(card, targetOpp);
      const f = tPred.factors || {};
      if (factorVsTitle) {
        factorVsTitle.textContent = `6-FACTOR VS ${String(targetOpp.name || targetOpp.faction || "").toUpperCase()}`;
      }
      if (factorTotalDelta) {
        factorTotalDelta.textContent = `${fmtSigned(tPred.effectiveEloDelta)} Eff. Elo (${tPred.winProb}%)`;
        factorTotalDelta.style.color = tPred.effectiveEloDelta > 15 ? "#4ade80" : (tPred.effectiveEloDelta < -15 ? "#fb7185" : "#38bdf8");
      }
      const items = [
        { lbl: "Base Elo", val: Number(f.base_elo_delta || 0) },
        { lbl: "3M Fac H2H", val: Number(f.fac_h2h_delta || 0) },
        { lbl: "3M Meta", val: Number(f.fac_meta_delta || 0) },
        { lbl: "Own Mast.", val: Number(f.own_mastery_delta || 0) },
        { lbl: "Vs Mast.", val: Number(f.vs_mastery_delta || 0) },
        { lbl: "Player H2H", val: Number(f.past_h2h_delta || 0) }
      ];
      factorStrip.innerHTML = items.map((it) => {
        const cls = it.val > 0 ? "pos" : (it.val < 0 ? "neg" : "");
        return `<div class="cmi-f-chip ${cls}"><span>${it.lbl}</span><strong>${fmtSigned(it.val)}</strong></div>`;
      }).join("");
    } else if (factorStrip) {
      factorStrip.innerHTML = "";
    }

    if (matchupListTitle) {
      matchupListTitle.textContent = isMyCard ? "⚔️ VS OPPONENT HAND" : "⚔️ VS YOUR HAND";
    }

    if (matchupListEl) {
      const sortedRows = [...matchupRows].sort((a, b) => {
        const aPaired = a.opp.status === "paired" ? 1 : 0;
        const bPaired = b.opp.status === "paired" ? 1 : 0;
        if (aPaired !== bPaired) return aPaired - bPaired;
        return (b.pred.wtcScore - a.pred.wtcScore) || (b.pred.winProb - a.pred.winProb);
      });

      matchupListEl.innerHTML = sortedRows.map(({ opp, pred }) => {
        const s = pred.wtcScore;
        const color = s >= 12 ? "#4ade80" : (s <= 8 ? "#fb7185" : "#fde047");
        const ico = getFactionSvgHtml(opp.faction, "armory-faction-svg");
        const isActiveTarget = targetOpp && targetOpp.id === opp.id;
        const isPaired = opp.status === "paired";
        const h2hWr = pred.facH2hWr != null ? `H2H ${Math.round(pred.facH2hWr)}%` : opp.faction;
        const statusSuffix = opp.status === "defender" ? " • 🛡️DEF" : (opp.status === "attacker" ? " • ⚔️ATK" : (isPaired ? " • PAIRED" : ""));
        return `
          <div class="cmi-matchup-row ${isActiveTarget ? "active-target" : ""} ${isPaired ? "paired-out" : ""}" data-opp-id="${this.escapeHtml(opp.id)}">
            <div class="cmi-mr-left">
              <span class="cmi-mr-ico">${ico}</span>
              <div class="cmi-mr-text">
                <span class="cmi-mr-name">${this.escapeHtml(opp.name)}${this.escapeHtml(statusSuffix)}</span>
                <span class="cmi-mr-sub">${opp.elo || 1500} Elo • ${this.escapeHtml(h2hWr)}</span>
              </div>
            </div>
            <span class="cmi-mr-score" style="color:${color}">${s}-${20 - s} • ${pred.winProb}%</span>
          </div>
        `;
      }).join("");

      matchupListEl.querySelectorAll(".cmi-matchup-row").forEach((rowEl) => {
        const selectTarget = () => {
          const oid = rowEl.getAttribute("data-opp-id");
          const foundOpp = opposingPool.find((c) => c.id === oid);
          if (foundOpp) {
            this.inspectedTargetCard = foundOpp;
            this.renderPairingProcessGuide(p);
          }
        };
        rowEl.addEventListener("mouseenter", selectTarget);
        rowEl.addEventListener("click", selectTarget);
      });
    }
  }

  attachCardInspectHandler(container, cardObj, oppCard = null) {
    const el = container.querySelector(".ygo-card");
    if (el && cardObj) {
      el.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "mouse") {
          this.showCardMetaHover(cardObj, oppCard);
        }
      });
      el.addEventListener("pointerleave", (e) => {
        if (e.pointerType === "mouse") {
          this.scheduleHideCardMetaHover();
        }
      });
      el.addEventListener("click", () => {
        this.inspectCard(cardObj, oppCard);
        if (window.innerWidth <= 900) {
          this.openCardMetaPopup(cardObj, oppCard);
        }
      });
    }
  }

  resolveCardRarity(player) {
    if (!player) return "common";
    const isStarter = Boolean(
      player.is_starter ||
      player.rarity === "starter" ||
      String(player.card_id || "").startsWith("starter_")
    );
    if (isStarter) return "starter";
    if (player.rarity && ["mythic", "epic", "rare", "common", "starter"].includes(String(player.rarity).toLowerCase())) {
      return String(player.rarity).toLowerCase();
    }
    const elo = Number(player.elo || 1500);
    if (elo >= 2080) return "mythic";
    if (elo >= 1900) return "epic";
    if (elo >= 1750) return "rare";
    if (elo >= 1550) return "common";
    return "starter";
  }

  buildYuGiOhCardHtml(player, opts = {}) {
    const meta = resolveFactionMeta(player.faction);
    const svgHtml = getFactionSvgHtml(player.faction, "armory-faction-svg");
    const rarity = this.resolveCardRarity(player);
    const isStarter = rarity === "starter";

    let matchupChipHtml = "";
    if (typeof opts.matchupScore === "number") {
      const s = opts.matchupScore;
      const color = s >= 12 ? "#4ade80" : (s <= 8 ? "#fb7185" : "#fde047");
      const winPct = opts.matchupPred?.winProb ?? Math.max(5, Math.min(95, Math.round(50 + ((s - 10) / 33.34) * 100)));
      const tip = opts.matchupPred?.tooltip || `6-Factor Prediction: ${winPct}% Win • Est. ${s}-${20 - s} WTC`;
      matchupChipHtml = `<span class="yc-matchup-chip" style="color:${color}" title="${this.escapeHtml(tip)}">${s}-${20 - s} • ${winPct}%</span>`;
    }

    const rarityShortMap = {
      starter: "STARTER",
      common: "COMMON",
      rare: "RARE",
      epic: "EPIC",
      mythic: "MYTHIC"
    };
    const rarityText = rarityShortMap[rarity] || "CARD";
    const displayName = isStarter
      ? `${player.faction || player.name} (Starter)`
      : (player.player_name || player.name || player.faction);
    const cardTopTitle = isStarter
      ? (player.faction || player.name || displayName)
      : (player.player_name || player.name || displayName);
    const cardArtSubtitle = isStarter
      ? (player.detachment || meta.detachment || player.faction)
      : (player.faction || meta.detachment || "");

    const classes = [
      "ygo-card",
      `rarity-${rarity}`,
      opts.fieldSize ? "field-size" : "",
      opts.oppHand ? "opp-hand-card" : "",
      opts.inspectedTarget ? "inspected-target" : "",
      opts.selected ? "selected" : "",
      opts.clashChoice ? "clash-choice" : "",
      opts.summonSlam ? "card-summon-slam" : ""
    ].filter(Boolean).join(" ");

    return `
      <div class="${classes}" data-card-id="${this.escapeHtml(player.id || player.card_id || "")}" style="--card-accent: ${meta.accent}">
        <div class="yc-top">
          <span class="yc-name" title="${this.escapeHtml(displayName)}">${this.escapeHtml(cardTopTitle)}</span>
          <span class="yc-attr">${svgHtml}</span>
        </div>
        <div class="yc-art">
          ${matchupChipHtml}
          <span class="yc-emblem">${svgHtml}</span>
          <span class="yc-faction">${this.escapeHtml(cardArtSubtitle)}</span>
        </div>
        <div class="yc-bottom">
          <span>ELO <strong>${player.elo || 1500}</strong></span>
          <span class="yc-rarity-pill ${rarity}">${rarityText}</span>
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
    const isSimOn = this.room?.prediction_scoring_enabled !== false;
    const isCapB = this.activeRole === "captain_b";

    // Sync topbar Prediction Scoring toggle
    const chkSim = document.getElementById("chkPredictionScoring");
    if (chkSim) chkSim.checked = isSimOn;
    const lblSimText = document.getElementById("predictionScoringToggleText");
    if (lblSimText) lblSimText.textContent = isSimOn ? "⚔️ Combat Score: ON" : "⚔️ Combat Score: OFF";

    const countLbl = document.getElementById("lockedCountLabel");
    if (countLbl) countLbl.textContent = `${pairings.length} / ${total}`;

    let expSumA = 0;
    let expSumB = 0;
    let simSumA = 0;
    let simSumB = 0;
    pairings.forEach((m) => {
      const estA = Number(m.est_score_a ?? m.matchup?.expected_a ?? m.a_expected ?? 10);
      const estB = Number(m.est_score_b ?? (20 - estA));
      expSumA += estA;
      expSumB += estB;
      const btl = m.battle_result || {};
      const sA = Number(m.sim_score_a ?? btl.final_score_a ?? estA);
      const sB = Number(m.sim_score_b ?? btl.final_score_b ?? (20 - sA));
      simSumA += sA;
      simSumB += sB;
    });

    const myExpScore = isCapB ? expSumB : expSumA;
    const oppExpScore = isCapB ? expSumA : expSumB;
    const mySimScore = isCapB ? simSumB : simSumA;
    const oppSimScore = isCapB ? simSumA : simSumB;

    const myActiveScore = isSimOn ? mySimScore : myExpScore;
    const oppActiveScore = isSimOn ? oppSimScore : oppExpScore;

    const modeLbl = document.getElementById("projectedScoreModeLabel");
    if (modeLbl) {
      modeLbl.textContent = "WTC:";
    }

    const scoreEl = document.getElementById("projectedScoreValue");
    if (scoreEl) scoreEl.textContent = `${myActiveScore} – ${oppActiveScore}`;

    const expSubEl = document.getElementById("expectedScoreSubLine");
    if (expSubEl) {
      if (isSimOn) {
        expSubEl.textContent = `Exp: ${myExpScore}–${oppExpScore} • Combat: ${mySimScore}–${oppSimScore}`;
      } else {
        expSubEl.textContent = `Exp: ${myExpScore}–${oppExpScore} • Win: 51+`;
      }
    }

    const verdictEl = document.getElementById("projectedVerdictBadge");
    if (verdictEl) {
      if (pairings.length === 0) {
        verdictEl.textContent = "0 Locked";
      } else if (myActiveScore > oppActiveScore + 5) {
        verdictEl.textContent = pairings.length >= total ? "🏆 Victory" : "Leading";
      } else if (myActiveScore < oppActiveScore - 5) {
        verdictEl.textContent = pairings.length >= total ? "⚠️ Defeat" : "Trailing";
      } else {
        verdictEl.textContent = "Even";
      }
    }

    // Round-by-Round Progression Strip (T1 .. T5)
    const rbrStrip = document.getElementById("roundByRoundProgressionStrip");
    if (rbrStrip) {
      const pills = [];
      let runMy = 0;
      let runOpp = 0;
      for (let t = 1; t <= total; t++) {
        const match = pairings.find((p) => Number(p.table_num) === t);
        if (!match) {
          pills.push(`<span class="rbr-pill">T${t}: —</span>`);
        } else {
          const estA = Number(match.est_score_a ?? 10);
          const btl = match.battle_result || {};
          const sA = isSimOn ? Number(match.sim_score_a ?? btl.final_score_a ?? estA) : estA;
          const sB = 20 - sA;
          const myTbl = isCapB ? sB : sA;
          const oppTbl = isCapB ? sA : sB;
          runMy += myTbl;
          runOpp += oppTbl;
          const cls = [
            "rbr-pill",
            "locked",
            myTbl > oppTbl ? "win-a" : (myTbl < oppTbl ? "win-b" : "")
          ].filter(Boolean).join(" ");
          pills.push(
            `<span class="${cls}" data-rbr-table="${t}" title="Table #${t}: ${myTbl}-${oppTbl} (Cumulative: ${runMy}-${runOpp}) — Click to replay on-field combat">⚔️T${t}: ${myTbl}-${oppTbl}</span>`
          );
        }
      }
      rbrStrip.innerHTML = pills.join("");
      rbrStrip.querySelectorAll("[data-rbr-table]").forEach((el) => {
        el.addEventListener("click", () => {
          const tbl = Number(el.getAttribute("data-rbr-table"));
          if (tbl) this.playOnFieldCombatAnimation(tbl, []);
        });
      });
    }

    // Final Team Winner Prediction Verdict Banner when all tables are locked
    const finalBanner = document.getElementById("finalMatchVerdictBanner");
    if (finalBanner) {
      if (pairings.length >= total && total > 0) {
        finalBanner.classList.remove("hidden");
        const myTeamName = isCapB ? (this.room?.team_b?.name || "Team B") : (this.room?.team_a?.name || "Team A");
        const oppTeamName = isCapB ? (this.room?.team_a?.name || "Team A") : (this.room?.team_b?.name || "Team B");
        let winHeadline = "⚖️ PROJECTED WTC DRAW";
        if (myActiveScore > oppActiveScore + 5) {
          winHeadline = `🏆 ${this.escapeHtml(myTeamName.toUpperCase())} PREDICTED TO WIN (${myActiveScore} – ${oppActiveScore} WTC)`;
        } else if (oppActiveScore > myActiveScore + 5) {
          winHeadline = `🏆 ${this.escapeHtml(oppTeamName.toUpperCase())} PREDICTED TO WIN (${oppActiveScore} – ${myActiveScore} WTC)`;
        } else if (myActiveScore !== oppActiveScore) {
          const edgeTeam = myActiveScore > oppActiveScore ? myTeamName : oppTeamName;
          winHeadline = `⚔️ RAZOR-THIN EDGE: ${this.escapeHtml(edgeTeam.toUpperCase())} (${myActiveScore} – ${oppActiveScore} WTC)`;
        }
        finalBanner.innerHTML = `
          <div>${winHeadline}</div>
          <div style="font-size:0.62rem;color:var(--text-secondary);margin-top:2px;">
            6-Factor Expected: ${myExpScore}–${oppExpScore} ${isSimOn ? `• Combat Total: ${mySimScore}–${oppSimScore}` : ""}
          </div>
        `;
      } else {
        finalBanner.classList.add("hidden");
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
          const rawProbA = Number(m.win_prob_a ?? m.matchup?.win_prob_a ?? Math.round(50 + ((rawA - 10) / 33.34) * 100));
          const myProb = isCapB ? (100 - rawProbA) : rawProbA;
          const pred = this.getMatchupPrediction(myP, oppP);
          const mySvg = getFactionSvgHtml(myP.faction, "armory-faction-svg");
          const oppSvg = getFactionSvgHtml(oppP.faction, "armory-faction-svg");

          const btl = m.battle_result || {};
          const simA = Number(m.sim_score_a ?? btl.final_score_a ?? rawA);
          const mySim = isCapB ? (20 - simA) : simA;
          const oppSim = 20 - mySim;

          const activeMy = isSimOn ? mySim : myEst;
          const activeOpp = isSimOn ? oppSim : (20 - myEst);
          const playInfo = this.buildTableBattleBreakdown(m, isCapB);
          const swingClass = playInfo.netSwing > 0 ? "swing-pos" : (playInfo.netSwing < 0 ? "swing-neg" : "swing-even");

          return `
            <div class="clash-mini-card" title="${this.escapeHtml(pred.tooltip || "")}">
              <div class="clash-mini-top">
                <span>TABLE #${m.table_num}</span>
                <span>EST: ${myEst}-${20 - myEst} • ${myProb}% WIN / ${100 - myProb}% LOSS</span>
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
              ${isSimOn ? `
              <div class="clash-history-play ${playInfo.badgeClass}">
                <div class="clash-play-head">
                  <span class="clash-play-badge ${playInfo.badgeClass}">${playInfo.badgeText}</span>
                  <span class="clash-play-dice">${playInfo.isGuaranteed ? "⚡ LOCKED" : `🎲 D100: ${playInfo.rawRoll}/100`}</span>
                </div>
                <div class="clash-play-story">${playInfo.storyHtml}</div>
              </div>
              ` : ""}
              <div class="clash-mini-sim-row">
                <span class="clash-sim-pill">
                  ⚔️ WTC SCORE: <strong>${activeMy} – ${activeOpp}</strong>
                  ${isSimOn ? `<span class="clash-swing-pill ${swingClass}">(${playInfo.swingStr})</span>` : ""}
                </span>
                <button type="button" class="clash-mini-fight-btn" data-open-clash-table="${m.table_num}">⚔️ Replay Fight</button>
              </div>
            </div>
          `;
        }).join("");

        listEl.querySelectorAll("[data-open-clash-table]").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const tbl = Number(btn.getAttribute("data-open-clash-table"));
            if (tbl) this.playOnFieldCombatAnimation(tbl, []);
          });
        });
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

  buildTableBattleBreakdown(m, isCapB) {
    const myP = isCapB ? m.player_b : m.player_a;
    const oppP = isCapB ? m.player_a : m.player_b;
    const rawA = Number(m.est_score_a ?? m.matchup?.expected_a ?? m.a_expected ?? 10);
    const myEst = isCapB ? (20 - rawA) : rawA;
    const oppEst = 20 - myEst;
    const rawProbA = Number(m.win_prob_a ?? m.matchup?.win_prob_a ?? Math.round(50 + ((rawA - 10) / 33.34) * 100));
    const myProb = isCapB ? (100 - rawProbA) : rawProbA;
    const oppProb = 100 - myProb;

    const btl = m.battle_result || {};
    const simA = Number(m.sim_score_a ?? btl.final_score_a ?? rawA);
    const mySim = isCapB ? (20 - simA) : simA;
    const oppSim = 20 - mySim;

    const isGuaranteed = Boolean(btl.is_guaranteed || btl.guaranteed || btl.mode === "guaranteed");
    const winnerSide = btl.winner || (simA >= 10 ? "A" : "B");
    const didIWin = isCapB ? (winnerSide === "B") : (winnerSide === "A");
    const winnerP = winnerSide === "B" ? m.player_b : m.player_a;
    const winnerProb = winnerSide === "B" ? (100 - rawProbA) : rawProbA;

    const fallbackRoll = winnerSide === "A"
      ? Math.max(1, Math.min(rawProbA, Math.round(rawProbA * 0.45)))
      : Math.min(100, Math.max(rawProbA + 1, rawProbA + Math.round((100 - rawProbA) * 0.65)));
    const rawRoll = Number(btl.dice_roll ?? btl.d100_roll ?? fallbackRoll);
    const wtcVar = Number(btl.wtc_variance ?? btl.variance ?? 0);
    const varLabel = wtcVar > 0 ? `+${wtcVar} surge` : (wtcVar < 0 ? `${wtcVar} drag` : "0 var");

    const isUpset = btl.is_upset != null ? Boolean(btl.is_upset) : (winnerProb < 50);

    let badgeClass = "favored-win";
    let badgeText = "";
    let storyHtml = "";
    let shortOverlayText = "";

    const rangeNote = `1–${rawProbA} ${this.escapeHtml(m.player_a.faction)} (${rawProbA}%) • ${rawProbA + 1}–100 ${this.escapeHtml(m.player_b.faction)} (${100 - rawProbA}%)`;

    if (isGuaranteed) {
      badgeClass = "stratagem-lock";
      badgeText = `⚡ STRATAGEM LOCKED (${mySim}–${oppSim})`;
      storyHtml = `Pre-game Est <strong>${myEst}–${oppEst}</strong> (${myProb}% Win / ${oppProb}% Loss) bypassed by Tactical Stratagem ➔ Locked <strong>${mySim}–${oppSim}</strong>.`;
      shortOverlayText = `⚡ Stratagem Locked • Est ${myEst}–${oppEst} (${myProb}% Win) ➔ ${mySim}–${oppSim}`;
    } else if (isUpset) {
      if (didIWin) {
        badgeClass = "upset-win";
        badgeText = `🔥 UNDERDOG UPSET WIN! (${myProb}% Hit)`;
        storyHtml = `Est <strong>${myEst}–${oppEst}</strong> gave you a <strong>${myProb}%</strong> upset chance vs ${oppProb}% favorite. 🎲 D100 rolled <strong>${rawRoll}/100</strong> (${rangeNote}, ${varLabel}) ➔ You pulled the upset for <strong>${mySim}–${oppSim}</strong>!`;
      } else {
        badgeClass = "upset-loss";
        badgeText = `🔥 UNDERDOG UPSET! (${this.escapeHtml(oppP.faction)} hit ${oppProb}% odds)`;
        storyHtml = `Est <strong>${myEst}–${oppEst}</strong> means <strong>${myProb}% Win / ${oppProb}% Loss</strong>. 🎲 D100 rolled <strong>${rawRoll}/100</strong> (${rangeNote}, ${varLabel}) ➔ ${this.escapeHtml(oppP.faction)} hit their <strong>${oppProb}%</strong> underdog window to flip ${myEst}–${oppEst} into <strong>${mySim}–${oppSim}</strong>!`;
      }
      shortOverlayText = `🎲 D100: ${rawRoll}/100 • 🔥 ${this.escapeHtml(winnerP.faction)} hit ${winnerProb}% Underdog Upset (${varLabel}) • Est ${myEst}–${oppEst} ➔ ${mySim}–${oppSim}`;
    } else {
      if (didIWin) {
        badgeClass = "favored-win";
        badgeText = `✅ FAVORED WIN (${myProb}% Odds Held)`;
        storyHtml = `Est <strong>${myEst}–${oppEst}</strong> (${myProb}% Win / ${oppProb}% Loss). 🎲 D100 rolled <strong>${rawRoll}/100</strong> (${rangeNote}, ${varLabel}) ➔ ${this.escapeHtml(myP.faction)} held the ${myProb}% edge for <strong>${mySim}–${oppSim}</strong>.`;
      } else {
        badgeClass = "favored-loss";
        badgeText = `🛡️ FAVORED LOSS (${this.escapeHtml(oppP.faction)} held ${oppProb}% edge)`;
        storyHtml = `Est <strong>${myEst}–${oppEst}</strong> (${myProb}% Win / ${oppProb}% Loss). 🎲 D100 rolled <strong>${rawRoll}/100</strong> (${rangeNote}, ${varLabel}) ➔ ${this.escapeHtml(oppP.faction)} held their ${oppProb}% favorite odds for <strong>${mySim}–${oppSim}</strong>.`;
      }
      shortOverlayText = `🎲 D100: ${rawRoll}/100 • ✅ ${this.escapeHtml(winnerP.faction)} held ${winnerProb}% Favorite Odds (${varLabel}) • Est ${myEst}–${oppEst} ➔ ${mySim}–${oppSim}`;
    }

    const netSwing = mySim - myEst;
    const swingStr = netSwing > 0 ? `+${netSwing} vs Est` : (netSwing < 0 ? `${netSwing} vs Est` : `Exact Est`);

    return {
      rawRoll,
      wtcVar,
      varLabel,
      isGuaranteed,
      isUpset,
      didIWin,
      badgeClass,
      badgeText,
      storyHtml,
      shortOverlayText,
      swingStr,
      netSwing
    };
  }

  async togglePredictionScoringMode(enabled) {
    if (!this.room || !this.roomCode) return;
    const role = this.activeRole === "spectator" ? "captain_a" : this.activeRole;
    try {
      const res = await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          user_id: this.userId,
          captain_token: this.captainTokens[role],
          action: "toggle_prediction_scoring",
          payload: { enabled: Boolean(enabled) }
        })
      });
      const data = await res.json();
      if (data && data.ok) {
        this.room = data.room;
        this.renderAll();
        this.showToast(
          this.room.prediction_scoring_enabled
            ? "⚔️ On-Field Combat & WTC Score Simulation ON!"
            : "📋 Official Pairing Mode (Score Simulation OFF)"
        );
      }
    } catch (e) {
      // ignore network error
    }
  }

  clearCombatTimers() {
    if (Array.isArray(this._combatTimers)) {
      this._combatTimers.forEach((id) => clearTimeout(id));
    }
    this._combatTimers = [];
  }

  hideOnFieldCombatAnimation() {
    this.clearCombatTimers();
    const stage = document.getElementById("onFieldCombatStage");
    if (stage) {
      stage.classList.remove("phase-rise", "phase-strike", "phase-score");
      stage.classList.add("hidden");
    }
    const mat = document.getElementById("duelPodA");
    if (mat) {
      mat.classList.remove("playmat-combat-shake");
    }
    this.activeClashTableNum = null;
  }

  advanceOrHideOnFieldCombat() {
    if (this.pendingClashQueue && this.pendingClashQueue.length > 0) {
      const nextTbl = this.pendingClashQueue.shift();
      this.playOnFieldCombatAnimation(nextTbl, this.pendingClashQueue);
    } else {
      this.hideOnFieldCombatAnimation();
    }
  }

  /**
   * Yu-Gi-Oh! Master Duel Style On-Field Combat Animation (NO Popup Modal!):
   * 1. Brings the two paired cards to the front of the playmat (`#onFieldCombatStage`) and scales them larger (`phase-rise`).
   * 2. Performs an attack lunge + diagonal slash beam + shockwave ring right on the playmat (`phase-strike`).
   * 3. Reveals the behind-the-scenes computed WTC Score (`13 – 7`) right between the two enlarged cards (`phase-score`),
   *    then smoothly advances to the next table or settles back into the playmat.
   */
  playOnFieldCombatAnimation(tableNum, queueRest = [], opts = {}) {
    if (!this.room) return;
    this.clearCombatTimers();

    this.activeClashTableNum = Number(tableNum);
    this.pendingClashQueue = Array.isArray(queueRest) ? [...queueRest] : [];

    const pairings = this.room.pairings || [];
    const match = pairings.find((p) => Number(p.table_num) === Number(this.activeClashTableNum));
    if (!match) return;

    const stage = document.getElementById("onFieldCombatStage");
    if (!stage) return;

    const isCapB = this.activeRole === "captain_b";
    const myP = isCapB ? match.player_b : match.player_a;
    const oppP = isCapB ? match.player_a : match.player_b;

    const rawEstA = Number(match.est_score_a ?? 10);
    const myEst = isCapB ? (20 - rawEstA) : rawEstA;
    const oppEst = 20 - myEst;

    const btl = match.battle_result || {};
    const isSimOn = this.room?.prediction_scoring_enabled !== false;
    const simA = Number(match.sim_score_a ?? btl.final_score_a ?? rawEstA);
    const myScore = isSimOn ? (isCapB ? (20 - simA) : simA) : myEst;
    const oppScore = 20 - myScore;

    const bannerEl = document.getElementById("ofcTableBanner");
    if (bannerEl) {
      const qLen = this.pendingClashQueue.length;
      bannerEl.textContent = qLen > 0
        ? `⚔️ TABLE #${match.table_num} CLASH (${qLen} MORE QUEUED)`
        : `⚔️ TABLE #${match.table_num} CLASH — ${myP.name.toUpperCase()} VS ${oppP.name.toUpperCase()}`;
    }

    const myTeamName = isCapB ? (this.room?.team_b?.name || "YOUR TEAM") : (this.room?.team_a?.name || "YOUR TEAM");
    const oppTeamName = isCapB ? (this.room?.team_a?.name || "ENEMY TEAM") : (this.room?.team_b?.name || "ENEMY TEAM");

    const leftOwnerEl = document.getElementById("ofcLeftOwnerTag");
    const rightOwnerEl = document.getElementById("ofcRightOwnerTag");
    if (leftOwnerEl) leftOwnerEl.textContent = myTeamName.toUpperCase();
    if (rightOwnerEl) rightOwnerEl.textContent = oppTeamName.toUpperCase();

    const leftMount = document.getElementById("ofcLeftCardMount");
    const rightMount = document.getElementById("ofcRightCardMount");
    if (leftMount) {
      leftMount.innerHTML = this.buildYuGiOhCardHtml(myP, {
        fieldSize: false,
        matchupScore: myEst,
        matchupPred: this.getMatchupPrediction(myP, oppP)
      });
    }
    if (rightMount) {
      rightMount.innerHTML = this.buildYuGiOhCardHtml(oppP, {
        fieldSize: false,
        matchupScore: oppEst,
        matchupPred: this.getMatchupPrediction(oppP, myP)
      });
    }

    const scoreNumsEl = document.getElementById("ofcWtcScoreNums");
    if (scoreNumsEl) {
      scoreNumsEl.textContent = `${myScore} – ${oppScore}`;
      scoreNumsEl.classList.remove("score-win", "score-loss", "score-even");
      if (myScore > oppScore) {
        scoreNumsEl.classList.add("score-win");
      } else if (myScore < oppScore) {
        scoreNumsEl.classList.add("score-loss");
      } else {
        scoreNumsEl.classList.add("score-even");
      }
    }

    const verdictEl = document.getElementById("ofcWtcWinnerTag");
    if (verdictEl) {
      if (myScore > oppScore) {
        verdictEl.textContent = `🏆 ${myP.name.toUpperCase()} PREVAILS`;
      } else if (oppScore > myScore) {
        verdictEl.textContent = `💥 ${oppP.name.toUpperCase()} PREVAILS`;
      } else {
        verdictEl.textContent = `⚖️ DEADLOCK 10–10 CLASH`;
      }
    }

    const rollExplainEl = document.getElementById("ofcWtcRollExplain");
    if (rollExplainEl) {
      if (isSimOn) {
        const playInfo = this.buildTableBattleBreakdown(match, isCapB);
        rollExplainEl.textContent = playInfo.shortOverlayText;
        rollExplainEl.style.display = "block";
      } else {
        rollExplainEl.textContent = "";
        rollExplainEl.style.display = "none";
      }
    }

    // Reset classes & launch Phase 1: Cards brought to front & scale larger on the playmat
    stage.classList.remove("hidden", "phase-rise", "phase-strike", "phase-score");
    void stage.offsetWidth;
    stage.classList.add("phase-rise");

    const mat = document.getElementById("duelPodA");

    // Phase 2 (340ms): Attack Lunge + Energy Slash + Shockwave Impact on the playmat
    const tStrike = setTimeout(() => {
      stage.classList.add("phase-strike");
      if (mat) {
        mat.classList.remove("playmat-combat-shake");
        void mat.offsetWidth;
        mat.classList.add("playmat-combat-shake");
      }
    }, 340);
    this._combatTimers.push(tStrike);

    // Phase 3 (820ms): Behind-the-scenes WTC Score pops in between the two enlarged cards
    const tScore = setTimeout(() => {
      stage.classList.add("phase-score");
    }, 820);
    this._combatTimers.push(tScore);

    // Auto-advance or dismiss after showing the WTC score (unless holdScore is set for screenshot inspection)
    if (!opts.holdScore) {
      const tDone = setTimeout(() => {
        this.advanceOrHideOnFieldCombat();
      }, 2450);
      this._combatTimers.push(tDone);
    }
  }

  async applyDemoState(demoState) {
    if (!this.room) return;
    if (demoState === "tcg_deck" || demoState === "tcg_packs" || demoState === "tcg_binder") {
      this.closeLobbyModal();
      const tab = demoState === "tcg_packs" ? "packs" : (demoState === "tcg_binder" ? "binder" : "deck");
      await this.openTcgVaultModal(tab);
      return;
    }
    if (demoState === "tcg_reveal") {
      this.closeLobbyModal();
      await this.openTcgVaultModal("packs");
      if (Number(this.tcgState?.spendable_glory || 0) < 850) {
        await this.claimDailyGlory();
      }
      await this.buyTcgPack("warlord");
      return;
    }
    if (demoState === "tcg_duel") {
      await this.fetchTcgState();
      await this.saveOrModifyTcgDeck("auto_best");
      await this.deployTcgDeckToRoom("saved_deck", { enterArena: true });
      await this.chooseCoinFlipRole("defender", "captain_a");
      return;
    }
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
    } else if (demoState === "clash_modal" || demoState === "on_field_combat") {
      await this.autoCompleteRemainingPhases();
      if (this.room?.pairings?.length) {
        this.playOnFieldCombatAnimation(1, [], { holdScore: true });
      }
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

  formatClockSec(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  toggleClockPopover(forceState) {
    const pop = document.getElementById("pairingClockPopover");
    if (!pop) return;
    if (typeof forceState === "boolean") {
      pop.classList.toggle("hidden", !forceState);
    } else {
      pop.classList.toggle("hidden");
    }
    this.renderPairingClock();
  }

  toggleClockRun() {
    if (!this.pairingClock) return;
    this.pairingClock.running = !this.pairingClock.running;
    if (this.pairingClock.timerId) {
      clearInterval(this.pairingClock.timerId);
      this.pairingClock.timerId = null;
    }
    if (this.pairingClock.running) {
      this.pairingClock.timerId = setInterval(() => {
        if (!this.pairingClock.running) return;
        if (this.pairingClock.activeSide === "b") {
          this.pairingClock.secB = Math.max(0, this.pairingClock.secB - 1);
        } else {
          this.pairingClock.secA = Math.max(0, this.pairingClock.secA - 1);
        }
        this.renderPairingClock();
      }, 1000);
    }
    this.renderPairingClock();
  }

  switchClockSide() {
    if (!this.pairingClock) return;
    this.pairingClock.activeSide = this.pairingClock.activeSide === "a" ? "b" : "a";
    this.renderPairingClock();
  }

  resetClock() {
    if (!this.pairingClock) return;
    this.pairingClock.running = false;
    if (this.pairingClock.timerId) {
      clearInterval(this.pairingClock.timerId);
      this.pairingClock.timerId = null;
    }
    this.pairingClock.secA = 300;
    this.pairingClock.secB = 300;
    this.renderPairingClock();
  }

  renderPairingClock() {
    if (!this.pairingClock) return;
    const activeSec = this.pairingClock.activeSide === "b" ? this.pairingClock.secB : this.pairingClock.secA;
    const topTxt = document.getElementById("topbarClockText");
    if (topTxt) topTxt.textContent = this.pairingClock.running ? this.formatClockSec(activeSec) : "Table Clock";
    const dockLbl = document.getElementById("dockClockLabel");
    if (dockLbl) dockLbl.textContent = this.pairingClock.running ? this.formatClockSec(activeSec) : "Clock";

    const valA = document.getElementById("clockValueTeamA");
    const valB = document.getElementById("clockValueTeamB");
    if (valA) valA.textContent = this.formatClockSec(this.pairingClock.secA);
    if (valB) valB.textContent = this.formatClockSec(this.pairingClock.secB);

    const lblA = document.getElementById("clockLabelTeamA");
    const lblB = document.getElementById("clockLabelTeamB");
    if (lblA && this.room?.team_a?.tag) lblA.textContent = `${this.room.team_a.tag} CAP`;
    if (lblB && this.room?.team_b?.tag) lblB.textContent = `${this.room.team_b.tag} CAP`;

    const boxA = document.getElementById("clockBoxTeamA");
    const boxB = document.getElementById("clockBoxTeamB");
    if (boxA) boxA.classList.toggle("active", this.pairingClock.activeSide === "a");
    if (boxB) boxB.classList.toggle("active", this.pairingClock.activeSide === "b");

    const runBtn = document.getElementById("btnClockToggleRun");
    if (runBtn) runBtn.textContent = this.pairingClock.running ? "⏸️ Pause" : "▶️ Start";
  }

  openQuickDiceModal() {
    if (this.room?.pairings?.length) {
      const latestTable = this.room.pairings[this.room.pairings.length - 1];
      this.playOnFieldCombatAnimation(latestTable.table_num || this.room.pairings.length, []);
      return;
    }
    this.showToast("⚔️ Lock a Table Pairing first to watch the On-Field Card Clash, or click 🪙 Coin Flip!");
  }

  async finishPairingRoom() {
    if (!this.roomCode) {
      window.location.href = "/11th/tracker";
      return;
    }
    if (this.activeRole === "spectator") {
      window.location.href = "/11th/tracker";
      return;
    }
    const alreadyFinished = Boolean(this.room && (this.room.is_finished || this.room.status === "completed"));
    if (alreadyFinished) {
      window.location.href = "/11th/tracker";
      return;
    }
    try {
      const tok = this.captainTokens[this.activeRole] || this.loadRoomTokenFromStorage(this.roomCode, this.activeRole);
      const resp = await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: this.activeRole,
          user_id: this.userId,
          captain_token: tok,
          action: "finish_room",
          payload: {}
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (data && (data.ok || data.success) && data.room) {
        this.room = data.room;
        this.renderAll();
        this.showToast("🏁 Team Pairings finalized & saved to Completed Matches in Lobby! Click again to exit to Lobby.");
      } else {
        this.showToast(data.error || "Could not finalize room");
      }
    } catch (err) {
      console.error("Failed to finish pairing room:", err);
    }
  }

  // =========================================================================
  // OMNITACTICA TCG PLAYER CARD VAULT, GLORY PACK STORE & DECK CONSTRUCTION
  // =========================================================================

  async fetchTcgState() {
    try {
      const headers = {};
      const tok = this.getAuthToken();
      if (tok) headers["Authorization"] = `Bearer ${tok}`;
      const resp = await fetch(`/api/tcg/state?user_id=${encodeURIComponent(this.userId)}`, {
        headers,
        credentials: "include"
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data && (data.ok || data.success)) {
        this.tcgState = data;
        if (data.is_authenticated && data.user_id) {
          this.userId = String(data.user_id);
        }
        try {
          localStorage.setItem("omnitactica_cached_spendable_glory", String(Number(data.spendable_glory ?? 0)));
        } catch (_e) {}
        this.renderTcgHeaderCounters();
        this.renderRoomModeStrip();
        return data;
      }
    } catch (err) {
      console.error("Failed to fetch TCG state:", err);
    }
    return null;
  }

  async openTcgVaultModal(tab = "deck") {
    const backdrop = document.getElementById("tcgVaultModalBackdrop");
    if (backdrop) backdrop.classList.remove("hidden");
    if (!this.tcgState) {
      await this.fetchTcgState();
    }
    this.switchTcgTab(tab);
  }

  closeTcgVaultModal() {
    const backdrop = document.getElementById("tcgVaultModalBackdrop");
    if (backdrop) backdrop.classList.add("hidden");
  }

  switchTcgTab(tab = "deck") {
    this.activeTcgTab = ["deck", "packs", "binder"].includes(tab) ? tab : "deck";
    document.querySelectorAll("#tcgVaultTabsBar .tcg-tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-tcg-tab") === this.activeTcgTab);
    });
    const pDeck = document.getElementById("tcgPanelDeck");
    const pPacks = document.getElementById("tcgPanelPacks");
    const pBinder = document.getElementById("tcgPanelBinder");
    if (pDeck) pDeck.classList.toggle("hidden", this.activeTcgTab !== "deck");
    if (pPacks) pPacks.classList.toggle("hidden", this.activeTcgTab !== "packs");
    if (pBinder) pBinder.classList.toggle("hidden", this.activeTcgTab !== "binder");

    this.renderTcgVaultAll();
  }

  renderTcgHeaderCounters() {
    if (!this.tcgState) return;
    const glory = Number(this.tcgState.spendable_glory ?? 0);

    const topBtn = document.getElementById("topbarTcgBtnText");
    if (topBtn) {
      topBtn.textContent = `TCG Cards (${glory.toLocaleString()} 🪙)`;
    }
    const balEl = document.getElementById("tcgVaultGloryBalance");
    if (balEl) {
      balEl.textContent = `🪙 ${glory.toLocaleString()}`;
    }
    const ownedBadge = document.getElementById("tcgTabOwnedCountBadge");
    if (ownedBadge) {
      const totalOwned = Number(this.tcgState.owned_total_count || (this.tcgState.owned_cards || []).length || 28);
      ownedBadge.textContent = String(totalOwned);
    }
  }

  renderRoomModeStrip() {
    const badge = document.getElementById("roomModeStatusBadge");
    if (!badge) return;
    const isCasualTcg = this.room?.room_mode === "casual_tcg";
    badge.classList.toggle("casual-active", isCasualTcg);
    badge.textContent = isCasualTcg ? "🃏 Casual TCG" : "🏆 Tournament";
  }

  renderTcgVaultAll() {
    if (!this.tcgState) return;
    this.renderTcgHeaderCounters();
    this.renderTcgDeckTab();
    this.renderTcgPacksTab();
    this.renderTcgBinderTab();
  }

  getActiveTcgFormat() {
    const sel = document.getElementById("tcgDeckFormatSelect");
    const val = (sel ? sel.value : (this.room?.format_size || "5v5")).toLowerCase();
    return val === "8v8" ? "8v8" : "5v5";
  }

  renderTcgDeckTab() {
    if (!this.tcgState) return;
    const fmt = this.getActiveTcgFormat();
    const fmtBadge = document.getElementById("tcgTabDeckFormatBadge");
    if (fmtBadge) fmtBadge.textContent = fmt.toUpperCase();

    const deckCards = (fmt === "8v8" ? this.tcgState.deck_8v8_cards : this.tcgState.deck_5v5_cards) || [];
    const deckName = (fmt === "8v8" ? this.tcgState.deck_name_8v8 : this.tcgState.deck_name_5v5) || `Casual TCG Deck (${fmt.toUpperCase()})`;
    const nameInput = document.getElementById("tcgDeckNameInput");
    if (nameInput && document.activeElement !== nameInput) {
      nameInput.value = deckName;
    }

    const totalElo = deckCards.reduce((acc, c) => acc + Number(c.elo || 1500), 0);
    const avgElo = deckCards.length ? Math.round(totalElo / deckCards.length) : 1500;
    const starterCount = deckCards.filter((c) => c.is_starter).length;
    const proCount = deckCards.length - starterCount;
    const summaryEl = document.getElementById("tcgDeckStatsSummary");
    if (summaryEl) {
      summaryEl.innerHTML = `Avg Elo: <strong>${avgElo.toLocaleString()}</strong> • ${starterCount} Starter / ${proCount} Pro Cards`;
    }

    if (this.selectedDeckSlotIdx >= deckCards.length) {
      this.selectedDeckSlotIdx = 0;
    }
    const slotHint = document.getElementById("tcgSelectedSlotHint");
    if (slotHint) {
      const targetCard = deckCards[this.selectedDeckSlotIdx];
      slotHint.textContent = targetCard
        ? `Slot #${this.selectedDeckSlotIdx + 1}: ${targetCard.name} (${targetCard.elo})`
        : `Slot #${this.selectedDeckSlotIdx + 1} Selected`;
    }

    // Render Active Deck Slots
    const tray = document.getElementById("tcgActiveDeckTray");
    if (tray) {
      tray.classList.toggle("format-8v8", fmt === "8v8");
      tray.innerHTML = deckCards.map((card, idx) => {
        const isTarget = idx === this.selectedDeckSlotIdx;
        const typeTag = card.is_starter ? "⚪ STARTER" : `🌟 ${String(card.rarity || "PRO").toUpperCase()}`;
        return `
          <div class="tcg-deck-slot-card ${isTarget ? "selected-slot" : ""}" data-deck-slot-idx="${idx}">
            <div class="tdsc-top-bar">
              <span>#${idx + 1}</span>
              <span class="tdsc-type-pill">${typeTag}</span>
            </div>
            ${this.buildYuGiOhCardHtml(card)}
          </div>
        `;
      }).join("");

      tray.querySelectorAll(".tcg-deck-slot-card").forEach((slotEl) => {
        slotEl.addEventListener("click", () => {
          this.selectedDeckSlotIdx = Number(slotEl.getAttribute("data-deck-slot-idx") || 0);
          this.renderTcgDeckTab();
        });
      });
    }

    // Render Owned Cards Picker Grid
    const pickerGrid = document.getElementById("tcgOwnedDeckPickerGrid");
    if (!pickerGrid) return;

    const inDeckCardIds = new Set(deckCards.map((c) => c.card_id));
    const inDeckPlayers = new Set(
      deckCards
        .filter((c) => !c.is_starter && c.player_name)
        .map((c) => String(c.player_name).toLowerCase())
    );

    const searchQ = (document.getElementById("tcgDeckPickerSearch")?.value || "").trim().toLowerCase();
    const allOwned = (this.tcgState.owned_cards || []).slice();

    const filteredOwned = allOwned.filter((c) => {
      if (this.tcgPickerFilter === "pro" && c.is_starter) return false;
      if (this.tcgPickerFilter === "starter" && !c.is_starter) return false;
      if (searchQ) {
        const hay = `${c.name || ""} ${c.player_name || ""} ${c.faction || ""} ${c.detachment || ""} ${c.rarity || ""}`.toLowerCase();
        if (!hay.includes(searchQ)) return false;
      }
      return true;
    });

    pickerGrid.innerHTML = filteredOwned.map((card) => {
      const rarity = this.resolveCardRarity(card);
      const isInDeck = inDeckCardIds.has(card.card_id);
      const samePlayerInDeck = !isInDeck && !card.is_starter && card.player_name && inDeckPlayers.has(String(card.player_name).toLowerCase());
      const svgHtml = getFactionSvgHtml(card.faction, "armory-faction-svg");
      const meta = resolveFactionMeta(card.faction);
      const detLabel = card.detachment || meta.detachment || "Strike Force";
      const subText = card.is_starter
        ? detLabel
        : `${card.faction} • ${detLabel}`;
      const statusBadge = isInDeck
        ? `<span class="tpc-action-pill in-deck-pill">✓ IN DECK</span>`
        : (samePlayerInDeck
            ? `<span class="tpc-action-pill swap-pill" title="Swapping will replace this player's other faction card in your deck">⇄ SWAP</span>`
            : `<span class="tpc-action-pill equip-pill">+ EQUIP</span>`);

      return `
        <div class="tcg-picker-card rarity-${rarity} ${isInDeck ? "in-deck" : ""}" data-picker-card-id="${this.escapeHtml(card.card_id)}">
          <div class="tpc-body">
            <div class="tpc-sigil">${svgHtml}</div>
            <div class="tpc-info">
              <div class="tpc-name">${this.escapeHtml(card.is_starter ? card.faction : card.player_name || card.name)}</div>
              <div class="tpc-sub">${this.escapeHtml(subText)}</div>
            </div>
          </div>
          <div class="tpc-foot">
            <span class="tpc-elo">ELO <strong>${card.elo}</strong></span>
            <div class="tpc-foot-right">
              <span class="tpc-RARITY ${rarity}">${card.is_starter ? "STARTER" : String(rarity).toUpperCase()}</span>
              ${statusBadge}
            </div>
          </div>
        </div>
      `;
    }).join("");

    pickerGrid.querySelectorAll(".tcg-picker-card").forEach((cardEl) => {
      cardEl.addEventListener("click", () => {
        const cid = cardEl.getAttribute("data-picker-card-id");
        if (cid) this.swapCardIntoActiveDeck(cid);
      });
    });
  }

  async swapCardIntoActiveDeck(cardId) {
    if (!this.tcgState || !cardId) return;
    const fmt = this.getActiveTcgFormat();
    const deckCards = ((fmt === "8v8" ? this.tcgState.deck_8v8_cards : this.tcgState.deck_5v5_cards) || []).slice();
    const ownedMap = new Map((this.tcgState.owned_cards || []).map((c) => [c.card_id, c]));
    const picked = ownedMap.get(cardId);
    if (!picked) return;

    // If exact card is already in deck, select its slot
    const existingIdx = deckCards.findIndex((c) => c.card_id === cardId);
    if (existingIdx >= 0) {
      this.selectedDeckSlotIdx = existingIdx;
      this.showToast(`${picked.name} (${picked.faction}) is already in Slot #${existingIdx + 1}!`);
      this.renderTcgDeckTab();
      return;
    }

    // Enforce 1 card per Real Player in a team deck: if same real player is in another slot, replace that slot
    let targetSlot = this.selectedDeckSlotIdx;
    if (!picked.is_starter && picked.player_name) {
      const samePlayerIdx = deckCards.findIndex(
        (c) => !c.is_starter && String(c.player_name || "").toLowerCase() === String(picked.player_name).toLowerCase()
      );
      if (samePlayerIdx >= 0) {
        targetSlot = samePlayerIdx;
      }
    }

    if (targetSlot < 0 || targetSlot >= deckCards.length) {
      targetSlot = 0;
    }
    deckCards[targetSlot] = picked;
    const newCardIds = deckCards.map((c) => c.card_id);
    this.selectedDeckSlotIdx = (targetSlot + 1) % deckCards.length;
    await this.saveOrModifyTcgDeck("custom", newCardIds);
  }

  async saveOrModifyTcgDeck(mode = "custom", customCardIds = null) {
    const fmt = this.getActiveTcgFormat();
    const deckCards = (fmt === "8v8" ? this.tcgState?.deck_8v8_cards : this.tcgState?.deck_5v5_cards) || [];
    const cardIds = Array.isArray(customCardIds) ? customCardIds : deckCards.map((c) => c.card_id);
    const deckName = (document.getElementById("tcgDeckNameInput")?.value || "").trim();

    try {
      const headers = { "Content-Type": "application/json" };
      const tok = this.getAuthToken();
      if (tok) headers["Authorization"] = `Bearer ${tok}`;
      const resp = await fetch("/api/tcg/save-deck", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          user_id: this.userId,
          format_size: fmt,
          mode,
          card_ids: cardIds,
          deck_name: deckName
        })
      });
      const data = await resp.json();
      if (data && (data.ok || data.success) && data.tcg_state) {
        this.tcgState = data.tcg_state;
        this.renderTcgVaultAll();
        if (mode === "reset_starter") {
          this.showToast(`🛡️ Reset ${fmt.toUpperCase()} Deck to 1450–1550 Elo Starter Factions!`);
        } else if (mode === "auto_best") {
          this.showToast(`⚡ Auto-filled ${fmt.toUpperCase()} Deck with your highest-Elo owned cards!`);
        } else {
          this.showToast(`💾 Saved ${fmt.toUpperCase()} Casual TCG Deck!`);
        }
      }
    } catch (err) {
      console.error("Failed to save TCG deck:", err);
    }
  }

  renderTcgPacksTab() {
    if (!this.tcgState) return;
    const glory = Number(this.tcgState.spendable_glory ?? 0);

    const catalog = this.tcgState.pack_catalog || {};
    const packOrder = ["recruit", "veteran", "warlord"];
    const storeGrid = document.getElementById("tcgPackStoreGrid");
    if (storeGrid) {
      storeGrid.innerHTML = packOrder.map((pKey) => {
        const pack = catalog[pKey];
        if (!pack) return "";
        const canAfford = glory >= Number(pack.cost_glory || 0);
        const s1 = pack.slot_1_odds || {};
        const sRest = pack.other_slots_odds || {};
        const fmtPct = (v) => `${Math.round(Number(v || 0) * 100)}%`;

        return `
          <div class="tcg-pack-card pack-${pKey}">
            ${pack.badge ? `<span class="tpc-promo-ribbon">${this.escapeHtml(pack.badge)}</span>` : ""}
            <div class="tpk-top">
              <div class="tpk-icon">${pack.icon || "📦"}</div>
              <div style="flex:1;min-width:0;">
                <div class="tpk-title" style="display:flex;align-items:center;gap:6px;">
                  <span>${this.escapeHtml(pack.name)}</span>
                  <button type="button" class="info-tip-btn" data-info-title="${this.escapeHtml(pack.name)}" data-info-body="${this.escapeHtml(pack.description || pack.tagline || "")}" aria-label="Pack Info">i</button>
                </div>
                <div class="tpk-tagline">${this.escapeHtml(pack.tagline || "")}</div>
              </div>
            </div>
            <div class="tpk-odds-box">
              <div class="tpk-odds-title">
                <span>SLOT #1 ODDS</span>
                <span>LEAD CARD</span>
              </div>
              <div class="tpk-odds-row">
                <div class="tpk-odd-pill common">Com<span>${fmtPct(s1.common)}</span></div>
                <div class="tpk-odd-pill rare">Rare<span>${fmtPct(s1.rare)}</span></div>
                <div class="tpk-odd-pill epic">Epic<span>${fmtPct(s1.epic)}</span></div>
                <div class="tpk-odd-pill mythic">Myth<span>${fmtPct(s1.mythic)}</span></div>
              </div>
              <div class="tpk-odds-title" style="margin-top:4px;">
                <span>SLOTS #2–#${pack.card_count || 3}</span>
                <span>${pack.card_count || 3} CARDS</span>
              </div>
              <div class="tpk-odds-row">
                <div class="tpk-odd-pill common">Com<span>${fmtPct(sRest.common)}</span></div>
                <div class="tpk-odd-pill rare">Rare<span>${fmtPct(sRest.rare)}</span></div>
                <div class="tpk-odd-pill epic">Epic<span>${fmtPct(sRest.epic)}</span></div>
                <div class="tpk-odd-pill mythic">Myth<span>${fmtPct(sRest.mythic)}</span></div>
              </div>
            </div>
            <button type="button" class="tpk-buy-btn" data-buy-pack="${pKey}" ${canAfford ? "" : "disabled"}>
              <span>OPEN (${pack.card_count || 3})</span>
              <span class="tpk-cost-chip">🪙 ${Number(pack.cost_glory || 0).toLocaleString()}</span>
            </button>
          </div>
        `;
      }).join("");

      storeGrid.querySelectorAll(".tpk-buy-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const pType = btn.getAttribute("data-buy-pack");
          if (pType) this.buyTcgPack(pType);
        });
      });
    }

    this.renderPackRevealStage();
  }

  renderPackRevealStage() {
    const stage = document.getElementById("tcgPackRevealStage");
    if (!stage) return;
    if (!this.lastPackReveal || !Array.isArray(this.lastPackReveal.pulled_cards)) {
      stage.classList.add("hidden");
      return;
    }
    stage.classList.remove("hidden");
    const r = this.lastPackReveal;

    const kicker = document.getElementById("tcgRevealPackNameKicker");
    if (kicker) {
      kicker.textContent = `📦 OPENED ${String(r.pack?.name || "REQUISITION PACK").toUpperCase()}`;
    }
    const headline = document.getElementById("tcgRevealHeadline");
    if (headline) {
      const newCnt = r.pulled_cards.filter((c) => c.is_new).length;
      headline.textContent = `${r.pulled_cards.length} PLAYER CARDS ACQUIRED (${newCnt} NEW • ${r.pulled_cards.length - newCnt} FOIL UPGRADE)`;
    }

    const pills = document.getElementById("tcgRevealSummaryPills");
    if (pills) {
      pills.innerHTML = `
        <span class="tprs-pill">Spent: <strong>-${r.glory_spent} 🪙</strong></span>
        ${r.glory_rebate > 0 ? `<span class="tprs-pill rebate">Dup Shard Rebate: <strong>+${r.glory_rebate} 🪙</strong></span>` : ""}
        <span class="tprs-pill">Net Cost: <strong>-${r.net_glory_cost} 🪙</strong></span>
      `;
    }

    const row = document.getElementById("tcgRevealCardsRow");
    if (row) {
      row.innerHTML = r.pulled_cards.map((card) => {
        const rarity = this.resolveCardRarity(card);
        const statusTag = card.is_new
          ? `<span class="trc-status-tag new">✨ NEW CARD UNLOCKED!</span>`
          : `<span class="trc-status-tag dup">★ FOIL UPGRADE (${card.foil_tier}) • +${card.duplicate_rebate_glory} 🪙</span>`;
        return `
          <div class="tcg-reveal-card-wrap">
            ${statusTag}
            ${this.buildYuGiOhCardHtml(card)}
            <span class="trc-sub-meta">${this.escapeHtml(card.rarity_label || rarity.toUpperCase())} • ${this.escapeHtml(card.team_name || card.detachment)}</span>
          </div>
        `;
      }).join("");
    }
  }

  async buyTcgPack(packType = "recruit") {
    try {
      const headers = { "Content-Type": "application/json" };
      const tok = this.getAuthToken();
      if (tok) headers["Authorization"] = `Bearer ${tok}`;
      const resp = await fetch("/api/tcg/buy-pack", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          user_id: this.userId,
          pack_type: packType
        })
      });
      const data = await resp.json();
      if (resp.ok && data && (data.ok || data.success)) {
        this.lastPackReveal = data;
        if (data.tcg_state) {
          this.tcgState = data.tcg_state;
        }
        try {
          localStorage.setItem("omnitactica_cached_spendable_glory", String(Number(data.spendable_glory ?? this.tcgState?.spendable_glory ?? 0)));
        } catch (_e) {}
        this.renderTcgVaultAll();
        const names = (data.pulled_cards || []).map((c) => `${c.player_name} (${c.faction} • ${c.elo})`).join(", ");
        this.showToast(`🎉 Pulled: ${names}`);
      } else {
        this.showToast(data?.error || "Insufficient Spendable Glory Honor — earn Glory Honor from tournaments & honors!");
      }
    } catch (err) {
      console.error("Failed to buy TCG pack:", err);
    }
  }

  async claimDailyGlory() {
    window.location.href = "/app#my-hub";
  }

  renderTcgBinderTab() {
    if (!this.tcgState) return;

    // 1. Multi-Faction Real Player Spotlight (e.g. Folger P Custodes + Folger P Necrons)
    const spotlightEl = document.getElementById("tcgMultiFactionSpotlight");
    if (spotlightEl) {
      const mfPlayers = this.tcgState.multi_faction_players || [];
      spotlightEl.innerHTML = mfPlayers.slice(0, 8).map((pGroup) => {
        const cardsHtml = (pGroup.cards || []).map((c) => {
          return `
            <span class="tmf-faction-chip ${c.owned ? "owned" : ""}">
              ${c.owned ? "✅" : "🔒"} ${this.escapeHtml(c.faction)} (${c.elo})
            </span>
          `;
        }).join("");
        return `
          <div class="tmf-player-group">
            <div class="tmf-pg-top">
              <span class="tmf-pg-name">👤 ${this.escapeHtml(pGroup.player_name)}</span>
              <span class="tmf-pg-elo">LIVE ELO ${pGroup.live_elo} • ${pGroup.owned_count}/${pGroup.total_factions} OWNED</span>
            </div>
            <div class="tmf-pg-factions">${cardsHtml}</div>
          </div>
        `;
      }).join("");
    }

    // 2. Full Card Binder Grid (Starter 28 + Collectible Real Player × Faction Pool)
    const binderGrid = document.getElementById("tcgBinderGrid");
    if (!binderGrid) return;

    const starters = (this.tcgState.starter_cards || []).slice();
    const collectibles = (this.tcgState.collectible_catalog || []).slice();
    const allCards = [...collectibles, ...starters];

    const searchQ = (document.getElementById("tcgBinderSearchInput")?.value || "").trim().toLowerCase();
    const filtered = allCards.filter((c) => {
      const rarity = this.resolveCardRarity(c);
      if (this.tcgBinderFilter === "owned" && !c.owned) return false;
      if (["starter", "mythic", "epic", "rare", "common"].includes(this.tcgBinderFilter) && rarity !== this.tcgBinderFilter) {
        return false;
      }
      if (searchQ) {
        const hay = `${c.name || ""} ${c.player_name || ""} ${c.faction || ""} ${c.detachment || ""} ${c.team_name || ""}`.toLowerCase();
        if (!hay.includes(searchQ)) return false;
      }
      return true;
    });

    binderGrid.innerHTML = filtered.map((card) => {
      const rarity = this.resolveCardRarity(card);
      const isOwned = Boolean(card.owned || card.is_starter);
      const svgHtml = getFactionSvgHtml(card.faction, "armory-faction-svg");
      const meta = resolveFactionMeta(card.faction);
      const detLabel = card.detachment || meta.detachment || "Strike Force";
      const statusBadge = isOwned
        ? `<span class="tpc-action-pill in-deck-pill">✓ OWNED${card.copies > 1 ? ` ×${card.copies}` : ""}</span>`
        : `<span class="tpc-action-pill locked-pill">🔒 LOCKED</span>`;

      return `
        <div class="tcg-picker-card rarity-${rarity} ${isOwned ? "" : "locked-card"}" data-binder-card-id="${this.escapeHtml(card.card_id)}">
          <div class="tpc-body">
            <div class="tpc-sigil">${svgHtml}</div>
            <div class="tpc-info">
              <div class="tpc-name">${this.escapeHtml(card.is_starter ? card.faction : (card.player_name || card.name))}</div>
              <div class="tpc-sub">${this.escapeHtml(card.is_starter ? detLabel : `${card.faction} • ${detLabel}`)}</div>
            </div>
          </div>
          <div class="tpc-foot">
            <span class="tpc-elo">ELO <strong>${card.elo}</strong></span>
            <div class="tpc-foot-right">
              <span class="tpc-RARITY ${rarity}">${card.is_starter ? "STARTER" : String(rarity).toUpperCase()}</span>
              ${statusBadge}
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  async deployTcgDeckToRoom(mode = "saved_deck", { enterArena = false } = {}) {
    if (!this.roomCode) return;
    const role = this.activeRole === "spectator" ? "captain_a" : this.activeRole;
    const fmt = this.getActiveTcgFormat();
    const tok = this.captainTokens[role] || this.loadRoomTokenFromStorage(this.roomCode, role);

    try {
      const resp = await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          user_id: this.userId,
          captain_token: tok,
          action: "apply_tcg_deck",
          payload: {
            format_size: fmt,
            mode,
            also_set_ai_tcg: true
          }
        })
      });
      const data = await resp.json();
      if (data && (data.ok || data.success) && data.room) {
        this.room = data.room;
        this.syncLobbyDraftFromRoom();
        this.renderLobbyDeckBuilder();
        this.renderAll();
        this.closeTcgVaultModal();
        if (enterArena) {
          this.closeLobbyModal();
          if (!this.room.coin_flip_done && this.room.phase !== "COMPLETED") {
            this.openCoinFlipModal();
          }
        }
        const rosterA = this.room?.team_a?.roster || [];
        const rosterB = this.room?.team_b?.roster || [];
        const avgA = rosterA.length ? Math.round(rosterA.reduce((s, p) => s + (Number(p.elo) || 1500), 0) / rosterA.length) : 0;
        const avgB = rosterB.length ? Math.round(rosterB.reduce((s, p) => s + (Number(p.elo) || 1500), 0) / rosterB.length) : 0;
        const eloSuffix = (this.room?.vs_ai && avgA > 0 && avgB > 0)
          ? ` (Avg ${avgA} Elo vs AI Avg ${avgB} Elo)`
          : "";
        const label = mode === "starter"
          ? `🛡️ Starter Deck Equipped${eloSuffix}!`
          : `🃏 TCG Deck Equipped${eloSuffix}!`;
        this.showToast(label);
      }
    } catch (err) {
      console.error("Failed to deploy TCG deck to room:", err);
    }
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

  // =========================================================================
  // Live Floor Judge Dispatch Modal (Identical to /11th/tracker/play)
  // =========================================================================
  getTournamentId() {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get("event_id") ||
      params.get("tournament_id") ||
      (this.room && (this.room.event_id || this.room.tournament_id)) ||
      this.roomCode ||
      "WTC_TEAM_EVENT"
    );
  }

  getTableNum() {
    const params = new URLSearchParams(window.location.search);
    return params.get("table") || params.get("table_num") || (this.room && this.room.table_num) || "1";
  }

  updateJudgeButtonsUI() {
    const c = this.activeJudgeCall;
    const topBtn = document.getElementById("btnTopbarJudge");
    const dockBtn = document.getElementById("btnDockJudge");
    const dockIcon = document.getElementById("dockJudgeIcon");
    const dockLbl = document.getElementById("dockJudgeLabel");

    let topHtml = "🙋‍♂️ Call Judge";
    let dIcon = "🙋‍♂️";
    let dLbl = "Judge";
    let stateClass = "";

    if (c && c.status === "en_route") {
      const jName = (c.assignedJudge && c.assignedJudge.name) || c.assigned_judge || "Judge";
      topHtml = `🏃‍♂️ ${this.escapeHtml(jName)} En Route!`;
      dIcon = "🏃‍♂️";
      dLbl = "En Route";
      stateClass = "en-route";
    } else if (c && c.status === "pending") {
      topHtml = "🚨 Judge Pending";
      dIcon = "🚨";
      dLbl = "Pending";
      stateClass = "pending";
    } else if (c && c.status === "resolved") {
      topHtml = "✅ Judge Resolved";
      dIcon = "✅";
      dLbl = "Resolved";
      stateClass = "resolved";
    }

    if (topBtn) {
      topBtn.innerHTML = topHtml;
      topBtn.classList.remove("pending", "en-route", "resolved");
      if (stateClass) topBtn.classList.add(stateClass);
    }
    if (dockBtn) {
      dockBtn.classList.remove("pending", "en-route", "resolved");
      if (stateClass) dockBtn.classList.add(stateClass);
    }
    if (dockIcon) dockIcon.textContent = dIcon;
    if (dockLbl) dockLbl.textContent = dLbl;
  }

  openJudgeModal() {
    if (this.activeJudgeCall && (this.activeJudgeCall.status === "resolved" || this.activeJudgeCall.status === "cancelled")) {
      this.activeJudgeCall = null;
    }
    let modal = document.getElementById("gt-judge-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "gt-judge-modal";
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.closeJudgeModal();
      });
      document.body.appendChild(modal);
    }
    modal.style.display = "flex";
    this.renderJudgeModal();
  }

  closeJudgeModal() {
    const modal = document.getElementById("gt-judge-modal");
    if (modal) modal.style.display = "none";
  }

  selectJudgeCategory(el, cat) {
    this.selectedJudgeCategory = cat;
    document.querySelectorAll("#gt-judge-modal .gt-issue-option").forEach((o) => o.classList.remove("selected"));
    if (el) el.classList.add("selected");
  }

  renderJudgeModal() {
    const modal = document.getElementById("gt-judge-modal");
    if (!modal) return;

    const tournamentId = this.getTournamentId();
    const tableNum = this.getTableNum();
    const myTeamName =
      this.activeRole === "captain_b"
        ? (this.room?.team_b?.name || "Team B Captain")
        : (this.room?.team_a?.name || "Team A Captain");
    const myName = this.userName || myTeamName;

    if (this.activeJudgeCall) {
      const c = this.activeJudgeCall;
      const isEnRoute = c.status === "en_route";
      const isResolved = c.status === "resolved";

      let statusIcon = "🚨";
      let statusTitle = "Judge Call Dispatched";
      let statusSub = `Table #${c.table_num || tableNum} • Issue: <b style="color:#f43f5e;">${this.escapeHtml(c.category || "Dispute")}</b>`;
      let statusDesc = "The Tournament Director and Floor Judges have been notified and will respond shortly.";

      if (isEnRoute) {
        statusIcon = "🏃‍♂️";
        statusTitle = "Floor Judge Is On The Way!";
        statusDesc = c.assigned_judge
          ? `Judge <b style="color:#38bdf8;">${this.escapeHtml(c.assigned_judge)}</b> has taken the call and is en route to Table #${c.table_num || tableNum}.`
          : `A floor judge has answered your call and is walking to Table #${c.table_num || tableNum} now.`;
      } else if (isResolved) {
        statusIcon = "✅";
        statusTitle = "Judge Call Resolved";
        statusDesc = c.assigned_judge
          ? `Resolved by ${this.escapeHtml(c.assigned_judge)}.`
          : "This request has been marked as resolved.";
      }

      modal.innerHTML = `
        <div class="gt-judge-dialog" style="max-width:440px; width:100%; background:#0f172a; border:1px solid #334155; border-radius:14px; box-shadow:0 20px 50px rgba(0,0,0,0.85); overflow:hidden; font-family:'Inter',system-ui,sans-serif;">
          <div class="gt-judge-header" style="background:#1e293b; padding:12px 18px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #334155;">
            <h3 style="margin:0; font-size:1.1rem; color:#fff; display:flex; align-items:center; gap:8px;">
              <span>🚨 Live Floor Judge Dispatch</span>
            </h3>
            <button type="button" onclick="window.gtCloseJudgeModal()" style="background:transparent; border:none; color:#94a3b8; font-size:20px; cursor:pointer;">✕</button>
          </div>
          <div class="gt-judge-body" style="text-align:center; padding:1.75rem 1.5rem;">
            <div style="font-size:3rem; margin-bottom:10px;">
              ${statusIcon}
            </div>
            <h4 style="color:#fff; margin:0 0 6px; font-size:1.25rem; font-weight:800;">
              ${statusTitle}
            </h4>
            <p style="color:#94a3b8; font-size:13px; margin:0 0 10px; line-height:1.5;">
              ${statusSub}
            </p>
            <p style="color:#cbd5e1; font-size:12px; margin:0 0 18px; line-height:1.5; background:rgba(15,23,42,0.6); border:1px solid rgba(51,65,85,0.6); padding:10px 14px; border-radius:8px;">
              ${statusDesc}
            </p>
            <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
              <button type="button" onclick="window.gtCloseJudgeModal()" style="background:#0284c7; color:#fff; border:none; padding:8px 18px; border-radius:8px; font-weight:700; font-size:12px; cursor:pointer;">
                Return to Game
              </button>
              <button type="button" onclick="window.gtCancelJudgeCall()" style="background:#450a0a; color:#fca5a5; border:1px solid #991b1b; padding:8px 14px; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer;">
                Cancel Request
              </button>
            </div>
          </div>
        </div>
      `;
      return;
    }

    const cats = [
      { id: "Rules / Pairing Dispute", icon: "📜", title: "Rules / Pairing Step Dispute", desc: "Defender/Attacker lock question, matchup sequencing, table assignment" },
      { id: "Clock / Timing Issue", icon: "⏱️", title: "Pairing Clock / Timing Adjudication", desc: "Captain pairing clock delay, round stoppage, late roster submission" },
      { id: "Measurement / Line of Sight", icon: "📏", title: "Table Layout / Terrain Ruling", desc: "WTC terrain map assignment, deployment zone or ruin visibility ruling" },
      { id: "Scorecard Correction", icon: "📝", title: "Roster / Misclick Correction", desc: "Wrong card locked by mistake, captain seat or player swap request" }
    ];

    modal.innerHTML = `
      <div class="gt-judge-dialog" style="max-width:480px; width:100%; background:#0f172a; border:1px solid #334155; border-radius:14px; box-shadow:0 20px 50px rgba(0,0,0,0.85); overflow:hidden; font-family:'Inter',system-ui,sans-serif;">
        <div class="gt-judge-header" style="background:#1e293b; padding:12px 18px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #334155;">
          <h3 style="margin:0; font-size:1.05rem; color:#fff; display:flex; align-items:center; gap:8px;">
            <span>🙋‍♂️ Call Tournament Director / Floor Judge</span>
          </h3>
          <button type="button" onclick="window.gtCloseJudgeModal()" style="background:transparent; border:none; color:#94a3b8; font-size:20px; cursor:pointer;">✕</button>
        </div>
        <div class="gt-judge-body" style="padding:16px 20px;">
          <p style="color:#94a3b8; font-size:12px; margin:0 0 14px; line-height:1.5;">
            Need a pairing step clarification, clock ruling, or misclick correction? Submit this request to alert the floor judges immediately.
          </p>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
            <div>
              <label style="display:block; font-size:11px; font-weight:700; color:#94a3b8; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.05em;">Table / Pod #</label>
              <input type="number" id="gt-judge-table" value="${this.escapeHtml(tableNum)}" style="width:100%; box-sizing:border-box; background:#070b14; border:1px solid #334155; color:#fff; padding:8px 12px; border-radius:8px; font-family:'JetBrains Mono',monospace; font-weight:800; font-size:14px;" />
            </div>
            <div>
              <label style="display:block; font-size:11px; font-weight:700; color:#94a3b8; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.05em;">Calling Captain</label>
              <input type="text" id="gt-judge-name" value="${this.escapeHtml(myName)}" style="width:100%; box-sizing:border-box; background:#070b14; border:1px solid #334155; color:#fff; padding:8px 12px; border-radius:8px; font-size:13px;" />
            </div>
          </div>

          <label style="display:block; font-size:11px; font-weight:700; color:#94a3b8; margin-bottom:6px; text-transform:uppercase; letter-spacing:0.05em;">Issue Category</label>
          <div id="gt-judge-categories" style="margin-bottom:14px; display:flex; flex-direction:column; gap:6px;">
            ${cats.map((c) => `
              <div class="gt-issue-option ${this.selectedJudgeCategory === c.id ? "selected" : ""}" onclick="window.gtSelectCategory(this, '${c.id}')">
                <span style="font-size:16px;">${c.icon}</span>
                <div>
                  <b style="font-size:12px; color:#fff;">${this.escapeHtml(c.title)}</b>
                  <div style="font-size:10px; color:#94a3b8;">${this.escapeHtml(c.desc)}</div>
                </div>
              </div>
            `).join("")}
          </div>

          <label style="display:block; font-size:11px; font-weight:700; color:#94a3b8; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.05em;">Optional Brief Note</label>
          <textarea id="gt-judge-note" placeholder="E.g. Cycle 1 Step 2 attacker selection misclick or table terrain map question..." style="width:100%; box-sizing:border-box; height:55px; background:#070b14; border:1px solid #334155; color:#fff; padding:8px 12px; border-radius:8px; font-size:12px; margin-bottom:16px; resize:none; font-family:inherit;"></textarea>

          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button type="button" onclick="window.gtCloseJudgeModal()" style="background:#1e293b; color:#94a3b8; border:1px solid #334155; padding:8px 16px; border-radius:8px; font-weight:700; font-size:12px; cursor:pointer;">
              Cancel
            </button>
            <button type="button" id="gt-btn-dispatch-judge" onclick="window.gtSubmitJudgeCall('${this.escapeHtml(tournamentId)}')" style="background:linear-gradient(135deg, #e11d48, #be123c); color:#fff; border:none; padding:8px 20px; border-radius:8px; font-weight:800; font-size:12px; cursor:pointer; box-shadow:0 4px 14px rgba(225,29,72,0.4);">
              🚨 Dispatch Judge to Table
            </button>
          </div>
        </div>
      </div>
    `;
  }

  async submitJudgeCall(paramTournamentId) {
    const tableEl = document.getElementById("gt-judge-table");
    const nameEl = document.getElementById("gt-judge-name");
    const noteEl = document.getElementById("gt-judge-note");
    const btn = document.getElementById("gt-btn-dispatch-judge");

    const tournamentId = paramTournamentId || this.getTournamentId();
    const tableNum = parseInt(tableEl ? tableEl.value : this.getTableNum(), 10) || 1;
    const playerName = (nameEl && nameEl.value.trim()) || this.userName || "Team Captain";
    const opponentName =
      this.activeRole === "captain_b"
        ? (this.room?.team_a?.name || "Team A")
        : (this.room?.team_b?.name || "Team B");
    const note = noteEl ? noteEl.value.trim() : "";

    if (btn) {
      btn.disabled = true;
      btn.textContent = "🚨 Dispatching...";
    }

    const callId = "call_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    const callData = {
      id: callId,
      call_id: callId,
      callId: callId,
      eventId: tournamentId,
      event_id: tournamentId,
      tableNum: tableNum,
      table_num: tableNum,
      tableNumber: tableNum,
      table: tableNum,
      matchId: this.roomCode || "",
      match_id: this.roomCode || "",
      playerName: playerName,
      player_name: playerName,
      caller: playerName,
      callerName: playerName,
      opponent: opponentName,
      category: this.selectedJudgeCategory,
      note: note,
      notes: note,
      status: "pending",
      createdAt: Date.now(),
      created_at: Date.now()
    };

    try {
      const resp = await fetch("/api/eventstudio/judge_call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(callData)
      });
      if (resp.ok) {
        const data = await resp.json();
        this.activeJudgeCall = (data && data.call) ? data.call : callData;
      } else {
        this.activeJudgeCall = callData;
      }
    } catch (_) {
      this.activeJudgeCall = callData;
    } finally {
      this.updateJudgeButtonsUI();
      this.renderJudgeModal();
      this.showToast(`🚨 Floor Judge dispatched to Table #${tableNum}!`);
    }
  }

  async cancelJudgeCall() {
    const call = this.activeJudgeCall;
    if (!call) return;
    const tournamentId = this.getTournamentId();
    const callId = call.call_id || call.id || call.callId;
    try {
      await fetch("/api/eventstudio/judge_call/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_id: callId,
          status: "cancelled",
          event_id: tournamentId,
          match_id: this.roomCode
        })
      });
    } catch (_) {}
    this.activeJudgeCall = null;
    this.updateJudgeButtonsUI();
    this.renderJudgeModal();
    this.showToast("Judge call cancelled.");
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

