/* ==========================================================================
   MODALS.JS - Player Profile Modal, Collapsible Elo Graph & Modals
   ========================================================================== */

let currentPlayerTrajectory = [];
let currentPlayerMatches = [];
let isChartExpanded = false;

let modalZIndexCounter = 1000;
let modalStack = [];

function bringModalToFront(modal) {
  if (!modal) return;
  if (typeof modal === 'string') modal = document.getElementById(modal);
  if (!modal) return;
  modalZIndexCounter += 10;
  modal.style.zIndex = modalZIndexCounter;
  modal.classList.add('active');
  if (!modalStack.includes(modal.id)) {
    modalStack.push(modal.id);
  }
}
window.bringModalToFront = bringModalToFront;

function closeModal(modalId) {
  if (modalId === 'event-modal' && typeof stopEventSyncPoll === 'function') {
    stopEventSyncPoll();
  }
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
    modalStack = modalStack.filter(id => id !== modalId);
  }
}

function closeModalOnBackdrop(e) {
  if (e.target && e.target.classList.contains('modal-backdrop')) {
    if (e.target.id === 'event-modal' && typeof stopEventSyncPoll === 'function') {
      stopEventSyncPoll();
    }
    e.target.classList.remove('active');
    modalStack = modalStack.filter(id => id !== e.target.id);
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length > 0) {
    const topModalId = modalStack.pop();
    closeModal(topModalId);
  }
});

function togglePlayerEloChart() {
  const container = document.getElementById('chart-collapsible-content');
  const btn = document.getElementById('toggle-chart-btn');
  const arrow = document.getElementById('toggle-chart-arrow');
  if (!container) return;

  isChartExpanded = !isChartExpanded;
  if (isChartExpanded) {
    container.style.display = 'block';
    if (arrow) arrow.innerText = '▲';
    if (btn) btn.querySelector('span').innerText = '📉 Hide Elo Progression Graph';
    if (currentPlayerTrajectory && currentPlayerTrajectory.length > 0) {
      renderTrajectoryChart(currentPlayerTrajectory);
    }
  } else {
    container.style.display = 'none';
    if (arrow) arrow.innerText = '▼';
    if (btn) btn.querySelector('span').innerText = '📈 View Elo Progression Graph';
  }
}

async function openPlayerModal(playerId) {
  const modal = document.getElementById('player-modal');
  if (!modal) return;
  bringModalToFront(modal);

  // Reset chart to collapsed state by default
  isChartExpanded = false;
  const chartContent = document.getElementById('chart-collapsible-content');
  const toggleBtn = document.getElementById('toggle-chart-btn');
  const toggleArrow = document.getElementById('toggle-chart-arrow');
  if (chartContent) chartContent.style.display = 'none';
  if (toggleArrow) toggleArrow.innerText = '▼';
  if (toggleBtn) toggleBtn.querySelector('span').innerText = '📈 View Elo Progression Graph';

  const tbody = document.getElementById('modal-matches-body');
  if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading match history...</div></td></tr>';

  const chatContainer = document.getElementById('modal-player-chat-container');
  if (chatContainer) chatContainer.innerHTML = '';

  try {
    const data = await window.api.getPlayerProfile(playerId);
    const p = data.player || data || {};
    document.getElementById('modal-player-name').innerText = p.player_name || p.full_name || 'Player Profile';

    // OmniTactica Registered User & Chat Request Handler
    if (chatContainer) {
      chatContainer.innerHTML = '';
      const playerName = p.player_name || p.full_name || 'Player';
      const playerPid = p.player_id || playerId;
      const currentUserVal = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;

      if (data.is_self) {
        chatContainer.innerHTML = `
          <span class="oc-badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3); font-size: 0.78rem; padding: 0.35rem 0.65rem; border-radius: 6px; display: inline-flex; align-items: center; gap: 0.3rem;">
            👤 You
          </span>
        `;
      } else if (!data.has_account) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-outline';
        btn.style.cssText = 'font-size: 0.78rem; padding: 0.35rem 0.65rem; border-color: rgba(239, 68, 68, 0.35); color: #f87171; background: rgba(239, 68, 68, 0.08); display: inline-flex; align-items: center; gap: 0.35rem; cursor: pointer; border-radius: 6px;';
        btn.title = `${playerName} has not registered an OmniTactica account yet. Direct chat requests are only available between registered OmniTactica players.`;
        btn.innerHTML = `🔒 Not on OmniTactica`;
        btn.onclick = () => showUnregisteredPlayerAlert(playerName);
        chatContainer.appendChild(btn);
      } else if (data.existing_request_status === 'accepted') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-primary';
        btn.style.cssText = 'font-size: 0.78rem; padding: 0.35rem 0.75rem; background: #0284c7; border-color: #0284c7; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700; border-radius: 6px; cursor: pointer;';
        btn.innerHTML = `💬 Open Chat`;
        btn.onclick = () => {
          closeModal('player-modal');
          if (typeof openChatWithRequest === 'function') {
            openChatWithRequest(data.existing_request_id);
          } else if (typeof switchTab === 'function') {
            switchTab('chat');
          }
        };
        chatContainer.appendChild(btn);
      } else if (data.existing_request_status === 'pending') {
        const isSender = data.existing_request_sender_id === currentUserVal?.id;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-outline';
        btn.style.cssText = 'font-size: 0.78rem; padding: 0.35rem 0.75rem; border-color: #f59e0b; color: #fbbf24; background: rgba(245, 158, 11, 0.12); display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 600; cursor: pointer; border-radius: 6px;';
        btn.innerHTML = isSender ? `⏳ Request Pending` : `🔔 Chat Request Received`;
        btn.title = isSender ? 'Your chat request is pending their response' : 'They sent you a chat request! Click to view in Messages';
        btn.onclick = () => {
          closeModal('player-modal');
          if (typeof switchTab === 'function') {
            switchTab('chat');
          }
        };
        chatContainer.appendChild(btn);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-primary';
        btn.style.cssText = 'font-size: 0.78rem; padding: 0.35rem 0.75rem; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700; border-radius: 6px; cursor: pointer;';
        btn.innerHTML = `💬 Send Chat Request`;
        btn.title = `Send a direct chat and match request to ${playerName}`;
        btn.onclick = () => {
          const token = localStorage.getItem('elo_auth_token') || localStorage.getItem('native_session_token');
          if (!token) {
            alert('Please log in or create an account to send chat requests to players.');
            window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.hash);
            return;
          }
          if (typeof openSendChatRequestModal === 'function') {
            openSendChatRequestModal(playerPid, playerName, data.account_user_id);
          } else if (typeof openProposeMatchModal === 'function') {
            openProposeMatchModal(playerPid, playerName);
          }
        };
        chatContainer.appendChild(btn);
      }
    }

    const teamDiv = document.getElementById('modal-player-team');
    if (teamDiv) {
      const teamsList = Array.isArray(p.teams_history) && p.teams_history.length > 0 
        ? p.teams_history 
        : ((p.all_teams || p.team || '').split(',').map(t => t.trim()).filter(Boolean));

      if (teamsList.length > 0) {
        teamDiv.style.display = 'inline-flex';
        teamDiv.style.flexWrap = 'wrap';
        teamDiv.style.gap = '0.4rem';
        teamDiv.style.alignItems = 'center';
        teamDiv.innerHTML = '';

        const currentTeam = p.team ? p.team.trim() : teamsList[0];

        teamsList.forEach((tm, idx) => {
          const isCurrent = (tm.toLowerCase() === currentTeam.toLowerCase()) || (idx === 0);
          const badge = document.createElement('span');
          badge.className = 'faction-pill';
          badge.style.cursor = 'pointer';
          badge.style.border = isCurrent ? '1px solid #38bdf8' : '1px solid #334155';
          badge.style.background = isCurrent ? 'rgba(56, 189, 248, 0.12)' : 'rgba(15, 23, 42, 0.6)';
          badge.style.color = isCurrent ? '#38bdf8' : 'var(--text-secondary)';
          badge.style.fontWeight = isCurrent ? '700' : '500';
          badge.title = isCurrent ? `${tm} (Current Active Team)` : `${tm} (Past Team)`;
          badge.innerHTML = `🛡️ ${escapeHtml(tm)}${isCurrent && teamsList.length > 1 ? ' <span style="font-size:0.68rem; opacity:0.85; margin-left:0.2rem;">(Current)</span>' : ''}`;
          badge.onclick = (e) => { e.stopPropagation(); closeModal('player-modal'); openTeamModal(tm); };
          teamDiv.appendChild(badge);
        });
      } else {
        teamDiv.style.display = 'none';
      }
    }

    const factionsDiv = document.getElementById('modal-player-factions');
    if (factionsDiv) {
      factionsDiv.innerHTML = '';
      const factionsList = (p.top_faction || '').split(',').map(f => f.trim()).filter(Boolean);
      factionsList.forEach(fac => {
        const badge = document.createElement('span');
        badge.className = 'faction-pill';
        badge.innerText = fac;
        factionsDiv.appendChild(badge);
      });
    }

    document.getElementById('modal-elo').innerText = Number(p.current_elo || 1500).toFixed(1);
    document.getElementById('modal-peak').innerText = Number(p.peak_elo || p.current_elo || 1500).toFixed(1);
    document.getElementById('modal-record').innerHTML = `<span style="color:var(--win);">${p.wins || 0}W</span> - <span style="color:var(--loss);">${p.losses || 0}L</span>${p.draws ? ` - <span style="color:var(--draw);">${p.draws}D</span>` : ''}`;
    const totalM = p.total_matches || p.matches_played || (p.wins + p.losses + (p.draws || 0)) || 0;
    const wr = p.win_rate !== undefined ? p.win_rate : (totalM > 0 ? ((p.wins / totalM) * 100).toFixed(1) : 0);
    document.getElementById('modal-winrate').innerText = `${wr}%`;
    document.getElementById('modal-streak').innerText = `${data.longest_win_streak || data.max_streak || 0} Wins`;

    currentPlayerTrajectory = data.trajectory || [];
    const matchesList = data.history || data.win_path || [];
    renderPlayerMatches(matchesList);
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="empty-state" style="color:var(--loss);">Error loading profile: ${err.message}</td></tr>`;
  }
}

function renderPlayerMatches(history) {
  const tbody = document.getElementById('modal-matches-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!history || history.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No match trajectory records stored.</td></tr>';
    return;
  }

  history.forEach(h => {
    const tr = document.createElement('tr');
    const isWin = h.result === 'W';
    const isLoss = h.result === 'L';
    const resClass = isWin ? 'badge-win' : (isLoss ? 'badge-loss' : 'badge-draw');
    const dVal = Number(h.delta_elo || 0);
    const dStr = `${dVal >= 0 ? '+' : ''}${dVal.toFixed(1)}`;
    const dColor = dVal > 0 ? 'var(--win)' : (dVal < 0 ? 'var(--loss)' : 'var(--text-muted)');

    tr.innerHTML = `
      <td style="font-family:var(--font-mono); color:var(--text-muted); font-size:0.82rem;">${(h.match_date || '').slice(0, 10)}</td>
      <td style="font-weight:600; color:#fff; font-size:0.85rem;" onclick="event.stopPropagation(); openEventModal('${h.event_id}')">
        <span class="player-link">${escapeHtml(h.event_name || 'Tournament')}</span>
      </td>
      <td style="font-family:var(--font-mono);">R${h.round || 1}</td>
      <td><span class="badge ${resClass}">${h.result || '-'}</span></td>
      <td style="font-family:var(--font-mono);">${h.player_score !== null && h.opponent_score !== null ? `${h.player_score} - ${h.opponent_score}` : '-'}</td>
      <td><span class="faction-pill" style="font-size:0.72rem;">${escapeHtml(h.player_faction || '-')}</span></td>
      <td>
        <span class="player-link" style="font-size:0.85rem;" onclick="event.stopPropagation(); openPlayerModal('${h.opponent_id}')">
          ${escapeHtml(h.opponent_name || (h.result === 'BYE' ? 'BYE' : 'Opponent'))}
        </span>
      </td>
      <td style="font-family:var(--font-mono); color:var(--text-secondary); font-size:0.85rem;">${h.opponent_elo ? Number(h.opponent_elo).toFixed(1) : '-'}</td>
      <td style="font-family:var(--font-mono); font-weight:700; color:${dColor};">${dStr}</td>
      <td class="elo-badge ${getEloBadgeClass(h.new_elo)}" style="font-size:0.88rem;">${Number(h.new_elo).toFixed(1)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderTrajectoryChart(trajectory) {
  const svg = document.getElementById('trajectory-svg');
  if (!svg || !trajectory || trajectory.length === 0) return;

  const w = svg.clientWidth || 760;
  const h = 200;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = '';

  const elos = trajectory.map(t => Number(t.elo));
  const minElo = Math.floor(Math.min(...elos) - 20);
  const maxElo = Math.ceil(Math.max(...elos) + 20);
  const range = maxElo - minElo || 1;

  const padX = 40;
  const padY = 25;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;

  const points = trajectory.map((t, idx) => {
    const x = padX + (idx / (trajectory.length - 1 || 1)) * plotW;
    const y = padY + plotH - ((Number(t.elo) - minElo) / range) * plotH;
    return { x, y, elo: Number(t.elo), result: t.result, date: t.date };
  });

  // Grid lines
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const val = minElo + (range / gridLines) * i;
    const y = padY + plotH - (i / gridLines) * plotH;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', padX);
    line.setAttribute('y1', y);
    line.setAttribute('x2', w - padX);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', '#1e2533');
    line.setAttribute('stroke-dasharray', '3,3');
    svg.appendChild(line);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', padX - 8);
    txt.setAttribute('y', y + 4);
    txt.setAttribute('fill', '#64748b');
    txt.setAttribute('font-size', '10');
    txt.setAttribute('font-family', 'monospace');
    txt.setAttribute('text-anchor', 'end');
    txt.textContent = Math.round(val);
    svg.appendChild(txt);
  }

  // Draw Path Line
  let dStr = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    dStr += ` L ${points[i].x} ${points[i].y}`;
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', dStr);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#38bdf8');
  path.setAttribute('stroke-width', '2.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);

  // Draw Points
  points.forEach(pt => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', pt.x);
    circle.setAttribute('cy', pt.y);
    circle.setAttribute('r', '4');
    circle.setAttribute('fill', pt.result === 'W' ? '#22c55e' : (pt.result === 'L' ? '#ef4444' : '#eab308'));
    circle.setAttribute('stroke', '#0a0c10');
    circle.setAttribute('stroke-width', '1.5');
    svg.appendChild(circle);
  });
}

let currentTeamRoster = [];

async function openTeamModal(teamName) {
  const modal = document.getElementById('team-modal');
  if (!modal) return;
  bringModalToFront(modal);

  const titleEl = document.getElementById('modal-team-title');
  if (titleEl) titleEl.innerText = teamName || 'Team Roster';
  const subEl = document.getElementById('modal-team-subtitle');
  if (subEl) subEl.innerText = 'Loading roster details...';

  const tbody = document.getElementById('team-roster-body');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading team roster...</div></td></tr>';

  try {
    const data = await window.api.getTeamRoster(teamName);
    const stats = data.stats || {};
    const roster = data.roster || [];
    currentTeamRoster = roster;

    if (subEl) subEl.innerText = `Gaming Club / Team • ${roster.length} registered competitors`;
    const pwrEl = document.getElementById('team-modal-power');
    if (pwrEl) pwrEl.innerText = stats.power_rating ? Number(stats.power_rating).toFixed(1) : '-';
    const rosEl = document.getElementById('team-modal-roster');
    if (rosEl) rosEl.innerText = `${stats.roster_count || roster.length} Players`;
    const matEl = document.getElementById('team-modal-matches');
    if (matEl) matEl.innerText = `${stats.total_matches || 0} (${stats.total_wins || 0}W - ${stats.total_losses || 0}L${stats.total_draws ? ' - ' + stats.total_draws + 'D' : ''})`;
    const wrEl = document.getElementById('team-modal-winrate');
    if (wrEl) wrEl.innerText = `${stats.win_rate || 0}%`;

    renderTeamRosterRows(roster);
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:var(--loss);">Error loading team: ${err.message}</td></tr>`;
  }
}

function renderTeamRosterRows(roster) {
  const tbody = document.getElementById('team-roster-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!roster || roster.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No player records found for this team.</td></tr>';
    return;
  }

  roster.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.onclick = () => openPlayerModal(p.player_id);

    const rank = idx + 1;
    const eloBadgeClass = getEloBadgeClass(p.current_elo);
    const winRate = p.win_rate !== undefined ? p.win_rate : (p.matches_played > 0 ? ((p.wins / p.matches_played) * 100).toFixed(1) : 0);

    tr.innerHTML = `
      <td class="rank-cell">#${rank}</td>
      <td>
        <div class="player-name-cell">
          <span class="player-link">${escapeHtml(p.player_name || p.full_name || 'Player')}</span>
        </div>
      </td>
      <td class="elo-badge ${eloBadgeClass}">
        ${Number(p.current_elo || 1500).toFixed(1)}
      </td>
      <td style="font-family:var(--font-mono); color:var(--text-secondary);">
        ${Number(p.peak_elo || p.current_elo || 1500).toFixed(1)}
      </td>
      <td style="font-family:var(--font-mono); font-size:0.85rem;">
        <span style="color:var(--win); font-weight:600;">${p.wins || 0}W</span> - 
        <span style="color:var(--loss); font-weight:600;">${p.losses || 0}L</span>
        ${p.draws ? ` - <span style="color:var(--draw); font-weight:600;">${p.draws}D</span>` : ''}
      </td>
      <td style="font-family:var(--font-mono); font-weight:600;">
        <span style="color: ${winRate >= 60 ? 'var(--win)' : (winRate >= 45 ? 'var(--accent)' : 'var(--text-secondary)')};">
          ${winRate}%
        </span>
      </td>
      <td>
        <span class="faction-pill">${escapeHtml(p.top_faction || 'Various')}</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}


let currentFactionMatches = [];
let currentFactionPlayers = [];
let currentFactionMatchups = [];

async function openFactionModal(factionName) {
  const modal = document.getElementById('faction-modal');
  if (!modal) return;
  bringModalToFront(modal);

  const titleEl = document.getElementById('modal-faction-title');
  if (titleEl) titleEl.innerText = factionName || 'Faction Meta';
  const subEl = document.getElementById('modal-faction-subtitle');
  if (subEl) subEl.innerText = 'Loading recorded matches and commander data...';

  switchFactionModalTab('matches');

  const matchBody = document.getElementById('faction-matches-body');
  if (matchBody) matchBody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading faction match history...</div></td></tr>';

  try {
    const data = await window.api.getFactionDetails(factionName, 100);
    const matches = data.matches || [];
    const topPlayers = data.top_players || [];
    const matchups = data.matchups || [];

    currentFactionMatches = matches;
    currentFactionPlayers = topPlayers;
    currentFactionMatchups = matchups;

    if (subEl) subEl.innerText = `Warhammer 40k Competitive Meta • ${matches.length} matches analyzed`;
    const mCount = document.getElementById('faction-tab-matches-count');
    if (mCount) mCount.innerText = matches.length;
    const pCount = document.getElementById('faction-tab-players-count');
    if (pCount) pCount.innerText = topPlayers.length;
    const muCount = document.getElementById('faction-tab-matchups-count');
    if (muCount) muCount.innerText = matchups.length;

    renderFactionMatchesRows(matches);
    renderFactionPlayersRows(topPlayers);
    renderFactionMatchupsRows(matchups);
  } catch (err) {
    if (matchBody) matchBody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:var(--loss);">Error loading faction details: ${err.message}</td></tr>`;
  }
}

function switchFactionModalTab(tabName) {
  ['matches', 'players', 'matchups'].forEach(t => {
    const btn = document.getElementById(`faction-subtab-${t}`);
    const view = document.getElementById(`faction-view-${t}`);
    if (btn) btn.classList.toggle('active', t === tabName);
    if (view) view.style.display = (t === tabName) ? 'block' : 'none';
  });
}

function renderFactionMatchesRows(matches) {
  const tbody = document.getElementById('faction-matches-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!matches || matches.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No match records found for this faction.</td></tr>';
    return;
  }

  matches.forEach((m, idx) => {
    const tr = document.createElement('tr');
    const isWin = m.outcome === 'W';
    const isLoss = m.outcome === 'L';
    const outcomeBadge = isWin 
      ? '<span class="badge badge-win">Victory</span>' 
      : (isLoss ? '<span class="badge badge-loss">Defeat</span>' : '<span class="badge badge-draw">Draw</span>');
    const scoreStr = `${m.player_score !== null && m.player_score !== undefined ? m.player_score : '-'} - ${m.opponent_score !== null && m.opponent_score !== undefined ? m.opponent_score : '-'}`;
    const dateStr = (m.match_date ? (typeof m.match_date === 'string' ? m.match_date.substring(0, 10) : new Date(m.match_date).toISOString().substring(0, 10)) : '');

    tr.innerHTML = `
      <td style="font-family:var(--font-mono); font-size:0.8rem; color:var(--text-secondary);">${dateStr || '#'}</td>
      <td>
        <span class="player-link" style="font-weight:600;" onclick="closeModal('faction-modal'); openEventModal('${m.event_id}')">
          ${escapeHtml(m.event_name || 'Tournament')}
        </span>
        <span style="font-size:0.75rem; color:var(--text-muted); margin-left:0.3rem;">R${m.round || 1}</span>
      </td>
      <td>
        <span class="player-link" style="font-weight:600;" onclick="openPlayerModal('${m.player_id}')">
          ${escapeHtml(m.player_name || 'Player')}
        </span>
      </td>
      <td style="font-family:var(--font-mono); font-weight:700; color:#fff;">
        ${scoreStr}
      </td>
      <td>
        <div style="font-weight:600;">
          <span class="player-link" onclick="openPlayerModal('${m.opponent_id}')">${escapeHtml(m.opponent_name || 'Opponent')}</span>
        </div>
        <div style="font-size:0.75rem; color:var(--text-secondary);">${escapeHtml(m.opponent_faction || 'Various')}</div>
      </td>
      <td>${outcomeBadge}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderFactionPlayersRows(players) {
  const tbody = document.getElementById('faction-players-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!players || players.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No ranked players found for this faction.</td></tr>';
    return;
  }

  players.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.onclick = () => openPlayerModal(p.player_id);

    const rank = idx + 1;
    const eloBadgeClass = getEloBadgeClass(p.current_elo);

    tr.innerHTML = `
      <td class="rank-cell">#${rank}</td>
      <td>
        <div class="player-name-cell">
          <span class="player-link">${escapeHtml(p.player_name || 'Player')}</span>
          ${p.team ? `<span class="badge" style="font-size:0.7rem; background:var(--bg-primary); border:1px solid var(--border);">${escapeHtml(p.team)}</span>` : ''}
        </div>
      </td>
      <td class="elo-badge ${eloBadgeClass}">
        ${Number(p.current_elo || 1500).toFixed(1)}
      </td>
      <td style="font-family:var(--font-mono); color:var(--text-secondary);">
        ${Number(p.peak_elo || p.current_elo || 1500).toFixed(1)}
      </td>
      <td style="font-family:var(--font-mono); font-size:0.85rem;">
        <span style="color:var(--win); font-weight:600;">${p.wins || 0}W</span> - 
        <span style="color:var(--loss); font-weight:600;">${p.losses || 0}L</span>
      </td>
      <td style="font-family:var(--font-mono); font-weight:600;">
        <span style="color: ${p.win_rate >= 60 ? 'var(--win)' : (p.win_rate >= 45 ? 'var(--accent)' : 'var(--text-secondary)')};">
          ${Number(p.win_rate || 0).toFixed(1)}%
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderFactionMatchupsRows(matchups) {
  const tbody = document.getElementById('faction-matchups-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!matchups || matchups.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No matchup pairings recorded yet.</td></tr>';
    return;
  }

  matchups.forEach((m, idx) => {
    const tr = document.createElement('tr');
    const wr = Number(m.win_rate || 0);
    const wrColor = wr >= 55.0 ? 'var(--win)' : (wr >= 45.0 ? 'var(--accent)' : 'var(--loss)');

    tr.innerHTML = `
      <td class="rank-cell">#${idx + 1}</td>
      <td style="font-weight:700; color:#fff;">
        ⚔️ vs. ${escapeHtml(m.opponent_faction)}
      </td>
      <td style="font-family:var(--font-mono); font-weight:800; font-size:1.05rem; color:${wrColor};">
        ${wr.toFixed(1)}%
      </td>
      <td style="font-family:var(--font-mono); font-size:0.85rem;">
        <span style="color:var(--win); font-weight:600;">${m.wins || 0}W</span> - 
        <span style="color:var(--loss); font-weight:600;">${m.losses || 0}L</span>
        ${m.draws ? ` - <span style="color:var(--draw); font-weight:600;">${m.draws}D</span>` : ''}
      </td>
      <td style="font-family:var(--font-mono); font-weight:600;">
        <span class="badge" style="background:var(--bg-primary); border:1px solid var(--border);">${m.total_matches} Games</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

let activeScorecardMatchId = null;

function copyCurrentScorecardLink() {
  if (!activeScorecardMatchId) return;
  const url = `${window.location.origin}/scorecard/${encodeURIComponent(activeScorecardMatchId)}`;
  navigator.clipboard.writeText(url);
  alert(`📋 Scorecard Link copied to clipboard:\n${url}`);
}

async function openScorecardModal(matchId) {
  if (!matchId) return;
  activeScorecardMatchId = matchId;

  const modal = document.getElementById('scorecard-modal');
  if (!modal) {
    window.location.href = `/scorecard/${encodeURIComponent(matchId)}`;
    return;
  }
  bringModalToFront(modal);

  const titleEl = document.getElementById('modal-scorecard-title');
  const subEl = document.getElementById('modal-scorecard-subtitle');
  const tbody = document.getElementById('modal-scorecard-matrix-body');
  const matchIdEl = document.getElementById('msc-match-id');
  const liveLink = document.getElementById('msc-live-link');

  if (titleEl) titleEl.innerHTML = `🏆 Match Scorecard`;
  if (subEl) subEl.innerText = `Loading tournament match details for ${matchId}...`;
  if (matchIdEl) matchIdEl.innerText = matchId;
  if (liveLink) liveLink.href = `/11th/tracker/play?match_id=${encodeURIComponent(matchId)}`;
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Fetching verified battle records...</div></td></tr>';

  try {
    const data = await window.api.getScorecard(matchId);
    const rec = data.game_record || {};
    const st = data.state || {};
    const game = st.game || rec.state_json?.game || {};

    const p1Name = game.p1Name || rec.p1_name || 'Player 1';
    const p2Name = game.p2Name || rec.p2_name || 'Player 2';
    const p1Fac = game.p1Faction || rec.p1_faction || 'Warhammer 40k';
    const p2Fac = game.p2Faction || rec.p2_faction || 'Warhammer 40k';
    const p1Det = (Array.isArray(game.p1Detachments) && game.p1Detachments[0]) || rec.p1_detachment || '';
    const p2Det = (Array.isArray(game.p2Detachments) && game.p2Detachments[0]) || rec.p2_detachment || '';

    const p1NameEl = document.getElementById('msc-p1-name');
    const p2NameEl = document.getElementById('msc-p2-name');
    const p1FacEl = document.getElementById('msc-p1-faction');
    const p2FacEl = document.getElementById('msc-p2-faction');
    const p1DetEl = document.getElementById('msc-p1-det');
    const p2DetEl = document.getElementById('msc-p2-det');

    if (p1NameEl) p1NameEl.innerText = p1Name;
    if (p2NameEl) p2NameEl.innerText = p2Name;
    if (p1FacEl) p1FacEl.innerText = p1Fac;
    if (p2FacEl) p2FacEl.innerText = p2Fac;
    if (p1DetEl) p1DetEl.innerText = p1Det;
    if (p2DetEl) p2DetEl.innerText = p2Det;

    const p1Obj = st.p1 || {};
    const p2Obj = st.p2 || {};
    const p1Rounds = p1Obj.rounds || [];
    const p2Rounds = p2Obj.rounds || [];

    function getVp(obj, rounds) {
      if (obj.score !== undefined && obj.score > 0) return obj.score;
      const pri = rounds.reduce((s, r) => s + (r.primaryScore || 0), 0);
      const sec = rounds.reduce((s, r) => s + (r.secondaryScore || 0), 0);
      const paint = obj.battleReady !== false ? 10 : 0;
      return Math.min(100, Math.min(50, pri) + Math.min(40, sec) + paint);
    }

    const p1Score = getVp(p1Obj, p1Rounds) || rec.p1_score || 0;
    const p2Score = getVp(p2Obj, p2Rounds) || rec.p2_score || 0;

    const p1ScoreEl = document.getElementById('msc-p1-score');
    const p2ScoreEl = document.getElementById('msc-p2-score');
    if (p1ScoreEl) p1ScoreEl.innerText = p1Score;
    if (p2ScoreEl) p2ScoreEl.innerText = p2Score;

    const roundNum = rec.round_num || game.roundNum || st.round_num || 1;
    const tableNum = rec.table_num || game.tableNum || st.table_num || null;
    const eventId = rec.event_id || game.eventId || null;

    if (titleEl) {
      titleEl.innerHTML = `🏆 ${eventId ? escapeHtml(eventId) + ' • ' : ''}Round ${roundNum} ${tableNum ? 'Table ' + tableNum : ''}`;
    }
    if (subEl) {
      subEl.innerText = `🎯 Primary: ${game.primary || game.p1Primary || rec.primary_mission || 'Take & Hold'} • 🗺️ ${game.deployment || rec.deployment || 'Search & Destroy'} • ⏱️ ${new Date(rec.updated_at || Date.now()).toLocaleDateString()}`;
    }

    // Render Matrix Rows
    if (tbody) {
      tbody.innerHTML = '';

      function buildRow(title, color, roundsArr, field, maxVal) {
        let cells = '';
        let total = 0;
        for (let i = 1; i <= 5; i++) {
          const r = roundsArr.find(x => (x.round === i || x.battleRound === i)) || roundsArr[i - 1] || {};
          const val = r[field] !== undefined ? r[field] : '-';
          if (typeof val === 'number') total += val;
          cells += `<td style="font-family:var(--font-mono); font-weight:600; text-align:center;">${val}</td>`;
        }
        return `
          <tr>
            <td style="color:${color}; font-weight:700; text-align:left;">${title}</td>
            ${cells}
            <td style="font-family:var(--font-mono); font-weight:800; color:#fff; text-align:center;">${total} ${maxVal ? '/ ' + maxVal : ''}</td>
          </tr>
        `;
      }

      tbody.innerHTML += buildRow(`🟦 ${escapeHtml(p1Name)} Primary`, '#38bdf8', p1Rounds, 'primaryScore', 50);
      tbody.innerHTML += buildRow(`🟥 ${escapeHtml(p2Name)} Primary`, '#f43f5e', p2Rounds, 'primaryScore', 50);
      tbody.innerHTML += buildRow(`🟦 ${escapeHtml(p1Name)} Secondaries`, '#7dd3fc', p1Rounds, 'secondaryScore', 40);
      tbody.innerHTML += buildRow(`🟥 ${escapeHtml(p2Name)} Secondaries`, '#fda4af', p2Rounds, 'secondaryScore', 40);
      
      tbody.innerHTML += `
        <tr style="background: rgba(255,255,255,0.02);">
          <td style="color:#10b981; font-weight:700; text-align:left;">🎨 Battle Ready (+10)</td>
          <td colspan="5" style="text-align:center; font-weight:600; font-size:0.8rem; color:var(--text-secondary);">
            ${escapeHtml(p1Name)}: ${p1Obj.battleReady !== false ? '+10' : '0'} &nbsp;|&nbsp; ${escapeHtml(p2Name)}: ${p2Obj.battleReady !== false ? '+10' : '0'}
          </td>
          <td style="font-family:var(--font-mono); font-weight:800; color:#10b981; text-align:center;">
            ${(p1Obj.battleReady !== false ? 10 : 0) + (p2Obj.battleReady !== false ? 10 : 0)}
          </td>
        </tr>
      `;
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:var(--loss);">Error loading scorecard: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// ==========================================
// FEEDBACK & BUG REPORT MODAL
// ==========================================

let activeFeedbackType = 'bug';

function setFeedbackType(type) {
  activeFeedbackType = type;
  ['bug', 'feature', 'general'].forEach(t => {
    const btn = document.getElementById(`fb-type-btn-${t}`);
    if (btn) {
      if (t === type) {
        btn.style.background = '#0284c7';
        btn.style.color = '#fff';
        btn.style.borderColor = '#38bdf8';
      } else {
        btn.style.background = 'rgba(255,255,255,0.04)';
        btn.style.color = '#94a3b8';
        btn.style.borderColor = 'rgba(255,255,255,0.1)';
      }
    }
  });
}

function openFeedbackModal() {
  let modal = document.getElementById('feedback-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'feedback-modal';
    modal.className = 'modal-backdrop';
    modal.onclick = function(e) { if (e.target === this) closeFeedbackModal(); };
    document.body.appendChild(modal);
  }

  const user = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;

  if (!user) {
    modal.innerHTML = `
      <div class="modal-window" style="max-width: 440px; background:#0b1120; border:1px solid rgba(56,189,248,0.3); border-radius:16px; box-shadow:0 25px 60px rgba(0,0,0,0.85); overflow:hidden; font-family:'Inter',system-ui,sans-serif; color:#f8fafc; text-align:center; padding: 28px 24px;">
        <div style="font-size: 36px; margin-bottom: 12px;">🔒</div>
        <h3 style="font-size: 18px; font-weight: 800; color: #fff; margin: 0 0 8px;">Sign In to Submit Feedback</h3>
        <p style="font-size: 13px; color: #94a3b8; line-height: 1.5; margin: 0 0 20px;">
          Feedback and bug reports are linked to verified player accounts so we can investigate your match data and notify you when your issue is resolved.
        </p>
        <div style="display: flex; gap: 10px; justify-content: center;">
          <button onclick="closeFeedbackModal()" style="background:#1e293b; color:#cbd5e1; font-weight:700; font-size:12px; border:none; padding:9px 18px; border-radius:8px; cursor:pointer;">Cancel</button>
          <a href="/login?redirect=/" style="background:#0284c7; color:#fff; font-weight:800; font-size:12px; text-decoration:none; padding:9px 20px; border-radius:8px; display:inline-flex; align-items:center; gap:6px;">
            🔑 Sign In / Register
          </a>
        </div>
      </div>
    `;
    modal.classList.add('active');
    return;
  }

  const userEmail = user.email || user.bcp_email || '';
  const userName = user.display_name || userEmail;

  modal.innerHTML = `
    <div class="modal-window" style="max-width: 520px; background:#0b1120; border:1px solid rgba(56,189,248,0.3); border-radius:16px; box-shadow:0 25px 60px rgba(0,0,0,0.85); overflow:hidden; font-family:'Inter',system-ui,sans-serif; color:#f8fafc;">
      <div class="modal-header" style="padding:16px 20px; background:#0f172a; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:22px;">💬</span>
          <div>
            <h3 style="font-size:16px; font-weight:800; color:#fff; margin:0;">Feedback & Bug Report</h3>
            <div style="font-size:11px; color:#10b981; margin-top:2px;">
              Submitting as <strong>${escapeHtml(userName)}</strong> (${escapeHtml(userEmail)})
            </div>
          </div>
        </div>
        <button onclick="closeFeedbackModal()" style="background:transparent; border:none; color:#94a3b8; font-size:22px; cursor:pointer;">✕</button>
      </div>

      <div style="padding:20px;">
        <!-- Category Selector -->
        <label style="display:block; font-size:12px; font-weight:700; color:#cbd5e1; margin-bottom:8px;">Category:</label>
        <div style="display:flex; gap:8px; margin-bottom:16px;">
          <button type="button" id="fb-type-btn-bug" onclick="setFeedbackType('bug')" style="flex:1; padding:8px 10px; border-radius:8px; font-size:12px; font-weight:700; border:1px solid #38bdf8; background:#0284c7; color:#fff; cursor:pointer; transition:all 0.2s;">
            🐞 Bug Report
          </button>
          <button type="button" id="fb-type-btn-feature" onclick="setFeedbackType('feature')" style="flex:1; padding:8px 10px; border-radius:8px; font-size:12px; font-weight:700; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04); color:#94a3b8; cursor:pointer; transition:all 0.2s;">
            ✨ Feature Idea
          </button>
          <button type="button" id="fb-type-btn-general" onclick="setFeedbackType('general')" style="flex:1; padding:8px 10px; border-radius:8px; font-size:12px; font-weight:700; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04); color:#94a3b8; cursor:pointer; transition:all 0.2s;">
            💬 General
          </button>
        </div>

        <!-- Description -->
        <label style="display:block; font-size:12px; font-weight:700; color:#cbd5e1; margin-bottom:6px;">
          Description / Details: <span style="color:#ef4444;">*</span>
        </label>
        <textarea id="fb-input-message" rows="5" placeholder="Describe the issue you encountered or the feature you'd love to see... (e.g. army list text error, scorecard discrepancy, predictor feedback)" style="width:100%; background:#070b14; border:1px solid #334155; border-radius:8px; padding:10px 12px; color:#e2e8f0; font-size:12.5px; font-family:'Inter',system-ui,sans-serif; outline:none; box-sizing:border-box; line-height:1.5; resize:vertical;"></textarea>

        <!-- Locked Verified User Email -->
        <div style="margin-top:14px;">
          <label style="display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:700; color:#cbd5e1; margin-bottom:6px;">
            <span>Verified Account Email:</span>
            <span style="font-size:10.5px; color:#10b981; font-weight:600;">🔒 Locked to active account</span>
          </label>
          <input type="text" id="fb-input-contact" value="${escapeHtml(userEmail)}" readonly disabled style="width:100%; background:#1e293b; border:1px solid #475569; border-radius:8px; padding:9px 12px; color:#94a3b8; font-size:12px; outline:none; box-sizing:border-box; cursor:not-allowed; opacity:0.85;">
        </div>

        <div id="fb-status-msg" style="display:none; margin-top:12px; padding:10px; border-radius:8px; font-size:12px; font-weight:600;"></div>

        <!-- Action Buttons -->
        <div style="margin-top:18px; display:flex; justify-content:flex-end; gap:8px;">
          <button onclick="closeFeedbackModal()" style="background:#1e293b; color:#cbd5e1; font-weight:700; font-size:12px; border:none; padding:9px 16px; border-radius:8px; cursor:pointer;">Cancel</button>
          <button id="fb-btn-submit" onclick="handleSubmitFeedback()" style="background:#0284c7; color:#fff; font-weight:800; font-size:12px; border:none; padding:9px 20px; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:6px;">
            🚀 Submit Feedback
          </button>
        </div>
      </div>
    </div>
  `;

  modal.classList.add('active');
  modal.style.display = 'flex';
  activeFeedbackType = 'bug';
}

function closeFeedbackModal() {
  const modal = document.getElementById('feedback-modal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
}

async function handleSubmitFeedback() {
  const msgInput = document.getElementById('fb-input-message');
  const contactInput = document.getElementById('fb-input-contact');
  const statusDiv = document.getElementById('fb-status-msg');
  const btn = document.getElementById('fb-btn-submit');

  const message = msgInput ? msgInput.value.trim() : '';
  const email = contactInput ? contactInput.value.trim() : '';

  if (!message) {
    if (statusDiv) {
      statusDiv.style.display = 'block';
      statusDiv.style.background = 'rgba(239,68,68,0.15)';
      statusDiv.style.border = '1px solid rgba(239,68,68,0.4)';
      statusDiv.style.color = '#f87171';
      statusDiv.innerText = 'Please enter your feedback message.';
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px; height:14px; border-width:2px;"></span> Submitting...';
  }

  try {
    const sessionToken = localStorage.getItem('native_session_token') || 
                         localStorage.getItem('elo_auth_token') || 
                         (typeof getCookieToken === 'function' ? getCookieToken() : (localStorage.getItem('elo_session_token') || ''));
    const payload = {
      feedback_type: activeFeedbackType,
      message: message,
      email: email,
      page_url: window.location.href,
      device_info: `${navigator.userAgent} (${window.innerWidth}x${window.innerHeight})`,
      token: sessionToken
    };

    const resp = await fetch('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {})
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();
    if (resp.ok && data.success) {
      if (statusDiv) {
        statusDiv.style.display = 'block';
        statusDiv.style.background = 'rgba(16,185,129,0.15)';
        statusDiv.style.border = '1px solid rgba(16,185,129,0.4)';
        statusDiv.style.color = '#34d399';
        statusDiv.innerText = '✅ Thank you! Your feedback has been sent directly to the developer.';
      }
      if (msgInput) msgInput.value = '';
      setTimeout(() => {
        closeFeedbackModal();
      }, 1600);
    } else {
      throw new Error(data.detail || data.error || 'Failed to submit feedback');
    }
  } catch (err) {
    if (statusDiv) {
      statusDiv.style.display = 'block';
      statusDiv.style.background = 'rgba(239,68,68,0.15)';
      statusDiv.style.border = '1px solid rgba(239,68,68,0.4)';
      statusDiv.style.color = '#f87171';
      statusDiv.innerText = `Error submitting feedback: ${err.message}`;
    }
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🚀 Submit Feedback';
    }
  }
}

window.openFeedbackModal = openFeedbackModal;
window.closeFeedbackModal = closeFeedbackModal;

function showUnregisteredPlayerAlert(playerName) {
  const name = playerName || 'This player';
  alert(`ℹ️ Chat Unavailable\n\n${name} appears in tournament match records, but has not yet registered an account on OmniTactica.\n\nDirect chat and match requests are only available between registered OmniTactica users. Once they create an account or link their BCP profile, you will be able to send chat requests.`);
}
window.showUnregisteredPlayerAlert = showUnregisteredPlayerAlert;
window.handleSubmitFeedback = handleSubmitFeedback;
window.setFeedbackType = setFeedbackType;
