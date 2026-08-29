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

    <!-- 2-Column Grid: Trajectory Chart & Upcoming Events -->
    <div class="hub-grid-2col">
      
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

      <!-- Card 2: Tournament Hub (Registered, Recommended Near Me & Search) -->
      <div class="hub-card" id="hub-tournament-discovery-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <h3 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin: 0;">⚔️ Tournament Hub & Events</h3>
          <span id="hub-tourney-tab-count" style="font-size: 0.75rem; color: var(--accent); font-weight: 600;">${upcoming.length} registered</span>
        </div>

        <!-- Navigation Tabs -->
        <div class="hub-tournaments-nav">
          <button id="hub-btn-tab-registered" class="hub-tourney-tab-btn active" onclick="switchHubTourneyTab('registered')">⚔️ Registered (${upcoming.length})</button>
          <button id="hub-btn-tab-recommended" class="hub-tourney-tab-btn" onclick="switchHubTourneyTab('recommended')">🎯 Near Me</button>
          <button id="hub-btn-tab-search" class="hub-tourney-tab-btn" onclick="switchHubTourneyTab('search')">🔍 Search Events</button>
        </div>

        <!-- Tab 1: Registered Tournaments -->
        <div id="hub-tourney-view-registered">
          ${upcoming.length > 0 ? `
            <div style="display: flex; flex-direction: column; gap: 0.6rem; max-height: 280px; overflow-y: auto;">
              ${upcoming.map(ev => `
                <div class="upcoming-event-pill" onclick="openEventModal('${ev.event_id}')">
                  <div>
                    <div style="font-weight: 700; font-size: 0.88rem; color: #fff;">${escapeHtml(ev.event_name)}</div>
                    <div style="font-size: 0.76rem; color: var(--text-secondary);">${ev.event_date ? ev.event_date.substring(0, 10) : 'TBD'} • ${escapeHtml(ev.city || '')} ${escapeHtml(ev.state || '')}</div>
                  </div>
                  <div style="text-align: right;">
                    <span class="tier-badge tier-A" style="font-size: 0.72rem;">${ev.total_players || 0} Players</span>
                    <div style="font-size: 0.72rem; color: var(--accent); margin-top: 0.2rem;">${escapeHtml(ev.registered_faction || 'Registered')}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : `
            <div style="padding: 1.75rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
              <div>📅 No registered upcoming tournaments detected.</div>
              <div style="margin-top: 0.35rem; font-size: 0.78rem;">${isBcpConnected ? 'Click "Near Me" or "Search Events" above to discover tournaments!' : '<button class="bcp-login-btn" style="margin-top:0.5rem; font-size:0.8rem;" onclick="openBcpLinkModal()">Link BCP Account to Sync Events</button>'}</div>
            </div>
          `}
        </div>

        <!-- Tab 2: Recommended Near Me -->
        <div id="hub-tourney-view-recommended" style="display: none;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.65rem; font-size: 0.78rem; color: var(--text-secondary);">
            <span id="hub-rec-location-label">📍 Recommendations based on your region</span>
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
              <option value="All">All States / Global</option>
            </select>
          </div>
          <div id="hub-recommended-list" style="max-height: 260px; overflow-y: auto;">
            <div class="empty-state" style="padding: 1.5rem 0;"><div class="spinner"></div></div>
          </div>
        </div>

        <!-- Tab 3: Search Upcoming Events -->
        <div id="hub-tourney-view-search" style="display: none;">
          <div class="hub-search-bar">
            <input type="text" id="hub-events-search-input" class="hub-search-input" placeholder="Search by name, city, state, or venue..." oninput="debounceHubEventsSearch()">
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
              <option value="UK">UK</option>
            </select>
          </div>
          <div id="hub-search-results-list" style="max-height: 250px; overflow-y: auto;">
            <div style="padding: 1.5rem 0; text-align: center; color: var(--text-muted); font-size: 0.82rem;">Type in the search bar to find upcoming tournaments.</div>
          </div>
        </div>

      </div>

    </div>

    <!-- 2-Column Grid: Army Mastery & Opponent Matchup Matrix -->
    <div class="hub-grid-2col">
      
      <!-- Card 3: Faction Mastery Breakdown -->
      <div class="hub-card">
        <h3 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin-bottom: 0.75rem;">🛡️ Faction Mastery & Win Rates</h3>
        ${factionMastery.length > 0 ? `
          <div class="table-container">
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

      <!-- Card 4: Matchup Matrix vs Enemy Factions -->
      <div class="hub-card">
        <h3 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin-bottom: 0.75rem;">🎯 Matchup Matrix (vs Opponent Armies)</h3>
        ${matchups.length > 0 ? `
          <div class="table-container">
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

    </div>

    <!-- Tournament History & Game-by-Game Record -->
    <div class="hub-card" style="margin-top: 1.25rem;">
      <h3 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin-bottom: 0.75rem;">📜 Career Match History & Elo Deltas</h3>
      ${history.length > 0 ? `
        <div class="table-container" style="max-height: 420px; overflow-y: auto;">
          <table id="hub-history-table" class="table-compact" style="width: 100%;">
            <thead>
              <tr>
                <th>Date</th>
                <th>Tournament</th>
                <th>Rnd</th>
                <th>Opponent</th>
                <th>Opp Elo</th>
                <th>Result</th>
                <th>Elo Delta</th>
                <th>New Elo</th>
              </tr>
            </thead>
            <tbody>
              ${history.slice().reverse().map(h => {
                const delta = Number(h.delta_elo || 0);
                const isPos = delta >= 0;
                const res = h.result === 'W' ? '<span class="res-badge res-w">WIN</span>' : (h.result === 'L' ? '<span class="res-badge res-l">LOSS</span>' : '<span class="res-badge res-d">DRAW</span>');
                return `
                  <tr>
                    <td style="color: var(--text-muted); font-size: 0.78rem;">${h.match_date ? h.match_date.substring(0, 10) : '-'}</td>
                    <td><span class="player-link" onclick="openEventModal('${h.event_id}')">${escapeHtml(h.event_name || 'Event')}</span></td>
                    <td>R${h.round || 1}</td>
                    <td><b>${escapeHtml(h.opponent_name || 'Opponent')}</b> <span style="font-size:0.72rem; color:var(--text-secondary);">(${escapeHtml(h.opponent_faction || '')})</span></td>
                    <td style="font-family:var(--font-mono); font-size:0.8rem;">${Number(h.opponent_elo || 1500).toFixed(1)}</td>
                    <td>${res}</td>
                    <td><b style="color: ${isPos ? 'var(--win)' : 'var(--loss)'}; font-family:var(--font-mono);">${isPos ? '+' : ''}${delta.toFixed(1)}</b></td>
                    <td style="font-family:var(--font-mono); font-weight:700; color:#fff;">${Number(h.new_elo || 1500).toFixed(1)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : '<div style="color:var(--text-muted); font-size:0.85rem; padding:1rem;">No historical matches recorded.</div>'}
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
