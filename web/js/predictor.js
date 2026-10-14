/* ==========================================================================
   PREDICTOR.JS - 6-Factor Match Prediction, 3-Mo Faction Intel & Commander Dossiers
   ========================================================================== */

let predP1 = null;
let predP2 = null;
let predP1Profile = null;
let predP2Profile = null;
let predP1SelectedFaction = '';
let predP2SelectedFaction = '';
let predFaction3MoSummary = {};
let predH2hMatches = [];
let predLastResponse = null;
let acTimeout = null;

const STANDARD_40K_FACTIONS = [
  'Adepta Sororitas', 'Adeptus Custodes', 'Adeptus Mechanicus', 'Aeldari',
  'Agents of the Imperium', 'Astra Militarum', 'Black Templars', 'Blood Angels',
  'Chaos Daemons', 'Chaos Knights', 'Chaos Space Marines', 'Dark Angels',
  'Death Guard', 'Deathwatch', 'Drukhari', "Emperor's Children",
  'Genestealer Cults', 'Grey Knights', 'Imperial Knights', 'Leagues of Votann',
  'Necrons', 'Orks', 'Space Marines (Astartes)', 'Space Wolves',
  "T'au Empire", 'Thousand Sons', 'Tyranids', 'World Eaters'
];

const STANDARD_AOS_FACTIONS = [
  'Blades of Khorne', 'Cities of Sigmar', 'Daughters of Khaine', 'Disciples of Tzeentch',
  'Flesh-eater Courts', 'Fyreslayers', 'Gloomspite Gitz', 'Hedonites of Slaanesh',
  'Helsmiths of Hashut', 'Idoneth Deepkin', 'Ironjawz', 'Kharadron Overlords',
  'Kruleboyz', 'Lumineth Realm-lords', 'Maggotkin of Nurgle', 'Nighthaunt',
  'Ogor Mawtribes', 'Ossiarch Bonereapers', 'Seraphon', 'Skaven',
  'Slaves to Darkness', 'Sons of Behemat', 'Soulblight Gravelords',
  'Stormcast Eternals', 'Sylvaneth'
];

function _normPredFacKey(raw) {
  if (typeof window.normalizeCasterFactionKey === 'function') {
    return window.normalizeCasterFactionKey(raw);
  }
  return String(raw || '').trim().toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function _isSamePredFac(fA, fB) {
  if (typeof window.isSameCasterFaction === 'function') {
    return window.isSameCasterFaction(fA, fB);
  }
  const kA = _normPredFacKey(fA);
  const kB = _normPredFacKey(fB);
  return Boolean(kA && kB && kA === kB);
}

function _extractPlayerFactionsList(pObj) {
  if (!pObj) return [];
  const mastery = Array.isArray(pObj.faction_mastery) ? pObj.faction_mastery : [];
  const seen = new Set();
  const list = [];

  mastery.forEach(m => {
    const f = String(m.faction || '').trim();
    const nk = _normPredFacKey(f);
    if (!f || !nk || seen.has(nk)) return;
    seen.add(nk);
    list.push({
      faction: f,
      games: Number(m.games || m.matches || 0),
      wins: Number(m.wins || 0),
      losses: Number(m.losses || 0),
      draws: Number(m.draws || 0),
      win_rate: Number(m.win_rate || 0),
      net_elo: Number(m.net_elo || 0)
    });
  });

  const rawTop = String(pObj.top_faction || pObj.primary_faction || pObj.faction || '').trim();
  if (rawTop) {
    rawTop.split(',').map(s => s.trim()).filter(Boolean).forEach(f => {
      if (f.toLowerCase() === 'various' || f.toLowerCase() === 'unknown') return;
      const nk = _normPredFacKey(f);
      if (!nk || seen.has(nk)) return;
      seen.add(nk);
      list.push({
        faction: f,
        games: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        win_rate: 0,
        net_elo: 0
      });
    });
  }
  return list;
}

function searchPlayerAc(colNum) {
  clearTimeout(acTimeout);
  const input = document.getElementById(`p${colNum}-name-input`);
  const query = input ? input.value.trim() : '';
  const dropdown = document.getElementById(`p${colNum}-ac-dropdown`);

  if (!query || query.length < 2) {
    if (dropdown) dropdown.style.display = 'none';
    return;
  }

  acTimeout = setTimeout(async () => {
    try {
      const results = await window.api.searchPlayers(query, 8);
      if (!dropdown) return;
      dropdown.innerHTML = '';
      if (!results || results.length === 0) {
        dropdown.style.display = 'none';
        return;
      }

      results.forEach(p => {
        const item = document.createElement('div');
        item.className = 'ac-item';
        item.onclick = () => selectPredictPlayer(colNum, p);
        item.innerHTML = `
          <div>
            <div style="font-weight:600; color:#fff;">${escapeHtml(p.player_name || p.full_name)}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(p.top_faction || 'Various')}</div>
          </div>
          <div class="elo-badge ${getEloBadgeClass(p.current_elo)}" style="font-size:0.85rem;">
            ${Number(p.current_elo).toFixed(1)}
          </div>
        `;
        dropdown.appendChild(item);
      });
      dropdown.style.display = 'block';
    } catch (err) {
      if (dropdown) dropdown.style.display = 'none';
    }
  }, 200);
}

function selectPredictPlayer(colNum, p) {
  const dropdown = document.getElementById(`p${colNum}-ac-dropdown`);
  if (dropdown) dropdown.style.display = 'none';
  const input = document.getElementById(`p${colNum}-name-input`);
  if (input) input.value = p.player_name || p.full_name;

  const facList = _extractPlayerFactionsList(p);
  const defaultFac = (p.primary_faction && p.primary_faction !== 'Unknown')
    ? p.primary_faction
    : (facList.length > 0 ? facList[0].faction : 'Unknown');

  if (colNum === 1) {
    predP1 = p;
    predP1Profile = p;
    predP1SelectedFaction = defaultFac;
  } else {
    predP2 = p;
    predP2Profile = p;
    predP2SelectedFaction = defaultFac;
  }

  updatePredictCard(colNum, p);
  if (predP1 && predP2) runPrediction();
}

function onPredictorFactionChange(colNum, newFaction) {
  const cleanFac = String(newFaction || '').trim();
  if (!cleanFac) return;
  if (colNum === 1) {
    predP1SelectedFaction = cleanFac;
    updatePredictCard(1, predP1Profile || predP1);
  } else {
    predP2SelectedFaction = cleanFac;
    updatePredictCard(2, predP2Profile || predP2);
  }
  if (predP1 && predP2) {
    recomputeAndRenderPredictorMatchup();
  }
}
window.onPredictorFactionChange = onPredictorFactionChange;

function updatePredictCard(colNum, p) {
  if (!p) return;
  const pName = p.player_name || p.full_name || `Player ${colNum}`;
  const pId = String(p.player_id || p.id || '').trim();
  const safePid = pId.replace(/'/g, "\\'");
  const safeName = String(pName).replace(/'/g, "\\'");
  const accentColor = colNum === 1 ? '#38bdf8' : '#f43f5e';
  const activeFac = (colNum === 1 ? predP1SelectedFaction : predP2SelectedFaction) || p.primary_faction || 'Unknown';

  const nameEl = document.getElementById(`p${colNum}-card-name`);
  if (nameEl) {
    if (pId || (pName && pName !== 'Player 1' && pName !== 'Player 2')) {
      nameEl.innerHTML = `<span class="player-link" onclick="openPlayerModal('${escapeHtml(safePid)}', '${escapeHtml(safeName)}')" style="cursor:pointer; color:#fff; text-decoration:underline; text-decoration-color:${accentColor}; text-underline-offset:3px;" title="View ${escapeHtml(pName)} Quick Profile">${escapeHtml(pName)}</span>`;
    } else {
      nameEl.innerText = pName;
    }
  }

  const quickBtn = document.getElementById(`p${colNum}-quick-profile-btn`);
  if (quickBtn) {
    if (pId || (pName && pName !== 'Player 1' && pName !== 'Player 2')) {
      quickBtn.style.display = 'inline-flex';
      quickBtn.onclick = () => {
        if (typeof openPlayerModal === 'function') openPlayerModal(pId, pName);
      };
    } else {
      quickBtn.style.display = 'none';
    }
  }

  const teamEl = document.getElementById(`p${colNum}-card-team`);
  if (teamEl) {
    if (p.team) {
      teamEl.innerText = `👥 ${p.team}`;
      teamEl.style.display = 'inline-block';
    } else {
      teamEl.innerText = '';
      teamEl.style.display = 'none';
    }
  }

  const facEl = document.getElementById(`p${colNum}-card-faction`);
  if (facEl) {
    facEl.innerText = p.top_faction || activeFac || 'Various';
    facEl.style.display = 'inline-block';
  }

  const eloEl = document.getElementById(`p${colNum}-card-elo`);
  if (eloEl) eloEl.innerText = Number(p.current_elo || 1500).toFixed(1);
  const recEl = document.getElementById(`p${colNum}-card-record`);
  if (recEl) recEl.innerText = `${p.wins || 0}W - ${p.losses || 0}L${p.draws ? ` - ${p.draws}D` : ''}`;
  const wr = p.win_rate !== undefined ? p.win_rate : (p.matches_played > 0 ? ((p.wins / p.matches_played) * 100).toFixed(1) : 0);
  const wrEl = document.getElementById(`p${colNum}-card-winrate`);
  if (wrEl) wrEl.innerText = `${wr}%`;
  const peakEl = document.getElementById(`p${colNum}-card-peak`);
  if (peakEl) peakEl.innerText = Number(p.peak_elo || p.current_elo || 1500).toFixed(1);

  // Populate Interactive Faction Selector & Career Faction Chips
  const selRow = document.getElementById(`p${colNum}-faction-selector-row`);
  const selEl = document.getElementById(`p${colNum}-faction-select`);
  const chipsEl = document.getElementById(`p${colNum}-faction-chips`);
  const careerFacs = _extractPlayerFactionsList(p);

  if (selRow && selEl) {
    selRow.style.display = 'block';
    const sys = (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k');
    const catalogFacs = sys === 'aos' ? STANDARD_AOS_FACTIONS : (sys === '40k' ? STANDARD_40K_FACTIONS : []);
    const summaryFacs = Object.keys(predFaction3MoSummary || {});
    const allKnownSet = new Map();
    [...catalogFacs, ...summaryFacs].forEach(fn => {
      const k = _normPredFacKey(fn);
      if (k && !allKnownSet.has(k)) allKnownSet.set(k, fn);
    });

    const careerKeys = new Set(careerFacs.map(cf => _normPredFacKey(cf.faction)));
    const otherFacs = Array.from(allKnownSet.entries())
      .filter(([k]) => !careerKeys.has(k))
      .map(([, fn]) => fn)
      .sort((a, b) => a.localeCompare(b));

    let optHtml = '';
    if (careerFacs.length > 0) {
      optHtml += `<optgroup label="Player's Career Factions">`;
      careerFacs.forEach(cf => {
        const isSel = _isSamePredFac(cf.faction, activeFac);
        const statsSuffix = cf.games > 0 ? ` (${cf.games}G • ${cf.win_rate.toFixed(0)}% WR)` : '';
        optHtml += `<option value="${escapeHtml(cf.faction)}" ${isSel ? 'selected' : ''}>${escapeHtml(cf.faction)}${statsSuffix}</option>`;
      });
      optHtml += `</optgroup>`;
    }
    if (otherFacs.length > 0) {
      const sysLabel = (typeof getGameSystemLabel === 'function') ? getGameSystemLabel(sys) : (sys === 'aos' ? 'Age of Sigmar' : 'Warhammer 40k');
      optHtml += `<optgroup label="All ${escapeHtml(sysLabel)} Factions">`;
      otherFacs.forEach(fn => {
        const isSel = _isSamePredFac(fn, activeFac);
        optHtml += `<option value="${escapeHtml(fn)}" ${isSel ? 'selected' : ''}>${escapeHtml(fn)}</option>`;
      });
      optHtml += `</optgroup>`;
    }
    selEl.innerHTML = optHtml;
  }

  if (chipsEl) {
    if (careerFacs.length > 0) {
      chipsEl.innerHTML = careerFacs.slice(0, 6).map(cf => {
        const isSel = _isSamePredFac(cf.faction, activeFac);
        const safeFac = String(cf.faction).replace(/'/g, "\\'");
        const bg = isSel
          ? (colNum === 1 ? 'rgba(56, 189, 248, 0.22)' : 'rgba(244, 63, 94, 0.22)')
          : 'rgba(255, 255, 255, 0.04)';
        const border = isSel
          ? (colNum === 1 ? 'rgba(56, 189, 248, 0.6)' : 'rgba(244, 63, 94, 0.6)')
          : 'rgba(255, 255, 255, 0.1)';
        const col = isSel ? '#fff' : 'var(--text-secondary)';
        const subTxt = cf.games > 0 ? ` <span style="opacity:0.8; font-family:var(--font-mono); font-size:0.66rem;">${cf.games}G (${cf.win_rate.toFixed(0)}%)</span>` : '';
        return `
          <button type="button" onclick="onPredictorFactionChange(${colNum}, '${escapeHtml(safeFac)}')" style="background:${bg}; border:1px solid ${border}; color:${col}; border-radius:6px; padding:2px 8px; font-size:0.71rem; font-weight:${isSel ? '800' : '600'}; cursor:pointer; transition:all 0.15s ease;">
            🛡️ ${escapeHtml(cf.faction)}${subTxt}
          </button>
        `;
      }).join('');
    } else {
      chipsEl.innerHTML = '';
    }
  }
}

function _lookup3MoFacEntry(facName) {
  const nk = _normPredFacKey(facName);
  if (!nk) return null;
  const entries = Object.values(predFaction3MoSummary || {});
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e && _normPredFacKey(e.faction) === nk) return e;
  }
  const sys = (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k');
  if (window.casterFaction3MoCache) {
    const cached = window.casterFaction3MoCache[`${sys}:${String(facName || '').trim().toLowerCase()}`];
    if (cached && cached.stats) return cached;
  }
  return null;
}

function _computePredictor3MoMetrics(fac1, fac2) {
  const f1Clean = String(fac1 || 'Army').trim();
  const f2Clean = String(fac2 || 'Army').trim();
  const isMirror = _isSamePredFac(f1Clean, f2Clean);
  const f1Data = _lookup3MoFacEntry(f1Clean);
  const f2Data = _lookup3MoFacEntry(f2Clean);

  const f1Stats = f1Data?.stats || {};
  const f2Stats = f2Data?.stats || {};
  const f1GlobalGames = Number(f1Stats.total_matches || 0);
  const f1GlobalWins = Number(f1Stats.total_wins || 0);
  const f1GlobalLosses = Number(f1Stats.total_losses || 0);
  const f1GlobalWr = Number(f1Stats.win_rate || 0);

  const f2GlobalGames = Number(f2Stats.total_matches || 0);
  const f2GlobalWins = Number(f2Stats.total_wins || 0);
  const f2GlobalLosses = Number(f2Stats.total_losses || 0);
  const f2GlobalWr = Number(f2Stats.win_rate || 0);

  let h2hF1Wins = 0;
  let h2hF2Wins = 0;
  let h2hDraws = 0;
  if (!isMirror) {
    const f1Matchups = Array.isArray(f1Data?.matchups) ? f1Data.matchups : [];
    const directMatches1 = f1Matchups.filter(m => _isSamePredFac(m.opponent_faction || m.opponent, f2Clean));
    if (directMatches1.length > 0) {
      directMatches1.forEach(dm => {
        h2hF1Wins += Number(dm.wins || 0);
        h2hF2Wins += Number(dm.losses || 0);
        h2hDraws += Number(dm.draws || 0);
      });
    } else {
      const f2Matchups = Array.isArray(f2Data?.matchups) ? f2Data.matchups : [];
      const directMatches2 = f2Matchups.filter(m => _isSamePredFac(m.opponent_faction || m.opponent, f1Clean));
      directMatches2.forEach(dm => {
        h2hF2Wins += Number(dm.wins || 0);
        h2hF1Wins += Number(dm.losses || 0);
        h2hDraws += Number(dm.draws || 0);
      });
    }
  }
  const h2hTotal = h2hF1Wins + h2hF2Wins + h2hDraws;
  return {
    fac1: f1Clean,
    fac2: f2Clean,
    isMirror,
    hasLoadedF1: Boolean(f1Data),
    hasLoadedF2: Boolean(f2Data),
    f1GlobalGames,
    f1GlobalWins,
    f1GlobalLosses,
    f1GlobalWr,
    f2GlobalGames,
    f2GlobalWins,
    f2GlobalLosses,
    f2GlobalWr,
    h2hF1Wins,
    h2hF2Wins,
    h2hDraws,
    h2hTotal,
    evF1Wins: 0,
    evF2Wins: 0,
    evDraws: 0,
    evTotal: 0
  };
}

function _extractPlayerMasteryVsOpponent(prof, ownFac, oppFac) {
  const fmList = Array.isArray(prof?.faction_mastery) ? prof.faction_mastery : [];
  const mmList = Array.isArray(prof?.matchup_matrix) ? prof.matchup_matrix : [];

  let ownWins = 0, ownLosses = 0, ownDraws = 0, ownNetElo = 0;
  fmList.forEach(m => {
    if (_isSamePredFac(m.faction, ownFac)) {
      ownWins += Number(m.wins || 0);
      ownLosses += Number(m.losses || 0);
      ownDraws += Number(m.draws || 0);
      ownNetElo += Number(m.net_elo || 0);
    }
  });
  const ownGames = ownWins + ownLosses + ownDraws;
  const ownWr = ownGames > 0 ? (ownWins * 100.0) / ownGames : 50.0;

  let vsWins = 0, vsLosses = 0, vsDraws = 0, vsNetElo = 0;
  mmList.forEach(m => {
    if (_isSamePredFac(m.enemy_faction || m.opponent_faction || m.faction, oppFac)) {
      vsWins += Number(m.wins || 0);
      vsLosses += Number(m.losses || 0);
      vsDraws += Number(m.draws || 0);
      vsNetElo += Number(m.net_elo || 0);
    }
  });
  const vsGames = vsWins + vsLosses + vsDraws;
  const vsWr = vsGames > 0 ? (vsWins * 100.0) / vsGames : 50.0;

  return {
    curFac: ownFac,
    oppFac,
    ownWins,
    ownLosses,
    ownDraws,
    ownGames,
    ownNetElo,
    ownWr,
    vsWins,
    vsLosses,
    vsDraws,
    vsGames,
    vsNetElo,
    vsWr
  };
}

function _computePredictorH2hSummary(h2hList, p1Prof, p2Prof) {
  const p1Id = String(p1Prof?.player_id || predP1?.player_id || '').trim().toLowerCase();
  const p2Id = String(p2Prof?.player_id || predP2?.player_id || '').trim().toLowerCase();
  const p1Name = String(p1Prof?.player_name || predP1?.player_name || 'Player 1').trim();
  const p2Name = String(p2Prof?.player_name || predP2?.player_name || 'Player 2').trim();
  const p1NameL = p1Name.toLowerCase();

  let p1Wins = 0, p2Wins = 0, draws = 0;
  (h2hList || []).forEach(m => {
    if (!m || m.is_bye) return;
    if (m.is_draw) {
      draws++;
      return;
    }
    const wId = String(m.winner_id || '').trim().toLowerCase();
    const m1Id = String(m.player1_id || '').trim().toLowerCase();
    const m1Name = String(m.player1_name || '').trim().toLowerCase();
    const isP1Side1 = (p1Id && m1Id === p1Id) || (p1NameL && m1Name === p1NameL);
    if (wId) {
      if (p1Id && wId === p1Id) p1Wins++;
      else if (p2Id && wId === p2Id) p2Wins++;
    } else if (m.player1_score != null && m.player2_score != null) {
      const s1 = Number(m.player1_score);
      const s2 = Number(m.player2_score);
      if (s1 > s2) {
        if (isP1Side1) p1Wins++;
        else p2Wins++;
      } else if (s2 > s1) {
        if (isP1Side1) p2Wins++;
        else p1Wins++;
      }
    }
  });
  const total = p1Wins + p2Wins + draws;
  let summaryText = 'First Career Meeting (0 Prior Games)';
  if (total > 0) {
    if (p1Wins > p2Wins) {
      summaryText = `${escapeHtml(p1Name)} leads ${p1Wins}W - ${p2Wins}L${draws > 0 ? ` - ${draws}D` : ''} (${total} Career ${total === 1 ? 'Game' : 'Games'})`;
    } else if (p2Wins > p1Wins) {
      summaryText = `${escapeHtml(p2Name)} leads ${p2Wins}W - ${p1Wins}L${draws > 0 ? ` - ${draws}D` : ''} (${total} Career ${total === 1 ? 'Game' : 'Games'})`;
    } else {
      summaryText = `Series Tied ${p1Wins}W - ${p2Wins}L${draws > 0 ? ` - ${draws}D` : ''} (${total} Career ${total === 1 ? 'Game' : 'Games'})`;
    }
  }
  return { p1Wins, p2Wins, draws, total, summaryText };
}

function buildPredictorFaction3MoCardHtml(facMetrics) {
  const m = facMetrics;
  const fac1 = m.fac1 || 'Faction 1';
  const fac2 = m.fac2 || 'Faction 2';
  const isMirror = Boolean(m.isMirror);
  const activeTotal = m.h2hTotal;
  const activeF1W = m.h2hF1Wins;
  const activeF2W = m.h2hF2Wins;
  const activeD = m.h2hDraws;

  const f1Wr = activeTotal > 0 ? (activeF1W * 100.0) / activeTotal : 50.0;
  const f2Wr = activeTotal > 0 ? (activeF2W * 100.0) / activeTotal : 50.0;
  const dPct = activeTotal > 0 ? (activeD * 100.0) / activeTotal : 0.0;
  const f1WrStr = f1Wr.toFixed(1);
  const f2WrStr = f2Wr.toFixed(1);

  let headerBadgeText = '90-Day Rolling Meta';
  let headerBadgeStyle = 'background: rgba(56, 189, 248, 0.14); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35);';
  if (isMirror) {
    headerBadgeText = 'Mirror Matchup (50/50 Faction Parity)';
    headerBadgeStyle = 'background: rgba(168, 85, 247, 0.16); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.35);';
  } else if (activeTotal > 0) {
    const fav = f1Wr >= f2Wr ? fac1 : fac2;
    const favWr = Math.max(f1Wr, f2Wr).toFixed(1);
    headerBadgeText = `${fav} Favored (${favWr}% in ${activeTotal}G)`;
  }

  const metaGap = m.f1GlobalWr - m.f2GlobalWr;
  const metaGapStr = `${metaGap >= 0 ? '+' : ''}${metaGap.toFixed(1)}%`;

  return `
    <div class="caster-table-section-card" style="background: rgba(15, 23, 42, 0.78); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 1.05rem 1.2rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap;">
        <div>
          <h4 style="margin: 0; font-size: 0.95rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.4rem;">
            <span>⚔️ Global Faction Matchup (Past 3 Months): ${escapeHtml(fac1)} vs ${escapeHtml(fac2)}</span>
          </h4>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px;">
            How well <strong>${escapeHtml(fac1)}</strong> and <strong>${escapeHtml(fac2)}</strong> perform against each other and in the global tournament meta over the last 90 days.
          </div>
        </div>
        <span class="badge" style="${headerBadgeStyle} font-size: 0.72rem; font-weight: 700; padding: 3px 9px;">
          ${escapeHtml(headerBadgeText)}
        </span>
      </div>

      ${(!isMirror && activeTotal > 0) ? `
        <div style="background: rgba(9, 14, 26, 0.78); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 0.75rem 0.9rem; margin-bottom: 0.7rem;">
          <div class="caster-factions-tug-grid" style="display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
            <div class="caster-factions-tug-f1" style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
              <div style="font-size: 0.8rem; font-weight: 800; color: #38bdf8; overflow-wrap: break-word;">
                🛡️ ${escapeHtml(fac1)}
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 900; color: #fff;">
                ${f1WrStr}% <span style="font-size: 0.72rem; font-weight: 600; color: var(--text-secondary);">(${activeF1W}W-${activeF2W}L${activeD > 0 ? `-${activeD}D` : ''})</span>
              </div>
            </div>

            <div class="caster-factions-tug-sample" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 0.22rem 0.55rem; font-family: var(--font-mono); font-size: 0.7rem; font-weight: 800; color: #cbd5e1; text-align: center; white-space: nowrap;">
              ${activeTotal} ${activeTotal === 1 ? 'Game' : 'Games'} (Past 3 Mo)
            </div>

            <div class="caster-factions-tug-f2" style="display: flex; flex-direction: column; align-items: flex-end; text-align: right; gap: 2px; min-width: 0;">
              <div style="font-size: 0.8rem; font-weight: 800; color: #f43f5e; overflow-wrap: break-word;">
                🛡️ ${escapeHtml(fac2)}
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 900; color: #fff;">
                ${f2WrStr}% <span style="font-size: 0.72rem; font-weight: 600; color: var(--text-secondary);">(${activeF2W}W-${activeF1W}L${activeD > 0 ? `-${activeD}D` : ''})</span>
              </div>
            </div>
          </div>

          <div style="width: 100%; height: 8px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden; display: flex;">
            <div style="width: ${f1Wr}%; height: 100%; background: linear-gradient(90deg, #0284c7, #38bdf8);"></div>
            ${dPct > 0 ? `<div style="width: ${dPct}%; height: 100%; background: #64748b;"></div>` : ''}
            <div style="width: ${f2Wr}%; height: 100%; background: linear-gradient(90deg, #f43f5e, #e11d48);"></div>
          </div>
        </div>
      ` : (!isMirror ? `
        <div style="background: rgba(9, 14, 26, 0.55); border: 1px dashed rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 0.65rem 0.85rem; text-align: center; color: var(--text-muted); font-size: 0.77rem; margin-bottom: 0.7rem;">
          📊 No direct global tournament games recorded between <strong>${escapeHtml(fac1)}</strong> and <strong>${escapeHtml(fac2)}</strong> in the past 3 months — see each faction's 90-day overall meta standing below.
        </div>
      ` : '')}

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: 0.55rem;">
        <div style="background: rgba(9, 14, 26, 0.65); border: 1px solid rgba(56, 189, 248, 0.22); border-radius: 8px; padding: 0.55rem 0.7rem;">
          <div style="font-size: 0.65rem; font-weight: 800; text-transform: uppercase; color: #38bdf8; letter-spacing: 0.03em;">
            🛡️ ${escapeHtml(fac1)} • 3-Mo Meta Form
          </div>
          <div style="font-family: var(--font-mono); font-size: 0.82rem; font-weight: 800; color: #fff; margin-top: 2px;">
            ${m.f1GlobalGames > 0
              ? `<span style="color: ${m.f1GlobalWr >= 52 ? '#4ade80' : (m.f1GlobalWr <= 45 ? '#f87171' : '#fbbf24')};">${m.f1GlobalWr.toFixed(1)}% WR</span> <span style="font-size: 0.72rem; color: var(--text-secondary);">(${m.f1GlobalWins}W-${m.f1GlobalLosses}L • ${m.f1GlobalGames}G)</span>`
              : '<span style="color:var(--text-muted);">No 90d global games</span>'}
          </div>
        </div>

        <div style="background: rgba(9, 14, 26, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 0.55rem 0.7rem;">
          <div style="font-size: 0.65rem; font-weight: 800; text-transform: uppercase; color: #c084fc; letter-spacing: 0.03em;">
            ⚖️ 90-Day Meta Win Rate Delta
          </div>
          <div style="font-family: var(--font-mono); font-size: 0.82rem; font-weight: 800; color: #fff; margin-top: 2px;">
            ${isMirror
              ? 'Mirror Matchup (0.0% Delta)'
              : ((m.f1GlobalGames > 0 && m.f2GlobalGames > 0)
                ? `<span style="color:${metaGap >= 0 ? '#38bdf8' : '#f43f5e'};">${metaGapStr}</span> <span style="font-size:0.71rem; color:var(--text-secondary);">(${escapeHtml(metaGap >= 0 ? fac1 : fac2)} Meta Edge)</span>`
                : '<span style="color:var(--text-muted);">Neutral Meta Standing</span>')}
          </div>
        </div>

        <div style="background: rgba(9, 14, 26, 0.65); border: 1px solid rgba(244, 63, 94, 0.22); border-radius: 8px; padding: 0.55rem 0.7rem;">
          <div style="font-size: 0.65rem; font-weight: 800; text-transform: uppercase; color: #f43f5e; letter-spacing: 0.03em;">
            🛡️ ${escapeHtml(fac2)} • 3-Mo Meta Form
          </div>
          <div style="font-family: var(--font-mono); font-size: 0.82rem; font-weight: 800; color: #fff; margin-top: 2px;">
            ${m.f2GlobalGames > 0
              ? `<span style="color: ${m.f2GlobalWr >= 52 ? '#4ade80' : (m.f2GlobalWr <= 45 ? '#f87171' : '#fbbf24')};">${m.f2GlobalWr.toFixed(1)}% WR</span> <span style="font-size: 0.72rem; color: var(--text-secondary);">(${m.f2GlobalWins}W-${m.f2GlobalLosses}L • ${m.f2GlobalGames}G)</span>`
              : '<span style="color:var(--text-muted);">No 90d global games</span>'}
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildPredictorSingleDossierCardHtml(colNum, prof, oppProf, ownFac, oppFac, masteryStats, gainOnWin) {
  const accentColor = colNum === 1 ? '#38bdf8' : '#f43f5e';
  const borderAccent = colNum === 1 ? 'rgba(56, 189, 248, 0.35)' : 'rgba(244, 63, 94, 0.35)';
  const pid = String(prof?.player_id || '').trim();
  const pname = String(prof?.player_name || `Player ${colNum}`).trim();
  const safePid = pid.replace(/'/g, "\\'");
  const safeName = pname.replace(/'/g, "\\'");

  const careerElo = Number(prof?.current_elo || 1500);
  const peakElo = Math.max(careerElo, Number(prof?.peak_elo || careerElo));
  const careerWins = Number(prof?.wins || 0);
  const careerLosses = Number(prof?.losses || 0);
  const careerDraws = Number(prof?.draws || 0);
  const careerTotal = Math.max(1, careerWins + careerLosses + careerDraws);
  const careerWr = ((careerWins / careerTotal) * 100).toFixed(1);
  const maxStreak = Number(prof?.longest_win_streak || 0);

  const ownGames = masteryStats.ownGames;
  const ownWins = masteryStats.ownWins;
  const ownLosses = masteryStats.ownLosses;
  const ownDraws = masteryStats.ownDraws;
  const ownNetElo = masteryStats.ownNetElo;
  const ownWrNum = ownGames > 0 ? masteryStats.ownWr : 0;
  const ownWrStr = ownWrNum.toFixed(1);
  const ownNetStr = (ownNetElo >= 0 ? '+' : '') + ownNetElo.toFixed(1);
  const ownBarCol = ownWrNum >= 55 ? '#10b981' : (ownWrNum >= 48 ? accentColor : '#f43f5e');

  const vsGames = masteryStats.vsGames;
  const vsWins = masteryStats.vsWins;
  const vsLosses = masteryStats.vsLosses;
  const vsDraws = masteryStats.vsDraws;
  const vsNetElo = masteryStats.vsNetElo;
  const vsWrNum = vsGames > 0 ? masteryStats.vsWr : 0;
  const vsWrStr = vsWrNum.toFixed(1);
  const vsNetStr = (vsNetElo >= 0 ? '+' : '') + vsNetElo.toFixed(1);
  const vsBarCol = vsGames === 0 ? 'rgba(148,163,184,0.35)' : (vsWrNum >= 55 ? '#10b981' : (vsWrNum >= 48 ? '#fbbf24' : '#f43f5e'));

  const getMasteryTierBadge = (games, wr) => {
    if (games >= 20 && wr >= 60) return { label: '👑 Grandmaster', bg: 'rgba(245, 158, 11, 0.18)', col: '#fbbf24', border: 'rgba(245, 158, 11, 0.45)' };
    if (games >= 10 && wr >= 55) return { label: '🔥 Master', bg: 'rgba(168, 85, 247, 0.18)', col: '#c084fc', border: 'rgba(168, 85, 247, 0.45)' };
    if (games >= 5) return { label: '⚔️ Veteran Specialist', bg: 'rgba(56, 189, 248, 0.15)', col: '#38bdf8', border: 'rgba(56, 189, 248, 0.35)' };
    return { label: '🛡️ Faction Adept', bg: 'rgba(148, 163, 184, 0.15)', col: '#cbd5e1', border: 'rgba(148, 163, 184, 0.3)' };
  };
  const tierBadge = getMasteryTierBadge(ownGames, ownWrNum);

  const recentMatches = Array.isArray(prof?.recent_matches) ? prof.recent_matches : [];
  const recentRowsHtml = recentMatches.slice(0, 6).map(m => {
    const resC = String(m.result || 'D').toUpperCase();
    const mySc = m.player_score != null ? m.player_score : '-';
    const opSc = m.opponent_score != null ? m.opponent_score : '-';
    const hasScores = m.player_score != null && m.opponent_score != null;
    const scoreTxt = hasScores ? ` ${mySc}-${opSc}` : '';
    const pillClass = resC === 'W' ? 'badge-win' : (resC === 'L' ? 'badge-loss' : 'badge-draw');
    const opName = String(m.opponent_name || 'Opponent');
    const opPid = String(m.opponent_id || '');
    const safeOpName = opName.replace(/'/g, "\\'");
    const safeOpPid = opPid.replace(/'/g, "\\'");
    const evId = String(m.event_id || '').trim();
    const safeEvId = evId.replace(/'/g, "\\'");
    const evName = String(m.event_name || 'Tournament');
    const deltaVal = Number(m.delta_elo || 0);
    const deltaStr = `${deltaVal >= 0 ? '+' : ''}${deltaVal.toFixed(1)}`;
    const deltaCol = deltaVal >= 0 ? '#4ade80' : '#f87171';

    return `
      <div class="caster-path-row" style="display: flex; align-items: center; justify-content: space-between; gap: 0.45rem; padding: 0.42rem 0.55rem; background: rgba(0,0,0,0.24); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; font-size: 0.74rem;">
        <div style="display: flex; align-items: center; gap: 0.4rem; min-width: 0; flex: 1;">
          <span class="badge ${pillClass}" style="font-size: 0.65rem; white-space: nowrap; flex-shrink: 0;">${resC}${scoreTxt}</span>
          <div style="min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px;">
            <div style="display: flex; align-items: center; gap: 0.3rem; min-width: 0; flex-wrap: wrap;">
              <span style="color: var(--text-muted); font-size: 0.67rem;">vs</span>
              <span class="player-link" onclick="openPlayerModal('${escapeHtml(safeOpPid)}', '${escapeHtml(safeOpName)}')" style="font-weight: 700; color: #e2e8f0; cursor: pointer; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(opName)}</span>
              ${m.opponent_faction ? `<span style="color: var(--text-muted); font-size: 0.66rem;">(${escapeHtml(m.opponent_faction)})</span>` : ''}
            </div>
            <div style="color: var(--text-muted); font-size: 0.65rem; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
              ${evId ? `<span class="player-link" onclick="if(typeof openEventModal==='function') openEventModal('${escapeHtml(safeEvId)}', false)" style="cursor:pointer; color:var(--text-secondary);">${escapeHtml(evName)}</span>` : escapeHtml(evName)}
              • R${m.round || 1} • ${escapeHtml(m.match_date || '')}
            </div>
          </div>
        </div>
        <span style="font-family: var(--font-mono); font-size: 0.72rem; font-weight: 700; color: ${deltaCol}; flex-shrink: 0;">${deltaStr}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="caster-dossier-player-card" style="background: rgba(15, 23, 42, 0.78); border: 1px solid ${borderAccent}; border-radius: 10px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; min-width: 0;">
      <!-- Dossier Header -->
      <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.65rem; flex-wrap: wrap;">
        <div style="min-width: 0; flex: 1;">
          <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
            <span class="player-link" onclick="openPlayerModal('${escapeHtml(safePid)}', '${escapeHtml(safeName)}')" style="font-size: 1.02rem; font-weight: 800; color: #fff; cursor: pointer; text-decoration: underline; text-decoration-color: ${accentColor}; text-underline-offset: 3px;">
              👤 ${escapeHtml(pname)}
            </span>
            <span style="font-family: var(--font-mono); font-size: 0.82rem; font-weight: 800; color: ${accentColor};">${careerElo.toFixed(1)} Elo</span>
          </div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.2rem;">
            🛡️ Active Faction: <strong style="color: ${accentColor};">${escapeHtml(ownFac)}</strong>
            ${prof?.team ? ` • 👥 ${escapeHtml(prof.team)}` : ''}
          </div>
        </div>
        <button type="button" class="btn-sm btn-outline" onclick="openPlayerModal('${escapeHtml(safePid)}', '${escapeHtml(safeName)}')" style="font-size: 0.72rem; padding: 3px 9px; color: #f8fafc; border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); cursor: pointer; font-weight: 700;">
          👤 Full Dossier
        </button>
      </div>

      <!-- 3 Career KPI Boxes -->
      <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.35rem;">
        <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 0.38rem 0.45rem; min-width: 0;">
          <div style="font-size: 0.58rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Peak Elo 👑</div>
          <div style="font-family: var(--font-mono); font-size: 0.82rem; font-weight: 800; color: #fbbf24;">${peakElo.toFixed(1)}</div>
        </div>
        <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 0.38rem 0.45rem; min-width: 0;">
          <div style="font-size: 0.58rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Career Record</div>
          <div style="font-family: var(--font-mono); font-size: 0.74rem; font-weight: 800; color: #fff; display: flex; align-items: baseline; gap: 3px; flex-wrap: wrap;">
            <span>${careerWins}W-${careerLosses}L</span>
            <span style="color:#4ade80; font-size:0.65rem;">(${careerWr}%)</span>
          </div>
        </div>
        <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 0.38rem 0.45rem; min-width: 0;">
          <div style="font-size: 0.58rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Best Streak</div>
          <div style="font-family: var(--font-mono); font-size: 0.76rem; font-weight: 800; color: #fb923c;">🔥 ${maxStreak} Wins</div>
        </div>
      </div>

      <!-- Faction & Matchup Mastery Card -->
      <div style="background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; padding: 0.65rem 0.75rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; margin-bottom: 0.55rem; flex-wrap: wrap;">
          <span style="font-size: 0.73rem; font-weight: 800; text-transform: uppercase; color: ${accentColor}; letter-spacing: 0.04em;">
            🛡️ Faction & Matchup Mastery
          </span>
          <span class="badge" style="background: ${tierBadge.bg}; color: ${tierBadge.col}; border: 1px solid ${tierBadge.border}; font-size: 0.67rem; font-weight: 800; padding: 2px 7px;">
            ${tierBadge.label}
          </span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 0.55rem;">
          <!-- Row 1: Own Faction Proficiency -->
          <div style="display: flex; flex-direction: column; gap: 4px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 0.45rem 0.55rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.35rem; flex-wrap: wrap; font-size: 0.75rem;">
              <span style="font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 0.3rem;">
                <span>🛡️ Playing as <strong>${escapeHtml(ownFac)}</strong></span>
                <span style="color: var(--text-muted); font-weight: 600; font-size: 0.68rem;">(${ownGames}G)</span>
              </span>
              ${ownGames > 0 ? `
                <span style="font-family: var(--font-mono); font-size: 0.74rem;">
                  <strong style="color: ${ownBarCol};">${ownWrStr}% WR</strong>
                  <span style="color: var(--text-secondary);">(${ownWins}W-${ownLosses}L${ownDraws ? `-${ownDraws}D` : ''})</span>
                  <span style="color: ${ownNetElo >= 0 ? '#4ade80' : '#f87171'}; margin-left: 3px;">${ownNetStr} Elo</span>
                </span>
              ` : `
                <span style="font-family: var(--font-mono); font-size: 0.71rem; color: var(--text-muted);">
                  0 Recorded Career Games
                </span>
              `}
            </div>
            <div style="width: 100%; height: 5px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden;">
              <div style="width: ${ownGames > 0 ? Math.min(100, Math.max(4, ownWrNum)) : 0}%; height: 100%; background: ${ownBarCol};"></div>
            </div>
          </div>

          <!-- Row 2: Matchup vs. Opponent's Faction -->
          <div style="display: flex; flex-direction: column; gap: 4px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 0.45rem 0.55rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.35rem; flex-wrap: wrap; font-size: 0.75rem;">
              <span style="font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 0.3rem;">
                <span>🎯 Playing vs. <strong>${escapeHtml(oppFac)}</strong></span>
                <span style="color: var(--text-muted); font-weight: 600; font-size: 0.68rem;">(${vsGames}G)</span>
              </span>
              ${vsGames > 0 ? `
                <span style="font-family: var(--font-mono); font-size: 0.74rem;">
                  <strong style="color: ${vsBarCol};">${vsWrStr}% WR</strong>
                  <span style="color: var(--text-secondary);">(${vsWins}W-${vsLosses}L${vsDraws ? `-${vsDraws}D` : ''})</span>
                  <span style="color: ${vsNetElo >= 0 ? '#4ade80' : '#f87171'}; margin-left: 3px;">${vsNetStr} Elo</span>
                </span>
              ` : `
                <span style="font-family: var(--font-mono); font-size: 0.71rem; color: var(--text-muted);">
                  No Prior Recorded Games
                </span>
              `}
            </div>
            <div style="width: 100%; height: 5px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden;">
              <div style="width: ${vsGames > 0 ? Math.min(100, Math.max(4, vsWrNum)) : 0}%; height: 100%; background: ${vsBarCol};"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Recent Tournament History -->
      <div>
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem; flex-wrap: wrap; gap: 0.25rem;">
          <span style="font-size: 0.72rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.04em;">
            ⚔️ Recent Tournament Form (${recentMatches.length} Shown)
          </span>
          <span style="font-size: 0.7rem; font-family: var(--font-mono); color: #4ade80;">Win Stakes: +${gainOnWin.toFixed(1)} Elo</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.3rem; max-height: 230px; overflow-y: auto;">
          ${recentRowsHtml || '<div style="font-size:0.75rem; color:var(--text-muted);">No recent match records available.</div>'}
        </div>
      </div>
    </div>
  `;
}

function recomputeAndRenderPredictorMatchup() {
  if (!predP1 || !predP2) return;
  const p1Prof = predP1Profile || predP1;
  const p2Prof = predP2Profile || predP2;
  const p1Name = p1Prof.player_name || p1Prof.full_name || 'Player 1';
  const p2Name = p2Prof.player_name || p2Prof.full_name || 'Player 2';
  const elo1 = Number(p1Prof.current_elo || predP1.current_elo || 1500.0);
  const elo2 = Number(p2Prof.current_elo || predP2.current_elo || 1500.0);

  const fac1 = predP1SelectedFaction || p1Prof.primary_faction || 'Unknown';
  const fac2 = predP2SelectedFaction || p2Prof.primary_faction || 'Unknown';

  const fac3MoMetrics = _computePredictor3MoMetrics(fac1, fac2);
  const p1Mastery = _extractPlayerMasteryVsOpponent(p1Prof, fac1, fac2);
  const p2Mastery = _extractPlayerMasteryVsOpponent(p2Prof, fac2, fac1);
  const h2hSummary = _computePredictorH2hSummary(predH2hMatches, p1Prof, p2Prof);

  let mfPred;
  if (typeof window.computeMultiFactorMatchupPrediction === 'function') {
    mfPred = window.computeMultiFactorMatchupPrediction({
      p1: p1Prof,
      p2: p2Prof,
      p1Elo: elo1,
      p2Elo: elo2,
      fac3MoMetrics,
      p1Mastery,
      p2Mastery,
      pastH2h: h2hSummary
    });
  } else if (predLastResponse && predLastResponse.multi_factor_prediction) {
    mfPred = predLastResponse.multi_factor_prediction;
  } else {
    const exp1 = 1 / (1 + Math.pow(10, (elo2 - elo1) / 400));
    mfPred = {
      p1WinProb: Math.round(exp1 * 100),
      p2WinProb: 100 - Math.round(exp1 * 100),
      wtcScore1: 10,
      wtcScore2: 10,
      baseEloDelta: elo1 - elo2,
      facH2hDelta: 0,
      facMetaDelta: 0,
      ownMasteryDelta: 0,
      vsMasteryDelta: 0,
      pastH2hDelta: 0,
      effectiveEloDelta: elo1 - elo2,
      details: {}
    };
  }

  const p1Prob = Number(mfPred.p1WinProb);
  const p2Prob = Number(mfPred.p2WinProb);

  const probEl1 = document.getElementById('pred-p1-prob');
  const probEl2 = document.getElementById('pred-p2-prob');
  const barEl1 = document.getElementById('pred-bar-p1');
  const barEl2 = document.getElementById('pred-bar-p2');

  if (probEl1) probEl1.innerText = `${p1Prob.toFixed(1)}%`;
  if (probEl2) probEl2.innerText = `${p2Prob.toFixed(1)}%`;
  if (barEl1) barEl1.style.width = `${p1Prob}%`;
  if (barEl2) barEl2.style.width = `${p2Prob}%`;

  const pureExp1 = 1.0 / (1.0 + Math.pow(10.0, (elo2 - elo1) / 400.0));
  const pureP1Prob = (pureExp1 * 100.0).toFixed(1);
  const pureP2Prob = ((1.0 - pureExp1) * 100.0).toFixed(1);

  const headerBadgesEl = document.getElementById('pred-header-badges');
  const eloGapPillEl = document.getElementById('pred-elo-gap-pill');
  const pureEloPillEl = document.getElementById('pred-pure-elo-pill');
  if (headerBadgesEl) headerBadgesEl.style.display = 'flex';
  if (eloGapPillEl) eloGapPillEl.innerText = `±${Math.abs(elo1 - elo2).toFixed(1)} Base Elo Gap`;
  if (pureEloPillEl) pureEloPillEl.innerText = `Pure Elo: ${pureP1Prob}% vs ${pureP2Prob}%`;

  // Render 6-Factor Prediction Breakdown Strip
  const breakdownEl = document.getElementById('pred-multi-factor-breakdown');
  if (breakdownEl && typeof window.buildCasterPredictionBreakdownHtml === 'function') {
    breakdownEl.innerHTML = window.buildCasterPredictionBreakdownHtml(mfPred, p1Name, p2Name, fac1, fac2);
  }

  // Render Matchup Context Strip
  const contextStripEl = document.getElementById('pred-context-strip');
  if (contextStripEl) {
    let facMatchupText = '';
    if (!fac3MoMetrics.isMirror && fac3MoMetrics.h2hTotal > 0) {
      const wr = Math.round((fac3MoMetrics.h2hF1Wins / fac3MoMetrics.h2hTotal) * 100);
      facMatchupText = `${escapeHtml(fac1)} ${wr}% WR vs ${escapeHtml(fac2)} (${fac3MoMetrics.h2hF1Wins}W-${fac3MoMetrics.h2hF2Wins}L${fac3MoMetrics.h2hDraws > 0 ? `-${fac3MoMetrics.h2hDraws}D` : ''}, Past 3 Mo)`;
    } else if (fac3MoMetrics.isMirror) {
      facMatchupText = `${escapeHtml(fac1)} Mirror Matchup`;
    } else {
      facMatchupText = `${escapeHtml(fac1)} vs ${escapeHtml(fac2)} (0 Direct 90d Games)`;
    }
    contextStripEl.style.display = 'flex';
    contextStripEl.innerHTML = `
      <div>⚔️ <strong>Past Head-to-Head:</strong> ${h2hSummary.summaryText}</div>
      <div>📊 <strong>Faction Matchup (3-Mo):</strong> ${facMatchupText}</div>
      <div>🏆 <strong>Projected WTC Score:</strong> <span style="font-family:var(--font-mono); font-weight:800; color:#fbbf24;">${mfPred.wtcScore1} - ${mfPred.wtcScore2}</span></div>
    `;
  }

  // Pure Elo Stakes (strictly unaffected by prediction modifiers)
  const res = predLastResponse || {};
  const dP1Win = Number((res.deltas && res.deltas.p1_win) !== undefined ? res.deltas.p1_win : (32.0 * (1.0 - pureExp1)));
  const dP2Win = Number((res.deltas && res.deltas.p2_win) !== undefined ? res.deltas.p2_win : (32.0 * pureExp1));
  const dP1Draw = Number((res.deltas && res.deltas.p1_draw) !== undefined ? res.deltas.p1_draw : (32.0 * (0.5 - pureExp1)));
  const dP2Draw = Number((res.deltas && res.deltas.p2_draw) !== undefined ? res.deltas.p2_draw : (32.0 * (0.5 - (1.0 - pureExp1))));

  const elDeltaP1Win = document.getElementById('delta-p1-win');
  const elNewP1Win = document.getElementById('new-p1-win-elo');
  const elDeltaP2Loss = document.getElementById('delta-p2-loss');
  const elNewP2Loss = document.getElementById('new-p2-loss-elo');

  if (elDeltaP1Win) elDeltaP1Win.innerText = `+${dP1Win.toFixed(1)}`;
  if (elNewP1Win) elNewP1Win.innerText = `(${(elo1 + dP1Win).toFixed(1)})`;
  if (elDeltaP2Loss) elDeltaP2Loss.innerText = `-${dP1Win.toFixed(1)}`;
  if (elNewP2Loss) elNewP2Loss.innerText = `(${(elo2 - dP1Win).toFixed(1)})`;

  const elDeltaP1Loss = document.getElementById('delta-p1-upset-loss');
  const elNewP1Loss = document.getElementById('new-p1-loss-elo');
  const elDeltaP2Win = document.getElementById('delta-p2-upset-win');
  const elNewP2Win = document.getElementById('new-p2-win-elo');

  if (elDeltaP1Loss) elDeltaP1Loss.innerText = `-${dP2Win.toFixed(1)}`;
  if (elNewP1Loss) elNewP1Loss.innerText = `(${(elo1 - dP2Win).toFixed(1)})`;
  if (elDeltaP2Win) elDeltaP2Win.innerText = `+${dP2Win.toFixed(1)}`;
  if (elNewP2Win) elNewP2Win.innerText = `(${(elo2 + dP2Win).toFixed(1)})`;

  const elDeltaP1Draw = document.getElementById('delta-p1-draw');
  const elDeltaP2Draw = document.getElementById('delta-p2-draw');
  if (elDeltaP1Draw) elDeltaP1Draw.innerText = `${dP1Draw >= 0 ? '+' : ''}${dP1Draw.toFixed(1)}`;
  if (elDeltaP2Draw) elDeltaP2Draw.innerText = `${dP2Draw >= 0 ? '+' : ''}${dP2Draw.toFixed(1)}`;

  // Render Global Faction Matchup (Past 3 Months) Card
  const fac3MoContainer = document.getElementById('pred-faction-3mo-container');
  if (fac3MoContainer) {
    fac3MoContainer.innerHTML = buildPredictorFaction3MoCardHtml(fac3MoMetrics);
  }

  // Render Side-by-Side Commander Dossiers
  const dossiersContainer = document.getElementById('pred-commander-dossiers-container');
  if (dossiersContainer) {
    dossiersContainer.innerHTML = `
      <div class="caster-table-section-card" style="background: rgba(15, 23, 42, 0.78); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 1.15rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <h4 style="margin: 0; font-size: 0.98rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.45rem;">
              <span>🎖️ Commander Dossiers: Faction Mastery, Vs-Faction Matrix & Recent Tournament Form</span>
            </h4>
            <div style="font-size: 0.76rem; color: var(--text-secondary); margin-top: 2px;">
              Switch either player's <strong>Active Faction</strong> above to simulate different army matchups in real time, or click any player or tournament to inspect their full dossier.
            </div>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 1rem;">
          ${buildPredictorSingleDossierCardHtml(1, p1Prof, p2Prof, fac1, fac2, p1Mastery, dP1Win)}
          ${buildPredictorSingleDossierCardHtml(2, p2Prof, p1Prof, fac2, fac1, p2Mastery, dP2Win)}
        </div>
      </div>
    `;
  }

  // Update H2H Summary Badge & Table
  const h2hBadgeEl = document.getElementById('pred-h2h-summary-badge');
  if (h2hBadgeEl) {
    h2hBadgeEl.style.display = 'inline-block';
    if (h2hSummary.total > 0) {
      h2hBadgeEl.style.background = 'rgba(56, 189, 248, 0.14)';
      h2hBadgeEl.style.color = '#38bdf8';
      h2hBadgeEl.style.border = '1px solid rgba(56, 189, 248, 0.35)';
      h2hBadgeEl.innerHTML = `⚔️ ${h2hSummary.summaryText}`;
    } else {
      h2hBadgeEl.style.background = 'rgba(148, 163, 184, 0.12)';
      h2hBadgeEl.style.color = '#94a3b8';
      h2hBadgeEl.style.border = '1px solid rgba(148, 163, 184, 0.25)';
      h2hBadgeEl.innerText = 'First Career Meeting (0 Prior Games)';
    }
  }
  renderHeadToHeadHistory(predH2hMatches);
}

async function runPrediction() {
  if (!predP1 || !predP2) return;
  try {
    const p1Identifier = predP1.player_id || predP1.player_name;
    const p2Identifier = predP2.player_id || predP2.player_name;
    const currentSys = typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k';
    const res = await window.api.predictMatch(
      p1Identifier,
      p2Identifier,
      currentSys,
      predP1SelectedFaction,
      predP2SelectedFaction
    );
    if (!res || res.error) {
      console.error('Prediction API error:', res ? res.error : 'Unknown');
      return;
    }

    predLastResponse = res;
    if (res.faction_3mo_summary && typeof res.faction_3mo_summary === 'object') {
      predFaction3MoSummary = res.faction_3mo_summary;
    }
    if (res.p1_profile && typeof res.p1_profile === 'object') {
      predP1Profile = { ...predP1, ...res.p1_profile };
      if (!predP1SelectedFaction || predP1SelectedFaction === 'Unknown' || predP1SelectedFaction === 'Various') {
        predP1SelectedFaction = predP1Profile.primary_faction || predP1SelectedFaction;
      }
      updatePredictCard(1, predP1Profile);
    }
    if (res.p2_profile && typeof res.p2_profile === 'object') {
      predP2Profile = { ...predP2, ...res.p2_profile };
      if (!predP2SelectedFaction || predP2SelectedFaction === 'Unknown' || predP2SelectedFaction === 'Various') {
        predP2SelectedFaction = predP2Profile.primary_faction || predP2SelectedFaction;
      }
      updatePredictCard(2, predP2Profile);
    }
    predH2hMatches = Array.isArray(res.head_to_head) ? res.head_to_head : [];

    recomputeAndRenderPredictorMatchup();
  } catch (err) {
    console.error('Prediction failed:', err);
  }
}

function renderHeadToHeadHistory(h2h) {
  const tbody = document.getElementById('h2h-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!h2h || h2h.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No previous head-to-head match encounters between these players.</td></tr>';
    return;
  }

  const p1Id = String((predP1Profile || predP1)?.player_id || '');
  const p2Id = String((predP2Profile || predP2)?.player_id || '');
  const p1Name = (predP1Profile || predP1)?.player_name || 'Player 1';
  const p2Name = (predP2Profile || predP2)?.player_name || 'Player 2';

  h2h.forEach(m => {
    const tr = document.createElement('tr');
    const isP1Side1 = String(m.player1_id || '') === p1Id;

    const scoreP1 = isP1Side1
      ? (m.player1_score !== null && m.player1_score !== undefined ? m.player1_score : '-')
      : (m.player2_score !== null && m.player2_score !== undefined ? m.player2_score : '-');
    const scoreP2 = isP1Side1
      ? (m.player2_score !== null && m.player2_score !== undefined ? m.player2_score : '-')
      : (m.player1_score !== null && m.player1_score !== undefined ? m.player1_score : '-');
    const facP1 = isP1Side1 ? (m.player1_faction || '') : (m.player2_faction || '');
    const facP2 = isP1Side1 ? (m.player2_faction || '') : (m.player1_faction || '');

    const winnerId = String(m.winner_id || '');
    const isP1Winner = winnerId === p1Id;
    const isP2Winner = winnerId === p2Id;

    let outcomeText = 'Draw';
    let badgeClass = 'badge-draw';
    if (m.is_draw) {
      outcomeText = 'Draw';
      badgeClass = 'badge-draw';
    } else if (isP1Winner) {
      outcomeText = `${p1Name} Win`;
      badgeClass = 'badge-win';
    } else if (isP2Winner) {
      outcomeText = `${p2Name} Win`;
      badgeClass = 'badge-win';
    } else {
      outcomeText = 'Completed';
      badgeClass = 'badge-win';
    }

    const eventName = m.event_name || 'Tournament';
    const eventId = m.event_id ? String(m.event_id).trim() : '';

    tr.innerHTML = `
      <td style="font-family:var(--font-mono); color:var(--text-muted); font-size:0.85rem;">${(m.match_date || '').slice(0, 10)}</td>
      <td class="h2h-event-cell" style="${eventId ? 'cursor:pointer;' : ''}">
        ${eventId ? `<span class="player-link" style="font-weight:600; cursor:pointer;" title="View Tournament Details">${escapeHtml(eventName)}</span>` : `<span style="font-weight:600; color:#fff;">${escapeHtml(eventName)}</span>`}
      </td>
      <td style="font-family:var(--font-mono);">R${m.round || 1}</td>
      <td>
        <span style="font-family:var(--font-mono); font-weight:700; color:${isP1Winner ? 'var(--win)' : 'var(--text-secondary)'};">${scoreP1}</span>
        ${facP1 ? `<span style="font-size:0.72rem; color:var(--text-muted); margin-left:4px;">(${escapeHtml(facP1)})</span>` : ''}
      </td>
      <td>
        <span style="font-family:var(--font-mono); font-weight:700; color:${isP2Winner ? 'var(--win)' : 'var(--text-secondary)'};">${scoreP2}</span>
        ${facP2 ? `<span style="font-size:0.72rem; color:var(--text-muted); margin-left:4px;">(${escapeHtml(facP2)})</span>` : ''}
      </td>
      <td><span class="badge ${badgeClass}">${escapeHtml(outcomeText)}</span></td>
    `;

    if (eventId) {
      const eventCell = tr.querySelector('.h2h-event-cell');
      if (eventCell) {
        eventCell.onclick = (e) => {
          e.stopPropagation();
          if (typeof openEventModal === 'function') {
            openEventModal(eventId, false);
          }
        };
      }
    }

    tbody.appendChild(tr);
  });
}

function resetPredictorState() {
  predP1 = null;
  predP2 = null;
  predP1Profile = null;
  predP2Profile = null;
  predP1SelectedFaction = '';
  predP2SelectedFaction = '';
  predH2hMatches = [];
  predLastResponse = null;

  [1, 2].forEach(colNum => {
    const inp = document.getElementById(`p${colNum}-name-input`);
    if (inp) inp.value = '';
    const dd = document.getElementById(`p${colNum}-ac-dropdown`);
    if (dd) dd.style.display = 'none';
    const nameEl = document.getElementById(`p${colNum}-card-name`);
    if (nameEl) nameEl.innerText = `Player ${colNum}`;
    const teamEl = document.getElementById(`p${colNum}-card-team`);
    if (teamEl) {
      teamEl.innerText = '';
      teamEl.style.display = 'none';
    }
    const quickBtn = document.getElementById(`p${colNum}-quick-profile-btn`);
    if (quickBtn) quickBtn.style.display = 'none';
    const facEl = document.getElementById(`p${colNum}-card-faction`);
    if (facEl) {
      facEl.innerText = '';
      facEl.style.display = 'none';
    }
    const selRow = document.getElementById(`p${colNum}-faction-selector-row`);
    if (selRow) selRow.style.display = 'none';
    const chipsEl = document.getElementById(`p${colNum}-faction-chips`);
    if (chipsEl) chipsEl.innerHTML = '';
    const eloEl = document.getElementById(`p${colNum}-card-elo`);
    if (eloEl) eloEl.innerText = '1500';
    const recEl = document.getElementById(`p${colNum}-card-record`);
    if (recEl) recEl.innerText = '';
    const wrEl = document.getElementById(`p${colNum}-card-winrate`);
    if (wrEl) wrEl.innerText = '';
    const peakEl = document.getElementById(`p${colNum}-card-peak`);
    if (peakEl) peakEl.innerText = '';
  });

  [
    'pred-p1-prob', 'pred-p2-prob',
    'delta-p1-win', 'new-p1-win-elo', 'delta-p2-loss', 'new-p2-loss-elo',
    'delta-p1-upset-loss', 'new-p1-loss-elo', 'delta-p2-upset-win', 'new-p2-win-elo',
    'delta-p1-draw', 'delta-p2-draw'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerText = '';
  });

  const headerBadgesEl = document.getElementById('pred-header-badges');
  if (headerBadgesEl) headerBadgesEl.style.display = 'none';
  const breakdownEl = document.getElementById('pred-multi-factor-breakdown');
  if (breakdownEl) breakdownEl.innerHTML = '';
  const contextStripEl = document.getElementById('pred-context-strip');
  if (contextStripEl) {
    contextStripEl.style.display = 'none';
    contextStripEl.innerHTML = '';
  }
  const fac3MoContainer = document.getElementById('pred-faction-3mo-container');
  if (fac3MoContainer) fac3MoContainer.innerHTML = '';
  const dossiersContainer = document.getElementById('pred-commander-dossiers-container');
  if (dossiersContainer) dossiersContainer.innerHTML = '';
  const h2hBadgeEl = document.getElementById('pred-h2h-summary-badge');
  if (h2hBadgeEl) {
    h2hBadgeEl.style.display = 'none';
    h2hBadgeEl.innerText = '';
  }

  const barEl1 = document.getElementById('pred-bar-p1');
  const barEl2 = document.getElementById('pred-bar-p2');
  if (barEl1) barEl1.style.width = '50%';
  if (barEl2) barEl2.style.width = '50%';

  const tbody = document.getElementById('h2h-table-body');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Select two players to view past match records.</td></tr>';
  }
}
window.resetPredictorState = resetPredictorState;
window.selectPredictPlayer = selectPredictPlayer;
window.runPrediction = runPrediction;

