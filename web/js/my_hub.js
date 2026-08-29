/* ==========================================================================
   MY_HUB.JS - Competitor Profile Hub & Personal Analytics
   ========================================================================== */

let myHubData = null;

async function loadMyHubDashboard() {
  const container = document.getElementById('my-hub-content');
  if (!container) return;

  if (!currentUser && (localStorage.getItem('native_session_token') || localStorage.getItem('bcp_session_token'))) {
    if (typeof initAuth === 'function') await initAuth();
  }

  if (!currentUser) {
    container.innerHTML = `
      <div style="max-width: 440px; margin: 2rem auto; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 1.75rem; box-shadow: 0 8px 24px rgba(0,0,0,0.4);">
        
        <div style="display: flex; border-bottom: 1px solid var(--border-color); margin-bottom: 1.25rem;">
          <button id="auth-tab-btn-login" class="login-tab-btn active" onclick="setAuthCardTab('login')">Sign In</button>
          <button id="auth-tab-btn-register" class="login-tab-btn" onclick="setAuthCardTab('register')">Create Account</button>
        </div>

        <!-- Tab 1: Native Sign In -->
        <form id="auth-form-login" onsubmit="handleNativeLogin(event)">
          <div style="margin-bottom: 1rem;">
            <label style="font-size: 0.82rem; font-weight: 600; color: var(--text-secondary); display: block; margin-bottom: 0.35rem;">Email Address</label>
            <input type="email" id="login-email" class="search-input" style="width: 100%; font-size: 0.9rem;" placeholder="e.g. competitor@example.com" required>
          </div>
          <div style="margin-bottom: 1.25rem;">
            <label style="font-size: 0.82rem; font-weight: 600; color: var(--text-secondary); display: block; margin-bottom: 0.35rem;">Password</label>
            <input type="password" id="login-password" class="search-input" style="width: 100%; font-size: 0.9rem;" placeholder="••••••••••••" required>
          </div>
          <div id="login-error" style="display: none; color: var(--loss); font-size: 0.82rem; margin-bottom: 1rem; padding: 0.5rem; background: rgba(239,68,68,0.1); border-radius: 6px;"></div>
          <button type="submit" id="login-submit-btn" class="bcp-login-btn" style="width: 100%; justify-content: center; padding: 0.7rem; font-size: 0.92rem;">
            Sign In to My Hub
          </button>
        </form>

        <!-- Tab 2: Native Create Account -->
        <form id="auth-form-register" style="display: none;" onsubmit="handleNativeRegister(event)">
          <div style="margin-bottom: 0.85rem;">
            <label style="font-size: 0.82rem; font-weight: 600; color: var(--text-secondary); display: block; margin-bottom: 0.35rem;">Player Name</label>
            <input type="text" id="reg-name" class="search-input" style="width: 100%; font-size: 0.9rem;" placeholder="e.g. John Hsieh" required>
          </div>
          <div style="margin-bottom: 0.85rem;">
            <label style="font-size: 0.82rem; font-weight: 600; color: var(--text-secondary); display: block; margin-bottom: 0.35rem;">Email Address</label>
            <input type="email" id="reg-email" class="search-input" style="width: 100%; font-size: 0.9rem;" placeholder="e.g. competitor@example.com" required>
          </div>
          <div style="margin-bottom: 1.25rem;">
            <label style="font-size: 0.82rem; font-weight: 600; color: var(--text-secondary); display: block; margin-bottom: 0.35rem;">Password (6+ chars)</label>
            <input type="password" id="reg-password" class="search-input" style="width: 100%; font-size: 0.9rem;" placeholder="••••••••••••" minlength="6" required>
          </div>
          <div id="reg-error" style="display: none; color: var(--loss); font-size: 0.82rem; margin-bottom: 1rem; padding: 0.5rem; background: rgba(239,68,68,0.1); border-radius: 6px;"></div>
          <button type="submit" id="reg-submit-btn" class="bcp-login-btn" style="width: 100%; justify-content: center; padding: 0.7rem; font-size: 0.92rem;">
            Create Free Account
          </button>
        </form>

      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="empty-state" style="padding: 3rem 1rem;">
      <div class="spinner"></div>
      <div style="margin-top: 0.75rem;">Loading your personalized competitor hub...</div>
    </div>
  `;

  try {
    const data = await window.api.getUserDashboard(currentUser.player_id);
    myHubData = data;
    renderMyHub(data);
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="color:var(--loss);">Error loading competitor hub: ${err.message}</div>`;
  }
}

function renderMyHub(data) {
  const container = document.getElementById('my-hub-content');
  if (!container || !data) return;

  const p = data.player || {};
  const rankings = data.rankings || {};
  const history = data.history || [];
  const factionMastery = data.faction_mastery || [];
  const matchups = data.matchup_matrix || [];
  const upcoming = data.upcoming_events || [];

  const currentElo = Number(p.current_elo || 1500.0).toFixed(1);
  const peakElo = Number(p.peak_elo || 1500.0).toFixed(1);
  const winRate = Number(p.win_rate || 0.0).toFixed(1);
  const totalMatches = Number(p.matches_played || 0);

  const isBcpConnected = currentUser && currentUser.bcp_connected;
  const bcpEmail = currentUser && currentUser.bcp_email;

  let html = `
    <!-- Top Competitor Banner -->
    <div class="competitor-banner">
      <div style="display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap;">
        <div class="competitor-avatar">🏆</div>
        <div>
          <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
            <h2 style="font-size: 1.5rem; font-weight: 800; color: #fff; margin: 0;">${escapeHtml(p.player_name || currentUser.display_name || 'Competitor')}</h2>
            ${rankings.global_rank ? `<span class="tier-badge tier-S" style="font-size: 0.82rem; padding: 0.2rem 0.6rem;">World Rank #${rankings.global_rank}</span>` : ''}
            ${rankings.faction_rank ? `<span class="tier-badge tier-A" style="font-size: 0.82rem; padding: 0.2rem 0.6rem;">${escapeHtml(p.top_faction || '')} Rank #${rankings.faction_rank}</span>` : ''}
          </div>
          <div style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 0.35rem;">
            Primary Army: <b style="color: var(--accent);">${escapeHtml(p.top_faction || 'General')}</b> 
            ${p.team ? ` • Gaming Club: <b style="color: #fff;">${escapeHtml(p.team)}</b>` : ''}
          </div>

          <!-- BCP Linked Account Status Badge -->
          <div style="margin-top: 0.65rem; display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
            ${isBcpConnected ? `
              <span class="badge badge-win" style="font-size: 0.75rem; padding: 0.25rem 0.6rem; display: inline-flex; align-items: center; gap: 0.3rem;">
                <span>✅ BCP Linked:</span> <b>${escapeHtml(bcpEmail || 'Active')}</b>
              </span>
              <button onclick="handleDisconnectBcp()" style="background:transparent; border:none; color:var(--text-muted); font-size:0.75rem; text-decoration:underline; cursor:pointer;">Unlink</button>
            ` : `
              <button class="bcp-login-btn" style="padding: 0.25rem 0.75rem; font-size: 0.75rem;" onclick="openBcpLinkModal()">
                <span>🔗</span> Connect Best Coast Pairings
              </button>
            `}
          </div>
        </div>
      </div>

      <div style="display:flex; flex-direction:column; align-items:flex-end; gap:0.75rem; width:100%; max-width:480px;">
        <button class="subtab-btn" onclick="handleLogout()" style="font-size:0.8rem; padding:0.3rem 0.75rem;">🚪 Sign Out</button>
        <div class="competitor-stat-grid">
          <div class="c-stat-box">
            <div class="c-stat-val" style="color: var(--accent);">${currentElo}</div>
            <div class="c-stat-lbl">Current Elo</div>
          </div>
          <div class="c-stat-box">
            <div class="c-stat-val" style="color: #a855f7;">${peakElo}</div>
            <div class="c-stat-lbl">Peak Elo</div>
          </div>
          <div class="c-stat-box">
            <div class="c-stat-val" style="color: var(--win);">${winRate}%</div>
            <div class="c-stat-lbl">Career Win Rate</div>
          </div>
          <div class="c-stat-box">
            <div class="c-stat-val" style="color: #fff;">${p.wins || 0}W - ${p.losses || 0}L</div>
            <div class="c-stat-lbl">${totalMatches} Matches</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Full-Width Showcase: Tournament Hub & Discovery Suite -->
    <div class="hub-card" id="hub-tournament-discovery-card" style="margin-top: 1.25rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
        <div style="display: flex; align-items: center; gap: 0.6rem;">
          <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0;">⚔️ Tournament Hub & Events</h3>
          <span class="badge badge-win" style="font-size: 0.72rem; padding: 0.15rem 0.5rem;">Live Schedule</span>
        </div>
        <span id="hub-tourney-tab-count" style="font-size: 0.8rem; color: var(--accent); font-weight: 700;">${upcoming.length} registered</span>
      </div>

      <!-- Navigation Tabs -->
      <div class="hub-tournaments-nav" style="margin-bottom: 1rem;">
        <button id="hub-btn-tab-registered" class="hub-tourney-tab-btn active" onclick="switchHubTourneyTab('registered')">⚔️ Registered (${upcoming.length})</button>
        <button id="hub-btn-tab-recommended" class="hub-tourney-tab-btn" onclick="switchHubTourneyTab('recommended')">🎯 Recommended Near Me</button>
        <button id="hub-btn-tab-search" class="hub-tourney-tab-btn" onclick="switchHubTourneyTab('search')">🔍 Search Upcoming Tournaments</button>
      </div>

      <!-- Tab 1: Registered Tournaments -->
      <div id="hub-tourney-view-registered">
        ${upcoming.length > 0 ? `
          <div class="hub-events-grid">
            ${upcoming.map(ev => `
              <div class="hub-rec-card" onclick="openEventModal('${ev.event_id}')">
                <div style="flex: 1; min-width: 0; padding-right: 0.75rem;">
                  <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.25rem;">
                    <b style="font-size: 0.92rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(ev.event_name)}</b>
                    <span class="tier-badge tier-A" style="font-size: 0.68rem; padding: 0.1rem 0.45rem;">Registered</span>
                  </div>
                  <div style="font-size: 0.78rem; color: var(--text-secondary); display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                    <span>📅 ${ev.event_date ? ev.event_date.substring(0, 10) : 'TBD'}</span>
                    <span>•</span>
                    <span>📍 ${escapeHtml(ev.city || '')} ${escapeHtml(ev.state || '')}</span>
                  </div>
                </div>
                <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 0.25rem;">
                  <span class="badge" style="font-size: 0.72rem; background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">
                    👥 ${ev.total_players || 0} Players
                  </span>
                  <span style="font-size: 0.72rem; color: var(--accent); font-weight: 600;">${escapeHtml(ev.registered_faction || 'Confirmed')}</span>
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div style="padding: 2.25rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.88rem;">
            <div style="font-size: 1.1rem; margin-bottom: 0.35rem;">📅 No registered upcoming tournaments detected.</div>
            <div style="font-size: 0.8rem; max-width: 520px; margin: 0 auto;">${isBcpConnected ? 'Click <b>"Recommended Near Me"</b> or <b>"Search Upcoming Tournaments"</b> above to explore open events!' : '<button class="bcp-login-btn" style="margin-top:0.65rem; font-size:0.85rem;" onclick="openBcpLinkModal()">Link BCP Account to Auto-Sync</button>'}</div>
          </div>
        `}
      </div>

      <!-- Tab 2: Recommended Near Me -->
      <div id="hub-tourney-view-recommended" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; font-size: 0.82rem; color: var(--text-secondary); flex-wrap: wrap; gap: 0.75rem;">
          <span id="hub-rec-location-label" style="font-weight: 600;">📍 Recommendations based on your region</span>
          <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 0.35rem;">
              <span style="font-size: 0.78rem;">Radius:</span>
              <select id="hub-rec-radius-select" class="hub-state-select" onchange="loadHubRecommendedEvents()">
                <option value="50" selected>Within 50 miles</option>
                <option value="100">Within 100 miles</option>
                <option value="250">Within 250 miles</option>
                <option value="">Any Distance</option>
              </select>
            </div>
            <div style="display: flex; align-items: center; gap: 0.35rem;">
              <span style="font-size: 0.78rem;">Region:</span>
              <select id="hub-rec-state-select" class="hub-state-select" onchange="loadHubRecommendedEvents()">
                <option value="">Auto-Detect</option>
                <option value="CA">California (CA)</option>
                <option value="TX">Texas (TX)</option>
                <option value="FL">Florida (FL)</option>
                <option value="NY">New York (NY)</option>
                <option value="WA">Washington (WA)</option>
                <option value="IL">Illinois (IL)</option>
                <option value="OH">Ohio (OH)</option>
                <option value="PA">Pennsylvania (PA)</option>
                <option value="NC">North Carolina (NC)</option>
                <option value="All">All States / Global</option>
              </select>
            </div>
          </div>
        </div>
        <div id="hub-recommended-list" class="hub-events-grid">
          <div class="empty-state" style="padding: 2rem 0; grid-column: 1 / -1;"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- Tab 3: Search Upcoming Events -->
      <div id="hub-tourney-view-search" style="display: none;">
        <div class="hub-search-bar" style="margin-bottom: 1rem;">
          <input type="text" id="hub-events-search-input" class="hub-search-input" placeholder="Search tournaments by name, city, state, or venue..." oninput="debounceHubEventsSearch()">
          <select id="hub-search-state-filter" class="hub-state-select" onchange="executeHubEventsSearch()">
            <option value="">All States</option>
            <option value="CA">CA</option>
            <option value="TX">TX</option>
            <option value="FL">FL</option>
            <option value="NY">NY</option>
            <option value="WA">WA</option>
            <option value="IL">IL</option>
            <option value="OH">OH</option>
            <option value="PA">PA</option>
            <option value="NC">NC</option>
            <option value="UK">UK</option>
          </select>
        </div>
        <div id="hub-search-results-list" class="hub-events-grid">
          <div style="padding: 2rem 0; text-align: center; color: var(--text-muted); font-size: 0.85rem; grid-column: 1 / -1;">Type in the search bar above to discover upcoming tournaments.</div>
        </div>
      </div>

    </div>

    <!-- 2-Column Row 1: Trajectory Chart & Faction Mastery -->
    <div class="hub-grid-2col" style="margin-top: 1.25rem;">
      
      <!-- Card 1: Elo Trajectory Progression -->
      <div class="hub-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <h3 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin: 0;">📈 Elo Rating Trajectory</h3>
          <span style="font-size: 0.75rem; color: var(--text-muted);">${history.length} games logged</span>
        </div>
        <div style="overflow-x: auto;">
          <svg id="hub-trajectory-svg" style="width: 100%; height: 220px;"></svg>
        </div>
      </div>
      
      <!-- Card 2: Faction Mastery Breakdown -->
      <div class="hub-card">
        <h3 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin-bottom: 0.75rem;">🛡️ Faction Mastery & Win Rates</h3>
        ${factionMastery.length > 0 ? `
          <div class="table-container" style="max-height: 220px; overflow-y: auto;">
            <table id="hub-faction-table" class="table-compact" style="width: 100%;">
              <thead>
                <tr>
                  <th>Army Played</th>
                  <th>Games</th>
                  <th>Record</th>
                  <th>Win Rate</th>
                  <th>Avg Pts</th>
                </tr>
              </thead>
              <tbody>
                ${factionMastery.map(fm => `
                  <tr>
                    <td><b style="color: #fff;">${escapeHtml(fm.faction)}</b></td>
                    <td>${fm.games}</td>
                    <td style="font-size: 0.8rem;"><span style="color:var(--win);">${fm.wins}W</span> - <span style="color:var(--loss);">${fm.losses}L</span></td>
                    <td><b style="color: ${Number(fm.win_rate) >= 50 ? 'var(--win)' : 'var(--loss)'};">${Number(fm.win_rate).toFixed(1)}%</b></td>
                    <td>${fm.avg_score || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div style="color:var(--text-muted); font-size:0.85rem; padding:1rem;">No faction games recorded.</div>'}
      </div>

    </div>

    <!-- 2-Column Row 2: Matchup Matrix & Career Match History -->
    <div class="hub-grid-2col" style="margin-top: 1.25rem;">

      <!-- Card 3: Matchup Matrix vs Enemy Factions -->
      <div class="hub-card">
        <h3 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin-bottom: 0.75rem;">🎯 Matchup Matrix (vs Opponent Armies)</h3>
        ${matchups.length > 0 ? `
          <div class="table-container" style="max-height: 260px; overflow-y: auto;">
            <table id="hub-matchup-table" class="table-compact" style="width: 100%;">
              <thead>
                <tr>
                  <th>Enemy Army</th>
                  <th>Played</th>
                  <th>Score</th>
                  <th>Win Rate vs Army</th>
                </tr>
              </thead>
              <tbody>
                ${matchups.map(m => `
                  <tr>
                    <td><b style="color: #fff;">${escapeHtml(m.enemy_faction)}</b></td>
                    <td>${m.total_encounters}</td>
                    <td style="font-size: 0.8rem;"><span style="color:var(--win);">${m.wins}W</span> - <span style="color:var(--loss);">${m.losses}L</span>${m.draws ? ` - <span style="color:var(--draw);">${m.draws}D</span>` : ''}</td>
                    <td>
                      <div style="display:flex; align-items:center; gap:0.5rem;">
                        <div style="flex:1; background:rgba(255,255,255,0.08); height:6px; border-radius:3px; overflow:hidden;">
                          <div style="width:${Math.min(100, Number(m.win_rate))}%; background:${Number(m.win_rate) >= 50 ? 'var(--win)' : 'var(--loss)'}; height:100%;"></div>
                        </div>
                        <b style="font-size:0.8rem; font-family:var(--font-mono);">${Number(m.win_rate).toFixed(1)}%</b>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div style="color:var(--text-muted); font-size:0.85rem; padding:1rem;">No opponent matchup data recorded.</div>'}
      </div>

      <!-- Card 4: Half-Sized Career Match History & Elo Deltas -->
      <div class="hub-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <h3 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin: 0;">📜 Career Match History</h3>
          <span style="font-size: 0.75rem; color: var(--text-muted);">${history.length} matches</span>
        </div>
        ${history.length > 0 ? `
          <div class="table-container" style="max-height: 260px; overflow-y: auto;">
            <table id="hub-history-table" class="table-compact" style="width: 100%;">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Tournament</th>
                  <th>Opponent</th>
                  <th>Result</th>
                  <th>Elo</th>
                </tr>
              </thead>
              <tbody>
                ${history.slice().reverse().map(h => {
                  const delta = Number(h.delta_elo || 0);
                  const isPos = delta >= 0;
                  const res = h.result === 'W' ? '<span class="res-badge res-w" style="font-size:0.68rem; padding:0.1rem 0.35rem;">WIN</span>' : (h.result === 'L' ? '<span class="res-badge res-l" style="font-size:0.68rem; padding:0.1rem 0.35rem;">LOSS</span>' : '<span class="res-badge res-d" style="font-size:0.68rem; padding:0.1rem 0.35rem;">DRAW</span>');
                  return `
                    <tr>
                      <td style="color: var(--text-muted); font-size: 0.75rem;">${h.match_date ? h.match_date.substring(5, 10) : '-'}</td>
                      <td><span class="player-link" style="font-size:0.78rem;" onclick="openEventModal('${h.event_id}')">${escapeHtml(h.event_name || 'Event')}</span></td>
                      <td style="font-size:0.78rem;"><b>${escapeHtml(h.opponent_name || 'Opponent')}</b></td>
                      <td>${res}</td>
                      <td>
                        <span style="color: ${isPos ? 'var(--win)' : 'var(--loss)'}; font-family:var(--font-mono); font-size:0.75rem; font-weight:700;">
                          ${isPos ? '+' : ''}${delta.toFixed(1)}
                        </span>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div style="color:var(--text-muted); font-size:0.85rem; padding:1rem;">No historical matches recorded.</div>'}
      </div>

    </div>
  `;

  container.innerHTML = html;

  // Render SVG Trajectory
  renderHubTrajectory(history);
}

function renderHubTrajectory(history) {
  const svg = document.getElementById('hub-trajectory-svg');
  if (!svg || !history || history.length === 0) return;

  const w = svg.clientWidth || 480;
  const h = 220;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = '';

  const padX = 45;
  const padY = 25;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;

  const elos = history.map(h => Number(h.new_elo || 1500));
  const minElo = Math.floor(Math.min(...elos, 1400) / 50) * 50;
  const maxElo = Math.ceil(Math.max(...elos, 1600) / 50) * 50;
  const range = maxElo - minElo || 100;

  // Grid Lines
  const step = Math.max(50, Math.round(range / 4 / 25) * 25);
  for (let val = minElo; val <= maxElo; val += step) {
    const y = padY + plotH - ((val - minElo) / range) * plotH;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', padX);
    line.setAttribute('y1', y);
    line.setAttribute('x2', w - padX);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', 'rgba(255,255,255,0.08)');
    svg.appendChild(line);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', padX - 8);
    txt.setAttribute('y', y + 4);
    txt.setAttribute('fill', '#64748b');
    txt.setAttribute('font-size', '9');
    txt.setAttribute('font-family', 'monospace');
    txt.setAttribute('text-anchor', 'end');
    txt.textContent = val;
    svg.appendChild(txt);
  }

  // Plot Line
  const pts = history.map((pt, idx) => {
    const x = padX + (idx / (history.length - 1 || 1)) * plotW;
    const y = padY + plotH - ((Number(pt.new_elo) - minElo) / range) * plotH;
    return { x, y, elo: pt.new_elo };
  });

  if (pts.length > 1) {
    let dStr = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      dStr += ` L ${pts[i].x} ${pts[i].y}`;
    }
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', dStr);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#38bdf8');
    path.setAttribute('stroke-width', '2.5');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
  }

  pts.forEach(pt => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', pt.x);
    circle.setAttribute('cy', pt.y);
    circle.setAttribute('r', '3.5');
    circle.setAttribute('fill', '#38bdf8');
    circle.setAttribute('stroke', '#0a0c10');
    circle.setAttribute('stroke-width', '1.5');
    svg.appendChild(circle);
  });
}


/* ==========================================================================
   HUB TOURNAMENT RECOMMENDATIONS & SEARCH CONTROLLERS
   ========================================================================== */

let hubEventsSearchTimeout = null;

function switchHubTourneyTab(tabName) {
  const btnReg = document.getElementById('hub-btn-tab-registered');
  const btnRec = document.getElementById('hub-btn-tab-recommended');
  const btnSrch = document.getElementById('hub-btn-tab-search');
  const viewReg = document.getElementById('hub-tourney-view-registered');
  const viewRec = document.getElementById('hub-tourney-view-recommended');
  const viewSrch = document.getElementById('hub-tourney-view-search');
  const countBadge = document.getElementById('hub-tourney-tab-count');

  if (!btnReg || !btnRec || !btnSrch || !viewReg || !viewRec || !viewSrch) return;

  btnReg.classList.remove('active');
  btnRec.classList.remove('active');
  btnSrch.classList.remove('active');
  viewReg.style.display = 'none';
  viewRec.style.display = 'none';
  viewSrch.style.display = 'none';

  if (tabName === 'registered') {
    btnReg.classList.add('active');
    viewReg.style.display = 'block';
    if (countBadge && myHubData && myHubData.upcoming_events) {
      countBadge.textContent = `${myHubData.upcoming_events.length} registered`;
    }
  } else if (tabName === 'recommended') {
    btnRec.classList.add('active');
    viewRec.style.display = 'block';
    if (countBadge) countBadge.textContent = '📍 Nearby Events';
    loadHubRecommendedEvents();
  } else if (tabName === 'search') {
    btnSrch.classList.add('active');
    viewSrch.style.display = 'block';
    if (countBadge) countBadge.textContent = '🔍 Live Discovery';
    executeHubEventsSearch();
  }
}

let userDeviceGeo = null;

function getDeviceCoordinates() {
  return new Promise((resolve) => {
    if (userDeviceGeo) {
      return resolve(userDeviceGeo);
    }
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          userDeviceGeo = {
            lat: Number(pos.coords.latitude.toFixed(4)),
            lng: Number(pos.coords.longitude.toFixed(4))
          };
          resolve(userDeviceGeo);
        },
        () => {
          resolve(null);
        },
        { timeout: 2500, maximumAge: 600000 }
      );
    } else {
      resolve(null);
    }
  });
}

async function loadHubRecommendedEvents() {
  const container = document.getElementById('hub-recommended-list');
  const stateSelect = document.getElementById('hub-rec-state-select');
  const radiusSelect = document.getElementById('hub-rec-radius-select');
  const label = document.getElementById('hub-rec-location-label');
  if (!container) return;

  container.innerHTML = '<div class="empty-state" style="padding: 1.5rem 0;"><div class="spinner"></div></div>';

  const playerId = (currentUser && currentUser.player_id) ? currentUser.player_id : '';
  const selectedState = stateSelect ? stateSelect.value : '';
  const selectedRadius = radiusSelect && radiusSelect.value ? Number(radiusSelect.value) : 50;

  // Obtain live browser device GPS coordinates if available
  const geo = await getDeviceCoordinates();
  const userLat = geo ? geo.lat : null;
  const userLng = geo ? geo.lng : null;

  try {
    const data = await window.api.getRecommendedEvents(playerId, '', selectedState, userLat, userLng, selectedRadius, 40);
    const events = data.events || [];
    
    if (label) {
      if (data.detected_state) {
        label.innerHTML = `📍 Detected Home: <b>${escapeHtml(data.detected_state)}${data.detected_city ? ', ' + escapeHtml(data.detected_city) : ''}</b>`;
        if (stateSelect && !stateSelect.value) {
          stateSelect.value = data.detected_state;
        }
      } else if (selectedState) {
        label.innerHTML = `📍 Filtered by: <b>${escapeHtml(selectedState)}</b>`;
      } else {
        label.innerHTML = `📍 Featured Upcoming Tournaments`;
      }
    }

    if (events.length === 0) {
      container.innerHTML = `
        <div style="padding: 1.5rem 0; text-align: center; color: var(--text-muted); font-size: 0.82rem;">
          <div>No upcoming events found for this region.</div>
          <div style="margin-top: 0.35rem; font-size: 0.78rem;">Try selecting "All States / Global" or searching in the Search tab!</div>
        </div>
      `;
      return;
    }

    container.innerHTML = events.map(ev => renderHubEventCard(ev)).join('');
  } catch (err) {
    container.innerHTML = `<div style="color:var(--loss); font-size:0.8rem; padding:1rem;">Error loading recommendations: ${err.message}</div>`;
  }
}

function debounceHubEventsSearch() {
  clearTimeout(hubEventsSearchTimeout);
  hubEventsSearchTimeout = setTimeout(() => {
    executeHubEventsSearch();
  }, 300);
}

async function executeHubEventsSearch() {
  const container = document.getElementById('hub-search-results-list');
  const input = document.getElementById('hub-events-search-input');
  const stateSelect = document.getElementById('hub-search-state-filter');
  if (!container) return;

  const query = input ? input.value.trim() : '';
  const state = stateSelect ? stateSelect.value : '';

  container.innerHTML = '<div class="empty-state" style="padding: 1.5rem 0;"><div class="spinner"></div></div>';

  try {
    const data = await window.api.getRecommendedEvents('', query, state, 25);
    const events = data.events || [];

    if (events.length === 0) {
      container.innerHTML = `
        <div style="padding: 1.5rem 0; text-align: center; color: var(--text-muted); font-size: 0.82rem;">
          <div>No tournaments matched "${escapeHtml(query || state)}".</div>
          <div style="margin-top: 0.35rem; font-size: 0.78rem;">Try searching with a broader keyword or different state.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = events.map(ev => renderHubEventCard(ev)).join('');
  } catch (err) {
    container.innerHTML = `<div style="color:var(--loss); font-size:0.8rem; padding:1rem;">Search failed: ${err.message}</div>`;
  }
}

function renderHubEventCard(ev) {
  const evDate = ev.event_date ? ev.event_date.substring(0, 10) : 'TBD';
  
  // Clean location string (remove trailing United States for cleaner cards)
  let locParts = [ev.city, ev.state].filter(Boolean);
  if (ev.country && ev.country.trim() !== 'United States' && ev.country.trim() !== 'US') {
    locParts.push(ev.country);
  }
  const cleanLoc = locParts.join(', ') || 'Online / Global';

  const tierBadge = ev.tier_badge || 'tier-B';
  const tierName = ev.tier || 'Tournament';
  const timeLabel = ev.time_label || 'Upcoming';
  const isNearby = ev.is_nearby;
  const enrolled = ev.enrolled_count !== undefined ? ev.enrolled_count : (ev.total_players || 0);
  const capacity = ev.capacity_cap !== undefined ? ev.capacity_cap : enrolled;
  const spotsOpen = capacity > enrolled ? (capacity - enrolled) : 0;
  
  let capacityText = `👥 <b>${enrolled}</b> Enrolled`;
  if (capacity > 0 && capacity > enrolled) {
    capacityText = `👥 <b>${enrolled} / ${capacity}</b> Spots <span style="color:#10b981; font-size:0.75rem;">(${spotsOpen} open)</span>`;
  } else if (capacity > 0 && capacity === enrolled) {
    capacityText = `👥 <b>${enrolled} / ${capacity}</b> <span style="color:#f59e0b; font-size:0.75rem;">(Sold Out)</span>`;
  }

  const skillLabel = ev.skill_match_label || 'Standard Field';
  const skillBadge = ev.skill_match_badge || 'badge-match-prime';
  const avgElo = ev.avg_elo_display || 1550.0;

  return `
    <div class="hub-event-card-pro" onclick="openEventModal('${ev.id}')">
      <div>
        <!-- Card Header: Title & Badges -->
        <div class="hub-card-header">
          <h4 class="hub-card-title">${escapeHtml(ev.name)}</h4>
          <div class="hub-card-badges">
            ${isNearby ? '<span class="hub-rec-badge-nearby" style="font-size:0.7rem;">📍 Nearby</span>' : ''}
            <span class="tier-badge ${tierBadge}" style="font-size:0.7rem; padding:0.15rem 0.5rem;">${tierName}</span>
          </div>
        </div>

        <!-- Meta Row: Date & Location & Proximity Distance -->
        <div class="hub-card-meta-row" style="margin-top: 0.5rem;">
          <span class="hub-meta-item">
            <span style="color:var(--accent);">📅</span> <b>${evDate}</b> <span style="color:var(--text-muted);">(${timeLabel})</span>
          </span>
          <span>•</span>
          <span class="hub-meta-item">
            <span style="color:#a855f7;">📍</span> ${ev.distance_miles !== undefined && ev.distance_miles !== null ? `<b style="color:#38bdf8;">${ev.distance_miles} mi away</b> • ` : ''}${escapeHtml(cleanLoc)}
          </span>
        </div>
      </div>

      <!-- Tactical Analytics Bar -->
      <div class="hub-card-analytics-bar">
        <div style="display:flex; align-items:center; gap:0.4rem;">
          <span style="color:#f59e0b;">⭐</span>
          <span>Field Avg: <b style="color:#fff; font-family:var(--font-mono);">${avgElo}</b> Elo</span>
        </div>
        <span class="badge ${skillBadge}" style="font-size:0.72rem; padding:0.2rem 0.55rem; font-weight:700;">
          ${escapeHtml(skillLabel)}
        </span>
      </div>

      <!-- Footer Action Row -->
      <div class="hub-card-footer">
        <div class="hub-capacity-badge">
          ${capacityText}
        </div>
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span style="color:var(--text-muted); font-size:0.75rem;">View Roster & Pairings ⚔️</span>
          <a href="https://www.bestcoastpairings.com/event/${ev.id}" target="_blank" onclick="event.stopPropagation()" class="hub-card-action-btn">
            BCP ↗
          </a>
        </div>
      </div>
    </div>
  `;
}

window.switchHubTourneyTab = switchHubTourneyTab;
window.loadHubRecommendedEvents = loadHubRecommendedEvents;
window.debounceHubEventsSearch = debounceHubEventsSearch;
window.executeHubEventsSearch = executeHubEventsSearch;
