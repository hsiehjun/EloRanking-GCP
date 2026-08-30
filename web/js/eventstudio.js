/**
 * Event Studio | Tournament Director & BCP Organizer Suite (v11.8)
 * Full Two-Way BCP Tournament Management, Swiss Pairings, 1-Click Trackers & Live Scorekeeping.
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
      badge.textContent = '⚪ Local Studio Sandbox (Sign in to Sync)';
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
      if (!studioState.activeTournament || !studioState.eventsList.some(e => e.id === studioState.activeTournament.id)) {
        studioState.activeTournament = studioState.eventsList[0];
      }
      renderTournamentBanner();
      renderEventsDirectory();
      renderRoster();
      renderRoundButtons();
      renderPairings();
      renderStandings();
    } else {
      // Seed initial sample tournament if empty
      studioState.activeTournament = getSampleTournament();
      renderTournamentBanner();
      renderEventsDirectory();
      renderRoster();
      renderRoundButtons();
      renderPairings();
      renderStandings();
    }
  } catch (err) {
    console.warn('Error loading studio events:', err);
    if (!studioState.activeTournament) {
      studioState.activeTournament = getSampleTournament();
    }
    renderTournamentBanner();
    renderEventsDirectory();
    renderRoster();
    renderRoundButtons();
    renderPairings();
    renderStandings();
  }
}

function getSampleTournament() {
  return {
    id: 'DEMO-AUTUMN-GT',
    name: 'San Diego 40K Autumn Grand Tournament',
    tier: 'Grand Tournament',
    num_rounds: 5,
    event_date: '2026-09-26',
    end_date: '2026-09-27',
    capacity: 32,
    venue: 'Game Empire San Diego',
    city: 'San Diego',
    state: 'CA',
    points: 2000,
    roster: [
      { id: 'p1', name: 'John "Warlord" Hsieh', faction: 'Necrons', detachment: 'Awakened Dynasty', email: 'john@example.com', checkedIn: true, listSubmitted: true },
      { id: 'p2', name: 'Folger Pyles', faction: 'Blood Angels', detachment: 'Sons of Sanguinius', email: 'folger@artofwar.com', checkedIn: true, listSubmitted: true },
      { id: 'p3', name: 'Cody Jiru', faction: 'Aeldari', detachment: 'Battle Host', email: 'cody@monstars.com', checkedIn: true, listSubmitted: true },
      { id: 'p4', name: 'Lyle Dixon', faction: 'Death Guard', detachment: 'Plague Company', email: 'lyle@example.com', checkedIn: true, listSubmitted: true },
      { id: 'p5', name: 'Frasier Parry', faction: 'Chaos Space Marines', detachment: 'Slaves to Darkness', email: 'frasier@example.com', checkedIn: true, listSubmitted: true },
      { id: 'p6', name: 'Liam Vsl', faction: 'Thousand Sons', detachment: 'Cult of Magic', email: 'liam@ignite.com', checkedIn: true, listSubmitted: true },
      { id: 'p7', name: 'Durante Boz', faction: 'Adeptus Custodes', detachment: 'Shield Host', email: 'durante@zugzwang.com', checkedIn: true, listSubmitted: true },
      { id: 'p8', name: 'Walter Langendorf', faction: 'World Eaters', detachment: 'Berzerker Warband', email: 'walter@protabletop.com', checkedIn: true, listSubmitted: true }
    ],
    pairings: {
      "1": [
        { 
          table: 1, p1: 'p1', p2: 'p2', p1_name: 'John "Warlord" Hsieh', p2_name: 'Folger Pyles',
          p1_faction: 'Necrons', p2_faction: 'Blood Angels', p1Score: 88, p2Score: 65, status: 'completed',
          sourceApp: 'Tabletop Battles',
          details: {
            primaryMission: 'Take & Hold',
            p1Primary: 45, p1Secondary: 33, p1Paint: 10,
            p2Primary: 30, p2Secondary: 25, p2Paint: 10
          }
        },
        { table: 2, p1: 'p3', p2: 'p4', p1_name: 'Cody Jiru', p2_name: 'Lyle Dixon', p1_faction: 'Aeldari', p2_faction: 'Death Guard', p1Score: null, p2Score: null, status: 'pending' },
        { table: 3, p1: 'p5', p2: 'p6', p1_name: 'Frasier Parry', p2_name: 'Liam Vsl', p1_faction: 'Chaos Space Marines', p2_faction: 'Thousand Sons', p1Score: null, p2Score: null, status: 'pending' },
        { table: 4, p1: 'p7', p2: 'p8', p1_name: 'Durante Boz', p2_name: 'Walter Langendorf', p1_faction: 'Adeptus Custodes', p2_faction: 'World Eaters', p1Score: null, p2Score: null, status: 'pending' }
      ]
    }
  };
}

function switchStudioTab(tabName) {
  studioState.activeTab = tabName;
  const tabs = ['events', 'roster', 'pairings', 'standings', 'create'];

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

  if (tabName === 'events') renderEventsDirectory();
  if (tabName === 'roster') renderRoster();
  if (tabName === 'pairings') {
    renderRoundButtons();
    renderPairings();
  }
  if (tabName === 'standings') renderStandings();
}

function renderTournamentBanner() {
  const t = studioState.activeTournament;
  if (!t) return;

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

  const events = studioState.eventsList.length > 0 ? studioState.eventsList : (studioState.activeTournament ? [studioState.activeTournament] : []);

  if (events.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; background: var(--bg-card); border: 1px dashed var(--border); border-radius: var(--radius-lg); padding: 3rem 1.5rem; text-align: center;">
        <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">⚔️</div>
        <h3 style="color: #fff; margin: 0 0 0.5rem;">No Tournaments Created Yet</h3>
        <p style="color: var(--text-secondary); font-size: 0.88rem; max-width: 480px; margin: 0 auto 1.5rem;">
          Create a new Warhammer 40k tournament in Event Studio or link your Best Coast Pairings account to sync your existing tournaments.
        </p>
        <button class="btn btn-primary" onclick="switchStudioTab('create')">➕ Create Tournament</button>
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
          <button class="btn btn-outline" style="font-size: 0.78rem; padding: 0.35rem 0.75rem;" onclick="openEditTournamentModalById('${ev.id}')">
            ✏️ Edit
          </button>
          <button class="btn btn-outline" style="font-size: 0.78rem; padding: 0.35rem 0.75rem; color: #ef4444; border-color: rgba(239,68,68,0.4);" onclick="deleteStudioTournament('${ev.id}')">
            🗑️ Delete
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

  renderTournamentBanner();
  renderEventsDirectory();
  renderRoster();
  renderRoundButtons();
  renderPairings();
  renderStandings();
  switchStudioTab(targetTab);
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
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 2rem;">Please select or create a tournament first.</div>';
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
            <button class="btn btn-outline" style="font-size: 0.75rem; padding: 0.3rem 0.65rem;" onclick="launchTournamentTracker('${t.id}', ${r}, ${pair.table}, '${escapeHtml(p1.name)}', '${escapeHtml(p2.name)}', '${pair.p1}', '${pair.p2}')">
              🎲 Track Table
            </button>
            <button class="btn btn-outline" style="font-size: 0.75rem; padding: 0.3rem 0.65rem;" onclick="openScorecardModal('${matchId}')">
              📄 Scorecard
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
      const sa = standings.find(s => s.id === a.id) || { wins: 0, points: 0 };
      const sb = standings.find(s => s.id === b.id) || { wins: 0, points: 0 };
      return (sb.wins - sa.wins) || (sb.points - sa.points);
    });
  } else {
    // Random shuffle for Round 1
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
      } else {
        alert(`✅ Round ${r} Pairings Saved Successfully!`);
      }
    }
  } catch (err) {
    console.warn('Error saving pairings:', err);
  }
}

function openQuickScoreModal(tableNum) {
  const t = studioState.activeTournament;
  if (!t) return;

  const r = studioState.currentRound;
  const pairings = (t.pairings || {})[String(r)] || [];
  const pair = pairings.find(p => p.table === tableNum);
  if (!pair) return;

  const p1Name = pair.p1_name || 'Player 1';
  const p2Name = pair.p2_name || 'Player 2';
  const currentP1 = pair.p1Score !== null && pair.p1Score !== undefined ? pair.p1Score : 75;
  const currentP2 = pair.p2Score !== null && pair.p2Score !== undefined ? pair.p2Score : 60;

  const p1Val = prompt(`Enter final Battle Points for ${p1Name} (0-100):`, currentP1);
  if (p1Val === null) return;
  const p2Val = prompt(`Enter final Battle Points for ${p2Name} (0-100):`, currentP2);
  if (p2Val === null) return;

  pair.p1Score = parseInt(p1Val, 10) || 0;
  pair.p2Score = parseInt(p2Val, 10) || 0;
  pair.status = 'completed';

  renderPairings();
  renderStandings();

  // Push score to BCP & backend
  window.api.submitScoreToBcp({
    event_id: t.id,
    table: tableNum,
    round_num: r,
    p1_score: pair.p1Score,
    p2_score: pair.p2Score,
    p1_name: p1Name,
    p2_name: p2Name,
    source_app: 'EventStudio Direct'
  }).then(res => {
    console.log('Score submission result:', res);
  }).catch(e => console.warn('Score submission notice:', e));

  saveCurrentPairings();
}

function renderRoster() {
  const tbody = document.getElementById('es-roster-tbody');
  if (!tbody) return;

  const t = studioState.activeTournament;
  const roster = t ? (t.roster || []) : [];
  
  const countEl = document.getElementById('es-roster-count');
  if (countEl) countEl.textContent = roster.length;

  if (roster.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No competitors registered yet. Click <b>+ Add Competitor</b> above to add players.</td></tr>`;
    return;
  }

  tbody.innerHTML = roster.map((p, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td><b>${escapeHtml(p.name)}</b></td>
      <td><span class="badge badge-faction" style="font-size:0.76rem;">${escapeHtml(p.faction || 'Unassigned')}</span></td>
      <td style="color:var(--text-secondary); font-size:0.8rem;">${escapeHtml(p.detachment || 'Core')}</td>
      <td>
        <button class="badge ${p.checkedIn ? 'badge-match-prime' : ''}" style="cursor:pointer; border:none;" onclick="toggleCheckIn('${p.id}')">
          ${p.checkedIn ? '✅ Checked In' : '⏳ Pending'}
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
  const p = (t.roster || []).find(r => r.id === pid);
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
    t.roster = (t.roster || []).filter(r => r.id !== pid);
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
    console.warn('Error saving roster:', e);
  }
}

function openAddPlayerModal() {
  const modal = document.getElementById('add-player-modal');
  if (modal) {
    modal.classList.add('active');
    const nameInput = document.getElementById('new-player-name');
    if (nameInput) nameInput.focus();
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

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Registering Tournament...';
  }
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.textContent = 'Registering tournament and synchronizing with Best Coast Pairings...';
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
      state: cityState.includes(',') ? cityState.split(',')[1].trim() : ''
    };

    const res = await window.api.createStudioEvent(payload);
    if (res && res.success) {
      if (res.bcp_registered) {
        alert(`🎉 Tournament "${name}" successfully created and registered on Best Coast Pairings! (Event ID: ${res.event_id})`);
      } else {
        alert(`🎉 Tournament "${name}" successfully created in Event Studio!`);
      }

      await loadStudioEvents();
      if (res.event) {
        studioState.activeTournament = res.event;
      }
      renderTournamentBanner();
      switchStudioTab('roster');
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
      alert('✅ Tournament details updated and synced with BCP!');
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

  if (!confirm(`Are you sure you want to delete "${name}"?\n\nThis will remove the event, competitor roster, and pairings from Event Studio and Best Coast Pairings.`)) {
    return;
  }

  try {
    const res = await window.api.deleteStudioEvent(eventId);
    if (res && res.success) {
      alert(`🗑️ Tournament "${name}" was deleted successfully.`);
      studioState.activeTournament = null;
      await loadStudioEvents();
    }
  } catch (err) {
    alert(`Failed to delete tournament: ${err.message || err}`);
  }
}

function syncEventWithBcp() {
  alert('🔄 Synchronizing tournament roster and live match results with Best Coast Pairings API...');
  loadStudioEvents();
}

function computeStandingsArray() {
  const t = studioState.activeTournament;
  if (!t) return [];

  const roster = t.roster || [];
  const stats = {};

  roster.forEach(p => {
    stats[p.id] = {
      id: p.id,
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
        const s1 = stats[pair.p1];
        const s2 = stats[pair.p2];

        const score1 = parseInt(pair.p1Score, 10) || 0;
        const score2 = parseInt(pair.p2Score, 10) || 0;

        if (s1) {
          s1.points += score1;
          s1.diff += (score1 - score2);
          if (pair.p2) s1.opponents.push(pair.p2);

          if (score1 > score2) s1.wins++;
          else if (score2 > score1) s1.losses++;
          else s1.draws++;
        }

        if (s2) {
          s2.points += score2;
          s2.diff += (score2 - score1);
          if (pair.p1) s2.opponents.push(pair.p1);

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
  let text = `🏆 ${t ? t.name : 'Tournament'} - Official Standings (Round ${studioState.currentRound}) 🏆\n\n`;
  standings.forEach((s, idx) => {
    text += `#${idx + 1} ${s.name} (${s.faction}) - ${s.wins}W-${s.losses}L (${s.points} Battle Points, SoS: ${s.sos}%)\n`;
  });
  navigator.clipboard.writeText(text).then(() => {
    alert('Standings copied to clipboard!');
  });
}

function exportRosterCsv() {
  const t = studioState.activeTournament;
  if (!t) return;
  let csv = 'Name,Faction,Detachment,Email,CheckedIn,ListSubmitted\n';
  (t.roster || []).forEach(p => {
    csv += `"${p.name}","${p.faction || ''}","${p.detachment || ''}","${p.email || ''}",${p.checkedIn !== false},${p.listSubmitted !== false}\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `roster_${t.id}.csv`;
  a.click();
}
