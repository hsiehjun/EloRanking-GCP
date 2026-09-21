/**
 * OmniTactica Badge & Trophy System - Frontend Controller
 * Renders the 7-tier military progression ladder, hero signature honors,
 * interactive 105-badge Trophy Room, and inspection modals.
 */

(function(window) {
  'use strict';

  var currentHubScope = 'career';
  var currentPublicScope = 'career';
  var currentTrophyCategory = 'all';
  var currentTrophyStatus = 'all';
  var currentTrophySearch = '';

  var currentSeasonalCategory = 'all';
  var currentSeasonalStatus = 'all';
  var currentSeasonalSearch = '';

  var activeTrophyData = null;
  var activeHubTrophyData = null;
  var activePublicTrophyData = null;

  var RARITY_ORDER = {
    'mythic': 6,
    'legendary': 5,
    'epic': 4,
    'rare': 3,
    'uncommon': 2,
    'common': 1
  };

  /**
   * Helper to retrieve seasonal dataset from dashboard/player payload
   */
  function getSeasonalData(data) {
    if (!data) return null;
    if (data.seasonal) {
      var seasonKey = data.active_season || '2026';
      if (data.seasonal[seasonKey]) return data.seasonal[seasonKey];
      if (data.seasonal.badges) return data.seasonal;
    }
    return null;
  }

  /**
   * Helper to search for a badge across career badges and active seasonal badges
   */
  function findBadgeInAllData(data, badgeId) {
    if (!data) return null;
    if (data.badges && Array.isArray(data.badges)) {
      var b = data.badges.find(function(x) { return x.id === badgeId; });
      if (b) return b;
    }
    var sData = getSeasonalData(data);
    if (sData && sData.badges && Array.isArray(sData.badges)) {
      var sb = sData.badges.find(function(x) { return x.id === badgeId; });
      if (sb) return sb;
    }
    return null;
  }

  /**
   * Renders the Scope Switcher Bar ([ 🏛️ Career Milestones ] vs [ ⚡ Season 2026 ])
   */
  function renderScopeBar(scope, isPublic, careerCount, totalCareer, seasonalCount, totalSeasonal, onSwitchFn) {
    var isCareer = scope === 'career';
    var isSeasonal = scope === 'seasonal';
    var careerText = isPublic
      ? ('<span class="scope-text-full">Career Milestones</span><span class="scope-text-compact">Career</span> (' + careerCount + ')')
      : '<span class="scope-text-full">Career Milestones</span><span class="scope-text-compact">Career</span>';
    var seasonalText = isPublic
      ? ('<span class="scope-text-full">Season 2026</span><span class="scope-text-compact">Season \'26</span> (' + seasonalCount + ')')
      : '<span class="scope-text-full">Season 2026</span><span class="scope-text-compact">Season \'26</span>';

    var careerCountPill = !isPublic ? ('<span class="trophy-scope-count">' + careerCount + ' / ' + totalCareer + '</span>') : '';
    var seasonalCountPill = !isPublic ? ('<span class="trophy-scope-count trophy-season-pill">' + seasonalCount + ' / ' + totalSeasonal + '</span>') : '';

    return [
      '<div class="trophy-scope-bar">',
      '  <div class="trophy-scope-toggle" role="tablist" aria-label="Trophy Scope">',
      '    <button type="button" class="trophy-scope-btn ' + (isCareer ? 'active' : '') + '" data-scope="career" ',
      '            onclick="' + onSwitchFn + '(\'career\')" role="tab" aria-selected="' + isCareer + '">',
      '      <span class="scope-icon">🏛️</span>',
      '      <span class="scope-text">' + careerText + '</span>',
      careerCountPill,
      '    </button>',
      '    <button type="button" class="trophy-scope-btn ' + (isSeasonal ? 'active' : '') + '" data-scope="seasonal" ',
      '            onclick="' + onSwitchFn + '(\'seasonal\')" role="tab" aria-selected="' + isSeasonal + '">',
      '      <span class="scope-icon">⚡</span>',
      '      <span class="scope-text">' + seasonalText + '</span>',
      seasonalCountPill,
      '    </button>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  function setHubScope(scope) {
    currentHubScope = scope;
    var container = document.getElementById('hub-panel-trophies') || document.getElementById('trophy-room-container');
    if (container && activeHubTrophyData) {
      renderTrophyRoom(container, activeHubTrophyData, true, activeHubTrophyData.player && activeHubTrophyData.player.player_id);
    }
  }

  function setPublicScope(scope) {
    currentPublicScope = scope;
    var container = document.getElementById('profile-panel-trophies');
    if (container && activePublicTrophyData) {
      renderTrophyRoom(container, activePublicTrophyData, false, activePublicTrophyData.player && activePublicTrophyData.player.player_id);
    }
  }

  function navigateToScope(scope, isPublic) {
    if (isPublic) {
      if (typeof switchProfileSubtab === 'function') {
        switchProfileSubtab('trophies');
      }
      setPublicScope(scope);
      setTimeout(function() {
        var el = document.getElementById('profile-panel-trophies') || document.querySelector('.trophy-room-wrapper');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    } else {
      if (typeof switchHubSubtab === 'function') {
        switchHubSubtab('trophies');
      } else if (typeof switchHubTab === 'function') {
        switchHubTab('trophies');
      }
      setHubScope(scope);
      setTimeout(function() {
        var el = document.getElementById('hub-panel-trophies') || document.getElementById('trophy-room-container');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
  }

  /**
   * Escape HTML utility
   */
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Renders the compact Heraldic Insignia Cluster for the Hero Profile Card
   * Displays the Global Career Crest and Seasonal Campaign Seal(s) with zero competing rank text.
   * Clicking an insignia acts as a direct navigation shortcut to that trophy scope.
   */
  function renderHeroInsigniaCluster(rankOrData, switchTabFnName, seasonalParam) {
    if (!rankOrData) return '';
    var isPublic = switchTabFnName && (String(switchTabFnName).indexOf('Profile') !== -1 || switchTabFnName === 'public');
    var data = (rankOrData.rank || rankOrData.player) ? rankOrData : null;
    var rank = data ? data.rank : rankOrData;
    if (!rank) return '';

    var seasonalData = seasonalParam || (data && data.seasonal) || {};
    var s2026 = seasonalData['2026'] || seasonalData[2026] || (data && data.seasonal_badges ? { badge_count: data.seasonal_badges.length } : null);

    var rankIcon = rank.icon || '🛡️';
    var rankLevel = rank.rank || 1;
    var rankTitle = rank.title || 'Career Crest';
    var rankClass = rank.css_class || 'rank-border-initiate';
    var badgeCount = (data && data.badge_count != null) ? data.badge_count : (rank.badge_count || 0);

    var careerTooltip = 'Career Crest: ' + rankTitle + ' (Tier ' + rankLevel + '/7 • ' + badgeCount + ' Milestones Unlocked) — Click to view Career Trophies';
    var publicArg = isPublic ? 'true' : 'false';

    var html = [
      '<div class="hero-insignia-cluster" role="group" aria-label="Player Crest and Seasonal Honors">',
      '  <button type="button" class="hero-insignia-btn career-crest-btn ' + escapeHtml(rankClass) + '" ',
      '          onclick="window.BadgesUI && window.BadgesUI.navigateToScope(\'career\', ' + publicArg + ');" ',
      '          title="' + escapeHtml(careerTooltip) + '" aria-label="' + escapeHtml(careerTooltip) + '">',
      '    <span class="insignia-icon">' + rankIcon + '</span>',
      '  </button>'
    ];

    // Seasonal Campaign Seal (Season 2026)
    var sCount = s2026 ? (s2026.badge_count != null ? s2026.badge_count : (s2026.badges ? s2026.badges.filter(function(b) { return b.unlocked; }).length : 0)) : ((data && data.seasonal_badge_count) || 0);
    var isCapstone = s2026 ? (s2026.capstone_unlocked || sCount >= 15) : ((data && data.seasonal_capstone) || sCount >= 15);

    var sTierClass = 'seal-initiate';
    var sTierTitle = 'Campaign Enlisted';
    var sIcon = '⚡';

    if (isCapstone) {
      sTierClass = 'seal-warmaster';
      sTierTitle = 'Warmaster of 2026 Attained';
      sIcon = '👑';
    } else if (sCount >= 10) {
      sTierClass = 'seal-gold';
      sTierTitle = 'Season Champion (Gold)';
      sIcon = '🥇';
    } else if (sCount >= 5) {
      sTierClass = 'seal-silver';
      sTierTitle = 'Season Veteran (Silver)';
      sIcon = '🥈';
    } else if (sCount >= 1) {
      sTierClass = 'seal-bronze';
      sTierTitle = 'Campaign Active (Bronze)';
      sIcon = '⚡';
    }

    var seasonalTooltip = 'Season 2026 Campaign: ' + sTierTitle + ' (' + sCount + '/21 Honors Unlocked) — Click to view Season 2026';

    html.push('  <button type="button" class="hero-insignia-btn seasonal-seal-btn ' + sTierClass + '" ');
    html.push('          onclick="window.BadgesUI && window.BadgesUI.navigateToScope(\'seasonal\', ' + publicArg + ');" ');
    html.push('          title="' + escapeHtml(seasonalTooltip) + '" aria-label="' + escapeHtml(seasonalTooltip) + '">');
    html.push('    <span class="seasonal-icon">' + sIcon + '</span>');
    html.push('    <span class="seasonal-tag">\'26</span>');
    html.push('  </button>');
    html.push('  <button type="button" class="hero-insignia-info-btn" onclick="window.BadgesUI && window.BadgesUI.openGuideModal();" title="Field Manual: Crests, Seals &amp; Heraldry Symbols" aria-label="Heraldry Guide">');
    html.push('    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>');
    html.push('  </button>');
    html.push('</div>');

    return html.join('\n');
  }

  /**
   * Backward-compatible wrapper for renderRankBadge
   */
  function renderRankBadge(rankOrData, switchTabFnName, seasonalParam) {
    return renderHeroInsigniaCluster(rankOrData, switchTabFnName, seasonalParam);
  }

  /**
   * Renders the 3 Signature Honors (Pinned Medals) in the Hero Profile Card
   */
  function renderPinnedMedals(pinnedBadges, totalUnlocked, isSelf, switchTabFnName) {
    pinnedBadges = pinnedBadges || [];
    totalUnlocked = totalUnlocked || 0;
    var fnName = switchTabFnName || (isSelf ? "switchHubSubtab" : "switchProfileSubtab");
    var moreCount = Math.max(0, totalUnlocked - pinnedBadges.length);
    var labelText = '🎖️ SIGNATURE HONORS' + (totalUnlocked > 0 ? ' (' + totalUnlocked + '/105):' : ':');

    if (pinnedBadges.length === 0 && totalUnlocked === 0) {
      return [
        '<div class="hero-pinned-medals">',
        '  <span class="pinned-medals-label">' + labelText + '</span>',
        '  <div class="pinned-medals-rack">',
        '    <span class="pinned-empty-hint" onclick="' + fnName + '(\'trophies\')">Complete matches to unlock your first honors (0/105)</span>',
        '    <button type="button" class="pinned-more-btn" onclick="' + fnName + '(\'trophies\')"><span>Trophies</span> <span>▾</span></button>',
        '  </div>',
        '</div>'
      ].join('\n');
    }

    var medalsHtml = pinnedBadges.map(function(b) {
      var rarity = b.rarity || 'common';
      var name = b.name || 'Honor';
      var icon = b.icon || '⚔️';
      return [
        '<div class="hero-medal-chip rarity-' + escapeHtml(rarity) + '" ',
        '     onclick="' + fnName + '(\'trophies\'); window.BadgesUI.openTrophyModal(\'' + escapeHtml(b.id) + '\', ' + (!isSelf) + ');" ',
        '     title="' + escapeHtml(name + ' (' + (b.rarity_label || rarity) + '): ' + (b.description || '')) + '">',
        '  <span class="hero-medal-icon">' + icon + '</span>',
        '  <span class="hero-medal-title">' + escapeHtml(name) + '</span>',
        '  <span class="hero-medal-dot" style="background:' + (b.color || '#94a3b8') + ';"></span>',
        '</div>'
      ].join('');
    }).join('\n');

    return [
      '<div class="hero-pinned-medals" id="hero-pinned-medals">',
      '  <span class="pinned-medals-label">' + labelText + '</span>',
      '  <div class="pinned-medals-rack">',
      medalsHtml,
      '    <button type="button" class="pinned-more-btn" onclick="' + fnName + '(\'trophies\')" title="View all 105 trophies">',
      '      <span>+' + moreCount + ' More Trophies →</span>',
      '    </button>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  /**
   * Renders the complete Trophy Room inside #hub-panel-trophies or #profile-panel-trophies
   */
  function renderTrophyRoom(containerEl, data, isSelf, playerId) {
    if (!containerEl) return;
    activeTrophyData = data;

    // Detect public profile showcase mode vs personal hub command room mode
    var isPublic = (containerEl && (containerEl.id === 'profile-panel-trophies' || (containerEl.closest && containerEl.closest('#tab-player-profile')))) || !isSelf;

    if (isPublic) {
      activePublicTrophyData = data;
    } else {
      activeHubTrophyData = data;
    }

    var badges = data.badges || [];
    var rank = data.rank || {};
    var badgeCount = data.badge_count || 0;
    var totalBadges = data.total_badges || badges.length || 105;
    var gloryScore = data.glory_score || 0;
    var completionPct = data.completion_pct || (totalBadges ? Math.round((badgeCount / totalBadges) * 100) : 0);

    // Seasonal Data Extraction
    var sData = getSeasonalData(data);
    var seasonalBadges = sData ? (sData.badges || []) : [];
    var seasonalCount = sData ? (sData.badge_count || 0) : 0;
    var totalSeasonal = seasonalBadges.length || 21;
    var seasonalCompletionPct = sData ? (sData.completion_pct || 0) : 0;
    var seasonalGlory = sData ? (sData.glory_score || 0) : 0;
    var unifiedGlory = data.glory_balance != null ? data.glory_balance : (gloryScore + seasonalGlory);

    var championships = data.championships || { total: 0, items: [] };
    var champShelfHtml = renderHallOfChampions(championships, isSelf, isPublic);

    var nextRankText = rank.next_rank_title
      ? rank.badges_needed_for_next + ' more honors needed for <strong>' + escapeHtml(rank.next_rank_title) + '</strong>'
      : 'Pinnacle Everchosen Status Attained';

    // Banner Stats Group for Career View:
    var careerStatsGroupHtml = '';
    if (!isPublic) {
      careerStatsGroupHtml = [
        '<div class="trophy-banner-stats-group">',
        '  <div class="trophy-stat-pill trophy-glory-pill-interactive" onclick="window.BadgesUI.openGloryCurrencyModal()" style="cursor: pointer;" title="Glory Honor: Unified Spendable Balance (Click for Field Intel)">',
        '        <div style="display: flex; align-items: center; justify-content: center; gap: 0.35rem;">',
        '          <span class="trophy-stat-val" style="color: #fbbf24;">' + unifiedGlory.toLocaleString() + '</span>',
        '          <span style="font-size: 0.68rem; opacity: 0.85;">ℹ️</span>',
        '        </div>',
        '        <span class="trophy-stat-lbl">Glory Honor</span>',
        '  </div>',
        '  <div class="trophy-stat-pill">',
        '    <span class="trophy-stat-val" style="color: #38bdf8;">' + badgeCount + ' / ' + totalBadges + '</span>',
        '    <span class="trophy-stat-lbl">Unlocked (' + completionPct + '%)</span>',
        '  </div>',
        '</div>'
      ].join('\n');
    } else {
      careerStatsGroupHtml = [
        '<div class="trophy-banner-stats-group">',
        '  <div class="trophy-stat-pill">',
        '    <span class="trophy-stat-val" style="color: #38bdf8;">' + badgeCount + ' / ' + totalBadges + '</span>',
        '    <span class="trophy-stat-lbl">Unlocked (' + completionPct + '%)</span>',
        '  </div>',
        '</div>'
      ].join('\n');
    }

    var careerBannerAndProgressHtml = [
      '  <!-- 1. General Command Banner & Progression Track -->',
      '  <div class="trophy-command-banner">',
      '    <div class="trophy-banner-rank-group">',
      '      <div class="trophy-rank-insignia ' + escapeHtml(rank.css_class || 'rank-border-initiate') + '">',
      '        <span>' + (rank.icon || '🛡️') + '</span>',
      '      </div>',
      '      <div class="trophy-banner-text">',
      '        <div class="trophy-banner-title-row">',
      '          <h3 class="trophy-military-title">Career Milestones</h3>',
      '          <span class="trophy-rank-level-badge">Crest Tier ' + (rank.rank || 1) + ': ' + escapeHtml(rank.title || 'Initiate') + '</span>',
      '          <button type="button" class="trophy-info-btn" onclick="window.BadgesUI.openGuideModal()" title="Field Manual: Rank Borders &amp; Glory System" aria-label="Progression Guide"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></button>',
      '        </div>',
      '        <div class="trophy-banner-sub">' + escapeHtml(rank.description || '') + '</div>',
      '        <div class="trophy-next-rank-status">' + nextRankText + '</div>',
      '      </div>',
      '    </div>',
      careerStatsGroupHtml,
      '  </div>',
      '  <!-- 2. Rank XP Progress Bar -->',
      '  <div class="trophy-progress-wrap">',
      '    <div class="trophy-progress-meta">',
      '      <span>Career Crest Tier ' + (rank.rank || 1) + ': ' + escapeHtml(rank.title || 'Initiate') + '</span>',
      '      <span>' + (rank.progress_pct || 0) + '% to ' + escapeHtml(rank.next_rank_title || 'Apex') + '</span>',
      '    </div>',
      '    <div class="trophy-progress-bar">',
      '      <div class="trophy-progress-fill" style="width: ' + (rank.progress_pct || 0) + '%;"></div>',
      '    </div>',
      '  </div>'
    ].join('\n');

    if (isPublic) {
      // PUBLIC PROFILE SHOWCASE MODE:
      // Omit category chips bar, search input, and All/Unlocked/Locked status toggles.
      // Show only unlocked battle honors sorted by rarity descending.
      var unlockedCareer = badges.filter(function(b) { return !!b.unlocked; });
      unlockedCareer.sort(function(a, b) {
        var rDiff = (RARITY_ORDER[b.rarity] || 0) - (RARITY_ORDER[a.rarity] || 0);
        if (rDiff !== 0) return rDiff;
        return (a.name || '').localeCompare(b.name || '');
      });

      var unlockedSeasonal = seasonalBadges.filter(function(b) { return !!b.unlocked; });
      unlockedSeasonal.sort(function(a, b) {
        var rDiff = (RARITY_ORDER[b.rarity] || 0) - (RARITY_ORDER[a.rarity] || 0);
        if (rDiff !== 0) return rDiff;
        return (a.name || '').localeCompare(b.name || '');
      });

      var scopeBarHtml = renderScopeBar(currentPublicScope, true, unlockedCareer.length, badges.length, unlockedSeasonal.length, totalSeasonal, 'window.BadgesUI.setPublicScope');

      if (currentPublicScope === 'seasonal') {
        var isCapstoneAchieved = sData && sData.capstone_unlocked;
        var capstoneText = isCapstoneAchieved
          ? '👑 <strong>Pinnacle Commendation Attained:</strong> Warmaster of 2026'
          : '👑 <strong>Pinnacle Target:</strong> 15 Seasonal Honors Claimed for Warmaster of 2026';

        var seasonalPublicBannerHtml = [
          '  <div class="trophy-command-banner seasonal-banner">',
          '    <div class="trophy-banner-rank-group">',
          '      <div class="trophy-rank-insignia" style="border: 1.5px solid rgba(245, 158, 11, 0.6); box-shadow: 0 0 15px rgba(245, 158, 11, 0.25);">',
          '        <span>⚡</span>',
          '      </div>',
          '      <div class="trophy-banner-text">',
          '        <div class="trophy-banner-title-row">',
          '          <h3 class="trophy-military-title">Season 2026 Campaign</h3>',
          '          <span class="trophy-rank-level-badge" style="background: rgba(245, 158, 11, 0.15); border-color: rgba(245, 158, 11, 0.4); color: #fbbf24;">Active Annual Circuit</span>',
          '        </div>',
          '        <div class="trophy-banner-sub">Sanctioned annual combat feats and tournament endurance running Jan 1 – Dec 31, 2026.</div>',
          '        <div class="trophy-capstone-status">' + capstoneText + '</div>',
          '      </div>',
          '    </div>',
          '    <div class="trophy-banner-stats-group">',
          '      <div class="trophy-stat-pill">',
          '        <span class="trophy-stat-val" style="color: #fbbf24;">' + unlockedSeasonal.length + ' / ' + totalSeasonal + '</span>',
          '        <span class="trophy-stat-lbl">Unlocked (' + seasonalCompletionPct + '%)</span>',
          '      </div>',
          '    </div>',
          '  </div>'
        ].join('\n');

        var seasonalShowcaseHeader = [
          '  <div class="trophy-showcase-header" style="border-left: 3px solid #fbbf24;">',
          '    <div class="trophy-showcase-title-row">',
          '      <h4 class="trophy-showcase-heading">⚡ Season 2026 Campaign Honors (' + unlockedSeasonal.length + ')</h4>',
          '      <span class="trophy-showcase-badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border-color: rgba(245, 158, 11, 0.35);">Annual Commendations</span>',
          '    </div>',
          '    <p class="trophy-showcase-sub">Verified competitive achievements, Grand Tournament finishes, and game companion feats earned in Season 2026.</p>',
          '  </div>'
        ].join('\n');

        var seasonalPublicHtml = [
          '<div class="trophy-room-wrapper">',
          scopeBarHtml,
          seasonalPublicBannerHtml,
          seasonalShowcaseHeader,
          '  <div class="trophy-grid" id="profile-trophy-grid-container">',
          renderPublicTrophyCards(unlockedSeasonal, 'Season 2026'),
          '  </div>',
          '</div>'
        ].join('\n');

        containerEl.innerHTML = seasonalPublicHtml;
        return;
      }

      // Default Career Scope in Public Profile
      var showcaseHeaderHtml = [
        '  <div class="trophy-showcase-header">',
        '    <div class="trophy-showcase-title-row">',
        '      <h4 class="trophy-showcase-heading">🎖️ Earned Battlefield Honors (' + unlockedCareer.length + ')</h4>',
        '      <span class="trophy-showcase-badge">Official Commendations</span>',
        '    </div>',
        '    <p class="trophy-showcase-sub">Verified competitive achievements and tournament milestones awarded by High Command.</p>',
        '  </div>'
      ].join('\n');

      var publicHtml = [
        '<div class="trophy-room-wrapper">',
        scopeBarHtml,
        careerBannerAndProgressHtml,
        champShelfHtml,
        showcaseHeaderHtml,
        '  <!-- 5. Trophies Grid (Public Showcase) -->',
        '  <div class="trophy-grid" id="profile-trophy-grid-container">',
        renderPublicTrophyCards(unlockedCareer),
        '  </div>',
        '</div>'
      ].join('\n');

      containerEl.innerHTML = publicHtml;
      return;
    }

    // MY HUB PERSONAL COMMAND MODE:
    // Full interactive control room: category chips, search bar, All/Unlocked/Locked status toggles, pin support.
    var scopeBarHtml = renderScopeBar(currentHubScope, false, badgeCount, totalBadges, seasonalCount, totalSeasonal, 'window.BadgesUI.setHubScope');

    if (currentHubScope === 'seasonal') {
      // SEASONAL HUB VIEW
      var isCapstoneAchieved = sData && sData.capstone_unlocked;
      var capstoneProgressTgt = 15;
      var capstoneProgressCur = Math.min(seasonalCount, capstoneProgressTgt);
      var capstoneProgressPct = Math.min(100, Math.round((capstoneProgressCur / capstoneProgressTgt) * 100));

      var capstoneStatusText = isCapstoneAchieved
        ? '👑 <strong>Warmaster of 2026</strong> Attained (+500 Glory Requisition Claimed)'
        : '👑 <strong>' + Math.max(0, capstoneProgressTgt - seasonalCount) + '</strong> more honors needed for <strong>Warmaster of 2026</strong> (+500 Glory)';

      var seasonalBannerAndProgress = [
        '  <!-- Seasonal Command Banner -->',
        '  <div class="trophy-command-banner seasonal-banner">',
        '    <div class="trophy-banner-rank-group">',
        '      <div class="trophy-rank-insignia" style="border: 1.5px solid rgba(245, 158, 11, 0.6); box-shadow: 0 0 18px rgba(245, 158, 11, 0.3);">',
        '        <span>⚡</span>',
        '      </div>',
        '      <div class="trophy-banner-text">',
        '        <div class="trophy-banner-title-row">',
        '          <h3 class="trophy-military-title">Season 2026 Campaign</h3>',
        '          <span class="trophy-rank-level-badge" style="background: rgba(245, 158, 11, 0.15); border-color: rgba(245, 158, 11, 0.4); color: #fbbf24;">Active Annual Circuit</span>',
        '          <button type="button" class="trophy-info-btn" onclick="window.BadgesUI.openGuideModal()" title="Field Manual: Annual Seasons &amp; Glory Honor" aria-label="Progression Guide"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></button>',
        '        </div>',
        '        <div class="trophy-banner-sub">Annual competitive season running Jan 1 – Dec 31, 2026. Trophies award fresh Glory Honor and reset annually.</div>',
        '        <div class="trophy-capstone-status">' + capstoneStatusText + '</div>',
        '      </div>',
        '    </div>',
        '    <div class="trophy-banner-stats-group">',
        '      <div class="trophy-stat-pill trophy-glory-pill-interactive" onclick="window.BadgesUI.openGloryCurrencyModal()" style="cursor: pointer;" title="Glory Honor: Unified Spendable Balance (Click for Field Intel)">',
        '        <div style="display: flex; align-items: center; justify-content: center; gap: 0.35rem;">',
        '          <span class="trophy-stat-val" style="color: #fbbf24;">' + unifiedGlory.toLocaleString() + '</span>',
        '          <span style="font-size: 0.68rem; opacity: 0.85;">ℹ️</span>',
        '        </div>',
        '        <span class="trophy-stat-lbl">Glory Honor</span>',
        '      </div>',
        '      <div class="trophy-stat-pill">',
        '        <span class="trophy-stat-val" style="color: #fbbf24;">' + seasonalCount + ' / ' + totalSeasonal + '</span>',
        '        <span class="trophy-stat-lbl">Unlocked (' + seasonalCompletionPct + '%)</span>',
        '      </div>',
        '    </div>',
        '  </div>',
        '  <!-- Seasonal Capstone Progress Track -->',
        '  <div class="trophy-progress-wrap">',
        '    <div class="trophy-progress-meta">',
        '      <span>Season 2026 Campaign: ' + seasonalCount + ' / ' + totalSeasonal + ' Claimed (' + seasonalCompletionPct + '%)</span>',
        '      <span>' + (isCapstoneAchieved ? '100% Pinnacle Achieved' : (capstoneProgressPct + '% to Warmaster of 2026 (15 Req.)')) + '</span>',
        '    </div>',
        '    <div class="trophy-progress-bar">',
        '      <div class="trophy-progress-fill" style="width: ' + (isCapstoneAchieved ? 100 : capstoneProgressPct) + '%; background: linear-gradient(90deg, #f59e0b, #fbbf24);"></div>',
        '    </div>',
        '  </div>'
      ].join('\n');

      var catCounts = { 'all': seasonalBadges.length };
      seasonalBadges.forEach(function(b) {
        var c = b.category || 'combat';
        catCounts[c] = (catCounts[c] || 0) + 1;
      });

      var seasonalCategoriesList = [
        { id: 'all', title: 'All Feats', icon: '⚡' },
        { id: 'combat', title: 'Combat Feats', icon: '⚔️' },
        { id: 'tournament', title: 'Tournament Circuit', icon: '🏆' },
        { id: 'tracker', title: 'Game Tracker', icon: '📱' },
        { id: 'factions', title: 'Army & Armory', icon: '🛡️' },
        { id: 'capstone', title: 'Pinnacle Honor', icon: '👑' }
      ];

      var chipsHtml = seasonalCategoriesList.map(function(c) {
        var activeClass = currentSeasonalCategory === c.id ? 'active' : '';
        var count = catCounts[c.id] || 0;
        return [
          '<button type="button" class="trophy-category-chip ' + activeClass + '" data-cat="' + c.id + '" onclick="window.BadgesUI.setSeasonalCategory(\'' + c.id + '\')">',
          '  <span class="chip-icon">' + c.icon + '</span>',
          '  <span class="chip-label">' + escapeHtml(c.title) + '</span>',
          '  <span class="chip-count">' + count + '</span>',
          '</button>'
        ].join('');
      }).join('\n');

      var seasonalHubHtml = [
        '<div class="trophy-room-wrapper">',
        scopeBarHtml,
        seasonalBannerAndProgress,
        '  <!-- 3. Seasonal Category Filter Chips -->',
        '  <div class="trophy-categories-bar" id="hub-trophy-categories-bar">',
        chipsHtml,
        '  </div>',
        '  <!-- 4. Search & Status Filter Bar -->',
        '  <div class="trophy-search-filter-bar" id="hub-trophy-search-filter-bar">',
        '    <div class="trophy-search-input-wrap">',
        '      <span class="trophy-search-icon">🔍</span>',
        '      <input type="text" id="hub-trophy-search-input" class="trophy-search-input" ',
        '             placeholder="Search Season 2026 honors by title, keyword, or feat..." ',
        '             value="' + escapeHtml(currentSeasonalSearch) + '" ',
        '             oninput="window.BadgesUI.onSeasonalSearchInput(this.value)">',
        '      <button type="button" class="trophy-search-clear" id="hub-trophy-search-clear" onclick="window.BadgesUI.clearSeasonalSearch()" style="display:' + (currentSeasonalSearch ? 'inline-flex' : 'none') + ';">✕</button>',
        '    </div>',
        '    <div class="trophy-status-toggles" id="hub-trophy-status-toggles">',
        '      <button type="button" class="trophy-status-btn ' + (currentSeasonalStatus === 'all' ? 'active' : '') + '" onclick="window.BadgesUI.setSeasonalStatusFilter(\'all\')">All</button>',
        '      <button type="button" class="trophy-status-btn ' + (currentSeasonalStatus === 'unlocked' ? 'active' : '') + '" onclick="window.BadgesUI.setSeasonalStatusFilter(\'unlocked\')">Unlocked (' + seasonalCount + ')</button>',
        '      <button type="button" class="trophy-status-btn ' + (currentSeasonalStatus === 'locked' ? 'active' : '') + '" onclick="window.BadgesUI.setSeasonalStatusFilter(\'locked\')">In Progress (' + (totalSeasonal - seasonalCount) + ')</button>',
        '    </div>',
        '  </div>',
        '  <!-- 5. Trophies Grid (Seasonal Hub) -->',
        '  <div class="trophy-grid" id="hub-trophy-grid-container">',
        renderSeasonalTrophyCards(seasonalBadges, isSelf, playerId),
        '  </div>',
        '</div>'
      ].join('\n');

      containerEl.innerHTML = seasonalHubHtml;
      return;
    }

    // Default Career Hub View
    var catCounts = { 'all': badges.length };
    badges.forEach(function(b) {
      var cat = b.category || 'career';
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    });

    var categoriesList = [
      { id: 'all', title: 'All Trophies', icon: '🏛️' },
      { id: 'tournament', title: 'Tournament', icon: '🏆' },
      { id: 'battlefield', title: 'Battlefield', icon: '🎯' },
      { id: 'factions', title: 'Factions', icon: '🛡️' },
      { id: 'ladder', title: 'Ladder & Elo', icon: '📈' },
      { id: 'career', title: 'Career & Secrets', icon: '📜' }
    ];

    var chipsHtml = categoriesList.map(function(c) {
      var activeClass = currentTrophyCategory === c.id ? 'active' : '';
      var count = catCounts[c.id] || 0;
      return [
        '<button type="button" class="trophy-category-chip ' + activeClass + '" data-cat="' + c.id + '" onclick="window.BadgesUI.setCategory(\'' + c.id + '\')">',
        '  <span class="chip-icon">' + c.icon + '</span>',
        '  <span class="chip-label">' + escapeHtml(c.title) + '</span>',
        '  <span class="chip-count">' + count + '</span>',
        '</button>'
      ].join('');
    }).join('\n');

    var hubHtml = [
      '<div class="trophy-room-wrapper">',
      scopeBarHtml,
      careerBannerAndProgressHtml,
      champShelfHtml,
      '  <!-- 3. Category Filter Chips (Hub Personal) -->',
      '  <div class="trophy-categories-bar" id="hub-trophy-categories-bar">',
      chipsHtml,
      '  </div>',
      '  <!-- 4. Search & Status Filter Bar (Hub Personal) -->',
      '  <div class="trophy-search-filter-bar" id="hub-trophy-search-filter-bar">',
      '    <div class="trophy-search-input-wrap">',
      '      <span class="trophy-search-icon">🔍</span>',
      '      <input type="text" id="hub-trophy-search-input" class="trophy-search-input" ',
      '             placeholder="Search all 105 honors by title, keyword, or feat..." ',
      '             value="' + escapeHtml(currentTrophySearch) + '" ',
      '             oninput="window.BadgesUI.onSearchInput(this.value)">',
      '      <button type="button" class="trophy-search-clear" id="hub-trophy-search-clear" onclick="window.BadgesUI.clearSearch()" style="display:' + (currentTrophySearch ? 'inline-flex' : 'none') + ';">✕</button>',
      '    </div>',
      '    <div class="trophy-status-toggles" id="hub-trophy-status-toggles">',
      '      <button type="button" class="trophy-status-btn ' + (currentTrophyStatus === 'all' ? 'active' : '') + '" onclick="window.BadgesUI.setStatusFilter(\'all\')">All</button>',
      '      <button type="button" class="trophy-status-btn ' + (currentTrophyStatus === 'unlocked' ? 'active' : '') + '" onclick="window.BadgesUI.setStatusFilter(\'unlocked\')">Unlocked (' + badgeCount + ')</button>',
      '      <button type="button" class="trophy-status-btn ' + (currentTrophyStatus === 'locked' ? 'active' : '') + '" onclick="window.BadgesUI.setStatusFilter(\'locked\')">Locked (' + (totalBadges - badgeCount) + ')</button>',
      '    </div>',
      '  </div>',
      '  <!-- 5. Trophies Grid (Hub Personal) -->',
      '  <div class="trophy-grid" id="hub-trophy-grid-container">',
      renderTrophyCards(badges, isSelf, playerId),
      '  </div>',
      '</div>'
    ].join('\n');

    containerEl.innerHTML = hubHtml;
  }

  /**
   * Renders only the unlocked trophies for Public Profile showcase mode
   * Strictly omits personal glory points and pin buttons
   */
  function renderPublicTrophyCards(unlockedBadges, seasonScope) {
    if (!unlockedBadges || unlockedBadges.length === 0) {
      var emptyMsg = seasonScope
        ? 'This competitor has not yet unlocked achievements in the ' + escapeHtml(seasonScope) + ' campaign.'
        : 'This competitor has not yet unlocked battlefield achievements in sanctioned play.';
      var emptyTitle = seasonScope
        ? 'No ' + escapeHtml(seasonScope) + ' Honors Unlocked Yet'
        : 'No Battle Honors Unlocked Yet';
      return [
        '<div class="trophy-empty-state" style="grid-column: 1 / -1; padding: 3rem 1rem; text-align: center; color: var(--text-muted); background: rgba(15, 23, 42, 0.4); border-radius: var(--radius-md); border: 1px dashed var(--border);">',
        '  <div style="font-size: 2.2rem; margin-bottom: 0.75rem;">' + (seasonScope ? '⚡' : '🛡️') + '</div>',
        '  <div style="font-weight: 700; color: #fff; font-size: 1.05rem; margin-bottom: 0.35rem;">' + emptyTitle + '</div>',
        '  <div style="font-size: 0.85rem; color: #94a3b8;">' + emptyMsg + '</div>',
        '</div>'
      ].join('\n');
    }

    return unlockedBadges.map(function(b) {
      var rarity = b.rarity || 'common';
      var title = b.name || 'Honor';
      var desc = b.description || '';
      var icon = b.icon || '⚔️';
      var isCapstone = b.category === 'capstone';

      var provenanceHtml = '';
      if (b.provenance) {
        provenanceHtml = [
          '<div class="trophy-card-provenance" title="' + escapeHtml(b.provenance) + '">',
          '  <span class="prov-check">✓</span> ' + escapeHtml(b.provenance),
          '</div>'
        ].join('');
      }

      var seasonTag = (b.scope === 'seasonal' || b.season)
        ? '<span class="trophy-rarity-pill trophy-season-pill" style="font-size: 0.65rem; padding: 0.15rem 0.45rem;">⚡ \'26</span>'
        : '';

      return [
        '<div class="trophy-card unlocked rarity-' + escapeHtml(rarity) + (isCapstone ? ' capstone-card' : '') + '" ',
        '     onclick="window.BadgesUI.openTrophyModal(\'' + escapeHtml(b.id) + '\', true)">',
        '  <div class="trophy-card-top">',
        '    <div class="trophy-card-icon-wrap glow">',
        '      <span class="trophy-card-icon">' + icon + '</span>',
        '    </div>',
        '    <div class="trophy-card-badges">',
        seasonTag,
        '      <span class="trophy-rarity-pill rarity-' + escapeHtml(rarity) + '">' + escapeHtml(b.rarity_label || rarity) + '</span>',
        '    </div>',
        '  </div>',
        '  <div class="trophy-card-body">',
        '    <div class="trophy-card-cat">' + escapeHtml(b.category_title || b.category) + '</div>',
        '    <h4 class="trophy-card-title">' + escapeHtml(title) + '</h4>',
        '    <p class="trophy-card-desc">' + escapeHtml(desc) + '</p>',
        provenanceHtml,
        '  </div>',
        '  <div class="trophy-card-footer">',
        '    <span class="trophy-card-status earned">',
        '      🏆 Earned',
        '    </span>',
        '  </div>',
        '</div>'
      ].join('\n');
    }).join('\n');
  }

  /**
   * Renders the cards in the seasonal grid given the current filters (for My Hub)
   */
  function renderSeasonalTrophyCards(badges, isSelf, playerId) {
    badges = badges || [];
    var search = currentSeasonalSearch.toLowerCase().trim();
    var cat = currentSeasonalCategory;
    var status = currentSeasonalStatus;

    var filtered = badges.filter(function(b) {
      if (cat !== 'all' && b.category !== cat) return false;
      if (status === 'unlocked' && !b.unlocked) return false;
      if (status === 'locked' && b.unlocked) return false;
      if (search) {
        var nameMatch = (b.name || '').toLowerCase().includes(search);
        var descMatch = (b.description || '').toLowerCase().includes(search);
        var catMatch = (b.category_title || '').toLowerCase().includes(search);
        var provMatch = (b.provenance || '').toLowerCase().includes(search);
        if (!nameMatch && !descMatch && !catMatch && !provMatch) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      return [
        '<div class="trophy-empty-state" style="grid-column: 1 / -1; padding: 3rem 1rem; text-align: center; color: var(--text-muted); background: rgba(15, 23, 42, 0.4); border-radius: var(--radius-md); border: 1px dashed var(--border);">',
        '  <div style="font-size: 2.2rem; margin-bottom: 0.75rem;">⚡</div>',
        '  <div style="font-weight: 700; color: #fff; font-size: 1.05rem; margin-bottom: 0.35rem;">No Season 2026 Honors Found</div>',
        '  <div style="font-size: 0.85rem; color: #94a3b8;">Try adjusting your search query or selecting another campaign category.</div>',
        '</div>'
      ].join('\n');
    }

    var pinnedIds = new Set(((activeHubTrophyData || activeTrophyData) && (activeHubTrophyData || activeTrophyData).pinned_badges || []).map(function(x) { return x.id; }));

    return filtered.map(function(b) {
      var isUnlocked = !!b.unlocked;
      var isPinned = pinnedIds.has(b.id);
      var rarity = b.rarity || 'common';
      var isCapstone = b.category === 'capstone';
      var title = b.name || 'Honor';
      var desc = b.description || '';
      var icon = b.icon || '⚔️';
      var gloryVal = b.glory || b.glory_points || 25;

      var pinBtnHtml = '';
      if (isSelf && isUnlocked) {
        var pinLabel = isPinned ? '★ Pinned' : '📌 Pin';
        var pinClass = isPinned ? 'is-pinned' : '';
        pinBtnHtml = [
          '<button type="button" class="trophy-pin-btn ' + pinClass + '" ',
          '        onclick="event.stopPropagation(); window.BadgesUI.togglePin(\'' + escapeHtml(b.id) + '\');" ',
          '        title="' + (isPinned ? 'Unpin from Hero Profile Card' : 'Pin to Hero Profile Card') + '">',
          '  ' + pinLabel,
          '</button>'
        ].join('');
      }

      var progressHtml = '';
      if (!isUnlocked && b.progress && b.progress.target) {
        var cur = b.progress.current || 0;
        var tgt = b.progress.target || 1;
        var pct = Math.min(100, Math.round((cur / tgt) * 100));
        progressHtml = [
          '<div class="trophy-card-progress">',
          '  <div class="trophy-card-progress-bar">',
          '    <div class="trophy-card-progress-fill" style="width: ' + pct + '%;' + (isCapstone ? ' background: linear-gradient(90deg, #f43f5e, #fbbf24);' : '') + '"></div>',
          '  </div>',
          '  <div class="trophy-card-progress-lbl">' + cur + ' / ' + tgt + ' ' + (b.progress.unit || '') + ' (' + pct + '%)</div>',
          '</div>'
        ].join('\n');
      }

      var provenanceHtml = '';
      if (isUnlocked && b.provenance) {
        provenanceHtml = [
          '<div class="trophy-card-provenance" title="' + escapeHtml(b.provenance) + '">',
          '  <span class="prov-check">✓</span> ' + escapeHtml(b.provenance),
          '</div>'
        ].join('');
      }

      return [
        '<div class="trophy-card ' + (isUnlocked ? 'unlocked' : 'locked') + ' rarity-' + escapeHtml(rarity) + (isCapstone ? ' capstone-card' : '') + '" ',
        '     onclick="window.BadgesUI.openTrophyModal(\'' + escapeHtml(b.id) + '\', false)">',
        '  <div class="trophy-card-top">',
        '    <div class="trophy-card-icon-wrap ' + (isUnlocked ? 'glow' : 'silhouette') + '">',
        '      <span class="trophy-card-icon">' + icon + '</span>',
        '    </div>',
        '    <div class="trophy-card-badges">',
        '      <span class="trophy-rarity-pill trophy-season-pill" style="font-size: 0.65rem; padding: 0.15rem 0.45rem;">⚡ \'26</span>',
        '      <span class="trophy-rarity-pill rarity-' + escapeHtml(rarity) + '">' + escapeHtml(b.rarity_label || rarity) + '</span>',
        '      <span class="trophy-glory-pill">+' + gloryVal + ' Glory</span>',
        '    </div>',
        '  </div>',
        '  <div class="trophy-card-body">',
        '    <div class="trophy-card-cat">' + escapeHtml(b.category_title || b.category) + '</div>',
        '    <h4 class="trophy-card-title">' + escapeHtml(title) + '</h4>',
        '    <p class="trophy-card-desc">' + escapeHtml(desc) + '</p>',
        progressHtml,
        provenanceHtml,
        '  </div>',
        '  <div class="trophy-card-footer">',
        '    <span class="trophy-card-status ' + (isUnlocked ? 'earned' : 'locked') + '">',
        '      ' + (isUnlocked ? '🏆 Earned' : '🔒 In Progress'),
        '    </span>',
        pinBtnHtml,
        '  </div>',
        '</div>'
      ].join('\n');
    }).join('\n');
  }

  /**
   * Renders the cards in the grid given the current filters (for My Hub)
   */
  function renderTrophyCards(badges, isSelf, playerId) {
    badges = badges || [];
    var search = currentTrophySearch.toLowerCase().trim();
    var cat = currentTrophyCategory;
    var status = currentTrophyStatus;

    var filtered = badges.filter(function(b) {
      if (cat !== 'all' && b.category !== cat) return false;
      if (status === 'unlocked' && !b.unlocked) return false;
      if (status === 'locked' && b.unlocked) return false;
      if (search) {
        var nameMatch = (b.name || '').toLowerCase().includes(search);
        var descMatch = (b.description || '').toLowerCase().includes(search);
        var catMatch = (b.category_title || '').toLowerCase().includes(search);
        var provMatch = (b.provenance || '').toLowerCase().includes(search);
        if (!nameMatch && !descMatch && !catMatch && !provMatch) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      return [
        '<div class="trophy-empty-state" style="grid-column: 1 / -1; padding: 3rem 1rem; text-align: center; color: var(--text-muted); background: rgba(15, 23, 42, 0.4); border-radius: var(--radius-md); border: 1px dashed var(--border);">',
        '  <div style="font-size: 2.2rem; margin-bottom: 0.75rem;">🛡️</div>',
        '  <div style="font-weight: 700; color: #fff; font-size: 1.05rem; margin-bottom: 0.35rem;">No Battle Honors Found</div>',
        '  <div style="font-size: 0.85rem; color: #94a3b8;">Try clearing your search query or selecting a different discipline category.</div>',
        '</div>'
      ].join('\n');
    }

    var pinnedIds = new Set(((activeHubTrophyData || activeTrophyData) && (activeHubTrophyData || activeTrophyData).pinned_badges || []).map(function(x) { return x.id; }));

    return filtered.map(function(b) {
      var isUnlocked = !!b.unlocked;
      var isPinned = pinnedIds.has(b.id);
      var rarity = b.rarity || 'common';
      var isSecret = !!b.is_secret && !isUnlocked;
      var title = isSecret ? 'Secret Battlefield Honor' : (b.name || 'Honor');
      var desc = isSecret ? (b.hint || 'A mysterious feat awaiting discovery on the competitive field.') : (b.description || '');
      var icon = isSecret ? '❓' : (b.icon || '⚔️');

      var pinBtnHtml = '';
      if (isSelf && isUnlocked) {
        var pinLabel = isPinned ? '★ Pinned' : '📌 Pin';
        var pinClass = isPinned ? 'is-pinned' : '';
        pinBtnHtml = [
          '<button type="button" class="trophy-pin-btn ' + pinClass + '" ',
          '        onclick="event.stopPropagation(); window.BadgesUI.togglePin(\'' + escapeHtml(b.id) + '\');" ',
          '        title="' + (isPinned ? 'Unpin from Hero Profile Card' : 'Pin to Hero Profile Card') + '">',
          '  ' + pinLabel,
          '</button>'
        ].join('');
      }

      var progressHtml = '';
      if (!isUnlocked && b.progress && b.progress.target) {
        var cur = b.progress.current || 0;
        var tgt = b.progress.target || 1;
        var pct = Math.min(100, Math.round((cur / tgt) * 100));
        progressHtml = [
          '<div class="trophy-card-progress">',
          '  <div class="trophy-card-progress-bar">',
          '    <div class="trophy-card-progress-fill" style="width: ' + pct + '%;"></div>',
          '  </div>',
          '  <div class="trophy-card-progress-lbl">' + cur + ' / ' + tgt + ' ' + (b.progress.unit || '') + ' (' + pct + '%)</div>',
          '</div>'
        ].join('\n');
      }

      var provenanceHtml = '';
      if (isUnlocked && b.provenance) {
        provenanceHtml = [
          '<div class="trophy-card-provenance" title="' + escapeHtml(b.provenance) + '">',
          '  <span class="prov-check">✓</span> ' + escapeHtml(b.provenance),
          '</div>'
        ].join('');
      }

      return [
        '<div class="trophy-card ' + (isUnlocked ? 'unlocked' : 'locked') + ' rarity-' + escapeHtml(rarity) + '" ',
        '     onclick="window.BadgesUI.openTrophyModal(\'' + escapeHtml(b.id) + '\', false)">',
        '  <div class="trophy-card-top">',
        '    <div class="trophy-card-icon-wrap ' + (isUnlocked ? 'glow' : 'silhouette') + '">',
        '      <span class="trophy-card-icon">' + icon + '</span>',
        '    </div>',
        '    <div class="trophy-card-badges">',
        '      <span class="trophy-rarity-pill rarity-' + escapeHtml(rarity) + '">' + escapeHtml(b.rarity_label || rarity) + '</span>',
        '      <span class="trophy-glory-pill">+' + (b.glory_points || 10) + ' Glory</span>',
        '    </div>',
        '  </div>',
        '  <div class="trophy-card-body">',
        '    <div class="trophy-card-cat">' + escapeHtml(b.category_title || b.category) + '</div>',
        '    <h4 class="trophy-card-title">' + escapeHtml(title) + '</h4>',
        '    <p class="trophy-card-desc">' + escapeHtml(desc) + '</p>',
        progressHtml,
        provenanceHtml,
        '  </div>',
        '  <div class="trophy-card-footer">',
        '    <span class="trophy-card-status ' + (isUnlocked ? 'earned' : 'locked') + '">',
        '      ' + (isUnlocked ? '🏆 Earned' : '🔒 Locked'),
        '    </span>',
        pinBtnHtml,
        '  </div>',
        '</div>'
      ].join('\n');
    }).join('\n');
  }

  /**
   * Refreshes the Hub trophy grid in place without rebuilding the whole tab
   */
  function refreshGrid() {
    var container = document.getElementById('hub-trophy-grid-container') || document.getElementById('trophy-grid-container');
    var data = activeHubTrophyData || activeTrophyData;
    if (!container || !data) return;
    var isSelf = (typeof currentUser !== 'undefined' && currentUser && data.player &&
                  (currentUser.player_id === data.player.player_id || currentUser.id === data.account_user_id)) || true;
    var playerId = data.player && data.player.player_id;

    if (currentHubScope === 'seasonal') {
      var sData = getSeasonalData(data);
      var seasonalBadges = sData ? (sData.badges || []) : [];
      container.innerHTML = renderSeasonalTrophyCards(seasonalBadges, isSelf, playerId);
    } else {
      container.innerHTML = renderTrophyCards(data.badges, isSelf, playerId);
    }
  }

  /**
   * Category filter selection (My Hub - Career)
   */
  function setCategory(cat) {
    currentTrophyCategory = cat;
    var bar = document.getElementById('hub-trophy-categories-bar') || document.getElementById('trophy-categories-bar');
    if (bar) {
      bar.querySelectorAll('.trophy-category-chip').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-cat') === cat);
      });
    }
    refreshGrid();
  }

  /**
   * Status filter selection (My Hub - Career)
   */
  function setStatusFilter(status) {
    currentTrophyStatus = status;
    var bar = document.getElementById('hub-trophy-status-toggles') || document.querySelector('.trophy-status-toggles');
    if (bar) {
      bar.querySelectorAll('.trophy-status-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.textContent.toLowerCase().includes(status));
      });
    }
    refreshGrid();
  }

  /**
   * Search input handler (My Hub - Career)
   */
  function onSearchInput(val) {
    currentTrophySearch = val || '';
    var clearBtn = document.getElementById('hub-trophy-search-clear') || document.getElementById('trophy-search-clear');
    if (clearBtn) {
      clearBtn.style.display = currentTrophySearch ? 'inline-flex' : 'none';
    }
    refreshGrid();
  }

  function clearSearch() {
    currentTrophySearch = '';
    var inp = document.getElementById('hub-trophy-search-input') || document.getElementById('trophy-search-input');
    if (inp) inp.value = '';
    var clearBtn = document.getElementById('hub-trophy-search-clear') || document.getElementById('trophy-search-clear');
    if (clearBtn) clearBtn.style.display = 'none';
    refreshGrid();
  }

  /**
   * Seasonal filter handlers (My Hub - Season 2026)
   */
  function setSeasonalCategory(cat) {
    currentSeasonalCategory = cat;
    var bar = document.getElementById('hub-trophy-categories-bar');
    if (bar) {
      bar.querySelectorAll('.trophy-category-chip').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-cat') === cat);
      });
    }
    refreshGrid();
  }

  function setSeasonalStatusFilter(status) {
    currentSeasonalStatus = status;
    var bar = document.getElementById('hub-trophy-status-toggles');
    if (bar) {
      bar.querySelectorAll('.trophy-status-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.textContent.toLowerCase().includes(status));
      });
    }
    refreshGrid();
  }

  function onSeasonalSearchInput(val) {
    currentSeasonalSearch = val || '';
    var clearBtn = document.getElementById('hub-trophy-search-clear');
    if (clearBtn) {
      clearBtn.style.display = currentSeasonalSearch ? 'inline-flex' : 'none';
    }
    refreshGrid();
  }

  function clearSeasonalSearch() {
    currentSeasonalSearch = '';
    var inp = document.getElementById('hub-trophy-search-input');
    if (inp) inp.value = '';
    var clearBtn = document.getElementById('hub-trophy-search-clear');
    if (clearBtn) clearBtn.style.display = 'none';
    refreshGrid();
  }

  /**
   * Opens the High-Resolution Trophy Detail Modal
   * When isPublic is true, personal Glory points and Pin buttons are strictly omitted
   */
  function openTrophyModal(badgeId, isPublic) {
    var data = isPublic ? (activePublicTrophyData || activeTrophyData) : (activeHubTrophyData || activeTrophyData);
    if (!data) {
      data = activeTrophyData || activePublicTrophyData || activeHubTrophyData;
    }
    if (!data) return;

    var badge = findBadgeInAllData(data, badgeId);
    if (!badge) {
      var otherData = isPublic ? activeHubTrophyData : activePublicTrophyData;
      badge = findBadgeInAllData(otherData, badgeId);
    }
    if (!badge) return;

    var modalId = 'trophy-detail-modal';
    var existing = document.getElementById(modalId);
    if (existing) existing.remove();

    var isUnlocked = !!badge.unlocked;
    var rarity = badge.rarity || 'common';
    var isSecret = !!badge.is_secret && !isUnlocked;
    var isSeasonal = badge.scope === 'seasonal' || !!badge.season;
    var isCapstone = badge.category === 'capstone';
    var title = isSecret ? 'Secret Battlefield Honor' : badge.name;
    var desc = isSecret ? (badge.hint || 'This honor is shrouded in battlefield mystery. Unlock it through decisive play.') : badge.description;
    var icon = isSecret ? '❓' : (badge.icon || '⚔️');
    var gloryVal = badge.glory || badge.glory_points || 10;

    var catText = isSeasonal
      ? ('Season ' + (badge.season || '2026') + ' Campaign • ' + (badge.category_title || badge.category))
      : (badge.category_title || badge.category);

    // Pin button: only for personal command hub (isPublic is false), if self & unlocked
    var pinBtnHtml = '';
    if (!isPublic && isUnlocked) {
      var isSelf = (typeof currentUser !== 'undefined' && currentUser && data.player &&
                    (currentUser.player_id === data.player.player_id || currentUser.id === data.account_user_id)) || true;
      if (isSelf) {
        var pinnedIds = new Set(((activeHubTrophyData || activeTrophyData).pinned_badges || []).map(function(x) { return x.id; }));
        var isPinned = pinnedIds.has(badge.id);
        pinBtnHtml = [
          '<button type="button" class="btn ' + (isPinned ? 'btn-secondary' : 'btn-primary') + '" ',
          '        onclick="window.BadgesUI.togglePin(\'' + escapeHtml(badge.id) + '\'); window.BadgesUI.closeTrophyModal();" ',
          '        style="display: flex; align-items: center; gap: 0.4rem;">',
          '  <span>' + (isPinned ? '★ Unpin from Hero' : '📌 Pin to Profile Hero') + '</span>',
          '</button>'
        ].join('');
      }
    }

    // Glory points pill: only in My Hub (isPublic is false)
    var gloryPillHtml = '';
    if (!isPublic) {
      gloryPillHtml = '<span class="trophy-glory-pill">+' + gloryVal + ' Glory Points</span>';
    }

    var seasonPillHtml = isSeasonal
      ? '<span class="trophy-rarity-pill trophy-season-pill" style="font-size: 0.7rem; padding: 0.15rem 0.55rem;">⚡ Season ' + (badge.season || '2026') + '</span>'
      : '';

    var progressHtml = '';
    if (!isUnlocked && badge.progress && badge.progress.target) {
      var cur = badge.progress.current || 0;
      var tgt = badge.progress.target || 1;
      var pct = Math.min(100, Math.round((cur / tgt) * 100));
      progressHtml = [
        '<div style="margin: 1rem 0; padding: 0.85rem; background: rgba(15, 23, 42, 0.6); border-radius: var(--radius-sm); border: 1px solid var(--border);">' +
        '  <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 0.35rem;">' +
        '    <span style="color: var(--text-secondary);">' + (isSeasonal ? 'Campaign Feat Progress' : 'Campaign Progress') + '</span>' +
        '    <span style="font-weight: 700; color: #fff;">' + cur + ' / ' + tgt + ' ' + (badge.progress.unit || '') + ' (' + pct + '%)</span>' +
        '  </div>' +
        '  <div style="width: 100%; height: 6px; background: rgba(255, 255, 255, 0.1); border-radius: 9999px; overflow: hidden;">' +
        '    <div style="width: ' + pct + '%; height: 100%; background: ' + (isCapstone ? 'linear-gradient(90deg, #f43f5e, #fbbf24)' : 'linear-gradient(90deg, #38bdf8, #818cf8)') + '; border-radius: 9999px;"></div>' +
        '  </div>' +
        '</div>'
      ].join('\n');
    }

    var modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal-backdrop active';
    modal.style.zIndex = '9999';
    modal.innerHTML = [
      '<div class="modal-card" style="max-width: 520px; border-radius: var(--radius-md); background: #0f172a; border: 1.5px solid ' + (badge.border || 'var(--border)') + '; box-shadow: 0 10px 40px rgba(0,0,0,0.7); overflow: hidden;">',
      '  <!-- Header / Wax Purity Ribbon Aura -->',
      '  <div style="padding: 1.5rem; text-align: center; background: radial-gradient(circle at top, ' + (badge.border || 'rgba(56, 189, 248, 0.2)') + ', transparent 70%); border-bottom: 1px solid rgba(255,255,255,0.08); position: relative;">',
      '    <button type="button" class="modal-close" onclick="window.BadgesUI.closeTrophyModal()" style="position: absolute; top: 1rem; right: 1rem; background: none; border: none; font-size: 1.4rem; color: #94a3b8; cursor: pointer;">✕</button>',
      '    <div style="width: 80px; height: 80px; margin: 0 auto 1rem; border-radius: 20px; display: flex; align-items: center; justify-content: center; font-size: 3rem; background: rgba(15, 23, 42, 0.9); border: 2px solid ' + (badge.border || 'var(--border)') + '; box-shadow: 0 0 25px ' + (badge.border || 'rgba(0,0,0,0.5)') + ';">',
      '      ' + icon,
      '    </div>',
      '    <div style="display: flex; align-items: center; justify-content: center; gap: 0.5rem; margin-bottom: 0.5rem; flex-wrap: wrap;">',
      seasonPillHtml,
      '      <span class="trophy-rarity-pill rarity-' + escapeHtml(rarity) + '">' + escapeHtml(badge.rarity_label || rarity) + '</span>',
      gloryPillHtml,
      '    </div>',
      '    <h3 style="font-size: 1.4rem; font-weight: 800; color: #fff; margin: 0.2rem 0; letter-spacing: -0.01em;">' + escapeHtml(title) + '</h3>',
      '    <div style="font-size: 0.82rem; color: #94a3b8; font-weight: 600;">' + escapeHtml(catText) + '</div>',
      '  </div>',
      '  <!-- Body -->',
      '  <div style="padding: 1.5rem;">',
      '    <div style="font-size: 0.95rem; color: #e2e8f0; line-height: 1.5; margin-bottom: 1rem;">',
      '      ' + escapeHtml(desc),
      '    </div>',
      progressHtml,
      '    <div style="padding: 0.85rem; background: rgba(255,255,255,0.03); border-radius: var(--radius-sm); border: 1px solid rgba(255,255,255,0.06); font-size: 0.82rem;">',
      '      <div style="display: flex; justify-content: space-between; margin-bottom: 0.35rem;">',
      '        <span style="color: var(--text-muted);">Status:</span>',
      '        <span style="font-weight: 700; color: ' + (isUnlocked ? '#10b981' : '#f59e0b') + ';">' + (isUnlocked ? '✓ Unlocked' : '🔒 In Progress') + '</span>',
      '      </div>',
      (isSeasonal ? '<div style="display: flex; justify-content: space-between; margin-bottom: 0.35rem;"><span style="color: var(--text-muted);">Circuit:</span><span style="color: #fbbf24; font-weight: 600;">Season ' + (badge.season || '2026') + ' Annual Campaign</span></div>' : ''),
      (badge.unlocked_at ? '<div style="display: flex; justify-content: space-between; margin-bottom: 0.35rem;"><span style="color: var(--text-muted);">Unlocked On:</span><span style="color: #fff; font-family: var(--font-mono);">' + escapeHtml(badge.unlocked_at) + '</span></div>' : ''),
      (badge.provenance ? '<div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid rgba(255,255,255,0.06); color: #38bdf8;"><span style="font-weight: 700;">Battle Provenance:</span> ' + escapeHtml(badge.provenance) + '</div>' : ''),
      '    </div>',
      '  </div>',
      '  <!-- Footer Actions -->',
      '  <div style="padding: 1rem 1.5rem; background: rgba(15, 23, 42, 0.95); border-top: 1px solid rgba(255,255,255,0.06); display: flex; justify-content: space-between; align-items: center;">',
      '    <div>' + pinBtnHtml + '</div>',
      '    <button type="button" class="btn btn-secondary" onclick="window.BadgesUI.closeTrophyModal()">Close</button>',
      '  </div>',
      '</div>'
    ].join('\n');

    document.body.appendChild(modal);
  }

  function closeTrophyModal() {
    var modal = document.getElementById('trophy-detail-modal');
    if (modal) modal.remove();
  }

  /**
   * Toggles pinning of a badge (maximum 3 badges pinned to Hero Profile Card)
   */
  async function togglePin(badgeId) {
    var data = activeHubTrophyData || activeTrophyData;
    if (!data) return;
    var pinned = data.pinned_badges || [];
    var existingIdx = pinned.findIndex(function(b) { return b.id === badgeId; });

    if (existingIdx >= 0) {
      pinned.splice(existingIdx, 1);
    } else {
      if (pinned.length >= 3) {
        if (typeof showToast === 'function') {
          showToast('You can only pin up to 3 signature honors to your Hero Card.', 'warning');
        } else {
          alert('You can only pin up to 3 signature honors.');
        }
        return;
      }
      var target = findBadgeInAllData(data, badgeId);
      if (target && target.unlocked) {
        pinned.push(target);
      }
    }

    data.pinned_badges = pinned;
    var pinnedIds = pinned.map(function(b) { return b.id; });

    // Sync to API & localStorage
    try {
      localStorage.setItem('omnitactica_pinned_badges', JSON.stringify(pinnedIds));
      if (window.api && typeof window.api.pinBadges === 'function') {
        await window.api.pinBadges(pinnedIds);
      }
    } catch (e) {
      console.warn("Could not save pinned badges to backend:", e);
    }

    // Refresh UI components
    refreshGrid();

    // Re-render hero medals rack
    var rackContainer = document.getElementById('hero-pinned-medals');
    if (rackContainer) {
      var isSelf = (typeof currentUser !== 'undefined' && currentUser && data.player &&
                    (currentUser.player_id === data.player.player_id || currentUser.id === data.account_user_id)) || true;
      rackContainer.outerHTML = renderPinnedMedals(pinned, data.badge_count, isSelf, 'switchHubSubtab');
    }

    if (typeof showToast === 'function') {
      showToast(existingIdx >= 0 ? 'Honor unpinned from Hero card.' : 'Honor pinned to Hero card!', 'success');
    }
  }

  /**
   * One-time welcome celebration modal for existing players
   * Prevents popup flooding: batches all historical honors into 1 single high-command commendation
   */
  /**
   * Consolidated Welcome / Incremental Celebration Modal
   * Guarantees that on visiting the profile, players only EVER see 1 consolidated modal
   * summarizing all newly earned badges since their last check-in.
   */
  function checkFirstTimeCelebration(data, userId) {
    if (!data) return;

    // 1. Determine newly unlocked badges
    var newlyUnlocked = [];
    if (Array.isArray(data.newly_unlocked_badges)) {
      newlyUnlocked = data.newly_unlocked_badges;
      // If 0 newly unlocked badges, NEVER show any modal (completely silent)
      if (newlyUnlocked.length === 0) return;
    } else {
      // Fallback for standalone / legacy mock payloads
      if (!data.badge_count || data.badge_count === 0 || data.badges_celebrated) return;
      newlyUnlocked = (data.badges || []).filter(function(b) { return b.unlocked; });
      if (newlyUnlocked.length === 0) return;
    }

    var userKey = 'ot_badges_celebrated_' + (userId || 'guest');
    var isIncremental = Array.isArray(data.acknowledged_badge_ids) && data.acknowledged_badge_ids.length > 0;
    var newlyUnlockedIds = newlyUnlocked.map(function(b) { return b.id; });
    var batchHash = newlyUnlockedIds.slice().sort().join(',');

    // Fast localStorage check to prevent duplicate modal popups within the same browser session
    try {
      if (localStorage.getItem('ot_last_ack_hash_' + (userId || 'guest')) === batchHash) return;
    } catch (e) {}

    showCelebrationModal(data, newlyUnlocked, isIncremental, userKey, userId, newlyUnlockedIds, batchHash);
  }

  function showCelebrationModal(data, newlyUnlocked, isIncremental, userKey, userId, newlyUnlockedIds, batchHash) {
    var existing = document.getElementById('badges-celebration-modal');
    if (existing) existing.remove();

    var rank = data.rank || { title: 'Initiate', rank: 1, icon: '🛡️' };
    var totalBadgeCount = data.badge_count || newlyUnlocked.length;
    var glory = data.glory_score || 0;

    var headerTag = isIncremental ? '🎖️ Battlefield Honor Commendation' : '🎖️ High Command Commendation';
    var headerTitle = isIncremental
      ? newlyUnlocked.length + ' New Battlefield Honor' + (newlyUnlocked.length > 1 ? 's' : '') + ' Earned!'
      : 'Tournament Honors Bestowed!';
    var headerSub = isIncremental
      ? 'High Command has verified new competitive achievements completed since your last visit:'
      : 'High Command has audited your competitive career. Based on your official tournament history, your service has been recognized:';

    var showcaseItems = isIncremental ? newlyUnlocked : (data.pinned_badges && data.pinned_badges.length ? data.pinned_badges : newlyUnlocked.slice(0, 3));
    var showcaseHtml = showcaseItems.slice(0, 4).map(function(b) {
      return [
        '<div style="flex: 1; min-width: 90px; padding: 0.65rem 0.5rem; background: rgba(15, 23, 42, 0.7); border-radius: var(--radius-sm); border: 1px solid ' + (b.border || 'var(--border)') + '; text-align: center;">',
        '  <div style="font-size: 1.6rem; margin-bottom: 0.25rem;">' + (b.icon || '⚔️') + '</div>',
        '  <div style="font-size: 0.78rem; font-weight: 700; color: #fff; margin-bottom: 0.2rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + escapeHtml(b.name) + '</div>',
        '  <span class="trophy-rarity-pill rarity-' + escapeHtml(b.rarity) + '" style="font-size: 0.65rem; padding: 0.15rem 0.4rem;">' + escapeHtml(b.rarity_label || b.rarity) + '</span>',
        '</div>'
      ].join('');
    }).join('');

    var moreCountText = '';
    if (showcaseItems.length > 4) {
      moreCountText = '<div style="text-align: center; font-size: 0.75rem; color: #94a3b8; margin-top: 0.4rem;">+' + (showcaseItems.length - 4) + ' more honors unlocked!</div>';
    }

    var idsJson = JSON.stringify(newlyUnlockedIds).replace(/"/g, '&quot;');

    var modal = document.createElement('div');
    modal.id = 'badges-celebration-modal';
    modal.className = 'modal-backdrop active';
    modal.style.zIndex = '100000';
    modal.innerHTML = [
      '<div class="modal-card" style="max-width: 520px; background: #0f172a; border-radius: var(--radius-lg); border: 1.5px solid rgba(245, 158, 11, 0.7); box-shadow: 0 10px 40px rgba(0,0,0,0.8), 0 0 30px rgba(245, 158, 11, 0.25); overflow: hidden;">',
      '  <div style="padding: 1.75rem 1.5rem 1.25rem; text-align: center; background: radial-gradient(circle at top, rgba(245, 158, 11, 0.25), transparent 75%); border-bottom: 1px solid rgba(255,255,255,0.08); position: relative;">',
      '    <button type="button" class="modal-close" onclick="window.BadgesUI.closeCelebrationModal(\'' + escapeHtml(userKey) + '\', \'' + escapeHtml(userId || '') + '\', ' + idsJson + ', \'' + escapeHtml(batchHash) + '\')" style="position: absolute; top: 1rem; right: 1rem; background: none; border: none; font-size: 1.4rem; color: #94a3b8; cursor: pointer;">✕</button>',
      '    <div style="display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.72rem; font-weight: 800; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.08em; background: rgba(245, 158, 11, 0.15); padding: 0.25rem 0.75rem; border-radius: 9999px; border: 1px solid rgba(245, 158, 11, 0.3); margin-bottom: 0.65rem;">' + headerTag + '</div>',
      '    <h2 style="font-size: 1.5rem; font-weight: 800; color: #fff; margin: 0 0 0.4rem; letter-spacing: -0.02em;">' + headerTitle + '</h2>',
      '    <div style="font-size: 0.88rem; color: #cbd5e1; line-height: 1.45; max-width: 440px; margin: 0 auto;">' + headerSub + '</div>',
      '    <div style="display: flex; align-items: center; justify-content: center; gap: 0.85rem; margin-top: 1rem;">',
      '      <div style="flex: 1; padding: 0.55rem 0.8rem; background: rgba(255,255,255,0.04); border-radius: var(--radius-sm); border: 1px solid rgba(255,255,255,0.08); text-align: center;">',
      '        <div style="font-size: 1.3rem; font-weight: 800; color: #fbbf24; font-family: var(--font-mono);">' + (isIncremental ? ('+' + newlyUnlocked.length) : totalBadgeCount) + '</div>',
      '        <div style="font-size: 0.68rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">' + (isIncremental ? 'New Honors' : 'Honors Unlocked') + '</div>',
      '      </div>',
      '      <div style="flex: 1; padding: 0.55rem 0.8rem; background: rgba(255,255,255,0.04); border-radius: var(--radius-sm); border: 1px solid rgba(255,255,255,0.08); text-align: center;">',
      '        <div style="font-size: 1.3rem; font-weight: 800; color: #38bdf8; font-family: var(--font-mono);">' + glory.toLocaleString() + '</div>',
      '        <div style="font-size: 0.68rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Glory Requisition</div>',
      '      </div>',
      '      <div style="flex: 1; padding: 0.55rem 0.8rem; background: rgba(255,255,255,0.04); border-radius: var(--radius-sm); border: 1px solid rgba(255,255,255,0.08); text-align: center;">',
      '        <div style="font-size: 1.3rem; font-weight: 800; color: #a855f7;">' + (rank.icon || '🛡️') + '</div>',
      '        <div style="font-size: 0.68rem; color: #cbd5e1; font-weight: 700;">' + escapeHtml(rank.title) + '</div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div style="padding: 1.25rem 1.5rem;">',
      '    <div style="font-size: 0.75rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.65rem;">' + (isIncremental ? 'Unlocked Battlefield Honors:' : 'Top Signature Honors:') + '</div>',
      '    <div style="display: flex; gap: 0.65rem; margin-bottom: 0.5rem; flex-wrap: wrap;">' + showcaseHtml + '</div>',
      moreCountText,
      '    <div style="display: flex; gap: 0.75rem; margin-top: 1.25rem;">',
      '      <button type="button" class="btn btn-primary" style="flex: 1; padding: 0.7rem 1rem; font-weight: 700;" onclick="window.BadgesUI.closeCelebrationModal(\'' + escapeHtml(userKey) + '\', \'' + escapeHtml(userId || '') + '\', ' + idsJson + ', \'' + escapeHtml(batchHash) + '\'); if (typeof switchHubSubtab === \'function\') switchHubSubtab(\'trophies\');">Inspect Trophy Room</button>',
      '      <button type="button" class="btn btn-secondary" style="padding: 0.7rem 1rem;" onclick="window.BadgesUI.closeCelebrationModal(\'' + escapeHtml(userKey) + '\', \'' + escapeHtml(userId || '') + '\', ' + idsJson + ', \'' + escapeHtml(batchHash) + '\')">' + (isIncremental ? 'Acknowledge' : 'Continue') + '</button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n');

    document.body.appendChild(modal);
  }

  function closeCelebrationModal(userKey, userId, newlyUnlockedIds, batchHash) {
    if (batchHash) {
      try { localStorage.setItem('ot_last_ack_hash_' + (userId || 'guest'), batchHash); } catch (e) {}
    }
    if (userKey) {
      try { localStorage.setItem(userKey, '1'); } catch (e) {}
    }
    // Persist acknowledged badge IDs to database so cleared cache / switching device never re-triggers the modal
    try {
      fetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acknowledged_badge_ids: newlyUnlockedIds || [],
          badges_celebrated: true
        })
      }).catch(function() {});
    } catch (e) {}
    var modal = document.getElementById('badges-celebration-modal');
    if (modal) modal.remove();
  }

  /**
   * Field Manual & Honor Codex Modal (triggered by info icon)
   */
  function openGuideModal() {
    var existing = document.getElementById('badges-guide-modal');
    if (existing) existing.remove();

    var careerCrestsData = [
      { level: 1, title: 'Initiate Crest', badges: '0 – 4', icon: '🛡️', borderText: 'Standard iron perimeter; recruit in field fatigues', desc: 'Fresh competitor taking their first steps in verified competitive play.' },
      { level: 2, title: 'Battle-Brother Crest', badges: '5 – 14', icon: '⚔️', borderText: 'Burnished bronze trim (1.5px subtle border)', desc: 'Frontline tournament combatant with proven match victories.' },
      { level: 3, title: 'Centurion Crest', badges: '15 – 29', icon: '🗡️', borderText: 'Polished cobalt steel border (1.5px trim)', desc: 'Respected squad leader, club pillar, and consistent match winner.' },
      { level: 4, title: 'Force Commander Crest', badges: '30 – 49', icon: '🎖️', borderText: 'Sterling silver border + ambient sheen', desc: 'Theater-level champion and verified regional tournament threat.' },
      { level: 5, title: 'Chapter Master Crest', badges: '50 – 69', icon: '🦅', borderText: 'Imperial gold Aquila border (1.5px gold trim)', desc: 'Powerhouse master commander battling consistently on top tables.' },
      { level: 6, title: 'High Warmaster Crest', badges: '70 – 89', icon: '🔥', borderText: 'Blazing solar flame + 25px amber halo glow', desc: 'Dominant continental champion commanding theater-wide respect.' },
      { level: 7, title: 'Primarch / Everchosen Crest', badges: '90+', icon: '👑', borderText: 'Celestial sovereign crown + astral pulsing aura', desc: 'Mythic tabletop legend at the absolute pinnacle of lifetime achievements.' }
    ];

    var careerCrestsHtml = careerCrestsData.map(function(r) {
      return [
        '<div style="display: flex; align-items: flex-start; gap: 0.85rem; padding: 0.65rem 0.85rem; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: var(--radius-sm); margin-bottom: 0.5rem;">',
        '  <div style="font-size: 1.4rem; min-width: 32px; text-align: center; margin-top: 0.1rem;">' + r.icon + '</div>',
        '  <div style="flex: 1; min-width: 0;">',
        '    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.2rem; flex-wrap: wrap;">',
        '      <span style="font-weight: 800; font-size: 0.88rem; color: #fff;">' + escapeHtml(r.title) + '</span>',
        '      <span style="font-size: 0.68rem; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3); padding: 0.1rem 0.4rem; border-radius: 9999px;">Tier ' + r.level + '/7</span>',
        '      <span style="font-size: 0.72rem; color: #94a3b8; margin-left: auto; font-family: var(--font-mono); font-weight: 700;">' + escapeHtml(r.badges) + ' Career Milestones</span>',
        '    </div>',
        '    <div style="font-size: 0.76rem; color: #cbd5e1; line-height: 1.35; margin-bottom: 0.2rem;">' + escapeHtml(r.desc) + '</div>',
        '    <div style="font-size: 0.68rem; color: #94a3b8; font-family: var(--font-mono);">' + escapeHtml(r.borderText) + '</div>',
        '  </div>',
        '</div>'
      ].join('');
    }).join('');

    var seasonalSealsData = [
      { tier: 'Pinnacle Capstone', title: 'Warmaster / Everchosen of 2026', req: '15+ Seasonal Honors', icon: '👑 \'26', borderText: 'Crimson-Gold Halo + Sovereign Crown', desc: 'Achieved by completing 15+ of the 20 seasonal campaign honors. Awards +500 Glory Requisition bounty.' },
      { tier: 'Tier 3: Champion', title: 'Season Champion (Gold)', req: '10 – 14 Seasonal Honors', icon: '🥇 \'26', borderText: 'Burnished Gold Laurel Medal', desc: 'Elite tournament mastery and sustained dedication across the annual circuit.' },
      { tier: 'Tier 2: Veteran', title: 'Season Veteran (Silver)', req: '5 – 9 Seasonal Honors', icon: '🥈 \'26', borderText: 'Sterling Silver Campaign Medal', desc: 'Active competitive participant across GTs, Companion sessions, and roster management.' },
      { tier: 'Tier 1: Enlisted', title: 'Campaign Active (Bronze)', req: '1 – 4 Seasonal Honors', icon: '⚡ \'26', borderText: 'Amber Lightning Campaign Ribbon', desc: 'Enlisted competitor with verified match play in the active annual season.' }
    ];

    var seasonalSealsHtml = seasonalSealsData.map(function(s) {
      return [
        '<div style="display: flex; align-items: flex-start; gap: 0.85rem; padding: 0.65rem 0.85rem; background: rgba(245, 158, 11, 0.04); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: var(--radius-sm); margin-bottom: 0.5rem;">',
        '  <div style="font-size: 1.25rem; font-family: var(--font-mono); font-weight: 800; min-width: 48px; text-align: center; color: #fbbf24; margin-top: 0.1rem;">' + s.icon + '</div>',
        '  <div style="flex: 1; min-width: 0;">',
        '    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.2rem; flex-wrap: wrap;">',
        '      <span style="font-weight: 800; font-size: 0.88rem; color: #fef08a;">' + escapeHtml(s.title) + '</span>',
        '      <span style="font-size: 0.68rem; font-weight: 700; color: #fbbf24; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); padding: 0.1rem 0.4rem; border-radius: 9999px;">' + s.tier + '</span>',
        '      <span style="font-size: 0.72rem; color: #fbbf24; margin-left: auto; font-family: var(--font-mono); font-weight: 700;">' + escapeHtml(s.req) + '</span>',
        '    </div>',
        '    <div style="font-size: 0.76rem; color: #cbd5e1; line-height: 1.35; margin-bottom: 0.2rem;">' + escapeHtml(s.desc) + '</div>',
        '    <div style="font-size: 0.68rem; color: #fbbf24; opacity: 0.85; font-family: var(--font-mono);">' + escapeHtml(s.borderText) + '</div>',
        '  </div>',
        '</div>'
      ].join('');
    }).join('');

    var modal = document.createElement('div');
    modal.id = 'badges-guide-modal';
    modal.className = 'modal-backdrop active';
    modal.style.zIndex = '100001';
    modal.innerHTML = [
      '<div class="modal-card" style="max-width: 660px; max-height: 90vh; background: #0f172a; border-radius: var(--radius-lg); border: 1.5px solid rgba(255, 255, 255, 0.15); box-shadow: 0 10px 40px rgba(0,0,0,0.85); display: flex; flex-direction: column; overflow: hidden;">',
      '  <div style="padding: 1.25rem 1.5rem; background: rgba(255, 255, 255, 0.02); border-bottom: 1px solid rgba(255, 255, 255, 0.08); display: flex; align-items: center; justify-content: space-between;">',
      '    <div style="display: flex; align-items: center; gap: 0.65rem;">',
      '      <div style="font-size: 1.3rem;">📖</div>',
      '      <div>',
      '        <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0;">High Command Field Manual</h3>',
      '        <div style="font-size: 0.75rem; color: #94a3b8;">Heraldic Insignia System, Seasonal Seals &amp; Unified Glory Wallet</div>',
      '      </div>',
      '    </div>',
      '    <button type="button" class="modal-close" onclick="window.BadgesUI.closeGuideModal()" style="background: none; border: none; font-size: 1.4rem; color: #94a3b8; cursor: pointer;">✕</button>',
      '  </div>',
      '  <div style="padding: 1.25rem 1.5rem; overflow-y: auto; display: flex; flex-direction: column; gap: 1.35rem;">',
      '    <!-- Section 1: Pure Icon Heraldry Overview -->',
      '    <div style="background: rgba(30, 41, 59, 0.5); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: var(--radius-sm); padding: 0.9rem 1rem;">',
      '      <h4 style="font-size: 0.86rem; font-weight: 800; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 0.35rem; display: flex; align-items: center; gap: 0.4rem;">',
      '        <span>🛡️</span> Pure Icon Heraldry &amp; Direct Navigation',
      '      </h4>',
      '      <p style="font-size: 0.8rem; color: #cbd5e1; line-height: 1.45; margin: 0 0 0.5rem;">To eliminate competing text titles and preserve valuable mobile screen real estate, your <strong>Elo Rating</strong> is the sole text ranking. Your career and annual achievements are represented by two clean, interactive insignia buttons in your header:</p>',
      '      <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; padding: 0.5rem 0.75rem; background: rgba(15, 23, 42, 0.6); border-radius: var(--radius-sm); border: 1px solid rgba(255, 255, 255, 0.06);">',
      '        <div style="display: flex; align-items: center; gap: 0.45rem; font-size: 0.78rem; color: #e2e8f0;">',
      '          <span style="font-size: 1.2rem;">🛡️</span> <strong>Career Crest:</strong> Lifetime milestone volume (Click to open Career Trophies).',
      '        </div>',
      '        <div style="display: flex; align-items: center; gap: 0.45rem; font-size: 0.78rem; color: #fbbf24;">',
      '          <span style="font-size: 1.1rem; font-family: var(--font-mono); font-weight: 800;">⚡ \'26</span> <strong>Seasonal Seal:</strong> Active 2026 circuit performance (Click to open Season 2026).',
      '        </div>',
      '      </div>',
      '    </div>',
      '    <!-- Section 2: Lifetime Career Crests -->',
      '    <div>',
      '      <h4 style="font-size: 0.85rem; font-weight: 800; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 0.4rem; display: flex; align-items: center; gap: 0.4rem;">',
      '        <span>🦅</span> 7 Lifetime Career Crests &amp; Card Border Tiers',
      '      </h4>',
      '      <p style="font-size: 0.8rem; color: #cbd5e1; line-height: 1.45; margin: 0 0 0.75rem;">Your Career Crest reflects the total number of permanent milestones unlocked across your entire competitive career. Upgrades your profile insignia and card border halo across OmniTactica.</p>',
      careerCrestsHtml,
      '    </div>',
      '    <!-- Section 3: Annual Campaign Seals -->',
      '    <div>',
      '      <h4 style="font-size: 0.85rem; font-weight: 800; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 0.4rem; display: flex; align-items: center; gap: 0.4rem;">',
      '        <span>⚡</span> Annual Campaign Seals (Season 2026 &amp; Future Circuits)',
      '      </h4>',
      '      <p style="font-size: 0.8rem; color: #cbd5e1; line-height: 1.45; margin: 0 0 0.75rem;">Every calendar year (Jan 1 – Dec 31) runs a fresh seasonal campaign. Your seasonal seal levels up as you claim 2026 honors across matches, Companion sessions, and tournaments.</p>',
      seasonalSealsHtml,
      '    </div>',
      '    <!-- Section 4: Elo vs Heraldry vs Glory Wallet -->',
      '    <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: var(--radius-sm); padding: 1rem;">',
      '      <h4 style="font-size: 0.85rem; font-weight: 800; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 0.5rem; display: flex; align-items: center; gap: 0.4rem;">',
      '        <span>💰</span> Unified Spendable Glory Wallet',
      '      </h4>',
      '      <p style="font-size: 0.8rem; color: #cbd5e1; line-height: 1.45; margin: 0 0 0.75rem;">Your spendable Glory balance pools together your <strong>Career Glory</strong> (lifetime permanent milestones) and <strong>Season 2026 Glory</strong> (annual campaign bounties). Each new season resets the annual circuit so you can earn fresh Glory points again, while keeping all past career points in your wallet.</p>',
      '      <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.74rem; color: #cbd5e1; background: rgba(255, 255, 255, 0.03); padding: 0.6rem 0.85rem; border-radius: var(--radius-sm); border: 1px solid rgba(255, 255, 255, 0.06);">',
      '        <span>Common (+10-35) • Rare (+50-125) • Epic (+150-250) • Mythic (+300-500)</span>',
      '        <a href=\"javascript:void(0)\" onclick=\"window.BadgesUI.openGloryCurrencyModal()\" style=\"color: #38bdf8; font-weight: 700; text-decoration: underline;\">Requisition Armory Intel →</a>',
      '      </div>',
      '    </div>',
      '    <!-- Section 5: Signature Honors & Secrets -->',
      '    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem;">',
      '      <div style="padding: 0.85rem; background: rgba(255, 255, 255, 0.03); border-radius: var(--radius-sm); border: 1px solid rgba(255, 255, 255, 0.07);">',
      '        <div style="font-size: 0.8rem; font-weight: 800; color: #fff; margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.35rem;"><span>📌</span> Signature Rack</div>',
      '        <div style="font-size: 0.74rem; color: #94a3b8; line-height: 1.35;">Pin up to 3 of your proudest career or seasonal honors to your Hero Card and Public Profile.</div>',
      '      </div>',
      '      <div style="padding: 0.85rem; background: rgba(255, 255, 255, 0.03); border-radius: var(--radius-sm); border: 1px solid rgba(255, 255, 255, 0.07);">',
      '        <div style="font-size: 0.8rem; font-weight: 800; color: #c084fc; margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.35rem;"><span>🕵️</span> Classified Secrets</div>',
      '        <div style="font-size: 0.74rem; color: #94a3b8; line-height: 1.35;">15 tactical battlefield feats are classified. Their criteria remain shrouded until unlocked through live competitive action.</div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div style="padding: 0.85rem 1.5rem; background: rgba(255, 255, 255, 0.02); border-top: 1px solid rgba(255, 255, 255, 0.08); text-align: right;">',
      '    <button type="button" class="btn btn-primary" onclick="window.BadgesUI.closeGuideModal()" style="padding: 0.5rem 1.25rem;">Understood, High Command</button>',
      '  </div>',
      '</div>'
    ].join('\n');

    document.body.appendChild(modal);
  }

  function closeGuideModal() {
    var modal = document.getElementById('badges-guide-modal');
    if (modal) modal.remove();
  }

  /**
   * Glory Honor & Requisition Currency Modal
   * Explains future in-game currency & requisition exchange plans
   */
  function openGloryCurrencyModal() {
    var existing = document.getElementById('badges-glory-currency-modal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'badges-glory-currency-modal';
    modal.className = 'modal-backdrop active';
    modal.style.zIndex = '100002';
    modal.innerHTML = [
      '<div class="modal-card" style="max-width: 560px; max-height: 88vh; background: #0f172a; border-radius: var(--radius-lg); border: 1.5px solid rgba(245, 158, 11, 0.6); box-shadow: 0 10px 40px rgba(0,0,0,0.85), 0 0 25px rgba(245, 158, 11, 0.2); display: flex; flex-direction: column; overflow: hidden;">',
      '  <div style="padding: 1.25rem 1.5rem; background: radial-gradient(circle at top, rgba(245, 158, 11, 0.2), transparent 75%); border-bottom: 1px solid rgba(255, 255, 255, 0.08); display: flex; align-items: center; justify-content: space-between;">',
      '    <div style="display: flex; align-items: center; gap: 0.65rem;">',
      '      <div style="font-size: 1.4rem;">⚡</div>',
      '      <div>',
      '        <div style="font-size: 0.68rem; font-weight: 800; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.08em;">High Command Field Intel</div>',
      '        <h3 style="font-size: 1.18rem; font-weight: 800; color: #fff; margin: 0;">Glory Honor: Future Platform Currency</h3>',
      '      </div>',
      '    </div>',
      '    <button type="button" class="modal-close" onclick="window.BadgesUI.closeGloryCurrencyModal()" style="background: none; border: none; font-size: 1.4rem; color: #94a3b8; cursor: pointer;">✕</button>',
      '  </div>',
      '  <div style="padding: 1.25rem 1.5rem; overflow-y: auto; display: flex; flex-direction: column; gap: 1rem;">',
      '    <p style="font-size: 0.84rem; color: #cbd5e1; line-height: 1.45; margin: 0;">While your <strong>Elo Rating</strong> tracks match skill and your <strong>Badge Count</strong> levels up your Military Rank border, <strong>Glory Honor</strong> serves as OmniTactica&apos;s lifetime tactical reward currency.</p>',
      '    <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: var(--radius-sm); padding: 0.85rem 1rem; margin-bottom: 0.85rem;">',
      '      <div style="font-size: 0.78rem; font-weight: 800; color: #fbbf24; margin-bottom: 0.35rem;">💰 UNIFIED SPENDABLE GLORY WALLET</div>',
      '      <div style="font-size: 0.78rem; color: #cbd5e1; line-height: 1.4;">Your spendable Glory Balance combines your <strong>Career Glory</strong> (lifetime milestones) + <strong>Season 2026 Glory</strong> (annual campaign circuit). Each calendar year resets the seasonal circuit so you can earn fresh Glory points again, while keeping all past career honors, medals, and Elo ratings intact.</div>',
      '    </div>',
      '    <div>',
      '      <div style="font-size: 0.8rem; font-weight: 800; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.6rem;">🔮 The Requisition Armory (Upcoming Expansion)</div>',
      '      <div style="display: flex; flex-direction: column; gap: 0.55rem;">',
      '        <div style="display: flex; align-items: center; gap: 0.65rem; padding: 0.55rem 0.75rem; background: rgba(255, 255, 255, 0.03); border-radius: var(--radius-sm); border: 1px solid rgba(255, 255, 255, 0.06);">',
      '          <span style="font-size: 1.15rem;">🎨</span>',
      '          <div style="flex: 1; font-size: 0.78rem; color: #cbd5e1;"><strong style=\"color: #fff;\">Animated Holo-Card Frames:</strong> Trade Glory for holographic borders and animated card particle effects.</div>',
      '        </div>',
      '        <div style="display: flex; align-items: center; gap: 0.65rem; padding: 0.55rem 0.75rem; background: rgba(255, 255, 255, 0.03); border-radius: var(--radius-sm); border: 1px solid rgba(255, 255, 255, 0.06);">',
      '          <span style="font-size: 1.15rem;">🛡️</span>',
      '          <div style="flex: 1; font-size: 0.78rem; color: #cbd5e1;"><strong style=\"color: #fff;\">Faction Regalia & Standards:</strong> Display exclusive chapter and subfaction banners on public leaderboards.</div>',
      '        </div>',
      '        <div style="display: flex; align-items: center; gap: 0.65rem; padding: 0.55rem 0.75rem; background: rgba(255, 255, 255, 0.03); border-radius: var(--radius-sm); border: 1px solid rgba(255, 255, 255, 0.06);">',
      '          <span style="font-size: 1.15rem;">🎙️</span>',
      '          <div style="flex: 1; font-size: 0.78rem; color: #cbd5e1;"><strong style=\"color: #fff;\">Stream Caster Flairs:</strong> Unlock recognized caster and TO vanity flairs for community livestreams.</div>',
      '        </div>',
      '        <div style="display: flex; align-items: center; gap: 0.65rem; padding: 0.55rem 0.75rem; background: rgba(255, 255, 255, 0.03); border-radius: var(--radius-sm); border: 1px solid rgba(255, 255, 255, 0.06);">',
      '          <span style="font-size: 1.15rem;">🎲</span>',
      '          <div style="flex: 1; font-size: 0.78rem; color: #cbd5e1;"><strong style=\"color: #fff;\">Game Tracker Tactical Dice:</strong> Custom digital dice sets, dice cup sounds, and CP counter themes.</div>',
      '        </div>',
      '      </div>',
      '    </div>',
      '    <div style="font-size: 0.75rem; color: #94a3b8; font-style: italic;">Note: Requisition exchange features are currently in active design. Start stacking your Glory points today across tournaments!</div>',
      '  </div>',
      '  <div style="padding: 0.85rem 1.5rem; background: rgba(255, 255, 255, 0.02); border-top: 1px solid rgba(255, 255, 255, 0.08); text-align: right;">',
      '    <button type="button" class="btn btn-primary" onclick="window.BadgesUI.closeGloryCurrencyModal()" style="padding: 0.5rem 1.25rem;">Understood, High Command</button>',
      '  </div>',
      '</div>'
    ].join('\n');

    document.body.appendChild(modal);
  }

  function closeGloryCurrencyModal() {
    var modal = document.getElementById('badges-glory-currency-modal');
    if (modal) modal.remove();
  }

  function getTrophySvg(type) {
    if (type === 'aquila_relic_sword' || type === 'major') {
      return '<svg width="54" height="54" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" class="champ-svg-trophy svg-major"><circle cx="32" cy="32" r="28" fill="url(#goldGrad)" opacity="0.15"/><path d="M32 4L34 20L32 48L30 20Z" fill="#fbbf24"/><path d="M22 22L42 22L36 26L28 26Z" fill="#f59e0b"/><path d="M26 48L38 48L36 54L28 54Z" fill="#d97706"/><circle cx="32" cy="18" r="3" fill="#fef08a"/><path d="M18 20L22 22L18 28L14 24Z" fill="#fbbf24"/><path d="M46 20L42 22L46 28L50 24Z" fill="#fbbf24"/><defs><radialGradient id="goldGrad" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#fbbf24"/><stop offset="100%" stop-color="transparent"/></radialGradient></defs></svg>';
    }
    if (type === 'silver_winged_chalice' || type === 'gt') {
      return '<svg width="54" height="54" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" class="champ-svg-trophy svg-gt"><circle cx="32" cy="32" r="28" fill="url(#silverGrad)" opacity="0.15"/><path d="M22 12H42V28C42 34 38 40 32 42C26 40 22 34 22 28V12Z" fill="#e2e8f0"/><path d="M30 42H34V52H30Z" fill="#94a3b8"/><path d="M24 52H40V56H24Z" fill="#64748b"/><path d="M16 16C12 20 12 26 16 30L22 26V20L16 16Z" fill="#cbd5e1"/><path d="M48 16C52 20 52 26 48 30L42 26V20L48 16Z" fill="#cbd5e1"/><circle cx="32" cy="24" r="4" fill="#38bdf8"/><defs><radialGradient id="silverGrad" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#94a3b8"/><stop offset="100%" stop-color="transparent"/></radialGradient></defs></svg>';
    }
    if (type === 'astral_obsidian_crown' || type === 'super_major') {
      return '<svg width="54" height="54" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" class="champ-svg-trophy svg-super"><circle cx="32" cy="32" r="28" fill="url(#crownGrad)" opacity="0.25"/><path d="M14 42L18 20L28 32L32 14L36 32L46 20L50 42H14Z" fill="#c084fc"/><path d="M12 42H52V48H12Z" fill="#7e22ce"/><circle cx="32" cy="14" r="3" fill="#fef08a"/><circle cx="18" cy="20" r="2.5" fill="#f43f5e"/><circle cx="46" cy="20" r="2.5" fill="#38bdf8"/><defs><radialGradient id="crownGrad" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#c084fc"/><stop offset="100%" stop-color="transparent"/></radialGradient></defs></svg>';
    }
    return '<svg width="54" height="54" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" class="champ-svg-trophy svg-rtt"><circle cx="32" cy="32" r="24" fill="#b45309" stroke="#f59e0b" stroke-width="2"/><circle cx="32" cy="32" r="18" fill="#78350f"/><path d="M26 34L32 24L38 34L32 30Z" fill="#fbbf24"/><path d="M18 28C16 36 22 44 32 46C24 44 20 36 20 28Z" fill="#d97706"/><path d="M46 28C48 36 42 44 32 46C40 44 44 36 44 28Z" fill="#d97706"/></svg>';
  }

  function renderHallOfChampions(championships, isSelf, isPublic, customId) {
    championships = championships || { total: 0, items: [] };
    var total = championships.total || 0;
    var items = championships.items || [];
    var showcaseId = customId || 'hall-of-champions-showcase';

    if (total === 0) {
      return [
        '<div class="champ-reliquary-wrap is-empty" id="' + showcaseId + '">',
        '  <div class="champ-empty-pedestal">',
        '    <span class="champ-empty-icon">🏛️</span>',
        '    <div class="champ-empty-info">',
        '      <span class="champ-empty-title">Championship Reliquary</span>',
        '      <span class="champ-empty-sub">Tournament silverware is enshrined here. Win an official RTT, GT, or Major to claim your place in the Hall of Champions.</span>',
        '    </div>',
        '  </div>',
        '</div>'
      ].join('\n');
    }

    var cardsHtml = items.map(function(item) {
      var tierClass = 'tier-' + (item.tier || 'rtt').replace(/_/g, '-');
      var ribbonHtml = item.undefeated
        ? '<div class="champ-trophy-ribbon" title="Flawless Undefeated Championship Run">⭐ UNDEFEATED</div>'
        : '';
      var trophySvg = getTrophySvg(item.trophy_type || 'bronze_laurel_plaque');

      return [
        '<div class="champ-trophy-card ' + tierClass + '" onclick="window.BadgesUI.openVictoryChronicle(\'' + escapeHtml(item.event_id || '') + '\', \'' + escapeHtml(item.event_name || '') + '\', \'' + escapeHtml(item.tier_title || '') + '\', \'' + escapeHtml(item.record || '') + '\', \'' + escapeHtml(item.faction || '') + '\', \'' + escapeHtml(item.event_date || '') + '\', ' + (item.total_players || 0) + ', ' + (item.num_rounds || 0) + ', ' + (item.glory_bonus || 0) + ')" title="Click to inspect Victory Chronicle">',
        ribbonHtml,
        '  <div class="champ-trophy-icon-wrap">' + trophySvg + '</div>',
        '  <div class="champ-trophy-tier-tag">' + escapeHtml((item.tier_title || 'Champion').toUpperCase()) + '</div>',
        '  <div class="champ-trophy-name" title="' + escapeHtml(item.event_name) + '">' + escapeHtml(item.event_name) + '</div>',
        '  <div class="champ-trophy-meta">',
        '    <span class="champ-meta-record">' + escapeHtml(item.record) + '</span>',
        '    <span class="champ-meta-dot">&bull;</span>',
        '    <span class="champ-meta-players">' + (item.total_players ? (item.total_players + ' Players') : (item.num_rounds + ' Rnds')) + '</span>',
        '  </div>',
        '  <div class="champ-trophy-footer">',
        '    <span class="champ-meta-faction">' + escapeHtml(item.faction || 'General') + '</span>',
        '    <span class="champ-meta-glory">+' + (item.glory_bonus || 0) + ' Glory</span>',
        '  </div>',
        '</div>'
      ].join('\n');
    }).join('\n');

    return [
      '<div class="champ-reliquary-wrap" id="' + showcaseId + '">',
      '  <div class="champ-reliquary-header">',
      '    <div class="champ-header-left">',
      '      <span class="champ-header-icon">🏛️</span>',
      '      <div>',
      '        <h4 class="champ-reliquary-heading">Hall of Champions</h4>',
      '        <div class="champ-reliquary-sub">Official BCP Tournament Silverware &amp; Championship Trophies</div>',
      '      </div>',
      '    </div>',
      '    <div class="champ-header-right">',
      '      <div class="champ-count-pill" title="Total Championship Victories">',
      '        <span class="champ-count-val">🏆 ' + total + '</span>',
      '        <span class="champ-count-lbl">' + (total === 1 ? 'Championship' : 'Championships') + '</span>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div class="champ-trophies-track">',
      cardsHtml,
      '  </div>',
      '</div>'
    ].join('\n');
  }

  function openVictoryChronicle(eventId, eventName, tierTitle, record, faction, eventDate, totalPlayers, numRounds, gloryBonus) {
    var existing = document.getElementById('badges-victory-chronicle-modal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'badges-victory-chronicle-modal';
    modal.className = 'modal-backdrop active';
    modal.style.zIndex = '100003';
    modal.innerHTML = [
      '<div class="modal-card champ-chronicle-card" style="max-width: 500px; background: #0f172a; border-radius: var(--radius-lg); border: 1.5px solid rgba(245, 158, 11, 0.75); box-shadow: 0 10px 40px rgba(0,0,0,0.9), 0 0 35px rgba(245, 158, 11, 0.25); overflow: hidden;">',
      '  <div style="padding: 1.5rem 1.5rem 1.15rem; text-align: center; background: radial-gradient(circle at top, rgba(245, 158, 11, 0.25), transparent 75%); border-bottom: 1px solid rgba(255,255,255,0.08); position: relative;">',
      '    <button type="button" class="modal-close" onclick="window.BadgesUI.closeVictoryChronicle()" style="position: absolute; top: 1rem; right: 1rem; background: none; border: none; font-size: 1.4rem; color: #94a3b8; cursor: pointer;">✕</button>',
      '    <div style="font-size: 2.8rem; margin-bottom: 0.35rem;">🏆</div>',
      '    <div style="display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.72rem; font-weight: 800; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.08em; background: rgba(245, 158, 11, 0.15); padding: 0.25rem 0.75rem; border-radius: 9999px; border: 1px solid rgba(245, 158, 11, 0.3); margin-bottom: 0.45rem;">' + escapeHtml(tierTitle) + ' &bull; 1st Place Champion</div>',
      '    <h2 style="font-size: 1.4rem; font-weight: 800; color: #fff; margin: 0 0 0.3rem; letter-spacing: -0.01em;">' + escapeHtml(eventName) + '</h2>',
      '    <div style="font-size: 0.82rem; color: #94a3b8;">Official Tournament Chronicle &bull; ' + escapeHtml(eventDate || '2026') + '</div>',
      '  </div>',
      '  <div style="padding: 1.25rem 1.5rem;">',
      '    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.65rem; margin-bottom: 1.1rem;">',
      '      <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: var(--radius-sm); padding: 0.65rem 0.5rem; text-align: center;">',
      '        <div style="font-size: 1.2rem; font-weight: 800; color: #fbbf24; font-family: var(--font-mono);">' + escapeHtml(record) + '</div>',
      '        <div style="font-size: 0.66rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; margin-top: 0.15rem;">Record</div>',
      '      </div>',
      '      <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: var(--radius-sm); padding: 0.65rem 0.5rem; text-align: center;">',
      '        <div style="font-size: 1.2rem; font-weight: 800; color: #38bdf8; font-family: var(--font-mono);">' + (totalPlayers || numRounds || 0) + '</div>',
      '        <div style="font-size: 0.66rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; margin-top: 0.15rem;">' + (totalPlayers ? 'Competitors' : 'Rounds') + '</div>',
      '      </div>',
      '      <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: var(--radius-sm); padding: 0.65rem 0.5rem; text-align: center;">',
      '        <div style="font-size: 1.2rem; font-weight: 800; color: #10b981; font-family: var(--font-mono);">+' + gloryBonus + '</div>',
      '        <div style="font-size: 0.66rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; margin-top: 0.15rem;">Glory Bounty</div>',
      '      </div>',
      '    </div>',
      '    <div style="background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.08); border-radius: var(--radius-sm); padding: 0.85rem 1rem; margin-bottom: 1.1rem; display: flex; align-items: center; justify-content: space-between;">',
      '      <div>',
      '        <span style="font-size: 0.72rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Winning Army:</span>',
      '        <div style="font-size: 0.95rem; font-weight: 700; color: #fff; margin-top: 0.1rem;">🛡️ ' + escapeHtml(faction || 'General') + '</div>',
      '      </div>',
      '      <span class="badge badge-win" style="font-size: 0.74rem; font-weight: 700; padding: 0.25rem 0.65rem;">1st Place Podium</span>',
      '    </div>',
      '    <div style="display: flex; gap: 0.65rem;">',
      '      <button type="button" class="btn btn-primary" style="flex: 1; padding: 0.65rem 1rem; font-weight: 700;" onclick="window.BadgesUI.shareVictorySnippet(\'' + escapeHtml(eventName) + '\', \'' + escapeHtml(tierTitle) + '\', \'' + escapeHtml(record) + '\', \'' + escapeHtml(faction || '') + '\')">📋 Copy Victory Card</button>',
      '      <button type="button" class="btn btn-secondary" style="padding: 0.65rem 1.1rem;" onclick="window.BadgesUI.closeVictoryChronicle()">Close</button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n');

    document.body.appendChild(modal);
  }

  function closeVictoryChronicle() {
    var modal = document.getElementById('badges-victory-chronicle-modal');
    if (modal) modal.remove();
  }

  function shareVictorySnippet(eventName, tierTitle, record, faction) {
    var text = '🏆 Tournament Champion! Won 1st Place at ' + eventName + ' (' + tierTitle + ') with ' + faction + ' [' + record + '] on OmniTactica!';
    if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        if (typeof showToast === 'function') showToast('Victory summary copied to clipboard! 🏆');
        else alert('Victory summary copied to clipboard! 🏆');
      });
    } else {
      prompt('Copy tournament victory card:', text);
    }
  }

  // Export public API
  window.BadgesUI = {
    renderRankBadge: renderRankBadge,
    renderHeroInsigniaCluster: renderHeroInsigniaCluster,
    navigateToScope: navigateToScope,
    renderPinnedMedals: renderPinnedMedals,
    renderTrophyRoom: renderTrophyRoom,
    renderHallOfChampions: renderHallOfChampions,
    openVictoryChronicle: openVictoryChronicle,
    closeVictoryChronicle: closeVictoryChronicle,
    shareVictorySnippet: shareVictorySnippet,
    getTrophySvg: getTrophySvg,
    renderTrophyCards: renderTrophyCards,
    renderSeasonalTrophyCards: renderSeasonalTrophyCards,
    renderPublicTrophyCards: renderPublicTrophyCards,
    setHubScope: setHubScope,
    setPublicScope: setPublicScope,
    openTrophyModal: openTrophyModal,
    closeTrophyModal: closeTrophyModal,
    closeModal: closeTrophyModal,
    togglePin: togglePin,
    setCategory: setCategory,
    setStatusFilter: setStatusFilter,
    onSearchInput: onSearchInput,
    clearSearch: clearSearch,
    setSeasonalCategory: setSeasonalCategory,
    setSeasonalStatusFilter: setSeasonalStatusFilter,
    onSeasonalSearchInput: onSeasonalSearchInput,
    clearSeasonalSearch: clearSeasonalSearch,
    checkFirstTimeCelebration: checkFirstTimeCelebration,
    closeCelebrationModal: closeCelebrationModal,
    openGuideModal: openGuideModal,
    closeGuideModal: closeGuideModal,
    openGloryCurrencyModal: openGloryCurrencyModal,
    closeGloryCurrencyModal: closeGloryCurrencyModal
  };

})(typeof window !== 'undefined' ? window : this);
