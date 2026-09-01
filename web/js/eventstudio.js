/**
 * Event Studio | Tournament Director & BCP Organizer Suite (v13.0)
 * Streamlined tournament management: creation, listing, and BCP synchronization.
 */

let studioState = {
  activeTab: "events",
  eventsList: [],
  activeTournament: null
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

function switchStudioTab(tabName) {
  if (typeof switchTab === 'function') switchTab('event-studio');
  studioState.activeTab = tabName || 'events';
  const views = ["events", "create"];

  views.forEach(v => {
    const el = document.getElementById(`es-view-${v}`);
    if (el) {
      el.style.display = (v === studioState.activeTab) ? "block" : "none";
    }
  });

  if (studioState.activeTab === "events") {
    renderEventsDirectory();
  }
}

function renderEventsDirectory() {
  const container = document.getElementById("es-events-list");
  if (!container) return;

  const events = studioState.eventsList;

  if (!events || events.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; background: var(--bg-card); border: 1px dashed var(--border); border-radius: var(--radius-lg); padding: 3.5rem 1.5rem; text-align: center;">
        <div style="font-size: 2.8rem; margin-bottom: 0.75rem;">⚔️</div>
        <h3 style="color: #fff; margin: 0 0 0.5rem; font-size: 1.3rem;">No Tournaments Directing Yet</h3>
        <p style="color: var(--text-secondary); font-size: 0.9rem; max-width: 520px; margin: 0 auto; line-height: 1.6;">
          Create a new tournament to publish listings to Best Coast Pairings and manage player registrations.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = events.map(ev => {
    const rounds = ev.num_rounds || ev.rounds || 5;
    const tier = ev.tier || "Grand Tournament";
    const roster = ev.roster || [];
    const location = [ev.venue, ev.city, ev.state].filter(Boolean).join(", ") || "Local Venue";
    const dateStr = ev.event_date ? (String(ev.event_date).split("T")[0]) : "Date TBD";
    const isBcp = ev.id && !ev.id.startsWith("ES-");

    return `
      <div class="es-event-card" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.35rem; display: flex; flex-direction: column; justify-content: space-between; gap: 1rem; transition: transform 0.2s ease, border-color 0.2s ease;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
            <span class="badge badge-accent" style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase;">${escapeHtml(tier)}</span>
            ${isBcp ? '<span class="badge badge-online" style="font-size: 0.7rem;">BCP SYNCED</span>' : '<span class="badge" style="font-size: 0.7rem; background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3);">LOCAL</span>'}
          </div>
          <h4 style="margin: 0 0 0.4rem; color: #fff; font-size: 1.15rem; font-family: var(--font-heading);">${escapeHtml(ev.name)}</h4>
          <div style="font-size: 0.8rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 0.25rem;">
            <div>📅 ${escapeHtml(dateStr)} • 📍 ${escapeHtml(location)}</div>
            <div>👥 <b>${roster.length} / ${ev.capacity || 32}</b> Players • 🎲 <b>${rounds}</b> Rounds (${ev.points || 2000} pts)</div>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border); padding-top: 0.85rem; margin-top: 0.25rem;">
          <span style="font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono);">${escapeHtml(ev.id)}</span>
          <button class="btn btn-outline" style="font-size: 0.76rem; padding: 0.3rem 0.65rem; color: #ef4444; border-color: rgba(239,68,68,0.35);" onclick="deleteStudioTournament('${escapeHtml(ev.id)}')">🗑️ Delete</button>
        </div>
      </div>
    `;
  }).join("");
}

async function submitCreateTournament() {
  const nameInput = document.getElementById("create-event-name");
  const formatInput = document.getElementById("create-event-format");
  const roundsInput = document.getElementById("create-event-rounds");
  const startInput = document.getElementById("create-event-start-date");
  const endInput = document.getElementById("create-event-end-date");
  const capacityInput = document.getElementById("create-event-capacity");
  const pointsInput = document.getElementById("create-event-points");
  const venueInput = document.getElementById("create-event-venue");
  const cityStateInput = document.getElementById("create-event-city-state");
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
    tier: formatInput ? formatInput.value : "Grand Tournament",
    rounds: roundsInput ? parseInt(roundsInput.value, 10) : 5,
    start_date: startInput ? startInput.value : "",
    end_date: endInput ? endInput.value : (startInput ? startInput.value : ""),
    capacity: capacityInput ? parseInt(capacityInput.value, 10) : 32,
    points: pointsInput ? parseInt(pointsInput.value, 10) : 2000,
    venue: venueInput ? venueInput.value.trim() : "",
    city: cityStateInput ? cityStateInput.value.trim() : "",
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
      if (res.bcp_registered) {
        alert(`🎉 Tournament "${name}" successfully created and registered on Best Coast Pairings!`);
      } else {
        alert(`🎉 Tournament "${name}" created in Event Studio (${res.event_id || 'Local'})!\n\nNote: To publish an official listing on Best Coast Pairings, create the tournament via BCP's "+ Create Event" button and click "Sync BCP Events" to link it.`);
      }
      if (nameInput) nameInput.value = "";
      if (venueInput) venueInput.value = "";
      if (cityStateInput) cityStateInput.value = "";
      switchStudioTab("events");
      await loadStudioEvents();
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

async function deleteStudioTournament(eventId) {
  if (!confirm(`Are you sure you want to delete tournament "${eventId}"? This action cannot be undone.`)) {
    return;
  }

  try {
    const res = await window.api.deleteStudioEvent(eventId);
    if (res && res.success) {
      alert("Tournament deleted successfully.");
      await loadStudioEvents();
    } else {
      alert(res.message || "Could not delete tournament.");
    }
  } catch (err) {
    console.error("Delete error:", err);
    alert(`Delete failed: ${err.message || err}`);
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

async function promptImportBcpEvent() {
  const input = prompt("Enter Best Coast Pairings Event ID or URL:\n(e.g., QEwy45HcX1Cv or https://www.bestcoastpairings.com/event/QEwy45HcX1Cv)");
  if (!input || !input.trim()) return;

  try {
    const res = await window.api.importStudioEvent(input.trim());
    if (res && res.success) {
      alert(`🎉 Successfully imported "${res.event?.name || 'Tournament'}" (${res.event?.id || ''}) from Best Coast Pairings!`);
      await loadStudioEvents();
    } else {
      alert(res.detail || res.error || "Failed to import tournament from BCP.");
    }
  } catch (err) {
    alert(`Import failed: ${err.message || err}`);
  }
}

// Global window bindings for Event Studio
window.initStudio = initStudio;
window.loadStudioEvents = loadStudioEvents;
window.switchStudioTab = switchStudioTab;
window.renderEventsDirectory = renderEventsDirectory;
window.submitCreateTournament = submitCreateTournament;
window.deleteStudioTournament = deleteStudioTournament;
window.updateDefaultRounds = updateDefaultRounds;
window.promptImportBcpEvent = promptImportBcpEvent;
