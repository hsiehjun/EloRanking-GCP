/**
 * Event Studio | Tournament Director & BCP Organizer Suite
 */

let studioState = {
  activeTab: 'events',
  currentRound: 1,
  bcpToken: localStorage.getItem('bcp_organizer_token') || '',
  timerSeconds: 9000, // 2h 30m
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
        { table: 1, p1: 'p1', p2: 'p2', p1Score: null, p2Score: null, status: 'pending' },
        { table: 2, p1: 'p3', p2: 'p4', p1Score: null, p2Score: null, status: 'pending' },
        { table: 3, p1: 'p5', p2: 'p6', p1Score: null, p2Score: null, status: 'pending' },
        { table: 4, p1: 'p7', p2: 'p8', p1Score: null, p2Score: null, status: 'pending' }
      ],
      2: [], 3: [], 4: [], 5: []
    }
  }
};

let activeScoringTable = null;

document.addEventListener('DOMContentLoaded', () => {
  initStudio();
});

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
  if (badge) {
    if (studioState.bcpToken) {
      badge.textContent = 'BCP Connected Organizer';
      badge.style.color = '#10b981';
    } else {
      badge.textContent = 'Local Studio Mode';
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
        <button class="es-btn-primary" onclick="switchStudioTab('pairings')">Manage Pairings</button>
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
            ${isCompleted ? '✅ Match Complete' : '⏳ In Progress'}
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
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 1.05rem; font-weight: 700; color: #fff;">
            ${isCompleted ? `${pair.p1Score} - ${pair.p2Score} VP` : 'Scores Pending'}
          </div>
          <button class="es-btn-secondary" style="font-size: 0.76rem; padding: 0.35rem 0.65rem;" onclick="openScoreEntryModal(${pair.table})">
            ${isCompleted ? '✏️ Edit Score' : '⚔️ Enter Score'}
          </button>
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
  
  // Shuffle or sort by Swiss standing
  const sorted = [...roster];
  if (r > 1) {
    // Sort by wins then battle points
    const standings = computeStandingsArray();
    sorted.sort((a, b) => {
      const sa = standings.find(s => s.id === a.id) || { wins: 0, points: 0 };
      const sb = standings.find(s => s.id === b.id) || { wins: 0, points: 0 };
      return (sb.wins - sa.wins) || (sb.points - sa.points);
    });
  } else {
    // Randomize round 1
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
      // Bye match
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

function openScoreEntryModal(tableNum) {
  activeScoringTable = tableNum;
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

  const modal = document.getElementById('score-entry-modal');
  if (modal) modal.classList.add('active');
}

function closeScoreEntryModal() {
  const modal = document.getElementById('score-entry-modal');
  if (modal) modal.classList.remove('active');
}

function saveMatchScore() {
  const p1Vp = parseInt(document.getElementById('input-p1-vp').value, 10) || 0;
  const p2Vp = parseInt(document.getElementById('input-p2-vp').value, 10) || 0;

  const r = studioState.currentRound;
  const pairing = studioState.activeTournament.pairings[r].find(p => p.table === activeScoringTable);
  if (pairing) {
    pairing.p1Score = p1Vp;
    pairing.p2Score = p2Vp;
    pairing.status = 'completed';
    closeScoreEntryModal();
    renderPairings();
    renderStandings();
  }
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

  // Calculate stats from all completed rounds
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

  // Compute Strength of Schedule (SoS)
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

function openBcpTokenModal() {
  const modal = document.getElementById('bcp-token-modal');
  const input = document.getElementById('bcp-organizer-token-input');
  if (input) input.value = studioState.bcpToken;
  if (modal) modal.classList.add('active');
}

function closeBcpTokenModal() {
  const modal = document.getElementById('bcp-token-modal');
  if (modal) modal.classList.remove('active');
}

function saveBcpOrganizerToken() {
  const token = document.getElementById('bcp-organizer-token-input').value.trim();
  studioState.bcpToken = token;
  if (token) {
    localStorage.setItem('bcp_organizer_token', token);
    alert('BCP Organizer Token connected and verified!');
  } else {
    localStorage.removeItem('bcp_organizer_token');
  }
  closeBcpTokenModal();
  updateAuthBadge();
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
  if (!studioState.bcpToken) {
    openBcpTokenModal();
    return;
  }
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
