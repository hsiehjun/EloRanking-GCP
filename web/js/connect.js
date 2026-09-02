/* ==========================================================================
   OMNICONNECT: LOCAL SPARRING RADAR & MATCH CHAT CLIENT
   ========================================================================== */

const connectState = {
  activeTab: 'players',
  userProfile: null,
  activeRequestId: null,
  playersList: [],
  requestsList: [],
  tournamentsList: [],
  chatPollInterval: null,
  placesAutocomplete: null
};

document.addEventListener('DOMContentLoaded', async () => {
  await initConnect();
});

async function initConnect() {
  const token = localStorage.getItem('elo_auth_token') || localStorage.getItem('native_session_token');
  if (!token) {
    window.location.href = '/login?redirect=/connect';
    return;
  }

  try {
    const res = await window.api.getConnectProfile();
    if (res && res.success) {
      connectState.userProfile = res.profile;
      renderUserStatusHero(res.profile);
    }
  } catch (err) {
    console.warn("Failed to load LFG profile:", err);
  }

  // Load Google Places SDK dynamically for venue inputs
  initConnectGooglePlaces();

  // Load initial tab
  const urlParams = new URLSearchParams(window.location.search);
  const initialTab = urlParams.get('tab') || 'players';
  switchConnectTab(initialTab);

  // Load unread badge
  updateUnreadCountBadge();
  setInterval(updateUnreadCountBadge, 15000);
}

/* --------------------------------------------------------------------------
   TAB NAVIGATION
   -------------------------------------------------------------------------- */
function switchConnectTab(tabName) {
  connectState.activeTab = tabName;

  const tabs = ['players', 'tournaments', 'chats'];
  tabs.forEach(t => {
    const btn = document.getElementById(`tab-btn-${t}`);
    const view = document.getElementById(`view-${t}`);
    if (btn) btn.classList.toggle('active', t === tabName);
    if (view) view.style.display = (t === tabName) ? 'block' : 'none';
  });

  if (tabName === 'players') {
    stopChatPolling();
    loadNearbyPlayers();
  } else if (tabName === 'tournaments') {
    stopChatPolling();
    loadNearbyTournaments();
  } else if (tabName === 'chats') {
    loadUserRequests();
    startChatPolling();
  }
}

/* --------------------------------------------------------------------------
   HERO STATUS & LFG TOGGLE
   -------------------------------------------------------------------------- */
function renderUserStatusHero(profile) {
  if (!profile) return;
  const dot = document.getElementById('user-status-dot');
  const title = document.getElementById('user-status-title');
  const pill = document.getElementById('user-status-pill');
  const desc = document.getElementById('user-status-desc');
  const btn = document.getElementById('btn-toggle-lfg');

  const isActive = Boolean(profile.is_active);
  const venue = profile.home_venue_name || `${profile.city || 'Local Area'}, ${profile.state || ''}`;

  if (isActive) {
    if (dot) {
      dot.style.background = '#10b981';
      dot.style.boxShadow = '0 0 12px #10b981';
    }
    if (title) title.textContent = '🟢 Visible on Sparring Radar';
    if (pill) {
      pill.textContent = 'LOOKING FOR GAMES';
      pill.style.background = 'rgba(16,185,129,0.15)';
      pill.style.color = '#10b981';
      pill.style.borderColor = 'rgba(16,185,129,0.3)';
    }
    if (desc) desc.textContent = `Broadcasting to opponents within ${profile.radius_miles || 30} miles of ${venue} • Preferred: ${profile.preferred_points || 2000} pts (${profile.play_style || 'Competitive'})`;
    if (btn) {
      btn.textContent = '⏸️ Set to Off Duty';
      btn.style.background = 'rgba(239, 68, 68, 0.15)';
      btn.style.color = '#ef4444';
      btn.style.borderColor = 'rgba(239, 68, 68, 0.35)';
    }
  } else {
    if (dot) {
      dot.style.background = '#64748b';
      dot.style.boxShadow = 'none';
    }
    if (title) title.textContent = '⚪ Sparring Radar Off Duty';
    if (pill) {
      pill.textContent = 'HIDDEN / OFF DUTY';
      pill.style.background = 'rgba(100,116,139,0.2)';
      pill.style.color = '#94a3b8';
      pill.style.borderColor = 'rgba(100,116,139,0.3)';
    }
    if (desc) desc.textContent = 'Turn on "Available for Games" to let nearby players find you for competitive & practice matches.';
    if (btn) {
      btn.textContent = '🟢 Available for Games';
      btn.style.background = 'rgba(16,185,129,0.15)';
      btn.style.color = '#10b981';
      btn.style.borderColor = 'rgba(16,185,129,0.35)';
    }
  }
}

async function toggleUserLfgStatus() {
  if (!connectState.userProfile) return;
  const newStatus = !connectState.userProfile.is_active;

  try {
    const payload = {
      ...connectState.userProfile,
      is_active: newStatus
    };
    const res = await window.api.saveConnectProfile(payload);
    if (res && res.success) {
      connectState.userProfile.is_active = newStatus;
      renderUserStatusHero(connectState.userProfile);
      if (connectState.activeTab === 'players') {
        loadNearbyPlayers();
      }
    }
  } catch (err) {
    alert('Failed to update status: ' + err.message);
  }
}

/* --------------------------------------------------------------------------
   EDIT LFG PREFERENCES MODAL
   -------------------------------------------------------------------------- */
function openEditLfgModal() {
  const p = connectState.userProfile || {};
  const modal = document.getElementById('edit-lfg-modal');
  if (!modal) return;

  const chk = document.getElementById('modal-lfg-active');
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
  const facs = document.getElementById('modal-lfg-factions');
  const notes = document.getElementById('modal-lfg-notes');

  if (chk) chk.checked = Boolean(p.is_active);
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
  if (facs) facs.value = p.factions || '';
  if (notes) notes.value = p.availability_notes || '';

  modal.style.display = 'flex';
  setTimeout(attachModalPlacesAutocomplete, 100);
}

function closeEditLfgModal() {
  const modal = document.getElementById('edit-lfg-modal');
  if (modal) modal.style.display = 'none';
}

async function handleSaveLfgProfile(e) {
  e.preventDefault();
  const chk = document.getElementById('modal-lfg-active');
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
  const facs = document.getElementById('modal-lfg-factions');
  const notes = document.getElementById('modal-lfg-notes');

  const payload = {
    is_active: chk ? chk.checked : false,
    home_venue_name: venue ? venue.value.trim() : '',
    address: addr ? addr.value.trim() : '',
    city: city ? city.value.trim() : 'San Diego',
    state: state ? state.value.trim() : 'CA',
    country: country ? country.value.trim() : 'United States',
    latitude: lat && lat.value ? parseFloat(lat.value) : 32.7157,
    longitude: lng && lng.value ? parseFloat(lng.value) : -117.1611,
    radius_miles: rad ? parseInt(rad.value, 10) : 30,
    preferred_points: pts ? parseInt(pts.value, 10) : 2000,
    play_style: style ? style.value : 'Competitive',
    factions: facs ? facs.value.trim() : '',
    availability_notes: notes ? notes.value.trim() : ''
  };

  try {
    const res = await window.api.saveConnectProfile(payload);
    if (res && res.success) {
      connectState.userProfile = { ...connectState.userProfile, ...payload };
      renderUserStatusHero(connectState.userProfile);
      closeEditLfgModal();
      loadNearbyPlayers();
    } else {
      alert('Failed to save profile: ' + (res.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Error saving preferences: ' + err.message);
  }
}

/* --------------------------------------------------------------------------
   TAB 1: LOAD NEARBY LFG PLAYERS
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
          <h3 style="color: #fff; font-size: 1.15rem; margin-bottom: 0.4rem;">No Active Players Within ${radius} Miles</h3>
          <p style="color: #94a3b8; font-size: 0.85rem; max-width: 480px; margin: 0 auto 1.25rem;">
            Be the first in your area to activate your radar! Or try expanding your search radius to 50 or 100 miles.
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
          <button onclick="openChatWithRequest('${player.existing_request_id}')" class="btn" style="width: 100%; background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.35); font-weight: 700; padding: 0.55rem;">
            💬 Open Chat & Match Room
          </button>
        `;
      } else if (player.existing_request_status === 'pending') {
        actionHtml = `
          <div style="text-align: center; font-size: 0.82rem; font-weight: 700; color: #f59e0b; padding: 0.55rem; background: rgba(245,158,11,0.1); border-radius: 6px; border: 1px solid rgba(245,158,11,0.25);">
            ⏳ Sparring Request Pending
          </div>
        `;
      } else {
        actionHtml = `
          <button onclick="openProposeMatchModal('${player.player_id}', '${escapeHtml(player.display_name)}', '${escapeHtml(venueStr)}')" class="btn btn-primary" style="width: 100%; padding: 0.55rem; font-weight: 700;">
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
                <span style="color: var(--text-muted);">Home Store:</span>
                <span style="font-weight: 600; color: #cbd5e1; max-width: 180px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(venueStr)}</span>
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
              <div style="font-size: 0.78rem; color: #94a3b8; line-height: 1.4; margin-bottom: 1rem; font-style: italic;">
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
   PROPOSE MATCH MODAL
   -------------------------------------------------------------------------- */
function openProposeMatchModal(playerId, playerName, defaultVenue) {
  const modal = document.getElementById('propose-match-modal');
  if (!modal) return;

  const idEl = document.getElementById('propose-target-id');
  const nameEl = document.getElementById('propose-target-name');
  const venueEl = document.getElementById('propose-venue');

  if (idEl) idEl.value = playerId;
  if (nameEl) nameEl.textContent = playerName;
  if (venueEl) venueEl.value = defaultVenue || (connectState.userProfile?.home_venue_name || '');

  modal.style.display = 'flex';
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
    btn.textContent = 'Sending Challenge...';
  }

  try {
    const res = await window.api.createConnectRequest(receiverId, venue, points, date, note);
    if (res && res.success) {
      alert('⚔️ Sparring request sent! Once the player accepts, you can chat and coordinate match rooms.');
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

/* --------------------------------------------------------------------------
   TAB 2: TOURNAMENT RADAR
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
  const lat = p.latitude || 32.7157;
  const lng = p.longitude || -117.1611;

  try {
    const res = await window.api.getRecommendedEvents('', '', '', lat, lng, radius, 30);
    const events = (res && res.events) ? res.events : [];
    connectState.tournamentsList = events;

    if (events.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg);">
          <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">📅</div>
          <h3 style="color: #fff; font-size: 1.15rem; margin-bottom: 0.4rem;">No Upcoming Tournaments Within ${radius} Miles</h3>
          <p style="color: #94a3b8; font-size: 0.85rem; max-width: 480px; margin: 0 auto;">
            Try widening your search radius, or check back soon as local stores publish new BCP listings.
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

      return `
        <div class="oc-player-card">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
              <span class="oc-badge" style="background: rgba(56,189,248,0.15); color: #38bdf8;">${escapeHtml(ev.tier || 'RTT / Tournament')}</span>
              <span style="font-size: 0.78rem; font-weight: 700; color: #10b981;">📍 ${dist}</span>
            </div>

            <h4 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0 0 0.5rem; line-height: 1.35;">${escapeHtml(ev.name || '40k Tournament')}</h4>

            <div style="font-size: 0.82rem; color: #94a3b8; margin-bottom: 0.85rem; display: flex; flex-direction: column; gap: 0.35rem;">
              <div>📅 <strong>${dateStr}</strong></div>
              <div>🏪 ${escapeHtml(venue)}</div>
              <div>👥 ${capStr} • <strong>${ev.points || 2000} pts</strong></div>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
            <a href="/eventstudio" class="btn" style="background: rgba(255,255,255,0.06); color: #cbd5e1; border: 1px solid var(--border); font-size: 0.8rem; text-align: center; text-decoration: none; padding: 0.5rem;">
              Event Studio
            </a>
            <a href="https://www.bestcoastpairings.com/event/${encodeURIComponent(ev.id)}" target="_blank" rel="noopener" class="btn btn-primary" style="font-size: 0.8rem; text-align: center; text-decoration: none; padding: 0.5rem;">
              BCP Listing ↗
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
   TAB 3: MATCH CHATS & REQUESTS
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

    // Filter pending incoming requests
    const incomingPending = requests.filter(r => r.status === 'pending' && r.receiver_id === myId);
    const acceptedConvos = requests.filter(r => r.status === 'accepted');

    if (pendingSection && pendingList && pendingCount) {
      if (incomingPending.length > 0) {
        pendingCount.textContent = incomingPending.length;
        pendingList.innerHTML = incomingPending.map(req => `
          <div style="background: rgba(15,23,42,0.8); border: 1px solid rgba(245,158,11,0.3); border-radius: 8px; padding: 0.75rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-weight: 800; color: #fff; font-size: 0.85rem;">${escapeHtml(req.sender_name)}</span>
              <span class="oc-badge">${Math.round(req.sender_elo || 1500)} Elo</span>
            </div>
            <div style="font-size: 0.74rem; color: #94a3b8; margin-bottom: 6px;">
              🏪 ${escapeHtml(req.proposed_venue || 'Local Store')} • ${req.proposed_points || 2000} pts
            </div>
            ${req.note ? `<div style="font-size: 0.75rem; color: #cbd5e1; font-style: italic; margin-bottom: 8px;">"${escapeHtml(req.note)}"</div>` : ''}
            <div style="display: flex; gap: 0.5rem;">
              <button onclick="respondToRequest('${req.id}', 'accept')" class="btn btn-primary" style="flex: 1; padding: 0.35rem; font-size: 0.75rem;">
                ✓ Accept & Chat
              </button>
              <button onclick="respondToRequest('${req.id}', 'decline')" class="btn btn-outline" style="padding: 0.35rem 0.6rem; font-size: 0.75rem;">
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
            <div onclick="selectConversation('${req.id}')" style="padding: 0.75rem 0.85rem; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 8px; transition: background 0.15s; background: ${isSelected ? 'rgba(56,189,248,0.15)' : 'rgba(255,255,255,0.02)'}; border: 1px solid ${isSelected ? 'rgba(56,189,248,0.4)' : 'rgba(255,255,255,0.05)'};">
              <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0;">
                <div class="oc-player-avatar" style="width: 34px; height: 34px; font-size: 0.85rem; flex-shrink: 0;">${initials}</div>
                <div style="min-width: 0;">
                  <div style="font-weight: 700; color: #fff; font-size: 0.86rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(otherName)}</div>
                  <div style="font-size: 0.72rem; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(req.last_message || req.proposed_venue || 'Connected')}</div>
                </div>
              </div>
              <div style="text-align: right; flex-shrink: 0;">
                <div style="font-size: 0.74rem; font-weight: 700; color: #38bdf8;">${otherElo}</div>
                ${unread > 0 ? `<span class="oc-badge oc-badge-danger" style="margin-top: 2px;">${unread}</span>` : ''}
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // Auto-select first conversation if none selected
    if (!connectState.activeRequestId && acceptedConvos.length > 0) {
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

function openChatWithRequest(requestId) {
  connectState.activeRequestId = requestId;
  switchConnectTab('chats');
  selectConversation(requestId);
}

async function selectConversation(requestId) {
  connectState.activeRequestId = requestId;
  const req = connectState.requestsList.find(r => r.id === requestId);

  const header = document.getElementById('chat-active-header');
  const inputForm = document.getElementById('chat-input-form');
  const nameEl = document.getElementById('chat-active-name');
  const eloEl = document.getElementById('chat-active-elo');
  const subEl = document.getElementById('chat-active-sub');
  const avatarEl = document.getElementById('chat-active-avatar');
  const msgContainer = document.getElementById('chat-messages-container');

  if (header) header.style.display = 'flex';
  if (inputForm) inputForm.style.display = 'flex';

  // Highlight selected in sidebar
  const convoList = document.getElementById('chat-conversations-list');
  if (convoList) {
    Array.from(convoList.children).forEach(child => {
      child.style.background = 'rgba(255,255,255,0.02)';
      child.style.borderColor = 'rgba(255,255,255,0.05)';
    });
  }

  await refreshActiveMessages(false);
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
    const myId = connectState.userProfile?.player_id;

    // Update Header
    const nameEl = document.getElementById('chat-active-name');
    const eloEl = document.getElementById('chat-active-elo');
    const subEl = document.getElementById('chat-active-sub');
    const avatarEl = document.getElementById('chat-active-avatar');

    if (nameEl) nameEl.textContent = otherName;
    if (avatarEl) avatarEl.textContent = otherName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    if (subEl) subEl.textContent = `Proposed: ${req.proposed_points || 2000} pts at ${req.proposed_venue || 'Local Store'}`;

    const messages = res.messages || [];
    if (messages.length === 0) {
      msgContainer.innerHTML = `
        <div style="text-align: center; margin: auto; color: #64748b;">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">🤝</div>
          <div style="font-weight: 700; color: #fff; font-size: 0.95rem;">Match Challenge Accepted!</div>
          <div style="font-size: 0.8rem; margin-top: 4px;">Say hi and coordinate your battle round timing, store location, or share a live match room code.</div>
        </div>
      `;
      return;
    }

    const wasNearBottom = (msgContainer.scrollHeight - msgContainer.scrollTop - msgContainer.clientHeight) < 100;

    msgContainer.innerHTML = messages.map(m => {
      const isMe = (m.sender_id === myId);
      const timeStr = m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

      let roomCard = '';
      if (m.room_key) {
        roomCard = `
          <div style="margin-top: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(56,189,248,0.4); border-radius: 8px; padding: 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <div>
              <div style="font-size: 0.72rem; font-weight: 800; color: #38bdf8; text-transform: uppercase;">🎲 Live Game Tracker Room</div>
              <div style="font-family: monospace; font-size: 1rem; font-weight: 800; color: #fff;">${m.room_key}</div>
            </div>
            <a href="/11th/tracker/play?room=${encodeURIComponent(m.room_key)}" target="_blank" class="btn btn-primary" style="padding: 4px 10px; font-size: 0.75rem; text-decoration: none;">
              Join Match Room ↗
            </a>
          </div>
        `;
      }

      return `
        <div class="oc-msg-bubble ${isMe ? 'oc-msg-out' : 'oc-msg-in'}">
          <div style="font-size: 0.7rem; opacity: 0.75; margin-bottom: 3px;">
            ${escapeHtml(isMe ? 'You' : m.sender_name)} • ${timeStr}
          </div>
          <div>${escapeHtml(m.message_text)}</div>
          ${roomCard}
        </div>
      `;
    }).join('');

    if (!scrollOnlyIfNearBottom || wasNearBottom) {
      msgContainer.scrollTop = msgContainer.scrollHeight;
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
  try {
    const res = await window.api.sendConnectMessage(connectState.activeRequestId, text);
    if (res && res.success) {
      await refreshActiveMessages(false);
      loadUserRequests();
    }
  } catch (err) {
    alert('Failed to send message: ' + err.message);
  }
}

async function createGameTrackerRoomForChat() {
  if (!connectState.activeRequestId) return;

  // Generate random 6-character room code
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let roomCode = "";
  for (let i = 0; i < 6; i++) {
    roomCode += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const msg = `🎲 I generated an OmniTactica Game Tracker match room for our game! Click the button below to join the digital scoreboard.`;

  try {
    const res = await window.api.sendConnectMessage(connectState.activeRequestId, msg, roomCode);
    if (res && res.success) {
      await refreshActiveMessages(false);
    }
  } catch (err) {
    alert('Failed to create room: ' + err.message);
  }
}

function startChatPolling() {
  stopChatPolling();
  connectState.chatPollInterval = setInterval(() => {
    if (connectState.activeTab === 'chats') {
      refreshActiveMessages(true);
      loadUserRequests();
    }
  }, 4000);
}

function stopChatPolling() {
  if (connectState.chatPollInterval) {
    clearInterval(connectState.chatPollInterval);
    connectState.chatPollInterval = null;
  }
}

/* --------------------------------------------------------------------------
   UNREAD COUNT NOTIFICATION BADGE
   -------------------------------------------------------------------------- */
async function updateUnreadCountBadge() {
  try {
    const res = await window.api.getConnectUnreadCount();
    const count = (res && res.unread_count) ? parseInt(res.unread_count, 10) : 0;
    const badge = document.getElementById('badge-unread-count');
    if (badge) {
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }
  } catch (e) {}
}

/* --------------------------------------------------------------------------
   GOOGLE PLACES AUTOCOMPLETE FOR MODAL
   -------------------------------------------------------------------------- */
async function initConnectGooglePlaces() {
  try {
    const res = await fetch('/api/config/maps-key');
    if (!res.ok) return;
    const data = await res.json();
    const apiKey = data?.key;
    if (apiKey && typeof google === 'undefined') {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&callback=attachModalPlacesAutocomplete`;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  } catch (e) {}
}

function attachModalPlacesAutocomplete() {
  const venueInput = document.getElementById('modal-lfg-venue');
  if (!venueInput || typeof google === 'undefined' || !google.maps || !google.maps.places) return;

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
