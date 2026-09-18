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

async function takeScreenshot(client, filename) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false
  });
  await sleep(400);

  const res = await client.send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(res.data, 'base64');
  const destPath = path.join(ARTIFACT_DIR, filename);
  fs.writeFileSync(destPath, buf);
  console.log(`  📸 Saved screenshot: ${filename}`);
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
    console.log("TEST: My Hub Active Match Deduplication & Self-Healing Verification");
    console.log("================================================================================");

    // 1. Navigate to app.html
    await client.send('Page.navigate', { url: `${BASE_URL}/app.html#my-hub` });
    await sleep(2500);

    // 2. Set up authenticated dev persona session
    await client.eval(`
      (async () => {
        document.cookie = 'session_token=dev-auth-token-123; path=/';
        localStorage.setItem('elo_auth_token', 'dev-auth-token-123');
        localStorage.setItem('native_session_token', 'dev-auth-token-123');
        if (typeof initAuth === 'function') await initAuth();
        if (typeof switchTab === 'function') switchTab('my-hub');
        if (typeof loadMyHubDashboard === 'function') await loadMyHubDashboard();
      })()
    `);
    await sleep(2000);

    // 3. Create an active room on the server via API
    const createRoomRes = await client.eval(`
      (async () => {
        const resp = await fetch('/api/tracker/room/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer dev-auth-token-123'
          },
          body: JSON.stringify({
            p1_name: 'Innes Wilson',
            p2_name: 'Player 2',
            game_system: '40k'
          })
        });
        return await resp.json();
      })()
    `);
    console.log("Room Created on Server:", createRoomRes.match_id);
    const roomMatchId = createRoomRes.match_id;

    // 4. Inject ghost ephemeral local state (simulating the bug where g-... was saved with the same players)
    await client.eval(`
      (() => {
        const ghostState = {
          id: 'g-64f36efd-be2a1b',
          match_id: null,
          game: {
            p1Name: 'Innes Wilson',
            p2Name: 'Player 2',
            p1Faction: 'Adeptus Custodes',
            p2Faction: 'Army 2'
          },
          p1: { score: 0 },
          p2: { score: 0 },
          round: 1,
          is_finished: false
        };
        localStorage.setItem('gdm-11e-tracker-state', JSON.stringify(ghostState));
      })()
    `);

    // 5. Trigger My Hub reload to test deduplication
    await client.eval(`loadMyHubDashboard()`);
    await sleep(2000);

    // 6. Verify the rendered card count and IDs
    const verifyBeforeRefresh = await client.eval(`
      (() => {
        const trackerCard = document.querySelector('.hub-card-tracker');
        const matchCards = Array.from(document.querySelectorAll('.hub-card-tracker [style*="box-shadow: 0 4px 15px"]'));
        const cardTexts = matchCards.map(c => c.innerText);
        const hasGhost = cardTexts.some(t => t.includes('g-64f36efd'));
        const hasServerRoom = cardTexts.some(t => t.includes('${roomMatchId}'.replace('WH40K-', '')));

        // Check if ghost state in localStorage was self-healed/purged
        const active40k = JSON.parse(localStorage.getItem('gdm-11e-tracker-state') || '{}');
        const ghostPurgedFromStorage = (active40k.id !== 'g-64f36efd-be2a1b');

        return {
          totalMatchCards: matchCards.length,
          cardTexts,
          hasGhost,
          hasServerRoom,
          ghostPurgedFromStorage
        };
      })()
    `);
    console.log("Verify Before Refresh:", verifyBeforeRefresh);

    if (verifyBeforeRefresh.hasGhost) {
      throw new Error("FAILED: Ghost match g-64f36efd was still rendered in My Hub!");
    }
    if (!verifyBeforeRefresh.hasServerRoom) {
      throw new Error(`FAILED: Authoritative server room ${roomMatchId} was not rendered!`);
    }
    if (!verifyBeforeRefresh.ghostPurgedFromStorage) {
      throw new Error("FAILED: Ghost state was not self-healed/purged from localStorage!");
    }

    console.log("  ✅ SUCCESS Before Refresh: Ghost match was deduplicated and purged from localStorage!");
    await client.eval(`
      (() => {
        if (typeof closeAllModals === 'function') closeAllModals();
        document.querySelectorAll('.modal, .modal-backdrop, #badges-celebration-modal').forEach(m => m.remove());
        document.body.classList.remove('modal-open');
        document.querySelector('.hub-card-tracker')?.scrollIntoView({ behavior: 'instant', block: 'center' });
      })()
    `);
    await sleep(400);
    await takeScreenshot(client, 'screen_my_hub_dedup_before_refresh.png');

    // 7. Refresh My Hub Dashboard again (simulate hitting refresh)
    console.log("--> Testing My Hub refresh...");
    await client.eval(`loadMyHubDashboard()`);
    await sleep(2000);

    const verifyAfterRefresh = await client.eval(`
      (() => {
        const matchCards = Array.from(document.querySelectorAll('.hub-card-tracker [style*="box-shadow: 0 4px 15px"]'));
        const cardTexts = matchCards.map(c => c.innerText);
        const hasGhost = cardTexts.some(t => t.includes('g-64f36efd'));
        const hasServerRoom = cardTexts.some(t => t.includes('${roomMatchId}'.replace('WH40K-', '')));

        return {
          totalMatchCards: matchCards.length,
          cardTexts,
          hasGhost,
          hasServerRoom
        };
      })()
    `);
    console.log("Verify After Refresh:", verifyAfterRefresh);

    if (verifyAfterRefresh.hasGhost) {
      throw new Error("FAILED: Ghost match g-64f36efd reappeared after refresh!");
    }
    if (!verifyAfterRefresh.hasServerRoom) {
      throw new Error(`FAILED: Authoritative server room ${roomMatchId} was missing after refresh!`);
    }

    console.log("  ✅ SUCCESS After Refresh: Authoritative server match remains stable without phantom duplicates!");
    await client.eval(`
      (() => {
        if (typeof closeAllModals === 'function') closeAllModals();
        document.querySelectorAll('.modal, .modal-backdrop, #badges-celebration-modal').forEach(m => m.remove());
        document.body.classList.remove('modal-open');
        document.querySelector('.hub-card-tracker')?.scrollIntoView({ behavior: 'instant', block: 'center' });
      })()
    `);
    await sleep(400);
    await takeScreenshot(client, 'screen_my_hub_dedup_after_refresh.png');

    console.log("================================================================================");
    console.log("🎉 ALL MY HUB ACTIVE MATCH DEDUPLICATION TESTS PASSED WITH 100% SUCCESS!");
    console.log("================================================================================");
  } finally {
    if (chromeProcess) chromeProcess.kill();
  }
}

main().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
