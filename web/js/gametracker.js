/**
 * Warhammer 40,000 11th Edition Game Tracker Engine (GDM Matched Play Spec)
 */

const SECONDARY_DECK_11TH = [
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

let matchState = {
  currentRound: 1,
  activePlayer: 1, // 1 or 2
  setup: {
    pack: '11th Edition Core / Armageddon (2026)',
    primaryMission: 'Take & Hold',
    missionRule: 'Swift Action',
    deployment: 'Search & Destroy',
    p1Name: 'Player 1',
    p1Faction: 'Necrons (Awakened Dynasty)',
    p2Name: 'Player 2',
    p2Faction: 'Space Marines (Gladius Task Force)',
    p1Paint: 10,
    p2Paint: 10
  },
  players: {
    1: {
      cp: 1,
      rounds: {
        1: { primary: 0, secondaries: [] },
        2: { primary: 0, secondaries: [] },
        3: { primary: 0, secondaries: [] },
        4: { primary: 0, secondaries: [] },
        5: { primary: 0, secondaries: [] }
      }
    },
    2: {
      cp: 1,
      rounds: {
        1: { primary: 0, secondaries: [] },
        2: { primary: 0, secondaries: [] },
        3: { primary: 0, secondaries: [] },
        4: { primary: 0, secondaries: [] },
        5: { primary: 0, secondaries: [] }
      }
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const eventId = urlParams.get('event_id');
  const table = urlParams.get('table');
  const p1 = urlParams.get('p1');
  const p2 = urlParams.get('p2');
  const f1 = urlParams.get('f1');
  const f2 = urlParams.get('f2');

  if (p1) matchState.setup.p1Name = decodeURIComponent(p1);
  if (p2) matchState.setup.p2Name = decodeURIComponent(p2);
  if (f1) matchState.setup.p1Faction = decodeURIComponent(f1);
  if (f2) matchState.setup.p2Faction = decodeURIComponent(f2);

  loadSavedMatchesCount();
  renderMatch();
});

function loadSavedMatchesCount() {
  const saved = JSON.parse(localStorage.getItem('gt_saved_matches') || '[]');
  const countSpan = document.getElementById('gt-saved-count');
  if (countSpan) countSpan.textContent = saved.length;
}

function showHistoryView() {
  const landingView = document.getElementById('gt-view-landing');
  const trackerView = document.getElementById('gt-view-tracker');
  if (landingView.style.display === 'none') {
    landingView.style.display = 'block';
    trackerView.style.display = 'none';
    renderHistoryCards();
  } else {
    landingView.style.display = 'none';
    trackerView.style.display = 'block';
  }
}

function renderHistoryCards() {
  const container = document.getElementById('gt-history-list');
  const countLabel = document.getElementById('gt-history-count-label');
  const saved = JSON.parse(localStorage.getItem('gt_saved_matches') || '[]');
  
  if (countLabel) countLabel.textContent = `${saved.length} matches recorded`;
  if (!container) return;

  if (saved.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 2.5rem; text-align: center; color: var(--gt-muted);">
        <div>No saved match history found.</div>
        <button class="gt-btn-sm gt-btn-primary" style="margin-top: 0.75rem;" onclick="startNewGameFromLanding()">Start First Match</button>
      </div>
    `;
    return;
  }

  container.innerHTML = saved.map((m, idx) => `
    <div class="gt-history-card">
      <div class="gt-history-top">
        <span>📅 ${m.date || 'Recent'}</span>
        <span>${escapeHtml(m.mission || '11th Ed Matched Play')}</span>
      </div>
      <div class="gt-history-matchup">
        <div>
          <div class="gt-history-p">${escapeHtml(m.p1Name)} <span style="font-size:0.75rem; color:var(--gt-muted);">(${escapeHtml(m.p1Faction)})</span></div>
          <div class="gt-history-p" style="margin-top:0.25rem;">${escapeHtml(m.p2Name)} <span style="font-size:0.75rem; color:var(--gt-muted);">(${escapeHtml(m.p2Faction)})</span></div>
        </div>
        <div class="gt-history-score">${m.p1Score} - ${m.p2Score}</div>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--gt-panel-border); padding-top: 0.5rem; margin-top: 0.25rem;">
        <span style="font-size:0.75rem; color:var(--gt-green); font-weight:700;">Winner: ${escapeHtml(m.winner)}</span>
        <button class="gt-btn-sm gt-btn-ghost" style="padding: 0.25rem 0.5rem; font-size:0.72rem;" onclick="deleteSavedMatch(${idx})">Delete</button>
      </div>
    </div>
  `).join('');
}

function deleteSavedMatch(idx) {
  const saved = JSON.parse(localStorage.getItem('gt_saved_matches') || '[]');
  saved.splice(idx, 1);
  localStorage.setItem('gt_saved_matches', JSON.stringify(saved));
  loadSavedMatchesCount();
  renderHistoryCards();
}

function startNewGameFromLanding() {
  document.getElementById('gt-view-landing').style.display = 'none';
  document.getElementById('gt-view-tracker').style.display = 'block';
  openMatchSetupModal();
}

function renderMatch() {
  renderRoundTabs();
  renderScorecardHeaders();
  renderActiveDeck();
  renderMatrixTable();
}

function renderRoundTabs() {
  for (let r = 1; r <= 5; r++) {
    const btn = document.getElementById(`gt-rd-${r}`);
    if (btn) {
      if (r === matchState.currentRound) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  }
}

function renderScorecardHeaders() {
  const s = matchState.setup;
  const p1 = matchState.players[1];
  const p2 = matchState.players[2];

  // Names & Factions
  document.getElementById('p1-name-display').textContent = s.p1Name;
  document.getElementById('p1-faction-display').textContent = s.p1Faction;
  document.getElementById('p1-cp-val').textContent = p1.cp;

  document.getElementById('p2-name-display').textContent = s.p2Name;
  document.getElementById('p2-faction-display').textContent = s.p2Faction;
  document.getElementById('p2-cp-val').textContent = p2.cp;

  // Turn Buttons
  const btnP1 = document.getElementById('p1-turn-btn');
  const btnP2 = document.getElementById('p2-turn-btn');
  if (matchState.activePlayer === 1) {
    btnP1.classList.add('active');
    btnP2.classList.remove('active');
  } else {
    btnP1.classList.remove('active');
    btnP2.classList.add('active');
  }

  // Mission Info
  document.getElementById('gt-pack-label').textContent = s.pack.toUpperCase();
  document.getElementById('gt-primary-mission-display').textContent = s.primaryMission;
  document.getElementById('gt-rule-display').textContent = `Rule: ${s.missionRule}`;
  document.getElementById('gt-dep-display').textContent = `Deployment: ${s.deployment}`;

  // Calculate & Display Live Scores
  const p1Scores = calculatePlayerVp(1);
  const p2Scores = calculatePlayerVp(2);

  document.getElementById('p1-total-score').textContent = p1Scores.totalVp;
  document.getElementById('p1-pri-breakdown').textContent = `${p1Scores.primaryVp}/50`;
  document.getElementById('p1-sec-breakdown').textContent = `${p1Scores.secondaryVp}/40`;
  document.getElementById('p1-paint-breakdown').textContent = `+${s.p1Paint}`;

  document.getElementById('p2-total-score').textContent = p2Scores.totalVp;
  document.getElementById('p2-pri-breakdown').textContent = `${p2Scores.primaryVp}/50`;
  document.getElementById('p2-sec-breakdown').textContent = `${p2Scores.secondaryVp}/40`;
  document.getElementById('p2-paint-breakdown').textContent = `+${s.p2Paint}`;
}

function calculatePlayerVp(pid) {
  const p = matchState.players[pid];
  let priSum = 0;
  let secSum = 0;

  for (let r = 1; r <= 5; r++) {
    const rd = p.rounds[r];
    priSum += (rd.primary || 0);
    (rd.secondaries || []).forEach(sec => {
      if (sec.status === 'achieved') secSum += (sec.vp || 0);
    });
  }

  const primaryVp = Math.min(50, priSum);
  const secondaryVp = Math.min(40, secSum);
  const paint = (pid === 1 ? matchState.setup.p1Paint : matchState.setup.p2Paint) || 10;
  const totalVp = Math.min(100, primaryVp + secondaryVp + paint);

  return { primaryVp, secondaryVp, paint, totalVp };
}

function renderActiveDeck() {
  const r = matchState.currentRound;
  const pid = matchState.activePlayer;
  const pName = pid === 1 ? matchState.setup.p1Name : matchState.setup.p2Name;

  document.getElementById('active-turn-number').textContent = pid;
  document.getElementById('active-round-number').textContent = r;
  document.getElementById('active-turn-player-header').textContent = `${pName}'s Turn`;

  // Render Primary Buttons
  renderPrimaryButtons(pid, r);

  // Render Secondary Slots
  renderSecondarySlots(pid, r);
}

function renderPrimaryButtons(pid, roundNum) {
  const container = document.getElementById('primary-scoring-buttons');
  const badge = document.getElementById('active-round-pri-vp');
  if (!container) return;

  const currentScore = matchState.players[pid].rounds[roundNum].primary || 0;
  if (badge) badge.textContent = `+${currentScore} VP`;

  const increments = [
    { label: 'Hold None (0 VP)', vp: 0 },
    { label: 'Hold 1 (4 VP)', vp: 4 },
    { label: 'Hold 2+ (8 VP)', vp: 8 },
    { label: 'Hold More (12 VP)', vp: 12 },
    { label: 'Max / Bonus (15 VP)', vp: 15 }
  ];

  container.innerHTML = increments.map(inc => `
    <button class="gt-pri-btn ${currentScore === inc.vp ? 'selected' : ''}" onclick="setPrimaryRoundScore(${pid}, ${roundNum}, ${inc.vp})">
      ${inc.label}
    </button>
  `).join('');
}

function renderSecondarySlots(pid, roundNum) {
  const container = document.getElementById('secondary-slots-deck');
  const badge = document.getElementById('active-round-sec-vp');
  if (!container) return;

  const secondaries = matchState.players[pid].rounds[roundNum].secondaries || [];
  let secRoundTotal = 0;
  secondaries.forEach(s => {
    if (s.status === 'achieved') secRoundTotal += (s.vp || 0);
  });
  if (badge) badge.textContent = `+${secRoundTotal} VP`;

  if (secondaries.length === 0) {
    container.innerHTML = `
      <div style="font-size: 0.8rem; color: var(--gt-muted); text-align: center; padding: 1.25rem 0; background: rgba(0,0,0,0.2); border-radius: 8px;">
        No active tactical secondary cards drawn for Round ${roundNum}.
      </div>
    `;
    return;
  }

  container.innerHTML = secondaries.map((sec, idx) => `
    <div class="gt-sec-card-box">
      <div class="gt-sec-top">
        <span class="gt-sec-title">🎴 ${escapeHtml(sec.name)}</span>
        <span class="gt-vp-tag">${sec.status === 'achieved' ? `+${sec.vp} VP` : sec.status === 'discard' ? 'Discarded (+1 CP)' : 'Active'}</span>
      </div>
      <div class="gt-sec-rules">${escapeHtml(sec.desc)}</div>
      <div class="gt-sec-btn-row">
        <button class="gt-sec-action-chip ${sec.status === 'achieved' && sec.vp >= 4 ? 'achieved' : ''}" onclick="setSecondaryCardScore(${pid}, ${roundNum}, ${idx}, 'achieved', ${sec.maxVp})">
          ✅ Score Max (+${sec.maxVp} VP)
        </button>
        <button class="gt-sec-action-chip ${sec.status === 'achieved' && sec.vp === 2 ? 'achieved' : ''}" onclick="setSecondaryCardScore(${pid}, ${roundNum}, ${idx}, 'achieved', 2)">
          🟡 Score Partial (+2 VP)
        </button>
        <button class="gt-sec-action-chip ${sec.status === 'discard' ? 'discard' : ''}" onclick="discardCardForCp(${pid}, ${roundNum}, ${idx})">
          ♻️ Discard for 1 CP
        </button>
        <button class="gt-sec-action-chip" style="color:var(--gt-muted);" onclick="removeSecondaryCard(${pid}, ${roundNum}, ${idx})">
          ✕ Remove
        </button>
      </div>
    </div>
  `).join('');
}

function setPrimaryRoundScore(pid, roundNum, vp) {
  matchState.players[pid].rounds[roundNum].primary = vp;
  renderMatch();
}

function setSecondaryCardScore(pid, roundNum, idx, status, vp) {
  const card = matchState.players[pid].rounds[roundNum].secondaries[idx];
  if (!card) return;
  card.status = status;
  card.vp = vp;
  renderMatch();
}

function discardCardForCp(pid, roundNum, idx) {
  const card = matchState.players[pid].rounds[roundNum].secondaries[idx];
  if (!card) return;
  card.status = 'discard';
  card.vp = 0;
  matchState.players[pid].cp += 1;
  renderMatch();
}

function removeSecondaryCard(pid, roundNum, idx) {
  matchState.players[pid].rounds[roundNum].secondaries.splice(idx, 1);
  renderMatch();
}

function openDrawCardModal() {
  const modal = document.getElementById('gt-modal-draw');
  const deckContainer = document.getElementById('gt-picker-deck-list');
  if (!modal || !deckContainer) return;

  deckContainer.innerHTML = SECONDARY_DECK_11TH.map(card => `
    <div class="gt-deck-card-option" onclick="drawCardToActivePlayer('${card.id}')">
      <b>🎴 ${escapeHtml(card.name)}</b>
      <p>${escapeHtml(card.desc)}</p>
    </div>
  `).join('');

  modal.classList.add('active');
}

function closeDrawCardModal() {
  const modal = document.getElementById('gt-modal-draw');
  if (modal) modal.classList.remove('active');
}

function drawCardToActivePlayer(cardId) {
  const cardDef = SECONDARY_DECK_11TH.find(c => c.id === cardId);
  if (!cardDef) return;

  const currentSecs = matchState.players[matchState.activePlayer].rounds[matchState.currentRound].secondaries;
  if (currentSecs.length >= 3) {
    alert('Maximum 3 secondary cards allowed per turn.');
    return;
  }

  currentSecs.push({
    id: cardDef.id,
    name: cardDef.name,
    desc: cardDef.desc,
    maxVp: cardDef.maxVp,
    status: 'active',
    vp: 0
  });

  closeDrawCardModal();
  renderMatch();
}

function changeCp(pid, delta) {
  matchState.players[pid].cp = Math.max(0, matchState.players[pid].cp + delta);
  document.getElementById(`p${pid}-cp-val`).textContent = matchState.players[pid].cp;
}

function switchActiveRound(rd) {
  matchState.currentRound = rd;
  renderMatch();
}

function setActivePlayerTurn(pid) {
  matchState.activePlayer = pid;
  renderMatch();
}

function advancePlayerTurn() {
  if (matchState.activePlayer === 1) {
    // Switch to Player 2 Turn in same round
    matchState.activePlayer = 2;
    matchState.players[2].cp += 1; // +1 CP at start of command phase
  } else {
    // Player 2 finished turn -> advance round
    if (matchState.currentRound < 5) {
      matchState.currentRound += 1;
      matchState.activePlayer = 1;
      matchState.players[1].cp += 1; // +1 CP for P1 command phase
    } else {
      openFinishModal();
      return;
    }
  }
  renderMatch();
}

function resetActiveRoundScore() {
  if (confirm(`Reset current turn scores for Round ${matchState.currentRound}?`)) {
    matchState.players[matchState.activePlayer].rounds[matchState.currentRound] = { primary: 0, secondaries: [] };
    renderMatch();
  }
}

function renderMatrixTable() {
  const tbody = document.getElementById('gt-matrix-rows');
  if (!tbody) return;

  const p1 = matchState.players[1];
  const p2 = matchState.players[2];
  const s1 = calculatePlayerVp(1);
  const s2 = calculatePlayerVp(2);

  function getSum(p, r) {
    let s = p.rounds[r].primary || 0;
    (p.rounds[r].secondaries || []).forEach(x => { if (x.status === 'achieved') s += x.vp; });
    return s;
  }

  tbody.innerHTML = `
    <tr>
      <td><b>${escapeHtml(matchState.setup.p1Name)}</b> <span style="font-size:0.75rem; color:var(--gt-muted);">(${escapeHtml(matchState.setup.p1Faction)})</span></td>
      <td>${getSum(p1, 1)} VP</td>
      <td>${getSum(p1, 2)} VP</td>
      <td>${getSum(p1, 3)} VP</td>
      <td>${getSum(p1, 4)} VP</td>
      <td>${getSum(p1, 5)} VP</td>
      <td><b>${s1.primaryVp}</b></td>
      <td><b>${s1.secondaryVp}</b></td>
      <td>+${s1.paint}</td>
      <td><b style="color:var(--gt-accent); font-size:1.1rem;">${s1.totalVp} VP</b></td>
    </tr>
    <tr>
      <td><b>${escapeHtml(matchState.setup.p2Name)}</b> <span style="font-size:0.75rem; color:var(--gt-muted);">(${escapeHtml(matchState.setup.p2Faction)})</span></td>
      <td>${getSum(p2, 1)} VP</td>
      <td>${getSum(p2, 2)} VP</td>
      <td>${getSum(p2, 3)} VP</td>
      <td>${getSum(p2, 4)} VP</td>
      <td>${getSum(p2, 5)} VP</td>
      <td><b>${s2.primaryVp}</b></td>
      <td><b>${s2.secondaryVp}</b></td>
      <td>+${s2.paint}</td>
      <td><b style="color:var(--gt-amber); font-size:1.1rem;">${s2.totalVp} VP</b></td>
    </tr>
  `;
}

function openMatchSetupModal() {
  const modal = document.getElementById('gt-modal-setup');
  if (modal) modal.classList.add('active');
}

function closeMatchSetupModal() {
  const modal = document.getElementById('gt-modal-setup');
  if (modal) modal.classList.remove('active');
}

function applyMatchSetup() {
  const pack = document.getElementById('modal-setup-pack').selectedOptions[0].text;
  const pri = document.getElementById('modal-setup-primary').selectedOptions[0].text.split(' (')[0];
  const rule = document.getElementById('modal-setup-rule').selectedOptions[0].text.split(' (')[0];
  const dep = document.getElementById('modal-setup-deployment').selectedOptions[0].text.split(' (')[0];

  const p1Name = document.getElementById('modal-setup-p1-name').value.trim() || 'Player 1';
  const p1Faction = document.getElementById('modal-setup-p1-faction').value.trim() || 'Faction';
  const p2Name = document.getElementById('modal-setup-p2-name').value.trim() || 'Player 2';
  const p2Faction = document.getElementById('modal-setup-p2-faction').value.trim() || 'Faction';

  matchState.setup.pack = pack;
  matchState.setup.primaryMission = pri;
  matchState.setup.missionRule = rule;
  matchState.setup.deployment = dep;
  matchState.setup.p1Name = p1Name;
  matchState.setup.p1Faction = p1Faction;
  matchState.setup.p2Name = p2Name;
  matchState.setup.p2Faction = p2Faction;

  closeMatchSetupModal();
  renderMatch();
}

function openFinishModal() {
  const s1 = calculatePlayerVp(1);
  const s2 = calculatePlayerVp(2);
  const diff = Math.abs(s1.totalVp - s2.totalVp);

  const winner = s1.totalVp > s2.totalVp ? matchState.setup.p1Name : s2.totalVp > s1.totalVp ? matchState.setup.p2Name : 'Tied Match';
  const icon = s1.totalVp === s2.totalVp ? '⚖️' : '👑';

  document.getElementById('finish-outcome-icon').textContent = icon;
  document.getElementById('finish-winner-label').textContent = s1.totalVp === s2.totalVp ? 'Match Tied!' : `${winner} Victorious!`;
  document.getElementById('finish-score-label').textContent = `${s1.totalVp} - ${s2.totalVp} VP`;
  document.getElementById('finish-diff-label').textContent = `±${diff} VP Differential`;

  const modal = document.getElementById('gt-modal-finish');
  if (modal) modal.classList.add('active');
}

function closeFinishModal() {
  const modal = document.getElementById('gt-modal-finish');
  if (modal) modal.classList.remove('active');
}

function copyScoreSummary() {
  const s1 = calculatePlayerVp(1);
  const s2 = calculatePlayerVp(2);
  const diff = Math.abs(s1.totalVp - s2.totalVp);

  const text = `⚔️ WARHAMMER 40K MATCH RESULT ⚔️\n\n` +
    `Mission: ${matchState.setup.primaryMission} (${matchState.setup.deployment}) • ${matchState.setup.missionRule}\n\n` +
    `🏆 ${matchState.setup.p1Name} (${matchState.setup.p1Faction}): ${s1.totalVp} VP\n` +
    `   [Primary: ${s1.primaryVp}/50 | Secondary: ${s1.secondaryVp}/40 | Paint: +${s1.paint}]\n\n` +
    `🛡️ ${matchState.setup.p2Name} (${matchState.setup.p2Faction}): ${s2.totalVp} VP\n` +
    `   [Primary: ${s2.primaryVp}/50 | Secondary: ${s2.secondaryVp}/40 | Paint: +${s2.paint}]\n\n` +
    `Differential: ±${diff} VP | Tracked live on Game Tracker`;

  navigator.clipboard.writeText(text).then(() => {
    alert('Official Match Summary copied to clipboard!');
  });
}

function saveAndStartNewMatch() {
  const s1 = calculatePlayerVp(1);
  const s2 = calculatePlayerVp(2);
  const winner = s1.totalVp > s2.totalVp ? matchState.setup.p1Name : s2.totalVp > s1.totalVp ? matchState.setup.p2Name : 'Draw';

  const record = {
    date: new Date().toISOString().split('T')[0],
    mission: matchState.setup.primaryMission,
    p1Name: matchState.setup.p1Name,
    p1Faction: matchState.setup.p1Faction,
    p1Score: s1.totalVp,
    p2Name: matchState.setup.p2Name,
    p2Faction: matchState.setup.p2Faction,
    p2Score: s2.totalVp,
    winner
  };

  const saved = JSON.parse(localStorage.getItem('gt_saved_matches') || '[]');
  saved.unshift(record);
  localStorage.setItem('gt_saved_matches', JSON.stringify(saved.slice(0, 50)));

  closeFinishModal();
  location.reload();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}
