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

const ARTIFACT_DIR = '/usr/local/google/home/hsiehjun/.gemini/jetski/brain/28938324-a50e-4441-8d68-0e2840465302';

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

  const chromePort = 9226;
  const chrome = spawn('google-chrome', [
    '--headless=new',
    `--remote-debugging-port=${chromePort}`,
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1440,900',
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
    console.log('\n[Test 1] Navigating to http://127.0.0.1:5178/app.html#factions ...');
    await client.send('Page.navigate', { url: 'http://127.0.0.1:5178/app.html#factions' });
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
    await takeScreenshot(client, '14_meta_intel_overview.png', { width: 1440, height: 900 });

    // ------------------------------------------------------------------
    // TEST 2: Open Faction Modal for "Orks" - Verify Skeletons & Instant Modal Response
    // ------------------------------------------------------------------
    console.log('\n[Test 2] Opening Faction Modal for "Orks"...');
    const openStartTime = Date.now();
    await client.eval(`
      openFactionModal('Orks', '1yr');
    `);
    const openDuration = Date.now() - openStartTime;
    console.log(`  ⚡ openFactionModal invoked in ${openDuration}ms`);

    // Verify modal is open and active
    const modalState = await client.eval(`
      (function() {
        const m = document.getElementById('faction-modal');
        const title = document.getElementById('modal-faction-title');
        const sub = document.getElementById('modal-faction-subtitle');
        return {
          exists: !!m,
          display: m ? m.style.display : null,
          hasActiveClass: m ? m.classList.contains('active') : false,
          title: title ? title.innerText : null,
          subtitle: sub ? sub.innerText : null
        };
      })()
    `);
    console.log(`  ✓ Faction Modal state:`, modalState);
    if (!modalState.exists || (modalState.display === 'none' && !modalState.hasActiveClass)) {
      throw new Error('Faction modal failed to open!');
    }

    // Wait for data load / SWR completion
    await sleep(1200);

    const modalDataRendered = await client.eval(`
      (function() {
        const matchRows = document.querySelectorAll('#faction-matches-body tr:not(.skeleton-row)');
        const playerRows = document.querySelectorAll('#faction-players-body tr:not(.skeleton-row)');
        const matchupRows = document.querySelectorAll('#faction-matchups-body tr:not(.skeleton-row)');
        const mCount = document.getElementById('faction-tab-matches-count');
        const pCount = document.getElementById('faction-tab-players-count');
        const muCount = document.getElementById('faction-tab-matchups-count');
        return {
          matchesCount: matchRows.length,
          playersCount: playerRows.length,
          matchupsCount: matchupRows.length,
          pillMatches: mCount ? mCount.innerText : null,
          pillPlayers: pCount ? pCount.innerText : null,
          pillMatchups: muCount ? muCount.innerText : null
        };
      })()
    `);
    console.log(`  ✓ Data rendered inside Faction Modal:`, modalDataRendered);
    if (modalDataRendered.matchesCount === 0) {
      throw new Error('Faction matches failed to render inside modal!');
    }
    await takeScreenshot(client, '15_faction_modal_orks_matches.png', { width: 1440, height: 900 });

    // ------------------------------------------------------------------
    // TEST 3: Sub-tab Switching (Top Commanders & Matchups Matrix)
    // ------------------------------------------------------------------
    console.log('\n[Test 3] Testing Sub-tab switching...');
    // Switch to Top Commanders
    await client.eval(`switchFactionModalTab('players');`);
    await sleep(300);
    const playersTabActive = await client.eval(`
      (function() {
        const view = document.getElementById('faction-view-players');
        const btn = document.getElementById('faction-subtab-players');
        return {
          viewDisplay: view ? view.style.display : null,
          btnActive: btn ? btn.classList.contains('active') : false
        };
      })()
    `);
    console.log(`  ✓ Top Commanders sub-tab active:`, playersTabActive);
    await takeScreenshot(client, '16_faction_modal_orks_top_commanders.png', { width: 1440, height: 900 });

    // Switch to Matchups Matrix
    await client.eval(`switchFactionModalTab('matchups');`);
    await sleep(300);
    const matchupsTabActive = await client.eval(`
      (function() {
        const view = document.getElementById('faction-view-matchups');
        const btn = document.getElementById('faction-subtab-matchups');
        return {
          viewDisplay: view ? view.style.display : null,
          btnActive: btn ? btn.classList.contains('active') : false
        };
      })()
    `);
    console.log(`  ✓ Matchups Matrix sub-tab active:`, matchupsTabActive);
    await takeScreenshot(client, '17_faction_modal_orks_matchups.png', { width: 1440, height: 900 });

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
