/* ==========================================================================
   PLAYER_PROFILE.JS - Dedicated Public Player Profile View & Tournament Journey
   ========================================================================== */

var currentProfilePlayerId = null;
var currentProfileData = null;
var previousTabBeforeProfile = 'leaderboard';
if (typeof window !== 'undefined') {
  window.currentProfilePlayerId = null;
  window.currentProfileData = null;
}

/**
 * Open the dedicated, full-screen player profile page
 */
async function openPlayerProfilePage(playerId, gameSystem = '', options = {}, playerName = '') {
  if (!playerId && !playerName) return;

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

  currentProfilePlayerId = String(playerId || '').trim();

  // Switch view to player-profile tab
  if (typeof switchTab === 'function') {
    switchTab('player-profile');
  } else {
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.remove('active');
      p.style.removeProperty('display');
    });
    const panel = document.getElementById('tab-player-profile');
    if (panel) {
      panel.style.removeProperty('display');
      panel.classList.add('active');
    }
  }
  const profPanel = document.getElementById('tab-player-profile');
  if (profPanel) {
    profPanel.style.removeProperty('display');
    profPanel.classList.add('active');
  }

  // Update URL hash without re-triggering hashchange loop
  const cleanPath = (targetSys === 'aos') ? '/aos' : '';
  const targetHash = `#/${targetSys}/player/${encodeURIComponent(currentProfilePlayerId || playerName)}`;
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
    const data = await window.api.getPlayerProfile(currentProfilePlayerId || 'unknown', targetSys, playerName);
    if (!data || data.error) {
      throw new Error(data?.error || 'Player profile not found');
    }
    const p = data.player || data || {};
    const actualId = p.player_id || p.id;
    if (actualId && actualId !== currentProfilePlayerId) {
      currentProfilePlayerId = actualId;
      const targetHashActual = `#/${targetSys}/player/${encodeURIComponent(actualId)}`;
      if (window.history && window.history.replaceState) {
        window.history.replaceState({ playerId: actualId, sys: targetSys }, '', `${cleanPath || ''}${targetHashActual}`);
      }
    }
    currentProfileData = data;
    renderDedicatedPlayerProfile(data, targetSys);
  } catch (err) {
    if (container) {
      container.innerHTML = `
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

  // Match History (sorted newest first for Recent Form & Tournament Journey)
  const rawHistory = Array.isArray(data.history) ? data.history : (data.win_path || []);
  const sortedHistory = typeof sortMatchesNewestFirst === 'function'
    ? sortMatchesNewestFirst(rawHistory)
    : [...rawHistory].reverse();

  // Group matches by Event (most recent event first)
  const eventMap = new Map();
  sortedHistory.forEach(m => {
    const evKey = m.event_id || (m.event_name || 'Tournament Event').trim();
    const evName = (m.event_name || 'Tournament Event').trim();
    if (!eventMap.has(evKey)) {
      eventMap.set(evKey, {
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
    const ev = eventMap.get(evKey);
    ev.rounds.push(m);
    if (m.result === 'W') ev.wins++;
    else if (m.result === 'L') ev.losses++;
    else if (m.result === 'D') ev.draws++;
    ev.totalEloDelta += Number(m.delta_elo || 0);
    if (!ev.faction && m.player_faction) ev.faction = m.player_faction;
    if (!ev.date && m.match_date) ev.date = String(m.match_date).slice(0, 10);
  });

  const eventsList = Array.from(eventMap.values()).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // Recent Form (5 most recent matches, newest first)
  const recentMatches = sortedHistory.slice(0, 5);

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
          <span>⚔️ Next Elo Tier: <strong style="color:#fff;">${escapeHtml(tier.nextTier.name)}</strong></span>
          <span style="font-family: var(--font-mono); color: var(--accent); font-weight: 700;">${tier.nextTier.ptsNeeded} Elo needed</span>
        </div>
        <div class="profile-xp-track">
          <div class="profile-xp-fill" style="width: ${tier.progressPercent}%;"></div>
        </div>
        <div class="profile-xp-footer">
          <span>${tier.minElo}.0 Elo (${escapeHtml(tier.name)})</span>
          <span>${tier.nextTier.targetElo}.0 Elo (${escapeHtml(tier.nextTier.name)}) · ${tier.progressPercent}%</span>
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
      const isFlawless = (ev.losses === 0 && (!ev.draws || ev.draws === 0) && ev.wins >= 3);
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
            <td class="col-rnd" style="font-family: var(--font-mono); font-weight: 700; color: var(--text-secondary);">R${r.round || (ev.rounds.length - rIdx)}</td>
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
                ${ev.event_id ? `
                  <span class="player-link" style="color: #38bdf8; cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem;" onclick="event.stopPropagation(); openEventModal('${escapeHtml(ev.event_id)}')" title="Click to view Tournament Standings & Details">
                    <span>${escapeHtml(ev.event_name)}</span>
                    <span style="font-size: 0.72rem; opacity: 0.85;">↗</span>
                  </span>
                ` : `<span>${escapeHtml(ev.event_name)}</span>`}
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

  // Compute Faction Mastery & Matchup Matrix for Profile Tabs
  const profileFactionMastery = computeProfileFactionMastery(rawHistory, data.factions_breakdown);
  const profileMatchupMatrix = computeProfileMatchupMatrix(rawHistory, data.matchup_matrix);
  const totalFactionGames = profileFactionMastery.reduce((acc, f) => acc + f.games, 0);

  // Faction breakdown list for Hero Card Top Armies
  const topFactionsHtml = profileFactionMastery.slice(0, 3).map((f, i) => {
    return `<span class="faction-pill" title="${escapeHtml(f.faction)} (${f.games} matches)">#${i+1} ${escapeHtml(f.faction)} <strong style="color:var(--text-main); margin-left:2px;">${f.games}G</strong></span>`;
  }).join(' ');

  // Career net Elo delta
  const netCareerElo = currentElo - 1500;
  const netCareerEloStr = (netCareerElo >= 0 ? '+' : '') + netCareerElo.toFixed(1);

  // Resolve equipped cosmetic loadout
  const allEq = data.equipped || (data.armory_vault && data.armory_vault.equipped) || (data.is_self && window.Armory && window.Armory.getCurrentVault && window.Armory.getCurrentVault().equipped) || {};
  const playerEq = (allEq[sys] && typeof allEq[sys] === 'object') ? allEq[sys] : allEq;

  const activeFrameId = playerEq.active_card_frame;
  const frameClass = activeFrameId ? (window.Armory && typeof window.Armory.getFrameCssClass === 'function' ? window.Armory.getFrameCssClass(activeFrameId) : activeFrameId.replace(/_/g, '-')) : '';

  const activeFinishId = playerEq.active_card_finish;
  const finishClass = activeFinishId ? (window.Armory && typeof window.Armory.getFinishCssClass === 'function' ? window.Armory.getFinishCssClass(activeFinishId) : (activeFinishId === 'frame_astral_holofoil' || activeFinishId.includes('holofoil') ? 'finish-astral-holofoil' : activeFinishId.replace(/_/g, '-'))) : '';

  const activeTitleId = playerEq.active_title;
  let titleHtml = '';
  if (activeTitleId) {
    const tText = activeTitleId.replace(/^title_/, '').replace(/_/g, ' ');
    const tClass = activeTitleId.includes('warp') ? 'title-badge-warp' : (activeTitleId.includes('forge') ? 'title-badge-forge' : (activeTitleId.includes('strategist') ? 'title-badge-strategist' : 'title-badge-unbroken'));
    titleHtml = `<span class="armory-title-chip ${tClass}"><span class="title-chip-icon">🏷️</span> ${escapeHtml(tText.toUpperCase())}</span>`;
  }

  const activeAvatarId = playerEq.active_avatar;
  let avatarSigilSvg = '';
  let avatarSigilStyle = '';
  if (activeAvatarId) {
    avatarSigilSvg = typeof window.getArmoryAvatarSvg === 'function' ? window.getArmoryAvatarSvg(activeAvatarId) : '';
    avatarSigilStyle = 'border-color: #38bdf8; box-shadow: 0 0 20px rgba(56,189,248,0.35), inset 0 0 14px rgba(56,189,248,0.15);';
  }

  // Resolve tournament championships laurel badge
  const champs = data.championships || {};
  let champPillHtml = '';
  if (champs && champs.total > 0) {
    const pillText = champs.championship_pill || `🏆 ${champs.total}x Champion`;
    champPillHtml = `<span class="profile-standing-badge champ-laurel-pill" onclick="switchProfileSubtab('trophies'); setTimeout(() => { const el = document.getElementById('hall-of-champions-showcase'); if(el) el.scrollIntoView({behavior:'smooth', block:'center'}); }, 100);" title="Verified Tournament Championships (${champs.total} Titles: ${champs.major_wins || 0} Major, ${champs.gt_wins || 0} GT, ${champs.rtt_wins || 0} RTT)">${escapeHtml(pillText)}</span>`;
  }

  container.innerHTML = `
    <!-- Dynamic Hero Banner Card with Military Rank Border -->
    <div class="profile-hero-card ${tier.themeClass || ''} ${(data.rank && data.rank.css_class) || ''} ${frameClass} ${finishClass}">
      <div class="profile-hero-top">
        <div class="profile-identity-group">
          <div class="profile-rank-crest" title="${escapeHtml(tier.name)}" data-default-icon="${escapeHtml(tier.icon)}" style="${avatarSigilStyle}">
            <span class="hero-crest-default-icon" style="${avatarSigilSvg ? 'display: none;' : ''}">${tier.icon}</span>
            <span class="hero-avatar-sigil-slot" style="${avatarSigilSvg ? 'display: flex;' : 'display: none;'}">${avatarSigilSvg}</span>
          </div>
          <div class="profile-name-meta">
            <div class="profile-badges-row">
              <h1 class="profile-name-title">${escapeHtml(playerName)}</h1>
              <span class="hero-title-badge-slot" style="${titleHtml ? 'display: inline-flex;' : 'display: none;'}">${titleHtml}</span>
            </div>
            <div class="profile-badges-row" style="margin-top: 0.15rem;">
              ${typeof renderEloBadgePill === 'function' ? renderEloBadgePill(currentElo, totalMatches, { showTierName: true, size: 'lg', gameSystem: sys }) : `<span class="badge">${currentElo.toFixed(1)} Elo</span>`}
              ${Number(peakElo) <= Number(currentElo) + 0.5
                ? `<span class="profile-standing-badge" style="background:rgba(251,191,36,0.12); color:#fbbf24; border:1px solid rgba(251,191,36,0.35); font-weight:700;" title="Currently standing at all-time career peak Elo rating (${currentElo.toFixed(1)})!">All-Time Peak 👑</span>`
                : `<span class="profile-standing-badge" title="All-Time Peak Rating: ${peakElo.toFixed(1)}">Peak: ${peakElo.toFixed(1)} 👑</span>`
              }
              ${window.BadgesUI ? window.BadgesUI.renderRankBadge(data, 'switchProfileSubtab') : ''}
              ${champPillHtml}
              ${teamName ? `<span class="badge" style="background:rgba(168,85,247,0.12); color:#c084fc; border:1px solid rgba(168,85,247,0.25); cursor:pointer;" onclick="if(typeof openTeamProfilePage === 'function'){ openTeamProfilePage('${escapeHtml(teamName)}', '${sys}'); } else if(typeof openTeamModal === 'function') { openTeamModal('${escapeHtml(teamName)}'); }" title="Click to view ${escapeHtml(teamName)} hub & roster">🛡️ ${escapeHtml(teamName)}</span>` : ''}
            </div>
            ${window.BadgesUI ? window.BadgesUI.renderPinnedMedals(data.pinned_badges, data.badge_count, data.is_self, 'switchProfileSubtab') : ''}
          </div>
        </div>

        <div class="profile-hero-actions">
          <button type="button" class="btn btn-primary" onclick="openPredictorWithPlayer('${escapeHtml(currentProfilePlayerId)}')" style="font-weight: 700; font-size: 0.85rem; padding: 0.5rem 1rem;">
            ⚔️ Predict Match
          </button>
          ${!data.is_self ? `
            <button type="button" class="btn btn-outline" onclick="window.Armory && typeof window.Armory.openPokeRivalModal === 'function' ? window.Armory.openPokeRivalModal('${escapeHtml(currentProfilePlayerId)}', '${escapeHtml(playerName)}') : window.Armory.pokePlayer('${escapeHtml(currentProfilePlayerId)}', 'poke_inquisition_smite', '${escapeHtml(playerName)}')" style="font-weight: 600; font-size: 0.85rem; padding: 0.5rem 0.9rem; border-color: rgba(245, 158, 11, 0.4); color: #fbbf24;">
              👉 Poke Rival
            </button>
          ` : ''}
          ${data.has_account && !data.is_self ? `
            <button type="button" class="btn btn-outline" onclick="handlePlayerChatClick('${escapeHtml(currentProfilePlayerId)}', '${escapeHtml(playerName)}', '${data.account_user_id || ''}')" style="font-weight: 600; font-size: 0.85rem; padding: 0.5rem 0.9rem;">
              💬 Message
            </button>
          ` : ''}
          <button type="button" class="btn btn-outline" onclick="openShareProfileModal('${escapeHtml(currentProfilePlayerId)}', '${sys}')" title="Generate shareable profile picture, trading card, or share to other platforms" style="font-weight: 600; font-size: 0.85rem; padding: 0.5rem 0.9rem; border-color: rgba(56, 189, 248, 0.4); color: #38bdf8;">
            🪪 Share Profile
          </button>
        </div>
      </div>

      <!-- Collapsible Career Progression & Full Stats for Mobile -->
      ${(() => {
        const existingDrawer = document.getElementById('profile-career-details-drawer');
        const domExpanded = existingDrawer && existingDrawer.classList.contains('hub-career-drawer-expanded');
        let storedExpanded = false;
        try { storedExpanded = sessionStorage.getItem('omni_profile_career_expanded') === '1'; } catch (e) {}
        const isCareerExpanded = Boolean(window.isProfileCareerDrawerExpanded || domExpanded || storedExpanded);
        if (isCareerExpanded) window.isProfileCareerDrawerExpanded = true;
        return `
      <button type="button" id="profile-career-toggle-btn" class="hub-career-toggle-btn mobile-only" onclick="toggleProfileCareerDetails(event)" aria-expanded="${isCareerExpanded ? 'true' : 'false'}">
        <span style="display:inline-flex; align-items:center; gap:6px;">
          <span>📊</span>
          <span id="profile-career-toggle-text">${isCareerExpanded ? 'Hide Full Stats &amp; Progression' : 'Show Full Stats &amp; Progression'}</span>
        </span>
        <span id="profile-career-toggle-arrow">${isCareerExpanded ? '▲' : '▼'}</span>
      </button>

      <div id="profile-career-details-drawer" class="${isCareerExpanded ? 'hub-career-drawer-expanded' : 'hub-career-drawer-collapsed'}">
        `;
      })()}
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
    </div>

    <!-- Optional H2H vs Viewing Player -->
    ${h2hHtml}

    <!-- Desktop & Mobile Sub-Tab Navigation Bar -->
    <div class="profile-subtabs-bar" id="profile-subtabs-bar">
      <button type="button" class="profile-subtab-btn active" data-tab="journey" onclick="switchProfileSubtab('journey')">
        <span>🏆 <span class="tab-label-full">Tournament </span>Journey</span>
        <span class="profile-subtab-count">${eventsList.length}</span>
      </button>
      <button type="button" class="profile-subtab-btn" data-tab="trajectory" onclick="switchProfileSubtab('trajectory')">
        <span>📈 Elo Trajectory</span>
        <span class="profile-subtab-count">${rawHistory.length}G</span>
      </button>
      <button type="button" class="profile-subtab-btn" data-tab="factions" onclick="switchProfileSubtab('factions')">
        <span>🛡️ Faction Mastery</span>
        <span class="profile-subtab-count">${profileFactionMastery.length}</span>
      </button>
      <button type="button" class="profile-subtab-btn" data-tab="matchups" onclick="switchProfileSubtab('matchups')">
        <span>🎯 Matchup Matrix</span>
        <span class="profile-subtab-count">${profileMatchupMatrix.length}</span>
      </button>
      <button type="button" class="profile-subtab-btn" data-tab="trophies" onclick="switchProfileSubtab('trophies')">
        <span>🏆 Trophies</span>
        <span class="profile-subtab-count">${data.badge_count || 0}/${data.total_badges || 105}</span>
      </button>
    </div>

    <!-- TAB PANEL 1: Tournament Journey Accordion -->
    <div id="profile-panel-journey" class="profile-tab-panel active">
      <div class="profile-journey-section">
        <div class="profile-journey-header">
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <h3 class="profile-journey-title">
              <span>🏆 Tournament Journey</span>
              <span class="profile-journey-count">(${eventsList.length} Event${eventsList.length === 1 ? '' : 's'})</span>
            </h3>
            <span class="profile-journey-subtitle">
              Official tournament history ordered newest first • Click any event title to open Tournament Standings
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
    </div>

    <!-- TAB PANEL 2: Elo Rating Trajectory -->
    <div id="profile-panel-trajectory" class="profile-tab-panel">
      <div class="hub-card trajectory-card" style="padding: 1.25rem;">
        <div class="trajectory-header-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.75rem;">
          <div>
            <h3 style="font-size: 1.1rem; font-weight: 800; color: #fff; margin: 0;">📈 Career Elo Rating Trajectory</h3>
            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">
              Match-by-match rating progression across ${rawHistory.length} official games in ${sysLabel}
            </div>
          </div>
          <div class="trajectory-stats-row" style="display: flex; gap: 0.65rem; flex-wrap: wrap;">
            <div class="trajectory-stat-pill" style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.4rem 0.75rem;">
              <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase;">Current Elo</div>
              <div style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 800; color: #38bdf8;">${currentElo.toFixed(1)}</div>
            </div>
            <div class="trajectory-stat-pill" style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.4rem 0.75rem;">
              <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase;">All-Time Peak</div>
              <div style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 800; color: #fbbf24;">${peakElo.toFixed(1)} 👑</div>
            </div>
            <div class="trajectory-stat-pill" style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.4rem 0.75rem;">
              <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase;">Net Career Δ</div>
              <div style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 800; color: ${netCareerElo >= 0 ? 'var(--win)' : 'var(--loss)'};">${netCareerEloStr}</div>
            </div>
          </div>
        </div>
        <div class="trajectory-chart-box" style="background: rgba(10, 14, 23, 0.65); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 1rem; overflow-x: auto;">
          <svg id="profile-trajectory-svg" style="width: 100%; height: 220px; display: block;"></svg>
        </div>
        <div class="trajectory-legend-row" style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.75rem; font-size: 0.75rem; color: var(--text-muted); flex-wrap: wrap; gap: 0.5rem;">
          <span>Tap or hover any data point to inspect match details & rating delta</span>
          <div style="display: flex; align-items: center; gap: 0.85rem;">
            <span style="display: inline-flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981;"></span> Win</span>
            <span style="display: inline-flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #ef4444;"></span> Loss</span>
            <span style="display: inline-flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #38bdf8;"></span> Starting / Draw</span>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB PANEL 3: Faction Mastery -->
    <div id="profile-panel-factions" class="profile-tab-panel">
      ${renderFactionMasteryTabContent(profileFactionMastery, 'profile-faction-table', 'filterProfileFactions')}
    </div>

    <!-- TAB PANEL 4: Matchup Matrix -->
    <div id="profile-panel-matchups" class="profile-tab-panel">
      ${renderMatchupMatrixTabContent(profileMatchupMatrix, rawHistory, 'profile-matchup-table', 'filterProfileMatchups')}
    </div>

    <!-- TAB PANEL 5: Trophies & Battle Honors -->
    <div id="profile-panel-trophies" class="profile-tab-panel">
      <!-- Dynamically populated by window.BadgesUI -->
    </div>
  `;

  // Render Trajectory SVG in background so it's ready when tab is clicked
  setTimeout(() => renderProfileTrajectoryChart(rawHistory), 50);

  // Pre-render Trophies & Honors panel in background
  if (window.BadgesUI && typeof window.BadgesUI.renderTrophyRoom === 'function') {
    setTimeout(() => {
      const trEl = document.getElementById('profile-panel-trophies');
      if (trEl) {
        window.BadgesUI.renderTrophyRoom(trEl, data, !!data.is_self, currentProfilePlayerId);
      }
    }, 60);
  }

  if (window.Armory && typeof window.Armory.applyEquippedDecorations === 'function') {
    window.Armory.applyEquippedDecorations(sys, playerEq);
  }
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
function copyPlayerProfileLink(playerId, sys = '', useSmartOgUrl = true) {
  const targetSys = (sys || (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k')).toLowerCase();
  const sysLabel = (targetSys === 'aos') ? 'AoS' : '40K';
  const url = useSmartOgUrl
    ? `${window.location.origin}/p/${targetSys}/${encodeURIComponent(playerId)}`
    : `${window.location.origin}/#/${targetSys}/player/${encodeURIComponent(playerId)}`;
  
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

function showProfileToast(msg, icon = '🔗') {
  const existing = document.querySelector('.profile-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'profile-toast';
  toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(msg)}</span>`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

// ============================================================================
// 🪪 SHARE COMMANDER DOSSIER & SOCIAL CARD STUDIO (Canvas 2x Generator + Multi-Platform Share)
// ============================================================================
let _shareStudioState = {
  playerId: '',
  sys: '40k',
  data: null,
  format: 'banner', // 'banner' (1200x630) | 'story' (1080x1350) | 'avatar' (1080x1080)
  theme: 'tactical', // 'tactical' | 'auramite' | 'crimson' | 'warp' | 'emerald'
  showSparkline: true,
  showArmies: true,
  showSeal: true
};

const _SHARE_THEMES = {
  tactical: {
    id: 'tactical',
    label: '⚡ Tactical Cyan',
    bgStart: '#060a14',
    bgMid: '#0d172a',
    bgEnd: '#070b14',
    panelBg: 'rgba(13, 23, 42, 0.85)',
    panelBorder: 'rgba(56, 189, 248, 0.32)',
    accent: '#38bdf8',
    accentSecondary: '#fbbf24',
    glow: 'rgba(56, 189, 248, 0.38)',
    textSub: '#94a3b8'
  },
  auramite: {
    id: 'auramite',
    label: '👑 Imperium Gold',
    bgStart: '#120d04',
    bgMid: '#231907',
    bgEnd: '#0d0903',
    panelBg: 'rgba(30, 21, 7, 0.85)',
    panelBorder: 'rgba(245, 158, 11, 0.42)',
    accent: '#fbbf24',
    accentSecondary: '#38bdf8',
    glow: 'rgba(251, 191, 36, 0.4)',
    textSub: '#fcd34d'
  },
  crimson: {
    id: 'crimson',
    label: '🩸 Blood & Brass',
    bgStart: '#140507',
    bgMid: '#260a10',
    bgEnd: '#0d0305',
    panelBg: 'rgba(34, 9, 14, 0.85)',
    panelBorder: 'rgba(244, 63, 94, 0.42)',
    accent: '#f43f5e',
    accentSecondary: '#fbbf24',
    glow: 'rgba(244, 63, 94, 0.4)',
    textSub: '#fda4af'
  },
  warp: {
    id: 'warp',
    label: '🔮 Warp Aether',
    bgStart: '#0c0517',
    bgMid: '#1b0b30',
    bgEnd: '#080311',
    panelBg: 'rgba(24, 10, 44, 0.85)',
    panelBorder: 'rgba(168, 85, 247, 0.42)',
    accent: '#c084fc',
    accentSecondary: '#38bdf8',
    glow: 'rgba(192, 132, 252, 0.4)',
    textSub: '#d8b4fe'
  },
  emerald: {
    id: 'emerald',
    label: '❇️ Xenos Necrodermis',
    bgStart: '#03120d',
    bgMid: '#072419',
    bgEnd: '#020b08',
    panelBg: 'rgba(7, 31, 22, 0.85)',
    panelBorder: 'rgba(16, 185, 129, 0.42)',
    accent: '#10b981',
    accentSecondary: '#fbbf24',
    glow: 'rgba(16, 185, 129, 0.4)',
    textSub: '#6ee7b7'
  }
};

function _extractNormalizedShareData(rawData, fallbackPlayerId, sys) {
  const d = rawData || {};
  const p = d.player || d || {};
  const history = Array.isArray(d.history) ? d.history : (Array.isArray(d.win_path) ? d.win_path : []);
  const factionMastery = typeof computeProfileFactionMastery === 'function'
    ? computeProfileFactionMastery(history, d.faction_mastery || d.factions_breakdown)
    : (d.faction_mastery || d.factions_breakdown || []);

  const currentElo = Number(p.current_elo ?? d.current_elo ?? 1500.0);
  const peakElo = Math.max(currentElo, Number(p.peak_elo ?? d.peak_elo ?? currentElo));
  const wins = Number(p.wins ?? d.wins ?? 0);
  const losses = Number(p.losses ?? d.losses ?? 0);
  const draws = Number(p.draws ?? d.draws ?? 0);
  const totalMatches = Number(p.matches_played ?? d.matches_played ?? (wins + losses + draws));
  const winRate = totalMatches > 0 ? Number(p.win_rate ?? d.win_rate ?? ((wins / totalMatches) * 100)) : 0;

  let peakStreak = Number(d.longest_win_streak ?? p.peak_streak ?? p.streak ?? 0);
  let currentStreak = Number(d.current_streak ?? 0);
  if (history.length > 0 && !peakStreak) {
    let tmp = 0;
    history.forEach(m => {
      if (m.result === 'W') { tmp++; if (tmp > peakStreak) peakStreak = tmp; }
      else tmp = 0;
    });
  }

  let playerName = p.player_name || d.player_name || '';
  if (!playerName || playerName.toLowerCase() === 'competitor' || playerName.toLowerCase() === 'unknown') {
    if (typeof currentUser !== 'undefined' && currentUser && currentUser.display_name) {
      playerName = currentUser.display_name;
    } else {
      playerName = fallbackPlayerId || 'Commander';
    }
  }

  const playerId = p.player_id || d.player_id || fallbackPlayerId || playerName;
  const team = p.team || d.team || '';
  const topArmies = factionMastery.length > 0
    ? factionMastery.slice(0, 3).map(f => ({ name: f.faction, games: f.games, wr: Number(f.win_rate || 0) }))
    : (p.top_faction || d.top_faction
        ? String(p.top_faction || d.top_faction).split(',').slice(0, 2).map(s => ({ name: s.trim(), games: totalMatches, wr: winRate }))
        : []);

  const tier = typeof getEloTier === 'function'
    ? getEloTier(currentElo, totalMatches, sys)
    : { name: 'Veteran', shortName: 'Veteran', icon: '⚔️' };

  const allEq = d.equipped || (d.armory_vault && d.armory_vault.equipped) || (window.Armory && window.Armory.getCurrentVault && window.Armory.getCurrentVault().equipped) || {};
  const eq = (allEq[sys] && typeof allEq[sys] === 'object') ? allEq[sys] : allEq;
  const activeTitleId = eq.active_title || '';
  const activeTitleText = activeTitleId ? activeTitleId.replace(/^title_/, '').replace(/_/g, ' ').toUpperCase() : '';
  const activeAvatarId = eq.active_avatar || '';
  const avatarSvg = (activeAvatarId && typeof window.getArmoryAvatarSvg === 'function')
    ? window.getArmoryAvatarSvg(activeAvatarId)
    : '';

  const champs = d.championships || {};
  const champPill = (champs && champs.total > 0) ? (champs.championship_pill || `🏆 ${champs.total}x Champion`) : '';
  const globalRank = (d.rankings && d.rankings.global_rank) || p.rank || d.global_rank || null;
  const gloryScore = Number(d.glory_score || d.career_glory || 0);

  // Sort history chronologically for sparkline
  const chronHistory = history.slice().sort((a, b) => {
    const dA = String(a.match_date || a.event_date || '');
    const dB = String(b.match_date || b.event_date || '');
    if (dA !== dB) return dA.localeCompare(dB);
    return Number(a.round || 0) - Number(b.round || 0);
  });

  // Sort newest first for recent form beads
  const recentForm = chronHistory.slice(-8).reverse().map(m => m.result || '-');

  return {
    playerId,
    playerName,
    sys: (sys || '40k').toLowerCase(),
    sysLabel: (sys || '40k').toLowerCase() === 'aos' ? 'AGE OF SIGMAR' : 'WARHAMMER 40,000',
    sysShort: (sys || '40k').toLowerCase() === 'aos' ? 'AoS' : '40K',
    currentElo,
    peakElo,
    wins,
    losses,
    draws,
    totalMatches,
    winRate,
    peakStreak,
    currentStreak,
    team,
    topArmies,
    tier,
    activeTitleText,
    avatarSvg,
    champPill,
    globalRank,
    gloryScore,
    chronHistory,
    recentForm
  };
}

function ensureShareProfileModalDom() {
  let modal = document.getElementById('share-profile-studio-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'share-profile-studio-modal';
  modal.className = 'modal-backdrop';
  modal.setAttribute('onclick', 'if(event.target === this) closeModal("share-profile-studio-modal")');
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 920px; width: 95%; padding: 0; overflow: hidden; border: 1px solid rgba(56, 189, 248, 0.35); background: linear-gradient(165deg, #090e1a 0%, #0f172a 100%); box-shadow: 0 25px 65px rgba(0, 0, 0, 0.85);">
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.35rem; border-bottom: 1px solid rgba(255,255,255,0.08); background: rgba(6, 10, 20, 0.75);">
        <div style="display: flex; align-items: center; gap: 0.65rem;">
          <span style="font-size: 1.35rem;">🪪</span>
          <div>
            <h3 style="margin: 0; font-size: 1.08rem; font-weight: 800; color: #fff; letter-spacing: 0.02em;">Commander Dossier &amp; Social Card Studio</h3>
            <div style="font-size: 0.76rem; color: #94a3b8;">Generate a custom Profile Picture (PFP), Trading Card, or Social Banner &amp; share anywhere</div>
          </div>
        </div>
        <button type="button" class="modal-close" onclick="closeModal('share-profile-studio-modal')" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #cbd5e1; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; font-size: 1.1rem;">&times;</button>
      </div>

      <div id="share-profile-studio-body" style="padding: 1.2rem 1.35rem; max-height: 84vh; overflow-y: auto;">
        <!-- Populated dynamically -->
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

async function openShareProfileModal(playerId = '', sys = '', optionalData = null) {
  const targetSys = (sys || (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k')).toLowerCase();
  const modal = ensureShareProfileModalDom();
  const body = document.getElementById('share-profile-studio-body');

  if (typeof bringModalToFront === 'function') {
    bringModalToFront(modal);
  } else {
    modal.classList.add('active');
    modal.style.display = 'flex';
  }

  // Determine if we already have matching profile data in memory
  let sourceData = optionalData;
  if (!sourceData) {
    if (currentProfileData && (
      String(currentProfileData.player_id || '') === String(playerId) ||
      String(currentProfileData.player?.player_id || '') === String(playerId) ||
      String(currentProfilePlayerId || '') === String(playerId)
    )) {
      sourceData = currentProfileData;
    } else if (window.currentHubData && (
      String(window.currentHubData.player?.player_id || '') === String(playerId) ||
      (typeof currentUser !== 'undefined' && currentUser && String(currentUser.player_id || '') === String(playerId))
    )) {
      sourceData = window.currentHubData;
    }
  }

  if (!sourceData && playerId && window.api && typeof window.api.getPlayerProfile === 'function') {
    body.innerHTML = `
      <div style="padding: 3rem 1rem; text-align: center; color: #94a3b8;">
        <div class="spinner" style="margin: 0 auto 0.75rem;"></div>
        <div style="font-weight: 700; color: #e2e8f0;">Forging Commander Dossier &amp; High-Res Social Card...</div>
      </div>
    `;
    try {
      sourceData = await window.api.getPlayerProfile(playerId, targetSys);
    } catch (e) {
      console.warn('Could not fetch profile for share modal, using fallback:', e);
      sourceData = { player_id: playerId, player_name: playerId };
    }
  }

  const norm = _extractNormalizedShareData(sourceData, playerId, targetSys);
  _shareStudioState.playerId = norm.playerId;
  _shareStudioState.sys = targetSys;
  _shareStudioState.data = norm;

  // Auto-pick theme if player has an Armory frame/title equipped on first open
  if (!_shareStudioState._userPickedTheme) {
    if (norm.tier && norm.currentElo >= 2200) _shareStudioState.theme = 'auramite';
    else _shareStudioState.theme = 'tactical';
  }

  renderShareStudioContent();
}

function renderShareStudioContent() {
  const body = document.getElementById('share-profile-studio-body');
  if (!body || !_shareStudioState.data) return;
  const d = _shareStudioState.data;
  const shareUrl = `${window.location.origin}/p/${d.sys}/${encodeURIComponent(d.playerId)}`;
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const formatButtonsHtml = [
    { id: 'banner', icon: '🖼️', title: 'Social Banner', sub: '1200×630 • Discord / X / Reddit' },
    { id: 'story', icon: '📱', title: 'Trading Card / Story', sub: '1080×1350 • IG / TikTok / Mobile' },
    { id: 'avatar', icon: '🛡️', title: 'Square Avatar / PFP', sub: '1080×1080 • Profile Picture' }
  ].map(f => {
    const active = _shareStudioState.format === f.id;
    return `
      <button type="button" onclick="setShareProfileFormat('${f.id}')" style="flex: 1; min-width: 155px; text-align: left; padding: 0.6rem 0.8rem; border-radius: 10px; cursor: pointer; transition: all 0.15s ease; background: ${active ? 'rgba(56, 189, 248, 0.16)' : 'rgba(15, 23, 42, 0.7)'}; border: 1.5px solid ${active ? '#38bdf8' : 'rgba(255,255,255,0.1)'}; color: #fff;">
        <div style="font-weight: 800; font-size: 0.84rem; display: flex; align-items: center; gap: 0.4rem; color: ${active ? '#38bdf8' : '#f8fafc'};">
          <span>${f.icon}</span>
          <span>${f.title}</span>
        </div>
        <div style="font-size: 0.7rem; color: #94a3b8; margin-top: 2px;">${f.sub}</div>
      </button>
    `;
  }).join('');

  const themeButtonsHtml = Object.values(_SHARE_THEMES).map(t => {
    const active = _shareStudioState.theme === t.id;
    return `
      <button type="button" onclick="setShareProfileTheme('${t.id}')" style="padding: 0.38rem 0.7rem; border-radius: 999px; font-size: 0.76rem; font-weight: 700; cursor: pointer; background: ${active ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.75)'}; border: 1.5px solid ${active ? t.accent : 'rgba(255,255,255,0.12)'}; color: ${active ? '#fff' : '#cbd5e1'}; display: inline-flex; align-items: center; gap: 0.35rem;">
        <span style="width: 10px; height: 10px; border-radius: 50%; background: ${t.accent}; box-shadow: 0 0 6px ${t.accent};"></span>
        <span>${t.label}</span>
      </button>
    `;
  }).join('');

  body.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr; gap: 1rem;">
      <!-- 1. Format & Theme Selector Bar -->
      <div style="display: flex; flex-direction: column; gap: 0.75rem; background: rgba(6, 10, 19, 0.65); border: 1px solid rgba(255,255,255,0.07); border-radius: 12px; padding: 0.85rem;">
        <div style="display: flex; gap: 0.55rem; flex-wrap: wrap;">
          ${formatButtonsHtml}
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.6rem; padding-top: 0.35rem; border-top: 1px solid rgba(255,255,255,0.06);">
          <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
            <span style="font-size: 0.72rem; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-right: 0.2rem;">Theme:</span>
            ${themeButtonsHtml}
          </div>
          <div style="display: flex; align-items: center; gap: 0.65rem; font-size: 0.75rem; color: #cbd5e1;">
            ${_shareStudioState.format !== 'avatar' ? `
              <label style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
                <input type="checkbox" ${_shareStudioState.showSparkline ? 'checked' : ''} onchange="toggleShareProfileOption('showSparkline', this.checked)">
                <span>📈 Elo Graph</span>
              </label>
            ` : ''}
            <label style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
              <input type="checkbox" ${_shareStudioState.showArmies ? 'checked' : ''} onchange="toggleShareProfileOption('showArmies', this.checked)">
              <span>🛡️ Armies</span>
            </label>
          </div>
        </div>
      </div>

      <!-- 2. Live High-Resolution Canvas Preview -->
      <div style="background: radial-gradient(circle at center, rgba(30, 41, 59, 0.55) 0%, rgba(6, 10, 18, 0.92) 100%); border: 1px solid rgba(255,255,255,0.09); border-radius: 14px; padding: 1rem; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 280px;">
        <canvas id="share-profile-canvas" style="max-width: 100%; max-height: 410px; width: auto; height: auto; border-radius: 12px; box-shadow: 0 18px 45px rgba(0,0,0,0.75); border: 1px solid rgba(255,255,255,0.12);"></canvas>
        <div style="margin-top: 0.65rem; font-size: 0.74rem; color: #94a3b8; text-align: center;">
          💡 <b>Tip:</b> Copy the generated image to paste directly into Discord, Slack, Reddit, or X — or download the HD PNG to set as your Profile Picture!
        </div>
      </div>

      <!-- 3. Primary Image Export Actions -->
      <div style="display: flex; gap: 0.65rem; flex-wrap: wrap; justify-content: center;">
        ${canNativeShare ? `
          <button type="button" class="btn btn-primary" onclick="nativeShareProfileCard()" style="flex: 1; min-width: 190px; padding: 0.65rem 1rem; font-weight: 800; font-size: 0.88rem; display: inline-flex; align-items: center; justify-content: center; gap: 0.45rem; background: linear-gradient(135deg, #0284c7, #2563eb); border: none;">
            <span>📲</span> <span>Share Image + Link...</span>
          </button>
        ` : ''}
        <button type="button" class="btn btn-primary" onclick="copyShareProfileImage()" style="flex: 1; min-width: 190px; padding: 0.65rem 1rem; font-weight: 800; font-size: 0.88rem; display: inline-flex; align-items: center; justify-content: center; gap: 0.45rem;">
          <span>📋</span> <span>Copy Image to Clipboard</span>
        </button>
        <button type="button" class="btn btn-outline" onclick="downloadShareProfileImage()" style="flex: 1; min-width: 180px; padding: 0.65rem 1rem; font-weight: 800; font-size: 0.88rem; border-color: rgba(251, 191, 36, 0.45); color: #fbbf24; display: inline-flex; align-items: center; justify-content: center; gap: 0.45rem;">
          <span>⬇️</span> <span>Download HD PNG</span>
        </button>
      </div>

      <!-- 4. Share TO Other Platforms & Direct Link -->
      <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 0.9rem 1rem;">
        <div style="font-size: 0.74rem; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.6rem;">
          🚀 Share To Other Platforms (Rich Social Preview Enabled)
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap: 0.5rem; margin-bottom: 0.8rem;">
          <button type="button" class="btn btn-outline" onclick="copyShareProfileDiscordCard()" style="padding: 0.5rem 0.65rem; font-size: 0.8rem; font-weight: 700; border-color: rgba(88, 101, 242, 0.45); color: #a5b4fc; background: rgba(88, 101, 242, 0.1); display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;">
            <span>💬</span> <span>Discord / Slack</span>
          </button>
          <button type="button" class="btn btn-outline" onclick="shareProfileToPlatform('twitter')" style="padding: 0.5rem 0.65rem; font-size: 0.8rem; font-weight: 700; border-color: rgba(255, 255, 255, 0.22); color: #f8fafc; background: rgba(255, 255, 255, 0.05); display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;">
            <span>𝕏</span> <span>Post to X</span>
          </button>
          <button type="button" class="btn btn-outline" onclick="shareProfileToPlatform('reddit')" style="padding: 0.5rem 0.65rem; font-size: 0.8rem; font-weight: 700; border-color: rgba(255, 69, 0, 0.4); color: #fdba74; background: rgba(255, 69, 0, 0.1); display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;">
            <span>🤖</span> <span>Reddit</span>
          </button>
          <button type="button" class="btn btn-outline" onclick="shareProfileToPlatform('whatsapp')" style="padding: 0.5rem 0.65rem; font-size: 0.8rem; font-weight: 700; border-color: rgba(34, 197, 94, 0.4); color: #86efac; background: rgba(34, 197, 94, 0.1); display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;">
            <span>🟢</span> <span>WhatsApp</span>
          </button>
          <button type="button" class="btn btn-outline" onclick="shareProfileToPlatform('telegram')" style="padding: 0.5rem 0.65rem; font-size: 0.8rem; font-weight: 700; border-color: rgba(56, 189, 248, 0.4); color: #7dd3fc; background: rgba(56, 189, 248, 0.1); display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;">
            <span>✈️</span> <span>Telegram</span>
          </button>
          <button type="button" class="btn btn-outline" onclick="shareProfileToPlatform('facebook')" style="padding: 0.5rem 0.65rem; font-size: 0.8rem; font-weight: 700; border-color: rgba(59, 130, 246, 0.4); color: #93c5fd; background: rgba(59, 130, 246, 0.1); display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;">
            <span>📘</span> <span>Facebook</span>
          </button>
        </div>

        <!-- Direct Smart Share Link Input + Copy Button -->
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <input type="text" readonly value="${escapeHtml(shareUrl)}" onclick="this.select()" style="flex: 1; background: rgba(6, 10, 19, 0.85); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 0.48rem 0.75rem; color: #38bdf8; font-family: var(--font-mono); font-size: 0.78rem; outline: none;">
          <button type="button" class="btn btn-outline" onclick="copyPlayerProfileLink('${escapeHtml(d.playerId)}', '${escapeHtml(d.sys)}', true)" style="padding: 0.48rem 0.95rem; font-size: 0.8rem; font-weight: 800; white-space: nowrap;">
            🔗 Copy Link
          </button>
        </div>
      </div>
    </div>
  `;

  setTimeout(() => renderShareProfileCanvas(), 15);
}

function setShareProfileFormat(fmt) {
  _shareStudioState.format = fmt;
  renderShareStudioContent();
}

function setShareProfileTheme(themeId) {
  if (_SHARE_THEMES[themeId]) {
    _shareStudioState.theme = themeId;
    _shareStudioState._userPickedTheme = true;
    renderShareStudioContent();
  }
}

function toggleShareProfileOption(optKey, checked) {
  _shareStudioState[optKey] = Boolean(checked);
  renderShareProfileCanvas();
}

function _roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function _drawTacticalGridAndBg(ctx, w, h, theme) {
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, theme.bgStart);
  grad.addColorStop(0.5, theme.bgMid);
  grad.addColorStop(1, theme.bgEnd);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Radial ambient glow in upper-left and lower-right
  const rad1 = ctx.createRadialGradient(w * 0.2, h * 0.2, 10, w * 0.2, h * 0.2, w * 0.55);
  rad1.addColorStop(0, theme.glow);
  rad1.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rad1;
  ctx.fillRect(0, 0, w, h);

  // Subtle sci-fi tactical grid lines
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.028)';
  ctx.lineWidth = 1;
  const step = 48;
  for (let x = 0; x < w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();

  // Outer frame border
  ctx.save();
  _roundRectPath(ctx, 22, 22, w - 44, h - 44, 24);
  ctx.strokeStyle = theme.panelBorder;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Corner brackets
  const bLen = 28;
  const pad = 16;
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 3.5;
  // Top-left
  ctx.beginPath();
  ctx.moveTo(pad, pad + bLen); ctx.lineTo(pad, pad); ctx.lineTo(pad + bLen, pad);
  // Top-right
  ctx.moveTo(w - pad - bLen, pad); ctx.lineTo(w - pad, pad); ctx.lineTo(w - pad, pad + bLen);
  // Bottom-left
  ctx.moveTo(pad, h - pad - bLen); ctx.lineTo(pad, h - pad); ctx.lineTo(pad + bLen, h - pad);
  // Bottom-right
  ctx.moveTo(w - pad - bLen, h - pad); ctx.lineTo(w - pad, h - pad); ctx.lineTo(w - pad, h - pad - bLen);
  ctx.stroke();
  ctx.restore();
}

function _drawCrestOrSigil(ctx, cx, cy, radius, d, theme, svgImg) {
  ctx.save();
  // Outer glowing aura ring
  const aura = ctx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius * 1.25);
  aura.addColorStop(0, theme.glow);
  aura.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.25, 0, Math.PI * 2);
  ctx.fill();

  // Medallion core circle
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#090f1d';
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = theme.accent;
  ctx.stroke();

  // Inner dashed tactical ring
  ctx.beginPath();
  ctx.setLineDash([6, 5]);
  ctx.arc(cx, cy, radius - 8, 0, Math.PI * 2);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = theme.accentSecondary;
  ctx.stroke();
  ctx.setLineDash([]);

  if (svgImg) {
    const iconSize = radius * 1.32;
    ctx.drawImage(svgImg, cx - iconSize / 2, cy - iconSize / 2, iconSize, iconSize);
  } else {
    ctx.font = `${Math.round(radius * 0.95)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText((d.tier && d.tier.icon) || '⚔️', cx, cy + 3);
  }
  ctx.restore();
}

function _drawSparklinePanel(ctx, x, y, w, h, d, theme) {
  ctx.save();
  _roundRectPath(ctx, x, y, w, h, 16);
  ctx.fillStyle = theme.panelBg;
  ctx.fill();
  ctx.strokeStyle = theme.panelBorder;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '800 16px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('📈 ELO RATING TRAJECTORY', x + 22, y + 32);

  const hist = d.chronHistory || [];
  const firstPt = hist[0] || {};
  const startElo = firstPt.old_elo !== undefined && firstPt.old_elo !== null
    ? Number(firstPt.old_elo)
    : 1500.0;
  const ptsRaw = [{ elo: startElo, res: 'S' }, ...hist.slice(-35).map(m => ({ elo: Number(m.new_elo || d.currentElo), res: m.result || '-' }))];
  if (ptsRaw.length < 2) {
    ptsRaw.push({ elo: d.currentElo, res: 'W' });
  }

  const netDelta = d.currentElo - startElo;
  const netStr = `${netDelta >= 0 ? '+' : ''}${netDelta.toFixed(1)} Career Δ`;
  ctx.font = '800 15px monospace';
  ctx.textAlign = 'right';
  ctx.fillStyle = netDelta >= 0 ? '#10b981' : '#ef4444';
  ctx.fillText(netStr, x + w - 22, y + 32);

  const padL = 52;
  const padR = 22;
  const padT = 52;
  const padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const elos = ptsRaw.map(p => p.elo);
  const minE = Math.floor((Math.min(...elos) - 20) / 25) * 25;
  const maxE = Math.ceil((Math.max(...elos) + 20) / 25) * 25;
  const range = Math.max(50, maxE - minE);

  // 3 Horizontal guide lines
  [minE, Math.round((minE + maxE) / 2), maxE].forEach(val => {
    const gy = y + padT + plotH - ((val - minE) / range) * plotH;
    ctx.beginPath();
    ctx.moveTo(x + padL, gy);
    ctx.lineTo(x + w - padR, gy);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '700 12px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(String(val), x + padL - 8, gy + 4);
  });

  const coords = ptsRaw.map((pt, idx) => ({
    cx: x + padL + (idx / Math.max(1, ptsRaw.length - 1)) * plotW,
    cy: y + padT + plotH - ((pt.elo - minE) / range) * plotH,
    res: pt.res
  }));

  // Gradient fill under line
  const areaGrad = ctx.createLinearGradient(0, y + padT, 0, y + padT + plotH);
  areaGrad.addColorStop(0, theme.glow);
  areaGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.moveTo(coords[0].cx, y + padT + plotH);
  coords.forEach(c => ctx.lineTo(c.cx, c.cy));
  ctx.lineTo(coords[coords.length - 1].cx, y + padT + plotH);
  ctx.closePath();
  ctx.fillStyle = areaGrad;
  ctx.fill();

  // Trajectory polyline
  ctx.beginPath();
  coords.forEach((c, i) => {
    if (i === 0) ctx.moveTo(c.cx, c.cy);
    else ctx.lineTo(c.cx, c.cy);
  });
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 3.2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // Dots
  coords.forEach((c, i) => {
    const isLast = i === coords.length - 1;
    ctx.beginPath();
    ctx.arc(c.cx, c.cy, isLast ? 5.5 : (coords.length > 22 ? 2.5 : 3.5), 0, Math.PI * 2);
    ctx.fillStyle = c.res === 'W' ? '#10b981' : (c.res === 'L' ? '#ef4444' : theme.accent);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#070b14';
    ctx.stroke();
  });

  ctx.restore();
}

function _drawRecentFormBeads(ctx, x, y, w, d, theme) {
  const form = d.recentForm || [];
  if (form.length === 0) return;
  ctx.save();
  ctx.fillStyle = '#94a3b8';
  ctx.font = '800 13px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('RECENT FORM (NEWEST FIRST):', x, y + 20);

  let bx = x + 215;
  form.slice(0, 8).forEach(res => {
    const col = res === 'W' ? '#10b981' : (res === 'L' ? '#ef4444' : '#f59e0b');
    const bg = res === 'W' ? 'rgba(16,185,129,0.18)' : (res === 'L' ? 'rgba(239,68,68,0.18)' : 'rgba(245,158,11,0.18)');
    _roundRectPath(ctx, bx, y + 2, 28, 26, 7);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = col;
    ctx.font = '900 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(res, bx + 14, y + 20);
    bx += 34;
  });
  ctx.restore();
}

async function renderShareProfileCanvas() {
  const canvas = document.getElementById('share-profile-canvas');
  if (!canvas || !_shareStudioState.data) return;
  const d = _shareStudioState.data;
  const theme = _SHARE_THEMES[_shareStudioState.theme] || _SHARE_THEMES.tactical;
  const fmt = _shareStudioState.format || 'banner';

  // Load equipped SVG avatar sigil into an Image if present
  let svgImg = null;
  if (d.avatarSvg && d.avatarSvg.includes('<svg')) {
    svgImg = await new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      let rawSvg = d.avatarSvg;
      if (!rawSvg.includes('xmlns=')) {
        rawSvg = rawSvg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      }
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(rawSvg);
    });
  }

  const ctx = canvas.getContext('2d');
  if (fmt === 'banner') {
    canvas.width = 1200;
    canvas.height = 630;
    _renderBannerFormat(ctx, 1200, 630, d, theme, svgImg);
  } else if (fmt === 'story') {
    canvas.width = 1080;
    canvas.height = 1350;
    _renderStoryTradingCardFormat(ctx, 1080, 1350, d, theme, svgImg);
  } else {
    canvas.width = 1080;
    canvas.height = 1080;
    _renderSquareAvatarFormat(ctx, 1080, 1080, d, theme, svgImg);
  }
}

function _renderBannerFormat(ctx, w, h, d, theme, svgImg) {
  _drawTacticalGridAndBg(ctx, w, h, theme);

  // Header Bar
  ctx.fillStyle = theme.accent;
  ctx.font = '900 19px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('⚔ OMNITACTICA COMMANDER DOSSIER', 56, 68);

  // Game System Pill
  const sysText = `🛡️ ${d.sysLabel}`;
  ctx.font = '800 14px system-ui, -apple-system, sans-serif';
  const sysW = ctx.measureText(sysText).width + 36;
  _roundRectPath(ctx, w - 56 - sysW, 44, sysW, 34, 17);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.fill();
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'center';
  ctx.fillText(sysText, w - 56 - sysW / 2, 66);

  // Left Column Identity Group
  _drawCrestOrSigil(ctx, 114, 156, 54, d, theme, svgImg);

  // Commander Name
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  const nameLen = d.playerName.length;
  const nameFontPx = nameLen > 22 ? 34 : (nameLen > 16 ? 40 : 46);
  ctx.font = `900 ${nameFontPx}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(d.playerName.slice(0, 28), 188, 142);

  // Subtitle row: Rank Tier + Title + Team + Champ Pill
  const tierName = ((d.tier && d.tier.name) || 'Veteran').toUpperCase();
  let subParts = [tierName];
  if (d.activeTitleText) subParts.push(`🏷️ ${d.activeTitleText}`);
  if (d.champPill) subParts.push(d.champPill);
  else if (d.globalRank) subParts.push(`WORLD #${d.globalRank}`);
  if (d.team) subParts.push(`🛡️ ${d.team}`);

  ctx.fillStyle = theme.accentSecondary;
  ctx.font = '800 17px system-ui, -apple-system, sans-serif';
  ctx.fillText(subParts.join('  •  ').slice(0, 62), 188, 174);

  // Primary Army Subtitle
  if (_shareStudioState.showArmies && d.topArmies.length > 0) {
    const armiesStr = d.topArmies.map((a, idx) => `#${idx + 1} ${a.name} (${a.games}G · ${a.wr.toFixed(0)}% WR)`).join('   ');
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '700 15px system-ui, -apple-system, sans-serif';
    ctx.fillText(`Armies: ${armiesStr}`.slice(0, 72), 188, 202);
  }

  // Elo Rating Cards (Current Elo & All-Time Peak)
  const leftW = _shareStudioState.showSparkline ? 560 : (w - 112);
  const cardW = (leftW - 18) / 2;

  // Box 1: Current Elo
  _roundRectPath(ctx, 56, 234, cardW, 126, 16);
  ctx.fillStyle = theme.panelBg;
  ctx.fill();
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#94a3b8';
  ctx.font = '800 14px system-ui, -apple-system, sans-serif';
  ctx.fillText('CURRENT ELO RATING', 78, 266);
  ctx.fillStyle = theme.accent;
  ctx.font = '900 50px monospace';
  ctx.fillText(d.currentElo.toFixed(1), 78, 324);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '700 13px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${d.tier.icon || '⚔️'} ${tierName}`, 78, 346);

  // Box 2: Peak Elo
  const box2X = 56 + cardW + 18;
  _roundRectPath(ctx, box2X, 234, cardW, 126, 16);
  ctx.fillStyle = theme.panelBg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  ctx.fillStyle = '#94a3b8';
  ctx.font = '800 14px system-ui, -apple-system, sans-serif';
  ctx.fillText('ALL-TIME PEAK ELO 👑', box2X + 22, 266);
  ctx.fillStyle = '#fbbf24';
  ctx.font = '900 50px monospace';
  ctx.fillText(d.peakElo.toFixed(1), box2X + 22, 324);
  ctx.fillStyle = '#fde68a';
  ctx.font = '700 13px system-ui, -apple-system, sans-serif';
  ctx.fillText(d.currentElo >= d.peakElo - 0.5 ? '★ Standing at Career Peak!' : `Career High Watermark`, box2X + 22, 346);

  // 4-Box Combat Telemetry Grid
  const statY = 378;
  const statGap = 14;
  const statW = (leftW - statGap * 3) / 4;
  const stats = [
    { label: 'RECORD', val: `${d.wins}W-${d.losses}L${d.draws ? `-${d.draws}D` : ''}`, col: '#f8fafc' },
    { label: 'WIN RATE', val: `${d.winRate.toFixed(1)}%`, col: d.winRate >= 55 ? '#10b981' : theme.accent },
    { label: 'MATCHES', val: `${d.totalMatches}`, col: '#e2e8f0' },
    { label: 'PEAK STREAK', val: `🔥 ${d.peakStreak}W`, col: '#fb923c' }
  ];

  stats.forEach((st, idx) => {
    const sx = 56 + idx * (statW + statGap);
    _roundRectPath(ctx, sx, statY, statW, 104, 14);
    ctx.fillStyle = 'rgba(10, 16, 30, 0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '800 12px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(st.label, sx + 16, statY + 30);

    ctx.fillStyle = st.col;
    ctx.font = `900 ${st.val.length > 7 ? 22 : 26}px monospace`;
    ctx.fillText(st.val, sx + 16, statY + 74);
  });

  // Recent Form Strip
  _drawRecentFormBeads(ctx, 56, 502, leftW, d, theme);

  // Right Panel: Sparkline
  if (_shareStudioState.showSparkline) {
    _drawSparklinePanel(ctx, 636, 234, 508, 288, d, theme);
  }

  // Footer
  ctx.fillStyle = '#64748b';
  ctx.font = '700 15px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('omnitactica.com  •  Official Warhammer Competitive Elo Rankings & Analytics', 56, 580);

  const shortLink = `${window.location.host || 'omnitactica.com'}/p/${d.sys}/${d.playerId}`;
  ctx.fillStyle = theme.accent;
  ctx.font = '700 15px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(shortLink.slice(0, 48), w - 56, 580);
}

function _renderStoryTradingCardFormat(ctx, w, h, d, theme, svgImg) {
  _drawTacticalGridAndBg(ctx, w, h, theme);

  // Top Trading Card Header
  ctx.textAlign = 'center';
  ctx.fillStyle = theme.accent;
  ctx.font = '900 22px system-ui, -apple-system, sans-serif';
  ctx.fillText('⚔ OMNITACTICA COMMANDER TRADING CARD ⚔', w / 2, 78);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '800 16px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${d.sysLabel}  •  OFFICIAL COMPETITIVE DOSSIER`, w / 2, 108);

  // Center Medallion
  _drawCrestOrSigil(ctx, w / 2, 238, 88, d, theme, svgImg);

  // Tier Ribbon Pill overlapping bottom of medallion
  const tierName = ((d.tier && d.tier.name) || 'Veteran').toUpperCase();
  ctx.font = '900 18px system-ui, -apple-system, sans-serif';
  const tPillW = Math.max(220, ctx.measureText(tierName).width + 60);
  _roundRectPath(ctx, (w - tPillW) / 2, 308, tPillW, 40, 20);
  ctx.fillStyle = '#090f1d';
  ctx.fill();
  ctx.strokeStyle = theme.accentSecondary;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = theme.accentSecondary;
  ctx.fillText(`${d.tier.icon || '⚔️'} ${tierName}`, w / 2, 334);

  // Commander Name
  ctx.fillStyle = '#ffffff';
  const namePx = d.playerName.length > 20 ? 44 : 54;
  ctx.font = `900 ${namePx}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(d.playerName.slice(0, 26), w / 2, 408);

  // Title / Team / Laurels
  const badgesLine = [
    d.activeTitleText ? `🏷️ ${d.activeTitleText}` : '',
    d.champPill || '',
    d.team ? `🛡️ ${d.team}` : '',
    d.globalRank ? `World #${d.globalRank}` : ''
  ].filter(Boolean).join('   •   ');
  if (badgesLine) {
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '800 20px system-ui, -apple-system, sans-serif';
    ctx.fillText(badgesLine.slice(0, 56), w / 2, 446);
  }

  // Dual Elo Showcase Banner
  const boxY = 480;
  const boxW = (w - 140) / 2;
  _roundRectPath(ctx, 60, boxY, boxW, 150, 20);
  ctx.fillStyle = theme.panelBg;
  ctx.fill();
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.fillStyle = '#94a3b8';
  ctx.font = '800 16px system-ui, -apple-system, sans-serif';
  ctx.fillText('CURRENT ELO RATING', 60 + boxW / 2, boxY + 40);
  ctx.fillStyle = theme.accent;
  ctx.font = '900 64px monospace';
  ctx.fillText(d.currentElo.toFixed(1), 60 + boxW / 2, boxY + 116);

  const rBoxX = 80 + boxW;
  _roundRectPath(ctx, rBoxX, boxY, boxW, 150, 20);
  ctx.fillStyle = theme.panelBg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.fillStyle = '#94a3b8';
  ctx.font = '800 16px system-ui, -apple-system, sans-serif';
  ctx.fillText('ALL-TIME PEAK 👑', rBoxX + boxW / 2, boxY + 40);
  ctx.fillStyle = '#fbbf24';
  ctx.font = '900 64px monospace';
  ctx.fillText(d.peakElo.toFixed(1), rBoxX + boxW / 2, boxY + 116);

  // 4-Stat Telemetry Row
  const sY = 654;
  const sGap = 16;
  const sW = (w - 120 - sGap * 3) / 4;
  const stats = [
    { label: 'RECORD', val: `${d.wins}W-${d.losses}L${d.draws ? `-${d.draws}D` : ''}`, col: '#ffffff' },
    { label: 'WIN RATE', val: `${d.winRate.toFixed(1)}%`, col: '#10b981' },
    { label: 'MATCHES', val: `${d.totalMatches}`, col: '#e2e8f0' },
    { label: 'PEAK STREAK', val: `🔥 ${d.peakStreak}W`, col: '#fb923c' }
  ];
  stats.forEach((st, idx) => {
    const sx = 60 + idx * (sW + sGap);
    _roundRectPath(ctx, sx, sY, sW, 120, 16);
    ctx.fillStyle = 'rgba(10, 16, 30, 0.88)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '800 14px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(st.label, sx + sW / 2, sY + 38);

    ctx.fillStyle = st.col;
    ctx.font = '900 32px monospace';
    ctx.fillText(st.val, sx + sW / 2, sY + 88);
  });

  // Signature Armies Bar
  let nextY = 800;
  if (_shareStudioState.showArmies && d.topArmies.length > 0) {
    _roundRectPath(ctx, 60, nextY, w - 120, 74, 14);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.stroke();

    const armiesText = d.topArmies.map((a, i) => `#${i + 1} ${a.name} (${a.games}G · ${a.wr.toFixed(0)}% WR)`).join('   •   ');
    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 18px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`🛡️ ${armiesText}`.slice(0, 68), w / 2, nextY + 44);
    nextY += 96;
  }

  // Sparkline Chart
  if (_shareStudioState.showSparkline) {
    _drawSparklinePanel(ctx, 60, nextY, w - 120, 290, d, theme);
    nextY += 312;
  }

  // Recent Form
  _drawRecentFormBeads(ctx, 60, nextY, w - 120, d, theme);

  // Footer
  ctx.fillStyle = '#64748b';
  ctx.font = '800 18px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`omnitactica.com/p/${d.sys}/${d.playerId}`, w / 2, h - 48);
}

function _renderSquareAvatarFormat(ctx, w, h, d, theme, svgImg) {
  _drawTacticalGridAndBg(ctx, w, h, theme);

  const cx = w / 2;
  const cy = h / 2 - 45;

  // Safe-zone circular orbital rings (so Discord/Twitter circular PFP crops look awesome!)
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, h / 2, 490, 0, Math.PI * 2);
  ctx.strokeStyle = theme.panelBorder;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.beginPath();
  ctx.setLineDash([14, 10]);
  ctx.arc(cx, h / 2, 468, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Top Pill inside circular safe zone
  const topLabel = `⚔ OMNITACTICA • ${d.sysShort}`;
  ctx.font = '900 22px system-ui, -apple-system, sans-serif';
  const topW = ctx.measureText(topLabel).width + 54;
  _roundRectPath(ctx, cx - topW / 2, 92, topW, 48, 24);
  ctx.fillStyle = 'rgba(9, 15, 29, 0.92)';
  ctx.fill();
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = theme.accent;
  ctx.textAlign = 'center';
  ctx.fillText(topLabel, cx, 124);

  // Massive Central Faction Sigil / Rank Medallion
  _drawCrestOrSigil(ctx, cx, cy, 195, d, theme, svgImg);

  // Overlapping Armored Nameplate & Elo Banner
  const plateY = cy + 155;
  _roundRectPath(ctx, cx - 390, plateY, 780, 190, 26);
  ctx.fillStyle = 'rgba(7, 11, 22, 0.95)';
  ctx.fill();
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Commander Name
  ctx.fillStyle = '#ffffff';
  const namePx = d.playerName.length > 18 ? 44 : 54;
  ctx.font = `900 ${namePx}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(d.playerName.slice(0, 22), cx, plateY + 66);

  // Elo & Rank Tier Highlight
  const tierName = ((d.tier && d.tier.name) || 'Veteran').toUpperCase();
  ctx.fillStyle = theme.accentSecondary;
  ctx.font = '900 34px monospace';
  ctx.fillText(`${d.currentElo.toFixed(1)} ELO  •  ${tierName}`, cx, plateY + 122);

  // Win Rate + Record + Primary Army sub-ribbon
  const primaryArmy = (_shareStudioState.showArmies && d.topArmies[0]) ? `  •  🛡️ ${d.topArmies[0].name}` : '';
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '800 22px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${d.wins}W-${d.losses}L (${d.winRate.toFixed(0)}% WR)${primaryArmy}`.slice(0, 46), cx, plateY + 164);

  // Bottom Championship or Peak Badge inside circle
  const bottomBadge = d.champPill || `👑 Peak Elo: ${d.peakElo.toFixed(1)}`;
  ctx.fillStyle = '#94a3b8';
  ctx.font = '800 20px system-ui, -apple-system, sans-serif';
  ctx.fillText(bottomBadge, cx, 935);
}

function _getCanvasBlob() {
  return new Promise(resolve => {
    const canvas = document.getElementById('share-profile-canvas');
    if (!canvas) return resolve(null);
    canvas.toBlob(blob => resolve(blob), 'image/png', 1.0);
  });
}

async function downloadShareProfileImage() {
  const canvas = document.getElementById('share-profile-canvas');
  if (!canvas || !_shareStudioState.data) return;
  const d = _shareStudioState.data;
  const safeName = String(d.playerName || 'commander').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const filename = `omnitactica-${safeName}-${_shareStudioState.format}.png`;

  const blob = await _getCanvasBlob();
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  showProfileToast(`Downloaded ${filename}!`, '⬇️');
}

async function copyShareProfileImage() {
  const blob = await _getCanvasBlob();
  if (!blob) return;
  if (navigator.clipboard && typeof window.ClipboardItem !== 'undefined') {
    try {
      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);
      showProfileToast('✓ High-res Dossier Card image copied! Paste (Ctrl+V / Cmd+V) into Discord, X, or Slack.', '🖼️');
      return;
    } catch (e) {
      console.warn('Clipboard image write fallback:', e);
    }
  }
  await downloadShareProfileImage();
}

async function nativeShareProfileCard() {
  if (!_shareStudioState.data) return;
  const d = _shareStudioState.data;
  const shareUrl = `${window.location.origin}/p/${d.sys}/${encodeURIComponent(d.playerId)}`;
  const shareTitle = `${d.playerName} — ${d.currentElo.toFixed(1)} Elo (${d.tier.name}) | OmniTactica`;
  const shareText = `⚔️ ${d.playerName}'s ${d.sysLabel} Dossier: ${d.currentElo.toFixed(1)} Elo (Peak ${d.peakElo.toFixed(1)} 👑) • ${d.wins}W-${d.losses}L (${d.winRate.toFixed(1)}% WR).`;

  const blob = await _getCanvasBlob();
  if (navigator.share) {
    try {
      if (blob && navigator.canShare) {
        const safeName = String(d.playerName || 'commander').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const file = new File([blob], `omnitactica-${safeName}.png`, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title: shareTitle, text: shareText, url: shareUrl, files: [file] });
          return;
        }
      }
      await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  copyPlayerProfileLink(d.playerId, d.sys, true);
}

async function copyShareProfileDiscordCard() {
  if (!_shareStudioState.data) return;
  const d = _shareStudioState.data;
  const shareUrl = `${window.location.origin}/p/${d.sys}/${encodeURIComponent(d.playerId)}`;
  const armyStr = d.topArmies.length > 0 ? ` • 🛡️ **${d.topArmies[0].name}**` : '';
  const discordText = [
    `⚔️ **${d.playerName}** — *${d.tier.name}* (${d.sysLabel})`,
    `> 📈 **${d.currentElo.toFixed(1)} Elo** (Peak: **${d.peakElo.toFixed(1)}** 👑) • 🏆 **${d.wins}W - ${d.losses}L** (**${d.winRate.toFixed(1)}% WR**)${armyStr}`,
    `🔗 ${shareUrl}`
  ].join('\n');

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(discordText);
    showProfileToast('✓ Formatted Discord / Slack summary + preview link copied!', '💬');
  } else {
    fallbackCopyText(discordText, 'Discord summary');
  }
}

function shareProfileToPlatform(platform) {
  if (!_shareStudioState.data) return;
  const d = _shareStudioState.data;
  const shareUrl = `${window.location.origin}/p/${d.sys}/${encodeURIComponent(d.playerId)}`;
  const armyTag = d.topArmies.length > 0 ? ` playing ${d.topArmies[0].name}` : '';
  const text = `⚔️ Check out ${d.playerName}'s ${d.sysLabel} Commander Dossier on OmniTactica: ${d.currentElo.toFixed(1)} Elo (${d.tier.name}) • ${d.wins}W-${d.losses}L (${d.winRate.toFixed(1)}% WR)${armyTag}!`;

  let targetUrl = '';
  if (platform === 'twitter') {
    targetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`;
  } else if (platform === 'reddit') {
    const title = `${d.playerName} — ${d.currentElo.toFixed(1)} Elo (${d.tier.name}) | OmniTactica ${d.sysLabel} Dossier`;
    targetUrl = `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(title)}`;
  } else if (platform === 'whatsapp') {
    targetUrl = `https://wa.me/?text=${encodeURIComponent(text + ' ' + shareUrl)}`;
  } else if (platform === 'telegram') {
    targetUrl = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(text)}`;
  } else if (platform === 'facebook') {
    targetUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
  }

  if (targetUrl) {
    window.open(targetUrl, '_blank', 'noopener,noreferrer,width=680,height=620');
  }
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
  const pid = (typeof window.currentModalPlayerId !== 'undefined' && window.currentModalPlayerId) ? window.currentModalPlayerId : (typeof currentModalPlayerId !== 'undefined' ? currentModalPlayerId : '');
  const pname = (typeof window.currentModalPlayerName !== 'undefined' && window.currentModalPlayerName) ? window.currentModalPlayerName : (typeof currentModalPlayerName !== 'undefined' ? currentModalPlayerName : '');
  if (pid || pname) {
    if (typeof closeAllModals === 'function') {
      closeAllModals();
    } else if (typeof closeModal === 'function') {
      closeModal('player-modal');
    }
    openPlayerProfilePage(pid, '', {}, pname);
  }
}

/**
 * Compute Faction Mastery Breakdown from player match history
 */
function computeProfileFactionMastery(history, existingBreakdown) {
  const map = new Map();
  if (Array.isArray(history) && history.length > 0) {
    history.forEach(m => {
      if (m.is_bye || (m.opponent_name && m.opponent_name.toUpperCase() === 'BYE')) return;
      const factionName = (m.player_faction || '').trim();
      if (!factionName || factionName.toLowerCase() === 'unknown' || factionName.toLowerCase() === 'none') return;
      if (!map.has(factionName)) {
        map.set(factionName, { faction: factionName, games: 0, wins: 0, losses: 0, draws: 0, net_elo: 0, win_rate: 0 });
      }
      const item = map.get(factionName);
      item.games++;
      if (m.result === 'W') item.wins++;
      else if (m.result === 'L') item.losses++;
      else item.draws++;
      item.net_elo += Number(m.delta_elo || 0);
    });
  }

  // Merge or fallback to existingBreakdown if history had unrecorded factions
  if (Array.isArray(existingBreakdown)) {
    existingBreakdown.forEach(eb => {
      const fn = (eb.faction || '').trim();
      if (!fn || fn.toLowerCase() === 'unknown') return;
      const g = Number(eb.games || eb.matches || 0);
      const w = Number(eb.wins || 0);
      const l = Number(eb.losses || 0);
      const d = Number(eb.draws || 0);
      if (!map.has(fn)) {
        map.set(fn, {
          faction: fn,
          games: g,
          wins: w,
          losses: l,
          draws: d,
          net_elo: Number(eb.net_elo || 0),
          win_rate: g > 0 ? (w / g) * 100 : 0
        });
      } else {
        const item = map.get(fn);
        if (g > item.games) {
          item.games = g;
          item.wins = w;
          item.losses = l;
          item.draws = d;
          if (eb.net_elo !== undefined && eb.net_elo !== null) {
            item.net_elo = Number(eb.net_elo);
          }
        }
      }
    });
  }

  const list = Array.from(map.values());
  list.forEach(item => {
    item.win_rate = item.games > 0 ? (item.wins / item.games) * 100 : 0;
  });
  return list.sort((a, b) => b.games - a.games || b.win_rate - a.win_rate);
}

/**
 * Compute Opponent Matchup Matrix from player match history
 */
function computeProfileMatchupMatrix(history, existingMatrix) {
  const map = new Map();
  if (Array.isArray(history) && history.length > 0) {
    history.forEach(m => {
      if (m.is_bye || (m.opponent_name && m.opponent_name.toUpperCase() === 'BYE')) return;
      const oppFaction = (m.opponent_faction || m.enemy_faction || '').trim();
      if (!oppFaction || oppFaction.toLowerCase() === 'unknown' || oppFaction.toLowerCase() === 'none') return;
      if (!map.has(oppFaction)) {
        map.set(oppFaction, { enemy_faction: oppFaction, total_encounters: 0, wins: 0, losses: 0, draws: 0, net_elo: 0, win_rate: 0 });
      }
      const item = map.get(oppFaction);
      item.total_encounters++;
      if (m.result === 'W') item.wins++;
      else if (m.result === 'L') item.losses++;
      else item.draws++;
      item.net_elo += Number(m.delta_elo || 0);
    });
  }

  if (Array.isArray(existingMatrix)) {
    existingMatrix.forEach(em => {
      const fn = (em.enemy_faction || em.faction || '').trim();
      if (!fn || fn.toLowerCase() === 'unknown') return;
      const g = Number(em.total_encounters || em.games || 0);
      const w = Number(em.wins || 0);
      const l = Number(em.losses || 0);
      const d = Number(em.draws || 0);
      if (!map.has(fn)) {
        map.set(fn, {
          enemy_faction: fn,
          total_encounters: g,
          wins: w,
          losses: l,
          draws: d,
          net_elo: Number(em.net_elo || 0),
          win_rate: g > 0 ? (w / g) * 100 : 0
        });
      } else {
        const item = map.get(fn);
        if (g > item.total_encounters) {
          item.total_encounters = g;
          item.wins = w;
          item.losses = l;
          item.draws = d;
          if (em.net_elo !== undefined && em.net_elo !== null) {
            item.net_elo = Number(em.net_elo);
          }
        }
      }
    });
  }

  const list = Array.from(map.values());
  list.forEach(item => {
    item.win_rate = item.total_encounters > 0 ? (item.wins / item.total_encounters) * 100 : 0;
  });
  return list.sort((a, b) => b.total_encounters - a.total_encounters || b.win_rate - a.win_rate);
}

/**
 * Shared renderer for Faction Mastery tab (used by Public Player Profile & My Hub)
 */
function renderFactionMasteryTabContent(profileFactionMastery, tableId = 'profile-faction-table', filterFnName = 'filterProfileFactions') {
  const totalFactionGames = (profileFactionMastery || []).reduce((acc, f) => acc + f.games, 0);

  let factionSpotlightsHtml = '';
  if (profileFactionMastery && profileFactionMastery.length > 0) {
    const sigArmy = profileFactionMastery[0];
    const qualifiedForWr = profileFactionMastery.filter(f => f.games >= 3);
    const bestWrArmy = (qualifiedForWr.length > 0 ? qualifiedForWr : profileFactionMastery)
      .slice()
      .sort((a, b) => b.win_rate - a.win_rate || b.games - a.games)[0];
    const bestEloArmy = profileFactionMastery.slice().sort((a, b) => b.net_elo - a.net_elo)[0];

    factionSpotlightsHtml = `
      <div class="profile-spotlight-grid">
        <div class="profile-spotlight-card" style="border-left: 3px solid #38bdf8;">
          <span style="font-size: 0.7rem; font-weight: 800; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.05em;">🛡️ Signature Army</span>
          <div style="font-size: 0.95rem; font-weight: 800; color: #fff;">${escapeHtml(sigArmy.faction)}</div>
          <div style="font-size: 0.78rem; color: var(--text-secondary);">
            <b>${sigArmy.games}</b> games (${totalFactionGames > 0 ? ((sigArmy.games / totalFactionGames) * 100).toFixed(0) : 100}% share) • <span style="color:var(--win); font-weight:700;">${sigArmy.win_rate.toFixed(1)}% WR</span>
          </div>
        </div>
        ${bestWrArmy ? `
          <div class="profile-spotlight-card" style="border-left: 3px solid #10b981;">
            <span style="font-size: 0.7rem; font-weight: 800; color: #10b981; text-transform: uppercase; letter-spacing: 0.05em;">🔥 Highest Win Rate</span>
            <div style="font-size: 0.95rem; font-weight: 800; color: #fff;">${escapeHtml(bestWrArmy.faction)}</div>
            <div style="font-size: 0.78rem; color: var(--text-secondary);">
              <b style="color:var(--win);">${bestWrArmy.win_rate.toFixed(1)}% WR</b> (${bestWrArmy.wins}W - ${bestWrArmy.losses}L across ${bestWrArmy.games}G)
            </div>
          </div>
        ` : ''}
        ${bestEloArmy ? `
          <div class="profile-spotlight-card" style="border-left: 3px solid #fbbf24;">
            <span style="font-size: 0.7rem; font-weight: 800; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.05em;">📈 Net Elo Leader</span>
            <div style="font-size: 0.95rem; font-weight: 800; color: #fff;">${escapeHtml(bestEloArmy.faction)}</div>
            <div style="font-size: 0.78rem; color: var(--text-secondary);">
              <b style="color:${bestEloArmy.net_elo >= 0 ? 'var(--win)' : 'var(--loss)'}; font-family:var(--font-mono);">${bestEloArmy.net_elo >= 0 ? '+' : ''}${bestEloArmy.net_elo.toFixed(1)} Elo</b> net career impact
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  return `
    <div class="hub-card" style="padding: 1.25rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h3 style="font-size: 1.1rem; font-weight: 800; color: #fff; margin: 0;">🛡️ Faction Mastery & Win Rates</h3>
          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">
            Performance breakdown across ${profileFactionMastery ? profileFactionMastery.length : 0} armies played (${totalFactionGames} games)
          </div>
        </div>
        <div style="min-width: 220px;">
          <input type="text" class="hub-search-input" placeholder="🔍 Search army played..." oninput="${filterFnName}(this.value)">
        </div>
      </div>

      ${factionSpotlightsHtml}

      ${profileFactionMastery && profileFactionMastery.length > 0 ? `
        <div class="hub-table-wrapper">
          <table id="${tableId}" class="hub-table">
            <thead>
              <tr>
                <th style="width: 32%;">Army Played</th>
                <th style="width: 12%; text-align: center;">Share</th>
                <th style="width: 12%; text-align: center;">Games</th>
                <th style="width: 16%;">Record</th>
                <th style="width: 12%; text-align: right;">Net Elo</th>
                <th style="width: 16%;">Win Rate</th>
              </tr>
            </thead>
            <tbody>
              ${profileFactionMastery.map(fm => {
                const sharePct = totalFactionGames > 0 ? ((fm.games / totalFactionGames) * 100).toFixed(1) : '0.0';
                const netStr = (fm.net_elo >= 0 ? '+' : '') + fm.net_elo.toFixed(1);
                const netCol = fm.net_elo > 0 ? 'var(--win)' : (fm.net_elo < 0 ? 'var(--loss)' : 'var(--text-muted)');
                return `
                  <tr data-faction="${escapeHtml(fm.faction)}">
                    <td class="cell-ellipsis" title="${escapeHtml(fm.faction)}"><b style="color: #fff;">${escapeHtml(fm.faction)}</b></td>
                    <td style="text-align: center; font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-muted);">${sharePct}%</td>
                    <td style="text-align: center; font-family: var(--font-mono); font-weight: 700;">${fm.games}</td>
                    <td style="font-size: 0.8rem;">
                      <span style="color:var(--win); font-weight:700;">${fm.wins}W</span> - <span style="color:var(--loss); font-weight:700;">${fm.losses}L</span>${fm.draws > 0 ? ` - <span style="color:var(--draw);">${fm.draws}D</span>` : ''}
                    </td>
                    <td style="text-align: right; font-family: var(--font-mono); font-weight: 700; color: ${netCol};">${netStr}</td>
                    <td>
                      <div style="display:flex; align-items:center; gap:0.45rem;">
                        <div style="flex:1; background:rgba(255,255,255,0.08); height:6px; border-radius:3px; overflow:hidden;">
                          <div style="width:${Math.min(100, Number(fm.win_rate))}%; background:${Number(fm.win_rate) >= 50 ? 'var(--win)' : 'var(--loss)'}; height:100%;"></div>
                        </div>
                        <b style="font-size:0.8rem; font-family:var(--font-mono); min-width: 42px; text-align: right;">${Number(fm.win_rate).toFixed(1)}%</b>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : `<div class="empty-state" style="padding: 2rem;">No faction data recorded for this player.</div>`}
    </div>
  `;
}

/**
 * Shared renderer for Opponent Matchup Matrix tab (used by Public Player Profile & My Hub)
 */
function renderMatchupMatrixTabContent(profileMatchupMatrix, rawHistory = [], tableId = 'profile-matchup-table', filterFnName = 'filterProfileMatchups') {
  let matchupSpotlightsHtml = '';
  if (profileMatchupMatrix && profileMatchupMatrix.length > 0) {
    // Sort by highest Net Elo (+ Elo) for Favorite Prey
    const sortedByBestElo = profileMatchupMatrix.slice().sort((a, b) => {
      const eloDiff = Number(b.net_elo || 0) - Number(a.net_elo || 0);
      if (Math.abs(eloDiff) > 0.01) return eloDiff;
      return (Number(b.wins || 0) - Number(a.wins || 0)) || (Number(b.win_rate || 0) - Number(a.win_rate || 0));
    });
    const preyArmy = sortedByBestElo[0];

    // Sort by lowest Net Elo (- Elo) for Toughest Nemesis (exclude preyArmy if multiple armies exist)
    const nemesisPool = profileMatchupMatrix.length > 1
      ? profileMatchupMatrix.filter(m => m.enemy_faction !== preyArmy.enemy_faction)
      : profileMatchupMatrix.slice();
    const sortedByWorstElo = nemesisPool.sort((a, b) => {
      const eloDiff = Number(a.net_elo || 0) - Number(b.net_elo || 0);
      if (Math.abs(eloDiff) > 0.01) return eloDiff;
      return (Number(b.losses || 0) - Number(a.losses || 0)) || (Number(a.win_rate || 0) - Number(b.win_rate || 0));
    });
    const nemesisArmy = sortedByWorstElo[0];

    // Most frequent rival player
    const rivalMap = new Map();
    if (Array.isArray(rawHistory)) {
      rawHistory.forEach(m => {
        if (!m.opponent_name || m.is_bye || m.opponent_name.toUpperCase() === 'BYE') return;
        const key = m.opponent_id || m.opponent_name;
        if (!rivalMap.has(key)) {
          rivalMap.set(key, { name: m.opponent_name, id: m.opponent_id || '', games: 0, wins: 0, losses: 0 });
        }
        const r = rivalMap.get(key);
        r.games++;
        if (m.result === 'W') r.wins++;
        else if (m.result === 'L') r.losses++;
      });
    }
    const topRival = Array.from(rivalMap.values()).sort((a, b) => b.games - a.games)[0];

    const preyEloNum = preyArmy ? Number(preyArmy.net_elo || 0) : 0;
    const preyEloStr = (preyEloNum >= 0 ? '+' : '') + preyEloNum.toFixed(1) + ' Elo';
    const preyEloCol = preyEloNum >= 0 ? 'var(--win)' : 'var(--loss)';

    const nemEloNum = nemesisArmy ? Number(nemesisArmy.net_elo || 0) : 0;
    const nemEloStr = (nemEloNum >= 0 ? '+' : '') + nemEloNum.toFixed(1) + ' Elo';
    const nemEloCol = nemEloNum < 0 ? 'var(--loss)' : (nemEloNum > 0 ? 'var(--win)' : 'var(--text-secondary)');

    matchupSpotlightsHtml = `
      <div class="profile-spotlight-grid">
        ${preyArmy ? `
          <div class="profile-spotlight-card" style="border-left: 3px solid #10b981;">
            <span style="font-size: 0.7rem; font-weight: 800; color: #10b981; text-transform: uppercase; letter-spacing: 0.05em;">🦅 Favorite Prey Army</span>
            <div style="font-size: 0.95rem; font-weight: 800; color: #fff;">${escapeHtml(preyArmy.enemy_faction)}</div>
            <div style="font-size: 0.78rem; color: var(--text-secondary);">
              <b style="color:${preyEloCol}; font-family:var(--font-mono);">${preyEloStr}</b> (${preyArmy.wins}W - ${preyArmy.losses}L • ${preyArmy.win_rate.toFixed(0)}% WR)
            </div>
          </div>
        ` : ''}
        ${nemesisArmy ? `
          <div class="profile-spotlight-card" style="border-left: 3px solid #ef4444;">
            <span style="font-size: 0.7rem; font-weight: 800; color: #ef4444; text-transform: uppercase; letter-spacing: 0.05em;">💀 Toughest Nemesis Army</span>
            <div style="font-size: 0.95rem; font-weight: 800; color: #fff;">${escapeHtml(nemesisArmy.enemy_faction)}</div>
            <div style="font-size: 0.78rem; color: var(--text-secondary);">
              <b style="color:${nemEloCol}; font-family:var(--font-mono);">${nemEloStr}</b> (${nemesisArmy.wins}W - ${nemesisArmy.losses}L • ${nemesisArmy.win_rate.toFixed(0)}% WR)
            </div>
          </div>
        ` : ''}
        ${topRival ? `
          <div class="profile-spotlight-card" style="border-left: 3px solid #c084fc;">
            <span style="font-size: 0.7rem; font-weight: 800; color: #c084fc; text-transform: uppercase; letter-spacing: 0.05em;">⚔️ Top Rival Competitor</span>
            <div style="font-size: 0.95rem; font-weight: 800; color: #fff;">
              ${topRival.id ? `<span class="player-link" style="color:#38bdf8; cursor:pointer;" onclick="openPlayerModal('${escapeHtml(topRival.id)}', '${escapeHtml(topRival.name)}')">${escapeHtml(topRival.name)}</span>` : escapeHtml(topRival.name)}
            </div>
            <div style="font-size: 0.78rem; color: var(--text-secondary);">
              <b>${topRival.games}</b> clashes • Record: <span style="color:var(--win); font-weight:700;">${topRival.wins}W</span> - <span style="color:var(--loss); font-weight:700;">${topRival.losses}L</span>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  return `
    <div class="hub-card" style="padding: 1.25rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h3 style="font-size: 1.1rem; font-weight: 800; color: #fff; margin: 0;">🎯 Opponent Matchup Matrix</h3>
          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">
            Head-to-head record against ${profileMatchupMatrix ? profileMatchupMatrix.length : 0} enemy armies faced in tournament play
          </div>
        </div>
        <div style="min-width: 220px;">
          <input type="text" class="hub-search-input" placeholder="🔍 Search enemy army..." oninput="${filterFnName}(this.value)">
        </div>
      </div>

      ${matchupSpotlightsHtml}

      ${profileMatchupMatrix && profileMatchupMatrix.length > 0 ? `
        <div class="hub-table-wrapper">
          <table id="${tableId}" class="hub-table">
            <thead>
              <tr>
                <th style="width: 34%;">Enemy Army</th>
                <th style="width: 14%; text-align: center;">Played</th>
                <th style="width: 18%;">Record</th>
                <th style="width: 14%; text-align: right;">Net Elo</th>
                <th style="width: 20%;">Win Rate vs Army</th>
              </tr>
            </thead>
            <tbody>
              ${profileMatchupMatrix.map(m => {
                const netStr = (m.net_elo >= 0 ? '+' : '') + m.net_elo.toFixed(1);
                const netCol = m.net_elo > 0 ? 'var(--win)' : (m.net_elo < 0 ? 'var(--loss)' : 'var(--text-muted)');
                return `
                  <tr data-faction="${escapeHtml(m.enemy_faction)}">
                    <td class="cell-ellipsis" title="${escapeHtml(m.enemy_faction)}"><b style="color: #fff;">${escapeHtml(m.enemy_faction)}</b></td>
                    <td style="text-align: center; font-family: var(--font-mono); font-weight: 700;">${m.total_encounters}</td>
                    <td style="font-size: 0.8rem;">
                      <span style="color:var(--win); font-weight:700;">${m.wins}W</span> - <span style="color:var(--loss); font-weight:700;">${m.losses}L</span>${m.draws > 0 ? ` - <span style="color:var(--draw);">${m.draws}D</span>` : ''}
                    </td>
                    <td style="text-align: right; font-family: var(--font-mono); font-weight: 700; color: ${netCol};">${netStr}</td>
                    <td>
                      <div style="display:flex; align-items:center; gap:0.45rem;">
                        <div style="flex:1; background:rgba(255,255,255,0.08); height:6px; border-radius:3px; overflow:hidden;">
                          <div style="width:${Math.min(100, Number(m.win_rate))}%; background:${Number(m.win_rate) >= 50 ? 'var(--win)' : 'var(--loss)'}; height:100%;"></div>
                        </div>
                        <b style="font-size:0.8rem; font-family:var(--font-mono); min-width: 42px; text-align: right;">${Number(m.win_rate).toFixed(1)}%</b>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : `<div class="empty-state" style="padding: 2rem;">No opponent army matchup data recorded for this player.</div>`}
    </div>
  `;
}

/**
 * Render Interactive SVG Elo Rating Trajectory Chart for Public Player Profile
 */
function renderProfileTrajectoryChart(rawHistory, svgId = 'profile-trajectory-svg') {
  const svg = document.getElementById(svgId);
  if (!svg || !rawHistory || rawHistory.length === 0) return;
  svg._lastRawHistory = rawHistory;

  // Ensure chronological oldest-to-newest order for left-to-right trajectory plotting
  const chronHistory = rawHistory.slice().sort((a, b) => {
    const dA = String(a.match_date || a.event_date || '');
    const dB = String(b.match_date || b.event_date || '');
    if (dA !== dB) return dA.localeCompare(dB);
    return Number(a.round || 0) - Number(b.round || 0);
  });

  const rectW = svg.getBoundingClientRect ? svg.getBoundingClientRect().width : 0;
  const w = Math.round(rectW || svg.clientWidth || (window.innerWidth < 600 ? Math.max(280, window.innerWidth - 40) : 780));
  const isMobile = w < 520;
  const h = isMobile ? 210 : 220;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = '';

  const padLeft = isMobile ? 32 : 46;
  const padRight = isMobile ? 10 : 18;
  const padY = isMobile ? 15 : 22;
  const plotW = Math.max(100, w - padLeft - padRight);
  const plotH = h - padY * 2;

  const firstPt = chronHistory[0] || {};
  const startElo = firstPt.old_elo !== undefined && firstPt.old_elo !== null
    ? Number(firstPt.old_elo)
    : (firstPt.new_elo !== undefined && firstPt.delta_elo !== undefined
        ? Number(firstPt.new_elo) - Number(firstPt.delta_elo)
        : 1500);
  const pointsData = [{ new_elo: startElo, event_name: 'Starting Rating', result: '-' }, ...chronHistory];
  const elos = pointsData.map(pt => Number(pt.new_elo || 1500));
  const rawMin = Math.min(...elos);
  const rawMax = Math.max(...elos);
  const minElo = Math.floor((rawMin - 25) / 50) * 50;
  const maxElo = Math.ceil((rawMax + 25) / 50) * 50;
  const range = Math.max(100, maxElo - minElo);

  // Horizontal Grid Lines
  const step = Math.max(50, Math.round(range / 4 / 25) * 25);
  for (let val = minElo; val <= maxElo; val += step) {
    const y = padY + plotH - ((val - minElo) / range) * plotH;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', padLeft);
    line.setAttribute('y1', y);
    line.setAttribute('x2', w - padRight);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', val === 1500 ? 'rgba(56,189,248,0.22)' : 'rgba(255,255,255,0.07)');
    if (val === 1500) line.setAttribute('stroke-dasharray', '4 4');
    svg.appendChild(line);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', padLeft - 6);
    txt.setAttribute('y', y + 3.5);
    txt.setAttribute('fill', val === 1500 ? '#38bdf8' : '#64748b');
    txt.setAttribute('font-size', isMobile ? '9.5' : '10');
    txt.setAttribute('font-family', 'monospace');
    txt.setAttribute('text-anchor', 'end');
    txt.textContent = val;
    svg.appendChild(txt);
  }

  // Compute Coordinates
  const pts = pointsData.map((pt, idx) => {
    const x = padLeft + (idx / (pointsData.length - 1 || 1)) * plotW;
    const y = padY + plotH - ((Number(pt.new_elo || 1500) - minElo) / range) * plotH;
    return { x, y, elo: Number(pt.new_elo || 1500), raw: pt };
  });

  const density = plotW / Math.max(1, pointsData.length);
  const strokeW = density < 5 ? '1.8' : '2.5';

  // Area Gradient Fill under trajectory line
  const gradId = `${svgId}-grad`;
  if (pts.length > 1) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.0"/>
      </linearGradient>
    `;
    svg.appendChild(defs);

    let areaD = `M ${pts[0].x} ${padY + plotH} L ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      areaD += ` L ${pts[i].x} ${pts[i].y}`;
    }
    areaD += ` L ${pts[pts.length - 1].x} ${padY + plotH} Z`;
    const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    areaPath.setAttribute('d', areaD);
    areaPath.setAttribute('fill', `url(#${gradId})`);
    svg.appendChild(areaPath);

    // Stroke Path
    let dStr = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      dStr += ` L ${pts[i].x} ${pts[i].y}`;
    }
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', dStr);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#38bdf8');
    path.setAttribute('stroke-width', strokeW);
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
  }

  // Plot Points with Tooltip Titles
  pts.forEach((pt, idx) => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', pt.x);
    circle.setAttribute('cy', pt.y);
    const isLast = idx === pts.length - 1;
    const dotRadius = isLast ? (isMobile ? '4' : '4.5') : (density < 4.5 ? '1.8' : (density < 8 ? '2.4' : '3'));
    circle.setAttribute('r', dotRadius);
    const col = pt.raw.result === 'W' ? '#10b981' : (pt.raw.result === 'L' ? '#ef4444' : '#38bdf8');
    circle.setAttribute('fill', col);
    circle.setAttribute('stroke', '#0a0c10');
    circle.setAttribute('stroke-width', isLast ? '1.5' : (density < 5 ? '1' : '1.5'));

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = idx === 0
      ? `Starting Rating: ${startElo.toFixed(1)}`
      : `Match #${idx}: ${pt.elo.toFixed(1)} Elo (${pt.raw.result || '-'} vs ${pt.raw.opponent_name || 'Opponent'} @ ${pt.raw.event_name || 'Event'})`;
    circle.appendChild(title);
    svg.appendChild(circle);
  });
}

if (typeof window !== 'undefined' && !window._trajectoryResizeBound) {
  window._trajectoryResizeBound = true;
  window.addEventListener('resize', () => {
    ['profile-trajectory-svg', 'hub-trajectory-svg'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el._lastRawHistory && el.offsetParent !== null) {
        renderProfileTrajectoryChart(el._lastRawHistory, id);
      }
    });
  });
}

/**
 * Switch active subtab in Public Player Profile
 */
function switchProfileSubtab(tabId) {
  const bar = document.getElementById('profile-subtabs-bar');
  if (bar) {
    bar.querySelectorAll('.profile-subtab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });
  }

  const panels = ['journey', 'trajectory', 'factions', 'matchups', 'trophies'];
  panels.forEach(id => {
    const el = document.getElementById(`profile-panel-${id}`);
    if (el) {
      el.classList.toggle('active', id === tabId);
    }
  });

  if (tabId === 'trajectory' && currentProfileData) {
    const rawHistory = Array.isArray(currentProfileData.history) ? currentProfileData.history : (currentProfileData.win_path || []);
    setTimeout(() => renderProfileTrajectoryChart(rawHistory), 20);
  }

  if (tabId === 'trophies' && window.BadgesUI && currentProfileData) {
    const el = document.getElementById('profile-panel-trophies');
    if (el) {
      window.BadgesUI.renderTrophyRoom(el, currentProfileData, !!currentProfileData.is_self, currentProfileData.player_id);
    }
  }
}

/**
 * Filter Faction Mastery table rows in Player Profile
 */
function filterProfileFactions(query) {
  const q = (query || '').trim().toLowerCase();
  const rows = document.querySelectorAll('#profile-faction-table tbody tr');
  rows.forEach(r => {
    const fName = (r.getAttribute('data-faction') || '').toLowerCase();
    r.style.display = (!q || fName.includes(q)) ? '' : 'none';
  });
}

/**
 * Filter Matchup Matrix table rows in Player Profile
 */
function filterProfileMatchups(query) {
  const q = (query || '').trim().toLowerCase();
  const rows = document.querySelectorAll('#profile-matchup-table tbody tr');
  rows.forEach(r => {
    const fName = (r.getAttribute('data-faction') || '').toLowerCase();
    r.style.display = (!q || fName.includes(q)) ? '' : 'none';
  });
}

function toggleProfileCareerDetails(ev) {
  if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
  const drawer = document.getElementById('profile-career-details-drawer');
  const arrow = document.getElementById('profile-career-toggle-arrow');
  const textSpan = document.getElementById('profile-career-toggle-text');
  const btn = document.getElementById('profile-career-toggle-btn');
  if (!drawer) return;
  const isCollapsed = drawer.classList.contains('hub-career-drawer-collapsed');
  window.isProfileCareerDrawerExpanded = isCollapsed;
  try { sessionStorage.setItem('omni_profile_career_expanded', isCollapsed ? '1' : '0'); } catch (e) {}
  if (isCollapsed) {
    drawer.classList.remove('hub-career-drawer-collapsed');
    drawer.classList.add('hub-career-drawer-expanded');
    if (arrow) arrow.textContent = '▲';
    if (textSpan) textSpan.textContent = 'Hide Full Stats & Progression';
    if (btn) btn.setAttribute('aria-expanded', 'true');
  } else {
    drawer.classList.remove('hub-career-drawer-expanded');
    drawer.classList.add('hub-career-drawer-collapsed');
    if (arrow) arrow.textContent = '▼';
    if (textSpan) textSpan.textContent = 'Show Full Stats & Progression';
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
}

// Global exports
if (typeof window !== 'undefined') {
  window.openPlayerProfilePage = openPlayerProfilePage;
  window.renderDedicatedPlayerProfile = renderDedicatedPlayerProfile;
  window.toggleProfileEventCard = toggleProfileEventCard;
  window.toggleAllProfileEventCards = toggleAllProfileEventCards;
  window.toggleProfileCareerDetails = toggleProfileCareerDetails;
  window.copyPlayerProfileLink = copyPlayerProfileLink;
  window.openShareProfileModal = openShareProfileModal;
  window.renderShareProfileCanvas = renderShareProfileCanvas;
  window.setShareProfileFormat = setShareProfileFormat;
  window.setShareProfileTheme = setShareProfileTheme;
  window.toggleShareProfileOption = toggleShareProfileOption;
  window.downloadShareProfileImage = downloadShareProfileImage;
  window.copyShareProfileImage = copyShareProfileImage;
  window.nativeShareProfileCard = nativeShareProfileCard;
  window.copyShareProfileDiscordCard = copyShareProfileDiscordCard;
  window.shareProfileToPlatform = shareProfileToPlatform;
  window.navigateBackFromProfile = navigateBackFromProfile;
  window.openPredictorWithPlayer = openPredictorWithPlayer;
  window.openPredictorWithPlayers = openPredictorWithPlayers;
  window.openDedicatedPlayerProfileFromModal = openDedicatedPlayerProfileFromModal;
  window.switchProfileSubtab = switchProfileSubtab;
  window.filterProfileFactions = filterProfileFactions;
  window.filterProfileMatchups = filterProfileMatchups;
  window.renderProfileTrajectoryChart = renderProfileTrajectoryChart;
  window.computeProfileFactionMastery = computeProfileFactionMastery;
  window.computeProfileMatchupMatrix = computeProfileMatchupMatrix;
  window.renderFactionMasteryTabContent = renderFactionMasteryTabContent;
  window.renderMatchupMatrixTabContent = renderMatchupMatrixTabContent;
}


