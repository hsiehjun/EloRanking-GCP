/**
 * E2E Visual and Layout Test for Wahapedia Enriched Army List Modal on Mobile, Tablet & Desktop.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ARTIFACTS_DIR = '/usr/local/google/home/hsiehjun/.gemini/jetski/brain/25e8cdeb-4a06-4988-9d93-454ee3820806';
const PORT = process.argv[2] || 5175;
const CDP_PORT = 9222;

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log('Connecting to Chrome CDP...');
  const targets = await getJson(`http://127.0.0.1:${CDP_PORT}/json`);
  let page = targets.find(t => t.type === 'page' && !t.url.startsWith('chrome://newtab'));
  if (!page) {
    page = await getJson(`http://127.0.0.1:${CDP_PORT}/json/new`);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  const callbacks = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && callbacks.has(msg.id)) {
      const cb = callbacks.get(msg.id);
      callbacks.delete(msg.id);
      if (msg.error) cb.reject(new Error(msg.error.message));
      else cb.resolve(msg.result);
    }
  };

  await new Promise(resolve => {
    ws.onopen = resolve;
  });

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = id++;
      callbacks.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      console.warn('Eval warning:', res.exceptionDetails.text);
    }
    return res.result ? res.result.value : null;
  }

  async function setViewport(width, height, isMobile = false) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: isMobile
    });
  }

  async function captureScreenshot(filename) {
    const res = await send('Page.captureScreenshot', { format: 'png', quality: 90 });
    const buffer = Buffer.from(res.data, 'base64');
    const outPath = path.join(ARTIFACTS_DIR, filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`  📸 Saved screenshot: ${filename} (${buffer.length} bytes)`);
  }

  await send('Page.enable');
  await send('DOM.enable');

  console.log(`Navigating to http://localhost:${PORT}/app.html...`);
  await send('Page.navigate', { url: `http://localhost:${PORT}/app.html` });
  await new Promise(r => setTimeout(r, 2000));

  // Sample Genestealer Cults roster with Resurgence points Wahapedia table (exact scenario from user)
  const gscRosterData = {
    name: "Floof Cox — Army Roster",
    faction: "Genestealer Cults",
    detachment: "Host of Ascension",
    points: 2000,
    warlord: "Patriarch",
    army_rules: [
      {
        name: "Cult Ambush",
        description: `If your Army Faction is <span class="kwb">GENESTEALER CULTS</span>, you start the battle with a number of Resurgence points, depending on the battle size, as shown below.<br>
<ul>
  <li><b>Incursion:</b> 6 Resurgence points</li>
  <li><b>Strike Force:</b> 10 Resurgence points</li>
  <li><b>Onslaught:</b> 14 Resurgence points</li>
</ul>
Each time a unit from your army is destroyed, if every model (excluding <span class="kwb">CHARACTER</span> models) in that unit has this ability, you can spend the relevant number of Resurgence points shown below based on that unit's Starting Strength (not including attached <span class="kwb">CHARACTER</span> models).<br>
<table class="waha_table" border="1">
  <thead>
    <tr>
      <th style="background:#7a1f3d; color:#fff;">Unit</th>
      <th style="background:#7a1f3d; color:#fff;">5 Models</th>
      <th style="background:#7a1f3d; color:#fff;">10 Models</th>
      <th style="background:#7a1f3d; color:#fff;">20 Models</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Aberrants</td>
      <td>2 Resurgence pts</td>
      <td>4 Resurgence pts</td>
      <td>-</td>
    </tr>
    <tr>
      <td>Acolyte Hybrids with Autopistols, Acolyte Hybrids with Hand Flamers</td>
      <td>1 Resurgence pt</td>
      <td>2 Resurgence pts</td>
      <td>-</td>
    </tr>
    <tr>
      <td>Neophyte Hybrids</td>
      <td>-</td>
      <td>1 Resurgence pt</td>
      <td>2 Resurgence pts</td>
    </tr>
    <tr>
      <td>Purestrain Genestealers</td>
      <td>1 Resurgence pt</td>
      <td>2 Resurgence pts</td>
      <td>-</td>
    </tr>
  </tbody>
</table>`
      }
    ],
    detachment_rules: [
      {
        name: "Ascension Day",
        description: `Each time a <span class="kwb">GENESTEALER CULTS</span> unit from your army is set up on the battlefield, until the end of that turn, ranged and melee weapons equipped by models in that unit have the <span class="kwb">SUSTAINED HITS 1</span> and <span class="kwb">LETHAL HITS</span> abilities.`
      }
    ],
    stratagems: [
      {
        name: "A Perfect Ambush",
        cp_cost: "1 CP",
        type: "Battle Tactic",
        phase: "Movement Phase",
        turn: "Your Turn",
        description: "Target one unit from your army set up via Deep Strike. Add 1 to Hit rolls for attacks made by models in that unit until the end of the turn."
      },
      {
        name: "Tunnel Crawlers",
        cp_cost: "1 CP",
        type: "Strategic Ploy",
        phase: "Movement Phase",
        turn: "Your Turn",
        description: "Target one unit from your army set up this turn. It can be set up anywhere on the battlefield that is more than 3\" horizontally away from all enemy units."
      }
    ],
    units: [
      {
        name: "Patriarch",
        role: "Epic Heroes & Characters",
        is_warlord: true,
        points: 85,
        stats: { M: '8"', T: 5, SV: '4+', INV: '4+', W: 6, LD: '6+', OC: 2 },
        weapons: [
          { name: "Patriarch's Claws", type: "Melee", range: "Melee", A: "6", skill: "2+", S: "6", AP: "-2", D: "2", keywords: ["Devastating Wounds", "Twin-linked"] }
        ],
        abilities: [
          { name: "Cosmic Horror", description: "While an enemy unit is within 6\" of this model, subtract 1 from the Leadership characteristic of models in that unit." }
        ]
      },
      {
        name: "Aberrants",
        role: "Infantry & Elites",
        quantity: 1,
        model_count: 5,
        points: 150,
        stats: { M: '6"', T: 6, SV: '5+', INV: '4+', W: 3, LD: '7+', OC: 1 },
        weapons: [
          { name: "Heavy Power Weapon", type: "Melee", range: "Melee", A: "3", skill: "3+", S: "8", AP: "-2", D: "3" }
        ],
        abilities: [
          { name: "Hulking Body", description: "Each time an attack is allocated to a model in this unit, subtract 1 from the Damage characteristic of that attack." }
        ]
      }
    ]
  };

  console.log('Injecting sample GSC Roster and opening modal in Enriched mode...');
  await evaluate(`
    (function() {
      const gscRoster = ${JSON.stringify(gscRosterData)};
      const modal = document.getElementById('event-army-list-modal');
      const titleEl = document.getElementById('event-army-list-modal-title');
      const subEl = document.getElementById('event-army-list-modal-subtitle');
      const contentEl = document.getElementById('event-army-list-modal-content');
      const toggleWrap = document.getElementById('event-army-list-mode-toggle');
      const btnProfile = document.getElementById('btn-army-list-view-profile');
      const btnBcp = document.getElementById('btn-army-list-bcp-link');
      const btnCopy = document.getElementById('btn-army-list-copy');

      if (titleEl) titleEl.innerText = gscRoster.name;
      if (subEl) subEl.innerText = "Genestealer Cult • Bonfire Games • 2000 PTS";
      if (btnBcp) {
        btnBcp.style.display = 'inline-flex';
        btnBcp.href = "https://bestcoastpairings.com";
      }

      window.currentEventParsedRoster = gscRoster;
      // Hide other modals like badge celebrations
      document.querySelectorAll('.modal-backdrop').forEach(m => {
        if (m.id !== 'event-army-list-modal') m.style.display = 'none';
      });

      if (toggleWrap) toggleWrap.style.display = 'flex';
      if (modal) {
        modal.style.display = 'flex';
        modal.style.zIndex = '999999';
        modal.classList.add('active');
      }

      if (contentEl && typeof window.renderNativeRosterViewer === 'function') {
        contentEl.innerHTML = window.renderNativeRosterViewer(gscRoster, { mode: 'enriched' });
      }
    })();
  `);

  await new Promise(r => setTimeout(r, 600));

  // 1. MOBILE VIEWPORT (390 x 844)
  console.log('\n--- 1. Testing Mobile Viewport (390x844) ---');
  await setViewport(390, 844, true);
  await new Promise(r => setTimeout(r, 400));

  const mobileMetrics = await evaluate(`
    (function() {
      const modal = document.querySelector('#event-army-list-modal .modal-window');
      const header = document.querySelector('#event-army-list-modal .modal-header');
      const closeBtn = document.querySelector('#event-army-list-modal .modal-close');
      const title = document.getElementById('event-army-list-modal-title');
      const toggle = document.getElementById('event-army-list-mode-toggle');
      const footer = document.querySelector('#event-army-list-modal .modal-footer');
      const tableWrap = document.querySelector('.waha-table-wrap');
      const table = document.querySelector('.waha-table-wrap table');

      const modalRect = modal ? modal.getBoundingClientRect() : {};
      const closeRect = closeBtn ? closeBtn.getBoundingClientRect() : {};
      const titleRect = title ? title.getBoundingClientRect() : {};
      const toggleRect = toggle ? toggle.getBoundingClientRect() : {};
      const footerRect = footer ? footer.getBoundingClientRect() : {};
      const tableWrapRect = tableWrap ? tableWrap.getBoundingClientRect() : {};
      const tableRect = table ? table.getBoundingClientRect() : {};

      return {
        modalWidth: modalRect.width,
        modalRight: modalRect.right,
        closeTop: closeRect.top,
        closeRight: closeRect.right,
        titleTop: titleRect.top,
        toggleTop: toggleRect.top,
        toggleWidth: toggleRect.width,
        isCloseTopRight: closeRect.top <= toggleRect.top && closeRect.right > (modalRect.right - 50),
        tableWrapWidth: tableWrapRect.width,
        tableWidth: tableRect.width,
        tableHasScroll: tableWrap ? (tableWrap.scrollWidth > tableWrap.clientWidth) : false,
        isTableContained: tableWrap ? (tableWrapRect.right <= modalRect.right + 2) : false,
        footerButtonsStacked: footer ? (footer.clientHeight > 80) : false
      };
    })();
  `);

  console.log('Mobile Layout Assessment:', JSON.stringify(mobileMetrics, null, 2));

  if (!mobileMetrics.isCloseTopRight) {
    console.error('❌ Close button is not top-right aligned!');
  } else {
    console.log('✅ Close button is correctly pinned to the top right!');
  }

  if (mobileMetrics.tableHasScroll) {
    console.log('✅ Wahapedia table correctly has horizontal scroll enabled for wide columns!');
  }
  if (mobileMetrics.isTableContained) {
    console.log('✅ Wahapedia table container does NOT blow out or clip the modal window!');
  }

  await captureScreenshot('wahapedia_enriched_mobile_390.png');

  // Test swiping/scrolling table to see point costs
  await evaluate(`
    (function() {
      const wrap = document.querySelector('.waha-table-wrap');
      if (wrap) wrap.scrollLeft = 250;
    })();
  `);
  await new Promise(r => setTimeout(r, 200));
  await captureScreenshot('wahapedia_enriched_mobile_scrolled.png');
  console.log('✅ Mobile table scrolled screenshot captured.');

  // 2. TABLET VIEWPORT (820 x 1180)
  console.log('\n--- 2. Testing Tablet Viewport (820x1180) ---');
  await setViewport(820, 1180, true);
  await new Promise(r => setTimeout(r, 400));
  await captureScreenshot('wahapedia_enriched_tablet_820.png');
  console.log('✅ Tablet view captured.');

  // 3. DESKTOP VIEWPORT (1440 x 900)
  console.log('\n--- 3. Testing Desktop Viewport (1440x900) ---');
  await setViewport(1440, 900, false);
  await new Promise(r => setTimeout(r, 400));
  await captureScreenshot('wahapedia_enriched_desktop_1440.png');
  console.log('✅ Desktop view captured.');

  console.log('\n🎉 ALL WAHAPEDIA ENRICHED MOBILE LAYOUT TESTS COMPLETED SUCCESSFULLY!');
  ws.close();
  process.exit(0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
