#!/usr/bin/env python3
"""Automated Browser Test for Reorganized Mobile Community Bars & 2x2 Subtabs Grid.

Validates:
1. Mobile Viewport (390 x 844):
   - Context Bar (Row 1: Location + Radius, Row 2: Full-width Availability Toggle)
   - Zero horizontal scrolling on .comm-header-controls (no clipped dropdowns)
   - Community Subtabs laid out in an intuitive 2x2 Grid:
     * Top-Left: 🎯 Sparring Radar (with player count badge)
     * Top-Right: 🏆 Tournaments & Events
     * Bottom-Left: 🏪 Local Game Stores
     * Bottom-Right: 👑 Local Scene & Rankings
   - All 4 options are simultaneously visible in the mobile viewport with ZERO horizontal scrolling
   - Tapping each subtab switches the view smoothly and applies active state
2. Tablet Viewport (820 x 1180) & Desktop Viewport (1440 x 900):
   - Desktop and tablet retain cohesive presentation
3. High-resolution screenshots saved to artifacts directory for visual analysis.
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
    '--remote-debugging-port=9253',
    '--no-sandbox',
    '--disable-gpu',
    '--user-data-dir=/tmp/chrome_test_mobile_comm_bars',
    '--window-size=390,844',
    '--hide-scrollbars'
])

try:
    time.sleep(2.0)
    req = urllib.request.Request('http://localhost:9253/json')
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
            # TEST 1: MOBILE VIEWPORT (390 x 844) - COMMUNITY TOP BARS
            # -------------------------------------------------------------
            print('\n=== 1. MOBILE VIEWPORT TEST (390x844) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 390, 'height': 844, 'deviceScaleFactor': 3, 'mobile': True
            })
            cid += 1
            await cdp_call(ws, cid, 'Page.navigate', {'url': f'http://127.0.0.1:{DEV_SERVER_PORT}/app.html?persona=competitor'})
            await asyncio.sleep(3.0)

            # Dismiss modal overlays
            cid += 1
            await eval_js(ws, cid, '''
                (() => {
                    document.querySelectorAll('.modal-backdrop, .modal, #user-badge-award-modal').forEach(m => m.remove());
                })()
            ''')
            await asyncio.sleep(0.5)

            # Switch to Community Tab
            cid += 1
            await eval_js(ws, cid, "switchTab('community')")
            await asyncio.sleep(2.0)

            # Check Context Header Controls layout
            header_controls_state = await eval_js(ws, cid, '''
                (() => {
                    const container = document.querySelector('.comm-header-controls');
                    const locBtn = document.querySelector('.comm-location-btn');
                    const radiusBox = document.querySelector('.comm-radius-control-box');
                    const statusBtn = document.getElementById('btn-toggle-lfg');

                    const cRect = container ? container.getBoundingClientRect() : {};
                    const lRect = locBtn ? locBtn.getBoundingClientRect() : {};
                    const rRect = radiusBox ? radiusBox.getBoundingClientRect() : {};
                    const sRect = statusBtn ? statusBtn.getBoundingClientRect() : {};

                    return {
                        hasContainer: !!container,
                        hasLocBtn: !!locBtn,
                        hasRadiusBox: !!radiusBox,
                        hasStatusBtn: !!statusBtn,
                        locText: locBtn ? locBtn.textContent.replace(/\\s+/g, ' ').trim() : '',
                        statusText: statusBtn ? statusBtn.textContent.replace(/\\s+/g, ' ').trim() : '',
                        containerWidth: cRect.width,
                        locWidth: lRect.width,
                        radiusWidth: rRect.width,
                        statusWidth: sRect.width,
                        // Check that status button is on a row below location (greater top coordinate)
                        statusIsBelowLoc: sRect.top > lRect.top,
                        // Verify no horizontal overflow
                        hasHorizontalOverflow: container ? (container.scrollWidth > container.clientWidth + 2) : false
                    };
                })()
            ''')
            print("Community Header Controls State:", json.dumps(header_controls_state, indent=2))
            assert header_controls_state['hasLocBtn'], "Missing location button!"
            assert header_controls_state['hasRadiusBox'], "Missing radius control box!"
            assert header_controls_state['hasStatusBtn'], "Missing status toggle button!"
            assert not header_controls_state['hasHorizontalOverflow'], "Header controls has unwanted horizontal overflow!"
            assert header_controls_state['statusIsBelowLoc'], "Status toggle should sit full-width below location/radius!"

            # Check 2x2 Subtabs Grid Layout
            subtabs_grid_state = await eval_js(ws, cid, '''
                (() => {
                    const subtabsContainer = document.querySelector('.comm-subtabs');
                    const buttons = Array.from(document.querySelectorAll('.comm-subtab-btn')).map(b => {
                        const rect = b.getBoundingClientRect();
                        return {
                            id: b.id,
                            subtab: b.getAttribute('data-subtab'),
                            text: b.textContent.replace(/\\s+/g, ' ').trim(),
                            isActive: b.classList.contains('active'),
                            width: Math.round(rect.width),
                            height: Math.round(rect.height),
                            top: Math.round(rect.top),
                            left: Math.round(rect.left)
                        };
                    });

                    const cStyle = subtabsContainer ? window.getComputedStyle(subtabsContainer) : {};
                    const isGrid = cStyle.display === 'grid';
                    const gridCols = cStyle.gridTemplateColumns;
                    const hasHorizontalOverflow = subtabsContainer ? (subtabsContainer.scrollWidth > subtabsContainer.clientWidth + 2) : false;

                    return {
                        isGrid: isGrid,
                        gridTemplateColumns: gridCols,
                        hasHorizontalOverflow: hasHorizontalOverflow,
                        buttonsCount: buttons.length,
                        buttons: buttons
                    };
                })()
            ''')
            print("Community Subtabs 2x2 Grid State:", json.dumps(subtabs_grid_state, indent=2))
            assert subtabs_grid_state['isGrid'], "Expected .comm-subtabs to be display: grid on mobile!"
            assert not subtabs_grid_state['hasHorizontalOverflow'], "comm-subtabs must have ZERO horizontal scroll on mobile!"
            assert subtabs_grid_state['buttonsCount'] == 4, f"Expected 4 subtab buttons, got {subtabs_grid_state['buttonsCount']}"

            # Verify that buttons 0 and 1 are on Row 1 (same top coordinate), and buttons 2 and 3 are on Row 2
            b = subtabs_grid_state['buttons']
            assert abs(b[0]['top'] - b[1]['top']) <= 4, "Buttons 1 and 2 should be in Row 1!"
            assert abs(b[2]['top'] - b[3]['top']) <= 4, "Buttons 3 and 4 should be in Row 2!"
            assert b[2]['top'] > b[0]['top'] + 30, "Row 2 should be clearly below Row 1!"
            assert "Sparring Radar" in b[0]['text'], "First button should be Sparring Radar!"
            assert "Tournaments" in b[1]['text'], "Second button should be Tournaments & Events!"
            assert "Game Stores" in b[2]['text'], "Third button should be Local Game Stores!"
            assert "Local Scene" in b[3]['text'] or "Leaderboard" in b[3]['text'], "Fourth button should be Local Scene / Leaderboard!"

            await take_screenshot(ws, cid, 'test_final_mobile_community_top_bars_reorganized_radar.png')

            # 2. Test Subtab Switching: Tap '🏆 Tournaments & Events'
            cid += 1
            await eval_js(ws, cid, "switchCommunitySubtab('tournaments')")
            await asyncio.sleep(2.0)
            tournaments_active = await eval_js(ws, cid, "document.getElementById('comm-subtab-btn-tournaments').classList.contains('active')")
            assert tournaments_active, "Tournaments button not active after switch!"
            await take_screenshot(ws, cid, 'test_final_mobile_community_tournaments_view.png')

            # 3. Test Subtab Switching: Tap '🏪 Local Game Stores'
            cid += 1
            await eval_js(ws, cid, "switchCommunitySubtab('stores')")
            await asyncio.sleep(2.0)
            stores_active = await eval_js(ws, cid, "document.getElementById('comm-subtab-btn-stores').classList.contains('active')")
            assert stores_active, "Game Stores button not active after switch!"
            await take_screenshot(ws, cid, 'test_final_mobile_community_stores_map_view.png')

            # 4. Test Subtab Switching: Tap '👑 Local Scene & Rankings'
            cid += 1
            await eval_js(ws, cid, "switchCommunitySubtab('scene')")
            await asyncio.sleep(2.0)
            scene_active = await eval_js(ws, cid, "document.getElementById('comm-subtab-btn-scene').classList.contains('active')")
            assert scene_active, "Local Scene button not active after switch!"
            await take_screenshot(ws, cid, 'test_final_mobile_community_local_scene_view.png')

            # Return to Radar
            cid += 1
            await eval_js(ws, cid, "switchCommunitySubtab('radar')")
            await asyncio.sleep(1.5)

            # -------------------------------------------------------------
            # TEST 2: TABLET VIEWPORT (820 x 1180)
            # -------------------------------------------------------------
            print('\n=== 2. TABLET VIEWPORT TEST (820x1180) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 820, 'height': 1180, 'deviceScaleFactor': 2, 'mobile': True
            })
            await asyncio.sleep(1.5)
            await take_screenshot(ws, cid, 'test_final_tablet_community_top_bars.png')

            # -------------------------------------------------------------
            # TEST 3: DESKTOP VIEWPORT (1440 x 900)
            # -------------------------------------------------------------
            print('\n=== 3. DESKTOP VIEWPORT TEST (1440x900) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 1440, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False
            })
            await asyncio.sleep(1.5)
            desktop_state = await eval_js(ws, cid, '''
                (() => {
                    const subtabsContainer = document.querySelector('.comm-subtabs');
                    const cStyle = subtabsContainer ? window.getComputedStyle(subtabsContainer) : {};
                    return {
                        display: cStyle.display,
                        buttonsCount: document.querySelectorAll('.comm-subtab-btn').length
                    };
                })()
            ''')
            print("Desktop Community Subtabs State:", json.dumps(desktop_state, indent=2))
            assert desktop_state['display'] == 'flex', "Expected flex display on desktop!"
            await take_screenshot(ws, cid, 'test_final_desktop_community_top_bars.png')

            print("\n🎉 ALL TESTS PASSED: Reorganized Mobile Community Bars & 2x2 Subtabs Grid verified with 100% assertions!")

    asyncio.run(run())
finally:
    chrome_proc.terminate()
    chrome_proc.wait()
