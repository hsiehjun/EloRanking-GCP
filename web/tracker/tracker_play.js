/**
 * Synchronized Multiplayer 11th Edition Game Tracker Engine
 */

const OFFICIAL_11TH_SECONDARIES = [
  { id: 'assassination', name: 'Assassination', desc: 'Score 4 VP for each enemy CHARACTER destroyed (5 VP if enemy WARLORD).', maxVp: 5 },
  { id: 'bring_it_down', name: 'Bring It Down', desc: 'Score 2-5 VP for each enemy MONSTER or VEHICLE destroyed based on starting wounds.', maxVp: 5 },
  { id: 'cleanse', name: 'Cleanse', desc: 'Perform Cleanse action on 1+ objective markers not in your deployment (2 VP for 1, 4 VP for 2+).', maxVp: 4 },
  { id: 'deploy_homers', name: 'Deploy Teleport Homers', desc: 'Perform action in No Man\'s Land (2 VP) or enemy deployment zone (4 VP).', maxVp: 4 },
  { id: 'behind_lines', name: 'Behind Enemy Lines', desc: 'Score 2 VP if 1 unit wholly in enemy deployment zone, or 4 VP if 2+ units.', maxVp: 4 },
  { id: 'engage_fronts', name: 'Engage on All Fronts', desc: 'Score 2 VP if units in 3 table quarters, or 4 VP if in all 4 quarters.', maxVp: 4 },
  { id: 'storm_hostile', name: 'Storm Hostile Objective', desc: 'Score 4 VP if you control an objective controlled by opponent at turn start.', maxVp: 4 },
  { id: 'area_denial', name: 'Area Denial', desc: 'Score 2.5-5 VP for controlling center table with no enemy units near center.', maxVp: 5 },
  { id: 'no_prisoners', name: 'No Prisoners', desc: 'Score 2 VP for every 20 enemy starting wounds destroyed in this turn.', maxVp: 5 },
  { id: 'sabotage', name: 'Sabotage', desc: 'Perform sabotage action on battlefield terrain feature outside deployment (4 VP).', maxVp: 4 },
  { id: 'establish_locus', name: 'Establish Locus', desc: 'Action performed on center objective marker or enemy deployment marker (4 VP).', maxVp: 4 },
  { id: 'secure_nml', name: 'Secure No Man\'s Land', desc: 'Score 2 VP if you control 1 No Man\'s Land marker, or 5 VP if 2+ markers.', maxVp: 5 },
  { id: 'extend_lines', name: 'Extend Battle Lines', desc: 'Score 2-4 VP for controlling both your home objective and No Man\'s Land.', maxVp: 4 },
  { id: 'marked_death', name: 'Marked for Death', desc: 'Opponent picks 3 units. Score 5 VP for destroying each designated unit.', maxVp: 5 }
];

let liveMatch = {
  matchId: null,
  clientId: 'client_' + Math.random().toString(36).substring(2, 9),
  role: 'editor',
  version: 0,
  isApplyingRemote: false,
  eventSource: null,
  debounceTimer: null,
  state: {
    currentRound: 1,
    activePlayer: 1,
    pack: '11th Edition Core / Armageddon',
    primaryMission: 'Take & Hold',
    missionRule: 'Swift Action',
    deployment: 'Search & Destroy',
    p1Name: 'Player 1',
    p1Faction: 'Necrons (Awakened Dynasty)',
    p2Name: 'Player 2',
    p2Faction: 'Space Marines (Gladius Task Force)',
    p1Paint: 10,
    p2Paint: 10,
    p1Cp: 1,
    p2Cp: 1,
    p1Rounds: {
      1: { primary: 0, secondaries: [] },
      2: { primary: 0, secondaries: [] },
      3: { primary: 0, secondaries: [] },
      4: { primary: 0, secondaries: [] },
      5: { primary: 0, secondaries: [] }
    },
    p2Rounds: {
      1: { primary: 0, secondaries: [] },
      2: { primary: 0, secondaries: [] },
      3: { primary: 0, secondaries: [] },
      4: { primary: 0, secondaries: [] },
      5: { primary: 0, secondaries: [] }
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  initMultiplayerRoom();
  renderApp();
});

function initMultiplayerRoom() {
  const params = new URLSearchParams(window.location.search);
  let matchId = params.get('match_id') || params.get('room') || params.get('match');
  let role = params.get('role') || 'editor';

  if (!matchId) {
    matchId = 'MATCH-' + Math.random().toString(36).substring(2, 7).toUpperCase();
    const url = new URL(window.location.href);
    url.searchParams.set('match_id', matchId);
    window.history.replaceState({}, '', url.toString());
  }

  liveMatch.matchId = matchId.toUpperCase();
  liveMatch.role = role.toLowerCase();

  document.getElementById('match-room-code').textContent = `#${liveMatch.matchId}`;
  document.getElementById('match-role-badge').textContent = liveMatch.role.toUpperCase();
  document.getElementById('match-role-badge').className = `gt-role-tag ${liveMatch.role}`;

  startRealtimeStream();
  fetchInitialState();
}

// Real-Time SSE Stream
function startRealtimeStream() {
  if (liveMatch.eventSource) liveMatch.eventSource.close();

  try {
    const sseUrl = `/api/tracker/room/${liveMatch.matchId}/stream?client_id=${liveMatch.clientId}`;
    const es = new EventSource(sseUrl);
    liveMatch.eventSource = es;

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'state_update') {
          if (msg.sender !== liveMatch.clientId && msg.state) {
            if (msg.version >= liveMatch.version) {
              liveMatch.version = msg.version;
              applyRemoteState(msg.state);
            }
          }
        } else if (msg.type === 'presence') {
          const badge = document.getElementById('match-online-count');
          if (badge) badge.textContent = `${msg.count || 1} online`;
        }
      } catch (e) {}
    };
  } catch (e) {}
}

async function fetchInitialState() {
  try {
    const resp = await fetch(`/api/tracker/room/${liveMatch.matchId}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.state && Object.keys(data.state).length > 0) {
        liveMatch.version = data.version || 1;
        applyRemoteState(data.state);
      }
    }
  } catch (e) {}
}

function broadcastState() {
  if (liveMatch.isApplyingRemote) return;
  if (liveMatch.role === 'spectator') return;

  clearTimeout(liveMatch.debounceTimer);
  liveMatch.debounceTimer = setTimeout(async () => {
    liveMatch.version++;
    try {
      await fetch(`/api/tracker/room/${liveMatch.matchId}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          match_id: liveMatch.matchId,
          client_id: liveMatch.clientId,
          role: liveMatch.role,
          version: liveMatch.version,
          state: liveMatch.state
        })
      });
    } catch (e) {}
  }, 120);
}

function applyRemoteState(incoming) {
  liveMatch.isApplyingRemote = true;
  try {
    liveMatch.state = JSON.parse(JSON.stringify(incoming));
    renderApp();
  } finally {
    setTimeout(() => { liveMatch.isApplyingRemote = false; }, 50);
  }
}

// UI Rendering
function renderApp() {
  const s = liveMatch.state;

  // Round Tabs
  for (let r = 1; r <= 5; r++) {
    const btn = document.getElementById(`btn-rd-${r}`);
    if (btn) {
      if (r === s.currentRound) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  }

  // Dual Headers
  document.getElementById('p1-name-txt').textContent = s.p1Name;
  document.getElementById('p1-army-txt').textContent = s.p1Faction;
  document.getElementById('p1-cp-num').textContent = s.p1Cp;

  document.getElementById('p2-name-txt').textContent = s.p2Name;
  document.getElementById('p2-army-txt').textContent = s.p2Faction;
  document.getElementById('p2-cp-num').textContent = s.p2Cp;

  // Scores
  const s1 = calcScore(1);
  const s2 = calcScore(2);

  document.getElementById('p1-score-big').textContent = s1.total;
  document.getElementById('p1-pri-score').textContent = `${s1.pri}/50`;
  document.getElementById('p1-sec-score').textContent = `${s1.sec}/40`;

  document.getElementById('p2-score-big').textContent = s2.total;
  document.getElementById('p2-pri-score').textContent = `${s2.pri}/50`;
  document.getElementById('p2-sec-score').textContent = `${s2.sec}/40`;

  // Turn Buttons
  const t1 = document.getElementById('p1-turn-selector');
  const t2 = document.getElementById('p2-turn-selector');
  if (s.activePlayer === 1) {
    t1.classList.add('active');
    t2.classList.remove('active');
  } else {
    t1.classList.remove('active');
    t2.classList.add('active');
  }

  // Active Deck
  const activeName = s.activePlayer === 1 ? s.p1Name : s.p2Name;
  document.getElementById('active-deck-title').textContent = `${activeName}'s Turn (Round ${s.currentRound})`;

  renderPrimaryMatrix(s.activePlayer, s.currentRound);
  renderSecondarySlots(s.activePlayer, s.currentRound);
  renderSummaryTable();
}

function calcScore(pid) {
  const rds = pid === 1 ? liveMatch.state.p1Rounds : liveMatch.state.p2Rounds;
  let pri = 0;
  let sec = 0;

  for (let r = 1; r <= 5; r++) {
    pri += (rds[r].primary || 0);
    (rds[r].secondaries || []).forEach(x => {
      if (x.status === 'achieved') sec += (x.vp || 0);
    });
  }

  const priCapped = Math.min(50, pri);
  const secCapped = Math.min(40, sec);
  const paint = 10;
  const total = Math.min(100, priCapped + secCapped + paint);

  return { pri: priCapped, sec: secCapped, paint, total };
}

function renderPrimaryMatrix(pid, rd) {
  const container = document.getElementById('pri-buttons-wrap');
  const badge = document.getElementById('rd-pri-vp-tag');
  if (!container) return;

  const currentVal = (pid === 1 ? liveMatch.state.p1Rounds : liveMatch.state.p2Rounds)[rd].primary || 0;
  if (badge) badge.textContent = `+${currentVal} VP`;

  const increments = [
    { label: 'Hold 0 (0 VP)', vp: 0 },
    { label: 'Hold 1 (4 VP)', vp: 4 },
    { label: 'Hold 2+ (8 VP)', vp: 8 },
    { label: 'Hold More (12 VP)', vp: 12 },
    { label: 'Max (15 VP)', vp: 15 }
  ];

  container.innerHTML = increments.map(inc => `
    <button class="gt-pri-btn ${currentVal === inc.vp ? 'selected' : ''}" onclick="setPrimaryScore(${inc.vp})">
      ${inc.label}
    </button>
  `).join('');
}

function renderSecondarySlots(pid, rd) {
  const container = document.getElementById('sec-cards-container');
  const badge = document.getElementById('rd-sec-vp-tag');
  if (!container) return;

  const cards = (pid === 1 ? liveMatch.state.p1Rounds : liveMatch.state.p2Rounds)[rd].secondaries || [];
  let secSum = 0;
  cards.forEach(c => { if (c.status === 'achieved') secSum += (c.vp || 0); });
  if (badge) badge.textContent = `+${secSum} VP`;

  if (cards.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 16px; font-size: 12px; color: var(--text-muted); background: rgba(0,0,0,0.2); border-radius: 8px;">
        No active secondary cards drawn for this turn.
      </div>
    `;
    return;
  }

  container.innerHTML = cards.map((c, idx) => `
    <div class="gt-card-unit">
      <div class="gt-card-unit-head">
        <span class="gt-card-name">🎴 ${escapeHtml(c.name)}</span>
        <span class="gt-vp-pill">${c.status === 'achieved' ? `+${c.vp} VP` : c.status === 'discard' ? 'Discarded (+1 CP)' : 'Active'}</span>
      </div>
      <div class="gt-card-desc">${escapeHtml(c.desc)}</div>
      <div class="gt-card-action-bar">
        <button class="gt-chip-btn ${c.status === 'achieved' && c.vp >= 4 ? 'achieved' : ''}" onclick="setCardStatus(${idx}, 'achieved', ${c.maxVp})">
          ✅ Score Max (+${c.maxVp} VP)
        </button>
        <button class="gt-chip-btn ${c.status === 'achieved' && c.vp === 2 ? 'achieved' : ''}" onclick="setCardStatus(${idx}, 'achieved', 2)">
          🟡 Score Partial (+2 VP)
        </button>
        <button class="gt-chip-btn ${c.status === 'discard' ? 'discard' : ''}" onclick="discardCardForCp(${idx})">
          ♻️ Discard for 1 CP
        </button>
        <button class="gt-chip-btn" style="color:var(--text-muted);" onclick="removeCard(${idx})">
          ✕ Remove
        </button>
      </div>
    </div>
  `).join('');
}

function renderSummaryTable() {
  const tbody = document.getElementById('matrix-tbody');
  if (!tbody) return;

  const s = liveMatch.state;
  const s1 = calcScore(1);
  const s2 = calcScore(2);

  function sumR(rds, r) {
    let v = rds[r].primary || 0;
    (rds[r].secondaries || []).forEach(x => { if (x.status === 'achieved') v += x.vp; });
    return v;
  }

  tbody.innerHTML = `
    <tr>
      <td><b>${escapeHtml(s.p1Name)}</b> <span style="font-size:11px; color:var(--text-muted);">(${escapeHtml(s.p1Faction)})</span></td>
      <td>${sumR(s.p1Rounds, 1)} VP</td>
      <td>${sumR(s.p1Rounds, 2)} VP</td>
      <td>${sumR(s.p1Rounds, 3)} VP</td>
      <td>${sumR(s.p1Rounds, 4)} VP</td>
      <td>${sumR(s.p1Rounds, 5)} VP</td>
      <td><b>${s1.pri}</b></td>
      <td><b>${s1.sec}</b></td>
      <td>+10</td>
      <td><b style="color:var(--accent-cyan); font-size:15px;">${s1.total} VP</b></td>
    </tr>
    <tr>
      <td><b>${escapeHtml(s.p2Name)}</b> <span style="font-size:11px; color:var(--text-muted);">(${escapeHtml(s.p2Faction)})</span></td>
      <td>${sumR(s.p2Rounds, 1)} VP</td>
      <td>${sumR(s.p2Rounds, 2)} VP</td>
      <td>${sumR(s.p2Rounds, 3)} VP</td>
      <td>${sumR(s.p2Rounds, 4)} VP</td>
      <td>${sumR(s.p2Rounds, 5)} VP</td>
      <td><b>${s2.pri}</b></td>
      <td><b>${s2.sec}</b></td>
      <td>+10</td>
      <td><b style="color:var(--accent-amber); font-size:15px;">${s2.total} VP</b></td>
    </tr>
  `;
}

// User Actions
function switchRound(r) {
  liveMatch.state.currentRound = r;
  renderApp();
  broadcastState();
}

function setActivePlayer(pid) {
  liveMatch.state.activePlayer = pid;
  renderApp();
  broadcastState();
}

function changeCp(pid, delta) {
  if (pid === 1) liveMatch.state.p1Cp = Math.max(0, liveMatch.state.p1Cp + delta);
  else liveMatch.state.p2Cp = Math.max(0, liveMatch.state.p2Cp + delta);
  renderApp();
  broadcastState();
}

function setPrimaryScore(vp) {
  const pid = liveMatch.state.activePlayer;
  const rd = liveMatch.state.currentRound;
  if (pid === 1) liveMatch.state.p1Rounds[rd].primary = vp;
  else liveMatch.state.p2Rounds[rd].primary = vp;
  renderApp();
  broadcastState();
}

function setCardStatus(idx, status, vp) {
  const pid = liveMatch.state.activePlayer;
  const rd = liveMatch.state.currentRound;
  const card = (pid === 1 ? liveMatch.state.p1Rounds : liveMatch.state.p2Rounds)[rd].secondaries[idx];
  if (card) {
    card.status = status;
    card.vp = vp;
    renderApp();
    broadcastState();
  }
}

function discardCardForCp(idx) {
  const pid = liveMatch.state.activePlayer;
  const rd = liveMatch.state.currentRound;
  const card = (pid === 1 ? liveMatch.state.p1Rounds : liveMatch.state.p2Rounds)[rd].secondaries[idx];
  if (card) {
    card.status = 'discard';
    card.vp = 0;
    if (pid === 1) liveMatch.state.p1Cp++;
    else liveMatch.state.p2Cp++;
    renderApp();
    broadcastState();
  }
}

function removeCard(idx) {
  const pid = liveMatch.state.activePlayer;
  const rd = liveMatch.state.currentRound;
  (pid === 1 ? liveMatch.state.p1Rounds : liveMatch.state.p2Rounds)[rd].secondaries.splice(idx, 1);
  renderApp();
  broadcastState();
}

function advanceTurn() {
  if (liveMatch.state.activePlayer === 1) {
    liveMatch.state.activePlayer = 2;
    liveMatch.state.p2Cp++; // +1 CP at start of command phase
  } else {
    if (liveMatch.state.currentRound < 5) {
      liveMatch.state.currentRound++;
      liveMatch.state.activePlayer = 1;
      liveMatch.state.p1Cp++;
    } else {
      alert('🏁 Match Concluded (Round 5 Complete)!');
    }
  }
  renderApp();
  broadcastState();
}

function openCardDrawer() {
  const modal = document.getElementById('draw-card-modal');
  const list = document.getElementById('drawer-cards-grid');
  if (!modal || !list) return;

  list.innerHTML = OFFICIAL_11TH_SECONDARIES.map(c => `
    <div style="background:rgba(0,0,0,0.3); border:1px solid var(--panel-border); padding:10px; border-radius:8px; cursor:pointer;" onclick="drawCard('${c.id}')">
      <b style="font-family:'Chakra Petch',sans-serif; color:#fff; font-size:14px;">🎴 ${escapeHtml(c.name)}</b>
      <p style="font-size:11px; color:var(--text-muted); margin:4px 0 0 0;">${escapeHtml(c.desc)}</p>
    </div>
  `).join('');

  modal.classList.add('active');
}

function closeCardDrawer() {
  const modal = document.getElementById('draw-card-modal');
  if (modal) modal.classList.remove('active');
}

function drawCard(cardId) {
  const c = OFFICIAL_11TH_SECONDARIES.find(x => x.id === cardId);
  if (!c) return;

  const pid = liveMatch.state.activePlayer;
  const rd = liveMatch.state.currentRound;
  const currentCards = (pid === 1 ? liveMatch.state.p1Rounds : liveMatch.state.p2Rounds)[rd].secondaries;

  if (currentCards.length >= 3) {
    alert('Maximum 3 tactical cards allowed per turn.');
    return;
  }

  currentCards.push({
    id: c.id,
    name: c.name,
    desc: c.desc,
    maxVp: c.maxVp,
    status: 'active',
    vp: 0
  });

  closeCardDrawer();
  renderApp();
  broadcastState();
}

function copyShareLink() {
  const url = `${window.location.origin}/tracker?match_id=${liveMatch.matchId}`;
  navigator.clipboard.writeText(url).then(() => {
    alert('🔗 Live Match Room Link copied to clipboard!');
  });
}

function copyScoreSummary() {
  const s1 = calcScore(1);
  const s2 = calcScore(2);
  const text = `⚔️ 11TH ED MATCH RESULT (#${liveMatch.matchId}) ⚔️\n\n` +
    `🏆 ${liveMatch.state.p1Name} (${liveMatch.state.p1Faction}): ${s1.total} VP (Primary: ${s1.pri}, Secondary: ${s1.sec}, Paint: +10)\n` +
    `🛡️ ${liveMatch.state.p2Name} (${liveMatch.state.p2Faction}): ${s2.total} VP (Primary: ${s2.pri}, Secondary: ${s2.sec}, Paint: +10)\n\n` +
    `Live Match Stream: ${window.location.origin}/tracker?match_id=${liveMatch.matchId}`;
  
  navigator.clipboard.writeText(text).then(() => {
    alert('Match summary copied!');
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}
