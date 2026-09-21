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
    '--remote-debugging-port=9249',
    '--user-data-dir=/tmp/chrome_test_finishes_hud_v1',
    '--window-size=1440,900',
    '--hide-scrollbars'
])

try:
    time.sleep(2.0)
    req = urllib.request.Request('http://localhost:9249/json')
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

            # Open Retribution Armory Modal
            cid += 1
            await eval_js(ws, cid, 'window.Armory.openArmoryModal("all")')
            await asyncio.sleep(2.5)

            # 1. Verify Top Right Header shows ONLY the balance button
            header_hud_state = await eval_js(ws, cid, '''
                (() => {
                    const btn = document.querySelector('.armory-wallet-hud');
                    const val = document.getElementById('armory-spendable-balance-val')?.textContent.trim();
                    const sub = document.getElementById('armory-glory-breakdown-sub');
                    const spent = document.getElementById('armory-total-spent-val');
                    return {
                        hasButton: !!btn,
                        balanceText: val,
                        hasBreakdownSub: !!sub,
                        hasSpentStat: !!spent,
                        buttonText: btn ? btn.textContent.replace(/\\s+/g, ' ').trim() : ''
                    };
                })()
            ''')
            print("Armory Header Balance HUD State:", json.dumps(header_hud_state, indent=2))
            assert header_hud_state['hasButton'], "Missing armory wallet balance button!"
            assert header_hud_state['balanceText'] == '390', f"Expected balance '390', got '{header_hud_state['balanceText']}'"
            assert not header_hud_state['hasBreakdownSub'], "Cluttered breakdown sub should be removed from header!"
            assert not header_hud_state['hasSpentStat'], "Cluttered total spent stat should be removed from header!"

            await take_screenshot(ws, cid, 'test_final_desktop_armory_header_clean_balance_hud.png')

            # 2. Click Glory Balance on top right -> verify Glory Points Audit modal opens!
            cid += 1
            await eval_js(ws, cid, '''
                (() => {
                    const hud = document.querySelector('.armory-wallet-hud');
                    if (hud) hud.click();
                })()
            ''')
            await asyncio.sleep(2.0)

            audit_modal_state = await eval_js(ws, cid, '''
                (() => {
                    const modal = document.getElementById('glory-ledger-modal');
                    const title = modal?.querySelector('.armory-header-title')?.textContent.trim() || '';
                    const math = modal?.querySelector('.ledger-math-formula')?.textContent.trim() || '';
                    const records = Array.from(modal?.querySelectorAll('.ledger-record-row') || []);
                    return {
                        isOpen: !!modal,
                        title: title,
                        computationMath: math,
                        recordsCount: records.length
                    };
                })()
            ''')
            print("Glory Points Audit & Balance Reconciliation Modal State:", json.dumps(audit_modal_state, indent=2))
            assert audit_modal_state['isOpen'], "Glory Audit modal did not open on balance click!"
            assert "Glory Points Audit & Balance Reconciliation" in audit_modal_state['title'], "Title mismatch!"
            assert "8,890" in audit_modal_state['computationMath'] and "8,500" in audit_modal_state['computationMath'], "Math mismatch!"
            assert audit_modal_state['recordsCount'] > 0, "No audit records rendered!"

            await take_screenshot(ws, cid, 'test_final_desktop_glory_audit_reconciliation_modal_from_hud.png')

            # Close audit modal
            cid += 1
            await eval_js(ws, cid, '''
                (() => {
                    const m = document.getElementById('glory-ledger-modal');
                    if (m) m.remove();
                })()
            ''')
            await asyncio.sleep(0.5)

            # 3. Check Wings Bar: Card Borders & Card Finishes are separate categories
            wings_state = await eval_js(ws, cid, '''
                (() => {
                    const pills = Array.from(document.querySelectorAll('.armory-wing-pill')).map(p => ({
                        wing: p.getAttribute('data-wing'),
                        text: p.textContent.replace(/\\s+/g, ' ').trim()
                    }));
                    return pills;
                })()
            ''')
            print("Armory Wings Bar Categories:", json.dumps(wings_state, indent=2))
            wing_ids = [w['wing'] for w in wings_state]
            assert 'profile_forge' in wing_ids, "Missing profile_forge (Card Borders)!"
            assert 'card_finishes' in wing_ids, "Missing card_finishes (Card Finishes)!"

            # 4. Switch to Card Finishes wing
            cid += 1
            await eval_js(ws, cid, 'window.Armory.setWingFilter("card_finishes")')
            await asyncio.sleep(2.0)

            finishes_state = await eval_js(ws, cid, '''
                (() => {
                    const cards = Array.from(document.querySelectorAll('.armory-product-card')).map(c => ({
                        id: c.getAttribute('data-item-id'),
                        title: c.querySelector('.armory-product-title')?.textContent.trim(),
                        hasPreview: !!c.querySelector('.armory-finish-preview-tile'),
                        isEquipped: c.classList.contains('is-equipped')
                    }));
                    return {
                        count: cards.length,
                        sample: cards.slice(0, 5),
                        equipped: cards.filter(c => c.isEquipped)
                    };
                })()
            ''')
            print("Card Finishes Wing Products:", json.dumps(finishes_state, indent=2))
            assert finishes_state['count'] >= 30, f"Expected at least 30 finishes for 40K, got {finishes_state['count']}"
            await take_screenshot(ws, cid, 'test_final_desktop_armory_card_finishes_category.png')

            # 5. Purchase & Equip Dark Angels Caliban Emerald Holo-Finish
            cid += 1
            await eval_js(ws, cid, '''
                (async () => {
                    await fetch('/api/armory/set_glory', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({total_glory: 20000})
                    });
                    await window.Armory.loadArmoryData('40k');
                })()
            ''')
            await asyncio.sleep(1.0)
            cid += 1
            await eval_js(ws, cid, 'window.Armory.purchaseItem("finish_40k_dark_angels")')
            await asyncio.sleep(1.0)
            cid += 1
            await eval_js(ws, cid, 'window.Armory.equipItem("active_card_finish", "finish_40k_dark_angels")')
            await asyncio.sleep(1.5)

            # Check My Hub Hero card has both frame and finish
            hero_card_decorations = await eval_js(ws, cid, '''
                (() => {
                    const card = document.querySelector('.profile-hero-card, #my-hub-hero-card');
                    return {
                        classList: card ? Array.from(card.classList) : [],
                        hasHighWarlordBorder: card ? card.classList.contains('frame-peak-high-warlord') : false,
                        hasCalibanFinish: card ? card.classList.contains('finish-caliban-emerald-sheen') : false
                    };
                })()
            ''')
            print("Equipped Hero Card Decorations (Border + Faction Finish):", json.dumps(hero_card_decorations, indent=2))
            assert hero_card_decorations['hasHighWarlordBorder'], "Hero card missing border frame!"
            assert hero_card_decorations['hasCalibanFinish'], "Hero card missing Caliban Emerald finish!"

            # 6. Switch to Backpack wing and verify loadout chips
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
            print("Backpack Loadout Chips after Faction Finish Equip:", json.dumps(backpack_chips, indent=2))
            await take_screenshot(ws, cid, 'test_final_desktop_backpack_equipped_faction_finish.png')

            # -------------------------------------------------------------
            # TEST 2: TABLET VIEWPORT (820 x 1180)
            # -------------------------------------------------------------
            print('\n=== 2. TABLET VIEWPORT TEST (820x1180) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 820, 'height': 1180, 'deviceScaleFactor': 1.5, 'mobile': False
            })
            await asyncio.sleep(1.5)
            await eval_js(ws, cid, 'window.Armory.setWingFilter("card_finishes")')
            await asyncio.sleep(1.5)
            await take_screenshot(ws, cid, 'test_final_tablet_armory_card_finishes.png')

            # -------------------------------------------------------------
            # TEST 3: MOBILE VIEWPORT (390 x 844)
            # -------------------------------------------------------------
            print('\n=== 3. MOBILE VIEWPORT TEST (390x844) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 390, 'height': 844, 'deviceScaleFactor': 3, 'mobile': True
            })
            await asyncio.sleep(1.5)
            await take_screenshot(ws, cid, 'test_final_mobile_armory_card_finishes.png')

            # Click mobile balance button to open audit reconciliation modal on mobile
            cid += 1
            await eval_js(ws, cid, '''
                (() => {
                    const btn = document.querySelector('.armory-wallet-hud');
                    if (btn) btn.click();
                })()
            ''')
            await asyncio.sleep(2.0)
            await take_screenshot(ws, cid, 'test_final_mobile_glory_audit_reconciliation_modal.png')

            print("\n🎉 All automated browser tests for Faction Finishes & Glory Balance Audit HUD completed successfully!")

    asyncio.run(run())

finally:
    chrome_proc.terminate()
    chrome_proc.wait()
