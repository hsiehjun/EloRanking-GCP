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

function formatPlayerFaction(rawFaction, maxFactions = 1, isEventContext = false) {
  if (!rawFaction) return isEventContext ? '-' : 'Various';
  if (Array.isArray(rawFaction)) {
    rawFaction = rawFaction.join(', ');
  }
  const str = String(rawFaction).trim();
  if (!str || str === '-' || str === '--' || str.toLowerCase() === 'unknown' || str.toLowerCase() === 'unassigned' || str.toLowerCase() === 'none') {
    return isEventContext ? '-' : 'Various';
  }
  const parts = str.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return isEventContext ? '-' : 'Various';
  if (parts.length === 1) return parts[0];
  if (isEventContext || maxFactions === 1) {
    return parts[0];
  }
  if (parts.length <= maxFactions) {
    return parts.join(', ');
  }
  return `${parts.slice(0, maxFactions).join(', ')} +${parts.length - maxFactions}`;
}

function formatEventPlayerFaction(rawFaction, maxFactions = 1) {
  return formatPlayerFaction(rawFaction, maxFactions, true);
}

function isUserBcpConnected() {
  const user = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const bcpTok = (window.api?.getBcpToken?.()) ||
                 localStorage.getItem('bcp_jwt') ||
                 localStorage.getItem('bcp_token') ||
                 localStorage.getItem('bcp_access_token') || '';
  if (bcpTok && bcpTok.length > 10) return true;
  if (user && (user.bcp_connected || user.bcp_user_id || user.bcp_email || user.bcp_token)) return true;
  return false;
}

function renderBcpLinkRequiredCard(listUrl) {
  return `
    <div style="text-align:center; padding:1.75rem 1rem;">
      <div style="font-size:2.5rem; margin-bottom:0.75rem;">🔒</div>
      <div style="font-size:1.15rem; font-weight:800; color:#38bdf8; margin-bottom:0.45rem;">Best Coast Pairings Account Required</div>
      <div style="font-size:0.86rem; color:var(--text-secondary); max-width:440px; margin:0 auto 1.35rem auto; line-height:1.5;">
        This competitor registered their tournament army roster on Best Coast Pairings. Link your Best Coast Pairings account to view army rosters directly inside OmniTactica.
      </div>
      <div style="display:flex; flex-wrap:wrap; justify-content:center; align-items:center; gap:0.75rem;">
        <button type="button" class="btn btn-primary" onclick="closeModal('event-army-list-modal'); if (typeof openBcpLinkModal === 'function') openBcpLinkModal();" style="display:inline-flex; align-items:center; gap:0.45rem; font-weight:700; font-size:0.86rem; padding:0.6rem 1.35rem; background:linear-gradient(135deg, #0284c7 0%, #0369a1 100%); border:1px solid #38bdf8; color:#fff; border-radius:6px; cursor:pointer;">
          🔗 Link BCP Account
        </button>
        ${listUrl ? `
          <a href="${escapeHtml(listUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="display:inline-flex; align-items:center; gap:0.45rem; font-weight:600; font-size:0.86rem; padding:0.6rem 1.15rem; text-decoration:none; border:1px solid var(--border); color:var(--text-secondary); border-radius:6px;">
            Open on BCP ↗
          </a>
        ` : ''}
      </div>
    </div>
  `;
}

function hasPlayerSubmittedList(p) {
  if (!p) return false;
  if (p.has_list !== undefined) return Boolean(p.has_list);
  const info = getPlayerListDetails(p);
  return info.hasList;
}

function getPlayerListDetails(p) {
  if (!p) return { text: '', url: '', listId: '', hasList: false };
  let text = String(p.army_list || p.army_list_text || p.raw_list || p.list_text || p.armyList || p.armyListText || '').trim();
  let url = String(p.list_url || p.listUrl || '').trim();
  let listId = String(p.list_id || p.listId || '').trim();

  if (text.startsWith('/list/') || text.startsWith('http://') || text.startsWith('https://') || text.startsWith('/v1/')) {
    if (!url) url = text;
    text = '';
  }
  if (url && url.startsWith('/')) {
    url = `https://www.bestcoastpairings.com${url}`;
  }
  if (!listId && url) {
    const m = url.match(/\/list\/([a-zA-Z0-9_-]+)/);
    if (m) listId = m[1];
  }
  if (listId && !url) {
    url = `https://www.bestcoastpairings.com/list/${listId}`;
  }
  const hasList = Boolean(text || url || listId);
  return { text, url, listId, hasList };
}

if (typeof window !== 'undefined') {
  window.formatPlayerFaction = formatPlayerFaction;
  window.formatEventPlayerFaction = formatEventPlayerFaction;
  window.hasPlayerSubmittedList = hasPlayerSubmittedList;
  window.getPlayerListDetails = getPlayerListDetails;
  window.isUserBcpConnected = isUserBcpConnected;
  window.renderBcpLinkRequiredCard = renderBcpLinkRequiredCard;
}

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

  // Reset cached registration if opening a different tournament
  if (!currentEventData || String(currentEventData.id) !== String(eventId)) {
    currentEventRegistration = null;
  }

  // Set active tab immediately to prevent visual flashing (default to teams for team tournaments, results otherwise)
  const guessedIsTeam = Boolean(currentEventData && String(currentEventData.id) === String(eventId) && (currentEventData.is_team_event || (currentEventData.teams && currentEventData.teams.length > 0)));
  switchEventModalTab(initialTab || (guessedIsTeam ? 'teams' : 'results'));

  const subtabPlayerInit = document.getElementById('event-subtab-player');
  const subtabTeamsInit = document.getElementById('event-subtab-teams');
  const subtabEloInit = document.getElementById('event-subtab-elo');
  if (subtabPlayerInit) subtabPlayerInit.style.setProperty('display', 'none', 'important');
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
    if (typeof computeEventPlayerEloStats === 'function') {
      computeEventPlayerEloStats(eventPlayersCache, eventMatchesCache);
    }

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
      currentEventRegistration = null;
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

    if (typeof renderQuickEventModal === 'function') {
      renderQuickEventModal(ev, userRegData);
    }
    if (typeof renderEventHubHeroSection === 'function') {
      renderEventHubHeroSection(ev, userRegData);
    }
    if (typeof populateEventHubFactionFilter === 'function') {
      populateEventHubFactionFilter(eventPlayersCache);
    }
    if (typeof renderPersonalEventScorecard === 'function') {
      renderPersonalEventScorecard(ev, userRegData);
    }
    if (typeof renderEventMetaAndHighlights === 'function') {
      renderEventMetaAndHighlights(ev);
    }

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
  if (tabKey === 'elo' || tabKey === 'standings') tabKey = 'results';
  if (tabKey === 'pairings') tabKey = 'matches';
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
  const isRegistered = Boolean(currentEventRegistration && currentEventRegistration.is_registered);
  if (tabKey === 'player' && (!isRegistered || isEnded)) {
    const isTeam = Boolean(currentEventData && (currentEventData.is_team_event || (currentEventData.teams && currentEventData.teams.length > 0)));
    tabKey = isTeam ? 'teams' : 'results';
  }
  currentEventModalTab = tabKey || 'results';
  const btnPlayer = document.getElementById('event-subtab-player');
  const btnTeams = document.getElementById('event-subtab-teams');
  const btnResults = document.getElementById('event-subtab-results');
  const btnElo = document.getElementById('event-subtab-elo');
  const btnMatches = document.getElementById('event-subtab-matches');
  const btnMeta = document.getElementById('event-subtab-meta');
  const viewPlayer = document.getElementById('event-view-player');
  const viewTeams = document.getElementById('event-view-teams');
  const viewResults = document.getElementById('event-view-results');
  const viewElo = document.getElementById('event-view-elo');
  const viewMatches = document.getElementById('event-view-matches');
  const viewMeta = document.getElementById('event-view-meta');
  const searchRow = document.getElementById('event-modal-search-row') || document.querySelector('.event-modal-search-wrap');
  const facFilterWrap = document.getElementById('event-hub-faction-filter-wrap');

  [btnPlayer, btnTeams, btnResults, btnElo, btnMatches, btnMeta].forEach(b => b && b.classList.remove('active'));
  [viewPlayer, viewTeams, viewResults, viewElo, viewMatches, viewMeta].forEach(v => v && (v.style.display = 'none'));

  if (tabKey === 'player') {
    if (btnPlayer) btnPlayer.classList.add('active');
    if (viewPlayer) viewPlayer.style.display = 'block';
    if (searchRow) searchRow.style.display = 'none';
  } else if (tabKey === 'meta') {
    if (btnMeta) btnMeta.classList.add('active');
    if (viewMeta) viewMeta.style.display = 'block';
    if (searchRow) searchRow.style.display = 'none';
    if (typeof renderEventMetaAndHighlights === 'function' && currentEventData) {
      renderEventMetaAndHighlights(currentEventData);
    }
  } else {
    if (searchRow) searchRow.style.display = 'flex';
    if (facFilterWrap) facFilterWrap.style.display = (tabKey === 'results' || !tabKey) ? 'block' : 'none';
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

        const members = (t.members || []).map(rawM => {
          const mPid = String(rawM.player_id || rawM.id || '').trim().toLowerCase();
          const mPname = String(rawM.full_name || rawM.player_name || rawM.name || '').trim().toLowerCase();
          const cached = (eventPlayersCache || []).find(cp => {
            const cPid = String(cp.player_id || cp.id || '').trim().toLowerCase();
            const cName = String(cp.full_name || cp.player_name || cp.name || '').trim().toLowerCase();
            return (mPid && cPid === mPid) || (mPname && cName === mPname);
          });
          return cached ? Object.assign({}, cached, rawM, {
            current_elo: rawM.current_elo || cached.current_elo || cached.elo,
            event_wins: rawM.event_wins !== undefined ? rawM.event_wins : cached.event_wins,
            event_losses: rawM.event_losses !== undefined ? rawM.event_losses : cached.event_losses,
            event_battle_points: rawM.event_battle_points !== undefined ? rawM.event_battle_points : cached.event_battle_points,
            event_net_elo: rawM.event_net_elo !== undefined ? rawM.event_net_elo : cached.event_net_elo,
            placement: rawM.placement || cached.placement
          }) : rawM;
        });

        const memberElos = members.map(m => Number(m.current_elo || m.elo || 1500)).filter(e => !isNaN(e) && e > 0);
        const computedAvgElo = memberElos.length > 0 ? Math.round(memberElos.reduce((a, b) => a + b, 0) / memberElos.length) : 1500;
        const avgEloVal = t.avg_elo ? Math.round(t.avg_elo) : computedAvgElo;
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

        const memberRowsHtml = members.map((m, mIdx) => {
          const mName = escapeHtml(m.full_name || m.player_name || m.name || (m.first_name ? `${m.first_name} ${m.last_name}` : '') || 'Competitor');
          const mFac = escapeHtml(formatEventPlayerFaction(m.faction || m.army_name || 'Unknown'));
          const mElo = Math.round(Number(m.current_elo || m.elo || 1500));
          const mBadge = getEloBadgeClass(mElo);
          const isCap = Boolean(m.is_captain || String(m.role || '').toLowerCase() === 'captain');
          const netDelta = Number(m.event_net_elo || 0);
          const deltaBadge = netDelta !== 0
            ? `<span class="badge" style="font-family:var(--font-mono); font-size:0.72rem; font-weight:700; margin-left:4px; background:${netDelta > 0 ? 'rgba(34,197,94,0.16)' : 'rgba(239,68,68,0.16)'}; color:${netDelta > 0 ? '#4ade80' : '#f87171'}; border:1px solid ${netDelta > 0 ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'};">${netDelta > 0 ? '+' : ''}${netDelta.toFixed(1)}</span>`
            : '';

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
              <div class="team-member-col-elo team-col-checkin" style="text-align:right; display:flex; align-items:center; justify-content:flex-end; gap:4px;">
                <span class="elo-badge ${mBadge}" style="font-size:0.82rem; font-weight:700; padding:2px 7px;">${mElo}</span>
                ${deltaBadge}
                ${hasPlayerSubmittedList(m) ? `<button type="button" class="btn-xs btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(m.player_id || mName)}')" style="font-size:0.7rem; padding:2px 6px; margin-left:4px; cursor:pointer;" title="View Army Roster">📋 List</button>` : ''}
              </div>
            `;
          } else {
            col3Html = `
              <div class="team-member-col-record" style="text-align:right;">
                <span class="elo-badge ${mBadge}" style="font-size:0.82rem; font-weight:700; padding:2px 7px;">${mElo}</span>
              </div>
            `;
            col4Html = `
              <div class="team-member-col-elo team-col-checkin" style="text-align:right; display:flex; align-items:center; justify-content:flex-end; gap:6px;">
                ${checkinTag}
                ${hasPlayerSubmittedList(m) ? `<button type="button" class="btn-xs btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(m.player_id || mName)}')" style="font-size:0.7rem; padding:2px 6px; cursor:pointer;" title="View Army Roster">📋 List</button>` : ''}
              </div>
            `;
          }

          return `
            <div class="team-member-grid" style="border-bottom:${mIdx < members.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none'}; background:${mIdx % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent'};">
              <div class="team-member-col-name" style="display:flex; align-items:center; gap:0.45rem; min-width:0;">
                <span style="font-size:0.85rem; width:16px; text-align:center; flex-shrink:0;">${isCap ? '👑' : '<span style="color:var(--text-muted, #64748b);">•</span>'}</span>
                ${memberPlacingTag}
                <a href="javascript:void(0)" onclick="event.stopPropagation(); if(typeof openPlayerProfilePage==='function'){openPlayerProfilePage('${escapeHtml(m.player_id || '')}');}else{openPlayerModal('${escapeHtml(m.player_id || '')}');}" style="font-weight:600; font-size:0.88rem; color:#38bdf8; text-decoration:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
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
          const mFac = escapeHtml(formatEventPlayerFaction(m.faction || m.army_name || 'Unknown'));
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
  if (typeof eventHubFactionFilter !== 'undefined' && eventHubFactionFilter && eventHubFactionFilter.toLowerCase() !== 'all') {
    playersToRender = playersToRender.filter(p => formatEventPlayerFaction(p.faction || p.army_name).toLowerCase() === eventHubFactionFilter.toLowerCase());
  }
  if (eventModalSearchQuery) {
    playersToRender = playersToRender.filter(p => {
      const name = (p.full_name || (p.first_name ? `${p.first_name} ${p.last_name}` : '') || '').toLowerCase();
      const fac = formatEventPlayerFaction(p.faction || p.army_name).toLowerCase();
      const team = (p.team || '').toLowerCase();
      return name.includes(eventModalSearchQuery) || fac.includes(eventModalSearchQuery) || team.includes(eventModalSearchQuery);
    });
  }

  const searchSummary = document.getElementById('event-modal-search-summary');
  if (searchSummary && currentEventModalTab === 'results') {
    if (eventModalSearchQuery || (typeof eventHubFactionFilter !== 'undefined' && eventHubFactionFilter !== 'All')) {
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
        <td colspan="7" class="empty-state" style="padding:2.5rem 1rem;">
          <div style="font-size:1.05rem; font-weight:600; color:#fff;">🔍 No Results Found</div>
          <div style="margin-top:0.5rem; color:var(--text-secondary); font-size:0.86rem;">
            No competitors match your current filter in this tournament.
          </div>
          ${suggestions}
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = '';
  playersToRender.forEach((p, idx) => {
    const tr = document.createElement('tr');
    const safePid = String(p.player_id || p.id || '').trim();
    const safeName = String(p.full_name || 'Player').trim();
    tr.onclick = (e) => {
      e.stopPropagation();
      if (typeof openPlayerProfilePage === 'function' && safePid) {
        openPlayerProfilePage(safePid, typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k');
      } else {
        openPlayerModal(safePid, safeName);
      }
    };

    const eloBadgeClass = getEloBadgeClass(p.current_elo);
    const avgScore = (p.event_battle_points / (p.event_matches_count || 1)).toFixed(1);
    const teamHtml = p.team ? `<span style="font-size:0.75rem; color:var(--text-muted); margin-left:6px; font-weight:400;">• ${escapeHtml(p.team)}</span>` : '';
    const drawStr = p.event_draws ? ` - ${p.event_draws}D` : '';

    const hasPlacement = Boolean(p.placement && p.placement > 0);
    const hasMatchesPlayed = Boolean(eventHasAnyMatches && ((p.event_matches_count && p.event_matches_count > 0) || (p.event_wins && p.event_wins > 0) || (p.event_losses && p.event_losses > 0)));

    const rankDisplay = (hasMatchesPlayed && hasPlacement)
      ? `#${p.placement}`
      : (hasMatchesPlayed && p.rank && p.rank > 0 ? `#${p.rank}` : `#${idx + 1}`);

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

    const netElo = Number(p.event_net_elo || 0);
    const netEloStr = netElo > 0 ? `+${netElo.toFixed(1)}` : netElo.toFixed(1);
    const netEloColor = netElo > 0 ? '#4ade80' : (netElo < 0 ? '#f87171' : 'var(--text-muted)');
    const netEloBg = netElo > 0 ? 'rgba(34,197,94,0.14)' : (netElo < 0 ? 'rgba(239,68,68,0.14)' : 'rgba(255,255,255,0.06)');
    const netEloBorder = netElo > 0 ? 'rgba(34,197,94,0.3)' : (netElo < 0 ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.12)');
    const netEloBadge = hasMatchesPlayed
      ? `<span class="badge" style="font-family:var(--font-mono); font-size:0.72rem; padding:1px 6px; margin-left:6px; background:${netEloBg}; color:${netEloColor}; border:1px solid ${netEloBorder}; font-weight:700;" title="Tournament Net Elo Change">${netEloStr}</span>`
      : '';

    const displayFac = formatEventPlayerFaction(p.faction || p.army_name);

    tr.innerHTML = `
      <td class="rank-cell">${rankDisplay}</td>
      <td style="max-width:220px;">
        <div class="player-name-cell">
          <span class="player-link" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(p.full_name || 'Player')}">${escapeHtml(p.full_name || 'Player')}</span>
          ${teamHtml}
        </div>
      </td>
      <td style="max-width:200px;">
        ${displayFac && displayFac !== '-' ? `
          <span class="badge" title="${escapeHtml(displayFac)}${p.detachment ? ` (${escapeHtml(p.detachment)})` : ''}" style="background:var(--bg-card); border:1px solid var(--border); max-width:190px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-block; vertical-align:middle;">
            ${escapeHtml(displayFac)}${p.detachment ? `<span style="color:var(--text-muted); font-weight:400;"> (${escapeHtml(p.detachment)})</span>` : ''}
          </span>
        ` : `<span style="color:var(--text-muted); font-size:0.85rem; font-weight:500;">-</span>`}
      </td>
      ${recordDisplay}
      ${pointsDisplay}
      <td>
        <div style="display:inline-flex; align-items:center;">
          <span class="elo-badge ${eloBadgeClass}">${Number(p.current_elo || 1500).toFixed(1)}</span>
          ${netEloBadge}
        </div>
      </td>
      <td style="text-align: right;">
        ${hasPlayerSubmittedList(p) ? `
          <button type="button" class="btn-sm btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(safePid || safeName)}')" style="font-size:0.74rem; padding:3px 9px; font-weight:600; cursor:pointer;" title="View submitted army roster">
            📋 Roster
          </button>
        ` : `<span style="color:var(--text-muted); font-size:0.85rem; padding-right:0.45rem;">—</span>`}
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
    tr.onclick = (e) => { e.stopPropagation(); openPlayerModal(p.player_id, p.full_name || ''); };

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

  // Permission checks: Is current logged-in user Player 1, Player 2, or Staff (Admin/TO/Referee)?
  const u = (typeof authState !== 'undefined' && authState && authState.user) ||
            (typeof currentUser !== 'undefined' ? currentUser : null) ||
            (typeof window !== 'undefined' ? window.currentUser : null);

  const userRole = String(
    (u && (u.role || u.user_role)) ||
    (typeof authState !== 'undefined' && authState && (authState.role || (authState.user && authState.user.role))) ||
    ''
  ).trim().toLowerCase();

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
    [u.player_id, u.bcp_player_id, u.bcp_user_id, u.bcp_id, u.id, u.sub, u.userId].forEach(id => {
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

  // Look up cached player records in roster
  const allRosterPlayers = [
    ...(Array.isArray(eventPlayersCache) ? eventPlayersCache : []),
    ...((currentEventData && Array.isArray(currentEventData.players)) ? currentEventData.players : []),
    ...((currentEventData && Array.isArray(currentEventData.roster)) ? currentEventData.roster : [])
  ];

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

  matchesToRender.forEach(m => {
    try {
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

      const p1NameClean = (m.player1_name || '').trim().toLowerCase();
      const p2NameClean = (m.player2_name || '').trim().toLowerCase();
      const p1IdClean = (m.player1_id || '').trim().toLowerCase();
      const p2IdClean = (m.player2_id || '').trim().toLowerCase();

      const p1Record = allRosterPlayers.find(p => {
        if (!p) return false;
        const candidateIds = [p.player_id, p.id, p.bcp_event_player_id, p.user_id, p.userId].filter(Boolean).map(x => String(x).trim().toLowerCase());
        if (p1IdClean && candidateIds.includes(p1IdClean)) return true;
        const pname = String(p.full_name || p.name || p.player_name || '').trim().toLowerCase();
        if (p1NameClean && pname && checkNameMatch(pname, p1NameClean)) return true;
        return false;
      });

      const p2Record = allRosterPlayers.find(p => {
        if (!p) return false;
        const candidateIds = [p.player_id, p.id, p.bcp_event_player_id, p.user_id, p.userId].filter(Boolean).map(x => String(x).trim().toLowerCase());
        if (p2IdClean && candidateIds.includes(p2IdClean)) return true;
        const pname = String(p.full_name || p.name || p.player_name || '').trim().toLowerCase();
        if (p2NameClean && pname && checkNameMatch(pname, p2NameClean)) return true;
        return false;
      });

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

      // Paired competitors and the specific Tournament Organizer/Admin can launch and update the match tracker.
      // Non-staff competitors and casual spectators spectate via the live scorecard.
      const canEdit = Boolean(isP1 || isP2 || isStaff);

      let actionBtn = '';
      if (!isBye) {
        // 1. If game was actually completed with digital scorecard in tracker_games
        if (hasTrackerGame && (isTrackerDone || hasScore)) {
          actionBtn = `<button class="btn-sm btn-outline" style="font-size:0.72rem; padding:0.2rem 0.5rem; display:inline-flex; align-items:center; gap:0.3rem; cursor:pointer;" onclick="event.stopPropagation(); openScorecardModal('${matchId}')" title="View turn-by-turn digital scorecard">📄 Scorecard</button>`;
        } 
        // 2. If match is ongoing/uncompleted and user has competitor/staff permissions to edit/track
        else if (!hasScore && canEdit) {
          const safeEventId = String(eventId).replace(/'/g, "\\'");
          const safeP1Name = String(m.player1_name || 'Player 1').replace(/'/g, "\\'");
          const safeP2Name = String(m.player2_name || 'Player 2').replace(/'/g, "\\'");
          const safeP1Id = String(m.player1_id || '').replace(/'/g, "\\'");
          const safeP2Id = String(m.player2_id || '').replace(/'/g, "\\'");
          const safePairingId = String(m.id || m.pairing_id || m.bcp_pairing_id || '').replace(/'/g, "\\'");
          const btnLabel = hasTrackerGame ? '🎮 Resume' : '🎲 Track';
          actionBtn = `<button class="btn-sm" style="font-size:0.72rem; padding:0.2rem 0.55rem; background:#0284c7; color:#fff; border:1px solid #38bdf8; border-radius:6px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:0.3rem;" onclick="event.stopPropagation(); launchTournamentTracker('${safeEventId}', ${m.round || 1}, ${m.table_number || m.table || 1}, '${escapeHtml(safeP1Name)}', '${escapeHtml(safeP2Name)}', '${escapeHtml(safeP1Id)}', '${escapeHtml(safeP2Id)}', '${escapeHtml(safePairingId)}')" title="1-Click Launch Game Tracker for Table ${m.table_number || m.table || 1}">${btnLabel}</button>`;
        } 
        // 3. If match is ongoing/uncompleted and user is a spectator / other competitor
        else if (!hasScore && !canEdit) {
          const safeEventId = String(eventId).replace(/'/g, "\\'");
          const safeP1Name = String(m.player1_name || 'Player 1').replace(/'/g, "\\'");
          const safeP2Name = String(m.player2_name || 'Player 2').replace(/'/g, "\\'");
          const safeP1Id = String(m.player1_id || '').replace(/'/g, "\\'");
          const safeP2Id = String(m.player2_id || '').replace(/'/g, "\\'");
          const safePairingId = String(m.id || m.pairing_id || m.bcp_pairing_id || '').replace(/'/g, "\\'");
          const spectateLabel = hasTrackerGame ? '👁️ Spectate Live' : '👁️ Spectate';
          actionBtn = `<button class="btn-sm btn-outline" style="font-size:0.72rem; padding:0.2rem 0.55rem; display:inline-flex; align-items:center; gap:0.3rem; border-color:#6366f1; color:#a5b4fc; background:rgba(99, 102, 241, 0.12); border-radius:6px; font-weight:600; cursor:pointer;" onclick="event.stopPropagation(); spectateTournamentTracker('${safeEventId}', ${m.round || 1}, ${m.table_number || m.table || 1}, '${escapeHtml(safeP1Name)}', '${escapeHtml(safeP2Name)}', '${escapeHtml(safeP1Id)}', '${escapeHtml(safeP2Id)}', '${safePairingId}')" title="Spectate Table ${m.table_number || m.table || 1} match in live view-only mode">${spectateLabel}</button>`;
        }
      }

      const targetP1Id = String((p1Record && p1Record.player_id) || m.player1_id || '').replace(/'/g, "\\'");
      const targetP1Name = String((p1Record && (p1Record.full_name || p1Record.name)) || m.player1_name || '').replace(/'/g, "\\'");
      const targetP2Id = String((p2Record && p2Record.player_id) || m.player2_id || '').replace(/'/g, "\\'");
      const targetP2Name = String((p2Record && (p2Record.full_name || p2Record.name)) || m.player2_name || '').replace(/'/g, "\\'");

      const p1Prob = m._p1_win_prob !== undefined ? m._p1_win_prob : 50;
      const p2Prob = m._p2_win_prob !== undefined ? m._p2_win_prob : 50;
      const p1ProbPill = !isBye ? `<span class="badge" style="background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.28); font-size:0.68rem; font-family:var(--font-mono); margin-left:6px; padding:1px 5px;" title="Elo Win Probability">${p1Prob}%</span>` : '';
      const p2ProbPill = !isBye ? `<span class="badge" style="background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.28); font-size:0.68rem; font-family:var(--font-mono); margin-left:6px; padding:1px 5px;" title="Elo Win Probability">${p2Prob}%</span>` : '';

      tr.innerHTML = `
        <td style="font-family:var(--font-mono); font-weight:700;">R${m.round || 1}</td>
        <td style="font-family:var(--font-mono); color:var(--text-muted);">T${m.table_number || 1}</td>
        <td>
          <div class="player-name-cell">
            <div style="display:flex; align-items:center; flex-wrap:wrap; gap:2px;">
              <span class="player-link" style="color:${isP1Win ? 'var(--win)' : '#fff'}; font-weight:600;" onclick="event.stopPropagation(); if (typeof openPlayerProfilePage === 'function' && '${targetP1Id}') { openPlayerProfilePage('${targetP1Id}'); } else { openPlayerModal('${targetP1Id}', '${escapeHtml(targetP1Name)}'); }">
                ${escapeHtml(m.player1_name || 'Player 1')}
              </span>
              ${p1ProbPill}
            </div>
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
            ${isBye
              ? `<span style="color:var(--text-muted); font-weight:600;">BYE</span>`
              : `<div style="display:flex; align-items:center; flex-wrap:wrap; gap:2px;">
                   <span class="player-link" style="color:${isP2Win ? 'var(--win)' : '#fff'}; font-weight:600;" onclick="event.stopPropagation(); if (typeof openPlayerProfilePage === 'function' && '${targetP2Id}') { openPlayerProfilePage('${targetP2Id}'); } else { openPlayerModal('${targetP2Id}', '${escapeHtml(targetP2Name)}'); }">
                     ${escapeHtml(m.player2_name || 'Player 2')}
                   </span>
                   ${p2ProbPill}
                 </div>`
            }
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
    } catch (rowErr) {
      console.error('Error rendering pairing row:', rowErr, m);
    }
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

/* ==========================================================================
   2-TIER EVENT ARCHITECTURE: QUICK-VIEW MODAL & DEDICATED EVENT HUB PAGE
   ========================================================================== */

let eventHubFactionFilter = 'All';
let quickModalViewMode = 'players';
let quickModalSearchQuery = '';
let currentArmyListModalPlayer = null;

function isEventEnded(ev, regData = null) {
  return Boolean(
    ev?.ended === true ||
    ev?.is_ended === true ||
    ev?.status?.ended === true ||
    ev?.raw_json?.ended === true ||
    ev?.raw_json?.isEnded === true ||
    ev?.raw_json?.status?.ended === true ||
    regData?.ended === true ||
    regData?.is_ended === true ||
    regData?.status?.ended === true
  );
}

function getEventTierBadgeHtml(totalPlayers) {
  const count = Number(totalPlayers || 0);
  if (count >= 100) {
    return `<span class="badge" style="background:rgba(234,179,8,0.18); color:#facc15; border:1px solid rgba(234,179,8,0.4); font-weight:800; font-size:0.72rem; letter-spacing:0.04em;">👑 SUPER MAJOR</span>`;
  } else if (count >= 60) {
    return `<span class="badge" style="background:rgba(168,85,247,0.18); color:#c084fc; border:1px solid rgba(168,85,247,0.4); font-weight:800; font-size:0.72rem; letter-spacing:0.04em;">🏆 MAJOR</span>`;
  } else if (count >= 28) {
    return `<span class="badge" style="background:rgba(56,189,248,0.18); color:#38bdf8; border:1px solid rgba(56,189,248,0.4); font-weight:800; font-size:0.72rem; letter-spacing:0.04em;">⚔️ GT</span>`;
  }
  return `<span class="badge" style="background:rgba(148,163,184,0.16); color:#cbd5e1; border:1px solid rgba(148,163,184,0.35); font-weight:800; font-size:0.72rem; letter-spacing:0.04em;">🛡️ RTT</span>`;
}

function computeEventPlayerEloStats(players, matches) {
  if (!Array.isArray(players)) return [];
  const pMap = new Map();
  players.forEach(p => {
    if (!p.current_elo && p.elo) p.current_elo = p.elo;
    if (!p.full_name && (p.player_name || p.name)) p.full_name = p.player_name || p.name;
    if (p.event_wins === undefined && p.wins !== undefined) p.event_wins = Number(p.wins || 0);
    if (p.event_losses === undefined && p.losses !== undefined) p.event_losses = Number(p.losses || 0);
    if (p.event_draws === undefined && p.draws !== undefined) p.event_draws = Number(p.draws || 0);
    if (p.event_battle_points === undefined && p.battle_points !== undefined) p.event_battle_points = Number(p.battle_points || 0);
    p.event_matches_count = (Number(p.event_wins || 0) + Number(p.event_losses || 0) + Number(p.event_draws || 0)) || p.event_matches_count || 0;
    const pid = String(p.player_id || p.id || '').trim().toLowerCase();
    const pname = String(p.full_name || p.name || '').trim().toLowerCase();
    p._computed_net_elo = (p.net_elo !== undefined && p.net_elo !== null) ? Number(p.net_elo) :
                          (p.elo_delta !== undefined && p.elo_delta !== null) ? Number(p.elo_delta) : 0;
    p._has_explicit_delta = (p.net_elo !== undefined && p.net_elo !== null) || (p.elo_delta !== undefined && p.elo_delta !== null);
    if (pid) pMap.set(pid, p);
    if (pname) pMap.set(pname, p);
  });

  if (Array.isArray(matches) && matches.length > 0) {
    matches.forEach(m => {
      const isBye = Boolean(m.is_bye || m.player2_name === 'BYE' || !m.player2_id);
      if (isBye) return;

      const p1Id = String(m.player1_id || '').trim().toLowerCase();
      const p1Name = String(m.player1_name || '').trim().toLowerCase();
      const p2Id = String(m.player2_id || '').trim().toLowerCase();
      const p2Name = String(m.player2_name || '').trim().toLowerCase();

      const p1Rec = pMap.get(p1Id) || pMap.get(p1Name);
      const p2Rec = pMap.get(p2Id) || pMap.get(p2Name);

      const elo1 = Number(m.player1_elo || p1Rec?.current_elo || p1Rec?.elo || 1500);
      const elo2 = Number(m.player2_elo || p2Rec?.current_elo || p2Rec?.elo || 1500);

      const exp1 = 1 / (1 + Math.pow(10, (elo2 - elo1) / 400));
      const exp2 = 1 - exp1;
      m._p1_win_prob = Math.round(exp1 * 100);
      m._p2_win_prob = Math.round(exp2 * 100);
      m._p1_elo = elo1;
      m._p2_elo = elo2;

      const outcomeStr = String(m.outcome || '').toLowerCase();
      const hasScores = m.player1_score !== null && m.player1_score !== undefined && m.player2_score !== null && m.player2_score !== undefined;
      const isP1Win = Boolean(
        (m.winner_id && String(m.winner_id) === String(m.player1_id)) ||
        outcomeStr.includes('player 1 win') ||
        (hasScores && Number(m.player1_score) > Number(m.player2_score))
      );
      const isP2Win = Boolean(
        (m.winner_id && String(m.winner_id) === String(m.player2_id)) ||
        outcomeStr.includes('player 2 win') ||
        (hasScores && Number(m.player2_score) > Number(m.player1_score))
      );
      const isDraw = Boolean(m.is_draw || outcomeStr.includes('draw') || (!isP1Win && !isP2Win && hasScores && Number(m.player1_score) === Number(m.player2_score)));
      const hasResult = isP1Win || isP2Win || isDraw;
      m._is_p1_win = isP1Win;
      m._is_p2_win = isP2Win;
      m._is_draw = isDraw;
      if (isP1Win && !m.winner_id) m.winner_id = m.player1_id;
      if (isP2Win && !m.winner_id) m.winner_id = m.player2_id;

      if (hasResult) {
        const s1 = isP1Win ? 1.0 : (isP2Win ? 0.0 : 0.5);
        const s2 = 1.0 - s1;
        const d1 = (m.player1_delta !== undefined && m.player1_delta !== null) ? Number(m.player1_delta) : (32 * (s1 - exp1));
        const d2 = (m.player2_delta !== undefined && m.player2_delta !== null) ? Number(m.player2_delta) : (32 * (s2 - exp2));
        m._p1_delta = d1;
        m._p2_delta = d2;

        if (p1Rec && !p1Rec._has_explicit_delta) p1Rec._computed_net_elo += d1;
        if (p2Rec && !p2Rec._has_explicit_delta) p2Rec._computed_net_elo += d2;
      }
    });
  }

  players.forEach(p => {
    const cur = Number(p.current_elo || p.elo || 1500);
    const net = Number(p._computed_net_elo || 0);
    p.event_net_elo = net;
    p.net_elo = net;
    p.start_elo = (p.start_elo !== undefined && p.start_elo !== null) ? Number(p.start_elo) : (cur - net);
  });

  return players;
}

function getEventKpiSummary(ev) {
  const players = Array.isArray(ev?.players) ? ev.players : (Array.isArray(eventPlayersCache) ? eventPlayersCache : []);
  const matches = Array.isArray(ev?.matches) ? ev.matches : (Array.isArray(eventMatchesCache) ? eventMatchesCache : []);
  const teams = (ev?.teams && ev.teams.length > 0) ? ev.teams : (ev?.team_standings || []);
  const isTeamEvent = Boolean(ev?.is_team_event || teams.length > 0);
  const isDoublesEvent = Boolean(ev?.is_doubles_event);
  const totalPlayers = ev?.total_players || players.length || 0;
  const totalTeams = ev?.total_teams || teams.length || 0;
  const numRounds = ev?.num_rounds || (matches.length > 0 ? Math.max(...matches.map(m => m.round || 1)) : 5);
  const ended = isEventEnded(ev);
  const hasMatchesPlayed = matches.length > 0 || players.some(p => (p.event_wins || p.wins || 0) > 0 || (p.event_losses || p.losses || 0) > 0 || (p.placement && p.placement > 0));

  const elos = players.map(p => Number(p.current_elo || p.elo || 1500)).filter(e => !isNaN(e) && e > 0);
  const avgElo = elos.length > 0 ? (elos.reduce((a, b) => a + b, 0) / elos.length) : 1500;
  const topSeedPlayer = players.slice().sort((a, b) => Number(b.current_elo || b.elo || 1500) - Number(a.current_elo || a.elo || 1500))[0] || null;

  // Champion / Leader
  let leaderTitle = ended ? '👑 Event Champion' : (hasMatchesPlayed ? '🔥 Current Leader' : '⭐ Top Seed');
  let leaderName = 'TBD';
  let leaderSub = 'Awaiting Round 1';

  if (isTeamEvent && teams.length > 0 && hasMatchesPlayed) {
    const topTeam = teams.slice().sort((a, b) => {
      const pA = (a.placing && a.placing > 0) ? a.placing : 999;
      const pB = (b.placing && b.placing > 0) ? b.placing : 999;
      if (pA !== pB) return pA - pB;
      return Number(b.match_points || b.wins || 0) - Number(a.match_points || a.wins || 0);
    })[0];
    if (topTeam) {
      leaderName = topTeam.name || 'Team #1';
      leaderSub = `${topTeam.wins !== undefined ? topTeam.wins + 'W • ' : ''}${topTeam.match_points || topTeam.battle_points || topTeam.points || 0} BP`;
    }
  } else if (players.length > 0) {
    if (hasMatchesPlayed) {
      const topPlayer = players.slice().sort((a, b) => {
        const plA = (a.placement && a.placement > 0) ? a.placement : 9999;
        const plB = (b.placement && b.placement > 0) ? b.placement : 9999;
        if (plA !== plB) return plA - plB;
        const wA = Number(a.event_wins || a.wins || 0);
        const wB = Number(b.event_wins || b.wins || 0);
        if (wA !== wB) return wB - wA;
        return Number(b.event_battle_points || b.battle_points || 0) - Number(a.event_battle_points || a.battle_points || 0);
      })[0];
      if (topPlayer) {
        leaderName = topPlayer.full_name || topPlayer.player_name || topPlayer.name || 'Competitor';
        const recStr = `${topPlayer.event_wins || topPlayer.wins || 0}W-${topPlayer.event_losses || topPlayer.losses || 0}L${topPlayer.event_draws || topPlayer.draws ? '-' + (topPlayer.event_draws || topPlayer.draws) + 'D' : ''}`;
        const topPlayerFac = formatEventPlayerFaction(topPlayer.faction || topPlayer.army_name);
        leaderSub = (topPlayerFac && topPlayerFac !== '-') ? `${topPlayerFac} • ${recStr}` : recStr;
      }
    } else if (topSeedPlayer) {
      leaderName = topSeedPlayer.full_name || topSeedPlayer.player_name || topSeedPlayer.name || 'Competitor';
      const seedFac = formatEventPlayerFaction(topSeedPlayer.faction || topSeedPlayer.army_name);
      leaderSub = (seedFac && seedFac !== '-')
        ? `${seedFac} • ${Number(topSeedPlayer.current_elo || topSeedPlayer.elo || 1500).toFixed(1)} Elo`
        : `${Number(topSeedPlayer.current_elo || topSeedPlayer.elo || 1500).toFixed(1)} Elo`;
    }
  }

  return {
    totalPlayers,
    totalTeams,
    isTeamEvent,
    isDoublesEvent,
    numRounds,
    ended,
    hasMatchesPlayed,
    avgElo,
    topSeedPlayer,
    leaderTitle,
    leaderName,
    leaderSub,
    teams,
    players,
    matches
  };
}

function renderQuickEventModal(ev, userRegData) {
  if (!ev) return;
  const kpi = getEventKpiSummary(ev);
  const sys = (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k').toLowerCase();
  const sysBadge = sys === 'aos'
    ? `<span class="badge" style="background:rgba(245,158,11,0.16); color:#fbbf24; border:1px solid rgba(245,158,11,0.35); font-size:0.72rem; font-weight:700;">⚡ Age of Sigmar</span>`
    : `<span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; border:1px solid rgba(56,189,248,0.35); font-size:0.72rem; font-weight:700;">⚔️ Warhammer 40K</span>`;

  const statusBadge = kpi.ended
    ? `<span class="badge" style="background:rgba(34,197,94,0.16); color:#4ade80; border:1px solid rgba(34,197,94,0.35); font-size:0.72rem; font-weight:700;">🟢 COMPLETED</span>`
    : (kpi.hasMatchesPlayed
        ? `<span class="badge" style="background:rgba(239,68,68,0.18); color:#f87171; border:1px solid rgba(239,68,68,0.4); font-size:0.72rem; font-weight:700;">🔴 LIVE IN PROGRESS</span>`
        : `<span class="badge" style="background:rgba(56,189,248,0.16); color:#38bdf8; border:1px solid rgba(56,189,248,0.35); font-size:0.72rem; font-weight:700;">🔵 UPCOMING</span>`);

  const formatBadge = kpi.isTeamEvent
    ? `<span class="badge" style="background:rgba(168,85,247,0.16); color:#c084fc; border:1px solid rgba(168,85,247,0.35); font-size:0.72rem; font-weight:700;">${kpi.isDoublesEvent ? '👥 DOUBLES' : '🛡️ TEAM TOURNAMENT'}</span>`
    : `<span class="badge" style="background:rgba(255,255,255,0.06); color:#cbd5e1; border:1px solid rgba(255,255,255,0.15); font-size:0.72rem; font-weight:600;">👤 SINGLES</span>`;

  const badgesEl = document.getElementById('modal-event-badges');
  if (badgesEl) {
    badgesEl.innerHTML = `${getEventTierBadgeHtml(kpi.totalPlayers)} ${sysBadge} ${statusBadge} ${formatBadge}`;
  }

  // Personal Registration Status Banner
  const regBanner = document.getElementById('modal-quick-reg-banner');
  if (regBanner) {
    if (userRegData && userRegData.is_registered && !kpi.ended) {
      const preg = userRegData.player_registration || userRegData.player || {};
      const checkedIn = Boolean(preg.checked_in);
      const dropped = Boolean(preg.dropped);
      const fac = formatEventPlayerFaction(preg.faction || preg.army_name || 'Faction Pending');
      const statusText = dropped ? '🚫 Dropped' : (checkedIn ? '✅ Checked In' : '⚠️ Not Checked In');
      regBanner.style.display = 'block';
      regBanner.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.75rem; padding:0.65rem 0.95rem; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.35); border-radius:8px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:0.5rem; font-size:0.82rem; color:#ecfdf5;">
            <span style="font-size:1rem;">🟢</span>
            <div>
              <strong style="color:#10b981;">You are registered for this event</strong>
              <span style="color:var(--text-secondary); margin-left:0.35rem;">• ${statusText} • ${escapeHtml(fac)}</span>
            </div>
          </div>
          <button type="button" onclick="openEventHubFromModal('player')" class="btn-sm btn-primary" style="background:#10b981; border-color:#059669; color:#fff; font-weight:700; font-size:0.76rem; padding:0.35rem 0.85rem; cursor:pointer;">
            👤 Manage Registration & Check-In ➔
          </button>
        </div>
      `;
    } else {
      regBanner.style.display = 'none';
      regBanner.innerHTML = '';
    }
  }

  // 4-Card Quick KPI Strip
  const kpisEl = document.getElementById('modal-quick-kpis');
  if (kpisEl) {
    const compPrimary = kpi.isTeamEvent && kpi.totalTeams > 0
      ? `${kpi.totalTeams} ${kpi.isDoublesEvent ? 'Pairs' : 'Teams'}`
      : `${kpi.totalPlayers} Players`;
    const compSub = kpi.isTeamEvent && kpi.totalTeams > 0
      ? `${kpi.totalPlayers} Competitors`
      : `${kpi.players.filter(p => p.checked_in).length || kpi.totalPlayers} Active`;

    const topSeedName = kpi.topSeedPlayer ? (kpi.topSeedPlayer.full_name || 'Player') : '-';
    const topSeedElo = kpi.topSeedPlayer ? Number(kpi.topSeedPlayer.current_elo || 1500).toFixed(1) : '-';

    kpisEl.innerHTML = `
      <div class="card" style="padding:0.7rem 0.85rem; background:rgba(15,23,42,0.75); border:1px solid rgba(255,255,255,0.08); border-radius:8px;">
        <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:0.2rem;">👥 Competitors</div>
        <div style="font-size:1.05rem; font-weight:800; color:#fff; font-family:var(--font-mono);">${escapeHtml(compPrimary)}</div>
        <div style="font-size:0.72rem; color:var(--text-secondary); margin-top:0.15rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(compSub)}</div>
      </div>
      <div class="card" style="padding:0.7rem 0.85rem; background:rgba(15,23,42,0.75); border:1px solid rgba(255,255,255,0.08); border-radius:8px;">
        <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:0.2rem;">🎲 Format & Rounds</div>
        <div style="font-size:1.05rem; font-weight:800; color:#38bdf8; font-family:var(--font-mono);">${kpi.numRounds} Rounds</div>
        <div style="font-size:0.72rem; color:var(--text-secondary); margin-top:0.15rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${kpi.isTeamEvent ? 'Team Format' : 'Singles Format'} • ${kpi.matches.length} Matches</div>
      </div>
      <div class="card" style="padding:0.7rem 0.85rem; background:rgba(15,23,42,0.75); border:1px solid rgba(255,255,255,0.08); border-radius:8px;">
        <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:0.2rem;">⚡ Field Strength</div>
        <div style="font-size:1.05rem; font-weight:800; color:#facc15; font-family:var(--font-mono);">${kpi.avgElo.toFixed(1)} Avg Elo</div>
        <div style="font-size:0.72rem; color:var(--text-secondary); margin-top:0.15rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="Top Seed: ${escapeHtml(topSeedName)} (${topSeedElo})">#1: ${escapeHtml(topSeedName)} (${topSeedElo})</div>
      </div>
      <div class="card" style="padding:0.7rem 0.85rem; background:rgba(15,23,42,0.75); border:1px solid rgba(255,255,255,0.08); border-radius:8px;">
        <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:0.2rem;">${kpi.leaderTitle}</div>
        <div style="font-size:0.98rem; font-weight:800; color:#4ade80; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(kpi.leaderName)}">${escapeHtml(kpi.leaderName)}</div>
        <div style="font-size:0.72rem; color:var(--text-secondary); margin-top:0.15rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(kpi.leaderSub)}</div>
      </div>
    `;
  }

  // Toggle button for team events
  const toggleWrap = document.getElementById('modal-quick-view-toggle');
  if (toggleWrap) {
    if (kpi.isTeamEvent && kpi.teams.length > 0) {
      toggleWrap.style.display = 'inline-flex';
      setQuickModalViewMode('teams', false);
    } else {
      toggleWrap.style.display = 'none';
      setQuickModalViewMode('players', false);
    }
  } else {
    quickModalViewMode = 'players';
  }

  const qSearch = document.getElementById('modal-quick-search');
  if (qSearch) qSearch.value = '';
  quickModalSearchQuery = '';
  renderQuickModalTable();
}

function setQuickModalViewMode(mode, shouldRender = true) {
  quickModalViewMode = mode === 'teams' ? 'teams' : 'players';
  const btnTeams = document.getElementById('btn-quick-toggle-teams');
  const btnPlayers = document.getElementById('btn-quick-toggle-players');
  if (btnTeams) {
    btnTeams.classList.toggle('active', quickModalViewMode === 'teams');
    btnTeams.style.background = quickModalViewMode === 'teams' ? 'var(--accent, #0284c7)' : 'transparent';
    btnTeams.style.color = quickModalViewMode === 'teams' ? '#fff' : 'var(--text-secondary)';
  }
  if (btnPlayers) {
    btnPlayers.classList.toggle('active', quickModalViewMode === 'players');
    btnPlayers.style.background = quickModalViewMode === 'players' ? 'var(--accent, #0284c7)' : 'transparent';
    btnPlayers.style.color = quickModalViewMode === 'players' ? '#fff' : 'var(--text-secondary)';
  }
  if (shouldRender) renderQuickModalTable();
}

function handleQuickModalSearch(val) {
  quickModalSearchQuery = (val || '').trim().toLowerCase();
  renderQuickModalTable();
}

function renderQuickModalTable() {
  const thead = document.getElementById('modal-quick-thead');
  const tbody = document.getElementById('modal-quick-tbody');
  if (!thead || !tbody) return;

  const kpi = getEventKpiSummary(currentEventData);

  if (quickModalViewMode === 'teams' && kpi.teams.length > 0) {
    thead.innerHTML = `
      <tr>
        <th style="width:65px; padding:0.55rem 0.75rem;">Rank</th>
        <th style="padding:0.55rem 0.75rem;">Team</th>
        <th style="padding:0.55rem 0.75rem;">Captain / Members</th>
        <th style="padding:0.55rem 0.75rem;">Match Points</th>
        <th style="padding:0.55rem 0.75rem;">Battle Points</th>
      </tr>
    `;
    let filteredTeams = kpi.teams;
    if (quickModalSearchQuery) {
      filteredTeams = kpi.teams.filter(t => {
        const name = (t.name || '').toLowerCase();
        const cap = (t.captain_name || t.captain || '').toLowerCase();
        return name.includes(quickModalSearchQuery) || cap.includes(quickModalSearchQuery);
      });
    }
    if (filteredTeams.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state" style="padding:1.75rem;">No teams match "${escapeHtml(quickModalSearchQuery)}"</td></tr>`;
      return;
    }
    tbody.innerHTML = filteredTeams.map((t, i) => {
      const rank = t.placing && t.placing > 0 ? `#${t.placing}` : `#${i + 1}`;
      const cap = t.captain_name || t.captain || (Array.isArray(t.members) && t.members[0]?.full_name) || '-';
      const memberCount = Array.isArray(t.members) ? ` (${t.members.length} players)` : '';
      return `
        <tr style="cursor:pointer;" onclick="openEventHubFromModal('teams')">
          <td class="rank-cell" style="padding:0.5rem 0.75rem;">${rank}</td>
          <td style="padding:0.5rem 0.75rem; font-weight:700; color:#fff;">🛡️ ${escapeHtml(t.name || 'Team')}</td>
          <td style="padding:0.5rem 0.75rem; color:var(--text-secondary); font-size:0.82rem;">${escapeHtml(cap)}${memberCount}</td>
          <td style="padding:0.5rem 0.75rem; font-family:var(--font-mono); font-weight:700; color:var(--win);">${t.match_points ?? t.wins ?? '-'} pts</td>
          <td style="padding:0.5rem 0.75rem; font-family:var(--font-mono); font-weight:700; color:var(--accent);">${t.battle_points ?? '-'} BP</td>
        </tr>
      `;
    }).join('');
    return;
  }

  // Default: Players Standings / Roster view
  thead.innerHTML = `
    <tr>
      <th style="width:55px; text-align:center; padding:0.55rem 0.6rem;">Rank</th>
      <th style="min-width:130px; padding:0.55rem 0.65rem;">Competitor</th>
      <th style="min-width:110px; max-width:160px; padding:0.55rem 0.65rem;">Faction</th>
      <th style="width:105px; text-align:center; padding:0.55rem 0.65rem;">Record / Status</th>
      <th style="width:95px; text-align:center; padding:0.55rem 0.65rem;">Elo & Net Δ</th>
      <th style="width:60px; text-align:right; padding:0.55rem 0.65rem;">List</th>
    </tr>
  `;

  let players = kpi.players.slice();
  if (kpi.hasMatchesPlayed) {
    players.sort((a, b) => {
      const plA = (a.placement && a.placement > 0) ? a.placement : 9999;
      const plB = (b.placement && b.placement > 0) ? b.placement : 9999;
      if (plA !== plB) return plA - plB;
      return Number(b.current_elo || 1500) - Number(a.current_elo || 1500);
    });
  } else {
    players.sort((a, b) => Number(b.current_elo || 1500) - Number(a.current_elo || 1500));
  }

  if (quickModalSearchQuery) {
    players = players.filter(p => {
      const name = (p.full_name || '').toLowerCase();
      const fac = formatEventPlayerFaction(p.faction || p.army_name).toLowerCase();
      const team = (p.team || '').toLowerCase();
      return name.includes(quickModalSearchQuery) || fac.includes(quickModalSearchQuery) || team.includes(quickModalSearchQuery);
    });
  }

  if (players.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="padding:1.75rem;">No competitors match "${escapeHtml(quickModalSearchQuery)}"</td></tr>`;
    return;
  }

  tbody.innerHTML = players.map((p, idx) => {
    const safePid = String(p.player_id || p.id || '').trim();
    const safeName = String(p.full_name || 'Player').trim();
    const displayFac = formatEventPlayerFaction(p.faction || p.army_name);
    const hasPlacement = Boolean(p.placement && p.placement > 0);
    const rankStr = (kpi.hasMatchesPlayed && hasPlacement) ? `#${p.placement}` : `#${idx + 1}`;
    const drawStr = p.event_draws ? `-${p.event_draws}D` : '';
    const recordHtml = kpi.hasMatchesPlayed
      ? `<span style="font-family:var(--font-mono); font-weight:700; color:var(--win);">${p.event_wins || 0}W-${p.event_losses || 0}L${drawStr}</span>`
      : (p.checked_in ? `<span style="color:var(--win); font-weight:600; font-size:0.8rem;">✅ Checked In</span>` : `<span style="color:var(--text-muted); font-size:0.8rem;">Registered</span>`);

    const netElo = Number(p.event_net_elo || 0);
    const netEloStr = netElo > 0 ? `+${netElo.toFixed(1)}` : netElo.toFixed(1);
    const netEloColor = netElo > 0 ? '#4ade80' : (netElo < 0 ? '#f87171' : 'var(--text-muted)');
    const netPill = kpi.hasMatchesPlayed
      ? `<span style="font-family:var(--font-mono); font-size:0.72rem; font-weight:700; color:${netEloColor}; margin-left:5px;">(${netEloStr})</span>`
      : '';

    return `
      <tr style="cursor:pointer;" onclick="event.stopPropagation(); closeModal('event-modal'); if (typeof openPlayerProfilePage === 'function' && '${safePid}') { openPlayerProfilePage('${safePid}'); } else { openPlayerModal('${safePid}', '${escapeHtml(safeName)}'); }">
        <td class="rank-cell" style="width:55px; text-align:center; padding:0.5rem 0.6rem;">${rankStr}</td>
        <td style="min-width:130px; max-width:180px; padding:0.5rem 0.65rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          <div style="font-weight:600; color:#38bdf8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(safeName)}">${escapeHtml(safeName)}</div>
          ${p.team ? `<div style="font-size:0.72rem; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(p.team)}">🛡️ ${escapeHtml(p.team)}</div>` : ''}
        </td>
        <td style="min-width:110px; max-width:160px; padding:0.5rem 0.65rem;">
          ${displayFac && displayFac !== '-' ? `
            <span class="badge" title="${escapeHtml(displayFac)}${p.detachment ? ` (${escapeHtml(p.detachment)})` : ''}" style="background:var(--bg-card); border:1px solid var(--border); font-size:0.74rem; max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-block; vertical-align:middle;">
              ${escapeHtml(displayFac)}
            </span>
          ` : `<span style="color:var(--text-muted); font-size:0.85rem; font-weight:500;">-</span>`}
        </td>
        <td style="width:105px; text-align:center; padding:0.5rem 0.65rem; white-space:nowrap;">${recordHtml}</td>
        <td style="width:95px; text-align:center; padding:0.5rem 0.65rem; white-space:nowrap;">
          <span class="elo-badge ${getEloBadgeClass(p.current_elo)}" style="font-size:0.78rem;">${Number(p.current_elo || 1500).toFixed(1)}</span>
          ${netPill}
        </td>
        <td style="width:60px; padding:0.5rem 0.65rem; text-align:right;">
          ${hasPlayerSubmittedList(p) ? `
            <button type="button" class="btn-sm btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(safePid || safeName)}')" style="font-size:0.72rem; padding:2px 8px; cursor:pointer;" title="View submitted army roster">
              📋 List
            </button>
          ` : `<span style="color:var(--text-muted); font-size:0.85rem; padding-right:0.4rem;">—</span>`}
        </td>
      </tr>
    `;
  }).join('');
}

function openEventHubFromModal(explicitTab = null) {
  const eventId = currentOpenEventId || (currentEventData && currentEventData.id);
  if (!eventId) return;

  if (typeof closeModal === 'function') {
    closeModal('event-modal');
  } else {
    const modal = document.getElementById('event-modal');
    if (modal) {
      modal.classList.remove('active');
      modal.style.display = 'none';
    }
  }

  const sys = (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k').toLowerCase();
  const ended = isEventEnded(currentEventData, currentEventRegistration);
  const isRegistered = Boolean(currentEventRegistration && currentEventRegistration.is_registered);
  const isTeam = Boolean(currentEventData && (currentEventData.is_team_event || (currentEventData.teams && currentEventData.teams.length > 0)));

  let targetTab = explicitTab;
  if (!targetTab) {
    if (isRegistered && !ended) {
      targetTab = 'player';
    } else if (isTeam) {
      targetTab = 'teams';
    } else {
      targetTab = 'results';
    }
  }

  openEventHubPage(eventId, sys, { initialTab: targetTab });
}

async function openEventHubPage(eventId, gameSystem = '', options = {}) {
  if (!eventId) return;
  currentOpenEventId = eventId;

  const targetSys = (gameSystem || (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k')).toLowerCase();
  if (typeof currentGameSystem !== 'undefined' && targetSys !== currentGameSystem && typeof applyGameSystem === 'function') {
    applyGameSystem(targetSys, false);
  }

  // Switch active view to Dedicated Event Hub Page
  if (typeof switchTab === 'function') {
    switchTab('event-hub');
  } else {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById('tab-event-hub');
    if (panel) panel.classList.add('active');
  }

  // Update URL hash cleanly
  const cleanPath = (targetSys === 'aos') ? '/aos' : '';
  const targetHash = `#/${targetSys}/event/${encodeURIComponent(eventId)}`;
  if (window.history && window.history.pushState && !options.replaceUrl) {
    window.history.pushState({ eventId, sys: targetSys }, '', `${cleanPath || ''}${targetHash}`);
  } else if (window.history && window.history.replaceState) {
    window.history.replaceState({ eventId, sys: targetSys }, '', `${cleanPath || ''}${targetHash}`);
  }

  const heroSection = document.getElementById('event-hub-hero-section');
  const hasCached = Boolean(currentEventData && String(currentEventData.id) === String(eventId) && !options.forceSync);

  if (!hasCached && heroSection) {
    heroSection.innerHTML = `
      <div class="profile-hero-card" style="padding: 2.5rem 1.5rem; text-align: center; margin-bottom: 1.25rem;">
        <div class="spinner"></div>
        <div style="margin-top: 0.85rem; font-weight: 600; color: var(--text-secondary);">
          Loading ${targetSys === 'aos' ? 'AoS' : '40K'} Event Hub & BCP Standings...
        </div>
      </div>
    `;
  }

  try {
    let ev = currentEventData;
    let userRegData = currentEventRegistration;

    if (!hasCached) {
      const detailsPromise = window.api.getTournamentDetails(eventId, Boolean(options.forceSync));
      const regPromise = (typeof window.api?.getCommunityEventRegistration === 'function')
        ? window.api.getCommunityEventRegistration(eventId, Boolean(options.forceSync)).catch(() => null)
        : Promise.resolve(null);

      const [detailsRes, regRes] = await Promise.allSettled([detailsPromise, regPromise]);
      if (detailsRes.status === 'rejected' || !detailsRes.value || detailsRes.value.error) {
        throw new Error((detailsRes.value && detailsRes.value.error) || detailsRes.reason?.message || 'Tournament not found');
      }
      ev = detailsRes.value;
      userRegData = (regRes.status === 'fulfilled' && regRes.value && !regRes.value.error) ? regRes.value : null;
      currentEventData = ev;
      currentEventRegistration = (userRegData && userRegData.is_registered) ? userRegData : null;
    }

    eventMatchesCache = ev.matches || [];
    eventPlayersCache = ev.players || [];
    computeEventPlayerEloStats(eventPlayersCache, eventMatchesCache);

    renderEventHubHeroSection(ev, userRegData, targetSys);
    populateEventHubFactionFilter(eventPlayersCache);
    renderPersonalEventScorecard(ev, userRegData);
    renderEventMetaAndHighlights(ev);

    const isTeamEvent = Boolean(ev.is_team_event || (ev.teams && ev.teams.length > 0));
    const teamsList = (ev.teams && ev.teams.length > 0) ? ev.teams : (ev.team_standings || []);
    const subtabTeams = document.getElementById('event-subtab-teams');
    const tabTeamsCount = document.getElementById('event-tab-teams-count');
    const tabResultsCount = document.getElementById('event-tab-results-count');
    const tabMatchesCount = document.getElementById('event-tab-matches-count');

    if (tabResultsCount) tabResultsCount.innerText = eventPlayersCache.length;
    if (tabMatchesCount) tabMatchesCount.innerText = eventMatchesCache.length;

    if (isTeamEvent || teamsList.length > 0) {
      if (subtabTeams) subtabTeams.style.setProperty('display', 'inline-flex', 'important');
      if (tabTeamsCount) tabTeamsCount.innerText = teamsList.length;
      renderEventTeamsRows();
    } else {
      if (subtabTeams) subtabTeams.style.setProperty('display', 'none', 'important');
    }

    const ended = isEventEnded(ev, userRegData);
    const shouldShowPlayerTab = Boolean(userRegData && userRegData.is_registered && !ended);
    const subtabPlayer = document.getElementById('event-subtab-player');
    if (subtabPlayer) {
      subtabPlayer.style.setProperty('display', shouldShowPlayerTab ? 'inline-flex' : 'none', 'important');
    }
    if (shouldShowPlayerTab) {
      await populateEventPlayerDetails(userRegData);
    }

    renderEventResultsRows();
    renderEventEloRows();
    renderEventPairingsRows();

    let targetTab = options.initialTab;
    if (targetTab === 'teams' && !isTeamEvent && teamsList.length === 0) {
      targetTab = 'results';
    }
    if (targetTab === 'player' && !shouldShowPlayerTab) {
      targetTab = (isTeamEvent || teamsList.length > 0) ? 'teams' : 'results';
    }
    if (!targetTab) {
      if (shouldShowPlayerTab && !ended) {
        targetTab = 'player';
      } else if (isTeamEvent || teamsList.length > 0) {
        targetTab = 'teams';
      } else {
        targetTab = 'results';
      }
    }
    switchEventModalTab(targetTab);

  } catch (err) {
    if (heroSection) {
      heroSection.innerHTML = `
        <div class="profile-hero-card" style="padding: 2.5rem 1.5rem; text-align: center; color: var(--loss); margin-bottom: 1.25rem;">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
          <div style="font-weight: 700; font-size: 1.1rem; margin-bottom: 0.5rem;">Unable to load Event Hub</div>
          <p style="color: var(--text-muted); font-size: 0.85rem; margin: 0 auto 1.25rem;">${escapeHtml(err.message)}</p>
          <button class="btn btn-outline" onclick="openEventHubPage('${escapeHtml(eventId)}', '${targetSys}', { forceSync: true })">🔄 Retry</button>
        </div>
      `;
    }
  }
}

function renderEventHubHeroSection(ev, userRegData, gameSystem = '') {
  const heroSection = document.getElementById('event-hub-hero-section');
  if (!heroSection || !ev) return;

  const kpi = getEventKpiSummary(ev);
  const sys = (gameSystem || (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k')).toLowerCase();
  const eventId = ev.id || currentOpenEventId || '';
  const eventName = ev.name || ev.raw_json?.name || ev.event_name || 'Tournament Hub';
  const loc = [ev.venue, ev.city, ev.state, ev.country].filter(Boolean).join(', ') || 'Online / Unspecified';
  const dStr = (ev.event_date || '').slice(0, 10);

  const sysBadge = sys === 'aos'
    ? `<span class="badge" style="background:rgba(245,158,11,0.16); color:#fbbf24; border:1px solid rgba(245,158,11,0.35); font-size:0.75rem; font-weight:700;">⚡ Age of Sigmar</span>`
    : `<span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; border:1px solid rgba(56,189,248,0.35); font-size:0.75rem; font-weight:700;">⚔️ Warhammer 40K</span>`;

  const statusBadge = kpi.ended
    ? `<span class="badge" style="background:rgba(34,197,94,0.16); color:#4ade80; border:1px solid rgba(34,197,94,0.35); font-size:0.75rem; font-weight:700;">🟢 COMPLETED</span>`
    : (kpi.hasMatchesPlayed
        ? `<span class="badge" style="background:rgba(239,68,68,0.18); color:#f87171; border:1px solid rgba(239,68,68,0.4); font-size:0.75rem; font-weight:700;">🔴 LIVE IN PROGRESS</span>`
        : `<span class="badge" style="background:rgba(56,189,248,0.16); color:#38bdf8; border:1px solid rgba(56,189,248,0.35); font-size:0.75rem; font-weight:700;">🔵 UPCOMING</span>`);

  const formatBadge = kpi.isTeamEvent
    ? `<span class="badge" style="background:rgba(168,85,247,0.16); color:#c084fc; border:1px solid rgba(168,85,247,0.35); font-size:0.75rem; font-weight:700;">${kpi.isDoublesEvent ? '👥 DOUBLES' : '🛡️ TEAM TOURNAMENT'}</span>`
    : `<span class="badge" style="background:rgba(255,255,255,0.06); color:#cbd5e1; border:1px solid rgba(255,255,255,0.15); font-size:0.75rem; font-weight:600;">👤 SINGLES</span>`;

  // Meta Snapshot calculations
  const facCounts = new Map();
  const facStats = new Map();
  kpi.players.forEach(p => {
    const f = formatEventPlayerFaction(p.faction || p.army_name);
    if (!f || f === 'Unknown' || f === 'Unassigned' || f === 'Various') return;
    facCounts.set(f, (facCounts.get(f) || 0) + 1);
    if (!facStats.has(f)) facStats.set(f, { wins: 0, games: 0 });
    const st = facStats.get(f);
    const w = Number(p.event_wins || 0);
    const l = Number(p.event_losses || 0);
    const d = Number(p.event_draws || 0);
    st.wins += w;
    st.games += (w + l + d);
  });

  let mostPlayedFac = 'Various';
  let mostPlayedSub = 'Balanced Field';
  if (facCounts.size > 0) {
    const sortedFacs = Array.from(facCounts.entries()).sort((a, b) => b[1] - a[1]);
    const [topFac, topCount] = sortedFacs[0];
    const pct = Math.round((topCount / Math.max(1, kpi.totalPlayers)) * 100);
    mostPlayedFac = topFac;
    mostPlayedSub = `${topCount} Players (${pct}% of field)`;
  }

  let bestWrSub = 'Top Meta Contender';
  const eligibleWrFacs = Array.from(facStats.entries()).filter(([_, st]) => st.games >= 3);
  if (eligibleWrFacs.length > 0) {
    eligibleWrFacs.sort((a, b) => (b[1].wins / b[1].games) - (a[1].wins / a[1].games));
    const [bestFac, bestSt] = eligibleWrFacs[0];
    const wrPct = Math.round((bestSt.wins / bestSt.games) * 100);
    bestWrSub = `Best WR: ${bestFac} (${wrPct}% WR)`;
  }

  const topSeedName = kpi.topSeedPlayer ? (kpi.topSeedPlayer.full_name || 'Competitor') : '-';
  const topSeedElo = kpi.topSeedPlayer ? Number(kpi.topSeedPlayer.current_elo || 1500).toFixed(1) : '-';

  heroSection.innerHTML = `
    <div class="profile-hero-card event-hub-hero-card" style="margin-bottom: 1.25rem;">
      <div class="profile-hero-top">
        <div class="profile-identity-group">
          <div class="profile-rank-crest" title="Tournament Hub">
            🏆
          </div>
          <div class="profile-name-meta">
            <div class="profile-badges-row" style="margin-bottom: 0.35rem;">
              ${getEventTierBadgeHtml(kpi.totalPlayers)}
              ${sysBadge}
              ${statusBadge}
              ${formatBadge}
            </div>
            <h1 id="event-hub-title" class="profile-name-title" style="font-size: 1.5rem; margin: 0 0 0.3rem 0;">${escapeHtml(eventName)}</h1>
            <div style="font-size: 0.85rem; color: var(--text-secondary); display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <span>📅 ${escapeHtml(dStr || 'Date TBD')}</span>
              <span>•</span>
              <span>📍 ${escapeHtml(loc)}</span>
              <span>•</span>
              <span>🔄 ${kpi.numRounds} Rounds</span>
            </div>
          </div>
        </div>

        <div class="profile-hero-actions" style="display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap;">
          <button type="button" class="btn btn-outline" onclick="copyEventHubLink('${escapeHtml(eventId)}', '${sys}')" style="font-weight: 600; font-size: 0.82rem; padding: 0.48rem 0.95rem; cursor: pointer;">
            🔗 Share Event Link
          </button>
          <a href="https://www.bestcoastpairings.com/event/${encodeURIComponent(eventId)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="font-weight: 600; font-size: 0.82rem; padding: 0.48rem 0.95rem; text-decoration: none;">
            Listing on BCP ↗
          </a>
          <button type="button" class="btn btn-primary" onclick="openEventHubPage('${escapeHtml(eventId)}', '${sys}', { forceSync: true })" style="font-weight: 700; font-size: 0.82rem; padding: 0.48rem 1rem; cursor: pointer;">
            🔄 Refresh
          </button>
        </div>
      </div>

      <!-- 4 Hero KPI Cards -->
      <div class="profile-kpi-grid" style="margin-top: 1.2rem;">
        <div class="profile-kpi-card">
          <div class="profile-kpi-label">👥 Field & Format</div>
          <div class="profile-kpi-value">${kpi.isTeamEvent && kpi.totalTeams > 0 ? `${kpi.totalTeams} Teams` : `${kpi.totalPlayers} Players`}</div>
          <div class="profile-kpi-sub">${kpi.numRounds} Rounds • ${kpi.isTeamEvent ? `${kpi.totalPlayers} Players` : 'Singles'} • ${kpi.matches.length} Matches</div>
        </div>
        <div class="profile-kpi-card">
          <div class="profile-kpi-label">⚡ Field Strength</div>
          <div class="profile-kpi-value" style="color: #facc15;">${kpi.avgElo.toFixed(1)} <span style="font-size:0.8rem; font-weight:600;">Avg Elo</span></div>
          <div class="profile-kpi-sub" title="Top Seed: ${escapeHtml(topSeedName)} (${topSeedElo})">Top Seed: #1 ${escapeHtml(topSeedName)} (${topSeedElo})</div>
        </div>
        <div class="profile-kpi-card">
          <div class="profile-kpi-label">${kpi.leaderTitle}</div>
          <div class="profile-kpi-value" style="color: #4ade80; font-size: 1.15rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(kpi.leaderName)}">${escapeHtml(kpi.leaderName)}</div>
          <div class="profile-kpi-sub">${escapeHtml(kpi.leaderSub)}</div>
        </div>
        <div class="profile-kpi-card">
          <div class="profile-kpi-label">📊 Meta Snapshot</div>
          <div class="profile-kpi-value" style="color: #38bdf8; font-size: 1.12rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="Most Played: ${escapeHtml(mostPlayedFac)}">${escapeHtml(mostPlayedFac)}</div>
          <div class="profile-kpi-sub">${escapeHtml(bestWrSub || mostPlayedSub)}</div>
        </div>
      </div>
    </div>
  `;
}

function populateEventHubFactionFilter(players) {
  const select = document.getElementById('event-hub-faction-filter');
  if (!select) return;
  const facs = Array.from(new Set(
    (players || []).map(p => formatEventPlayerFaction(p.faction || p.army_name)).filter(f => f && f !== 'Unknown' && f !== 'Unassigned' && f !== 'Various')
  )).sort();

  const currentVal = select.value || 'All';
  select.innerHTML = `<option value="All">All Factions (${(players || []).length})</option>` +
    facs.map(f => {
      const cnt = (players || []).filter(p => formatEventPlayerFaction(p.faction || p.army_name) === f).length;
      return `<option value="${escapeHtml(f)}">${escapeHtml(f)} (${cnt})</option>`;
    }).join('');
  if (facs.includes(currentVal)) {
    select.value = currentVal;
  } else {
    select.value = 'All';
    eventHubFactionFilter = 'All';
  }
}

function handleEventHubFactionFilter(val) {
  eventHubFactionFilter = val || 'All';
  renderEventResultsRows();
}

function renderPersonalEventScorecard(ev, userRegData) {
  const container = document.getElementById('event-player-personal-scorecard');
  if (!container) return;

  if (!userRegData || !userRegData.is_registered) {
    container.innerHTML = '';
    return;
  }

  const preg = userRegData.player_registration || userRegData.player || {};
  const myPid = String(preg.player_id || preg.bcp_player_id || '').trim().toLowerCase();
  const myName = String(preg.full_name || `${preg.first_name || ''} ${preg.last_name || ''}`).trim().toLowerCase();

  const myMatches = (eventMatchesCache || []).filter(m => {
    const p1Id = String(m.player1_id || '').trim().toLowerCase();
    const p2Id = String(m.player2_id || '').trim().toLowerCase();
    const p1Name = String(m.player1_name || '').trim().toLowerCase();
    const p2Name = String(m.player2_name || '').trim().toLowerCase();
    if (myPid && (p1Id === myPid || p2Id === myPid)) return true;
    if (myName && (p1Name === myName || p2Name === myName)) return true;
    return false;
  }).sort((a, b) => (a.round || 1) - (b.round || 1));

  if (myMatches.length === 0) {
    container.innerHTML = `
      <div class="card" style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 10px; padding: 1rem;">
        <div style="font-size: 0.92rem; font-weight: 700; color: #38bdf8; margin-bottom: 0.25rem;">⚔️ Your Event Scorecard</div>
        <div style="font-size: 0.82rem; color: var(--text-secondary);">Your round pairings and live match results will appear here as soon as Round 1 pairings are posted.</div>
      </div>
    `;
    return;
  }

  let totalDelta = 0;
  const eventId = (ev && ev.id) || currentOpenEventId || (currentEventData && currentEventData.id) || '';
  const rowsHtml = myMatches.map(m => {
    const p1Id = String(m.player1_id || '').trim().toLowerCase();
    const p1Name = String(m.player1_name || '').trim().toLowerCase();
    const isP1 = (myPid && p1Id === myPid) || (myName && p1Name === myName);
    const oppName = isP1 ? (m.player2_name || 'BYE') : (m.player1_name || 'Opponent');
    const oppFac = isP1 ? (m.player2_faction || '') : (m.player1_faction || '');
    const myScore = isP1 ? m.player1_score : m.player2_score;
    const oppScore = isP1 ? m.player2_score : m.player1_score;
    const hasScore = myScore !== null && myScore !== undefined && oppScore !== null && oppScore !== undefined;
    const delta = isP1 ? Number(m._p1_delta || 0) : Number(m._p2_delta || 0);
    totalDelta += delta;

    const isWin = Boolean(isP1 ? m._is_p1_win : m._is_p2_win);
    const isLoss = Boolean(isP1 ? m._is_p2_win : m._is_p1_win);
    const resBadge = isWin ? `<span class="badge badge-win">WIN</span>` : (isLoss ? `<span class="badge badge-loss">LOSS</span>` : `<span class="badge badge-draw">${hasScore ? 'DRAW' : 'ACTIVE ROUND'}</span>`);
    const deltaStr = hasScore ? (delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)) : 'Pending';
    const deltaColor = hasScore ? (delta > 0 ? '#4ade80' : (delta < 0 ? '#f87171' : 'var(--text-muted)')) : 'var(--text-muted)';

    const roundNum = m.round || 1;
    const tableNum = m.table_number || m.table || 1;
    const matchId = `BCP-${eventId}-R${roundNum}-T${tableNum}`;
    const safeEventId = String(eventId).replace(/'/g, "\\'");
    const safeP1Name = String(m.player1_name || 'Player 1').replace(/'/g, "\\'");
    const safeP2Name = String(m.player2_name || 'Player 2').replace(/'/g, "\\'");
    const safeP1Id = String(m.player1_id || '').replace(/'/g, "\\'");
    const safeP2Id = String(m.player2_id || '').replace(/'/g, "\\'");
    const safePairingId = String(m.id || m.pairing_id || m.bcp_pairing_id || '').replace(/'/g, "\\'");
    const p1ScoreVal = m.player1_score !== null && m.player1_score !== undefined ? m.player1_score : "''";
    const p2ScoreVal = m.player2_score !== null && m.player2_score !== undefined ? m.player2_score : "''";

    const actionBtns = [];
    if (!hasScore) {
      actionBtns.push(`<button type="button" class="btn-sm" style="font-size:0.72rem; padding:0.2rem 0.55rem; background:#0284c7; color:#fff; border:1px solid #38bdf8; border-radius:6px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:0.3rem;" onclick="launchTournamentTracker('${safeEventId}', ${roundNum}, ${tableNum}, '${escapeHtml(safeP1Name)}', '${escapeHtml(safeP2Name)}', '${escapeHtml(safeP1Id)}', '${escapeHtml(safeP2Id)}', '${escapeHtml(safePairingId)}')" title="Create / Open Live Game Tracker Room">🎲 Track / Room</button>`);
    } else {
      actionBtns.push(`<button type="button" class="btn-sm btn-outline" style="font-size:0.72rem; padding:0.2rem 0.5rem; display:inline-flex; align-items:center; gap:0.3rem; cursor:pointer;" onclick="openScorecardModal('${matchId}')" title="View Turn-by-Turn Digital Scorecard">📄 Scorecard</button>`);
    }

    return `
      <tr>
        <td style="font-family:var(--font-mono); font-weight:700;">R${roundNum}</td>
        <td style="font-family:var(--font-mono); color:var(--text-muted);">T${tableNum}</td>
        <td style="font-weight:600; color:#fff;">${escapeHtml(oppName)} ${oppFac ? `<span class="badge" style="font-size:0.7rem; margin-left:4px;">${escapeHtml(oppFac)}</span>` : ''}</td>
        <td style="font-family:var(--font-mono); font-weight:700;">${hasScore ? `${myScore} - ${oppScore}` : '-'}</td>
        <td>${resBadge}</td>
        <td style="font-family:var(--font-mono); font-weight:700; color:${deltaColor}; text-align:right;">${deltaStr}${hasScore ? ' Elo' : ''}</td>
        <td style="text-align:right;">
          <div style="display:flex; align-items:center; justify-content:flex-end; gap:0.35rem; flex-wrap:wrap;">
            ${actionBtns.join(' ')}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  const netStr = totalDelta >= 0 ? `+${totalDelta.toFixed(1)}` : totalDelta.toFixed(1);
  const netColor = totalDelta >= 0 ? '#4ade80' : '#f87171';

  container.innerHTML = `
    <div class="card" style="background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 10px; padding: 1.15rem;">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 0.85rem;">
        <h4 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: #fff;">⚔️ Your Personal Event Scorecard</h4>
        <span class="badge" style="font-family:var(--font-mono); font-size:0.78rem; font-weight:700; color:${netColor}; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15);">Event Net Elo: ${netStr}</span>
      </div>
      <div class="table-container">
        <table id="personal-scorecard-table">
          <thead>
            <tr>
              <th>Round</th>
              <th>Table</th>
              <th>Opponent</th>
              <th>Score</th>
              <th>Result</th>
              <th style="text-align:right;">Elo Δ</th>
              <th style="text-align:right;">Action</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderEventMetaAndHighlights(ev) {
  const container = document.getElementById('event-meta-highlights-container');
  if (!container) return;

  const players = Array.isArray(eventPlayersCache) ? eventPlayersCache : [];
  const matches = Array.isArray(eventMatchesCache) ? eventMatchesCache : [];

  if (players.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:2.5rem 1rem;">No competitor data available for field meta analysis yet.</div>`;
    return;
  }

  // 1. Biggest Elo Overperformer
  const overperformer = players.slice().sort((a, b) => Number(b.event_net_elo || 0) - Number(a.event_net_elo || 0))[0] || null;
  const overNet = overperformer ? Number(overperformer.event_net_elo || 0) : 0;
  const overNetStr = overNet >= 0 ? `+${overNet.toFixed(1)}` : overNet.toFixed(1);

  // 2. Biggest Giant Killer / Upset
  let biggestUpset = null;
  let maxUpsetGap = -9999;
  matches.forEach(m => {
    if (m.is_bye || !m.winner_id) return;
    const isP1Win = String(m.winner_id) === String(m.player1_id);
    const winnerName = isP1Win ? m.player1_name : m.player2_name;
    const loserName = isP1Win ? m.player2_name : m.player1_name;
    const winnerElo = isP1Win ? Number(m._p1_elo || m.player1_elo || 1500) : Number(m._p2_elo || m.player2_elo || 1500);
    const loserElo = isP1Win ? Number(m._p2_elo || m.player2_elo || 1500) : Number(m._p1_elo || m.player1_elo || 1500);
    const gap = loserElo - winnerElo;
    if (gap > maxUpsetGap) {
      maxUpsetGap = gap;
      biggestUpset = { winnerName, loserName, winnerElo, loserElo, gap, round: m.round || 1 };
    }
  });

  // 3. Highest Scoring Army
  const topScorer = players.slice().sort((a, b) => Number(b.event_battle_points || 0) - Number(a.event_battle_points || 0))[0] || null;

  // Faction breakdown table
  const facMap = new Map();
  players.forEach(p => {
    const fac = formatEventPlayerFaction(p.faction || p.army_name);
    if (!fac || fac === 'Unknown' || fac === 'Unassigned' || fac === 'Various') return;
    if (!facMap.has(fac)) {
      facMap.set(fac, {
        faction: fac,
        count: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        netElo: 0,
        bestRank: 9999,
        bestPlayer: ''
      });
    }
    const item = facMap.get(fac);
    item.count++;
    item.wins += Number(p.event_wins || 0);
    item.losses += Number(p.event_losses || 0);
    item.draws += Number(p.event_draws || 0);
    item.netElo += Number(p.event_net_elo || 0);
    const rank = (p.placement && p.placement > 0) ? p.placement : 9999;
    if (rank < item.bestRank) {
      item.bestRank = rank;
      item.bestPlayer = p.full_name || 'Player';
    } else if (!item.bestPlayer) {
      item.bestPlayer = p.full_name || 'Player';
    }
  });

  const facList = Array.from(facMap.values()).sort((a, b) => b.count - a.count || b.wins - a.wins);
  const totalField = Math.max(1, players.length);

  const facRowsHtml = facList.map(f => {
    const sharePct = ((f.count / totalField) * 100).toFixed(1);
    const totalGames = f.wins + f.losses + f.draws;
    const wrPct = totalGames > 0 ? ((f.wins / totalGames) * 100).toFixed(1) : '0.0';
    const avgNet = f.count > 0 ? (f.netElo / f.count) : 0;
    const avgNetStr = avgNet >= 0 ? `+${avgNet.toFixed(1)}` : avgNet.toFixed(1);
    const avgNetColor = avgNet > 0 ? '#4ade80' : (avgNet < 0 ? '#f87171' : 'var(--text-muted)');
    const bestFinishStr = f.bestRank < 9999 ? `#${f.bestRank} ${escapeHtml(f.bestPlayer)}` : escapeHtml(f.bestPlayer);

    return `
      <tr>
        <td style="font-weight:700; color:#fff;">🛡️ ${escapeHtml(f.faction)}</td>
        <td>
          <span style="font-family:var(--font-mono); font-weight:700; color:#38bdf8;">${f.count}</span>
          <span style="font-size:0.75rem; color:var(--text-muted); margin-left:4px;">(${sharePct}%)</span>
        </td>
        <td style="font-family:var(--font-mono); font-weight:600;">${f.wins}W - ${f.losses}L${f.draws ? ` - ${f.draws}D` : ''}</td>
        <td>
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <span style="font-family:var(--font-mono); font-weight:700; width:46px;">${wrPct}%</span>
            <div style="flex:1; max-width:90px; height:6px; background:rgba(255,255,255,0.08); border-radius:4px; overflow:hidden;">
              <div style="width:${Math.min(100, Number(wrPct))}%; height:100%; background:${Number(wrPct) >= 50 ? 'var(--win)' : 'var(--accent)'};"></div>
            </div>
          </div>
        </td>
        <td style="font-family:var(--font-mono); font-weight:700; color:${avgNetColor};">${avgNetStr}</td>
        <td style="font-size:0.82rem; color:var(--text-secondary);">${bestFinishStr}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <!-- 3 Tournament Spotlight Cards -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:1rem; margin-bottom:1.5rem;">
      <div class="card" style="padding:1.1rem; background:linear-gradient(135deg, rgba(16,185,129,0.12), rgba(15,23,42,0.85)); border:1px solid rgba(16,185,129,0.35); border-radius:10px;">
        <div style="font-size:0.74rem; font-weight:800; text-transform:uppercase; color:#34d399; letter-spacing:0.05em; margin-bottom:0.35rem;">📈 Biggest Elo Overperformer</div>
        <div style="font-size:1.25rem; font-weight:800; color:#fff; font-family:var(--font-mono); margin-bottom:0.2rem;">
          ${overperformer ? `${overNetStr} Net Elo` : 'TBD'}
        </div>
        <div style="font-weight:700; color:#38bdf8; font-size:0.95rem;">
          ${overperformer ? escapeHtml(overperformer.full_name || 'Player') : 'Awaiting Completed Rounds'}
        </div>
        <div style="font-size:0.78rem; color:var(--text-secondary); margin-top:0.2rem;">
          ${overperformer ? `${escapeHtml(formatEventPlayerFaction(overperformer.faction || overperformer.army_name))} • ${overperformer.event_wins || 0}W-${overperformer.event_losses || 0}L` : 'Calculated from tournament games'}
        </div>
      </div>

      <div class="card" style="padding:1.1rem; background:linear-gradient(135deg, rgba(245,158,11,0.12), rgba(15,23,42,0.85)); border:1px solid rgba(245,158,11,0.35); border-radius:10px;">
        <div style="font-size:0.74rem; font-weight:800; text-transform:uppercase; color:#fbbf24; letter-spacing:0.05em; margin-bottom:0.35rem;">⚡ Biggest Giant Killer / Upset</div>
        <div style="font-size:1.25rem; font-weight:800; color:#fff; font-family:var(--font-mono); margin-bottom:0.2rem;">
          ${biggestUpset && biggestUpset.gap > 0 ? `+${Math.round(biggestUpset.gap)} Elo Gap` : (biggestUpset ? `Round ${biggestUpset.round} Victory` : 'TBD')}
        </div>
        <div style="font-weight:700; color:#fbbf24; font-size:0.92rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${biggestUpset ? `${escapeHtml(biggestUpset.winnerName)} (${Math.round(biggestUpset.winnerElo)})` : 'No Upsets Recorded Yet'}
        </div>
        <div style="font-size:0.78rem; color:var(--text-secondary); margin-top:0.2rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${biggestUpset ? `def. ${escapeHtml(biggestUpset.loserName)} (${Math.round(biggestUpset.loserElo)}) • R${biggestUpset.round}` : 'Tracks highest underdog Elo victory'}
        </div>
      </div>

      <div class="card" style="padding:1.1rem; background:linear-gradient(135deg, rgba(56,189,248,0.12), rgba(15,23,42,0.85)); border:1px solid rgba(56,189,248,0.35); border-radius:10px;">
        <div style="font-size:0.74rem; font-weight:800; text-transform:uppercase; color:#38bdf8; letter-spacing:0.05em; margin-bottom:0.35rem;">🔥 Highest Scoring General</div>
        <div style="font-size:1.25rem; font-weight:800; color:#fff; font-family:var(--font-mono); margin-bottom:0.2rem;">
          ${topScorer && topScorer.event_battle_points ? `${topScorer.event_battle_points} Battle Pts` : 'TBD'}
        </div>
        <div style="font-weight:700; color:#38bdf8; font-size:0.95rem;">
          ${topScorer && topScorer.event_battle_points ? escapeHtml(topScorer.full_name || 'Player') : 'Awaiting Match Scores'}
        </div>
        <div style="font-size:0.78rem; color:var(--text-secondary); margin-top:0.2rem;">
          ${topScorer && topScorer.event_battle_points ? `${escapeHtml(formatEventPlayerFaction(topScorer.faction || topScorer.army_name))} • ${(topScorer.event_battle_points / Math.max(1, topScorer.event_matches_count || 1)).toFixed(1)} pts/game` : 'Total Battle Points across all rounds'}
        </div>
      </div>
    </div>

    <!-- Faction Representation & Performance Table -->
    <div class="card" style="background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border); border-radius: 10px; padding: 1.15rem;">
      <h4 style="margin: 0 0 0.9rem 0; font-size: 1rem; font-weight: 700; color: #fff;">📊 Tournament Faction Breakdown & Performance</h4>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Faction</th>
              <th>Representation</th>
              <th>Record (W-L-D)</th>
              <th>Win Rate</th>
              <th>Avg Net Elo Δ</th>
              <th>Best Finish</th>
            </tr>
          </thead>
          <tbody>
            ${facRowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function copyEventHubLink(eventId, sys = '40k') {
  const cleanSys = (sys || '40k').toLowerCase();
  const url = `${window.location.origin}/#/${cleanSys}/event/${encodeURIComponent(eventId)}`;
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(url).then(() => {
      if (typeof showProfileToast === 'function') {
        showProfileToast('✓ Event Hub link copied to clipboard!');
      } else if (typeof showToast === 'function') {
        showToast('Event Hub link copied to clipboard!', 'success');
      }
    }).catch(() => {});
  }
}

function openEventPlayerListModal(playerIdentifier) {
  const modal = document.getElementById('event-army-list-modal');
  if (!modal) return;

  const q = String(playerIdentifier || '').trim().toLowerCase();
  const p = (eventPlayersCache || []).find(item => {
    const pid = String(item.player_id || item.id || '').trim().toLowerCase();
    const pname = String(item.full_name || item.name || '').trim().toLowerCase();
    return (pid && pid === q) || (pname && pname === q);
  });

  currentArmyListModalPlayer = p || { full_name: playerIdentifier, player_id: playerIdentifier };

  const titleEl = document.getElementById('event-army-list-modal-title');
  const subEl = document.getElementById('event-army-list-modal-subtitle');
  const contentEl = document.getElementById('event-army-list-modal-content');
  const btnProfile = document.getElementById('btn-army-list-view-profile');
  const btnCopy = document.getElementById('btn-army-list-copy');

  const modalFac = formatEventPlayerFaction(p?.faction || p?.army_name);
  const facSub = (modalFac && modalFac !== '-') ? modalFac : 'Faction Unselected';
  if (titleEl) titleEl.innerText = `${p?.full_name || playerIdentifier || 'Competitor'} — Army Roster`;
  if (subEl) subEl.innerText = `${facSub}${p?.detachment ? ` • ${p.detachment}` : ''}${p?.team ? ` • 🛡️ ${p.team}` : ''}`;

  const listInfo = getPlayerListDetails(p);
  if (contentEl) {
    if (listInfo.text) {
      contentEl.style.whiteSpace = 'pre-wrap';
      contentEl.style.fontFamily = 'var(--font-mono, monospace)';
      contentEl.style.lineHeight = '1.45';
      contentEl.style.background = 'rgba(15, 23, 42, 0.9)';
      contentEl.innerText = listInfo.text;
      if (btnCopy) btnCopy.style.display = 'inline-flex';
    } else if (listInfo.listId || listInfo.url) {
      const isLinked = isUserBcpConnected();
      if (!isLinked) {
        contentEl.style.whiteSpace = 'normal';
        contentEl.style.fontFamily = 'inherit';
        contentEl.style.background = 'transparent';
        contentEl.innerHTML = renderBcpLinkRequiredCard(listInfo.url);
        if (btnCopy) btnCopy.style.display = 'none';
      } else {
        // User is BCP linked: fetch directly via BCP API
        contentEl.style.whiteSpace = 'normal';
        contentEl.style.fontFamily = 'inherit';
        contentEl.style.background = 'transparent';
        contentEl.innerHTML = `
          <div style="text-align:center; padding:2.5rem 1rem;">
            <div style="display:inline-block; width:34px; height:34px; border:3px solid rgba(56,189,248,0.2); border-top-color:#38bdf8; border-radius:50%; animation:spin 0.8s linear infinite; margin-bottom:0.85rem;"></div>
            <div style="font-size:1rem; font-weight:700; color:#38bdf8; margin-bottom:0.35rem;">Fetching Roster from Best Coast Pairings...</div>
            <div style="font-size:0.8rem; color:var(--text-secondary);">Connecting via your linked BCP credentials</div>
          </div>
        `;
        if (btnCopy) btnCopy.style.display = 'none';

        const targetListId = listInfo.listId || listInfo.url;
        window.api.getBcpArmyList(targetListId)
          .then(res => {
            if (res && res.success && res.text) {
              const trimmed = res.text.trim();
              if (p) {
                p.army_list = trimmed;
                p.army_list_text = trimmed;
              }
              contentEl.style.whiteSpace = 'pre-wrap';
              contentEl.style.fontFamily = 'var(--font-mono, monospace)';
              contentEl.style.lineHeight = '1.45';
              contentEl.style.background = 'rgba(15, 23, 42, 0.9)';
              contentEl.innerText = trimmed;
              if (btnCopy) btnCopy.style.display = 'inline-flex';
            } else if (res && res.requires_bcp_link) {
              contentEl.style.whiteSpace = 'normal';
              contentEl.style.fontFamily = 'inherit';
              contentEl.style.background = 'transparent';
              contentEl.innerHTML = renderBcpLinkRequiredCard(listInfo.url);
              if (btnCopy) btnCopy.style.display = 'none';
            } else {
              contentEl.style.whiteSpace = 'normal';
              contentEl.style.fontFamily = 'inherit';
              contentEl.style.background = 'transparent';
              contentEl.innerHTML = `
                <div style="text-align:center; padding:1.75rem 1rem;">
                  <div style="font-size:2.2rem; margin-bottom:0.6rem;">📋</div>
                  <div style="font-size:1.05rem; font-weight:700; color:#38bdf8; margin-bottom:0.35rem;">Official Best Coast Pairings Roster</div>
                  <div style="font-size:0.84rem; color:var(--text-secondary); max-width:440px; margin:0 auto 1.35rem auto; line-height:1.45;">
                    ${escapeHtml(res?.error || 'Full roster text could not be loaded automatically.')}
                  </div>
                  <a href="${escapeHtml(listInfo.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="display:inline-flex; align-items:center; gap:0.5rem; font-weight:700; font-size:0.84rem; padding:0.55rem 1.25rem; text-decoration:none; background:#0284c7; border:1px solid #38bdf8; color:#fff; border-radius:6px;">
                    📄 Open Roster on Best Coast Pairings ↗
                  </a>
                </div>
              `;
              if (btnCopy) btnCopy.style.display = 'none';
            }
          })
          .catch(err => {
            contentEl.style.whiteSpace = 'normal';
            contentEl.style.fontFamily = 'inherit';
            contentEl.style.background = 'transparent';
            contentEl.innerHTML = renderBcpLinkRequiredCard(listInfo.url);
            if (btnCopy) btnCopy.style.display = 'none';
          });
      }
    } else {
      contentEl.style.whiteSpace = 'normal';
      contentEl.style.fontFamily = 'inherit';
      contentEl.style.background = 'transparent';
      contentEl.innerHTML = `
        <div style="text-align:center; padding:1.75rem 1rem; color:var(--text-muted);">
          <div style="font-size:2rem; margin-bottom:0.6rem;">📄</div>
          <div style="font-size:1rem; font-weight:700; color:#fff; margin-bottom:0.35rem;">No Roster Submitted</div>
          <div style="font-size:0.82rem; line-height:1.45;">No army list text or link has been published on BCP for ${escapeHtml(p?.full_name || 'this competitor')} yet.</div>
        </div>
      `;
      if (btnCopy) btnCopy.style.display = 'none';
    }
  }

  if (btnProfile) {
    const targetId = p?.player_id || p?.id || '';
    btnProfile.onclick = () => {
      closeModal('event-army-list-modal');
      if (typeof openPlayerProfilePage === 'function' && targetId) {
        openPlayerProfilePage(targetId);
      } else if (typeof openPlayerModal === 'function') {
        openPlayerModal(targetId, p?.full_name || '');
      }
    };
  }

  modal.style.display = 'flex';
  if (typeof bringModalToFront === 'function') {
    bringModalToFront(modal);
  } else {
    modal.classList.add('active');
  }
}

function closeEventArmyListModal() {
  if (typeof closeModal === 'function') {
    closeModal('event-army-list-modal');
  } else {
    const m = document.getElementById('event-army-list-modal');
    if (m) m.style.display = 'none';
  }
}
window.closeEventArmyListModal = closeEventArmyListModal;

function copyEventArmyListModalText() {
  const contentEl = document.getElementById('event-army-list-modal-content');
  if (!contentEl) return;
  const text = contentEl.innerText || '';
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).then(() => {
      if (typeof showProfileToast === 'function') {
        showProfileToast('✓ Army list copied to clipboard!');
      } else if (typeof showToast === 'function') {
        showToast('Army list copied to clipboard!', 'success');
      }
    }).catch(() => {});
  }
}

window.computeEventPlayerEloStats = computeEventPlayerEloStats;
window.renderQuickEventModal = renderQuickEventModal;
window.setQuickModalViewMode = setQuickModalViewMode;
window.handleQuickModalSearch = handleQuickModalSearch;
window.renderQuickModalTable = renderQuickModalTable;
window.openEventHubFromModal = openEventHubFromModal;
window.openEventHubPage = openEventHubPage;
window.renderEventHubHeroSection = renderEventHubHeroSection;
window.populateEventHubFactionFilter = populateEventHubFactionFilter;
window.handleEventHubFactionFilter = handleEventHubFactionFilter;
window.renderPersonalEventScorecard = renderPersonalEventScorecard;
window.renderEventMetaAndHighlights = renderEventMetaAndHighlights;
window.copyEventHubLink = copyEventHubLink;
window.openEventPlayerListModal = openEventPlayerListModal;
window.copyEventArmyListModalText = copyEventArmyListModalText;
