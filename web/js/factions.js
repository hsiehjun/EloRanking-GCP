/* ==========================================================================
   FACTIONS.JS - Competitive Meta Intel, StatCheck Quadrant, Matchup Matrix & Timeline
   ========================================================================== */

const _initNow = new Date();
const _init90d = new Date(_initNow.getTime() - 90 * 24 * 60 * 60 * 1000);
let factionMetaData = null;
let factionTimeframe = '90d';
let factionCustomStart = _init90d.toISOString().substring(0, 10);
let factionCustomEnd = _initNow.toISOString().substring(0, 10);
let factionViewMode = 'table'; // 'table' | 'quadrant' | 'matrix' | 'chart'
let factionTierFilter = 'ALL';
let factionQuadrantMetric = 'overall'; // 'overall' | 'non_mirror' | 'margin'
let factionMatrixSize = 14; // 10 | 14 | 16
let factionTimelineMetric = 'win_rate'; // 'win_rate' | 'meta_share'
let selectedFactions = new Set();
let allAvailableFactions = [];
let highlightedFaction = null;

// Client-side L1 cache for instant 0ms switching across 1M / 2M / 3M / 6M / 1Y / YTD / All Time
const factionMetaClientCache = new Map();
let _factionPrefetchScheduled = new Set();

const FACTION_PALETTE = [
  '#38bdf8', '#a855f7', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#f97316', '#e2e8f0',
  '#ef4444', '#10b981', '#6366f1', '#eab308', '#d946ef', '#14b8a6', '#84cc16', '#f43f5e',
  '#8b5cf6', '#3b82f6', '#2dd4bf', '#fb923c', '#94a3b8', '#fdba74', '#c084fc', '#4ade80'
];

function getFactionColor(fac) {
  const s = String(fac || '');
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return FACTION_PALETTE[hash % FACTION_PALETTE.length];
}

function getTimeframeDisplayLabel(tf) {
  const map = {
    '30d': 'Last 30 Days (1M)',
    '60d': 'Last 60 Days (2M)',
    '90d': 'Last 90 Days (3M)',
    '180d': 'Last 6 Months (6M)',
    '1yr': 'Last 12 Months (1Y)',
    'ytd': '2026 Year-To-Date',
    'all': 'All Time',
    'custom': `${factionCustomStart || 'Start'} to ${factionCustomEnd || 'Now'}`
  };
  return map[tf] || 'Last 90 Days';
}

function setFactionTimeframe(preset) {
  factionTimeframe = preset;

  ['30d', '60d', '90d', '180d', '1yr', 'ytd', 'all', 'custom'].forEach(p => {
    const btn = document.getElementById(`faction-preset-${p}`);
    if (btn) btn.classList.toggle('active', p === preset);
  });

  const customInputs = document.getElementById('faction-custom-date-container');
  if (customInputs) {
    customInputs.style.display = (preset === 'custom') ? 'flex' : 'none';
  }

  const now = new Date();
  if (preset === 'custom') {
    const startInput = document.getElementById('faction-start-date');
    const endInput = document.getElementById('faction-end-date');
    if (startInput && !startInput.value) {
      const d = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      startInput.value = factionCustomStart || d.toISOString().substring(0, 10);
    }
    if (endInput && !endInput.value) {
      endInput.value = factionCustomEnd || now.toISOString().substring(0, 10);
    }
    factionCustomStart = startInput ? startInput.value : '';
    factionCustomEnd = endInput ? endInput.value : '';
  }

  loadFactionMeta();
}

function applyCustomFactionDateFilter() {
  const startInput = document.getElementById('faction-start-date');
  const endInput = document.getElementById('faction-end-date');
  factionCustomStart = startInput ? startInput.value : '';
  factionCustomEnd = endInput ? endInput.value : '';
  factionTimeframe = 'custom';
  ['30d', '60d', '90d', '180d', '1yr', 'ytd', 'all', 'custom'].forEach(p => {
    const btn = document.getElementById(`faction-preset-${p}`);
    if (btn) btn.classList.toggle('active', p === 'custom');
  });
  loadFactionMeta();
}

function setFactionViewMode(mode) {
  factionViewMode = mode;
  const modes = ['table', 'quadrant', 'matrix', 'chart'];
  modes.forEach(m => {
    const btn = document.getElementById(`faction-mode-btn-${m}`);
    const container = document.getElementById(`faction-view-${m}-container`);
    if (btn) btn.classList.toggle('active', m === mode);
    if (container) container.style.display = (m === mode) ? 'block' : 'none';
  });

  if (!factionMetaData) return;
  if (mode === 'quadrant') {
    renderFactionQuadrantChart();
  } else if (mode === 'matrix') {
    renderFactionMatchupMatrix();
  } else if (mode === 'chart') {
    renderFactionTrendChart(factionMetaData.monthly_trends || []);
  }
}

function setFactionTierFilter(tier) {
  factionTierFilter = tier || 'ALL';
  document.querySelectorAll('.meta-tier-pills .meta-pill-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tier') === factionTierFilter);
  });
  renderFactionMetaRows();
}

function onFactionTableFilterChange() {
  renderFactionMetaRows();
}

function setQuadrantMetric(metric) {
  factionQuadrantMetric = metric || 'overall';
  const map = {
    'overall': 'quadrant-metric-overall',
    'non_mirror': 'quadrant-metric-nonmirror',
    'margin': 'quadrant-metric-margin'
  };
  Object.keys(map).forEach(k => {
    const btn = document.getElementById(map[k]);
    if (btn) btn.classList.toggle('active', k === factionQuadrantMetric);
  });
  renderFactionQuadrantChart();
}

function setMatchupMatrixSize(size) {
  factionMatrixSize = Number(size) || 14;
  [10, 14, 16].forEach(n => {
    const btn = document.getElementById(`matrix-size-${n}`);
    if (btn) btn.classList.toggle('active', n === factionMatrixSize);
  });
  renderFactionMatchupMatrix();
}

function setTimelineMetric(metric) {
  factionTimelineMetric = metric || 'win_rate';
  const btnWr = document.getElementById('timeline-metric-wr');
  const btnShare = document.getElementById('timeline-metric-share');
  if (btnWr) btnWr.classList.toggle('active', factionTimelineMetric === 'win_rate');
  if (btnShare) btnShare.classList.toggle('active', factionTimelineMetric === 'meta_share');
  if (factionMetaData) {
    renderFactionTrendChart(factionMetaData.monthly_trends || []);
  }
}

function _applyFactionMetaDataToUI(data) {
  factionMetaData = data;

  if (data && data.monthly_trends && data.monthly_trends.length > 0) {
    const counts = {};
    data.monthly_trends.forEach(t => {
      counts[t.faction] = (counts[t.faction] || 0) + Number(t.matches_in_month || 1);
    });
    allAvailableFactions = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  } else if (data && data.factions) {
    allAvailableFactions = data.factions
      .slice()
      .sort((a, b) => (Number(b.total_matches) || 0) - (Number(a.total_matches) || 0))
      .map(f => f.faction);
  }

  if (selectedFactions.size === 0 && allAvailableFactions.length > 0) {
    allAvailableFactions.slice(0, 8).forEach(f => selectedFactions.add(f));
  }

  renderFactionMetaKpis();
  renderFactionMetaRows();
  renderFactionDistribution();
  if (factionViewMode === 'quadrant') {
    renderFactionQuadrantChart();
  } else if (factionViewMode === 'matrix') {
    renderFactionMatchupMatrix();
  } else if (factionViewMode === 'chart') {
    renderFactionTrendChart(factionMetaData.monthly_trends || []);
  }
}

function scheduleFactionPresetsPrefetch(sys) {
  const sysKey = sys || '40k';
  if (_factionPrefetchScheduled.has(sysKey)) return;
  _factionPrefetchScheduled.add(sysKey);

  const presetsToWarm = ['30d', '180d', '1yr', 'all', '60d', 'ytd'];
  setTimeout(async () => {
    for (const p of presetsToWarm) {
      const ck = `${sysKey}_preset_${p}`;
      if (factionMetaClientCache.has(ck)) continue;
      try {
        const res = await window.api.getFactionMeta(null, null, p);
        if (res && Array.isArray(res.factions)) {
          factionMetaClientCache.set(ck, { timestamp: Date.now(), data: res });
        }
      } catch (e) {
        // Silent background warm
      }
    }
  }, 350);
}

async function loadFactionMeta() {
  const tbody = document.getElementById('faction-meta-body');
  const sys = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
  const isCustom = (factionTimeframe === 'custom');
  const cacheKey = isCustom
    ? `${sys}_custom_${factionCustomStart}_${factionCustomEnd}`
    : `${sys}_preset_${factionTimeframe}`;

  const cached = factionMetaClientCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.timestamp) < 600000) {
    _applyFactionMetaDataToUI(cached.data);
    scheduleFactionPresetsPrefetch(sys);
    return;
  }

  if (tbody && (!factionMetaData || !factionMetaData.factions || factionMetaData.factions.length === 0)) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Analyzing competitive faction meta...</div></td></tr>';
  }

  try {
    const reqStart = isCustom ? factionCustomStart : null;
    const reqEnd = isCustom ? factionCustomEnd : null;
    const data = await window.api.getFactionMeta(reqStart, reqEnd, factionTimeframe);
    if (data && Array.isArray(data.factions)) {
      factionMetaClientCache.set(cacheKey, { timestamp: Date.now(), data });
    }
    _applyFactionMetaDataToUI(data);
    scheduleFactionPresetsPrefetch(sys);
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="empty-state" style="color:var(--loss);">Error loading faction meta: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderFactionMetaKpis() {
  const strip = document.getElementById('faction-meta-kpis-strip');
  if (!strip || !factionMetaData || !factionMetaData.factions) return;

  const factions = factionMetaData.factions || [];
  const kpis = factionMetaData.summary_kpis || {};
  const totalAppearances = Number(kpis.total_appearances) || factions.reduce((acc, f) => acc + (Number(f.total_matches) || 0), 0);
  const totalMatches = Number(kpis.total_matches) || Math.max(1, Math.round(totalAppearances / 2));
  const totalPilots = Number(kpis.total_pilots) || factions.reduce((acc, f) => acc + (Number(f.unique_pilots) || 0), 0);
  const activeFactions = factions.length;

  const goldilocksCount = kpis.goldilocks_count != null
    ? Number(kpis.goldilocks_count)
    : factions.filter(f => Number(f.win_rate) >= 45 && Number(f.win_rate) <= 55).length;
  const goldilocksPct = kpis.goldilocks_pct != null
    ? Number(kpis.goldilocks_pct)
    : (activeFactions > 0 ? Math.round((goldilocksCount * 1000) / activeFactions) / 10 : 0);

  const sortedByPlay = factions.slice().sort((a, b) => (Number(b.total_matches) || 0) - (Number(a.total_matches) || 0));
  const mostPop = kpis.most_popular || sortedByPlay[0] || null;
  const highestWr = kpis.highest_win_rate || factions[0] || null;
  const topEventWinner = kpis.top_event_winner || factions.slice().sort((a, b) => (Number(b.x0_runs) || 0) - (Number(a.x0_runs) || 0))[0] || null;
  const highestMargin = kpis.highest_vp_margin || factions.slice().sort((a, b) => (Number(b.avg_margin) || -99) - (Number(a.avg_margin) || -99))[0] || null;

  const popName = mostPop ? (mostPop.faction || '-') : '-';
  const popShare = mostPop ? Number(mostPop.meta_share || (totalAppearances > 0 ? (Number(mostPop.total_matches || 0) * 100 / totalAppearances) : 0)).toFixed(1) : '0.0';
  const popMatches = mostPop ? formatNumber(mostPop.total_matches || 0) : '0';
  const popWr = mostPop ? Number(mostPop.win_rate || 0).toFixed(1) : '0.0';

  const hwrName = highestWr ? (highestWr.faction || '-') : '-';
  const hwrVal = highestWr ? Number(highestWr.win_rate || 0).toFixed(1) : '0.0';
  const hwrNm = highestWr ? Number(highestWr.non_mirror_win_rate != null ? highestWr.non_mirror_win_rate : (highestWr.win_rate || 0)).toFixed(1) : '0.0';
  const hwrGames = highestWr ? formatNumber(highestWr.total_matches || 0) : '0';

  const evName = topEventWinner ? (topEventWinner.faction || '-') : '-';
  const evX0 = topEventWinner ? Number(topEventWinner.x0_runs || 0) : 0;
  const evX1 = topEventWinner ? Number(topEventWinner.x1_runs || 0) : 0;
  const evOverRep = topEventWinner && Number(topEventWinner.over_rep_ratio) > 0
    ? `${Number(topEventWinner.over_rep_ratio).toFixed(2)}x TiWP`
    : `${Number(topEventWinner ? topEventWinner.win_rate || 0 : 0).toFixed(1)}% WR`;

  const vpName = highestMargin ? (highestMargin.faction || '-') : '-';
  const vpMarginNum = highestMargin ? Number(highestMargin.avg_margin || 0) : 0;
  const vpMarginStr = `${vpMarginNum >= 0 ? '+' : ''}${vpMarginNum.toFixed(1)} VP`;
  const vpAvgScore = highestMargin ? Number(highestMargin.avg_score || 0).toFixed(1) : '0.0';

  strip.innerHTML = `
    <div class="meta-kpi-card">
      <div class="meta-kpi-label">📊 Field Sample (${escapeHtml(factionTimeframe.toUpperCase())})</div>
      <div class="meta-kpi-value">${formatNumber(totalMatches)} <span style="font-size:0.78rem; font-weight:600; color:var(--text-secondary);">games</span></div>
      <div class="meta-kpi-sub">${formatNumber(totalAppearances)} army entries • ${formatNumber(totalPilots)} pilots</div>
    </div>

    <div class="meta-kpi-card">
      <div class="meta-kpi-label">⚖️ Metawatch Health</div>
      <div class="meta-kpi-value" style="color:${goldilocksPct >= 55 ? 'var(--win)' : (goldilocksPct >= 40 ? '#fbbf24' : 'var(--loss)')};">
        ${goldilocksPct.toFixed(0)}% <span style="font-size:0.76rem; font-weight:600; color:var(--text-secondary);">Balanced</span>
      </div>
      <div class="meta-kpi-sub">${goldilocksCount} of ${activeFactions} armies in 45%–55% zone</div>
    </div>

    <div class="meta-kpi-card clickable" onclick="openFactionModal('${escapeHtml(String(popName).replace(/'/g, "\\'"))}')">
      <div class="meta-kpi-label">🔥 Most Played Army</div>
      <div class="meta-kpi-value meta-kpi-faction">${escapeHtml(popName)}</div>
      <div class="meta-kpi-sub"><b style="color:#38bdf8;">${popShare}% Share</b> • ${popMatches} games (${popWr}% WR)</div>
    </div>

    <div class="meta-kpi-card clickable" onclick="openFactionModal('${escapeHtml(String(hwrName).replace(/'/g, "\\'"))}')">
      <div class="meta-kpi-label">👑 Apex Win Rate</div>
      <div class="meta-kpi-value meta-kpi-faction">${escapeHtml(hwrName)}</div>
      <div class="meta-kpi-sub"><b style="color:#a855f7;">${hwrVal}% WR</b> (${hwrNm}% ex-mirror • ${hwrGames}g)</div>
    </div>

    <div class="meta-kpi-card clickable" onclick="openFactionModal('${escapeHtml(String(evName).replace(/'/g, "\\'"))}')">
      <div class="meta-kpi-label">🏆 Undefeated Finisher</div>
      <div class="meta-kpi-value meta-kpi-faction">${escapeHtml(evName)}</div>
      <div class="meta-kpi-sub"><b style="color:var(--win);">${evX0} X-0 Runs</b> • ${evX1} Podiums (${escapeHtml(evOverRep)})</div>
    </div>

    <div class="meta-kpi-card clickable" onclick="openFactionModal('${escapeHtml(String(vpName).replace(/'/g, "\\'"))}')">
      <div class="meta-kpi-label">⚡ VP Differential Leader</div>
      <div class="meta-kpi-value meta-kpi-faction">${escapeHtml(vpName)}</div>
      <div class="meta-kpi-sub"><b style="color:${vpMarginNum >= 0 ? 'var(--win)' : 'var(--loss)'};">${vpMarginStr}/game</b> • ${vpAvgScore} avg pts</div>
    </div>
  `;
}

function renderFactionMeta() {
  renderFactionMetaRows();
}

function renderFactionMetaRows() {
  const tbody = document.getElementById('faction-meta-body');
  if (!tbody || !factionMetaData || !factionMetaData.factions) return;
  tbody.innerHTML = '';

  const allFactions = factionMetaData.factions || [];
  if (allFactions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No match data available for this timeframe.</td></tr>';
    return;
  }

  const searchInput = document.getElementById('faction-search-input');
  const query = searchInput ? (searchInput.value || '').trim().toLowerCase() : '';
  const exclMirrorsEl = document.getElementById('faction-exclude-mirrors-toggle');
  const exclMirrors = exclMirrorsEl ? Boolean(exclMirrorsEl.checked) : false;
  const minGamesEl = document.getElementById('faction-min-games-select');
  const minGames = minGamesEl ? (Number(minGamesEl.value) || 0) : 0;

  const totalFieldGames = allFactions.reduce((acc, f) => acc + (Number(f.total_matches) || 0), 0) || 1;
  const maxMetaShare = Math.max(8, ...allFactions.map(f => Number(f.meta_share) || ((Number(f.total_matches) || 0) * 100 / totalFieldGames)));

  const filtered = allFactions.filter(f => {
    const name = String(f.faction || '');
    if (query && !name.toLowerCase().includes(query)) return false;
    const tm = Number(f.total_matches != null ? f.total_matches : f.games) || 0;
    if (minGames > 0 && tm < minGames) return false;
    const wrVal = exclMirrors && f.non_mirror_win_rate != null ? Number(f.non_mirror_win_rate) : Number(f.win_rate) || 0;
    const tier = f.tier || (wrVal >= 55 ? 'S' : (wrVal >= 50 ? 'A' : (wrVal >= 45 ? 'B' : 'C')));
    if (factionTierFilter !== 'ALL' && tier !== factionTierFilter) return false;
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No factions match your active filters.</td></tr>';
    return;
  }

  filtered.forEach((f, idx) => {
    const tr = document.createElement('tr');
    const safeFacJs = String(f.faction || '').replace(/'/g, "\\'");
    tr.onclick = () => openFactionModal(f.faction);

    const overallWr = Number(f.win_rate) || 0;
    const nonMirrorWr = f.non_mirror_win_rate != null ? Number(f.non_mirror_win_rate) : overallWr;
    const activeWr = exclMirrors ? nonMirrorWr : overallWr;
    const altWr = exclMirrors ? overallWr : nonMirrorWr;
    const altWrLabel = exclMirrors ? `Overall: ${altWr.toFixed(1)}%` : `Ex-Mirror: ${altWr.toFixed(1)}%`;

    let wrClass = 'wr-balanced';
    if (activeWr >= 55) wrClass = 'wr-over';
    else if (activeWr < 45) wrClass = 'wr-under';

    const tier = f.tier || (activeWr >= 55 ? 'S' : (activeWr >= 50 ? 'A' : (activeWr >= 45 ? 'B' : 'C')));
    const tierShort = tier === 'S' ? 'Overperforming' : (tier === 'A' ? 'Balanced High' : (tier === 'B' ? 'Balanced Low' : 'Underperforming'));
    const totalMatches = Number(f.total_matches != null ? f.total_matches : (f.games || ((f.wins || 0) + (f.losses || 0) + (f.draws || 0))));
    const metaShare = f.meta_share != null ? Number(f.meta_share) : ((totalMatches * 100.0) / totalFieldGames);
    const shareBarPct = Math.min(100, Math.max(4, (metaShare / maxMetaShare) * 100));
    const wrBarPct = Math.min(100, Math.max(5, ((activeWr - 30) / 40) * 100));
    const wrBarColor = activeWr >= 55 ? '#a855f7' : (activeWr >= 50 ? '#22c55e' : (activeWr >= 45 ? '#38bdf8' : '#ef4444'));
    const ciMargin = Number(f.ci_margin) || 0;
    const mirrors = Number(f.mirror_matches) || 0;
    const pilots = Number(f.unique_pilots) || 0;
    const x0Runs = Number(f.x0_runs) || 0;
    const x1Runs = Number(f.x1_runs) || 0;
    const overRep = Number(f.over_rep_ratio) || 0;
    const avgScore = Number(f.avg_score) || 0;
    const avgMargin = Number(f.avg_margin) || 0;
    const facColor = getFactionColor(f.faction);

    let overRepBadge = '';
    if (overRep > 0) {
      const repColor = overRep >= 1.25 ? 'var(--win)' : (overRep >= 0.85 ? '#38bdf8' : 'var(--text-muted)');
      overRepBadge = `<span style="font-size:0.72rem; color:${repColor}; font-weight:700;">${overRep.toFixed(2)}x TiWP</span>`;
    } else if (x1Runs > 0) {
      overRepBadge = `<span style="font-size:0.72rem; color:var(--text-secondary);">${x1Runs} X-1 cuts</span>`;
    } else {
      overRepBadge = `<span style="font-size:0.72rem; color:var(--text-muted);">—</span>`;
    }

    let matchupHtml = '<span style="color:var(--text-muted); font-size:0.75rem;">—</span>';
    if (f.best_matchup || f.worst_matchup) {
      const parts = [];
      if (f.best_matchup && f.best_matchup.faction) {
        parts.push(`
          <span class="meta-matchup-pill meta-matchup-best" title="Best Matchup: ${escapeHtml(f.best_matchup.faction)} (${f.best_matchup.wins}W-${f.best_matchup.losses}L, ${f.best_matchup.matches} games)" onclick="event.stopPropagation(); openFactionModal('${safeFacJs}', null, 'matchups')">
            ▲ ${escapeHtml(f.best_matchup.faction)} <b>${Number(f.best_matchup.win_rate).toFixed(0)}%</b>
          </span>
        `);
      }
      if (f.worst_matchup && f.worst_matchup.faction && (!f.best_matchup || f.worst_matchup.faction !== f.best_matchup.faction)) {
        parts.push(`
          <span class="meta-matchup-pill meta-matchup-worst" title="Toughest Counter: ${escapeHtml(f.worst_matchup.faction)} (${f.worst_matchup.wins}W-${f.worst_matchup.losses}L, ${f.worst_matchup.matches} games)" onclick="event.stopPropagation(); openFactionModal('${safeFacJs}', null, 'matchups')">
            ▼ ${escapeHtml(f.worst_matchup.faction)} <b>${Number(f.worst_matchup.win_rate).toFixed(0)}%</b>
          </span>
        `);
      }
      if (parts.length > 0) {
        matchupHtml = `<div style="display:flex; flex-direction:column; gap:0.22rem; align-items:flex-start;">${parts.join('')}</div>`;
      }
    }

    tr.innerHTML = `
      <td style="color:var(--text-muted); font-family:var(--font-mono); font-size:0.84rem;">#${idx + 1}</td>
      <td>
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span style="width:9px; height:9px; border-radius:50%; background:${facColor}; flex-shrink:0; box-shadow:0 0 6px ${facColor}88;"></span>
          <div>
            <div class="player-link" style="font-weight:700; font-size:0.92rem;">${escapeHtml(f.faction)}</div>
            <div style="font-size:0.72rem; color:var(--text-muted);">
              ${pilots > 0 ? `👤 ${formatNumber(pilots)} commanders` : `${formatNumber(totalMatches)} entries`}
            </div>
          </div>
        </div>
      </td>
      <td>
        <span class="tier-badge tier-${tier}">${tier}</span>
        <div style="font-size:0.7rem; color:var(--text-secondary); margin-top:0.18rem;">${tierShort}</div>
      </td>
      <td style="min-width:155px;">
        <div style="display:flex; align-items:baseline; justify-content:space-between; gap:0.35rem;">
          <span class="${wrClass}" style="font-size:0.96rem; font-weight:800; font-family:var(--font-mono);">${activeWr.toFixed(1)}%</span>
          <span style="font-size:0.68rem; color:var(--text-muted); font-family:var(--font-mono);">${ciMargin > 0 ? `±${ciMargin.toFixed(1)}%` : ''}</span>
        </div>
        <div class="meta-wr-bar-track" title="Goldilocks Zone: 45% - 55%">
          <div class="meta-wr-goldilocks-band"></div>
          <div class="meta-wr-bar-fill" style="width:${wrBarPct.toFixed(1)}%; background:${wrBarColor};"></div>
        </div>
        <div style="font-size:0.69rem; color:var(--text-secondary); margin-top:0.15rem; font-family:var(--font-mono);">${altWrLabel}</div>
      </td>
      <td style="min-width:125px;">
        <div style="display:flex; align-items:baseline; justify-content:space-between;">
          <span style="font-family:var(--font-mono); font-weight:700; color:#e2e8f0; font-size:0.88rem;">${metaShare.toFixed(1)}%</span>
          <span style="font-family:var(--font-mono); font-size:0.73rem; color:var(--text-secondary);">${formatNumber(totalMatches)}g</span>
        </div>
        <div class="meta-share-bar-track">
          <div class="meta-share-bar-fill" style="width:${shareBarPct.toFixed(1)}%;"></div>
        </div>
        <div style="font-size:0.68rem; color:var(--text-muted); margin-top:0.12rem;">${mirrors > 0 ? `${formatNumber(mirrors)} mirror games` : '0 mirrors'}</div>
      </td>
      <td style="font-family:var(--font-mono);">
        <div style="display:flex; align-items:center; gap:0.35rem;">
          <span class="badge" style="background:${x0Runs > 0 ? 'rgba(34,197,94,0.14)' : 'rgba(148,163,184,0.1)'}; color:${x0Runs > 0 ? '#4ade80' : 'var(--text-secondary)'}; border:1px solid ${x0Runs > 0 ? 'rgba(34,197,94,0.3)' : 'rgba(148,163,184,0.2)'}; font-size:0.75rem; font-weight:700;">
            🏆 ${x0Runs} X-0
          </span>
        </div>
        <div style="margin-top:0.2rem;">${overRepBadge}</div>
      </td>
      <td style="font-family:var(--font-mono); font-size:0.84rem; white-space:nowrap;">
        <span style="color:var(--win); font-weight:700;">${formatNumber(f.wins)}W</span> -
        <span style="color:var(--loss); font-weight:700;">${formatNumber(f.losses)}L</span>
        ${f.draws ? ` - <span style="color:var(--draw); font-weight:600;">${formatNumber(f.draws)}D</span>` : ''}
      </td>
      <td style="font-family:var(--font-mono);">
        <div style="font-weight:700; color:#f8fafc; font-size:0.86rem;">${avgScore > 0 ? `${avgScore.toFixed(1)} VP` : '-'}</div>
        <div style="font-size:0.73rem; font-weight:700; color:${avgMargin > 0.5 ? 'var(--win)' : (avgMargin < -0.5 ? 'var(--loss)' : 'var(--text-secondary)')};">
          ${avgScore > 0 ? `${avgMargin >= 0 ? '+' : ''}${avgMargin.toFixed(1)} diff` : ''}
        </div>
      </td>
      <td>${matchupHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderFactionDistribution() {
  const container = document.getElementById('faction-meta-dist');
  if (!container || !factionMetaData || !factionMetaData.factions) return;

  const factions = factionMetaData.factions;
  const tiers = { S: 0, A: 0, B: 0, C: 0 };
  factions.forEach(f => {
    if (tiers[f.tier] !== undefined) tiers[f.tier]++;
  });

  const total = factions.length || 1;
  container.innerHTML = `
    <div style="display:flex; gap:1rem; align-items:center; flex-wrap:wrap; font-size:0.8rem;">
      <div><b>Armies:</b> <span style="color:#fff; font-family:var(--font-mono); font-weight:700;">${total}</span></div>
      <div><span class="tier-badge tier-S">S</span> 55%+: <b>${tiers.S}</b></div>
      <div><span class="tier-badge tier-A">A</span> 50-55%: <b>${tiers.A}</b></div>
      <div><span class="tier-badge tier-B">B</span> 45-50%: <b>${tiers.B}</b></div>
      <div><span class="tier-badge tier-C">C</span> &lt;45%: <b>${tiers.C}</b></div>
    </div>
  `;
}

function renderFactionQuadrantChart() {
  const svg = document.getElementById('faction-quadrant-svg');
  const tooltip = document.getElementById('faction-quadrant-tooltip');
  if (!svg || !factionMetaData || !factionMetaData.factions) return;

  const factions = (factionMetaData.factions || []).filter(f => (Number(f.total_matches) || 0) >= 1);
  if (factions.length === 0) {
    svg.innerHTML = '';
    return;
  }

  const w = svg.clientWidth || 920;
  const h = 440;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = '';

  const padL = 64;
  const padR = 40;
  const padT = 34;
  const padB = 48;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const totalAppearances = factions.reduce((acc, f) => acc + (Number(f.total_matches) || 0), 0) || 1;
  const shares = factions.map(f => f.meta_share != null ? Number(f.meta_share) : ((Number(f.total_matches) || 0) * 100 / totalAppearances));
  const maxShare = Math.max(10, Math.ceil(Math.max(...shares, 8) * 1.15));
  const avgShare = 100.0 / Math.max(1, factions.length);

  const isMarginMode = (factionQuadrantMetric === 'margin');
  const yValues = factions.map(f => {
    if (factionQuadrantMetric === 'margin') return Number(f.avg_margin) || 0;
    if (factionQuadrantMetric === 'non_mirror') return Number(f.non_mirror_win_rate != null ? f.non_mirror_win_rate : f.win_rate) || 0;
    return Number(f.win_rate) || 0;
  });

  const minY = isMarginMode ? Math.min(-15, Math.floor(Math.min(...yValues, -10) - 2)) : 32;
  const maxY = isMarginMode ? Math.max(15, Math.ceil(Math.max(...yValues, 10) + 2)) : 68;
  const rangeY = Math.max(1, maxY - minY);

  const toX = (share) => padL + (Math.max(0, Math.min(maxShare, share)) / maxShare) * plotW;
  const toY = (val) => padT + plotH - ((Math.max(minY, Math.min(maxY, val)) - minY) / rangeY) * plotH;

  // Goldilocks Band (45% - 55% WR or -5 to +5 VP Margin)
  const bandLow = isMarginMode ? -4 : 45;
  const bandHigh = isMarginMode ? 4 : 55;
  const yBandTop = toY(bandHigh);
  const yBandBot = toY(bandLow);
  const bandRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bandRect.setAttribute('x', padL);
  bandRect.setAttribute('y', yBandTop);
  bandRect.setAttribute('width', plotW);
  bandRect.setAttribute('height', Math.max(2, yBandBot - yBandTop));
  bandRect.setAttribute('fill', 'rgba(34, 197, 94, 0.07)');
  bandRect.setAttribute('stroke', 'rgba(34, 197, 94, 0.22)');
  bandRect.setAttribute('stroke-dasharray', '4,4');
  svg.appendChild(bandRect);

  // Horizontal Midline (50% WR or 0 VP)
  const yMid = toY(isMarginMode ? 0 : 50);
  const midLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  midLine.setAttribute('x1', padL);
  midLine.setAttribute('y1', yMid);
  midLine.setAttribute('x2', w - padR);
  midLine.setAttribute('y2', yMid);
  midLine.setAttribute('stroke', 'rgba(255,255,255,0.28)');
  midLine.setAttribute('stroke-width', '1.2');
  svg.appendChild(midLine);

  // Vertical Average Popularity Line
  const xAvg = toX(avgShare);
  const vLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  vLine.setAttribute('x1', xAvg);
  vLine.setAttribute('y1', padT);
  vLine.setAttribute('x2', xAvg);
  vLine.setAttribute('y2', h - padB);
  vLine.setAttribute('stroke', 'rgba(56, 189, 248, 0.28)');
  vLine.setAttribute('stroke-width', '1.2');
  vLine.setAttribute('stroke-dasharray', '5,5');
  svg.appendChild(vLine);

  // Quadrant Watermark Labels
  const quadLabels = [
    { x: w - padR - 12, y: padT + 20, anchor: 'end', text: '👑 APEX META (High Play • High Win)', color: '#a855f7' },
    { x: padL + 12, y: padT + 20, anchor: 'start', text: '💎 SLEEPER PICKS (Low Play • High Win)', color: '#22c55e' },
    { x: w - padR - 12, y: h - padB - 12, anchor: 'end', text: '⚔️ POPULAR WORKHORSES (High Play • Sub-50%)', color: '#38bdf8' },
    { x: padL + 12, y: h - padB - 12, anchor: 'start', text: '🛡️ UNDERDOGS (Low Play • Sub-50%)', color: '#94a3b8' }
  ];
  quadLabels.forEach(ql => {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', ql.x);
    t.setAttribute('y', ql.y);
    t.setAttribute('text-anchor', ql.anchor);
    t.setAttribute('fill', ql.color);
    t.setAttribute('opacity', '0.65');
    t.setAttribute('font-size', '10.5');
    t.setAttribute('font-weight', '700');
    t.textContent = ql.text;
    svg.appendChild(t);
  });

  // Y-Axis Ticks
  const yTicks = isMarginMode ? [-15, -10, -5, 0, 5, 10, 15] : [35, 40, 45, 50, 55, 60, 65];
  yTicks.forEach(val => {
    if (val < minY || val > maxY) return;
    const y = toY(val);
    const grid = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    grid.setAttribute('x1', padL);
    grid.setAttribute('y1', y);
    grid.setAttribute('x2', w - padR);
    grid.setAttribute('y2', y);
    grid.setAttribute('stroke', 'rgba(255,255,255,0.05)');
    svg.appendChild(grid);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', padL - 10);
    txt.setAttribute('y', y + 4);
    txt.setAttribute('text-anchor', 'end');
    txt.setAttribute('fill', (val === 50 || val === 0) ? '#fff' : '#64748b');
    txt.setAttribute('font-size', '10');
    txt.setAttribute('font-family', 'monospace');
    txt.textContent = isMarginMode ? `${val >= 0 ? '+' : ''}${val} VP` : `${val}%`;
    svg.appendChild(txt);
  });

  // X-Axis Ticks
  const xStep = maxShare <= 12 ? 2 : (maxShare <= 20 ? 3 : 4);
  for (let s = 0; s <= maxShare; s += xStep) {
    const x = toX(s);
    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', x);
    txt.setAttribute('y', h - 16);
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('fill', '#94a3b8');
    txt.setAttribute('font-size', '10');
    txt.setAttribute('font-family', 'monospace');
    txt.textContent = `${s}%`;
    svg.appendChild(txt);
  }

  const maxGames = Math.max(1, ...factions.map(f => Number(f.total_matches) || 1));

  factions.forEach((f, idx) => {
    const share = f.meta_share != null ? Number(f.meta_share) : ((Number(f.total_matches) || 0) * 100 / totalAppearances);
    const yVal = yValues[idx];
    const cx = toX(share);
    const cy = toY(yVal);
    const games = Number(f.total_matches) || 1;
    const radius = 5.5 + Math.sqrt(games / maxGames) * 11.5;
    const col = getFactionColor(f.faction);

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.style.cursor = 'pointer';

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', radius.toFixed(1));
    circle.setAttribute('fill', col);
    circle.setAttribute('fill-opacity', '0.78');
    circle.setAttribute('stroke', '#fff');
    circle.setAttribute('stroke-width', '1.4');
    g.appendChild(circle);

    const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    lbl.setAttribute('x', cx);
    lbl.setAttribute('y', cy - radius - 4);
    lbl.setAttribute('text-anchor', 'middle');
    lbl.setAttribute('fill', '#e2e8f0');
    lbl.setAttribute('font-size', '10');
    lbl.setAttribute('font-weight', '600');
    lbl.textContent = f.faction;
    g.appendChild(lbl);

    g.onclick = () => openFactionModal(f.faction);
    g.onmouseenter = () => {
      circle.setAttribute('fill-opacity', '1');
      circle.setAttribute('stroke-width', '2.4');
      if (tooltip) {
        tooltip.style.display = 'block';
        const leftPos = Math.min(w - 230, Math.max(12, cx + 14));
        const topPos = Math.max(12, cy - 45);
        tooltip.style.left = `${leftPos}px`;
        tooltip.style.top = `${topPos}px`;
        const nmWr = Number(f.non_mirror_win_rate != null ? f.non_mirror_win_rate : f.win_rate || 0).toFixed(1);
        const mgn = Number(f.avg_margin || 0);
        tooltip.innerHTML = `
          <div style="font-weight:800; color:${col}; font-size:0.86rem; margin-bottom:0.2rem;">${escapeHtml(f.faction)}</div>
          <div><b>Overall WR:</b> ${Number(f.win_rate || 0).toFixed(1)}% <span style="color:#94a3b8;">(Ex-Mirror: ${nmWr}%)</span></div>
          <div><b>Meta Share:</b> ${share.toFixed(2)}% (${formatNumber(games)} games)</div>
          <div><b>Event X-0 Runs:</b> ${Number(f.x0_runs || 0)} undefeated • ${Number(f.x1_runs || 0)} podiums</div>
          <div><b>Avg VP Margin:</b> ${mgn >= 0 ? '+' : ''}${mgn.toFixed(1)} VP/g (${Number(f.avg_score || 0).toFixed(1)} avg)</div>
        `;
      }
    };
    g.onmouseleave = () => {
      circle.setAttribute('fill-opacity', '0.78');
      circle.setAttribute('stroke-width', '1.4');
      if (tooltip) tooltip.style.display = 'none';
    };

    svg.appendChild(g);
  });
}

function _getShortFactionHeader(name) {
  const s = String(name || '').trim();
  const abbrevMap = {
    'Chaos Space Marines': 'CSM',
    'Space Marines': 'SM',
    'Adeptus Custodes': 'Custodes',
    'Adeptus Mechanicus': 'AdMech',
    'Adepta Sororitas': 'Sisters',
    'Astra Militarum': 'Guard',
    'Imperial Knights': 'Imp Knights',
    'Chaos Knights': 'Chaos Knights',
    'Chaos Daemons': 'Daemons',
    'Thousand Sons': 'TSons',
    'World Eaters': 'World Eaters',
    'Death Guard': 'Death Guard',
    'Grey Knights': 'Grey Knights',
    'Black Templars': 'Templars',
    'Blood Angels': 'Blood Angels',
    'Dark Angels': 'Dark Angels',
    'Space Wolves': 'Space Wolves',
    'Genestealer Cults': 'GSC',
    'Leagues of Votann': 'Votann',
    'Imperial Agents': 'Agents',
    "T'au Empire": "T'au",
    'Stormcast Eternals': 'Stormcast',
    'Slaves to Darkness': 'Slaves',
    'Lumineth Realm-lords': 'Lumineth',
    'Soulblight Gravelords': 'Soulblight',
    'Maggotkin of Nurgle': 'Nurgle',
    'Blades of Khorne': 'Khorne',
    'Daughters of Khaine': 'DoK',
    'Kharadron Overlords': 'Kharadron',
    'Ossiarch Bonereapers': 'Ossiarch',
    'Flesh-eater Courts': 'FEC',
    'Disciples of Tzeentch': 'Tzeentch',
    'Hedonites of Slaanesh': 'Slaanesh',
    'Cities of Sigmar': 'Cities',
    'Gloomspite Gitz': 'Gitz'
  };
  return abbrevMap[s] || (s.length > 12 ? s.substring(0, 11) + '…' : s);
}

function _getHeatmapCellStyle(wr, matches) {
  if (!matches || matches <= 0 || wr == null) {
    return 'background:rgba(15,23,42,0.45); color:#475569;';
  }
  const v = Number(wr);
  if (v >= 62) return 'background:rgba(22,163,74,0.42); color:#dcfce7; border-color:rgba(34,197,94,0.45);';
  if (v >= 54) return 'background:rgba(34,197,94,0.22); color:#bbf7d0; border-color:rgba(34,197,94,0.3);';
  if (v >= 47) return 'background:rgba(51,65,85,0.45); color:#e2e8f0; border-color:rgba(148,163,184,0.22);';
  if (v >= 40) return 'background:rgba(239,68,68,0.22); color:#fecaca; border-color:rgba(239,68,68,0.3);';
  return 'background:rgba(220,38,38,0.42); color:#fee2e2; border-color:rgba(239,68,68,0.45);';
}

function renderFactionMatchupMatrix() {
  const wrap = document.getElementById('faction-matrix-grid-wrap');
  if (!wrap || !factionMetaData) return;

  const matrix = factionMetaData.matchup_matrix || { factions: [], cells: {} };
  const factions = (matrix.factions || []).slice(0, factionMatrixSize);
  const cells = matrix.cells || {};

  if (factions.length === 0) {
    wrap.innerHTML = '<div class="empty-state" style="padding:2rem;">No head-to-head matchup matrix data available for this timeframe.</div>';
    return;
  }

  let html = '<table class="meta-matrix-table"><thead><tr><th class="matrix-corner-th">Row Army \\ vs Col</th>';
  factions.forEach(colFac => {
    html += `<th class="matrix-col-th" title="${escapeHtml(colFac)}">${escapeHtml(_getShortFactionHeader(colFac))}</th>`;
  });
  html += '</tr></thead><tbody>';

  factions.forEach(rowFac => {
    const safeRowJs = String(rowFac).replace(/'/g, "\\'");
    html += `<tr><th class="matrix-row-th" onclick="openFactionModal('${safeRowJs}', null, 'matchups')" title="Inspect ${escapeHtml(rowFac)} matchups">${escapeHtml(_getShortFactionHeader(rowFac))}</th>`;
    factions.forEach(colFac => {
      if (rowFac === colFac) {
        html += `<td class="matrix-cell matrix-cell-mirror" title="${escapeHtml(rowFac)} Mirror Match">MIRROR</td>`;
      } else {
        const cell = (cells[rowFac] && cells[rowFac][colFac]) ? cells[rowFac][colFac] : null;
        const mCount = cell ? Number(cell.m || 0) : 0;
        const wr = cell ? Number(cell.wr || 0) : null;
        const style = _getHeatmapCellStyle(wr, mCount);
        if (mCount > 0 && wr != null) {
          const w = Number(cell.w || 0);
          const l = Number(cell.l || 0);
          const d = Number(cell.d || 0);
          const mgn = Number(cell.margin || 0);
          const tip = `${rowFac} vs ${colFac}: ${wr.toFixed(1)}% WR (${w}W-${l}L-${d}D, ${mCount} games, ${mgn >= 0 ? '+' : ''}${mgn.toFixed(1)} VP diff)`;
          html += `
            <td class="matrix-cell" style="${style}" title="${escapeHtml(tip)}" onclick="openFactionModal('${safeRowJs}', null, 'matchups')">
              <div class="matrix-cell-wr">${wr.toFixed(0)}%</div>
              <div class="matrix-cell-cnt">${mCount}g</div>
            </td>
          `;
        } else {
          html += `<td class="matrix-cell" style="${style}" title="No recorded matches between ${escapeHtml(rowFac)} and ${escapeHtml(colFac)}">—</td>`;
        }
      }
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function toggleFaction(fac) {
  if (selectedFactions.has(fac)) {
    selectedFactions.delete(fac);
  } else {
    selectedFactions.add(fac);
  }
  renderFactionTrendChart(factionMetaData ? factionMetaData.monthly_trends || [] : []);
}

function selectFactionPreset(preset) {
  selectedFactions.clear();
  if (preset === 'top8') {
    allAvailableFactions.slice(0, 8).forEach(f => selectedFactions.add(f));
  } else if (preset === 'top15') {
    allAvailableFactions.slice(0, 15).forEach(f => selectedFactions.add(f));
  } else if (preset === 'all') {
    allAvailableFactions.forEach(f => selectedFactions.add(f));
  }
  renderFactionTrendChart(factionMetaData ? factionMetaData.monthly_trends || [] : []);
}

function setHoverFaction(fac) {
  highlightedFaction = fac;
  const svg = document.getElementById('faction-trend-svg');
  if (!svg) return;

  const paths = svg.querySelectorAll('.faction-line');
  paths.forEach(p => {
    const f = p.getAttribute('data-faction');
    if (!fac) {
      p.classList.remove('svg-line-hovered', 'svg-line-dimmed');
    } else if (f === fac) {
      p.classList.add('svg-line-hovered');
      p.classList.remove('svg-line-dimmed');
    } else {
      p.classList.add('svg-line-dimmed');
      p.classList.remove('svg-line-hovered');
    }
  });
}

function renderFactionTrendChart(trends) {
  const isShareMode = (factionTimelineMetric === 'meta_share');
  const chartTitle = document.getElementById('faction-chart-title');
  const chartSub = document.getElementById('faction-chart-subtitle');
  const gran = (factionMetaData && factionMetaData.filter && factionMetaData.filter.granularity) ? factionMetaData.filter.granularity : 'Monthly';
  const tfLabel = getTimeframeDisplayLabel(factionTimeframe);

  if (chartTitle) {
    chartTitle.innerText = isShareMode
      ? '📈 Faction Meta Share (Popularity) Trends Over Time'
      : '📈 Faction Win Rate Trends Over Time';
  }
  if (chartSub) {
    chartSub.innerText = isShareMode
      ? `${gran} Field Representation % (${tfLabel}) across competitive tournaments`
      : `${gran} Win Rate Trajectories (${tfLabel}) vs 45%-55% Goldilocks Balance Band`;
  }

  const chipsContainer = document.getElementById('faction-toggle-chips');
  if (chipsContainer) {
    chipsContainer.innerHTML = '';
    allAvailableFactions.forEach(fac => {
      const isAct = selectedFactions.has(fac);
      const col = getFactionColor(fac);
      const chip = document.createElement('div');
      chip.className = `faction-chip ${isAct ? 'active' : ''}`;
      chip.style.borderColor = isAct ? col : 'var(--border-color)';
      chip.onmouseenter = () => setHoverFaction(fac);
      chip.onmouseleave = () => setHoverFaction(null);
      chip.onclick = () => toggleFaction(fac);
      chip.innerHTML = `<span class="dot" style="background:${col}; opacity:${isAct ? 1 : 0.4};"></span><span>${escapeHtml(fac)}</span>`;
      chipsContainer.appendChild(chip);
    });
  }

  const svg = document.getElementById('faction-trend-svg');
  const legendContainer = document.getElementById('faction-trend-legend');
  const tooltip = document.getElementById('faction-chart-tooltip');
  if (!svg || !trends || trends.length === 0) return;

  const monthsSet = new Set();
  const factionMap = {};
  const periodTotals = {};

  trends.forEach(t => {
    monthsSet.add(t.month);
    periodTotals[t.month] = (periodTotals[t.month] || 0) + (Number(t.matches_in_month) || 0);
  });

  trends.forEach(t => {
    if (!factionMap[t.faction]) factionMap[t.faction] = {};
    const shareVal = t.meta_share != null
      ? Number(t.meta_share)
      : (periodTotals[t.month] > 0 ? ((Number(t.matches_in_month) || 0) * 100 / periodTotals[t.month]) : 0);
    factionMap[t.faction][t.month] = {
      win_rate: Number(t.win_rate) || 0,
      meta_share: shareVal,
      matches: Number(t.matches_in_month) || 0
    };
  });

  const months = Array.from(monthsSet).sort();
  if (months.length === 0) return;

  const activeFactions = allAvailableFactions.filter(f => selectedFactions.has(f));

  const w = svg.clientWidth || 850;
  const h = 310;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = '';

  const padX = 60;
  const padY = 30;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;

  let minVal = 35;
  let maxVal = 65;
  if (isShareMode) {
    minVal = 0;
    let maxObs = 12;
    activeFactions.forEach(fac => {
      months.forEach(m => {
        const entry = factionMap[fac] ? factionMap[fac][m] : null;
        if (entry && entry.meta_share > maxObs) maxObs = entry.meta_share;
      });
    });
    maxVal = Math.ceil(maxObs * 1.15);
  }
  const range = Math.max(1, maxVal - minVal);

  if (!isShareMode) {
    // Goldilocks Balance Band (45% - 55%)
    const y45 = padY + plotH - ((45 - minVal) / range) * plotH;
    const y55 = padY + plotH - ((55 - minVal) / range) * plotH;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', padX);
    rect.setAttribute('y', y55);
    rect.setAttribute('width', plotW);
    rect.setAttribute('height', y45 - y55);
    rect.setAttribute('fill', 'rgba(34, 197, 94, 0.08)');
    rect.setAttribute('stroke', 'rgba(34, 197, 94, 0.25)');
    rect.setAttribute('stroke-dasharray', '4,4');
    svg.appendChild(rect);

    const y50 = padY + plotH - ((50 - minVal) / range) * plotH;
    const line50 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line50.setAttribute('x1', padX);
    line50.setAttribute('y1', y50);
    line50.setAttribute('x2', w - padX);
    line50.setAttribute('y2', y50);
    line50.setAttribute('stroke', 'rgba(255,255,255,0.2)');
    svg.appendChild(line50);
  }

  const yTicks = isShareMode
    ? [0, Math.round(maxVal * 0.25), Math.round(maxVal * 0.5), Math.round(maxVal * 0.75), maxVal]
    : [35, 45, 50, 55, 65];
  yTicks.forEach(val => {
    const y = padY + plotH - ((val - minVal) / range) * plotH;
    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', padX - 8);
    txt.setAttribute('y', y + 4);
    txt.setAttribute('fill', (!isShareMode && val === 50) ? '#fff' : '#64748b');
    txt.setAttribute('font-size', '10');
    txt.setAttribute('font-family', 'monospace');
    txt.setAttribute('text-anchor', 'end');
    txt.textContent = `${val}%`;
    svg.appendChild(txt);
  });

  const labelStep = months.length > 14 ? Math.ceil(months.length / 10) : 1;
  months.forEach((m, idx) => {
    if (idx % labelStep !== 0 && idx !== months.length - 1) return;
    const x = padX + (idx / (months.length - 1 || 1)) * plotW;
    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', x);
    txt.setAttribute('y', h - 8);
    txt.setAttribute('fill', '#94a3b8');
    txt.setAttribute('font-size', '10');
    txt.setAttribute('font-family', 'monospace');
    txt.setAttribute('text-anchor', 'middle');
    txt.textContent = m;
    svg.appendChild(txt);
  });

  activeFactions.forEach(fac => {
    const color = getFactionColor(fac);
    const pts = [];

    months.forEach((m, mIdx) => {
      const entry = factionMap[fac] ? factionMap[fac][m] : undefined;
      if (entry !== undefined) {
        const rawVal = isShareMode ? entry.meta_share : entry.win_rate;
        const x = padX + (mIdx / (months.length - 1 || 1)) * plotW;
        const clamped = Math.max(minVal, Math.min(maxVal, rawVal));
        const y = padY + plotH - ((clamped - minVal) / range) * plotH;
        pts.push({ x, y, val: rawVal, wr: entry.win_rate, share: entry.meta_share, matches: entry.matches, month: m, faction: fac });
      }
    });

    if (pts.length > 1) {
      let dStr = `M ${pts[0].x} ${pts[0].y}`;
      for (let i = 1; i < pts.length; i++) {
        dStr += ` L ${pts[i].x} ${pts[i].y}`;
      }
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', dStr);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', '2.2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('data-faction', fac);
      path.classList.add('faction-line');
      svg.appendChild(path);
    }

    pts.forEach(pt => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', pt.x);
      circle.setAttribute('cy', pt.y);
      circle.setAttribute('r', '4');
      circle.setAttribute('fill', color);
      circle.setAttribute('stroke', '#0a0c10');
      circle.setAttribute('stroke-width', '1.5');
      circle.style.cursor = 'pointer';
      circle.onclick = () => openFactionModal(pt.faction);

      if (tooltip) {
        circle.onmouseenter = () => {
          setHoverFaction(fac);
          tooltip.style.display = 'block';
          tooltip.style.left = `${Math.min(w - 200, pt.x + 10)}px`;
          tooltip.style.top = `${Math.max(8, pt.y - 38)}px`;
          tooltip.innerHTML = `
            <b style="color:${color};">${escapeHtml(pt.faction)}</b><br>
            <span style="color:#94a3b8;">${pt.month}:</span> <b>${pt.wr.toFixed(1)}% WR</b> • <b>${pt.share.toFixed(1)}% Share</b> (${pt.matches}g)
          `;
        };
        circle.onmouseleave = () => {
          setHoverFaction(null);
          tooltip.style.display = 'none';
        };
      }
      svg.appendChild(circle);
    });
  });

  if (legendContainer) {
    legendContainer.innerHTML = '';
    activeFactions.forEach(fac => {
      const color = getFactionColor(fac);
      const div = document.createElement('div');
      div.style.cssText = 'display:flex; align-items:center; gap:0.35rem; font-size:0.78rem; font-weight:600; cursor:pointer;';
      div.onmouseenter = () => setHoverFaction(fac);
      div.onmouseleave = () => setHoverFaction(null);
      div.onclick = () => openFactionModal(fac);
      div.innerHTML = `<span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${color};"></span> <span class="player-link">${escapeHtml(fac)}</span>`;
      legendContainer.appendChild(div);
    });
  }
}

if (typeof window !== 'undefined') {
  window.setFactionTimeframe = setFactionTimeframe;
  window.applyCustomFactionDateFilter = applyCustomFactionDateFilter;
  window.setFactionViewMode = setFactionViewMode;
  window.setFactionTierFilter = setFactionTierFilter;
  window.onFactionTableFilterChange = onFactionTableFilterChange;
  window.setQuadrantMetric = setQuadrantMetric;
  window.setMatchupMatrixSize = setMatchupMatrixSize;
  window.setTimelineMetric = setTimelineMetric;
  window.renderFactionMeta = renderFactionMeta;
  window.openDatePicker = openDatePicker;
  window.resetFactionState = function() {
    factionMetaData = null;
    selectedFactions.clear();
    allAvailableFactions = [];
  };
}
