/* ==========================================================================
   MY_HUB.JS - Competitor Profile Hub & Personal Analytics
   ========================================================================== */

let myHubData = null;

async function loadMyHubDashboard() {
  const container = document.getElementById('my-hub-content');
  if (!container) return;

  if (!currentUser && (localStorage.getItem('native_session_token') || localStorage.getItem('elo_auth_token') || (document.cookie.includes('session_token=')))) {
    if (typeof initAuth === 'function') await initAuth();
  }

  if (!currentUser) {
    window.location.href = '/login?redirect=' + encodeURIComponent('/?tab=my-hub');
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
    if (!data.tracker_history || data.tracker_history.length === 0) {
      try {
        const histResp = await fetch(`/api/tracker/history?token=${encodeURIComponent(window.api.getAuthToken())}`, {
          headers: { 'Authorization': `Bearer ${window.api.getAuthToken()}` }
        });
        if (histResp.ok) {
          const histData = await histResp.json();
          if (histData && histData.history) {
            data.tracker_history = histData.history;
          }
        }
      } catch (e) {}
    }
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

    <!-- Full-Width Row 1: Tournament Hub & Events (Bigger) -->
    <div class="hub-card" id="hub-tournament-discovery-card" style="margin-top: 1.25rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
        <div style="display: flex; align-items: center; gap: 0.6rem;">
          <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0;">⚔️ Tournament Hub & Events</h3>
          <span class="badge-live"><span class="live-indicator-dot"></span>Live Schedule</span>
        </div>
        <span id="hub-tourney-tab-count" style="font-size: 0.82rem; color: var(--accent); font-weight: 700;">${upcoming.length} registered</span>
      </div>

      <!-- Navigation Tabs -->
      <div class="hub-tournaments-nav" style="margin-bottom: 0.85rem;">
        <button id="hub-btn-tab-registered" class="hub-tourney-tab-btn active" onclick="switchHubTourneyTab('registered')">⚔️ Registered (${upcoming.length})</button>
        <button id="hub-btn-tab-recommended" class="hub-tourney-tab-btn" onclick="switchHubTourneyTab('recommended')">🎯 Recommended Near Me</button>
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
                    <span class="tier-badge tier-A" style="font-size: 0.65rem; padding: 0.1rem 0.4rem;">Registered</span>
                  </div>
                  <div style="font-size: 0.78rem; color: var(--text-secondary); display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                    <span>📅 ${ev.event_date ? ev.event_date.substring(0, 10) : 'TBD'}</span>
                    <span>•</span>
                    <span>📍 ${escapeHtml(ev.city || '')} ${escapeHtml(ev.state || '')}</span>
                  </div>
                </div>
                <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 0.25rem;">
                  <span class="badge" style="font-size: 0.7rem; background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">
                    👥 ${ev.total_players || 0} Players
                  </span>
                  <span style="font-size: 0.72rem; color: var(--accent); font-weight: 600;">${escapeHtml(ev.registered_faction || 'Confirmed')}</span>
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div style="padding: 2rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
            <div style="font-size: 1.05rem; margin-bottom: 0.35rem;">📅 No registered upcoming tournaments.</div>
            <div style="font-size: 0.78rem; max-width: 480px; margin: 0 auto;">${isBcpConnected ? 'Click <b>"Recommended Near Me"</b> above to explore events!' : '<button class="bcp-login-btn" style="margin-top:0.65rem; font-size:0.8rem;" onclick="openBcpLinkModal()">Link BCP Account to Auto-Sync</button>'}</div>
          </div>
        `}
      </div>

      <!-- Tab 2: Recommended Near Me -->
      <div id="hub-tourney-view-recommended" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; font-size: 0.8rem; color: var(--text-secondary); flex-wrap: wrap; gap: 0.5rem;">
          <span id="hub-rec-location-label" style="font-weight: 600;">📍 Regional Events</span>
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <input type="text" id="hub-rec-search-input" class="hub-search-input" style="width: 140px; padding: 0.3rem 0.55rem; font-size: 0.75rem;" placeholder="Search..." oninput="debounceHubEventsSearch()">
            <select id="hub-rec-tier-select" class="hub-state-select" style="font-size:0.75rem; padding:0.25rem 0.4rem;" onchange="loadHubRecommendedEvents()">
              <option value="">All Tiers</option>
              <option value="Major">Major</option>
              <option value="Grand Tournament">GT</option>
              <option value="RTT / Local">RTT</option>
            </select>
            <select id="hub-rec-radius-select" class="hub-state-select" style="font-size:0.75rem; padding:0.25rem 0.4rem;" onchange="loadHubRecommendedEvents()">
              <option value="50">50 mi</option>
              <option value="100" selected>100 mi</option>
              <option value="250">250 mi</option>
              <option value="">Any</option>
            </select>
          </div>
        </div>
        <div id="hub-recommended-list" class="hub-events-grid" style="max-height: 320px; overflow-y: auto;">
          <div class="empty-state" style="padding: 1.5rem 0; grid-column: 1 / -1;"><div class="spinner"></div></div>
        </div>
      </div>
    </div>

    <!-- 2-Column Row 1: Half-Sized Army Lists & Elo Trajectory -->
    <div class="hub-grid-2col" style="margin-top: 1.25rem;">

      <!-- Card: Half-Sized Army Lists & Rosters -->
      <div class="hub-card" id="hub-armylists-card" style="display:flex; flex-direction:column; justify-content:space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0;">📋 Army Lists & Rosters</h3>
            </div>
            <button class="bcp-login-btn" onclick="openImportArmyListModal()" style="font-size: 0.75rem; padding: 0.3rem 0.75rem; background: var(--accent); color: #0f172a; font-weight: 800;">
              ➕ Import
            </button>
          </div>

          <div id="hub-armylists-list-container" style="max-height: 240px; overflow-y: auto;">
            <div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.82rem;">
              <div class="spinner"></div>
              <div style="margin-top: 0.5rem;">Loading your army lists...</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Card: Half-Sized Elo Trajectory Progression -->
      <div class="hub-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <h3 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin: 0;">📈 Elo Rating Trajectory</h3>
          <span style="font-size: 0.75rem; color: var(--text-muted);">${history.length} games logged</span>
        </div>
        <div style="overflow-x: auto;">
          <svg id="hub-trajectory-svg" style="width: 100%; height: 220px;"></svg>
        </div>
      </div>

    </div>

    <!-- 2-Column Row 2: Faction Mastery & Matchup Matrix -->
    <div class="hub-grid-2col" style="margin-top: 1.25rem;">
      
      <!-- Card 3: Faction Mastery Breakdown -->
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

      <!-- Card 4: Matchup Matrix vs Enemy Factions -->
      <div class="hub-card">
        <h3 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin-bottom: 0.75rem;">🎯 Matchup Matrix (vs Opponent Armies)</h3>
        ${matchups.length > 0 ? `
          <div class="table-container" style="max-height: 220px; overflow-y: auto;">
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

    <!-- 2-Column Row 3: Career Match History & Live Game Tracker History -->
    <div class="hub-grid-2col" style="margin-top: 1.25rem;">

      <!-- Card 5: Half-Sized Career Match History -->
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

      <!-- Card 6: Half-Sized 11th Edition Live Game Tracker History -->
      <div class="hub-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <h3 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin: 0;">🎲 Match History & Scorecards</h3>
            <span class="badge" style="background: rgba(56,189,248,0.12); color: #38bdf8; font-size: 0.68rem; padding: 0.1rem 0.4rem;">11th Ed</span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <a href="/11th/tracker" target="_blank" style="font-size: 0.75rem; color: var(--accent); text-decoration: none; font-weight: 600;">Tracker ➔</a>
          </div>
        </div>
        ${(data.tracker_history && data.tracker_history.length > 0) ? `
          <div class="table-container" style="max-height: 260px; overflow-y: auto;">
            <table id="hub-tracker-history-table" class="table-compact" style="width: 100%;">
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Players / Armies</th>
                  <th>Score</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${data.tracker_history.map(th => {
                  const p1 = th.p1_name || 'Player 1';
                  const p2 = th.p2_name || 'Player 2';
                  const p1Score = th.p1_score || 0;
                  const p2Score = th.p2_score || 0;
                  const isDone = th.is_finished;
                  const matchId = th.match_id || '';
                  const shortId = matchId.replace('WH40K-', '');
                  const dateStr = th.updated_at ? th.updated_at.substring(5, 10) : (th.created_at ? th.created_at.substring(5, 10) : '-');

                  const statusBadge = isDone 
                    ? `<span class="badge" style="background:rgba(16,185,129,0.15); color:#10b981; font-size:0.7rem; font-weight:700; padding:0.15rem 0.5rem; border-radius:6px;">Completed</span>`
                    : `<span class="badge" style="background:rgba(245,158,11,0.15); color:#f59e0b; font-size:0.7rem; font-weight:700; padding:0.15rem 0.5rem; border-radius:6px;">In Progress</span>`;

                  return `
                    <tr>
                      <td style="white-space: nowrap;">
                        <a href="/11th/tracker/play?match_id=${encodeURIComponent(matchId)}" target="_blank" style="font-family:var(--font-mono); font-size:0.75rem; font-weight:700; color:var(--accent); text-decoration:none;">
                          #${escapeHtml(shortId)} ↗
                        </a>
                        <div style="font-size:0.7rem; color:var(--text-muted);">${dateStr}</div>
                      </td>
                      <td>
                        <b style="color:#fff; font-size:0.8rem;">${escapeHtml(p1)} <span style="color:var(--text-muted); font-weight:normal;">vs</span> ${escapeHtml(p2)}</b>
                        <div style="font-size:0.7rem; color:var(--text-secondary);">${escapeHtml(th.p1_faction || 'Army 1')} vs ${escapeHtml(th.p2_faction || 'Army 2')}</div>
                      </td>
                      <td>
                        <span style="font-weight:700; color:#38bdf8; font-family:var(--font-mono); font-size:0.85rem;">${p1Score} - ${p2Score}</span>
                      </td>
                      <td>${statusBadge}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : `
          <div style="padding: 2.25rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
            <div style="font-size: 1.05rem; margin-bottom: 0.35rem;">🎲 No Live Game Tracker matches logged.</div>
            <div style="font-size: 0.78rem; margin-bottom: 0.75rem;">Track live 11th Edition games with automated VP scoring & real-time sync!</div>
            <a href="/11th/tracker" target="_blank" class="bcp-login-btn" style="text-decoration:none; display:inline-block; font-size:0.8rem; padding:0.4rem 0.9rem;">+ Open Game Tracker</a>
          </div>
        `}
      </div>

    </div>
  `;

  container.innerHTML = html;

  // Render SVG Trajectory & Load Army Lists
  renderHubTrajectory(history);
  loadHubArmyLists();
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
  const viewReg = document.getElementById('hub-tourney-view-registered');
  const viewRec = document.getElementById('hub-tourney-view-recommended');
  const countBadge = document.getElementById('hub-tourney-tab-count');

  if (!btnReg || !btnRec || !viewReg || !viewRec) return;

  btnReg.classList.remove('active');
  btnRec.classList.remove('active');
  viewReg.style.display = 'none';
  viewRec.style.display = 'none';

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
  }
}

let customUserLocation = null;

const GLOBAL_CITY_COORDS = {
  'san diego': { name: 'San Diego, CA', lat: 32.7157, lng: -117.1611 },
  'los angeles': { name: 'Los Angeles, CA', lat: 34.0522, lng: -118.2437 },
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

function openLocationPickerModal() {
  const modal = document.getElementById('hub-location-picker-modal');
  if (modal) modal.classList.add('active');
}

function closeLocationPickerModal() {
  const modal = document.getElementById('hub-location-picker-modal');
  if (modal) modal.classList.remove('active');
}

function setPresetLocation(cityKey) {
  if (cityKey === 'gps') {
    customUserLocation = null;
    userDeviceGeo = null;
    closeLocationPickerModal();
    loadHubRecommendedEvents();
    return;
  }
  const loc = GLOBAL_CITY_COORDS[cityKey.toLowerCase()];
  if (loc) {
    customUserLocation = { name: loc.name, lat: loc.lat, lng: loc.lng };
    closeLocationPickerModal();
    loadHubRecommendedEvents();
  }
}

async function searchCustomLocationInput() {
  const input = document.getElementById('custom-location-search-input');
  if (!input) return;
  const q = input.value.trim();
  if (!q) return;

  const qLower = q.toLowerCase();
  for (const [key, val] of Object.entries(GLOBAL_CITY_COORDS)) {
    if (key.includes(qLower) || val.name.toLowerCase().includes(qLower)) {
      customUserLocation = { name: val.name, lat: val.lat, lng: val.lng };
      closeLocationPickerModal();
      loadHubRecommendedEvents();
      return;
    }
  }

  // Fallback client-side geocoding via OpenStreetMap Nominatim
  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`);
    const data = await resp.json();
    if (data && data.length > 0) {
      const item = data[0];
      const displayName = item.display_name.split(',').slice(0, 2).join(',');
      customUserLocation = {
        name: displayName,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon)
      };
      closeLocationPickerModal();
      loadHubRecommendedEvents();
      return;
    }
  } catch (err) {
    console.warn('Geocoding notice:', err);
  }

  alert(`Could not find coordinates for "${q}". Please try a nearby major city.`);
}

window.openLocationPickerModal = openLocationPickerModal;
window.closeLocationPickerModal = closeLocationPickerModal;
window.setPresetLocation = setPresetLocation;
window.searchCustomLocationInput = searchCustomLocationInput;

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
        { timeout: 2000, maximumAge: 600000 }
      );
    } else {
      resolve(null);
    }
  });
}

function requestUserDeviceLocationPrompt() {
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userDeviceGeo = {
          lat: Number(pos.coords.latitude.toFixed(4)),
          lng: Number(pos.coords.longitude.toFixed(4))
        };
        loadHubRecommendedEvents();
      },
      (err) => {
        alert('Location access was not granted. You can select your state or region from the Region dropdown above.');
      },
      { enableHighAccuracy: true, timeout: 6000 }
    );
  } else {
    alert('Geolocation is not supported by your browser. Please choose a region from the dropdown.');
  }
}
window.requestUserDeviceLocationPrompt = requestUserDeviceLocationPrompt;

async function loadHubRecommendedEvents() {
  const container = document.getElementById('hub-recommended-list');
  const tierSelect = document.getElementById('hub-rec-tier-select');
  const radiusSelect = document.getElementById('hub-rec-radius-select');
  const label = document.getElementById('hub-rec-location-label');
  if (!container) return;

  container.innerHTML = '<div class="empty-state" style="padding: 1.5rem 0;"><div class="spinner"></div></div>';

  const searchInput = document.getElementById('hub-rec-search-input');
  const query = searchInput ? searchInput.value.trim() : '';
  const playerId = (currentUser && currentUser.player_id) ? currentUser.player_id : '';
  const selectedTier = tierSelect ? tierSelect.value : '';
  const selectedRadius = radiusSelect && radiusSelect.value ? Number(radiusSelect.value) : 100;

  // Determine coordinates: Custom chosen location > Live device GPS > Competitor Home fallback
  let userLat = null;
  let userLng = null;
  let locName = null;
  let geo = null;

  if (customUserLocation) {
    userLat = customUserLocation.lat;
    userLng = customUserLocation.lng;
    locName = customUserLocation.name;
  } else {
    geo = await getDeviceCoordinates();
    if (geo) {
      userLat = geo.lat;
      userLng = geo.lng;
      locName = 'Live GPS Location';
    }
  }

  try {
    const data = await window.api.getRecommendedEvents(playerId, query, selectedTier, userLat, userLng, selectedRadius, 40);
    const events = data.events || [];
    
    if (label) {
      const activeName = locName || [data.detected_city, data.detected_state].filter(Boolean).join(', ') || 'San Diego, CA';
      label.innerHTML = `📍 <b>${escapeHtml(activeName)}</b> <button class="hub-location-btn" onclick="openLocationPickerModal()">✏️ Change Location</button>`;
    }

    // If no GPS, no detected history, show prompt to enable location sharing
    if (!geo && !data.detected_state && !data.detected_city && !query) {
      container.innerHTML = `
        <div style="padding: 2.5rem 1.5rem; text-align: center; color: var(--text-secondary); max-width: 480px; margin: 0 auto; grid-column: 1 / -1;">
          <div style="font-size: 2.2rem; margin-bottom: 0.6rem;">📍</div>
          <h4 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin-bottom: 0.4rem;">Enable Location Sharing to Discover Tournaments</h4>
          <p style="font-size: 0.82rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 1.15rem;">
            Allow device location access to automatically find tournaments within 50 miles of your current location.
          </p>
          <button class="bcp-login-btn" style="font-size: 0.85rem; padding: 0.5rem 1.25rem; font-weight: 700;" onclick="requestUserDeviceLocationPrompt()">
            📍 Enable Location Sharing
          </button>
        </div>
      `;
      return;
    }

    if (events.length === 0) {
      container.innerHTML = `
        <div style="padding: 2rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.84rem; grid-column: 1 / -1;">
          <div style="font-size: 1.2rem; margin-bottom: 0.35rem;">🔍 No upcoming tournaments found for this area.</div>
          <div style="margin-top: 0.35rem; font-size: 0.78rem;">Try expanding your radius (e.g. 100 or 250 miles) or selecting "All States / Global"!</div>
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
    loadHubRecommendedEvents();
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
    const data = await window.api.getRecommendedEvents('', query, '', null, null, null, 30, state);
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
  const capacity = ev.capacity_cap !== undefined ? ev.capacity_cap : (ev.max_capacity !== undefined ? ev.max_capacity : enrolled);
  const hasTicketCap = ev.has_ticket_cap !== undefined ? ev.has_ticket_cap : (capacity > enrolled);
  const spotsOpen = capacity > enrolled ? (capacity - enrolled) : 0;
  
  let capacityText = `👥 <b>${enrolled}</b> Enrolled`;
  if (capacity > 0 && capacity > enrolled && hasTicketCap) {
    capacityText = `👥 <b>${enrolled} / ${capacity}</b> Spots <span style="color:#10b981; font-size:0.75rem;">(${spotsOpen} open)</span>`;
  } else if (capacity > 0 && capacity <= enrolled && hasTicketCap) {
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
            <span style="color:var(--accent);">📅</span> <b>${evDate}</b>${(timeLabel && timeLabel !== 'Upcoming') ? ` <span style="color:var(--text-muted);">(${timeLabel})</span>` : ''}
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

/* ==========================================================================
   ARMY LISTS & ROSTER STUDIO CONTROLLERS
   ========================================================================== */

let hubSavedLists = [];

async function loadHubArmyLists() {
  const container = document.getElementById('hub-armylists-list-container');
  if (!container) return;

  try {
    const res = await window.api.getArmyLists();
    const lists = res.army_lists || [];
    hubSavedLists = lists;
    renderHubArmyLists(lists);
  } catch(e) {
    container.innerHTML = `<div style="color:var(--loss); font-size:0.85rem; padding:1.5rem; text-align:center;">Error loading army lists: ${e.message}</div>`;
  }
}

function renderHubArmyLists(lists) {
  const container = document.getElementById('hub-armylists-list-container');
  if (!container) return;

  if (!lists || lists.length === 0) {
    container.innerHTML = `
      <div style="padding: 2.5rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        <div style="font-size: 1.8rem; margin-bottom: 0.5rem;">📋</div>
        <div style="font-size: 1.05rem; font-weight: 700; color: #fff; margin-bottom: 0.35rem;">No Army Lists Imported Yet</div>
        <div style="font-size: 0.8rem; max-width: 440px; margin: 0 auto 1.25rem; color: #94a3b8;">
          Import your rosters from <b>NewRecruit</b> using a share link to view your units and launch into Game Tracker!
        </div>
        <button class="bcp-login-btn" onclick="openImportArmyListModal()" style="font-size: 0.85rem; padding: 0.45rem 1rem; background: var(--accent); color: #0f172a; font-weight: 800;">
          ➕ Import from NewRecruit
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 0.75rem;">
      ${lists.map(l => {
        const pts = l.points || 2000;

        return `
          <div class="hub-rec-card" style="flex-direction: column; align-items: stretch; gap: 0.65rem; padding: 0.85rem 1rem; background: rgba(19, 29, 51, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
              <div style="min-width: 0; flex: 1;">
                <div style="font-size: 0.98rem; font-weight: 800; color: #fff; font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(l.name || 'NewRecruit Roster')}</div>
                <div style="font-size: 0.78rem; color: #38bdf8; font-weight: 700; margin-top: 0.15rem;">
                  ${escapeHtml(l.faction || 'Warhammer 40k')} • <span style="color: #c084fc;">${escapeHtml(l.detachment || 'Core Detachment')}</span>
                </div>
              </div>
              <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-weight: 800; font-family: var(--font-mono); font-size: 0.72rem; border: 1px solid rgba(245, 158, 11, 0.3); flex-shrink: 0;">
                ${pts} PTS
              </span>
            </div>

            <!-- Action Buttons Row -->
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 0.55rem; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                <button onclick="openViewArmyListModal('${l.id}')" class="subtab-btn" style="font-size: 0.74rem; padding: 0.25rem 0.65rem; background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3); font-weight: 700;">
                  👁️ View
                </button>
                <button onclick="launchTrackerWithList('${l.id}')" class="subtab-btn" style="font-size: 0.74rem; padding: 0.25rem 0.65rem; background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); font-weight: 700;">
                  ⚔️ Play
                </button>
                ${l.source_url ? `
                  <a href="${escapeHtml(l.source_url)}" target="_blank" class="subtab-btn" style="font-size: 0.74rem; padding: 0.25rem 0.65rem; background: rgba(168,85,247,0.15); color: #c084fc; border: 1px solid rgba(168,85,247,0.3); text-decoration: none; display: inline-flex; align-items: center; gap: 3px; font-weight: 700;" title="Edit roster on NewRecruit">
                    ✏️ Edit ↗
                  </a>
                ` : ''}
              </div>
              <button onclick="deleteHubArmyList('${l.id}')" style="background: transparent; border: none; color: #ef4444; font-size: 0.85rem; cursor: pointer; padding: 0.2rem 0.3rem;" title="Delete List">
                🗑️
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function openImportArmyListModal() {
  let modal = document.getElementById('hub-import-armylist-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'hub-import-armylist-modal';
    modal.style.cssText = 'position:fixed; inset:0; z-index:100000; display:flex; align-items:center; justify-content:center; background:rgba(3,7,18,0.85); backdrop-filter:blur(8px); padding:16px;';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div style="background:#0b1120; border:1px solid rgba(56,189,248,0.3); border-radius:14px; width:100%; max-width:480px; box-shadow:0 25px 60px rgba(0,0,0,0.85); display:flex; flex-direction:column; overflow:hidden; font-family:'Inter',system-ui,sans-serif; color:#f8fafc;">
      <div style="padding:14px 18px; background:#0f172a; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:16px;">📋</span>
          <h3 style="font-size:15px; font-weight:800; color:#fff; margin:0;">Import from NewRecruit</h3>
        </div>
        <button onclick="closeImportArmyListModal()" style="background:transparent; border:none; color:#94a3b8; font-size:20px; cursor:pointer;">✕</button>
      </div>
      
      <div style="padding:18px;">
        <label style="display:block; font-size:12px; font-weight:700; color:#94a3b8; margin-bottom:8px;">
          NewRecruit Share Link
        </label>
        <input id="hub-import-paste-area" type="text" placeholder="https://www.newrecruit.eu/app/list/..." style="width:100%; background:#070b14; border:1px solid #334155; border-radius:8px; padding:10px 12px; font-family:'Inter',sans-serif; font-size:13px; color:#e2e8f0; outline:none; box-sizing:border-box;" />

        <div style="margin-top:16px; display:flex; justify-content:flex-end; gap:8px;">
          <button onclick="closeImportArmyListModal()" style="background:#1e293b; color:#cbd5e1; font-weight:700; font-size:12px; border:none; padding:8px 14px; border-radius:6px; cursor:pointer;">
            Cancel
          </button>
          <button id="hub-btn-do-import" onclick="handleHubParseAndSaveList()" style="background:#0284c7; color:#fff; font-weight:800; font-size:12px; border:none; padding:8px 18px; border-radius:6px; cursor:pointer;">
            ⚡ Import List
          </button>
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
}

function closeImportArmyListModal() {
  const modal = document.getElementById('hub-import-armylist-modal');
  if (modal) modal.style.display = 'none';
}

async function handleHubParseAndSaveList() {
  const input = document.getElementById('hub-import-paste-area');
  const btn = document.getElementById('hub-btn-do-import');
  if (!input || !input.value.trim()) {
    alert('Please paste your NewRecruit share link.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Importing...';

  try {
    const raw = input.value.trim();
    const parseRes = await window.api.parseArmyList(raw);
    if (parseRes.error || !parseRes.army_list) throw new Error(parseRes.error || 'Failed to parse list link');

    const armyList = parseRes.army_list;
    const saveRes = await window.api.saveArmyList(armyList);
    if (saveRes.error) throw new Error(saveRes.error);

    closeImportArmyListModal();
    alert(`🎉 Successfully saved "${armyList.name}" (${armyList.points} pts)!`);
    await loadHubArmyLists();
  } catch(e) {
    alert('Error importing list: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Import List';
  }
}

function getDirectNewRecruitUrl(url) {
  if (!url) return '';
  const match = url.match(/newrecruit\.eu\/app\/list\/([a-zA-Z0-9_\-]+)/i);
  if (match) {
    const shareId = match[1];
    return `https://www.newrecruit.eu/app/list/${shareId}`;
  }
  return url;
}

async function openViewArmyListModal(listId) {
  let list = hubSavedLists.find(l => l.id === listId);
  if (!list) {
    try {
      const res = await window.api.getArmyList(listId);
      list = res.army_list;
    } catch(e) {}
  }
  if (!list) {
    alert('List not found');
    return;
  }

  let modal = document.getElementById('hub-view-armylist-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'hub-view-armylist-modal';
    modal.style.cssText = 'position:fixed; inset:0; z-index:100000; display:flex; align-items:center; justify-content:center; background:rgba(3,7,18,0.88); backdrop-filter:blur(8px); padding:16px;';
    document.body.appendChild(modal);
  }

  const units = list.units || [];
  const rawSourceUrl = list.source_url || (list.raw_text && list.raw_text.startsWith('http') ? list.raw_text.trim() : null);
  const sourceUrl = getDirectNewRecruitUrl(rawSourceUrl);

  modal.innerHTML = `
    <div style="background:#0b1120; border:1px solid rgba(56,189,248,0.3); border-radius:16px; width:100%; max-width:1100px; height:88vh; display:flex; flex-direction:column; overflow:hidden; font-family:'Inter',system-ui,sans-serif; color:#f8fafc; box-shadow:0 30px 80px rgba(0,0,0,0.9);">
      <!-- Header -->
      <div style="padding:14px 20px; background:#0f172a; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <div style="font-size:18px; font-weight:900; color:#fff; font-family:var(--font-mono);">${escapeHtml(list.name || 'Army Roster')}</div>
          <div style="font-size:12px; color:#38bdf8; font-weight:700; margin-top:2px;">
            ${escapeHtml(list.faction || '40k')} • <span style="color:#a855f7;">${escapeHtml(list.detachment || 'Core Detachment')}</span> • <span style="color:#f59e0b;">${list.points || 2000} PTS</span>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          ${sourceUrl ? `
            <a href="${escapeHtml(sourceUrl)}" target="_blank" style="background:#1e293b; color:#c084fc; border:1px solid rgba(192,132,252,0.4); text-decoration:none; font-weight:800; font-size:12px; padding:6px 14px; border-radius:6px; display:inline-flex; align-items:center; gap:4px;">
              ✏️ Edit on NewRecruit ↗
            </a>
          ` : ''}
          <button onclick="launchTrackerWithList('${list.id}')" style="background:#10b981; color:#0f172a; font-weight:800; font-size:12px; border:none; padding:6px 14px; border-radius:6px; cursor:pointer;">
            ⚔️ Play in Tracker
          </button>
          <button onclick="deleteHubArmyList('${list.id}', true)" style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3); font-weight:800; font-size:12px; padding:6px 12px; border-radius:6px; cursor:pointer;">
            🗑️ Delete
          </button>
          <button onclick="closeViewArmyListModal()" style="background:transparent; border:none; color:#94a3b8; font-size:22px; cursor:pointer; padding:4px 8px;">✕</button>
        </div>
      </div>

      <!-- Body -->
      ${sourceUrl ? `
        <div style="flex:1; width:100%; height:100%; position:relative; background:#070b14;">
          <iframe src="${escapeHtml(sourceUrl)}" style="width:100%; height:100%; border:none; background:#070b14;" allow="fullscreen"></iframe>
        </div>
      ` : (list.raw_text ? `
        <div style="padding:20px; overflow-y:auto; flex:1; background:#070b14; font-family:var(--font-mono); font-size:12px; color:#cbd5e1; white-space:pre-wrap; line-height:1.5;">${escapeHtml(list.raw_text)}</div>
      ` : `
        <div style="padding:40px; text-align:center; color:#94a3b8;">No roster content available.</div>
      `)}
    </div>
  `;
  modal.style.display = 'flex';
}

function closeViewArmyListModal() {
  const modal = document.getElementById('hub-view-armylist-modal');
  if (modal) modal.style.display = 'none';
}

function exportArmyListToBcp(listId) {
  const list = hubSavedLists.find(l => l.id === listId);
  if (!list) return;

  const units = list.units || [];
  let out = `${list.faction || 'Warhammer 40,000'} - ${list.detachment || 'Detachment'} (${list.points || 2000} pts)\n\n`;

  // Group by role
  const groups = {};
  for (const u of units) {
    const role = (u.role || 'OTHER DATASHEETS').toUpperCase();
    if (!groups[role]) groups[role] = [];
    groups[role].push(u);
  }

  for (const [role, uList] of Object.entries(groups)) {
    out += `${role}\n`;
    for (const u of uList) {
      out += `${u.name} (${u.points || 0} pts)\n`;
      if (u.is_warlord) out += `  • Warlord\n`;
      if (u.enhancement) out += `  • Enhancement: ${u.enhancement}\n`;
      if (u.weapons && u.weapons.length > 0) {
        out += `  • Wargear: ${u.weapons.map(w => w.name).join(', ')}\n`;
      }
    }
    out += '\n';
  }

  navigator.clipboard.writeText(out).then(() => {
    alert('📋 BCP Tournament Roster copied to clipboard!');
  }).catch(() => {
    prompt('Copy your BCP list text below:', out);
  });
}

async function deleteHubArmyList(listId, fromModal = false) {
  if (!confirm('Are you sure you want to permanently delete this army list?')) return;
  
  if (fromModal) {
    closeViewArmyListModal();
  }

  // 1. Instant 0ms Optimistic UI Removal
  const prevLists = [...(hubSavedLists || [])];
  hubSavedLists = (hubSavedLists || []).filter(l => l.id !== listId);
  renderHubArmyLists(hubSavedLists);

  // 2. Perform async deletion in background
  try {
    const res = await window.api.deleteArmyList(listId);
    if (res && res.error) {
      console.warn('Delete army list warning:', res.error);
      // Revert if server returned an error
      hubSavedLists = prevLists;
      renderHubArmyLists(hubSavedLists);
      alert('Error deleting list: ' + res.error);
    }
  } catch(e) {
    console.error('Delete error:', e);
    hubSavedLists = prevLists;
    renderHubArmyLists(hubSavedLists);
    alert('Error deleting list: ' + e.message);
  }
}

function launchTrackerWithList(listId) {
  const list = hubSavedLists.find(l => l.id === listId);
  // Launch tracker with preloaded state
  window.open('/11th/tracker', '_blank');
}

window.loadHubArmyLists = loadHubArmyLists;
window.openImportArmyListModal = openImportArmyListModal;
window.closeImportArmyListModal = closeImportArmyListModal;
window.handleHubParseAndSaveList = handleHubParseAndSaveList;
window.openViewArmyListModal = openViewArmyListModal;
window.closeViewArmyListModal = closeViewArmyListModal;
window.exportArmyListToBcp = exportArmyListToBcp;
window.deleteHubArmyList = deleteHubArmyList;
window.launchTrackerWithList = launchTrackerWithList;
