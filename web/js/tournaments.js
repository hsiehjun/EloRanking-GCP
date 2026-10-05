var eventsData = (typeof window !== 'undefined' && window.eventsData) || [];
var eventsPagination = (typeof window !== 'undefined' && window.eventsPagination) || { page: 1, pageSize: 25, total: 0, totalPages: 1 };
var eventsSortState = (typeof window !== 'undefined' && window.eventsSortState) || { field: 'event_date', asc: false };
var eventSearchTimeout = null;
var eventMatchesCache = (typeof window !== 'undefined' && window.eventMatchesCache) || [];
var eventPlayersCache = (typeof window !== 'undefined' && window.eventPlayersCache) || [];
var currentRoundFilter = (typeof window !== 'undefined' && window.currentRoundFilter) || 'all';
var currentOpenEventId = (typeof window !== 'undefined' && window.currentOpenEventId) || null;
var currentEventData = (typeof window !== 'undefined' && window.currentEventData) || null;
var currentEventModalTab = (typeof window !== 'undefined' && window.currentEventModalTab) || 'results';
var eventModalSearchQuery = '';
if (typeof window !== 'undefined') {
  window.eventsData = eventsData;
  window.eventsPagination = eventsPagination;
  window.eventsSortState = eventsSortState;
  window.eventMatchesCache = eventMatchesCache;
  window.eventPlayersCache = eventPlayersCache;
  window.currentRoundFilter = currentRoundFilter;
  window.currentOpenEventId = currentOpenEventId;
  window.currentEventData = currentEventData;
  window.currentEventModalTab = currentEventModalTab;
}

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
    <div style="text-align:center; padding:2.75rem 1.25rem; margin:auto; max-width:540px;">
      <div style="font-size:3.2rem; margin-bottom:0.75rem; filter:drop-shadow(0 4px 12px rgba(239,68,68,0.3));">🔒</div>
      <div style="font-size:1.25rem; font-weight:800; color:#f87171; margin-bottom:0.5rem; letter-spacing:0.02em;">
        BCP Subscription Required
      </div>
      <div style="font-size:0.95rem; color:#e2e8f0; line-height:1.6; margin-bottom:1rem;">
        need bcp subscription - please subscribe here: <a href="https://www.bestcoastpairings.com/subscription" target="_blank" rel="noopener noreferrer" style="color:#38bdf8; text-decoration:underline; font-weight:700; word-break:break-all;">https://www.bestcoastpairings.com/subscription</a>
      </div>
      <div style="font-size:0.84rem; color:var(--text-secondary); line-height:1.55; margin-bottom:1.6rem;">
        Viewing competitor tournament army rosters requires an active Best Coast Pairings subscription. Once subscribed, link your BCP account to unlock full in-app roster viewing and interactive NewRecruit Play Mode datasheets.
      </div>
      <div style="display:flex; flex-wrap:wrap; justify-content:center; align-items:center; gap:0.75rem;">
        <a href="https://www.bestcoastpairings.com/subscription" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="display:inline-flex; align-items:center; gap:0.45rem; font-weight:700; font-size:0.86rem; padding:0.65rem 1.4rem; background:linear-gradient(135deg, #0284c7 0%, #2563eb 100%); border:1px solid #38bdf8; color:#fff; border-radius:8px; text-decoration:none; box-shadow:0 4px 14px rgba(2,132,199,0.4); cursor:pointer;">
          ⭐ Subscribe on Best Coast Pairings ↗
        </a>
        <button type="button" class="btn btn-outline" onclick="closeEventArmyListModal(); if (typeof openBcpLinkModal === 'function') openBcpLinkModal();" style="display:inline-flex; align-items:center; gap:0.45rem; font-weight:600; font-size:0.86rem; padding:0.65rem 1.25rem; border:1px solid rgba(56,189,248,0.4); color:#38bdf8; border-radius:8px; cursor:pointer; background:rgba(15,23,42,0.8);">
          🔗 Link BCP Account
        </button>
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
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:var(--loss);">Error loading tournaments: ${escapeHtml(err.message)}</td></tr>`;
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
      <td style="font-family:var(--font-mono);">${ev.numberOfRounds || ev.num_rounds || (ev.raw_json && ev.raw_json.numberOfRounds) || 0}</td>
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
        invalidateEventSearchIndex();

        const elPlayers = document.getElementById('event-modal-players');
        const eventRounds = getEventNumRounds(fresh, eventMatchesCache);
        if (elPlayers) elPlayers.innerText = fresh.total_players || eventPlayersCache.length || 0;
        const elRounds = document.getElementById('event-modal-rounds');
        if (elRounds) elRounds.innerText = eventRounds || 0;
        const elMatches = document.getElementById('event-modal-matches');
        if (elMatches) elMatches.innerText = eventMatchesCache.length;

        const metaEl = document.getElementById('modal-event-meta');
        if (metaEl) {
          const loc = [fresh.city, fresh.state, fresh.country].filter(Boolean).join(', ') || 'Online / Unspecified';
          const dStr = (fresh.event_date || '').slice(0, 10);
          const roundsPart = eventRounds > 0 ? ` • 🔄 ${eventRounds} Rounds` : '';
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

  // Set active tab immediately to prevent visual flashing (default to pairings for live ongoing events, teams for team tournaments, results otherwise)
  let guessedOngoing = false;
  if (currentEventData && String(currentEventData.id) === String(eventId)) {
    if (typeof isTournamentOngoing === 'function') guessedOngoing = isTournamentOngoing(currentEventData);
    else guessedOngoing = Boolean(!currentEventData.ended && (currentEventData.matches || []).length > 0);
  }
  const guessedIsTeam = Boolean(currentEventData && String(currentEventData.id) === String(eventId) && (currentEventData.is_team_event || (currentEventData.teams && currentEventData.teams.length > 0)));
  let immediateTab = 'results';
  if (guessedOngoing) immediateTab = 'matches';
  else if (guessedIsTeam) immediateTab = 'teams';
  switchEventModalTab(initialTab || immediateTab);

  const subtabPlayerInit = document.getElementById('event-subtab-player');
  const subtabTeamsInit = document.getElementById('event-subtab-teams');
  const subtabEloInit = document.getElementById('event-subtab-elo');
  const subtabCreatorInit = document.getElementById('event-subtab-creator');
  if (subtabPlayerInit) subtabPlayerInit.style.setProperty('display', 'none', 'important');
  if (subtabTeamsInit) {
    if (guessedIsTeam) {
      subtabTeamsInit.style.setProperty('display', 'inline-flex', 'important');
    } else {
      subtabTeamsInit.style.setProperty('display', 'none', 'important');
    }
  }
  if (subtabEloInit) subtabEloInit.style.setProperty('display', 'none', 'important');
  if (subtabCreatorInit) {
    const isCCInit = Boolean(typeof isUserCC === 'function' ? isUserCC(currentUser) : (currentUser && (currentUser.role === 'admin' || currentUser.role === 'cc' || currentUser.is_admin)));
    subtabCreatorInit.style.setProperty('display', isCCInit ? 'inline-flex' : 'none', 'important');
  }

  const isTopEventModal = modal.classList.contains('active') &&
                          modal.style.display !== 'none' &&
                          ((typeof modalStack !== 'undefined' && modalStack.length > 0 && modalStack[modalStack.length - 1] === 'event-modal') ||
                           (typeof window !== 'undefined' && window.modalStack && window.modalStack.length > 0 && window.modalStack[window.modalStack.length - 1] === 'event-modal')) &&
                          currentEventData && String(currentEventData.id) === String(eventId);
  const loadingModal = document.getElementById('event-details-loading-modal');

  // Check if we already have warm cached data in memory
  const hasWarmCache = Boolean(
    (currentEventData && String(currentEventData.id) === String(eventId)) ||
    (window.api && window.api._cache && window.api._cache.has(`/api/event/${encodeURIComponent(eventId)}`))
  );

  // If the event modal is not already the top active modal showing this event, and no warm cache exists, display loading screen
  if (!isTopEventModal && loadingModal && !hasWarmCache) {
    let previewName = '';
    if (currentEventData && String(currentEventData.id) === String(eventId)) {
      previewName = currentEventData.name || currentEventData.event_name || '';
    } else if (typeof myHubData !== 'undefined' && myHubData) {
      const allHubEvents = [
        ...(myHubData.registered_tournaments || []),
        ...(myHubData.upcoming_events || []),
        ...(myHubData.events_attended || [])
      ];
      const found = allHubEvents.find(e => String(e.bcp_event_id || e.id) === String(eventId));
      if (found) previewName = found.event_name || found.name || '';
    }
    if (!previewName && typeof communityState !== 'undefined' && communityState?.overview) {
      const allEvents = [
        ...(communityState.overview.events_upcoming || []),
        ...(communityState.overview.events_recent || []),
        ...(communityState.overview.upcoming_events || []),
        ...(communityState.overview.recent_events || [])
      ];
      const found = allEvents.find(e => String(e.id) === String(eventId));
      if (found) previewName = found.name || '';
    } else if (!previewName && typeof eventsData !== 'undefined' && Array.isArray(eventsData)) {
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
  } else if (hasWarmCache) {
    if (typeof bringModalToFront === 'function') {
      bringModalToFront(modal);
    } else {
      modal.classList.add('active');
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
    invalidateEventSearchIndex();

    const eventRounds = getEventNumRounds(ev, eventMatchesCache);
    const roundsPart = eventRounds > 0 ? ` • 🔄 ${eventRounds} Rounds` : '';
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
    if (elRounds) elRounds.innerText = eventRounds || 0;
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

    const subtabCreator = document.getElementById('event-subtab-creator');
    const isCC = Boolean(typeof isUserCC === 'function' ? isUserCC(currentUser) : (currentUser && (currentUser.role === 'admin' || currentUser.role === 'cc' || currentUser.is_admin)));
    if (subtabCreator) {
      subtabCreator.style.setProperty('display', isCC ? 'inline-flex' : 'none', 'important');
    }

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
    const shouldShowPlayerTab = Boolean(userRegData && userRegData.is_registered);

    if (userRegData && userRegData.is_registered) {
      if (subtabPlayer) subtabPlayer.style.setProperty('display', shouldShowPlayerTab ? 'inline-flex' : 'none', 'important');
      currentEventRegistration = userRegData;
      if (shouldShowPlayerTab) {
        await renderPlayerStation(ev, userRegData);
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
          invalidateEventSearchIndex();
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
    const isOngoing = (typeof isTournamentOngoing === 'function')
      ? isTournamentOngoing(ev)
      : (!isEnded && eventMatchesCache.length > 0);

    if (initialTab && initialTab !== 'elo' && (initialTab !== 'player' || shouldShowPlayerTab)) {
      switchEventModalTab(initialTab);
    } else if (shouldShowPlayerTab) {
      switchEventModalTab('player');
    } else if (isOngoing && eventMatchesCache.length > 0) {
      switchEventModalTab('matches');
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
      rbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:var(--loss);">Error loading tournament: ${escapeHtml(err.message)}</td></tr>`;
    }
    if (ebody) {
      ebody.style.opacity = '1';
      ebody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:var(--loss);">Error loading participant ratings: ${escapeHtml(err.message)}</td></tr>`;
    }
    if (pbody) {
      pbody.style.opacity = '1';
      pbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:var(--loss);">Error syncing pairings: ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

var _eventSearchIndexState = {
  eventId: null,
  playersRef: null,
  playersLen: -1,
  matchesRef: null,
  matchesLen: -1,
  teamsRef: null,
  teamsLen: -1,
  playerLookupMap: new Map(),
  placementsCount: 0,
  distinctRounds: [],
  roundCounts: new Map()
};
var _eventModalSearchDebounceTimer = null;
var _lastRenderedEventModalSearchQuery = null;

function invalidateEventSearchIndex() {
  _eventSearchIndexState.eventId = null;
  _eventSearchIndexState.playersRef = null;
  _eventSearchIndexState.matchesRef = null;
  _eventSearchIndexState.teamsRef = null;
  if (typeof _lastResultsSortState !== 'undefined') {
    _lastResultsSortState.playersRef = null;
  }
  if (typeof currentEventData !== 'undefined' && currentEventData) {
    currentEventData._cachedKpiSummary = null;
    currentEventData._quickSortedPlayers = null;
  }
}

function ensureEventSearchIndex() {
  const evId = currentOpenEventId || (currentEventData && currentEventData.id) || null;
  const players = Array.isArray(eventPlayersCache) ? eventPlayersCache : [];
  const matches = Array.isArray(eventMatchesCache) ? eventMatchesCache : [];
  const teams = (currentEventData && Array.isArray(currentEventData.teams) && currentEventData.teams.length > 0)
    ? currentEventData.teams
    : ((currentEventData && Array.isArray(currentEventData.team_standings)) ? currentEventData.team_standings : []);

  if (
    _eventSearchIndexState.eventId === evId &&
    _eventSearchIndexState.playersRef === players &&
    _eventSearchIndexState.playersLen === players.length &&
    _eventSearchIndexState.matchesRef === matches &&
    _eventSearchIndexState.matchesLen === matches.length &&
    _eventSearchIndexState.teamsRef === teams &&
    _eventSearchIndexState.teamsLen === teams.length
  ) {
    return _eventSearchIndexState;
  }

  const pMap = new Map();
  const addPlayerToMap = (item) => {
    if (!item) return;
    const ids = [item.player_id, item.id, item.bcp_event_player_id, item.user_id, item.bcp_player_id, item.userId];
    for (let i = 0; i < ids.length; i++) {
      const rawId = ids[i];
      if (rawId) {
        const k = 'id:' + String(rawId).trim().toLowerCase();
        if (!pMap.has(k)) pMap.set(k, item);
      }
    }
    const nm = String(item.full_name || item.name || item.player_name || (item.first_name ? `${item.first_name} ${item.last_name || ''}` : '') || '').trim().toLowerCase();
    if (nm) {
      const nk = 'name:' + nm;
      if (!pMap.has(nk)) pMap.set(nk, item);
      const ck = 'clean:' + nm.replace(/\s+/g, '');
      if (!pMap.has(ck)) pMap.set(ck, item);
    }
  };

  let placementsCount = 0;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p) continue;
    if (p.placement && p.placement > 0) placementsCount++;
    addPlayerToMap(p);
    const dispFac = formatEventPlayerFaction(p.faction || p.army_name);
    p._displayFac = dispFac;
    const nameLower = String(p.full_name || (p.first_name ? `${p.first_name} ${p.last_name || ''}` : '') || p.name || '').toLowerCase();
    const facLower = `${p.faction || ''} ${p.army_name || ''} ${dispFac || ''}`.toLowerCase();
    const teamLower = String(p.team || '').toLowerCase();
    p._searchNameLower = nameLower;
    p._searchFacLower = facLower;
    p._searchTeamLower = teamLower;
    p._formattedFactionLower = String(dispFac || '').toLowerCase();
    p._searchText = `${nameLower}\n${facLower}\n${teamLower}`;
  }

  if (currentEventData) {
    const extraLists = [currentEventData.players, currentEventData.standings, currentEventData.roster, currentEventData.unassigned];
    for (let l = 0; l < extraLists.length; l++) {
      const arr = extraLists[l];
      if (Array.isArray(arr) && arr !== players) {
        for (let i = 0; i < arr.length; i++) addPlayerToMap(arr[i]);
      }
    }
  }

  const lookupFastInternal = (pid, pname) => {
    if (pid) {
      const hit = pMap.get('id:' + String(pid).trim().toLowerCase());
      if (hit) return hit;
    }
    if (pname) {
      const nm = String(pname).trim().toLowerCase();
      if (nm) {
        const hit = pMap.get('name:' + nm) || pMap.get('clean:' + nm.replace(/\s+/g, ''));
        if (hit) return hit;
      }
    }
    return null;
  };

  const rawTeams = (currentEventData && Array.isArray(currentEventData.teams)) ? currentEventData.teams : [];
  for (let i = 0; i < rawTeams.length; i++) {
    const t = rawTeams[i];
    if (!t) continue;
    const resolvedMembers = [];
    const memberSearchParts = [];
    if (Array.isArray(t.members)) {
      for (let j = 0; j < t.members.length; j++) {
        const rawM = t.members[j];
        if (!rawM) continue;
        const mPid = rawM.player_id || rawM.id || '';
        const mPname = rawM.full_name || rawM.player_name || rawM.name || (rawM.first_name ? `${rawM.first_name} ${rawM.last_name || ''}` : '');
        const cached = lookupFastInternal(mPid, mPname);
        const merged = cached ? Object.assign({}, cached, rawM, {
          current_elo: rawM.current_elo || cached.current_elo || cached.elo,
          event_wins: rawM.event_wins !== undefined ? rawM.event_wins : cached.event_wins,
          event_losses: rawM.event_losses !== undefined ? rawM.event_losses : cached.event_losses,
          event_battle_points: rawM.event_battle_points !== undefined ? rawM.event_battle_points : cached.event_battle_points,
          event_net_elo: rawM.event_net_elo !== undefined ? rawM.event_net_elo : cached.event_net_elo,
          placement: rawM.placement || cached.placement
        }) : rawM;
        resolvedMembers.push(merged);
        memberSearchParts.push(mPname || '', merged.faction || merged.army_name || '');
      }
    }
    t._resolvedMembers = resolvedMembers;
    t._searchText = `${t.name || ''}\n${t.captain_name || t.captain || ''}\n${memberSearchParts.join('\n')}`.toLowerCase();
  }

  const rawStandings = (currentEventData && Array.isArray(currentEventData.team_standings)) ? currentEventData.team_standings : [];
  for (let i = 0; i < rawStandings.length; i++) {
    const t = rawStandings[i];
    if (!t) continue;
    t._searchText = `${t.name || ''}\n${t.captain || t.captain_name || ''}`.toLowerCase();
  }

  const roundCounts = new Map();
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (!m) continue;
    const r = Number(m.round || 1);
    roundCounts.set(r, (roundCounts.get(r) || 0) + 1);
    const p1Rec = lookupFastInternal(m.player1_id, m.player1_name);
    const p2Rec = lookupFastInternal(m.player2_id, m.player2_name);
    m._p1Record = p1Rec;
    m._p2Record = p2Rec;
    const p1Fac = m.player1_faction || p1Rec?.faction || p1Rec?.army_name || '';
    const p2Fac = m.player2_faction || p2Rec?.faction || p2Rec?.army_name || '';
    const p1Team = p1Rec?.team || '';
    const p2Team = p2Rec?.team || '';
    m._p1Faction = p1Fac;
    m._p2Faction = p2Fac;
    m._p1Team = p1Team;
    m._p2Team = p2Team;
    m._searchText = `${m.player1_name || ''}\n${m.player2_name || ''}\n${p1Fac}\n${p2Fac}\n${p1Team}\n${p2Team}`.toLowerCase();
  }

  _eventSearchIndexState.eventId = evId;
  _eventSearchIndexState.playersRef = players;
  _eventSearchIndexState.playersLen = players.length;
  _eventSearchIndexState.matchesRef = matches;
  _eventSearchIndexState.matchesLen = matches.length;
  _eventSearchIndexState.teamsRef = teams;
  _eventSearchIndexState.teamsLen = teams.length;
  _eventSearchIndexState.playerLookupMap = pMap;
  _eventSearchIndexState.placementsCount = placementsCount;
  _eventSearchIndexState.distinctRounds = Array.from(roundCounts.keys()).sort((a, b) => a - b);
  _eventSearchIndexState.roundCounts = roundCounts;
  return _eventSearchIndexState;
}

function lookupEventPlayerFast(playerId, playerName) {
  const idx = ensureEventSearchIndex();
  const pMap = idx.playerLookupMap;
  if (playerId) {
    const hit = pMap.get('id:' + String(playerId).trim().toLowerCase());
    if (hit) return hit;
  }
  if (playerName) {
    const nm = String(playerName).trim().toLowerCase();
    if (nm) {
      const hit = pMap.get('name:' + nm) || pMap.get('clean:' + nm.replace(/\s+/g, ''));
      if (hit) return hit;
    }
  }
  return null;
}

function updateEventModalTabCountsForSearch() {
  const tabTeamsCount = document.getElementById('event-tab-teams-count');
  const tabResultsCount = document.getElementById('event-tab-results-count');
  const tabEloCount = document.getElementById('event-tab-elo-count');
  const tabMatchesCount = document.getElementById('event-tab-matches-count');

  const idx = ensureEventSearchIndex();
  const teams = (currentEventData && currentEventData.teams) || [];
  const standings = (currentEventData && currentEventData.team_standings) || [];
  const placementsCount = idx.placementsCount;
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
  const activeTeamsSource = teams.length > 0 ? teams : standings;
  for (let i = 0; i < activeTeamsSource.length; i++) {
    const t = activeTeamsSource[i];
    if (t && t._searchText && t._searchText.includes(q)) filteredTeamsCount++;
  }

  let filteredPlayersCount = 0;
  const players = eventPlayersCache || [];
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p && p._searchText && p._searchText.includes(q)) filteredPlayersCount++;
  }

  let filteredMatchesCount = 0;
  const matches = eventMatchesCache || [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m && m._searchText && m._searchText.includes(q)) filteredMatchesCount++;
  }

  if (tabTeamsCount) tabTeamsCount.innerText = filteredTeamsCount;
  if (tabResultsCount) tabResultsCount.innerText = filteredPlayersCount;
  if (tabEloCount) tabEloCount.innerText = filteredPlayersCount;
  if (tabMatchesCount) tabMatchesCount.innerText = filteredMatchesCount;
}

function getEventModalCrossTabSuggestions(currentTab) {
  if (!eventModalSearchQuery) return '';
  ensureEventSearchIndex();
  const q = eventModalSearchQuery;
  const teams = (currentEventData && currentEventData.teams) || [];
  const standings = (currentEventData && currentEventData.team_standings) || [];
  const isDoubles = Boolean(currentEventData && currentEventData.is_doubles_event);
  const isTeam = Boolean(currentEventData && (currentEventData.is_team_event || teams.length > 0));

  let teamsMatchCount = 0;
  const activeTeamsSource = teams.length > 0 ? teams : standings;
  for (let i = 0; i < activeTeamsSource.length; i++) {
    const t = activeTeamsSource[i];
    if (t && t._searchText && t._searchText.includes(q)) teamsMatchCount++;
  }

  let playersMatchCount = 0;
  const players = eventPlayersCache || [];
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p && p._searchText && p._searchText.includes(q)) playersMatchCount++;
  }

  let matchesMatchCount = 0;
  const matches = eventMatchesCache || [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m && m._searchText && m._searchText.includes(q)) matchesMatchCount++;
  }

  const counts = {
    teams: teamsMatchCount,
    results: playersMatchCount,
    elo: playersMatchCount,
    matches: matchesMatchCount
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

function _executeEventModalSearchRender() {
  _lastRenderedEventModalSearchQuery = eventModalSearchQuery;
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

function handleEventModalSearch(query, immediate = true) {
  const nextQuery = (query || '').trim().toLowerCase();
  const clearBtn = document.getElementById('event-modal-search-clear');
  if (clearBtn) clearBtn.style.display = nextQuery ? 'block' : 'none';

  eventModalSearchQuery = nextQuery;

  if (_eventModalSearchDebounceTimer) {
    clearTimeout(_eventModalSearchDebounceTimer);
    _eventModalSearchDebounceTimer = null;
  }

  if (!immediate && nextQuery === _lastRenderedEventModalSearchQuery) {
    return;
  }

  if (immediate || !nextQuery) {
    _executeEventModalSearchRender();
  } else {
    _eventModalSearchDebounceTimer = setTimeout(() => {
      _eventModalSearchDebounceTimer = null;
      _executeEventModalSearchRender();
    }, 50);
  }
}

function clearEventModalSearch() {
  const input = document.getElementById('event-modal-search');
  if (input) input.value = '';
  handleEventModalSearch('', true);
  if (input) input.focus();
}

window.handleEventModalSearch = handleEventModalSearch;
window.clearEventModalSearch = clearEventModalSearch;
window.invalidateEventSearchIndex = invalidateEventSearchIndex;
window.ensureEventSearchIndex = ensureEventSearchIndex;
window.lookupEventPlayerFast = lookupEventPlayerFast;

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
  if (tabKey === 'player' && !isRegistered) {
    const isTeam = Boolean(currentEventData && (currentEventData.is_team_event || (currentEventData.teams && currentEventData.teams.length > 0)));
    tabKey = isTeam ? 'teams' : 'results';
  }
  currentEventModalTab = tabKey || 'results';
  window.currentEventModalTab = currentEventModalTab;
  const btnPlayer = document.getElementById('event-subtab-player');
  const btnTeams = document.getElementById('event-subtab-teams');
  const btnResults = document.getElementById('event-subtab-results');
  const btnElo = document.getElementById('event-subtab-elo');
  const btnMatches = document.getElementById('event-subtab-matches');
  const btnMeta = document.getElementById('event-subtab-meta');
  const btnCreator = document.getElementById('event-subtab-creator');
  const viewPlayer = document.getElementById('event-view-player');
  const viewTeams = document.getElementById('event-view-teams');
  const viewResults = document.getElementById('event-view-results');
  const viewElo = document.getElementById('event-view-elo');
  const viewMatches = document.getElementById('event-view-matches');
  const viewMeta = document.getElementById('event-view-meta');
  const viewCreator = document.getElementById('event-view-creator');
  const searchRow = document.getElementById('event-modal-search-row') || document.querySelector('.event-modal-search-wrap');
  const facFilterWrap = document.getElementById('event-hub-faction-filter-wrap');

  [btnPlayer, btnTeams, btnResults, btnElo, btnMatches, btnMeta, btnCreator].forEach(b => b && b.classList.remove('active'));
  [viewPlayer, viewTeams, viewResults, viewElo, viewMatches, viewMeta, viewCreator].forEach(v => v && (v.style.display = 'none'));

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
  } else if (tabKey === 'creator') {
    const isCC = Boolean(typeof isUserCC === 'function' ? isUserCC(currentUser) : (currentUser && (currentUser.role === 'admin' || currentUser.role === 'cc' || currentUser.role === 'creator' || currentUser.can_access_cc || currentUser.is_cc || currentUser.is_admin)));
    if (!isCC) {
      console.warn('Unauthorized Creator Studio tab switch blocked for current user');
      switchEventModalTab('results');
      return;
    }
    if (btnCreator) btnCreator.classList.add('active');
    if (viewCreator) viewCreator.style.display = 'block';
    if (searchRow) searchRow.style.display = 'none';
    if (typeof renderEventCreatorHub === 'function' && currentEventData) {
      renderEventCreatorHub(currentEventData);
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

  const idxState = ensureEventSearchIndex();
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
      filtered = teams.filter(t => t && t._searchText && t._searchText.includes(q));
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
    const hasPlacings = idxState.placementsCount > 0;
    const isStarted = Boolean(hasPlacings || hasMatches);

    if (container) {
      const cardsHtml = [];
      for (let idx = 0; idx < filtered.length; idx++) {
        const t = filtered[idx];
        const hasTeamPlacings = Boolean(t.placing && t.placing > 0);
        let rankBadgeHtml = '';
        if (hasTeamPlacings) {
          const rankClass = t.placing === 1 ? 'rank-1' : t.placing === 2 ? 'rank-2' : t.placing === 3 ? 'rank-3' : '';
          rankBadgeHtml = `<div class="team-rank-badge ${rankClass}" title="Rank #${t.placing}">#${t.placing}</div>`;
        } else {
          rankBadgeHtml = `<div class="team-icon">${isDoubles ? '👥' : '🛡️'}</div>`;
        }

        const winsPill = (t.wins != null)
          ? `<span style="font-size:0.72rem; padding:1px 7px; border-radius:10px; background:rgba(34,197,94,0.16); color:#4ade80; border:1px solid rgba(34,197,94,0.3); font-weight:700;">${t.wins}W</span>`
          : '';
        const matchPtsPill = (t.match_points != null)
          ? `<span style="font-size:0.72rem; padding:1px 7px; border-radius:10px; background:rgba(56,189,248,0.14); color:#38bdf8; border:1px solid rgba(56,189,248,0.28); font-weight:700;">${t.match_points} MP</span>`
          : '';
        const battlePtsPill = (t.battle_points != null && Number(t.battle_points) > 0)
          ? `<span style="font-size:0.72rem; padding:1px 7px; border-radius:10px; background:rgba(255,255,255,0.06); color:#f1f5f9; border:1px solid rgba(255,255,255,0.12); font-weight:700;">${t.battle_points} BP</span>`
          : '';

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

        const members = Array.isArray(t._resolvedMembers) ? t._resolvedMembers : (t.members || []);

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
          const mFac = escapeHtml(m._displayFac || formatEventPlayerFaction(m.faction || m.army_name || 'Unknown'));
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
                ${hasPlayerSubmittedList(m) ? `<button type="button" class="btn-xs btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(m.player_id || mName)}')" style="font-size:0.7rem; padding:2px 6px; margin-left:4px; cursor:pointer;" title="View competitor army roster">📋 List</button>` : ''}
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
                ${hasPlayerSubmittedList(m) ? `<button type="button" class="btn-xs btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(m.player_id || mName)}')" style="font-size:0.7rem; padding:2px 6px; cursor:pointer;" title="View competitor army roster">📋 List</button>` : ''}
              </div>
            `;
          }

          return `
            <div class="team-member-grid" style="border-bottom:${mIdx < members.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none'}; background:${mIdx % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent'};">
              <div class="team-member-col-name" style="display:flex; align-items:center; gap:0.45rem; min-width:0;">
                <span style="font-size:0.85rem; width:16px; text-align:center; flex-shrink:0;">${isCap ? '👑' : '<span style="color:var(--text-muted, #64748b);">•</span>'}</span>
                ${memberPlacingTag}
                <a href="javascript:void(0)" data-player-id="${escapeHtml(m.player_id || '')}" data-player-name="${mName}" onclick="event.stopPropagation(); openPlayerModal(this.getAttribute('data-player-id'), this.getAttribute('data-player-name'));" style="font-weight:600; font-size:0.88rem; color:#38bdf8; text-decoration:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
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

        cardsHtml.push(`
          <div class="team-roster-card">
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

            <div id="team-members-${idx}" class="team-members-container" style="display:flex; flex-direction:column;">
              <div class="team-member-header">
                <div>Competitor</div>
                <div>Faction</div>
                <div style="text-align:right;">${isStarted ? 'Record / Pts' : 'Elo Rating'}</div>
                <div class="team-col-checkin" style="text-align:right;">${isStarted ? 'Elo Rating' : 'Check-in'}</div>
              </div>
              ${memberRowsHtml || '<div style="padding:0.75rem 1rem; color:var(--text-muted); font-size:0.8rem;">No members listed for this team yet.</div>'}
            </div>
          </div>
        `);
      }

      // Unassigned players if any
      const unassigned = currentEventData.unassigned_players || [];
      if (unassigned.length > 0 && !eventModalSearchQuery) {
        const uRowsHtml = unassigned.map((m, mIdx) => {
          const mName = escapeHtml(m.full_name || (m.first_name ? `${m.first_name} ${m.last_name}` : '') || 'Competitor');
          const mFac = escapeHtml(formatEventPlayerFaction(m.faction || m.army_name || 'Unknown'));
          const mElo = m.current_elo ? Math.round(m.current_elo) : 1500;
          return `
            <div class="team-member-grid" style="border-bottom:${mIdx < unassigned.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none'};">
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <span style="color:var(--text-muted);">•</span>
                <a href="javascript:void(0)" data-player-id="${escapeHtml(m.player_id || '')}" onclick="event.stopPropagation(); openPlayerModal(this.getAttribute('data-player-id'))" style="font-weight:600; color:#38bdf8; text-decoration:none;">${mName}</a>
              </div>
              <div><span class="badge" style="background:var(--bg-card); border:1px solid var(--border); font-size:0.72rem;">${mFac}</span></div>
              <div style="text-align:right;"><span class="elo-badge ${getEloBadgeClass(mElo)}" style="font-size:0.78rem;">${mElo}</span></div>
              <div class="team-col-checkin" style="text-align:right;"><span style="color:var(--text-muted); font-size:0.72rem;">Unassigned</span></div>
            </div>
          `;
        }).join('');

        cardsHtml.push(`
          <div class="team-roster-card unassigned-roster" style="background:rgba(255,255,255,0.02); border:1px dashed var(--border, #334155); margin-top:0.5rem;">
            <div style="padding:0.6rem 1rem; background:rgba(255,255,255,0.03); border-bottom:1px dashed var(--border, #334155); font-size:0.82rem; font-weight:700; color:var(--text-secondary);">
              📋 Unassigned Competitors (${unassigned.length})
            </div>
            <div style="display:flex; flex-direction:column;">
              ${uRowsHtml}
            </div>
          </div>
        `);
      }

      container.innerHTML = cardsHtml.join('');
    }
    return;
  }

  // Branch 2: Fallback for legacy simple team_standings table
  if (container) container.style.display = 'none';
  if (tableWrap) tableWrap.style.display = 'block';

  let filtered = standings;
  if (eventModalSearchQuery) {
    const q = eventModalSearchQuery;
    filtered = standings.filter(t => t && t._searchText && t._searchText.includes(q));
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
    tbody.innerHTML = filtered.map((t, idx) => `
      <tr>
        <td class="rank-cell">#${t.placing && t.placing > 0 ? t.placing : (idx + 1)}</td>
        <td style="font-weight:700; color:var(--text-primary);">${escapeHtml(t.name || 'Team')}</td>
        <td style="color:var(--text-muted);">${escapeHtml(t.captain || '-')}</td>
        <td style="font-family:var(--font-mono); font-weight:700; color:var(--win); font-size:0.95rem;">${t.match_points != null ? t.match_points : '-'} pts</td>
        <td style="font-family:var(--font-mono); font-weight:600; color:var(--text-secondary);">${t.game_wins != null ? t.game_wins : '-'}</td>
        <td style="font-family:var(--font-mono); font-weight:700; color:var(--accent);">${t.battle_points != null ? t.battle_points : '-'} pts</td>
      </tr>
    `).join('');
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

var _lastResultsSortState = {
  playersRef: null,
  playersLen: -1,
  field: null,
  asc: null
};

function renderEventResultsRows() {
  const tbody = document.getElementById('event-results-body');
  if (!tbody) return;

  if (!eventPlayersCache || eventPlayersCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No registered competitors found for this tournament yet.</td></tr>';
    return;
  }

  ensureEventSearchIndex();

  const eventHasAnyMatches = Boolean(
    (eventMatchesCache && eventMatchesCache.length > 0) ||
    (eventPlayersCache && eventPlayersCache.some(p => (p.event_matches_count && p.event_matches_count > 0) || (p.event_wins && p.event_wins > 0) || (p.event_losses && p.event_losses > 0)))
  );
  const isStarted = eventHasAnyMatches;

  // Sorting (only re-sort when sort config or players array changes)
  const sortCfg = (typeof currentSort !== 'undefined' && currentSort['event-results']) || {
    field: isStarted ? 'placement' : 'current_elo',
    asc: isStarted ? true : false
  };

  if (
    _lastResultsSortState.playersRef !== eventPlayersCache ||
    _lastResultsSortState.playersLen !== eventPlayersCache.length ||
    _lastResultsSortState.field !== sortCfg.field ||
    _lastResultsSortState.asc !== sortCfg.asc
  ) {
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
    _lastResultsSortState.playersRef = eventPlayersCache;
    _lastResultsSortState.playersLen = eventPlayersCache.length;
    _lastResultsSortState.field = sortCfg.field;
    _lastResultsSortState.asc = sortCfg.asc;
  }

  let playersToRender = eventPlayersCache;
  if (typeof eventHubFactionFilter !== 'undefined' && eventHubFactionFilter && eventHubFactionFilter.toLowerCase() !== 'all') {
    const facFilterLower = eventHubFactionFilter.toLowerCase();
    playersToRender = playersToRender.filter(p => (p._formattedFactionLower || formatEventPlayerFaction(p.faction || p.army_name).toLowerCase()) === facFilterLower);
  }
  if (eventModalSearchQuery) {
    const q = eventModalSearchQuery;
    playersToRender = playersToRender.filter(p => p && p._searchText && p._searchText.includes(q));
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

  const resultContextKey = `${eventHasAnyMatches ? 1 : 0}:${isStarted ? 1 : 0}`;
  const rowsHtml = new Array(playersToRender.length);
  for (let idx = 0; idx < playersToRender.length; idx++) {
    const p = playersToRender[idx];
    const hasPlacement = Boolean(p.placement && p.placement > 0);
    const hasMatchesPlayed = Boolean(eventHasAnyMatches && ((p.event_matches_count && p.event_matches_count > 0) || (p.event_wins && p.event_wins > 0) || (p.event_losses && p.event_losses > 0)));
    const rankDisplay = (hasMatchesPlayed && hasPlacement)
      ? `#${p.placement}`
      : (hasMatchesPlayed && p.rank && p.rank > 0 ? `#${p.rank}` : `#${idx + 1}`);

    if (p._cachedResultContextKey === resultContextKey && p._cachedResultCellsHtml && p._cachedRowOpenHtml) {
      rowsHtml[idx] = `${p._cachedRowOpenHtml}<td class="rank-cell">${rankDisplay}</td>${p._cachedResultCellsHtml}`;
      continue;
    }

    const safePid = String(p.player_id || p.id || '').trim();
    const safeName = String(p.full_name || 'Player').trim();

    const eloBadgeClass = getEloBadgeClass(p.current_elo);
    const avgScore = (p.event_battle_points / (p.event_matches_count || 1)).toFixed(1);
    const teamHtml = p.team ? `<span style="font-size:0.75rem; color:var(--text-muted); margin-left:6px; font-weight:400;">• ${escapeHtml(p.team)}</span>` : '';
    const drawStr = p.event_draws ? ` - ${p.event_draws}D` : '';

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

    const displayFac = p._formattedFaction || p._displayFac || formatEventPlayerFaction(p.faction || p.army_name);

    p._cachedRowOpenHtml = `<tr style="cursor:pointer;" data-player-id="${escapeHtml(safePid)}" data-player-name="${escapeHtml(safeName)}" onclick="event.stopPropagation(); openPlayerModal(this.getAttribute('data-player-id'), this.getAttribute('data-player-name'));">`;
    p._cachedResultCellsHtml = `
        <td class="col-event-competitor">
          <div class="player-name-cell">
            <span class="player-link" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(safeName)}">${escapeHtml(safeName)}</span>
            ${teamHtml}
          </div>
        </td>
        <td class="col-event-faction">
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
            <button type="button" class="btn-sm btn-outline" data-list-target="${escapeHtml(safePid || safeName)}" onclick="event.stopPropagation(); openEventPlayerListModal(this.getAttribute('data-list-target'))" style="font-size:0.74rem; padding:3px 9px; font-weight:600; cursor:pointer;" title="View competitor army roster">
              📋 Roster
            </button>
          ` : `<span style="color:var(--text-muted); font-size:0.85rem; padding-right:0.45rem;">—</span>`}
        </td>
      </tr>`;
    p._cachedResultContextKey = resultContextKey;
    rowsHtml[idx] = `${p._cachedRowOpenHtml}<td class="rank-cell">${rankDisplay}</td>${p._cachedResultCellsHtml}`;
  }
  tbody.innerHTML = rowsHtml.join('');
}

function renderEventEloRows() {
  const tbody = document.getElementById('event-elo-body');
  if (!tbody) return;

  if (!eventPlayersCache || eventPlayersCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No registered competitors found for this tournament yet.</td></tr>';
    return;
  }

  ensureEventSearchIndex();

  // Sort players descending by current Elo
  const sorted = [...eventPlayersCache].sort((a, b) => (b.current_elo || 1500) - (a.current_elo || 1500));

  let playersToRender = sorted;
  if (eventModalSearchQuery) {
    const q = eventModalSearchQuery;
    playersToRender = sorted.filter(p => p && p._searchText && p._searchText.includes(q));
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

  tbody.innerHTML = playersToRender.map((p, idx) => {
    const safePid = String(p.player_id || p.id || '').trim();
    const safeName = String(p.full_name || (p.first_name ? `${p.first_name} ${p.last_name || ''}` : '') || 'Player').trim();
    const eloBadgeClass = getEloBadgeClass(p.current_elo);
    const teamHtml = p.team ? `<span style="font-size:0.75rem; color:var(--text-muted); margin-left:6px; font-weight:400;">• ${escapeHtml(p.team)}</span>` : '';

    return `
      <tr style="cursor:pointer;" data-player-id="${escapeHtml(safePid)}" data-player-name="${escapeHtml(safeName)}" onclick="event.stopPropagation(); openPlayerModal(this.getAttribute('data-player-id'), this.getAttribute('data-player-name'));">
        <td class="rank-cell">#${idx + 1}</td>
        <td>
          <div class="player-name-cell">
            <span class="player-link">${escapeHtml(safeName)}</span>
            ${teamHtml}
          </div>
        </td>
        <td>
          <span class="badge" style="background:var(--bg-card); border:1px solid var(--border);">${escapeHtml(p.faction || 'Unknown')}${p.detachment ? `<span style="color:var(--text-muted); font-weight:400;"> (${escapeHtml(p.detachment)})</span>` : ''}</span>
        </td>
        <td class="elo-badge ${eloBadgeClass}">
          ${Number(p.current_elo || 1500).toFixed(1)}
        </td>
      </tr>
    `;
  }).join('');
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
    if (roundsContainer) {
      roundsContainer.innerHTML = '';
      delete roundsContainer.dataset.renderedKey;
    }
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

  const idxState = ensureEventSearchIndex();
  const eventId = currentOpenEventId || (currentEventData && currentEventData.id) || '';

  // 1. Extract and render distinct round buttons (All, R1, R2, R3...) using pre-indexed counts
  const distinctRounds = idxState.distinctRounds;
  if (selectedEventRound !== 'all' && !distinctRounds.includes(Number(selectedEventRound))) {
    selectedEventRound = 'all';
  }
  if (roundsContainer) {
    const roundsRenderKey = `${eventId}:${eventMatchesCache.length}:${selectedEventRound}`;
    if (roundsContainer.dataset.renderedKey !== roundsRenderKey) {
      let pillsHtml = `
        <button class="round-filter-btn ${selectedEventRound === 'all' ? 'active' : ''}" onclick="setEventRoundFilter('all')">
          All Rounds (${eventMatchesCache.length})
        </button>
      `;
      distinctRounds.forEach(r => {
        const rCount = idxState.roundCounts.get(r) || 0;
        pillsHtml += `
          <button class="round-filter-btn ${selectedEventRound === r ? 'active' : ''}" onclick="setEventRoundFilter(${r})">
            Round ${r} (${rCount})
          </button>
        `;
      });
      roundsContainer.innerHTML = pillsHtml;
      roundsContainer.dataset.renderedKey = roundsRenderKey;
    }
  }

  // 1.3 Resolve logged-in competitor identity for quick banner
  const uBanner = (typeof authState !== 'undefined' && authState && authState.user) ||
                  (typeof currentUser !== 'undefined' ? currentUser : null) ||
                  (typeof window !== 'undefined' ? window.currentUser : null);
  const uBannerNames = [];
  if (uBanner) {
    [
      uBanner.display_name,
      uBanner.competitor_name,
      uBanner.full_name,
      uBanner.name,
      uBanner.username,
      (uBanner.first_name || uBanner.firstName) ? `${uBanner.first_name || uBanner.firstName} ${uBanner.last_name || uBanner.lastName || ''}` : '',
      (uBanner.lastName) ? `${uBanner.firstName || ''} ${uBanner.lastName}` : ''
    ].forEach(n => {
      if (n && typeof n === 'string' && n.trim()) uBannerNames.push(n.trim().toLowerCase());
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
      if (n && typeof n === 'string' && n.trim()) uBannerNames.push(n.trim().toLowerCase());
    });
  }
  const uBannerIds = [];
  if (uBanner) {
    [uBanner.player_id, uBanner.bcp_player_id, uBanner.bcp_user_id, uBanner.bcp_id, uBanner.id, uBanner.sub, uBanner.userId].forEach(id => {
      if (id && typeof id === 'string' && id.trim()) uBannerIds.push(id.trim().toLowerCase());
    });
  }
  if (typeof currentEventRegistration !== 'undefined' && currentEventRegistration && currentEventRegistration.is_registered) {
    const preg = currentEventRegistration.player_registration || {};
    const uprof = currentEventRegistration.user_profile || {};
    [preg.player_id, preg.id, preg.userId, preg.user_id, uprof.bcp_user_id, uprof.id].forEach(id => {
      if (id && typeof id === 'string' && id.trim()) uBannerIds.push(id.trim().toLowerCase());
    });
  }

  // 1.4 Render Competitor Active Pairing Banner (cached by event & user identity)
  const compBanner = document.getElementById('event-matches-competitor-banner');
  if (compBanner) {
    const bannerKey = `${eventId}:${eventMatchesCache.length}:${uBannerIds.join(',')}:${uBannerNames.join(',')}`;
    if (compBanner.dataset.renderedKey !== bannerKey) {
      compBanner.dataset.renderedKey = bannerKey;
      const myActive = (uBannerIds.length > 0 || uBannerNames.length > 0) ? (eventMatchesCache || []).find(m => {
        const p1Id = String(m.player1_id || '').trim().toLowerCase();
        const p2Id = String(m.player2_id || '').trim().toLowerCase();
        const p1Name = String(m.player1_name || '').trim().toLowerCase();
        const p2Name = String(m.player2_name || '').trim().toLowerCase();
        const isMe = (uBannerIds.includes(p1Id) || uBannerIds.includes(p2Id) || uBannerNames.some(un => (p1Name && (un.includes(p1Name) || p1Name.includes(un))) || (p2Name && (un.includes(p2Name) || p2Name.includes(un)))));
        return isMe && (m.player1_score === null || m.player2_score === null) && m.status !== 'finished';
      }) : null;

      if (myActive) {
        const isP1 = uBannerIds.includes(String(myActive.player1_id || '').toLowerCase()) || uBannerNames.some(un => un.includes(String(myActive.player1_name || '').toLowerCase()));
        const oppName = isP1 ? (myActive.player2_name || 'BYE') : (myActive.player1_name || 'Opponent');
        const oppId = isP1 ? (myActive.player2_id || '') : (myActive.player1_id || '');
        const oppFac = isP1 ? (myActive.player2_faction || '') : (myActive.player1_faction || '');
        const oppListId = isP1 ? (myActive.player2_list_id || '') : (myActive.player1_list_id || '');
        const oppRec = lookupEventPlayerFast(oppId, oppName);
        const safeOppId = String((oppRec && (oppRec.player_id || oppRec.id)) || oppId || '').replace(/'/g, "\\'");
        const safeOppName = String((oppRec && (oppRec.full_name || oppRec.name)) || oppName || '').replace(/'/g, "\\'");
        const safeOppListId = String(oppListId || (oppRec && (oppRec.list_id || oppRec.listId)) || '').replace(/'/g, "\\'");
        const oppHasList = Boolean(oppName !== 'BYE' && ((oppRec && hasPlayerSubmittedList(oppRec)) || safeOppListId));
        const tNum = myActive.table_number || myActive.table || 1;
        const rNum = myActive.round || 1;
        compBanner.style.display = 'flex';
        compBanner.innerHTML = `
          <div style="display:flex; align-items:center; gap:0.65rem; flex-wrap:wrap;">
            <span style="font-size:1.2rem;">⚡</span>
            <div>
              <div style="font-size:0.86rem; font-weight:800; color:#fff;">
                Round ${rNum} • Table ${tNum}: You vs ${oppName !== 'BYE' ? `<span class="player-link" style="color:#38bdf8; cursor:pointer;" onclick="event.stopPropagation(); openPlayerModal('${escapeHtml(safeOppId)}', '${escapeHtml(safeOppName)}');" title="View ${escapeHtml(oppName)}'s Player Profile">${escapeHtml(oppName)}</span>` : `<span style="color:#38bdf8;">BYE</span>`} ${oppFac ? `<span style="font-size:0.75rem; color:var(--text-muted); font-weight:normal;">(${escapeHtml(oppFac)})</span>` : ''}
              </div>
              <div style="font-size:0.74rem; color:#94a3b8;">
                Your active match is ready to play. Track live scores or submit to BCP via your Player Station.
              </div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
            ${oppHasList ? `
              <button type="button" class="btn btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(safeOppId || safeOppName)}', '${escapeHtml(safeOppListId)}')" style="font-size:0.75rem; font-weight:700; padding:5px 10px; color:#38bdf8; border-color:rgba(56,189,248,0.45); background:rgba(56,189,248,0.1); cursor:pointer; display:inline-flex; align-items:center; gap:0.3rem; border-radius:6px;">
                📋 Opponent Roster
              </button>
            ` : ''}
            <button type="button" class="btn btn-primary" onclick="switchEventModalTab('player')" style="font-size:0.76rem; font-weight:800; padding:5px 12px; background:#38bdf8; border-color:#0284c7; color:#000; cursor:pointer; display:inline-flex; align-items:center; gap:0.35rem; border-radius:6px;">
              ⚔️ Open My Player Station ➔
            </button>
          </div>
        `;
      } else {
        compBanner.style.display = 'none';
      }
    }
  }

  // 1.5 Render Live Stream Broadcast Alert Bar if streams are active
  const streamAlertWrap = document.getElementById('event-matches-stream-alert');
  if (streamAlertWrap) {
    if (typeof eventLiveStreams !== 'undefined' && eventLiveStreams.length > 0) {
      streamAlertWrap.style.display = 'flex';
      streamAlertWrap.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 8px #ef4444;"></span>
          <span style="font-size: 0.82rem; font-weight: 700; color: #fff;">🔴 Live Table Coverage:</span>
          <span style="font-size: 0.78rem; color: #fca5a5;">
            ${eventLiveStreams.map(s => `<strong>Table ${s.tableNumber}</strong> (${escapeHtml(s.channel)})`).join(' • ')}
          </span>
        </div>
        <button type="button" class="btn btn-primary" onclick="openEventStreamModal(${eventLiveStreams[0]?.tableNumber || 1})" style="font-size: 0.74rem; font-weight: 700; padding: 4px 10px; background: #ef4444; border-color: #dc2626; color: #fff; cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem;">
          📺 Watch Broadcast Theater (${eventLiveStreams.length})
        </button>
      `;
    } else {
      streamAlertWrap.style.display = 'none';
    }
  }

  // 2. Filter matches by selected round
  let matchesToRender = selectedEventRound === 'all' 
    ? eventMatchesCache 
    : eventMatchesCache.filter(m => (m.round || 1) === Number(selectedEventRound));

  // 3. Filter matches by search query (players, teams, factions) using O(1) pre-indexed _searchText
  if (eventModalSearchQuery) {
    const q = eventModalSearchQuery;
    matchesToRender = matchesToRender.filter(m => m && m._searchText && m._searchText.includes(q));
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

  // Permission checks: Is current logged-in user Player 1, Player 2, or Staff (Admin/TO/Referee)?
  const u = (typeof authState !== 'undefined' && authState && authState.user) ||
            (typeof currentUser !== 'undefined' ? currentUser : null) ||
            (typeof window !== 'undefined' ? window.currentUser : null);

  const userRole = String(
    (u && (u.role || u.user_role)) ||
    (typeof authState !== 'undefined' && authState && (authState.role || (authState.user && authState.user.role))) ||
    ''
  ).trim().toLowerCase();

  // Collect all candidate names, IDs, and emails for logged-in user
  const userNames = uBannerNames;
  const userIds = uBannerIds;
  const userIdsSet = new Set(userIds);
  const userEmailsSet = new Set();
  if (u) {
    [u.email, u.bcp_email].forEach(em => {
      if (em && typeof em === 'string' && em.trim()) {
        userEmailsSet.add(em.trim().toLowerCase());
      }
    });
  }
  if (typeof currentEventRegistration !== 'undefined' && currentEventRegistration && currentEventRegistration.is_registered) {
    const preg = currentEventRegistration.player_registration || {};
    const uprof = currentEventRegistration.user_profile || {};
    [preg.email, uprof.email].forEach(em => {
      if (em && typeof em === 'string' && em.trim()) {
        userEmailsSet.add(em.trim().toLowerCase());
      }
    });
  }
  const hasLoggedUser = Boolean(u && (userIdsSet.size > 0 || userNames.length > 0 || userEmailsSet.size > 0));

  function checkNameMatch(candidate, target) {
    if (!candidate || !target) return false;
    const c = candidate.trim().toLowerCase();
    const t = target.trim().toLowerCase();
    if (c === t) return true;
    if (c.replace(/\s+/g, '') === t.replace(/\s+/g, '')) return true;
    return false;
  }

  function recordMatchesUser(rec) {
    if (!rec || !hasLoggedUser) return false;
    const recIds = [rec.player_id, rec.id, rec.user_id, rec.userId];
    for (let i = 0; i < recIds.length; i++) {
      const id = recIds[i];
      if (id && userIdsSet.has(String(id).trim().toLowerCase())) return true;
    }
    const recEmail = String(rec.email || '').trim().toLowerCase();
    if (recEmail && userEmailsSet.has(recEmail)) return true;
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

  // Pre-index live streams by table number
  const streamByTableMap = new Map();
  let defaultStream = null;
  if (typeof eventLiveStreams !== 'undefined' && Array.isArray(eventLiveStreams) && eventLiveStreams.length > 0) {
    for (let i = 0; i < eventLiveStreams.length; i++) {
      const s = eventLiveStreams[i];
      if (!s) continue;
      const tNum = Number(s.tableNumber);
      if (tNum === 0 && !defaultStream) defaultStream = s;
      else if (!streamByTableMap.has(tNum)) streamByTableMap.set(tNum, s);
    }
  }

  const safeEventId = String(eventId).replace(/'/g, "\\'");
  const rowContextKey = `${safeEventId}:${isStaff ? 1 : 0}:${u ? (u.id || u.email || '') : ''}:${typeof eventLiveStreams !== 'undefined' && Array.isArray(eventLiveStreams) ? eventLiveStreams.length : 0}`;
  const rowsHtml = [];

  for (let i = 0; i < matchesToRender.length; i++) {
    const m = matchesToRender[i];
    if (m._cachedRowKey === rowContextKey && m._cachedRowHtml) {
      rowsHtml.push(m._cachedRowHtml);
      continue;
    }
    try {
      const isP1Win = m.winner_id && m.winner_id === m.player1_id;
      const isP2Win = m.winner_id && m.winner_id === m.player2_id;
      const outcome = isP1Win ? 'Player 1 Win' : (isP2Win ? 'Player 2 Win' : (m.is_draw ? 'Draw' : (m.is_bye ? 'BYE' : 'Pending')));
      const matchId = `BCP-${eventId}-R${m.round || 1}-T${m.table_number || 1}`;

      const isBye = Boolean(m.is_bye || m.player2_name === 'BYE' || !m.player2_id);
      const hasScore = (m.player1_score !== null && m.player2_score !== null);
      const hasTrackerGame = Boolean(m.has_tracker_game);
      const isTrackerDone = Boolean(m.tracker_is_done || m.tracker_status === 'completed');

      const p1Record = m._p1Record !== undefined ? m._p1Record : lookupEventPlayerFast(m.player1_id, m.player1_name);
      const p2Record = m._p2Record !== undefined ? m._p2Record : lookupEventPlayerFast(m.player2_id, m.player2_name);
      const p1Faction = m._p1Faction !== undefined ? m._p1Faction : (m.player1_faction || p1Record?.faction || '');
      const p2Faction = m._p2Faction !== undefined ? m._p2Faction : (m.player2_faction || p2Record?.faction || '');

      let isP1 = false;
      let isP2 = false;
      if (hasLoggedUser) {
        const p1NameClean = (m.player1_name || '').trim().toLowerCase();
        const p2NameClean = (m.player2_name || '').trim().toLowerCase();
        const p1IdClean = (m.player1_id || '').trim().toLowerCase();
        const p2IdClean = (m.player2_id || '').trim().toLowerCase();

        isP1 = Boolean(
          (p1IdClean && userIdsSet.has(p1IdClean)) ||
          (p1NameClean && userNames.some(un => checkNameMatch(un, p1NameClean))) ||
          recordMatchesUser(p1Record)
        );
        isP2 = Boolean(
          (p2IdClean && userIdsSet.has(p2IdClean)) ||
          (p2NameClean && userNames.some(un => checkNameMatch(un, p2NameClean))) ||
          recordMatchesUser(p2Record)
        );
      }

      const canEdit = Boolean(isP1 || isP2 || isStaff);

      let actionBtn = '';
      if (!isBye) {
        if (isTrackerDone || hasScore) {
          actionBtn = `<button class="btn-sm btn-outline" style="font-size:0.72rem; padding:0.2rem 0.5rem; display:inline-flex; align-items:center; gap:0.3rem; cursor:pointer;" onclick="event.stopPropagation(); openScorecardModal('${matchId}')" title="${isTrackerDone ? 'View turn-by-turn digital scorecard' : 'View official BCP match scorecard'}">📄 Scorecard</button>`;
        } else if (!hasScore && canEdit) {
          const safeP1Name = String(m.player1_name || 'Player 1').replace(/'/g, "\\'");
          const safeP2Name = String(m.player2_name || 'Player 2').replace(/'/g, "\\'");
          const safeP1Id = String(m.player1_id || '').replace(/'/g, "\\'");
          const safeP2Id = String(m.player2_id || '').replace(/'/g, "\\'");
          const safePairingId = String(m.id || m.pairing_id || m.bcp_pairing_id || '').replace(/'/g, "\\'");
          const btnLabel = hasTrackerGame ? '🎮 Resume' : '🎲 Track';
          actionBtn = `<button class="btn-sm" style="font-size:0.72rem; padding:0.2rem 0.55rem; background:#0284c7; color:#fff; border:1px solid #38bdf8; border-radius:6px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:0.3rem;" onclick="event.stopPropagation(); launchTournamentTracker('${safeEventId}', ${m.round || 1}, ${m.table_number || m.table || 1}, '${escapeHtml(safeP1Name)}', '${escapeHtml(safeP2Name)}', '${escapeHtml(safeP1Id)}', '${escapeHtml(safeP2Id)}', '${escapeHtml(safePairingId)}')" title="1-Click Launch Game Tracker for Table ${m.table_number || m.table || 1}">${btnLabel}</button>`;
        } else if (!hasScore && !canEdit) {
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
      const p1ListId = String(m.player1_list_id || (p1Record && (p1Record.list_id || p1Record.listId)) || '').replace(/'/g, "\\'");
      const p2ListId = String(m.player2_list_id || (p2Record && (p2Record.list_id || p2Record.listId)) || '').replace(/'/g, "\\'");
      const p1HasList = Boolean((p1Record && hasPlayerSubmittedList(p1Record)) || p1ListId);
      const p2HasList = Boolean(!isBye && ((p2Record && hasPlayerSubmittedList(p2Record)) || p2ListId));
      const p1RosterBtn = p1HasList
        ? `<button type="button" class="btn-xs btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(targetP1Id || targetP1Name)}', '${escapeHtml(p1ListId)}')" style="font-size:0.68rem; padding:1px 6px; border-radius:4px; color:#38bdf8; border:1px solid rgba(56,189,248,0.38); background:rgba(56,189,248,0.1); cursor:pointer; font-weight:600; display:inline-flex; align-items:center; gap:3px; line-height:1.3;" title="View ${escapeHtml(m.player1_name || 'Player 1')}'s Army Roster">📋 Roster</button>`
        : '';
      const p2RosterBtn = p2HasList
        ? `<button type="button" class="btn-xs btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(targetP2Id || targetP2Name)}', '${escapeHtml(p2ListId)}')" style="font-size:0.68rem; padding:1px 6px; border-radius:4px; color:#38bdf8; border:1px solid rgba(56,189,248,0.38); background:rgba(56,189,248,0.1); cursor:pointer; font-weight:600; display:inline-flex; align-items:center; gap:3px; line-height:1.3;" title="View ${escapeHtml(m.player2_name || 'Player 2')}'s Army Roster">📋 Roster</button>`
        : '';

      const p1Prob = m._p1_win_prob !== undefined ? m._p1_win_prob : 50;
      const p2Prob = m._p2_win_prob !== undefined ? m._p2_win_prob : 50;
      const p1ProbPill = !isBye ? `<span class="badge" style="background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.28); font-size:0.68rem; font-family:var(--font-mono); margin-left:6px; padding:1px 5px;" title="Elo Win Probability">${p1Prob}%</span>` : '';
      const p2ProbPill = !isBye ? `<span class="badge" style="background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.28); font-size:0.68rem; font-family:var(--font-mono); margin-left:6px; padding:1px 5px;" title="Elo Win Probability">${p2Prob}%</span>` : '';

      const tableNumVal = Number(m.table_number || m.table || 1);
      const matchStream = streamByTableMap.get(tableNumVal) || defaultStream;

      const streamBtn = matchStream ? `
        <button type="button" class="btn-sm" style="font-size:0.72rem; padding:0.2rem 0.55rem; background:rgba(239,68,68,0.18); border:1px solid #ef4444; color:#fca5a5; border-radius:6px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:0.35rem;" onclick="event.stopPropagation(); openEventStreamModal(${matchStream.tableNumber})" title="Watch ${escapeHtml(matchStream.channel)} Live Stream ${Number(matchStream.tableNumber) === 0 ? '(Main Desk)' : `on Table ${matchStream.tableNumber}`}">
          <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#ef4444; box-shadow:0 0 6px #ef4444;"></span>
          🔴 Watch Live
        </button>
      ` : '';

      const rowStyle = (isP1 || isP2) ? ' style="background:rgba(59, 130, 246, 0.12); border-left:3px solid #38bdf8;"' : '';

      const rowHtml = `
        <tr${rowStyle}>
          <td style="font-family:var(--font-mono); font-weight:700;">R${m.round || 1}</td>
          <td style="font-family:var(--font-mono); color:${matchStream ? '#f87171' : 'var(--text-muted)'}; font-weight:${matchStream ? '800' : 'normal'};">
            T${tableNumVal}${matchStream ? ' <span title="Live Stream Available - Click to Watch" style="font-size:0.72rem; cursor:pointer;" onclick="event.stopPropagation(); openEventStreamModal(' + tableNumVal + ')">🎥</span>' : ''}
          </td>
          <td>
            <div class="player-name-cell">
              <div style="display:flex; align-items:center; flex-wrap:wrap; gap:2px;">
                <span class="player-link" style="color:${isP1Win ? 'var(--win)' : '#fff'}; font-weight:600;" onclick="event.stopPropagation(); openPlayerModal('${targetP1Id}', '${escapeHtml(targetP1Name)}');">
                  ${escapeHtml(m.player1_name || 'Player 1')}
                </span>
                ${isP1 ? '<span class="badge" style="background:#0284c7; color:#fff; font-size:0.65rem; font-weight:800; padding:1px 5px; margin-left:4px; border:none;">YOU</span>' : ''}
                ${p1ProbPill}
              </div>
              ${(p1Faction || p1RosterBtn) ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:3px; display:flex; align-items:center; flex-wrap:wrap; gap:5px;">${p1Faction ? `<span class="badge" style="background:var(--bg-card); border:1px solid var(--border); font-size:0.7rem; padding:0.1rem 0.35rem; border-radius:4px; font-weight:500;">${escapeHtml(p1Faction)}</span>` : ''}${p1RosterBtn}</div>` : ''}
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
                     <span class="player-link" style="color:${isP2Win ? 'var(--win)' : '#fff'}; font-weight:600;" onclick="event.stopPropagation(); openPlayerModal('${targetP2Id}', '${escapeHtml(targetP2Name)}');">
                       ${escapeHtml(m.player2_name || 'Player 2')}
                     </span>
                     ${isP2 ? '<span class="badge" style="background:#0284c7; color:#fff; font-size:0.65rem; font-weight:800; padding:1px 5px; margin-left:4px; border:none;">YOU</span>' : ''}
                     ${p2ProbPill}
                   </div>`
              }
              ${(!isBye && (p2Faction || p2RosterBtn)) ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:3px; display:flex; align-items:center; flex-wrap:wrap; gap:5px;">${p2Faction ? `<span class="badge" style="background:var(--bg-card); border:1px solid var(--border); font-size:0.7rem; padding:0.1rem 0.35rem; border-radius:4px; font-weight:500;">${escapeHtml(p2Faction)}</span>` : ''}${p2RosterBtn}</div>` : ''}
            </div>
          </td>
          <td>
            <div style="display:flex; align-items:center; gap:0.4rem; justify-content:flex-end; flex-wrap:wrap;">
              <span class="badge ${isP1Win || isP2Win ? 'badge-win' : (m.is_draw ? 'badge-draw' : 'badge-loss')}">${outcome}</span>
              ${streamBtn}
              ${actionBtn}
            </div>
          </td>
        </tr>`;
      m._cachedRowHtml = rowHtml;
      m._cachedRowKey = rowContextKey;
      rowsHtml.push(rowHtml);
    } catch (rowErr) {
      console.error('Error rendering pairing row:', rowErr, m);
    }
  }

  tbody.innerHTML = rowsHtml.join('');
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

var cachedGamesystemFactions = (typeof window !== 'undefined' && window.cachedGamesystemFactions) || {};
if (typeof window !== 'undefined') window.cachedGamesystemFactions = cachedGamesystemFactions;
var currentEventRegistration = (typeof window !== 'undefined' && window.currentEventRegistration) || null;
if (typeof window !== 'undefined') window.currentEventRegistration = currentEventRegistration;

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
    ta.value = (al.raw_text && al.raw_text.trim()) ? al.raw_text : (window.generateRawRosterText ? window.generateRawRosterText(al) : '');
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
let currentEventArmyListText = '';
let currentEventParsedRoster = null;
let currentEventArmyListViewMode = 'text';

function getEventNumRounds(ev, matches = []) {
  if (!ev) return 0;
  // 1. Take authentic BCP round count directly as primary source of truth
  const rawBcp = Number(
    ev.numberOfRounds ||
    ev.numRounds ||
    ev.raw_json?.numberOfRounds ||
    ev.raw_json?.numRounds ||
    0
  );
  if (rawBcp > 0) return rawBcp;

  // 2. Fall back to max round observed in actual match pairings
  const matchRounds = (Array.isArray(matches) && matches.length > 0)
    ? Math.max(...matches.map(m => Number(m.round || 1)))
    : 0;
  if (matchRounds > 0) return matchRounds;

  // 3. Fall back to stored num_rounds
  return Number(ev.num_rounds || ev.rounds || 0);
}

function isEventEnded(ev, regData = null) {
  if (!ev && !regData) return false;

  // 1. Explicit boolean or status string checks
  if (
    ev?.ended === true ||
    ev?.is_ended === true ||
    ev?.isEnded === true ||
    ev?.status?.ended === true ||
    ev?.status?.isEnded === true ||
    ev?.status === 'ended' ||
    ev?.status === 'completed' ||
    ev?.status === 'finished' ||
    ev?.raw_json?.ended === true ||
    ev?.raw_json?.isEnded === true ||
    ev?.raw_json?.status?.ended === true ||
    ev?.raw_json?.status === 'ended' ||
    ev?.raw_json?.status === 'completed' ||
    regData?.ended === true ||
    regData?.is_ended === true ||
    regData?.status?.ended === true ||
    regData?.status === 'ended' ||
    regData?.status === 'completed'
  ) {
    return true;
  }

  // 2. Structural Round & Match Context
  const matches = Array.isArray(ev?.matches) ? ev.matches : (Array.isArray(eventMatchesCache) ? eventMatchesCache : []);
  const players = Array.isArray(ev?.players) ? ev.players : (Array.isArray(eventPlayersCache) ? eventPlayersCache : []);
  const numRounds = getEventNumRounds(ev, matches);
  const currentRound = Number(ev?.current_round || ev?.currentRound || ev?.raw_json?.currentRound || 0);
  const hasMatches = matches.length > 0 || players.some(p => (p.event_wins || p.wins || 0) > 0 || (p.event_losses || p.losses || 0) > 0 || (p.placement && p.placement > 0));

  const hasActiveBcpRound = Boolean(
    ev?.raw_json?.rounds &&
    typeof ev.raw_json.rounds === 'object' &&
    Object.values(ev.raw_json.rounds).some(rv => rv && rv.status === 'active')
  );
  const hasActiveMatches = hasActiveBcpRound || matches.some(m =>
    m.status === 'in_progress' ||
    m.status === 'active' ||
    (currentRound > 0 && Number(m.round) === currentRound && m.winner_id == null && !m.is_done && (m.player1_score == null || m.player2_score == null))
  );
  const isIncompleteRounds = numRounds > 0 && currentRound > 0 && currentRound < numRounds;

  // 3. Date and Timestamp Checks
  const now = new Date();
  const todayStr = (typeof getLocalIsoDateStr === 'function')
    ? getLocalIsoDateStr()
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const rawEnd = ev?.end_date || ev?.endDate || ev?.eventEndDate || ev?.raw_json?.endDate || ev?.raw_json?.eventEndDate || ev?.raw_json?.end_date || '';
  const rawStart = ev?.event_date || ev?.eventDate || ev?.start_date || ev?.startDate || ev?.raw_json?.startDate || ev?.raw_json?.eventDate || '';
  const startDateStr = String(rawStart).slice(0, 10);
  const endDateStr = rawEnd ? String(rawEnd).slice(0, 10) : '';
  const isSingleDay = !endDateStr || endDateStr === startDateStr || (numRounds > 0 && numRounds <= 3);

  const pastThreshold = new Date(now.getTime() - (48 * 60 * 60 * 1000));
  const pastThresholdStr = `${pastThreshold.getFullYear()}-${String(pastThreshold.getMonth() + 1).padStart(2, '0')}-${String(pastThreshold.getDate()).padStart(2, '0')}`;

  if (rawEnd) {
    const endMs = Date.parse(rawEnd);
    if (!isNaN(endMs)) {
      const isPastEnd = String(rawEnd).includes('T') || String(rawEnd).includes(':')
        ? endMs < now.getTime()
        : endDateStr < todayStr;

      if (isPastEnd) {
        // If event is more than 48 hours past its end date, it is definitely ended regardless of status
        if (endMs < pastThreshold.getTime() || endDateStr < pastThresholdStr) {
          return true;
        }
        // If rounds are complete or no active matches in progress, it is completed
        if (!hasActiveMatches && !isIncompleteRounds) {
          return true;
        }
      }
    }
  }

  if (startDateStr) {
    // Single-day events (RTTs) in the past are completed
    if (isSingleDay && startDateStr < todayStr && hasMatches && !hasActiveMatches) {
      return true;
    }

    // Any event that started more than 3 days ago with matches is completed
    const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));
    const threeDaysAgoStr = `${threeDaysAgo.getFullYear()}-${String(threeDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(threeDaysAgo.getDate()).padStart(2, '0')}`;
    if (startDateStr < threeDaysAgoStr && hasMatches) {
      return true;
    }
  }

  // 3. Round & Match Structural Completion
  // If all rounds are reached and all matches in the final round are scored/finished
  if (numRounds > 0 && currentRound >= numRounds && matches.length > 0 && !hasActiveMatches) {
    const finalRoundMatches = matches.filter(m => Number(m.round) === numRounds);
    if (finalRoundMatches.length > 0) {
      const allFinalScored = finalRoundMatches.every(m =>
        m.is_done === true ||
        m.winner_id != null ||
        m.is_bye === true ||
        (m.player1_score != null && m.player2_score != null)
      );
      if (allFinalScored) {
        return true;
      }
    }
  }

  // 4. Official final standings already determined
  if (!hasActiveMatches && !isIncompleteRounds && hasMatches && players.some(p => (p.placement === 1 || p.official_placement === 1) && ((p.event_wins || p.wins || 0) + (p.event_losses || p.losses || 0) + (p.event_draws || p.draws || 0)) >= Math.max(1, numRounds))) {
    if (startDateStr && startDateStr <= todayStr) {
      if (numRounds > 0 && currentRound >= numRounds) {
        return true;
      }
      if (isSingleDay && startDateStr < todayStr) {
        return true;
      }
    }
  }

  return false;
}
window.isEventEnded = isEventEnded;

function getEventTierBadgeHtml(totalPlayers, eventName = '') {
  const count = Number(totalPlayers || 0);
  const nameLower = String(eventName || '').toLowerCase();
  if (count >= 100 || nameLower.includes('super major') || nameLower.includes('lvo') || nameLower.includes('adepticon') || nameLower.includes('nova open')) {
    return `<span class="badge" style="background:rgba(234,179,8,0.18); color:#facc15; border:1px solid rgba(234,179,8,0.4); font-weight:800; font-size:0.72rem; letter-spacing:0.04em;">👑 SUPER MAJOR</span>`;
  } else if (count >= 60 || nameLower.includes('major') || nameLower.includes(' open')) {
    return `<span class="badge" style="background:rgba(168,85,247,0.18); color:#c084fc; border:1px solid rgba(168,85,247,0.4); font-weight:800; font-size:0.72rem; letter-spacing:0.04em;">🏆 MAJOR</span>`;
  } else if (count >= 28 || /\bgt\b/.test(nameLower) || nameLower.includes('grand tournament')) {
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
    [p.player_id, p.id, p.bcp_event_player_id, p.user_id, p.bcp_player_id].forEach(cid => {
      if (cid) pMap.set(String(cid).trim().toLowerCase(), p);
    });
    if (pname) {
      pMap.set(pname, p);
      pMap.set(pname.replace(/\s+/g, ''), p);
    }
  });

  if (Array.isArray(matches) && matches.length > 0) {
    matches.forEach(m => {
      const isBye = Boolean(m.is_bye || m.player2_name === 'BYE' || !m.player2_id || m.player1_name === 'BYE' || !m.player1_id);
      if (isBye) return;

      const p1Id = String(m.player1_id || '').trim().toLowerCase();
      const p1Name = String(m.player1_name || '').trim().toLowerCase();
      const p2Id = String(m.player2_id || '').trim().toLowerCase();
      const p2Name = String(m.player2_name || '').trim().toLowerCase();

      const p1Rec = pMap.get(p1Id) || pMap.get(p1Name) || pMap.get(p1Name.replace(/\s+/g, ''));
      const p2Rec = pMap.get(p2Id) || pMap.get(p2Name) || pMap.get(p2Name.replace(/\s+/g, ''));

      if (p1Rec && p1Rec.list_id && !m.player1_list_id) m.player1_list_id = p1Rec.list_id;
      if (p2Rec && p2Rec.list_id && !m.player2_list_id) m.player2_list_id = p2Rec.list_id;

      const rNum = Number(m.round || 1);
      const g1 = (p1Rec && Array.isArray(p1Rec.games))
        ? p1Rec.games.find(g => g && Number(g.gameNum || g.gameNumber || g.round || 0) === rNum)
        : null;
      const g2 = (p2Rec && Array.isArray(p2Rec.games))
        ? p2Rec.games.find(g => g && Number(g.gameNum || g.gameNumber || g.round || 0) === rNum)
        : null;

      if (g1 && g1.gamePoints !== undefined && g1.gamePoints !== null) {
        m.player1_score = Number(g1.gamePoints);
      }
      if (g2 && g2.gamePoints !== undefined && g2.gamePoints !== null) {
        m.player2_score = Number(g2.gamePoints);
      }
      if (g1 && g2) {
        if (Number(g1.gameResult) === 2 && Number(g2.gameResult) === 0) {
          m.winner_id = m.player1_id;
          m.loser_id = m.player2_id;
          m.is_draw = false;
        } else if (Number(g2.gameResult) === 2 && Number(g1.gameResult) === 0) {
          m.winner_id = m.player2_id;
          m.loser_id = m.player1_id;
          m.is_draw = false;
        } else if (m.player1_score !== null && m.player2_score !== null) {
          if (Number(m.player1_score) > Number(m.player2_score)) {
            m.winner_id = m.player1_id;
            m.loser_id = m.player2_id;
            m.is_draw = false;
          } else if (Number(m.player2_score) > Number(m.player1_score)) {
            m.winner_id = m.player2_id;
            m.loser_id = m.player1_id;
            m.is_draw = false;
          } else if (Number(m.player1_score) === Number(m.player2_score) && Number(m.player1_score) > 0) {
            m.winner_id = null;
            m.loser_id = null;
            m.is_draw = true;
          }
        }
      }

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
        (!m.winner_id && hasScores && Number(m.player1_score) > Number(m.player2_score))
      );
      const isP2Win = Boolean(
        (m.winner_id && String(m.winner_id) === String(m.player2_id)) ||
        outcomeStr.includes('player 2 win') ||
        (!m.winner_id && hasScores && Number(m.player2_score) > Number(m.player1_score))
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
  if (
    ev &&
    ev._cachedKpiSummary &&
    ev._cachedKpiPlayersLen === players.length &&
    ev._cachedKpiMatchesLen === matches.length
  ) {
    return ev._cachedKpiSummary;
  }
  const teams = (ev?.teams && ev.teams.length > 0) ? ev.teams : (ev?.team_standings || []);
  const isTeamEvent = Boolean(ev?.is_team_event || teams.length > 0);
  const isDoublesEvent = Boolean(ev?.is_doubles_event);
  const totalPlayers = ev?.total_players || players.length || 0;
  const totalTeams = ev?.total_teams || teams.length || 0;
  const numRounds = getEventNumRounds(ev, matches) || 5;
  const ended = isEventEnded(ev);
  const now = new Date();
  const todayStr = (typeof getLocalIsoDateStr === 'function')
    ? getLocalIsoDateStr()
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const rawStart = ev?.event_date || ev?.eventDate || ev?.start_date || ev?.startDate || ev?.raw_json?.startDate || ev?.raw_json?.eventDate || '';
  const startDateStr = String(rawStart).slice(0, 10);
  const isFuture = Boolean(startDateStr && startDateStr > todayStr);

  const hasMatchesPlayed = !isFuture && (
    matches.length > 0 ||
    players.some(p => (Number(p.event_wins || p.wins || 0) > 0) || (Number(p.event_losses || p.losses || 0) > 0) || (Number(p.event_draws || p.draws || 0) > 0) || (Number(p.event_battle_points || p.battle_points || 0) > 0))
  );

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

  const summary = {
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
  if (ev) {
    ev._cachedKpiSummary = summary;
    ev._cachedKpiPlayersLen = players.length;
    ev._cachedKpiMatchesLen = matches.length;
  }
  return summary;
}

function renderQuickEventModal(ev, userRegData) {
  if (!ev) return;
  currentEventData = ev;
  if (Array.isArray(ev.players)) eventPlayersCache = ev.players;
  if (Array.isArray(ev.matches)) eventMatchesCache = ev.matches;
  invalidateEventSearchIndex();
  ensureEventSearchIndex();

  const kpi = getEventKpiSummary(ev);
  const nameEl = document.getElementById('modal-event-name');
  if (nameEl) nameEl.textContent = ev.name || ev.event_name || 'Tournament Details';
  const bcpLink = document.getElementById('modal-event-bcp-link');
  if (bcpLink && ev.id) bcpLink.href = `https://www.bestcoastpairings.com/event/${encodeURIComponent(ev.id)}`;
  const metaEl = document.getElementById('modal-event-meta');
  if (metaEl) {
    const loc = [ev.city, ev.state, ev.country].filter(Boolean).join(', ') || 'Online / Unspecified';
    const dStr = (ev.event_date || ev.start_date || '').slice(0, 10);
    const rds = kpi.numRounds ? ` • 🔄 ${kpi.numRounds} Rounds` : '';
    metaEl.innerHTML = `<span>📅 ${escapeHtml(dStr || 'Date TBD')}</span><span> • 📍 ${escapeHtml(loc)}</span><span>${rds}</span>`;
  }
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
    badgesEl.innerHTML = `${getEventTierBadgeHtml(kpi.totalPlayers, ev.name || ev.event_name || '')} ${sysBadge} ${statusBadge} ${formatBadge}`;
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

var _quickModalSearchDebounceTimer = null;

function handleQuickModalSearch(val, immediate = true) {
  const nextQuery = (val || '').trim().toLowerCase();
  quickModalSearchQuery = nextQuery;
  if (_quickModalSearchDebounceTimer) {
    clearTimeout(_quickModalSearchDebounceTimer);
    _quickModalSearchDebounceTimer = null;
  }
  if (immediate || !nextQuery) {
    renderQuickModalTable();
  } else {
    _quickModalSearchDebounceTimer = setTimeout(() => {
      _quickModalSearchDebounceTimer = null;
      renderQuickModalTable();
    }, 50);
  }
}

function renderQuickModalTable() {
  const thead = document.getElementById('modal-quick-thead');
  const tbody = document.getElementById('modal-quick-tbody');
  if (!thead || !tbody) return;

  ensureEventSearchIndex();
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
      const q = quickModalSearchQuery;
      filteredTeams = kpi.teams.filter(t => t && (t._searchText ? t._searchText.includes(q) : ((t.name || '').toLowerCase().includes(q) || (t.captain_name || t.captain || '').toLowerCase().includes(q))));
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

  let sortedPlayers;
  if (currentEventData && Array.isArray(currentEventData._quickSortedPlayers) && currentEventData._quickSortedPlayers.length === kpi.players.length) {
    sortedPlayers = currentEventData._quickSortedPlayers;
  } else {
    sortedPlayers = kpi.players.slice();
    if (kpi.hasMatchesPlayed) {
      sortedPlayers.sort((a, b) => {
        const plA = (a.placement && a.placement > 0) ? a.placement : 9999;
        const plB = (b.placement && b.placement > 0) ? b.placement : 9999;
        if (plA !== plB) return plA - plB;
        return Number(b.current_elo || 1500) - Number(a.current_elo || 1500);
      });
    } else {
      sortedPlayers.sort((a, b) => Number(b.current_elo || 1500) - Number(a.current_elo || 1500));
    }
    if (currentEventData) {
      currentEventData._quickSortedPlayers = sortedPlayers;
    }
  }

  let players = sortedPlayers;
  if (quickModalSearchQuery) {
    const q = quickModalSearchQuery;
    players = sortedPlayers.filter(p => p && (p._searchText ? p._searchText.includes(q) : ((p.full_name || '').toLowerCase().includes(q) || formatEventPlayerFaction(p.faction || p.army_name).toLowerCase().includes(q) || (p.team || '').toLowerCase().includes(q))));
  }

  if (players.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="padding:1.75rem;">No competitors match "${escapeHtml(quickModalSearchQuery)}"</td></tr>`;
    return;
  }

  tbody.innerHTML = players.map((p, idx) => {
    const safePid = String(p.player_id || p.id || '').trim();
    const safeName = String(p.full_name || 'Player').trim();
    const displayFac = p._formattedFaction || formatEventPlayerFaction(p.faction || p.army_name);
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
      <tr style="cursor:pointer;" onclick="event.stopPropagation(); openPlayerModal('${safePid}', '${escapeHtml(safeName)}');">
        <td class="rank-cell" style="width:55px; text-align:center; padding:0.5rem 0.6rem;">${rankStr}</td>
        <td class="modal-quick-competitor-col" style="min-width:130px; padding:0.5rem 0.65rem;">
          <div class="modal-quick-competitor-name" style="font-weight:600; color:#38bdf8;" title="${escapeHtml(safeName)}">${escapeHtml(safeName)}</div>
          ${p.team ? `<div class="modal-quick-competitor-team" style="font-size:0.72rem; color:var(--text-muted); margin-top:2px;" title="${escapeHtml(p.team)}">🛡️ ${escapeHtml(p.team)}</div>` : ''}
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
            <button type="button" class="btn-sm btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(safePid || safeName)}')" style="font-size:0.72rem; padding:2px 8px; cursor:pointer;" title="View competitor army roster">
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

  if (typeof closeAllModals === 'function') {
    closeAllModals();
  } else if (typeof closeModal === 'function') {
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
    const isOngoing = (typeof isTournamentOngoing === 'function')
      ? isTournamentOngoing(currentEventData)
      : (!ended && (currentEventData?.matches || []).length > 0);
    if (isRegistered && !ended) {
      targetTab = 'player';
    } else if (isOngoing) {
      targetTab = 'matches';
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
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.remove('active');
      p.style.removeProperty('display');
    });
    const panel = document.getElementById('tab-event-hub');
    if (panel) {
      panel.style.removeProperty('display');
      panel.classList.add('active');
    }
  }
  const eventPanel = document.getElementById('tab-event-hub');
  if (eventPanel) {
    eventPanel.style.removeProperty('display');
    eventPanel.classList.add('active');
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
  const clientCached = (window.api && window.api._cache && window.api._cache.get(`/api/event/${encodeURIComponent(eventId)}`))?.data;
  const hasCached = Boolean(
    (!options.forceSync && (
      (currentEventData && String(currentEventData.id) === String(eventId)) ||
      clientCached
    ))
  );

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
    let ev = (currentEventData && String(currentEventData.id) === String(eventId)) ? currentEventData : clientCached;
    let userRegData = currentEventRegistration;

    if (!hasCached || !ev) {
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
    invalidateEventSearchIndex();
    ensureEventSearchIndex();

    if (typeof loadEventLivestreams === 'function') {
      await loadEventLivestreams(eventId);
    }

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

    const isCC = Boolean(typeof isUserCC === 'function' ? isUserCC(currentUser) : (currentUser && (currentUser.role === 'admin' || currentUser.role === 'cc' || currentUser.is_admin)));
    const subtabCreator = document.getElementById('event-subtab-creator');
    if (subtabCreator) {
      subtabCreator.style.setProperty('display', isCC ? 'inline-flex' : 'none', 'important');
    }

    const ended = isEventEnded(ev, userRegData);
    const shouldShowPlayerTab = Boolean(userRegData && userRegData.is_registered);
    const subtabPlayer = document.getElementById('event-subtab-player');
    if (subtabPlayer) {
      subtabPlayer.style.setProperty('display', shouldShowPlayerTab ? 'inline-flex' : 'none', 'important');
    }
    if (shouldShowPlayerTab) {
      await renderPlayerStation(ev, userRegData);
    }

    renderEventResultsRows();
    renderEventEloRows();
    renderEventPairingsRows();

    let targetTab = options.initialTab;
    if (targetTab === 'creator' && !isCC) {
      targetTab = 'results';
    }
    if (targetTab === 'teams' && !isTeamEvent && teamsList.length === 0) {
      targetTab = 'results';
    }
    if (targetTab === 'player' && !shouldShowPlayerTab) {
      targetTab = (isTeamEvent || teamsList.length > 0) ? 'teams' : 'results';
    }
    if (!targetTab) {
      const isOngoing = (typeof isTournamentOngoing === 'function')
        ? isTournamentOngoing(ev)
        : (!ended && eventMatchesCache.length > 0);
      if (shouldShowPlayerTab && !ended) {
        targetTab = 'player';
      } else if (isOngoing && eventMatchesCache.length > 0) {
        targetTab = 'matches';
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
              ${getEventTierBadgeHtml(kpi.totalPlayers, eventName)}
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
            <span class="btn-text-desktop">🔗 Share Event Link</span>
            <span class="btn-text-mobile">🔗 Share</span>
          </button>
          <a href="https://www.bestcoastpairings.com/event/${encodeURIComponent(eventId)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="font-weight: 600; font-size: 0.82rem; padding: 0.48rem 0.95rem; text-decoration: none;">
            <span class="btn-text-desktop">Listing on BCP ↗</span>
            <span class="btn-text-mobile">BCP ↗</span>
          </a>
          <button type="button" class="btn btn-primary" onclick="openEventHubPage('${escapeHtml(eventId)}', '${sys}', { forceSync: true })" style="font-weight: 700; font-size: 0.82rem; padding: 0.48rem 1rem; cursor: pointer;">
            🔄 Refresh
          </button>
        </div>
      </div>

      <!-- 4 Hero KPI Cards (Desktop & Tablet) -->
      <div id="event-hub-kpis-grid" class="profile-kpi-grid event-hub-kpi-grid" style="margin-top: 1.2rem;">
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

function resolveEventCompetitorRecord(playerId, playerName, fallbackListId = '') {
  const qId = String(playerId || '').trim().toLowerCase();
  const qName = String(playerName || '').trim().toLowerCase();
  const qNameClean = qName.replace(/\s+/g, '');

  let found = lookupEventPlayerFast(playerId, playerName);

  if (!found) {
    const candidates = [
      ...(Array.isArray(eventPlayersCache) ? eventPlayersCache : []),
      ...((typeof currentEventData !== 'undefined' && currentEventData && Array.isArray(currentEventData.players)) ? currentEventData.players : []),
      ...((typeof currentEventData !== 'undefined' && currentEventData && Array.isArray(currentEventData.standings)) ? currentEventData.standings : []),
      ...((typeof currentEventData !== 'undefined' && currentEventData && Array.isArray(currentEventData.roster)) ? currentEventData.roster : []),
      ...((typeof currentEventData !== 'undefined' && currentEventData && Array.isArray(currentEventData.unassigned)) ? currentEventData.unassigned : [])
    ];

    found = candidates.find(item => {
      if (!item) return false;
      const ids = [item.player_id, item.id, item.bcp_event_player_id, item.user_id, item.bcp_player_id]
        .filter(Boolean)
        .map(x => String(x).trim().toLowerCase());
      if (qId && ids.includes(qId)) return true;
      const nm = String(item.full_name || item.name || item.player_name || '').trim().toLowerCase();
      if (qName && nm && (nm === qName || nm.replace(/\s+/g, '') === qNameClean)) return true;
      return false;
    });
  }

  if (!found && Array.isArray(eventMatchesCache)) {
    for (const m of eventMatchesCache) {
      if (!m) continue;
      const p1Id = String(m.player1_id || '').trim().toLowerCase();
      const p1Name = String(m.player1_name || '').trim().toLowerCase();
      if ((qId && p1Id === qId) || (qName && p1Name && (p1Name === qName || p1Name.replace(/\s+/g, '') === qNameClean))) {
        found = {
          player_id: m.player1_id || playerId,
          full_name: m.player1_name || playerName,
          faction: m.player1_faction || '',
          detachment: m.player1_detachment || '',
          list_id: m.player1_list_id || fallbackListId || '',
          has_list: Boolean(m.player1_list_id || fallbackListId)
        };
        break;
      }
      const p2Id = String(m.player2_id || '').trim().toLowerCase();
      const p2Name = String(m.player2_name || '').trim().toLowerCase();
      if ((qId && p2Id === qId) || (qName && p2Name && (p2Name === qName || p2Name.replace(/\s+/g, '') === qNameClean))) {
        found = {
          player_id: m.player2_id || playerId,
          full_name: m.player2_name || playerName,
          faction: m.player2_faction || '',
          detachment: m.player2_detachment || '',
          list_id: m.player2_list_id || fallbackListId || '',
          has_list: Boolean(m.player2_list_id || fallbackListId)
        };
        break;
      }
    }
  }

  if (typeof currentEventRegistration !== 'undefined' && currentEventRegistration && currentEventRegistration.is_registered) {
    const preg = currentEventRegistration.player_registration || currentEventRegistration.player || {};
    const pregIds = [preg.player_id, preg.bcp_player_id, preg.id, preg.user_id]
      .filter(Boolean)
      .map(x => String(x).trim().toLowerCase());
    const pregName = String(preg.full_name || `${preg.first_name || ''} ${preg.last_name || ''}`).trim().toLowerCase();
    const isMe = (qId && pregIds.includes(qId)) || (qName && pregName && (pregName === qName || pregName.replace(/\s+/g, '') === qNameClean));
    if (isMe) {
      found = Object.assign({}, preg, found || {}, {
        player_id: (found && (found.player_id || found.id)) || preg.player_id || preg.bcp_player_id || playerId,
        full_name: (found && (found.full_name || found.name)) || preg.full_name || `${preg.first_name || ''} ${preg.last_name || ''}`.trim() || playerName,
        army_list: (found && found.army_list) || preg.army_list || '',
        list_id: (found && (found.list_id || found.listId)) || preg.list_id || preg.listId || fallbackListId || '',
        has_list: Boolean((found && hasPlayerSubmittedList(found)) || hasPlayerSubmittedList(preg) || preg.has_list_submitted || fallbackListId)
      });
    }
  }

  let matchFallbackListId = fallbackListId;
  if (!matchFallbackListId && found && !found.list_id && !found.listId && Array.isArray(eventMatchesCache)) {
    const fId = String(found.player_id || found.id || '').trim().toLowerCase();
    const fName = String(found.full_name || found.name || '').trim().toLowerCase();
    for (const m of eventMatchesCache) {
      if (!m) continue;
      if ((fId && String(m.player1_id || '').trim().toLowerCase() === fId) || (fName && String(m.player1_name || '').trim().toLowerCase() === fName)) {
        if (m.player1_list_id) { matchFallbackListId = m.player1_list_id; break; }
      }
      if ((fId && String(m.player2_id || '').trim().toLowerCase() === fId) || (fName && String(m.player2_name || '').trim().toLowerCase() === fName)) {
        if (m.player2_list_id) { matchFallbackListId = m.player2_list_id; break; }
      }
    }
  }

  const record = found
    ? (matchFallbackListId && !found.list_id && !found.listId ? Object.assign({}, found, { list_id: matchFallbackListId }) : found)
    : {
        player_id: String(playerId || '').trim(),
        full_name: String(playerName || 'Competitor').trim(),
        list_id: String(matchFallbackListId || '').trim()
      };
  const pid = String(record.player_id || record.id || playerId || '').trim().replace(/'/g, "\\'");
  const name = String(record.full_name || record.name || playerName || 'Competitor').trim().replace(/'/g, "\\'");
  const listId = String(matchFallbackListId || record.list_id || record.listId || '').trim().replace(/'/g, "\\'");
  const hasList = Boolean(hasPlayerSubmittedList(record) || listId);
  return { record, pid, name, listId, hasList };
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
  const myInfo = resolveEventCompetitorRecord(
    preg.player_id || preg.bcp_player_id || '',
    preg.full_name || `${preg.first_name || ''} ${preg.last_name || ''}`.trim(),
    preg.list_id || preg.listId || ''
  );

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
    const oppIdRaw = isP1 ? (m.player2_id || '') : (m.player1_id || '');
    const oppListIdRaw = isP1 ? (m.player2_list_id || '') : (m.player1_list_id || '');
    const oppFac = isP1 ? (m.player2_faction || '') : (m.player1_faction || '');
    const isBye = Boolean(m.is_bye || oppName === 'BYE' || !oppIdRaw);
    const oppInfo = !isBye ? resolveEventCompetitorRecord(oppIdRaw, oppName, oppListIdRaw) : null;

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

    const actionBtns = [];
    if (!isBye && oppInfo && oppInfo.hasList) {
      actionBtns.push(`<button type="button" class="btn-sm btn-outline" style="font-size:0.72rem; padding:0.2rem 0.55rem; display:inline-flex; align-items:center; gap:0.3rem; cursor:pointer; color:#38bdf8; border-color:rgba(56,189,248,0.4); background:rgba(56,189,248,0.1); font-weight:600;" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(oppInfo.pid || oppInfo.name)}', '${escapeHtml(oppInfo.listId)}')" title="View ${escapeHtml(oppName)}'s Army Roster">📋 Roster</button>`);
    }
    if (!hasScore) {
      actionBtns.push(`<button type="button" class="btn-sm" style="font-size:0.72rem; padding:0.2rem 0.55rem; background:#0284c7; color:#fff; border:1px solid #38bdf8; border-radius:6px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:0.3rem;" onclick="launchTournamentTracker('${safeEventId}', ${roundNum}, ${tableNum}, '${escapeHtml(safeP1Name)}', '${escapeHtml(safeP2Name)}', '${escapeHtml(safeP1Id)}', '${escapeHtml(safeP2Id)}', '${escapeHtml(safePairingId)}')" title="Create / Open Live Game Tracker Room">🎲 Track / Room</button>`);
    } else {
      actionBtns.push(`<button type="button" class="btn-sm btn-outline" style="font-size:0.72rem; padding:0.2rem 0.5rem; display:inline-flex; align-items:center; gap:0.3rem; cursor:pointer;" onclick="openScorecardModal('${matchId}')" title="View Turn-by-Turn Digital Scorecard">📄 Scorecard</button>`);
    }

    const oppNameHtml = !isBye && oppInfo
      ? `<span class="player-link scorecard-opp-name" style="color:#38bdf8; font-weight:700; cursor:pointer;" onclick="event.stopPropagation(); openPlayerModal('${escapeHtml(oppInfo.pid)}', '${escapeHtml(oppInfo.name)}');" title="View ${escapeHtml(oppName)}'s Player Quick Profile">${escapeHtml(oppName)}</span>`
      : `<span class="scorecard-opp-name" style="color:var(--text-muted); font-weight:600;">${escapeHtml(oppName)}</span>`;

    return `
      <tr>
        <td style="font-family:var(--font-mono); font-weight:700;">R${roundNum}</td>
        <td style="font-family:var(--font-mono); color:var(--text-muted);">T${tableNum}</td>
        <td class="scorecard-opp-cell" style="font-weight:600; color:#fff;">
          <div class="scorecard-opp-wrap">
            ${oppNameHtml}
            ${oppFac ? `<span class="badge scorecard-opp-fac" style="font-size:0.68rem;">${escapeHtml(oppFac)}</span>` : ''}
          </div>
        </td>
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
  const myDisplayName = (myInfo && myInfo.record && myInfo.record.full_name) || (myInfo && myInfo.name) || 'My Profile';

  container.innerHTML = `
    <div class="card personal-scorecard-card" style="background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 10px; padding: 1.15rem;">
      <div class="personal-scorecard-header">
        <div class="personal-scorecard-title-row">
          <h4 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: #fff;">⚔️ Your Personal Event Scorecard</h4>
          <span class="badge personal-scorecard-net-elo" style="font-family:var(--font-mono); font-size:0.78rem; font-weight:700; color:${netColor}; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15);">Event Net Elo: ${netStr}</span>
        </div>
        <div class="personal-scorecard-player-bar">
          <span class="player-link personal-scorecard-player-chip" onclick="event.stopPropagation(); openPlayerModal('${escapeHtml(myInfo.pid)}', '${escapeHtml(myInfo.name)}');" title="View Your Player Quick Profile">👤 ${escapeHtml(myDisplayName)}</span>
          ${myInfo.hasList ? `
            <button type="button" class="btn-xs btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(myInfo.pid || myInfo.name)}', '${escapeHtml(myInfo.listId)}')" style="font-size:0.72rem; padding:3px 9px; border-radius:6px; color:#38bdf8; border:1px solid rgba(56,189,248,0.4); background:rgba(56,189,248,0.1); cursor:pointer; font-weight:600; display:inline-flex; align-items:center; gap:4px;" title="View Your Submitted Army Roster">
              📋 My Roster
            </button>
          ` : ''}
        </div>
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

async function renderPlayerStation(ev, userRegData) {
  const subtabPlayer = document.getElementById('event-subtab-player');
  const subtabLabel = document.getElementById('event-subtab-player-label');
  const subtabBadge = document.getElementById('event-tab-player-badge');
  const activeHero = document.getElementById('player-station-active-match-hero');
  const waitingHero = document.getElementById('player-station-waiting-hero');
  const concludedHero = document.getElementById('player-station-concluded-hero');
  const rosterAccordion = document.getElementById('player-station-roster-accordion');
  const accordionHint = document.getElementById('player-station-roster-accordion-hint');

  // Fallback check for competitor persona
  if (!userRegData || !userRegData.is_registered) {
    if (typeof currentDevPersona !== 'undefined' && currentDevPersona === 'competitor') {
      userRegData = {
        is_registered: true,
        player_registration: {
          player_id: "p_innes",
          bcp_player_id: "p_innes",
          first_name: "Innes",
          last_name: "Wilson",
          full_name: "Innes Wilson",
          team_name: "Stat Check",
          faction: "Adeptus Custodes",
          detachment: "Shield Host",
          checked_in: true,
          dropped: false,
          has_list_submitted: true,
          army_list: "++ Adeptus Custodes - Shield Host [2,000 pts] ++\nTrajann Valoris [145 pts]\nBlade Champion [125 pts]\n4x Custodian Guard [180 pts]\nCaladius Grav-tank [215 pts]"
        },
        user_profile: {
          first_name: "Innes",
          last_name: "Wilson",
          display_name: "Innes Wilson"
        }
      };
      currentEventRegistration = userRegData;
    }
  }

  // If user is not registered in this tournament
  if (!userRegData || !userRegData.is_registered) {
    if (subtabPlayer) subtabPlayer.style.setProperty('display', 'none', 'important');
    if (activeHero) activeHero.style.display = 'none';
    if (waitingHero) waitingHero.style.display = 'none';
    if (concludedHero) concludedHero.style.display = 'none';
    return;
  }

  // Show player station tab button
  if (subtabPlayer) {
    subtabPlayer.style.setProperty('display', 'inline-flex', 'important');
  }

  const ended = Boolean(
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

  const eventId = (ev && ev.id) || currentOpenEventId || (currentEventData && currentEventData.id) || '';
  const preg = userRegData.player_registration || userRegData.player || {};
  const myPid = String(preg.player_id || preg.bcp_player_id || '').trim().toLowerCase();
  const myName = String(preg.full_name || `${preg.first_name || ''} ${preg.last_name || ''}`).trim().toLowerCase();
  const myInfo = resolveEventCompetitorRecord(
    preg.player_id || preg.bcp_player_id || '',
    preg.full_name || `${preg.first_name || ''} ${preg.last_name || ''}`.trim(),
    preg.list_id || preg.listId || ''
  );

  // Find all matches involving this competitor
  const myMatches = (eventMatchesCache || []).filter(m => {
    const p1Id = String(m.player1_id || '').trim().toLowerCase();
    const p2Id = String(m.player2_id || '').trim().toLowerCase();
    const p1Name = String(m.player1_name || '').trim().toLowerCase();
    const p2Name = String(m.player2_name || '').trim().toLowerCase();
    if (myPid && (p1Id === myPid || p2Id === myPid)) return true;
    if (myName && (p1Name === myName || p2Name === myName)) return true;
    return false;
  }).sort((a, b) => (a.round || 1) - (b.round || 1));

  // Find currently active match in current round
  const activeMatch = myMatches.find(m => {
    return (m.player1_score === null || m.player2_score === null) && m.status !== 'finished';
  });

  const completedMatches = myMatches.filter(m => {
    return m.player1_score !== null && m.player2_score !== null;
  });

  // 1. Update Subtab Label & Badges based on Lifecycle
  if (ended) {
    if (subtabLabel) subtabLabel.innerText = '🏆 My Results';
    if (subtabBadge) {
      subtabBadge.style.display = 'inline-block';
      subtabBadge.innerText = 'FINAL';
      subtabBadge.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
      subtabBadge.style.color = '#000';
    }
  } else if (activeMatch || (eventMatchesCache && eventMatchesCache.length > 0)) {
    if (subtabLabel) subtabLabel.innerText = '⚔️ Player Station';
    if (subtabBadge) {
      subtabBadge.style.display = 'inline-block';
      subtabBadge.innerText = activeMatch ? 'ACTIVE' : 'ROUND WAITING';
      subtabBadge.style.background = activeMatch ? '#10b981' : '#f59e0b';
      subtabBadge.style.color = '#000';
    }
  } else {
    // Pre-event
    if (subtabLabel) subtabLabel.innerText = '📋 My Registration';
    if (subtabBadge) subtabBadge.style.display = 'none';
  }

  // 2. Render Lifecycle Hero
  if (ended) {
    // STATE: CONCLUDED
    if (activeHero) activeHero.style.display = 'none';
    if (waitingHero) waitingHero.style.display = 'none';
    if (concludedHero) {
      concludedHero.style.display = 'block';
      const myPlayerRecord = (eventPlayersCache || []).find(p => {
        const pPid = String(p.player_id || p.bcp_player_id || '').toLowerCase();
        const pName = String(p.full_name || `${p.first_name || ''} ${p.last_name || ''}`).toLowerCase();
        return (myPid && pPid === myPid) || (myName && pName === myName);
      });
      const placement = myPlayerRecord?.placement || 1;
      const wins = myPlayerRecord?.event_wins !== undefined ? myPlayerRecord.event_wins : completedMatches.filter(m => {
        const isP1 = (myPid && String(m.player1_id).toLowerCase() === myPid) || (myName && String(m.player1_name).toLowerCase() === myName);
        return isP1 ? m._is_p1_win : m._is_p2_win;
      }).length;
      const losses = myPlayerRecord?.event_losses !== undefined ? myPlayerRecord.event_losses : (completedMatches.length - wins);
      const totalBattlePts = myPlayerRecord?.event_battle_points !== undefined ? myPlayerRecord.event_battle_points : completedMatches.reduce((acc, m) => {
        const isP1 = (myPid && String(m.player1_id).toLowerCase() === myPid) || (myName && String(m.player1_name).toLowerCase() === myName);
        return acc + Number(isP1 ? m.player1_score : m.player2_score);
      }, 0);
      const netElo = myPlayerRecord?.event_net_elo || 0;
      const netEloStr = Number(netElo) >= 0 ? `+${Number(netElo).toFixed(1)}` : Number(netElo).toFixed(1);

      concludedHero.innerHTML = `
        <div class="card" style="background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(16, 185, 129, 0.2)); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 12px; padding: 1.25rem;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 0.75rem; flex-wrap:wrap; gap:0.5rem;">
            <div style="display:flex; align-items:flex-start; gap:0.6rem; min-width:0; flex:1;">
              <span style="font-size: 1.3rem; flex-shrink:0; line-height:1.2;">🏆</span>
              <div style="min-width:0; flex:1;">
                <h3 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: #fff; line-height: 1.3;">Tournament Concluded • Final Performance</h3>
                <div class="concluded-hero-sub" style="font-size: 0.78rem; color: #94a3b8; margin-top: 0.2rem; display: flex; align-items: center; flex-wrap: wrap; gap: 0.35rem;">
                  <span class="player-link" style="color:#38bdf8; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:0.25rem;" onclick="event.stopPropagation(); openPlayerModal('${escapeHtml(myInfo.pid)}', '${escapeHtml(myInfo.name)}');" title="View Your Player Quick Profile">👤 ${escapeHtml(myInfo.record.full_name || 'Your Profile')}</span>
                  <span>• Official results recorded on Best Coast Pairings</span>
                </div>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
              ${myInfo.hasList ? `
                <button type="button" class="btn-sm btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(myInfo.pid || myInfo.name)}', '${escapeHtml(myInfo.listId)}')" style="font-size:0.75rem; font-weight:700; padding:4px 10px; color:#38bdf8; border-color:rgba(56,189,248,0.4); background:rgba(56,189,248,0.1); cursor:pointer;">
                  📋 My Roster
                </button>
              ` : ''}
              <span class="badge" style="font-size: 0.82rem; font-weight: 800; background: #10b981; color: #000; padding: 3px 10px;">FINISHER</span>
            </div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.75rem; margin-top: 1rem;">
            <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 0.65rem; text-align: center;">
              <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">FINAL PLACEMENT</div>
              <div style="font-size: 1.25rem; font-weight: 800; color: #38bdf8;">#${placement} <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal;">of ${(eventPlayersCache || []).length}</span></div>
            </div>
            <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 0.65rem; text-align: center;">
              <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">MATCH RECORD</div>
              <div style="font-size: 1.25rem; font-weight: 800; color: #4ade80;">${wins}-${losses}-0</div>
            </div>
            <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 0.65rem; text-align: center;">
              <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">BATTLE POINTS</div>
              <div style="font-size: 1.25rem; font-weight: 800; color: #facc15;">${totalBattlePts} pts</div>
            </div>
            <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 0.65rem; text-align: center;">
              <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">NET ELO IMPACT</div>
              <div style="font-size: 1.25rem; font-weight: 800; color: ${Number(netElo) >= 0 ? '#4ade80' : '#f87171'};">${netEloStr}</div>
            </div>
          </div>
        </div>
      `;
    }
    if (rosterAccordion) {
      rosterAccordion.open = false;
      if (accordionHint) accordionHint.innerText = '(Tournament Ended • Click to inspect roster)';
    }
  } else if (activeMatch) {
    // STATE: ACTIVE ROUND MATCH IN PROGRESS!
    if (concludedHero) concludedHero.style.display = 'none';
    if (waitingHero) waitingHero.style.display = 'none';
    if (activeHero) {
      activeHero.style.display = 'block';

      const roundNum = activeMatch.round || 1;
      const tableNum = activeMatch.table_number || activeMatch.table || 1;
      const isP1 = (myPid && String(activeMatch.player1_id).toLowerCase() === myPid) || (myName && String(activeMatch.player1_name).toLowerCase() === myName);
      const myNameClean = isP1 ? (activeMatch.player1_name || 'You') : (activeMatch.player2_name || 'You');
      const oppNameClean = isP1 ? (activeMatch.player2_name || 'Opponent') : (activeMatch.player1_name || 'Opponent');
      const oppIdRaw = isP1 ? (activeMatch.player2_id || '') : (activeMatch.player1_id || '');
      const oppListIdRaw = isP1 ? (activeMatch.player2_list_id || '') : (activeMatch.player1_list_id || '');
      const isBye = Boolean(activeMatch.is_bye || oppNameClean === 'BYE' || !oppIdRaw);
      const oppInfo = !isBye ? resolveEventCompetitorRecord(oppIdRaw, oppNameClean, oppListIdRaw) : null;

      const myFaction = isP1 ? (activeMatch.player1_faction || preg.faction || '') : (activeMatch.player2_faction || '');
      const oppFaction = isP1 ? (activeMatch.player2_faction || '') : (activeMatch.player1_faction || '');
      const myProb = isP1 ? (activeMatch._p1_win_prob || 50) : (activeMatch._p2_win_prob || 50);
      const oppProb = isP1 ? (activeMatch._p2_win_prob || 50) : (activeMatch._p1_win_prob || 50);

      const matchStream = (typeof eventLiveStreams !== 'undefined')
        ? eventLiveStreams.find(s => Number(s.tableNumber) === Number(tableNum))
        : null;

      const safeEventId = String(eventId).replace(/'/g, "\\'");
      const safeP1Name = String(activeMatch.player1_name || 'Player 1').replace(/'/g, "\\'");
      const safeP2Name = String(activeMatch.player2_name || 'Player 2').replace(/'/g, "\\'");
      const safeP1Id = String(activeMatch.player1_id || '').replace(/'/g, "\\'");
      const safeP2Id = String(activeMatch.player2_id || '').replace(/'/g, "\\'");
      const safePairingId = String(activeMatch.id || activeMatch.pairing_id || activeMatch.bcp_pairing_id || '').replace(/'/g, "\\'");
      const matchId = `BCP-${eventId}-R${roundNum}-T${tableNum}`;

      activeHero.innerHTML = `
        <div class="card" style="background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 58, 138, 0.45)); border: 1.5px solid rgba(56, 189, 248, 0.45); box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5); border-radius: 12px; padding: 1.25rem;">
          <!-- Top Row Header -->
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 1rem; flex-wrap:wrap; gap:0.5rem;">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#10b981; box-shadow:0 0 10px #10b981;"></span>
              <span style="font-size:0.85rem; font-weight:800; color:#38bdf8; letter-spacing:0.04em;">
                ⚡ ACTIVE ROUND ${roundNum} MATCH • TABLE ${tableNum}
              </span>
            </div>
            <div style="display:flex; align-items:center; gap:0.4rem;">
              ${matchStream ? `
                <button type="button" class="btn-sm" onclick="openEventStreamModal(${tableNum})" style="font-size:0.75rem; font-weight:700; padding:3px 9px; background:rgba(239,68,68,0.2); border:1px solid #ef4444; color:#fca5a5; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:0.35rem;">
                  <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#ef4444; box-shadow:0 0 6px #ef4444;"></span>
                  🔴 Featured on ${escapeHtml(matchStream.channel)}
                </button>
              ` : ''}
              <span class="badge" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); font-size:0.72rem; color:#cbd5e1; white-space:nowrap;">IN PROGRESS</span>
            </div>
          </div>

          <!-- Matchup Grid -->
          <div class="player-station-matchup-grid" style="display:grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 0.75rem; align-items:center; margin-bottom: 1.25rem; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding: 1rem;">
            <!-- My Side -->
            <div class="player-station-matchup-side player-station-my-side" style="text-align:left; min-width:0;">
              <div style="font-size:0.72rem; color:#38bdf8; font-weight:700; text-transform:uppercase;">YOU</div>
              <div class="player-station-matchup-name" style="font-size:1.05rem; font-weight:800; color:#fff; margin-top:2px; overflow-wrap:break-word; word-break:break-word; line-height:1.25;">
                <span class="player-link" style="color:#38bdf8; cursor:pointer;" onclick="event.stopPropagation(); openPlayerModal('${escapeHtml(myInfo.pid)}', '${escapeHtml(myInfo.name)}');" title="View Your Player Quick Profile">${escapeHtml(myNameClean)}</span>
              </div>
              <div class="player-station-my-badges" style="display:flex; align-items:center; flex-wrap:wrap; gap:5px; margin-top:5px;">
                ${myFaction ? `<span class="badge" style="background:rgba(56,189,248,0.1); border:1px solid rgba(56,189,248,0.25); color:#7dd3fc; font-size:0.7rem; max-width:100%; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(myFaction)}</span>` : ''}
                ${myInfo.hasList ? `<button type="button" class="btn-xs btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(myInfo.pid || myInfo.name)}', '${escapeHtml(myInfo.listId)}')" style="font-size:0.7rem; padding:2px 7px; border-radius:4px; color:#38bdf8; border:1px solid rgba(56,189,248,0.4); background:rgba(56,189,248,0.1); cursor:pointer; font-weight:600; white-space:nowrap;" title="View Your Army Roster">📋 My Roster</button>` : ''}
              </div>
              <div style="margin-top:5px; font-size:0.72rem; font-family:var(--font-mono); color:#38bdf8; font-weight:700;">${myProb}% Win Prob</div>
            </div>

            <!-- VS Badge -->
            <div class="player-station-matchup-vs" style="text-align:center; flex-shrink:0;">
              <div style="font-size:0.8rem; font-weight:900; color:var(--text-muted); background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:50%; width:34px; height:34px; display:flex; align-items:center; justify-content:center; margin:0 auto;">VS</div>
              <div style="font-size:0.68rem; font-family:var(--font-mono); color:var(--text-muted); margin-top:4px;">T${tableNum}</div>
            </div>

            <!-- Opponent Side -->
            <div class="player-station-matchup-side player-station-opp-side" style="text-align:right; min-width:0;">
              <div style="font-size:0.72rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">OPPONENT</div>
              <div class="player-station-matchup-name" style="font-size:1.05rem; font-weight:800; color:#fff; margin-top:2px; overflow-wrap:break-word; word-break:break-word; line-height:1.25;">
                ${!isBye && oppInfo
                  ? `<span class="player-link" style="color:#38bdf8; cursor:pointer;" onclick="event.stopPropagation(); openPlayerModal('${escapeHtml(oppInfo.pid)}', '${escapeHtml(oppInfo.name)}');" title="View ${escapeHtml(oppNameClean)}'s Player Quick Profile">${escapeHtml(oppNameClean)}</span>`
                  : `<span>${escapeHtml(oppNameClean)}</span>`
                }
              </div>
              <div class="player-station-opp-badges" style="display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:5px; margin-top:5px;">
                ${oppFaction ? `<span class="badge" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15); color:#cbd5e1; font-size:0.7rem; max-width:100%; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(oppFaction)}</span>` : ''}
                ${(!isBye && oppInfo && oppInfo.hasList) ? `<button type="button" class="btn-xs btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(oppInfo.pid || oppInfo.name)}', '${escapeHtml(oppInfo.listId)}')" style="font-size:0.7rem; padding:2px 7px; border-radius:4px; color:#38bdf8; border:1px solid rgba(56,189,248,0.4); background:rgba(56,189,248,0.1); cursor:pointer; font-weight:600; white-space:nowrap;" title="View ${escapeHtml(oppNameClean)}'s Army Roster">📋 Opponent Roster</button>` : ''}
              </div>
              <div style="margin-top:5px; font-size:0.72rem; font-family:var(--font-mono); color:var(--text-muted); font-weight:700;">${oppProb}% Win Prob</div>
            </div>
          </div>

          <!-- Action Buttons Bar -->
          <div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:center;">
            <button type="button" class="btn btn-primary" onclick="launchTournamentTracker('${safeEventId}', ${roundNum}, ${tableNum}, '${escapeHtml(safeP1Name)}', '${escapeHtml(safeP2Name)}', '${escapeHtml(safeP1Id)}', '${escapeHtml(safeP2Id)}', '${escapeHtml(safePairingId)}')" style="flex:1; min-width:180px; font-size:0.88rem; font-weight:800; padding:0.65rem 1.25rem; background:linear-gradient(135deg, #0284c7, #2563eb); border:1px solid #38bdf8; box-shadow:0 0 15px rgba(56,189,248,0.3); color:#fff; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:0.45rem; border-radius:8px;">
              🎲 Track Live Game (Room)
            </button>
            ${(!isBye && oppInfo && oppInfo.hasList) ? `
              <button type="button" class="btn btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(oppInfo.pid || oppInfo.name)}', '${escapeHtml(oppInfo.listId)}')" style="font-size:0.82rem; font-weight:700; padding:0.65rem 1rem; color:#38bdf8; border-color:rgba(56,189,248,0.4); background:rgba(56,189,248,0.1); cursor:pointer; display:inline-flex; align-items:center; gap:0.35rem; border-radius:8px;">
                📋 Opponent Roster
              </button>
            ` : ''}
            <a href="https://web.bestcoastpairings.com/event.php?eventId=${encodeURIComponent(eventId)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="font-size:0.82rem; font-weight:700; padding:0.65rem 1.1rem; color:#38bdf8; border-color:rgba(56,189,248,0.4); background:rgba(56,189,248,0.08); text-decoration:none; display:inline-flex; align-items:center; gap:0.4rem; border-radius:8px;">
              📱 Submit on BCP ↗
            </a>
            <button type="button" class="btn btn-outline" onclick="openScorecardModal('${matchId}')" style="font-size:0.82rem; font-weight:600; padding:0.65rem 1rem; color:#cbd5e1; border-color:rgba(255,255,255,0.15); background:rgba(255,255,255,0.04); cursor:pointer; display:inline-flex; align-items:center; gap:0.35rem; border-radius:8px;">
              📄 View Scorecard
            </button>
          </div>
        </div>
      `;
    }
    if (rosterAccordion) {
      rosterAccordion.open = false;
      if (accordionHint) accordionHint.innerText = '(Live Match in Progress • Click to inspect roster)';
    }
  } else if (completedMatches.length > 0) {
    // STATE: WAITING BETWEEN ROUNDS
    if (concludedHero) concludedHero.style.display = 'none';
    if (activeHero) activeHero.style.display = 'none';
    if (waitingHero) {
      waitingHero.style.display = 'block';
      const lastMatch = completedMatches[completedMatches.length - 1];
      const lastRound = lastMatch.round || 1;
      const isP1 = (myPid && String(lastMatch.player1_id).toLowerCase() === myPid) || (myName && String(lastMatch.player1_name).toLowerCase() === myName);
      const isWin = Boolean(isP1 ? lastMatch._is_p1_win : lastMatch._is_p2_win);
      const myScore = isP1 ? lastMatch.player1_score : lastMatch.player2_score;
      const oppScore = isP1 ? lastMatch.player2_score : lastMatch.player1_score;
      const oppName = isP1 ? (lastMatch.player2_name || 'Opponent') : (lastMatch.player1_name || 'Opponent');
      const oppIdRaw = isP1 ? (lastMatch.player2_id || '') : (lastMatch.player1_id || '');
      const oppListIdRaw = isP1 ? (lastMatch.player2_list_id || '') : (lastMatch.player1_list_id || '');
      const isBye = Boolean(lastMatch.is_bye || oppName === 'BYE' || !oppIdRaw);
      const lastOppInfo = !isBye ? resolveEventCompetitorRecord(oppIdRaw, oppName, oppListIdRaw) : null;
      const safeEvId = String(eventId).replace(/'/g, "\\'");

      const oppNameLink = !isBye && lastOppInfo
        ? `<span class="player-link" style="color:#38bdf8; font-weight:700; cursor:pointer;" onclick="event.stopPropagation(); openPlayerModal('${escapeHtml(lastOppInfo.pid)}', '${escapeHtml(lastOppInfo.name)}');" title="View ${escapeHtml(oppName)}'s Player Quick Profile">${escapeHtml(oppName)}</span>`
        : `<strong>${escapeHtml(oppName)}</strong>`;

      waitingHero.innerHTML = `
        <div class="card" style="background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(245, 158, 11, 0.15)); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 12px; padding: 1.25rem;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 0.6rem; flex-wrap:wrap; gap:0.5rem;">
            <div style="display:flex; align-items:center; gap:0.45rem;">
              <span style="font-size:1.2rem;">⏳</span>
              <h3 style="margin:0; font-size:1rem; font-weight:800; color:#fbbf24;">
                Round ${lastRound} Completed • Waiting for Next Round Pairings
              </h3>
            </div>
            <span class="badge" style="background:rgba(245,158,11,0.2); border:1px solid rgba(245,158,11,0.4); color:#fbbf24; font-size:0.75rem;">STANDBY</span>
          </div>
          <p style="font-size:0.82rem; color:#cbd5e1; margin:0 0 0.85rem 0; line-height:1.45;">
            You finished Round ${lastRound} against ${oppNameLink} with a score of <strong>${myScore} - ${oppScore}</strong> (${isWin ? '<span style="color:#4ade80; font-weight:700;">WIN</span>' : '<span style="color:#f87171; font-weight:700;">LOSS</span>'}). The Tournament Organizer is currently finalizing all remaining tables before drawing Round ${lastRound + 1}.
          </p>
          <div style="display:flex; gap:0.6rem; flex-wrap:wrap;">
            <button type="button" class="btn btn-outline" onclick="openEventHubPage('${safeEvId}', typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k', { initialTab: 'player', forceSync: true })" style="font-size:0.78rem; font-weight:700; padding:0.45rem 0.9rem; color:#38bdf8; border-color:rgba(56,189,248,0.4); background:rgba(56,189,248,0.08); cursor:pointer; display:inline-flex; align-items:center; gap:0.35rem;">
              🔄 Refresh Round Status
            </button>
            ${(!isBye && lastOppInfo && lastOppInfo.hasList) ? `
              <button type="button" class="btn btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(lastOppInfo.pid || lastOppInfo.name)}', '${escapeHtml(lastOppInfo.listId)}')" style="font-size:0.78rem; font-weight:700; padding:0.45rem 0.9rem; color:#38bdf8; border-color:rgba(56,189,248,0.4); background:rgba(56,189,248,0.08); cursor:pointer; display:inline-flex; align-items:center; gap:0.35rem;">
                📋 ${escapeHtml(oppName)}'s Roster
              </button>
            ` : ''}
            ${myInfo.hasList ? `
              <button type="button" class="btn btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(myInfo.pid || myInfo.name)}', '${escapeHtml(myInfo.listId)}')" style="font-size:0.78rem; font-weight:700; padding:0.45rem 0.9rem; color:#38bdf8; border-color:rgba(56,189,248,0.4); background:rgba(56,189,248,0.08); cursor:pointer; display:inline-flex; align-items:center; gap:0.35rem;">
                📋 My Roster
              </button>
            ` : ''}
            <button type="button" class="btn btn-outline" onclick="switchEventModalTab('matches')" style="font-size:0.78rem; font-weight:600; padding:0.45rem 0.9rem; color:#cbd5e1; border-color:rgba(255,255,255,0.15); background:rgba(255,255,255,0.04); cursor:pointer;">
              ⚔️ Browse Other Table Scores
            </button>
          </div>
        </div>
      `;
    }
    if (rosterAccordion) {
      rosterAccordion.open = false;
      if (accordionHint) accordionHint.innerText = '(Between Rounds • Click to inspect roster)';
    }
  } else {
    // STATE: PRE-EVENT
    if (concludedHero) concludedHero.style.display = 'none';
    if (activeHero) activeHero.style.display = 'none';
    if (waitingHero) waitingHero.style.display = 'none';
    if (rosterAccordion) {
      rosterAccordion.open = true;
      if (accordionHint) accordionHint.innerText = '(Pre-Event • Review & Check In)';
    }
  }

  // 3. Render Personal Scorecard History
  renderPersonalEventScorecard(ev, userRegData);

  // 4. Fill Roster Form
  await populateEventPlayerDetails(userRegData);
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

function openEventPlayerListModal(playerIdentifier, directPlayerObj = null) {
  const fallbackListId = typeof directPlayerObj === 'string' ? directPlayerObj.trim() : '';
  let p = (directPlayerObj && typeof directPlayerObj === 'object')
    ? directPlayerObj
    : (playerIdentifier && typeof playerIdentifier === 'object' ? playerIdentifier : null);
  if (!p) {
    const resolved = resolveEventCompetitorRecord(playerIdentifier, playerIdentifier, fallbackListId);
    p = resolved ? resolved.record : null;
  } else if (fallbackListId && !p.list_id && !p.listId) {
    p = Object.assign({}, p, { list_id: fallbackListId });
  }

  currentArmyListModalPlayer = p || { full_name: String(playerIdentifier || ''), player_id: String(playerIdentifier || ''), list_id: fallbackListId };
  currentEventParsedRoster = p?._parsed_roster || null;
  currentEventArmyListText = '';
  window.__currentEventParsePromise = null;

  const modal = document.getElementById('event-army-list-modal');
  if (!modal) return;

  const titleEl = document.getElementById('event-army-list-modal-title');
  const subEl = document.getElementById('event-army-list-modal-subtitle');
  const toggleWrap = document.getElementById('event-army-list-mode-toggle');
  const contentEl = document.getElementById('event-army-list-modal-content');
  const btnProfile = document.getElementById('btn-army-list-view-profile');
  const btnCopy = document.getElementById('btn-army-list-copy');
  const btnBcpLink = document.getElementById('btn-army-list-bcp-link');

  const modalFac = formatEventPlayerFaction(p?.faction || p?.army_name);
  const facSub = (modalFac && modalFac !== '-') ? modalFac : 'Faction Unselected';
  if (titleEl) titleEl.innerText = `${p?.full_name || playerIdentifier || 'Competitor'} — Army Roster`;
  if (subEl) subEl.innerText = `${facSub}${p?.detachment ? ` • ${p.detachment}` : ''}${p?.team ? ` • 🛡️ ${p.team}` : ''}`;

  if (btnProfile) {
    const targetId = p?.player_id || p?.id || '';
    btnProfile.onclick = () => {
      closeEventArmyListModal();
      openPlayerModal(targetId, p?.full_name || '');
    };
  }

  const listInfo = getPlayerListDetails(p);

  // Setup external BCP link button in footer
  let targetUrl = '';
  if (listInfo.url && (listInfo.url.startsWith('http://') || listInfo.url.startsWith('https://'))) {
    targetUrl = listInfo.url;
  } else if (listInfo.listId) {
    targetUrl = `https://www.bestcoastpairings.com/list/${encodeURIComponent(listInfo.listId)}`;
  } else if (p && (p.list_id || p.listId)) {
    targetUrl = `https://www.bestcoastpairings.com/list/${encodeURIComponent(p.list_id || p.listId)}`;
  } else if (p && (p.bcp_url || p.bcpUrl)) {
    targetUrl = p.bcp_url || p.bcpUrl;
  }

  if (btnBcpLink) {
    if (targetUrl) {
      btnBcpLink.href = targetUrl;
      btnBcpLink.style.display = 'inline-flex';
    } else {
      btnBcpLink.style.display = 'none';
    }
  }

  // Open the modal
  modal.style.display = 'flex';
  if (typeof bringModalToFront === 'function') {
    bringModalToFront(modal);
  } else {
    modal.classList.add('active');
  }

  // Handle list content
  if (listInfo.text) {
    currentEventArmyListText = listInfo.text;
    if (toggleWrap) toggleWrap.style.display = 'inline-flex';
    if (btnCopy) btnCopy.style.display = 'inline-flex';
    setEventArmyListViewMode(currentEventArmyListViewMode || 'text');
  } else if (listInfo.listId || listInfo.url) {
    if (toggleWrap) toggleWrap.style.display = 'none';
    if (btnCopy) btnCopy.style.display = 'none';
    if (contentEl) {
      contentEl.innerHTML = `
        <div style="text-align:center; padding:3.5rem 1.5rem; margin:auto;">
          <div class="spinner-mini" style="display:inline-block; width:38px; height:38px; border:3px solid rgba(56,189,248,0.2); border-top-color:#38bdf8; border-radius:50%; animation:spin 0.8s linear infinite; margin-bottom:1rem;"></div>
          <div style="font-size:1.1rem; font-weight:700; color:#38bdf8; margin-bottom:0.35rem;">Fetching Roster from Best Coast Pairings...</div>
          <div style="font-size:0.84rem; color:var(--text-muted);">Connecting to official Best Coast Pairings roster</div>
        </div>
      `;
    }

    const targetListId = listInfo.listId || listInfo.url;
    window.api.getBcpArmyList(targetListId)
      .then(res => {
        if (res && res.success && res.text) {
          const trimmed = res.text.trim();
          if (p) {
            p.army_list = trimmed;
            p.army_list_text = trimmed;
          }
          currentEventArmyListText = trimmed;
          if (toggleWrap) toggleWrap.style.display = 'inline-flex';
          if (btnCopy) btnCopy.style.display = 'inline-flex';
          setEventArmyListViewMode(currentEventArmyListViewMode || 'text');
        } else if (res && (res.requires_bcp_link || res.status === 401 || res.status === 403 || (res.error && (res.error.toLowerCase().includes('subscription') || res.error.toLowerCase().includes('bcp'))))) {
          if (toggleWrap) toggleWrap.style.display = 'none';
          if (btnCopy) btnCopy.style.display = 'none';
          if (contentEl) {
            contentEl.innerHTML = renderBcpLinkRequiredCard(listInfo.url || targetUrl);
          }
        } else {
          if (toggleWrap) toggleWrap.style.display = 'none';
          if (btnCopy) btnCopy.style.display = 'none';
          if (contentEl) {
            contentEl.innerHTML = `
              <div style="text-align:center; padding:3rem 1.5rem; margin:auto; max-width:480px;">
                <div style="font-size:2.5rem; margin-bottom:0.75rem;">📋</div>
                <div style="font-size:1.1rem; font-weight:700; color:#38bdf8; margin-bottom:0.45rem;">Best Coast Pairings Roster</div>
                <div style="font-size:0.85rem; color:var(--text-secondary); line-height:1.5; margin-bottom:1.25rem;">
                  ${escapeHtml(res?.error || 'Full roster text could not be loaded automatically.')}
                </div>
                ${targetUrl ? `
                  <a href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="display:inline-flex; align-items:center; gap:0.5rem; font-weight:700; font-size:0.85rem; padding:0.6rem 1.25rem; text-decoration:none; background:#0284c7; border:1px solid #38bdf8; color:#fff; border-radius:6px;">
                    📄 Open on Best Coast Pairings ↗
                  </a>
                ` : ''}
              </div>
            `;
          }
        }
      })
      .catch(err => {
        if (toggleWrap) toggleWrap.style.display = 'none';
        if (btnCopy) btnCopy.style.display = 'none';
        if (contentEl) {
          contentEl.innerHTML = renderBcpLinkRequiredCard(listInfo.url || targetUrl);
        }
      });
  } else {
    // No roster submitted
    if (toggleWrap) toggleWrap.style.display = 'none';
    if (btnCopy) btnCopy.style.display = 'none';
    if (contentEl) {
      contentEl.innerHTML = `
        <div style="text-align:center; padding:3rem 1.5rem; margin:auto; color:var(--text-muted);">
          <div style="font-size:2.5rem; margin-bottom:0.75rem;">📄</div>
          <div style="font-size:1.05rem; font-weight:700; color:#fff; margin-bottom:0.45rem;">No Roster Submitted</div>
          <div style="font-size:0.84rem; line-height:1.5; max-width:400px; margin:0 auto;">
            No army list text or link has been published on Best Coast Pairings for ${escapeHtml(p?.full_name || 'this competitor')} yet.
          </div>
        </div>
      `;
    }
  }
}

function _renderEventCompetitorPlayMode(contentEl, parsedRoster, fallbackText) {
  if (!contentEl) return;
  let matchedSaved = false;
  // If parsedRoster does not have nr_row yet, check if it matches a saved NewRecruit list by exact ID or identical raw_text
  if (parsedRoster && typeof hubSavedLists !== 'undefined' && Array.isArray(hubSavedLists)) {
    const matchSaved = hubSavedLists.find(l => l.nr_row && (
      (parsedRoster.id && l.id === parsedRoster.id && !String(parsedRoster.id).startsWith('ephemeral')) ||
      (fallbackText && l.raw_text && l.raw_text.trim().length > 20 && l.raw_text.trim() === fallbackText.trim())
    ));
    if (matchSaved) {
      matchedSaved = true;
      parsedRoster = Object.assign({}, parsedRoster, {
        id: matchSaved.id,
        nr_list_key: matchSaved.nr_list_key || matchSaved.list_key,
        nr_row: Object.assign({}, matchSaved.nr_row, { _ephemeral_view: true }),
        source: matchSaved.source || 'newrecruit',
        is_newrecruit_compatible: true
      });
    }
  }
  if (parsedRoster) {
    parsedRoster._ephemeral_view = true;
    if (parsedRoster.nr_row) {
      parsedRoster.nr_row = Object.assign({}, parsedRoster.nr_row, { _ephemeral_view: true });
    }
  }
  const viewOpts = { mode: 'play', ephemeral: true, onViewRawText: "setEventArmyListViewMode('text')" };
  const renderer = window.renderNativeRosterViewer || (typeof renderNativeRosterViewer === 'function' ? renderNativeRosterViewer : null);
  if (renderer && parsedRoster) {
    contentEl.innerHTML = renderer(parsedRoster, viewOpts);
    if (typeof window.attachHubPlayModeIframeLifecycle === 'function') {
      window.attachHubPlayModeIframeLifecycle(parsedRoster, contentEl, viewOpts);
    }
  } else {
    contentEl.innerHTML = `<pre style="padding:1.25rem; color:#e2e8f0; font-family:var(--font-mono); font-size:0.82rem; line-height:1.6; white-space:pre-wrap;">${escapeHtml(fallbackText)}</pre>`;
  }
}

function setEventArmyListViewMode(mode) {
  currentEventArmyListViewMode = mode || 'text';
  const btnText = document.getElementById('btn-army-list-mode-text');
  const btnEnriched = document.getElementById('btn-army-list-mode-enriched');
  const contentEl = document.getElementById('event-army-list-modal-content');
  if (!contentEl) return;

  if (btnText && btnEnriched) {
    if (mode === 'enriched' || mode === 'play') {
      btnEnriched.classList.add('active');
      btnText.classList.remove('active');
    } else {
      btnText.classList.add('active');
      btnEnriched.classList.remove('active');
    }
  }

  if (mode === 'enriched' || mode === 'play') {
    if (currentEventParsedRoster) {
      _renderEventCompetitorPlayMode(contentEl, currentEventParsedRoster, currentEventArmyListText);
    } else {
      // Show loading spinner while parsing into NewRecruit Play Mode
      contentEl.innerHTML = `
        <div style="text-align:center; padding:3.5rem 1.5rem; margin:auto;">
          <div class="spinner-mini" style="display:inline-block; width:38px; height:38px; border:3px solid rgba(56,189,248,0.2); border-top-color:#38bdf8; border-radius:50%; animation:spin 0.8s linear infinite; margin-bottom:1rem;"></div>
          <div style="font-size:1.1rem; font-weight:700; color:#38bdf8; margin-bottom:0.35rem;">🎮 Preparing NewRecruit Play Mode...</div>
          <div style="font-size:0.84rem; color:var(--text-muted);">Loading interactive datasheets, statlines, weapons, abilities & stratagems</div>
        </div>
      `;

      const parseProm = window.__currentEventParsePromise || (window.__currentEventParsePromise = window.api.parseArmyList(currentEventArmyListText));
      parseProm
        .then(res => {
          if (res && res.success && res.army_list) {
            res.army_list._ephemeral_view = true;
            if (res.army_list.nr_row) {
              res.army_list.nr_row._ephemeral_view = true;
              res.army_list.nr_row.synced = 0;
            }
            currentEventParsedRoster = res.army_list;
            if (currentArmyListModalPlayer) {
              currentArmyListModalPlayer._parsed_roster = res.army_list;
            }
            if (currentEventArmyListViewMode === 'enriched' || currentEventArmyListViewMode === 'play') {
              _renderEventCompetitorPlayMode(contentEl, currentEventParsedRoster, currentEventArmyListText);
            }
          } else {
            setEventArmyListViewMode('text');
            if (typeof showToast === 'function') {
              showToast('Could not parse this roster format into Play Mode.', 'info');
            }
          }
        })
        .catch(err => {
          setEventArmyListViewMode('text');
        });
    }
  } else {
    // Raw Text mode (GW Format default + NewRecruit Format toggle)
    const renderer = window.renderNativeRosterViewer || (typeof renderNativeRosterViewer === 'function' ? renderNativeRosterViewer : null);
    if (renderer && currentEventParsedRoster) {
      currentEventParsedRoster._ephemeral_view = true;
      if (currentEventParsedRoster.nr_row) {
        currentEventParsedRoster.nr_row._ephemeral_view = true;
        currentEventParsedRoster.nr_row.synced = 0;
      }
      contentEl.innerHTML = renderer(currentEventParsedRoster, { mode: 'text', ephemeral: true });
      return;
    }
    contentEl.innerHTML = `
      <div style="padding:1.25rem; flex:1; display:flex; flex-direction:column; background:#070b14;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem; flex-wrap:wrap; gap:0.5rem;">
          <div style="font-size:0.84rem; font-weight:800; color:#38bdf8; display:flex; align-items:center; gap:0.4rem;">
            <span>📄</span> Roster Text (GW Format)
          </div>
        </div>
        <pre style="flex:1; margin:0; padding:1.15rem; background:#030712; border:1px solid rgba(255,255,255,0.08); border-radius:10px; font-family:var(--font-mono, monospace); font-size:0.82rem; line-height:1.6; color:#e2e8f0; white-space:pre-wrap; word-break:break-word; max-height:520px; overflow-y:auto;">${escapeHtml(currentEventArmyListText)}</pre>
      </div>
    `;
    if (renderer && currentEventArmyListText && window.api && typeof window.api.parseArmyList === 'function') {
      const parseProm = window.__currentEventParsePromise || (window.__currentEventParsePromise = window.api.parseArmyList(currentEventArmyListText));
      parseProm.then(res => {
        if (res && res.success && res.army_list) {
          res.army_list._ephemeral_view = true;
          if (res.army_list.nr_row) {
            res.army_list.nr_row._ephemeral_view = true;
            res.army_list.nr_row.synced = 0;
          }
          currentEventParsedRoster = res.army_list;
          if (currentArmyListModalPlayer) {
            currentArmyListModalPlayer._parsed_roster = res.army_list;
          }
          if (currentEventArmyListViewMode === 'text' && document.getElementById('event-army-list-modal-content') === contentEl) {
            contentEl.innerHTML = renderer(currentEventParsedRoster, { mode: 'text', ephemeral: true });
          }
        }
      }).catch(() => {});
    }
  }
}

function closeEventArmyListModal() {
  const contentEl = document.getElementById('event-army-list-modal-content');
  if (contentEl) contentEl.innerHTML = '';
  if (typeof closeModal === 'function') {
    closeModal('event-army-list-modal');
  } else {
    const m = document.getElementById('event-army-list-modal');
    if (m) m.style.display = 'none';
  }
}
window.openEventPlayerListModal = openEventPlayerListModal;
window.openEventArmyListModal = openEventPlayerListModal;
window.closeEventArmyListModal = closeEventArmyListModal;
window.setEventArmyListViewMode = setEventArmyListViewMode;

function copyEventArmyListModalText() {
  const text = currentEventArmyListText || document.getElementById('event-army-list-modal-content')?.innerText || '';
  if (!text) return;
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

window.copyEventArmyListModalText = copyEventArmyListModalText;

/* ==========================================================================
   CREATOR HUB (CC & ADMIN) - PRODUCER, CASTER & LIVESTREAM STUDIO
   ========================================================================== */

let creatorHubActiveMode = 'caster'; // 'caster' | 'stream' | 'storylines' | 'meta' | 'export'
let selectedCasterRound = null;
let selectedCasterTable = 1;
let creatorActiveStreamIndex = 0;

function normalizeStreamRecord(s) {
  if (!s) return s;
  const rawTable = (s.table_number !== undefined && s.table_number !== null)
    ? s.table_number
    : ((s.tableNumber !== undefined && s.tableNumber !== null) ? s.tableNumber : 1);
  const tNum = Number(rawTable);
  const defaultTitle = tNum === 0
    ? `${s.channel || 'Live'} - Main Desk Coverage`
    : `${s.channel || 'Live'} - Table ${tNum} Coverage`;
  return {
    ...s,
    id: s.id || `stream-${Date.now()}`,
    tableNumber: tNum,
    table_number: tNum,
    streamUrl: s.stream_url || s.streamUrl || '',
    stream_url: s.stream_url || s.streamUrl || '',
    embedUrl: s.embed_url || s.embedUrl || '',
    embed_url: s.embed_url || s.embedUrl || '',
    isLive: s.is_live !== undefined ? Boolean(s.is_live) : (s.isLive !== undefined ? Boolean(s.isLive) : true),
    is_live: s.is_live !== undefined ? Boolean(s.is_live) : (s.isLive !== undefined ? Boolean(s.isLive) : true),
    channel: s.channel || 'Broadcaster',
    title: s.title || defaultTitle,
    platform: s.platform || 'youtube',
    viewers: s.viewers || 100
  };
}

let eventLiveStreams = [];
window.eventLiveStreams = eventLiveStreams;

async function loadEventLivestreams(eventId) {
  const targetId = eventId || currentOpenEventId || currentEventData?.id || '';
  if (!targetId) return eventLiveStreams;
  try {
    if (window.api && typeof window.api.getEventLivestreams === 'function') {
      const res = await window.api.getEventLivestreams(targetId);
      const rawStreams = Array.isArray(res) ? res : (res?.livestreams || []);
      if (Array.isArray(rawStreams)) {
        eventLiveStreams = rawStreams.map(normalizeStreamRecord);
        window.eventLiveStreams = eventLiveStreams;
        return eventLiveStreams;
      }
    }
  } catch (err) {
    console.warn('Failed to load event livestreams from API:', err);
  }
  window.eventLiveStreams = eventLiveStreams;
  return eventLiveStreams;
}
window.loadEventLivestreams = loadEventLivestreams;

let currentModalStreamTable = 1;

function openEventStreamModal(tableNum) {
  const modal = document.getElementById('event-stream-modal');
  if (!modal) return;

  currentModalStreamTable = Number(tableNum) || (eventLiveStreams[0]?.tableNumber || 1);

  if (typeof bringModalToFront === 'function') {
    bringModalToFront(modal);
  } else {
    modal.style.display = 'flex';
    modal.classList.add('active');
  }

  updateEventStreamModalContent();
}
window.openEventStreamModal = openEventStreamModal;
window.openEventBroadcastTheater = openEventStreamModal;

function closeEventStreamModal() {
  if (typeof closeModal === 'function') {
    closeModal('event-stream-modal');
  } else {
    const modal = document.getElementById('event-stream-modal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
  }
  const iframe = document.getElementById('modal-stream-iframe');
  if (iframe) iframe.src = '';
}
window.closeEventStreamModal = closeEventStreamModal;

function onModalStreamTableChange(tableNum) {
  currentModalStreamTable = Number(tableNum);
  updateEventStreamModalContent();
}
window.onModalStreamTableChange = onModalStreamTableChange;

function updateEventStreamModalContent() {
  const select = document.getElementById('modal-stream-table-select');
  const iframe = document.getElementById('modal-stream-iframe');
  const titleEl = document.getElementById('modal-stream-title');
  const subtitleEl = document.getElementById('modal-stream-subtitle');
  const extLink = document.getElementById('modal-stream-external-link');
  const matchupContainer = document.getElementById('modal-stream-matchup-container');

  if (!eventLiveStreams || eventLiveStreams.length === 0) {
    if (matchupContainer) {
      matchupContainer.innerHTML = '<div style="color:var(--text-muted); padding:1rem; text-align:center;">No active broadcasts linked for this event.</div>';
    }
    return;
  }

  // Populate select options
  if (select) {
    select.innerHTML = eventLiveStreams.map(s => {
      const isMainDesk = Number(s.tableNumber) === 0;
      const label = isMainDesk ? 'Main Desk / All Tables' : `Table ${s.tableNumber}`;
      return `
        <option value="${s.tableNumber}" ${Number(s.tableNumber) === Number(currentModalStreamTable) ? 'selected' : ''}>
          ${label}: ${escapeHtml(s.channel)} (${s.platform === 'twitch' ? 'Twitch' : 'YouTube'})
        </option>
      `;
    }).join('');
  }

  // Find active stream for current table
  const activeStream = eventLiveStreams.find(s => Number(s.tableNumber) === Number(currentModalStreamTable)) || eventLiveStreams[0];
  const tableNum = activeStream?.tableNumber !== undefined ? activeStream.tableNumber : (currentModalStreamTable !== undefined ? currentModalStreamTable : 1);

  if (iframe && activeStream) {
    iframe.src = activeStream.embedUrl;
  }

  if (titleEl && activeStream) {
    const isMainDesk = Number(tableNum) === 0;
    titleEl.innerHTML = `
      <span>🔴 ${isMainDesk ? 'Main Desk Broadcast' : `Table ${tableNum} Live Broadcast`}</span>
      <span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid #ef4444; font-size: 0.72rem; padding: 2px 7px;">
        ${escapeHtml(activeStream.channel)} • ${activeStream.platform.toUpperCase()}
      </span>
    `;
  }

  if (subtitleEl && activeStream) {
    subtitleEl.innerHTML = `
      <span>${escapeHtml(activeStream.title)}</span> • <span style="color:#4ade80;">👁️ ~${activeStream.viewers.toLocaleString()} watching live</span>
    `;
  }

  if (extLink && activeStream) {
    extLink.href = activeStream.streamUrl;
    extLink.title = `Watch directly on ${activeStream.channel}'s ${activeStream.platform} stream`;
  }

  if (!matchupContainer) return;

  if (Number(tableNum) === 0) {
    matchupContainer.innerHTML = `
      <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 1rem; text-align: center;">
        <div style="font-size: 1.05rem; font-weight: 700; color: #fff; margin-bottom: 0.35rem;">🎙️ Main Desk & Tournament-Wide Coverage</div>
        <div style="font-size: 0.8rem; color: var(--text-secondary); max-width: 480px; margin: 0 auto;">
          Broadcasting tournament overview, top seed analysis, and multi-table commentary across all active games.
        </div>
      </div>
    `;
    return;
  }

  // Find active round & matchup for this table
  const matches = (eventMatchesCache && eventMatchesCache.length > 0) ? eventMatchesCache : (currentEventData?.matches || []);
  const players = (eventPlayersCache && eventPlayersCache.length > 0) ? eventPlayersCache : (currentEventData?.players || []);
  const curRound = selectedCasterRound || (currentEventData?.current_round > 0 ? currentEventData.current_round : (matches.length > 0 ? Math.min(...matches.map(m => Number(m.round) || 1)) : 1));

  const roundMatches = matches.filter(m => Number(m.round) === curRound);
  const match = roundMatches.find(m => Number(m.table_number || m.table) === Number(tableNum)) || matches.find(m => Number(m.table_number || m.table) === Number(tableNum));

  if (!matchupContainer) return;

  if (!match) {
    matchupContainer.innerHTML = `
      <div style="text-align:center; color:var(--text-muted); font-size:0.85rem; padding:0.5rem;">
        No active pairing found for Table ${tableNum} in Round ${curRound}.
      </div>
    `;
    return;
  }

  const p1 = players.find(p => String(p.player_id) === String(match.player1_id) || p.full_name === match.player1_name);
  const p2 = players.find(p => String(p.player_id) === String(match.player2_id) || p.full_name === match.player2_name);

  const p1Elo = Number(match.player1_elo || p1?.current_elo || 1500);
  const p2Elo = Number(match.player2_elo || p2?.current_elo || 1500);

  const p1Prob = match._p1_win_prob !== undefined ? match._p1_win_prob : Math.min(95, Math.max(5, Math.round(100 / (1 + Math.pow(10, (p2Elo - p1Elo) / 400)))));
  const p2Prob = 100 - p1Prob;

  const hasScore = match.player1_score !== null && match.player1_score !== undefined && match.player2_score !== null && match.player2_score !== undefined;
  const scoreText = hasScore ? `${match.player1_score} - ${match.player2_score}` : 'LIVE IN PROGRESS';
  const scoreColor = hasScore ? '#f59e0b' : '#38bdf8';

  const eventId = currentOpenEventId || currentEventData?.id || '';
  const matchId = `BCP-${eventId}-R${curRound}-T${tableNum}`;

  matchupContainer.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
      <div style="font-size: 0.88rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.4rem;">
        <span>⚔️ Table ${tableNum} • Round ${curRound} Headline Clash</span>
      </div>
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        ${hasScore ? `
          <button type="button" class="btn-sm btn-outline" style="font-size: 0.74rem; padding: 3px 8px; color: #38bdf8; border-color: rgba(56,189,248,0.3); cursor: pointer;" onclick="openScorecardModal('${matchId}')">
            📄 View Scorecard
          </button>
        ` : `
          <button type="button" class="btn-sm btn-outline" style="font-size: 0.74rem; padding: 3px 8px; color: #a5b4fc; border-color: #6366f1; background: rgba(99,102,241,0.1); cursor: pointer;" onclick="spectateTournamentTracker('${eventId}', ${curRound}, ${tableNum}, '${escapeHtml(match.player1_name || 'P1')}', '${escapeHtml(match.player2_name || 'P2')}', '${match.player1_id || ''}', '${match.player2_id || ''}', '${match.id || ''}')">
            👁️ Spectate Live Tracker
          </button>
        `}
      </div>
    </div>

    <!-- P1 vs P2 Strip -->
    <div class="stream-modal-versus-strip">
      <!-- P1 -->
      <div>
        <div style="font-size: 0.72rem; text-transform: uppercase; color: #38bdf8; font-weight: 700;">PLAYER 1 (${p1Prob}%)</div>
        <div style="font-size: 1.05rem; font-weight: 800; color: #fff;">${escapeHtml(match.player1_name || 'Player 1')}</div>
        <div style="font-size: 0.78rem; color: var(--text-secondary);">${escapeHtml(p1?.faction || match.player1_faction || 'Army')} • ${p1Elo.toFixed(0)} Elo</div>
        <div style="font-size: 0.72rem; color: #7dd3fc; margin-top: 2px;">${escapeHtml(p1?.detachment || 'Standard Detachment')}</div>
      </div>

      <!-- Center Score / Status -->
      <div style="text-align: center; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.5rem 1rem; min-width: 140px;">
        <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 2px;">Match Status</div>
        <div style="font-family: var(--font-mono); font-weight: 900; font-size: ${hasScore ? '1.4rem' : '0.95rem'}; color: ${scoreColor};">
          ${scoreText}
        </div>
        <div style="font-size: 0.68rem; color: var(--text-muted); margin-top: 3px;">
          ${Math.abs(p1Elo - p2Elo).toFixed(0)} Elo Differential
        </div>
      </div>

      <!-- P2 -->
      <div class="p2-side" style="text-align: right;">
        <div style="font-size: 0.72rem; text-transform: uppercase; color: #f43f5e; font-weight: 700;">PLAYER 2 (${p2Prob}%)</div>
        <div style="font-size: 1.05rem; font-weight: 800; color: #fff;">${escapeHtml(match.player2_name || 'Player 2')}</div>
        <div style="font-size: 0.78rem; color: var(--text-secondary);">${escapeHtml(p2?.faction || match.player2_faction || 'Army')} • ${p2Elo.toFixed(0)} Elo</div>
        <div style="font-size: 0.72rem; color: #fda4af; margin-top: 2px;">${escapeHtml(p2?.detachment || 'Standard Detachment')}</div>
      </div>
    </div>
  `;
}
window.updateEventStreamModalContent = updateEventStreamModalContent;

function switchCreatorHubMode(mode) {
  if (mode === 'streams') mode = 'stream';
  if (mode === 'media') mode = 'export';
  creatorHubActiveMode = mode || 'caster';
  if (currentEventData) {
    renderEventCreatorHub(currentEventData);
  }
}
window.switchCreatorHubMode = switchCreatorHubMode;

function selectCasterMatch(tableNum, roundNum) {
  if (tableNum !== undefined && tableNum !== null) selectedCasterTable = Number(tableNum);
  if (roundNum !== undefined && roundNum !== null) selectedCasterRound = Number(roundNum);
  if (currentEventData) {
    renderEventCreatorHub(currentEventData);
  }
}
window.selectCasterMatch = selectCasterMatch;

function resolveStreamTableMatchData(ev, players, matches, tableVal, curRound) {
  const tNum = (tableVal !== undefined && tableVal !== null && !isNaN(Number(tableVal))) ? Number(tableVal) : 1;
  const matchRounds = [...new Set((matches || []).map(m => Number(m.round)).filter(r => r > 0))].sort((a, b) => a - b);
  let rNum = Number(curRound || selectedCasterRound || 0);
  if (!rNum) {
    if (ev?.current_round && (matches || []).some(m => Number(m.round) === Number(ev.current_round))) {
      rNum = Number(ev.current_round);
    } else if (matchRounds.length > 0) {
      rNum = matchRounds[matchRounds.length - 1];
    } else {
      rNum = Number(ev?.current_round) || 1;
    }
  }

  const curRoundMatches = (matches || []).filter(m => Number(m.round || 1) === rNum);
  const findPlayer = (pid, pname) => {
    return (players || []).find(p => (pid && String(p.player_id || p.id) === String(pid)) || (pname && p.full_name === pname)) || null;
  };

  if (tNum === 0) {
    const featureMatch = curRoundMatches.find(m => Number(m.table_number || m.table) === 1) || curRoundMatches[0] || null;
    if (featureMatch) {
      const p1 = findPlayer(featureMatch.player1_id, featureMatch.player1_name);
      const p2 = findPlayer(featureMatch.player2_id, featureMatch.player2_name);
      const hasScore = featureMatch.player1_score !== null && featureMatch.player1_score !== undefined && featureMatch.player2_score !== null && featureMatch.player2_score !== undefined;
      return {
        tableNum: 0,
        tableBadge: 'MAIN DESK',
        roundNum: rNum,
        match: featureMatch,
        p1Name: p1?.full_name || featureMatch.player1_name || 'Player 1',
        p2Name: p2?.full_name || featureMatch.player2_name || 'Player 2',
        p1Fac: p1?.faction || featureMatch.player1_faction || 'Army',
        p2Fac: p2?.faction || featureMatch.player2_faction || 'Army',
        p1Elo: Number(featureMatch.player1_elo || p1?.current_elo || 1500),
        p2Elo: Number(featureMatch.player2_elo || p2?.current_elo || 1500),
        scoreStr: hasScore ? `${featureMatch.player1_score} - ${featureMatch.player2_score}` : '0 - 0'
      };
    }
    return {
      tableNum: 0,
      tableBadge: 'MAIN DESK',
      roundNum: rNum,
      match: null,
      p1Name: 'Main Desk',
      p2Name: 'Broadcast',
      p1Fac: 'All Tables',
      p2Fac: 'Coverage',
      p1Elo: 1500,
      p2Elo: 1500,
      scoreStr: 'LIVE'
    };
  }

  const exactMatch = curRoundMatches.find(m => Number(m.table_number || m.table) === tNum) || null;
  if (exactMatch) {
    const p1 = findPlayer(exactMatch.player1_id, exactMatch.player1_name);
    const p2 = findPlayer(exactMatch.player2_id, exactMatch.player2_name);
    const hasScore = exactMatch.player1_score !== null && exactMatch.player1_score !== undefined && exactMatch.player2_score !== null && exactMatch.player2_score !== undefined;
    return {
      tableNum: tNum,
      tableBadge: `TABLE ${tNum}`,
      roundNum: rNum,
      match: exactMatch,
      p1Name: p1?.full_name || exactMatch.player1_name || 'Player 1',
      p2Name: p2?.full_name || exactMatch.player2_name || 'Player 2',
      p1Fac: p1?.faction || exactMatch.player1_faction || 'Army',
      p2Fac: p2?.faction || exactMatch.player2_faction || 'Army',
      p1Elo: Number(exactMatch.player1_elo || p1?.current_elo || 1500),
      p2Elo: Number(exactMatch.player2_elo || p2?.current_elo || 1500),
      scoreStr: hasScore ? `${exactMatch.player1_score} - ${exactMatch.player2_score}` : '0 - 0'
    };
  }

  return {
    tableNum: tNum,
    tableBadge: `TABLE ${tNum}`,
    roundNum: rNum,
    match: null,
    p1Name: 'Player 1 (Awaiting Pairing)',
    p2Name: 'Player 2 (Awaiting Pairing)',
    p1Fac: 'TBD',
    p2Fac: 'TBD',
    p1Elo: 1500,
    p2Elo: 1500,
    scoreStr: '0 - 0'
  };
}
window.resolveStreamTableMatchData = resolveStreamTableMatchData;

function buildObsOverlayPreviewStripHtml(overlayData) {
  const { tableBadge, roundNum, p1Name, p2Name, p1Fac, p2Fac, p1Elo, p2Elo, scoreStr } = overlayData;
  return `
    <div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 0.35rem; text-transform: uppercase; font-weight: 700; display: flex; align-items: center; justify-content: space-between;">
      <span>OBS Overlay Canvas Preview (Lower-Third HUD):</span>
      <span style="color: #38bdf8; font-family: var(--font-mono);">${escapeHtml(tableBadge)} • ROUND ${roundNum}</span>
    </div>
    <div style="display: flex; align-items: center; justify-content: space-between; background: linear-gradient(90deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95)); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 6px; padding: 0.55rem 0.75rem; gap: 0.5rem;">
      <div style="display: flex; align-items: center; gap: 0.5rem; flex: 1; min-width: 0;">
        <span class="badge" style="background: #38bdf8; color: #000; font-weight: 800; font-size: 0.7rem; flex-shrink: 0; white-space: nowrap;">${escapeHtml(tableBadge)}</span>
        <div style="min-width: 0; flex: 1;">
          <div style="font-weight: 800; color: #fff; font-size: 0.82rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(p1Name)} (${escapeHtml(p1Fac)})</div>
          <div style="font-size: 0.68rem; color: #38bdf8; white-space: nowrap;">${Number(p1Elo || 1500).toFixed(1)} Elo • Round ${roundNum}</div>
        </div>
      </div>
      <div style="font-family: var(--font-mono); font-weight: 900; font-size: 1.15rem; color: #f59e0b; padding: 0 0.45rem; flex-shrink: 0; white-space: nowrap;">
        ${escapeHtml(scoreStr)}
      </div>
      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 0.5rem; text-align: right; flex: 1; min-width: 0;">
        <div style="min-width: 0; flex: 1;">
          <div style="font-weight: 800; color: #fff; font-size: 0.82rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(p2Name)} (${escapeHtml(p2Fac)})</div>
          <div style="font-size: 0.68rem; color: #f43f5e; white-space: nowrap;">${Number(p2Elo || 1500).toFixed(1)} Elo • Round ${roundNum}</div>
        </div>
        <span class="badge" style="background: #f43f5e; color: #fff; font-weight: 800; font-size: 0.7rem; flex-shrink: 0; white-space: nowrap;">${escapeHtml(tableBadge)}</span>
      </div>
    </div>
  `;
}
window.buildObsOverlayPreviewStripHtml = buildObsOverlayPreviewStripHtml;

function refreshStreamTableSelection(tableVal, sourceId) {
  const parsed = parseInt(tableVal, 10);
  if (isNaN(parsed) || parsed < 0) return;
  selectedCasterTable = parsed;

  const ev = currentEventData || {};
  const players = Array.isArray(eventPlayersCache) && eventPlayersCache.length > 0 ? eventPlayersCache : (ev.players || []);
  const matches = Array.isArray(eventMatchesCache) && eventMatchesCache.length > 0 ? eventMatchesCache : (ev.matches || []);
  const overlayData = resolveStreamTableMatchData(ev, players, matches, selectedCasterTable, selectedCasterRound);

  const previewContainer = document.getElementById('obs-overlay-preview-container');
  if (previewContainer) {
    previewContainer.innerHTML = buildObsOverlayPreviewStripHtml(overlayData);
  }

  const streamSelect = document.getElementById('new-stream-table');
  const obsSelect = document.getElementById('obs-overlay-table-select');
  const customEl = document.getElementById('new-stream-custom-table');

  if (sourceId !== 'new-stream-table' && streamSelect) {
    const hasOpt = Array.from(streamSelect.options).some(o => o.value === String(selectedCasterTable));
    if (hasOpt) {
      streamSelect.value = String(selectedCasterTable);
      if (customEl) customEl.style.display = 'none';
    } else {
      streamSelect.value = 'custom';
      if (customEl) {
        customEl.style.display = 'inline-block';
        customEl.value = String(selectedCasterTable);
      }
    }
  }

  if (sourceId !== 'obs-overlay-table-select' && obsSelect) {
    const hasOpt = Array.from(obsSelect.options).some(o => o.value === String(selectedCasterTable));
    if (hasOpt) {
      obsSelect.value = String(selectedCasterTable);
    } else {
      obsSelect.value = 'custom';
    }
  }

  const monitorLabelEl = document.getElementById('live-monitor-table-label');
  if (monitorLabelEl && eventLiveStreams.length === 0) {
    monitorLabelEl.textContent = `Stream • ${selectedCasterTable === 0 ? 'Main Desk / All Tables' : `Table ${selectedCasterTable}`}`;
  }
}
window.refreshStreamTableSelection = refreshStreamTableSelection;

function selectActiveStream(idx) {
  creatorActiveStreamIndex = Number(idx) || 0;
  const stream = eventLiveStreams[creatorActiveStreamIndex];
  if (stream && stream.tableNumber !== undefined && stream.tableNumber !== null) {
    selectedCasterTable = Number(stream.tableNumber);
  }
  if (currentEventData) {
    renderEventCreatorHub(currentEventData);
  }
}
window.selectActiveStream = selectActiveStream;

function handleStreamTableSelectChange(val) {
  const customEl = document.getElementById('new-stream-custom-table');
  if (val === 'custom') {
    if (customEl) {
      customEl.style.display = 'inline-block';
      if (!customEl.value) {
        customEl.value = String(selectedCasterTable || 1);
      }
      customEl.focus();
      const parsed = parseInt(customEl.value, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        refreshStreamTableSelection(parsed, 'new-stream-table');
      }
    }
  } else {
    if (customEl) {
      customEl.style.display = 'none';
    }
    refreshStreamTableSelection(val, 'new-stream-table');
  }
}
window.handleStreamTableSelectChange = handleStreamTableSelectChange;

function handleObsOverlayTableChange(val) {
  const customEl = document.getElementById('new-stream-custom-table');
  const streamSelect = document.getElementById('new-stream-table');
  if (val === 'custom') {
    if (streamSelect) streamSelect.value = 'custom';
    if (customEl) {
      customEl.style.display = 'inline-block';
      if (!customEl.value) {
        customEl.value = String(selectedCasterTable || 1);
      }
      customEl.focus();
      const parsed = parseInt(customEl.value, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        refreshStreamTableSelection(parsed, 'obs-overlay-table-select');
      }
    }
  } else {
    refreshStreamTableSelection(val, 'obs-overlay-table-select');
  }
}
window.handleObsOverlayTableChange = handleObsOverlayTableChange;

function handleCustomStreamTableInput(val) {
  const parsed = parseInt(val, 10);
  if (!isNaN(parsed) && parsed >= 0) {
    refreshStreamTableSelection(parsed, 'new-stream-custom-table');
  }
}
window.handleCustomStreamTableInput = handleCustomStreamTableInput;

async function addCreatorLiveStream(e) {
  if (e) e.preventDefault();
  const channelEl = document.getElementById('new-stream-channel');
  const urlEl = document.getElementById('new-stream-url');
  const tableEl = document.getElementById('new-stream-table');
  const customTableEl = document.getElementById('new-stream-custom-table');
  const platformEl = document.getElementById('new-stream-platform');

  const channel = (channelEl?.value || 'Broadcaster').trim();
  const url = (urlEl?.value || '').trim();
  const platform = platformEl?.value || 'youtube';

  let table = 1;
  if (tableEl?.value === 'custom') {
    const parsed = parseInt(customTableEl?.value, 10);
    if (isNaN(parsed) || parsed < 0) {
      alert('Please enter a valid table number (e.g. 1 to 500, or 0 for Main Desk).');
      if (customTableEl) customTableEl.focus();
      return;
    }
    table = parsed;
  } else if (tableEl) {
    const parsed = parseInt(tableEl.value, 10);
    table = isNaN(parsed) ? 1 : parsed;
  }

  if (!url) {
    alert('Please enter a valid livestream URL.');
    return;
  }

  const isMainDesk = table === 0;
  const defaultStreamTitle = isMainDesk ? `${channel} - Main Desk Broadcast` : `${channel} - Table ${table} Coverage`;

  const eventId = currentOpenEventId || currentEventData?.id || 'ev_ongoing_gt_live';
  const streamPayload = {
    channel: channel,
    stream_url: url,
    table_number: table,
    platform: platform,
    title: defaultStreamTitle,
    is_live: true
  };

  try {
    if (window.api && typeof window.api.saveEventLivestream === 'function') {
      await window.api.saveEventLivestream(eventId, streamPayload);
      await loadEventLivestreams(eventId);
    } else {
      let embed = url;
      if (url.includes('youtube.com/watch?v=')) {
        const vid = url.split('watch?v=')[1]?.split('&')[0];
        embed = `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&mute=1`;
      } else if (url.includes('youtu.be/')) {
        const vid = url.split('youtu.be/')[1]?.split('?')[0];
        embed = `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&mute=1`;
      } else if (url.includes('twitch.tv/')) {
        const ch = url.split('twitch.tv/')[1]?.split('/')[0];
        embed = `https://player.twitch.tv/?channel=${ch}&parent=localhost&parent=127.0.0.1&muted=true`;
      }
      eventLiveStreams.unshift(normalizeStreamRecord({
        id: `stream-${Date.now()}`,
        channel: channel,
        platform: platform,
        title: defaultStreamTitle,
        stream_url: url,
        embed_url: embed,
        table_number: table,
        is_live: true,
        viewers: 100
      }));
    }
    creatorActiveStreamIndex = 0;
    if (typeof showProfileToast === 'function') {
      showProfileToast('✓ Live stream linked successfully!');
    } else {
      alert('Live stream linked successfully!');
    }
    if (currentEventData) {
      renderEventCreatorHub(currentEventData);
      const pairingsTab = document.getElementById('tab-event-pairings');
      if (pairingsTab && typeof renderEventPairingsTab === 'function') {
        renderEventPairingsTab(currentEventData);
      }
    }
  } catch (err) {
    console.error('Failed to link live stream:', err);
    alert(`Failed to link live stream: ${err.message}`);
  }
}
window.addCreatorLiveStream = addCreatorLiveStream;

async function removeCreatorLiveStream(idxOrId) {
  const stream = (typeof idxOrId === 'number') ? eventLiveStreams[idxOrId] : eventLiveStreams.find(s => s.id === idxOrId);
  if (!stream) return;
  const eventId = currentOpenEventId || currentEventData?.id || 'ev_ongoing_gt_live';
  try {
    if (window.api && typeof window.api.deleteEventLivestream === 'function' && stream.id) {
      await window.api.deleteEventLivestream(eventId, stream.id);
      await loadEventLivestreams(eventId);
    } else if (typeof idxOrId === 'number') {
      eventLiveStreams.splice(idxOrId, 1);
    }
    creatorActiveStreamIndex = 0;
    if (typeof showProfileToast === 'function') {
      showProfileToast('✓ Live stream removed.');
    }
    if (currentEventData) {
      renderEventCreatorHub(currentEventData);
      const pairingsTab = document.getElementById('tab-event-pairings');
      if (pairingsTab && typeof renderEventPairingsTab === 'function') {
        renderEventPairingsTab(currentEventData);
      }
    }
  } catch (err) {
    console.error('Failed to remove live stream:', err);
    alert(`Failed to remove live stream: ${err.message}`);
  }
}
window.removeCreatorLiveStream = removeCreatorLiveStream;

function copyCasterCheatSheet() {
  const el = document.getElementById('caster-cheat-sheet-content');
  if (!el) return;
  const text = el.innerText || '';
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).then(() => {
      if (typeof showProfileToast === 'function') showProfileToast('✓ Caster talking points copied!');
      else alert('Caster talking points copied!');
    }).catch(() => {});
  }
}
window.copyCasterCheatSheet = copyCasterCheatSheet;

function copyDiscordSummary() {
  const el = document.getElementById('creator-discord-text');
  if (!el) return;
  const text = el.value || el.innerText || '';
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).then(() => {
      if (typeof showProfileToast === 'function') showProfileToast('✓ Discord markdown summary copied!');
      else alert('Discord markdown summary copied!');
    }).catch(() => {});
  }
}
window.copyDiscordSummary = copyDiscordSummary;

function copyObsOverlayUrl(overlayType) {
  const evId = currentEventData?.id || 'ev_ongoing_gt_live';
  const roundParam = selectedCasterRound ? `&round=${encodeURIComponent(selectedCasterRound)}` : '';
  const url = `${window.location.origin}/overlay?event=${encodeURIComponent(evId)}&table=${selectedCasterTable}${roundParam}&type=${overlayType || 'lower_third'}`;
  const tableLabel = Number(selectedCasterTable) === 0 ? 'Main Desk' : `Table ${selectedCasterTable}`;
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(url).then(() => {
      if (typeof showProfileToast === 'function') showProfileToast(`✓ OBS ${overlayType} URL copied (${tableLabel})!`);
      else alert(`OBS URL copied (${tableLabel}): ${url}`);
    }).catch(() => {});
  }
}
window.copyObsOverlayUrl = copyObsOverlayUrl;

var casterPlayerProfileCache = (typeof window !== 'undefined' && window.__casterPlayerProfileCache) || {};
var casterArmyListCache = (typeof window !== 'undefined' && window.__casterArmyListCache) || {};
var casterHeadToHeadCache = (typeof window !== 'undefined' && window.__casterHeadToHeadCache) || {};
if (typeof window !== 'undefined') {
  window.__casterPlayerProfileCache = casterPlayerProfileCache;
  window.__casterArmyListCache = casterArmyListCache;
  window.__casterHeadToHeadCache = casterHeadToHeadCache;
}

function getCasterH2hCacheKey(sys, p1Pid, p2Pid, p1Name, p2Name) {
  const k1 = String(p1Pid || p1Name || '').trim().toLowerCase();
  const k2 = String(p2Pid || p2Name || '').trim().toLowerCase();
  return `${sys || '40k'}:${[k1, k2].sort().join('::')}`;
}

function isSameCasterPlayer(mPid, mName, targetPid, targetName) {
  const mp = String(mPid || '').trim().toLowerCase();
  const tp = String(targetPid || '').trim().toLowerCase();
  if (mp && tp && mp === tp) return true;
  const mn = String(mName || '').trim().toLowerCase();
  const tn = String(targetName || '').trim().toLowerCase();
  if (mn && tn && mn === tn) return true;
  return false;
}

function filterPastHeadToHeadMatches(rawMatches, ev, selectedMatch, curRound, p1Pid, p2Pid, p1Name, p2Name) {
  if (!Array.isArray(rawMatches)) return [];
  const curEvId = String(ev?.id || currentOpenEventId || currentEventData?.id || '').trim().toLowerCase();
  const curR = Number(curRound || selectedMatch?.round || 1);
  const curT = Number(selectedMatch?.table_number || selectedMatch?.table || 0);
  const seen = new Set();
  const out = [];

  rawMatches.forEach(m => {
    if (!m) return;
    const p1MatchesA = isSameCasterPlayer(m.player1_id, m.player1_name, p1Pid, p1Name);
    const p2MatchesB = isSameCasterPlayer(m.player2_id, m.player2_name, p2Pid, p2Name);
    const p1MatchesB = isSameCasterPlayer(m.player1_id, m.player1_name, p2Pid, p2Name);
    const p2MatchesA = isSameCasterPlayer(m.player2_id, m.player2_name, p1Pid, p1Name);
    if (!((p1MatchesA && p2MatchesB) || (p1MatchesB && p2MatchesA))) return;

    const hasScores = m.player1_score !== null && m.player1_score !== undefined && m.player2_score !== null && m.player2_score !== undefined;
    if (!hasScores && !m.is_done) return;

    const mEvId = String(m.event_id || ev?.id || '').trim().toLowerCase();
    const mRound = Number(m.round || 1);
    const mTable = Number(m.table_number || m.table || 0);

    // Exclude the current match on the Caster Desk (and any match in the current event at or after curRound)
    if (curEvId && mEvId === curEvId) {
      if (mRound >= curR) return;
      if (mRound === curR && curT > 0 && mTable === curT) return;
    }

    const dedupKey = `${mEvId || 'ev'}:R${mRound}:T${mTable}:${String(m.match_date || '').slice(0, 10)}`;
    if (seen.has(dedupKey)) return;
    seen.add(dedupKey);
    out.push(m);
  });

  return out.sort((a, b) => {
    const da = String(a.match_date || '');
    const db = String(b.match_date || '');
    if (da !== db) return db.localeCompare(da);
    return Number(b.round || 0) - Number(a.round || 0);
  });
}

function computeCasterPastH2hRecord(pastMatches, p1Pid, p2Pid, p1Name, p2Name) {
  let p1Wins = 0;
  let p2Wins = 0;
  let draws = 0;

  (pastMatches || []).forEach(m => {
    const isP1Side1 = isSameCasterPlayer(m.player1_id, m.player1_name, p1Pid, p1Name);
    const s1 = Number(isP1Side1 ? m.player1_score : m.player2_score);
    const s2 = Number(isP1Side1 ? m.player2_score : m.player1_score);
    const wId = String(m.winner_id || '').trim();

    if (m.is_draw || (!wId && !isNaN(s1) && !isNaN(s2) && s1 === s2)) {
      draws++;
    } else if ((wId && isSameCasterPlayer(wId, '', p1Pid, '')) || (!isNaN(s1) && !isNaN(s2) && s1 > s2)) {
      p1Wins++;
    } else if ((wId && isSameCasterPlayer(wId, '', p2Pid, '')) || (!isNaN(s1) && !isNaN(s2) && s2 > s1)) {
      p2Wins++;
    }
  });

  let summaryText = 'First career meeting';
  const total = p1Wins + p2Wins + draws;
  if (total > 0) {
    const drawSuffix = draws > 0 ? `-${draws}` : '';
    if (p1Wins > p2Wins) {
      summaryText = `${escapeHtml(p1Name)} leads ${p1Wins}-${p2Wins}${drawSuffix} in past encounters`;
    } else if (p2Wins > p1Wins) {
      summaryText = `${escapeHtml(p2Name)} leads ${p2Wins}-${p1Wins}${drawSuffix} in past encounters`;
    } else {
      summaryText = `Tied ${p1Wins}-${p2Wins}${drawSuffix} in past encounters`;
    }
  }
  return { p1Wins, p2Wins, draws, total, summaryText };
}

function buildCasterPastH2hCardHtml(pastMatches, p1Pid, p2Pid, p1Name, p2Name, isLoading = false) {
  const rec = computeCasterPastH2hRecord(pastMatches, p1Pid, p2Pid, p1Name, p2Name);
  const rowsHtml = (pastMatches || []).map(m => {
    const isP1Side1 = isSameCasterPlayer(m.player1_id, m.player1_name, p1Pid, p1Name);
    const rawS1 = isP1Side1 ? m.player1_score : m.player2_score;
    const rawS2 = isP1Side1 ? m.player2_score : m.player1_score;
    const scoreP1 = (rawS1 !== null && rawS1 !== undefined) ? rawS1 : '-';
    const scoreP2 = (rawS2 !== null && rawS2 !== undefined) ? rawS2 : '-';
    const numS1 = Number(rawS1);
    const numS2 = Number(rawS2);
    const wId = String(m.winner_id || '').trim();

    const isP1Winner = !m.is_draw && ((wId && isSameCasterPlayer(wId, '', p1Pid, '')) || (!isNaN(numS1) && !isNaN(numS2) && numS1 > numS2));
    const isP2Winner = !m.is_draw && ((wId && isSameCasterPlayer(wId, '', p2Pid, '')) || (!isNaN(numS1) && !isNaN(numS2) && numS2 > numS1));

    let outcomeText = 'DRAW';
    let badgeClass = 'badge-draw';
    if (isP1Winner) {
      outcomeText = `${p1Name.toUpperCase()} WIN`;
      badgeClass = 'badge-win';
    } else if (isP2Winner) {
      outcomeText = `${p2Name.toUpperCase()} WIN`;
      badgeClass = 'badge-win';
    }

    const eventName = m.event_name || (currentEventData && String(m.event_id) === String(currentEventData.id) ? currentEventData.name : 'Tournament');
    const eventId = m.event_id ? String(m.event_id).trim() : '';
    const safeEventId = eventId.replace(/'/g, "\\'");
    const rNum = Number(m.round || 1);
    const tNum = Number(m.table_number || m.table || 0);
    const scMatchId = eventId && tNum > 0 ? `BCP-${eventId}-R${rNum}-T${tNum}` : '';
    const dateStr = String(m.match_date || '').slice(0, 10) || '-';

    return `
      <tr>
        <td style="font-family:var(--font-mono); color:var(--text-muted); font-size:0.82rem; white-space:nowrap;">${escapeHtml(dateStr)}</td>
        <td>
          ${eventId
            ? `<span class="player-link" onclick="event.stopPropagation(); if (typeof openEventModal === 'function') openEventModal('${escapeHtml(safeEventId)}', false);" style="font-weight:700; color:#fff; cursor:pointer;" title="View Tournament Details">${escapeHtml(eventName)}</span>`
            : `<span style="font-weight:700; color:#fff;">${escapeHtml(eventName)}</span>`
          }
        </td>
        <td style="font-family:var(--font-mono); font-weight:700;">R${rNum}</td>
        <td style="font-family:var(--font-mono); font-weight:800; color:${isP1Winner ? 'var(--win)' : 'var(--text-secondary)'};">${escapeHtml(String(scoreP1))}</td>
        <td style="font-family:var(--font-mono); font-weight:800; color:${isP2Winner ? 'var(--win)' : 'var(--text-secondary)'};">${escapeHtml(String(scoreP2))}</td>
        <td>
          <div style="display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap;">
            <span class="badge ${badgeClass}">${escapeHtml(outcomeText)}</span>
            ${scMatchId ? `<button type="button" class="btn-xs btn-outline" onclick="event.stopPropagation(); openScorecardModal('${escapeHtml(scMatchId.replace(/'/g, "\\'"))}')" style="font-size:0.68rem; padding:2px 6px; border-radius:4px; color:#38bdf8; border-color:rgba(56,189,248,0.35); cursor:pointer;">📄 Scorecard</button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div style="background: rgba(15, 23, 42, 0.72); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 1rem 1.15rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap;">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <h4 style="margin: 0; font-size: 0.94rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.4rem;">
            <span>📜 Past Head-to-Head Encounters</span>
          </h4>
          <span class="badge" style="background: rgba(56, 189, 248, 0.14); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); font-size: 0.7rem; font-weight: 700;">
            ${rec.total > 0 ? `${rec.total} Past ${rec.total === 1 ? 'Match' : 'Matches'} • ${rec.summaryText}` : (isLoading ? 'Checking Career History...' : 'First Career Meeting')}
          </span>
        </div>
      </div>
      <div class="table-responsive" style="margin: 0;">
        <table class="data-table" style="margin: 0; font-size: 0.82rem;">
          <thead>
            <tr>
              <th>DATE</th>
              <th>TOURNAMENT</th>
              <th>ROUND</th>
              <th>PLAYER 1 SCORE (${escapeHtml(p1Name.toUpperCase())})</th>
              <th>PLAYER 2 SCORE (${escapeHtml(p2Name.toUpperCase())})</th>
              <th>OUTCOME</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `
              <tr>
                <td colspan="6" style="text-align:center; padding:1rem; color:var(--text-muted); font-size:0.8rem;">
                  ${isLoading ? 'Loading past head-to-head encounters...' : `No previous head-to-head match encounters between ${escapeHtml(p1Name)} and ${escapeHtml(p2Name)}.`}
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function getEventRoundMetadata(ev, matches, roundNum, maxR) {
  const r = Number(roundNum || 1);
  const totalR = Number(maxR || 5);
  let rawJson = (ev && ev.raw_json) || {};
  if (typeof rawJson === 'string') {
    try { rawJson = JSON.parse(rawJson); } catch (e) { rawJson = {}; }
  }
  const podRound = Number(ev?.pod_round || rawJson?.podRound || 0);
  const podSize = Number(ev?.pod_size || rawJson?.podSize || 0);
  const topCut = Boolean(rawJson?.topCut || rawJson?.bracketPairings || podRound > 0);
  const desc = String(rawJson?.eventDescription || ev?.description || '').toLowerCase();

  const rMatches = (matches || []).filter(m => Number(m.round) === r && !m.is_bye);
  const pod1Matches = rMatches.filter(m => Number(m.pod_num) === 1);
  const activeCount = pod1Matches.length > 0 ? pod1Matches.length : rMatches.length;

  let isShadowRound = false;
  let isTopCut = false;
  let shortLabel = `R${r}`;
  let fullLabel = `Round ${r}`;
  let badgeText = `Round ${r}`;
  let badgeColor = '#38bdf8';
  let badgeBg = 'rgba(56, 189, 248, 0.15)';
  let badgeBorder = 'rgba(56, 189, 248, 0.35)';

  const hasShadowDesc = desc.includes('shadow round');
  if (
    (podRound > 0 && r === podRound && ((podSize === 16 && (totalR - podRound) >= 3) || hasShadowDesc)) ||
    (r === 7 && totalR === 10 && (activeCount === 8 || hasShadowDesc))
  ) {
    isShadowRound = true;
    shortLabel = `🌑 R${r} • Shadow`;
    fullLabel = `Round ${r} • Shadow Round (Top 16 Play-In)`;
    badgeText = `🌑 SHADOW ROUND • TOP 16`;
    badgeColor = '#c084fc';
    badgeBg = 'rgba(168, 85, 247, 0.2)';
    badgeBorder = 'rgba(168, 85, 247, 0.45)';
  } else if ((topCut && podRound > 0 && r >= podRound) || (totalR >= 8 && r >= 8 && activeCount > 0 && activeCount <= 8)) {
    isTopCut = true;
    if (activeCount === 1 || (r === totalR && activeCount <= 2 && totalR >= 8)) {
      shortLabel = `👑 R${r} • Finals`;
      fullLabel = `Round ${r} • Championship Grand Finals`;
      badgeText = `👑 GRAND FINALS`;
      badgeColor = '#fbbf24';
      badgeBg = 'rgba(245, 158, 11, 0.2)';
      badgeBorder = 'rgba(245, 158, 11, 0.45)';
    } else if (activeCount === 2 || (r === totalR - 1 && totalR >= 8)) {
      shortLabel = `🏆 R${r} • Top 4`;
      fullLabel = `Round ${r} • Semifinals (Top 4 Cut)`;
      badgeText = `🏆 TOP 4 SEMIFINALS`;
      badgeColor = '#fbbf24';
      badgeBg = 'rgba(245, 158, 11, 0.16)';
      badgeBorder = 'rgba(245, 158, 11, 0.4)';
    } else if (activeCount === 4 || (r === totalR - 2 && totalR >= 8)) {
      shortLabel = `🏆 R${r} • Top 8`;
      fullLabel = `Round ${r} • Quarterfinals (Top 8 Cut)`;
      badgeText = `🏆 TOP 8 QUARTERFINALS`;
      badgeColor = '#34d399';
      badgeBg = 'rgba(16, 185, 129, 0.16)';
      badgeBorder = 'rgba(16, 185, 129, 0.4)';
    } else if (activeCount === 8) {
      shortLabel = `🏆 R${r} • Top 16`;
      fullLabel = `Round ${r} • Top 16 Bracket`;
      badgeText = `🏆 TOP 16 BRACKET`;
      badgeColor = '#c084fc';
      badgeBg = 'rgba(168, 85, 247, 0.16)';
      badgeBorder = 'rgba(168, 85, 247, 0.4)';
    }
  }

  return {
    round: r,
    isShadowRound,
    isTopCut,
    shortLabel,
    fullLabel,
    badgeText,
    badgeColor,
    badgeBg,
    badgeBorder,
    matchCount: rMatches.length
  };
}
window.getEventRoundMetadata = getEventRoundMetadata;

function renderEventCreatorHub(ev) {
  const container = document.getElementById('event-creator-hub-container');
  if (!container) return;

  const isCC = Boolean(typeof isUserCC === 'function' ? isUserCC(currentUser) : (currentUser && (currentUser.role === 'admin' || currentUser.role === 'cc' || currentUser.role === 'creator' || currentUser.can_access_cc || currentUser.is_cc || currentUser.is_admin)));
  if (!isCC) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 3rem 1.5rem; text-align: center;">
        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">🔒</div>
        <div style="font-size: 1.1rem; font-weight: 700; color: #fff; margin-bottom: 0.35rem;">Restricted Creator Access</div>
        <p style="font-size: 0.85rem; color: var(--text-muted); max-width: 480px; margin: 0 auto 1rem; line-height: 1.5;">
          The Creator Hub and Live Stream Broadcast Desk are exclusively accessible to verified Content Creators and Tournament Administrators.
        </p>
      </div>
    `;
    return;
  }

  if (creatorHubActiveMode === 'storylines') {
    creatorHubActiveMode = 'caster';
  }

  const players = Array.isArray(eventPlayersCache) && eventPlayersCache.length > 0 ? eventPlayersCache : (ev.players || []);
  const matches = Array.isArray(eventMatchesCache) && eventMatchesCache.length > 0 ? eventMatchesCache : (ev.matches || []);

  if (players.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:2.5rem 1rem;">No tournament roster data available for Creator Studio yet.</div>`;
    return;
  }

  // Determine rounds dynamically (including R9, R10, Shadow Round, Top Cut)
  let rawJson = (ev && ev.raw_json) || {};
  if (typeof rawJson === 'string') {
    try { rawJson = JSON.parse(rawJson); } catch (e) { rawJson = {}; }
  }
  const matchRounds = [...new Set(matches.map(m => Number(m.round)).filter(r => r > 0))].sort((a, b) => a - b);
  const resolvedNumRounds = Number(ev.num_rounds || ev.numberOfRounds || ev.rounds_count || ev.rounds || ev.total_rounds || rawJson.numberOfRounds || rawJson.numRounds || 0);
  const totalRounds = Math.max(
    resolvedNumRounds,
    matchRounds.length > 0 ? Math.max(...matchRounds) : 0,
    Number(ev.current_round || 0),
    1
  );

  // Determine selected / current round
  let curRound = selectedCasterRound;
  if (!curRound) {
    if (ev.current_round && matches.some(m => Number(m.round) === Number(ev.current_round))) {
      curRound = Number(ev.current_round);
    } else if (matchRounds.length > 0) {
      curRound = matchRounds[matchRounds.length - 1];
    } else {
      curRound = Number(ev.current_round) || 1;
    }
  }

  const roundMatches = matches.filter(m => Number(m.round) === curRound);
  let selectedMatch = null;
  let p1 = null;
  let p2 = null;
  let p1Elo = 1500;
  let p2Elo = 1500;
  let p1WinProb = 50;
  let p2WinProb = 50;

  if (roundMatches.length > 0) {
    const exactMatch = roundMatches.find(m => Number(m.table_number || m.table) === Number(selectedCasterTable));
    if (exactMatch) {
      selectedMatch = exactMatch;
    } else if (creatorHubActiveMode === 'caster') {
      selectedMatch = roundMatches[0];
      selectedCasterTable = Number(selectedMatch?.table_number || selectedMatch?.table || 1);
    } else if (Number(selectedCasterTable) === 0) {
      selectedMatch = roundMatches[0] || null;
    }

    if (selectedMatch) {
      p1 = players.find(p => String(p.player_id || p.id) === String(selectedMatch?.player1_id) || p.full_name === selectedMatch?.player1_name) || {
        player_id: selectedMatch.player1_id || '',
        full_name: selectedMatch.player1_name || 'Player 1',
        faction: selectedMatch.player1_faction || 'Army',
        detachment: 'Standard',
        list_id: selectedMatch.player1_list_id || '',
        current_elo: selectedMatch.player1_elo || 1500
      };
      p2 = players.find(p => String(p.player_id || p.id) === String(selectedMatch?.player2_id) || p.full_name === selectedMatch?.player2_name) || {
        player_id: selectedMatch.player2_id || '',
        full_name: selectedMatch.player2_name || 'Player 2',
        faction: selectedMatch.player2_faction || 'Army',
        detachment: 'Standard',
        list_id: selectedMatch.player2_list_id || '',
        current_elo: selectedMatch.player2_elo || 1500
      };

      p1Elo = Number(selectedMatch?.player1_elo || p1?.current_elo || 1500);
      p2Elo = Number(selectedMatch?.player2_elo || p2?.current_elo || 1500);

      const eloDiff = p2Elo - p1Elo;
      p1WinProb = Math.min(95, Math.max(5, Math.round(100 / (1 + Math.pow(10, eloDiff / 400)))));
      p2WinProb = 100 - p1WinProb;
    }
  }

  // Header Banner & Mode Navigator (Storylines & Upsets tab removed per user request)
  const headerHtml = `
    <div class="creator-hero-banner">
      <div class="creator-hero-header">
        <div class="creator-hero-title">
          <span>🎙️ Creator Studio & Broadcast Desk</span>
          <span class="creator-badge-pro">PRO • CC EXCLUSIVE</span>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.72rem; padding: 3px 8px;">
            ● Live Event Feed Connected
          </span>
          <span class="badge" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.28); font-size: 0.72rem; padding: 3px 8px;">
            Role: Content Creator / Admin
          </span>
        </div>
      </div>
      <div style="font-size: 0.82rem; color: var(--text-secondary); line-height: 1.45;">
        Live commentator desk, side-by-side tale of the tape, commander faction mastery & army rosters, livestream embed & OBS overlays, and one-click broadcast social graphics.
      </div>
      <div class="creator-mode-tabs">
        <button type="button" class="creator-mode-btn ${creatorHubActiveMode === 'caster' ? 'active' : ''}" onclick="switchCreatorHubMode('caster')">
          <span>🎙️ Caster Desk</span>
        </button>
        <button type="button" class="creator-mode-btn ${creatorHubActiveMode === 'stream' ? 'active' : ''}" onclick="switchCreatorHubMode('stream')">
          <span>📺 Live Stream & OBS</span>
          <span class="badge" style="background:#ef4444; color:#fff; font-size:0.65rem; padding:1px 5px; border-radius:4px;">LIVE</span>
        </button>
        <button type="button" class="creator-mode-btn ${creatorHubActiveMode === 'meta' ? 'active' : ''}" onclick="switchCreatorHubMode('meta')">
          <span>🧬 Deep Meta & Lists</span>
        </button>
        <button type="button" class="creator-mode-btn ${creatorHubActiveMode === 'export' ? 'active' : ''}" onclick="switchCreatorHubMode('export')">
          <span>📸 Media & Export Kit</span>
        </button>
      </div>
    </div>
  `;

  // Render specific mode body
  let bodyHtml = '';
  if (creatorHubActiveMode === 'caster') {
    bodyHtml = renderCasterDeckMode(ev, players, matches, roundMatches, selectedMatch, p1, p2, p1Elo, p2Elo, p1WinProb, p2WinProb, curRound, matchRounds, totalRounds);
  } else if (creatorHubActiveMode === 'stream') {
    bodyHtml = renderStreamStudioMode(ev, players, matches, selectedMatch, p1, p2, p1Elo, p2Elo, curRound);
  } else if (creatorHubActiveMode === 'meta') {
    bodyHtml = renderDeepMetaMode(ev, players, matches);
  } else if (creatorHubActiveMode === 'export') {
    bodyHtml = renderMediaExportMode(ev, players, matches, curRound);
  }

  container.innerHTML = `
    <div class="creator-hub-container">
      ${headerHtml}
      ${bodyHtml}
    </div>
  `;

  if (creatorHubActiveMode === 'caster' && selectedMatch && p1 && p2) {
    setTimeout(() => {
      hydrateCasterDossiersAsync(ev, p1, p2, selectedMatch);
    }, 10);
  }
}
window.renderEventCreatorHub = renderEventCreatorHub;

function buildCasterFactionMasteryHtml(playerObj, profileData, accentColor) {
  const curFac = formatEventPlayerFaction(playerObj?.faction || playerObj?.army_name || 'Army');
  const history = Array.isArray(profileData?.history) ? profileData.history : (Array.isArray(profileData?.win_path) ? profileData.win_path : []);
  const rawBreakdown = profileData?.faction_mastery || profileData?.factions_breakdown || [];
  let masteryList = [];

  if (typeof computeProfileFactionMastery === 'function' && (history.length > 0 || rawBreakdown.length > 0)) {
    masteryList = computeProfileFactionMastery(history, rawBreakdown);
  } else if (Array.isArray(rawBreakdown) && rawBreakdown.length > 0) {
    masteryList = rawBreakdown.map(f => {
      const g = Number(f.games || f.matches || (Number(f.wins || 0) + Number(f.losses || 0) + Number(f.draws || 0)) || 0);
      const w = Number(f.wins || 0);
      return {
        faction: f.faction || curFac,
        games: g,
        wins: w,
        losses: Number(f.losses || 0),
        draws: Number(f.draws || 0),
        net_elo: Number(f.net_elo || 0),
        win_rate: g > 0 ? (w / g) * 100 : 0
      };
    });
  }

  const evW = Number(playerObj?.event_wins || 0);
  const evL = Number(playerObj?.event_losses || 0);
  const evD = Number(playerObj?.event_draws || 0);
  const evG = evW + evL + evD;
  const evNet = Number(playerObj?.event_net_elo || playerObj?._computed_net_elo || 0);

  if (masteryList.length === 0) {
    const careerW = Number(profileData?.player?.wins ?? playerObj?.wins ?? evW);
    const careerL = Number(profileData?.player?.losses ?? playerObj?.losses ?? evL);
    const careerD = Number(profileData?.player?.draws ?? playerObj?.draws ?? evD);
    const careerG = Math.max(evG, careerW + careerL + careerD);
    masteryList = [{
      faction: curFac,
      games: careerG,
      wins: Math.max(evW, careerW),
      losses: Math.max(evL, careerL),
      draws: Math.max(evD, careerD),
      net_elo: evNet,
      win_rate: careerG > 0 ? (Math.max(evW, careerW) / careerG) * 100 : 0
    }];
  }

  const totalGames = masteryList.reduce((acc, m) => acc + Number(m.games || 0), 0);
  const activeFacEntry = masteryList.find(m => m.faction.toLowerCase() === curFac.toLowerCase()) || masteryList[0];
  const sigEntry = masteryList[0];

  const getMasteryTierBadge = (games, wr) => {
    if (games >= 25 && wr >= 60) return { label: '👑 Grandmaster', bg: 'rgba(245, 158, 11, 0.18)', col: '#fbbf24', border: 'rgba(245, 158, 11, 0.45)' };
    if (games >= 15 && wr >= 55) return { label: '🔥 Master', bg: 'rgba(168, 85, 247, 0.18)', col: '#c084fc', border: 'rgba(168, 85, 247, 0.45)' };
    if (games >= 8) return { label: '⚔️ Veteran Specialist', bg: 'rgba(56, 189, 248, 0.15)', col: '#38bdf8', border: 'rgba(56, 189, 248, 0.35)' };
    return { label: '🛡️ Faction Adept', bg: 'rgba(148, 163, 184, 0.15)', col: '#cbd5e1', border: 'rgba(148, 163, 184, 0.3)' };
  };

  const tierBadge = getMasteryTierBadge(activeFacEntry?.games || 0, activeFacEntry?.win_rate || 0);
  const topArmies = masteryList.slice(0, 3);

  const pData = profileData?.player || profileData || {};
  const careerElo = Number(pData.current_elo || playerObj?.current_elo || 1500);
  const peakElo = Math.max(careerElo, Number(pData.peak_elo || playerObj?.peak_elo || careerElo));
  const careerWins = Number(pData.wins ?? totalGames > 0 ? masteryList.reduce((s, m) => s + m.wins, 0) : evW);
  const careerLosses = Number(pData.losses ?? totalGames > 0 ? masteryList.reduce((s, m) => s + m.losses, 0) : evL);
  const careerTotal = Math.max(1, careerWins + careerLosses + Number(pData.draws || 0));
  const careerWr = ((careerWins / careerTotal) * 100).toFixed(1);
  const maxStreak = Number(profileData?.longest_win_streak || profileData?.max_streak || 0);

  return `
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.45rem; margin-bottom: 0.65rem;">
      <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 0.45rem 0.6rem;">
        <div style="font-size: 0.65rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Peak Elo 👑</div>
        <div style="font-family: var(--font-mono); font-size: 0.92rem; font-weight: 800; color: #fbbf24;">${peakElo.toFixed(1)}</div>
      </div>
      <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 0.45rem 0.6rem;">
        <div style="font-size: 0.65rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Career Record</div>
        <div style="font-family: var(--font-mono); font-size: 0.86rem; font-weight: 800; color: #fff;">${careerWins}W-${careerLosses}L <span style="color:#4ade80; font-size:0.74rem;">(${careerWr}%)</span></div>
      </div>
      <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 0.45rem 0.6rem;">
        <div style="font-size: 0.65rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Best Streak</div>
        <div style="font-family: var(--font-mono); font-size: 0.88rem; font-weight: 800; color: #fb923c;">🔥 ${maxStreak > 0 ? `${maxStreak} Wins` : `${evW}W Event`}</div>
      </div>
    </div>

    <div style="background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; padding: 0.65rem 0.75rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; margin-bottom: 0.5rem; flex-wrap: wrap;">
        <span style="font-size: 0.74rem; font-weight: 800; text-transform: uppercase; color: ${accentColor}; letter-spacing: 0.04em;">
          🛡️ Faction Mastery (${escapeHtml(activeFacEntry?.faction || curFac)})
        </span>
        <span class="badge" style="background: ${tierBadge.bg}; color: ${tierBadge.col}; border: 1px solid ${tierBadge.border}; font-size: 0.68rem; font-weight: 800; padding: 2px 7px;">
          ${tierBadge.label}
        </span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 0.45rem;">
        ${topArmies.map((fm, idx) => {
          const wr = Number(fm.win_rate || 0).toFixed(1);
          const share = totalGames > 0 ? Math.round((fm.games / totalGames) * 100) : 100;
          const net = Number(fm.net_elo || 0);
          const netStr = (net >= 0 ? '+' : '') + net.toFixed(1);
          const barCol = Number(wr) >= 55 ? '#10b981' : (Number(wr) >= 48 ? accentColor : '#f43f5e');
          return `
            <div style="display: flex; flex-direction: column; gap: 3px;">
              <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.76rem;">
                <span style="font-weight: 700; color: #f8fafc;">
                  ${idx === 0 ? '★ ' : ''}${escapeHtml(fm.faction)}
                  <span style="color: var(--text-muted); font-weight: 500; font-size: 0.7rem;">(${fm.games}G • ${share}% share)</span>
                </span>
                <span style="font-family: var(--font-mono); font-size: 0.75rem;">
                  <strong style="color: ${barCol};">${wr}% WR</strong>
                  <span style="color: var(--text-secondary);">(${fm.wins}W-${fm.losses}L)</span>
                  <span style="color: ${net >= 0 ? '#4ade80' : '#f87171'}; margin-left: 4px;">${netStr} Elo</span>
                </span>
              </div>
              <div style="width: 100%; height: 5px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden;">
                <div style="width: ${Math.min(100, Math.max(4, Number(wr)))}%; height: 100%; background: ${barCol};"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

async function hydrateCasterDossiersAsync(ev, p1, p2, selectedMatch) {
  const sys = (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k');
  const pairs = [
    { side: 'p1', obj: p1, matchPid: selectedMatch?.player1_id, matchName: selectedMatch?.player1_name, matchListId: selectedMatch?.player1_list_id, color: '#38bdf8' },
    { side: 'p2', obj: p2, matchPid: selectedMatch?.player2_id, matchName: selectedMatch?.player2_name, matchListId: selectedMatch?.player2_list_id, color: '#f43f5e' }
  ];

  const p1Pid = String(p1?.player_id || p1?.id || selectedMatch?.player1_id || '').trim();
  const p2Pid = String(p2?.player_id || p2?.id || selectedMatch?.player2_id || '').trim();
  const p1Name = String(p1?.full_name || selectedMatch?.player1_name || 'Player 1').trim();
  const p2Name = String(p2?.full_name || selectedMatch?.player2_name || 'Player 2').trim();
  const curRound = Number(selectedMatch?.round || selectedCasterRound || ev?.current_round || 1);
  const h2hKey = getCasterH2hCacheKey(sys, p1Pid, p2Pid, p1Name, p2Name);

  const applyPastH2hToDom = (apiList) => {
    const evMatches = Array.isArray(ev?.matches) ? ev.matches : (Array.isArray(currentEventData?.matches) ? currentEventData.matches : []);
    const combined = [...(Array.isArray(apiList) ? apiList : []), ...evMatches];
    const pastMatches = filterPastHeadToHeadMatches(combined, ev, selectedMatch, curRound, p1Pid, p2Pid, p1Name, p2Name);
    const rec = computeCasterPastH2hRecord(pastMatches, p1Pid, p2Pid, p1Name, p2Name);

    const summaryEl = document.getElementById('caster-h2h-summary');
    if (summaryEl) {
      summaryEl.innerHTML = `⚔️ <strong>Past Head-to-Head:</strong> ${rec.summaryText}`;
    }
    const cardEl = document.getElementById('caster-past-h2h-container');
    if (cardEl) {
      cardEl.innerHTML = buildCasterPastH2hCardHtml(pastMatches, p1Pid, p2Pid, p1Name, p2Name, false);
    }
  };

  if (window.api && typeof window.api.getHeadToHead === 'function' && (p1Pid || p1Name) && (p2Pid || p2Name)) {
    if (casterHeadToHeadCache[h2hKey]) {
      applyPastH2hToDom(casterHeadToHeadCache[h2hKey]);
    } else {
      window.api.getHeadToHead(p1Pid, p2Pid, p1Name, p2Name, sys).then(list => {
        if (Array.isArray(list)) {
          casterHeadToHeadCache[h2hKey] = list;
          applyPastH2hToDom(list);
        }
      }).catch(() => {
        applyPastH2hToDom([]);
      });
    }
  }

  for (const item of pairs) {
    const pid = String(item.obj?.player_id || item.obj?.id || item.matchPid || '').trim();
    const pname = String(item.obj?.full_name || item.matchName || '').trim();
    const cacheKey = `${sys}:${pid || pname.toLowerCase()}`;

    // 1. Hydrate Career Profile & Faction Mastery
    if (window.api && typeof window.api.getPlayerProfile === 'function' && (pid || pname)) {
      if (casterPlayerProfileCache[cacheKey]) {
        const el = document.getElementById(`caster-dossier-mastery-${item.side}`);
        if (el) el.innerHTML = buildCasterFactionMasteryHtml(item.obj, casterPlayerProfileCache[cacheKey], item.color);
      } else {
        window.api.getPlayerProfile(pid || 'unknown', sys, pname).then(data => {
          if (data && !data.error) {
            casterPlayerProfileCache[cacheKey] = data;
            const el = document.getElementById(`caster-dossier-mastery-${item.side}`);
            if (el) el.innerHTML = buildCasterFactionMasteryHtml(item.obj, data, item.color);
          }
        }).catch(() => {});
      }
    }

    // 2. Hydrate BCP Army Roster Text if listId exists and army_list is not yet loaded
    const listInfo = typeof getPlayerListDetails === 'function' ? getPlayerListDetails(item.obj) : {};
    const targetListId = String(listInfo.listId || item.obj?.list_id || item.obj?.listId || item.matchListId || '').trim();
    const existingText = String(listInfo.text || item.obj?.army_list || item.obj?.army_list_text || '').trim();

    if (!existingText && targetListId && window.api && typeof window.api.getBcpArmyList === 'function') {
      if (casterArmyListCache[targetListId]) {
        const cachedTxt = casterArmyListCache[targetListId];
        if (item.obj) {
          item.obj.army_list = cachedTxt;
          item.obj.army_list_text = cachedTxt;
        }
        updateCasterRosterPreviewDom(item.side, item.obj, cachedTxt, targetListId);
      } else {
        window.api.getBcpArmyList(targetListId).then(res => {
          if (res && res.success && res.text) {
            const trimmed = res.text.trim();
            casterArmyListCache[targetListId] = trimmed;
            if (item.obj) {
              item.obj.army_list = trimmed;
              item.obj.army_list_text = trimmed;
            }
            updateCasterRosterPreviewDom(item.side, item.obj, trimmed, targetListId);
          }
        }).catch(() => {});
      }
    }
  }
}

function updateCasterRosterPreviewDom(side, playerObj, rosterText, listId) {
  const unitsEl = document.getElementById(`caster-dossier-units-${side}`);
  const fighterUnitsEl = document.getElementById(`caster-fighter-units-${side}`);
  const previewEl = document.getElementById(`caster-dossier-roster-preview-${side}`);
  const units = extractKeyListUnits(rosterText, playerObj?.faction);

  if (fighterUnitsEl && units.length > 0) {
    fighterUnitsEl.innerHTML = escapeHtml(units.slice(0, 4).join(', '));
  }
  if (unitsEl && units.length > 0) {
    unitsEl.innerHTML = units.slice(0, 8).map(u => `
      <span class="badge" style="background: rgba(255,255,255,0.07); color: #e2e8f0; border: 1px solid rgba(255,255,255,0.12); font-size: 0.7rem; padding: 2px 7px;">
        ⚔️ ${escapeHtml(u)}
      </span>
    `).join('');
  }
  if (previewEl && rosterText) {
    previewEl.innerHTML = `
      <details style="margin-top: 0.45rem; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 0.45rem 0.65rem;">
        <summary style="cursor: pointer; font-size: 0.74rem; font-weight: 700; color: #38bdf8; user-select: none;">
          📜 Expand Inline Army List Text (${rosterText.split('\n').filter(Boolean).length} lines)
        </summary>
        <pre style="margin: 0.5rem 0 0 0; max-height: 220px; overflow-y: auto; font-family: var(--font-mono); font-size: 0.72rem; color: #cbd5e1; white-space: pre-wrap; line-height: 1.4;">${escapeHtml(rosterText)}</pre>
      </details>
    `;
  }
}

/* ==========================================================================
   MODE 1: CASTER DECK (LIVE DESK & TALE OF THE TAPE)
   ========================================================================== */
function renderCasterDeckMode(ev, players, matches, roundMatches, selectedMatch, p1, p2, p1Elo, p2Elo, p1WinProb, p2WinProb, curRound, matchRounds, totalRounds) {
  let rawJson = (ev && ev.raw_json) || {};
  if (typeof rawJson === 'string') {
    try { rawJson = JSON.parse(rawJson); } catch (e) { rawJson = {}; }
  }
  curRound = curRound || selectedCasterRound || ev.current_round || 1;
  matchRounds = matchRounds || [...new Set(matches.map(m => Number(m.round)).filter(r => r > 0))].sort((a, b) => a - b);
  const resolvedNumRounds = Number(ev.num_rounds || ev.numberOfRounds || ev.rounds_count || ev.rounds || ev.total_rounds || rawJson.numberOfRounds || rawJson.numRounds || 0);
  totalRounds = Math.max(
    Number(totalRounds || 0),
    resolvedNumRounds,
    matchRounds.length > 0 ? Math.max(...matchRounds) : 0,
    Number(ev.current_round || 0),
    1
  );

  const maxR = Math.max(totalRounds, matchRounds.length > 0 ? Math.max(...matchRounds) : 1, 1);
  const roundList = Array.from({ length: maxR }, (_, i) => i + 1);
  const curRoundMeta = getEventRoundMetadata(ev, matches, curRound, maxR);

  const roundButtonsHtml = roundList.map(r => {
    const rMeta = getEventRoundMetadata(ev, matches, r, maxR);
    const isSel = r === curRound;
    const isSpecial = rMeta.isShadowRound || rMeta.isTopCut;
    const activeBorder = isSel ? (isSpecial ? rMeta.badgeColor : '#38bdf8') : (isSpecial ? rMeta.badgeBorder : 'rgba(255,255,255,0.1)');
    const activeBg = isSel ? (isSpecial ? rMeta.badgeBg : 'rgba(56,189,248,0.22)') : (isSpecial ? 'rgba(168,85,247,0.08)' : 'transparent');
    const activeCol = isSel ? '#fff' : (isSpecial ? rMeta.badgeColor : 'var(--text-muted)');
    return `
      <button type="button" onclick="selectCasterMatch(${selectedCasterTable || 1}, ${r})" class="btn-sm" title="${escapeHtml(rMeta.fullLabel)} (${rMeta.matchCount} tables)" style="padding: 3px 9px; font-size: 0.74rem; font-weight: 700; border-radius: 5px; border: 1px solid ${activeBorder}; background: ${activeBg}; color: ${activeCol}; cursor: pointer; white-space: nowrap;">
        ${escapeHtml(rMeta.shortLabel)}
      </button>
    `;
  }).join('');

  // Case A: Real pairings exist for curRound
  if (roundMatches && roundMatches.length > 0 && selectedMatch && p1 && p2) {
    const eventId = ev?.id || currentOpenEventId || currentEventData?.id || '';
    const activeTableNum = Number(selectedMatch?.table_number || selectedMatch?.table || selectedCasterTable || 1);
    const activeMatchId = `BCP-${eventId}-R${curRound}-T${activeTableNum}`;

    const p1Info = resolveEventCompetitorRecord(
      selectedMatch?.player1_id || p1?.player_id || p1?.id || '',
      p1?.full_name || selectedMatch?.player1_name || 'Player 1',
      selectedMatch?.player1_list_id || p1?.list_id || p1?.listId || ''
    );
    const p2Info = resolveEventCompetitorRecord(
      selectedMatch?.player2_id || p2?.player_id || p2?.id || '',
      p2?.full_name || selectedMatch?.player2_name || 'Player 2',
      selectedMatch?.player2_list_id || p2?.list_id || p2?.listId || ''
    );

    const p1Pid = String(p1Info?.pid || p1?.player_id || p1?.id || selectedMatch?.player1_id || '').trim();
    const p2Pid = String(p2Info?.pid || p2?.player_id || p2?.id || selectedMatch?.player2_id || '').trim();
    const p1Name = p1?.full_name || selectedMatch?.player1_name || 'Player 1';
    const p2Name = p2?.full_name || selectedMatch?.player2_name || 'Player 2';
    const p1SafeName = String(p1Name).replace(/'/g, "\\'");
    const p2SafeName = String(p2Name).replace(/'/g, "\\'");
    const p1SafePid = String(p1Pid).replace(/'/g, "\\'");
    const p2SafePid = String(p2Pid).replace(/'/g, "\\'");
    const p1ListId = String(p1Info?.listId || p1?.list_id || p1?.listId || selectedMatch?.player1_list_id || '').trim();
    const p2ListId = String(p2Info?.listId || p2?.list_id || p2?.listId || selectedMatch?.player2_list_id || '').trim();
    const p1SafeListId = p1ListId.replace(/'/g, "\\'");
    const p2SafeListId = p2ListId.replace(/'/g, "\\'");

    const p1ListDetails = typeof getPlayerListDetails === 'function' ? getPlayerListDetails(p1Info?.record || p1) : {};
    const p2ListDetails = typeof getPlayerListDetails === 'function' ? getPlayerListDetails(p2Info?.record || p2) : {};
    const p1RosterText = String(p1ListDetails.text || p1?.army_list || p1?.army_list_text || casterArmyListCache[p1ListId] || '').trim();
    const p2RosterText = String(p2ListDetails.text || p2?.army_list || p2?.army_list_text || casterArmyListCache[p2ListId] || '').trim();
    const p1HasList = Boolean(p1Info?.hasList || p1ListId || p1RosterText || p1?.has_list_submitted);
    const p2HasList = Boolean(p2Info?.hasList || p2ListId || p2RosterText || p2?.has_list_submitted);

    const tableButtons = roundMatches.map(m => {
      const tNum = Number(m.table_number || m.table || 1);
      const isSel = tNum === activeTableNum;
      const p1n = escapeHtml((m.player1_name || 'P1').split(' ')[0]);
      const p2n = escapeHtml((m.player2_name || 'P2').split(' ')[0]);
      const isPod1 = Number(m.pod_num) === 1;
      return `
        <button type="button" onclick="selectCasterMatch(${tNum}, ${curRound})" class="btn-sm" style="padding: 0.4rem 0.75rem; border-radius: 6px; font-size: 0.76rem; font-weight: 700; cursor: pointer; border: 1px solid ${isSel ? 'var(--accent)' : (isPod1 && curRoundMeta.isShadowRound ? 'rgba(168,85,247,0.35)' : 'rgba(255,255,255,0.08)')}; background: ${isSel ? 'rgba(56, 189, 248, 0.15)' : 'rgba(15,23,42,0.6)'}; color: ${isSel ? '#38bdf8' : 'var(--text-secondary)'};">
          Table ${tNum}: ${p1n} vs ${p2n}
        </button>
      `;
    }).join('');

    const p1Units = extractKeyListUnits(p1RosterText || p1?.army_list, p1?.faction);
    const p2Units = extractKeyListUnits(p2RosterText || p2?.army_list, p2?.faction);

    // Dynamic Past Head-to-Head (strictly prior encounters)
    const sysH2h = (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k');
    const h2hKey = getCasterH2hCacheKey(sysH2h, p1Pid, p2Pid, p1Name, p2Name);
    const cachedApiH2h = Array.isArray(casterHeadToHeadCache[h2hKey]) ? casterHeadToHeadCache[h2hKey] : [];
    const isH2hLoading = !Array.isArray(casterHeadToHeadCache[h2hKey]) && Boolean(window.api && typeof window.api.getHeadToHead === 'function');
    const pastH2hMatches = filterPastHeadToHeadMatches([...cachedApiH2h, ...(Array.isArray(matches) ? matches : [])], ev, selectedMatch, curRound, p1Pid, p2Pid, p1Name, p2Name);
    const h2hRec = computeCasterPastH2hRecord(pastH2hMatches, p1Pid, p2Pid, p1Name, p2Name);
    const h2hText = h2hRec.summaryText;

    // Faction matchup stats
    const fac1 = p1?.faction || 'Army';
    const fac2 = p2?.faction || 'Army';
    let facMatchupText = '';
    if (fac1 && fac2 && fac1 !== fac2 && fac1 !== 'Unknown' && fac2 !== 'Unknown') {
      let f1Wins = 0;
      let f2Wins = 0;
      matches.forEach(m => {
        const mf1 = m.player1_faction;
        const mf2 = m.player2_faction;
        if (m.player1_score !== null && m.player2_score !== null && m.player1_score !== undefined && m.player2_score !== undefined) {
          const s1 = Number(m.player1_score);
          const s2 = Number(m.player2_score);
          if (mf1 === fac1 && mf2 === fac2) {
            if (s1 > s2) f1Wins++;
            else if (s2 > s1) f2Wins++;
          } else if (mf1 === fac2 && mf2 === fac1) {
            if (s2 > s1) f1Wins++;
            else if (s1 > s2) f2Wins++;
          }
        }
      });
      const totalFacGames = f1Wins + f2Wins;
      if (totalFacGames > 0) {
        const wr = Math.round((f1Wins / totalFacGames) * 100);
        facMatchupText = `${escapeHtml(fac1)} has a ${wr}% win rate vs ${escapeHtml(fac2)} in this event (${f1Wins}-${f2Wins})`;
      } else {
        facMatchupText = `${escapeHtml(fac1)} vs ${escapeHtml(fac2)} Matchup`;
      }
    } else {
      facMatchupText = `${escapeHtml(fac1)} Mirror Match`;
    }

    // Dynamic Elo stakes
    const expectedP1 = 1 / (1 + Math.pow(10, (p2Elo - p1Elo) / 400));
    const p1GainOnWin = Math.round(32 * (1 - expectedP1));
    const p2GainOnWin = Math.round(32 * expectedP1);

    const hasScore = selectedMatch?.player1_score !== null && selectedMatch?.player1_score !== undefined && selectedMatch?.player2_score !== null && selectedMatch?.player2_score !== undefined;
    const scoreDisplay = hasScore ? `${selectedMatch.player1_score} - ${selectedMatch.player2_score}` : 'Live in Progress';

    // Helper to build each player's Dossier card underneath the Headline Clash
    const buildPlayerDossierCard = (side, playerObj, pid, safePid, pname, safeName, listId, safeListId, hasList, rosterText, units, eloVal, gainOnWin, accentColor, borderAccent) => {
      const sys = (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k');
      const cacheKey = `${sys}:${pid || pname.toLowerCase()}`;
      const cachedProfile = casterPlayerProfileCache[cacheKey] || null;
      const masteryHtml = buildCasterFactionMasteryHtml(playerObj, cachedProfile, accentColor);

      const playerMatches = matches.filter(m => {
        const m1Id = String(m.player1_id || '').trim();
        const m2Id = String(m.player2_id || '').trim();
        const m1Name = String(m.player1_name || '').trim().toLowerCase();
        const m2Name = String(m.player2_name || '').trim().toLowerCase();
        if (pid && (m1Id === pid || m2Id === pid)) return true;
        if (pname && (m1Name === pname.toLowerCase() || m2Name === pname.toLowerCase())) return true;
        return false;
      }).sort((a, b) => Number(a.round || 1) - Number(b.round || 1));

      const pathRowsHtml = playerMatches.map(m => {
        const m1Id = String(m.player1_id || '').trim();
        const m1Name = String(m.player1_name || '').trim().toLowerCase();
        const isP1Side = (pid && m1Id === pid) || (pname && m1Name === pname.toLowerCase());
        const mySc = isP1Side ? m.player1_score : m.player2_score;
        const opSc = isP1Side ? m.player2_score : m.player1_score;
        const opName = isP1Side ? (m.player2_name || 'BYE') : (m.player1_name || 'BYE');
        const opPid = isP1Side ? String(m.player2_id || '').trim() : String(m.player1_id || '').trim();
        const opFac = isP1Side ? (m.player2_faction || '') : (m.player1_faction || '');
        const safeOpName = String(opName).replace(/'/g, "\\'");
        const safeOpPid = String(opPid).replace(/'/g, "\\'");
        const rNum = Number(m.round || 1);
        const tNum = Number(m.table_number || m.table || 1);
        const rMeta = getEventRoundMetadata(ev, matches, rNum, maxR);
        const mId = `BCP-${eventId}-R${rNum}-T${tNum}`;
        const mHasScore = mySc !== null && mySc !== undefined && opSc !== null && opSc !== undefined;
        let resPill = `<span class="badge" style="background:rgba(148,163,184,0.15); color:#94a3b8; font-size:0.66rem;">LIVE</span>`;
        if (m.is_bye || opName === 'BYE') {
          resPill = `<span class="badge badge-win" style="font-size:0.66rem;">BYE</span>`;
        } else if (mHasScore) {
          if (Number(mySc) > Number(opSc)) resPill = `<span class="badge badge-win" style="font-size:0.66rem;">W ${mySc}-${opSc}</span>`;
          else if (Number(mySc) < Number(opSc)) resPill = `<span class="badge badge-loss" style="font-size:0.66rem;">L ${mySc}-${opSc}</span>`;
          else resPill = `<span class="badge badge-draw" style="font-size:0.66rem;">D ${mySc}-${opSc}</span>`;
        }
        return `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; padding: 0.35rem 0.5rem; background: rgba(0,0,0,0.22); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; font-size: 0.75rem;">
            <div style="display: flex; align-items: center; gap: 0.4rem; min-width: 0; flex: 1;">
              <span style="font-family: var(--font-mono); font-weight: 800; color: ${rMeta.isShadowRound || rMeta.isTopCut ? rMeta.badgeColor : '#94a3b8'}; min-width: 28px;" title="${escapeHtml(rMeta.fullLabel)}">R${rNum}${rMeta.isShadowRound ? '🌑' : (rMeta.isTopCut ? '🏆' : '')}</span>
              ${resPill}
              <span style="color: var(--text-muted); font-size: 0.7rem;">vs</span>
              ${(!m.is_bye && opName !== 'BYE') ? `
                <span class="player-link" onclick="event.stopPropagation(); openPlayerModal('${escapeHtml(safeOpPid)}', '${escapeHtml(safeOpName)}')" style="font-weight: 700; color: #e2e8f0; cursor: pointer; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="View ${escapeHtml(opName)} Quick Profile">${escapeHtml(opName)}</span>
              ` : `<span style="color: var(--text-muted);">BYE</span>`}
              ${opFac ? `<span style="color: var(--text-muted); font-size: 0.68rem; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">(${escapeHtml(opFac)})</span>` : ''}
            </div>
            <button type="button" class="btn-xs btn-outline" onclick="event.stopPropagation(); openScorecardModal('${escapeHtml(mId)}')" style="font-size: 0.68rem; padding: 2px 6px; border-radius: 4px; color: #38bdf8; border-color: rgba(56,189,248,0.3); background: rgba(56,189,248,0.06); cursor: pointer; flex-shrink: 0;" title="View Round ${rNum} Table ${tNum} Game Scorecard">
              📄 Scorecard
            </button>
          </div>
        `;
      }).join('');

      return `
        <div style="background: rgba(15, 23, 42, 0.78); border: 1px solid ${borderAccent}; border-radius: 10px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem;">
          <!-- Dossier Header -->
          <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.65rem; flex-wrap: wrap;">
            <div>
              <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
                <span class="player-link" onclick="openPlayerModal('${escapeHtml(safePid)}', '${escapeHtml(safeName)}')" style="font-size: 1.05rem; font-weight: 800; color: #fff; cursor: pointer; text-decoration: underline; text-decoration-color: ${accentColor}; text-underline-offset: 3px;" title="Click to open ${escapeHtml(pname)}'s Quick Profile">
                  👤 ${escapeHtml(pname)}
                </span>
                ${playerObj?.placement ? `<span class="badge" style="background: rgba(255,255,255,0.08); color: #f8fafc; font-size: 0.68rem;">Seed / Rank #${playerObj.placement}</span>` : ''}
              </div>
              <div style="font-size: 0.76rem; color: var(--text-secondary); margin-top: 0.2rem;">
                🛡️ <strong>${escapeHtml(playerObj?.faction || 'Army')}</strong> • <span style="color: ${accentColor}; font-weight: 600;">${escapeHtml(playerObj?.detachment || 'Standard Detachment')}</span>
                ${playerObj?.team ? ` • 👥 ${escapeHtml(playerObj.team)}` : ''}
              </div>
            </div>
            <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
              <button type="button" class="btn-sm btn-outline" onclick="openPlayerModal('${escapeHtml(safePid)}', '${escapeHtml(safeName)}')" style="font-size: 0.72rem; padding: 3px 8px; color: #f8fafc; border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); cursor: pointer; font-weight: 700;">
                👤 Quick Profile
              </button>
              <button type="button" class="btn-sm btn-outline" onclick="openEventPlayerListModal('${escapeHtml(safePid || safeName)}', '${escapeHtml(safeListId)}')" style="font-size: 0.72rem; padding: 3px 8px; color: ${accentColor}; border-color: ${borderAccent}; background: rgba(56,189,248,0.08); cursor: pointer; font-weight: 700;">
                📋 Army Roster
              </button>
            </div>
          </div>

          <!-- Career & Faction Mastery Telemetry (Async Enriched) -->
          <div id="caster-dossier-mastery-${side}">
            ${masteryHtml}
          </div>

          <!-- Submitted Army Roster & Key Tech -->
          <div style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 0.65rem 0.75rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; margin-bottom: 0.45rem; flex-wrap: wrap;">
              <span style="font-size: 0.73rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.04em;">
                📋 Submitted Army Roster & Key Assets
              </span>
              <button type="button" class="btn-xs btn-outline" onclick="openEventPlayerListModal('${escapeHtml(safePid || safeName)}', '${escapeHtml(safeListId)}')" style="font-size: 0.7rem; padding: 2px 8px; border-radius: 4px; color: #38bdf8; border-color: rgba(56,189,248,0.35); background: rgba(56,189,248,0.1); cursor: pointer; font-weight: 700;">
                📋 Open Full List Modal ↗
              </button>
            </div>
            <div id="caster-dossier-units-${side}" style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
              ${units.length > 0 ? units.slice(0, 8).map(u => `
                <span class="badge" style="background: rgba(255,255,255,0.07); color: #e2e8f0; border: 1px solid rgba(255,255,255,0.12); font-size: 0.7rem; padding: 2px 7px;">
                  ⚔️ ${escapeHtml(u)}
                </span>
              `).join('') : `
                <span style="font-size: 0.75rem; color: var(--text-muted);">
                  ${hasList ? 'Click "Open Full List Modal" to inspect complete BCP army roster.' : 'Standard tournament detachment configuration.'}
                </span>
              `}
            </div>
            <div id="caster-dossier-roster-preview-${side}">
              ${rosterText ? `
                <details style="margin-top: 0.45rem; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 0.45rem 0.65rem;">
                  <summary style="cursor: pointer; font-size: 0.74rem; font-weight: 700; color: #38bdf8; user-select: none;">
                    📜 Expand Inline Army List Text (${rosterText.split('\n').filter(Boolean).length} lines)
                  </summary>
                  <pre style="margin: 0.5rem 0 0 0; max-height: 220px; overflow-y: auto; font-family: var(--font-mono); font-size: 0.72rem; color: #cbd5e1; white-space: pre-wrap; line-height: 1.4;">${escapeHtml(rosterText)}</pre>
                </details>
              ` : ''}
            </div>
          </div>

          <!-- Tournament Run & Round-by-Round Scorecards -->
          <div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem;">
              <span style="font-size: 0.73rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.04em;">
                ⚔️ Tournament Path (${playerObj?.event_wins || 0}W-${playerObj?.event_losses || 0}L • ${playerObj?.event_battle_points || 0} Battle Pts)
              </span>
              <span style="font-size: 0.7rem; font-family: var(--font-mono); color: #4ade80;">Win Stakes: +${gainOnWin} Elo</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.3rem; max-height: 210px; overflow-y: auto;">
              ${pathRowsHtml || '<div style="font-size:0.75rem; color:var(--text-muted);">No matches recorded yet.</div>'}
            </div>
          </div>
        </div>
      `;
    };

    return `
      <!-- Match Table Selector Row -->
      <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 0.85rem 1rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.65rem; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <span style="font-size: 0.84rem; font-weight: 700; color: #fff;">
              🎯 Select Featured Broadcast Table (${escapeHtml(curRoundMeta.fullLabel)}):
            </span>
            ${(curRoundMeta.isShadowRound || curRoundMeta.isTopCut) ? `
              <span class="badge" style="background: ${curRoundMeta.badgeBg}; color: ${curRoundMeta.badgeColor}; border: 1px solid ${curRoundMeta.badgeBorder}; font-size: 0.7rem; font-weight: 800; padding: 2px 8px;">
                ${escapeHtml(curRoundMeta.badgeText)}
              </span>
            ` : ''}
          </div>
          <div style="display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;">
            <span style="font-size: 0.76rem; color: var(--text-muted);">Round:</span>
            ${roundButtonsHtml}
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; max-height: 120px; overflow-y: auto;">
          ${tableButtons}
        </div>
      </div>

      <!-- TALE OF THE TAPE FIGHTER CARD -->
      <div style="background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(168, 85, 247, 0.35); border-radius: 12px; padding: 1.25rem; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.65rem; flex-wrap: wrap; gap: 0.5rem;">
          <div style="font-size: 0.95rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <span>⚔️ Table ${activeTableNum} Headline Clash</span>
            <span class="badge" style="background: ${curRoundMeta.badgeBg}; color: ${curRoundMeta.badgeColor}; border: 1px solid ${curRoundMeta.badgeBorder}; font-size: 0.72rem; padding: 2px 8px;">
              ${escapeHtml(curRoundMeta.badgeText)}
            </span>
          </div>
          <div style="display: flex; gap: 0.45rem; flex-wrap: wrap;">
            <button type="button" onclick="openScorecardModal('${escapeHtml(activeMatchId)}')" class="btn-sm btn-outline" style="font-size: 0.75rem; padding: 4px 10px; border-color: rgba(56, 189, 248, 0.45); color: #38bdf8; background: rgba(56, 189, 248, 0.1); cursor: pointer; font-weight: 700;">
              📄 Game Scorecard
            </button>
            <button type="button" onclick="copyObsOverlayUrl('lower_third')" class="btn-sm btn-outline" style="font-size: 0.75rem; padding: 4px 10px; border-color: rgba(168, 85, 247, 0.4); color: #c084fc; cursor: pointer;">
              📺 Copy OBS Lower-Third
            </button>
          </div>
        </div>

        <div class="tale-of-tape-grid">
          <!-- Player 1 Card (Blue/Cyan) -->
          <div class="fighter-card p1">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-size: 0.72rem; font-weight: 700;">PLAYER 1</span>
              <span style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 800; color: #38bdf8;">${p1Elo.toFixed(1)} Elo</span>
            </div>
            <div style="font-size: 1.2rem; font-weight: 800; color: #fff;">
              <span class="player-link" onclick="openPlayerModal('${escapeHtml(p1SafePid)}', '${escapeHtml(p1SafeName)}')" style="cursor: pointer; color: #fff; text-decoration: underline; text-decoration-color: rgba(56,189,248,0.6); text-underline-offset: 3px;" title="Click to view ${escapeHtml(p1Name)}'s Quick Profile">
                ${escapeHtml(p1Name)}
              </span>
            </div>
            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
              <span class="badge" style="background: rgba(255,255,255,0.06); color: #e2e8f0; font-size: 0.74rem;">🛡️ ${escapeHtml(p1?.faction || 'Faction')}</span>
              <span class="badge" style="background: rgba(56,189,248,0.1); color: #7dd3fc; font-size: 0.74rem;">${escapeHtml(p1?.detachment || 'Standard Detachment')}</span>
              ${p1?.team ? `<span class="badge" style="background: rgba(255,255,255,0.04); color: var(--text-muted); font-size: 0.72rem;">👥 ${escapeHtml(p1.team)}</span>` : ''}
            </div>
            <div style="background: rgba(0,0,0,0.25); border-radius: 6px; padding: 0.5rem 0.65rem; font-size: 0.78rem; display: flex; flex-direction: column; gap: 0.25rem;">
              <div><strong>Event Record:</strong> ${p1?.event_wins || 0}W - ${p1?.event_losses || 0}L (${p1?.event_battle_points || 0} pts)</div>
              <div><strong>Core Units:</strong> <span id="caster-fighter-units-p1">${p1Units.length > 0 ? escapeHtml(p1Units.slice(0, 3).join(', ')) : '<span style="color:var(--text-muted);">View Roster for Details</span>'}</span></div>
            </div>
            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.25rem;">
              <button type="button" class="btn-xs btn-outline" onclick="openPlayerModal('${escapeHtml(p1SafePid)}', '${escapeHtml(p1SafeName)}')" style="font-size: 0.72rem; padding: 3px 9px; border-radius: 5px; color: #38bdf8; border-color: rgba(56,189,248,0.35); background: rgba(56,189,248,0.08); cursor: pointer; font-weight: 700;">
                👤 Quick Profile
              </button>
              <button type="button" class="btn-xs btn-outline" onclick="openEventPlayerListModal('${escapeHtml(p1SafePid || p1SafeName)}', '${escapeHtml(p1SafeListId)}')" style="font-size: 0.72rem; padding: 3px 9px; border-radius: 5px; color: #e2e8f0; border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.06); cursor: pointer; font-weight: 700;">
                📋 View Roster
              </button>
            </div>
          </div>

          <!-- Center Win Prob Meter -->
          <div class="win-prob-container">
            <div style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">Win Probability</div>
            <div style="display: flex; justify-content: space-between; width: 100%; font-family: var(--font-mono); font-weight: 800; font-size: 1.15rem;">
              <span style="color: #38bdf8;">${p1WinProb}%</span>
              <span style="color: #f43f5e;">${p2WinProb}%</span>
            </div>
            <div class="win-prob-track">
              <div class="win-prob-fill-p1" style="width: ${p1WinProb}%;"></div>
            </div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.2rem;">
              ${Math.abs(p1Elo - p2Elo).toFixed(1)} Elo Delta
            </div>
            <button type="button" class="btn-xs btn-outline" onclick="openScorecardModal('${escapeHtml(activeMatchId)}')" style="margin-top: 0.45rem; font-size: 0.71rem; padding: 3px 9px; border-radius: 5px; color: #fbbf24; border-color: rgba(245,158,11,0.4); background: rgba(245,158,11,0.1); cursor: pointer; font-weight: 700;">
              📄 View Scorecard
            </button>
          </div>

          <!-- Player 2 Card (Pink/Red) -->
          <div class="fighter-card p2">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 800; color: #f43f5e;">${p2Elo.toFixed(1)} Elo</span>
              <span class="badge" style="background: rgba(244, 63, 94, 0.15); color: #f43f5e; font-size: 0.72rem; font-weight: 700;">PLAYER 2</span>
            </div>
            <div style="font-size: 1.2rem; font-weight: 800; color: #fff; text-align: right;">
              <span class="player-link" onclick="openPlayerModal('${escapeHtml(p2SafePid)}', '${escapeHtml(p2SafeName)}')" style="cursor: pointer; color: #fff; text-decoration: underline; text-decoration-color: rgba(244,63,94,0.6); text-underline-offset: 3px;" title="Click to view ${escapeHtml(p2Name)}'s Quick Profile">
                ${escapeHtml(p2Name)}
              </span>
            </div>
            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; justify-content: flex-end;">
              ${p2?.team ? `<span class="badge" style="background: rgba(255,255,255,0.04); color: var(--text-muted); font-size: 0.72rem;">👥 ${escapeHtml(p2.team)}</span>` : ''}
              <span class="badge" style="background: rgba(244,63,94,0.1); color: #fda4af; font-size: 0.74rem;">${escapeHtml(p2?.detachment || 'Standard Detachment')}</span>
              <span class="badge" style="background: rgba(255,255,255,0.06); color: #e2e8f0; font-size: 0.74rem;">🛡️ ${escapeHtml(p2?.faction || 'Faction')}</span>
            </div>
            <div style="background: rgba(0,0,0,0.25); border-radius: 6px; padding: 0.5rem 0.65rem; font-size: 0.78rem; display: flex; flex-direction: column; gap: 0.25rem;">
              <div style="text-align: right;"><strong>Event Record:</strong> ${p2?.event_wins || 0}W - ${p2?.event_losses || 0}L (${p2?.event_battle_points || 0} pts)</div>
              <div style="text-align: right;"><strong>Core Units:</strong> <span id="caster-fighter-units-p2">${p2Units.length > 0 ? escapeHtml(p2Units.slice(0, 3).join(', ')) : '<span style="color:var(--text-muted);">View Roster for Details</span>'}</span></div>
            </div>
            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; justify-content: flex-end; margin-top: 0.25rem;">
              <button type="button" class="btn-xs btn-outline" onclick="openEventPlayerListModal('${escapeHtml(p2SafePid || p2SafeName)}', '${escapeHtml(p2SafeListId)}')" style="font-size: 0.72rem; padding: 3px 9px; border-radius: 5px; color: #e2e8f0; border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.06); cursor: pointer; font-weight: 700;">
                📋 View Roster
              </button>
              <button type="button" class="btn-xs btn-outline" onclick="openPlayerModal('${escapeHtml(p2SafePid)}', '${escapeHtml(p2SafeName)}')" style="font-size: 0.72rem; padding: 3px 9px; border-radius: 5px; color: #f43f5e; border-color: rgba(244,63,94,0.35); background: rgba(244,63,94,0.08); cursor: pointer; font-weight: 700;">
                👤 Quick Profile
              </button>
            </div>
          </div>
        </div>

        <!-- Matchup Context & History Sub-strip -->
        <div style="margin-top: 1rem; padding-top: 0.85rem; border-top: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-around; flex-wrap: wrap; gap: 0.75rem; font-size: 0.8rem; color: var(--text-secondary);">
          <div id="caster-h2h-summary">⚔️ <strong>Past Head-to-Head:</strong> ${h2hText}</div>
          <div>📊 <strong>Faction Matchup:</strong> ${facMatchupText}</div>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span>🏆 <strong>Table Score:</strong> <span style="font-family:var(--font-mono); font-weight:800; color:#fff;">${scoreDisplay}</span></span>
            <button type="button" class="btn-xs btn-outline" onclick="openScorecardModal('${escapeHtml(activeMatchId)}')" style="font-size: 0.7rem; padding: 2px 7px; border-radius: 4px; color: #38bdf8; border-color: rgba(56,189,248,0.35); cursor: pointer;">
              📄 Scorecard
            </button>
          </div>
        </div>
      </div>

      <!-- PAST HEAD-TO-HEAD ENCOUNTERS CARD -->
      <div id="caster-past-h2h-container">${buildCasterPastH2hCardHtml(pastH2hMatches, p1Pid, p2Pid, p1Name, p2Name, isH2hLoading)}</div>

      <!-- SIDE-BY-SIDE COMMANDER DOSSIERS: FACTION MASTERY, ROSTERS & TOURNAMENT PATH -->
      <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 1.15rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <h4 style="margin: 0; font-size: 0.98rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.45rem;">
              <span>🎖️ Commander Dossiers: Faction Mastery, Army Rosters & Match History</span>
            </h4>
            <div style="font-size: 0.76rem; color: var(--text-secondary); margin-top: 2px;">
              Click either player's name for their full Quick Profile, inspect their submitted army list, or open any round's Game Scorecard.
            </div>
          </div>
          <button type="button" onclick="switchCreatorHubMode('meta')" class="btn-sm btn-outline" style="font-size: 0.74rem; padding: 4px 10px; cursor: pointer; color: #38bdf8; border-color: rgba(56,189,248,0.35);">
            🧬 Force Disposition Power Grid ➔
          </button>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem;">
          ${buildPlayerDossierCard('p1', p1Info?.record || p1, p1Pid, p1SafePid, p1Name, p1SafeName, p1ListId, p1SafeListId, p1HasList, p1RosterText, p1Units, p1Elo, p1GainOnWin, '#38bdf8', 'rgba(56, 189, 248, 0.35)')}
          ${buildPlayerDossierCard('p2', p2Info?.record || p2, p2Pid, p2SafePid, p2Name, p2SafeName, p2ListId, p2SafeListId, p2HasList, p2RosterText, p2Units, p2Elo, p2GainOnWin, '#f43f5e', 'rgba(244, 63, 94, 0.35)')}
        </div>
      </div>
    `;
  }

  // Case B: Ongoing event with pending round
  if (matchRounds.length > 0) {
    const latestRound = matchRounds[matchRounds.length - 1];
    return `
      <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 0.85rem 1rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.65rem; flex-wrap: wrap;">
          <span style="font-size: 0.84rem; font-weight: 700; color: #fff;">
            🎯 Select Featured Broadcast Table (${escapeHtml(curRoundMeta.fullLabel)}):
          </span>
          <div style="display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;">
            <span style="font-size: 0.76rem; color: var(--text-muted);">Round:</span>
            ${roundButtonsHtml}
          </div>
        </div>
      </div>

      <div style="background: rgba(15, 23, 42, 0.8); border: 1px dashed rgba(56, 189, 248, 0.3); border-radius: 12px; padding: 2.5rem 1.5rem; text-align: center;">
        <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">⏳</div>
        <div style="font-size: 1.15rem; font-weight: 800; color: #fff; margin-bottom: 0.35rem;">
          ${escapeHtml(curRoundMeta.fullLabel)} Pairings Pending
        </div>
        <p style="color: var(--text-secondary); font-size: 0.85rem; max-width: 520px; margin: 0 auto 1.25rem; line-height: 1.5;">
          Official pairings for ${escapeHtml(curRoundMeta.fullLabel)} have not yet been posted by event organizers.
          Live matches are available for earlier rounds.
        </p>
        <button type="button" onclick="selectCasterMatch(1, ${latestRound})" class="btn btn-primary" style="font-size: 0.84rem; font-weight: 700; padding: 0.5rem 1.25rem;">
          Jump to Round ${latestRound} Feature Tables ➔
        </button>
      </div>
    `;
  }

  // Case C: Pre-Tournament Briefing & Top Seeds Spotlight (Upcoming event with 0 matches)
  const sortedPlayers = [...players].sort((a, b) => Number(b.current_elo || 1500) - Number(a.current_elo || 1500));
  const topSeeds = sortedPlayers.slice(0, 4);

  const totalElo = sortedPlayers.reduce((sum, p) => sum + Number(p.current_elo || 1500), 0);
  const avgElo = sortedPlayers.length > 0 ? (totalElo / sortedPlayers.length).toFixed(1) : '1500.0';
  const topSeedPlayer = sortedPlayers[0] || {};

  const facCountMap = new Map();
  sortedPlayers.forEach(p => {
    const f = p.faction || 'Other';
    facCountMap.set(f, (facCountMap.get(f) || 0) + 1);
  });
  const topFactions = Array.from(facCountMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);

  const topSeedsCardsHtml = topSeeds.map((p, idx) => {
    const units = extractKeyListUnits(p.army_list, p.faction);
    const elo = Number(p.current_elo || 1500).toFixed(1);
    const pid = String(p.player_id || p.id || '').replace(/'/g, "\\'");
    const pname = String(p.full_name || 'Player').replace(/'/g, "\\'");
    const listId = String(p.list_id || p.listId || '').replace(/'/g, "\\'");
    return `
      <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.85rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem;">
          <div style="display: flex; align-items: center; gap: 0.4rem;">
            <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 800; font-size: 0.72rem;">SEED #${idx + 1}</span>
            <span class="player-link" onclick="openPlayerModal('${escapeHtml(pid)}', '${escapeHtml(pname)}')" style="font-weight: 800; color: #fff; font-size: 0.88rem; cursor: pointer; text-decoration: underline;">${escapeHtml(p.full_name || 'Player')}</span>
          </div>
          <span style="font-family: var(--font-mono); font-weight: 800; color: #38bdf8; font-size: 0.85rem;">${elo} Elo</span>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.35rem;">
          ${escapeHtml(p.faction || 'Army')} • ${escapeHtml(p.detachment || 'Standard Detachment')}
          ${p.team ? ` • <span style="color:var(--text-muted);">${escapeHtml(p.team)}</span>` : ''}
        </div>
        <div style="display: flex; gap: 0.4rem; margin-top: 0.4rem;">
          <button type="button" class="btn-xs btn-outline" onclick="openPlayerModal('${escapeHtml(pid)}', '${escapeHtml(pname)}')" style="font-size: 0.7rem; padding: 2px 7px; color: #38bdf8; border-color: rgba(56,189,248,0.35); cursor: pointer;">👤 Profile</button>
          <button type="button" class="btn-xs btn-outline" onclick="openEventPlayerListModal('${escapeHtml(pid || pname)}', '${escapeHtml(listId)}')" style="font-size: 0.7rem; padding: 2px 7px; color: #e2e8f0; border-color: rgba(255,255,255,0.2); cursor: pointer;">📋 Roster</button>
        </div>
        ${units.length > 0 ? `
          <div style="font-size: 0.72rem; color: var(--text-muted); background: rgba(0,0,0,0.25); padding: 0.35rem 0.5rem; border-radius: 4px; margin-top: 0.4rem;">
            <strong>Submitted Tech:</strong> ${escapeHtml(units.slice(0, 3).join(', '))}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  return `
    <!-- Round Selector Bar (Pre-Event) -->
    <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 0.85rem 1rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.5rem; flex-wrap: wrap;">
        <span style="font-size: 0.84rem; font-weight: 700; color: #fff;">
          🎯 Broadcast Desk Schedule:
        </span>
        <div style="display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;">
          <span style="font-size: 0.76rem; color: var(--text-muted);">Rounds:</span>
          ${roundButtonsHtml}
        </div>
      </div>
      <div style="font-size: 0.8rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.4rem;">
        <span>⏳</span>
        <span>Official Round 1 pairings have not been published by tournament organizers yet. Coverage is in <strong>Pre-Event Briefing</strong> mode.</span>
      </div>
    </div>

    <!-- PRE-TOURNAMENT CASTER BRIEFING HERO -->
    <div style="background: linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.85)); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 12px; padding: 1.25rem; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.65rem; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <div style="font-size: 1.05rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.5rem;">
            <span>🎙️ Pre-Event Caster Briefing & Top Seeds Spotlight</span>
            <span class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; font-size: 0.72rem; padding: 2px 7px;">${players.length} Competitors</span>
          </div>
          <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.2rem;">
            Field preview, top podium favorites, and roster breakdown.
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button type="button" onclick="switchCreatorHubMode('meta')" class="btn-sm btn-outline" style="font-size: 0.75rem; padding: 4px 10px; color: #38bdf8; border-color: rgba(56,189,248,0.3); cursor: pointer;">
            🧬 Deep Meta Breakdown ➔
          </button>
        </div>
      </div>

      <!-- Field KPI Stats -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; margin-bottom: 1.25rem;">
        <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 0.75rem 1rem; border: 1px solid rgba(255,255,255,0.06);">
          <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Top Seed (#1)</div>
          <div style="font-size: 1.05rem; font-weight: 800; color: #fff; margin-top: 2px;">${escapeHtml(topSeedPlayer.full_name || 'TBD')}</div>
          <div style="font-size: 0.72rem; color: #38bdf8; font-family: var(--font-mono);">${Number(topSeedPlayer.current_elo || 1500).toFixed(1)} Elo</div>
        </div>
        <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 0.75rem 1rem; border: 1px solid rgba(255,255,255,0.06);">
          <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Average Field Elo</div>
          <div style="font-size: 1.05rem; font-weight: 800; color: #fff; margin-top: 2px;">${avgElo}</div>
          <div style="font-size: 0.72rem; color: var(--text-secondary);">${players.length} Total Registered</div>
        </div>
        <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 0.75rem 1rem; border: 1px solid rgba(255,255,255,0.06);">
          <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Top Factions</div>
          <div style="font-size: 0.85rem; font-weight: 700; color: #fff; margin-top: 2px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
            ${topFactions.map(([fac, count]) => `${escapeHtml(fac)} (${count})`).join(', ') || 'Varied'}
          </div>
          <div style="font-size: 0.72rem; color: var(--text-secondary);">${facCountMap.size} Unique Factions</div>
        </div>
      </div>

      <!-- Top Seeds Spotlight Grid -->
      <div style="margin-bottom: 0.5rem;">
        <div style="font-size: 0.85rem; font-weight: 800; color: #fff; margin-bottom: 0.6rem; display: flex; align-items: center; gap: 0.4rem;">
          <span>🌟 Top Seeded Contenders</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0.75rem;">
          ${topSeedsCardsHtml}
        </div>
      </div>
    </div>
  `;
}

/* ==========================================================================
   MODE 2: LIVE STREAM & OBS STUDIO (LIVESTREAM LINKS & OVERLAYS)
   ========================================================================== */
function renderStreamStudioMode(ev, players, matches, selectedMatch, p1, p2, p1Elo, p2Elo, curRound) {
  curRound = curRound || selectedCasterRound || ev.current_round || 1;
  const activeStream = eventLiveStreams[creatorActiveStreamIndex] || eventLiveStreams[0];

  const playersCount = Number(ev.players_count || ev.registered_players_count || (players ? players.length : 0)) || 0;
  const matchTables = Array.from(new Set((matches || []).map(m => Number(m.table_number || m.table)).filter(n => !isNaN(n) && n > 0))).sort((a, b) => a - b);
  const maxMatchTable = matchTables.length > 0 ? Math.max(...matchTables) : 0;
  const estTablesFromPlayers = Math.ceil(playersCount / 2);
  const totalTables = Math.max(maxMatchTable, estTablesFromPlayers, 8);

  const curRoundMatches = (matches || []).filter(m => Number(m.round || 1) === Number(curRound));
  const curRoundTableMap = new Map();
  curRoundMatches.forEach(m => {
    const t = Number(m.table_number || m.table);
    if (t) curRoundTableMap.set(t, m);
  });

  const curTable = (selectedCasterTable !== undefined && selectedCasterTable !== null && !isNaN(Number(selectedCasterTable))) ? Number(selectedCasterTable) : 1;
  const isCustomTable = curTable > totalTables;

  const tableOptions = [];
  const t1Match = curRoundTableMap.get(1);
  const t1Desc = t1Match ? ` — ${escapeHtml((t1Match.player1_name || 'P1').split(' ')[0])} vs ${escapeHtml((t1Match.player2_name || 'P2').split(' ')[0])}` : '';
  tableOptions.push(`<option value="1" ${curTable === 1 ? 'selected' : ''}>Table 1 (Feature Table)${t1Desc}</option>`);

  for (let t = 2; t <= totalTables; t++) {
    const tm = curRoundTableMap.get(t);
    const mDesc = tm ? ` — ${escapeHtml((tm.player1_name || 'P1').split(' ')[0])} vs ${escapeHtml((tm.player2_name || 'P2').split(' ')[0])}` : '';
    tableOptions.push(`<option value="${t}" ${curTable === t ? 'selected' : ''}>Table ${t}${mDesc}</option>`);
  }
  tableOptions.push(`<option value="0" ${curTable === 0 ? 'selected' : ''}>All Tables / Main Desk (General Coverage)</option>`);
  tableOptions.push(`<option value="custom" ${isCustomTable ? 'selected' : ''}>✏️ Enter Custom Table #...</option>`);

  const streamListHtml = eventLiveStreams.map((s, idx) => {
    const isAct = idx === creatorActiveStreamIndex;
    const isMainDesk = Number(s.tableNumber) === 0;
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.65rem 0.85rem; background: ${isAct ? 'rgba(168, 85, 247, 0.15)' : 'rgba(15, 23, 42, 0.6)'}; border: 1px solid ${isAct ? 'rgba(168, 85, 247, 0.4)' : 'rgba(255,255,255,0.06)'}; border-radius: 8px;">
        <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0; flex: 1;">
          <span style="font-size: 1.2rem;">${s.platform === 'twitch' ? '🟣' : '🔴'}</span>
          <div style="min-width: 0; flex: 1;">
            <div style="font-weight: 700; color: #fff; font-size: 0.84rem; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
              ${escapeHtml(s.channel)} <span style="color: var(--text-muted); font-size: 0.74rem;">(${isMainDesk ? 'Main Desk' : `Table ${s.tableNumber}`})</span>
            </div>
            <div style="font-size: 0.72rem; color: var(--text-secondary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
              ${escapeHtml(s.title)}
            </div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0;">
          <button type="button" onclick="selectActiveStream(${idx})" class="btn-sm ${isAct ? 'btn-primary' : 'btn-outline'}" style="font-size: 0.72rem; padding: 3px 8px; cursor: pointer;">
            ${isAct ? '✓ Previewing' : 'Switch'}
          </button>
          <a href="${escapeHtml(s.streamUrl)}" target="_blank" rel="noopener noreferrer" class="btn-sm btn-outline" style="font-size: 0.72rem; padding: 3px 8px; color: #38bdf8; text-decoration: none;">
            Watch ↗
          </a>
          <button type="button" onclick="removeCreatorLiveStream(${idx})" class="btn-sm" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 0.85rem; padding: 2px 5px;" title="Remove stream">
            ✕
          </button>
        </div>
      </div>
    `;
  }).join('');

  const overlayData = resolveStreamTableMatchData(ev, players, matches, curTable, curRound);
  const monitorTableNum = activeStream ? Number(activeStream.tableNumber) : curTable;
  const monitorTableStr = monitorTableNum === 0 ? 'Main Desk / All Tables' : `Table ${monitorTableNum || 1}`;

  return `
    <!-- Stream Control Header & Active Channels -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;" class="stream-layout-grid">
      <!-- Left Column: Add Stream Link & Active Channels -->
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <!-- Add New Livestream Form -->
        <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 1.15rem;">
          <h4 style="margin: 0 0 0.65rem 0; font-size: 0.95rem; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 0.45rem;">
            <span>🔗 Link Your Live Stream</span>
          </h4>
          <p style="font-size: 0.78rem; color: var(--text-secondary); margin: 0 0 0.85rem 0; line-height: 1.4;">
            Add your YouTube Live or Twitch stream to feature your broadcast directly on the tournament hub and allow players to watch your commentary.
          </p>
          <form onsubmit="addCreatorLiveStream(event)" style="display: flex; flex-direction: column; gap: 0.65rem;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
              <div>
                <label style="display: block; font-size: 0.72rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.2rem;">Channel Name</label>
                <input type="text" id="new-stream-channel" required placeholder="e.g. Broadcast Channel" class="search-input" style="width: 100%; box-sizing: border-box; height: 34px; padding: 0.35rem 0.6rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: #fff; font-size: 0.8rem;" />
              </div>
              <div>
                <label style="display: block; font-size: 0.72rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.2rem;">Platform</label>
                <select id="new-stream-platform" style="width: 100%; box-sizing: border-box; height: 34px; padding: 0.35rem 0.6rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: #fff; font-size: 0.8rem; cursor: pointer;">
                  <option value="youtube">YouTube Live</option>
                  <option value="twitch">Twitch</option>
                  <option value="kick">Kick</option>
                  <option value="custom">Custom RTMP / Other</option>
                </select>
              </div>
            </div>
            <div>
              <label style="display: block; font-size: 0.72rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.2rem;">Live Stream URL</label>
              <input type="url" id="new-stream-url" required placeholder="https://youtube.com/watch?v=... or https://twitch.tv/..." class="search-input" style="width: 100%; box-sizing: border-box; height: 34px; padding: 0.35rem 0.6rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: #fff; font-size: 0.8rem;" />
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                <label style="font-size: 0.72rem; color: var(--text-muted); white-space: nowrap;">Assigned Table:</label>
                <select id="new-stream-table" onchange="handleStreamTableSelectChange(this.value)" style="height: 32px; max-width: 230px; padding: 0 0.5rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: #fff; font-size: 0.78rem; cursor: pointer;">
                  ${tableOptions.join('')}
                </select>
                <input type="number" id="new-stream-custom-table" oninput="handleCustomStreamTableInput(this.value)" value="${isCustomTable ? curTable : ''}" min="0" max="9999" placeholder="Table #" style="display: ${isCustomTable ? 'inline-block' : 'none'}; width: 85px; height: 32px; box-sizing: border-box; padding: 0 0.5rem; background: var(--bg-card); border: 1px solid #a855f7; border-radius: 6px; color: #fff; font-size: 0.78rem;" />
              </div>
              <button type="submit" class="btn btn-primary" style="font-size: 0.78rem; font-weight: 700; padding: 0.4rem 1rem; background: #a855f7; border-color: #9333ea; color: #fff; cursor: pointer;">
                + Link Stream
              </button>
            </div>
          </form>
        </div>

        <!-- Active Channels List -->
        <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 1.15rem;">
          <h4 style="margin: 0 0 0.75rem 0; font-size: 0.95rem; font-weight: 700; color: #fff; display: flex; align-items: center; justify-content: space-between;">
            <span>📡 Configured Broadcasters</span>
            <span class="badge" style="font-size: 0.72rem; background: rgba(16, 185, 129, 0.15); color: #34d399;">${eventLiveStreams.length} Connected</span>
          </h4>
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            ${streamListHtml || '<div style="color:var(--text-muted); font-size:0.8rem;">No streams linked yet.</div>'}
          </div>
        </div>
      </div>

      <!-- Right Column: Live Video Player Preview & OBS Overlay Tools -->
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <!-- Live Stream Preview Window -->
        <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 1.15rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.65rem;">
            <div style="font-weight: 700; color: #fff; font-size: 0.92rem; display: flex; align-items: center; gap: 0.45rem;">
              <span>🔴 Live Broadcast Monitor</span>
              <span class="badge" style="background: #ef4444; color: #fff; font-size: 0.65rem; padding: 2px 6px;">ON AIR</span>
            </div>
            <span id="live-monitor-table-label" style="font-size: 0.74rem; color: var(--text-muted);">
              ${escapeHtml(activeStream?.channel || 'Stream')} • ${monitorTableStr}
            </span>
          </div>

          <!-- Video Embed Frame -->
          <div style="position: relative; width: 100%; padding-top: 56.25%; background: #000; border-radius: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
            <iframe 
              src="${escapeHtml(activeStream?.embedUrl || 'https://www.youtube-nocookie.com/embed/jfKfPfyJRdk')}" 
              title="Live Stream Preview"
              style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none;" 
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
              allowfullscreen>
            </iframe>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 0.65rem; font-size: 0.75rem; color: var(--text-muted);">
            <span>👁️ ~${activeStream?.viewers || 1200} concurrent viewers</span>
            <a href="${escapeHtml(activeStream?.streamUrl || '#')}" target="_blank" rel="noopener noreferrer" style="color: #38bdf8; text-decoration: none; font-weight: 600;">
              Open Stream Page ↗
            </a>
          </div>
        </div>

        <!-- OBS Studio Overlays Generator -->
        <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 10px; padding: 1.15rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.65rem;">
            <div style="font-weight: 700; color: #fff; font-size: 0.92rem; display: flex; align-items: center; gap: 0.4rem;">
              <span>📺 OBS Studio Browser Source Overlays</span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
              <label for="obs-overlay-table-select" style="font-size: 0.7rem; color: var(--text-muted); font-weight: 600;">Table:</label>
              <select id="obs-overlay-table-select" onchange="handleObsOverlayTableChange(this.value)" style="height: 28px; max-width: 195px; padding: 0 0.45rem; background: var(--bg-card); border: 1px solid rgba(168, 85, 247, 0.45); border-radius: 6px; color: #fff; font-size: 0.74rem; cursor: pointer;">
                ${tableOptions.join('')}
              </select>
              <span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; font-size: 0.7rem;">TRANSPARENT HUD</span>
            </div>
          </div>
          <p style="font-size: 0.78rem; color: var(--text-secondary); margin: 0 0 0.85rem 0; line-height: 1.4;">
            Paste these URLs directly into OBS as a Browser Source (Width: 1920, Height: 250) for auto-updating live scoreboards!
          </p>

          <!-- Interactive OBS Overlay Preview Strip -->
          <div id="obs-overlay-preview-container" style="background: rgba(0, 0, 0, 0.7); border: 1px dashed rgba(56, 189, 248, 0.5); border-radius: 8px; padding: 0.75rem; margin-bottom: 0.85rem;">
            ${buildObsOverlayPreviewStripHtml(overlayData)}
          </div>

          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button type="button" onclick="copyObsOverlayUrl('lower_third')" class="btn btn-primary" style="flex: 1; min-width: 140px; font-size: 0.78rem; font-weight: 700; padding: 0.45rem 0.85rem; background: linear-gradient(135deg, #0284c7, #2563eb); border: none; cursor: pointer;">
              📋 Copy Lower-Third HUD URL
            </button>
            <button type="button" onclick="copyObsOverlayUrl('tale_of_tape')" class="btn btn-outline" style="flex: 1; min-width: 140px; font-size: 0.78rem; font-weight: 700; padding: 0.45rem 0.85rem; color: #c084fc; border-color: rgba(168, 85, 247, 0.4); cursor: pointer;">
              📋 Copy Matchup Card URL
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* ==========================================================================
   MODE 3: STORYLINES & UPSET RADAR
   ========================================================================== */
function renderStorylinesMode(ev, players, matches) {
  // Rank tournament upsets by Elo gap
  const upsets = [];
  matches.forEach(m => {
    if (m.is_bye || m.is_draw) return;
    const hasScores = m.player1_score !== null && m.player1_score !== undefined && m.player2_score !== null && m.player2_score !== undefined;
    const p1Score = Number(m.player1_score || 0);
    const p2Score = Number(m.player2_score || 0);
    let p1Won = false;
    let p2Won = false;
    if (m.winner_id) {
      p1Won = String(m.winner_id) === String(m.player1_id);
      p2Won = String(m.winner_id) === String(m.player2_id);
    } else if (hasScores) {
      p1Won = p1Score > p2Score;
      p2Won = p2Score > p1Score;
    }
    if (!p1Won && !p2Won) return;

    const wName = p1Won ? m.player1_name : m.player2_name;
    const lName = p1Won ? m.player2_name : m.player1_name;
    const wFac = p1Won ? (m.player1_faction || 'Army') : (m.player2_faction || 'Army');
    const lFac = p1Won ? (m.player2_faction || 'Army') : (m.player1_faction || 'Army');
    const wElo = p1Won ? Number(m.player1_elo || 1500) : Number(m.player2_elo || 1500);
    const lElo = p1Won ? Number(m.player2_elo || 1500) : Number(m.player1_elo || 1500);
    const gap = lElo - wElo;
    if (gap >= 25) {
      upsets.push({
        winnerName: wName || 'Winner',
        loserName: lName || 'Loser',
        winnerFaction: wFac,
        loserFaction: lFac,
        winnerElo: wElo,
        loserElo: lElo,
        gap: gap,
        round: m.round || 1,
        table: m.table_number || m.table || 1,
        score: hasScores ? `${m.player1_score} - ${m.player2_score}` : 'Match Won'
      });
    }
  });

  upsets.sort((a, b) => b.gap - a.gap);
  const topUpset = upsets.length > 0 ? upsets[0] : null;

  // Undefeated players analysis with real Opponent SoS
  const undefeated = players.filter(p => Number(p.event_losses || 0) === 0 && Number(p.event_wins || 0) >= 1);
  const undefeatedWithSos = undefeated.map(p => {
    const pId = String(p.player_id || p.id || '');
    const pMatches = matches.filter(m => {
      const isP1 = String(m.player1_id || '') === pId || m.player1_name === p.full_name;
      const isP2 = String(m.player2_id || '') === pId || m.player2_name === p.full_name;
      return (isP1 || isP2) && !m.is_bye;
    });
    const oppDetails = [];
    pMatches.forEach(m => {
      const isP1 = String(m.player1_id || '') === pId || m.player1_name === p.full_name;
      const oppName = isP1 ? m.player2_name : m.player1_name;
      const oppElo = Number((isP1 ? m.player2_elo : m.player1_elo) || 1500);
      if (oppName) {
        oppDetails.push({ name: oppName, elo: oppElo });
      }
    });
    const avgSos = oppDetails.length > 0
      ? (oppDetails.reduce((sum, o) => sum + o.elo, 0) / oppDetails.length)
      : Number(p.current_elo || 1500);
    return {
      ...p,
      opponents: oppDetails,
      avgSos: avgSos
    };
  }).sort((a, b) => b.avgSos - a.avgSos);

  // Spotlight Banner HTML
  let spotlightHtml = '';
  if (topUpset) {
    spotlightHtml = `
      <div style="background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(168, 85, 247, 0.15)); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 12px; padding: 1.25rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
          <span class="badge" style="background: #ef4444; color: #fff; font-weight: 800; font-size: 0.72rem; padding: 3px 8px;">
            🔥 #1 TOURNAMENT GIANT KILLER
          </span>
          <span style="font-family: var(--font-mono); font-weight: 800; font-size: 1rem; color: #ef4444;">
            +${topUpset.gap.toFixed(1)} Elo Upset Gap
          </span>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
          <div>
            <div style="font-size: 1.25rem; font-weight: 800; color: #fff;">
              ${escapeHtml(topUpset.winnerName)} <span style="font-size: 0.95rem; color: var(--text-muted);">(${escapeHtml(topUpset.winnerFaction)})</span>
            </div>
            <div style="font-size: 0.84rem; color: var(--text-secondary); margin-top: 0.2rem;">
              Toppled top seed <strong>${escapeHtml(topUpset.loserName)}</strong> (${escapeHtml(topUpset.loserFaction)}) in Round ${topUpset.round} (Table ${topUpset.table})
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 1.4rem; font-weight: 900; color: #38bdf8; font-family: var(--font-mono);">${topUpset.score}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">Final Battle Score</div>
          </div>
        </div>
      </div>
    `;
  } else {
    spotlightHtml = `
      <div style="background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 12px; padding: 1.25rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
          <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 800; font-size: 0.72rem; padding: 3px 8px;">
            🛡️ TOURNAMENT STABILITY REPORT
          </span>
          <span style="font-size: 0.8rem; color: #94a3b8;">
            Favorites Defending Tables
          </span>
        </div>
        <div style="font-size: 1.05rem; font-weight: 800; color: #fff;">
          Chalk Seeding Holding Across Field
        </div>
        <div style="font-size: 0.82rem; color: var(--text-secondary); margin-top: 0.25rem;">
          No major Elo upsets (+25 gap) have occurred in completed rounds yet. Top seeded players are maintaining undefeated records.
        </div>
      </div>
    `;
  }

  let topHeroHtml = '';
  if (topUpset) {
    topHeroHtml = `
      <div style="background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(168, 85, 247, 0.15)); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 12px; padding: 1.25rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
          <span class="badge" style="background: #ef4444; color: #fff; font-weight: 800; font-size: 0.72rem; padding: 3px 8px;">
            🔥 #1 TOURNAMENT GIANT KILLER
          </span>
          <span style="font-family: var(--font-mono); font-weight: 800; font-size: 1rem; color: #ef4444;">
            +${topUpset.gap.toFixed(1)} Elo Upset Gap
          </span>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
          <div>
            <div style="font-size: 1.25rem; font-weight: 800; color: #fff;">
              ${escapeHtml(topUpset.winnerName)} <span style="font-size: 0.95rem; color: var(--text-muted);">(${escapeHtml(topUpset.winnerFaction)})</span>
            </div>
            <div style="font-size: 0.84rem; color: var(--text-secondary); margin-top: 0.2rem;">
              Toppled top seed <strong>${escapeHtml(topUpset.loserName)}</strong> (${escapeHtml(topUpset.loserFaction)}) in Round ${topUpset.round} (Table ${topUpset.table})
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 1.4rem; font-weight: 900; color: #38bdf8; font-family: var(--font-mono);">${topUpset.score}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">Final Battle Score</div>
          </div>
        </div>
      </div>
    `;
  } else {
    topHeroHtml = `
      <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 1.25rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
        <div>
          <div style="font-size: 1.05rem; font-weight: 800; color: #fff;">🛡️ Top Seeds Holding Position</div>
          <div style="font-size: 0.82rem; color: var(--text-secondary); margin-top: 0.25rem;">
            ${matches.length === 0 ? 'No tournament matches played yet. Upsets will be tracked automatically as scores are submitted.' : 'All higher-Elo favorites have held form with 0 major upsets recorded so far.'}
          </div>
        </div>
        <div class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-size: 0.75rem; padding: 4px 10px;">
          ${matches.length} Matches Logged
        </div>
      </div>
    `;
  }

  return `
    ${spotlightHtml}

    <!-- 2-Column Grid: Upset Leaderboard & Undefeated Gauntlet -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;" class="storylines-grid">
      <!-- Upset Leaderboard -->
      <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 1.15rem;">
        <h4 style="margin: 0 0 0.75rem 0; font-size: 0.95rem; font-weight: 700; color: #fff; display: flex; align-items: center; justify-content: space-between;">
          <span>🚨 Giant Slayer Leaderboard</span>
          <span class="badge" style="font-size: 0.7rem; background: rgba(239, 68, 68, 0.15); color: #f87171;">${upsets.length} Upsets</span>
        </h4>
        <div class="table-container" style="max-height: 280px; overflow-y: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">
            <thead>
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); text-align: left;">
                <th style="padding: 0.4rem 0.5rem;">Underdog</th>
                <th style="padding: 0.4rem 0.5rem;">Favorite Defeated</th>
                <th style="padding: 0.4rem 0.5rem; text-align: right;">Elo Gap</th>
              </tr>
            </thead>
            <tbody>
              ${upsets.length > 0 ? upsets.map(u => `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                  <td style="padding: 0.5rem;">
                    <div style="font-weight: 700; color: #fff;">${escapeHtml(u.winnerName)}</div>
                    <div style="font-size: 0.7rem; color: var(--text-muted);">${escapeHtml(u.winnerFaction)}</div>
                  </td>
                  <td style="padding: 0.5rem;">
                    <div style="color: #e2e8f0;">${escapeHtml(u.loserName)}</div>
                    <div style="font-size: 0.7rem; color: var(--text-muted);">${escapeHtml(u.loserFaction)} • R${u.round}</div>
                  </td>
                  <td style="padding: 0.5rem; text-align: right; font-family: var(--font-mono); font-weight: 700; color: #ef4444;">
                    +${u.gap.toFixed(0)}
                  </td>
                </tr>
              `).join('') : `
                <tr>
                  <td colspan="3" style="text-align: center; color: var(--text-muted); padding: 1.5rem 0.5rem;">
                    No major upsets recorded in completed rounds yet.
                  </td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Undefeated Gauntlet (Strength of Schedule) -->
      <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 1.15rem;">
        <h4 style="margin: 0 0 0.75rem 0; font-size: 0.95rem; font-weight: 700; color: #fff; display: flex; align-items: center; justify-content: space-between;">
          <span>🛡️ The Undefeated Gauntlet (Strength of Schedule)</span>
          <span class="badge" style="font-size: 0.7rem; background: rgba(16, 185, 129, 0.15); color: #34d399;">${undefeatedWithSos.length} Undefeated</span>
        </h4>
        <div style="display: flex; flex-direction: column; gap: 0.75rem; max-height: 280px; overflow-y: auto;">
          ${undefeatedWithSos.length > 0 ? undefeatedWithSos.map(u => `
            <div style="background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 8px; padding: 0.85rem;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem;">
                <span style="font-weight: 800; color: #fff; font-size: 0.9rem;">${escapeHtml(u.full_name)}</span>
                <span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #34d399; font-weight: 700; font-size: 0.72rem;">${u.event_wins}-0 UNDEFEATED</span>
              </div>
              <div style="font-size: 0.76rem; color: var(--text-secondary); margin-bottom: 0.4rem;">
                ${escapeHtml(u.faction)} • ${escapeHtml(u.detachment || 'Core')}
              </div>
              <div style="font-size: 0.76rem; background: rgba(0,0,0,0.25); padding: 0.4rem 0.6rem; border-radius: 6px; color: #38bdf8;">
                <strong>Opponent SoS:</strong> Avg Elo <strong>${u.avgSos.toFixed(1)}</strong> 
                ${u.opponents.length > 0 ? `<span style="color: var(--text-muted); font-size: 0.7rem;">(faced: ${escapeHtml(u.opponents.map(o => o.name.split(' ')[0]).join(', '))})</span>` : ''}
              </div>
            </div>
          `).join('') : `
            <div style="background: rgba(15, 23, 42, 0.6); border-radius: 8px; padding: 1.25rem; text-align: center; color: var(--text-muted); font-size: 0.82rem;">
              No undefeated players remaining — high field parity across all tables!
            </div>
          `}
          <div style="background: rgba(15, 23, 42, 0.6); border-radius: 8px; padding: 0.75rem; font-size: 0.78rem; color: var(--text-muted); line-height: 1.4;">
            💡 <strong>Commentary Note:</strong> Players surviving an SoS > 2000 in early rounds hold a distinct edge in tiebreak battle points and top cut seeding.
          </div>
        </div>
      </div>
    </div>
  `;
}

var powerGridState = {
  groupBy: 'disposition', // 'disposition' | 'faction' | 'combo'
  dispositionFilter: 'All',
  factionFilter: 'All',
  minReps: 1,
  sortBy: 'win_rate_desc', // 'win_rate_desc' | 'win_rate_asc' | 'reps_desc' | 'wins_desc' | 'avg_pts_desc'
  search: '',
  expandedKeys: new Set(),
  expandAll: false
};
if (typeof window !== 'undefined') {
  window.__powerGridState = powerGridState;
}

const CANONICAL_FORCE_DISPOSITIONS = [
  { key: 'Take and Hold', label: 'Take and Hold', icon: '🛡️', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.14)', border: 'rgba(56, 189, 248, 0.38)' },
  { key: 'Priority Assets', label: 'Priority Assets', icon: '🎯', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.14)', border: 'rgba(245, 158, 11, 0.38)' },
  { key: 'Purge the Foe', label: 'Purge the Foe', icon: '💀', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.14)', border: 'rgba(239, 68, 68, 0.38)' },
  { key: 'Reconnaissance', label: 'Reconnaissance', icon: '🦅', color: '#10b981', bg: 'rgba(16, 185, 129, 0.14)', border: 'rgba(16, 185, 129, 0.38)' },
  { key: 'Disruption', label: 'Disruption', icon: '⚡', color: '#c084fc', bg: 'rgba(168, 85, 247, 0.14)', border: 'rgba(168, 85, 247, 0.38)' }
];

const DETACHMENT_DISPOSITION_LOOKUP = {
  // Space Marines & Chapters
  'assault brethren': 'Take and Hold',
  'blade of ultramar': ['Take and Hold', 'Priority Assets'],
  'ceramite sentinels': 'Take and Hold',
  'deathwatch support': 'Disruption',
  'devastator brethren': 'Purge the Foe',
  'forgefather’s seekers': 'Priority Assets',
  "forgefather's seekers": 'Priority Assets',
  'gauntlet task force': 'Reconnaissance',
  'gladius task force': ['Take and Hold', 'Priority Assets'],
  'gravis linebreaker force': 'Take and Hold',
  'gravis siege force': 'Take and Hold',
  'ironclad champions': 'Priority Assets',
  'ironstorm spearhead': 'Purge the Foe',
  "medusa's wrath": 'Purge the Foe',
  'medusa’s wrath': 'Purge the Foe',
  'phobos shadow force': 'Disruption',
  'phobos shock force': 'Disruption',
  'shadowmark talon': 'Disruption',
  'spearpoint task force': 'Reconnaissance',
  'stormlance task force': 'Reconnaissance',
  'tactical brethren': 'Priority Assets',
  'tacticus attack force': 'Take and Hold',
  'tacticus firestorm force': 'Priority Assets',
  'terminator storm force': 'Priority Assets',
  'darkflight pursuit': 'Reconnaissance',
  'inner circle task force': 'Priority Assets',
  'wrath of the rock': 'Take and Hold',
  'angelic inheritors': ['Priority Assets', 'Purge the Foe'],
  'encarmine speartip': 'Disruption',
  'wrath of the doomed': 'Purge the Foe',
  'champions of fenris': 'Priority Assets',
  'saga of the beastslayer': 'Purge the Foe',
  'saga of the great wolf': 'Take and Hold',
  'fist of the god-emperor': 'Take and Hold',
  "marshal's household": 'Priority Assets',
  'marshal’s household': 'Priority Assets',
  'vow-sworn crusaders': 'Purge the Foe',
  'black spear task force': ['Priority Assets', 'Purge the Foe'],
  // Grey Knights
  'argent assault': 'Priority Assets',
  'augurium task force': 'Reconnaissance',
  'banishers': 'Disruption',
  'brotherhood strike': 'Purge the Foe',
  'fires of purgation': 'Disruption',
  'hallowed conclave': 'Take and Hold',
  'immaterial interdiction': 'Reconnaissance',
  'sanctic spearhead': 'Priority Assets',
  'warpbane task force': ['Take and Hold', 'Purge the Foe'],
  // Astra Militarum
  'abhuman auxiliaries': 'Take and Hold',
  'armoured infantry': 'Take and Hold',
  'bridgehead strike': 'Priority Assets',
  'combined arms': 'Take and Hold',
  'designation force': 'Reconnaissance',
  'grizzled company': ['Priority Assets', 'Purge the Foe'],
  'hammer of the emperor': 'Purge the Foe',
  'mechanised assault': 'Reconnaissance',
  'recon element': 'Reconnaissance',
  'siege regiment': 'Disruption',
  'steel hammer': 'Purge the Foe',
  // Adepta Sororitas
  'army of faith': 'Take and Hold',
  'bringers of flame': 'Priority Assets',
  'champions of faith': 'Disruption',
  'chorus of condemnation': 'Reconnaissance',
  'hallowed martyrs': ['Take and Hold', 'Priority Assets'],
  'penitent host': 'Purge the Foe',
  'sacred champions': 'Take and Hold',
  'sanctified orators': 'Disruption',
  // Adeptus Mechanicus
  'cohort acquisitus': 'Reconnaissance',
  'cohort cybernetica': 'Take and Hold',
  'data-psalm conclave': 'Disruption',
  'eradication cohort': 'Purge the Foe',
  'explorator maniple': 'Priority Assets',
  'haloscreed battle clade': ['Priority Assets', 'Purge the Foe'],
  'lords of the forge': 'Priority Assets',
  'luminen auto-choir': 'Disruption',
  'rad-zone corps': 'Take and Hold',
  'skitarii hunter cohort': 'Reconnaissance',
  // Imperial Knights
  'dominus foebreakers': 'Priority Assets',
  'freeblade company': ['Priority Assets', 'Purge the Foe'],
  'gate warden lance': 'Take and Hold',
  'questor forgepact': 'Disruption',
  'questoris companions': ['Take and Hold', 'Reconnaissance'],
  'spearhead-at-arms': 'Reconnaissance',
  'throne-bonded outriders': 'Reconnaissance',
  'valourstrike lance': 'Purge the Foe',
  // Adeptus Custodes
  'auric champions': 'Priority Assets',
  'lions of the emperor': ['Take and Hold', 'Disruption'],
  'might of the moritoi': 'Take and Hold',
  'null maiden vigil': 'Reconnaissance',
  'shield host': 'Purge the Foe',
  'silent hunters': 'Reconnaissance',
  'solar spearhead': 'Take and Hold',
  'talons of the emperor': ['Take and Hold', 'Priority Assets'],
  'tharanatoi hammerblow': 'Disruption',
  // Imperial Agents
  'imperialis fleet': 'Reconnaissance',
  'ordo hereticus, purgation force': 'Take and Hold',
  'ordo hereticus purgation force': 'Take and Hold',
  'ordo malleus, daemon hunters': 'Priority Assets',
  'ordo malleus daemon hunters': 'Priority Assets',
  'ordo xenos, alien hunters': 'Purge the Foe',
  'ordo xenos alien hunters': 'Purge the Foe',
  'veiled blade elimination force': 'Disruption',
  // Chaos Space Marines
  'cabal of chaos': 'Disruption',
  'chaos cult': 'Priority Assets',
  'creations of bile': ['Take and Hold', 'Purge the Foe'],
  'cult of the arkifane': 'Priority Assets',
  'deceptors': 'Disruption',
  'devotees of destruction': 'Priority Assets',
  'dread talons': 'Disruption',
  'fellhammer siege-host': ['Take and Hold', 'Disruption'],
  "huron's marauders": ['Disruption', 'Reconnaissance'],
  'huron’s marauders': ['Disruption', 'Reconnaissance'],
  'murdertalon raiders': 'Reconnaissance',
  'nightmare hunt': 'Disruption',
  'pactbound zealots': ['Disruption', 'Purge the Foe'],
  'renegade raiders': ['Priority Assets', 'Reconnaissance'],
  'renegade warband': 'Priority Assets',
  'soulforged warpack': 'Take and Hold',
  'veterans of the long war': ['Take and Hold', 'Priority Assets'],
  'warpstrike champions': 'Disruption',
  // World Eaters
  'berzerker warband': ['Purge the Foe', 'Take and Hold'],
  'brazen engines': 'Disruption',
  'butchers of khorne': 'Take and Hold',
  'cult of blood': 'Priority Assets',
  'goretrack onslaught': 'Take and Hold',
  'khorne daemonkin': ['Reconnaissance', 'Disruption'],
  'possessed slaughterband': 'Purge the Foe',
  'vessels of wrath': ['Priority Assets', 'Purge the Foe'],
  // Emperor's Children
  'carnival of excess': 'Disruption',
  'coterie of the conceited': ['Priority Assets', 'Purge the Foe'],
  'court of the phoenician': 'Purge the Foe',
  'elegant brutes': 'Take and Hold',
  'frenzied host': 'Reconnaissance',
  'mercurial host': 'Reconnaissance',
  'peerless bladesmen': 'Priority Assets',
  'rapid evisceration': 'Disruption',
  "slaanesh's chosen": 'Purge the Foe',
  'slaanesh’s chosen': 'Purge the Foe',
  'spectacle of slaughter': 'Disruption',
  // Death Guard
  'champions of contagion': ['Take and Hold', 'Purge the Foe'],
  'contagion engines': 'Reconnaissance',
  "death lord's chosen": 'Priority Assets',
  'death lord’s chosen': 'Priority Assets',
  'flyblown host': 'Reconnaissance',
  "mortarion's hammer": 'Purge the Foe',
  'mortarion’s hammer': 'Purge the Foe',
  'paragons of putrescence': 'Priority Assets',
  'shamblerot vectorium': 'Disruption',
  'tallyband summoners': 'Disruption',
  'virulent vectorium': ['Take and Hold', 'Disruption'],
  // Thousand Sons
  'changehost of deceit': 'Reconnaissance',
  'grand coven': ['Disruption', 'Priority Assets'],
  'hexwarp thrallband': 'Take and Hold',
  'ritual of regeneration': 'Take and Hold',
  'rubricae phalanx': 'Take and Hold',
  'sekhetar cohort': 'Disruption',
  'servants of change': 'Reconnaissance',
  'warpforged cabal': 'Priority Assets',
  'warpmeld pact': 'Purge the Foe',
  // Chaos Knights
  'bastions of tyranny': 'Priority Assets',
  'helhunt lance': 'Disruption',
  'houndpack lance': 'Reconnaissance',
  'hunting warpack': 'Reconnaissance',
  'iconoclast fiefdom': 'Take and Hold',
  'infernal lance': ['Priority Assets', 'Purge the Foe'],
  'lords of dread': 'Take and Hold',
  'traitoris lance': 'Purge the Foe',
  // Chaos Daemons
  'blood legion': 'Purge the Foe',
  'cavalcade of chaos': 'Disruption',
  'daemonic incursion': ['Take and Hold', 'Disruption'],
  'legion of excess': 'Priority Assets',
  'lords of the warp': 'Take and Hold',
  'plague legion': 'Take and Hold',
  'scintillating legion': 'Priority Assets',
  'shadow legion': ['Purge the Foe', 'Reconnaissance'],
  'warptide': 'Reconnaissance',
  // Aeldari
  'armoured warhost': 'Reconnaissance',
  'aspect host': ['Priority Assets', 'Purge the Foe'],
  'corsair coterie': 'Priority Assets',
  'devoted of ynnead': 'Priority Assets',
  'eldritch raiders': 'Purge the Foe',
  'fateful performance': 'Disruption',
  'ghosts of the webway': 'Disruption',
  'guardian battlehost': 'Take and Hold',
  'path of the outcast': 'Reconnaissance',
  'seer council': ['Priority Assets', 'Disruption'],
  "serpent's brood": 'Purge the Foe',
  'serpent’s brood': 'Purge the Foe',
  'spirit conclave': 'Take and Hold',
  'twilight flickers': 'Take and Hold',
  'warhost': ['Reconnaissance', 'Take and Hold'],
  'windrider host': 'Disruption',
  // Drukhari
  'covenite coterie': 'Take and Hold',
  'exhibition of slaughter': 'Reconnaissance',
  'kabalite agonysts': 'Disruption',
  'kabalite cartel': 'Disruption',
  'realspace raiders': 'Priority Assets',
  "reaper's wager": ['Priority Assets', 'Disruption'],
  'reaper’s wager': ['Priority Assets', 'Disruption'],
  'skysplinter assault': 'Reconnaissance',
  'spectacle of spite': 'Purge the Foe',
  'tools of torment': 'Take and Hold',
  // Tyranids
  'ambush predators': 'Disruption',
  'assimilation swarm': 'Priority Assets',
  'crusher stampede': 'Purge the Foe',
  'invasion fleet': ['Take and Hold', 'Purge the Foe'],
  'subterranean assault': ['Disruption', 'Reconnaissance'],
  'synaptic nexus': 'Disruption',
  'talons of the norn queen': 'Take and Hold',
  'unending swarm': 'Take and Hold',
  'vanguard onslaught': 'Reconnaissance',
  'warrior bioform onslaught': 'Take and Hold',
  // Genestealer Cults
  'biosanctic broodsurge': 'Take and Hold',
  'brood brothers auxilia': 'Take and Hold',
  'final day': 'Purge the Foe',
  'heroes of the uprising': 'Disruption',
  'host of ascension': ['Take and Hold', 'Disruption'],
  'outlander claw': 'Reconnaissance',
  'purestrain broodswarm': 'Priority Assets',
  'xenocreed congregation': 'Priority Assets',
  'xenocult masses': 'Reconnaissance',
  // Necrons
  'annihilation legion': 'Purge the Foe',
  'awakened dynasty': ['Take and Hold', 'Priority Assets'],
  'canoptek court': 'Take and Hold',
  'cryptek conclave': 'Priority Assets',
  'cursed legion': 'Purge the Foe',
  'hand of the dynasty': 'Take and Hold',
  'hypercrypt legion': 'Reconnaissance',
  'obeisance phalanx': 'Disruption',
  'pantheon of woe': 'Disruption',
  'skyshroud spearhead': 'Reconnaissance',
  'starshatter arsenal': ['Priority Assets', 'Reconnaissance'],
  "the phaeron's armoury": 'Priority Assets',
  'the phaeron’s armoury': 'Priority Assets',
  // Orks
  'blitz brigade': 'Take and Hold',
  'brute bosses': 'Purge the Foe',
  'bully boyz': 'Purge the Foe',
  'da big hunt': 'Purge the Foe',
  'dread mob': 'Purge the Foe',
  'flyboyz': 'Reconnaissance',
  'green tide': 'Take and Hold',
  'kult of speed': 'Reconnaissance',
  'madcap meks': 'Disruption',
  'runt swarm': 'Priority Assets',
  'shoota boyz': 'Purge the Foe',
  'taktikal brigade': ['Take and Hold', 'Reconnaissance'],
  'war horde': ['Take and Hold', 'Purge the Foe'],
  'wreckas': 'Priority Assets',
  'wurrband': 'Disruption',
  // T'au Empire
  'advanced acquisition cadre': 'Reconnaissance',
  'auxiliary cadre': 'Disruption',
  'experimental prototype cadre': 'Priority Assets',
  'kauyon': 'Reconnaissance',
  'kroot hunting pack': 'Take and Hold',
  "mont'ka": ['Take and Hold', 'Purge the Foe'],
  'mont’ka': ['Take and Hold', 'Purge the Foe'],
  'retaliation cadre': ['Purge the Foe', 'Priority Assets'],
  // Leagues of Votann
  'armoured trailblazers': 'Disruption',
  'brandfast oathband': ['Take and Hold', 'Reconnaissance'],
  'dêlve assault shift': 'Purge the Foe',
  'delve assault shift': 'Purge the Foe',
  'farseekers': 'Reconnaissance',
  'hearthband': 'Priority Assets',
  'hearthfyre arsenal': 'Priority Assets',
  'hearthguard covenant': 'Priority Assets',
  'mercenary oathband': 'Take and Hold',
  'needgaârd oathband': ['Purge the Foe', 'Priority Assets'],
  'needgaard oathband': ['Purge the Foe', 'Priority Assets'],
  'persecution prospect': 'Disruption'
};

let _nrTournamentDetachmentsHydrated = false;
async function hydrateTournamentDetachmentsFromNewRecruit() {
  if (_nrTournamentDetachmentsHydrated || typeof fetch === 'undefined') return;
  _nrTournamentDetachmentsHydrated = true;
  try {
    const res = await fetch('/api/nr/detachments');
    if (!res || !res.ok) return;
    const payload = await res.json();
    const lookup = payload && payload.disposition_lookup;
    if (lookup && typeof lookup === 'object') {
      for (const [k, v] of Object.entries(lookup)) {
        if (!k || !v) continue;
        DETACHMENT_DISPOSITION_LOOKUP[k.toLowerCase()] = Array.isArray(v) && v.length === 1 ? v[0] : v;
      }
    }
  } catch (e) {}
}
setTimeout(() => { hydrateTournamentDetachmentsFromNewRecruit(); }, 0);

function resolveForceDispositionAndDetachment(rawDet, rawFac) {
  const cleanDet = String(rawDet || '').trim();
  const lower = cleanDet.toLowerCase();

  for (const disp of CANONICAL_FORCE_DISPOSITIONS) {
    if (lower === disp.key.toLowerCase()) {
      return { disposition: disp.key, dispositions: [disp.key], detachment: disp.key, meta: disp, secondaryMeta: null };
    }
  }
  if (lower === 'recon' || lower.includes('reconnaissance')) {
    return { disposition: 'Reconnaissance', dispositions: ['Reconnaissance'], detachment: cleanDet || 'Reconnaissance', meta: CANONICAL_FORCE_DISPOSITIONS[3], secondaryMeta: null };
  }
  if (lower === 'priority' || lower.includes('priority assets')) {
    return { disposition: 'Priority Assets', dispositions: ['Priority Assets'], detachment: cleanDet || 'Priority Assets', meta: CANONICAL_FORCE_DISPOSITIONS[1], secondaryMeta: null };
  }
  if (lower === 'hold' || lower.includes('take and hold') || lower.includes('take & hold')) {
    return { disposition: 'Take and Hold', dispositions: ['Take and Hold'], detachment: cleanDet || 'Take and Hold', meta: CANONICAL_FORCE_DISPOSITIONS[0], secondaryMeta: null };
  }
  if (lower === 'purge' || lower.includes('purge the foe')) {
    return { disposition: 'Purge the Foe', dispositions: ['Purge the Foe'], detachment: cleanDet || 'Purge the Foe', meta: CANONICAL_FORCE_DISPOSITIONS[2], secondaryMeta: null };
  }
  if (lower.includes('disruption')) {
    return { disposition: 'Disruption', dispositions: ['Disruption'], detachment: cleanDet || 'Disruption', meta: CANONICAL_FORCE_DISPOSITIONS[4], secondaryMeta: null };
  }

  if (DETACHMENT_DISPOSITION_LOOKUP[lower]) {
    const mapped = DETACHMENT_DISPOSITION_LOOKUP[lower];
    const dispList = Array.isArray(mapped) ? mapped : [mapped];
    const primaryDisp = dispList[0];
    const secondaryDisp = dispList.length > 1 ? dispList[1] : null;
    const meta = CANONICAL_FORCE_DISPOSITIONS.find(d => d.key === primaryDisp) || CANONICAL_FORCE_DISPOSITIONS[0];
    const secondaryMeta = secondaryDisp ? (CANONICAL_FORCE_DISPOSITIONS.find(d => d.key === secondaryDisp) || null) : null;
    return { disposition: primaryDisp, dispositions: dispList, detachment: cleanDet, meta, secondaryMeta };
  }

  const fallbackDisp = cleanDet && cleanDet !== 'Standard Detachment' && cleanDet !== 'Standard' && cleanDet !== 'Unknown' ? cleanDet : 'Unassigned';
  return {
    disposition: fallbackDisp,
    dispositions: [fallbackDisp],
    detachment: cleanDet || 'Standard Detachment',
    meta: { key: 'Other', label: cleanDet || 'Unassigned', icon: '⚙️', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.14)', border: 'rgba(148, 163, 184, 0.3)' },
    secondaryMeta: null
  };
}

function updatePowerGridControl(key, value) {
  if (key === 'groupBy') {
    powerGridState.groupBy = value;
  } else if (key === 'dispositionFilter') {
    powerGridState.dispositionFilter = (powerGridState.dispositionFilter === value && value !== 'All') ? 'All' : value;
  } else if (key === 'dispositionSelect') {
    powerGridState.dispositionFilter = value;
  } else if (key === 'factionFilter') {
    powerGridState.factionFilter = value;
  } else if (key === 'minReps') {
    powerGridState.minReps = Number(value) || 1;
  } else if (key === 'sortBy') {
    powerGridState.sortBy = value;
  } else if (key === 'search') {
    powerGridState.search = String(value || '');
  } else if (key === 'toggleRow') {
    if (powerGridState.expandedKeys.has(value)) {
      powerGridState.expandedKeys.delete(value);
    } else {
      powerGridState.expandedKeys.add(value);
    }
  } else if (key === 'toggleExpandAll') {
    powerGridState.expandAll = !powerGridState.expandAll;
    if (!powerGridState.expandAll) {
      powerGridState.expandedKeys.clear();
    }
  } else if (key === 'reset') {
    powerGridState.dispositionFilter = 'All';
    powerGridState.factionFilter = 'All';
    powerGridState.minReps = 1;
    powerGridState.sortBy = 'win_rate_desc';
    powerGridState.search = '';
    powerGridState.expandedKeys.clear();
    powerGridState.expandAll = false;
  }

  if (currentEventData) {
    const players = Array.isArray(eventPlayersCache) && eventPlayersCache.length > 0 ? eventPlayersCache : (currentEventData.players || []);
    const matches = Array.isArray(eventMatchesCache) && eventMatchesCache.length > 0 ? eventMatchesCache : (currentEventData.matches || []);
    const gridMount = document.getElementById('deep-meta-power-grid-mount');
    if (gridMount) {
      gridMount.innerHTML = buildInteractivePowerGridHtml(currentEventData, players, matches);
      if (key === 'search') {
        const input = document.getElementById('power-grid-search-input');
        if (input) {
          input.focus();
          const len = input.value.length;
          input.setSelectionRange(len, len);
        }
      }
      return;
    }
    renderEventCreatorHub(currentEventData);
  }
}
window.updatePowerGridControl = updatePowerGridControl;

function sortPowerGridRecords(list, sortBy) {
  return list.slice().sort((a, b) => {
    const isUnassignedA = (a.disposition === 'Unassigned' || a.label === 'Unassigned');
    const isUnassignedB = (b.disposition === 'Unassigned' || b.label === 'Unassigned');
    if (isUnassignedA !== isUnassignedB) return isUnassignedA ? 1 : -1;

    const totalA = a.wins + a.losses + (a.draws || 0);
    const totalB = b.wins + b.losses + (b.draws || 0);
    const wrA = totalA > 0 ? (a.wins / totalA) : 0;
    const wrB = totalB > 0 ? (b.wins / totalB) : 0;
    const avgA = a.count > 0 ? (a.points / a.count) : 0;
    const avgB = b.count > 0 ? (b.points / b.count) : 0;

    if (sortBy === 'win_rate_asc') {
      if (wrA !== wrB) return wrA - wrB;
      return b.count - a.count;
    }
    if (sortBy === 'reps_desc') {
      if (b.count !== a.count) return b.count - a.count;
      return wrB - wrA;
    }
    if (sortBy === 'wins_desc') {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return wrB - wrA;
    }
    if (sortBy === 'avg_pts_desc') {
      if (avgB !== avgA) return avgB - avgA;
      return wrB - wrA;
    }
    // default: win_rate_desc
    if (wrB !== wrA) return wrB - wrA;
    return b.count - a.count;
  });
}

function buildInteractivePowerGridHtml(ev, players, matches) {
  const totalField = Math.max(1, players.length);
  const allFactionsSet = new Set();
  const dispOverallMap = new Map();
  CANONICAL_FORCE_DISPOSITIONS.forEach(d => {
    dispOverallMap.set(d.key, {
      key: d.key,
      meta: d,
      count: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      points: 0
    });
  });

  // Enrich each player with resolved Force Disposition & Faction
  const enrichedPlayers = [];
  players.forEach(p => {
    const rawFacStr = String(p.faction || p.army_name || '').trim();
    if (!rawFacStr || rawFacStr === '-' || rawFacStr === '—') return;
    const fac = formatEventPlayerFaction(rawFacStr);
    if (!fac || fac === '-' || fac === 'Unknown' || fac === 'Unassigned' || fac === 'Army' || fac === 'None') return;
    allFactionsSet.add(fac);
    const resolved = resolveForceDispositionAndDetachment(p.detachment, fac);
    const pWins = Number(p.event_wins || 0);
    const pLosses = Number(p.event_losses || 0);
    const pDraws = Number(p.event_draws || 0);
    const pPts = Number(p.event_battle_points || 0);

    if (dispOverallMap.has(resolved.disposition)) {
      const dStat = dispOverallMap.get(resolved.disposition);
      dStat.count++;
      dStat.wins += pWins;
      dStat.losses += pLosses;
      dStat.draws += pDraws;
      dStat.points += pPts;
    }

    enrichedPlayers.push({
      raw: p,
      pid: String(p.player_id || p.id || '').trim(),
      name: p.full_name || p.name || 'Player',
      listId: String(p.list_id || p.listId || '').trim(),
      faction: fac,
      disposition: resolved.disposition,
      dispositions: resolved.dispositions || [resolved.disposition],
      detachment: resolved.detachment,
      dispMeta: resolved.meta,
      secondaryDispMeta: resolved.secondaryMeta || null,
      wins: pWins,
      losses: pLosses,
      draws: pDraws,
      points: pPts
    });
  });

  const allFactions = Array.from(allFactionsSet).sort();

  // Apply player-level filters (Disposition, Faction, Search)
  const q = powerGridState.search.trim().toLowerCase();
  const filteredPlayers = enrichedPlayers.filter(ep => {
    if (powerGridState.dispositionFilter !== 'All' && ep.disposition !== powerGridState.dispositionFilter && !(Array.isArray(ep.dispositions) && ep.dispositions.includes(powerGridState.dispositionFilter))) {
      return false;
    }
    if (powerGridState.factionFilter !== 'All' && ep.faction !== powerGridState.factionFilter) {
      return false;
    }
    if (q) {
      const hay = `${ep.faction} ${(ep.dispositions || [ep.disposition]).join(' ')} ${ep.detachment} ${ep.name}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Top 5 Force Disposition Quick-Filter Cards
  const dispCardsHtml = CANONICAL_FORCE_DISPOSITIONS.map(d => {
    const st = dispOverallMap.get(d.key) || { count: 0, wins: 0, losses: 0, draws: 0, points: 0 };
    const totG = st.wins + st.losses + st.draws;
    const wr = totG > 0 ? ((st.wins / totG) * 100).toFixed(1) : '0.0';
    const share = ((st.count / totalField) * 100).toFixed(1);
    const isSel = powerGridState.dispositionFilter === d.key;
    const wrCol = Number(wr) >= 53 ? '#4ade80' : (Number(wr) <= 46 ? '#f87171' : '#f8fafc');
    const safeKey = d.key.replace(/'/g, "\\'");

    return `
      <div onclick="updatePowerGridControl('dispositionFilter', '${safeKey}')" style="cursor: pointer; background: ${isSel ? d.bg : 'rgba(15, 23, 42, 0.78)'}; border: 1px solid ${isSel ? d.color : 'rgba(255,255,255,0.08)'}; border-radius: 9px; padding: 0.65rem 0.8rem; transition: all 0.15s ease; box-shadow: ${isSel ? `0 0 14px ${d.bg}` : 'none'};">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.35rem; margin-bottom: 0.25rem;">
          <span style="font-size: 0.75rem; font-weight: 800; color: ${d.color}; display: flex; align-items: center; gap: 0.3rem;">
            <span>${d.icon}</span>
            <span>${escapeHtml(d.label)}</span>
          </span>
          ${isSel ? `<span class="badge" style="background:${d.color}; color:#000; font-size:0.62rem; font-weight:800; padding:1px 5px;">FILTERED</span>` : `<span style="font-size:0.68rem; color:var(--text-muted); font-family:var(--font-mono);">${share}%</span>`}
        </div>
        <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 0.4rem;">
          <span style="font-family: var(--font-mono); font-size: 1.15rem; font-weight: 900; color: ${wrCol};">${wr}% <span style="font-size:0.68rem; font-weight:600; color:var(--text-muted);">WR</span></span>
          <span style="font-family: var(--font-mono); font-size: 0.74rem; color: #cbd5e1;"><strong>${st.count}</strong> Pilots (${st.wins}W-${st.losses}L)</span>
        </div>
      </div>
    `;
  }).join('');

  // Build Grouped Rows according to powerGridState.groupBy
  let tableHeaderHtml = '';
  let tableBodyHtml = '';
  let totalGroupsShown = 0;

  const updateTopPilot = (target, ep) => {
    if (ep.wins > target.topWins || (ep.wins === target.topWins && ep.points > target.topPoints)) {
      target.topWins = ep.wins;
      target.topPoints = ep.points;
      target.topPlayer = ep.name;
      target.topPlayerId = ep.pid;
      target.topPlayerListId = ep.listId;
    }
  };

  if (powerGridState.groupBy === 'disposition') {
    // GROUP BY FORCE DISPOSITION -> Nested Factions Breakdown
    const dispGroups = new Map();
    filteredPlayers.forEach(ep => {
      const key = ep.disposition;
      if (!dispGroups.has(key)) {
        dispGroups.set(key, {
          key,
          disposition: ep.disposition,
          dispMeta: ep.dispMeta,
          count: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          points: 0,
          topPlayer: ep.name,
          topPlayerId: ep.pid,
          topPlayerListId: ep.listId,
          topWins: -1,
          topPoints: -1,
          subMap: new Map()
        });
      }
      const g = dispGroups.get(key);
      g.count++;
      g.wins += ep.wins;
      g.losses += ep.losses;
      g.draws += ep.draws;
      g.points += ep.points;
      updateTopPilot(g, ep);

      if (!g.subMap.has(ep.faction)) {
        g.subMap.set(ep.faction, {
          faction: ep.faction,
          count: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          points: 0,
          topPlayer: ep.name,
          topPlayerId: ep.pid,
          topPlayerListId: ep.listId,
          topWins: -1,
          topPoints: -1
        });
      }
      const sub = g.subMap.get(ep.faction);
      sub.count++;
      sub.wins += ep.wins;
      sub.losses += ep.losses;
      sub.draws += ep.draws;
      sub.points += ep.points;
      updateTopPilot(sub, ep);
    });

    const sortedGroups = sortPowerGridRecords(
      Array.from(dispGroups.values()).filter(g => g.count >= powerGridState.minReps),
      powerGridState.sortBy
    );
    totalGroupsShown = sortedGroups.length;

    tableHeaderHtml = `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.12); color: var(--text-muted); text-align: left; font-size: 0.76rem; text-transform: uppercase;">
        <th style="padding: 0.6rem 0.5rem;">Force Disposition</th>
        <th style="padding: 0.6rem 0.5rem; text-align: center;">Reps</th>
        <th style="padding: 0.6rem 0.5rem; text-align: center;">Record (W-L)</th>
        <th style="padding: 0.6rem 0.5rem; text-align: center;">Win Rate</th>
        <th style="padding: 0.6rem 0.5rem;">Factions in Disposition (Click to Filter / Expand)</th>
        <th style="padding: 0.6rem 0.5rem; text-align: right;">Avg Pts</th>
        <th style="padding: 0.6rem 0.5rem; text-align: right;">Top Pilot</th>
      </tr>
    `;

    tableBodyHtml = sortedGroups.map(g => {
      const tot = g.wins + g.losses + g.draws;
      const wr = tot > 0 ? ((g.wins / tot) * 100).toFixed(1) : '0.0';
      const avgPts = g.count > 0 ? (g.points / g.count).toFixed(1) : '0.0';
      const sharePct = ((g.count / totalField) * 100).toFixed(1);
      const wrCol = Number(wr) >= 55 ? '#4ade80' : (Number(wr) <= 45 ? '#f87171' : '#fff');
      const rowKey = `disp:${g.key}`;
      const safeRowKey = rowKey.replace(/'/g, "\\'");
      const isExpanded = powerGridState.expandAll || powerGridState.expandedKeys.has(rowKey) || powerGridState.dispositionFilter === g.key;

      const sortedSubFactions = sortPowerGridRecords(
        Array.from(g.subMap.values()).filter(sf => sf.count >= Math.min(powerGridState.minReps, sf.count)),
        powerGridState.sortBy
      );

      const inlinePills = sortedSubFactions.slice(0, 4).map(sf => {
        const sfTot = sf.wins + sf.losses + sf.draws;
        const sfWr = sfTot > 0 ? ((sf.wins / sfTot) * 100).toFixed(1) : '0.0';
        const sfCol = Number(sfWr) >= 55 ? '#4ade80' : (Number(sfWr) <= 45 ? '#f87171' : '#cbd5e1');
        const safeFac = sf.faction.replace(/'/g, "\\'");
        return `
          <span onclick="event.stopPropagation(); updatePowerGridControl('factionFilter', '${safeFac}')" class="badge" style="cursor: pointer; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #f8fafc; font-size: 0.7rem; padding: 2px 7px;" title="Click to filter by ${escapeHtml(sf.faction)}">
            ${escapeHtml(sf.faction)}: <strong>${sf.count}</strong> (<span style="color:${sfCol}; font-family:var(--font-mono);">${sfWr}%</span>)
          </span>
        `;
      }).join('');

      const safeTopPid = String(g.topPlayerId || '').replace(/'/g, "\\'");
      const safeTopName = String(g.topPlayer || '').replace(/'/g, "\\'");
      const safeTopList = String(g.topPlayerListId || '').replace(/'/g, "\\'");

      const subRowsHtml = isExpanded ? `
        <tr style="background: rgba(9, 14, 26, 0.85); border-bottom: 1px solid rgba(255,255,255,0.08);">
          <td colspan="7" style="padding: 0.65rem 0.85rem;">
            <div style="font-size: 0.75rem; font-weight: 800; color: ${g.dispMeta.color}; margin-bottom: 0.45rem; display: flex; align-items: center; justify-content: space-between;">
              <span>${g.dispMeta.icon} Faction Breakdown for <strong>${escapeHtml(g.disposition)}</strong> (${sortedSubFactions.length} Factions • ${g.count} Total Pilots)</span>
              <button type="button" class="btn-xs btn-outline" onclick="updatePowerGridControl('toggleRow', '${safeRowKey}')" style="font-size: 0.68rem; padding: 1px 7px; color: var(--text-muted); border-color: rgba(255,255,255,0.15); cursor: pointer;">▲ Hide Factions</button>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 0.45rem;">
              ${sortedSubFactions.map(sf => {
                const sfTot = sf.wins + sf.losses + sf.draws;
                const sfWr = sfTot > 0 ? ((sf.wins / sfTot) * 100).toFixed(1) : '0.0';
                const sfAvgPts = sf.count > 0 ? (sf.points / sf.count).toFixed(1) : '0.0';
                const sfShare = ((sf.count / Math.max(1, g.count)) * 100).toFixed(0);
                const sfCol = Number(sfWr) >= 55 ? '#4ade80' : (Number(sfWr) <= 45 ? '#f87171' : '#fff');
                const sPid = String(sf.topPlayerId || '').replace(/'/g, "\\'");
                const sName = String(sf.topPlayer || '').replace(/'/g, "\\'");
                return `
                  <div style="background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(255,255,255,0.07); border-radius: 6px; padding: 0.45rem 0.65rem; display: flex; flex-direction: column; gap: 3px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.3rem;">
                      <span style="font-weight: 700; color: #fff; font-size: 0.78rem;">🛡️ ${escapeHtml(sf.faction)}</span>
                      <span style="font-family: var(--font-mono); font-size: 0.78rem; font-weight: 800; color: ${sfCol};">${sfWr}% WR</span>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.71rem; color: var(--text-secondary);">
                      <span><strong>${sf.count}</strong> reps (${sfShare}% of disp) • ${sf.wins}W-${sf.losses}L</span>
                      <span>${sfAvgPts} avg pts</span>
                    </div>
                    <div style="font-size: 0.69rem; color: var(--text-muted);">
                      Top Pilot: <span class="player-link" onclick="event.stopPropagation(); openPlayerModal('${escapeHtml(sPid)}', '${escapeHtml(sName)}')" style="color: #38bdf8; cursor: pointer; font-weight: 600;">${escapeHtml(sf.topPlayer)}</span> (${sf.topWins}W)
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </td>
        </tr>
      ` : '';

      return `
        <tr onclick="updatePowerGridControl('toggleRow', '${safeRowKey}')" style="border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; background: ${isExpanded ? 'rgba(56, 189, 248, 0.05)' : 'transparent'};">
          <td style="padding: 0.6rem 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.45rem;">
              <span style="font-size: 1rem;">${g.dispMeta.icon}</span>
              <div>
                <div style="font-weight: 800; color: ${g.dispMeta.color}; font-size: 0.88rem;">${escapeHtml(g.disposition)}</div>
                <div style="font-size: 0.7rem; color: var(--text-muted);">${sharePct}% of tournament field • ${sortedSubFactions.length} factions</div>
              </div>
            </div>
          </td>
          <td style="padding: 0.6rem 0.5rem; text-align: center; font-family: var(--font-mono); font-weight: 700; color: #fff;">${g.count}</td>
          <td style="padding: 0.6rem 0.5rem; text-align: center; font-family: var(--font-mono);">${g.wins}W - ${g.losses}L${g.draws ? ` - ${g.draws}D` : ''}</td>
          <td style="padding: 0.6rem 0.5rem; text-align: center;">
            <div style="display: inline-flex; flex-direction: column; align-items: center; gap: 3px; min-width: 68px;">
              <span style="font-family: var(--font-mono); font-weight: 800; font-size: 0.88rem; color: ${wrCol};">${wr}%</span>
              <div style="width: 56px; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                <div style="width: ${Math.min(100, Number(wr))}%; height: 100%; background: ${wrCol};"></div>
              </div>
            </div>
          </td>
          <td style="padding: 0.6rem 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
              ${inlinePills}
              <button type="button" class="btn-xs btn-outline" onclick="event.stopPropagation(); updatePowerGridControl('toggleRow', '${safeRowKey}')" style="font-size: 0.68rem; padding: 2px 7px; border-radius: 4px; color: #38bdf8; border-color: rgba(56,189,248,0.35); background: rgba(56,189,248,0.08); cursor: pointer; font-weight: 700;">
                ${isExpanded ? '▲ Hide' : `▼ All ${sortedSubFactions.length} Factions`}
              </button>
            </div>
          </td>
          <td style="padding: 0.6rem 0.5rem; text-align: right; font-family: var(--font-mono);">${avgPts}</td>
          <td style="padding: 0.6rem 0.5rem; text-align: right; white-space: nowrap;" onclick="event.stopPropagation();">
            <span class="player-link" onclick="openPlayerModal('${escapeHtml(safeTopPid)}', '${escapeHtml(safeTopName)}')" style="color: #38bdf8; font-weight: 700; cursor: pointer;" title="View Quick Profile">${escapeHtml(g.topPlayer)}</span>
            ${g.topPlayerListId ? `<button type="button" class="btn-xs btn-outline" onclick="openEventPlayerListModal('${escapeHtml(safeTopPid || safeTopName)}', '${escapeHtml(safeTopList)}')" style="margin-left: 4px; font-size: 0.65rem; padding: 1px 5px; color: #cbd5e1; border-color: rgba(255,255,255,0.2); cursor: pointer;" title="View Army Roster">📋</button>` : ''}
          </td>
        </tr>
        ${subRowsHtml}
      `;
    }).join('');

  } else if (powerGridState.groupBy === 'faction') {
    // GROUP BY FACTION -> Nested Force Dispositions Breakdown
    const facGroups = new Map();
    filteredPlayers.forEach(ep => {
      const key = ep.faction;
      if (!facGroups.has(key)) {
        facGroups.set(key, {
          key,
          faction: ep.faction,
          count: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          points: 0,
          topPlayer: ep.name,
          topPlayerId: ep.pid,
          topPlayerListId: ep.listId,
          topWins: -1,
          topPoints: -1,
          subMap: new Map()
        });
      }
      const g = facGroups.get(key);
      g.count++;
      g.wins += ep.wins;
      g.losses += ep.losses;
      g.draws += ep.draws;
      g.points += ep.points;
      updateTopPilot(g, ep);

      const subKey = ep.detachment && ep.detachment !== ep.disposition
        ? `${ep.disposition} (${ep.detachment})`
        : ep.disposition;
      if (!g.subMap.has(subKey)) {
        g.subMap.set(subKey, {
          label: subKey,
          disposition: ep.disposition,
          dispMeta: ep.dispMeta,
          count: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          points: 0,
          topPlayer: ep.name,
          topPlayerId: ep.pid,
          topPlayerListId: ep.listId,
          topWins: -1,
          topPoints: -1
        });
      }
      const sub = g.subMap.get(subKey);
      sub.count++;
      sub.wins += ep.wins;
      sub.losses += ep.losses;
      sub.draws += ep.draws;
      sub.points += ep.points;
      updateTopPilot(sub, ep);
    });

    const sortedGroups = sortPowerGridRecords(
      Array.from(facGroups.values()).filter(g => g.count >= powerGridState.minReps),
      powerGridState.sortBy
    );
    totalGroupsShown = sortedGroups.length;

    tableHeaderHtml = `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.12); color: var(--text-muted); text-align: left; font-size: 0.76rem; text-transform: uppercase;">
        <th style="padding: 0.6rem 0.5rem;">Faction</th>
        <th style="padding: 0.6rem 0.5rem; text-align: center;">Reps</th>
        <th style="padding: 0.6rem 0.5rem; text-align: center;">Record (W-L)</th>
        <th style="padding: 0.6rem 0.5rem; text-align: center;">Win Rate</th>
        <th style="padding: 0.6rem 0.5rem;">Force Dispositions / Detachments Breakdown</th>
        <th style="padding: 0.6rem 0.5rem; text-align: right;">Avg Pts</th>
        <th style="padding: 0.6rem 0.5rem; text-align: right;">Top Pilot</th>
      </tr>
    `;

    tableBodyHtml = sortedGroups.map(g => {
      const tot = g.wins + g.losses + g.draws;
      const wr = tot > 0 ? ((g.wins / tot) * 100).toFixed(1) : '0.0';
      const avgPts = g.count > 0 ? (g.points / g.count).toFixed(1) : '0.0';
      const sharePct = ((g.count / totalField) * 100).toFixed(1);
      const wrCol = Number(wr) >= 55 ? '#4ade80' : (Number(wr) <= 45 ? '#f87171' : '#fff');
      const rowKey = `fac:${g.key}`;
      const safeRowKey = rowKey.replace(/'/g, "\\'");
      const isExpanded = powerGridState.expandAll || powerGridState.expandedKeys.has(rowKey) || powerGridState.factionFilter === g.key;

      const sortedSubs = sortPowerGridRecords(Array.from(g.subMap.values()), powerGridState.sortBy);

      const inlinePills = sortedSubs.slice(0, 4).map(sd => {
        const sdTot = sd.wins + sd.losses + sd.draws;
        const sdWr = sdTot > 0 ? ((sd.wins / sdTot) * 100).toFixed(1) : '0.0';
        const sdCol = Number(sdWr) >= 55 ? '#4ade80' : (Number(sdWr) <= 45 ? '#f87171' : '#cbd5e1');
        const safeDisp = sd.disposition.replace(/'/g, "\\'");
        return `
          <span onclick="event.stopPropagation(); updatePowerGridControl('dispositionFilter', '${safeDisp}')" class="badge" style="cursor: pointer; background: ${sd.dispMeta.bg}; border: 1px solid ${sd.dispMeta.border}; color: #f8fafc; font-size: 0.7rem; padding: 2px 7px;" title="Click to filter by ${escapeHtml(sd.disposition)}">
            ${sd.dispMeta.icon} ${escapeHtml(sd.label)}: <strong>${sd.count}</strong> (<span style="color:${sdCol}; font-family:var(--font-mono);">${sdWr}%</span>)
          </span>
        `;
      }).join('');

      const safeTopPid = String(g.topPlayerId || '').replace(/'/g, "\\'");
      const safeTopName = String(g.topPlayer || '').replace(/'/g, "\\'");
      const safeTopList = String(g.topPlayerListId || '').replace(/'/g, "\\'");

      const subRowsHtml = isExpanded ? `
        <tr style="background: rgba(9, 14, 26, 0.85); border-bottom: 1px solid rgba(255,255,255,0.08);">
          <td colspan="7" style="padding: 0.65rem 0.85rem;">
            <div style="font-size: 0.75rem; font-weight: 800; color: #38bdf8; margin-bottom: 0.45rem; display: flex; align-items: center; justify-content: space-between;">
              <span>🛡️ Force Disposition Breakdown for <strong>${escapeHtml(g.faction)}</strong> (${g.count} Total Pilots)</span>
              <button type="button" class="btn-xs btn-outline" onclick="updatePowerGridControl('toggleRow', '${safeRowKey}')" style="font-size: 0.68rem; padding: 1px 7px; color: var(--text-muted); border-color: rgba(255,255,255,0.15); cursor: pointer;">▲ Hide</button>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 0.45rem;">
              ${sortedSubs.map(sd => {
                const sdTot = sd.wins + sd.losses + sd.draws;
                const sdWr = sdTot > 0 ? ((sd.wins / sdTot) * 100).toFixed(1) : '0.0';
                const sdAvgPts = sd.count > 0 ? (sd.points / sd.count).toFixed(1) : '0.0';
                const sdShare = ((sd.count / Math.max(1, g.count)) * 100).toFixed(0);
                const sdCol = Number(sdWr) >= 55 ? '#4ade80' : (Number(sdWr) <= 45 ? '#f87171' : '#fff');
                const sPid = String(sd.topPlayerId || '').replace(/'/g, "\\'");
                const sName = String(sd.topPlayer || '').replace(/'/g, "\\'");
                return `
                  <div style="background: rgba(15, 23, 42, 0.9); border: 1px solid ${sd.dispMeta.border}; border-radius: 6px; padding: 0.45rem 0.65rem; display: flex; flex-direction: column; gap: 3px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.3rem;">
                      <span style="font-weight: 700; color: ${sd.dispMeta.color}; font-size: 0.78rem;">${sd.dispMeta.icon} ${escapeHtml(sd.label)}</span>
                      <span style="font-family: var(--font-mono); font-size: 0.78rem; font-weight: 800; color: ${sdCol};">${sdWr}% WR</span>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.71rem; color: var(--text-secondary);">
                      <span><strong>${sd.count}</strong> reps (${sdShare}% of faction) • ${sd.wins}W-${sd.losses}L</span>
                      <span>${sdAvgPts} avg pts</span>
                    </div>
                    <div style="font-size: 0.69rem; color: var(--text-muted);">
                      Top Pilot: <span class="player-link" onclick="event.stopPropagation(); openPlayerModal('${escapeHtml(sPid)}', '${escapeHtml(sName)}')" style="color: #38bdf8; cursor: pointer; font-weight: 600;">${escapeHtml(sd.topPlayer)}</span> (${sd.topWins}W)
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </td>
        </tr>
      ` : '';

      return `
        <tr onclick="updatePowerGridControl('toggleRow', '${safeRowKey}')" style="border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; background: ${isExpanded ? 'rgba(56, 189, 248, 0.05)' : 'transparent'};">
          <td style="padding: 0.6rem 0.5rem;">
            <div style="font-weight: 800; color: #fff; font-size: 0.88rem;">🛡️ ${escapeHtml(g.faction)}</div>
            <div style="font-size: 0.7rem; color: var(--text-muted);">${sharePct}% of field • ${sortedSubs.length} dispositions</div>
          </td>
          <td style="padding: 0.6rem 0.5rem; text-align: center; font-family: var(--font-mono); font-weight: 700; color: #fff;">${g.count}</td>
          <td style="padding: 0.6rem 0.5rem; text-align: center; font-family: var(--font-mono);">${g.wins}W - ${g.losses}L${g.draws ? ` - ${g.draws}D` : ''}</td>
          <td style="padding: 0.6rem 0.5rem; text-align: center;">
            <div style="display: inline-flex; flex-direction: column; align-items: center; gap: 3px; min-width: 68px;">
              <span style="font-family: var(--font-mono); font-weight: 800; font-size: 0.88rem; color: ${wrCol};">${wr}%</span>
              <div style="width: 56px; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                <div style="width: ${Math.min(100, Number(wr))}%; height: 100%; background: ${wrCol};"></div>
              </div>
            </div>
          </td>
          <td style="padding: 0.6rem 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
              ${inlinePills}
              <button type="button" class="btn-xs btn-outline" onclick="event.stopPropagation(); updatePowerGridControl('toggleRow', '${safeRowKey}')" style="font-size: 0.68rem; padding: 2px 7px; border-radius: 4px; color: #38bdf8; border-color: rgba(56,189,248,0.35); background: rgba(56,189,248,0.08); cursor: pointer; font-weight: 700;">
                ${isExpanded ? '▲ Hide' : `▼ Breakdown`}
              </button>
            </div>
          </td>
          <td style="padding: 0.6rem 0.5rem; text-align: right; font-family: var(--font-mono);">${avgPts}</td>
          <td style="padding: 0.6rem 0.5rem; text-align: right; white-space: nowrap;" onclick="event.stopPropagation();">
            <span class="player-link" onclick="openPlayerModal('${escapeHtml(safeTopPid)}', '${escapeHtml(safeTopName)}')" style="color: #38bdf8; font-weight: 700; cursor: pointer;" title="View Quick Profile">${escapeHtml(g.topPlayer)}</span>
            ${g.topPlayerListId ? `<button type="button" class="btn-xs btn-outline" onclick="openEventPlayerListModal('${escapeHtml(safeTopPid || safeTopName)}', '${escapeHtml(safeTopList)}')" style="margin-left: 4px; font-size: 0.65rem; padding: 1px 5px; color: #cbd5e1; border-color: rgba(255,255,255,0.2); cursor: pointer;" title="View Army Roster">📋</button>` : ''}
          </td>
        </tr>
        ${subRowsHtml}
      `;
    }).join('');

  } else {
    // GROUP BY DISPOSITION × FACTION GRID (All Combos)
    const comboMap = new Map();
    filteredPlayers.forEach(ep => {
      const key = `${ep.disposition}__${ep.faction}__${ep.detachment}`;
      if (!comboMap.has(key)) {
        comboMap.set(key, {
          key,
          disposition: ep.disposition,
          detachment: ep.detachment,
          dispMeta: ep.dispMeta,
          faction: ep.faction,
          count: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          points: 0,
          topPlayer: ep.name,
          topPlayerId: ep.pid,
          topPlayerListId: ep.listId,
          topWins: -1,
          topPoints: -1
        });
      }
      const c = comboMap.get(key);
      c.count++;
      c.wins += ep.wins;
      c.losses += ep.losses;
      c.draws += ep.draws;
      c.points += ep.points;
      updateTopPilot(c, ep);
    });

    const sortedCombos = sortPowerGridRecords(
      Array.from(comboMap.values()).filter(c => c.count >= powerGridState.minReps),
      powerGridState.sortBy
    );
    totalGroupsShown = sortedCombos.length;

    tableHeaderHtml = `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.12); color: var(--text-muted); text-align: left; font-size: 0.76rem; text-transform: uppercase;">
        <th style="padding: 0.6rem 0.5rem;">Force Disposition / Detachment</th>
        <th style="padding: 0.6rem 0.5rem;">Faction</th>
        <th style="padding: 0.6rem 0.5rem; text-align: center;">Reps</th>
        <th style="padding: 0.6rem 0.5rem; text-align: center;">Record (W-L)</th>
        <th style="padding: 0.6rem 0.5rem; text-align: center;">Win Rate</th>
        <th style="padding: 0.6rem 0.5rem; text-align: right;">Avg Battle Pts</th>
        <th style="padding: 0.6rem 0.5rem; text-align: right;">Top Pilot</th>
      </tr>
    `;

    tableBodyHtml = sortedCombos.map(c => {
      const tot = c.wins + c.losses + c.draws;
      const wr = tot > 0 ? ((c.wins / tot) * 100).toFixed(1) : '0.0';
      const avgPts = c.count > 0 ? (c.points / c.count).toFixed(1) : '0.0';
      const wrCol = Number(wr) >= 55 ? '#4ade80' : (Number(wr) <= 45 ? '#f87171' : '#fff');
      const safeTopPid = String(c.topPlayerId || '').replace(/'/g, "\\'");
      const safeTopName = String(c.topPlayer || '').replace(/'/g, "\\'");
      const safeTopList = String(c.topPlayerListId || '').replace(/'/g, "\\'");

      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
          <td style="padding: 0.55rem 0.5rem;">
            <span class="badge" style="background: ${c.dispMeta.bg}; color: ${c.dispMeta.color}; border: 1px solid ${c.dispMeta.border}; font-size: 0.72rem; font-weight: 700;">
              ${c.dispMeta.icon} ${escapeHtml(c.disposition)}
            </span>
            ${c.detachment && c.detachment !== c.disposition ? `<div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 2px;">${escapeHtml(c.detachment)}</div>` : ''}
          </td>
          <td style="padding: 0.55rem 0.5rem; font-weight: 700; color: #fff;">🛡️ ${escapeHtml(c.faction)}</td>
          <td style="padding: 0.55rem 0.5rem; text-align: center; font-family: var(--font-mono); font-weight: 700;">${c.count}</td>
          <td style="padding: 0.55rem 0.5rem; text-align: center; font-family: var(--font-mono);">${c.wins}W - ${c.losses}L${c.draws ? ` - ${c.draws}D` : ''}</td>
          <td style="padding: 0.55rem 0.5rem; text-align: center; font-family: var(--font-mono); font-weight: 800; color: ${wrCol};">${wr}%</td>
          <td style="padding: 0.55rem 0.5rem; text-align: right; font-family: var(--font-mono);">${avgPts}</td>
          <td style="padding: 0.55rem 0.5rem; text-align: right; white-space: nowrap;">
            <span class="player-link" onclick="openPlayerModal('${escapeHtml(safeTopPid)}', '${escapeHtml(safeTopName)}')" style="color: #38bdf8; font-weight: 700; cursor: pointer;">${escapeHtml(c.topPlayer)}</span>
            ${c.topPlayerListId ? `<button type="button" class="btn-xs btn-outline" onclick="openEventPlayerListModal('${escapeHtml(safeTopPid || safeTopName)}', '${escapeHtml(safeTopList)}')" style="margin-left: 4px; font-size: 0.65rem; padding: 1px 5px; color: #cbd5e1; border-color: rgba(255,255,255,0.2); cursor: pointer;" title="View Army Roster">📋</button>` : ''}
          </td>
        </tr>
      `;
    }).join('');
  }

  const hasActiveFilters = powerGridState.dispositionFilter !== 'All' || powerGridState.factionFilter !== 'All' || powerGridState.minReps > 1 || powerGridState.search.trim().length > 0;

  return `
    <!-- Header & Group By Mode Switcher -->
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.9rem; flex-wrap: wrap;">
      <div>
        <h4 style="margin: 0; font-size: 1rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.45rem;">
          <span>🧬 Detachment & Force Disposition Power Grid</span>
          <span class="badge" style="background: rgba(56,189,248,0.14); color: #38bdf8; font-size: 0.7rem;">${filteredPlayers.length} / ${enrichedPlayers.length} Pilots</span>
        </h4>
        <div style="font-size: 0.76rem; color: var(--text-secondary); margin-top: 2px;">
          Dynamically group by Force Disposition (to see win rates & faction breakdowns) or by Faction (to see which dispositions they run).
        </div>
      </div>

      <!-- Group By Segmented Buttons -->
      <div style="display: inline-flex; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 3px; gap: 3px; flex-wrap: wrap;">
        <button type="button" onclick="updatePowerGridControl('groupBy', 'disposition')" style="padding: 5px 11px; border-radius: 6px; font-size: 0.74rem; font-weight: 700; border: none; cursor: pointer; background: ${powerGridState.groupBy === 'disposition' ? '#0284c7' : 'transparent'}; color: ${powerGridState.groupBy === 'disposition' ? '#fff' : 'var(--text-secondary)'};">
          🎯 By Force Disposition (→ Factions)
        </button>
        <button type="button" onclick="updatePowerGridControl('groupBy', 'faction')" style="padding: 5px 11px; border-radius: 6px; font-size: 0.74rem; font-weight: 700; border: none; cursor: pointer; background: ${powerGridState.groupBy === 'faction' ? '#0284c7' : 'transparent'}; color: ${powerGridState.groupBy === 'faction' ? '#fff' : 'var(--text-secondary)'};">
          🛡️ By Faction (→ Dispositions)
        </button>
        <button type="button" onclick="updatePowerGridControl('groupBy', 'combo')" style="padding: 5px 11px; border-radius: 6px; font-size: 0.74rem; font-weight: 700; border: none; cursor: pointer; background: ${powerGridState.groupBy === 'combo' ? '#0284c7' : 'transparent'}; color: ${powerGridState.groupBy === 'combo' ? '#fff' : 'var(--text-secondary)'};">
          🧬 Disposition × Faction Grid
        </button>
      </div>
    </div>

    <!-- 5 Force Disposition Quick-Filter Summary Cards -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(175px, 1fr)); gap: 0.55rem; margin-bottom: 0.9rem;">
      ${dispCardsHtml}
    </div>

    <!-- Interactive Filter Toolbar -->
    <div style="display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap; background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; padding: 0.6rem 0.75rem; margin-bottom: 0.85rem;">
      <div style="display: flex; align-items: center; gap: 0.35rem;">
        <label style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700;">Disposition:</label>
        <select onchange="updatePowerGridControl('dispositionSelect', this.value)" style="height: 30px; padding: 0 0.5rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: #fff; font-size: 0.76rem; cursor: pointer;">
          <option value="All" ${powerGridState.dispositionFilter === 'All' ? 'selected' : ''}>All Dispositions</option>
          ${CANONICAL_FORCE_DISPOSITIONS.map(d => `<option value="${escapeHtml(d.key)}" ${powerGridState.dispositionFilter === d.key ? 'selected' : ''}>${d.icon} ${escapeHtml(d.label)}</option>`).join('')}
        </select>
      </div>

      <div style="display: flex; align-items: center; gap: 0.35rem;">
        <label style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700;">Faction:</label>
        <select onchange="updatePowerGridControl('factionFilter', this.value)" style="height: 30px; max-width: 185px; padding: 0 0.5rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: #fff; font-size: 0.76rem; cursor: pointer;">
          <option value="All" ${powerGridState.factionFilter === 'All' ? 'selected' : ''}>All Factions (${allFactions.length})</option>
          ${allFactions.map(f => `<option value="${escapeHtml(f)}" ${powerGridState.factionFilter === f ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}
        </select>
      </div>

      <div style="display: flex; align-items: center; gap: 0.35rem;">
        <label style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700;">Min Reps:</label>
        <select onchange="updatePowerGridControl('minReps', this.value)" style="height: 30px; padding: 0 0.5rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: #fff; font-size: 0.76rem; cursor: pointer;">
          <option value="1" ${powerGridState.minReps === 1 ? 'selected' : ''}>1+ Pilots</option>
          <option value="2" ${powerGridState.minReps === 2 ? 'selected' : ''}>2+ Pilots</option>
          <option value="3" ${powerGridState.minReps === 3 ? 'selected' : ''}>3+ Pilots</option>
          <option value="5" ${powerGridState.minReps === 5 ? 'selected' : ''}>5+ Pilots</option>
          <option value="10" ${powerGridState.minReps === 10 ? 'selected' : ''}>10+ Pilots</option>
        </select>
      </div>

      <div style="display: flex; align-items: center; gap: 0.35rem;">
        <label style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700;">Sort By:</label>
        <select onchange="updatePowerGridControl('sortBy', this.value)" style="height: 30px; padding: 0 0.5rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: #fff; font-size: 0.76rem; cursor: pointer;">
          <option value="win_rate_desc" ${powerGridState.sortBy === 'win_rate_desc' ? 'selected' : ''}>Win Rate (High → Low)</option>
          <option value="win_rate_asc" ${powerGridState.sortBy === 'win_rate_asc' ? 'selected' : ''}>Win Rate (Low → High)</option>
          <option value="reps_desc" ${powerGridState.sortBy === 'reps_desc' ? 'selected' : ''}>Most Played (Reps)</option>
          <option value="wins_desc" ${powerGridState.sortBy === 'wins_desc' ? 'selected' : ''}>Total Wins</option>
          <option value="avg_pts_desc" ${powerGridState.sortBy === 'avg_pts_desc' ? 'selected' : ''}>Avg Battle Points</option>
        </select>
      </div>

      <div style="flex: 1; min-width: 150px;">
        <input id="power-grid-search-input" type="text" value="${escapeHtml(powerGridState.search)}" oninput="updatePowerGridControl('search', this.value)" placeholder="🔍 Filter faction, disposition, pilot..." style="width: 100%; height: 30px; box-sizing: border-box; padding: 0 0.6rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: #fff; font-size: 0.76rem;" />
      </div>

      ${powerGridState.groupBy !== 'combo' ? `
        <button type="button" class="btn-xs btn-outline" onclick="updatePowerGridControl('toggleExpandAll')" style="height: 30px; padding: 0 0.65rem; font-size: 0.72rem; color: #38bdf8; border-color: rgba(56,189,248,0.35); cursor: pointer; font-weight: 700;">
          ${powerGridState.expandAll ? '▲ Collapse All' : '▼ Expand All'}
        </button>
      ` : ''}

      ${hasActiveFilters ? `
        <button type="button" class="btn-xs btn-outline" onclick="updatePowerGridControl('reset')" style="height: 30px; padding: 0 0.65rem; font-size: 0.72rem; color: #f87171; border-color: rgba(248,113,113,0.35); cursor: pointer; font-weight: 700;">
          ✕ Reset Filters
        </button>
      ` : ''}
    </div>

    <!-- Dynamic Power Grid Table -->
    <div class="table-container">
      <table style="width: 100%; border-collapse: collapse; font-size: 0.82rem;">
        <thead>
          ${tableHeaderHtml}
        </thead>
        <tbody>
          ${tableBodyHtml || `
            <tr>
              <td colspan="7" style="padding: 2rem; text-align: center; color: var(--text-muted);">
                No entries match the current filter criteria. Try lowering Min Reps or resetting filters.
              </td>
            </tr>
          `}
        </tbody>
      </table>
    </div>
  `;
}

function renderDeepMetaMode(ev, players, matches) {
  // Dynamic Spiciness Index: Rogue Tech Overperforming
  const unitCounts = {};
  const unitPilots = {};
  players.forEach(p => {
    const units = extractKeyListUnits(p.army_list, p.faction);
    units.forEach(u => {
      unitCounts[u] = (unitCounts[u] || 0) + 1;
      if (!unitPilots[u]) unitPilots[u] = [];
      unitPilots[u].push(p);
    });
  });

  const rogueCards = [];
  const maxFieldThreshold = Math.max(1, Math.floor(players.length * 0.25));

  Object.entries(unitCounts).forEach(([unit, count]) => {
    if (count <= maxFieldThreshold) {
      const pilots = unitPilots[unit] || [];
      const winningPilots = pilots.filter(p => Number(p.event_wins || 0) >= 1 && Number(p.event_wins || 0) >= Number(p.event_losses || 0));
      winningPilots.forEach(p => {
        const sharePct = ((count / Math.max(1, players.length)) * 100).toFixed(1);
        rogueCards.push({
          unitName: unit.toUpperCase(),
          sharePct,
          count,
          pilotName: p.full_name,
          pilotId: p.player_id || p.id || '',
          faction: p.faction,
          detachment: p.detachment || 'Standard',
          record: `${p.event_wins || 0}-${p.event_losses || 0} Record`,
          wins: Number(p.event_wins || 0),
          note: `Selected ${unit} (${count} in field) under ${p.detachment || p.faction}, leveraging uncommon datasheet utility to pilot a winning record.`
        });
      });
    }
  });

  const CHARACTER_KEYWORDS = /\b(warboss|technomancer|trajann|blade champion|captain|lieutenant|overlord|farseer|autarch|archon|inquisitor|chaplain|librarian|commissar|succubus|canoness)\b/i;
  rogueCards.sort((a, b) => {
    const aChar = CHARACTER_KEYWORDS.test(a.unitName);
    const bChar = CHARACTER_KEYWORDS.test(b.unitName);
    if (aChar !== bChar) return aChar ? 1 : -1;
    return (b.wins - a.wins) || (a.count - b.count);
  });
  const diverseCards = [];
  const pilotsSeen = new Set();
  rogueCards.forEach(rc => {
    if (diverseCards.length < 4 && !pilotsSeen.has(rc.pilotName)) {
      diverseCards.push(rc);
      pilotsSeen.add(rc.pilotName);
    }
  });
  rogueCards.forEach(rc => {
    if (diverseCards.length < 4 && !diverseCards.includes(rc)) {
      diverseCards.push(rc);
    }
  });

  return `
    <!-- Interactive Detachment & Force Disposition Power Grid -->
    <div id="deep-meta-power-grid-mount" style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 1.15rem;">
      ${buildInteractivePowerGridHtml(ev, players, matches)}
    </div>

    <!-- Spicy Tech & Rogue Inclusions Spotlight -->
    <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 1.15rem;">
      <h4 style="margin: 0 0 0.85rem 0; font-size: 0.95rem; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 0.4rem;">
        <span>🌶️ The "Spiciness" Index: Rogue Tech & Unique Inclusions</span>
      </h4>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.85rem;">
        ${diverseCards.length > 0 ? diverseCards.map((rc, idx) => `
          <div style="background: rgba(15,23,42,0.85); border: 1px solid ${idx % 2 === 0 ? 'rgba(245, 158, 11, 0.3)' : 'rgba(56, 189, 248, 0.3)'}; border-radius: 8px; padding: 0.85rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
              <span style="font-weight: 800; color: ${idx % 2 === 0 ? '#f59e0b' : '#38bdf8'}; font-size: 0.84rem;">${escapeHtml(rc.unitName)}</span>
              <span class="badge" style="background: ${idx % 2 === 0 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(56, 189, 248, 0.15)'}; color: ${idx % 2 === 0 ? '#f59e0b' : '#38bdf8'}; font-size: 0.68rem;">${rc.sharePct}% FIELD SHARE</span>
            </div>
            <div style="font-size: 0.82rem; color: #fff; font-weight: 600;">${escapeHtml(rc.pilotName)} (${escapeHtml(rc.faction)}) • ${rc.record}</div>
            <div style="font-size: 0.74rem; color: var(--text-secondary); margin-top: 0.25rem; line-height: 1.4;">
              ${escapeHtml(rc.note)}
            </div>
          </div>
        `).join('') : `
          <div style="background: rgba(15,23,42,0.6); border-radius: 8px; padding: 1.25rem; text-align: center; color: var(--text-muted); font-size: 0.82rem; grid-column: 1 / -1;">
            Meta lists are following standard archetypes. No rogue datasheets (<= 25% field share) currently with winning records.
          </div>
        `}
      </div>
    </div>
  `;
}

function renderMediaExportMode(ev, players, matches) {
  const evName = ev.name || 'Tournament Event';
  const curRound = ev.current_round || 3;
  const venue = ev.venue || ev.city || 'Championship Series';

  // Sort players by tournament rank
  const sortedPlayers = [...players].sort((a, b) => {
    if (Number(b.event_wins || 0) !== Number(a.event_wins || 0)) {
      return Number(b.event_wins || 0) - Number(a.event_wins || 0);
    }
    return Number(b.event_battle_points || 0) - Number(a.event_battle_points || 0);
  });

  const top1 = sortedPlayers[0] || {};
  const top2 = sortedPlayers[1] || {};
  const top3 = sortedPlayers[2] || {};

  // Find top upset dynamically
  const upsets = [];
  matches.forEach(m => {
    if (m.is_bye || m.is_draw) return;
    const hasScores = m.player1_score !== null && m.player1_score !== undefined && m.player2_score !== null && m.player2_score !== undefined;
    const p1Score = Number(m.player1_score || 0);
    const p2Score = Number(m.player2_score || 0);
    let p1Won = false;
    let p2Won = false;
    if (m.winner_id) {
      p1Won = String(m.winner_id) === String(m.player1_id);
      p2Won = String(m.winner_id) === String(m.player2_id);
    } else if (hasScores) {
      p1Won = p1Score > p2Score;
      p2Won = p2Score > p1Score;
    }
    if (!p1Won && !p2Won) return;

    const wName = p1Won ? m.player1_name : m.player2_name;
    const lName = p1Won ? m.player2_name : m.player1_name;
    const wFac = p1Won ? (m.player1_faction || 'Army') : (m.player2_faction || 'Army');
    const wElo = p1Won ? Number(m.player1_elo || 1500) : Number(m.player2_elo || 1500);
    const lElo = p1Won ? Number(m.player2_elo || 1500) : Number(m.player1_elo || 1500);
    const gap = lElo - wElo;
    if (gap >= 25) {
      upsets.push({ winnerName: wName, loserName: lName, winnerFaction: wFac, gap });
    }
  });
  upsets.sort((a, b) => b.gap - a.gap);
  const topUpset = upsets[0];

  // Calculate top faction win rate
  const facStats = {};
  players.forEach(p => {
    const f = p.faction || 'Other';
    if (!facStats[f]) facStats[f] = { wins: 0, losses: 0 };
    facStats[f].wins += Number(p.event_wins || 0);
    facStats[f].losses += Number(p.event_losses || 0);
  });
  let topFactionName = 'Meta Standard';
  let topFactionWr = '0.0';
  let bestWr = -1;
  Object.entries(facStats).forEach(([f, s]) => {
    const tot = s.wins + s.losses;
    if (tot >= 2) {
      const wr = (s.wins / tot) * 100;
      if (wr > bestWr) {
        bestWr = wr;
        topFactionName = f;
        topFactionWr = wr.toFixed(1);
      }
    }
  });
  if (bestWr < 0 && players[0]?.faction) {
    topFactionName = players[0].faction;
    topFactionWr = '100.0';
  }

  const broadcastChannels = eventLiveStreams.map(s => s.channel).filter(Boolean);
  const broadcastStr = broadcastChannels.length > 0 ? broadcastChannels.join(' & ') : 'OmniTactica LiveDesk';

  const upsetText = topUpset 
    ? `🔥 **Biggest Upset:** ${topUpset.winnerName} (${topUpset.winnerFaction}) def. ${topUpset.loserName} (+${topUpset.gap.toFixed(0)} Elo Delta)\n`
    : `🛡️ **Tournament State:** Top seeds holding tables undefeated\n`;

  const discordText = `🏆 **${evName}**\n` +
    `📍 ${venue} • ${players.length} Competitors • Round ${curRound} Standings\n\n` +
    `🥇 **1st Place:** ${top1.full_name || 'Player'} (${top1.faction || 'Army'}) - ${top1.event_wins || 0}-${top1.event_losses || 0} (${top1.event_battle_points || 0} pts)\n` +
    (top2.full_name ? `🥈 **2nd Place:** ${top2.full_name} (${top2.faction || 'Army'}) - ${top2.event_wins || 0}-${top2.event_losses || 0} (${top2.event_battle_points || 0} pts)\n` : '') +
    (top3.full_name ? `🥉 **3rd Place:** ${top3.full_name} (${top3.faction || 'Army'}) - ${top3.event_wins || 0}-${top3.event_losses || 0} (${top3.event_battle_points || 0} pts)\n\n` : '\n') +
    `${upsetText}` +
    `📺 **Live Broadcast:** ${broadcastStr}\n` +
    `👉 View full live results & pairings on OmniTactica!`;

  return `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;" class="export-layout-grid">
      <!-- Left Column: Infographic Social Card Preview -->
      <div>
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.65rem;">
          <h4 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: #fff;">
            📸 Social Graphic / Stream Card Preview
          </h4>
          <span class="badge" style="font-size: 0.72rem; background: rgba(168,85,247,0.15); color: #c084fc;">READY TO POST</span>
        </div>

        <div class="export-preview-card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.75rem;">
            <div>
              <div style="font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #c084fc;">OMNITACTICA META SNAPSHOT</div>
              <div style="font-size: 1.15rem; font-weight: 900; color: #fff; margin-top: 0.15rem;">${escapeHtml(evName)}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.1rem;">Round ${curRound} Live Update • ${escapeHtml(venue)}</div>
            </div>
            <span style="font-size: 1.5rem;">🏆</span>
          </div>

          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.65rem; margin-bottom: 1rem; text-align: center;">
            <div style="background: rgba(255,255,255,0.04); padding: 0.65rem; border-radius: 8px;">
              <div style="font-size: 0.68rem; color: var(--text-muted);">TOP SEED</div>
              <div style="font-size: 0.95rem; font-weight: 800; color: #fff; margin-top: 0.2rem;">${escapeHtml(top1.full_name || 'Leader')}</div>
              <div style="font-size: 0.7rem; color: #38bdf8;">${top1.event_wins || 0}-${top1.event_losses || 0} (${top1.event_battle_points || 0} pts)</div>
            </div>
            <div style="background: rgba(255,255,255,0.04); padding: 0.65rem; border-radius: 8px;">
              <div style="font-size: 0.68rem; color: var(--text-muted);">GIANT SLAYER</div>
              <div style="font-size: 0.95rem; font-weight: 800; color: #ef4444; margin-top: 0.2rem;">${escapeHtml(topUpset?.winnerName || 'Chalk Field')}</div>
              <div style="font-size: 0.7rem; color: #ef4444;">${topUpset ? `+${topUpset.gap.toFixed(0)} Elo Upset` : 'No Upsets'}</div>
            </div>
            <div style="background: rgba(255,255,255,0.04); padding: 0.65rem; border-radius: 8px;">
              <div style="font-size: 0.68rem; color: var(--text-muted);">TOP FACTION</div>
              <div style="font-size: 0.95rem; font-weight: 800; color: #34d399; margin-top: 0.2rem;">${escapeHtml(topFactionName)}</div>
              <div style="font-size: 0.7rem; color: #34d399;">${topFactionWr}% Win Rate</div>
            </div>
          </div>

          <div style="font-size: 0.72rem; color: var(--text-muted); text-align: center; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 0.6rem;">
            Generated by OmniTactica Creator Studio • omnitactica.com
          </div>
        </div>
      </div>

      <!-- Right Column: One-Click Discord / Social Copier -->
      <div style="display: flex; flex-direction: column; gap: 0.85rem;">
        <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 1.15rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.65rem;">
            <h4 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: #fff;">
              📋 Discord / Reddit / Twitter Markdown
            </h4>
            <button type="button" onclick="copyDiscordSummary()" class="btn-sm btn-primary" style="font-size: 0.75rem; padding: 3px 10px; background: #5865F2; border-color: #4752C4; color: #fff; cursor: pointer;">
              Copy Discord Post
            </button>
          </div>
          <textarea id="creator-discord-text" rows="9" readonly style="width: 100%; box-sizing: border-box; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 0.65rem; font-family: monospace; font-size: 0.76rem; color: #e2e8f0; resize: none;">${discordText}</textarea>
        </div>

        <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 1rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;">
          <div>
            <div style="font-weight: 700; color: #fff; font-size: 0.86rem;">Raw Tournament Data Export</div>
            <div style="font-size: 0.74rem; color: var(--text-muted);">Download clean tournament data for podcast prep or spreadsheet analysis</div>
          </div>
          <div style="display: flex; gap: 0.4rem;">
            <button type="button" onclick="exportPairingsCsv()" class="btn-sm btn-outline" style="font-size: 0.75rem; cursor: pointer; color: #38bdf8;">
              📥 CSV Pairings
            </button>
            <button type="button" onclick="exportRosterJson()" class="btn-sm btn-outline" style="font-size: 0.75rem; cursor: pointer; color: #34d399;">
              📥 JSON Roster
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function exportPairingsCsv(eventId) {
  const evId = eventId || (typeof window !== 'undefined' && window.currentOpenEventId) || currentOpenEventId || (typeof window !== 'undefined' && window.currentEventData?.id) || currentEventData?.id || 'tournament';
  const matches = (typeof window !== 'undefined' && window.eventMatchesCache && window.eventMatchesCache.length > 0)
    ? window.eventMatchesCache
    : ((eventMatchesCache && eventMatchesCache.length > 0)
      ? eventMatchesCache
      : ((typeof window !== 'undefined' && window.currentEventData?.matches) || currentEventData?.matches || []));
  if (!matches || matches.length === 0) {
    if (typeof alert === 'function') alert('No pairing data available to export.');
    else console.warn('No pairing data available to export.');
    return;
  }

  const headers = ['Round', 'Table', 'Player 1', 'P1 Faction', 'P1 Elo', 'P1 Score', 'Player 2', 'P2 Faction', 'P2 Elo', 'P2 Score', 'Winner', 'Status'];
  const rows = matches.map(m => {
    const isCompleted = m.player1_score !== null && m.player1_score !== undefined && m.player2_score !== null && m.player2_score !== undefined;
    let winner = '';
    if (m.winner_name) {
      winner = m.winner_name;
    } else if (isCompleted) {
      if (Number(m.player1_score) > Number(m.player2_score)) winner = m.player1_name || 'Player 1';
      else if (Number(m.player2_score) > Number(m.player1_score)) winner = m.player2_name || 'Player 2';
      else winner = 'Tie / Draw';
    }
    const status = m.is_bye ? 'BYE' : (isCompleted ? 'Finished' : 'In Progress');
    return [
      m.round || 1,
      m.table_number || m.table || 1,
      `"${(m.player1_name || '').replace(/"/g, '""')}"`,
      `"${(m.player1_faction || '').replace(/"/g, '""')}"`,
      m.player1_elo || '',
      m.player1_score !== null && m.player1_score !== undefined ? m.player1_score : '',
      `"${(m.player2_name || '').replace(/"/g, '""')}"`,
      `"${(m.player2_faction || '').replace(/"/g, '""')}"`,
      m.player2_elo || '',
      m.player2_score !== null && m.player2_score !== undefined ? m.player2_score : '',
      `"${winner.replace(/"/g, '""')}"`,
      status
    ].join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${evId}_pairings.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  if (typeof showProfileToast === 'function') {
    showProfileToast('✓ Pairings CSV downloaded successfully!');
  }
}
window.exportPairingsCsv = exportPairingsCsv;

function exportRosterJson(eventId) {
  const evId = eventId || (typeof window !== 'undefined' && window.currentOpenEventId) || currentOpenEventId || (typeof window !== 'undefined' && window.currentEventData?.id) || currentEventData?.id || 'tournament';
  const players = (typeof window !== 'undefined' && window.eventPlayersCache && window.eventPlayersCache.length > 0)
    ? window.eventPlayersCache
    : ((eventPlayersCache && eventPlayersCache.length > 0)
      ? eventPlayersCache
      : ((typeof window !== 'undefined' && window.currentEventData?.players) || currentEventData?.players || []));
  if (!players || players.length === 0) {
    if (typeof alert === 'function') alert('No player roster data available to export.');
    else console.warn('No player roster data available to export.');
    return;
  }

  const exportData = {
    event_id: evId,
    event_name: currentEventData?.name || evId,
    exported_at: new Date().toISOString(),
    total_players: players.length,
    roster: players.map(p => ({
      player_id: p.player_id || p.id,
      name: p.full_name || p.name,
      faction: p.faction || '',
      detachment: p.detachment || '',
      current_elo: p.current_elo || 1500,
      record: {
        wins: Number(p.event_wins || 0),
        losses: Number(p.event_losses || 0),
        draws: Number(p.event_draws || 0),
        battle_points: Number(p.event_battle_points || 0)
      },
      team: p.team || '',
      army_list: p.army_list || ''
    }))
  };

  const jsonContent = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${evId}_roster.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  if (typeof showProfileToast === 'function') {
    showProfileToast('✓ Roster JSON downloaded successfully!');
  }
}
window.exportRosterJson = exportRosterJson;

// Helper: Extract top datasheets / characters from raw army list text
function extractKeyListUnits(listText, faction) {
  if (!listText || typeof listText !== 'string' || listText.trim().length === 0) {
    return [];
  }
  const lines = listText.split('\n');
  const found = [];
  const skipHeaderRe = /^(?:\+\+|==|--|•|\*|-|characters?\b|epic\s+hero(?:es)?\b|battleline\b|dedicated\s+transports?\b|other\s+datasheets?\b|allied\s+units?\b|allies\b|vehicles?\b|monsters?\b|infantry\b|mounted\b|beasts?\b|fortifications?\b|supreme\s+commanders?\b|detachment\b|force\s+disposition\b|battle\s+size\b|total\b|points\b|created\s+with\b|exported\s+with\b|army\s+roster\b|strike\s+force\b|incursion\b|onslaught\b|show\/hide\b)/i;
  lines.forEach(l => {
    const trimmed = l.trim();
    if (!trimmed || trimmed.length < 4 || trimmed.endsWith(':')) return;
    if (skipHeaderRe.test(trimmed)) return;
    const clean = trimmed.replace(/^[0-9]+x\s*/i, '').split('[')[0].split('(')[0].split(':')[0].trim();
    if (!clean || skipHeaderRe.test(clean)) return;
    if (!found.includes(clean) && clean.length > 2 && clean.length < 38) {
      found.push(clean);
    }
  });
  return found;
}

window.renderEventCreatorHub = renderEventCreatorHub;
window.renderCasterDeckMode = renderCasterDeckMode;
window.renderStreamStudioMode = renderStreamStudioMode;
window.renderStorylinesMode = renderStorylinesMode;
window.renderDeepMetaMode = renderDeepMetaMode;
window.renderMediaExportMode = renderMediaExportMode;

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
window.resolveEventCompetitorRecord = resolveEventCompetitorRecord;
window.renderPersonalEventScorecard = renderPersonalEventScorecard;
window.renderEventMetaAndHighlights = renderEventMetaAndHighlights;
window.copyEventHubLink = copyEventHubLink;
window.openEventPlayerListModal = openEventPlayerListModal;
window.copyEventArmyListModalText = copyEventArmyListModalText;
window.copyEventPlayerListModalText = copyEventArmyListModalText;
window.normalizeStreamRecord = normalizeStreamRecord;
window.loadEventLivestreams = loadEventLivestreams;
window.exportPairingsCsv = exportPairingsCsv;
window.exportRosterJson = exportRosterJson;
