/* ==========================================================================
   OMNICONNECT: LOCAL SPARRING RADAR & MATCH CHAT (TAB MODULE)
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
    setInterval(updateUnreadCountBadge, 15000);
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
    const venue = profile.home_venue_name || `${profile.city || 'San Diego'}, ${profile.state || 'CA'}`;
    const radius = profile.radius_miles || 30;
    locText.textContent = `${venue} (${radius} mi)`;
  }
}

async function toggleUserLfgStatus() {
  if (!connectState.userProfile) {
    connectState.userProfile = { is_active: false, radius_miles: 30, latitude: 32.7157, longitude: -117.1611 };
  }
  const newStatus = !connectState.userProfile.is_active;

  try {
    const payload = {
      ...connectState.userProfile,
      is_active: newStatus
    };
    const res = await window.api.saveConnectProfile(payload);
    if (res && res.success) {
      connectState.userProfile.is_active = newStatus;
      renderTopBarOptions(connectState.userProfile);
      if (connectState.activeSubtab === 'players') {
        loadNearbyPlayers();
      }
    }
  } catch (err) {
    alert('Failed to update status: ' + err.message);
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

      let city = 'Local Tabletop';
      let state = '';
      let country = 'United States';
      let venueName = 'Current Location';

      // 1. Try reverse geocode with Google Maps Geocoder if loaded
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
            for (const comp of response.address_components) {
              const types = comp.types || [];
              if (types.includes('locality')) city = comp.long_name;
              if (types.includes('administrative_area_level_1')) state = comp.short_name || comp.long_name;
              if (types.includes('country')) country = comp.long_name;
            }
            venueName = state ? `${city}, ${state}` : city;
          }
        } catch (e) {
          console.warn("Google geocode notice:", e);
        }
      }

      // 2. Fallback to OpenStreetMap reverse geocode
      if (city === 'Local Tabletop') {
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=12`, {
            headers: { 'Accept': 'application/json' }
          });
          if (res.ok) {
            const data = await res.json();
            const addr = data.address || {};
            city = addr.city || addr.town || addr.village || addr.suburb || addr.county || 'Nearby Area';
            state = addr.state || '';
            country = addr.country || 'United States';
            venueName = state ? `${city}, ${state}` : city;
          }
        } catch (e) {
          console.warn("Reverse geocode notice:", e);
        }
      }

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

      if (venueInput) venueInput.value = venueName;
      if (latEl) latEl.value = lat;
      if (lngEl) lngEl.value = lng;
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

      // If called from the top bar (not purely modal editing), auto-save and refresh!
      if (!isModalOpen || !inModalOnly) {
        const radius = connectState.userProfile?.radius_miles || 30;
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

        try {
          const res = await window.api.saveConnectProfile(payload);
          if (res && res.success) {
            connectState.userProfile = { ...connectState.userProfile, ...payload };
            renderTopBarOptions(connectState.userProfile);
            closeEditLocationModal();
            if (connectState.activeSubtab === 'players') loadNearbyPlayers();
            if (connectState.activeSubtab === 'tournaments') loadNearbyTournaments();
            if (typeof updateCommunityLocation === 'function') {
              updateCommunityLocation(payload.latitude, payload.longitude, payload.home_venue_name || payload.city, payload.radius_miles);
            }
          }
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
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

window.shareCurrentLocation = shareCurrentLocation;

/* --------------------------------------------------------------------------
   LOCATION MODAL (SET LOCATION & RADIUS)
   -------------------------------------------------------------------------- */
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

  if (venue) venue.value = p.home_venue_name || (p.city ? `${p.city}, ${p.state || ''}` : '');
  if (addr) addr.value = p.address || '';
  if (city) city.value = p.city || 'San Diego';
  if (state) state.value = p.state || 'CA';
  if (country) country.value = p.country || 'United States';
  if (lat) lat.value = p.latitude || 32.7157;
  if (lng) lng.value = p.longitude || -117.1611;
  if (rad) rad.value = p.radius_miles || 30;
  if (pts) pts.value = p.preferred_points || 2000;
  if (style) style.value = p.play_style || 'Competitive';

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

  const payload = {
    ...(connectState.userProfile || {}),
    is_active: connectState.userProfile ? connectState.userProfile.is_active : true,
    home_venue_name: venue ? venue.value.trim() : '',
    address: addr ? addr.value.trim() : '',
    city: city ? city.value.trim() : 'San Diego',
    state: state ? state.value.trim() : 'CA',
    country: country ? country.value.trim() : 'United States',
    latitude: lat && lat.value ? parseFloat(lat.value) : 32.7157,
    longitude: lng && lng.value ? parseFloat(lng.value) : -117.1611,
    radius_miles: rad ? parseInt(rad.value, 10) : 30,
    preferred_points: pts ? parseInt(pts.value, 10) : 2000,
    play_style: style ? style.value : 'Competitive'
  };

  try {
    const res = await window.api.saveConnectProfile(payload);
    if (res && res.success) {
      connectState.userProfile = { ...connectState.userProfile, ...payload };
      renderTopBarOptions(connectState.userProfile);
      closeEditLocationModal();
      if (connectState.activeSubtab === 'players') loadNearbyPlayers();
      if (connectState.activeSubtab === 'tournaments') loadNearbyTournaments();
      if (typeof updateCommunityLocation === 'function') {
        updateCommunityLocation(payload.latitude, payload.longitude, payload.home_venue_name || payload.city, payload.radius_miles);
      }
    } else {
      alert('Failed to save location: ' + (res?.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

/* --------------------------------------------------------------------------
   SUBTAB NAVIGATION
   -------------------------------------------------------------------------- */
function switchConnectSubtab(tabName) {
  connectState.activeSubtab = tabName;

  // If running inside unified Community Hub, delegate to switchCommunitySubtab
  if (typeof switchCommunitySubtab === 'function') {
    if (tabName === 'players' || tabName === 'radar' || tabName === 'sparring') {
      switchCommunitySubtab('radar');
      return;
    } else if (tabName === 'tournaments' || tabName === 'events') {
      switchCommunitySubtab('tournaments');
      return;
    } else if (tabName === 'chats' || tabName === 'chat' || tabName === 'messages') {
      switchCommunitySubtab('chat');
      if (typeof setCommunityChatMode === 'function') {
        setCommunityChatMode('direct');
      }
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
    stopChatPolling();
    loadNearbyPlayers();
  } else if (tabName === 'tournaments') {
    detachChatSnapshot();
    stopChatPolling();
    loadNearbyTournaments();
  } else if (tabName === 'chats') {
    loadUserRequests();
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

  container.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: #94a3b8;">
      <div style="font-size: 2rem; margin-bottom: 0.5rem; animation: spin 1s linear infinite; display: inline-block;">🧭</div>
      <div>Scanning local tabletop radar for active sparring partners...</div>
    </div>
  `;

  const p = connectState.userProfile || {};
  const radius = document.getElementById('filter-radius')?.value || p.radius_miles || 30;
  const style = document.getElementById('filter-style')?.value || 'all';
  const lat = p.latitude || 32.7157;
  const lng = p.longitude || -117.1611;

  try {
    const res = await window.api.searchConnectPlayers(lat, lng, radius, style);
    const players = (res && res.players) ? res.players : [];
    connectState.playersList = players;

    if (countBadge) countBadge.textContent = players.length;

    if (players.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3.5rem 1rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg);">
          <div style="font-size: 2.8rem; margin-bottom: 0.75rem;">🛡️</div>
          <h3 style="color: #fff; font-size: 1.15rem; margin-bottom: 0.4rem;">No Active Opponents Found Within ${radius} Miles</h3>
          <p style="color: #94a3b8; font-size: 0.85rem; max-width: 480px; margin: 0 auto 1.25rem;">
            Make sure your status is set to "Available for Games" above! Or try expanding your search radius to 50 or 100 miles.
          </p>
          <button onclick="document.getElementById('filter-radius').value='50'; loadNearbyPlayers();" class="btn btn-primary" style="padding: 0.55rem 1.2rem;">
            Expand Search Radius to 50 Miles
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
                <span style="color: var(--text-muted);">Faction:</span>
                <span style="font-weight: 600; color: #38bdf8;">${escapeHtml(player.top_faction || player.factions || 'Competitive 40k')}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-muted);">Format:</span>
                <span style="font-weight: 600; color: #cbd5e1;">${player.preferred_points || 2000} pts • ${escapeHtml(player.play_style || 'Competitive')}</span>
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
async function loadUserRequests() {
  try {
    const res = await window.api.getConnectRequests();
    const requests = (res && res.requests) ? res.requests : [];
    const myId = res?.current_user_id || '';
    connectState.requestsList = requests;

    const pendingSection = document.getElementById('chat-pending-section');
    const pendingList = document.getElementById('chat-pending-list');
    const pendingCount = document.getElementById('pending-count');
    const convoList = document.getElementById('chat-conversations-list');

    const incomingPending = requests.filter(r => r.status === 'pending' && r.receiver_id === myId);
    const acceptedConvos = requests.filter(r => r.status === 'accepted');

    if (pendingSection && pendingList && pendingCount) {
      if (incomingPending.length > 0) {
        pendingCount.textContent = incomingPending.length;
        pendingList.innerHTML = incomingPending.map(req => `
          <div class="oc-pending-card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-weight: 800; color: #fff; font-size: 0.85rem;">${escapeHtml(req.sender_name)}</span>
              <span class="oc-badge">${Math.round(req.sender_elo || 1500)} Elo</span>
            </div>
            <div style="font-size: 0.74rem; color: #94a3b8; margin-bottom: 6px;">
              🏪 ${escapeHtml(req.proposed_venue || 'Local Store')} • ${req.proposed_points || 2000} pts
            </div>
            ${req.note ? `<div style="font-size: 0.74rem; color: #cbd5e1; font-style: italic; margin-bottom: 8px;">"${escapeHtml(req.note)}"</div>` : ''}
            <div style="display: flex; gap: 0.5rem;">
              <button onclick="respondToRequest('${req.id}', 'accept')" class="btn btn-primary" style="flex: 1; min-height: 38px; padding: 0.4rem; font-size: 0.76rem; font-weight: 700;">
                ✓ Accept & Chat
              </button>
              <button onclick="respondToRequest('${req.id}', 'decline')" class="btn btn-outline" style="min-height: 38px; min-width: 44px; padding: 0.4rem 0.7rem; font-size: 0.76rem;" title="Decline">
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

    if (convoList) {
      if (acceptedConvos.length === 0) {
        convoList.innerHTML = `
          <div style="text-align: center; padding: 2.5rem 1rem; color: #64748b; font-size: 0.82rem;">
            No active chats.<br>Propose a match from the radar tab or accept a pending request!
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

    if (!connectState.activeRequestId && acceptedConvos.length > 0 && window.innerWidth > 768) {
      selectConversation(acceptedConvos[0].id);
    }

  } catch (err) {
    console.warn("Failed to load requests:", err);
  }
}

async function respondToRequest(requestId, action) {
  try {
    const res = await window.api.respondConnectRequest(requestId, action);
    if (res && res.success) {
      if (action === 'accept') {
        connectState.activeRequestId = requestId;
      }
      loadUserRequests();
      updateUnreadCountBadge();
    }
  } catch (err) {
    alert('Error responding to request: ' + err.message);
  }
}

/* --------------------------------------------------------------------------
   REAL-TIME CLOUD FIRESTORE INTEGRATION FOR OMNICONNECT CHATS
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
      console.warn("Notice initializing Firestore for OmniConnect:", e);
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
      }
    }, (err) => {
      console.warn("Firestore chat snapshot notice:", err);
    });
  } catch (err) {
    console.warn("Failed to attach Firestore snapshot:", err);
  }
}

function backToChatList() {
  const layout = document.querySelector('.oc-chat-layout');
  if (layout) {
    layout.classList.remove('is-viewing-chat');
  }
  if (window.innerWidth <= 768) {
    connectState.activeRequestId = null;
    detachChatSnapshot();
  }
  loadUserRequests();
}

function openChatWithRequest(requestId) {
  connectState.activeRequestId = requestId;
  switchConnectSubtab('chats');
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

  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let roomCode = "";
  for (let i = 0; i < 6; i++) {
    roomCode += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const msg = `🎲 I generated an OmniTactica Game Tracker match room! Click the button below to join the digital scorecard.`;

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
    message_text: msg,
    room_key: roomCode,
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
        lastMessage: `🎲 Live Game Tracker Room: ${roomCode}`,
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

  // 3. Durable write to PostgreSQL
  try {
    const res = await window.api.sendConnectMessage(connectState.activeRequestId, msg, roomCode, msgId);
    if (res && res.success) {
      loadUserRequests();
    }
  } catch (err) {
    alert('Failed to create room: ' + err.message);
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
    const res = await window.api.getConnectUnreadCount();
    const count = (res && res.unread_count) ? parseInt(res.unread_count, 10) : 0;
    const badge = document.getElementById('badge-unread-count');
    const directBadge = document.getElementById('badge-chat-direct-unread');
    [badge, directBadge].forEach(b => {
      if (b) {
        if (count > 0) {
          b.textContent = count;
          b.style.display = 'inline-block';
        } else {
          b.style.display = 'none';
        }
      }
    });
  } catch (e) {}
}

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
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&callback=attachAllPlacesAutocompletes`;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  } catch (e) {}
}

function attachAllPlacesAutocompletes() {
  attachModalPlacesAutocomplete();
  attachProposeVenueAutocomplete();
}
window.attachAllPlacesAutocompletes = attachAllPlacesAutocompletes;

function attachModalPlacesAutocomplete() {
  const venueInput = document.getElementById('modal-lfg-venue');
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
      if (!place || !place.geometry || !place.geometry.location) return;

      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      const name = place.name || venueInput.value;
      const addr = place.formatted_address || '';

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
   PROPOSE MATCH MODAL
   -------------------------------------------------------------------------- */
function openProposeMatchModal(playerId, playerName, defaultVenue) {
  const modal = document.getElementById('propose-match-modal');
  if (!modal) return;

  const idEl = document.getElementById('propose-target-id');
  const nameEl = document.getElementById('propose-target-name');
  const venueEl = document.getElementById('propose-venue');
  const badge = document.getElementById('propose-loc-badge');

  if (idEl) idEl.value = playerId;
  if (nameEl) nameEl.textContent = playerName;
  if (venueEl) venueEl.value = defaultVenue || (connectState.userProfile?.home_venue_name || '');
  if (badge) {
    badge.textContent = 'Google Places';
    badge.style.background = 'rgba(56,189,248,0.18)';
    badge.style.color = '#38bdf8';
  }

  modal.style.display = 'flex';
  setTimeout(attachProposeVenueAutocomplete, 100);
}

function closeProposeMatchModal() {
  const modal = document.getElementById('propose-match-modal');
  if (modal) modal.style.display = 'none';
}

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
      alert('⚔️ Sparring request sent! When the opponent accepts, you can chat directly.');
      closeProposeMatchModal();
      loadNearbyPlayers();
      updateUnreadCountBadge();
    } else {
      alert(res?.error || 'Failed to send request');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '⚔️ Send Sparring Request';
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}
