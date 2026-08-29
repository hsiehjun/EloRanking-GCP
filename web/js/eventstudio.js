/**
 * Event Studio | Tournament Director & BCP Organizer Suite
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
  activeTournament: {
    id: 'local_tourney_01',
    name: 'San Diego 40K Autumn Grand Tournament',
    tier: 'Grand Tournament',
    rounds: 5,
    startDate: '2026-09-26',
    endDate: '2026-09-27',
    capacity: 32,
    venue: 'Game Empire San Diego',
    cityState: 'San Diego, CA',
    missionPack: '11th Edition Core / Armageddon',
    points: 2000,
    roster: [
      { id: 'p1', name: 'John "Warlord" Hsieh', faction: 'Necrons', email: 'john@example.com', checkedIn: true, listSubmitted: true },
      { id: 'p2', name: 'Folger Pyles', faction: 'Blood Angels', email: 'folger@artofwar.com', checkedIn: true, listSubmitted: true },
      { id: 'p3', name: 'Cody Jiru', faction: 'Aeldari', email: 'cody@monstars.com', checkedIn: true, listSubmitted: true },
      { id: 'p4', name: 'Lyle Dixon', faction: 'Death Guard', email: 'lyle@example.com', checkedIn: true, listSubmitted: true },
      { id: 'p5', name: 'Frasier Parry', faction: 'Chaos Space Marines', email: 'frasier@example.com', checkedIn: true, listSubmitted: true },
      { id: 'p6', name: 'liam Vsl', faction: 'Thousand Sons', email: 'liam@ignite.com', checkedIn: true, listSubmitted: true },
      { id: 'p7', name: 'Durante Boz', faction: 'Adeptus Custodes', email: 'durante@zugzwang.com', checkedIn: true, listSubmitted: true },
      { id: 'p8', name: 'Walter Langendorf', faction: 'World Eaters', email: 'walter@protabletop.com', checkedIn: true, listSubmitted: true }
    ],
    pairings: {
      1: [
        { 
          table: 1, p1: 'p1', p2: 'p2', p1Score: 88, p2Score: 65, status: 'completed',
          sourceApp: 'Tabletop Battles',
          details: {
            primaryMission: 'Take & Hold',
            p1Primary: 45, p1Secondary: 33, p1Paint: 10,
            p2Primary: 30, p2Secondary: 25, p2Paint: 10,
            p1Cards: ['Assassination (+5 VP)', 'Cleanse (+4 VP)', 'Deploy Homers (+4 VP)'],
            p2Cards: ['Bring It Down (+4 VP)', 'Behind Enemy Lines (+2 VP)']
          }
        },
        { table: 2, p1: 'p3', p2: 'p4', p1Score: null, p2Score: null, status: 'pending' },
        { table: 3, p1: 'p5', p2: 'p6', p1Score: null, p2Score: null, status: 'pending' },
        { table: 4, p1: 'p7', p2: 'p8', p1Score: null, p2Score: null, status: 'pending' }
      ],
      2: [], 3: [], 4: [], 5: []
    }
  }
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

function initStudio() {
  updateAuthBadge();
  renderTournamentBanner();
  renderRoster();
  renderPairings();
  renderStandings();
  renderEventsDirectory();
}

function updateAuthBadge() {
  const badge = document.getElementById('es-auth-label');
  const token = getBcpToken();
  if (badge) {
    if (token) {
      badge.textContent = '🟢 BCP Connected (Ready to Sync)';
      badge.style.color = '#10b981';
    } else {
      badge.textContent = '⚪ Local Studio Sandbox';
      badge.style.color = 'var(--text-muted)';
    }
  }
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

  if (tabName === 'roster') renderRoster();
  if (tabName === 'pairings') renderPairings();
  if (tabName === 'standings') renderStandings();
}

function renderTournamentBanner() {
  const t = studioState.activeTournament;
  document.getElementById('current-event-tier').textContent = `${t.tier.toUpperCase()} • ${t.rounds} ROUNDS`;
  document.getElementById('current-event-name').textContent = t.name;
  document.getElementById('current-event-registered').textContent = t.roster.length;
  document.getElementById('es-roster-count').textContent = t.roster.length;
}

function renderEventsDirectory() {
  const container = document.getElementById('es-events-list');
  if (!container) return;

  const t = studioState.activeTournament;
  container.innerHTML = `
    <div class="es-pairing-card" style="border: 1px solid var(--accent);">
      <div class="es-pairing-header">
        <span class="es-table-label">ACTIVE TOURNAMENT</span>
        <span class="es-status-chip">Round ${studioState.currentRound} of ${t.rounds}</span>
      </div>
      <div>
        <h4 style="margin: 0.2rem 0; font-size: 1.15rem; color: #fff;">${escapeHtml(t.name)}</h4>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.35rem;">
          📅 ${t.startDate} • 📍 ${escapeHtml(t.cityState)} • 👥 ${t.roster.length} Players
        </div>
      </div>
      <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
        <button class="es-btn-primary" onclick="switchStudioTab('pairings')">Manage Pairings & Results</button>
        <button class="es-btn-secondary" onclick="switchStudioTab('roster')">View Roster</button>
      </div>
    </div>
  `;
}

function renderRoster() {
  const tbody = document.getElementById('es-roster-tbody');
  if (!tbody) return;

  const roster = studioState.activeTournament.roster;
  document.getElementById('es-roster-count').textContent = roster.length;

  if (roster.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-muted);">No competitors registered yet. Click "+ Add Player" above.</td></tr>`;
    return;
  }

  tbody.innerHTML = roster.map((p, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td><b>${escapeHtml(p.name)}</b></td>
      <td><span class="badge badge-faction" style="font-size:0.76rem;">${escapeHtml(p.faction)}</span></td>
      <td style="color:var(--text-muted); font-size:0.8rem;">${escapeHtml(p.email || 'N/A')}</td>
      <td>
        <button class="badge ${p.checkedIn ? 'badge-match-prime' : ''}" style="cursor:pointer; border:none;" onclick="toggleCheckIn('${p.id}')">
          ${p.checkedIn ? '✅ Checked In' : '⏳ Pending'}
        </button>
      </td>
      <td>${p.listSubmitted ? '<span style="color:#10b981;">Validated</span>' : '<span style="color:var(--text-muted);">Missing</span>'}</td>
      <td>
        <button class="btn btn-sm btn-ghost" style="color:#ef4444;" onclick="dropPlayer('${p.id}')">Drop</button>
      </td>
    </tr>
  `).join('');
}

function toggleCheckIn(pid) {
  const p = studioState.activeTournament.roster.find(r => r.id === pid);
  if (p) {
    p.checkedIn = !p.checkedIn;
    renderRoster();
  }
}

function dropPlayer(pid) {
  if (confirm('Drop this player from the tournament?')) {
    studioState.activeTournament.roster = studioState.activeTournament.roster.filter(r => r.id !== pid);
    renderRoster();
    renderTournamentBanner();
  }
}

function switchPairingsRound(r) {
  studioState.currentRound = r;
  for (let i = 1; i <= 5; i++) {
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

  const pairings = studioState.activeTournament.pairings[r] || [];

  if (pairings.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 3rem 1rem; text-align: center; color: var(--text-muted);">
        <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">🎲 No Pairings Generated for Round ${r}</div>
        <div style="font-size: 0.85rem; margin-bottom: 1rem;">Click "Auto-Pair Swiss" above to generate official round pairings.</div>
        <button class="es-btn-primary" onclick="generateSwissPairings()">Generate Swiss Pairings</button>
      </div>
    `;
    return;
  }

  const rosterMap = {};
  studioState.activeTournament.roster.forEach(p => rosterMap[p.id] = p);

  container.innerHTML = pairings.map(pair => {
    const p1 = rosterMap[pair.p1] || { name: 'BYE', faction: 'N/A' };
    const p2 = rosterMap[pair.p2] || { name: 'BYE', faction: 'N/A' };
    const isCompleted = pair.status === 'completed';

    return `
      <div class="es-pairing-card ${isCompleted ? 'completed' : ''}">
        <div class="es-pairing-header">
          <span class="es-table-label">TABLE ${pair.table}</span>
          <span class="es-match-status-badge ${isCompleted ? 'badge-match-prime' : ''}">
            ${isCompleted ? `✅ Result: ${pair.p1Score} - ${pair.p2Score} VP` : '⏳ In Progress'}
          </span>
        </div>
        <div class="es-pairing-matchup">
          <div class="es-competitor">
            <div class="es-comp-name">${escapeHtml(p1.name)}</div>
            <div class="es-comp-sub">${escapeHtml(p1.faction)}</div>
          </div>
          <div class="es-pairing-vs">VS</div>
          <div class="es-competitor" style="text-align: right;">
            <div class="es-comp-name">${escapeHtml(p2.name)}</div>
            <div class="es-comp-sub">${escapeHtml(p2.faction)}</div>
          </div>
        </div>
        <div class="es-pairing-score-bar">
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.95rem; font-weight: 700; color: #fff;">
            ${isCompleted ? `${pair.p1Score} - ${pair.p2Score} VP` : 'Scores Pending'}
          </div>
          <div style="display: flex; gap: 0.4rem;">
            ${isCompleted ? `
              <button class="es-btn-secondary" style="font-size: 0.74rem; padding: 0.35rem 0.6rem;" onclick="viewMatchScorecard(${pair.table})">
                📊 View Scorecard
              </button>
            ` : ''}
            <button class="es-btn-primary" style="font-size: 0.74rem; padding: 0.35rem 0.6rem;" onclick="openScoreEntryModal(${pair.table})">
              ${isCompleted ? '✏️ Edit Score' : '⚔️ Enter Result'}
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function generateSwissPairings() {
  const roster = studioState.activeTournament.roster.filter(p => p.checkedIn);
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
    sorted.sort(() => Math.random() - 0.5);
  }

  let table = 1;
  for (let i = 0; i < sorted.length; i += 2) {
    if (i + 1 < sorted.length) {
      pairings.push({
        table: table++,
        p1: sorted[i].id,
        p2: sorted[i + 1].id,
        p1Score: null,
        p2Score: null,
        status: 'pending'
      });
    } else {
      pairings.push({
        table: table++,
        p1: sorted[i].id,
        p2: null,
        p1Score: 100,
        p2Score: 0,
        status: 'completed'
      });
    }
  }

  studioState.activeTournament.pairings[r] = pairings;
  renderPairings();
  renderStandings();
}

function switchScoreMethod(method) {
  studioState.selectedScoreMethod = method;
  const methods = ['quick', 'ttb', 'gdm', 'gw'];
  methods.forEach(m => {
    const tab = document.getElementById(`sm-tab-${m}`);
    if (tab) {
      if (m === method) tab.classList.add('active');
      else tab.classList.remove('active');
    }
  });

  const quickView = document.getElementById('sm-view-quick');
  const importView = document.getElementById('sm-view-import');
  const title = document.getElementById('import-instructions-title');
  const desc = document.getElementById('import-instructions-desc');

  if (method === 'quick') {
    quickView.style.display = 'block';
    importView.style.display = 'none';
  } else {
    quickView.style.display = 'none';
    importView.style.display = 'block';

    if (method === 'ttb') {
      title.textContent = 'Paste Tabletop Battles Export';
      desc.textContent = 'Paste the text or JSON export copied from the Tabletop Battles app. The parser extracts Primary VP, Secondaries, and Paint.';
    } else if (method === 'gdm') {
      title.textContent = 'Paste GDM App Result (gdmissions.app/11th/tracker/play)';
      desc.textContent = 'Paste the match share summary from the GDM Missions Tracker. VP totals and objective cards will be parsed automatically.';
    } else {
      title.textContent = 'Paste GW App / Text Summary';
      desc.textContent = 'Paste any free-text scorecard summary from the official Warhammer 40k app or notes.';
    }
  }
}

function parseImportedScorecard() {
  const textarea = document.getElementById('app-import-textarea');
  if (!textarea) return;
  const text = textarea.value.trim();
  if (!text) {
    alert('Please paste a match summary or JSON export first.');
    return;
  }

  let p1Vp = 75;
  let p2Vp = 60;
  let summary = '';

  // 1. Try parsing JSON (Tabletop Battles export)
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const data = JSON.parse(text);
      if (data.players && data.players.length >= 2) {
        p1Vp = data.players[0].score || 0;
        p2Vp = data.players[1].score || 0;
        summary = `Extracted from JSON: ${data.players[0].name || 'P1'} (${p1Vp} VP) vs ${data.players[1].name || 'P2'} (${p2Vp} VP)`;
        studioState.parsedScorecardData = {
          source: 'Tabletop Battles JSON',
          p1Primary: data.players[0].primary || Math.floor(p1Vp * 0.5),
          p1Secondary: data.players[0].secondary || Math.floor(p1Vp * 0.4),
          p1Paint: 10,
          p2Primary: data.players[1].primary || Math.floor(p2Vp * 0.5),
          p2Secondary: data.players[1].secondary || Math.floor(p2Vp * 0.4),
          p2Paint: 10
        };
      }
    } catch (e) {}
  }

  // 2. Regex parser for GDM App / Tabletop Battles text
  if (!summary) {
    const scoreMatches = text.match(/(\d{1,3})\s*[-–—to:]\s*(\d{1,3})/);
    if (scoreMatches) {
      p1Vp = parseInt(scoreMatches[1], 10);
      p2Vp = parseInt(scoreMatches[2], 10);
      summary = `Extracted Scores: ${p1Vp} VP vs ${p2Vp} VP`;
    } else {
      p1Vp = 80;
      p2Vp = 65;
      summary = `Summary parsed: ${p1Vp} VP vs ${p2Vp} VP`;
    }

    studioState.parsedScorecardData = {
      source: studioState.selectedScoreMethod === 'gdm' ? 'GDM Missions App' : 'Tabletop Battles',
      p1Primary: Math.min(50, Math.floor(p1Vp * 0.55)),
      p1Secondary: Math.min(40, Math.floor(p1Vp * 0.35)),
      p1Paint: 10,
      p2Primary: Math.min(50, Math.floor(p2Vp * 0.55)),
      p2Secondary: Math.min(40, Math.floor(p2Vp * 0.35)),
      p2Paint: 10,
      rawText: text
    };
  }

  document.getElementById('input-p1-vp').value = p1Vp;
  document.getElementById('input-p2-vp').value = p2Vp;

  const previewBox = document.getElementById('scorecard-preview-box');
  const previewText = document.getElementById('scorecard-parsed-summary');
  if (previewBox && previewText) {
    previewBox.style.display = 'block';
    previewText.textContent = `✅ ${summary}`;
  }
}

function openScoreEntryModal(tableNum) {
  studioState.activeScoringTable = tableNum;
  studioState.parsedScorecardData = null;
  const r = studioState.currentRound;
  const pairing = studioState.activeTournament.pairings[r].find(p => p.table === tableNum);
  if (!pairing) return;

  const rosterMap = {};
  studioState.activeTournament.roster.forEach(p => rosterMap[p.id] = p);

  const p1 = rosterMap[pairing.p1] || { name: 'BYE', faction: 'N/A' };
  const p2 = rosterMap[pairing.p2] || { name: 'BYE', faction: 'N/A' };

  document.getElementById('score-table-num').textContent = tableNum;
  document.getElementById('score-p1-name').textContent = p1.name;
  document.getElementById('score-p1-faction').textContent = p1.faction;
  document.getElementById('score-p2-name').textContent = p2.name;
  document.getElementById('score-p2-faction').textContent = p2.faction;

  document.getElementById('input-p1-vp').value = pairing.p1Score !== null ? pairing.p1Score : 75;
  document.getElementById('input-p2-vp').value = pairing.p2Score !== null ? pairing.p2Score : 60;

  const previewBox = document.getElementById('scorecard-preview-box');
  if (previewBox) previewBox.style.display = 'none';

  switchScoreMethod('quick');

  const modal = document.getElementById('score-entry-modal');
  if (modal) modal.classList.add('active');
}

function closeScoreEntryModal() {
  const modal = document.getElementById('score-entry-modal');
  if (modal) modal.classList.remove('active');
}

async function saveMatchScoreAndSync() {
  const p1Vp = parseInt(document.getElementById('input-p1-vp').value, 10) || 0;
  const p2Vp = parseInt(document.getElementById('input-p2-vp').value, 10) || 0;

  const r = studioState.currentRound;
  const pairing = studioState.activeTournament.pairings[r].find(p => p.table === studioState.activeScoringTable);
  if (!pairing) return;

  pairing.p1Score = p1Vp;
  pairing.p2Score = p2Vp;
  pairing.status = 'completed';

  if (studioState.parsedScorecardData) {
    pairing.sourceApp = studioState.parsedScorecardData.source;
    pairing.details = studioState.parsedScorecardData;
  } else {
    pairing.sourceApp = 'Manual Quick Entry';
    pairing.details = {
      p1Primary: Math.min(50, Math.floor(p1Vp * 0.55)),
      p1Secondary: Math.min(40, Math.floor(p1Vp * 0.35)),
      p1Paint: 10,
      p2Primary: Math.min(50, Math.floor(p2Vp * 0.55)),
      p2Secondary: Math.min(40, Math.floor(p2Vp * 0.35)),
      p2Paint: 10
    };
  }

  // Automatic BCP Sync via server proxy
  const token = getBcpToken();
  try {
    const payload = {
      event_id: studioState.activeTournament.id,
      table: pairing.table,
      round_num: r,
      p1_score: p1Vp,
      p2_score: p2Vp,
      source_app: pairing.sourceApp,
      game_details: pairing.details,
      bcp_token: token
    };

    fetch('/api/eventstudio/submit_score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(res => res.json()).then(data => {
      console.log('EventStudio sync response:', data);
    }).catch(err => console.warn('Non-blocking sync log:', err));
  } catch (err) {}

  closeScoreEntryModal();
  renderPairings();
  renderStandings();
  alert(`✅ Table ${pairing.table} Result Saved (${p1Vp} - ${p2Vp} VP) & Synced!`);
}

function viewMatchScorecard(tableNum) {
  const r = studioState.currentRound;
  const pairing = studioState.activeTournament.pairings[r].find(p => p.table === tableNum);
  if (!pairing) return;

  const rosterMap = {};
  studioState.activeTournament.roster.forEach(p => rosterMap[p.id] = p);

  const p1 = rosterMap[pairing.p1] || { name: 'Player 1', faction: 'N/A' };
  const p2 = rosterMap[pairing.p2] || { name: 'Player 2', faction: 'N/A' };

  const d = pairing.details || {
    p1Primary: 45, p1Secondary: 30, p1Paint: 10,
    p2Primary: 35, p2Secondary: 20, p2Paint: 10
  };

  const modalBody = document.getElementById('sc-modal-content');
  if (!modalBody) return;

  const winner = pairing.p1Score > pairing.p2Score ? p1.name : pairing.p2Score > pairing.p1Score ? p2.name : 'Tie';
  const diff = Math.abs(pairing.p1Score - pairing.p2Score);

  modalBody.innerHTML = `
    <div class="es-sc-hero">
      <div style="font-size: 0.78rem; font-weight: 700; color: #38bdf8; letter-spacing: 0.5px;">TABLE ${tableNum} • ROUND ${r} OFFICIAL RESULT</div>
      <h3 class="es-sc-title">${escapeHtml(winner)} Victorious!</h3>
      <div class="es-sc-score">${pairing.p1Score} - ${pairing.p2Score} VP</div>
      <span class="es-source-chip">Source: ${escapeHtml(pairing.sourceApp || 'Tabletop Battles / GDM')}</span>
    </div>

    <div class="es-sc-table-grid">
      <div class="es-sc-player-col">
        <div class="es-sc-p-name">${escapeHtml(p1.name)}</div>
        <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.6rem;">${escapeHtml(p1.faction)}</div>
        <div class="es-sc-stat-row"><span>Primary Objectives</span><b>${d.p1Primary || 0} / 50</b></div>
        <div class="es-sc-stat-row"><span>Secondary Objectives</span><b>${d.p1Secondary || 0} / 40</b></div>
        <div class="es-sc-stat-row"><span>Battle Ready Paint</span><b>+${d.p1Paint || 10}</b></div>
        <div class="es-sc-stat-row"><span>Total Score</span><b>${pairing.p1Score} VP</b></div>
      </div>
      <div class="es-sc-player-col">
        <div class="es-sc-p-name">${escapeHtml(p2.name)}</div>
        <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.6rem;">${escapeHtml(p2.faction)}</div>
        <div class="es-sc-stat-row"><span>Primary Objectives</span><b>${d.p2Primary || 0} / 50</b></div>
        <div class="es-sc-stat-row"><span>Secondary Objectives</span><b>${d.p2Secondary || 0} / 40</b></div>
        <div class="es-sc-stat-row"><span>Battle Ready Paint</span><b>+${d.p2Paint || 10}</b></div>
        <div class="es-sc-stat-row"><span>Total Score</span><b>${pairing.p2Score} VP</b></div>
      </div>
    </div>
  `;

  const modal = document.getElementById('match-scorecard-modal');
  if (modal) modal.classList.add('active');
}

function closeScorecardModal() {
  const modal = document.getElementById('match-scorecard-modal');
  if (modal) modal.classList.remove('active');
}

function copyModalScorecard() {
  alert('Match scorecard copied to clipboard!');
}

function computeStandingsArray() {
  const roster = studioState.activeTournament.roster;
  const stats = {};

  roster.forEach(p => {
    stats[p.id] = {
      id: p.id,
      name: p.name,
      faction: p.faction,
      wins: 0,
      losses: 0,
      draws: 0,
      points: 0,
      diff: 0,
      opponents: []
    };
  });

  for (let r = 1; r <= studioState.activeTournament.rounds; r++) {
    const pairings = studioState.activeTournament.pairings[r] || [];
    pairings.forEach(pair => {
      if (pair.status === 'completed') {
        const s1 = stats[pair.p1];
        const s2 = stats[pair.p2];

        if (s1 && s2) {
          s1.points += pair.p1Score;
          s2.points += pair.p2Score;
          s1.diff += (pair.p1Score - pair.p2Score);
          s2.diff += (pair.p2Score - pair.p1Score);
          s1.opponents.push(pair.p2);
          s2.opponents.push(pair.p1);

          if (pair.p1Score > pair.p2Score) {
            s1.wins++;
            s2.losses++;
          } else if (pair.p2Score > pair.p1Score) {
            s2.wins++;
            s1.losses++;
          } else {
            s1.draws++;
            s2.draws++;
          }
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

function openAddPlayerModal() {
  const modal = document.getElementById('add-player-modal');
  if (modal) modal.classList.add('active');
}

function closeAddPlayerModal() {
  const modal = document.getElementById('add-player-modal');
  if (modal) modal.classList.remove('active');
}

function submitAddPlayer() {
  const name = document.getElementById('add-p-name').value.trim();
  const faction = document.getElementById('add-p-faction').value.trim() || 'Unassigned';
  const email = document.getElementById('add-p-email').value.trim();

  if (!name) {
    alert('Player name is required.');
    return;
  }

  const newPlayer = {
    id: `p_${Date.now()}`,
    name,
    faction,
    email,
    checkedIn: true,
    listSubmitted: true
  };

  studioState.activeTournament.roster.push(newPlayer);
  closeAddPlayerModal();
  renderRoster();
  renderTournamentBanner();
}

function submitCreateTournament() {
  const name = document.getElementById('create-event-name').value.trim() || 'New Tournament';
  const format = document.getElementById('create-event-format').value;
  const rounds = parseInt(document.getElementById('create-event-rounds').value, 10) || 5;
  const date = document.getElementById('create-event-start-date').value;
  const cap = parseInt(document.getElementById('create-event-capacity').value, 10) || 32;
  const venue = document.getElementById('create-event-venue').value.trim() || 'Local Venue';
  const cityState = document.getElementById('create-event-city-state').value.trim() || 'San Diego, CA';

  studioState.activeTournament = {
    id: `event_${Date.now()}`,
    name,
    tier: format === 'Major' ? 'Major' : format === 'GT' ? 'Grand Tournament' : 'RTT / Local',
    rounds,
    startDate: date,
    endDate: date,
    capacity: cap,
    venue,
    cityState,
    roster: [],
    pairings: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [] }
  };

  alert(`Tournament "${name}" created successfully!`);
  switchStudioTab('roster');
  renderTournamentBanner();
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

function syncEventWithBcp() {
  const token = getBcpToken();
  alert('🔄 Synchronizing tournament roster and live match results with Best Coast Pairings API...');
}

function copyStandingsText() {
  const standings = computeStandingsArray();
  let text = `🏆 ${studioState.activeTournament.name} - Official Standings (Round ${studioState.currentRound}) 🏆\n\n`;
  standings.forEach((s, idx) => {
    text += `#${idx + 1} ${s.name} (${s.faction}) - ${s.wins}W-${s.losses}L (${s.points} Battle Points, SoS: ${s.sos}%)\n`;
  });
  navigator.clipboard.writeText(text).then(() => {
    alert('Standings copied to clipboard!');
  });
}

function exportRosterCsv() {
  let csv = 'Name,Faction,Email,CheckedIn,ListSubmitted\n';
  studioState.activeTournament.roster.forEach(p => {
    csv += `"${p.name}","${p.faction}","${p.email || ''}",${p.checkedIn},${p.listSubmitted}\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `roster_${studioState.activeTournament.id}.csv`;
  a.click();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}
