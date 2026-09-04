/* ==========================================================================
   COMMUNITY HUB: LOCAL SPARRING RADAR & MATCH CHAT (TAB MODULE)
   ========================================================================== */

const connectState = {
  activeSubtab: 'players',
  userProfile: null,
  activeRequestId: null,
  playersList: [],
  requestsList: [],
  tournamentsList: [],
  chatPollInterval: null,
  chatSnapshotUnsub: null,
  userSyncSnapshotUnsub: null,
  activeMessages: [],
  placesAutocomplete: null,
  initialized: false
};

// Global entry point called when switching to 'connect' tab
async function initConnectTab() {
  const token = localStorage.getItem('elo_auth_token') || localStorage.getItem('native_session_token');
  if (!token) {
    window.location.href = '/login?redirect=' + encodeURIComponent('/#community');
    return;
  }

  try {
    const res = await window.api.getConnectProfile();
    if (res && res.success) {
      connectState.userProfile = res.profile;
      renderTopBarOptions(res.profile);
    }
  } catch (err) {
    console.warn("Failed to load LFG profile:", err);
  }

  initConnectGooglePlaces();

  // Load current subtab
  switchConnectSubtab(connectState.activeSubtab || 'players');

  // Update unread badge
  updateUnreadCountBadge();
  if (!connectState.initialized) {
    connectState.initialized = true;
    setInterval(updateUnreadCountBadge, 5000);
  }
}

// Keep backwards-compat alias
window.initConnect = initConnectTab;

/* --------------------------------------------------------------------------
   TOP BAR: THE 2 CORE OPTIONS (Status & Location)
   -------------------------------------------------------------------------- */
function renderTopBarOptions(profile) {
  if (!profile) return;
  const dot = document.getElementById('user-status-dot');
  const text = document.getElementById('user-status-text');
  const btn = document.getElementById('btn-toggle-lfg');
  const locText = document.getElementById('user-location-text');

  const isActive = Boolean(profile.is_active);
  if (isActive) {
    if (dot) {
      dot.style.background = '#10b981';
      dot.style.boxShadow = '0 0 8px #10b981';
    }
    if (text) text.textContent = 'Available for Games';
    if (btn) {
      btn.style.background = 'rgba(16,185,129,0.15)';
      btn.style.color = '#10b981';
      btn.style.borderColor = 'rgba(16,185,129,0.35)';
      btn.title = 'Click to switch to Off Duty';
    }
  } else {
    if (dot) {
      dot.style.background = '#64748b';
      dot.style.boxShadow = 'none';
    }
    if (text) text.textContent = 'Off Duty (Hidden)';
    if (btn) {
      btn.style.background = 'rgba(100,116,139,0.15)';
      btn.style.color = '#94a3b8';
      btn.style.borderColor = 'rgba(100,116,139,0.3)';
      btn.title = 'Click to broadcast you are looking for games';
    }
  }

  if (locText) {
    const venue = profile.home_venue_name || (profile.city ? `${profile.city}${profile.state ? ', ' + profile.state : ''}` : 'San Diego, CA');
    locText.textContent = venue;
  }
}

async function changeUserMatchPreference(newStyle) {
  if (!connectState.userProfile) {
    connectState.userProfile = { is_active: true, radius_miles: 50, play_style: newStyle, preferred_points: 2000 };
  } else {
    connectState.userProfile.play_style = newStyle;
  }

  const payload = {
    ...connectState.userProfile,
    play_style: newStyle
  };

  // Sync modal and settings inputs if open
  const modalStyle = document.getElementById('modal-lfg-style');
  if (modalStyle) modalStyle.value = newStyle;
  const settingsStyle = document.getElementById('settings-play-style');
  if (settingsStyle) settingsStyle.value = newStyle;

  // Optimistically refresh nearby players if radar is visible
  const radarVisible = document.getElementById('players-grid') || (typeof communityState !== 'undefined' && communityState.activeSubtab === 'radar') || connectState.activeSubtab === 'players';
  if (radarVisible) {
    loadNearbyPlayers();
  }

  try {
    const res = await window.api.saveConnectProfile(payload);
    if (res && res.success) {
      if (typeof showToast === 'function') {
        showToast(`🎯 Looking for: ${newStyle} matches`);
      }
    }
  } catch (err) {
    console.warn("Failed to save match preference:", err);
  }
}
window.changeUserMatchPreference = changeUserMatchPreference;

async function toggleUserLfgStatus() {
  if (!connectState.userProfile) {
    connectState.userProfile = { is_active: false, radius_miles: 30, latitude: 32.7157, longitude: -117.1611 };
  }
  const newStatus = !connectState.userProfile.is_active;

  // Optimistic UI updates (0ms delay)
  connectState.userProfile.is_active = newStatus;
  renderTopBarOptions(connectState.userProfile);

  const radarVisible = document.getElementById('players-grid') || (typeof communityState !== 'undefined' && communityState.activeSubtab === 'radar') || connectState.activeSubtab === 'players';
  if (radarVisible) {
    loadNearbyPlayers();
  }

  try {
    const payload = {
      ...connectState.userProfile,
      is_active: newStatus
    };
    const res = await window.api.saveConnectProfile(payload);
    if (!res || !res.success) {
      console.warn('Failed to save status:', res?.error);
    }
  } catch (err) {
    console.warn('Failed to update status:', err);
  }
}

/* --------------------------------------------------------------------------
   GPS GEOLOCATION SHARING
   -------------------------------------------------------------------------- */
async function shareCurrentLocation(inModalOnly = false) {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your device or browser.");
    return;
  }

  const btnTop = document.getElementById('btn-share-location');
  const btnModal = document.getElementById('modal-btn-share-location');
  const iconTop = document.getElementById('share-loc-icon');
  const textTop = document.getElementById('share-loc-text');

  if (iconTop) iconTop.textContent = '⏳';
  if (textTop) textTop.textContent = 'Detecting...';
  if (btnModal) {
    btnModal.disabled = true;
    btnModal.textContent = '⏳ Detecting GPS...';
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      // Unified multi-tier reverse geocoding with instant hub resolution, backend parity, and metro distance checks
      const resolved = (typeof resolveLocationFromCoordinates === 'function')
        ? await resolveLocationFromCoordinates(lat, lng)
        : null;

      const city = resolved?.city || 'Local Tabletop';
      const state = resolved?.state || '';
      const country = resolved?.country || 'United States';
      const venueName = resolved?.formatted || (state ? `${city}, ${state}` : city);

      // Fill in modal inputs if modal exists
      const modal = document.getElementById('edit-location-modal');
      const isModalOpen = modal && modal.style.display === 'flex';

      const venueInput = document.getElementById('modal-lfg-venue');
      const latEl = document.getElementById('modal-lfg-lat');
      const lngEl = document.getElementById('modal-lfg-lng');
      const cityEl = document.getElementById('modal-lfg-city');
      const stateEl = document.getElementById('modal-lfg-state');
      const countryEl = document.getElementById('modal-lfg-country');
      const badge = document.getElementById('modal-loc-badge');

      if (venueInput) {
        venueInput.value = venueName;
        venueInput.dataset.placesSelected = 'true';
        venueInput.dataset.placeLat = String(lat);
        venueInput.dataset.placeLng = String(lng);
        venueInput.dataset.placeName = venueName;
        venueInput.dataset.isGpsLocked = 'true';
        venueInput.dataset.userEdited = 'false';
        venueInput.dataset.origValue = venueName;
      }
      if (latEl) latEl.value = String(lat);
      if (lngEl) lngEl.value = String(lng);
      if (cityEl) cityEl.value = city;
      if (stateEl) stateEl.value = state;
      if (countryEl) countryEl.value = country;
      if (badge) {
        badge.textContent = '✓ GPS Locked';
        badge.style.background = 'rgba(16,185,129,0.15)';
        badge.style.color = '#10b981';
      }

      // Reset button states
      if (iconTop) iconTop.textContent = '🛰️';
      if (textTop) textTop.textContent = 'Share My Location';
      if (btnModal) {
        btnModal.disabled = false;
        btnModal.textContent = '✓ GPS Locked';
      }

      // Immediately sync exact GPS to active community radar
      localStorage.setItem('comm_exact_gps', 'true');
      localStorage.removeItem('comm_manual_override');
      if (typeof updateCommunityLocation === 'function') {
        updateCommunityLocation(lat, lng, venueName);
      }

      // If called from the top bar (not purely modal editing), auto-save and refresh!
      if (!isModalOpen || !inModalOnly) {
        const radius = (typeof communityState !== 'undefined' && communityState.radiusMiles)
          ? communityState.radiusMiles
          : (connectState.userProfile?.radius_miles || 30);
        const payload = {
          ...(connectState.userProfile || {}),
          is_active: connectState.userProfile ? connectState.userProfile.is_active : true,
          home_venue_name: venueName,
          city: city,
          state: state,
          country: country,
          latitude: lat,
          longitude: lng,
          radius_miles: radius
        };

        // Optimistic UI updates
        connectState.userProfile = { ...(connectState.userProfile || {}), ...payload };
        renderTopBarOptions(connectState.userProfile);
        closeEditLocationModal();
        if (connectState.activeSubtab === 'players') loadNearbyPlayers();
        if (connectState.activeSubtab === 'tournaments') loadNearbyTournaments();
        if (typeof updateCommunityLocation === 'function') {
          updateCommunityLocation(payload.latitude, payload.longitude, payload.home_venue_name || payload.city, payload.radius_miles);
        }

        try {
          await window.api.saveConnectProfile(payload);
        } catch (err) {
          console.error("Auto-save GPS notice:", err);
        }
      }
    },
    (error) => {
      console.warn("Geolocation error:", error);
      if (iconTop) iconTop.textContent = '🛰️';
      if (textTop) textTop.textContent = 'Share My Location';
      if (btnModal) {
        btnModal.disabled = false;
        btnModal.textContent = '📍 Use Current GPS';
      }
      let msg = "Could not retrieve your location.";
      if (error.code === error.PERMISSION_DENIED) {
        msg = "Location permission was denied. Please allow location access in your browser or search for your city/store.";
      } else if (error.code === error.TIMEOUT) {
        msg = "Location request timed out. Please try again or type your city/store.";
      }
      alert(msg);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

window.shareCurrentLocation = shareCurrentLocation;

/* --------------------------------------------------------------------------
   LOCATION MODAL & SMART COORDINATE RESOLUTION
   -------------------------------------------------------------------------- */
const CITY_COORDS_MAP = {
  'san diego': { name: 'San Diego, CA', lat: 32.7157, lng: -117.1611 },
  'los angeles': { name: 'Los Angeles, CA', lat: 34.0522, lng: -118.2437 },
  'orange county': { name: 'Orange County, CA', lat: 33.7175, lng: -117.8311 },
  'temecula': { name: 'Temecula, CA', lat: 33.4936, lng: -117.1484 },
  'pasadena': { name: 'Pasadena, CA', lat: 34.1478, lng: -118.1445 },
  'burbank': { name: 'Burbank, CA', lat: 34.1808, lng: -118.3090 },
  'anaheim': { name: 'Anaheim, CA', lat: 33.8366, lng: -117.9143 },
  'long beach': { name: 'Long Beach, CA', lat: 33.7701, lng: -118.1937 },
  'irvine': { name: 'Irvine, CA', lat: 33.6846, lng: -117.8265 },
  'riverside': { name: 'Riverside, CA', lat: 33.9806, lng: -117.3755 },
  'san francisco': { name: 'San Francisco, CA', lat: 37.7749, lng: -122.4194 },
  'san jose': { name: 'San Jose, CA', lat: 37.3382, lng: -121.8863 },
  'sacramento': { name: 'Sacramento, CA', lat: 38.5816, lng: -121.4944 },
  'seattle': { name: 'Seattle, WA', lat: 47.6062, lng: -122.3321 },
  'portland': { name: 'Portland, OR', lat: 45.5152, lng: -122.6784 },
  'phoenix': { name: 'Phoenix, AZ', lat: 33.4484, lng: -112.0740 },
  'las vegas': { name: 'Las Vegas, NV', lat: 36.1699, lng: -115.1398 },
  'denver': { name: 'Denver, CO', lat: 39.7392, lng: -104.9903 },
  'austin': { name: 'Austin, TX', lat: 30.2672, lng: -97.7431 },
  'dallas': { name: 'Dallas, TX', lat: 32.7767, lng: -96.7970 },
  'houston': { name: 'Houston, TX', lat: 29.7604, lng: -95.3698 },
  'san antonio': { name: 'San Antonio, TX', lat: 29.4241, lng: -98.4936 },
  'chicago': { name: 'Chicago, IL', lat: 41.8781, lng: -87.6298 },
  'minneapolis': { name: 'Minneapolis, MN', lat: 44.9778, lng: -93.2650 },
  'new york': { name: 'New York, NY', lat: 40.7128, lng: -74.0060 },
  'philadelphia': { name: 'Philadelphia, PA', lat: 39.9526, lng: -75.1652 },
  'boston': { name: 'Boston, MA', lat: 42.3601, lng: -71.0589 },
  'atlanta': { name: 'Atlanta, GA', lat: 33.7490, lng: -84.3880 },
  'orlando': { name: 'Orlando, FL', lat: 28.5383, lng: -81.3792 },
  'miami': { name: 'Miami, FL', lat: 25.7617, lng: -80.1918 },
  'charlotte': { name: 'Charlotte, NC', lat: 35.2271, lng: -80.8431 },
  'columbus': { name: 'Columbus, OH', lat: 39.9612, lng: -82.9988 },
  'toronto': { name: 'Toronto, Canada', lat: 43.6532, lng: -79.3832 },
  'vancouver': { name: 'Vancouver, Canada', lat: 49.2827, lng: -123.1207 },
  'london': { name: 'London, UK', lat: 51.5074, lng: -0.1278 },
  'manchester': { name: 'Manchester, UK', lat: 53.4808, lng: -2.2426 },
  'paris': { name: 'Paris, France', lat: 48.8566, lng: 2.3522 },
  'sydney': { name: 'Sydney, Australia', lat: -33.8688, lng: 151.2093 },
  'melbourne': { name: 'Melbourne, Australia', lat: -37.8136, lng: 144.9631 }
};

function lookupCityCoordinates(raw) {
  if (typeof window !== 'undefined' && typeof window.lookupCityCoordinates === 'function' && window.lookupCityCoordinates !== lookupCityCoordinates) {
    return window.lookupCityCoordinates(raw);
  }
  if (!raw || typeof raw !== 'string') return null;
  const q = raw.trim().toLowerCase();
  if (!q) return null;

  const dict = (typeof window !== 'undefined' && window.GLOBAL_CITY_COORDS) ? window.GLOBAL_CITY_COORDS : CITY_COORDS_MAP;
  
  if (dict[q]) return dict[q];

  const firstToken = q.split(',')[0].trim();
  if (dict[firstToken]) return dict[firstToken];

  for (const [key, val] of Object.entries(dict)) {
    if (q.includes(key) || key.includes(q) || (val.name && val.name.toLowerCase().includes(q))) {
      return val;
    }
  }

  // Common aliases
  const aliases = {
    'socal': dict['san diego'],
    'norcal': dict['san francisco'],
    'bay area': dict['san francisco'],
    'pnw': dict['seattle'],
    'texas': dict['austin'],
    'midwest': dict['chicago'],
    'northeast': dict['new york'],
    'nyc': dict['new york'],
    'southeast': dict['atlanta'],
    'uk': dict['london']
  };
  if (aliases[q]) return aliases[q];
  if (aliases[firstToken]) return aliases[firstToken];

  return null;
}
window.lookupCityCoordinates = lookupCityCoordinates;

function openEditLocationModal() {
  const p = connectState.userProfile || {};
  const modal = document.getElementById('edit-location-modal');
  if (!modal) return;

  const venue = document.getElementById('modal-lfg-venue');
  const addr = document.getElementById('modal-lfg-address');
  const city = document.getElementById('modal-lfg-city');
  const state = document.getElementById('modal-lfg-state');
  const country = document.getElementById('modal-lfg-country');
  const lat = document.getElementById('modal-lfg-lat');
  const lng = document.getElementById('modal-lfg-lng');
  const rad = document.getElementById('modal-lfg-radius');
  const pts = document.getElementById('modal-lfg-points');
  const style = document.getElementById('modal-lfg-style');

  const currentLocName = (typeof communityState !== 'undefined' && communityState.locationName)
    ? communityState.locationName
    : (p.home_venue_name || (p.city ? `${p.city}, ${p.state || ''}` : 'San Diego, CA'));
  const currentLat = (typeof communityState !== 'undefined' && communityState.lat != null)
    ? communityState.lat
    : (p.latitude || 32.7157);
  const currentLng = (typeof communityState !== 'undefined' && communityState.lng != null)
    ? communityState.lng
    : (p.longitude || -117.1611);

  if (venue) {
    venue.value = currentLocName;
    venue.dataset.origValue = currentLocName;
    venue.dataset.userEdited = 'false';
    venue.dataset.placesSelected = 'false';
    delete venue.dataset.placeLat;
    delete venue.dataset.placeLng;
    delete venue.dataset.placeName;
  }
  if (addr) addr.value = p.address || '';
  if (city) city.value = p.city || '';
  if (state) state.value = p.state || '';
  if (country) country.value = p.country || 'United States';
  if (lat) lat.value = currentLat;
  if (lng) lng.value = currentLng;
  if (rad) rad.value = (typeof communityState !== 'undefined' && communityState.radiusMiles) ? communityState.radiusMiles : (p.radius_miles || 50);
  if (pts) pts.value = p.preferred_points || 2000;
  const styleEl = document.getElementById('modal-lfg-style') || style;
  if (styleEl) styleEl.value = p.play_style || 'Competitive';
  const facEl = document.getElementById('modal-lfg-faction');
  if (facEl) facEl.value = p.factions || p.top_faction || '';

  const badge = document.getElementById('modal-loc-badge');
  if (badge) {
    badge.textContent = 'Google Places';
    badge.style.background = '';
    badge.style.color = '';
  }

  modal.style.display = 'flex';
  setTimeout(attachModalPlacesAutocomplete, 100);
}

function closeEditLocationModal() {
  const modal = document.getElementById('edit-location-modal');
  if (modal) modal.style.display = 'none';
}

async function handleSaveLocation(e) {
  e.preventDefault();
  const venue = document.getElementById('modal-lfg-venue');
  const addr = document.getElementById('modal-lfg-address');
  const city = document.getElementById('modal-lfg-city');
  const state = document.getElementById('modal-lfg-state');
  const country = document.getElementById('modal-lfg-country');
  const lat = document.getElementById('modal-lfg-lat');
  const lng = document.getElementById('modal-lfg-lng');
  const rad = document.getElementById('modal-lfg-radius');
  const pts = document.getElementById('modal-lfg-points');
  const style = document.getElementById('modal-lfg-style');

  const unifiedRadius = (typeof communityState !== 'undefined' && communityState.radiusMiles)
    ? communityState.radiusMiles
    : (rad ? parseInt(rad.value, 10) : 50);

  const rawInput = venue ? venue.value.trim() : '';
  let targetLat = null;
  let targetLng = null;
  let chosenLocName = rawInput || 'San Diego, CA';

  // 0. If GPS was locked via "Use Current GPS" in modal
  const badge = document.getElementById('modal-loc-badge');
  const isGpsLocked = (venue && venue.dataset.isGpsLocked === 'true') ||
                      (badge && badge.textContent && badge.textContent.includes('GPS Locked'));

  if (isGpsLocked && lat && lat.value && lng && lng.value && !isNaN(parseFloat(lat.value)) && !isNaN(parseFloat(lng.value))) {
    targetLat = parseFloat(lat.value);
    targetLng = parseFloat(lng.value);
    localStorage.setItem('comm_exact_gps', 'true');
    localStorage.removeItem('comm_manual_override');
  } else if (venue && venue.dataset.placesSelected === 'true' && venue.dataset.placeLat && venue.dataset.placeLng) {
    targetLat = parseFloat(venue.dataset.placeLat);
    targetLng = parseFloat(venue.dataset.placeLng);
  } else if (rawInput && venue && rawInput === venue.dataset.origValue && lat && lat.value && lng && lng.value) {
    // 2. Unchanged from initial modal open state
    targetLat = parseFloat(lat.value);
    targetLng = parseFloat(lng.value);
  }

  // 3. User changed or entered new location text
  if (targetLat == null && rawInput) {
    // 3a. City coordinates dictionary lookup (fast 0ms instant match)
    const matched = lookupCityCoordinates(rawInput);
    if (matched) {
      targetLat = matched.lat;
      targetLng = matched.lng;
      chosenLocName = rawInput || matched.name;
    } else {
      // 3. Try Google Geocoder if loaded
      if (typeof google !== 'undefined' && google.maps && google.maps.Geocoder) {
        try {
          const geocoder = new google.maps.Geocoder();
          const gRes = await new Promise((resolve) => {
            geocoder.geocode({ address: rawInput }, (results, status) => {
              if (status === 'OK' && results && results[0] && results[0].geometry) {
                resolve(results[0]);
              } else {
                resolve(null);
              }
            });
          });
          if (gRes && gRes.geometry && gRes.geometry.location) {
            targetLat = gRes.geometry.location.lat();
            targetLng = gRes.geometry.location.lng();
            chosenLocName = rawInput || gRes.formatted_address;
          }
        } catch (err) {
          console.warn('Google geocoder notice:', err);
        }
      }

      // 4. Try Nominatim lookup fallback
      if (targetLat == null) {
        try {
          const nRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(rawInput)}&limit=1`, {
            headers: { 'Accept': 'application/json' }
          });
          if (nRes.ok) {
            const items = await nRes.json();
            if (items && items.length > 0) {
              targetLat = parseFloat(items[0].lat);
              targetLng = parseFloat(items[0].lon);
            }
          }
        } catch (err) {
          console.warn('Nominatim lookup notice:', err);
        }
      }
    }
  }

  // Fallback if empty or San Diego
  if (targetLat == null && (!rawInput || rawInput.toLowerCase().includes('san diego'))) {
    targetLat = 32.7157;
    targetLng = -117.1611;
  }

  const styleEl = document.getElementById('modal-lfg-style') || style;
  const facEl = document.getElementById('modal-lfg-faction');
  const ptsEl = document.getElementById('modal-lfg-points') || pts;

  const payload = {
    ...(connectState.userProfile || {}),
    is_active: connectState.userProfile ? connectState.userProfile.is_active : true,
    home_venue_name: chosenLocName,
    address: addr ? addr.value.trim() : '',
    city: city ? city.value.trim() : '',
    state: state ? state.value.trim() : '',
    country: country ? country.value.trim() : 'United States',
    latitude: targetLat,
    longitude: targetLng,
    radius_miles: unifiedRadius,
    preferred_points: ptsEl ? parseInt(ptsEl.value, 10) : 2000,
    play_style: styleEl ? styleEl.value : 'Competitive',
    factions: facEl ? facEl.value.trim() : (connectState.userProfile?.factions || '')
  };

  // Optimistic UI updates - close modal and update location/header immediately (0ms delay)
  connectState.userProfile = { ...(connectState.userProfile || {}), ...payload };
  renderTopBarOptions(connectState.userProfile);
  closeEditLocationModal();

  if (typeof updateCommunityLocation === 'function') {
    updateCommunityLocation(payload.latitude, payload.longitude, chosenLocName, payload.radius_miles);
  }
  if (connectState.activeSubtab === 'players') loadNearbyPlayers();
  if (connectState.activeSubtab === 'tournaments') loadNearbyTournaments();

  try {
    const res = await window.api.saveConnectProfile(payload);
    if (!res || !res.success) {
      console.warn('saveConnectProfile background notice:', res?.error);
    }
  } catch (err) {
    console.warn('saveConnectProfile error:', err);
  }
}

/* --------------------------------------------------------------------------
   SUBTAB NAVIGATION
   -------------------------------------------------------------------------- */
function switchConnectSubtab(tabName) {
  connectState.activeSubtab = tabName;

  if (tabName === 'chats' || tabName === 'chat' || tabName === 'messages') {
    if (typeof toggleFloatingChat === 'function') {
      toggleFloatingChat(true);
      return;
    } else if (typeof switchTab === 'function') {
      switchTab('chat');
      return;
    }
  }

  // If running inside unified Community Hub, delegate to switchCommunitySubtab
  if (typeof switchCommunitySubtab === 'function') {
    if (tabName === 'players' || tabName === 'radar' || tabName === 'sparring') {
      switchCommunitySubtab('radar');
      return;
    } else if (tabName === 'tournaments' || tabName === 'events') {
      switchCommunitySubtab('tournaments');
      return;
    }
  }

  const tabs = ['players', 'tournaments', 'chats'];
  tabs.forEach(t => {
    const btn = document.getElementById(`subtab-btn-${t}`);
    const view = document.getElementById(`subview-${t}`);
    if (btn) btn.classList.toggle('active', t === tabName);
    if (view) view.style.display = (t === tabName) ? 'block' : 'none';
  });

  if (tabName === 'players') {
    detachChatSnapshot();
    detachUserSyncSnapshot();
    stopChatPolling();
    loadNearbyPlayers();
  } else if (tabName === 'tournaments') {
    detachChatSnapshot();
    detachUserSyncSnapshot();
    stopChatPolling();
    loadNearbyTournaments();
  } else if (tabName === 'chats') {
    loadUserRequests();
    attachUserSyncSnapshot();
    startChatPolling();
    if (connectState.activeRequestId) {
      attachChatSnapshot(connectState.activeRequestId);
    }
  }
}

/* --------------------------------------------------------------------------
   SUBVIEW 1: SPARRING PARTNERS (LFG RADAR)
   -------------------------------------------------------------------------- */
async function loadNearbyPlayers() {
  const container = document.getElementById('players-grid');
  const countBadge = document.getElementById('badge-players-count');
  if (!container) return;

  // If userProfile hasn't been loaded yet, attempt quick fetch
  if (!connectState.userProfile && typeof window.api?.getConnectProfile === 'function') {
    try {
      const res = await window.api.getConnectProfile();
      if (res && res.success && res.profile) {
        connectState.userProfile = res.profile;
        if (typeof renderTopBarOptions === 'function') {
          renderTopBarOptions(res.profile);
        }
      }
    } catch (e) {}
  }

  const p = connectState.userProfile || {};
  const isOffDuty = !Boolean(p.is_active);
  const radius = (typeof communityState !== 'undefined' && communityState.radiusMiles)
    ? communityState.radiusMiles
    : (document.getElementById('comm-radius-select')?.value || p.radius_miles || 50);

  // If user is currently Off Duty, clearly show that radar is paused and guide them to enable it
  if (isOffDuty) {
    if (countBadge) {
      countBadge.textContent = 'Off';
      countBadge.style.opacity = '0.7';
    }
    const sumEl = document.getElementById('comm-radar-summary');
    if (sumEl) sumEl.textContent = 'Radar Paused (Off Duty)';
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3.5rem 1.5rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); width: 100%; box-sizing: border-box;">
        <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(100, 116, 139, 0.15); border: 1px solid rgba(100, 116, 139, 0.3); display: inline-flex; align-items: center; justify-content: center; font-size: 2rem; margin: 0 auto 1rem;">
          📡
        </div>
        <div style="display: inline-block; padding: 3px 12px; border-radius: 9999px; background: rgba(100, 116, 139, 0.2); color: #94a3b8; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.75rem;">
          Status: Off Duty (Hidden)
        </div>
        <h3 style="color: #fff; font-size: 1.25rem; font-weight: 800; margin: 0 0 0.5rem;">
          Sparring Radar Is Paused
        </h3>
        <p style="color: #94a3b8; font-size: 0.9rem; line-height: 1.5; max-width: 520px; margin: 0 auto 1.5rem;">
          You are currently marked as <strong>Off Duty</strong>. Your profile is hidden from local matchmaking and the live radar is turned off.<br><br>
          Enable <strong>Available for Games</strong> to discover nearby sparring partners within <span style="color: #38bdf8; font-weight: 700;">${radius} miles</span> and allow opponents to challenge you.
        </p>
        <button onclick="toggleUserLfgStatus()" class="btn btn-primary" style="padding: 0.65rem 1.5rem; font-size: 0.9rem; font-weight: 800; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 4px 14px rgba(56, 189, 248, 0.25); cursor: pointer;">
          <span>⚡</span> <span>Enable "Available for Games"</span>
        </button>
      </div>
    `;
    return;
  }

  const hasExistingCards = Boolean(container.querySelector('.oc-player-card'));
  if (!hasExistingCards) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: #94a3b8;">
        <div style="font-size: 2rem; margin-bottom: 0.5rem; animation: spin 1s linear infinite; display: inline-block;">🧭</div>
        <div>Scanning local tabletop radar for active sparring partners...</div>
      </div>
    `;
  }

  const style = document.getElementById('filter-style')?.value || 'all';
  const lat = (typeof communityState !== 'undefined' && communityState.lat != null)
    ? communityState.lat
    : (p.latitude || 32.7157);
  const lng = (typeof communityState !== 'undefined' && communityState.lng != null)
    ? communityState.lng
    : (p.longitude || -117.1611);

  try {
    const res = await window.api.searchConnectPlayers(lat, lng, radius, style);
    const players = (res && res.players) ? res.players : [];
    connectState.playersList = players;

    if (countBadge) {
      countBadge.textContent = players.length;
      countBadge.style.opacity = '1';
    }
    const sumEl = document.getElementById('comm-radar-summary');
    if (sumEl) {
      sumEl.textContent = `${players.length} active player${players.length === 1 ? '' : 's'} • ${radius} mi`;
    }

    if (players.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3.5rem 1.5rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); width: 100%; box-sizing: border-box;">
          <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.25); display: inline-flex; align-items: center; justify-content: center; font-size: 2rem; margin: 0 auto 1rem;">
            🎯
          </div>
          <div style="display: inline-block; padding: 3px 12px; border-radius: 9999px; background: rgba(16, 185, 129, 0.15); color: #10b981; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.75rem;">
            ● Radar Active • Available for Games
          </div>
          <h3 style="color: #fff; font-size: 1.25rem; font-weight: 800; margin: 0 0 0.5rem;">
            No Active Opponents Found Within ${radius} Miles
          </h3>
          <p style="color: #94a3b8; font-size: 0.9rem; line-height: 1.5; max-width: 520px; margin: 0 auto 1.5rem;">
            Your status is broadcasting, but no other local players within <span style="color: #38bdf8; font-weight: 700;">${radius} miles</span> are currently checked in as available. Try expanding your search radius to discover tabletop players in nearby areas.
          </p>
          <button onclick="if(typeof changeCommunityRadius==='function'){changeCommunityRadius(250);}else{loadNearbyPlayers();}" class="btn btn-primary" style="padding: 0.65rem 1.5rem; font-size: 0.9rem; font-weight: 800; display: inline-flex; align-items: center; gap: 8px; cursor: pointer;">
            <span>📡</span> <span>Expand Search Radius to 250 Miles</span>
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = players.map(player => {
      const initials = (player.display_name || 'Player').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
      const elo = Math.round(player.current_elo || 1500);
      const tierBadge = getEloTierBadge(elo);
      const venueStr = player.home_venue_name || `${player.city || 'Nearby'}, ${player.state || ''}`;

      let actionHtml = '';
      if (player.existing_request_status === 'accepted') {
        actionHtml = `
          <button onclick="openChatWithRequest('${player.existing_request_id}')" class="btn" style="width: 100%; background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.35); font-weight: 700; padding: 0.5rem; font-size: 0.82rem;">
            💬 Open Chat & Match Room
          </button>
        `;
      } else if (player.existing_request_status === 'pending') {
        actionHtml = `
          <div style="text-align: center; font-size: 0.8rem; font-weight: 700; color: #f59e0b; padding: 0.5rem; background: rgba(245,158,11,0.1); border-radius: 6px; border: 1px solid rgba(245,158,11,0.25);">
            ⏳ Sparring Request Pending
          </div>
        `;
      } else {
        actionHtml = `
          <button onclick="openProposeMatchModal('${player.player_id}', '${escapeHtml(player.display_name)}', '${escapeHtml(venueStr)}')" class="btn btn-primary" style="width: 100%; padding: 0.5rem; font-weight: 700; font-size: 0.82rem;">
            ⚔️ Propose Sparring Match
          </button>
        `;
      }

      return `
        <div class="oc-player-card">
          <div>
            <div class="oc-player-header">
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <div class="oc-player-avatar">${initials}</div>
                <div>
                  <div style="font-weight: 800; color: #fff; font-size: 0.95rem;">${escapeHtml(player.display_name || 'Player')}</div>
                  <div style="font-size: 0.76rem; color: #38bdf8; margin-top: 1px;">📍 ${player.distance_miles} miles away</div>
                </div>
              </div>
              <div style="text-align: right;">
                <div style="font-weight: 800; font-family: var(--font-heading); color: #fff; font-size: 1.05rem;">${elo}</div>
                <div style="font-size: 0.68rem;">${tierBadge}</div>
              </div>
            </div>

            <div style="background: rgba(15,23,42,0.6); border: 1px solid var(--border); border-radius: 8px; padding: 0.75rem; margin-bottom: 0.85rem; font-size: 0.8rem; display: flex; flex-direction: column; gap: 0.4rem;">
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-muted);">Home Venue:</span>
                <span style="font-weight: 600; color: #cbd5e1; max-width: 170px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(venueStr)}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-muted);">Match Preference:</span>
                <span style="font-weight: 600; color: #38bdf8;">${escapeHtml(player.play_style || 'Competitive')} • ${player.preferred_points || 2000} pts</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-muted);">Army / Faction:</span>
                <span style="font-weight: 600; color: #cbd5e1;">${escapeHtml(player.factions || player.top_faction || 'Various / Any Faction')}</span>
              </div>
            </div>

            ${player.availability_notes ? `
              <div style="font-size: 0.76rem; color: #94a3b8; line-height: 1.4; margin-bottom: 0.85rem; font-style: italic;">
                "${escapeHtml(player.availability_notes)}"
              </div>
            ` : ''}
          </div>

          <div>
            ${actionHtml}
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 2rem;">Error scanning radar: ${escapeHtml(err.message)}</div>`;
  }
}

function getEloTierBadge(elo) {
  if (elo >= 1800) return `<span class="oc-badge" style="background:rgba(234,179,8,0.15); color:#eab308; border:1px solid rgba(234,179,8,0.3);">Grandmaster</span>`;
  if (elo >= 1650) return `<span class="oc-badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; border:1px solid rgba(56,189,248,0.3);">Master</span>`;
  if (elo >= 1500) return `<span class="oc-badge" style="background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.3);">Veteran</span>`;
  return `<span class="oc-badge" style="background:rgba(148,163,184,0.15); color:#94a3b8; border:1px solid rgba(148,163,184,0.3);">Competitor</span>`;
}

/* --------------------------------------------------------------------------
   SUBVIEW 2: TOURNAMENT RADAR (WITH CONFIGURABLE HORIZON)
   -------------------------------------------------------------------------- */
async function loadNearbyTournaments() {
  const container = document.getElementById('tournaments-grid');
  if (!container) return;

  container.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: #94a3b8;">
      <div style="font-size: 2rem; margin-bottom: 0.5rem; animation: spin 1s linear infinite; display: inline-block;">🏆</div>
      <div>Querying real-time tournament radar on Best Coast Pairings...</div>
    </div>
  `;

  const p = connectState.userProfile || {};
  const radius = document.getElementById('tourney-filter-radius')?.value || 50;
  const monthsAhead = document.getElementById('tourney-filter-months')?.value || 2;
  const lat = p.latitude || 32.7157;
  const lng = p.longitude || -117.1611;

  const myPlayerId = (typeof currentUser !== 'undefined' && (currentUser?.player_id || currentUser?.id)) || p.player_id || '';

  try {
    const res = await window.api.getRecommendedEvents(myPlayerId, '', '', lat, lng, radius, 35, '', 'date', monthsAhead);
    const events = (res && res.events) ? res.events : [];
    connectState.tournamentsList = events;

    const myElo = (typeof currentUser !== 'undefined' && (currentUser?.current_elo || currentUser?.elo)) ||
                  connectState.userProfile?.current_elo ||
                  connectState.userProfile?.elo ||
                  (typeof myHubData !== 'undefined' && myHubData?.player?.current_elo) ||
                  (res && res.user_elo) ||
                  null;

    if (events.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg);">
          <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">📅</div>
          <h3 style="color: #fff; font-size: 1.15rem; margin-bottom: 0.4rem;">No Upcoming Tournaments Within ${radius} Miles</h3>
          <p style="color: #94a3b8; font-size: 0.85rem; max-width: 480px; margin: 0 auto;">
            Try widening your distance or extending the time horizon to 3 or 6 months.
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = events.map(ev => {
      const dist = ev.distance_miles ? `${ev.distance_miles} mi away` : 'Nearby';
      const venue = ev.venue_name || ev.venue || `${ev.city || ''}, ${ev.state || ''}`;
      const dateStr = ev.event_date ? new Date(ev.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Upcoming';
      const capStr = `${ev.total_players || 0} / ${ev.capacity || 32} Players`;
      const avgElo = ev.avg_elo_display ? Math.round(ev.avg_elo_display) : (ev.avg_field_elo ? Math.round(ev.avg_field_elo) : 1550);
      const effectiveUserElo = myElo || ev.user_elo;

      let deltaLabel = '';
      let deltaBadge = 'badge-match-prime';

      if (effectiveUserElo) {
        const delta = avgElo - Math.round(effectiveUserElo);
        const sign = delta > 0 ? `+${delta}` : (delta < 0 ? `${delta}` : `±0`);
        deltaLabel = `${sign} vs My Elo`;
        if (delta > 75) {
          deltaBadge = 'badge-match-extreme';
        } else if (delta > 25) {
          deltaBadge = 'badge-match-hard';
        } else if (delta < -25) {
          deltaBadge = 'badge-match-favorable';
        } else {
          deltaBadge = 'badge-match-prime';
        }
      } else if (ev.skill_match_label && !ev.skill_match_label.includes('Field Avg')) {
        deltaLabel = ev.skill_match_label;
        deltaBadge = ev.skill_match_badge || 'badge-match-prime';
      } else {
        deltaLabel = '⚔️ Open Field';
        deltaBadge = 'badge-match-prime';
      }
      const tierBadge = ev.tier_badge || 'tier-B';
      const tierName = ev.tier || 'RTT / Tournament';

      return `
        <div class="oc-player-card" style="display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
              <span class="tier-badge ${tierBadge}" style="font-size: 0.72rem; padding: 0.2rem 0.55rem;">${escapeHtml(tierName)}</span>
              <span style="font-size: 0.78rem; font-weight: 700; color: #10b981;">📍 ${dist}</span>
            </div>

            <h4 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0 0 0.5rem; line-height: 1.35;">${escapeHtml(ev.name || '40k Tournament')}</h4>

            <div style="font-size: 0.82rem; color: #94a3b8; margin-bottom: 0.75rem; display: flex; flex-direction: column; gap: 0.35rem;">
              <div>📅 <strong>${dateStr}</strong></div>
              <div>🏪 ${escapeHtml(venue)}</div>
              <div>👥 ${capStr} • <strong>${ev.points || 2000} pts</strong></div>
            </div>

            <!-- Field Avg Tactical Bar -->
            <div class="hub-card-analytics-bar" style="margin-bottom: 1rem;">
              <div style="display: flex; align-items: center; gap: 0.4rem;">
                <span style="color: #f59e0b;">⭐</span>
                <span>Field Avg: <b style="color: #fff; font-family: var(--font-mono);">${avgElo}</b> Elo</span>
              </div>
              <span class="badge ${deltaBadge}" style="font-size: 0.72rem; padding: 0.2rem 0.55rem; font-weight: 700;">
                ${escapeHtml(deltaLabel)}
              </span>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: auto;">
            <button onclick="openEventModal('${ev.id}', false, 'elo')" class="btn" style="background: rgba(56,189,248,0.1); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3); font-size: 0.78rem; font-weight: 700; text-align: center; padding: 0.45rem;">
              Roster & Details ⚔️
            </button>
            <a href="https://www.bestcoastpairings.com/event/${encodeURIComponent(ev.id)}" target="_blank" rel="noopener" class="btn btn-outline" style="font-size: 0.78rem; text-align: center; text-decoration: none; padding: 0.45rem;">
              BCP ↗
            </a>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 2rem;">Error loading tournaments: ${escapeHtml(err.message)}</div>`;
  }
}

/* --------------------------------------------------------------------------
   SUBVIEW 3: MATCH CHATS & REQUESTS
   -------------------------------------------------------------------------- */
function renderRequestsList(requests = connectState.requestsList, myId = null) {
  if (!myId) {
    myId = (typeof currentUser !== 'undefined' && currentUser?.id) || connectState.userProfile?.player_id || connectState.userProfile?.id || '';
  }

  const pendingSection = document.getElementById('chat-pending-section');
  const pendingList = document.getElementById('chat-pending-list');
  const pendingCount = document.getElementById('pending-count');
  const sentSection = document.getElementById('chat-sent-section');
  const sentList = document.getElementById('chat-sent-list');
  const sentCount = document.getElementById('sent-count');
  const convoList = document.getElementById('chat-conversations-list');

  const incomingPending = requests.filter(r => r.status === 'pending' && r.receiver_id === myId);
  const outgoingPending = requests.filter(r => r.status === 'pending' && r.sender_id === myId);
  const acceptedConvos = requests.filter(r => r.status === 'accepted');

  // 1. Render Incoming Pending Requests
  if (pendingSection && pendingList && pendingCount) {
    if (incomingPending.length > 0) {
      pendingCount.textContent = incomingPending.length;
      pendingList.innerHTML = incomingPending.map(req => `
        <div class="oc-pending-card" style="cursor: pointer;" onclick="selectPendingRequest('${req.id}')">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="font-weight: 800; color: #fff; font-size: 0.85rem;">${escapeHtml(req.sender_name)}</span>
            <span class="oc-badge">${Math.round(req.sender_elo || 1500)} Elo</span>
          </div>
          ${req.proposed_venue ? `
          <div style="font-size: 0.74rem; color: #94a3b8; margin-bottom: 5px;">
            🏪 ${escapeHtml(req.proposed_venue)} • ${req.proposed_points || 2000} pts
          </div>` : ''}
          ${req.note ? `<div style="font-size: 0.75rem; color: #cbd5e1; font-style: italic; margin-bottom: 8px; line-height: 1.35; background: rgba(0,0,0,0.25); padding: 5px 8px; border-radius: 4px; border-left: 2px solid #38bdf8;">"${escapeHtml(req.note)}"</div>` : ''}
          <div style="display: flex; gap: 0.35rem; margin-top: 4px;" onclick="event.stopPropagation()">
            <button onclick="respondToRequest('${req.id}', 'accept')" class="btn btn-primary" style="flex: 1; min-height: 32px; padding: 0.35rem 0.5rem; font-size: 0.74rem; font-weight: 700;" title="Accept chat request">
              ✓ Accept
            </button>
            <button onclick="handleQuickRespondPrompt('${req.id}', '${escapeHtml(req.sender_name)}')" class="btn btn-outline" style="flex: 1; min-height: 32px; padding: 0.35rem 0.5rem; font-size: 0.74rem; font-weight: 700; border-color: #38bdf8; color: #38bdf8;" title="Respond with message">
              💬 Respond
            </button>
            <button onclick="handleDeclineRequest('${req.id}', '${escapeHtml(req.sender_name)}')" class="btn btn-outline" style="min-height: 32px; padding: 0.35rem 0.55rem; font-size: 0.74rem; border-color: rgba(239,68,68,0.4); color: #f87171;" title="Decline request">
              ✕
            </button>
          </div>
        </div>
      `).join('');
      pendingSection.style.display = 'block';
    } else {
      pendingSection.style.display = 'none';
    }
  }

  // 2. Render Outgoing Pending Requests
  if (sentSection && sentList && sentCount) {
    if (outgoingPending.length > 0) {
      sentCount.textContent = outgoingPending.length;
      sentList.innerHTML = outgoingPending.map(req => `
        <div class="oc-pending-card" style="border-color: rgba(56, 189, 248, 0.3); background: rgba(15, 23, 42, 0.6);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="font-weight: 800; color: #fff; font-size: 0.85rem;">${escapeHtml(req.receiver_name)}</span>
            <span class="oc-badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border-color: rgba(56, 189, 248, 0.3);">${Math.round(req.receiver_elo || 1500)} Elo</span>
          </div>
          ${req.note ? `<div style="font-size: 0.74rem; color: #94a3b8; font-style: italic; margin-bottom: 5px; line-height: 1.35;">"${escapeHtml(req.note)}"</div>` : ''}
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; color: #f59e0b; font-weight: 600;">
            <span>⏳ Waiting for response...</span>
          </div>
        </div>
      `).join('');
      sentSection.style.display = 'block';
    } else {
      sentSection.style.display = 'none';
    }
  }

  // 3. Render Accepted Conversations
  if (convoList) {
    if (acceptedConvos.length === 0) {
      convoList.innerHTML = `
        <div style="text-align: center; padding: 2.5rem 1rem; color: #64748b; font-size: 0.82rem;">
          No active chats.<br>Send a chat request to any OmniTactica player or accept a pending request!
        </div>
      `;
    } else {
      convoList.innerHTML = acceptedConvos.map(req => {
        const isMeSender = (req.sender_id === myId);
        const otherName = isMeSender ? req.receiver_name : req.sender_name;
        const otherElo = Math.round(isMeSender ? req.receiver_elo : req.sender_elo);
        const initials = (otherName || 'P').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const isSelected = (connectState.activeRequestId === req.id);
        const unread = parseInt(req.unread_count || 0, 10);

        return `
          <div class="oc-convo-item ${isSelected ? 'active' : ''}" data-request-id="${req.id}" onclick="selectConversation('${req.id}')">
            <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0; flex: 1;">
              <div class="oc-player-avatar" style="width: 36px; height: 36px; font-size: 0.85rem; flex-shrink: 0;">${initials}</div>
              <div style="min-width: 0; flex: 1;">
                <div class="oc-convo-name">${escapeHtml(otherName)}</div>
                <div class="oc-convo-snippet">${escapeHtml(req.last_message || req.proposed_venue || 'Connected')}</div>
              </div>
            </div>
            <div style="text-align: right; flex-shrink: 0; margin-left: 6px;">
              <div style="font-size: 0.74rem; font-weight: 700; color: #38bdf8;">${otherElo}</div>
              ${unread > 0 ? `<span class="oc-badge oc-badge-danger" style="margin-top: 2px;">${unread}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Auto-select first conversation ONLY when in side-by-side wide mode on desktop where both panes are visible
  if (isFloatingChatWide && !connectState.activeRequestId && acceptedConvos.length > 0 && window.innerWidth > 768) {
    selectConversation(acceptedConvos[0].id);
  }
}
window.renderRequestsList = renderRequestsList;

async function loadUserRequests() {
  try {
    const res = await window.api.getConnectRequests();
    const requests = (res && res.requests) ? res.requests : [];
    const myId = res?.current_user_id || (typeof currentUser !== 'undefined' && currentUser?.id) || '';
    connectState.requestsList = requests;
    renderRequestsList(requests, myId);
    if (typeof updateUnreadCountBadge === 'function') {
      updateUnreadCountBadge();
    }
  } catch (err) {
    console.warn("Failed to load requests:", err);
  }
}
window.loadUserRequests = loadUserRequests;

function selectPendingRequest(requestId) {
  const req = connectState.requestsList.find(r => r.id === requestId);
  if (!req) return;

  connectState.activeRequestId = requestId;

  const layout = document.querySelector('.oc-chat-layout');
  if (layout) {
    layout.classList.add('is-viewing-chat');
  }

  const header = document.getElementById('chat-active-header');
  const inputForm = document.getElementById('chat-input-form');
  const msgContainer = document.getElementById('chat-messages-container');

  if (header) {
    header.style.display = 'flex';
    const nameEl = document.getElementById('chat-active-name');
    const eloEl = document.getElementById('chat-active-elo');
    const subEl = document.getElementById('chat-active-sub');
    const avatarEl = document.getElementById('chat-active-avatar');
    if (nameEl) nameEl.textContent = req.sender_name || 'Player';
    if (eloEl) eloEl.textContent = `${Math.round(req.sender_elo || 1500)} Elo`;
    if (avatarEl) avatarEl.textContent = (req.sender_name || 'P').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    if (subEl) subEl.textContent = `Pending Chat Request`;
  }

  // Hide standard message input for pending request review
  if (inputForm) inputForm.style.display = 'none';

  if (msgContainer) {
    msgContainer.innerHTML = `
      <div style="max-width: 520px; margin: 2rem auto; width: 100%; padding: 1.5rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-md);">
        <div style="text-align: center; margin-bottom: 1.25rem;">
          <div style="font-size: 2.5rem; margin-bottom: 0.35rem;">💬</div>
          <h3 style="font-size: 1.25rem; font-weight: 800; color: #fff; margin: 0 0 0.3rem;">Incoming Chat Request</h3>
          <p style="font-size: 0.8rem; color: #94a3b8; margin: 0;">
            <strong style="color: #38bdf8;">${escapeHtml(req.sender_name)}</strong> (${Math.round(req.sender_elo || 1500)} Elo) wants to connect on OmniTactica.
          </p>
        </div>

        <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 1rem; margin-bottom: 1.25rem;">
          <div style="font-size: 0.72rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-bottom: 0.4rem; letter-spacing: 0.05em;">Message</div>
          <div style="font-size: 0.92rem; color: #f8fafc; font-style: italic; line-height: 1.45;">
            "${escapeHtml(req.note || 'Hey! Would love to connect and play some games!')}"
          </div>
          ${req.proposed_venue ? `
            <div style="margin-top: 0.85rem; padding-top: 0.65rem; border-top: 1px solid rgba(255,255,255,0.06); font-size: 0.78rem; color: #cbd5e1; display: flex; flex-direction: column; gap: 0.3rem;">
              <div>📍 Proposed Venue: <strong style="color: #38bdf8;">${escapeHtml(req.proposed_venue)}</strong></div>
              <div>⚔️ Points: <strong style="color: #fff;">${req.proposed_points || 2000} pts</strong>${req.proposed_date ? ` • 📅 Date: <strong style="color: #fff;">${escapeHtml(req.proposed_date)}</strong>` : ''}</div>
            </div>
          ` : ''}
        </div>

        <!-- Inline Response Box -->
        <div id="pending-respond-box" style="display: none; margin-bottom: 1.25rem;">
          <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #38bdf8; margin-bottom: 0.35rem;">Your Reply to ${escapeHtml(req.sender_name)}:</label>
          <textarea id="pending-reply-input" class="search-input" style="width: 100%; min-height: 75px; box-sizing: border-box; resize: vertical;" placeholder="Type your response..."></textarea>
          <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.5rem;">
            <button onclick="document.getElementById('pending-respond-box').style.display = 'none'" class="btn btn-outline" style="padding: 0.4rem 0.8rem; font-size: 0.78rem;">Cancel</button>
            <button onclick="submitPendingResponse('${req.id}')" class="btn btn-primary" style="padding: 0.4rem 1rem; font-size: 0.78rem; font-weight: 700;">Send Reply & Accept</button>
          </div>
        </div>

        <!-- Main Action Buttons -->
        <div id="pending-actions-bar" style="display: flex; gap: 0.6rem; justify-content: center; flex-wrap: wrap;">
          <button onclick="respondToRequest('${req.id}', 'accept')" class="btn btn-primary" style="flex: 1; padding: 0.6rem 1rem; font-weight: 700; font-size: 0.84rem;">
            ✓ Accept
          </button>
          <button onclick="document.getElementById('pending-respond-box').style.display = 'block'; document.getElementById('pending-reply-input').focus();" class="btn btn-outline" style="flex: 1; padding: 0.6rem 1rem; font-weight: 700; font-size: 0.84rem; border-color: #38bdf8; color: #38bdf8;">
            💬 Respond
          </button>
          <button onclick="handleDeclineRequest('${req.id}', '${escapeHtml(req.sender_name)}')" class="btn btn-outline" style="padding: 0.6rem 0.9rem; font-size: 0.84rem; border-color: rgba(239,68,68,0.4); color: #f87171;">
            ✕ Decline
          </button>
        </div>
      </div>
    `;
  }
}
window.selectPendingRequest = selectPendingRequest;

function submitPendingResponse(requestId) {
  const input = document.getElementById('pending-reply-input');
  const message = input ? input.value.trim() : '';
  respondToRequest(requestId, 'accept', message);
}
window.submitPendingResponse = submitPendingResponse;

function handleQuickRespondPrompt(requestId, senderName) {
  const reply = prompt(`Reply to ${senderName} to accept and start chatting:`);
  if (reply !== null && reply.trim()) {
    respondToRequest(requestId, 'accept', reply.trim());
  } else if (reply !== null) {
    respondToRequest(requestId, 'accept');
  }
}
window.handleQuickRespondPrompt = handleQuickRespondPrompt;

function handleDeclineRequest(requestId, senderName) {
  if (confirm(`Decline chat request from ${senderName || 'this player'}?`)) {
    respondToRequest(requestId, 'decline');
  }
}
window.handleDeclineRequest = handleDeclineRequest;

async function respondToRequest(requestId, action, message = '') {
  // Snapshot previous state for rollback on error
  const prevRequests = JSON.parse(JSON.stringify(connectState.requestsList || []));
  const myId = (typeof currentUser !== 'undefined' && currentUser?.id) || connectState.userProfile?.player_id || connectState.userProfile?.id || '';
  const targetReq = connectState.requestsList.find(r => r.id === requestId);

  // 1. Instant optimistic local UI update (0ms response)
  if (action === 'accept') {
    if (targetReq) {
      targetReq.status = 'accepted';
      if (message) {
        targetReq.last_message = message;
      }
    }
    connectState.activeRequestId = requestId;
    renderRequestsList(connectState.requestsList, myId);
    selectConversation(requestId);
  } else if (action === 'decline') {
    connectState.requestsList = connectState.requestsList.filter(r => r.id !== requestId);
    if (connectState.activeRequestId === requestId) {
      connectState.activeRequestId = null;
      const header = document.getElementById('chat-active-header');
      const inputForm = document.getElementById('chat-input-form');
      const msgContainer = document.getElementById('chat-messages-container');
      if (header) header.style.display = 'none';
      if (inputForm) inputForm.style.display = 'none';
      if (msgContainer) msgContainer.innerHTML = `
        <div style="text-align: center; margin: auto; color: #64748b;">
          <div style="font-size: 2.2rem; margin-bottom: 0.4rem;">💬</div>
          <p style="margin: 0; font-size: 0.88rem; font-weight: 700; color: #94a3b8;">Request declined</p>
          <p style="margin: 4px 0 0; font-size: 0.78rem;">Select a conversation from the sidebar.</p>
        </div>
      `;
    }
    renderRequestsList(connectState.requestsList, myId);
  }

  // 2. Real-time push via Cloud Firestore
  const fsDb = getConnectFirestoreDb();
  if (fsDb) {
    try {
      const now = Date.now();
      fsDb.collection('connect_chats').doc(requestId).set({
        requestId: requestId,
        status: action === 'accept' ? 'accepted' : 'declined',
        updatedAt: now
      }, { merge: true }).catch(() => {});

      const otherId = targetReq ? (targetReq.sender_id === myId ? targetReq.receiver_id : targetReq.sender_id) : null;
      const expiresAtDate = new Date(now + (30 * 24 * 60 * 60 * 1000));
      const expiresAt = (typeof firebase !== 'undefined' && firebase.firestore?.Timestamp)
        ? firebase.firestore.Timestamp.fromDate(expiresAtDate)
        : expiresAtDate;

      if (myId) {
        fsDb.collection('connect_user_sync').doc(myId).set({
          userId: myId,
          updatedAt: now,
          action: `request_${action}`,
          requestId: requestId,
          expiresAt: expiresAt
        }, { merge: true }).catch(() => {});
      }
      if (otherId) {
        fsDb.collection('connect_user_sync').doc(otherId).set({
          userId: otherId,
          updatedAt: now,
          action: `request_${action}`,
          requestId: requestId,
          expiresAt: expiresAt
        }, { merge: true }).catch(() => {});
      }
    } catch (fsErr) {
      console.warn("Notice pushing request response to Firestore:", fsErr);
    }
  }

  // 3. Durable write to backend database
  try {
    const res = await window.api.respondConnectRequest(requestId, action, message);
    if (res && res.success) {
      // Re-fetch in background to ensure complete parity with database
      await loadUserRequests();
      updateUnreadCountBadge();
    } else {
      // Revert optimistic update on backend error
      connectState.requestsList = prevRequests;
      renderRequestsList(connectState.requestsList, myId);
      alert(res?.error || 'Failed to update request');
    }
  } catch (err) {
    // Revert optimistic update on network error
    connectState.requestsList = prevRequests;
    renderRequestsList(connectState.requestsList, myId);
    alert('Error responding to request: ' + err.message);
  }
}
window.respondToRequest = respondToRequest;

/* --------------------------------------------------------------------------
   REAL-TIME CLOUD FIRESTORE INTEGRATION FOR COMMUNITY HUB CHATS & USER SYNC
   -------------------------------------------------------------------------- */
let connectFirestoreDb = null;
function getConnectFirestoreDb() {
  if (connectFirestoreDb) return connectFirestoreDb;
  if (typeof firebase !== 'undefined' && firebase.firestore) {
    try {
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp({ projectId: "eloranking-506820" });
      }
      connectFirestoreDb = firebase.firestore();
      return connectFirestoreDb;
    } catch (e) {
      console.warn("Notice initializing Firestore for Community Hub:", e);
    }
  }
  return null;
}

function detachChatSnapshot() {
  if (connectState.chatSnapshotUnsub) {
    try {
      connectState.chatSnapshotUnsub();
    } catch (e) {}
    connectState.chatSnapshotUnsub = null;
  }
}

let markReadDebounceTimer = null;
function markCurrentChatAsRead(requestId = connectState.activeRequestId) {
  if (!requestId) return;
  const localReq = connectState.requestsList ? connectState.requestsList.find(r => r.id === requestId) : null;
  if (localReq) {
    localReq.unread_count = 0;
  }
  const convoItem = document.querySelector(`.oc-convo-item[data-request-id="${requestId}"]`);
  if (convoItem) {
    const unreadBadge = convoItem.querySelector('.oc-badge-danger');
    if (unreadBadge) unreadBadge.remove();
  }

  if (markReadDebounceTimer) clearTimeout(markReadDebounceTimer);
  markReadDebounceTimer = setTimeout(async () => {
    try {
      if (!requestId || connectState.activeRequestId !== requestId) return;
      await window.api.getConnectMessages(requestId);
      await updateUnreadCountBadge();
    } catch (e) {
      console.warn("Notice marking chat as read:", e);
    }
  }, 100);
}
window.markCurrentChatAsRead = markCurrentChatAsRead;

function attachChatSnapshot(requestId) {
  detachChatSnapshot();
  const fsDb = getConnectFirestoreDb();
  if (!fsDb) return;

  try {
    const docRef = fsDb.collection('connect_chats').doc(requestId);
    connectState.chatSnapshotUnsub = docRef.onSnapshot((snap) => {
      if (connectState.activeRequestId !== requestId) return;
      if (!snap || !snap.exists) return;
      const data = snap.data();
      if (data && Array.isArray(data.messages)) {
        connectState.activeMessages = data.messages;
        renderChatMessages(data.messages, true);

        const win = document.getElementById('floating-chat-window');
        if (win && win.style.display !== 'none' && !document.hidden) {
          markCurrentChatAsRead(requestId);
        }
      }
    }, (err) => {
      console.warn("Firestore chat snapshot notice:", err);
    });
  } catch (err) {
    console.warn("Failed to attach Firestore snapshot:", err);
  }
}

function detachUserSyncSnapshot() {
  if (connectState.userSyncSnapshotUnsub) {
    try {
      connectState.userSyncSnapshotUnsub();
    } catch (e) {}
    connectState.userSyncSnapshotUnsub = null;
  }
}
window.detachUserSyncSnapshot = detachUserSyncSnapshot;

function attachUserSyncSnapshot(userId = null) {
  detachUserSyncSnapshot();
  const myId = userId || (typeof currentUser !== 'undefined' && currentUser?.id) || connectState.userProfile?.player_id || connectState.userProfile?.id;
  if (!myId) return;

  const fsDb = getConnectFirestoreDb();
  if (!fsDb) return;

  try {
    let isInitial = true;
    const docRef = fsDb.collection('connect_user_sync').doc(myId);
    connectState.userSyncSnapshotUnsub = docRef.onSnapshot((snap) => {
      if (!snap || !snap.exists) return;
      if (isInitial) {
        isInitial = false;
        return;
      }
      // Real-time Firestore notification: requests or chat updated!
      if (typeof updateUnreadCountBadge === 'function') {
        updateUnreadCountBadge();
      }
      loadUserRequests();
    }, (err) => {
      console.warn("Firestore user sync snapshot notice:", err);
    });
  } catch (err) {
    console.warn("Failed to attach user sync snapshot:", err);
  }
}
window.attachUserSyncSnapshot = attachUserSyncSnapshot;

let isFloatingChatWide = false;

function toggleFloatingChatWide(forceState) {
  const win = document.getElementById('floating-chat-window');
  const btn = document.getElementById('floating-chat-wide-btn');
  if (!win) return;
  isFloatingChatWide = (typeof forceState === 'boolean') ? forceState : !isFloatingChatWide;
  win.classList.toggle('is-wide', isFloatingChatWide);
  if (btn) {
    btn.innerHTML = isFloatingChatWide ? `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="4 14 10 14 10 20"></polyline>
        <polyline points="20 10 14 10 14 4"></polyline>
        <line x1="14" y1="10" x2="21" y2="3"></line>
        <line x1="3" y1="21" x2="10" y2="14"></line>
      </svg>
    ` : `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 3 21 3 21 9"></polyline>
        <polyline points="9 21 3 21 3 15"></polyline>
        <line x1="21" y1="3" x2="14" y2="10"></line>
        <line x1="3" y1="21" x2="10" y2="14"></line>
      </svg>
    `;
    btn.title = isFloatingChatWide ? 'Contract to compact view' : 'Expand to side-by-side view';
  }
  if (isFloatingChatWide && !connectState.activeRequestId && window.innerWidth > 768) {
    renderRequestsList();
  }
}
window.toggleFloatingChatWide = toggleFloatingChatWide;

function toggleFloatingChat(forceState) {
  const widget = document.getElementById('floating-chat-widget');
  const win = document.getElementById('floating-chat-window');
  const bubble = document.getElementById('floating-chat-bubble');
  if (!win || !bubble) return;

  const isCurrentlyOpen = (win.style.display !== 'none');
  const shouldOpen = (typeof forceState === 'boolean') ? forceState : !isCurrentlyOpen;

  if (shouldOpen) {
    if (!currentUser) {
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.hash);
      return;
    }

    win.style.display = 'flex';
    bubble.classList.add('active');
    if (widget) widget.classList.add('is-open');

    if (window.innerWidth <= 768) {
      document.body.classList.add('chat-mode-active');
    }

    if (typeof loadUserRequests === 'function') loadUserRequests();
    if (typeof attachUserSyncSnapshot === 'function') attachUserSyncSnapshot();
    if (typeof startChatPolling === 'function') startChatPolling();
    if (typeof updateUnreadCountBadge === 'function') updateUnreadCountBadge();

    if (connectState.activeRequestId) {
      markCurrentChatAsRead(connectState.activeRequestId);
      if (typeof attachChatSnapshot === 'function') {
        attachChatSnapshot(connectState.activeRequestId);
      }
      setTimeout(() => {
        const msgContainer = document.getElementById('chat-messages-container');
        if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;
        const input = document.getElementById('chat-input-text');
        if (input && window.innerWidth > 768) input.focus();
      }, 80);
    }
  } else {
    win.style.display = 'none';
    bubble.classList.remove('active');
    if (widget) widget.classList.remove('is-open');

    document.body.classList.remove('chat-mode-active');

    if (typeof stopChatPolling === 'function') stopChatPolling();
    if (typeof detachChatSnapshot === 'function') detachChatSnapshot();
  }
}
window.toggleFloatingChat = toggleFloatingChat;

function backToChatList() {
  const layout = document.querySelector('.oc-chat-layout');
  if (layout) {
    layout.classList.remove('is-viewing-chat');
  }
  connectState.activeRequestId = null;
  if (typeof detachChatSnapshot === 'function') {
    detachChatSnapshot();
  }

  const convoList = document.getElementById('chat-conversations-list');
  if (convoList) {
    Array.from(convoList.children).forEach(child => {
      child.classList.remove('active');
    });
  }

  const header = document.getElementById('chat-active-header');
  if (header) header.style.display = 'none';
  const inputForm = document.getElementById('chat-input-form');
  if (inputForm) inputForm.style.display = 'none';

  const msgContainer = document.getElementById('chat-messages-container');
  if (msgContainer) {
    msgContainer.innerHTML = `
      <div style="text-align: center; margin: auto; color: #64748b; padding: 2rem 1rem;">
        <div style="font-size: 2.2rem; margin-bottom: 0.4rem;">💬</div>
        <p style="margin: 0; font-size: 0.88rem; font-weight: 700; color: #94a3b8;">Select a sparring match</p>
        <p style="margin: 4px 0 0; font-size: 0.78rem;">Chat with opponents to coordinate game time, points, and mission packs.</p>
      </div>
    `;
  }

  renderRequestsList();
  loadUserRequests();
}
window.backToChatList = backToChatList;

function openChatWithRequest(requestId) {
  connectState.activeRequestId = requestId;
  if (typeof toggleFloatingChat === 'function') {
    toggleFloatingChat(true);
  } else if (typeof switchTab === 'function') {
    switchTab('chat');
  }
  selectConversation(requestId);
}

async function selectConversation(requestId) {
  const layout = document.querySelector('.oc-chat-layout');
  if (layout) {
    layout.classList.add('is-viewing-chat');
  }

  const convoList = document.getElementById('chat-conversations-list');
  if (convoList) {
    Array.from(convoList.children).forEach(child => {
      const isMatch = (child.getAttribute('data-request-id') === requestId);
      child.classList.toggle('active', isMatch);
    });
  }

  // Immediately clear unread status on click
  markCurrentChatAsRead(requestId);

  if (connectState.activeRequestId === requestId && connectState.chatSnapshotUnsub) {
    return;
  }
  connectState.activeRequestId = requestId;

  const header = document.getElementById('chat-active-header');
  const inputForm = document.getElementById('chat-input-form');

  if (header) header.style.display = 'flex';
  if (inputForm) inputForm.style.display = 'flex';

  // Pre-fill header instantly from local requestsList if available
  const myId = (typeof currentUser !== 'undefined' && currentUser?.id) || connectState.userProfile?.player_id || connectState.userProfile?.id;
  const localReq = connectState.requestsList.find(r => r.id === requestId);
  if (localReq) {
    localReq.unread_count = 0;
    const isMeSender = (localReq.sender_id === myId);
    const otherName = isMeSender ? localReq.receiver_name : localReq.sender_name;
    const otherElo = Math.round(isMeSender ? localReq.receiver_elo : localReq.sender_elo);
    const nameEl = document.getElementById('chat-active-name');
    const eloEl = document.getElementById('chat-active-elo');
    const subEl = document.getElementById('chat-active-sub');
    const avatarEl = document.getElementById('chat-active-avatar');
    if (nameEl && otherName) nameEl.textContent = otherName;
    if (eloEl && !isNaN(otherElo)) eloEl.textContent = `${otherElo} Elo`;
    if (avatarEl && otherName) avatarEl.textContent = otherName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    if (subEl) subEl.textContent = `Proposed: ${localReq.proposed_points || 2000} pts at ${localReq.proposed_venue || 'Local Store'}`;
  }

  // Attach real-time Firestore push listener
  attachChatSnapshot(requestId);

  // Durable sync from backend (seeds Firestore if newly opened & updates request details)
  await refreshActiveMessages(false);
  if (typeof updateUnreadCountBadge === 'function') {
    updateUnreadCountBadge();
  }
}

function renderChatMessages(messages, scrollOnlyIfNearBottom = true) {
  if (!connectState.activeRequestId) return;
  const msgContainer = document.getElementById('chat-messages-container');
  if (!msgContainer) return;

  if (!messages || messages.length === 0) {
    msgContainer.innerHTML = `
      <div style="text-align: center; margin: auto; color: #64748b;">
        <div style="font-size: 2rem; margin-bottom: 0.4rem;">🤝</div>
        <div style="font-weight: 700; color: #fff; font-size: 0.92rem;">Match Challenge Accepted!</div>
        <div style="font-size: 0.78rem; margin-top: 4px;">Coordinate your game timing, store table, or share a live match room code.</div>
      </div>
    `;
    return;
  }

  // Deduplicate messages by id or composite key
  const seen = new Set();
  const deduped = [];
  for (const m of messages) {
    const key = m.id || `${m.sender_id}_${m.created_at}_${m.message_text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }

  // Sort chronologically
  deduped.sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return ta - tb;
  });

  const myId = (typeof currentUser !== 'undefined' && currentUser?.id) || connectState.userProfile?.player_id || connectState.userProfile?.id;
  const wasNearBottom = (msgContainer.scrollHeight - msgContainer.scrollTop - msgContainer.clientHeight) < 100;

  msgContainer.innerHTML = deduped.map(m => {
    const isMe = (m.sender_id === myId);
    const timeStr = m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    let roomCard = '';
    if (m.room_key) {
      roomCard = `
        <div class="oc-msg-room-card">
          <div style="min-width: 0;">
            <div style="font-size: 0.7rem; font-weight: 800; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.04em;">🎲 Live Game Tracker Room</div>
            <div style="font-family: monospace; font-size: 0.95rem; font-weight: 800; color: #fff;">${escapeHtml(m.room_key)}</div>
          </div>
          <a href="/11th/tracker/play?room=${encodeURIComponent(m.room_key)}" target="_blank" class="btn btn-primary" style="padding: 5px 12px; font-size: 0.74rem; font-weight: 700; text-decoration: none; min-height: 32px; display: inline-flex; align-items: center; white-space: nowrap;">
            Join Room ↗
          </a>
        </div>
      `;
    }

    return `
      <div class="oc-msg-bubble ${isMe ? 'oc-msg-out' : 'oc-msg-in'}">
        <div style="font-size: 0.7rem; opacity: 0.75; margin-bottom: 3px;">
          ${escapeHtml(isMe ? 'You' : (m.sender_name || 'Opponent'))} • ${timeStr}
        </div>
        <div>${escapeHtml(m.message_text)}</div>
        ${roomCard}
      </div>
    `;
  }).join('');

  if (!scrollOnlyIfNearBottom || wasNearBottom) {
    requestAnimationFrame(() => {
      msgContainer.scrollTop = msgContainer.scrollHeight;
    });
  }
}

async function refreshActiveMessages(scrollOnlyIfNearBottom = true) {
  if (!connectState.activeRequestId) return;
  const msgContainer = document.getElementById('chat-messages-container');
  if (!msgContainer) return;

  try {
    const res = await window.api.getConnectMessages(connectState.activeRequestId);
    if (!res || !res.success) return;

    const req = res.request || {};
    const otherName = res.other_user_name || 'Opponent';
    const otherElo = res.other_user_elo ? Math.round(res.other_user_elo) : null;

    const nameEl = document.getElementById('chat-active-name');
    const eloEl = document.getElementById('chat-active-elo');
    const subEl = document.getElementById('chat-active-sub');
    const avatarEl = document.getElementById('chat-active-avatar');

    if (nameEl) nameEl.textContent = otherName;
    if (eloEl && otherElo) eloEl.textContent = `${otherElo} Elo`;
    if (avatarEl && otherName) avatarEl.textContent = otherName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    if (subEl) subEl.textContent = `Proposed: ${req.proposed_points || 2000} pts at ${req.proposed_venue || 'Local Store'}`;

    const messages = res.messages || [];
    // If snapshot has already populated newer messages, don't clobber unless messages count is >=
    if (!connectState.chatSnapshotUnsub || !connectState.activeMessages || connectState.activeMessages.length <= messages.length) {
      connectState.activeMessages = messages;
      renderChatMessages(messages, scrollOnlyIfNearBottom);
    }

    const localReq = connectState.requestsList ? connectState.requestsList.find(r => r.id === connectState.activeRequestId) : null;
    if (localReq) localReq.unread_count = 0;
    const convoItem = document.querySelector(`.oc-convo-item[data-request-id="${connectState.activeRequestId}"]`);
    if (convoItem) {
      const b = convoItem.querySelector('.oc-badge-danger');
      if (b) b.remove();
    }

    if (typeof updateUnreadCountBadge === 'function') {
      updateUnreadCountBadge();
    }

  } catch (err) {
    console.warn("Notice updating messages:", err);
  }
}

async function handleSendChatMessage(e) {
  e.preventDefault();
  if (!connectState.activeRequestId) return;
  const input = document.getElementById('chat-input-text');
  const text = input ? input.value.trim() : '';
  if (!text) return;

  input.value = '';

  const myId = (typeof currentUser !== 'undefined' && currentUser?.id) || connectState.userProfile?.player_id || connectState.userProfile?.id;
  const myName = (typeof currentUser !== 'undefined' && currentUser?.display_name) || 'You';

  let randomHex = "";
  if (window.crypto && window.crypto.getRandomValues) {
    const bytes = new Uint8Array(8);
    window.crypto.getRandomValues(bytes);
    randomHex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  } else {
    randomHex = Math.random().toString(16).slice(2, 18);
  }
  const msgId = `msg_${randomHex}`;
  const nowIso = new Date().toISOString();

  const newMsg = {
    id: msgId,
    request_id: connectState.activeRequestId,
    sender_id: myId,
    sender_name: myName,
    message_text: text,
    room_key: null,
    created_at: nowIso
  };

  // 1. Instant optimistic local render (0ms response)
  if (!connectState.activeMessages) connectState.activeMessages = [];
  connectState.activeMessages.push(newMsg);
  renderChatMessages(connectState.activeMessages, false);

  // 2. Real-time push via Firestore
  const fsDb = getConnectFirestoreDb();
  if (fsDb && firebase.firestore?.FieldValue) {
    try {
      const now = Date.now();
      const expiresAtDate = new Date(now + (30 * 24 * 60 * 60 * 1000));
      const expiresAt = (firebase.firestore?.Timestamp)
        ? firebase.firestore.Timestamp.fromDate(expiresAtDate)
        : expiresAtDate;

      const docRef = fsDb.collection('connect_chats').doc(connectState.activeRequestId);
      docRef.set({
        requestId: connectState.activeRequestId,
        lastMessage: text,
        lastSenderId: myId,
        lastSenderName: myName,
        updatedAt: now,
        expiresAt: expiresAt,
        messages: firebase.firestore.FieldValue.arrayUnion(newMsg)
      }, { merge: true }).catch(err => {
        console.warn("Notice pushing message to Firestore:", err);
      });
    } catch (err) {
      console.warn("Notice writing to Firestore:", err);
    }
  }

  // 3. Durable write to PostgreSQL
  try {
    const res = await window.api.sendConnectMessage(connectState.activeRequestId, text, null, msgId);
    if (res && res.success) {
      loadUserRequests();
    }
  } catch (err) {
    console.warn('Failed to persist message to server:', err);
  }
}

async function createGameTrackerRoomForChat() {
  if (!connectState.activeRequestId) return;
  if (connectState._creatingRoom) return;
  connectState._creatingRoom = true;

  const btn = document.getElementById('chat-invite-room-btn');
  const desktopLabel = btn ? btn.querySelector('.oc-invite-desktop') : null;
  const mobileLabel = btn ? btn.querySelector('.oc-invite-mobile') : null;
  const origDesktopText = desktopLabel ? desktopLabel.innerText : '';
  const origMobileText = mobileLabel ? mobileLabel.innerText : '';

  if (btn) btn.disabled = true;
  if (desktopLabel) desktopLabel.innerText = '⏳ Creating Room...';
  if (mobileLabel) mobileLabel.innerText = '⏳ Creating...';

  try {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let roomCode = "";
    for (let i = 0; i < 6; i++) {
      roomCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const myId = (typeof currentUser !== 'undefined' && currentUser?.id) || connectState.userProfile?.player_id || connectState.userProfile?.id;
    const myName = (typeof currentUser !== 'undefined' && currentUser?.display_name) || 'You';

    const activeReq = (connectState.requests || []).find(r => r.id === connectState.activeRequestId);
    const isMeSender = (activeReq && activeReq.sender_id === myId);
    const oppName = activeReq ? (isMeSender ? activeReq.receiver_name : activeReq.sender_name) : 'Opponent';
    const myFaction = activeReq ? (isMeSender ? (activeReq.sender_faction || currentUser?.top_faction) : activeReq.receiver_faction) : (currentUser?.top_faction || null);
    const oppFaction = activeReq ? (isMeSender ? activeReq.receiver_faction : activeReq.sender_faction) : null;

    // 1. Actually instantiate the live room on the backend server!
    const roomPayload = {
      match_id: roomCode,
      p1_name: myName,
      p2_name: oppName || 'Player 2',
      p1_faction: myFaction,
      p2_faction: oppFaction
    };

    let roomResp = null;
    if (window.api && typeof window.api.createTrackerRoom === 'function') {
      roomResp = await window.api.createTrackerRoom(roomPayload);
    } else {
      const resp = await fetch('/api/tracker/room/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${window.api ? window.api.getAuthToken() : ''}`
        },
        body: JSON.stringify(roomPayload)
      });
      roomResp = await resp.json();
    }

    if (!roomResp || roomResp.error || (!roomResp.match_id && !roomResp.success)) {
      throw new Error((roomResp && roomResp.error) || 'Failed to initialize multiplayer match room');
    }

    const confirmedRoomKey = roomResp.match_id || roomCode;
    const msg = `🎲 I generated an OmniTactica Game Tracker match room! Click the button below to join the digital scorecard.`;

    let randomHex = "";
    if (window.crypto && window.crypto.getRandomValues) {
      const bytes = new Uint8Array(8);
      window.crypto.getRandomValues(bytes);
      randomHex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
      randomHex = Math.random().toString(16).slice(2, 18);
    }
    const msgId = `msg_${randomHex}`;
    const nowIso = new Date().toISOString();

    const newMsg = {
      id: msgId,
      request_id: connectState.activeRequestId,
      sender_id: myId,
      sender_name: myName,
      message_text: msg,
      room_key: confirmedRoomKey,
      created_at: nowIso
    };

    // 2. Instant optimistic local render (0ms response)
    if (!connectState.activeMessages) connectState.activeMessages = [];
    connectState.activeMessages.push(newMsg);
    renderChatMessages(connectState.activeMessages, false);

    // 3. Real-time push via Firestore
    const fsDb = getConnectFirestoreDb();
    if (fsDb && firebase.firestore?.FieldValue) {
      try {
        const now = Date.now();
        const expiresAtDate = new Date(now + (30 * 24 * 60 * 60 * 1000));
        const expiresAt = (firebase.firestore?.Timestamp)
          ? firebase.firestore.Timestamp.fromDate(expiresAtDate)
          : expiresAtDate;

        const docRef = fsDb.collection('connect_chats').doc(connectState.activeRequestId);
        docRef.set({
          requestId: connectState.activeRequestId,
          lastMessage: `🎲 Live Game Tracker Room: ${confirmedRoomKey}`,
          lastSenderId: myId,
          lastSenderName: myName,
          updatedAt: now,
          expiresAt: expiresAt,
          messages: firebase.firestore.FieldValue.arrayUnion(newMsg)
        }, { merge: true }).catch(err => {
          console.warn("Notice pushing room to Firestore:", err);
        });
      } catch (err) {
        console.warn("Notice writing room to Firestore:", err);
      }
    }

    // 4. Durable write to PostgreSQL
    const res = await window.api.sendConnectMessage(connectState.activeRequestId, msg, confirmedRoomKey, msgId);
    if (res && res.success) {
      loadUserRequests();
    }
  } catch (err) {
    console.error("Error creating game tracker room for chat:", err);
    alert('Failed to create match room: ' + err.message);
  } finally {
    connectState._creatingRoom = false;
    if (btn) btn.disabled = false;
    if (desktopLabel && origDesktopText) desktopLabel.innerText = origDesktopText;
    if (mobileLabel && origMobileText) mobileLabel.innerText = origMobileText;
  }
}

function startChatPolling() {
  stopChatPolling();
  connectState.chatPollInterval = setInterval(() => {
    if (connectState.activeSubtab === 'chats') {
      // If Firestore push listener is active, avoid duplicate polling of messages
      if (!connectState.chatSnapshotUnsub) {
        refreshActiveMessages(true);
      }
      loadUserRequests();
    }
  }, 8000);
}

function stopChatPolling() {
  if (connectState.chatPollInterval) {
    clearInterval(connectState.chatPollInterval);
    connectState.chatPollInterval = null;
  }
}

async function updateUnreadCountBadge() {
  try {
    if (typeof currentUser !== 'undefined' && !currentUser) {
      ['badge-unread-count', 'badge-chat-direct-unread', 'badge-chat-bubble-unread'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.textContent = '0';
          el.style.display = 'none';
        }
      });
      const bubbleBtn = document.getElementById('floating-chat-bubble');
      if (bubbleBtn) bubbleBtn.classList.remove('has-unread');
      return;
    }

    const res = await window.api.getConnectUnreadCount();
    const count = (res && res.unread_count) ? parseInt(res.unread_count, 10) : 0;
    const badge = document.getElementById('badge-unread-count');
    const directBadge = document.getElementById('badge-chat-direct-unread');
    const bubbleBadge = document.getElementById('badge-chat-bubble-unread');
    [badge, directBadge, bubbleBadge].forEach(b => {
      if (b) {
        if (count > 0) {
          b.textContent = count > 99 ? '99+' : count;
          b.style.display = 'inline-flex';
        } else {
          b.textContent = '0';
          b.style.display = 'none';
        }
      }
    });

    const bubbleBtn = document.getElementById('floating-chat-bubble');
    if (bubbleBtn) {
      if (count > 0) {
        bubbleBtn.classList.add('has-unread');
      } else {
        bubbleBtn.classList.remove('has-unread');
      }
    }
  } catch (e) {}
}

window.addEventListener('focus', () => {
  if (typeof updateUnreadCountBadge === 'function') {
    updateUnreadCountBadge();
  }
  const win = document.getElementById('floating-chat-window');
  if (win && win.style.display !== 'none' && connectState.activeRequestId) {
    markCurrentChatAsRead(connectState.activeRequestId);
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const win = document.getElementById('floating-chat-window');
    if (win && win.style.display !== 'none') {
      toggleFloatingChat(false);
    }
  }
});

/* --------------------------------------------------------------------------
   GOOGLE PLACES AUTOCOMPLETE
   -------------------------------------------------------------------------- */
async function initConnectGooglePlaces() {
  try {
    const res = await fetch('/api/config/maps-key');
    if (!res.ok) return;
    const data = await res.json();
    const apiKey = data?.key;
    if (apiKey && typeof google === 'undefined') {
      if (document.querySelector('script[src*="maps.googleapis.com"]')) return;
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&libraries=places&callback=attachAllPlacesAutocompletes`;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  } catch (e) {}
}

function attachAllPlacesAutocompletes() {
  attachModalPlacesAutocomplete();
  attachProposeVenueAutocomplete();
  if (typeof attachSettingsPlacesAutocomplete === 'function') {
    attachSettingsPlacesAutocomplete();
  }
  if (typeof onGoogleMapsScriptLoaded === 'function') {
    onGoogleMapsScriptLoaded();
  }
}
window.attachAllPlacesAutocompletes = attachAllPlacesAutocompletes;

function attachModalPlacesAutocomplete() {
  const venueInput = document.getElementById('modal-lfg-venue');
  if (!venueInput) return;

  if (!venueInput._inputListenerAttached) {
    venueInput._inputListenerAttached = true;
    const onUserEdit = () => {
      venueInput.dataset.userEdited = 'true';
      venueInput.dataset.placesSelected = 'false';
      delete venueInput.dataset.placeLat;
      delete venueInput.dataset.placeLng;
      delete venueInput.dataset.placeName;
      const badge = document.getElementById('modal-loc-badge');
      if (badge) {
        badge.textContent = 'City / Store';
        badge.style.background = 'rgba(56,189,248,0.1)';
        badge.style.color = '#38bdf8';
      }
    };
    venueInput.addEventListener('input', onUserEdit);
    venueInput.addEventListener('change', onUserEdit);
    venueInput.addEventListener('paste', onUserEdit);
  }

  if (typeof google === 'undefined' || !google.maps || !google.maps.places) return;
  if (venueInput._autocompleteAttached) return;
  venueInput._autocompleteAttached = true;

  try {
    const autocomplete = new google.maps.places.Autocomplete(venueInput, {
      types: ['establishment', 'geocode'],
      fields: ['name', 'formatted_address', 'geometry', 'address_components']
    });

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (!place || !place.geometry || !place.geometry.location) return;

      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      const name = place.name || venueInput.value;
      const addr = place.formatted_address || '';

      venueInput.dataset.placeLat = String(lat);
      venueInput.dataset.placeLng = String(lng);
      venueInput.dataset.placeName = name;
      venueInput.dataset.placesSelected = 'true';
      venueInput.dataset.userEdited = 'false';

      const latEl = document.getElementById('modal-lfg-lat');
      const lngEl = document.getElementById('modal-lfg-lng');
      const addrEl = document.getElementById('modal-lfg-address');
      const cityEl = document.getElementById('modal-lfg-city');
      const stateEl = document.getElementById('modal-lfg-state');
      const countryEl = document.getElementById('modal-lfg-country');
      const badge = document.getElementById('modal-loc-badge');

      if (latEl) latEl.value = lat;
      if (lngEl) lngEl.value = lng;
      if (addrEl) addrEl.value = addr;

      if (place.address_components) {
        for (const comp of place.address_components) {
          const types = comp.types || [];
          if (types.includes('locality') || (!cityEl.value && types.includes('sublocality'))) {
            if (cityEl) cityEl.value = comp.long_name;
          }
          if (types.includes('administrative_area_level_1')) {
            if (stateEl) stateEl.value = comp.short_name || comp.long_name;
          }
          if (types.includes('country')) {
            if (countryEl) countryEl.value = comp.long_name;
          }
        }
      }

      if (badge) {
        badge.textContent = '✓ Locked';
        badge.style.background = 'rgba(16,185,129,0.15)';
        badge.style.color = '#10b981';
      }
    });
  } catch (err) {}
}

window.attachModalPlacesAutocomplete = attachModalPlacesAutocomplete;

function attachProposeVenueAutocomplete() {
  const venueInput = document.getElementById('propose-venue');
  if (!venueInput || typeof google === 'undefined' || !google.maps || !google.maps.places) return;
  if (venueInput._autocompleteAttached) return;
  venueInput._autocompleteAttached = true;

  try {
    const autocomplete = new google.maps.places.Autocomplete(venueInput, {
      types: ['establishment', 'geocode'],
      fields: ['name', 'formatted_address', 'geometry', 'address_components']
    });

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (!place) return;

      const placeName = place.name || '';
      const formattedAddr = place.formatted_address || '';
      const badge = document.getElementById('propose-loc-badge');

      if (placeName && formattedAddr && !formattedAddr.startsWith(placeName)) {
        venueInput.value = `${placeName} (${formattedAddr})`;
      } else {
        venueInput.value = placeName || formattedAddr || venueInput.value;
      }

      if (badge) {
        badge.textContent = '✓ Venue Selected';
        badge.style.background = 'rgba(16,185,129,0.15)';
        badge.style.color = '#10b981';
      }
    });
  } catch (err) {
    console.warn("Notice attaching propose autocomplete:", err);
  }
}

window.attachProposeVenueAutocomplete = attachProposeVenueAutocomplete;

/* --------------------------------------------------------------------------
   SEND CHAT REQUEST & PROPOSE MATCH MODAL
   -------------------------------------------------------------------------- */
function openSendChatRequestModal(playerId, playerName, accountUserId, defaultVenue) {
  openProposeMatchModal(accountUserId || playerId, playerName, defaultVenue);
}
window.openSendChatRequestModal = openSendChatRequestModal;

function openProposeMatchModal(playerId, playerName, defaultVenue) {
  const modal = document.getElementById('propose-match-modal');
  if (!modal) return;

  const idEl = document.getElementById('propose-target-id');
  const nameEl = document.getElementById('propose-target-name');
  const venueEl = document.getElementById('propose-venue');
  const badge = document.getElementById('propose-loc-badge');
  const noteEl = document.getElementById('propose-note');

  if (idEl) idEl.value = playerId;
  if (nameEl) nameEl.textContent = playerName;
  if (venueEl) venueEl.value = defaultVenue || (connectState.userProfile?.home_venue_name || '');
  if (noteEl) noteEl.value = '';
  if (badge) {
    badge.textContent = 'Google Places';
    badge.style.background = 'rgba(56,189,248,0.18)';
    badge.style.color = '#38bdf8';
  }

  modal.style.display = 'flex';
  setTimeout(attachProposeVenueAutocomplete, 100);
}
window.openProposeMatchModal = openProposeMatchModal;

function closeProposeMatchModal() {
  const modal = document.getElementById('propose-match-modal');
  if (modal) modal.style.display = 'none';
  const noteEl = document.getElementById('propose-note');
  if (noteEl) noteEl.value = '';
}
window.closeProposeMatchModal = closeProposeMatchModal;

async function handleSubmitMatchProposal(e) {
  e.preventDefault();
  const idEl = document.getElementById('propose-target-id');
  const venueEl = document.getElementById('propose-venue');
  const ptsEl = document.getElementById('propose-points');
  const dateEl = document.getElementById('propose-date');
  const noteEl = document.getElementById('propose-note');
  const btn = document.getElementById('btn-submit-proposal');

  const receiverId = idEl ? idEl.value : '';
  const venue = venueEl ? venueEl.value.trim() : '';
  const points = ptsEl ? parseInt(ptsEl.value, 10) : 2000;
  const date = dateEl ? dateEl.value.trim() : '';
  const note = noteEl ? noteEl.value.trim() : '';

  if (!receiverId) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Sending...';
  }

  try {
    const res = await window.api.createConnectRequest(receiverId, venue, points, date, note);
    if (res && res.success) {
      if (res.already_connected) {
        alert('You are already connected with this player! Opening conversation in Messages...');
        closeProposeMatchModal();
        if (typeof closeModal === 'function') closeModal('player-modal');
        if (res.request_id && typeof openChatWithRequest === 'function') {
          openChatWithRequest(res.request_id);
        } else if (typeof switchTab === 'function') {
          switchTab('chat');
        }
      } else {
        alert('💬 Chat request sent! When they accept or respond, your conversation will open in Messages.');
        closeProposeMatchModal();
        if (typeof closeModal === 'function') closeModal('player-modal');

        const fsDb = getConnectFirestoreDb();
        if (fsDb && receiverId) {
          try {
            const now = Date.now();
            const expiresAtDate = new Date(now + (30 * 24 * 60 * 60 * 1000));
            const expiresAt = (typeof firebase !== 'undefined' && firebase.firestore?.Timestamp)
              ? firebase.firestore.Timestamp.fromDate(expiresAtDate)
              : expiresAtDate;
            fsDb.collection('connect_user_sync').doc(receiverId).set({
              userId: receiverId,
              updatedAt: now,
              action: 'request_created',
              expiresAt: expiresAt
            }, { merge: true }).catch(() => {});
          } catch (e) {}
        }

        if (typeof loadUserRequests === 'function') {
          loadUserRequests();
        }
        if (typeof loadNearbyPlayers === 'function') {
          loadNearbyPlayers();
        }
        updateUnreadCountBadge();
      }
    } else {
      alert(res?.error || 'Failed to send chat request');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💬 Send Chat Request';
    }
  }
}
window.handleSubmitMatchProposal = handleSubmitMatchProposal;

function escapeHtml(str) {
  if (typeof window !== 'undefined' && typeof window.escapeHtml === 'function' && window.escapeHtml !== escapeHtml) {
    return window.escapeHtml(str);
  }
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}
