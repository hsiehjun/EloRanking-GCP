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
  const tok = localStorage.getItem("bcp_jwt") || 
              localStorage.getItem("bcp_token") || 
              localStorage.getItem("bcp_organizer_token") || 
              localStorage.getItem("bcp_user_token") || "";
  return (tok && tok.split(".").length === 3) ? tok : "";
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

  const token = getBcpToken();
  const isBcpConnected = !!((user && (user.bcp_connected || user.bcp_user_id || user.bcp_email)) || (token && token.length > 20));
  studioState.bcpConnected = isBcpConnected;

  // Toggle locked gate vs tournament directory/management views
  const lockedGates = document.querySelectorAll("#es-locked-gate");
  const mainViews = document.querySelectorAll("#es-view-events, #es-view-create, #es-view-manage");
  const headerCreateBtns = document.querySelectorAll("#btn-sync-bcp-events, .es-create-tourney-btn");

  if (!isBcpConnected) {
    lockedGates.forEach(g => {
      g.style.display = "block";
      if (!user) {
        g.innerHTML = `
          <div style="font-size: 3rem; margin-bottom: 0.75rem;">🔑</div>
          <h3 style="color: #fff; font-size: 1.35rem; margin: 0 0 0.5rem; font-family: var(--font-heading);">Sign In to OmniTactica</h3>
          <p style="color: var(--text-secondary); font-size: 0.88rem; line-height: 1.6; max-width: 480px; margin: 0 auto 1.5rem;">
            Event Studio is the dedicated Tournament Director suite. Please sign in or create an account to organize tournaments, manage competitor rosters, generate Swiss pairings, and sync match scores.
          </p>
          <div style="display: flex; justify-content: center; gap: 0.75rem; flex-wrap: wrap;">
            <a href="/login?redirect=%2F%23event-studio" class="btn btn-primary" style="font-size: 0.88rem; padding: 0.55rem 1.25rem;">🔑 Sign In / Register</a>
            <button class="btn btn-outline" style="font-size: 0.88rem; padding: 0.55rem 1.15rem;" onclick="switchTab('leaderboard')">🏆 View Leaderboard</button>
          </div>
        `;
      } else {
        g.innerHTML = `
          <div style="font-size: 3rem; margin-bottom: 0.75rem;">🔒</div>
          <h3 style="color: #fff; font-size: 1.35rem; margin: 0 0 0.5rem; font-family: var(--font-heading);">Best Coast Pairings Link Required</h3>
          <p style="color: var(--text-secondary); font-size: 0.88rem; line-height: 1.6; max-width: 480px; margin: 0 auto 1.5rem;">
            Event Studio is the dedicated Tournament Director suite for Best Coast Pairings. Link your BCP account to organize official tournaments, manage competitor rosters, generate Swiss pairings, and sync match scores.
          </p>
          <div style="display: flex; justify-content: center; gap: 0.75rem; flex-wrap: wrap;">
            <button class="btn btn-primary" style="font-size: 0.88rem; padding: 0.55rem 1.25rem;" onclick="openBcpLinkModal()">🔗 Link BCP Account</button>
            <button class="btn btn-outline" style="font-size: 0.88rem; padding: 0.55rem 1.15rem;" onclick="switchTab('leaderboard')">🏆 View Leaderboard</button>
          </div>
        `;
      }
    });
    mainViews.forEach(v => { v.style.display = "none"; });
    headerCreateBtns.forEach(b => {
      b.disabled = true;
      b.style.opacity = "0.4";
      b.style.cursor = "not-allowed";
    });
  } else {
    lockedGates.forEach(g => { g.style.display = "none"; });
    headerCreateBtns.forEach(b => {
      b.disabled = false;
      b.style.opacity = "1";
      b.style.cursor = "pointer";
    });
    // If on events tab, show events directory
    if (studioState.activeTab === 'events' || !studioState.activeTab) {
      const evView = document.getElementById("es-view-events");
      if (evView) evView.style.display = "block";
    }
  }

  if (statusText) {
    if (isBcpConnected) {
      const email = (user && (user.bcp_email || user.email || user.display_name)) || "BCP Organizer";
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
      statusText.innerHTML = `Signed in as <strong style="color: #38bdf8;">${escapeHtml(user.display_name || user.email)}</strong> — <a href="javascript:void(0)" onclick="openBcpLinkModal()" style="color: #f59e0b; text-decoration: underline; font-weight: 600;">Link BCP Account</a> to unlock Event Studio`;
    } else {
      if (banner) {
        banner.style.background = "rgba(56, 189, 248, 0.05)";
        banner.style.borderColor = "rgba(56, 189, 248, 0.2)";
      }
      if (dot) {
        dot.style.background = "#94a3b8";
        dot.style.boxShadow = "none";
      }
      statusText.innerHTML = `<span style="color: #94a3b8;">Guest Mode</span> — <a href="/login?redirect=%2F%23event-studio" style="color: #38bdf8; text-decoration: underline; font-weight: 600;">Sign In</a> to unlock Event Studio`;
    }
  }
}

async function syncBcpOrganizerEvents() {
  const btns = document.querySelectorAll("#btn-sync-bcp-events");
  btns.forEach(b => {
    b.disabled = true;
    b.textContent = "🔄 Syncing with BCP...";
  });

  try {
    const res = await window.api.getStudioEvents();
    studioState.eventsList = (res && Array.isArray(res.events)) ? res.events : [];
    
    renderEventsDirectory();
    if (typeof loadTournaments === 'function') {
      try { loadTournaments(); } catch(e) {}
    }

    const unlinkedEvents = studioState.eventsList.filter(e => e.bcp_status === "deleted_on_bcp");
    const activeBcpEvents = studioState.eventsList.filter(e => e.id && !e.id.startsWith("ES-") && e.bcp_status !== "deleted_on_bcp");
    
    if (unlinkedEvents.length > 0) {
      alert(`🔄 BCP Sync Complete!\n\n• ${activeBcpEvents.length} active tournament(s) synced with Best Coast Pairings.\n• ⚠️ ${unlinkedEvents.length} tournament(s) were removed on BCP and are now marked as "Unlinked from BCP (Local Only)" in OmniTactica.`);
    } else if (activeBcpEvents.length > 0) {
      alert(`🎉 Synced with Best Coast Pairings! Loaded ${activeBcpEvents.length} active BCP tournament${activeBcpEvents.length === 1 ? '' : 's'}.`);
    } else {
      alert("✅ Sync complete! Your tournament directory is up to date.");
    }
  } catch (err) {
    console.warn("Notice syncing BCP events:", err);
    await loadStudioEvents();
  } finally {
    btns.forEach(b => {
      b.disabled = false;
      b.textContent = "🔄 Sync BCP Events";
    });
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

  // Enforce BCP link requirement
  if (!studioState.bcpConnected && tabName !== 'events') {
    openBcpLinkModal();
    return;
  }

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
      const isDeletedOnBcp = ev.bcp_status === "deleted_on_bcp" || ev.bcp_deleted === true;
      const bcpUrl = isBcp ? `https://www.bestcoastpairings.com/event/${encodeURIComponent(ev.id)}` : "#";

      let bcpBadgeHtml = '';
      if (isDeletedOnBcp) {
        bcpBadgeHtml = '<span class="badge" style="font-size: 0.7rem; background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.35);" title="This tournament was removed from Best Coast Pairings but remains preserved locally in OmniTactica.">⚠️ UNLINKED FROM BCP</span>';
      } else if (isBcp) {
        bcpBadgeHtml = '<span class="badge badge-online" style="font-size: 0.7rem;">BCP SYNCED</span>';
      } else {
        bcpBadgeHtml = '<span class="badge" style="font-size: 0.7rem; background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3);">LOCAL</span>';
      }

      return `
        <div class="es-event-card" data-event-id="${escapeHtml(ev.id)}" style="background: var(--bg-card); border: 1px solid ${isDeletedOnBcp ? 'rgba(239,68,68,0.35)' : 'var(--border)'}; border-radius: var(--radius-lg); padding: 1.35rem; display: flex; flex-direction: column; justify-content: space-between; gap: 1rem; transition: transform 0.2s ease, border-color 0.2s ease;">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.35rem;">
              <span class="badge badge-accent" style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase;">${escapeHtml(tier)}</span>
              ${bcpBadgeHtml}
            </div>
            <h4 style="margin: 0 0 0.4rem; color: #fff; font-size: 1.15rem; font-family: var(--font-heading); cursor: pointer;" onclick="switchStudioTab('manage', '${escapeHtml(ev.id)}')">${escapeHtml(ev.name)}</h4>
            <div style="font-size: 0.8rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 0.25rem;">
              <div>📅 ${escapeHtml(dateStr)} • 📍 ${escapeHtml(location)}</div>
              <div>👥 <b>${roster.length} / ${ev.capacity || 32}</b> Players • 🎲 <b>${rounds}</b> Rounds (${ev.points || 2000} pts)</div>
              ${isDeletedOnBcp ? '<div style="color: #ef4444; font-size: 0.75rem; font-weight: 600; margin-top: 0.2rem;">⚠️ Event deleted on BCP — preserved as local</div>' : ''}
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border); padding-top: 0.85rem; margin-top: 0.25rem; gap: 0.5rem; flex-wrap: wrap;">
            <button class="btn btn-primary" style="font-size: 0.78rem; padding: 0.35rem 0.85rem;" onclick="switchStudioTab('manage', '${escapeHtml(ev.id)}')">👑 Direct Event</button>
            <div style="display: flex; gap: 0.35rem; align-items: center;">
              ${(isBcp && !isDeletedOnBcp) ? `<a href="${bcpUrl}" target="_blank" class="btn btn-outline" style="font-size: 0.75rem; padding: 0.3rem 0.6rem; text-decoration: none;">🔗 BCP</a>` : ''}
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
  const typeInput = document.getElementById("create-event-type");
  const teamSizeInput = document.getElementById("create-event-team-size");
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
  const circuitInput = document.getElementById("create-event-circuit");
  const circuitTokenInput = document.getElementById("create-event-circuit-token");
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

  const selectedCircuitName = circuitInput && circuitInput.selectedIndex >= 0 && circuitInput.value ? circuitInput.options[circuitInput.selectedIndex].text : "";

  const verifiedEl = document.getElementById("create-event-loc-verified");
  if (!verifiedEl || verifiedEl.value !== "true") {
    alert("⚠️ Please select a verified city from the location search dropdown to ensure your event appears accurately on Best Coast Pairings and nearby tournament discovery.");
    if (cityStateInput) {
      cityStateInput.focus();
      handleStudioLocationInput(cityStateInput.value);
    }
    return;
  }

  const elCity = document.getElementById("create-event-loc-city");
  const elState = document.getElementById("create-event-loc-state");
  const elCountry = document.getElementById("create-event-loc-country");
  const elLat = document.getElementById("create-event-loc-lat");
  const elLng = document.getElementById("create-event-loc-lng");

  const payload = {
    name: name,
    game_system_id: gameSystemInput ? gameSystemInput.value : "WGMSzfKFYA",
    tier: formatInput ? formatInput.value : "Grand Tournament",
    event_type: typeInput ? typeInput.value : "Singles Event",
    team_size: teamSizeInput ? parseInt(teamSizeInput.value, 10) : 5,
    circuit_id: circuitInput ? circuitInput.value : "",
    circuit_token: circuitTokenInput ? circuitTokenInput.value.trim() : "",
    circuit_name: selectedCircuitName,
    pairing_style: pairingStyleInput ? pairingStyleInput.value : "swiss",
    rounds: roundsInput ? parseInt(roundsInput.value, 10) : 5,
    default_round_length: roundLengthInput ? parseInt(roundLengthInput.value, 10) : 9000,
    start_date: startInput ? startInput.value : "",
    end_date: endInput ? endInput.value : (startInput ? startInput.value : ""),
    capacity: capacityInput ? parseInt(capacityInput.value, 10) : 32,
    points: pointsInput ? parseInt(pointsInput.value, 10) : 2000,
    venue: venueInput ? venueInput.value.trim() : "",
    city: elCity ? elCity.value.trim() : (cityStateInput ? cityStateInput.value.trim() : ""),
    state: elState ? elState.value.trim() : "",
    country: elCountry ? elCountry.value.trim() : "United States",
    lat: elLat && elLat.value ? parseFloat(elLat.value) : null,
    lng: elLng && elLng.value ? parseFloat(elLng.value) : null,
    location_verified: true,
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
      if (typeof loadEvents === 'function') {
        try { loadEvents(); } catch(e) {}
      }
      window.dispatchEvent(new CustomEvent('tournaments-updated', { detail: { eventId, action: 'create', event: newEvent } }));

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

    const formatBadge = document.getElementById("manage-event-format-badge");
    if (formatBadge) {
      const et = String(ev.event_type || ev.eventType || "").toLowerCase();
      if (et.includes("doubles")) {
        formatBadge.textContent = "👥 DOUBLES";
        formatBadge.style.display = "inline-block";
      } else if (et.includes("team")) {
        const sz = ev.team_size || ev.teamSize || 5;
        formatBadge.textContent = `🛡️ TEAMS (${sz}-MAN)`;
        formatBadge.style.display = "inline-block";
      } else {
        formatBadge.textContent = "👤 SINGLES";
        formatBadge.style.display = "inline-block";
      }
    }

    const circuitBadgesEl = document.getElementById("manage-event-circuit-badges");
    if (circuitBadgesEl) {
      circuitBadgesEl.innerHTML = "";
      const circuits = Array.isArray(ev.circuits) ? ev.circuits : [];
      circuits.forEach(c => {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.style.background = "rgba(234, 179, 8, 0.15)";
        badge.style.color = "#facc15";
        badge.style.border = "1px solid rgba(234, 179, 8, 0.4)";
        badge.textContent = `🏆 ${c.name || 'Circuit'}`;
        circuitBadgesEl.appendChild(badge);
      });
    }
    
    const isBcp = ev.id && !ev.id.startsWith("ES-");
    const isDeletedOnBcp = ev.bcp_status === "deleted_on_bcp" || ev.bcp_deleted === true;

    if (bcpBadge) {
      if (isDeletedOnBcp) {
        bcpBadge.style.display = "inline-block";
        bcpBadge.className = "badge";
        bcpBadge.style.background = "rgba(239,68,68,0.15)";
        bcpBadge.style.color = "#ef4444";
        bcpBadge.style.borderColor = "rgba(239,68,68,0.35)";
        bcpBadge.textContent = "⚠️ UNLINKED FROM BCP";
      } else if (isBcp) {
        bcpBadge.style.display = "inline-block";
        bcpBadge.className = "badge badge-online";
        bcpBadge.style.background = "";
        bcpBadge.style.color = "";
        bcpBadge.style.borderColor = "";
        bcpBadge.textContent = "BCP SYNCED";
      } else {
        bcpBadge.style.display = "none";
      }
    }
    if (bcpLink) {
      if (isDeletedOnBcp) {
        bcpLink.style.display = "none";
      } else if (isBcp) {
        bcpLink.style.display = "inline-flex";
        bcpLink.href = `https://www.bestcoastpairings.com/event/${encodeURIComponent(ev.id)}`;
      } else {
        bcpLink.style.display = "none";
      }
    }

    // Render / update unlinked warning banner inside the workspace
    let warningBanner = document.getElementById("manage-event-unlinked-warning");
    const workspaceViews = document.querySelectorAll("#es-view-manage");
    workspaceViews.forEach(ws => {
      let wb = ws.querySelector("#manage-event-unlinked-warning");
      if (isDeletedOnBcp) {
        if (!wb) {
          wb = document.createElement("div");
          wb.id = "manage-event-unlinked-warning";
          const header = ws.querySelector(".es-manage-header");
          if (header) header.parentNode.insertBefore(wb, header.nextSibling);
        }
        if (wb) {
          wb.style.display = "flex";
          wb.style.alignItems = "center";
          wb.style.justifyContent = "space-between";
          wb.style.background = "rgba(239, 68, 68, 0.08)";
          wb.style.border = "1px solid rgba(239, 68, 68, 0.25)";
          wb.style.borderRadius = "var(--radius-md)";
          wb.style.padding = "0.75rem 1.15rem";
          wb.style.marginBottom = "1.25rem";
          wb.style.fontSize = "0.85rem";
          wb.style.color = "#fca5a5";
          wb.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.65rem;">
              <span style="font-size: 1.2rem;">⚠️</span>
              <span><strong>Notice:</strong> This tournament was deleted or unlinked on Best Coast Pairings. It is preserved in OmniTactica as a local event with all competitor rosters, pairings, and scores intact.</span>
            </div>
          `;
        }
      } else if (wb) {
        wb.style.display = "none";
      }
    });

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

function openEditTournamentModal() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const modal = document.getElementById("es-edit-tournament-modal");
  const nameEl = document.getElementById("edit-event-name");
  const sDateEl = document.getElementById("edit-event-start-date");
  const eDateEl = document.getElementById("edit-event-end-date");
  const venueEl = document.getElementById("edit-event-venue");
  const cityEl = document.getElementById("edit-event-city");
  const stateEl = document.getElementById("edit-event-state");
  const roundsEl = document.getElementById("edit-event-rounds");
  const ptsEl = document.getElementById("edit-event-points");
  const capEl = document.getElementById("edit-event-capacity");
  const errEl = document.getElementById("edit-event-error");

  if (errEl) errEl.style.display = "none";
  if (nameEl) nameEl.value = ev.name || "";
  if (sDateEl) sDateEl.value = ev.event_date ? String(ev.event_date).split("T")[0] : "";
  if (eDateEl) eDateEl.value = ev.end_date ? String(ev.end_date).split("T")[0] : (sDateEl ? sDateEl.value : "");
  if (venueEl) venueEl.value = ev.venue || "";
  if (cityEl) cityEl.value = ev.city || "";
  if (stateEl) stateEl.value = ev.state || "";
  if (roundsEl) roundsEl.value = ev.num_rounds || ev.rounds || 5;
  if (ptsEl) ptsEl.value = ev.points || 2000;
  if (capEl) capEl.value = ev.capacity || 32;

  const typeEl = document.getElementById("edit-event-type");
  const teamSizeEl = document.getElementById("edit-event-team-size");
  if (typeEl) {
    const rawEt = String(ev.event_type || ev.eventType || "").toLowerCase();
    if (rawEt.includes("doubles")) typeEl.value = "Doubles Event";
    else if (rawEt.includes("team")) typeEl.value = "Teams Event";
    else typeEl.value = "Singles Event";
  }
  if (teamSizeEl) teamSizeEl.value = ev.team_size || ev.teamSize || 5;
  toggleTeamOptions("edit");

  if (modal) modal.classList.add("active");
}

function closeEditTournamentModal() {
  const modal = document.getElementById("es-edit-tournament-modal");
  if (modal) modal.classList.remove("active");
}

async function saveEditedTournament(e) {
  if (e) e.preventDefault();
  const ev = studioState.activeTournament;
  if (!ev) return;

  const nameEl = document.getElementById("edit-event-name");
  const typeEl = document.getElementById("edit-event-type");
  const teamSizeEl = document.getElementById("edit-event-team-size");
  const sDateEl = document.getElementById("edit-event-start-date");
  const eDateEl = document.getElementById("edit-event-end-date");
  const venueEl = document.getElementById("edit-event-venue");
  const cityEl = document.getElementById("edit-event-city");
  const stateEl = document.getElementById("edit-event-state");
  const roundsEl = document.getElementById("edit-event-rounds");
  const ptsEl = document.getElementById("edit-event-points");
  const capEl = document.getElementById("edit-event-capacity");
  const errEl = document.getElementById("edit-event-error");
  const btn = document.getElementById("edit-event-submit-btn");

  const eventType = typeEl ? typeEl.value : "Singles Event";
  const teamSize = teamSizeEl ? parseInt(teamSizeEl.value, 10) : 5;

  const payload = {
    name: nameEl ? nameEl.value.trim() : ev.name,
    event_type: eventType,
    team_size: teamSize,
    event_date: sDateEl ? sDateEl.value : ev.event_date,
    start_date: sDateEl ? sDateEl.value : ev.event_date,
    end_date: eDateEl ? eDateEl.value : ev.end_date,
    venue: venueEl ? venueEl.value.trim() : ev.venue,
    city: cityEl ? cityEl.value.trim() : ev.city,
    state: stateEl ? stateEl.value.trim() : ev.state,
    num_rounds: roundsEl ? parseInt(roundsEl.value, 10) : (ev.num_rounds || 5),
    points: ptsEl ? parseInt(ptsEl.value, 10) : (ev.points || 2000),
    capacity: capEl ? parseInt(capEl.value, 10) : (ev.capacity || 32)
  };

  if (btn) {
    btn.disabled = true;
    btn.innerText = "Saving Changes...";
  }

  try {
    const res = await window.api.updateStudioEvent(ev.id, payload);
    if (res && res.success) {
      const updated = res.event || payload;
      studioState.activeTournament = { ...ev, ...updated };
      
      // Update in studioState.eventsList
      if (Array.isArray(studioState.eventsList)) {
        const idx = studioState.eventsList.findIndex(e => e.id === ev.id);
        if (idx >= 0) {
          studioState.eventsList[idx] = { ...studioState.eventsList[idx], ...updated };
        }
      }

      // Immediately reflect updated values in the DOM
      const nameHeader = document.getElementById("manage-event-name");
      const locHeader = document.getElementById("manage-event-location");
      const dateHeader = document.getElementById("manage-event-date");
      const roundsPtsHeader = document.getElementById("manage-event-rounds-pts");
      const formatBadge = document.getElementById("manage-event-format-badge");

      if (nameHeader) nameHeader.textContent = updated.name || ev.name;
      if (locHeader) locHeader.textContent = [updated.venue, updated.city, updated.state].filter(Boolean).join(", ") || "Local Venue";
      if (dateHeader) dateHeader.textContent = updated.event_date ? String(updated.event_date).split("T")[0] : (updated.start_date || "Date TBD");
      if (roundsPtsHeader) roundsPtsHeader.textContent = `${updated.num_rounds || 5} Rounds (${updated.points || 2000} pts)`;

      if (formatBadge) {
        const et = String(updated.event_type || updated.eventType || eventType).toLowerCase();
        if (et.includes("doubles")) formatBadge.textContent = "👥 DOUBLES";
        else if (et.includes("team")) formatBadge.textContent = `🛡️ TEAMS (${updated.team_size || teamSize}-MAN)`;
        else formatBadge.textContent = "👤 SINGLES";
      }

      closeEditTournamentModal();
      await loadTournamentWorkspace(ev.id);
      alert("✅ Tournament details updated and synced successfully!");
    } else {
      if (errEl) {
        errEl.innerText = res.error || "Failed to update tournament.";
        errEl.style.display = "block";
      }
    }
  } catch (err) {
    if (errEl) {
      errEl.innerText = "Error: " + err.message;
      errEl.style.display = "block";
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = "💾 Save Changes";
    }
  }
}

async function togglePublishPairings() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const currentRound = studioState.currentRoundView || ev.current_round || 1;
  const isCurrentlyPublished = !!ev.is_published;
  const btn = document.getElementById("btn-publish-pairings");

  try {
    if (isCurrentlyPublished) {
      if (!confirm(`Unpublish pairings for Round ${currentRound}? Players will not see matchups until republished.`)) return;
      const res = await window.api.unpublishStudioPairings(ev.id, { round: currentRound });
      if (res && res.success) {
        ev.is_published = false;
        if (btn) {
          btn.innerText = "📢 Publish Pairings";
          btn.className = "btn btn-outline";
        }
        alert(`🔒 Round ${currentRound} pairings unpublished.`);
      }
    } else {
      const res = await window.api.publishStudioPairings(ev.id, { round: currentRound });
      if (res && res.success) {
        ev.is_published = true;
        if (btn) {
          btn.innerText = "🔒 Unpublish Pairings";
          btn.className = "btn btn-primary";
        }
        alert(`📢 Round ${currentRound} pairings published live on BCP and player devices!`);
      }
    }
  } catch (err) {
    alert("Publish toggle error: " + err.message);
  }
}

async function finalizeCurrentRound() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const totalRounds = ev.num_rounds || ev.rounds || 5;
  const currentRound = studioState.currentRoundView || ev.current_round || 1;

  if (!confirm(`Finalize and lock Round ${currentRound}? This will save official match results and advance to Round ${Math.min(currentRound + 1, totalRounds)}.`)) {
    return;
  }

  try {
    const res = await window.api.finalizeStudioRound(ev.id, { round: currentRound });
    if (res && res.success) {
      studioState.activeTournament = res.event;
      studioState.currentRoundView = res.current_round;
      await loadTournamentWorkspace(ev.id);
      renderPairingsSubtab();
      alert(`🏁 Round ${currentRound} finalized! Now on Round ${res.current_round}.`);
    } else {
      alert(res.message || "Failed to finalize round.");
    }
  } catch (err) {
    alert("Finalize round error: " + err.message);
  }
}

async function resetCurrentRound() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const currentRound = studioState.currentRoundView || ev.current_round || 1;
  if (!confirm(`⚠️ Reset Round ${currentRound}? This will allow you to regenerate or modify matchups.`)) {
    return;
  }

  try {
    const res = await window.api.resetStudioRound(ev.id, { round: currentRound });
    if (res && res.success) {
      studioState.activeTournament = res.event;
      renderPairingsSubtab();
      alert(`🔄 Round ${currentRound} reset successfully.`);
    }
  } catch (err) {
    alert("Reset round error: " + err.message);
  }
}

async function endAndArchiveTournament() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  if (!confirm(`🏆 Finalize and End "${ev.name}"? This will lock all final standings and tournament placements.`)) {
    return;
  }

  try {
    const res = await window.api.endStudioTournament(ev.id);
    if (res && res.success) {
      studioState.activeTournament = res.event;
      switchManageSubtab("standings");
      alert(`🏆 "${ev.name}" concluded and archived successfully! Final standings are locked.`);
    } else {
      alert(res.message || "Failed to conclude tournament.");
    }
  } catch (err) {
    alert("End tournament error: " + err.message);
  }
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

  // Remove matching cards from DOM immediately
  document.querySelectorAll(`.es-event-card[data-event-id="${eventId}"]`).forEach(el => el.remove());

  if (typeof loadTournaments === 'function') {
    try { loadTournaments(); } catch(e) {}
  }
  if (typeof loadEvents === 'function') {
    try { loadEvents(); } catch(e) {}
  }
  window.dispatchEvent(new CustomEvent('tournaments-updated', { detail: { eventId, action: 'delete' } }));

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
window.openEditTournamentModal = openEditTournamentModal;
window.closeEditTournamentModal = closeEditTournamentModal;
window.saveEditedTournament = saveEditedTournament;
window.toggleTeamOptions = toggleTeamOptions;
window.openCircuitsModal = openCircuitsModal;
window.closeCircuitsModal = closeCircuitsModal;
window.submitLinkCircuitFromModal = submitLinkCircuitFromModal;

function toggleTeamOptions(context) {
  const typeEl = document.getElementById(`${context}-event-type`);
  const groupEl = document.getElementById(`${context}-team-size-group`);
  if (!typeEl || !groupEl) return;
  if (typeEl.value === "Teams Event") {
    groupEl.style.display = "block";
  } else {
    groupEl.style.display = "none";
  }
}

async function openCircuitsModal() {
  const ev = studioState.activeTournament;
  if (!ev) return;
  const modal = document.getElementById("es-circuits-modal");
  if (modal) modal.classList.add("active");

  renderActiveCircuitsList();

  // Load latest circuits list from BCP if available
  try {
    const res = await window.api.getStudioCircuits();
    if (res && res.success && Array.isArray(res.circuits)) {
      const select = document.getElementById("modal-circuit-select");
      if (select) {
        select.innerHTML = res.circuits.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
      }
    }
  } catch (e) {
    console.warn("Could not refresh circuits list from BCP:", e);
  }
}

function closeCircuitsModal() {
  const modal = document.getElementById("es-circuits-modal");
  if (modal) modal.classList.remove("active");
}

function renderActiveCircuitsList() {
  const ev = studioState.activeTournament;
  const listEl = document.getElementById("circuits-active-list");
  if (!listEl) return;
  const circuits = Array.isArray(ev?.circuits) ? ev.circuits : [];
  if (circuits.length === 0) {
    listEl.innerHTML = `
      <div style="font-size: 0.82rem; color: var(--text-muted); font-style: italic; padding: 0.75rem; background: rgba(255,255,255,0.02); border-radius: 6px; border: 1px dashed var(--border);">
        No circuits linked yet. Select a circuit below to link this tournament.
      </div>
    `;
    return;
  }
  listEl.innerHTML = circuits.map(c => `
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.65rem 0.85rem; background: rgba(234, 179, 8, 0.08); border: 1px solid rgba(234, 179, 8, 0.25); border-radius: 6px;">
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <span style="font-size: 1.1rem;">🏆</span>
        <span style="font-size: 0.85rem; font-weight: 700; color: #facc15;">${c.name || 'Tournament Circuit'}</span>
      </div>
      <span class="badge badge-online" style="font-size: 0.7rem;">LINKED & SYNCED</span>
    </div>
  `).join("");
}

async function submitLinkCircuitFromModal() {
  const ev = studioState.activeTournament;
  if (!ev) return;
  const select = document.getElementById("modal-circuit-select");
  const tokenInput = document.getElementById("modal-circuit-token");
  const btn = document.getElementById("modal-circuit-submit-btn");
  const statusEl = document.getElementById("modal-circuit-status");

  const circuitId = select ? select.value : "";
  if (!circuitId) {
    alert("Please select a circuit to link.");
    return;
  }
  const circuitName = select.options[select.selectedIndex]?.text || "Tournament Circuit";
  const tokenCode = tokenInput ? tokenInput.value.trim() : "";

  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Submitting to BCP Circuit...";
  }
  if (statusEl) {
    statusEl.style.display = "block";
    statusEl.style.background = "rgba(56, 189, 248, 0.1)";
    statusEl.style.color = "#38bdf8";
    statusEl.textContent = `Linking tournament to ${circuitName} on Best Coast Pairings...`;
  }

  try {
    const res = await window.api.submitStudioEventCircuit(ev.id, {
      circuit_id: circuitId,
      token_code: tokenCode,
      circuit_name: circuitName
    });

    if (res && res.success) {
      if (!Array.isArray(ev.circuits)) ev.circuits = [];
      if (!ev.circuits.some(c => c.id === circuitId)) {
        ev.circuits.push({ id: circuitId, name: circuitName });
      }
      renderActiveCircuitsList();

      // Update workspace circuit badges
      const circuitBadgesEl = document.getElementById("manage-event-circuit-badges");
      if (circuitBadgesEl) {
        circuitBadgesEl.innerHTML = "";
        ev.circuits.forEach(c => {
          const badge = document.createElement("span");
          badge.className = "badge";
          badge.style.background = "rgba(234, 179, 8, 0.15)";
          badge.style.color = "#facc15";
          badge.style.border = "1px solid rgba(234, 179, 8, 0.4)";
          badge.textContent = `🏆 ${c.name || 'Circuit'}`;
          circuitBadgesEl.appendChild(badge);
        });
      }

      if (statusEl) {
        statusEl.style.background = "rgba(34, 197, 94, 0.1)";
        statusEl.style.color = "#22c55e";
        statusEl.textContent = `✅ Successfully linked to ${circuitName}!`;
      }
    } else {
      if (statusEl) {
        statusEl.style.background = "rgba(239, 68, 68, 0.1)";
        statusEl.style.color = "#ef4444";
        statusEl.textContent = res?.error || "Failed to link circuit.";
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.style.background = "rgba(239, 68, 68, 0.1)";
      statusEl.style.color = "#ef4444";
      statusEl.textContent = "Error: " + err.message;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🏆 Link Tournament to Circuit";
    }
  }
}

/* ==========================================================================
   EVENT STUDIO: VERIFIED LOCATION AUTOCOMPLETE & GEOCODING
   ========================================================================== */

let studioLocDebounceTimer = null;
let studioLocCurrentMatches = [];

const POPULAR_STUDIO_HUBS = [
  { city: "San Diego", state: "CA", country: "United States", lat: 32.7157, lng: -117.1611, label: "San Diego, CA, United States" },
  { city: "Los Angeles", state: "CA", country: "United States", lat: 34.0522, lng: -118.2437, label: "Los Angeles, CA, United States" },
  { city: "San Francisco", state: "CA", country: "United States", lat: 37.7749, lng: -122.4194, label: "San Francisco, CA, United States" },
  { city: "San Jose", state: "CA", country: "United States", lat: 37.3382, lng: -121.8863, label: "San Jose, CA, United States" },
  { city: "Sacramento", state: "CA", country: "United States", lat: 38.5816, lng: -121.4944, label: "Sacramento, CA, United States" },
  { city: "Austin", state: "TX", country: "United States", lat: 30.2672, lng: -97.7431, label: "Austin, TX, United States" },
  { city: "Dallas", state: "TX", country: "United States", lat: 32.7767, lng: -96.7970, label: "Dallas, TX, United States" },
  { city: "Houston", state: "TX", country: "United States", lat: 29.7604, lng: -95.3698, label: "Houston, TX, United States" },
  { city: "San Antonio", state: "TX", country: "United States", lat: 29.4241, lng: -98.4936, label: "San Antonio, TX, United States" },
  { city: "Fort Worth", state: "TX", country: "United States", lat: 32.7555, lng: -97.3308, label: "Fort Worth, TX, United States" },
  { city: "Seattle", state: "WA", country: "United States", lat: 47.6062, lng: -122.3321, label: "Seattle, WA, United States" },
  { city: "Tacoma", state: "WA", country: "United States", lat: 47.2529, lng: -122.4443, label: "Tacoma, WA, United States" },
  { city: "Portland", state: "OR", country: "United States", lat: 45.5152, lng: -122.6784, label: "Portland, OR, United States" },
  { city: "Chicago", state: "IL", country: "United States", lat: 41.8781, lng: -87.6298, label: "Chicago, IL, United States" },
  { city: "New York", state: "NY", country: "United States", lat: 40.7128, lng: -74.0060, label: "New York, NY, United States" },
  { city: "Brooklyn", state: "NY", country: "United States", lat: 40.6782, lng: -73.9442, label: "Brooklyn, NY, United States" },
  { city: "Atlanta", state: "GA", country: "United States", lat: 33.7490, lng: -84.3880, label: "Atlanta, GA, United States" },
  { city: "Denver", state: "CO", country: "United States", lat: 39.7392, lng: -104.9903, label: "Denver, CO, United States" },
  { city: "Phoenix", state: "AZ", country: "United States", lat: 33.4484, lng: -112.0740, label: "Phoenix, AZ, United States" },
  { city: "Las Vegas", state: "NV", country: "United States", lat: 36.1699, lng: -115.1398, label: "Las Vegas, NV, United States" },
  { city: "Salt Lake City", state: "UT", country: "United States", lat: 40.7608, lng: -111.8910, label: "Salt Lake City, UT, United States" },
  { city: "Orlando", state: "FL", country: "United States", lat: 28.5383, lng: -81.3792, label: "Orlando, FL, United States" },
  { city: "Tampa", state: "FL", country: "United States", lat: 27.9506, lng: -82.4572, label: "Tampa, FL, United States" },
  { city: "Miami", state: "FL", country: "United States", lat: 25.7617, lng: -80.1918, label: "Miami, FL, United States" },
  { city: "Minneapolis", state: "MN", country: "United States", lat: 44.9778, lng: -93.2650, label: "Minneapolis, MN, United States" },
  { city: "Philadelphia", state: "PA", country: "United States", lat: 39.9526, lng: -75.1652, label: "Philadelphia, PA, United States" },
  { city: "Boston", state: "MA", country: "United States", lat: 42.3601, lng: -71.0589, label: "Boston, MA, United States" },
  { city: "Washington", state: "DC", country: "United States", lat: 38.9072, lng: -77.0369, label: "Washington, DC, United States" },
  { city: "Detroit", state: "MI", country: "United States", lat: 42.3314, lng: -83.0458, label: "Detroit, MI, United States" },
  { city: "Columbus", state: "OH", country: "United States", lat: 39.9612, lng: -82.9988, label: "Columbus, OH, United States" },
  { city: "Indianapolis", state: "IN", country: "United States", lat: 39.7684, lng: -86.1581, label: "Indianapolis, IN, United States" },
  { city: "Nashville", state: "TN", country: "United States", lat: 36.1627, lng: -86.7816, label: "Nashville, TN, United States" },
  { city: "Charlotte", state: "NC", country: "United States", lat: 35.2271, lng: -80.8431, label: "Charlotte, NC, United States" },
  { city: "London", state: "Greater London", country: "United Kingdom", lat: 51.5074, lng: -0.1278, label: "London, United Kingdom" },
  { city: "Nottingham", state: "Nottinghamshire", country: "United Kingdom", lat: 52.9548, lng: -1.1581, label: "Nottingham, United Kingdom" },
  { city: "Manchester", state: "Greater Manchester", country: "United Kingdom", lat: 53.4808, lng: -2.2426, label: "Manchester, United Kingdom" },
  { city: "Toronto", state: "ON", country: "Canada", lat: 43.6532, lng: -79.3832, label: "Toronto, ON, Canada" },
  { city: "Vancouver", state: "BC", country: "Canada", lat: 49.2827, lng: -123.1207, label: "Vancouver, BC, Canada" },
  { city: "Montreal", state: "QC", country: "Canada", lat: 45.5017, lng: -73.5673, label: "Montreal, QC, Canada" },
  { city: "Sydney", state: "NSW", country: "Australia", lat: -33.8688, lng: 151.2093, label: "Sydney, NSW, Australia" },
  { city: "Melbourne", state: "VIC", country: "Australia", lat: -37.8136, lng: 144.9631, label: "Melbourne, VIC, Australia" },
  { city: "Paris", state: "Île-de-France", country: "France", lat: 48.8566, lng: 2.3522, label: "Paris, France" },
  { city: "Berlin", state: "Berlin", country: "Germany", lat: 52.5200, lng: 13.4050, label: "Berlin, Germany" }
];

function findLocalHubMatch(text) {
  if (!text) return null;
  const clean = text.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!clean) return null;
  
  // Exact city match
  for (const hub of POPULAR_STUDIO_HUBS) {
    const hubClean = hub.city.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean === hubClean) return hub;
  }
  // Check if query starts with city or city starts with query
  for (const hub of POPULAR_STUDIO_HUBS) {
    const hubClean = hub.city.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean.startsWith(hubClean) || hubClean.startsWith(clean)) return hub;
  }
  // Check includes
  for (const hub of POPULAR_STUDIO_HUBS) {
    const hubLabelClean = hub.label.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (hubLabelClean.includes(clean)) return hub;
  }
  return null;
}

function handleStudioLocationFocus() {
  const input = document.getElementById("create-event-city-state");
  if (!input) return;
  const query = (input.value || "").trim();
  if (!query || query === "San Diego, CA, United States") {
    renderStudioLocationDropdown(POPULAR_STUDIO_HUBS.slice(0, 8));
  } else {
    handleStudioLocationInput(query);
  }
}

function handleStudioLocationInput(val) {
  const badge = document.getElementById("create-event-loc-badge");
  const verifiedFlag = document.getElementById("create-event-loc-verified");
  const spinner = document.getElementById("create-event-loc-spinner");
  const dropdown = document.getElementById("create-event-loc-dropdown");
  const suggestionBar = document.getElementById("create-event-loc-suggestion-bar");
  const bestMatchLabel = document.getElementById("create-event-loc-best-match");

  const query = (val || "").trim();
  const qLower = query.toLowerCase();

  // Instant local lookup
  const localMatches = POPULAR_STUDIO_HUBS.filter(h => 
    h.city.toLowerCase().includes(qLower) || 
    h.label.toLowerCase().includes(qLower)
  );
  studioLocCurrentMatches = localMatches;

  // Check if there is an exact or very close match
  const directMatch = findLocalHubMatch(query);
  if (directMatch) {
    if (bestMatchLabel) bestMatchLabel.textContent = directMatch.label;
    if (suggestionBar) suggestionBar.style.display = "flex";
  } else {
    if (suggestionBar) suggestionBar.style.display = "none";
  }

  // If query is an exact match for a known city (e.g. user typed "San DIego" or "san diego"):
  if (directMatch && (directMatch.city.toLowerCase() === qLower || directMatch.label.toLowerCase() === qLower)) {
    if (verifiedFlag) verifiedFlag.value = "true";
    const elCity = document.getElementById("create-event-loc-city");
    const elState = document.getElementById("create-event-loc-state");
    const elCountry = document.getElementById("create-event-loc-country");
    const elLat = document.getElementById("create-event-loc-lat");
    const elLng = document.getElementById("create-event-loc-lng");
    if (elCity) elCity.value = directMatch.city;
    if (elState) elState.value = directMatch.state || "";
    if (elCountry) elCountry.value = directMatch.country || "United States";
    if (elLat) elLat.value = directMatch.lat;
    if (elLng) elLng.value = directMatch.lng;
    if (badge) {
      badge.style.background = "rgba(16,185,129,0.15)";
      badge.style.color = "#10b981";
      badge.style.borderColor = "rgba(16,185,129,0.3)";
      badge.textContent = "✓ Verified Location";
    }
  } else {
    if (verifiedFlag) verifiedFlag.value = "false";
    if (badge) {
      badge.style.background = "rgba(239, 68, 68, 0.15)";
      badge.style.color = "#ef4444";
      badge.style.borderColor = "rgba(239, 68, 68, 0.3)";
      badge.textContent = "⚠️ Select from Dropdown";
    }
  }

  if (!query || query.length < 2) {
    if (dropdown) dropdown.style.display = "none";
    if (spinner) spinner.style.display = "none";
    return;
  }

  // Render local matches right away with zero network latency
  if (localMatches.length > 0) {
    renderStudioLocationDropdown(localMatches);
  }

  clearTimeout(studioLocDebounceTimer);
  studioLocDebounceTimer = setTimeout(async () => {
    if (spinner) spinner.style.display = "block";

    let remoteMatches = [];
    try {
      // 1. Try our internal server endpoint first
      const serverResp = await fetch(`/api/eventstudio/locations/search?q=${encodeURIComponent(query)}`);
      if (serverResp.ok) {
        const data = await serverResp.json();
        if (data && data.results && data.results.length > 0) {
          remoteMatches = data.results;
        }
      }
    } catch (e) {
      // 2. Fallback to client-side photon if server route is unreachable
      try {
        const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&osm_tag=place:city&osm_tag=place:town`;
        const resp = await fetch(photonUrl, { headers: { "Accept": "application/json" } });
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.features) {
            remoteMatches = data.features.map(f => {
              const p = f.properties || {};
              const city = p.name || p.city || p.town || "";
              const state = p.state || p.county || "";
              const country = p.country || "";
              const coords = (f.geometry && f.geometry.coordinates) || [0, 0];
              const parts = [city, state, country].filter(Boolean);
              return {
                city: city,
                state: state,
                country: country || "United States",
                lat: coords[1],
                lng: coords[0],
                label: parts.join(", ")
              };
            }).filter(m => m.city);
          }
        }
      } catch (e2) {}
    }

    // Combine and deduplicate
    const seen = new Set();
    const combined = [];
    for (const m of [...localMatches, ...remoteMatches]) {
      const key = `${m.city.toLowerCase()}_${(m.state || "").toLowerCase()}_${(m.country || "").toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(m);
      }
      if (combined.length >= 8) break;
    }

    studioLocCurrentMatches = combined;
    if (spinner) spinner.style.display = "none";
    renderStudioLocationDropdown(combined);
  }, 200);
}

function renderStudioLocationDropdown(items) {
  const dropdown = document.getElementById("create-event-loc-dropdown");
  if (!dropdown) return;

  if (!items || items.length === 0) {
    dropdown.innerHTML = `<div style="padding: 12px; font-size: 0.82rem; color: #94a3b8; text-align: center;">No matching cities found. Try typing another city or state name.</div>`;
    dropdown.style.display = "block";
    return;
  }

  let html = `<div style="padding: 6px 10px 6px; font-size: 0.72rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
    <span>Verified Tournament Hubs</span>
    <span style="color:#38bdf8; font-size:0.7rem;">Click to select</span>
  </div>`;
  items.forEach(item => {
    const itemJson = JSON.stringify(item).replace(/"/g, '&quot;');
    const subText = [item.state, item.country].filter(Boolean).join(", ");
    html += `
      <div class="es-loc-item" onclick="selectStudioVerifiedLocation(${itemJson})" style="padding: 9px 12px; cursor: pointer; border-radius: 6px; margin-top: 2px; transition: background 0.15s; display: flex; align-items: center; justify-content: space-between; gap: 10px;" onmouseover="this.style.background='rgba(56,189,248,0.15)'" onmouseout="this.style.background='transparent'">
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 0.88rem; font-weight: 700; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">📍 ${escapeHtml(item.city)}</div>
          <div style="font-size: 0.74rem; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(subText)}</div>
        </div>
        <button type="button" style="background: rgba(56,189,248,0.2); color: #38bdf8; border: 1px solid rgba(56,189,248,0.4); font-size: 0.72rem; font-weight: 700; padding: 4px 10px; border-radius: 6px; pointer-events: none; white-space: nowrap;">
          Select
        </button>
      </div>
    `;
  });

  dropdown.innerHTML = html;
  dropdown.style.display = "block";
}

function selectStudioVerifiedLocation(item) {
  const input = document.getElementById("create-event-city-state");
  const badge = document.getElementById("create-event-loc-badge");
  const dropdown = document.getElementById("create-event-loc-dropdown");
  const suggestionBar = document.getElementById("create-event-loc-suggestion-bar");

  const elCity = document.getElementById("create-event-loc-city");
  const elState = document.getElementById("create-event-loc-state");
  const elCountry = document.getElementById("create-event-loc-country");
  const elLat = document.getElementById("create-event-loc-lat");
  const elLng = document.getElementById("create-event-loc-lng");
  const elVerified = document.getElementById("create-event-loc-verified");

  if (input) input.value = item.label;
  if (elCity) elCity.value = item.city;
  if (elState) elState.value = item.state || "";
  if (elCountry) elCountry.value = item.country || "United States";
  if (elLat) elLat.value = item.lat;
  if (elLng) elLng.value = item.lng;
  if (elVerified) elVerified.value = "true";

  if (badge) {
    badge.style.background = "rgba(16,185,129,0.15)";
    badge.style.color = "#10b981";
    badge.style.borderColor = "rgba(16,185,129,0.3)";
    badge.textContent = "✓ Verified Location";
  }

  if (dropdown) dropdown.style.display = "none";
  if (suggestionBar) suggestionBar.style.display = "none";
}

function selectBestMatchLocation() {
  const input = document.getElementById("create-event-city-state");
  const query = input ? input.value : "";
  const match = findLocalHubMatch(query) || (studioLocCurrentMatches && studioLocCurrentMatches[0]);
  if (match) {
    selectStudioVerifiedLocation(match);
  }
}

function handleStudioLocationBlur() {
  // Give click events on dropdown 250ms to fire first
  setTimeout(() => {
    const verifiedFlag = document.getElementById("create-event-loc-verified");
    if (!verifiedFlag || verifiedFlag.value !== "true") {
      const input = document.getElementById("create-event-city-state");
      if (input && input.value.trim()) {
        const match = findLocalHubMatch(input.value.trim());
        if (match) {
          selectStudioVerifiedLocation(match);
        }
      }
    }
  }, 250);
}

window.handleStudioLocationInput = handleStudioLocationInput;
window.handleStudioLocationFocus = handleStudioLocationFocus;
window.handleStudioLocationBlur = handleStudioLocationBlur;
window.selectStudioVerifiedLocation = selectStudioVerifiedLocation;
window.selectBestMatchLocation = selectBestMatchLocation;

// Close dropdown on click outside
document.addEventListener("click", (e) => {
  const dropdown = document.getElementById("create-event-loc-dropdown");
  const input = document.getElementById("create-event-city-state");
  const suggestionBar = document.getElementById("create-event-loc-suggestion-bar");
  if (dropdown && input && !dropdown.contains(e.target) && e.target !== input) {
    dropdown.style.display = "none";
  }
  if (suggestionBar && !suggestionBar.contains(e.target) && e.target !== input) {
    // Keep suggestion bar visible if still unverified
  }
});
