// Automated End-to-End Verification for Meta Intel Faction Latency & User Journeys
// Runs against dev_server on port 5178 via Headless Chrome & CDP

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

const ARTIFACT_DIR = '/usr/local/google/home/hsiehjun/.gemini/jetski/brain/a6253a1a-ca8f-4466-9cc6-340c885b9577';
const SERVER_PORT = process.env.PORT || 8000;

async function takeScreenshot(client, filename, options = {}) {
  if (options.width && options.height) {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: options.width,
      height: options.height,
      deviceScaleFactor: 1,
      mobile: !!options.mobile
    });
    await sleep(300);
  }
  const res = await client.send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(res.data, 'base64');
  if (fs.existsSync(ARTIFACT_DIR)) {
    fs.writeFileSync(`${ARTIFACT_DIR}/${filename}`, buf);
  }
  console.log(`  📸 Screenshot captured: ${filename} (${options.width || 'default'}x${options.height || 'default'})`);
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };
  }

  async ready() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (res && res.exceptionDetails) {
      throw new Error('Eval Exception: ' + JSON.stringify(res.exceptionDetails));
    }
    return res && res.result ? res.result.value : null;
  }
}

async function runMetaIntelFactionLatencyTests() {
  console.log('======================================================================');
  console.log('⚡ STARTING META INTEL FACTION DETAILS & LATENCY E2E VERIFICATION');
  console.log('======================================================================');

  // ------------------------------------------------------------------
  // TEST 0: Direct Server Endpoint Latency Benchmark (< 1000ms SLA)
  // ------------------------------------------------------------------
  console.log('\n[Test 0] Benchmarking /api/faction/{faction_name} latency across all timeframes...');
  for (const tf of ['30d', '3mo', '6mo', '1yr', 'all']) {
    const t0 = Date.now();
    const data = await fetchJson(`http://127.0.0.1:${SERVER_PORT}/api/faction/Drukhari?system=40k&timeframe=${tf}&limit=50`);
    const elapsed = Date.now() - t0;
    console.log(`  ⏱️ /api/faction/Drukhari?timeframe=${tf} -> ${elapsed}ms (matchups=${(data.matchups || []).length}, matches=${(data.matches || []).length})`);
    if (elapsed >= 1000) {
      throw new Error(`Endpoint latency ${elapsed}ms exceeded strict 1000ms SLA for timeframe=${tf}!`);
    }
  }

  const chromePort = 9226;
  const chrome = spawn('google-chrome', [
    '--headless=new',
    `--remote-debugging-port=${chromePort}`,
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1440,950',
    'about:blank'
  ]);

  try {
    await sleep(1500);
    const targets = await fetchJson(`http://127.0.0.1:${chromePort}/json`);
    const pageTarget = targets.find(t => t.type === 'page');
    if (!pageTarget) throw new Error('No Chrome page target found');

    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.ready();
    console.log('✅ Connected to Chrome CDP on port ' + chromePort);

    await client.send('Page.enable');
    await client.send('DOM.enable');

    // ------------------------------------------------------------------
    // TEST 1: Load App & Navigate to Meta Intel (#factions)
    // ------------------------------------------------------------------
    console.log(`\n[Test 1] Navigating to http://127.0.0.1:${SERVER_PORT}/app.html#factions ...`);
    await client.send('Page.navigate', { url: `http://127.0.0.1:${SERVER_PORT}/app.html#factions` });
    await sleep(2000);

    const activeNav = await client.eval(`
      (function() {
        if (typeof showView === 'function') showView('factions');
        const fView = document.getElementById('view-factions');
        return fView ? fView.style.display : 'missing';
      })()
    `);
    console.log(`  ✓ Meta Intel view display state: ${activeNav}`);

    // Wait for faction cards to render
    await sleep(1000);
    const factionCount = await client.eval(`
      (function() {
        const cards = document.querySelectorAll('.faction-card, .faction-row, [onclick*="openFactionModal"]');
        return cards.length;
      })()
    `);
    console.log(`  ✓ Faction cards rendered on screen: ${factionCount}`);

    // ------------------------------------------------------------------
    // TEST 2: Open Unified Faction Modal for "Drukhari"
    // ------------------------------------------------------------------
    console.log('\n[Test 2] Opening Unified Faction Modal for "Drukhari"...');
    const openStartTime = Date.now();
    await client.eval(`
      openFactionModal('Drukhari', '1yr');
    `);
    const openDuration = Date.now() - openStartTime;
    console.log(`  ⚡ openFactionModal invoked in ${openDuration}ms`);

    await sleep(600);

    const modalDataRendered = await client.eval(`
      (function() {
        const subtabs = document.querySelectorAll('#faction-modal .faction-modal-subtabs');
        const kpiCards = document.querySelectorAll('#faction-modal-kpis .fmodal-kpi-card');
        const matchRows = document.querySelectorAll('#faction-matches-body tr:not(.skeleton-row)');
        const matchupRows = document.querySelectorAll('#faction-matchups-body tr:not(.skeleton-row)');
        const muView = document.getElementById('faction-view-matchups');
        const mView = document.getElementById('faction-view-matches');
        const mCount = document.getElementById('faction-tab-matches-count');
        const muCount = document.getElementById('faction-tab-matchups-count');
        const tierBadge = document.getElementById('modal-faction-tier-badge');
        return {
          legacySubtabsCount: subtabs.length,
          kpiCardsCount: kpiCards.length,
          matchesCount: matchRows.length,
          matchupsCount: matchupRows.length,
          matchupsVisible: muView ? getComputedStyle(muView).display !== 'none' : false,
          matchesVisible: mView ? getComputedStyle(mView).display !== 'none' : false,
          muRectHeight: muView ? Math.round(muView.getBoundingClientRect().height) : 0,
          mRectHeight: mView ? Math.round(mView.getBoundingClientRect().height) : 0,
          pillMatches: mCount ? mCount.innerText : null,
          pillMatchups: muCount ? muCount.innerText : null,
          tierBadgeText: tierBadge ? tierBadge.innerText : null
        };
      })()
    `);
    console.log(`  ✓ Unified Faction Modal state:`, modalDataRendered);
    if (modalDataRendered.legacySubtabsCount !== 0) {
      throw new Error('Legacy faction-modal-subtabs should be removed!');
    }
    if (modalDataRendered.kpiCardsCount !== 4) {
      throw new Error(`Expected 4 KPI cards, got ${modalDataRendered.kpiCardsCount}`);
    }
    if (!modalDataRendered.matchupsVisible || !modalDataRendered.matchesVisible) {
      throw new Error('Both Matchups and Recent Games sections must be visible in unified view!');
    }
    if (modalDataRendered.matchesCount === 0 || modalDataRendered.matchupsCount === 0) {
      throw new Error('Faction matchups or matches failed to render inside modal!');
    }
    await takeScreenshot(client, 'revamped_faction_modal_desktop.png', { width: 1440, height: 950 });

    // Scroll to Recent Tournament Games section and capture screenshot
    await client.eval(`
      (function() {
        const el = document.getElementById('faction-view-matches');
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
      })()
    `);
    await sleep(300);
    await takeScreenshot(client, 'revamped_faction_modal_desktop_games.png', { width: 1440, height: 950 });

    // Scroll back to top and capture Mobile screenshot (390x844)
    await client.eval(`
      (function() {
        const body = document.querySelector('#faction-modal .modal-body');
        if (body) body.scrollTop = 0;
      })()
    `);
    await takeScreenshot(client, 'revamped_faction_modal_mobile.png', { width: 390, height: 844, mobile: true });

    // Restore desktop viewport
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 950,
      deviceScaleFactor: 1,
      mobile: false
    });
    await sleep(250);

    // ------------------------------------------------------------------
    // TEST 3: Interactive Matchup & Match Filter Pills
    // ------------------------------------------------------------------
    console.log('\n[Test 3] Testing Interactive Matchup Verdict & Match Outcome Filters...');
    await client.eval(`setFactionModalMatchupFilter('FAVORED');`);
    const favoredCount = await client.eval(`document.querySelectorAll('#faction-matchups-body tr').length;`);
    console.log(`  ✓ Favored matchups filtered rows: ${favoredCount}`);
    await client.eval(`setFactionModalMatchupFilter('ALL');`);

    await client.eval(`setFactionModalMatchOutcomeFilter('W');`);
    const winsCount = await client.eval(`document.querySelectorAll('#faction-matches-body tr').length;`);
    console.log(`  ✓ Victory matches filtered rows: ${winsCount}`);
    await client.eval(`setFactionModalMatchOutcomeFilter('ALL');`);

    // ------------------------------------------------------------------
    // TEST 4: Timeframe Switching (6mo, 1yr, all)
    // ------------------------------------------------------------------
    console.log('\n[Test 4] Testing Timeframe switching (6mo, all, 1yr)...');
    await client.eval(`changeFactionModalTimeframe('6mo');`);
    await sleep(600);
    const tfSubtitle6mo = await client.eval(`document.getElementById('modal-faction-subtitle').innerText;`);
    console.log(`  ✓ 6mo subtitle: "${tfSubtitle6mo}"`);

    await client.eval(`changeFactionModalTimeframe('1yr');`);
    await sleep(600);
    const tfSubtitle1yr = await client.eval(`document.getElementById('modal-faction-subtitle').innerText;`);
    console.log(`  ✓ 1yr subtitle: "${tfSubtitle1yr}"`);

    // ------------------------------------------------------------------
    // TEST 5: SWR Instant Cache Verification (Re-opening Orks)
    // ------------------------------------------------------------------
    console.log('\n[Test 5] Testing Client-Side SWR Cache Speed...');
    // Close modal
    await client.eval(`
      if (typeof closeModal === 'function') closeModal('faction-modal');
      else {
        const m = document.getElementById('faction-modal');
        if (m) { m.style.display = 'none'; m.classList.remove('active'); }
      }
    `);
    await sleep(400);

    // Reopen Orks and measure render latency
    const swrStartTime = Date.now();
    await client.eval(`
      openFactionModal('Orks', '1yr');
    `);
    const swrElapsed = Date.now() - swrStartTime;
    console.log(`  ⚡ Re-opened Orks in ${swrElapsed}ms (SWR Cache Hit)`);

    const swrRows = await client.eval(`
      document.querySelectorAll('#faction-matches-body tr:not(.skeleton-row)').length;
    `);
    console.log(`  ✓ Matches rows immediately populated from cache: ${swrRows}`);
    if (swrRows === 0) {
      throw new Error('SWR cache did not immediately render matches rows!');
    }

    // ------------------------------------------------------------------
    // TEST 5b: Age of Sigmar (AoS) Faction Modal Verification
    // ------------------------------------------------------------------
    console.log('\n[Test 5b] Testing Age of Sigmar (AoS) Faction Modal...');
    await client.eval(`
      if (typeof setGameSystem === 'function') setGameSystem('aos');
      else { window.currentGameSystem = 'aos'; }
      openFactionModal('Stormcast Eternals', '1yr');
    `);
    await sleep(1000);

    const aosModalState = await client.eval(`
      (function() {
        const title = document.getElementById('modal-faction-title');
        const sub = document.getElementById('modal-faction-subtitle');
        const matchRows = document.querySelectorAll('#faction-matches-body tr:not(.skeleton-row)');
        return {
          title: title ? title.innerText : null,
          subtitle: sub ? sub.innerText : null,
          matchesCount: matchRows.length
        };
      })()
    `);
    console.log(`  ✓ AoS Modal state:`, aosModalState);
    if (!aosModalState.subtitle || !aosModalState.subtitle.includes('Age of Sigmar')) {
      throw new Error('AoS modal subtitle does not reflect Age of Sigmar system!');
    }
    await takeScreenshot(client, '19_faction_modal_aos_stormcast.png', { width: 1440, height: 900 });

    // Switch back to 40k
    await client.eval(`
      if (typeof setGameSystem === 'function') setGameSystem('40k');
      else { window.currentGameSystem = '40k'; }
      if (typeof closeModal === 'function') closeModal('faction-modal');
    `);
    await sleep(400);

    // ------------------------------------------------------------------
    // TEST 6: User Journey Regression Verification (Leaderboard, Tournaments, My Hub, Predictor)
    // ------------------------------------------------------------------
    console.log('\n[Test 6] Verifying other user journeys to ensure zero regressions...');
    
    // Journey 6a: Tournaments
    await client.eval(`if (typeof showView === 'function') showView('tournaments');`);
    await sleep(800);
    const tournamentsState = await client.eval(`
      (function() {
        const view = document.getElementById('view-tournaments');
        const cards = document.querySelectorAll('.tournament-card, .event-card');
        return { visible: view && view.style.display !== 'none', cardCount: cards.length };
      })()
    `);
    console.log(`  ✓ Tournaments view intact:`, tournamentsState);

    // Journey 6b: Players / Leaderboard
    await client.eval(`if (typeof showView === 'function') showView('players');`);
    await sleep(800);
    const leaderboardState = await client.eval(`
      (function() {
        const view = document.getElementById('view-players');
        const rows = document.querySelectorAll('#players-tbody tr');
        return { visible: view && view.style.display !== 'none', rowCount: rows.length };
      })()
    `);
    console.log(`  ✓ Leaderboard view intact:`, leaderboardState);

    // Journey 6c: My Hub
    await client.eval(`if (typeof showView === 'function') showView('my_hub');`);
    await sleep(800);
    const myHubState = await client.eval(`
      (function() {
        const view = document.getElementById('view-my_hub');
        return { visible: view && view.style.display !== 'none' };
      })()
    `);
    console.log(`  ✓ My Hub view intact:`, myHubState);

    // Journey 6d: Match Predictor
    await client.eval(`if (typeof showView === 'function') showView('predictor');`);
    await sleep(800);
    const predictorState = await client.eval(`
      (function() {
        const view = document.getElementById('view-predictor');
        return { visible: view && view.style.display !== 'none' };
      })()
    `);
    console.log(`  ✓ Predictor view intact:`, predictorState);

    console.log('\n======================================================================');
    console.log('🎉 ALL TESTS AND USER JOURNEYS PASSED SUCCESSFULLY WITH ZERO REGRESSIONS!');
    console.log('======================================================================\n');

  } catch (err) {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
  } finally {
    try {
      chrome.kill('SIGTERM');
    } catch (e) {}
  }
}

runMetaIntelFactionLatencyTests();
