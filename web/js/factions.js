/* ==========================================================================
   FACTIONS.JS - Competitive Meta Intel, Tournament Scope Filters & Matchup Matrix
   ========================================================================== */

const _initNow = new Date();
const _init90d = new Date(_initNow.getTime() - 90 * 24 * 60 * 60 * 1000);
let factionMetaData = null;
let factionTimeframe = '90d';
let factionCustomStart = _init90d.toISOString().substring(0, 10);
let factionCustomEnd = _initNow.toISOString().substring(0, 10);
let factionViewMode = 'table'; // 'table' | 'matrix'
let factionTierFilter = 'ALL';
let factionMatrixSize = 14; // 10 | 14 | 16

const DEFAULT_META_EVENT_FILTERS = Object.freeze({
  min_players: 0,
  max_players: 0,
  min_rounds: 0,
  exclude_leagues: false,
  venue_mode: 'all',
  event_structure: 'all',
  event_format: 'all',
  region: 'all',
  country: 'all',
  state: 'all',
  elo_floor: 0,
  elo_mode: 'both'
});

let _metaMobileDrawerOpen = false;

// Initial default on page load: All Events
let factionEventFilters = { ...DEFAULT_META_EVENT_FILTERS };
let _metaLoadSeq = 0;

// Client-side L1 cache for instant 0ms switching across timeframes and filter presets
const factionMetaClientCache = new Map();
let _factionPrefetchScheduled = new Set();

const FACTION_PALETTE = [
  '#38bdf8', '#a855f7', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#f97316', '#e2e8f0',
  '#ef4444', '#10b981', '#6366f1', '#eab308', '#d946ef', '#14b8a6', '#84cc16', '#f43f5e',
  '#8b5cf6', '#3b82f6', '#2dd4bf', '#fb923c', '#94a3b8', '#fdba74', '#c084fc', '#4ade80'
];

const _META_REGION_LABELS = {
  NA: 'North America',
  UK_IE: 'UK & Ireland',
  EU: 'Continental Europe',
  OCE: 'Oceania',
  ASIA: 'Asia',
  LATAM: 'Latin America'
};

const _META_STRUCTURE_LABELS = {
  singles: 'Singles (1v1)',
  teams: 'Teams',
  doubles: 'Doubles (2v2)',
  ffa_pod: 'Pods (FFA)'
};

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

function getActiveMetaEventFilters() {
  return { ...factionEventFilters };
}

function isMetaEventFiltersDefault(f = factionEventFilters) {
  if (!f || typeof f !== 'object') return true;
  return (
    (Number(f.min_players) || 0) <= 0 &&
    (Number(f.max_players) || 0) <= 0 &&
    (Number(f.min_rounds) || 0) <= 0 &&
    !f.exclude_leagues &&
    (!f.venue_mode || f.venue_mode === 'all') &&
    (!f.event_structure || f.event_structure === 'all') &&
    (!f.event_format || f.event_format === 'all') &&
    (!f.region || f.region === 'all') &&
    (!f.country || f.country === 'all') &&
    (!f.state || f.state === 'all') &&
    (Number(f.elo_floor) || 0) <= 0
  );
}

function getMetaEventFilterCacheKey(f = factionEventFilters) {
  if (isMetaEventFiltersDefault(f)) return '';
  const parts = [];
  if (Number(f.min_players) > 0) parts.push(`mp${Math.floor(Number(f.min_players))}`);
  if (Number(f.max_players) > 0) parts.push(`xp${Math.floor(Number(f.max_players))}`);
  if (Number(f.min_rounds) > 0) parts.push(`mr${Math.floor(Number(f.min_rounds))}`);
  if (f.exclude_leagues) parts.push('xl1');
  if (f.venue_mode && f.venue_mode !== 'all') parts.push(`vm_${f.venue_mode}`);
  if (f.event_structure && f.event_structure !== 'all') parts.push(`st_${f.event_structure}`);
  if (f.event_format && f.event_format !== 'all') parts.push(`fm_${f.event_format}`);
  if (f.region && f.region !== 'all') parts.push(`rg_${f.region}`);
  if (f.country && f.country !== 'all') parts.push(`cc_${f.country}`);
  if (f.state && f.state !== 'all') parts.push(`sc_${f.state}`);
  if (Number(f.elo_floor) > 0) {
    const modeSfx = f.elo_mode === 'pilot' ? 'p' : 'b';
    parts.push(`ef${modeSfx}${Math.floor(Number(f.elo_floor))}`);
  }
  return parts.length > 0 ? `__${parts.join('_')}` : '';
}

function getMetaEventFilterSummaryChips(f = factionEventFilters) {
  if (isMetaEventFiltersDefault(f)) return [];
  const chips = [];
  if (Number(f.min_players) > 0) chips.push(`${Math.floor(Number(f.min_players))}+ Players`);
  if (Number(f.max_players) > 0) chips.push(`≤${Math.floor(Number(f.max_players))} Players`);
  if (Number(f.min_rounds) > 0) chips.push(`${Math.floor(Number(f.min_rounds))}+ Rounds`);
  if (f.exclude_leagues) chips.push('Excl. Leagues');
  if (f.venue_mode === 'in_person') chips.push('In-Person');
  else if (f.venue_mode === 'online') chips.push('Online');
  if (f.event_structure && f.event_structure !== 'all') {
    chips.push(_META_STRUCTURE_LABELS[f.event_structure] || f.event_structure);
  }
  if (f.event_format && f.event_format !== 'all') {
    const fmtEl = document.getElementById('meta-format-select');
    let fmtLabel = f.event_format.replace(/_/g, ' ');
    if (fmtEl && fmtEl.options) {
      for (let i = 0; i < fmtEl.options.length; i++) {
        if (fmtEl.options[i].value === f.event_format) {
          fmtLabel = fmtEl.options[i].getAttribute('data-clean-label') || fmtEl.options[i].textContent.trim();
          break;
        }
      }
    }
    chips.push(fmtLabel);
  }
  if (f.country && f.country !== 'all') {
    chips.push(f.state && f.state !== 'all' ? `${f.country} • ${f.state}` : f.country);
  } else if (f.region && f.region !== 'all') {
    chips.push(_META_REGION_LABELS[f.region] || f.region);
  }
  if (Number(f.elo_floor) > 0) {
    const eloVal = Math.floor(Number(f.elo_floor));
    chips.push(f.elo_mode === 'pilot' ? `Pilot ≥ ${eloVal} Elo` : `Both ≥ ${eloVal} Elo`);
  }
  return chips;
}

function toggleMetaMobileFilterDrawer(forceState = null) {
  _metaMobileDrawerOpen = typeof forceState === 'boolean' ? forceState : !_metaMobileDrawerOpen;
  const panelEl = document.getElementById('meta-scope-filter-panel');
  const btnEl = document.getElementById('meta-mobile-drawer-btn');
  if (panelEl) panelEl.classList.toggle('mobile-open', _metaMobileDrawerOpen);
  if (btnEl) btnEl.setAttribute('aria-expanded', _metaMobileDrawerOpen ? 'true' : 'false');
}

function syncMetaScopeFilterControlsUI() {
  const f = factionEventFilters;
  const presetPlayerVals = new Set([0, 8, 16, 28, 32, 64, 100]);
  const mp = Number(f.min_players) || 0;
  document.querySelectorAll('.meta-players-pills .meta-pill-btn').forEach(btn => {
    const val = Number(btn.getAttribute('data-min-players') || 0);
    btn.classList.toggle('active', val === mp);
  });
  const customPlayersInput = document.getElementById('meta-custom-min-players');
  if (customPlayersInput) {
    customPlayersInput.value = (mp > 0 && !presetPlayerVals.has(mp)) ? String(mp) : (mp > 0 ? String(mp) : '');
  }

  const mr = Number(f.min_rounds) || 0;
  document.querySelectorAll('.meta-rounds-pills .meta-pill-btn').forEach(btn => {
    const val = Number(btn.getAttribute('data-min-rounds') || 0);
    btn.classList.toggle('active', val === mr);
  });

  const exclLgEl = document.getElementById('meta-exclude-leagues-toggle');
  if (exclLgEl) exclLgEl.checked = Boolean(f.exclude_leagues);

  document.querySelectorAll('.meta-venue-pills .meta-pill-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-venue') === (f.venue_mode || 'all'));
  });

  document.querySelectorAll('.meta-structure-pills .meta-pill-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-structure') === (f.event_structure || 'all'));
  });

  const fmtSel = document.getElementById('meta-format-select');
  if (fmtSel) fmtSel.value = f.event_format || 'all';

  const locGroup = document.getElementById('meta-location-group');
  if (locGroup) {
    locGroup.style.opacity = f.venue_mode === 'online' ? '0.45' : '1';
  }
  const rgSel = document.getElementById('meta-region-select');
  if (rgSel) {
    rgSel.value = f.region || 'all';
    rgSel.disabled = f.venue_mode === 'online';
  }
  const ccSel = document.getElementById('meta-country-select');
  if (ccSel) {
    ccSel.value = f.country || 'all';
    ccSel.disabled = f.venue_mode === 'online';
  }
  const stSel = document.getElementById('meta-state-select');
  if (stSel) {
    stSel.style.display = (f.country === 'US' && f.venue_mode !== 'online') ? '' : 'none';
    stSel.value = f.state || 'all';
  }

  const presetEloVals = new Set([0, 1550, 1650, 1750, 1850, 1950, 2000]);
  const ef = Number(f.elo_floor) || 0;
  document.querySelectorAll('.meta-elo-pills .meta-pill-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.getAttribute('data-elo') || 0) === ef);
  });
  const customEloInput = document.getElementById('meta-custom-elo-floor');
  if (customEloInput) {
    customEloInput.value = ef > 0 ? String(ef) : '';
    customEloInput.style.borderColor = (ef > 0 && !presetEloVals.has(ef)) ? '#38bdf8' : '';
  }

  const curEloMode = f.elo_mode === 'pilot' ? 'pilot' : 'both';
  const eloModeGroup = document.getElementById('meta-elo-mode-group');
  if (eloModeGroup) {
    eloModeGroup.style.opacity = ef > 0 ? '1' : '0.68';
    eloModeGroup.querySelectorAll('.meta-elo-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-elo-mode') === curEloMode);
    });
  }

  const activeBar = document.getElementById('meta-active-scope-bar');
  const badgesWrap = document.getElementById('meta-active-scope-badges');
  const chips = getMetaEventFilterSummaryChips(f);
  const chipsHtml = chips.map(c => `<span class="meta-scope-chip">${escapeHtml(c)}</span>`).join('');
  if (activeBar && badgesWrap) {
    if (chips.length > 0) {
      activeBar.style.display = 'inline-flex';
      badgesWrap.innerHTML = chipsHtml;
    } else {
      activeBar.style.display = 'none';
      badgesWrap.innerHTML = '';
    }
  }

  const mobCountEl = document.getElementById('meta-mobile-filter-count');
  const mobChipsEl = document.getElementById('meta-mobile-active-chips');
  const mobResetBtn = document.getElementById('meta-mobile-reset-btn');
  if (mobCountEl) {
    mobCountEl.style.display = chips.length > 0 ? 'inline-flex' : 'none';
    mobCountEl.textContent = String(chips.length);
  }
  if (mobChipsEl) {
    mobChipsEl.innerHTML = chips.length > 0
      ? chipsHtml
      : '<span class="meta-mobile-all-hint">All Events</span>';
  }
  if (mobResetBtn) {
    mobResetBtn.style.display = chips.length > 0 ? 'inline-flex' : 'none';
  }
}

function syncMetaFilterOptionsUI(avail) {
  if (!avail || typeof avail !== 'object') return;

  if (Array.isArray(avail.structures) && avail.structures.length > 0) {
    const stMap = new Map();
    avail.structures.forEach(item => {
      if (item && item.code) stMap.set(String(item.code), Number(item.count || 0));
    });
    const curStruct = factionEventFilters.event_structure || 'all';
    document.querySelectorAll('.meta-structure-pills .meta-pill-btn').forEach(btn => {
      const code = btn.getAttribute('data-structure') || 'all';
      if (code === 'all' || code === 'singles' || code === curStruct) {
        btn.style.display = '';
      } else {
        btn.style.display = (stMap.get(code) || 0) > 0 ? '' : 'none';
      }
    });
  }

  const ccSel = document.getElementById('meta-country-select');
  if (ccSel && Array.isArray(avail.countries)) {
    const curCc = factionEventFilters.country || 'all';
    let html = '<option value="all">All Countries</option>';
    let seenCur = (curCc === 'all');
    avail.countries.forEach(item => {
      if (!item || !item.code) return;
      if (item.code === curCc) seenCur = true;
      const cnt = Number(item.count || 0);
      html += `<option value="${escapeHtml(item.code)}">${escapeHtml(item.name || item.code)} (${formatNumber(cnt)})</option>`;
    });
    if (!seenCur && curCc !== 'all') {
      html += `<option value="${escapeHtml(curCc)}">${escapeHtml(curCc)}</option>`;
    }
    ccSel.innerHTML = html;
    ccSel.value = curCc;
  }

  const stSel = document.getElementById('meta-state-select');
  if (stSel && Array.isArray(avail.us_states)) {
    const curSt = factionEventFilters.state || 'all';
    let html = '<option value="all">All US States</option>';
    let seenSt = (curSt === 'all');
    avail.us_states.forEach(item => {
      if (!item || !item.code) return;
      if (item.code === curSt) seenSt = true;
      const cnt = Number(item.count || 0);
      html += `<option value="${escapeHtml(item.code)}">${escapeHtml(item.code)} — ${escapeHtml(item.name || item.code)} (${formatNumber(cnt)})</option>`;
    });
    if (!seenSt && curSt !== 'all') {
      html += `<option value="${escapeHtml(curSt)}">${escapeHtml(curSt)}</option>`;
    }
    stSel.innerHTML = html;
    stSel.value = curSt;
    stSel.style.display = (factionEventFilters.country === 'US' && factionEventFilters.venue_mode !== 'online') ? '' : 'none';
  }

  const fmtWrap = document.getElementById('meta-format-select-wrap');
  const fmtSel = document.getElementById('meta-format-select');
  if (fmtWrap && fmtSel && Array.isArray(avail.formats)) {
    const curFmt = factionEventFilters.event_format || 'all';
    const nonEmptyFmts = avail.formats.filter(x => x && x.code && Number(x.count || 0) > 0);
    const hasMeaningfulVariety = nonEmptyFmts.length >= 1 || curFmt !== 'all';
    if (hasMeaningfulVariety) {
      let html = '<option value="all">All Formats</option>';
      let seenFmt = (curFmt === 'all');
      nonEmptyFmts.forEach(item => {
        if (item.code === curFmt) seenFmt = true;
        const lbl = item.label || item.code;
        html += `<option value="${escapeHtml(item.code)}" data-clean-label="${escapeHtml(lbl)}">${escapeHtml(lbl)}</option>`;
      });
      if (!seenFmt && curFmt !== 'all') {
        html += `<option value="${escapeHtml(curFmt)}" data-clean-label="${escapeHtml(curFmt)}">${escapeHtml(curFmt)}</option>`;
      }
      fmtSel.innerHTML = html;
      fmtSel.value = curFmt;
      fmtWrap.style.display = '';
    } else {
      fmtSel.innerHTML = '<option value="all">All Formats</option>';
      fmtWrap.style.display = 'none';
    }
  }
}

function setMetaMinPlayers(val) {
  const n = Math.max(0, Math.min(5000, Math.floor(Number(val) || 0)));
  factionEventFilters.min_players = n;
  syncMetaScopeFilterControlsUI();
  loadFactionMeta();
}

function onMetaCustomPlayersChange(val) {
  const n = Math.max(0, Math.min(5000, Math.floor(Number(val) || 0)));
  factionEventFilters.min_players = n;
  syncMetaScopeFilterControlsUI();
  loadFactionMeta();
}

function setMetaMinRounds(val) {
  const r = Math.max(0, Math.min(30, Math.floor(Number(val) || 0)));
  factionEventFilters.min_rounds = r;
  syncMetaScopeFilterControlsUI();
  loadFactionMeta();
}

function toggleMetaExcludeLeagues(checked) {
  factionEventFilters.exclude_leagues = Boolean(checked);
  syncMetaScopeFilterControlsUI();
  loadFactionMeta();
}

function setMetaVenueMode(mode) {
  const m = (mode === 'in_person' || mode === 'online') ? mode : 'all';
  factionEventFilters.venue_mode = m;
  if (m === 'online') {
    factionEventFilters.region = 'all';
    factionEventFilters.country = 'all';
    factionEventFilters.state = 'all';
  }
  syncMetaScopeFilterControlsUI();
  loadFactionMeta();
}

function setMetaEventStructure(st) {
  const allowed = new Set(['all', 'singles', 'teams', 'doubles', 'ffa_pod']);
  factionEventFilters.event_structure = allowed.has(st) ? st : 'all';
  syncMetaScopeFilterControlsUI();
  loadFactionMeta();
}

function setMetaEventFormat(fmt) {
  factionEventFilters.event_format = (fmt && fmt !== 'all') ? String(fmt) : 'all';
  syncMetaScopeFilterControlsUI();
  loadFactionMeta();
}

function onMetaRegionChange(val) {
  const rg = (val && val !== 'all') ? String(val) : 'all';
  factionEventFilters.region = rg;
  if (rg !== 'all') {
    factionEventFilters.country = 'all';
    factionEventFilters.state = 'all';
    if (factionEventFilters.venue_mode === 'online') factionEventFilters.venue_mode = 'in_person';
  }
  syncMetaScopeFilterControlsUI();
  loadFactionMeta();
}

function onMetaCountryChange(val) {
  const cc = (val && val !== 'all') ? String(val) : 'all';
  factionEventFilters.country = cc;
  if (cc !== 'US') {
    factionEventFilters.state = 'all';
  }
  if (cc !== 'all' && factionEventFilters.venue_mode === 'online') {
    factionEventFilters.venue_mode = 'in_person';
  }
  syncMetaScopeFilterControlsUI();
  loadFactionMeta();
}

function onMetaStateChange(val) {
  const st = (val && val !== 'all') ? String(val) : 'all';
  factionEventFilters.state = st;
  if (st !== 'all') {
    factionEventFilters.country = 'US';
    if (factionEventFilters.venue_mode === 'online') factionEventFilters.venue_mode = 'in_person';
  }
  syncMetaScopeFilterControlsUI();
  loadFactionMeta();
}

function setMetaEloFloor(val) {
  const raw = Math.floor(Number(val) || 0);
  const ef = raw <= 0 ? 0 : Math.max(1000, Math.min(3500, raw));
  factionEventFilters.elo_floor = ef;
  syncMetaScopeFilterControlsUI();
  loadFactionMeta();
}

function onMetaCustomEloChange(val) {
  const trimmed = String(val || '').trim();
  if (!trimmed) {
    setMetaEloFloor(0);
    return;
  }
  const n = Math.floor(Number(trimmed) || 0);
  setMetaEloFloor(n > 0 ? Math.max(1000, Math.min(3500, n)) : 0);
}

function setMetaEloMode(mode) {
  const m = mode === 'pilot' ? 'pilot' : 'both';
  if (factionEventFilters.elo_mode === m) return;
  factionEventFilters.elo_mode = m;
  syncMetaScopeFilterControlsUI();
  if ((Number(factionEventFilters.elo_floor) || 0) > 0) {
    loadFactionMeta();
  }
}

function resetMetaEventFilters() {
  factionEventFilters = { ...DEFAULT_META_EVENT_FILTERS };
  syncMetaScopeFilterControlsUI();
  loadFactionMeta();
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
  factionViewMode = (mode === 'matrix') ? 'matrix' : 'table';
  const modes = ['table', 'matrix'];
  modes.forEach(m => {
    const btn = document.getElementById(`faction-mode-btn-${m}`);
    const container = document.getElementById(`faction-view-${m}-container`);
    if (btn) btn.classList.toggle('active', m === factionViewMode);
    if (container) container.style.display = (m === factionViewMode) ? 'block' : 'none';
  });

  if (!factionMetaData) return;
  if (factionViewMode === 'matrix') {
    renderFactionMatchupMatrix();
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

function setMatchupMatrixSize(size) {
  factionMatrixSize = Number(size) || 14;
  [10, 14, 16].forEach(n => {
    const btn = document.getElementById(`matrix-size-${n}`);
    if (btn) btn.classList.toggle('active', n === factionMatrixSize);
  });
  renderFactionMatchupMatrix();
}

function _applyFactionMetaDataToUI(data) {
  if (data && Array.isArray(data.factions)) {
    data.factions = data.factions.filter(f => f && f.faction && !String(f.faction).includes('+'));
  }
  factionMetaData = data;
  if (data && data.available_filters) {
    syncMetaFilterOptionsUI(data.available_filters);
  }
  syncMetaScopeFilterControlsUI();
  renderFactionMetaKpis();
  renderFactionMetaRows();
  renderFactionDistribution();
  if (factionViewMode === 'matrix') {
    renderFactionMatchupMatrix();
  }
}

function scheduleFactionPresetsPrefetch(sys) {
  const sysKey = sys || '40k';
  if (!isMetaEventFiltersDefault(factionEventFilters)) return;
  if (_factionPrefetchScheduled.has(sysKey)) return;
  _factionPrefetchScheduled.add(sysKey);

  const presetsToWarm = ['30d', '180d', '1yr', 'all', '60d', 'ytd'];
  setTimeout(async () => {
    for (const p of presetsToWarm) {
      const ck = `${sysKey}_preset_${p}`;
      if (factionMetaClientCache.has(ck)) continue;
      try {
        const res = await window.api.getFactionMeta(null, null, p, sysKey, { include_trends: false });
        if (res && Array.isArray(res.factions) && res.factions.length > 0) {
          factionMetaClientCache.set(ck, { timestamp: Date.now(), data: res });
        }
      } catch (e) {
        // Silent background warm
      }
    }
    if (typeof window.prefetchTopFactionsModalCache === 'function' && factionMetaData && Array.isArray(factionMetaData.factions)) {
      const topFacNames = factionMetaData.factions.slice(0, 8).map(f => f.faction).filter(Boolean);
      window.prefetchTopFactionsModalCache(topFacNames, sysKey);
    }
  }, 350);
}

const _lastKnownMetaMatchesByKey = new Map();

function _checkAndInvalidateModalCacheOnMetaChange(cacheKey, data) {
  if (!data || !data.summary_kpis) return false;
  const newTotal = Number(data.summary_kpis.total_matches || 0);
  const prevTotal = _lastKnownMetaMatchesByKey.get(cacheKey);
  _lastKnownMetaMatchesByKey.set(cacheKey, newTotal);
  if (prevTotal !== undefined && prevTotal !== newTotal) {
    if (typeof window.clearFactionModalClientCache === 'function') {
      window.clearFactionModalClientCache();
    }
    return true;
  }
  return false;
}

async function loadFactionMeta() {
  const tbody = document.getElementById('faction-meta-body');
  const sys = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
  const isCustom = (factionTimeframe === 'custom');
  const activeFilters = getActiveMetaEventFilters();
  const isFiltered = !isMetaEventFiltersDefault(activeFilters);
  const filterKey = getMetaEventFilterCacheKey(activeFilters);
  const cacheKey = isCustom
    ? `${sys}_custom_${factionCustomStart}_${factionCustomEnd}${filterKey}`
    : `${sys}_preset_${factionTimeframe}${filterKey}`;
  const reqSeq = ++_metaLoadSeq;

  const cached = factionMetaClientCache.get(cacheKey);
  const now = Date.now();
  const cachedValid = Boolean(
    cached &&
    cached.data &&
    Array.isArray(cached.data.factions) &&
    (cached.data.factions.length > 0 || isFiltered)
  );
  if (cachedValid && (now - cached.timestamp) < 600000) {
    _applyFactionMetaDataToUI(cached.data);
    scheduleFactionPresetsPrefetch(sys);
    if ((now - cached.timestamp) >= 60000) {
      const reqStartBg = isCustom ? factionCustomStart : null;
      const reqEndBg = isCustom ? factionCustomEnd : null;
      const reqTfBg = factionTimeframe;
      window.api.getFactionMeta(reqStartBg, reqEndBg, reqTfBg, sys, { ...activeFilters, include_trends: false }).then((freshData) => {
        if (freshData && Array.isArray(freshData.factions) && (freshData.factions.length > 0 || isFiltered)) {
          factionMetaClientCache.set(cacheKey, { timestamp: Date.now(), data: freshData });
          const changed = _checkAndInvalidateModalCacheOnMetaChange(cacheKey, freshData);
          if (changed && factionTimeframe === reqTfBg && getMetaEventFilterCacheKey() === filterKey) {
            _applyFactionMetaDataToUI(freshData);
          }
        }
      }).catch(() => {});
    }
    return;
  }

  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Analyzing competitive tournament meta...</div></td></tr>';
  }

  try {
    const reqStart = isCustom ? factionCustomStart : null;
    const reqEnd = isCustom ? factionCustomEnd : null;
    const data = await window.api.getFactionMeta(reqStart, reqEnd, factionTimeframe, sys, { ...activeFilters, include_trends: false });
    if (reqSeq !== _metaLoadSeq) return;
    if (data && Array.isArray(data.factions) && (data.factions.length > 0 || isFiltered)) {
      factionMetaClientCache.set(cacheKey, { timestamp: Date.now(), data });
      _checkAndInvalidateModalCacheOnMetaChange(cacheKey, data);
    }
    _applyFactionMetaDataToUI(data);
    scheduleFactionPresetsPrefetch(sys);
  } catch (err) {
    if (reqSeq !== _metaLoadSeq) return;
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="empty-state" style="color:var(--loss);">Error loading faction meta: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderFactionMetaKpis() {
  const strip = document.getElementById('faction-meta-kpis-strip');
  if (!strip || !factionMetaData || !Array.isArray(factionMetaData.factions)) return;

  const factions = factionMetaData.factions || [];
  const kpis = factionMetaData.summary_kpis || {};
  const totalAppearances = Number(kpis.total_appearances) || factions.reduce((acc, f) => acc + (Number(f.total_matches) || 0), 0);
  const totalMatches = kpis.total_matches != null ? Number(kpis.total_matches) : Math.round(totalAppearances / 2);
  const matchedEvents = kpis.matched_events != null ? Number(kpis.matched_events) : null;
  const totalPilots = kpis.total_pilots != null ? Number(kpis.total_pilots) : factions.reduce((acc, f) => acc + (Number(f.unique_pilots) || 0), 0);
  const activeFactions = factions.length;
  const isFiltered = !isMetaEventFiltersDefault(factionEventFilters);

  const sampleSubLine = matchedEvents != null
    ? `<b style="color:#38bdf8;">${formatNumber(matchedEvents)} ${matchedEvents === 1 ? 'event' : 'events'}</b> • ${formatNumber(totalPilots)} pilots`
    : `${formatNumber(totalAppearances)} army entries • ${formatNumber(totalPilots)} pilots`;

  if (activeFactions === 0) {
    strip.innerHTML = `
      <div class="meta-kpi-card" style="grid-column: 1 / -1;">
        <div class="meta-kpi-label">📊 Field Sample (${escapeHtml(factionTimeframe.toUpperCase())}${isFiltered ? ' • FILTERED' : ''})</div>
        <div class="meta-kpi-val meta-kpi-value">0 <span style="font-size:0.78rem; font-weight:600; color:var(--text-secondary);">games matched</span></div>
        <div class="meta-kpi-sub">${sampleSubLine} — Try broadening your player/round/location filters or <a href="javascript:void(0)" onclick="resetMetaEventFilters()" style="color:#38bdf8; font-weight:700;">reset to All Events</a>.</div>
      </div>
    `;
    return;
  }

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

  const bestExMirror = factions.slice().sort((a, b) => (Number(b.non_mirror_win_rate ?? b.win_rate) || 0) - (Number(a.non_mirror_win_rate ?? a.win_rate) || 0))[0] || highestWr;
  const exmName = bestExMirror ? (bestExMirror.faction || '-') : '-';
  const exmWr = bestExMirror ? Number(bestExMirror.non_mirror_win_rate ?? bestExMirror.win_rate ?? 0).toFixed(1) : '0.0';
  const exmGames = bestExMirror ? formatNumber(bestExMirror.non_mirror_matches || bestExMirror.total_matches || 0) : '0';

  const fifthKpiHtml = (evX0 > 0 || evX1 > 0)
    ? `
    <div class="meta-kpi-card clickable" onclick="openFactionModal('${escapeHtml(String(evName).replace(/'/g, "\\'"))}')">
      <div class="meta-kpi-label">🏆 Undefeated Finisher</div>
      <div class="meta-kpi-val meta-kpi-value meta-kpi-faction">${escapeHtml(evName)}</div>
      <div class="meta-kpi-sub"><b style="color:var(--win);">${formatNumber(evX0)} X-0 Runs</b> • ${formatNumber(evX1)} Podiums (${escapeHtml(evOverRep)})</div>
    </div>`
    : `
    <div class="meta-kpi-card clickable" onclick="openFactionModal('${escapeHtml(String(exmName).replace(/'/g, "\\'"))}')">
      <div class="meta-kpi-label">🛡️ Ex-Mirror Leader</div>
      <div class="meta-kpi-val meta-kpi-value meta-kpi-faction">${escapeHtml(exmName)}</div>
      <div class="meta-kpi-sub"><b style="color:var(--win);">${exmWr}% Ex-Mirror</b> • ${exmGames} non-mirror games</div>
    </div>`;

  const vpName = highestMargin ? (highestMargin.faction || '-') : '-';
  const vpMarginNum = highestMargin ? Number(highestMargin.avg_margin || 0) : 0;
  const vpMarginStr = `${vpMarginNum >= 0 ? '+' : ''}${vpMarginNum.toFixed(1)} VP`;
  const vpAvgScore = highestMargin ? Number(highestMargin.avg_score || 0).toFixed(1) : '0.0';

  strip.innerHTML = `
    <div class="meta-kpi-card">
      <div class="meta-kpi-label">📊 Field Sample (${escapeHtml(factionTimeframe.toUpperCase())}${isFiltered ? ' • FILTERED' : ''})</div>
      <div class="meta-kpi-val meta-kpi-value">${formatNumber(totalMatches)} <span style="font-size:0.78rem; font-weight:600; color:var(--text-secondary);">games</span></div>
      <div class="meta-kpi-sub">${sampleSubLine}</div>
    </div>

    <div class="meta-kpi-card">
      <div class="meta-kpi-label">⚖️ Metawatch Health</div>
      <div class="meta-kpi-val meta-kpi-value" style="color:${goldilocksPct >= 55 ? 'var(--win)' : (goldilocksPct >= 40 ? '#fbbf24' : 'var(--loss)')};">
        ${goldilocksPct.toFixed(0)}% <span style="font-size:0.76rem; font-weight:600; color:var(--text-secondary);">Balanced</span>
      </div>
      <div class="meta-kpi-sub">${goldilocksCount} of ${activeFactions} armies in 45%–55% zone</div>
    </div>

    <div class="meta-kpi-card clickable" onclick="openFactionModal('${escapeHtml(String(popName).replace(/'/g, "\\'"))}')">
      <div class="meta-kpi-label">🔥 Most Played Army</div>
      <div class="meta-kpi-val meta-kpi-value meta-kpi-faction">${escapeHtml(popName)}</div>
      <div class="meta-kpi-sub"><b style="color:#38bdf8;">${popShare}% Share</b> • ${popMatches} games (${popWr}% WR)</div>
    </div>

    <div class="meta-kpi-card clickable" onclick="openFactionModal('${escapeHtml(String(hwrName).replace(/'/g, "\\'"))}')">
      <div class="meta-kpi-label">👑 Apex Win Rate</div>
      <div class="meta-kpi-val meta-kpi-value meta-kpi-faction">${escapeHtml(hwrName)}</div>
      <div class="meta-kpi-sub"><b style="color:#a855f7;">${hwrVal}% WR</b> (${hwrNm}% ex-mirror • ${hwrGames}g)</div>
    </div>

    ${fifthKpiHtml}

    <div class="meta-kpi-card clickable" onclick="openFactionModal('${escapeHtml(String(vpName).replace(/'/g, "\\'"))}')">
      <div class="meta-kpi-label">⚡ VP Differential Leader</div>
      <div class="meta-kpi-val meta-kpi-value meta-kpi-faction">${escapeHtml(vpName)}</div>
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
    const isFiltered = !isMetaEventFiltersDefault(factionEventFilters);
    tbody.innerHTML = isFiltered
      ? '<tr><td colspan="9" class="empty-state">No tournaments matched your active scope filters in this timeframe. <button type="button" class="meta-reset-filters-btn" style="margin-left:0.5rem;" onclick="resetMetaEventFilters()">Reset to All Events</button></td></tr>'
      : '<tr><td colspan="9" class="empty-state">No match data available for this timeframe.</td></tr>';
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
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No factions match your active table filters.</td></tr>';
    return;
  }

  filtered.forEach((f, idx) => {
    const tr = document.createElement('tr');
    const safeFacJs = String(f.faction || '').replace(/'/g, "\\'");
    tr.onclick = () => openFactionModal(f.faction);
    tr.onmouseenter = () => {
      if (typeof window.prefetchFactionModalData === 'function') {
        window.prefetchFactionModalData(f.faction);
      }
    };

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

    let x0CellHtml = '';
    if (x0Runs > 0) {
      let overRepBadge = '';
      if (overRep > 0) {
        const repColor = overRep >= 1.25 ? 'var(--win)' : (overRep >= 0.85 ? '#38bdf8' : 'var(--text-muted)');
        overRepBadge = `<span style="font-size:0.72rem; color:${repColor}; font-weight:700;">${overRep.toFixed(2)}x TiWP</span>`;
      } else if (x1Runs > 0) {
        overRepBadge = `<span style="font-size:0.72rem; color:var(--text-secondary);">${formatNumber(x1Runs)} X-1 cuts</span>`;
      }
      x0CellHtml = `
        <div class="meta-x0-wrap" style="display:flex; align-items:center; gap:0.35rem;">
          <span class="badge" style="background:rgba(34,197,94,0.14); color:#4ade80; border:1px solid rgba(34,197,94,0.3); font-size:0.75rem; font-weight:700;">
            🏆 ${formatNumber(x0Runs)} X-0
          </span>
        </div>
        ${overRepBadge ? `<div class="meta-tiwp-wrap" style="margin-top:0.2rem;">${overRepBadge}</div>` : ''}
      `;
    } else if (x1Runs > 0) {
      x0CellHtml = `
        <div class="meta-x0-wrap" style="display:flex; align-items:center; gap:0.35rem;">
          <span class="badge" style="background:rgba(148,163,184,0.1); color:var(--text-secondary); border:1px solid rgba(148,163,184,0.22); font-size:0.73rem; font-weight:600;">
            ${formatNumber(x1Runs)} X-1 cuts
          </span>
        </div>
        ${overRep > 0 ? `<div class="meta-tiwp-wrap" style="margin-top:0.2rem;"><span style="font-size:0.71rem; color:var(--text-muted);">${overRep.toFixed(2)}x podium</span></div>` : ''}
      `;
    } else {
      x0CellHtml = `<span class="meta-tiwp-dash" style="font-size:0.82rem; color:var(--text-muted);" title="No undefeated tournament runs in this timeframe">—</span>`;
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
      <td class="meta-td-rank" style="color:var(--text-muted); font-family:var(--font-mono); font-size:0.84rem;">#${idx + 1}</td>
      <td class="meta-td-faction">
        <div style="display:flex; align-items:center; gap:0.5rem; min-width:0;">
          <span style="width:9px; height:9px; border-radius:50%; background:${facColor}; flex-shrink:0; box-shadow:0 0 6px ${facColor}88;"></span>
          <div style="min-width:0;">
            <div class="player-link meta-fac-name" style="font-weight:700; font-size:0.92rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(f.faction)}</div>
            <div class="meta-fac-pilots" style="font-size:0.72rem; color:var(--text-muted);">
              ${pilots > 0 ? `👤 ${formatNumber(pilots)} commanders` : `${formatNumber(totalMatches)} entries`}
            </div>
          </div>
        </div>
      </td>
      <td class="meta-td-tier">
        <span class="tier-badge tier-${tier}">${tier}</span>
        <div class="meta-tier-short" style="font-size:0.7rem; color:var(--text-secondary); margin-top:0.18rem;">${tierShort}</div>
      </td>
      <td class="meta-td-wr" style="min-width:155px;">
        <div class="meta-wr-top-row" style="display:flex; align-items:baseline; justify-content:space-between; gap:0.35rem;">
          <span class="${wrClass}" style="font-size:0.96rem; font-weight:800; font-family:var(--font-mono);">${activeWr.toFixed(1)}%</span>
          <span class="meta-wr-ci" style="font-size:0.68rem; color:var(--text-muted); font-family:var(--font-mono);">${ciMargin > 0 ? `±${ciMargin.toFixed(1)}%` : ''}</span>
        </div>
        <div class="meta-wr-bar-track" title="Goldilocks Zone: 45% - 55%">
          <div class="meta-wr-goldilocks-band"></div>
          <div class="meta-wr-bar-fill" style="width:${wrBarPct.toFixed(1)}%; background:${wrBarColor};"></div>
        </div>
        <div class="meta-alt-wr" style="font-size:0.69rem; color:var(--text-secondary); margin-top:0.15rem; font-family:var(--font-mono);">${altWrLabel}</div>
      </td>
      <td class="meta-td-share" style="min-width:125px;">
        <div class="meta-share-top-row" style="display:flex; align-items:baseline; justify-content:space-between; gap:0.35rem;">
          <span style="font-family:var(--font-mono); font-weight:700; color:#e2e8f0; font-size:0.88rem;">${metaShare.toFixed(1)}% <span class="meta-share-mobile-lbl" style="display:none; font-size:0.68rem; font-weight:500; color:var(--text-muted);">Share</span></span>
          <span style="font-family:var(--font-mono); font-size:0.73rem; color:var(--text-secondary);">${formatNumber(totalMatches)}g</span>
        </div>
        <div class="meta-share-bar-track">
          <div class="meta-share-bar-fill" style="width:${shareBarPct.toFixed(1)}%;"></div>
        </div>
        <div class="meta-mirrors-lbl" style="font-size:0.68rem; color:var(--text-muted); margin-top:0.12rem;">${mirrors > 0 ? `${formatNumber(mirrors)} mirror games` : '0 mirrors'}</div>
      </td>
      <td class="meta-td-x0" style="font-family:var(--font-mono);">
        ${x0CellHtml}
      </td>
      <td class="meta-td-record" style="font-family:var(--font-mono); font-size:0.84rem; white-space:nowrap;">
        <span style="color:var(--win); font-weight:700;">${formatNumber(f.wins)}W</span> -
        <span style="color:var(--loss); font-weight:700;">${formatNumber(f.losses)}L</span>
        ${f.draws ? ` - <span style="color:var(--draw); font-weight:600;">${formatNumber(f.draws)}D</span>` : ''}
      </td>
      <td class="meta-td-vp" style="font-family:var(--font-mono);">
        <div style="font-weight:700; color:#f8fafc; font-size:0.86rem;">${avgScore > 0 ? `${avgScore.toFixed(1)} VP` : '-'}</div>
        <div style="font-size:0.73rem; font-weight:700; color:${avgMargin > 0.5 ? 'var(--win)' : (avgMargin < -0.5 ? 'var(--loss)' : 'var(--text-secondary)')};">
          ${avgScore > 0 ? `${avgMargin >= 0 ? '+' : ''}${avgMargin.toFixed(1)} diff` : ''}
        </div>
      </td>
      <td class="meta-td-matchups">${matchupHtml}</td>
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

  const total = factions.length;
  container.innerHTML = `
    <div class="meta-dist-pills" style="display:flex; gap:0.75rem; align-items:center; flex-wrap:wrap; font-size:0.8rem;">
      <div><b>Armies:</b> <span style="color:#fff; font-family:var(--font-mono); font-weight:700;">${total}</span></div>
      <div><span class="tier-badge tier-S">S</span> <span class="meta-dist-range">55%+:</span> <b>${tiers.S}</b></div>
      <div><span class="tier-badge tier-A">A</span> <span class="meta-dist-range">50-55%:</span> <b>${tiers.A}</b></div>
      <div><span class="tier-badge tier-B">B</span> <span class="meta-dist-range">45-50%:</span> <b>${tiers.B}</b></div>
      <div><span class="tier-badge tier-C">C</span> <span class="meta-dist-range">&lt;45%:</span> <b>${tiers.C}</b></div>
    </div>
  `;
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
    wrap.innerHTML = '<div class="empty-state" style="padding:2rem;">No head-to-head matchup matrix data available for this scope and timeframe.</div>';
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

if (typeof window !== 'undefined') {
  window.setFactionTimeframe = setFactionTimeframe;
  window.applyCustomFactionDateFilter = applyCustomFactionDateFilter;
  window.setFactionViewMode = setFactionViewMode;
  window.setFactionTierFilter = setFactionTierFilter;
  window.onFactionTableFilterChange = onFactionTableFilterChange;
  window.setMatchupMatrixSize = setMatchupMatrixSize;
  window.renderFactionMeta = renderFactionMeta;
  window.openDatePicker = openDatePicker;
  window.getActiveMetaEventFilters = getActiveMetaEventFilters;
  window.isMetaEventFiltersDefault = isMetaEventFiltersDefault;
  window.getMetaEventFilterCacheKey = getMetaEventFilterCacheKey;
  window.getMetaEventFilterSummaryChips = getMetaEventFilterSummaryChips;
  window.setMetaMinPlayers = setMetaMinPlayers;
  window.onMetaCustomPlayersChange = onMetaCustomPlayersChange;
  window.setMetaMinRounds = setMetaMinRounds;
  window.toggleMetaExcludeLeagues = toggleMetaExcludeLeagues;
  window.setMetaVenueMode = setMetaVenueMode;
  window.setMetaEventStructure = setMetaEventStructure;
  window.setMetaEventFormat = setMetaEventFormat;
  window.onMetaRegionChange = onMetaRegionChange;
  window.onMetaCountryChange = onMetaCountryChange;
  window.onMetaStateChange = onMetaStateChange;
  window.setMetaEloFloor = setMetaEloFloor;
  window.onMetaCustomEloChange = onMetaCustomEloChange;
  window.setMetaEloMode = setMetaEloMode;
  window.toggleMetaMobileFilterDrawer = toggleMetaMobileFilterDrawer;
  window.resetMetaEventFilters = resetMetaEventFilters;
  window.resetFactionState = function() {
    factionMetaData = null;
    if (factionEventFilters.event_format !== 'all') {
      factionEventFilters.event_format = 'all';
    }
    const fmtSel = document.getElementById('meta-format-select');
    const fmtWrap = document.getElementById('meta-format-select-wrap');
    if (fmtSel) fmtSel.innerHTML = '<option value="all">All Formats</option>';
    if (fmtWrap) fmtWrap.style.display = 'none';
    syncMetaScopeFilterControlsUI();
  };
}
