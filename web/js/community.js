/* ==========================================================================
   COMMUNITY.JS - Regional Community Hub, Local Leaderboard, Chat & Discovery (v1.0)
   Built by the community, for the community.
   ========================================================================== */

var communityState = (typeof window !== 'undefined' && window.communityState) || {
  lat: null,
  lng: null,
  radiusMiles: 50,
  locationName: 'San Diego, CA',
  activeSubtab: 'radar', // 'radar', 'tournaments', 'stores', 'scene', 'chat'
  sceneView: 'leaderboard', // 'leaderboard', 'competitors'
  chatMode: 'regional', // 'regional', 'direct'
  eventsFilter: 'all', // 'all', 'upcoming', 'recent'
  tournamentsVenueFilter: null,
  stores: [],
  storesFilter: 'all', // 'all', 'tournaments', 'official', 'top_rated', 'open_now'
  storesSearch: '',
  storesViewMode: (typeof window !== 'undefined' && window.innerWidth <= 768) ? 'cards' : 'both', // 'both', 'cards', 'map'
  storesMap: null,
  storesMarkers: [],
  storesInfoWindow: null,
  storesLoading: false,
  currentStoreTournaments: [],
  overview: null,
  overviewKey: null,
  overviewLoadedAt: null,
  isLoading: false,
  chatMessages: [],
  chatPollingInterval: null,
  isSendingChat: false,
  tournamentsViewMode: 'feed', // 'feed' (Recommendations default on Desktop & Mobile), 'calendar'
  tournamentsQuickFilter: 'all',
  recTab: 'for_you', // 'for_you', 'driveable', 'majors', 'past'
  maxDriveHours: 2, // 1, 2, or 3 hours drive
  majorsScope: 'regional', // 'regional' or 'global'
  localDriveSubFilter: 'all', // 'all', 'gt_major', 'rtt', 'weekend', 'next_weekend'
  localDriveSort: 'score', // 'score' or 'date'
  majorsTierFilter: 'all', // 'all', 'super_major', 'major', 'gt'
  recommendations: null,
  recommendationsKey: null,
  recommendationsLoadedAt: null,
  recommendationsLoading: false,
  recommendationsError: null,
  searchResults: null,
  searchLoading: false,
  searchQueryExecuted: '',
  majorsList: [],
  majorsLoading: false,
  majorsLoadedAt: null,
  majorsGameSystem: null,
  calendarDate: new Date(),
  calendarSelectedDate: null
};
if (typeof window !== 'undefined') window.communityState = communityState;

/**
 * Main entrypoint when switching to Community Hub tab
 */
async function initCommunityHub(targetSubtab = null) {
  updateCommunityBcpBanner();

  // 1. Check saved local preferences
  const savedLat = localStorage.getItem('comm_lat');
  const savedLng = localStorage.getItem('comm_lng');
  const savedRad = localStorage.getItem('comm_radius_v2') || localStorage.getItem('comm_radius');
  const savedLoc = localStorage.getItem('comm_loc_name');
  const savedDrive = localStorage.getItem('comm_max_drive_hrs');
  const savedMajScope = localStorage.getItem('comm_majors_scope');
  const hasManualOverride = !!localStorage.getItem('comm_manual_override');
  if (savedDrive && [1, 2, 3].includes(Number(savedDrive))) {
    communityState.maxDriveHours = Number(savedDrive);
  }
  if (savedMajScope === 'global' || savedMajScope === 'regional') {
    communityState.majorsScope = savedMajScope;
  }

  if (savedLat && savedLng) {
    communityState.lat = parseFloat(savedLat);
    communityState.lng = parseFloat(savedLng);
  }
  if (savedRad && savedRad !== '100') {
    communityState.radiusMiles = parseInt(savedRad, 10) || 50;
  } else if (localStorage.getItem('comm_radius_v2')) {
    communityState.radiusMiles = parseInt(localStorage.getItem('comm_radius_v2'), 10) || 50;
  } else {
    communityState.radiusMiles = 50;
  }
  if (savedLoc) {
    communityState.locationName = savedLoc;
  }

  // 2. Concurrently resolve LFG profile & upfront GPS (if permission granted and no manual override)
  const profilePromise = (typeof window.api?.getConnectProfile === 'function')
    ? window.api.getConnectProfile().catch((e) => {
        console.warn("Notice loading LFG profile for Community Hub:", e);
        return null;
      })
    : Promise.resolve(null);

  const quickGpsPromise = (!hasManualOverride && typeof navigator !== 'undefined' && navigator.permissions?.query && navigator.geolocation)
    ? (async () => {
        try {
          const perm = await Promise.race([
            navigator.permissions.query({ name: 'geolocation' }),
            new Promise((resolve) => setTimeout(() => resolve(null), 350))
          ]);
          if (perm && perm.state === 'granted') {
            return await new Promise((resolve) => {
              navigator.geolocation.getCurrentPosition(
                resolve,
                () => resolve(null),
                { enableHighAccuracy: true, timeout: 1500, maximumAge: 300000 }
              );
            });
          }
        } catch (e) {
          return null;
        }
        return null;
      })()
    : Promise.resolve(null);

  const [res, gpsPos] = await Promise.all([profilePromise, quickGpsPromise]);

  if (res && res.success && res.profile) {
    if (typeof connectState !== 'undefined') {
      connectState.userProfile = res.profile;
    }
    if (typeof renderTopBarOptions === 'function') {
      renderTopBarOptions(res.profile);
    }
    // If no saved coords and no GPS, adopt from profile
    if (communityState.lat == null && !gpsPos && res.profile.latitude && res.profile.longitude) {
      communityState.lat = parseFloat(parseFloat(res.profile.latitude).toFixed(4));
      communityState.lng = parseFloat(parseFloat(res.profile.longitude).toFixed(4));
      communityState.locationName = res.profile.home_venue_name || res.profile.city || 'My Location';
    }
  }

  // If GPS returned real coordinates upfront, use them before the first fetch
  if (gpsPos && gpsPos.coords) {
    const rawLat = gpsPos.coords.latitude;
    const rawLng = gpsPos.coords.longitude;
    const gLat = parseFloat(rawLat.toFixed(4));
    const gLng = parseFloat(rawLng.toFixed(4));
    communityState.lat = gLat;
    communityState.lng = gLng;
    localStorage.setItem('comm_lat', String(gLat));
    localStorage.setItem('comm_lng', String(gLng));
    localStorage.setItem('comm_exact_gps', 'true');

    if (!communityState.locationName || (savedLat && Math.abs(gLat - parseFloat(savedLat)) > 0.05)) {
      if (typeof findClosestKnownCity === 'function') {
        const closest = findClosestKnownCity(gLat, gLng, 15.0);
        if (closest && closest.name) {
          communityState.locationName = closest.name;
          localStorage.setItem('comm_loc_name', closest.name);
        } else {
          communityState.locationName = `GPS (${gLat.toFixed(2)}, ${gLng.toFixed(2)})`;
        }
      } else {
        communityState.locationName = `GPS (${gLat.toFixed(2)}, ${gLng.toFixed(2)})`;
      }
    }
  }

  // 3. Fallback default coordinates if neither localStorage, GPS, nor profile set
  if (communityState.lat == null || communityState.lng == null) {
    communityState.lat = 32.7157;
    communityState.lng = -117.1611;
    communityState.locationName = 'San Diego, CA';
  }

  // Sync radius dropdown
  const radSelect = document.getElementById('comm-radius-select');
  if (radSelect) {
    radSelect.value = String(communityState.radiusMiles);
  }

  if (typeof initConnectGooglePlaces === 'function') {
    initConnectGooglePlaces();
  }

  if (typeof updateUnreadCountBadge === 'function') {
    updateUnreadCountBadge();
  }

  const subtab = targetSubtab || communityState.activeSubtab || 'radar';
  // Ensure mobile/desktop initial view mode buttons & containers match state
  const initTMode = communityState.tournamentsViewMode || ((typeof window !== 'undefined' && window.innerWidth <= 768) ? 'feed' : 'calendar');
  const btnFeedInit = document.getElementById('btn-tournaments-view-feed');
  const btnCalInit = document.getElementById('btn-tournaments-view-calendar');
  const feedViewInit = document.getElementById('comm-tournaments-feed-view');
  const calViewInit = document.getElementById('comm-tournaments-calendar-view');
  if (btnFeedInit) btnFeedInit.classList.toggle('active', initTMode === 'feed');
  if (btnCalInit) btnCalInit.classList.toggle('active', initTMode === 'calendar');
  if (feedViewInit) feedViewInit.style.display = (initTMode === 'feed') ? 'block' : 'none';
  if (calViewInit) calViewInit.style.display = (initTMode === 'calendar') ? 'block' : 'none';
  if (typeof setStoresViewMode === 'function') {
    setStoresViewMode(communityState.storesViewMode || ((typeof window !== 'undefined' && window.innerWidth <= 768) ? 'cards' : 'both'));
  }
  // Skip subtab render here: loadCommunityHub() below orchestrates the active subtab load once coordinates are locked
  switchCommunitySubtab(subtab, true);

  // Optimistically render header immediately before awaiting data fetch
  renderCommunityHeader({
    radius_miles: communityState.radiusMiles,
    location_name: communityState.locationName
  });

  await loadCommunityHub(communityState.lat, communityState.lng, communityState.radiusMiles, communityState.locationName);
}

/**
 * Updates the BCP account integration status banner
 */
function updateCommunityBcpBanner() {
  const banner = document.getElementById('comm-bcp-banner');
  if (!banner) return;

  const user = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const isBcpConnected = !!(user && (user.bcp_connected || user.bcp_user_id || user.bcp_email));
  const bcpName = user ? (user.bcp_name || user.bcp_email || user.display_name || 'BCP Account') : '';

  if (isBcpConnected) {
    banner.className = 'comm-bcp-banner connected';
    banner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
        <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981;"></span>
        <div>
          <span style="font-weight: 700; color: #fff;">Connected to Best Coast Pairings</span>
          <span style="color: #94a3b8; font-size: 0.8rem; margin-left: 6px;">(${escapeHtml(bcpName)})</span>
          <div style="font-size: 0.76rem; color: #10b981; margin-top: 1px;">✓ Automatic local tournament discovery & shared roster matching active</div>
        </div>
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: center;">
        <button class="btn btn-outline" style="font-size: 0.76rem; padding: 0.35rem 0.75rem;" onclick="openBcpLinkModal()">⚙️ BCP Settings</button>
      </div>
    `;
  } else {
    banner.className = 'comm-bcp-banner unlinked';
    banner.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
        <span style="font-size: 1.35rem; line-height: 1;">🔗</span>
        <div>
          <div style="font-weight: 800; color: #fff; font-size: 0.9rem;">
            Connect Your Best Coast Pairings (BCP) Account
          </div>
          <div style="font-size: 0.8rem; color: #cbd5e1; line-height: 1.45; margin-top: 2px;">
            Linking your BCP account enables <strong>automatic local tournament matching</strong>, surfaces fellow competitors you've shared tournaments with, and enters your verified records into local leaderboards.
          </div>
        </div>
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: center; flex-shrink: 0;">
        <button class="btn btn-primary" style="font-size: 0.82rem; font-weight: 800; padding: 0.45rem 1.15rem; background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); border: 1px solid #38bdf8;" onclick="openBcpLinkModal()">
          🔗 Link BCP Account
        </button>
      </div>
    `;
  }
}

/**
 * Generates unified, location-aware loading markup for Community Hub subviews.
 * Ensures initial tab rendering and async API fetches display the exact same text
 * to eliminate flicker or secondary text-swaps.
 */
function getCommunitySubtabLoaderHtml(type) {
  const locSuffix = communityState.locationName ? ` of ${escapeHtml(communityState.locationName)}` : '';
  if (type === 'tournaments') {
    return `
      <div style="padding: 3rem 1rem; text-align: center; color: var(--text-muted);">
        <div class="spinner" style="margin: 0 auto 0.75rem;"></div>
        <div style="font-size: 0.95rem; font-weight: 600; color: #cbd5e1;">Finding Tournaments within ${communityState.radiusMiles} Miles${locSuffix}...</div>
      </div>
    `;
  }
  if (type === 'scene') {
    return `
      <div style="padding: 3rem 1rem; text-align: center; color: var(--text-muted);">
        <div class="spinner" style="margin: 0 auto 0.75rem;"></div>
        <div style="font-size: 0.95rem; font-weight: 600; color: #cbd5e1;">Finding Competitors within ${communityState.radiusMiles} Miles${locSuffix}...</div>
      </div>
    `;
  }
  if (type === 'radar') {
    return `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: #94a3b8;">
        <div style="font-size: 2rem; margin-bottom: 0.5rem; animation: spin 1s linear infinite; display: inline-block;">🧭</div>
        <div>Scanning local tabletop radar for active sparring partners within ${communityState.radiusMiles} miles...</div>
      </div>
    `;
  }
  if (type === 'stores') {
    return `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
        <div class="spinner" style="margin: 0 auto 0.75rem;"></div>
        <div style="font-size: 0.95rem; font-weight: 600; color: #cbd5e1;">Finding Local Warhammer 40k Game Stores within ${communityState.radiusMiles} Miles...</div>
      </div>
    `;
  }
  return '';
}

/**
 * Idempotently sets loader HTML on a container without re-injecting or resetting DOM
 * if an identical loading state or active spinner is already present.
 */
function setSubtabLoaderIfEmpty(container, html) {
  if (!container || !html) return;
  // If the container already has the exact loader markup, do not touch innerHTML to prevent visual restart/flicker
  if (container.innerHTML && container.innerHTML.trim() === html.trim()) {
    return;
  }
  // Check if container already contains an active spinner
  const hasSpinner = container.querySelector('.spinner') ||
    container.querySelector('[style*="animation: spin"]') ||
    container.querySelector('[style*="animation:spin"]');
  if (hasSpinner) {
    // If spinner is already running, update location text in-place rather than tearing down DOM
    const textEl = container.querySelector('div[style*="font-weight: 600"], div[style*="font-weight:600"]');
    if (textEl) {
      const locSuffix = communityState.locationName ? ` of ${escapeHtml(communityState.locationName)}` : '';
      if (communityState.activeSubtab === 'tournaments') {
        textEl.textContent = `Finding Tournaments within ${communityState.radiusMiles} Miles${locSuffix}...`;
      } else if (communityState.activeSubtab === 'scene') {
        textEl.textContent = `Finding Competitors within ${communityState.radiusMiles} Miles${locSuffix}...`;
      }
      return;
    }
  }
  container.innerHTML = html;
}

let _activeCommunityHubPromise = null;
let _activeCommunityHubKey = null;
let _communityRequestSeq = 0;
let _activeCommunityHubAbortController = null;

/**
 * Load complete Community Hub data for coordinates and radius
 */
async function loadCommunityHub(lat = null, lng = null, radius = null, locationName = null, force = false) {
  if (lat != null && lng != null) {
    communityState.lat = parseFloat(lat);
    communityState.lng = parseFloat(lng);
  }
  if (radius != null) {
    communityState.radiusMiles = parseInt(radius, 10) || 50;
  }
  if (locationName != null) {
    communityState.locationName = locationName;
  }

  // Deduplicate concurrent in-flight requests for same location & radius
  const gs = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
  const requestKey = `${gs}_${communityState.lat != null ? communityState.lat.toFixed(2) : ''}_${communityState.lng != null ? communityState.lng.toFixed(2) : ''}_${communityState.radiusMiles}`;
  if (_activeCommunityHubPromise && _activeCommunityHubKey === requestKey) {
    return _activeCommunityHubPromise;
  }

  const hasExistingData = (communityState.overview != null && communityState.overviewKey === requestKey);

  // If data for this exact location & radius is already in memory and fresh (< 60s), avoid redundant network round-trip
  if (!force && hasExistingData && communityState.overviewLoadedAt && (Date.now() - communityState.overviewLoadedAt < 60000)) {
    renderCurrentSubtab();
    return communityState.overview;
  }

  // If a previous request for a different location/radius is still in-flight, cancel it immediately!
  if (_activeCommunityHubAbortController) {
    try {
      _activeCommunityHubAbortController.abort();
    } catch (e) {}
  }
  _activeCommunityHubAbortController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const fetchSignal = _activeCommunityHubAbortController ? _activeCommunityHubAbortController.signal : null;
  const mySeq = ++_communityRequestSeq;

  // Sync radius select dropdown
  const radSelect = document.getElementById('comm-radius-select');
  if (radSelect && radSelect.value !== String(communityState.radiusMiles)) {
    radSelect.value = String(communityState.radiusMiles);
  }

  // Optimistically update header immediately (0ms delay)
  renderCommunityHeader({
    radius_miles: communityState.radiusMiles,
    location_name: communityState.locationName
  });

  // Show loading indicators ONLY if we don't already have rendered data for this key
  if (!hasExistingData) {
    const tourneyView = document.getElementById('comm-tournaments-content');
    if (tourneyView && communityState.activeSubtab === 'tournaments') {
      setSubtabLoaderIfEmpty(tourneyView, getCommunitySubtabLoaderHtml('tournaments'));
    }
    const sceneView = document.getElementById('comm-scene-content');
    if (sceneView && communityState.activeSubtab === 'scene') {
      setSubtabLoaderIfEmpty(sceneView, getCommunitySubtabLoaderHtml('scene'));
    }
    const playersGrid = document.getElementById('players-grid');
    if (playersGrid && communityState.activeSubtab === 'radar') {
      setSubtabLoaderIfEmpty(playersGrid, getCommunitySubtabLoaderHtml('radar'));
    }
    const storesGrid = document.getElementById('comm-stores-grid');
    if (storesGrid && communityState.activeSubtab === 'stores') {
      setSubtabLoaderIfEmpty(storesGrid, getCommunitySubtabLoaderHtml('stores'));
    }
  }

  communityState.isLoading = true;
  communityState.overviewError = null;
  _activeCommunityHubKey = requestKey;

  _activeCommunityHubPromise = (async () => {
    try {
      const data = await API.getCommunityOverview(
        communityState.lat,
        communityState.lng,
        communityState.radiusMiles,
        communityState.locationName,
        null,
        false,
        fetchSignal ? { signal: fetchSignal } : {}
      );

      // Check if this request was aborted or superseded by a newer location request while in flight
      if (data && data.aborted) {
        return;
      }
      if (mySeq !== _communityRequestSeq) {
        return;
      }
      if (!data || !data.success) {
        throw new Error(data?.error || 'Failed to load community data');
      }

      communityState.overview = data;
      communityState.overviewKey = requestKey;
      communityState.overviewLoadedAt = Date.now();
      communityState.overviewError = null;

      // Update location details
      if (data.location?.location_name) {
        communityState.locationName = data.location.location_name;
      }
      if (data.location?.lat != null && data.location?.lng != null) {
        communityState.lat = parseFloat(parseFloat(data.location.lat).toFixed(4));
        communityState.lng = parseFloat(parseFloat(data.location.lng).toFixed(4));
        localStorage.setItem('comm_lat', String(communityState.lat));
        localStorage.setItem('comm_lng', String(communityState.lng));
        localStorage.setItem('comm_loc_name', communityState.locationName);
        if (typeof connectState !== 'undefined' && connectState.userProfile) {
          connectState.userProfile.latitude = communityState.lat;
          connectState.userProfile.longitude = communityState.lng;
          connectState.userProfile.home_venue_name = communityState.locationName;
          connectState.userProfile.radius_miles = communityState.radiusMiles;
        }
      }

      // Render region/location header info
      renderCommunityHeader(data.location || data.region);

      // Render current active subtab (already invokes loadNearbyPlayers if activeSubtab === 'radar')
      renderCurrentSubtab();

      // Pre-warm smart tournament recommendations in background so Events badge & tab switch are instant
      loadCommunityEventRecommendations(force);
    } catch (err) {
      if (mySeq !== _communityRequestSeq) return;
      if (err && (err.name === 'AbortError' || err.message === 'The user aborted a request.')) return;

      console.error('Failed to load community hub:', err);
      const errMsg = err.message || 'An unexpected error occurred while fetching community data.';
      communityState.overviewError = errMsg;

      const tourneyView = document.getElementById('comm-tournaments-content');
      if (tourneyView) {
        tourneyView.innerHTML = `
          <div style="padding: 2.5rem 1rem; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border);">
            <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
            <h4 style="color: #fff; margin-bottom: 0.4rem;">Unable to Load Local Tournaments</h4>
            <p style="font-size: 0.85rem; color: var(--text-secondary); max-width: 480px; margin: 0 auto 1.25rem;">
              ${escapeHtml(errMsg)}
            </p>
            <button class="btn btn-primary" onclick="loadCommunityHub(null, null, null, null, true)">🔄 Retry</button>
          </div>
        `;
      }
      const sceneView = document.getElementById('comm-scene-content');
      if (sceneView) {
        sceneView.innerHTML = `
          <div style="padding: 2.5rem 1rem; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border);">
            <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
            <h4 style="color: #fff; margin-bottom: 0.4rem;">Unable to Load Local Competitors</h4>
            <p style="font-size: 0.85rem; color: var(--text-secondary); max-width: 480px; margin: 0 auto 1.25rem;">
              ${escapeHtml(errMsg)}
            </p>
            <button class="btn btn-primary" onclick="loadCommunityHub(null, null, null, null, true)">🔄 Retry</button>
          </div>
        `;
      }
      const playersGrid = document.getElementById('players-grid');
      if (playersGrid) {
        playersGrid.innerHTML = `
          <div style="grid-column: 1 / -1; padding: 2.5rem 1rem; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border);">
            <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
            <h4 style="color: #fff; margin-bottom: 0.4rem;">Unable to Load Sparring Radar</h4>
            <p style="font-size: 0.85rem; color: var(--text-secondary); max-width: 480px; margin: 0 auto 1.25rem;">
              ${escapeHtml(errMsg)}
            </p>
            <button class="btn btn-primary" onclick="loadCommunityHub(null, null, null, null, true)">🔄 Retry</button>
          </div>
        `;
      }
      const storesGrid = document.getElementById('comm-stores-grid');
      if (storesGrid && communityState.activeSubtab === 'stores') {
        storesGrid.innerHTML = `
          <div style="grid-column: 1 / -1; padding: 2.5rem 1rem; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border);">
            <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
            <h4 style="color: #fff; margin-bottom: 0.4rem;">Unable to Load Local Stores</h4>
            <p style="font-size: 0.85rem; color: var(--text-secondary); max-width: 480px; margin: 0 auto 1.25rem;">
              ${escapeHtml(errMsg)}
            </p>
            <button class="btn btn-primary" onclick="loadCommunityHub(null, null, null, null, true)">🔄 Retry</button>
          </div>
        `;
      }
    } finally {
      if (mySeq === _communityRequestSeq) {
        communityState.isLoading = false;
        _activeCommunityHubPromise = null;
        _activeCommunityHubKey = null;
        _activeCommunityHubAbortController = null;
      }
    }
  })();

  return _activeCommunityHubPromise;
}

/**
 * Render location metadata badge and title
 */
function renderCommunityHeader(locInfo) {
  const badgeEl = document.getElementById('comm-header-badge');
  const titleEl = document.getElementById('comm-header-title');
  const descEl = document.getElementById('comm-header-desc');

  const rad = locInfo?.radius_miles || communityState.radiusMiles || 50;
  const locName = locInfo?.location_name || locInfo?.name || communityState.locationName || 'Your Location';

  const gs = (typeof getGameSystemShortLabel === 'function')
    ? getGameSystemShortLabel(typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k')
    : ((typeof currentGameSystem !== 'undefined' && currentGameSystem === 'aos') ? 'AoS' : '40K');
  if (badgeEl) badgeEl.textContent = `📍 ${rad}-Mile Tournament Radius`;
  if (titleEl) titleEl.textContent = `Local ${gs} Scene within ${rad} miles of ${locName}`;
  if (descEl) descEl.textContent = `Local tournaments, sparring radar, game stores, and regional player standings.`;
  const userLocEl = document.getElementById('user-location-text');
  if (userLocEl && locName) userLocEl.textContent = locName;
}

/**
 * Change search radius (25, 50, 100, 250, 500 mi)
 */
function changeCommunityRadius(radius) {
  const r = parseInt(radius, 10) || 50;
  communityState.radiusMiles = r;
  localStorage.setItem('comm_radius', String(r));
  localStorage.setItem('comm_radius_v2', String(r));
  const select = document.getElementById('comm-radius-select');
  if (select) select.value = String(r);
  const modalRadius = document.getElementById('modal-lfg-radius');
  if (modalRadius) modalRadius.value = String(r);
  const filterRadius = document.getElementById('filter-radius');
  // Optimistically update header immediately (0ms delay)
  renderCommunityHeader({
    radius_miles: r,
    location_name: communityState.locationName
  });

  loadCommunityHub(communityState.lat, communityState.lng, r, communityState.locationName);

  if (communityState.activeSubtab === 'radar' && typeof loadNearbyPlayers === 'function') {
    loadNearbyPlayers();
  }
  if (communityState.activeSubtab === 'stores' && typeof loadLocalGameStores === 'function') {
    loadLocalGameStores(true);
  }
}

/**
 * Detect user's GPS coordinates via browser Geolocation with high accuracy
 */
function detectCommunityGPS(showAlerts = true) {
  const btn = document.getElementById('comm-btn-gps');
  const icon = document.getElementById('comm-gps-icon');
  const label = document.getElementById('comm-gps-label');

  if (!navigator.geolocation) {
    if (showAlerts) alert('Geolocation is not supported by your browser.');
    return;
  }

  if (btn) btn.disabled = true;
  if (icon) icon.textContent = '⏳';
  if (label) label.textContent = 'Locating...';

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      if (btn) btn.disabled = false;
      if (icon) icon.textContent = '🛰️';
      if (label) label.textContent = 'GPS';

      const rawLat = position.coords.latitude;
      const rawLng = position.coords.longitude;
      const lat = parseFloat(rawLat.toFixed(4));
      const lng = parseFloat(rawLng.toFixed(4));
      // Unified multi-tier reverse geocoding with instant hub resolution, backend parity, and metro distance checks
      const resolved = (typeof resolveLocationFromCoordinates === 'function')
        ? await resolveLocationFromCoordinates(lat, lng)
        : null;

      const locName = resolved?.formatted || `GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

      localStorage.setItem('comm_exact_gps', 'true');
      localStorage.removeItem('comm_manual_override');

      updateCommunityLocation(lat, lng, locName);
    },
    (err) => {
      console.warn('Geolocation error:', err);
      if (btn) btn.disabled = false;
      if (icon) icon.textContent = '🛰️';
      if (label) label.textContent = 'GPS';
      if (showAlerts) {
        alert('Could not determine your exact GPS location. Please check your browser location permissions or click "Set" to choose your city.');
      }
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

/**
 * Updates active community location and saves to localStorage
 */
function updateCommunityLocation(lat, lng, locationName, radius = null) {
  let finalLat = (lat != null && !isNaN(parseFloat(lat))) ? parseFloat(parseFloat(lat).toFixed(4)) : null;
  let finalLng = (lng != null && !isNaN(parseFloat(lng))) ? parseFloat(parseFloat(lng).toFixed(4)) : null;

  // Only resolve from city name if coordinates were NOT provided!
  // When exact GPS coordinates are passed, NEVER overwrite them with coarse city coordinates.
  if ((finalLat == null || finalLng == null) && locationName && (typeof lookupCityCoordinates === 'function')) {
    const resolved = lookupCityCoordinates(locationName);
    if (resolved) {
      finalLat = resolved.lat;
      finalLng = resolved.lng;
    }
  }

  const prevLat = communityState.lat;
  const prevLng = communityState.lng;
  const prevRad = communityState.radiusMiles;
  const newRad = radius ? (parseInt(radius, 10) || prevRad) : prevRad;

  // Check if coordinates and radius are virtually unchanged (e.g. within ~1 mile / 0.015 deg)
  const isCoordSame = (prevLat != null && prevLng != null && finalLat != null && finalLng != null) &&
    Math.abs(finalLat - prevLat) < 0.015 &&
    Math.abs(finalLng - prevLng) < 0.015;
  const isRadiusSame = newRad === prevRad;

  if (finalLat != null && finalLng != null) {
    communityState.lat = finalLat;
    communityState.lng = finalLng;
    localStorage.setItem('comm_lat', String(finalLat));
    localStorage.setItem('comm_lng', String(finalLng));
  }

  if (locationName) {
    communityState.locationName = locationName;
    localStorage.setItem('comm_loc_name', locationName);
  }
  if (radius) {
    communityState.radiusMiles = newRad;
    localStorage.setItem('comm_radius', String(communityState.radiusMiles));
    localStorage.setItem('comm_radius_v2', String(communityState.radiusMiles));
  }

  // Keep connectState userProfile in sync
  if (typeof connectState !== 'undefined' && connectState.userProfile) {
    if (communityState.lat != null) connectState.userProfile.latitude = communityState.lat;
    if (communityState.lng != null) connectState.userProfile.longitude = communityState.lng;
    if (communityState.locationName) connectState.userProfile.home_venue_name = communityState.locationName;
    if (communityState.radiusMiles) connectState.userProfile.radius_miles = communityState.radiusMiles;
  }

  // Optimistically update header immediately (0ms delay)
  renderCommunityHeader({
    radius_miles: communityState.radiusMiles,
    location_name: communityState.locationName
  });

  // If coordinates are unchanged and radius is unchanged, and data is either already
  // loaded or currently in-flight, avoid triggering a redundant duplicate hub reload / spinner flicker.
  if (isCoordSame && isRadiusSame && (communityState.overview != null || communityState.isLoading)) {
    return Promise.resolve(communityState.overview);
  }

  const loadPromise = loadCommunityHub(communityState.lat, communityState.lng, communityState.radiusMiles, communityState.locationName, true);

  if (communityState.activeSubtab === 'stores' && typeof loadLocalGameStores === 'function') {
    loadLocalGameStores(true);
  }

  return loadPromise;
}

/**
 * Opens edit location modal
 */
function openCommunityLocationModal() {
  if (typeof openEditLocationModal === 'function') {
    openEditLocationModal();
  } else {
    const modal = document.getElementById('edit-location-modal');
    if (modal) modal.style.display = 'flex';
  }
}

/**
 * Switch Community Hub Subtab
 */
function switchCommunitySubtab(subtabName, skipRender = false) {
  // If user requests chat or messages, open floating chat widget
  if (subtabName === 'chat' || subtabName === 'messages' || subtabName === 'chats') {
    if (typeof toggleFloatingChat === 'function') {
      toggleFloatingChat(true);
    } else if (typeof switchTab === 'function') {
      switchTab('chat');
    }
    return;
  }

  // Normalize alias names
  if (subtabName === 'players' || subtabName === 'sparring') subtabName = 'radar';
  if (subtabName === 'events') subtabName = 'tournaments';
  if (subtabName === 'stores' || subtabName === 'shops') subtabName = 'stores';
  if (subtabName === 'competitors') {
    subtabName = 'scene';
    communityState.sceneView = 'competitors';
  } else if (subtabName === 'teams') {
    subtabName = 'scene';
    communityState.sceneView = 'teams';
  } else if (subtabName === 'leaderboard') {
    subtabName = 'scene';
    communityState.sceneView = 'leaderboard';
  }

  communityState.activeSubtab = subtabName;

  // Toggle subtab buttons
  document.querySelectorAll('.comm-subtab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.subtab === subtabName);
  });

  // Toggle subviews
  const subviews = ['radar', 'tournaments', 'stores', 'scene'];
  subviews.forEach(s => {
    const el = document.getElementById(`comm-subview-${s}`);
    if (el) el.style.display = (s === subtabName) ? 'block' : 'none';
  });

  // If switching to scene subview, synchronize scene toggle buttons to match current communityState.sceneView
  if (subtabName === 'scene') {
    const mode = communityState.sceneView || 'leaderboard';
    const btnLead = document.getElementById('comm-scene-toggle-leaderboard');
    const btnTeams = document.getElementById('comm-scene-toggle-teams');
    const btnComp = document.getElementById('comm-scene-toggle-competitors');
    if (btnLead) btnLead.classList.toggle('active', mode === 'leaderboard');
    if (btnTeams) btnTeams.classList.toggle('active', mode === 'teams');
    if (btnComp) btnComp.classList.toggle('active', mode === 'competitors');
  }

  if (!skipRender) {
    renderCurrentSubtab();
  }
}

/**
 * Renders the active subtab content
 */
function renderCurrentSubtab() {
  if (communityState.activeSubtab === 'radar') {
    if (typeof loadNearbyPlayers === 'function') loadNearbyPlayers();
  } else if (communityState.activeSubtab === 'tournaments') {
    syncRecommendationControlsUI();
    renderCommunityEvents();
    if (communityState.tournamentsViewMode === 'calendar') {
      renderTournamentsCalendar();
    }
    loadCommunityEventRecommendations(false);
  } else if (communityState.activeSubtab === 'stores') {
    loadLocalGameStores();
  } else if (communityState.activeSubtab === 'scene') {
    renderCurrentSceneView();
  }
}

/**
 * Force refreshes the tournaments subtab with spinning visual feedback
 */
async function refreshCommunityTournaments(btnElement = null) {
  const btn = btnElement || document.getElementById('comm-btn-refresh-tournaments') || document.querySelector('#comm-subview-tournaments .comm-toolbar-btn');
  const icon = btn ? (btn.querySelector('.refresh-icon') || btn.querySelector('span')) : null;

  if (btn) btn.disabled = true;
  if (icon) icon.classList.add('spinning');

  try {
    await Promise.all([
      loadCommunityHub(communityState.lat, communityState.lng, communityState.radiusMiles, communityState.locationName, true),
      loadCommunityEventRecommendations(true)
    ]);
    if (communityState.tournamentsSearchQuery && communityState.tournamentsSearchQuery.length >= 2) {
      await executeServerTournamentSearch(communityState.tournamentsSearchQuery, true);
    }
    renderCommunityEvents();
    if (communityState.tournamentsViewMode === 'calendar') {
      renderTournamentsCalendar();
    }
  } catch (err) {
    console.error('Failed to refresh tournaments:', err);
  } finally {
    if (btn) btn.disabled = false;
    if (icon) icon.classList.remove('spinning');
  }
}

/**
 * --------------------------------------------------------------------------
 * TOURNAMENT & EVENT RECOMMENDATION ENGINE: CONCIERGE FEED, SEARCH & CALENDAR
 * --------------------------------------------------------------------------
 */

let _recsRequestSeq = 0;
let _activeRecsAbortController = null;
let _searchDebounceTimer = null;
let _searchAbortController = null;

function syncRecommendationControlsUI() {
  const recTab = communityState.recTab || 'for_you';
  document.querySelectorAll('#comm-subview-tournaments .comm-rec-tab[data-rec-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.recTab === recTab);
  });

  const driveWrap = document.getElementById('comm-drive-selector-wrap');
  const scopeWrap = document.getElementById('comm-majors-scope-wrap');
  if (driveWrap) {
    driveWrap.style.display = (recTab === 'for_you' || recTab === 'driveable') ? 'inline-flex' : 'none';
    driveWrap.querySelectorAll('.comm-drive-pill[data-hours]').forEach(p => {
      p.classList.toggle('active', Number(p.dataset.hours) === Number(communityState.maxDriveHours || 2));
    });
  }
  if (scopeWrap) {
    scopeWrap.style.display = (recTab === 'majors') ? 'inline-flex' : 'none';
    scopeWrap.querySelectorAll('.comm-drive-pill[data-scope]').forEach(p => {
      p.classList.toggle('active', p.dataset.scope === (communityState.majorsScope || 'regional'));
    });
  }

  const clearBtn = document.getElementById('comm-tournaments-search-clear');
  if (clearBtn) {
    clearBtn.style.display = (communityState.tournamentsSearchQuery || '').trim() ? 'inline-flex' : 'none';
  }

  const recs = communityState.recommendations;
  if (recs) {
    const locCount = Array.isArray(recs.local_events) ? recs.local_events.length : 0;
    const drvCount = Array.isArray(recs.driveable_events) ? recs.driveable_events.length : 0;
    const majCount = Array.isArray(recs.destination_majors) ? recs.destination_majors.length : 0;
    const pstCount = Array.isArray(recs.past_results) ? recs.past_results.length : 0;
    const nearbyTotal = locCount + drvCount;

    const cDrv = document.getElementById('count-rec-driveable');
    if (cDrv) cDrv.textContent = String(nearbyTotal);
    const cMaj = document.getElementById('count-rec-majors');
    if (cMaj) cMaj.textContent = String(majCount);
    const cPst = document.getElementById('count-rec-past');
    if (cPst) cPst.textContent = String(pstCount);

    const badgeCount = document.getElementById('badge-events-count');
    if (badgeCount) {
      const bVal = nearbyTotal > 0 ? nearbyTotal : majCount;
      badgeCount.textContent = String(bVal);
      badgeCount.style.display = bVal > 0 ? 'inline-block' : 'none';
    }
  }
}

async function loadCommunityEventRecommendations(force = false) {
  const currentSys = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
  const latPart = communityState.lat != null ? Number(communityState.lat).toFixed(3) : 'none';
  const lngPart = communityState.lng != null ? Number(communityState.lng).toFixed(3) : 'none';
  const radPart = Number(communityState.radiusMiles || 50);
  const drvPart = Number(communityState.maxDriveHours || 2);
  const scopePart = communityState.majorsScope || 'regional';
  const recKey = `${currentSys}|${latPart}|${lngPart}|${radPart}|${drvPart}|${scopePart}`;

  if (
    !force &&
    communityState.recommendations &&
    communityState.recommendationsKey === recKey &&
    communityState.recommendationsLoadedAt &&
    (Date.now() - communityState.recommendationsLoadedAt < 120000)
  ) {
    syncRecommendationControlsUI();
    if (communityState.activeSubtab === 'tournaments') {
      renderCommunityEvents();
      if (communityState.tournamentsViewMode === 'calendar') {
        renderTournamentsCalendar();
      }
    }
    return communityState.recommendations;
  }

  if (_activeRecsAbortController) {
    try { _activeRecsAbortController.abort(); } catch {}
    _activeRecsAbortController = null;
  }
  const mySeq = ++_recsRequestSeq;
  let fetchSignal = null;
  if (typeof AbortController !== 'undefined') {
    _activeRecsAbortController = new AbortController();
    fetchSignal = _activeRecsAbortController.signal;
  }

  communityState.recommendationsLoading = true;
  communityState.recommendationsError = null;
  if (communityState.activeSubtab === 'tournaments' && !communityState.recommendations) {
    renderCommunityEvents();
  }

  try {
    const res = await window.api.getCommunityEventRecommendations(
      {
        lat: communityState.lat,
        lng: communityState.lng,
        locationName: communityState.locationName,
        localRadiusMiles: radPart,
        maxDriveHours: drvPart,
        majorsScope: scopePart,
        gameSystem: currentSys,
        forceRefresh: force
      },
      fetchSignal ? { signal: fetchSignal } : {}
    );

    if (res && res.aborted) return null;
    if (mySeq !== _recsRequestSeq) return null;
    if (!res || !res.success) {
      throw new Error(res?.error || res?.detail || 'Failed to load tournament recommendations');
    }

    communityState.recommendations = res;
    communityState.recommendationsKey = recKey;
    communityState.recommendationsLoadedAt = Date.now();
    communityState.recommendationsError = null;
    if (Array.isArray(res.destination_majors)) {
      communityState.majorsList = res.destination_majors;
      communityState.majorsLoadedAt = Date.now();
      communityState.majorsGameSystem = currentSys;
    }

    syncRecommendationControlsUI();
    if (communityState.activeSubtab === 'tournaments') {
      renderCommunityEvents();
      if (communityState.tournamentsViewMode === 'calendar') {
        renderTournamentsCalendar();
      }
    }
    return res;
  } catch (err) {
    if (mySeq !== _recsRequestSeq) return null;
    if (err && (err.name === 'AbortError' || err.message === 'The user aborted a request.')) return null;
    console.warn('Notice loading tournament recommendations:', err);
    communityState.recommendationsError = err?.message || 'Unable to load recommendations.';
    if (communityState.activeSubtab === 'tournaments') {
      renderCommunityEvents();
    }
    return null;
  } finally {
    if (mySeq === _recsRequestSeq) {
      communityState.recommendationsLoading = false;
      _activeRecsAbortController = null;
    }
  }
}

function setCommunityRecTab(tab) {
  const validTabs = ['for_you', 'driveable', 'majors', 'past'];
  communityState.recTab = validTabs.includes(tab) ? tab : 'for_you';
  if (communityState.tournamentsSearchQuery) {
    clearCommunityTournamentsSearch(true);
  }
  syncRecommendationControlsUI();
  renderCommunityEvents();
  if (communityState.tournamentsViewMode === 'calendar') {
    if (communityState.recTab === 'past' && communityState.calendarDate) {
      const now = new Date();
      if (
        communityState.calendarDate.getFullYear() > now.getFullYear() ||
        (communityState.calendarDate.getFullYear() === now.getFullYear() && communityState.calendarDate.getMonth() > now.getMonth())
      ) {
        communityState.calendarDate = new Date();
      }
    }
    syncCalendarMonthToFilteredEvents();
    communityState.calendarSelectedDate = null;
    renderTournamentsCalendar();
  }
}

function setCommunityMaxDriveHours(hours) {
  const h = [1, 2, 3].includes(Number(hours)) ? Number(hours) : 2;
  communityState.maxDriveHours = h;
  try { localStorage.setItem('comm_max_drive_hrs', String(h)); } catch {}
  syncRecommendationControlsUI();
  loadCommunityEventRecommendations(false);
}

function setCommunityMajorsScope(scope) {
  const s = scope === 'global' ? 'global' : 'regional';
  communityState.majorsScope = s;
  try { localStorage.setItem('comm_majors_scope', s); } catch {}
  syncRecommendationControlsUI();
  loadCommunityEventRecommendations(false);
}

function setLocalDriveSubFilter(sub) {
  communityState.localDriveSubFilter = sub || 'all';
  renderCommunityEvents();
}

function setLocalDriveSort(sortBy) {
  communityState.localDriveSort = sortBy || 'score';
  renderCommunityEvents();
}

function setMajorsTierFilter(tier) {
  communityState.majorsTierFilter = tier || 'all';
  renderCommunityEvents();
}

function getWeekendRange(offsetWeeks = 0) {
  const now = new Date();
  const day = now.getDay(); // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat
  let diffToFri = (5 - day);
  if (day === 0) { // Sunday is part of current weekend
    diffToFri = -2;
  }
  const fri = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToFri + (offsetWeeks * 7), 0, 0, 0, 0);
  const sun = new Date(fri.getFullYear(), fri.getMonth(), fri.getDate() + 2, 23, 59, 59, 999);
  return { start: fri, end: sun };
}

function isDateInWeekend(dateStr, offsetWeeks = 0) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const { start, end } = getWeekendRange(offsetWeeks);
  return d >= start && d <= end;
}

function setTournamentsQuickFilter(filter) {
  if (filter === 'majors') {
    setCommunityRecTab('majors');
    return;
  }
  if (filter === 'local') {
    setCommunityRecTab('driveable');
    return;
  }
  communityState.tournamentsQuickFilter = (communityState.tournamentsQuickFilter === filter) ? 'all' : filter;
  renderCommunityEvents();
  if (communityState.tournamentsViewMode === 'calendar') {
    syncCalendarMonthToFilteredEvents();
    communityState.calendarSelectedDate = null;
    renderTournamentsCalendar();
    openCalendarFilteredDrawer();
  }
}

function switchTournamentsViewMode(mode) {
  communityState.tournamentsViewMode = mode;
  const btnFeed = document.getElementById('btn-tournaments-view-feed');
  const btnCal = document.getElementById('btn-tournaments-view-calendar');
  const feedView = document.getElementById('comm-tournaments-feed-view');
  const calView = document.getElementById('comm-tournaments-calendar-view');

  if (btnFeed) btnFeed.classList.toggle('active', mode === 'feed');
  if (btnCal) btnCal.classList.toggle('active', mode === 'calendar');

  if (mode === 'calendar') {
    if (feedView) feedView.style.display = 'none';
    if (calView) calView.style.display = 'block';
    renderTournamentsCalendar();
  } else {
    if (calView) calView.style.display = 'none';
    if (feedView) feedView.style.display = 'block';
    renderCommunityEvents();
  }
}

async function loadBcpMajors(force = false) {
  return loadCommunityEventRecommendations(force);
}

function scrollMajorsCarousel(direction) {
  const c = document.getElementById('comm-majors-carousel');
  if (c) {
    c.scrollBy({ left: direction * 340, behavior: 'smooth' });
  }
}

function getCommunityEventLocationInfo(ev) {
  if (typeof window.extractEventLocationDetails === 'function') {
    return window.extractEventLocationDetails(ev);
  }
  const venue = String(ev?.venue || ev?.venue_name || '').trim();
  const street = String(ev?.street_address || ev?.address || ev?.formatted_address || '').trim();
  const city = String(ev?.city || '').trim();
  const state = String(ev?.state || '').trim();
  const country = String(ev?.country || '').trim();
  const cityStateCountry = [city, state, country].filter(Boolean).join(', ');
  const displayLabel = [venue, street, cityStateCountry].filter(Boolean).join(' • ') || 'Unspecified Location';
  return {
    venue,
    streetAddress: street,
    addressLine: street || cityStateCountry,
    city,
    state,
    country,
    cityStateCountry,
    displayLabel,
    fullAddressLine: [venue, street, cityStateCountry].filter(Boolean).join(', '),
    hasLocation: Boolean(venue || street || cityStateCountry)
  };
}

function matchesCommunityEventSearch(ev, rawQuery) {
  if (!rawQuery) return true;
  const q = String(rawQuery).trim().toLowerCase();
  if (!q) return true;
  if (!ev) return false;
  if (!ev._commSearchText) {
    const locInfo = getCommunityEventLocationInfo(ev);
    ev._commSearchText = [
      ev.name,
      ev.event_name,
      ev.venue,
      ev.venue_name,
      ev.address,
      ev.formatted_address,
      ev.street_address,
      ev.postal_code,
      ev.city,
      ev.state,
      ev.country,
      locInfo.venue,
      locInfo.streetAddress,
      locInfo.addressLine,
      locInfo.cityStateCountry,
      locInfo.fullAddressLine
    ].filter(Boolean).join(' ').toLowerCase();
  }
  return ev._commSearchText.includes(q);
}
window.getCommunityEventLocationInfo = getCommunityEventLocationInfo;
window.matchesCommunityEventSearch = matchesCommunityEventSearch;

function renderMajorsCarousel() {
  const carousel = document.getElementById('comm-majors-carousel');
  if (!carousel) return;

  const rawEvents = communityState.majorsList || [];
  const sq = (communityState.tournamentsSearchQuery || '').trim();
  const events = rawEvents.filter(ev => {
    if (!ev || isLeagueOrMultiWeekEvent(ev)) return false;
    if (sq && !matchesCommunityEventSearch(ev, sq)) return false;
    if (communityState.eventsFilter === 'recent') {
      return isTournamentEnded(ev);
    }
    return !isTournamentEnded(ev);
  });

  const majorsSec = document.getElementById('comm-majors-section');
  if (events.length === 0) {
    if (communityState.majorsLoading) {
      if (majorsSec) majorsSec.style.display = '';
      carousel.innerHTML = `
        <div style="padding: 1.5rem; text-align: center; color: var(--text-muted); width: 100%;">
          <span class="spinner-mini" style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(56,189,248,0.25); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px;"></span>
          Scanning global circuit for upcoming destination majors...
        </div>
      `;
      return;
    }
    if (majorsSec && typeof window !== 'undefined' && window.innerWidth <= 768 && !sq) {
      majorsSec.style.display = 'none';
    } else if (majorsSec) {
      majorsSec.style.display = '';
    }
    carousel.innerHTML = `
      <div style="padding: 1.5rem; text-align: center; color: var(--text-muted); width: 100%;">
        ${sq ? `No destination premier majors match "${escapeHtml(sq)}".` : 'No destination premier majors currently scheduled in this window.'}
      </div>
    `;
    return;
  }
  if (majorsSec) majorsSec.style.display = '';

  let html = '';
  events.slice(0, 20).forEach(ev => {
    const eid = escapeHtml(ev.id);
    const name = escapeHtml(ev.name || 'Premier Championship');
    const locInfo = getCommunityEventLocationInfo(ev);
    const locPrimary = locInfo.cityStateCountry || locInfo.venue || 'Premier Destination';
    const locSub = (locInfo.venue && locInfo.venue !== locPrimary)
      ? (locInfo.streetAddress ? `${locInfo.venue} • ${locInfo.streetAddress}` : locInfo.venue)
      : (locInfo.streetAddress || '');
    const locTooltip = locInfo.fullAddressLine || locInfo.displayLabel || locPrimary;
    const sStr = ev.event_date ? ev.event_date.slice(0, 10) : '';
    const eStr = getNormalizedEventEndDateStr(ev, sStr);
    const dateStr = sStr ? (eStr && eStr > sStr ? `${sStr} – ${eStr.slice(5)}` : sStr) : 'TBD';
    const players = Number(ev.total_players || 0);
    const capacity = ev.num_tickets ? Number(ev.num_tickets) : null;
    const tier = ev.tier || 'major';
    const isEnded = isTournamentEnded(ev);
    const isOngoing = !isEnded && isTournamentOngoing(ev);

    // Tier badge
    let tierBadgeHtml = '';
    if (tier === 'super_major') {
      tierBadgeHtml = `<span class="comm-legend-pill pill-super-major" style="font-size: 0.68rem; padding: 2px 7px;">🟣 SUPER MAJOR</span>`;
    } else if (ev.circuits && ev.circuits.length > 0 && (name.toLowerCase().includes('open') || name.toLowerCase().includes('gw'))) {
      tierBadgeHtml = `<span class="comm-legend-pill" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border-color: rgba(245, 158, 11, 0.35); font-size: 0.68rem; padding: 2px 7px;">🛡️ CIRCUIT</span>`;
    } else if (tier === 'gt') {
      tierBadgeHtml = `<span class="comm-legend-pill pill-gt" style="font-size: 0.68rem; padding: 2px 7px;">🟢 GT</span>`;
    } else {
      tierBadgeHtml = `<span class="comm-legend-pill pill-major" style="font-size: 0.68rem; padding: 2px 7px;">🔵 MAJOR</span>`;
    }

    // Countdown / status badge
    let timingBadge = '';
    if (isEnded) {
      timingBadge = `<span class="badge" style="background: rgba(168,85,247,0.18); color: #c084fc; border: 1px solid rgba(168,85,247,0.35); font-size: 0.68rem; font-weight: 800;">✓ Completed</span>`;
    } else if (isOngoing) {
      timingBadge = `<span class="badge" style="background: rgba(245,158,11,0.2); color: #f59e0b; border: 1px solid rgba(245,158,11,0.4); font-size: 0.68rem; font-weight: 800;">🔥 LIVE NOW</span>`;
    } else if (ev.event_date) {
      const daysUntil = Math.ceil((new Date(ev.event_date) - new Date()) / (1000 * 60 * 60 * 24));
      if (daysUntil === 0) {
        timingBadge = `<span class="badge" style="background: rgba(16,185,129,0.2); color: #34d399; font-size: 0.68rem; font-weight: 800;">⚡ Today</span>`;
      } else if (daysUntil > 0 && daysUntil <= 3) {
        timingBadge = `<span class="badge" style="background: rgba(56,189,248,0.2); color: #38bdf8; font-size: 0.68rem; font-weight: 800;">🔥 In ${daysUntil}d</span>`;
      } else if (daysUntil > 3) {
        timingBadge = `<span class="badge" style="background: rgba(255,255,255,0.06); color: #cbd5e1; font-size: 0.68rem;">⏳ in ${daysUntil}d</span>`;
      }
    }

    const platBadgeHtml = (typeof getPlatformBadgeHtml === 'function') ? getPlatformBadgeHtml(eid, ev) : '';
    const fmtBadgeHtml = (typeof getEventFormatBadgeHtml === 'function') ? getEventFormatBadgeHtml(ev) : '';
    const extEventUrl = (typeof getPlatformExternalEventUrl === 'function') ? getPlatformExternalEventUrl(eid, ev) : `https://www.bestcoastpairings.com/event/${eid}`;
    const extPlatName = (typeof getPlatformDisplayName === 'function') ? getPlatformDisplayName(eid, ev) : 'BCP';

    html += `
      <div class="comm-majors-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; gap: 0.4rem; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap;">
            ${tierBadgeHtml}
            ${platBadgeHtml}
            ${fmtBadgeHtml}
          </div>
          ${timingBadge}
        </div>
        <h4 style="margin: 0 0 0.35rem; color: #fff; font-size: 0.95rem; font-weight: 800; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; min-height: 2.6em;" title="${name}">
          ${name}
        </h4>
        <div style="font-size: 0.74rem; color: var(--text-secondary); margin-bottom: ${locSub ? '0.15rem' : '0.35rem'}; display: flex; align-items: center; gap: 5px;" title="${escapeHtml(locTooltip)}">
          <span>📍</span>
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600;">${escapeHtml(locPrimary)}</span>
        </div>
        ${locSub ? `
          <div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 0.35rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(locSub)}">
            🏛️ ${escapeHtml(locSub)}
          </div>
        ` : ''}
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; color: #94a3b8; margin-bottom: 0.75rem; background: rgba(0,0,0,0.25); padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
          <span>📅 ${dateStr}</span>
          <span style="color: #38bdf8; font-weight: 700;">👥 ${players}${capacity ? ` / ${capacity}` : ''} Players</span>
        </div>
        <div style="margin-top: auto; display: flex; gap: 0.4rem;">
          <button class="btn btn-primary" style="flex: 1; font-size: 0.75rem; padding: 0.38rem 0.5rem; justify-content: center; font-weight: 700;" onclick="openEventModal('${eid}')">
            ${isEnded ? '🏆 View Results' : '📋 Preview Event'}
          </button>
          ${locInfo.hasLocation ? `
            <button type="button" class="btn btn-outline" style="font-size: 0.75rem; padding: 0.38rem 0.5rem; color: #38bdf8; border-color: rgba(56,189,248,0.35);" onclick="event.stopPropagation(); openEventVenueMapModal('${eid}')" title="View Venue Address & Interactive Map">
              🗺️
            </button>
          ` : ''}
          <a href="${escapeHtml(extEventUrl)}" target="_blank" rel="noopener" class="btn btn-outline" style="font-size: 0.75rem; padding: 0.38rem 0.55rem; color: #94a3b8;" title="View on ${escapeHtml(extPlatName)}">
            🔗 ${escapeHtml(extPlatName)}
          </a>
        </div>
      </div>
    `;
  });

  carousel.innerHTML = html;
}

function changeCalendarMonth(delta) {
  const d = communityState.calendarDate || new Date();
  d.setMonth(d.getMonth() + delta);
  communityState.calendarDate = new Date(d);
  renderTournamentsCalendar();
}

function setCalendarToday() {
  communityState.calendarDate = new Date();
  renderTournamentsCalendar();
}

function closeCalendarDayDrawer() {
  const drawer = document.getElementById('comm-calendar-day-drawer');
  if (drawer) drawer.style.display = 'none';
  communityState.calendarSelectedDate = null;
  document.querySelectorAll('.comm-calendar-day.selected').forEach(el => el.classList.remove('selected'));
}

function getNormalizedEventEndDateStr(ev, startStr = '') {
  if (!ev) return startStr;
  const sStr = startStr || (ev.event_date || ev.eventDate || ev.start_date || '').slice(0, 10);
  const rawEnd = ev.end_date || ev.eventEndDate || ev.endDate || ev.raw_json?.eventEndDate || ev.raw_json?.endDate || ev.raw_json?.end_date || '';
  let endStr = '';
  if (rawEnd) {
    const rawStr = String(rawEnd).trim();
    if (rawStr.includes('T') && (rawStr.endsWith('Z') || rawStr.includes('+00:00'))) {
      const parsed = new Date(rawStr);
      if (!isNaN(parsed.getTime())) {
        const utcHour = parsed.getUTCHours();
        if (utcHour >= 0 && utcHour < 6) {
          const adj = new Date(parsed.getTime() - 6 * 3600 * 1000);
          endStr = adj.toISOString().slice(0, 10);
        } else {
          endStr = rawStr.slice(0, 10);
        }
      } else {
        endStr = rawStr.slice(0, 10);
      }
    } else {
      endStr = rawStr.slice(0, 10);
    }
  }
  if ((!endStr || endStr <= sStr) && sStr) {
    const nameLower = String(ev.name || ev.event_name || '').toLowerCase();
    let extraDays = 0;
    if (/\b3[\s-]*days?\b/.test(nameLower)) {
      extraDays = 2;
    } else if (/\b2[\s-]*days?\b/.test(nameLower)) {
      extraDays = 1;
    }
    if (extraDays > 0) {
      const d = new Date(sStr + 'T12:00:00');
      if (!isNaN(d.getTime())) {
        d.setDate(d.getDate() + extraDays);
        endStr = getLocalIsoDateStr(d);
      }
    }
  }
  if (!endStr || (sStr && endStr < sStr)) return sStr;
  return endStr;
}
window.getNormalizedEventEndDateStr = getNormalizedEventEndDateStr;

function getEventDurationDays(ev) {
  if (!ev) return 0;
  const sStr = (ev.event_date || ev.eventDate || ev.start_date || '').slice(0, 10);
  if (!sStr) return 0;
  const eStr = getNormalizedEventEndDateStr(ev, sStr);
  if (!eStr || eStr <= sStr) return 0;
  const sDt = new Date(sStr + 'T12:00:00');
  const eDt = new Date(eStr + 'T12:00:00');
  if (isNaN(sDt.getTime()) || isNaN(eDt.getTime())) return 0;
  return Math.max(0, Math.round((eDt.getTime() - sDt.getTime()) / 86400000));
}

function isLeagueOrMultiWeekEvent(ev) {
  if (!ev) return false;
  const durationDays = getEventDurationDays(ev);
  if (durationDays > 4) return true;
  const isNonBcp = (typeof isBcpEventId === 'function') && !isBcpEventId(ev.id);
  const nLower = ` ${String(ev.name || ev.event_name || '').toLowerCase()} `;
  const leagueTerms = [
    'escalation',
    'slow grow',
    'slow-grow',
    'crusade league',
    'narrative league',
    'monthly league',
    'weekly league',
    'seasonal league',
    'summer league',
    'winter league',
    'spring league',
    'fall league',
    'autumn league',
    'league season',
    'pod league',
    'store league',
    'ladder league',
    'combat patrol league',
    'spearhead league',
    'tabletop simulator',
    ' tts '
  ];
  if (!isNonBcp) {
    leagueTerms.push(' online ');
  }
  if (leagueTerms.some(kw => nLower.includes(kw))) return true;
  if (/\bleagues?\b/.test(nLower)) {
    const weekendTerms = ['gt', 'grand tournament', 'major', 'super major', 'open', 'championship', 'invitational', 'cup'];
    if (!weekendTerms.some(wt => nLower.includes(wt)) || durationDays > 3) {
      return true;
    }
  }
  return false;
}

function ensureEventTierMetadata(ev) {
  if (!ev) return ev;
  if (ev.tier && ev.tier_weight) return ev;
  const nLower = ` ${String(ev.name || ev.event_name || '').toLowerCase()} `;
  const totP = Number(ev.total_players || ev.totalPlayers || 0);
  const numT = Number(ev.num_tickets || ev.numTickets || ev.capacity || 0);
  const rounds = Number(ev.num_rounds || ev.numberOfRounds || 0);

  if ((rounds > 0 && rounds <= 3) || (rounds <= 3 && (nLower.includes(' rtt ') || nLower.includes(' rtt')))) {
    ev.tier = 'rtt';
    ev.tier_weight = 1;
    return ev;
  }
  const superTerms = ['lvo', 'las vegas open', 'adepticon', 'nova open', 'super major', 'london grand tournament', 'lgt', 'world championship', 'wtc', 'world team championship'];
  if (totP >= 200 || numT >= 350 || superTerms.some(k => nLower.includes(k))) {
    ev.tier = 'super_major';
    ev.tier_weight = 4;
    return ev;
  }
  const majorTerms = ['us open', ' open ', 'major', 'armadillo cup', 'championship', 'california cup', 'bfs gt', 'trials gx'];
  if (totP >= 70 || numT >= 90 || rounds >= 6 || majorTerms.some(k => nLower.includes(k))) {
    ev.tier = 'major';
    ev.tier_weight = 3;
    return ev;
  }
  const gtTerms = [' gt ', 'grand tournament', 'cup', 'brawl', 'clash'];
  if (rounds > 3 || totP >= 28 || numT >= 32 || gtTerms.some(k => nLower.includes(k))) {
    ev.tier = 'gt';
    ev.tier_weight = 2;
    return ev;
  }
  ev.tier = 'rtt';
  ev.tier_weight = 1;
  return ev;
}

function formatEventDateRangeLabel(ev) {
  if (!ev) return '';
  const sStr = (ev.event_date || ev.eventDate || ev.start_date || '').slice(0, 10);
  if (!sStr) return '';
  const eStr = getNormalizedEventEndDateStr(ev, sStr);
  if (eStr && eStr > sStr) {
    return `${sStr} – ${eStr}`;
  }
  return sStr;
}
window.formatEventDateRangeLabel = formatEventDateRangeLabel;

function getAllDiscoveryTournaments() {
  const map = new Map();
  const radiusLimit = Number(communityState.radiusMiles || 50) * 1.15;
  const recs = communityState.recommendations;

  // Prefer smart recommendation engine pool when available (already noise-filtered & scored)
  if (recs) {
    (recs.local_events || []).forEach(ev => {
      if (ev && ev.id) {
        map.set(ev.id, ensureEventTierMetadata({ ...ev, is_local: true }));
      }
    });
    (recs.driveable_events || []).forEach(ev => {
      if (ev && ev.id && !map.has(ev.id)) {
        map.set(ev.id, ensureEventTierMetadata({ ...ev, is_driveable: true }));
      }
    });
    (recs.destination_majors || []).forEach(ev => {
      if (ev && ev.id && !map.has(ev.id)) {
        const isLoc = Boolean(ev.is_local || (ev.distance_miles != null && Number(ev.distance_miles) <= radiusLimit));
        map.set(ev.id, ensureEventTierMetadata({ ...ev, is_local: isLoc }));
      }
    });
    (recs.past_results || []).forEach(ev => {
      if (ev && ev.id && !map.has(ev.id)) {
        map.set(ev.id, ensureEventTierMetadata({ ...ev, is_local: true, is_ended: true }));
      }
    });
    if (communityState.tournamentsSearchQuery && communityState.searchResults) {
      [...(communityState.searchResults.upcoming || []), ...(communityState.searchResults.past || [])].forEach(ev => {
        if (ev && ev.id && !map.has(ev.id)) {
          map.set(ev.id, ensureEventTierMetadata({ ...ev }));
        }
      });
    }
    return Array.from(map.values());
  }

  // Fallback before recommendations finish loading
  const rawUpcoming = communityState.overview?.events_upcoming || [];
  rawUpcoming.forEach(ev => {
    if (ev && ev.id && !isLeagueOrMultiWeekEvent(ev)) {
      map.set(ev.id, ensureEventTierMetadata({ ...ev, is_local: true }));
    }
  });

  const rawRecent = communityState.overview?.events_recent || [];
  rawRecent.forEach(ev => {
    if (ev && ev.id && !map.has(ev.id) && !isLeagueOrMultiWeekEvent(ev)) {
      map.set(ev.id, ensureEventTierMetadata({ ...ev, is_local: true, is_ended: true }));
    }
  });

  const majors = communityState.majorsList || [];
  majors.forEach(ev => {
    if (!ev || !ev.id || map.has(ev.id) || isLeagueOrMultiWeekEvent(ev)) return;
    const isWithinLocalRadius = ev.distance_miles != null && Number(ev.distance_miles) <= radiusLimit;
    const isLocal = Boolean(ev.is_local === true || isWithinLocalRadius);
    const enriched = ensureEventTierMetadata({ ...ev, is_local: isLocal });
    if (!isLocal && !['super_major', 'major', 'gt'].includes(enriched.tier)) return;
    map.set(enriched.id, enriched);
  });

  return Array.from(map.values());
}

function filterCalendarTournamentCandidate(ev) {
  if (!ev || !ev.event_date) return false;
  const startStr = ev.event_date.slice(0, 10);
  const endStr = getNormalizedEventEndDateStr(ev, startStr);
  const isEnded = isTournamentEnded(ev);

  // If user is actively searching, match search query across both upcoming & past
  if (communityState.tournamentsSearchQuery) {
    return matchesCommunityEventSearch(ev, communityState.tournamentsSearchQuery);
  }

  // Venue filter if active
  if (communityState.tournamentsVenueFilter) {
    const vf = communityState.tournamentsVenueFilter.toLowerCase();
    const vName = `${ev.venue || ''} ${ev.venue_name || ''} ${ev.address || ''} ${ev.formatted_address || ''} ${ev.street_address || ''} ${ev.city || ''} ${ev.location || ''} ${ev.name || ''}`.toLowerCase();
    if (!vName.includes(vf) && !vf.includes(vName)) return false;
  }

  // Concierge recommendation tab filter
  const recTab = communityState.recTab || 'for_you';
  if (recTab === 'past') {
    if (!isEnded) return false;
  } else if (recTab === 'driveable') {
    if (isEnded) return false;
    const maxMin = Number(communityState.maxDriveHours || 2) * 60 + 10;
    const inDrive = Boolean(ev.is_local || ev.is_driveable || (ev.drive_minutes != null && Number(ev.drive_minutes) <= maxMin));
    if (!inDrive) return false;
  } else if (recTab === 'majors') {
    if (isEnded) return false;
    const isMaj = ev.is_major || ['super_major', 'major', 'gt'].includes(ev.tier) || Number(ev.total_players || 0) >= 48;
    if (!isMaj) return false;
  }

  // Optional weekend quick filter
  if (communityState.tournamentsQuickFilter === 'weekend') {
    if (!isDateInWeekend(startStr, 0) && !isDateInWeekend(endStr, 0)) return false;
  } else if (communityState.tournamentsQuickFilter === 'next_weekend') {
    if (!isDateInWeekend(startStr, 1) && !isDateInWeekend(endStr, 1)) return false;
  }

  return true;
}

function getTournamentsOnDate(dateStr) {
  const all = getAllDiscoveryTournaments().filter(filterCalendarTournamentCandidate);
  return all.filter(ev => {
    const evDate = ev.event_date.slice(0, 10);
    if (evDate === dateStr) return true;
    const durationDays = getEventDurationDays(ev);
    // Multi-week local leagues show on their start date rather than spanning every day for months
    if (durationDays > 4) return false;
    const evEnd = getNormalizedEventEndDateStr(ev, evDate);
    if (evEnd && evEnd > evDate) {
      return dateStr >= evDate && dateStr <= evEnd;
    }
    return false;
  });
}

function renderCalendarDrawerCardsHtml(events) {
  if (!events || events.length === 0) {
    return `
      <div style="grid-column: 1 / -1; padding: 1.5rem; text-align: center; color: var(--text-muted);">
        No tournaments matching current filters.
      </div>
    `;
  }
  let html = '';
  events.forEach(ev => {
    const eid = escapeHtml(ev.id);
    const name = escapeHtml(ev.name || 'Tournament');
    const locInfo = getCommunityEventLocationInfo(ev);
    const loc = locInfo.displayLabel || 'Unspecified Location';
    const players = Number(ev.total_players || 0);
    const rounds = ev.num_rounds || 0;
    const tier = ev.tier || 'rtt';
    const sStr = (ev.event_date || '').slice(0, 10);
    const eStr = getNormalizedEventEndDateStr(ev, sStr);
    const dateSpanLabel = (eStr && eStr > sStr) ? `${sStr} – ${eStr}` : sStr;
    const isEnded = isTournamentEnded(ev);
    const isOngoing = !isEnded && isTournamentOngoing(ev);
    const isLocal = Boolean(ev.is_local);

    let tierBadge = `<span class="comm-legend-pill pill-rtt">⚪ RTT</span>`;
    if (tier === 'super_major') {
      tierBadge = `<span class="comm-legend-pill pill-super-major">🟣 SUPER MAJOR</span>`;
    } else if (tier === 'major') {
      tierBadge = `<span class="comm-legend-pill pill-major">🔵 MAJOR</span>`;
    } else if (tier === 'gt') {
      tierBadge = `<span class="comm-legend-pill pill-gt">🟢 GT</span>`;
    }

    const scopeBadge = isLocal
      ? `<span class="comm-legend-pill pill-scope-local" title="Within your local search radius">📍 LOCAL${ev.distance_miles != null ? ` • ${Number(ev.distance_miles).toFixed(1)} mi` : ''}</span>`
      : `<span class="comm-legend-pill pill-scope-global" title="Global Weekend Destination Event">🌐 GLOBAL</span>`;

    let statusPill = '';
    if (isEnded) {
      statusPill = `<span class="comm-legend-pill pill-scope-past">✓ COMPLETED</span>`;
    } else if (isOngoing) {
      statusPill = `<span class="comm-legend-pill" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border-color: rgba(245, 158, 11, 0.4);">🔥 LIVE NOW</span>`;
    }

    const platBadgeHtml = (typeof getPlatformBadgeHtml === 'function') ? getPlatformBadgeHtml(eid, ev) : '';
    const fmtBadgeHtml = (typeof getEventFormatBadgeHtml === 'function') ? getEventFormatBadgeHtml(ev) : '';
    const extEventUrl = (typeof getPlatformExternalEventUrl === 'function') ? getPlatformExternalEventUrl(eid, ev) : `https://www.bestcoastpairings.com/event/${eid}`;
    const extPlatName = (typeof getPlatformDisplayName === 'function') ? getPlatformDisplayName(eid, ev) : 'BCP';

    html += `
      <div style="background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 1rem; display: flex; flex-direction: column;">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
            ${scopeBadge}
            ${tierBadge}
            ${platBadgeHtml}
            ${fmtBadgeHtml}
          </div>
          ${statusPill}
        </div>
        <h4 style="margin: 0 0 0.35rem; color: #fff; font-size: 0.95rem; font-weight: 800; line-height: 1.35;">${name}</h4>
        <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.6rem;" title="${escapeHtml(locInfo.fullAddressLine || loc)}">📍 ${escapeHtml(loc)}</div>
        <div style="display: flex; flex-wrap: wrap; gap: 0.75rem; font-size: 0.72rem; color: #94a3b8; margin-bottom: 0.75rem;">
          ${dateSpanLabel ? `<span>📅 ${escapeHtml(dateSpanLabel)}</span>` : ''}
          <span>👥 ${players} Players</span>
          ${rounds ? `<span>⚔️ ${rounds} Rounds</span>` : ''}
        </div>
        <div style="margin-top: auto; display: flex; gap: 0.4rem;">
          <button type="button" class="btn btn-primary" style="flex: 1; font-size: 0.75rem; padding: 0.4rem; font-weight: 700;" onclick="openEventModal('${eid}')">
            ${isEnded ? '🏆 View Results & Lists' : '📋 Preview Event'}
          </button>
          ${locInfo.hasLocation ? `
            <button type="button" class="btn btn-outline" style="font-size: 0.75rem; padding: 0.4rem 0.55rem; color: #38bdf8; border-color: rgba(56,189,248,0.35);" onclick="event.stopPropagation(); openEventVenueMapModal('${eid}')" title="View Venue Address & Interactive Map">
              🗺️
            </button>
          ` : ''}
          <a href="${escapeHtml(extEventUrl)}" target="_blank" rel="noopener" class="btn btn-outline" style="font-size: 0.75rem; padding: 0.4rem 0.6rem; color: #94a3b8;" title="View on ${escapeHtml(extPlatName)}">
            🔗 ${escapeHtml(extPlatName)}
          </a>
        </div>
      </div>
    `;
  });
  return html;
}

function syncCalendarMonthToFilteredEvents() {
  const filtered = getAllDiscoveryTournaments().filter(filterCalendarTournamentCandidate);
  if (filtered.length === 0) return;

  const cur = communityState.calendarDate || new Date();
  const curPrefix = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
  const hasInCurrentMonth = filtered.some(ev => {
    const s = (ev.event_date || '').slice(0, 7);
    const e = getNormalizedEventEndDateStr(ev, (ev.event_date || '').slice(0, 10)).slice(0, 7);
    return s === curPrefix || e === curPrefix;
  });

  if (hasInCurrentMonth && communityState.tournamentsQuickFilter !== 'weekend' && communityState.tournamentsQuickFilter !== 'next_weekend') {
    return;
  }

  const todayStr = getLocalIsoDateStr(new Date());
  let targetDateStr = '';
  if (communityState.eventsFilter === 'recent') {
    const sortedDesc = [...filtered].sort((a, b) => String(b.event_date || '').localeCompare(String(a.event_date || '')));
    targetDateStr = (sortedDesc[0]?.event_date || '').slice(0, 10);
  } else {
    const upcomingSorted = filtered
      .filter(ev => (ev.event_date || '').slice(0, 10) >= todayStr)
      .sort((a, b) => String(a.event_date || '').localeCompare(String(b.event_date || '')));
    if (upcomingSorted.length > 0) {
      targetDateStr = (upcomingSorted[0].event_date || '').slice(0, 10);
    } else {
      const sortedDesc = [...filtered].sort((a, b) => String(b.event_date || '').localeCompare(String(a.event_date || '')));
      targetDateStr = (sortedDesc[0]?.event_date || '').slice(0, 10);
    }
  }

  if (targetDateStr) {
    const dt = new Date(targetDateStr + 'T12:00:00');
    if (!isNaN(dt.getTime())) {
      communityState.calendarDate = new Date(dt.getFullYear(), dt.getMonth(), 1);
    }
  }
}

function openCalendarFilteredDrawer() {
  const drawer = document.getElementById('comm-calendar-day-drawer');
  const title = document.getElementById('comm-day-drawer-title');
  const body = document.getElementById('comm-day-drawer-body');
  if (!drawer || !body) return;

  const filtered = getAllDiscoveryTournaments().filter(filterCalendarTournamentCandidate);
  const sorted = [...filtered].sort((a, b) => {
    const locDiff = (b.is_local ? 1 : 0) - (a.is_local ? 1 : 0);
    if (locDiff !== 0) return locDiff;
    if (communityState.eventsFilter === 'recent') {
      return String(b.event_date || '').localeCompare(String(a.event_date || ''));
    }
    return String(a.event_date || '').localeCompare(String(b.event_date || ''));
  });

  let labelParts = [];
  if (communityState.eventsFilter === 'upcoming') labelParts.push('⚡ Upcoming & Ongoing');
  else if (communityState.eventsFilter === 'recent') labelParts.push('📜 Recent Results');
  else labelParts.push('All Events');

  if (communityState.tournamentsQuickFilter === 'local') labelParts.push('📍 Local Only');
  else if (communityState.tournamentsQuickFilter === 'weekend') labelParts.push('⚡ This Weekend');
  else if (communityState.tournamentsQuickFilter === 'next_weekend') labelParts.push('📅 Next Weekend');
  else if (communityState.tournamentsQuickFilter === 'majors') labelParts.push('🌟 Majors Only');

  if (title) {
    title.textContent = `📅 ${labelParts.join(' • ')} (${sorted.length})`;
  }
  body.innerHTML = renderCalendarDrawerCardsHtml(sorted.slice(0, 24));
  drawer.style.display = 'block';
}

function openCalendarDayDrawer(dateStr) {
  communityState.calendarSelectedDate = dateStr;
  const drawer = document.getElementById('comm-calendar-day-drawer');
  const title = document.getElementById('comm-day-drawer-title');
  const body = document.getElementById('comm-day-drawer-body');
  if (!drawer || !body) return;

  document.querySelectorAll('.comm-calendar-day').forEach(el => {
    el.classList.toggle('selected', el.dataset.date === dateStr);
  });

  const events = getTournamentsOnDate(dateStr);
  const prettyDate = new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  if (title) title.textContent = `📅 Tournaments on ${prettyDate} (${events.length})`;
  body.innerHTML = renderCalendarDrawerCardsHtml(events);

  drawer.style.display = 'block';
  drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderTournamentsCalendar() {
  const grid = document.getElementById('comm-calendar-grid');
  const monthTitle = document.getElementById('comm-calendar-month-title');
  if (!grid) return;

  const cur = communityState.calendarDate || new Date();
  const year = cur.getFullYear();
  const month = cur.getMonth(); // 0-indexed

  if (monthTitle) {
    monthTitle.textContent = cur.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  const firstDay = new Date(year, month, 1);
  const startingDayOfWeek = firstDay.getDay();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const todayStr = getLocalIsoDateStr(new Date());

  const allEvents = getAllDiscoveryTournaments();
  const filteredEvents = allEvents.filter(filterCalendarTournamentCandidate);
  const eventsByDate = new Map();

  filteredEvents.forEach(ev => {
    const startStr = ev.event_date.slice(0, 10);
    const endStr = getNormalizedEventEndDateStr(ev, startStr);
    const durationDays = getEventDurationDays(ev);

    // Local multi-week leagues (> 5 calendar days) display on their start date so they don't flood 42 cells
    if (durationDays > 4) {
      if (!eventsByDate.has(startStr)) eventsByDate.set(startStr, []);
      eventsByDate.get(startStr).push(ev);
      return;
    }

    let d = new Date(startStr + 'T12:00:00');
    const endDate = new Date(endStr + 'T12:00:00');
    let safety = 0;
    while (d <= endDate && safety < 5) {
      const dStr = getLocalIsoDateStr(d);
      if (!eventsByDate.has(dStr)) eventsByDate.set(dStr, []);
      eventsByDate.get(dStr).push(ev);
      d.setDate(d.getDate() + 1);
      safety++;
    }
  });

  // Sort each day's events: Local events first so users never miss nearby events, then by tier weight, start date, and player count
  const tierWeightOf = (ev) => {
    if (ev.tier_weight) return Number(ev.tier_weight);
    if (ev.tier === 'super_major') return 4;
    if (ev.tier === 'major') return 3;
    if (ev.tier === 'gt') return 2;
    return 1;
  };
  eventsByDate.forEach((list) => {
    list.sort((a, b) => {
      const locDiff = (b.is_local ? 1 : 0) - (a.is_local ? 1 : 0);
      if (locDiff !== 0) return locDiff;
      const twDiff = tierWeightOf(b) - tierWeightOf(a);
      if (twDiff !== 0) return twDiff;
      const sa = (a.event_date || '').slice(0, 10);
      const sb = (b.event_date || '').slice(0, 10);
      if (sa !== sb) return sa.localeCompare(sb);
      return Number(b.total_players || 0) - Number(a.total_players || 0);
    });
  });

  let html = '';
  const totalDays = 42;
  for (let i = 0; i < totalDays; i++) {
    let dayNum;
    let isOtherMonth = false;
    let cellYear = year;
    let cellMonth = month;

    if (i < startingDayOfWeek) {
      dayNum = daysInPrevMonth - (startingDayOfWeek - 1 - i);
      isOtherMonth = true;
      cellMonth = month - 1;
      if (cellMonth < 0) {
        cellMonth = 11;
        cellYear--;
      }
    } else if (i >= startingDayOfWeek + daysInMonth) {
      dayNum = i - (startingDayOfWeek + daysInMonth) + 1;
      isOtherMonth = true;
      cellMonth = month + 1;
      if (cellMonth > 11) {
        cellMonth = 0;
        cellYear++;
      }
    } else {
      dayNum = i - startingDayOfWeek + 1;
    }

    const cellDateStr = `${cellYear}-${String(cellMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const dayOfWeek = i % 7;
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6); // Fri, Sat, Sun
    const isToday = (cellDateStr === todayStr);
    const isSelected = (cellDateStr === communityState.calendarSelectedDate);

    const dayEvents = eventsByDate.get(cellDateStr) || [];
    const localCount = dayEvents.filter(e => e.is_local).length;

    let classes = ['comm-calendar-day'];
    if (isOtherMonth) classes.push('other-month');
    if (isWeekend) classes.push('weekend');
    if (isToday) classes.push('today');
    if (isSelected) classes.push('selected');
    if (localCount > 0) classes.push('has-local-event');

    let chipsHtml = '';
    const maxChips = 2;
    dayEvents.slice(0, maxChips).forEach(ev => {
      const tier = ev.tier || 'rtt';
      let tierClass = 'rtt';
      if (tier === 'super_major') {
        tierClass = 'super-major';
      } else if (tier === 'major') {
        tierClass = 'major';
      } else if (tier === 'gt') {
        tierClass = 'gt';
      }

      const isLocal = Boolean(ev.is_local);
      const isEnded = isTournamentEnded(ev);
      const scopeClass = isLocal ? 'chip-local' : 'chip-global';
      const endedClass = isEnded ? 'chip-ended' : '';
      const scopeIcon = isLocal ? '📍' : '🌐';
      const scopeTip = isLocal
        ? `LOCAL${ev.distance_miles != null ? ` (${Number(ev.distance_miles).toFixed(1)} mi)` : ''}`
        : `GLOBAL ${tier.replace('_', ' ').toUpperCase()}`;

      const evStartStr = (ev.event_date || '').slice(0, 10);
      const evEndStr = getNormalizedEventEndDateStr(ev, evStartStr);
      const isMultiDay = Boolean(evStartStr && evEndStr && evEndStr > evStartStr);
      const dateRangeTip = isMultiDay ? ` • ${evStartStr} to ${evEndStr}` : '';
      const statusTip = isEnded ? ' • Completed (Click for Results)' : '';

      const truncatedName = escapeHtml(ev.name || 'Event').slice(0, 17);
      chipsHtml += `
        <div class="comm-calendar-chip ${tierClass} ${scopeClass} ${endedClass}" onclick="event.stopPropagation(); openEventModal('${escapeHtml(ev.id)}')" title="[${scopeTip}] ${escapeHtml(ev.name)}${dateRangeTip} (${ev.total_players || 0} players)${statusTip}">
          <span class="comm-chip-scope ${isLocal ? 'local' : 'global'}">${scopeIcon}</span>
          <span class="comm-chip-text" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1;">${truncatedName}</span>
          ${isEnded ? `<span class="comm-chip-done" title="Completed — Click for Results">✓</span>` : (ev.total_players ? `<span class="comm-chip-count" style="opacity: 0.85; font-size: 0.6rem; margin-left: auto;">(${ev.total_players})</span>` : '')}
        </div>
      `;
    });

    if (dayEvents.length > maxChips) {
      chipsHtml += `
        <div class="comm-calendar-more-chip" onclick="event.stopPropagation(); openCalendarDayDrawer('${cellDateStr}')">
          +${dayEvents.length - maxChips} more
        </div>
      `;
    }

    let dotsHtml = '';
    if (dayEvents.length > 0) {
      const maxDots = 3;
      dayEvents.slice(0, maxDots).forEach(ev => {
        const tier = ev.tier || 'rtt';
        let dotClass = 'rtt';
        if (tier === 'super_major') dotClass = 'super-major';
        else if (tier === 'major') dotClass = 'major';
        else if (tier === 'gt') dotClass = 'gt';
        if (ev.is_local) dotClass += ' dot-local';
        if (isTournamentEnded(ev)) dotClass += ' dot-ended';
        dotsHtml += `<span class="comm-cal-dot ${dotClass}" title="${ev.is_local ? '📍 Local: ' : '🌐 Global: '}${escapeHtml(ev.name)}"></span>`;
      });
      if (dayEvents.length > maxDots) {
        dotsHtml += `<span class="comm-cal-dot-more">+${dayEvents.length - maxDots}</span>`;
      }
    }

    html += `
      <div class="${classes.join(' ')}" data-date="${cellDateStr}" onclick="openCalendarDayDrawer('${cellDateStr}')">
        <div class="comm-calendar-day-header">
          <span class="comm-calendar-day-num">${dayNum}</span>
          <div style="display: inline-flex; align-items: center; gap: 3px;">
            ${localCount > 0 ? `<span class="comm-cal-local-pin" title="${localCount} Local Event(s) within ${communityState.radiusMiles || 50} mi">📍${localCount > 1 ? localCount : ''}</span>` : ''}
            ${isToday ? `<span class="comm-calendar-day-badge" style="background: #38bdf8; color: #070b14;">TODAY</span>` : ''}
          </div>
        </div>
        <div class="comm-calendar-events-list">
          <div class="comm-calendar-desktop-events">
            ${chipsHtml}
          </div>
          <div class="comm-calendar-mobile-dots">
            ${dotsHtml}
          </div>
        </div>
      </div>
    `;
  }

  grid.innerHTML = html;

  if (communityState.calendarSelectedDate) {
    openCalendarDayDrawer(communityState.calendarSelectedDate);
  }
}

/**
 * --------------------------------------------------------------------------
 * SUBTAB 1: REGIONAL TOURNAMENTS & HISTORY
 * --------------------------------------------------------------------------
 */
function setCommunityEventsFilter(filter) {
  communityState.eventsFilter = filter;
  if (filter === 'recent') {
    setCommunityRecTab('past');
    return;
  }
  setCommunityRecTab('for_you');
}

function formatShortEventDateRange(ev) {
  if (!ev) return 'TBD';
  const sStr = String(ev.event_date || ev.eventDate || ev.start_date || '').slice(0, 10);
  if (!sStr || sStr.length < 10) return sStr || 'TBD';
  const eStr = getNormalizedEventEndDateStr(ev, sStr);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const sParts = sStr.split('-');
  const sYr = Number(sParts[0]);
  const sMo = Number(sParts[1]) - 1;
  const sDa = Number(sParts[2]);
  if (isNaN(sMo) || sMo < 0 || sMo > 11 || isNaN(sDa)) return sStr;
  const nowYr = new Date().getFullYear();
  const yrSuffix = sYr !== nowYr ? `, ${sYr}` : '';

  if (eStr && eStr > sStr && eStr.length >= 10) {
    const eParts = eStr.split('-');
    const eMo = Number(eParts[1]) - 1;
    const eDa = Number(eParts[2]);
    if (!isNaN(eMo) && eMo >= 0 && eMo <= 11 && !isNaN(eDa)) {
      if (eMo === sMo) {
        return `${months[sMo]} ${sDa}–${eDa}${yrSuffix}`;
      }
      return `${months[sMo]} ${sDa} – ${months[eMo]} ${eDa}${yrSuffix}`;
    }
  }
  return `${months[sMo]} ${sDa}${yrSuffix}`;
}

function getTierBadgeMeta(ev) {
  const enriched = ensureEventTierMetadata(ev ? { ...ev } : {});
  const tier = enriched.tier || 'rtt';
  if (tier === 'super_major') {
    return {
      label: '👑 SUPER MAJOR',
      bg: 'rgba(245, 158, 11, 0.16)',
      color: '#fbbf24',
      border: 'rgba(245, 158, 11, 0.42)'
    };
  }
  if (tier === 'major') {
    return {
      label: '🌟 MAJOR',
      bg: 'rgba(168, 85, 247, 0.16)',
      color: '#d8b4fe',
      border: 'rgba(168, 85, 247, 0.42)'
    };
  }
  if (tier === 'gt') {
    return {
      label: '🏆 GT',
      bg: 'rgba(56, 189, 248, 0.14)',
      color: '#7dd3fc',
      border: 'rgba(56, 189, 248, 0.35)'
    };
  }
  return {
    label: '⚔️ RTT',
    bg: 'rgba(148, 163, 184, 0.12)',
    color: '#cbd5e1',
    border: 'rgba(148, 163, 184, 0.28)'
  };
}

function buildFallbackRecommendationBuckets(overview) {
  const localEvents = [];
  const pastResults = [];
  if (!overview) {
    return {
      top_picks: [],
      local_events: [],
      driveable_events: [],
      destination_majors: (communityState.majorsList || []).filter(m => m && !isLeagueOrMultiWeekEvent(m) && !isTournamentEnded(m)),
      past_results: [],
      summary: {
        local_count: 0,
        driveable_count: 0,
        majors_count: (communityState.majorsList || []).length,
        past_count: 0,
        filtered_noise_count: 0,
        local_radius_miles: Number(communityState.radiusMiles || 50),
        max_drive_hours: Number(communityState.maxDriveHours || 2),
        majors_scope: communityState.majorsScope || 'regional'
      }
    };
  }

  let filteredNoise = 0;
  (overview.events_upcoming || []).forEach(ev => {
    if (!ev || !ev.id) return;
    if (isLeagueOrMultiWeekEvent(ev)) {
      filteredNoise++;
      return;
    }
    if (isTournamentEnded(ev)) {
      pastResults.push(ensureEventTierMetadata({ ...ev, is_ended: true }));
    } else {
      localEvents.push(ensureEventTierMetadata({ ...ev, is_local: true }));
    }
  });
  const seenPast = new Set(pastResults.map(e => e.id));
  (overview.events_recent || []).forEach(ev => {
    if (!ev || !ev.id || seenPast.has(ev.id)) return;
    if (isLeagueOrMultiWeekEvent(ev)) return;
    seenPast.add(ev.id);
    pastResults.push(ensureEventTierMetadata({ ...ev, is_ended: true }));
  });

  const destMajors = (communityState.majorsList || []).filter(m => m && !isLeagueOrMultiWeekEvent(m) && !isTournamentEnded(m));
  return {
    top_picks: localEvents.slice(0, 2),
    local_events: localEvents,
    driveable_events: [],
    destination_majors: destMajors,
    past_results: pastResults,
    summary: {
      local_count: localEvents.length,
      driveable_count: 0,
      majors_count: destMajors.length,
      past_count: pastResults.length,
      filtered_noise_count: filteredNoise,
      local_radius_miles: Number(communityState.radiusMiles || 50),
      max_drive_hours: Number(communityState.maxDriveHours || 2),
      majors_scope: communityState.majorsScope || 'regional'
    }
  };
}

function renderCommunityEvents() {
  const container = document.getElementById('comm-tournaments-content');
  if (!container) return;

  syncRecommendationControlsUI();

  const recs = communityState.recommendations;
  const overview = communityState.overview;

  if (!recs && !overview) {
    const errText = communityState.recommendationsError || communityState.overviewError;
    if (errText && !communityState.recommendationsLoading && !communityState.isLoading) {
      container.innerHTML = `
        <div style="padding: 2.5rem 1rem; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border);">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
          <h4 style="color: #fff; margin-bottom: 0.4rem;">Unable to Load Tournament Recommendations</h4>
          <p style="font-size: 0.85rem; color: var(--text-secondary); max-width: 480px; margin: 0 auto 1.25rem;">
            ${escapeHtml(errText)}
          </p>
          <button class="btn btn-primary" onclick="refreshCommunityTournaments()">🔄 Retry</button>
        </div>
      `;
      return;
    }
    setSubtabLoaderIfEmpty(container, getCommunitySubtabLoaderHtml('tournaments'));
    return;
  }

  const data = recs || buildFallbackRecommendationBuckets(overview);
  const localEvents = Array.isArray(data.local_events) ? data.local_events : [];
  const driveableEvents = Array.isArray(data.driveable_events) ? data.driveable_events : [];
  const destinationMajors = Array.isArray(data.destination_majors) ? data.destination_majors : [];
  const pastResults = Array.isArray(data.past_results) ? data.past_results : [];
  const summary = data.summary || {};

  const radMiles = Number(summary.local_radius_miles || communityState.radiusMiles || 50);
  const maxDriveHrs = Number(communityState.maxDriveHours || summary.max_drive_hours || 2);
  const majorsScope = communityState.majorsScope || summary.majors_scope || 'regional';
  const locLabel = data.center?.label || communityState.locationName || 'Your Location';

  const userElo = (typeof currentUser !== 'undefined' && currentUser && currentUser.current_elo)
    ? Number(currentUser.current_elo)
    : null;

  if (communityState.tournamentsViewMode === 'calendar') {
    renderTournamentsCalendar();
  }

  const upcomingForHydration = [];
  const addHydrationItems = (arr) => {
    (arr || []).forEach(ev => {
      if (ev && ev.id && ev.avg_field_elo == null && Number(ev.total_players || 0) > 0) {
        upcomingForHydration.push(ev);
      }
    });
  };

  const sq = (communityState.tournamentsSearchQuery || '').trim();

  // -------------------------------------------------------------------------
  // MODE A: ACTIVE SEARCH RESULTS VIEW (Instant Client + Server Search)
  // -------------------------------------------------------------------------
  if (sq) {
    const upMap = new Map();
    const pastMap = new Map();

    const considerCandidate = (ev, forcePast = false) => {
      if (!ev || !ev.id) return;
      if (!matchesCommunityEventSearch(ev, sq)) return;
      const ended = forcePast || isTournamentEnded(ev);
      if (ended) {
        if (!pastMap.has(ev.id)) pastMap.set(ev.id, ev);
      } else {
        if (!upMap.has(ev.id)) upMap.set(ev.id, ev);
      }
    };

    localEvents.forEach(ev => considerCandidate(ev, false));
    driveableEvents.forEach(ev => considerCandidate(ev, false));
    destinationMajors.forEach(ev => considerCandidate(ev, false));
    pastResults.forEach(ev => considerCandidate(ev, true));
    (overview?.events_upcoming || []).forEach(ev => {
      if (!isLeagueOrMultiWeekEvent(ev)) considerCandidate(ev, false);
    });
    (overview?.events_recent || []).forEach(ev => {
      if (!isLeagueOrMultiWeekEvent(ev)) considerCandidate(ev, true);
    });

    if (communityState.searchResults && communityState.searchQueryExecuted.toLowerCase() === sq.toLowerCase()) {
      (communityState.searchResults.upcoming || []).forEach(ev => {
        if (ev && ev.id && !upMap.has(ev.id)) upMap.set(ev.id, ev);
      });
      (communityState.searchResults.past || []).forEach(ev => {
        if (ev && ev.id && !pastMap.has(ev.id)) pastMap.set(ev.id, ev);
      });
    }

    const searchUpcoming = Array.from(upMap.values());
    const searchPast = Array.from(pastMap.values());
    addHydrationItems(searchUpcoming.slice(0, 18));

    let searchHtml = `
      <div class="comm-rec-search-banner">
        <div class="comm-rec-search-banner-info">
          <span style="font-size: 1.05rem;">🔍</span>
          <div>
            <strong style="color: #fff;">Search Results for "${escapeHtml(sq)}"</strong>
            <span style="color: #94a3b8; font-size: 0.8rem; margin-left: 8px;">
              ${searchUpcoming.length} upcoming • ${searchPast.length} past
              ${communityState.searchLoading ? '<span class="spinner-mini" style="display:inline-block; width:10px; height:10px; border:1.5px solid rgba(56,189,248,0.3); border-top-color:#38bdf8; border-radius:50%; animation:spin 0.8s linear infinite; margin-left:6px; vertical-align:middle;"></span>' : ''}
            </span>
          </div>
        </div>
        <button type="button" class="btn btn-outline" style="font-size: 0.76rem; padding: 0.3rem 0.7rem;" onclick="clearCommunityTournamentsSearch()">
          ✕ Clear Search
        </button>
      </div>
    `;

    if (searchUpcoming.length === 0 && searchPast.length === 0) {
      searchHtml += `
        <div class="comm-rec-empty-box">
          <div style="font-size: 1.9rem; margin-bottom: 0.45rem;">🔎</div>
          <h4 style="color: #fff; margin: 0 0 0.35rem;">${communityState.searchLoading ? 'Searching Global & Local Circuit...' : `No Tournaments Matching "${escapeHtml(sq)}"`}</h4>
          <p style="font-size: 0.82rem; color: #94a3b8; max-width: 460px; margin: 0 auto 1rem;">
            Try searching by event name, city, state, venue, or Major series:
          </p>
          <div class="comm-rec-quick-tags">
            <button type="button" class="comm-drive-pill" onclick="applyQuickTournamentSearch('California Cup')">California Cup</button>
            <button type="button" class="comm-drive-pill" onclick="applyQuickTournamentSearch('Open')">Open</button>
            <button type="button" class="comm-drive-pill" onclick="applyQuickTournamentSearch('GT')">GT</button>
            <button type="button" class="comm-drive-pill" onclick="applyQuickTournamentSearch('San Diego')">San Diego</button>
            <button type="button" class="comm-drive-pill" onclick="applyQuickTournamentSearch('Las Vegas')">Las Vegas</button>
          </div>
        </div>
      `;
    } else {
      if (searchUpcoming.length > 0) {
        searchHtml += `
          <section class="comm-rec-section">
            <div class="comm-rec-section-head">
              <div>
                <h3 class="comm-rec-section-title">⚡ Upcoming &amp; Live Matches <span class="comm-rec-count-pill">${searchUpcoming.length}</span></h3>
              </div>
            </div>
            <div class="comm-events-grid">
              ${searchUpcoming.map(ev => renderTournamentCard(ev, true, userElo)).join('')}
            </div>
          </section>
        `;
      }
      if (searchPast.length > 0) {
        searchHtml += `
          <section class="comm-rec-section">
            <div class="comm-rec-section-head">
              <div>
                <h3 class="comm-rec-section-title">📜 Completed Tournament Results <span class="comm-rec-count-pill">${searchPast.length}</span></h3>
              </div>
            </div>
            <div class="comm-events-grid">
              ${searchPast.map(ev => renderTournamentCard(ev, false, userElo)).join('')}
            </div>
          </section>
        `;
      }
    }

    container.innerHTML = searchHtml;
    if (upcomingForHydration.length > 0) {
      hydrateUpcomingFieldStats(upcomingForHydration.map(e => e.id), userElo);
    }
    return;
  }

  // -------------------------------------------------------------------------
  // MODE B: VENUE FILTER OVERRIDE (e.g. clicked from Local Stores subtab)
  // -------------------------------------------------------------------------
  if (communityState.tournamentsVenueFilter) {
    const vf = communityState.tournamentsVenueFilter.toLowerCase();
    const matchVenue = (ev) => {
      const vName = `${ev.venue || ''} ${ev.venue_name || ''} ${ev.address || ''} ${ev.formatted_address || ''} ${ev.street_address || ''} ${ev.city || ''} ${ev.location || ''} ${ev.name || ''}`.toLowerCase();
      return vName.includes(vf) || vf.includes(vName);
    };
    const vUpMap = new Map();
    [...localEvents, ...driveableEvents, ...(overview?.events_upcoming || [])].forEach(ev => {
      if (ev && ev.id && !isTournamentEnded(ev) && matchVenue(ev)) vUpMap.set(ev.id, ev);
    });
    const vPastMap = new Map();
    [...pastResults, ...(overview?.events_recent || [])].forEach(ev => {
      if (ev && ev.id && matchVenue(ev)) vPastMap.set(ev.id, ev);
    });
    const vUp = Array.from(vUpMap.values());
    const vPast = Array.from(vPastMap.values());
    addHydrationItems(vUp);

    let vHtml = `
      <div class="comm-rec-search-banner">
        <div class="comm-rec-search-banner-info">
          <span>🏪</span>
          <span>Showing tournaments hosted at <strong style="color:#fff;">${escapeHtml(communityState.tournamentsVenueFilter)}</strong> (${vUp.length} upcoming, ${vPast.length} past)</span>
        </div>
        <button type="button" onclick="clearTournamentsVenueFilter()" class="btn btn-outline" style="font-size: 0.75rem; padding: 0.28rem 0.68rem; color: #38bdf8;">✕ Clear Venue Filter</button>
      </div>
    `;
    if (vUp.length > 0) {
      vHtml += `<div class="comm-events-grid" style="margin-bottom: 1.5rem;">${vUp.map(ev => renderTournamentCard(ev, true, userElo)).join('')}</div>`;
    }
    if (vPast.length > 0) {
      vHtml += `<h4 style="color:#cbd5e1; margin: 0 0 0.75rem;">📜 Past Results at Venue</h4><div class="comm-events-grid">${vPast.map(ev => renderTournamentCard(ev, false, userElo)).join('')}</div>`;
    }
    if (vUp.length === 0 && vPast.length === 0) {
      vHtml += `<div class="comm-rec-empty-box"><p style="margin:0; color:#94a3b8;">No upcoming or recent tournaments found at ${escapeHtml(communityState.tournamentsVenueFilter)}.</p></div>`;
    }
    container.innerHTML = vHtml;
    if (upcomingForHydration.length > 0) {
      hydrateUpcomingFieldStats(upcomingForHydration.map(e => e.id), userElo);
    }
    return;
  }

  // -------------------------------------------------------------------------
  // MODE C: SMART CONCIERGE RECOMMENDATION VIEWS
  // -------------------------------------------------------------------------
  const recTab = communityState.recTab || 'for_you';
  let html = '';

  if (recTab === 'for_you') {
    const noiseFiltered = Number(summary.filtered_noise_count || 0);
    const loadingSyncNote = (!recs && communityState.recommendationsLoading)
      ? `<span class="comm-rec-sync-pill"><span class="spinner-mini" style="display:inline-block; width:9px; height:9px; border:1.5px solid rgba(56,189,248,0.3); border-top-color:#38bdf8; border-radius:50%; animation:spin 0.8s linear infinite;"></span> Scanning regional drive range...</span>`
      : '';

    html += `
      <div class="comm-rec-concierge-bar">
        <div class="comm-rec-concierge-left">
          <button type="button" class="comm-rec-loc-chip" onclick="openCommunityLocationModal()" title="Change matchmaking &amp; recommendation location">
            📍 Near <strong>${escapeHtml(locLabel)}</strong> <span style="opacity:0.7;">✎</span>
          </button>
          <span class="comm-rec-meta-chip">🏡 Local &le; ${radMiles} mi</span>
          <span class="comm-rec-meta-chip">🚗 Regional &le; ${maxDriveHrs}h drive</span>
          ${noiseFiltered > 0 ? `<span class="comm-rec-meta-chip comm-rec-clean-chip" title="Casual open play, multi-week leagues &amp; online TTS noise automatically hidden">✨ Noise-Free (${noiseFiltered} casual/leagues hidden)</span>` : ''}
          ${loadingSyncNote}
        </div>
      </div>
    `;

    // SECTION 1: LOCAL SCENE (<= radiusMiles)
    html += `
      <section class="comm-rec-section" id="comm-sec-local">
        <div class="comm-rec-section-head">
          <div>
            <h3 class="comm-rec-section-title">📍 Local Tournaments <span class="comm-rec-count-pill">${localEvents.length}</span></h3>
            <p class="comm-rec-section-sub">Upcoming &amp; live competitive events within ${radMiles} miles of ${escapeHtml(locLabel)}</p>
          </div>
          ${localEvents.length > 6 ? `
            <button type="button" class="btn btn-outline comm-rec-more-btn" onclick="setCommunityRecTab('driveable')">
              View All (${localEvents.length}) →
            </button>
          ` : ''}
        </div>
    `;

    if (localEvents.length === 0) {
      html += `
        <div class="comm-rec-empty-box comm-rec-empty-compact">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;">
            <div style="text-align: left;">
              <strong style="color: #e2e8f0; font-size: 0.88rem;">No upcoming local tournaments inside ${radMiles} miles right now</strong>
              <div style="font-size: 0.78rem; color: #94a3b8; margin-top: 2px;">
                Check out recommended regional GTs, Majors &amp; RTTs within a ${maxDriveHrs}-hour drive right below, or adjust your local radius.
              </div>
            </div>
            <div style="display: flex; gap: 0.45rem; flex-wrap: wrap;">
              <button type="button" class="btn btn-outline" style="font-size: 0.76rem; padding: 0.32rem 0.68rem;" onclick="changeCommunityRadius(${Math.min(100, Math.max(75, radMiles + 25))})">Expand Local Radius</button>
              <button type="button" class="btn btn-outline" style="font-size: 0.76rem; padding: 0.32rem 0.68rem;" onclick="openCommunityLocationModal()">Change City</button>
            </div>
          </div>
        </div>
      `;
    } else {
      const shownLocal = localEvents.slice(0, 6);
      addHydrationItems(shownLocal);
      html += `
        <div class="comm-events-grid">
          ${shownLocal.map(ev => renderTournamentCard(ev, true, userElo)).join('')}
        </div>
      `;
    }
    html += `</section>`;

    // SECTION 2: WORTH THE DRIVE (Up to maxDriveHrs Drive — Majors, GTs & Regional RTTs)
    html += `
      <section class="comm-rec-section" id="comm-sec-driveable">
        <div class="comm-rec-section-head">
          <div>
            <h3 class="comm-rec-section-title">🚗 Worth the Drive <span class="comm-rec-count-pill">${driveableEvents.length}</span></h3>
            <p class="comm-rec-section-sub">Recommended Majors, GTs &amp; active RTTs within ~${maxDriveHrs}h driving distance</p>
          </div>
          <div class="comm-rec-section-actions">
            <div class="comm-drive-pills" aria-label="Max drive time">
              <button type="button" class="comm-drive-pill ${maxDriveHrs === 1 ? 'active' : ''}" onclick="setCommunityMaxDriveHours(1)">1h</button>
              <button type="button" class="comm-drive-pill ${maxDriveHrs === 2 ? 'active' : ''}" onclick="setCommunityMaxDriveHours(2)">2h</button>
              <button type="button" class="comm-drive-pill ${maxDriveHrs === 3 ? 'active' : ''}" onclick="setCommunityMaxDriveHours(3)">3h</button>
            </div>
            ${(localEvents.length + driveableEvents.length) > 0 ? `
              <button type="button" class="btn btn-outline comm-rec-more-btn" onclick="setCommunityRecTab('driveable')">
                All Nearby (${localEvents.length + driveableEvents.length}) →
              </button>
            ` : ''}
          </div>
        </div>
    `;

    if (driveableEvents.length === 0) {
      const nextHrs = maxDriveHrs < 3 ? maxDriveHrs + 1 : 3;
      html += `
        <div class="comm-rec-empty-box comm-rec-empty-compact">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;">
            <div style="text-align: left;">
              <strong style="color: #e2e8f0; font-size: 0.88rem;">${!recs && communityState.recommendationsLoading ? 'Scanning regional highways for driveable Majors & GTs...' : `No additional regional Majors, GTs, or RTTs between ${radMiles} mi and a ${maxDriveHrs}h drive`}</strong>
              <div style="font-size: 0.78rem; color: #94a3b8; margin-top: 2px;">
                ${maxDriveHrs < 3 ? `Expand max drive time to ${nextHrs} hours to include wider regional GTs and Majors.` : 'Explore Premier Majors across the circuit below.'}
              </div>
            </div>
            ${maxDriveHrs < 3 ? `
              <button type="button" class="btn btn-primary" style="font-size: 0.76rem; padding: 0.35rem 0.75rem;" onclick="setCommunityMaxDriveHours(${nextHrs})">
                🚗 Show up to ${nextHrs}h Drive
              </button>
            ` : ''}
          </div>
        </div>
      `;
    } else {
      const shownDrive = driveableEvents.slice(0, 6);
      addHydrationItems(shownDrive);
      html += `
        <div class="comm-events-grid">
          ${shownDrive.map(ev => renderTournamentCard(ev, true, userElo)).join('')}
        </div>
      `;
    }
    html += `</section>`;

    // SECTION 3: PREMIER MAJORS & SUPER MAJORS CIRCUIT
    const shownMajors = destinationMajors.slice(0, 6);
    addHydrationItems(shownMajors);
    html += `
      <section class="comm-rec-section" id="comm-sec-majors">
        <div class="comm-rec-section-head">
          <div>
            <h3 class="comm-rec-section-title">👑 Major Events &amp; Premier Circuit <span class="comm-rec-count-pill">${destinationMajors.length}</span></h3>
            <p class="comm-rec-section-sub">${majorsScope === 'global' ? 'Flagship Super Majors, Majors &amp; large GTs worldwide' : 'Flagship Super Majors &amp; Majors prioritized for your region'}</p>
          </div>
          <div class="comm-rec-section-actions">
            <div class="comm-drive-pills" aria-label="Majors scope">
              <button type="button" class="comm-drive-pill ${majorsScope === 'regional' ? 'active' : ''}" onclick="setCommunityMajorsScope('regional')">Regional</button>
              <button type="button" class="comm-drive-pill ${majorsScope === 'global' ? 'active' : ''}" onclick="setCommunityMajorsScope('global')">Worldwide</button>
            </div>
            ${destinationMajors.length > 6 ? `
              <button type="button" class="btn btn-outline comm-rec-more-btn" onclick="setCommunityRecTab('majors')">
                Explore All ${destinationMajors.length} Majors →
              </button>
            ` : ''}
          </div>
        </div>
        ${shownMajors.length > 0 ? `
          <div class="comm-events-grid">
            ${shownMajors.map(ev => renderTournamentCard(ev, true, userElo)).join('')}
          </div>
        ` : `
          <div class="comm-rec-empty-box comm-rec-empty-compact">
            <span style="color: #94a3b8; font-size: 0.84rem;">No upcoming Premier Majors found in this scope. Switch to Worldwide to view international events.</span>
          </div>
        `}
      </section>
    `;

    if (pastResults.length > 0) {
      html += `
        <div class="comm-rec-past-cta">
          <div style="font-size: 0.83rem; color: #cbd5e1;">
            📜 Want to inspect recent local meta, winning factions &amp; army lists?
          </div>
          <button type="button" class="btn btn-outline" style="font-size: 0.78rem; padding: 0.36rem 0.8rem;" onclick="setCommunityRecTab('past')">
            View ${pastResults.length} Past Tournament Results →
          </button>
        </div>
      `;
    }
  } else if (recTab === 'driveable') {
    const combinedMap = new Map();
    localEvents.forEach(ev => { if (ev && ev.id) combinedMap.set(ev.id, ev); });
    driveableEvents.forEach(ev => { if (ev && ev.id && !combinedMap.has(ev.id)) combinedMap.set(ev.id, ev); });
    let combined = Array.from(combinedMap.values());

    const sub = communityState.localDriveSubFilter || 'all';
    if (sub === 'gt_major') {
      combined = combined.filter(ev => ['super_major', 'major', 'gt'].includes(ev.tier) || Number(ev.total_players || 0) >= 28);
    } else if (sub === 'rtt') {
      combined = combined.filter(ev => !['super_major', 'major', 'gt'].includes(ev.tier));
    } else if (sub === 'weekend') {
      combined = combined.filter(ev => isDateInWeekend((ev.event_date || '').slice(0, 10), 0));
    } else if (sub === 'next_weekend') {
      combined = combined.filter(ev => isDateInWeekend((ev.event_date || '').slice(0, 10), 1));
    }

    const sortBy = communityState.localDriveSort || 'score';
    if (sortBy === 'date') {
      combined.sort((a, b) => String(a.event_date || '9999').localeCompare(String(b.event_date || '9999')));
    } else if (sortBy === 'distance') {
      combined.sort((a, b) => Number(a.distance_miles ?? 9999) - Number(b.distance_miles ?? 9999));
    } else {
      combined.sort((a, b) => Number(b.match_score || 0) - Number(a.match_score || 0));
    }

    addHydrationItems(combined);

    html += `
      <div class="comm-rec-subbar">
        <div class="comm-rec-subpills">
          <button type="button" class="comm-drive-pill ${sub === 'all' ? 'active' : ''}" onclick="setLocalDriveSubFilter('all')">All (${combinedMap.size})</button>
          <button type="button" class="comm-drive-pill ${sub === 'gt_major' ? 'active' : ''}" onclick="setLocalDriveSubFilter('gt_major')">🏆 Majors &amp; GTs</button>
          <button type="button" class="comm-drive-pill ${sub === 'rtt' ? 'active' : ''}" onclick="setLocalDriveSubFilter('rtt')">⚔️ RTTs</button>
          <button type="button" class="comm-drive-pill ${sub === 'weekend' ? 'active' : ''}" onclick="setLocalDriveSubFilter('weekend')">⚡ This Weekend</button>
          <button type="button" class="comm-drive-pill ${sub === 'next_weekend' ? 'active' : ''}" onclick="setLocalDriveSubFilter('next_weekend')">📅 Next Weekend</button>
        </div>
        <div class="comm-rec-subpills">
          <span class="comm-drive-label">Sort:</span>
          <button type="button" class="comm-drive-pill ${sortBy === 'score' ? 'active' : ''}" onclick="setLocalDriveSort('score')">✨ Best Match</button>
          <button type="button" class="comm-drive-pill ${sortBy === 'distance' ? 'active' : ''}" onclick="setLocalDriveSort('distance')">🚗 Closest</button>
          <button type="button" class="comm-drive-pill ${sortBy === 'date' ? 'active' : ''}" onclick="setLocalDriveSort('date')">📅 Soonest</button>
        </div>
      </div>
    `;

    if (combined.length === 0) {
      html += `
        <div class="comm-rec-empty-box">
          <div style="font-size: 1.8rem; margin-bottom: 0.45rem;">🚗</div>
          <h4 style="color: #fff; margin: 0 0 0.35rem;">No Matching Tournaments within a ${maxDriveHrs}-Hour Drive</h4>
          <p style="font-size: 0.82rem; color: #94a3b8; max-width: 440px; margin: 0 auto 1rem;">
            Try clearing the sub-filter or increasing your Max Drive limit to discover more regional GTs and RTTs.
          </p>
          <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
            ${sub !== 'all' ? `<button type="button" class="btn btn-outline" onclick="setLocalDriveSubFilter('all')">Show All Nearby</button>` : ''}
            ${maxDriveHrs < 3 ? `<button type="button" class="btn btn-primary" onclick="setCommunityMaxDriveHours(3)">Expand to 3h Drive</button>` : ''}
          </div>
        </div>
      `;
    } else {
      html += `<div class="comm-events-grid">${combined.map(ev => renderTournamentCard(ev, true, userElo)).join('')}</div>`;
    }
  } else if (recTab === 'majors') {
    const tierFilter = communityState.majorsTierFilter || 'all';
    let filteredMajors = destinationMajors;
    if (tierFilter === 'super_major') {
      filteredMajors = destinationMajors.filter(ev => ev.tier === 'super_major');
    } else if (tierFilter === 'major') {
      filteredMajors = destinationMajors.filter(ev => ev.tier === 'major');
    } else if (tierFilter === 'gt') {
      filteredMajors = destinationMajors.filter(ev => ev.tier === 'gt');
    }

    addHydrationItems(filteredMajors.slice(0, 18));

    html += `
      <div class="comm-rec-subbar">
        <div class="comm-rec-subpills">
          <button type="button" class="comm-drive-pill ${tierFilter === 'all' ? 'active' : ''}" onclick="setMajorsTierFilter('all')">All (${destinationMajors.length})</button>
          <button type="button" class="comm-drive-pill ${tierFilter === 'super_major' ? 'active' : ''}" onclick="setMajorsTierFilter('super_major')">👑 Super Majors</button>
          <button type="button" class="comm-drive-pill ${tierFilter === 'major' ? 'active' : ''}" onclick="setMajorsTierFilter('major')">🌟 Majors</button>
          <button type="button" class="comm-drive-pill ${tierFilter === 'gt' ? 'active' : ''}" onclick="setMajorsTierFilter('gt')">🏆 Large GTs</button>
        </div>
        <div style="font-size: 0.78rem; color: #94a3b8;">
          Showing <strong style="color:#e2e8f0;">${majorsScope === 'global' ? 'Worldwide Circuit' : 'Regional Circuit'}</strong>
        </div>
      </div>
    `;

    if (filteredMajors.length === 0) {
      html += `
        <div class="comm-rec-empty-box">
          <div style="font-size: 1.8rem; margin-bottom: 0.45rem;">👑</div>
          <h4 style="color: #fff; margin: 0 0 0.35rem;">No Matching Premier Majors Found</h4>
          <p style="font-size: 0.82rem; color: #94a3b8; max-width: 440px; margin: 0 auto 1rem;">
            Switch scope to Worldwide or show All Major tiers to explore the full tournament circuit.
          </p>
          <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
            ${tierFilter !== 'all' ? `<button type="button" class="btn btn-outline" onclick="setMajorsTierFilter('all')">Show All Tiers</button>` : ''}
            ${majorsScope !== 'global' ? `<button type="button" class="btn btn-primary" onclick="setCommunityMajorsScope('global')">🌎 Switch to Worldwide</button>` : ''}
          </div>
        </div>
      `;
    } else {
      html += `<div class="comm-events-grid">${filteredMajors.map(ev => renderTournamentCard(ev, true, userElo)).join('')}</div>`;
    }
  } else if (recTab === 'past') {
    html += `
      <section class="comm-rec-section">
        <div class="comm-rec-section-head">
          <div>
            <h3 class="comm-rec-section-title">📜 Completed Regional &amp; Local Tournaments <span class="comm-rec-count-pill">${pastResults.length}</span></h3>
            <p class="comm-rec-section-sub">Inspect final standings, Elo field ratings, and submitted army lists</p>
          </div>
        </div>
        ${pastResults.length === 0 ? `
          <div class="comm-rec-empty-box">
            <div style="font-size: 1.8rem; margin-bottom: 0.45rem;">📜</div>
            <h4 style="color: #fff; margin: 0 0 0.35rem;">No Completed Tournaments Found Nearby</h4>
            <p style="font-size: 0.82rem; color: #94a3b8; max-width: 440px; margin: 0 auto 1rem;">
              Use the search bar above to look up any historical tournament by name or city.
            </p>
          </div>
        ` : `
          <div class="comm-events-grid">
            ${pastResults.map(ev => renderTournamentCard(ev, false, userElo)).join('')}
          </div>
        `}
      </section>
    `;
  }

  container.innerHTML = html;

  if (upcomingForHydration.length > 0) {
    hydrateUpcomingFieldStats(upcomingForHydration.map(e => e.id), userElo);
  }
}

function getLocalIsoDateStr(d = new Date()) {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

function isTournamentEnded(ev) {
  if (!ev) return false;
  if (typeof window.isEventEnded === 'function') {
    return window.isEventEnded(ev);
  }
  if (
    ev.is_ended === true ||
    ev.isEnded === true ||
    ev.ended === true ||
    ev.status?.ended === true ||
    ev.status?.isEnded === true ||
    ev.status === 'ended' ||
    ev.status === 'completed' ||
    ev.raw_json?.isEnded === true ||
    ev.raw_json?.ended === true ||
    ev.raw_json?.status?.ended === true
  ) {
    return true;
  }
  const todayStr = getLocalIsoDateStr();
  const rawEnd = ev.end_date || ev.endDate || ev.raw_json?.endDate || ev.raw_json?.end_date || '';
  if (rawEnd) {
    const endMs = Date.parse(rawEnd);
    if (!isNaN(endMs)) {
      if (String(rawEnd).includes('T') || String(rawEnd).includes(':')) {
        if (endMs < Date.now()) return true;
      } else {
        const endDateStr = String(rawEnd).slice(0, 10);
        if (endDateStr < todayStr) return true;
      }
    }
  }
  const rawStart = ev.event_date || ev.eventDate || ev.start_date || ev.startDate || '';
  const startDateStr = String(rawStart).slice(0, 10);
  const numRounds = Number(ev.num_rounds || ev.numberOfRounds || ev.raw_json?.numberOfRounds || 0);
  const currentRound = Number(ev.current_round || ev.currentRound || ev.raw_json?.currentRound || 0);
  const endDateStr = rawEnd ? String(rawEnd).slice(0, 10) : '';
  const isSingleDay = !endDateStr || endDateStr === startDateStr || (numRounds > 0 && numRounds <= 3);

  if (startDateStr) {
    if (isSingleDay && startDateStr < todayStr) {
      return true;
    }
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalIsoDateStr(yesterday);
    if (startDateStr < yesterdayStr) {
      return true;
    }
  }

  if (numRounds > 0 && currentRound >= numRounds && (ev.matches?.length > 0 || ev.total_matches > 0)) {
    return true;
  }
  return false;
}

function isTournamentOngoing(ev) {
  if (!ev || isTournamentEnded(ev)) return false;

  const currentRound = Number(
    ev.current_round || ev.currentRound || ev.activeRound ||
    ev.raw_json?.currentRound || ev.raw_json?.current_round || 0
  );
  const matchesCount = Number(ev.matches_count || ev.total_matches || 0);
  const hasPairings = currentRound >= 1 || matchesCount > 0 || (Array.isArray(ev.matches) && ev.matches.length > 0);

  const bcpStarted = Boolean(
    ev.started === true ||
    ev.isStarted === true ||
    ev.status?.started === true ||
    ev.status?.isStarted === true ||
    ev.status === 'ongoing' ||
    ev.status === 'in_progress' ||
    ev.status === 'live' ||
    ev.raw_json?.started === true ||
    ev.raw_json?.isStarted === true ||
    ev.raw_json?.status === 'ongoing' ||
    ev.raw_json?.status === 'in_progress' ||
    ev.raw_json?.status?.started === true ||
    ev.raw_json?.status?.isStarted === true
  );

  const todayStr = getLocalIsoDateStr();
  const rawStart = ev.event_date || ev.eventDate || ev.start_date || ev.startDate || '';
  const startDateStr = String(rawStart).slice(0, 10);

  // Future events without pairings are never ongoing
  if (startDateStr && startDateStr > todayStr && !hasPairings) {
    return false;
  }

  // A tournament is ongoing only if pairings/rounds have begun or explicit started flags are set
  return Boolean(hasPairings || bcpStarted || ev.is_started === true || ev.is_ongoing === true);
}
window.isTournamentEnded = isTournamentEnded;
window.isTournamentOngoing = isTournamentOngoing;

function renderTournamentCard(ev, isUpcomingSection, userElo) {
  const isEnded = isTournamentEnded(ev) || !isUpcomingSection;
  const isOngoing = !isEnded && isTournamentOngoing(ev);
  const isRegistrationOpen = isUpcomingSection && !isEnded && !isOngoing;

  const dateDisplay = formatShortEventDateRange(ev);
  const tierMeta = getTierBadgeMeta(ev);
  const locInfo = getCommunityEventLocationInfo(ev);
  const locPrimary = (locInfo.venue && locInfo.cityStateCountry && locInfo.venue.toLowerCase() !== locInfo.cityStateCountry.toLowerCase() && !locInfo.cityStateCountry.toLowerCase().startsWith(locInfo.venue.toLowerCase()))
    ? `${locInfo.venue} • ${locInfo.cityStateCountry}`
    : (locInfo.cityStateCountry || locInfo.venue || 'Unspecified Location');
  const rawSub = locInfo.streetAddress || (locInfo.addressLine && locInfo.addressLine !== locInfo.cityStateCountry ? locInfo.addressLine : '');
  const locSub = (rawSub && !locPrimary.toLowerCase().includes(rawSub.toLowerCase())) ? rawSub : '';
  const locTooltip = locInfo.fullAddressLine || locInfo.displayLabel || locPrimary;
  const fieldAvg = ev.avg_field_elo ? Math.round(Number(ev.avg_field_elo)) : null;
  const topSeed = ev.top_seed_elo ? Math.round(Number(ev.top_seed_elo)) : null;

  const distNum = ev.distance_miles != null && !isNaN(Number(ev.distance_miles)) ? Number(ev.distance_miles) : null;
  const driveMins = ev.drive_minutes != null && !isNaN(Number(ev.drive_minutes)) ? Number(ev.drive_minutes) : null;
  const driveLabel = ev.drive_label || '';
  const localLimit = Number(communityState.radiusMiles || 50) + 2;

  let travelBadgeHtml = '';
  if (distNum != null) {
    if (ev.is_local || distNum <= localLimit) {
      const distTxt = distNum < 10 ? distNum.toFixed(1) : String(Math.round(distNum));
      const shortDrive = (driveMins != null && driveMins <= 75 && driveLabel) ? ` • ${driveLabel.replace(/\s*drive$/i, '')}` : '';
      travelBadgeHtml = `
        <span class="badge comm-travel-badge comm-travel-local" title="Local tournament (${distTxt} miles)">
          📍 ${distTxt} mi${escapeHtml(shortDrive)}
        </span>
      `;
    } else if (driveMins != null && driveMins <= 210 && driveLabel) {
      travelBadgeHtml = `
        <span class="badge comm-travel-badge comm-travel-drive" title="Estimated ${escapeHtml(driveLabel)} (${Math.round(distNum)} straight-line miles)">
          🚗 ${escapeHtml(driveLabel)} • ${Math.round(distNum)} mi
        </span>
      `;
    } else {
      travelBadgeHtml = `
        <span class="badge comm-travel-badge comm-travel-fly" title="Destination tournament (${Math.round(distNum).toLocaleString()} miles)">
          ✈️ ${Math.round(distNum).toLocaleString()} mi
        </span>
      `;
    }
  }

  // Delta calculation relative to user Elo
  let deltaMarkup = '';
  if (fieldAvg && userElo) {
    const diff = Math.round(userElo - fieldAvg);
    if (diff > 0) {
      deltaMarkup = `<span style="font-size: 0.72rem; color: #10b981; font-weight: 700; margin-left: 4px; white-space: nowrap;" title="You are rated +${diff} above this tournament's average field">(+${diff})</span>`;
    } else if (diff < 0) {
      deltaMarkup = `<span style="font-size: 0.72rem; color: #f43f5e; font-weight: 700; margin-left: 4px; white-space: nowrap;" title="This field average is ${Math.abs(diff)} points above your current Elo">(${diff})</span>`;
    } else {
      deltaMarkup = `<span style="font-size: 0.72rem; color: #94a3b8; font-weight: 700; margin-left: 4px; white-space: nowrap;" title="Your Elo is identical to this tournament's average field">(Even)</span>`;
    }
  }

  const isRegistered = Boolean(ev.is_registered);
  const numTickets = Number(ev.num_tickets || 0);
  const totalPlayers = Number(ev.total_players || 0);
  const isSoldOut = Boolean(ev.is_sold_out) || (numTickets > 0 && totalPlayers >= numTickets);
  let ticketPrice = Number(ev.ticket_price || 0);
  if (ticketPrice >= 500) ticketPrice = ticketPrice / 100;
  const isNativeEv = Boolean(ev.is_native_event || ev.source_platform === 'omnitactica' || /^es[-_]/i.test(String(ev.id || '')));
  const isBcpEv = !isNativeEv && ((typeof isBcpEventId === 'function') ? isBcpEventId(ev.id) : !String(ev.id || '').includes(':'));
  const usingOnlineReg = (isNativeEv || isBcpEv) && (ev.using_online_reg !== false);
  const externalUrl = isNativeEv
    ? (ev.external_ticket_url || null)
    : (ev.external_url || (!isBcpEv && typeof getPlatformExternalEventUrl === 'function' ? getPlatformExternalEventUrl(ev.id, ev) : null));
  const hasPrimaryGetTickets = isRegistrationOpen && !isRegistered && !isSoldOut && !usingOnlineReg && Boolean(externalUrl);
  const currentRound = Number(ev.current_round || ev.currentRound || 0);

  let statusBadgeHtml = '';
  if (isOngoing) {
    const roundLabel = currentRound > 0 ? `🔥 R${currentRound} Live` : '🔥 Live';
    statusBadgeHtml = `
      <span class="badge" style="background: rgba(245,158,11,0.16); color: #fbbf24; border: 1px solid rgba(245,158,11,0.4); font-size: 0.69rem; font-weight: 800;">
        ${roundLabel}
      </span>
    `;
  } else if (!isEnded && ev.countdown_label && ev.countdown_label !== 'Upcoming') {
    const isSoon = /Today|Tomorrow|Weekend|In [1-6]d/i.test(ev.countdown_label);
    statusBadgeHtml = `
      <span class="badge" style="background: ${isSoon ? 'rgba(16,185,129,0.14)' : 'rgba(148,163,184,0.1)'}; color: ${isSoon ? '#34d399' : '#cbd5e1'}; border: 1px solid ${isSoon ? 'rgba(16,185,129,0.32)' : 'rgba(148,163,184,0.22)'}; font-size: 0.69rem; font-weight: 700;">
        ${escapeHtml(ev.countdown_label)}
      </span>
    `;
  } else if (isEnded) {
    statusBadgeHtml = `
      <span class="badge" style="background: rgba(148,163,184,0.12); color: #cbd5e1; border: 1px solid rgba(148,163,184,0.25); font-size: 0.69rem;">
        ✓ Completed
      </span>
    `;
  }

  // Smart recommendation "Why" chips (concise, non-redundant highlights)
  let whyChipsHtml = '';
  if (!isEnded && Array.isArray(ev.why_reasons) && ev.why_reasons.length > 0) {
    const filteredReasons = ev.why_reasons.filter(r => {
      const rl = String(r || '').toLowerCase();
      // Skip duplicating raw drive string if already shown in travelBadgeHtml
      if (travelBadgeHtml && rl.includes('drive') && rl.includes('mi')) return false;
      return Boolean(rl);
    }).slice(0, 3);
    if (filteredReasons.length > 0) {
      whyChipsHtml = `
        <div class="comm-why-chips">
          ${filteredReasons.map(r => `<span class="comm-why-chip">${escapeHtml(r)}</span>`).join('')}
        </div>
      `;
    }
  }

  let fieldAvgFallbackHtml = '<span style="color: #64748b; font-weight: 500; font-size: 0.78rem;">Unrated Field</span>';
  if (isRegistrationOpen) {
    if (totalPlayers > 0) {
      fieldAvgFallbackHtml = `<span class="field-avg-computing" style="color: #38bdf8; font-weight: 600; font-size: 0.76rem; display: inline-flex; align-items: center; gap: 4px;"><span class="spinner-mini" style="display: inline-block; width: 9px; height: 9px; border: 1.5px solid rgba(56,189,248,0.25); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite;"></span><span>Computing Field...</span></span>`;
    } else {
      fieldAvgFallbackHtml = '<span style="color: #64748b; font-weight: 500; font-size: 0.78rem;">Registration Open</span>';
    }
  } else if (isOngoing) {
    if (totalPlayers > 0) {
      fieldAvgFallbackHtml = `<span class="field-avg-computing" style="color: #38bdf8; font-weight: 600; font-size: 0.76rem; display: inline-flex; align-items: center; gap: 4px;"><span class="spinner-mini" style="display: inline-block; width: 9px; height: 9px; border: 1.5px solid rgba(56,189,248,0.25); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite;"></span><span>Computing Field...</span></span>`;
    } else {
      fieldAvgFallbackHtml = '<span style="color: #f59e0b; font-weight: 600; font-size: 0.78rem;">In Progress</span>';
    }
  }

  const capPct = (numTickets > 0 && totalPlayers > 0) ? Math.min(100, Math.round((totalPlayers / numTickets) * 100)) : 0;
  const playersLabel = numTickets > 0
    ? `👥 ${totalPlayers} / ${numTickets} Spots${isSoldOut ? ' (Full)' : ''}`
    : `👥 ${totalPlayers} Competitor${totalPlayers === 1 ? '' : 's'}`;
  const roundsCount = Number(ev.num_rounds || 0);
  const roundsLabel = roundsCount > 0 ? `⚔️ ${roundsCount} Rounds` : (ev.tier === 'super_major' || ev.tier === 'major' ? '⚔️ Multi-Day Major' : '⚔️ Tournament');

  const cardPlatBadge = (typeof getPlatformBadgeHtml === 'function') ? getPlatformBadgeHtml(ev.id, ev) : '';
  const cardFmtBadge = (typeof getEventFormatBadgeHtml === 'function') ? getEventFormatBadgeHtml(ev) : '';
  const cardExtUrl = (typeof getPlatformExternalEventUrl === 'function') ? getPlatformExternalEventUrl(ev.id, ev) : `https://www.bestcoastpairings.com/event/${encodeURIComponent(ev.id)}`;
  const cardPlatName = (typeof getPlatformDisplayName === 'function') ? getPlatformDisplayName(ev.id, ev) : 'BCP';

  return `
    <div class="comm-event-card comm-tier-${escapeHtml(ev.tier || 'rtt')}">
      <div class="comm-event-card-top">
        <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap;">
          <span class="badge" style="background: ${tierMeta.bg}; color: ${tierMeta.color}; border: 1px solid ${tierMeta.border}; font-size: 0.68rem; font-weight: 800; letter-spacing: 0.03em;">
            ${tierMeta.label}
          </span>
          <span class="badge" style="background: ${!isEnded ? 'rgba(56,189,248,0.11)' : 'rgba(255,255,255,0.06)'}; color: ${!isEnded ? '#7dd3fc' : '#94a3b8'}; border: 1px solid ${!isEnded ? 'rgba(56,189,248,0.28)' : 'rgba(255,255,255,0.1)'}; font-size: 0.7rem; font-weight: 700;">
            📅 ${escapeHtml(dateDisplay)}
          </span>
          ${cardPlatBadge}
          ${cardFmtBadge}
        </div>
        <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap;">
          ${travelBadgeHtml}
          ${statusBadgeHtml}
        </div>
      </div>

      <h4 class="comm-event-card-title" title="${escapeHtml(ev.name || 'Warhammer Tournament')}">
        ${escapeHtml(ev.name || 'Warhammer 40k Tournament')}
      </h4>

      <div style="font-size: 0.78rem; color: var(--text-secondary); margin-bottom: ${locSub ? '0.16rem' : '0.6rem'}; display: flex; align-items: center; gap: 6px;" title="${escapeHtml(locTooltip)}">
        <span>📍</span>
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600;">${escapeHtml(locPrimary)}</span>
      </div>
      ${locSub ? `
        <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 0.6rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(locSub)}">
          🏛️ ${escapeHtml(locSub)}
        </div>
      ` : ''}

      ${whyChipsHtml}

      <!-- Field Avg Elo, Top Seed & Capacity Box -->
      <div class="comm-event-stats-box">
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.81rem; gap: 6px;">
          <span style="color: #94a3b8; white-space: nowrap;">⭐ Field Avg:</span>
          <span id="field-avg-${escapeHtml(ev.id)}" style="font-weight: 800; color: #fff; font-family: monospace; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;">
            ${fieldAvg ? `${typeof renderEloBadgePill === 'function' ? renderEloBadgePill(fieldAvg) : `${fieldAvg} Elo`} ${deltaMarkup}` : fieldAvgFallbackHtml}
          </span>
        </div>
        <div id="top-seed-container-${escapeHtml(ev.id)}" style="${topSeed ? '' : 'display: none;'}">
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.77rem; gap: 6px;">
            <span style="color: #94a3b8; white-space: nowrap;">👑 Top Seed:</span>
            <span id="top-seed-val-${escapeHtml(ev.id)}" style="font-weight: 700; color: #f59e0b; font-family: monospace; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;">${topSeed ? (typeof renderEloBadgePill === 'function' ? renderEloBadgePill(topEloOrSeed(topSeed)) : `${topSeed} Elo`) : ''}</span>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: #94a3b8; margin-top: 2px;">
          <span id="competitors-count-${escapeHtml(ev.id)}">${escapeHtml(playersLabel)}</span>
          <span>${escapeHtml(roundsLabel)}</span>
        </div>
        ${(numTickets > 0 && !isEnded) ? `
          <div class="comm-cap-bar" title="${capPct}% capacity filled (${totalPlayers}/${numTickets})">
            <div class="comm-cap-fill ${capPct >= 90 ? 'cap-hot' : (capPct >= 65 ? 'cap-warm' : '')}" style="width: ${capPct}%;"></div>
          </div>
        ` : ''}
      </div>

      <!-- Actions -->
      <div style="margin-top: auto; display: flex; flex-direction: column;">
        ${isRegistrationOpen ? (() => {
          if (isRegistered) {
            if (isNativeEv) {
              return `
                <button class="btn" style="width: 100%; font-size: 0.8rem; padding: 0.45rem 0.75rem; justify-content: center; font-weight: 700; background: rgba(16, 185, 129, 0.16); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); margin-bottom: 0.45rem;" onclick="openEventRegistrationModal('${escapeHtml(ev.id)}')">
                  ✅ Registered • Edit List / Entry
                </button>
              `;
            }
            return `
              <button class="btn" disabled style="width: 100%; font-size: 0.8rem; padding: 0.45rem 0.75rem; justify-content: center; font-weight: 700; background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35); cursor: default; margin-bottom: 0.45rem;">
                ✅ Registered
              </button>
            `;
          } else if (isSoldOut) {
            return `
              <button class="btn btn-secondary" disabled style="width: 100%; font-size: 0.8rem; padding: 0.45rem 0.75rem; justify-content: center; font-weight: 600; opacity: 0.65; cursor: not-allowed; margin-bottom: 0.45rem;" title="Tournament has reached maximum capacity">
                🚫 Sold Out (${totalPlayers}/${numTickets})
              </button>
            `;
          } else if (isNativeEv && usingOnlineReg) {
            const feeTxt = ticketPrice > 0 ? `$${ticketPrice % 1 === 0 ? ticketPrice.toFixed(0) : ticketPrice.toFixed(2)} Entry` : 'Free';
            return `
              <button class="btn btn-success" style="width: 100%; font-size: 0.8rem; padding: 0.45rem 0.75rem; justify-content: center; font-weight: 700; background: linear-gradient(135deg, #0ea5e9, #10b981); color: #fff; border: none; margin-bottom: 0.45rem;" onclick="openEventRegistrationModal('${escapeHtml(ev.id)}')">
                ⚡ Register Now (${feeTxt})
              </button>
            `;
          } else if (usingOnlineReg) {
            if (ticketPrice > 0) {
              return `
                <a href="https://www.bestcoastpairings.com/event/${encodeURIComponent(ev.id)}?checkout=true" target="_blank" rel="noopener" class="btn btn-warning" style="width: 100%; font-size: 0.8rem; padding: 0.45rem 0.75rem; justify-content: center; font-weight: 800; background: linear-gradient(135deg, #f59e0b, #d97706); color: #0f172a; text-decoration: none; border: none; margin-bottom: 0.45rem; box-sizing: border-box;" title="Purchase ticket directly via Best Coast Pairings Checkout">
                  💳 $${ticketPrice.toFixed(2)} • Buy Ticket ↗
                </a>
              `;
            } else {
              return `
                <button class="btn btn-success" style="width: 100%; font-size: 0.8rem; padding: 0.45rem 0.75rem; justify-content: center; font-weight: 700; background: linear-gradient(135deg, #10b981, #059669); color: #fff; border: none; margin-bottom: 0.45rem;" onclick="openEventRegistrationModal('${escapeHtml(ev.id)}')">
                  🎟️ Register (Free)
                </button>
              `;
            }
          } else if (externalUrl) {
            return `
              <a href="${escapeHtml(externalUrl)}" target="_blank" rel="noopener" class="btn btn-primary" style="width: 100%; font-size: 0.8rem; padding: 0.45rem 0.75rem; justify-content: center; font-weight: 700; text-decoration: none; margin-bottom: 0.45rem; box-sizing: border-box;">
                ${isBcpEv ? '🎟️ Get Tickets ↗' : `🎟️ Register on ${escapeHtml(cardPlatName)} ↗`}
              </a>
            `;
          } else {
            return `
              <button class="btn btn-secondary" disabled style="width: 100%; font-size: 0.8rem; padding: 0.45rem 0.75rem; justify-content: center; font-weight: 600; opacity: 0.65; cursor: default; margin-bottom: 0.45rem;" title="Organizer handles registration manually in-store">
                🔒 In-Store / TO Only
              </button>
            `;
          }
        })() : (isOngoing && isRegistered ? `
          <div style="width: 100%; font-size: 0.76rem; padding: 0.35rem 0.6rem; justify-content: center; font-weight: 700; background: rgba(16, 185, 129, 0.12); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; margin-bottom: 0.45rem; text-align: center; box-sizing: border-box;">
            ✅ You are registered &amp; competing
          </div>
        ` : '')}
        <div class="comm-event-card-actions-row">
          <button class="btn btn-primary" style="flex: 1; font-size: 0.78rem; padding: 0.45rem 0.7rem; justify-content: center; font-weight: 700; ${isOngoing ? 'background: linear-gradient(135deg, #0284c7, #0369a1); box-shadow: 0 0 10px rgba(56,189,248,0.3);' : ''}" onclick="openEventModal('${escapeHtml(ev.id)}', false${isOngoing ? ", 'matches'" : ''})">
            ${isOngoing ? '⚔️ Live Pairings' : (isEnded ? '📋 Results & Placings' : '📋 Roster & Details')}
          </button>
          ${locInfo.hasLocation ? `
            <button type="button" class="btn btn-outline" style="font-size: 0.76rem; padding: 0.45rem 0.55rem; color: #38bdf8; border-color: rgba(56,189,248,0.35);" onclick="event.stopPropagation(); openEventVenueMapModal('${escapeHtml(ev.id)}')" title="View Venue Address & Interactive Map">
              🗺️ Map
            </button>
          ` : ''}
          ${isNativeEv ? `
            <button type="button" class="btn btn-outline" style="font-size: 0.76rem; padding: 0.45rem 0.6rem; color: #67e8f9; border-color: rgba(6,182,212,0.4);" onclick="event.stopPropagation(); typeof copyStudioShareLink === 'function' && copyStudioShareLink('${escapeHtml(ev.id)}')" title="Copy Shareable Event Link">
              🔗 Share
            </button>
            ${externalUrl ? `<a href="${escapeHtml(externalUrl)}" target="_blank" rel="noopener" class="btn btn-outline" style="font-size: 0.76rem; padding: 0.45rem 0.6rem; color: #fbbf24;" title="Store Ticket Checkout">💳 Tickets ↗</a>` : ''}
          ` : `
            <a href="${escapeHtml(cardExtUrl)}" target="_blank" rel="noopener" class="btn btn-outline" style="font-size: 0.76rem; padding: 0.45rem 0.6rem; color: #94a3b8;" title="View on ${escapeHtml(cardPlatName)}">
              🔗 ${escapeHtml(cardPlatName)}
            </a>
          `}
          ${(isBcpEv && externalUrl && !hasPrimaryGetTickets) ? `
            <a href="${escapeHtml(externalUrl)}" target="_blank" rel="noopener" class="btn btn-outline" style="font-size: 0.76rem; padding: 0.45rem 0.6rem; color: #94a3b8;" title="Organizer Website / Tickets">
              🌐 Web
            </a>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

function topEloOrSeed(val) {
  return val;
}

/**
 * Asynchronously loads field stats (average Elo, top seed Elo, enrolled players) for upcoming tournaments
 */
async function hydrateUpcomingFieldStats(eventIds, userElo) {
  if (!eventIds || eventIds.length === 0) return;
  if (!communityState.fieldStatsHydrating) {
    communityState.fieldStatsHydrating = new Set();
  }

  const uniqueIds = Array.from(new Set(eventIds.filter(Boolean)));
  const toFetch = uniqueIds.filter(id => !communityState.fieldStatsHydrating.has(id)).slice(0, 25);
  if (toFetch.length === 0) return;

  toFetch.forEach(id => communityState.fieldStatsHydrating.add(id));

  try {
    const res = await window.api.getEventsFieldStats(toFetch);
    if (!res || !res.success || !res.stats) return;

    const stats = res.stats;
    Object.keys(stats).forEach(eid => {
      const data = stats[eid];
      if (!data) return;

      const patchEventRecord = (arr) => {
        if (!Array.isArray(arr)) return null;
        const found = arr.find(e => e && String(e.id) === String(eid));
        if (found) {
          if (data.avg_field_elo != null) found.avg_field_elo = data.avg_field_elo;
          if (data.top_seed_elo != null) found.top_seed_elo = data.top_seed_elo;
          if (data.total_enrolled != null && data.total_enrolled > (found.total_players || 0)) {
            found.total_players = data.total_enrolled;
          }
        }
        return found;
      };

      const matchedEv =
        patchEventRecord(communityState.recommendations?.local_events) ||
        patchEventRecord(communityState.recommendations?.driveable_events) ||
        patchEventRecord(communityState.recommendations?.destination_majors) ||
        patchEventRecord(communityState.recommendations?.top_picks) ||
        patchEventRecord(communityState.searchResults?.upcoming) ||
        patchEventRecord(communityState.overview?.events_upcoming);

      // Update DOM element for Field Avg
      const avgEl = document.getElementById(`field-avg-${eid}`);
      if (avgEl) {
        if (data.avg_field_elo != null && data.rated_players_count > 0) {
          const avg = Math.round(Number(data.avg_field_elo));
          let delta = '';
          if (userElo) {
            const diff = Math.round(userElo - avg);
            if (diff > 0) {
              delta = `<span style="font-size: 0.72rem; color: #10b981; font-weight: 700; margin-left: 4px; white-space: nowrap;" title="You are rated +${diff} above this tournament's average field">(+${diff})</span>`;
            } else if (diff < 0) {
              delta = `<span style="font-size: 0.72rem; color: #f43f5e; font-weight: 700; margin-left: 4px; white-space: nowrap;" title="This field average is ${Math.abs(diff)} points above your current Elo">(${diff})</span>`;
            } else {
              delta = `<span style="font-size: 0.72rem; color: #94a3b8; font-weight: 700; margin-left: 4px; white-space: nowrap;" title="Your Elo is identical to this tournament's average field">(Even)</span>`;
            }
          }
          avgEl.innerHTML = `${typeof renderEloBadgePill === 'function' ? renderEloBadgePill(avg) : `${avg} Elo`} ${delta}`;
        } else if (data.total_enrolled > 0) {
          avgEl.innerHTML = `<span style="color: #94a3b8; font-weight: 600; font-size: 0.78rem;">Provisional Field (${data.total_enrolled} ${data.total_enrolled === 1 ? 'player' : 'players'})</span>`;
        } else {
          if (matchedEv && isTournamentOngoing(matchedEv)) {
            avgEl.innerHTML = `<span style="color: #f59e0b; font-weight: 600; font-size: 0.78rem;">In Progress</span>`;
          } else if (matchedEv && isTournamentEnded(matchedEv)) {
            avgEl.innerHTML = `<span style="color: #64748b; font-weight: 500; font-size: 0.78rem;">Unrated Field</span>`;
          } else {
            avgEl.innerHTML = `<span style="color: #64748b; font-weight: 500; font-size: 0.78rem;">Registration Open</span>`;
          }
        }
      }

      // Update DOM element for Top Seed
      const topSeedContainer = document.getElementById(`top-seed-container-${eid}`);
      const topSeedVal = document.getElementById(`top-seed-val-${eid}`);
      if (topSeedContainer && topSeedVal && data.top_seed_elo != null && data.rated_players_count > 0) {
        const topElo = Math.round(Number(data.top_seed_elo));
        topSeedVal.innerHTML = typeof renderEloBadgePill === 'function' ? renderEloBadgePill(topElo) : `${topElo} Elo`;
        topSeedContainer.style.display = '';
      }

      // Update DOM element for Competitors Count
      const countEl = document.getElementById(`competitors-count-${eid}`);
      if (countEl && data.total_enrolled != null && data.total_enrolled > 0) {
        const capNum = Number(matchedEv?.num_tickets || 0);
        countEl.innerText = capNum > 0
          ? `👥 ${data.total_enrolled} / ${capNum} Spots`
          : `👥 ${data.total_enrolled} Competitor${data.total_enrolled === 1 ? '' : 's'}`;
      }
    });
  } catch (err) {
    console.debug('Notice hydrating upcoming field stats:', err);
  } finally {
    toFetch.forEach(id => communityState.fieldStatsHydrating.delete(id));
  }
}

let _activeBcpUpcomingPromise = null;
let _activeBcpUpcomingKey = null;

/**
 * Asynchronously fetches live BCP upcoming tournaments in background and merges them
 */
async function fetchAndMergeBcpUpcoming(lat, lng, radiusMiles) {
  if (lat == null || lng == null) return;
  const gsSlug = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
  const bcpKey = `${gsSlug}_${Number(lat).toFixed(4)}_${Number(lng).toFixed(4)}_${radiusMiles}`;
  if (_activeBcpUpcomingPromise && _activeBcpUpcomingKey === bcpKey) {
    return _activeBcpUpcomingPromise;
  }
  _activeBcpUpcomingKey = bcpKey;
  _activeBcpUpcomingPromise = (async () => {
    try {
      const res = await window.api.getCommunityBcpUpcoming(lat, lng, radiusMiles, 92);
      if (!res || !res.success || !Array.isArray(res.events) || res.events.length === 0) return;

      if (!communityState.overview) return;
      const existing = communityState.overview.events_upcoming || [];
      const existingMap = new Map();
      existing.forEach(ev => {
        if (ev && ev.id) existingMap.set(ev.id, ev);
      });

      let hasNewOrUpdated = false;
      const merged = [...existing];

      res.events.forEach(bEv => {
        const eid = bEv.id;
        if (!eid) return;
        if (existingMap.has(eid)) {
          const cur = existingMap.get(eid);
          let updated = false;
          if (bEv.total_players && bEv.total_players > (cur.total_players || 0)) {
            cur.total_players = bEv.total_players;
            updated = true;
          }
          if (bEv.current_round && bEv.current_round !== cur.current_round) {
            cur.current_round = bEv.current_round;
            updated = true;
          }
          if (bEv.is_started && !cur.is_started) {
            cur.is_started = true;
            updated = true;
          }
          if (bEv.is_ended && !cur.is_ended) {
            cur.is_ended = true;
            updated = true;
          }
          if (bEv.distance_miles != null && cur.distance_miles == null) {
            cur.distance_miles = bEv.distance_miles;
            updated = true;
          }
          ['venue', 'venue_name', 'address', 'formatted_address', 'street_address', 'postal_code', 'city', 'state', 'country', 'latitude', 'longitude'].forEach(locKey => {
            if (!cur[locKey] && bEv[locKey]) {
              cur[locKey] = bEv[locKey];
              updated = true;
            }
          });
          if (updated) {
            cur._commSearchText = '';
            hasNewOrUpdated = true;
          }
        } else {
          bEv.is_local = (bEv.distance_miles != null) ? true : Boolean(bEv.is_local);
          merged.push(bEv);
          existingMap.set(eid, bEv);
          hasNewOrUpdated = true;
        }
      });

      if (hasNewOrUpdated) {
        merged.sort((a, b) => {
          const da = a.event_date || '9999-12-31';
          const db = b.event_date || '9999-12-31';
          if (da !== db) return da.localeCompare(db);
          return (a.distance_miles || 9999) - (b.distance_miles || 9999);
        });
        communityState.overview.events_upcoming = merged.slice(0, 35);

        // Re-render if currently on tournaments subtab
        if (communityState.activeSubtab === 'tournaments') {
          renderCommunityEvents();
          if (communityState.tournamentsViewMode === 'calendar') {
            renderTournamentsCalendar();
          }
        }

        // Hydrate field stats for any new upcoming events that lack them
        const missingStats = communityState.overview.events_upcoming.filter(ev => ev.avg_field_elo == null);
        if (missingStats.length > 0) {
          const userElo = (typeof currentUser !== 'undefined' && currentUser && currentUser.current_elo) ? Number(currentUser.current_elo) : null;
          hydrateUpcomingFieldStats(missingStats.map(ev => ev.id), userElo);
        }
      }
    } catch (err) {
      console.debug('Notice fetching background BCP upcoming events:', err);
    }
  })().finally(() => {
    if (_activeBcpUpcomingKey === bcpKey) {
      _activeBcpUpcomingPromise = null;
      _activeBcpUpcomingKey = null;
    }
  });
  return _activeBcpUpcomingPromise;
}

/**
 * --------------------------------------------------------------------------
 * SUBTAB 2: LOCAL COMPETITORS & SPARRING DISCOVERY
 * --------------------------------------------------------------------------
 */
function renderCommunityCompetitors() {
  const container = document.getElementById('comm-scene-content');
  if (!container) return;

  const overview = communityState.overview;
  const competitors = overview?.local_competitors || overview?.local_leaderboard || [];
  const rad = overview?.location?.radius_miles || communityState.radiusMiles || 50;
  const locName = overview?.location?.location_name || communityState.locationName || 'Your Location';

  const sumEl = document.getElementById('comm-scene-summary');
  if (sumEl) sumEl.textContent = `${competitors.length} competitors • ${rad} mi`;

  let html = `
    <!-- Compact Verified Tournament Participation Banner -->
    <div style="margin-bottom: 1.15rem; padding: 0.65rem 0.95rem; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 8px; font-size: 0.8rem; color: #cbd5e1; display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 1.05rem; line-height: 1;">ℹ️</span>
      <span>Competitors identified through verified tournament participation within ${rad} miles of <strong>${escapeHtml(locName)}</strong>.</span>
    </div>
  `;

  if (competitors.length === 0) {
    html += `
      <div style="padding: 3rem 1rem; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: 12px; border: 1px dashed var(--border); margin-bottom: 3.5rem;">
        <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</div>
        <h4 style="color: #fff; margin-bottom: 0.4rem;">No Competitors Found within ${rad} Miles</h4>
        <p style="font-size: 0.85rem; color: var(--text-secondary); max-width: 480px; margin: 0 auto 1.25rem;">
          No verified tournament participants found yet within ${rad} miles of ${escapeHtml(locName)}. Try expanding your search radius to discover competitors in adjacent areas.
        </p>
        <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
          <button class="btn btn-primary" onclick="changeCommunityRadius(250)">Expand Radius to 250 Miles</button>
          <button class="btn btn-outline" onclick="openCommunityLocationModal()">Change Location</button>
        </div>
      </div>
    `;
  } else {
    html += `<div class="comm-competitors-grid" style="margin-bottom: 3.5rem;">`;
    competitors.forEach(c => {
      html += renderCompetitorCard(c);
    });
    html += `</div>`;
  }

  container.innerHTML = html;
}

function renderCompetitorCard(c) {
  const localElo = c.local_elo ? Math.round(Number(c.local_elo)) : 1500;
  const globalElo = c.current_elo ? Math.round(Number(c.current_elo)) : 1500;
  const peak = c.peak_elo ? Math.round(Number(c.peak_elo)) : globalElo;
  const faction = c.local_top_faction || c.top_faction || 'Unknown Faction';
  const name = c.player_name || 'Tournament Competitor';
  const initials = name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '40K';
  const localMatches = c.local_matches || 0;
  const localWinRate = (c.local_win_rate != null && localMatches > 0) ? Number(c.local_win_rate).toFixed(1) : (c.win_rate != null ? Number(c.win_rate).toFixed(1) : '-');

  // Shared event badge logic
  let sharedBadge = '';
  if (c.has_shared_events && c.shared_events_count > 0) {
    const eventNames = (c.shared_event_names || []).join(', ');
    sharedBadge = `
      <div style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); color: #10b981; padding: 4px 8px; border-radius: 6px; font-size: 0.72rem; font-weight: 700; display: flex; align-items: center; gap: 5px;" title="${escapeHtml(eventNames)}">
        <span>🏆</span> <span>${c.shared_events_count} Shared Tournament${c.shared_events_count > 1 ? 's' : ''}</span>
      </div>
    `;
  } else {
    sharedBadge = `
      <div style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: #94a3b8; padding: 4px 8px; border-radius: 6px; font-size: 0.72rem;">
        📍 ${c.regional_events_count || 1} Local Event${(c.regional_events_count || 1) > 1 ? 's' : ''}
      </div>
    `;
  }

  // Account status badge
  let accountBadge = '';
  if (c.has_account) {
    accountBadge = `
      <span class="badge" style="background: rgba(16, 185, 129, 0.12); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.68rem; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
        <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #10b981;"></span>
        Active Account
      </span>
    `;
  } else {
    accountBadge = `
      <span class="badge" style="background: rgba(148, 163, 184, 0.1); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.2); font-size: 0.68rem; display: inline-flex; align-items: center; gap: 4px;">
        Tournament Roster
      </span>
    `;
  }

  // Elo delta badge compared to user's Elo
  let eloDeltaBadge = '';
  if (c.user_elo != null && c.elo_diff != null && !c.is_self) {
    const diffNum = Math.round(Number(c.elo_diff));
    const sign = diffNum > 0 ? `+${diffNum}` : `${diffNum}`;
    const absDiff = Math.abs(diffNum);
    eloDeltaBadge = `
      <span class="badge" style="background: rgba(168, 85, 247, 0.14); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.28); font-size: 0.68rem; font-weight: 700;" title="Rating difference compared to your rating">
        Δ ${absDiff} (${sign})
      </span>
    `;
  }

  const provBadge = (c.is_provisional && localMatches > 0) ? `
    <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.68rem; font-weight: 700;" title="Provisional: Less than 5 local matches or 2 local events">
      Prov.
    </span>
  ` : '';

  // Action buttons
  let actionButton = '';
  if (c.is_self) {
    actionButton = `
      <button class="btn btn-outline" style="width: 100%; font-size: 0.78rem; padding: 0.45rem 0.75rem; justify-content: center; opacity: 0.6; cursor: default;" disabled>
        👤 You
      </button>
    `;
  } else if (c.can_chat) {
    actionButton = `
      <button class="btn btn-primary" style="width: 100%; font-size: 0.78rem; padding: 0.48rem 0.75rem; justify-content: center; font-weight: 700;" data-target-id="${escapeHtml(c.account_user_id || c.player_id)}" data-player-name="${escapeHtml(name)}" onclick="challengeCompetitor(this.dataset.targetId, this.dataset.playerName)">
        💬 Challenge / Chat
      </button>
    `;
  } else {
    actionButton = `
      <button class="btn btn-outline" style="width: 100%; font-size: 0.78rem; padding: 0.48rem 0.75rem; justify-content: center; color: #94a3b8; border-color: rgba(255,255,255,0.15); background: rgba(255,255,255,0.02);" data-player-name="${escapeHtml(name)}" onclick="showUnregisteredCompetitorAlert(this.dataset.playerName)">
        🔒 Chat (Unregistered)
      </button>
    `;
  }

  const recordStatsHtml = (localMatches > 0) ? `
    <div style="font-size: 0.74rem; color: #64748b; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 5px;">
      <span>Local Record: <strong style="color: #cbd5e1;">${c.local_record || '0-0-0'}</strong></span>
      <span>Local Win %: <strong style="color: #10b981;">${localWinRate}%</strong></span>
    </div>
  ` : `
    <div style="font-size: 0.74rem; color: #64748b; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 5px;">
      <span>Peak: <strong style="color: #cbd5e1;">${peak} Elo</strong></span>
      <span>Win Rate: <strong style="color: #10b981;">${localWinRate}%</strong></span>
    </div>
  `;

  return `
    <div class="comm-competitor-card">
      <div style="display: flex; gap: 12px; align-items: flex-start; margin-bottom: 0.7rem;">
        <div class="comm-player-avatar" data-player-id="${escapeHtml(c.player_id)}" onclick="openPlayerModal(this.dataset.playerId)" title="View profile for ${escapeHtml(name)}">
          ${escapeHtml(initials)}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 800; font-size: 1.02rem; color: #fff; line-height: 1.3; cursor: pointer; word-break: break-word;" data-player-id="${escapeHtml(c.player_id)}" onclick="openPlayerModal(this.dataset.playerId, '${escapeHtml(name)}')" title="Click to view profile">
            ${escapeHtml(name)}
          </div>
          <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-top: 5px;">
            <span class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3); font-size: 0.72rem; font-weight: 800; padding: 2px 7px;" title="Local Elo Rating calculated across regional tournament circuit">
              📍 ${localElo} Local
            </span>
            ${provBadge}
            ${typeof renderEloBadgePill === 'function' ? renderEloBadgePill(c.current_elo || globalElo, c.matches_played || c.local_matches || 10, { showTierName: true, size: 'sm', gameSystem: (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k' }) : `<span class="badge" style="background: rgba(255,255,255,0.06); color: #94a3b8; border: 1px solid rgba(255,255,255,0.12); font-size: 0.70rem; font-weight: 600; padding: 2px 6px;" title="Global Rating: ${globalElo}">🌐 ${globalElo}</span>`}
            ${eloDeltaBadge}
            ${accountBadge}
          </div>
        </div>
      </div>

      <div style="font-size: 0.78rem; color: #94a3b8; line-height: 1.4; margin-bottom: 0.8rem; word-break: break-word;">
        <span>${escapeHtml(faction)}</span>
        ${c.team ? `<span style="color: #64748b;"> &bull; </span><strong style="color: #cbd5e1;">${escapeHtml(c.team)}</strong>` : ''}
      </div>

      <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 0.65rem 0.85rem; margin-bottom: 0.85rem; display: flex; flex-direction: column; gap: 6px;">
        ${sharedBadge}
        ${recordStatsHtml}
      </div>

      <div style="margin-top: auto;">
        ${actionButton}
      </div>
    </div>
  `;
}

/**
 * Trigger match challenge or redirect to Community Hub
 */
function challengeCompetitor(playerId, playerName) {
  if (typeof currentUser !== 'undefined' && !currentUser) {
    if (confirm(`You need an OmniTactica account to challenge or chat with ${playerName}. Would you like to sign in or register?`)) {
      window.location.href = '/login?redirect=/';
    }
    return;
  }
  if (typeof openProposeMatchModal === 'function') {
    openProposeMatchModal(playerId, playerName);
  } else if (typeof handlePlayerChatClick === 'function') {
    handlePlayerChatClick(playerId, playerName, playerId);
  } else {
    switchCommunitySubtab('radar');
  }
}

/**
 * Alert shown when attempting to chat with a competitor who has not registered an account yet
 */
function showUnregisteredCompetitorAlert(playerName) {
  alert(`${playerName} is verified on local tournament rosters, but has not yet registered an account on OmniTactica. Direct chat and match proposals will be enabled once they register or link their BCP account!`);
}

/**
 * Force refreshes the local leaderboard & competitors scene subtab with spinning visual feedback
 */
async function refreshCommunityScene(btnElement = null) {
  const btn = btnElement || document.getElementById('comm-btn-refresh-scene') || document.querySelector('#comm-subview-scene .comm-toolbar-btn');
  const icon = btn ? (btn.querySelector('.refresh-icon') || btn.querySelector('span')) : null;

  if (btn) btn.disabled = true;
  if (icon) icon.classList.add('spinning');

  try {
    await loadCommunityHub(communityState.lat, communityState.lng, communityState.radiusMiles, communityState.locationName, true);
    if (communityState.overview) {
      renderCurrentSceneView();
    }
  } catch (err) {
    console.error('Failed to refresh local scene:', err);
  } finally {
    if (btn) btn.disabled = false;
    if (icon) icon.classList.remove('spinning');
  }
}

/**
 * --------------------------------------------------------------------------
 * SUBTAB 3: REGIONAL LEADERBOARD & SCENE VIEW TOGGLE
 * --------------------------------------------------------------------------
 */
function setCommunitySceneView(mode) {
  communityState.sceneView = mode;
  const btnLead = document.getElementById('comm-scene-toggle-leaderboard');
  const btnTeams = document.getElementById('comm-scene-toggle-teams');
  const btnComp = document.getElementById('comm-scene-toggle-competitors');
  if (btnLead) btnLead.classList.toggle('active', mode === 'leaderboard');
  if (btnTeams) btnTeams.classList.toggle('active', mode === 'teams');
  if (btnComp) btnComp.classList.toggle('active', mode === 'competitors');
  renderCurrentSceneView();
}

function renderCurrentSceneView() {
  const container = document.getElementById('comm-scene-content');
  if (!container) return;

  if (!communityState.overview) {
    if (communityState.overviewError) {
      container.innerHTML = `
        <div style="padding: 2.5rem 1rem; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border);">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
          <h4 style="color: #fff; margin-bottom: 0.4rem;">Unable to Load Local Competitors</h4>
          <p style="font-size: 0.85rem; color: var(--text-secondary); max-width: 480px; margin: 0 auto 1.25rem;">
            ${escapeHtml(communityState.overviewError)}
          </p>
          <button class="btn btn-primary" onclick="loadCommunityHub(null, null, null, null, true)">🔄 Retry</button>
        </div>
      `;
      return;
    }
    setSubtabLoaderIfEmpty(container, getCommunitySubtabLoaderHtml('scene'));
    if (!communityState.isLoading) {
      loadCommunityHub(communityState.lat, communityState.lng, communityState.radiusMiles, communityState.locationName);
    }
    return;
  }

  if (communityState.sceneView === 'competitors') {
    renderCommunityCompetitors();
  } else if (communityState.sceneView === 'teams') {
    renderCommunityTeamsLeaderboard();
  } else {
    renderCommunityLeaderboard();
  }
}

function renderCommunityTeamsLeaderboard() {
  const container = document.getElementById('comm-scene-content');
  if (!container) return;

  const overview = communityState.overview;
  const teams = overview?.local_teams_leaderboard || overview?.local_teams || [];
  const rad = overview?.location?.radius_miles || communityState.radiusMiles || 50;

  const sumEl = document.getElementById('comm-scene-summary');
  if (sumEl) sumEl.textContent = `${teams.length} clubs & teams • ${rad} mi`;

  let html = `
    <div class="table-container comm-table-container">
      <table id="comm-teams-leaderboard-table" class="data-table">
        <thead>
          <tr>
            <th style="width: 65px; text-align: center;">Rank</th>
            <th>Team / Gaming Club</th>
            <th style="text-align: center;">Local Roster</th>
            <th>Top Ace</th>
            <th>Team Avg Elo</th>
            <th style="text-align: center;">Regional Events</th>
            <th>Win Rate</th>
          </tr>
        </thead>
        <tbody>
  `;

  if (teams.length === 0) {
    html += `
      <tr>
        <td colspan="7" class="empty-state" style="padding: 2.5rem 1rem; text-align: center;">
          <div style="font-size: 1.6rem; margin-bottom: 0.4rem;">🛡️</div>
          <div style="font-weight: 700; color: #fff; margin-bottom: 0.25rem;">No Local Teams Found within ${rad} Miles</div>
          <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 1rem;">No club affiliations recorded in tournament rosters in this area yet. Try expanding your search radius.</div>
          <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
            <button class="btn btn-primary" style="font-size: 0.78rem;" onclick="changeCommunityRadius(250)">Search 250 Miles</button>
            <button class="btn btn-outline" style="font-size: 0.78rem;" onclick="openCommunityLocationModal()">Change Location</button>
          </div>
        </td>
      </tr>
    `;
  } else {
    teams.forEach((t, idx) => {
      const rank = t.rank != null ? Number(t.rank) : (idx + 1);
      let rankDisplay = `#${rank}`;
      if (rank === 1) rankDisplay = '🥇 1';
      else if (rank === 2) rankDisplay = '🥈 2';
      else if (rank === 3) rankDisplay = '🥉 3';

      const teamName = t.team_name || t.team || 'Team';
      const avgElo = t.avg_elo ? Math.round(Number(t.avg_elo)) : 1500;
      const topElo = t.top_player_elo ? Math.round(Number(t.top_player_elo)) : avgElo;
      const winRate = t.team_win_rate != null ? `${Number(t.team_win_rate).toFixed(1)}%` : (t.regional_wins != null ? `${((t.regional_wins / Math.max(1, t.regional_wins + (t.regional_losses || 0))) * 100).toFixed(1)}%` : '-');
      const membersCount = t.local_members_count || t.active_members || 1;
      const eventsCount = t.regional_events_count || 3;
      const topName = t.top_player_name || 'Top Competitor';
      const sys = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';

      html += `
        <tr data-team-name="${escapeHtml(teamName)}" onclick="if(typeof openTeamModal==='function') openTeamModal(this.dataset.teamName)" style="cursor: pointer;">
          <td style="text-align: center; font-weight: 800; font-family: monospace; color: ${rank <= 3 ? '#f59e0b' : '#94a3b8'};">
            ${rankDisplay}
          </td>
          <td>
            <div style="font-weight: 700; color: #fff; display: flex; align-items: center; gap: 6px;">
              <span>🛡️</span>
              <span class="player-link">${escapeHtml(teamName)}</span>
            </div>
          </td>
          <td style="text-align: center; color: #cbd5e1; font-weight: 600;">
            ${membersCount} player${membersCount > 1 ? 's' : ''}
          </td>
          <td>
            <div style="display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span style="color: #fff; font-weight: 600;">${escapeHtml(topName)}</span>
              ${typeof renderEloBadgePill === 'function' ? renderEloBadgePill(topElo, 10, { showTierName: false, size: 'sm', gameSystem: sys }) : `<span style="font-size: 0.72rem; color: #f59e0b; font-family: monospace; font-weight: 700;">${topElo} Elo</span>`}
            </div>
          </td>
          <td>
            ${typeof renderEloBadgePill === 'function' ? renderEloBadgePill(avgElo, 10, { showTierName: true, size: 'sm', gameSystem: sys }) : `<span style="font-weight: 800; color: #38bdf8; font-family: monospace;">${avgElo}</span>`}
          </td>
          <td style="text-align: center; color: #cbd5e1;">
            ${eventsCount}
          </td>
          <td style="color: #10b981; font-weight: 700; font-family: monospace;">
            ${winRate}
          </td>
        </tr>
      `;
    });
  }

  html += `
        </tbody>
      </table>
    </div>
  `;

  container.innerHTML = html;
}

function renderCommunityLeaderboard() {
  const container = document.getElementById('comm-scene-content');
  if (!container) return;

  const overview = communityState.overview;
  const leaderboard = overview?.local_leaderboard || [];
  const rad = overview?.location?.radius_miles || communityState.radiusMiles || 50;

  const sumEl = document.getElementById('comm-scene-summary');
  if (sumEl) sumEl.textContent = `${leaderboard.length} ranked competitors • ${rad} mi`;

  let html = `
    <div class="table-container comm-table-container">
      <table id="comm-leaderboard-table" class="data-table">
        <thead>
          <tr>
            <th style="width: 60px; text-align: center;">Rank</th>
            <th>Competitor</th>
            <th>Local Elo</th>
            <th>Local Record</th>
            <th>Local Win %</th>
            <th style="text-align: center;">Local Events</th>
            <th>Primary Faction</th>
            <th>Global Rating</th>
          </tr>
        </thead>
        <tbody>
  `;

  if (leaderboard.length === 0) {
    html += `
      <tr>
        <td colspan="8" class="empty-state" style="padding: 2.5rem 1rem; text-align: center;">
          <div style="font-size: 1.6rem; margin-bottom: 0.4rem;">👑</div>
          <div style="font-weight: 700; color: #fff; margin-bottom: 0.25rem;">No Ranked Competitors Found within ${rad} Miles</div>
          <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 1rem;">No tournament records found in this area. Try expanding your search radius.</div>
          <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
            <button class="btn btn-primary" style="font-size: 0.78rem;" onclick="changeCommunityRadius(250)">Search 250 Miles</button>
            <button class="btn btn-outline" style="font-size: 0.78rem;" onclick="openCommunityLocationModal()">Change Location</button>
          </div>
        </td>
      </tr>
    `;
  } else {
    const sys = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
    leaderboard.forEach((row, idx) => {
      const rank = row.rank != null ? Number(row.rank) : (idx + 1);
      let rankDisplay = `#${rank}`;
      if (rank === 1) rankDisplay = '🥇 1';
      else if (rank === 2) rankDisplay = '🥈 2';
      else if (rank === 3) rankDisplay = '🥉 3';

      const localElo = row.local_elo ? Math.round(Number(row.local_elo)) : 1500;
      const localMatches = row.local_matches || 0;
      const localWinRate = (row.local_win_rate != null && localMatches > 0) ? `${Number(row.local_win_rate).toFixed(1)}%` : '-';
      const localRecord = row.local_record || (row.local_wins != null ? `${row.local_wins}-${row.local_losses || 0}-${row.local_draws || 0}` : '0-0-0');
      const globalElo = row.current_elo ? Math.round(Number(row.current_elo)) : 1500;
      const globalPeak = row.peak_elo ? Math.round(Number(row.peak_elo)) : globalElo;

      const isSelf = (typeof currentUser !== 'undefined' && currentUser && (currentUser.player_id === row.player_id || currentUser.id === row.account_user_id));
      const chatPill = (row.has_account && !isSelf) ? `
        <button type="button" class="btn-chat-pill" title="Send Chat Request" data-player-id="${escapeHtml(row.player_id)}" data-player-name="${escapeHtml(row.player_name || '')}" data-user-id="${escapeHtml(row.account_user_id || '')}" onclick="event.stopPropagation(); handlePlayerChatClick(this.dataset.playerId, this.dataset.playerName, this.dataset.userId)">
          💬 Chat
        </button>
      ` : '';

      const provBadge = row.is_provisional ? `
        <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.65rem; font-weight: 700; padding: 1px 5px; margin-left: 5px;" title="Provisional: Less than 5 local matches or 2 local events in this circuit">
          Prov.
        </span>
      ` : '';

      const wrNum = Number(row.local_win_rate || 0);
      const wrColor = (localMatches > 0 && wrNum >= 60) ? '#10b981' : (localMatches > 0 && wrNum >= 45 ? '#38bdf8' : '#94a3b8');

      const safeRowName = String(row.player_name || 'Competitor').replace(/'/g, "\\'");
      const teamPill = row.team ? `<span class="badge" style="background:rgba(168,85,247,0.12); color:#c084fc; border:1px solid rgba(168,85,247,0.25); font-size:0.68rem; cursor:pointer;" onclick="event.stopPropagation(); openTeamModal('${escapeHtml(row.team)}')" title="View ${escapeHtml(row.team)} Roster">🛡️ ${escapeHtml(row.team)}</span>` : '';

      html += `
        <tr data-player-id="${escapeHtml(row.player_id)}" onclick="openPlayerModal(this.dataset.playerId, '${escapeHtml(safeRowName)}')" style="cursor: pointer;">
          <td style="text-align: center; font-weight: 800; font-family: monospace; color: ${rank <= 3 ? '#f59e0b' : '#94a3b8'};">
            ${rankDisplay}
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
              <div style="font-weight: 700; color: #fff;">${escapeHtml(row.player_name || 'Competitor')}</div>
              ${chatPill}
            </div>
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 3px;">
              ${teamPill}
              ${row.has_shared_events ? `<span style="font-size: 0.68rem; color: #10b981; font-weight: 700;">★ Shared Tournament Competitor</span>` : ''}
            </div>
          </td>
          <td style="white-space: nowrap;">
            ${typeof renderEloBadgePill === 'function' ? renderEloBadgePill(localElo, localMatches || 10, { showTierName: false, size: 'sm', gameSystem: sys }) : `<span style="font-weight: 800; color: #38bdf8; font-family: monospace;">${localElo}</span>`}
            ${provBadge}
          </td>
          <td>
            <div style="font-weight: 700; font-family: monospace; color: #f8fafc;">${localRecord}</div>
            <div style="font-size: 0.7rem; color: #64748b;">${localMatches} match${localMatches === 1 ? '' : 'es'}</div>
          </td>
          <td style="color: ${wrColor}; font-weight: 700; font-family: monospace;">
            ${localWinRate}
          </td>
          <td style="text-align: center; color: #cbd5e1; font-weight: 600;">
            ${row.regional_events_count || 1}
          </td>
          <td style="color: #cbd5e1;">
            ${escapeHtml(row.top_faction || 'Unknown')}
          </td>
          <td>
            ${typeof renderEloBadgePill === 'function' ? renderEloBadgePill(row.current_elo || globalElo, row.matches_played || localMatches || 10, { showTierName: true, size: 'sm', gameSystem: sys }) : `<div style="display: inline-flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 2px 6px; font-family: monospace; font-size: 0.75rem; color: #cbd5e1;" title="Global Rating: ${globalElo} (Peak: ${globalPeak})"><span>🌐</span> <strong>${globalElo}</strong></div>`}
          </td>
        </tr>
      `;
    });
  }

  html += `
        </tbody>
      </table>
    </div>
  `;

  container.innerHTML = html;
}

/**
 * --------------------------------------------------------------------------
 * SUBTAB 4: DIRECT SPARRING MESSAGES (1-ON-1 MATCHMAKING)
 * --------------------------------------------------------------------------
 */
function renderCommunityChat() {
  if (typeof loadUserRequests === 'function') loadUserRequests();
  if (typeof startChatPolling === 'function') startChatPolling();
  if (typeof attachChatSnapshot === 'function' && typeof connectState !== 'undefined' && connectState.activeRequestId) {
    attachChatSnapshot(connectState.activeRequestId);
  }
}

function setCommunityChatMode(mode) {
  // Retained as safe no-op for backward compatibility
}

/* ==========================================================================
   SUBTAB: LOCAL GAME STORES & TABLETOP CLUBS
   ========================================================================== */

const GOOGLE_MAPS_DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0f172a" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0f172a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#38bdf8" }]
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#94a3b8" }]
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#1e293b" }]
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.fill",
    stylers: [{ color: "#64748b" }]
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#1e293b" }]
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#334155" }]
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ color: "#94a3b8" }]
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#334155" }]
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#1e293b" }]
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.fill",
    stylers: [{ color: "#cbd5e1" }]
  },
  {
    featureType: "transit",
    elementType: "geometry",
    stylers: [{ color: "#1e293b" }]
  },
  {
    featureType: "transit.station",
    elementType: "labels.text.fill",
    stylers: [{ color: "#94a3b8" }]
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#070b14" }]
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#38bdf8" }]
  },
  {
    featureType: "water",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#070b14" }]
  }
];

function calcHaversineDistanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

/**
 * Validates whether a Google Places or external result is a legitimate tabletop/hobby store
 */
function isValidStoreResult(name, types = []) {
  if (!name || name.trim().length < 3) return false;
  const norm = name.trim().toLowerCase().replace(/['"]/g, '');

  const JUNK = ['asdf', 'test', 'tbd', 'n/a', 'na', 'online', 'discord', 'unknown', 'somewhere'];
  if (JUNK.includes(norm)) return false;

  const excludedTypes = ['lodging', 'hotel', 'campground', 'tourist_attraction', 'airport', 'movie_theater', 'bar'];
  if (types && Array.isArray(types) && types.some(t => excludedTypes.includes(t))) return false;

  const NON_STORES = [
    'hotel', 'motel', 'resort', 'fairground', 'convention center', 'expo center',
    'brewery', 'brewing', 'brewhouse', 'pub', 'tavern', 'winery', 'church'
  ];
  if (NON_STORES.some(ns => norm.includes(ns))) {
    if (!norm.includes('board game') && !norm.includes('tabletop cafe') && !norm.includes('game cafe')) {
      return false;
    }
  }

  return true;
}

/**
 * Cleanly formats a website URL for display (e.g. "gameempire.com" or "warhammer.com/…")
 */
function formatStoreWebsiteDisplay(url) {
  if (!url) return '';
  let clean = String(url).trim();
  if (!clean.includes('.')) return '';
  clean = clean.replace(/^https?:\/\//i, '');
  clean = clean.replace(/^www\./i, '');
  clean = clean.replace(/\/+$/, '');
  const parts = clean.split('/');
  if (parts.length > 1 && clean.length > 28) {
    clean = `${parts[0]}/…`;
  } else if (clean.length > 32) {
    clean = clean.substring(0, 30) + '…';
  }
  return clean;
}

/**
 * Asynchronously enriches stores with official website links in background
 */
let isEnrichingStoreWebsites = false;
async function enrichStoresWebsites(stores) {
  if (!Array.isArray(stores) || stores.length === 0 || isEnrichingStoreWebsites) return;

  const targets = stores.filter(s => !s.website && s.place_id && (String(s.place_id).startsWith('ChIJ') || String(s.place_id).length > 10));
  if (targets.length === 0) return;

  isEnrichingStoreWebsites = true;
  try {
    const getPlacesService = () => {
      if (typeof google !== 'undefined' && google.maps && google.maps.places && google.maps.places.PlacesService) {
        const dummyEl = document.createElement('div');
        return new google.maps.places.PlacesService(communityState.storesMap || dummyEl);
      }
      return null;
    };

    const resolveWebsiteForPlace = (placeId) => {
      return new Promise((resolve) => {
        // 1. Session Storage Cache
        const sessionKey = `place_website_${placeId}`;
        const cached = sessionStorage.getItem(sessionKey);
        if (cached !== null) {
          return resolve(cached === '__none__' ? null : cached);
        }

        // 2. Client Google Places SDK
        const svc = getPlacesService();
        if (svc) {
          try {
            svc.getDetails({ placeId, fields: ['website', 'url'] }, (place, status) => {
              if (status === google.maps.places.PlacesServiceStatus.OK && place) {
                const site = (place.website || '').trim() || null;
                try { sessionStorage.setItem(sessionKey, site || '__none__'); } catch (e) {}
                return resolve(site);
              } else {
                // Fallback to backend API
                if (window.api?.getStoreDetails) {
                  window.api.getStoreDetails(placeId).then(res => {
                    const site = (res?.website || '').trim() || null;
                    try { sessionStorage.setItem(sessionKey, site || '__none__'); } catch (e) {}
                    resolve(site);
                  }).catch(() => resolve(null));
                } else {
                  resolve(null);
                }
              }
            });
            return;
          } catch (e) {
            console.warn("Client PlacesService getDetails notice:", e);
          }
        }

        // 3. Fallback to backend API
        if (window.api?.getStoreDetails) {
          window.api.getStoreDetails(placeId).then(res => {
            const site = (res?.website || '').trim() || null;
            try { sessionStorage.setItem(sessionKey, site || '__none__'); } catch (e) {}
            resolve(site);
          }).catch(() => resolve(null));
        } else {
          resolve(null);
        }
      });
    };

    // Concurrently process in small batches of 3
    const BATCH_SIZE = 3;
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const batch = targets.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (store) => {
        try {
          const website = await resolveWebsiteForPlace(store.place_id);
          if (website) {
            store.website = website;

            // Update website row in card
            const row = document.getElementById(`store-website-row-${store.id}`);
            if (row) {
              row.innerHTML = `
                <span style="font-size: 0.9rem; flex-shrink: 0;">🌐</span>
                <a href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer" style="color: #38bdf8; text-decoration: none; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(website)}">
                  ${escapeHtml(formatStoreWebsiteDisplay(website))} ↗
                </a>
              `;
              row.style.display = 'flex';
            }

            // Update website action button in card
            const btn = document.getElementById(`store-btn-website-${store.id}`);
            if (btn) {
              btn.setAttribute('href', website);
              btn.style.display = 'inline-flex';
            }

            // If modal is open for this store, update modal header
            const modal = document.getElementById('store-tournaments-modal');
            if (modal && modal.classList.contains('active')) {
              const modalTitle = document.getElementById('store-tournaments-modal-title')?.innerText;
              if (modalTitle === store.name) {
                const modalWebRow = document.getElementById('store-tournaments-modal-website');
                const modalWebLink = document.getElementById('store-tournaments-modal-website-link');
                if (modalWebRow && modalWebLink) {
                  modalWebLink.href = website;
                  modalWebLink.innerText = `${formatStoreWebsiteDisplay(website)} ↗`;
                  modalWebLink.title = website;
                  modalWebRow.style.display = 'flex';
                }
              }
            }
          }
        } catch (err) {
          console.warn('Store website enrichment error:', store.name, err);
        }
      }));
    }
  } finally {
    isEnrichingStoreWebsites = false;
  }
}

/**
 * Searches client-side PlacesService if Google Maps JavaScript SDK is loaded
 */
function searchGooglePlacesClient(lat, lng, radiusMiles, query) {
  return new Promise((resolve) => {
    if (typeof google === 'undefined' || !google.maps || !google.maps.places || !google.maps.places.PlacesService) {
      return resolve([]);
    }
    try {
      const dummyEl = document.createElement('div');
      const service = new google.maps.places.PlacesService(communityState.storesMap || dummyEl);
      const request = {
        location: new google.maps.LatLng(lat, lng),
        radius: Math.min(50000, radiusMiles * 1609.34),
        query: query ? `${query} game store` : 'Warhammer 40k game store'
      };
      service.textSearch(request, (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results) {
          resolve(results);
        } else {
          resolve([]);
        }
      });
    } catch (e) {
      console.warn("Client PlacesService textSearch notice:", e);
      resolve([]);
    }
  });
}

/**
 * Loads local game stores from backend API and client PlacesService
 */
async function loadLocalGameStores(forceRefresh = false) {
  if (communityState.storesLoading && !forceRefresh) return;
  communityState.storesLoading = true;

  const lat = communityState.lat || 32.7157;
  const lng = communityState.lng || -117.1611;
  const radius = communityState.radiusMiles || 50;
  const locName = communityState.locationName || 'San Diego, CA';
  const query = (communityState.storesSearch || '').trim().toLowerCase();
  const cacheKey = `comm_stores_${Math.round(lat*100)/100}_${Math.round(lng*100)/100}_${radius}_${query}`;

  // Instant in-memory reuse when switching tabs without force refresh
  if (!forceRefresh && communityState.stores && communityState.stores.length > 0) {
    updateStoresBadgesAndCounts();
    renderStoresGrid();
    if (communityState.storesMap && typeof google !== 'undefined') {
      setTimeout(() => {
        google.maps.event.trigger(communityState.storesMap, 'resize');
      }, 50);
    }
    communityState.storesLoading = false;
    return;
  }

  // Instant local session cache hit
  if (!forceRefresh && (!communityState.stores || communityState.stores.length === 0)) {
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          communityState.stores = parsed;
          updateStoresBadgesAndCounts();
          renderStoresGrid();
          initStoresGoogleMap(parsed);
          communityState.storesLoading = false;
          return;
        }
      }
    } catch (e) {}
  }

  const grid = document.getElementById('comm-stores-grid');
  if (grid && (!communityState.stores || communityState.stores.length === 0 || forceRefresh)) {
    setSubtabLoaderIfEmpty(grid, getCommunitySubtabLoaderHtml('stores'));
  }

  try {
    // 1. Fetch from backend API (fast indexed spatial bounding box)
    let backendStores = [];
    if (typeof window.api?.getCommunityStores === 'function') {
      try {
        const res = await window.api.getCommunityStores(lat, lng, radius, communityState.storesSearch, locName);
        if (res && res.success && Array.isArray(res.stores)) {
          backendStores = res.stores;
          // Immediately render backend stores without waiting for client search
          communityState.stores = backendStores;
          updateStoresBadgesAndCounts();
          renderStoresGrid();
          initStoresGoogleMap(backendStores);
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify(backendStores));
          } catch (e) {}
        }
      } catch (e) {
        console.warn("Backend getCommunityStores notice:", e);
      }
    }

    // 2. Asynchronously enrich with client PlacesService in background (non-blocking)
    searchGooglePlacesClient(lat, lng, radius, communityState.storesSearch).then(clientPlaces => {
      if (!Array.isArray(clientPlaces) || clientPlaces.length === 0) return;
      const current = [...(communityState.stores || [])];
      const seenPlaceIds = new Set(current.map(s => s.place_id).filter(Boolean));
      const seenNames = new Set(current.map(s => (s.name || '').toLowerCase().replace(/['"]/g, '').trim()));
      let hasChanges = false;

      for (const place of clientPlaces) {
        const pid = place.place_id;
        const pName = place.name || 'Game Store';
        if (!isValidStoreResult(pName, place.types || [])) continue;
        const normName = pName.toLowerCase().replace(/['"]/g, '').trim();
        const pLat = place.geometry?.location ? (typeof place.geometry.location.lat === 'function' ? place.geometry.location.lat() : place.geometry.location.lat) : null;
        const pLng = place.geometry?.location ? (typeof place.geometry.location.lng === 'function' ? place.geometry.location.lng() : place.geometry.location.lng) : null;
        if (pLat == null || pLng == null) continue;
        const dist = calcHaversineDistanceMiles(lat, lng, pLat, pLng);
        if (dist > (radius * 1.25)) continue;

        let matched = null;
        if (pid && seenPlaceIds.has(pid)) {
          matched = current.find(s => s.place_id === pid);
        }
        if (!matched && seenNames.has(normName)) {
          matched = current.find(s => (s.name || '').toLowerCase().replace(/['"]/g, '').trim() === normName);
        }
        if (!matched) {
          matched = current.find(s => s.latitude && s.longitude && Math.abs(s.latitude - pLat) < 0.003 && Math.abs(s.longitude - pLng) < 0.003);
        }

        const openNow = place.opening_hours ? (typeof place.opening_hours.isOpen === 'function' ? place.opening_hours.isOpen() : place.opening_hours.open_now) : null;

        if (matched) {
          if (!matched.place_id && pid) { matched.place_id = pid; hasChanges = true; }
          if (place.rating && !matched.rating) { matched.rating = place.rating; hasChanges = true; }
          if (place.user_ratings_total && !matched.user_ratings_total) { matched.user_ratings_total = place.user_ratings_total; hasChanges = true; }
          if (openNow !== undefined && openNow !== null && matched.open_now == null) { matched.open_now = openNow; hasChanges = true; }
          if (!matched.website && matched.is_official_warhammer) { matched.website = 'https://www.warhammer.com/en-US/store-finder'; hasChanges = true; }
        } else {
          hasChanges = true;
          const isOfficial = Boolean(normName.includes('warhammer') || normName.includes('games workshop'));
          seenNames.add(normName);
          if (pid) seenPlaceIds.add(pid);
          current.push({
            id: pid || `client_${current.length}`,
            place_id: pid,
            name: pName,
            address: place.formatted_address || place.vicinity || '',
            latitude: pLat,
            longitude: pLng,
            distance_miles: dist,
            rating: place.rating || null,
            user_ratings_total: place.user_ratings_total || 0,
            open_now: openNow,
            is_official_warhammer: isOfficial,
            is_tournament_venue: false,
            tournament_count: 0,
            website: isOfficial ? 'https://www.warhammer.com/en-US/store-finder' : null,
            source: 'client_google_places'
          });
        }
      }

      if (hasChanges) {
        current.sort((a, b) => (a.distance_miles ?? 9999) - (b.distance_miles ?? 9999));
        communityState.stores = current;
        updateStoresBadgesAndCounts();
        renderStoresGrid();
        initStoresGoogleMap(current);
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(current));
        } catch (e) {}
      }
    }).catch(e => {
      console.warn("Client Places async enrichment notice:", e);
    });

  } catch (err) {
    console.error("Error loading local game stores:", err);
    if (grid) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 2.5rem 1rem; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border);">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
          <h4 style="color: #fff; margin-bottom: 0.4rem;">Unable to Discover Game Stores</h4>
          <p style="font-size: 0.85rem; color: var(--text-secondary); max-width: 480px; margin: 0 auto 1.25rem;">
            ${escapeHtml(err.message || 'An error occurred while finding tabletop stores.')}
          </p>
          <button class="btn btn-primary" onclick="loadLocalGameStores(true)">🔄 Retry</button>
        </div>
      `;
    }
  } finally {
    communityState.storesLoading = false;
  }
}

function updateStoresBadgesAndCounts() {
  const stores = communityState.stores || [];
  const total = stores.length;
  const tournamentsCount = stores.filter(s => s.is_tournament_venue).length;
  const officialCount = stores.filter(s => s.is_official_warhammer).length;
  const topCount = stores.filter(s => s.rating && s.rating >= 4.5).length;

  const countBadge = document.getElementById('badge-stores-count');
  if (countBadge) {
    countBadge.textContent = total;
    countBadge.style.display = total > 0 ? 'inline-block' : 'none';
  }

  const elAll = document.getElementById('count-stores-all');
  if (elAll) elAll.textContent = total;

  const elTourneys = document.getElementById('count-stores-tournaments');
  if (elTourneys) elTourneys.textContent = tournamentsCount;

  const elOfficial = document.getElementById('count-stores-official');
  if (elOfficial) elOfficial.textContent = officialCount;

  const elTop = document.getElementById('count-stores-top');
  if (elTop) elTop.textContent = topCount;
}

function renderStoresGrid() {
  const grid = document.getElementById('comm-stores-grid');
  if (!grid) return;

  const stores = communityState.stores || [];
  const filter = communityState.storesFilter || 'all';
  const query = (communityState.storesSearch || '').trim().toLowerCase();

  let filtered = stores.filter(store => {
    // 1. Category Filter
    if (filter === 'tournaments' && !store.is_tournament_venue) return false;
    if (filter === 'official' && !store.is_official_warhammer) return false;
    if (filter === 'top_rated' && (!store.rating || store.rating < 4.5)) return false;
    if (filter === 'open_now' && store.open_now !== true) return false;

    // 2. Keyword Search
    if (query) {
      const matchName = (store.name || '').toLowerCase().includes(query);
      const matchAddr = (store.address || '').toLowerCase().includes(query);
      const matchCity = (store.city || '').toLowerCase().includes(query);
      if (!matchName && !matchAddr && !matchCity) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 3rem 1.5rem; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: 12px; border: 1px dashed var(--border);">
        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">🏪</div>
        <h4 style="color: #fff; margin-bottom: 0.4rem;">No Stores Found</h4>
        <p style="font-size: 0.85rem; color: var(--text-secondary); max-width: 460px; margin: 0 auto 1.25rem;">
          ${query ? `No game stores match "${escapeHtml(query)}" with the active filter.` : `No stores found within ${communityState.radiusMiles} miles matching this filter.`}
        </p>
        <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
          ${(filter !== 'all' || query) ? `
            <button class="btn btn-primary" style="font-size: 0.78rem;" onclick="resetStoresFilters()">Clear Filters &amp; Search</button>
          ` : ''}
          <button class="btn btn-outline" style="font-size: 0.78rem;" onclick="changeCommunityRadius(${Math.min(250, Math.round(communityState.radiusMiles * 2))})">
            Expand Radius to ${Math.min(250, Math.round(communityState.radiusMiles * 2))} Miles
          </button>
        </div>
      </div>
    `;
    return;
  }

  let html = '';
  filtered.forEach(store => {
    html += renderStoreCard(store);
  });
  grid.innerHTML = html;

  // Asynchronously enrich visible stores with websites if missing
  enrichStoresWebsites(filtered);
}

function renderStoreCard(store) {
  const isOfficial = store.is_official_warhammer;
  const isTourney = store.is_tournament_venue;
  const dist = store.distance_miles != null ? store.distance_miles.toFixed(1) : '?';

  // Build clean directions URL that combines name and address if needed
  const cleanAddr = (store.address || '').trim();
  const nameInAddr = cleanAddr.toLowerCase().includes((store.name || '').toLowerCase().trim());
  const destQuery = (nameInAddr ? cleanAddr : `${store.name}, ${cleanAddr || store.city || ''}`).replace(/,\s*$/, '').trim();
  const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destQuery)}${store.place_id ? `&destination_place_id=${encodeURIComponent(store.place_id)}` : ''}`;

  return `
    <div class="comm-store-card ${isOfficial ? 'official-gw' : ''} ${isTourney ? 'tournament-venue' : ''}" id="store-card-${escapeHtml(store.id)}">
      <!-- Top Badges & Distance -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.65rem;">
        <div style="display: flex; gap: 5px; flex-wrap: wrap; align-items: center;">
          ${isOfficial ? `
            <span class="comm-store-badge comm-store-badge-official" title="Official Games Workshop / Warhammer Store">
              🛡️ Official Warhammer
            </span>
          ` : ''}
          ${isTourney ? `
            <span class="comm-store-badge comm-store-badge-tournament" title="Verified tournament venue with ${store.tournament_count} hosted tournaments">
              🏆 Tournament Venue (${store.tournament_count})
            </span>
          ` : ''}
          ${store.open_now === true ? `
            <span class="comm-store-badge comm-store-badge-open">🟢 Open Now</span>
          ` : (store.open_now === false ? `
            <span class="comm-store-badge comm-store-badge-closed">🔴 Closed</span>
          ` : '')}
        </div>

        <span class="badge" style="background: rgba(56, 189, 248, 0.1); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.25); font-size: 0.72rem; font-weight: 700; white-space: nowrap;">
          🚗 ${dist} mi
        </span>
      </div>

      <!-- Store Name -->
      <h4 style="font-size: 1.08rem; font-weight: 800; color: #fff; margin: 0 0 0.35rem; line-height: 1.35;">
        ${escapeHtml(store.name)}
      </h4>

      <!-- Address -->
      <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.4rem; display: flex; align-items: flex-start; gap: 6px; line-height: 1.4;">
        <span style="font-size: 0.9rem; flex-shrink: 0;">📍</span>
        <span style="word-break: break-word;">${escapeHtml(store.address || 'Address unavailable')}</span>
      </div>

      <!-- Website Row -->
      <div id="store-website-row-${escapeHtml(store.id)}" style="font-size: 0.78rem; color: #38bdf8; margin-bottom: 0.75rem; display: ${formatStoreWebsiteDisplay(store.website) ? 'flex' : 'none'}; align-items: center; gap: 6px; line-height: 1.4;">
        <span style="font-size: 0.9rem; flex-shrink: 0;">🌐</span>
        ${formatStoreWebsiteDisplay(store.website) ? `
          <a href="${escapeHtml(store.website)}" target="_blank" rel="noopener noreferrer" style="color: #38bdf8; text-decoration: none; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(store.website)}">
            ${escapeHtml(formatStoreWebsiteDisplay(store.website))} ↗
          </a>
        ` : ''}
      </div>

      <!-- Ratings & Tournament Box -->
      <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 0.65rem 0.85rem; margin-bottom: 1rem; display: flex; flex-direction: column; gap: 5px;">
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem;">
          <span style="color: #94a3b8;">${store.rating ? 'Google Rating:' : 'Verification:'}</span>
          <span style="font-weight: 700; color: ${store.rating ? '#facc15' : '#10b981'};">
            ${store.rating ? `⭐ ${store.rating.toFixed(1)} <span style="color: #64748b; font-weight: 500; font-size: 0.75rem;">(${store.user_ratings_total || 0} reviews)</span>` : (isTourney ? '✓ Verified Tournament Host' : '<span style="color: #64748b;">Community Listed</span>')}
          </span>
        </div>

        ${isTourney ? `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem;">
            <span style="color: #94a3b8;">Tournaments Hosted:</span>
            <span style="font-weight: 700; color: #38bdf8;">${store.tournament_count} verified event${store.tournament_count === 1 ? '' : 's'}</span>
          </div>
          ${store.last_tournament_date ? `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: #64748b;">
              <span>Last Event:</span>
              <span>${escapeHtml(store.last_tournament_date.substring(0, 10))}</span>
            </div>
          ` : ''}
        ` : `
          <div style="font-size: 0.75rem; color: #64748b;">
            Hobby center with Warhammer 40k miniatures &amp; tabletop supplies
          </div>
        `}
      </div>

      <!-- Actions -->
      <div class="comm-store-actions">
        <a href="${escapeHtml(dirUrl)}" target="_blank" rel="noopener noreferrer" class="comm-store-btn comm-store-btn-primary" title="Open Google Maps Driving / Transit Directions">
          <span>🧭</span> <span>Directions</span>
        </a>

        <a id="store-btn-website-${escapeHtml(store.id)}" href="${store.website ? escapeHtml(store.website) : '#'}" target="_blank" rel="noopener noreferrer" class="comm-store-btn comm-store-btn-website" style="display: ${store.website ? 'inline-flex' : 'none'};" title="Visit store official website">
          <span>🌐</span> <span>Website</span>
        </a>

        ${(store.latitude && store.longitude) ? `
          <button onclick="focusStoreOnMap(${store.latitude}, ${store.longitude}, '${escapeHtml(store.id)}')" class="comm-store-btn" title="Center on Map">
            <span>🗺️</span> <span>View on Map</span>
          </button>
        ` : ''}

        ${isTourney ? `
          <button onclick="openStoreTournamentsModal('${escapeHtml(store.id)}')" class="comm-store-btn" title="View all tournaments hosted at this venue">
            <span>⚔️</span> <span>Tournaments</span>
          </button>
        ` : ''}

        <button onclick="setStoreAsMatchmakingLocation('${escapeHtml(store.id)}')" class="comm-store-btn" style="margin-left: auto; color: #38bdf8;" title="Set this store as your primary matchmaking location in the Community Hub">
          <span>📍</span> <span>Set Location</span>
        </button>
      </div>
    </div>
  `;
}

/**
 * Initializes and updates the interactive Google Map with custom markers
 */
function initStoresGoogleMap(stores = null) {
  const mapContainer = document.getElementById('comm-stores-map');
  const fallbackContainer = document.getElementById('comm-stores-map-fallback');
  if (!mapContainer) return;

  const lat = communityState.lat || 32.7157;
  const lng = communityState.lng || -117.1611;

  // Update fallback link with current coordinates
  const extLink = document.getElementById('link-external-google-maps');
  if (extLink) {
    extLink.href = `https://www.google.com/maps/search/Warhammer+40k+game+store/@${lat},${lng},12z`;
  }

  // Check if Google Maps JS SDK is available
  if (typeof google === 'undefined' || !google.maps || !google.maps.Map) {
    if (fallbackContainer) fallbackContainer.style.display = 'block';
    mapContainer.style.display = 'none';
    if (typeof loadGoogleMapsSdk === 'function') {
      loadGoogleMapsSdk(() => {
        if (typeof google !== 'undefined' && google.maps && google.maps.Map) {
          initStoresGoogleMap(stores);
        }
      });
    }
    return;
  }

  if (fallbackContainer) fallbackContainer.style.display = 'none';
  mapContainer.style.display = 'block';

  // Instantiate map if not already done
  if (!communityState.storesMap) {
    communityState.storesMap = new google.maps.Map(mapContainer, {
      center: { lat, lng },
      zoom: 11,
      styles: GOOGLE_MAPS_DARK_STYLE,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      zoomControl: true
    });
    communityState.storesInfoWindow = new google.maps.InfoWindow();
  } else {
    communityState.storesMap.setCenter({ lat, lng });
  }

  // Clear existing markers
  if (communityState.storesMarkers) {
    communityState.storesMarkers.forEach(m => m.setMap(null));
  }
  communityState.storesMarkers = [];

  // Add User Location Pin
  const userMarker = new google.maps.Marker({
    position: { lat, lng },
    map: communityState.storesMap,
    title: `📍 ${communityState.locationName || 'Your Location'}`,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 8,
      fillColor: '#38bdf8',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2.5
    },
    zIndex: 9999
  });
  communityState.storesMarkers.push(userMarker);

  const storeList = stores || communityState.stores || [];
  const bounds = new google.maps.LatLngBounds();
  bounds.extend({ lat, lng });

  let validMarkersCount = 0;
  storeList.forEach(store => {
    if (store.latitude == null || store.longitude == null) return;
    const pos = { lat: parseFloat(store.latitude), lng: parseFloat(store.longitude) };
    bounds.extend(pos);
    validMarkersCount++;

    const isOfficial = store.is_official_warhammer;
    const isTourney = store.is_tournament_venue;
    const pinColor = isOfficial ? '#ef4444' : (isTourney ? '#f59e0b' : '#38bdf8');

    const marker = new google.maps.Marker({
      position: pos,
      map: communityState.storesMap,
      title: store.name,
      icon: {
        path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
        fillColor: pinColor,
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 1.5,
        scale: 1.4,
        anchor: new google.maps.Point(12, 22)
      },
      zIndex: isOfficial ? 500 : (isTourney ? 400 : 300)
    });

    marker.addListener('click', () => {
      const cleanAddr = (store.address || '').trim();
      const nameInAddr = cleanAddr.toLowerCase().includes((store.name || '').toLowerCase().trim());
      const destQuery = (nameInAddr ? cleanAddr : `${store.name}, ${cleanAddr || store.city || ''}`).replace(/,\s*$/, '').trim();
      const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destQuery)}${store.place_id ? `&destination_place_id=${encodeURIComponent(store.place_id)}` : ''}`;

      const websiteHtml = store.website ? `
        <div style="margin-bottom: 6px; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          <a href="${escapeHtml(store.website)}" target="_blank" rel="noopener noreferrer" style="color: #0284c7; text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;" title="${escapeHtml(store.website)}">
            <span>🌐</span> <span>${escapeHtml(formatStoreWebsiteDisplay(store.website))} ↗</span>
          </a>
        </div>
      ` : '';

      const websiteBtnHtml = store.website ? `
        <a href="${escapeHtml(store.website)}" target="_blank" rel="noopener noreferrer" style="font-size: 11px; font-weight: 700; padding: 4px 8px; background: rgba(2,132,199,0.08); color: #0284c7; border: 1px solid rgba(2,132,199,0.25); border-radius: 4px; text-decoration: none; display: inline-block;">
          🌐 Website
        </a>
      ` : '';

      const infoContent = `
        <div style="color: #0f172a; padding: 6px; max-width: 260px; font-family: system-ui, -apple-system, sans-serif;">
          <div style="font-weight: 800; font-size: 14px; margin-bottom: 4px; color: #0f172a; line-height: 1.3;">
            ${escapeHtml(store.name)}
          </div>
          ${isOfficial ? '<div style="display:inline-block; font-size:10px; font-weight:700; color:#ef4444; background:#fee2e2; padding:1px 6px; border-radius:4px; margin-bottom:4px;">🛡️ OFFICIAL WARHAMMER</div>' : ''}
          ${isTourney ? `<div style="display:inline-block; font-size:10px; font-weight:700; color:#b45309; background:#fef3c7; padding:1px 6px; border-radius:4px; margin-bottom:4px; margin-left:3px;">🏆 ${store.tournament_count} EVENT${store.tournament_count === 1 ? '' : 'S'}</div>` : ''}
          <div style="font-size: 11px; color: #475569; margin-bottom: 4px;">${escapeHtml(store.address || '')}</div>
          ${websiteHtml}
          <div style="display: flex; gap: 8px; align-items: center; font-size: 11px; color: #334155; margin-bottom: 8px;">
            <span>🚗 <strong>${store.distance_miles != null ? store.distance_miles.toFixed(1) : '?'} mi</strong></span>
            ${store.rating ? `<span>⭐ <strong>${store.rating.toFixed(1)}</strong> (${store.user_ratings_total || 0})</span>` : (isTourney ? '<span style="color: #10b981; font-weight: 700;">✓ Tournament Host</span>' : '')}
          </div>
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            <a href="${escapeHtml(dirUrl)}" target="_blank" rel="noopener noreferrer" style="font-size: 11px; font-weight: 700; padding: 4px 10px; background: #0284c7; color: #ffffff; border-radius: 4px; text-decoration: none; display: inline-block;">
              🧭 Directions
            </a>
            ${websiteBtnHtml}
            ${isTourney ? `
              <button onclick="openStoreTournamentsModal('${escapeHtml(store.id)}')" style="font-size: 11px; font-weight: 700; padding: 4px 8px; background: rgba(56,189,248,0.15); color: #0284c7; border: 1px solid rgba(56,189,248,0.35); border-radius: 4px; cursor: pointer;">
                ⚔️ Tournaments (${store.tournament_count})
              </button>
            ` : ''}
            <button onclick="setStoreAsMatchmakingLocation('${escapeHtml(store.id)}')" style="font-size: 11px; font-weight: 700; padding: 4px 8px; background: #f1f5f9; color: #0284c7; border: 1px solid #cbd5e1; border-radius: 4px; cursor: pointer;">
              📍 Set Location
            </button>
          </div>
        </div>
      `;
      communityState.storesInfoWindow.setContent(infoContent);
      communityState.storesInfoWindow.open(communityState.storesMap, marker);
    });

    communityState.storesMarkers.push(marker);
  });

  if (validMarkersCount > 0 && communityState.storesMap) {
    communityState.storesMap.fitBounds(bounds);
    const listener = google.maps.event.addListener(communityState.storesMap, "idle", () => {
      if (communityState.storesMap.getZoom() > 14) {
        communityState.storesMap.setZoom(14);
      }
      google.maps.event.removeListener(listener);
    });
  }
}

/**
 * Focuses map on a specific store
 */
function focusStoreOnMap(lat, lng, storeId) {
  if (communityState.storesViewMode === 'cards') {
    setStoresViewMode('both');
  }

  if (communityState.storesMap) {
    communityState.storesMap.setCenter({ lat: parseFloat(lat), lng: parseFloat(lng) });
    communityState.storesMap.setZoom(15);

    const marker = communityState.storesMarkers.find(m => {
      const pos = m.getPosition();
      return pos && Math.abs(pos.lat() - parseFloat(lat)) < 0.0001 && Math.abs(pos.lng() - parseFloat(lng)) < 0.0001;
    });
    if (marker && typeof google !== 'undefined') {
      google.maps.event.trigger(marker, 'click');
    }
  }

  const mapWrapper = document.getElementById('comm-stores-map-wrapper');
  if (mapWrapper) {
    mapWrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/**
 * Filter chip selection for Game Stores
 */
function setStoresFilter(filter) {
  communityState.storesFilter = filter;
  document.querySelectorAll('#comm-subview-stores .comm-store-filters .comm-filter-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderStoresGrid();
}

/**
 * Handles store search input with quick filtering
 */
let storesSearchTimer = null;
function handleStoresSearchInput(val) {
  communityState.storesSearch = val;
  const clearBtn = document.getElementById('stores-search-clear');
  if (clearBtn) {
    clearBtn.style.display = val ? 'block' : 'none';
  }

  clearTimeout(storesSearchTimer);
  storesSearchTimer = setTimeout(() => {
    renderStoresGrid();
  }, 180);
}

function clearStoresSearch() {
  const input = document.getElementById('stores-search-input');
  if (input) input.value = '';
  const clearBtn = document.getElementById('stores-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  communityState.storesSearch = '';
  renderStoresGrid();
}

function resetStoresFilters() {
  clearStoresSearch();
  setStoresFilter('all');
}

/**
 * Toggle view modes: 'both', 'cards', 'map'
 */
function setStoresViewMode(mode) {
  communityState.storesViewMode = mode;

  const btnBoth = document.getElementById('btn-stores-view-both');
  const btnCards = document.getElementById('btn-stores-view-cards');
  const btnMap = document.getElementById('btn-stores-view-map');

  if (btnBoth) btnBoth.classList.toggle('active', mode === 'both');
  if (btnCards) btnCards.classList.toggle('active', mode === 'cards');
  if (btnMap) btnMap.classList.toggle('active', mode === 'map');

  const subview = document.getElementById('comm-subview-stores');
  if (subview) {
    subview.classList.remove('comm-stores-view-both', 'comm-stores-view-cards', 'comm-stores-view-map');
    subview.classList.add(`comm-stores-view-${mode}`);
  }

  if ((mode === 'both' || mode === 'map') && communityState.storesMap && typeof google !== 'undefined') {
    setTimeout(() => {
      google.maps.event.trigger(communityState.storesMap, 'resize');
    }, 50);
  }
}

/**
 * 1-click set store as user's home matchmaking venue
 */
async function setStoreAsMatchmakingLocation(storeId) {
  const store = (communityState.stores || []).find(s => String(s.id) === String(storeId) || String(s.place_id) === String(storeId));
  if (!store) return;

  const storeName = store.name;
  const storeLat = store.latitude;
  const storeLng = store.longitude;
  const storeAddr = store.address;

  // 1. Update Community Hub location state & local storage
  updateCommunityLocation(storeLat, storeLng, storeName, communityState.radiusMiles);

  // 2. If logged in, update LFG profile
  if (typeof window.api?.updateConnectProfile === 'function') {
    try {
      const existingProfile = (typeof connectState !== 'undefined' && connectState.userProfile) ? connectState.userProfile : {};
      const payload = {
        ...existingProfile,
        is_active: existingProfile.is_active !== undefined ? existingProfile.is_active : true,
        home_venue_name: storeName,
        address: storeAddr || existingProfile.address || '',
        latitude: storeLat,
        longitude: storeLng,
        radius_miles: communityState.radiusMiles,
        preferred_points: existingProfile.preferred_points || 2000,
        play_style: existingProfile.play_style || 'Competitive'
      };
      if (typeof connectState !== 'undefined') {
        connectState.userProfile = payload;
      }
      if (typeof renderTopBarOptions === 'function') {
        renderTopBarOptions(payload);
      }
      await window.api.updateConnectProfile(payload);
    } catch (e) {
      console.warn("Notice updating profile with store location:", e);
    }
  }

  // Visual feedback
  if (typeof showToast === 'function') {
    showToast(`📍 Set home matchmaking venue to ${storeName}!`);
  } else {
    alert(`📍 Matchmaking location updated to: ${storeName}`);
  }
}

/**
 * Filters tournaments tab by specific venue
 */
function filterTournamentsByVenue(venueName) {
  communityState.tournamentsVenueFilter = venueName;
  switchCommunitySubtab('tournaments');
  const container = document.getElementById('comm-tournaments-content');
  if (container) {
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function clearTournamentsVenueFilter() {
  communityState.tournamentsVenueFilter = null;
  renderCommunityEvents();
  if (communityState.tournamentsViewMode === 'calendar') {
    renderTournamentsCalendar();
  }
}

/**
 * Execute server-side search across Majors, local/regional caches & PostgreSQL (<100ms)
 */
async function executeServerTournamentSearch(queryStr, force = false) {
  const q = String(queryStr || '').trim();
  if (q.length < 2) {
    communityState.searchLoading = false;
    return null;
  }
  if (!force && communityState.searchResults && communityState.searchQueryExecuted.toLowerCase() === q.toLowerCase()) {
    return communityState.searchResults;
  }

  if (_searchAbortController) {
    try { _searchAbortController.abort(); } catch {}
    _searchAbortController = null;
  }
  let fetchSignal = null;
  if (typeof AbortController !== 'undefined') {
    _searchAbortController = new AbortController();
    fetchSignal = _searchAbortController.signal;
  }

  const currentSys = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
  communityState.searchLoading = true;
  renderCommunityEvents();

  try {
    const res = await window.api.searchCommunityEvents(
      q,
      {
        lat: communityState.lat,
        lng: communityState.lng,
        gameSystem: currentSys,
        includePast: true,
        limit: 40
      },
      fetchSignal ? { signal: fetchSignal } : {}
    );
    if (res && res.aborted) return null;
    if ((communityState.tournamentsSearchQuery || '').trim().toLowerCase() !== q.toLowerCase()) {
      return null;
    }
    if (res && res.success) {
      communityState.searchResults = res;
      communityState.searchQueryExecuted = q;
    }
    return res;
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.message === 'The user aborted a request.')) return null;
    console.debug('Community event search notice:', err);
    return null;
  } finally {
    if ((communityState.tournamentsSearchQuery || '').trim().toLowerCase() === q.toLowerCase()) {
      communityState.searchLoading = false;
      renderCommunityEvents();
      if (communityState.tournamentsViewMode === 'calendar') {
        renderTournamentsCalendar();
      }
    }
  }
}

/**
 * Filter community tournaments in real-time as user types in the search bar
 */
function filterCommunityTournaments(query) {
  const sq = (query || '').trim();
  communityState.tournamentsSearchQuery = sq;
  syncRecommendationControlsUI();

  if (_searchDebounceTimer) {
    clearTimeout(_searchDebounceTimer);
    _searchDebounceTimer = null;
  }
  if (!sq || sq.length < 2) {
    if (_searchAbortController) {
      try { _searchAbortController.abort(); } catch {}
      _searchAbortController = null;
    }
    communityState.searchLoading = false;
    if (!sq) {
      communityState.searchResults = null;
      communityState.searchQueryExecuted = '';
    }
  } else {
    communityState.searchLoading = true;
    _searchDebounceTimer = setTimeout(() => {
      executeServerTournamentSearch(sq);
    }, 170);
  }

  renderCommunityEvents();
  if (communityState.tournamentsViewMode === 'calendar') {
    renderTournamentsCalendar();
  }
}

function clearCommunityTournamentsSearch(skipRender = false) {
  if (_searchDebounceTimer) {
    clearTimeout(_searchDebounceTimer);
    _searchDebounceTimer = null;
  }
  if (_searchAbortController) {
    try { _searchAbortController.abort(); } catch {}
    _searchAbortController = null;
  }
  communityState.tournamentsSearchQuery = '';
  communityState.searchResults = null;
  communityState.searchQueryExecuted = '';
  communityState.searchLoading = false;
  const inp = document.getElementById('comm-tournaments-search');
  if (inp) inp.value = '';
  syncRecommendationControlsUI();
  if (!skipRender) {
    renderCommunityEvents();
    if (communityState.tournamentsViewMode === 'calendar') {
      renderTournamentsCalendar();
    }
  }
}

function applyQuickTournamentSearch(term) {
  const inp = document.getElementById('comm-tournaments-search');
  if (inp) inp.value = term;
  filterCommunityTournaments(term);
}

/**
 * Opens the Store Tournaments popup modal and loads verified tournaments
 */
async function openStoreTournamentsModal(storeId) {
  const store = (communityState.stores || []).find(s => String(s.id) === String(storeId) || String(s.place_id) === String(storeId));
  const modal = document.getElementById('store-tournaments-modal');
  if (!modal) return;

  const titleEl = document.getElementById('store-tournaments-modal-title');
  const badgeEl = document.getElementById('store-tournaments-modal-badge');
  const addrEl = document.getElementById('store-tournaments-modal-address-text');
  const websiteRow = document.getElementById('store-tournaments-modal-website');
  const websiteLink = document.getElementById('store-tournaments-modal-website-link');
  const listEl = document.getElementById('store-tournaments-modal-list');
  const searchEl = document.getElementById('store-tournaments-search');

  const storeName = store ? store.name : 'Game Store';
  const storeAddr = store ? (store.address || store.city || '') : '';
  const initialCount = store ? (store.tournament_count || 0) : 0;
  const storeWeb = store ? store.website : null;

  if (titleEl) titleEl.innerText = storeName;
  if (addrEl) addrEl.innerText = storeAddr || 'Address unavailable';
  if (badgeEl) badgeEl.innerText = `${initialCount} verified event${initialCount === 1 ? '' : 's'}`;
  if (searchEl) searchEl.value = '';

  if (storeWeb && websiteRow && websiteLink) {
    websiteLink.href = storeWeb;
    websiteLink.innerText = `${formatStoreWebsiteDisplay(storeWeb)} ↗`;
    websiteLink.title = storeWeb;
    websiteRow.style.display = 'flex';
  } else if (websiteRow) {
    websiteRow.style.display = 'none';
  }

  if (listEl) {
    listEl.innerHTML = `
      <div style="text-align: center; padding: 2.5rem; color: #94a3b8;">
        <div class="spinner" style="margin: 0 auto 0.75rem;"></div>
        <div style="font-size: 0.9rem; font-weight: 600; color: #fff;">Loading verified tournaments...</div>
        <div style="font-size: 0.76rem; color: #64748b; margin-top: 0.25rem;">Fetching tournament records for ${escapeHtml(storeName)}</div>
      </div>
    `;
  }

  if (typeof bringModalToFront === 'function') {
    bringModalToFront(modal);
  } else {
    modal.classList.add('active');
  }

  try {
    const lat = store?.latitude ?? null;
    const lng = store?.longitude ?? null;
    const placeId = store?.place_id ?? (String(storeId).startsWith('ChIJ') ? storeId : null);

    const res = await window.api.getStoreTournaments(storeName, lat, lng, placeId);
    if (!res || !res.success) {
      throw new Error(res?.error || 'Failed to fetch tournaments');
    }

    const tournaments = res.tournaments || [];
    communityState.currentStoreTournaments = tournaments;

    if (badgeEl) {
      badgeEl.innerText = `${tournaments.length} verified event${tournaments.length === 1 ? '' : 's'}`;
    }

    if (res.store_website) {
      if (store && !store.website) {
        store.website = res.store_website;
      }
      if (websiteRow && websiteLink) {
        websiteLink.href = res.store_website;
        websiteLink.innerText = `${formatStoreWebsiteDisplay(res.store_website)} ↗`;
        websiteLink.title = res.store_website;
        websiteRow.style.display = 'flex';
      }
    }

    renderStoreTournamentsModalList(tournaments);
  } catch (err) {
    console.error('Failed to load store tournaments:', err);
    if (listEl) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: #f87171; background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.2); border-radius: 8px;">
          <div style="font-size: 1.5rem; margin-bottom: 0.35rem;">⚠️</div>
          <div style="font-size: 0.88rem; font-weight: 700;">Failed to load tournaments</div>
          <div style="font-size: 0.76rem; color: #fca5a5; margin-top: 0.2rem;">${escapeHtml(err.message || 'An unexpected error occurred')}</div>
          <button onclick="openStoreTournamentsModal('${escapeHtml(storeId)}')" class="btn btn-outline" style="font-size: 0.75rem; margin-top: 0.75rem; color: #38bdf8;">
            🔄 Retry
          </button>
        </div>
      `;
    }
  }
}

/**
 * Renders the tournament cards inside the store tournaments modal list
 */
function renderStoreTournamentsModalList(tournaments) {
  const listEl = document.getElementById('store-tournaments-modal-list');
  if (!listEl) return;

  if (!tournaments || tournaments.length === 0) {
    listEl.innerHTML = `
      <div style="text-align: center; padding: 2.5rem 1rem; color: #94a3b8; background: rgba(15, 23, 42, 0.4); border-radius: 8px; border: 1px dashed var(--border);">
        <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚔️</div>
        <div style="font-size: 0.95rem; font-weight: 700; color: #fff;">No Tournaments Found</div>
        <div style="font-size: 0.8rem; color: #64748b; margin-top: 0.25rem;">No historical Warhammer 40,000 tournaments recorded at this venue yet.</div>
      </div>
    `;
    return;
  }

  let html = '';
  tournaments.forEach(ev => {
    const dateStr = ev.event_date ? ev.event_date.slice(0, 10) : 'Date TBD';
    const isEnded = isTournamentEnded(ev);
    const isOngoing = !isEnded && isTournamentOngoing(ev);
    const winnerName = ev.winner_name;
    const winnerFaction = ev.winner_faction;
    const totalPlayers = ev.total_players || 0;
    const numRounds = ev.num_rounds || 0;
    const currentRound = Number(ev.current_round || ev.currentRound || 0);

    let storeBadgeHtml = '';
    if (isOngoing) {
      storeBadgeHtml = `
        <span class="badge" style="background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.35); font-size: 0.7rem; font-weight: 800;">
          ${currentRound > 0 ? `🔥 Round ${currentRound} Live` : '🔥 Live • In Progress'}
        </span>
      `;
    } else if (isEnded) {
      storeBadgeHtml = `
        <span class="badge" style="background: rgba(16,185,129,0.1); color: #10b981; border: 1px solid rgba(16,185,129,0.25); font-size: 0.7rem; font-weight: 700;">
          ✓ Completed
        </span>
      `;
    } else {
      storeBadgeHtml = `
        <span class="badge" style="background: rgba(56,189,248,0.1); color: #38bdf8; border: 1px solid rgba(56,189,248,0.25); font-size: 0.7rem; font-weight: 700;">
          ⚡ Upcoming
        </span>
      `;
    }

    html += `
      <div class="comm-store-tourney-card" style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 0.9rem 1.15rem; transition: all 0.2s;" onmouseover="this.style.borderColor='rgba(56,189,248,0.4)'; this.style.background='rgba(15,23,42,0.85)';" onmouseout="this.style.borderColor='rgba(255,255,255,0.08)'; this.style.background='rgba(15,23,42,0.6)';">
        <!-- Top meta bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.45rem; flex-wrap: wrap; gap: 6px;">
          <span class="badge" style="background: rgba(255, 255, 255, 0.06); color: #94a3b8; border: 1px solid rgba(255, 255, 255, 0.1); font-size: 0.72rem; font-family: monospace;">
            📅 ${escapeHtml(dateStr)}
          </span>
          <div style="display: flex; gap: 6px; align-items: center;">
            ${storeBadgeHtml}
            <span class="badge" style="background: rgba(148,163,184,0.1); color: #cbd5e1; border: 1px solid rgba(148,163,184,0.2); font-size: 0.7rem;">
              ${escapeHtml(ev.event_type || 'Singles')}
            </span>
          </div>
        </div>

        <!-- Tournament Title -->
        <h4 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0 0 0.5rem; line-height: 1.35; cursor: pointer;" onclick="openEventModal('${escapeHtml(ev.id)}', false)">
          <span style="transition: color 0.15s;" onmouseover="this.style.color='#38bdf8'" onmouseout="this.style.color='#fff'">${escapeHtml(ev.name || 'Warhammer 40k Tournament')}</span>
        </h4>

        <!-- Key Details Box -->
        <div style="background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 6px; padding: 0.55rem 0.8rem; margin-bottom: 0.75rem; display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem;">
            <span style="color: #94a3b8;">Format &amp; Turnout:</span>
            <span style="font-weight: 600; color: #e2e8f0;">
              👥 ${totalPlayers} Competitor${totalPlayers === 1 ? '' : 's'} • ⚔️ ${numRounds} Swiss Round${numRounds === 1 ? '' : 's'}
            </span>
          </div>

          ${winnerName ? `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem;">
              <span style="color: #94a3b8;">🏆 Champion:</span>
              <span style="font-weight: 700; color: #facc15;">
                ${escapeHtml(winnerName)} ${winnerFaction ? `<span style="color: #94a3b8; font-weight: 500; font-size: 0.74rem;">(${escapeHtml(winnerFaction)})</span>` : ''}
              </span>
            </div>
          ` : (isEnded ? `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: #64748b;">
              <span>Standings:</span>
              <span>Full bracket &amp; placings in details</span>
            </div>
          ` : '')}
        </div>

        <!-- Action Buttons -->
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <button class="btn btn-primary" style="flex: 1; font-size: 0.78rem; padding: 0.42rem 0.8rem; justify-content: center; font-weight: 700;" onclick="openEventModal('${escapeHtml(ev.id)}', false)">
            📋 View Bracket &amp; Roster
          </button>
          <a href="${escapeHtml((typeof getPlatformExternalEventUrl === 'function') ? getPlatformExternalEventUrl(ev.id, ev) : `https://www.bestcoastpairings.com/event/${encodeURIComponent(ev.id)}`)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="font-size: 0.78rem; padding: 0.42rem 0.7rem; color: #94a3b8; display: inline-flex; align-items: center; gap: 4px;" title="Open this event on ${escapeHtml((typeof getPlatformDisplayName === 'function') ? getPlatformDisplayName(ev.id, ev) : 'BCP')}">
            <span>🔗 ${escapeHtml((typeof getPlatformDisplayName === 'function') ? getPlatformDisplayName(ev.id, ev) : 'BCP')}</span>
          </a>
        </div>
      </div>
    `;
  });

  listEl.innerHTML = html;
}

/**
 * Filter modal tournaments in real-time as user types
 */
function filterStoreTournamentsModal(query) {
  const q = (query || '').trim().toLowerCase();
  const all = communityState.currentStoreTournaments || [];
  if (!q) {
    renderStoreTournamentsModalList(all);
    return;
  }
  const filtered = all.filter(ev => {
    return (
      (ev.name && ev.name.toLowerCase().includes(q)) ||
      (ev.winner_name && ev.winner_name.toLowerCase().includes(q)) ||
      (ev.winner_faction && ev.winner_faction.toLowerCase().includes(q)) ||
      (ev.event_date && ev.event_date.toLowerCase().includes(q))
    );
  });
  renderStoreTournamentsModalList(filtered);
}

/**
 * Hook triggered when Google Maps script completes loading
 */
function onGoogleMapsScriptLoaded() {
  if (communityState.activeSubtab === 'stores') {
    initStoresGoogleMap(communityState.stores);
  }
}

// Attach global helpers for window scope
window.initCommunityHub = initCommunityHub;
window.loadCommunityHub = loadCommunityHub;
window.getCommunitySubtabLoaderHtml = getCommunitySubtabLoaderHtml;
window.setSubtabLoaderIfEmpty = setSubtabLoaderIfEmpty;
window.changeCommunityRadius = changeCommunityRadius;
window.detectCommunityGPS = detectCommunityGPS;
window.updateCommunityLocation = updateCommunityLocation;
window.openCommunityLocationModal = openCommunityLocationModal;
window.switchCommunitySubtab = switchCommunitySubtab;
window.setCommunityEventsFilter = setCommunityEventsFilter;
window.challengeCompetitor = challengeCompetitor;
window.showUnregisteredCompetitorAlert = showUnregisteredCompetitorAlert;
window.setCommunitySceneView = setCommunitySceneView;
window.renderCurrentSceneView = renderCurrentSceneView;
window.renderCommunityLeaderboard = renderCommunityLeaderboard;
window.renderCommunityCompetitors = renderCommunityCompetitors;
window.renderCommunityTeamsLeaderboard = renderCommunityTeamsLeaderboard;
window.renderCommunityEvents = renderCommunityEvents;
window.refreshCommunityTournaments = refreshCommunityTournaments;
window.refreshCommunityScene = refreshCommunityScene;
window.loadCommunityOverview = (force = true) => loadCommunityHub(communityState.lat, communityState.lng, communityState.radiusMiles, communityState.locationName, force);
window.renderCommunityChat = renderCommunityChat;
window.setCommunityChatMode = setCommunityChatMode;

// Stores subtab helpers
window.loadLocalGameStores = loadLocalGameStores;
window.renderStoresGrid = renderStoresGrid;
window.initStoresGoogleMap = initStoresGoogleMap;
window.focusStoreOnMap = focusStoreOnMap;
window.setStoresFilter = setStoresFilter;
window.handleStoresSearchInput = handleStoresSearchInput;
window.clearStoresSearch = clearStoresSearch;
window.resetStoresFilters = resetStoresFilters;
window.setStoresViewMode = setStoresViewMode;
window.setStoreAsMatchmakingLocation = setStoreAsMatchmakingLocation;
window.openStoreTournamentsModal = openStoreTournamentsModal;
window.renderStoreTournamentsModalList = renderStoreTournamentsModalList;
window.filterStoreTournamentsModal = filterStoreTournamentsModal;
window.filterTournamentsByVenue = filterTournamentsByVenue;
window.clearTournamentsVenueFilter = clearTournamentsVenueFilter;
window.filterCommunityTournaments = filterCommunityTournaments;
window.hydrateUpcomingFieldStats = hydrateUpcomingFieldStats;
window.onGoogleMapsScriptLoaded = onGoogleMapsScriptLoaded;

// =========================================================================
// COMMUNITY EVENT REGISTRATION MODAL
// =========================================================================

var activeRegistrationEvent = (typeof window !== 'undefined' && window.activeRegistrationEvent) || null;
if (typeof window !== 'undefined') window.activeRegistrationEvent = activeRegistrationEvent;
var userRegistrationArmyLists = (typeof window !== 'undefined' && window.userRegistrationArmyLists) || [];
if (typeof window !== 'undefined') window.userRegistrationArmyLists = userRegistrationArmyLists;

function closeEventRegistrationLoadingModal() {
  const loadingModal = document.getElementById('event-reg-loading-modal');
  if (loadingModal) {
    loadingModal.style.display = 'none';
    loadingModal.classList.remove('active');
    loadingModal.style.removeProperty('z-index');
  }
  if (typeof modalStack !== 'undefined') {
    modalStack = modalStack.filter(id => id !== 'event-reg-loading-modal');
  }
  if (typeof window !== 'undefined' && window.modalStack) {
    window.modalStack = window.modalStack.filter(id => id !== 'event-reg-loading-modal');
  }
}
window.closeEventRegistrationLoadingModal = closeEventRegistrationLoadingModal;

function toggleRegistrationAccessCode(forceShow) {
  const block = document.getElementById('event-reg-access-code-block');
  const toggleWrapper = document.getElementById('event-reg-access-code-toggle-wrapper');
  const input = document.getElementById('event-reg-access-code');
  if (!block) return;

  const willShow = forceShow !== undefined ? Boolean(forceShow) : (block.style.display === 'none' || !block.style.display);
  if (willShow) {
    block.style.display = 'block';
    if (toggleWrapper) toggleWrapper.style.display = 'none';
    if (input) {
      setTimeout(() => input.focus(), 50);
    }
  } else {
    block.style.display = 'none';
    if (toggleWrapper) toggleWrapper.style.display = 'block';
  }
}
var cachedRegistrationFactions = (typeof window !== 'undefined' && window.cachedRegistrationFactions) || {};
if (typeof window !== 'undefined') window.cachedRegistrationFactions = cachedRegistrationFactions;

async function populateRegistrationFactions(gamesystemId = 'WGMSzfKFYA', selectedArmyId = '', selectedSubId = '') {
  const factionSelect = document.getElementById('event-reg-faction');
  if (!factionSelect) return [];

  const cleanGid = gamesystemId || 'WGMSzfKFYA';
  let factions = (typeof cachedGamesystemFactions !== 'undefined' && cachedGamesystemFactions && cachedGamesystemFactions[cleanGid])
    || (typeof cachedRegistrationFactions !== 'undefined' && cachedRegistrationFactions && cachedRegistrationFactions[cleanGid]) || [];

  if (!factions || factions.length === 0) {
    try {
      factionSelect.innerHTML = '<option value="">Loading factions from BCP...</option>';
      const res = await window.api.getGamesystemFactions(cleanGid);
      factions = (res && res.factions) || [];
      if (typeof cachedGamesystemFactions !== 'undefined' && cachedGamesystemFactions) {
        cachedGamesystemFactions[cleanGid] = factions;
      }
      cachedRegistrationFactions = (typeof cachedRegistrationFactions !== 'undefined' && cachedRegistrationFactions) || {};
      cachedRegistrationFactions[cleanGid] = factions;
    } catch (err) {
      console.warn("Failed to load registration factions:", err);
      factions = [];
    }
  }

  if (!factions || factions.length === 0) {
    factionSelect.innerHTML = '<option value="">Select Faction (Optional)</option>' +
      ['Adepta Sororitas', 'Adeptus Custodes', 'Adeptus Mechanicus', 'Aeldari', 'Astra Militarum', 'Black Templars', 'Blood Angels', 'Chaos Daemons', 'Chaos Knights', 'Chaos Space Marines', 'Dark Angels', 'Death Guard', 'Deathwatch', 'Drukhari', 'Genestealer Cults', 'Grey Knights', 'Imperial Knights', 'Leagues of Votann', 'Necrons', 'Orks', 'Space Marines', 'Space Wolves', "T'au Empire", 'Thousand Sons', 'Tyranids', 'World Eaters']
      .map(f => `<option value="${f}">${f}</option>`).join('');
    return factions;
  }

  const currentVal = factionSelect.value;
  factionSelect.innerHTML = '<option value="">Select Faction (Optional)</option>' + factions.map(f => {
    return `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`;
  }).join('');

  const targetArmy = selectedArmyId || currentVal;
  if (targetArmy) {
    let matchedF = factions.find(f => String(f.id).trim() === String(targetArmy).trim());
    if (!matchedF) {
      const target = String(targetArmy).trim().toLowerCase();
      matchedF = factions.find(f => {
        const fn = String(f.name || '').trim().toLowerCase();
        return fn === target || fn.includes(target) || target.includes(fn);
      });
    }
    if (matchedF) {
      factionSelect.value = matchedF.id;
      onRegistrationFactionChange(matchedF.id, selectedSubId);
    } else {
      onRegistrationFactionChange('', '');
    }
  } else {
    onRegistrationFactionChange('', '');
  }

  return factions;
}
window.populateRegistrationFactions = populateRegistrationFactions;

function onRegistrationFactionChange(selectedArmyId, selectedSubId = '') {
  const detachmentSelect = document.getElementById('event-reg-detachment');
  if (!detachmentSelect) return;

  if (!selectedArmyId) {
    detachmentSelect.innerHTML = '<option value="">Select Faction first</option>';
    return;
  }

  let foundFaction = null;
  const source = (typeof cachedGamesystemFactions !== 'undefined' && Object.keys(cachedGamesystemFactions).length > 0)
    ? cachedGamesystemFactions : cachedRegistrationFactions;
  for (const gid of Object.keys(source)) {
    const list = source[gid] || [];
    foundFaction = list.find(f => String(f.id).trim() === String(selectedArmyId).trim() || f.name.toLowerCase() === String(selectedArmyId).toLowerCase());
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

  const targetSub = selectedSubId || currentDetVal;
  if (targetSub) {
    let matchedSf = subFactions.find(sf => String(sf.id).trim() === String(targetSub).trim());
    if (!matchedSf) {
      const target = String(targetSub).trim().toLowerCase();
      matchedSf = subFactions.find(sf => {
        const sfn = String(sf.name || '').trim().toLowerCase();
        return sfn === target || sfn.includes(target) || target.includes(sfn);
      });
    }
    if (matchedSf) {
      detachmentSelect.value = matchedSf.id;
    } else {
      const opt = document.createElement('option');
      opt.value = targetSub;
      opt.textContent = targetSub;
      opt.selected = true;
      detachmentSelect.appendChild(opt);
    }
  }
}
window.onRegistrationFactionChange = onRegistrationFactionChange;

async function openEventRegistrationModal(eventId) {
  if (!eventId) return;
  const modal = document.getElementById('event-registration-modal');
  if (!modal) return;

  activeRegistrationEvent = null;
  userRegistrationArmyLists = [];

  const subTitleEl = document.getElementById('event-reg-modal-subtitle');
  const venueEl = document.getElementById('event-reg-modal-venue');
  const statusEl = document.getElementById('event-reg-status');
  const submitBtn = document.getElementById('event-reg-submit-btn');
  const savedListSelect = document.getElementById('event-reg-saved-list');
  const nameInput = document.getElementById('event-reg-name');
  const emailInput = document.getElementById('event-reg-email');
  const factionSelect = document.getElementById('event-reg-faction');
  const detachmentSelect = document.getElementById('event-reg-detachment');
  const armyListInput = document.getElementById('event-reg-army-list');
  const detailsEl = document.getElementById('event-reg-optional-details');
  const accountPill = document.getElementById('event-reg-account-pill');
  const accountStatus = document.getElementById('event-reg-account-status');
  const regBadge = document.getElementById('event-reg-badge');
  const accessCodeBlock = document.getElementById('event-reg-access-code-block');
  const accessCodeInput = document.getElementById('event-reg-access-code');
  const accessCodeToggleWrapper = document.getElementById('event-reg-access-code-toggle-wrapper');
  const accessCodeRequiredInd = document.getElementById('event-reg-access-code-required-indicator');
  const accessCodeBadge = document.getElementById('event-reg-access-code-badge');
  const accessCodeHint = document.getElementById('event-reg-access-code-hint');

  if (armyListInput) armyListInput.value = '';
  if (savedListSelect) savedListSelect.value = '';
  if (detailsEl) detailsEl.open = false;

  if (accessCodeInput) {
    accessCodeInput.value = '';
    accessCodeInput.style.borderColor = 'rgba(245, 158, 11, 0.5)';
  }
  if (accessCodeBlock) accessCodeBlock.style.display = 'none';
  if (accessCodeToggleWrapper) accessCodeToggleWrapper.style.display = 'block';

  if (statusEl) statusEl.style.display = 'none';
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Confirm & Complete Registration';
  }

  // Pre-fill event title info if available in local cache
  let localEv = null;
  if (typeof communityState !== 'undefined' && communityState && communityState.overview && Array.isArray(communityState.overview.events_upcoming)) {
    localEv = communityState.overview.events_upcoming.find(e => e.id === eventId);
  }
  if (localEv) {
    if (subTitleEl) subTitleEl.textContent = localEv.name || 'Tournament Registration';
    if (venueEl) venueEl.textContent = [localEv.venue, localEv.city, localEv.state].filter(Boolean).join(', ') || 'Warhammer 40k Tournament';
  } else {
    if (subTitleEl) subTitleEl.textContent = 'Loading Tournament Registration...';
    if (venueEl) venueEl.textContent = '';
  }

  // Show dedicated loading screen while waiting for BCP network request
  const loadingModal = document.getElementById('event-reg-loading-modal');
  const loadingText = document.getElementById('event-reg-loading-text');
  if (loadingText) {
    loadingText.textContent = localEv ? `Fetching registration details for ${localEv.name || 'Tournament'}...` : 'Fetching tournament details and your player registration profile...';
  }
  if (loadingModal) {
    loadingModal.style.display = 'flex';
    if (typeof bringModalToFront === 'function') bringModalToFront(loadingModal);
  }

  try {
    const data = await window.api.getCommunityEventRegistration(eventId);
    if (loadingModal) {
      loadingModal.style.display = 'none';
      closeEventRegistrationLoadingModal();
    }

    if (!data || !data.success) {
      modal.style.display = 'flex';
      if (typeof bringModalToFront === 'function') bringModalToFront(modal);
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
        statusEl.style.color = '#ef4444';
        statusEl.textContent = data?.detail || data?.error || 'Unable to load registration details.';
      }
      return;
    }

    activeRegistrationEvent = data;
    if (subTitleEl) subTitleEl.textContent = data.event_name || 'Tournament Registration';
    if (venueEl) venueEl.textContent = [data.venue, data.city, data.state].filter(Boolean).join(', ') || 'Warhammer 40k Tournament';

    // Account pill update
    const prof = data.user_profile || {};
    const isNativeReg = Boolean(data.is_native_event || /^es[-_]/i.test(String(eventId)));
    const regFeeNum = Number(data.ticket_price || 0);
    if (accountPill && accountStatus && regBadge) {
      if (isNativeReg) {
        accountPill.style.background = 'rgba(6, 182, 212, 0.12)';
        accountPill.style.borderColor = 'rgba(6, 182, 212, 0.35)';
        accountPill.style.color = '#67e8f9';
        accountStatus.textContent = prof.logged_in
          ? `⚡ OmniTactica Account (${prof.name || prof.email})`
          : '⚡ Registering on OmniTactica';
        regBadge.textContent = regFeeNum > 0 ? `$${regFeeNum.toFixed(0)} ENTRY` : '⚡ NATIVE';
        regBadge.style.background = 'rgba(6, 182, 212, 0.22)';
        regBadge.style.color = '#67e8f9';
      } else if (prof.bcp_linked) {
        accountPill.style.background = 'rgba(16, 185, 129, 0.1)';
        accountPill.style.borderColor = 'rgba(16, 185, 129, 0.3)';
        accountPill.style.color = '#10b981';
        accountStatus.textContent = `Linked BCP Account (${prof.name || prof.email})`;
        regBadge.textContent = 'BCP SYNC READY';
        regBadge.style.background = 'rgba(16, 185, 129, 0.2)';
        regBadge.style.color = '#10b981';
      } else if (prof.logged_in) {
        accountPill.style.background = 'rgba(56, 189, 248, 0.1)';
        accountPill.style.borderColor = 'rgba(56, 189, 248, 0.3)';
        accountPill.style.color = '#38bdf8';
        accountStatus.textContent = `Logged in as ${prof.name || prof.email}`;
        regBadge.textContent = 'FREE ENTRY';
        regBadge.style.background = 'rgba(56, 189, 248, 0.2)';
        regBadge.style.color = '#38bdf8';
      } else {
        accountPill.style.background = 'rgba(148, 163, 184, 0.1)';
        accountPill.style.borderColor = 'rgba(148, 163, 184, 0.25)';
        accountPill.style.color = '#94a3b8';
        accountStatus.textContent = 'Registering as Public Competitor';
        regBadge.textContent = 'FREE ENTRY';
      }
    }

    // Access Code UI display configuration
    const requiresAccessCode = Boolean(data.requires_access_code || data.private_event || data.has_access_code);
    if (requiresAccessCode) {
      if (accessCodeBlock) accessCodeBlock.style.display = 'block';
      if (accessCodeToggleWrapper) accessCodeToggleWrapper.style.display = 'none';
      if (accessCodeRequiredInd) accessCodeRequiredInd.style.display = 'inline';
      if (accessCodeBadge) {
        accessCodeBadge.textContent = 'ACCESS CODE REQUIRED';
        accessCodeBadge.style.display = 'inline-block';
        accessCodeBadge.style.background = 'rgba(245, 158, 11, 0.2)';
        accessCodeBadge.style.color = '#f59e0b';
        accessCodeBadge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
      }
      if (accessCodeHint) {
        accessCodeHint.textContent = 'This event is private or restricted and requires an access code provided by the Tournament Organizer to register.';
      }
      if (accessCodeInput) {
        accessCodeInput.required = true;
      }
      if (regBadge && !prof.bcp_linked) {
        regBadge.textContent = 'ACCESS CODE REQUIRED';
        regBadge.style.background = 'rgba(245, 158, 11, 0.2)';
        regBadge.style.color = '#f59e0b';
      }
    } else {
      if (accessCodeBlock) accessCodeBlock.style.display = 'none';
      if (accessCodeToggleWrapper) accessCodeToggleWrapper.style.display = 'block';
      if (accessCodeRequiredInd) accessCodeRequiredInd.style.display = 'none';
      if (accessCodeBadge) {
        accessCodeBadge.textContent = 'ORGANIZER CODE';
        accessCodeBadge.style.display = 'inline-block';
        accessCodeBadge.style.background = 'rgba(56, 189, 248, 0.15)';
        accessCodeBadge.style.color = '#38bdf8';
        accessCodeBadge.style.borderColor = 'rgba(56, 189, 248, 0.3)';
      }
      if (accessCodeHint) {
        accessCodeHint.textContent = 'If the organizer provided a private access code or password, enter it here.';
      }
      if (accessCodeInput) {
        accessCodeInput.required = false;
      }
    }

function syncRegistrationFullName() {
  const fn = (document.getElementById('event-reg-first-name')?.value || '').trim();
  const ln = (document.getElementById('event-reg-last-name')?.value || '').trim();
  const nameInput = document.getElementById('event-reg-name');
  if (nameInput) {
    nameInput.value = `${fn} ${ln}`.trim();
  }
}
window.syncRegistrationFullName = syncRegistrationFullName;

    // Pre-fill user inputs
    const firstNameInput = document.getElementById('event-reg-first-name');
    const lastNameInput = document.getElementById('event-reg-last-name');
    const teamInput = document.getElementById('event-reg-team');
    let fn = prof.first_name || '';
    let ln = prof.last_name || '';
    if (!fn && !ln && prof.name) {
      const parts = prof.name.trim().split(' ');
      fn = parts[0] || '';
      ln = parts.slice(1).join(' ') || '';
    }
    if (firstNameInput) firstNameInput.value = fn;
    if (lastNameInput) lastNameInput.value = ln;
    if (nameInput) {
      nameInput.value = prof.name || `${fn} ${ln}`.trim();
    }
    if (emailInput) {
      emailInput.value = prof.email || prof.bcp_email || '';
    }
    if (teamInput) {
      teamInput.value = prof.team || '';
    }

    // Populate Official BCP Factions and pre-fill if registered
    const gamesystemId = data.gamesystem_id || data.game_system_id || 'WGMSzfKFYA';
    const preg = data.player_registration || {};
    await populateRegistrationFactions(gamesystemId, preg.army_id || preg.faction || '', preg.sub_faction_id || preg.detachment || '');

    if (preg.army_list && armyListInput) {
      armyListInput.value = preg.army_list;
    }
    if (detailsEl && (preg.faction || preg.army_id || preg.detachment || preg.sub_faction_id || preg.army_list)) {
      detailsEl.open = true;
    }

    // Populate Saved Army Lists from My Hub
    userRegistrationArmyLists = Array.isArray(data.army_lists) ? data.army_lists : [];
    if (savedListSelect) {
      savedListSelect.innerHTML = '<option value="">-- Custom / Enter Below --</option>';
      userRegistrationArmyLists.forEach(al => {
        const opt = document.createElement('option');
        opt.value = al.id;
        opt.textContent = `${al.name} (${al.faction || 'Unassigned'}${al.points ? ' • ' + al.points + 'pts' : ''})`;
        savedListSelect.appendChild(opt);
      });

      // If user has saved lists and is not already registered with a list, auto-fill from first one if form is clean
      if (userRegistrationArmyLists.length === 1 && !factionSelect?.value && !preg.army_list) {
        savedListSelect.selectedIndex = 1;
        onRegistrationSavedListChange();
      }
    }

    // If user is already registered for this event
    if (data.is_registered) {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(16, 185, 129, 0.15)';
        statusEl.style.color = '#10b981';
        statusEl.textContent = '✓ You are registered for this tournament. Updating details will sync to your roster.';
      }
      if (submitBtn) submitBtn.textContent = 'Update Registration Details';
    } else if (isTournamentOngoing(data) || isTournamentEnded(data)) {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
        statusEl.style.color = '#ef4444';
        statusEl.textContent = '🔒 Registration is closed because this tournament has already started or concluded.';
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Registration Closed (In Progress)';
      }
    }

    // Data is completely populated - now reveal registration modal smoothly
    modal.style.display = 'flex';
    if (typeof bringModalToFront === 'function') bringModalToFront(modal);
  } catch (err) {
    if (loadingModal) closeEventRegistrationLoadingModal();
    modal.style.display = 'flex';
    if (typeof bringModalToFront === 'function') bringModalToFront(modal);
    console.error('Error opening event registration modal:', err);
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
      statusEl.style.color = '#ef4444';
      statusEl.textContent = `Error loading registration: ${err.message || err}`;
    }
  }
}

function closeEventRegistrationModal() {
  closeEventRegistrationLoadingModal();
  if (typeof closeModal === 'function') {
    closeModal('event-registration-modal');
  } else {
    const modal = document.getElementById('event-registration-modal');
    if (modal) modal.style.display = 'none';
  }
  activeRegistrationEvent = null;
}

function onRegistrationSavedListChange() {
  const savedListSelect = document.getElementById('event-reg-saved-list');
  const factionSelect = document.getElementById('event-reg-faction');
  const detachmentSelect = document.getElementById('event-reg-detachment');
  const armyListInput = document.getElementById('event-reg-army-list');
  const detailsEl = document.getElementById('event-reg-optional-details');

  if (!savedListSelect) return;
  const selectedId = savedListSelect.value;
  if (!selectedId) return;

  const matched = userRegistrationArmyLists.find(al => String(al.id) === String(selectedId));
  if (!matched) return;

  if (detailsEl) {
    detailsEl.open = true;
  }

  if (matched.faction) {
    let foundArmyId = '';
    const factionsSource = (typeof cachedGamesystemFactions !== 'undefined' && Object.keys(cachedGamesystemFactions).length > 0)
      ? cachedGamesystemFactions : cachedRegistrationFactions;
    for (const gid of Object.keys(factionsSource)) {
      const list = factionsSource[gid] || [];
      const f = list.find(x => x.name.toLowerCase() === matched.faction.toLowerCase() || matched.faction.toLowerCase().includes(x.name.toLowerCase()));
      if (f) {
        foundArmyId = f.id;
        break;
      }
    }

    if (foundArmyId && factionSelect) {
      factionSelect.value = foundArmyId;
      onRegistrationFactionChange(foundArmyId, matched.detachment || '');
    } else if (factionSelect) {
      for (let i = 0; i < factionSelect.options.length; i++) {
        const optText = (factionSelect.options[i].text || '').toLowerCase();
        const optVal = (factionSelect.options[i].value || '').toLowerCase();
        const mFac = matched.faction.toLowerCase();
        if (optText === mFac || optVal === mFac || optText.includes(mFac) || mFac.includes(optText)) {
          factionSelect.selectedIndex = i;
          onRegistrationFactionChange(factionSelect.value, matched.detachment || '');
          break;
        }
      }
    }
  }

  if (armyListInput) {
    const resolvedText = matched.raw_text || matched.list_text || matched.army_list || (window.generateRawRosterText ? window.generateRawRosterText(matched) : '');
    if (resolvedText) {
      armyListInput.value = resolvedText;
    }
  }
}

async function refreshRegistrationArmyLists() {
  if (!activeRegistrationEvent) return;
  const savedListSelect = document.getElementById('event-reg-saved-list');
  if (savedListSelect) {
    savedListSelect.innerHTML = '<option value="">Refreshing saved lists...</option>';
  }
  try {
    const data = await window.api.getCommunityEventRegistration(activeRegistrationEvent.event_id || activeRegistrationEvent.id);
    if (data && data.success) {
      userRegistrationArmyLists = Array.isArray(data.army_lists) ? data.army_lists : [];
      if (savedListSelect) {
        savedListSelect.innerHTML = '<option value="">-- Custom / Enter Below --</option>';
        userRegistrationArmyLists.forEach(al => {
          const opt = document.createElement('option');
          opt.value = al.id;
          opt.textContent = `${al.name} (${al.faction || 'Unassigned'}${al.points ? ' • ' + al.points + 'pts' : ''})`;
          savedListSelect.appendChild(opt);
        });
      }
    }
  } catch (err) {
    console.warn('Could not refresh saved army lists:', err);
  }
}

async function submitEventRegistration() {
  if (!activeRegistrationEvent) {
    alert('No active tournament selected for registration.');
    return;
  }

  const eventId = activeRegistrationEvent.event_id || activeRegistrationEvent.id;
  const submitBtn = document.getElementById('event-reg-submit-btn');
  const statusEl = document.getElementById('event-reg-status');

  if (!activeRegistrationEvent.is_registered && (
    isTournamentOngoing(activeRegistrationEvent) ||
    isTournamentEnded(activeRegistrationEvent)
  )) {
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
      statusEl.style.color = '#ef4444';
      statusEl.textContent = '🔒 Registration is closed because this tournament has already started or concluded.';
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Registration Closed (In Progress)';
    }
    return;
  }

  const nameInput = document.getElementById('event-reg-name');
  const emailInput = document.getElementById('event-reg-email');
  const factionSelect = document.getElementById('event-reg-faction');
  const detachmentSelect = document.getElementById('event-reg-detachment');
  const armyListInput = document.getElementById('event-reg-army-list');
  const savedListSelect = document.getElementById('event-reg-saved-list');
  const firstNameInput = document.getElementById('event-reg-first-name');
  const lastNameInput = document.getElementById('event-reg-last-name');
  const teamInput = document.getElementById('event-reg-team');
  const fn = firstNameInput ? firstNameInput.value.trim() : '';
  const ln = lastNameInput ? lastNameInput.value.trim() : '';
  const team = teamInput ? teamInput.value.trim() : '';
  let fullName = `${fn} ${ln}`.trim();
  if (!fullName && nameInput) {
    fullName = nameInput.value.trim();
  }

  const email = emailInput ? emailInput.value.trim() : '';

  let armyId = '';
  let factionName = '';
  if (factionSelect && factionSelect.selectedIndex > 0 && factionSelect.value) {
    armyId = factionSelect.value;
    factionName = factionSelect.options[factionSelect.selectedIndex]?.text || '';
    if (factionName.startsWith('Select Faction')) factionName = '';
  }

  let subFactionId = '';
  let detachmentName = '';
  if (detachmentSelect && detachmentSelect.selectedIndex > 0 && detachmentSelect.value) {
    subFactionId = detachmentSelect.value;
    detachmentName = detachmentSelect.options[detachmentSelect.selectedIndex]?.text || '';
    if (detachmentName.startsWith('-- Select') || detachmentName.startsWith('Select Faction') || detachmentName.startsWith('No detachments')) detachmentName = '';
  }

  const armyList = armyListInput ? armyListInput.value.trim() : '';
  const savedListId = savedListSelect ? savedListSelect.value : '';

  if (!fn && !fullName) {
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
      statusEl.style.color = '#ef4444';
      statusEl.textContent = 'Please enter your first name.';
    }
    (firstNameInput || nameInput)?.focus();
    return;
  }

  const isNativeSubmit = Boolean(activeRegistrationEvent?.is_native_event || /^es[-_]/i.test(String(eventId)));
  if (!email && !isNativeSubmit) {
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
      statusEl.style.color = '#ef4444';
      statusEl.textContent = 'Please enter your BCP account email address.';
    }
    emailInput?.focus();
    return;
  }

  const accessCodeInput = document.getElementById('event-reg-access-code');
  const accessCode = accessCodeInput ? accessCodeInput.value.trim() : '';
  const requiresAccessCode = Boolean(activeRegistrationEvent?.requires_access_code || activeRegistrationEvent?.private_event || activeRegistrationEvent?.has_access_code);

  if (requiresAccessCode && !accessCode) {
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
      statusEl.style.color = '#ef4444';
      statusEl.textContent = 'This tournament requires an Access Code. Please enter the access code provided by your Tournament Organizer.';
    }
    toggleRegistrationAccessCode(true);
    if (accessCodeInput) {
      accessCodeInput.style.borderColor = '#ef4444';
      accessCodeInput.focus();
    }
    return;
  }

  if (accessCodeInput) {
    accessCodeInput.style.borderColor = 'rgba(245, 158, 11, 0.5)';
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner-mini" style="display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation:spin 0.8s linear infinite; margin-right:6px; vertical-align:middle;"></span> Processing Registration...';
  }
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.background = 'rgba(56, 189, 248, 0.1)';
    statusEl.style.color = '#38bdf8';
    statusEl.textContent = 'Registering competitor and syncing with tournament roster...';
  }

  const bcpToken = localStorage.getItem('bcp_session_token') || localStorage.getItem('bcp_access_token') || '';
  const payload = {
    name: fullName,
    first_name: fn,
    last_name: ln,
    email: email,
    team: team,
    faction: factionName || armyId || null,
    faction_name: factionName || null,
    army_id: armyId || null,
    detachment: detachmentName || subFactionId || null,
    detachment_name: detachmentName || null,
    sub_faction_id: subFactionId || null,
    army_list: armyList || null,
    army_list_id: savedListId || null,
    access_code: accessCode || null,
    accessCode: accessCode || null,
    bcp_token: bcpToken || null
  };

  try {
    const res = await window.api.registerCommunityEvent(eventId, payload);
    if (res && res.success) {
      if (statusEl) {
        statusEl.style.background = 'rgba(16, 185, 129, 0.15)';
        statusEl.style.color = '#10b981';
        const bcpMsg = res.bcp_synced ? ' & synced with Best Coast Pairings' : '';
        statusEl.innerHTML = `✅ Successfully registered for ${escapeHtml(res.event_name || 'Tournament')}${bcpMsg}!`;
      }

      // Mark tournament as registered in local communityState
      if (typeof communityState !== 'undefined' && communityState) {
        const markRegisteredInList = (arr) => {
          if (!Array.isArray(arr)) return;
          const evItem = arr.find(e => e && String(e.id) === String(eventId));
          if (evItem && !evItem.is_registered) {
            evItem.is_registered = true;
            evItem.total_players = (evItem.total_players || 0) + 1;
          }
        };
        markRegisteredInList(communityState.overview?.events_upcoming);
        markRegisteredInList(communityState.recommendations?.local_events);
        markRegisteredInList(communityState.recommendations?.driveable_events);
        markRegisteredInList(communityState.recommendations?.destination_majors);
        markRegisteredInList(communityState.recommendations?.top_picks);
        markRegisteredInList(communityState.searchResults?.upcoming);
      }
      renderCommunityEvents();

      // Dispatch global tournaments-updated event so My Hub updates registered tournaments
      window.dispatchEvent(new CustomEvent('tournaments-updated', {
        detail: { eventId: eventId, action: 'register', event: res }
      }));
      if (typeof loadRegisteredTournaments === 'function') {
        try { loadRegisteredTournaments(); } catch {}
      }

      setTimeout(() => {
        closeEventRegistrationModal();
      }, 1400);
    } else {
      const errMsg = res?.detail || res?.message || 'Registration failed. Please try again.';
      if (statusEl) {
        statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
        statusEl.style.color = '#ef4444';
        statusEl.textContent = errMsg;
      }
      if (/access\s*code|private|password/i.test(errMsg)) {
        toggleRegistrationAccessCode(true);
        if (accessCodeInput) {
          accessCodeInput.style.borderColor = '#ef4444';
          accessCodeInput.focus();
        }
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm & Complete Registration';
      }
    }
  } catch (err) {
    console.error('Registration error:', err);
    const errMsg = err.message || String(err);
    if (statusEl) {
      statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
      statusEl.style.color = '#ef4444';
      statusEl.textContent = `Error: ${errMsg}`;
    }
    if (/access\s*code|private|password/i.test(errMsg)) {
      toggleRegistrationAccessCode(true);
      if (accessCodeInput) {
        accessCodeInput.style.borderColor = '#ef4444';
        accessCodeInput.focus();
      }
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Confirm & Complete Registration';
    }
  }
}

window.openEventRegistrationModal = openEventRegistrationModal;
window.closeEventRegistrationModal = closeEventRegistrationModal;
window.onRegistrationSavedListChange = onRegistrationSavedListChange;
window.refreshRegistrationArmyLists = refreshRegistrationArmyLists;
window.submitEventRegistration = submitEventRegistration;

// Backwards compatibility aliases
window.changeCommunityRegion = (region) => {
  if (communityState.overview?.available_regions) {
    const matched = communityState.overview.available_regions.find(r => r.id === region);
    if (matched && matched.lat && matched.lng) {
      updateCommunityLocation(matched.lat, matched.lng, matched.name);
      return;
    }
  }
  loadCommunityHub(null, null, communityState.radiusMiles, null);
};
window.detectCommunityRegion = detectCommunityGPS;
window.switchTournamentsViewMode = switchTournamentsViewMode;
window.setTournamentsQuickFilter = setTournamentsQuickFilter;
window.setCommunityRecTab = setCommunityRecTab;
window.setCommunityMaxDriveHours = setCommunityMaxDriveHours;
window.setCommunityMajorsScope = setCommunityMajorsScope;
window.setLocalDriveSubFilter = setLocalDriveSubFilter;
window.setLocalDriveSort = setLocalDriveSort;
window.setMajorsTierFilter = setMajorsTierFilter;
window.loadCommunityEventRecommendations = loadCommunityEventRecommendations;
window.filterCommunityTournaments = filterCommunityTournaments;
window.clearCommunityTournamentsSearch = clearCommunityTournamentsSearch;
window.applyQuickTournamentSearch = applyQuickTournamentSearch;
window.changeCalendarMonth = changeCalendarMonth;
window.setCalendarToday = setCalendarToday;
window.scrollMajorsCarousel = scrollMajorsCarousel;
window.openCalendarDayDrawer = openCalendarDayDrawer;
window.openCalendarFilteredDrawer = openCalendarFilteredDrawer;
window.closeCalendarDayDrawer = closeCalendarDayDrawer;
window.renderTournamentsCalendar = renderTournamentsCalendar;

// Mobile floating chat bubble auto-duck on downward scroll so bottom content is never obstructed
if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window._mobileChatDuckBound) {
  window._mobileChatDuckBound = true;
  let _lastMobScrollY = 0;
  let _duckIdleTimer = null;
  window.addEventListener('scroll', () => {
    if (window.innerWidth > 768) return;
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    const delta = y - _lastMobScrollY;
    if (delta > 8 && y > 90) {
      document.body.classList.add('mobile-scrolling-down');
    } else if (delta < -6 || y <= 40) {
      document.body.classList.remove('mobile-scrolling-down');
    }
    _lastMobScrollY = y;
    if (_duckIdleTimer) clearTimeout(_duckIdleTimer);
    _duckIdleTimer = setTimeout(() => {
      document.body.classList.remove('mobile-scrolling-down');
    }, 1400);
  }, { passive: true });
}

