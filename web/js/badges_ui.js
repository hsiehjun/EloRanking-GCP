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
   * Renders the Military Rank badge for Hero Profile card
   */
  function renderRankBadge(rank, switchTabFnName) {
    if (!rank) return '';
    var r = rank;
    var title = r.title || 'Initiate';
    var level = r.rank || 1;
    var icon = r.icon || '🛡️';
    var cssClass = r.css_class || 'rank-border-initiate';
    var tooltip = 'Trophy Honor Rank (Tier ' + level + '/7): ' + title + ' (' + (r.badge_count || 0) + ' medals unlocked) • Click to view Trophies';
    var fnCall = switchTabFnName ? switchTabFnName + "('trophies')" : "switchHubSubtab('trophies')";

    return [
      '<div class="profile-rank-badge ' + escapeHtml(cssClass) + '" onclick="' + fnCall + '" style="cursor:pointer;" title="' + escapeHtml(tooltip) + '">',
      '  <span class="rank-icon">' + icon + '</span>',
      '  <span class="rank-label">Trophy Rank:</span>',
      '  <span class="rank-title">' + escapeHtml(title) + '</span>',
      '  <span class="rank-lvl-pill">Tier ' + level + '/7</span>',
      '</div>'
    ].join('\n');
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
      '          <h3 class="trophy-military-title">' + escapeHtml(rank.title || 'Initiate') + '</h3>',
      '          <span class="trophy-rank-level-badge">Rank Level ' + (rank.rank || 1) + '</span>',
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
      '      <span>' + escapeHtml(rank.title || 'Initiate') + ' (Tier ' + (rank.rank || 1) + ')</span>',
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

    var ranksData = [
      { level: 1, title: 'Initiate', badges: '0 – 4', icon: '🛡️', borderText: 'border: 1px solid rgba(255, 255, 255, 0.08)', desc: 'Standard field fatigues. Fresh recruits taking their first steps in competitive play.' },
      { level: 2, title: 'Veteran', badges: '5 – 14', icon: '⚔️', borderText: 'border: 1.5px solid rgba(217, 119, 6, 0.45)', desc: 'Refined subtle bronze trim. Proven experience across sanctioned tournament rounds.' },
      { level: 3, title: 'Centurion', badges: '15 – 29', icon: '🗡️', borderText: 'border: 1.5px solid rgba(148, 163, 184, 0.55)', desc: 'Polished steel border. Respected club pillar, match winner, and tactical regular.' },
      { level: 4, title: 'Commander', badges: '30 – 49', icon: '🎖️', borderText: 'border: 1.5px solid rgba(203, 213, 225, 0.75)', desc: 'Sterling silver trim with subtle ambient backplate. Regional competitive threat.' },
      { level: 5, title: 'Lord General', badges: '50 – 69', icon: '🦅', borderText: 'border: 1.5px solid rgba(245, 158, 11, 0.75)', desc: 'Regal golden trim with ambient sheen. Powerhouse commander battling on top tables.' },
      { level: 6, title: 'High Warmaster', badges: '70 – 89', icon: '🔥', borderText: 'border: 1.5px solid #fbbf24 + Amber Halo Glow', desc: 'Luminous gold edge with 25px amber halo. Continental tournament champion.' },
      { level: 7, title: 'Apex Everchosen', badges: '90+', icon: '👑', borderText: 'border: 1.5px solid #c084fc + Prismatic Astral Aura', desc: 'Deep violet trim with 30px astral halo aura. Worldwide mythic legend.' }
    ];

    var ranksListHtml = ranksData.map(function(r) {
      return [
        '<div style="display: flex; align-items: flex-start; gap: 0.85rem; padding: 0.65rem 0.85rem; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: var(--radius-sm); margin-bottom: 0.5rem;">',
        '  <div style="font-size: 1.4rem; min-width: 32px; text-align: center; margin-top: 0.1rem;">' + r.icon + '</div>',
        '  <div style="flex: 1; min-width: 0;">',
        '    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.2rem; flex-wrap: wrap;">',
        '      <span style="font-weight: 800; font-size: 0.88rem; color: #fff;">' + escapeHtml(r.title) + '</span>',
        '      <span style="font-size: 0.68rem; font-weight: 700; color: #fbbf24; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); padding: 0.1rem 0.4rem; border-radius: 9999px;">Rank ' + r.level + '</span>',
        '      <span style="font-size: 0.72rem; color: #38bdf8; margin-left: auto; font-family: var(--font-mono); font-weight: 700;">' + escapeHtml(r.badges) + ' Honors</span>',
        '    </div>',
        '    <div style="font-size: 0.76rem; color: #cbd5e1; line-height: 1.35; margin-bottom: 0.2rem;">' + escapeHtml(r.desc) + '</div>',
        '    <div style="font-size: 0.68rem; color: #94a3b8; font-family: var(--font-mono);">' + escapeHtml(r.borderText) + '</div>',
        '  </div>',
        '</div>'
      ].join('');
    }).join('');

    var modal = document.createElement('div');
    modal.id = 'badges-guide-modal';
    modal.className = 'modal-backdrop active';
    modal.style.zIndex = '100001';
    modal.innerHTML = [
      '<div class="modal-card" style="max-width: 620px; max-height: 88vh; background: #0f172a; border-radius: var(--radius-lg); border: 1.5px solid rgba(255, 255, 255, 0.15); box-shadow: 0 10px 40px rgba(0,0,0,0.85); display: flex; flex-direction: column; overflow: hidden;">',
      '  <div style="padding: 1.25rem 1.5rem; background: rgba(255, 255, 255, 0.02); border-bottom: 1px solid rgba(255, 255, 255, 0.08); display: flex; align-items: center; justify-content: space-between;">',
      '    <div style="display: flex; align-items: center; gap: 0.65rem;">',
      '      <div style="font-size: 1.3rem;">📖</div>',
      '      <div>',
      '        <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0;">High Command Field Manual</h3>',
      '        <div style="font-size: 0.75rem; color: #94a3b8;">Military Progression Ranks, Card Borders &amp; Glory Honor System</div>',
      '      </div>',
      '    </div>',
      '    <button type="button" class="modal-close" onclick="window.BadgesUI.closeGuideModal()" style="background: none; border: none; font-size: 1.4rem; color: #94a3b8; cursor: pointer;">✕</button>',
      '  </div>',
      '  <div style="padding: 1.25rem 1.5rem; overflow-y: auto; display: flex; flex-direction: column; gap: 1.25rem;">',
      '    <!-- Section 1: Military Ranks & Borders -->',
      '    <div>',
      '      <h4 style="font-size: 0.85rem; font-weight: 800; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 0.4rem; display: flex; align-items: center; gap: 0.4rem;">',
      '        <span>🎖️</span> 7 Military Progression Tiers &amp; Hero Card Borders',
      '      </h4>',
      '      <p style="font-size: 0.8rem; color: #cbd5e1; line-height: 1.45; margin: 0 0 0.75rem;">Your Military Rank represents your overall volume of competitive milestones. Every badge you unlock brings you closer to the next military tier, upgrading your Hero Card border and halo glow across the entire platform with <strong style=\"color: #10b981;\">strictly zero layout shift</strong>.</p>',
      ranksListHtml,
      '    </div>',
      '    <!-- Section 2: Glory Points vs Badges vs Elo -->',
      '    <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: var(--radius-sm); padding: 1rem;">',
      '      <h4 style="font-size: 0.85rem; font-weight: 800; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 0.5rem; display: flex; align-items: center; gap: 0.4rem;">',
      '        <span>⚡</span> Badge Count vs. Elo vs. Glory Requisition Currency',
      '      </h4>',
      '      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem; margin-bottom: 0.75rem;">',
      '        <div style="padding: 0.75rem; background: rgba(255, 255, 255, 0.03); border-radius: var(--radius-sm); border: 1px solid rgba(255, 255, 255, 0.06);">',
      '          <div style="font-size: 0.78rem; font-weight: 800; color: #fff; margin-bottom: 0.25rem;"># OF BADGES (Milestones)</div>',
      '          <div style="font-size: 0.75rem; color: #94a3b8; line-height: 1.35;">Total lifetime feats unlocked. Determines your <strong>Military Rank</strong> (Level 1 to 7) and progressive <strong>Card Borders &amp; Glows</strong>.</div>',
      '        </div>',
      '        <div style="padding: 0.75rem; background: rgba(255, 255, 255, 0.03); border-radius: var(--radius-sm); border: 1px solid rgba(255, 255, 255, 0.06);">',
      '          <div style="font-size: 0.78rem; font-weight: 800; color: #fbbf24; margin-bottom: 0.25rem;">GLORY HONOR (Future Currency)</div>',
      '          <div style="font-size: 0.75rem; color: #94a3b8; line-height: 1.35;">Earnable tactical credits. In upcoming phases, trade Glory Honor for exclusive holo-frames, faction crests, and stream flairs. <a href=\"javascript:void(0)\" onclick=\"window.BadgesUI.openGloryCurrencyModal()\" style=\"color: #38bdf8; text-decoration: underline;\">Learn more →</a></div>',
      '        </div>',
      '      </div>',
      '      <div style="font-size: 0.74rem; color: #cbd5e1; line-height: 1.4;">',
      '        <strong style=\"color: #fbbf24;\">Glory Tier Deposits:</strong> Common (+10) • Uncommon (+25) • Rare (+50) • Epic (+100) • Legendary (+250) • Mythic (+500)',
      '      </div>',
      '    </div>',
      '    <!-- Section 3: Signature Honors Rack & Secrets -->',
      '    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem;">',
      '      <div style="padding: 0.85rem; background: rgba(255, 255, 255, 0.03); border-radius: var(--radius-sm); border: 1px solid rgba(255, 255, 255, 0.07);">',
      '        <div style="font-size: 0.8rem; font-weight: 800; color: #fff; margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.35rem;"><span>📌</span> Signature Rack</div>',
      '        <div style="font-size: 0.74rem; color: #94a3b8; line-height: 1.35;">Pin up to 3 of your proudest honors to your Hero Card and Public Profile for opponents and stream casters to admire.</div>',
      '      </div>',
      '      <div style="padding: 0.85rem; background: rgba(255, 255, 255, 0.03); border-radius: var(--radius-sm); border: 1px solid rgba(255, 255, 255, 0.07);">',
      '        <div style="font-size: 0.8rem; font-weight: 800; color: #c084fc; margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.35rem;"><span>🕵️</span> Classified Secrets</div>',
      '        <div style="font-size: 0.74rem; color: #94a3b8; line-height: 1.35;">15 tactical battlefield feats are classified. Their criteria remain shrouded until unlocked through live competitive action.</div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div style="padding: 0.85rem 1.5rem; background: rgba(255, 255, 255, 0.02); border-top: 1px solid rgba(255, 255, 255, 0.08); text-align: right;">',
      '    <button type="button" class="btn btn-primary" onclick="window.BadgesUI.closeGuideModal()" style="padding: 0.5rem 1.25rem;">Understood, Commander</button>',
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

  // Export public API
  window.BadgesUI = {
    renderRankBadge: renderRankBadge,
    renderPinnedMedals: renderPinnedMedals,
    renderTrophyRoom: renderTrophyRoom,
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
