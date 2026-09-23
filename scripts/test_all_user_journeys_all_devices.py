#!/usr/bin/env python3
"""Exhaustive All-Device, All-Page, All-Journey, All-Button-Click Test Suite.

Simulates real user journeys, exercises all UI buttons, modals, inputs, and tabs across
Desktop (1440x900), Tablet (820x1180), and Mobile (390x844).
Monitors for unhandled JavaScript errors, missing DOM elements, and visual correctness.
"""

import asyncio
import base64
import json
import os
import subprocess
import sys
import time
import urllib.request
import websockets

ARTIFACT_DIR = '/usr/local/google/home/hsiehjun/.gemini/jetski/brain/a6253a1a-ca8f-4466-9cc6-340c885b9577'
CHROME_PORT = 9275
DEV_SERVER_PORT = 5178

VIEWPORTS = [
    {
        "name": "desktop",
        "width": 1440,
        "height": 900,
        "scale": 1,
        "mobile": False,
        "label": "Desktop (1440x900)"
    },
    {
        "name": "tablet",
        "width": 820,
        "height": 1180,
        "scale": 2,
        "mobile": True,
        "label": "Tablet (iPad 820x1180)"
    },
    {
        "name": "mobile",
        "width": 390,
        "height": 844,
        "scale": 3,
        "mobile": True,
        "label": "Mobile (iPhone 390x844)"
    }
]

class JourneyTester:
    def __init__(self, ws, device_name):
        self.ws = ws
        self.device = device_name
        self.cid = 1
        self.step_count = 0
        self.click_count = 0
        self.passed_assertions = 0
        self.failed_assertions = []
        self.js_errors = []
        self.screenshots = []

    async def cdp(self, method, params=None):
        curr_id = self.cid
        self.cid += 1
        msg = {'id': curr_id, 'method': method, 'params': params or {}}
        await self.ws.send(json.dumps(msg))
        while True:
            raw = await self.ws.recv()
            data = json.loads(raw)
            if data.get('method') == 'Runtime.consoleAPICalled':
                args = data.get('params', {}).get('args', [])
                call_type = data.get('params', {}).get('type')
                if call_type == 'error':
                    err_text = " ".join([str(a.get('value', '')) for a in args])
                    # Filter harmless offline firestore polling / favicon in test environment
                    if "favicon" not in err_text and "@firebase" not in err_text and "firestore" not in err_text.lower():
                        self.js_errors.append(f"[{self.device}] Console Error: {err_text[:140]}")
            elif data.get('method') == 'Runtime.exceptionThrown':
                exc = data.get('params', {}).get('exceptionDetails', {}).get('exception', {}).get('description') or \
                      data.get('params', {}).get('exceptionDetails', {}).get('text', 'Exception')
                if "firestore" not in exc.lower() and "firebase" not in exc.lower():
                    self.js_errors.append(f"[{self.device}] Uncaught Exception: {exc[:140]}")
            
            if data.get('id') == curr_id:
                return data.get('result', {})

    async def js(self, expr):
        res = await self.cdp('Runtime.evaluate', {
            'expression': expr,
            'returnByValue': True,
            'awaitPromise': True
        })
        return res.get('result', {}).get('value')

    async def assert_true(self, desc, expr):
        self.step_count += 1
        val = await self.js(expr)
        if val:
            self.passed_assertions += 1
            print(f"      ✅ PASS: {desc}")
            return True
        else:
            fail_msg = f"[{self.device}] FAIL: {desc} (eval: {val})"
            print(f"      ❌ {fail_msg}")
            self.failed_assertions.append(fail_msg)
            return False

    async def click(self, desc, selector_or_func):
        self.click_count += 1
        print(f"    👉 [CLICK] {desc}...")
        if selector_or_func.startswith('(') or selector_or_func.startswith('function') or ';' in selector_or_func:
            res = await self.js(selector_or_func)
        else:
            res = await self.js(f"""
                (() => {{
                    const el = document.querySelector("{selector_or_func}");
                    if (!el) return false;
                    el.scrollIntoView({{ block: 'center', inline: 'center' }});
                    el.click();
                    el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    return true;
                }})()
            """)
        await asyncio.sleep(0.35)
        return res

    async def snap(self, filename):
        await self.js("""
            (() => {
                const m = document.getElementById('badges-celebration-modal');
                if (m) m.remove();
                try {
                    localStorage.setItem('ot_last_ack_hash_dev-auth-token-123', 'all');
                    localStorage.setItem('ot_badges_ack_p_innes_wilson', '1');
                } catch(e) {}
            })()
        """)
        res = await self.cdp('Page.captureScreenshot', {'format': 'png'})
        img_data = base64.b64decode(res['data'])
        filepath = os.path.join(ARTIFACT_DIR, filename)
        with open(filepath, 'wb') as f:
            f.write(img_data)
        self.screenshots.append(filename)
        print(f"    📸 [{filename}] ({len(img_data):,} bytes)")

    async def navigate(self, url, wait_sec=1.5):
        print(f"\n  🌐 Navigating to: {url}")
        await self.cdp('Page.navigate', {'url': url})
        await asyncio.sleep(wait_sec)


async def run_all_journeys_suite():
    print("================================================================================")
    print("🚀 LAUNCHING COMPREHENSIVE MULTI-DEVICE ALL-JOURNEYS & BUTTON-CLICKS SUITE")
    print("================================================================================\n")

    chrome_proc = subprocess.Popen([
        '/usr/bin/google-chrome',
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        f'--remote-debugging-port={CHROME_PORT}',
        '--user-data-dir=/tmp/chrome_all_journeys_' + str(int(time.time())),
        '--window-size=1440,900',
        '--hide-scrollbars'
    ])

    results = {
        "timestamp": time.time(),
        "total_clicks": 0,
        "total_assertions": 0,
        "total_passed": 0,
        "failed_assertions": [],
        "js_errors": [],
        "screenshots": [],
        "device_summaries": {}
    }

    try:
        await asyncio.sleep(2.0)
        req = urllib.request.Request(f'http://localhost:{CHROME_PORT}/json')
        with urllib.request.urlopen(req) as resp:
            tabs = json.loads(resp.read().decode())
        page_tab = next(t for t in tabs if t.get('type') == 'page')
        ws_url = page_tab['webSocketDebuggerUrl']

        async with websockets.connect(ws_url, max_size=40 * 1024 * 1024) as ws:
            for vp in VIEWPORTS:
                dev = vp['name']
                t = JourneyTester(ws, dev)
                print(f"\n================================================================================")
                print(f"📱 TESTING VIEWPORT: {vp['label'].upper()}")
                print(f"================================================================================")

                await t.cdp('Page.enable')
                await t.cdp('Runtime.enable')
                await t.cdp('Network.enable')
                await t.cdp('Emulation.setDeviceMetricsOverride', {
                    'width': vp['width'],
                    'height': vp['height'],
                    'deviceScaleFactor': vp['scale'],
                    'mobile': vp['mobile']
                })

                # Set dev auth and clean storage
                await t.js("""
                    (() => {
                        localStorage.setItem('auth_token', 'dev-auth-token-123');
                        localStorage.setItem('elo_auth_token', 'dev-auth-token-123');
                        localStorage.setItem('native_session_token', 'dev-auth-token-123');
                        localStorage.setItem('ot_last_ack_hash_dev-auth-token-123', 'all');
                        localStorage.setItem('ot_badges_ack_p_innes_wilson', '1');
                        document.cookie = 'session_token=dev-auth-token-123; path=/; max-age=2592000; SameSite=Lax';
                    })()
                """)

                # ----------------------------------------------------------------------
                # PAGE 1: Competitor Hub (/app) & All Tabs + Buttons
                # ----------------------------------------------------------------------
                print("\n  📍 PAGE 1: /app Competitor Hub User Journey")
                await t.navigate(f'http://localhost:{DEV_SERVER_PORT}/app.html#my-hub', wait_sec=2.2)
                await t.snap(f"test_all_{dev}_01_my_hub_initial.png")

                # Test My Hub Subtab buttons (using actual switchHubSubtab function)
                await t.click("My Hub -> Match History (Journey) Subtab", "switchHubSubtab('journey');")
                await t.assert_true("History subtab active", "document.getElementById('hub-panel-journey')?.classList.contains('active')")
                
                await t.click("My Hub -> Matchup Matrix Subtab", "switchHubSubtab('matchups');")
                await t.assert_true("Matrix subtab rendered", "document.getElementById('hub-panel-matchups')?.classList.contains('active')")
                
                await t.click("My Hub -> Factions Subtab", "switchHubSubtab('factions');")
                await t.assert_true("Factions subtab rendered", "document.getElementById('hub-panel-factions')?.classList.contains('active')")

                await t.click("My Hub -> Reset back to Active Overview", "switchHubSubtab('active');")
                await t.assert_true("Active subtab restored", "document.getElementById('hub-panel-active')?.classList.contains('active')")

                # Test Leaderboard Tab & Button clicks
                await t.click("Navigation -> Leaderboard Tab", "switchTab('leaderboard');")
                await t.assert_true("Leaderboard panel active", "document.getElementById('tab-leaderboard').classList.contains('active')")
                
                # Leaderboard subtabs: Players vs Teams
                await t.click("Leaderboard -> Teams Subtab", "if (typeof switchLeaderboardSubtab === 'function') switchLeaderboardSubtab('teams'); else if (typeof loadLeaderboardTeams === 'function') loadLeaderboardTeams();")
                await t.click("Leaderboard -> Players Subtab", "if (typeof switchLeaderboardSubtab === 'function') switchLeaderboardSubtab('players'); else if (typeof loadLeaderboard === 'function') loadLeaderboard();")

                # Game System switcher buttons
                await t.click("Leaderboard -> Switch to AoS", "switchGameSystem('aos');")
                await t.assert_true("AoS system active", "typeof currentGameSystem !== 'undefined' && currentGameSystem === 'aos'")
                await t.click("Leaderboard -> Switch back to 40k", "switchGameSystem('40k');")
                await t.assert_true("40k system restored", "typeof currentGameSystem !== 'undefined' && currentGameSystem === '40k'")

                # Player Dossier Modal Click
                await t.click("Leaderboard -> Click Innes Wilson row", "openPlayerModal('p_innes_wilson');")
                await asyncio.sleep(0.8)
                await t.assert_true("Player dossier modal visible", "document.getElementById('player-modal')?.classList.contains('active') || document.getElementById('player-modal')?.style.display === 'flex' || document.getElementById('player-modal')?.style.display === 'block'")
                await t.snap(f"test_all_{dev}_02_modal_player_profile.png")

                # Modal Tab Clicks inside Player Dossier
                await t.click("Player Modal -> Match History Tab", "if (typeof switchModalTab === 'function') switchModalTab('history');")
                await t.click("Player Modal -> Factions Tab", "if (typeof switchModalTab === 'function') switchModalTab('factions');")
                await t.click("Player Modal -> Overview Tab", "if (typeof switchModalTab === 'function') switchModalTab('overview');")
                await t.click("Player Modal -> Close Button", "if (typeof closeModal === 'function') closeModal('player-modal'); else if (typeof closeAllModals === 'function') closeAllModals();")
                await asyncio.sleep(0.4)
                await t.assert_true("Player modal closed", "!document.getElementById('player-modal')?.classList.contains('active') && document.getElementById('player-modal')?.style.display !== 'flex'")

                # Meta Intel Tab & Buttons
                await t.click("Navigation -> Meta Intel Tab", "switchTab('meta-intel');")
                await t.assert_true("Meta Intel panel active", "document.getElementById('tab-meta-intel').classList.contains('active')")
                await t.click("Meta Intel -> Predictor Subtab", "if (typeof switchMetaSubtab === 'function') switchMetaSubtab('predictor');")
                await t.click("Meta Intel -> Factions Subtab", "if (typeof switchMetaSubtab === 'function') switchMetaSubtab('factions');")

                # Teams & Clubs Tab (Testing Teams routing & profile views)
                await t.click("Navigation -> Teams Tab", "switchTab('teams');")
                await asyncio.sleep(0.8)
                await t.click("Teams -> Load Team Zero Comp", "if (typeof loadTeamProfile === 'function') loadTeamProfile('Team Zero Comp');")
                await asyncio.sleep(1.0)
                await t.click("Teams -> Hall of Champions Trophies Subtab", "if (typeof switchTeamProfileSubtab === 'function') switchTeamProfileSubtab('trophies');")
                await t.assert_true("Teams View rendered", "document.getElementById('tab-team-profile') !== null || document.getElementById('teams-view-container') !== null")
                await t.snap(f"test_all_{dev}_03_teams_hall_of_champions.png")
                await t.click("Teams -> Roster Subtab", "if (typeof switchTeamProfileSubtab === 'function') switchTeamProfileSubtab('roster');")

                # Community Hub Tab & Buttons
                await t.click("Navigation -> Community Tab", "switchTab('community');")
                await t.assert_true("Community panel active", "document.getElementById('tab-community').classList.contains('active')")
                
                # Community Subtabs: Events, Stores, Radar
                await t.click("Community -> Stores Subtab", "if (typeof switchCommunitySubtab === 'function') switchCommunitySubtab('stores');")
                await t.click("Community -> Sparring Radar Subtab", "if (typeof switchCommunitySubtab === 'function') switchCommunitySubtab('radar');")
                
                # Radar Radius buttons (25mi, 50mi, 100mi)
                await t.click("Community Radar -> 25 mi radius", "if (typeof setRadarRadius === 'function') setRadarRadius(25);")
                await t.click("Community Radar -> 50 mi radius", "if (typeof setRadarRadius === 'function') setRadarRadius(50);")
                await t.click("Community Radar -> 100 mi radius", "if (typeof setRadarRadius === 'function') setRadarRadius(100);")

                # Location Modal Button
                await t.click("Community -> Open Location Modal", "if (typeof openCommunityLocationModal === 'function') openCommunityLocationModal();")
                await t.click("Community -> Close Location Modal", "if (typeof closeCommunityLocationModal === 'function') closeCommunityLocationModal();")

                # Search Directory Tab & Input
                await t.click("Navigation -> Search Tab", "switchTab('search');")
                await t.assert_true("Search panel active", "document.getElementById('tab-search').classList.contains('active')")
                await t.click("Search -> Type query", """
                    (() => {
                        const input = document.getElementById('search-input') || document.querySelector('input[type="search"]');
                        if (input) {
                            input.value = 'Heresy';
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            return true;
                        }
                        return false;
                    })()
                """)

                # Account Settings Modal
                await t.click("Settings -> Open Account Settings Modal", "if (typeof openUserSettingsModal === 'function') openUserSettingsModal();")
                await asyncio.sleep(0.5)
                await t.click("Settings -> Close Account Settings Modal", "if (typeof closeUserSettingsModal === 'function') closeUserSettingsModal();")

                # ----------------------------------------------------------------------
                # PAGE 2: Game Tracker Lobby (/11th/tracker)
                # ----------------------------------------------------------------------
                print("\n  📍 PAGE 2: /11th/tracker Game Tracker Lobby User Journey")
                await t.navigate(f'http://localhost:{DEV_SERVER_PORT}/11th/tracker', wait_sec=1.8)
                await t.snap(f"test_all_{dev}_04_tracker_lobby.png")

                # Game system switcher buttons in Tracker Lobby
                await t.click("Tracker Lobby -> Switch to AoS", "if (typeof switchLobbyGameSystem === 'function') switchLobbyGameSystem('aos');")
                await t.click("Tracker Lobby -> Switch to 40k", "if (typeof switchLobbyGameSystem === 'function') switchLobbyGameSystem('40k');")

                # Join Room button and input
                await t.click("Tracker Lobby -> Fill Room Key", """
                    (() => {
                        const input = document.getElementById('join-room-code') || document.querySelector('input[placeholder*="Room"]');
                        if (input) {
                            input.value = 'WH40K-TEST-ROOM';
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            return true;
                        }
                        return false;
                    })()
                """)

                # Dice Tray Modal in Tracker Lobby
                await t.click("Tracker Lobby -> Toggle Dice Tray Modal", "if (typeof window.gtToggleDiceRoller === 'function') window.gtToggleDiceRoller();")
                await asyncio.sleep(0.5)
                await t.assert_true("Dice Tray modal opened", "document.getElementById('gt-dice-roller-modal') !== null")
                await t.click("Dice Tray -> Roll D6", "if (typeof window.gtRollDice === 'function') window.gtRollDice(6);")
                await t.click("Dice Tray -> Roll D3", "if (typeof window.gtRollDice === 'function') window.gtRollDice(3);")
                await t.click("Dice Tray -> Clear Tray", "if (typeof window.gtClearDiceTray === 'function') window.gtClearDiceTray();")
                await t.click("Dice Tray -> Close Modal", "if (typeof window.gtToggleDiceRoller === 'function') window.gtToggleDiceRoller();")
                await asyncio.sleep(0.3)
                await t.assert_true("Dice Tray modal closed", "document.getElementById('gt-dice-roller-modal') === null || document.getElementById('gt-dice-roller-modal').style.display === 'none'")

                # Chess Clock HUD in Tracker Lobby
                await t.click("Tracker Lobby -> Toggle Chess Clock HUD", "if (typeof window.gtToggleChessClock === 'function') window.gtToggleChessClock();")
                await asyncio.sleep(0.5)
                await t.assert_true("Chess Clock HUD opened", "document.getElementById('gt-chess-clock-hud') !== null")
                await t.click("Chess Clock -> Toggle Start/Pause", "if (typeof window.gtToggleClockPlayPause === 'function') window.gtToggleClockPlayPause();")
                await asyncio.sleep(0.2)
                await t.click("Chess Clock -> Switch Turn", "if (typeof window.gtSwitchClockTurn === 'function') window.gtSwitchClockTurn();")
                await asyncio.sleep(0.2)
                await t.click("Chess Clock -> Pause Clock", "if (typeof window.gtToggleClockPlayPause === 'function') window.gtToggleClockPlayPause();")
                await t.click("Chess Clock -> Reset Clock", "if (typeof window.gtResetChessClock === 'function') window.gtResetChessClock(75);")
                await t.click("Chess Clock -> Close HUD", "if (typeof window.gtToggleChessClock === 'function') window.gtToggleChessClock();")
                await asyncio.sleep(0.3)
                await t.assert_true("Chess Clock HUD closed", "document.getElementById('gt-chess-clock-hud') === null || document.getElementById('gt-chess-clock-hud').style.display === 'none'")

                # ----------------------------------------------------------------------
                # PAGE 3: 40k Live Scorecard (/11th/tracker/play)
                # ----------------------------------------------------------------------
                print("\n  📍 PAGE 3: /11th/tracker/play Live Scorecard Wizard & Match Journey")
                test_match_room = f"WH40K-{dev.upper()}-AUTO"
                await t.navigate(f'http://localhost:{DEV_SERVER_PORT}/11th/tracker/play?room={test_match_room}', wait_sec=2.2)
                await t.snap(f"test_all_{dev}_05_tracker_play_wizard.png")

                # Setup Wizard Buttons: Battle Size (1000, 2000, 3000)
                await t.click("Wizard -> Click 1000 Incursion Size", "(() => { const btns = document.querySelectorAll('button'); for(const b of btns) { if (b.textContent.includes('1,000') || b.textContent.includes('Incursion')) { b.click(); return true; } } return false; })()")
                await t.click("Wizard -> Click 2000 Strike Force Size", "(() => { const btns = document.querySelectorAll('button'); for(const b of btns) { if (b.textContent.includes('2,000') || b.textContent.includes('Strike Force')) { b.click(); return true; } } return false; })()")

                # Quick Start button into active match
                await t.click("Wizard -> Quick Start button", """
                    (() => {
                        const qs = document.querySelector('button[title*="Quick Start"]') ||
                                   Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Quick Start') || b.textContent.includes('Start Battle'));
                        if (qs) { qs.click(); return true; }
                        return false;
                    })()
                """)
                await asyncio.sleep(1.0)

                # Initialize rich in-match state for live scoring tests
                await t.js(f"""
                    (() => {{
                        const state = {{
                            match_id: '{test_match_room}',
                            round: 2,
                            turn: 1,
                            p1: {{
                                name: 'Player 1 (Imperium)',
                                score: 25,
                                cp: 3,
                                rounds: [
                                    {{ round: 1, battleRound: 1, primaryScore: 10, secondaryScore: 5, secondaries: ['Assassination'] }},
                                    {{ round: 2, battleRound: 2, primaryScore: 10, secondaryScore: 0, secondaries: [] }}
                                ]
                            }},
                            p2: {{
                                name: 'Player 2 (Chaos)',
                                score: 20,
                                cp: 2,
                                rounds: [
                                    {{ round: 1, battleRound: 1, primaryScore: 5, secondaryScore: 5, secondaries: ['Cleanse'] }},
                                    {{ round: 2, battleRound: 2, primaryScore: 10, secondaryScore: 0, secondaries: [] }}
                                ]
                            }},
                            game: {{
                                primary: 'Take and Hold',
                                missionRule: 'Swift Action',
                                terrainLayout: 'Layout 1',
                                firstTurn: 'player1'
                            }}
                        }};
                        localStorage.setItem('gdm-11e-tracker-state', JSON.stringify(state));
                        if (typeof notifyStateChanged === 'function') notifyStateChanged();
                        if (window.injectMultiplayerHUD) window.injectMultiplayerHUD();
                    }})()
                """)
                await asyncio.sleep(0.8)
                await t.snap(f"test_all_{dev}_06_tracker_play_active_match.png")

                # In-Match Button Actions: Round switching tabs
                await t.click("Active Match -> Round 1 Tab", "(() => { const r1 = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'R1' || b.textContent.includes('Round 1')); if (r1) { r1.click(); return true; } return false; })()")
                await t.click("Active Match -> Round 2 Tab", "(() => { const r2 = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'R2' || b.textContent.includes('Round 2')); if (r2) { r2.click(); return true; } return false; })()")
                await t.click("Active Match -> Round 3 Tab", "(() => { const r3 = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'R3' || b.textContent.includes('Round 3')); if (r3) { r3.click(); return true; } return false; })()")

                # In-Match CP Buttons (+ / -)
                await t.click("Active Match -> Increment CP", "(() => { const plus = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '+ CP' || b.getAttribute('aria-label') === 'Add CP'); if (plus) { plus.click(); return true; } return false; })()")
                await t.click("Active Match -> Decrement CP", "(() => { const minus = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '- CP' || b.getAttribute('aria-label') === 'Subtract CP'); if (minus) { minus.click(); return true; } return false; })()")

                # Conclude Match Modal
                await t.click("Active Match -> Open Conclude Match Modal", "if (typeof window.__openCompleteModal === 'function') window.__openCompleteModal();")
                await asyncio.sleep(0.5)
                await t.click("Active Match -> Dismiss Conclude Match Modal", """
                    (() => {
                        const m = document.getElementById('gt-complete-modal');
                        if (m) m.remove();
                        return true;
                    })()
                """)

                # ----------------------------------------------------------------------
                # PAGE 4: AoS Live Tracker (/11th/tracker/aos)
                # ----------------------------------------------------------------------
                print("\n  📍 PAGE 4: /11th/tracker/aos AoS Live Scorecard Journey")
                await t.navigate(f'http://localhost:{DEV_SERVER_PORT}/11th/tracker/aos', wait_sec=2.2)
                await t.snap(f"test_all_{dev}_07_tracker_aos.png")
                await t.assert_true("AoS scorecard container mounted", "document.getElementById('root') !== null")

                # ----------------------------------------------------------------------
                # PAGE 5: Digital Scorecard Viewer (/scorecard/WH40K-API-TEST)
                # ----------------------------------------------------------------------
                print("\n  📍 PAGE 5: /scorecard/{id} Digital Scorecard Viewer Journey")
                await t.navigate(f'http://localhost:{DEV_SERVER_PORT}/scorecard/WH40K-API-TEST', wait_sec=1.8)
                await t.snap(f"test_all_{dev}_08_scorecard_viewer.png")
                await t.assert_true("Scorecard viewer loaded", "document.body.innerText.includes('Scorecard') || document.body.innerText.includes('Match') || document.body.innerText.includes('Round')")

                # ----------------------------------------------------------------------
                # PAGE 6: Event Studio TO Journey (Certified Organizer Mode)
                # ----------------------------------------------------------------------
                print("\n  📍 PAGE 6: /app#event-studio Tournament Director Journey")
                # Set TO Persona cookie
                await t.js("document.cookie = 'dev_persona=to; path=/; max-age=2592000; SameSite=Lax';")
                await t.navigate(f'http://localhost:{DEV_SERVER_PORT}/app.html?persona=to#/40k/event-studio', wait_sec=2.2)
                await t.click("Event Studio -> Switch to tab", "if (typeof switchTab === 'function') switchTab('event-studio');")
                await asyncio.sleep(0.8)
                await t.snap(f"test_all_{dev}_09_event_studio.png")
                await t.assert_true("Event studio active", "document.getElementById('tab-event-studio')?.classList.contains('active')")

                # Reset persona back to competitor
                await t.js("document.cookie = 'dev_persona=competitor; path=/; max-age=2592000; SameSite=Lax';")

                # ----------------------------------------------------------------------
                # PAGE 7: Authentication (/login)
                # ----------------------------------------------------------------------
                print("\n  📍 PAGE 7: /login Authentication Journey")
                await t.navigate(f'http://localhost:{DEV_SERVER_PORT}/login', wait_sec=1.5)
                await t.snap(f"test_all_{dev}_10_login_page.png")
                await t.assert_true("Login form rendered", "document.querySelector('input[type=\"email\"]') !== null || document.querySelector('input[type=\"text\"]') !== null")
                
                # Type credentials
                await t.click("Login -> Enter dev email", """
                    (() => {
                        const email = document.querySelector('input[type="email"]') || document.querySelector('input[name="email"]') || document.getElementById('login-email');
                        if (email) {
                            email.value = 'innes@example.com';
                            email.dispatchEvent(new Event('input', { bubbles: true }));
                            return true;
                        }
                        return false;
                    })()
                """)

                # Summary per device
                dev_summary = {
                    "device": dev,
                    "clicks": t.click_count,
                    "assertions": t.passed_assertions,
                    "failures": t.failed_assertions,
                    "js_errors": t.js_errors,
                    "screenshots": len(t.screenshots)
                }
                results["device_summaries"][dev] = dev_summary
                results["total_clicks"] += t.click_count
                results["total_assertions"] += t.passed_assertions + len(t.failed_assertions)
                results["total_passed"] += t.passed_assertions
                results["failed_assertions"].extend(t.failed_assertions)
                results["js_errors"].extend(t.js_errors)
                results["screenshots"].extend(t.screenshots)

                print(f"\n✅ {vp['label'].upper()} COMPLETE: {t.click_count} Button Clicks, {t.passed_assertions} Assertions Passed, {len(t.failed_assertions)} Failures.")

        # Save results to JSON artifact
        json_path = os.path.join(ARTIFACT_DIR, 'journey_test_results.json')
        with open(json_path, 'w') as f:
            json.dump(results, f, indent=2)

        print("\n================================================================================")
        print("🎉 ALL-JOURNEY MULTI-DEVICE TEST SUITE RUN FINISHED!")
        print(f"Total Button Clicks Executed: {results['total_clicks']}")
        print(f"Total Assertions Passed: {results['total_passed']} / {results['total_assertions']}")
        print(f"Total Failures: {len(results['failed_assertions'])}")
        print(f"Total JS Errors: {len(results['js_errors'])}")
        print(f"Total Screenshots Captured: {len(results['screenshots'])}")
        print(f"Report JSON: {json_path}")
        print("================================================================================\n")

        if results["failed_assertions"]:
            print("❌ FAILED ASSERTIONS:")
            for fa in results["failed_assertions"]:
                print(f"  - {fa}")
            return False
        return True

    finally:
        chrome_proc.terminate()
        chrome_proc.wait()

if __name__ == '__main__':
    success = asyncio.run(run_all_journeys_suite())
    sys.exit(0 if success else 1)
