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

    <!-- 2-Column Row 1: Tournament Hub & Elo Trajectory -->
    <div class="hub-grid-2col" style="margin-top: 1.25rem;">

      <!-- Card 1: Half-Sized Tournament Hub & Events -->
      <div class="hub-card" id="hub-tournament-discovery-card" style="display:flex; flex-direction:column; justify-content:space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0;">⚔️ Tournament Hub & Events</h3>
              <span class="badge-live"><span class="live-indicator-dot"></span>Live Schedule</span>
            </div>
            <span id="hub-tourney-tab-count" style="font-size: 0.8rem; color: var(--accent); font-weight: 700;">${upcoming.length} registered</span>
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
                        <b style="font-size: 0.88rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(ev.event_name)}</b>
                        <span class="tier-badge tier-A" style="font-size: 0.65rem; padding: 0.1rem 0.4rem;">Registered</span>
                      </div>
                      <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                        <span>📅 ${ev.event_date ? ev.event_date.substring(0, 10) : 'TBD'}</span>
                        <span>•</span>
                        <span>📍 ${escapeHtml(ev.city || '')} ${escapeHtml(ev.state || '')}</span>
                      </div>
                    </div>
                    <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 0.25rem;">
                      <span class="badge" style="font-size: 0.7rem; background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">
                        👥 ${ev.total_players || 0} Players
                      </span>
                      <span style="font-size: 0.7rem; color: var(--accent); font-weight: 600;">${escapeHtml(ev.registered_faction || 'Confirmed')}</span>
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
            <div id="hub-recommended-list" class="hub-events-grid" style="max-height: 240px; overflow-y: auto;">
              <div class="empty-state" style="padding: 1.5rem 0; grid-column: 1 / -1;"><div class="spinner"></div></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Card 2: Elo Trajectory Progression -->
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
            <button onclick="openImportScorecardModalHub()" class="subtab-btn" style="font-size: 0.75rem; padding: 0.25rem 0.6rem; background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3);" title="Import from Tabletop Battles, 40k App, or manual entry">
              📥 Import Scorecard
            </button>
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

    <!-- Row 3: Army Lists & Roster Studio -->
    <div class="hub-card" id="hub-armylists-card" style="margin-top: 1.25rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.6rem;">
        <div style="display: flex; align-items: center; gap: 0.6rem;">
          <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0;">📋 Army Lists & Roster Studio</h3>
          <span class="badge" style="background: rgba(56,189,248,0.12); color: #38bdf8; font-size: 0.72rem; padding: 0.15rem 0.5rem; font-weight: 700;">Wahapedia Enriched</span>
        </div>
        <button class="bcp-login-btn" onclick="openImportArmyListModal()" style="font-size: 0.8rem; padding: 0.35rem 0.85rem; background: var(--accent); color: #0f172a; font-weight: 800;">
          ➕ Import / Create List
        </button>
      </div>

      <div id="hub-armylists-list-container">
        <div style="text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.85rem;">
          <div class="spinner"></div>
          <div style="margin-top: 0.5rem;">Loading your army lists...</div>
        </div>
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
        <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">📋</div>
        <div style="font-size: 1.05rem; font-weight: 700; color: #fff; margin-bottom: 0.35rem;">No Army Lists Imported Yet</div>
        <div style="font-size: 0.8rem; max-width: 480px; margin: 0 auto 1.25rem;">
          Import your rosters from <b>NewRecruit</b>, <b>Warhammer 40,000 App</b>, <b>Battlescribe</b>, or <b>BCP</b> to auto-enrich them with live Wahapedia datasheets, statlines, and stratagems.
        </div>
        <button class="bcp-login-btn" onclick="openImportArmyListModal()" style="font-size: 0.85rem; padding: 0.45rem 1rem; background: var(--accent); color: #0f172a; font-weight: 800;">
          ➕ Import Your First Army List
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem;">
      ${lists.map(l => {
        const units = l.units || [];
        const warlord = l.warlord || (units.find(u => u.is_warlord) || {}).name || 'None';
        const pts = l.points || 2000;
        const ptsLimit = l.points_limit || 2000;
        const ptsPercent = Math.min(100, Math.round((pts / ptsLimit) * 100));

        return `
          <div class="hub-rec-card" style="flex-direction: column; align-items: stretch; gap: 0.85rem; padding: 1.15rem; background: rgba(19, 29, 51, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
              <div>
                <div style="font-size: 1.05rem; font-weight: 800; color: #fff; font-family: var(--font-mono);">${escapeHtml(l.name || 'Unnamed List')}</div>
                <div style="font-size: 0.82rem; color: #38bdf8; font-weight: 700; margin-top: 0.2rem;">
                  ${escapeHtml(l.faction || 'Warhammer 40k')} • <span style="color: #c084fc;">${escapeHtml(l.detachment || 'Core Detachment')}</span>
                </div>
              </div>
              <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-weight: 800; font-family: var(--font-mono); font-size: 0.75rem; border: 1px solid rgba(245, 158, 11, 0.3);">
                ${pts} / ${ptsLimit} PTS
              </span>
            </div>

            <!-- List Meta Summary -->
            <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.78rem; color: var(--text-secondary); background: rgba(0,0,0,0.3); padding: 0.5rem 0.75rem; border-radius: 6px;">
              <span>⚔️ <b>${units.length}</b> Units</span>
              <span>👑 Warlord: <b style="color:#facc15;">${escapeHtml(warlord)}</b></span>
              <span>🏷️ ${escapeHtml(l.source_format || 'Custom')}</span>
            </div>

            <!-- Action Buttons Row -->
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 0.75rem; flex-wrap: wrap;">
              <button onclick="openViewArmyListModal('${l.id}')" class="subtab-btn" style="font-size: 0.75rem; padding: 0.3rem 0.65rem; background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3);">
                👁️ View Roster
              </button>
              <button onclick="launchTrackerWithList('${l.id}')" class="subtab-btn" style="font-size: 0.75rem; padding: 0.3rem 0.65rem; background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3);">
                ⚔️ Play in Tracker
              </button>
              <button onclick="exportArmyListToBcp('${l.id}')" class="subtab-btn" style="font-size: 0.75rem; padding: 0.3rem 0.65rem; background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3);" title="Export clean list text for BCP">
                📤 Export BCP
              </button>
              <button onclick="deleteHubArmyList('${l.id}')" style="background: transparent; border: none; color: #ef4444; font-size: 0.85rem; cursor: pointer; padding: 0.2rem 0.4rem;" title="Delete List">
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
    <div style="background:#0b1120; border:1px solid rgba(56,189,248,0.3); border-radius:16px; width:100%; max-width:680px; box-shadow:0 25px 60px rgba(0,0,0,0.85); display:flex; flex-direction:column; overflow:hidden; font-family:'Inter',system-ui,sans-serif; color:#f8fafc;">
      <div style="padding:16px 20px; background:#0f172a; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:18px;">📋</span>
          <h3 style="font-size:16px; font-weight:800; color:#fff; margin:0;">Import Army List</h3>
        </div>
        <button onclick="closeImportArmyListModal()" style="background:transparent; border:none; color:#94a3b8; font-size:22px; cursor:pointer;">✕</button>
      </div>
      
      <div style="padding:20px; overflow-y:auto; max-height:75vh;">
        <p style="font-size:12px; color:#94a3b8; margin:0 0 14px;">
          Paste list export text from <b>Warhammer 40k App</b>, <b>NewRecruit (Text or JSON)</b>, <b>Battlescribe</b>, or <b>BCP</b>. Our parser will auto-detect the format and enrich it with full Wahapedia statlines, weapon profiles, and abilities.
        </p>

        <textarea id="hub-import-paste-area" placeholder="Paste export text here..." style="width:100%; height:200px; background:#070b14; border:1px solid #334155; border-radius:8px; padding:12px; font-family:'JetBrains Mono',monospace; font-size:11px; color:#e2e8f0; outline:none; resize:vertical;"></textarea>

        <div id="hub-parse-preview" style="display:none; margin-top:14px; background:#131d33; border:1px solid rgba(56,189,248,0.25); border-radius:8px; padding:12px;">
          <div style="font-weight:800; font-size:13px; color:#38bdf8;" id="hub-preview-title">Preview</div>
          <div style="font-size:11px; color:#94a3b8; margin-top:4px;" id="hub-preview-meta"></div>
        </div>

        <div style="margin-top:18px; display:flex; justify-content:flex-end; gap:10px;">
          <button onclick="closeImportArmyListModal()" style="background:#1e293b; color:#cbd5e1; font-weight:700; font-size:12px; border:none; padding:10px 16px; border-radius:8px; cursor:pointer;">
            Cancel
          </button>
          <button id="hub-btn-do-import" onclick="handleHubParseAndSaveList()" style="background:#0284c7; color:#fff; font-weight:800; font-size:12px; border:none; padding:10px 20px; border-radius:8px; cursor:pointer;">
            ⚡ Parse & Save to My Hub
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
  const textarea = document.getElementById('hub-import-paste-area');
  const btn = document.getElementById('hub-btn-do-import');
  if (!textarea || !textarea.value.trim()) {
    alert('Please paste your army list export text.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Parsing & Enriching...';

  try {
    const raw = textarea.value.trim();
    const parseRes = await window.api.parseArmyList(raw);
    if (parseRes.error || !parseRes.army_list) throw new Error(parseRes.error || 'Failed to parse');

    const armyList = parseRes.army_list;
    const saveRes = await window.api.saveArmyList(armyList);
    if (saveRes.error) throw new Error(saveRes.error);

    closeImportArmyListModal();
    alert(`🎉 Successfully saved "${armyList.name}" (${armyList.points} pts, ${armyList.units.length} units)!`);
    await loadHubArmyLists();
  } catch(e) {
    alert('Error importing list: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Parse & Save to My Hub';
  }
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
    modal.style.cssText = 'position:fixed; inset:0; z-index:100000; display:flex; align-items:center; justify-content:center; background:rgba(3,7,18,0.85); backdrop-filter:blur(8px); padding:16px;';
    document.body.appendChild(modal);
  }

  const units = list.units || [];
  const stratagems = list.stratagems || [];

  modal.innerHTML = `
    <div style="background:#0b1120; border:1px solid rgba(56,189,248,0.3); border-radius:16px; width:100%; max-width:920px; max-height:90vh; display:flex; flex-direction:column; overflow:hidden; font-family:'Inter',system-ui,sans-serif; color:#f8fafc;">
      <!-- Header -->
      <div style="padding:16px 20px; background:#0f172a; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <div style="font-size:18px; font-weight:900; color:#fff; font-family:var(--font-mono);">${escapeHtml(list.name || 'Army Roster')}</div>
          <div style="font-size:12px; color:#38bdf8; font-weight:700; margin-top:2px;">
            ${escapeHtml(list.faction || '40k')} • <span style="color:#c084fc;">${escapeHtml(list.detachment || 'Core Detachment')}</span>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button onclick="exportArmyListToBcp('${list.id}')" style="background:#f59e0b; color:#0f172a; font-weight:800; font-size:11px; border:none; padding:6px 12px; border-radius:6px; cursor:pointer;">
            📤 Export BCP
          </button>
          <button onclick="launchTrackerWithList('${list.id}')" style="background:#10b981; color:#0f172a; font-weight:800; font-size:11px; border:none; padding:6px 12px; border-radius:6px; cursor:pointer;">
            ⚔️ Play in Tracker
          </button>
          <button onclick="closeViewArmyListModal()" style="background:transparent; border:none; color:#94a3b8; font-size:22px; cursor:pointer; padding:4px 8px;">✕</button>
        </div>
      </div>

      <!-- Body -->
      <div style="padding:20px; overflow-y:auto; flex:1;">
        <!-- Meta Summary Bar -->
        <div style="background:#090e1a; border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:10px 14px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; font-size:12px;">
          <span>Points: <b style="color:#f59e0b; font-family:var(--font-mono); font-size:13px;">${list.points || 2000} / ${list.points_limit || 2000} PTS</b></span>
          <span>Warlord: <b style="color:#facc15;">${escapeHtml(list.warlord || 'None')}</b></span>
          <span>Units: <b style="color:#fff;">${units.length}</b></span>
        </div>

        <!-- Unit Cards -->
        <div style="display:flex; flex-direction:column; gap:12px;">
          ${units.map(u => {
            const stats = u.stats || { M: '6"', T: 4, SV: '3+', INV: '-', W: 2, LD: '6+', OC: 1 };
            const weps = u.weapons || [];
            const abilities = u.abilities || [];
            const keywords = u.keywords || [];

            return `
              <div style="background:#131d33; border:1px solid rgba(255,255,255,0.07); border-radius:10px; padding:12px 16px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; flex-wrap:wrap; gap:6px;">
                  <div>
                    <span style="font-size:15px; font-weight:800; color:#f8fafc; font-family:var(--font-mono);">${escapeHtml(u.name)}</span>
                    <span style="background:#1e293b; color:#94a3b8; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; margin-left:6px; text-transform:uppercase;">${escapeHtml(u.role || 'Infantry')}</span>
                    ${u.is_warlord ? `<span style="background:rgba(234,179,8,0.2); color:#facc15; font-size:10px; font-weight:800; padding:2px 6px; border-radius:4px; margin-left:4px;">👑 WARLORD</span>` : ''}
                    ${u.enhancement ? `<span style="background:rgba(168,85,247,0.2); color:#c084fc; font-size:10px; font-weight:800; padding:2px 6px; border-radius:4px; margin-left:4px;">✨ ${escapeHtml(u.enhancement)}</span>` : ''}
                  </div>
                  <div style="font-family:var(--font-mono); font-size:13px; font-weight:800; color:#f59e0b;">
                    ${u.points || 0} PTS
                  </div>
                </div>

                <!-- Statline Grid -->
                <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:4px; background:#090e1a; padding:6px; border-radius:8px; text-align:center; margin:8px 0; border:1px solid rgba(255,255,255,0.05); font-family:var(--font-mono);">
                  <div><div style="font-size:9px; color:#64748b; font-weight:800;">M</div><div style="color:#38bdf8; font-size:13px; font-weight:800;">${stats.M || '6"'}</div></div>
                  <div><div style="font-size:9px; color:#64748b; font-weight:800;">T</div><div style="color:#38bdf8; font-size:13px; font-weight:800;">${stats.T || 4}</div></div>
                  <div><div style="font-size:9px; color:#64748b; font-weight:800;">SV</div><div style="color:#38bdf8; font-size:13px; font-weight:800;">${stats.SV || '3+'}</div></div>
                  <div><div style="font-size:9px; color:#64748b; font-weight:800;">INV</div><div style="color:#a855f7; font-size:13px; font-weight:800;">${stats.INV || '-'}</div></div>
                  <div><div style="font-size:9px; color:#64748b; font-weight:800;">W</div><div style="color:#38bdf8; font-size:13px; font-weight:800;">${stats.W || 1}</div></div>
                  <div><div style="font-size:9px; color:#64748b; font-weight:800;">LD</div><div style="color:#38bdf8; font-size:13px; font-weight:800;">${stats.LD || '6+'}</div></div>
                  <div><div style="font-size:9px; color:#64748b; font-weight:800;">OC</div><div style="color:#38bdf8; font-size:13px; font-weight:800;">${stats.OC || 1}</div></div>
                </div>

                <!-- Weapons -->
                ${weps.length > 0 ? `
                  <table style="width:100%; font-size:11px; border-collapse:collapse; margin-top:6px; background:#0b1120; border-radius:6px; overflow:hidden;">
                    <thead>
                      <tr style="background:#1e293b; color:#94a3b8; text-align:left; font-size:10px; font-family:var(--font-mono);">
                        <th style="padding:4px 8px;">WEAPON</th>
                        <th style="padding:4px 8px;">RANGE</th>
                        <th style="padding:4px 8px;">A</th>
                        <th style="padding:4px 8px;">BS/WS</th>
                        <th style="padding:4px 8px;">S</th>
                        <th style="padding:4px 8px;">AP</th>
                        <th style="padding:4px 8px;">D</th>
                        <th style="padding:4px 8px;">ABILITIES</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${weps.map(w => `
                        <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
                          <td style="padding:4px 8px; font-weight:700; color:#f8fafc;">${escapeHtml(w.name)}</td>
                          <td style="padding:4px 8px;">${w.range || 'Melee'}</td>
                          <td style="padding:4px 8px;">${w.attacks || w.A || '1'}</td>
                          <td style="padding:4px 8px;">${w.bs_ws || w.BS_WS || '3+'}</td>
                          <td style="padding:4px 8px;">${w.strength || w.S || '4'}</td>
                          <td style="padding:4px 8px;">${w.ap || w.AP || '0'}</td>
                          <td style="padding:4px 8px;">${w.damage || w.D || '1'}</td>
                          <td style="padding:4px 8px; color:#38bdf8; font-size:10px;">${escapeHtml(w.abilities || '-')}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                ` : ''}

                <!-- Abilities & Keywords -->
                ${abilities.length > 0 ? `
                  <div style="margin-top:8px; font-size:11px; color:#cbd5e1;">
                    <b style="color:#94a3b8; font-size:10px; text-transform:uppercase;">Abilities: </b>
                    ${abilities.map(a => `<span style="display:inline-block; margin-right:8px; margin-top:2px;"><b>${escapeHtml(a.name)}:</b> <span style="color:#94a3b8;">${escapeHtml(a.description || '')}</span></span>`).join('')}
                  </div>
                ` : ''}

                ${keywords.length > 0 ? `
                  <div style="margin-top:6px;">
                    ${keywords.map(k => `<span style="display:inline-block; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:700; background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.25); margin-right:4px; margin-top:2px;">${escapeHtml(k)}</span>`).join('')}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>

        <!-- Stratagems -->
        ${stratagems.length > 0 ? `
          <div style="margin-top:20px;">
            <h4 style="font-size:14px; font-weight:800; color:#fff; margin-bottom:10px;">⚡ Detachment Stratagems</h4>
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:10px;">
              ${stratagems.map(s => `
                <div style="background:#131d33; border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:10px 12px;">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <b style="font-size:12px; color:#fff;">${escapeHtml(s.name)}</b>
                    <span style="background:#0284c7; color:#fff; font-size:10px; font-weight:900; padding:1px 5px; border-radius:4px;">${s.cp || 1} CP</span>
                  </div>
                  <div style="font-size:10px; color:#a855f7; font-weight:700; text-transform:uppercase; margin-bottom:4px;">${escapeHtml(s.phase || 'Any Phase')}</div>
                  <div style="font-size:11px; color:#94a3b8;">${escapeHtml(s.description)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
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

async function deleteHubArmyList(listId) {
  if (!confirm('Are you sure you want to delete this army list?')) return;
  try {
    await window.api.deleteArmyList(listId);
    await loadHubArmyLists();
  } catch(e) {
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

/* ==========================================================================
   EXTERNAL SCORECARD IMPORTER (Tabletop Battles / 40k App / Manual)
   ========================================================================== */

let hubScorecardImportTab = 'paste';
let hubParsedScorecardObj = null;

function openImportScorecardModalHub(tab = 'paste') {
  hubScorecardImportTab = tab;
  hubParsedScorecardObj = null;

  let modal = document.getElementById('hub-import-scorecard-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'hub-import-scorecard-modal';
    modal.style.cssText = 'position:fixed; inset:0; z-index:100000; display:flex; align-items:center; justify-content:center; background:rgba(3,7,18,0.85); backdrop-filter:blur(8px); padding:16px;';
    document.body.appendChild(modal);
  }

  renderScorecardImportModalContent();
  modal.style.display = 'flex';
}

function closeImportScorecardModalHub() {
  const modal = document.getElementById('hub-import-scorecard-modal');
  if (modal) modal.style.display = 'none';
}

function switchScorecardImportTab(tab) {
  hubScorecardImportTab = tab;
  renderScorecardImportModalContent();
}

function renderScorecardImportModalContent() {
  const modal = document.getElementById('hub-import-scorecard-modal');
  if (!modal) return;

  const isPaste = hubScorecardImportTab === 'paste';

  modal.innerHTML = `
    <div style="background:#0b1120; border:1px solid rgba(56,189,248,0.3); border-radius:16px; width:100%; max-width:680px; box-shadow:0 25px 60px rgba(0,0,0,0.85); display:flex; flex-direction:column; overflow:hidden; font-family:'Inter',system-ui,sans-serif; color:#f8fafc;">
      <!-- Header -->
      <div style="padding:16px 20px; background:#0f172a; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:18px;">📥</span>
          <h3 style="font-size:16px; font-weight:800; color:#fff; margin:0;">Import Match Scorecard</h3>
        </div>
        <button onclick="closeImportScorecardModalHub()" style="background:transparent; border:none; color:#94a3b8; font-size:22px; cursor:pointer;">✕</button>
      </div>

      <!-- Tab Switcher -->
      <div style="display:flex; border-bottom:1px solid rgba(255,255,255,0.08); background:#070b14; padding:0 20px;">
        <button onclick="switchScorecardImportTab('paste')" style="padding:10px 16px; font-size:12px; font-weight:800; background:transparent; border:none; border-bottom:2px solid ${isPaste ? '#38bdf8' : 'transparent'}; color:${isPaste ? '#38bdf8' : '#94a3b8'}; cursor:pointer;">
          ⚡ Paste Text / JSON (Tabletop Battles / 40k App)
        </button>
        <button onclick="switchScorecardImportTab('manual')" style="padding:10px 16px; font-size:12px; font-weight:800; background:transparent; border:none; border-bottom:2px solid ${!isPaste ? '#38bdf8' : 'transparent'}; color:${!isPaste ? '#38bdf8' : '#94a3b8'}; cursor:pointer;">
          ✏️ Quick Manual Entry
        </button>
      </div>

      <!-- Body -->
      <div style="padding:20px; overflow-y:auto; max-height:75vh;">
        ${isPaste ? `
          <p style="font-size:12px; color:#94a3b8; margin:0 0 12px;">
            Paste match results from <b>Tabletop Battles (by Goonhammer)</b>, the <b>Official Warhammer 40k App</b>, <b>ITC Battles</b>, or a casual summary text. A verified digital scorecard and match history entry will be generated automatically.
          </p>

          <textarea id="hub-sc-paste-input" placeholder="Paste match summary text or JSON export here..." oninput="handleHubParseScorecardPreview()" style="width:100%; height:170px; background:#070b14; border:1px solid #334155; border-radius:8px; padding:12px; font-family:'JetBrains Mono',monospace; font-size:11px; color:#e2e8f0; outline:none; resize:vertical;"></textarea>

          <div id="hub-sc-preview-box" style="display:none; margin-top:14px; background:#131d33; border:1px solid rgba(56,189,248,0.3); border-radius:10px; padding:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="font-size:13px; font-weight:800; color:#38bdf8;">Parsed Scorecard Preview</span>
              <span id="hub-sc-prev-source" style="font-size:10px; background:#1e293b; color:#94a3b8; padding:2px 6px; border-radius:4px;">Tabletop Battles</span>
            </div>
            
            <div style="display:grid; grid-template-columns:1fr auto 1fr; align-items:center; background:#090e1a; padding:12px; border-radius:8px; gap:12px; text-align:center;">
              <div style="text-align:left;">
                <div id="hub-sc-prev-p1-name" style="font-weight:800; font-size:14px; color:#fff;">Player 1</div>
                <div id="hub-sc-prev-p1-faction" style="font-size:11px; color:#38bdf8;">Space Marines</div>
                <div id="hub-sc-prev-p1-breakdown" style="font-size:10px; color:#94a3b8; margin-top:2px;">Pri: 45 | Sec: 35 | Paint: 10</div>
              </div>
              <div>
                <div style="font-family:'JetBrains Mono',monospace; font-size:22px; font-weight:900; color:#f59e0b;">
                  <span id="hub-sc-prev-p1-score">90</span> - <span id="hub-sc-prev-p2-score">75</span>
                </div>
                <div id="hub-sc-prev-winner" style="font-size:10px; color:#10b981; font-weight:800; margin-top:2px;">Winner: Player 1</div>
              </div>
              <div style="text-align:right;">
                <div id="hub-sc-prev-p2-name" style="font-weight:800; font-size:14px; color:#fff;">Player 2</div>
                <div id="hub-sc-prev-p2-faction" style="font-size:11px; color:#f43f5e;">Necrons</div>
                <div id="hub-sc-prev-p2-breakdown" style="font-size:10px; color:#94a3b8; margin-top:2px;">Pri: 35 | Sec: 30 | Paint: 10</div>
              </div>
            </div>

            <div id="hub-sc-prev-meta" style="margin-top:8px; font-size:11px; color:#94a3b8; text-align:center;">
              🎯 Mission: Take and Hold • 📍 Crucible of Battle
            </div>
          </div>

          <div style="margin-top:18px; display:flex; justify-content:flex-end; gap:10px;">
            <button onclick="closeImportScorecardModalHub()" style="background:#1e293b; color:#cbd5e1; font-weight:700; font-size:12px; border:none; padding:10px 16px; border-radius:8px; cursor:pointer;">
              Cancel
            </button>
            <button id="hub-btn-submit-import-sc" onclick="handleHubImportScorecardSubmit()" style="background:#0284c7; color:#fff; font-weight:800; font-size:12px; border:none; padding:10px 20px; border-radius:8px; cursor:pointer;">
              📥 Import & Generate Scorecard
            </button>
          </div>
        ` : `
          <!-- Manual Form -->
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
            <!-- Player 1 -->
            <div style="background:#131d33; border:1px solid rgba(56,189,248,0.25); border-radius:10px; padding:14px;">
              <h4 style="font-size:13px; font-weight:800; color:#38bdf8; margin:0 0 10px;">🟦 Player 1 (You or Opponent)</h4>
              <label style="display:block; font-size:11px; color:#94a3b8; margin-bottom:4px;">Player Name</label>
              <input type="text" id="hub-man-p1-name" value="${currentUser ? currentUser.display_name : 'Player 1'}" style="width:100%; background:#070b14; border:1px solid #334155; border-radius:6px; padding:6px 10px; color:#fff; font-size:12px; margin-bottom:8px;" />
              
              <label style="display:block; font-size:11px; color:#94a3b8; margin-bottom:4px;">Faction</label>
              <input type="text" id="hub-man-p1-faction" value="Space Marines" style="width:100%; background:#070b14; border:1px solid #334155; border-radius:6px; padding:6px 10px; color:#fff; font-size:12px; margin-bottom:8px;" />

              <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px;">
                <div>
                  <label style="font-size:10px; color:#94a3b8;">Primary VP</label>
                  <input type="number" id="hub-man-p1-pri" value="45" max="50" min="0" style="width:100%; background:#070b14; border:1px solid #334155; border-radius:6px; padding:6px; color:#fff; font-size:12px;" />
                </div>
                <div>
                  <label style="font-size:10px; color:#94a3b8;">Secondary VP</label>
                  <input type="number" id="hub-man-p1-sec" value="35" max="40" min="0" style="width:100%; background:#070b14; border:1px solid #334155; border-radius:6px; padding:6px; color:#fff; font-size:12px;" />
                </div>
                <div>
                  <label style="font-size:10px; color:#94a3b8;">Painted (+10)</label>
                  <input type="number" id="hub-man-p1-paint" value="10" max="10" min="0" style="width:100%; background:#070b14; border:1px solid #334155; border-radius:6px; padding:6px; color:#fff; font-size:12px;" />
                </div>
              </div>
            </div>

            <!-- Player 2 -->
            <div style="background:#131d33; border:1px solid rgba(244,63,94,0.25); border-radius:10px; padding:14px;">
              <h4 style="font-size:13px; font-weight:800; color:#f43f5e; margin:0 0 10px;">🟥 Player 2 (Opponent)</h4>
              <label style="display:block; font-size:11px; color:#94a3b8; margin-bottom:4px;">Player Name</label>
              <input type="text" id="hub-man-p2-name" value="Opponent" style="width:100%; background:#070b14; border:1px solid #334155; border-radius:6px; padding:6px 10px; color:#fff; font-size:12px; margin-bottom:8px;" />
              
              <label style="display:block; font-size:11px; color:#94a3b8; margin-bottom:4px;">Faction</label>
              <input type="text" id="hub-man-p2-faction" value="Necrons" style="width:100%; background:#070b14; border:1px solid #334155; border-radius:6px; padding:6px 10px; color:#fff; font-size:12px; margin-bottom:8px;" />

              <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px;">
                <div>
                  <label style="font-size:10px; color:#94a3b8;">Primary VP</label>
                  <input type="number" id="hub-man-p2-pri" value="35" max="50" min="0" style="width:100%; background:#070b14; border:1px solid #334155; border-radius:6px; padding:6px; color:#fff; font-size:12px;" />
                </div>
                <div>
                  <label style="font-size:10px; color:#94a3b8;">Secondary VP</label>
                  <input type="number" id="hub-man-p2-sec" value="28" max="40" min="0" style="width:100%; background:#070b14; border:1px solid #334155; border-radius:6px; padding:6px; color:#fff; font-size:12px;" />
                </div>
                <div>
                  <label style="font-size:10px; color:#94a3b8;">Painted (+10)</label>
                  <input type="number" id="hub-man-p2-paint" value="10" max="10" min="0" style="width:100%; background:#070b14; border:1px solid #334155; border-radius:6px; padding:6px; color:#fff; font-size:12px;" />
                </div>
              </div>
            </div>
          </div>

          <!-- Mission Meta -->
          <div style="margin-top:14px; background:#090e1a; border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding:14px; display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div>
              <label style="display:block; font-size:11px; color:#94a3b8; margin-bottom:4px;">Primary Mission</label>
              <input type="text" id="hub-man-mission" value="Take and Hold" style="width:100%; background:#070b14; border:1px solid #334155; border-radius:6px; padding:6px 10px; color:#fff; font-size:12px;" />
            </div>
            <div>
              <label style="display:block; font-size:11px; color:#94a3b8; margin-bottom:4px;">Deployment</label>
              <input type="text" id="hub-man-deployment" value="Crucible of Battle" style="width:100%; background:#070b14; border:1px solid #334155; border-radius:6px; padding:6px 10px; color:#fff; font-size:12px;" />
            </div>
          </div>

          <div style="margin-top:18px; display:flex; justify-content:flex-end; gap:10px;">
            <button onclick="closeImportScorecardModalHub()" style="background:#1e293b; color:#cbd5e1; font-weight:700; font-size:12px; border:none; padding:10px 16px; border-radius:8px; cursor:pointer;">
              Cancel
            </button>
            <button onclick="handleHubManualScorecardSubmit()" style="background:#10b981; color:#0f172a; font-weight:800; font-size:12px; border:none; padding:10px 20px; border-radius:8px; cursor:pointer;">
              💾 Save & View Scorecard
            </button>
          </div>
        `}
      </div>
    </div>
  `;
}

let hubParseTimer = null;
function handleHubParseScorecardPreview() {
  clearTimeout(hubParseTimer);
  hubParseTimer = setTimeout(async () => {
    const txt = document.getElementById('hub-sc-paste-input');
    const prevBox = document.getElementById('hub-sc-preview-box');
    if (!txt || !txt.value.trim()) {
      if (prevBox) prevBox.style.display = 'none';
      return;
    }

    try {
      const res = await window.api.parseScorecard(txt.value.trim());
      if (res.scorecard) {
        const sc = res.scorecard;
        hubParsedScorecardObj = sc;

        document.getElementById('hub-sc-prev-source').textContent = sc.source || 'External Scorecard';
        document.getElementById('hub-sc-prev-p1-name').textContent = sc.player1.name;
        document.getElementById('hub-sc-prev-p1-faction').textContent = sc.player1.faction;
        document.getElementById('hub-sc-prev-p1-breakdown').textContent = `Pri: ${sc.player1.primary_score} | Sec: ${sc.player1.secondary_score} | Paint: ${sc.player1.paint_score}`;
        document.getElementById('hub-sc-prev-p1-score').textContent = sc.player1.total_score;

        document.getElementById('hub-sc-prev-p2-name').textContent = sc.player2.name;
        document.getElementById('hub-sc-prev-p2-faction').textContent = sc.player2.faction;
        document.getElementById('hub-sc-prev-p2-breakdown').textContent = `Pri: ${sc.player2.primary_score} | Sec: ${sc.player2.secondary_score} | Paint: ${sc.player2.paint_score}`;
        document.getElementById('hub-sc-prev-p2-score').textContent = sc.player2.total_score;

        document.getElementById('hub-sc-prev-winner').textContent = `Winner: ${sc.winner_name}`;
        document.getElementById('hub-sc-prev-meta').textContent = `🎯 Mission: ${sc.mission} • 📍 ${sc.deployment}`;

        prevBox.style.display = 'block';
      }
    } catch(e) {}
  }, 250);
}

async function handleHubImportScorecardSubmit() {
  const txt = document.getElementById('hub-sc-paste-input');
  const btn = document.getElementById('hub-btn-submit-import-sc');
  if (!txt || !txt.value.trim()) {
    alert('Please paste your match text or JSON.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Importing...';

  try {
    const payload = hubParsedScorecardObj || { text: txt.value.trim() };
    const res = await window.api.importScorecard(payload);
    if (res.error) throw new Error(res.error);

    closeImportScorecardModalHub();
    alert(`🎉 Successfully imported match #${res.match_id}!`);
    await loadMyHubDashboard();
    window.open(res.scorecard_url, '_blank');
  } catch(e) {
    alert('Import failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '📥 Import & Generate Scorecard';
  }
}

async function handleHubManualScorecardSubmit() {
  const p1Name = document.getElementById('hub-man-p1-name').value.trim() || 'Player 1';
  const p1Faction = document.getElementById('hub-man-p1-faction').value.trim() || 'Space Marines';
  const p1Pri = parseInt(document.getElementById('hub-man-p1-pri').value) || 0;
  const p1Sec = parseInt(document.getElementById('hub-man-p1-sec').value) || 0;
  const p1Paint = parseInt(document.getElementById('hub-man-p1-paint').value) || 0;
  const p1Tot = p1Pri + p1Sec + p1Paint;

  const p2Name = document.getElementById('hub-man-p2-name').value.trim() || 'Player 2';
  const p2Faction = document.getElementById('hub-man-p2-faction').value.trim() || 'Necrons';
  const p2Pri = parseInt(document.getElementById('hub-man-p2-pri').value) || 0;
  const p2Sec = parseInt(document.getElementById('hub-man-p2-sec').value) || 0;
  const p2Paint = parseInt(document.getElementById('hub-man-p2-paint').value) || 0;
  const p2Tot = p2Pri + p2Sec + p2Paint;

  const mission = document.getElementById('hub-man-mission').value.trim() || 'Take and Hold';
  const deployment = document.getElementById('hub-man-deployment').value.trim() || 'Crucible of Battle';

  const winner = p1Tot > p2Tot ? p1Name : (p2Tot > p1Tot ? p2Name : 'Draw');

  const payload = {
    source: 'Manual Scorecard',
    mission: mission,
    deployment: deployment,
    mission_rule: 'Standard',
    player1: {
      name: p1Name,
      faction: p1Faction,
      primary_score: p1Pri,
      secondary_score: p1Sec,
      paint_score: p1Paint,
      total_score: p1Tot
    },
    player2: {
      name: p2Name,
      faction: p2Faction,
      primary_score: p2Pri,
      secondary_score: p2Sec,
      paint_score: p2Paint,
      total_score: p2Tot
    },
    winner_name: winner
  };

  try {
    const res = await window.api.importScorecard(payload);
    if (res.error) throw new Error(res.error);

    closeImportScorecardModalHub();
    alert(`🎉 Successfully saved scorecard #${res.match_id}!`);
    await loadMyHubDashboard();
    window.open(res.scorecard_url, '_blank');
  } catch(e) {
    alert('Failed to save scorecard: ' + e.message);
  }
}

window.openImportScorecardModalHub = openImportScorecardModalHub;
window.closeImportScorecardModalHub = closeImportScorecardModalHub;
window.switchScorecardImportTab = switchScorecardImportTab;
window.handleHubParseScorecardPreview = handleHubParseScorecardPreview;
window.handleHubImportScorecardSubmit = handleHubImportScorecardSubmit;
window.handleHubManualScorecardSubmit = handleHubManualScorecardSubmit;

