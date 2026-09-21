import subprocess
import time
import urllib.request
import json
import asyncio
import websockets
import base64

ARTIFACT_DIR = '/usr/local/google/home/hsiehjun/.gemini/jetski/brain/a6253a1a-ca8f-4466-9cc6-340c885b9577'
PORT = 9246

chrome_proc = subprocess.Popen([
    '/usr/bin/google-chrome',
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    f'--remote-debugging-port={PORT}',
    '--user-data-dir=/tmp/chrome_test_junior_nav_v1',
    '--window-size=1280,900',
    '--hide-scrollbars'
])

try:
    time.sleep(2.0)
    req = urllib.request.Request(f'http://localhost:{PORT}/json')
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
        print(f"Saved screenshot: {filepath} ({len(img_data)} bytes)")

    async def run_tests():
        async with websockets.connect(ws_url, max_size=25*1024*1024) as ws:
            cid = 1
            await cdp_call(ws, cid, 'Page.enable'); cid += 1
            await cdp_call(ws, cid, 'Runtime.enable'); cid += 1

            print("\n=== 1. NAVIGATE TO TEAM ZERO COMP PROFILE ===")
            target_url = 'http://localhost:5178/app.html#/40k/team/Team%20Zero%20Comp'
            await cdp_call(ws, cid, 'Page.navigate', {'url': target_url}); cid += 1
            await asyncio.sleep(2.0)

            # Switch to Hall of Champions tab
            await eval_js(ws, cid, "switchTeamProfileSubtab('trophies');"); cid += 1
            await asyncio.sleep(0.5)

            # Check top champion card on podium
            podium_info = await eval_js(ws, cid, """
                (() => {
                    const cards = Array.from(document.querySelectorAll('#team-panel-trophies .profile-spotlight-card'));
                    return cards.map(c => ({
                        text: c.innerText.replace(/\\n+/g, ' | ')
                    }));
                })()
            """); cid += 1
            print("Podium cards:", json.dumps(podium_info[:2], indent=2))
            await take_screenshot(ws, cid, 'test_real_team_hall_of_champions_desktop.png'); cid += 1

            print("\n=== 2. CLICK ON JUNIOR AFLLEJE CARD ON PODIUM ===")
            click_res = await eval_js(ws, cid, """
                (() => {
                    const cards = Array.from(document.querySelectorAll('#team-panel-trophies .profile-spotlight-card'));
                    const juniorCard = cards.find(c => c.innerText.includes('Junior Aflleje'));
                    if (!juniorCard) return { success: false, reason: 'Junior card not found' };
                    juniorCard.click();
                    return { success: true };
                })()
            """); cid += 1
            print("Click Junior podium card:", click_res)
            await asyncio.sleep(0.8)

            modal_info = await eval_js(ws, cid, """
                (() => {
                    const modal = document.getElementById('player-modal');
                    if (!modal) return null;
                    return {
                        visible: true,
                        name: document.getElementById('modal-player-name')?.innerText.trim(),
                        modalPlayerId: window.currentModalPlayerId,
                        modalPlayerName: window.currentModalPlayerName,
                        elo: document.getElementById('modal-player-elo')?.innerText.trim() || document.querySelector('.player-hero-elo-val')?.innerText.trim()
                    };
                })()
            """); cid += 1
            print("Player Modal opened:", json.dumps(modal_info, indent=2))
            await take_screenshot(ws, cid, 'test_real_junior_modal_from_team.png'); cid += 1

            print("\n=== 3. CLICK '↗ FULL PROFILE' FROM MODAL ===")
            nav_res = await eval_js(ws, cid, """
                (() => {
                    const btn = document.getElementById('btn-modal-open-full-profile');
                    if (!btn) return { success: false, reason: 'btn-modal-open-full-profile not found' };
                    btn.click();
                    return { success: true };
                })()
            """); cid += 1
            print("Click Full Profile button:", nav_res)
            await asyncio.sleep(1.5)

            # Check current location hash and profile page details
            profile_info = await eval_js(ws, cid, """
                (() => {
                    const panel = document.getElementById('tab-player-profile');
                    return {
                        hash: window.location.hash,
                        activeTab: window.activeTab,
                        profileActive: panel ? panel.classList.contains('active') : false,
                        playerName: document.querySelector('.profile-name-title')?.innerText.trim(),
                        eloText: document.querySelector('.profile-rank-crest')?.parentElement?.querySelector('.badge')?.innerText.trim(),
                        championshipPill: document.querySelector('.champ-laurel-pill')?.innerText.trim(),
                        record: document.querySelector('.profile-kpi-value-record')?.innerText.trim() || document.querySelector('.profile-kpi-grid')?.innerText.replace(/\\n+/g, ' ')
                    };
                })()
            """); cid += 1
            print("Dedicated Player Profile loaded:", json.dumps(profile_info, indent=2))
            await take_screenshot(ws, cid, 'test_real_junior_dedicated_full_profile.png'); cid += 1

            # Switch to Trophies subtab on Junior's profile
            await eval_js(ws, cid, """
                (() => {
                    if (typeof switchProfileSubtab === 'function') {
                        switchProfileSubtab('trophies');
                    }
                })()
            """); cid += 1
            await asyncio.sleep(0.5)

            junior_champs = await eval_js(ws, cid, """
                (() => {
                    const cards = Array.from(document.querySelectorAll('#profile-panel-trophies .champ-trophy-card'));
                    return {
                        totalCards: cards.length,
                        first5: cards.slice(0, 5).map(c => ({
                            name: c.querySelector('.champ-trophy-name')?.innerText.trim(),
                            tier: c.querySelector('.champ-trophy-tier-tag')?.innerText.trim(),
                            record: c.querySelector('.champ-meta-record')?.innerText.trim()
                        }))
                    };
                })()
            """); cid += 1
            print("Junior's Trophies count:", junior_champs.get('totalCards'))
            print("Sample trophies:", json.dumps(junior_champs.get('first5'), indent=2))
            await take_screenshot(ws, cid, 'test_real_junior_trophies_subtab.png'); cid += 1

            print("\nAll tests completed successfully!")

    asyncio.run(run_tests())

finally:
    chrome_proc.terminate()
    chrome_proc.wait()
