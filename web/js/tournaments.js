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
        Viewing competitor tournament army rosters requires an active Best Coast Pairings subscription. Once subscribed, link your BCP account to unlock full in-app roster and Wahapedia datasheet enrichment.
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
      <td class="col-event-competitor">
        <div class="player-name-cell">
          <span class="player-link" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(p.full_name || 'Player')}">${escapeHtml(p.full_name || 'Player')}</span>
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
          <button type="button" class="btn-sm btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(safePid || safeName)}')" style="font-size:0.74rem; padding:3px 9px; font-weight:600; cursor:pointer;" title="View competitor army roster">
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

  // 1.4 Render Competitor Active Pairing Banner
  const compBanner = document.getElementById('event-matches-competitor-banner');
  if (compBanner) {
    const myActive = (eventMatchesCache || []).find(m => {
      const p1Id = String(m.player1_id || '').trim().toLowerCase();
      const p2Id = String(m.player2_id || '').trim().toLowerCase();
      const p1Name = String(m.player1_name || '').trim().toLowerCase();
      const p2Name = String(m.player2_name || '').trim().toLowerCase();
      const isMe = (uBannerIds.includes(p1Id) || uBannerIds.includes(p2Id) || uBannerNames.some(un => (p1Name && (un.includes(p1Name) || p1Name.includes(un))) || (p2Name && (un.includes(p2Name) || p2Name.includes(un)))));
      return isMe && (m.player1_score === null || m.player2_score === null) && m.status !== 'finished';
    });

    if (myActive) {
      const isP1 = uBannerIds.includes(String(myActive.player1_id || '').toLowerCase()) || uBannerNames.some(un => un.includes(String(myActive.player1_name || '').toLowerCase()));
      const oppName = isP1 ? (myActive.player2_name || 'BYE') : (myActive.player1_name || 'Opponent');
      const oppFac = isP1 ? (myActive.player2_faction || '') : (myActive.player1_faction || '');
      const tNum = myActive.table_number || myActive.table || 1;
      const rNum = myActive.round || 1;
      compBanner.style.display = 'flex';
      compBanner.innerHTML = `
        <div style="display:flex; align-items:center; gap:0.65rem; flex-wrap:wrap;">
          <span style="font-size:1.2rem;">⚡</span>
          <div>
            <div style="font-size:0.86rem; font-weight:800; color:#fff;">
              Round ${rNum} • Table ${tNum}: You vs <span style="color:#38bdf8;">${escapeHtml(oppName)}</span> ${oppFac ? `<span style="font-size:0.75rem; color:var(--text-muted); font-weight:normal;">(${escapeHtml(oppFac)})</span>` : ''}
            </div>
            <div style="font-size:0.74rem; color:#94a3b8;">
              Your active match is ready to play. Track live scores or submit to BCP via your Player Station.
            </div>
          </div>
        </div>
        <button type="button" class="btn btn-primary" onclick="switchEventModalTab('player')" style="font-size:0.76rem; font-weight:800; padding:5px 12px; background:#38bdf8; border-color:#0284c7; color:#000; cursor:pointer; display:inline-flex; align-items:center; gap:0.35rem; border-radius:6px;">
          ⚔️ Open My Player Station ➔
        </button>
      `;
    } else {
      compBanner.style.display = 'none';
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

      const tableNumVal = Number(m.table_number || m.table || 1);
      const matchStream = (typeof eventLiveStreams !== 'undefined' && eventLiveStreams)
        ? (eventLiveStreams.find(s => Number(s.tableNumber) === tableNumVal) || eventLiveStreams.find(s => Number(s.tableNumber) === 0))
        : null;

      const streamBtn = matchStream ? `
        <button type="button" class="btn-sm" style="font-size:0.72rem; padding:0.2rem 0.55rem; background:rgba(239,68,68,0.18); border:1px solid #ef4444; color:#fca5a5; border-radius:6px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:0.35rem;" onclick="event.stopPropagation(); openEventStreamModal(${matchStream.tableNumber})" title="Watch ${escapeHtml(matchStream.channel)} Live Stream ${Number(matchStream.tableNumber) === 0 ? '(Main Desk)' : `on Table ${matchStream.tableNumber}`}">
          <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#ef4444; box-shadow:0 0 6px #ef4444;"></span>
          🔴 Watch Live
        </button>
      ` : '';

      if (isP1 || isP2) {
        tr.style.background = 'rgba(59, 130, 246, 0.12)';
        tr.style.borderLeft = '3px solid #38bdf8';
      }

      tr.innerHTML = `
        <td style="font-family:var(--font-mono); font-weight:700;">R${m.round || 1}</td>
        <td style="font-family:var(--font-mono); color:${matchStream ? '#f87171' : 'var(--text-muted)'}; font-weight:${matchStream ? '800' : 'normal'};">
          T${tableNumVal}${matchStream ? ' <span title="Live Stream Available - Click to Watch" style="font-size:0.72rem; cursor:pointer;" onclick="event.stopPropagation(); openEventStreamModal(' + tableNumVal + ')">🎥</span>' : ''}
        </td>
        <td>
          <div class="player-name-cell">
            <div style="display:flex; align-items:center; flex-wrap:wrap; gap:2px;">
              <span class="player-link" style="color:${isP1Win ? 'var(--win)' : '#fff'}; font-weight:600;" onclick="event.stopPropagation(); if (typeof openPlayerProfilePage === 'function' && '${targetP1Id}') { openPlayerProfilePage('${targetP1Id}'); } else { openPlayerModal('${targetP1Id}', '${escapeHtml(targetP1Name)}'); }">
                ${escapeHtml(m.player1_name || 'Player 1')}
              </span>
              ${isP1 ? '<span class="badge" style="background:#0284c7; color:#fff; font-size:0.65rem; font-weight:800; padding:1px 5px; margin-left:4px; border:none;">YOU</span>' : ''}
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
                   ${isP2 ? '<span class="badge" style="background:#0284c7; color:#fff; font-size:0.65rem; font-weight:800; padding:1px 5px; margin-left:4px; border:none;">YOU</span>' : ''}
                   ${p2ProbPill}
                 </div>`
            }
            ${(!isBye && p2Faction) ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;"><span class="badge" style="background:var(--bg-card); border:1px solid var(--border); font-size:0.7rem; padding:0.1rem 0.35rem; border-radius:4px; font-weight:500;">${escapeHtml(p2Faction)}</span></div>` : ''}
          </div>
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:0.4rem; justify-content:flex-end; flex-wrap:wrap;">
            <span class="badge ${isP1Win || isP2Win ? 'badge-win' : (m.is_draw ? 'badge-draw' : 'badge-loss')}">${outcome}</span>
            ${streamBtn}
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
let currentEventArmyListText = '';
let currentEventParsedRoster = null;
let currentEventArmyListViewMode = 'text';

function getEventNumRounds(ev, matches = []) {
  if (!ev) return 5;
  const rawBcp = Number(
    ev.numberOfRounds ||
    ev.numRounds ||
    ev.raw_json?.numberOfRounds ||
    ev.raw_json?.numRounds ||
    0
  );
  if (rawBcp > 0) return rawBcp;

  const matchRounds = (Array.isArray(matches) && matches.length > 0)
    ? Math.max(...matches.map(m => Number(m.round || 1)))
    : 0;

  const dbRounds = Number(ev.num_rounds || ev.rounds || 0);

  // Swiss tournament sanity check: if DB rounds is <= 3 or 0, but competitor count is massive (Super Major / Major / GT)
  const totalCompetitors = Number(ev.total_players || (Array.isArray(ev.players) ? ev.players.length : 0));
  if ((dbRounds <= 3 || !dbRounds) && totalCompetitors >= 28) {
    if (totalCompetitors >= 256) return Math.max(matchRounds, 9); // Super Major (LVO, AdeptiCon)
    if (totalCompetitors >= 60) return Math.max(matchRounds, 6);  // Major
    return Math.max(matchRounds, 5); // Grand Tournament
  }

  return Math.max(dbRounds, matchRounds, 0);
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

  const hasActiveMatches = matches.some(m =>
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

  const rawEnd = ev?.end_date || ev?.endDate || ev?.raw_json?.endDate || ev?.raw_json?.end_date || '';
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
  if (numRounds > 0 && currentRound >= numRounds && matches.length > 0) {
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
  if (hasMatches && players.some(p => (p.placement === 1 || p.official_placement === 1) && (p.event_wins > 0 || p.wins > 0))) {
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
  currentEventData = ev;
  if (Array.isArray(ev.players)) eventPlayersCache = ev.players;
  if (Array.isArray(ev.matches)) eventMatchesCache = ev.matches;

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
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 0.75rem;">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span style="font-size: 1.3rem;">🏆</span>
              <div>
                <h3 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: #fff;">Tournament Concluded • Final Performance</h3>
                <div style="font-size: 0.78rem; color: #94a3b8;">Official results recorded on Best Coast Pairings</div>
              </div>
            </div>
            <span class="badge" style="font-size: 0.82rem; font-weight: 800; background: #10b981; color: #000; padding: 3px 10px;">FINISHER</span>
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
              <span class="badge" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); font-size:0.72rem; color:#cbd5e1;">IN PROGRESS</span>
            </div>
          </div>

          <!-- Matchup Grid -->
          <div style="display:grid; grid-template-columns: 1fr auto 1fr; gap: 1rem; align-items:center; margin-bottom: 1.25rem; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding: 1rem;">
            <!-- My Side -->
            <div style="text-align:left;">
              <div style="font-size:0.72rem; color:#38bdf8; font-weight:700; text-transform:uppercase;">YOU</div>
              <div style="font-size:1.1rem; font-weight:800; color:#fff; margin-top:2px;">${escapeHtml(myNameClean)}</div>
              ${myFaction ? `<div style="font-size:0.76rem; color:var(--text-muted); margin-top:3px;"><span class="badge" style="background:rgba(56,189,248,0.1); border:1px solid rgba(56,189,248,0.25); color:#7dd3fc; font-size:0.72rem;">${escapeHtml(myFaction)}</span></div>` : ''}
              <div style="margin-top:5px; font-size:0.72rem; font-family:var(--font-mono); color:#38bdf8; font-weight:700;">${myProb}% Win Prob</div>
            </div>

            <!-- VS Badge -->
            <div style="text-align:center;">
              <div style="font-size:0.85rem; font-weight:900; color:var(--text-muted); background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:50%; width:36px; height:36px; display:flex; align-items:center; justify-content:center; margin:0 auto;">VS</div>
              <div style="font-size:0.68rem; font-family:var(--font-mono); color:var(--text-muted); margin-top:4px;">T${tableNum}</div>
            </div>

            <!-- Opponent Side -->
            <div style="text-align:right;">
              <div style="font-size:0.72rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">OPPONENT</div>
              <div style="font-size:1.1rem; font-weight:800; color:#fff; margin-top:2px;">${escapeHtml(oppNameClean)}</div>
              ${oppFaction ? `<div style="font-size:0.76rem; color:var(--text-muted); margin-top:3px;"><span class="badge" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15); color:#cbd5e1; font-size:0.72rem;">${escapeHtml(oppFaction)}</span></div>` : ''}
              <div style="margin-top:5px; font-size:0.72rem; font-family:var(--font-mono); color:var(--text-muted); font-weight:700;">${oppProb}% Win Prob</div>
            </div>
          </div>

          <!-- Action Buttons Bar -->
          <div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:center;">
            <button type="button" class="btn btn-primary" onclick="launchTournamentTracker('${safeEventId}', ${roundNum}, ${tableNum}, '${escapeHtml(safeP1Name)}', '${escapeHtml(safeP2Name)}', '${escapeHtml(safeP1Id)}', '${escapeHtml(safeP2Id)}', '${escapeHtml(safePairingId)}')" style="flex:1; min-width:180px; font-size:0.88rem; font-weight:800; padding:0.65rem 1.25rem; background:linear-gradient(135deg, #0284c7, #2563eb); border:1px solid #38bdf8; box-shadow:0 0 15px rgba(56,189,248,0.3); color:#fff; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:0.45rem; border-radius:8px;">
              🎲 Track Live Game (Room)
            </button>
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
      const safeEvId = String(eventId).replace(/'/g, "\\'");

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
            You finished Round ${lastRound} against <strong>${escapeHtml(oppName)}</strong> with a score of <strong>${myScore} - ${oppScore}</strong> (${isWin ? '<span style="color:#4ade80; font-weight:700;">WIN</span>' : '<span style="color:#f87171; font-weight:700;">LOSS</span>'}). The Tournament Organizer is currently finalizing all remaining tables before drawing Round ${lastRound + 1}.
          </p>
          <div style="display:flex; gap:0.6rem; flex-wrap:wrap;">
            <button type="button" class="btn btn-outline" onclick="openEventHubPage('${safeEvId}', typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k', { initialTab: 'player', forceSync: true })" style="font-size:0.78rem; font-weight:700; padding:0.45rem 0.9rem; color:#38bdf8; border-color:rgba(56,189,248,0.4); background:rgba(56,189,248,0.08); cursor:pointer; display:inline-flex; align-items:center; gap:0.35rem;">
              🔄 Refresh Round Status
            </button>
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

function openEventPlayerListModal(playerIdentifier) {
  const q = String(playerIdentifier || '').trim().toLowerCase();
  let p = (eventPlayersCache || []).find(item => {
    const pid = String(item.player_id || item.id || '').trim().toLowerCase();
    const pname = String(item.full_name || item.name || '').trim().toLowerCase();
    return (pid && pid === q) || (pname && pname === q);
  });

  if (!p && typeof currentEventData !== 'undefined' && currentEventData) {
    const candidates = [
      ...(Array.isArray(currentEventData.players) ? currentEventData.players : []),
      ...(Array.isArray(currentEventData.standings) ? currentEventData.standings : []),
      ...(Array.isArray(currentEventData.roster) ? currentEventData.roster : []),
      ...(Array.isArray(currentEventData.unassigned) ? currentEventData.unassigned : [])
    ];
    p = candidates.find(item => {
      const pid = String(item.player_id || item.id || '').trim().toLowerCase();
      const pname = String(item.full_name || item.name || '').trim().toLowerCase();
      return (pid && pid === q) || (pname && pname === q);
    });
  }

  currentArmyListModalPlayer = p || { full_name: playerIdentifier, player_id: playerIdentifier };
  currentEventParsedRoster = p?._parsed_roster || null;
  currentEventArmyListText = '';

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
      if (typeof openPlayerProfilePage === 'function' && targetId) {
        openPlayerProfilePage(targetId);
      } else if (typeof openPlayerModal === 'function') {
        openPlayerModal(targetId, p?.full_name || '');
      }
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

function setEventArmyListViewMode(mode) {
  currentEventArmyListViewMode = mode || 'text';
  const btnText = document.getElementById('btn-army-list-mode-text');
  const btnEnriched = document.getElementById('btn-army-list-mode-enriched');
  const contentEl = document.getElementById('event-army-list-modal-content');
  if (!contentEl) return;

  if (btnText && btnEnriched) {
    if (mode === 'enriched') {
      btnEnriched.classList.add('active');
      btnText.classList.remove('active');
    } else {
      btnText.classList.add('active');
      btnEnriched.classList.remove('active');
    }
  }

  if (mode === 'enriched') {
    if (currentEventParsedRoster) {
      const renderer = window.renderNativeRosterViewer || (typeof renderNativeRosterViewer === 'function' ? renderNativeRosterViewer : null);
      if (renderer) {
        contentEl.innerHTML = renderer(currentEventParsedRoster, { mode: 'enriched' });
      } else {
        contentEl.innerHTML = `<pre style="padding:1.25rem; color:#e2e8f0; font-family:var(--font-mono); font-size:0.82rem; line-height:1.6; white-space:pre-wrap;">${escapeHtml(currentEventArmyListText)}</pre>`;
      }
    } else {
      // Show loading spinner while parsing with Wahapedia
      contentEl.innerHTML = `
        <div style="text-align:center; padding:3.5rem 1.5rem; margin:auto;">
          <div class="spinner-mini" style="display:inline-block; width:38px; height:38px; border:3px solid rgba(56,189,248,0.2); border-top-color:#38bdf8; border-radius:50%; animation:spin 0.8s linear infinite; margin-bottom:1rem;"></div>
          <div style="font-size:1.1rem; font-weight:700; color:#38bdf8; margin-bottom:0.35rem;">⚡ Enriching Roster with Wahapedia...</div>
          <div style="font-size:0.84rem; color:var(--text-muted);">Parsing datasheets, statlines, weapons, abilities & stratagems</div>
        </div>
      `;

      window.api.parseArmyList(currentEventArmyListText)
        .then(res => {
          if (res && res.success && res.army_list) {
            currentEventParsedRoster = res.army_list;
            if (currentArmyListModalPlayer) {
              currentArmyListModalPlayer._parsed_roster = res.army_list;
            }
            if (currentEventArmyListViewMode === 'enriched') {
              const renderer = window.renderNativeRosterViewer || (typeof renderNativeRosterViewer === 'function' ? renderNativeRosterViewer : null);
              if (renderer) {
                contentEl.innerHTML = renderer(currentEventParsedRoster, { mode: 'enriched' });
              } else {
                contentEl.innerHTML = `<pre style="padding:1.25rem; color:#e2e8f0; font-family:var(--font-mono); font-size:0.82rem; line-height:1.6; white-space:pre-wrap;">${escapeHtml(currentEventArmyListText)}</pre>`;
              }
            }
          } else {
            setEventArmyListViewMode('text');
            if (typeof showToast === 'function') {
              showToast('Wahapedia datasheet parser could not enrich this list format.', 'info');
            }
          }
        })
        .catch(err => {
          setEventArmyListViewMode('text');
        });
    }
  } else {
    // Raw Text mode
    contentEl.innerHTML = `
      <div style="padding:1.25rem; flex:1; display:flex; flex-direction:column; background:#070b14;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem; flex-wrap:wrap; gap:0.5rem;">
          <div style="font-size:0.84rem; font-weight:800; color:#38bdf8; display:flex; align-items:center; gap:0.4rem;">
            <span>📄</span> Raw Competitor Roster (Monospaced Format)
          </div>
        </div>
        <pre style="flex:1; margin:0; padding:1.15rem; background:#030712; border:1px solid rgba(255,255,255,0.08); border-radius:10px; font-family:var(--font-mono, monospace); font-size:0.82rem; line-height:1.6; color:#e2e8f0; white-space:pre-wrap; word-break:break-word; max-height:520px; overflow-y:auto;">${escapeHtml(currentEventArmyListText)}</pre>
      </div>
    `;
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

function selectActiveStream(idx) {
  creatorActiveStreamIndex = Number(idx) || 0;
  if (currentEventData) {
    renderEventCreatorHub(currentEventData);
  }
}
window.selectActiveStream = selectActiveStream;

function handleStreamTableSelectChange(val) {
  const customEl = document.getElementById('new-stream-custom-table');
  if (customEl) {
    if (val === 'custom') {
      customEl.style.display = 'inline-block';
      customEl.focus();
    } else {
      customEl.style.display = 'none';
    }
  }
}
window.handleStreamTableSelectChange = handleStreamTableSelectChange;

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
  const url = `${window.location.origin}/overlay?event=${encodeURIComponent(evId)}&table=${selectedCasterTable}&type=${overlayType || 'lower_third'}`;
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(url).then(() => {
      if (typeof showProfileToast === 'function') showProfileToast(`✓ OBS ${overlayType} URL copied!`);
      else alert(`OBS URL copied: ${url}`);
    }).catch(() => {});
  }
}
window.copyObsOverlayUrl = copyObsOverlayUrl;

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

  const players = Array.isArray(eventPlayersCache) && eventPlayersCache.length > 0 ? eventPlayersCache : (ev.players || []);
  const matches = Array.isArray(eventMatchesCache) && eventMatchesCache.length > 0 ? eventMatchesCache : (ev.matches || []);

  if (players.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:2.5rem 1rem;">No tournament roster data available for Creator Studio yet.</div>`;
    return;
  }

  // Determine rounds dynamically
  const matchRounds = [...new Set(matches.map(m => Number(m.round)).filter(r => r > 0))].sort((a, b) => a - b);
  const totalRounds = Number(ev.rounds_count || ev.rounds || ev.total_rounds) || (matchRounds.length > 0 ? Math.max(...matchRounds, Number(ev.current_round || 0)) : (Number(ev.current_round) || 5));

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
    selectedMatch = roundMatches.find(m => Number(m.table_number || m.table) === selectedCasterTable) || roundMatches[0];
    selectedCasterTable = Number(selectedMatch?.table_number || selectedMatch?.table || 1);

    p1 = players.find(p => String(p.player_id || p.id) === String(selectedMatch?.player1_id) || p.full_name === selectedMatch?.player1_name) || {
      full_name: selectedMatch.player1_name || 'Player 1',
      faction: selectedMatch.player1_faction || 'Army',
      detachment: 'Standard',
      current_elo: selectedMatch.player1_elo || 1500
    };
    p2 = players.find(p => String(p.player_id || p.id) === String(selectedMatch?.player2_id) || p.full_name === selectedMatch?.player2_name) || {
      full_name: selectedMatch.player2_name || 'Player 2',
      faction: selectedMatch.player2_faction || 'Army',
      detachment: 'Standard',
      current_elo: selectedMatch.player2_elo || 1500
    };

    p1Elo = Number(selectedMatch?.player1_elo || p1?.current_elo || 1500);
    p2Elo = Number(selectedMatch?.player2_elo || p2?.current_elo || 1500);

    const eloDiff = p2Elo - p1Elo;
    p1WinProb = Math.min(95, Math.max(5, Math.round(100 / (1 + Math.pow(10, eloDiff / 400)))));
    p2WinProb = 100 - p1WinProb;
  }

  // Header Banner & Mode Navigator
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
        Live commentator cheat sheet, side-by-side tale of the tape, livestream embed & OBS overlays, storyline upset tracking, and one-click broadcast social graphics.
      </div>
      <div class="creator-mode-tabs">
        <button type="button" class="creator-mode-btn ${creatorHubActiveMode === 'caster' ? 'active' : ''}" onclick="switchCreatorHubMode('caster')">
          <span>🎙️ Caster Desk</span>
        </button>
        <button type="button" class="creator-mode-btn ${creatorHubActiveMode === 'stream' ? 'active' : ''}" onclick="switchCreatorHubMode('stream')">
          <span>📺 Live Stream & OBS</span>
          <span class="badge" style="background:#ef4444; color:#fff; font-size:0.65rem; padding:1px 5px; border-radius:4px;">LIVE</span>
        </button>
        <button type="button" class="creator-mode-btn ${creatorHubActiveMode === 'storylines' ? 'active' : ''}" onclick="switchCreatorHubMode('storylines')">
          <span>⚔️ Storylines & Upsets</span>
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
  } else if (creatorHubActiveMode === 'storylines') {
    bodyHtml = renderStorylinesMode(ev, players, matches);
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
}
window.renderEventCreatorHub = renderEventCreatorHub;

/* ==========================================================================
   MODE 1: CASTER DECK (LIVE DESK & TALE OF THE TAPE)
   ========================================================================== */
function renderCasterDeckMode(ev, players, matches, roundMatches, selectedMatch, p1, p2, p1Elo, p2Elo, p1WinProb, p2WinProb, curRound, matchRounds, totalRounds) {
  curRound = curRound || selectedCasterRound || ev.current_round || 1;
  matchRounds = matchRounds || [...new Set(matches.map(m => Number(m.round)).filter(r => r > 0))].sort((a, b) => a - b);
  totalRounds = totalRounds || Number(ev.rounds_count || ev.rounds || ev.total_rounds) || (matchRounds.length > 0 ? Math.max(...matchRounds, Number(ev.current_round || 0)) : 5);

  const maxR = Math.max(totalRounds, matchRounds.length > 0 ? Math.max(...matchRounds) : 1, 1);
  const roundList = Array.from({ length: Math.min(maxR, 8) }, (_, i) => i + 1);

  const roundButtonsHtml = roundList.map(r => `
    <button type="button" onclick="selectCasterMatch(${selectedCasterTable || 1}, ${r})" class="btn-sm" style="padding: 2px 8px; font-size: 0.74rem; font-weight: 700; border-radius: 4px; border: 1px solid ${r === curRound ? '#38bdf8' : 'rgba(255,255,255,0.08)'}; background: ${r === curRound ? 'rgba(56,189,248,0.2)' : 'transparent'}; color: ${r === curRound ? '#fff' : 'var(--text-muted)'}; cursor: pointer;">
      R${r}
    </button>
  `).join('');

  // Case A: Real pairings exist for curRound
  if (roundMatches && roundMatches.length > 0 && selectedMatch && p1 && p2) {
    const tableButtons = roundMatches.map(m => {
      const tNum = Number(m.table_number || m.table || 1);
      const isSel = tNum === Number(selectedMatch?.table_number || selectedMatch?.table);
      const p1n = escapeHtml((m.player1_name || 'P1').split(' ')[0]);
      const p2n = escapeHtml((m.player2_name || 'P2').split(' ')[0]);
      return `
        <button type="button" onclick="selectCasterMatch(${tNum}, ${curRound})" class="btn-sm" style="padding: 0.4rem 0.75rem; border-radius: 6px; font-size: 0.76rem; font-weight: 700; cursor: pointer; border: 1px solid ${isSel ? 'var(--accent)' : 'rgba(255,255,255,0.08)'}; background: ${isSel ? 'rgba(56, 189, 248, 0.15)' : 'rgba(15,23,42,0.6)'}; color: ${isSel ? '#38bdf8' : 'var(--text-secondary)'};">
          Table ${tNum}: ${p1n} vs ${p2n}
        </button>
      `;
    }).join('');

    const p1Units = extractKeyListUnits(p1?.army_list, p1?.faction);
    const p2Units = extractKeyListUnits(p2?.army_list, p2?.faction);

    // Dynamic Head-to-Head
    let p1H2hWins = 0;
    let p2H2hWins = 0;
    const p1Id = String(p1?.player_id || p1?.id || '');
    const p2Id = String(p2?.player_id || p2?.id || '');
    const p1Name = p1?.full_name || '';
    const p2Name = p2?.full_name || '';

    matches.forEach(m => {
      const mP1Id = String(m.player1_id || '');
      const mP2Id = String(m.player2_id || '');
      const mP1Name = m.player1_name || '';
      const mP2Name = m.player2_name || '';
      const isMatch = (p1Id && p2Id && ((mP1Id === p1Id && mP2Id === p2Id) || (mP1Id === p2Id && mP2Id === p1Id))) ||
                      (!p1Id && mP1Name && mP2Name && ((mP1Name === p1Name && mP2Name === p2Name) || (mP1Name === p2Name && mP2Name === p1Name)));
      if (!isMatch) return;
      if (m.player1_score !== null && m.player2_score !== null && m.player1_score !== undefined && m.player2_score !== undefined) {
        const s1 = Number(m.player1_score);
        const s2 = Number(m.player2_score);
        if (mP1Id === p1Id || mP1Name === p1Name) {
          if (s1 > s2) p1H2hWins++;
          else if (s2 > s1) p2H2hWins++;
        } else {
          if (s2 > s1) p1H2hWins++;
          else if (s1 > s2) p2H2hWins++;
        }
      }
    });

    let h2hText = '';
    if (p1H2hWins > 0 || p2H2hWins > 0) {
      if (p1H2hWins > p2H2hWins) {
        h2hText = `${escapeHtml(p1Name)} leads ${p1H2hWins}-${p2H2hWins} in event matches`;
      } else if (p2H2hWins > p1H2hWins) {
        h2hText = `${escapeHtml(p2Name)} leads ${p2H2hWins}-${p1H2hWins} in event matches`;
      } else {
        h2hText = `Tied ${p1H2hWins}-${p2H2hWins} in event matches`;
      }
    } else {
      h2hText = `First meeting in tournament play`;
    }

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
    const isP1Favorite = p1Elo >= p2Elo;
    const underdogName = isP1Favorite ? (p2?.full_name || 'Player 2') : (p1?.full_name || 'Player 1');
    const underdogGain = isP1Favorite ? p2GainOnWin : p1GainOnWin;
    const favoriteName = isP1Favorite ? (p1?.full_name || 'Player 1') : (p2?.full_name || 'Player 2');
    const favoriteGain = isP1Favorite ? p1GainOnWin : p2GainOnWin;

    const hasScore = selectedMatch?.player1_score !== null && selectedMatch?.player1_score !== undefined && selectedMatch?.player2_score !== null && selectedMatch?.player2_score !== undefined;
    const scoreDisplay = hasScore ? `${selectedMatch.player1_score} - ${selectedMatch.player2_score}` : 'Live in Progress';

    return `
      <!-- Match Table Selector Row -->
      <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 0.85rem 1rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.65rem; flex-wrap: wrap;">
          <span style="font-size: 0.84rem; font-weight: 700; color: #fff;">
            🎯 Select Featured Broadcast Table (Round ${curRound}):
          </span>
          <div style="display: flex; gap: 0.4rem; align-items: center;">
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
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.65rem;">
          <div style="font-size: 0.95rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.5rem;">
            <span>⚔️ Table ${selectedMatch?.table_number || selectedCasterTable} Headline Clash</span>
            <span class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; font-size: 0.72rem; padding: 2px 7px;">Round ${curRound}</span>
          </div>
          <div style="display: flex; gap: 0.5rem;">
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
            <div style="font-size: 1.2rem; font-weight: 800; color: #fff;">${escapeHtml(p1?.full_name || 'Player 1')}</div>
            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
              <span class="badge" style="background: rgba(255,255,255,0.06); color: #e2e8f0; font-size: 0.74rem;">🛡️ ${escapeHtml(p1?.faction || 'Faction')}</span>
              <span class="badge" style="background: rgba(56,189,248,0.1); color: #7dd3fc; font-size: 0.74rem;">${escapeHtml(p1?.detachment || 'Standard Detachment')}</span>
              ${p1?.team ? `<span class="badge" style="background: rgba(255,255,255,0.04); color: var(--text-muted); font-size: 0.72rem;">👥 ${escapeHtml(p1.team)}</span>` : ''}
            </div>
            <div style="background: rgba(0,0,0,0.25); border-radius: 6px; padding: 0.5rem 0.65rem; font-size: 0.78rem; display: flex; flex-direction: column; gap: 0.25rem;">
              <div><strong>Event Record:</strong> ${p1?.event_wins || 0}W - ${p1?.event_losses || 0}L (${p1?.event_battle_points || 0} pts)</div>
              <div><strong>Core Units:</strong> ${p1Units.length > 0 ? escapeHtml(p1Units.slice(0, 3).join(', ')) : '<span style="color:var(--text-muted);">Standard Roster</span>'}</div>
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
          </div>

          <!-- Player 2 Card (Pink/Red) -->
          <div class="fighter-card p2">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 800; color: #f43f5e;">${p2Elo.toFixed(1)} Elo</span>
              <span class="badge" style="background: rgba(244, 63, 94, 0.15); color: #f43f5e; font-size: 0.72rem; font-weight: 700;">PLAYER 2</span>
            </div>
            <div style="font-size: 1.2rem; font-weight: 800; color: #fff; text-align: right;">${escapeHtml(p2?.full_name || 'Player 2')}</div>
            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; justify-content: flex-end;">
              ${p2?.team ? `<span class="badge" style="background: rgba(255,255,255,0.04); color: var(--text-muted); font-size: 0.72rem;">👥 ${escapeHtml(p2.team)}</span>` : ''}
              <span class="badge" style="background: rgba(244,63,94,0.1); color: #fda4af; font-size: 0.74rem;">${escapeHtml(p2?.detachment || 'Standard Detachment')}</span>
              <span class="badge" style="background: rgba(255,255,255,0.06); color: #e2e8f0; font-size: 0.74rem;">🛡️ ${escapeHtml(p2?.faction || 'Faction')}</span>
            </div>
            <div style="background: rgba(0,0,0,0.25); border-radius: 6px; padding: 0.5rem 0.65rem; font-size: 0.78rem; display: flex; flex-direction: column; gap: 0.25rem;">
              <div style="text-align: right;"><strong>Event Record:</strong> ${p2?.event_wins || 0}W - ${p2?.event_losses || 0}L (${p2?.event_battle_points || 0} pts)</div>
              <div style="text-align: right;"><strong>Core Units:</strong> ${p2Units.length > 0 ? escapeHtml(p2Units.slice(0, 3).join(', ')) : '<span style="color:var(--text-muted);">Standard Roster</span>'}</div>
            </div>
          </div>
        </div>

        <!-- Matchup Context & History Sub-strip -->
        <div style="margin-top: 1rem; padding-top: 0.85rem; border-top: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-around; flex-wrap: wrap; gap: 0.75rem; font-size: 0.8rem; color: var(--text-secondary);">
          <div>⚔️ <strong>Head-to-Head:</strong> ${h2hText}</div>
          <div>📊 <strong>Faction Matchup:</strong> ${facMatchupText}</div>
          <div>🏆 <strong>Current Table Score:</strong> <span style="font-family:var(--font-mono); font-weight:800; color:#fff;">${scoreDisplay}</span></div>
        </div>
      </div>

      <!-- CASTER TALKING POINTS / COMMENTARY CHEAT SHEET -->
      <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 1.15rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
          <h4 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 0.4rem;">
            <span>⚡ Caster Talking Points & Narrative Cues</span>
          </h4>
          <button type="button" onclick="copyCasterCheatSheet()" class="btn-sm btn-outline" style="font-size: 0.74rem; padding: 3px 9px; cursor: pointer; color: #38bdf8; border-color: rgba(56,189,248,0.3);">
            📋 Copy Cheat Sheet
          </button>
        </div>

        <div id="caster-cheat-sheet-content" style="display: flex; flex-direction: column; gap: 0.6rem;">
          <div class="caster-cue-card">
            <span style="font-size: 1.1rem; line-height: 1;">🔥</span>
            <div>
              <strong>Tournament Momentum:</strong> 
              ${escapeHtml(p1?.full_name)} (${p1?.event_wins || 0}W - ${p1?.event_losses || 0}L, ${p1?.event_battle_points || 0} pts) takes on ${escapeHtml(p2?.full_name)} (${p2?.event_wins || 0}W - ${p2?.event_losses || 0}L, ${p2?.event_battle_points || 0} pts) in Round ${curRound}.
            </div>
          </div>
          <div class="caster-cue-card">
            <span style="font-size: 1.1rem; line-height: 1;">🛡️</span>
            <div>
              <strong>Force Composition:</strong> 
              ${escapeHtml(p1?.full_name)} fields ${escapeHtml(p1?.faction || 'Army')} (${escapeHtml(p1?.detachment || 'Standard')}) matching up against ${escapeHtml(p2?.full_name)}'s ${escapeHtml(p2?.faction || 'Army')} (${escapeHtml(p2?.detachment || 'Standard')}).
            </div>
          </div>
          <div class="caster-cue-card">
            <span style="font-size: 1.1rem; line-height: 1;">🎯</span>
            <div>
              <strong>Key Tactical Assets:</strong> 
              ${(p1Units.length > 0 || p2Units.length > 0)
                ? `${escapeHtml(p1?.full_name)} features ${escapeHtml(p1Units.slice(0, 2).join(', ') || 'core roster')}. ${escapeHtml(p2?.full_name)} deploys ${escapeHtml(p2Units.slice(0, 2).join(', ') || 'core roster')}.`
                : `Tactical matchup between ${escapeHtml(p1?.faction || 'P1')} and ${escapeHtml(p2?.faction || 'P2')} with focus on primary objective control and battle tactics execution.`}
            </div>
          </div>
          <div class="caster-cue-card">
            <span style="font-size: 1.1rem; line-height: 1;">⚖️</span>
            <div>
              <strong>Elo & Bracket Stakes:</strong> 
              With a ${Math.abs(p1Elo - p2Elo).toFixed(1)} Elo differential, an upset win by ${escapeHtml(underdogName)} nets approx +${underdogGain} Elo, while a favorite win by ${escapeHtml(favoriteName)} awards +${favoriteGain} Elo.
            </div>
          </div>
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
            🎯 Select Featured Broadcast Table (Round ${curRound}):
          </span>
          <div style="display: flex; gap: 0.4rem; align-items: center;">
            <span style="font-size: 0.76rem; color: var(--text-muted);">Round:</span>
            ${roundButtonsHtml}
          </div>
        </div>
      </div>

      <div style="background: rgba(15, 23, 42, 0.8); border: 1px dashed rgba(56, 189, 248, 0.3); border-radius: 12px; padding: 2.5rem 1.5rem; text-align: center;">
        <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">⏳</div>
        <div style="font-size: 1.15rem; font-weight: 800; color: #fff; margin-bottom: 0.35rem;">
          Round ${curRound} Pairings Pending
        </div>
        <p style="color: var(--text-secondary); font-size: 0.85rem; max-width: 520px; margin: 0 auto 1.25rem; line-height: 1.5;">
          Official pairings for Round ${curRound} have not yet been posted by event organizers.
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
    return `
      <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.85rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem;">
          <div style="display: flex; align-items: center; gap: 0.4rem;">
            <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 800; font-size: 0.72rem;">SEED #${idx + 1}</span>
            <span style="font-weight: 800; color: #fff; font-size: 0.88rem;">${escapeHtml(p.full_name || 'Player')}</span>
          </div>
          <span style="font-family: var(--font-mono); font-weight: 800; color: #38bdf8; font-size: 0.85rem;">${elo} Elo</span>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.35rem;">
          ${escapeHtml(p.faction || 'Army')} • ${escapeHtml(p.detachment || 'Standard Detachment')}
          ${p.team ? ` • <span style="color:var(--text-muted);">${escapeHtml(p.team)}</span>` : ''}
        </div>
        ${units.length > 0 ? `
          <div style="font-size: 0.72rem; color: var(--text-muted); background: rgba(0,0,0,0.25); padding: 0.35rem 0.5rem; border-radius: 4px;">
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
        <div style="display: flex; gap: 0.4rem; align-items: center;">
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
            Field preview, top podium favorites, and opening commentary cues.
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
      <div style="margin-bottom: 1rem;">
        <div style="font-size: 0.85rem; font-weight: 800; color: #fff; margin-bottom: 0.6rem; display: flex; align-items: center; gap: 0.4rem;">
          <span>🌟 Top Seeded Contenders</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0.75rem;">
          ${topSeedsCardsHtml}
        </div>
      </div>
    </div>

    <!-- PRE-EVENT TALKING POINTS -->
    <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 1.15rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
        <h4 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 0.4rem;">
          <span>⚡ Pre-Event Commentator Narrative Cues</span>
        </h4>
        <button type="button" onclick="copyCasterCheatSheet()" class="btn-sm btn-outline" style="font-size: 0.74rem; padding: 3px 9px; cursor: pointer; color: #38bdf8; border-color: rgba(56,189,248,0.3);">
          📋 Copy Cheat Sheet
        </button>
      </div>

      <div id="caster-cheat-sheet-content" style="display: flex; flex-direction: column; gap: 0.6rem;">
        <div class="caster-cue-card">
          <span style="font-size: 1.1rem; line-height: 1;">🏆</span>
          <div>
            <strong>Podium Contenders:</strong> 
            Entering as top overall seed, ${escapeHtml(topSeedPlayer.full_name || 'The top seed')} (${Number(topSeedPlayer.current_elo || 1500).toFixed(1)} Elo, ${escapeHtml(topSeedPlayer.faction || 'Army')}) leads a competitive field of ${players.length} players.
          </div>
        </div>
        <div class="caster-cue-card">
          <span style="font-size: 1.1rem; line-height: 1;">📊</span>
          <div>
            <strong>Meta Distribution:</strong> 
            The field features ${facCountMap.size} unique factions with average competitor Elo at ${avgElo}. ${topFactions[0] ? `${escapeHtml(topFactions[0][0])} represents the single largest contingent with ${topFactions[0][1]} players.` : ''}
          </div>
        </div>
        <div class="caster-cue-card">
          <span style="font-size: 1.1rem; line-height: 1;">⚔️</span>
          <div>
            <strong>Round 1 Outlook:</strong> 
            Keep a close watch on opening round swiss pairings. Opening round upsets will deliver substantial Elo swings to underdogs battling the top seeds.
          </div>
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

  const tableOptions = [];
  const t1Match = curRoundTableMap.get(1);
  const t1Desc = t1Match ? ` — ${escapeHtml((t1Match.player1_name || 'P1').split(' ')[0])} vs ${escapeHtml((t1Match.player2_name || 'P2').split(' ')[0])}` : '';
  tableOptions.push(`<option value="1" selected>Table 1 (Feature Table)${t1Desc}</option>`);

  for (let t = 2; t <= totalTables; t++) {
    const tm = curRoundTableMap.get(t);
    const mDesc = tm ? ` — ${escapeHtml((tm.player1_name || 'P1').split(' ')[0])} vs ${escapeHtml((tm.player2_name || 'P2').split(' ')[0])}` : '';
    tableOptions.push(`<option value="${t}">Table ${t}${mDesc}</option>`);
  }
  tableOptions.push('<option value="0">All Tables / Main Desk (General Coverage)</option>');
  tableOptions.push('<option value="custom">✏️ Enter Custom Table #...</option>');

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

  const p1Name = p1?.full_name || selectedMatch?.player1_name || 'Player 1';
  const p2Name = p2?.full_name || selectedMatch?.player2_name || 'Player 2';
  const p1Fac = p1?.faction || selectedMatch?.player1_faction || 'Army';
  const p2Fac = p2?.faction || selectedMatch?.player2_faction || 'Army';
  const tableNum = selectedMatch?.table_number || selectedMatch?.table || selectedCasterTable || 1;
  const hasScore = selectedMatch?.player1_score !== null && selectedMatch?.player1_score !== undefined && selectedMatch?.player2_score !== null && selectedMatch?.player2_score !== undefined;
  const scoreStr = hasScore ? `${selectedMatch.player1_score} - ${selectedMatch.player2_score}` : '0 - 0';

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
                <input type="number" id="new-stream-custom-table" min="0" max="9999" placeholder="Table #" style="display: none; width: 85px; height: 32px; box-sizing: border-box; padding: 0 0.5rem; background: var(--bg-card); border: 1px solid #a855f7; border-radius: 6px; color: #fff; font-size: 0.78rem;" />
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
            <span style="font-size: 0.74rem; color: var(--text-muted);">
              ${escapeHtml(activeStream?.channel || 'Stream')} • ${Number(activeStream?.tableNumber) === 0 ? 'Main Desk / All Tables' : `Table ${activeStream?.tableNumber || 1}`}
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
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.65rem;">
            <div style="font-weight: 700; color: #fff; font-size: 0.92rem; display: flex; align-items: center; gap: 0.4rem;">
              <span>📺 OBS Studio Browser Source Overlays</span>
            </div>
            <span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; font-size: 0.7rem;">TRANSPARENT HUD</span>
          </div>
          <p style="font-size: 0.78rem; color: var(--text-secondary); margin: 0 0 0.85rem 0; line-height: 1.4;">
            Paste these URLs directly into OBS as a Browser Source (Width: 1920, Height: 250) for auto-updating live scoreboards!
          </p>

          <!-- Interactive OBS Overlay Preview Strip -->
          <div style="background: rgba(0, 0, 0, 0.7); border: 1px dashed rgba(56, 189, 248, 0.5); border-radius: 8px; padding: 0.75rem; margin-bottom: 0.85rem;">
            <div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 0.35rem; text-transform: uppercase; font-weight: 700;">OBS Overlay Canvas Preview (Lower-Third HUD):</div>
            <div style="display: flex; align-items: center; justify-content: space-between; background: linear-gradient(90deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95)); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 6px; padding: 0.55rem 0.85rem;">
              <div style="display: flex; align-items: center; gap: 0.6rem;">
                <span class="badge" style="background: #38bdf8; color: #000; font-weight: 800; font-size: 0.72rem;">TABLE ${tableNum}</span>
                <div>
                  <div style="font-weight: 800; color: #fff; font-size: 0.86rem;">${escapeHtml(p1Name)} (${escapeHtml(p1Fac)})</div>
                  <div style="font-size: 0.7rem; color: #38bdf8;">${Number(p1Elo || 1500).toFixed(1)} Elo • Round ${curRound}</div>
                </div>
              </div>
              <div style="font-family: var(--font-mono); font-weight: 900; font-size: 1.25rem; color: #f59e0b; padding: 0 0.75rem;">
                ${scoreStr}
              </div>
              <div style="display: flex; align-items: center; gap: 0.6rem; text-align: right;">
                <div>
                  <div style="font-weight: 800; color: #fff; font-size: 0.86rem;">${escapeHtml(p2Name)} (${escapeHtml(p2Fac)})</div>
                  <div style="font-size: 0.7rem; color: #f43f5e;">${Number(p2Elo || 1500).toFixed(1)} Elo • Round ${curRound}</div>
                </div>
                <span class="badge" style="background: #f43f5e; color: #fff; font-weight: 800; font-size: 0.72rem;">TABLE ${tableNum}</span>
              </div>
            </div>
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

function renderDeepMetaMode(ev, players, matches) {
  // Aggregate detachments
  const detMap = new Map();
  players.forEach(p => {
    const det = p.detachment || 'Standard Detachment';
    const fac = p.faction || 'Army';
    const key = `${fac} - ${det}`;
    if (!detMap.has(key)) {
      detMap.set(key, { faction: fac, detachment: det, count: 0, wins: 0, losses: 0, points: 0, topPlayer: p.full_name, topWins: -1 });
    }
    const item = detMap.get(key);
    item.count++;
    const pWins = Number(p.event_wins || 0);
    const pLosses = Number(p.event_losses || 0);
    item.wins += pWins;
    item.losses += pLosses;
    item.points += Number(p.event_battle_points || 0);
    if (pWins > item.topWins) {
      item.topWins = pWins;
      item.topPlayer = p.full_name;
    }
  });

  const detList = Array.from(detMap.values()).sort((a, b) => {
    const totalA = a.wins + a.losses;
    const totalB = b.wins + b.losses;
    const wrA = totalA > 0 ? (a.wins / totalA) : 0;
    const wrB = totalB > 0 ? (b.wins / totalB) : 0;
    if (wrB !== wrA) return wrB - wrA;
    return b.count - a.count;
  });

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
    <!-- Detachment Power Grid -->
    <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 1.15rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.85rem;">
        <h4 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: #fff;">
          🧬 Detachment & Force Disposition Power Grid
        </h4>
        <span style="font-size: 0.75rem; color: var(--text-muted);">${detList.length} Unique Detachments</span>
      </div>

      <div class="table-container">
        <table style="width: 100%; border-collapse: collapse; font-size: 0.82rem;">
          <thead>
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); text-align: left;">
              <th style="padding: 0.5rem;">Faction & Detachment</th>
              <th style="padding: 0.5rem; text-align: center;">Reps</th>
              <th style="padding: 0.5rem; text-align: center;">Record (W-L)</th>
              <th style="padding: 0.5rem; text-align: center;">Win Rate</th>
              <th style="padding: 0.5rem; text-align: right;">Avg Battle Pts</th>
              <th style="padding: 0.5rem; text-align: right;">Top Pilot</th>
            </tr>
          </thead>
          <tbody>
            ${detList.map(d => {
              const total = d.wins + d.losses;
              const wr = total > 0 ? ((d.wins / total) * 100).toFixed(1) : '0.0';
              const avgPts = d.count > 0 ? (d.points / d.count).toFixed(0) : '0';
              return `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                  <td style="padding: 0.5rem;">
                    <div style="font-weight: 700; color: #fff;">${escapeHtml(d.detachment)}</div>
                    <div style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(d.faction)}</div>
                  </td>
                  <td style="padding: 0.5rem; text-align: center; font-family: var(--font-mono);">${d.count}</td>
                  <td style="padding: 0.5rem; text-align: center; font-family: var(--font-mono);">${d.wins}-${d.losses}</td>
                  <td style="padding: 0.5rem; text-align: center; font-family: var(--font-mono); font-weight: 700; color: ${Number(wr) >= 55 ? '#4ade80' : (Number(wr) <= 45 ? '#f87171' : '#fff')};">
                    ${wr}%
                  </td>
                  <td style="padding: 0.5rem; text-align: right; font-family: var(--font-mono);">${avgPts}</td>
                  <td style="padding: 0.5rem; text-align: right; color: #38bdf8; font-weight: 600;">${escapeHtml(d.topPlayer)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
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
  lines.forEach(l => {
    const trimmed = l.trim();
    if (trimmed.startsWith('++') || trimmed.startsWith('Characters:') || trimmed.startsWith('Battleline:') || trimmed.startsWith('Vehicles:') || trimmed.startsWith('Infantry:') || trimmed.startsWith('Detachment') || trimmed.length < 4) return;
    const clean = trimmed.replace(/^[0-9]+x\s*/, '').split('[')[0].split('(')[0].split(':')[0].trim();
    if (clean && !found.includes(clean) && clean.length > 2 && clean.length < 35) {
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
