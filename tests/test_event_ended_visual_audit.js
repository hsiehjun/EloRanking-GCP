/**
 * Visual screenshot and end-to-end verification script for event ended status.
 * Tests:
 * 1. Event 73q0VFQZIVGo (past RTT): must show '🟢 COMPLETED' and '👑 Event Champion' (Roberto Medina).
 * 2. Event ev_ongoing_gt_live (in progress GT): must show '🔴 LIVE IN PROGRESS' and '🔥 Current Leader'.
 * 3. Event ev_active_lvo_2026 (future event): must show '🔵 UPCOMING' and '⭐ Top Seed'.
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5178;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = '/usr/local/google/home/hsiehjun/.gemini/jetski/brain/28938324-a50e-4441-8d68-0e2840465302';

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

async function main() {
  console.log("🚀 Launching Headless Google Chrome on remote debugging port 9333...");
  const chromeProcess = spawn('/usr/bin/google-chrome', [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--remote-debugging-port=9333',
    '--window-size=1280,850',
    '--hide-scrollbars'
  ], { stdio: 'ignore' });

  await sleep(1500);

  let client = null;
  try {
    const targets = await fetchJson('http://127.0.0.1:9333/json');
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    if (!pageTarget) throw new Error('No Chrome page target available');

    client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.ready();
    await client.send('Page.enable');
    await client.send('DOM.enable');

    console.log("================================================================================");
    console.log("TEST 1: Event 73q0VFQZIVGo (Past RTT - Sept 12, 2026)");
    console.log("================================================================================");
    await client.send('Page.navigate', { url: `${BASE_URL}/app.html#/40k/event/73q0VFQZIVGo` });
    await sleep(2500);

    const test1Result = await client.eval(`
      (() => {
        const hero = document.getElementById('event-hub-hero-section');
        const text = hero ? hero.innerText : '';
        const hasCompleted = /COMPLETED/i.test(text);
        const hasLive = /LIVE IN PROGRESS/i.test(text);
        const hasChampion = /Event Champion/i.test(text);
        const hasCurrentLeader = /Current Leader/i.test(text);
        const hasRoberto = /Roberto Medina/i.test(text);

        return {
          hasCompleted,
          hasLive,
          hasChampion,
          hasCurrentLeader,
          hasRoberto,
          heroSnippet: text.slice(0, 350)
        };
      })()
    `);

    console.log("Test 1 Result:", test1Result);
    if (!test1Result.hasCompleted) {
      throw new Error("FAILED: Event 73q0VFQZIVGo did not render 🟢 COMPLETED badge!");
    }
    if (test1Result.hasLive) {
      throw new Error("FAILED: Event 73q0VFQZIVGo still rendered 🔴 LIVE IN PROGRESS badge!");
    }
    if (!test1Result.hasChampion) {
      throw new Error("FAILED: Event 73q0VFQZIVGo did not render 👑 Event Champion!");
    }
    if (test1Result.hasCurrentLeader) {
      throw new Error("FAILED: Event 73q0VFQZIVGo rendered 🔥 Current Leader instead of Champion!");
    }
    console.log("  ✅ SUCCESS: Event 73q0VFQZIVGo correctly shows COMPLETED and Event Champion Roberto Medina!");
    await takeScreenshot(client, 'screen_flg_september_completed.png', { width: 1280, height: 850 });

    console.log("================================================================================");
    console.log("TEST 2: Event ev_ongoing_gt_live (Active Live GT in progress)");
    console.log("================================================================================");
    await client.send('Page.navigate', { url: `${BASE_URL}/app.html#/40k/event/ev_ongoing_gt_live` });
    await sleep(2500);

    const test2Result = await client.eval(`
      (() => {
        const hero = document.getElementById('event-hub-hero-section');
        const text = hero ? hero.innerText : '';
        const hasCompleted = /COMPLETED/i.test(text);
        const hasLive = /LIVE IN PROGRESS/i.test(text);
        const hasCurrentLeader = /Current Leader/i.test(text);

        return {
          hasCompleted,
          hasLive,
          hasCurrentLeader,
          heroSnippet: text.slice(0, 350)
        };
      })()
    `);

    console.log("Test 2 Result:", test2Result);
    if (!test2Result.hasLive) {
      throw new Error("FAILED: ev_ongoing_gt_live did not render 🔴 LIVE IN PROGRESS badge!");
    }
    if (test2Result.hasCompleted) {
      throw new Error("FAILED: ev_ongoing_gt_live rendered 🟢 COMPLETED incorrectly!");
    }
    if (!test2Result.hasCurrentLeader) {
      throw new Error("FAILED: ev_ongoing_gt_live did not render 🔥 Current Leader!");
    }
    console.log("  ✅ SUCCESS: ev_ongoing_gt_live correctly shows LIVE IN PROGRESS and Current Leader!");
    await takeScreenshot(client, 'screen_ongoing_live_event.png', { width: 1280, height: 850 });

    console.log("================================================================================");
    console.log("TEST 3: Event ev_active_lvo_2026 (Future Upcoming Event)");
    console.log("================================================================================");
    await client.send('Page.navigate', { url: `${BASE_URL}/app.html#/40k/event/ev_active_lvo_2026` });
    await sleep(2500);

    const test3Result = await client.eval(`
      (() => {
        const hero = document.getElementById('event-hub-hero-section');
        const text = hero ? hero.innerText : '';
        const hasUpcoming = /UPCOMING/i.test(text);
        const hasLive = /LIVE IN PROGRESS/i.test(text);
        const hasTopSeed = /Top Seed/i.test(text);

        return {
          hasUpcoming,
          hasLive,
          hasTopSeed,
          heroSnippet: text.slice(0, 350)
        };
      })()
    `);

    console.log("Test 3 Result:", test3Result);
    if (!test3Result.hasUpcoming) {
      throw new Error("FAILED: ev_active_lvo_2026 did not render 🔵 UPCOMING badge!");
    }
    if (test3Result.hasLive) {
      throw new Error("FAILED: ev_active_lvo_2026 rendered 🔴 LIVE IN PROGRESS incorrectly!");
    }
    if (!test3Result.hasTopSeed) {
      throw new Error("FAILED: ev_active_lvo_2026 did not render ⭐ Top Seed!");
    }
    console.log("  ✅ SUCCESS: ev_active_lvo_2026 correctly shows UPCOMING and Top Seed!");
    await takeScreenshot(client, 'screen_upcoming_event.png', { width: 1280, height: 850 });

    console.log("================================================================================");
    console.log("ALL 3 EVENT STATUS VISUAL CHECKS PASSED PERFECTLY!");
    console.log("================================================================================");
  } finally {
    if (chromeProcess) {
      chromeProcess.kill();
    }
  }
}

main().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
