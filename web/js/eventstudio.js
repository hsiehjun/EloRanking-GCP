/**
 * Event Studio | Tournament Director & BCP Organizer Suite (v12.0)
 * Full Two-Way BCP Tournament Management, Real Event Importer, Swiss Pairings, 
 * 1-Click Table Trackers, Roster Management & Live Swiss Standings.
 */

let studioState = {
  activeTab: 'events',
  currentRound: 1,
  selectedScoreMethod: 'quick',
  parsedScorecardData: null,
  activeScoringTable: null,
  timerSeconds: 9000,
  timerInterval: null,
  timerRunning: false,
  eventsList: [],
  activeTournament: null
};

document.addEventListener('DOMContentLoaded', () => {
  initStudio();
});

function getBcpToken() {
  return localStorage.getItem('bcp_jwt') || 
         localStorage.getItem('bcp_token') || 
         localStorage.getItem('bcp_organizer_token') || 
         localStorage.getItem('bcp_user_token') || 
         localStorage.getItem('auth_token') || '';
}

async function initStudio() {
  updateStudioAuthBadge();
  setDefaultEventDates();
  await loadStudioEvents();
}

function setDefaultEventDates() {
  const today = new Date().toISOString().split('T')[0];
  const startInput = document.getElementById('create-event-start-date');
  const endInput = document.getElementById('create-event-end-date');
  if (startInput && !startInput.value) startInput.value = today;
  if (endInput && !endInput.value) endInput.value = today;
}

function updateStudioAuthBadge() {
  const badge = document.getElementById('es-auth-label');
  const dot = document.querySelector('.es-auth-badge .status-dot');
  const user = typeof currentUser !== 'undefined' ? currentUser : null;

  if (badge) {
    if (user && user.bcp_user_id) {
      badge.textContent = `🟢 BCP Connected (${user.bcp_email || user.display_name})`;
      badge.style.color = '#10b981';
      if (dot) dot.style.background = '#10b981';
    } else if (user) {
      badge.textContent = `🔵 Signed in as ${user.display_name} (Link BCP in Account)`;
      badge.style.color = '#38bdf8';
      if (dot) dot.style.background = '#38bdf8';
    } else {
      badge.textContent = '⚪ Tournament Director Suite';
      badge.style.color = 'var(--text-muted)';
      if (dot) dot.style.background = '#94a3b8';
    }
  }
}

async function loadStudioEvents() {
  const listContainer = document.getElementById('es-events-list');
  if (listContainer) {
    listContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 2rem; text-align: center;"><div class="spinner" style="margin: 0 auto 0.5rem;"></div>Loading managed tournaments...</div>';
  }

  try {
    const res = await window.api.getStudioEvents();
    studioState.eventsList = (res && res.events) ? res.events : [];
    
    const countEl = document.getElementById('es-events-count');
    if (countEl) countEl.textContent = studioState.eventsList.length;

    if (studioState.eventsList.length > 0) {
      const savedId = localStorage.getItem('es_active_event_id');
      const savedMatch = studioState.eventsList.find(e => e.id === savedId);
      studioState.activeTournament = savedMatch || studioState.eventsList[0];
    } else {
      studioState.activeTournament = null;
    }
    
    try { renderTournamentBanner(); } catch(e) { console.warn('banner err:', e); }
    try { renderEventsDirectory(); } catch(e) { console.warn('events dir err:', e); }
    try { renderRoster(); } catch(e) { console.warn('roster err:', e); }
    try { renderRoundButtons(); } catch(e) { console.warn('round btns err:', e); }
    try { renderPairings(); } catch(e) { console.warn('pairings err:', e); }
    try { renderStandings(); } catch(e) { console.warn('standings err:', e); }
  } catch (err) {
    console.warn('Notice loading studio events:', err);
    studioState.eventsList = [];
    studioState.activeTournament = null;
    try { renderTournamentBanner(); } catch(e) {}
    try { renderEventsDirectory(); } catch(e) {}
  }
}

function switchStudioTab(tabName) {
  studioState.activeTab = tabName;
  const tabs = ['events', 'dashboard', 'pairings', 'wtc', 'pods', 'roster', 'standings', 'create'];

  tabs.forEach(t => {
    const btn = document.getElementById(`tab-btn-${t}`);
    const view = document.getElementById(`es-view-${t}`);
    if (btn && view) {
      if (t === tabName) {
        btn.classList.add('active');
        view.style.display = 'block';
      } else {
        btn.classList.remove('active');
        view.style.display = 'none';
      }
    }
  });

  try {
    if (tabName === 'events') renderEventsDirectory();
    else if (tabName === 'dashboard') renderDashboard();
    else if (tabName === 'roster') renderRoster();
    else if (tabName === 'pairings') {
      renderRoundButtons();
      renderPairings();
    }
    else if (tabName === 'wtc') renderWtcDraftMatrix();
    else if (tabName === 'pods') previewPodBreakdown();
    else if (tabName === 'standings') renderStandings();
  } catch (err) {
    console.error('Error rendering subtab ' + tabName + ':', err);
  }
}

function renderTournamentBanner() {
  const banner = document.getElementById('es-current-event-banner');
  const t = studioState.activeTournament;

  if (!t) {
    if (banner) banner.style.display = 'none';
    const rosterCountEl = document.getElementById('es-roster-count');
    if (rosterCountEl) rosterCountEl.textContent = '0';
    return;
  }

  if (banner) banner.style.display = 'flex';

  const tierEl = document.getElementById('current-event-tier');
  const nameEl = document.getElementById('current-event-name');
  const regEl = document.getElementById('current-event-registered');
  const datesEl = document.getElementById('ce-dates');
  const locEl = document.getElementById('ce-location');
  const rosterCountEl = document.getElementById('es-roster-count');
  const roundStatusEl = document.getElementById('ce-round-status');

  const rounds = t.num_rounds || t.rounds || 5;
  const tier = t.tier || 'Grand Tournament';
  const roster = t.roster || [];
  const location = [t.venue, t.city, t.state].filter(Boolean).join(', ') || 'Online / Local Venue';
  const dateStr = t.event_date ? (String(t.event_date).split('T')[0]) : 'Date TBD';

  if (tierEl) tierEl.textContent = `${tier.toUpperCase()} • ${rounds} ROUNDS`;
  if (nameEl) nameEl.textContent = t.name;
  if (regEl) regEl.textContent = `${roster.length} / ${t.capacity || 32}`;
  if (rosterCountEl) rosterCountEl.textContent = roster.length;
  if (datesEl) datesEl.textContent = `📅 ${dateStr}`;
  if (locEl) locEl.textContent = `📍 ${location}`;
  if (roundStatusEl) roundStatusEl.textContent = `Round ${studioState.currentRound} Active`;
}

function renderEventsDirectory() {
  const container = document.getElementById('es-events-list');
  if (!container) return;

  const events = studioState.eventsList;

  if (!events || events.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; background: var(--bg-card); border: 1px dashed var(--border); border-radius: var(--radius-lg); padding: 3.5rem 1.5rem; text-align: center;">
        <div style="font-size: 2.8rem; margin-bottom: 0.75rem;">⚔️</div>
        <h3 style="color: #fff; margin: 0 0 0.5rem; font-size: 1.3rem;">No Tournaments Directing Yet</h3>
        <p style="color: var(--text-secondary); font-size: 0.9rem; max-width: 520px; margin: 0 auto 1.5rem; line-height: 1.6;">
          Create a new tournament from scratch, or import any live/upcoming tournament directly from Best Coast Pairings to manage Swiss pairings, rosters, and live table trackers.
        </p>
        <div style="display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;">
          <button class="btn btn-primary" onclick="switchStudioTab('create')">➕ Create Tournament</button>
          <button class="btn btn-outline" onclick="openImportBcpModal()">🔗 Import BCP Event</button>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = events.map(ev => {
    const isCurrent = studioState.activeTournament && studioState.activeTournament.id === ev.id;
    const rounds = ev.num_rounds || ev.rounds || 5;
    const tier = ev.tier || 'Grand Tournament';
    const roster = ev.roster || [];
    const location = [ev.venue, ev.city, ev.state].filter(Boolean).join(', ') || 'Local Venue';
    const dateStr = ev.event_date ? (String(ev.event_date).split('T')[0]) : 'Date TBD';

    return `
      <div class="es-pairing-card" style="border: 1px solid ${isCurrent ? 'var(--accent)' : 'var(--border)'}; background: ${isCurrent ? 'rgba(56, 189, 248, 0.04)' : 'var(--bg-card)'};">
        <div class="es-pairing-header">
          <span class="es-table-label" style="color: ${isCurrent ? 'var(--accent)' : 'var(--text-muted)'};">
            ${isCurrent ? 'ACTIVE TOURNAMENT' : (ev.id.startsWith('ES-') ? 'EVENT STUDIO TOURNAMENT' : 'BCP SYNCED EVENT')}
          </span>
          <span class="es-status-chip">${escapeHtml(tier)}</span>
        </div>
        <div style="margin: 0.5rem 0;">
          <h4 style="margin: 0 0 0.4rem; font-size: 1.15rem; color: #fff; line-height: 1.3;">${escapeHtml(ev.name)}</h4>
          <div style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.6;">
            📅 ${dateStr} • 📍 ${escapeHtml(location)}<br>
            👥 <b>${roster.length}</b> / ${ev.capacity || 32} Players • 🎲 ${rounds} Rounds (${ev.points || 2000} pts)
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem; margin-top: 1rem; flex-wrap: wrap;">
          <button class="btn btn-primary" style="font-size: 0.78rem; padding: 0.35rem 0.75rem;" onclick="selectStudioTournament('${ev.id}')">
            ${isCurrent ? '🎲 Manage Pairings' : 'Select & Manage'}
          </button>
          <button class="btn btn-outline" style="font-size: 0.78rem; padding: 0.35rem 0.75rem;" onclick="selectStudioTournament('${ev.id}', 'roster')">
            👥 Roster
          </button>
          ${!ev.id.startsWith('ES-') ? `
            <a href="https://www.bestcoastpairings.com/event/${encodeURIComponent(ev.id)}" target="_blank" class="btn btn-outline" style="font-size: 0.78rem; padding: 0.35rem 0.75rem; text-decoration: none; color: var(--accent);">
              🔗 BCP ↗
            </a>
          ` : ''}
          <button class="btn btn-outline" style="font-size: 0.78rem; padding: 0.35rem 0.75rem; color: #ef4444; border-color: rgba(239,68,68,0.4);" onclick="deleteStudioTournament('${ev.id}')">
            🗑️ Delete Event
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function selectStudioTournament(eventId, targetTab = 'pairings') {
  try {
    const res = await window.api.getStudioEvent(eventId);
    if (res && res.event) {
      studioState.activeTournament = res.event;
    } else {
      const match = studioState.eventsList.find(e => e.id === eventId);
      if (match) studioState.activeTournament = match;
    }
  } catch (e) {
    const match = studioState.eventsList.find(e => e.id === eventId);
    if (match) studioState.activeTournament = match;
  }

  if (studioState.activeTournament) {
    localStorage.setItem('es_active_event_id', studioState.activeTournament.id);
  }

  renderTournamentBanner();
  renderEventsDirectory();
  renderRoster();
  renderRoundButtons();
  renderPairings();
  renderStandings();
  switchStudioTab(targetTab);
}

function openImportBcpModal() {
  const modal = document.getElementById('import-bcp-modal');
  if (modal) {
    modal.classList.add('active');
    const input = document.getElementById('import-bcp-input');
    if (input) {
      input.value = '';
      input.focus();
    }
    const status = document.getElementById('import-bcp-status');
    if (status) status.style.display = 'none';
  }
}

async function submitImportBcpTournament() {
  const input = document.getElementById('import-bcp-input');
  const btn = document.getElementById('btn-submit-import-bcp');
  const status = document.getElementById('import-bcp-status');

  const val = input ? input.value.trim() : '';
  if (!val) {
    alert('Please enter a BCP Event ID or URL.');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Importing from BCP...';
  }
  if (status) {
    status.style.display = 'block';
    status.textContent = 'Fetching event details, competitor roster, and pairings from Best Coast Pairings...';
  }

  try {
    const res = await window.api.importStudioEvent({ event_id: val });
    if (res && res.success && res.event) {
      alert(`🎉 Successfully imported "${res.event.name}" into Event Studio!`);
      closeModal('import-bcp-modal');
      studioState.activeTournament = res.event;
      localStorage.setItem('es_active_event_id', res.event.id);
      await loadStudioEvents();
      switchStudioTab('pairings');
    } else {
      alert(res.message || 'Could not import event. Please verify the BCP ID or URL.');
    }
  } catch (err) {
    console.error('Import error:', err);
    alert(`Import failed: ${err.message || err}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔗 Import & Direct';
    }
    if (status) status.style.display = 'none';
  }
}

function renderRoundButtons() {
  const container = document.getElementById('es-rounds-btn-bar');
  if (!container) return;

  const t = studioState.activeTournament;
  const numRounds = t ? (t.num_rounds || t.rounds || 5) : 5;

  let html = '';
  for (let r = 1; r <= numRounds; r++) {
    const isActive = studioState.currentRound === r;
    html += `<button class="es-round-switch-btn ${isActive ? 'active' : ''}" id="btn-rd-${r}" onclick="switchPairingsRound(${r})">R${r}</button>`;
  }
  container.innerHTML = html;
}

function switchPairingsRound(r) {
  studioState.currentRound = r;
  const t = studioState.activeTournament;
  const numRounds = t ? (t.num_rounds || t.rounds || 5) : 5;

  for (let i = 1; i <= numRounds; i++) {
    const btn = document.getElementById(`btn-rd-${i}`);
    if (btn) {
      if (i === r) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  }
  renderPairings();
}

function renderPairings() {
  const container = document.getElementById('es-pairings-list');
  const rdNum = document.getElementById('pairings-current-round');
  if (!container) return;

  const r = studioState.currentRound;
  if (rdNum) rdNum.textContent = r;

  const t = studioState.activeTournament;
  if (!t) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 3.5rem 1rem; text-align: center; color: var(--text-muted); background: var(--bg-card); border: 1px dashed var(--border); border-radius: var(--radius-lg);">
        <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🎲</div>
        <h4 style="color: #fff; margin: 0 0 0.4rem; font-size: 1.15rem;">No Tournament Selected</h4>
        <div style="font-size: 0.85rem; margin-bottom: 1.25rem;">Select or create a tournament to view and direct Swiss pairings.</div>
        <div style="display: flex; gap: 0.5rem; justify-content: center;">
          <button class="btn btn-primary" onclick="switchStudioTab('create')">➕ Create Tournament</button>
          <button class="btn btn-outline" onclick="openImportBcpModal()">🔗 Import BCP Event</button>
        </div>
      </div>
    `;
    return;
  }

  const pairingsMap = t.pairings || {};
  const pairings = pairingsMap[String(r)] || pairingsMap[r] || [];

  if (pairings.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 3rem 1rem; text-align: center; color: var(--text-muted); background: var(--bg-card); border: 1px dashed var(--border); border-radius: var(--radius-lg);">
        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">🎲</div>
        <h4 style="color: #fff; margin: 0 0 0.4rem;">No Pairings Generated for Round ${r}</h4>
        <div style="font-size: 0.85rem; margin-bottom: 1.25rem;">Click "Auto-Pair Swiss" to pair registered players according to official Swiss standings.</div>
        <button class="btn btn-primary" onclick="generateSwissPairings()">🎲 Generate Swiss Pairings</button>
      </div>
    `;
    return;
  }

  const rosterMap = {};
  (t.roster || []).forEach(p => rosterMap[p.id] = p);

  container.innerHTML = pairings.map(pair => {
    const p1 = rosterMap[pair.p1] || { name: pair.p1_name || 'Player 1', faction: pair.p1_faction || 'Unknown Faction' };
    const p2 = rosterMap[pair.p2] || { name: pair.p2_name || (pair.p2 ? 'Player 2' : 'BYE'), faction: pair.p2_faction || (pair.p2 ? 'Unknown Faction' : '') };
    const isCompleted = pair.status === 'completed' || (pair.p1Score !== null && pair.p1Score !== undefined && pair.p2Score !== null && pair.p2Score !== undefined);
    const matchId = `BCP-${t.id}-R${r}-T${pair.table}`.toUpperCase();

    return `
      <div class="es-pairing-card ${isCompleted ? 'completed' : ''}" style="background: var(--bg-card); border: 1px solid ${isCompleted ? 'rgba(16, 185, 129, 0.4)' : 'var(--border)'}; border-radius: var(--radius-md); padding: 1.15rem;">
        <div class="es-pairing-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <span class="es-table-label" style="font-weight: 800; font-family: var(--font-mono); color: var(--accent);">TABLE ${pair.table}</span>
          <span class="es-status-chip ${isCompleted ? 'badge-match-prime' : ''}">
            ${isCompleted ? `✅ Final: ${pair.p1Score} - ${pair.p2Score} VP` : '⏳ Round Active'}
          </span>
        </div>
        
        <div class="es-pairing-matchup" style="display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
          <div class="es-competitor" style="flex: 1;">
            <div class="es-comp-name" style="font-weight: 700; color: #fff; font-size: 0.95rem;">${escapeHtml(p1.name)}</div>
            <div class="es-comp-sub" style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(p1.faction)}</div>
          </div>
          <div class="es-pairing-vs" style="font-weight: 800; font-family: var(--font-mono); color: var(--accent); font-size: 0.85rem;">VS</div>
          <div class="es-competitor" style="flex: 1; text-align: right;">
            <div class="es-comp-name" style="font-weight: 700; color: #fff; font-size: 0.95rem;">${escapeHtml(p2.name)}</div>
            <div class="es-comp-sub" style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(p2.faction)}</div>
          </div>
        </div>

        <div class="es-pairing-score-bar" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; border-top: 1px solid var(--border); padding-top: 0.75rem;">
          <div style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 700; color: #fff;">
            ${isCompleted ? `${pair.p1Score} - ${pair.p2Score} VP` : '<span style="color: var(--text-muted); font-size: 0.8rem;">Score Pending</span>'}
          </div>
          <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
            <button class="btn btn-outline" style="font-size: 0.75rem; padding: 0.3rem 0.65rem; color: #38bdf8; border-color: rgba(56,189,248,0.4);" onclick="openMatchPredictorModal('${escapeHtml(p1.name)}', '${escapeHtml(p2.name)}', '${escapeHtml(p1.faction)}', '${escapeHtml(p2.faction)}', '${pair.p1}', '${pair.p2}')">
              🔮 Predict
            </button>
            <button class="btn btn-outline" style="font-size: 0.75rem; padding: 0.3rem 0.65rem;" onclick="launchTournamentTracker('${t.id}', ${r}, ${pair.table}, '${escapeHtml(p1.name)}', '${escapeHtml(p2.name)}', '${pair.p1}', '${pair.p2}')">
              🎲 Track Table
            </button>
            <button class="btn btn-primary" style="font-size: 0.75rem; padding: 0.3rem 0.65rem;" onclick="openQuickScoreModal(${pair.table})">
              ${isCompleted ? '✏️ Edit Score' : '⚔️ Enter Score'}
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function launchTournamentTracker(eventId, roundNum, tableNum, p1Name, p2Name, p1Id, p2Id) {
  const gameId = `BCP-${eventId}-R${roundNum}-T${tableNum}`.toUpperCase();
  const url = `/tracker.html?game_id=${encodeURIComponent(gameId)}&event_id=${encodeURIComponent(eventId)}&p1=${encodeURIComponent(p1Name)}&p2=${encodeURIComponent(p2Name)}`;
  window.open(url, '_blank');
}

function generateSwissPairings() {
  const t = studioState.activeTournament;
  if (!t) return;

  const roster = (t.roster || []).filter(p => p.checkedIn !== false);
  if (roster.length < 2) {
    alert('At least 2 checked-in players are required to generate pairings.');
    return;
  }

  const r = studioState.currentRound;
  const pairings = [];
  
  const sorted = [...roster];
  if (r > 1) {
    const standings = computeStandingsArray();
    sorted.sort((a, b) => {
      const sa = standings.find(s => String(s.id) === String(a.id)) || { wins: 0, points: 0 };
      const sb = standings.find(s => String(s.id) === String(b.id)) || { wins: 0, points: 0 };
      return (sb.wins - sa.wins) || (sb.points - sa.points);
    });
  } else {
    sorted.sort(() => Math.random() - 0.5);
  }

  let table = 1;
  for (let i = 0; i < sorted.length; i += 2) {
    if (i + 1 < sorted.length) {
      pairings.push({
        table: table++,
        p1: sorted[i].id,
        p2: sorted[i + 1].id,
        p1_name: sorted[i].name,
        p2_name: sorted[i + 1].name,
        p1_faction: sorted[i].faction,
        p2_faction: sorted[i + 1].faction,
        p1Score: null,
        p2Score: null,
        status: 'pending'
      });
    } else {
      pairings.push({
        table: table++,
        p1: sorted[i].id,
        p2: null,
        p1_name: sorted[i].name,
        p2_name: 'BYE',
        p1_faction: sorted[i].faction,
        p2_faction: '',
        p1Score: 100,
        p2Score: 0,
        status: 'completed'
      });
    }
  }

  if (!t.pairings) t.pairings = {};
  t.pairings[String(r)] = pairings;
  
  renderPairings();
  renderStandings();
  saveCurrentPairings();
}

async function saveCurrentPairings() {
  const t = studioState.activeTournament;
  if (!t) return;

  const r = studioState.currentRound;
  const pairings = (t.pairings || {})[String(r)] || [];

  try {
    const res = await window.api.saveStudioPairings(t.id, {
      round: r,
      pairings: pairings
    });
    if (res && res.success) {
      if (res.bcp_pushed) {
        alert(`✅ Round ${r} Pairings Saved & Pushed to Best Coast Pairings!`);
      }
    }
  } catch (err) {
    console.warn('Notice saving pairings:', err);
  }
}

function openQuickScoreModal(tableNum) {
  const t = studioState.activeTournament;
  if (!t) return;

  const r = studioState.currentRound;
  const pairings = (t.pairings || {})[String(r)] || [];
  const pair = pairings.find(p => p.table === tableNum);
  if (!pair) return;

  studioState.activeScoringTable = tableNum;
  studioState.parsedScorecardData = null;

  const modal = document.getElementById('score-entry-modal');
  if (!modal) return;

  const tableLabel = document.getElementById('score-table-num');
  if (tableLabel) tableLabel.textContent = tableNum;

  const p1NameEl = document.getElementById('score-p1-name');
  const p1FacEl = document.getElementById('score-p1-faction');
  const p1VpEl = document.getElementById('input-p1-vp');

  const p2NameEl = document.getElementById('score-p2-name');
  const p2FacEl = document.getElementById('score-p2-faction');
  const p2VpEl = document.getElementById('input-p2-vp');

  if (p1NameEl) p1NameEl.textContent = pair.p1_name || 'Player 1';
  if (p1FacEl) p1FacEl.textContent = pair.p1_faction || 'Army 1';
  if (p1VpEl) p1VpEl.value = pair.p1Score !== null && pair.p1Score !== undefined ? pair.p1Score : 75;

  if (p2NameEl) p2NameEl.textContent = pair.p2_name || 'Player 2';
  if (p2FacEl) p2FacEl.textContent = pair.p2_faction || 'Army 2';
  if (p2VpEl) p2VpEl.value = pair.p2Score !== null && pair.p2Score !== undefined ? pair.p2Score : 60;

  const prevBox = document.getElementById('scorecard-preview-box');
  if (prevBox) prevBox.style.display = 'none';

  switchScoreMethod('quick');
  modal.classList.add('active');
}

function closeScoreEntryModal() {
  const modal = document.getElementById('score-entry-modal');
  if (modal) modal.classList.remove('active');
  studioState.activeScoringTable = null;
  studioState.parsedScorecardData = null;
}

function switchScoreMethod(method) {
  studioState.selectedScoreMethod = method;

  ['quick', 'ttb', 'gdm', 'gw'].forEach(m => {
    const tabBtn = document.getElementById(`sm-tab-${m}`);
    if (tabBtn) tabBtn.classList.toggle('active', m === method);
  });

  const viewQuick = document.getElementById('sm-view-quick');
  const viewImport = document.getElementById('sm-view-import');

  if (method === 'quick') {
    if (viewQuick) viewQuick.style.display = 'block';
    if (viewImport) viewImport.style.display = 'none';
  } else {
    if (viewQuick) viewQuick.style.display = 'none';
    if (viewImport) viewImport.style.display = 'block';

    const titleEl = document.getElementById('import-instructions-title');
    const descEl = document.getElementById('import-instructions-desc');

    if (method === 'ttb') {
      if (titleEl) titleEl.textContent = '⚔️ Paste Tabletop Battles Export (JSON or Text)';
      if (descEl) descEl.textContent = 'Paste the text or JSON export from Tabletop Battles. The parser extracts Primary VP, Secondaries, and Paint bonuses.';
    } else if (method === 'gdm') {
      if (titleEl) titleEl.textContent = '🎴 Paste GDM App / Scorecard';
      if (descEl) descEl.textContent = 'Paste the scorecard text or JSON from the GDM game tracker.';
    } else {
      if (titleEl) titleEl.textContent = '🛡️ Paste Official Warhammer 40k App / Match Text';
      if (descEl) descEl.textContent = 'Paste match results from the official app or summary text (e.g. "Alice 85 vs Bob 72").';
    }
  }
}

async function parseImportedScorecard() {
  const txt = document.getElementById('app-import-textarea');
  if (!txt || !txt.value.trim()) {
    alert('Please paste the scorecard text or JSON export.');
    return;
  }

  try {
    const res = await window.api.parseScorecard(txt.value.trim());
    if (res.scorecard) {
      const sc = res.scorecard;
      studioState.parsedScorecardData = sc;

      const p1VpEl = document.getElementById('input-p1-vp');
      const p2VpEl = document.getElementById('input-p2-vp');

      if (p1VpEl) p1VpEl.value = sc.player1.total_score;
      if (p2VpEl) p2VpEl.value = sc.player2.total_score;

      const prevBox = document.getElementById('scorecard-preview-box');
      const prevSummary = document.getElementById('scorecard-parsed-summary');
      if (prevBox && prevSummary) {
        prevSummary.innerHTML = `
          <div style="font-weight:700; color:#fff;">${sc.player1.name} (${sc.player1.total_score} VP) vs ${sc.player2.name} (${sc.player2.total_score} VP)</div>
          <div style="font-size:0.75rem; color:#94a3b8; margin-top:2px;">Mission: ${sc.mission} • Winner: <b style="color:#10b981;">${sc.winner_name}</b></div>
        `;
        prevBox.style.display = 'block';
      }

      // Switch back to quick view so TO can see populated VP
      const viewQuick = document.getElementById('sm-view-quick');
      if (viewQuick) viewQuick.style.display = 'block';
      alert('✅ Scorecard parsed and Battle Points populated!');
    }
  } catch(e) {
    alert('Error parsing scorecard: ' + e.message);
  }
}

async function saveMatchScoreAndSync() {
  const tableNum = studioState.activeScoringTable;
  const t = studioState.activeTournament;
  if (!t || !tableNum) return;

  const r = studioState.currentRound;
  const pairings = (t.pairings || {})[String(r)] || [];
  const pair = pairings.find(p => p.table === tableNum);
  if (!pair) return;

  const p1VpEl = document.getElementById('input-p1-vp');
  const p2VpEl = document.getElementById('input-p2-vp');

  pair.p1Score = parseInt(p1VpEl ? p1VpEl.value : '0', 10) || 0;
  pair.p2Score = parseInt(p2VpEl ? p2VpEl.value : '0', 10) || 0;
  pair.status = 'completed';

  renderPairings();
  renderStandings();
  closeScoreEntryModal();

  // Save to database & BCP
  const payload = {
    event_id: t.id,
    table: tableNum,
    round_num: r,
    p1_score: pair.p1Score,
    p2_score: pair.p2Score,
    p1_name: pair.p1_name,
    p2_name: pair.p2_name,
    source_app: studioState.selectedScoreMethod || 'EventStudio'
  };

  try {
    await window.api.submitScoreToBcp(payload);
  } catch(e) {
    console.warn('Score submission notice:', e);
  }

  // Also import as verified scorecard if parsed data exists
  if (studioState.parsedScorecardData) {
    try {
      const scData = studioState.parsedScorecardData;
      scData.event_id = t.id;
      scData.round_num = r;
      scData.table_num = tableNum;
      await window.api.importScorecard(scData);
    } catch(e) {}
  }

  saveCurrentPairings();
  alert(`✅ Table ${tableNum} score saved: ${pair.p1_name} (${pair.p1Score}) - ${pair.p2_name} (${pair.p2Score})`);
}

function renderRoster() {
  const tbody = document.getElementById('es-roster-tbody');
  if (!tbody) return;

  const t = studioState.activeTournament;
  const roster = t ? (t.roster || []) : [];
  
  const countEl = document.getElementById('es-roster-count');
  if (countEl) countEl.textContent = roster.length;

  if (!t) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Select or create a tournament above to view competitors.</td></tr>`;
    return;
  }

  if (roster.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No competitors registered yet. Click <b>+ Add Competitor</b> above or <b>🔗 Import BCP Event</b> to load registered players.</td></tr>`;
    return;
  }

  tbody.innerHTML = roster.map((p, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td><b>${escapeHtml(p.name)}</b></td>
      <td><span class="badge badge-faction" style="font-size:0.76rem;">${escapeHtml(p.faction || 'Unassigned')}</span></td>
      <td style="color:var(--text-secondary); font-size:0.8rem;">${escapeHtml(p.detachment || 'Core')}</td>
      <td>
        <button class="badge ${p.checkedIn !== false ? 'badge-match-prime' : ''}" style="cursor:pointer; border:none;" onclick="toggleCheckIn('${p.id}')">
          ${p.checkedIn !== false ? '✅ Checked In' : '⏳ Pending'}
        </button>
      </td>
      <td>${p.listSubmitted ? '<span style="color:#10b981; font-weight:700;">✓ Verified</span>' : '<span style="color:var(--text-muted);">Missing</span>'}</td>
      <td>
        <button class="btn btn-sm btn-ghost" style="color:#ef4444;" onclick="dropPlayer('${p.id}')">Drop</button>
      </td>
    </tr>
  `).join('');
}

function toggleCheckIn(pid) {
  const t = studioState.activeTournament;
  if (!t) return;
  const p = (t.roster || []).find(r => String(r.id) === String(pid));
  if (p) {
    p.checkedIn = !p.checkedIn;
    renderRoster();
    saveStudioRosterChanges();
  }
}

function dropPlayer(pid) {
  const t = studioState.activeTournament;
  if (!t) return;
  if (confirm('Drop this competitor from the tournament roster?')) {
    t.roster = (t.roster || []).filter(r => String(r.id) !== String(pid));
    renderRoster();
    renderTournamentBanner();
    saveStudioRosterChanges();
  }
}

async function saveStudioRosterChanges() {
  const t = studioState.activeTournament;
  if (!t) return;
  try {
    await window.api.saveStudioRoster(t.id, { roster: t.roster || [] });
  } catch (e) {
    console.warn('Notice saving roster:', e);
  }
}

function openAddPlayerModal() {
  const t = studioState.activeTournament;
  if (!t) {
    alert('Please select or create a tournament first.');
    return;
  }
  const modal = document.getElementById('add-player-modal');
  if (modal) {
    modal.classList.add('active');
    const nameInput = document.getElementById('new-player-name');
    if (nameInput) {
      nameInput.value = '';
      nameInput.focus();
    }
  }
}

function submitAddPlayer() {
  const t = studioState.activeTournament;
  if (!t) return;

  const nameInput = document.getElementById('new-player-name');
  const facInput = document.getElementById('new-player-faction');
  const emailInput = document.getElementById('new-player-email');

  const name = nameInput ? nameInput.value.trim() : '';
  const faction = facInput ? facInput.value : 'Necrons';
  const email = emailInput ? emailInput.value.trim() : '';

  if (!name) {
    alert('Please enter a player name.');
    return;
  }

  const newPlayer = {
    id: `P-${Date.now().toString(36).toUpperCase()}`,
    name,
    faction,
    detachment: 'Standard',
    email,
    checkedIn: true,
    listSubmitted: true
  };

  if (!t.roster) t.roster = [];
  t.roster.push(newPlayer);

  if (nameInput) nameInput.value = '';
  if (emailInput) emailInput.value = '';

  closeModal('add-player-modal');
  renderRoster();
  renderTournamentBanner();
  saveStudioRosterChanges();
}

async function submitCreateTournament() {
  const nameEl = document.getElementById('create-event-name');
  const formatEl = document.getElementById('create-event-format');
  const roundsEl = document.getElementById('create-event-rounds');
  const startEl = document.getElementById('create-event-start-date');
  const endEl = document.getElementById('create-event-end-date');
  const capEl = document.getElementById('create-event-capacity');
  const ptsEl = document.getElementById('create-event-points');
  const venueEl = document.getElementById('create-event-venue');
  const cityEl = document.getElementById('create-event-city-state');
  const submitBtn = document.getElementById('btn-submit-create-event');
  const statusEl = document.getElementById('create-event-status');

  const name = nameEl ? nameEl.value.trim() : '';
  if (!name) {
    alert('Please provide a Tournament Name.');
    return;
  }

  const tier = formatEl ? formatEl.options[formatEl.selectedIndex].text : 'Grand Tournament';
  const rounds = parseInt(roundsEl ? roundsEl.value : '5', 10) || 5;
  const startDate = startEl ? startEl.value : '';
  const endDate = endEl ? endEl.value : startDate;
  const capacity = parseInt(capEl ? capEl.value : '32', 10) || 32;
  const points = parseInt(ptsEl ? ptsEl.value : '2000', 10) || 2000;
  const venue = venueEl ? venueEl.value.trim() : '';
  const cityState = cityEl ? cityEl.value.trim() : '';
  const bcpToken = getBcpToken();

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Registering Tournament...';
  }
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.textContent = 'Registering tournament in Event Studio & BCP...';
  }

  try {
    const payload = {
      name,
      tier,
      rounds,
      start_date: startDate,
      end_date: endDate,
      capacity,
      points,
      venue,
      city: cityState.split(',')[0].trim(),
      state: cityState.includes(',') ? cityState.split(',')[1].trim() : '',
      bcp_token: bcpToken
    };

    const res = await window.api.createStudioEvent(payload);
    if (res && res.error) {
      alert(`Notice creating tournament: ${res.error}`);
      return;
    }
    if (res && res.success) {
      const bcpMsg = res.bcp_registered ? ' (Synchronized & Registered on Best Coast Pairings)' : '';
      alert(`🎉 Tournament "${name}" successfully created in Event Studio${bcpMsg}!`);
      if (nameEl) nameEl.value = '';
      if (venueEl) venueEl.value = '';
      if (cityEl) cityEl.value = '';
      
      studioState.activeTournament = res.event;
      if (res.event) {
        localStorage.setItem('es_active_event_id', res.event.id);
      }
      await loadStudioEvents();
      switchStudioTab('events');
    }
  } catch (err) {
    console.error('Error creating tournament:', err);
    alert(`Failed to create tournament: ${err.message || err}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '🚀 Create & Register on BCP';
    }
    if (statusEl) statusEl.style.display = 'none';
  }
}

function updateDefaultRounds() {
  const fmt = document.getElementById('create-event-format').value;
  const rdsInput = document.getElementById('create-event-rounds');
  if (!rdsInput) return;
  if (fmt === 'RTT') rdsInput.value = 3;
  else if (fmt === 'GT') rdsInput.value = 5;
  else if (fmt === 'Major') rdsInput.value = 8;
  else rdsInput.value = 4;
}

function openEditTournamentModal() {
  const t = studioState.activeTournament;
  if (!t) return;
  openEditTournamentModalById(t.id);
}

function openEditTournamentModalById(eventId) {
  const ev = studioState.eventsList.find(e => e.id === eventId) || studioState.activeTournament;
  if (!ev) return;

  const nameEl = document.getElementById('edit-event-name');
  const venueEl = document.getElementById('edit-event-venue');
  const cityEl = document.getElementById('edit-event-city');
  const roundsEl = document.getElementById('edit-event-rounds');
  const capEl = document.getElementById('edit-event-capacity');

  if (nameEl) nameEl.value = ev.name || '';
  if (venueEl) venueEl.value = ev.venue || '';
  if (cityEl) cityEl.value = [ev.city, ev.state].filter(Boolean).join(', ') || '';
  if (roundsEl) roundsEl.value = ev.num_rounds || ev.rounds || 5;
  if (capEl) capEl.value = ev.capacity || 32;

  const modal = document.getElementById('edit-tournament-modal');
  if (modal) {
    modal.dataset.editingEventId = ev.id;
    modal.classList.add('active');
  }
}

async function submitEditTournament() {
  const modal = document.getElementById('edit-tournament-modal');
  const eventId = modal ? modal.dataset.editingEventId : null;
  if (!eventId) return;

  const nameEl = document.getElementById('edit-event-name');
  const venueEl = document.getElementById('edit-event-venue');
  const cityEl = document.getElementById('edit-event-city');
  const roundsEl = document.getElementById('edit-event-rounds');
  const capEl = document.getElementById('edit-event-capacity');

  const payload = {
    name: nameEl ? nameEl.value.trim() : '',
    venue: venueEl ? venueEl.value.trim() : '',
    city: cityEl ? cityEl.value.split(',')[0].trim() : '',
    state: cityEl && cityEl.value.includes(',') ? cityEl.value.split(',')[1].trim() : '',
    num_rounds: parseInt(roundsEl ? roundsEl.value : '5', 10) || 5,
    capacity: parseInt(capEl ? capEl.value : '32', 10) || 32
  };

  try {
    const res = await window.api.updateStudioEvent(eventId, payload);
    if (res && res.success) {
      alert('✅ Tournament details updated!');
      closeModal('edit-tournament-modal');
      await loadStudioEvents();
    }
  } catch (err) {
    alert(`Update failed: ${err.message || err}`);
  }
}

async function deleteCurrentTournament() {
  const t = studioState.activeTournament;
  if (!t) return;
  deleteStudioTournament(t.id);
}

async function deleteStudioTournament(eventId) {
  const ev = studioState.eventsList.find(e => e.id === eventId) || studioState.activeTournament;
  const name = ev ? ev.name : 'this tournament';

  if (!confirm(`Are you sure you want to delete "${name}"?

This will remove the event, competitor roster, and pairings.`)) {
    return;
  }

  try {
    const res = await window.api.deleteStudioEvent(eventId);
    if (res && res.success) {
      alert(`🗑️ Tournament "${name}" was deleted.`);
      studioState.activeTournament = null;
      localStorage.removeItem('es_active_event_id');
      await loadStudioEvents();
    }
  } catch (err) {
    alert(`Failed to delete tournament: ${err.message || err}`);
  }
}

function syncEventWithBcp() {
  const t = studioState.activeTournament;
  if (!t) return;
  alert(`🔄 Synchronizing "${t.name}" roster and live match scores...`);
  loadStudioEvents();
}

function computeStandingsArray() {
  const t = studioState.activeTournament;
  if (!t) return [];

  const roster = t.roster || [];
  const stats = {};

  roster.forEach(p => {
    stats[String(p.id)] = {
      id: String(p.id),
      name: p.name,
      faction: p.faction || 'Unassigned',
      wins: 0,
      losses: 0,
      draws: 0,
      points: 0,
      diff: 0,
      opponents: []
    };
  });

  const numRounds = t.num_rounds || t.rounds || 5;
  const pairingsMap = t.pairings || {};

  for (let r = 1; r <= numRounds; r++) {
    const pairings = pairingsMap[String(r)] || pairingsMap[r] || [];
    pairings.forEach(pair => {
      if (pair.status === 'completed' || (pair.p1Score !== null && pair.p2Score !== null)) {
        const s1 = stats[String(pair.p1)];
        const s2 = stats[String(pair.p2)];

        const score1 = parseInt(pair.p1Score, 10) || 0;
        const score2 = parseInt(pair.p2Score, 10) || 0;

        if (s1) {
          s1.points += score1;
          s1.diff += (score1 - score2);
          if (pair.p2) s1.opponents.push(String(pair.p2));

          if (score1 > score2) s1.wins++;
          else if (score2 > score1) s1.losses++;
          else s1.draws++;
        }

        if (s2) {
          s2.points += score2;
          s2.diff += (score2 - score1);
          if (pair.p1) s2.opponents.push(String(pair.p1));

          if (score2 > score1) s2.wins++;
          else if (score1 > score2) s2.losses++;
          else s2.draws++;
        }
      }
    });
  }

  const list = Object.values(stats);
  list.forEach(item => {
    let oppWins = 0;
    let oppTotal = 0;
    item.opponents.forEach(oppId => {
      const opp = stats[oppId];
      if (opp) {
        oppWins += opp.wins;
        oppTotal += (opp.wins + opp.losses + opp.draws);
      }
    });
    item.sos = oppTotal > 0 ? ((oppWins / oppTotal) * 100).toFixed(1) : '50.0';
    item.esos = '50.0';
  });

  list.sort((a, b) => {
    return (b.wins - a.wins) || (b.points - a.points) || (b.diff - a.diff);
  });

  return list;
}

function renderStandings() {
  const tbody = document.getElementById('es-standings-tbody');
  if (!tbody) return;

  const t = studioState.activeTournament;
  if (!t) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Select or create a tournament to view live standings.</td></tr>`;
    return;
  }

  const standings = computeStandingsArray();

  if (standings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Standings will appear once round scores are submitted.</td></tr>`;
    return;
  }

  tbody.innerHTML = standings.map((s, idx) => `
    <tr>
      <td><b>#${idx + 1}</b></td>
      <td><b>${escapeHtml(s.name)}</b></td>
      <td><span class="badge badge-faction" style="font-size:0.76rem;">${escapeHtml(s.faction)}</span></td>
      <td><b>${s.wins}W - ${s.losses}L - ${s.draws}D</b></td>
      <td><b style="color:var(--accent);">${s.points}</b></td>
      <td>${s.diff > 0 ? `+${s.diff}` : s.diff}</td>
      <td>${s.sos}%</td>
      <td>${s.esos}%</td>
    </tr>
  `).join('');
}

function toggleRoundTimer() {
  const btn = document.getElementById('btn-timer-toggle');
  if (studioState.timerRunning) {
    clearInterval(studioState.timerInterval);
    studioState.timerRunning = false;
    if (btn) btn.textContent = '▶ Start';
  } else {
    studioState.timerRunning = true;
    if (btn) btn.textContent = '⏸ Pause';
    studioState.timerInterval = setInterval(() => {
      if (studioState.timerSeconds > 0) {
        studioState.timerSeconds--;
        updateTimerDisplay();
      } else {
        clearInterval(studioState.timerInterval);
        studioState.timerRunning = false;
        alert('⏰ Round Time Expired!');
      }
    }, 1000);
  }
}

function resetRoundTimer() {
  clearInterval(studioState.timerInterval);
  studioState.timerRunning = false;
  studioState.timerSeconds = 9000;
  const btn = document.getElementById('btn-timer-toggle');
  if (btn) btn.textContent = '▶ Start';
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const disp = document.getElementById('round-timer');
  if (!disp) return;
  const hrs = Math.floor(studioState.timerSeconds / 3600);
  const mins = Math.floor((studioState.timerSeconds % 3600) / 60);
  const secs = studioState.timerSeconds % 60;
  disp.textContent = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function copyStandingsText() {
  const standings = computeStandingsArray();
  const t = studioState.activeTournament;
  let text = `🏆 ${t ? t.name : 'Tournament'} - Official Standings (Round ${studioState.currentRound}) 🏆

`;
  standings.forEach((s, idx) => {
    text += `#${idx + 1} ${s.name} (${s.faction}) - ${s.wins}W-${s.losses}L (${s.points} Battle Points, SoS: ${s.sos}%)
`;
  });
  navigator.clipboard.writeText(text).then(() => {
    alert('Standings copied to clipboard!');
  });
}

function exportRosterCsv() {
  const t = studioState.activeTournament;
  if (!t) return;
  let csv = 'Name,Faction,Detachment,Email,CheckedIn,ListSubmitted
';
  (t.roster || []).forEach(p => {
    csv += `"${p.name}","${p.faction || ''}","${p.detachment || ''}","${p.email || ''}",${p.checkedIn !== false},${p.listSubmitted !== false}
`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `roster_${t.id}.csv`;
  a.click();
}

// =========================================================================
// FEATURE 1: TO LIVE OPERATIONS DASHBOARD & JUDGE CALL DISPATCH
// =========================================================================

let dashboardPollTimer = null;

async function renderDashboard() {
  const t = studioState.activeTournament;
  if (!t) return;

  const r = studioState.currentRound;
  const pairingsMap = t.pairings || {};
  const pairings = pairingsMap[String(r)] || pairingsMap[r] || [];

  // Compute metrics
  const totalTables = pairings.length;
  const completedTables = pairings.filter(p => p.status === 'completed' || (p.p1Score !== null && p.p1Score !== undefined && p.p2Score !== null && p.p2Score !== undefined)).length;
  const activeTables = totalTables - completedTables;
  const pct = totalTables > 0 ? Math.round((completedTables / totalTables) * 100) : 0;

  const pctEl = document.getElementById('dash-round-pct');
  const subEl = document.getElementById('dash-round-sub');
  const barEl = document.getElementById('dash-round-progress-bar');
  const activeEl = document.getElementById('dash-active-tables');
  const clockEl = document.getElementById('dash-clock-display');

  if (pctEl) pctEl.textContent = `${pct}%`;
  if (subEl) subEl.textContent = `${completedTables} / ${totalTables} Tables Done`;
  if (barEl) barEl.style.width = `${pct}%`;
  if (activeEl) activeEl.textContent = activeTables;
  if (clockEl) {
    const hrs = Math.floor(studioState.timerSeconds / 3600);
    const mins = Math.floor((studioState.timerSeconds % 3600) / 60);
    const secs = studioState.timerSeconds % 60;
    clockEl.textContent = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  // Render Tables Grid
  const tablesContainer = document.getElementById('es-dash-tables-grid');
  if (tablesContainer) {
    if (pairings.length === 0) {
      tablesContainer.innerHTML = '<div style="grid-column: 1 / -1; color: var(--text-muted); font-size: 0.85rem; padding: 1rem; text-align: center;">No pairings active for this round yet.</div>';
    } else {
      const rosterMap = {};
      (t.roster || []).forEach(p => rosterMap[p.id] = p);

      tablesContainer.innerHTML = pairings.map(pair => {
        const p1 = rosterMap[pair.p1] || { name: pair.p1_name || 'Player 1', faction: pair.p1_faction || 'Unknown' };
        const p2 = rosterMap[pair.p2] || { name: pair.p2_name || 'Player 2', faction: pair.p2_faction || 'Unknown' };
        const isDone = pair.status === 'completed' || (pair.p1Score !== null && pair.p1Score !== undefined);

        return `
          <div style="background: #0d1527; border: 1px solid ${isDone ? 'rgba(16,185,129,0.3)' : 'var(--border)'}; border-radius: 8px; padding: 0.85rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
              <span style="font-family: var(--font-mono); font-weight: 800; color: var(--accent); font-size: 0.82rem;">TABLE ${pair.table}</span>
              <span class="badge" style="background: ${isDone ? 'rgba(16,185,129,0.15)' : 'rgba(56,189,248,0.15)'}; color: ${isDone ? '#10b981' : '#38bdf8'}; font-size: 0.7rem;">
                ${isDone ? `Final: ${pair.p1Score}-${pair.p2Score}` : 'Combat In Progress'}
              </span>
            </div>
            <div style="font-size: 0.85rem; font-weight: 700; color: #fff; line-height: 1.4;">
              ${escapeHtml(p1.name)} <span style="font-size: 0.72rem; color: var(--text-muted);">(${escapeHtml(p1.faction)})</span><br>
              <span style="color: var(--text-muted); font-size: 0.75rem;">vs</span><br>
              ${escapeHtml(p2.name)} <span style="font-size: 0.72rem; color: var(--text-muted);">(${escapeHtml(p2.faction)})</span>
            </div>
            <div style="display: flex; gap: 0.4rem; margin-top: 0.6rem;">
              <button class="btn btn-outline" style="font-size: 0.72rem; padding: 0.25rem 0.55rem; width: 100%; justify-content: center;" onclick="launchTournamentTracker('${t.id}', ${r}, ${pair.table}, '${escapeHtml(p1.name)}', '${escapeHtml(p2.name)}', '${pair.p1}', '${pair.p2}')">
                🎲 Floor Tracker
              </button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Refresh Judge Calls
  await refreshDashboardCalls();

  // Start polling while active
  if (dashboardPollTimer) clearInterval(dashboardPollTimer);
  dashboardPollTimer = setInterval(() => {
    if (studioState.activeTab === 'dashboard') {
      refreshDashboardCalls();
    } else {
      clearInterval(dashboardPollTimer);
      dashboardPollTimer = null;
    }
  }, 7000);
}

async function refreshDashboardCalls() {
  const t = studioState.activeTournament;
  if (!t) return;

  try {
    const res = await window.api.getJudgeCalls(t.id);
    const calls = (res && res.calls) ? res.calls : [];
    const pendingCalls = calls.filter(c => c.status === 'pending' || c.status === 'en_route');

    const countEl = document.getElementById('dash-pending-calls');
    const badgeEl = document.getElementById('dash-calls-badge');
    const listEl = document.getElementById('es-judge-calls-list');

    if (countEl) countEl.textContent = pendingCalls.length;
    if (badgeEl) {
      if (pendingCalls.length > 0) {
        badgeEl.textContent = `${pendingCalls.length} ACTION REQUIRED`;
        badgeEl.style.background = 'rgba(244,63,94,0.2)';
        badgeEl.style.color = '#f43f5e';
      } else {
        badgeEl.textContent = 'All Quiet';
        badgeEl.style.background = 'rgba(16,185,129,0.15)';
        badgeEl.style.color = '#10b981';
      }
    }

    if (listEl) {
      if (calls.length === 0) {
        listEl.innerHTML = '<div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">✅ No judge calls on record. Floor is quiet.</div>';
        return;
      }

      listEl.innerHTML = calls.map(c => {
        const isPending = c.status === 'pending';
        const isEnRoute = c.status === 'en_route';
        const isResolved = c.status === 'resolved';

        const statusColor = isPending ? '#f43f5e' : (isEnRoute ? '#38bdf8' : '#10b981');
        const statusLabel = isPending ? '🟡 PENDING JUDGE' : (isEnRoute ? '🔵 JUDGE EN ROUTE' : '🟢 RESOLVED');

        return `
          <div style="background: #0f172a; border: 1px solid ${isPending ? 'rgba(244,63,94,0.4)' : 'rgba(255,255,255,0.08)'}; border-radius: 8px; padding: 0.85rem 1rem; margin-bottom: 0.6rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
            <div>
              <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                <span style="font-family: var(--font-mono); font-weight: 900; color: #fff; font-size: 0.95rem; background: #1e293b; padding: 2px 8px; border-radius: 4px;">
                  TABLE ${c.table_num || 'Floor'}
                </span>
                <span class="badge" style="background: ${statusColor}22; color: ${statusColor}; border: 1px solid ${statusColor}44; font-size: 0.72rem; font-weight: 700;">
                  ${statusLabel}
                </span>
                <span style="font-size: 0.78rem; color: var(--accent); font-weight: 700;">
                  ${escapeHtml(c.category || 'General Issue')}
                </span>
              </div>
              <div style="font-size: 0.82rem; color: #e2e8f0;">
                Calling Player: <b>${escapeHtml(c.player_name || 'Competitor')}</b>
                ${c.note ? ` • <span style="color: var(--text-muted); font-style: italic;">"${escapeHtml(c.note)}"</span>` : ''}
              </div>
              <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.2rem;">
                Logged at ${c.created_at ? new Date(c.created_at).toLocaleTimeString() : 'Just now'}
              </div>
            </div>

            <div style="display: flex; gap: 0.4rem;">
              ${isPending ? `
                <button class="btn btn-outline" style="font-size: 0.75rem; padding: 0.3rem 0.75rem; color: #38bdf8; border-color: rgba(56,189,248,0.4);" onclick="markJudgeCallEnRoute('${c.id}')">
                  🏃 En Route
                </button>
              ` : ''}
              ${!isResolved ? `
                <button class="btn btn-primary" style="font-size: 0.75rem; padding: 0.3rem 0.75rem;" onclick="resolveJudgeCall('${c.id}')">
                  ✅ Resolve
                </button>
              ` : `
                <span style="font-size: 0.75rem; color: #10b981; font-weight: 700;">Completed</span>
              `}
            </div>
          </div>
        `;
      }).join('');
    }
  } catch(err) {
    console.warn('Notice refreshing dashboard judge calls:', err);
  }
}

async function markJudgeCallEnRoute(callId) {
  try {
    await window.api.resolveJudgeCall(callId, 'en_route');
    await refreshDashboardCalls();
  } catch(e) {
    alert('Error updating judge call status.');
  }
}

async function resolveJudgeCall(callId) {
  try {
    await window.api.resolveJudgeCall(callId, 'resolved');
    await refreshDashboardCalls();
  } catch(e) {
    alert('Error resolving judge call.');
  }
}

// =========================================================================
// FEATURE 2: TACTICAL MATCH PREDICTOR MODAL
// =========================================================================

async function openMatchPredictorModal(p1Name, p2Name, p1Faction, p2Faction, p1Id, p2Id) {
  const modal = document.getElementById('es-match-predictor-modal');
  const loading = document.getElementById('mp-loading');
  const content = document.getElementById('mp-content');

  if (!modal) return;
  modal.style.display = 'flex';
  if (loading) loading.style.display = 'block';
  if (content) content.style.display = 'none';

  try {
    const res = await window.api.getMatchPredictor(p1Id, p2Id, p1Name, p2Name, p1Faction, p2Faction);
    
    if (loading) loading.style.display = 'none';
    if (content) content.style.display = 'block';

    const p1 = res.player1 || {};
    const p2 = res.player2 || {};

    const p1NameEl = document.getElementById('mp-p1-name');
    const p2NameEl = document.getElementById('mp-p2-name');
    const p1FacEl = document.getElementById('mp-p1-faction');
    const p2FacEl = document.getElementById('mp-p2-faction');
    const p1EloEl = document.getElementById('mp-p1-elo');
    const p2EloEl = document.getElementById('mp-p2-elo');

    const p1ProbEl = document.getElementById('mp-p1-prob');
    const p2ProbEl = document.getElementById('mp-p2-prob');
    const favoredEl = document.getElementById('mp-favored-chip');

    const expScoreEl = document.getElementById('mp-expected-score');
    const expDiffEl = document.getElementById('mp-expected-diff');

    const facWinrateEl = document.getElementById('mp-faction-winrate');
    const facTotalEl = document.getElementById('mp-faction-total');
    const h2hListEl = document.getElementById('mp-h2h-list');

    if (p1NameEl) p1NameEl.textContent = p1.name || p1Name;
    if (p2NameEl) p2NameEl.textContent = p2.name || p2Name;
    if (p1FacEl) p1FacEl.textContent = p1.faction || p1Faction || 'Unknown';
    if (p2FacEl) p2FacEl.textContent = p2.faction || p2Faction || 'Unknown';
    if (p1EloEl) p1EloEl.textContent = Number(p1.elo || 1500).toFixed(1);
    if (p2EloEl) p2EloEl.textContent = Number(p2.elo || 1500).toFixed(1);

    if (p1ProbEl) p1ProbEl.textContent = `${p1.win_probability || 50}%`;
    if (p2ProbEl) p2ProbEl.textContent = `${p2.win_probability || 50}%`;
    
    if (favoredEl) {
      favoredEl.textContent = res.favored_player === 'Even Matchup' ? 'Even Matchup (50/50)' : `Favored: ${res.favored_player} (+${res.elo_diff} Elo)`;
    }

    if (expScoreEl) expScoreEl.textContent = `${p1.expected_score || 75} - ${p2.expected_score || 75} VP`;
    if (expDiffEl) expDiffEl.textContent = `${res.expected_differential || 0} pts`;

    if (facWinrateEl) facWinrateEl.textContent = `${res.faction_matchup ? res.faction_matchup.p1_faction_win_pct : 50}%`;
    if (facTotalEl) facTotalEl.textContent = `(${res.faction_matchup ? res.faction_matchup.total_games : 0} recorded matches)`;

    if (h2hListEl) {
      const h2h = res.h2h_history || [];
      if (h2h.length === 0) {
        h2hListEl.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; font-style: italic;">No prior tournament matchups between these competitors.</div>';
      } else {
        h2hListEl.innerHTML = h2h.map(m => `
          <div style="font-size: 0.82rem; color: #e2e8f0; padding: 0.35rem 0; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between;">
            <span>${escapeHtml(m.event_name)}</span>
            <b style="font-family: var(--font-mono); color: var(--accent);">${m.score}</b>
          </div>
        `).join('');
      }
    }
  } catch(err) {
    if (loading) loading.innerHTML = '<div style="color: #ef4444;">Error calculating match prediction.</div>';
  }
}

// =========================================================================
// FEATURE 3: WTC / TEAM MATCH PAIRING DRAFT MATRIX
// =========================================================================

let wtcDraftState = {
  format: 5,
  teamA: 'Team Alpha',
  teamB: 'Team Bravo',
  rosterA: [],
  rosterB: [],
  step: 1, // 1: Defender Nomination, 2: Attacker Proposals, 3: Captain Pick, 4: Finalized
  defenderA: null,
  defenderB: null,
  attackersA: [],
  attackersB: [],
  assignedTables: [] // [{ table: 1, p1, p2, p1_name, p2_name, p1_faction, p2_faction }]
};

function renderWtcDraftMatrix() {
  const container = document.getElementById('wtc-draft-container');
  if (!container) return;

  const t = studioState.activeTournament;
  const teamSizeSelect = document.getElementById('wtc-team-size');
  const teamANameInput = document.getElementById('wtc-team-a-name');
  const teamBNameInput = document.getElementById('wtc-team-b-name');

  const format = teamSizeSelect ? parseInt(teamSizeSelect.value) : 5;
  const teamAName = teamANameInput ? teamANameInput.value : 'Team Alpha';
  const teamBName = teamBNameInput ? teamBNameInput.value : 'Team Bravo';

  wtcDraftState.format = format;
  wtcDraftState.teamA = teamAName;
  wtcDraftState.teamB = teamBName;

  // Derive Roster A and Roster B from event roster or generate team slots
  const fullRoster = t ? (t.roster || []) : [];
  if (fullRoster.length >= format * 2) {
    wtcDraftState.rosterA = fullRoster.slice(0, format);
    wtcDraftState.rosterB = fullRoster.slice(format, format * 2);
  } else {
    // Generate default team slots
    const factions = ['Space Marines', 'Necrons', 'Aeldari', 'Orks', 'Tyranids', 'Tau Empire', 'Chaos Space Marines', 'Adeptus Custodes'];
    wtcDraftState.rosterA = Array.from({ length: format }, (_, i) => ({
      id: `TA-${i+1}`,
      name: `${teamAName} Player ${i+1}`,
      faction: factions[i % factions.length],
      elo: 1650 - (i * 30)
    }));
    wtcDraftState.rosterB = Array.from({ length: format }, (_, i) => ({
      id: `TB-${i+1}`,
      name: `${teamBName} Player ${i+1}`,
      faction: factions[(i + 2) % factions.length],
      elo: 1630 - (i * 25)
    }));
  }

  // Build Interactive Draft UI
  container.innerHTML = `
    <!-- Strategic Step Banner -->
    <div style="background: linear-gradient(135deg, rgba(2,132,199,0.15), rgba(99,102,241,0.15)); border: 1px solid rgba(56,189,248,0.3); border-radius: 12px; padding: 1.25rem; margin-bottom: 1.25rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem;">
        <span style="font-family: var(--font-mono); font-weight: 900; color: #38bdf8; font-size: 0.95rem;">
          WTC PAIRING DRAFT PHASE: STEP ${wtcDraftState.step} OF 4
        </span>
        <span class="badge" style="background: #1e293b; color: #fff; font-size: 0.75rem;">
          ${wtcDraftState.assignedTables.length} / ${format} Tables Assigned
        </span>
      </div>
      <div style="font-size: 0.85rem; color: #e2e8f0; line-height: 1.5;">
        ${wtcDraftState.step === 1 ? '👉 <b>Step 1 (Defender Nomination):</b> Both captains secretly or simultaneously nominate 1 Defender.' : ''}
        ${wtcDraftState.step === 2 ? '👉 <b>Step 2 (Attacker Proposals):</b> Each captain puts forward 2 Attackers against the opposing Defender.' : ''}
        ${wtcDraftState.step === 3 ? '👉 <b>Step 3 (Captain Selection & Table Pick):</b> Opposing captain chooses 1 Attacker to match their Defender and picks the table layout.' : ''}
        ${wtcDraftState.step === 4 ? '🎉 <b>Step 4 (Draft Complete):</b> All tables assigned! Review tactical advantage matrix below and push to live pairings.' : ''}
      </div>
      <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
        <button class="btn btn-primary" style="font-size: 0.8rem; padding: 0.35rem 0.85rem;" onclick="advanceWtcDraftStep()">
          ${wtcDraftState.step < 4 ? 'Advance Draft Step ⏩' : 'Draft Completed'}
        </button>
        <button class="btn btn-outline" style="font-size: 0.8rem; padding: 0.35rem 0.85rem;" onclick="autoSolveWtcDraft()">
          🎲 Auto-Draft Optimal Matchups
        </button>
      </div>
    </div>

    <!-- Live Pairings Matrix -->
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1.5rem; overflow-x: auto;">
      <h4 style="margin: 0 0 1rem; color: #fff; font-size: 1.05rem;">Team Matchup Advantage Matrix (${teamAName} vs ${teamBName})</h4>
      <table class="data-table" style="width: 100%; text-align: center; font-size: 0.85rem;">
        <thead>
          <tr>
            <th style="text-align: left;">${teamAName} / ${teamBName}</th>
            ${wtcDraftState.rosterB.map(b => `<th style="text-align: center;">${escapeHtml(b.name)}<br><span style="font-size: 0.7rem; color: var(--text-muted); font-weight: normal;">${escapeHtml(b.faction)} (${b.elo || 1500})</span></th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${wtcDraftState.rosterA.map(a => `
            <tr>
              <td style="text-align: left; font-weight: 700; color: #fff;">
                ${escapeHtml(a.name)}<br>
                <span style="font-size: 0.72rem; color: #38bdf8; font-weight: normal;">${escapeHtml(a.faction)} (${a.elo || 1500})</span>
              </td>
              ${wtcDraftState.rosterB.map(b => {
                const diff = (a.elo || 1500) - (b.elo || 1500);
                const p1Prob = Math.round((1.0 / (1.0 + Math.pow(10, -diff / 400))) * 100);
                const bg = diff > 80 ? 'rgba(16,185,129,0.18)' : (diff < -80 ? 'rgba(239,68,68,0.18)' : 'rgba(245,158,11,0.12)');
                const color = diff > 80 ? '#10b981' : (diff < -80 ? '#ef4444' : '#f59e0b');
                return `
                  <td style="background: ${bg}; color: ${color}; font-family: var(--font-mono); font-weight: 800; padding: 0.6rem 0.4rem;">
                    ${p1Prob}%
                    <div style="font-size: 0.68rem; font-weight: normal; opacity: 0.85;">${diff > 0 ? `+${diff}` : diff} Elo</div>
                  </td>
                `;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <!-- Assigned Tables Breakdown -->
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem;">
      <h4 style="margin: 0 0 1rem; color: #fff; font-size: 1.05rem;">Assigned Table Matchups</h4>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.75rem;">
        ${Array.from({ length: format }, (_, i) => {
          const match = wtcDraftState.assignedTables[i] || {
            table: i + 1,
            p1_name: wtcDraftState.rosterA[i]?.name || `Table ${i+1} P1`,
            p2_name: wtcDraftState.rosterB[i]?.name || `Table ${i+1} P2`,
            p1_faction: wtcDraftState.rosterA[i]?.faction || 'Faction',
            p2_faction: wtcDraftState.rosterB[i]?.faction || 'Faction'
          };
          return `
            <div style="background: #090f1e; border: 1px solid var(--border); border-radius: 8px; padding: 0.85rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
                <span style="font-family: var(--font-mono); font-weight: 800; color: var(--accent); font-size: 0.8rem;">TABLE ${i + 1}</span>
                <span class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; font-size: 0.7rem;">Draft Ready</span>
              </div>
              <div style="font-size: 0.85rem; font-weight: 700; color: #fff;">
                ${escapeHtml(match.p1_name)} <span style="font-size: 0.72rem; color: #38bdf8;">(${escapeHtml(match.p1_faction)})</span><br>
                <span style="color: var(--text-muted); font-size: 0.72rem;">vs</span><br>
                ${escapeHtml(match.p2_name)} <span style="font-size: 0.72rem; color: #f43f5e;">(${escapeHtml(match.p2_faction)})</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function advanceWtcDraftStep() {
  if (wtcDraftState.step < 4) {
    wtcDraftState.step++;
    renderWtcDraftMatrix();
  }
}

function autoSolveWtcDraft() {
  wtcDraftState.assignedTables = Array.from({ length: wtcDraftState.format }, (_, i) => ({
    table: i + 1,
    p1: wtcDraftState.rosterA[i]?.id || `TA-${i+1}`,
    p2: wtcDraftState.rosterB[i]?.id || `TB-${i+1}`,
    p1_name: wtcDraftState.rosterA[i]?.name || `Player A${i+1}`,
    p2_name: wtcDraftState.rosterB[i]?.name || `Player B${i+1}`,
    p1_faction: wtcDraftState.rosterA[i]?.faction || 'Space Marines',
    p2_faction: wtcDraftState.rosterB[i]?.faction || 'Necrons',
    status: 'pending'
  }));
  wtcDraftState.step = 4;
  renderWtcDraftMatrix();
}

function resetWtcDraft() {
  wtcDraftState.step = 1;
  wtcDraftState.assignedTables = [];
  renderWtcDraftMatrix();
}

async function commitWtcDraftToPairings() {
  const t = studioState.activeTournament;
  if (!t) {
    alert('Please select or create a tournament first.');
    return;
  }

  if (wtcDraftState.assignedTables.length === 0) {
    autoSolveWtcDraft();
  }

  const r = studioState.currentRound;
  if (!t.pairings) t.pairings = {};
  t.pairings[String(r)] = wtcDraftState.assignedTables;

  try {
    await window.api.saveStudioPairings(t.id, {
      round_num: r,
      pairings: wtcDraftState.assignedTables
    });
    alert(`🎉 WTC Team Match draft successfully pushed to Round ${r} Pairings!`);
    switchStudioTab('pairings');
  } catch(err) {
    alert(`Pairings saved locally for Round ${r}!`);
    switchStudioTab('pairings');
  }
}

// =========================================================================
// FEATURE 4: MULTI-DAY POD & BRACKET PROGRESSION ENGINE
// =========================================================================

function previewPodBreakdown() {
  const container = document.getElementById('es-pod-preview-container');
  if (!container) return;

  const t = studioState.activeTournament;
  const structSelect = document.getElementById('pod-structure-select');
  const struct = structSelect ? structSelect.value : '4_2';

  const roster = t ? (t.roster || []) : [];
  const podSize = struct.startsWith('8_') ? 8 : 4;
  const numPods = 2;

  const pod1Players = roster.slice(0, podSize);
  const pod2Players = roster.slice(podSize, podSize * 2);

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem;">
      <!-- Pod 1: Championship Bracket -->
      <div style="background: var(--bg-card); border: 1px solid rgba(56,189,248,0.4); border-radius: var(--radius-lg); padding: 1.25rem; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem;">
          <h4 style="margin: 0; color: #fff; font-size: 1.05rem; display: flex; align-items: center; gap: 0.5rem;">
            <span>🏆 Pod 1: Championship Bracket</span>
          </h4>
          <span class="badge badge-match-prime">Seeds 1–${podSize}</span>
        </div>
        <div style="font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.75rem;">
          Plays for 1st Place Tournament Champion & Top Pod Placements
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.4rem;">
          ${pod1Players.length > 0 ? pod1Players.map((p, idx) => `
            <div style="background: #090f1e; border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem 0.75rem; display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 700; color: #fff; font-size: 0.85rem;">#${idx + 1} ${escapeHtml(p.name)}</span>
              <span style="font-size: 0.72rem; color: var(--accent);">${escapeHtml(p.faction || 'Unassigned')}</span>
            </div>
          `).join('') : '<div style="color: var(--text-muted); font-size: 0.8rem; padding: 0.5rem;">Seeds will populate from Day 1 Standings.</div>'}
        </div>
      </div>

      <!-- Pod 2: Consolation Bracket -->
      <div style="background: var(--bg-card); border: 1px solid rgba(245,158,11,0.4); border-radius: var(--radius-lg); padding: 1.25rem; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem;">
          <h4 style="margin: 0; color: #fff; font-size: 1.05rem; display: flex; align-items: center; gap: 0.5rem;">
            <span>🛡️ Pod 2: Consolation Bracket</span>
          </h4>
          <span class="badge" style="background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3);">Seeds ${podSize + 1}–${podSize * 2}</span>
        </div>
        <div style="font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.75rem;">
          Plays for Bracket 2 Champion & Consolation Flight Placings
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.4rem;">
          ${pod2Players.length > 0 ? pod2Players.map((p, idx) => `
            <div style="background: #090f1e; border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem 0.75rem; display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 700; color: #fff; font-size: 0.85rem;">#${podSize + idx + 1} ${escapeHtml(p.name)}</span>
              <span style="font-size: 0.72rem; color: #f59e0b;">${escapeHtml(p.faction || 'Unassigned')}</span>
            </div>
          `).join('') : '<div style="color: var(--text-muted); font-size: 0.8rem; padding: 0.5rem;">Seeds will populate from Day 1 Standings.</div>'}
        </div>
      </div>
    </div>
  `;
}

async function triggerGeneratePods() {
  const t = studioState.activeTournament;
  if (!t) {
    alert('Please select or create a tournament first.');
    return;
  }

  const structSelect = document.getElementById('pod-structure-select');
  const targetRoundInput = document.getElementById('pod-target-round');

  const struct = structSelect ? structSelect.value : '4_2';
  const podSize = struct.startsWith('8_') ? 8 : 4;
  const numPods = 2;
  const targetRound = targetRoundInput ? parseInt(targetRoundInput.value) : (t.num_rounds || 5) + 1;

  try {
    const res = await window.api.generateDay2Pods(t.id, {
      pod_size: podSize,
      num_pods: numPods,
      target_round: targetRound
    });

    if (res && res.success) {
      alert(`⚡ Day 2 Brackets generated successfully for Round ${targetRound}! Championship & Consolation Pods created.`);
      studioState.currentRound = targetRound;
      await loadStudioEvents();
      switchStudioTab('pairings');
    } else {
      alert(`Error generating pods: ${res?.error || 'Unknown error'}`);
    }
  } catch(err) {
    alert('Notice generating Day 2 brackets: ' + err.message);
  }
}

// Global window bindings for Event Studio
window.initStudio = initStudio;
window.loadStudioEvents = loadStudioEvents;
window.switchStudioTab = switchStudioTab;
window.renderEventsDirectory = renderEventsDirectory;
window.selectStudioTournament = selectStudioTournament;
window.deleteStudioTournament = deleteStudioTournament;
window.openImportBcpModal = openImportBcpModal;
window.closeImportBcpModal = closeImportBcpModal;
window.submitImportBcpTournament = submitImportBcpTournament;
window.submitCreateTournament = submitCreateTournament;
window.updateDefaultRounds = updateDefaultRounds;
window.openEditTournamentModal = openEditTournamentModal;
window.openEditTournamentModalById = openEditTournamentModalById;
window.closeModal = closeModal;
window.submitEditTournament = submitEditTournament;
window.deleteCurrentTournament = deleteCurrentTournament;
window.syncEventWithBcp = syncEventWithBcp;
window.renderDashboard = renderDashboard;
window.refreshDashboardCalls = refreshDashboardCalls;
window.markJudgeCallEnRoute = markJudgeCallEnRoute;
window.resolveJudgeCall = resolveJudgeCall;
window.switchPairingsRound = switchPairingsRound;
window.generateSwissPairings = generateSwissPairings;
window.saveCurrentPairings = saveCurrentPairings;
window.openQuickScoreModal = openQuickScoreModal;
window.closeQuickScoreModal = closeQuickScoreModal;
window.submitQuickScore = submitQuickScore;
window.launchTournamentTracker = launchTournamentTracker;
window.openMatchPredictorModal = openMatchPredictorModal;
window.closeMatchPredictorModal = closeMatchPredictorModal;
window.renderWtcDraftMatrix = renderWtcDraftMatrix;
window.selectWtcSlot = selectWtcSlot;
window.advanceWtcDraftStep = advanceWtcDraftStep;
window.autoSolveWtcDraft = autoSolveWtcDraft;
window.resetWtcDraft = resetWtcDraft;
window.commitWtcDraftToPairings = commitWtcDraftToPairings;
window.triggerGeneratePods = triggerGeneratePods;
window.previewPodBreakdown = previewPodBreakdown;
window.openAddPlayerModal = openAddPlayerModal;
window.submitAddPlayer = submitAddPlayer;
window.dropPlayer = dropPlayer;
window.toggleCheckIn = toggleCheckIn;
window.exportRosterCsv = exportRosterCsv;
window.renderStandings = renderStandings;
window.copyStandingsText = copyStandingsText;
window.toggleRoundTimer = toggleRoundTimer;
window.resetRoundTimer = resetRoundTimer;

