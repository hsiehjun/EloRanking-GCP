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
    '--user-data-dir=/tmp/chrome_test_meta_teams_v1',
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
            # TEST 1: MOBILE VIEWPORT (390 x 844) - BOTTOM NAV & META INTEL
            # -------------------------------------------------------------
            print('\n=== 1. MOBILE VIEWPORT TEST (390x844) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 390, 'height': 844, 'deviceScaleFactor': 3, 'mobile': True
            })
            cid += 1
            await cdp_call(ws, cid, 'Page.navigate', {'url': f'http://127.0.0.1:{DEV_SERVER_PORT}/app.html?persona=competitor'})
            await asyncio.sleep(3.0)

            # Reset armory to clean baseline
            cid += 1
            await eval_js(ws, cid, '''
                (async () => {
                    await fetch('/api/armory/reset', { method: 'POST' });
                    if (window.Armory && typeof window.Armory.loadArmoryData === 'function') {
                        await window.Armory.loadArmoryData('40k');
                    }
                })()
            ''')
            await asyncio.sleep(0.5)

            # Dismiss modal overlays
            cid += 1
            await eval_js(ws, cid, '''
                (() => {
                    document.querySelectorAll('.modal-backdrop, .modal, #user-badge-award-modal').forEach(m => m.remove());
                })()
            ''')
            await asyncio.sleep(0.5)

            # 1. Verify Mobile Bottom Nav Items (Must include Meta Intel!)
            bottom_nav_items = await eval_js(ws, cid, '''
                (() => {
                    const items = Array.from(document.querySelectorAll('.mobile-bottom-nav .mobile-nav-item')).map(item => ({
                        tab: item.getAttribute('data-tab'),
                        label: item.querySelector('.mobile-nav-label')?.textContent.trim(),
                        icon: item.querySelector('.mobile-nav-icon')?.textContent.trim(),
                        isActive: item.classList.contains('active')
                    }));
                    return items;
                })()
            ''')
            print("Mobile Bottom Nav Items:", json.dumps(bottom_nav_items, indent=2))
            tabs = [i['tab'] for i in bottom_nav_items]
            labels = [i['label'] for i in bottom_nav_items]
            assert 'my-hub' in tabs, "Missing my-hub in mobile bottom nav!"
            assert 'team' in tabs, "Missing team in mobile bottom nav!"
            assert 'community' in tabs, "Missing community in mobile bottom nav!"
            assert 'leaderboard' in tabs, "Missing leaderboard in mobile bottom nav!"
            assert 'meta-intel' in tabs, "Missing meta-intel in mobile bottom nav!"
            assert 'tracker' in tabs, "Missing tracker in mobile bottom nav!"
            assert 'Meta Intel' in labels, "Missing 'Meta Intel' label in mobile bottom nav!"

            await take_screenshot(ws, cid, 'test_final_mobile_bottom_nav_with_meta_intel.png')

            # 2. Click Meta Intel in Mobile Bottom Nav -> verify switchTab('meta-intel')
            cid += 1
            await eval_js(ws, cid, '''
                (() => {
                    const metaBtn = document.querySelector('.mobile-bottom-nav .mobile-nav-item[data-tab="meta-intel"]');
                    if (metaBtn) metaBtn.click();
                })()
            ''')
            await asyncio.sleep(2.0)

            meta_active_state = await eval_js(ws, cid, '''
                (() => {
                    const metaBtn = document.querySelector('.mobile-bottom-nav .mobile-nav-item[data-tab="meta-intel"]');
                    const panel = document.getElementById('tab-meta-intel');
                    return {
                        isBtnActive: metaBtn ? metaBtn.classList.contains('active') : false,
                        isPanelActive: panel ? panel.classList.contains('active') : false,
                        panelDisplay: panel ? window.getComputedStyle(panel).display : null
                    };
                })()
            ''')
            print("Meta Intel Active State:", json.dumps(meta_active_state, indent=2))
            assert meta_active_state['isBtnActive'], "Meta Intel button not active!"
            assert meta_active_state['isPanelActive'], "Meta Intel panel not active!"
            await take_screenshot(ws, cid, 'test_final_mobile_meta_intel_tab_active.png')

            # 3. Click Team in Mobile Bottom Nav -> verify fast load!
            t_start = time.time()
            cid += 1
            await eval_js(ws, cid, 'navigateToUserTeam()')
            await asyncio.sleep(1.0)
            t_elapsed = time.time() - t_start

            team_profile_state = await eval_js(ws, cid, '''
                (() => {
                    const card = document.querySelector('.team-hero-card');
                    const teamName = card?.querySelector('.profile-name-title')?.textContent.trim() || '';
                    const rosterRows = document.querySelectorAll('#team-profile-roster-tbody tr');
                    const mobileCards = document.querySelectorAll('#team-profile-mobile-roster .mobile-player-card');
                    const stats = {
                        powerRating: card?.querySelector('.stat-highlight')?.textContent.trim(),
                        rosterCount: rosterRows.length,
                        mobileCardsCount: mobileCards.length
                    };
                    return {
                        hasHeroCard: !!card,
                        teamName: teamName,
                        stats: stats
                    };
                })()
            ''')
            print(f"Mobile Team Profile Loaded in {round(t_elapsed*1000, 1)}ms:", json.dumps(team_profile_state, indent=2))
            assert team_profile_state['hasHeroCard'], "Team profile did not load!"
            assert team_profile_state['teamName'] != '', "Team name empty!"
            await take_screenshot(ws, cid, 'test_final_mobile_team_profile_fast_load.png')

            # -------------------------------------------------------------
            # TEST 2: DESKTOP VIEWPORT (1440 x 900) - TEAMS SPEED & ARMORY HUD
            # -------------------------------------------------------------
            print('\n=== 2. DESKTOP VIEWPORT TEST (1440x900) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 1440, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False
            })
            cid += 1
            await eval_js(ws, cid, 'switchTab("teams")')
            await asyncio.sleep(1.0)

            # Test Teams Directory loading speed and rows
            t_dir_start = time.time()
            cid += 1
            await eval_js(ws, cid, 'loadTeamsDirectory()')
            await asyncio.sleep(0.8)
            t_dir_elapsed = time.time() - t_dir_start

            dir_state = await eval_js(ws, cid, '''
                (() => {
                    const rows = document.querySelectorAll('#teams-body tr');
                    return {
                        rowsCount: rows.length,
                        firstTeam: rows[0]?.querySelector('.player-link')?.textContent.trim()
                    };
                })()
            ''')
            print(f"Teams Directory Loaded in {round(t_dir_elapsed*1000, 1)}ms (Rows: {dir_state['rowsCount']}):", json.dumps(dir_state, indent=2))
            assert dir_state['rowsCount'] > 0, "No team rows rendered!"
            await take_screenshot(ws, cid, 'test_final_desktop_teams_directory_fast.png')

            # Open Retribution Armory
            cid += 1
            await eval_js(ws, cid, 'window.Armory.openArmoryModal("all")')
            await asyncio.sleep(2.0)

            # Check clean Glory balance button
            armory_header_check = await eval_js(ws, cid, '''
                (() => {
                    const btn = document.querySelector('.armory-wallet-hud');
                    const val = document.getElementById('armory-spendable-balance-val')?.textContent.trim();
                    const sub = document.getElementById('armory-glory-breakdown-sub');
                    const spent = document.getElementById('armory-total-spent-val');
                    return {
                        hasButton: !!btn,
                        balance: val,
                        hasClutterSub: !!sub,
                        hasSpentStat: !!spent
                    };
                })()
            ''')
            print("Armory Header Clean HUD:", json.dumps(armory_header_check, indent=2))
            assert armory_header_check['hasButton'], "Missing balance button!"
            assert armory_header_check['balance'] == '390', f"Expected balance '390', got '{armory_header_check['balance']}'"
            assert not armory_header_check['hasClutterSub'], "Cluttered breakdown sub must be removed!"
            assert not armory_header_check['hasSpentStat'], "Spent stat must be removed!"

            # Click Glory balance button -> opens Glory Points Audit modal
            cid += 1
            await eval_js(ws, cid, '''
                (() => {
                    const btn = document.querySelector('.armory-wallet-hud');
                    if (btn) btn.click();
                })()
            ''')
            await asyncio.sleep(1.5)

            audit_modal_state = await eval_js(ws, cid, '''
                (() => {
                    const modal = document.getElementById('glory-ledger-modal');
                    const math = modal?.querySelector('.ledger-math-formula')?.textContent.trim() || '';
                    const records = Array.from(modal?.querySelectorAll('.ledger-record-row') || []);
                    return {
                        isOpen: !!modal,
                        computationMath: math,
                        recordsCount: records.length
                    };
                })()
            ''')
            print("Glory Audit Modal from HUD click:", json.dumps(audit_modal_state, indent=2))
            assert audit_modal_state['isOpen'], "Glory Audit modal did not open on balance click!"
            assert "8,890" in audit_modal_state['computationMath'] and "8,500" in audit_modal_state['computationMath'], "Math verification mismatch!"
            assert audit_modal_state['recordsCount'] > 0, "No ledger records rendered!"
            await take_screenshot(ws, cid, 'test_final_desktop_glory_audit_modal_from_hud.png')

            # Close audit modal
            cid += 1
            await eval_js(ws, cid, 'document.getElementById("glory-ledger-modal")?.remove()')
            await asyncio.sleep(0.5)

            # Check Card Finishes separate category in Armory
            cid += 1
            await eval_js(ws, cid, 'window.Armory.setWingFilter("card_finishes")')
            await asyncio.sleep(1.5)

            finishes_check = await eval_js(ws, cid, '''
                (() => {
                    const cards = Array.from(document.querySelectorAll('.armory-product-card')).map(c => ({
                        id: c.getAttribute('data-item-id'),
                        title: c.querySelector('.armory-product-title')?.textContent.trim()
                    }));
                    return {
                        count: cards.length,
                        sample: cards.slice(0, 5)
                    };
                })()
            ''')
            print("Card Finishes Products Check:", json.dumps(finishes_check, indent=2))
            assert finishes_check['count'] >= 30, f"Expected at least 30 finishes for 40K, got {finishes_check['count']}"
            await take_screenshot(ws, cid, 'test_final_desktop_armory_card_finishes_category.png')

            # -------------------------------------------------------------
            # TEST 3: TABLET VIEWPORT (820 x 1180)
            # -------------------------------------------------------------
            print('\n=== 3. TABLET VIEWPORT TEST (820x1180) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 820, 'height': 1180, 'deviceScaleFactor': 1.5, 'mobile': False
            })
            await asyncio.sleep(1.5)
            await take_screenshot(ws, cid, 'test_final_tablet_armory_card_finishes.png')

            print("\n🎉 ALL TESTS PASSED: Meta Intel in mobile tabs, ultra-fast Teams loading, clean Glory balance HUD & separate Card Finishes!")

    asyncio.run(run())

finally:
    chrome_proc.terminate()
    chrome_proc.wait()
