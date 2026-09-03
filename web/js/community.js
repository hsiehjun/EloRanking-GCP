/* ==========================================================================
   COMMUNITY.JS - Regional Community Hub, Local Leaderboard, Chat & Discovery (v1.0)
   Built by the community, for the community.
   ========================================================================== */

const communityState = {
  lat: null,
  lng: null,
  radiusMiles: 100,
  locationName: 'San Diego, CA',
  activeSubtab: 'radar', // 'radar', 'tournaments', 'scene', 'chat'
  sceneView: 'leaderboard', // 'leaderboard', 'competitors'
  chatMode: 'regional', // 'regional', 'direct'
  eventsFilter: 'all', // 'all', 'upcoming', 'recent'
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
  const savedRad = localStorage.getItem('comm_radius');
  const savedLoc = localStorage.getItem('comm_loc_name');

  if (savedLat && savedLng) {
    communityState.lat = parseFloat(savedLat);
    communityState.lng = parseFloat(savedLng);
  }
  if (savedRad) {
    communityState.radiusMiles = parseInt(savedRad, 10) || 100;
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
    communityState.radiusMiles = parseInt(radius, 10) || 100;
  }
  if (locationName != null) {
    communityState.locationName = locationName;
  }

  // Sync radius select dropdown
  const radSelect = document.getElementById('comm-radius-select');
  if (radSelect && radSelect.value !== String(communityState.radiusMiles)) {
    radSelect.value = String(communityState.radiusMiles);
  }

  // Show loading indicator in target subviews if overview is not yet cached
  if (!communityState.overview) {
    const tourneyView = document.getElementById('comm-tournaments-content');
    if (tourneyView) {
      tourneyView.innerHTML = `
        <div style="padding: 3rem 1rem; text-align: center; color: var(--text-muted);">
          <div class="spinner" style="margin: 0 auto 0.75rem;"></div>
          <div style="font-size: 0.95rem; font-weight: 600; color: #cbd5e1;">Finding Tournaments within ${communityState.radiusMiles} Miles...</div>
        </div>
      `;
    }
    const sceneView = document.getElementById('comm-scene-content');
    if (sceneView) {
      sceneView.innerHTML = `
        <div style="padding: 3rem 1rem; text-align: center; color: var(--text-muted);">
          <div class="spinner" style="margin: 0 auto 0.75rem;"></div>
          <div style="font-size: 0.95rem; font-weight: 600; color: #cbd5e1;">Finding Competitors within ${communityState.radiusMiles} Miles...</div>
        </div>
      `;
    }
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

    // Render region/location header info
    renderCommunityHeader(data.location || data.region);

    // Update title in chat header
    const chatTitle = document.getElementById('comm-chat-region-title');
    if (chatTitle) {
      chatTitle.textContent = `${communityState.locationName || 'Local'} Community Chat`;
    }

    // Render current active subtab
    renderCurrentSubtab();
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

  const rad = locInfo?.radius_miles || communityState.radiusMiles || 100;
  const locName = locInfo?.location_name || locInfo?.name || communityState.locationName || 'Your Location';

  if (badgeEl) badgeEl.textContent = `📍 ${rad}-Mile Tournament Radius`;
  if (titleEl) titleEl.textContent = `Tournaments within ${rad} miles of ${locName}`;
  if (descEl) descEl.textContent = `Showing verified upcoming & recent tournaments, local competitor rosters, and standings within ${rad} miles.`;
  const userLocEl = document.getElementById('user-location-text');
  if (userLocEl && locName) userLocEl.textContent = locName;
}

/**
 * Change search radius (25, 50, 100, 250, 500 mi)
 */
function changeCommunityRadius(radius) {
  const r = parseInt(radius, 10) || 100;
  communityState.radiusMiles = r;
  localStorage.setItem('comm_radius', String(r));
  const select = document.getElementById('comm-radius-select');
  if (select) select.value = String(r);
  const modalRadius = document.getElementById('modal-lfg-radius');
  if (modalRadius) modalRadius.value = String(r);
  const filterRadius = document.getElementById('filter-radius');
  if (filterRadius) filterRadius.value = String(r);

  loadCommunityHub(communityState.lat, communityState.lng, r, communityState.locationName);

  if (typeof loadNearbyPlayers === 'function') {
    loadNearbyPlayers();
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
  if (lat == null || lng == null) return;
  communityState.lat = parseFloat(lat);
  communityState.lng = parseFloat(lng);
  if (locationName) communityState.locationName = locationName;
  if (radius) communityState.radiusMiles = parseInt(radius, 10) || communityState.radiusMiles;

  localStorage.setItem('comm_lat', String(lat));
  localStorage.setItem('comm_lng', String(lng));
  if (locationName) localStorage.setItem('comm_loc_name', locationName);
  if (radius) localStorage.setItem('comm_radius', String(communityState.radiusMiles));

  loadCommunityHub(communityState.lat, communityState.lng, communityState.radiusMiles, communityState.locationName);
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
  // Normalize alias names
  if (subtabName === 'players' || subtabName === 'sparring') subtabName = 'radar';
  if (subtabName === 'events') subtabName = 'tournaments';
  if (subtabName === 'competitors') {
    subtabName = 'scene';
    communityState.sceneView = 'competitors';
  } else if (subtabName === 'teams') {
    subtabName = 'scene';
    communityState.sceneView = 'teams';
  } else if (subtabName === 'leaderboard') {
    subtabName = 'scene';
    communityState.sceneView = 'leaderboard';
  } else if (subtabName === 'messages') {
    subtabName = 'chat';
  }

  communityState.activeSubtab = subtabName;

  // Toggle subtab buttons
  document.querySelectorAll('.comm-subtab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.subtab === subtabName);
  });

  // Toggle subviews
  const subviews = ['radar', 'tournaments', 'scene', 'chat'];
  subviews.forEach(s => {
    const el = document.getElementById(`comm-subview-${s}`);
    if (el) el.style.display = (s === subtabName) ? 'block' : 'none';
  });

  // Stop chat polling if leaving chat subtab
  if (subtabName !== 'chat') {
    stopCommunityChatPolling();
    if (typeof stopChatPolling === 'function') stopChatPolling();
    if (typeof detachChatSnapshot === 'function') detachChatSnapshot();
  }

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
  } else if (communityState.activeSubtab === 'scene') {
    renderCurrentSceneView();
  } else if (communityState.activeSubtab === 'chat') {
    renderCurrentChatView();
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
          <span style="font-weight: 800; color: #fff; font-family: monospace;">
            ${fieldAvg ? `${fieldAvg} Elo` : 'Calculating...'}
            ${deltaMarkup}
          </span>
        </div>
        ${topSeed ? `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem;">
            <span style="color: #94a3b8;">👑 Top Seed:</span>
            <span style="font-weight: 700; color: #f59e0b; font-family: monospace;">${topSeed} Elo</span>
          </div>
        ` : ''}
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.76rem; color: #64748b; margin-top: 2px;">
          <span>👥 ${ev.total_players || 0} Competitors</span>
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
 * --------------------------------------------------------------------------
 * SUBTAB 2: LOCAL COMPETITORS & SPARRING DISCOVERY
 * --------------------------------------------------------------------------
 */
function renderCommunityCompetitors() {
  const container = document.getElementById('comm-scene-content');
  if (!container) return;

  const overview = communityState.overview;
  const competitors = overview?.local_competitors || [];
  const rad = overview?.location?.radius_miles || communityState.radiusMiles || 100;
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
  const elo = c.current_elo ? Math.round(Number(c.current_elo)) : 1500;
  const peak = c.peak_elo ? Math.round(Number(c.peak_elo)) : elo;
  const faction = c.top_faction || 'Unknown Faction';
  const name = c.player_name || 'Tournament Competitor';
  const initials = name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '40K';
  const winRate = c.win_rate != null ? Number(c.win_rate).toFixed(1) : '-';

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
      <span class="badge" style="background: rgba(168, 85, 247, 0.14); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.28); font-size: 0.68rem; font-weight: 700;" title="Rating difference compared to your ${Math.round(c.user_elo)} Elo">
        Δ ${absDiff} (${sign})
      </span>
    `;
  }

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
            <span class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3); font-size: 0.72rem; font-weight: 800; padding: 2px 7px;">
              ${elo} Elo
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
        <div style="font-size: 0.74rem; color: #64748b; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 5px;">
          <span>Peak: <strong style="color: #cbd5e1;">${peak} Elo</strong></span>
          <span>Win Rate: <strong style="color: #10b981;">${winRate}%</strong></span>
        </div>
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
  const rad = overview?.location?.radius_miles || communityState.radiusMiles || 100;
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
  const rad = overview?.location?.radius_miles || communityState.radiusMiles || 100;
  const locName = overview?.location?.location_name || communityState.locationName || 'Your Location';

  let html = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.5rem;">
      <div>
        <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0; display: flex; align-items: center; gap: 8px;">
          <span>👑 Local Player Standings</span>
          <span style="font-size: 0.75rem; color: #94a3b8; font-weight: 500;">(${leaderboard.length} ranked competitors within ${rad} miles)</span>
        </h3>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
          Top rated tournament players actively competing in tournaments within ${rad} miles of ${escapeHtml(locName)}
        </div>
      </div>
    </div>

    <div class="table-container comm-table-container">
      <table id="comm-leaderboard-table" class="data-table">
        <thead>
          <tr>
            <th style="width: 65px; text-align: center;">Rank</th>
            <th>Competitor</th>
            <th>Current Elo</th>
            <th>Peak Elo</th>
            <th>Primary Faction</th>
            <th>Team / Club</th>
            <th>Local Events</th>
            <th>Win Rate</th>
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

      const elo = row.current_elo ? Math.round(Number(row.current_elo)) : 1500;
      const peak = row.peak_elo ? Math.round(Number(row.peak_elo)) : elo;
      const winRate = row.win_rate != null ? `${Number(row.win_rate).toFixed(1)}%` : '-';

      html += `
        <tr onclick="openPlayerModal('${escapeHtml(row.player_id)}')" style="cursor: pointer;">
          <td style="text-align: center; font-weight: 800; font-family: monospace; color: ${rank <= 3 ? '#f59e0b' : '#94a3b8'};">
            ${rankDisplay}
          </td>
          <td>
            <div style="font-weight: 700; color: #fff;">${escapeHtml(row.player_name || 'Competitor')}</div>
            ${row.has_shared_events ? `<span style="font-size: 0.68rem; color: #10b981; font-weight: 700;">★ Shared Tournament Competitor</span>` : ''}
          </td>
          <td style="font-weight: 800; color: #38bdf8; font-family: monospace;">
            ${elo}
          </td>
          <td style="color: #94a3b8; font-family: monospace;">
            ${peak}
          </td>
          <td style="color: #cbd5e1;">
            ${escapeHtml(row.top_faction || 'Unknown')}
          </td>
          <td style="color: #94a3b8;">
            ${escapeHtml(row.team || '-')}
          </td>
          <td style="text-align: center; color: #cbd5e1;">
            ${row.regional_events_count || 1}
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

/**
 * --------------------------------------------------------------------------
 * SUBTAB 4: MESSAGES & CHAT (REGIONAL TOWN HALL + DIRECT MATCH CHATS)
 * --------------------------------------------------------------------------
 */
function setCommunityChatMode(mode) {
  communityState.chatMode = mode;
  const btnReg = document.getElementById('comm-chat-toggle-regional');
  const btnDir = document.getElementById('comm-chat-toggle-direct');
  const panelReg = document.getElementById('comm-chat-panel-regional');
  const panelDir = document.getElementById('comm-chat-panel-direct');

  if (btnReg) btnReg.classList.toggle('active', mode === 'regional');
  if (btnDir) btnDir.classList.toggle('active', mode === 'direct');

  if (panelReg) panelReg.style.display = (mode === 'regional') ? 'block' : 'none';
  if (panelDir) panelDir.style.display = (mode === 'direct') ? 'block' : 'none';

  if (mode === 'regional') {
    if (typeof stopChatPolling === 'function') stopChatPolling();
    if (typeof detachChatSnapshot === 'function') detachChatSnapshot();
    const chatTitle = document.getElementById('comm-chat-region-title');
    if (chatTitle && communityState.overview?.region?.name) {
      chatTitle.textContent = `${communityState.overview.region.name} Community Chat`;
    }
    loadCommunityChatMessages();
    startCommunityChatPolling();
  } else {
    stopCommunityChatPolling();
    if (typeof loadUserRequests === 'function') loadUserRequests();
    if (typeof startChatPolling === 'function') startChatPolling();
    if (typeof attachChatSnapshot === 'function' && typeof connectState !== 'undefined' && connectState.activeRequestId) {
      attachChatSnapshot(connectState.activeRequestId);
    }
  }
}

function renderCurrentChatView() {
  setCommunityChatMode(communityState.chatMode || 'regional');
}

function renderCommunityChat() {
  renderCurrentChatView();
}

async function loadCommunityChatMessages(scrollIfBottom = true) {
  const stream = document.getElementById('comm-chat-messages');
  if (!stream) return;

  try {
    const channel = communityState.chatChannel || 'global';
    const res = await API.getCommunityChatMessages(channel, 60);
    const messages = (res && res.messages) ? res.messages : [];
    communityState.chatMessages = messages;

    if (messages.length === 0) {
      stream.innerHTML = `
        <div style="padding: 3rem 1rem; text-align: center; color: var(--text-muted);">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">💬</div>
          <div style="font-weight: 700; color: #cbd5e1; margin-bottom: 0.2rem;">Welcome to the Regional Channel!</div>
          <div style="font-size: 0.8rem; color: #64748b;">Be the first to say hello, announce an upcoming RTT, or ask for sparring practice.</div>
        </div>
      `;
      return;
    }

    const currentUserId = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    let html = '';

    messages.forEach(msg => {
      const isMine = currentUserId && msg.sender_id === currentUserId;
      const role = (msg.sender_role || 'player').toUpperCase();
      const elo = msg.sender_elo ? Math.round(Number(msg.sender_elo)) : null;
      const initials = (msg.sender_name || 'C').slice(0, 2).toUpperCase();

      let roleBadge = '';
      if (role === 'ADMIN') {
        roleBadge = `<span style="font-size: 0.65rem; background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.4); padding: 1px 5px; border-radius: 4px; font-weight: 800;">ADMIN</span>`;
      } else if (role === 'TO' || role === 'ORGANIZER') {
        roleBadge = `<span style="font-size: 0.65rem; background: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4); padding: 1px 5px; border-radius: 4px; font-weight: 800;">TO</span>`;
      }

      let timeStr = '';
      if (msg.created_at) {
        try {
          const d = new Date(msg.created_at);
          timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch(e) {}
      }

      html += `
        <div class="comm-chat-msg ${isMine ? 'mine' : ''}">
          <div class="comm-chat-avatar">${escapeHtml(initials)}</div>
          <div class="comm-chat-content">
            <div class="comm-chat-meta">
              <span class="comm-chat-name">${escapeHtml(msg.sender_name || 'Competitor')}</span>
              ${roleBadge}
              ${elo ? `<span class="comm-chat-elo">${elo} Elo</span>` : ''}
              <span class="comm-chat-time">${timeStr}</span>
            </div>
            <div class="comm-chat-bubble">${escapeHtml(msg.message_text)}</div>
          </div>
        </div>
      `;
    });

    stream.innerHTML = html;
    if (scrollIfBottom) {
      stream.scrollTop = stream.scrollHeight;
    }
  } catch (err) {
    console.warn('Notice loading community chat:', err);
  }
}

async function handleSendCommunityChat(e) {
  if (e) e.preventDefault();
  if (communityState.isSendingChat) return;

  const input = document.getElementById('comm-chat-input');
  const btn = document.getElementById('comm-chat-send-btn');
  const text = input ? input.value.trim() : '';
  if (!text) return;

  communityState.isSendingChat = true;
  if (btn) btn.disabled = true;

  try {
    const channel = communityState.chatChannel || 'global';
    const res = await API.sendCommunityChatMessage(channel, text);
    if (res && res.success) {
      if (input) input.value = '';
      await loadCommunityChatMessages(true);
    } else {
      alert(res?.error || 'Failed to send message');
    }
  } catch (err) {
    console.error('Failed to send community chat message:', err);
    alert('Failed to send message. Please check your connection.');
  } finally {
    communityState.isSendingChat = false;
    if (btn) btn.disabled = false;
    if (input) input.focus();
  }
}

function startCommunityChatPolling() {
  stopCommunityChatPolling();
  communityState.chatPollingInterval = setInterval(() => {
    if (communityState.activeSubtab === 'chat') {
      loadCommunityChatMessages(false);
    }
  }, 4000);
}

function stopCommunityChatPolling() {
  if (communityState.chatPollingInterval) {
    clearInterval(communityState.chatPollingInterval);
    communityState.chatPollingInterval = null;
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
window.setCommunityChatMode = setCommunityChatMode;
window.handleSendCommunityChat = handleSendCommunityChat;

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

