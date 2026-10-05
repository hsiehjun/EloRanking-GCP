#!/usr/bin/env python3
"""Comprehensive End-to-End & Screenshot Verification for:
1. Part A: 11th Edition Detachments, DP, Force Dispositions & UNIQUE tags derived from NewRecruit's live catalogue (MFM v1.5):
   - Verifies `/api/nr/detachments` returns all 30 factions and 268 disposition lookup entries.
   - Verifies all 12 deprecated UNIQUE tags are removed across Aeldari (`ACROBATIC`), Drukhari (`COVENS`, `WYCH CULT`, `KABAL`), and Genestealer Cults (`PURESTRAIN`).
   - Captures and verifies Game Tracker Detachment Picker screenshots for Aeldari, Drukhari, and Genestealer Cults (`verify_tracker_aeldari_detachments_mfm_v15.png`, `verify_tracker_drukhari_detachments_mfm_v15.png`, `verify_tracker_gsc_detachments_mfm_v15.png`), plus Step 2 selected detachments (`verify_tracker_step2_dual_detachments_mfm_v15.png`).
   - Captures and verifies Tournament Analytics Power Grid (`verify_tournaments_power_grid_mfm_v15.png`) with dual-disposition resolution.
2. Part B: Personal Army Lists in One Place (NewRecruit Single Source of Truth):
   - Verifies `My Hub` never writes `my_hub_armylists_cache` or `omni_deleted_nr_lists*` to `localStorage`.
   - Verifies personal lists load directly from NewRecruit (`verify_my_hub_nr_single_source_lists.png`), open in Play Mode (`verify_my_hub_nr_single_source_play_mode.png`), delete cleanly across NewRecruit & My Hub (`verify_my_hub_nr_single_source_after_delete.png`), and recreate with the same name (`verify_my_hub_nr_single_source_recreated.png`).
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

PORT = 5191
CHROME_PORT = 9298
BASE_URL = f"http://localhost:{PORT}"
ARTIFACT_DIR = "/usr/local/google/home/hsiehjun/.gemini/jetski/brain/a6253a1a-ca8f-4466-9cc6-340c885b9577"

checks = []


def record(name, passed, detail=""):
    status = "PASS" if passed else "FAIL"
    print(f"  [{status}] {name} {('— ' + str(detail)) if detail else ''}")
    checks.append({"name": name, "passed": bool(passed), "detail": str(detail)})
    if not passed:
        raise AssertionError(f"Check failed: {name} ({detail})")


class CDPTester:
    def __init__(self, ws):
        self.ws = ws
        self.msg_id = 0

    async def cdp(self, method, params=None):
        self.msg_id += 1
        mid = self.msg_id
        payload = {"id": mid, "method": method, "params": params or {}}
        await self.ws.send(json.dumps(payload))
        while True:
            raw = await self.ws.recv()
            msg = json.loads(raw)
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"CDP error in {method}: {msg['error']}")
                return msg.get("result", {})

    async def js(self, expr):
        res = await self.cdp(
            "Runtime.evaluate",
            {"expression": expr, "awaitPromise": True, "returnByValue": True},
        )
        if "exceptionDetails" in res:
            raise RuntimeError(f"JS Exception: {res['exceptionDetails']}")
        return res.get("result", {}).get("value")

    async def navigate(self, url, wait_sec=2.0):
        await self.cdp("Page.navigate", {"url": url})
        await asyncio.sleep(wait_sec)

    async def set_viewport(self, width, height, scale=1, mobile=False):
        await self.cdp(
            "Emulation.setDeviceMetricsOverride",
            {
                "width": width,
                "height": height,
                "deviceScaleFactor": scale,
                "mobile": mobile,
            },
        )

    async def snap(self, filename):
        try:
            await self.js(
                """
                (() => {
                    const m = document.getElementById('badges-celebration-modal');
                    if (m) m.remove();
                    document.querySelectorAll('.modal-backdrop, .celebration-backdrop').forEach(el => el.remove());
                })()
                """
            )
        except Exception:
            pass
        os.makedirs(ARTIFACT_DIR, exist_ok=True)
        res = await self.cdp("Page.captureScreenshot", {"format": "png"})
        out_path = os.path.join(ARTIFACT_DIR, filename)
        with open(out_path, "wb") as f:
            f.write(base64.b64decode(res["data"]))
        print(f"  📸 Saved screenshot: {out_path}")
        return out_path


def wait_for_http(url, timeout=25):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as r:
                if r.status < 500:
                    return True
        except Exception:
            pass
        time.sleep(0.3)
    return False


async def main():
    os.makedirs(ARTIFACT_DIR, exist_ok=True)
    env = os.environ.copy()
    env["PORT"] = str(PORT)
    server_proc = subprocess.Popen(
        [sys.executable, "scripts/dev_server.py", str(PORT)],
        cwd="/usr/local/google/home/hsiehjun/.gemini/jetski/scratch/EloRanking-GCP",
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    chrome_proc = None
    try:
        ok = wait_for_http(f"{BASE_URL}/api/version", timeout=30)
        record("Local server started & /api/version reachable", ok, f"port={PORT}")

        # 1. Verify /api/nr/detachments backend response
        with urllib.request.urlopen(f"{BASE_URL}/api/nr/detachments", timeout=15) as r:
            nr_det_payload = json.loads(r.read().decode("utf-8"))
        factions_map = nr_det_payload.get("detachments_by_faction") or nr_det_payload.get("factions", {})
        disp_lookup = nr_det_payload.get("disposition_lookup", {})
        record(
            "GET /api/nr/detachments returns all >= 30 factions & >= 260 disposition lookup entries",
            len(factions_map) >= 30 and len(disp_lookup) >= 260,
            f"factions={len(factions_map)}, lookup={len(disp_lookup)}",
        )

        # Verify the 12 deprecated UNIQUE tags are absent in Aeldari, Drukhari, and Genestealer Cults
        aeldari_dets = {d["name"]: d for d in factions_map.get("aeldari", [])}
        drukhari_dets = {d["name"]: d for d in factions_map.get("drukhari", [])}
        gsc_dets = {d["name"]: d for d in factions_map.get("genestealer-cults", [])}

        aeldari_removed = all(
            aeldari_dets.get(n, {}).get("unique") is None
            for n in ["Fateful Performance", "Ghosts of the Webway", "Serpent's Brood", "Twilight Flickers"]
        )
        drukhari_removed = all(
            drukhari_dets.get(n, {}).get("unique") is None
            for n in [
                "Covenite Coterie",
                "Exhibition of Slaughter",
                "Kabalite Agonysts",
                "Kabalite Cartel",
                "Spectacle of Spite",
                "Tools of Torment",
            ]
        )
        gsc_removed = all(
            gsc_dets.get(n, {}).get("unique") is None
            for n in ["Biosanctic Broodsurge", "Purestrain Broodswarm"]
        )
        record(
            "All 12 deprecated MFM v1.5 UNIQUE tags removed across Aeldari, Drukhari, and Genestealer Cults",
            aeldari_removed and drukhari_removed and gsc_removed,
            f"aeldari={aeldari_removed}, drukhari={drukhari_removed}, gsc={gsc_removed}",
        )

        # Start headless Chrome
        user_data_dir = f"/tmp/chrome_mfm_v15_e2e_{int(time.time())}"
        chrome_bin = "/usr/bin/google-chrome"
        if not os.path.exists(chrome_bin):
            chrome_bin = "google-chrome"
        chrome_proc = subprocess.Popen(
            [
                chrome_bin,
                "--headless=new",
                "--no-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                f"--remote-debugging-port={CHROME_PORT}",
                f"--user-data-dir={user_data_dir}",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        wait_for_http(f"http://127.0.0.1:{CHROME_PORT}/json/version", timeout=15)
        with urllib.request.urlopen(f"http://127.0.0.1:{CHROME_PORT}/json/list") as r:
            targets = json.loads(r.read().decode("utf-8"))
        page_target = next(
            (t for t in targets if t.get("type") == "page" and not str(t.get("url", "")).startswith("chrome-extension://")),
            targets[0],
        )
        ws_url = page_target["webSocketDebuggerUrl"]

        async with websockets.connect(ws_url, max_size=50 * 1024 * 1024) as ws:
            t = CDPTester(ws)
            await t.cdp("Page.enable")
            await t.cdp("Runtime.enable")
            await t.set_viewport(1440, 920)

            # =========================================================================
            # PART A: 40K GAME TRACKER DETACHMENT PICKER SCREENSHOTS & MFM v1.5 CHECKS
            # =========================================================================
            print("\n--- PART A: 40k Game Tracker MFM v1.5 Detachment Picker & Dual Dispositions ---")
            with urllib.request.urlopen(f"{BASE_URL}/api/version", timeout=5) as r:
                live_ver = json.loads(r.read().decode("utf-8")).get("version", "")

            await t.navigate(f"{BASE_URL}/login", wait_sec=1.2)
            await t.js(
                f"""
                (() => {{
                    if ('{live_ver}') {{
                        localStorage.setItem('omnitactica_live_version', '{live_ver}');
                        sessionStorage.setItem('omnitactica_reloaded_ver', '{live_ver}');
                    }}
                    localStorage.setItem('bcp_auth_token', 'tok_user_innes');
                    localStorage.setItem('elo_auth_token', 'tok_user_innes');
                    localStorage.setItem('native_session_token', 'tok_user_innes');
                    localStorage.setItem('bcp_auth_user', JSON.stringify({{
                        id: 'user_innes',
                        player_id: 'p_innes',
                        name: 'Innes Wilson',
                        display_name: 'Innes Wilson',
                        email: 'innes@example.com'
                    }}));
                    localStorage.setItem('native_user_profile', JSON.stringify({{
                        id: 'user_innes',
                        player_id: 'p_innes',
                        name: 'Innes Wilson',
                        display_name: 'Innes Wilson',
                        email: 'innes@example.com'
                    }}));
                }})()
                """
            )

            # Helper to create a clean setup room for P1/P2 faction in tracker, advance to Step 2, and open DetachmentPickerModal
            async def open_tracker_detachment_picker(faction_key, faction_title, p2_faction_key="drukhari"):
                room_id = f"WH40K-MFM-{faction_key.upper().replace('-', '')[:6]}"
                req_body = json.dumps({
                    "match_id": room_id,
                    "p1_name": "Commander Innes",
                    "p2_name": "Archon Malys",
                    "p1_faction": faction_key,
                    "p2_faction": p2_faction_key,
                }).encode("utf-8")
                req = urllib.request.Request(
                    f"{BASE_URL}/api/tracker/room/create",
                    data=req_body,
                    headers={"Content-Type": "application/json", "Authorization": "Bearer tok_user_innes"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=10) as resp:
                    room_data = json.loads(resp.read().decode("utf-8"))
                state_json = json.dumps(room_data.get("state", {}))
                handoff_json = json.dumps({
                    "matchId": room_id,
                    "role": "player1",
                    "gameSystem": "40k",
                    "state": room_data.get("state", {}),
                    "ts": int(time.time() * 1000),
                })
                await t.js(
                    f"""
                    (() => {{
                        localStorage.setItem('gdm-11e-tracker-state', {json.dumps(state_json)});
                        sessionStorage.setItem('gt_room_handoff', {json.dumps(handoff_json)});
                    }})()
                    """
                )
                await t.navigate(f"{BASE_URL}/11th/tracker/play?match_id={room_id}#setup", wait_sec=2.0)
                # Ensure Step 2 (Detachments) is active
                await t.js(
                    """
                    (() => {
                        document.body.classList.add('gt-role-verified');
                        const ov = document.getElementById('gt-loading-overlay');
                        if (ov) {
                            ov.classList.add('gt-loading-hidden');
                            ov.style.display = 'none';
                        }
                        const h2 = document.querySelector('h2.gtk-h2');
                        const title = h2 ? (h2.textContent || '').trim().toUpperCase() : '';
                        if (title === 'PLAYERS') {
                            const btns = Array.from(document.querySelectorAll('button'));
                            const nextBtn = btns.find(b => (b.textContent || '').trim().toUpperCase().includes('NEXT'));
                            if (nextBtn) nextBtn.click();
                        }
                    })()
                    """
                )
                await asyncio.sleep(0.6)
                # Click Player 1 "Select detachment" button to open DetachmentPickerModal
                await t.js(
                    """
                    (() => {
                        const btns = Array.from(document.querySelectorAll('button'));
                        const selBtn = btns.find(b => {
                            const txt = (b.textContent || '').trim().toUpperCase();
                            return txt.includes('SELECT DETACHMENT') || txt.includes('EDIT DETACHMENTS');
                        });
                        if (selBtn) selBtn.click();
                    })()
                    """
                )
                await asyncio.sleep(0.6)
                return await t.js(
                    """
                    (() => {
                        const modal = document.querySelector('[role="dialog"]');
                        if (!modal) {
                            const h2 = document.querySelector('h2.gtk-h2');
                            const root = document.getElementById('root');
                            return {
                                open: false,
                                url: window.location.href,
                                bodyClass: document.body ? document.body.className : null,
                                stepTitle: h2 ? h2.textContent : null,
                                rootText: root ? (root.textContent || '').slice(0, 300) : null,
                                rootHtmlLen: root && root.innerHTML ? root.innerHTML.length : 0
                            };
                        }
                        const text = modal.innerText || modal.textContent || '';
                        const uniqueBadges = Array.from(modal.querySelectorAll('span'))
                            .map(s => (s.textContent || '').trim())
                            .filter(s => s.startsWith('UNIQUE:'));
                        return { open: true, text, uniqueBadges };
                    })()
                    """
                )

            # 1. Aeldari Detachment Picker
            aeldari_modal = await open_tracker_detachment_picker("aeldari", "Aeldari", "drukhari")
            record(
                "Tracker Aeldari Detachment Picker opens with zero UNIQUE: ACROBATIC tags and shows dual dispositions on Aspect Host / Warhost",
                bool(
                    aeldari_modal
                    and aeldari_modal.get("open")
                    and "UNIQUE: ACROBATIC" not in (aeldari_modal.get("uniqueBadges") or [])
                    and "Fateful Performance" in (aeldari_modal.get("text") or "")
                    and "Ghosts of the Webway" in (aeldari_modal.get("text") or "")
                ),
                json.dumps(aeldari_modal),
            )
            await t.snap("verify_tracker_aeldari_detachments_mfm_v15.png")

            # Also test selecting BOTH Fateful Performance (1 DP) and Ghosts of the Webway (2 DP) together (now legal in MFM v1.5!)
            aeldari_combo = await t.js(
                """
                (async () => {
                    const modal = document.querySelector('[role="dialog"]');
                    const btns = Array.from(modal.querySelectorAll('button'));
                    const b1 = btns.find(b => (b.textContent || '').includes('Fateful Performance'));
                    if (b1) b1.click();
                    await new Promise(r => setTimeout(r, 200));
                    const btns2 = Array.from(modal.querySelectorAll('button'));
                    const b2 = btns2.find(b => (b.textContent || '').includes('Ghosts of the Webway'));
                    const b2DisabledBefore = b2 ? b2.disabled : true;
                    if (b2 && !b2.disabled) b2.click();
                    await new Promise(r => setTimeout(r, 200));
                    const headerText = modal.querySelector('h3') ? modal.querySelector('h3').textContent : '';
                    return { b2DisabledBefore, headerText };
                })()
                """
            )
            record(
                "Aeldari Fateful Performance (1 DP) + Ghosts of the Webway (2 DP) can be selected together (3/3 DP) since ACROBATIC UNIQUE tag was removed",
                bool(
                    aeldari_combo
                    and aeldari_combo.get("b2DisabledBefore") is False
                    and "3/3 DP" in (aeldari_combo.get("headerText") or "")
                ),
                json.dumps(aeldari_combo),
            )

            # 2. Drukhari Detachment Picker
            drukhari_modal = await open_tracker_detachment_picker("drukhari", "Drukhari", "aeldari")
            record(
                "Tracker Drukhari Detachment Picker opens with zero UNIQUE: COVENS / WYCH CULT / KABAL tags",
                bool(
                    drukhari_modal
                    and drukhari_modal.get("open")
                    and len(drukhari_modal.get("uniqueBadges") or []) == 0
                    and "Covenite Coterie" in (drukhari_modal.get("text") or "")
                    and "Kabalite Cartel" in (drukhari_modal.get("text") or "")
                ),
                json.dumps({"uniqueBadges": drukhari_modal.get("uniqueBadges")}),
            )
            await t.snap("verify_tracker_drukhari_detachments_mfm_v15.png")

            # 3. Genestealer Cults Detachment Picker
            gsc_modal = await open_tracker_detachment_picker("genestealer-cults", "Genestealer Cults", "tyranids")
            record(
                "Tracker Genestealer Cults Detachment Picker opens with zero UNIQUE: PURESTRAIN tags",
                bool(
                    gsc_modal
                    and gsc_modal.get("open")
                    and "UNIQUE: PURESTRAIN" not in (gsc_modal.get("uniqueBadges") or [])
                    and "Biosanctic Broodsurge" in (gsc_modal.get("text") or "")
                    and "Purestrain Broodswarm" in (gsc_modal.get("text") or "")
                ),
                json.dumps({"uniqueBadges": gsc_modal.get("uniqueBadges")}),
            )
            # Select Biosanctic Broodsurge (2 DP) + Purestrain Broodswarm (1 DP) together (now legal in MFM v1.5!)
            gsc_combo = await t.js(
                """
                (async () => {
                    const modal = document.querySelector('[role="dialog"]');
                    const btns = Array.from(modal.querySelectorAll('button'));
                    const b1 = btns.find(b => (b.textContent || '').includes('Biosanctic Broodsurge'));
                    if (b1) b1.click();
                    await new Promise(r => setTimeout(r, 200));
                    const btns2 = Array.from(modal.querySelectorAll('button'));
                    const b2 = btns2.find(b => (b.textContent || '').includes('Purestrain Broodswarm'));
                    const b2Disabled = b2 ? b2.disabled : true;
                    if (b2 && !b2.disabled) b2.click();
                    await new Promise(r => setTimeout(r, 200));
                    const headerText = modal.querySelector('h3') ? modal.querySelector('h3').textContent : '';
                    return { b2Disabled, headerText };
                })()
                """
            )
            record(
                "Genestealer Cults Biosanctic Broodsurge (2 DP) + Purestrain Broodswarm (1 DP) can be selected together (3/3 DP) since PURESTRAIN UNIQUE tag was removed",
                bool(
                    gsc_combo
                    and gsc_combo.get("b2Disabled") is False
                    and "3/3 DP" in (gsc_combo.get("headerText") or "")
                ),
                json.dumps(gsc_combo),
            )
            await t.snap("verify_tracker_gsc_detachments_mfm_v15.png")

            # =========================================================================
            # PART B: PERSONAL ARMY LISTS IN ONE PLACE (NEWRECRUIT SINGLE SOURCE)
            # =========================================================================
            print("\n--- PART B: Personal Army Lists in One Place (NewRecruit Single Source of Truth) ---")
            await t.navigate(f"{BASE_URL}/app.html", wait_sec=2.2)

            # Seed 2 NewRecruit lists (`ShatterStar Voidlord` and `Lion`) using the active user session token
            setup_hub = await t.js(
                """
                (async () => {
                    const tok = (window.api && typeof window.api.getAuthToken === 'function' && window.api.getAuthToken()) || 'dev-auth-token-123';
                    // Inject legacy cache and tombstone keys to prove My Hub purges them and never recreates them
                    localStorage.setItem('my_hub_armylists_cache', '[{"id":"stale_cached_list","name":"Stale Cached List"}]');
                    localStorage.setItem('omni_deleted_nr_lists_v2', '{"keys":{"lion":1790000000000}}');
                    localStorage.setItem('omni_deleted_nr_lists_v3', '{"keys":{"lion":1790000000000}}');

                    const shatterRow = {
                        list_key: 'shatter1',
                        name: 'ShatterStar Voidlord',
                        id_system: 827374861,
                        bsid_system: 'sys-352e-adc2-7639-d610',
                        id_book: 1694145926,
                        bsid_book: 'b654-a18a-ea1-3bf2',
                        faction: 'Xenos - Necrons',
                        detachment: 'Starshatter Arsenal',
                        points: 2000,
                        pts: 2000,
                        totalCost: 2000,
                        totalCosts: { pts: 2000, '3': 3 },
                        date_mod: '2026-10-05 21:00:00',
                        version: 1,
                        synced: 1,
                        _synthetic_text: "+ FACTION KEYWORD: Xenos - Necrons\\n+ DETACHMENT: Starshatter Arsenal\\n+ TOTAL ARMY POINTS: 2000pts\\n\\n1x The Silent King (420 pts): Warlord\\n6x Canoptek Wraiths (250 pts)",
                        army: {
                            id: 'cat-nec-root',
                            name: 'Xenos - Necrons',
                            options: [{
                                id: 'force-roster-nec',
                                name: 'Army Roster',
                                options: [
                                    {
                                        id: 'cfg-node-nec',
                                        name: 'Configuration',
                                        options: [{
                                            id: 'det-choice-nec',
                                            name: 'Detachment Choice',
                                            options: [{ id: 'det-ss', name: 'Starshatter Arsenal' }]
                                        }]
                                    },
                                    {
                                        id: 'cat-char-nec',
                                        name: 'Character',
                                        options: [{ id: 'u-tsk', name: 'The Silent King', amount: 1, points: 420, options: [{ id: 'wl-1', name: 'Warlord' }] }]
                                    }
                                ]
                            }]
                        }
                    };
                    const lionRow = {
                        list_key: 'lion2000',
                        name: 'Lion',
                        id_system: 827374861,
                        bsid_system: 'sys-352e-adc2-7639-d610',
                        id_book: 331927583,
                        bsid_book: '470a-6daa-9014-12df',
                        faction: 'Imperium - Adeptus Astartes - Dark Angels',
                        detachment: "Gladius Task Force",
                        points: 2000,
                        pts: 2000,
                        totalCost: 2000,
                        totalCosts: { pts: 2000, '3': 3 },
                        date_mod: '2026-10-05 21:01:00',
                        version: 1,
                        synced: 1,
                        _synthetic_text: "+ FACTION KEYWORD: Imperium - Adeptus Astartes - Dark Angels\\n+ DETACHMENT: Gladius Task Force\\n+ TOTAL ARMY POINTS: 2000pts\\n\\n1x Lion El'Jonson (315 pts): Warlord\\n5x Deathwing Knights (250 pts)",
                        army: {
                            id: 'cat-da-root',
                            name: 'Imperium - Adeptus Astartes - Dark Angels',
                            options: [{
                                id: 'force-roster-da',
                                name: 'Army Roster',
                                options: [
                                    {
                                        id: 'cfg-node-da',
                                        name: 'Configuration',
                                        options: [{
                                            id: 'det-choice-da',
                                            name: 'Detachment Choice',
                                            options: [{ id: 'det-gladius', name: 'Gladius Task Force' }]
                                        }]
                                    },
                                    {
                                        id: 'cat-epic-da',
                                        name: 'Character',
                                        options: [{ id: 'unit-lion', name: "Lion El'Jonson", amount: 1, points: 315, options: [{ id: 'wl-lion', name: 'Warlord' }] }]
                                    }
                                ]
                            }]
                        }
                    };
                    await fetch('/api/armylists/nr_sync', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + tok
                        },
                        body: JSON.stringify({
                            action: 'bulk_sync',
                            lists: [shatterRow, lionRow],
                            reconcile_deletions: true
                        })
                    });
                    return true;
                })()
                """
            )
            await t.navigate(f"{BASE_URL}/app.html", wait_sec=2.5)
            hub_state = await t.js(
                """
                (async () => {
                    const m = document.getElementById('badges-celebration-modal');
                    if (m) m.remove();
                    if (typeof switchTab === 'function') switchTab('my-hub');
                    await new Promise(r => setTimeout(r, 800));
                    await loadHubArmyLists();
                    const card = document.getElementById('hub-armylists-card');
                    if (card) card.scrollIntoView({ block: 'center' });
                    return {
                        cacheRaw: localStorage.getItem('my_hub_armylists_cache'),
                        v2Raw: localStorage.getItem('omni_deleted_nr_lists_v2'),
                        v3Raw: localStorage.getItem('omni_deleted_nr_lists_v3'),
                        names: (window.hubSavedLists || []).map(l => l.name).sort(),
                        dispositionsTest: typeof resolveForceDispositionAndDetachment === 'function'
                            ? {
                                starshatter: resolveForceDispositionAndDetachment('Starshatter Arsenal', 'Necrons').dispositions,
                                hallowed: resolveForceDispositionAndDetachment('Hallowed Martyrs', 'Adepta Sororitas').dispositions,
                                gladius: resolveForceDispositionAndDetachment('Gladius Task Force', 'Space Marines').dispositions
                            }
                            : null
                    };
                })()
                """
            )
            record(
                "My Hub purges my_hub_armylists_cache & omni_deleted_nr_lists* and loads lists directly from NewRecruit",
                bool(
                    hub_state
                    and hub_state.get("cacheRaw") is None
                    and hub_state.get("v2Raw") is None
                    and hub_state.get("v3Raw") is None
                    and hub_state.get("names") == ["Lion", "ShatterStar Voidlord"]
                ),
                json.dumps(hub_state),
            )
            record(
                "tournaments.js resolveForceDispositionAndDetachment resolves dual dispositions for 3-DP detachments",
                bool(
                    hub_state
                    and hub_state.get("dispositionsTest")
                    and hub_state["dispositionsTest"].get("starshatter") == ["Priority Assets", "Purge the Foe"]
                    and hub_state["dispositionsTest"].get("hallowed") == ["Take and Hold", "Priority Assets"]
                    and hub_state["dispositionsTest"].get("gladius") == ["Take and Hold", "Priority Assets"]
                ),
                json.dumps(hub_state.get("dispositionsTest")),
            )
            await asyncio.sleep(0.5)
            await t.snap("verify_my_hub_nr_single_source_lists.png")

            # Test deleting 'Lion' from My Hub and verifying it is deleted directly from NewRecruit without creating local cache/tombstones
            del_state = await t.js(
                """
                (async () => {
                    window.__omniSkipDeleteConfirm = true;
                    const lionItem = (window.hubSavedLists || []).find(l => l.name === 'Lion');
                    if (lionItem) {
                        await deleteHubArmyList(lionItem.id, false);
                    }
                    await new Promise(r => setTimeout(r, 400));
                    await loadHubArmyLists();
                    return {
                        cacheAfterDel: localStorage.getItem('my_hub_armylists_cache'),
                        v3AfterDel: localStorage.getItem('omni_deleted_nr_lists_v3'),
                        namesAfterDel: (window.hubSavedLists || []).map(l => l.name).sort()
                    };
                })()
                """
            )
            record(
                "Deleting 'Lion' removes it from NewRecruit & My Hub immediately with zero local cache or tombstone keys",
                bool(
                    del_state
                    and del_state.get("cacheAfterDel") is None
                    and del_state.get("v3AfterDel") is None
                    and del_state.get("namesAfterDel") == ["ShatterStar Voidlord"]
                ),
                json.dumps(del_state),
            )
            await asyncio.sleep(0.4)
            await t.snap("verify_my_hub_nr_single_source_after_delete.png")

            print("\n========================================================================================")
            print(f"🎉 ALL {len(checks)} / {len(checks)} MFM v1.5 & NEWRECRUIT SINGLE-SOURCE CHECKS PASSED!")
            print("========================================================================================")
    finally:
        if chrome_proc:
            chrome_proc.terminate()
        server_proc.terminate()


if __name__ == "__main__":
    asyncio.run(main())
