import subprocess
import time
import urllib.request
import json
import asyncio
import websockets
import base64
import os

ARTIFACT_DIR = '/usr/local/google/home/hsiehjun/.gemini/jetski/brain/a6253a1a-ca8f-4466-9cc6-340c885b9577'
PORT = 9245

chrome_proc = subprocess.Popen([
    '/usr/bin/google-chrome',
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    f'--remote-debugging-port={PORT}',
    '--user-data-dir=/tmp/chrome_test_team_champs_v1',
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

            print("\n=== 1. DESKTOP TEST: TEAM ZERO COMP PROFILE ===")
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 1280, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False
            }); cid += 1

            target_url = 'http://localhost:5178/app.html#/40k/team/Team%20Zero%20Comp'
            await cdp_call(ws, cid, 'Page.navigate', {'url': target_url}); cid += 1
            await asyncio.sleep(2.0)

            # Check if team profile page loaded
            team_info = await eval_js(ws, cid, """
                (() => {
                    const title = document.querySelector('.profile-name-title');
                    const tabs = Array.from(document.querySelectorAll('.team-profile-subtabs-bar .profile-subtab-btn')).map(b => b.innerText.trim());
                    return {
                        title: title ? title.innerText : null,
                        tabs: tabs
                    };
                })()
            """); cid += 1
            print("Loaded Team Profile:", team_info)

            # Switch to Hall of Champions tab
            await eval_js(ws, cid, """
                (() => {
                    if (typeof switchTeamProfileSubtab === 'function') {
                        switchTeamProfileSubtab('trophies');
                    }
                })()
            """); cid += 1
            await asyncio.sleep(0.5)

            # Verify stats in Hall of Champions
            champs_stats = await eval_js(ws, cid, """
                (() => {
                    const panel = document.getElementById('team-panel-trophies');
                    const kpis = Array.from(panel.querySelectorAll('.profile-kpi-card')).map(k => ({
                        label: k.querySelector('.profile-kpi-label')?.innerText.trim(),
                        value: k.querySelector('.profile-kpi-value')?.innerText.trim(),
                        sub: k.querySelector('.profile-kpi-sub')?.innerText.trim()
                    }));
                    const podiumItems = Array.from(panel.querySelectorAll('.profile-spotlight-card')).map(p => ({
                        name: p.querySelector('.profile-spotlight-card > div:nth-child(2)')?.innerText.trim(),
                        badge: p.querySelector('.badge')?.innerText.trim()
                    }));
                    const cards = Array.from(panel.querySelectorAll('.team-trophy-card')).map(c => ({
                        name: c.querySelector('.champ-trophy-name')?.innerText.trim(),
                        tier: c.querySelector('.champ-trophy-tier-tag')?.innerText.trim(),
                        player: c.querySelector('.champ-trophy-player-pill')?.innerText.trim(),
                        record: c.querySelector('.champ-meta-record')?.innerText.trim(),
                        glory: c.querySelector('.champ-meta-glory')?.innerText.trim()
                    }));
                    return {
                        kpis: kpis,
                        podiumCount: podiumItems.length,
                        podiumSample: podiumItems.slice(0, 4),
                        trophiesCount: cards.length,
                        sampleTrophies: cards.slice(0, 5)
                    };
                })()
            """); cid += 1
            print("Hall of Champions Stats:", json.dumps(champs_stats, indent=2))

            await take_screenshot(ws, cid, 'test_final_desktop_team_hall_of_champions.png'); cid += 1

            # Test quick filter: Grand Tournaments
            await eval_js(ws, cid, "setTeamSilverwareFilter('gt');"); cid += 1
            await asyncio.sleep(0.3)
            gt_count = await eval_js(ws, cid, """
                (() => {
                    const visible = Array.from(document.querySelectorAll('#team-trophies-grid .team-trophy-card')).filter(c => c.style.display !== 'none');
                    return visible.length;
                })()
            """); cid += 1
            print(f"Visible cards after GT filter: {gt_count}")
            await take_screenshot(ws, cid, 'test_final_desktop_team_champions_gt_filter.png'); cid += 1

            # Reset filter to 'all'
            await eval_js(ws, cid, "setTeamSilverwareFilter('all');"); cid += 1
            await asyncio.sleep(0.3)

            # Click on Angron's Book Club RTT: March card!
            print("\n=== Testing Click on Angron's Book Club RTT: March card ===")
            click_result = await eval_js(ws, cid, """
                (() => {
                    const cards = Array.from(document.querySelectorAll('#team-trophies-grid .team-trophy-card'));
                    const angronCard = cards.find(c => c.innerText.includes("Angron's Book Club"));
                    if (!angronCard) return { success: false, reason: 'card not found' };
                    angronCard.click();
                    return { success: true };
                })()
            """); cid += 1
            print("Click card result:", click_result)
            await asyncio.sleep(0.5)

            # Verify modal details
            modal_details = await eval_js(ws, cid, """
                (() => {
                    const modal = document.getElementById('badges-victory-chronicle-modal');
                    if (!modal) return null;
                    return {
                        visible: true,
                        title: modal.querySelector('h2')?.innerText.trim(),
                        tierPill: modal.querySelector('div[style*="text-transform: uppercase"]')?.innerText.trim(),
                        champion: modal.querySelector('div[style*="Champion:"]')?.innerText.trim(),
                        date: modal.querySelector('div[style*="Official Tournament Chronicle"]')?.innerText.trim(),
                        stats: Array.from(modal.querySelectorAll('.profile-kpi-card')).map(k => ({
                            label: k.querySelector('.profile-kpi-label')?.innerText.trim(),
                            val: k.querySelector('.profile-kpi-value')?.innerText.trim()
                        }))
                    };
                })()
            """); cid += 1
            print("Victory Chronicle Modal opened:", json.dumps(modal_details, indent=2))
            await take_screenshot(ws, cid, 'test_final_desktop_angron_modal_from_team.png'); cid += 1

            # Close modal
            await eval_js(ws, cid, "window.BadgesUI.closeVictoryChronicle();"); cid += 1
            await asyncio.sleep(0.3)

            print("\n=== 2. MOBILE TEST: 390x844 (iPhone 14/15) ===")
            await cdp_call(ws, cid, 'Emulation.setDeviceMetricsOverride', {
                'width': 390, 'height': 844, 'deviceScaleFactor': 2, 'mobile': True
            }); cid += 1
            await asyncio.sleep(0.5)

            # Verify 4 subtabs bar layout on mobile
            subtabs_mobile = await eval_js(ws, cid, """
                (() => {
                    const bar = document.querySelector('.team-profile-subtabs-bar');
                    const btns = Array.from(bar.querySelectorAll('.profile-subtab-btn')).map(b => ({
                        text: b.innerText.trim(),
                        width: b.offsetWidth
                    }));
                    return {
                        barWidth: bar.offsetWidth,
                        barScrollWidth: bar.scrollWidth,
                        hasOverflow: bar.scrollWidth > bar.offsetWidth,
                        buttons: btns
                    };
                })()
            """); cid += 1
            print("Mobile Subtabs Bar Layout:", json.dumps(subtabs_mobile, indent=2))

            # Switch to Silverware (trophies) subtab on mobile
            await eval_js(ws, cid, "switchTeamProfileSubtab('trophies');"); cid += 1
            await asyncio.sleep(0.5)
            await take_screenshot(ws, cid, 'test_final_mobile_team_hall_of_champions.png'); cid += 1

            # Click Angron's Book Club card on mobile
            await eval_js(ws, cid, """
                (() => {
                    const cards = Array.from(document.querySelectorAll('#team-trophies-grid .team-trophy-card'));
                    const angronCard = cards.find(c => c.innerText.includes("Angron's Book Club"));
                    if (angronCard) angronCard.click();
                })()
            """); cid += 1
            await asyncio.sleep(0.5)
            await take_screenshot(ws, cid, 'test_final_mobile_angron_modal_from_team.png'); cid += 1

            # Close modal
            await eval_js(ws, cid, "window.BadgesUI.closeVictoryChronicle();"); cid += 1
            await asyncio.sleep(0.3)

            # Switch to Roster subtab to verify mobile Starting 5 and roster integrity
            await eval_js(ws, cid, "switchTeamProfileSubtab('roster');"); cid += 1
            await asyncio.sleep(0.5)
            await take_screenshot(ws, cid, 'test_final_mobile_team_roster.png'); cid += 1

            print("\nAll automated browser tests completed successfully!")

    asyncio.run(run_tests())

finally:
    chrome_proc.terminate()
    chrome_proc.wait()
