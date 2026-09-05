let eventsData = [];
let eventsPagination = { page: 1, pageSize: 25, total: 0, totalPages: 1 };
let eventsSortState = { field: 'event_date', asc: false };
let eventSearchTimeout = null;
let eventMatchesCache = [];
let eventPlayersCache = [];
let currentRoundFilter = 'all';
let currentOpenEventId = null;
let currentEventData = null;
let currentEventModalTab = 'elo';

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
  const tbody = document.getElementById('events-body');

  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading tournaments...</div></td></tr>';
  }

  try {
    const res = await window.api.getTournaments(
      query, 'all', eventsSortState.field, eventsSortState.asc ? 'ASC' : 'DESC',
      eventsPagination.page, eventsPagination.pageSize
    );
    if (res && res.items) {
      eventsData = res.items;
      eventsPagination.total = res.total || 0;
      eventsPagination.page = res.page || 1;
      eventsPagination.pageSize = res.page_size || 25;
      eventsPagination.totalPages = res.total_pages || 1;
    } else if (res && res.error) {
      throw new Error(res.error);
    } else {
      eventsData = Array.isArray(res) ? res : [];
      eventsPagination.total = eventsData.length;
    }
    renderEventsRows();
    renderPaginationBar('events-pagination', eventsPagination, 'setEventsPage', 'setEventsPageSize');
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:var(--loss);">Error loading tournaments: ${err.message}</td></tr>`;
  }
}

function renderEventsRows() {
  const tbody = document.getElementById('events-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!eventsData || eventsData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No tournaments found.</td></tr>';
    return;
  }

  eventsData.forEach(ev => {
    const tr = document.createElement('tr');
    tr.onclick = () => openEventModal(ev.id, false, 'elo');

    const location = [ev.city, ev.state, ev.country].filter(Boolean).join(', ') || 'Unspecified';
    const dateStr = (ev.event_date || '').slice(0, 10) || '-';

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
    `;
    tbody.appendChild(tr);
  });
}

async function refreshCurrentEventModal(e) {
  if (e) e.stopPropagation();
  if (!currentOpenEventId) return;
  const refreshBtn = document.getElementById('modal-event-refresh-btn');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<span class="spinner" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:4px;"></span> Syncing...';
  }
  await openEventModal(currentOpenEventId, true, currentEventModalTab || 'elo');
  if (refreshBtn) {
    refreshBtn.disabled = false;
    refreshBtn.innerHTML = '<span>🔄 Refresh Live</span>';
  }
}

let eventSyncPollTimer = null;

function stopEventSyncPoll() {
  if (eventSyncPollTimer) {
    clearTimeout(eventSyncPollTimer);
    eventSyncPollTimer = null;
  }
  const statusEl = document.getElementById('modal-event-sync-status');
  if (statusEl) statusEl.style.display = 'none';
}
window.stopEventSyncPoll = stopEventSyncPoll;

function scheduleEventSyncPoll(eventId, attempt = 1) {
  if (eventSyncPollTimer) clearTimeout(eventSyncPollTimer);
  if (attempt > 6) {
    const statusEl = document.getElementById('modal-event-sync-status');
    if (statusEl) statusEl.style.display = 'none';
    return;
  }
  eventSyncPollTimer = setTimeout(async () => {
    if (currentOpenEventId !== eventId) return;
    try {
      const fresh = await window.api.getTournamentDetails(eventId, false);
      if (currentOpenEventId !== eventId) return;
      if (fresh && !fresh.error) {
        currentEventData = fresh;
        eventMatchesCache = fresh.matches || [];
        eventPlayersCache = fresh.players || [];

        document.getElementById('event-modal-players').innerText = fresh.total_players || eventPlayersCache.length || 0;
        document.getElementById('event-modal-rounds').innerText = fresh.num_rounds || 0;
        document.getElementById('event-modal-matches').innerText = eventMatchesCache.length;

        const tabResultsCount = document.getElementById('event-tab-results-count');
        const tabEloCount = document.getElementById('event-tab-elo-count');
        const tabMatchesCount = document.getElementById('event-tab-matches-count');

        const placementsCount = eventPlayersCache.filter(p => p.placement && p.placement > 0).length;
        if (tabResultsCount) tabResultsCount.innerText = placementsCount > 0 ? placementsCount : eventPlayersCache.length;
        if (tabEloCount) tabEloCount.innerText = eventPlayersCache.length;
        if (tabMatchesCount) tabMatchesCount.innerText = eventMatchesCache.length;

        renderEventResultsRows();
        renderEventEloRows();
        renderEventPairingsRows();

        const statusEl = document.getElementById('modal-event-sync-status');
        if (fresh.sync_in_progress) {
          scheduleEventSyncPoll(eventId, attempt + 1);
        } else {
          if (statusEl) {
            statusEl.style.display = 'inline-flex';
            statusEl.innerHTML = `
              <span style="display:inline-flex; align-items:center; gap:4px; font-size:0.75rem; color:#10b981; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.28); padding:3px 9px; border-radius:6px; font-weight:700;">
                <span>✓ Live BCP Synced</span>
              </span>
            `;
            setTimeout(() => {
              if (currentOpenEventId === eventId && statusEl) {
                statusEl.style.display = 'none';
              }
            }, 3000);
          }
        }
      }
    } catch (e) {
      console.debug('Notice polling event sync:', e);
    }
  }, attempt === 1 ? 2000 : 3000);
}

async function openEventModal(eventId, forceSync = false, initialTab = 'elo') {
  stopEventSyncPoll();
  currentOpenEventId = eventId;
  const modal = document.getElementById('event-modal');
  if (!modal) return;
  if (typeof bringModalToFront === 'function') {
    bringModalToFront(modal);
  } else {
    modal.classList.add('active');
  }

  // Set active tab immediately to prevent visual flashing
  switchEventModalTab(initialTab || 'elo');

  const bcpLink = document.getElementById('modal-event-bcp-link');
  if (bcpLink) {
    bcpLink.href = `https://www.bestcoastpairings.com/event/${encodeURIComponent(eventId)}`;
  }

  const rbody = document.getElementById('event-results-body');
  const ebody = document.getElementById('event-elo-body');
  const pbody = document.getElementById('event-pairings-body');
  const hasCachedRows = (currentEventData && String(currentEventData.id) === String(eventId));

  if (hasCachedRows) {
    if (rbody) rbody.style.opacity = '0.6';
    if (ebody) ebody.style.opacity = '0.6';
    if (pbody) pbody.style.opacity = '0.6';
  } else {
    if (rbody) rbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading placings & results...</div></td></tr>';
    if (ebody) ebody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading participant ratings...</div></td></tr>';
    if (pbody) pbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Syncing live round pairings from BCP...</div></td></tr>';
  }

  try {
    const ev = await window.api.getTournamentDetails(eventId, forceSync);
    if (!ev || ev.error) {
      throw new Error((ev && ev.error) || 'Failed to load tournament data');
    }
    currentEventData = ev;
    document.getElementById('modal-event-name').innerText = ev.name || 'Tournament Details';
    const loc = [ev.city, ev.state, ev.country].filter(Boolean).join(', ') || 'Online / Unspecified';
    const dStr = (ev.event_date || '').slice(0, 10);
    document.getElementById('modal-event-meta').innerText = `📅 ${dStr} • 📍 ${loc}`;

    eventMatchesCache = ev.matches || [];
    eventPlayersCache = ev.players || [];

    document.getElementById('event-modal-players').innerText = ev.total_players || eventPlayersCache.length || 0;
    document.getElementById('event-modal-rounds').innerText = ev.num_rounds || 0;
    document.getElementById('event-modal-matches').innerText = eventMatchesCache.length;

    const tabResultsCount = document.getElementById('event-tab-results-count');
    const tabEloCount = document.getElementById('event-tab-elo-count');
    const tabMatchesCount = document.getElementById('event-tab-matches-count');

    const placementsCount = eventPlayersCache.filter(p => p.placement && p.placement > 0).length;
    if (tabResultsCount) tabResultsCount.innerText = placementsCount > 0 ? placementsCount : eventPlayersCache.length;
    if (tabEloCount) tabEloCount.innerText = eventPlayersCache.length;
    if (tabMatchesCount) tabMatchesCount.innerText = eventMatchesCache.length;

    if (!hasCachedRows) {
      if (initialTab) {
        switchEventModalTab(initialTab);
      } else if (eventMatchesCache.length > 0) {
        switchEventModalTab('matches');
      } else if (placementsCount > 0) {
        switchEventModalTab('results');
      } else {
        switchEventModalTab('elo');
      }
    }

    renderEventResultsRows();
    renderEventEloRows();
    renderEventPairingsRows();

    if (rbody) rbody.style.opacity = '1';
    if (ebody) ebody.style.opacity = '1';
    if (pbody) pbody.style.opacity = '1';

    // Handle background BCP sync status pill
    const statusEl = document.getElementById('modal-event-sync-status');
    if (statusEl) {
      if (ev.sync_in_progress) {
        statusEl.style.display = 'inline-flex';
        statusEl.innerHTML = `
          <span style="display:inline-flex; align-items:center; gap:5px; font-size:0.75rem; color:#38bdf8; background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.28); padding:3px 9px; border-radius:6px; font-weight:600;">
            <span class="spinner-mini" style="display:inline-block; width:9px; height:9px; border:1.5px solid rgba(56,189,248,0.3); border-top-color:#38bdf8; border-radius:50%; animation:spin 0.8s linear infinite;"></span>
            <span>Syncing BCP...</span>
          </span>
        `;
        scheduleEventSyncPoll(eventId);
      } else {
        statusEl.style.display = 'none';
      }
    }

    // Sync computed field stats back into communityState overview if active
    if (typeof communityState !== 'undefined' && communityState.overview && eventPlayersCache.length > 0) {
      const elos = eventPlayersCache.map(p => Number(p.current_elo)).filter(e => !isNaN(e) && e > 0);
      if (elos.length > 0) {
        const avgElo = Math.round(elos.reduce((a, b) => a + b, 0) / elos.length);
        const maxElo = Math.max(...elos);
        let updated = false;
        ['events_upcoming', 'events_recent', 'upcoming_events', 'recent_events'].forEach(k => {
          const list = communityState.overview[k];
          if (Array.isArray(list)) {
            const match = list.find(item => item.id === eventId);
            if (match) {
              match.avg_field_elo = avgElo;
              match.top_seed_elo = maxElo;
              if (eventPlayersCache.length > (match.total_players || 0)) {
                match.total_players = eventPlayersCache.length;
              }
              updated = true;
            }
          }
        });
        if (updated) {
          if (typeof renderCommunityEvents === 'function') {
            renderCommunityEvents();
          } else if (typeof renderCommunityTournaments === 'function') {
            renderCommunityTournaments(communityState.overview);
          }
        }
      }
    }

    // Tournament Registration Button hidden per user request until registration integration is active
    const regBtn = document.getElementById('modal-event-register-btn');
    if (regBtn) {
      regBtn.style.display = 'none';
    }
  } catch (err) {
    if (rbody) {
      rbody.style.opacity = '1';
      rbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:var(--loss);">Error loading tournament: ${err.message}</td></tr>`;
    }
    if (ebody) {
      ebody.style.opacity = '1';
      ebody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:var(--loss);">Error loading participant ratings: ${err.message}</td></tr>`;
    }
    if (pbody) {
      pbody.style.opacity = '1';
      pbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:var(--loss);">Error syncing pairings: ${err.message}</td></tr>`;
    }
  }
}

function switchEventModalTab(tabKey) {
  currentEventModalTab = tabKey || 'elo';
  const btnResults = document.getElementById('event-subtab-results');
  const btnElo = document.getElementById('event-subtab-elo');
  const btnMatches = document.getElementById('event-subtab-matches');
  const viewResults = document.getElementById('event-view-results');
  const viewElo = document.getElementById('event-view-elo');
  const viewMatches = document.getElementById('event-view-matches');

  [btnResults, btnElo, btnMatches].forEach(b => b && b.classList.remove('active'));
  [viewResults, viewElo, viewMatches].forEach(v => v && (v.style.display = 'none'));

  if (tabKey === 'matches') {
    if (btnMatches) btnMatches.classList.add('active');
    if (viewMatches) viewMatches.style.display = 'block';
  } else if (tabKey === 'results') {
    if (btnResults) btnResults.classList.add('active');
    if (viewResults) viewResults.style.display = 'block';
  } else {
    // default to 'elo' tab
    if (btnElo) btnElo.classList.add('active');
    if (viewElo) viewElo.style.display = 'block';
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
    const eventId = currentOpenEventId || (currentEventData && currentEventData.id) || '';
    const matchId = `BCP-${eventId}-R${m.round || 1}-T${m.table_number || 1}`;

    const isBye = Boolean(m.is_bye || m.player2_name === 'BYE' || !m.player2_id);
    const hasScore = (m.player1_score !== null && m.player2_score !== null);
    const hasTrackerGame = Boolean(m.has_tracker_game);
    const isTrackerDone = Boolean(m.tracker_is_done || m.tracker_status === 'completed');

    // Permission checks: Is current logged-in user Player 1, Player 2, or Staff (Admin/TO/Referee)?
    const u = currentUser;
    const uPlayerId = u && (u.player_id || u.bcp_user_id || u.bcp_id || u.id);
    const uName = u && (u.name || u.full_name || u.username || '').trim().toLowerCase();
    const p1NameClean = (m.player1_name || '').trim().toLowerCase();
    const p2NameClean = (m.player2_name || '').trim().toLowerCase();

    const isP1 = Boolean(u && (
      (uPlayerId && (uPlayerId === m.player1_id || uPlayerId === m.player1_name)) ||
      (uName && p1NameClean && uName === p1NameClean)
    ));
    const isP2 = Boolean(u && (
      (uPlayerId && (uPlayerId === m.player2_id || uPlayerId === m.player2_name)) ||
      (uName && p2NameClean && uName === p2NameClean)
    ));
    const isStaff = Boolean(u && (
      u.role === 'admin' || u.role === 'to' || u.role === 'referee' || u.role === 'organizer'
    ));
    const canEdit = Boolean(isP1 || isP2 || isStaff);

    let actionBtn = '';
    if (!isBye) {
      // 1. If game was actually completed with digital scorecard in tracker_games
      if (hasTrackerGame && (isTrackerDone || hasScore)) {
        actionBtn = `<button class="btn-sm btn-outline" style="font-size:0.72rem; padding:0.2rem 0.5rem; display:inline-flex; align-items:center; gap:0.3rem;" onclick="event.stopPropagation(); openScorecardModal('${matchId}')" title="View turn-by-turn digital scorecard">📄 Scorecard</button>`;
      } 
      // 2. If match is uncompleted and user has competitor/staff permissions to edit/track
      else if (!hasScore && canEdit) {
        const btnLabel = hasTrackerGame ? '🎮 Resume' : '🎲 Track';
        actionBtn = `<button class="btn-sm" style="font-size:0.72rem; padding:0.2rem 0.55rem; background:#0284c7; color:#fff; border:1px solid #38bdf8; border-radius:6px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:0.3rem;" onclick="event.stopPropagation(); launchTournamentTracker('${eventId}', ${m.round || 1}, ${m.table_number || 1}, '${escapeHtml(m.player1_name || 'Player 1')}', '${escapeHtml(m.player2_name || 'Player 2')}', '${m.player1_id || ''}', '${m.player2_id || ''}')" title="1-Click Launch Game Tracker for Table ${m.table_number || 1}">${btnLabel}</button>`;
      }
      // 3. If match has an active tracker room and user is a spectator
      else if (!hasScore && hasTrackerGame && !canEdit) {
        actionBtn = `<button class="btn-sm btn-outline" style="font-size:0.72rem; padding:0.2rem 0.5rem; display:inline-flex; align-items:center; gap:0.3rem; border-color:#6366f1; color:#818cf8;" onclick="event.stopPropagation(); window.open('/11th/tracker?match_id=${encodeURIComponent(matchId)}&role=spectator', '_blank')" title="Live Spectator Mode">👀 Spectate</button>`;
      }
    }

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

/* ==========================================================================
   TOURNAMENT SELF-REGISTRATION MODAL
   ========================================================================== */

function openTournamentRegistrationModal(eventId, eventName) {
  const modal = document.getElementById('modal-tournament-register');
  if (!modal) return;

  const titleEl = document.getElementById('register-event-title');
  if (titleEl) titleEl.textContent = eventName || (currentEventData && currentEventData.name) || 'Tournament Registration';

  const form = document.getElementById('form-tournament-register');
  if (form) form.reset();
  if (form) form.dataset.eventId = eventId;

  const msg = document.getElementById('reg-status-message');
  if (msg) msg.style.display = 'none';

  // Pre-fill user data if authenticated or already registered
  const currentUser = (typeof authState !== 'undefined' && authState.user) ? authState.user : (window.currentUser || null);
  let existingReg = null;
  if (currentEventData) {
    const cName = currentUser ? String(currentUser.name || currentUser.full_name || currentUser.username || '').trim().toLowerCase() : '';
    const cEmail = currentUser ? String(currentUser.email || '').trim().toLowerCase() : '';
    const cPid = currentUser ? String(currentUser.player_id || '').trim().toLowerCase() : '';
    const cBcp = currentUser ? String(currentUser.bcp_user_id || '').trim().toLowerCase() : '';
    const allPlayers = [...(currentEventData.roster || []), ...(currentEventData.players || [])];
    existingReg = allPlayers.find(p => {
      if (!p) return false;
      const pEmail = String(p.email || '').trim().toLowerCase();
      if (cEmail && pEmail && pEmail === cEmail) return true;
      const pName = String(p.name || p.full_name || p.player_name || '').trim().toLowerCase();
      if (cName && pName && (pName === cName || cName.includes(pName) || pName.includes(cName))) return true;
      const pId = String(p.id || p.player_id || '').trim().toLowerCase();
      if (cPid && pId && pId === cPid) return true;
      const pUserId = String(p.userId || p.bcp_user_id || '').trim().toLowerCase();
      if (cBcp && (pId === cBcp || pUserId === cBcp)) return true;
      return false;
    });
  }

  const nameInput = document.getElementById('reg-player-name');
  const factionInput = document.getElementById('reg-player-faction');
  const detachmentInput = document.getElementById('reg-player-detachment');
  const teamInput = document.getElementById('reg-player-team');
  const emailInput = document.getElementById('reg-player-email');
  const listInput = document.getElementById('reg-player-armylist');
  const submitBtn = document.getElementById('btn-submit-registration');

  if (currentUser) {
    if (nameInput) nameInput.value = currentUser.name || currentUser.full_name || currentUser.username || '';
    if (emailInput) emailInput.value = currentUser.email || '';
  }
  if (existingReg) {
    if (nameInput && (existingReg.name || existingReg.full_name)) nameInput.value = existingReg.name || existingReg.full_name;
    if (factionInput && existingReg.faction && existingReg.faction !== 'Unassigned' && existingReg.faction !== 'Unknown') factionInput.value = existingReg.faction;
    if (detachmentInput && existingReg.detachment && existingReg.detachment !== 'Standard') detachmentInput.value = existingReg.detachment;
    if (teamInput && existingReg.team) teamInput.value = existingReg.team;
    if (emailInput && existingReg.email) emailInput.value = existingReg.email;
    if (listInput && (existingReg.army_list || existingReg.armyList)) listInput.value = existingReg.army_list || existingReg.armyList;
    if (submitBtn) submitBtn.textContent = 'Update Registration';
  } else if (submitBtn) {
    submitBtn.textContent = 'Complete Registration';
  }

  modal.style.display = 'flex';
  if (typeof bringModalToFront === 'function') {
    bringModalToFront(modal);
  }
}

function closeTournamentRegistrationModal() {
  const modal = document.getElementById('modal-tournament-register');
  if (modal) modal.style.display = 'none';
}

async function submitTournamentRegistration(e) {
  if (e) e.preventDefault();
  const form = document.getElementById('form-tournament-register');
  const eventId = (form && form.dataset.eventId) || currentOpenEventId;
  if (!eventId) return;

  const name = document.getElementById('reg-player-name')?.value.trim();
  const faction = document.getElementById('reg-player-faction')?.value.trim();
  const detachment = document.getElementById('reg-player-detachment')?.value.trim() || '';
  const team = document.getElementById('reg-player-team')?.value.trim() || '';
  const email = document.getElementById('reg-player-email')?.value.trim() || '';
  const armyList = document.getElementById('reg-player-armylist')?.value.trim() || '';
  const btn = document.getElementById('btn-submit-registration');
  const msg = document.getElementById('reg-status-message');

  if (!name || !faction) {
    if (msg) {
      msg.style.display = 'block';
      msg.style.background = 'rgba(239, 68, 68, 0.15)';
      msg.style.color = '#ef4444';
      msg.textContent = 'Please enter both your name and faction.';
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-mini" style="display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation:spin 0.8s linear infinite; margin-right:6px; vertical-align:middle;"></span> Processing...';
  }

  try {
    const res = await window.api.registerForTournament(eventId, {
      name,
      faction,
      detachment,
      team,
      email,
      army_list: armyList,
      checked_in: true
    });

    if (res && res.success) {
      if (msg) {
        msg.style.display = 'block';
        msg.style.background = 'rgba(16, 185, 129, 0.15)';
        msg.style.color = '#10b981';
        const bcpNote = (res.bcp_registered || res.bcp_synced) ? ' and synced with Best Coast Pairings' : '';
        const notice = res.bcp_notice ? ` (${res.bcp_notice})` : '';
        msg.textContent = `✅ Successfully registered for ${res.event?.name || 'the tournament'}${bcpNote}! Current Elo: ${res.player?.currentElo || 1500}${notice}`;
      }
      setTimeout(() => {
        closeTournamentRegistrationModal();
        openEventModal(eventId, true, 'elo');
      }, 1200);
    } else {
      if (msg) {
        msg.style.display = 'block';
        msg.style.background = 'rgba(239, 68, 68, 0.15)';
        msg.style.color = '#ef4444';
        msg.textContent = (res && (res.detail || res.message)) || 'Registration failed. Please try again.';
      }
    }
  } catch (err) {
    if (msg) {
      msg.style.display = 'block';
      msg.style.background = 'rgba(239, 68, 68, 0.15)';
      msg.style.color = '#ef4444';
      msg.textContent = 'Registration error: ' + (err.message || err);
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Complete Registration';
    }
  }
}

// Window bindings for tournament modal and registration
window.openEventModal = openEventModal;
window.switchEventModalTab = switchEventModalTab;
window.refreshCurrentEventModal = refreshCurrentEventModal;
window.launchTournamentTracker = launchTournamentTracker;
window.openTournamentRegistrationModal = openTournamentRegistrationModal;
window.closeTournamentRegistrationModal = closeTournamentRegistrationModal;
window.submitTournamentRegistration = submitTournamentRegistration;
