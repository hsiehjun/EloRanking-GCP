/**
 * Event Studio | Tournament Director & BCP Organizer Suite (v15.0)
 * Comprehensive tournament directorship: creation, Swiss pairings, live rosters,
 * scorecards, tiebreakers, and Best Coast Pairings bidirectional sync.
 */

let studioState = {
  activeTab: "events",
  eventsList: [],
  activeTournament: null,
  activeSubtab: "roster",
  currentRoundView: 1,
  timerSeconds: 9000,
  timerInterval: null,
  isTimerRunning: false
};

document.addEventListener("DOMContentLoaded", () => {
  initStudio();
});

function getBcpToken() {
  return localStorage.getItem("bcp_jwt") || 
         localStorage.getItem("bcp_token") || 
         localStorage.getItem("bcp_organizer_token") || 
         localStorage.getItem("bcp_user_token") || 
         localStorage.getItem("auth_token") || "";
}

async function initStudio() {
  updateStudioAuthBadge();
  setDefaultEventDates();
  await loadStudioEvents();
}

function setDefaultEventDates() {
  const today = new Date().toISOString().split("T")[0];
  const startInput = document.getElementById("create-event-start-date");
  const endInput = document.getElementById("create-event-end-date");
  if (startInput && !startInput.value) startInput.value = today;
  if (endInput && !endInput.value) endInput.value = today;
}

function updateStudioAuthBadge() {
  const banner = document.getElementById("es-bcp-account-banner");
  const dot = document.getElementById("es-bcp-status-dot");
  const statusText = document.getElementById("es-bcp-status-text");
  
  let user = typeof currentUser !== "undefined" ? currentUser : null;
  if (!user) {
    try {
      const cached = localStorage.getItem("native_user_profile") || localStorage.getItem("bcp_user_profile");
      if (cached) user = JSON.parse(cached);
    } catch(e) {}
  }

  if (statusText) {
    if (user && (user.bcp_connected || user.bcp_user_id || user.bcp_email)) {
      const email = user.bcp_email || user.email || user.display_name || "Organizer";
      if (banner) {
        banner.style.background = "rgba(16, 185, 129, 0.08)";
        banner.style.borderColor = "rgba(16, 185, 129, 0.25)";
      }
      if (dot) {
        dot.style.background = "#10b981";
        dot.style.boxShadow = "0 0 8px #10b981";
      }
      statusText.innerHTML = `Connected to Best Coast Pairings as <strong style="color: #10b981;">${escapeHtml(email)}</strong>`;
    } else if (user) {
      if (banner) {
        banner.style.background = "rgba(245, 158, 11, 0.08)";
        banner.style.borderColor = "rgba(245, 158, 11, 0.25)";
      }
      if (dot) {
        dot.style.background = "#f59e0b";
        dot.style.boxShadow = "none";
      }
      statusText.innerHTML = `Signed in as <strong style="color: #38bdf8;">${escapeHtml(user.display_name || user.email)}</strong> — <a href="javascript:void(0)" onclick="openBcpLinkModal()" style="color: #f59e0b; text-decoration: underline; font-weight: 600;">Link BCP Account</a> to sync your official tournaments`;
    } else {
      if (banner) {
        banner.style.background = "rgba(56, 189, 248, 0.05)";
        banner.style.borderColor = "rgba(56, 189, 248, 0.2)";
      }
      if (dot) {
        dot.style.background = "#94a3b8";
        dot.style.boxShadow = "none";
      }
      statusText.innerHTML = `<span style="color: #94a3b8;">Guest Mode</span> — <a href="/login" style="color: #38bdf8; text-decoration: underline; font-weight: 600;">Sign in & Link BCP</a> to manage and publish live tournaments`;
    }
  }
}

async function loadStudioEvents() {
  try {
    const res = await window.api.getStudioEvents();
    studioState.eventsList = (res && Array.isArray(res.events)) ? res.events : [];
    
    const countEl = document.getElementById("es-events-count");
    if (countEl) countEl.textContent = studioState.eventsList.length;

    renderEventsDirectory();
  } catch (err) {
    console.warn("Notice loading studio events:", err);
    studioState.eventsList = [];
    renderEventsDirectory();
  }
}

function switchStudioTab(tabName, eventId = null) {
  if (typeof switchTab === 'function') switchTab('event-studio');
  studioState.activeTab = tabName || 'events';
  const views = ["events", "create", "manage"];

  views.forEach(v => {
    const el = document.getElementById(`es-view-${v}`);
    if (el) {
      el.style.display = (v === studioState.activeTab) ? "block" : "none";
    }
  });

  if (studioState.activeTab === "events") {
    renderEventsDirectory();
  } else if (studioState.activeTab === "manage" && eventId) {
    loadTournamentWorkspace(eventId);
  }
}

function renderEventsDirectory() {
  const containers = document.querySelectorAll("#es-events-list, .es-events-grid");
  if (!containers || containers.length === 0) return;

  const events = studioState.eventsList || [];
  const countEls = document.querySelectorAll("#es-events-count");
  countEls.forEach(el => { el.textContent = events.length; });

  let contentHtml = '';
  if (events.length === 0) {
    contentHtml = `
      <div style="grid-column: 1 / -1; background: var(--bg-card); border: 1px dashed var(--border); border-radius: var(--radius-lg); padding: 3.5rem 1.5rem; text-align: center;">
        <div style="font-size: 2.8rem; margin-bottom: 0.75rem;">⚔️</div>
        <h3 style="color: #fff; margin: 0 0 0.5rem; font-size: 1.3rem;">No Tournaments Directing Yet</h3>
        <p style="color: var(--text-secondary); font-size: 0.9rem; max-width: 520px; margin: 0 auto; line-height: 1.6;">
          Create a new tournament to publish listings to Best Coast Pairings and manage player registrations.
        </p>
        <button class="btn btn-primary" style="margin-top: 1rem;" onclick="switchStudioTab('create')">➕ Create Tournament</button>
      </div>
    `;
  } else {
    contentHtml = events.map(ev => {
      const rounds = ev.num_rounds || ev.rounds || 5;
      const tier = ev.tier || "Grand Tournament";
      const roster = ev.roster || [];
      const location = [ev.venue, ev.city, ev.state].filter(Boolean).join(", ") || "Local Venue";
      const dateStr = ev.event_date ? (String(ev.event_date).split("T")[0]) : "Date TBD";
      const isBcp = ev.id && !ev.id.startsWith("ES-");
      const bcpUrl = isBcp ? `https://www.bestcoastpairings.com/event/${encodeURIComponent(ev.id)}` : "#";

      return `
        <div class="es-event-card" data-event-id="${escapeHtml(ev.id)}" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.35rem; display: flex; flex-direction: column; justify-content: space-between; gap: 1rem; transition: transform 0.2s ease, border-color 0.2s ease;">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
              <span class="badge badge-accent" style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase;">${escapeHtml(tier)}</span>
              ${isBcp ? '<span class="badge badge-online" style="font-size: 0.7rem;">BCP SYNCED</span>' : '<span class="badge" style="font-size: 0.7rem; background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3);">LOCAL</span>'}
            </div>
            <h4 style="margin: 0 0 0.4rem; color: #fff; font-size: 1.15rem; font-family: var(--font-heading); cursor: pointer;" onclick="switchStudioTab('manage', '${escapeHtml(ev.id)}')">${escapeHtml(ev.name)}</h4>
            <div style="font-size: 0.8rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 0.25rem;">
              <div>📅 ${escapeHtml(dateStr)} • 📍 ${escapeHtml(location)}</div>
              <div>👥 <b>${roster.length} / ${ev.capacity || 32}</b> Players • 🎲 <b>${rounds}</b> Rounds (${ev.points || 2000} pts)</div>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border); padding-top: 0.85rem; margin-top: 0.25rem; gap: 0.5rem; flex-wrap: wrap;">
            <button class="btn btn-primary" style="font-size: 0.78rem; padding: 0.35rem 0.85rem;" onclick="switchStudioTab('manage', '${escapeHtml(ev.id)}')">👑 Direct Event</button>
            <div style="display: flex; gap: 0.35rem; align-items: center;">
              ${isBcp ? `<a href="${bcpUrl}" target="_blank" class="btn btn-outline" style="font-size: 0.75rem; padding: 0.3rem 0.6rem; text-decoration: none;">🔗 BCP</a>` : ''}
              <button class="btn btn-outline" style="font-size: 0.75rem; padding: 0.3rem 0.6rem; color: #ef4444; border-color: rgba(239,68,68,0.35);" onclick="deleteStudioTournament('${escapeHtml(ev.id)}')">🗑️</button>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  containers.forEach(c => {
    c.innerHTML = contentHtml;
  });
}

async function submitCreateTournament() {
  const nameInput = document.getElementById("create-event-name");
  const gameSystemInput = document.getElementById("create-event-game-system");
  const formatInput = document.getElementById("create-event-format");
  const pairingStyleInput = document.getElementById("create-event-pairing-style");
  const roundsInput = document.getElementById("create-event-rounds");
  const roundLengthInput = document.getElementById("create-event-round-length");
  const startInput = document.getElementById("create-event-start-date");
  const endInput = document.getElementById("create-event-end-date");
  const capacityInput = document.getElementById("create-event-capacity");
  const pointsInput = document.getElementById("create-event-points");
  const venueInput = document.getElementById("create-event-venue");
  const cityStateInput = document.getElementById("create-event-city-state");
  const hideListsInput = document.getElementById("create-event-hide-lists");
  const requireListsInput = document.getElementById("create-event-require-lists");
  const passwordlessInput = document.getElementById("create-event-passwordless");
  const hidePlacingsInput = document.getElementById("create-event-hide-placings");

  const btn = document.getElementById("btn-submit-create-event");
  const status = document.getElementById("create-event-status");

  const name = nameInput ? nameInput.value.trim() : "";
  if (!name) {
    alert("Please enter a tournament name.");
    if (nameInput) nameInput.focus();
    return;
  }

  const payload = {
    name: name,
    game_system_id: gameSystemInput ? gameSystemInput.value : "WGMSzfKFYA",
    tier: formatInput ? formatInput.value : "Grand Tournament",
    pairing_style: pairingStyleInput ? pairingStyleInput.value : "swiss",
    rounds: roundsInput ? parseInt(roundsInput.value, 10) : 5,
    default_round_length: roundLengthInput ? parseInt(roundLengthInput.value, 10) : 9000,
    start_date: startInput ? startInput.value : "",
    end_date: endInput ? endInput.value : (startInput ? startInput.value : ""),
    capacity: capacityInput ? parseInt(capacityInput.value, 10) : 32,
    points: pointsInput ? parseInt(pointsInput.value, 10) : 2000,
    venue: venueInput ? venueInput.value.trim() : "",
    city: cityStateInput ? cityStateInput.value.trim() : "",
    hide_lists: hideListsInput ? hideListsInput.checked : true,
    require_lists: requireListsInput ? requireListsInput.checked : true,
    passwordless_scoring: passwordlessInput ? passwordlessInput.checked : true,
    hide_placings: hidePlacingsInput ? hidePlacingsInput.checked : false,
    bcp_token: getBcpToken()
  };

  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Creating & Registering...";
  }
  if (status) {
    status.style.display = "block";
    status.textContent = "Creating tournament and registering listing on Best Coast Pairings...";
  }

  try {
    const res = await window.api.createStudioEvent(payload);
    if (res && res.success) {
      const eventId = res.event_id || res.event?.id;
      const newEvent = res.event || {
        id: eventId,
        name: payload.name,
        tier: payload.tier,
        num_rounds: payload.rounds,
        capacity: payload.capacity,
        points: payload.points,
        venue: payload.venue,
        city: payload.city,
        event_date: payload.start_date
      };

      // Optimistically add and re-render without requiring reload
      studioState.eventsList = [newEvent, ...(studioState.eventsList || []).filter(e => e.id !== eventId)];
      renderEventsDirectory();

      if (typeof loadTournaments === 'function') {
        try { loadTournaments(); } catch(e) {}
      }

      if (res.bcp_registered) {
        alert(`🎉 Tournament "${name}" successfully created and registered on Best Coast Pairings!`);
      } else {
        alert(`🎉 Tournament "${name}" created in Event Studio!`);
      }
      if (nameInput) nameInput.value = "";
      if (venueInput) venueInput.value = "";
      if (cityStateInput) cityStateInput.value = "";
      
      switchStudioTab("manage", eventId);
    } else {
      alert(res.message || res.detail || "Failed to create tournament.");
    }
  } catch (err) {
    console.error("Error creating tournament:", err);
    alert(`Creation failed: ${err.message || err}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🚀 Create & Register on BCP";
    }
    if (status) status.style.display = "none";
  }
}

/* ==========================================================================
   TOURNAMENT DIRECTOR WORKSPACE (MANAGE EVENT)
   ========================================================================== */

async function loadTournamentWorkspace(eventId) {
  try {
    const res = await window.api.getStudioEvent(eventId);
    const ev = (res && res.event) ? res.event : res;
    if (!ev || !ev.id) {
      alert("Could not load tournament details.");
      switchStudioTab("events");
      return;
    }

    studioState.activeTournament = ev;
    studioState.currentRoundView = ev.current_round || 1;

    // Header population
    const nameEl = document.getElementById("manage-event-name");
    const tierBadge = document.getElementById("manage-event-tier-badge");
    const bcpBadge = document.getElementById("manage-event-bcp-badge");
    const dateEl = document.getElementById("manage-event-date");
    const locEl = document.getElementById("manage-event-location");
    const roundsPtsEl = document.getElementById("manage-event-rounds-pts");
    const bcpLink = document.getElementById("manage-event-bcp-link");
    const rosterCountEl = document.getElementById("manage-roster-count");

    if (nameEl) nameEl.textContent = ev.name || "Tournament";
    if (tierBadge) tierBadge.textContent = (ev.tier || "Grand Tournament").toUpperCase();
    
    const isBcp = ev.id && !ev.id.startsWith("ES-");
    if (bcpBadge) {
      bcpBadge.style.display = isBcp ? "inline-block" : "none";
    }
    if (bcpLink) {
      bcpLink.style.display = isBcp ? "inline-flex" : "none";
      bcpLink.href = `https://www.bestcoastpairings.com/event/${encodeURIComponent(ev.id)}`;
    }

    const dateStr = ev.event_date ? (String(ev.event_date).split("T")[0]) : "Date TBD";
    const locStr = [ev.venue, ev.city, ev.state].filter(Boolean).join(", ") || "Local Venue";
    const rounds = ev.num_rounds || ev.rounds || 5;
    const pts = ev.points || 2000;

    if (dateEl) dateEl.textContent = dateStr;
    if (locEl) locEl.textContent = locStr;
    if (roundsPtsEl) roundsPtsEl.textContent = `${rounds} Rounds (${pts} pts)`;

    const roster = ev.roster || [];
    if (rosterCountEl) rosterCountEl.textContent = roster.length;

    // Set default timer
    studioState.timerSeconds = ev.defaultRoundLength || 9000;
    updateTimerDisplay();

    switchManageSubtab(studioState.activeSubtab || "roster");
  } catch (err) {
    console.error("Error loading tournament workspace:", err);
    alert(`Failed to load event: ${err.message || err}`);
  }
}

function switchManageSubtab(subtabName) {
  studioState.activeSubtab = subtabName;
  const subtabs = ["roster", "pairings", "standings", "meta"];

  subtabs.forEach(tab => {
    const viewEl = document.getElementById(`manage-subtab-${tab}`);
    const btnEl = document.getElementById(`btn-subtab-${tab}`);
    if (viewEl) viewEl.style.display = (tab === subtabName) ? "block" : "none";
    if (btnEl) {
      if (tab === subtabName) btnEl.classList.add("active");
      else btnEl.classList.remove("active");
    }
  });

  const ev = studioState.activeTournament;
  if (!ev) return;

  if (subtabName === "roster") renderRosterSubtab();
  else if (subtabName === "pairings") renderPairingsSubtab();
  else if (subtabName === "standings") renderStandingsSubtab();
  else if (subtabName === "meta") renderMetaSubtab();
}

function renderRosterSubtab() {
  const ev = studioState.activeTournament;
  const tbody = document.getElementById("manage-roster-tbody");
  if (!tbody || !ev) return;

  const roster = ev.roster || [];
  const countEl = document.getElementById("manage-roster-count");
  if (countEl) countEl.textContent = roster.length;

  if (roster.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="padding: 2.5rem; text-align: center; color: var(--text-muted);">
          No competitors registered yet. Click <strong>"➕ Add Competitor"</strong> to register players.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = roster.map((p, idx) => {
    const pid = p.id || p.player_id || p.name || `P-${idx}`;
    const name = p.name || "Player";
    const faction = p.faction || "Unknown Faction";
    const team = p.team || p.club || "-";
    const isCheckedIn = !!p.checked_in;
    const isDropped = !!p.dropped;

    let statusBadge = isDropped 
      ? '<span class="badge" style="background: rgba(239,68,68,0.2); color: #ef4444; border: 1px solid rgba(239,68,68,0.4);">DROPPED</span>'
      : (isCheckedIn 
          ? '<span class="badge badge-online">CHECKED IN</span>' 
          : '<span class="badge" style="background: rgba(245,158,11,0.2); color: #f59e0b; border: 1px solid rgba(245,158,11,0.4);">REGISTERED</span>');

    return `
      <tr style="border-bottom: 1px solid var(--border); transition: background 0.15s ease;">
        <td style="padding: 0.85rem 1rem;">
          <div style="font-weight: 600; color: #fff;">${escapeHtml(name)}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono);">${escapeHtml(pid)}</div>
        </td>
        <td style="padding: 0.85rem 1rem;">
          <span style="color: #38bdf8; font-weight: 500;">${escapeHtml(faction)}</span>
        </td>
        <td style="padding: 0.85rem 1rem; color: var(--text-secondary);">${escapeHtml(team)}</td>
        <td style="padding: 0.85rem 1rem;">${statusBadge}</td>
        <td style="padding: 0.85rem 1rem; text-align: right;">
          <div style="display: inline-flex; gap: 0.35rem;">
            <button class="btn btn-outline" style="font-size: 0.72rem; padding: 0.25rem 0.5rem;" onclick="toggleCheckIn('${escapeHtml(pid)}')">
              ${isCheckedIn ? 'Uncheck' : 'Check In'}
            </button>
            <button class="btn btn-outline" style="font-size: 0.72rem; padding: 0.25rem 0.5rem; color: ${isDropped ? '#10b981' : '#f59e0b'};" onclick="toggleDropPlayer('${escapeHtml(pid)}')">
              ${isDropped ? 'Undrop' : 'Drop'}
            </button>
            <button class="btn btn-outline" style="font-size: 0.72rem; padding: 0.25rem 0.5rem; color: #ef4444;" onclick="removePlayer('${escapeHtml(pid)}')">
              ✕
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderPairingsSubtab() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const totalRounds = ev.num_rounds || ev.rounds || 5;
  const currentRound = studioState.currentRoundView || ev.current_round || 1;

  // Render Round Pills
  const pillsContainer = document.getElementById("manage-round-pills");
  if (pillsContainer) {
    let html = '';
    for (let r = 1; r <= totalRounds; r++) {
      const active = (r === currentRound) ? 'btn-primary' : 'btn-outline';
      html += `<button class="btn ${active}" style="font-size: 0.78rem; padding: 0.35rem 0.75rem;" onclick="selectRoundView(${r})">Round ${r}</button>`;
    }
    pillsContainer.innerHTML = html;
  }

  // Render Matchups for current round
  const pairingsContainer = document.getElementById("manage-pairings-list");
  if (!pairingsContainer) return;

  const pairingsMap = ev.pairings || {};
  const roundPairings = pairingsMap[String(currentRound)] || [];

  if (roundPairings.length === 0) {
    pairingsContainer.innerHTML = `
      <div style="grid-column: 1 / -1; background: var(--bg-card); border: 1px dashed var(--border); border-radius: var(--radius-lg); padding: 3rem 1.5rem; text-align: center; color: var(--text-muted);">
        No pairings generated for Round ${currentRound} yet. Click <strong>"🎲 Generate Swiss Pairings"</strong> to create table matchups.
      </div>
    `;
    return;
  }

  pairingsContainer.innerHTML = roundPairings.map(match => {
    const table = match.table || 1;
    const p1Name = match.p1_name || "Player 1";
    const p1Fac = match.p1_faction || "";
    const p1Score = match.p1_score || 0;

    const p2Name = match.p2_name || (match.is_bye ? "BYE" : "Player 2");
    const p2Fac = match.p2_faction || "";
    const p2Score = match.p2_score || 0;
    const isBye = !!match.is_bye;

    return `
      <div class="es-match-card" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.15rem; display: flex; flex-direction: column; gap: 0.85rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem;">
          <span style="font-weight: 700; font-family: var(--font-heading); color: #38bdf8;">TABLE ${table}</span>
          ${isBye ? '<span class="badge badge-accent">BYE</span>' : '<span style="font-size: 0.75rem; color: var(--text-muted);">Swiss Match</span>'}
        </div>

        <!-- Competitor 1 -->
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 600; color: #fff;">${escapeHtml(p1Name)}</div>
            <div style="font-size: 0.75rem; color: #38bdf8;">${escapeHtml(p1Fac)}</div>
          </div>
          <input type="number" id="score-p1-${table}" class="form-input" value="${p1Score}" min="0" max="100" style="width: 70px; text-align: center; font-weight: 700; font-size: 1.05rem;" ${isBye ? 'disabled' : ''}>
        </div>

        <div style="text-align: center; color: var(--text-muted); font-size: 0.75rem; font-weight: 700;">VS</div>

        <!-- Competitor 2 -->
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 600; color: ${isBye ? 'var(--text-muted)' : '#fff'};">${escapeHtml(p2Name)}</div>
            <div style="font-size: 0.75rem; color: #38bdf8;">${escapeHtml(p2Fac)}</div>
          </div>
          <input type="number" id="score-p2-${table}" class="form-input" value="${p2Score}" min="0" max="100" style="width: 70px; text-align: center; font-weight: 700; font-size: 1.05rem;" ${isBye ? 'disabled' : ''}>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.25rem;">
          <a href="/tracker?eventId=${encodeURIComponent(ev.id)}&round=${currentRound}&table=${table}" target="_blank" style="font-size: 0.75rem; color: var(--accent); text-decoration: underline;">Open Score Tracker</a>
          <button class="btn btn-outline" style="font-size: 0.76rem; padding: 0.28rem 0.65rem;" onclick="saveTableScore(${table})">💾 Save Score</button>
        </div>
      </div>
    `;
  }).join("");
}

function selectRoundView(roundNum) {
  studioState.currentRoundView = roundNum;
  renderPairingsSubtab();
}

async function triggerGenerateSwissPairings() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const roundNum = studioState.currentRoundView || ev.current_round || 1;
  const roster = (ev.roster || []).filter(p => !p.dropped);

  if (roster.length < 2) {
    alert("At least 2 active competitors are required to generate pairings.");
    return;
  }

  if (!confirm(`Generate Swiss pairings for Round ${roundNum}?`)) return;

  try {
    const res = await window.api.generateStudioPairings(ev.id, { round: roundNum });
    if (res && res.success) {
      studioState.activeTournament = res.event;
      renderPairingsSubtab();
      alert(`🎉 Generated Swiss pairings for Round ${roundNum}!`);
    } else {
      alert(res.message || "Failed to generate pairings.");
    }
  } catch (err) {
    console.error("Pairings generation error:", err);
    alert(`Pairings failed: ${err.message || err}`);
  }
}

async function saveTableScore(tableNum) {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const currentRound = studioState.currentRoundView || ev.current_round || 1;
  const p1ScoreEl = document.getElementById(`score-p1-${tableNum}`);
  const p2ScoreEl = document.getElementById(`score-p2-${tableNum}`);

  const p1Score = p1ScoreEl ? parseInt(p1ScoreEl.value, 10) : 0;
  const p2Score = p2ScoreEl ? parseInt(p2ScoreEl.value, 10) : 0;

  const pairingsMap = ev.pairings || {};
  const roundPairings = pairingsMap[String(currentRound)] || [];
  const match = roundPairings.find(m => m.table === tableNum);

  if (match) {
    match.p1_score = p1Score;
    match.p2_score = p2Score;
    match.is_done = true;
  }

  try {
    await window.api.saveStudioPairings(ev.id, {
      round: currentRound,
      pairings: roundPairings
    });
    alert(`Table ${tableNum} score saved!`);
  } catch (err) {
    console.error("Error saving score:", err);
    alert(`Failed to save score: ${err.message || err}`);
  }
}

async function advanceTournamentRound() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const totalRounds = ev.num_rounds || ev.rounds || 5;
  const currentRound = studioState.currentRoundView || ev.current_round || 1;

  if (currentRound >= totalRounds) {
    alert("This tournament has completed all scheduled rounds!");
    return;
  }

  const nextRound = currentRound + 1;
  if (!confirm(`Ready to advance to Round ${nextRound}? This will automatically generate Round ${nextRound} Swiss pairings.`)) {
    return;
  }

  studioState.currentRoundView = nextRound;
  await triggerGenerateSwissPairings();
}

async function renderStandingsSubtab() {
  const ev = studioState.activeTournament;
  const tbody = document.getElementById("manage-standings-tbody");
  if (!tbody || !ev) return;

  tbody.innerHTML = `<tr><td colspan="7" style="padding: 2.5rem; text-align: center; color: var(--text-muted);">Calculating Swiss tiebreakers and Strength of Schedule...</td></tr>`;

  try {
    const res = await window.api.getStudioStandings(ev.id);
    const standings = (res && res.standings) ? res.standings : [];

    if (standings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="padding: 2.5rem; text-align: center; color: var(--text-muted);">No standings computed yet. Enter match scores in the Pairings tab.</td></tr>`;
      return;
    }

    tbody.innerHTML = standings.map(s => {
      const record = `${s.wins}-${s.losses}-${s.draws}`;
      const diff = s.battle_points_diff >= 0 ? `+${s.battle_points_diff}` : `${s.battle_points_diff}`;

      return `
        <tr style="border-bottom: 1px solid var(--border);">
          <td style="padding: 0.75rem 0.85rem; font-weight: 700; font-family: var(--font-heading); color: ${s.rank <= 3 ? '#38bdf8' : '#fff'};">#${s.rank}</td>
          <td style="padding: 0.75rem 1rem; font-weight: 600; color: #fff;">${escapeHtml(s.name)}</td>
          <td style="padding: 0.75rem 1rem; color: #38bdf8;">${escapeHtml(s.faction)}</td>
          <td style="padding: 0.75rem 0.85rem; text-align: center; font-family: var(--font-mono); font-weight: 600;">${record}</td>
          <td style="padding: 0.75rem 0.85rem; text-align: center; font-weight: 700; color: #10b981;">${s.swiss_points}</td>
          <td style="padding: 0.75rem 0.85rem; text-align: center; font-family: var(--font-mono);">${s.opp_win_rate_sos}%</td>
          <td style="padding: 0.75rem 0.85rem; text-align: center; font-family: var(--font-mono);">${s.battle_points} <span style="font-size: 0.75rem; color: var(--text-muted);">(${diff})</span></td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    console.error("Error loading standings:", err);
    tbody.innerHTML = `<tr><td colspan="7" style="padding: 2rem; text-align: center; color: #ef4444;">Failed to load standings: ${escapeHtml(err.message || err)}</td></tr>`;
  }
}

function renderMetaSubtab() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const roster = ev.roster || [];
  const factionCounts = {};

  roster.forEach(p => {
    const f = p.faction || "Unknown";
    factionCounts[f] = (factionCounts[f] || 0) + 1;
  });

  const sortedFactions = Object.entries(factionCounts).sort((a, b) => b[1] - a[1]);
  const total = Math.max(1, roster.length);

  const barsEl = document.getElementById("meta-faction-bars");
  if (barsEl) {
    if (sortedFactions.length === 0) {
      barsEl.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem;">No competitor factions registered yet.</div>`;
    } else {
      barsEl.innerHTML = sortedFactions.map(([fac, count]) => {
        const pct = Math.round((count / total) * 100);
        return `
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 0.25rem;">
              <span style="color: #fff; font-weight: 600;">${escapeHtml(fac)}</span>
              <span style="color: var(--text-muted);">${count} (${pct}%)</span>
            </div>
            <div style="background: rgba(255,255,255,0.06); height: 6px; border-radius: 3px; overflow: hidden;">
              <div style="background: #38bdf8; width: ${pct}%; height: 100%;"></div>
            </div>
          </div>
        `;
      }).join("");
    }
  }

  const winrateEl = document.getElementById("meta-winrate-bars");
  if (winrateEl) {
    winrateEl.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem;">Win rate matrix updates as rounds conclude.</div>`;
  }
}

/* ==========================================================================
   ROSTER ACTIONS & MODAL
   ========================================================================== */

function openAddPlayerModal() {
  const modal = document.getElementById("modal-add-player");
  if (modal) modal.style.display = "flex";
}

function closeAddPlayerModal() {
  const modal = document.getElementById("modal-add-player");
  if (modal) modal.style.display = "none";
}

async function submitAddPlayer() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const nameInput = document.getElementById("add-player-name");
  const facInput = document.getElementById("add-player-faction");
  const teamInput = document.getElementById("add-player-team");
  const emailInput = document.getElementById("add-player-email");

  const name = nameInput ? nameInput.value.trim() : "";
  const fac = facInput ? facInput.value.trim() : "";
  if (!name || !fac) {
    alert("Please provide player name and faction.");
    return;
  }

  const newPlayer = {
    id: `PL-${Date.now().toString(36).toUpperCase()}`,
    name: name,
    faction: fac,
    team: teamInput ? teamInput.value.trim() : "",
    email: emailInput ? emailInput.value.trim() : "",
    checked_in: true,
    dropped: false
  };

  ev.roster = ev.roster || [];
  ev.roster.push(newPlayer);
  ev.total_players = ev.roster.length;

  try {
    await window.api.saveStudioRoster(ev.id, { roster: ev.roster });
    closeAddPlayerModal();
    if (nameInput) nameInput.value = "";
    if (facInput) facInput.value = "";
    if (teamInput) teamInput.value = "";
    if (emailInput) emailInput.value = "";
    renderRosterSubtab();
  } catch (err) {
    alert(`Failed to save player: ${err.message || err}`);
  }
}

async function toggleCheckIn(playerId) {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const player = (ev.roster || []).find(p => (p.id || p.player_id || p.name) === playerId);
  if (player) {
    player.checked_in = !player.checked_in;
    await window.api.saveStudioRoster(ev.id, { roster: ev.roster });
    renderRosterSubtab();
  }
}

async function toggleDropPlayer(playerId) {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const player = (ev.roster || []).find(p => (p.id || p.player_id || p.name) === playerId);
  if (player) {
    player.dropped = !player.dropped;
    await window.api.saveStudioRoster(ev.id, { roster: ev.roster });
    renderRosterSubtab();
  }
}

async function removePlayer(playerId) {
  const ev = studioState.activeTournament;
  if (!ev) return;

  if (!confirm("Are you sure you want to remove this player from the tournament?")) return;

  ev.roster = (ev.roster || []).filter(p => (p.id || p.player_id || p.name) !== playerId);
  ev.total_players = ev.roster.length;

  await window.api.saveStudioRoster(ev.id, { roster: ev.roster });
  renderRosterSubtab();
}

async function bulkCheckInPlayers() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  (ev.roster || []).forEach(p => p.checked_in = true);
  await window.api.saveStudioRoster(ev.id, { roster: ev.roster });
  renderRosterSubtab();
  alert("All competitors marked checked in!");
}

function filterRosterTable() {
  const query = (document.getElementById("roster-search-input")?.value || "").toLowerCase();
  const rows = document.querySelectorAll("#manage-roster-tbody tr");
  rows.forEach(r => {
    const text = r.textContent.toLowerCase();
    r.style.display = text.includes(query) ? "" : "none";
  });
}

/* ==========================================================================
   ROUND TIMER WIDGET
   ========================================================================== */

function toggleRoundTimer() {
  const btn = document.getElementById("btn-timer-toggle");
  if (studioState.isTimerRunning) {
    clearInterval(studioState.timerInterval);
    studioState.isTimerRunning = false;
    if (btn) btn.textContent = "▶️";
  } else {
    studioState.isTimerRunning = true;
    if (btn) btn.textContent = "⏸️";
    studioState.timerInterval = setInterval(() => {
      if (studioState.timerSeconds > 0) {
        studioState.timerSeconds--;
        updateTimerDisplay();
      } else {
        clearInterval(studioState.timerInterval);
        studioState.isTimerRunning = false;
        if (btn) btn.textContent = "▶️";
        alert("⏰ ROUND TIMER EXPIRED!");
      }
    }, 1000);
  }
}

function updateTimerDisplay() {
  const clockEl = document.getElementById("manage-round-clock");
  if (!clockEl) return;

  const hrs = Math.floor(studioState.timerSeconds / 3600);
  const mins = Math.floor((studioState.timerSeconds % 3600) / 60);
  const secs = studioState.timerSeconds % 60;

  clockEl.textContent = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function exportStandingsCsv() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  window.api.getStudioStandings(ev.id).then(res => {
    const standings = (res && res.standings) ? res.standings : [];
    if (standings.length === 0) {
      alert("No standings to export.");
      return;
    }

    let csv = "Rank,Player Name,Faction,Record,Swiss Points,SoS Opp Win %,Battle Points,Battle Points Diff\n";
    standings.forEach(s => {
      csv += `${s.rank},"${s.name}","${s.faction}",${s.wins}-${s.losses}-${s.draws},${s.swiss_points},${s.opp_win_rate_sos}%,${s.battle_points},${s.battle_points_diff}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${ev.name.replace(/\s+/g, '_')}_Standings.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
}

async function deleteStudioTournament(eventId) {
  if (!confirm(`Are you sure you want to delete tournament "${eventId}"? This action cannot be undone.`)) {
    return;
  }

  // 1. Instant Optimistic UI Update: remove tournament immediately from list and DOM
  studioState.eventsList = (studioState.eventsList || []).filter(e => e.id !== eventId);
  renderEventsDirectory();

  if (typeof loadTournaments === 'function') {
    try { loadTournaments(); } catch(e) {}
  }

  try {
    const res = await window.api.deleteStudioEvent(eventId);
    if (!res || !res.success) {
      alert(res?.message || "Could not delete tournament from server.");
      await loadStudioEvents();
    }
  } catch (err) {
    console.error("Delete error:", err);
    alert(`Delete failed: ${err.message || err}`);
    await loadStudioEvents();
  }
}

function updateDefaultRounds() {
  const format = document.getElementById("create-event-format");
  const roundsInput = document.getElementById("create-event-rounds");
  if (!format || !roundsInput) return;

  const val = format.value;
  if (val === "RTT") roundsInput.value = "3";
  else if (val === "GT") roundsInput.value = "5";
  else if (val === "Major") roundsInput.value = "6";
  else if (val === "League") roundsInput.value = "4";
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Global window bindings for Event Studio
window.initStudio = initStudio;
window.loadStudioEvents = loadStudioEvents;
window.switchStudioTab = switchStudioTab;
window.renderEventsDirectory = renderEventsDirectory;
window.submitCreateTournament = submitCreateTournament;
window.deleteStudioTournament = deleteStudioTournament;
window.updateDefaultRounds = updateDefaultRounds;
window.loadTournamentWorkspace = loadTournamentWorkspace;
window.switchManageSubtab = switchManageSubtab;
window.triggerGenerateSwissPairings = triggerGenerateSwissPairings;
window.saveTableScore = saveTableScore;
window.advanceTournamentRound = advanceTournamentRound;
window.selectRoundView = selectRoundView;
window.openAddPlayerModal = openAddPlayerModal;
window.closeAddPlayerModal = closeAddPlayerModal;
window.submitAddPlayer = submitAddPlayer;
window.toggleCheckIn = toggleCheckIn;
window.toggleDropPlayer = toggleDropPlayer;
window.removePlayer = removePlayer;
window.bulkCheckInPlayers = bulkCheckInPlayers;
window.filterRosterTable = filterRosterTable;
window.toggleRoundTimer = toggleRoundTimer;
window.exportStandingsCsv = exportStandingsCsv;
