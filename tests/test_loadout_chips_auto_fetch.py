import subprocess
import time
import urllib.request
import json
import asyncio
import websockets
import base64
import os

ARTIFACT_DIR = '/usr/local/google/home/hsiehjun/.gemini/jetski/brain/a6253a1a-ca8f-4466-9cc6-340c885b9577'
DEV_SERVER_PORT = 5178

chrome_proc = subprocess.Popen([
    '/usr/bin/google-chrome',
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--remote-debugging-port=9246',
    '--user-data-dir=/tmp/chrome_test_loadout_chips_v1',
    '--window-size=1440,900',
    '--hide-scrollbars'
])

try:
    time.sleep(2.0)
    req = urllib.request.Request('http://localhost:9246/json')
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
        print(f"✓ Saved screenshot: {filename} ({len(img_data)} bytes)")

    async def run():
        cid = 1
        async with websockets.connect(ws_url, max_size=25_000_000) as ws:
            cid += 1
            await cdp_call(ws, cid, 'Page.enable')
            cid += 1
            await cdp_call(ws, cid, 'Runtime.enable')

            # -------------------------------------------------------------
            # TEST 1: DESKTOP VIEWPORT (1440 x 900) - Backpack Initial Loadout
            # -------------------------------------------------------------
            print('\n=== 1. DESKTOP VIEWPORT TEST (1440x900) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 1440, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False
            })
            cid += 1
            await cdp_call(ws, cid, 'Page.navigate', {'url': f'http://127.0.0.1:{DEV_SERVER_PORT}/app.html?persona=competitor'})
            await asyncio.sleep(3.0)

            # Dismiss any introductory/honors modal
            cid += 1
            await eval_js(ws, cid, '''
                (() => {
                    document.querySelectorAll('.modal-backdrop, .modal, #user-badge-award-modal').forEach(m => m.remove());
                })()
            ''')
            await asyncio.sleep(0.5)

            # Open Armory directly to backpack wing on initial fresh load
            cid += 1
            await eval_js(ws, cid, 'window.Armory.openArmoryModal("backpack")')
            await asyncio.sleep(2.5)

            # Inspect chips and equipped cards
            backpack_info = await eval_js(ws, cid, '''
                (() => {
                    const chips = Array.from(document.querySelectorAll('.backpack-slot-chip')).map(c => ({
                        text: c.textContent.replace(/\\s+/g, ' ').trim(),
                        isActive: c.classList.contains('is-active')
                    }));
                    const equippedCards = Array.from(document.querySelectorAll('.armory-product-card.is-equipped, .armory-product-card .armory-equipped-indicator')).map(e => {
                        const card = e.closest('.armory-product-card');
                        return {
                            id: card ? card.getAttribute('data-item-id') : null,
                            title: card ? card.querySelector('.armory-product-title')?.textContent.trim() : null
                        };
                    });
                    const title = document.querySelector('.backpack-summary-title')?.textContent.trim();
                    return {
                        backpackTitle: title,
                        chips: chips,
                        equippedCards: equippedCards
                    };
                })()
            ''')
            print("Backpack Loadout on Initial Open:", json.dumps(backpack_info, indent=2))
            await take_screenshot(ws, cid, 'test_final_desktop_backpack_initial_loadout_chips.png')

            # -------------------------------------------------------------
            # TEST 2: TABLET VIEWPORT (820 x 1180)
            # -------------------------------------------------------------
            print('\n=== 2. TABLET VIEWPORT TEST (820x1180) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 820, 'height': 1180, 'deviceScaleFactor': 1.5, 'mobile': False
            })
            await asyncio.sleep(1.5)
            await take_screenshot(ws, cid, 'test_final_tablet_backpack_loadout_chips.png')

            # -------------------------------------------------------------
            # TEST 3: MOBILE VIEWPORT (390 x 844)
            # -------------------------------------------------------------
            print('\n=== 3. MOBILE VIEWPORT TEST (390x844) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 390, 'height': 844, 'deviceScaleFactor': 3, 'mobile': True
            })
            await asyncio.sleep(1.5)
            await take_screenshot(ws, cid, 'test_final_mobile_backpack_loadout_chips.png')

            print("\n✅ Loadout chips verification and screenshots captured!")

    asyncio.run(run())

finally:
    chrome_proc.terminate()
    chrome_proc.wait()
