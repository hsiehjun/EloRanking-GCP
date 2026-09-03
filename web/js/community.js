/* ==========================================================================
   COMMUNITY.JS - Regional Community Hub, Local Leaderboard, Chat & Discovery (v1.0)
   Built by the community, for the community.
   ========================================================================== */

const communityState = {
  currentRegion: 'socal',
  activeSubtab: 'events',
  eventsFilter: 'all', // 'all', 'upcoming', 'recent'
  overview: null,
  isLoading: false,
  chatMessages: [],
  chatPollingInterval: null,
  isSendingChat: false,
  regions: []
};

/**
 * Main entrypoint when switching to Community Hub tab
 */
async function initCommunityHub() {
  updateCommunityBcpBanner();
  await loadCommunityRegions();
  await loadCommunityHub(communityState.currentRegion);
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
          <div style="font-size: 0.76rem; color: #10b981; margin-top: 1px;">✓ Automatic local scene matching & shared tournament discovery active</div>
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
            Linking your BCP account enables <strong>automatic local scene matching</strong>, surfaces fellow competitors you've shared tournaments with, and enters your verified records into regional leaderboards.
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
 * Fetch available regions from API and populate the region dropdown
 */
async function loadCommunityRegions() {
  try {
    const res = await API.getCommunityRegions();
    if (res && res.regions) {
      communityState.regions = res.regions;
      const select = document.getElementById('comm-region-select');
      if (select) {
        select.innerHTML = res.regions.map(r => `
          <option value="${escapeHtml(r.id)}" ${r.id === communityState.currentRegion ? 'selected' : ''}>
            ${escapeHtml(r.badge || r.name)} — ${escapeHtml(r.name)}
          </option>
        `).join('');
      }
    }
  } catch (err) {
    console.warn('Notice loading community regions:', err);
  }
}

/**
 * Load complete Community Hub data for a region
 */
async function loadCommunityHub(regionId, lat = null, lng = null) {
  communityState.isLoading = true;
  communityState.currentRegion = regionId || 'socal';

  // Sync region select dropdown
  const select = document.getElementById('comm-region-select');
  if (select && select.value !== communityState.currentRegion) {
    select.value = communityState.currentRegion;
  }

  // Update quick pills active state
  document.querySelectorAll('.comm-pill-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.region === communityState.currentRegion);
  });

  // Show loading indicator
  const mainView = document.getElementById('comm-subtab-container');
  if (mainView && !communityState.overview) {
    mainView.innerHTML = `
      <div style="padding: 4rem 1rem; text-align: center; color: var(--text-muted);">
        <div class="spinner" style="margin: 0 auto 0.75rem;"></div>
        <div style="font-size: 0.95rem; font-weight: 600; color: #cbd5e1;">Loading Regional Scene Intel...</div>
        <div style="font-size: 0.8rem; color: #64748b; margin-top: 4px;">Fetching regional tournaments, competitors & local leaderboard</div>
      </div>
    `;
  }

  try {
    const data = await API.getCommunityOverview(communityState.currentRegion, lat, lng);
    if (!data || !data.success) {
      throw new Error(data?.error || 'Failed to load community data');
    }
    communityState.overview = data;

    // Render region header info
    renderCommunityHeader(data.region);

    // Render current active subtab
    renderCurrentSubtab();
  } catch (err) {
    console.error('Failed to load community hub:', err);
    if (mainView) {
      mainView.innerHTML = `
        <div style="padding: 3rem 1rem; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border);">
          <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">⚠️</div>
          <h4 style="color: #fff; margin-bottom: 0.4rem;">Unable to Load Regional Hub</h4>
          <p style="font-size: 0.85rem; color: var(--text-secondary); max-width: 480px; margin: 0 auto 1.25rem;">
            ${escapeHtml(err.message || 'An unexpected error occurred while fetching regional data.')}
          </p>
          <button class="btn btn-primary" onclick="loadCommunityHub('${communityState.currentRegion}')">🔄 Retry</button>
        </div>
      `;
    }
  } finally {
    communityState.isLoading = false;
  }
}

/**
 * Render region metadata badge and title
 */
function renderCommunityHeader(regionInfo) {
  const badgeEl = document.getElementById('comm-header-badge');
  const titleEl = document.getElementById('comm-header-title');
  const descEl = document.getElementById('comm-header-desc');

  if (regionInfo) {
    if (badgeEl) badgeEl.textContent = regionInfo.badge || '📍 Regional Scene';
    if (titleEl) titleEl.textContent = regionInfo.name || 'Local Community';
    if (descEl) descEl.textContent = regionInfo.description || 'Local tournament scene and competitive circuit';
  }
}

/**
 * Handle changing region from select dropdown or quick pill
 */
function changeCommunityRegion(regionId) {
  if (!regionId) return;
  stopCommunityChatPolling();
  loadCommunityHub(regionId);
}

/**
 * Detect user's closest region via browser Geolocation
 */
function detectCommunityRegion() {
  const btn = document.getElementById('comm-btn-detect-gps');
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>🛰️</span> <span>Detecting GPS...</span>';
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span>📍</span> <span>Detect My Region</span>';
      }
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      // Find closest region by Haversine distance
      let closestRegion = 'socal';
      let minDistance = Infinity;

      const regions = communityState.regions.length > 0 ? communityState.regions : [
        { id: 'socal', lat: 33.7490, lng: -117.8732 },
        { id: 'norcal', lat: 37.7749, lng: -122.4194 },
        { id: 'texas', lat: 30.2672, lng: -97.7431 },
        { id: 'pnw', lat: 47.6062, lng: -122.3321 },
        { id: 'midwest', lat: 41.8781, lng: -87.6298 },
        { id: 'northeast', lat: 40.7128, lng: -74.0060 },
        { id: 'southeast', lat: 33.7490, lng: -84.3880 },
        { id: 'mountain', lat: 39.7392, lng: -104.9903 },
        { id: 'uk', lat: 51.5074, lng: -0.1278 }
      ];

      for (const r of regions) {
        if (r.lat != null && r.lng != null) {
          const d = haversineDistance(lat, lng, r.lat, r.lng);
          if (d < minDistance) {
            minDistance = d;
            closestRegion = r.id;
          }
        }
      }

      console.log(`📍 Closest region detected: ${closestRegion} (~${Math.round(minDistance)} miles)`);
      changeCommunityRegion(closestRegion);
    },
    (err) => {
      console.warn('Geolocation failed:', err);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span>📍</span> <span>Detect My Region</span>';
      }
      alert('Could not determine your location. Please select your region manually.');
    },
    { timeout: 10000, maximumAge: 60000 }
  );
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = x => (x * Math.PI) / 180;
  const R = 3958.8; // miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Switch Community Hub Subtab
 */
function switchCommunitySubtab(subtabName) {
  communityState.activeSubtab = subtabName;

  // Toggle subtab buttons
  document.querySelectorAll('.comm-subtab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.subtab === subtabName);
  });

  // Stop chat polling if leaving chat subtab
  if (subtabName !== 'chat') {
    stopCommunityChatPolling();
  }

  renderCurrentSubtab();
}

/**
 * Renders the active subtab content
 */
function renderCurrentSubtab() {
  if (!communityState.overview) return;

  if (communityState.activeSubtab === 'events') {
    renderCommunityEvents();
  } else if (communityState.activeSubtab === 'competitors') {
    renderCommunityCompetitors();
  } else if (communityState.activeSubtab === 'leaderboard') {
    renderCommunityLeaderboard();
  } else if (communityState.activeSubtab === 'chat') {
    renderCommunityChat();
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
  const container = document.getElementById('comm-subtab-container');
  if (!container) return;

  const overview = communityState.overview;
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
          <span>🏆 Regional Tournaments</span>
          <span style="font-size: 0.75rem; color: #94a3b8; font-weight: 500;">(${upcoming.length} upcoming, ${recent.length} recent)</span>
        </h3>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
          Tournament scenes, Field Avg Elo ratings, and registered rosters
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
        <div style="padding: 2rem; text-align: center; color: var(--text-muted); background: rgba(15, 23, 42, 0.5); border-radius: 10px; border: 1px dashed var(--border);">
          No upcoming tournaments currently scheduled in this region. Check back soon or browse recent tournament results below!
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
        <div style="padding: 2rem; text-align: center; color: var(--text-muted); background: rgba(15, 23, 42, 0.5); border-radius: 10px; border: 1px dashed var(--border);">
          No recent tournament results found for this region.
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
  const loc = [ev.venue, ev.city, ev.state].filter(Boolean).join(', ') || 'Online / Unspecified';
  const fieldAvg = ev.avg_field_elo ? Math.round(Number(ev.avg_field_elo)) : null;
  const topSeed = ev.top_seed_elo ? Math.round(Number(ev.top_seed_elo)) : null;

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
        <span class="badge" style="background: rgba(16,185,129,0.1); color: #10b981; border: 1px solid rgba(16,185,129,0.25); font-size: 0.72rem;">
          ${isUpcoming ? '⚡ Upcoming' : '✓ Completed'}
        </span>
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
  const container = document.getElementById('comm-subtab-container');
  if (!container) return;

  const overview = communityState.overview;
  const competitors = overview.local_competitors || [];
  const disclaimer = overview.disclaimer || (
    "Competitors surfaced here based on shared tournament participation and verified event rosters in your region. " +
    "Linking your BCP account enables automatic local scene matching."
  );

  let html = `
    <!-- Verified Tournament Participation Disclaimer (Mandatory) -->
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
          <span>👥 Local Scene Competitors</span>
          <span style="font-size: 0.75rem; color: #94a3b8; font-weight: 500;">(${competitors.length} active players)</span>
        </h3>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
          Tabletop players identified through tournament participation and local circuits
        </div>
      </div>
    </div>
  `;

  if (competitors.length === 0) {
    html += `
      <div style="padding: 3rem 1rem; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: 12px; border: 1px dashed var(--border);">
        <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</div>
        <h4 style="color: #fff; margin-bottom: 0.4rem;">No Competitors Found in this Region</h4>
        <p style="font-size: 0.85rem; color: var(--text-secondary); max-width: 480px; margin: 0 auto 1.25rem;">
          No verified tournament participants found yet for this region. Link your BCP account or choose another region.
        </p>
      </div>
    `;
  } else {
    html += `<div class="comm-competitors-grid">`;
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

  return `
    <div class="comm-competitor-card">
      <div style="display: flex; gap: 12px; align-items: flex-start;">
        <div class="comm-player-avatar" onclick="openPlayerModal('${escapeHtml(c.player_id)}')">
          ${escapeHtml(initials)}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 6px;">
            <div style="font-weight: 800; font-size: 0.98rem; color: #fff; cursor: pointer; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" onclick="openPlayerModal('${escapeHtml(c.player_id)}')">
              ${escapeHtml(name)}
            </div>
            <span class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; font-size: 0.7rem; font-weight: 700; flex-shrink: 0;">
              ${elo} Elo
            </span>
          </div>
          <div style="font-size: 0.76rem; color: #94a3b8; margin-top: 2px;">
            ${escapeHtml(faction)} ${c.team ? `&bull; <strong style="color: #cbd5e1;">${escapeHtml(c.team)}</strong>` : ''}
          </div>
        </div>
      </div>

      <div style="margin: 0.75rem 0; display: flex; flex-direction: column; gap: 6px;">
        ${sharedBadge}
        <div style="font-size: 0.74rem; color: #64748b; display: flex; justify-content: space-between;">
          <span>Peak: <strong style="color: #cbd5e1;">${peak} Elo</strong></span>
          <span>Win Rate: <strong style="color: #10b981;">${winRate}%</strong></span>
        </div>
      </div>

      <div style="display: flex; gap: 0.5rem; margin-top: auto;">
        <button class="btn btn-primary" style="flex: 1; font-size: 0.76rem; padding: 0.42rem 0.65rem; justify-content: center; font-weight: 700;" onclick="challengeCompetitor('${escapeHtml(c.player_id)}', '${escapeHtml(name)}')">
          ⚡ Challenge
        </button>
        <button class="btn btn-outline" style="font-size: 0.76rem; padding: 0.42rem 0.75rem; color: #cbd5e1;" onclick="openPlayerModal('${escapeHtml(c.player_id)}')">
          Profile
        </button>
      </div>
    </div>
  `;
}

/**
 * Trigger match challenge or redirect to OmniConnect
 */
function challengeCompetitor(playerId, playerName) {
  if (typeof openProposeMatchModal === 'function') {
    openProposeMatchModal(playerId, playerName);
  } else if (typeof switchTab === 'function') {
    switchTab('connect');
  }
}

/**
 * --------------------------------------------------------------------------
 * SUBTAB 3: REGIONAL LEADERBOARD
 * --------------------------------------------------------------------------
 */
function renderCommunityLeaderboard() {
  const container = document.getElementById('comm-subtab-container');
  if (!container) return;

  const overview = communityState.overview;
  const leaderboard = overview.local_leaderboard || [];

  let html = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.5rem;">
      <div>
        <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0; display: flex; align-items: center; gap: 8px;">
          <span>👑 Regional Player Standings</span>
          <span style="font-size: 0.75rem; color: #94a3b8; font-weight: 500;">(${leaderboard.length} ranked competitors)</span>
        </h3>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
          Top rated tournament players actively competing in this regional scene
        </div>
      </div>
    </div>

    <div class="table-container" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden;">
      <table id="comm-leaderboard-table" class="data-table">
        <thead>
          <tr>
            <th style="width: 65px; text-align: center;">Rank</th>
            <th>Competitor</th>
            <th>Current Elo</th>
            <th>Peak Elo</th>
            <th>Primary Faction</th>
            <th>Team / Club</th>
            <th>Regional Events</th>
            <th>Win Rate</th>
          </tr>
        </thead>
        <tbody>
  `;

  if (leaderboard.length === 0) {
    html += `<tr><td colspan="8" class="empty-state">No ranked players found for this region.</td></tr>`;
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
 * SUBTAB 4: LOCAL COMMUNITY CHAT
 * --------------------------------------------------------------------------
 */
async function renderCommunityChat() {
  const container = document.getElementById('comm-subtab-container');
  if (!container) return;

  const overview = communityState.overview;
  const regionName = overview?.region?.name || 'Local Scene';

  container.innerHTML = `
    <div class="comm-chat-container">
      <!-- Chat Header -->
      <div class="comm-chat-header">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.3rem;">💬</span>
          <div>
            <div style="font-weight: 800; font-size: 0.95rem; color: #fff;">
              ${escapeHtml(regionName)} Community Chat
            </div>
            <div style="font-size: 0.74rem; color: #94a3b8;">
              Discuss local tournaments, carpools, army list tuning & sparring matches
            </div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 6px #10b981;"></span>
          <span style="font-size: 0.72rem; color: #10b981; font-weight: 700; text-transform: uppercase;">Live Feed</span>
        </div>
      </div>

      <!-- Messages Stream -->
      <div id="comm-chat-messages" class="comm-chat-messages">
        <div style="padding: 2.5rem; text-align: center; color: var(--text-muted);">
          <div class="spinner" style="margin: 0 auto 0.5rem;"></div>
          Connecting to regional chat feed...
        </div>
      </div>

      <!-- Input Bar -->
      <form class="comm-chat-input-bar" onsubmit="handleSendCommunityChat(event)">
        <input type="text" id="comm-chat-input" placeholder="Type a message to the ${escapeHtml(regionName)} community..." required autocomplete="off">
        <button type="submit" id="comm-chat-send-btn" class="btn btn-primary" style="padding: 0.6rem 1.25rem; font-weight: 700;">
          Send
        </button>
      </form>
    </div>
  `;

  await loadCommunityChatMessages();
  startCommunityChatPolling();
}

async function loadCommunityChatMessages(scrollIfBottom = true) {
  const stream = document.getElementById('comm-chat-messages');
  if (!stream) return;

  try {
    const res = await API.getCommunityChatMessages(communityState.currentRegion, 60);
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
    const res = await API.sendCommunityChatMessage(communityState.currentRegion, text);
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
window.changeCommunityRegion = changeCommunityRegion;
window.detectCommunityRegion = detectCommunityRegion;
window.switchCommunitySubtab = switchCommunitySubtab;
window.setCommunityEventsFilter = setCommunityEventsFilter;
window.challengeCompetitor = challengeCompetitor;
window.handleSendCommunityChat = handleSendCommunityChat;
