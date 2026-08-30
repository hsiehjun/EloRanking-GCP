let eventsData = [];
let eventsPagination = { page: 1, pageSize: 25, total: 0, totalPages: 1 };
let eventsSortState = { field: 'event_date', asc: false };
let eventSearchTimeout = null;
let eventMatchesCache = [];
let eventPlayersCache = [];
let currentRoundFilter = 'all';

function debounceEventSearch() {
  clearTimeout(eventSearchTimeout);
  eventSearchTimeout = setTimeout(() => {
    eventsPagination.page = 1;
    loadEvents();
  }, 250);
}

function setEventsPage(newPage) {
  eventsPagination.page = newPage;
  loadEvents();
}

function setEventsPageSize(newSize) {
  eventsPagination.pageSize = newSize;
  eventsPagination.page = 1;
  loadEvents();
}

async function loadEvents() {
  const queryInput = document.getElementById('event-search-input');
  const query = queryInput ? queryInput.value.trim() : '';
  const statusSelect = document.getElementById('event-status-filter');
  const status = statusSelect ? statusSelect.value : 'all';
  const tbody = document.getElementById('events-body');

  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading tournaments...</div></td></tr>';
  }

  try {
    const res = await window.api.getTournaments(
      query, status, eventsSortState.field, eventsSortState.asc ? 'ASC' : 'DESC',
      eventsPagination.page, eventsPagination.pageSize
    );
    if (res && res.items) {
      eventsData = res.items;
      eventsPagination.total = res.total || 0;
      eventsPagination.page = res.page || 1;
      eventsPagination.pageSize = res.page_size || 25;
      eventsPagination.totalPages = res.total_pages || 1;
    } else {
      eventsData = Array.isArray(res) ? res : [];
      eventsPagination.total = eventsData.length;
    }
    renderEventsRows();
    renderPaginationBar('events-pagination', eventsPagination, 'setEventsPage', 'setEventsPageSize');
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:var(--loss);">Error loading tournaments: ${err.message}</td></tr>`;
  }
}

function renderEventsRows() {
  const tbody = document.getElementById('events-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!eventsData || eventsData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No tournaments found.</td></tr>';
    return;
  }

  eventsData.forEach(ev => {
    const tr = document.createElement('tr');
    tr.onclick = () => openEventModal(ev.id);

    const location = [ev.city, ev.state, ev.country].filter(Boolean).join(', ') || 'Unspecified';
    const dateStr = (ev.event_date || '').slice(0, 10) || '-';
    const statusBadge = ev.is_ended 
      ? '<span class="badge badge-win">COMPLETED</span>' 
      : '<span class="badge badge-draw">IN PROGRESS</span>';

    tr.innerHTML = `
      <td>
        <div style="font-weight:600; color:#fff;">
          <span class="player-link">${escapeHtml(ev.name)}</span>
        </div>
      </td>
      <td style="font-family:var(--font-mono); color:var(--text-secondary); font-size:0.85rem;">${dateStr}</td>
      <td style="color:var(--text-secondary); font-size:0.85rem;">${escapeHtml(location)}</td>
      <td style="font-family:var(--font-mono); font-weight:600;">${ev.total_players || 0}</td>
      <td style="font-family:var(--font-mono);">${ev.num_rounds || 0}</td>
      <td style="font-family:var(--font-mono); color:var(--accent); font-weight:600;">${ev.match_count || 0}</td>
      <td>${statusBadge}</td>
    `;
    tbody.appendChild(tr);
  });
}

let currentOpenEventId = null;

async function refreshCurrentEventModal(e) {
  if (e) e.stopPropagation();
  if (!currentOpenEventId) return;
  const refreshBtn = document.getElementById('modal-event-refresh-btn');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<span class="spinner" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:4px;"></span> Syncing...';
  }
  await openEventModal(currentOpenEventId, true);
  if (refreshBtn) {
    refreshBtn.disabled = false;
    refreshBtn.innerHTML = '<span>🔄 Refresh Live</span>';
  }
}

async function openEventModal(eventId, forceSync = false) {
  currentOpenEventId = eventId;
  const modal = document.getElementById('event-modal');
  if (!modal) return;
  if (typeof bringModalToFront === 'function') {
    bringModalToFront(modal);
  } else {
    modal.classList.add('active');
  }

  const bcpLink = document.getElementById('modal-event-bcp-link');
  if (bcpLink) {
    bcpLink.href = `https://www.bestcoastpairings.com/event/${encodeURIComponent(eventId)}`;
  }

  const rbody = document.getElementById('event-results-body');
  const ebody = document.getElementById('event-elo-body');
  const pbody = document.getElementById('event-pairings-body');

  if (rbody) rbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading placings & results...</div></td></tr>';
  if (ebody) ebody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading participant ratings...</div></td></tr>';
  if (pbody) pbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Syncing live round pairings from BCP...</div></td></tr>';

  try {
    const ev = await window.api.getTournamentDetails(eventId, forceSync);
    document.getElementById('modal-event-name').innerText = ev.name || 'Tournament Details';
    const loc = [ev.city, ev.state, ev.country].filter(Boolean).join(', ') || 'Online / Unspecified';
    const dStr = (ev.event_date || '').slice(0, 10);
    document.getElementById('modal-event-meta').innerText = `📅 ${dStr} • 📍 ${loc}`;

    eventMatchesCache = ev.matches || [];
    eventPlayersCache = ev.players || [];

    document.getElementById('event-modal-players').innerText = ev.total_players || eventPlayersCache.length || 0;
    document.getElementById('event-modal-rounds').innerText = ev.num_rounds || 0;
    document.getElementById('event-modal-matches').innerText = eventMatchesCache.length;
    document.getElementById('event-modal-status').innerHTML = `<span class="badge ${ev.is_ended ? 'badge-win' : 'badge-draw'}">${ev.is_ended ? 'COMPLETED' : 'IN PROGRESS'}</span>`;

    const tabResultsCount = document.getElementById('event-tab-results-count');
    const tabEloCount = document.getElementById('event-tab-elo-count');
    const tabMatchesCount = document.getElementById('event-tab-matches-count');

    const placementsCount = eventPlayersCache.filter(p => p.placement && p.placement > 0).length;
    if (tabResultsCount) tabResultsCount.innerText = placementsCount > 0 ? placementsCount : eventPlayersCache.length;
    if (tabEloCount) tabEloCount.innerText = eventPlayersCache.length;
    if (tabMatchesCount) tabMatchesCount.innerText = eventMatchesCache.length;

    if (eventMatchesCache.length > 0) {
      switchEventModalTab('matches');
    } else if (placementsCount > 0) {
      switchEventModalTab('results');
    } else {
      switchEventModalTab('elo');
    }

    renderEventResultsRows();
    renderEventEloRows();
    renderEventPairingsRows();
  } catch (err) {
    if (rbody) rbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:var(--loss);">Error loading tournament: ${err.message}</td></tr>`;
    if (pbody) pbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:var(--loss);">Error syncing pairings: ${err.message}</td></tr>`;
  }
}

function switchEventModalTab(tabKey) {
  const btnResults = document.getElementById('event-subtab-results');
  const btnElo = document.getElementById('event-subtab-elo');
  const btnMatches = document.getElementById('event-subtab-matches');
  const viewResults = document.getElementById('event-view-results');
  const viewElo = document.getElementById('event-view-elo');
  const viewMatches = document.getElementById('event-view-matches');

  [btnResults, btnElo, btnMatches].forEach(b => b && b.classList.remove('active'));
  [viewResults, viewElo, viewMatches].forEach(v => v && (v.style.display = 'none'));

  if (tabKey === 'elo') {
    if (btnElo) btnElo.classList.add('active');
    if (viewElo) viewElo.style.display = 'block';
  } else if (tabKey === 'matches') {
    if (btnMatches) btnMatches.classList.add('active');
    if (viewMatches) viewMatches.style.display = 'block';
  } else {
    if (btnResults) btnResults.classList.add('active');
    if (viewResults) viewResults.style.display = 'block';
  }
}

function renderEventResultsRows() {
  const tbody = document.getElementById('event-results-body');
  if (!tbody) return;

  if (!eventMatchesCache || eventMatchesCache.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state" style="padding:2.5rem 1rem;">
          <div style="font-size:1.05rem; font-weight:600; color:#fff;">🛡️ Tournament Not Started / No Match Placings Yet</div>
          <div style="margin-top:0.5rem; color:var(--text-secondary); font-size:0.86rem;">
            Official match placings and battle points will be calculated here once tournament rounds conclude.<br>
            Switch to the <a href="javascript:void(0)" onclick="switchEventModalTab('elo')" style="color:var(--accent); text-decoration:underline; font-weight:600;">⭐ Participant Elo Rankings</a> tab to view all ${eventPlayersCache.length} enrolled competitors.
          </div>
        </td>
      </tr>`;
    return;
  }

  if (!eventPlayersCache || eventPlayersCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No participant match records found for this tournament.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  eventPlayersCache.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.onclick = () => openPlayerModal(p.player_id);

    const eloBadgeClass = getEloBadgeClass(p.current_elo);
    const avgScore = (p.event_battle_points / (p.event_matches_count || 1)).toFixed(1);

    tr.innerHTML = `
      <td class="rank-cell">#${p.placement && p.placement > 0 ? p.placement : (idx + 1)}</td>
      <td>
        <div class="player-name-cell">
          <span class="player-link">${escapeHtml(p.full_name || 'Player')}</span>
        </div>
      </td>
      <td>
        <span class="badge" style="background:var(--bg-card); border:1px solid var(--border);">${escapeHtml(p.faction || 'Unknown')}</span>
      </td>
      <td style="font-family:var(--font-mono); font-weight:700; color:var(--win); font-size:0.95rem;">
        ${p.event_wins || 0}W - ${p.event_losses || 0}L
      </td>
      <td style="font-family:var(--font-mono); font-weight:700; color:var(--accent);">
        ${p.event_battle_points || 0} pts <span style="font-size:0.75rem; color:var(--text-muted);">(${avgScore}/g)</span>
      </td>
      <td class="elo-badge ${eloBadgeClass}">
        ${Number(p.current_elo || 1500).toFixed(1)}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderEventEloRows() {
  const tbody = document.getElementById('event-elo-body');
  if (!tbody) return;

  if (!eventPlayersCache || eventPlayersCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No registered competitors found for this tournament yet.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  // Sort players descending by current Elo
  const sorted = [...eventPlayersCache].sort((a, b) => (b.current_elo || 1500) - (a.current_elo || 1500));

  sorted.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.onclick = () => openPlayerModal(p.player_id);

    const eloBadgeClass = getEloBadgeClass(p.current_elo);

    tr.innerHTML = `
      <td class="rank-cell">#${idx + 1}</td>
      <td>
        <div class="player-name-cell">
          <span class="player-link">${escapeHtml(p.full_name || (p.first_name + ' ' + p.last_name))}</span>
        </div>
      </td>
      <td>
        <span class="badge" style="background:var(--bg-card); border:1px solid var(--border);">${escapeHtml(p.faction || 'Unknown')}</span>
      </td>
      <td class="elo-badge ${eloBadgeClass}">
        ${Number(p.current_elo || 1500).toFixed(1)}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

let selectedEventRound = 'all';

function setEventRoundFilter(roundVal) {
  selectedEventRound = roundVal;
  renderEventPairingsRows();
}

function renderEventPairingsRows() {
  const tbody = document.getElementById('event-pairings-body');
  const roundsContainer = document.getElementById('event-rounds-filter');
  if (!tbody) return;

  if (!eventMatchesCache || eventMatchesCache.length === 0) {
    if (roundsContainer) roundsContainer.innerHTML = '';
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state" style="padding:2.5rem 1rem;">
          <div style="font-size:1.05rem; font-weight:600; color:#fff;">⚔️ No Round Pairings Published Yet</div>
          <div style="margin-top:0.5rem; color:var(--text-secondary); font-size:0.86rem;">
            Round pairings and table matchups will appear here once the tournament organizer draws and posts Round 1.
          </div>
        </td>
      </tr>`;
    return;
  }

  // 1. Extract and render distinct round buttons (All, R1, R2, R3...)
  const distinctRounds = [...new Set(eventMatchesCache.map(m => m.round || 1))].sort((a, b) => a - b);
  if (roundsContainer) {
    let pillsHtml = `
      <button class="round-filter-btn ${selectedEventRound === 'all' ? 'active' : ''}" onclick="setEventRoundFilter('all')">
        All Rounds (${eventMatchesCache.length})
      </button>
    `;
    distinctRounds.forEach(r => {
      const rCount = eventMatchesCache.filter(m => (m.round || 1) === r).length;
      pillsHtml += `
        <button class="round-filter-btn ${selectedEventRound === r ? 'active' : ''}" onclick="setEventRoundFilter(${r})">
          Round ${r} (${rCount})
        </button>
      `;
    });
    roundsContainer.innerHTML = pillsHtml;
  }

  // 2. Filter matches by selected round
  const matchesToRender = selectedEventRound === 'all' 
    ? eventMatchesCache 
    : eventMatchesCache.filter(m => (m.round || 1) === Number(selectedEventRound));

  tbody.innerHTML = '';
  matchesToRender.forEach(m => {
    const tr = document.createElement('tr');
    const isP1Win = m.winner_id && m.winner_id === m.player1_id;
    const isP2Win = m.winner_id && m.winner_id === m.player2_id;
    const outcome = isP1Win ? 'Player 1 Win' : (isP2Win ? 'Player 2 Win' : (m.is_draw ? 'Draw' : (m.is_bye ? 'BYE' : 'Pending')));
    const matchId = `BCP-${currentEventId}-R${m.round || 1}-T${m.table_number || 1}`;

    const hasScore = (m.player1_score !== null && m.player2_score !== null);
    const actionBtn = hasScore
      ? `<button class="btn-sm btn-outline" style="font-size:0.72rem; padding:0.2rem 0.5rem; display:inline-flex; align-items:center; gap:0.3rem;" onclick="event.stopPropagation(); openScorecardModal('${matchId}')" title="View turn-by-turn digital scorecard">📄 Scorecard</button>`
      : `<button class="btn-sm" style="font-size:0.72rem; padding:0.2rem 0.55rem; background:#0284c7; color:#fff; border:1px solid #38bdf8; border-radius:6px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:0.3rem;" onclick="event.stopPropagation(); launchTournamentTracker('${currentEventId}', ${m.round || 1}, ${m.table_number || 1}, '${escapeHtml(m.player1_name || 'Player 1')}', '${escapeHtml(m.player2_name || 'Player 2')}', '${m.player1_id || ''}', '${m.player2_id || ''}')" title="1-Click Launch Game Tracker for Table ${m.table_number || 1}">🎲 Track</button>`;

    tr.innerHTML = `
      <td style="font-family:var(--font-mono); font-weight:700;">R${m.round || 1}</td>
      <td style="font-family:var(--font-mono); color:var(--text-muted);">T${m.table_number || 1}</td>
      <td>
        <span class="player-link" style="color:${isP1Win ? 'var(--win)' : '#fff'};" onclick="event.stopPropagation(); openPlayerModal('${m.player1_id}')">
          ${escapeHtml(m.player1_name || 'Player 1')}
        </span>
      </td>
      <td style="font-family:var(--font-mono); font-weight:700; color:${isP1Win ? 'var(--win)' : 'var(--text-secondary)'};">
        ${m.player1_score !== null ? m.player1_score : '-'}
      </td>
      <td style="font-family:var(--font-mono); font-weight:700; color:${isP2Win ? 'var(--win)' : 'var(--text-secondary)'};">
        ${m.player2_score !== null ? m.player2_score : '-'}
      </td>
      <td>
        <span class="player-link" style="color:${isP2Win ? 'var(--win)' : '#fff'};" onclick="event.stopPropagation(); openPlayerModal('${m.player2_id}')">
          ${escapeHtml(m.player2_name || (m.is_bye ? 'BYE' : 'Player 2'))}
        </span>
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:0.4rem; justify-content:flex-end;">
          <span class="badge ${isP1Win || isP2Win ? 'badge-win' : (m.is_draw ? 'badge-draw' : 'badge-loss')}">${outcome}</span>
          ${actionBtn}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function launchTournamentTracker(eventId, roundNum, tableNum, p1Name, p2Name, p1Id, p2Id) {
  const matchId = `BCP-${eventId}-R${roundNum}-T${tableNum}`.toUpperCase();
  
  let p1Fac = null;
  let p2Fac = null;
  let p1Det = null;
  let p2Det = null;
  
  if (currentEventData && Array.isArray(currentEventData.players)) {
    const p1Record = currentEventData.players.find(p => p.player_id === p1Id || p.player_name === p1Name);
    if (p1Record) {
      p1Fac = p1Record.faction || p1Record.army_name;
      p1Det = p1Record.detachment;
    }
    const p2Record = currentEventData.players.find(p => p.player_id === p2Id || p.player_name === p2Name);
    if (p2Record) {
      p2Fac = p2Record.faction || p2Record.army_name;
      p2Det = p2Record.detachment;
    }
  }

  try {
    await window.api.createTournamentTrackerRoom({
      match_id: matchId,
      event_id: eventId,
      round_num: roundNum,
      table_num: tableNum,
      p1_name: p1Name,
      p2_name: p2Name,
      p1_faction: p1Fac,
      p2_faction: p2Fac,
      p1_detachment: p1Det,
      p2_detachment: p2Det
    });
  } catch (e) {
    console.warn('Auto room connect notice:', e);
  }

  window.location.href = `/11th/tracker/play?match_id=${encodeURIComponent(matchId)}`;
}
