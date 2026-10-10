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

function extractEventLocationDetails(ev) {
  if (!ev || typeof ev !== 'object') {
    return {
      venue: '',
      venueLine: '',
      streetAddress: '',
      formattedAddress: '',
      addressLine: '',
      fullAddressLine: '',
      city: '',
      state: '',
      country: '',
      postalCode: '',
      latitude: null,
      longitude: null,
      lat: null,
      lng: null,
      hasCoords: false,
      cityStateCountry: '',
      shortLabel: 'Online / Unspecified',
      fullDisplay: 'Online / Unspecified',
      displayLabel: 'Online / Unspecified',
      mapQuery: '',
      mapSearchQuery: '',
      directionsUrl: '',
      embedUrl: '',
      hasMapTarget: false,
      hasLocation: false
    };
  }
  const rj = (ev.raw_json && typeof ev.raw_json === 'object') ? ev.raw_json : {};
  const loc = (ev.location && typeof ev.location === 'object') ? ev.location : ((rj.location && typeof rj.location === 'object') ? rj.location : {});

  const city = String(ev.city || rj.city || loc.city || '').trim();
  const state = String(ev.state || rj.state || loc.state || '').trim();
  const country = String(ev.country || rj.country || loc.country || '').trim();
  const postalCode = String(ev.postal_code || ev.zip || rj.zip || rj.postalCode || loc.zip || loc.postalCode || '').trim();

  let rawVenue = String(
    ev.venue_name || ev.venue || ev.locationName || ev.venueName ||
    rj.locationName || rj.venueName || rj.venue ||
    loc.venueName || loc.venue || loc.name || ''
  ).trim();
  if (rawVenue && city && rawVenue.toLowerCase() === city.toLowerCase()) {
    rawVenue = '';
  }

  const sNum = String(ev.streetNum || rj.streetNum || loc.streetNum || '').trim();
  const sName = String(ev.streetName || rj.streetName || loc.streetName || '').trim();
  const streetCombined = (sNum || sName) ? `${sNum} ${sName}`.trim() : '';
  const rawFormatted = String(
    ev.formatted_address || ev.formattedAddress || ev.address ||
    rj.formatted_address || rj.formattedAddress || rj.address ||
    loc.formatted_address || loc.formattedAddress || ''
  ).trim();

  let streetAddress = String(ev.street_address || streetCombined || loc.address || loc.streetAddress || '').trim();
  if (!streetAddress && rawFormatted && rawFormatted.includes(',')) {
    const firstPart = rawFormatted.split(',')[0].trim();
    const fpLower = firstPart.toLowerCase();
    if (
      firstPart &&
      fpLower !== city.toLowerCase() &&
      fpLower !== state.toLowerCase() &&
      fpLower !== country.toLowerCase() &&
      fpLower !== rawVenue.toLowerCase()
    ) {
      streetAddress = firstPart;
    }
  }

  const cscParts = [];
  const seenCsc = new Set();
  [city, state, country].forEach(part => {
    const clean = String(part || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (!seenCsc.has(key)) {
      seenCsc.add(key);
      cscParts.push(clean);
    }
  });
  const cityStateCountry = cscParts.join(', ');

  let formattedAddress = rawFormatted.replace(/\b(\d{5}(?:-\d{4})?)\s+\1\b/g, '$1');
  if (!formattedAddress) {
    formattedAddress = [streetAddress, city, state ? `${state} ${postalCode}`.trim() : postalCode, country].filter(Boolean).join(', ');
  } else if (country) {
    const faLower = formattedAddress.toLowerCase();
    const cLower = country.toLowerCase();
    const isUsMatch = (cLower === 'united states' || cLower === 'usa' || cLower === 'us') && (faLower.includes('usa') || faLower.includes('united states'));
    if (!faLower.includes(cLower) && !isUsMatch) {
      formattedAddress = `${formattedAddress}, ${country}`;
    }
  }

  let lat = (ev.latitude !== undefined && ev.latitude !== null && ev.latitude !== '') ? Number(ev.latitude) : null;
  let lng = (ev.longitude !== undefined && ev.longitude !== null && ev.longitude !== '') ? Number(ev.longitude) : null;
  if (lat === null || Number.isNaN(lat) || lng === null || Number.isNaN(lng)) {
    const coords = ev.coordinate || rj.coordinate || loc.coordinate || (rj.coordinate_point && rj.coordinate_point.coordinates);
    if (Array.isArray(coords) && coords.length >= 2) {
      const cLng = Number(coords[0]);
      const cLat = Number(coords[1]);
      if (!Number.isNaN(cLat) && !Number.isNaN(cLng)) {
        lat = cLat;
        lng = cLng;
      }
    }
  }
  if (lat !== null && (Number.isNaN(lat) || Number.isNaN(lng) || (lat === 0 && lng === 0))) {
    lat = null;
    lng = null;
  }
  const hasCoords = Boolean(lat !== null && lng !== null);

  const addressLine = formattedAddress || [streetAddress, cityStateCountry].filter(Boolean).join(', ');
  const fullParts = [];
  if (rawVenue) fullParts.push(rawVenue);
  if (addressLine) {
    if (!rawVenue || !addressLine.toLowerCase().startsWith(rawVenue.toLowerCase())) {
      fullParts.push(addressLine);
    } else {
      fullParts.length = 0;
      fullParts.push(addressLine);
    }
  } else if (cityStateCountry) {
    fullParts.push(cityStateCountry);
  }
  const fullDisplay = fullParts.join(' — ') || cityStateCountry || 'Online / Unspecified';
  const fullAddressLine = fullParts.join(', ') || addressLine || cityStateCountry || '';
  const shortLabel = [rawVenue, cityStateCountry].filter(Boolean).join(' • ') || addressLine || 'Online / Unspecified';

  const displayParts = [];
  if (rawVenue) displayParts.push(rawVenue);
  if (streetAddress && (!rawVenue || !rawVenue.toLowerCase().includes(streetAddress.toLowerCase()))) {
    displayParts.push(streetAddress);
  }
  if (cityStateCountry && (!streetAddress || !streetAddress.toLowerCase().includes(cityStateCountry.toLowerCase()))) {
    displayParts.push(cityStateCountry);
  } else if (!streetAddress && addressLine && (!rawVenue || addressLine.toLowerCase() !== rawVenue.toLowerCase())) {
    displayParts.push(addressLine);
  }
  const displayLabel = displayParts.join(' • ') || fullDisplay || 'Online / Unspecified';

  const mapQuery = [rawVenue, formattedAddress || streetAddress, !formattedAddress ? cityStateCountry : ''].filter(Boolean).join(', ');
  const hasMapTarget = Boolean(
    hasCoords ||
    (mapQuery && !['online / unspecified', 'unspecified', 'online', 'unspecified location'].includes(mapQuery.toLowerCase()))
  );
  const embedTarget = mapQuery || (hasCoords ? `${lat},${lng}` : '');
  const directionsUrl = embedTarget ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(embedTarget)}` : '';
  const embedUrl = embedTarget ? `https://maps.google.com/maps?q=${encodeURIComponent(embedTarget)}&z=15&output=embed` : '';

  return {
    venue: rawVenue,
    venueLine: rawVenue || cityStateCountry,
    streetAddress,
    formattedAddress,
    addressLine,
    fullAddressLine,
    city,
    state,
    country,
    postalCode,
    latitude: lat,
    longitude: lng,
    lat,
    lng,
    hasCoords,
    cityStateCountry,
    shortLabel,
    fullDisplay,
    displayLabel,
    mapQuery,
    mapSearchQuery: mapQuery,
    directionsUrl,
    embedUrl,
    hasMapTarget,
    hasLocation: hasMapTarget
  };
}
window.extractEventLocationDetails = extractEventLocationDetails;

function resolveEventObjById(eventIdOrObj) {
  if (eventIdOrObj && typeof eventIdOrObj === 'object') return eventIdOrObj;
  const eid = String(eventIdOrObj || currentOpenEventId || '').trim();
  if (!eid) return currentEventData || null;
  if (currentEventData && String(currentEventData.id || currentEventData.event_id) === eid) {
    return currentEventData;
  }
  if (typeof getWarmEventModalCache === 'function') {
    const warm = getWarmEventModalCache(eid);
    if (warm && warm.ev) return warm.ev;
  }
  if (typeof eventsData !== 'undefined' && Array.isArray(eventsData)) {
    const hit = eventsData.find(e => e && String(e.id) === eid);
    if (hit) return hit;
  }
  if (typeof communityState !== 'undefined' && communityState) {
    const pools = [
      communityState.majorsList,
      communityState.overview?.events_upcoming,
      communityState.overview?.events_recent,
      communityState.overview?.upcoming_events,
      communityState.overview?.recent_events
    ];
    for (const arr of pools) {
      if (Array.isArray(arr)) {
        const hit = arr.find(e => e && String(e.id || e.event_id) === eid);
        if (hit) return hit;
      }
    }
  }
  if (typeof myHubData !== 'undefined' && myHubData) {
    const hubPools = [myHubData.registered_tournaments, myHubData.upcoming_events, myHubData.events_attended];
    for (const arr of hubPools) {
      if (Array.isArray(arr)) {
        const hit = arr.find(e => e && String(e.bcp_event_id || e.id || e.event_id) === eid);
        if (hit) return hit;
      }
    }
  }
  return null;
}
window.resolveEventObjById = resolveEventObjById;

function buildEventModalMetaHtml(ev, numRounds = 0) {
  if (!ev) return '';
  const locInfo = extractEventLocationDetails(ev);
  const dStr = (typeof formatEventDateRangeLabel === 'function' ? formatEventDateRangeLabel(ev) : '') || (ev.event_date || ev.start_date || '').slice(0, 10) || 'Date TBD';
  const rdsNum = Number(numRounds || ev.num_rounds || ev.numberOfRounds || 0);
  const rdsPart = rdsNum > 0 ? `<span>•</span><span>🔄 ${rdsNum} Rounds</span>` : '';
  const eidSafe = escapeHtml(String(ev.id || ev.event_id || currentOpenEventId || '').replace(/'/g, "\\'"));
  const mapBtns = locInfo.hasMapTarget ? `
    <button type="button" onclick="event.stopPropagation(); openEventVenueMapModal('${eidSafe}')" style="display:inline-flex; align-items:center; gap:3px; font-size:0.72rem; font-weight:700; padding:2px 8px; border-radius:6px; background:rgba(56,189,248,0.14); color:#38bdf8; border:1px solid rgba(56,189,248,0.35); cursor:pointer;" title="View venue address & interactive map">
      🗺️ Map
    </button>
    <button type="button" onclick="event.stopPropagation(); openEventInCommunityGameStores('${eidSafe}')" style="display:inline-flex; align-items:center; gap:3px; font-size:0.72rem; font-weight:700; padding:2px 8px; border-radius:6px; background:rgba(16,185,129,0.14); color:#34d399; border:1px solid rgba(16,185,129,0.35); cursor:pointer;" title="View venue & nearby stores in Community Hub → Game Stores">
      🏪 Stores Hub
    </button>
  ` : '';
  return `
    <span style="display:inline-flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
      <span>📅 ${escapeHtml(dStr)}</span>
      <span>•</span>
      <span style="color:#e2e8f0; font-weight:600;" title="${escapeHtml(locInfo.fullDisplay)}">📍 ${escapeHtml(locInfo.fullDisplay)}</span>
      ${mapBtns}
      ${rdsPart}
    </span>
  `;
}
window.buildEventModalMetaHtml = buildEventModalMetaHtml;

function copyEventVenueAddress(addressText) {
  const txt = String(addressText || '').trim();
  if (!txt) return;
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(txt).then(() => {
      if (typeof showProfileToast === 'function') {
        showProfileToast('✓ Venue address copied to clipboard!');
      } else if (typeof showToast === 'function') {
        showToast('Venue address copied to clipboard!', 'success');
      }
    }).catch(() => {});
  }
}
window.copyEventVenueAddress = copyEventVenueAddress;

function closeEventVenueMapModal() {
  const modal = document.getElementById('event-venue-map-modal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
  if (typeof modalStack !== 'undefined' && Array.isArray(modalStack)) {
    modalStack = modalStack.filter(id => id !== 'event-venue-map-modal');
  }
  if (typeof window !== 'undefined' && Array.isArray(window.modalStack)) {
    window.modalStack = window.modalStack.filter(id => id !== 'event-venue-map-modal');
  }
}
window.closeEventVenueMapModal = closeEventVenueMapModal;

async function openEventVenueMapModal(eventIdOrObj) {
  let ev = resolveEventObjById(eventIdOrObj);
  const eid = (ev && (ev.id || ev.event_id)) || (typeof eventIdOrObj === 'string' ? eventIdOrObj : currentOpenEventId) || '';
  if (!ev && eid && window.api && typeof window.api.getTournamentDetails === 'function') {
    try {
      ev = await window.api.getTournamentDetails(eid, false);
    } catch (_) {}
  }
  const locInfo = extractEventLocationDetails(ev || {});
  const eventName = (ev && (ev.name || ev.event_name || ev.raw_json?.name)) || 'Tournament Venue';

  let modal = document.getElementById('event-venue-map-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'event-venue-map-modal';
    modal.className = 'modal-backdrop';
    modal.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(2,6,23,0.82); backdrop-filter:blur(6px); z-index:10050; align-items:center; justify-content:center; padding:1rem;';
    modal.onclick = (e) => {
      if (e.target === modal) closeEventVenueMapModal();
    };
    document.body.appendChild(modal);
  }

  const copyTarget = [locInfo.venue, locInfo.addressLine || locInfo.cityStateCountry].filter(Boolean).join(', ');
  const safeCopyTarget = escapeHtml(copyTarget.replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  const safeEid = escapeHtml(String(eid).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));

  modal.innerHTML = `
    <div class="modal-window" style="max-width:720px; width:100%; background:linear-gradient(165deg, #0f172a, #090d16); border:1px solid rgba(56,189,248,0.35); border-radius:14px; overflow:hidden; box-shadow:0 24px 60px rgba(0,0,0,0.8);">
      <div class="modal-header" style="padding:1rem 1.25rem; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; align-items:flex-start; justify-content:space-between; gap:0.75rem;">
        <div style="min-width:0; flex:1;">
          <div style="display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap; margin-bottom:0.25rem;">
            <span class="badge" style="background:rgba(56,189,248,0.16); color:#38bdf8; border:1px solid rgba(56,189,248,0.35); font-size:0.7rem; font-weight:800;">📍 VENUE &amp; LOCATION MAP</span>
            ${locInfo.cityStateCountry ? `<span class="badge" style="background:rgba(16,185,129,0.14); color:#34d399; border:1px solid rgba(16,185,129,0.32); font-size:0.7rem; font-weight:700;">🌎 ${escapeHtml(locInfo.cityStateCountry)}</span>` : ''}
          </div>
          <h3 style="margin:0; font-size:1.12rem; font-weight:800; color:#fff; line-height:1.3;">${escapeHtml(locInfo.venue || eventName)}</h3>
          <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:0.2rem;">${escapeHtml(eventName)}</div>
        </div>
        <button type="button" class="modal-close" onclick="closeEventVenueMapModal()" aria-label="Close venue map modal" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#cbd5e1; border-radius:8px; width:32px; height:32px; cursor:pointer; font-size:0.95rem;">✕</button>
      </div>

      <div class="modal-body" style="padding:1.1rem 1.25rem;">
        <!-- Venue & Street Address Box -->
        <div style="background:rgba(15,23,42,0.8); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:0.85rem 1rem; margin-bottom:0.95rem; display:flex; align-items:center; justify-content:space-between; gap:0.75rem; flex-wrap:wrap;">
          <div style="min-width:0; flex:1;">
            ${locInfo.venue ? `<div style="font-weight:800; color:#f8fafc; font-size:0.95rem; margin-bottom:0.2rem;">🏪 ${escapeHtml(locInfo.venue)}</div>` : ''}
            <div style="font-size:0.85rem; color:#cbd5e1; line-height:1.45; word-break:break-word;">
              📍 ${escapeHtml(locInfo.addressLine || locInfo.cityStateCountry || 'Address not specified')}
            </div>
            ${locInfo.cityStateCountry && locInfo.addressLine && locInfo.addressLine !== locInfo.cityStateCountry ? `
              <div style="font-size:0.76rem; color:#94a3b8; margin-top:0.2rem;">
                🌎 ${escapeHtml(locInfo.cityStateCountry)}${locInfo.postalCode && !locInfo.addressLine.includes(locInfo.postalCode) ? ` • ${escapeHtml(locInfo.postalCode)}` : ''}
              </div>
            ` : ''}
          </div>
          <div style="display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap;">
            <button type="button" class="btn btn-outline" onclick="copyEventVenueAddress('${safeCopyTarget}')" style="font-size:0.76rem; font-weight:700; padding:0.38rem 0.75rem;">
              📋 Copy Address
            </button>
          </div>
        </div>

        <!-- Embedded Google Map -->
        ${locInfo.embedUrl ? `
          <div style="width:100%; height:320px; border-radius:10px; overflow:hidden; border:1px solid rgba(56,189,248,0.28); background:#070b14; margin-bottom:1rem;">
            <iframe
              title="Venue Map for ${escapeHtml(locInfo.venue || eventName)}"
              src="${escapeHtml(locInfo.embedUrl)}"
              width="100%"
              height="100%"
              style="border:0; filter:contrast(1.02);"
              loading="lazy"
              referrerpolicy="no-referrer-when-downgrade"
              allowfullscreen>
            </iframe>
          </div>
        ` : `
          <div style="padding:2rem 1rem; text-align:center; color:var(--text-muted); background:rgba(15,23,42,0.5); border-radius:10px; border:1px dashed rgba(255,255,255,0.12); margin-bottom:1rem;">
            Exact map coordinates are not listed for this event.
          </div>
        `}

        <!-- Action Buttons: Community Hub Game Stores + External Google Maps Directions -->
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.65rem; flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" onclick="openEventInCommunityGameStores('${safeEid}')" style="flex:1; min-width:220px; justify-content:center; font-size:0.82rem; font-weight:800; padding:0.58rem 1rem; background:linear-gradient(135deg, #0284c7, #0369a1); border:1px solid #38bdf8;">
            🏪 View in Community Hub → Game Stores
          </button>
          ${locInfo.directionsUrl ? `
            <a href="${escapeHtml(locInfo.directionsUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="flex:1; min-width:190px; justify-content:center; font-size:0.82rem; font-weight:700; padding:0.58rem 1rem; text-decoration:none; color:#38bdf8; border-color:rgba(56,189,248,0.4);">
              🧭 Google Maps Directions ↗
            </a>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  modal.style.display = 'flex';
  if (typeof bringModalToFront === 'function') {
    bringModalToFront(modal);
  } else {
    modal.classList.add('active');
  }
}
window.openEventVenueMapModal = openEventVenueMapModal;

async function openEventInCommunityGameStores(eventIdOrObj) {
  let ev = resolveEventObjById(eventIdOrObj);
  const eid = (ev && (ev.id || ev.event_id)) || (typeof eventIdOrObj === 'string' ? eventIdOrObj : currentOpenEventId) || '';
  if (!ev && eid && window.api && typeof window.api.getTournamentDetails === 'function') {
    try {
      ev = await window.api.getTournamentDetails(eid, false);
    } catch (_) {}
  }
  const locInfo = extractEventLocationDetails(ev || {});

  closeEventVenueMapModal();
  if (typeof closeAllModals === 'function') {
    closeAllModals();
  } else if (typeof closeModal === 'function') {
    closeModal('event-modal');
  }

  if (typeof communityState !== 'undefined' && communityState) {
    if (locInfo.latitude !== null && locInfo.longitude !== null) {
      communityState.lat = locInfo.latitude;
      communityState.lng = locInfo.longitude;
      localStorage.setItem('comm_lat', String(locInfo.latitude));
      localStorage.setItem('comm_lng', String(locInfo.longitude));
      localStorage.setItem('comm_manual_override', 'true');
    }
    if (locInfo.cityStateCountry || locInfo.venue) {
      communityState.locationName = locInfo.cityStateCountry || locInfo.venue;
      localStorage.setItem('comm_loc_name', communityState.locationName);
    }
    communityState.activeSubtab = 'stores';
    communityState.storesFilter = 'all';
    communityState.storesSearch = locInfo.venue || '';
    const searchInput = document.getElementById('stores-search-input');
    if (searchInput) searchInput.value = communityState.storesSearch;
    const clearBtn = document.getElementById('stores-search-clear');
    if (clearBtn) clearBtn.style.display = communityState.storesSearch ? 'block' : 'none';
  }

  if (typeof switchTab === 'function') {
    await switchTab('community');
  }
  if (typeof switchCommunitySubtab === 'function') {
    switchCommunitySubtab('stores');
  }
  if (typeof renderCommunityHeader === 'function' && typeof communityState !== 'undefined') {
    renderCommunityHeader({
      radius_miles: communityState.radiusMiles || 50,
      location_name: communityState.locationName || 'Tournament Venue'
    });
  }
  if (typeof loadLocalGameStores === 'function') {
    await loadLocalGameStores(true);
  }

  // Ensure the event venue itself is highlighted/available in the stores list & map
  if (typeof communityState !== 'undefined' && communityState && (locInfo.venue || locInfo.addressLine)) {
    const stores = Array.isArray(communityState.stores) ? communityState.stores : [];
    const vNorm = (locInfo.venue || '').toLowerCase().trim();
    let matchedStore = stores.find(s => vNorm && (s.name || '').toLowerCase().includes(vNorm));
    if (!matchedStore && locInfo.latitude !== null && locInfo.longitude !== null) {
      matchedStore = {
        id: `venue_${eid || 'event'}`,
        name: locInfo.venue || (ev && ev.name) || 'Tournament Venue',
        address: locInfo.addressLine || locInfo.cityStateCountry || '',
        city: locInfo.city || '',
        state: locInfo.state || '',
        latitude: locInfo.latitude,
        longitude: locInfo.longitude,
        distance_miles: 0.0,
        is_tournament_venue: true,
        tournament_count: 1,
        last_tournament_date: (ev && ev.event_date) ? String(ev.event_date).slice(0, 10) : null
      };
      communityState.stores = [matchedStore, ...stores];
      if (typeof updateStoresBadgesAndCounts === 'function') updateStoresBadgesAndCounts();
      if (typeof renderStoresGrid === 'function') renderStoresGrid();
      if (typeof initStoresGoogleMap === 'function') initStoresGoogleMap(communityState.stores);
    }
    if (matchedStore && matchedStore.latitude != null && matchedStore.longitude != null && typeof focusStoreOnMap === 'function') {
      setTimeout(() => {
        focusStoreOnMap(matchedStore.latitude, matchedStore.longitude, matchedStore.id);
      }, 150);
    }
  }
}
window.openEventInCommunityGameStores = openEventInCommunityGameStores;

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

    const locInfo = extractEventLocationDetails(ev);
    const primaryLoc = locInfo.cityStateCountry || locInfo.shortLabel || 'Unspecified';
    const subLoc = locInfo.venue
      ? (locInfo.streetAddress ? `${locInfo.venue} • ${locInfo.streetAddress}` : locInfo.venue)
      : (locInfo.streetAddress || '');
    const dateStr = (ev.event_date || '').slice(0, 10) || '-';

    tr.innerHTML = `
      <td>
        <div style="font-weight:600; color:#fff;">
          <span class="player-link">${escapeHtml(ev.name)}</span>
        </div>
      </td>
      <td style="font-family:var(--font-mono); color:var(--text-secondary); font-size:0.85rem;">${dateStr}</td>
      <td style="color:var(--text-secondary); font-size:0.85rem;">
        <div style="color:#e2e8f0; font-weight:500;">${escapeHtml(primaryLoc)}</div>
        ${subLoc ? `<div style="font-size:0.74rem; color:var(--text-muted); margin-top:2px;">📍 ${escapeHtml(subLoc)}</div>` : ''}
      </td>
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
      const fresh = await window.api.getTournamentDetails(eventId, false, true);
      if (currentOpenEventId !== eventId) return;
      if (fresh && !fresh.error) {
        currentEventData = fresh;
        eventMatchesCache = fresh.matches || [];
        eventPlayersCache = fresh.players || [];
        if (typeof computeEventPlayerEloStats === 'function') {
          computeEventPlayerEloStats(eventPlayersCache, eventMatchesCache);
        }
        invalidateEventSearchIndex();
        ensureEventSearchIndex();
        if (typeof synthesizeClientUserEventRegistration === 'function') {
          const synthReg = synthesizeClientUserEventRegistration(fresh, currentEventRegistration);
          if (synthReg && synthReg.is_registered) {
            currentEventRegistration = synthReg;
          }
        }
        if (typeof saveEventModalCache === 'function') {
          saveEventModalCache(eventId, fresh, currentEventRegistration);
        }

        const elPlayers = document.getElementById('event-modal-players');
        const eventRounds = getEventNumRounds(fresh, eventMatchesCache);
        if (elPlayers) elPlayers.innerText = fresh.total_players || eventPlayersCache.length || 0;
        const elRounds = document.getElementById('event-modal-rounds');
        if (elRounds) elRounds.innerText = eventRounds || 0;
        const elMatches = document.getElementById('event-modal-matches');
        if (elMatches) elMatches.innerText = eventMatchesCache.length;

        const metaEl = document.getElementById('modal-event-meta');
        if (metaEl) {
          metaEl.innerHTML = buildEventModalMetaHtml(fresh, eventRounds);
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

        const teamsListFresh = (fresh.teams && fresh.teams.length > 0) ? fresh.teams : (fresh.team_standings || []);
        const isTeamEventFresh = teamsListFresh.length > 0;
        const isDoublesFresh = Boolean(fresh.is_doubles_event);

        if (teamsListFresh.length > 0) {
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

        if (typeof renderQuickEventModal === 'function') {
          renderQuickEventModal(fresh, currentEventRegistration);
        }
        renderEventResultsRows();
        renderEventEloRows();
        renderEventPairingsRows();
        if (typeof renderEventHubHeroSection === 'function') {
          renderEventHubHeroSection(fresh, currentEventRegistration);
        }
        if (typeof populateEventHubFactionFilter === 'function') {
          populateEventHubFactionFilter(eventPlayersCache);
        }
        if (typeof renderPersonalEventScorecard === 'function') {
          renderPersonalEventScorecard(fresh, currentEventRegistration);
        }
        if (currentEventRegistration && currentEventRegistration.is_registered) {
          const subtabPlayer = document.getElementById('event-subtab-player');
          if (subtabPlayer) subtabPlayer.style.setProperty('display', 'inline-flex', 'important');
          if (typeof renderPlayerStation === 'function') {
            renderPlayerStation(fresh, currentEventRegistration);
          }
        }

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

function getWarmEventModalCache(eventId) {
  if (!eventId) return null;
  const key = String(eventId).trim();
  const isEntryValid = (entry) => {
    if (!entry || !entry.ev || (Date.now() - (entry.ts || 0)) >= 600000) return false;
    if (entry.ev.sync_in_progress) return false;
    if ((entry.ev.is_team_event || Number(entry.ev.total_teams || 0) > 0) && (!Array.isArray(entry.ev.teams) || entry.ev.teams.length === 0)) {
      return false;
    }
    return true;
  };
  if (window._eventModalMemCache && window._eventModalMemCache.has(key)) {
    const entry = window._eventModalMemCache.get(key);
    if (isEntryValid(entry)) {
      return entry;
    }
  }
  try {
    const raw = sessionStorage.getItem(`omni_ev_modal_v3_${key}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isEntryValid(parsed)) {
        if (!window._eventModalMemCache) window._eventModalMemCache = new Map();
        window._eventModalMemCache.set(key, parsed);
        return parsed;
      }
    }
  } catch (e) {}
  return null;
}

function saveEventModalCache(eventId, ev, userRegData) {
  if (!eventId || !ev || ev.sync_in_progress) return;
  const key = String(eventId).trim();
  const entry = { ev, userRegData: userRegData || null, ts: Date.now() };
  if (!window._eventModalMemCache) window._eventModalMemCache = new Map();
  window._eventModalMemCache.set(key, entry);
  try {
    sessionStorage.setItem(`omni_ev_modal_v3_${key}`, JSON.stringify(entry));
  } catch (e) {}
}
window.getWarmEventModalCache = getWarmEventModalCache;
window.saveEventModalCache = saveEventModalCache;

function synthesizeClientUserEventRegistration(ev, existingReg = null) {
  const u = (typeof authState !== 'undefined' && authState && authState.user) ||
            (typeof currentUser !== 'undefined' ? currentUser : null) ||
            (typeof window !== 'undefined' ? window.currentUser : null);
  if (!u || !ev || !Array.isArray(ev.players) || ev.players.length === 0) {
    return existingReg;
  }
  const candIds = new Set(
    [u.player_id, u.bcp_user_id, u.bcp_player_id, u.id, u.user_id, ...(Array.isArray(u.linked_players) ? u.linked_players : [])]
      .filter(Boolean)
      .map(x => String(x).trim().toLowerCase())
  );
  const candNames = new Set(
    [u.display_name, u.competitor_name, u.full_name, u.name]
      .filter(x => x && String(x).trim().length > 2)
      .map(x => String(x).trim().toLowerCase())
  );
  if (candIds.size === 0 && candNames.size === 0) {
    return existingReg;
  }
  const matched = ev.players.find(p => {
    if (!p || typeof p !== 'object') return false;
    const pIds = [p.player_id, p.user_id, p.id, p.bcp_event_player_id, p.bcp_player_id]
      .filter(Boolean)
      .map(x => String(x).trim().toLowerCase());
    if (pIds.some(pid => candIds.has(pid))) return true;
    const pName = String(p.full_name || p.name || p.player_name || '').trim().toLowerCase();
    if (pName && candNames.has(pName)) return true;
    return false;
  });
  if (!matched) {
    return existingReg;
  }
  const fullName = String(matched.full_name || matched.name || u.competitor_name || u.display_name || 'Competitor').trim();
  const parts = fullName.split(' ');
  const fn = parts[0] || '';
  const ln = parts.slice(1).join(' ') || '';
  const synthPreg = {
    player_id: String(matched.bcp_event_player_id || matched.player_id || matched.id || u.player_id || ''),
    bcp_player_id: String(matched.bcp_event_player_id || ''),
    first_name: fn,
    last_name: ln,
    full_name: fullName,
    player_name: fullName,
    team_name: matched.team || '',
    faction: (matched.faction && matched.faction !== 'Unknown' && matched.faction !== '-') ? matched.faction : '',
    detachment: matched.detachment || '',
    checked_in: Boolean(matched.checked_in),
    dropped: Boolean(matched.dropped),
    has_list_submitted: Boolean(matched.has_list || matched.list_id || matched.list_url || matched.army_list),
    army_list: matched.army_list || '',
    list_id: String(matched.list_id || ''),
    gamesystem_id: ev.gamesystem_id || 'WGMSzfKFYA'
  };
  if (existingReg && existingReg.is_registered) {
    const mergedPreg = Object.assign({}, synthPreg, existingReg.player_registration || {});
    if (!mergedPreg.list_id && synthPreg.list_id) mergedPreg.list_id = synthPreg.list_id;
    if (!mergedPreg.detachment && synthPreg.detachment) mergedPreg.detachment = synthPreg.detachment;
    if (!mergedPreg.faction && synthPreg.faction) mergedPreg.faction = synthPreg.faction;
    if (!mergedPreg.player_id && synthPreg.player_id) mergedPreg.player_id = synthPreg.player_id;
    mergedPreg.has_list_submitted = Boolean(mergedPreg.has_list_submitted || synthPreg.has_list_submitted);
    return Object.assign({}, existingReg, {
      is_registered: true,
      player_registration: mergedPreg
    });
  }
  return {
    is_registered: true,
    is_ended: Boolean(ev.is_ended || ev.ended),
    ended: Boolean(ev.is_ended || ev.ended),
    player_registration: synthPreg,
    user_profile: {
      logged_in: true,
      name: fullName,
      first_name: fn,
      last_name: ln,
      email: u.email || '',
      bcp_linked: Boolean(u.bcp_connected || u.bcp_user_id),
      bcp_user_id: u.bcp_user_id || null
    }
  };
}
window.synthesizeClientUserEventRegistration = synthesizeClientUserEventRegistration;

async function openEventModal(eventId, forceSync = false, initialTab = null) {
  stopEventSyncPoll();
  currentOpenEventId = eventId;
  eventDetailsLoadingCancelledId = null;
  eventModalSearchQuery = '';
  selectedEventRound = 'all';
  if (typeof currentSort !== 'undefined') {
    currentSort['event-results'] = { field: 'placement', asc: true };
  }
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

  // Set active tab immediately to prevent visual flashing (default to player station/results if registered, pairings for live ongoing events, teams for team tournaments, results otherwise)
  let guessedOngoing = false;
  if (currentEventData && String(currentEventData.id) === String(eventId)) {
    if (typeof isTournamentOngoing === 'function') guessedOngoing = isTournamentOngoing(currentEventData);
    else guessedOngoing = Boolean(!currentEventData.ended && (currentEventData.matches || []).length > 0);
  }
  const guessedIsTeam = Boolean(currentEventData && String(currentEventData.id) === String(eventId) && ((currentEventData.teams && currentEventData.teams.length > 0) || (currentEventData.team_standings && currentEventData.team_standings.length > 0)));
  const guessedIsRegistered = Boolean(currentEventRegistration && currentEventRegistration.is_registered);
  let immediateTab = 'results';
  if (guessedIsRegistered) immediateTab = 'player';
  else if (guessedOngoing) immediateTab = 'matches';
  else if (guessedIsTeam) immediateTab = 'teams';
  switchEventModalTab(initialTab || immediateTab);

  const subtabPlayerInit = document.getElementById('event-subtab-player');
  const subtabTeamsInit = document.getElementById('event-subtab-teams');
  const subtabEloInit = document.getElementById('event-subtab-elo');
  const subtabNewsInit = document.getElementById('event-subtab-news');
  const subtabToHubInit = document.getElementById('event-subtab-to-hub');
  const subtabCreatorInit = document.getElementById('event-subtab-creator');
  const canToInit = Boolean(currentEventData && String(currentEventData.id) === String(eventId) && typeof canUserAccessEventToHub === 'function' && canUserAccessEventToHub(currentEventData));
  const isCCInit = Boolean(typeof isUserCC === 'function' ? isUserCC(currentUser) : (currentUser && (currentUser.role === 'admin' || currentUser.role === 'cc' || currentUser.role === 'creator' || currentUser.can_access_cc || currentUser.is_cc || currentUser.is_admin)));
  if (subtabPlayerInit) {
    subtabPlayerInit.style.setProperty('display', (guessedIsRegistered || canToInit || isCCInit) ? 'inline-flex' : 'none', 'important');
  }
  if (subtabTeamsInit) {
    if (guessedIsTeam) {
      subtabTeamsInit.style.setProperty('display', 'inline-flex', 'important');
    } else {
      subtabTeamsInit.style.setProperty('display', 'none', 'important');
    }
  }
  if (subtabEloInit) subtabEloInit.style.setProperty('display', 'none', 'important');
  if (subtabNewsInit) subtabNewsInit.style.setProperty('display', 'inline-flex', 'important');
  if (subtabToHubInit) subtabToHubInit.style.setProperty('display', 'none', 'important');
  if (subtabCreatorInit) subtabCreatorInit.style.setProperty('display', 'none', 'important');

  const isTopEventModal = modal.classList.contains('active') &&
                          modal.style.display !== 'none' &&
                          ((typeof modalStack !== 'undefined' && modalStack.length > 0 && modalStack[modalStack.length - 1] === 'event-modal') ||
                           (typeof window !== 'undefined' && window.modalStack && window.modalStack.length > 0 && window.modalStack[window.modalStack.length - 1] === 'event-modal')) &&
                          currentEventData && String(currentEventData.id) === String(eventId);
  const loadingModal = document.getElementById('event-details-loading-modal');

  // Hydrate in-memory API cache from session warm cache if available
  const warmEntry = (!forceSync && typeof getWarmEventModalCache === 'function')
    ? getWarmEventModalCache(eventId)
    : null;
  if (warmEntry && warmEntry.ev) {
    if (!currentEventData || String(currentEventData.id) !== String(eventId)) {
      currentEventData = warmEntry.ev;
    }
    if (window.api && window.api._cache) {
      const evUrl = `/api/event/${encodeURIComponent(eventId)}`;
      if (!window.api._cache.has(evUrl)) {
        window.api._cache.set(evUrl, { data: warmEntry.ev, timestamp: Date.now(), ttl: 180000 });
      }
      if (warmEntry.userRegData) {
        const regUrl = `/api/community/events/${encodeURIComponent(eventId)}/registration`;
        if (!window.api._cache.has(regUrl)) {
          window.api._cache.set(regUrl, { data: warmEntry.userRegData, timestamp: Date.now(), ttl: 180000 });
        }
      }
    }
  }

  // Check if we already have warm cached data in memory
  const hasWarmCache = Boolean(
    !forceSync && (
      (warmEntry && warmEntry.ev) ||
      (currentEventData && String(currentEventData.id) === String(eventId)) ||
      (window.api && window.api._cache && window.api._cache.has(`/api/event/${encodeURIComponent(eventId)}`))
    )
  );

  let previewEv = null;
  if (currentEventData && String(currentEventData.id) === String(eventId)) {
    previewEv = currentEventData;
  } else if (typeof eventsData !== 'undefined' && Array.isArray(eventsData)) {
    previewEv = eventsData.find(e => e && String(e.id) === String(eventId)) || null;
  }
  if (!previewEv && typeof communityState !== 'undefined' && communityState) {
    const allEvents = [
      ...(communityState.majorsList || []),
      ...(communityState.overview?.events_upcoming || []),
      ...(communityState.overview?.events_recent || []),
      ...(communityState.overview?.upcoming_events || []),
      ...(communityState.overview?.recent_events || [])
    ];
    previewEv = allEvents.find(e => e && String(e.id) === String(eventId)) || null;
  }
  if (!previewEv && typeof myHubData !== 'undefined' && myHubData) {
    const allHubEvents = [
      ...(myHubData.registered_tournaments || []),
      ...(myHubData.upcoming_events || []),
      ...(myHubData.events_attended || [])
    ];
    previewEv = allHubEvents.find(e => e && String(e.bcp_event_id || e.id) === String(eventId)) || null;
  }

  // Always clear stale modal DOM when switching to a different eventId so a previous tournament never shows through
  if (!hasWarmCache && (!currentEventData || String(currentEventData.id) !== String(eventId))) {
    currentEventData = null;
    eventPlayersCache = [];
    eventMatchesCache = [];
    const nameEl = document.getElementById('modal-event-name');
    if (nameEl) nameEl.textContent = (previewEv && (previewEv.name || previewEv.event_name)) || 'Loading Tournament...';
    const metaEl = document.getElementById('modal-event-meta');
    if (metaEl) {
      if (previewEv) {
        metaEl.innerHTML = buildEventModalMetaHtml(previewEv);
      } else {
        metaEl.textContent = 'Syncing tournament metadata from Best Coast Pairings...';
      }
    }
    const badgesEl = document.getElementById('modal-event-badges');
    if (badgesEl) {
      if (previewEv && typeof getEventTierBadgeHtml === 'function') {
        const pCount = Number(previewEv.total_players || 0);
        const rCount = Number(previewEv.num_rounds || previewEv.numberOfRounds || 0);
        badgesEl.innerHTML = getEventTierBadgeHtml(pCount, previewEv.name || previewEv.event_name || '', rCount);
      } else {
        badgesEl.innerHTML = '';
      }
    }
    const kpisEl = document.getElementById('modal-quick-kpis');
    if (kpisEl) {
      const pCount = previewEv ? Number(previewEv.total_players || 0) : '—';
      const rCount = previewEv ? (Number(previewEv.num_rounds || previewEv.numberOfRounds || 0) || '—') : '—';
      kpisEl.innerHTML = `
        <div class="card" style="padding:0.7rem 0.85rem; background:rgba(15,23,42,0.75); border:1px solid rgba(255,255,255,0.08); border-radius:8px;">
          <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:0.2rem;">👥 Competitors</div>
          <div style="font-size:1.05rem; font-weight:800; color:#fff; font-family:var(--font-mono);">${escapeHtml(String(pCount))} Players</div>
          <div style="font-size:0.72rem; color:var(--text-secondary); margin-top:0.15rem;">Syncing roster...</div>
        </div>
        <div class="card" style="padding:0.7rem 0.85rem; background:rgba(15,23,42,0.75); border:1px solid rgba(255,255,255,0.08); border-radius:8px;">
          <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:0.2rem;">🎲 Format & Rounds</div>
          <div style="font-size:1.05rem; font-weight:800; color:#38bdf8; font-family:var(--font-mono);">${escapeHtml(String(rCount))} Rounds</div>
          <div style="font-size:0.72rem; color:var(--text-secondary); margin-top:0.15rem;">Loading pairings...</div>
        </div>
        <div class="card" style="padding:0.7rem 0.85rem; background:rgba(15,23,42,0.75); border:1px solid rgba(255,255,255,0.08); border-radius:8px;">
          <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:0.2rem;">⚡ Field Strength</div>
          <div style="font-size:1.05rem; font-weight:800; color:#facc15; font-family:var(--font-mono);">Computing...</div>
          <div style="font-size:0.72rem; color:var(--text-secondary); margin-top:0.15rem;">Calculating Elo...</div>
        </div>
        <div class="card" style="padding:0.7rem 0.85rem; background:rgba(15,23,42,0.75); border:1px solid rgba(255,255,255,0.08); border-radius:8px;">
          <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:0.2rem;">⭐ Top Seed</div>
          <div style="font-size:0.98rem; font-weight:800; color:#4ade80;">Loading...</div>
          <div style="font-size:0.72rem; color:var(--text-secondary); margin-top:0.15rem;">—</div>
        </div>
      `;
    }
    const qTbody = document.getElementById('modal-quick-tbody');
    if (qTbody) {
      qTbody.innerHTML = '<tr><td colspan="6" class="empty-state" style="padding:2rem;"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading tournament standings & rosters...</div></td></tr>';
    }
  }

  // If preview metadata exists, populate the Quick-View Modal header & KPI shell immediately at 0ms!
  if (!isTopEventModal && !hasWarmCache && previewEv) {
    if (typeof bringModalToFront === 'function') {
      bringModalToFront(modal);
    } else {
      modal.classList.add('active');
    }
  } else if (!isTopEventModal && loadingModal && !hasWarmCache) {
    const previewName = previewEv ? (previewEv.name || previewEv.event_name || '') : '';
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

  const hubTabEl = document.getElementById('tab-event-hub');
  const isHubPageVisible = Boolean(hubTabEl && hubTabEl.classList.contains('active'));

  const rbody = document.getElementById('event-results-body');
  const ebody = document.getElementById('event-elo-body');
  const pbody = document.getElementById('event-pairings-body');
  const hasCachedRows = (currentEventData && String(currentEventData.id) === String(eventId));

  if (isHubPageVisible) {
    if (hasCachedRows && isTopEventModal) {
      if (rbody) rbody.style.opacity = '0.6';
      if (ebody) ebody.style.opacity = '0.6';
      if (pbody) pbody.style.opacity = '0.6';
    } else if (!hasCachedRows) {
      if (rbody) rbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading placings & results...</div></td></tr>';
      if (ebody) ebody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading participant ratings...</div></td></tr>';
      if (pbody) pbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Syncing live round pairings from BCP...</div></td></tr>';
    }
  }

  const isEndedPreview = Boolean(
    previewEv && (
      previewEv.is_ended === true ||
      previewEv.ended === true ||
      (typeof isEventEnded === 'function' && isEventEnded(previewEv))
    )
  );

  // Parallel network fetch (or 0ms warm cache resolution): tournament details + non-blocking community registration
  const detailsPromise = (!forceSync && warmEntry && warmEntry.ev)
    ? Promise.resolve(warmEntry.ev)
    : window.api.getTournamentDetails(eventId, forceSync);
  const regPromise = (!forceSync && warmEntry && warmEntry.userRegData)
    ? Promise.resolve(warmEntry.userRegData)
    : ((typeof window.api?.getCommunityEventRegistration === 'function')
      ? window.api.getCommunityEventRegistration(eventId, forceSync).catch(e => {
          console.debug('Notice checking user registration:', e);
          return null;
        })
      : Promise.resolve(null));

  // Never let registration check block opening the quick-view modal beyond 120ms
  const regFastPromise = Promise.race([
    regPromise,
    new Promise(resolve => setTimeout(() => resolve(null), 120))
  ]);

  try {
    const [detailsResult, regResult] = await Promise.allSettled([detailsPromise, regFastPromise]);

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
    let userRegData = (regResult.status === 'fulfilled' && regResult.value && !regResult.value.error) ? regResult.value : null;
    userRegData = synthesizeClientUserEventRegistration(ev, userRegData);

    // If regPromise resolves after the 120ms fast-path window, hydrate Player Station asynchronously and switch to it if no explicit tab was requested
    if (regPromise) {
      regPromise.then(async lateReg => {
        if (lateReg && !lateReg.error && String(currentOpenEventId) === String(eventId)) {
          const mergedReg = synthesizeClientUserEventRegistration(ev, lateReg);
          if (mergedReg && mergedReg.is_registered) {
            currentEventRegistration = mergedReg;
            saveEventModalCache(eventId, ev, mergedReg);
            const subtabPlayerEl = document.getElementById('event-subtab-player');
            if (subtabPlayerEl) {
              subtabPlayerEl.style.setProperty('display', 'inline-flex', 'important');
            }
            if (typeof renderQuickEventModal === 'function') {
              renderQuickEventModal(ev, mergedReg);
            }
            if (typeof renderPlayerStation === 'function') {
              await renderPlayerStation(ev, mergedReg);
            }
            if (typeof renderEventHubHeroSection === 'function') {
              renderEventHubHeroSection(ev, mergedReg);
            }
            if (typeof renderPersonalEventScorecard === 'function') {
              renderPersonalEventScorecard(ev, mergedReg);
            }
            if (!initialTab) {
              switchEventModalTab('player');
            }
          }
        }
      }).catch(() => {});
    }

    currentEventData = ev;
    saveEventModalCache(eventId, ev, userRegData);
    let eventName = ev.name;
    if (!eventName || eventName === 'Tournament' || eventName === 'Tournament Details' || eventName === 'Unnamed Tournament') {
      eventName = ev.raw_json?.name || ev.event_name || 'Tournament Details';
    }
    const nameEl = document.getElementById('modal-event-name');
    if (nameEl) nameEl.innerText = eventName;

    eventMatchesCache = ev.matches || [];
    eventPlayersCache = ev.players || [];
    if (typeof computeEventPlayerEloStats === 'function') {
      computeEventPlayerEloStats(eventPlayersCache, eventMatchesCache);
    }
    invalidateEventSearchIndex();
    if (isHubPageVisible && typeof loadEventLivestreams === 'function') {
      loadEventLivestreams(eventId).then(() => {
        if (String(currentOpenEventId) === String(eventId) && typeof renderEventPairingsRows === 'function') {
          renderEventPairingsRows();
        }
      }).catch(() => {});
    }

    const eventRounds = getEventNumRounds(ev, eventMatchesCache);
    const metaEl = document.getElementById('modal-event-meta');
    if (metaEl) metaEl.innerHTML = buildEventModalMetaHtml(ev, eventRounds);

    const teamsList = (ev.teams && ev.teams.length > 0) ? ev.teams : (ev.team_standings || []);
    const isTeamEvent = teamsList.length > 0;
    const isDoublesEvent = Boolean(isTeamEvent && ev.is_doubles_event);

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

    if (teamsList.length > 0) {
      if (subtabTeams) subtabTeams.style.setProperty('display', 'inline-flex', 'important');
      const labelSpan = document.getElementById('event-subtab-teams-label') || (subtabTeams && subtabTeams.querySelector('span:first-child'));
      if (labelSpan) {
        labelSpan.innerText = isDoublesEvent ? (hasTeamPlacings ? '🏆 Duo Placings' : '👥 Doubles Rosters') : (hasTeamPlacings ? '🏆 Team Placings' : '🛡️ Team Rosters');
      }
      if (tabTeamsCount) tabTeamsCount.innerText = teamsList.length;
      if (isHubPageVisible) renderEventTeamsRows();
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

    const subtabNews = document.getElementById('event-subtab-news');
    if (subtabNews) {
      subtabNews.style.setProperty('display', 'inline-flex', 'important');
    }

    const canAccessToHub = typeof canUserAccessEventToHub === 'function' ? canUserAccessEventToHub(ev) : false;
    const subtabToHub = document.getElementById('event-subtab-to-hub');
    if (subtabToHub) {
      subtabToHub.style.setProperty('display', 'none', 'important');
    }

    const subtabCreator = document.getElementById('event-subtab-creator');
    const isCC = Boolean(typeof isUserCC === 'function' ? isUserCC(currentUser) : (currentUser && (currentUser.role === 'admin' || currentUser.role === 'cc' || currentUser.role === 'creator' || currentUser.can_access_cc || currentUser.is_cc || currentUser.is_admin)));
    if (subtabCreator) {
      subtabCreator.style.setProperty('display', 'none', 'important');
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
    const isRegisteredPlayer = Boolean((userRegData && userRegData.is_registered) || (typeof currentDevPersona !== 'undefined' && currentDevPersona === 'competitor'));
    const shouldShowMyStation = Boolean(isRegisteredPlayer || canAccessToHub || isCC);

    if (userRegData && userRegData.is_registered) {
      currentEventRegistration = userRegData;

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
    }

    if (subtabPlayer) {
      subtabPlayer.style.setProperty('display', shouldShowMyStation ? 'inline-flex' : 'none', 'important');
    }
    if (shouldShowMyStation && isHubPageVisible) {
      await renderPlayerStation(ev, userRegData);
    } else if (!shouldShowMyStation && currentEventModalTab === 'player') {
      currentEventModalTab = isTeamEvent ? 'teams' : 'results';
    }

    // Determine target tab now that all event + registration state is known
    const isOngoing = (typeof isTournamentOngoing === 'function')
      ? isTournamentOngoing(ev)
      : (!isEnded && eventMatchesCache.length > 0);

    if (initialTab && initialTab !== 'elo' && (initialTab !== 'teams' || teamsList.length > 0) && (initialTab !== 'player' || shouldShowMyStation) && (initialTab !== 'to-hub' || canAccessToHub) && (initialTab !== 'creator' || isCC)) {
      switchEventModalTab(initialTab);
    } else if (isRegisteredPlayer) {
      _currentMyStationSubtab = 'match';
      switchEventModalTab('player');
    } else if (isOngoing && eventMatchesCache.length > 0) {
      switchEventModalTab('matches');
    } else if (teamsList.length > 0) {
      switchEventModalTab('teams');
    } else {
      switchEventModalTab('results');
    }

    if (typeof loadEventToHubState === 'function') {
      loadEventToHubState(eventId, Boolean(forceSync)).catch(() => {});
    }

    if (typeof renderQuickEventModal === 'function') {
      renderQuickEventModal(ev, userRegData);
    }

    if (isHubPageVisible) {
      renderEventResultsRows();
      renderEventEloRows();
      renderEventPairingsRows();
      updateEventModalTabCountsForSearch();

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
    const qTbody = document.getElementById('modal-quick-tbody');
    if (qTbody) {
      qTbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:var(--loss); padding:2rem;">Error loading tournament (${escapeHtml(String(eventId))}): ${escapeHtml(err.message)}</td></tr>`;
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
    if (!t._searchText) {
      t._searchText = `${t.name || ''}\n${t.captain || t.captain_name || ''}`.toLowerCase();
    }
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
  const activeTeamsSource = teams.length > 0 ? teams : standings;
  const isTeam = activeTeamsSource.length > 0;
  const isDoubles = Boolean(isTeam && currentEventData && currentEventData.is_doubles_event);

  let teamsMatchCount = 0;
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
  const isRegistered = Boolean(
    (currentEventRegistration && currentEventRegistration.is_registered) ||
    (typeof currentDevPersona !== 'undefined' && currentDevPersona === 'competitor')
  );
  const canTo = Boolean(typeof canUserAccessEventToHub === 'function' && canUserAccessEventToHub(currentEventData));
  const isCC = Boolean(typeof isUserCC === 'function' ? isUserCC(currentUser) : (currentUser && (currentUser.role === 'admin' || currentUser.role === 'cc' || currentUser.role === 'creator' || currentUser.can_access_cc || currentUser.is_cc || currentUser.is_admin)));
  const canAccessMyStation = Boolean(isRegistered || canTo || isCC);
  const hasTeams = Boolean(currentEventData && ((currentEventData.teams && currentEventData.teams.length > 0) || (currentEventData.team_standings && currentEventData.team_standings.length > 0)));

  if (tabKey === 'to-hub') {
    if (!canTo) {
      console.warn('Unauthorized TO Hub tab switch blocked for current user');
      switchEventModalTab('results');
      return;
    }
    _currentMyStationSubtab = (typeof _currentToHubSubtab !== 'undefined' && ['roster', 'clock', 'announcements'].includes(_currentToHubSubtab))
      ? _currentToHubSubtab
      : 'roster';
    tabKey = 'player';
  } else if (tabKey === 'creator') {
    if (!isCC) {
      console.warn('Unauthorized Creator Studio tab switch blocked for current user');
      switchEventModalTab('results');
      return;
    }
    _currentMyStationSubtab = 'stream';
    tabKey = 'player';
  }

  if (tabKey === 'player' && !canAccessMyStation) {
    tabKey = hasTeams ? 'teams' : 'results';
  }
  if (tabKey === 'teams' && !hasTeams) {
    tabKey = 'results';
  }
  currentEventModalTab = tabKey || 'results';
  window.currentEventModalTab = currentEventModalTab;
  const btnPlayer = document.getElementById('event-subtab-player');
  const btnTeams = document.getElementById('event-subtab-teams');
  const btnResults = document.getElementById('event-subtab-results');
  const btnElo = document.getElementById('event-subtab-elo');
  const btnMatches = document.getElementById('event-subtab-matches');
  const btnMeta = document.getElementById('event-subtab-meta');
  const btnNews = document.getElementById('event-subtab-news');
  const btnToHub = document.getElementById('event-subtab-to-hub');
  const btnCreator = document.getElementById('event-subtab-creator');
  const viewPlayer = document.getElementById('event-view-player');
  const viewTeams = document.getElementById('event-view-teams');
  const viewResults = document.getElementById('event-view-results');
  const viewElo = document.getElementById('event-view-elo');
  const viewMatches = document.getElementById('event-view-matches');
  const viewMeta = document.getElementById('event-view-meta');
  const viewNews = document.getElementById('event-view-news');
  const viewToHub = document.getElementById('event-view-to-hub');
  const viewCreator = document.getElementById('event-view-creator');
  const searchRow = document.getElementById('event-modal-search-row') || document.querySelector('.event-modal-search-wrap');
  const facFilterWrap = document.getElementById('event-hub-faction-filter-wrap');

  [btnPlayer, btnTeams, btnResults, btnElo, btnMatches, btnMeta, btnNews, btnToHub, btnCreator].forEach(b => b && b.classList.remove('active'));
  [viewPlayer, viewTeams, viewResults, viewElo, viewMatches, viewMeta, viewNews, viewToHub, viewCreator].forEach(v => v && (v.style.display = 'none'));

  if (tabKey === 'player') {
    if (btnPlayer) btnPlayer.classList.add('active');
    if (viewPlayer) viewPlayer.style.display = 'block';
    if (searchRow) searchRow.style.display = 'none';
    if (typeof renderPlayerStation === 'function' && currentEventData) {
      renderPlayerStation(currentEventData, currentEventRegistration);
    }
    if (typeof renderEventClockAndScheduleWidgets === 'function' && currentEventData) {
      renderEventClockAndScheduleWidgets(currentEventData);
    }
  } else if (tabKey === 'meta') {
    if (btnMeta) btnMeta.classList.add('active');
    if (viewMeta) viewMeta.style.display = 'block';
    if (searchRow) searchRow.style.display = 'none';
    if (typeof renderEventMetaAndHighlights === 'function' && currentEventData) {
      renderEventMetaAndHighlights(currentEventData);
    }
  } else if (tabKey === 'news') {
    if (btnNews) btnNews.classList.add('active');
    if (viewNews) viewNews.style.display = 'block';
    if (searchRow) searchRow.style.display = 'none';
    if (typeof renderEventNewsHub === 'function' && currentEventData) {
      renderEventNewsHub(currentEventData);
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

let eventTeamsViewMode = 'rosters'; // 'rosters' | 'standings'

function setEventTeamsViewMode(mode) {
  eventTeamsViewMode = (mode === 'standings') ? 'standings' : 'rosters';
  renderEventTeamsRows();
}
window.setEventTeamsViewMode = setEventTeamsViewMode;

function jumpToTeamRosterCard(idx) {
  eventTeamsViewMode = 'rosters';
  renderEventTeamsRows();
  setTimeout(() => {
    const cardEl = document.getElementById(`team-roster-card-${idx}`);
    const membersEl = document.getElementById(`team-members-${idx}`);
    const chevronEl = document.getElementById(`team-chevron-${idx}`);
    if (membersEl && membersEl.style.display === 'none') {
      membersEl.style.display = 'flex';
      if (chevronEl) chevronEl.style.transform = 'rotate(0deg)';
    }
    if (cardEl && typeof cardEl.scrollIntoView === 'function') {
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 30);
}
window.jumpToTeamRosterCard = jumpToTeamRosterCard;

function renderEventTeamsRows() {
  const container = document.getElementById('event-teams-container');
  const tableWrap = document.getElementById('event-teams-table-wrap');
  const tbody = document.getElementById('event-teams-body');
  const btnViewRosters = document.getElementById('btn-teams-view-rosters');
  const btnViewStandings = document.getElementById('btn-teams-view-standings');
  const btnToggleAll = document.getElementById('btn-toggle-all-teams');
  const viewSwitcher = document.getElementById('event-teams-view-switcher');

  const idxState = ensureEventSearchIndex();
  const teams = (currentEventData && currentEventData.teams) || [];
  const standings = (currentEventData && currentEventData.team_standings) || [];
  const isDoubles = Boolean(currentEventData && currentEventData.is_doubles_event);
  const itemTypeSingular = isDoubles ? 'pair' : 'team';
  const itemTypePlural = isDoubles ? 'pairs' : 'teams';
  const sourceTeams = teams.length > 0 ? teams : standings;

  if (sourceTeams.length === 0) {
    if (container) {
      container.style.display = 'block';
      container.innerHTML = `<div class="empty-state" style="padding:2.5rem 1rem; text-align:center; color:var(--text-muted);">No ${itemTypePlural} or rosters available for this tournament.</div>`;
    }
    if (tableWrap) tableWrap.style.display = 'none';
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="empty-state">No ${itemTypePlural} found.</td></tr>`;
    return;
  }

  const anyTeamHasPlacings = sourceTeams.some(t => (t.placing && t.placing > 0) || (t.wins != null && Number(t.wins) > 0) || (t.match_points != null && Number(t.match_points) > 0));
  if (viewSwitcher) {
    viewSwitcher.style.display = teams.length > 0 ? 'inline-flex' : 'none';
  }
  if (btnViewRosters) {
    btnViewRosters.innerHTML = isDoubles
      ? (anyTeamHasPlacings ? '👥 Duo Rosters &amp; Placings' : '👥 Doubles Rosters')
      : (anyTeamHasPlacings ? '🛡️ Team Rosters &amp; Placings' : '🛡️ Team Rosters');
    if (eventTeamsViewMode === 'rosters') {
      btnViewRosters.style.background = 'rgba(56, 189, 248, 0.18)';
      btnViewRosters.style.color = '#38bdf8';
      btnViewRosters.style.fontWeight = '700';
    } else {
      btnViewRosters.style.background = 'transparent';
      btnViewRosters.style.color = 'var(--text-secondary, #94a3b8)';
      btnViewRosters.style.fontWeight = '600';
    }
  }
  if (btnViewStandings) {
    btnViewStandings.innerHTML = isDoubles ? '🏆 Duo Placings Table' : '🏆 Team Placings Table';
    if (eventTeamsViewMode === 'standings') {
      btnViewStandings.style.background = 'rgba(56, 189, 248, 0.18)';
      btnViewStandings.style.color = '#38bdf8';
      btnViewStandings.style.fontWeight = '700';
    } else {
      btnViewStandings.style.background = 'transparent';
      btnViewStandings.style.color = 'var(--text-secondary, #94a3b8)';
      btnViewStandings.style.fontWeight = '600';
    }
  }

  const showStandingsTable = (teams.length === 0) || (eventTeamsViewMode === 'standings');
  if (btnToggleAll) {
    btnToggleAll.style.display = showStandingsTable ? 'none' : 'inline-flex';
  }

  const summaryTextEl = document.getElementById('event-teams-summary-text');
  if (summaryTextEl) {
    const compCount = (eventPlayersCache && eventPlayersCache.length) || (currentEventData && currentEventData.total_players) || 0;
    summaryTextEl.innerText = `${sourceTeams.length} ${isDoubles ? 'Pairs' : 'Teams'} ${anyTeamHasPlacings ? 'Ranked' : 'Registered'} (${compCount} Competitors)`;
  }

  let filtered = sourceTeams;
  if (eventModalSearchQuery) {
    const q = eventModalSearchQuery;
    filtered = sourceTeams.filter(t => t && t._searchText && t._searchText.includes(q));
  }

  const searchSummary = document.getElementById('event-modal-search-summary');
  if (searchSummary && currentEventModalTab === 'teams') {
    if (eventModalSearchQuery) {
      searchSummary.innerText = `Showing ${filtered.length} of ${sourceTeams.length} ${itemTypePlural}`;
      searchSummary.style.display = 'block';
    } else {
      searchSummary.style.display = 'none';
    }
  }

  const buildRoundScoresInline = (t) => {
    if (!t.games || !Array.isArray(t.games) || t.games.length === 0) return '';
    return t.games.map(g => {
      const isWin = g.result === 2;
      const isLoss = g.result === 0;
      const bg = isWin ? 'rgba(34,197,94,0.18)' : isLoss ? 'rgba(239,68,68,0.18)' : 'rgba(245,158,11,0.18)';
      const color = isWin ? '#4ade80' : isLoss ? '#f87171' : '#fbbf24';
      const border = isWin ? 'rgba(34,197,94,0.3)' : isLoss ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)';
      return `<span style="padding:1px 6px; border-radius:4px; background:${bg}; color:${color}; border:1px solid ${border}; font-weight:700; font-size:0.74rem;" title="Round ${g.round}: ${g.points} pts (${isWin ? 'Win' : isLoss ? 'Loss' : 'Draw'})">${g.points}</span>`;
    }).join('<span style="color:rgba(255,255,255,0.2); font-size:0.7rem; margin:0 2px;">/</span>');
  };

  // Render Standings Table (#event-teams-table-wrap)
  if (tbody) {
    if (filtered.length === 0) {
      const suggestions = getEventModalCrossTabSuggestions('teams');
      tbody.innerHTML = `
        <tr>
          <td colspan="10" class="empty-state" style="padding:2.5rem 1rem;">
            <div style="font-size:1.05rem; font-weight:600; color:#fff;">🔍 No ${isDoubles ? 'Pairs' : 'Teams'} Found</div>
            <div style="margin-top:0.5rem; color:var(--text-secondary); font-size:0.86rem;">
              No ${itemTypePlural} match "<strong>${escapeHtml(eventModalSearchQuery)}</strong>" in this tournament.
            </div>
            ${suggestions}
          </td>
        </tr>`;
    } else {
      tbody.innerHTML = filtered.map((t, idx) => {
        const rankNum = (t.placing && t.placing > 0) ? t.placing : (idx + 1);
        const rankColor = rankNum === 1 ? '#facc15' : rankNum === 2 ? '#e2e8f0' : rankNum === 3 ? '#d97706' : 'var(--text-secondary)';
        const rankMedal = rankNum === 1 ? '🥇 ' : rankNum === 2 ? '🥈 ' : rankNum === 3 ? '🥉 ' : '#';
        const members = Array.isArray(t._resolvedMembers) ? t._resolvedMembers : (t.members || []);
        const memberElos = members.map(m => Number(m.current_elo || m.elo || 1500)).filter(e => !isNaN(e) && e > 0);
        const computedAvgElo = memberElos.length > 0 ? Math.round(memberElos.reduce((a, b) => a + b, 0) / memberElos.length) : 1500;
        const avgEloVal = t.avg_elo ? Math.round(t.avg_elo) : computedAvgElo;
        const w = t.team_wins != null ? t.team_wins : (t.wins != null ? t.wins : null);
        const l = t.team_losses != null ? t.team_losses : (t.losses != null ? t.losses : 0);
        const d = t.team_draws != null ? t.team_draws : (t.draws != null ? t.draws : 0);
        const recDisplay = w != null ? `${w}W - ${l}L${d > 0 ? ' - ' + d + 'D' : ''}` : '-';
        const ptvVal = t.path_to_victory != null ? t.path_to_victory : null;
        const gwVal = t.game_wins != null ? t.game_wins : null;
        const ptvGwDisplay = (ptvVal != null && gwVal != null && ptvVal !== gwVal)
          ? `${ptvVal} PTV <span style="color:var(--text-muted); font-size:0.74rem;">(${gwVal} GW)</span>`
          : (ptvVal != null ? `${ptvVal} PTV` : (gwVal != null ? `${gwVal} GW` : '-'));
        const roundsInline = buildRoundScoresInline(t) || '<span style="color:var(--text-muted);">-</span>';
        const capDisplay = escapeHtml(t.captain_name || t.captain || '-');
        const rosterCount = members.length || (Array.isArray(t.member_ids) ? t.member_ids.length : 0);

        return `
          <tr style="cursor:pointer;" onclick="jumpToTeamRosterCard(${idx})" title="Click to view ${escapeHtml(t.name || 'Team')} full roster">
            <td class="rank-cell" style="font-weight:800; color:${rankColor}; font-family:var(--font-mono, monospace); white-space:nowrap;">${rankMedal}${rankNum}</td>
            <td>
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span style="font-weight:700; color:#38bdf8;">${escapeHtml(t.name || 'Team')}</span>
                ${rosterCount > 0 ? `<span style="font-size:0.68rem; padding:1px 6px; border-radius:8px; background:rgba(255,255,255,0.06); color:var(--text-secondary); font-weight:600;">${rosterCount}p</span>` : ''}
              </div>
            </td>
            <td style="color:#f1f5f9; font-size:0.84rem;">${capDisplay !== '-' ? `👑 ${capDisplay}` : '-'}</td>
            <td style="font-family:var(--font-mono, monospace); font-weight:700; color:#4ade80; white-space:nowrap;">${recDisplay}</td>
            <td style="font-family:var(--font-mono, monospace); font-weight:700; color:#38bdf8; font-size:0.92rem; white-space:nowrap;">${t.match_points != null ? t.match_points + ' MP' : '-'}</td>
            <td style="font-family:var(--font-mono, monospace); font-weight:600; color:var(--text-secondary); white-space:nowrap;">${ptvGwDisplay}</td>
            <td style="font-family:var(--font-mono, monospace); font-weight:700; color:#f8fafc; white-space:nowrap;">${t.battle_points != null ? t.battle_points + ' BP' : '-'}</td>
            <td><div style="display:flex; align-items:center; gap:2px; flex-wrap:nowrap;">${roundsInline}</div></td>
            <td><span class="elo-badge ${getEloBadgeClass(avgEloVal)}" style="font-size:0.8rem; font-weight:700; padding:2px 7px;">${avgEloVal}</span></td>
            <td style="text-align:right;">
              <button type="button" class="btn-xs btn-outline" onclick="event.stopPropagation(); jumpToTeamRosterCard(${idx})" style="font-size:0.72rem; padding:2px 8px; color:#38bdf8; border-color:rgba(56,189,248,0.35); background:rgba(56,189,248,0.08); cursor:pointer; white-space:nowrap;">
                🛡️ Roster (${rosterCount})
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  // Branch 1: Modern rich Team/Doubles Roster Cards
  if (teams.length > 0 && !showStandingsTable) {
    if (tableWrap) tableWrap.style.display = 'none';
    if (container) container.style.display = 'flex';

    if (btnToggleAll) {
      allTeamsCollapsed = false;
      btnToggleAll.innerHTML = '⊟ Collapse All';
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
    const hasPlacings = idxState.placementsCount > 0 || anyTeamHasPlacings;
    const isStarted = Boolean(hasPlacings || hasMatches);

    if (container) {
      const cardsHtml = [];
      for (let idx = 0; idx < filtered.length; idx++) {
        const t = filtered[idx];
        const hasTeamPlacings = Boolean(t.placing && t.placing > 0);
        let rankBadgeHtml = '';
        if (hasTeamPlacings) {
          const rankClass = t.placing === 1 ? 'rank-1' : t.placing === 2 ? 'rank-2' : t.placing === 3 ? 'rank-3' : '';
          rankBadgeHtml = `<div class="team-rank-badge ${rankClass}" title="Official Team Placing #${t.placing}">#${t.placing}</div>`;
        } else {
          rankBadgeHtml = `<div class="team-icon">${isDoubles ? '👥' : '🛡️'}</div>`;
        }

        const wVal = t.team_wins != null ? t.team_wins : t.wins;
        const lVal = t.team_losses != null ? t.team_losses : (t.losses || 0);
        const dVal = t.team_draws != null ? t.team_draws : (t.draws || 0);
        const winsPill = (wVal != null)
          ? `<span style="font-size:0.72rem; padding:1px 7px; border-radius:10px; background:rgba(34,197,94,0.16); color:#4ade80; border:1px solid rgba(34,197,94,0.3); font-weight:700;" title="Team Match Record">${wVal}W - ${lVal}L${dVal > 0 ? ' - ' + dVal + 'D' : ''}</span>`
          : '';
        const matchPtsPill = (t.match_points != null)
          ? `<span style="font-size:0.72rem; padding:1px 7px; border-radius:10px; background:rgba(56,189,248,0.14); color:#38bdf8; border:1px solid rgba(56,189,248,0.28); font-weight:700;" title="Team Match Points">${t.match_points} MP</span>`
          : '';
        const ptvPill = (t.path_to_victory != null && Number(t.path_to_victory) > 0)
          ? `<span style="font-size:0.72rem; padding:1px 7px; border-radius:10px; background:rgba(168,85,247,0.15); color:#c084fc; border:1px solid rgba(168,85,247,0.3); font-weight:700;" title="Path to Victory / Individual Game Score">${t.path_to_victory} PTV</span>`
          : '';
        const battlePtsPill = (t.battle_points != null && Number(t.battle_points) > 0)
          ? `<span style="font-size:0.72rem; padding:1px 7px; border-radius:10px; background:rgba(255,255,255,0.06); color:#f1f5f9; border:1px solid rgba(255,255,255,0.12); font-weight:700;" title="Total Team Battle Points">${t.battle_points} BP</span>`
          : '';

        let roundScoresHtml = '';
        const inlinePills = buildRoundScoresInline(t);
        if (inlinePills) {
          roundScoresHtml = `
            <div style="display:flex; align-items:center; gap:3px; margin-top:5px; font-family:var(--font-mono, monospace); flex-wrap:wrap;">
              <span style="color:var(--text-muted, #94a3b8); font-size:0.7rem; font-family:var(--font-sans, sans-serif); margin-right:3px;">Rounds:</span>
              ${inlinePills}
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
          const rawFacStr = m._displayFac || formatEventPlayerFaction(m.faction || m.army_name || 'Unknown');
          const rawDetStr = (m.detachment && m.detachment !== 'Unknown' && m.detachment !== '-') ? String(m.detachment).trim() : '';
          const mFac = escapeHtml(rawFacStr);
          const mDet = rawDetStr && !rawFacStr.toLowerCase().includes(rawDetStr.toLowerCase()) ? escapeHtml(rawDetStr) : '';
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
            const mDraws = Number(m.event_draws || m.draws || 0);
            const recStr = m.event_wins != null ? `${m.event_wins}W-${m.event_losses || 0}L${mDraws > 0 ? '-' + mDraws + 'D' : ''}` : '';
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
                <span class="badge" style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); font-size:0.75rem; color:#cbd5e1; padding:2px 8px; border-radius:4px;" title="${mFac}${mDet ? ' • ' + mDet : ''}">
                  ${mFac}${mDet ? ` <span style="color:#94a3b8; font-weight:500;">(${mDet})</span>` : ''}
                </span>
              </div>

              ${col3Html}
              ${col4Html}
            </div>
          `;
        }).join('');

        cardsHtml.push(`
          <div id="team-roster-card-${idx}" class="team-roster-card">
            <div class="team-roster-header" onclick="toggleTeamRosterCard('${idx}')">
              <div class="team-header-main">
                <span id="team-chevron-${idx}" class="team-chevron">▼</span>
                ${rankBadgeHtml}
                <div class="team-info">
                  <div class="team-title-row">
                    <span class="team-name">${escapeHtml(t.name || 'Team')}</span>
                    ${winsPill}
                    ${matchPtsPill}
                    ${ptvPill}
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
                <div>Faction &amp; Detachment</div>
                <div style="text-align:right;">${isStarted ? 'Record / Pts' : 'Elo Rating'}</div>
                <div class="team-col-checkin" style="text-align:right;">${isStarted ? 'Elo Rating' : 'Check-in'}</div>
              </div>
              ${memberRowsHtml || '<div style="padding:0.75rem 1rem; color:var(--text-muted); font-size:0.8rem;">Syncing team member roster...</div>'}
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

  // Branch 2: Team Placings Table view (or fallback when only team_standings exist)
  if (container) container.style.display = 'none';
  if (tableWrap) tableWrap.style.display = 'block';
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
        if (eloA !== eloB) return sortCfg.asc ? (eloA - eloB) : (eloB - eloA);
        return (Number(b.event_net_elo || 0) - Number(a.event_net_elo || 0));
      });
    } else if (sortCfg.field === 'event_wins') {
      eventPlayersCache.sort((a, b) => {
        const wA = Number(a.event_wins || 0), wB = Number(b.event_wins || 0);
        const lA = Number(a.event_losses || 0), lB = Number(b.event_losses || 0);
        const bpA = Number(a.event_battle_points || 0), bpB = Number(b.event_battle_points || 0);
        const cmp = (wA - wB) || (lB - lA) || (bpA - bpB);
        return sortCfg.asc ? cmp : -cmp;
      });
    } else if (sortCfg.field === 'event_battle_points') {
      eventPlayersCache.sort((a, b) => {
        const bpA = Number(a.event_battle_points || 0), bpB = Number(b.event_battle_points || 0);
        const wA = Number(a.event_wins || 0), wB = Number(b.event_wins || 0);
        const cmp = (bpA - bpB) || (wA - wB);
        return sortCfg.asc ? cmp : -cmp;
      });
    } else if (sortCfg.field === 'faction') {
      eventPlayersCache.sort((a, b) => {
        const fA = String(a._formattedFaction || formatEventPlayerFaction(a.faction || a.army_name) || '').toLowerCase();
        const fB = String(b._formattedFaction || formatEventPlayerFaction(b.faction || b.army_name) || '').toLowerCase();
        const cmp = fA.localeCompare(fB);
        return sortCfg.asc ? cmp : -cmp;
      });
    } else if (sortCfg.field === 'has_list') {
      eventPlayersCache.sort((a, b) => {
        const lA = hasPlayerSubmittedList(a) ? 1 : 0;
        const lB = hasPlayerSubmittedList(b) ? 1 : 0;
        const cmp = (lA - lB) || String(a.full_name || '').localeCompare(String(b.full_name || ''));
        return sortCfg.asc ? cmp : -cmp;
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

  const eloSort = (typeof currentSort !== 'undefined' && currentSort['event-elo']) || { field: 'current_elo', asc: false };
  const sorted = [...eventPlayersCache].sort((a, b) => {
    let cmp = 0;
    if (eloSort.field === 'full_name') {
      cmp = String(a.full_name || '').localeCompare(String(b.full_name || ''));
    } else if (eloSort.field === 'faction') {
      const fA = String(a._formattedFaction || formatEventPlayerFaction(a.faction || a.army_name) || '').toLowerCase();
      const fB = String(b._formattedFaction || formatEventPlayerFaction(b.faction || b.army_name) || '').toLowerCase();
      cmp = fA.localeCompare(fB);
    } else {
      cmp = (Number(a.current_elo || 1500) - Number(b.current_elo || 1500));
    }
    return eloSort.asc ? cmp : -cmp;
  });

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
let _pairingsLastEventId = '';
let _pairingsStatusFilter = 'all'; // 'all' | 'unfinished' | 'completed' | 'judge'

function setEventRoundFilter(roundVal) {
  selectedEventRound = roundVal;
  if (roundVal !== 'all') {
    _toHubRadarRound = Number(roundVal) || 1;
  }
  renderEventPairingsRows();
}

function setEventPairingsStatusFilter(filterVal) {
  _pairingsStatusFilter = filterVal || 'all';
  _toHubRadarFilter = _pairingsStatusFilter;
  renderEventPairingsRows();
}
window.setEventPairingsStatusFilter = setEventPairingsStatusFilter;

function renderEventPairingsRows(roundArg) {
  if (roundArg !== undefined && roundArg !== null) {
    selectedEventRound = roundArg;
    if (roundArg !== 'all') {
      _toHubRadarRound = Number(roundArg) || 1;
    }
  }
  const tbody = document.getElementById('event-pairings-body');
  const cardsContainer = document.getElementById('event-pairings-cards-container');
  const roundsContainer = document.getElementById('event-rounds-filter');
  if (typeof renderEventClockAndScheduleWidgets === 'function' && currentEventData) {
    renderEventClockAndScheduleWidgets(currentEventData);
  }
  if (!tbody && !cardsContainer) return;

  if (!eventMatchesCache || eventMatchesCache.length === 0) {
    if (roundsContainer) {
      roundsContainer.innerHTML = '';
      roundsContainer.style.display = 'none';
      delete roundsContainer.dataset.renderedKey;
    }
    const emptyHtml = `
      <div class="card empty-state" style="padding:2.5rem 1rem; text-align:center;">
        <div style="font-size:1.05rem; font-weight:600; color:#fff;">⚔️ No Round Pairings Published Yet</div>
        <div style="margin-top:0.5rem; color:var(--text-secondary); font-size:0.86rem;">
          Round pairings and table matchups will appear here once the tournament organizer draws and posts Round 1.
        </div>
      </div>`;
    if (cardsContainer) cardsContainer.innerHTML = emptyHtml;
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="padding:2.5rem 1rem;">⚔️ No Round Pairings Published Yet</td></tr>`;
    }
    return;
  }

  const idxState = ensureEventSearchIndex();
  const eventId = currentOpenEventId || (currentEventData && currentEventData.id) || '';

  // 1. Extract and render distinct round buttons (R1, R2, R3... + All Rounds)
  const distinctRounds = idxState.distinctRounds;
  if (_pairingsLastEventId !== String(eventId)) {
    _pairingsLastEventId = String(eventId);
    _pairingsStatusFilter = 'all';
    if (distinctRounds.length > 0) {
      const curR = Number(currentEventData?.current_round || 0);
      selectedEventRound = (curR > 0 && distinctRounds.includes(curR)) ? curR : distinctRounds[distinctRounds.length - 1];
    } else {
      selectedEventRound = 'all';
    }
  }
  if (selectedEventRound !== 'all' && !distinctRounds.includes(Number(selectedEventRound))) {
    selectedEventRound = distinctRounds.length > 0 ? distinctRounds[distinctRounds.length - 1] : 'all';
  }
  if (selectedEventRound !== 'all') {
    _toHubRadarRound = Number(selectedEventRound) || 1;
  } else if (distinctRounds.length > 0) {
    _toHubRadarRound = distinctRounds[distinctRounds.length - 1];
  }

  const maxR = distinctRounds.length > 0 ? Math.max(...distinctRounds) : 1;

  if (roundsContainer) {
    roundsContainer.style.display = 'flex';
    const roundsRenderKey = `${eventId}:${eventMatchesCache.length}:${selectedEventRound}`;
    if (roundsContainer.dataset.renderedKey !== roundsRenderKey) {
      let pillsHtml = '';
      distinctRounds.forEach(r => {
        const rCount = idxState.roundCounts.get(r) || 0;
        const rMeta = typeof getEventRoundMetadata === 'function'
          ? getEventRoundMetadata(currentEventData, eventMatchesCache, r, maxR)
          : { shortLabel: `Round ${r}` };
        const isAct = Number(selectedEventRound) === Number(r);
        pillsHtml += `
          <button class="round-filter-btn ${isAct ? 'active' : ''}" onclick="setEventRoundFilter(${r})">
            Round ${r} (${rCount})${rMeta.isShadowRound ? ' 🌑' : (rMeta.isTopCut ? ' 🏆' : '')}
          </button>
        `;
      });
      pillsHtml += `
        <button class="round-filter-btn ${selectedEventRound === 'all' ? 'active' : ''}" onclick="setEventRoundFilter('all')">
          All Rounds (${eventMatchesCache.length})
        </button>
      `;
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
                Your active match is ready to play. Track live scores or submit to BCP via My Station.
              </div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
            ${oppHasList ? `
              <button type="button" class="btn btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(safeOppId || safeOppName)}', '${escapeHtml(safeOppListId)}')" style="font-size:0.75rem; font-weight:700; padding:5px 10px; color:#38bdf8; border-color:rgba(56,189,248,0.45); background:rgba(56,189,248,0.1); cursor:pointer; display:inline-flex; align-items:center; gap:0.3rem; border-radius:6px;">
                📋 Opponent Roster
              </button>
            ` : ''}
            <button type="button" class="btn btn-primary" onclick="switchEventModalTab('player'); switchMyStationSubtab('match');" style="font-size:0.76rem; font-weight:800; padding:5px 12px; background:#38bdf8; border-color:#0284c7; color:#000; cursor:pointer; display:inline-flex; align-items:center; gap:0.35rem; border-radius:6px;">
              ⚡ Open My Station ➔
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
      const targetStreamTable = (eventLiveStreams[creatorActiveStreamIndex]?.tableNumber !== undefined)
        ? eventLiveStreams[creatorActiveStreamIndex].tableNumber
        : (selectedCasterTable !== undefined && selectedCasterTable !== null ? selectedCasterTable : (eventLiveStreams[0]?.tableNumber ?? 1));
      streamAlertWrap.style.display = 'flex';
      streamAlertWrap.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 8px #ef4444;"></span>
          <span style="font-size: 0.82rem; font-weight: 700; color: #fff;">🔴 Live Table Coverage:</span>
          <span style="font-size: 0.78rem; color: #fca5a5;">
            ${eventLiveStreams.map(s => {
              const tLbl = Number(s.tableNumber) === 0 ? 'Main Desk' : `Table ${s.tableNumber}`;
              const rLbl = s.roundNumber ? ` (R${s.roundNumber})` : '';
              return `<strong>${tLbl}${rLbl}</strong> (${escapeHtml(s.channel)})`;
            }).join(' • ')}
          </span>
        </div>
        <button type="button" class="btn btn-primary" onclick="openEventStreamModal(${targetStreamTable})" style="font-size: 0.74rem; font-weight: 700; padding: 4px 10px; background: #ef4444; border-color: #dc2626; color: #fff; cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem;">
          📺 Watch Broadcast Theater (${eventLiveStreams.length})
        </button>
      `;
    } else {
      streamAlertWrap.style.display = 'none';
    }
  }

  // 2. Filter matches by selected round
  const baseRoundMatches = selectedEventRound === 'all'
    ? eventMatchesCache
    : eventMatchesCache.filter(m => (m.round || 1) === Number(selectedEventRound));

  // Expose baseRoundMatches on window._toHubCurrentRoundMatches so TO contact modal & floor actions work directly
  window._toHubCurrentRoundMatches = baseRoundMatches;

  // Compute round completion & judge call metrics for the selected round
  const toHubState = (typeof _eventToHubStateCache !== 'undefined' && _eventToHubStateCache.get(String(eventId))) || {};
  const judgeCalls = Array.isArray(toHubState.judge_calls) ? toHubState.judge_calls : [];
  const openJudgeCalls = judgeCalls.filter(c => String(c.status || 'open').toLowerCase() !== 'resolved');
  const activeSessions = Array.isArray(toHubState.active_sessions) ? toHubState.active_sessions : [];
  const judgeTablesSet = new Set(openJudgeCalls.map(c => String(c.table_number || c.table || '')).filter(Boolean));
  const sessionTablesSet = new Set(activeSessions.map(s => String(s.table_number || s.table || '')).filter(Boolean));

  const totalRoundCount = baseRoundMatches.length;
  const completedRoundMatches = baseRoundMatches.filter(m => isToHubMatchCompleted(m));
  const unfinishedRoundMatches = baseRoundMatches.filter(m => !isToHubMatchCompleted(m));
  const completionPct = totalRoundCount > 0 ? Math.round((completedRoundMatches.length / totalRoundCount) * 100) : 0;

  // 3. Apply search query
  let matchesToRender = baseRoundMatches.map((m, idx) => ({ m, idx }));

  if (eventModalSearchQuery) {
    const q = eventModalSearchQuery;
    matchesToRender = matchesToRender.filter(({ m }) => m && m._searchText && m._searchText.includes(q));
  }

  const searchSummary = document.getElementById('event-modal-search-summary');
  if (searchSummary && currentEventModalTab === 'matches') {
    if (eventModalSearchQuery) {
      searchSummary.innerText = `Showing ${matchesToRender.length} of ${baseRoundMatches.length} pairings`;
      searchSummary.style.display = 'block';
    } else {
      searchSummary.style.display = 'none';
    }
  }

  const canAccessToHub = Boolean(typeof canUserAccessEventToHub === 'function' && canUserAccessEventToHub(currentEventData));

  if (matchesToRender.length === 0) {
    const suggestions = getEventModalCrossTabSuggestions('matches');
    const noMatchHtml = `
      <div class="card empty-state" style="padding:2.5rem 1rem; text-align:center;">
        <div style="font-size:1.05rem; font-weight:600; color:#fff;">🔍 No Matching Table Pairings</div>
        <div style="margin-top:0.5rem; color:var(--text-secondary); font-size:0.86rem;">
          ${eventModalSearchQuery
            ? `No match pairings match "<strong>${escapeHtml(eventModalSearchQuery)}</strong>"${selectedEventRound !== 'all' ? ` in Round ${selectedEventRound}` : ''}.`
            : `No pairings found for this round.`}
        </div>
        ${suggestions}
      </div>`;
    if (cardsContainer) cardsContainer.innerHTML = noMatchHtml;
    if (tbody) tbody.innerHTML = '';
    return;
  }

  // Permission & identity checks
  const u = (typeof authState !== 'undefined' && authState && authState.user) ||
            (typeof currentUser !== 'undefined' ? currentUser : null) ||
            (typeof window !== 'undefined' ? window.currentUser : null);

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
  const cardsHtml = [];

  for (let i = 0; i < matchesToRender.length; i++) {
    const { m, idx } = matchesToRender[i];
    try {
      const isBye = Boolean(m.is_bye || m.player2_name === 'BYE' || !m.player2_id);
      const rawTNum = Number(m.table_number ?? m.table ?? 0);
      const tNumInt = rawTNum > 0 ? rawTNum : (idx + 1);
      const tNumStr = String(tNumInt);
      const rNumInt = Number(m.round || m.round_number || 1);
      const tableBadgeLabel = (rawTNum === 0 && isBye)
        ? (selectedEventRound === 'all' ? `R${rNumInt} • BYE` : 'BYE')
        : (selectedEventRound === 'all' ? `R${rNumInt} • Table ${tNumInt}` : `Table ${tNumInt}`);

      const isDone = isToHubMatchCompleted(m);
      const hasJudgeCall = judgeTablesSet.has(tNumStr);
      const hasTracker = sessionTablesSet.has(tNumStr) || Boolean(m.has_tracker_game);
      const matchId = m.tracker_match_id || `BCP-${eventId}-R${rNumInt}-T${tNumInt}`;

      const p1Record = m._p1Record !== undefined ? m._p1Record : lookupEventPlayerFast(m.player1_id, m.player1_name);
      const p2Record = m._p2Record !== undefined ? m._p2Record : lookupEventPlayerFast(m.player2_id, m.player2_name);
      const p1Name = m.player1_name || p1Record?.full_name || 'Player 1';
      const p2Name = isBye ? 'BYE' : (m.player2_name || p2Record?.full_name || 'Player 2');
      const p1Faction = m._p1Faction !== undefined ? m._p1Faction : (m.player1_faction || p1Record?.faction || '');
      const p2Faction = m._p2Faction !== undefined ? m._p2Faction : (m.player2_faction || p2Record?.faction || '');
      const p1Detach = p1Record?.detachment || m.player1_detachment || '';
      const p2Detach = p2Record?.detachment || m.player2_detachment || '';

      const s1 = m.player1_score ?? m.score1 ?? null;
      const s2 = m.player2_score ?? m.score2 ?? null;
      const isP1Win = Boolean((m.winner_id && String(m.winner_id) === String(m.player1_id)) || (isDone && s1 !== null && s2 !== null && Number(s1) > Number(s2)));
      const isP2Win = Boolean(!isBye && ((m.winner_id && String(m.winner_id) === String(m.player2_id)) || (isDone && s1 !== null && s2 !== null && Number(s2) > Number(s1))));

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
      const isMyTable = Boolean(isP1 || isP2);

      const targetP1Id = String((p1Record && p1Record.player_id) || m.player1_id || '').replace(/'/g, "\\'");
      const targetP1Name = String((p1Record && (p1Record.full_name || p1Record.name)) || p1Name || '').replace(/'/g, "\\'");
      const targetP2Id = String((p2Record && p2Record.player_id) || m.player2_id || '').replace(/'/g, "\\'");
      const targetP2Name = String((p2Record && (p2Record.full_name || p2Record.name)) || p2Name || '').replace(/'/g, "\\'");
      const p1ListId = String(m.player1_list_id || (p1Record && (p1Record.list_id || p1Record.listId)) || '').replace(/'/g, "\\'");
      const p2ListId = String(m.player2_list_id || (p2Record && (p2Record.list_id || p2Record.listId)) || '').replace(/'/g, "\\'");
      const p1HasList = Boolean((p1Record && hasPlayerSubmittedList(p1Record)) || p1ListId);
      const p2HasList = Boolean(!isBye && ((p2Record && hasPlayerSubmittedList(p2Record)) || p2ListId));

      const p1Prob = m._p1_win_prob !== undefined ? m._p1_win_prob : 50;
      const p2Prob = m._p2_win_prob !== undefined ? m._p2_win_prob : 50;
      const matchStream = streamByTableMap.get(tNumInt) || defaultStream;

      let borderCol = 'rgba(255,255,255,0.09)';
      let bgCol = 'rgba(15,23,42,0.82)';
      let statusBadge = `<span class="badge" style="background:rgba(245,158,11,0.16); color:#fbbf24; font-size:0.64rem; padding:1px 6px;">⏳ IN PLAY</span>`;
      if (hasJudgeCall) {
        borderCol = 'rgba(239,68,68,0.65)';
        bgCol = 'rgba(239,68,68,0.09)';
        statusBadge = `<span class="badge" style="background:rgba(239,68,68,0.28); color:#fca5a5; font-size:0.64rem; padding:1px 6px;">🚨 JUDGE</span>`;
      } else if (isDone) {
        borderCol = 'rgba(16,185,129,0.38)';
        bgCol = 'rgba(16,185,129,0.05)';
        statusBadge = `<span class="badge" style="background:rgba(16,185,129,0.2); color:#34d399; font-size:0.64rem; padding:1px 6px;">✅ FINAL</span>`;
      } else if (hasTracker) {
        borderCol = 'rgba(56,189,248,0.45)';
        statusBadge = `<span class="badge" style="background:rgba(56,189,248,0.18); color:#38bdf8; font-size:0.64rem; padding:1px 6px;">🟢 TRACKER</span>`;
      }
      if (isMyTable) {
        borderCol = '#38bdf8';
      }

      const toTableContactBtn = canAccessToHub ? `
        <button type="button" onclick="event.stopPropagation(); openToHubTableCommsModal(${idx}, 'table')" title="Send targeted announcement or alert to ${escapeHtml(tableBadgeLabel)}" style="padding:2px 7px; font-size:0.66rem; font-weight:800; border-radius:5px; border:1px solid rgba(245,158,11,0.5); background:rgba(245,158,11,0.15); color:#fbbf24; cursor:pointer; display:inline-flex; align-items:center; gap:3px; line-height:1.2;">
          📢 Contact
        </button>
      ` : '';

      const toP1CommsBtn = canAccessToHub ? `
        <button type="button" onclick="event.stopPropagation(); openToHubTableCommsModal(${idx}, 'p1')" title="Message ${escapeHtml(p1Name)}" style="padding:1px 5px; font-size:0.64rem; border-radius:4px; border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.06); color:#cbd5e1; cursor:pointer; flex-shrink:0;">💬</button>
      ` : '';

      const toP2CommsBtn = (canAccessToHub && !isBye) ? `
        <button type="button" onclick="event.stopPropagation(); openToHubTableCommsModal(${idx}, 'p2')" title="Message ${escapeHtml(p2Name)}" style="padding:1px 5px; font-size:0.64rem; border-radius:4px; border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.06); color:#cbd5e1; cursor:pointer; flex-shrink:0;">💬</button>
      ` : '';

      const p1RosterBtn = p1HasList ? `
        <button type="button" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(targetP1Id || targetP1Name)}', '${escapeHtml(p1ListId)}')" title="View ${escapeHtml(p1Name)}'s Army Roster" style="padding:1px 5px; font-size:0.64rem; border-radius:4px; border:1px solid rgba(56,189,248,0.35); background:rgba(56,189,248,0.1); color:#38bdf8; cursor:pointer; font-weight:700; flex-shrink:0;">📋</button>
      ` : '';

      const p2RosterBtn = p2HasList ? `
        <button type="button" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(targetP2Id || targetP2Name)}', '${escapeHtml(p2ListId)}')" title="View ${escapeHtml(p2Name)}'s Army Roster" style="padding:1px 5px; font-size:0.64rem; border-radius:4px; border:1px solid rgba(56,189,248,0.35); background:rgba(56,189,248,0.1); color:#38bdf8; cursor:pointer; font-weight:700; flex-shrink:0;">📋</button>
      ` : '';

      const streamBadgeBtn = matchStream ? `
        <button type="button" onclick="event.stopPropagation(); openEventStreamModal(${matchStream.tableNumber})" title="Watch ${escapeHtml(matchStream.channel)} Live Stream" style="padding:1px 6px; font-size:0.64rem; font-weight:800; border-radius:4px; border:1px solid #ef4444; background:rgba(239,68,68,0.2); color:#fca5a5; cursor:pointer; display:inline-flex; align-items:center; gap:3px;">
          🔴 LIVE
        </button>
      ` : '';

      cardsHtml.push(`
        <div class="to-hub-radar-card to-hub-table-card" onclick="openCasterDeskTableModal(${tNumInt}, ${rNumInt}, ${idx})" style="padding:0.75rem 0.85rem; border-radius:10px; background:${bgCol}; border:1px solid ${borderCol}; display:flex; flex-direction:column; gap:0.48rem; cursor:pointer; transition:transform 0.12s ease, border-color 0.15s ease, box-shadow 0.15s ease;" title="Click to open ${escapeHtml(tableBadgeLabel)} Matchup & Player Dossiers">
          <!-- Card Header: Table Number, Stream Badge, Status & TO Contact -->
          <div style="display:flex; align-items:center; justify-content:space-between; gap:0.35rem; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:0.4rem; flex-wrap:wrap;">
            <div style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
              <span style="font-family:var(--font-mono); font-size:0.76rem; font-weight:900; color:#f8fafc; background:rgba(255,255,255,0.08); padding:2px 7px; border-radius:5px;">
                ${escapeHtml(tableBadgeLabel)}
              </span>
              ${isMyTable ? `<span class="badge" style="background:#0284c7; color:#fff; font-size:0.62rem; font-weight:800; padding:1px 5px; border:none;">YOU</span>` : ''}
              ${streamBadgeBtn}
            </div>
            <div style="display:flex; align-items:center; gap:0.3rem; flex-wrap:wrap;">
              ${statusBadge}
              ${toTableContactBtn}
            </div>
          </div>

          <!-- Player 1 Row -->
          <div style="display:flex; align-items:center; justify-content:space-between; gap:0.4rem;">
            <div style="min-width:0; flex:1;">
              <div style="display:flex; align-items:center; gap:0.3rem;">
                <span style="font-size:0.82rem; font-weight:700; color:${isP1Win ? '#4ade80' : '#f8fafc'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(p1Name)}">
                  ${escapeHtml(p1Name)}
                </span>
                ${!isBye ? `<span style="font-family:var(--font-mono); font-size:0.64rem; color:#38bdf8; flex-shrink:0;" title="Elo Win Probability">${p1Prob}%</span>` : ''}
                ${p1RosterBtn}
                ${toP1CommsBtn}
              </div>
              <div style="font-size:0.68rem; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${escapeHtml(p1Faction || 'Unassigned')}${p1Detach && p1Detach !== 'Unknown' ? ` • ${escapeHtml(p1Detach)}` : ''}
              </div>
            </div>
            <span style="font-family:var(--font-mono); font-size:0.9rem; font-weight:800; color:${isP1Win ? '#4ade80' : (s1 !== null ? '#f8fafc' : 'var(--text-muted)')}; flex-shrink:0;">
              ${s1 !== null && s1 !== undefined ? s1 : '—'}
            </span>
          </div>

          <!-- Player 2 Row -->
          <div style="display:flex; align-items:center; justify-content:space-between; gap:0.4rem;">
            <div style="min-width:0; flex:1;">
              <div style="display:flex; align-items:center; gap:0.3rem;">
                <span style="font-size:0.82rem; font-weight:700; color:${isBye ? 'var(--text-muted)' : (isP2Win ? '#4ade80' : '#f8fafc')}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(p2Name)}">
                  ${escapeHtml(p2Name)}
                </span>
                ${!isBye ? `<span style="font-family:var(--font-mono); font-size:0.64rem; color:#f43f5e; flex-shrink:0;" title="Elo Win Probability">${p2Prob}%</span>` : ''}
                ${p2RosterBtn}
                ${toP2CommsBtn}
              </div>
              ${!isBye ? `
                <div style="font-size:0.68rem; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  ${escapeHtml(p2Faction || 'Unassigned')}${p2Detach && p2Detach !== 'Unknown' ? ` • ${escapeHtml(p2Detach)}` : ''}
                </div>
              ` : ''}
            </div>
            <span style="font-family:var(--font-mono); font-size:0.9rem; font-weight:800; color:${isP2Win ? '#4ade80' : (s2 !== null ? '#f8fafc' : 'var(--text-muted)')}; flex-shrink:0;">
              ${isBye ? 'BYE' : (s2 !== null && s2 !== undefined ? s2 : '—')}
            </span>
          </div>

          <!-- Card Footer: Dossiers Hint + Quick Scorecard / Tracker -->
          <div style="display:flex; align-items:center; justify-content:space-between; gap:0.4rem; border-top:1px dashed rgba(255,255,255,0.06); padding-top:0.38rem; margin-top:0.05rem;">
            <span style="font-size:0.67rem; color:#94a3b8; font-weight:600; display:inline-flex; align-items:center; gap:0.25rem;">
              🔍 Matchup & Dossiers
            </span>
            <div style="display:flex; align-items:center; gap:0.3rem;">
              ${(!isBye && !isDone && isMyTable) ? `
                <button type="button" onclick="event.stopPropagation(); launchTournamentTracker('${safeEventId}', ${rNumInt}, ${tNumInt}, '${escapeHtml(targetP1Name)}', '${escapeHtml(targetP2Name)}', '${escapeHtml(targetP1Id)}', '${escapeHtml(targetP2Id)}', '${escapeHtml(String(m.id || m.pairing_id || ''))}')" style="font-size:0.66rem; padding:2px 7px; background:#0284c7; color:#fff; border:1px solid #38bdf8; border-radius:5px; font-weight:700; cursor:pointer;">
                  🎲 Track
                </button>
              ` : ''}
              ${!isBye ? `
                <button type="button" onclick="event.stopPropagation(); openScorecardModal('${escapeHtml(matchId)}')" style="font-size:0.66rem; padding:2px 7px; background:rgba(255,255,255,0.04); color:#cbd5e1; border:1px solid rgba(255,255,255,0.14); border-radius:5px; font-weight:600; cursor:pointer;" title="View Game Scorecard">
                  📄 Scorecard
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `);
    } catch (cardErr) {
      console.error('Error rendering pairing table card:', cardErr, m);
    }
  }

  if (cardsContainer) {
    cardsContainer.innerHTML = `
      <div class="to-hub-radar-grid" style="display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:0.75rem;">
        ${cardsHtml.join('')}
      </div>
    `;
  }
  if (tbody) {
    tbody.innerHTML = '';
  }
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
  if (typeof openScorecardModal === 'function') {
    openScorecardModal(matchId);
    return;
  }
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
        openEventModal(eventId, true, 'player');
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

  // 3. Load Factions and select current faction / detachment (non-blocking if not yet cached)
  const gamesystemId = reg.gamesystem_id || 'WGMSzfKFYA';
  const factionSelect = document.getElementById('player-reg-faction');
  const detachmentSelect = document.getElementById('player-reg-detachment');

  const applyFactionsToPlayerSelects = (factions) => {
    if (!factionSelect) return;
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
  };

  if (typeof cachedGamesystemFactions !== 'undefined' && cachedGamesystemFactions[gamesystemId]) {
    await loadGamesystemFactions(gamesystemId);
    applyFactionsToPlayerSelects(cachedGamesystemFactions[gamesystemId]);
  } else {
    applyFactionsToPlayerSelects(null);
    loadGamesystemFactions(gamesystemId).then(factions => {
      applyFactionsToPlayerSelects(factions);
    }).catch(() => {});
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

function getEventTierBadgeHtml(totalPlayers, eventName = '', numRounds = 0) {
  const count = Number(totalPlayers || 0);
  const rounds = Number(numRounds || 0);
  const nameLower = String(eventName || '').toLowerCase();
  if ((rounds > 0 && rounds <= 3) || (rounds <= 3 && (/\brtt\b/.test(nameLower) || nameLower.includes('rogue trader')))) {
    return `<span class="badge" style="background:rgba(148,163,184,0.16); color:#cbd5e1; border:1px solid rgba(148,163,184,0.35); font-weight:800; font-size:0.72rem; letter-spacing:0.04em;">🛡️ RTT</span>`;
  }
  if (count >= 100 || nameLower.includes('super major') || nameLower.includes('lvo') || nameLower.includes('adepticon') || nameLower.includes('nova open')) {
    return `<span class="badge" style="background:rgba(234,179,8,0.18); color:#facc15; border:1px solid rgba(234,179,8,0.4); font-weight:800; font-size:0.72rem; letter-spacing:0.04em;">👑 SUPER MAJOR</span>`;
  } else if (rounds >= 6 || count >= 60 || nameLower.includes('major') || nameLower.includes(' open')) {
    return `<span class="badge" style="background:rgba(168,85,247,0.18); color:#c084fc; border:1px solid rgba(168,85,247,0.4); font-weight:800; font-size:0.72rem; letter-spacing:0.04em;">🏆 MAJOR</span>`;
  } else if (rounds > 3 || count >= 28 || /\bgt\b/.test(nameLower) || nameLower.includes('grand tournament')) {
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
    const explicitDelta = (p.event_net_elo !== undefined && p.event_net_elo !== null) ? p.event_net_elo :
                          (p.net_elo !== undefined && p.net_elo !== null) ? p.net_elo :
                          (p.elo_delta !== undefined && p.elo_delta !== null) ? p.elo_delta : null;
    p._computed_net_elo = explicitDelta !== null ? Number(explicitDelta) : 0;
    p._has_explicit_delta = explicitDelta !== null && Number(explicitDelta) !== 0;
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
  const teams = (ev?.teams && ev.teams.length > 0) ? ev.teams : (ev?.team_standings || []);
  if (
    ev &&
    ev._cachedKpiSummary &&
    ev._cachedKpiPlayersLen === players.length &&
    ev._cachedKpiMatchesLen === matches.length &&
    ev._cachedKpiTeamsLen === teams.length
  ) {
    return ev._cachedKpiSummary;
  }
  const isTeamEvent = Boolean(teams.length > 0);
  const isDoublesEvent = Boolean(isTeamEvent && ev?.is_doubles_event);
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
    ev._cachedKpiTeamsLen = teams.length;
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
    metaEl.innerHTML = buildEventModalMetaHtml(ev, kpi.numRounds);
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
    badgesEl.innerHTML = `${getEventTierBadgeHtml(kpi.totalPlayers, ev.name || ev.event_name || '', kpi.numRounds)} ${sysBadge} ${statusBadge} ${formatBadge}`;
  }

  // Personal Registration State (used to default to Player Station / My Results tab when opening Event Hub)
  userRegData = synthesizeClientUserEventRegistration(ev, userRegData);
  currentEventRegistration = (userRegData && userRegData.is_registered) ? userRegData : null;
  const regBanner = document.getElementById('modal-quick-reg-banner');
  if (regBanner) {
    regBanner.style.display = 'none';
    regBanner.innerHTML = '';
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
        <th style="width:56px; padding:0.55rem 0.6rem;">Rank</th>
        <th style="width:32%; padding:0.55rem 0.65rem;">Team</th>
        <th style="width:30%; padding:0.55rem 0.65rem;">Captain / Members</th>
        <th style="width:16%; padding:0.55rem 0.6rem;">Match Points</th>
        <th style="width:16%; padding:0.55rem 0.6rem;">Battle Points</th>
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
          <td class="rank-cell" style="padding:0.5rem 0.6rem;">${rank}</td>
          <td style="padding:0.5rem 0.65rem; font-weight:700; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(t.name || 'Team')}">🛡️ ${escapeHtml(t.name || 'Team')}</td>
          <td style="padding:0.5rem 0.65rem; color:var(--text-secondary); font-size:0.82rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(cap)}${memberCount}">${escapeHtml(cap)}${memberCount}</td>
          <td style="padding:0.5rem 0.6rem; font-family:var(--font-mono); font-weight:700; color:var(--win);">${t.match_points ?? t.wins ?? '-'} pts</td>
          <td style="padding:0.5rem 0.6rem; font-family:var(--font-mono); font-weight:700; color:var(--accent);">${t.battle_points ?? '-'} BP</td>
        </tr>
      `;
    }).join('');
    return;
  }

  // Default: Players Standings / Roster view
  thead.innerHTML = `
    <tr>
      <th style="width:50px; text-align:center; padding:0.55rem 0.5rem;">Rank</th>
      <th style="width:28%; padding:0.55rem 0.6rem;">Competitor</th>
      <th style="width:22%; padding:0.55rem 0.6rem;">Faction</th>
      <th style="width:110px; text-align:center; padding:0.55rem 0.5rem;">Record / Status</th>
      <th style="width:130px; text-align:center; padding:0.55rem 0.5rem;">Elo & Net Δ</th>
      <th style="width:74px; text-align:right; padding:0.55rem 0.6rem;">List</th>
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
      ? `<span style="font-family:var(--font-mono); font-size:0.72rem; font-weight:700; color:${netEloColor}; margin-left:4px;">(${netEloStr})</span>`
      : '';

    return `
      <tr style="cursor:pointer;" onclick="event.stopPropagation(); openPlayerModal('${safePid}', '${escapeHtml(safeName)}');">
        <td class="rank-cell" style="width:50px; text-align:center; padding:0.5rem 0.5rem;">${rankStr}</td>
        <td class="modal-quick-competitor-col" style="padding:0.5rem 0.6rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          <div class="modal-quick-competitor-name" style="font-weight:600; color:#38bdf8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(safeName)}">${escapeHtml(safeName)}</div>
          ${p.team ? `<div class="modal-quick-competitor-team" style="font-size:0.72rem; color:var(--text-muted); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(p.team)}">🛡️ ${escapeHtml(p.team)}</div>` : ''}
        </td>
        <td style="padding:0.5rem 0.6rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          ${displayFac && displayFac !== '-' ? `
            <span class="badge" title="${escapeHtml(displayFac)}${p.detachment ? ` (${escapeHtml(p.detachment)})` : ''}" style="background:var(--bg-card); border:1px solid var(--border); font-size:0.73rem; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-block; vertical-align:middle;">
              ${escapeHtml(displayFac)}
            </span>
          ` : `<span style="color:var(--text-muted); font-size:0.85rem; font-weight:500;">-</span>`}
        </td>
        <td style="width:110px; text-align:center; padding:0.5rem 0.5rem; white-space:nowrap;">${recordHtml}</td>
        <td style="width:130px; text-align:center; padding:0.5rem 0.5rem; white-space:nowrap;">
          <span class="elo-badge ${getEloBadgeClass(p.current_elo)}" style="font-size:0.76rem;">${Number(p.current_elo || 1500).toFixed(1)}</span>
          ${netPill}
        </td>
        <td style="width:74px; padding:0.5rem 0.6rem; text-align:right; white-space:nowrap;">
          ${hasPlayerSubmittedList(p) ? `
            <button type="button" class="btn-sm btn-outline" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(safePid || safeName)}')" style="font-size:0.72rem; padding:2px 7px; cursor:pointer;" title="View competitor army roster">
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
  const isTeam = Boolean(currentEventData && ((currentEventData.teams && currentEventData.teams.length > 0) || (currentEventData.team_standings && currentEventData.team_standings.length > 0)));

  let targetTab = explicitTab;
  if (!targetTab) {
    const isOngoing = (typeof isTournamentOngoing === 'function')
      ? isTournamentOngoing(currentEventData)
      : (!ended && (currentEventData?.matches || []).length > 0);
    if (isRegistered) {
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
  if (typeof currentSort !== 'undefined') {
    currentSort['event-results'] = { field: 'placement', asc: true };
  }

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
  const candidateCached = (currentEventData && String(currentEventData.id) === String(eventId)) ? currentEventData : clientCached;
  const isCandidateIncomplete = Boolean(
    candidateCached && (
      candidateCached.sync_in_progress ||
      ((candidateCached.is_team_event || Number(candidateCached.total_teams || 0) > 0) && (!Array.isArray(candidateCached.teams) || candidateCached.teams.length === 0))
    )
  );
  const hasCached = Boolean(!options.forceSync && candidateCached && !isCandidateIncomplete);

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
    let ev = hasCached ? candidateCached : null;
    let userRegData = (currentEventRegistration && String(currentEventRegistration.event_id || eventId) === String(eventId)) ? currentEventRegistration : null;

    if (!hasCached || !ev) {
      const detailsPromise = window.api.getTournamentDetails(eventId, Boolean(options.forceSync), isCandidateIncomplete);
      const regPromise = (typeof window.api?.getCommunityEventRegistration === 'function')
        ? window.api.getCommunityEventRegistration(eventId, Boolean(options.forceSync)).catch(() => null)
        : Promise.resolve(null);

      const [detailsRes, regRes] = await Promise.allSettled([detailsPromise, regPromise]);
      if (detailsRes.status === 'rejected' || !detailsRes.value || detailsRes.value.error) {
        throw new Error((detailsRes.value && detailsRes.value.error) || detailsRes.reason?.message || 'Tournament not found');
      }
      ev = detailsRes.value;
      userRegData = (regRes.status === 'fulfilled' && regRes.value && !regRes.value.error) ? regRes.value : null;
    } else if (!userRegData && typeof window.api?.getCommunityEventRegistration === 'function') {
      userRegData = await window.api.getCommunityEventRegistration(eventId, Boolean(options.forceSync)).catch(() => null);
    }

    userRegData = synthesizeClientUserEventRegistration(ev, userRegData);
    currentEventData = ev;
    currentEventRegistration = (userRegData && userRegData.is_registered) ? userRegData : null;

    if (ev && ev.sync_in_progress) {
      scheduleEventSyncPoll(eventId);
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

    const teamsList = (ev.teams && ev.teams.length > 0) ? ev.teams : (ev.team_standings || []);
    const isTeamEvent = teamsList.length > 0;
    const isDoublesEvent = Boolean(isTeamEvent && ev.is_doubles_event);
    const subtabTeams = document.getElementById('event-subtab-teams');
    const tabTeamsCount = document.getElementById('event-tab-teams-count');
    const tabResultsCount = document.getElementById('event-tab-results-count');
    const tabMatchesCount = document.getElementById('event-tab-matches-count');

    const placementsCount = eventPlayersCache.filter(p => p.placement && p.placement > 0).length;
    if (tabResultsCount) tabResultsCount.innerText = placementsCount > 0 ? placementsCount : eventPlayersCache.length;
    if (tabMatchesCount) tabMatchesCount.innerText = eventMatchesCache.length;

    const hasTeamPlacings = teamsList.some(t => t.placing && t.placing > 0);

    if (teamsList.length > 0) {
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

    const subtabNews = document.getElementById('event-subtab-news');
    if (subtabNews) {
      subtabNews.style.setProperty('display', 'inline-flex', 'important');
    }

    const canAccessToHub = typeof canUserAccessEventToHub === 'function' ? canUserAccessEventToHub(ev) : false;
    const subtabToHub = document.getElementById('event-subtab-to-hub');
    if (subtabToHub) {
      subtabToHub.style.setProperty('display', 'none', 'important');
    }

    const isCC = Boolean(typeof isUserCC === 'function' ? isUserCC(currentUser) : (currentUser && (currentUser.role === 'admin' || currentUser.role === 'cc' || currentUser.role === 'creator' || currentUser.can_access_cc || currentUser.is_cc || currentUser.is_admin)));
    const subtabCreator = document.getElementById('event-subtab-creator');
    if (subtabCreator) {
      subtabCreator.style.setProperty('display', 'none', 'important');
    }

    const ended = isEventEnded(ev, userRegData);
    const isRegisteredPlayer = Boolean((userRegData && userRegData.is_registered) || (typeof currentDevPersona !== 'undefined' && currentDevPersona === 'competitor'));
    const shouldShowMyStation = Boolean(isRegisteredPlayer || canAccessToHub || isCC);
    const subtabPlayer = document.getElementById('event-subtab-player');
    if (subtabPlayer) {
      subtabPlayer.style.setProperty('display', shouldShowMyStation ? 'inline-flex' : 'none', 'important');
    }
    if (shouldShowMyStation) {
      await renderPlayerStation(ev, userRegData);
    }

    renderEventResultsRows();
    renderEventEloRows();
    renderEventPairingsRows();

    let targetTab = options.initialTab;
    if (targetTab === 'creator' && !isCC) {
      targetTab = 'results';
    }
    if (targetTab === 'to-hub' && !canAccessToHub) {
      targetTab = 'results';
    }
    if (targetTab === 'teams' && teamsList.length === 0) {
      targetTab = 'results';
    }
    if (targetTab === 'player' && !shouldShowMyStation) {
      targetTab = teamsList.length > 0 ? 'teams' : 'results';
    }
    if (!targetTab) {
      const isOngoing = (typeof isTournamentOngoing === 'function')
        ? isTournamentOngoing(ev)
        : (!ended && eventMatchesCache.length > 0);
      if (isRegisteredPlayer) {
        targetTab = 'player';
      } else if (isOngoing && eventMatchesCache.length > 0) {
        targetTab = 'matches';
      } else if (teamsList.length > 0) {
        targetTab = 'teams';
      } else {
        targetTab = 'results';
      }
    }
    switchEventModalTab(targetTab);

    if (typeof loadEventToHubState === 'function') {
      loadEventToHubState(eventId, Boolean(options.forceSync)).catch(() => {});
    }

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
  const locInfo = extractEventLocationDetails(ev);
  const loc = locInfo.displayLabel || 'Online / Unspecified';
  const dStr = (typeof formatEventDateRangeLabel === 'function' ? formatEventDateRangeLabel(ev) : '') || (ev.event_date || '').slice(0, 10);

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

  const mapButtonsHtml = locInfo.hasLocation ? `
    <button type="button" class="btn-sm btn-outline event-hero-map-btn" onclick="event.stopPropagation(); openEventVenueMapModal('${escapeHtml(eventId)}')" style="font-size:0.74rem; padding:3px 9px; border-radius:999px; border-color:rgba(56,189,248,0.45); color:#38bdf8; background:rgba(56,189,248,0.12); cursor:pointer; display:inline-flex; align-items:center; gap:4px; font-weight:700;" title="Open interactive venue map pop-up">
      🗺️ View Map
    </button>
    <button type="button" class="btn-sm btn-outline event-hero-stores-btn" onclick="event.stopPropagation(); openEventInCommunityGameStores('${escapeHtml(eventId)}')" style="font-size:0.74rem; padding:3px 9px; border-radius:999px; border-color:rgba(168,85,247,0.45); color:#c084fc; background:rgba(168,85,247,0.12); cursor:pointer; display:inline-flex; align-items:center; gap:4px; font-weight:700;" title="Find this venue & nearby game stores in Community Hub">
      🏪 Game Stores Hub
    </button>
  ` : '';

  heroSection.innerHTML = `
    <div class="profile-hero-card event-hub-hero-card" style="margin-bottom: 1.25rem;">
      <div class="profile-hero-top">
        <div class="profile-identity-group">
          <div class="profile-rank-crest" title="Tournament Hub">
            🏆
          </div>
          <div class="profile-name-meta">
            <div class="profile-badges-row" style="margin-bottom: 0.35rem;">
              ${getEventTierBadgeHtml(kpi.totalPlayers, eventName, kpi.numRounds)}
              ${sysBadge}
              ${statusBadge}
              ${formatBadge}
            </div>
            <h1 id="event-hub-title" class="profile-name-title" style="font-size: 1.5rem; margin: 0 0 0.3rem 0;">${escapeHtml(eventName)}</h1>
            <div id="event-hub-meta-line" style="font-size: 0.85rem; color: var(--text-secondary); display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <span>📅 ${escapeHtml(dStr || 'Date TBD')}</span>
              <span>•</span>
              <span title="${escapeHtml(locInfo.fullAddressLine || loc)}">📍 ${escapeHtml(loc)}</span>
              ${mapButtonsHtml}
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
    const matchId = m.tracker_match_id || `BCP-${eventId}-R${roundNum}-T${tableNum}`;
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

let _currentMyStationSubtab = 'match'; // 'match' | 'clock' | 'announcements' | 'roster' | 'stream'

function getMyStationAvailableSubtabs(ev, userRegData) {
  const eventObj = ev || currentEventData || {};
  const isPlayer = Boolean(
    (userRegData && userRegData.is_registered) ||
    (currentEventRegistration && currentEventRegistration.is_registered) ||
    (typeof currentDevPersona !== 'undefined' && currentDevPersona === 'competitor')
  );
  const isTO = Boolean(typeof canUserAccessEventToHub === 'function' && canUserAccessEventToHub(eventObj));
  const isCC = Boolean(
    typeof isUserCC === 'function'
      ? isUserCC(currentUser)
      : (currentUser && (currentUser.role === 'admin' || currentUser.role === 'cc' || currentUser.role === 'creator' || currentUser.can_access_cc || currentUser.is_cc || currentUser.is_admin))
  );

  const eventId = String(eventObj.id || eventObj.event_id || currentOpenEventId || '');
  const state = (typeof _eventToHubStateCache !== 'undefined' && _eventToHubStateCache.get(eventId)) || {};
  const judgeCalls = Array.isArray(state.judge_calls) ? state.judge_calls : [];
  const openJudgeCallsCount = judgeCalls.filter(c => String(c.status || 'open').toLowerCase() !== 'resolved').length;
  const players = Array.isArray(eventPlayersCache) && eventPlayersCache.length > 0
    ? eventPlayersCache
    : (Array.isArray(eventObj.players) ? eventObj.players : []);
  const activeRoster = players.filter(p => !p.dropped);
  const listsSubmittedCount = activeRoster.filter(p => Boolean(p.list_id || p.army_list || p.list_text || p.has_list || p.has_list_submitted)).length;
  const missingListCount = Math.max(0, activeRoster.length - listsSubmittedCount);

  const tabs = [];
  if (isPlayer) {
    tabs.push({
      key: 'match',
      icon: '⚔️',
      label: 'My Match & Roster',
      accent: '#38bdf8',
      accentBg: 'rgba(56,189,248,0.16)',
      accentBorder: 'rgba(56,189,248,0.48)',
      badge: '',
    });
  }
  if (isTO) {
    tabs.push(
      {
        key: 'roster',
        icon: '📋',
        label: 'Roster & Audit',
        accent: '#fbbf24',
        accentBg: 'rgba(245,158,11,0.16)',
        accentBorder: 'rgba(245,158,11,0.48)',
        badge: missingListCount > 0 ? String(missingListCount) : '',
        badgeBg: 'rgba(239,68,68,0.22)',
        badgeColor: '#fca5a5',
      },
      {
        key: 'clock',
        icon: '⏱️',
        label: 'Clock & Judge Calls',
        accent: '#fbbf24',
        accentBg: 'rgba(245,158,11,0.16)',
        accentBorder: 'rgba(245,158,11,0.48)',
        badge: openJudgeCallsCount > 0 ? String(openJudgeCallsCount) : '',
        badgeBg: 'rgba(239,68,68,0.28)',
        badgeColor: '#fca5a5',
      },
      {
        key: 'announcements',
        icon: '📢',
        label: 'Announcements & News',
        accent: '#fbbf24',
        accentBg: 'rgba(245,158,11,0.16)',
        accentBorder: 'rgba(245,158,11,0.48)',
        badge: '',
      }
    );
  }
  if (isCC) {
    tabs.push({
      key: 'stream',
      icon: '📺',
      label: 'Live Stream & OBS',
      accent: '#c084fc',
      accentBg: 'rgba(168,85,247,0.18)',
      accentBorder: 'rgba(168,85,247,0.5)',
      badge: 'LIVE',
      badgeBg: '#ef4444',
      badgeColor: '#fff',
    });
  }
  return tabs;
}

function switchMyStationSubtab(subtabKey) {
  _currentMyStationSubtab = subtabKey || 'match';
  if (['clock', 'announcements', 'roster'].includes(_currentMyStationSubtab)) {
    _currentToHubSubtab = _currentMyStationSubtab;
  } else if (_currentMyStationSubtab === 'stream') {
    creatorHubActiveMode = 'stream';
  }
  if (currentEventData) {
    renderPlayerStation(currentEventData, currentEventRegistration);
  }
}
window.switchMyStationSubtab = switchMyStationSubtab;

async function renderPlayerStation(ev, userRegData) {
  const subtabPlayer = document.getElementById('event-subtab-player');
  const subtabLabel = document.getElementById('event-subtab-player-label');
  const subtabBadge = document.getElementById('event-tab-player-badge');
  const myStationBar = document.getElementById('my-station-subtabs-bar');
  const playerPanel = document.getElementById('my-station-panel-player');
  const toHubContainer = document.getElementById('event-to-hub-container');
  const creatorHubContainer = document.getElementById('event-creator-hub-container');
  const activeHero = document.getElementById('player-station-active-match-hero');
  const waitingHero = document.getElementById('player-station-waiting-hero');
  const concludedHero = document.getElementById('player-station-concluded-hero');
  const rosterAccordion = document.getElementById('player-station-roster-accordion');
  const accordionHint = document.getElementById('player-station-roster-accordion-hint');

  const eventObj = ev || currentEventData || {};
  let regData = userRegData || currentEventRegistration;

  // Fallback check for competitor persona
  if (!regData || !regData.is_registered) {
    if (typeof currentDevPersona !== 'undefined' && currentDevPersona === 'competitor') {
      regData = {
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
      currentEventRegistration = regData;
    }
  }

  const availableTabs = getMyStationAvailableSubtabs(eventObj, regData);
  const isPlayer = Boolean(regData && regData.is_registered);
  const isTO = Boolean(typeof canUserAccessEventToHub === 'function' && canUserAccessEventToHub(eventObj));
  const isCC = Boolean(
    typeof isUserCC === 'function'
      ? isUserCC(currentUser)
      : (currentUser && (currentUser.role === 'admin' || currentUser.role === 'cc' || currentUser.role === 'creator' || currentUser.can_access_cc || currentUser.is_cc || currentUser.is_admin))
  );

  // If user has no roles at all (pure spectator), hide ⚡ My Station
  if (availableTabs.length === 0) {
    if (subtabPlayer) subtabPlayer.style.setProperty('display', 'none', 'important');
    if (myStationBar) myStationBar.style.display = 'none';
    if (playerPanel) playerPanel.style.display = 'none';
    if (toHubContainer) toHubContainer.style.display = 'none';
    if (creatorHubContainer) creatorHubContainer.style.display = 'none';
    if (activeHero) activeHero.style.display = 'none';
    if (waitingHero) waitingHero.style.display = 'none';
    if (concludedHero) concludedHero.style.display = 'none';
    return;
  }

  // Show ⚡ My Station tab button
  if (subtabPlayer) {
    subtabPlayer.style.setProperty('display', 'inline-flex', 'important');
  }
  if (subtabLabel) {
    subtabLabel.innerText = '⚡ My Station';
  }

  // Ensure active sub-tab is valid for current user's roles
  if (!availableTabs.some(t => t.key === _currentMyStationSubtab)) {
    _currentMyStationSubtab = availableTabs[0].key;
  }

  // Render sub-pills bar inside ⚡ My Station (only shown when user has > 1 module)
  if (myStationBar) {
    if (availableTabs.length <= 1) {
      myStationBar.style.display = 'none';
      myStationBar.innerHTML = '';
    } else {
      myStationBar.style.display = 'flex';
      myStationBar.innerHTML = availableTabs.map(t => {
        const isAct = _currentMyStationSubtab === t.key;
        return `
          <button type="button" class="my-station-subtab-pill my-station-subtab-btn ${isAct ? 'active' : ''}" onclick="switchMyStationSubtab('${t.key}')" style="padding:0.48rem 0.85rem; border-radius:8px; border:1px solid ${isAct ? t.accentBorder : 'rgba(255,255,255,0.08)'}; background:${isAct ? t.accentBg : 'rgba(15,23,42,0.65)'}; color:${isAct ? t.accent : 'var(--text-secondary)'}; font-weight:700; font-size:0.78rem; cursor:pointer; display:inline-flex; align-items:center; gap:0.4rem; white-space:nowrap; transition:all 0.15s ease;">
            <span>${t.icon} ${escapeHtml(t.label)}</span>
            ${t.badge ? `<span class="badge" style="background:${t.badgeBg || 'rgba(255,255,255,0.15)'}; color:${t.badgeColor || '#fff'}; font-size:0.64rem; font-weight:800; padding:1px 6px; border:none;">${escapeHtml(t.badge)}</span>` : ''}
          </button>
        `;
      }).join('');
    }
  }

  // Toggle active sub-module panel inside ⚡ My Station
  if (playerPanel) playerPanel.style.display = _currentMyStationSubtab === 'match' ? 'block' : 'none';
  if (toHubContainer) toHubContainer.style.display = ['clock', 'announcements', 'roster'].includes(_currentMyStationSubtab) ? 'block' : 'none';
  if (creatorHubContainer) creatorHubContainer.style.display = _currentMyStationSubtab === 'stream' ? 'block' : 'none';

  if (['clock', 'announcements', 'roster'].includes(_currentMyStationSubtab) && typeof renderEventToHub === 'function') {
    _currentToHubSubtab = _currentMyStationSubtab;
    renderEventToHub(eventObj, true);
  } else if (_currentMyStationSubtab === 'stream' && typeof renderEventCreatorHub === 'function') {
    creatorHubActiveMode = 'stream';
    renderEventCreatorHub(eventObj);
  }

  // Update top-level badge for non-player TO/CC
  if (!isPlayer) {
    if (subtabBadge) {
      if (isTO && isCC) {
        subtabBadge.style.display = 'inline-block';
        subtabBadge.innerText = 'TO • STUDIO';
        subtabBadge.style.background = 'rgba(245,158,11,0.22)';
        subtabBadge.style.color = '#fbbf24';
      } else if (isTO) {
        subtabBadge.style.display = 'inline-block';
        subtabBadge.innerText = 'TO';
        subtabBadge.style.background = 'rgba(245,158,11,0.22)';
        subtabBadge.style.color = '#fbbf24';
      } else if (isCC) {
        subtabBadge.style.display = 'inline-block';
        subtabBadge.innerText = 'STUDIO';
        subtabBadge.style.background = 'rgba(168,85,247,0.22)';
        subtabBadge.style.color = '#c084fc';
      } else {
        subtabBadge.style.display = 'none';
      }
    }
    return;
  }

  const ended = isEventEnded(eventObj, regData);

  const eventId = (eventObj && eventObj.id) || currentOpenEventId || (currentEventData && currentEventData.id) || '';
  const preg = regData.player_registration || regData.player || {};
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

  // 1. Update Subtab Badge based on Lifecycle (keep label as ⚡ My Station)
  if (ended) {
    if (subtabBadge) {
      subtabBadge.style.display = 'inline-block';
      subtabBadge.innerText = 'FINAL';
      subtabBadge.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
      subtabBadge.style.color = '#000';
    }
  } else if (activeMatch || (eventMatchesCache && eventMatchesCache.length > 0)) {
    if (subtabBadge) {
      subtabBadge.style.display = 'inline-block';
      subtabBadge.innerText = activeMatch ? 'ACTIVE' : 'WAITING';
      subtabBadge.style.background = activeMatch ? '#10b981' : '#f59e0b';
      subtabBadge.style.color = '#000';
    }
  } else {
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
      const matchId = activeMatch.tracker_match_id || `BCP-${eventId}-R${roundNum}-T${tableNum}`;

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

  // 2.5. Render Round Clock & Schedule in Player Station
  if (typeof renderEventClockAndScheduleWidgets === 'function') {
    renderEventClockAndScheduleWidgets(eventObj);
  }

  // 3. Render Personal Scorecard History
  renderPersonalEventScorecard(eventObj, regData);

  // 4. Fill Roster Form
  await populateEventPlayerDetails(regData);
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

  const totalField = Math.max(1, players.length);
  const facSort = (typeof currentSort !== 'undefined' && currentSort['event-factions']) || { field: 'count', asc: false };
  const facField = facSort.field || 'count';
  const facAsc = Boolean(facSort.asc);

  const facList = Array.from(facMap.values()).map(f => {
    const totalGames = f.wins + f.losses + f.draws;
    const winRate = totalGames > 0 ? (f.wins / totalGames) * 100 : 0;
    const avgNet = f.count > 0 ? (f.netElo / f.count) : 0;
    return Object.assign({}, f, {
      total_games: totalGames,
      win_rate: winRate,
      avg_net_elo: avgNet,
      best_rank: f.bestRank
    });
  }).sort((a, b) => {
    let cmp = 0;
    if (facField === 'faction') {
      cmp = String(a.faction || '').localeCompare(String(b.faction || ''));
    } else if (facField === 'wins') {
      cmp = (a.wins - b.wins) || (a.win_rate - b.win_rate) || (b.losses - a.losses);
    } else if (facField === 'win_rate') {
      cmp = (a.win_rate - b.win_rate) || (a.wins - b.wins) || (a.count - b.count);
    } else if (facField === 'avg_net_elo') {
      cmp = (a.avg_net_elo - b.avg_net_elo) || (a.win_rate - b.win_rate);
    } else if (facField === 'best_rank') {
      cmp = (a.best_rank - b.best_rank) || (b.wins - a.wins) || (b.count - a.count);
    } else {
      cmp = (a.count - b.count) || (a.wins - b.wins) || (a.win_rate - b.win_rate);
    }
    return facAsc ? cmp : -cmp;
  });

  const facThClass = (col) => `sortable${facField === col ? (facAsc ? ' sorted-asc' : ' sorted-desc') : ''}`;

  const facRowsHtml = facList.map(f => {
    const sharePct = ((f.count / totalField) * 100).toFixed(1);
    const wrPct = f.win_rate.toFixed(1);
    const avgNet = f.avg_net_elo;
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

  const deepMetaHtml = (typeof renderDeepMetaMode === 'function')
    ? renderDeepMetaMode(ev || currentEventData, players, matches)
    : '';

  container.innerHTML = `
    <!-- 1. 3 Tournament Spotlight Cards -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:1rem; margin-bottom:1.25rem;">
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

    <!-- 2. Deep Meta: Spiciness Index + Interactive Detachment & Force Disposition Power Grid -->
    <div style="display:flex; flex-direction:column; gap:1.25rem;">
      ${deepMetaHtml}
    </div>
  `;
}
window.renderEventMetaHighlights = renderEventMetaAndHighlights;

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

function openEventPlayerListModal(playerIdentifier, directPlayerObj = null, thirdArgListId = '') {
  const hasThirdArg = arguments.length >= 3;
  const fallbackListId = hasThirdArg
    ? (typeof thirdArgListId === 'string' ? thirdArgListId.trim() : '')
    : (typeof directPlayerObj === 'string' ? directPlayerObj.trim() : '');
  const lookupName = hasThirdArg && typeof directPlayerObj === 'string' && directPlayerObj.trim()
    ? directPlayerObj.trim()
    : playerIdentifier;
  let p = (directPlayerObj && typeof directPlayerObj === 'object')
    ? directPlayerObj
    : (playerIdentifier && typeof playerIdentifier === 'object' ? playerIdentifier : null);
  if (!p) {
    const resolved = resolveEventCompetitorRecord(playerIdentifier || lookupName, lookupName || playerIdentifier, fallbackListId);
    p = resolved ? resolved.record : null;
  } else if (fallbackListId && !p.list_id && !p.listId) {
    p = Object.assign({}, p, { list_id: fallbackListId });
  }

  currentArmyListModalPlayer = p || { full_name: String(lookupName || playerIdentifier || ''), player_id: String(playerIdentifier || ''), list_id: fallbackListId };
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

async function openJourneyPlayerRosterModal(eventId, playerId, playerName, faction = '', eventName = '') {
  const cleanEvId = String(eventId || '').trim();
  const cleanPid = String(playerId || '').trim();
  const cleanName = String(playerName || '').trim();
  const cleanFac = String(faction || '').trim();
  const cleanEvName = String(eventName || '').trim();

  const findPlayerInEventObj = (evObj) => {
    if (!evObj || typeof evObj !== 'object') return null;
    const pool = []
      .concat(Array.isArray(evObj.players) ? evObj.players : [])
      .concat(Array.isArray(evObj.roster) ? evObj.roster : []);
    const pidLow = cleanPid.toLowerCase();
    const nmLow = cleanName.toLowerCase();
    let matched = null;
    const mergeCandidate = (base, cand) => {
      if (!base) return Object.assign({}, cand);
      const out = Object.assign({}, base);
      ['army_list', 'list_text', 'list', 'raw_list', 'list_id', 'listId', 'list_url', 'army_list_url', 'detachment', 'faction'].forEach(k => {
        if ((!out[k] || out[k] === '-') && cand[k] && cand[k] !== '-') {
          out[k] = cand[k];
        }
      });
      if (cand.has_list) out.has_list = true;
      return out;
    };
    for (const p of pool) {
      if (!p || typeof p !== 'object') continue;
      const candIds = [p.player_id, p.id, p.user_id, p.bcp_user_id, p.bcp_event_player_id]
        .filter(Boolean)
        .map(x => String(x).trim().toLowerCase());
      const candName = String(p.full_name || p.name || p.player_name || '').trim().toLowerCase();
      if ((pidLow && candIds.includes(pidLow)) || (nmLow && candName === nmLow)) {
        matched = mergeCandidate(matched, p);
      }
    }
    if (!matched && nmLow && nmLow.includes(' ')) {
      const partsA = nmLow.split(/\s+/);
      for (const p of pool) {
        if (!p || typeof p !== 'object') continue;
        const candName = String(p.full_name || p.name || p.player_name || '').trim().toLowerCase();
        const partsB = candName.split(/\s+/);
        if (partsA.length >= 2 && partsB.length >= 2 && partsA[0] === partsB[0] && partsA[partsA.length - 1] === partsB[partsB.length - 1]) {
          matched = mergeCandidate(matched, p);
        }
      }
    }
    // Check matches for list_id if not on player object
    if (Array.isArray(evObj.matches)) {
      for (const m of evObj.matches) {
        if (!m || typeof m !== 'object') continue;
        const m1Id = String(m.player1_id || '').trim().toLowerCase();
        const m1Nm = String(m.player1_name || '').trim().toLowerCase();
        const m2Id = String(m.player2_id || '').trim().toLowerCase();
        const m2Nm = String(m.player2_name || '').trim().toLowerCase();
        if ((pidLow && m1Id === pidLow) || (nmLow && m1Nm === nmLow)) {
          if (m.player1_list_id) {
            matched = Object.assign({}, matched || { full_name: cleanName || m.player1_name, player_id: cleanPid || m.player1_id, faction: cleanFac || m.player1_faction }, {
              list_id: (matched && (matched.list_id || matched.listId)) || m.player1_list_id
            });
            break;
          }
        }
        if ((pidLow && m2Id === pidLow) || (nmLow && m2Nm === nmLow)) {
          if (m.player2_list_id) {
            matched = Object.assign({}, matched || { full_name: cleanName || m.player2_name, player_id: cleanPid || m.player2_id, faction: cleanFac || m.player2_faction }, {
              list_id: (matched && (matched.list_id || matched.listId)) || m.player2_list_id
            });
            break;
          }
        }
      }
    }
    return matched;
  };

  // 1. Check if currentEventData already matches this eventId
  if (typeof currentEventData === 'object' && currentEventData && cleanEvId && String(currentEventData.id || currentEventData.event_id || '').toLowerCase() === cleanEvId.toLowerCase()) {
    const directRec = findPlayerInEventObj(currentEventData);
    if (directRec) {
      if (!directRec.faction && cleanFac) directRec.faction = cleanFac;
      if (!directRec.full_name && cleanName) directRec.full_name = cleanName;
      openEventPlayerListModal(cleanPid || cleanName, directRec);
      return;
    }
  }

  // 2. Open modal immediately with loading indicator while fetching tournament details
  const modal = document.getElementById('event-army-list-modal');
  if (modal) {
    const titleEl = document.getElementById('event-army-list-modal-title');
    const subEl = document.getElementById('event-army-list-modal-subtitle');
    const toggleWrap = document.getElementById('event-army-list-mode-toggle');
    const contentEl = document.getElementById('event-army-list-modal-content');
    const btnCopy = document.getElementById('btn-army-list-copy');
    const btnBcpLink = document.getElementById('btn-army-list-bcp-link');
    if (titleEl) titleEl.innerText = `${cleanName || cleanPid || 'Competitor'} — Army Roster`;
    if (subEl) subEl.innerText = `${cleanFac || 'Faction'}${cleanEvName ? ` • ${cleanEvName}` : ''}`;
    if (toggleWrap) toggleWrap.style.display = 'none';
    if (btnCopy) btnCopy.style.display = 'none';
    if (btnBcpLink) btnBcpLink.style.display = 'none';
    if (contentEl) {
      contentEl.innerHTML = `
        <div style="text-align:center; padding:3.5rem 1.5rem; margin:auto;">
          <div class="spinner-mini" style="display:inline-block; width:38px; height:38px; border:3px solid rgba(56,189,248,0.2); border-top-color:#38bdf8; border-radius:50%; animation:spin 0.8s linear infinite; margin-bottom:1rem;"></div>
          <div style="font-size:1.05rem; font-weight:700; color:#38bdf8; margin-bottom:0.35rem;">Loading Tournament Roster...</div>
          <div style="font-size:0.84rem; color:var(--text-muted);">${escapeHtml(cleanEvName || 'Fetching competitor army list details')}</div>
        </div>
      `;
    }
    modal.style.display = 'flex';
    if (typeof bringModalToFront === 'function') {
      bringModalToFront(modal);
    } else {
      modal.classList.add('active');
    }
  }

  let resolvedPlayer = null;
  if (cleanEvId && !cleanEvId.startsWith('ev_idx_') && window.api && typeof window.api.getTournamentDetails === 'function') {
    try {
      const evData = await window.api.getTournamentDetails(cleanEvId);
      if (evData && !evData.error) {
        resolvedPlayer = findPlayerInEventObj(evData);
      }
    } catch (e) {
      // Fallback below
    }
  }

  const finalPlayer = Object.assign(
    {
      player_id: cleanPid || cleanName,
      full_name: cleanName || cleanPid || 'Competitor',
      faction: cleanFac || '-'
    },
    resolvedPlayer || {}
  );
  if (!finalPlayer.faction || finalPlayer.faction === '-') {
    finalPlayer.faction = cleanFac || '-';
  }
  if (!finalPlayer.full_name) {
    finalPlayer.full_name = cleanName || cleanPid || 'Competitor';
  }
  openEventPlayerListModal(cleanPid || cleanName, finalPlayer);
}
window.openJourneyPlayerRosterModal = openJourneyPlayerRosterModal;

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
let streamHudOverlayEnabled = true;
let streamLiveTrackerScoreCache = {};
let streamScorecardDataCache = {};
let _syncStreamBackendTimer = null;

function normalizeStreamRecord(s) {
  if (!s) return s;
  const rawTable = (s.table_number !== undefined && s.table_number !== null)
    ? s.table_number
    : ((s.tableNumber !== undefined && s.tableNumber !== null) ? s.tableNumber : 1);
  const tNum = Number(rawTable);
  const rawRound = (s.round_number !== undefined && s.round_number !== null)
    ? s.round_number
    : ((s.roundNumber !== undefined && s.roundNumber !== null) ? s.roundNumber : null);
  const rNum = rawRound !== null && !isNaN(Number(rawRound)) && Number(rawRound) > 0 ? Number(rawRound) : null;
  const defaultTitle = tNum === 0
    ? `${s.channel || 'Live'} - Main Desk Coverage`
    : `${s.channel || 'Live'} - Table ${tNum} Coverage`;
  return {
    ...s,
    id: s.id || `stream-${Date.now()}`,
    tableNumber: tNum,
    table_number: tNum,
    roundNumber: rNum,
    round_number: rNum,
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
        const primary = eventLiveStreams[creatorActiveStreamIndex] || eventLiveStreams[0];
        if (primary) {
          if (primary.tableNumber !== undefined && primary.tableNumber !== null) {
            selectedCasterTable = Number(primary.tableNumber);
            currentModalStreamTable = selectedCasterTable;
          }
          if (primary.roundNumber && !selectedCasterRound) {
            selectedCasterRound = Number(primary.roundNumber);
          }
        }
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

function syncActiveStreamToCasterDesk(tableNum, roundNum, persistBackend = true) {
  if (tableNum !== undefined && tableNum !== null && !isNaN(Number(tableNum))) {
    selectedCasterTable = Number(tableNum);
    currentModalStreamTable = selectedCasterTable;
  }
  if (roundNum !== undefined && roundNum !== null && !isNaN(Number(roundNum)) && Number(roundNum) > 0) {
    selectedCasterRound = Number(roundNum);
  }

  if (Array.isArray(eventLiveStreams) && eventLiveStreams.length > 0) {
    const idx = (creatorActiveStreamIndex >= 0 && creatorActiveStreamIndex < eventLiveStreams.length) ? creatorActiveStreamIndex : 0;
    const activeStream = eventLiveStreams[idx];
    if (activeStream) {
      activeStream.tableNumber = selectedCasterTable;
      activeStream.table_number = selectedCasterTable;
      if (selectedCasterRound) {
        activeStream.roundNumber = selectedCasterRound;
        activeStream.round_number = selectedCasterRound;
      }
      const ch = activeStream.channel || 'Live';
      if (!activeStream.title || /Table\s+\d+\s+Coverage|Main\s+Desk/i.test(activeStream.title)) {
        activeStream.title = selectedCasterTable === 0
          ? `${ch} - Main Desk Coverage`
          : `${ch} - Table ${selectedCasterTable} Coverage`;
      }

      if (persistBackend && window.api && typeof window.api.saveEventLivestream === 'function') {
        const evId = currentOpenEventId || currentEventData?.id || '';
        if (evId && activeStream.streamUrl) {
          if (_syncStreamBackendTimer) clearTimeout(_syncStreamBackendTimer);
          _syncStreamBackendTimer = setTimeout(() => {
            window.api.saveEventLivestream(evId, {
              id: activeStream.id,
              channel: activeStream.channel,
              stream_url: activeStream.streamUrl,
              table_number: activeStream.tableNumber,
              round_number: activeStream.roundNumber || selectedCasterRound || null,
              platform: activeStream.platform || 'youtube',
              title: activeStream.title,
              is_live: activeStream.isLive !== false
            }).catch(err => console.debug('Stream table sync notice:', err));
          }, 250);
        }
      }
    }
  }

  // Keep Pairings tab live coverage banner and table badges in sync
  if (typeof renderEventPairingsRows === 'function' && document.getElementById('event-matches-tbody')) {
    renderEventPairingsRows();
  }
}
window.syncActiveStreamToCasterDesk = syncActiveStreamToCasterDesk;

let currentModalStreamTable = 1;

function buildInAppStreamHudHtml(overlayData) {
  if (!overlayData) return '';
  const { tableNum, tableBadge, roundNum, p1Name, p2Name, p1Fac, p2Fac, p1Elo, p2Elo, scoreStr, isLiveProgress } = overlayData;
  const p1Prob = Math.min(95, Math.max(5, Math.round(100 / (1 + Math.pow(10, ((p2Elo || 1500) - (p1Elo || 1500)) / 400)))));
  const p2Prob = 100 - p1Prob;

  return `
    <div class="stream-hud-scoreboard-card" style="display: flex; align-items: stretch; justify-content: space-between; background: linear-gradient(90deg, rgba(15, 23, 42, 0.96) 0%, rgba(30, 41, 59, 0.96) 50%, rgba(15, 23, 42, 0.96) 100%); border: 1px solid rgba(56, 189, 248, 0.45); border-radius: 8px; overflow: hidden; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.75); backdrop-filter: blur(8px);">
      <!-- Player 1 Wing (Cyan) -->
      <div class="stream-hud-wing stream-hud-wing-p1" style="flex: 1; min-width: 0; padding: 0.45rem 0.75rem; border-left: 4px solid #38bdf8; display: flex; flex-direction: column; justify-content: center;">
        <div style="display: flex; align-items: center; gap: 0.4rem; min-width: 0;">
          <span class="stream-hud-player-name" style="font-weight: 800; color: #fff; font-size: 0.86rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(p1Name)}</span>
          <span class="stream-hud-elo-pill" style="font-size: 0.66rem; font-weight: 800; padding: 1px 5px; border-radius: 4px; background: rgba(56, 189, 248, 0.18); color: #38bdf8; font-family: var(--font-mono); flex-shrink: 0;">${Number(p1Elo || 1500).toFixed(0)} (${p1Prob}%)</span>
        </div>
        <div class="stream-hud-faction-name" style="font-size: 0.7rem; color: #7dd3fc; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          🛡️ ${escapeHtml(p1Fac)}
        </div>
      </div>

      <!-- Center Scoreboard Box -->
      <div class="stream-hud-center-box" style="display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(2, 6, 23, 0.92); border-left: 1px solid rgba(255,255,255,0.1); border-right: 1px solid rgba(255,255,255,0.1); padding: 0.35rem 0.85rem; min-width: 135px; flex-shrink: 0;">
        <div class="stream-hud-table-tag" style="font-size: 0.62rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #f59e0b; display: flex; align-items: center; gap: 4px;">
          <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 6px #ef4444;"></span>
          <span>${escapeHtml(tableBadge)} • R${roundNum}</span>
        </div>
        <div class="stream-hud-score-val" style="font-family: var(--font-mono); font-weight: 900; font-size: 1.15rem; color: #fff; line-height: 1.15; margin-top: 1px;">
          ${escapeHtml(scoreStr)}
        </div>
      </div>

      <!-- Player 2 Wing (Rose) -->
      <div class="stream-hud-wing stream-hud-wing-p2" style="flex: 1; min-width: 0; padding: 0.45rem 0.75rem; border-right: 4px solid #f43f5e; display: flex; flex-direction: column; justify-content: center; text-align: right;">
        <div style="display: flex; align-items: center; justify-content: flex-end; gap: 0.4rem; min-width: 0;">
          <span class="stream-hud-elo-pill" style="font-size: 0.66rem; font-weight: 800; padding: 1px 5px; border-radius: 4px; background: rgba(244, 63, 94, 0.18); color: #fda4af; font-family: var(--font-mono); flex-shrink: 0;">(${p2Prob}%) ${Number(p2Elo || 1500).toFixed(0)}</span>
          <span class="stream-hud-player-name" style="font-weight: 800; color: #fff; font-size: 0.86rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(p2Name)}</span>
        </div>
        <div class="stream-hud-faction-name" style="font-size: 0.7rem; color: #fda4af; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${escapeHtml(p2Fac)} 🛡️
        </div>
      </div>
    </div>
  `;
}
window.buildInAppStreamHudHtml = buildInAppStreamHudHtml;

function toggleStreamHudOverlay() {
  streamHudOverlayEnabled = !streamHudOverlayEnabled;
  const modalHud = document.getElementById('modal-stream-hud-overlay');
  const monitorHud = document.getElementById('live-monitor-hud-overlay');
  const modalBtn = document.getElementById('modal-stream-hud-toggle-btn');
  const monitorBtn = document.getElementById('monitor-stream-hud-toggle-btn');
  const modalFsHudBtn = document.getElementById('modal-stream-fs-hud-btn');
  const monitorFsHudBtn = document.getElementById('monitor-stream-fs-hud-btn');

  if (modalHud) modalHud.style.display = streamHudOverlayEnabled ? 'block' : 'none';
  if (monitorHud) monitorHud.style.display = streamHudOverlayEnabled ? 'block' : 'none';

  const applyBtnState = (btn) => {
    if (!btn) return;
    btn.innerHTML = streamHudOverlayEnabled ? '📺 Score HUD: ON' : '📺 Score HUD: OFF';
    btn.style.background = streamHudOverlayEnabled ? 'rgba(56, 189, 248, 0.14)' : 'rgba(255, 255, 255, 0.05)';
    btn.style.color = streamHudOverlayEnabled ? '#38bdf8' : 'var(--text-muted)';
    btn.style.borderColor = streamHudOverlayEnabled ? 'rgba(56, 189, 248, 0.45)' : 'rgba(255, 255, 255, 0.15)';
    btn.classList.toggle('active', streamHudOverlayEnabled);
  };
  applyBtnState(modalBtn);
  applyBtnState(monitorBtn);
  applyBtnState(modalFsHudBtn);
  applyBtnState(monitorFsHudBtn);
}
window.toggleStreamHudOverlay = toggleStreamHudOverlay;

function getStreamStageFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
}

function syncStreamFullscreenUiState() {
  const fsEl = getStreamStageFullscreenElement();

  // If the browser ever fullscreened the child <iframe> directly instead of the stage wrapper,
  // upgrade fullscreen to the parent .stream-stage-fullscreen-wrap so the Live Score HUD stays visible!
  if (fsEl && fsEl.tagName === 'IFRAME' && fsEl.parentElement && fsEl.parentElement.classList.contains('stream-stage-fullscreen-wrap')) {
    const parentStage = fsEl.parentElement;
    const reqFn = parentStage.requestFullscreen || parentStage.webkitRequestFullscreen || parentStage.msRequestFullscreen;
    if (reqFn) {
      Promise.resolve(reqFn.call(parentStage)).catch(() => {});
      return;
    }
  }

  const modalStage = document.getElementById('modal-stream-stage-wrap');
  const monitorStage = document.getElementById('live-monitor-stage-wrap');
  const isModalFs = Boolean(modalStage && (fsEl === modalStage || modalStage.classList.contains('is-pseudo-fullscreen')));
  const isMonitorFs = Boolean(monitorStage && (fsEl === monitorStage || monitorStage.classList.contains('is-pseudo-fullscreen')));

  if (modalStage) modalStage.classList.toggle('is-fullscreen', isModalFs);
  if (monitorStage) monitorStage.classList.toggle('is-fullscreen', isMonitorFs);

  const updateFsButton = (btn, isFs) => {
    if (!btn) return;
    btn.innerHTML = isFs ? '🗗 Exit Fullscreen' : '⛶ Fullscreen';
    btn.classList.toggle('active', isFs);
  };

  updateFsButton(document.getElementById('modal-stream-fullscreen-btn'), isModalFs);
  updateFsButton(document.getElementById('modal-stream-stage-fs-btn'), isModalFs);
  updateFsButton(document.getElementById('monitor-stream-fullscreen-btn'), isMonitorFs);
  updateFsButton(document.getElementById('monitor-stream-stage-fs-btn'), isMonitorFs);
}
window.syncStreamFullscreenUiState = syncStreamFullscreenUiState;

function toggleStreamStageFullscreen(target = 'modal') {
  const stageId = target === 'monitor' ? 'live-monitor-stage-wrap' : 'modal-stream-stage-wrap';
  const stageEl = document.getElementById(stageId);
  if (!stageEl) return;

  const fsEl = getStreamStageFullscreenElement();
  const isCurrentlyFs = fsEl === stageEl || (fsEl && stageEl.contains(fsEl)) || stageEl.classList.contains('is-pseudo-fullscreen');

  if (isCurrentlyFs) {
    stageEl.classList.remove('is-pseudo-fullscreen');
    const exitFn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (fsEl && exitFn) {
      Promise.resolve(exitFn.call(document)).finally(syncStreamFullscreenUiState).catch(() => syncStreamFullscreenUiState());
    } else {
      syncStreamFullscreenUiState();
    }
    return;
  }

  // Request Fullscreen on the parent stage container (wrapping BOTH the <iframe> and the Score HUD overlay!)
  const reqFn = stageEl.requestFullscreen || stageEl.webkitRequestFullscreen || stageEl.msRequestFullscreen;
  if (reqFn) {
    Promise.resolve(reqFn.call(stageEl))
      .then(() => {
        syncStreamFullscreenUiState();
      })
      .catch(() => {
        // Fallback for headless/restricted environments where native Fullscreen API is blocked
        stageEl.classList.toggle('is-pseudo-fullscreen');
        syncStreamFullscreenUiState();
      });
  } else {
    stageEl.classList.toggle('is-pseudo-fullscreen');
    syncStreamFullscreenUiState();
  }
}
window.toggleStreamStageFullscreen = toggleStreamStageFullscreen;

if (!window._streamFullscreenListenersBound) {
  window._streamFullscreenListenersBound = true;
  document.addEventListener('fullscreenchange', syncStreamFullscreenUiState);
  document.addEventListener('webkitfullscreenchange', syncStreamFullscreenUiState);
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
    const modal = document.getElementById('event-stream-modal');
    const isModalOpen = modal && (modal.classList.contains('active') || modal.style.display === 'flex');
    if (e.key === 'Escape') {
      const modalStage = document.getElementById('modal-stream-stage-wrap');
      const monitorStage = document.getElementById('live-monitor-stage-wrap');
      if (modalStage?.classList.contains('is-pseudo-fullscreen') || monitorStage?.classList.contains('is-pseudo-fullscreen')) {
        modalStage?.classList.remove('is-pseudo-fullscreen');
        monitorStage?.classList.remove('is-pseudo-fullscreen');
        syncStreamFullscreenUiState();
      }
    } else if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey && isModalOpen) {
      e.preventDefault();
      toggleStreamStageFullscreen('modal');
    }
  });
}

function buildInlineStreamScorecardHtml(eventId, matchId, match, p1, p2, overlayData, scData) {
  const tableNum = overlayData?.tableNum || Number(match?.table_number || match?.table || 1);
  const curRound = overlayData?.roundNum || Number(match?.round || 1);
  const p1Name = overlayData?.p1Name || match?.player1_name || 'Player 1';
  const p2Name = overlayData?.p2Name || match?.player2_name || 'Player 2';
  const p1Fac = overlayData?.p1Fac || match?.player1_faction || p1?.faction || 'Army';
  const p2Fac = overlayData?.p2Fac || match?.player2_faction || p2?.faction || 'Army';
  const p1Det = p1?.detachment || match?.player1_detachment || 'Standard Detachment';
  const p2Det = p2?.detachment || match?.player2_detachment || 'Standard Detachment';
  const p1Elo = Number(overlayData?.p1Elo || match?.player1_elo || p1?.current_elo || 1500);
  const p2Elo = Number(overlayData?.p2Elo || match?.player2_elo || p2?.current_elo || 1500);

  const eventEnded = (typeof isEventEnded === 'function' && currentEventData) ? Boolean(isEventEnded(currentEventData)) : false;
  const sc = scData && (scData.scorecard || scData);
  const rec = sc?.game_record || {};
  const st = sc?.state || rec?.state_json || {};
  const game = st?.game || {};

  const isTrackerScorecard = Boolean(
    sc && !sc.is_mock && (
      (sc.source === 'tracker_games' && sc.is_finished !== false) ||
      (!eventEnded && sc.source === 'firestore' && (sc.state || sc.game_record)) ||
      (Array.isArray(sc.p1_primary) && sc.p1_primary.length > 0)
    )
  );

  const isAosStream = Boolean(
    sc?.game_system === 'aos' ||
    st?.gameSystem === 'aos' ||
    String(matchId || '').startsWith('AOS-') ||
    (window.currentGameSystem === 'aos' && !isTrackerScorecard)
  );

  const missionObj = st?.mission || {};
  const rawEd = String(
    st?.edition || rec?.edition || missionObj.edition || st?.p1?.edition || st?.p2?.edition || game?.edition || ''
  ).toLowerCase().trim();
  const packId = String(missionObj.packId || '').toLowerCase();

  let priCap = isAosStream ? 30 : 50;
  let secCap = isAosStream ? 20 : 40;
  let maxTot = isAosStream ? 50 : 100;
  let hasPaint = !isAosStream;
  let hasGrandStrategy = false;
  let edShortBadge = isAosStream ? '⚡ AoS 4e' : '🦅 10th Ed';

  if (isAosStream) {
    if (rawEd === 'aos_3e' || rawEd === '3e' || packId.includes('3e') || packId.includes('pitched') || st?.p1?.grandStrategy || st?.p2?.grandStrategy) {
      maxTot = 53;
      hasGrandStrategy = true;
      edShortBadge = '⚔️ AoS 3e';
    }
  } else if (rawEd === '8th_itc' || rawEd === '8th' || packId.includes('8th') || packId.includes('itc') || Number(st?.p1?.primaryCap) === 36) {
    priCap = 36;
    secCap = 12;
    maxTot = 48;
    hasPaint = false;
    edShortBadge = '🏛️ 8th ITC';
  } else if (rawEd === '11th' || rawEd === '11e' || packId.includes('11th')) {
    priCap = 45;
    secCap = 45;
    maxTot = 100;
    hasPaint = true;
    edShortBadge = '🚀 11th Ed';
  } else if (rawEd === '9th' || rawEd === '9e' || packId.includes('9th') || packId.includes('nephilim') || packId.includes('arks') || Number(st?.p1?.primaryCap) === 45 || Number(st?.p1?.secondaryCap) === 45) {
    priCap = 45;
    secCap = 45;
    maxTot = 100;
    hasPaint = true;
    edShortBadge = '📜 9th Ed';
  }

  const p1Rounds = Array.isArray(st?.p1?.rounds) ? st.p1.rounds : [];
  const p2Rounds = Array.isArray(st?.p2?.rounds) ? st.p2.rounds : [];
  const p1Hand = Array.isArray(st?.p1?.hand) ? st.p1.hand : [];
  const p2Hand = Array.isArray(st?.p2?.hand) ? st.p2.hand : [];

  const extractRoundValues = (roundsArr, field, fallbackArr, handArr = []) => {
    if (Array.isArray(fallbackArr) && fallbackArr.length > 0 && fallbackArr.some(v => Number(v || 0) > 0)) {
      return fallbackArr;
    }
    return [1, 2, 3, 4, 5].map(rNum => {
      const rObj = roundsArr.find(x => (x.round === rNum || x.battleRound === rNum)) || roundsArr[rNum - 1] || {};
      if (field === 'secondaryScore') {
        if (isAosStream) {
          return Number(rObj.tacticScore || 0);
        }
        const directSec = Number(rObj.secondaryScore || 0);
        const cardsSec = Array.isArray(rObj.secondaries)
          ? rObj.secondaries.reduce((acc, s) => acc + Number(s?.points ?? s?.vp ?? s?.score ?? 0), 0)
          : 0;
        let handSec = 0;
        if (Array.isArray(handArr)) {
          handArr.forEach(c => {
            if (!c || typeof c !== 'object') return;
            if (c.recurring && c.roundScores && typeof c.roundScores === 'object') {
              handSec += Number(c.roundScores[rNum] ?? c.roundScores[String(rNum)] ?? 0);
            } else if (Number(c.scoredRound || 0) === rNum) {
              handSec += Number(c.points ?? c.vp ?? c.score ?? 0);
            }
          });
        }
        return Math.max(directSec, cardsSec, handSec);
      }
      return Number(rObj[field] || 0);
    });
  };

  const p1Prim = extractRoundValues(p1Rounds, 'primaryScore', sc?.p1_primary);
  const p1Sec = extractRoundValues(p1Rounds, 'secondaryScore', sc?.p1_secondary, p1Hand);
  const p2Prim = extractRoundValues(p2Rounds, 'primaryScore', sc?.p2_primary);
  const p2Sec = extractRoundValues(p2Rounds, 'secondaryScore', sc?.p2_secondary, p2Hand);

  const p1PrimTotal = Math.max(Number(sc?.p1_primary_total || 0), Math.min(priCap, p1Prim.reduce((a, b) => a + Number(b || 0), 0)));
  const p1SecTotal = Math.max(Number(sc?.p1_secondary_total || 0), Math.min(secCap, p1Sec.reduce((a, b) => a + Number(b || 0), 0)));
  const p2PrimTotal = Math.max(Number(sc?.p2_primary_total || 0), Math.min(priCap, p2Prim.reduce((a, b) => a + Number(b || 0), 0)));
  const p2SecTotal = Math.max(Number(sc?.p2_secondary_total || 0), Math.min(secCap, p2Sec.reduce((a, b) => a + Number(b || 0), 0)));
  const p1Br = !hasPaint ? 0 : (sc?.p1_battle_ready !== undefined ? Number(sc.p1_battle_ready) : (typeof st?.p1?.paintScore === 'number' ? st.p1.paintScore : (st?.p1?.battleReady === false ? 0 : 10)));
  const p2Br = !hasPaint ? 0 : (sc?.p2_battle_ready !== undefined ? Number(sc.p2_battle_ready) : (typeof st?.p2?.paintScore === 'number' ? st.p2.paintScore : (st?.p2?.battleReady === false ? 0 : 10)));
  const p1Gs = hasGrandStrategy ? Number(st?.p1?.grandStrategyScore || (st?.p1?.grandStrategyAchieved ? 3 : 0)) : 0;
  const p2Gs = hasGrandStrategy ? Number(st?.p2?.grandStrategyScore || (st?.p2?.grandStrategyAchieved ? 3 : 0)) : 0;

  const computedTrackerTotal1 = Math.min(maxTot, p1PrimTotal + p1SecTotal + p1Br + p1Gs);
  const computedTrackerTotal2 = Math.min(maxTot, p2PrimTotal + p2SecTotal + p2Br + p2Gs);

  const computedTrackerS1 = isTrackerScorecard
    ? Math.max(Number(st?.p1?.score ?? rec?.p1_score ?? 0), computedTrackerTotal1)
    : undefined;
  const computedTrackerS2 = isTrackerScorecard
    ? Math.max(Number(st?.p2?.score ?? rec?.p2_score ?? 0), computedTrackerTotal2)
    : undefined;

  const rawS1 = computedTrackerS1 ?? sc?.player1_score ?? sc?.p1_total ?? sc?.bcp_match?.player1_score ?? match?.player1_score;
  const rawS2 = computedTrackerS2 ?? sc?.player2_score ?? sc?.p2_total ?? sc?.bcp_match?.player2_score ?? match?.player2_score;
  const hasScore = (rawS1 !== null && rawS1 !== undefined && rawS2 !== null && rawS2 !== undefined)
    || (overlayData?.scoreStr && overlayData.scoreStr !== '0 - 0' && overlayData.scoreStr !== 'LIVE');

  let s1 = Number(rawS1 ?? 0);
  let s2 = Number(rawS2 ?? 0);
  if ((rawS1 === null || rawS1 === undefined) && hasScore && overlayData?.scoreStr) {
    const parts = String(overlayData.scoreStr).split('-').map(x => Number(x.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      s1 = parts[0];
      s2 = parts[1];
    }
  }

  const isLiveFirestore = Boolean(isTrackerScorecard && sc?.source === 'firestore' && !sc?.is_finished);
  const p1Won = hasScore && !isLiveFirestore && s1 > s2;
  const p2Won = hasScore && !isLiveFirestore && s2 > s1;
  const isDraw = hasScore && !isLiveFirestore && s1 === s2;

  const rawMission = game.primary || game.p1Primary || st?.mission?.primaryName || game.battleplan?.name || st?.battleplan?.name || rec.primary_mission || sc?.primary_mission || '';
  const rawDeploy = game.deployment || rec.deployment || sc?.deployment || '';
  const missionText = (rawMission && rawMission !== 'Unknown Mission')
    ? `${rawMission}${rawDeploy && rawDeploy !== 'Standard Deployment' ? ` • ${rawDeploy}` : ''}`
    : (match?.mission || '');

  let tableBodyHtml = '';

  if (isTrackerScorecard) {
    const renderRoundCells = (arr, color) => [0, 1, 2, 3, 4].map(i => {
      const val = Number(arr[i] || 0);
      return `<td style="text-align:center; font-family:var(--font-mono); color:${val > 0 ? color : 'var(--text-muted)'}; font-weight:${val > 0 ? '700' : '400'}; padding:0.35rem 0.4rem;">${val}</td>`;
    }).join('');

    const secRowLabel = isAosStream ? 'Battle Tactics' : 'Secondary Objectives';

    tableBodyHtml = `
      <div style="overflow-x: hidden;">
        <table class="data-table" style="width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 0.78rem;">
          <thead>
            <tr style="background: rgba(15, 23, 42, 0.85); border-bottom: 1px solid rgba(255,255,255,0.1);">
              <th style="text-align: left; padding: 0.45rem 0.65rem;">Player / Scoring Category</th>
              <th style="text-align: center; width: 44px; padding: 0.45rem 0.3rem;">R1</th>
              <th style="text-align: center; width: 44px; padding: 0.45rem 0.3rem;">R2</th>
              <th style="text-align: center; width: 44px; padding: 0.45rem 0.3rem;">R3</th>
              <th style="text-align: center; width: 44px; padding: 0.45rem 0.3rem;">R4</th>
              <th style="text-align: center; width: 44px; padding: 0.45rem 0.3rem;">R5</th>
              <th style="text-align: right; width: 90px; padding: 0.45rem 0.65rem;">Total</th>
            </tr>
          </thead>
          <tbody>
            <!-- Player 1 Header -->
            <tr style="background: rgba(56, 189, 248, 0.1); border-top: 1px solid rgba(56, 189, 248, 0.25);">
              <td colspan="6" style="padding: 0.45rem 0.65rem; font-weight: 800; color: #fff;">
                <span style="color: #38bdf8;">${escapeHtml(p1Name)}</span>
                <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; margin-left: 0.4rem;">(${escapeHtml(p1Fac)} • ${escapeHtml(p1Det)})</span>
                ${p1Won ? '<span class="badge" style="background:rgba(16,185,129,0.2); color:#10b981; border:1px solid rgba(16,185,129,0.4); margin-left:0.4rem; font-size:0.64rem;">VICTORY</span>' : ''}
              </td>
              <td style="text-align: right; padding: 0.45rem 0.65rem; font-family: var(--font-mono); font-size: 0.95rem; font-weight: 900; color: ${p1Won ? '#10b981' : '#fff'};">
                ${s1} <span style="font-size: 0.68rem; color: var(--text-muted); font-weight: 500;">/ ${maxTot}</span>
              </td>
            </tr>
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
              <td style="padding: 0.35rem 0.65rem 0.35rem 1.25rem; color: var(--text-secondary);">Primary Mission</td>
              ${renderRoundCells(p1Prim, '#38bdf8')}
              <td style="text-align: right; padding: 0.35rem 0.65rem; font-family: var(--font-mono); font-weight: 700; color: #e2e8f0;">${p1PrimTotal} <span style="font-size:0.66rem; color:var(--text-muted);">/ ${priCap}</span></td>
            </tr>
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
              <td style="padding: 0.35rem 0.65rem 0.35rem 1.25rem; color: var(--text-secondary);">${secRowLabel}</td>
              ${renderRoundCells(p1Sec, '#a855f7')}
              <td style="text-align: right; padding: 0.35rem 0.65rem; font-family: var(--font-mono); font-weight: 700; color: #e2e8f0;">${p1SecTotal} <span style="font-size:0.66rem; color:var(--text-muted);">/ ${secCap}</span></td>
            </tr>
            ${hasPaint ? `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.08);">
              <td style="padding: 0.3rem 0.65rem 0.3rem 1.25rem; color: var(--text-muted); font-size: 0.72rem;">Battle Ready Bonus</td>
              <td colspan="5" style="text-align: center; color: var(--text-muted); font-size: 0.7rem;">Painted Army Standard</td>
              <td style="text-align: right; padding: 0.3rem 0.65rem; font-family: var(--font-mono); font-weight: 700; color: #10b981;">+${p1Br}</td>
            </tr>` : ''}
            ${hasGrandStrategy ? `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.08);">
              <td style="padding: 0.3rem 0.65rem 0.3rem 1.25rem; color: #fbbf24; font-size: 0.72rem;">👑 Grand Strategy (AoS 3e)</td>
              <td colspan="5" style="text-align: center; color: var(--text-muted); font-size: 0.7rem;">${escapeHtml(st?.p1?.grandStrategy || 'Grand Strategy')}</td>
              <td style="text-align: right; padding: 0.3rem 0.65rem; font-family: var(--font-mono); font-weight: 700; color: #fbbf24;">+${p1Gs}</td>
            </tr>` : ''}

            <!-- Player 2 Header -->
            <tr style="background: rgba(244, 63, 94, 0.1); border-top: 1px solid rgba(244, 63, 94, 0.25);">
              <td colspan="6" style="padding: 0.45rem 0.65rem; font-weight: 800; color: #fff;">
                <span style="color: #fb7185;">${escapeHtml(p2Name)}</span>
                <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; margin-left: 0.4rem;">(${escapeHtml(p2Fac)} • ${escapeHtml(p2Det)})</span>
                ${p2Won ? '<span class="badge" style="background:rgba(16,185,129,0.2); color:#10b981; border:1px solid rgba(16,185,129,0.4); margin-left:0.4rem; font-size:0.64rem;">VICTORY</span>' : ''}
              </td>
              <td style="text-align: right; padding: 0.45rem 0.65rem; font-family: var(--font-mono); font-size: 0.95rem; font-weight: 900; color: ${p2Won ? '#10b981' : '#fff'};">
                ${s2} <span style="font-size: 0.68rem; color: var(--text-muted); font-weight: 500;">/ ${maxTot}</span>
              </td>
            </tr>
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
              <td style="padding: 0.35rem 0.65rem 0.35rem 1.25rem; color: var(--text-secondary);">Primary Mission</td>
              ${renderRoundCells(p2Prim, '#fb7185')}
              <td style="text-align: right; padding: 0.35rem 0.65rem; font-family: var(--font-mono); font-weight: 700; color: #e2e8f0;">${p2PrimTotal} <span style="font-size:0.66rem; color:var(--text-muted);">/ ${priCap}</span></td>
            </tr>
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
              <td style="padding: 0.35rem 0.65rem 0.35rem 1.25rem; color: var(--text-secondary);">${secRowLabel}</td>
              ${renderRoundCells(p2Sec, '#f59e0b')}
              <td style="text-align: right; padding: 0.35rem 0.65rem; font-family: var(--font-mono); font-weight: 700; color: #e2e8f0;">${p2SecTotal} <span style="font-size:0.66rem; color:var(--text-muted);">/ ${secCap}</span></td>
            </tr>
            ${hasPaint ? `
            <tr>
              <td style="padding: 0.3rem 0.65rem 0.3rem 1.25rem; color: var(--text-muted); font-size: 0.72rem;">Battle Ready Bonus</td>
              <td colspan="5" style="text-align: center; color: var(--text-muted); font-size: 0.7rem;">Painted Army Standard</td>
              <td style="text-align: right; padding: 0.3rem 0.65rem; font-family: var(--font-mono); font-weight: 700; color: #10b981;">+${p2Br}</td>
            </tr>` : ''}
            ${hasGrandStrategy ? `
            <tr>
              <td style="padding: 0.3rem 0.65rem 0.3rem 1.25rem; color: #fbbf24; font-size: 0.72rem;">👑 Grand Strategy (AoS 3e)</td>
              <td colspan="5" style="text-align: center; color: var(--text-muted); font-size: 0.7rem;">${escapeHtml(st?.p2?.grandStrategy || 'Grand Strategy')}</td>
              <td style="text-align: right; padding: 0.3rem 0.65rem; font-family: var(--font-mono); font-weight: 700; color: #fbbf24;">+${p2Gs}</td>
            </tr>` : ''}
          </tbody>
        </table>
      </div>
    `;
  } else {
    const p1Badge = !hasScore
      ? '<span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; border:1px solid rgba(56,189,248,0.35); font-size:0.66rem;">LIVE</span>'
      : (p1Won
        ? '<span class="badge" style="background:rgba(16,185,129,0.2); color:#10b981; border:1px solid rgba(16,185,129,0.4); font-size:0.66rem;">VICTORY</span>'
        : (isDraw
          ? '<span class="badge" style="background:rgba(245,158,11,0.2); color:#f59e0b; border:1px solid rgba(245,158,11,0.4); font-size:0.66rem;">DRAW</span>'
          : '<span class="badge" style="background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); font-size:0.66rem;">DEFEAT</span>'));

    const p2Badge = !hasScore
      ? '<span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; border:1px solid rgba(56,189,248,0.35); font-size:0.66rem;">LIVE</span>'
      : (p2Won
        ? '<span class="badge" style="background:rgba(16,185,129,0.2); color:#10b981; border:1px solid rgba(16,185,129,0.4); font-size:0.66rem;">VICTORY</span>'
        : (isDraw
          ? '<span class="badge" style="background:rgba(245,158,11,0.2); color:#f59e0b; border:1px solid rgba(245,158,11,0.4); font-size:0.66rem;">DRAW</span>'
          : '<span class="badge" style="background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); font-size:0.66rem;">DEFEAT</span>'));

    tableBodyHtml = `
      <div style="overflow-x: hidden;">
        <table class="data-table" style="width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 0.8rem;">
          <thead>
            <tr style="background: rgba(15, 23, 42, 0.85); border-bottom: 1px solid rgba(255,255,255,0.08);">
              <th style="text-align: left; padding: 0.45rem 0.75rem;">Player</th>
              <th style="text-align: left; padding: 0.45rem 0.75rem;">Faction & Detachment</th>
              <th style="text-align: center; padding: 0.45rem 0.5rem;">Pre-Game Elo</th>
              <th style="text-align: center; padding: 0.45rem 0.5rem;">Outcome</th>
              <th style="text-align: right; padding: 0.45rem 0.75rem;">Battle Points</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.06); background: ${p1Won ? 'rgba(16, 185, 129, 0.06)' : 'transparent'};">
              <td style="padding: 0.55rem 0.75rem; font-weight: 800; color: #fff; border-left: 3px solid #38bdf8;">
                ${escapeHtml(p1Name)}
              </td>
              <td style="padding: 0.55rem 0.75rem; color: #7dd3fc; font-weight: 600;">
                ${escapeHtml(p1Fac)} <span style="color: var(--text-muted); font-weight: 400; font-size: 0.74rem;">• ${escapeHtml(p1Det)}</span>
              </td>
              <td style="padding: 0.55rem 0.5rem; text-align: center; font-family: var(--font-mono); color: var(--text-secondary);">
                ${p1Elo.toFixed(0)}
              </td>
              <td style="padding: 0.55rem 0.5rem; text-align: center;">
                ${p1Badge}
              </td>
              <td style="padding: 0.55rem 0.75rem; text-align: right; font-family: var(--font-mono); font-size: 1rem; font-weight: 900; color: ${p1Won ? '#10b981' : '#fff'};">
                ${hasScore ? `${s1} <span style="font-size: 0.7rem; color: var(--text-muted); font-weight: 400;">/ ${maxTot}</span>` : '<span style="font-size:0.78rem; color:#38bdf8;">In Progress</span>'}
              </td>
            </tr>
            <tr style="background: ${p2Won ? 'rgba(16, 185, 129, 0.06)' : 'transparent'};">
              <td style="padding: 0.55rem 0.75rem; font-weight: 800; color: #fff; border-left: 3px solid #f43f5e;">
                ${escapeHtml(p2Name)}
              </td>
              <td style="padding: 0.55rem 0.75rem; color: #fda4af; font-weight: 600;">
                ${escapeHtml(p2Fac)} <span style="color: var(--text-muted); font-weight: 400; font-size: 0.74rem;">• ${escapeHtml(p2Det)}</span>
              </td>
              <td style="padding: 0.55rem 0.5rem; text-align: center; font-family: var(--font-mono); color: var(--text-secondary);">
                ${p2Elo.toFixed(0)}
              </td>
              <td style="padding: 0.55rem 0.5rem; text-align: center;">
                ${p2Badge}
              </td>
              <td style="padding: 0.55rem 0.75rem; text-align: right; font-family: var(--font-mono); font-size: 1rem; font-weight: 900; color: ${p2Won ? '#10b981' : '#fff'};">
                ${hasScore ? `${s2} <span style="font-size: 0.7rem; color: var(--text-muted); font-weight: 400;">/ ${maxTot}</span>` : '<span style="font-size:0.78rem; color:#38bdf8;">In Progress</span>'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  return `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.6rem; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.45rem; flex-wrap: wrap; gap: 0.5rem;">
      <div style="font-size: 0.86rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
        <span>📋 Table ${tableNum} • Round ${curRound} Match Scorecard</span>
        <span class="badge" style="background: rgba(56, 189, 248, 0.14); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); font-size: 0.66rem;">Synced with Caster Desk</span>
        ${isTrackerScorecard ? `<span class="badge" style="background: rgba(245, 158, 11, 0.14); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); font-size: 0.66rem;">${escapeHtml(edShortBadge)}</span>` : ''}
        ${missionText ? `<span style="font-size: 0.74rem; color: var(--text-secondary); font-weight: 600;">• ${escapeHtml(missionText)}</span>` : ''}
      </div>
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        ${isLiveFirestore ? `
          <span style="font-size: 0.7rem; color: #38bdf8; font-weight: 700;">🔴 Live Tracker Scorecard</span>
        ` : (isTrackerScorecard ? `
          <span style="font-size: 0.7rem; color: #10b981; font-weight: 700;">✓ Turn-by-Turn Tracker Breakdown</span>
        ` : (hasScore ? `
          <span style="font-size: 0.7rem; color: var(--text-muted); font-weight: 600;">✓ Official BCP Scorecard</span>
        ` : `
          <button type="button" class="btn-sm btn-outline" style="font-size: 0.74rem; padding: 3px 8px; cursor: pointer;" onclick="openScorecardModal('${matchId}')">
            📄 Scorecard
          </button>
        `))}
      </div>
    </div>
    ${tableBodyHtml}
  `;
}
window.buildInlineStreamScorecardHtml = buildInlineStreamScorecardHtml;

function hydrateStreamTrackerScoreAsync(eventId, overlayData) {
  if (!eventId || !overlayData || !overlayData.tableNum || overlayData.tableNum <= 0) return;
  const matchId = `BCP-${eventId}-R${overlayData.roundNum}-T${overlayData.tableNum}`;
  if (streamLiveTrackerScoreCache[matchId] !== undefined) return;
  streamLiveTrackerScoreCache[matchId] = null; // mark in-flight

  fetch(`/api/scorecard/${encodeURIComponent(matchId)}`)
    .then(r => r.ok ? r.json() : null)
    .then(scData => {
      streamScorecardDataCache[matchId] = scData || { found: false };
      const sc = scData && (scData.scorecard || scData);
      const ev = currentEventData || {};
      const eventEnded = (typeof isEventEnded === 'function' && ev) ? Boolean(isEventEnded(ev)) : false;
      const players = Array.isArray(eventPlayersCache) && eventPlayersCache.length > 0 ? eventPlayersCache : (ev.players || []);
      const matches = Array.isArray(eventMatchesCache) && eventMatchesCache.length > 0 ? eventMatchesCache : (ev.matches || []);

      const st = sc?.state || sc?.game_record?.state_json || {};
      const rec = sc?.game_record || {};
      const allowTracker = sc && ((sc.source === 'tracker_games' && sc.is_finished !== false) || (!eventEnded && sc.source === 'firestore'));
      const s1Val = allowTracker
        ? (st?.p1?.score ?? rec?.p1_score ?? sc?.player1_score ?? sc?.p1_total)
        : (sc?.bcp_match?.player1_score ?? sc?.player1_score ?? sc?.p1_total);
      const s2Val = allowTracker
        ? (st?.p2?.score ?? rec?.p2_score ?? sc?.player2_score ?? sc?.p2_total)
        : (sc?.bcp_match?.player2_score ?? sc?.player2_score ?? sc?.p2_total);

      if (s1Val !== undefined && s1Val !== null && s2Val !== undefined && s2Val !== null) {
        streamLiveTrackerScoreCache[matchId] = `${s1Val} - ${s2Val}`;
        // Refresh HUDs if still viewing this table
        const updatedOverlay = resolveStreamTableMatchData(ev, players, matches, overlayData.tableNum, overlayData.roundNum);
        const modalHud = document.getElementById('modal-stream-hud-overlay');
        if (modalHud) modalHud.innerHTML = buildInAppStreamHudHtml(updatedOverlay);
        const monitorHud = document.getElementById('live-monitor-hud-overlay');
        if (monitorHud) monitorHud.innerHTML = buildInAppStreamHudHtml(updatedOverlay);
        const previewContainer = document.getElementById('obs-overlay-preview-container');
        if (previewContainer) previewContainer.innerHTML = buildObsOverlayPreviewStripHtml(updatedOverlay);
      }
      const matchupContainer = document.getElementById('modal-stream-matchup-container');
      if (matchupContainer && matchupContainer.getAttribute('data-match-id') === matchId) {
        const updatedOverlay = resolveStreamTableMatchData(ev, players, matches, overlayData.tableNum, overlayData.roundNum);
        const m = updatedOverlay.match;
        if (m) {
          const p1 = players.find(p => String(p.player_id || p.id) === String(m.player1_id) || p.full_name === m.player1_name);
          const p2 = players.find(p => String(p.player_id || p.id) === String(m.player2_id) || p.full_name === m.player2_name);
          matchupContainer.innerHTML = buildInlineStreamScorecardHtml(eventId, matchId, m, p1, p2, updatedOverlay, scData);
        }
      }
    })
    .catch(() => {});
}

function openEventStreamModal(tableNum, streamIdx) {
  const modal = document.getElementById('event-stream-modal');
  if (!modal) return;

  if (streamIdx !== undefined && streamIdx !== null && !isNaN(Number(streamIdx)) && eventLiveStreams[Number(streamIdx)]) {
    creatorActiveStreamIndex = Number(streamIdx);
    currentModalStreamTable = Number(eventLiveStreams[creatorActiveStreamIndex].tableNumber ?? 1);
  } else if (tableNum !== undefined && tableNum !== null && !isNaN(Number(tableNum))) {
    currentModalStreamTable = Number(tableNum);
    const matchIdx = (eventLiveStreams || []).findIndex(s => Number(s.tableNumber) === Number(tableNum));
    if (matchIdx >= 0) creatorActiveStreamIndex = matchIdx;
  } else if (selectedCasterTable !== undefined && selectedCasterTable !== null && !isNaN(Number(selectedCasterTable))) {
    currentModalStreamTable = Number(selectedCasterTable);
  } else {
    const activeStream = eventLiveStreams[creatorActiveStreamIndex] || eventLiveStreams[0];
    currentModalStreamTable = activeStream?.tableNumber !== undefined ? Number(activeStream.tableNumber) : 1;
  }

  if (typeof bringModalToFront === 'function') {
    bringModalToFront(modal);
  } else {
    modal.style.display = 'flex';
    modal.classList.add('active');
  }

  updateEventStreamModalContent();

  if (!eventLiveStreams || eventLiveStreams.length === 0) {
    const evId = currentOpenEventId || currentEventData?.id || '';
    if (evId && typeof loadEventLivestreams === 'function') {
      loadEventLivestreams(evId).then(() => {
        updateEventStreamModalContent();
      }).catch(() => {});
    }
  }
}
window.openEventStreamModal = openEventStreamModal;
window.openEventBroadcastTheater = openEventStreamModal;

function switchModalActiveStream(streamIdx) {
  const idx = Number(streamIdx);
  if (!eventLiveStreams || !eventLiveStreams[idx]) return;
  creatorActiveStreamIndex = idx;
  currentModalStreamTable = Number(eventLiveStreams[idx].tableNumber ?? 1);
  selectedCasterTable = currentModalStreamTable;
  updateEventStreamModalContent();
}
window.switchModalActiveStream = switchModalActiveStream;

function closeEventStreamModal() {
  const modalStage = document.getElementById('modal-stream-stage-wrap');
  if (modalStage) {
    modalStage.classList.remove('is-pseudo-fullscreen', 'is-fullscreen');
  }
  const fsEl = getStreamStageFullscreenElement();
  if (fsEl && modalStage && (fsEl === modalStage || modalStage.contains(fsEl))) {
    const exitFn = document.exitFullscreen || document.webkitExitFullscreen;
    if (exitFn) Promise.resolve(exitFn.call(document)).catch(() => {});
  }
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
  syncStreamFullscreenUiState();
}
window.closeEventStreamModal = closeEventStreamModal;

function onModalStreamTableChange(tableNum) {
  currentModalStreamTable = Number(tableNum);
  syncActiveStreamToCasterDesk(currentModalStreamTable, selectedCasterRound, true);
  updateEventStreamModalContent();
  if (currentEventData && creatorHubActiveMode === 'stream') {
    renderEventCreatorHub(currentEventData);
  }
}
window.onModalStreamTableChange = onModalStreamTableChange;

function updateEventStreamModalContent() {
  const iframe = document.getElementById('modal-stream-iframe');
  const titleEl = document.getElementById('modal-stream-title');
  const subtitleEl = document.getElementById('modal-stream-subtitle');
  const extLink = document.getElementById('modal-stream-external-link');
  const matchupContainer = document.getElementById('modal-stream-matchup-container');
  const modalHud = document.getElementById('modal-stream-hud-overlay');

  const ev = currentEventData || {};
  const matches = (eventMatchesCache && eventMatchesCache.length > 0) ? eventMatchesCache : (ev.matches || []);
  const players = (eventPlayersCache && eventPlayersCache.length > 0) ? eventPlayersCache : (ev.players || []);

  // Find active stream (prefer creatorActiveStreamIndex if matching currentModalStreamTable, otherwise match table or fallback)
  let activeStream = null;
  if (eventLiveStreams && eventLiveStreams.length > 0) {
    const indexedStream = eventLiveStreams[creatorActiveStreamIndex];
    if (indexedStream && Number(indexedStream.tableNumber) === Number(currentModalStreamTable)) {
      activeStream = indexedStream;
    } else {
      activeStream = eventLiveStreams.find(s => Number(s.tableNumber) === Number(currentModalStreamTable))
        || indexedStream
        || eventLiveStreams[0];
    }
  }

  const tableNum = activeStream?.tableNumber !== undefined
    ? Number(activeStream.tableNumber)
    : ((currentModalStreamTable !== undefined && currentModalStreamTable !== null && !isNaN(Number(currentModalStreamTable)))
      ? Number(currentModalStreamTable)
      : 1);

  const preferredRound = selectedCasterRound || activeStream?.roundNumber || ev.current_round || 1;
  const overlayData = resolveStreamTableMatchData(ev, players, matches, tableNum, preferredRound);
  const curRound = overlayData.roundNum;

  if (!eventLiveStreams || eventLiveStreams.length === 0) {
    if (modalHud) {
      modalHud.style.display = streamHudOverlayEnabled ? 'block' : 'none';
      modalHud.innerHTML = buildInAppStreamHudHtml(overlayData);
    }
    if (matchupContainer) {
      matchupContainer.removeAttribute('data-match-id');
      matchupContainer.innerHTML = '<div style="color:var(--text-muted); padding:1rem; text-align:center;">No active broadcasts linked for this event.</div>';
    }
    return;
  }

  if (iframe && activeStream) {
    if (iframe.getAttribute('src') !== activeStream.embedUrl) {
      iframe.src = activeStream.embedUrl;
    }
  }

  if (titleEl && activeStream) {
    const isMainDesk = Number(tableNum) === 0;
    titleEl.innerHTML = `
      <span>🔴 ${isMainDesk ? 'Main Desk Broadcast' : `Table ${tableNum} • Round ${curRound} Live Broadcast`}</span>
      <span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid #ef4444; font-size: 0.72rem; padding: 2px 7px;">
        ${escapeHtml(activeStream.channel)} • ${activeStream.platform.toUpperCase()}
      </span>
    `;
  }

  if (subtitleEl && activeStream) {
    const streamTitle = Number(tableNum) === 0
      ? `${activeStream.channel} - Main Desk Coverage`
      : `${activeStream.channel} - Table ${tableNum} Coverage (Round ${curRound})`;
    const multiStreamPills = eventLiveStreams.length > 1
      ? `<div style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap; margin-top:0.35rem;">
          ${eventLiveStreams.map((s, sIdx) => {
            const isSel = s === activeStream;
            const sTbl = Number(s.tableNumber) === 0 ? 'Main Desk' : `Table ${s.tableNumber}`;
            return `<button type="button" onclick="switchModalActiveStream(${sIdx})" style="padding:2px 8px; border-radius:6px; font-size:0.7rem; font-weight:700; cursor:pointer; border:1px solid ${isSel ? '#ef4444' : 'rgba(255,255,255,0.14)'}; background:${isSel ? 'rgba(239,68,68,0.22)' : 'rgba(15,23,42,0.75)'}; color:${isSel ? '#fca5a5' : '#cbd5e1'};">🔴 ${escapeHtml(s.channel)} (${sTbl})</button>`;
          }).join('')}
        </div>`
      : '';
    subtitleEl.innerHTML = `
      <div><span>${escapeHtml(streamTitle)}</span> • <span style="color:#4ade80;">👁️ ~${(activeStream.viewers || 100).toLocaleString()} watching live</span></div>
      ${multiStreamPills}
    `;
  }

  if (extLink && activeStream) {
    extLink.href = activeStream.streamUrl;
    extLink.title = `Watch directly on ${activeStream.channel}'s ${activeStream.platform} stream`;
  }

  // Render In-App Live Score HUD Overlay directly on top of the video player
  if (modalHud) {
    modalHud.style.display = streamHudOverlayEnabled ? 'block' : 'none';
    modalHud.innerHTML = buildInAppStreamHudHtml(overlayData);
  }

  const eventId = currentOpenEventId || ev.id || '';
  hydrateStreamTrackerScoreAsync(eventId, overlayData);

  if (!matchupContainer) return;

  if (Number(tableNum) === 0 && !overlayData.match) {
    matchupContainer.removeAttribute('data-match-id');
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

  const match = overlayData.match;
  if (!match) {
    matchupContainer.removeAttribute('data-match-id');
    matchupContainer.innerHTML = `
      <div style="text-align:center; color:var(--text-muted); font-size:0.85rem; padding:0.5rem;">
        No active pairing found for Table ${tableNum} in Round ${curRound}.
      </div>
    `;
    return;
  }

  const p1 = players.find(p => String(p.player_id || p.id) === String(match.player1_id) || p.full_name === match.player1_name);
  const p2 = players.find(p => String(p.player_id || p.id) === String(match.player2_id) || p.full_name === match.player2_name);

  const matchId = `BCP-${eventId}-R${curRound}-T${tableNum}`;
  matchupContainer.setAttribute('data-match-id', matchId);
  const cachedScData = streamScorecardDataCache[matchId] || null;
  matchupContainer.innerHTML = buildInlineStreamScorecardHtml(eventId, matchId, match, p1, p2, overlayData, cachedScData);
}
window.updateEventStreamModalContent = updateEventStreamModalContent;

function switchCreatorHubMode(mode) {
  if (mode === 'streams') mode = 'stream';
  if (mode === 'media') mode = 'export';
  if (mode === 'meta') {
    if (typeof switchEventModalTab === 'function') {
      switchEventModalTab('meta');
    }
    return;
  }
  if (mode === 'caster') {
    if (typeof switchEventModalTab === 'function') {
      switchEventModalTab('matches');
    }
    return;
  }
  creatorHubActiveMode = 'stream';
  if (currentEventModalTab !== 'player') {
    _currentMyStationSubtab = 'stream';
    if (typeof switchEventModalTab === 'function') {
      switchEventModalTab('player');
      return;
    }
  } else if (_currentMyStationSubtab !== 'stream' && typeof switchMyStationSubtab === 'function') {
    switchMyStationSubtab('stream');
    return;
  }
  if (currentEventData) {
    renderEventCreatorHub(currentEventData);
  }
}
window.switchCreatorHubMode = switchCreatorHubMode;

function selectCasterMatch(tableNum, roundNum) {
  syncActiveStreamToCasterDesk(tableNum, roundNum, true);
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
  const evId = ev?.id || currentOpenEventId || currentEventData?.id || '';

  if (tNum === 0) {
    const featureMatch = curRoundMatches.find(m => Number(m.table_number || m.table) === 1) || curRoundMatches[0] || null;
    if (featureMatch) {
      const p1 = findPlayer(featureMatch.player1_id, featureMatch.player1_name);
      const p2 = findPlayer(featureMatch.player2_id, featureMatch.player2_name);
      const hasScore = featureMatch.player1_score !== null && featureMatch.player1_score !== undefined && featureMatch.player2_score !== null && featureMatch.player2_score !== undefined;
      const fTable = Number(featureMatch.table_number || featureMatch.table || 1);
      const trackerScore = evId ? streamLiveTrackerScoreCache[`BCP-${evId}-R${rNum}-T${fTable}`] : null;
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
        scoreStr: trackerScore || (hasScore ? `${featureMatch.player1_score} - ${featureMatch.player2_score}` : '0 - 0')
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

  let exactMatch = curRoundMatches.find(m => Number(m.table_number || m.table) === tNum) || null;
  if (!exactMatch) {
    // Smart round fallback: if Table tNum didn't play in rNum (e.g. Top 8 cut in R10 vs Swiss Table 208 in R2),
    // find the latest round where Table tNum actually played!
    const tableHistory = (matches || [])
      .filter(m => Number(m.table_number || m.table) === tNum)
      .sort((a, b) => Number(b.round || 0) - Number(a.round || 0));
    if (tableHistory.length > 0) {
      const withScores = tableHistory.find(m => m.player1_score !== null && m.player1_score !== undefined);
      exactMatch = withScores || tableHistory[0];
      rNum = Number(exactMatch.round || rNum);
    }
  }

  if (exactMatch) {
    const p1 = findPlayer(exactMatch.player1_id, exactMatch.player1_name);
    const p2 = findPlayer(exactMatch.player2_id, exactMatch.player2_name);
    const hasScore = exactMatch.player1_score !== null && exactMatch.player1_score !== undefined && exactMatch.player2_score !== null && exactMatch.player2_score !== undefined;
    const trackerScore = evId ? streamLiveTrackerScoreCache[`BCP-${evId}-R${rNum}-T${tNum}`] : null;
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
      scoreStr: trackerScore || (hasScore ? `${exactMatch.player1_score} - ${exactMatch.player2_score}` : '0 - 0')
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

function buildObsOverlayUrlString(overlayType) {
  const ev = currentEventData || {};
  const evId = ev.id || currentOpenEventId || 'ev_ongoing_gt_live';
  const players = Array.isArray(eventPlayersCache) && eventPlayersCache.length > 0 ? eventPlayersCache : (ev.players || []);
  const matches = Array.isArray(eventMatchesCache) && eventMatchesCache.length > 0 ? eventMatchesCache : (ev.matches || []);
  const overlayData = resolveStreamTableMatchData(ev, players, matches, selectedCasterTable, selectedCasterRound);
  const effectiveRound = overlayData?.roundNum || selectedCasterRound || ev.current_round || 1;
  return `${window.location.origin}/overlay?event=${encodeURIComponent(evId)}&table=${selectedCasterTable}&round=${encodeURIComponent(effectiveRound)}&type=${overlayType || 'lower_third'}&follow=caster`;
}
window.buildObsOverlayUrlString = buildObsOverlayUrlString;

function refreshStreamTableSelection(tableVal, sourceId) {
  const parsed = parseInt(tableVal, 10);
  if (isNaN(parsed) || parsed < 0) return;

  const ev = currentEventData || {};
  const players = Array.isArray(eventPlayersCache) && eventPlayersCache.length > 0 ? eventPlayersCache : (ev.players || []);
  const matches = Array.isArray(eventMatchesCache) && eventMatchesCache.length > 0 ? eventMatchesCache : (ev.matches || []);
  const overlayData = resolveStreamTableMatchData(ev, players, matches, parsed, selectedCasterRound);

  syncActiveStreamToCasterDesk(parsed, overlayData.roundNum, true);

  const previewContainer = document.getElementById('obs-overlay-preview-container');
  if (previewContainer) {
    previewContainer.innerHTML = buildObsOverlayPreviewStripHtml(overlayData);
  }

  const monitorHud = document.getElementById('live-monitor-hud-overlay');
  if (monitorHud) {
    monitorHud.innerHTML = buildInAppStreamHudHtml(overlayData);
  }

  const urlInputEl = document.getElementById('obs-overlay-url-input');
  if (urlInputEl) {
    urlInputEl.value = buildObsOverlayUrlString('lower_third');
  }

  const evId = ev.id || currentOpenEventId || '';
  hydrateStreamTrackerScoreAsync(evId, overlayData);

  const obsSelect = document.getElementById('obs-overlay-table-select');

  if (sourceId !== 'obs-overlay-table-select' && obsSelect) {
    const hasOpt = Array.from(obsSelect.options).some(o => o.value === String(selectedCasterTable));
    if (hasOpt) {
      obsSelect.value = String(selectedCasterTable);
    } else {
      obsSelect.value = 'custom';
    }
  }

  const activeStream = eventLiveStreams[creatorActiveStreamIndex] || eventLiveStreams[0];
  const tableStr = selectedCasterTable === 0 ? 'Main Desk / All Tables' : `Table ${selectedCasterTable} (R${overlayData.roundNum})`;
  const monitorLabelEl = document.getElementById('live-monitor-table-label');
  if (monitorLabelEl) {
    monitorLabelEl.textContent = `${activeStream?.channel || 'Stream'} • ${tableStr}`;
  }
  const activeChannelBadgeEl = document.getElementById(`broadcaster-table-badge-${creatorActiveStreamIndex}`);
  if (activeChannelBadgeEl) {
    activeChannelBadgeEl.textContent = `(${selectedCasterTable === 0 ? 'Main Desk' : `Table ${selectedCasterTable}`})`;
  }
  const activeChannelTitleEl = document.getElementById(`broadcaster-title-${creatorActiveStreamIndex}`);
  if (activeChannelTitleEl && activeStream) {
    activeChannelTitleEl.textContent = activeStream.title;
  }
}
window.refreshStreamTableSelection = refreshStreamTableSelection;

function selectActiveStream(idx) {
  creatorActiveStreamIndex = Number(idx) || 0;
  const stream = eventLiveStreams[creatorActiveStreamIndex];
  if (stream && stream.tableNumber !== undefined && stream.tableNumber !== null) {
    selectedCasterTable = Number(stream.tableNumber);
    currentModalStreamTable = selectedCasterTable;
  }
  if (stream && stream.roundNumber) {
    selectedCasterRound = Number(stream.roundNumber);
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
        customEl.value = '1';
      }
      customEl.focus();
    }
  } else {
    if (customEl) {
      customEl.style.display = 'none';
    }
  }
}
window.handleStreamTableSelectChange = handleStreamTableSelectChange;

function handleObsOverlayTableChange(val) {
  if (val === 'custom') {
    const raw = window.prompt('Enter Table Number (0 for Main Desk):', String(selectedCasterTable || 1));
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      refreshStreamTableSelection(parsed, 'obs-overlay-table-select');
    }
  } else {
    refreshStreamTableSelection(val, 'obs-overlay-table-select');
  }
}
window.handleObsOverlayTableChange = handleObsOverlayTableChange;

function handleCustomStreamTableInput(_val) {
  // Handled when submitting + Link Stream so typing a custom table for a new stream does not mutate existing streams
}
window.handleCustomStreamTableInput = handleCustomStreamTableInput;

async function addCreatorLiveStream(e) {
  if (e) e.preventDefault();
  if (typeof _syncStreamBackendTimer !== 'undefined' && _syncStreamBackendTimer) {
    clearTimeout(_syncStreamBackendTimer);
    _syncStreamBackendTimer = null;
  }
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

  selectedCasterTable = table;
  currentModalStreamTable = table;
  const isMainDesk = table === 0;
  const defaultStreamTitle = isMainDesk ? `${channel} - Main Desk Broadcast` : `${channel} - Table ${table} Coverage`;

  const eventId = currentOpenEventId || currentEventData?.id || 'ev_ongoing_gt_live';
  const streamPayload = {
    channel: channel,
    stream_url: url,
    table_number: table,
    round_number: selectedCasterRound || currentEventData?.current_round || null,
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
        round_number: selectedCasterRound || null,
        is_live: true,
        viewers: 100
      }));
    }
    creatorActiveStreamIndex = 0;
    selectedCasterTable = table;
    currentModalStreamTable = table;
    if (channelEl) channelEl.value = '';
    if (urlEl) urlEl.value = '';
    if (typeof showProfileToast === 'function') {
      showProfileToast('✓ Live stream linked successfully!');
    } else {
      alert('Live stream linked successfully!');
    }
    if (currentEventData) {
      renderEventCreatorHub(currentEventData);
      if (typeof renderEventPairingsRows === 'function' && document.getElementById('event-matches-tbody')) {
        renderEventPairingsRows();
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
      if (typeof renderEventPairingsRows === 'function' && document.getElementById('event-matches-tbody')) {
        renderEventPairingsRows();
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

function fallbackCopyTextToClipboard(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

function copyObsOverlayUrl(overlayType, btnEl) {
  const url = buildObsOverlayUrlString(overlayType || 'lower_third');
  const tableLabel = Number(selectedCasterTable) === 0 ? 'Main Desk' : `Table ${selectedCasterTable}`;

  const urlInputEl = document.getElementById('obs-overlay-url-input');
  if (urlInputEl) {
    urlInputEl.value = url;
  }

  const onCopied = () => {
    if (btnEl) {
      const origHtml = btnEl.dataset.origHtml || btnEl.innerHTML;
      btnEl.dataset.origHtml = origHtml;
      btnEl.innerHTML = `✓ Copied (${tableLabel})!`;
      setTimeout(() => {
        if (btnEl.dataset.origHtml) btnEl.innerHTML = btnEl.dataset.origHtml;
      }, 2200);
    }
    if (typeof showProfileToast === 'function') {
      showProfileToast(`✓ OBS ${overlayType === 'tale_of_tape' ? 'Matchup Card' : 'Lower-Third HUD'} URL copied (${tableLabel})!`);
    } else if (typeof showToast === 'function') {
      showToast(`OBS URL copied (${tableLabel})!`, 'success');
    }
  };

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(url).then(onCopied).catch(() => {
      fallbackCopyTextToClipboard(url);
      onCopied();
    });
  } else {
    fallbackCopyTextToClipboard(url);
    onCopied();
  }
}
window.copyObsOverlayUrl = copyObsOverlayUrl;

function openObsOverlayPreview(overlayType) {
  const url = buildObsOverlayUrlString(overlayType || 'lower_third');
  window.open(url, '_blank', 'noopener,noreferrer');
}
window.openObsOverlayPreview = openObsOverlayPreview;

var casterPlayerProfileCache = (typeof window !== 'undefined' && window.__casterPlayerProfileCache) || {};
var casterArmyListCache = (typeof window !== 'undefined' && window.__casterArmyListCache) || {};
var casterHeadToHeadCache = (typeof window !== 'undefined' && window.__casterHeadToHeadCache) || {};
var casterFaction3MoCache = (typeof window !== 'undefined' && window.__casterFaction3MoCache) || {};
if (typeof window !== 'undefined') {
  window.__casterPlayerProfileCache = casterPlayerProfileCache;
  window.__casterArmyListCache = casterArmyListCache;
  window.__casterHeadToHeadCache = casterHeadToHeadCache;
  window.__casterFaction3MoCache = casterFaction3MoCache;
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
  const cardsHtml = (pastMatches || []).map(m => {
    const isP1Side1 = isSameCasterPlayer(m.player1_id, m.player1_name, p1Pid, p1Name);
    const rawS1 = isP1Side1 ? m.player1_score : m.player2_score;
    const rawS2 = isP1Side1 ? m.player2_score : m.player1_score;
    const facP1 = isP1Side1 ? (m.player1_faction || '') : (m.player2_faction || '');
    const facP2 = isP1Side1 ? (m.player2_faction || '') : (m.player1_faction || '');
    const scoreP1 = (rawS1 !== null && rawS1 !== undefined) ? rawS1 : '-';
    const scoreP2 = (rawS2 !== null && rawS2 !== undefined) ? rawS2 : '-';
    const numS1 = Number(rawS1);
    const numS2 = Number(rawS2);
    const wId = String(m.winner_id || '').trim();

    const isP1Winner = !m.is_draw && ((wId && isSameCasterPlayer(wId, '', p1Pid, '')) || (!isNaN(numS1) && !isNaN(numS2) && numS1 > numS2));
    const isP2Winner = !m.is_draw && ((wId && isSameCasterPlayer(wId, '', p2Pid, '')) || (!isNaN(numS1) && !isNaN(numS2) && numS2 > numS1));

    let outcomeText = 'DRAW';
    let badgeStyle = 'background: rgba(148, 163, 184, 0.16); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.35);';
    if (isP1Winner) {
      outcomeText = `🏆 ${p1Name.toUpperCase()} WIN`;
      badgeStyle = 'background: rgba(56, 189, 248, 0.16); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4);';
    } else if (isP2Winner) {
      outcomeText = `🏆 ${p2Name.toUpperCase()} WIN`;
      badgeStyle = 'background: rgba(16, 185, 129, 0.16); color: #4ade80; border: 1px solid rgba(16, 185, 129, 0.4);';
    }

    const eventName = m.event_name || (currentEventData && String(m.event_id) === String(currentEventData.id) ? currentEventData.name : 'Tournament');
    const eventId = m.event_id ? String(m.event_id).trim() : '';
    const safeEventId = eventId.replace(/'/g, "\\'");
    const rNum = Number(m.round || 1);
    const tNum = Number(m.table_number || m.table || 0);
    const scMatchId = m.tracker_match_id || (eventId && tNum > 0 ? `BCP-${eventId}-R${rNum}-T${tNum}` : '');
    const dateStr = String(m.match_date || '').slice(0, 10) || '-';

    return `
      <div style="background: rgba(9, 14, 26, 0.78); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 0.75rem 0.9rem; display: flex; flex-direction: column; gap: 0.55rem;">
        <!-- Top Meta & Outcome Bar -->
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; border-bottom: 1px solid rgba(255, 255, 255, 0.06); padding-bottom: 0.45rem;">
          <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; min-width: 0;">
            <span style="font-family: var(--font-mono); font-size: 0.73rem; color: var(--text-muted); background: rgba(255,255,255,0.04); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.06); white-space: nowrap;">
              📅 ${escapeHtml(dateStr)}
            </span>
            <span style="font-family: var(--font-mono); font-size: 0.72rem; font-weight: 800; color: #38bdf8; background: rgba(56, 189, 248, 0.12); padding: 2px 7px; border-radius: 4px; border: 1px solid rgba(56, 189, 248, 0.28); white-space: nowrap;">
              Round ${rNum}
            </span>
            ${eventId
              ? `<span class="player-link" onclick="event.stopPropagation(); if (typeof openEventModal === 'function') openEventModal('${escapeHtml(safeEventId)}', false);" style="font-weight: 700; font-size: 0.82rem; color: #f8fafc; cursor: pointer; text-decoration: underline; text-decoration-color: rgba(255,255,255,0.25); text-underline-offset: 2px;" title="View Tournament Details">${escapeHtml(eventName)}</span>`
              : `<span style="font-weight: 700; font-size: 0.82rem; color: #f8fafc;">${escapeHtml(eventName)}</span>`
            }
          </div>
          <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-left: auto;">
            <span class="badge" style="${badgeStyle} font-size: 0.68rem; font-weight: 800; padding: 2px 8px;">
              ${escapeHtml(outcomeText)}
            </span>
            ${scMatchId ? `
              <button type="button" class="btn-xs btn-outline" onclick="event.stopPropagation(); openScorecardModal('${escapeHtml(scMatchId.replace(/'/g, "\\'"))}')" style="font-size: 0.68rem; padding: 2px 7px; border-radius: 4px; color: #38bdf8; border-color: rgba(56,189,248,0.35); background: rgba(56,189,248,0.08); cursor: pointer; font-weight: 700;">
                📄 Scorecard
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Responsive VS Scoreboard Row -->
        <div style="display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 0.5rem;">
          <!-- Player 1 Side -->
          <div style="display: flex; flex-direction: column; min-width: 0; gap: 2px;">
            <div style="font-weight: 800; font-size: 0.84rem; line-height: 1.2; color: ${isP1Winner ? '#fff' : '#cbd5e1'}; overflow-wrap: break-word;">
              ${escapeHtml(p1Name)}
            </div>
            ${facP1 ? `<div style="font-size: 0.69rem; line-height: 1.2; color: #38bdf8; overflow-wrap: break-word;">🛡️ ${escapeHtml(facP1)}</div>` : ''}
          </div>

          <!-- Center Score Pill -->
          <div style="display: inline-flex; align-items: center; gap: 0.35rem; background: rgba(0, 0, 0, 0.45); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 0.25rem 0.6rem; font-family: var(--font-mono); font-size: 0.92rem; font-weight: 900; flex-shrink: 0; white-space: nowrap;">
            <span style="color: ${isP1Winner ? '#4ade80' : '#94a3b8'};">${escapeHtml(String(scoreP1))}</span>
            <span style="color: rgba(255,255,255,0.28); font-size: 0.72rem; font-weight: 700;">—</span>
            <span style="color: ${isP2Winner ? '#4ade80' : '#94a3b8'};">${escapeHtml(String(scoreP2))}</span>
          </div>

          <!-- Player 2 Side -->
          <div style="display: flex; flex-direction: column; align-items: flex-end; text-align: right; min-width: 0; gap: 2px;">
            <div style="font-weight: 800; font-size: 0.84rem; line-height: 1.2; color: ${isP2Winner ? '#fff' : '#cbd5e1'}; overflow-wrap: break-word; width: 100%;">
              ${escapeHtml(p2Name)}
            </div>
            ${facP2 ? `<div style="font-size: 0.69rem; line-height: 1.2; color: #f43f5e; overflow-wrap: break-word; width: 100%;">🛡️ ${escapeHtml(facP2)}</div>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="caster-table-section-card" style="background: rgba(15, 23, 42, 0.72); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 0.95rem 1.1rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: ${cardsHtml ? '0.7rem' : '0.45rem'}; flex-wrap: wrap;">
        <h4 style="margin: 0; font-size: 0.92rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.4rem;">
          <span>📜 Past Head-to-Head Encounters</span>
        </h4>
        <span class="badge" style="background: rgba(56, 189, 248, 0.14); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); font-size: 0.7rem; font-weight: 700;">
          ${rec.total > 0 ? `${rec.total} Past ${rec.total === 1 ? 'Match' : 'Matches'} • ${rec.summaryText}` : (isLoading ? 'Checking Career History...' : 'First Career Meeting')}
        </span>
      </div>
      ${cardsHtml ? `
        <div style="display: flex; flex-direction: column; gap: 0.55rem;">
          ${cardsHtml}
        </div>
      ` : `
        <div style="background: rgba(9, 14, 26, 0.55); border: 1px dashed rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 0.7rem 0.9rem; text-align: center; color: var(--text-muted); font-size: 0.78rem;">
          ${isLoading ? 'Loading past head-to-head encounters...' : `🤝 No previous head-to-head tournament matches recorded between <strong>${escapeHtml(p1Name)}</strong> and <strong>${escapeHtml(p2Name)}</strong>.`}
        </div>
      `}
    </div>
  `;
}

function computeCasterFaction3MoMetrics(fac1Raw, fac2Raw, matches, sys = '40k') {
  const fac1 = formatEventPlayerFaction(fac1Raw || 'Faction 1');
  const fac2 = formatEventPlayerFaction(fac2Raw || 'Faction 2');
  const isMirror = Boolean(fac1 && fac2 && isSameCasterFaction(fac1, fac2));

  // 1. In-event matchup record between fac1 and fac2
  let evF1Wins = 0;
  let evF2Wins = 0;
  let evDraws = 0;
  (Array.isArray(matches) ? matches : []).forEach(m => {
    if (!m || m.is_bye) return;
    if (m.player1_score === null || m.player1_score === undefined || m.player2_score === null || m.player2_score === undefined) return;
    const s1 = Number(m.player1_score);
    const s2 = Number(m.player2_score);
    if (isNaN(s1) || isNaN(s2)) return;
    const mf1 = m.player1_faction || '';
    const mf2 = m.player2_faction || '';
    if (isMirror) {
      if (isSameCasterFaction(mf1, fac1) && isSameCasterFaction(mf2, fac1)) {
        if (s1 === s2 || m.is_draw) evDraws++;
        else evF1Wins++;
      }
    } else if (isSameCasterFaction(mf1, fac1) && isSameCasterFaction(mf2, fac2)) {
      if (s1 > s2) evF1Wins++;
      else if (s2 > s1) evF2Wins++;
      else evDraws++;
    } else if (isSameCasterFaction(mf1, fac2) && isSameCasterFaction(mf2, fac1)) {
      if (s2 > s1) evF1Wins++;
      else if (s1 > s2) evF2Wins++;
      else evDraws++;
    }
  });
  const evTotal = evF1Wins + evF2Wins + evDraws;

  // 2. Global 3-month faction details from cache
  const k1 = `${sys || '40k'}:${String(fac1 || '').trim().toLowerCase()}`;
  const k2 = `${sys || '40k'}:${String(fac2 || '').trim().toLowerCase()}`;
  const f1Details = casterFaction3MoCache[k1] || null;
  const f2Details = casterFaction3MoCache[k2] || null;

  let h2hF1Wins = 0;
  let h2hF2Wins = 0;
  let h2hDraws = 0;

  if (!isMirror) {
    const f1Matchups = Array.isArray(f1Details?.matchups) ? f1Details.matchups : [];
    const matchedFromF1 = f1Matchups.filter(m => isSameCasterFaction(m.opponent_faction, fac2));
    if (matchedFromF1.length > 0) {
      matchedFromF1.forEach(m => {
        h2hF1Wins += Number(m.wins || 0);
        h2hF2Wins += Number(m.losses || 0);
        h2hDraws += Number(m.draws || 0);
      });
    } else {
      const f2Matchups = Array.isArray(f2Details?.matchups) ? f2Details.matchups : [];
      const matchedFromF2 = f2Matchups.filter(m => isSameCasterFaction(m.opponent_faction, fac1));
      matchedFromF2.forEach(m => {
        h2hF1Wins += Number(m.losses || 0);
        h2hF2Wins += Number(m.wins || 0);
        h2hDraws += Number(m.draws || 0);
      });
    }
  }

  const h2hTotal = h2hF1Wins + h2hF2Wins + h2hDraws;
  const f1GlobalGames = Number(f1Details?.stats?.total_matches || f1Details?.total_matches || 0);
  const f1GlobalWins = Number(f1Details?.stats?.total_wins || 0);
  const f1GlobalLosses = Number(f1Details?.stats?.total_losses || 0);
  const f1GlobalWr = Number(f1Details?.stats?.win_rate || 0);

  const f2GlobalGames = Number(f2Details?.stats?.total_matches || f2Details?.total_matches || 0);
  const f2GlobalWins = Number(f2Details?.stats?.total_wins || 0);
  const f2GlobalLosses = Number(f2Details?.stats?.total_losses || 0);
  const f2GlobalWr = Number(f2Details?.stats?.win_rate || 0);

  return {
    fac1,
    fac2,
    isMirror,
    hasLoadedF1: Boolean(f1Details),
    hasLoadedF2: Boolean(f2Details),
    h2hF1Wins,
    h2hF2Wins,
    h2hDraws,
    h2hTotal,
    evF1Wins,
    evF2Wins,
    evDraws,
    evTotal,
    f1GlobalGames,
    f1GlobalWins,
    f1GlobalLosses,
    f1GlobalWr,
    f2GlobalGames,
    f2GlobalWins,
    f2GlobalLosses,
    f2GlobalWr
  };
}

function buildCasterFaction3MoMatchupCardHtml(fac1Raw, fac2Raw, matches, sys = '40k', isLoading = false) {
  const m = computeCasterFaction3MoMetrics(fac1Raw, fac2Raw, matches, sys);
  const {
    fac1, fac2, isMirror,
    h2hF1Wins, h2hF2Wins, h2hDraws, h2hTotal,
    evF1Wins, evF2Wins, evDraws, evTotal,
    f1GlobalGames, f1GlobalWins, f1GlobalLosses, f1GlobalWr,
    f2GlobalGames, f2GlobalWins, f2GlobalLosses, f2GlobalWr
  } = m;

  // Use global 3mo head-to-head when available; fallback to in-event head-to-head if 0 global games
  const useGlobalH2h = h2hTotal > 0;
  const activeF1W = useGlobalH2h ? h2hF1Wins : evF1Wins;
  const activeF2W = useGlobalH2h ? h2hF2Wins : evF2Wins;
  const activeD = useGlobalH2h ? h2hDraws : evDraws;
  const activeTotal = activeF1W + activeF2W + activeD;

  const f1Wr = activeTotal > 0 ? (activeF1W / activeTotal) * 100 : 50;
  const f2Wr = activeTotal > 0 ? (activeF2W / activeTotal) * 100 : 50;
  const dPct = activeTotal > 0 ? (activeD / activeTotal) * 100 : 0;
  const f1WrStr = activeTotal > 0 ? f1Wr.toFixed(1) : '50.0';
  const f2WrStr = activeTotal > 0 ? f2Wr.toFixed(1) : '50.0';

  let headerBadgeText = '';
  let headerBadgeStyle = 'background: rgba(168, 85, 247, 0.14); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.32);';
  if (isMirror) {
    headerBadgeText = f1GlobalGames > 0
      ? `🪞 Mirror Clash • ${f1GlobalWr.toFixed(1)}% Global 3-Mo Meta WR (${f1GlobalGames} Games)`
      : (isLoading ? '⏳ Analyzing Past 3 Months Meta...' : '🪞 Same-Faction Mirror Matchup');
  } else if (activeTotal > 0) {
    const scopeLabel = useGlobalH2h ? 'Past 3 Months' : 'In-Event';
    if (f1Wr >= 53) {
      headerBadgeText = `🔥 Favors ${fac1} (${f1WrStr}% WR • ${activeTotal} Games, ${scopeLabel})`;
      headerBadgeStyle = 'background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.38);';
    } else if (f2Wr >= 53) {
      headerBadgeText = `🔥 Favors ${fac2} (${f2WrStr}% WR • ${activeTotal} Games, ${scopeLabel})`;
      headerBadgeStyle = 'background: rgba(244, 63, 94, 0.15); color: #f43f5e; border: 1px solid rgba(244, 63, 94, 0.38);';
    } else {
      headerBadgeText = `⚖️ Balanced Matchup (${f1WrStr}% vs ${f2WrStr}% • ${activeTotal} Games, ${scopeLabel})`;
      headerBadgeStyle = 'background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35);';
    }
  } else if (isLoading) {
    headerBadgeText = '⏳ Loading Past 3 Months Faction Telemetry...';
  } else {
    headerBadgeText = '📊 90-Day Global Faction Telemetry';
  }

  return `
    <div class="caster-table-section-card" style="background: rgba(15, 23, 42, 0.72); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 0.95rem 1.1rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.7rem; flex-wrap: wrap;">
        <div>
          <h4 style="margin: 0; font-size: 0.92rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.4rem;">
            <span>⚔️ Global Faction Matchup (Past 3 Months): ${escapeHtml(fac1)} vs ${escapeHtml(fac2)}</span>
          </h4>
          <div style="font-size: 0.73rem; color: var(--text-secondary); margin-top: 2px;">
            How well <strong>${escapeHtml(fac1)}</strong> and <strong>${escapeHtml(fac2)}</strong> perform against each other and in the broader tournament meta over the last 90 days.
          </div>
        </div>
        <span class="badge" style="${headerBadgeStyle} font-size: 0.7rem; font-weight: 700;">
          ${escapeHtml(headerBadgeText)}
        </span>
      </div>

      ${(!isMirror && activeTotal > 0) ? `
        <!-- Head-to-Head Faction Tug-of-War Box -->
        <div style="background: rgba(9, 14, 26, 0.78); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 0.75rem 0.9rem; margin-bottom: 0.65rem;">
          <div class="caster-factions-tug-grid" style="display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
            <!-- Faction 1 -->
            <div class="caster-factions-tug-f1" style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
              <div style="font-size: 0.8rem; font-weight: 800; color: #38bdf8; overflow-wrap: break-word;">
                🛡️ ${escapeHtml(fac1)}
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 900; color: #fff;">
                ${f1WrStr}% <span style="font-size: 0.72rem; font-weight: 600; color: var(--text-secondary);">(${activeF1W}W-${activeF2W}L${activeD > 0 ? `-${activeD}D` : ''})</span>
              </div>
            </div>

            <!-- Center Sample Pill -->
            <div class="caster-factions-tug-sample" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 0.22rem 0.55rem; font-family: var(--font-mono); font-size: 0.7rem; font-weight: 800; color: #cbd5e1; text-align: center; white-space: nowrap;">
              ${activeTotal} ${activeTotal === 1 ? 'Game' : 'Games'} (${useGlobalH2h ? 'Past 3 Mo' : 'This Event'})
            </div>

            <!-- Faction 2 -->
            <div class="caster-factions-tug-f2" style="display: flex; flex-direction: column; align-items: flex-end; text-align: right; gap: 2px; min-width: 0;">
              <div style="font-size: 0.8rem; font-weight: 800; color: #f43f5e; overflow-wrap: break-word;">
                🛡️ ${escapeHtml(fac2)}
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 900; color: #fff;">
                ${f2WrStr}% <span style="font-size: 0.72rem; font-weight: 600; color: var(--text-secondary);">(${activeF2W}W-${activeF1W}L${activeD > 0 ? `-${activeD}D` : ''})</span>
              </div>
            </div>
          </div>

          <!-- Dual-Color Matchup Bar -->
          <div style="width: 100%; height: 8px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden; display: flex;">
            <div style="width: ${f1Wr}%; height: 100%; background: linear-gradient(90deg, #0284c7, #38bdf8);"></div>
            ${dPct > 0 ? `<div style="width: ${dPct}%; height: 100%; background: #64748b;"></div>` : ''}
            <div style="width: ${f2Wr}%; height: 100%; background: linear-gradient(90deg, #f43f5e, #e11d48);"></div>
          </div>
        </div>
      ` : (!isMirror ? `
        <div style="background: rgba(9, 14, 26, 0.55); border: 1px dashed rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 0.65rem 0.85rem; text-align: center; color: var(--text-muted); font-size: 0.77rem; margin-bottom: 0.65rem;">
          ${isLoading
            ? `⏳ Querying past 3 months of global tournament games between <strong>${escapeHtml(fac1)}</strong> and <strong>${escapeHtml(fac2)}</strong>...`
            : `📊 No direct global tournament games recorded between <strong>${escapeHtml(fac1)}</strong> and <strong>${escapeHtml(fac2)}</strong> in the past 3 months — see each faction's 90-day overall meta standing below.`}
        </div>
      ` : '')}

      <!-- 3-Column 90-Day Meta & Event Context Grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: 0.55rem;">
        <div style="background: rgba(9, 14, 26, 0.65); border: 1px solid rgba(56, 189, 248, 0.22); border-radius: 8px; padding: 0.55rem 0.7rem;">
          <div style="font-size: 0.65rem; font-weight: 800; text-transform: uppercase; color: #38bdf8; letter-spacing: 0.03em;">
            🛡️ ${escapeHtml(fac1)} • 3-Mo Meta Form
          </div>
          <div style="font-family: var(--font-mono); font-size: 0.82rem; font-weight: 800; color: #fff; margin-top: 2px;">
            ${f1GlobalGames > 0
              ? `<span style="color: ${f1GlobalWr >= 52 ? '#4ade80' : (f1GlobalWr <= 45 ? '#f87171' : '#fbbf24')};">${f1GlobalWr.toFixed(1)}% WR</span> <span style="font-size: 0.72rem; color: var(--text-secondary);">(${f1GlobalWins}W-${f1GlobalLosses}L • ${f1GlobalGames}G)</span>`
              : (isLoading ? '<span style="color:var(--text-muted);">Loading 90d stats...</span>' : '<span style="color:var(--text-muted);">No 90d global games</span>')}
          </div>
        </div>

        <div style="background: rgba(9, 14, 26, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 0.55rem 0.7rem;">
          <div style="font-size: 0.65rem; font-weight: 800; text-transform: uppercase; color: #c084fc; letter-spacing: 0.03em;">
            🏟️ In-Event Faction Clash
          </div>
          <div style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 800; color: #fff; margin-top: 2px;">
            ${isMirror
              ? `${evTotal} Mirror ${evTotal === 1 ? 'Match' : 'Matches'} in Event`
              : (evTotal > 0
                ? `${evF1Wins}W - ${evF2Wins}L${evDraws > 0 ? ` - ${evDraws}D` : ''} <span style="font-size:0.71rem; color:var(--text-secondary);">(${Math.round((evF1Wins / evTotal) * 100)}% ${escapeHtml(fac1)})</span>`
                : '<span style="color:var(--text-muted); font-weight:600;">First clash in this event</span>')}
          </div>
        </div>

        <div style="background: rgba(9, 14, 26, 0.65); border: 1px solid rgba(244, 63, 94, 0.22); border-radius: 8px; padding: 0.55rem 0.7rem;">
          <div style="font-size: 0.65rem; font-weight: 800; text-transform: uppercase; color: #f43f5e; letter-spacing: 0.03em;">
            🛡️ ${escapeHtml(fac2)} • 3-Mo Meta Form
          </div>
          <div style="font-family: var(--font-mono); font-size: 0.82rem; font-weight: 800; color: #fff; margin-top: 2px;">
            ${f2GlobalGames > 0
              ? `<span style="color: ${f2GlobalWr >= 52 ? '#4ade80' : (f2GlobalWr <= 45 ? '#f87171' : '#fbbf24')};">${f2GlobalWr.toFixed(1)}% WR</span> <span style="font-size: 0.72rem; color: var(--text-secondary);">(${f2GlobalWins}W-${f2GlobalLosses}L • ${f2GlobalGames}G)</span>`
              : (isLoading ? '<span style="color:var(--text-muted);">Loading 90d stats...</span>' : '<span style="color:var(--text-muted);">No 90d global games</span>')}
          </div>
        </div>
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

  creatorHubActiveMode = 'stream';

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

  let roundMatches = matches.filter(m => Number(m.round) === curRound);
  let selectedMatch = null;
  let p1 = null;
  let p2 = null;
  let p1Elo = 1500;
  let p2Elo = 1500;

  if (roundMatches.length > 0) {
    let exactMatch = roundMatches.find(m => Number(m.table_number || m.table) === Number(selectedCasterTable));
    if (!exactMatch && Number(selectedCasterTable) > 0 && !selectedCasterRound) {
      const tableHist = matches
        .filter(m => Number(m.table_number || m.table) === Number(selectedCasterTable))
        .sort((a, b) => Number(b.round || 0) - Number(a.round || 0));
      if (tableHist.length > 0) {
        exactMatch = tableHist.find(m => m.player1_score !== null && m.player1_score !== undefined) || tableHist[0];
        curRound = Number(exactMatch.round || curRound);
        selectedCasterRound = curRound;
        roundMatches = matches.filter(m => Number(m.round) === curRound);
      }
    }
    if (exactMatch) {
      selectedMatch = exactMatch;
    } else {
      selectedMatch = roundMatches[0] || null;
      if (selectedMatch && !selectedCasterTable) {
        selectedCasterTable = Number(selectedMatch?.table_number || selectedMatch?.table || 1);
      }
    }

    if (selectedMatch) {
      ensureEventSearchIndex();
      p1 = lookupEventPlayerFast(selectedMatch?.player1_id, selectedMatch?.player1_name) || {
        player_id: selectedMatch.player1_id || '',
        full_name: selectedMatch.player1_name || 'Player 1',
        faction: selectedMatch.player1_faction || 'Army',
        detachment: 'Standard',
        list_id: selectedMatch.player1_list_id || '',
        current_elo: selectedMatch.player1_elo || 1500
      };
      p2 = lookupEventPlayerFast(selectedMatch?.player2_id, selectedMatch?.player2_name) || {
        player_id: selectedMatch.player2_id || '',
        full_name: selectedMatch.player2_name || 'Player 2',
        faction: selectedMatch.player2_faction || 'Army',
        detachment: 'Standard',
        list_id: selectedMatch.player2_list_id || '',
        current_elo: selectedMatch.player2_elo || 1500
      };

      p1Elo = Number(selectedMatch?.player1_elo || p1?.current_elo || 1500);
      p2Elo = Number(selectedMatch?.player2_elo || p2?.current_elo || 1500);
    }
  }

  const bodyHtml = renderStreamStudioMode(ev, players, matches, selectedMatch, p1, p2, p1Elo, p2Elo, curRound);

  container.innerHTML = `
    <div class="creator-hub-container">
      ${bodyHtml}
    </div>
  `;
}
window.renderEventCreatorHub = renderEventCreatorHub;

function normalizeCasterFactionKey(raw) {
  const s = String(raw || '').trim().toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  if (s === 'genestealer cult') return 'genestealer cults';
  if (s === 'custodes') return 'adeptus custodes';
  if (s === 'admech' || s === 'mechanicus') return 'adeptus mechanicus';
  if (s === 'csm' || s === 'heretic astartes') return 'chaos space marines';
  if (s === 'sm' || s === 'astartes' || s === 'adeptus astartes') return 'space marines';
  if (s === 'guard' || s === 'imperial guard') return 'astra militarum';
  if (s === 'sisters' || s === 'sisters of battle') return 'adepta sororitas';
  if (s === 'daemons') return 'chaos daemons';
  if (s === 'eldar' || s === 'craftworlds') return 'aeldari';
  if (s === 'dark eldar') return 'drukhari';
  if (s === 'tau' || s === 'tau empire') return 'tau empire';
  return s;
}

function isSameCasterFaction(fA, fB) {
  const kA = normalizeCasterFactionKey(fA);
  const kB = normalizeCasterFactionKey(fB);
  if (!kA || !kB) return false;
  return kA === kB;
}

function buildCasterFactionMasteryHtml(playerObj, opponentObj, profileData, accentColor, eventMatches) {
  const curFac = formatEventPlayerFaction(playerObj?.faction || playerObj?.army_name || 'Army');
  const oppFac = formatEventPlayerFaction(opponentObj?.faction || opponentObj?.army_name || 'Opponent Faction');
  const history = Array.isArray(profileData?.history) ? profileData.history : (Array.isArray(profileData?.win_path) ? profileData.win_path : []);
  const rawBreakdown = profileData?.faction_mastery || profileData?.factions_breakdown || [];
  const rawMatrix = profileData?.matchup_matrix || [];
  let masteryList = [];

  if (typeof computeProfileFactionMastery === 'function' && (history.length > 0 || rawBreakdown.length > 0)) {
    masteryList = computeProfileFactionMastery(history, rawBreakdown, profileData?.tournaments || profileData?.events_attended, profileData?.tracker_history || profileData?.completed_history);
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

  // 1. Compute Own Faction Mastery (how well this player pilots their current match faction)
  const matchedOwnEntry = masteryList.find(m => isSameCasterFaction(m.faction, curFac));
  const curEvName = String(currentEventData?.name || '').trim().toLowerCase();
  const curEvId = String(currentEventData?.id || currentOpenEventId || '').trim().toLowerCase();
  const historyHasCurrentEvent = history.some(h => {
    const hEvId = String(h.event_id || '').trim().toLowerCase();
    const hEvName = String(h.event_name || '').trim().toLowerCase();
    return (curEvId && hEvId === curEvId) || (curEvName && hEvName === curEvName);
  });

  let ownWins = matchedOwnEntry ? Number(matchedOwnEntry.wins || 0) : 0;
  let ownLosses = matchedOwnEntry ? Number(matchedOwnEntry.losses || 0) : 0;
  let ownDraws = matchedOwnEntry ? Number(matchedOwnEntry.draws || 0) : 0;
  let ownNetElo = matchedOwnEntry ? Number(matchedOwnEntry.net_elo || 0) : 0;

  if (!historyHasCurrentEvent && evG > 0) {
    ownWins += evW;
    ownLosses += evL;
    ownDraws += evD;
    ownNetElo += evNet;
  } else if (ownWins + ownLosses + ownDraws === 0 && evG > 0) {
    ownWins = evW;
    ownLosses = evL;
    ownDraws = evD;
    ownNetElo = evNet;
  }
  const ownGames = ownWins + ownLosses + ownDraws;
  const ownWrNum = ownGames > 0 ? (ownWins / ownGames) * 100 : 0;

  // 2. Compute Matchup Mastery vs. Opponent's Faction (how well this player plays into oppFac)
  let vsWins = 0;
  let vsLosses = 0;
  let vsDraws = 0;
  let vsNetElo = 0;
  const seenVsKeys = new Set();

  history.forEach((h, idx) => {
    const hOppFac = h.opponent_faction || h.enemy_faction || h.opp_faction || '';
    if (!isSameCasterFaction(hOppFac, oppFac)) return;
    const key = `${String(h.event_id || h.event_name || idx).toLowerCase()}__${String(h.round || idx).toLowerCase()}__${String(h.opponent_name || '').toLowerCase()}`;
    if (seenVsKeys.has(key)) return;
    seenVsKeys.add(key);

    const resStr = String(h.result || h.outcome || '').toUpperCase();
    const pSc = h.player_score !== undefined ? Number(h.player_score) : NaN;
    const oSc = h.opponent_score !== undefined ? Number(h.opponent_score) : NaN;
    if (resStr === 'W' || resStr === 'WIN' || (!resStr && !isNaN(pSc) && !isNaN(oSc) && pSc > oSc)) {
      vsWins++;
    } else if (resStr === 'L' || resStr === 'LOSS' || (!resStr && !isNaN(pSc) && !isNaN(oSc) && oSc > pSc)) {
      vsLosses++;
    } else {
      vsDraws++;
    }
    vsNetElo += Number(h.delta_elo || h.elo_change || 0);
  });

  // Also include completed matches from current event against oppFac if not already in career history
  const pid = String(playerObj?.player_id || playerObj?.id || '').trim();
  const pname = String(playerObj?.full_name || playerObj?.name || '').trim();
  const evMatchList = Array.isArray(eventMatches) ? eventMatches : (Array.isArray(currentEventData?.matches) ? currentEventData.matches : []);
  if (!historyHasCurrentEvent && evMatchList.length > 0) {
    evMatchList.forEach(m => {
      if (m.is_bye) return;
      const isP1 = isSameCasterPlayer(m.player1_id, m.player1_name, pid, pname);
      const isP2 = !isP1 && isSameCasterPlayer(m.player2_id, m.player2_name, pid, pname);
      if (!isP1 && !isP2) return;
      const mOppFac = isP1 ? (m.player2_faction || '') : (m.player1_faction || '');
      if (!isSameCasterFaction(mOppFac, oppFac)) return;

      const mySc = isP1 ? m.player1_score : m.player2_score;
      const opSc = isP1 ? m.player2_score : m.player1_score;
      const hasSc = mySc !== null && mySc !== undefined && opSc !== null && opSc !== undefined;
      const wId = String(m.winner_id || '').trim();
      if (!hasSc && !wId && !m.is_done) return;

      const opName = isP1 ? (m.player2_name || '') : (m.player1_name || '');
      const key = `${curEvId || curEvName}__r${m.round || 0}__${String(opName).toLowerCase()}`;
      if (seenVsKeys.has(key)) return;
      seenVsKeys.add(key);

      const won = !m.is_draw && ((wId && isSameCasterPlayer(wId, '', pid, '')) || (hasSc && Number(mySc) > Number(opSc)));
      const lost = !m.is_draw && !won && (Boolean(wId) || (hasSc && Number(opSc) > Number(mySc)));
      if (won) {
        vsWins++;
        vsNetElo += 14.0;
      } else if (lost) {
        vsLosses++;
        vsNetElo -= 11.5;
      } else {
        vsDraws++;
      }
    });
  }

  // Fallback to matchup_matrix if history didn't have individual vs-faction rows
  if ((vsWins + vsLosses + vsDraws) === 0 && Array.isArray(rawMatrix) && rawMatrix.length > 0) {
    const matEntry = rawMatrix.find(m => isSameCasterFaction(m.enemy_faction || m.opponent_faction || m.faction, oppFac));
    if (matEntry) {
      vsWins = Number(matEntry.wins || 0);
      vsLosses = Number(matEntry.losses || 0);
      vsDraws = Number(matEntry.draws || 0);
      vsNetElo = Number(matEntry.net_elo || 0);
    }
  }

  const vsGames = vsWins + vsLosses + vsDraws;
  const vsWrNum = vsGames > 0 ? (vsWins / vsGames) * 100 : 0;

  const getMasteryTierBadge = (games, wr) => {
    if (games >= 20 && wr >= 60) return { label: '👑 Grandmaster', bg: 'rgba(245, 158, 11, 0.18)', col: '#fbbf24', border: 'rgba(245, 158, 11, 0.45)' };
    if (games >= 10 && wr >= 55) return { label: '🔥 Master', bg: 'rgba(168, 85, 247, 0.18)', col: '#c084fc', border: 'rgba(168, 85, 247, 0.45)' };
    if (games >= 5) return { label: '⚔️ Veteran Specialist', bg: 'rgba(56, 189, 248, 0.15)', col: '#38bdf8', border: 'rgba(56, 189, 248, 0.35)' };
    return { label: '🛡️ Faction Adept', bg: 'rgba(148, 163, 184, 0.15)', col: '#cbd5e1', border: 'rgba(148, 163, 184, 0.3)' };
  };

  const tierBadge = getMasteryTierBadge(ownGames, ownWrNum);
  const totalGames = masteryList.reduce((acc, m) => acc + Number(m.games || 0), 0);

  const pData = profileData?.player || profileData || {};
  const careerElo = Number(pData.current_elo || playerObj?.current_elo || 1500);
  const peakElo = Math.max(careerElo, Number(pData.peak_elo || playerObj?.peak_elo || careerElo));
  const careerWins = Number(pData.wins ?? (totalGames > 0 ? masteryList.reduce((s, m) => s + m.wins, 0) : evW));
  const careerLosses = Number(pData.losses ?? (totalGames > 0 ? masteryList.reduce((s, m) => s + m.losses, 0) : evL));
  const careerTotal = Math.max(1, careerWins + careerLosses + Number(pData.draws || 0));
  const careerWr = ((careerWins / careerTotal) * 100).toFixed(1);
  const maxStreak = Number(profileData?.longest_win_streak || profileData?.max_streak || 0);

  const ownWrStr = ownWrNum.toFixed(1);
  const ownNetStr = (ownNetElo >= 0 ? '+' : '') + ownNetElo.toFixed(1);
  const ownBarCol = ownWrNum >= 55 ? '#10b981' : (ownWrNum >= 48 ? accentColor : '#f43f5e');

  const vsWrStr = vsWrNum.toFixed(1);
  const vsNetStr = (vsNetElo >= 0 ? '+' : '') + vsNetElo.toFixed(1);
  const vsBarCol = vsGames === 0 ? 'rgba(148,163,184,0.35)' : (vsWrNum >= 55 ? '#10b981' : (vsWrNum >= 48 ? '#fbbf24' : '#f43f5e'));

  return `
    <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.35rem; margin-bottom: 0.65rem;">
      <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 0.38rem 0.42rem; min-width: 0;">
        <div style="font-size: 0.58rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700; white-space: nowrap;">Peak Elo 👑</div>
        <div style="font-family: var(--font-mono); font-size: 0.82rem; font-weight: 800; color: #fbbf24; white-space: nowrap;">${peakElo.toFixed(1)}</div>
      </div>
      <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 0.38rem 0.42rem; min-width: 0; overflow: hidden;">
        <div style="font-size: 0.58rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700; white-space: nowrap;">Career Record</div>
        <div style="font-family: var(--font-mono); font-size: 0.74rem; font-weight: 800; color: #fff; display: flex; align-items: baseline; gap: 3px; flex-wrap: wrap; line-height: 1.15;"><span>${careerWins}W-${careerLosses}L</span><span style="color:#4ade80; font-size:0.64rem;">(${careerWr}%)</span></div>
      </div>
      <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 0.38rem 0.42rem; min-width: 0;">
        <div style="font-size: 0.58rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700; white-space: nowrap;">Best Streak</div>
        <div style="font-family: var(--font-mono); font-size: 0.76rem; font-weight: 800; color: #fb923c; white-space: nowrap;">🔥 ${maxStreak > 0 ? `${maxStreak} Wins` : `${evW}W Event`}</div>
      </div>
    </div>

    <div style="background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; padding: 0.65rem 0.75rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; margin-bottom: 0.55rem; flex-wrap: wrap;">
        <span style="font-size: 0.73rem; font-weight: 800; text-transform: uppercase; color: ${accentColor}; letter-spacing: 0.04em;">
          🛡️ Faction & Matchup Mastery
        </span>
        <span class="badge" style="background: ${tierBadge.bg}; color: ${tierBadge.col}; border: 1px solid ${tierBadge.border}; font-size: 0.67rem; font-weight: 800; padding: 2px 7px;">
          ${tierBadge.label}
        </span>
      </div>

      <div style="display: flex; flex-direction: column; gap: 0.55rem;">
        <!-- Row 1: Own Faction Proficiency -->
        <div style="display: flex; flex-direction: column; gap: 4px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 0.45rem 0.55rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.35rem; flex-wrap: wrap; font-size: 0.75rem;">
            <span style="font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 0.3rem;">
              <span>🛡️ Playing as <strong>${escapeHtml(curFac)}</strong></span>
              <span style="color: var(--text-muted); font-weight: 600; font-size: 0.68rem;">(${ownGames}G)</span>
            </span>
            <span style="font-family: var(--font-mono); font-size: 0.74rem;">
              <strong style="color: ${ownBarCol};">${ownWrStr}% WR</strong>
              <span style="color: var(--text-secondary);">(${ownWins}W-${ownLosses}L${ownDraws ? `-${ownDraws}D` : ''})</span>
              <span style="color: ${ownNetElo >= 0 ? '#4ade80' : '#f87171'}; margin-left: 3px;">${ownNetStr} Elo</span>
            </span>
          </div>
          <div style="width: 100%; height: 5px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden;">
            <div style="width: ${Math.min(100, Math.max(4, ownWrNum))}%; height: 100%; background: ${ownBarCol};"></div>
          </div>
        </div>

        <!-- Row 2: Matchup vs. Opponent's Faction -->
        <div style="display: flex; flex-direction: column; gap: 4px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 0.45rem 0.55rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.35rem; flex-wrap: wrap; font-size: 0.75rem;">
            <span style="font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 0.3rem;">
              <span>🎯 Playing vs. <strong>${escapeHtml(oppFac)}</strong></span>
              <span style="color: var(--text-muted); font-weight: 600; font-size: 0.68rem;">(${vsGames}G)</span>
            </span>
            ${vsGames > 0 ? `
              <span style="font-family: var(--font-mono); font-size: 0.74rem;">
                <strong style="color: ${vsBarCol};">${vsWrStr}% WR</strong>
                <span style="color: var(--text-secondary);">(${vsWins}W-${vsLosses}L${vsDraws ? `-${vsDraws}D` : ''})</span>
                <span style="color: ${vsNetElo >= 0 ? '#4ade80' : '#f87171'}; margin-left: 3px;">${vsNetStr} Elo</span>
              </span>
            ` : `
              <span style="font-family: var(--font-mono); font-size: 0.71rem; color: var(--text-muted);">
                No Prior Recorded Games
              </span>
            `}
          </div>
          <div style="width: 100%; height: 5px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden;">
            <div style="width: ${vsGames > 0 ? Math.min(100, Math.max(4, vsWrNum)) : 0}%; height: 100%; background: ${vsBarCol};"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function hydrateCasterDossiersAsync(ev, p1, p2, selectedMatch) {
  const sys = (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k');
  const evMatches = Array.isArray(ev?.matches) ? ev.matches : (Array.isArray(currentEventData?.matches) ? currentEventData.matches : []);
  const pairs = [
    { side: 'p1', obj: p1, oppObj: p2, matchPid: selectedMatch?.player1_id, matchName: selectedMatch?.player1_name, matchListId: selectedMatch?.player1_list_id, color: '#38bdf8' },
    { side: 'p2', obj: p2, oppObj: p1, matchPid: selectedMatch?.player2_id, matchName: selectedMatch?.player2_name, matchListId: selectedMatch?.player2_list_id, color: '#f43f5e' }
  ];

  const p1Pid = String(p1?.player_id || p1?.id || selectedMatch?.player1_id || '').trim();
  const p2Pid = String(p2?.player_id || p2?.id || selectedMatch?.player2_id || '').trim();
  const p1Name = String(p1?.full_name || selectedMatch?.player1_name || 'Player 1').trim();
  const p2Name = String(p2?.full_name || selectedMatch?.player2_name || 'Player 2').trim();
  const curRound = Number(selectedMatch?.round || selectedCasterRound || ev?.current_round || 1);
  const h2hKey = getCasterH2hCacheKey(sys, p1Pid, p2Pid, p1Name, p2Name);

  const applyPastH2hToDom = (apiList) => {
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

  // Hydrate Global Faction Matchup (Past 3 Months)
  const fac1Clean = formatEventPlayerFaction(p1?.faction || selectedMatch?.player1_faction || 'Army');
  const fac2Clean = formatEventPlayerFaction(p2?.faction || selectedMatch?.player2_faction || 'Army');
  const applyFaction3MoToDom = (stillLoading = false) => {
    const fac3MoEl = document.getElementById('caster-faction-3mo-container');
    if (fac3MoEl) {
      fac3MoEl.innerHTML = buildCasterFaction3MoMatchupCardHtml(fac1Clean, fac2Clean, evMatches, sys, stillLoading);
    }
    const facSummaryEl = document.getElementById('caster-fac-matchup-summary');
    if (facSummaryEl) {
      const m = computeCasterFaction3MoMetrics(fac1Clean, fac2Clean, evMatches, sys);
      if (!m.isMirror && m.h2hTotal > 0) {
        const wr = Math.round((m.h2hF1Wins / m.h2hTotal) * 100);
        facSummaryEl.innerHTML = `📊 <strong>Faction Matchup (3-Mo):</strong> ${escapeHtml(m.fac1)} ${wr}% WR vs ${escapeHtml(m.fac2)} (${m.h2hF1Wins}W-${m.h2hF2Wins}L${m.h2hDraws > 0 ? `-${m.h2hDraws}D` : ''})`;
      } else if (!m.isMirror && m.evTotal > 0) {
        const wr = Math.round((m.evF1Wins / m.evTotal) * 100);
        facSummaryEl.innerHTML = `📊 <strong>Faction Matchup (Event):</strong> ${escapeHtml(m.fac1)} ${wr}% WR vs ${escapeHtml(m.fac2)} (${m.evF1Wins}W-${m.evF2Wins}L)`;
      }
    }
  };

  if (window.api && typeof window.api.getFactionDetails === 'function') {
    const uniqueFacs = [...new Set([fac1Clean, fac2Clean].filter(f => f && f !== '-' && f !== 'Army' && f !== 'Unknown' && f !== 'Various'))];
    const pendingPromises = [];
    uniqueFacs.forEach(facName => {
      const fKey = `${sys}:${facName.trim().toLowerCase()}`;
      if (!casterFaction3MoCache[fKey]) {
        const p = window.api.getFactionDetails(facName, 25, sys, '3mo').then(res => {
          if (res && !res.error) {
            casterFaction3MoCache[fKey] = res;
          } else {
            casterFaction3MoCache[fKey] = { faction: facName, stats: {}, matchups: [] };
          }
        }).catch(() => {
          casterFaction3MoCache[fKey] = { faction: facName, stats: {}, matchups: [] };
        });
        pendingPromises.push(p);
      }
    });
    if (pendingPromises.length === 0) {
      applyFaction3MoToDom(false);
    } else {
      Promise.allSettled(pendingPromises).then(() => {
        applyFaction3MoToDom(false);
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
        if (el) el.innerHTML = buildCasterFactionMasteryHtml(item.obj, item.oppObj, casterPlayerProfileCache[cacheKey], item.color, evMatches);
      } else {
        window.api.getPlayerProfile(pid || 'unknown', sys, pname).then(data => {
          if (data && !data.error) {
            casterPlayerProfileCache[cacheKey] = data;
            const el = document.getElementById(`caster-dossier-mastery-${item.side}`);
            if (el) el.innerHTML = buildCasterFactionMasteryHtml(item.obj, item.oppObj, data, item.color, evMatches);
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
  const fighterUnitsRowEl = document.getElementById(`caster-fighter-units-row-${side}`);
  const fighterUnitsEl = document.getElementById(`caster-fighter-units-${side}`);
  const units = extractKeyListUnits(rosterText, playerObj?.faction, playerObj?.detachment);

  if (units.length > 0) {
    if (fighterUnitsRowEl) fighterUnitsRowEl.style.display = '';
    if (fighterUnitsEl) fighterUnitsEl.innerHTML = escapeHtml(units.slice(0, 4).join(', '));
  } else {
    if (fighterUnitsRowEl) fighterUnitsRowEl.style.display = 'none';
  }
}

/* ==========================================================================
   MODE 1: CASTER DECK (FLOOR RADAR GRID + CLICKABLE TABLE DETAILS MODAL)
   ========================================================================== */
let _casterRadarFilter = 'all'; // 'all' | 'unfinished' | 'completed'
let _casterRadarSearch = '';

function setCasterRadarRound(roundNum) {
  selectedCasterRound = Number(roundNum) || 1;
  if (currentEventData) {
    renderEventCreatorHub(currentEventData);
  }
}
window.setCasterRadarRound = setCasterRadarRound;

function setCasterRadarFilter(filterVal) {
  _casterRadarFilter = filterVal || 'all';
  if (currentEventData) {
    renderEventCreatorHub(currentEventData);
  }
}
window.setCasterRadarFilter = setCasterRadarFilter;

function handleCasterRadarSearch(val) {
  _casterRadarSearch = String(val || '').trim().toLowerCase();
  const gridEl = document.getElementById('caster-radar-grid');
  if (gridEl && currentEventData && creatorHubActiveMode === 'caster') {
    const eventId = String(currentEventData.id || currentEventData.event_id || currentOpenEventId || '');
    const state = _eventToHubStateCache.get(eventId) || {};
    const activeSessions = Array.isArray(state.active_sessions) ? state.active_sessions : [];
    const roundMatches = Array.isArray(window._casterCurrentRoundMatches) ? window._casterCurrentRoundMatches : [];
    const curRound = Number(window._casterCurrentRound || selectedCasterRound || currentEventData.current_round || 1);
    gridEl.innerHTML = buildCasterRadarGridHtml(eventId, roundMatches, curRound, activeSessions);
    return;
  }
  if (currentEventData) renderEventCreatorHub(currentEventData);
}
window.handleCasterRadarSearch = handleCasterRadarSearch;

function buildCasterRadarGridHtml(eventId, roundMatches, curRound, activeSessions) {
  ensureEventSearchIndex();
  const totalTables = Array.isArray(roundMatches) ? roundMatches.length : 0;
  if (totalTables === 0) {
    return `
      <div class="card" style="grid-column:1 / -1; padding:1.75rem; text-align:center; color:var(--text-muted); background:rgba(15,23,42,0.5);">
        No pairings published yet for this round on BCP.
      </div>
    `;
  }

  const trackerTableSet = new Set((activeSessions || []).map(s => String(s.table_num || s.table_number || '').trim()).filter(Boolean));
  const cardsHtml = [];

  for (let idx = 0; idx < roundMatches.length; idx++) {
    const m = roundMatches[idx];
    if (!m) continue;
    const tNum = String(m.table ?? m.table_number ?? (idx + 1));
    const tNumInt = Number(m.table ?? m.table_number ?? (idx + 1)) || (idx + 1);
    const isDone = typeof isToHubMatchCompleted === 'function'
      ? isToHubMatchCompleted(m)
      : Boolean(m.is_bye || m.is_done || (m.player1_score !== null && m.player1_score !== undefined && m.player2_score !== null && m.player2_score !== undefined && (Number(m.player1_score) > 0 || Number(m.player2_score) > 0 || m.winner_id || m.is_draw)));
    const hasTracker = trackerTableSet.has(tNum) || Boolean(m.live_session_id || m.tracker_active);

    if (_casterRadarFilter === 'unfinished' && isDone) continue;
    if (_casterRadarFilter === 'completed' && !isDone) continue;
    if (_casterRadarSearch) {
      const tSearch = `table ${tNum} t${tNum}`;
      const mSearch = m._searchText || `${m.player1_name || ''} ${m.player2_name || ''} ${m.player1_faction || ''} ${m.player2_faction || ''}`.toLowerCase();
      if (!tSearch.includes(_casterRadarSearch) && !mSearch.includes(_casterRadarSearch)) continue;
    }

    const s1 = m.player1_score ?? m.score1 ?? '-';
    const s2 = m.player2_score ?? m.score2 ?? '-';
    const roundVal = Number(m.round || m.round_number || curRound || 1);
    const p1Rec = m._p1Record !== undefined ? m._p1Record : lookupEventPlayerFast(m.player1_id, m.player1_name);
    const p2Rec = m._p2Record !== undefined ? m._p2Record : lookupEventPlayerFast(m.player2_id, m.player2_name);
    const p1ListRaw = String(m.player1_list_id || (p1Rec && (p1Rec.list_id || p1Rec.listId)) || '');
    const p2ListRaw = String(m.player2_list_id || (p2Rec && (p2Rec.list_id || p2Rec.listId)) || '');
    const p1HasList = Boolean((p1Rec && hasPlayerSubmittedList(p1Rec)) || p1ListRaw);
    const p2NameRaw = String(m.player2_name || 'Player 2').trim();
    const isByeP2 = Boolean(m.is_bye || p2NameRaw.toUpperCase() === 'BYE');
    const p2HasList = Boolean(!isByeP2 && ((p2Rec && hasPlayerSubmittedList(p2Rec)) || p2ListRaw));

    const cardKey = `${eventId}:${roundVal}:${idx}:${tNum}:${isDone ? 1 : 0}:${hasTracker ? 1 : 0}:${s1}:${s2}:${p1HasList ? 1 : 0}:${p2HasList ? 1 : 0}:${p1ListRaw}:${p2ListRaw}`;
    if (m._cachedCasterRadarCardKey === cardKey && m._cachedCasterRadarCardHtml) {
      cardsHtml.push(m._cachedCasterRadarCardHtml);
      continue;
    }

    const matchId = m.tracker_match_id || `BCP-${eventId}-R${roundVal}-T${tNum}`;
    const safeMatchId = String(matchId).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const targetP1Id = String((p1Rec && (p1Rec.player_id || p1Rec.id)) || m.player1_id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const targetP1Name = String((p1Rec && (p1Rec.full_name || p1Rec.name)) || m.player1_name || 'Player 1').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const targetP2Id = String((p2Rec && (p2Rec.player_id || p2Rec.id)) || m.player2_id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const targetP2Name = String((p2Rec && (p2Rec.full_name || p2Rec.name)) || p2NameRaw).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const safeP1ListId = p1ListRaw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const safeP2ListId = p2ListRaw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    const p1FacDisplay = (p1Rec && p1Rec._displayFac) || formatEventPlayerFaction(m.player1_faction || p1Rec?.faction || '');
    const p2FacDisplay = isByeP2 ? 'BYE' : ((p2Rec && p2Rec._displayFac) || formatEventPlayerFaction(m.player2_faction || p2Rec?.faction || ''));

    const borderCol = isDone ? 'rgba(34,197,94,0.32)' : 'rgba(245,158,11,0.4)';
    const statusBadge = isDone
      ? `<span class="badge" style="background:rgba(34,197,94,0.16); color:#4ade80; border:1px solid rgba(34,197,94,0.35); font-size:0.66rem;">✅ FINAL</span>`
      : `<span class="badge" style="background:rgba(245,158,11,0.18); color:#fbbf24; border:1px solid rgba(245,158,11,0.38); font-size:0.66rem;">⏳ IN PROGRESS</span>`;

    const scorecardBtnHtml = !isByeP2
      ? `<button type="button" class="btn-xs btn-outline to-hub-scorecard-btn" onclick="event.stopPropagation(); openScorecardModal('${escapeHtml(safeMatchId)}')" title="View Table ${escapeHtml(tNum)} Scorecard" style="font-size:0.64rem; padding:2px 6px; border-radius:5px; color:#e2e8f0; border:1px solid rgba(255,255,255,0.18); background:rgba(255,255,255,0.06); cursor:pointer; font-weight:700; display:inline-flex; align-items:center; gap:3px; line-height:1.25;">📄 Scorecard</button>`
      : '';

    const p1RosterBtnHtml = `<button type="button" class="btn-xs btn-outline to-hub-roster-btn" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(targetP1Id)}', '${escapeHtml(targetP1Name)}', '${escapeHtml(safeP1ListId)}')" title="View ${escapeHtml(m.player1_name || 'Player 1')}'s Army Roster" style="font-size:0.62rem; padding:1px 5px; border-radius:4px; color:${p1HasList ? '#38bdf8' : '#94a3b8'}; border:1px solid ${p1HasList ? 'rgba(56,189,248,0.38)' : 'rgba(148,163,184,0.28)'}; background:${p1HasList ? 'rgba(56,189,248,0.1)' : 'rgba(255,255,255,0.04)'}; cursor:pointer; font-weight:600; display:inline-flex; align-items:center; gap:2px; line-height:1.25; flex-shrink:0;">📋 Roster</button>`;

    const p2RosterBtnHtml = !isByeP2
      ? `<button type="button" class="btn-xs btn-outline to-hub-roster-btn" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(targetP2Id)}', '${escapeHtml(targetP2Name)}', '${escapeHtml(safeP2ListId)}')" title="View ${escapeHtml(p2NameRaw)}'s Army Roster" style="font-size:0.62rem; padding:1px 5px; border-radius:4px; color:${p2HasList ? '#38bdf8' : '#94a3b8'}; border:1px solid ${p2HasList ? 'rgba(56,189,248,0.38)' : 'rgba(148,163,184,0.28)'}; background:${p2HasList ? 'rgba(56,189,248,0.1)' : 'rgba(255,255,255,0.04)'}; cursor:pointer; font-weight:600; display:inline-flex; align-items:center; gap:2px; line-height:1.25; flex-shrink:0;">📋 Roster</button>`
      : '';

    const cardHtml = `
      <div class="card to-hub-table-card" onclick="openCasterDeskTableModal(${tNumInt}, ${roundVal})" title="Click to open Table ${escapeHtml(tNum)} Caster Desk Matchup & Dossiers" style="padding:0.75rem 0.9rem; background:rgba(15,23,42,0.82); border:1px solid ${borderCol}; border-radius:10px; display:flex; flex-direction:column; gap:0.45rem; cursor:pointer; transition:transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.35rem; flex-wrap:wrap;">
          <span style="font-family:var(--font-mono); font-weight:800; font-size:0.84rem; color:#f8fafc; display:inline-flex; align-items:center; gap:0.35rem;">
            Table ${escapeHtml(tNum)}
            <span class="to-hub-table-comms-hint" style="font-size:0.68rem; color:#c084fc; font-weight:700; opacity:0.9;">🎙️</span>
          </span>
          <div style="display:flex; align-items:center; gap:0.3rem; flex-wrap:wrap;">
            ${scorecardBtnHtml}
            ${hasTracker ? `<span class="badge" style="background:rgba(56,189,248,0.16); color:#38bdf8; font-size:0.64rem;">📱 Tracker</span>` : ''}
            ${statusBadge}
          </div>
        </div>
        <div class="to-hub-player-click-row" onclick="event.stopPropagation(); openCasterDeskTableModal(${tNumInt}, ${roundVal})" title="Open Table ${escapeHtml(tNum)} Caster Desk Matchup & Dossiers" style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; font-size:0.82rem; padding:0.2rem 0.35rem; margin:0 -0.35rem; border-radius:6px;">
          <div style="min-width:0; flex:1;">
            <div style="font-weight:700; color:#e2e8f0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:0.3rem;">
              <span style="overflow:hidden; text-overflow:ellipsis;">${escapeHtml(m.player1_name || 'Player 1')}</span>
            </div>
            <div style="display:flex; align-items:center; gap:0.35rem; margin-top:2px; min-width:0;">
              <span style="font-size:0.7rem; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(p1FacDisplay)}</span>
              ${p1RosterBtnHtml}
            </div>
          </div>
          <span onclick="event.stopPropagation(); ${!isByeP2 ? `openScorecardModal('${escapeHtml(safeMatchId)}')` : ''}" title="${!isByeP2 ? `View Table ${escapeHtml(tNum)} Scorecard` : ''}" style="font-family:var(--font-mono); font-weight:800; font-size:0.92rem; color:${isDone ? '#4ade80' : '#94a3b8'}; padding:2px 4px; border-radius:4px;">${escapeHtml(String(s1))}</span>
        </div>
        <div class="to-hub-player-click-row" onclick="event.stopPropagation(); openCasterDeskTableModal(${tNumInt}, ${roundVal})" title="Open Table ${escapeHtml(tNum)} Caster Desk Matchup & Dossiers" style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; font-size:0.82rem; padding:0.3rem 0.35rem 0.2rem; margin:0 -0.35rem; border-top:1px solid rgba(255,255,255,0.06); border-radius:0 0 6px 6px;">
          <div style="min-width:0; flex:1;">
            <div style="font-weight:700; color:#e2e8f0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:0.3rem;">
              <span style="overflow:hidden; text-overflow:ellipsis;">${escapeHtml(p2NameRaw)}</span>
            </div>
            <div style="display:flex; align-items:center; gap:0.35rem; margin-top:2px; min-width:0;">
              <span style="font-size:0.7rem; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(p2FacDisplay)}</span>
              ${p2RosterBtnHtml}
            </div>
          </div>
          <span onclick="event.stopPropagation(); ${!isByeP2 ? `openScorecardModal('${escapeHtml(safeMatchId)}')` : ''}" title="${!isByeP2 ? `View Table ${escapeHtml(tNum)} Scorecard` : ''}" style="font-family:var(--font-mono); font-weight:800; font-size:0.92rem; color:${isDone ? '#38bdf8' : '#94a3b8'}; padding:2px 4px; border-radius:4px;">${escapeHtml(String(s2))}</span>
        </div>
      </div>
    `;
    m._cachedCasterRadarCardKey = cardKey;
    m._cachedCasterRadarCardHtml = cardHtml;
    cardsHtml.push(cardHtml);
  }

  if (cardsHtml.length === 0) {
    return `
      <div class="card" style="grid-column:1 / -1; padding:1.75rem; text-align:center; color:var(--text-muted); background:rgba(15,23,42,0.5);">
        No tables match the selected filter.
      </div>
    `;
  }
  return cardsHtml.join('');
}

function buildCasterTableDetailsHtml(ev, players, matches, selectedMatch, p1, p2, p1Elo, p2Elo, p1WinProb, p2WinProb, curRound, maxR, isModal = true, matchIdx = null) {
  const eventId = ev?.id || currentOpenEventId || currentEventData?.id || '';
  const rawTableNum = Number(selectedMatch?.table_number ?? selectedMatch?.table ?? 0);
  const activeTableNum = rawTableNum > 0 ? rawTableNum : Number(selectedCasterTable || (matchIdx !== null && matchIdx >= 0 ? matchIdx + 1 : 1));
  const activeMatchId = selectedMatch?.tracker_match_id || `BCP-${eventId}-R${curRound}-T${activeTableNum}`;
  const curRoundMeta = getEventRoundMetadata(ev, matches, curRound, maxR);
  const canTo = Boolean(typeof canUserAccessEventToHub === 'function' && canUserAccessEventToHub(ev));
  const isCC = Boolean(typeof isUserCC === 'function' ? isUserCC(currentUser) : (currentUser && (currentUser.role === 'admin' || currentUser.role === 'cc' || currentUser.role === 'creator' || currentUser.can_access_cc || currentUser.is_cc || currentUser.is_admin)));

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

  const p1Units = extractKeyListUnits(p1RosterText || p1?.army_list, p1?.faction, p1?.detachment);
  const p2Units = extractKeyListUnits(p2RosterText || p2?.army_list, p2?.faction, p2?.detachment);

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
  const fac3MoMetrics = computeCasterFaction3MoMetrics(fac1, fac2, matches, sysH2h);
  const isFac3MoLoading = (!fac3MoMetrics.hasLoadedF1 || !fac3MoMetrics.hasLoadedF2) && Boolean(window.api && typeof window.api.getFactionDetails === 'function');
  let facMatchupText = '';
  if (!fac3MoMetrics.isMirror && fac3MoMetrics.h2hTotal > 0) {
    const wr = Math.round((fac3MoMetrics.h2hF1Wins / fac3MoMetrics.h2hTotal) * 100);
    facMatchupText = `${escapeHtml(fac3MoMetrics.fac1)} ${wr}% WR vs ${escapeHtml(fac3MoMetrics.fac2)} (${fac3MoMetrics.h2hF1Wins}W-${fac3MoMetrics.h2hF2Wins}L${fac3MoMetrics.h2hDraws > 0 ? `-${fac3MoMetrics.h2hDraws}D` : ''}, Past 3 Mo)`;
  } else if (!fac3MoMetrics.isMirror && fac3MoMetrics.evTotal > 0) {
    const wr = Math.round((fac3MoMetrics.evF1Wins / fac3MoMetrics.evTotal) * 100);
    facMatchupText = `${escapeHtml(fac3MoMetrics.fac1)} has a ${wr}% win rate vs ${escapeHtml(fac3MoMetrics.fac2)} in this event (${fac3MoMetrics.evF1Wins}-${fac3MoMetrics.evF2Wins})`;
  } else if (!fac3MoMetrics.isMirror) {
    facMatchupText = `${escapeHtml(fac3MoMetrics.fac1)} vs ${escapeHtml(fac3MoMetrics.fac2)} Matchup`;
  } else {
    facMatchupText = `${escapeHtml(fac3MoMetrics.fac1)} Mirror Match`;
  }

  // Dynamic Elo stakes
  const expectedP1 = 1 / (1 + Math.pow(10, (p2Elo - p1Elo) / 400));
  const p1GainOnWin = Math.round(32 * (1 - expectedP1));
  const p2GainOnWin = Math.round(32 * expectedP1);

  const hasScore = selectedMatch?.player1_score !== null && selectedMatch?.player1_score !== undefined && selectedMatch?.player2_score !== null && selectedMatch?.player2_score !== undefined;
  const scoreDisplay = hasScore ? `${selectedMatch.player1_score} - ${selectedMatch.player2_score}` : 'Live in Progress';

  const buildPlayerDossierCard = (side, playerObj, opponentObj, pid, safePid, pname, safeName, listId, safeListId, hasList, rosterText, units, eloVal, gainOnWin, accentColor, borderAccent) => {
    const sys = (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k');
    const cacheKey = `${sys}:${pid || pname.toLowerCase()}`;
    const cachedProfile = casterPlayerProfileCache[cacheKey] || null;
    const masteryHtml = buildCasterFactionMasteryHtml(playerObj, opponentObj, cachedProfile, accentColor, matches);

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
      const mId = m.tracker_match_id || `BCP-${eventId}-R${rNum}-T${tNum}`;
      const mHasScore = mySc !== null && mySc !== undefined && opSc !== null && opSc !== undefined;
      let resPill = `<span class="badge" style="background:rgba(148,163,184,0.15); color:#94a3b8; font-size:0.66rem; white-space:nowrap; flex-shrink:0;">LIVE</span>`;
      if (m.is_bye || opName === 'BYE') {
        resPill = `<span class="badge badge-win" style="font-size:0.66rem; white-space:nowrap; flex-shrink:0;">BYE</span>`;
      } else if (mHasScore) {
        if (Number(mySc) > Number(opSc)) resPill = `<span class="badge badge-win" style="font-size:0.66rem; white-space:nowrap; flex-shrink:0;">W ${mySc}-${opSc}</span>`;
        else if (Number(mySc) < Number(opSc)) resPill = `<span class="badge badge-loss" style="font-size:0.66rem; white-space:nowrap; flex-shrink:0;">L ${mySc}-${opSc}</span>`;
        else resPill = `<span class="badge badge-draw" style="font-size:0.66rem; white-space:nowrap; flex-shrink:0;">D ${mySc}-${opSc}</span>`;
      }
      return `
        <div class="caster-path-row" style="display: flex; align-items: center; justify-content: space-between; gap: 0.45rem; padding: 0.4rem 0.55rem; background: rgba(0,0,0,0.22); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; font-size: 0.75rem;">
          <div style="display: flex; align-items: center; gap: 0.4rem; min-width: 0; flex: 1;">
            <span style="font-family: var(--font-mono); font-weight: 800; color: ${rMeta.isShadowRound || rMeta.isTopCut ? rMeta.badgeColor : '#94a3b8'}; min-width: 28px; flex-shrink: 0;" title="${escapeHtml(rMeta.fullLabel)}">R${rNum}${rMeta.isShadowRound ? '🌑' : (rMeta.isTopCut ? '🏆' : '')}</span>
            ${resPill}
            <div style="min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px;">
              <div style="display: flex; align-items: center; gap: 0.3rem; min-width: 0;">
                <span style="color: var(--text-muted); font-size: 0.68rem; flex-shrink: 0;">vs</span>
                ${(!m.is_bye && opName !== 'BYE') ? `
                  <span class="player-link" onclick="event.stopPropagation(); openPlayerModal('${escapeHtml(safeOpPid)}', '${escapeHtml(safeOpName)}')" style="font-weight: 700; color: #e2e8f0; cursor: pointer; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="View ${escapeHtml(opName)} Quick Profile">${escapeHtml(opName)}</span>
                ` : `<span style="color: var(--text-muted);">BYE</span>`}
              </div>
              ${opFac ? `<div style="color: var(--text-muted); font-size: 0.66rem; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">🛡️ ${escapeHtml(opFac)}</div>` : ''}
            </div>
          </div>
          <button type="button" class="btn-xs btn-outline" onclick="event.stopPropagation(); openScorecardModal('${escapeHtml(mId)}')" style="font-size: 0.68rem; padding: 2px 6px; border-radius: 4px; color: #38bdf8; border-color: rgba(56,189,248,0.3); background: rgba(56,189,248,0.06); cursor: pointer; flex-shrink: 0;" title="View Round ${rNum} Table ${tNum} Game Scorecard">
            📄 Scorecard
          </button>
        </div>
      `;
    }).join('');

    return `
      <div class="caster-dossier-player-card" style="background: rgba(15, 23, 42, 0.78); border: 1px solid ${borderAccent}; border-radius: 10px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; min-width: 0;">
        <!-- Dossier Header -->
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.65rem; flex-wrap: wrap;">
          <div style="min-width: 0; flex: 1;">
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

        <!-- Tournament Run & Round-by-Round Scorecards -->
        <div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem; flex-wrap: wrap; gap: 0.25rem;">
            <span style="font-size: 0.73rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.04em;">
              ⚔️ Tournament Path (${playerObj?.event_wins || 0}W-${playerObj?.event_losses || 0}L • ${playerObj?.event_battle_points || 0} Battle Pts)
            </span>
            <span style="font-size: 0.7rem; font-family: var(--font-mono); color: #4ade80;">Win Stakes: +${gainOnWin} Elo</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.3rem; max-height: 220px; overflow-y: auto;">
            ${pathRowsHtml || '<div style="font-size:0.75rem; color:var(--text-muted);">No matches recorded yet.</div>'}
          </div>
        </div>
      </div>
    `;
  };

  return `
    <div class="caster-table-details-stack" style="display: flex; flex-direction: column; gap: 1rem;">
      <!-- TALE OF THE TAPE FIGHTER CARD -->
      <div class="caster-table-section-card" style="background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(168, 85, 247, 0.38); border-radius: 12px; padding: 1.2rem; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.9rem; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.65rem; gap: 0.5rem;">
          <div style="font-size: 0.95rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; min-width: 0; flex: 1;">
            <span>⚔️ Table ${activeTableNum} Headline Clash</span>
            <span class="badge" style="background: ${curRoundMeta.badgeBg}; color: ${curRoundMeta.badgeColor}; border: 1px solid ${curRoundMeta.badgeBorder}; font-size: 0.7rem; padding: 2px 8px;">
              ${escapeHtml(curRoundMeta.badgeText)}
            </span>
          </div>
          ${isModal ? `
            <button type="button" onclick="closeCasterDeskTableModal()" title="Close Table Details" style="background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.16); color:#f8fafc; border-radius:8px; width:30px; height:30px; cursor:pointer; font-size:0.9rem; line-height:1; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;">
              ✕
            </button>
          ` : ''}
        </div>

        <div class="tale-of-tape-grid">
          <!-- Player 1 Card (Blue/Cyan) -->
          <div class="fighter-card p1">
            <div class="fighter-top-row">
              <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-size: 0.72rem; font-weight: 700;">PLAYER 1</span>
              <span style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 800; color: #38bdf8;">${p1Elo.toFixed(1)} Elo</span>
            </div>
            <div class="fighter-name">
              <span class="player-link" onclick="openPlayerModal('${escapeHtml(p1SafePid)}', '${escapeHtml(p1SafeName)}')" style="cursor: pointer; color: #fff; text-decoration: underline; text-decoration-color: rgba(56,189,248,0.6); text-underline-offset: 3px;" title="Click to view ${escapeHtml(p1Name)}'s Quick Profile">
                ${escapeHtml(p1Name)}
              </span>
            </div>
            <div class="fighter-badges">
              <span class="badge" style="background: rgba(255,255,255,0.06); color: #e2e8f0; font-size: 0.74rem;">🛡️ ${escapeHtml(p1?.faction || 'Faction')}</span>
              <span class="badge" style="background: rgba(56,189,248,0.1); color: #7dd3fc; font-size: 0.74rem;">${escapeHtml(p1?.detachment || 'Standard Detachment')}</span>
              ${p1?.team ? `<span class="badge" style="background: rgba(255,255,255,0.04); color: var(--text-muted); font-size: 0.72rem;">👥 ${escapeHtml(p1.team)}</span>` : ''}
            </div>
            <div class="fighter-stats-box">
              <div><strong>Event Record:</strong> ${p1?.event_wins || 0}W - ${p1?.event_losses || 0}L (${p1?.event_battle_points || 0} pts)</div>
              <div id="caster-fighter-units-row-p1" style="display: ${p1Units.length > 0 ? 'block' : 'none'};"><strong>Core Units:</strong> <span id="caster-fighter-units-p1">${escapeHtml(p1Units.slice(0, 4).join(', '))}</span></div>
            </div>
            <div class="fighter-actions">
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
            <div class="win-prob-header-row">
              <span class="win-prob-pct p1" style="color: #38bdf8;">${p1WinProb}%</span>
              <span class="win-prob-label">Win Probability</span>
              <span class="win-prob-pct p2" style="color: #f43f5e;">${p2WinProb}%</span>
            </div>
            <div class="win-prob-track">
              <div class="win-prob-fill-p1" style="width: ${p1WinProb}%;"></div>
            </div>
            <div class="win-prob-footer-row">
              <span style="font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono);">
                ${Math.abs(p1Elo - p2Elo).toFixed(1)} Elo Delta
              </span>
              <button type="button" class="btn-xs btn-outline" onclick="openScorecardModal('${escapeHtml(activeMatchId)}')" style="font-size: 0.71rem; padding: 3px 9px; border-radius: 5px; color: #fbbf24; border-color: rgba(245,158,11,0.4); background: rgba(245,158,11,0.1); cursor: pointer; font-weight: 700;">
                📄 View Scorecard
              </button>
            </div>
          </div>

          <!-- Player 2 Card (Pink/Red) -->
          <div class="fighter-card p2">
            <div class="fighter-top-row">
              <span class="badge" style="background: rgba(244, 63, 94, 0.15); color: #f43f5e; font-size: 0.72rem; font-weight: 700;">PLAYER 2</span>
              <span style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 800; color: #f43f5e;">${p2Elo.toFixed(1)} Elo</span>
            </div>
            <div class="fighter-name">
              <span class="player-link" onclick="openPlayerModal('${escapeHtml(p2SafePid)}', '${escapeHtml(p2SafeName)}')" style="cursor: pointer; color: #fff; text-decoration: underline; text-decoration-color: rgba(244,63,94,0.6); text-underline-offset: 3px;" title="Click to view ${escapeHtml(p2Name)}'s Quick Profile">
                ${escapeHtml(p2Name)}
              </span>
            </div>
            <div class="fighter-badges">
              <span class="badge" style="background: rgba(255,255,255,0.06); color: #e2e8f0; font-size: 0.74rem;">🛡️ ${escapeHtml(p2?.faction || 'Faction')}</span>
              <span class="badge" style="background: rgba(244,63,94,0.1); color: #fda4af; font-size: 0.74rem;">${escapeHtml(p2?.detachment || 'Standard Detachment')}</span>
              ${p2?.team ? `<span class="badge" style="background: rgba(255,255,255,0.04); color: var(--text-muted); font-size: 0.72rem;">👥 ${escapeHtml(p2.team)}</span>` : ''}
            </div>
            <div class="fighter-stats-box">
              <div><strong>Event Record:</strong> ${p2?.event_wins || 0}W - ${p2?.event_losses || 0}L (${p2?.event_battle_points || 0} pts)</div>
              <div id="caster-fighter-units-row-p2" style="display: ${p2Units.length > 0 ? 'block' : 'none'};"><strong>Core Units:</strong> <span id="caster-fighter-units-p2">${escapeHtml(p2Units.slice(0, 4).join(', '))}</span></div>
            </div>
            <div class="fighter-actions">
              <button type="button" class="btn-xs btn-outline" onclick="openPlayerModal('${escapeHtml(p2SafePid)}', '${escapeHtml(p2SafeName)}')" style="font-size: 0.72rem; padding: 3px 9px; border-radius: 5px; color: #f43f5e; border-color: rgba(244,63,94,0.35); background: rgba(244,63,94,0.08); cursor: pointer; font-weight: 700;">
                👤 Quick Profile
              </button>
              <button type="button" class="btn-xs btn-outline" onclick="openEventPlayerListModal('${escapeHtml(p2SafePid || p2SafeName)}', '${escapeHtml(p2SafeListId)}')" style="font-size: 0.72rem; padding: 3px 9px; border-radius: 5px; color: #e2e8f0; border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.06); cursor: pointer; font-weight: 700;">
                📋 View Roster
              </button>
            </div>
          </div>
        </div>

        <!-- Matchup Context & History Sub-strip -->
        <div class="caster-matchup-context-strip" style="margin-top: 1rem; padding-top: 0.85rem; border-top: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-around; flex-wrap: wrap; gap: 0.75rem; font-size: 0.8rem; color: var(--text-secondary);">
          <div id="caster-h2h-summary" class="caster-context-item">⚔️ <strong>Past Head-to-Head:</strong> ${h2hText}</div>
          <div id="caster-fac-matchup-summary" class="caster-context-item">📊 <strong>Faction Matchup:</strong> ${facMatchupText}</div>
          <div class="caster-context-item caster-context-score-row" style="display: flex; align-items: center; gap: 0.5rem;">
            <span>🏆 <strong>Table Score:</strong> <span style="font-family:var(--font-mono); font-weight:800; color:#fff;">${scoreDisplay}</span></span>
            <button type="button" class="btn-xs btn-outline" onclick="openScorecardModal('${escapeHtml(activeMatchId)}')" style="font-size: 0.7rem; padding: 2px 7px; border-radius: 4px; color: #38bdf8; border-color: rgba(56,189,248,0.35); cursor: pointer;">
              📄 Scorecard
            </button>
          </div>
        </div>
      </div>

      <!-- PAST HEAD-TO-HEAD ENCOUNTERS CARD -->
      <div id="caster-past-h2h-container">${buildCasterPastH2hCardHtml(pastH2hMatches, p1Pid, p2Pid, p1Name, p2Name, isH2hLoading)}</div>

      <!-- GLOBAL FACTION MATCHUP (PAST 3 MONTHS) CARD -->
      <div id="caster-faction-3mo-container">${buildCasterFaction3MoMatchupCardHtml(fac1, fac2, matches, sysH2h, isFac3MoLoading)}</div>

      <!-- SIDE-BY-SIDE COMMANDER DOSSIERS: FACTION MASTERY, ROSTERS & TOURNAMENT PATH -->
      <div class="caster-table-section-card" style="background: rgba(15, 23, 42, 0.78); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 1.15rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <h4 style="margin: 0; font-size: 0.98rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.45rem;">
              <span>🎖️ Commander Dossiers: Faction Mastery, Army Rosters & Match History</span>
            </h4>
            <div style="font-size: 0.76rem; color: var(--text-secondary); margin-top: 2px;">
              Click either player's name for their full Quick Profile, inspect their submitted army list, or open any round's Game Scorecard.
            </div>
          </div>
          <button type="button" onclick="closeCasterDeskTableModal(); switchEventModalTab('meta');" class="btn-sm btn-outline" style="font-size: 0.74rem; padding: 4px 10px; cursor: pointer; color: #38bdf8; border-color: rgba(56,189,248,0.35);">
            🧬 Force Disposition Power Grid ➔
          </button>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 310px), 1fr)); gap: 1rem;">
          ${buildPlayerDossierCard('p1', p1Info?.record || p1, p2Info?.record || p2, p1Pid, p1SafePid, p1Name, p1SafeName, p1ListId, p1SafeListId, p1HasList, p1RosterText, p1Units, p1Elo, p1GainOnWin, '#38bdf8', 'rgba(56, 189, 248, 0.35)')}
          ${buildPlayerDossierCard('p2', p2Info?.record || p2, p1Info?.record || p1, p2Pid, p2SafePid, p2Name, p2SafeName, p2ListId, p2SafeListId, p2HasList, p2RosterText, p2Units, p2Elo, p2GainOnWin, '#f43f5e', 'rgba(244, 63, 94, 0.35)')}
        </div>
      </div>
    </div>
  `;
}

function closeCasterDeskTableModal() {
  const modal = document.getElementById('caster-desk-table-modal');
  if (typeof closeModal === 'function') {
    closeModal('caster-desk-table-modal');
  }
  if (modal) {
    modal.remove();
  }
}
window.closeCasterDeskTableModal = closeCasterDeskTableModal;

function openCasterDeskTableModal(tableNum, roundNum, matchIdx = null) {
  const ev = currentEventData || {};
  const players = Array.isArray(eventPlayersCache) && eventPlayersCache.length > 0 ? eventPlayersCache : (ev.players || []);
  const matches = Array.isArray(eventMatchesCache) && eventMatchesCache.length > 0 ? eventMatchesCache : (ev.matches || []);
  const curRound = Number(roundNum || selectedCasterRound || ev.current_round || 1);
  const tNum = Number(tableNum || selectedCasterTable || 1);

  selectedCasterTable = tNum;
  selectedCasterRound = curRound;
  const isCC = Boolean(typeof isUserCC === 'function' ? isUserCC(currentUser) : (currentUser && (currentUser.role === 'admin' || currentUser.role === 'cc' || currentUser.role === 'creator' || currentUser.can_access_cc || currentUser.is_cc || currentUser.is_admin)));
  if (isCC && typeof syncActiveStreamToCasterDesk === 'function') {
    syncActiveStreamToCasterDesk(tNum, curRound, true);
  }

  const roundMatches = matches.filter(m => Number(m.round || m.round_number || 1) === curRound);
  const toHubMatches = Array.isArray(window._toHubCurrentRoundMatches) ? window._toHubCurrentRoundMatches : roundMatches;
  let selectedMatch = null;
  let resolvedMatchIdx = (matchIdx !== null && matchIdx !== undefined && !isNaN(Number(matchIdx))) ? Number(matchIdx) : -1;
  if (resolvedMatchIdx >= 0 && toHubMatches[resolvedMatchIdx]) {
    selectedMatch = toHubMatches[resolvedMatchIdx];
  } else {
    selectedMatch = roundMatches.find(m => Number(m.table_number || m.table) === tNum) || roundMatches[0];
    if (selectedMatch) {
      resolvedMatchIdx = toHubMatches.indexOf(selectedMatch);
    }
  }
  if (!selectedMatch) {
    if (typeof showToast === 'function') showToast('Could not load table details', 'warning');
    return;
  }

  ensureEventSearchIndex();
  const p1 = lookupEventPlayerFast(selectedMatch.player1_id, selectedMatch.player1_name) || {
    player_id: selectedMatch.player1_id || '',
    full_name: selectedMatch.player1_name || 'Player 1',
    faction: selectedMatch.player1_faction || 'Army',
    detachment: 'Standard',
    list_id: selectedMatch.player1_list_id || '',
    current_elo: selectedMatch.player1_elo || 1500
  };
  const p2 = lookupEventPlayerFast(selectedMatch.player2_id, selectedMatch.player2_name) || {
    player_id: selectedMatch.player2_id || '',
    full_name: selectedMatch.player2_name || 'Player 2',
    faction: selectedMatch.player2_faction || 'Army',
    detachment: 'Standard',
    list_id: selectedMatch.player2_list_id || '',
    current_elo: selectedMatch.player2_elo || 1500
  };

  const p1Elo = Number(selectedMatch.player1_elo || p1.current_elo || 1500);
  const p2Elo = Number(selectedMatch.player2_elo || p2.current_elo || 1500);
  const eloDiff = p2Elo - p1Elo;
  const p1WinProb = Math.min(95, Math.max(5, Math.round(100 / (1 + Math.pow(10, eloDiff / 400)))));
  const p2WinProb = 100 - p1WinProb;

  let rawJson = (ev && ev.raw_json) || {};
  if (typeof rawJson === 'string') {
    try { rawJson = JSON.parse(rawJson); } catch (e) { rawJson = {}; }
  }
  const matchRounds = [...new Set(matches.map(m => Number(m.round)).filter(r => r > 0))].sort((a, b) => a - b);
  const resolvedNumRounds = Number(ev.num_rounds || ev.numberOfRounds || ev.rounds_count || ev.rounds || ev.total_rounds || rawJson.numberOfRounds || rawJson.numRounds || 0);
  const maxR = Math.max(resolvedNumRounds, matchRounds.length > 0 ? Math.max(...matchRounds) : 1, Number(ev.current_round || 0), 1);

  let modal = document.getElementById('caster-desk-table-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'caster-desk-table-modal';
    modal.className = 'modal-backdrop caster-desk-table-modal-backdrop';
    modal.style.cssText = 'position:fixed; inset:0; background:rgba(2,6,23,0.84); backdrop-filter:blur(6px); display:flex; align-items:center; justify-content:center; padding:1rem; box-sizing:border-box;';
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeCasterDeskTableModal();
    });
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="card caster-desk-table-modal-card" style="width:100%; max-width:1080px; background:linear-gradient(165deg, rgba(15,23,42,0.98), rgba(9,14,28,0.99)); border:1px solid rgba(168,85,247,0.45); border-radius:14px; padding:1.15rem 1.25rem; box-shadow:0 24px 60px rgba(0,0,0,0.8); color:#f8fafc; max-height:92vh; overflow-y:auto;">
      ${buildCasterTableDetailsHtml(ev, players, matches, selectedMatch, p1, p2, p1Elo, p2Elo, p1WinProb, p2WinProb, curRound, maxR, true, resolvedMatchIdx)}
    </div>
  `;

  if (typeof bringModalToFront === 'function') {
    bringModalToFront(modal);
  } else {
    modal.style.display = 'flex';
    modal.classList.add('active');
  }

  setTimeout(() => {
    hydrateCasterDossiersAsync(ev, p1, p2, selectedMatch);
  }, 0);
}
window.openCasterDeskTableModal = openCasterDeskTableModal;

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
    return `
      <button type="button" class="btn ${isSel ? 'btn-primary' : 'btn-outline'}" onclick="setCasterRadarRound(${r})" title="${escapeHtml(rMeta.fullLabel)} (${rMeta.matchCount} tables)" style="font-size:0.76rem; font-weight:700; padding:0.32rem 0.7rem;">
        Round ${r}
      </button>
    `;
  }).join('');

  // Case A: Real pairings exist for curRound -> Render TO Hub-style Table Radar Grid!
  if (roundMatches && roundMatches.length > 0) {
    const eventId = String(ev?.id || currentOpenEventId || currentEventData?.id || '');
    window._casterCurrentRoundMatches = roundMatches;
    window._casterCurrentRound = curRound;

    const totalTables = roundMatches.length;
    let doneCount = 0;
    for (let i = 0; i < totalTables; i++) {
      const m = roundMatches[i];
      if (!m) continue;
      const isDone = typeof isToHubMatchCompleted === 'function'
        ? isToHubMatchCompleted(m)
        : Boolean(m.is_bye || m.is_done || (m.player1_score !== null && m.player1_score !== undefined && m.player2_score !== null && m.player2_score !== undefined && (Number(m.player1_score) > 0 || Number(m.player2_score) > 0 || m.winner_id || m.is_draw)));
      if (isDone) doneCount++;
    }
    const unfinishedCount = totalTables - doneCount;
    const pct = totalTables > 0 ? Math.round((doneCount / totalTables) * 100) : 0;

    const state = _eventToHubStateCache.get(eventId) || {};
    const activeSessions = Array.isArray(state.active_sessions) ? state.active_sessions : [];
    const tablesGridHtml = buildCasterRadarGridHtml(eventId, roundMatches, curRound, activeSessions);

    return `
      <div>
        <!-- Round Selector & Completion Progress -->
        <div class="card" style="padding:0.85rem 1.05rem; background:rgba(15,23,42,0.8); border:1px solid rgba(255,255,255,0.08); border-radius:10px; margin-bottom:0.85rem;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:0.75rem; flex-wrap:wrap; margin-bottom:0.6rem;">
            <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
              ${roundButtonsHtml}
            </div>
            <div style="display:flex; align-items:center; gap:0.45rem; font-size:0.8rem; font-weight:800; font-family:var(--font-mono);">
              <span style="padding:0.22rem 0.55rem; border-radius:6px; background:rgba(34,197,94,0.14); border:1px solid rgba(34,197,94,0.35); color:#4ade80;">
                ✅ ${doneCount} Finished
              </span>
              <span style="padding:0.22rem 0.55rem; border-radius:6px; background:rgba(245,158,11,0.16); border:1px solid rgba(245,158,11,0.38); color:#fbbf24;">
                ⏳ ${unfinishedCount} Unfinished
              </span>
              <span style="color:var(--text-muted); font-size:0.76rem;">(${pct}%)</span>
            </div>
          </div>
          <div style="width:100%; height:8px; background:rgba(255,255,255,0.08); border-radius:999px; overflow:hidden;">
            <div style="width:${pct}%; height:100%; background:linear-gradient(90deg, #38bdf8, #4ade80); transition:width 0.3s ease;"></div>
          </div>
        </div>

        <!-- Filter Pills & Search -->
        <div class="to-hub-radar-toolbar" style="display:flex; align-items:center; justify-content:space-between; gap:0.65rem; flex-wrap:wrap; margin-bottom:0.85rem;">
          <div class="to-hub-filter-pills" style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
            <button type="button" class="btn ${_casterRadarFilter === 'all' ? 'btn-primary' : 'btn-outline'}" onclick="setCasterRadarFilter('all')" style="font-size:0.74rem; padding:0.3rem 0.65rem;">
              All (${totalTables})
            </button>
            <button type="button" class="btn ${_casterRadarFilter === 'unfinished' ? 'btn-primary' : 'btn-outline'}" onclick="setCasterRadarFilter('unfinished')" style="font-size:0.74rem; padding:0.3rem 0.65rem;">
              ⏳ Unfinished (${unfinishedCount})
            </button>
            <button type="button" class="btn ${_casterRadarFilter === 'completed' ? 'btn-primary' : 'btn-outline'}" onclick="setCasterRadarFilter('completed')" style="font-size:0.74rem; padding:0.3rem 0.65rem;">
              ✅ Completed (${doneCount})
            </button>
          </div>
          <input id="caster-radar-search-input" class="to-hub-radar-search-input" type="text" placeholder="Search table # or player..." value="${escapeHtml(_casterRadarSearch)}" oninput="handleCasterRadarSearch(this.value)" style="padding:0.38rem 0.75rem; border-radius:8px; border:1px solid rgba(255,255,255,0.14); background:rgba(15,23,42,0.85); color:#fff; font-size:0.8rem; min-width:210px; box-sizing:border-box;" />
        </div>

        <!-- Table Radar Grid -->
        <div id="caster-radar-grid" class="to-hub-radar-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(250px, 1fr)); gap:0.7rem;">
          ${tablesGridHtml}
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
        <button type="button" onclick="setCasterRadarRound(${latestRound})" class="btn btn-primary" style="font-size: 0.84rem; font-weight: 700; padding: 0.5rem 1.25rem;">
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
    const units = extractKeyListUnits(p.army_list, p.faction, p.detachment);
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
  const curTable = (activeStream && activeStream.tableNumber !== undefined && activeStream.tableNumber !== null && !isNaN(Number(activeStream.tableNumber)))
    ? Number(activeStream.tableNumber)
    : ((selectedCasterTable !== undefined && selectedCasterTable !== null && !isNaN(Number(selectedCasterTable))) ? Number(selectedCasterTable) : 1);
  selectedCasterTable = curTable;
  const overlayData = resolveStreamTableMatchData(ev, players, matches, curTable, curRound);
  const effectiveRound = overlayData.roundNum || curRound;

  if (activeStream) {
    activeStream.roundNumber = effectiveRound;
    activeStream.round_number = effectiveRound;
    if (!activeStream.title || /Table\s+\d+\s+Coverage|Main\s+Desk/i.test(activeStream.title)) {
      const ch = activeStream.channel || 'Live';
      activeStream.title = curTable === 0 ? `${ch} - Main Desk Coverage` : `${ch} - Table ${curTable} Coverage`;
    }
  }

  const playersCount = Number(ev.players_count || ev.registered_players_count || (players ? players.length : 0)) || 0;
  const matchTables = Array.from(new Set((matches || []).map(m => Number(m.table_number || m.table)).filter(n => !isNaN(n) && n > 0))).sort((a, b) => a - b);
  const maxMatchTable = matchTables.length > 0 ? Math.max(...matchTables) : 0;
  const estTablesFromPlayers = Math.ceil(playersCount / 2);
  const totalTables = Math.max(maxMatchTable, estTablesFromPlayers, 8);

  const curRoundMatches = (matches || []).filter(m => Number(m.round || 1) === Number(effectiveRound));
  const curRoundTableMap = new Map();
  curRoundMatches.forEach(m => {
    const t = Number(m.table_number || m.table);
    if (t) curRoundTableMap.set(t, m);
  });

  const isCustomTable = curTable > totalTables;
  const occupiedTables = new Set((eventLiveStreams || []).map(s => Number(s.tableNumber)));
  let defaultNewStreamTable = 1;
  for (let t = 1; t <= totalTables; t++) {
    if (!occupiedTables.has(t)) {
      defaultNewStreamTable = t;
      break;
    }
  }

  const buildTableOpts = (selectedTbl, isCust) => {
    const opts = [];
    const t1Match = curRoundTableMap.get(1);
    const t1Desc = t1Match ? ` — ${escapeHtml((t1Match.player1_name || 'P1').split(' ')[0])} vs ${escapeHtml((t1Match.player2_name || 'P2').split(' ')[0])}` : '';
    opts.push(`<option value="1" ${selectedTbl === 1 ? 'selected' : ''}>Table 1 (Feature Table)${t1Desc}</option>`);

    for (let t = 2; t <= totalTables; t++) {
      const tm = curRoundTableMap.get(t);
      const mDesc = tm ? ` — ${escapeHtml((tm.player1_name || 'P1').split(' ')[0])} vs ${escapeHtml((tm.player2_name || 'P2').split(' ')[0])}` : '';
      opts.push(`<option value="${t}" ${selectedTbl === t ? 'selected' : ''}>Table ${t}${mDesc}</option>`);
    }
    opts.push(`<option value="0" ${selectedTbl === 0 ? 'selected' : ''}>All Tables / Main Desk (General Coverage)</option>`);
    opts.push(`<option value="custom" ${isCust ? 'selected' : ''}>✏️ Enter Custom Table #...</option>`);
    return opts;
  };

  const tableOptions = buildTableOpts(curTable, isCustomTable);
  const newStreamTableOptions = buildTableOpts(defaultNewStreamTable, false);

  const streamListHtml = eventLiveStreams.map((s, idx) => {
    const isAct = idx === creatorActiveStreamIndex;
    const sTable = Number(s.tableNumber);
    const isMainDesk = sTable === 0;
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.65rem 0.85rem; background: ${isAct ? 'rgba(168, 85, 247, 0.15)' : 'rgba(15, 23, 42, 0.6)'}; border: 1px solid ${isAct ? 'rgba(168, 85, 247, 0.4)' : 'rgba(255,255,255,0.06)'}; border-radius: 8px;">
        <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0; flex: 1;">
          <span style="font-size: 1.2rem;">${s.platform === 'twitch' ? '🟣' : '🔴'}</span>
          <div style="min-width: 0; flex: 1;">
            <div style="font-weight: 700; color: #fff; font-size: 0.84rem; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
              ${escapeHtml(s.channel)} <span id="broadcaster-table-badge-${idx}" style="color: var(--text-muted); font-size: 0.74rem;">(${isMainDesk ? 'Main Desk' : `Table ${sTable}`})</span>
            </div>
            <div id="broadcaster-title-${idx}" style="font-size: 0.72rem; color: var(--text-secondary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
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

  const monitorTableStr = curTable === 0 ? 'Main Desk / All Tables' : `Table ${curTable} (R${effectiveRound})`;
  const currentObsUrl = buildObsOverlayUrlString('lower_third');
  const evId = ev?.id || currentOpenEventId || '';
  setTimeout(() => hydrateStreamTrackerScoreAsync(evId, overlayData), 15);

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
                  ${newStreamTableOptions.join('')}
                </select>
                <input type="number" id="new-stream-custom-table" oninput="handleCustomStreamTableInput(this.value)" value="" min="0" max="9999" placeholder="Table #" style="display: none; width: 85px; height: 32px; box-sizing: border-box; padding: 0 0.5rem; background: var(--bg-card); border: 1px solid #a855f7; border-radius: 6px; color: #fff; font-size: 0.78rem;" />
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
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.65rem; flex-wrap: wrap; gap: 0.4rem;">
            <div style="font-weight: 700; color: #fff; font-size: 0.92rem; display: flex; align-items: center; gap: 0.45rem;">
              <span>🔴 Live Broadcast Monitor</span>
              <span class="badge" style="background: #ef4444; color: #fff; font-size: 0.65rem; padding: 2px 6px;">ON AIR</span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
              <span id="live-monitor-table-label" style="font-size: 0.74rem; color: #38bdf8; font-weight: 700;">
                ${escapeHtml(activeStream?.channel || 'Stream')} • ${monitorTableStr}
              </span>
              <button type="button" id="monitor-stream-hud-toggle-btn" onclick="toggleStreamHudOverlay()" class="btn-xs btn-outline" style="font-size: 0.68rem; padding: 2px 7px; border-radius: 5px; border-color: ${streamHudOverlayEnabled ? 'rgba(56, 189, 248, 0.45)' : 'rgba(255, 255, 255, 0.15)'}; background: ${streamHudOverlayEnabled ? 'rgba(56, 189, 248, 0.14)' : 'rgba(255, 255, 255, 0.05)'}; color: ${streamHudOverlayEnabled ? '#38bdf8' : 'var(--text-muted)'}; font-weight: 700; cursor: pointer;" title="Toggle In-App Live Score HUD on our screen">
                📺 Score HUD: ${streamHudOverlayEnabled ? 'ON' : 'OFF'}
              </button>
              <button type="button" id="monitor-stream-fullscreen-btn" onclick="toggleStreamStageFullscreen('monitor')" class="btn-xs btn-outline" style="font-size: 0.68rem; padding: 2px 7px; border-radius: 5px; border-color: rgba(168, 85, 247, 0.5); background: rgba(168, 85, 247, 0.16); color: #e9d5ff; font-weight: 700; cursor: pointer;" title="Fullscreen Live Broadcast Monitor with Score HUD">
                ⛶ Fullscreen
              </button>
              <button type="button" onclick="openEventStreamModal(${curTable})" class="btn-xs btn-outline" style="font-size: 0.68rem; padding: 2px 7px; border-radius: 5px; border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.14); color: #fca5a5; font-weight: 700; cursor: pointer;">
                🎬 Theater Modal
              </button>
            </div>
          </div>

          <!-- Video Embed Frame + Fullscreen Stage Wrapper + In-App Live Score HUD Overlay -->
          <div id="live-monitor-stage-wrap" class="stream-stage-fullscreen-wrap" style="position: relative; width: 100%; padding-top: 56.25%; background: #000; border-radius: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
            <iframe 
              src="${escapeHtml(activeStream?.embedUrl || 'https://www.youtube-nocookie.com/embed/jfKfPfyJRdk')}" 
              title="Live Stream Preview"
              style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none;" 
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" 
              allowfullscreen>
            </iframe>

            <!-- Floating Top-Right Stage Controls (Visible on hover & in Fullscreen) -->
            <div class="stream-stage-floating-controls">
              <button type="button" id="monitor-stream-fs-hud-btn" onclick="toggleStreamHudOverlay()" class="stream-stage-ctrl-btn stream-stage-ctrl-hud ${streamHudOverlayEnabled ? 'active' : ''}" title="Toggle Live Score HUD Overlay">
                📺 Score HUD: ${streamHudOverlayEnabled ? 'ON' : 'OFF'}
              </button>
              <button type="button" id="monitor-stream-stage-fs-btn" onclick="toggleStreamStageFullscreen('monitor')" class="stream-stage-ctrl-btn stream-stage-ctrl-fs" title="Toggle Fullscreen with Score HUD">
                ⛶ Fullscreen
              </button>
            </div>

            <!-- In-App Live Score Lower-Third HUD Overlay (rendered on OUR screen over the stream, stays visible in Fullscreen!) -->
            <div id="live-monitor-hud-overlay" class="stream-hud-overlay-container" style="position: absolute; bottom: 42px; left: 0; right: 0; pointer-events: none; z-index: 20; padding: 0.4rem 0.65rem; display: ${streamHudOverlayEnabled ? 'block' : 'none'};">
              ${buildInAppStreamHudHtml(overlayData)}
            </div>

            <!-- Bottom-Right Native Player Fullscreen Click Interceptor -->
            <button type="button" class="stream-stage-fs-hotspot" onclick="toggleStreamStageFullscreen('monitor')" title="Toggle Fullscreen with Live Score HUD" aria-label="Toggle Fullscreen with Live Score HUD">
              <span class="stream-stage-fs-hotspot-icon">⛶</span>
            </button>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 0.65rem; font-size: 0.75rem; color: var(--text-muted);">
            <span>👁️ ~${activeStream?.viewers || 1200} concurrent viewers • Fullscreen Score HUD active</span>
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
          <p style="font-size: 0.76rem; color: var(--text-secondary); margin: 0 0 0.75rem 0; line-height: 1.45;">
            <strong>Two Ways to Overlay Scores:</strong><br/>
            1️⃣ <strong>On Our App Screen:</strong> Viewers watching inside OmniTactica automatically see the live Score HUD overlaid on the video above.<br/>
            2️⃣ <strong>On Caster's Stream (OBS):</strong> Paste the URL below into OBS as a <em>Browser Source</em> (<code>1920x250</code>) to burn the scoreboard into your YouTube/Twitch feed. Includes <code>follow=caster</code> so switching tables on the Caster Desk updates OBS automatically!
          </p>

          <!-- Interactive OBS Overlay Preview Strip -->
          <div id="obs-overlay-preview-container" style="background: rgba(0, 0, 0, 0.7); border: 1px dashed rgba(56, 189, 248, 0.5); border-radius: 8px; padding: 0.75rem; margin-bottom: 0.75rem;">
            ${buildObsOverlayPreviewStripHtml(overlayData)}
          </div>

          <!-- Direct OBS URL Input Box -->
          <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.65rem;">
            <input type="text" id="obs-overlay-url-input" readonly onclick="this.select()" value="${escapeHtml(currentObsUrl)}" style="flex: 1; height: 30px; padding: 0 0.6rem; background: rgba(2, 6, 23, 0.85); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 6px; color: #7dd3fc; font-family: var(--font-mono); font-size: 0.72rem;" title="OBS Browser Source URL (click to select)" />
            <button type="button" onclick="openObsOverlayPreview('lower_third')" class="btn-sm btn-outline" style="height: 30px; font-size: 0.73rem; font-weight: 700; padding: 0 0.65rem; color: #38bdf8; border-color: rgba(56, 189, 248, 0.4); white-space: nowrap; cursor: pointer;" title="Open overlay in a new browser tab to preview">
              ↗ Preview Overlay
            </button>
          </div>

          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button type="button" onclick="copyObsOverlayUrl('lower_third', this)" class="btn btn-primary" style="flex: 1; min-width: 140px; font-size: 0.78rem; font-weight: 700; padding: 0.45rem 0.85rem; background: linear-gradient(135deg, #0284c7, #2563eb); border: none; cursor: pointer;">
              📋 Copy Lower-Third HUD URL
            </button>
            <button type="button" onclick="copyObsOverlayUrl('tale_of_tape', this)" class="btn btn-outline" style="flex: 1; min-width: 140px; font-size: 0.78rem; font-weight: 700; padding: 0.45rem 0.85rem; color: #c084fc; border-color: rgba(168, 85, 247, 0.4); cursor: pointer;">
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
  groupBy: 'combo', // 'combo' | 'faction' | 'disposition'
  dispositionFilter: 'All',
  factionFilter: 'All',
  minReps: 1,
  sortField: 'win_rate', // 'faction' | 'disposition' | 'reps' | 'wins' | 'win_rate' | 'avg_pts' | 'top_pilot'
  sortDir: 'desc', // 'asc' | 'desc'
  sortBy: 'win_rate_desc',
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
  } else if (key === 'sortCol') {
    const col = String(value || 'win_rate');
    if (powerGridState.sortField === col) {
      powerGridState.sortDir = powerGridState.sortDir === 'desc' ? 'asc' : 'desc';
    } else {
      powerGridState.sortField = col;
      const isTextCol = (col === 'faction' || col === 'disposition' || col === 'top_pilot');
      powerGridState.sortDir = isTextCol ? 'asc' : 'desc';
    }
    powerGridState.sortBy = `${powerGridState.sortField}_${powerGridState.sortDir}`;
  } else if (key === 'sortBy') {
    powerGridState.sortBy = value;
    if (value === 'win_rate_asc') {
      powerGridState.sortField = 'win_rate';
      powerGridState.sortDir = 'asc';
    } else if (value === 'reps_desc') {
      powerGridState.sortField = 'reps';
      powerGridState.sortDir = 'desc';
    } else if (value === 'wins_desc') {
      powerGridState.sortField = 'wins';
      powerGridState.sortDir = 'desc';
    } else if (value === 'avg_pts_desc') {
      powerGridState.sortField = 'avg_pts';
      powerGridState.sortDir = 'desc';
    } else if (value === 'faction_asc') {
      powerGridState.sortField = 'faction';
      powerGridState.sortDir = 'asc';
    } else if (value === 'disposition_asc') {
      powerGridState.sortField = 'disposition';
      powerGridState.sortDir = 'asc';
    } else {
      powerGridState.sortField = 'win_rate';
      powerGridState.sortDir = 'desc';
    }
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
    powerGridState.groupBy = 'combo';
    powerGridState.dispositionFilter = 'All';
    powerGridState.factionFilter = 'All';
    powerGridState.minReps = 1;
    powerGridState.sortField = 'win_rate';
    powerGridState.sortDir = 'desc';
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
    renderEventMetaAndHighlights(currentEventData);
  }
}
window.updatePowerGridControl = updatePowerGridControl;

function sortPowerGridRecords(list, sortBy) {
  const field = powerGridState.sortField || 'win_rate';
  const dirMul = powerGridState.sortDir === 'asc' ? 1 : -1;

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

    if (field === 'faction') {
      const fA = String(a.faction || a.disposition || '').toLowerCase();
      const fB = String(b.faction || b.disposition || '').toLowerCase();
      if (fA !== fB) return fA.localeCompare(fB) * dirMul;
      const dA = String(a.disposition || a.detachment || '').toLowerCase();
      const dB = String(b.disposition || b.detachment || '').toLowerCase();
      if (dA !== dB) return dA.localeCompare(dB) * dirMul;
      return wrB - wrA;
    }
    if (field === 'disposition') {
      const dA = String(a.disposition || a.label || a.faction || '').toLowerCase();
      const dB = String(b.disposition || b.label || b.faction || '').toLowerCase();
      if (dA !== dB) return dA.localeCompare(dB) * dirMul;
      const detA = String(a.detachment || '').toLowerCase();
      const detB = String(b.detachment || '').toLowerCase();
      if (detA !== detB) return detA.localeCompare(detB) * dirMul;
      return wrB - wrA;
    }
    if (field === 'reps') {
      if (a.count !== b.count) return (a.count - b.count) * dirMul;
      return wrB - wrA;
    }
    if (field === 'wins') {
      if (a.wins !== b.wins) return (a.wins - b.wins) * dirMul;
      return wrB - wrA;
    }
    if (field === 'avg_pts') {
      if (avgA !== avgB) return (avgA - avgB) * dirMul;
      return wrB - wrA;
    }
    if (field === 'top_pilot') {
      const pA = String(a.topPlayer || '').toLowerCase();
      const pB = String(b.topPlayer || '').toLowerCase();
      if (pA !== pB) return pA.localeCompare(pB) * dirMul;
      return wrB - wrA;
    }
    // default: win_rate
    if (wrA !== wrB) return (wrA - wrB) * dirMul;
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

  const pgThClass = (col) => `sortable${powerGridState.sortField === col ? (powerGridState.sortDir === 'asc' ? ' sorted-asc' : ' sorted-desc') : ''}`;

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
      Array.from(dispGroups.values()),
      powerGridState.sortBy
    );
    totalGroupsShown = sortedGroups.length;

    tableHeaderHtml = `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.12); color: var(--text-muted); text-align: left; font-size: 0.76rem; text-transform: uppercase;">
        <th class="${pgThClass('disposition')}" onclick="updatePowerGridControl('sortCol', 'disposition')" style="padding: 0.6rem 0.5rem; cursor: pointer;">Force Disposition</th>
        <th class="${pgThClass('reps')}" onclick="updatePowerGridControl('sortCol', 'reps')" style="padding: 0.6rem 0.5rem; text-align: center; cursor: pointer;">Reps</th>
        <th class="${pgThClass('wins')}" onclick="updatePowerGridControl('sortCol', 'wins')" style="padding: 0.6rem 0.5rem; text-align: center; cursor: pointer;">Record (W-L)</th>
        <th class="${pgThClass('win_rate')}" onclick="updatePowerGridControl('sortCol', 'win_rate')" style="padding: 0.6rem 0.5rem; text-align: center; cursor: pointer;">Win Rate</th>
        <th style="padding: 0.6rem 0.5rem;">Factions in Disposition (Click to Filter / Expand)</th>
        <th class="${pgThClass('avg_pts')}" onclick="updatePowerGridControl('sortCol', 'avg_pts')" style="padding: 0.6rem 0.5rem; text-align: right; cursor: pointer;">Avg Pts</th>
        <th class="${pgThClass('top_pilot')}" onclick="updatePowerGridControl('sortCol', 'top_pilot')" style="padding: 0.6rem 0.5rem; text-align: right; cursor: pointer;">Top Pilot</th>
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
        Array.from(g.subMap.values()),
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
      Array.from(facGroups.values()),
      powerGridState.sortBy
    );
    totalGroupsShown = sortedGroups.length;

    tableHeaderHtml = `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.12); color: var(--text-muted); text-align: left; font-size: 0.76rem; text-transform: uppercase;">
        <th class="${pgThClass('faction')}" onclick="updatePowerGridControl('sortCol', 'faction')" style="padding: 0.6rem 0.5rem; cursor: pointer;">Faction</th>
        <th class="${pgThClass('reps')}" onclick="updatePowerGridControl('sortCol', 'reps')" style="padding: 0.6rem 0.5rem; text-align: center; cursor: pointer;">Reps</th>
        <th class="${pgThClass('wins')}" onclick="updatePowerGridControl('sortCol', 'wins')" style="padding: 0.6rem 0.5rem; text-align: center; cursor: pointer;">Record (W-L)</th>
        <th class="${pgThClass('win_rate')}" onclick="updatePowerGridControl('sortCol', 'win_rate')" style="padding: 0.6rem 0.5rem; text-align: center; cursor: pointer;">Win Rate</th>
        <th style="padding: 0.6rem 0.5rem;">Force Dispositions / Detachments Breakdown</th>
        <th class="${pgThClass('avg_pts')}" onclick="updatePowerGridControl('sortCol', 'avg_pts')" style="padding: 0.6rem 0.5rem; text-align: right; cursor: pointer;">Avg Pts</th>
        <th class="${pgThClass('top_pilot')}" onclick="updatePowerGridControl('sortCol', 'top_pilot')" style="padding: 0.6rem 0.5rem; text-align: right; cursor: pointer;">Top Pilot</th>
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
    // GROUP BY FACTION × DISPOSITION GRID (Default: Faction 1st column -> Force Disposition / Detachment 2nd column)
    const comboMap = new Map();
    filteredPlayers.forEach(ep => {
      const key = `${ep.faction}__${ep.disposition}__${ep.detachment}`;
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
      Array.from(comboMap.values()),
      powerGridState.sortBy
    );
    totalGroupsShown = sortedCombos.length;

    tableHeaderHtml = `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.12); color: var(--text-muted); text-align: left; font-size: 0.76rem; text-transform: uppercase;">
        <th class="${pgThClass('faction')}" onclick="updatePowerGridControl('sortCol', 'faction')" style="padding: 0.6rem 0.5rem; cursor: pointer;">Faction</th>
        <th class="${pgThClass('disposition')}" onclick="updatePowerGridControl('sortCol', 'disposition')" style="padding: 0.6rem 0.5rem; cursor: pointer;">Force Disposition / Detachment</th>
        <th class="${pgThClass('reps')}" onclick="updatePowerGridControl('sortCol', 'reps')" style="padding: 0.6rem 0.5rem; text-align: center; cursor: pointer;">Reps</th>
        <th class="${pgThClass('wins')}" onclick="updatePowerGridControl('sortCol', 'wins')" style="padding: 0.6rem 0.5rem; text-align: center; cursor: pointer;">Record (W-L)</th>
        <th class="${pgThClass('win_rate')}" onclick="updatePowerGridControl('sortCol', 'win_rate')" style="padding: 0.6rem 0.5rem; text-align: center; cursor: pointer;">Win Rate</th>
        <th class="${pgThClass('avg_pts')}" onclick="updatePowerGridControl('sortCol', 'avg_pts')" style="padding: 0.6rem 0.5rem; text-align: right; cursor: pointer;">Avg Battle Pts</th>
        <th class="${pgThClass('top_pilot')}" onclick="updatePowerGridControl('sortCol', 'top_pilot')" style="padding: 0.6rem 0.5rem; text-align: right; cursor: pointer;">Top Pilot</th>
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
          <td style="padding: 0.55rem 0.5rem; font-weight: 700; color: #fff;">🛡️ ${escapeHtml(c.faction)}</td>
          <td style="padding: 0.55rem 0.5rem;">
            <span class="badge" style="background: ${c.dispMeta.bg}; color: ${c.dispMeta.color}; border: 1px solid ${c.dispMeta.border}; font-size: 0.72rem; font-weight: 700;">
              ${c.dispMeta.icon} ${escapeHtml(c.disposition)}
            </span>
            ${c.detachment && c.detachment !== c.disposition ? `<div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 2px;">${escapeHtml(c.detachment)}</div>` : ''}
          </td>
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

  const hasActiveFilters = powerGridState.dispositionFilter !== 'All' || powerGridState.factionFilter !== 'All' || powerGridState.groupBy !== 'combo' || powerGridState.search.trim().length > 0;

  return `
    <!-- Header -->
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.9rem; flex-wrap: wrap;">
      <div>
        <h4 style="margin: 0; font-size: 1rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.45rem;">
          <span>🧬 Detachment & Force Disposition Power Grid</span>
          <span class="badge" style="background: rgba(56,189,248,0.14); color: #38bdf8; font-size: 0.7rem;">${filteredPlayers.length} / ${enrichedPlayers.length} Pilots</span>
        </h4>
        <div style="font-size: 0.76rem; color: var(--text-secondary); margin-top: 2px;">
          Tap any column header below to sort ascending or descending, or filter by Faction and Force Disposition.
        </div>
      </div>
    </div>

    <!-- 5 Force Disposition Quick-Filter Summary Cards -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(175px, 1fr)); gap: 0.55rem; margin-bottom: 0.9rem;">
      ${dispCardsHtml}
    </div>

    <!-- Interactive Filter Toolbar -->
    <div style="display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap; background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; padding: 0.6rem 0.75rem; margin-bottom: 0.85rem;">
      <div style="display: flex; align-items: center; gap: 0.35rem; max-width: 100%;">
        <label style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700; flex-shrink: 0;">Faction:</label>
        <select id="power-grid-faction-select" onchange="updatePowerGridControl('factionFilter', this.value)" style="height: 30px; max-width: 195px; min-width: 0; padding: 0 0.5rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: #fff; font-size: 0.76rem; cursor: pointer;">
          <option value="All" ${powerGridState.factionFilter === 'All' ? 'selected' : ''}>All Factions (${allFactions.length})</option>
          ${allFactions.map(f => `<option value="${escapeHtml(f)}" ${powerGridState.factionFilter === f ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}
        </select>
      </div>

      <div style="display: flex; align-items: center; gap: 0.35rem; max-width: 100%;">
        <label style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700; flex-shrink: 0;">Disposition:</label>
        <select id="power-grid-disposition-select" onchange="updatePowerGridControl('dispositionSelect', this.value)" style="height: 30px; max-width: 195px; min-width: 0; padding: 0 0.5rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: #fff; font-size: 0.76rem; cursor: pointer;">
          <option value="All" ${powerGridState.dispositionFilter === 'All' ? 'selected' : ''}>All Dispositions</option>
          ${CANONICAL_FORCE_DISPOSITIONS.map(d => `<option value="${escapeHtml(d.key)}" ${powerGridState.dispositionFilter === d.key ? 'selected' : ''}>${d.icon} ${escapeHtml(d.label)}</option>`).join('')}
        </select>
      </div>

      <div style="display: flex; align-items: center; gap: 0.35rem; max-width: 100%;">
        <label style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700; flex-shrink: 0;">View:</label>
        <select id="power-grid-groupby-select" onchange="updatePowerGridControl('groupBy', this.value)" style="height: 30px; max-width: 225px; min-width: 0; padding: 0 0.5rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: #fff; font-size: 0.76rem; cursor: pointer;">
          <option value="combo" ${powerGridState.groupBy === 'combo' ? 'selected' : ''}>🧬 Faction × Disposition Grid</option>
          <option value="faction" ${powerGridState.groupBy === 'faction' ? 'selected' : ''}>🛡️ By Faction (→ Dispositions)</option>
          <option value="disposition" ${powerGridState.groupBy === 'disposition' ? 'selected' : ''}>🎯 By Force Disposition (→ Factions)</option>
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
      <table id="power-grid-table" style="width: 100%; border-collapse: collapse; font-size: 0.82rem;">
        <thead>
          ${tableHeaderHtml}
        </thead>
        <tbody>
          ${tableBodyHtml || `
            <tr>
              <td colspan="7" style="padding: 2rem; text-align: center; color: var(--text-muted);">
                No entries match the current filter criteria. Try resetting filters.
              </td>
            </tr>
          `}
        </tbody>
      </table>
    </div>
  `;
}

function renderDeepMetaMode(ev, players, matches) {
  return `
    <!-- Interactive Detachment & Force Disposition Power Grid -->
    <div id="deep-meta-power-grid-mount" style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 1.15rem;">
      ${buildInteractivePowerGridHtml(ev, players, matches)}
    </div>
  `;
}

// Helper: Extract top datasheets / characters from raw army list text
function extractKeyListUnits(listText, faction, detachment) {
  if (!listText || typeof listText !== 'string' || listText.trim().length === 0) {
    return [];
  }

  const rawLines = listText.replace(/\r\n/g, '\n').split('\n');

  const sectionHeaderRe = /^(?:\+\+.*?\+\+|==.*?==|--.*?--|(?:characters?|epic\s+hero(?:es)?|battleline|dedicated\s+transports?|other\s+datasheets?|allied\s+units?|allies|fortifications?|supreme\s+commanders?|attached\s+units?|unattached\s+units?|general'?s\s+regiment|regiment\s+\d+|auxiliary\s+units?|faction\s+terrain|hq|troops|elites|fast\s+attack|heavy\s+support|flyers?|lords?\s+of\s+war)\s*:?)$/i;
  const subHeaderOrMetaRe = /^(?:\+\+|==|--|•|\*|-|attached\s+units?(?:\s+\d+)?\b|unattached\s+units?(?:\s+\d+)?\b|characters?\b|epic\s+hero(?:es)?\b|battleline\b|dedicated\s+transports?\b|other\s+datasheets?\b|allied\s+units?\b|allies\b|vehicles?\b|monsters?\b|infantry\b|mounted\b|beasts?\b|fortifications?\b|supreme\s+commanders?\b|detachment(?:\s+choice|\s+rule)?\b|force\s+disposition\b|battle\s+size\b|total\b|points\b|created\s+with\b|exported\s+with\b|army\s+roster\b|strike\s+force\b|incursion\b|onslaught\b|show\/hide\b|configuration\b|meta\b|enhancements?\b|warlord\b|attached\s+to\b|attached\s+as\b|leading\b|general'?s\s+regiment\b|regiment\s+\d+\b|auxiliary\s+units?\b|spell\s+lore\b|prayer\s+lore\b|manifestation\s+lore\b|faction\s+terrain\b)/i;
  const dispositionOrFactionRe = /^(?:take\s+and\s+hold|take\s*&\s*hold|priority\s+assets?|purge\s+the\s+foe|reconnaissance|disruption|meta|blitz\s+brigade.*|runt\s+swarm.*|wreckas.*|adeptus\s+mechanicus|adeptus\s+custodes|adepta\s+sororitas|space\s+marines|adeptus\s+astartes|dark\s+angels|blood\s+angels|space\s+wolves|black\s+templars|deathwatch|grey\s+knights|astra\s+militarum|imperial\s+knights|imperial\s+agents|agents\s+of\s+the\s+imperium|chaos\s+space\s+marines|death\s+guard|thousand\s+sons|world\s+eaters|emperor'?s\s+children|chaos\s+daemons|daemons|chaos\s+knights|aeldari|craftworlds|drukhari|harlequins|ynnari|necrons|orks|tyranids|genestealer\s+cults?|t'?au(?:\s+empire)?|leagues\s+of\s+votann|votann|imperium|chaos|xenos)$/i;
  const wargearRe = /\b(?:pistol|rifle|blaster|cannon|bolter|boltgun|chainsword|power\s+fist|power\s+weapon|power\s+sword|power\s+axe|power\s+maul|power\s+klaw|thunder\s+hammer|lightning\s+claws?|storm\s+shield|relic\s+blade|relic\s+weapon|accursed\s+weapon|force\s+weapon|nemesis\s+force|close\s+combat\s+weapon|ccw|armoured\s+hull|hull|tracks|wheels|choppa|slugga|shoota|big\s+shoota|rokkit|kustom\s+mega|killsaw|squigstoppa|grabzappa|da\s+grabzappa|grot\s+blasta|stikkbombs?|frag\s+grenades?|krak\s+grenades?|grenade\s+launcher|flamer|heavy\s+flamer|meltagun|multi-melta|plasma\s+gun|plasma\s+incinerator|lascannon|twin\s+.*?\s+fist|kastelan\s+fist|phosphor\s+blaster|stubber|heavy\s+stubber|autocannon|assault\s+cannon|gatling|missile\s+launcher|omnispex|data-tether|vexilla|icon\s+of|instrument\s+of|banner|standard|watcher\s+in\s+the\s+dark|attack\s+squig|makari)\b/i;

  const normFac = normalizeCasterFactionKey(faction || '');
  const normDet = String(detachment || '').trim().toLowerCase();

  const isBlockedToken = (str) => {
    const s = String(str || '').trim();
    if (!s || s.length < 3 || s.length > 42) return true;
    const low = s.toLowerCase();
    if (subHeaderOrMetaRe.test(s) || sectionHeaderRe.test(s) || dispositionOrFactionRe.test(s)) return true;
    if (normFac && ( normalizeCasterFactionKey(s) === normFac || low === normFac )) return true;
    if (normDet && ( low === normDet || normDet.includes(low) || low.includes(normDet) )) return true;
    if (typeof DETACHMENT_DISPOSITION_LOOKUP === 'object' && DETACHMENT_DISPOSITION_LOOKUP && DETACHMENT_DISPOSITION_LOOKUP[low]) return true;
    if (/^\d+\s*(?:pts?|points?|cp|drops?)$/i.test(s)) return true;
    if (/\b(?:detachment\s+points|battle\s+size|strike\s+force|force\s+disposition)\b/i.test(s)) return true;
    if (wargearRe.test(s)) return true;
    return false;
  };

  const cleanUnitName = (rawLine) => {
    let s = String(rawLine || '').trim();
    s = s.replace(/^[•*\-+]+\s*/, '');
    s = s.replace(/^[0-9]+x\s+/i, '');
    s = s.split('[')[0].split('(')[0].split(':')[0].trim();
    s = s.replace(/\s+-\s+\d+\s*(?:pts?|points?).*$/i, '').trim();
    s = s.replace(/^[0-9]+x\s+/i, '').trim();
    return s;
  };

  // Find first section header so we skip top-of-list army/detachment/disposition preamble
  let startIdx = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const t = rawLines[i].trim();
    if (sectionHeaderRe.test(t)) {
      startIdx = i + 1;
      break;
    }
  }

  const candidateLines = rawLines.slice(startIdx);
  const found = [];

  // Pass 1: Look for non-indented, non-bullet lines with explicit unit points (25..1000 pts)
  const unitPtsRe = /(?:\(\s*(\d{1,3})\s*(?:pts?|points?)\s*\)|\[\s*(\d{1,3})\s*(?:pts?|points?)\s*\]|-\s*(\d{1,3})\s*(?:pts?|points?)\b)/i;
  candidateLines.forEach(line => {
    if (/^\s{2,}|\t|^\s*[•*]/.test(line)) return;
    const trimmed = line.trim();
    if (!trimmed || subHeaderOrMetaRe.test(trimmed) || sectionHeaderRe.test(trimmed)) return;
    if (/detachment\s+points/i.test(trimmed) || /enhancement/i.test(trimmed)) return;
    const m = trimmed.match(unitPtsRe);
    if (!m) return;
    const pts = Number(m[1] || m[2] || m[3] || 0);
    if (pts < 25 || pts > 1000) return;
    const clean = cleanUnitName(trimmed);
    if (!isBlockedToken(clean) && !found.includes(clean)) {
      found.push(clean);
    }
  });

  if (found.length > 0) {
    return found;
  }

  // Pass 2: Point-less exports (only runs if a real section header was found)
  if (startIdx > 0) {
    const hasColonUnits = candidateLines.some(l => {
      if (/^\s{2,}|\t|^\s*[•*]/.test(l)) return false;
      const t = l.trim();
      return t.endsWith(':') && !sectionHeaderRe.test(t) && !subHeaderOrMetaRe.test(t);
    });

    candidateLines.forEach(line => {
      if (/^\s{2,}|\t|^\s*[•*]/.test(line)) return;
      const trimmed = line.trim();
      if (!trimmed || sectionHeaderRe.test(trimmed) || subHeaderOrMetaRe.test(trimmed)) return;
      if (hasColonUnits && !trimmed.endsWith(':')) return;
      if (!hasColonUnits && /^[0-9]+x\s+/i.test(trimmed)) return;
      const clean = cleanUnitName(trimmed);
      if (!isBlockedToken(clean) && !found.includes(clean)) {
        found.push(clean);
      }
    });
  }

  return found;
}

window.renderEventCreatorHub = renderEventCreatorHub;
window.renderCasterDeckMode = renderCasterDeckMode;
window.renderStreamStudioMode = renderStreamStudioMode;
window.renderStorylinesMode = renderStorylinesMode;
window.renderDeepMetaMode = renderDeepMetaMode;

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

// ============================================================================
// TO HUB, PUBLIC NEWS & INFO TAB & GLOBAL EVENT ANNOUNCEMENT BANNER
// ============================================================================

const _eventToHubStateCache = new Map();
let _currentToHubSubtab = 'radar'; // 'radar' | 'clock' | 'announcements' | 'roster'
let _toHubRadarRound = null;
let _toHubRadarFilter = 'all'; // 'all' | 'unfinished' | 'completed' | 'tracker' | 'judge'
let _toHubRadarSearch = '';
let _toHubRosterFilter = 'all'; // 'all' | 'checked_in' | 'not_checked_in' | 'list_submitted' | 'missing_list' | 'unassigned_faction' | 'dropped'
let _toHubRosterSearch = '';
let _toHubMasterClockInterval = null;

function normalizeBcpEventUsersList(rawEventUsers) {
  if (!rawEventUsers) return [];
  if (Array.isArray(rawEventUsers)) return rawEventUsers.filter(u => u && typeof u === 'object');
  if (typeof rawEventUsers === 'object') {
    return Object.entries(rawEventUsers)
      .map(([k, v]) => (v && typeof v === 'object' ? Object.assign({ _keyId: k }, v) : null))
      .filter(Boolean);
  }
  return [];
}

function formatBcpStaffRoleName(eu) {
  if (!eu || typeof eu !== 'object') return 'Tournament Organizer';
  if (eu.role && typeof eu.role === 'object') {
    return String(eu.role.name || eu.role.type || eu.type || 'Tournament Organizer').trim();
  }
  return String(eu.type || eu.role || 'Tournament Organizer').trim();
}

function getUserEventOrganizerRole(ev, userOverride = null) {
  if (!ev) return null;
  const u = userOverride || (typeof currentUser !== 'undefined' ? currentUser : null);
  if (!u) return null;

  const isAdmin = Boolean(u.role === 'admin' || u.is_admin);
  const raw = (ev.raw_json && typeof ev.raw_json === 'object') ? ev.raw_json : ev;
  const userBcpId = String(u.bcp_user_id || u.player_id || '').trim();
  const userEmail = String(u.email || '').trim().toLowerCase();
  const userFullName = String(u.full_name || `${u.first_name || ''} ${u.last_name || ''}`).trim().toLowerCase();

  if (ev.organizer_role) return String(ev.organizer_role);
  if (ev.is_owner) return 'Event Owner';
  if (ev.is_to) return 'Tournament Organizer';

  const ownerId = String(raw.ownerId || raw.owner_Id || ev.owner_id || '').trim();
  if (userBcpId && ownerId && userBcpId === ownerId) {
    return 'Event Owner';
  }
  const ownerFullName = `${raw.ownerFirstName || ''} ${raw.ownerLastName || ''}`.trim().toLowerCase();
  if (userFullName && ownerFullName && userFullName.length > 3 && userFullName === ownerFullName) {
    return 'Event Owner';
  }

  const eventUsers = normalizeBcpEventUsersList(raw.eventUsers || ev.event_users);
  for (const eu of eventUsers) {
    const euUid = String(eu.userId || eu.user_id || eu.id || eu._keyId || '').trim();
    const euEmail = String(eu.email || '').trim().toLowerCase();
    const euName = `${eu.firstName || eu.first_name || ''} ${eu.lastName || eu.last_name || ''}`.trim().toLowerCase();
    if (
      (userBcpId && euUid && userBcpId === euUid) ||
      (userEmail && euEmail && userEmail === euEmail) ||
      (userFullName && euName && userFullName.length > 3 && userFullName === euName)
    ) {
      return formatBcpStaffRoleName(eu);
    }
  }

  const evId = String(ev.id || ev.event_id || '').trim();
  if (evId && Array.isArray(window.myHubHostedTournaments)) {
    const matchedHosted = window.myHubHostedTournaments.find(t => String(t.event_id || t.id || '') === evId);
    if (matchedHosted) {
      return String(matchedHosted.organizer_role || 'Tournament Organizer');
    }
  }

  if (isAdmin) return 'Platform Admin / TO Override';
  return null;
}

function canUserAccessEventToHub(ev, userOverride = null) {
  return Boolean(getUserEventOrganizerRole(ev, userOverride));
}

function extractEventStaffDirectory(ev) {
  if (!ev) return [];
  const raw = (ev.raw_json && typeof ev.raw_json === 'object') ? ev.raw_json : ev;
  const staff = [];
  const seen = new Set();

  const ownerId = String(raw.ownerId || raw.owner_Id || ev.owner_id || '').trim();
  const ownerFirst = String(raw.ownerFirstName || '').trim();
  const ownerLast = String(raw.ownerLastName || '').trim();
  const ownerName = `${ownerFirst} ${ownerLast}`.trim();
  if (ownerName) {
    const key = (ownerId || ownerName).toLowerCase();
    seen.add(key);
    seen.add(ownerName.toLowerCase());
    staff.push({
      id: ownerId || key,
      name: ownerName,
      role: 'Event Owner',
      badgeIcon: '🏛️',
      isOwner: true,
    });
  }

  const eventUsers = normalizeBcpEventUsersList(raw.eventUsers || ev.event_users);
  for (const eu of eventUsers) {
    const uid = String(eu.userId || eu.user_id || eu.id || eu._keyId || '').trim();
    const first = String(eu.firstName || eu.first_name || '').trim();
    const last = String(eu.lastName || eu.last_name || '').trim();
    const fullName = `${first} ${last}`.trim() || String(eu.name || eu.full_name || '').trim();
    if (!fullName && !uid) continue;
    const key = (uid || fullName).toLowerCase();
    if (seen.has(key) || (fullName && seen.has(fullName.toLowerCase()))) continue;
    seen.add(key);
    if (fullName) seen.add(fullName.toLowerCase());
    const isOwnerMatch = Boolean(ownerId && uid && ownerId === uid);
    const roleStr = isOwnerMatch ? 'Event Owner' : formatBcpStaffRoleName(eu);
    const isJudge = /judge/i.test(roleStr);
    const isStreamer = /stream/i.test(roleStr);
    staff.push({
      id: uid || key,
      name: fullName || 'Event Staff',
      role: roleStr,
      badgeIcon: isOwnerMatch ? '🏛️' : (isJudge ? '⚖️' : (isStreamer ? '🎥' : '📋')),
      isOwner: isOwnerMatch,
    });
  }
  return staff;
}

function getEventBcpRoundConfig(ev) {
  const raw = (ev && ev.raw_json && typeof ev.raw_json === 'object') ? ev.raw_json : (ev || {});
  const rawLen = Number(raw.defaultRoundLength || ev?.default_round_length || 180) || 180;
  // BCP stores defaultRoundLength in seconds (e.g. 10800 = 180m); normalize to minutes
  const defaultLengthMins = rawLen > 600 ? Math.round(rawLen / 60) : rawLen;
  const roundTimers = Array.isArray(raw.roundTimers)
    ? raw.roundTimers
    : (Array.isArray(ev?.round_timers) ? ev.round_timers : []);
  return {
    defaultLengthMins,
    roundTimers,
  };
}

let _toHubFirestoreUnsub = null;
let _toHubFirestoreEventId = null;

function isTargetedBroadcastObj(b) {
  if (!b || typeof b !== 'object') return false;
  return Boolean(b.is_targeted || b.target_table || b.target_player_id || b.target_player_name);
}

function computeClientBroadcastTargetKey(b) {
  if (!isTargetedBroadcastObj(b)) return 'general';
  if (b.target_key) return String(b.target_key);
  const pid = String(b.target_player_id || '').trim().toLowerCase();
  const pname = String(b.target_player_name || '').trim().toLowerCase();
  const tbl = String(b.target_table || '').trim();
  if (pid) return `player_${pid}`;
  if (pname && !pname.includes(' vs ') && !pname.includes(' & ') && !pname.includes(',')) {
    const cleanP = pname.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return tbl ? `table_${tbl}_player_${cleanP}` : `player_${cleanP}`;
  }
  if (tbl) return `table_${tbl}`;
  return String(b.id || 'targeted');
}

function ensureEventToHubFirestoreListener(eventId) {
  const eid = String(eventId || '').trim();
  if (!eid) return;
  if (_toHubFirestoreEventId === eid && _toHubFirestoreUnsub) return;
  if (_toHubFirestoreUnsub) {
    try { _toHubFirestoreUnsub(); } catch (_) {}
    _toHubFirestoreUnsub = null;
    _toHubFirestoreEventId = null;
  }
  try {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0 && typeof firebase.firestore === 'function') {
      const db = firebase.firestore();
      _toHubFirestoreEventId = eid;
      // Clean up any legacy uppercase duplicate document if eid is mixed-case (e.g. uZ4qxIz8T6a8 vs UZ4QXIZ8T6A8)
      if (eid.toUpperCase() !== eid) {
        db.collection('tournaments').doc(eid.toUpperCase()).delete().catch(() => {});
      }
      _toHubFirestoreUnsub = db.collection('tournaments').doc(eid).onSnapshot(doc => {
        if (!doc || !doc.exists) return;
        const data = doc.data() || {};
        const prev = _eventToHubStateCache.get(eid) || { event_id: eid };
        if (data.masterClock) {
          prev.clock = data.masterClock;
          prev.master_clock = data.masterClock;
        }
        if ('broadcast' in data) {
          const b = (data.broadcast && data.broadcast.active !== false && !isTargetedBroadcastObj(data.broadcast))
            ? data.broadcast
            : null;
          prev.broadcast = b;
          prev.active_broadcast = b;
        }
        if (Array.isArray(data.targeted_broadcasts)) {
          prev.targeted_broadcasts = data.targeted_broadcasts.filter(t => t && t.message && t.active !== false);
        }
        if (Array.isArray(data.announcements) && data.announcements.length > 0) {
          prev.announcements = data.announcements;
        }
        prev._fetchedAt = Date.now();
        _eventToHubStateCache.set(eid, prev);
        updateEventNewsTabBadge(eid);
        if (prev.clock && prev.clock.status === 'running') {
          startToHubClockTicker(eid);
        }
        if (currentOpenEventId && String(currentOpenEventId) === eid && currentEventData) {
          renderEventClockAndScheduleWidgets(currentEventData, true);
          if (currentEventModalTab === 'news') {
            renderEventNewsHub(currentEventData, true);
          } else if (currentEventModalTab === 'to-hub' || currentEventModalTab === 'player') {
            if (_currentMyStationSubtab && _currentMyStationSubtab.startsWith('to-')) {
              renderEventToHub(currentEventData, true);
            }
          } else if (currentEventModalTab === 'matches') {
            renderEventPairingsRows(currentEventPairingsRound || 'all');
          }
        }
        if (typeof syncGlobalEventAnnouncementBanner === 'function') {
          syncGlobalEventAnnouncementBanner().catch(() => {});
        }
      }, () => {});
    }
  } catch (_) {}
}

async function syncToHubBroadcastToClientFirestore(eventId, broadcastObj, clearTargetId = null) {
  const eid = String(eventId || '').trim();
  if (!eid) return;
  try {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0 && typeof firebase.firestore === 'function') {
      const db = firebase.firestore();
      const nowMs = Date.now();
      const cachedState = _eventToHubStateCache.get(eid) || {};
      if (eid.toUpperCase() !== eid) {
        db.collection('tournaments').doc(eid.toUpperCase()).delete().catch(() => {});
      }

      if (broadcastObj && broadcastObj.message && broadcastObj.active !== false) {
        const isTargeted = isTargetedBroadcastObj(broadcastObj);
        const targetKey = computeClientBroadcastTargetKey(broadcastObj);
        const activeBroadcast = {
          ...broadcastObj,
          eventId: eid,
          event_id: eid,
          is_targeted: isTargeted,
          target_key: targetKey,
          active: true,
          timestamp: broadcastObj.timestamp || nowMs,
        };
        if (isTargeted) {
          const prevList = Array.isArray(cachedState.targeted_broadcasts) ? cachedState.targeted_broadcasts : [];
          const nextList = [
            activeBroadcast,
            ...prevList.filter(t => t && t.id !== activeBroadcast.id && computeClientBroadcastTargetKey(t) !== targetKey)
          ].slice(0, 25);
          db.collection('tournaments').doc(eid).set({
            eventId: eid,
            targeted_broadcasts: nextList,
            updatedAt: nowMs,
          }, { merge: true }).catch(() => {});
          db.collection('tournaments').doc('_active_broadcasts').set({
            broadcasts: {
              [`${eid}__target__${targetKey}`]: activeBroadcast,
            },
            updatedAt: nowMs,
          }, { merge: true }).catch(() => {});
        } else {
          db.collection('tournaments').doc(eid).set({
            eventId: eid,
            broadcast: activeBroadcast,
            updatedAt: nowMs,
          }, { merge: true }).catch(() => {});
          db.collection('tournaments').doc('_active_broadcasts').set({
            broadcasts: {
              [eid]: activeBroadcast,
            },
            updatedAt: nowMs,
          }, { merge: true }).catch(() => {});
        }
      } else {
        const cleanTarget = String(clearTargetId || '').trim();
        if (!cleanTarget || cleanTarget === 'general') {
          db.collection('tournaments').doc(eid).set({
            eventId: eid,
            broadcast: null,
            updatedAt: nowMs,
          }, { merge: true }).catch(() => {});
          db.collection('tournaments').doc('_active_broadcasts').set({
            broadcasts: {
              [eid]: null,
            },
            updatedAt: nowMs,
          }, { merge: true }).catch(() => {});
        } else if (cleanTarget === 'all_targeted') {
          const prevList = Array.isArray(cachedState.targeted_broadcasts) ? cachedState.targeted_broadcasts : [];
          const clearMap = {};
          prevList.forEach(t => {
            const tk = computeClientBroadcastTargetKey(t);
            clearMap[`${eid}__target__${tk}`] = null;
          });
          db.collection('tournaments').doc(eid).set({
            eventId: eid,
            targeted_broadcasts: [],
            updatedAt: nowMs,
          }, { merge: true }).catch(() => {});
          if (Object.keys(clearMap).length > 0) {
            db.collection('tournaments').doc('_active_broadcasts').set({
              broadcasts: clearMap,
              updatedAt: nowMs,
            }, { merge: true }).catch(() => {});
          }
        } else {
          const prevList = Array.isArray(cachedState.targeted_broadcasts) ? cachedState.targeted_broadcasts : [];
          const clearMap = {};
          const nextList = prevList.filter(t => {
            const tk = computeClientBroadcastTargetKey(t);
            if (String(t.id || '') === cleanTarget || tk === cleanTarget) {
              clearMap[`${eid}__target__${tk}`] = null;
              return false;
            }
            return true;
          });
          db.collection('tournaments').doc(eid).set({
            eventId: eid,
            targeted_broadcasts: nextList,
            updatedAt: nowMs,
          }, { merge: true }).catch(() => {});
          clearMap[`${eid}__target__${cleanTarget}`] = null;
          db.collection('tournaments').doc('_active_broadcasts').set({
            broadcasts: clearMap,
            updatedAt: nowMs,
          }, { merge: true }).catch(() => {});
        }
      }
    }
  } catch (_) {}
}

function recordRecentInteractedEventId(eventId) {
  const eid = String(eventId || '').trim();
  if (!eid || eid === '*' || eid === '_active_broadcasts') return;
  if (!window._recentInteractedEventIds) window._recentInteractedEventIds = new Set();
  window._recentInteractedEventIds.add(eid);
  try {
    const raw = localStorage.getItem('omni_recent_event_ids');
    const prev = raw ? JSON.parse(raw) : [];
    const list = [eid, ...(Array.isArray(prev) ? prev.filter(x => x && x !== eid) : [])].slice(0, 12);
    localStorage.setItem('omni_recent_event_ids', JSON.stringify(list));
  } catch (_) {}
}

async function loadEventToHubState(eventId, forceRefresh = false) {
  if (!eventId || !window.api || typeof window.api.getEventToHubState !== 'function') return null;
  const eid = String(eventId);
  recordRecentInteractedEventId(eid);
  ensureEventToHubFirestoreListener(eid);
  if (!forceRefresh && _eventToHubStateCache.has(eid)) {
    const cached = _eventToHubStateCache.get(eid);
    if (Date.now() - (cached._fetchedAt || 0) < 12000) {
      updateEventNewsTabBadge(eid);
      return cached;
    }
  }
  try {
    const res = await window.api.getEventToHubState(eid, forceRefresh);
    if (res && !res.error) {
      res._fetchedAt = Date.now();
      const normClock = res.clock || res.master_clock || res.masterClock || null;
      res.clock = normClock;
      res.master_clock = normClock;
      _eventToHubStateCache.set(eid, res);
      updateEventNewsTabBadge(eid);
      if (normClock && normClock.status === 'running') {
        startToHubClockTicker(eid);
      }
      if (currentOpenEventId && String(currentOpenEventId) === eid && currentEventData) {
        renderEventClockAndScheduleWidgets(currentEventData, true);
        if (currentEventModalTab === 'news') {
          renderEventNewsHub(currentEventData, true);
        } else if (currentEventModalTab === 'to-hub' || currentEventModalTab === 'player') {
          if (_currentMyStationSubtab && _currentMyStationSubtab.startsWith('to-')) {
            renderEventToHub(currentEventData, true);
          }
        } else if (currentEventModalTab === 'matches') {
          renderEventPairingsRows(currentEventPairingsRound || 'all');
        }
      }
      if (typeof syncGlobalEventAnnouncementBanner === 'function') {
        syncGlobalEventAnnouncementBanner().catch(() => {});
      }
      return res;
    }
  } catch (err) {
    console.warn('loadEventToHubState warning:', err);
  }
  return _eventToHubStateCache.get(eid) || null;
}

function updateEventNewsTabBadge(eventId) {
  const badge = document.getElementById('event-tab-news-count');
  if (!badge) return;
  const eid = String(eventId || currentOpenEventId || '');
  const state = _eventToHubStateCache.get(eid);
  let count = 0;
  if (state) {
    if (state.active_broadcast && state.active_broadcast.message) count += 1;
    if (Array.isArray(state.news_posts)) count += state.news_posts.length;
  }
  if (count > 0) {
    badge.textContent = String(count);
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

function sanitizeEventDescriptionHtml(rawDesc) {
  if (!rawDesc) return '';
  let text = String(rawDesc).trim();
  if (!text) return '';
  // Strip any script/style/iframe tags while preserving safe formatting tags from BCP
  text = text
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '');
  if (!/<(p|div|br|ul|ol|li|h[1-6]|strong|b|em|i|a)\b/i.test(text)) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
  return text;
}

function computeClockRemainingSeconds(clockObj, defaultLengthMins = 180) {
  if (!clockObj || typeof clockObj !== 'object') {
    return Math.max(0, Math.round(defaultLengthMins * 60));
  }
  const baseRem = Number(clockObj.remaining_seconds ?? clockObj.remainingSeconds ?? (clockObj.durationMinutes ? clockObj.durationMinutes * 60 : (defaultLengthMins * 60)));
  if (clockObj.status === 'running') {
    const targetEnd = Number(clockObj.targetEndTime || clockObj.target_end_time || 0);
    if (targetEnd > 0) {
      return Math.max(0, Math.round((targetEnd - Date.now()) / 1000));
    }
    const rawUp = clockObj.updatedAt ?? clockObj.updated_at;
    if (rawUp !== undefined && rawUp !== null) {
      const updatedMs = typeof rawUp === 'number' ? rawUp : (/^\d+$/.test(String(rawUp)) ? Number(rawUp) : Date.parse(String(rawUp)));
      if (!Number.isNaN(updatedMs) && updatedMs > 0) {
        const elapsed = Math.max(0, Math.floor((Date.now() - updatedMs) / 1000));
        return Math.max(0, Math.round(baseRem) - elapsed);
      }
    }
  }
  return Math.max(0, Math.round(baseRem));
}

function formatClockDurationHms(totalSeconds) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function startToHubClockTicker(eventId) {
  if (_toHubMasterClockInterval) {
    clearInterval(_toHubMasterClockInterval);
    _toHubMasterClockInterval = null;
  }
  _toHubMasterClockInterval = setInterval(() => {
    const eid = String(eventId || currentOpenEventId || '');
    if (!eid || String(currentOpenEventId) !== eid) {
      clearInterval(_toHubMasterClockInterval);
      _toHubMasterClockInterval = null;
      return;
    }
    const state = _eventToHubStateCache.get(eid);
    const bcpCfg = getEventBcpRoundConfig(currentEventData);
    const clockObj = (state && (state.clock || state.master_clock)) ? (state.clock || state.master_clock) : null;
    if (!clockObj || clockObj.status !== 'running') return;
    const rem = computeClockRemainingSeconds(clockObj, bcpCfg.defaultLengthMins);
    const formatted = formatClockDurationHms(rem);
    const clockDisplays = document.querySelectorAll('.live-event-master-clock-readout');
    clockDisplays.forEach(el => {
      el.textContent = formatted;
      if (rem <= 900) {
        el.style.color = '#f87171';
      } else {
        el.style.color = '#fbbf24';
      }
    });
  }, 1000);
}

function buildEventRoundClockAndScheduleCardHtml(ev, skipFetch = false) {
  const eventObj = ev || currentEventData;
  if (!eventObj) return '';
  const eventId = String(eventObj.id || eventObj.event_id || currentOpenEventId || '');
  if (!skipFetch && eventId && !_eventToHubStateCache.has(eventId)) {
    loadEventToHubState(eventId, false).catch(() => {});
  }
  const state = _eventToHubStateCache.get(eventId) || {};
  const bcpCfg = getEventBcpRoundConfig(eventObj);
  const clockObj = state.clock || state.master_clock || null;
  const clockStatus = (clockObj && clockObj.status) ? String(clockObj.status).toLowerCase() : 'stopped';

  // Only show the clock to players in Pairings & Live / Player Station when a round has been started by the TO ('running' or 'paused')
  if (clockStatus !== 'running' && clockStatus !== 'paused') {
    return '';
  }

  const configuredMins = Number(clockObj?.durationMinutes || clockObj?.duration_minutes || bcpCfg.defaultLengthMins) || bcpCfg.defaultLengthMins;
  const remSec = computeClockRemainingSeconds(clockObj, configuredMins);

  if (clockStatus === 'running') {
    startToHubClockTicker(eventId);
  }

  return `
    <!-- Live Round Clock Card (Visible only while round is active) -->
    <div class="card event-round-clock-schedule-card" style="padding:0.85rem 1.1rem; background:rgba(15,23,42,0.88); border:1px solid ${clockStatus === 'running' ? 'rgba(34,197,94,0.4)' : 'rgba(245,158,11,0.4)'}; border-radius:10px;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:0.75rem; flex-wrap:wrap;">
        <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;">
          <span style="font-size:0.82rem; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#38bdf8;">⏱️ Live Round Clock</span>
          <span class="badge" style="background:${clockStatus === 'running' ? 'rgba(34,197,94,0.18)' : 'rgba(245,158,11,0.18)'}; color:${clockStatus === 'running' ? '#4ade80' : '#fbbf24'}; border:1px solid ${clockStatus === 'running' ? 'rgba(34,197,94,0.4)' : 'rgba(245,158,11,0.4)'}; font-size:0.7rem; font-weight:800;">
            ${clockStatus === 'running' ? '🔴 ROUND IN PROGRESS' : '⏸️ ROUND CLOCK PAUSED'}
          </span>
          <span style="font-size:0.75rem; color:var(--text-muted);">(${configuredMins} min round limit)</span>
        </div>
        <div class="live-event-master-clock-readout" style="font-family:var(--font-mono); font-size:1.55rem; font-weight:900; color:${clockStatus === 'running' ? '#fbbf24' : '#e2e8f0'}; letter-spacing:0.03em;">
          ${formatClockDurationHms(remSec)}
        </div>
      </div>
    </div>
  `;
}

function renderEventClockAndScheduleWidgets(ev, skipFetch = false) {
  const eventObj = ev || currentEventData;
  if (!eventObj) return;
  const html = buildEventRoundClockAndScheduleCardHtml(eventObj, skipFetch);
  const matchesWrap = document.getElementById('event-matches-clock-schedule-wrap');
  if (matchesWrap) {
    if (html) {
      matchesWrap.innerHTML = html;
      matchesWrap.style.display = 'block';
    } else {
      matchesWrap.innerHTML = '';
      matchesWrap.style.display = 'none';
    }
  }
  const playerWrap = document.getElementById('player-station-clock-schedule-wrap');
  if (playerWrap) {
    if (html) {
      playerWrap.innerHTML = html;
      playerWrap.style.display = 'block';
    } else {
      playerWrap.innerHTML = '';
      playerWrap.style.display = 'none';
    }
  }
}

// ----------------------------------------------------------------------------
// PUBLIC 📰 NEWS & INFO TAB
// ----------------------------------------------------------------------------
async function renderEventNewsHub(ev, skipFetch = false) {
  const container = document.getElementById('event-news-hub-container');
  if (!container) return;
  const eventObj = ev || currentEventData;
  if (!eventObj) return;

  const eventId = String(eventObj.id || eventObj.event_id || currentOpenEventId || '');
  if (!skipFetch && !_eventToHubStateCache.has(eventId)) {
    loadEventToHubState(eventId, false).catch(() => {});
  }

  const state = _eventToHubStateCache.get(eventId) || {};
  const raw = (eventObj.raw_json && typeof eventObj.raw_json === 'object') ? eventObj.raw_json : eventObj;
  const canTo = canUserAccessEventToHub(eventObj);
  const activeBroadcast = state.active_broadcast && state.active_broadcast.message ? state.active_broadcast : null;
  const newsPosts = Array.isArray(state.news_posts) ? state.news_posts : [];

  const externalUrl = String(raw.externalUrl || eventObj.external_url || '').trim();
  const descriptionRaw = raw.description || raw.eventDescription || eventObj.description || '';
  const descriptionHtml = sanitizeEventDescriptionHtml(descriptionRaw);

  const broadcastBannerHtml = activeBroadcast ? (() => {
    const lvl = String(activeBroadcast.level || 'info').toLowerCase();
    const borderCol = lvl === 'urgent' ? 'rgba(239,68,68,0.55)' : (lvl === 'warning' ? 'rgba(245,158,11,0.55)' : 'rgba(56,189,248,0.45)');
    const bgCol = lvl === 'urgent' ? 'rgba(127,29,29,0.28)' : (lvl === 'warning' ? 'rgba(120,53,15,0.28)' : 'rgba(12,74,110,0.28)');
    const icon = lvl === 'urgent' ? '🚨' : (lvl === 'warning' ? '⚠️' : '📢');
    const timeStr = activeBroadcast.published_at ? new Date(activeBroadcast.published_at).toLocaleString() : 'Live Now';
    return `
      <div class="news-pinned-broadcast-card" style="background:${bgCol}; border:1px solid ${borderCol}; border-radius:10px; padding:0.95rem 1.15rem; margin-bottom:1.1rem; display:flex; align-items:flex-start; justify-content:space-between; gap:0.85rem; flex-wrap:wrap;">
        <div style="display:flex; align-items:flex-start; gap:0.75rem; flex:1; min-width:240px;">
          <span style="font-size:1.35rem; line-height:1;">${icon}</span>
          <div>
            <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.25rem;">
              <span style="font-size:0.7rem; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; padding:0.15rem 0.5rem; border-radius:999px; background:rgba(255,255,255,0.12); color:#fff;">PINNED TO BROADCAST</span>
              <span style="font-size:0.75rem; color:var(--text-secondary);">By ${escapeHtml(activeBroadcast.author_name || 'Tournament Organizer')} • ${escapeHtml(timeStr)}</span>
            </div>
            <div style="font-size:0.98rem; font-weight:700; color:#f8fafc; line-height:1.45;">${escapeHtml(activeBroadcast.message)}</div>
          </div>
        </div>
      </div>
    `;
  })() : '';

  const newsPostsHtml = newsPosts.length > 0
    ? newsPosts.map(post => {
        const cat = String(post.category || 'announcement').toLowerCase();
        const catBadge = cat === 'schedule'
          ? `<span class="badge" style="background:rgba(56,189,248,0.16); color:#38bdf8; border:1px solid rgba(56,189,248,0.35); font-size:0.68rem;">⏱️ Schedule</span>`
          : (cat === 'mission'
              ? `<span class="badge" style="background:rgba(168,85,247,0.16); color:#c084fc; border:1px solid rgba(168,85,247,0.35); font-size:0.68rem;">🗺️ Mission / Pairings</span>`
              : (cat === 'awards'
                  ? `<span class="badge" style="background:rgba(250,204,21,0.16); color:#facc15; border:1px solid rgba(250,204,21,0.35); font-size:0.68rem;">🏆 Awards</span>`
                  : `<span class="badge" style="background:rgba(245,158,11,0.16); color:#fbbf24; border:1px solid rgba(245,158,11,0.35); font-size:0.68rem;">📢 Bulletin</span>`));
        const pinnedBadge = post.pinned
          ? `<span class="badge" style="background:rgba(239,68,68,0.18); color:#f87171; border:1px solid rgba(239,68,68,0.35); font-size:0.68rem;">📌 Pinned</span>`
          : '';
        const dtStr = post.created_at ? new Date(post.created_at).toLocaleString() : '';
        return `
          <div class="card" style="padding:0.95rem 1.1rem; background:rgba(15,23,42,0.75); border:1px solid rgba(255,255,255,0.09); border-radius:10px; margin-bottom:0.75rem;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.4rem;">
              <div style="display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap;">
                ${pinnedBadge}
                ${catBadge}
                <h4 style="margin:0; font-size:0.96rem; font-weight:800; color:#f8fafc;">${escapeHtml(post.title || 'Event Update')}</h4>
              </div>
              <span style="font-size:0.72rem; color:var(--text-muted);">${escapeHtml(post.author_name || 'TO')} • ${escapeHtml(dtStr)}</span>
            </div>
            <div style="font-size:0.86rem; color:#cbd5e1; line-height:1.55; white-space:pre-wrap;">${escapeHtml(post.body || '')}</div>
          </div>
        `;
      }).join('')
    : `
      <div style="padding:1.35rem; text-align:center; background:rgba(15,23,42,0.45); border:1px dashed rgba(255,255,255,0.12); border-radius:10px; color:var(--text-muted); font-size:0.85rem;">
        No TO bulletin posts published yet for this event.
      </div>
    `;

  const locInfo = extractEventLocationDetails(eventObj);
  const venueCardHtml = locInfo.hasLocation ? (() => {
    const mapQuery = locInfo.hasCoords
      ? `${locInfo.lat},${locInfo.lng}`
      : (locInfo.mapSearchQuery || locInfo.fullAddressLine || locInfo.venueLine);
    const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
    const copyPayload = (locInfo.fullAddressLine || locInfo.displayLabel || '').replace(/'/g, "\\'");
    return `
      <!-- Event Venue & Address Card -->
      <div class="card event-news-venue-card" style="padding:1.05rem 1.25rem; background:linear-gradient(135deg, rgba(15,23,42,0.9), rgba(30,41,59,0.75)); border:1px solid rgba(56,189,248,0.25); border-radius:10px; margin-bottom:1.15rem; display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap;">
        <div style="display:flex; align-items:flex-start; gap:0.85rem; flex:1; min-width:240px;">
          <div style="width:42px; height:42px; border-radius:10px; background:rgba(56,189,248,0.14); border:1px solid rgba(56,189,248,0.35); display:flex; align-items:center; justify-content:center; font-size:1.3rem; flex-shrink:0;">
            📍
          </div>
          <div style="min-width:0;">
            <div style="font-size:0.7rem; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:#38bdf8; margin-bottom:0.15rem;">
              Event Venue & Location
            </div>
            <div style="font-size:1.02rem; font-weight:800; color:#f8fafc; line-height:1.35;">
              ${escapeHtml(locInfo.venueLine || locInfo.cityStateCountry || 'Event Venue')}
            </div>
            <div style="font-size:0.84rem; color:#cbd5e1; margin-top:0.2rem; line-height:1.4;">
              ${escapeHtml(locInfo.addressLine || locInfo.cityStateCountry || locInfo.fullAddressLine)}
            </div>
            ${(locInfo.cityStateCountry && locInfo.addressLine && !locInfo.addressLine.toLowerCase().includes(locInfo.cityStateCountry.toLowerCase())) ? `
              <div style="font-size:0.78rem; color:var(--text-muted); margin-top:0.12rem;">
                🌍 ${escapeHtml(locInfo.cityStateCountry)}
              </div>
            ` : ''}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" onclick="openEventVenueMapModal('${escapeHtml(eventId)}')" style="font-size:0.78rem; font-weight:700; padding:0.44rem 0.85rem; cursor:pointer;">
            🗺️ Interactive Map Pop-up
          </button>
          <button type="button" class="btn btn-outline" onclick="openEventInCommunityGameStores('${escapeHtml(eventId)}')" style="font-size:0.78rem; font-weight:700; padding:0.44rem 0.85rem; border-color:rgba(168,85,247,0.45); color:#c084fc; background:rgba(168,85,247,0.1); cursor:pointer;">
            🏪 Community Hub → Game Stores
          </button>
          <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="font-size:0.78rem; font-weight:600; padding:0.44rem 0.85rem; text-decoration:none;">
            🧭 Google Maps ↗
          </a>
          <button type="button" class="btn btn-outline" onclick="copyEventVenueAddress('${escapeHtml(copyPayload)}')" style="font-size:0.78rem; font-weight:600; padding:0.44rem 0.75rem; cursor:pointer;" title="Copy full venue address">
            📋 Copy Address
          </button>
        </div>
      </div>
    `;
  })() : '';

  container.innerHTML = `
    <div class="event-news-hub-wrap" style="padding:0.25rem 0;">
      ${broadcastBannerHtml}
      ${venueCardHtml}

      <!-- Official BCP Event Description & Rules Pack (On Top) -->
      <div class="card" style="padding:1.15rem 1.25rem; background:rgba(15,23,42,0.75); border:1px solid rgba(255,255,255,0.08); border-radius:10px; margin-bottom:1.15rem;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.75rem; flex-wrap:wrap; margin-bottom:0.75rem; padding-bottom:0.65rem; border-bottom:1px solid rgba(255,255,255,0.08);">
          <div>
            <h3 style="margin:0; font-size:1.02rem; font-weight:800; color:#f8fafc;">📜 Official Event Details & Player Pack Information</h3>
            <span style="font-size:0.72rem; color:var(--text-muted);">Synced from Best Coast Pairings</span>
          </div>
          <div style="display:flex; align-items:center; gap:0.55rem; flex-wrap:wrap;">
            ${externalUrl ? `
              <a href="${escapeHtml(externalUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="font-size:0.78rem; font-weight:700; padding:0.42rem 0.85rem; text-decoration:none;">
                📘 Official Player Pack / Rules Doc ↗
              </a>
            ` : ''}
            <a href="https://www.bestcoastpairings.com/event/${encodeURIComponent(eventId)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="font-size:0.78rem; font-weight:600; padding:0.42rem 0.85rem; text-decoration:none;">
              🔗 BCP Event Page ↗
            </a>
          </div>
        </div>
        ${descriptionHtml ? `
          <div class="event-bcp-description-body" style="font-size:0.88rem; color:#cbd5e1; line-height:1.65; overflow-wrap:break-word;">
            ${descriptionHtml}
          </div>
        ` : `
          <div style="font-size:0.85rem; color:var(--text-muted);">
            No additional text description provided on Best Coast Pairings. Use the links above to open the official BCP event page or player pack.
          </div>
        `}
      </div>

      <!-- TO News & Bulletins Feed -->
      <div class="card" style="padding:1.1rem 1.2rem; background:rgba(15,23,42,0.75); border:1px solid rgba(255,255,255,0.08); border-radius:10px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.85rem;">
          <div>
            <h3 style="margin:0; font-size:1.05rem; font-weight:800; color:#fff;">📰 Tournament Bulletins & News Feed</h3>
            <div style="font-size:0.78rem; color:var(--text-secondary);">Official announcements, mission updates, and schedule notes posted by the TO staff.</div>
          </div>
        </div>
        <div>
          ${newsPostsHtml}
        </div>
      </div>
    </div>
  `;
}

// ----------------------------------------------------------------------------
// RESTRICTED 🏛️ TO HUB (4 OPERATIONAL SUB-TABS)
// ----------------------------------------------------------------------------
function isToHubMatchCompleted(m) {
  if (!m) return false;
  if (m.completed === true || m.is_completed === true) return true;
  if (m.winner_id || m.result !== undefined && m.result !== null && m.result !== '') {
    const s1 = Number(m.player1_score ?? m.score1 ?? 0);
    const s2 = Number(m.player2_score ?? m.score2 ?? 0);
    if (s1 > 0 || s2 > 0 || m.winner_id || Number(m.result) > 0) return true;
  }
  const s1 = Number(m.player1_score ?? m.score1 ?? -1);
  const s2 = Number(m.player2_score ?? m.score2 ?? -1);
  return (s1 > 0 || s2 > 0);
}

function switchEventToHubSubtab(subtab) {
  if (subtab === 'radar') {
    if (typeof switchEventModalTab === 'function') {
      switchEventModalTab('matches');
    }
    return;
  }
  if (!['clock', 'announcements', 'roster'].includes(subtab)) {
    subtab = 'clock';
  }
  _currentToHubSubtab = subtab;
  _currentMyStationSubtab = `to-${subtab}`;
  if (currentEventModalTab === 'player' && typeof switchMyStationSubtab === 'function') {
    switchMyStationSubtab(`to-${subtab}`);
    return;
  }
  if (currentEventData) {
    renderEventToHub(currentEventData, true);
  }
}

async function renderEventToHub(ev, skipFetch = false) {
  const container = document.getElementById('event-to-hub-container');
  if (!container) return;
  const eventObj = (ev && typeof ev === 'object') ? ev : currentEventData;
  if (!eventObj) return;

  const roleLabel = getUserEventOrganizerRole(eventObj);
  if (!roleLabel) {
    container.innerHTML = `
      <div class="card" style="padding:2rem; text-align:center; color:var(--text-muted);">
        🔒 TO tools are restricted to verified Event Owners, Tournament Organizers, and Judges for this tournament.
      </div>
    `;
    return;
  }

  const eventId = String(eventObj.id || eventObj.event_id || currentOpenEventId || '');
  if (!skipFetch && !_eventToHubStateCache.has(eventId)) {
    loadEventToHubState(eventId, false).catch(() => {});
  }

  const state = _eventToHubStateCache.get(eventId) || {};
  const players = Array.isArray(eventPlayersCache) && eventPlayersCache.length > 0
    ? eventPlayersCache
    : (Array.isArray(eventObj.players) ? eventObj.players : []);
  const matches = Array.isArray(eventMatchesCache) && eventMatchesCache.length > 0
    ? eventMatchesCache
    : (Array.isArray(eventObj.matches) ? eventObj.matches : []);
  const judgeCalls = Array.isArray(state.judge_calls) ? state.judge_calls : [];

  // Rounds calculation
  const roundNums = Array.from(new Set(matches.map(m => Number(m.round || m.round_number || 1)).filter(n => n > 0))).sort((a, b) => a - b);
  const maxRound = roundNums.length > 0 ? roundNums[roundNums.length - 1] : 1;
  if (!_toHubRadarRound || !roundNums.includes(Number(_toHubRadarRound))) {
    _toHubRadarRound = maxRound;
  }

  if (!['clock', 'announcements', 'roster'].includes(_currentToHubSubtab)) {
    _currentToHubSubtab = 'clock';
  }

  const bcpCfg = getEventBcpRoundConfig(eventObj);
  const clockObj = state.clock || state.master_clock || null;
  if (clockObj && clockObj.status === 'running') {
    startToHubClockTicker(eventId);
  }

  let subtabBodyHtml = '';
  if (_currentToHubSubtab === 'clock') {
    subtabBodyHtml = renderToHubClockAndJudgeSubtab(eventId, eventObj, roundNums, bcpCfg, clockObj, judgeCalls);
  } else if (_currentToHubSubtab === 'announcements') {
    subtabBodyHtml = renderToHubAnnouncementsSubtab(eventId, eventObj, state);
  } else if (_currentToHubSubtab === 'roster') {
    subtabBodyHtml = renderToHubRosterAuditSubtab(eventId, eventObj, players);
  }

  container.innerHTML = `
    <div class="to-hub-shell" style="display:flex; flex-direction:column; gap:0.9rem;">
      <div class="to-hub-subtab-body">
        ${subtabBodyHtml}
      </div>
    </div>
  `;
}

// ----------------------------------------------------------------------------
// SUB-TAB 1: 📊 FLOOR & TABLE RADAR
// ----------------------------------------------------------------------------
function setToHubRadarRound(roundNum) {
  _toHubRadarRound = Number(roundNum) || 1;
  if (currentEventData) renderEventToHub(currentEventData, true);
}

function setToHubRadarFilter(filter) {
  _toHubRadarFilter = filter || 'all';
  if (currentEventData) renderEventToHub(currentEventData, true);
}

function handleToHubRadarSearch(val) {
  _toHubRadarSearch = String(val || '').trim().toLowerCase();
  const gridEl = document.getElementById('to-hub-radar-grid');
  if (gridEl && currentEventData && _currentToHubSubtab === 'radar') {
    const eventId = String(currentEventData.id || currentEventData.event_id || currentOpenEventId || '');
    const state = _eventToHubStateCache.get(eventId) || {};
    const judgeCalls = Array.isArray(state.judge_calls) ? state.judge_calls : [];
    const openJudgeCalls = judgeCalls.filter(c => String(c.status || 'open').toLowerCase() !== 'resolved');
    const activeSessions = Array.isArray(state.active_sessions) ? state.active_sessions : [];
    const roundMatches = Array.isArray(window._toHubCurrentRoundMatches) ? window._toHubCurrentRoundMatches : [];
    gridEl.innerHTML = buildToHubRadarGridHtml(eventId, roundMatches, openJudgeCalls, activeSessions);
    return;
  }
  if (currentEventData) renderEventToHub(currentEventData, true);
}

function buildToHubRadarGridHtml(eventId, roundMatches, openJudgeCalls, activeSessions) {
  ensureEventSearchIndex();
  const totalTables = Array.isArray(roundMatches) ? roundMatches.length : 0;
  if (totalTables === 0) {
    return `
      <div class="card" style="grid-column:1 / -1; padding:1.75rem; text-align:center; color:var(--text-muted); background:rgba(15,23,42,0.5);">
        No pairings published yet for this round on BCP.
      </div>
    `;
  }

  const judgeTableSet = new Set((openJudgeCalls || []).map(c => String(c.table_num || '').trim()).filter(Boolean));
  const trackerTableSet = new Set((activeSessions || []).map(s => String(s.table_num || s.table_number || '').trim()).filter(Boolean));
  const cardsHtml = [];

  for (let idx = 0; idx < roundMatches.length; idx++) {
    const m = roundMatches[idx];
    if (!m) continue;
    const tNum = String(m.table ?? m.table_number ?? (idx + 1));
    const isDone = isToHubMatchCompleted(m);
    const hasJudge = judgeTableSet.has(tNum);
    const hasTracker = trackerTableSet.has(tNum) || Boolean(m.live_session_id || m.tracker_active);

    if (_toHubRadarFilter === 'unfinished' && isDone) continue;
    if (_toHubRadarFilter === 'completed' && !isDone) continue;
    if (_toHubRadarFilter === 'tracker' && !hasTracker) continue;
    if (_toHubRadarFilter === 'judge' && !hasJudge) continue;
    if (_toHubRadarSearch) {
      const tSearch = `table ${tNum} t${tNum}`;
      const mSearch = m._searchText || `${m.player1_name || ''} ${m.player2_name || ''} ${m.player1_faction || ''} ${m.player2_faction || ''}`.toLowerCase();
      if (!tSearch.includes(_toHubRadarSearch) && !mSearch.includes(_toHubRadarSearch)) continue;
    }

    const s1 = m.player1_score ?? m.score1 ?? '-';
    const s2 = m.player2_score ?? m.score2 ?? '-';
    const roundVal = Number(m.round || m.round_number || _toHubRadarRound || 1);
    const p1Rec = m._p1Record !== undefined ? m._p1Record : lookupEventPlayerFast(m.player1_id, m.player1_name);
    const p2Rec = m._p2Record !== undefined ? m._p2Record : lookupEventPlayerFast(m.player2_id, m.player2_name);
    const p1ListRaw = String(m.player1_list_id || (p1Rec && (p1Rec.list_id || p1Rec.listId)) || '');
    const p2ListRaw = String(m.player2_list_id || (p2Rec && (p2Rec.list_id || p2Rec.listId)) || '');
    const p1HasList = Boolean((p1Rec && hasPlayerSubmittedList(p1Rec)) || p1ListRaw);
    const p2NameRaw = String(m.player2_name || 'Player 2').trim();
    const isByeP2 = Boolean(m.is_bye || p2NameRaw.toUpperCase() === 'BYE');
    const p2HasList = Boolean(!isByeP2 && ((p2Rec && hasPlayerSubmittedList(p2Rec)) || p2ListRaw));

    const cardKey = `${eventId}:${roundVal}:${idx}:${tNum}:${isDone ? 1 : 0}:${hasJudge ? 1 : 0}:${hasTracker ? 1 : 0}:${s1}:${s2}:${p1HasList ? 1 : 0}:${p2HasList ? 1 : 0}:${p1ListRaw}:${p2ListRaw}`;
    if (m._cachedRadarCardKey === cardKey && m._cachedRadarCardHtml) {
      cardsHtml.push(m._cachedRadarCardHtml);
      continue;
    }

    const matchId = m.tracker_match_id || `BCP-${eventId}-R${roundVal}-T${tNum}`;
    const safeMatchId = String(matchId).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const targetP1Id = String((p1Rec && (p1Rec.player_id || p1Rec.id)) || m.player1_id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const targetP1Name = String((p1Rec && (p1Rec.full_name || p1Rec.name)) || m.player1_name || 'Player 1').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const targetP2Id = String((p2Rec && (p2Rec.player_id || p2Rec.id)) || m.player2_id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const targetP2Name = String((p2Rec && (p2Rec.full_name || p2Rec.name)) || p2NameRaw).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const safeP1ListId = p1ListRaw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const safeP2ListId = p2ListRaw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    const p1FacDisplay = (p1Rec && p1Rec._displayFac) || formatEventPlayerFaction(m.player1_faction || p1Rec?.faction || '');
    const p2FacDisplay = isByeP2 ? 'BYE' : ((p2Rec && p2Rec._displayFac) || formatEventPlayerFaction(m.player2_faction || p2Rec?.faction || ''));

    const borderCol = hasJudge
      ? 'rgba(239,68,68,0.55)'
      : (isDone ? 'rgba(34,197,94,0.32)' : 'rgba(245,158,11,0.4)');
    const statusBadge = hasJudge
      ? `<span class="badge" style="background:rgba(239,68,68,0.22); color:#fca5a5; border:1px solid rgba(239,68,68,0.45); font-size:0.66rem;">🚨 JUDGE CALL</span>`
      : (isDone
          ? `<span class="badge" style="background:rgba(34,197,94,0.16); color:#4ade80; border:1px solid rgba(34,197,94,0.35); font-size:0.66rem;">✅ FINAL</span>`
          : `<span class="badge" style="background:rgba(245,158,11,0.18); color:#fbbf24; border:1px solid rgba(245,158,11,0.38); font-size:0.66rem;">⏳ IN PROGRESS</span>`);

    const scorecardBtnHtml = !isByeP2
      ? `<button type="button" class="btn-xs btn-outline to-hub-scorecard-btn" onclick="event.stopPropagation(); openScorecardModal('${escapeHtml(safeMatchId)}')" title="View Table ${escapeHtml(tNum)} Scorecard" style="font-size:0.64rem; padding:2px 6px; border-radius:5px; color:#e2e8f0; border:1px solid rgba(255,255,255,0.18); background:rgba(255,255,255,0.06); cursor:pointer; font-weight:700; display:inline-flex; align-items:center; gap:3px; line-height:1.25;">📄 Scorecard</button>`
      : '';

    const p1RosterBtnHtml = `<button type="button" class="btn-xs btn-outline to-hub-roster-btn" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(targetP1Id)}', '${escapeHtml(targetP1Name)}', '${escapeHtml(safeP1ListId)}')" title="View ${escapeHtml(m.player1_name || 'Player 1')}'s Army Roster" style="font-size:0.62rem; padding:1px 5px; border-radius:4px; color:${p1HasList ? '#38bdf8' : '#94a3b8'}; border:1px solid ${p1HasList ? 'rgba(56,189,248,0.38)' : 'rgba(148,163,184,0.28)'}; background:${p1HasList ? 'rgba(56,189,248,0.1)' : 'rgba(255,255,255,0.04)'}; cursor:pointer; font-weight:600; display:inline-flex; align-items:center; gap:2px; line-height:1.25; flex-shrink:0;">📋 Roster</button>`;

    const p2RosterBtnHtml = !isByeP2
      ? `<button type="button" class="btn-xs btn-outline to-hub-roster-btn" onclick="event.stopPropagation(); openEventPlayerListModal('${escapeHtml(targetP2Id)}', '${escapeHtml(targetP2Name)}', '${escapeHtml(safeP2ListId)}')" title="View ${escapeHtml(p2NameRaw)}'s Army Roster" style="font-size:0.62rem; padding:1px 5px; border-radius:4px; color:${p2HasList ? '#38bdf8' : '#94a3b8'}; border:1px solid ${p2HasList ? 'rgba(56,189,248,0.38)' : 'rgba(148,163,184,0.28)'}; background:${p2HasList ? 'rgba(56,189,248,0.1)' : 'rgba(255,255,255,0.04)'}; cursor:pointer; font-weight:600; display:inline-flex; align-items:center; gap:2px; line-height:1.25; flex-shrink:0;">📋 Roster</button>`
      : '';

    const cardHtml = `
      <div class="card to-hub-table-card" onclick="openToHubTableCommsModal(${idx}, 'table')" title="Click Table or Player to send Announcement or Direct Chat" style="padding:0.75rem 0.9rem; background:rgba(15,23,42,0.82); border:1px solid ${borderCol}; border-radius:10px; display:flex; flex-direction:column; gap:0.45rem; cursor:pointer; transition:transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.35rem; flex-wrap:wrap;">
          <span style="font-family:var(--font-mono); font-weight:800; font-size:0.84rem; color:#f8fafc; display:inline-flex; align-items:center; gap:0.35rem;">
            Table ${escapeHtml(tNum)}
            <span class="to-hub-table-comms-hint" style="font-size:0.68rem; color:#38bdf8; font-weight:700; opacity:0.85;">📢 💬</span>
          </span>
          <div style="display:flex; align-items:center; gap:0.3rem; flex-wrap:wrap;">
            ${scorecardBtnHtml}
            ${hasTracker ? `<span class="badge" style="background:rgba(56,189,248,0.16); color:#38bdf8; font-size:0.64rem;">📱 Tracker</span>` : ''}
            ${statusBadge}
          </div>
        </div>
        <div class="to-hub-player-click-row" onclick="event.stopPropagation(); openToHubTableCommsModal(${idx}, 'p1')" title="Message or announce to ${escapeHtml(m.player1_name || 'Player 1')}" style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; font-size:0.82rem; padding:0.2rem 0.35rem; margin:0 -0.35rem; border-radius:6px;">
          <div style="min-width:0; flex:1;">
            <div style="font-weight:700; color:#e2e8f0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:0.3rem;">
              <span style="overflow:hidden; text-overflow:ellipsis;">${escapeHtml(m.player1_name || 'Player 1')}</span>
              <span class="to-hub-player-msg-icon" style="font-size:0.68rem; color:#38bdf8; flex-shrink:0;">💬</span>
            </div>
            <div style="display:flex; align-items:center; gap:0.35rem; margin-top:2px; min-width:0;">
              <span style="font-size:0.7rem; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(p1FacDisplay)}</span>
              ${p1RosterBtnHtml}
            </div>
          </div>
          <span onclick="event.stopPropagation(); ${!isByeP2 ? `openScorecardModal('${escapeHtml(safeMatchId)}')` : ''}" title="${!isByeP2 ? `View Table ${escapeHtml(tNum)} Scorecard` : ''}" style="font-family:var(--font-mono); font-weight:800; font-size:0.92rem; color:${isDone ? '#4ade80' : '#94a3b8'}; padding:2px 4px; border-radius:4px;">${escapeHtml(String(s1))}</span>
        </div>
        <div class="to-hub-player-click-row" onclick="event.stopPropagation(); openToHubTableCommsModal(${idx}, '${isByeP2 ? 'table' : 'p2'}')" title="${isByeP2 ? 'Table Actions' : `Message or announce to ${escapeHtml(p2NameRaw)}`}" style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; font-size:0.82rem; padding:0.3rem 0.35rem 0.2rem; margin:0 -0.35rem; border-top:1px solid rgba(255,255,255,0.06); border-radius:0 0 6px 6px;">
          <div style="min-width:0; flex:1;">
            <div style="font-weight:700; color:#e2e8f0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:0.3rem;">
              <span style="overflow:hidden; text-overflow:ellipsis;">${escapeHtml(p2NameRaw)}</span>
              ${!isByeP2 ? `<span class="to-hub-player-msg-icon" style="font-size:0.68rem; color:#38bdf8; flex-shrink:0;">💬</span>` : ''}
            </div>
            <div style="display:flex; align-items:center; gap:0.35rem; margin-top:2px; min-width:0;">
              <span style="font-size:0.7rem; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(p2FacDisplay)}</span>
              ${p2RosterBtnHtml}
            </div>
          </div>
          <span onclick="event.stopPropagation(); ${!isByeP2 ? `openScorecardModal('${escapeHtml(safeMatchId)}')` : ''}" title="${!isByeP2 ? `View Table ${escapeHtml(tNum)} Scorecard` : ''}" style="font-family:var(--font-mono); font-weight:800; font-size:0.92rem; color:${isDone ? '#38bdf8' : '#94a3b8'}; padding:2px 4px; border-radius:4px;">${escapeHtml(String(s2))}</span>
        </div>
      </div>
    `;
    m._cachedRadarCardKey = cardKey;
    m._cachedRadarCardHtml = cardHtml;
    cardsHtml.push(cardHtml);
  }

  if (cardsHtml.length === 0) {
    return `
      <div class="card" style="grid-column:1 / -1; padding:1.75rem; text-align:center; color:var(--text-muted); background:rgba(15,23,42,0.5);">
        No tables match the selected floor filter.
      </div>
    `;
  }
  return cardsHtml.join('');
}

function copyUnfinishedTablesList(eventId, roundNum) {
  const eId = String(eventId || currentOpenEventId || (currentEventData && currentEventData.id) || '');
  const allMatches = Array.isArray(eventMatchesCache) && eventMatchesCache.length > 0
    ? eventMatchesCache
    : (Array.isArray(currentEventData?.matches) ? currentEventData.matches : []);
  const roundNums = Array.from(new Set(allMatches.map(m => Number(m.round || m.round_number || 1)).filter(n => n > 0))).sort((a, b) => a - b);
  const rNum = Number(roundNum) || Number(_toHubRadarRound) || (selectedEventRound !== 'all' ? Number(selectedEventRound) : 0) || (roundNums.length > 0 ? roundNums[roundNums.length - 1] : 1);
  const matches = allMatches.filter(m => Number(m.round || m.round_number || 1) === Number(rNum) && !isToHubMatchCompleted(m));
  if (matches.length === 0) {
    if (typeof showToast === 'function') showToast(`All tables in Round ${rNum} are completed!`, 'info');
    return;
  }
  const lines = matches.map((m, idx) => {
    const tNum = m.table || m.table_number || (idx + 1);
    return `Table ${tNum}: ${m.player1_name || 'Player 1'} vs ${m.player2_name || 'Player 2'}`;
  });
  const text = `⏳ Round ${rNum} Unfinished Tables (${matches.length}):\n` + lines.join('\n');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      if (typeof showToast === 'function') showToast(`Copied ${matches.length} unfinished table(s) to clipboard!`, 'success');
    }).catch(() => {});
  }
}
function copyUnfinishedTablesToClipboard(eventId, roundNum) {
  return copyUnfinishedTablesList(eventId, roundNum);
}
window.copyUnfinishedTablesToClipboard = copyUnfinishedTablesToClipboard;

async function broadcastUnfinishedTablesPing(eventId, roundNum) {
  const eId = String(eventId || currentOpenEventId || (currentEventData && currentEventData.id) || '');
  const allMatches = Array.isArray(eventMatchesCache) && eventMatchesCache.length > 0
    ? eventMatchesCache
    : (Array.isArray(currentEventData?.matches) ? currentEventData.matches : []);
  const roundNums = Array.from(new Set(allMatches.map(m => Number(m.round || m.round_number || 1)).filter(n => n > 0))).sort((a, b) => a - b);
  const rNum = Number(roundNum) || Number(_toHubRadarRound) || (selectedEventRound !== 'all' ? Number(selectedEventRound) : 0) || (roundNums.length > 0 ? roundNums[roundNums.length - 1] : 1);
  const matches = allMatches.filter(m => Number(m.round || m.round_number || 1) === Number(rNum) && !isToHubMatchCompleted(m));
  if (matches.length === 0) {
    if (typeof showToast === 'function') showToast(`All tables in Round ${rNum} are already completed!`, 'info');
    return;
  }
  const tableNums = matches.map((m, idx) => `Table ${m.table || m.table_number || (idx + 1)}`).slice(0, 12).join(', ');
  const msg = `⏳ Round ${rNum} Score Submission Reminder: Waiting on ${matches.length} table(s) (${tableNums}${matches.length > 12 ? '...' : ''}). Please submit final scores now!`;
  const evName = (currentEventData && (currentEventData.name || currentEventData.event_name)) || '';
  try {
    recordRecentInteractedEventId(eId);
    await window.api.publishEventToHubAnnouncement(eId, { message: msg, level: 'warning', event_name: evName });
    await loadEventToHubState(eId, true);
    if (typeof syncGlobalEventAnnouncementBanner === 'function') {
      await syncGlobalEventAnnouncementBanner(true);
    }
    if (typeof showToast === 'function') showToast('Published live score reminder banner to all players!', 'success');
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Failed to publish reminder', 'error');
  }
}
function pingAllUnfinishedTables(eventId, roundNum) {
  return broadcastUnfinishedTablesPing(eventId, roundNum);
}
window.pingAllUnfinishedTables = pingAllUnfinishedTables;

function renderToHubFloorRadarSubtab(eventId, ev, roundNums, roundMatches, completedMatches, unfinishedMatches, openJudgeCalls, activeSessions) {
  window._toHubCurrentRoundMatches = Array.isArray(roundMatches) ? roundMatches : [];
  const totalTables = roundMatches.length;
  const doneCount = completedMatches.length;
  const unfinishedCount = unfinishedMatches.length;
  const pct = totalTables > 0 ? Math.round((doneCount / totalTables) * 100) : 0;

  const roundPillsHtml = (roundNums.length > 0 ? roundNums : [1]).map(r => `
    <button type="button" class="btn ${_toHubRadarRound === r ? 'btn-primary' : 'btn-outline'}" onclick="setToHubRadarRound(${r})" style="font-size:0.76rem; font-weight:700; padding:0.32rem 0.7rem;">
      Round ${r}
    </button>
  `).join('');

  const tablesGridHtml = buildToHubRadarGridHtml(eventId, roundMatches, openJudgeCalls, activeSessions);

  return `
    <div>
      <!-- Round Selector & High-Level Completion Progress -->
      <div class="card" style="padding:0.85rem 1.05rem; background:rgba(15,23,42,0.8); border:1px solid rgba(255,255,255,0.08); border-radius:10px; margin-bottom:0.85rem;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.75rem; flex-wrap:wrap; margin-bottom:0.6rem;">
          <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
            ${roundPillsHtml}
          </div>
          <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;">
            <div style="display:flex; align-items:center; gap:0.45rem; font-size:0.8rem; font-weight:800; font-family:var(--font-mono);">
              <span style="padding:0.22rem 0.55rem; border-radius:6px; background:rgba(34,197,94,0.14); border:1px solid rgba(34,197,94,0.35); color:#4ade80;">
                ✅ ${doneCount} Finished
              </span>
              <span style="padding:0.22rem 0.55rem; border-radius:6px; background:rgba(245,158,11,0.16); border:1px solid rgba(245,158,11,0.38); color:#fbbf24;">
                ⏳ ${unfinishedCount} Unfinished
              </span>
              <span style="color:var(--text-muted); font-size:0.76rem;">(${pct}%)</span>
            </div>
            ${unfinishedCount > 0 ? `
              <button type="button" class="btn btn-primary" onclick="broadcastUnfinishedTablesPing('${escapeHtml(eventId)}', ${_toHubRadarRound})" style="font-size:0.74rem; font-weight:700; padding:0.3rem 0.7rem;">
                📢 Ping Unfinished Tables
              </button>
            ` : ''}
          </div>
        </div>
        <div style="width:100%; height:8px; background:rgba(255,255,255,0.08); border-radius:999px; overflow:hidden;">
          <div style="width:${pct}%; height:100%; background:linear-gradient(90deg, #38bdf8, #4ade80); transition:width 0.3s ease;"></div>
        </div>
      </div>

      <!-- Filter Pills & Search -->
      <div class="to-hub-radar-toolbar" style="display:flex; align-items:center; justify-content:space-between; gap:0.65rem; flex-wrap:wrap; margin-bottom:0.85rem;">
        <div class="to-hub-filter-pills" style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
          <button type="button" class="btn ${_toHubRadarFilter === 'all' ? 'btn-primary' : 'btn-outline'}" onclick="setToHubRadarFilter('all')" style="font-size:0.74rem; padding:0.3rem 0.65rem;">
            All (${totalTables})
          </button>
          <button type="button" class="btn ${_toHubRadarFilter === 'unfinished' ? 'btn-primary' : 'btn-outline'}" onclick="setToHubRadarFilter('unfinished')" style="font-size:0.74rem; padding:0.3rem 0.65rem;">
            ⏳ Unfinished (${unfinishedCount})
          </button>
          <button type="button" class="btn ${_toHubRadarFilter === 'completed' ? 'btn-primary' : 'btn-outline'}" onclick="setToHubRadarFilter('completed')" style="font-size:0.74rem; padding:0.3rem 0.65rem;">
            ✅ Completed (${doneCount})
          </button>
          <button type="button" class="btn ${_toHubRadarFilter === 'judge' ? 'btn-primary' : 'btn-outline'}" onclick="setToHubRadarFilter('judge')" style="font-size:0.74rem; padding:0.3rem 0.65rem;">
            🚨 Judge Call (${openJudgeCalls.length})
          </button>
        </div>
        <input class="to-hub-radar-search-input" type="text" placeholder="Search table # or player..." value="${escapeHtml(_toHubRadarSearch)}" oninput="handleToHubRadarSearch(this.value)" style="padding:0.38rem 0.75rem; border-radius:8px; border:1px solid rgba(255,255,255,0.14); background:rgba(15,23,42,0.85); color:#fff; font-size:0.8rem; min-width:210px; box-sizing:border-box;" />
      </div>

      <!-- Table Radar Grid -->
      <div id="to-hub-radar-grid" class="to-hub-radar-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(250px, 1fr)); gap:0.7rem;">
        ${tablesGridHtml}
      </div>
    </div>
  `;
}

// ----------------------------------------------------------------------------
// SUB-TAB 2: ⏱️ CLOCK & JUDGE CALLS
// ----------------------------------------------------------------------------
async function updateToHubMasterClockAction(action, deltaSeconds = 0) {
  const eventId = String(currentOpenEventId || (currentEventData && currentEventData.id) || '');
  if (!eventId) return;
  const state = _eventToHubStateCache.get(eventId) || {};
  const bcpCfg = getEventBcpRoundConfig(currentEventData);
  const currentClock = state.clock || state.master_clock || {};
  const minsInput = document.getElementById('to-hub-clock-mins-input');
  const roundNum = Number(_toHubRadarRound || currentClock.round_num || currentClock.round) || 1;
  const configuredMins = minsInput ? Number(minsInput.value) || bcpCfg.defaultLengthMins : (Number(currentClock.durationMinutes || currentClock.duration_minutes) || bcpCfg.defaultLengthMins);

  const prevStatus = String(currentClock.status || 'stopped').toLowerCase();
  let rem = computeClockRemainingSeconds(currentClock, configuredMins);
  let nextStatus = prevStatus;

  if (action === 'start') {
    if (prevStatus === 'stopped' || prevStatus === 'idle' || rem <= 0) {
      rem = configuredMins * 60;
    }
    nextStatus = 'running';
  } else if (action === 'pause') {
    nextStatus = 'paused';
  } else if (action === 'stop') {
    rem = configuredMins * 60;
    nextStatus = 'stopped';
  } else if (action === 'reset') {
    rem = configuredMins * 60;
    nextStatus = (prevStatus === 'running' || prevStatus === 'paused') ? 'paused' : 'stopped';
  } else if (action === 'adjust') {
    rem = Math.max(0, rem + Number(deltaSeconds || 0));
  }

  const nowMs = Date.now();
  const targetEndTime = nextStatus === 'running' ? (nowMs + rem * 1000) : null;
  const clockPayload = {
    round: roundNum,
    round_num: roundNum,
    duration_minutes: configuredMins,
    durationMinutes: configuredMins,
    status: nextStatus,
    remaining_seconds: rem,
    remainingSeconds: rem,
    target_end_time: targetEndTime,
    targetEndTime: targetEndTime,
    updatedAt: nowMs,
    updated_at: nowMs,
  };

  // Optimistic local state update so UI and Player Clock visibility update immediately
  const nextState = { ...state, clock: clockPayload, master_clock: clockPayload, _fetchedAt: nowMs };
  _eventToHubStateCache.set(eventId, nextState);
  if (currentEventData) {
    renderEventClockAndScheduleWidgets(currentEventData, true);
    renderEventToHub(currentEventData, true);
  }
  if (nextStatus === 'running') {
    startToHubClockTicker(eventId);
  }

  try {
    // Direct Firestore write for instant real-time propagation (if client SDK active)
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0 && typeof firebase.firestore === 'function') {
      try {
        const db = firebase.firestore();
        await db.collection('tournaments').doc(eventId).set({
          eventId,
          masterClock: clockPayload,
          updatedAt: nowMs,
        }, { merge: true });
      } catch (_) {}
    }

    await window.api.updateEventMasterClock(eventId, clockPayload);
    await loadEventToHubState(eventId, true);
    if (typeof showToast === 'function') {
      if (action === 'start') {
        showToast('▶️ Round Clock STARTED — Live clock is now visible to all players!', 'success');
      } else if (action === 'stop') {
        showToast('⏹️ Round Clock STOPPED — Clock is now hidden from players.', 'info');
      } else {
        showToast(`Master Round Clock updated (${nextStatus.toUpperCase()})`, 'success');
      }
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Failed to update clock', 'error');
  }
}

async function broadcastToHubClockStatus() {
  const eventId = String(currentOpenEventId || (currentEventData && currentEventData.id) || '');
  if (!eventId) return;
  const state = _eventToHubStateCache.get(eventId) || {};
  const bcpCfg = getEventBcpRoundConfig(currentEventData);
  const clockObj = state.clock || state.master_clock || {};
  const rem = computeClockRemainingSeconds(clockObj, bcpCfg.defaultLengthMins);
  const minsLeft = Math.ceil(rem / 60);
  const msg = `⏱️ Live Round Time Check: ${minsLeft} minutes remaining (${formatClockDurationHms(rem)} on Master Clock).`;
  const evName = (currentEventData && (currentEventData.name || currentEventData.event_name)) || '';
  try {
    recordRecentInteractedEventId(eventId);
    await window.api.publishEventToHubAnnouncement(eventId, {
      message: msg,
      level: minsLeft <= 20 ? 'urgent' : 'warning',
      event_name: evName,
    });
    await loadEventToHubState(eventId, true);
    if (typeof syncGlobalEventAnnouncementBanner === 'function') {
      await syncGlobalEventAnnouncementBanner(true);
    }
    if (typeof showToast === 'function') showToast('Broadcasted live round time check!', 'success');
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Failed to broadcast time check', 'error');
  }
}

async function submitToHubJudgeCall() {
  const eventId = String(currentOpenEventId || (currentEventData && currentEventData.id) || '');
  if (!eventId) return;
  const tableEl = document.getElementById('to-hub-judge-table');
  const catEl = document.getElementById('to-hub-judge-category');
  const staffEl = document.getElementById('to-hub-judge-staff');
  const notesEl = document.getElementById('to-hub-judge-notes');
  const tableNum = tableEl ? tableEl.value.trim() : '';
  const category = catEl ? catEl.value : 'Rules Question';
  const staffName = staffEl ? staffEl.value : '';
  const notes = notesEl ? notesEl.value.trim() : '';
  if (!tableNum) {
    if (typeof showToast === 'function') showToast('Please enter a Table #', 'warning');
    return;
  }
  const combinedNotes = staffName ? `[Assigned: ${staffName}] ${notes}` : notes;
  try {
    const payload = {
      event_id: eventId,
      eventId: eventId,
      round_num: _toHubRadarRound || 1,
      table_num: tableNum,
      tableNum: Number(tableNum) || 1,
      category,
      note: combinedNotes,
      notes: combinedNotes,
      status: 'pending',
    };
    if (window.api && typeof window.api.createJudgeCall === 'function') {
      await window.api.createJudgeCall(payload);
    } else {
      await window.api.post('/api/eventstudio/judge_call', payload);
    }
    if (tableEl) tableEl.value = '';
    if (notesEl) notesEl.value = '';
    await loadEventToHubState(eventId, true);
    if (typeof showToast === 'function') showToast(`Logged Judge Call for Table ${tableNum}`, 'success');
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Failed to log judge call', 'error');
  }
}

async function resolveToHubJudgeCall(callId) {
  const eventId = String(currentOpenEventId || (currentEventData && currentEventData.id) || '');
  if (!eventId || !callId) return;
  try {
    const payload = {
      event_id: eventId,
      eventId: eventId,
      call_id: callId,
      callId: callId,
      status: 'resolved',
      assigned_judge: 'TO Hub',
    };
    if (window.api && typeof window.api.resolveJudgeCall === 'function') {
      await window.api.resolveJudgeCall(payload);
    } else {
      await window.api.post('/api/eventstudio/judge_call/resolve', payload);
    }
    await loadEventToHubState(eventId, true);
    if (typeof showToast === 'function') showToast('Judge call marked resolved!', 'success');
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Failed to resolve call', 'error');
  }
}

function renderToHubClockAndJudgeSubtab(eventId, ev, roundNums, bcpCfg, clockObj, judgeCalls) {
  const configuredMins = Number(clockObj?.durationMinutes || clockObj?.duration_minutes || bcpCfg.defaultLengthMins) || bcpCfg.defaultLengthMins;
  const remSec = computeClockRemainingSeconds(clockObj, configuredMins);
  const rawStatus = (clockObj && clockObj.status) ? String(clockObj.status).toLowerCase() : 'stopped';
  const isRunning = rawStatus === 'running';
  const isPaused = rawStatus === 'paused';
  const isVisibleToPlayers = isRunning || isPaused;
  const staffList = extractEventStaffDirectory(ev);

  const judgeListHtml = judgeCalls.length > 0
    ? judgeCalls.map(c => {
        const isResolved = String(c.status || '').toLowerCase() === 'resolved';
        return `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:0.65rem; padding:0.65rem 0.85rem; background:rgba(15,23,42,0.65); border:1px solid ${isResolved ? 'rgba(255,255,255,0.07)' : 'rgba(239,68,68,0.45)'}; border-radius:8px;">
            <div style="min-width:0; flex:1;">
              <div style="display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap;">
                <span style="font-family:var(--font-mono); font-weight:800; color:#fff; font-size:0.84rem;">Table ${escapeHtml(String(c.table_num || '?'))}</span>
                <span class="badge" style="background:${isResolved ? 'rgba(34,197,94,0.16)' : 'rgba(239,68,68,0.2)'}; color:${isResolved ? '#4ade80' : '#fca5a5'}; font-size:0.66rem;">
                  ${isResolved ? '✅ Resolved' : '🚨 Active'}
                </span>
                <span style="font-size:0.75rem; font-weight:700; color:#38bdf8;">${escapeHtml(c.category || 'Ruling')}</span>
              </div>
              ${c.notes ? `<div style="font-size:0.78rem; color:#cbd5e1; margin-top:0.2rem; word-break:break-word;">${escapeHtml(c.notes)}</div>` : ''}
            </div>
            ${!isResolved ? `
              <button type="button" class="btn btn-outline" onclick="resolveToHubJudgeCall('${escapeHtml(String(c.id || ''))}')" style="font-size:0.72rem; font-weight:700; padding:0.28rem 0.6rem; color:#4ade80; border-color:rgba(34,197,94,0.4); flex-shrink:0;">
                ✅ Resolve
              </button>
            ` : ''}
          </div>
        `;
      }).join('')
    : `<div style="padding:1.25rem; text-align:center; color:var(--text-muted); font-size:0.82rem; background:rgba(2,6,23,0.45); border:1px dashed rgba(255,255,255,0.08); border-radius:8px;">No floor judge calls logged for this event.</div>`;

  const visibilityBadgeHtml = isRunning
    ? `<span class="badge" style="background:rgba(34,197,94,0.18); color:#4ade80; border:1px solid rgba(34,197,94,0.45); font-size:0.68rem; font-weight:800;">🟢 LIVE • SHOWN TO PLAYERS</span>`
    : (isPaused
        ? `<span class="badge" style="background:rgba(245,158,11,0.18); color:#fbbf24; border:1px solid rgba(245,158,11,0.45); font-size:0.68rem; font-weight:800;">⏸️ PAUSED • SHOWN TO PLAYERS</span>`
        : `<span class="badge" style="background:rgba(148,163,184,0.15); color:#94a3b8; border:1px solid rgba(148,163,184,0.3); font-size:0.68rem; font-weight:800;">⚫ STOPPED • HIDDEN FROM PLAYERS</span>`);

  return `
    <div class="to-hub-two-col-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:1rem; align-items:stretch;">
      <!-- Master Round Clock Control Card -->
      <div class="card to-hub-symmetric-card" style="padding:1.05rem 1.15rem; background:rgba(15,23,42,0.82); border:1px solid ${isRunning ? 'rgba(34,197,94,0.35)' : 'rgba(255,255,255,0.09)'}; border-radius:10px; display:flex; flex-direction:column; gap:0.7rem;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; flex-wrap:wrap;">
          <h4 style="margin:0; font-size:0.95rem; font-weight:800; color:#fff;">⏱️ Master Round Clock</h4>
          <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
            ${visibilityBadgeHtml}
            <span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; font-size:0.68rem;">BCP Default: ${bcpCfg.defaultLengthMins}m</span>
          </div>
        </div>

        <div style="text-align:center; padding:0.9rem 0.75rem; background:rgba(2,6,23,0.75); border:1px solid ${isRunning ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'}; border-radius:10px;">
          <div style="font-size:0.7rem; font-weight:800; text-transform:uppercase; color:${isRunning ? '#4ade80' : (isPaused ? '#fbbf24' : 'var(--text-muted)')}; margin-bottom:0.2rem;">
            ${isRunning ? '🔴 ROUND IN PROGRESS (VISIBLE TO PLAYERS)' : (isPaused ? '⏸️ ROUND CLOCK PAUSED (VISIBLE TO PLAYERS)' : '⏹️ ROUND STOPPED (CLOCK HIDDEN FROM PLAYERS)')}
          </div>
          <div class="live-event-master-clock-readout" style="font-family:var(--font-mono); font-size:2.25rem; font-weight:900; color:${isRunning ? '#fbbf24' : '#f8fafc'}; letter-spacing:0.04em;">
            ${formatClockDurationHms(remSec)}
          </div>
        </div>

        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.65rem; padding:0.45rem 0.7rem; background:rgba(15,23,42,0.55); border:1px solid rgba(255,255,255,0.07); border-radius:8px;">
          <label for="to-hub-clock-mins-input" style="font-size:0.76rem; font-weight:700; color:#cbd5e1;">Round Duration (Minutes)</label>
          <input id="to-hub-clock-mins-input" type="number" min="15" max="600" value="${configuredMins}" style="width:100px; padding:0.35rem 0.55rem; border-radius:6px; background:rgba(15,23,42,0.95); border:1px solid rgba(255,255,255,0.18); color:#fff; font-size:0.84rem; font-family:var(--font-mono); font-weight:700; text-align:right; box-sizing:border-box;" />
        </div>

        <div class="to-hub-clock-primary-btns" style="display:flex; flex-wrap:wrap; gap:0.45rem;">
          ${!isRunning ? `
            <button type="button" class="btn btn-primary" onclick="updateToHubMasterClockAction('start')" style="flex:1.4; min-width:180px; font-size:0.78rem; font-weight:800; padding:0.5rem 0.75rem; background:linear-gradient(135deg, #059669, #10b981); border-color:#34d399; color:#fff;">
              ${isPaused ? '▶️ Resume Round Clock' : '▶️ Start Round (Show Clock to Players)'}
            </button>
          ` : `
            <button type="button" class="btn btn-outline" onclick="updateToHubMasterClockAction('pause')" style="flex:1; min-width:130px; font-size:0.78rem; font-weight:800; padding:0.5rem 0.75rem; border-color:rgba(245,158,11,0.5); color:#fbbf24;">
              ⏸️ Pause Clock
            </button>
          `}
          ${isVisibleToPlayers ? `
            <button type="button" class="btn btn-outline" onclick="updateToHubMasterClockAction('stop')" style="flex:1; min-width:150px; font-size:0.78rem; font-weight:800; padding:0.5rem 0.75rem; border-color:rgba(239,68,68,0.5); color:#f87171; background:rgba(239,68,68,0.1);">
              ⏹️ Stop Round (Hide Clock)
            </button>
          ` : ''}
        </div>

        <div style="display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:0.45rem;">
          <button type="button" class="btn btn-outline" onclick="updateToHubMasterClockAction('adjust', 300)" style="font-size:0.75rem; padding:0.38rem 0.5rem;">+5m</button>
          <button type="button" class="btn btn-outline" onclick="updateToHubMasterClockAction('adjust', -300)" style="font-size:0.75rem; padding:0.38rem 0.5rem;">-5m</button>
          <button type="button" class="btn btn-outline" onclick="updateToHubMasterClockAction('reset')" style="font-size:0.75rem; padding:0.38rem 0.5rem;">🔄 Reset Timer</button>
        </div>

        <button type="button" class="btn btn-outline" onclick="broadcastToHubClockStatus()" style="width:100%; margin-top:auto; font-size:0.78rem; font-weight:700; padding:0.48rem; border-color:rgba(245,158,11,0.4); color:#fbbf24;">
          📢 Broadcast Live Time Remaining Banner
        </button>
      </div>

      <!-- Judge Call Dispatch & Floor Log Card -->
      <div class="card to-hub-symmetric-card" style="padding:1.05rem 1.15rem; background:rgba(15,23,42,0.82); border:1px solid rgba(255,255,255,0.09); border-radius:10px; display:flex; flex-direction:column; gap:0.7rem;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; flex-wrap:wrap;">
          <h4 style="margin:0; font-size:0.95rem; font-weight:800; color:#fff;">⚖️ Dispatch Floor Judge Call / Table Ruling</h4>
          <span class="badge" style="background:rgba(239,68,68,0.15); color:#fca5a5; font-size:0.68rem;">${judgeCalls.filter(c => String(c.status || '').toLowerCase() !== 'resolved').length} Active</span>
        </div>

        <div class="to-hub-judge-form-grid" style="display:grid; grid-template-columns:84px minmax(0, 1fr) minmax(0, 1fr); gap:0.45rem;">
          <input id="to-hub-judge-table" type="text" placeholder="Table #" style="width:100%; min-width:0; box-sizing:border-box; padding:0.42rem 0.55rem; border-radius:6px; background:rgba(15,23,42,0.9); border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:0.8rem;" />
          <select id="to-hub-judge-category" style="width:100%; min-width:0; box-sizing:border-box; padding:0.42rem 0.55rem; border-radius:6px; background:rgba(15,23,42,0.9); border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:0.8rem;">
            <option value="Rules Question">Rules Question</option>
            <option value="Terrain / LOS Check">Terrain / LOS Check</option>
            <option value="Clock / Slow Play">Clock / Slow Play</option>
            <option value="Score Correction">Score Correction</option>
            <option value="Sportsmanship">Sportsmanship</option>
          </select>
          <select id="to-hub-judge-staff" style="width:100%; min-width:0; box-sizing:border-box; padding:0.42rem 0.55rem; border-radius:6px; background:rgba(15,23,42,0.9); border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:0.8rem;">
            <option value="">Assign Staff (Any)</option>
            ${staffList.map(st => `<option value="${escapeHtml(st.name)}">${escapeHtml(st.name)} (${escapeHtml(st.role)})</option>`).join('')}
          </select>
        </div>

        <div class="to-hub-judge-notes-row" style="display:flex; gap:0.45rem; align-items:stretch;">
          <input id="to-hub-judge-notes" type="text" placeholder="Ruling details or table notes..." style="flex:1; min-width:0; box-sizing:border-box; padding:0.42rem 0.65rem; border-radius:6px; background:rgba(15,23,42,0.9); border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:0.8rem;" />
          <button type="button" class="btn btn-primary" onclick="submitToHubJudgeCall()" style="font-size:0.78rem; font-weight:700; padding:0.42rem 0.85rem; white-space:nowrap; flex-shrink:0;">
            🚨 Log Call
          </button>
        </div>

        <div style="display:flex; flex-direction:column; gap:0.45rem; flex:1; max-height:230px; overflow-y:auto;">
          ${judgeListHtml}
        </div>
      </div>
    </div>
  `;
}

// ----------------------------------------------------------------------------
// SUB-TAB 3: 📢 ANNOUNCEMENTS & NEWS
// ----------------------------------------------------------------------------
function applyToHubAnnouncementPreset(text, level = 'info') {
  const input = document.getElementById('to-hub-banner-message');
  const select = document.getElementById('to-hub-banner-level');
  if (input) input.value = text;
  if (select) select.value = level;
}

function applyToHubNewsPreset(title, category = 'announcement', body = '') {
  const titleEl = document.getElementById('to-hub-news-title');
  const catEl = document.getElementById('to-hub-news-category');
  const bodyEl = document.getElementById('to-hub-news-body');
  if (titleEl) titleEl.value = title;
  if (catEl) catEl.value = category;
  if (bodyEl) bodyEl.value = body;
}

async function publishToHubBannerAnnouncement() {
  const eventId = String(currentOpenEventId || (currentEventData && currentEventData.id) || '');
  if (!eventId) return;
  const input = document.getElementById('to-hub-banner-message');
  const select = document.getElementById('to-hub-banner-level');
  const message = input ? input.value.trim() : '';
  const level = select ? select.value : 'info';
  if (!message) {
    if (typeof showToast === 'function') showToast('Please enter an announcement message', 'warning');
    return;
  }
  const evName = (currentEventData && (currentEventData.name || currentEventData.event_name)) || '';
  try {
    recordRecentInteractedEventId(eventId);
    const pubRes = await window.api.publishEventToHubAnnouncement(eventId, { message, level, event_name: evName });
    if (pubRes && pubRes.broadcast) {
      await syncToHubBroadcastToClientFirestore(eventId, pubRes.broadcast);
      if (pubRes.broadcast.id) {
        try {
          localStorage.removeItem(`dismissed_event_broadcast_${pubRes.broadcast.id}`);
        } catch (_) {}
      }
    }
    if (pubRes && pubRes.state) {
      pubRes.state._fetchedAt = Date.now();
      _eventToHubStateCache.set(eventId, pubRes.state);
    }
    if (input) input.value = '';
    await loadEventToHubState(eventId, true);
    if (typeof syncGlobalEventAnnouncementBanner === 'function') {
      await syncGlobalEventAnnouncementBanner(true);
    }
    if (typeof showToast === 'function') showToast('📢 App-wide event announcement banner published!', 'success');
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Failed to publish announcement', 'error');
  }
}

async function clearToHubBannerAnnouncement(targetId = 'general') {
  const eventId = String(currentOpenEventId || (currentEventData && currentEventData.id) || (_toHubCommsContext && _toHubCommsContext.eventId) || '');
  if (!eventId) return;
  const cleanTarget = targetId ? String(targetId).trim() : 'general';
  try {
    const res = await window.api.clearEventToHubAnnouncement(eventId, cleanTarget);
    await syncToHubBroadcastToClientFirestore(eventId, null, cleanTarget);
    if (res && res.state) {
      res.state._fetchedAt = Date.now();
      _eventToHubStateCache.set(eventId, res.state);
    } else if (_eventToHubStateCache.has(eventId)) {
      const c = _eventToHubStateCache.get(eventId);
      if (c) {
        if (!cleanTarget || cleanTarget === 'general' || cleanTarget === 'all') {
          c.broadcast = null;
          c.active_broadcast = null;
        }
        if (cleanTarget === 'all' || cleanTarget === 'all_targeted') {
          c.targeted_broadcasts = [];
        } else if (cleanTarget !== 'general' && Array.isArray(c.targeted_broadcasts)) {
          c.targeted_broadcasts = c.targeted_broadcasts.filter(
            b => String(b.id || '') !== cleanTarget && computeClientBroadcastTargetKey(b) !== cleanTarget
          );
        }
      }
    }
    await loadEventToHubState(eventId, true);
    if (typeof syncGlobalEventAnnouncementBanner === 'function') {
      await syncGlobalEventAnnouncementBanner(true);
    }
    const resultBox = document.getElementById('to-hub-comms-result-box');
    if (resultBox && cleanTarget !== 'general') {
      resultBox.style.display = 'block';
      resultBox.innerHTML = `
        <div style="padding:0.55rem 0.75rem; border-radius:8px; background:rgba(148,163,184,0.14); border:1px solid rgba(148,163,184,0.35); color:#cbd5e1; font-size:0.76rem; font-weight:700;">
          ℹ️ Targeted Live Alert Banner recalled.
        </div>
      `;
    }
    if (typeof showToast === 'function') {
      showToast(cleanTarget === 'general' ? 'App-wide announcement banner cleared' : 'Targeted alert banner recalled', 'info');
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Failed to clear banner', 'error');
  }
}

async function submitToHubNewsPost() {
  const eventId = String(currentOpenEventId || (currentEventData && currentEventData.id) || '');
  if (!eventId) return;
  const titleEl = document.getElementById('to-hub-news-title');
  const catEl = document.getElementById('to-hub-news-category');
  const pinEl = document.getElementById('to-hub-news-pinned');
  const bodyEl = document.getElementById('to-hub-news-body');

  const title = titleEl ? titleEl.value.trim() : '';
  const category = catEl ? catEl.value : 'announcement';
  const pinned = Boolean(pinEl && pinEl.checked);
  const body = bodyEl ? bodyEl.value.trim() : '';

  if (!title && !body) {
    if (typeof showToast === 'function') showToast('Please enter a title or body for the news post', 'warning');
    return;
  }

  try {
    await window.api.saveEventToHubNewsPost(eventId, { title: title || 'Tournament Update', body, category, pinned });
    if (titleEl) titleEl.value = '';
    if (bodyEl) bodyEl.value = '';
    if (pinEl) pinEl.checked = false;
    await loadEventToHubState(eventId, true);
    if (typeof showToast === 'function') showToast('Published bulletin to News & Info tab!', 'success');
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Failed to publish news post', 'error');
  }
}

async function removeToHubNewsPost(postId) {
  const eventId = String(currentOpenEventId || (currentEventData && currentEventData.id) || '');
  if (!eventId || !postId) return;
  try {
    await window.api.deleteEventToHubNewsPost(eventId, postId);
    await loadEventToHubState(eventId, true);
    if (typeof showToast === 'function') showToast('Deleted news post', 'info');
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Failed to delete news post', 'error');
  }
}

function renderToHubAnnouncementsSubtab(eventId, ev, state) {
  const rawActive = (state && state.active_broadcast && state.active_broadcast.message) ? state.active_broadcast : null;
  const activeBroadcast = (rawActive && !isTargetedBroadcastObj(rawActive)) ? rawActive : null;
  const targetedBroadcasts = Array.isArray(state?.targeted_broadcasts)
    ? state.targeted_broadcasts.filter(b => b && b.message && b.active !== false)
    : [];
  const newsPosts = Array.isArray(state?.news_posts) ? state.news_posts : [];

  const allMatches = Array.isArray(eventMatchesCache) && eventMatchesCache.length > 0
    ? eventMatchesCache
    : (Array.isArray(ev?.matches) ? ev.matches : []);
  const roundNums = Array.from(new Set(allMatches.map(m => Number(m.round || m.round_number || 1)).filter(n => n > 0))).sort((a, b) => a - b);
  const targetRound = (_toHubRadarRound && roundNums.includes(Number(_toHubRadarRound)))
    ? Number(_toHubRadarRound)
    : (roundNums.length > 0 ? roundNums[roundNums.length - 1] : 1);
  const roundMatches = allMatches.filter(m => Number(m.round || m.round_number || 1) === targetRound);
  const unfinishedRoundMatches = roundMatches.filter(m => !isToHubMatchCompleted(m));

  return `
    <div style="display:flex; flex-direction:column; gap:0.85rem;">
      ${activeBroadcast ? `
        <div class="card" style="padding:0.75rem 1rem; background:rgba(245,158,11,0.14); border:1px solid rgba(245,158,11,0.45); border-radius:10px; display:flex; align-items:center; justify-content:space-between; gap:0.75rem; flex-wrap:wrap;">
          <div style="min-width:0; flex:1;">
            <div style="font-size:0.68rem; font-weight:800; color:#fbbf24; text-transform:uppercase; letter-spacing:0.04em;">
              🟢 ACTIVE APP-WIDE EVENT BANNER (${escapeHtml(activeBroadcast.level || 'info')})
            </div>
            <div style="font-size:0.84rem; font-weight:700; color:#fff; margin-top:0.15rem; word-break:break-word;">
              ${escapeHtml(activeBroadcast.message)}
            </div>
          </div>
          <button type="button" class="btn btn-outline" onclick="clearToHubBannerAnnouncement('general')" style="font-size:0.74rem; font-weight:700; padding:0.32rem 0.65rem; color:#f87171; border-color:rgba(239,68,68,0.4); white-space:nowrap; flex-shrink:0;">
            ✕ Clear App-Wide Banner
          </button>
        </div>
      ` : ''}

      ${targetedBroadcasts.length > 0 ? `
        <div class="card" style="padding:0.75rem 1rem; background:rgba(56,189,248,0.11); border:1px solid rgba(56,189,248,0.4); border-radius:10px; display:flex; flex-direction:column; gap:0.5rem;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; flex-wrap:wrap;">
            <div style="font-size:0.68rem; font-weight:800; color:#38bdf8; text-transform:uppercase; letter-spacing:0.04em;">
              🎯 ACTIVE TARGETED TABLE / PLAYER ALERTS (${targetedBroadcasts.length}) — Independent from General Banner
            </div>
            ${targetedBroadcasts.length > 1 ? `
              <button type="button" class="btn btn-outline" onclick="clearToHubBannerAnnouncement('all_targeted')" style="font-size:0.68rem; font-weight:700; padding:0.2rem 0.55rem; color:#f87171; border-color:rgba(239,68,68,0.35);">
                ✕ Clear All Targeted
              </button>
            ` : ''}
          </div>
          <div style="display:flex; flex-direction:column; gap:0.4rem;">
            ${targetedBroadcasts.map(tb => {
              const tKey = computeClientBroadcastTargetKey(tb) || String(tb.id || '');
              const safeTKey = escapeHtml(tKey.replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
              const tLabel = [
                tb.target_table ? `🎲 Table ${tb.target_table}` : '',
                tb.target_player_name ? `👤 ${tb.target_player_name}` : ''
              ].filter(Boolean).join(' • ') || 'Targeted Alert';
              return `
                <div style="display:flex; align-items:center; justify-content:space-between; gap:0.6rem; padding:0.45rem 0.65rem; background:rgba(2,6,23,0.6); border:1px solid rgba(56,189,248,0.25); border-radius:8px; flex-wrap:wrap;">
                  <div style="min-width:0; flex:1; display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap;">
                    <span class="badge" style="background:rgba(250,204,21,0.2); color:#fef08a; border:1px solid rgba(250,204,21,0.45); font-size:0.66rem; font-weight:800;">
                      ${escapeHtml(tLabel)}
                    </span>
                    <span style="font-size:0.8rem; font-weight:700; color:#f8fafc; word-break:break-word;">
                      ${escapeHtml(tb.message)}
                    </span>
                  </div>
                  <button type="button" class="btn btn-outline" onclick="clearToHubBannerAnnouncement('${safeTKey}')" style="font-size:0.68rem; font-weight:700; padding:0.2rem 0.5rem; color:#f87171; border-color:rgba(239,68,68,0.38); flex-shrink:0;">
                    ✕ Recall
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}

      <div class="to-hub-two-col-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:1rem; align-items:stretch;">
        <!-- App-Wide Live Banner Broadcast -->
        <div class="card to-hub-symmetric-card" style="padding:1.05rem 1.15rem; background:rgba(15,23,42,0.82); border:1px solid rgba(255,255,255,0.09); border-radius:10px; display:flex; flex-direction:column; gap:0.65rem;">
          <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:0.6rem; flex-wrap:wrap;">
            <div style="min-width:180px; flex:1;">
              <h4 style="margin:0 0 0.2rem 0; font-size:0.95rem; font-weight:800; color:#fbbf24;">📢 App-Wide Event Banner Broadcast</h4>
              <div style="font-size:0.76rem; color:var(--text-secondary); line-height:1.35;">Displays a high-visibility alert banner across the app for all players in this tournament.</div>
            </div>
            <div style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap; flex-shrink:0;">
              <button type="button" class="btn btn-outline" onclick="copyUnfinishedTablesList('${escapeHtml(eventId)}', ${targetRound})" style="padding:0.3rem 0.62rem; font-size:0.72rem; font-weight:700;" title="Copy list of unfinished tables in Round ${targetRound} to clipboard">
                📋 Copy Unfinished
              </button>
              <button type="button" class="btn btn-primary" onclick="broadcastUnfinishedTablesPing('${escapeHtml(eventId)}', ${targetRound})" style="padding:0.3rem 0.68rem; font-size:0.72rem; font-weight:800; background:rgba(245,158,11,0.2); border:1px solid rgba(245,158,11,0.5); color:#fbbf24;" title="Broadcast score submission reminder to all unfinished tables in Round ${targetRound}">
                📢 Ping Unfinished (${unfinishedRoundMatches.length})
              </button>
            </div>
          </div>

          <div class="to-hub-preset-pills-row" style="display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:0.35rem;">
            <button type="button" class="btn btn-outline" onclick="applyToHubAnnouncementPreset('⚔️ Round Pairings are LIVE! Report to your assigned table.', 'info')" style="font-size:0.7rem; padding:0.28rem 0.4rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">⚔️ Pairings Live</button>
            <button type="button" class="btn btn-outline" onclick="applyToHubAnnouncementPreset('⏳ 15 Minutes Remaining in the Round — finish current Battle Round.', 'warning')" style="font-size:0.7rem; padding:0.28rem 0.4rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">⏳ 15m Warning</button>
            <button type="button" class="btn btn-outline" onclick="applyToHubAnnouncementPreset('🎲 Dice Down! Please submit final scores immediately.', 'urgent')" style="font-size:0.7rem; padding:0.28rem 0.4rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">🎲 Dice Down</button>
          </div>

          <div class="to-hub-ann-control-row" style="display:grid; grid-template-columns:135px minmax(0, 1fr); gap:0.45rem; align-items:center;">
            <select id="to-hub-banner-level" style="width:100%; height:36px; box-sizing:border-box; padding:0.4rem 0.55rem; border-radius:6px; background:rgba(15,23,42,0.9); border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:0.78rem;">
              <option value="info">📢 Info</option>
              <option value="warning">⚠️ Important</option>
              <option value="urgent">🚨 Urgent</option>
            </select>
            <div style="height:36px; box-sizing:border-box; padding:0 0.65rem; border-radius:6px; background:rgba(2,6,23,0.55); border:1px solid rgba(255,255,255,0.08); display:flex; align-items:center; justify-content:space-between; gap:0.4rem; font-size:0.74rem; color:#94a3b8; overflow:hidden;">
              <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">🌐 Audience: All Event Players</span>
              <span class="badge" style="background:rgba(245,158,11,0.16); color:#fbbf24; font-size:0.64rem; flex-shrink:0;">LIVE</span>
            </div>
          </div>

          <textarea id="to-hub-banner-message" rows="3" placeholder="Type live announcement banner message to broadcast across all screens..." style="width:100%; flex:1; min-height:78px; box-sizing:border-box; padding:0.5rem 0.65rem; border-radius:6px; background:rgba(15,23,42,0.9); border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:0.8rem; resize:vertical;"></textarea>

          <button type="button" class="btn btn-primary" onclick="publishToHubBannerAnnouncement()" style="width:100%; margin-top:auto; font-size:0.8rem; font-weight:700; padding:0.5rem;">
            📢 Publish App-Wide Event Banner
          </button>
        </div>

        <!-- Public News & Info Feed Publisher -->
        <div class="card to-hub-symmetric-card" style="padding:1.05rem 1.15rem; background:rgba(15,23,42,0.82); border:1px solid rgba(255,255,255,0.09); border-radius:10px; display:flex; flex-direction:column; gap:0.65rem;">
          <div>
            <h4 style="margin:0 0 0.2rem 0; font-size:0.95rem; font-weight:800; color:#38bdf8;">📰 Publish to Public News & Info Tab</h4>
            <div style="font-size:0.76rem; color:var(--text-secondary); line-height:1.35;">Create permanent tournament bulletins, mission clarifications, or schedule posts.</div>
          </div>

          <div class="to-hub-preset-pills-row" style="display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:0.35rem;">
            <button type="button" class="btn btn-outline" onclick="applyToHubNewsPreset('Round Mission & Terrain Layout', 'mission', 'Verify your table terrain layout and mission primary/secondary rules before deployment.')" style="font-size:0.7rem; padding:0.28rem 0.4rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">🗺️ Mission Info</button>
            <button type="button" class="btn btn-outline" onclick="applyToHubNewsPreset('Updated Round Schedule', 'schedule', 'Please check the updated round start times and break window in the event schedule.')" style="font-size:0.7rem; padding:0.28rem 0.4rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">⏱️ Schedule Note</button>
            <button type="button" class="btn btn-outline" onclick="applyToHubNewsPreset('Paint Judging & Awards Showcase', 'awards', 'Set out your painted armies during the break for Best Painted showcase judging.')" style="font-size:0.7rem; padding:0.28rem 0.4rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">🏆 Paint Showcase</button>
          </div>

          <div class="to-hub-news-meta-grid" style="display:grid; grid-template-columns:minmax(0, 1fr) 130px auto; gap:0.45rem; align-items:center;">
            <input id="to-hub-news-title" type="text" placeholder="Bulletin Title (e.g. Round 2 Mission & Terrain)" style="width:100%; height:36px; min-width:0; box-sizing:border-box; padding:0.4rem 0.65rem; border-radius:6px; background:rgba(15,23,42,0.9); border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:0.8rem;" />
            <select id="to-hub-news-category" style="width:100%; height:36px; min-width:0; box-sizing:border-box; padding:0.4rem 0.55rem; border-radius:6px; background:rgba(15,23,42,0.9); border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:0.78rem;">
              <option value="announcement">📢 Bulletin</option>
              <option value="mission">🗺️ Mission</option>
              <option value="schedule">⏱️ Schedule</option>
              <option value="awards">🏆 Awards</option>
            </select>
            <label style="height:36px; box-sizing:border-box; padding:0 0.55rem; border-radius:6px; background:rgba(2,6,23,0.55); border:1px solid rgba(255,255,255,0.08); display:inline-flex; align-items:center; gap:0.3rem; font-size:0.75rem; color:#cbd5e1; cursor:pointer; white-space:nowrap;">
              <input id="to-hub-news-pinned" type="checkbox" /> 📌 Pin
            </label>
          </div>

          <textarea id="to-hub-news-body" rows="3" placeholder="Write full announcement details, mission layout notes, or schedule updates..." style="width:100%; flex:1; min-height:78px; box-sizing:border-box; padding:0.5rem 0.65rem; border-radius:6px; background:rgba(15,23,42,0.9); border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:0.8rem; resize:vertical;"></textarea>

          <button type="button" class="btn btn-primary" onclick="submitToHubNewsPost()" style="width:100%; margin-top:auto; font-size:0.8rem; font-weight:700; padding:0.5rem;">
            📰 Post to News & Info Tab
          </button>
        </div>
      </div>

      ${newsPosts.length > 0 ? `
        <div class="card" style="padding:0.85rem 1.05rem; background:rgba(15,23,42,0.75); border:1px solid rgba(255,255,255,0.08); border-radius:10px; display:flex; flex-direction:column; gap:0.45rem;">
          <div style="font-size:0.75rem; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em;">
            📚 Published Bulletins (${newsPosts.length})
          </div>
          <div style="max-height:160px; overflow-y:auto; display:flex; flex-direction:column; gap:0.4rem;">
            ${newsPosts.map(p => `
              <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; padding:0.45rem 0.65rem; background:rgba(2,6,23,0.55); border-radius:6px; font-size:0.78rem;">
                <span style="font-weight:700; color:#e2e8f0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.pinned ? '📌 ' : ''}${escapeHtml(p.title || 'Update')}</span>
                <button type="button" class="btn btn-outline" onclick="removeToHubNewsPost('${escapeHtml(String(p.id || ''))}')" style="font-size:0.68rem; padding:0.18rem 0.45rem; color:#f87171; flex-shrink:0;">Delete</button>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

// ----------------------------------------------------------------------------
// SUB-TAB 4: 📋 ROSTER & COMPLIANCE AUDIT
// ----------------------------------------------------------------------------
function setToHubRosterFilter(filter) {
  _toHubRosterFilter = filter || 'all';
  if (currentEventData) renderEventToHub(currentEventData, true);
}

function handleToHubRosterSearch(val) {
  _toHubRosterSearch = String(val || '').trim().toLowerCase();
  if (currentEventData) renderEventToHub(currentEventData, true);
}

function getFilteredToHubRoster(players) {
  const list = Array.isArray(players) ? players : [];
  return list.filter(p => {
    if (!p) return false;
    const isDropped = Boolean(p.dropped);
    const isCheckedIn = Boolean(p.checked_in);
    const hasList = Boolean(p.list_id || p.army_list || p.list_text || p.has_list || p.has_list_submitted);
    const fac = formatEventPlayerFaction(p.faction || p.army_name);
    const isUnassignedFac = !fac || fac === 'Unknown' || fac === 'Unassigned';

    if (_toHubRosterFilter === 'checked_in' && (!isCheckedIn || isDropped)) return false;
    if (_toHubRosterFilter === 'not_checked_in' && (isCheckedIn || isDropped)) return false;
    if (_toHubRosterFilter === 'list_submitted' && (!hasList || isDropped)) return false;
    if (_toHubRosterFilter === 'missing_list' && (hasList || isDropped)) return false;
    if (_toHubRosterFilter === 'unassigned_faction' && (!isUnassignedFac || isDropped)) return false;
    if (_toHubRosterFilter === 'dropped' && !isDropped) return false;

    if (_toHubRosterSearch) {
      const hay = `${p.full_name || ''} ${fac} ${p.detachment || ''} ${p.team || ''}`.toLowerCase();
      if (!hay.includes(_toHubRosterSearch)) return false;
    }
    return true;
  });
}

function copyToHubFilteredRosterNames() {
  const players = Array.isArray(eventPlayersCache) && eventPlayersCache.length > 0
    ? eventPlayersCache
    : (Array.isArray(currentEventData?.players) ? currentEventData.players : []);
  const filtered = getFilteredToHubRoster(players);
  if (filtered.length === 0) {
    if (typeof showToast === 'function') showToast('No players match the current filter', 'warning');
    return;
  }
  const names = filtered.map(p => p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Player').join('\n');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(names).then(() => {
      if (typeof showToast === 'function') showToast(`Copied ${filtered.length} player name(s) to clipboard!`, 'success');
    }).catch(() => {});
  }
}

function renderToHubRosterAuditSubtab(eventId, ev, players) {
  const allPlayers = Array.isArray(players) ? players : [];
  const activePlayers = allPlayers.filter(p => !p.dropped);
  const droppedCount = allPlayers.filter(p => Boolean(p.dropped)).length;
  const checkedInCount = activePlayers.filter(p => Boolean(p.checked_in)).length;
  const notCheckedInCount = Math.max(0, activePlayers.length - checkedInCount);
  const hasListCount = activePlayers.filter(p => Boolean(p.list_id || p.army_list || p.list_text || p.has_list || p.has_list_submitted)).length;
  const missingListCount = Math.max(0, activePlayers.length - hasListCount);
  const unassignedFacCount = activePlayers.filter(p => {
    const f = formatEventPlayerFaction(p.faction || p.army_name);
    return !f || f === 'Unknown' || f === 'Unassigned';
  }).length;

  // Build Round Completion Metadata Header (per-round metadata only, no pairing tables)
  const allMatches = Array.isArray(eventMatchesCache) && eventMatchesCache.length > 0
    ? eventMatchesCache
    : (Array.isArray(ev?.matches) ? ev.matches : []);
  const roundNums = Array.from(new Set(allMatches.map(m => Number(m.round || m.round_number || 1)).filter(n => n > 0))).sort((a, b) => a - b);
  const toHubState = (typeof _eventToHubStateCache !== 'undefined' && _eventToHubStateCache.get(String(eventId))) || {};
  const judgeCalls = Array.isArray(toHubState.judge_calls) ? toHubState.judge_calls : [];
  const openJudgeCallsCount = judgeCalls.filter(c => String(c.status || 'open').toLowerCase() !== 'resolved').length;

  const totalMatchesAll = allMatches.length;
  const totalCompletedAll = allMatches.filter(m => isToHubMatchCompleted(m)).length;
  const totalUnfinishedAll = Math.max(0, totalMatchesAll - totalCompletedAll);
  const overallPct = totalMatchesAll > 0 ? Math.round((totalCompletedAll / totalMatchesAll) * 100) : 0;

  const roundCompletionHeaderHtml = roundNums.length > 0 ? `
    <div class="card to-hub-round-completion-header" style="padding:0.85rem 1.05rem; background:rgba(15,23,42,0.82); border:1px solid rgba(255,255,255,0.09); border-radius:10px; margin-bottom:0.85rem;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:0.65rem; flex-wrap:wrap; margin-bottom:0.65rem;">
        <div style="display:flex; align-items:center; gap:0.55rem; flex-wrap:wrap;">
          <h4 style="margin:0; font-size:0.9rem; font-weight:800; color:#fff;">⚔️ Round Completion</h4>
          <span class="badge" style="background:rgba(56,189,248,0.14); color:${overallPct === 100 ? '#4ade80' : '#38bdf8'}; border:1px solid ${overallPct === 100 ? 'rgba(16,185,129,0.35)' : 'rgba(56,189,248,0.35)'}; font-family:var(--font-mono); font-size:0.72rem; font-weight:800;">
            ${totalCompletedAll}/${totalMatchesAll} (${overallPct}%)
          </span>
        </div>
        <div style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap; font-size:0.72rem; font-weight:700;">
          <span style="padding:0.22rem 0.55rem; border-radius:6px; background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.28); color:#38bdf8;">All (${totalMatchesAll})</span>
          <span style="padding:0.22rem 0.55rem; border-radius:6px; background:rgba(245,158,11,0.14); border:1px solid rgba(245,158,11,0.32); color:#fbbf24;">⏳ Unfinished (${totalUnfinishedAll})</span>
          <span style="padding:0.22rem 0.55rem; border-radius:6px; background:rgba(16,185,129,0.14); border:1px solid rgba(16,185,129,0.32); color:#34d399;">✅ Completed (${totalCompletedAll})</span>
          <span style="padding:0.22rem 0.55rem; border-radius:6px; background:rgba(239,68,68,0.14); border:1px solid rgba(239,68,68,0.32); color:#fca5a5;">🚨 Judge Call (${openJudgeCallsCount})</span>
        </div>
      </div>
      <div class="to-hub-round-completion-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(165px, 1fr)); gap:0.5rem;">
        ${roundNums.map(r => {
          const rMatches = allMatches.filter(m => Number(m.round || m.round_number || 1) === r);
          const rTotal = rMatches.length;
          const rDone = rMatches.filter(m => isToHubMatchCompleted(m)).length;
          const rUnfinished = Math.max(0, rTotal - rDone);
          const rPct = rTotal > 0 ? Math.round((rDone / rTotal) * 100) : 0;
          return `
            <div style="padding:0.48rem 0.68rem; background:rgba(2,6,23,0.58); border:1px solid ${rPct === 100 ? 'rgba(16,185,129,0.28)' : 'rgba(56,189,248,0.28)'}; border-radius:8px;">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:0.35rem; font-size:0.74rem; margin-bottom:0.22rem;">
                <span style="font-weight:800; color:#f8fafc;">Round ${r}</span>
                <span style="font-family:var(--font-mono); font-weight:800; font-size:0.72rem; color:${rPct === 100 ? '#4ade80' : '#38bdf8'};">${rDone}/${rTotal} (${rPct}%)</span>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:0.66rem; color:var(--text-secondary); margin-bottom:0.2rem;">
                <span>Round Completion</span>
                <span style="color:${rUnfinished > 0 ? '#fbbf24' : '#34d399'}; font-weight:700;">${rUnfinished > 0 ? `⏳ ${rUnfinished}` : '✅ Done'}</span>
              </div>
              <div style="height:5px; background:rgba(255,255,255,0.08); border-radius:999px; overflow:hidden;">
                <div style="width:${rPct}%; height:100%; background:${rPct === 100 ? '#10b981' : 'linear-gradient(90deg, #38bdf8, #818cf8)'};"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  ` : '';

  const filtered = getFilteredToHubRoster(allPlayers);

  const rowsHtml = filtered.length > 0
    ? filtered.map((p, i) => {
        const name = p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Player';
        const fac = formatEventPlayerFaction(p.faction || p.army_name);
        const det = p.detachment && p.detachment !== 'Unknown' ? p.detachment : '';
        const hasList = Boolean(p.list_id || p.army_list || p.list_text || p.has_list || p.has_list_submitted);
        const statusBadge = p.dropped
          ? `<span class="badge" style="background:rgba(239,68,68,0.18); color:#f87171; font-size:0.68rem;">🚪 Dropped</span>`
          : (p.checked_in
              ? `<span class="badge" style="background:rgba(34,197,94,0.16); color:#4ade80; font-size:0.68rem;">✅ Checked In</span>`
              : `<span class="badge" style="background:rgba(245,158,11,0.18); color:#fbbf24; font-size:0.68rem;">⚠️ Not Checked In</span>`);
        const pid = String(p.player_id || p.id || '');
        const lid = String(p.list_id || '');
        const safeNameJs = escapeHtml(name.replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
        const safeFacJs = escapeHtml((fac || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
        return `
          <tr class="to-hub-roster-row">
            <td class="to-hub-col-idx" style="padding:0.5rem 0.65rem; font-family:var(--font-mono); color:var(--text-muted); font-size:0.78rem;">${i + 1}</td>
            <td class="to-hub-col-name" style="padding:0.5rem 0.65rem; font-weight:700; color:#f8fafc; font-size:0.84rem;">
              <span onclick="openToHubPlayerCommsModal('${escapeHtml(pid)}', '${safeNameJs}', '${safeFacJs}', '${escapeHtml(lid)}')" style="cursor:pointer; display:inline-flex; align-items:center; gap:0.35rem; max-width:100%; color:#f8fafc; text-decoration:underline; text-decoration-color:rgba(56,189,248,0.45); text-underline-offset:3px;" title="Click to message or alert ${escapeHtml(name)}">
                <span class="to-hub-mobile-row-idx" style="display:none; font-family:var(--font-mono); font-size:0.72rem; color:#94a3b8; text-decoration:none; flex-shrink:0;">#${i + 1}</span>
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(name)}</span>
                <span style="font-size:0.72rem; opacity:0.85; text-decoration:none; flex-shrink:0;">💬</span>
              </span>
            </td>
            <td class="to-hub-col-status" style="padding:0.5rem 0.65rem;">${statusBadge}</td>
            <td class="to-hub-col-faction" style="padding:0.5rem 0.65rem; font-size:0.8rem; color:${(!fac || fac === 'Unknown') ? '#f87171' : '#38bdf8'}; font-weight:600;">
              ${escapeHtml(fac || 'Unassigned')}
              ${det ? `<div style="font-size:0.7rem; color:var(--text-muted); font-weight:500;">${escapeHtml(det)}</div>` : ''}
            </td>
            <td class="to-hub-col-actions" style="padding:0.5rem 0.65rem; text-align:right;">
              <div style="display:inline-flex; align-items:center; gap:0.35rem; justify-content:flex-end; flex-wrap:wrap;">
                <button type="button" class="btn btn-outline" onclick="openToHubPlayerCommsModal('${escapeHtml(pid)}', '${safeNameJs}', '${safeFacJs}', '${escapeHtml(lid)}')" style="font-size:0.72rem; padding:0.25rem 0.55rem; color:#38bdf8; border-color:rgba(56,189,248,0.35);" title="Send announcement or direct chat to ${escapeHtml(name)}">
                  💬 Message
                </button>
                ${hasList ? `
                  <button type="button" class="btn btn-outline" onclick="openEventPlayerListModal('${escapeHtml(pid)}', '${safeNameJs}', '${escapeHtml(lid)}')" style="font-size:0.72rem; padding:0.25rem 0.55rem; color:#4ade80; border-color:rgba(34,197,94,0.35);">
                    📄 View List
                  </button>
                ` : `
                  <span class="badge" style="background:rgba(239,68,68,0.16); color:#fca5a5; border:1px solid rgba(239,68,68,0.35); font-size:0.68rem;">❌ Missing List</span>
                `}
              </div>
            </td>
          </tr>
        `;
      }).join('')
    : `<tr><td colspan="5" style="padding:1.5rem; text-align:center; color:var(--text-muted);">No players match this compliance filter.</td></tr>`;

  return `
    ${roundCompletionHeaderHtml}
    <div class="card to-hub-roster-card" style="padding:1rem 1.15rem; background:rgba(15,23,42,0.82); border:1px solid rgba(255,255,255,0.09); border-radius:10px;">
      <!-- Compliance Filter Pills -->
      <div class="to-hub-roster-toolbar" style="display:flex; align-items:center; justify-content:space-between; gap:0.65rem; flex-wrap:wrap; margin-bottom:0.85rem;">
        <div class="to-hub-roster-filter-pills" style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
          <button type="button" class="btn ${_toHubRosterFilter === 'all' ? 'btn-primary' : 'btn-outline'}" onclick="setToHubRosterFilter('all')" style="font-size:0.73rem; padding:0.3rem 0.6rem;">
            All (${allPlayers.length})
          </button>
          <button type="button" class="btn ${_toHubRosterFilter === 'checked_in' ? 'btn-primary' : 'btn-outline'}" onclick="setToHubRosterFilter('checked_in')" style="font-size:0.73rem; padding:0.3rem 0.6rem;">
            ✅ Checked In (${checkedInCount})
          </button>
          <button type="button" class="btn ${_toHubRosterFilter === 'not_checked_in' ? 'btn-primary' : 'btn-outline'}" onclick="setToHubRosterFilter('not_checked_in')" style="font-size:0.73rem; padding:0.3rem 0.6rem;">
            ⚠️ Not Checked In (${notCheckedInCount})
          </button>
          <button type="button" class="btn ${_toHubRosterFilter === 'list_submitted' ? 'btn-primary' : 'btn-outline'}" onclick="setToHubRosterFilter('list_submitted')" style="font-size:0.73rem; padding:0.3rem 0.6rem;">
            📄 List Submitted (${hasListCount})
          </button>
          <button type="button" class="btn ${_toHubRosterFilter === 'missing_list' ? 'btn-primary' : 'btn-outline'}" onclick="setToHubRosterFilter('missing_list')" style="font-size:0.73rem; padding:0.3rem 0.6rem;">
            ❌ Missing List (${missingListCount})
          </button>
          <button type="button" class="btn ${_toHubRosterFilter === 'unassigned_faction' ? 'btn-primary' : 'btn-outline'}" onclick="setToHubRosterFilter('unassigned_faction')" style="font-size:0.73rem; padding:0.3rem 0.6rem;">
            ❓ Unassigned Faction (${unassignedFacCount})
          </button>
          <button type="button" class="btn ${_toHubRosterFilter === 'dropped' ? 'btn-primary' : 'btn-outline'}" onclick="setToHubRosterFilter('dropped')" style="font-size:0.73rem; padding:0.3rem 0.6rem;">
            🚪 Dropped (${droppedCount})
          </button>
        </div>

        <div class="to-hub-roster-search-bar" style="display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap;">
          <input class="to-hub-roster-search-input" type="text" placeholder="Search player or faction..." value="${escapeHtml(_toHubRosterSearch)}" oninput="handleToHubRosterSearch(this.value)" style="padding:0.36rem 0.7rem; border-radius:8px; border:1px solid rgba(255,255,255,0.15); background:rgba(15,23,42,0.9); color:#fff; font-size:0.78rem; min-width:190px; box-sizing:border-box;" />
          <button type="button" class="btn btn-outline to-hub-copy-roster-btn" onclick="copyToHubFilteredRosterNames()" style="font-size:0.74rem; font-weight:700; padding:0.36rem 0.7rem;">
            📋 Copy Filtered Names (${filtered.length})
          </button>
        </div>
      </div>

      <!-- Roster Table -->
      <div class="table-responsive to-hub-roster-table-wrap" style="max-height:460px; overflow-y:auto;">
        <table class="data-table to-hub-roster-table" style="width:100%; border-collapse:collapse;">
          <thead>
            <tr>
              <th style="width:45px; padding:0.5rem 0.65rem;">#</th>
              <th style="padding:0.5rem 0.65rem;">Competitor</th>
              <th style="padding:0.5rem 0.65rem;">Registration Status</th>
              <th style="padding:0.5rem 0.65rem;">Faction / Detachment</th>
              <th style="padding:0.5rem 0.65rem; text-align:right;">Actions & List</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ----------------------------------------------------------------------------
// TO TABLE & PLAYER COMMS MODAL (DIRECT OMNICHAT + TARGETED TABLE/PLAYER BANNER)
// ----------------------------------------------------------------------------
let _toHubCommsContext = null;

function closeToHubCommsModal() {
  const modal = document.getElementById('to-hub-comms-modal');
  if (typeof closeModal === 'function') {
    closeModal('to-hub-comms-modal');
  }
  if (modal) {
    modal.remove();
  }
}

function openToHubTableCommsModal(matchIdx, initialTarget = 'table') {
  const matches = Array.isArray(window._toHubCurrentRoundMatches) ? window._toHubCurrentRoundMatches : [];
  const m = matches[matchIdx];
  if (!m) {
    if (typeof showToast === 'function') showToast('Could not load table details', 'warning');
    return;
  }

  ensureEventSearchIndex();
  const eventId = currentOpenEventId || (currentEventData && currentEventData.id) || '';
  const evName = (currentEventData && (currentEventData.name || currentEventData.event_name)) || 'Live Tournament';
  const tableNum = m.tableNum || m.table_number || m.table || (matchIdx + 1);
  const roundNum = m.round || m.round_number || _toHubRadarRound || 1;
  const matchId = m.tracker_match_id || `BCP-${eventId}-R${roundNum}-T${tableNum}`;

  const p1Name = m.player1_name || 'Player 1';
  const p2Name = m.player2_name || (m.is_bye ? 'BYE' : 'Player 2');
  const p1Rec = m._p1Record !== undefined ? m._p1Record : lookupEventPlayerFast(m.player1_id, p1Name);
  const p2Rec = m._p2Record !== undefined ? m._p2Record : lookupEventPlayerFast(m.player2_id, p2Name);
  const p1Id = String((p1Rec && (p1Rec.player_id || p1Rec.id)) || m.player1_id || '');
  const p2Id = String((p2Rec && (p2Rec.player_id || p2Rec.id)) || m.player2_id || '');
  const p1Fac = (p1Rec && p1Rec._displayFac) || formatEventPlayerFaction(m.player1_faction || p1Rec?.faction);
  const p2Fac = m.is_bye ? 'BYE' : ((p2Rec && p2Rec._displayFac) || formatEventPlayerFaction(m.player2_faction || p2Rec?.faction));
  const p1ListId = String(m.player1_list_id || (p1Rec && (p1Rec.list_id || p1Rec.listId)) || '');
  const p2ListId = String(m.player2_list_id || (p2Rec && (p2Rec.list_id || p2Rec.listId)) || '');
  const p1HasList = Boolean((p1Rec && hasPlayerSubmittedList(p1Rec)) || p1ListId);
  const p2HasList = Boolean(!m.is_bye && ((p2Rec && hasPlayerSubmittedList(p2Rec)) || p2ListId));

  _toHubCommsContext = {
    mode: 'table',
    eventId: String(eventId),
    eventName: evName,
    tableNum,
    roundNum,
    matchId: String(matchId),
    selectedTarget: (initialTarget === 'p2' && m.is_bye) ? 'p1' : (initialTarget || 'table'),
    isBye: Boolean(m.is_bye || String(p2Name).toUpperCase() === 'BYE'),
    p1: { id: p1Id, name: p1Name, faction: p1Fac, listId: p1ListId, hasList: p1HasList },
    p2: { id: p2Id, name: p2Name, faction: p2Fac, listId: p2ListId, hasList: p2HasList },
  };

  renderToHubCommsModalDom();
}

function openToHubPlayerCommsModal(playerId, playerName, faction = '', listId = '') {
  const eventId = currentOpenEventId || (currentEventData && currentEventData.id) || '';
  const evName = (currentEventData && (currentEventData.name || currentEventData.event_name)) || 'Live Tournament';

  // Check if this player is seated at a table in the current round
  const matches = Array.isArray(window._toHubCurrentRoundMatches) ? window._toHubCurrentRoundMatches : [];
  const normName = String(playerName || '').trim().toLowerCase();
  const seatedIdx = matches.findIndex(m => {
    if (!m) return false;
    if (playerId && (String(m.player1_id) === String(playerId) || String(m.player2_id) === String(playerId))) return true;
    if (normName && (String(m.player1_name || '').trim().toLowerCase() === normName || String(m.player2_name || '').trim().toLowerCase() === normName)) return true;
    return false;
  });

  if (seatedIdx >= 0) {
    const m = matches[seatedIdx];
    const isP2 = (playerId && String(m.player2_id) === String(playerId)) ||
      (normName && String(m.player2_name || '').trim().toLowerCase() === normName);
    openToHubTableCommsModal(seatedIdx, isP2 ? 'p2' : 'p1');
    return;
  }

  _toHubCommsContext = {
    mode: 'player',
    eventId: String(eventId),
    eventName: evName,
    tableNum: null,
    roundNum: _toHubRadarRound || 1,
    matchId: null,
    selectedTarget: 'p1',
    isBye: true,
    p1: { id: String(playerId || ''), name: playerName || 'Player', faction: faction || '', listId: String(listId || ''), hasList: Boolean(listId) },
    p2: null,
  };

  renderToHubCommsModalDom();
}

function getToHubCommsTargetSummary(ctx) {
  if (!ctx) return { label: 'Table', targets: [], targetTable: null, targetPlayerId: null, targetPlayerName: null };
  if (ctx.selectedTarget === 'p1' && ctx.p1) {
    return {
      label: ctx.tableNum ? `${ctx.p1.name} (Table ${ctx.tableNum})` : ctx.p1.name,
      shortPrefix: ctx.tableNum ? `Table ${ctx.tableNum} • ${ctx.p1.name}` : ctx.p1.name,
      targets: [{ player_id: ctx.p1.id, player_name: ctx.p1.name }],
      targetTable: ctx.tableNum || null,
      targetPlayerId: ctx.p1.id || null,
      targetPlayerName: ctx.p1.name || null,
    };
  }
  if (ctx.selectedTarget === 'p2' && ctx.p2 && !ctx.isBye) {
    return {
      label: ctx.tableNum ? `${ctx.p2.name} (Table ${ctx.tableNum})` : ctx.p2.name,
      shortPrefix: ctx.tableNum ? `Table ${ctx.tableNum} • ${ctx.p2.name}` : ctx.p2.name,
      targets: [{ player_id: ctx.p2.id, player_name: ctx.p2.name }],
      targetTable: ctx.tableNum || null,
      targetPlayerId: ctx.p2.id || null,
      targetPlayerName: ctx.p2.name || null,
    };
  }
  const bothTargets = [];
  if (ctx.p1 && ctx.p1.name) bothTargets.push({ player_id: ctx.p1.id, player_name: ctx.p1.name });
  if (ctx.p2 && ctx.p2.name && !ctx.isBye) bothTargets.push({ player_id: ctx.p2.id, player_name: ctx.p2.name });
  const namesPair = bothTargets.map(t => t.player_name).join(' vs ');
  return {
    label: ctx.tableNum ? `Table ${ctx.tableNum} (${namesPair})` : namesPair,
    shortPrefix: ctx.tableNum ? `Table ${ctx.tableNum} (${namesPair})` : namesPair,
    targets: bothTargets,
    targetTable: ctx.tableNum || null,
    targetPlayerId: null,
    targetPlayerName: bothTargets.length === 1 ? bothTargets[0].player_name : `${namesPair}`,
  };
}

function selectToHubCommsTarget(targetMode) {
  if (!_toHubCommsContext) return;
  _toHubCommsContext.selectedTarget = targetMode;
  // Preserve draft message if user typed something custom, otherwise update target pills
  const msgEl = document.getElementById('to-hub-comms-message-input');
  const lvlEl = document.getElementById('to-hub-comms-level-select');
  const currentMsg = msgEl ? msgEl.value : '';
  const currentLvl = lvlEl ? lvlEl.value : 'info';
  renderToHubCommsModalDom(currentMsg, currentLvl);
}

function applyToHubCommsPreset(presetType) {
  if (!_toHubCommsContext) return;
  const ctx = _toHubCommsContext;
  const info = getToHubCommsTargetSummary(ctx);
  const msgInput = document.getElementById('to-hub-comms-message-input');
  const lvlSelect = document.getElementById('to-hub-comms-level-select');
  if (!msgInput) return;

  let text = '';
  let level = 'info';
  if (presetType === 'submit_score') {
    text = `🎲 ${info.shortPrefix}: Please submit your final Round ${ctx.roundNum || ''} score in BCP / Game Tracker now!`.replace(/\s+/g, ' ');
    level = 'urgent';
  } else if (presetType === 'clock_warning') {
    text = `⏱️ ${info.shortPrefix}: 15 minutes remaining in Round ${ctx.roundNum || ''}. Please finish your current battle round and prepare final scores.`.replace(/\s+/g, ' ');
    level = 'warning';
  } else if (presetType === 'judge_en_route') {
    text = `⚖️ ${info.shortPrefix}: A Tournament Judge has been dispatched and is heading to your table now.`;
    level = 'info';
  } else if (presetType === 'report_to_desk') {
    text = `🏛️ ${info.shortPrefix}: Please report to the TO Desk at your earliest convenience.`;
    level = 'warning';
  } else if (presetType === 'list_check') {
    text = `📄 ${info.shortPrefix}: Please verify your registration check-in or army list submission with the Tournament Organizer.`;
    level = 'warning';
  }

  msgInput.value = text;
  if (lvlSelect) lvlSelect.value = level;
  msgInput.focus();
}

function renderToHubCommsModalDom(preserveMsg = '', preserveLevel = 'warning') {
  const ctx = _toHubCommsContext;
  if (!ctx) return;

  let modal = document.getElementById('to-hub-comms-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'to-hub-comms-modal';
    modal.className = 'modal-backdrop';
    modal.style.cssText = 'position:fixed; inset:0; background:rgba(2,6,23,0.82); backdrop-filter:blur(6px); display:flex; align-items:center; justify-content:center; padding:1rem; box-sizing:border-box;';
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeToHubCommsModal();
    });
    document.body.appendChild(modal);
  }
  if (!modal.classList.contains('active') && typeof bringModalToFront === 'function') {
    bringModalToFront(modal);
  }

  const info = getToHubCommsTargetSummary(ctx);
  const isTableMode = Boolean(ctx.tableNum);
  const p1SafeId = escapeHtml((ctx.p1?.id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  const p2SafeId = escapeHtml((ctx.p2?.id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  const p1SafeName = escapeHtml((ctx.p1?.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  const p2SafeName = escapeHtml((ctx.p2?.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  const p1SafeListId = escapeHtml((ctx.p1?.listId || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  const p2SafeListId = escapeHtml((ctx.p2?.listId || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  const safeMatchId = escapeHtml((ctx.matchId || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));

  const defaultMsg = preserveMsg || (
    ctx.selectedTarget === 'table' && ctx.tableNum
      ? `🎲 Table ${ctx.tableNum} (${ctx.p1?.name || 'Player 1'}${!ctx.isBye && ctx.p2 ? ` vs ${ctx.p2.name}` : ''}): `
      : `👋 ${info.shortPrefix}: `
  );

  modal.innerHTML = `
    <div class="card" style="width:100%; max-width:580px; background:linear-gradient(165deg, rgba(15,23,42,0.98), rgba(9,14,28,0.99)); border:1px solid rgba(56,189,248,0.4); border-radius:14px; padding:1.2rem 1.3rem; box-shadow:0 24px 60px rgba(0,0,0,0.75); color:#f8fafc; max-height:92vh; overflow-y:auto;">
      <!-- Modal Header -->
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:0.75rem; margin-bottom:0.95rem; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:0.75rem;">
        <div>
          <div style="display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap;">
            <span class="badge" style="background:rgba(56,189,248,0.18); color:#38bdf8; border:1px solid rgba(56,189,248,0.4); font-size:0.7rem; font-weight:800;">
              🏛️ TO DIRECT COMMS
            </span>
            ${ctx.tableNum ? `
              <span class="badge" style="background:rgba(245,158,11,0.18); color:#fbbf24; border:1px solid rgba(245,158,11,0.35); font-size:0.7rem; font-weight:800;">
                🎲 TABLE ${escapeHtml(String(ctx.tableNum))} • ROUND ${escapeHtml(String(ctx.roundNum))}
              </span>
            ` : ''}
            ${ctx.matchId && !ctx.isBye ? `
              <button type="button" class="btn-xs btn-outline" onclick="openScorecardModal('${safeMatchId}')" style="font-size:0.7rem; padding:2px 8px; border-radius:6px; color:#38bdf8; border:1px solid rgba(56,189,248,0.4); background:rgba(56,189,248,0.1); cursor:pointer; font-weight:700; display:inline-flex; align-items:center; gap:4px;">
                📄 View Scorecard
              </button>
            ` : ''}
          </div>
          <h3 style="margin:0.4rem 0 0; font-size:1.05rem; font-weight:800; color:#fff;">
            Message or Alert ${escapeHtml(info.label)}
          </h3>
          <div style="font-size:0.76rem; color:var(--text-muted); margin-top:0.15rem;">
            Send a targeted live alert banner (App + Game Tracker) or direct OmniChat message.
          </div>
        </div>
        <button type="button" onclick="closeToHubCommsModal()" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#cbd5e1; border-radius:8px; width:32px; height:32px; cursor:pointer; font-size:0.95rem; line-height:1;">
          ✕
        </button>
      </div>

      <!-- Target Selector -->
      <div style="margin-bottom:0.95rem;">
        <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:#94a3b8; margin-bottom:0.45rem;">
          🎯 1. Select Recipient Target
        </div>
        <div style="display:grid; grid-template-columns:${isTableMode && !ctx.isBye ? 'repeat(auto-fit, minmax(155px, 1fr))' : '1fr'}; gap:0.45rem;">
          ${isTableMode ? `
            <button type="button" onclick="selectToHubCommsTarget('table')" style="text-align:left; padding:0.55rem 0.7rem; border-radius:9px; cursor:pointer; transition:all 0.15s; border:1px solid ${ctx.selectedTarget === 'table' ? '#38bdf8' : 'rgba(255,255,255,0.12)'}; background:${ctx.selectedTarget === 'table' ? 'rgba(56,189,248,0.18)' : 'rgba(15,23,42,0.75)'}; color:#fff;">
              <div style="font-size:0.78rem; font-weight:800; color:${ctx.selectedTarget === 'table' ? '#38bdf8' : '#f8fafc'};">
                🎲 Table ${escapeHtml(String(ctx.tableNum))} (Both)
              </div>
              <div style="font-size:0.68rem; color:var(--text-muted); margin-top:0.12rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${escapeHtml(ctx.p1?.name || 'P1')}${!ctx.isBye && ctx.p2 ? ` & ${escapeHtml(ctx.p2.name)}` : ''}
              </div>
            </button>
          ` : ''}

          ${ctx.p1 ? `
            <div style="display:flex; align-items:stretch; gap:0.25rem;">
              <button type="button" onclick="selectToHubCommsTarget('p1')" style="flex:1; text-align:left; padding:0.55rem 0.7rem; border-radius:9px; cursor:pointer; transition:all 0.15s; border:1px solid ${ctx.selectedTarget === 'p1' ? '#38bdf8' : 'rgba(255,255,255,0.12)'}; background:${ctx.selectedTarget === 'p1' ? 'rgba(56,189,248,0.18)' : 'rgba(15,23,42,0.75)'}; color:#fff; min-width:0;">
                <div style="font-size:0.78rem; font-weight:800; color:${ctx.selectedTarget === 'p1' ? '#38bdf8' : '#f8fafc'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  👤 ${escapeHtml(ctx.p1.name)}
                </div>
                <div style="font-size:0.68rem; color:var(--text-muted); margin-top:0.12rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  ${escapeHtml(ctx.p1.faction || 'Competitor')}
                </div>
              </button>
              <button type="button" class="btn btn-outline" onclick="openEventPlayerListModal('${p1SafeId}', '${p1SafeName}', '${p1SafeListId}')" title="View ${escapeHtml(ctx.p1.name)}'s Army Roster" style="padding:0 0.5rem; font-size:0.72rem; border-radius:9px; color:${ctx.p1.hasList ? '#38bdf8' : '#94a3b8'}; border-color:${ctx.p1.hasList ? 'rgba(56,189,248,0.4)' : 'rgba(148,163,184,0.28)'};">
                📋
              </button>
            </div>
          ` : ''}

          ${ctx.p2 && !ctx.isBye ? `
            <div style="display:flex; align-items:stretch; gap:0.25rem;">
              <button type="button" onclick="selectToHubCommsTarget('p2')" style="flex:1; text-align:left; padding:0.55rem 0.7rem; border-radius:9px; cursor:pointer; transition:all 0.15s; border:1px solid ${ctx.selectedTarget === 'p2' ? '#38bdf8' : 'rgba(255,255,255,0.12)'}; background:${ctx.selectedTarget === 'p2' ? 'rgba(56,189,248,0.18)' : 'rgba(15,23,42,0.75)'}; color:#fff; min-width:0;">
                <div style="font-size:0.78rem; font-weight:800; color:${ctx.selectedTarget === 'p2' ? '#38bdf8' : '#f8fafc'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  👤 ${escapeHtml(ctx.p2.name)}
                </div>
                <div style="font-size:0.68rem; color:var(--text-muted); margin-top:0.12rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  ${escapeHtml(ctx.p2.faction || 'Competitor')}
                </div>
              </button>
              <button type="button" class="btn btn-outline" onclick="openEventPlayerListModal('${p2SafeId}', '${p2SafeName}', '${p2SafeListId}')" title="View ${escapeHtml(ctx.p2.name)}'s Army Roster" style="padding:0 0.5rem; font-size:0.72rem; border-radius:9px; color:${ctx.p2.hasList ? '#38bdf8' : '#94a3b8'}; border-color:${ctx.p2.hasList ? 'rgba(56,189,248,0.4)' : 'rgba(148,163,184,0.28)'};">
                📋
              </button>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Quick Presets -->
      <div style="margin-bottom:0.85rem;">
        <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:#94a3b8; margin-bottom:0.4rem;">
          ⚡ 2. Quick TO Templates (Optional)
        </div>
        <div style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
          <button type="button" class="btn btn-outline" onclick="applyToHubCommsPreset('submit_score')" style="font-size:0.72rem; padding:0.26rem 0.55rem; color:#fca5a5; border-color:rgba(239,68,68,0.35);">
            🎲 Submit Score Now
          </button>
          <button type="button" class="btn btn-outline" onclick="applyToHubCommsPreset('clock_warning')" style="font-size:0.72rem; padding:0.26rem 0.55rem; color:#fde047; border-color:rgba(245,158,11,0.35);">
            ⏱️ 15m Left Warning
          </button>
          <button type="button" class="btn btn-outline" onclick="applyToHubCommsPreset('judge_en_route')" style="font-size:0.72rem; padding:0.26rem 0.55rem; color:#38bdf8; border-color:rgba(56,189,248,0.35);">
            ⚖️ Judge On The Way
          </button>
          <button type="button" class="btn btn-outline" onclick="applyToHubCommsPreset('report_to_desk')" style="font-size:0.72rem; padding:0.26rem 0.55rem;">
            🏛️ Report to TO Desk
          </button>
          <button type="button" class="btn btn-outline" onclick="applyToHubCommsPreset('list_check')" style="font-size:0.72rem; padding:0.26rem 0.55rem;">
            📄 Verify Check-In / List
          </button>
        </div>
      </div>

      <!-- Message & Priority -->
      <div style="margin-bottom:0.9rem;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; margin-bottom:0.4rem;">
          <label for="to-hub-comms-message-input" style="font-size:0.72rem; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:#94a3b8;">
            ✍️ 3. Message Content
          </label>
          <div style="display:flex; align-items:center; gap:0.35rem;">
            <span style="font-size:0.7rem; color:var(--text-muted);">Priority:</span>
            <select id="to-hub-comms-level-select" style="padding:0.22rem 0.5rem; border-radius:6px; border:1px solid rgba(255,255,255,0.16); background:rgba(15,23,42,0.95); color:#fff; font-size:0.74rem; font-weight:700;">
              <option value="info" ${preserveLevel === 'info' ? 'selected' : ''}>📢 Info (Blue)</option>
              <option value="warning" ${preserveLevel === 'warning' ? 'selected' : ''}>⚠️ Warning (Amber)</option>
              <option value="urgent" ${preserveLevel === 'urgent' ? 'selected' : ''}>🚨 Urgent (Red)</option>
            </select>
          </div>
        </div>
        <textarea id="to-hub-comms-message-input" rows="3" placeholder="Type your message or announcement for ${escapeHtml(info.label)}..." style="width:100%; box-sizing:border-box; padding:0.65rem 0.75rem; border-radius:9px; border:1px solid rgba(56,189,248,0.35); background:rgba(2,6,23,0.85); color:#fff; font-size:0.86rem; line-height:1.4; resize:vertical;">${escapeHtml(defaultMsg)}</textarea>
      </div>

      <!-- Delivery Status / Live Chat Result Container -->
      ${(() => {
        const cachedSt = _eventToHubStateCache.get(String(ctx.eventId)) || {};
        const tList = Array.isArray(cachedSt.targeted_broadcasts) ? cachedSt.targeted_broadcasts : [];
        const curTargetKey = computeClientBroadcastTargetKey({
          target_table: info.targetTable ? String(info.targetTable) : null,
          target_player_id: info.targetPlayerId ? String(info.targetPlayerId) : null,
          target_player_name: info.targetPlayerName ? String(info.targetPlayerName) : null,
        });
        const existingTargeted = tList.find(b => b && b.message && b.active !== false && computeClientBroadcastTargetKey(b) === curTargetKey);
        if (!existingTargeted) {
          return `<div id="to-hub-comms-result-box" style="display:none; margin-bottom:0.85rem;"></div>`;
        }
        const safeTKey = escapeHtml((curTargetKey || String(existingTargeted.id || '')).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
        return `
          <div id="to-hub-comms-result-box" style="display:block; margin-bottom:0.85rem;">
            <div style="padding:0.6rem 0.75rem; border-radius:8px; background:rgba(34,197,94,0.14); border:1px solid rgba(34,197,94,0.4); color:#bbf7d0; font-size:0.78rem; display:flex; align-items:center; justify-content:space-between; gap:0.6rem; flex-wrap:wrap;">
              <div style="min-width:0; flex:1;">
                <div style="font-weight:800; color:#4ade80;">🟢 Active Targeted Alert for ${escapeHtml(info.label)}:</div>
                <div style="font-weight:600; color:#f8fafc; margin-top:0.15rem; word-break:break-word;">${escapeHtml(existingTargeted.message)}</div>
              </div>
              <button type="button" class="btn btn-outline" onclick="clearToHubBannerAnnouncement('${safeTKey}')" style="font-size:0.7rem; font-weight:800; padding:0.24rem 0.55rem; color:#fca5a5; border-color:rgba(239,68,68,0.45); flex-shrink:0;">
                ✕ Recall Alert
              </button>
            </div>
          </div>
        `;
      })()}

      <!-- Action Buttons -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:0.55rem;">
        <button type="button" id="to-hub-comms-chat-btn" class="btn btn-primary" onclick="sendToHubCommsDirectChat()" style="padding:0.6rem 0.85rem; font-size:0.8rem; font-weight:800; display:flex; align-items:center; justify-content:center; gap:0.4rem; background:linear-gradient(135deg, #0284c7, #2563eb); border:1px solid rgba(56,189,248,0.5);">
          💬 Send Direct Chat Message
        </button>
        <button type="button" id="to-hub-comms-banner-btn" class="btn btn-outline" onclick="sendToHubCommsBanner()" style="padding:0.6rem 0.85rem; font-size:0.8rem; font-weight:800; display:flex; align-items:center; justify-content:center; gap:0.4rem; color:#fde047; border-color:rgba(250,204,21,0.45); background:rgba(250,204,21,0.1);">
          📢 Push Targeted Live Banner
        </button>
      </div>
      <div style="font-size:0.7rem; color:var(--text-muted); margin-top:0.55rem; line-height:1.35;">
        💡 <strong>Direct Chat</strong> messages the player(s) in OmniChat (and automatically falls back to a Targeted Live Banner if they haven't linked an OmniTactica login yet). <strong>Push Targeted Live Banner</strong> flashes across the app &amp; ${ctx.tableNum ? `Table ${escapeHtml(String(ctx.tableNum))} Game Tracker` : 'Event Hub'} without overwriting your general tournament announcement.
      </div>
    </div>
  `;
}

async function sendToHubCommsBanner() {
  const ctx = _toHubCommsContext;
  if (!ctx || !ctx.eventId) return;
  const msgInput = document.getElementById('to-hub-comms-message-input');
  const lvlSelect = document.getElementById('to-hub-comms-level-select');
  const btn = document.getElementById('to-hub-comms-banner-btn');
  const resultBox = document.getElementById('to-hub-comms-result-box');

  const message = String(msgInput ? msgInput.value : '').trim();
  const level = String(lvlSelect ? lvlSelect.value : 'warning');
  if (!message) {
    if (typeof showToast === 'function') showToast('Please enter a message first', 'warning');
    return;
  }

  const info = getToHubCommsTargetSummary(ctx);
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Broadcasting...';
  }

  const evName = (currentEventData && (currentEventData.name || currentEventData.event_name)) || ctx.eventName || '';
  let pushedOk = false;
  try {
    recordRecentInteractedEventId(ctx.eventId);
    const res = await window.api.publishEventToHubAnnouncement(ctx.eventId, {
      message,
      level,
      round: ctx.roundNum || null,
      event_name: evName,
      target_table: info.targetTable ? String(info.targetTable) : null,
      target_player_id: info.targetPlayerId ? String(info.targetPlayerId) : null,
      target_player_name: info.targetPlayerName ? String(info.targetPlayerName) : null,
      also_post_bulletin: false,
    });
    const pushedBroadcast = (res && res.broadcast) ? res.broadcast : {
      id: `ann_${Date.now()}`,
      event_id: String(ctx.eventId),
      event_name: evName,
      message,
      level,
      round: ctx.roundNum || null,
      target_table: info.targetTable ? String(info.targetTable) : null,
      target_player_id: info.targetPlayerId ? String(info.targetPlayerId) : null,
      target_player_name: info.targetPlayerName ? String(info.targetPlayerName) : null,
      is_targeted: true,
      published_at: new Date().toISOString(),
      active: true,
    };
    pushedBroadcast.target_key = pushedBroadcast.target_key || computeClientBroadcastTargetKey(pushedBroadcast);

    await syncToHubBroadcastToClientFirestore(ctx.eventId, pushedBroadcast);
    if (pushedBroadcast.id) {
      try {
        localStorage.removeItem(`dismissed_event_broadcast_${pushedBroadcast.id}`);
      } catch (_) {}
    }

    if (res && res.state) {
      res.state._fetchedAt = Date.now();
      _eventToHubStateCache.set(String(ctx.eventId), res.state);
    } else {
      const prevState = _eventToHubStateCache.get(String(ctx.eventId)) || {};
      const prevTargeted = Array.isArray(prevState.targeted_broadcasts) ? prevState.targeted_broadcasts : [];
      const nextTargeted = [
        pushedBroadcast,
        ...prevTargeted.filter(b => computeClientBroadcastTargetKey(b) !== pushedBroadcast.target_key),
      ];
      _eventToHubStateCache.set(String(ctx.eventId), {
        ...prevState,
        targeted_broadcasts: nextTargeted,
        _fetchedAt: Date.now(),
      });
    }

    if (currentEventData) {
      renderEventClockAndScheduleWidgets(currentEventData, true);
      renderEventToHub(currentEventData, true);
    }
    await syncGlobalEventAnnouncementBanner(true);
    pushedOk = true;

    if (typeof showToast === 'function') {
      showToast(`📢 Targeted Live Banner pushed to ${info.label}!`, 'success');
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✅ Targeted Banner Pushed!';
      btn.style.background = 'rgba(34,197,94,0.24)';
      btn.style.borderColor = 'rgba(34,197,94,0.65)';
      btn.style.color = '#86efac';
      setTimeout(() => {
        const latestBtn = document.getElementById('to-hub-comms-banner-btn');
        if (latestBtn) {
          latestBtn.textContent = '📢 Push Targeted Live Banner';
          latestBtn.style.background = 'rgba(250,204,21,0.1)';
          latestBtn.style.borderColor = 'rgba(250,204,21,0.45)';
          latestBtn.style.color = '#fde047';
        }
      }, 2400);
    }
    if (resultBox) {
      const safeTKey = escapeHtml(String(pushedBroadcast.target_key || pushedBroadcast.id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
      resultBox.style.display = 'block';
      resultBox.innerHTML = `
        <div style="padding:0.65rem 0.8rem; border-radius:9px; background:rgba(34,197,94,0.16); border:1px solid rgba(34,197,94,0.45); color:#bbf7d0; font-size:0.78rem; display:flex; align-items:center; justify-content:space-between; gap:0.65rem; flex-wrap:wrap;">
          <div style="min-width:0; flex:1;">
            <div style="font-weight:800; color:#4ade80;">
              ✅ Targeted Live Banner Sent to ${escapeHtml(info.label)}!
            </div>
            <div style="font-size:0.74rem; color:#e2e8f0; margin-top:0.18rem; word-break:break-word;">
              "${escapeHtml(message)}" — Live now on ${info.targetTable ? `Table ${escapeHtml(String(info.targetTable))} Game Tracker &amp; ` : ''}Event Hub (does not overwrite general announcements).
            </div>
          </div>
          <button type="button" class="btn btn-outline" onclick="clearToHubBannerAnnouncement('${safeTKey}')" style="font-size:0.7rem; font-weight:800; padding:0.25rem 0.55rem; color:#fca5a5; border-color:rgba(239,68,68,0.45); flex-shrink:0;">
            ✕ Recall Alert
          </button>
        </div>
      `;
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Failed to publish targeted banner', 'error');
    if (resultBox) {
      resultBox.style.display = 'block';
      resultBox.innerHTML = `
        <div style="padding:0.6rem 0.75rem; border-radius:8px; background:rgba(239,68,68,0.16); border:1px solid rgba(239,68,68,0.45); color:#fecaca; font-size:0.78rem; font-weight:700;">
          ❌ Failed to push targeted banner: ${escapeHtml(err.message || 'Unknown error')}
        </div>
      `;
    }
  } finally {
    if (btn && !pushedOk) {
      btn.disabled = false;
      btn.textContent = '📢 Push Targeted Live Banner';
    }
  }
}

async function sendToHubCommsDirectChat() {
  const ctx = _toHubCommsContext;
  if (!ctx || !ctx.eventId) return;
  const msgInput = document.getElementById('to-hub-comms-message-input');
  const lvlSelect = document.getElementById('to-hub-comms-level-select');
  const btn = document.getElementById('to-hub-comms-chat-btn');
  const resultBox = document.getElementById('to-hub-comms-result-box');

  const message = String(msgInput ? msgInput.value : '').trim();
  const level = String(lvlSelect ? lvlSelect.value : 'warning');
  if (!message) {
    if (typeof showToast === 'function') showToast('Please enter a message first', 'warning');
    return;
  }

  const info = getToHubCommsTargetSummary(ctx);
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Sending Chat...';
  }

  const evName = (currentEventData && (currentEventData.name || currentEventData.event_name)) || '';
  try {
    recordRecentInteractedEventId(ctx.eventId);
    const res = await window.api.sendEventToHubDirectChat(ctx.eventId, {
      message,
      event_name: evName,
      table_number: info.targetTable ? String(info.targetTable) : null,
      round: ctx.roundNum || null,
      targets: info.targets,
      fallback_to_banner: true,
      level,
    });

    if (res && res.broadcast) {
      await syncToHubBroadcastToClientFirestore(ctx.eventId, res.broadcast);
    }
    if (res && res.state) {
      res.state._fetchedAt = Date.now();
      _eventToHubStateCache.set(String(ctx.eventId), res.state);
    }
    if (res && res.banner_fallback_used) {
      syncGlobalEventAnnouncementBanner(true).catch(() => {});
    }

    const delivered = Array.isArray(res?.delivered) ? res.delivered : [];
    const unmatched = Array.isArray(res?.unmatched) ? res.unmatched : [];

    if (delivered.length > 0) {
      if (typeof window.loadUserRequests === 'function') {
        window.loadUserRequests().catch(() => {});
      }
      if (typeof showToast === 'function') {
        showToast(`💬 Direct OmniChat sent to ${delivered.map(d => d.player_name).join(' & ')}!`, 'success');
      }
    } else if (res?.banner_fallback_used && typeof showToast === 'function') {
      showToast(`📢 Player hasn't linked OmniChat yet — delivered via Targeted Live Alert Banner!`, 'info');
    }

    if (resultBox) {
      resultBox.style.display = 'block';
      const chatButtonsHtml = delivered.map(d => {
        const safeReqId = escapeHtml(String(d.request_id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
        const safePName = escapeHtml(String(d.player_name || 'Player').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
        return `
          <button type="button" class="btn btn-primary" onclick="closeToHubCommsModal(); if (typeof window.openChatWithRequest === 'function') window.openChatWithRequest('${safeReqId}', '${safePName}'); else if (typeof window.openMatchChat === 'function') window.openMatchChat('${safeReqId}', '${safePName}');" style="font-size:0.73rem; font-weight:800; padding:0.3rem 0.65rem;">
            💬 Open Live Chat with ${escapeHtml(d.player_name || 'Player')}
          </button>
        `;
      }).join('');

      resultBox.innerHTML = `
        <div style="padding:0.65rem 0.8rem; border-radius:9px; background:rgba(14,165,233,0.14); border:1px solid rgba(56,189,248,0.4); color:#e0f2fe; font-size:0.78rem;">
          ${delivered.length > 0 ? `
            <div style="font-weight:800; color:#7dd3fc; margin-bottom:0.35rem;">
              ✅ Direct OmniChat delivered to ${escapeHtml(delivered.map(d => d.player_name).join(', '))}!
            </div>
            <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap; margin-bottom:${unmatched.length > 0 ? '0.4rem' : '0'};">
              ${chatButtonsHtml}
            </div>
          ` : ''}
          ${unmatched.length > 0 ? `
            <div style="color:#fde68a; font-weight:600; font-size:0.74rem;">
              📢 ${escapeHtml(unmatched.join(', '))} hasn't linked an OmniTactica chat account yet — your message was automatically pushed as a <strong>Targeted Live Alert Banner</strong> across the app &amp; Game Tracker!
            </div>
          ` : ''}
        </div>
      `;
    }
    if (currentEventData) {
      renderEventClockAndScheduleWidgets(currentEventData, true);
      renderEventToHub(currentEventData, true);
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Failed to send direct chat', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💬 Send Direct Chat Message';
    }
  }
}

// ----------------------------------------------------------------------------
// APP-WIDE GLOBAL EVENT ANNOUNCEMENT BANNER
// ----------------------------------------------------------------------------
function dismissGlobalEventAnnouncement(broadcastId) {
  if (broadcastId) {
    try {
      localStorage.setItem(`dismissed_event_broadcast_${broadcastId}`, '1');
    } catch (_) {}
  }
  syncGlobalEventAnnouncementBanner(false).catch(() => {});
}

function openGlobalAnnouncementEvent(eventId, gameSystem = '40k') {
  if (!eventId) return;
  openEventHubPage(eventId, gameSystem || '40k', { initialTab: 'news' });
}

function isTargetedAnnouncementRelevantToViewer(ann, hostedList, regList) {
  if (!ann || !isTargetedBroadcastObj(ann)) return true;
  const evId = String(ann.event_id || ann.eventId || '');
  // Always show to the user if they have this event open or recently interacted with it
  if (currentOpenEventId && String(currentOpenEventId) === evId) return true;
  if (window._recentInteractedEventIds instanceof Set && window._recentInteractedEventIds.has(evId)) return true;
  if (_eventToHubStateCache.has(evId)) return true;
  if (Array.isArray(hostedList) && hostedList.some(t => String(t?.event_id || t?.bcp_event_id || t?.id) === evId)) return true;
  if (Array.isArray(regList) && regList.some(t => String(t?.event_id || t?.bcp_event_id || t?.id) === evId)) return true;

  // Also check if the current logged-in user matches target_player_id or target_player_name
  const curUser = (typeof window.currentUser === 'object' && window.currentUser) ? window.currentUser : null;
  if (curUser) {
    const myPid = String(curUser.player_id || curUser.bcp_user_id || curUser.id || '').trim();
    if (myPid && String(ann.target_player_id || '').trim() === myPid) return true;
    const myName = String(curUser.display_name || curUser.username || '').trim().toLowerCase();
    const targetName = String(ann.target_player_name || '').trim().toLowerCase();
    if (myName && targetName && (targetName.includes(myName) || myName.includes(targetName))) return true;
  }
  return true;
}

function buildGlobalAnnouncementBannerRowHtml(active, hostedList, regList) {
  const bid = String(active.id || `${active.event_id}_${active.published_at || ''}`);
  const evId = String(active.event_id || active.eventId || '');
  let evName = active.event_name || '';
  if (!evName) {
    if (currentEventData && String(currentEventData.id) === evId) {
      evName = currentEventData.name || currentEventData.event_name || '';
    }
    if (!evName && hostedList.length > 0) {
      const found = hostedList.find(t => String(t.event_id || t.bcp_event_id || t.id) === evId);
      if (found) evName = found.event_name || found.name || '';
    }
    if (!evName && regList.length > 0) {
      const found = regList.find(t => String(t.event_id || t.bcp_event_id || t.id) === evId);
      if (found) evName = found.event_name || found.name || '';
    }
  }

  const isTargeted = isTargetedBroadcastObj(active);
  const lvl = String(active.level || 'info').toLowerCase();
  const bgGrad = lvl === 'urgent'
    ? 'linear-gradient(90deg, rgba(153,27,27,0.95), rgba(127,29,29,0.92))'
    : (lvl === 'warning'
        ? 'linear-gradient(90deg, rgba(146,64,14,0.95), rgba(120,53,15,0.92))'
        : 'linear-gradient(90deg, rgba(12,74,110,0.95), rgba(30,58,138,0.92))');
  const borderCol = lvl === 'urgent' ? 'rgba(248,113,113,0.6)' : (lvl === 'warning' ? 'rgba(251,191,36,0.6)' : 'rgba(56,189,248,0.55)');
  const icon = lvl === 'urgent' ? '🚨' : (lvl === 'warning' ? '⚠️' : '📢');

  const targetBadgeHtml = isTargeted
    ? `<span class="badge" style="background:rgba(250,204,21,0.22); color:#fef08a; border:1px solid rgba(250,204,21,0.5); font-size:0.68rem; font-weight:800; white-space:nowrap;">
        🎯 ${active.target_table ? `TABLE ${escapeHtml(String(active.target_table))}` : ''}${active.target_table && active.target_player_name ? ' • ' : ''}${active.target_player_name ? escapeHtml(String(active.target_player_name)) : 'TARGETED ALERT'}
      </span>`
    : `<span class="badge" style="background:rgba(34,197,94,0.2); color:#bbf7d0; border:1px solid rgba(34,197,94,0.45); font-size:0.65rem; font-weight:800; white-space:nowrap;">
        🌐 ALL PLAYERS
      </span>`;

  return `
    <div class="global-event-announcement-inner" style="background:${bgGrad}; border-bottom:1px solid ${borderCol}; padding:0.5rem 0.9rem; display:flex; align-items:center; justify-content:space-between; gap:0.65rem; flex-wrap:wrap; box-sizing:border-box; max-width:100vw; overflow:hidden;">
      <div class="global-event-announcement-content" style="display:flex; align-items:center; gap:0.5rem; flex:1; min-width:0; flex-wrap:wrap;">
        <span style="font-size:1rem; flex-shrink:0;">${icon}</span>
        <span class="badge global-event-announcement-badge" style="background:rgba(0,0,0,0.35); color:#fde68a; border:1px solid rgba(255,255,255,0.22); font-size:0.68rem; font-weight:800; max-width:min(280px, 62vw); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-block;" title="${escapeHtml(evName || 'LIVE TOURNAMENT')}">
          ${escapeHtml(evName || 'LIVE TOURNAMENT')}
        </span>
        ${targetBadgeHtml}
        <span class="global-event-announcement-msg" style="font-size:0.82rem; font-weight:700; color:#fff; line-height:1.35; min-width:180px; flex:1;">
          ${escapeHtml(active.message)}
        </span>
      </div>
      <div class="global-event-announcement-actions" style="display:flex; align-items:center; gap:0.4rem; flex-shrink:0;">
        <button type="button" class="btn btn-outline" onclick="openGlobalAnnouncementEvent('${escapeHtml(evId)}')" style="font-size:0.71rem; font-weight:700; padding:0.24rem 0.6rem; background:rgba(255,255,255,0.14); color:#fff; border-color:rgba(255,255,255,0.32); white-space:nowrap;">
          📰 View Bulletin
        </button>
        <button type="button" onclick="dismissGlobalEventAnnouncement('${escapeHtml(bid)}')" title="Dismiss Announcement" style="background:transparent; border:none; color:rgba(255,255,255,0.85); font-size:0.95rem; cursor:pointer; padding:0.2rem 0.35rem; line-height:1;">
          ✕
        </button>
      </div>
    </div>
  `;
}

async function syncGlobalEventAnnouncementBanner(force = false) {
  const banner = document.getElementById('global-event-announcement-banner');
  if (!banner || !window.api || typeof window.api.getActiveEventAnnouncements !== 'function') return;

  const candidateIds = new Set();
  if (currentOpenEventId) candidateIds.add(String(currentOpenEventId));
  if (window._recentInteractedEventIds instanceof Set) {
    window._recentInteractedEventIds.forEach(id => {
      if (id) candidateIds.add(String(id));
    });
  }
  try {
    const recentRaw = localStorage.getItem('omni_recent_event_ids');
    const recentArr = recentRaw ? JSON.parse(recentRaw) : [];
    if (Array.isArray(recentArr)) {
      recentArr.forEach(id => {
        if (id) candidateIds.add(String(id));
      });
    }
  } catch (_) {}
  for (const cachedEid of _eventToHubStateCache.keys()) {
    if (cachedEid) candidateIds.add(String(cachedEid));
  }

  const regList = [
    ...(Array.isArray(window.myHubRegisteredTournaments) ? window.myHubRegisteredTournaments : []),
    ...(Array.isArray(window._hubRegisteredEventsCache) ? window._hubRegisteredEventsCache : [])
  ];
  regList.forEach(t => {
    const id = String(t?.event_id || t?.bcp_event_id || t?.id || '').trim();
    if (id) candidateIds.add(id);
  });
  const hostedList = [
    ...(Array.isArray(window.myHubHostedTournaments) ? window.myHubHostedTournaments : []),
    ...(Array.isArray(window._hubHostedEventsCache) ? window._hubHostedEventsCache : [])
  ];
  hostedList.forEach(t => {
    const id = String(t?.event_id || t?.bcp_event_id || t?.id || '').trim();
    if (id) candidateIds.add(id);
  });

  // Always include wildcard '*' so mobile screens (My Hub, Team, Community, Leaderboards, etc.) receive all active tournament broadcasts
  const eventIds = Array.from(candidateIds).filter(id => id && id !== '*' && id !== '_active_broadcasts').slice(0, 20);
  const queryIds = [...eventIds, '*'];

  try {
    const res = await window.api.getActiveEventAnnouncements(queryIds, force);
    const announcements = Array.isArray(res?.announcements) ? [...res.announcements] : [];

    // Merge both general active_broadcast AND targeted_broadcasts from client-side _eventToHubStateCache
    for (const [cEid, cState] of _eventToHubStateCache.entries()) {
      const b = cState && (cState.active_broadcast || cState.broadcast);
      if (b && b.message && b.active !== false && !isTargetedBroadcastObj(b)) {
        const exists = announcements.some(a =>
          !isTargetedBroadcastObj(a) &&
          (String(a.id || '') === String(b.id || '') || String(a.event_id || a.eventId || '') === String(cEid))
        );
        if (!exists) {
          announcements.push({ ...b, event_id: b.event_id || b.eventId || cEid });
        }
      }
      const tArr = Array.isArray(cState?.targeted_broadcasts) ? cState.targeted_broadcasts : [];
      for (const tb of tArr) {
        if (tb && tb.message && tb.active !== false) {
          const tKey = computeClientBroadcastTargetKey(tb);
          const exists = announcements.some(a =>
            isTargetedBroadcastObj(a) &&
            (String(a.id || '') === String(tb.id || '') ||
              (String(a.event_id || a.eventId || '') === String(cEid) && computeClientBroadcastTargetKey(a) === tKey))
          );
          if (!exists) {
            announcements.unshift({ ...tb, event_id: tb.event_id || tb.eventId || cEid, is_targeted: true });
          }
        }
      }
    }

    const validAnnouncements = announcements.filter(a => {
      if (!a || !a.message || a.active === false) return false;
      const bid = String(a.id || `${a.event_id}_${a.published_at || ''}`);
      try {
        if (localStorage.getItem(`dismissed_event_broadcast_${bid}`) === '1') {
          return false;
        }
      } catch (_) {}
      return true;
    });

    // Separate General (App-Wide) announcements from Targeted (Table/Player) announcements
    // so publishing a General announcement NEVER hides or overwrites an active Targeted alert!
    const activeGeneral = validAnnouncements.find(a => !isTargetedBroadcastObj(a)) || null;
    const activeTargeted = validAnnouncements.filter(a =>
      isTargetedBroadcastObj(a) && isTargetedAnnouncementRelevantToViewer(a, hostedList, regList)
    ).slice(0, 2);

    const rowsToRender = [];
    if (activeGeneral) rowsToRender.push(activeGeneral);
    for (const tb of activeTargeted) {
      if (!rowsToRender.some(r => String(r.id || '') === String(tb.id || ''))) {
        rowsToRender.push(tb);
      }
    }

    if (rowsToRender.length === 0) {
      banner.style.display = 'none';
      banner.innerHTML = '';
      return;
    }

    banner.style.display = 'block';
    banner.innerHTML = rowsToRender.map(item => buildGlobalAnnouncementBannerRowHtml(item, hostedList, regList)).join('');
  } catch (err) {
    // Non-blocking
  }
}

let _globalAnnouncementSyncStarted = false;
let _globalAnnouncementFirestoreUnsub = null;

function startGlobalAppAnnouncementSync() {
  if (_globalAnnouncementSyncStarted) return;
  _globalAnnouncementSyncStarted = true;

  syncGlobalEventAnnouncementBanner().catch(() => {});

  // Real-time Firestore listener on tournaments/_active_broadcasts for instant multi-screen / mobile push
  try {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0 && typeof firebase.firestore === 'function') {
      const db = firebase.firestore();
      _globalAnnouncementFirestoreUnsub = db.collection('tournaments').doc('_active_broadcasts').onSnapshot(() => {
        syncGlobalEventAnnouncementBanner().catch(() => {});
      }, () => {});
    }
  } catch (_) {}

  // Lightweight background sync for all screens (My Hub, Team, Community, Leaderboards, etc.)
  setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    syncGlobalEventAnnouncementBanner().catch(() => {});
  }, 10000);

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        syncGlobalEventAnnouncementBanner().catch(() => {});
      }
    });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(startGlobalAppAnnouncementSync, 200));
  } else {
    setTimeout(startGlobalAppAnnouncementSync, 200);
  }
}

window.canUserAccessEventToHub = canUserAccessEventToHub;
window.getUserEventOrganizerRole = getUserEventOrganizerRole;
window.extractEventStaffDirectory = extractEventStaffDirectory;
window.loadEventToHubState = loadEventToHubState;
window.renderEventNewsHub = renderEventNewsHub;
window.renderEventClockAndScheduleWidgets = renderEventClockAndScheduleWidgets;
window.buildEventRoundClockAndScheduleCardHtml = buildEventRoundClockAndScheduleCardHtml;
window.renderEventToHub = renderEventToHub;
window.switchEventToHubSubtab = switchEventToHubSubtab;
window.setToHubRadarRound = setToHubRadarRound;
window.setToHubRadarFilter = setToHubRadarFilter;
window.handleToHubRadarSearch = handleToHubRadarSearch;
window.copyUnfinishedTablesList = copyUnfinishedTablesList;
window.broadcastUnfinishedTablesPing = broadcastUnfinishedTablesPing;
window.updateToHubMasterClockAction = updateToHubMasterClockAction;
window.broadcastToHubClockStatus = broadcastToHubClockStatus;
window.submitToHubJudgeCall = submitToHubJudgeCall;
window.resolveToHubJudgeCall = resolveToHubJudgeCall;
window.applyToHubAnnouncementPreset = applyToHubAnnouncementPreset;
window.publishToHubBannerAnnouncement = publishToHubBannerAnnouncement;
window.clearToHubBannerAnnouncement = clearToHubBannerAnnouncement;
window.submitToHubNewsPost = submitToHubNewsPost;
window.removeToHubNewsPost = removeToHubNewsPost;
window.setToHubRosterFilter = setToHubRosterFilter;
window.handleToHubRosterSearch = handleToHubRosterSearch;
window.copyToHubFilteredRosterNames = copyToHubFilteredRosterNames;
window.openToHubTableCommsModal = openToHubTableCommsModal;
window.openToHubPlayerCommsModal = openToHubPlayerCommsModal;
window.selectToHubCommsTarget = selectToHubCommsTarget;
window.applyToHubCommsPreset = applyToHubCommsPreset;
window.sendToHubCommsBanner = sendToHubCommsBanner;
window.sendToHubCommsDirectChat = sendToHubCommsDirectChat;
window.closeToHubCommsModal = closeToHubCommsModal;
window.syncGlobalEventAnnouncementBanner = syncGlobalEventAnnouncementBanner;
window.startGlobalAppAnnouncementSync = startGlobalAppAnnouncementSync;
window.dismissGlobalEventAnnouncement = dismissGlobalEventAnnouncement;
window.openGlobalAnnouncementEvent = openGlobalAnnouncementEvent;


