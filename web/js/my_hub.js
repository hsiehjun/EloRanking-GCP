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
    window.location.href = '/login?redirect=' + encodeURIComponent('/#my-hub');
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
    try {
      const sessResp = await fetch(`/api/tracker/sessions?token=${encodeURIComponent(window.api.getAuthToken())}`, {
        headers: { 'Authorization': `Bearer ${window.api.getAuthToken()}` }
      });
      if (sessResp.ok) {
        const sessData = await sessResp.json();
        if (sessData && sessData.success) {
          let hidden = [];
          try { hidden = JSON.parse(localStorage.getItem('gt-hidden-matches') || '[]'); } catch(e) {}
          const hiddenSet = new Set(hidden);

          const rawActive = sessData.active_sessions || (sessData.primary_active ? [sessData.primary_active, ...(sessData.unfinished_sessions || [])] : []);
          data.active_sessions = rawActive.filter(m => !hiddenSet.has(m.match_id || m.id));
          data.primary_active = data.active_sessions[0] || null;
          data.unfinished_sessions = data.active_sessions.slice(1);
          data.completed_history = (sessData.completed_history || []).filter(m => !hiddenSet.has(m.match_id || m.id));
          data.tracker_history = data.completed_history;
        }
      }
    } catch (e) {}

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

  const activeMatches = (data.active_sessions && Array.isArray(data.active_sessions))
    ? data.active_sessions
    : [data.primary_active, ...(data.unfinished_sessions || [])].filter(Boolean);

  const currentElo = Number(p.current_elo || 1500.0).toFixed(1);
  const peakElo = Number(p.peak_elo || 1500.0).toFixed(1);
  const winRate = Number(p.win_rate || 0.0).toFixed(1);
  const totalMatches = Number(p.matches_played || 0);

  const isBcpConnected = currentUser && currentUser.bcp_connected;
  const bcpEmail = currentUser && currentUser.bcp_email;

  const competitorName = (currentUser && currentUser.display_name && currentUser.display_name.trim() !== '' && currentUser.display_name.toLowerCase() !== 'competitor')
    ? currentUser.display_name
    : (p.player_name && p.player_name.toLowerCase() !== 'competitor'
        ? p.player_name
        : (currentUser && currentUser.display_name) || (currentUser && currentUser.email ? currentUser.email.split('@')[0] : 'Competitor'));

  let html = `
    <!-- Top Competitor Banner -->
    <div class="competitor-banner">
      <div style="display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap;">
        <div class="competitor-avatar">🏆</div>
        <div>
          <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
            <h2 style="font-size: 1.5rem; font-weight: 800; color: #fff; margin: 0;">${escapeHtml(competitorName)}</h2>
            ${p.player_name && p.player_name !== competitorName && p.player_name.toLowerCase() !== 'competitor' ? `<span style="font-size: 0.8rem; color: #94a3b8; font-weight: 500;">(Ranked as: ${escapeHtml(p.player_name)})</span>` : ''}
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
          <div class="hub-table-wrapper">
            <table id="hub-faction-table" class="hub-table">
              <thead>
                <tr>
                  <th style="width: 36%;">Army Played</th>
                  <th style="width: 16%; text-align: center;">Games</th>
                  <th style="width: 20%;">Record</th>
                  <th style="width: 16%; text-align: center;">Win Rate</th>
                  <th style="width: 12%; text-align: right;">Avg</th>
                </tr>
              </thead>
              <tbody>
                ${factionMastery.map(fm => `
                  <tr>
                    <td class="cell-ellipsis" title="${escapeHtml(fm.faction)}"><b style="color: #fff;">${escapeHtml(fm.faction)}</b></td>
                    <td style="text-align: center; font-family: var(--font-mono);">${fm.games}</td>
                    <td style="font-size: 0.78rem;"><span style="color:var(--win); font-weight:700;">${fm.wins}W</span> - <span style="color:var(--loss); font-weight:700;">${fm.losses}L</span></td>
                    <td style="text-align: center;"><b style="color: ${Number(fm.win_rate) >= 50 ? 'var(--win)' : 'var(--loss)'}; font-family:var(--font-mono);">${Number(fm.win_rate).toFixed(1)}%</b></td>
                    <td style="text-align: right; font-family: var(--font-mono);">${fm.avg_score || '-'}</td>
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
          <div class="hub-table-wrapper">
            <table id="hub-matchup-table" class="hub-table">
              <thead>
                <tr>
                  <th style="width: 35%;">Enemy Army</th>
                  <th style="width: 15%; text-align: center;">Played</th>
                  <th style="width: 20%;">Record</th>
                  <th style="width: 30%;">Win Rate vs Army</th>
                </tr>
              </thead>
              <tbody>
                ${matchups.map(m => `
                  <tr>
                    <td class="cell-ellipsis" title="${escapeHtml(m.enemy_faction)}"><b style="color: #fff;">${escapeHtml(m.enemy_faction)}</b></td>
                    <td style="text-align: center; font-family: var(--font-mono);">${m.total_encounters}</td>
                    <td style="font-size: 0.78rem;"><span style="color:var(--win); font-weight:700;">${m.wins}W</span> - <span style="color:var(--loss); font-weight:700;">${m.losses}L</span>${m.draws ? ` - <span style="color:var(--draw);">${m.draws}D</span>` : ''}</td>
                    <td>
                      <div style="display:flex; align-items:center; gap:0.5rem;">
                        <div style="flex:1; background:rgba(255,255,255,0.08); height:6px; border-radius:3px; overflow:hidden;">
                          <div style="width:${Math.min(100, Number(m.win_rate))}%; background:${Number(m.win_rate) >= 50 ? 'var(--win)' : 'var(--loss)'}; height:100%;"></div>
                        </div>
                        <b style="font-size:0.78rem; font-family:var(--font-mono);">${Number(m.win_rate).toFixed(1)}%</b>
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
          <div class="hub-table-wrapper">
            <table id="hub-history-table" class="hub-table">
              <thead>
                <tr>
                  <th style="width: 52px;">Date</th>
                  <th style="width: 38%;">Tournament</th>
                  <th style="width: 32%;">Opponent</th>
                  <th style="width: 50px; text-align: center;">Result</th>
                  <th style="width: 54px; text-align: right;">Elo</th>
                </tr>
              </thead>
              <tbody>
                ${history.slice().reverse().map(h => {
                  const delta = Number(h.delta_elo || 0);
                  const isPos = delta >= 0;
                  const res = h.result === 'W' ? '<span class="res-badge res-w" style="font-size:0.68rem; padding:0.1rem 0.35rem;">WIN</span>' : (h.result === 'L' ? '<span class="res-badge res-l" style="font-size:0.68rem; padding:0.1rem 0.35rem;">LOSS</span>' : '<span class="res-badge res-d" style="font-size:0.68rem; padding:0.1rem 0.35rem;">DRAW</span>');
                  return `
                    <tr>
                      <td style="color: var(--text-muted); font-size: 0.75rem; font-family: var(--font-mono);">${h.match_date ? h.match_date.substring(5, 10) : '-'}</td>
                      <td class="cell-ellipsis" title="${escapeHtml(h.event_name || 'Event')}">
                        <span class="player-link" style="font-size:0.78rem;" onclick="openEventModal('${h.event_id}', false, 'elo')">${escapeHtml(h.event_name || 'Event')}</span>
                      </td>
                      <td class="cell-ellipsis" title="${escapeHtml(h.opponent_name || 'Opponent')}">
                        <b style="font-size:0.78rem; color:#e2e8f0;">${escapeHtml(h.opponent_name || 'Opponent')}</b>
                      </td>
                      <td style="text-align: center;">${res}</td>
                      <td style="text-align: right;">
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

      <!-- Card 6: 3-Tier 11th Edition Live Game Tracker & Match History -->
      <div class="hub-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <h3 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin: 0;">🎲 Active Matches & History</h3>
            <span class="badge" style="background: rgba(56,189,248,0.12); color: #38bdf8; font-size: 0.68rem; padding: 0.1rem 0.4rem;">11th Ed</span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <a href="/11th/tracker" target="_blank" style="font-size: 0.75rem; color: var(--accent); text-decoration: none; font-weight: 600;">Game Tracker ➔</a>
          </div>
        </div>

        <!-- 1. Active Matches (All in Green Cards) -->
        ${(activeMatches && activeMatches.length > 0) ? `
          <div style="margin-bottom: 14px;">
            <div style="font-size: 0.72rem; color: #10b981; font-weight: 800; font-family: var(--font-mono); margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px;">
              <span>🟢 ACTIVE MATCHES (${activeMatches.length})</span>
              <span style="font-size: 0.68rem; color: var(--text-muted); font-weight: normal;">⏳ Uncompleted games auto-purge after 14 days</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px;">
              ${activeMatches.map(m => {
                const mid = m.match_id || m.id || '';
                const shortId = mid.replace('WH40K-', '');
                const rNum = m.round || m.current_round || 1;
                const createdDate = m.created_at || m.date || m.timestamp;
                const dateLabel = createdDate ? new Date(createdDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Recent';
                return `
                  <div style="background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.3); border-radius: 12px; padding: 12px 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-wrap: wrap; gap: 4px;">
                      <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 0.72rem; font-weight: 800; color: #10b981; text-transform: uppercase; font-family: var(--font-mono);">
                        <span style="width: 7px; height: 7px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
                        🟢 Active Match (Round ${rNum})
                      </span>
                      <span style="font-size: 0.7rem; color: var(--text-muted); font-family: var(--font-mono);">#${escapeHtml(shortId)} • 📅 Created ${dateLabel}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                      <div>
                        <b style="color: #fff; font-size: 0.88rem;">${escapeHtml(m.p1_name || 'Player 1')} (${m.p1_score || 0}) <span style="color: var(--text-muted); font-weight: normal;">vs</span> ${escapeHtml(m.p2_name || 'Player 2')} (${m.p2_score || 0})</b>
                        <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 2px;">
                          ${escapeHtml(m.p1_faction || 'Army 1')} vs ${escapeHtml(m.p2_faction || 'Army 2')}
                          ${m.primary_mission ? ` • 🎯 ${escapeHtml(m.primary_mission)}` : ''}
                        </div>
                      </div>
                      <div style="display: flex; gap: 6px; align-items: center;">
                        <a href="/11th/tracker/play?match_id=${encodeURIComponent(mid)}" target="_blank" class="btn btn-sm btn-primary" style="font-size: 0.75rem; padding: 5px 12px; text-decoration: none; font-weight: 700;">
                          ▶️ Resume Match
                        </a>
                        <button onclick="discardTrackerSession('${escapeHtml(mid)}')" style="background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); border-radius: 6px; padding: 5px 8px; font-size: 0.75rem; cursor: pointer; font-weight: 700;" title="Discard / Abandon Test Match">
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}

        <!-- 3. Verified Match History / Completed Scorecards -->
        ${(data.completed_history && data.completed_history.length > 0) ? `
          <div class="hub-table-wrapper" style="margin-top: 10px;">
            <table id="hub-tracker-history-table" class="hub-table">
              <thead>
                <tr>
                  <th style="width: 75px;">Match</th>
                  <th style="width: 48%;">Players / Armies</th>
                  <th style="width: 65px; text-align: center;">Score</th>
                  <th style="width: 80px; text-align: right;">Scorecard</th>
                </tr>
              </thead>
              <tbody>
                ${data.completed_history.map(th => {
                  const p1 = th.p1_name || 'Player 1';
                  const p2 = th.p2_name || 'Player 2';
                  const p1Score = th.p1_score || 0;
                  const p2Score = th.p2_score || 0;
                  const matchId = th.match_id || '';
                  const shortId = matchId.replace('WH40K-', '');
                  const dateStr = th.date || (th.updated_at ? th.updated_at.substring(5, 10) : '-');

                  return `
                    <tr>
                      <td style="white-space: nowrap;">
                        <a href="/scorecard/${encodeURIComponent(matchId)}" target="_blank" style="font-family:var(--font-mono); font-size:0.75rem; font-weight:700; color:var(--accent); text-decoration:none;">
                          #${escapeHtml(shortId)} ↗
                        </a>
                        <div style="font-size:0.7rem; color:var(--text-muted);">${dateStr}</div>
                      </td>
                      <td class="cell-ellipsis">
                        <div style="color:#fff; font-size:0.8rem; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                          ${escapeHtml(p1)} <span style="color:var(--text-muted); font-weight:normal;">vs</span> ${escapeHtml(p2)}
                        </div>
                        <div style="font-size:0.7rem; color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                          ${escapeHtml(th.p1_faction || 'Army 1')} vs ${escapeHtml(th.p2_faction || 'Army 2')}
                        </div>
                      </td>
                      <td style="text-align: center;">
                        <span style="font-weight:700; color:#38bdf8; font-family:var(--font-mono); font-size:0.85rem;">${p1Score} - ${p2Score}</span>
                      </td>
                      <td style="text-align: right;">
                        <a href="/scorecard/${encodeURIComponent(matchId)}" target="_blank" style="display:inline-flex; align-items:center; gap:3px; background:rgba(16,185,129,0.15); color:#10b981; font-size:0.7rem; font-weight:700; padding:0.2rem 0.5rem; border-radius:6px; text-decoration:none; border:1px solid rgba(16,185,129,0.3);">
                          📄 Scorecard ↗
                        </a>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : (!data.primary_active && (!data.unfinished_sessions || data.unfinished_sessions.length === 0)) ? `
          <div style="padding: 2.25rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
            <div style="font-size: 1.05rem; margin-bottom: 0.35rem;">🎲 No Live Game Tracker matches logged.</div>
            <div style="font-size: 0.78rem; margin-bottom: 0.75rem;">Track live 11th Edition games with automated VP scoring & real-time sync!</div>
            <a href="/11th/tracker" target="_blank" class="bcp-login-btn" style="text-decoration:none; display:inline-block; font-size:0.8rem; padding:0.4rem 0.9rem;">+ Open Game Tracker</a>
          </div>
        ` : ''}
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
  if (typeof bringModalToFront === 'function') {
    bringModalToFront('hub-location-picker-modal');
  } else {
    const modal = document.getElementById('hub-location-picker-modal');
    if (modal) {
      modal.style.zIndex = '1300';
      modal.classList.add('active');
    }
  }
}

function closeLocationPickerModal() {
  if (typeof closeModal === 'function') {
    closeModal('hub-location-picker-modal');
  } else {
    const modal = document.getElementById('hub-location-picker-modal');
    if (modal) modal.classList.remove('active');
  }
}

function setPresetLocation(cityKey) {
  if (cityKey === 'gps') {
    customUserLocation = null;
    userDeviceGeo = null;
    try {
      sessionStorage.removeItem('omni_user_custom_loc');
      sessionStorage.removeItem('omni_user_geo');
    } catch (e) {}
    closeLocationPickerModal();
    requestUserDeviceLocationPrompt();
    return;
  }
  const loc = GLOBAL_CITY_COORDS[cityKey.toLowerCase()];
  if (loc) {
    customUserLocation = { name: loc.name, lat: loc.lat, lng: loc.lng };
    try { sessionStorage.setItem('omni_user_custom_loc', JSON.stringify(customUserLocation)); } catch (e) {}
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
      try { sessionStorage.setItem('omni_user_custom_loc', JSON.stringify(customUserLocation)); } catch (e) {}
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
      try { sessionStorage.setItem('omni_user_custom_loc', JSON.stringify(customUserLocation)); } catch (e) {}
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
    try {
      const cached = sessionStorage.getItem('omni_user_geo');
      if (cached) {
        userDeviceGeo = JSON.parse(cached);
        return resolve(userDeviceGeo);
      }
    } catch (e) {}

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      let resolved = false;
      const safety = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      }, 3000);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(safety);
          userDeviceGeo = {
            lat: Number(pos.coords.latitude.toFixed(4)),
            lng: Number(pos.coords.longitude.toFixed(4))
          };
          try { sessionStorage.setItem('omni_user_geo', JSON.stringify(userDeviceGeo)); } catch (e) {}
          resolve(userDeviceGeo);
        },
        () => {
          if (resolved) return;
          resolved = true;
          clearTimeout(safety);
          resolve(null);
        },
        { enableHighAccuracy: false, timeout: 2500, maximumAge: 300000 }
      );
    } else {
      resolve(null);
    }
  });
}

function requestUserDeviceLocationPrompt() {
  const errBox = document.getElementById('hub-loc-error-msg');
  const btn = document.getElementById('hub-enable-loc-btn');
  if (errBox) errBox.style.display = 'none';

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    if (errBox) {
      errBox.innerHTML = '⚠️ Geolocation is not supported by your browser. Please select your city below.';
      errBox.style.display = 'block';
    }
    openLocationPickerModal();
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; margin-right:6px; vertical-align:middle;"></span> Requesting Location...';
  }

  let hasFinished = false;

  // Strict 4.5s race timeout: In iOS PWA standalone mode, WebKit often silently hangs
  // without invoking either success or error callbacks.
  const safetyTimeout = setTimeout(() => {
    if (hasFinished) return;
    hasFinished = true;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '📍 Enable Location Sharing';
    }
    showHelpfulError(
      '📍 Location request timed out. On iPhone/iPad, check <b>Settings &gt; Privacy &gt; Location Services &gt; Safari</b>, or tap your city below!'
    );
  }, 4500);

  function handleSuccess(pos) {
    if (hasFinished) return;
    hasFinished = true;
    clearTimeout(safetyTimeout);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '📍 Enable Location Sharing';
    }
    userDeviceGeo = {
      lat: Number(pos.coords.latitude.toFixed(4)),
      lng: Number(pos.coords.longitude.toFixed(4))
    };
    try { sessionStorage.setItem('omni_user_geo', JSON.stringify(userDeviceGeo)); } catch (e) {}
    loadHubRecommendedEvents();
  }

  function handleError(err) {
    if (hasFinished) return;
    hasFinished = true;
    clearTimeout(safetyTimeout);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '📍 Enable Location Sharing';
    }
    let msg = 'Could not acquire GPS coordinates. Please select your city below.';
    if (err && err.code === 1) {
      msg = '📍 Location access was denied in browser settings. To enable GPS, go to <b>Settings &gt; Privacy &gt; Location Services &gt; Safari</b> and set to <i>"While Using"</i>, or select your city below.';
    } else if (err && err.code === 2) {
      msg = '📍 GPS signal unavailable. Please select your city below.';
    } else if (err && err.code === 3) {
      msg = '📍 GPS request timed out. Please select your city below.';
    }
    showHelpfulError(msg);
  }

  function showHelpfulError(msg) {
    if (errBox) {
      errBox.innerHTML = msg;
      errBox.style.display = 'block';
    }
    openLocationPickerModal();
  }

  try {
    navigator.geolocation.getCurrentPosition(
      handleSuccess,
      handleError,
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 60000 }
    );
  } catch (e) {
    if (!hasFinished) {
      hasFinished = true;
      clearTimeout(safetyTimeout);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '📍 Enable Location Sharing';
      }
      showHelpfulError('📍 Location access error. Please select your city below.');
    }
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
  const sortSelect = document.getElementById('hub-rec-sort-select');
  const query = searchInput ? searchInput.value.trim() : '';
  const playerId = (currentUser && currentUser.player_id) ? currentUser.player_id : '';
  const selectedTier = tierSelect ? tierSelect.value : '';
  const selectedRadius = radiusSelect && radiusSelect.value ? Number(radiusSelect.value) : 50;
  const selectedSort = sortSelect ? sortSelect.value : 'date';

  // Determine coordinates: Custom chosen location > Live device GPS > Competitor Home fallback
  let userLat = null;
  let userLng = null;
  let locName = null;
  let geo = null;

  try {
    const savedLoc = sessionStorage.getItem('omni_user_custom_loc');
    if (savedLoc && !customUserLocation) {
      customUserLocation = JSON.parse(savedLoc);
    }
  } catch (e) {}

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
    const data = await window.api.getRecommendedEvents(playerId, query, selectedTier, userLat, userLng, selectedRadius, 40, '', selectedSort);
    const events = data.events || [];
    
    if (label) {
      const activeName = locName || [data.detected_city, data.detected_state].filter(Boolean).join(', ') || 'San Diego, CA';
      label.innerHTML = `📍 <b>${escapeHtml(activeName)}</b> <button class="hub-location-btn" onclick="openLocationPickerModal()">✏️ Change Location</button>`;
    }

    // If no GPS, no custom location, and no detected history, show prompt to enable location sharing
    if (!geo && !customUserLocation && !data.detected_state && !data.detected_city && !query) {
      container.innerHTML = `
        <div style="padding: 2.5rem 1.5rem; text-align: center; color: var(--text-secondary); max-width: 520px; margin: 0 auto; grid-column: 1 / -1;">
          <div style="font-size: 2.2rem; margin-bottom: 0.6rem;">📍</div>
          <h4 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin-bottom: 0.4rem;">Enable Location Sharing to Discover Tournaments</h4>
          <p style="font-size: 0.82rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 1.15rem;">
            Allow device location access to automatically find tournaments within 100 miles of your current location.
          </p>

          <div id="hub-loc-error-msg" style="display:none; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.35); border-radius:8px; padding:0.75rem 1rem; margin-bottom:1.15rem; font-size:0.82rem; color:#f59e0b; text-align:left; line-height:1.45;"></div>

          <div style="display:flex; justify-content:center; gap:0.6rem; flex-wrap:wrap; margin-bottom:1.5rem;">
            <button id="hub-enable-loc-btn" class="bcp-login-btn" style="font-size: 0.85rem; padding: 0.55rem 1.35rem; font-weight: 700;" onclick="requestUserDeviceLocationPrompt()">
              📍 Enable Location Sharing
            </button>
            <button class="bcp-login-btn" style="font-size: 0.85rem; padding: 0.55rem 1.35rem; font-weight: 700; background:#1e293b; color:#38bdf8; border:1px solid rgba(56,189,248,0.3);" onclick="openLocationPickerModal()">
              ✏️ Search Any City
            </button>
          </div>

          <div style="padding-top: 1.15rem; border-top: 1px solid var(--border);">
            <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); margin-bottom: 0.65rem; text-transform: uppercase; letter-spacing: 0.5px;">Or Quick Select Popular Hubs:</div>
            <div style="display:flex; justify-content:center; gap:0.4rem; flex-wrap:wrap;">
              <button class="hub-loc-chip" style="font-size:0.78rem; padding:0.35rem 0.75rem;" onclick="setPresetLocation('san diego')">🌴 San Diego</button>
              <button class="hub-loc-chip" style="font-size:0.78rem; padding:0.35rem 0.75rem;" onclick="setPresetLocation('los angeles')">🎬 Los Angeles</button>
              <button class="hub-loc-chip" style="font-size:0.78rem; padding:0.35rem 0.75rem;" onclick="setPresetLocation('austin')">🤠 Austin</button>
              <button class="hub-loc-chip" style="font-size:0.78rem; padding:0.35rem 0.75rem;" onclick="setPresetLocation('dallas')">⭐ Dallas</button>
              <button class="hub-loc-chip" style="font-size:0.78rem; padding:0.35rem 0.75rem;" onclick="setPresetLocation('chicago')">🏙️ Chicago</button>
              <button class="hub-loc-chip" style="font-size:0.78rem; padding:0.35rem 0.75rem;" onclick="setPresetLocation('new york')">🗽 New York</button>
              <button class="hub-loc-chip" style="font-size:0.78rem; padding:0.35rem 0.75rem;" onclick="setPresetLocation('seattle')">🌲 Seattle</button>
              <button class="hub-loc-chip" style="font-size:0.78rem; padding:0.35rem 0.75rem;" onclick="setPresetLocation('london')">☕ London</button>
              <button class="hub-loc-chip" style="font-size:0.78rem; padding:0.35rem 0.75rem; background:rgba(56,189,248,0.1); color:#38bdf8; border-color:rgba(56,189,248,0.3);" onclick="openLocationPickerModal()">🔍 More Cities...</button>
            </div>
          </div>
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

  const avgElo = ev.avg_elo_display ? Math.round(ev.avg_elo_display) : (ev.avg_field_elo ? Math.round(ev.avg_field_elo) : 1550);
  const myElo = (typeof currentUser !== 'undefined' && (currentUser?.current_elo || currentUser?.elo)) ||
                (typeof myHubData !== 'undefined' && (myHubData?.player?.current_elo || myHubData?.player?.elo)) ||
                (typeof connectState !== 'undefined' && (connectState.userProfile?.current_elo || connectState.userProfile?.elo)) ||
                ev.user_elo ||
                null;

  let deltaLabel = '';
  let deltaBadge = 'badge-match-prime';

  if (myElo) {
    const delta = avgElo - Math.round(myElo);
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

  return `
    <div class="hub-event-card-pro" onclick="openEventModal('${ev.id}', false, 'elo')">
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
        <span class="badge ${deltaBadge}" style="font-size:0.72rem; padding:0.2rem 0.55rem; font-weight:700;">
          ${escapeHtml(deltaLabel)}
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
    <div style="background:#0b1120; border:1px solid rgba(56,189,248,0.3); border-radius:16px; width:100%; max-width:600px; box-shadow:0 25px 60px rgba(0,0,0,0.85); display:flex; flex-direction:column; overflow:hidden; font-family:'Inter',system-ui,sans-serif; color:#f8fafc;">
      <!-- Header -->
      <div style="padding:16px 20px; background:#0f172a; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:22px;">📋</span>
          <div>
            <h3 style="font-size:16px; font-weight:800; color:#fff; margin:0;">Import Army Roster</h3>
            <div style="font-size:11px; color:#38bdf8; margin-top:2px;">Paste text from NewRecruit or Official 40k App for full Wahapedia enrichment</div>
          </div>
        </div>
        <button onclick="closeImportArmyListModal()" style="background:transparent; border:none; color:#94a3b8; font-size:22px; cursor:pointer;">✕</button>
      </div>

      <!-- Paste Text Content -->
      <div style="padding:20px;">
        <!-- Recommended Exporter Options Guide -->
        <div style="background:rgba(2,132,199,0.08); border:1px solid rgba(56,189,248,0.25); border-radius:8px; padding:10px 14px; margin-bottom:12px; font-size:11.5px; color:#cbd5e1; line-height:1.45;">
          <div style="font-weight:700; color:#38bdf8; margin-bottom:4px; display:flex; align-items:center; gap:5px;">
            <span>💡</span> Supported & Recommended Exporters:
          </div>
          <div style="color:#e2e8f0;">• <b>NewRecruit Text Export:</b> Options <code>Tournament, GW</code> &bull; Checked: <code>[✓] Constant selections</code> &bull; <code>[✓] Header</code></div>
          <div style="color:#e2e8f0; margin-top:2px;">• <b>Official Warhammer 40k App:</b> Share / Export text list directly</div>
          <div style="color:#94a3b8; font-size:11px; margin-top:5px; border-top:1px dashed rgba(255,255,255,0.1); padding-top:4px;">
            ⚠️ <i>Note: Other formats (BattleScribe, raw JSON, or BCP plain text) might not have full Wahapedia stats/rules enrichment.</i>
          </div>
        </div>

        <label style="display:block; font-size:12px; font-weight:700; color:#cbd5e1; margin-bottom:8px;">
          Paste Army List Text:
        </label>
        <textarea id="hub-import-text-input" rows="10" placeholder="Paste your army roster text here... (e.g. Space Marines - Gladius Task Force, Units, Enhancements, Points)" style="width:100%; background:#070b14; border:1px solid #334155; border-radius:10px; padding:12px 14px; font-family:'JetBrains Mono',monospace; font-size:12px; color:#e2e8f0; outline:none; box-sizing:border-box; resize:vertical; line-height:1.5;"></textarea>

        <div style="margin-top:12px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
          <div style="font-size:11px; color:#94a3b8;">
            ✨ Automatically enriches with <b>11th Edition Wahapedia</b> datasheets & stratagems.
          </div>
          <div style="display:flex; gap:8px;">
            <button onclick="closeImportArmyListModal()" style="background:#1e293b; color:#cbd5e1; font-weight:700; font-size:12px; border:none; padding:9px 16px; border-radius:8px; cursor:pointer;">Cancel</button>
            <button id="hub-btn-do-import-text" onclick="handleHubParseAndSaveText()" style="background:#0284c7; color:#fff; font-weight:800; font-size:12px; border:none; padding:9px 20px; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:6px;">
              ⚡ Import & Enrich Roster
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
}

async function handleHubParseAndSaveText() {
  const input = document.getElementById('hub-import-text-input');
  const btn = document.getElementById('hub-btn-do-import-text');
  if (!input || !input.value.trim()) {
    alert('Please paste your army roster text.');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; margin-right:6px; vertical-align:middle;"></span> Enriching with Wahapedia...';

  try {
    const raw = input.value.trim();
    const parseRes = await window.api.parseArmyList(raw);
    if (parseRes.error || !parseRes.army_list) throw new Error(parseRes.error || 'Failed to parse text');

    const armyList = parseRes.army_list;
    const saveRes = await window.api.saveArmyList(armyList);
    if (saveRes.error) throw new Error(saveRes.error);

    closeImportArmyListModal();
    alert(`🎉 Successfully imported and enriched "${armyList.name}" (${armyList.points} pts, ${armyList.units?.length || 0} units)!`);
    await loadHubArmyLists();
    openViewArmyListModal(armyList.id);
  } catch(e) {
    alert('Error importing roster: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Import & Enrich Roster';
  }
}

function closeImportArmyListModal() {
  const modal = document.getElementById('hub-import-armylist-modal');
  if (modal) modal.style.display = 'none';
}

function generateRawRosterText(list) {
  if (list.raw_text && list.raw_text.trim().length > 10) {
    return list.raw_text.trim();
  }
  let out = `${list.faction || 'Warhammer 40,000'} - ${list.detachment || 'Core Detachment'} (${list.points || 2000} pts)\n\n`;
  const units = list.units || [];
  const groups = {};
  for (const u of units) {
    const role = (u.role || 'Other Datasheets').toUpperCase();
    if (!groups[role]) groups[role] = [];
    groups[role].push(u);
  }
  for (const [role, uList] of Object.entries(groups)) {
    out += `+ ${role} +\n`;
    for (const u of uList) {
      const cnt = u.model_count && u.model_count > 1 ? `${u.model_count}x ` : '';
      out += `${cnt}${u.name} [${u.points || 0} pts]`;
      const tags = [];
      if (u.is_warlord) tags.push('Warlord');
      if (u.enhancement) tags.push(`Enhancement: ${u.enhancement}`);
      if (tags.length > 0) out += `: ${tags.join(', ')}`;
      out += '\n';
      if (u.wargear && u.wargear.length > 0) {
        out += `  • Wargear: ${u.wargear.join(', ')}\n`;
      }
    }
    out += '\n';
  }
  return out.trim();
}

window.generateRawRosterText = generateRawRosterText;

window.copyHubRawText = function(listId) {
  const list = (hubSavedLists || []).find(l => l.id === listId);
  if (!list) return;
  const rawText = generateRawRosterText(list);
  navigator.clipboard.writeText(rawText).then(() => {
    alert('📋 Raw roster text copied to clipboard!');
  }).catch(() => {
    prompt('Copy your roster text below:', rawText);
  });
};

window.setHubRosterViewMode = function(mode, listId) {
  window.hubCurrentViewMode = mode;
  openViewArmyListModal(listId, mode);
};

function renderNativeRosterViewer(list, options = {}) {
  const viewMode = options.mode || window.hubCurrentViewMode || 'enriched';

  if (viewMode === 'text') {
    const rawText = generateRawRosterText(list);
    return `
      <div style="display:flex; flex-direction:column; padding:20px; flex:1; overflow:hidden; background:#070b14;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
          <div style="font-size:13px; font-weight:800; color:#38bdf8; display:flex; align-items:center; gap:6px;">
            <span>📄</span> Raw Roster Text (Monospaced / Copy-Friendly)
          </div>
          <button onclick="copyHubRawText('${list.id}')" style="background:#1e293b; color:#38bdf8; border:1px solid rgba(56,189,248,0.3); font-weight:800; font-size:12px; padding:7px 16px; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:6px;">
            📋 Copy Raw Text
          </button>
        </div>
        <pre id="hub-raw-roster-content" style="flex:1; margin:0; background:#030712; border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:18px; font-family:'JetBrains Mono',monospace; font-size:12px; color:#e2e8f0; line-height:1.6; white-space:pre-wrap; overflow-y:auto; word-break:break-word;">${escapeHtml(rawText)}</pre>
      </div>
    `;
  }

  let units = list.units || [];
  let armyRules = list.army_rules || [];
  let detachmentRules = list.detachment_rules || [];

  if ((!units || units.length === 0) && list.list_data) {
    let ld = list.list_data;
    if (typeof ld === 'string') {
      try { ld = JSON.parse(ld); } catch(e) {}
    }
    if (ld && typeof ld === 'object') {
      if (ld.units && ld.units.length > 0) units = ld.units;
      if (ld.army_rules && ld.army_rules.length > 0) armyRules = ld.army_rules;
      if (ld.detachment_rules && ld.detachment_rules.length > 0) detachmentRules = ld.detachment_rules;
      if (ld.stratagems && ld.stratagems.length > 0) stratagems = ld.stratagems;
    }
  }

  let stratagems = list.stratagems || [];
  if (stratagems.length === 0 && list.list_data) {
    try {
      const ld = typeof list.list_data === 'string' ? JSON.parse(list.list_data) : list.list_data;
      if (ld && ld.stratagems) stratagems = ld.stratagems;
    } catch(e) {}
  }

  const name = list.name || 'Army Roster';
  const faction = list.faction || 'Warhammer 40,000';
  const detachment = list.detachment || 'Core Detachment';
  const points = list.points || 2000;
  const warlord = list.warlord || '';

  function formatWahaText(text) {
    if (!text) return '';
    if (typeof text !== 'string') text = String(text);
    let formatted = text
      .replace(/<span class=["']?kwb["']?>\s*([^<]+?)\s*<\/span>/gi, '<span class="kwb-badge">$1</span>')
      .replace(/<span class=["']?tooltip[^"']*["']?>\s*([^<]+?)\s*<\/span>/gi, '$1')
      .replace(/<a [^>]*>([^<]+)<\/a>/gi, '$1');
    formatted = formatted.replace(/<\/?(script|iframe|object|embed|style|form|input|button)[^>]*>/gi, '');
    return formatted;
  }

  let contentHtml = `<div style="display:flex; flex-direction:column; gap:1.25rem; padding:1.25rem; overflow-y:auto; flex:1; background:#070b14;">`;

  // 1. Army & Detachment Rules Banner
  if (armyRules.length > 0 || detachmentRules.length > 0) {
    contentHtml += `
      <div style="background:rgba(15, 23, 42, 0.7); border:1px solid rgba(56, 189, 248, 0.25); border-radius:12px; padding:12px 16px;">
        <div style="font-size:13px; font-weight:800; color:#38bdf8; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
          <span>📜</span> Army & Detachment Rules
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:10px;">
          ${armyRules.map(ar => `
            <div style="background:#070b14; border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:10px;">
              <div style="font-weight:800; font-size:13px; color:#f8fafc; margin-bottom:4px;">🛡️ ${escapeHtml(ar.name)}</div>
              <div style="font-size:11px; color:#94a3b8; line-height:1.5; white-space:pre-wrap;">${formatWahaText(ar.description || '')}</div>
            </div>
          `).join('')}
          ${detachmentRules.map(dr => `
            <div style="background:#070b14; border:1px solid rgba(192,132,252,0.25); border-radius:8px; padding:10px;">
              <div style="font-weight:800; font-size:13px; color:#c084fc; margin-bottom:4px;">⚡ ${escapeHtml(dr.name)}</div>
              <div style="font-size:11px; color:#94a3b8; line-height:1.5; white-space:pre-wrap;">${formatWahaText(dr.description || '')}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // 2. Detachment Stratagems Banner
  if (stratagems.length > 0) {
    contentHtml += `
      <div style="background:rgba(15, 23, 42, 0.7); border:1px solid rgba(239, 68, 68, 0.25); border-radius:12px; padding:12px 16px;">
        <div style="font-size:13px; font-weight:800; color:#f87171; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
          <span>⚔️</span> Detachment Stratagems <span style="font-size:11px; color:#94a3b8; font-weight:normal;">(${stratagems.length})</span>
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:10px;">
          ${stratagems.map(st => `
            <div style="background:#070b14; border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:10px; display:flex; flex-direction:column; gap:6px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <b style="font-size:12px; color:#fff; font-family:'JetBrains Mono',monospace;">${escapeHtml(st.name)}</b>
                <span class="badge" style="background:rgba(239,68,68,0.2); color:#ef4444; font-size:10px; font-weight:800; border:1px solid rgba(239,68,68,0.4); padding:1px 5px;">${escapeHtml(st.cp_cost || '1 CP')}</span>
              </div>
              <div style="display:flex; flex-wrap:wrap; gap:4px; font-size:9.5px;">
                ${st.type ? `<span style="color:#38bdf8; background:rgba(56,189,248,0.1); padding:1px 4px; border-radius:3px;">${escapeHtml(st.type)}</span>` : ''}
                ${st.phase ? `<span style="color:#facc15; background:rgba(250,204,21,0.1); padding:1px 4px; border-radius:3px;">🕒 ${escapeHtml(st.phase)}</span>` : ''}
                ${st.turn ? `<span style="color:#a855f7; background:rgba(168,85,247,0.1); padding:1px 4px; border-radius:3px;">${escapeHtml(st.turn)}</span>` : ''}
              </div>
              <div style="font-size:11px; color:#94a3b8; line-height:1.4; white-space:pre-wrap;">${formatWahaText(st.description || '')}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Group units by category/role
  const categories = {
    'Epic Heroes & Characters': [],
    'Battleline': [],
    'Infantry & Elites': [],
    'Mounted & Fast Attack': [],
    'Vehicles & Monsters': [],
    'Transports & Dedicated': [],
    'Other Datasheets': []
  };

  units.forEach((u, idx) => {
    const role = (u.role || '').toLowerCase();
    if (u.is_warlord || role.includes('character') || role.includes('epic hero') || role.includes('leader')) {
      categories['Epic Heroes & Characters'].push({ ...u, _idx: idx });
    } else if (role.includes('battleline')) {
      categories['Battleline'].push({ ...u, _idx: idx });
    } else if (role.includes('mounted') || role.includes('biker') || role.includes('cavalry')) {
      categories['Mounted & Fast Attack'].push({ ...u, _idx: idx });
    } else if (role.includes('vehicle') || role.includes('monster') || role.includes('walker') || role.includes('dreadnought')) {
      categories['Vehicles & Monsters'].push({ ...u, _idx: idx });
    } else if (role.includes('transport')) {
      categories['Transports & Dedicated'].push({ ...u, _idx: idx });
    } else if (role.includes('infantry') || role.includes('elites')) {
      categories['Infantry & Elites'].push({ ...u, _idx: idx });
    } else {
      categories['Other Datasheets'].push({ ...u, _idx: idx });
    }
  });

  // Helper to group identical units
  function groupIdenticalUnits(catUnits) {
    const grouped = [];
    const map = new Map();

    catUnits.forEach(u => {
      const wKey = (u.weapons || []).map(w => `${w.name}-${w.Range || w.range}-${w.A}-${w.skill || w.BS || w.WS}-${w.S}-${w.AP}-${w.D}`).sort().join('|');
      const aKey = (u.abilities || []).map(a => `${a.name}`).sort().join('|');
      const sKey = u.stats ? `${u.stats.M}-${u.stats.T}-${u.stats.SV}-${u.stats.INV}-${u.stats.W}-${u.stats.LD}-${u.stats.OC}` : '';
      const key = `${u.name}||${u.enhancement || ''}||${u.is_warlord ? '1' : '0'}||${sKey}||${wKey}||${aKey}`;

      if (map.has(key)) {
        const existing = map.get(key);
        existing.quantity = (existing.quantity || 1) + (u.quantity || 1);
        existing.totalPoints += (u.points || 0);
        existing._indices.push(u._idx);
      } else {
        const entry = {
          ...u,
          quantity: u.quantity || 1,
          unitPoints: u.points || 0,
          totalPoints: u.points || 0,
          _indices: [u._idx]
        };
        map.set(key, entry);
        grouped.push(entry);
      }
    });

    return grouped;
  }

  if (units.length > 0) {
    for (const [catName, rawUnits] of Object.entries(categories)) {
      if (rawUnits.length === 0) continue;
      const catUnits = groupIdenticalUnits(rawUnits);
      const totalUnitsInCat = rawUnits.length;
      const catIcon = catName.includes('Character') ? '👑' : (catName.includes('Battleline') ? '🛡️' : (catName.includes('Vehicle') ? '🚜' : (catName.includes('Mounted') ? '🚀' : '⚔️')));
      
      contentHtml += `
        <div>
          <div style="font-size:0.85rem; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:#94a3b8; margin-bottom:0.6rem; display:flex; align-items:center; gap:0.4rem;">
            <span>${catIcon}</span> ${catName} <span style="font-size:0.75rem; color:#64748b; font-weight:normal;">(${totalUnitsInCat})</span>
          </div>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(290px, 1fr)); gap:0.85rem;">
            ${catUnits.map(u => {
              const uName = u.name || 'Unit';
              const uPts = u.unitPoints || u.points || 0;
              const totalPts = u.totalPoints || uPts;
              const uQty = u.quantity || 1;
              const uCount = u.model_count || 1;
              const stats = u.stats || { M: '6"', T: 4, SV: '3+', INV: '-', W: 2, LD: '6+', OC: 1 };
              const weapons = u.weapons || [];
              const abilities = u.abilities || [];
              const rules = u.rules || [];

              const enhName = (u.enhancement_detail && u.enhancement_detail.name) || u.enhancement || '';
              const enhDetail = u.enhancement_detail || (list.available_enhancements || []).find(e => e.name && e.name.toLowerCase() === enhName.toLowerCase()) || {};
              const enhDesc = enhDetail.description || '';
              const enhCost = enhDetail.cost || enhDetail.points || (u.enhancement_pts ? `+${u.enhancement_pts} pts` : '');

              return `
                <div class="gt-unit-card" style="background:rgba(15, 23, 42, 0.9); border:1px solid ${u.is_warlord ? 'rgba(245,158,11,0.45)' : (enhName ? 'rgba(192,132,252,0.4)' : 'rgba(255,255,255,0.08)')}; border-radius:12px; padding:0.9rem; display:flex; flex-direction:column; gap:0.65rem; transition:all 0.2s;">
                  <!-- Top Row: Unit Name & Points -->
                  <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.4rem;">
                    <div style="min-width:0; flex:1;">
                      <div style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
                        ${uQty > 1 ? `
                          <span class="badge" style="background:#0284c7; color:#fff; font-size:0.75rem; font-weight:800; padding:1px 6px; border-radius:4px; font-family:var(--font-mono);">${uQty}x</span>
                        ` : (uCount > 1 ? `<span style="font-size:0.8rem; font-weight:800; color:#38bdf8; font-family:var(--font-mono);">${uCount}x</span>` : '')}
                        <b style="font-size:0.96rem; color:#fff; font-family:var(--font-mono);">${escapeHtml(uName)}</b>
                        ${u.is_warlord ? '<span class="badge" style="background:rgba(245,158,11,0.2); color:#f59e0b; font-size:0.65rem; font-weight:800; border:1px solid rgba(245,158,11,0.4); padding:0.1rem 0.35rem;">👑 WARLORD</span>' : ''}
                      </div>
                      ${enhName ? `<div style="font-size:0.75rem; color:#c084fc; font-weight:700; margin-top:0.2rem;">✨ ${escapeHtml(enhName)} ${enhCost ? `(${escapeHtml(String(enhCost))})` : ''}</div>` : ''}
                      ${(u.keywords && u.keywords.length > 0) ? `
                        <div style="display:flex; flex-wrap:wrap; gap:3px; margin-top:4px;">
                          ${u.keywords.map(k => `<span style="font-size:0.62rem; color:#94a3b8; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); padding:0px 5px; border-radius:3px;">${escapeHtml(k)}</span>`).join('')}
                        </div>
                      ` : ''}
                    </div>
                    ${totalPts > 0 ? `
                      <span class="badge" style="background:rgba(56,189,248,0.12); color:#38bdf8; font-size:0.75rem; font-weight:800; font-family:var(--font-mono); flex-shrink:0; text-align:right;">
                        ${uQty > 1 ? `${totalPts} PTS <span style="font-size:0.62rem; color:#94a3b8; font-weight:normal;">(${uPts} ea)</span>` : `${totalPts} PTS`}
                      </span>
                    ` : ''}
                  </div>

                  <!-- Tactical Statline Bar -->
                  <div style="display:grid; grid-template-columns:repeat(7, 1fr); background:rgba(0,0,0,0.45); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:0.4rem 0.15rem; text-align:center; font-family:var(--font-mono);">
                    <div><div style="font-size:0.6rem; color:#64748b; font-weight:700;">M</div><div style="font-size:0.8rem; color:#fff; font-weight:800;">${stats.M || '6"'}</div></div>
                    <div><div style="font-size:0.6rem; color:#64748b; font-weight:700;">T</div><div style="font-size:0.8rem; color:#fff; font-weight:800;">${stats.T || 4}</div></div>
                    <div><div style="font-size:0.6rem; color:#64748b; font-weight:700;">SV</div><div style="font-size:0.8rem; color:#fff; font-weight:800;">${stats.SV || '3+'}</div></div>
                    <div><div style="font-size:0.6rem; color:#64748b; font-weight:700;">INV</div><div style="font-size:0.8rem; color:#38bdf8; font-weight:800;">${stats.INV || '-'}</div></div>
                    <div><div style="font-size:0.6rem; color:#64748b; font-weight:700;">W</div><div style="font-size:0.8rem; color:#ef4444; font-weight:800;">${stats.W || 2}</div></div>
                    <div><div style="font-size:0.6rem; color:#64748b; font-weight:700;">LD</div><div style="font-size:0.8rem; color:#fff; font-weight:800;">${stats.LD || '6+'}</div></div>
                    <div><div style="font-size:0.6rem; color:#64748b; font-weight:700;">OC</div><div style="font-size:0.8rem; color:#10b981; font-weight:800;">${stats.OC || 1}</div></div>
                  </div>

                  <!-- Weapons Table (Mobile Responsive) -->
                  ${weapons.length > 0 ? `
                    <div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.06); border-radius:8px; overflow-x:auto; -webkit-overflow-scrolling:touch;">
                      <div style="min-width:320px;">
                        <div style="display:grid; grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr 1fr; padding:4px 8px; background:rgba(255,255,255,0.04); font-size:0.62rem; font-weight:800; color:#94a3b8; font-family:var(--font-mono); text-transform:uppercase;">
                          <div>Weapon</div><div style="text-align:center;">Rng</div><div style="text-align:center;">A</div><div style="text-align:center;">BS/WS</div><div style="text-align:center;">S</div><div style="text-align:center;">AP</div><div style="text-align:center;">D</div>
                        </div>
                        ${weapons.map(w => `
                          <div style="display:grid; grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr 1fr; padding:5px 8px; border-top:1px solid rgba(255,255,255,0.04); font-size:0.7rem; font-family:var(--font-mono); align-items:center;">
                            <div style="min-width:0;">
                              <div style="font-weight:700; color:#f8fafc; font-size:0.72rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${w.type === 'Melee' ? '⚔️' : '🔫'} ${escapeHtml(w.name)}</div>
                              ${(w.keywords && w.keywords.length > 0) ? `
                                <div style="font-size:0.6rem; color:#38bdf8; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${w.keywords.map(k => `[${escapeHtml(k)}]`).join(' ')}</div>
                              ` : ''}
                            </div>
                            <div style="text-align:center; color:#cbd5e1;">${w.range || '-'}</div>
                            <div style="text-align:center; color:#cbd5e1; font-weight:700;">${w.A || '-'}</div>
                            <div style="text-align:center; color:#38bdf8; font-weight:700;">${w.skill || '-'}</div>
                            <div style="text-align:center; color:#cbd5e1;">${w.S || '-'}</div>
                            <div style="text-align:center; color:#ef4444; font-weight:700;">${w.AP || '0'}</div>
                            <div style="text-align:center; color:#10b981; font-weight:700;">${w.D || '1'}</div>
                          </div>
                        `).join('')}
                      </div>
                    </div>
                  ` : ((u.wargear && u.wargear.length > 0) ? `
                    <div style="display:flex; flex-wrap:wrap; gap:0.25rem;">
                      ${u.wargear.map(w => `<span style="font-size:0.68rem; background:rgba(255,255,255,0.05); color:#94a3b8; border:1px solid rgba(255,255,255,0.06); padding:0.1rem 0.35rem; border-radius:4px;">${escapeHtml(w)}</span>`).join('')}
                    </div>
                  ` : '')}

                  <!-- Abilities, Enhancement Details & Rules -->
                  ${(abilities.length > 0 || rules.length > 0 || enhName) ? `
                    <div style="display:flex; flex-direction:column; gap:4px;">
                      ${rules.length > 0 ? `
                        <div style="display:flex; flex-wrap:wrap; gap:4px;">
                          ${rules.map(r => `<span style="font-size:0.62rem; font-weight:800; background:rgba(56,189,248,0.1); color:#38bdf8; border:1px solid rgba(56,189,248,0.2); padding:1px 5px; border-radius:4px;">${escapeHtml(r.name)}</span>`).join('')}
                        </div>
                      ` : ''}
                      ${enhName ? `
                        <div style="background:rgba(192,132,252,0.12); border:1px solid rgba(192,132,252,0.3); border-radius:6px; padding:6px 8px; font-size:0.7rem;">
                          <b style="color:#c084fc; font-size:0.72rem;">✨ Enhancement: ${escapeHtml(enhName)} ${enhCost ? `(${escapeHtml(String(enhCost))})` : ''}:</b>
                          ${enhDesc ? `<div style="color:#e2e8f0; line-height:1.35; margin-top:2px;">${formatWahaText(enhDesc)}</div>` : '<div style="color:#94a3b8; font-style:italic; margin-top:2px;">Detachment enhancement assigned to this character</div>'}
                        </div>
                      ` : ''}
                      ${abilities.map(ab => `
                        <div style="background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.05); border-radius:6px; padding:5px 7px; font-size:0.7rem;">
                          <b style="color:#facc15; font-size:0.72rem;">${escapeHtml(ab.name)}:</b>
                          <div style="color:#cbd5e1; line-height:1.35; margin-top:2px;">${formatWahaText(ab.description)}</div>
                        </div>
                      `).join('')}
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }
  } else if (list.raw_text) {
    contentHtml += `
      <div style="padding:1.5rem; overflow-y:auto; flex:1; font-family:var(--font-mono); font-size:0.82rem; color:#cbd5e1; white-space:pre-wrap; line-height:1.6;">
        ${escapeHtml(list.raw_text)}
      </div>
    `;
  } else {
    contentHtml += `
      <div style="padding:3rem 1rem; text-align:center; color:#94a3b8;">
        <div style="font-size:1.8rem; margin-bottom:0.5rem;">📋</div>
        <div style="font-weight:700; color:#fff; font-size:1.05rem; margin-bottom:0.35rem;">No unit datasheets found</div>
        <div style="font-size:0.82rem; color:#64748b; margin-bottom:1rem;">Click below to re-fetch and extract datasheets.</div>
        ${(list.source_url || list.raw_text || list.id) ? `
          <button onclick="window.gtRefreshRoster('${list.id}')" style="background:#0284c7; color:#fff; font-weight:800; font-size:12px; border:none; padding:8px 16px; border-radius:8px; cursor:pointer;">
            🔄 Refresh / Re-parse Roster
          </button>
        ` : ''}
      </div>
    `;
  }

  contentHtml += `</div>`;
  return contentHtml;
}

window.gtRefreshRoster = async function(listId) {
  let list = hubSavedLists.find(l => l.id === listId);
  if (!list) {
    try {
      const res = await window.api.getArmyList(listId);
      if (res && res.army_list) list = res.army_list;
    } catch(e) {}
  }
  if (!list) return;

  const parseSource = list.source_url || list.raw_text;
  if (!parseSource) {
    alert('No source URL or text available to re-parse.');
    return;
  }

  try {
    const parseRes = await window.api.parseArmyList(parseSource);
    if (parseRes && parseRes.army_list) {
      const updated = { ...list, ...parseRes.army_list, id: list.id };
      await window.api.saveArmyList(updated);
      await loadHubArmyLists();
      openViewArmyListModal(listId);
    }
  } catch(e) {
    alert('Error re-parsing list: ' + e.message);
  }
};

window.gtAdjustWounds = function(unitIdx, delta) {
  const el = document.getElementById(`wound-val-${unitIdx}`);
  if (!el) return;
  const parts = el.textContent.split('/');
  if (parts.length === 2) {
    let cur = parseInt(parts[0].trim(), 10) + delta;
    const max = parseInt(parts[1].trim(), 10);
    cur = Math.max(0, Math.min(max, cur));
    el.textContent = `${cur} / ${max}`;
    if (cur === 0) {
      window.gtToggleSlain(unitIdx, true);
    }
  }
};

window.gtToggleSlain = function(unitIdx, forceSlain = null) {
  const card = document.getElementById(`unit-card-${unitIdx}`);
  const btn = document.getElementById(`slain-btn-${unitIdx}`);
  if (!card || !btn) return;
  const isSlain = forceSlain !== null ? forceSlain : !btn.textContent.includes('SLAIN');
  if (isSlain) {
    card.style.opacity = '0.45';
    btn.textContent = '💀 SLAIN';
    btn.style.background = 'rgba(239,68,68,0.2)';
    btn.style.borderColor = 'rgba(239,68,68,0.5)';
    btn.style.color = '#ef4444';
  } else {
    card.style.opacity = '1';
    btn.textContent = '⚔️ ACTIVE';
    btn.style.background = 'rgba(255,255,255,0.04)';
    btn.style.borderColor = 'rgba(255,255,255,0.1)';
    btn.style.color = '#94a3b8';
  }
};

async function openViewArmyListModal(listId, mode = null) {
  let list = (hubSavedLists || []).find(l => l.id === listId);
  if (!list || !list.units || list.units.length === 0) {
    try {
      const res = await window.api.getArmyList(listId);
      if (res && res.army_list) list = res.army_list;
    } catch(e) {}
  }
  if (!list) {
    alert('List not found');
    return;
  }

  const activeMode = mode || window.hubCurrentViewMode || 'enriched';
  window.hubCurrentViewMode = activeMode;

  // Auto-heal if list is missing units and has a source_url or raw_text
  if ((!list.units || list.units.length === 0) && (list.source_url || list.raw_text)) {
    try {
      const parseSource = list.source_url || list.raw_text;
      const parseRes = await window.api.parseArmyList(parseSource);
      if (parseRes && parseRes.army_list && parseRes.army_list.units && parseRes.army_list.units.length > 0) {
        list = { ...list, ...parseRes.army_list, id: list.id };
        await window.api.saveArmyList(list);
        await loadHubArmyLists();
      }
    } catch(err) {
      console.warn('Auto re-parsing on view:', err);
    }
  }

  let modal = document.getElementById('hub-view-armylist-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'hub-view-armylist-modal';
    modal.style.cssText = 'position:fixed; inset:0; z-index:100000; display:flex; align-items:center; justify-content:center; background:rgba(3,7,18,0.88); backdrop-filter:blur(8px); padding:16px;';
    document.body.appendChild(modal);
  }

  const units = list.units || [];
  const warlord = list.warlord || '';
  const bodyHtml = renderNativeRosterViewer(list, { mode: activeMode });

  modal.innerHTML = `
    <div style="background:#0b1120; border:1px solid rgba(56,189,248,0.3); border-radius:16px; width:100%; max-width:1100px; height:88vh; display:flex; flex-direction:column; overflow:hidden; font-family:'Inter',system-ui,sans-serif; color:#f8fafc; box-shadow:0 30px 80px rgba(0,0,0,0.9);">
      <!-- Header -->
      <div style="padding:12px 20px; background:#0f172a; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <div style="font-size:17px; font-weight:900; color:#fff; font-family:var(--font-mono);">${escapeHtml(list.name || 'Army Roster')}</div>
          <div style="font-size:12px; color:#38bdf8; font-weight:700; margin-top:2px;">
            ${escapeHtml(list.faction || '40k')} • <span style="color:#a855f7;">${escapeHtml(list.detachment || 'Core Detachment')}</span> • <span style="color:#f59e0b;">${list.points || 2000} PTS</span>
            ${warlord ? ` • <span style="color:#facc15;">👑 ${escapeHtml(warlord)}</span>` : ''}
          </div>
        </div>

        <!-- Mode Toggle Segmented Control -->
        <div style="display:flex; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:3px; gap:4px;">
          <button onclick="setHubRosterViewMode('enriched', '${list.id}')" style="background:${activeMode==='enriched'?'#0284c7':'transparent'}; color:${activeMode==='enriched'?'#fff':'#94a3b8'}; border:none; padding:5px 12px; border-radius:6px; font-weight:800; font-size:11px; cursor:pointer; display:flex; align-items:center; gap:5px;">
            ⚡ Enriched Datasheets
          </button>
          <button onclick="setHubRosterViewMode('text', '${list.id}')" style="background:${activeMode==='text'?'#0284c7':'transparent'}; color:${activeMode==='text'?'#fff':'#94a3b8'}; border:none; padding:5px 12px; border-radius:6px; font-weight:800; font-size:11px; cursor:pointer; display:flex; align-items:center; gap:5px;">
            📄 Raw Roster Text
          </button>
        </div>

        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <button onclick="launchTrackerWithList('${list.id}')" style="background:#10b981; color:#0f172a; font-weight:800; font-size:12px; border:none; padding:6px 14px; border-radius:6px; cursor:pointer;">
            ⚔️ Play in Tracker
          </button>
          <button onclick="deleteHubArmyList('${list.id}', true)" style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3); font-weight:800; font-size:12px; padding:6px 12px; border-radius:6px; cursor:pointer;">
            🗑️ Delete
          </button>
          <button onclick="closeViewArmyListModal()" style="background:transparent; border:none; color:#94a3b8; font-size:22px; cursor:pointer; padding:4px 8px;">✕</button>
        </div>
      </div>

      <!-- Native Roster Viewer Body -->
      ${bodyHtml}
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

function discardTrackerSession(matchId) {
  if (!matchId) return;
  if (!confirm('Are you sure you want to discard this unfinished session? (Will not count towards your Elo or battle record)')) return;

  // 1. Instant 0ms Optimistic UI removal from DOM
  const cards = document.querySelectorAll(`[onclick*="${matchId}"]`);
  cards.forEach(c => {
    const parentRow = c.closest('div[style*="background"], tr');
    if (parentRow) {
      parentRow.remove();
    }
  });

  // 2. In-memory data update (so re-renders or tabs will not bring it back)
  if (window.myHubData) {
    if (window.myHubData.active_sessions) {
      window.myHubData.active_sessions = window.myHubData.active_sessions.filter(m => (m.match_id || m.id) !== matchId);
    }
    if (window.myHubData.primary_active && (window.myHubData.primary_active.match_id === matchId || window.myHubData.primary_active.id === matchId)) {
      window.myHubData.primary_active = (window.myHubData.active_sessions && window.myHubData.active_sessions.length > 0) ? window.myHubData.active_sessions[0] : null;
    }
    if (window.myHubData.completed_history) {
      window.myHubData.completed_history = window.myHubData.completed_history.filter(m => (m.match_id || m.id) !== matchId);
    }
    if (window.myHubData.tracker_history) {
      window.myHubData.tracker_history = window.myHubData.tracker_history.filter(m => (m.match_id || m.id) !== matchId);
    }
  }

  // 3. Cache hidden match ID immediately in localStorage
  try {
    let hidden = JSON.parse(localStorage.getItem('gt-hidden-matches') || '[]');
    if (!hidden.includes(matchId)) {
      hidden.push(matchId);
      localStorage.setItem('gt-hidden-matches', JSON.stringify(hidden));
    }
    let localCache = JSON.parse(localStorage.getItem('gdm-11e-tracker-history') || '[]');
    localCache = localCache.filter(item => (item.match_id || item.id) !== matchId);
    localStorage.setItem('gdm-11e-tracker-history', JSON.stringify(localCache));
  } catch(e) {}

  // 4. Direct Firestore SDK deletion if loaded
  if (typeof firebase !== 'undefined' && firebase.firestore) {
    try {
      const db = firebase.firestore();
      db.collection('rooms').doc(matchId).delete();
    } catch(e) {}
  }

  // 5. Background server-side discard (non-blocking)
  try {
    const token = window.api ? window.api.getAuthToken() : null;
    fetch(`/api/tracker/room/${encodeURIComponent(matchId)}/discard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ token: token, match_id: matchId })
    }).catch(() => {});
  } catch(e) {}
}

window.loadHubArmyLists = loadHubArmyLists;
window.openImportArmyListModal = openImportArmyListModal;
window.closeImportArmyListModal = closeImportArmyListModal;
window.handleHubParseAndSaveText = handleHubParseAndSaveText;
window.openViewArmyListModal = openViewArmyListModal;
window.closeViewArmyListModal = closeViewArmyListModal;
window.exportArmyListToBcp = exportArmyListToBcp;
window.deleteHubArmyList = deleteHubArmyList;
window.launchTrackerWithList = launchTrackerWithList;
window.discardTrackerSession = discardTrackerSession;
