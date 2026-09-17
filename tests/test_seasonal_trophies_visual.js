const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5177;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = '/usr/local/google/home/hsiehjun/.gemini/jetski/brain/c237be5b-1b61-4ed4-9716-49956da8d5ea';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    }).on('error', reject);
  });
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
      console.warn('Eval warning:', res.exceptionDetails.text || res.exceptionDetails);
    }
    return res && res.result ? res.result.value : null;
  }
}

async function takeScreenshot(client, filename, options = {}) {
  const width = options.width || 1280;
  const height = options.height || 850;
  const mobile = !!options.mobile;

  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile
  });
  await sleep(400);

  const res = await client.send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(res.data, 'base64');
  
  const destPath = path.join(ARTIFACT_DIR, filename);
  fs.writeFileSync(destPath, buf);
  console.log(`  📸 Saved screenshot: ${filename} (${width}x${height})`);
}

async function runVisualTests() {
  console.log("🚀 Launching Headless Chrome on port 9336...");
  const chromeProcess = spawn('/usr/bin/google-chrome', [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--remote-debugging-port=9336',
    '--window-size=1280,850',
    '--hide-scrollbars'
  ], { stdio: 'ignore' });

  await sleep(1500);

  try {
    const targets = await fetchJson('http://127.0.0.1:9336/json');
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    if (!pageTarget) throw new Error('No Chrome target');

    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.ready();
    await client.send('Page.enable');
    await client.send('DOM.enable');
    await client.send('CSS.enable');

    console.log(`🌐 Navigating to ${BASE_URL}/app.html...`);
    await client.send('Page.navigate', { url: `${BASE_URL}/app.html` });
    await sleep(2500);

    // Dismiss any celebration modal if present
    await client.eval(`
      (function() {
        var modal = document.getElementById('badges-celebration-modal');
        if (modal) modal.remove();
        if (typeof showTab === 'function') showTab('my-hub');
        if (typeof switchHubSubtab === 'function') switchHubSubtab('trophies');
      })();
    `);
    await sleep(1200);

    // Scroll trophy room into view
    await client.eval(`
      (function() {
        var panel = document.getElementById('hub-panel-trophies');
        if (panel) panel.scrollIntoView({ behavior: 'instant', block: 'start' });
      })();
    `);
    await sleep(600);

    // ── 1. DESKTOP TEST: Career View vs Seasonal View ──
    console.log("\n=== [1/7] Desktop Hub: Career Milestones ===");
    await takeScreenshot(client, 'desktop_hub_career_scope.png', { width: 1280, height: 950 });

    console.log("\n=== [2/7] Desktop Hub: Switch to Season 2026 Scope ===");
    await client.eval(`
      (function() {
        window.BadgesUI.setHubScope('seasonal');
        var panel = document.getElementById('hub-panel-trophies');
        if (panel) panel.scrollIntoView({ behavior: 'instant', block: 'start' });
      })();
    `);
    await sleep(600);
    await takeScreenshot(client, 'desktop_hub_seasonal_scope.png', { width: 1280, height: 950 });

    // ── 2. DESKTOP TEST: Category Filtering in Season 2026 ──
    console.log("\n=== [3/7] Desktop Hub: Filter by Game Tracker Category ===");
    await client.eval(`
      (function() {
        window.BadgesUI.setSeasonalCategory('tracker');
      })();
    `);
    await sleep(500);
    await takeScreenshot(client, 'desktop_hub_seasonal_tracker_cat.png', { width: 1280, height: 950 });

    // Reset category to all
    await client.eval(`window.BadgesUI.setSeasonalCategory('all');`);
    await sleep(400);

    // ── 3. DESKTOP TEST: Seasonal Detail Modal & Glory Currency Modal ──
    console.log("\n=== [4/7] Desktop Hub: Open Seasonal Detail Modal (Century Scorer '26) ===");
    await client.eval(`
      (function() {
        window.BadgesUI.openTrophyModal('s26_40k_century_scorer', false);
      })();
    `);
    await sleep(500);
    await takeScreenshot(client, 'desktop_modal_seasonal_unlocked.png', { width: 1280, height: 950 });

    // Close modal & open locked modal for Warmaster of 2026
    await client.eval(`window.BadgesUI.closeTrophyModal();`);
    await sleep(300);

    console.log("  Opening In-Progress Modal for Warmaster of 2026 Capstone...");
    await client.eval(`
      (function() {
        window.BadgesUI.openTrophyModal('s26_40k_warmaster', false);
      })();
    `);
    await sleep(500);
    await takeScreenshot(client, 'desktop_modal_seasonal_capstone.png', { width: 1280, height: 950 });

    await client.eval(`window.BadgesUI.closeTrophyModal();`);
    await sleep(300);

    console.log("  Opening Unified Glory Currency Modal...");
    await client.eval(`
      (function() {
        window.BadgesUI.openGloryCurrencyModal();
      })();
    `);
    await sleep(500);
    await takeScreenshot(client, 'desktop_modal_unified_glory.png', { width: 1280, height: 950 });

    await client.eval(`window.BadgesUI.closeGloryCurrencyModal();`);
    await sleep(300);

    // ── 4. TABLET TEST: 768x1024 ──
    console.log("\n=== [5/7] Tablet (768x1024) Hub: Season 2026 Layout ===");
    await client.eval(`
      (function() {
        var panel = document.getElementById('hub-panel-trophies');
        if (panel) panel.scrollIntoView({ behavior: 'instant', block: 'start' });
      })();
    `);
    await takeScreenshot(client, 'tablet_hub_seasonal_scope.png', { width: 768, height: 1024 });

    // ── 5. MOBILE TEST: Pixel 9 (412x924) ──
    console.log("\n=== [6/7] Mobile Pixel 9 (412x924) Hub: Season 2026 Layout ===");
    await client.eval(`
      (function() {
        var panel = document.getElementById('hub-panel-trophies');
        if (panel) panel.scrollIntoView({ behavior: 'instant', block: 'start' });
      })();
    `);
    await takeScreenshot(client, 'mobile_hub_seasonal_scope.png', { width: 412, height: 924, mobile: true });

    // Check for horizontal overflow on mobile
    const overflowCheck = await client.eval(`
      (function() {
        const bodyW = document.body.scrollWidth;
        const windowW = window.innerWidth;
        const wrapper = document.querySelector('.trophy-room-wrapper');
        const wrapperW = wrapper ? wrapper.scrollWidth : 0;
        return {
          bodyScrollWidth: bodyW,
          windowInnerWidth: windowW,
          wrapperScrollWidth: wrapperW,
          hasHorizontalOverflow: bodyW > windowW
        };
      })();
    `);
    console.log("  Mobile layout check:", overflowCheck);

    // Mobile Modal inspection
    console.log("  Mobile Pixel 9: Inspecting Seasonal Modal...");
    await client.eval(`
      (function() {
        window.BadgesUI.openTrophyModal('s26_40k_first_blood', false);
      })();
    `);
    await sleep(500);
    await takeScreenshot(client, 'mobile_modal_seasonal_unlocked.png', { width: 412, height: 924, mobile: true });

    await client.eval(`window.BadgesUI.closeTrophyModal();`);
    await sleep(300);

    // ── 6. PUBLIC PROFILE TEST: Scope Switcher & Earned-Only Showcase ──
    console.log("\n=== [7/7] Public Profile: Career vs Season 2026 Showcase Mode ===");
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 950, deviceScaleFactor: 1, mobile: false });
    await sleep(300);

    // Switch to Leaderboard, click on a player to open public profile
    await client.eval(`
      (function() {
        if (typeof showTab === 'function') showTab('leaderboard');
      })();
    `);
    await sleep(1000);

    await client.eval(`
      (function() {
        if (typeof openPlayerProfile === 'function') {
          openPlayerProfile('1', '40k');
        }
      })();
    `);
    await sleep(1500);

    // Switch profile to Trophies tab
    await client.eval(`
      (function() {
        if (typeof switchProfileSubtab === 'function') switchProfileSubtab('trophies');
        var pPanel = document.getElementById('profile-panel-trophies');
        if (pPanel) pPanel.scrollIntoView({ behavior: 'instant', block: 'start' });
      })();
    `);
    await sleep(800);

    // Career Public View
    await takeScreenshot(client, 'desktop_public_profile_career.png', { width: 1280, height: 950 });

    // Switch Public Profile to Season 2026 Scope
    console.log("  Switching Public Profile to Season 2026 Scope...");
    await client.eval(`
      (function() {
        window.BadgesUI.setPublicScope('seasonal');
        var pPanel = document.getElementById('profile-panel-trophies');
        if (pPanel) pPanel.scrollIntoView({ behavior: 'instant', block: 'start' });
      })();
    `);
    await sleep(600);
    await takeScreenshot(client, 'desktop_public_profile_seasonal.png', { width: 1280, height: 950 });

    // Mobile view of Public Profile Seasonal Showcase
    console.log("  Mobile Pixel 9: Public Profile Seasonal Showcase...");
    await client.eval(`
      (function() {
        var pPanel = document.getElementById('profile-panel-trophies');
        if (pPanel) pPanel.scrollIntoView({ behavior: 'instant', block: 'start' });
      })();
    `);
    await takeScreenshot(client, 'mobile_public_profile_seasonal.png', { width: 412, height: 924, mobile: true });

    console.log("\n✨ ALL VISUAL TESTS & JOURNEYS COMPLETED SUCCESSFULLY!");

  } catch (err) {
    console.error("❌ Visual test error:", err);
    process.exit(1);
  } finally {
    try { chromeProcess.kill('SIGTERM'); } catch (e) {}
  }
}

runVisualTests();
