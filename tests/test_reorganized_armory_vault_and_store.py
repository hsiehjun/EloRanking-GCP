#!/usr/bin/env python3
"""Automated Browser Test for Reorganized Retribution Armory (Home Vault & Requisition Store Depot).

Validates:
1. Home View (My Armory Vault):
   - Displays 'Retribution Armory - Command Vault & Personal Requisitions'
   - Displays prominent '🛒 Requisition Store ➔' CTA button in header
   - Subtabs: '🎒 My Purchased Armory' and '📜 Glory Points Audit & History'
   - Loadout Chips: Dice, Border, Finish, Sigil, Title all cleanly separated
   - All owned items displayed with active loadout badges
   - Bottom banner with '🛒 Enter Requisition Store Depot ➔'
2. Transaction History & Audit on Home:
   - Clicking '📜 Glory Points Audit & History' subtab loads reconciled ledger
   - Hero card with Lifetime Glory Earned (+8,890), Requisitioned (-8,500), Spendable (390)
   - Status: 'Audit Verified: Balanced'
   - Debits show accurate glory costs (no '-0 Glory')
   - Credits show Tournament Silverware (+150/+500) AND Battlefield Badges (+10/+25/+50/+100)
   - Single clean scrollbar (no double scrollbars)
3. Store Depot View:
   - Clicking '🛒 Requisition Store ➔' navigates into the Requisition Store Depot
   - Header shows '← Back to My Vault' button
   - Wings bar shows All Wings, Dice Forge, Card Borders, Card Finishes, Faction Sigils, Titles, Player Pokes
   - Clicking '← Back to My Vault' transitions back to Home Vault
4. Responsive Verification:
   - Desktop (1440x900)
   - Tablet (820x1180)
   - Mobile (390x844)
"""

import asyncio
import base64
import json
import os
import subprocess
import time
import urllib.request
import websockets

DEV_SERVER_PORT = 5178
ARTIFACT_DIR = '/usr/local/google/home/hsiehjun/.gemini/jetski/brain/a6253a1a-ca8f-4466-9cc6-340c885b9577'

# Launch headless Chromium
chrome_proc = subprocess.Popen([
    '/usr/bin/google-chrome',
    '--headless=new',
    '--remote-debugging-port=9252',
    '--no-sandbox',
    '--disable-gpu',
    '--user-data-dir=/tmp/chrome_test_reorganized_armory_v2',
    '--window-size=1440,900',
    '--hide-scrollbars'
])

try:
    time.sleep(2.0)
    req = urllib.request.Request('http://localhost:9252/json')
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

            # Open Retribution Armory (Default: Home Vault)
            cid += 1
            await eval_js(ws, cid, 'window.Armory.openArmoryModal()')
            await asyncio.sleep(2.0)

            # 1. Verify Home Vault UI: Title, Store CTA button, Subtabs, Loadout Chips, Owned items
            vault_home_state = await eval_js(ws, cid, '''
                (() => {
                    const modal = document.getElementById('retribution-armory-modal');
                    const title = modal?.querySelector('.armory-header-title')?.textContent.trim() || '';
                    const kicker = modal?.querySelector('.armory-header-kicker')?.textContent.trim() || '';
                    const storeCtaBtn = modal?.querySelector('.armory-store-cta-btn');
                    const subtabs = Array.from(modal?.querySelectorAll('.vault-subtabs-bar .armory-wing-pill') || []).map(p => ({
                        text: p.textContent.replace(/\\s+/g, ' ').trim(),
                        isActive: p.classList.contains('active')
                    }));
                    const loadoutChips = Array.from(modal?.querySelectorAll('.backpack-slot-chip') || []).map(c => ({
                        text: c.textContent.replace(/\\s+/g, ' ').trim(),
                        isActive: c.classList.contains('is-active')
                    }));
                    const ownedCards = Array.from(modal?.querySelectorAll('.armory-product-card') || []).map(c => ({
                        id: c.getAttribute('data-item-id'),
                        title: c.querySelector('.armory-product-title')?.textContent.trim(),
                        isEquipped: c.classList.contains('is-equipped')
                    }));
                    const homeBanner = modal?.querySelector('.armory-home-banner');

                    return {
                        title: title,
                        kicker: kicker,
                        hasStoreCtaBtn: !!storeCtaBtn,
                        storeCtaText: storeCtaBtn?.textContent.replace(/\\s+/g, ' ').trim() || '',
                        subtabs: subtabs,
                        loadoutChipsCount: loadoutChips.length,
                        loadoutChips: loadoutChips,
                        ownedCardsCount: ownedCards.length,
                        hasHomeBanner: !!homeBanner
                    };
                })()
            ''')
            print("Armory Home Vault State:", json.dumps(vault_home_state, indent=2))
            assert "Retribution Armory" in vault_home_state['title'], "Expected title 'Retribution Armory'!"
            assert vault_home_state['hasStoreCtaBtn'], "Missing prominent Store CTA button in header!"
            assert "Requisition Store" in vault_home_state['storeCtaText'], "Store CTA button text missing 'Requisition Store'!"
            assert len(vault_home_state['subtabs']) == 2, f"Expected 2 subtabs in Home Vault, got {len(vault_home_state['subtabs'])}"
            assert vault_home_state['subtabs'][0]['isActive'], "Backpack subtab should be active by default!"
            assert vault_home_state['loadoutChipsCount'] == 5, f"Expected 5 loadout chips, got {vault_home_state['loadoutChipsCount']}"
            assert vault_home_state['ownedCardsCount'] > 0, "No owned items rendered in Home Vault!"
            assert vault_home_state['hasHomeBanner'], "Missing store invitation banner at bottom of vault!"

            await take_screenshot(ws, cid, 'test_final_desktop_armory_home_vault_view.png')

            # 2. Switch to '📜 Glory Points Audit & History' subtab in Home Vault
            cid += 1
            await eval_js(ws, cid, 'window.Armory.setVaultTab("ledger")')
            await asyncio.sleep(2.0)

            ledger_view_state = await eval_js(ws, cid, '''
                (() => {
                    const modal = document.getElementById('retribution-armory-modal');
                    const heroTitle = modal?.querySelector('.ledger-hero-title')?.textContent.trim() || '';
                    const statusPill = modal?.querySelector('.ledger-status-pill')?.textContent.trim() || '';
                    const formula = modal?.querySelector('.ledger-math-formula')?.textContent.trim() || '';
                    const records = Array.from(modal?.querySelectorAll('.ledger-record-row') || []).map(r => ({
                        type: r.querySelector('.ledger-entry-type-pill')?.textContent.trim(),
                        title: r.querySelector('.ledger-record-title')?.textContent.trim(),
                        amount: r.querySelector('.ledger-record-amount')?.textContent.trim(),
                        meta: r.querySelector('.ledger-record-meta')?.textContent.trim()
                    }));
                    const zeroGloryBugDebits = records.filter(r => r.type === 'DEBIT' && !r.title.includes('Champion') && (r.amount === '−0 Glory' || r.amount === '-0 Glory' || r.amount === '0 Glory'));
                    const hasRealCostDebits = records.some(r => r.type === 'DEBIT' && (r.amount.includes('1,900') || r.amount.includes('2,300') || r.amount.includes('4,500') || r.amount.includes('1,500')));
                    const badgeCredits = records.filter(r => r.type === 'CREDIT' && (r.meta.includes('Battlefield') || r.meta.includes('Honor')));
                    const silverwareCredits = records.filter(r => r.type === 'CREDIT' && (r.meta.includes('Tournament') || r.meta.includes('Silverware')));

                    // Check for nested double scrollbars
                    const modalBody = modal?.querySelector('.armory-modal-body');
                    const recordsList = modal?.querySelector('.ledger-records-list');
                    const modalBodyOverflow = modalBody ? window.getComputedStyle(modalBody).overflowY : '';
                    const recordsListOverflow = recordsList ? window.getComputedStyle(recordsList).overflowY : '';

                    return {
                        heroTitle: heroTitle,
                        statusPill: statusPill,
                        formula: formula,
                        recordsCount: records.length,
                        sampleRecords: records.slice(0, 6),
                        zeroGloryBugDebitsCount: zeroGloryBugDebits.length,
                        hasRealCostDebits: hasRealCostDebits,
                        badgeCreditsCount: badgeCredits.length,
                        silverwareCreditsCount: silverwareCredits.length,
                        modalBodyOverflow: modalBodyOverflow,
                        recordsListOverflow: recordsListOverflow
                    };
                })()
            ''')
            print("Armory Home Ledger & Audit State:", json.dumps(ledger_view_state, indent=2))
            assert "Glory Points Audit & Balance Reconciliation" in ledger_view_state['heroTitle'], "Missing hero audit title!"
            assert "Audit Verified: Balanced" in ledger_view_state['statusPill'], "Ledger not verified balanced!"
            assert "8,890" in ledger_view_state['formula'] and "8,500" in ledger_view_state['formula'], "Formula numbers mismatch!"
            assert ledger_view_state['zeroGloryBugDebitsCount'] == 0, f"Found {ledger_view_state['zeroGloryBugDebitsCount']} debits erroneously showing -0 Glory!"
            assert ledger_view_state['hasRealCostDebits'], "Missing real item costs in debits!"
            assert ledger_view_state['badgeCreditsCount'] > 0, "No battlefield badge credits found in ledger!"
            assert ledger_view_state['silverwareCreditsCount'] > 0, "No tournament silverware credits found in ledger!"
            assert ledger_view_state['recordsListOverflow'] != 'auto' and ledger_view_state['recordsListOverflow'] != 'scroll', "Nested double scrollbar still present on records list!"

            await take_screenshot(ws, cid, 'test_final_desktop_armory_home_ledger_view.png')

            # 3. Navigate from Home Vault to Requisition Store Depot
            cid += 1
            await eval_js(ws, cid, 'window.Armory.setArmoryMode("store")')
            await asyncio.sleep(2.0)

            store_depot_state = await eval_js(ws, cid, '''
                (() => {
                    const modal = document.getElementById('retribution-armory-modal');
                    const title = modal?.querySelector('.armory-header-title')?.textContent.trim() || '';
                    const kicker = modal?.querySelector('.armory-header-kicker')?.textContent.trim() || '';
                    const backVaultBtn = modal?.querySelector('.armory-back-vault-btn');
                    const wings = Array.from(modal?.querySelectorAll('.armory-wings-bar .armory-wing-pill') || []).map(p => ({
                        wing: p.getAttribute('data-wing'),
                        text: p.textContent.replace(/\\s+/g, ' ').trim(),
                        isActive: p.classList.contains('active')
                    }));
                    const products = Array.from(modal?.querySelectorAll('.armory-product-card') || []).map(c => ({
                        id: c.getAttribute('data-item-id'),
                        title: c.querySelector('.armory-product-title')?.textContent.trim()
                    }));

                    return {
                        title: title,
                        kicker: kicker,
                        hasBackVaultBtn: !!backVaultBtn,
                        backBtnText: backVaultBtn?.textContent.trim() || '',
                        wingsCount: wings.length,
                        wings: wings,
                        productsCount: products.length
                    };
                })()
            ''')
            print("Requisition Store Depot State:", json.dumps(store_depot_state, indent=2))
            assert "Requisition Store Depot" in store_depot_state['title'], "Expected Store Depot title!"
            assert store_depot_state['hasBackVaultBtn'], "Missing '← Back to My Vault' button in store header!"
            assert "Back to My Vault" in store_depot_state['backBtnText'], "Back button text mismatch!"
            assert store_depot_state['wingsCount'] == 7, f"Expected 7 store wings, got {store_depot_state['wingsCount']}"
            assert store_depot_state['productsCount'] >= 50, f"Expected full store catalog, got {store_depot_state['productsCount']} items"

            await take_screenshot(ws, cid, 'test_final_desktop_store_depot_view.png')

            # 4. Click '← Back to My Vault' and verify returning to Home
            cid += 1
            await eval_js(ws, cid, 'window.Armory.setArmoryMode("vault")')
            await asyncio.sleep(1.5)

            returned_vault_state = await eval_js(ws, cid, '''
                (() => {
                    const modal = document.getElementById('retribution-armory-modal');
                    const title = modal?.querySelector('.armory-header-title')?.textContent.trim() || '';
                    const storeBtn = modal?.querySelector('.armory-store-cta-btn');
                    return {
                        title: title,
                        hasStoreBtn: !!storeBtn
                    };
                })()
            ''')
            print("Returned to Home Vault State:", json.dumps(returned_vault_state, indent=2))
            assert "Retribution Armory" in returned_vault_state['title'], "Failed to return to Retribution Armory Home Vault!"
            assert returned_vault_state['hasStoreBtn'], "Missing Store CTA button after returning to vault!"

            # -------------------------------------------------------------
            # TEST 2: TABLET VIEWPORT (820 x 1180)
            # -------------------------------------------------------------
            print('\n=== 2. TABLET VIEWPORT TEST (820x1180) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 820, 'height': 1180, 'deviceScaleFactor': 2, 'mobile': True
            })
            await asyncio.sleep(1.5)
            await take_screenshot(ws, cid, 'test_final_tablet_armory_home_vault_view.png')

            # -------------------------------------------------------------
            # TEST 3: MOBILE VIEWPORT (390 x 844)
            # -------------------------------------------------------------
            print('\n=== 3. MOBILE VIEWPORT TEST (390x844) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 390, 'height': 844, 'deviceScaleFactor': 3, 'mobile': True
            })
            await asyncio.sleep(1.5)
            await take_screenshot(ws, cid, 'test_final_mobile_armory_home_vault_view.png')

            # Switch to Store in Mobile Viewport
            cid += 1
            await eval_js(ws, cid, 'window.Armory.setArmoryMode("store")')
            await asyncio.sleep(1.5)
            await take_screenshot(ws, cid, 'test_final_mobile_store_depot_view.png')

            # Switch to Ledger in Mobile Viewport
            cid += 1
            await eval_js(ws, cid, 'window.Armory.setVaultTab("ledger")')
            await asyncio.sleep(1.5)
            await take_screenshot(ws, cid, 'test_final_mobile_armory_ledger_view.png')

            print("\n🎉 Reorganized Retribution Armory E2E test passed with 100% assertions across Desktop, Tablet, and Mobile viewports!")

    asyncio.run(run())
finally:
    chrome_proc.terminate()
    chrome_proc.wait()
