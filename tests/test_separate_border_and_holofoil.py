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
    '--remote-debugging-port=9248',
    '--user-data-dir=/tmp/chrome_test_holofoil_separate_v1',
    '--window-size=1440,900',
    '--hide-scrollbars'
])

try:
    time.sleep(2.0)
    req = urllib.request.Request('http://localhost:9248/json')
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
            # TEST 1: DESKTOP VIEWPORT (1440 x 900)
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

            # Verify Hero Card on My Hub has both border and finish classes!
            hero_classes = await eval_js(ws, cid, '''
                (() => {
                    const card = document.querySelector('.profile-hero-card');
                    return {
                        classList: card ? Array.from(card.classList) : [],
                        hasBorderFrame: card ? card.classList.contains('frame-peak-high-warlord') : false,
                        hasHoloFinish: card ? card.classList.contains('finish-astral-holofoil') : false
                    };
                })()
            ''')
            print("My Hub Hero Card Decorations:", json.dumps(hero_classes, indent=2))
            assert hero_classes['hasBorderFrame'], "Missing frame-peak-high-warlord border!"
            assert hero_classes['hasHoloFinish'], "Missing finish-astral-holofoil finish!"

            # Open Retribution Armory to Profile Forge wing
            cid += 1
            await eval_js(ws, cid, 'window.Armory.openArmoryModal("profile_forge")')
            await asyncio.sleep(2.5)

            # Inspect Profile Forge items: both border and holo-foil can be active loadout!
            profile_forge_state = await eval_js(ws, cid, '''
                (() => {
                    const cards = Array.from(document.querySelectorAll('.armory-product-card')).map(card => ({
                        id: card.getAttribute('data-item-id'),
                        title: card.querySelector('.armory-product-title')?.textContent.trim(),
                        isEquipped: card.classList.contains('is-equipped'),
                        btnText: card.querySelector('.armory-action-btn')?.textContent.replace(/\\s+/g, ' ').trim()
                    }));
                    return cards.filter(c => c.isEquipped);
                })()
            ''')
            print("Profile Forge Active Loadouts (Border + Holo-Foil simultaneous):", json.dumps(profile_forge_state, indent=2))
            await take_screenshot(ws, cid, 'test_final_desktop_armory_profile_forge_separate_border_and_holofoil.png')

            # Switch to Backpack wing
            cid += 1
            await eval_js(ws, cid, 'window.Armory.setWingFilter("backpack")')
            await asyncio.sleep(1.5)

            backpack_chips = await eval_js(ws, cid, '''
                (() => {
                    const chips = Array.from(document.querySelectorAll('.backpack-slot-chip')).map(c => ({
                        text: c.textContent.replace(/\\s+/g, ' ').trim(),
                        isActive: c.classList.contains('is-active')
                    }));
                    return chips;
                })()
            ''')
            print("Backpack Loadout Chips (5 separate slots):", json.dumps(backpack_chips, indent=2))
            await take_screenshot(ws, cid, 'test_final_desktop_backpack_separate_border_and_finish_chips.png')

            # -------------------------------------------------------------
            # TEST 2: TABLET VIEWPORT (820 x 1180)
            # -------------------------------------------------------------
            print('\n=== 2. TABLET VIEWPORT TEST (820x1180) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 820, 'height': 1180, 'deviceScaleFactor': 1.5, 'mobile': False
            })
            await asyncio.sleep(1.5)
            await take_screenshot(ws, cid, 'test_final_tablet_backpack_separate_chips.png')

            # -------------------------------------------------------------
            # TEST 3: MOBILE VIEWPORT (390 x 844)
            # -------------------------------------------------------------
            print('\n=== 3. MOBILE VIEWPORT TEST (390x844) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 390, 'height': 844, 'deviceScaleFactor': 3, 'mobile': True
            })
            await asyncio.sleep(1.5)
            await take_screenshot(ws, cid, 'test_final_mobile_backpack_separate_chips.png')

            print("\n✅ All automated tests for separated Border & Astral Holo-Foil Finish completed successfully!")

    asyncio.run(run())

finally:
    chrome_proc.terminate()
    chrome_proc.wait()
