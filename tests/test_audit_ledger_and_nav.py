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
    '--remote-debugging-port=9244',
    '--user-data-dir=/tmp/chrome_test_audit_ledger_v2',
    '--window-size=1440,900',
    '--hide-scrollbars'
])

try:
    time.sleep(2.0)
    req = urllib.request.Request('http://localhost:9244/json')
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

            # Check Desktop Top Nav button
            desktop_team_btn = await eval_js(ws, cid, '''
                (() => {
                    const btn = document.getElementById('nav-btn-team');
                    return {
                        exists: !!btn,
                        text: btn ? btn.textContent.trim() : null,
                        display: btn ? window.getComputedStyle(btn).display : null,
                        prevSibling: btn && btn.previousElementSibling ? btn.previousElementSibling.textContent.trim() : null,
                        nextSibling: btn && btn.nextElementSibling ? btn.nextElementSibling.textContent.trim() : null
                    };
                })()
            ''')
            print("Desktop Team Nav Button:", json.dumps(desktop_team_btn, indent=2))
            assert desktop_team_btn['exists'], "nav-btn-team does not exist!"
            assert "Team" in desktop_team_btn['text'], "nav-btn-team does not have Team text"
            await take_screenshot(ws, cid, 'test_final_desktop_top_nav_team.png')

            # Navigate to Team Zero Comp profile
            cid += 1
            await eval_js(ws, cid, 'openTeamProfilePage("Team Zero Comp", "40k")')
            await asyncio.sleep(2.5)

            # Switch to Tournament Matches Ledger subtab
            cid += 1
            await eval_js(ws, cid, 'switchTeamProfileSubtab("matches")')
            await asyncio.sleep(2.0)

            # Verify Tournament Battle Ledger subtab count badge & rows loaded
            ledger_info = await eval_js(ws, cid, '''
                (() => {
                    const tabBtn = document.getElementById('team-subtab-btn-matches');
                    const badge = tabBtn ? tabBtn.querySelector('.profile-subtab-count') : null;
                    const rows = document.querySelectorAll('.team-match-row');
                    const header = document.querySelector('.team-matches-ledger-header');
                    return {
                        subtabBadge: badge ? badge.textContent.trim() : null,
                        rowsCount: rows.length,
                        headerTitle: header ? header.querySelector('h3')?.textContent.trim() : null,
                        headerSubtitle: header ? header.querySelector('p')?.textContent.trim() : null
                    };
                })()
            ''')
            print("Team Zero Comp Battle Ledger:", json.dumps(ledger_info, indent=2))
            await take_screenshot(ws, cid, 'test_final_desktop_team_battle_ledger_250_games.png')

            # Now open Retribution Armory modal
            cid += 1
            await eval_js(ws, cid, 'window.Armory.openArmoryModal()')
            await asyncio.sleep(2.0)

            armory_hud_check = await eval_js(ws, cid, '''
                (() => {
                    const hud = document.querySelector('.armory-wallet-hud');
                    const ledgerPill = document.querySelector('.armory-wing-pill[data-wing="ledger"]');
                    const bal = document.getElementById('armory-spendable-balance-val');
                    const spent = document.getElementById('armory-total-spent-val');
                    return {
                        hudExists: !!hud,
                        ledgerPillExists: !!ledgerPill,
                        spendable: bal ? bal.textContent.trim() : null,
                        spent: spent ? spent.textContent.trim() : null
                    };
                })()
            ''')
            print("Armory HUD & Ledger Pill Check:", json.dumps(armory_hud_check, indent=2))
            await take_screenshot(ws, cid, 'test_final_desktop_armory_modal_with_ledger_tab.png')

            # Click Glory Ledger wing tab inside Retribution Armory
            cid += 1
            await eval_js(ws, cid, 'window.Armory.setWingFilter("ledger")')
            await asyncio.sleep(1.5)

            ledger_audit_check = await eval_js(ws, cid, '''
                (() => {
                    const container = document.querySelector('.armory-ledger-container');
                    const metrics = Array.from(document.querySelectorAll('.ledger-metric-box')).map(m => m.textContent.replace(/\\s+/g, ' ').trim());
                    const formula = document.querySelector('.ledger-math-formula');
                    const rows = document.querySelectorAll('.ledger-record-row');
                    const tabs = Array.from(document.querySelectorAll('.ledger-tab-btn')).map(t => t.textContent.trim());
                    return {
                        containerExists: !!container,
                        metrics: metrics,
                        formula: formula ? formula.textContent.replace(/\\s+/g, ' ').trim() : null,
                        rowsRendered: rows.length,
                        tabs: tabs
                    };
                })()
            ''')
            print("Glory Ledger Audit Content:", json.dumps(ledger_audit_check, indent=2))
            await take_screenshot(ws, cid, 'test_final_desktop_glory_ledger_audit_math.png')

            # -------------------------------------------------------------
            # TEST 2: TABLET VIEWPORT (820 x 1180)
            # -------------------------------------------------------------
            print('\n=== 2. TABLET VIEWPORT TEST (820x1180) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 820, 'height': 1180, 'deviceScaleFactor': 1.5, 'mobile': False
            })
            await asyncio.sleep(1.5)
            await take_screenshot(ws, cid, 'test_final_tablet_glory_ledger_audit.png')

            # Close armory modal and inspect team view on tablet
            cid += 1
            await eval_js(ws, cid, 'window.Armory.closeArmoryModal()')
            await asyncio.sleep(1.5)
            await take_screenshot(ws, cid, 'test_final_tablet_team_view.png')

            # -------------------------------------------------------------
            # TEST 3: MOBILE VIEWPORT (390 x 844)
            # -------------------------------------------------------------
            print('\n=== 3. MOBILE VIEWPORT TEST (390x844) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 390, 'height': 844, 'deviceScaleFactor': 3, 'mobile': True
            })
            cid += 1
            await eval_js(ws, cid, '''
                (() => {
                    document.querySelectorAll('.modal-backdrop, .modal, #user-badge-award-modal').forEach(m => m.remove());
                    if (window.switchTab) window.switchTab("hub");
                })()
            ''')
            await asyncio.sleep(1.5)

            # Verify mobile bottom navigation bar order: My Hub -> Team -> Community -> Leaderboard -> Tracker
            mobile_nav_order = await eval_js(ws, cid, '''
                (() => {
                    const items = Array.from(document.querySelectorAll('#mobile-bottom-nav .mobile-nav-item, .mobile-bottom-nav .mobile-nav-item')).map(b => b.textContent.replace(/\\s+/g, ' ').trim());
                    return items;
                })()
            ''')
            print("Mobile Bottom Nav Order:", mobile_nav_order)
            await take_screenshot(ws, cid, 'test_final_mobile_bottom_nav_order.png')

            # Open standalone Glory Ledger modal
            cid += 1
            await eval_js(ws, cid, 'window.Armory.openGloryLedgerModal()')
            await asyncio.sleep(1.5)
            await take_screenshot(ws, cid, 'test_final_mobile_glory_ledger_modal.png')

            # Also test opening Armory modal on mobile and viewing the ledger wing
            cid += 1
            await eval_js(ws, cid, '''
                (() => {
                    const m = document.getElementById('glory-ledger-modal');
                    if (m) m.remove();
                    window.Armory.openArmoryModal('ledger');
                })()
            ''')
            await asyncio.sleep(1.5)
            await take_screenshot(ws, cid, 'test_final_mobile_armory_ledger_tab.png')

            print("\n✅ All automated test steps and screenshot captures completed successfully!")

    asyncio.run(run())

finally:
    chrome_proc.terminate()
    chrome_proc.wait()
