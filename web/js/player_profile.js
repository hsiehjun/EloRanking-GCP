/* ==========================================================================
   PLAYER_PROFILE.JS - Dedicated Public Player Profile View & Tournament Journey
   ========================================================================== */

let currentProfilePlayerId = null;
let currentProfileData = null;
let previousTabBeforeProfile = 'leaderboard';

/**
 * Open the dedicated, full-screen player profile page
 */
async function openPlayerProfilePage(playerId, gameSystem = '', options = {}) {
  if (!playerId) return;

  const targetSys = (gameSystem || (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k')).toLowerCase();
  if (typeof currentGameSystem !== 'undefined' && targetSys !== currentGameSystem) {
    if (typeof applyGameSystem === 'function') {
      applyGameSystem(targetSys, false);
    }
  }

  // Remember previous tab to return cleanly on back navigation
  if (typeof activeTab !== 'undefined' && activeTab !== 'player-profile') {
    previousTabBeforeProfile = activeTab;
  }

  currentProfilePlayerId = String(playerId).trim();

  // Switch view to player-profile tab
  if (typeof switchTab === 'function') {
    switchTab('player-profile');
  } else {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById('tab-player-profile');
    if (panel) {
      panel.style.display = 'block';
      panel.classList.add('active');
    }
  }

  // Update URL hash without re-triggering hashchange loop
  const cleanPath = (targetSys === 'aos') ? '/aos' : '';
  const targetHash = `#/${targetSys}/player/${encodeURIComponent(currentProfilePlayerId)}`;
  if (window.history && window.history.pushState && !options.replaceUrl) {
    window.history.pushState({ playerId: currentProfilePlayerId, sys: targetSys }, '', `${cleanPath || ''}${targetHash}`);
  } else if (window.history && window.history.replaceState) {
    window.history.replaceState({ playerId: currentProfilePlayerId, sys: targetSys }, '', `${cleanPath || ''}${targetHash}`);
  }

  const container = document.getElementById('player-profile-container');
  if (container) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 4rem 1rem;">
        <div class="spinner"></div>
        <div style="margin-top: 1rem; font-weight: 600; color: var(--text-secondary);">
          Loading ${targetSys === 'aos' ? 'AoS' : '40K'} competitive profile...
        </div>
      </div>
    `;
  }

  try {
    const data = await window.api.getPlayerProfile(currentProfilePlayerId, targetSys);
    if (!data || data.error) {
      throw new Error(data?.error || 'Player profile not found');
    }
    currentProfileData = data;
    renderDedicatedPlayerProfile(data, targetSys);
  } catch (err) {
    if (container) {
      container.innerHTML = `
        <div class="profile-nav-bar">
          <button type="button" class="btn-profile-back" onclick="navigateBackFromProfile()">
            ← Back to Leaderboard
          </button>
        </div>
        <div class="empty-state" style="padding: 3rem 1rem; color: var(--loss);">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
          <div style="font-weight: 700; font-size: 1.1rem; margin-bottom: 0.5rem;">Unable to load profile</div>
          <p style="color: var(--text-muted); font-size: 0.85rem; max-width: 420px; margin: 0 auto 1.25rem;">
            ${escapeHtml(err.message)}
          </p>
          <button class="btn btn-outline" onclick="openPlayerProfilePage('${escapeHtml(currentProfilePlayerId)}', '${targetSys}')">
            🔄 Retry
          </button>
        </div>
      `;
    }
  }
}

/**
 * Render the dedicated profile UI
 */
function renderDedicatedPlayerProfile(data, gameSystem) {
  const container = document.getElementById('player-profile-container');
  if (!container) return;

  const p = data.player || data || {};
  const sys = (gameSystem || '40k').toLowerCase();
  const sysLabel = (sys === 'aos') ? 'Age of Sigmar' : 'Warhammer 40,000';
  const sysIcon = (sys === 'aos') ? '⚡' : '⚔️';

  const playerName = (p.player_name && p.player_name !== 'Unknown') ? p.player_name : (p.full_name || 'Player Profile');
  const currentElo = Number(p.current_elo || 1500);
  const peakElo = Number(p.peak_elo || p.current_elo || 1500);
  const totalMatches = Number(p.total_matches || p.matches_played || (p.wins + p.losses + (p.draws || 0)) || 0);
  const wins = Number(p.wins || 0);
  const losses = Number(p.losses || 0);
  const draws = Number(p.draws || 0);
  const winRate = p.win_rate !== undefined ? Number(p.win_rate).toFixed(1) : (totalMatches > 0 ? ((wins / totalMatches) * 100).toFixed(1) : '0.0');
  const streak = data.longest_win_streak || data.max_streak || data.current_streak || 0;
  const currentStreak = data.current_streak || 0;

  // Tier Engine
  const tier = (typeof getEloTier === 'function') ? getEloTier(currentElo, totalMatches, sys) : {
    name: 'Competitor',
    shortName: 'Competitor',
    icon: '⚔️',
    badgeClass: 'elo-silver',
    themeClass: 'profile-theme-battle-brother',
    progressPercent: 50,
    accentColor: '#38bdf8'
  };

  const peakTier = (typeof getEloTier === 'function') ? getEloTier(peakElo, totalMatches, sys) : tier;

  // Team
  const teamName = (p.team && p.team.trim()) ? p.team.trim() : (data.teams_history && data.teams_history[0] ? data.teams_history[0] : '');

  // Primary Faction
  const factionsList = Array.isArray(data.factions_breakdown) && data.factions_breakdown.length > 0
    ? data.factions_breakdown
    : (p.top_faction ? [{ faction: p.top_faction, matches: totalMatches }] : []);
  const mainFaction = factionsList.length > 0 ? factionsList[0].faction : (p.top_faction || 'Various');

  // Match History
  const rawHistory = Array.isArray(data.history) ? data.history : (data.win_path || []);

  // Group matches by Event
  const eventMap = new Map();
  rawHistory.forEach(m => {
    const evName = (m.event_name || 'Tournament Event').trim();
    if (!eventMap.has(evName)) {
      eventMap.set(evName, {
        event_name: evName,
        event_id: m.event_id,
        date: m.match_date ? String(m.match_date).slice(0, 10) : '',
        faction: m.player_faction || '',
        rounds: [],
        wins: 0,
        losses: 0,
        draws: 0,
        totalEloDelta: 0
      });
    }
    const ev = eventMap.get(evName);
    ev.rounds.push(m);
    if (m.result === 'W') ev.wins++;
    else if (m.result === 'L') ev.losses++;
    else if (m.result === 'D') ev.draws++;
    ev.totalEloDelta += Number(m.delta_elo || 0);
    if (!ev.faction && m.player_faction) ev.faction = m.player_faction;
    if (!ev.date && m.match_date) ev.date = String(m.match_date).slice(0, 10);
  });

  const eventsList = Array.from(eventMap.values());

  // Recent Form (last 5 matches)
  const recentMatches = rawHistory.slice(0, 5);

  // Check H2H with logged in user
  let h2hHtml = '';
  const currentLoggedInUser = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  if (currentLoggedInUser && currentLoggedInUser.player_id && currentLoggedInUser.player_id !== currentProfilePlayerId) {
    let userWinsVsProfile = 0;
    let userLossesVsProfile = 0;
    let userDrawsVsProfile = 0;
    let hasH2h = false;

    rawHistory.forEach(m => {
      const oppId = m.opponent_id;
      const oppName = (m.opponent_name || '').toLowerCase();
      const currentUserName = (currentLoggedInUser.display_name || currentLoggedInUser.player_name || '').toLowerCase();
      
      if (oppId === currentLoggedInUser.player_id || (currentUserName && oppName.includes(currentUserName))) {
        hasH2h = true;
        if (m.result === 'W') userLossesVsProfile++;
        else if (m.result === 'L') userWinsVsProfile++;
        else userDrawsVsProfile++;
      }
    });

    if (hasH2h) {
      h2hHtml = `
        <div class="profile-h2h-card">
          <div>
            <div class="profile-h2h-title">⚔️ Your Record vs ${escapeHtml(playerName)}</div>
            <div class="profile-h2h-sub">
              You: <span style="color:var(--win); font-weight:700;">${userWinsVsProfile}W</span> - 
              <span style="color:var(--loss); font-weight:700;">${userLossesVsProfile}L</span>
              ${userDrawsVsProfile > 0 ? ` - <span style="color:var(--draw); font-weight:700;">${userDrawsVsProfile}D</span>` : ''}
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" onclick="openPredictorWithPlayers('${escapeHtml(currentLoggedInUser.player_id)}', '${escapeHtml(currentProfilePlayerId)}')">
            ⚔️ Simulate Next Match in Predictor ↗
          </button>
        </div>
      `;
    }
  }

  // Build Milestone XP Bar or Calibration Bar
  let xpSectionHtml = '';
  if (tier.isUncalibrated) {
    xpSectionHtml = `
      <div class="profile-xp-section">
        <div class="profile-xp-header">
          <span>🎯 Calibration Status: ${tier.matchesPlayed} of 5 Matches Completed</span>
          <span style="font-family: var(--font-mono); color: var(--accent);">${tier.progressPercent}%</span>
        </div>
        <div class="profile-xp-track">
          <div class="profile-xp-fill" style="width: ${tier.progressPercent}%;"></div>
        </div>
        <div class="profile-xp-footer">
          <span>Play ${tier.matchesNeeded} more tournament match${tier.matchesNeeded === 1 ? '' : 'es'} to calibrate official rank</span>
          <span>Target: Veteran (1500.0)</span>
        </div>
      </div>
    `;
  } else if (tier.isApex) {
    xpSectionHtml = `
      <div class="profile-xp-section">
        <div class="profile-xp-header">
          <span>👑 Everchosen Apex Milestone</span>
          <span style="color: #fbbf24; font-weight: 700;">Rank Pinnacle Achieved</span>
        </div>
        <div class="profile-xp-track">
          <div class="profile-xp-fill" style="width: 100%;"></div>
        </div>
        <div class="profile-xp-footer">
          <span>2400.0+ Top Tier Bracket</span>
          <span>Sovereign Mastery</span>
        </div>
      </div>
    `;
  } else if (tier.nextTier) {
    xpSectionHtml = `
      <div class="profile-xp-section">
        <div class="profile-xp-header">
          <span>Progress to Next Tier: <strong style="color:#fff;">${escapeHtml(tier.nextTier.name)}</strong></span>
          <span style="font-family: var(--font-mono); color: var(--accent);">${tier.nextTier.ptsNeeded} pts needed</span>
        </div>
        <div class="profile-xp-track">
          <div class="profile-xp-fill" style="width: ${tier.progressPercent}%;"></div>
        </div>
        <div class="profile-xp-footer">
          <span>${tier.minElo}.0</span>
          <span>${tier.nextTier.targetElo}.0 (${tier.progressPercent}%)</span>
        </div>
      </div>
    `;
  }

  // Recent Form Beads
  let recentFormHtml = '';
  if (recentMatches.length > 0) {
    const beads = recentMatches.map(m => {
      const res = m.result === 'W' ? 'form-win' : (m.result === 'L' ? 'form-loss' : 'form-draw');
      const score = m.player_score !== undefined && m.opponent_score !== undefined ? `${m.player_score}-${m.opponent_score}` : m.result;
      const tooltip = `vs ${escapeHtml(m.opponent_name || 'Opponent')} (${m.event_name || 'Event'})`;
      return `<span class="form-bead ${res}" title="${tooltip}">${m.result} ${score}</span>`;
    }).join('');

    recentFormHtml = `
      <div class="profile-recent-form">
        <span style="font-size: 0.76rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em; margin-right: 0.25rem;">
          Recent Form:
        </span>
        ${beads}
        ${currentStreak >= 3 ? `<span style="font-size: 0.78rem; font-weight: 700; color: #fb923c; margin-left: 0.4rem;">🔥 ${currentStreak}-Match Streak</span>` : ''}
      </div>
    `;
  }

  // Build Tournament Journey Accordion
  let eventsHtml = '';
  if (eventsList.length === 0) {
    eventsHtml = `
      <div class="empty-state" style="padding: 2.5rem 1rem;">
        <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">📜</div>
        <div style="font-weight: 600; color: var(--text-secondary);">No recorded tournament matches in ${sysLabel}</div>
      </div>
    `;
  } else {
    eventsHtml = eventsList.map((ev, idx) => {
      const isExpanded = false;
      const recordStr = `${ev.wins}W - ${ev.losses}L${ev.draws > 0 ? ` - ${ev.draws}D` : ''}`;
      const isFlawless = (ev.losses === 0 && ev.wins >= 3);
      const eloDelta = ev.totalEloDelta;
      const eloSign = eloDelta > 0 ? `+${eloDelta.toFixed(1)}` : eloDelta.toFixed(1);
      const eloColor = eloDelta > 0 ? 'var(--win)' : (eloDelta < 0 ? 'var(--loss)' : 'var(--text-muted)');

      const roundsRows = ev.rounds.map(r => {
        const isWin = r.result === 'W';
        const isLoss = r.result === 'L';
        const isBye = Boolean(r.is_bye || (r.opponent_name && r.opponent_name.toUpperCase() === 'BYE'));
        const resColor = isWin ? 'var(--win)' : (isLoss ? 'var(--loss)' : 'var(--draw)');
        const delta = Number(r.delta_elo || 0);
        const deltaStr = delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
        const deltaColor = delta > 0 ? 'var(--win)' : (delta < 0 ? 'var(--loss)' : 'var(--text-muted)');
        const scoreStr = (r.player_score !== undefined && r.opponent_score !== undefined) ? `${r.player_score} - ${r.opponent_score}` : '-';

        const oppBadge = !isBye && r.opponent_elo
          ? (typeof renderEloBadgePill === 'function' ? renderEloBadgePill(r.opponent_elo, null, { size: 'sm', gameSystem: sys }) : `<span class="badge">${Number(r.opponent_elo).toFixed(1)}</span>`)
          : '';

        return `
          <tr>
            <td class="col-rnd" style="font-family: var(--font-mono); font-weight: 700; color: var(--text-secondary);">R${r.round || '-'}</td>
            <td class="col-opp">
              ${isBye ? '<span class="bye-pill">🛡️ TOURNAMENT BYE</span>' : `
                <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
                  <span class="player-link" style="font-weight: 600; color: #38bdf8; cursor: pointer;" onclick="event.stopPropagation(); openPlayerModal('${escapeHtml(r.opponent_id || '')}', '${escapeHtml(r.opponent_name || 'Opponent')}')" title="Quick scout ${escapeHtml(r.opponent_name || 'Opponent')}">${escapeHtml(r.opponent_name || 'Opponent')}</span>
                  ${oppBadge}
                </div>
                ${r.opponent_faction ? `<div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 1px;">${escapeHtml(r.opponent_faction)}</div>` : ''}
              `}
            </td>
            <td class="col-res" style="font-family: var(--font-mono); font-weight: 700; color: ${resColor};">${r.result || '-'}</td>
            <td class="col-score" style="font-family: var(--font-mono); white-space: nowrap;">${scoreStr}</td>
            <td class="col-delta" style="font-family: var(--font-mono); font-weight: 700; color: ${deltaColor}; text-align: right; white-space: nowrap;">${deltaStr}</td>
          </tr>
        `;
      }).join('');

      return `
        <div class="profile-event-card ${isExpanded ? 'expanded' : ''}" id="event-card-${idx}">
          <div class="profile-event-header" onclick="toggleProfileEventCard(${idx})">
            <div class="profile-event-title-group">
              <div class="profile-event-name">
                <span>${escapeHtml(ev.event_name)}</span>
                ${isFlawless ? '<span class="badge" style="background:rgba(245,158,11,0.15); color:#fbbf24; border:1px solid rgba(245,158,11,0.3); font-size:0.68rem; margin-left:0.35rem; white-space:nowrap;">🥇 Flawless</span>' : ''}
              </div>
              <div class="profile-event-sub">
                <span>${ev.date || 'Event Record'}</span>
                ${ev.faction ? `<span>· 🛡️ ${escapeHtml(ev.faction)}</span>` : ''}
              </div>
            </div>
            <div class="profile-event-stats">
              <span style="font-family: var(--font-mono); font-weight: 700; font-size: 0.86rem; white-space: nowrap;">${recordStr}</span>
              <span style="font-family: var(--font-mono); font-weight: 800; font-size: 0.86rem; color: ${eloColor}; min-width: 50px; text-align: right; white-space: nowrap;">${eloSign}</span>
              <span class="profile-event-chevron">▼</span>
            </div>
          </div>
          <div class="profile-event-body">
            <table class="profile-rounds-table">
              <thead>
                <tr>
                  <th class="col-rnd">Rnd</th>
                  <th class="col-opp">Opponent</th>
                  <th class="col-res">Res</th>
                  <th class="col-score">Score</th>
                  <th class="col-delta" style="text-align: right;">Elo Δ</th>
                </tr>
              </thead>
              <tbody>
                ${roundsRows}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');
  }

  // Faction breakdown list
  const topFactionsHtml = factionsList.slice(0, 3).map((f, i) => {
    return `<span class="faction-pill" title="${escapeHtml(f.faction)} (${f.matches} matches)">#${i+1} ${escapeHtml(f.faction)} <strong style="color:var(--text-main); margin-left:2px;">${f.matches}G</strong></span>`;
  }).join(' ');

  container.innerHTML = `
    <!-- Dynamic Hero Banner Card -->
    <div class="profile-hero-card ${tier.themeClass || ''}">
      <div class="profile-hero-top">
        <div class="profile-identity-group">
          <div class="profile-rank-crest" title="${escapeHtml(tier.name)}">
            ${tier.icon}
          </div>
          <div class="profile-name-meta">
            <div class="profile-badges-row">
              <h1 class="profile-name-title">${escapeHtml(playerName)}</h1>
            </div>
            <div class="profile-badges-row" style="margin-top: 0.15rem;">
              ${typeof renderEloBadgePill === 'function' ? renderEloBadgePill(currentElo, totalMatches, { showTierName: true, size: 'lg', gameSystem: sys }) : `<span class="badge">${currentElo.toFixed(1)}</span>`}
              <span class="profile-standing-badge" title="All-Time Peak Rating">
                Peak: ${peakElo.toFixed(1)} 👑
              </span>
              ${teamName ? `<span class="badge" style="background:rgba(168,85,247,0.12); color:#c084fc; border:1px solid rgba(168,85,247,0.25); cursor:pointer;" onclick="openTeamModal('${escapeHtml(teamName)}')" title="Click to view ${escapeHtml(teamName)} roster">🛡️ ${escapeHtml(teamName)}</span>` : ''}
            </div>
          </div>
        </div>

        <div class="profile-hero-actions">
          <button type="button" class="btn btn-primary" onclick="openPredictorWithPlayer('${escapeHtml(currentProfilePlayerId)}')" style="font-weight: 700; font-size: 0.85rem; padding: 0.5rem 1rem;">
            ⚔️ Predict Match
          </button>
          ${data.has_account && !data.is_self ? `
            <button type="button" class="btn btn-outline" onclick="handlePlayerChatClick('${escapeHtml(currentProfilePlayerId)}', '${escapeHtml(playerName)}', '${data.account_user_id || ''}')" style="font-weight: 600; font-size: 0.85rem; padding: 0.5rem 0.9rem;">
              💬 Message
            </button>
          ` : ''}
          <button type="button" class="btn btn-outline" onclick="copyPlayerProfileLink('${escapeHtml(currentProfilePlayerId)}', '${sys}')" title="Copy shareable link to this profile" style="font-weight: 600; font-size: 0.85rem; padding: 0.5rem 0.9rem;">
            🔗 Share Profile
          </button>
        </div>
      </div>

      <!-- Milestone XP Progress Bar -->
      ${xpSectionHtml}

      <!-- Key Metrics Grid -->
      <div class="profile-metrics-grid">
        <div class="profile-metric-box">
          <div class="m-lbl">Record</div>
          <div class="m-val" style="font-size: 1.1rem;">
            <span style="color:var(--win);">${wins}W</span> - <span style="color:var(--loss);">${losses}L</span>${draws > 0 ? ` - <span style="color:var(--draw);">${draws}D</span>` : ''}
          </div>
        </div>
        <div class="profile-metric-box">
          <div class="m-lbl">Win Rate</div>
          <div class="m-val" style="color: ${Number(winRate) >= 60 ? 'var(--win)' : (Number(winRate) >= 45 ? 'var(--accent)' : '#fff')};">
            ${winRate}%
          </div>
        </div>
        <div class="profile-metric-box">
          <div class="m-lbl">Matches</div>
          <div class="m-val">${totalMatches}</div>
        </div>
        <div class="profile-metric-box">
          <div class="m-lbl">Peak Streak</div>
          <div class="m-val" style="color: var(--win);">${streak} Wins</div>
        </div>
        <div class="profile-metric-box" style="grid-column: span 2;">
          <div class="m-lbl">Top Armies</div>
          <div style="margin-top: 0.25rem; display: flex; gap: 0.35rem; justify-content: center; flex-wrap: wrap;">
            ${topFactionsHtml || '<span style="color:var(--text-muted); font-size:0.8rem;">Various</span>'}
          </div>
        </div>
      </div>

      <!-- Recent Form Beads -->
      ${recentFormHtml}
    </div>

    <!-- Optional H2H vs Viewing Player -->
    ${h2hHtml}

    <!-- Tournament Journey Accordion -->
    <div class="profile-journey-section">
      <div class="profile-journey-header">
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <h3 class="profile-journey-title">
            <span>🏆 Tournament Journey</span>
            <span class="profile-journey-count">(${eventsList.length} Event${eventsList.length === 1 ? '' : 's'})</span>
          </h3>
          <span class="profile-journey-subtitle">
            Showing official tournament match results
          </span>
        </div>
        ${eventsList.length > 0 ? `
          <button type="button" id="btn-toggle-all-events" class="btn btn-outline btn-sm" onclick="toggleAllProfileEventCards()" style="font-size: 0.76rem; padding: 0.32rem 0.75rem; border-color: rgba(56,189,248,0.35); color: #38bdf8; background: rgba(56,189,248,0.08); font-weight: 700; white-space: nowrap;">
            ▼ Expand All
          </button>
        ` : ''}
      </div>

      <div id="profile-events-accordion-container">
        ${eventsHtml}
      </div>
    </div>
  `;
}

/**
 * Toggle an individual tournament accordion in the profile view
 */
function toggleProfileEventCard(index, containerSelector = '#profile-events-accordion-container', btnId = 'btn-toggle-all-events') {
  const container = document.querySelector(containerSelector) || document;
  const cards = container.querySelectorAll('.profile-event-card');
  const card = cards[index] || container.querySelector(`#event-card-${index}`) || document.getElementById(`event-card-${index}`);
  if (card) {
    card.classList.toggle('expanded');
  }
  updateToggleAllButtonState(containerSelector, btnId);
}

/**
 * Toggle all tournament accordions (Expand All / Collapse All)
 */
function toggleAllProfileEventCards(containerSelector = '#profile-events-accordion-container', btnId = 'btn-toggle-all-events') {
  const container = document.querySelector(containerSelector) || document;
  const cards = container.querySelectorAll('.profile-event-card');
  if (!cards || cards.length === 0) return;

  const anyCollapsed = Array.from(cards).some(c => !c.classList.contains('expanded'));
  cards.forEach(c => {
    if (anyCollapsed) c.classList.add('expanded');
    else c.classList.remove('expanded');
  });
  updateToggleAllButtonState(containerSelector, btnId);
}

function updateToggleAllButtonState(containerSelector = '#profile-events-accordion-container', btnId = 'btn-toggle-all-events') {
  const container = document.querySelector(containerSelector) || document;
  const cards = container.querySelectorAll('.profile-event-card');
  const btn = document.getElementById(btnId);
  if (!btn || !cards || cards.length === 0) return;

  const allExpanded = Array.from(cards).every(c => c.classList.contains('expanded'));
  btn.innerHTML = allExpanded ? '▲ Collapse All' : '▼ Expand All';
}

/**
 * Copy public profile link to clipboard with toast notification
 */
function copyPlayerProfileLink(playerId, sys = '') {
  const targetSys = (sys || (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k')).toLowerCase();
  const sysLabel = (targetSys === 'aos') ? 'AoS' : '40K';
  const url = `${window.location.origin}/#/${targetSys}/player/${encodeURIComponent(playerId)}`;
  
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(url).then(() => showProfileToast(`✓ ${sysLabel} profile link copied to clipboard!`)).catch(() => {
      fallbackCopyText(url, sysLabel);
    });
  } else {
    fallbackCopyText(url, sysLabel);
  }
}

function fallbackCopyText(text, sysLabel = 'Profile') {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showProfileToast(`✓ ${sysLabel} link copied to clipboard!`);
  } catch (e) {
    prompt('Copy this link:', text);
  }
  document.body.removeChild(ta);
}

function showProfileToast(msg) {
  const existing = document.querySelector('.profile-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'profile-toast';
  toast.innerHTML = `<span>🔗</span><span>${escapeHtml(msg)}</span>`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

/**
 * Navigate back to previous view cleanly
 */
function navigateBackFromProfile() {
  const targetTab = previousTabBeforeProfile && previousTabBeforeProfile !== 'player-profile'
    ? previousTabBeforeProfile
    : 'leaderboard';
  if (typeof switchTab === 'function') {
    switchTab(targetTab);
  }
}

/**
 * Helper to open predictor with Logged-in Player vs Target Player pre-selected
 */
function openPredictorWithPlayer(playerId, playerName = '') {
  if (typeof closeAllModals === 'function') {
    closeAllModals();
  } else if (typeof closeModal === 'function') {
    closeModal('player-modal');
  }
  if (typeof switchTab === 'function') {
    switchTab('meta-intel');
  }
  if (typeof switchMetaSubtab === 'function') {
    switchMetaSubtab('predictor');
  }
  setTimeout(async () => {
    try {
      const activeSys = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
      const currentUserVal = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;

      // 1. Fetch Target Player data for active game system (40k or aos)
      let targetPlayer = null;
      if (currentProfileData && (currentProfileData.player_id === playerId || currentProfileData.player?.player_id === playerId) && (!currentProfileData._gameSystem || currentProfileData._gameSystem === activeSys)) {
        targetPlayer = currentProfileData.player || currentProfileData;
      } else if (playerId || playerName) {
        const res = await window.api.getPlayerProfile(playerId || 'unknown', activeSys, playerName || '');
        targetPlayer = res?.player || res;
      }

      // 2. Fetch Logged-in Player data for active game system if authenticated
      let loginPlayer = null;
      if (currentUserVal && (currentUserVal.player_id || currentUserVal.id)) {
        const pid = currentUserVal.player_id || currentUserVal.id;
        const res = await window.api.getPlayerProfile(pid, activeSys, currentUserVal.display_name || currentUserVal.player_name || '');
        loginPlayer = res?.player || res;
      }

      // 3. Populate Predictor Slots (Player 1 = Logged-In User, Player 2 = Target Player)
      if (loginPlayer && targetPlayer) {
        const p1Id = loginPlayer.player_id || loginPlayer.id;
        const p2Id = targetPlayer.player_id || targetPlayer.id || playerId;
        if (p1Id && p2Id && String(p1Id).trim() === String(p2Id).trim()) {
          // Clicking Predict on own profile: populate P1 and focus P2 input
          if (typeof selectPredictPlayer === 'function') {
            selectPredictPlayer(1, loginPlayer);
          }
          const p2Input = document.getElementById('p2-name-input');
          if (p2Input) {
            p2Input.value = '';
            p2Input.focus();
          }
        } else {
          // Standard matchup: Logged-in Player (P1) vs Target Player (P2)
          if (typeof selectPredictPlayer === 'function') {
            selectPredictPlayer(1, loginPlayer);
            selectPredictPlayer(2, targetPlayer);
          }
          if (typeof runPrediction === 'function') {
            runPrediction();
          }
        }
      } else if (targetPlayer) {
        // Guest user: populate Target Player in P2 and focus P1 input
        if (typeof selectPredictPlayer === 'function') {
          selectPredictPlayer(2, targetPlayer);
        }
        const p1Input = document.getElementById('p1-name-input');
        if (p1Input) p1Input.focus();
      }
    } catch (e) {
      console.warn('Predictor auto-populate notice:', e);
    }
  }, 100);
}

/**
 * Helper to open predictor with 2 specific players pre-selected
 */
function openPredictorWithPlayers(p1Id, p2Id) {
  if (typeof closeAllModals === 'function') {
    closeAllModals();
  } else if (typeof closeModal === 'function') {
    closeModal('player-modal');
  }
  if (typeof switchTab === 'function') {
    switchTab('meta-intel');
  }
  if (typeof switchMetaSubtab === 'function') {
    switchMetaSubtab('predictor');
  }
  setTimeout(async () => {
    try {
      const activeSys = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
      const p1Data = await window.api.getPlayerProfile(p1Id, activeSys);
      const p2Data = await window.api.getPlayerProfile(p2Id, activeSys);
      const p1 = p1Data.player || p1Data;
      const p2 = p2Data.player || p2Data;
      if (p1 && typeof selectPredictPlayer === 'function') {
        selectPredictPlayer(1, p1);
      }
      if (p2 && typeof selectPredictPlayer === 'function') {
        selectPredictPlayer(2, p2);
      }
      if (typeof runPrediction === 'function') {
        runPrediction();
      }
    } catch (e) {}
  }, 100);
}

/**
 * Called from Modal to switch to full page view
 */
function openDedicatedPlayerProfileFromModal() {
  if (typeof currentModalPlayerId !== 'undefined' && currentModalPlayerId) {
    if (typeof closeAllModals === 'function') {
      closeAllModals();
    } else if (typeof closeModal === 'function') {
      closeModal('player-modal');
    }
    openPlayerProfilePage(currentModalPlayerId);
  }
}

// Global exports
if (typeof window !== 'undefined') {
  window.openPlayerProfilePage = openPlayerProfilePage;
  window.renderDedicatedPlayerProfile = renderDedicatedPlayerProfile;
  window.toggleProfileEventCard = toggleProfileEventCard;
  window.toggleAllProfileEventCards = toggleAllProfileEventCards;
  window.copyPlayerProfileLink = copyPlayerProfileLink;
  window.navigateBackFromProfile = navigateBackFromProfile;
  window.openPredictorWithPlayer = openPredictorWithPlayer;
  window.openPredictorWithPlayers = openPredictorWithPlayers;
  window.openDedicatedPlayerProfileFromModal = openDedicatedPlayerProfileFromModal;
}
