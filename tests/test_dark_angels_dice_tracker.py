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
    '--remote-debugging-port=9250',
    '--user-data-dir=/tmp/chrome_test_da_dice_v2',
    '--window-size=1440,900',
    '--hide-scrollbars'
])

try:
    time.sleep(2.0)
    req = urllib.request.Request('http://localhost:9250/json')
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
            # TEST 1: DESKTOP VIEWPORT (1440 x 900) - Game Tracker Dice Tray
            # -------------------------------------------------------------
            print('\n=== 1. DESKTOP VIEWPORT TEST (1440x900) - DARK ANGELS DICE TRAY ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 1440, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False
            })
            cid += 1
            await cdp_call(ws, cid, 'Page.navigate', {'url': f'http://127.0.0.1:{DEV_SERVER_PORT}/11th/tracker/play'})
            await asyncio.sleep(3.0)

            # Equip Dark Angels Caliban Dice in localStorage and open dice tray
            cid += 1
            await eval_js(ws, cid, '''
                (() => {
                    localStorage.setItem('omnitactica_active_dice', 'dice_40k_dark_angels');
                    localStorage.setItem('gt-dice-visible', 'true');
                    if (window.Armory && typeof window.Armory.equipItem === 'function') {
                        window.Armory.equipItem('active_dice', 'dice_40k_dark_angels', true);
                    }
                    if (window.gtToggleDiceRoller) {
                        const m = document.getElementById('gt-dice-roller-modal');
                        if (!m || m.style.display === 'none') {
                            window.gtToggleDiceRoller();
                        }
                    }
                })()
            ''')
            await asyncio.sleep(1.0)

            # Add 20 dice and execute roll
            cid += 1
            await eval_js(ws, cid, '''
                (() => {
                    if (window.gtSetDiceTarget) window.gtSetDiceTarget(4);
                    if (window.gtSetDiceCount) window.gtSetDiceCount(20);
                    if (window.gtExecuteDiceRoll) window.gtExecuteDiceRoll();
                })()
            ''')
            await asyncio.sleep(1.5)

            # Check dice tray elements for Dark Angels skin and 6s
            tray_info = await eval_js(ws, cid, '''
                (() => {
                    const grid = document.querySelector('.gt-dice-grid');
                    const skin = grid ? grid.getAttribute('data-dice-skin') : null;
                    const isCustom = grid ? grid.getAttribute('data-custom-dice') : null;
                    const sigils = document.querySelectorAll('.gt-die-faction-six-sigil');
                    const svgIcons = Array.from(sigils).map(s => {
                        const svg = s.querySelector('svg');
                        return {
                            title: s.getAttribute('title'),
                            hasSvg: !!svg,
                            svgClass: svg ? svg.getAttribute('class') : null,
                            svgViewBox: svg ? svg.getAttribute('viewBox') : null
                        };
                    });
                    const crits = document.querySelectorAll('.gt-die-crit');
                    return {
                        gridSkin: skin,
                        isCustomDice: isCustom,
                        critsCount: crits.length,
                        sigilsCount: sigils.length,
                        svgIcons: svgIcons
                    };
                })()
            ''')
            print("Dice Tray Dark Angels Verification:", json.dumps(tray_info, indent=2))
            assert tray_info['gridSkin'] == 'dice_40k_dark_angels', f"Expected dice_40k_dark_angels, got {tray_info['gridSkin']}"
            assert tray_info['sigilsCount'] > 0, "No 6th-face sigils found on critical 6s!"
            assert "Winged Sword" in tray_info['svgIcons'][0]['title'], "Sigil title does not mention Winged Sword!"
            await take_screenshot(ws, cid, 'test_final_desktop_dark_angels_dice_tracker_winged_sword_6s.png')

            # -------------------------------------------------------------
            # TEST 2: TABLET VIEWPORT (820 x 1180)
            # -------------------------------------------------------------
            print('\n=== 2. TABLET VIEWPORT TEST (820x1180) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 820, 'height': 1180, 'deviceScaleFactor': 1.5, 'mobile': False
            })
            await asyncio.sleep(1.5)
            await take_screenshot(ws, cid, 'test_final_tablet_dark_angels_dice_tracker_winged_sword_6s.png')

            # -------------------------------------------------------------
            # TEST 3: MOBILE VIEWPORT (390 x 844)
            # -------------------------------------------------------------
            print('\n=== 3. MOBILE VIEWPORT TEST (390x844) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 390, 'height': 844, 'deviceScaleFactor': 3, 'mobile': True
            })
            await asyncio.sleep(1.5)
            await take_screenshot(ws, cid, 'test_final_mobile_dark_angels_dice_tracker_winged_sword_6s.png')

            print("\n✅ All automated tests for Dark Angels Caliban Dice and Winged Sword 6s passed successfully!")

    asyncio.run(run())

finally:
    chrome_proc.terminate()
    chrome_proc.wait()
