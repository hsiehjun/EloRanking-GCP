/**
 * Warhammer 40k 11th Edition Synchronized Tracker Engine & Setup Wizard
 */

const FACTIONS_LIST = [
  'Space Marines', 'Dark Angels', 'Blood Angels', 'Space Wolves', 'Black Templars',
  'Deathwatch', 'Grey Knights', 'Adeptus Custodes', 'Adepta Sororitas',
  'Astra Militarum', 'Adeptus Mechanicus', 'Imperial Knights', 'Agents of the Imperium',
  'Chaos Space Marines', 'World Eaters', 'Thousand Sons', 'Death Guard',
  'Chaos Daemons', 'Chaos Knights', 'Aeldari', 'Drukhari', 'Necrons',
  'Orks', 'T\'au Empire', 'Tyranids', 'Genestealer Cults', 'Leagues of Votann'
];

const OFFICIAL_11TH_PRIMARIES = [
  { id: 'take_and_hold', name: 'Take & Hold', desc: 'Score 4 VP for 1, 8 VP for 2+, 12 VP for more.' },
  { id: 'purge_the_foe', name: 'Purge the Foe', desc: 'Score 4 VP for kills, 4-8 VP for objective control.' },
  { id: 'scorched_earth', name: 'Scorched Earth', desc: 'Score for objectives and burn opponent markers.' },
  { id: 'crucible_of_battle', name: 'Crucible of Battle', desc: 'Progressive control across central battle line.' },
  { id: 'priority_targets', name: 'Priority Targets', desc: 'Higher VP rewards in rounds 4 and 5.' },
  { id: 'supply_drop', name: 'Supply Drop', desc: 'Objectives disappear sequentially each battle round.' },
  { id: 'the_ritual', name: 'The Ritual', desc: 'Perform rituals in No Man\'s Land to create new markers.' }
];

const OFFICIAL_11TH_DEPLOYMENTS = [
  'Search & Destroy', 'Dawn of War', 'Hammer and Anvil', 'Sweeping Engagement', 'Tipping Point'
];

const OFFICIAL_11TH_TWISTS = [
  'Swift Action (Advance & Action)', 'Supply Lines', 'Fog of War', 'Hidden Supplies', 'Minefields', 'Target of Opportunity'
];

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
    started: false,
    currentRound: 1,
    activePlayer: 1,
    pack: '11th Edition Core / Armageddon',
    primaryMission: 'Take & Hold',
    missionRule: 'Swift Action',
    deployment: 'Search & Destroy',
    p1Name: 'Player 1',
    p1Faction: 'Necrons',
    p1Detachment: 'Awakened Dynasty',
    p1Disposition: 'Vanguard Strike',
    p1Role: 'attacker',
    p2Name: 'Player 2',
    p2Faction: 'Space Marines',
    p2Detachment: 'Gladius Task Force',
    p2Disposition: 'Hammer & Anvil',
    p2Role: 'defender',
    rollOffWinner: 1,
    firstTurn: 1,
    p1Paint: 10,
    p2Paint: 10,
    p1Cp: 1,
    p2Cp: 1,
    p1Rounds: { 1: { primary: 0, secondaries: [] }, 2: { primary: 0, secondaries: [] }, 3: { primary: 0, secondaries: [] }, 4: { primary: 0, secondaries: [] }, 5: { primary: 0, secondaries: [] } },
    p2Rounds: { 1: { primary: 0, secondaries: [] }, 2: { primary: 0, secondaries: [] }, 3: { primary: 0, secondaries: [] }, 4: { primary: 0, secondaries: [] }, 5: { primary: 0, secondaries: [] } }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  initTrackerMode();
});

function initTrackerMode() {
  const params = new URLSearchParams(window.location.search);
  const path = window.location.pathname;
  let matchId = params.get('match_id') || params.get('room') || params.get('match');
  let role = params.get('role') || 'editor';

  const isPlayRoute = path.includes('/play') || params.get('view') === 'play';

  if (!isPlayRoute && !matchId) {
    // Show Home Dashboard View
    showHomeDashboard();
    return;
  }

  if (!matchId) {
    matchId = 'WH40K-' + Math.random().toString(36).substring(2, 7).toUpperCase();
    const url = new URL(window.location.href);
    url.searchParams.set('match_id', matchId);
    window.history.replaceState({}, '', url.toString());
  }

  liveMatch.matchId = matchId.toUpperCase();
  liveMatch.role = role.toLowerCase();

  document.getElementById('view-home-container').style.display = 'none';
  document.getElementById('view-play-container').style.display = 'block';

  document.getElementById('match-room-code').textContent = `#${liveMatch.matchId}`;
  document.getElementById('match-role-badge').textContent = liveMatch.role.toUpperCase();

  startRealtimeStream();
  fetchInitialState();
}

// 1. Home Dashboard View
function showHomeDashboard() {
  document.getElementById('view-home-container').style.display = 'block';
  document.getElementById('view-play-container').style.display = 'none';
  loadGameHistory();
}

function loadGameHistory() {
  const container = document.getElementById('history-list-wrap');
  if (!container) return;

  let history = [];
  try {
    history = JSON.parse(localStorage.getItem('gt_local_history') || '[]');
  } catch (e) {}

  if (history.length === 0) {
    container.innerHTML = `
      <div class="gt-empty-box">
        <div style="font-size: 24px; margin-bottom: 6px;">🎲</div>
        <div style="font-weight: 700; color: #fff; margin-bottom: 4px;">NO GAMES YET</div>
        <div>Tap <b>+ New Game</b> above to configure and launch a live synchronized match.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = history.map(g => `
    <div class="gt-history-card" onclick="openHistoryGame('${g.matchId}')">
      <div>
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
          <b style="font-size: 15px; color: #fff;">${escapeHtml(g.p1Name || 'Player 1')} vs ${escapeHtml(g.p2Name || 'Player 2')}</b>
          <span class="gt-pack-pill">#${g.matchId}</span>
        </div>
        <div style="font-size: 12px; color: var(--text-muted);">
          ${escapeHtml(g.primaryMission || 'Take & Hold')} • ${g.started ? `Round ${g.currentRound || 1}` : 'Setup Mode'}
        </div>
      </div>
      <div style="text-align: right;">
        <div style="font-family:'Chakra Petch',sans-serif; font-size: 18px; font-weight: 700; color: var(--accent-cyan);">
          ${g.p1Score || 0} - ${g.p2Score || 0} VP
        </div>
        <div style="font-size: 11px; color: var(--text-muted);">${g.date || 'Recent'}</div>
      </div>
    </div>
  `).join('');
}

function startNewGame() {
  const newMatchId = 'WH40K-' + Math.random().toString(36).substring(2, 7).toUpperCase();
  window.location.href = `/tracker/play?match_id=${newMatchId}`;
}

function joinMatchByCode() {
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  if (code) {
    window.location.href = `/tracker/play?match_id=${code}`;
  }
}

function openHistoryGame(id) {
  window.location.href = `/tracker/play?match_id=${id}`;
}

// 2. Real-Time Stream Engine
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
        return;
      }
    }
  } catch (e) {}
  renderApp();
}

function broadcastState() {
  if (liveMatch.isApplyingRemote) return;
  if (liveMatch.role === 'spectator') return;

  saveToLocalHistory();

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

function saveToLocalHistory() {
  try {
    let history = JSON.parse(localStorage.getItem('gt_local_history') || '[]');
    const s1 = calcScore(1);
    const s2 = calcScore(2);
    const item = {
      matchId: liveMatch.matchId,
      p1Name: liveMatch.state.p1Name,
      p2Name: liveMatch.state.p2Name,
      primaryMission: liveMatch.state.primaryMission,
      started: liveMatch.state.started,
      currentRound: liveMatch.state.currentRound,
      p1Score: s1.total,
      p2Score: s2.total,
      date: new Date().toLocaleDateString()
    };
    const idx = history.findIndex(x => x.matchId === liveMatch.matchId);
    if (idx >= 0) history[idx] = item;
    else history.unshift(item);
    localStorage.setItem('gt_local_history', JSON.stringify(history.slice(0, 20)));
  } catch (e) {}
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

// 3. UI Flow: Setup Wizard vs Live Scorecard
function renderApp() {
  const s = liveMatch.state;

  if (!s.started) {
    document.getElementById('setup-wizard-shell').style.display = 'block';
    document.getElementById('live-scorecard-shell').style.display = 'none';
    populateSetupForm();
  } else {
    document.getElementById('setup-wizard-shell').style.display = 'none';
    document.getElementById('live-scorecard-shell').style.display = 'block';
    renderScorecard();
  }
}

function populateSetupForm() {
  const s = liveMatch.state;
  document.getElementById('setup-p1-name').value = s.p1Name || '';
  document.getElementById('setup-p1-faction').value = s.p1Faction || 'Necrons';
  document.getElementById('setup-p1-detachment').value = s.p1Detachment || '';

  document.getElementById('setup-p2-name').value = s.p2Name || '';
  document.getElementById('setup-p2-faction').value = s.p2Faction || 'Space Marines';
  document.getElementById('setup-p2-detachment').value = s.p2Detachment || '';

  document.getElementById('setup-mission-select').value = s.primaryMission || 'Take & Hold';
  document.getElementById('setup-deploy-select').value = s.deployment || 'Search & Destroy';
  document.getElementById('setup-twist-select').value = s.missionRule || 'Swift Action';

  setChoiceActive('p1-role', s.p1Role || 'attacker');
  setChoiceActive('first-turn', s.firstTurn || 1);
}

function setChoiceActive(group, val) {
  document.querySelectorAll(`[data-group="${group}"]`).forEach(btn => {
    if (btn.getAttribute('data-val') == val) btn.classList.add('selected');
    else btn.classList.remove('selected');
  });
}

function onSetupChoice(group, val) {
  setChoiceActive(group, val);
  if (group === 'p1-role') {
    liveMatch.state.p1Role = val;
    liveMatch.state.p2Role = val === 'attacker' ? 'defender' : 'attacker';
  } else if (group === 'first-turn') {
    liveMatch.state.firstTurn = parseInt(val);
    liveMatch.state.activePlayer = parseInt(val);
  }
  broadcastState();
}

function startBattleFromSetup() {
  const s = liveMatch.state;
  s.p1Name = document.getElementById('setup-p1-name').value.trim() || 'Player 1';
  s.p1Faction = document.getElementById('setup-p1-faction').value;
  s.p1Detachment = document.getElementById('setup-p1-detachment').value.trim();

  s.p2Name = document.getElementById('setup-p2-name').value.trim() || 'Player 2';
  s.p2Faction = document.getElementById('setup-p2-faction').value;
  s.p2Detachment = document.getElementById('setup-p2-detachment').value.trim();

  s.primaryMission = document.getElementById('setup-mission-select').value;
  s.deployment = document.getElementById('setup-deploy-select').value;
  s.missionRule = document.getElementById('setup-twist-select').value;

  s.started = true;
  s.currentRound = 1;
  s.p1Cp = 1;
  s.p2Cp = 1;

  renderApp();
  broadcastState();
}

function editSetupAgain() {
  liveMatch.state.started = false;
  renderApp();
  broadcastState();
}

// 4. Live Scorecard Rendering
function renderScorecard() {
  const s = liveMatch.state;

  for (let r = 1; r <= 5; r++) {
    const btn = document.getElementById(`btn-rd-${r}`);
    if (btn) {
      if (r === s.currentRound) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  }

  // Header Player Info
  document.getElementById('p1-name-txt').textContent = s.p1Name;
  document.getElementById('p1-army-txt').textContent = `${s.p1Faction}${s.p1Detachment ? ' (' + s.p1Detachment + ')' : ''}`;
  document.getElementById('p1-cp-num').textContent = s.p1Cp;

  document.getElementById('p2-name-txt').textContent = s.p2Name;
  document.getElementById('p2-army-txt').textContent = `${s.p2Faction}${s.p2Detachment ? ' (' + s.p2Detachment + ')' : ''}`;
  document.getElementById('p2-cp-num').textContent = s.p2Cp;

  // Center Mission Info
  document.getElementById('center-mission-title').textContent = s.primaryMission;
  document.getElementById('center-rule-sub').textContent = `Rule: ${s.missionRule}`;
  document.getElementById('center-map-sub').textContent = `Map: ${s.deployment}`;

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
    liveMatch.state.p2Cp++;
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
  const url = `${window.location.origin}/tracker/play?match_id=${liveMatch.matchId}`;
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
    `Live Match Stream: ${window.location.origin}/tracker/play?match_id=${liveMatch.matchId}`;
  
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
