/* ==========================================================================
   COMMUNITY.JS - Regional Community Hub, Local Leaderboard, Chat & Discovery (v1.0)
   Built by the community, for the community.
   ========================================================================== */

const communityState = {
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
  storesViewMode: 'both', // 'both', 'cards', 'map'
  storesMap: null,
  storesMarkers: [],
  storesInfoWindow: null,
  storesLoading: false,
  currentStoreTournaments: [],
  overview: null,
  isLoading: false,
  chatMessages: [],
  chatPollingInterval: null,
  isSendingChat: false
};

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

  // 2. Initialize LFG profile & Google Places for Sparring Radar if available
  if (typeof window.api?.getConnectProfile === 'function') {
    try {
      const res = await window.api.getConnectProfile();
      if (res && res.success && res.profile) {
        if (typeof connectState !== 'undefined') {
          connectState.userProfile = res.profile;
        }
        if (typeof renderTopBarOptions === 'function') {
          renderTopBarOptions(res.profile);
        }
        // If no saved coords, adopt from profile
        if (communityState.lat == null && res.profile.latitude && res.profile.longitude) {
          communityState.lat = parseFloat(res.profile.latitude);
          communityState.lng = parseFloat(res.profile.longitude);
          communityState.locationName = res.profile.home_venue_name || res.profile.city || 'My Location';
        }
      }
    } catch (e) {
      console.warn("Notice loading LFG profile for Community Hub:", e);
    }
  }

  // 3. Fallback default coordinates if neither localStorage nor profile set
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
  switchCommunitySubtab(subtab);

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
 * Load complete Community Hub data for coordinates and radius
 */
async function loadCommunityHub(lat = null, lng = null, radius = null, locationName = null) {
  communityState.isLoading = true;
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

  // Show responsive loading indicators ONLY in the active subview (lazy subtabs keep clean state)
  const tourneyView = document.getElementById('comm-tournaments-content');
  if (tourneyView && communityState.activeSubtab === 'tournaments') {
    tourneyView.innerHTML = `
      <div style="padding: 3rem 1rem; text-align: center; color: var(--text-muted);">
        <div class="spinner" style="margin: 0 auto 0.75rem;"></div>
        <div style="font-size: 0.95rem; font-weight: 600; color: #cbd5e1;">Finding Tournaments within ${communityState.radiusMiles} Miles of ${escapeHtml(communityState.locationName)}...</div>
      </div>
    `;
  }
  const sceneView = document.getElementById('comm-scene-content');
  if (sceneView && communityState.activeSubtab === 'scene') {
    sceneView.innerHTML = `
      <div style="padding: 3rem 1rem; text-align: center; color: var(--text-muted);">
        <div class="spinner" style="margin: 0 auto 0.75rem;"></div>
        <div style="font-size: 0.95rem; font-weight: 600; color: #cbd5e1;">Finding Competitors within ${communityState.radiusMiles} Miles of ${escapeHtml(communityState.locationName)}...</div>
      </div>
    `;
  }
  const playersGrid = document.getElementById('players-grid');
  if (playersGrid && communityState.activeSubtab === 'radar') {
    playersGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: #94a3b8;">
        <div style="font-size: 2rem; margin-bottom: 0.5rem; animation: spin 1s linear infinite; display: inline-block;">🧭</div>
        <div>Scanning local tabletop radar for active sparring partners within ${communityState.radiusMiles} miles...</div>
      </div>
    `;
  }
  const storesGrid = document.getElementById('comm-stores-grid');
  if (storesGrid && communityState.activeSubtab === 'stores') {
    storesGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
        <div class="spinner" style="margin: 0 auto 0.75rem;"></div>
        <div style="font-size: 0.95rem; font-weight: 600; color: #cbd5e1;">Finding Local Warhammer 40k Game Stores within ${communityState.radiusMiles} Miles...</div>
      </div>
    `;
  }

  try {
    const data = await API.getCommunityOverview(
      communityState.lat,
      communityState.lng,
      communityState.radiusMiles,
      communityState.locationName
    );
    if (!data || !data.success) {
      throw new Error(data?.error || 'Failed to load community data');
    }
    communityState.overview = data;

    // Update location details
    if (data.location?.location_name) {
      communityState.locationName = data.location.location_name;
    }
    if (data.location?.lat != null && data.location?.lng != null) {
      communityState.lat = parseFloat(data.location.lat);
      communityState.lng = parseFloat(data.location.lng);
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

    // Render current active subtab
    renderCurrentSubtab();

    // Auto-refresh Sparring Radar players count & data in background only if on radar subtab
    if (communityState.activeSubtab === 'radar' && typeof loadNearbyPlayers === 'function') {
      loadNearbyPlayers();
    }

    // Asynchronously fetch live BCP upcoming tournaments in background without blocking initial render
    fetchAndMergeBcpUpcoming(communityState.lat, communityState.lng, communityState.radiusMiles);
  } catch (err) {
    console.error('Failed to load community hub:', err);
    const tourneyView = document.getElementById('comm-tournaments-content');
    if (tourneyView) {
      tourneyView.innerHTML = `
        <div style="padding: 2.5rem 1rem; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border);">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
          <h4 style="color: #fff; margin-bottom: 0.4rem;">Unable to Load Local Tournaments</h4>
          <p style="font-size: 0.85rem; color: var(--text-secondary); max-width: 480px; margin: 0 auto 1.25rem;">
            ${escapeHtml(err.message || 'An unexpected error occurred while fetching tournament data.')}
          </p>
          <button class="btn btn-primary" onclick="loadCommunityHub()">🔄 Retry</button>
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
            ${escapeHtml(err.message || 'An unexpected error occurred while fetching competitor data.')}
          </p>
          <button class="btn btn-primary" onclick="loadCommunityHub()">🔄 Retry</button>
        </div>
      `;
    }
  } finally {
    communityState.isLoading = false;
  }
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

  if (badgeEl) badgeEl.textContent = `📍 ${rad}-Mile Tournament Radius`;
  if (titleEl) titleEl.textContent = `Local 40k Scene within ${rad} miles of ${locName}`;
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
 * Detect user's GPS coordinates via browser Geolocation
 */
function detectCommunityGPS() {
  const btn = document.getElementById('comm-btn-gps');
  const icon = document.getElementById('comm-gps-icon');
  const label = document.getElementById('comm-gps-label');

  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }

  if (btn) btn.disabled = true;
  if (icon) icon.textContent = '⏳';
  if (label) label.textContent = 'Locating...';

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      if (btn) btn.disabled = false;
      if (icon) icon.textContent = '🛰️';
      if (label) label.textContent = 'Use GPS';

      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      let locName = `GPS (${lat.toFixed(2)}, ${lng.toFixed(2)})`;

      // Attempt reverse geocoding with Google Geocoder if available
      if (typeof google !== 'undefined' && google.maps && google.maps.Geocoder) {
        try {
          const geocoder = new google.maps.Geocoder();
          const response = await new Promise((resolve) => {
            geocoder.geocode({ location: { lat, lng } }, (results, status) => {
              if (status === 'OK' && results && results[0]) {
                resolve(results[0]);
              } else {
                resolve(null);
              }
            });
          });
          if (response && response.address_components) {
            let city = '', state = '';
            for (const comp of response.address_components) {
              if (comp.types.includes('locality')) city = comp.long_name;
              if (comp.types.includes('administrative_area_level_1')) state = comp.short_name;
            }
            if (city && state) locName = `${city}, ${state}`;
            else if (city) locName = city;
          }
        } catch (e) {
          console.warn("Geocoder notice:", e);
        }
      }

      // 2. Fallback reverse geocoding via OpenStreetMap Nominatim if Google Geocoder wasn't available
      if (!locName || locName.startsWith('GPS (')) {
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=12`, {
            headers: { 'Accept': 'application/json' }
          });
          if (res.ok) {
            const data = await res.json();
            const addr = data.address || {};
            const city = addr.city || addr.town || addr.village || addr.suburb || addr.county;
            const state = addr.state || '';
            if (city && state) locName = `${city}, ${state}`;
            else if (city) locName = city;
          }
        } catch (e) {
          console.warn("Nominatim reverse geocode notice:", e);
        }
      }

      updateCommunityLocation(lat, lng, locName);
    },
    (err) => {
      console.warn('Geolocation error:', err);
      if (btn) btn.disabled = false;
      if (icon) icon.textContent = '🛰️';
      if (label) label.textContent = 'Use GPS';
      alert('Could not determine your GPS location. Please click "Change Location" to search for your city or store.');
    },
    { timeout: 10000, maximumAge: 60000 }
  );
}

/**
 * Updates active community location and saves to localStorage
 */
function updateCommunityLocation(lat, lng, locationName, radius = null) {
  let finalLat = (lat != null && !isNaN(parseFloat(lat))) ? parseFloat(lat) : null;
  let finalLng = (lng != null && !isNaN(parseFloat(lng))) ? parseFloat(lng) : null;

  if (locationName && (typeof lookupCityCoordinates === 'function')) {
    const resolved = lookupCityCoordinates(locationName);
    if (resolved) {
      if (finalLat == null || finalLng == null) {
        finalLat = resolved.lat;
        finalLng = resolved.lng;
      } else {
        // Cross-validate: if passed coordinates are > 75 miles away from the named city,
        // it's a stale coordinate mismatch! Override with resolved city coords.
        const dLat = (resolved.lat - finalLat) * 69.0;
        const dLng = (resolved.lng - finalLng) * 55.0;
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);
        if (dist > 75.0) {
          console.warn(`Location coordinate mismatch: "${locationName}" is ~${Math.round(dist)}mi away from coords (${finalLat}, ${finalLng}). Overriding with resolved city coords.`);
          finalLat = resolved.lat;
          finalLng = resolved.lng;
        }
      }
    }
  }

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
    communityState.radiusMiles = parseInt(radius, 10) || communityState.radiusMiles;
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

  loadCommunityHub(communityState.lat, communityState.lng, communityState.radiusMiles, communityState.locationName);

  if (communityState.activeSubtab === 'stores' && typeof loadLocalGameStores === 'function') {
    loadLocalGameStores(true);
  }
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
function switchCommunitySubtab(subtabName) {
  // If user requests chat or messages, forward to top-level tab
  if (subtabName === 'chat' || subtabName === 'messages' || subtabName === 'chats') {
    if (typeof switchTab === 'function') {
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

  renderCurrentSubtab();
}

/**
 * Renders the active subtab content
 */
function renderCurrentSubtab() {
  if (communityState.activeSubtab === 'radar') {
    if (typeof loadNearbyPlayers === 'function') loadNearbyPlayers();
  } else if (communityState.activeSubtab === 'tournaments') {
    renderCommunityEvents();
  } else if (communityState.activeSubtab === 'stores') {
    loadLocalGameStores();
  } else if (communityState.activeSubtab === 'scene') {
    renderCurrentSceneView();
  }
}

/**
 * --------------------------------------------------------------------------
 * SUBTAB 1: REGIONAL TOURNAMENTS & HISTORY
 * --------------------------------------------------------------------------
 */
function setCommunityEventsFilter(filter) {
  communityState.eventsFilter = filter;
  document.querySelectorAll('.comm-filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.filter === filter);
  });
  renderCommunityEvents();
}

function renderCommunityEvents() {
  const container = document.getElementById('comm-tournaments-content');
  if (!container) return;

  const overview = communityState.overview;
  if (!overview) {
    container.innerHTML = `
      <div style="padding: 3rem 1rem; text-align: center; color: var(--text-muted);">
        <div class="spinner" style="margin: 0 auto 0.75rem;"></div>
        <div style="font-size: 0.95rem; font-weight: 600; color: #cbd5e1;">Loading Regional Tournaments...</div>
      </div>
    `;
    return;
  }
  const upcoming = overview.events_upcoming || [];
  const recent = overview.events_recent || [];

  let displayedUpcoming = upcoming;
  let displayedRecent = recent;

  let venueFilterBanner = '';
  if (communityState.tournamentsVenueFilter) {
    const vf = communityState.tournamentsVenueFilter.toLowerCase();
    displayedUpcoming = displayedUpcoming.filter(ev => {
      const vName = `${ev.venue || ''} ${ev.venue_name || ''} ${ev.city || ''} ${ev.location || ''} ${ev.name || ''}`.toLowerCase();
      return vName.includes(vf) || vf.includes(vName);
    });
    displayedRecent = displayedRecent.filter(ev => {
      const vName = `${ev.venue || ''} ${ev.venue_name || ''} ${ev.city || ''} ${ev.location || ''} ${ev.name || ''}`.toLowerCase();
      return vName.includes(vf) || vf.includes(vName);
    });

    venueFilterBanner = `
      <div style="background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 8px; padding: 0.65rem 1rem; margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
        <div style="font-size: 0.85rem; color: #e0f2fe; display: flex; align-items: center; gap: 8px;">
          <span>🏪</span>
          <span>Showing tournaments hosted at: <strong>${escapeHtml(communityState.tournamentsVenueFilter)}</strong> (${displayedUpcoming.length} upcoming, ${displayedRecent.length} recent)</span>
        </div>
        <button onclick="clearTournamentsVenueFilter()" class="btn btn-outline" style="font-size: 0.75rem; padding: 0.25rem 0.65rem; color: #38bdf8;">✕ Clear Venue Filter</button>
      </div>
    `;
  }

  if (communityState.eventsFilter === 'upcoming') {
    displayedRecent = [];
  } else if (communityState.eventsFilter === 'recent') {
    displayedUpcoming = [];
  }

  const userElo = (typeof currentUser !== 'undefined' && currentUser && currentUser.current_elo)
    ? Number(currentUser.current_elo)
    : null;

  let html = `
    <!-- Subtab Header & Event Filter Chips -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.75rem;">
      <div>
        <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0; display: flex; align-items: center; gap: 8px;">
          <span>🏆 Local Tournaments</span>
          <span style="font-size: 0.75rem; color: #94a3b8; font-weight: 500;">(${upcoming.length} upcoming, ${recent.length} recent within ${communityState.radiusMiles} miles)</span>
        </h3>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
          Verified tournament scenes, Field Avg Elo ratings, and registered rosters within ${communityState.radiusMiles} miles
        </div>
      </div>

      <div style="display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap;">
        <button class="comm-filter-chip ${communityState.eventsFilter === 'all' ? 'active' : ''}" data-filter="all" onclick="setCommunityEventsFilter('all')">
          All Events (${upcoming.length + recent.length})
        </button>
        <button class="comm-filter-chip ${communityState.eventsFilter === 'upcoming' ? 'active' : ''}" data-filter="upcoming" onclick="setCommunityEventsFilter('upcoming')">
          Upcoming & Ongoing (${upcoming.length})
        </button>
        <button class="comm-filter-chip ${communityState.eventsFilter === 'recent' ? 'active' : ''}" data-filter="recent" onclick="setCommunityEventsFilter('recent')">
          Recent Results (${recent.length})
        </button>
      </div>
    </div>
    ${venueFilterBanner}
  `;

  // 1. Upcoming & Ongoing Section
  if (communityState.eventsFilter !== 'recent') {
    html += `
      <div style="margin-bottom: 2rem;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 0.85rem;">
          <span style="font-size: 0.76rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #38bdf8; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.25); padding: 3px 10px; border-radius: 9999px;">
            ⚡ UPCOMING & ONGOING TOURNAMENTS
          </span>
        </div>
    `;

    if (displayedUpcoming.length === 0) {
      html += `
        <div style="padding: 2.5rem 1rem; text-align: center; color: var(--text-muted); background: rgba(15, 23, 42, 0.5); border-radius: 10px; border: 1px dashed var(--border);">
          <div style="font-size: 1.8rem; margin-bottom: 0.5rem;">📅</div>
          <h4 style="color: #fff; margin-bottom: 0.4rem;">No Upcoming Tournaments within ${communityState.radiusMiles} Miles</h4>
          <p style="font-size: 0.82rem; color: #94a3b8; max-width: 480px; margin: 0 auto 1.25rem;">
            No upcoming tournaments currently scheduled within ${communityState.radiusMiles} miles of ${escapeHtml(communityState.locationName)}.
          </p>
          <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
            <button class="btn btn-primary" style="font-size: 0.78rem;" onclick="changeCommunityRadius(${Math.min(500, Math.round(communityState.radiusMiles * 2.5))})">Expand Radius to ${Math.min(500, Math.round(communityState.radiusMiles * 2.5))} Miles</button>
            <button class="btn btn-outline" style="font-size: 0.78rem;" onclick="openCommunityLocationModal()">Change Location</button>
          </div>
        </div>
      `;
    } else {
      html += `<div class="comm-events-grid">`;
      displayedUpcoming.forEach(ev => {
        html += renderTournamentCard(ev, true, userElo);
      });
      html += `</div>`;
    }
    html += `</div>`;
  }

  // 2. Recent Past Section
  if (communityState.eventsFilter !== 'upcoming') {
    html += `
      <div>
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 0.85rem;">
          <span style="font-size: 0.76rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #a855f7; background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.25); padding: 3px 10px; border-radius: 9999px;">
            📜 RECENT TOURNAMENT RESULTS & FIELD STATS
          </span>
        </div>
    `;

    if (displayedRecent.length === 0) {
      html += `
        <div style="padding: 2.5rem 1rem; text-align: center; color: var(--text-muted); background: rgba(15, 23, 42, 0.5); border-radius: 10px; border: 1px dashed var(--border);">
          <div style="font-size: 1.8rem; margin-bottom: 0.5rem;">📜</div>
          <h4 style="color: #fff; margin-bottom: 0.4rem;">No Recent Tournament Results within ${communityState.radiusMiles} Miles</h4>
          <p style="font-size: 0.82rem; color: #94a3b8; max-width: 480px; margin: 0 auto 1.25rem;">
            No past tournament records found within this radius. Try expanding your search radius to discover events in adjacent areas.
          </p>
          <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
            <button class="btn btn-primary" style="font-size: 0.78rem;" onclick="changeCommunityRadius(250)">Search 250 Miles</button>
            <button class="btn btn-outline" style="font-size: 0.78rem;" onclick="openCommunityLocationModal()">Change Location</button>
          </div>
        </div>
      `;
    } else {
      html += `<div class="comm-events-grid">`;
      displayedRecent.forEach(ev => {
        html += renderTournamentCard(ev, false, userElo);
      });
      html += `</div>`;
    }
    html += `</div>`;
  }

  container.innerHTML = html;

  // Asynchronously hydrate field stats (field avg Elo, top seed Elo, live roster count) for upcoming events
  if (displayedUpcoming && displayedUpcoming.length > 0) {
    const missingStats = displayedUpcoming.filter(ev => ev.avg_field_elo == null);
    if (missingStats.length > 0) {
      hydrateUpcomingFieldStats(missingStats.map(ev => ev.id), userElo);
    }
  }
}

function renderTournamentCard(ev, isUpcoming, userElo) {
  const dateStr = ev.event_date ? ev.event_date.slice(0, 10) : 'TBD';
  const loc = [ev.venue, ev.city, ev.state].filter(Boolean).join(', ') || 'Unspecified Location';
  const fieldAvg = ev.avg_field_elo ? Math.round(Number(ev.avg_field_elo)) : null;
  const topSeed = ev.top_seed_elo ? Math.round(Number(ev.top_seed_elo)) : null;
  const distance = ev.distance_miles != null ? Number(ev.distance_miles).toFixed(1) : null;

  // Delta calculation relative to user Elo
  let deltaMarkup = '';
  if (fieldAvg && userElo) {
    const diff = Math.round(userElo - fieldAvg);
    if (diff > 0) {
      deltaMarkup = `<span style="font-size: 0.72rem; color: #10b981; font-weight: 700; margin-left: 4px;" title="You are rated +${diff} above this tournament's average field">(+${diff} vs your Elo)</span>`;
    } else if (diff < 0) {
      deltaMarkup = `<span style="font-size: 0.72rem; color: #f43f5e; font-weight: 700; margin-left: 4px;" title="This field average is ${Math.abs(diff)} points above your current Elo">(${diff} vs your Elo)</span>`;
    } else {
      deltaMarkup = `<span style="font-size: 0.72rem; color: #94a3b8; font-weight: 700; margin-left: 4px;">(Even with your Elo)</span>`;
    }
  }

  return `
    <div class="comm-event-card">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.6rem;">
        <span class="badge" style="background: ${isUpcoming ? 'rgba(56,189,248,0.12)' : 'rgba(255,255,255,0.06)'}; color: ${isUpcoming ? '#38bdf8' : '#94a3b8'}; border: 1px solid ${isUpcoming ? 'rgba(56,189,248,0.3)' : 'rgba(255,255,255,0.1)'}; font-size: 0.72rem; font-family: monospace;">
          📅 ${escapeHtml(dateStr)}
        </span>
        <div style="display: flex; gap: 4px; align-items: center;">
          ${distance ? `
            <span class="badge" style="background: rgba(56,189,248,0.1); color: #38bdf8; border: 1px solid rgba(56,189,248,0.25); font-size: 0.7rem; font-weight: 700;">
              🚗 ${distance} mi
            </span>
          ` : ''}
          <span class="badge" style="background: rgba(16,185,129,0.1); color: #10b981; border: 1px solid rgba(16,185,129,0.25); font-size: 0.7rem;">
            ${isUpcoming ? '⚡ Upcoming' : '✓ Completed'}
          </span>
        </div>
      </div>

      <h4 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0 0 0.35rem; line-height: 1.35;">
        ${escapeHtml(ev.name || 'Warhammer 40k Tournament')}
      </h4>

      <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.85rem; display: flex; align-items: center; gap: 6px;">
        <span>📍</span>
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(loc)}</span>
      </div>

      <!-- Field Avg Elo & Top Seed Highlights -->
      <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 0.65rem 0.85rem; margin-bottom: 1rem; display: flex; flex-direction: column; gap: 4px;">
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem;">
          <span style="color: #94a3b8;">⭐ Field Avg:</span>
          <span id="field-avg-${escapeHtml(ev.id)}" style="font-weight: 800; color: #fff; font-family: monospace;">
            ${fieldAvg ? `${fieldAvg} Elo ${deltaMarkup}` : (isUpcoming ? (ev.total_players > 0 ? `<span class="field-avg-computing" style="color: #38bdf8; font-weight: 600; font-size: 0.76rem; display: inline-flex; align-items: center; gap: 4px;"><span class="spinner-mini" style="display: inline-block; width: 9px; height: 9px; border: 1.5px solid rgba(56,189,248,0.25); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite;"></span><span>Computing Field...</span></span>` : '<span style="color: #64748b; font-weight: 500; font-size: 0.78rem;">Registration Open</span>') : '<span style="color: #64748b; font-weight: 500; font-size: 0.78rem;">Unrated Field</span>')}
          </span>
        </div>
        <div id="top-seed-container-${escapeHtml(ev.id)}" style="${topSeed ? '' : 'display: none;'}">
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem;">
            <span style="color: #94a3b8;">👑 Top Seed:</span>
            <span id="top-seed-val-${escapeHtml(ev.id)}" style="font-weight: 700; color: #f59e0b; font-family: monospace;">${topSeed ? `${topSeed} Elo` : ''}</span>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.76rem; color: #64748b; margin-top: 2px;">
          <span id="competitors-count-${escapeHtml(ev.id)}">👥 ${ev.total_players || 0} Competitor${ev.total_players === 1 ? '' : 's'}</span>
          <span>⚔️ ${ev.num_rounds || 0} Swiss Rounds</span>
        </div>
      </div>

      <!-- Actions -->
      <div style="display: flex; gap: 0.5rem; margin-top: auto;">
        <button class="btn btn-primary" style="flex: 1; font-size: 0.78rem; padding: 0.45rem 0.75rem; justify-content: center; font-weight: 700;" onclick="openEventModal('${escapeHtml(ev.id)}', false, 'elo')">
          📋 Roster & Details
        </button>
        <a href="https://www.bestcoastpairings.com/event/${encodeURIComponent(ev.id)}" target="_blank" rel="noopener" class="btn btn-outline" style="font-size: 0.78rem; padding: 0.45rem 0.65rem; color: #94a3b8;" title="View on Best Coast Pairings">
          🔗 BCP
        </a>
      </div>
    </div>
  `;
}

/**
 * Asynchronously loads field stats (average Elo, top seed Elo, enrolled players) for upcoming tournaments
 */
async function hydrateUpcomingFieldStats(eventIds, userElo) {
  if (!eventIds || eventIds.length === 0) return;
  if (!communityState.fieldStatsHydrating) {
    communityState.fieldStatsHydrating = new Set();
  }

  const toFetch = eventIds.filter(id => id && !communityState.fieldStatsHydrating.has(id));
  if (toFetch.length === 0) return;

  toFetch.forEach(id => communityState.fieldStatsHydrating.add(id));

  try {
    const res = await window.api.getEventsFieldStats(toFetch);
    if (!res || !res.success || !res.stats) return;

    const stats = res.stats;
    Object.keys(stats).forEach(eid => {
      const data = stats[eid];
      if (!data) return;

      // Update in communityState.overview.events_upcoming
      if (communityState.overview && Array.isArray(communityState.overview.events_upcoming)) {
        const ev = communityState.overview.events_upcoming.find(e => String(e.id) === String(eid));
        if (ev) {
          if (data.avg_field_elo != null) ev.avg_field_elo = data.avg_field_elo;
          if (data.top_seed_elo != null) ev.top_seed_elo = data.top_seed_elo;
          if (data.total_enrolled != null && data.total_enrolled > (ev.total_players || 0)) {
            ev.total_players = data.total_enrolled;
          }
        }
      }

      // Update DOM element for Field Avg
      const avgEl = document.getElementById(`field-avg-${eid}`);
      if (avgEl) {
        if (data.avg_field_elo != null && data.rated_players_count > 0) {
          const avg = Math.round(Number(data.avg_field_elo));
          let delta = '';
          if (userElo) {
            const diff = Math.round(userElo - avg);
            if (diff > 0) {
              delta = `<span style="font-size: 0.72rem; color: #10b981; font-weight: 700; margin-left: 4px;" title="You are rated +${diff} above this tournament's average field">(+${diff} vs your Elo)</span>`;
            } else if (diff < 0) {
              delta = `<span style="font-size: 0.72rem; color: #f43f5e; font-weight: 700; margin-left: 4px;" title="This field average is ${Math.abs(diff)} points above your current Elo">(${diff} vs your Elo)</span>`;
            } else {
              delta = `<span style="font-size: 0.72rem; color: #94a3b8; font-weight: 700; margin-left: 4px;">(Even with your Elo)</span>`;
            }
          }
          avgEl.innerHTML = `${avg} Elo ${delta}`;
        } else if (data.total_enrolled > 0) {
          avgEl.innerHTML = `<span style="color: #94a3b8; font-weight: 600; font-size: 0.78rem;">Provisional Field (${data.total_enrolled} ${data.total_enrolled === 1 ? 'player' : 'players'})</span>`;
        } else {
          avgEl.innerHTML = `<span style="color: #64748b; font-weight: 500; font-size: 0.78rem;">Registration Open</span>`;
        }
      }

      // Update DOM element for Top Seed
      const topSeedContainer = document.getElementById(`top-seed-container-${eid}`);
      const topSeedVal = document.getElementById(`top-seed-val-${eid}`);
      if (topSeedContainer && topSeedVal && data.top_seed_elo != null && data.rated_players_count > 0) {
        topSeedVal.innerText = `${Math.round(Number(data.top_seed_elo))} Elo`;
        topSeedContainer.style.display = '';
      }

      // Update DOM element for Competitors Count
      const countEl = document.getElementById(`competitors-count-${eid}`);
      if (countEl && data.total_enrolled != null && data.total_enrolled > 0) {
        countEl.innerText = `👥 ${data.total_enrolled} Competitor${data.total_enrolled === 1 ? '' : 's'}`;
      }
    });
  } catch (err) {
    console.debug('Notice hydrating upcoming field stats:', err);
  } finally {
    toFetch.forEach(id => communityState.fieldStatsHydrating.delete(id));
  }
}

/**
 * Asynchronously fetches live BCP upcoming tournaments in background and merges them
 */
async function fetchAndMergeBcpUpcoming(lat, lng, radiusMiles) {
  if (lat == null || lng == null) return;
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
        if (bEv.distance_miles != null && cur.distance_miles == null) {
          cur.distance_miles = bEv.distance_miles;
          updated = true;
        }
        if (updated) hasNewOrUpdated = true;
      } else {
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
  const competitors = overview?.local_competitors || [];
  const rad = overview?.location?.radius_miles || communityState.radiusMiles || 50;
  const locName = overview?.location?.location_name || communityState.locationName || 'Your Location';
  const disclaimer = overview?.disclaimer || (
    `Competitors surfaced here based on verified tournament participation and event rosters within ${rad} miles of ${locName}. ` +
    "Linking your BCP account enables automatic local matching and tournament tracking."
  );

  let html = `
    <!-- Verified Tournament Participation Disclaimer -->
    <div class="comm-disclaimer-card">
      <div style="font-size: 1.4rem; line-height: 1; color: #38bdf8;">ℹ️</div>
      <div>
        <div style="font-weight: 800; color: #fff; font-size: 0.88rem; margin-bottom: 0.2rem;">
          Verified Tournament Competitor Discovery
        </div>
        <div style="font-size: 0.82rem; color: #cbd5e1; line-height: 1.5;">
          ${escapeHtml(disclaimer)}
        </div>
      </div>
    </div>

    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.5rem;">
      <div>
        <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0; display: flex; align-items: center; gap: 8px;">
          <span>👥 Shared Tournament Competitors</span>
          <span style="font-size: 0.75rem; color: #94a3b8; font-weight: 500;">(${competitors.length} active players within ${rad} miles)</span>
        </h3>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
          Tabletop players identified through tournament participation within ${rad} miles of ${escapeHtml(locName)} &bull; Sorted by account status &amp; Elo closeness
        </div>
      </div>
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
      <button class="btn btn-primary" style="width: 100%; font-size: 0.78rem; padding: 0.48rem 0.75rem; justify-content: center; font-weight: 700;" onclick="challengeCompetitor('${escapeHtml(c.player_id)}', '${escapeHtml(name)}')">
        💬 Challenge / Chat
      </button>
    `;
  } else {
    actionButton = `
      <button class="btn btn-outline" style="width: 100%; font-size: 0.78rem; padding: 0.48rem 0.75rem; justify-content: center; color: #94a3b8; border-color: rgba(255,255,255,0.15); background: rgba(255,255,255,0.02);" onclick="showUnregisteredCompetitorAlert('${escapeHtml(name)}')">
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
        <div class="comm-player-avatar" onclick="openPlayerModal('${escapeHtml(c.player_id)}')" title="View profile for ${escapeHtml(name)}">
          ${escapeHtml(initials)}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 800; font-size: 1.02rem; color: #fff; line-height: 1.3; cursor: pointer; word-break: break-word;" onclick="openPlayerModal('${escapeHtml(c.player_id)}')" title="Click to view profile">
            ${escapeHtml(name)}
          </div>
          <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-top: 5px;">
            <span class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3); font-size: 0.72rem; font-weight: 800; padding: 2px 7px;" title="Local Elo Rating calculated across regional tournament circuit">
              📍 ${localElo} Local
            </span>
            ${provBadge}
            <span class="badge" style="background: rgba(255,255,255,0.06); color: #94a3b8; border: 1px solid rgba(255,255,255,0.12); font-size: 0.70rem; font-weight: 600; padding: 2px 6px;" title="Global Rating: ${globalElo}">
              🌐 ${globalElo}
            </span>
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
 * Trigger match challenge or redirect to OmniConnect
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
    container.innerHTML = `
      <div style="padding: 3rem 1rem; text-align: center; color: var(--text-muted);">
        <div class="spinner" style="margin: 0 auto 0.75rem;"></div>
        <div style="font-size: 0.95rem; font-weight: 600; color: #cbd5e1;">Loading Regional Scene Intel...</div>
      </div>
    `;
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
  const teams = overview?.local_teams_leaderboard || [];
  const rad = overview?.location?.radius_miles || communityState.radiusMiles || 50;
  const locName = overview?.location?.location_name || communityState.locationName || 'Your Location';

  let html = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.5rem;">
      <div>
        <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0; display: flex; align-items: center; gap: 8px;">
          <span>🛡️ Local Team Leaderboard</span>
          <span style="font-size: 0.75rem; color: #94a3b8; font-weight: 500;">(${teams.length} clubs & teams within ${rad} miles)</span>
        </h3>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
          Active gaming clubs and teams ranked by average competitor Elo across tournaments within ${rad} miles of ${escapeHtml(locName)}
        </div>
      </div>
    </div>

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
    teams.forEach(t => {
      const rank = t.rank;
      let rankDisplay = `#${rank}`;
      if (rank === 1) rankDisplay = '🥇 1';
      else if (rank === 2) rankDisplay = '🥈 2';
      else if (rank === 3) rankDisplay = '🥉 3';

      const avgElo = t.avg_elo ? Math.round(Number(t.avg_elo)) : 1500;
      const topElo = t.top_player_elo ? Math.round(Number(t.top_player_elo)) : avgElo;
      const winRate = t.team_win_rate != null ? `${Number(t.team_win_rate).toFixed(1)}%` : '-';
      const membersCount = t.local_members_count || 1;
      const eventsCount = t.regional_events_count || 1;
      const topName = t.top_player_name || 'Competitor';

      html += `
        <tr onclick="if(typeof openTeamModal==='function') openTeamModal('${escapeHtml(t.team_name)}')" style="cursor: pointer;">
          <td style="text-align: center; font-weight: 800; font-family: monospace; color: ${rank <= 3 ? '#f59e0b' : '#94a3b8'};">
            ${rankDisplay}
          </td>
          <td>
            <div style="font-weight: 700; color: #fff; display: flex; align-items: center; gap: 6px;">
              <span>🛡️</span>
              <span>${escapeHtml(t.team_name)}</span>
            </div>
          </td>
          <td style="text-align: center; color: #cbd5e1; font-weight: 600;">
            ${membersCount} player${membersCount > 1 ? 's' : ''}
          </td>
          <td>
            <div style="color: #fff; font-weight: 600;">${escapeHtml(topName)}</div>
            <div style="font-size: 0.72rem; color: #f59e0b; font-family: monospace; font-weight: 700;">${topElo} Elo</div>
          </td>
          <td style="font-weight: 800; color: #38bdf8; font-family: monospace;">
            ${avgElo}
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
  const locName = overview?.location?.location_name || communityState.locationName || 'Your Location';

  let html = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.5rem;">
      <div>
        <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0; display: flex; align-items: center; gap: 8px;">
          <span>👑 Local Player Standings</span>
          <span style="font-size: 0.75rem; color: #94a3b8; font-weight: 500;">(${leaderboard.length} ranked competitors within ${rad} miles)</span>
        </h3>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
          Dynamic circuit ratings and match records calculated strictly from tournaments within ${rad} miles of ${escapeHtml(locName)}
        </div>
      </div>
    </div>

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
    leaderboard.forEach(row => {
      const rank = row.rank;
      let rankDisplay = `#${rank}`;
      if (rank === 1) rankDisplay = '🥇 1';
      else if (rank === 2) rankDisplay = '🥈 2';
      else if (rank === 3) rankDisplay = '🥉 3';

      const localElo = row.local_elo ? Math.round(Number(row.local_elo)) : 1500;
      const localMatches = row.local_matches || 0;
      const localWinRate = (row.local_win_rate != null && localMatches > 0) ? `${Number(row.local_win_rate).toFixed(1)}%` : '-';
      const localRecord = row.local_record || '0-0-0';
      const globalElo = row.current_elo ? Math.round(Number(row.current_elo)) : 1500;
      const globalPeak = row.peak_elo ? Math.round(Number(row.peak_elo)) : globalElo;

      const isSelf = (typeof currentUser !== 'undefined' && currentUser && (currentUser.player_id === row.player_id || currentUser.id === row.account_user_id));
      const chatPill = (row.has_account && !isSelf) ? `
        <button type="button" class="btn-chat-pill" title="Send Chat Request" onclick="event.stopPropagation(); handlePlayerChatClick('${escapeHtml(row.player_id)}', '${escapeHtml(row.player_name || '')}', '${row.account_user_id || ''}')">
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

      html += `
        <tr onclick="openPlayerModal('${escapeHtml(row.player_id)}')" style="cursor: pointer;">
          <td style="text-align: center; font-weight: 800; font-family: monospace; color: ${rank <= 3 ? '#f59e0b' : '#94a3b8'};">
            ${rankDisplay}
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
              <div style="font-weight: 700; color: #fff;">${escapeHtml(row.player_name || 'Competitor')}</div>
              ${chatPill}
            </div>
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px;">
              ${row.team ? `<span style="font-size: 0.72rem; color: #94a3b8;">${escapeHtml(row.team)}</span>` : ''}
              ${row.has_shared_events ? `<span style="font-size: 0.68rem; color: #10b981; font-weight: 700;">★ Shared Tournament Competitor</span>` : ''}
            </div>
          </td>
          <td style="font-weight: 800; color: #38bdf8; font-family: monospace; white-space: nowrap;">
            <span>${localElo}</span>
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
            <div style="display: inline-flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 2px 6px; font-family: monospace; font-size: 0.75rem; color: #cbd5e1;" title="Global Rating: ${globalElo} (Peak: ${globalPeak})">
              <span>🌐</span> <strong>${globalElo}</strong>
            </div>
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

function renderCurrentChatView() {
  renderCommunityChat();
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
        }
      }
    } catch (e) {}
  }

  const grid = document.getElementById('comm-stores-grid');
  if (grid && (!communityState.stores || communityState.stores.length === 0 || forceRefresh)) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
        <div class="spinner" style="margin: 0 auto 0.75rem;"></div>
        <div style="font-size: 0.95rem; font-weight: 600; color: #cbd5e1;">Finding Local Warhammer 40k Game Stores within ${communityState.radiusMiles} Miles...</div>
      </div>
    `;
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
      <div id="store-website-row-${escapeHtml(store.id)}" style="font-size: 0.78rem; color: #38bdf8; margin-bottom: 0.75rem; display: ${store.website ? 'flex' : 'none'}; align-items: center; gap: 6px; line-height: 1.4;">
        <span style="font-size: 0.9rem; flex-shrink: 0;">🌐</span>
        ${store.website ? `
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

        <button onclick="setStoreAsMatchmakingLocation('${escapeHtml(store.id)}')" class="comm-store-btn" style="margin-left: auto; color: #38bdf8;" title="Set this store as your primary matchmaking location in OmniConnect">
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
  document.querySelectorAll('.comm-store-filters .comm-filter-chip').forEach(btn => {
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
    const isEnded = ev.is_ended || (ev.event_date && new Date(ev.event_date) < new Date());
    const winnerName = ev.winner_name;
    const winnerFaction = ev.winner_faction;
    const totalPlayers = ev.total_players || 0;
    const numRounds = ev.num_rounds || 0;

    html += `
      <div class="comm-store-tourney-card" style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 0.9rem 1.15rem; transition: all 0.2s;" onmouseover="this.style.borderColor='rgba(56,189,248,0.4)'; this.style.background='rgba(15,23,42,0.85)';" onmouseout="this.style.borderColor='rgba(255,255,255,0.08)'; this.style.background='rgba(15,23,42,0.6)';">
        <!-- Top meta bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.45rem; flex-wrap: wrap; gap: 6px;">
          <span class="badge" style="background: rgba(255, 255, 255, 0.06); color: #94a3b8; border: 1px solid rgba(255, 255, 255, 0.1); font-size: 0.72rem; font-family: monospace;">
            📅 ${escapeHtml(dateStr)}
          </span>
          <div style="display: flex; gap: 6px; align-items: center;">
            <span class="badge" style="background: ${isEnded ? 'rgba(16,185,129,0.1)' : 'rgba(56,189,248,0.1)'}; color: ${isEnded ? '#10b981' : '#38bdf8'}; border: 1px solid ${isEnded ? 'rgba(16,185,129,0.25)' : 'rgba(56,189,248,0.25)'}; font-size: 0.7rem; font-weight: 700;">
              ${isEnded ? '✓ Completed' : '⚡ Upcoming'}
            </span>
            <span class="badge" style="background: rgba(148,163,184,0.1); color: #cbd5e1; border: 1px solid rgba(148,163,184,0.2); font-size: 0.7rem;">
              ${escapeHtml(ev.event_type || 'Singles')}
            </span>
          </div>
        </div>

        <!-- Tournament Title -->
        <h4 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0 0 0.5rem; line-height: 1.35; cursor: pointer;" onclick="openEventModal('${escapeHtml(ev.id)}', false, 'elo')">
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
          <button class="btn btn-primary" style="flex: 1; font-size: 0.78rem; padding: 0.42rem 0.8rem; justify-content: center; font-weight: 700;" onclick="openEventModal('${escapeHtml(ev.id)}', false, 'elo')">
            📋 View Bracket &amp; Roster
          </button>
          <a href="https://www.bestcoastpairings.com/event/${encodeURIComponent(ev.id)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="font-size: 0.78rem; padding: 0.42rem 0.7rem; color: #94a3b8; display: inline-flex; align-items: center; gap: 4px;" title="Open this event on Best Coast Pairings">
            <span>🔗 BCP</span>
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
window.changeCommunityRadius = changeCommunityRadius;
window.detectCommunityGPS = detectCommunityGPS;
window.updateCommunityLocation = updateCommunityLocation;
window.openCommunityLocationModal = openCommunityLocationModal;
window.switchCommunitySubtab = switchCommunitySubtab;
window.setCommunityEventsFilter = setCommunityEventsFilter;
window.challengeCompetitor = challengeCompetitor;
window.showUnregisteredCompetitorAlert = showUnregisteredCompetitorAlert;
window.setCommunitySceneView = setCommunitySceneView;
window.renderCommunityTeamsLeaderboard = renderCommunityTeamsLeaderboard;
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
window.hydrateUpcomingFieldStats = hydrateUpcomingFieldStats;
window.onGoogleMapsScriptLoaded = onGoogleMapsScriptLoaded;

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

