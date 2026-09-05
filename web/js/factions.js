/* ==========================================================================
   FACTIONS.JS - Faction Meta Analytics, Dynamic Timeline & Interactive Army Toggles
   ========================================================================== */

const _initNow = new Date();
const _init90d = new Date(_initNow.getTime() - 90 * 24 * 60 * 60 * 1000);
let factionMetaData = null;
let factionTimeframe = '90d';
let factionCustomStart = _init90d.toISOString().substring(0, 10);
let factionCustomEnd = _initNow.toISOString().substring(0, 10);
let factionViewMode = 'table'; // 'table' or 'chart'
let selectedFactions = new Set();
let allAvailableFactions = [];
let highlightedFaction = null;

const FACTION_PALETTE = [
  '#38bdf8', '#a855f7', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#f97316', '#e2e8f0',
  '#ef4444', '#10b981', '#6366f1', '#eab308', '#d946ef', '#14b8a6', '#84cc16', '#f43f5e',
  '#8b5cf6', '#3b82f6', '#2dd4bf', '#fb923c', '#94a3b8', '#fdba74', '#c084fc', '#4ade80'
];

function getFactionColor(fac) {
  let hash = 0;
  for (let i = 0; i < fac.length; i++) {
    hash = (hash * 31 + fac.charCodeAt(i)) >>> 0;
  }
  return FACTION_PALETTE[hash % FACTION_PALETTE.length];
}

function setFactionTimeframe(preset) {
  factionTimeframe = preset;
  
  ['all', '30d', '60d', '90d', 'ytd', 'custom'].forEach(p => {
    const btn = document.getElementById(`faction-preset-${p}`);
    if (btn) btn.classList.toggle('active', p === preset);
  });

  const customInputs = document.getElementById('faction-custom-date-container');
  if (customInputs) {
    customInputs.style.display = (preset === 'custom') ? 'flex' : 'none';
  }

  const now = new Date();
  if (preset === 'all') {
    factionCustomStart = '';
    factionCustomEnd = '';
  } else if (preset === '30d') {
    const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    factionCustomStart = d.toISOString().substring(0, 10);
    factionCustomEnd = now.toISOString().substring(0, 10);
  } else if (preset === '60d') {
    const d = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    factionCustomStart = d.toISOString().substring(0, 10);
    factionCustomEnd = now.toISOString().substring(0, 10);
  } else if (preset === '90d') {
    const d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    factionCustomStart = d.toISOString().substring(0, 10);
    factionCustomEnd = now.toISOString().substring(0, 10);
  } else if (preset === 'ytd') {
    factionCustomStart = '2026-01-01';
    factionCustomEnd = now.toISOString().substring(0, 10);
  }

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
    loadFactionMeta();
  } else {
    loadFactionMeta();
  }
}

function applyCustomFactionDateFilter() {
  const startInput = document.getElementById('faction-start-date');
  const endInput = document.getElementById('faction-end-date');
  factionCustomStart = startInput ? startInput.value : '';
  factionCustomEnd = endInput ? endInput.value : '';
  loadFactionMeta();
}

function setFactionViewMode(mode) {
  factionViewMode = mode;
  const btnTable = document.getElementById('faction-mode-btn-table');
  const btnChart = document.getElementById('faction-mode-btn-chart');
  const viewTable = document.getElementById('faction-view-table-container');
  const viewChart = document.getElementById('faction-view-chart-container');

  if (btnTable) btnTable.classList.toggle('active', mode === 'table');
  if (btnChart) btnChart.classList.toggle('active', mode === 'chart');
  if (viewTable) viewTable.style.display = (mode === 'table') ? 'block' : 'none';
  if (viewChart) viewChart.style.display = (mode === 'chart') ? 'block' : 'none';

  if (mode === 'chart' && factionMetaData) {
    renderFactionTrendChart(factionMetaData.monthly_trends || []);
  }
}

async function loadFactionMeta() {
  const tbody = document.getElementById('faction-meta-body');
  if (tbody && (!factionMetaData || !factionMetaData.factions || factionMetaData.factions.length === 0)) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Analyzing competitive faction meta...</div></td></tr>';
  }

  try {
    const data = await window.api.getFactionMeta(factionCustomStart, factionCustomEnd, factionTimeframe);
    factionMetaData = data;
    
    // Populate all available factions from trends
    if (data && data.monthly_trends) {
      const counts = {};
      data.monthly_trends.forEach(t => {
        counts[t.faction] = (counts[t.faction] || 0) + Number(t.matches_in_month || 1);
      });
      allAvailableFactions = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      
      // Default to top 8 if not already initialized
      if (selectedFactions.size === 0) {
        allAvailableFactions.slice(0, 8).forEach(f => selectedFactions.add(f));
      }
    }

    renderFactionMetaRows();
    renderFactionDistribution();
    if (factionViewMode === 'chart') {
      renderFactionTrendChart(factionMetaData.monthly_trends || []);
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:var(--loss);">Error loading faction meta: ${err.message}</td></tr>`;
  }
}

function renderFactionMetaRows() {
  const tbody = document.getElementById('faction-meta-body');
  if (!tbody || !factionMetaData || !factionMetaData.factions) return;
  tbody.innerHTML = '';

  const factions = factionMetaData.factions;
  if (factions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No match data available for this timeframe.</td></tr>';
    return;
  }

  factions.forEach((f, idx) => {
    const tr = document.createElement('tr');
    tr.onclick = () => openFactionModal(f.faction);

    const wr = Number(f.win_rate) || 0;
    let wrClass = 'wr-balanced';
    if (wr >= 55) wrClass = 'wr-over';
    else if (wr < 45) wrClass = 'wr-under';

    let tierBadge = `<span class="tier-badge tier-${f.tier}">${f.tier}</span>`;

    tr.innerHTML = `
      <td style="color:var(--text-muted); font-family:var(--font-mono); font-size:0.85rem;">#${idx + 1}</td>
      <td>
        <span class="player-link" style="font-weight:700;">${escapeHtml(f.faction)}</span>
      </td>
      <td>${tierBadge} <span style="font-size:0.75rem; color:var(--text-secondary); margin-left:0.35rem;">${f.tier_label || ''}</span></td>
      <td>
        <span class="${wrClass}" style="font-size:0.95rem; font-weight:700; font-family:var(--font-mono);">${wr.toFixed(1)}%</span>
      </td>
      <td style="font-family:var(--font-mono); color:var(--text-secondary);">
        ${formatNumber(f.total_matches)} matches
      </td>
      <td style="font-family:var(--font-mono); font-size:0.85rem;">
        <span style="color:var(--win); font-weight:600;">${formatNumber(f.wins)}W</span> - 
        <span style="color:var(--loss); font-weight:600;">${formatNumber(f.losses)}L</span>
        ${f.draws ? ` - <span style="color:var(--draw); font-weight:600;">${formatNumber(f.draws)}D</span>` : ''}
      </td>
      <td style="font-family:var(--font-mono); color:var(--text-secondary);">
        ${f.avg_score || '-'} pts
      </td>
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
    <div style="display:flex; gap:1.25rem; align-items:center; flex-wrap:wrap; font-size:0.85rem;">
      <div><b>Total Armies Tracked:</b> <span style="color:#fff; font-family:var(--font-mono); font-weight:700;">${total}</span></div>
      <div><span class="tier-badge tier-S">S</span> Overperforming (55%+): <b>${tiers.S}</b></div>
      <div><span class="tier-badge tier-A">A</span> Balanced High (50-55%): <b>${tiers.A}</b></div>
      <div><span class="tier-badge tier-B">B</span> Balanced Low (45-50%): <b>${tiers.B}</b></div>
      <div><span class="tier-badge tier-C">C</span> Underperforming (<45%): <b>${tiers.C}</b></div>
    </div>
  `;
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
  const chartSub = document.getElementById('faction-chart-subtitle');
  if (chartSub && factionMetaData && factionMetaData.filter) {
    const gran = factionMetaData.filter.granularity || 'Monthly';
    let tfLabel = 'All Time';
    if (factionTimeframe === '30d') tfLabel = 'Last 30 Days';
    else if (factionTimeframe === '60d') tfLabel = 'Last 60 Days';
    else if (factionTimeframe === '90d') tfLabel = 'Last 90 Days';
    else if (factionTimeframe === 'ytd') tfLabel = '2026 YTD';
    else if (factionTimeframe === 'custom') tfLabel = `${factionCustomStart || 'Start'} to ${factionCustomEnd || 'Now'}`;
    chartSub.innerText = `${gran} Win Rate Trajectories (${tfLabel}) vs 45%-55% Goldilocks Balance Band`;
  }

  // Render toggle chips
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

  trends.forEach(t => {
    monthsSet.add(t.month);
    if (!factionMap[t.faction]) factionMap[t.faction] = {};
    factionMap[t.faction][t.month] = Number(t.win_rate);
  });

  const months = Array.from(monthsSet).sort();
  if (months.length === 0) return;

  // Render only selected factions
  const activeFactions = allAvailableFactions.filter(f => selectedFactions.has(f));

  const w = svg.clientWidth || 850;
  const h = 280;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = '';

  const padX = 60;
  const padY = 30;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;

  const minWR = 35;
  const maxWR = 65;
  const range = maxWR - minWR;

  // Goldilocks Balance Band (45% - 55%)
  const y45 = padY + plotH - ((45 - minWR) / range) * plotH;
  const y55 = padY + plotH - ((55 - minWR) / range) * plotH;
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', padX);
  rect.setAttribute('y', y55);
  rect.setAttribute('width', plotW);
  rect.setAttribute('height', y45 - y55);
  rect.setAttribute('fill', 'rgba(34, 197, 94, 0.08)');
  rect.setAttribute('stroke', 'rgba(34, 197, 94, 0.25)');
  rect.setAttribute('stroke-dasharray', '4,4');
  svg.appendChild(rect);

  // 50% Baseline
  const y50 = padY + plotH - ((50 - minWR) / range) * plotH;
  const line50 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line50.setAttribute('x1', padX);
  line50.setAttribute('y1', y50);
  line50.setAttribute('x2', w - padX);
  line50.setAttribute('y2', y50);
  line50.setAttribute('stroke', 'rgba(255,255,255,0.2)');
  svg.appendChild(line50);

  // Axis Labels
  [35, 45, 50, 55, 65].forEach(val => {
    const y = padY + plotH - ((val - minWR) / range) * plotH;
    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', padX - 8);
    txt.setAttribute('y', y + 4);
    txt.setAttribute('fill', val === 50 ? '#fff' : '#64748b');
    txt.setAttribute('font-size', '10');
    txt.setAttribute('font-family', 'monospace');
    txt.setAttribute('text-anchor', 'end');
    txt.textContent = `${val}%`;
    svg.appendChild(txt);
  });

  months.forEach((m, idx) => {
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

  // Render faction trajectory lines
  activeFactions.forEach(fac => {
    const color = getFactionColor(fac);
    const pts = [];

    months.forEach((m, mIdx) => {
      const wr = factionMap[fac] ? factionMap[fac][m] : undefined;
      if (wr !== undefined) {
        const x = padX + (mIdx / (months.length - 1 || 1)) * plotW;
        const clamped = Math.max(minWR, Math.min(maxWR, wr));
        const y = padY + plotH - ((clamped - minWR) / range) * plotH;
        pts.push({ x, y, wr, month: m, faction: fac });
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
      
      if (tooltip) {
        circle.onmouseenter = (e) => {
          setHoverFaction(fac);
          tooltip.style.display = 'block';
          tooltip.style.left = `${pt.x + 10}px`;
          tooltip.style.top = `${pt.y - 30}px`;
          tooltip.innerHTML = `<b style="color:${color};">${escapeHtml(pt.faction)}</b><br><span style="color:#94a3b8;">${pt.month}:</span> <b>${pt.wr.toFixed(1)}% WR</b>`;
        };
        circle.onmouseleave = () => {
          setHoverFaction(null);
          tooltip.style.display = 'none';
        };
      }
      svg.appendChild(circle);
    });
  });

  // Render Legend
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

function openDatePicker(id) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (!el) return;
  try {
    if (typeof el.showPicker === 'function') {
      el.showPicker();
      return;
    }
  } catch (e) {}
  el.focus();
}

if (typeof window !== 'undefined') {
  window.setFactionTimeframe = setFactionTimeframe;
  window.applyCustomFactionDateFilter = applyCustomFactionDateFilter;
  window.setFactionViewMode = setFactionViewMode;
  window.openDatePicker = openDatePicker;
}

