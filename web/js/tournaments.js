let eventsData = [];
let eventsPagination = { page: 1, pageSize: 25, total: 0, totalPages: 1 };
let eventsSortState = { field: 'event_date', asc: false };
let eventSearchTimeout = null;
let eventMatchesCache = [];
let eventPlayersCache = [];
let currentRoundFilter = 'all';
let currentOpenEventId = null;
let currentEventData = null;
let currentEventModalTab = 'results';
let eventModalSearchQuery = '';

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
    tr.onclick = () => openEventModal(ev.id, false);

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
  await openEventModal(currentOpenEventId, true, currentEventModalTab || 'results');
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

        const elPlayers = document.getElementById('event-modal-players');
        if (elPlayers) elPlayers.innerText = fresh.total_players || eventPlayersCache.length || 0;
        const elRounds = document.getElementById('event-modal-rounds');
        if (elRounds) elRounds.innerText = fresh.num_rounds || 0;
        const elMatches = document.getElementById('event-modal-matches');
        if (elMatches) elMatches.innerText = eventMatchesCache.length;

        const metaEl = document.getElementById('modal-event-meta');
        if (metaEl) {
          const loc = [fresh.city, fresh.state, fresh.country].filter(Boolean).join(', ') || 'Online / Unspecified';
          const dStr = (fresh.event_date || '').slice(0, 10);
          const numRounds = fresh.num_rounds || (eventMatchesCache.length > 0 ? Math.max(...eventMatchesCache.map(m => m.round || 1)) : 0);
          const roundsPart = numRounds > 0 ? ` • 🔄 ${numRounds} Rounds` : '';
          metaEl.innerText = `📅 ${dStr} • 📍 ${loc}${roundsPart}`;
        }

        const tabResultsCount = document.getElementById('event-tab-results-count');
        const tabEloCount = document.getElementById('event-tab-elo-count');
        const tabMatchesCount = document.getElementById('event-tab-matches-count');
        const tabTeamsCount = document.getElementById('event-tab-teams-count');
        const subtabTeams = document.getElementById('event-subtab-teams');

        const placementsCount = eventPlayersCache.filter(p => p.placement && p.placement > 0).length;
        if (tabResultsCount) tabResultsCount.innerText = placementsCount > 0 ? placementsCount : eventPlayersCache.length;
        if (tabEloCount) tabEloCount.innerText = eventPlayersCache.length;
        if (tabMatchesCount) tabMatchesCount.innerText = eventMatchesCache.length;

        const isTeamEventFresh = Boolean(fresh.is_team_event || (fresh.teams && fresh.teams.length > 0));
        const isDoublesFresh = Boolean(fresh.is_doubles_event);
        const teamsListFresh = (fresh.teams && fresh.teams.length > 0) ? fresh.teams : (fresh.team_standings || []);

        if (isTeamEventFresh || teamsListFresh.length > 0) {
          if (subtabTeams) subtabTeams.style.setProperty('display', 'inline-flex', 'important');
          const hasFreshTeamPlacings = teamsListFresh.some(t => t.placing && t.placing > 0);
          const labelSpan = document.getElementById('event-subtab-teams-label') || (subtabTeams && subtabTeams.querySelector('span:first-child'));
          if (labelSpan) {
            labelSpan.innerText = isDoublesFresh ? (hasFreshTeamPlacings ? '🏆 Duo Placings' : '👥 Doubles Rosters') : (hasFreshTeamPlacings ? '🏆 Team Placings' : '🛡️ Team Rosters');
          }
          if (tabTeamsCount) tabTeamsCount.innerText = teamsListFresh.length;
          renderEventTeamsRows();
        } else {
          if (subtabTeams) subtabTeams.style.setProperty('display', 'none', 'important');
        }

        const resultsBtnFresh = document.getElementById('event-subtab-results');
        const resultsSpanFresh = resultsBtnFresh && resultsBtnFresh.querySelector('span:first-child');
        if (resultsSpanFresh) {
          resultsSpanFresh.innerText = isTeamEventFresh ? (placementsCount > 0 ? '👤 Player Placings' : '👤 Competitors') : (placementsCount > 0 ? '🏆 Results & Placings' : '👥 Registered Competitors');
        }

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

let eventDetailsLoadingCancelledId = null;

function closeEventDetailsLoadingModal() {
  const loadingModal = document.getElementById('event-details-loading-modal');
  if (loadingModal) {
    loadingModal.style.display = 'none';
    loadingModal.classList.remove('active');
    loadingModal.style.removeProperty('z-index');
  }
  if (typeof modalStack !== 'undefined') {
    modalStack = modalStack.filter(id => id !== 'event-details-loading-modal');
  }
  if (typeof window !== 'undefined' && window.modalStack) {
    window.modalStack = window.modalStack.filter(id => id !== 'event-details-loading-modal');
  }
  if (currentOpenEventId) {
    eventDetailsLoadingCancelledId = currentOpenEventId;
  }
}
window.closeEventDetailsLoadingModal = closeEventDetailsLoadingModal;

async function openEventModal(eventId, forceSync = false, initialTab = null) {
  stopEventSyncPoll();
  currentOpenEventId = eventId;
  eventDetailsLoadingCancelledId = null;
  eventModalSearchQuery = '';
  selectedEventRound = 'all';
  const searchInput = document.getElementById('event-modal-search');
  if (searchInput) searchInput.value = '';
  const clearBtn = document.getElementById('event-modal-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  const searchSummary = document.getElementById('event-modal-search-summary');
  if (searchSummary) searchSummary.style.display = 'none';

  const modal = document.getElementById('event-modal');
  if (!modal) return;

  // Set active tab immediately to prevent visual flashing (default to teams for team tournaments, results otherwise)
  const guessedIsTeam = Boolean(currentEventData && String(currentEventData.id) === String(eventId) && (currentEventData.is_team_event || (currentEventData.teams && currentEventData.teams.length > 0)));
  switchEventModalTab(initialTab || (guessedIsTeam ? 'teams' : 'results'));

  const subtabPlayerInit = document.getElementById('event-subtab-player');
  const subtabTeamsInit = document.getElementById('event-subtab-teams');
  const subtabEloInit = document.getElementById('event-subtab-elo');
  if (subtabPlayerInit) subtabPlayerInit.style.setProperty('display', (initialTab === 'player') ? 'inline-flex' : 'none', 'important');
  if (subtabTeamsInit) {
    if (guessedIsTeam) {
      subtabTeamsInit.style.setProperty('display', 'inline-flex', 'important');
    } else {
      subtabTeamsInit.style.setProperty('display', 'none', 'important');
    }
  }
  if (subtabEloInit) subtabEloInit.style.setProperty('display', 'none', 'important');

  const isTopEventModal = modal.classList.contains('active') &&
                          modal.style.display !== 'none' &&
                          ((typeof modalStack !== 'undefined' && modalStack.length > 0 && modalStack[modalStack.length - 1] === 'event-modal') ||
                           (typeof window !== 'undefined' && window.modalStack && window.modalStack.length > 0 && window.modalStack[window.modalStack.length - 1] === 'event-modal')) &&
                          currentEventData && String(currentEventData.id) === String(eventId);
  const loadingModal = document.getElementById('event-details-loading-modal');

  // If the event modal is not already the top active modal showing this event, display the dedicated BCP loading screen immediately
  if (!isTopEventModal && loadingModal) {
    let previewName = '';
    if (currentEventData && String(currentEventData.id) === String(eventId)) {
      previewName = currentEventData.name || currentEventData.event_name || '';
    } else if (typeof communityState !== 'undefined' && communityState?.overview) {
      const allEvents = [
        ...(communityState.overview.events_upcoming || []),
        ...(communityState.overview.events_recent || []),
        ...(communityState.overview.upcoming_events || []),
        ...(communityState.overview.recent_events || [])
      ];
      const found = allEvents.find(e => String(e.id) === String(eventId));
      if (found) previewName = found.name || '';
    } else if (typeof eventsData !== 'undefined' && Array.isArray(eventsData)) {
      const found = eventsData.find(e => String(e.id) === String(eventId));
      if (found) previewName = found.name || '';
    }

    const titleEl = document.getElementById('event-details-loading-title');
    if (titleEl) titleEl.innerText = 'Loading tournament data...';

    const textEl = document.getElementById('event-details-loading-text');
    if (textEl) {
      textEl.innerText = previewName
        ? `Fetching tournament details, rosters & live pairings for ${previewName}...`
        : 'Fetching tournament details, rosters & live pairings...';
    }

    loadingModal.style.display = 'flex';
    if (typeof bringModalToFront === 'function') {
      bringModalToFront(loadingModal);
    } else {
      loadingModal.classList.add('active');
    }
  }

  const bcpLink = document.getElementById('modal-event-bcp-link');
  if (bcpLink) {
    bcpLink.href = `https://www.bestcoastpairings.com/event/${encodeURIComponent(eventId)}`;
  }

  const rbody = document.getElementById('event-results-body');
  const ebody = document.getElementById('event-elo-body');
  const pbody = document.getElementById('event-pairings-body');
  const hasCachedRows = (currentEventData && String(currentEventData.id) === String(eventId));

  if (hasCachedRows && isTopEventModal) {
    if (rbody) rbody.style.opacity = '0.6';
    if (ebody) ebody.style.opacity = '0.6';
    if (pbody) pbody.style.opacity = '0.6';
  } else if (!hasCachedRows) {
    if (rbody) rbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading placings & results...</div></td></tr>';
    if (ebody) ebody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading participant ratings...</div></td></tr>';
    if (pbody) pbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Syncing live round pairings from BCP...</div></td></tr>';
  }

  // Parallel network fetch: tournament details + community registration
  const detailsPromise = window.api.getTournamentDetails(eventId, forceSync);
  const regPromise = (typeof window.api?.getCommunityEventRegistration === 'function')
    ? window.api.getCommunityEventRegistration(eventId, forceSync).catch(e => {
        console.debug('Notice checking user registration:', e);
        return null;
      })
    : Promise.resolve(null);

  try {
    const [detailsResult, regResult] = await Promise.allSettled([detailsPromise, regPromise]);

    // Check if user dismissed the loading screen while waiting
    if (eventDetailsLoadingCancelledId === eventId) {
      if (loadingModal) {
        loadingModal.style.display = 'none';
        loadingModal.classList.remove('active');
        loadingModal.style.removeProperty('z-index');
        if (typeof modalStack !== 'undefined') {
          modalStack = modalStack.filter(id => id !== 'event-details-loading-modal');
        }
        if (typeof window !== 'undefined' && window.modalStack) {
          window.modalStack = window.modalStack.filter(id => id !== 'event-details-loading-modal');
        }
      }
      return;
    }

    if (detailsResult.status === 'rejected' || !detailsResult.value || detailsResult.value.error) {
      const errMsg = (detailsResult.value && detailsResult.value.error) || detailsResult.reason?.message || 'Failed to load tournament data';
      throw new Error(errMsg);
    }

    const ev = detailsResult.value;
    const userRegData = (regResult.status === 'fulfilled' && regResult.value && !regResult.value.error) ? regResult.value : null;

    currentEventData = ev;
    let eventName = ev.name;
    if (!eventName || eventName === 'Tournament' || eventName === 'Tournament Details' || eventName === 'Unnamed Tournament') {
      eventName = ev.raw_json?.name || ev.event_name || 'Tournament Details';
    }
    const nameEl = document.getElementById('modal-event-name');
    if (nameEl) nameEl.innerText = eventName;

    const loc = [ev.city, ev.state, ev.country].filter(Boolean).join(', ') || 'Online / Unspecified';
    const dStr = (ev.event_date || '').slice(0, 10);
    eventMatchesCache = ev.matches || [];
    eventPlayersCache = ev.players || [];

    const numRounds = ev.num_rounds || (eventMatchesCache.length > 0 ? Math.max(...eventMatchesCache.map(m => m.round || 1)) : 0);
    const roundsPart = numRounds > 0 ? ` • 🔄 ${numRounds} Rounds` : '';
    const metaEl = document.getElementById('modal-event-meta');
    if (metaEl) metaEl.innerText = `📅 ${dStr} • 📍 ${loc}${roundsPart}`;

    const isTeamEvent = Boolean(ev.is_team_event || (ev.teams && ev.teams.length > 0));
    const isDoublesEvent = Boolean(ev.is_doubles_event);
    const teamsList = (ev.teams && ev.teams.length > 0) ? ev.teams : (ev.team_standings || []);

    const elPlayers = document.getElementById('event-modal-players');
    if (elPlayers) {
      if (isTeamEvent && teamsList.length > 0) {
        const teamCount = ev.total_teams || teamsList.length;
        const playerCount = ev.total_players || eventPlayersCache.length;
        const typeStr = isDoublesEvent ? 'Pairs' : 'Teams';
        elPlayers.innerText = `${teamCount} ${typeStr} (${playerCount} Players)`;
      } else {
        elPlayers.innerText = ev.total_players || eventPlayersCache.length || 0;
      }
    }
    const elRounds = document.getElementById('event-modal-rounds');
    if (elRounds) elRounds.innerText = ev.num_rounds || 0;
    const elMatches = document.getElementById('event-modal-matches');
    if (elMatches) elMatches.innerText = eventMatchesCache.length;

    const tabResultsCount = document.getElementById('event-tab-results-count');
    const tabEloCount = document.getElementById('event-tab-elo-count');
    const tabMatchesCount = document.getElementById('event-tab-matches-count');
    const tabTeamsCount = document.getElementById('event-tab-teams-count');
    const subtabTeams = document.getElementById('event-subtab-teams');

    const placementsCount = eventPlayersCache.filter(p => p.placement && p.placement > 0).length;
    if (tabResultsCount) tabResultsCount.innerText = placementsCount > 0 ? placementsCount : eventPlayersCache.length;
    if (tabEloCount) tabEloCount.innerText = eventPlayersCache.length;
    if (tabMatchesCount) tabMatchesCount.innerText = eventMatchesCache.length;

    const hasTeamPlacings = teamsList.some(t => t.placing && t.placing > 0);

    if (isTeamEvent || teamsList.length > 0) {
      if (subtabTeams) subtabTeams.style.setProperty('display', 'inline-flex', 'important');
      const labelSpan = document.getElementById('event-subtab-teams-label') || (subtabTeams && subtabTeams.querySelector('span:first-child'));
      if (labelSpan) {
        labelSpan.innerText = isDoublesEvent ? (hasTeamPlacings ? '🏆 Duo Placings' : '👥 Doubles Rosters') : (hasTeamPlacings ? '🏆 Team Placings' : '🛡️ Team Rosters');
      }
      if (tabTeamsCount) tabTeamsCount.innerText = teamsList.length;
      renderEventTeamsRows();
    } else {
      if (subtabTeams) subtabTeams.style.setProperty('display', 'none', 'important');
    }

    const resultsBtn = document.getElementById('event-subtab-results');
    const resultsSpan = resultsBtn && resultsBtn.querySelector('span:first-child');
    if (resultsSpan) {
      resultsSpan.innerText = isTeamEvent ? (placementsCount > 0 ? '👤 Player Placings' : '👤 Competitors') : (placementsCount > 0 ? '🏆 Results & Placings' : '👥 Registered Competitors');
    }

    const subtabEloInit = document.getElementById('event-subtab-elo');
    if (subtabEloInit) subtabEloInit.style.setProperty('display', 'none', 'important');

    // Check if event is concluded based on BCP's status.ended
    const isEnded = Boolean(
      ev?.ended === true ||
      ev?.is_ended === true ||
      ev?.status?.ended === true ||
      ev?.raw_json?.ended === true ||
      ev?.raw_json?.isEnded === true ||
      ev?.raw_json?.status?.ended === true ||
      userRegData?.ended === true ||
      userRegData?.is_ended === true ||
      userRegData?.status?.ended === true
    );

    const subtabPlayer = document.getElementById('event-subtab-player');
    const shouldShowPlayerTab = Boolean(userRegData && userRegData.is_registered && !isEnded);

    if (userRegData && userRegData.is_registered) {
      if (subtabPlayer) subtabPlayer.style.setProperty('display', shouldShowPlayerTab ? 'inline-flex' : 'none', 'important');
      currentEventRegistration = userRegData;
      if (shouldShowPlayerTab) {
        await populateEventPlayerDetails(userRegData);
      }

      // Harmonize current user player details into eventPlayersCache if present
      const pReg = userRegData.player || userRegData.player_registration;
      if (pReg && eventPlayersCache && eventPlayersCache.length > 0) {
        const regPid = String(pReg.player_id || pReg.bcp_player_id || '').trim();
        const regFn = String(pReg.first_name || (userRegData.user_profile && userRegData.user_profile.first_name) || '').trim().toLowerCase();
        const regLn = String(pReg.last_name || (userRegData.user_profile && userRegData.user_profile.last_name) || '').trim().toLowerCase();
        const regFullName = `${regFn} ${regLn}`.trim();

        const matchedCachePlayer = eventPlayersCache.find(p => {
          const pPid = String(p.player_id || p.bcp_player_id || '').trim();
          if (regPid && pPid && (regPid === pPid || pPid.includes(regPid) || regPid.includes(pPid))) return true;
          const pName = String(p.full_name || `${p.first_name || ''} ${p.last_name || ''}`).trim().toLowerCase();
          if (regFullName && pName && (regFullName === pName || pName.includes(regFullName))) return true;
          if (typeof currentUser !== 'undefined' && currentUser) {
            if (p.player_id && p.player_id === currentUser.player_id) return true;
            if (p.user_id && p.user_id === currentUser.id) return true;
            if (p.account_user_id && p.account_user_id === currentUser.id) return true;
          }
          return false;
        });

        if (matchedCachePlayer) {
          if (pReg.checked_in !== undefined && pReg.checked_in !== null) {
            matchedCachePlayer.checked_in = Boolean(pReg.checked_in);
          }
          if (pReg.dropped !== undefined && pReg.dropped !== null) {
            matchedCachePlayer.dropped = Boolean(pReg.dropped);
          }
          if (pReg.faction && (!matchedCachePlayer.faction || matchedCachePlayer.faction === 'Unknown')) {
            matchedCachePlayer.faction = pReg.faction;
          }
          if (pReg.detachment && (!matchedCachePlayer.detachment || matchedCachePlayer.detachment === 'Unknown')) {
            matchedCachePlayer.detachment = pReg.detachment;
          }
          if (pReg.army_list) {
            matchedCachePlayer.army_list = pReg.army_list;
          }
          if (pReg.has_list_submitted !== undefined) {
            matchedCachePlayer.has_list_submitted = Boolean(pReg.has_list_submitted);
          }
        }
      }
    } else {
      if (subtabPlayer) subtabPlayer.style.setProperty('display', 'none', 'important');
      if (currentEventModalTab === 'player') {
        currentEventModalTab = isTeamEvent ? 'teams' : 'results';
      }
    }

    // Determine target tab now that all event + registration state is known
    if (initialTab && initialTab !== 'elo' && (initialTab !== 'player' || shouldShowPlayerTab)) {
      switchEventModalTab(initialTab);
    } else if (shouldShowPlayerTab) {
      switchEventModalTab('player');
    } else if (isTeamEvent || teamsList.length > 0) {
      switchEventModalTab('teams');
    } else {
      switchEventModalTab('results');
    }

    renderEventResultsRows();
    renderEventEloRows();
    renderEventPairingsRows();
    updateEventModalTabCountsForSearch();

    if (rbody) rbody.style.opacity = '1';
    if (ebody) ebody.style.opacity = '1';
    if (pbody) pbody.style.opacity = '1';

    // Dismiss loading modal if it was open
    if (loadingModal) {
      loadingModal.style.display = 'none';
      loadingModal.classList.remove('active');
      loadingModal.style.removeProperty('z-index');
      if (typeof modalStack !== 'undefined') {
        modalStack = modalStack.filter(id => id !== 'event-details-loading-modal');
      }
      if (typeof window !== 'undefined' && window.modalStack) {
        window.modalStack = window.modalStack.filter(id => id !== 'event-details-loading-modal');
      }
    }

    // Now reveal event-modal in its final, non-shifting state!
    if (typeof bringModalToFront === 'function') {
      bringModalToFront(modal);
    } else {
      modal.classList.add('active');
    }

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

  } catch (err) {
    if (loadingModal) {
      loadingModal.style.display = 'none';
      loadingModal.classList.remove('active');
      loadingModal.style.removeProperty('z-index');
      if (typeof modalStack !== 'undefined') {
        modalStack = modalStack.filter(id => id !== 'event-details-loading-modal');
      }
      if (typeof window !== 'undefined' && window.modalStack) {
        window.modalStack = window.modalStack.filter(id => id !== 'event-details-loading-modal');
      }
    }
    if (typeof bringModalToFront === 'function') {
      bringModalToFront(modal);
    } else {
      modal.classList.add('active');
    }
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

function updateEventModalTabCountsForSearch() {
  const tabTeamsCount = document.getElementById('event-tab-teams-count');
  const tabResultsCount = document.getElementById('event-tab-results-count');
  const tabEloCount = document.getElementById('event-tab-elo-count');
  const tabMatchesCount = document.getElementById('event-tab-matches-count');

  const teams = (currentEventData && currentEventData.teams) || [];
  const standings = (currentEventData && currentEventData.team_standings) || [];
  const placementsCount = eventPlayersCache ? eventPlayersCache.filter(p => p.placement && p.placement > 0).length : 0;
  const totalPlayers = eventPlayersCache ? eventPlayersCache.length : 0;
  const totalMatches = eventMatchesCache ? eventMatchesCache.length : 0;
  const totalTeams = teams.length > 0 ? teams.length : standings.length;

  if (!eventModalSearchQuery) {
    if (tabTeamsCount) tabTeamsCount.innerText = totalTeams;
    if (tabResultsCount) tabResultsCount.innerText = placementsCount > 0 ? placementsCount : totalPlayers;
    if (tabEloCount) tabEloCount.innerText = totalPlayers;
    if (tabMatchesCount) tabMatchesCount.innerText = totalMatches;
    return;
  }

  const q = eventModalSearchQuery;
  let filteredTeamsCount = 0;
  if (teams.length > 0) {
    filteredTeamsCount = teams.filter(t => {
      const name = (t.name || '').toLowerCase();
      const cap = (t.captain_name || '').toLowerCase();
      if (name.includes(q) || cap.includes(q)) return true;
      if (t.members && Array.isArray(t.members)) {
        return t.members.some(m => {
          const mName = (m.full_name || (m.first_name ? `${m.first_name} ${m.last_name}` : '') || '').toLowerCase();
          const mFac = (m.faction || '').toLowerCase();
          return mName.includes(q) || mFac.includes(q);
        });
      }
      return false;
    }).length;
  } else {
    filteredTeamsCount = standings.filter(t => {
      const name = (t.name || '').toLowerCase();
      const captain = (t.captain || '').toLowerCase();
      return name.includes(q) || captain.includes(q);
    }).length;
  }

  const filteredPlayers = (eventPlayersCache || []).filter(p => {
    const name = (p.full_name || (p.first_name ? `${p.first_name} ${p.last_name}` : '') || '').toLowerCase();
    const fac = (p.faction || '').toLowerCase();
    const team = (p.team || '').toLowerCase();
    return name.includes(q) || fac.includes(q) || team.includes(q);
  });

  const filteredMatches = (eventMatchesCache || []).filter(m => {
    const p1Name = (m.player1_name || '').toLowerCase();
    const p2Name = (m.player2_name || '').toLowerCase();
    const p1Fac = (m.player1_faction || (eventPlayersCache && eventPlayersCache.find(p => p.player_id === m.player1_id || p.full_name === m.player1_name)?.faction) || '').toLowerCase();
    const p2Fac = (m.player2_faction || (eventPlayersCache && eventPlayersCache.find(p => p.player_id === m.player2_id || p.full_name === m.player2_name)?.faction) || '').toLowerCase();
    const p1Team = ((eventPlayersCache && eventPlayersCache.find(p => p.player_id === m.player1_id || p.full_name === m.player1_name)?.team) || '').toLowerCase();
    const p2Team = ((eventPlayersCache && eventPlayersCache.find(p => p.player_id === m.player2_id || p.full_name === m.player2_name)?.team) || '').toLowerCase();
    return p1Name.includes(q) || p2Name.includes(q) || p1Fac.includes(q) || p2Fac.includes(q) || p1Team.includes(q) || p2Team.includes(q);
  });

  if (tabTeamsCount) tabTeamsCount.innerText = filteredTeamsCount;
  if (tabResultsCount) tabResultsCount.innerText = filteredPlayers.length;
  if (tabEloCount) tabEloCount.innerText = filteredPlayers.length;
  if (tabMatchesCount) tabMatchesCount.innerText = filteredMatches.length;
}

function getEventModalCrossTabSuggestions(currentTab) {
  if (!eventModalSearchQuery) return '';
  const q = eventModalSearchQuery;
  const teams = (currentEventData && currentEventData.teams) || [];
  const standings = (currentEventData && currentEventData.team_standings) || [];
  const isDoubles = Boolean(currentEventData && currentEventData.is_doubles_event);
  const isTeam = Boolean(currentEventData && (currentEventData.is_team_event || teams.length > 0));

  let teamsMatchCount = 0;
  if (teams.length > 0) {
    teamsMatchCount = teams.filter(t => {
      const name = (t.name || '').toLowerCase();
      const cap = (t.captain_name || '').toLowerCase();
      if (name.includes(q) || cap.includes(q)) return true;
      if (t.members && Array.isArray(t.members)) {
        return t.members.some(m => {
          const mName = (m.full_name || (m.first_name ? `${m.first_name} ${m.last_name}` : '') || '').toLowerCase();
          const mFac = (m.faction || '').toLowerCase();
          return mName.includes(q) || mFac.includes(q);
        });
      }
      return false;
    }).length;
  } else {
    teamsMatchCount = standings.filter(t => (t.name || '').toLowerCase().includes(q) || (t.captain || '').toLowerCase().includes(q)).length;
  }

  const counts = {
    teams: teamsMatchCount,
    results: (eventPlayersCache || []).filter(p => {
      const name = (p.full_name || (p.first_name ? `${p.first_name} ${p.last_name}` : '') || '').toLowerCase();
      const fac = (p.faction || '').toLowerCase();
      const team = (p.team || '').toLowerCase();
      return name.includes(q) || fac.includes(q) || team.includes(q);
    }).length,
    elo: (eventPlayersCache || []).filter(p => {
      const name = (p.full_name || (p.first_name ? `${p.first_name} ${p.last_name}` : '') || '').toLowerCase();
      const fac = (p.faction || '').toLowerCase();
      const team = (p.team || '').toLowerCase();
      return name.includes(q) || fac.includes(q) || team.includes(q);
    }).length,
    matches: (eventMatchesCache || []).filter(m => {
      const p1Name = (m.player1_name || '').toLowerCase();
      const p2Name = (m.player2_name || '').toLowerCase();
      const p1Fac = (m.player1_faction || (eventPlayersCache && eventPlayersCache.find(p => p.player_id === m.player1_id || p.full_name === m.player1_name)?.faction) || '').toLowerCase();
      const p2Fac = (m.player2_faction || (eventPlayersCache && eventPlayersCache.find(p => p.player_id === m.player2_id || p.full_name === m.player2_name)?.faction) || '').toLowerCase();
      const p1Team = ((eventPlayersCache && eventPlayersCache.find(p => p.player_id === m.player1_id || p.full_name === m.player1_name)?.team) || '').toLowerCase();
      const p2Team = ((eventPlayersCache && eventPlayersCache.find(p => p.player_id === m.player2_id || p.full_name === m.player2_name)?.team) || '').toLowerCase();
      return p1Name.includes(q) || p2Name.includes(q) || p1Fac.includes(q) || p2Fac.includes(q) || p1Team.includes(q) || p2Team.includes(q);
    }).length
  };

  const teamLabel = isDoubles ? 'Doubles Rosters' : (isTeam ? 'Team Rosters' : 'Team Standings');
  const teamIcon = isDoubles ? '👥' : '🛡️';

  const tabsConfig = [
    { key: 'results', label: 'Standings & Competitors', icon: '🏆', count: counts.results },
    { key: 'matches', label: 'Match Pairings', icon: '⚔️', count: counts.matches },
    { key: 'teams', label: teamLabel, icon: teamIcon, count: counts.teams }
  ];

  const available = tabsConfig.filter(t => t.key !== currentTab && t.count > 0);
  if (available.length === 0) return '';

  let html = `
    <div style="margin-top:1rem; padding:0.75rem 0.85rem; background:rgba(56,189,248,0.06); border:1px solid rgba(56,189,248,0.22); border-radius:8px; display:block; width:100%; box-sizing:border-box; white-space:normal;">
      <div style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:0.6rem; line-height:1.4; white-space:normal;">
        Matches found in other tournament tabs for "<strong>${escapeHtml(q)}</strong>":
      </div>
      <div style="display:flex; flex-direction:column; gap:0.45rem;">
  `;

  available.forEach(t => {
    html += `
      <button type="button" class="btn btn-sm" onclick="switchEventModalTab('${t.key}')" style="background:#0284c7; color:#fff; font-size:0.8rem; padding:0.42rem 0.75rem; border-radius:6px; border:none; cursor:pointer; font-weight:600; display:flex; align-items:center; justify-content:center; gap:6px; width:100%; box-sizing:border-box; white-space:normal;">
        <span>${t.icon}</span> <span>Switch to ${t.label} (${t.count})</span>
      </button>
    `;
  });

  html += `</div></div>`;
  return html;
}

function handleEventModalSearch(query) {
  eventModalSearchQuery = (query || '').trim().toLowerCase();
  const clearBtn = document.getElementById('event-modal-search-clear');
  if (clearBtn) clearBtn.style.display = eventModalSearchQuery ? 'block' : 'none';

  updateEventModalTabCountsForSearch();

  if (currentEventModalTab === 'teams') {
    renderEventTeamsRows();
  } else if (currentEventModalTab === 'matches') {
    renderEventPairingsRows();
  } else if (currentEventModalTab === 'elo') {
    renderEventEloRows();
  } else {
    renderEventResultsRows();
  }
}

function clearEventModalSearch() {
  const input = document.getElementById('event-modal-search');
  if (input) input.value = '';
  handleEventModalSearch('');
  if (input) input.focus();
}

window.handleEventModalSearch = handleEventModalSearch;
window.clearEventModalSearch = clearEventModalSearch;

function switchEventModalTab(tabKey) {
  if (tabKey === 'elo') tabKey = 'results';
  const isEnded = Boolean(
    currentEventData?.ended === true ||
    currentEventData?.is_ended === true ||
    currentEventData?.status?.ended === true ||
    currentEventData?.raw_json?.ended === true ||
    currentEventData?.raw_json?.isEnded === true ||
    currentEventData?.raw_json?.status?.ended === true ||
    currentEventRegistration?.ended === true ||
    currentEventRegistration?.is_ended === true ||
    currentEventRegistration?.status?.ended === true
  );
  if (tabKey === 'player' && isEnded) {
    const isTeam = Boolean(currentEventData && (currentEventData.is_team_event || (currentEventData.teams && currentEventData.teams.length > 0)));
    tabKey = isTeam ? 'teams' : 'results';
  }
  currentEventModalTab = tabKey || 'results';
  const btnPlayer = document.getElementById('event-subtab-player');
  const btnTeams = document.getElementById('event-subtab-teams');
  const btnResults = document.getElementById('event-subtab-results');
  const btnElo = document.getElementById('event-subtab-elo');
  const btnMatches = document.getElementById('event-subtab-matches');
  const viewPlayer = document.getElementById('event-view-player');
  const viewTeams = document.getElementById('event-view-teams');
  const viewResults = document.getElementById('event-view-results');
  const viewElo = document.getElementById('event-view-elo');
  const viewMatches = document.getElementById('event-view-matches');
  const searchRow = document.getElementById('event-modal-search-row') || document.querySelector('.event-modal-search-wrap');

  [btnPlayer, btnTeams, btnResults, btnElo, btnMatches].forEach(b => b && b.classList.remove('active'));
  [viewPlayer, viewTeams, viewResults, viewElo, viewMatches].forEach(v => v && (v.style.display = 'none'));

  if (tabKey === 'player') {
    if (btnPlayer) btnPlayer.classList.add('active');
    if (viewPlayer) viewPlayer.style.display = 'block';
    if (searchRow) searchRow.style.display = 'none';
  } else {
    if (searchRow) searchRow.style.display = 'flex';
    if (tabKey === 'teams') {
      if (btnTeams) btnTeams.classList.add('active');
      if (viewTeams) viewTeams.style.display = 'block';
      renderEventTeamsRows();
    } else if (tabKey === 'matches') {
      if (btnMatches) btnMatches.classList.add('active');
      if (viewMatches) viewMatches.style.display = 'block';
      renderEventPairingsRows();
    } else {
      // default to 'results' tab (Standings & Competitors)
      if (btnResults) btnResults.classList.add('active');
      if (viewResults) viewResults.style.display = 'block';
      renderEventResultsRows();
    }
  }
  updateEventModalTabCountsForSearch();
}

function renderEventTeamsRows() {
  const container = document.getElementById('event-teams-container');
  const tableWrap = document.getElementById('event-teams-table-wrap');
  const tbody = document.getElementById('event-teams-body');

  const teams = (currentEventData && currentEventData.teams) || [];
  const standings = (currentEventData && currentEventData.team_standings) || [];
  const isDoubles = Boolean(currentEventData && currentEventData.is_doubles_event);
  const itemTypeSingular = isDoubles ? 'pair' : 'team';
  const itemTypePlural = isDoubles ? 'pairs' : 'teams';

  if (teams.length === 0 && standings.length === 0) {
    if (container) {
      container.style.display = 'block';
      container.innerHTML = `<div class="empty-state" style="padding:2.5rem 1rem; text-align:center; color:var(--text-muted);">No ${itemTypePlural} or rosters available for this tournament.</div>`;
    }
    if (tableWrap) tableWrap.style.display = 'none';
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No ${itemTypePlural} found.</td></tr>`;
    return;
  }

  // Branch 1: Modern rich Team/Doubles Roster Cards
  if (teams.length > 0) {
    if (tableWrap) tableWrap.style.display = 'none';
    if (container) container.style.display = 'flex';

    const summaryTextEl = document.getElementById('event-teams-summary-text');
    if (summaryTextEl) {
      summaryTextEl.innerText = `${teams.length} ${isDoubles ? 'Pairs' : 'Teams'} Registered (${(eventPlayersCache && eventPlayersCache.length) || 0} Competitors)`;
    }
    const btnToggleAll = document.getElementById('btn-toggle-all-teams');
    if (btnToggleAll) {
      allTeamsCollapsed = false;
      btnToggleAll.innerHTML = '⊟ Collapse All';
    }

    let filtered = teams;
    if (eventModalSearchQuery) {
      const q = eventModalSearchQuery;
      filtered = teams.filter(t => {
        const name = (t.name || '').toLowerCase();
        const captain = (t.captain_name || '').toLowerCase();
        if (name.includes(q) || captain.includes(q)) return true;
        if (t.members && Array.isArray(t.members)) {
          return t.members.some(m => {
            const mName = (m.full_name || (m.first_name ? `${m.first_name} ${m.last_name}` : '') || '').toLowerCase();
            const mFac = (m.faction || '').toLowerCase();
            return mName.includes(q) || mFac.includes(q);
          });
        }
        return false;
      });
    }

    const searchSummary = document.getElementById('event-modal-search-summary');
    if (searchSummary && currentEventModalTab === 'teams') {
      if (eventModalSearchQuery) {
        searchSummary.innerText = `Showing ${filtered.length} of ${teams.length} ${itemTypePlural}`;
        searchSummary.style.display = 'block';
      } else {
        searchSummary.style.display = 'none';
      }
    }

    if (filtered.length === 0) {
      const suggestions = getEventModalCrossTabSuggestions('teams');
      if (container) {
        container.innerHTML = `
          <div class="empty-state" style="padding:2.5rem 1rem; text-align:center;">
            <div style="font-size:1.05rem; font-weight:600; color:#fff;">🔍 No ${isDoubles ? 'Pairs' : 'Teams'} Found</div>
            <div style="margin-top:0.5rem; color:var(--text-secondary); font-size:0.86rem;">
              No ${itemTypePlural} match "<strong>${escapeHtml(eventModalSearchQuery)}</strong>" in this tournament.
            </div>
            ${suggestions}
          </div>
        `;
      }
      return;
    }

    const hasMatches = eventMatchesCache && eventMatchesCache.length > 0;
    const hasPlacings = eventPlayersCache && eventPlayersCache.some(p => p.placement && p.placement > 0);
    const isStarted = Boolean(hasPlacings || hasMatches);

    if (container) {
      container.innerHTML = '';
      filtered.forEach((t, idx) => {
        const card = document.createElement('div');
        card.className = 'team-roster-card';

        const hasTeamPlacings = Boolean(t.placing && t.placing > 0);
        let rankBadgeHtml = '';
        if (hasTeamPlacings) {
          const rankClass = t.placing === 1 ? 'rank-1' : t.placing === 2 ? 'rank-2' : t.placing === 3 ? 'rank-3' : '';
          rankBadgeHtml = `<div class="team-rank-badge ${rankClass}" title="Rank #${t.placing}">#${t.placing}</div>`;
        } else {
          rankBadgeHtml = `<div class="team-icon">${isDoubles ? '👥' : '🛡️'}</div>`;
        }

        const placingBadge = hasTeamPlacings
          ? `<span style="font-size:0.72rem; padding:2px 8px; border-radius:12px; background:rgba(234,179,8,0.16); color:#facc15; border:1px solid rgba(234,179,8,0.32); font-weight:700;">Rank #${t.placing}</span>`
          : '';
        const pointsBadge = (isStarted && t.points != null && Number(t.points) > 0)
          ? `<span style="font-size:0.72rem; padding:2px 8px; border-radius:12px; background:rgba(56,189,248,0.15); color:#38bdf8; border:1px solid rgba(56,189,248,0.3); font-weight:600;">${t.points} pts</span>`
          : '';

        // Standings stats pills
        const winsPill = (t.wins != null)
          ? `<span style="font-size:0.72rem; padding:1px 7px; border-radius:10px; background:rgba(34,197,94,0.16); color:#4ade80; border:1px solid rgba(34,197,94,0.3); font-weight:700;">${t.wins}W</span>`
          : '';
        const matchPtsPill = (t.match_points != null)
          ? `<span style="font-size:0.72rem; padding:1px 7px; border-radius:10px; background:rgba(56,189,248,0.14); color:#38bdf8; border:1px solid rgba(56,189,248,0.28); font-weight:700;">${t.match_points} MP</span>`
          : '';
        const battlePtsPill = (t.battle_points != null && Number(t.battle_points) > 0)
          ? `<span style="font-size:0.72rem; padding:1px 7px; border-radius:10px; background:rgba(255,255,255,0.06); color:#f1f5f9; border:1px solid rgba(255,255,255,0.12); font-weight:700;">${t.battle_points} BP</span>`
          : '';

        // Round by round scores (matching BCP Placings view)
        let roundScoresHtml = '';
        if (t.games && Array.isArray(t.games) && t.games.length > 0) {
          const pills = t.games.map(g => {
            const isWin = g.result === 2;
            const isLoss = g.result === 0;
            const bg = isWin ? 'rgba(34,197,94,0.18)' : isLoss ? 'rgba(239,68,68,0.18)' : 'rgba(245,158,11,0.18)';
            const color = isWin ? '#4ade80' : isLoss ? '#f87171' : '#fbbf24';
            const border = isWin ? 'rgba(34,197,94,0.3)' : isLoss ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)';
            return `<span style="padding:1px 6px; border-radius:4px; background:${bg}; color:${color}; border:1px solid ${border}; font-weight:700; font-size:0.74rem;" title="Round ${g.round}: ${g.points} pts (${isWin ? 'Win' : isLoss ? 'Loss' : 'Draw'})">${g.points}</span>`;
          }).join('<span style="color:rgba(255,255,255,0.2); font-size:0.7rem; margin:0 2px;">/</span>');
          roundScoresHtml = `
            <div style="display:flex; align-items:center; gap:3px; margin-top:5px; font-family:var(--font-mono, monospace); flex-wrap:wrap;">
              <span style="color:var(--text-muted, #94a3b8); font-size:0.7rem; font-family:var(--font-sans, sans-serif); margin-right:3px;">Rounds:</span>
              ${pills}
            </div>
          `;
        }

        const checkinBadge = t.checked_in
          ? `<span style="display:inline-flex; align-items:center; gap:4px; font-size:0.72rem; padding:3px 8px; border-radius:6px; background:rgba(34,197,94,0.15); color:#4ade80; border:1px solid rgba(34,197,94,0.3); font-weight:600;">✓ Checked In</span>`
          : `<span style="display:inline-flex; align-items:center; gap:4px; font-size:0.72rem; padding:3px 8px; border-radius:6px; background:rgba(148,163,184,0.1); color:#94a3b8; border:1px solid rgba(148,163,184,0.2); font-weight:500;">Awaiting Check-in</span>`;

        const avgEloVal = t.avg_elo ? Math.round(t.avg_elo) : 1500;
        const avgEloBadge = `
          <div style="text-align:right; background:rgba(0,0,0,0.3); padding:3px 9px; border-radius:6px; border:1px solid rgba(255,255,255,0.08);">
            <div style="font-size:0.62rem; text-transform:uppercase; color:var(--text-muted, #94a3b8); font-weight:700; letter-spacing:0.04em;">${isDoubles ? 'Duo Avg Elo' : 'Team Avg Elo'}</div>
            <div style="font-size:0.92rem; font-weight:800; font-family:var(--font-mono, monospace);" class="elo-badge ${getEloBadgeClass(avgEloVal)}">${avgEloVal}</div>
          </div>
        `;

        const totalScoreBadge = (isStarted && t.battle_points != null && Number(t.battle_points) > 0)
          ? `
            <div style="text-align:right; background:rgba(0,0,0,0.3); padding:3px 9px; border-radius:6px; border:1px solid rgba(255,255,255,0.08);">
              <div style="font-size:0.62rem; text-transform:uppercase; color:var(--text-muted, #94a3b8); font-weight:700; letter-spacing:0.04em;">TOTAL SCORE</div>
              <div style="font-size:0.92rem; font-weight:800; font-family:var(--font-mono, monospace); color:var(--accent, #38bdf8);">${t.battle_points} <span style="font-size:0.68rem; font-weight:600; color:var(--text-muted);">pts</span></div>
            </div>
          `
          : checkinBadge;

        const members = t.members || [];
        const memberRowsHtml = members.map((m, mIdx) => {
          const mName = escapeHtml(m.full_name || (m.first_name ? `${m.first_name} ${m.last_name}` : '') || 'Competitor');
          const mFac = escapeHtml(m.faction || 'Unknown');
          const mElo = m.current_elo ? Math.round(m.current_elo) : 1500;
          const mBadge = getEloBadgeClass(mElo);
          const isCap = Boolean(m.is_captain);

          const capTag = isCap
            ? `<span class="badge team-captain-badge" style="font-size:0.65rem; padding:1px 6px; border-radius:4px; background:rgba(234,179,8,0.2); color:#facc15; font-weight:700; border:1px solid rgba(234,179,8,0.35); margin-left:6px; flex-shrink:0;">👑 CAPTAIN</span>`
            : '';

          const memberPlacingTag = (m.placement && m.placement > 0)
            ? `<span style="font-size:0.72rem; font-weight:800; font-family:var(--font-mono, monospace); color:#facc15; background:rgba(234,179,8,0.15); border:1px solid rgba(234,179,8,0.3); padding:1px 5px; border-radius:4px; margin-right:4px;" title="Individual Placing #${m.placement}">#${m.placement}</span>`
            : '';

          const checkinTag = m.checked_in != null
            ? `<span style="font-size:0.72rem; color:${m.checked_in ? 'var(--win, #22c55e)' : 'var(--text-muted, #94a3b8)'}; font-weight:600;">${m.checked_in ? '✅ Ready' : '📋 Enrolled'}</span>`
            : '';

          let col3Html = '';
          let col4Html = '';
          if (isStarted) {
            const recStr = m.event_wins != null ? `${m.event_wins}W - ${m.event_losses || 0}L` : '';
            const bpStr = m.event_battle_points != null ? `(${m.event_battle_points} pts)` : '';
            col3Html = `
              <div class="team-member-col-record" style="text-align:right; font-family:var(--font-mono, monospace); font-size:0.8rem; font-weight:700; color:var(--win, #22c55e); white-space:nowrap;">
                ${recStr} <span style="color:var(--text-muted, #94a3b8); font-size:0.74rem; font-weight:600;">${bpStr}</span>
              </div>
            `;
            col4Html = `
              <div class="team-member-col-elo team-col-checkin" style="text-align:right;">
                <span class="elo-badge ${mBadge}" style="font-size:0.82rem; font-weight:700; padding:2px 7px;">${mElo}</span>
              </div>
            `;
          } else {
            col3Html = `
              <div class="team-member-col-record" style="text-align:right;">
                <span class="elo-badge ${mBadge}" style="font-size:0.82rem; font-weight:700; padding:2px 7px;">${mElo}</span>
              </div>
            `;
            col4Html = `
              <div class="team-member-col-elo team-col-checkin" style="text-align:right;">
                ${checkinTag}
              </div>
            `;
          }

          return `
            <div class="team-member-grid" style="border-bottom:${mIdx < members.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none'}; background:${mIdx % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent'};">
              <div class="team-member-col-name" style="display:flex; align-items:center; gap:0.45rem; min-width:0;">
                <span style="font-size:0.85rem; width:16px; text-align:center; flex-shrink:0;">${isCap ? '👑' : '<span style="color:var(--text-muted, #64748b);">•</span>'}</span>
                ${memberPlacingTag}
                <a href="javascript:void(0)" onclick="event.stopPropagation(); openPlayerModal('${escapeHtml(m.player_id || '')}')" style="font-weight:600; font-size:0.88rem; color:#38bdf8; text-decoration:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
                  ${mName}
                </a>
                ${capTag}
              </div>

              <div class="team-member-col-faction" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                <span class="badge" style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); font-size:0.75rem; color:#cbd5e1; padding:2px 8px; border-radius:4px;" title="${mFac}">
                  ${mFac}
                </span>
              </div>

              ${col3Html}
              ${col4Html}
            </div>
          `;
        }).join('');

        card.innerHTML = `
          <!-- Card Header -->
          <div class="team-roster-header" onclick="toggleTeamRosterCard('${idx}')">
            <div class="team-header-main">
              <span id="team-chevron-${idx}" class="team-chevron">▼</span>
              ${rankBadgeHtml}
              <div class="team-info">
                <div class="team-title-row">
                  <span class="team-name">${escapeHtml(t.name || 'Team')}</span>
                  ${winsPill}
                  ${matchPtsPill}
                  ${battlePtsPill}
                </div>
                <div class="team-meta-row">
                  ${t.captain_name ? `<span>👑 Captain:&nbsp;<strong style="color:#f1f5f9;">${escapeHtml(t.captain_name)}</strong></span><span>•</span>` : ''}
                  <span>${members.length} ${isDoubles ? 'Players (Duo)' : 'Competitors'}</span>
                  ${t.game_wins != null ? `<span>•</span><span>🎮 <strong>${t.game_wins}</strong> Game Wins</span>` : ''}
                </div>
                ${roundScoresHtml}
              </div>
            </div>

            <div class="team-header-badges">
              ${avgEloBadge}
              ${totalScoreBadge}
            </div>
          </div>

          <!-- Members Roster -->
          <div id="team-members-${idx}" class="team-members-container" style="display:flex; flex-direction:column;">
            <div class="team-member-header">
              <div>Competitor</div>
              <div>Faction</div>
              <div style="text-align:right;">${isStarted ? 'Record / Pts' : 'Elo Rating'}</div>
              <div class="team-col-checkin" style="text-align:right;">${isStarted ? 'Elo Rating' : 'Check-in'}</div>
            </div>
            ${memberRowsHtml || '<div style="padding:0.75rem 1rem; color:var(--text-muted); font-size:0.8rem;">No members listed for this team yet.</div>'}
          </div>
        `;

        container.appendChild(card);
      });

      // Unassigned players if any
      const unassigned = currentEventData.unassigned_players || [];
      if (unassigned.length > 0 && !eventModalSearchQuery) {
        const uCard = document.createElement('div');
        uCard.className = 'team-roster-card unassigned-roster';
        uCard.style.background = 'rgba(255,255,255,0.02)';
        uCard.style.border = '1px dashed var(--border, #334155)';
        uCard.style.marginTop = '0.5rem';

        const uRowsHtml = unassigned.map((m, mIdx) => {
          const mName = escapeHtml(m.full_name || (m.first_name ? `${m.first_name} ${m.last_name}` : '') || 'Competitor');
          const mFac = escapeHtml(m.faction || 'Unknown');
          const mElo = m.current_elo ? Math.round(m.current_elo) : 1500;
          return `
            <div class="team-member-grid" style="border-bottom:${mIdx < unassigned.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none'};">
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <span style="color:var(--text-muted);">•</span>
                <a href="javascript:void(0)" onclick="event.stopPropagation(); openPlayerModal('${escapeHtml(m.player_id || '')}')" style="font-weight:600; color:#38bdf8; text-decoration:none;">${mName}</a>
              </div>
              <div><span class="badge" style="background:var(--bg-card); border:1px solid var(--border); font-size:0.72rem;">${mFac}</span></div>
              <div style="text-align:right;"><span class="elo-badge ${getEloBadgeClass(mElo)}" style="font-size:0.78rem;">${mElo}</span></div>
              <div class="team-col-checkin" style="text-align:right;"><span style="color:var(--text-muted); font-size:0.72rem;">Unassigned</span></div>
            </div>
          `;
        }).join('');

        uCard.innerHTML = `
          <div style="padding:0.6rem 1rem; background:rgba(255,255,255,0.03); border-bottom:1px dashed var(--border, #334155); font-size:0.82rem; font-weight:700; color:var(--text-secondary);">
            📋 Unassigned Competitors (${unassigned.length})
          </div>
          <div style="display:flex; flex-direction:column;">
            ${uRowsHtml}
          </div>
        `;
        container.appendChild(uCard);
      }
    }
    return;
  }

  // Branch 2: Fallback for legacy simple team_standings table
  if (container) container.style.display = 'none';
  if (tableWrap) tableWrap.style.display = 'block';

  let filtered = standings;
  if (eventModalSearchQuery) {
    filtered = standings.filter(t => {
      const name = (t.name || '').toLowerCase();
      const captain = (t.captain || '').toLowerCase();
      return name.includes(eventModalSearchQuery) || captain.includes(eventModalSearchQuery);
    });
  }

  const searchSummary = document.getElementById('event-modal-search-summary');
  if (searchSummary && currentEventModalTab === 'teams') {
    if (eventModalSearchQuery) {
      searchSummary.innerText = `Showing ${filtered.length} of ${standings.length} teams`;
      searchSummary.style.display = 'block';
    } else {
      searchSummary.style.display = 'none';
    }
  }

  if (filtered.length === 0) {
    const suggestions = getEventModalCrossTabSuggestions('teams');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="empty-state" style="padding:2.5rem 1rem;">
            <div style="font-size:1.05rem; font-weight:600; color:#fff;">🔍 No Teams Found</div>
            <div style="margin-top:0.5rem; color:var(--text-secondary); font-size:0.86rem;">
              No teams match "<strong>${escapeHtml(eventModalSearchQuery)}</strong>" in this tournament.
            </div>
            ${suggestions}
          </td>
        </tr>`;
    }
    return;
  }

  if (tbody) {
    tbody.innerHTML = '';
    filtered.forEach((t, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="rank-cell">#${t.placing && t.placing > 0 ? t.placing : (idx + 1)}</td>
        <td style="font-weight:700; color:var(--text-primary);">${escapeHtml(t.name || 'Team')}</td>
        <td style="color:var(--text-muted);">${escapeHtml(t.captain || '-')}</td>
        <td style="font-family:var(--font-mono); font-weight:700; color:var(--win); font-size:0.95rem;">${t.match_points != null ? t.match_points : '-'} pts</td>
        <td style="font-family:var(--font-mono); font-weight:600; color:var(--text-secondary);">${t.game_wins != null ? t.game_wins : '-'}</td>
        <td style="font-family:var(--font-mono); font-weight:700; color:var(--accent);">${t.battle_points != null ? t.battle_points : '-'} pts</td>
      `;
      tbody.appendChild(tr);
    });
  }
}

let allTeamsCollapsed = false;

function toggleTeamRosterCard(idx) {
  const membersEl = document.getElementById(`team-members-${idx}`);
  const chevronEl = document.getElementById(`team-chevron-${idx}`);
  if (!membersEl) return;
  const isHidden = membersEl.style.display === 'none';
  membersEl.style.display = isHidden ? 'flex' : 'none';
  if (chevronEl) {
    chevronEl.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
  }
}

function toggleAllTeamCards() {
  allTeamsCollapsed = !allTeamsCollapsed;
  const btn = document.getElementById('btn-toggle-all-teams');
  if (btn) {
    btn.innerHTML = allTeamsCollapsed ? '⊞ Expand All' : '⊟ Collapse All';
  }
  const memberContainers = document.querySelectorAll('.team-members-container');
  memberContainers.forEach(container => {
    container.style.display = allTeamsCollapsed ? 'none' : 'flex';
  });
  const chevrons = document.querySelectorAll('[id^="team-chevron-"]');
  chevrons.forEach(ch => {
    ch.style.transform = allTeamsCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
  });
}

function renderEventResultsRows() {
  const tbody = document.getElementById('event-results-body');
  if (!tbody) return;

  if (!eventPlayersCache || eventPlayersCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No registered competitors found for this tournament yet.</td></tr>';
    return;
  }

  const eventHasAnyMatches = Boolean(
    (eventMatchesCache && eventMatchesCache.length > 0) ||
    (eventPlayersCache && eventPlayersCache.some(p => (p.event_matches_count && p.event_matches_count > 0) || (p.event_wins && p.event_wins > 0) || (p.event_losses && p.event_losses > 0)))
  );
  const isStarted = eventHasAnyMatches;

  // Sorting
  const sortCfg = (typeof currentSort !== 'undefined' && currentSort['event-results']) || {
    field: isStarted ? 'placement' : 'current_elo',
    asc: isStarted ? true : false
  };

  if (sortCfg.field === 'placement' || sortCfg.field === 'rank') {
    eventPlayersCache.sort((a, b) => {
      const plA = (a.placement && a.placement > 0) ? a.placement : 999999;
      const plB = (b.placement && b.placement > 0) ? b.placement : 999999;
      if (plA !== plB) return sortCfg.asc ? (plA - plB) : (plB - plA);
      return (Number(b.current_elo || 1500) - Number(a.current_elo || 1500));
    });
  } else if (sortCfg.field === 'current_elo') {
    eventPlayersCache.sort((a, b) => {
      const eloA = Number(a.current_elo || 1500);
      const eloB = Number(b.current_elo || 1500);
      return sortCfg.asc ? (eloA - eloB) : (eloB - eloA);
    });
  } else if (typeof sortClientArray === 'function') {
    eventPlayersCache = sortClientArray(eventPlayersCache, sortCfg.field, sortCfg.asc);
  }

  let playersToRender = eventPlayersCache;
  if (eventModalSearchQuery) {
    playersToRender = eventPlayersCache.filter(p => {
      const name = (p.full_name || (p.first_name ? `${p.first_name} ${p.last_name}` : '') || '').toLowerCase();
      const fac = (p.faction || '').toLowerCase();
      const team = (p.team || '').toLowerCase();
      return name.includes(eventModalSearchQuery) || fac.includes(eventModalSearchQuery) || team.includes(eventModalSearchQuery);
    });
  }

  const searchSummary = document.getElementById('event-modal-search-summary');
  if (searchSummary && currentEventModalTab === 'results') {
    if (eventModalSearchQuery) {
      searchSummary.innerText = `Showing ${playersToRender.length} of ${eventPlayersCache.length} competitors`;
      searchSummary.style.display = 'block';
    } else {
      searchSummary.style.display = 'none';
    }
  }

  if (playersToRender.length === 0) {
    const suggestions = getEventModalCrossTabSuggestions('results');
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state" style="padding:2.5rem 1rem;">
          <div style="font-size:1.05rem; font-weight:600; color:#fff;">🔍 No Results Found</div>
          <div style="margin-top:0.5rem; color:var(--text-secondary); font-size:0.86rem;">
            No competitors match "<strong>${escapeHtml(eventModalSearchQuery)}</strong>" in this tournament.
          </div>
          ${suggestions}
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = '';
  playersToRender.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.onclick = (e) => { e.stopPropagation(); openPlayerModal(p.player_id); };

    const eloBadgeClass = getEloBadgeClass(p.current_elo);
    const avgScore = (p.event_battle_points / (p.event_matches_count || 1)).toFixed(1);
    const teamHtml = p.team ? `<span style="font-size:0.75rem; color:var(--text-muted); margin-left:6px; font-weight:400;">• ${escapeHtml(p.team)}</span>` : '';
    const drawStr = p.event_draws ? ` - ${p.event_draws}D` : '';

    const hasPlacement = Boolean(p.placement && p.placement > 0);
    const hasMatchesPlayed = Boolean(eventHasAnyMatches && ((p.event_matches_count && p.event_matches_count > 0) || (p.event_wins && p.event_wins > 0) || (p.event_losses && p.event_losses > 0)));

    const rankDisplay = (hasMatchesPlayed && hasPlacement)
      ? `#${p.placement}`
      : (hasMatchesPlayed && p.rank && p.rank > 0 ? `#${p.rank}` : '-');

    const recordDisplay = hasMatchesPlayed
      ? `<td style="font-family:var(--font-mono); font-weight:700; color:var(--win); font-size:0.95rem;">
          ${p.event_wins || 0}W - ${p.event_losses || 0}L${drawStr}
        </td>`
      : `<td>
          ${p.dropped
            ? '<span style="color:var(--loss); font-size:0.85rem;">🚫 Dropped</span>'
            : (isStarted
                ? (p.checked_in ? '<span style="color:var(--win); font-weight:600; font-size:0.85rem;">📋 0 Matches</span>' : '<span style="color:var(--text-muted); font-size:0.85rem;">⚠️ Not Checked In</span>')
                : (p.checked_in ? '<span style="color:var(--win); font-weight:600; font-size:0.85rem;">✅ Checked In</span>' : '<span style="color:var(--text-muted); font-size:0.85rem;">⚠️ Not Checked In</span>')
              )
          }
        </td>`;

    const pointsDisplay = hasMatchesPlayed
      ? `<td style="font-family:var(--font-mono); font-weight:700; color:var(--accent);">
          ${p.event_battle_points || 0} pts <span style="font-size:0.75rem; color:var(--text-muted);">(${avgScore}/g)</span>
        </td>`
      : `<td style="color:var(--text-muted); font-family:var(--font-mono);">-</td>`;

    tr.innerHTML = `
      <td class="rank-cell">${rankDisplay}</td>
      <td>
        <div class="player-name-cell">
          <span class="player-link">${escapeHtml(p.full_name || 'Player')}</span>
          ${teamHtml}
        </div>
      </td>
      <td>
        <span class="badge" style="background:var(--bg-card); border:1px solid var(--border);">${escapeHtml(p.faction || 'Unknown')}${p.detachment ? `<span style="color:var(--text-muted); font-weight:400;"> (${escapeHtml(p.detachment)})</span>` : ''}</span>
      </td>
      ${recordDisplay}
      ${pointsDisplay}
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

  // Sort players descending by current Elo
  const sorted = [...eventPlayersCache].sort((a, b) => (b.current_elo || 1500) - (a.current_elo || 1500));

  let playersToRender = sorted;
  if (eventModalSearchQuery) {
    playersToRender = sorted.filter(p => {
      const name = (p.full_name || (p.first_name ? `${p.first_name} ${p.last_name}` : '') || '').toLowerCase();
      const fac = (p.faction || '').toLowerCase();
      const team = (p.team || '').toLowerCase();
      return name.includes(eventModalSearchQuery) || fac.includes(eventModalSearchQuery) || team.includes(eventModalSearchQuery);
    });
  }

  const searchSummary = document.getElementById('event-modal-search-summary');
  if (searchSummary && currentEventModalTab === 'elo') {
    if (eventModalSearchQuery) {
      searchSummary.innerText = `Showing ${playersToRender.length} of ${sorted.length} competitors`;
      searchSummary.style.display = 'block';
    } else {
      searchSummary.style.display = 'none';
    }
  }

  if (playersToRender.length === 0) {
    const suggestions = getEventModalCrossTabSuggestions('elo');
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-state" style="padding:2.5rem 1rem;">
          <div style="font-size:1.05rem; font-weight:600; color:#fff;">🔍 No Competitors Found</div>
          <div style="margin-top:0.5rem; color:var(--text-secondary); font-size:0.86rem;">
            No competitors match "<strong>${escapeHtml(eventModalSearchQuery)}</strong>" in this tournament.
          </div>
          ${suggestions}
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = '';
  playersToRender.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.onclick = (e) => { e.stopPropagation(); openPlayerModal(p.player_id); };

    const eloBadgeClass = getEloBadgeClass(p.current_elo);
    const teamHtml = p.team ? `<span style="font-size:0.75rem; color:var(--text-muted); margin-left:6px; font-weight:400;">• ${escapeHtml(p.team)}</span>` : '';

    tr.innerHTML = `
      <td class="rank-cell">#${idx + 1}</td>
      <td>
        <div class="player-name-cell">
          <span class="player-link">${escapeHtml(p.full_name || (p.first_name + ' ' + p.last_name))}</span>
          ${teamHtml}
        </div>
      </td>
      <td>
        <span class="badge" style="background:var(--bg-card); border:1px solid var(--border);">${escapeHtml(p.faction || 'Unknown')}${p.detachment ? `<span style="color:var(--text-muted); font-weight:400;"> (${escapeHtml(p.detachment)})</span>` : ''}</span>
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
  let matchesToRender = selectedEventRound === 'all' 
    ? eventMatchesCache 
    : eventMatchesCache.filter(m => (m.round || 1) === Number(selectedEventRound));

  // 3. Filter matches by search query (players, teams, factions)
  if (eventModalSearchQuery) {
    matchesToRender = matchesToRender.filter(m => {
      const p1Name = (m.player1_name || '').toLowerCase();
      const p2Name = (m.player2_name || '').toLowerCase();
      const p1Fac = (m.player1_faction || eventPlayersCache.find(p => p.player_id === m.player1_id || p.full_name === m.player1_name)?.faction || '').toLowerCase();
      const p2Fac = (m.player2_faction || eventPlayersCache.find(p => p.player_id === m.player2_id || p.full_name === m.player2_name)?.faction || '').toLowerCase();
      const p1Team = (eventPlayersCache.find(p => p.player_id === m.player1_id || p.full_name === m.player1_name)?.team || '').toLowerCase();
      const p2Team = (eventPlayersCache.find(p => p.player_id === m.player2_id || p.full_name === m.player2_name)?.team || '').toLowerCase();
      return p1Name.includes(eventModalSearchQuery) ||
             p2Name.includes(eventModalSearchQuery) ||
             p1Fac.includes(eventModalSearchQuery) ||
             p2Fac.includes(eventModalSearchQuery) ||
             p1Team.includes(eventModalSearchQuery) ||
             p2Team.includes(eventModalSearchQuery);
    });
  }

  const searchSummary = document.getElementById('event-modal-search-summary');
  if (searchSummary && currentEventModalTab === 'matches') {
    if (eventModalSearchQuery) {
      searchSummary.innerText = `Showing ${matchesToRender.length} of ${eventMatchesCache.length} pairings`;
      searchSummary.style.display = 'block';
    } else {
      searchSummary.style.display = 'none';
    }
  }

  if (matchesToRender.length === 0) {
    const suggestions = getEventModalCrossTabSuggestions('matches');
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state" style="padding:2.5rem 1rem;">
          <div style="font-size:1.05rem; font-weight:600; color:#fff;">🔍 No Matching Match Pairings</div>
          <div style="margin-top:0.5rem; color:var(--text-secondary); font-size:0.86rem;">
            No match pairings match "<strong>${escapeHtml(eventModalSearchQuery)}</strong>"${selectedEventRound !== 'all' ? ` in Round ${selectedEventRound}` : ''}.
          </div>
          ${suggestions}
        </td>
      </tr>`;
    return;
  }

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

    const p1Faction = m.player1_faction || eventPlayersCache.find(p => p.player_id === m.player1_id || p.full_name === m.player1_name)?.faction || '';
    const p2Faction = m.player2_faction || eventPlayersCache.find(p => p.player_id === m.player2_id || p.full_name === m.player2_name)?.faction || '';

    // Permission checks: Is current logged-in user Player 1, Player 2, or Staff (Admin/TO/Referee)?
    const u = (typeof authState !== 'undefined' && authState && authState.user) ||
              (typeof currentUser !== 'undefined' ? currentUser : null) ||
              (typeof window !== 'undefined' ? window.currentUser : null);

    // Collect all candidate names for logged-in user
    const userNames = [];
    if (u) {
      [
        u.display_name,
        u.competitor_name,
        u.full_name,
        u.name,
        u.username,
        (u.first_name || u.firstName) ? `${u.first_name || u.firstName} ${u.last_name || u.lastName || ''}` : '',
        (u.lastName) ? `${u.firstName || ''} ${u.lastName}` : ''
      ].forEach(n => {
        if (n && typeof n === 'string' && n.trim()) {
          userNames.push(n.trim().toLowerCase());
        }
      });
    }
    if (typeof currentEventRegistration !== 'undefined' && currentEventRegistration && currentEventRegistration.is_registered) {
      const preg = currentEventRegistration.player_registration || {};
      const uprof = currentEventRegistration.user_profile || {};
      [
        preg.full_name,
        preg.name,
        preg.first_name ? `${preg.first_name} ${preg.last_name || ''}` : '',
        uprof.display_name,
        uprof.first_name ? `${uprof.first_name} ${uprof.last_name || ''}` : ''
      ].forEach(n => {
        if (n && typeof n === 'string' && n.trim()) {
          userNames.push(n.trim().toLowerCase());
        }
      });
    }

    // Collect all candidate IDs for logged-in user
    const userIds = [];
    if (u) {
      [u.player_id, u.bcp_user_id, u.bcp_id, u.id, u.sub, u.userId].forEach(id => {
        if (id && typeof id === 'string' && id.trim()) {
          userIds.push(id.trim().toLowerCase());
        }
      });
    }
    if (typeof currentEventRegistration !== 'undefined' && currentEventRegistration && currentEventRegistration.is_registered) {
      const preg = currentEventRegistration.player_registration || {};
      const uprof = currentEventRegistration.user_profile || {};
      [preg.player_id, preg.id, preg.userId, preg.user_id, uprof.bcp_user_id, uprof.id].forEach(id => {
        if (id && typeof id === 'string' && id.trim()) {
          userIds.push(id.trim().toLowerCase());
        }
      });
    }

    // Collect all candidate emails for logged-in user
    const userEmails = [];
    if (u) {
      [u.email, u.bcp_email].forEach(em => {
        if (em && typeof em === 'string' && em.trim()) {
          userEmails.push(em.trim().toLowerCase());
        }
      });
    }
    if (typeof currentEventRegistration !== 'undefined' && currentEventRegistration && currentEventRegistration.is_registered) {
      const preg = currentEventRegistration.player_registration || {};
      const uprof = currentEventRegistration.user_profile || {};
      [preg.email, uprof.email].forEach(em => {
        if (em && typeof em === 'string' && em.trim()) {
          userEmails.push(em.trim().toLowerCase());
        }
      });
    }

    function checkNameMatch(candidate, target) {
      if (!candidate || !target) return false;
      const c = candidate.trim().toLowerCase();
      const t = target.trim().toLowerCase();
      if (c === t) return true;
      if (c.replace(/\s+/g, '') === t.replace(/\s+/g, '')) return true;
      return false;
    }

    const p1NameClean = (m.player1_name || '').trim().toLowerCase();
    const p2NameClean = (m.player2_name || '').trim().toLowerCase();
    const p1IdClean = (m.player1_id || '').trim().toLowerCase();
    const p2IdClean = (m.player2_id || '').trim().toLowerCase();

    // Look up cached player records in roster
    const allRosterPlayers = [
      ...(Array.isArray(eventPlayersCache) ? eventPlayersCache : []),
      ...((currentEventData && Array.isArray(currentEventData.players)) ? currentEventData.players : []),
      ...((currentEventData && Array.isArray(currentEventData.roster)) ? currentEventData.roster : [])
    ];

    const p1Record = allRosterPlayers.find(p => {
      if (!p) return false;
      const pid = String(p.player_id || p.id || p.user_id || p.userId || '').trim().toLowerCase();
      if (p1IdClean && pid && pid === p1IdClean) return true;
      const pname = String(p.full_name || p.name || p.player_name || '').trim().toLowerCase();
      if (p1NameClean && pname && checkNameMatch(pname, p1NameClean)) return true;
      return false;
    });

    const p2Record = allRosterPlayers.find(p => {
      if (!p) return false;
      const pid = String(p.player_id || p.id || p.user_id || p.userId || '').trim().toLowerCase();
      if (p2IdClean && pid && pid === p2IdClean) return true;
      const pname = String(p.full_name || p.name || p.player_name || '').trim().toLowerCase();
      if (p2NameClean && pname && checkNameMatch(pname, p2NameClean)) return true;
      return false;
    });

    function recordMatchesUser(rec) {
      if (!rec) return false;
      const recIds = [rec.player_id, rec.id, rec.user_id, rec.userId].filter(Boolean).map(x => String(x).trim().toLowerCase());
      if (recIds.some(id => userIds.includes(id))) return true;
      const recEmail = String(rec.email || '').trim().toLowerCase();
      if (recEmail && userEmails.includes(recEmail)) return true;
      const recName = String(rec.full_name || rec.name || rec.player_name || '').trim().toLowerCase();
      if (recName && userNames.some(un => checkNameMatch(un, recName))) return true;
      return false;
    }

    const isP1 = Boolean(u && (
      (p1IdClean && userIds.includes(p1IdClean)) ||
      (p1NameClean && userNames.some(un => checkNameMatch(un, p1NameClean))) ||
      recordMatchesUser(p1Record)
    ));

    const isP2 = Boolean(u && (
      (p2IdClean && userIds.includes(p2IdClean)) ||
      (p2NameClean && userNames.some(un => checkNameMatch(un, p2NameClean))) ||
      recordMatchesUser(p2Record)
    ));

    // Strict Tournament Organizer authorization: ONLY the specific TO of this tournament (or platform superadmin) is staff
    const isGlobalAdmin = Boolean(u && (
      Boolean(u.is_admin) || userRole === 'admin' || userRole === 'superuser'
    ));
    const eventOrganizerIds = [
      currentEventData?.organizer_id,
      currentEventData?.organizer_bcp_id,
      currentEventData?.raw_json?.userId,
      currentEventData?.raw_json?.organizerId,
      currentEventData?.raw_json?.ownerId,
      currentEventData?.created_by
    ].filter(Boolean).map(x => String(x).trim().toLowerCase());
    const isEventOrganizer = Boolean(u && eventOrganizerIds.length > 0 && (
      userIds.some(uid => eventOrganizerIds.includes(uid))
    ));
    const isStaff = Boolean(isGlobalAdmin || isEventOrganizer);
    // Paired competitors and the specific Tournament Organizer/Admin can launch and update the match tracker.
    // Non-staff competitors and casual spectators spectate via the live scorecard.
    const canEdit = Boolean(isP1 || isP2 || isStaff);

    let actionBtn = '';
    if (!isBye) {
      // 1. If game was actually completed with digital scorecard in tracker_games
      if (hasTrackerGame && (isTrackerDone || hasScore)) {
        actionBtn = `<button class="btn-sm btn-outline" style="font-size:0.72rem; padding:0.2rem 0.5rem; display:inline-flex; align-items:center; gap:0.3rem;" onclick="event.stopPropagation(); openScorecardModal('${matchId}')" title="View turn-by-turn digital scorecard">📄 Scorecard</button>`;
      } 
      // 2. If match is uncompleted and user has competitor/staff permissions to edit/track
      else if (!hasScore && canEdit) {
        const safeEventId = String(eventId).replace(/'/g, "\\'");
        const safeP1Name = String(m.player1_name || 'Player 1').replace(/'/g, "\\'");
        const safeP2Name = String(m.player2_name || 'Player 2').replace(/'/g, "\\'");
        const safeP1Id = String(m.player1_id || '').replace(/'/g, "\\'");
        const safeP2Id = String(m.player2_id || '').replace(/'/g, "\\'");
        const safePairingId = String(m.id || m.pairing_id || m.bcp_pairing_id || '').replace(/'/g, "\\'");
        const btnLabel = hasTrackerGame ? '🎮 Resume' : '🎲 Track';
        actionBtn = `<button class="btn-sm" style="font-size:0.72rem; padding:0.2rem 0.55rem; background:#0284c7; color:#fff; border:1px solid #38bdf8; border-radius:6px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:0.3rem;" onclick="event.stopPropagation(); launchTournamentTracker('${safeEventId}', ${m.round || 1}, ${m.table_number || 1}, '${escapeHtml(safeP1Name)}', '${escapeHtml(safeP2Name)}', '${escapeHtml(safeP1Id)}', '${escapeHtml(safeP2Id)}', '${escapeHtml(safePairingId)}')" title="1-Click Launch Game Tracker for Table ${m.table_number || 1}">${btnLabel}</button>`;
      } 
      // 3. If match is uncompleted and user is a spectator / other competitor
      else if (!hasScore && !canEdit) {
        const safeEventId = String(eventId).replace(/'/g, "\\'");
        const safeP1Name = String(m.player1_name || 'Player 1').replace(/'/g, "\\'");
        const safeP2Name = String(m.player2_name || 'Player 2').replace(/'/g, "\\'");
        const safeP1Id = String(m.player1_id || '').replace(/'/g, "\\'");
        const safeP2Id = String(m.player2_id || '').replace(/'/g, "\\'");
        const safePairingId = String(m.id || m.pairing_id || m.bcp_pairing_id || '').replace(/'/g, "\\'");
        const spectateLabel = hasTrackerGame ? '👁️ Spectate Live' : '👁️ Spectate';
        actionBtn = `<button class="btn-sm btn-outline" style="font-size:0.72rem; padding:0.2rem 0.55rem; display:inline-flex; align-items:center; gap:0.3rem; border-color:#6366f1; color:#a5b4fc; background:rgba(99, 102, 241, 0.12); border-radius:6px; font-weight:600; cursor:pointer;" onclick="event.stopPropagation(); spectateTournamentTracker('${safeEventId}', ${m.round || 1}, ${m.table_number || 1}, '${escapeHtml(safeP1Name)}', '${escapeHtml(safeP2Name)}', '${escapeHtml(safeP1Id)}', '${escapeHtml(safeP2Id)}', '${safePairingId}')" title="Spectate Table ${m.table_number || 1} match in live view-only mode">${spectateLabel}</button>`;
      }
    }

    tr.innerHTML = `
      <td style="font-family:var(--font-mono); font-weight:700;">R${m.round || 1}</td>
      <td style="font-family:var(--font-mono); color:var(--text-muted);">T${m.table_number || 1}</td>
      <td>
        <div class="player-name-cell">
          <span class="player-link" style="color:${isP1Win ? 'var(--win)' : '#fff'}; font-weight:600;" onclick="event.stopPropagation(); openPlayerModal('${m.player1_id}')">
            ${escapeHtml(m.player1_name || 'Player 1')}
          </span>
          ${p1Faction ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;"><span class="badge" style="background:var(--bg-card); border:1px solid var(--border); font-size:0.7rem; padding:0.1rem 0.35rem; border-radius:4px; font-weight:500;">${escapeHtml(p1Faction)}</span></div>` : ''}
        </div>
      </td>
      <td style="font-family:var(--font-mono); font-weight:700; color:${isP1Win ? 'var(--win)' : 'var(--text-secondary)'};">
        ${m.player1_score !== null ? m.player1_score : '-'}
      </td>
      <td style="font-family:var(--font-mono); font-weight:700; color:${isP2Win ? 'var(--win)' : 'var(--text-secondary)'};">
        ${m.player2_score !== null ? m.player2_score : '-'}
      </td>
      <td>
        <div class="player-name-cell">
          <span class="player-link" style="color:${isP2Win ? 'var(--win)' : '#fff'}; font-weight:600;" onclick="event.stopPropagation(); openPlayerModal('${m.player2_id}')">
            ${escapeHtml(m.player2_name || (m.is_bye ? 'BYE' : 'Player 2'))}
          </span>
          ${(!isBye && p2Faction) ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;"><span class="badge" style="background:var(--bg-card); border:1px solid var(--border); font-size:0.7rem; padding:0.1rem 0.35rem; border-radius:4px; font-weight:500;">${escapeHtml(p2Faction)}</span></div>` : ''}
        </div>
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

async function launchTournamentTracker(eventId, roundNum, tableNum, p1Name, p2Name, p1Id, p2Id, pairingId = '') {
  const matchId = `BCP-${eventId}-R${roundNum}-T${tableNum}`;
  
  let p1Fac = null;
  let p2Fac = null;
  let p1Det = null;
  let p2Det = null;
  
  const allPlayers = [
    ...(Array.isArray(eventPlayersCache) ? eventPlayersCache : []),
    ...((currentEventData && Array.isArray(currentEventData.players)) ? currentEventData.players : []),
    ...((currentEventData && Array.isArray(currentEventData.roster)) ? currentEventData.roster : [])
  ];
  const p1Record = allPlayers.find(p => p && (p.player_id === p1Id || p.id === p1Id || p.full_name === p1Name || p.name === p1Name || p.player_name === p1Name));
  if (p1Record) {
    p1Fac = p1Record.faction || p1Record.army_name;
    p1Det = p1Record.detachment;
  }
  const p2Record = allPlayers.find(p => p && (p.player_id === p2Id || p.id === p2Id || p.full_name === p2Name || p.name === p2Name || p.player_name === p2Name));
  if (p2Record) {
    p2Fac = p2Record.faction || p2Record.army_name;
    p2Det = p2Record.detachment;
  }

  try {
    await window.api.createTournamentTrackerRoom({
      match_id: matchId,
      event_id: eventId,
      round_num: roundNum,
      table_num: tableNum,
      pairing_id: pairingId || null,
      p1_name: p1Name,
      p2_name: p2Name,
      p1_id: p1Id || null,
      p2_id: p2Id || null,
      p1_faction: p1Fac,
      p2_faction: p2Fac,
      p1_detachment: p1Det,
      p2_detachment: p2Det
    });
  } catch (e) {
    console.warn('Auto room connect notice:', e);
  }

  const pParam = pairingId ? `&pairing_id=${encodeURIComponent(pairingId)}` : '';
  window.location.href = `/11th/tracker/play?match_id=${encodeURIComponent(matchId)}&event_id=${encodeURIComponent(eventId)}&table=${tableNum}${pParam}`;
}

async function spectateTournamentTracker(eventId, roundNum, tableNum, p1Name, p2Name, p1Id, p2Id, pairingId = '') {
  const matchId = `BCP-${eventId}-R${roundNum}-T${tableNum}`;
  
  let p1Fac = null;
  let p2Fac = null;
  let p1Det = null;
  let p2Det = null;
  
  const allPlayers = [
    ...(Array.isArray(eventPlayersCache) ? eventPlayersCache : []),
    ...((currentEventData && Array.isArray(currentEventData.players)) ? currentEventData.players : []),
    ...((currentEventData && Array.isArray(currentEventData.roster)) ? currentEventData.roster : [])
  ];
  const p1Record = allPlayers.find(p => p && (p.player_id === p1Id || p.id === p1Id || p.full_name === p1Name || p.name === p1Name || p.player_name === p1Name));
  if (p1Record) {
    p1Fac = p1Record.faction || p1Record.army_name;
    p1Det = p1Record.detachment;
  }
  const p2Record = allPlayers.find(p => p && (p.player_id === p2Id || p.id === p2Id || p.full_name === p2Name || p.name === p2Name || p.player_name === p2Name));
  if (p2Record) {
    p2Fac = p2Record.faction || p2Record.army_name;
    p2Det = p2Record.detachment;
  }

  try {
    await window.api.createTournamentTrackerRoom({
      match_id: matchId,
      event_id: eventId,
      round_num: roundNum,
      table_num: tableNum,
      pairing_id: pairingId || null,
      p1_name: p1Name,
      p2_name: p2Name,
      p1_id: p1Id || null,
      p2_id: p2Id || null,
      p1_faction: p1Fac,
      p2_faction: p2Fac,
      p1_detachment: p1Det,
      p2_detachment: p2Det
    });
  } catch (e) {
    console.warn('Auto room connect notice for spectator:', e);
  }

  const pParam = pairingId ? `&pairing_id=${encodeURIComponent(pairingId)}` : '';
  window.location.href = `/scorecard/${encodeURIComponent(matchId)}`;
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
  if (typeof closeModal === 'function') {
    closeModal('modal-tournament-register');
  }
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
  const accessCode = document.getElementById('reg-player-access-code')?.value.trim() || '';
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
      access_code: accessCode || undefined,
      accessCode: accessCode || undefined,
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
        openEventModal(eventId, true, 'results');
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

// =========================================================================
// PLAYER DETAILS & BCP REGISTRATION MANAGEMENT
// =========================================================================

let cachedGamesystemFactions = {};
let currentEventRegistration = null;

async function loadGamesystemFactions(gamesystemId = 'WGMSzfKFYA') {
  const factionSelect = document.getElementById('player-reg-faction');
  if (!factionSelect) return [];

  const cleanGid = gamesystemId || 'WGMSzfKFYA';
  if (cachedGamesystemFactions[cleanGid] && cachedGamesystemFactions[cleanGid].length > 0) {
    populateFactionDropdown(cachedGamesystemFactions[cleanGid]);
    return cachedGamesystemFactions[cleanGid];
  }

  try {
    factionSelect.innerHTML = '<option value="">Loading factions from BCP...</option>';
    const res = await window.api.getGamesystemFactions(cleanGid);
    const factions = (res && res.factions) || [];
    cachedGamesystemFactions[cleanGid] = factions;
    populateFactionDropdown(factions);
    return factions;
  } catch (err) {
    console.warn("Failed to load factions from BCP:", err);
    factionSelect.innerHTML = '<option value="">Error loading factions</option>';
    return [];
  }
}

function populateFactionDropdown(factions) {
  const factionSelect = document.getElementById('player-reg-faction');
  if (!factionSelect) return;

  if (!factions || factions.length === 0) {
    factionSelect.innerHTML = '<option value="">No factions available</option>';
    return;
  }

  const currentVal = factionSelect.value;
  factionSelect.innerHTML = '<option value="">-- Select Faction --</option>' + factions.map(f => {
    return `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`;
  }).join('');

  if (currentVal) {
    factionSelect.value = currentVal;
  }
}

function onPlayerFactionChange(selectedArmyId) {
  const detachmentSelect = document.getElementById('player-reg-detachment');
  if (!detachmentSelect) return;

  if (!selectedArmyId) {
    detachmentSelect.innerHTML = '<option value="">Select Faction first</option>';
    return;
  }

  let foundFaction = null;
  for (const gid of Object.keys(cachedGamesystemFactions)) {
    const list = cachedGamesystemFactions[gid] || [];
    foundFaction = list.find(f => String(f.id) === String(selectedArmyId) || f.name.toLowerCase() === selectedArmyId.toLowerCase());
    if (foundFaction) break;
  }

  const subFactions = (foundFaction && foundFaction.subFactions) || [];
  if (subFactions.length === 0) {
    detachmentSelect.innerHTML = '<option value="">No detachments available</option>';
    return;
  }

  const currentDetVal = detachmentSelect.value;
  detachmentSelect.innerHTML = '<option value="">-- Select Force Disposition / Detachment --</option>' + subFactions.map(sf => {
    return `<option value="${escapeHtml(sf.id)}">${escapeHtml(sf.name)}</option>`;
  }).join('');

  if (currentDetVal) {
    detachmentSelect.value = currentDetVal;
  }
}

async function populateEventPlayerDetails(regData) {
  if (!regData || !regData.is_registered) return;
  currentEventRegistration = regData;
  const reg = regData.player_registration || {};

  // 1. Status Pill & Check-in / Drop controls
  const statusPill = document.getElementById('player-reg-status-pill');
  const btnCheckin = document.getElementById('btn-player-checkin');
  const btnCheckinText = document.getElementById('btn-player-checkin-text');
  const btnDrop = document.getElementById('btn-player-drop');
  const checkinAlert = document.getElementById('player-checkin-alert');

  const isCheckedIn = Boolean(reg.checked_in);
  const isDropped = Boolean(reg.dropped);
  const hasList = Boolean(reg.has_list_submitted || (reg.army_list && reg.army_list.trim().length > 0));

  if (statusPill) {
    if (isDropped) {
      statusPill.innerText = 'DROPPED';
      statusPill.style.background = 'rgba(239, 68, 68, 0.2)';
      statusPill.style.color = '#ef4444';
      statusPill.style.border = '1px solid rgba(239, 68, 68, 0.4)';
    } else if (isCheckedIn) {
      statusPill.innerText = 'CHECKED IN';
      statusPill.style.background = 'rgba(16, 185, 129, 0.2)';
      statusPill.style.color = '#10b981';
      statusPill.style.border = '1px solid rgba(16, 185, 129, 0.4)';
    } else {
      statusPill.innerText = 'NOT CHECKED IN';
      statusPill.style.background = 'rgba(245, 158, 11, 0.15)';
      statusPill.style.color = '#fbbf24';
      statusPill.style.border = '1px solid rgba(245, 158, 11, 0.3)';
    }
  }

  if (btnCheckin) {
    if (isDropped) {
      btnCheckin.disabled = true;
      btnCheckin.style.opacity = '0.5';
      btnCheckin.style.cursor = 'not-allowed';
      if (btnCheckinText) btnCheckinText.innerText = 'Player Dropped';
    } else if (isCheckedIn) {
      btnCheckin.disabled = true;
      btnCheckin.style.opacity = '0.7';
      btnCheckin.style.background = 'rgba(16, 185, 129, 0.2)';
      btnCheckin.style.borderColor = 'rgba(16, 185, 129, 0.5)';
      btnCheckin.style.color = '#10b981';
      btnCheckin.style.cursor = 'default';
      if (btnCheckinText) btnCheckinText.innerText = 'Checked In ✅';
    } else {
      btnCheckin.disabled = false;
      btnCheckin.style.opacity = '1';
      btnCheckin.style.cursor = 'pointer';
      btnCheckin.style.background = '#f59e0b';
      btnCheckin.style.borderColor = '#d97706';
      btnCheckin.style.color = '#000';
      if (btnCheckinText) btnCheckinText.innerText = hasList ? 'Check In ⚡' : 'Check In';
    }
  }

  if (btnDrop) {
    btnDrop.disabled = isDropped;
    if (isDropped) {
      btnDrop.style.opacity = '0.5';
      btnDrop.style.cursor = 'not-allowed';
    } else {
      btnDrop.style.opacity = '1';
      btnDrop.style.cursor = 'pointer';
    }
  }

  if (checkinAlert) {
    if (isDropped) {
      checkinAlert.style.display = 'block';
      checkinAlert.style.background = 'rgba(239, 68, 68, 0.12)';
      checkinAlert.style.border = '1px solid rgba(239, 68, 68, 0.3)';
      checkinAlert.style.color = '#ef4444';
      checkinAlert.innerHTML = '⚠️ You have dropped from this event on Best Coast Pairings.';
    } else if (isCheckedIn) {
      checkinAlert.style.display = 'block';
      checkinAlert.style.background = 'rgba(16, 185, 129, 0.12)';
      checkinAlert.style.border = '1px solid rgba(16, 185, 129, 0.3)';
      checkinAlert.style.color = '#10b981';
      checkinAlert.innerHTML = '✅ <b>You are checked in!</b> You are confirmed in the roster for round pairings.';
    } else if (!hasList) {
      checkinAlert.style.display = 'block';
      checkinAlert.style.background = 'rgba(245, 158, 11, 0.12)';
      checkinAlert.style.border = '1px solid rgba(245, 158, 11, 0.3)';
      checkinAlert.style.color = '#fbbf24';
      checkinAlert.innerHTML = '⚠️ <b>Army List Required:</b> Best Coast Pairings requires you to submit an army list before checking in. Select a saved list or enter your list text below, submit it, and then check in!';
    } else {
      checkinAlert.style.display = 'none';
    }
  }

  // 2. Pre-fill Player Inputs
  const fnInput = document.getElementById('player-reg-firstname');
  const lnInput = document.getElementById('player-reg-lastname');
  const teamInput = document.getElementById('player-reg-team');
  if (fnInput) fnInput.value = reg.first_name || (regData.user_profile && regData.user_profile.first_name) || '';
  if (lnInput) lnInput.value = reg.last_name || (regData.user_profile && regData.user_profile.last_name) || '';
  if (teamInput) teamInput.value = reg.team_name || '';

  // 3. Load Factions and select current faction / detachment
  const gamesystemId = reg.gamesystem_id || 'WGMSzfKFYA';
  const factions = await loadGamesystemFactions(gamesystemId);
  
  const factionSelect = document.getElementById('player-reg-faction');
  const detachmentSelect = document.getElementById('player-reg-detachment');

  if (factionSelect) {
    if (factions && factions.length > 0) {
      let matchedFaction = null;
      if (reg.army_id) {
        matchedFaction = factions.find(f => String(f.id).trim() === String(reg.army_id).trim());
      }
      if (!matchedFaction && reg.faction) {
        const targetFac = String(reg.faction).trim().toLowerCase();
        matchedFaction = factions.find(f => {
          const fName = String(f.name || '').trim().toLowerCase();
          return fName === targetFac || fName.includes(targetFac) || targetFac.includes(fName);
        });
      }
      if (matchedFaction) {
        factionSelect.value = matchedFaction.id;
        onPlayerFactionChange(matchedFaction.id);

        if (detachmentSelect) {
          const subFactions = matchedFaction.subFactions || [];
          let matchedSub = null;
          if (reg.sub_faction_id) {
            matchedSub = subFactions.find(sf => String(sf.id).trim() === String(reg.sub_faction_id).trim());
          }
          if (!matchedSub && reg.detachment) {
            const targetDet = String(reg.detachment).trim().toLowerCase();
            matchedSub = subFactions.find(sf => {
              const sfName = String(sf.name || '').trim().toLowerCase();
              return sfName === targetDet || sfName.includes(targetDet) || targetDet.includes(sfName);
            });
          }
          if (matchedSub) {
            detachmentSelect.value = matchedSub.id;
          } else if (reg.detachment || reg.sub_faction_id) {
            const opt = document.createElement('option');
            opt.value = reg.sub_faction_id || reg.detachment;
            opt.innerText = reg.detachment || reg.sub_faction_id;
            opt.selected = true;
            detachmentSelect.appendChild(opt);
            detachmentSelect.value = opt.value;
          }
        }
      } else if (reg.faction || reg.army_id) {
        const opt = document.createElement('option');
        opt.value = reg.army_id || reg.faction;
        opt.innerText = reg.faction || reg.army_id;
        opt.selected = true;
        factionSelect.appendChild(opt);
        factionSelect.value = opt.value;
        if (detachmentSelect && (reg.detachment || reg.sub_faction_id)) {
          detachmentSelect.innerHTML = `<option value="${escapeHtml(reg.sub_faction_id || reg.detachment)}" selected>${escapeHtml(reg.detachment || reg.sub_faction_id)}</option>`;
        }
      }
    } else if (reg.faction || reg.army_id) {
      factionSelect.innerHTML = `<option value="${escapeHtml(reg.army_id || reg.faction)}" selected>${escapeHtml(reg.faction || reg.army_id)}</option>`;
      if (detachmentSelect && (reg.detachment || reg.sub_faction_id)) {
        detachmentSelect.innerHTML = `<option value="${escapeHtml(reg.sub_faction_id || reg.detachment)}" selected>${escapeHtml(reg.detachment || reg.sub_faction_id)}</option>`;
      }
    }
  }

  // 4. Populate OmniTactica Saved Lists Dropdown
  const savedListsSelect = document.getElementById('player-reg-saved-lists-select');
  if (savedListsSelect) {
    const lists = regData.army_lists || [];
    if (lists.length === 0) {
      savedListsSelect.innerHTML = '<option value="">No saved army lists found in My Hub</option>';
    } else {
      savedListsSelect.innerHTML = '<option value="">-- Select Saved Army List --</option>' + lists.map((al, idx) => {
        const ptsStr = al.points ? ` • ${al.points} pts` : '';
        const facStr = al.faction ? ` (${al.faction}${al.detachment ? ' - ' + al.detachment : ''})` : '';
        return `<option value="${idx}">${escapeHtml(al.name || 'Saved List')}${escapeHtml(facStr)}${escapeHtml(ptsStr)}</option>`;
      }).join('');
    }
  }

  // 5. Populate List Text Area and Status
  const listStatusPill = document.getElementById('player-list-status-pill');
  const listTextArea = document.getElementById('player-reg-list-text');

  if (listTextArea) {
    listTextArea.value = reg.army_list || '';
    updatePlayerListCharCount();
  }

  if (listStatusPill) {
    if (hasList) {
      listStatusPill.innerText = '✅ List Submitted';
      listStatusPill.style.background = 'rgba(16, 185, 129, 0.15)';
      listStatusPill.style.color = '#10b981';
      listStatusPill.style.border = '1px solid rgba(16, 185, 129, 0.3)';
    } else {
      listStatusPill.innerText = '⚠️ No List Submitted';
      listStatusPill.style.background = 'rgba(245, 158, 11, 0.15)';
      listStatusPill.style.color = '#fbbf24';
      listStatusPill.style.border = '1px solid rgba(245, 158, 11, 0.3)';
    }
  }
}

function updatePlayerListCharCount() {
  const ta = document.getElementById('player-reg-list-text');
  const countEl = document.getElementById('player-reg-list-charcount');
  if (ta && countEl) {
    const len = (ta.value || '').length;
    const lines = (ta.value || '').split('\n').filter(Boolean).length;
    countEl.innerText = `${len} chars • ${lines} lines`;
  }
}

function applySavedListToPlayerDetails() {
  const sel = document.getElementById('player-reg-saved-lists-select');
  const ta = document.getElementById('player-reg-list-text');
  if (!sel || !currentEventRegistration) return;

  const idx = parseInt(sel.value, 10);
  const lists = currentEventRegistration.army_lists || [];
  if (isNaN(idx) || idx < 0 || idx >= lists.length) {
    alert("Please select a valid saved army list from the dropdown.");
    return;
  }

  const al = lists[idx];
  if (ta) {
    ta.value = al.raw_text || '';
    updatePlayerListCharCount();
  }

  // Attempt auto-match for faction and detachment
  if (al.faction) {
    const factionSelect = document.getElementById('player-reg-faction');
    const detachmentSelect = document.getElementById('player-reg-detachment');
    const gamesystemId = (currentEventRegistration.player_registration && currentEventRegistration.player_registration.gamesystem_id) || 'WGMSzfKFYA';
    const factions = cachedGamesystemFactions[gamesystemId] || [];

    const matchedFaction = factions.find(f => f.name.toLowerCase() === al.faction.toLowerCase() || al.faction.toLowerCase().includes(f.name.toLowerCase()));
    if (matchedFaction && factionSelect) {
      factionSelect.value = matchedFaction.id;
      onPlayerFactionChange(matchedFaction.id);

      if (al.detachment && detachmentSelect) {
        const subFactions = matchedFaction.subFactions || [];
        const matchedSub = subFactions.find(sf => sf.name.toLowerCase() === al.detachment.toLowerCase() || al.detachment.toLowerCase().includes(sf.name.toLowerCase()));
        if (matchedSub) {
          detachmentSelect.value = matchedSub.id;
        }
      }
    }
  }

  if (typeof showToast === 'function') {
    showToast(`Applied saved list "${al.name || 'Army List'}". Click "Submit Army List to BCP" to sync!`, 'info');
  }
}

async function handleEventPlayerUpdate(e) {
  if (e) e.preventDefault();
  if (!currentOpenEventId || !currentEventRegistration) return;
  const reg = currentEventRegistration.player_registration || {};
  let pid = reg.player_id || '';
  if (pid === currentOpenEventId || pid.startsWith('user_')) {
    pid = '';
  }

  const fn = (document.getElementById('player-reg-firstname')?.value || '').trim();
  const ln = (document.getElementById('player-reg-lastname')?.value || '').trim();
  const team = (document.getElementById('player-reg-team')?.value || '').trim();
  const factionSelect = document.getElementById('player-reg-faction');
  const detachmentSelect = document.getElementById('player-reg-detachment');

  const armyId = factionSelect?.value || '';
  const subFactionId = detachmentSelect?.value || '';
  const factionName = (factionSelect && factionSelect.selectedIndex > 0) ? (factionSelect.options[factionSelect.selectedIndex]?.text || '') : '';
  const detachmentName = (detachmentSelect && detachmentSelect.selectedIndex > 0) ? (detachmentSelect.options[detachmentSelect.selectedIndex]?.text || '') : '';

  const btn = document.getElementById('btn-player-update');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-mini" style="display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation:spin 0.8s linear infinite;"></span> Updating...';
  }

  try {
    const res = await window.api.updateEventPlayer(currentOpenEventId, {
      player_id: pid,
      first_name: fn,
      last_name: ln,
      team_name: team,
      army_id: armyId,
      sub_faction_id: subFactionId,
      faction_name: factionName,
      detachment_name: detachmentName
    });

    if (res && res.success) {
      if (typeof showToast === 'function') {
        showToast('Registration details updated successfully on BCP!', 'success');
      }
      if (res.player_id) {
        reg.player_id = res.player_id;
      }
      reg.first_name = fn;
      reg.last_name = ln;
      reg.team_name = team;
      reg.army_id = armyId;
      reg.sub_faction_id = subFactionId;
      reg.faction = factionName;
      reg.detachment = detachmentName;
      window.dispatchEvent(new CustomEvent('tournaments-updated'));
    } else {
      alert((res && (res.detail || res.error || res.message)) || 'Failed to update player details on BCP.');
    }
  } catch (err) {
    alert('Error updating details: ' + (err.message || err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Update Details';
    }
  }
}

async function handleEventPlayerSubmitList() {
  if (!currentOpenEventId || !currentEventRegistration) return;
  const reg = currentEventRegistration.player_registration || {};
  let pid = reg.player_id || '';
  if (pid === currentOpenEventId || pid.startsWith('user_')) {
    pid = '';
  }

  const listText = (document.getElementById('player-reg-list-text')?.value || '').trim();
  if (!listText) {
    alert("Please enter or paste your army list text before submitting.");
    document.getElementById('player-reg-list-text')?.focus();
    return;
  }

  const factionSelect = document.getElementById('player-reg-faction');
  const detachmentSelect = document.getElementById('player-reg-detachment');
  const armyId = factionSelect?.value || reg.army_id || '';
  const subFactionId = detachmentSelect?.value || reg.sub_faction_id || '';

  const btn = document.getElementById('btn-player-submit-list');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-mini" style="display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation:spin 0.8s linear infinite;"></span> Submitting to BCP...';
  }

  try {
    const res = await window.api.submitEventArmylist(currentOpenEventId, {
      player_id: pid,
      list_text: listText,
      army_id: armyId,
      sub_faction_id: subFactionId,
      send_notification: true
    });

    if (res && res.success) {
      if (typeof showToast === 'function') {
        showToast('Army list submitted successfully to Best Coast Pairings!', 'success');
      }
      if (res.player_id) {
        reg.player_id = res.player_id;
      }
      reg.has_list_submitted = true;
      reg.army_list = listText;

      // Update List Status Pill
      const listStatusPill = document.getElementById('player-list-status-pill');
      if (listStatusPill) {
        listStatusPill.innerText = '✅ List Submitted';
        listStatusPill.style.background = 'rgba(16, 185, 129, 0.15)';
        listStatusPill.style.color = '#10b981';
        listStatusPill.style.border = '1px solid rgba(16, 185, 129, 0.3)';
      }

      // Hide check-in warning alert if not checked in
      const checkinAlert = document.getElementById('player-checkin-alert');
      if (checkinAlert && !reg.checked_in) {
        checkinAlert.style.display = 'none';
      }

      // Unlock Check-in button
      const btnCheckin = document.getElementById('btn-player-checkin');
      const btnCheckinText = document.getElementById('btn-player-checkin-text');
      if (btnCheckin && !reg.checked_in) {
        btnCheckin.disabled = false;
        btnCheckin.style.opacity = '1';
        btnCheckin.style.background = '#f59e0b';
        btnCheckin.style.borderColor = '#d97706';
        btnCheckin.style.color = '#000';
        if (btnCheckinText) btnCheckinText.innerText = 'Check In ⚡';
      }

      window.dispatchEvent(new CustomEvent('tournaments-updated'));
    } else {
      alert((res && (res.detail || res.error || res.message)) || 'Failed to submit army list to BCP.');
    }
  } catch (err) {
    alert('Error submitting army list: ' + (err.message || err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '📤 Submit Army List to BCP';
    }
  }
}

async function handleEventPlayerCheckin() {
  if (!currentOpenEventId || !currentEventRegistration) return;
  const reg = currentEventRegistration.player_registration || {};
  let pid = reg.player_id || '';
  if (pid === currentOpenEventId || pid.startsWith('user_')) {
    pid = '';
  }

  if (reg.checked_in) {
    if (typeof showToast === 'function') {
      showToast('You are already checked in for this event!', 'info');
    }
    return;
  }

  // Check list condition
  const listText = (document.getElementById('player-reg-list-text')?.value || '').trim();
  const hasList = Boolean(reg.has_list_submitted || (reg.army_list && reg.army_list.trim().length > 0) || listText.length > 0);

  if (!hasList) {
    alert("Best Coast Pairings requires you to submit an army list before checking in.\n\nPlease select a saved army list or paste your list text into the List Information section below, submit it, and then check in.");
    const checkinAlert = document.getElementById('player-checkin-alert');
    if (checkinAlert) {
      checkinAlert.style.display = 'block';
      checkinAlert.style.background = 'rgba(239, 68, 68, 0.15)';
      checkinAlert.style.color = '#ef4444';
      checkinAlert.style.border = '1px solid rgba(239, 68, 68, 0.3)';
      checkinAlert.innerHTML = '❌ <b>Cannot Check In:</b> An army list must be submitted first. Please select or paste your list below.';
    }
    document.getElementById('player-reg-list-text')?.scrollIntoView({ behavior: 'smooth' });
    document.getElementById('player-reg-list-text')?.focus();
    return;
  }

  // If user pasted list text but hasn't clicked Submit Army List yet, submit it automatically first!
  if (!reg.has_list_submitted && listText.length > 0) {
    await handleEventPlayerSubmitList();
  }

  const btn = document.getElementById('btn-player-checkin');
  const btnText = document.getElementById('btn-player-checkin-text');
  if (btn) {
    btn.disabled = true;
    if (btnText) btnText.innerText = 'Checking In...';
  }

  try {
    const res = await window.api.checkinEventPlayer(currentOpenEventId, {
      player_id: pid,
      has_list: true
    });

    if (res && res.success) {
      if (typeof showToast === 'function') {
        showToast('Successfully checked in to tournament on Best Coast Pairings!', 'success');
      }
      if (res.player_id) {
        reg.player_id = res.player_id;
      }
      reg.checked_in = true;
      await populateEventPlayerDetails(currentEventRegistration);
      window.dispatchEvent(new CustomEvent('tournaments-updated'));
    } else {
      alert((res && (res.detail || res.error || res.message)) || 'Failed to check in on BCP.');
      if (btn) {
        btn.disabled = false;
        if (btnText) btnText.innerText = 'Check In ⚡';
      }
    }
  } catch (err) {
    alert('Error checking in: ' + (err.message || err));
    if (btn) {
      btn.disabled = false;
      if (btnText) btnText.innerText = 'Check In ⚡';
    }
  }
}

async function handleEventPlayerDrop() {
  if (!currentOpenEventId || !currentEventRegistration) return;
  const reg = currentEventRegistration.player_registration || {};
  let pid = reg.player_id || '';
  if (pid === currentOpenEventId || pid.startsWith('user_')) {
    pid = '';
  }

  const evName = (currentEventData && currentEventData.name) || 'Tournament';
  const confirmMsg = `Are you sure you want to drop from ${evName} on Best Coast Pairings?\n\nThis will update your status on BCP and remove you from upcoming match pairings.`;
  if (!window.confirm(confirmMsg)) {
    return;
  }

  const btn = document.getElementById('btn-player-drop');
  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Dropping...';
  }

  try {
    const res = await window.api.dropEventPlayer(currentOpenEventId, {
      player_id: pid
    });

    if (res && res.success) {
      if (typeof showToast === 'function') {
        showToast('Successfully dropped from tournament on BCP.', 'info');
      }
      if (res.player_id) {
        reg.player_id = res.player_id;
      }
      reg.dropped = true;
      await populateEventPlayerDetails(currentEventRegistration);
      window.dispatchEvent(new CustomEvent('tournaments-updated'));
    } else {
      alert((res && (res.detail || res.error || res.message)) || 'Failed to drop from tournament on BCP.');
    }
  } catch (err) {
    alert('Error dropping from tournament: ' + (err.message || err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '🚪 Drop';
    }
  }
}

// Window bindings for tournament modal and registration
window.openEventModal = openEventModal;
window.switchEventModalTab = switchEventModalTab;
window.refreshCurrentEventModal = refreshCurrentEventModal;
window.launchTournamentTracker = launchTournamentTracker;
window.spectateTournamentTracker = spectateTournamentTracker;
window.openTournamentRegistrationModal = openTournamentRegistrationModal;
window.closeTournamentRegistrationModal = closeTournamentRegistrationModal;
window.submitTournamentRegistration = submitTournamentRegistration;
window.renderEventTeamsRows = renderEventTeamsRows;
window.toggleTeamRosterCard = toggleTeamRosterCard;
window.toggleAllTeamCards = toggleAllTeamCards;
window.loadGamesystemFactions = loadGamesystemFactions;
window.onPlayerFactionChange = onPlayerFactionChange;
window.populateEventPlayerDetails = populateEventPlayerDetails;
window.updatePlayerListCharCount = updatePlayerListCharCount;
window.applySavedListToPlayerDetails = applySavedListToPlayerDetails;
window.handleEventPlayerUpdate = handleEventPlayerUpdate;
window.handleEventPlayerSubmitList = handleEventPlayerSubmitList;
window.handleEventPlayerCheckin = handleEventPlayerCheckin;
window.handleEventPlayerDrop = handleEventPlayerDrop;
