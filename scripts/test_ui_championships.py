import subprocess
import time
import urllib.request
import json
import asyncio
import websockets
import base64

ARTIFACT_DIR = '/usr/local/google/home/hsiehjun/.gemini/jetski/brain/c237be5b-1b61-4ed4-9716-49956da8d5ea'

chrome_proc = subprocess.Popen([
    '/usr/bin/google-chrome',
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--remote-debugging-port=9232',
    '--user-data-dir=/tmp/chrome_test_champs_isolated_v4',
    '--window-size=1440,900',
    '--hide-scrollbars'
])

try:
    time.sleep(2.0)
    req = urllib.request.Request('http://localhost:9232/json')
    with urllib.request.urlopen(req) as resp:
        tabs = json.loads(resp.read().decode())
    page_tab = next(t for t in tabs if t.get('type') == 'page')
    ws_url = page_tab['webSocketDebuggerUrl']

    async def cdp_call(ws, cid, method, params=None):
        msg = {'id': cid, 'method': method, 'params': params or {}}
        await ws.send(json.dumps(msg))
        while True:
            resp = json.loads(await ws.recv())
            if resp.get('id') == cid:
                return resp.get('result', {})

    async def eval_js(ws, cid, expr):
        res = await cdp_call(ws, cid, 'Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True})
        if 'exceptionDetails' in res:
            print('JS Exception:', res['exceptionDetails'])
        return res.get('result', {}).get('value')

    async def take_screenshot(ws, cid, filename):
        res = await cdp_call(ws, cid, 'Page.captureScreenshot', {'format': 'png'})
        img_data = base64.b64decode(res['data'])
        filepath = f"{ARTIFACT_DIR}/{filename}"
        with open(filepath, 'wb') as f:
            f.write(img_data)
        print(f"✓ Saved screenshot: {filename}")

    async def run():
        cid = 1
        async with websockets.connect(ws_url, max_size=25_000_000) as ws:
            cid += 1
            await cdp_call(ws, cid, 'Page.enable')
            cid += 1
            await cdp_call(ws, cid, 'Runtime.enable')

            # -------------------------------------------------------------
            # TEST 1: DESKTOP VIEWPORT (1440 x 900)
            # -------------------------------------------------------------
            print('=== DESKTOP SCREENSHOT TEST (1440x900) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 1440, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False
            })
            cid += 1
            await cdp_call(ws, cid, 'Page.navigate', {'url': 'http://127.0.0.1:5177/app.html?persona=competitor'})
            await asyncio.sleep(2.0)

            cid += 1
            init_res = await eval_js(ws, cid, """
                (async () => {
                    document.cookie = "dev_persona=competitor; path=/";
                    localStorage.setItem("native_session_token", "dev_token_competitor");
                    localStorage.setItem("elo_auth_token", "dev_token_competitor");
                    localStorage.setItem("ot_badges_celebrated_p_innes", "1");
                    if (typeof initAuth === 'function') await initAuth();
                    if (typeof switchTab === 'function') switchTab('my-hub');
                    if (typeof loadMyHubDashboard === 'function') await loadMyHubDashboard();
                    if (typeof switchHubSubtab === 'function') switchHubSubtab('trophies');
                    
                    // Dismiss celebration commendation modal if open
                    const m = document.getElementById('badges-celebration-modal');
                    if (m) m.remove();
                    
                    const shelf = document.getElementById('hall-of-champions-showcase');
                    const cards = document.querySelectorAll('.champ-trophy-card');
                    const pill = document.querySelector('.champ-laurel-pill');
                    return {
                        user: window.currentUser ? window.currentUser.display_name : null,
                        shelfFound: !!shelf,
                        cardsCount: cards.length,
                        pillFound: !!pill,
                        pillText: pill ? pill.innerText.trim() : null
                    };
                })()
            """)
            print('Desktop Init Status:', init_res)
            await asyncio.sleep(0.5)

            # Center on Trophy Room / Hall of Champions
            cid += 1
            await eval_js(ws, cid, """
                (() => {
                    const shelf = document.getElementById('hall-of-champions-showcase');
                    if (shelf) shelf.scrollIntoView({ behavior: 'instant', block: 'center' });
                })()
            """)
            await asyncio.sleep(0.5)
            cid += 1
            await take_screenshot(ws, cid, 'desktop_hall_of_champions.png')

            # Open Victory Chronicle modal for Major Trophy
            cid += 1
            modal_open = await eval_js(ws, cid, """
                (() => {
                    const card = document.querySelector('.champ-trophy-card.tier-major');
                    if (card) {
                        card.click();
                        return true;
                    }
                    return false;
                })()
            """)
            print('Desktop Modal Clicked:', modal_open)
            await asyncio.sleep(0.6)
            cid += 1
            await take_screenshot(ws, cid, 'desktop_victory_chronicle_modal.png')

            # Close Victory Chronicle modal
            cid += 1
            await eval_js(ws, cid, """
                (() => {
                    if (window.BadgesUI && window.BadgesUI.closeVictoryChronicle) {
                        window.BadgesUI.closeVictoryChronicle();
                    } else {
                        const m = document.getElementById('badges-victory-chronicle-modal');
                        if (m) m.remove();
                    }
                })()
            """)
            await asyncio.sleep(0.4)

            # -------------------------------------------------------------
            # TEST 2: TABLET VIEWPORT (768 x 1024)
            # -------------------------------------------------------------
            print('=== TABLET SCREENSHOT TEST (768x1024) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 768, 'height': 1024, 'deviceScaleFactor': 2, 'mobile': True
            })
            await asyncio.sleep(0.8)
            cid += 1
            await eval_js(ws, cid, """
                (() => {
                    const shelf = document.getElementById('hall-of-champions-showcase');
                    if (shelf) shelf.scrollIntoView({ behavior: 'instant', block: 'center' });
                })()
            """)
            await asyncio.sleep(0.5)
            cid += 1
            await take_screenshot(ws, cid, 'tablet_hall_of_champions.png')

            # -------------------------------------------------------------
            # TEST 3: MOBILE VIEWPORT (375 x 812)
            # -------------------------------------------------------------
            print('=== MOBILE SCREENSHOT TEST (375x812) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 375, 'height': 812, 'deviceScaleFactor': 3, 'mobile': True
            })
            await asyncio.sleep(0.8)
            cid += 1
            await eval_js(ws, cid, """
                (() => {
                    const shelf = document.getElementById('hall-of-champions-showcase');
                    if (shelf) shelf.scrollIntoView({ behavior: 'instant', block: 'center' });
                })()
            """)
            await asyncio.sleep(0.5)
            cid += 1
            await take_screenshot(ws, cid, 'mobile_hall_of_champions.png')

            # Open Victory Chronicle modal on Mobile
            cid += 1
            await eval_js(ws, cid, """
                (() => {
                    const card = document.querySelector('.champ-trophy-card.tier-major');
                    if (card) card.click();
                })()
            """)
            await asyncio.sleep(0.6)
            cid += 1
            await take_screenshot(ws, cid, 'mobile_victory_chronicle.png')

            # Close modal
            cid += 1
            await eval_js(ws, cid, """
                (() => {
                    if (window.BadgesUI && window.BadgesUI.closeVictoryChronicle) {
                        window.BadgesUI.closeVictoryChronicle();
                    } else {
                        const m = document.getElementById('badges-victory-chronicle-modal');
                        if (m) m.remove();
                    }
                })()
            """)
            await asyncio.sleep(0.4)

            # -------------------------------------------------------------
            # TEST 4: OTHER PLAYER PROFILE (0 WINS) STEALTH MODE ON MOBILE
            # -------------------------------------------------------------
            print('=== OTHER PLAYER PROFILE STEALTH MODE (375x812) ===')
            cid += 1
            open_profile_res = await eval_js(ws, cid, """
                (async () => {
                    if (typeof openPlayerProfilePage === 'function') {
                        await openPlayerProfilePage('p_john_doe', '40k', 'John Doe');
                        if (typeof switchProfileSubtab === 'function') switchProfileSubtab('trophies');
                    }
                    const m = document.getElementById('badges-celebration-modal');
                    if (m) m.remove();
                    const shelf = document.querySelector('#tab-player-profile #hall-of-champions-showcase');
                    const isEmpty = shelf ? shelf.classList.contains('is-empty') : false;
                    const pill = document.querySelector('#tab-player-profile .champ-laurel-pill');
                    return {
                        shelfFound: !!shelf,
                        isEmpty: isEmpty,
                        pillFound: !!pill
                    };
                })()
            """)
            print('Stealth Info (0 wins):', open_profile_res)
            await asyncio.sleep(0.8)

            cid += 1
            await eval_js(ws, cid, """
                (() => {
                    const room = document.getElementById('profile-panel-trophies');
                    if (room) room.scrollIntoView({ behavior: 'instant', block: 'start' });
                })()
            """)
            await asyncio.sleep(0.4)
            cid += 1
            await take_screenshot(ws, cid, 'mobile_other_player_stealth_trophies.png')

    asyncio.run(run())
finally:
    chrome_proc.terminate()
