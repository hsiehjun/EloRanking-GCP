/**
 * Warhammer 40,000 11th Edition Game Tracker Engine
 */

const SECONDARY_DECK_11TH = [
  { id: 'assassination', name: 'Assassination', desc: 'Score 4 VP for each enemy CHARACTER unit destroyed (or 5 VP if enemy WARLORD).', maxVp: 20 },
  { id: 'bring_it_down', name: 'Bring It Down', desc: 'Score 2-5 VP for each enemy MONSTER or VEHICLE destroyed based on starting wounds.', maxVp: 20 },
  { id: 'cleanse', name: 'Cleanse', desc: 'Perform Cleanse action on 1+ objective markers not in your deployment zone (2 VP for 1, 4 VP for 2+).', maxVp: 20 },
  { id: 'deploy_homers', name: 'Deploy Teleport Homers', desc: 'Perform action in No Man\'s Land (2 VP) or enemy deployment zone (4 VP).', maxVp: 20 },
  { id: 'behind_lines', name: 'Behind Enemy Lines', desc: 'Score 2 VP if 1 unit is wholly in enemy deployment zone, or 4 VP if 2+ units.', maxVp: 20 },
  { id: 'engage_fronts', name: 'Engage on All Fronts', desc: 'Score 2 VP if units in 3 table quarters, or 4 VP if in all 4 quarters.', maxVp: 20 },
  { id: 'storm_hostile', name: 'Storm Hostile Objective', desc: 'Score 4 VP if you control an objective marker controlled by opponent at start of turn.', maxVp: 20 },
  { id: 'area_denial', name: 'Area Denial', desc: 'Score 2.5-5 VP for controlling center table area with no enemy units near center.', maxVp: 20 },
  { id: 'no_prisoners', name: 'No Prisoners', desc: 'Score 2 VP for every 20 enemy starting wounds destroyed in this turn.', maxVp: 20 },
  { id: 'sabotage', name: 'Sabotage', desc: 'Perform sabotage action on battlefield terrain feature outside deployment zone (4 VP).', maxVp: 20 },
  { id: 'establish_locus', name: 'Establish Locus', desc: 'Action performed on center objective marker or enemy deployment marker (4 VP).', maxVp: 20 },
  { id: 'secure_nml', name: 'Secure No Man\'s Land', desc: 'Score 2 VP if you control 1 No Man\'s Land marker, or 5 VP if 2+ markers.', maxVp: 20 },
  { id: 'extend_lines', name: 'Extend Battle Lines', desc: 'Score 2-4 VP for controlling both your home objective and No Man\'s Land objectives.', maxVp: 20 },
  { id: 'marked_death', name: 'Marked for Death', desc: 'Opponent picks 3 units. Score 5 VP for destroying each designated unit.', maxVp: 15 }
];

let gameState = {
  currentRound: 1,
  activeTurnPlayer: 1,
  matchSetup: {
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
        1: { primary: 0, secondaries: [], total: 0 },
        2: { primary: 0, secondaries: [], total: 0 },
        3: { primary: 0, secondaries: [], total: 0 },
        4: { primary: 0, secondaries: [], total: 0 },
        5: { primary: 0, secondaries: [], total: 0 }
      }
    },
    2: {
      cp: 1,
      rounds: {
        1: { primary: 0, secondaries: [], total: 0 },
        2: { primary: 0, secondaries: [], total: 0 },
        3: { primary: 0, secondaries: [], total: 0 },
        4: { primary: 0, secondaries: [], total: 0 },
        5: { primary: 0, secondaries: [], total: 0 }
      }
    }
  }
};

let activeDrawingPlayer = 1;

document.addEventListener('DOMContentLoaded', () => {
  renderAll();
});

function renderAll() {
  renderHeader();
  renderScoreboards();
  renderRoundWorkspace();
  renderSummaryMatrix();
}

function renderHeader() {
  for (let r = 1; r <= 5; r++) {
    const btn = document.getElementById(`btn-rd-${r}`);
    if (btn) {
      if (r === gameState.currentRound) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  }
  const rdNum = document.getElementById('current-round-number');
  if (rdNum) rdNum.textContent = gameState.currentRound;

  // Turn switcher
  const btnP1 = document.getElementById('btn-turn-p1');
  const btnP2 = document.getElementById('btn-turn-p2');
  if (btnP1 && btnP2) {
    if (gameState.activeTurnPlayer === 1) {
      btnP1.classList.add('active');
      btnP2.classList.remove('active');
    } else {
      btnP1.classList.remove('active');
      btnP2.classList.add('active');
    }
  }
}

function renderScoreboards() {
  const p1 = gameState.players[1];
  const p2 = gameState.players[2];
  const setup = gameState.matchSetup;

  // Player 1 details
  document.getElementById('p1-display-name').textContent = setup.p1Name;
  document.getElementById('p1-display-faction').textContent = setup.p1Faction;
  document.getElementById('p1-cp-count').textContent = p1.cp;
  document.getElementById('p1-col-name').textContent = setup.p1Name;

  // Player 2 details
  document.getElementById('p2-display-name').textContent = setup.p2Name;
  document.getElementById('p2-display-faction').textContent = setup.p2Faction;
  document.getElementById('p2-cp-count').textContent = p2.cp;
  document.getElementById('p2-col-name').textContent = setup.p2Name;

  // Match Info
  document.getElementById('primary-mission-name').textContent = setup.primaryMission;
  document.getElementById('mission-rule-name').textContent = `Rule: ${setup.missionRule}`;
  document.getElementById('deployment-name').textContent = `Deployment: ${setup.deployment}`;

  // Calculate Scores
  const p1Scores = calculatePlayerTotals(1);
  const p2Scores = calculatePlayerTotals(2);

  document.getElementById('p1-total-vp').textContent = p1Scores.totalVp;
  document.getElementById('p1-pri-score').textContent = `${p1Scores.primaryVp} / 50`;
  document.getElementById('p1-sec-score').textContent = `${p1Scores.secondaryVp} / 40`;
  document.getElementById('p1-paint-score').textContent = `+${setup.p1Paint}`;

  document.getElementById('p2-total-vp').textContent = p2Scores.totalVp;
  document.getElementById('p2-pri-score').textContent = `${p2Scores.primaryVp} / 50`;
  document.getElementById('p2-sec-score').textContent = `${p2Scores.secondaryVp} / 40`;
  document.getElementById('p2-paint-score').textContent = `+${setup.p2Paint}`;
}

function calculatePlayerTotals(pid) {
  const p = gameState.players[pid];
  let priSum = 0;
  let secSum = 0;

  for (let r = 1; r <= 5; r++) {
    const rd = p.rounds[r];
    priSum += (rd.primary || 0);
    if (rd.secondaries) {
      rd.secondaries.forEach(s => {
        if (s.status === 'achieved') secSum += (s.vp || 0);
      });
    }
  }

  const cappedPri = Math.min(50, priSum);
  const cappedSec = Math.min(40, secSum);
  const paint = (pid === 1 ? gameState.matchSetup.p1Paint : gameState.matchSetup.p2Paint) || 10;
  const totalVp = Math.min(100, cappedPri + cappedSec + paint);

  return { primaryVp: cappedPri, secondaryVp: cappedSec, paint, totalVp };
}

function renderRoundWorkspace() {
  const r = gameState.currentRound;

  // Render Primary controls for P1 and P2
  renderPrimaryControls(1, r);
  renderPrimaryControls(2, r);

  // Render Secondary Slots for P1 and P2
  renderSecondarySlots(1, r);
  renderSecondarySlots(2, r);
}

function renderPrimaryControls(pid, roundNum) {
  const container = document.getElementById(`p${pid}-primary-controls`);
  const badge = document.getElementById(`p${pid}-rd-pri-badge`);
  if (!container) return;

  const currentScore = gameState.players[pid].rounds[roundNum].primary || 0;
  if (badge) badge.textContent = `+${currentScore} VP`;

  // Standard 11th Edition primary increments (0, 4, 8, 12, 15 VP)
  const options = [
    { label: 'Hold None (0 VP)', vp: 0 },
    { label: 'Hold 1 (4 VP)', vp: 4 },
    { label: 'Hold 2+ (8 VP)', vp: 8 },
    { label: 'Hold More (12 VP)', vp: 12 },
    { label: 'Max / Bonus (15 VP)', vp: 15 }
  ];

  container.innerHTML = `
    <div class="gt-obj-btn-grid">
      ${options.map(opt => `
        <button class="gt-obj-btn ${currentScore === opt.vp ? 'selected' : ''}" onclick="setPrimaryScore(${pid}, ${roundNum}, ${opt.vp})">
          ${opt.label}
        </button>
      `).join('')}
    </div>
  `;
}

function renderSecondarySlots(pid, roundNum) {
  const container = document.getElementById(`p${pid}-secondary-slots`);
  const badge = document.getElementById(`p${pid}-rd-sec-badge`);
  if (!container) return;

  const secondaries = gameState.players[pid].rounds[roundNum].secondaries || [];
  let rdSecTotal = 0;
  secondaries.forEach(s => {
    if (s.status === 'achieved') rdSecTotal += (s.vp || 0);
  });
  if (badge) badge.textContent = `+${rdSecTotal} VP`;

  if (secondaries.length === 0) {
    container.innerHTML = `<div style="font-size:0.78rem; color:var(--text-muted); text-align:center; padding: 0.75rem 0;">No active secondary cards drawn for Round ${roundNum}.</div>`;
    return;
  }

  container.innerHTML = secondaries.map((sec, idx) => `
    <div class="gt-sec-card">
      <div class="gt-sec-card-header">
        <span class="gt-sec-name">🎴 ${escapeHtml(sec.name)}</span>
        <span class="gt-vp-chip">${sec.status === 'achieved' ? `+${sec.vp} VP` : sec.status === 'discard' ? 'Discarded (+1 CP)' : 'Active'}</span>
      </div>
      <div class="gt-sec-desc">${escapeHtml(sec.desc)}</div>
      <div class="gt-sec-actions">
        <button class="gt-sec-act-btn ${sec.status === 'achieved' ? 'achieved' : ''}" onclick="setSecondaryStatus(${pid}, ${roundNum}, ${idx}, 'achieved', ${sec.maxVp >= 5 ? 5 : 4})">
          ✅ Achieved (+${sec.maxVp >= 5 ? 5 : 4} VP)
        </button>
        <button class="gt-sec-act-btn ${sec.status === 'achieved' ? 'achieved' : ''}" onclick="setSecondaryStatus(${pid}, ${roundNum}, ${idx}, 'achieved', 2)">
          Partial (+2 VP)
        </button>
        <button class="gt-sec-act-btn ${sec.status === 'discard' ? 'discard' : ''}" onclick="discardSecondaryForCp(${pid}, ${roundNum}, ${idx})">
          ♻️ Discard (+1 CP)
        </button>
        <button class="gt-sec-act-btn" style="color:var(--text-muted);" onclick="removeSecondary(${pid}, ${roundNum}, ${idx})">
          ✕
        </button>
      </div>
    </div>
  `).join('');
}

function setPrimaryScore(pid, roundNum, vp) {
  gameState.players[pid].rounds[roundNum].primary = vp;
  renderAll();
}

function setSecondaryStatus(pid, roundNum, idx, status, vp) {
  const card = gameState.players[pid].rounds[roundNum].secondaries[idx];
  if (!card) return;
  card.status = status;
  card.vp = vp;
  renderAll();
}

function discardSecondaryForCp(pid, roundNum, idx) {
  const card = gameState.players[pid].rounds[roundNum].secondaries[idx];
  if (!card) return;
  card.status = 'discard';
  card.vp = 0;
  gameState.players[pid].cp += 1;
  renderAll();
}

function removeSecondary(pid, roundNum, idx) {
  gameState.players[pid].rounds[roundNum].secondaries.splice(idx, 1);
  renderAll();
}

function drawSecondaryCard(pid) {
  activeDrawingPlayer = pid;
  const modal = document.getElementById('draw-card-modal');
  const list = document.getElementById('card-picker-list');
  if (!modal || !list) return;

  list.innerHTML = SECONDARY_DECK_11TH.map(card => `
    <div class="gt-picker-card" onclick="selectCardForPlayer('${card.id}')">
      <b>🎴 ${escapeHtml(card.name)}</b>
      <p>${escapeHtml(card.desc)}</p>
    </div>
  `).join('');

  modal.classList.add('active');
}

function selectCardForPlayer(cardId) {
  const cardDef = SECONDARY_DECK_11TH.find(c => c.id === cardId);
  if (!cardDef) return;

  const currentSecs = gameState.players[activeDrawingPlayer].rounds[gameState.currentRound].secondaries;
  if (currentSecs.length >= 3) {
    alert('Maximum 3 secondary cards per round.');
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
  renderAll();
}

function closeDrawCardModal() {
  const modal = document.getElementById('draw-card-modal');
  if (modal) modal.classList.remove('active');
}

function adjustCp(pid, delta) {
  gameState.players[pid].cp = Math.max(0, gameState.players[pid].cp + delta);
  document.getElementById(`p${pid}-cp-count`).textContent = gameState.players[pid].cp;
}

function switchRound(rd) {
  gameState.currentRound = rd;
  renderAll();
}

function setActiveTurn(pid) {
  gameState.activeTurnPlayer = pid;
  renderHeader();
}

function advanceToNextRound() {
  if (gameState.currentRound < 5) {
    gameState.currentRound += 1;
    // Auto-grant +1 CP per player turn start
    gameState.players[1].cp += 1;
    gameState.players[2].cp += 1;
    renderAll();
  } else {
    openEndGameModal();
  }
}

function resetCurrentRound() {
  if (confirm(`Reset all scored objectives for Round ${gameState.currentRound}?`)) {
    gameState.players[1].rounds[gameState.currentRound] = { primary: 0, secondaries: [] };
    gameState.players[2].rounds[gameState.currentRound] = { primary: 0, secondaries: [] };
    renderAll();
  }
}

function renderSummaryMatrix() {
  const tbody = document.getElementById('gt-matrix-body');
  if (!tbody) return;

  const p1 = gameState.players[1];
  const p2 = gameState.players[2];
  const s1 = calculatePlayerTotals(1);
  const s2 = calculatePlayerTotals(2);

  tbody.innerHTML = `
    <tr>
      <td><b>${escapeHtml(gameState.matchSetup.p1Name)}</b> <span style="font-size:0.74rem; color:var(--text-muted);">(${escapeHtml(gameState.matchSetup.p1Faction)})</span></td>
      <td>${p1.rounds[1].primary + getSecTotal(p1, 1)} VP</td>
      <td>${p1.rounds[2].primary + getSecTotal(p1, 2)} VP</td>
      <td>${p1.rounds[3].primary + getSecTotal(p1, 3)} VP</td>
      <td>${p1.rounds[4].primary + getSecTotal(p1, 4)} VP</td>
      <td>${p1.rounds[5].primary + getSecTotal(p1, 5)} VP</td>
      <td><b>${s1.primaryVp}</b></td>
      <td><b>${s1.secondaryVp}</b></td>
      <td>+${s1.paint}</td>
      <td><b style="color:var(--accent); font-size:1.1rem;">${s1.totalVp} VP</b></td>
    </tr>
    <tr>
      <td><b>${escapeHtml(gameState.matchSetup.p2Name)}</b> <span style="font-size:0.74rem; color:var(--text-muted);">(${escapeHtml(gameState.matchSetup.p2Faction)})</span></td>
      <td>${p2.rounds[1].primary + getSecTotal(p2, 1)} VP</td>
      <td>${p2.rounds[2].primary + getSecTotal(p2, 2)} VP</td>
      <td>${p2.rounds[3].primary + getSecTotal(p2, 3)} VP</td>
      <td>${p2.rounds[4].primary + getSecTotal(p2, 4)} VP</td>
      <td>${p2.rounds[5].primary + getSecTotal(p2, 5)} VP</td>
      <td><b>${s2.primaryVp}</b></td>
      <td><b>${s2.secondaryVp}</b></td>
      <td>+${s2.paint}</td>
      <td><b style="color:#f59e0b; font-size:1.1rem;">${s2.totalVp} VP</b></td>
    </tr>
  `;
}

function getSecTotal(player, roundNum) {
  let sum = 0;
  (player.rounds[roundNum].secondaries || []).forEach(s => {
    if (s.status === 'achieved') sum += (s.vp || 0);
  });
  return sum;
}

function openMissionSetupModal() {
  const modal = document.getElementById('mission-setup-modal');
  if (modal) modal.classList.add('active');
}

function closeMissionSetupModal() {
  const modal = document.getElementById('mission-setup-modal');
  if (modal) modal.classList.remove('active');
}

function saveMissionSetup() {
  const pack = document.getElementById('setup-mission-pack').selectedOptions[0].text;
  const pri = document.getElementById('setup-primary-mission').selectedOptions[0].text.split(' (')[0];
  const rule = document.getElementById('setup-mission-rule').selectedOptions[0].text.split(' (')[0];
  const dep = document.getElementById('setup-deployment').selectedOptions[0].text.split(' (')[0];

  const p1Name = document.getElementById('setup-p1-name').value.trim() || 'Player 1';
  const p1Faction = document.getElementById('setup-p1-faction').value.trim() || 'Faction';
  const p2Name = document.getElementById('setup-p2-name').value.trim() || 'Player 2';
  const p2Faction = document.getElementById('setup-p2-faction').value.trim() || 'Faction';

  gameState.matchSetup.pack = pack;
  gameState.matchSetup.primaryMission = pri;
  gameState.matchSetup.missionRule = rule;
  gameState.matchSetup.deployment = dep;
  gameState.matchSetup.p1Name = p1Name;
  gameState.matchSetup.p1Faction = p1Faction;
  gameState.matchSetup.p2Name = p2Name;
  gameState.matchSetup.p2Faction = p2Faction;

  closeMissionSetupModal();
  renderAll();
}

function openEndGameModal() {
  const s1 = calculatePlayerTotals(1);
  const s2 = calculatePlayerTotals(2);
  const diff = Math.abs(s1.totalVp - s2.totalVp);

  const winner = s1.totalVp > s2.totalVp ? gameState.matchSetup.p1Name : s2.totalVp > s1.totalVp ? gameState.matchSetup.p2Name : 'Draw Match!';
  const winnerIcon = s1.totalVp === s2.totalVp ? '⚖️' : '👑';

  document.getElementById('match-outcome-icon').textContent = winnerIcon;
  document.getElementById('match-winner-text').textContent = s1.totalVp === s2.totalVp ? 'Match Tied!' : `${winner} Victorious!`;
  document.getElementById('match-final-score').textContent = `${s1.totalVp} - ${s2.totalVp} VP`;
  document.getElementById('match-differential').textContent = `±${diff} VP Differential`;

  const modal = document.getElementById('finish-match-modal');
  if (modal) modal.classList.add('active');
}

function closeEndGameModal() {
  const modal = document.getElementById('finish-match-modal');
  if (modal) modal.classList.remove('active');
}

function copyScorecardSummary() {
  const s1 = calculatePlayerTotals(1);
  const s2 = calculatePlayerTotals(2);
  const text = `⚔️ WARHAMMER 40K 11TH ED MATCH RESULT ⚔️\n\n` +
    `Mission: ${gameState.matchSetup.primaryMission} (${gameState.matchSetup.deployment})\n` +
    `🏆 ${gameState.matchSetup.p1Name} (${gameState.matchSetup.p1Faction}): ${s1.totalVp} VP (Primary: ${s1.primaryVp}/50, Secondary: ${s1.secondaryVp}/40, Paint: +${s1.paint})\n` +
    `🛡️ ${gameState.matchSetup.p2Name} (${gameState.matchSetup.p2Faction}): ${s2.totalVp} VP (Primary: ${s2.primaryVp}/50, Secondary: ${s2.secondaryVp}/40, Paint: +${s2.paint})\n\n` +
    `Tracked live on Warhammer 40k Tournament Companion`;

  navigator.clipboard.writeText(text).then(() => {
    alert('Match Report copied to clipboard!');
  });
}

function exportMatchJson() {
  copyScorecardSummary();
}

function startFreshMatch() {
  if (confirm('Start a fresh match? Current scorecard will be reset.')) {
    location.reload();
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}
