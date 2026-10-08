import subprocess
import time
import urllib.request
import json
import asyncio
import websockets
import base64
import os
import socket

ARTIFACT_DIR = '/usr/local/google/home/hsiehjun/.gemini/jetski/brain/a6253a1a-ca8f-4466-9cc6-340c885b9577'
DEV_SERVER_PORT = 5178

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

server_proc = None
if not is_port_in_use(DEV_SERVER_PORT):
    print(f"Starting local server on port {DEV_SERVER_PORT}...")
    server_proc = subprocess.Popen(
        ['python3', 'server.py', '--host', '127.0.0.1', '--port', str(DEV_SERVER_PORT)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    for _ in range(50):
        if is_port_in_use(DEV_SERVER_PORT):
            break
        time.sleep(0.3)

chrome_proc = subprocess.Popen([
    '/usr/bin/google-chrome',
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--remote-debugging-port=9250',
    '--user-data-dir=/tmp/chrome_test_dual_dice_v2',
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

            # Seed auth session & match state before page scripts run so verifySession() stays on /11th/tracker/play
            cid += 1
            await cdp_call(ws, cid, 'Page.addScriptToEvaluateOnNewDocument', {
                'source': '''
                    try {
                        localStorage.setItem('elo_auth_token', 'test_token_dual_dice');
                        localStorage.setItem('native_session_token', 'test_token_dual_dice');
                        localStorage.setItem('native_user_profile', JSON.stringify({
                            id: 1,
                            email: 'commander@omnitactica.com',
                            display_name: 'Commander Lion'
                        }));
                        localStorage.setItem('gdm-11e-tracker-state', JSON.stringify({
                            match_id: 'WH40K-TEST01',
                            round: 2,
                            game: {
                                p1Name: 'Commander Lion',
                                p2Name: 'Kharn the Betrayer',
                                p1Faction: 'Dark Angels',
                                p2Faction: 'World Eaters'
                            },
                            p1: { score: 35, battleReady: true },
                            p2: { score: 30, battleReady: true }
                        }));
                        sessionStorage.setItem('gt_room_handoff', JSON.stringify({
                            matchId: 'WH40K-TEST01',
                            ts: Date.now()
                        }));
                    } catch (e) {}
                '''
            })

            # -------------------------------------------------------------
            # TEST 1: DESKTOP VIEWPORT (1440 x 900) - Dual-Player Dice Roller
            # -------------------------------------------------------------
            print('\n=== 1. DESKTOP VIEWPORT TEST (1440x900) - DUAL-PLAYER DICE ROLLER ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 1440, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False
            })
            cid += 1
            await cdp_call(ws, cid, 'Page.navigate', {'url': f'http://127.0.0.1:{DEV_SERVER_PORT}/11th/tracker/play?match_id=WH40K-TEST01'})
            await asyncio.sleep(2.5)

            # Open dice roller and equip custom Armory skins for Player 1 and Player 2
            cid += 1
            setup_info = await eval_js(ws, cid, '''
                (() => {
                    document.body.classList.add('gt-role-verified');
                    const ov = document.getElementById('gt-loading-overlay');
                    if (ov) ov.classList.add('gt-loading-hidden');

                    window.gtClearDiceHistory();
                    window.gtClearTray(1);
                    window.gtClearTray(2);

                    let m = document.getElementById('gt-dice-roller-modal');
                    if (!m || m.style.display === 'none') {
                        window.gtToggleDiceRoller();
                        m = document.getElementById('gt-dice-roller-modal');
                    }
                    // Set Player 1 skin to Dark Angels Caliban Dice, Player 2 skin to World Eaters Skull-Brass Dice
                    window.gtSetPlayerDiceSkin(1, 'dice_40k_dark_angels');
                    window.gtSetPlayerDiceSkin(2, 'dice_40k_world_eaters');
                    return {
                        modalVisible: Boolean(m && m.style.display !== 'none'),
                        hasP1Card: !!document.getElementById('gt-dice-panel-p1'),
                        hasP2Card: !!document.getElementById('gt-dice-panel-p2'),
                        oldThresholdButtonsCount: document.querySelectorAll('.gt-dice-target-btn').length
                    };
                })()
            ''')
            print("Initial Modal Setup:", json.dumps(setup_info, indent=2))
            assert setup_info['modalVisible'], "Dice modal should be visible!"
            assert setup_info['hasP1Card'] and setup_info['hasP2Card'], "Both Player 1 and Player 2 dice cards must exist!"
            assert setup_info['oldThresholdButtonsCount'] == 0, "Old confusing threshold buttons must be removed!"

            # Test +1, +5, +10, +20, and Clear buttons for Player 1
            cid += 1
            add_clear_test = await eval_js(ws, cid, '''
                (() => {
                    window.gtClearTray(1);
                    const c0 = document.querySelectorAll('#gt-dice-panel-p1 .gt-die-pip').length;
                    window.gtAddDice(1, 1);
                    window.gtAddDice(5, 1);
                    window.gtAddDice(10, 1);
                    const c16 = document.querySelectorAll('#gt-dice-panel-p1 .gt-die-pip').length;
                    window.gtClearTray(1);
                    const afterClear = document.querySelectorAll('#gt-dice-panel-p1 .gt-die-pip').length;
                    window.gtAddDice(20, 1);
                    const c20 = document.querySelectorAll('#gt-dice-panel-p1 .gt-die-pip').length;
                    return { c0, c16, afterClear, c20 };
                })()
            ''')
            print("Add/Clear Tray Test:", json.dumps(add_clear_test, indent=2))
            assert add_clear_test['c16'] == 16, f"Expected 16 dice after +1 +5 +10, got {add_clear_test['c16']}"
            assert add_clear_test['afterClear'] == 0, f"Expected 0 dice after Clear, got {add_clear_test['afterClear']}"
            assert add_clear_test['c20'] == 20, f"Expected 20 dice after +20, got {add_clear_test['c20']}"

            # Roll 20 dice for Player 1 and 15 dice for Player 2
            cid += 1
            await eval_js(ws, cid, '''
                (() => {
                    window.gtExecuteDiceRoll(1, 'all');
                    window.gtClearTray(2);
                    window.gtAddDice(10, 2);
                    window.gtAddDice(5, 2);
                    window.gtExecuteDiceRoll(2, 'all');
                })()
            ''')
            await asyncio.sleep(0.8)

            # Verify initial distribution for Player 1 (20 Rolled) and Player 2 (15 Rolled)
            cid += 1
            dist_initial = await eval_js(ws, cid, '''
                (() => {
                    const p1DistText = document.getElementById('gt-dice-panel-p1').textContent;
                    const p2DistText = document.getElementById('gt-dice-panel-p2').textContent;
                    const d1 = window.computePlayerDiceDistribution(1);
                    const d2 = window.computePlayerDiceDistribution(2);
                    return {
                        p1TotalRolled: d1.totalRolled,
                        p2TotalRolled: d2.totalRolled,
                        p1Has20Rolled: p1DistText.includes('(20 Rolled)'),
                        p2Has15Rolled: p2DistText.includes('(15 Rolled)')
                    };
                })()
            ''')
            print("Initial Distribution Check:", json.dumps(dist_initial, indent=2))
            assert dist_initial['p1TotalRolled'] == 20 and dist_initial['p1Has20Rolled'], "Player 1 distribution should show (20 Rolled) after initial roll of 20!"
            assert dist_initial['p2TotalRolled'] == 15 and dist_initial['p2Has15Rolled'], "Player 2 distribution should show (15 Rolled) after initial roll of 15!"

            # Test face selection (Toggle All, All->Face unselects just that face, individual dice)
            cid += 1
            selection_test = await eval_js(ws, cid, '''
                (() => {
                    // Check that Distribution and Roll History are minimized by default
                    const distBars = document.querySelector('#gt-dice-dist-p1 .gt-dice-dist-bars');
                    const histList = document.getElementById('gt-dice-history-list-p1');
                    const distMinimizedByDefault = distBars && getComputedStyle(distBars).display === 'none';
                    const histMinimizedByDefault = histList && getComputedStyle(histList).display === 'none';

                    // First clear selection, then test gtToggleSelectAll (1st tap -> 20 selected, 2nd tap -> 0 selected)
                    window.gtSelectAll(false, 1);
                    window.gtToggleSelectAll(1);
                    const allSelected = document.querySelectorAll('#gt-dice-panel-p1 .gt-die-pip.selected').length;
                    window.gtToggleSelectAll(1);
                    const noneSelected = document.querySelectorAll('#gt-dice-panel-p1 .gt-die-pip.selected').length;

                    // Test: When All are selected, tapping a face (e.g. the face of the last die in tray) unselects ONLY that face and keeps the rest selected!
                    window.gtToggleSelectAll(1);
                    const tray = window.diceRollerState.p1.tray;
                    const targetFace = tray[tray.length - 1].val;
                    const targetFaceCount = tray.filter(d => d.val === targetFace).length;
                    window.gtToggleSelectFace(targetFace, 1);
                    const afterUnselectOneFace = document.querySelectorAll('#gt-dice-panel-p1 .gt-die-pip.selected').length;
                    const expectedAfterUnselectOneFace = 20 - targetFaceCount;
                    // Tapping that same face again re-selects it back to 20!
                    window.gtToggleSelectFace(targetFace, 1);
                    const afterReselectOneFace = document.querySelectorAll('#gt-dice-panel-p1 .gt-die-pip.selected').length;

                    // Unselect all, then toggle face 1 and face 2
                    window.gtSelectAll(false, 1);
                    window.gtToggleSelectFace(1, 1);
                    window.gtToggleSelectFace(2, 1);
                    const lowSelected = document.querySelectorAll('#gt-dice-panel-p1 .gt-die-pip.selected').length;
                    // Also click the first die in tray to toggle its selection
                    window.gtToggleDieSelection(0, 1);
                    const afterClickFirst = document.querySelectorAll('#gt-dice-panel-p1 .gt-die-pip.selected').length;
                    // Select exactly 4 dice on Player 1 for deterministic reroll math test
                    window.gtSelectAll(false, 1);
                    window.gtToggleDieSelection(0, 1);
                    window.gtToggleDieSelection(1, 1);
                    window.gtToggleDieSelection(2, 1);
                    window.gtToggleDieSelection(3, 1);
                    const exactFourSelected = document.querySelectorAll('#gt-dice-panel-p1 .gt-die-pip.selected').length;

                    // Also select 6 dice on Player 2 so screenshot shows selection states & Roll/Reroll buttons on both players
                    window.gtSelectAll(false, 2);
                    for (let i = 0; i < 6; i++) window.gtToggleDieSelection(i, 2);
                    const p2Selected = document.querySelectorAll('#gt-dice-panel-p2 .gt-die-pip.selected').length;

                    return {
                        distMinimizedByDefault,
                        histMinimizedByDefault,
                        allSelected,
                        noneSelected,
                        afterUnselectOneFace,
                        expectedAfterUnselectOneFace,
                        afterReselectOneFace,
                        lowSelected,
                        afterClickFirst,
                        exactFourSelected,
                        p2Selected
                    };
                })()
            ''')
            print("Selection Controls Test:", json.dumps(selection_test, indent=2))
            assert selection_test['distMinimizedByDefault'], "Dice Distribution should be minimized by default!"
            assert selection_test['histMinimizedByDefault'], "Roll History should be minimized by default!"
            assert selection_test['allSelected'] == 20, "1st tap on All should select all 20 dice!"
            assert selection_test['noneSelected'] == 0, "2nd tap on All should unselect all dice!"
            assert selection_test['afterUnselectOneFace'] == selection_test['expectedAfterUnselectOneFace'], (
                f"Tapping a number when All are selected should unselect only that number! Expected {selection_test['expectedAfterUnselectOneFace']}, got {selection_test['afterUnselectOneFace']}"
            )
            assert selection_test['afterReselectOneFace'] == 20, "Tapping that number again should re-select it back to 20!"
            assert selection_test['exactFourSelected'] == 4, "Clicking 4 dice should select 4 dice!"
            assert selection_test['p2Selected'] == 6, "Clicking 6 dice on P2 should select 6 dice!"

            # Capture Desktop screenshot showing selection states & dual-action Roll Selected / Reroll in Tray buttons
            await take_screenshot(ws, cid, 'test_dice_desktop_dual_selection.png')

            # Now test REROLL in place on Player 1 (rerolling those 4 selected dice) -> Total dice rolled in distribution must become 20 + 4 = 24!
            cid += 1
            await eval_js(ws, cid, '''
                (() => {
                    window.gtExecuteDiceRoll(1, 'reroll_in_place');
                })()
            ''')
            await asyncio.sleep(0.8)

            cid += 1
            reroll_dist_check = await eval_js(ws, cid, '''
                (() => {
                    const p1Card = document.getElementById('gt-dice-panel-p1');
                    const p1Text = p1Card ? p1Card.textContent : '';
                    const trayCount = document.querySelectorAll('#gt-dice-panel-p1 .gt-die-pip').length;
                    const dist = window.computePlayerDiceDistribution(1);
                    return {
                        trayCount,
                        distTotalRolled: dist.totalRolled,
                        has24RolledInDistribution: p1Text.includes('(24 Rolled)'),
                        hasRerollBadgeInHistory: p1Text.includes('Reroll 4D6')
                    };
                })()
            ''')
            print("Reroll Distribution Verification (20 initial + 4 rerolled = 24 dice):", json.dumps(reroll_dist_check, indent=2))
            assert reroll_dist_check['trayCount'] == 20, "Reroll in place should keep all 20 dice in the tray!"
            assert reroll_dist_check['distTotalRolled'] == 24, f"Expected 24 total rolled dice in distribution, got {reroll_dist_check['distTotalRolled']}"
            assert reroll_dist_check['has24RolledInDistribution'], "Rerolling 4 dice after rolling 20 dice must show (24 Rolled) in distribution!"
            assert reroll_dist_check['hasRerollBadgeInHistory'], "Roll history should show Reroll 4D6 badge!"

            # Now test "Roll X Selected" on Player 2 (rolling only the 6 selected dice) -> Total dice rolled becomes 15 + 6 = 21!
            cid += 1
            await eval_js(ws, cid, '''
                (() => {
                    window.gtExecuteDiceRoll(2, 'selected_only');
                })()
            ''')
            await asyncio.sleep(0.8)

            cid += 1
            p2_after_selected_roll = await eval_js(ws, cid, '''
                (() => {
                    const p2Card = document.getElementById('gt-dice-panel-p2');
                    const p2Text = p2Card ? p2Card.textContent : '';
                    const trayCount = document.querySelectorAll('#gt-dice-panel-p2 .gt-die-pip').length;
                    const dist = window.computePlayerDiceDistribution(2);
                    return {
                        trayCount,
                        distTotalRolled: dist.totalRolled,
                        has21RolledInDistribution: p2Text.includes('(21 Rolled)')
                    };
                })()
            ''')
            print("Player 2 Roll Selected Only Verification (15 initial + 6 selected = 21 total):", json.dumps(p2_after_selected_roll, indent=2))
            assert p2_after_selected_roll['trayCount'] == 6, f"Expected 6 dice in tray after rolling 6 selected, got {p2_after_selected_roll['trayCount']}"
            assert p2_after_selected_roll['distTotalRolled'] == 21, f"Expected 21 total rolled dice for P2, got {p2_after_selected_roll['distTotalRolled']}"
            assert p2_after_selected_roll['has21RolledInDistribution'], "Player 2 distribution should show (21 Rolled)!"

            # Capture Desktop screenshot after rerolls & distribution update
            await take_screenshot(ws, cid, 'test_dice_desktop_after_reroll_distribution.png')

            # Test Minimize and Expand on Desktop
            cid += 1
            min_check = await eval_js(ws, cid, '''
                (() => {
                    window.gtMinimizeDiceRoller(true);
                    const m = document.getElementById('gt-dice-roller-modal');
                    const rect = m.getBoundingClientRect();
                    return {
                        isMinimizedClass: m.classList.contains('is-minimized'),
                        height: rect.height,
                        width: rect.width
                    };
                })()
            ''')
            print("Minimized Bar Check:", json.dumps(min_check, indent=2))
            assert min_check['isMinimizedClass'], "Modal should have is-minimized class!"
            assert min_check['height'] < 90, f"Minimized pill should be compact (<90px tall), got {min_check['height']}"
            await take_screenshot(ws, cid, 'test_dice_desktop_minimized.png')

            # Expand back
            cid += 1
            await eval_js(ws, cid, 'window.gtMinimizeDiceRoller(false)')
            await asyncio.sleep(0.4)

            # -------------------------------------------------------------
            # TEST 2: TABLET VIEWPORT (820 x 1180)
            # -------------------------------------------------------------
            print('\n=== 2. TABLET VIEWPORT TEST (820x1180) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 820, 'height': 1180, 'deviceScaleFactor': 1.5, 'mobile': False
            })
            await asyncio.sleep(0.8)
            await take_screenshot(ws, cid, 'test_dice_tablet_dual_view.png')

            # -------------------------------------------------------------
            # TEST 3: MOBILE VIEWPORT (390 x 844)
            # -------------------------------------------------------------
            print('\n=== 3. MOBILE VIEWPORT TEST (390x844) ===')
            cid += 1
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 390, 'height': 844, 'deviceScaleFactor': 3, 'mobile': True
            })
            await asyncio.sleep(0.8)

            # Select a couple of dice on Player 1 so mobile screenshot shows selection bar + dual roll/reroll buttons
            cid += 1
            mobile_p1_info = await eval_js(ws, cid, '''
                (() => {
                    window.gtSwitchDicePlayerTab(1);
                    window.gtSelectAll(false, 1);
                    window.gtToggleDieSelection(0, 1);
                    window.gtToggleDieSelection(1, 1);
                    window.gtToggleDieSelection(2, 1);
                    const m = document.getElementById('gt-dice-roller-modal');
                    const rect = m.getBoundingClientRect();
                    const hdr = m.querySelector('.gt-dice-header');
                    const tray = document.querySelector('#gt-dice-panel-p1 .gt-dice-tray');
                    const trayRect = tray ? tray.getBoundingClientRect() : { height: 0 };
                    return {
                        modalWidth: rect.width,
                        modalHeight: rect.height,
                        headerHiddenOnMobile: hdr ? getComputedStyle(hdr).display === 'none' : true,
                        trayHeight: Math.round(trayRect.height),
                        p1Visible: getComputedStyle(document.getElementById('gt-dice-panel-p1')).display !== 'none',
                        p2Visible: getComputedStyle(document.getElementById('gt-dice-panel-p2')).display !== 'none'
                    };
                })()
            ''')
            print("Mobile Player 1 View Check:", json.dumps(mobile_p1_info, indent=2))
            assert mobile_p1_info['p1Visible'] and not mobile_p1_info['p2Visible'], "On mobile, active tab Player 1 should be visible and Player 2 hidden!"
            assert mobile_p1_info['headerHiddenOnMobile'], "On mobile, top .gt-dice-header should be hidden to maximize screen real estate!"
            assert mobile_p1_info['trayHeight'] > 320, f"On mobile, dice tray should take up large screen real estate (>320px), got {mobile_p1_info['trayHeight']}"
            assert mobile_p1_info['modalHeight'] > 650, f"On mobile, dice roller should take up most of the screen (>650px), got {mobile_p1_info['modalHeight']}"
            await take_screenshot(ws, cid, 'test_dice_mobile_p1_full.png')

            # Switch to Player 2 tab on Mobile
            cid += 1
            mobile_p2_info = await eval_js(ws, cid, '''
                (() => {
                    window.gtSwitchDicePlayerTab(2);
                    return {
                        p1Visible: getComputedStyle(document.getElementById('gt-dice-panel-p1')).display !== 'none',
                        p2Visible: getComputedStyle(document.getElementById('gt-dice-panel-p2')).display !== 'none'
                    };
                })()
            ''')
            print("Mobile Player 2 View Check:", json.dumps(mobile_p2_info, indent=2))
            assert mobile_p2_info['p2Visible'] and not mobile_p2_info['p1Visible'], "On mobile, switching to Player 2 should show Player 2 and hide Player 1!"
            await take_screenshot(ws, cid, 'test_dice_mobile_p2_full.png')

            # Test tapping outside the dice roller closes it
            cid += 1
            outside_close_check = await eval_js(ws, cid, '''
                (() => {
                    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
                    const m = document.getElementById('gt-dice-roller-modal');
                    const closedAfterOutsideTap = !window.diceRollerState.visible && (!m || m.style.display === 'none');
                    // Re-open for minimized screenshot check
                    window.gtToggleDiceRoller();
                    return { closedAfterOutsideTap };
                })()
            ''')
            print("Outside Tap Close Check:", json.dumps(outside_close_check, indent=2))
            assert outside_close_check['closedAfterOutsideTap'], "Tapping outside the dice roller should exit/close it!"

            # Test Minimize on Mobile
            cid += 1
            await eval_js(ws, cid, 'window.gtMinimizeDiceRoller(true)')
            await asyncio.sleep(0.4)
            await take_screenshot(ws, cid, 'test_dice_mobile_minimized.png')

            print("\n✅ All automated tests for Dual-Player Game Tracker Dice Roller passed successfully!")

    asyncio.run(run())

finally:
    chrome_proc.terminate()
    chrome_proc.wait()
    if server_proc:
        server_proc.terminate()
        server_proc.wait()
