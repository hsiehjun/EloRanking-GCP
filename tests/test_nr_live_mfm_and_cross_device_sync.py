#!/usr/bin/env python3
"""End-to-end verification for:
1. Live NewRecruit catalogue/library pass-through (MFM v1.5 detachment points: Canoptek Court = 2 DP, Skyshroud Spearhead = 1 DP).
2. Automatic client-side library refresh when browser IndexedDB had an older nrversion cached.
3. Cross-device list hydration & tombstone v3 migration (merging 'Lion' + 'ShatterStar Voidlord' on Desktop even when Desktop already has 1 local list and a legacy name-based tombstone for 'lion').
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

PORT = 5189
CHROME_PORT = 9296
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
        os.makedirs(ARTIFACT_DIR, exist_ok=True)
        res = await self.cdp("Page.captureScreenshot", {"format": "png"})
        out_path = os.path.join(ARTIFACT_DIR, filename)
        with open(out_path, "wb") as f:
            f.write(base64.b64decode(res["data"]))
        print(f"  📸 Saved screenshot: {out_path}")
        return out_path


def http_post_json(url, payload):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


async def main():
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
        # Wait for local FastAPI server to become ready
        ready = False
        for _ in range(30):
            try:
                with urllib.request.urlopen(f"{BASE_URL}/api/version", timeout=2) as r:
                    if r.status == 200:
                        ready = True
                        break
            except Exception:
                await asyncio.sleep(0.4)
        record("Local FastAPI server started cleanly", ready, f"port={PORT}")

        # =====================================================================
        # PART 1: VERIFY LIVE NEWRECRUIT CATALOGUE RPC PASS-THROUGH (MFM v1.5)
        # =====================================================================
        print("\n--- PART 1: Verify Live NewRecruit Catalogue RPC Pass-Through ---")
        lib_data = http_post_json(
            f"{BASE_URL}/api/rpc?m=get_library",
            {"method": "get_library", "params": []},
        )
        lib_arr = lib_data if isinstance(lib_data, list) else lib_data.get("array", [])
        sys_827 = next((s for s in lib_arr if s.get("id") == 827374861), None)
        sys_books = (sys_827 or {}).get("books", [])
        if isinstance(sys_books, dict):
            sys_books = sys_books.get("array", [])
        necrons_meta = next((b for b in sys_books if b.get("id") == 1694145926), None)
        record(
            "proxy_nr_request('/api/rpc?m=get_library') fetches LIVE library (nrversion >= 24) instead of stale offline bundle (nrversion 22)",
            bool(necrons_meta and int(necrons_meta.get("nrversion", 0)) >= 24),
            json.dumps(necrons_meta),
        )

        book_row = http_post_json(
            f"{BASE_URL}/api/rpc?m=books_get_book_row",
            {"method": "books_get_book_row", "params": [827374861, 1694145926]},
        )
        raw_book_data = book_row.get("content") or book_row.get("data")
        book_obj = json.loads(raw_book_data) if isinstance(raw_book_data, str) else raw_book_data

        # Walk the Necrons book JSON to find Canoptek Court and Skyshroud Spearhead Detachment Points
        det_costs = {}

        def walk_entries(node):
            if isinstance(node, dict):
                nm = node.get("name")
                if nm in ("Canoptek Court", "Skyshroud Spearhead") and isinstance(node.get("costs"), list):
                    for c in node["costs"]:
                        if isinstance(c, dict) and c.get("name") == "Detachment Points":
                            det_costs[nm] = c.get("value")
                for v in node.values():
                    walk_entries(v)
            elif isinstance(node, list):
                for item in node:
                    walk_entries(item)

        walk_entries(book_obj)
        canoptek_dp = det_costs.get("Canoptek Court")
        skyshroud_dp = det_costs.get("Skyshroud Spearhead")
        record(
            "Live Necrons book (1694145926) has updated MFM v1.5 Detachment Points: Canoptek Court = 2 DP, Skyshroud Spearhead = 1 DP",
            canoptek_dp == 2 and skyshroud_dp == 1,
            f"book_nrversion={book_row.get('nrversion')}, Canoptek Court DP={canoptek_dp}, Skyshroud Spearhead DP={skyshroud_dp}",
        )

        # Verify fast stub RPCs still respond immediately
        t0 = time.time()
        countries = http_post_json(
            f"{BASE_URL}/api/rpc?m=get_countries",
            {"method": "get_countries", "params": []},
        )
        elapsed_ms = (time.time() - t0) * 1000.0
        record(
            "Non-catalogue stub RPCs (get_countries) remain fast (<100ms)",
            isinstance(countries, list) and len(countries) > 0 and elapsed_ms < 100,
            f"len={len(countries)}, elapsed_ms={elapsed_ms:.1f}ms",
        )

        # =====================================================================
        # PART 2: HEADLESS CHROME E2E — CROSS-DEVICE SYNC & LIVE DETACHMENT PTS
        # =====================================================================
        print("\n--- PART 2: Browser E2E — Cross-Device List Hydration & Live Detachment Points ---")
        chrome_proc = subprocess.Popen(
            [
                "/usr/bin/google-chrome",
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                f"--remote-debugging-port={CHROME_PORT}",
                "--user-data-dir=/tmp/chrome_nr_live_sync_" + str(int(time.time())),
                "--window-size=1440,900",
                "--hide-scrollbars",
            ]
        )
        await asyncio.sleep(2.2)
        with urllib.request.urlopen(f"http://localhost:{CHROME_PORT}/json") as resp:
            tabs = json.loads(resp.read().decode())
        page_tab = next(t for t in tabs if t.get("type") == "page")
        ws_url = page_tab["webSocketDebuggerUrl"]

        async with websockets.connect(ws_url, max_size=40 * 1024 * 1024) as ws:
            t = CDPTester(ws)
            await t.cdp("Page.enable")
            await t.cdp("Runtime.enable")
            await t.cdp("Network.enable")

            await t.set_viewport(1440, 900, scale=1, mobile=False)
            await t.navigate(f"{BASE_URL}/app#my-hub", wait_sec=2.2)

            # 1. Seed backend with 2 lists (simulating lists synced from Mobile / NewRecruit Cloud):
            #    - "ShatterStar Voidlord" (Necrons 2000 pts, key: "shatter1")
            #    - "Lion" (Dark Angels 2000 pts, key: "lion2000")
            shatter_row = {
                "list_key": "shatter1",
                "name": "ShatterStar Voidlord",
                "id_system": 827374861,
                "id_book": 1694145926,
                "bsid_system": "sys-352e-adc2-7639-d610",
                "bsid_book": "b97e-2284-3251-9b14",
                "totalCost": 2000,
                "totalCosts": {"pts": 2000, "3": 3},
                "pts": 2000,
                "points": 2000,
                "faction": "Xenos - Necrons",
                "detachment": "Canoptek Court",
                "date_mod": "2026-09-30 16:59:11",
                "version": 3,
                "synced": 1,
                "metadata": {"play_mode": False},
            }
            lion_row = {
                "list_key": "lion2000",
                "name": "Lion",
                "id_system": 827374861,
                "id_book": 331927583,
                "bsid_system": "sys-352e-adc2-7639-d610",
                "bsid_book": "470a-6daa-9014-12df",
                "totalCost": 2000,
                "totalCosts": {"pts": 2000, "3": 3},
                "pts": 2000,
                "points": 2000,
                "faction": "Imperium - Adeptus Astartes - Dark Angels",
                "detachment": "Gladius Task Force",
                "date_mod": "2026-09-30 16:40:00",
                "version": 2,
                "synced": 1,
                "metadata": {"play_mode": False},
            }

            seed_res = await t.js(
                f"""
                (async () => {{
                    const r1 = await fetch('/api/armylists/nr_sync', {{
                        method: 'POST',
                        headers: {{
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + (window.api.getAuthToken() || '')
                        }},
                        body: JSON.stringify({{
                            action: 'bulk_sync',
                            lists: [{json.dumps(shatter_row)}, {json.dumps(lion_row)}],
                            reconcile_deletions: true
                        }})
                    }});
                    return await r1.json();
                }})()
                """
            )
            record(
                "Seeded backend with 2 lists ('ShatterStar Voidlord' and 'Lion')",
                bool(seed_res and len(seed_res.get("army_lists", [])) == 2),
                f"count={len((seed_res or {}).get('army_lists', []))}",
            )

            # 2. Simulate the exact broken Desktop state before our fix:
            #    - localStorage has legacy `omni_deleted_nr_lists_v2` with `names: {"lion": 1790000000000}`
            #    - Desktop IndexedDB only has 1 list (`shatter1`), missing `lion2000`
            await t.js(
                f"""
                (() => {{
                    localStorage.setItem('omni_deleted_nr_lists_v2', JSON.stringify({{
                        keys: {{ 'old_deleted_lion_key': 1790000000000 }},
                        names: {{ 'lion': 1790000000000 }}
                    }}));
                }})()
                """
            )

            # Load My Hub Army Lists and verify that `omni_deleted_nr_lists_v2` is purged and BOTH lists appear!
            hub_lists_state = await t.js(
                """
                (async () => {
                    const m = document.getElementById('badges-celebration-modal');
                    if (m) m.remove();
                    await loadHubArmyLists();
                    const card = document.getElementById('hub-armylists-card');
                    if (card) card.scrollIntoView({ block: 'center' });
                    const v2Raw = localStorage.getItem('omni_deleted_nr_lists_v2');
                    const names = (window.hubSavedLists || []).map(l => l.name).sort();
                    return { v2Raw, names, count: names.length };
                })()
                """
            )
            await asyncio.sleep(0.4)
            record(
                "My Hub purges legacy omni_deleted_nr_lists_v2 name-based tombstone and displays both 'Lion' and 'ShatterStar Voidlord'",
                bool(
                    hub_lists_state
                    and hub_lists_state.get("v2Raw") is None
                    and hub_lists_state.get("names") == ["Lion", "ShatterStar Voidlord"]
                ),
                json.dumps(hub_lists_state),
            )
            await t.snap("verify_desktop_my_hub_two_lists.png")

            # 3. Open NewRecruit Studio Drawer on Desktop where IndexedDB initially only has 'shatter1'
            await t.js("openNewRecruitStudioDrawer('/nr/app/Lists')")
            for _ in range(30):
                ready_studio = await t.js(
                    """
                    (async () => {
                        const ifr = document.getElementById('hub-nr-studio-iframe');
                        if (!ifr || !ifr.contentWindow || !ifr.contentWindow.__omnitacticaNrBridge) return false;
                        const st = ifr.contentWindow.__omnitacticaNrBridge.getNrStores();
                        return Boolean(st && st.list && st.list.listsInitiated && st.system && st.system.library);
                    })()
                    """
                )
                if ready_studio:
                    break
                await asyncio.sleep(0.5)

            # Simulate Desktop starting with only `shatter1` in Pinia/IndexedDB + legacy tombstone, then running hydrateFromOmniTactica()
            desktop_hydration_check = await t.js(
                f"""
                (async () => {{
                    const ifr = document.getElementById('hub-nr-studio-iframe');
                    const win = ifr.contentWindow;
                    const st = win.__omnitacticaNrBridge.getNrStores();

                    // Put legacy tombstone in localStorage and restrict Pinia/IDB to only shatter1
                    win.localStorage.setItem('omni_deleted_nr_lists_v2', JSON.stringify({{
                        keys: {{ 'old_deleted_lion_key': 1790000000000 }},
                        names: {{ 'lion': 1790000000000 }}
                    }}));
                    st.list.listData.splice(0, st.list.listData.length, {json.dumps(shatter_row)});

                    // Now run hydrateFromOmniTactica(true)
                    await win.__omnitacticaNrBridge.hydrateFromOmniTactica(true);

                    const piniaNames = (st.list.listData || []).map(r => r && r.name).filter(Boolean).sort();
                    const backendState = await (await fetch('/api/armylists/nr_state', {{
                        headers: {{ 'Authorization': 'Bearer ' + (window.api.getAuthToken() || '') }}
                    }})).json();
                    const backendNames = (backendState.nr_rows || []).map(r => r && r.name).filter(Boolean).sort();

                    // Also inspect live system library nrversion for Necrons (id_book 1694145926 in system 827374861)
                    const sysArr = Array.isArray(st.system.library) ? st.system.library : (st.system.library && st.system.library.array || []);
                    const sys827 = sysArr.find(s => s && s.id == 827374861);
                    const booksArr = sys827 ? (Array.isArray(sys827.books) ? sys827.books : (sys827.books && sys827.books.array || [])) : [];
                    const necronsBookMeta = booksArr.find(b => b && b.id == 1694145926);

                    return {{
                        v2After: win.localStorage.getItem('omni_deleted_nr_lists_v2'),
                        piniaNames,
                        backendNames,
                        necronsNrVersion: necronsBookMeta ? necronsBookMeta.nrversion : null
                    }};
                }})()
                """
            )
            record(
                "Desktop NewRecruit Studio hydrateFromOmniTactica() merges missing 'Lion' list into Pinia/IndexedDB without deleting it from backend",
                bool(
                    desktop_hydration_check
                    and desktop_hydration_check.get("v2After") is None
                    and desktop_hydration_check.get("piniaNames") == ["Lion", "ShatterStar Voidlord"]
                    and desktop_hydration_check.get("backendNames") == ["Lion", "ShatterStar Voidlord"]
                ),
                json.dumps(desktop_hydration_check),
            )
            record(
                "NewRecruit Studio Pinia system store has live MFM v1.5 Necrons nrversion (>= 24)",
                bool(desktop_hydration_check and int(desktop_hydration_check.get("necronsNrVersion") or 0) >= 24),
                json.dumps(desktop_hydration_check),
            )
            await asyncio.sleep(1.0)
            await t.snap("verify_nr_studio_my_lists_both_visible.png")

            # 4. Now verify in NewRecruit Studio that loading the 11th Ed Necrons catalogue (id_system=827374861, id_book=1694145926)
            #    computes Canoptek Court = 2 Detachment Points and Skyshroud Spearhead = 1 Detachment Points!
            necrons_studio_dp = await t.js(
                """
                (async () => {
                    const ifr = document.getElementById('hub-nr-studio-iframe');
                    const win = ifr.contentWindow;
                    const st = win.__omnitacticaNrBridge.getNrStores();
                    const sys = (await st.system.selectSystem(827374861)) || st.system.selectedSystem;
                    const book = await sys.getBook(1694145926);
                    const found = {};
                    const seen = new WeakSet();
                    const walk = (node) => {
                        if (!node || typeof node !== 'object') return;
                        if (seen.has(node)) return;
                        seen.add(node);
                        if (Array.isArray(node)) {
                            for (const item of node) walk(item);
                            return;
                        }
                        if (node.name === 'Canoptek Court' || node.name === 'Skyshroud Spearhead') {
                            if (Array.isArray(node.costs)) {
                                const dp = node.costs.find(c => c && c.name === 'Detachment Points');
                                if (dp && typeof dp.value === 'number') {
                                    found[node.name] = dp.value;
                                }
                            } else if (node.cost && typeof node.cost === 'object') {
                                const v = node.cost['Detachment Points'] ?? node.cost['82ae-1066-5107-6ae0'] ?? node.cost['3'];
                                if (typeof v === 'number') found[node.name] = v;
                            }
                        }
                        for (const k of Object.keys(node)) {
                            if (k === 'parent' || k === 'system' || k === 'book') continue;
                            walk(node[k]);
                        }
                    };
                    walk(book && book.book ? book.book : book);
                    return {
                        loadedNrVersion: book ? book.nrversion : null,
                        canoptekDp: found['Canoptek Court'] ?? null,
                        skyshroudDp: found['Skyshroud Spearhead'] ?? null
                    };
                })()
                """
            )
            record(
                "NewRecruit Studio client Pinia store loads Necrons book with Canoptek Court = 2 DP and Skyshroud Spearhead = 1 DP",
                bool(
                    necrons_studio_dp
                    and necrons_studio_dp.get("canoptekDp") == 2
                    and necrons_studio_dp.get("skyshroudDp") == 1
                ),
                json.dumps(necrons_studio_dp),
            )

            # =====================================================================
            # PART 3: CROSS-DEVICE NEWRECRUIT CREDENTIAL & SESSION SYNC (T1 - T5)
            # =====================================================================
            print("\n--- PART 3: Cross-Device NewRecruit Credential & Session Sync (T1 - T5) ---")
            # Create a dummy JWT with login='hsiehjun' so JWT fallback & Pinia user store work cleanly
            jwt_header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).decode().rstrip("=")
            jwt_payload = base64.urlsafe_b64encode(json.dumps({"id": 42, "login": "hsiehjun", "tier": 2, "supporter": 2}).encode()).decode().rstrip("=")
            mock_access_jwt = f"{jwt_header}.{jwt_payload}.sig_hsiehjun"
            mock_refresh_jwt = "refresh_tok_hsiehjun_v1"

            # T1: Simulate logging into NewRecruit inside the Studio iframe on Device A (Desktop)
            t1_desktop_login = await t.js(
                f"""
                (async () => {{
                    const ifr = document.getElementById('hub-nr-studio-iframe');
                    const win = ifr.contentWindow;
                    const st = win.__omnitacticaNrBridge.getNrStores();

                    // Clear any prior backup so backupOrRestoreNrAuth sees a fresh login
                    win.localStorage.removeItem('omni_nr_auth_backup_v1');
                    win.localStorage.setItem('access', {json.dumps(mock_access_jwt)});
                    win.localStorage.setItem('refresh', {json.dumps(mock_refresh_jwt)});
                    win.localStorage.setItem('client-key', 'ck_desk1');
                    st.user.initLoggedUser({{ id: 42, login: 'hsiehjun', supporter: 2, tier: 2 }});

                    // Wait briefly for pushNrAuthToOmniServer async POST to complete
                    for (let i = 0; i < 20; i++) {{
                        const bak = JSON.parse(win.localStorage.getItem('omni_nr_auth_backup_v1') || '{{}}');
                        if (bak && bak.synced_to_server) break;
                        await new Promise(r => setTimeout(r, 100));
                    }}

                    const nrStateRes = await (await fetch('/api/armylists/nr_state', {{
                        headers: {{ 'Authorization': 'Bearer ' + (window.api.getAuthToken() || '') }}
                    }})).json();
                    const bakFinal = JSON.parse(win.localStorage.getItem('omni_nr_auth_backup_v1') || '{{}}');
                    return {{
                        syncedToServerFlag: Boolean(bakFinal && bakFinal.synced_to_server),
                        cloudAccount: nrStateRes.cloud_account
                    }};
                }})()
                """
            )
            record(
                "T1: Logging into NewRecruit on Desktop automatically pushes tokens to /api/armylists/nr_cloud_connect and persists on server",
                bool(
                    t1_desktop_login
                    and t1_desktop_login.get("syncedToServerFlag") is True
                    and t1_desktop_login.get("cloudAccount", {}).get("connected") is True
                    and t1_desktop_login.get("cloudAccount", {}).get("login") == "hsiehjun"
                    and t1_desktop_login.get("cloudAccount", {}).get("access") == mock_access_jwt
                ),
                json.dumps(t1_desktop_login),
            )

            # T2: Simulate opening OmniTactica on Device B (Mobile) with empty localStorage (never logged into NR on Mobile)
            await t.set_viewport(390, 844, scale=3, mobile=True)
            t2_mobile_autologin = await t.js(
                """
                (async () => {
                    const ifr = document.getElementById('hub-nr-studio-iframe');
                    const win = ifr.contentWindow;
                    const st = win.__omnitacticaNrBridge.getNrStores();

                    // Wipe local NR tokens to simulate a brand new Mobile browser session
                    localStorage.removeItem('omni_nr_auth_backup_v1');
                    localStorage.removeItem('access');
                    localStorage.removeItem('refresh');
                    win.localStorage.removeItem('omni_nr_auth_backup_v1');
                    win.localStorage.removeItem('access');
                    win.localStorage.removeItem('refresh');
                    st.user.user = null;

                    // Hydrate Mobile from OmniTactica server
                    await win.__omnitacticaNrBridge.hydrateFromOmniTactica(true);
                    await loadHubArmyLists();

                    const authBtn = document.getElementById('hub-btn-nr-studio-auth');
                    return {
                        mobileAccess: win.localStorage.getItem('access'),
                        mobileRefresh: win.localStorage.getItem('refresh'),
                        mobilePiniaLogin: st.user.user ? st.user.user.login : null,
                        authBtnText: authBtn ? authBtn.textContent.trim() : ''
                    };
                })()
                """
            )
            record(
                "T2: Opening OmniTactica on Mobile automatically hydrates NewRecruit session ('hsiehjun') without prompting to log in again",
                bool(
                    t2_mobile_autologin
                    and t2_mobile_autologin.get("mobileAccess") == mock_access_jwt
                    and t2_mobile_autologin.get("mobileRefresh") == mock_refresh_jwt
                    and t2_mobile_autologin.get("mobilePiniaLogin") == "hsiehjun"
                    and "Logout (hsiehjun)" in t2_mobile_autologin.get("authBtnText", "")
                ),
                json.dumps(t2_mobile_autologin),
            )

            # T5: Multi-User Isolation — User B ('user_beta') must NOT receive User A's ('user_innes') NewRecruit credentials
            t5_isolation = await t.js(
                """
                (async () => {
                    const resBeta = await (await fetch('/api/armylists/nr_state', {
                        headers: { 'X-Test-User': 'user_beta' }
                    })).json();
                    const resInnes = await (await fetch('/api/armylists/nr_state', {
                        headers: { 'X-Test-User': 'user_innes' }
                    })).json();
                    return {
                        betaCloud: resBeta.cloud_account,
                        innesCloud: resInnes.cloud_account
                    };
                })()
                """
            )
            record(
                "T5: Multi-User Isolation — User B ('user_beta') does not receive User A's ('user_innes') NewRecruit credentials",
                bool(
                    t5_isolation
                    and t5_isolation.get("betaCloud", {}).get("connected") is False
                    and not t5_isolation.get("betaCloud", {}).get("access")
                    and t5_isolation.get("innesCloud", {}).get("connected") is True
                    and t5_isolation.get("innesCloud", {}).get("login") == "hsiehjun"
                ),
                json.dumps(t5_isolation),
            )

            # T3 & T4: Logout on Desktop and verify logout propagates to Mobile on next hydration
            await t.set_viewport(1440, 900, scale=1, mobile=False)
            t3_t4_logout_sync = await t.js(
                f"""
                (async () => {{
                    const ifr = document.getElementById('hub-nr-studio-iframe');
                    const win = ifr.contentWindow;
                    const st = win.__omnitacticaNrBridge.getNrStores();

                    // Device A (Desktop) clicks Logout via triggerNewRecruitStudioAuth()
                    await triggerNewRecruitStudioAuth();
                    await new Promise(r => setTimeout(r, 200));

                    const nrStateAfterLogout = await (await fetch('/api/armylists/nr_state', {{
                        headers: {{ 'Authorization': 'Bearer ' + (window.api.getAuthToken() || '') }}
                    }})).json();

                    // Now simulate Device B (Mobile) which still had the old synced_to_server backup in localStorage
                    win.localStorage.setItem('access', {json.dumps(mock_access_jwt)});
                    win.localStorage.setItem('refresh', {json.dumps(mock_refresh_jwt)});
                    win.localStorage.setItem('omni_nr_auth_backup_v1', JSON.stringify({{
                        access: {json.dumps(mock_access_jwt)},
                        refresh: {json.dumps(mock_refresh_jwt)},
                        user: {{ id: 42, login: 'hsiehjun', supporter: 2, tier: 2 }},
                        synced_to_server: true
                    }}));
                    st.user.user = {{ id: 42, login: 'hsiehjun', supporter: 2, tier: 2 }};

                    // When Device B hydrates from OmniTactica, it sees disconnected_at and clears its local session
                    await win.__omnitacticaNrBridge.hydrateFromOmniTactica(true);
                    await loadHubArmyLists();

                    const authBtnAfter = document.getElementById('hub-btn-nr-studio-auth');
                    return {{
                        serverConnectedAfterLogout: nrStateAfterLogout.cloud_account.connected,
                        serverDisconnectedAt: nrStateAfterLogout.cloud_account.disconnected_at,
                        deviceBAccessAfterHydrate: win.localStorage.getItem('access'),
                        deviceBUserAfterHydrate: st.user.user,
                        authBtnTextAfter: authBtnAfter ? authBtnAfter.textContent.trim() : ''
                    }};
                }})()
                """
            )
            record(
                "T3 & T4: Logging out on Desktop clears server credentials and automatically logs out Mobile on next hydration",
                bool(
                    t3_t4_logout_sync
                    and t3_t4_logout_sync.get("serverConnectedAfterLogout") is False
                    and bool(t3_t4_logout_sync.get("serverDisconnectedAt"))
                    and t3_t4_logout_sync.get("deviceBAccessAfterHydrate") is None
                    and not (t3_t4_logout_sync.get("deviceBUserAfterHydrate") or {}).get("login")
                    and "Login" in t3_t4_logout_sync.get("authBtnTextAfter", "")
                ),
                json.dumps(t3_t4_logout_sync),
            )

            # =====================================================================
            # PART 4: LIVE MFM POINTS PROPAGATION (2000 -> 1980) ACROSS ALL 3 VIEWS (T6 - T7)
            # =====================================================================
            print("\n--- PART 4: Live MFM Points Propagation (2000 -> 1980) Across Edit Mode, /app/MyLists, & My Hub (T6 - T7) ---")
            t6_t7_points_propagation = await t.js(
                """
                (async () => {
                    const ifr = document.getElementById('hub-nr-studio-iframe');
                    const win = ifr.contentWindow;
                    const st = win.__omnitacticaNrBridge.getNrStores();
                    const sys = (await st.system.selectSystem(827374861)) || st.system.selectedSystem;

                    // Compile a real native Necrons catalogue army from GW text using NewRecruit's parser
                    const sampleNecronsText = [
                        'ShatterStar Voidlord (2000 Points)',
                        'Necrons',
                        'Canoptek Court',
                        'Strike Force (2000 Points)',
                        '',
                        'CHARACTERS',
                        '',
                        'Overlord (85 Points)',
                        '  • Warlord'
                    ].join('\\n');

                    const tempRow = {
                        list_key: 'shatter1',
                        name: 'ShatterStar Voidlord',
                        id_system: 827374861,
                        id_book: 1694145926,
                        bsid_system: 'sys-352e-adc2-7639-d610',
                        bsid_book: 'b97e-2284-3251-9b14',
                        totalCost: 2000,
                        _omnitactica_gw_text: sampleNecronsText,
                        _synthetic_text: sampleNecronsText
                    };
                    await win.__omnitacticaNrBridge.compileSyntheticRowIfNeeded(tempRow, st.system, st.list, true);

                    // Now convert tempRow into a genuine NATIVE NewRecruit list (no _compiled_by_nr, no _synthetic_text)
                    // whose stored row.totalCost is stale (2000), while its live catalogue army costs 1980 pts!
                    const nativeArmyJson = JSON.parse(JSON.stringify(tempRow.army));
                    const nativeRow = {
                        list_key: 'shatter1',
                        name: 'ShatterStar Voidlord',
                        id_system: 827374861,
                        id_book: 1694145926,
                        bsid_system: 'sys-352e-adc2-7639-d610',
                        bsid_book: 'b97e-2284-3251-9b14',
                        nrversion: tempRow.nrversion || 24,
                        totalCost: 2000,
                        totalCosts: { pts: 2000 },
                        date_mod: '2026-10-01 00:10:00',
                        version: 5,
                        synced: 1,
                        metadata: { play_mode: false },
                        army: nativeArmyJson
                    };

                    // Also create a synthetic plain-text BCP list ('BCP Imported Roster') with explicit 1990 pts
                    // whose compiled units only cost ~85 pts, to verify T7 (synthetic BCP list preserves 1990 pts)
                    const bcpSynthRow = {
                        list_key: 'bcp1990',
                        name: 'BCP Imported Roster',
                        id_system: 827374861,
                        id_book: 1694145926,
                        bsid_system: 'sys-352e-adc2-7639-d610',
                        bsid_book: 'b97e-2284-3251-9b14',
                        nrversion: tempRow.nrversion || 24,
                        totalCost: 1990,
                        totalCosts: { pts: 1990 },
                        _compiled_by_nr: true,
                        _compiled_pts_sum: tempRow._compiled_pts_sum || 85,
                        _synthetic_text: sampleNecronsText,
                        date_mod: '2026-10-01 00:10:00',
                        version: 1,
                        synced: 1,
                        metadata: { play_mode: true },
                        army: JSON.parse(JSON.stringify(tempRow.army))
                    };

                    // Patch sys.loadList so when 'shatter1' is loaded against the live MFM catalogue, its live army.getPointsCost() is 1980
                    const origLoadList = sys.loadList.bind(sys);
                    sys.loadList = async function(r, fb) {
                        const loaded = await origLoadList(r, fb);
                        if (loaded && loaded.army && r && r.list_key === 'shatter1') {
                            loaded.army.getPointsCost = function() { return 1980; };
                        }
                        return loaded;
                    };

                    // Seed Pinia & IndexedDB with stale totalCost: 2000 for shatter1 and 1990 for bcp1990
                    st.list.listData.splice(0, st.list.listData.length, nativeRow, bcpSynthRow);
                    await win.__omnitacticaNrBridge.upsertSingleRowToIdb(nativeRow);
                    await win.__omnitacticaNrBridge.upsertSingleRowToIdb(bcpSynthRow);

                    // 1. Open 'shatter1' in NewRecruit Edit Mode via stores.list.selectList(nativeRow)
                    await st.list.selectList(nativeRow);
                    await win.__omnitacticaNrBridge.forceFullSync(false);
                    await new Promise(r => setTimeout(r, 400));

                    const editModePts = st.list.currentList && st.list.currentList.army
                        ? st.list.currentList.army.getPointsCost()
                        : null;
                    const piniaRowAfterSelect = st.list.listData.find(r => r && r.list_key === 'shatter1');
                    const piniaBcpRow = st.list.listData.find(r => r && r.list_key === 'bcp1990');

                    // Wait for syncUpsertRow to finish updating OmniTactica backend & My Hub
                    for (let i = 0; i < 20; i++) {
                        await loadHubArmyLists();
                        const hubShatter = (window.hubSavedLists || []).find(l => l.list_key === 'shatter1' || l.id === 'nr_shatter1');
                        if (hubShatter && Number(hubShatter.points) === 1980) break;
                        await new Promise(r => setTimeout(r, 150));
                    }

                    // Also verify nr_state does NOT stamp _synthetic_text onto nativeRow ('shatter1')
                    const nrStatePayload = await (await fetch('/api/armylists/nr_state')).json();
                    const stateShatter = (nrStatePayload.nr_rows || []).find(r => r && r.list_key === 'shatter1');
                    const stateBcp = (nrStatePayload.nr_rows || []).find(r => r && r.list_key === 'bcp1990');

                    const hubShatterFinal = (window.hubSavedLists || []).find(l => l.list_key === 'shatter1' || l.id === 'nr_shatter1');
                    const hubBcpFinal = (window.hubSavedLists || []).find(l => l.list_key === 'bcp1990' || l.id === 'nr_bcp1990');

                    const hubCardEl = document.querySelector('.hub-rec-card[data-list-key="shatter1"]');
                    const hubCardText = hubCardEl ? hubCardEl.innerText : '';

                    return {
                        editModePts,
                        piniaMyListsTotalCost: piniaRowAfterSelect ? piniaRowAfterSelect.totalCost : null,
                        hubShatterPoints: hubShatterFinal ? hubShatterFinal.points : null,
                        hubCardShows1980: hubCardText.includes('1980 PTS'),
                        nativeRowHasSyntheticTextInNrState: Boolean(stateShatter && stateShatter._synthetic_text),
                        bcpPiniaTotalCost: piniaBcpRow ? piniaBcpRow.totalCost : null,
                        bcpStateTotalCost: stateBcp ? stateBcp.totalCost : null,
                        bcpHubPoints: hubBcpFinal ? hubBcpFinal.points : null
                    };
                })()
                """
            )
            record(
                "T6: Native NewRecruit list ('ShatterStar Voidlord') with stale 2000 pts updates to 1980 pts across Edit Mode, /app/MyLists, and My Hub",
                bool(
                    t6_t7_points_propagation
                    and t6_t7_points_propagation.get("editModePts") == 1980
                    and t6_t7_points_propagation.get("piniaMyListsTotalCost") == 1980
                    and t6_t7_points_propagation.get("hubShatterPoints") == 1980
                    and t6_t7_points_propagation.get("hubCardShows1980") is True
                    and t6_t7_points_propagation.get("nativeRowHasSyntheticTextInNrState") is False
                ),
                json.dumps(t6_t7_points_propagation),
            )
            record(
                "T7: Synthetic BCP plain-text imported list preserves its explicit 1990 pts total across Pinia, nr_state, and My Hub",
                bool(
                    t6_t7_points_propagation
                    and t6_t7_points_propagation.get("bcpPiniaTotalCost") == 1990
                    and t6_t7_points_propagation.get("bcpStateTotalCost") == 1990
                    and (t6_t7_points_propagation.get("bcpHubPoints") in (1990, None))
                ),
                json.dumps(t6_t7_points_propagation),
            )

            # =====================================================================
            # PART 5: VERIFY /app/MyLists totalCosts ARRAY [{value: 1980}] + SINGLE SOURCE OF TRUTH
            # =====================================================================
            print("\n--- PART 5: Verify /app/MyLists totalCosts Array [{value: 1980}] & Single Source of Truth ---")
            t8_array_total_costs = await t.js(
                """
                (async () => {
                    const ifr = document.getElementById('hub-nr-studio-iframe');
                    const win = ifr.contentWindow;
                    const st = win.__nr_stores;

                    // 1. Seed OmniTactica backend with a STALE 2000 pts version of 'shatter1'
                    await fetch('/api/armylists/nr_sync', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + (window.api.getAuthToken() || '')
                        },
                        body: JSON.stringify({
                            action: 'upsert',
                            list: {
                                list_key: 'shatter1',
                                name: 'ShatterStar Voidlord',
                                id_system: 827374861,
                                id_book: 1694145926,
                                bsid_system: 'sys-352e-adc2-7639-d610',
                                bsid_book: 'b97e-2284-3251-9b14',
                                totalCost: 2000,
                                totalCosts: { pts: 2000 },
                                _compiled_by_nr: true,
                                _compiled_pts_sum: 2000,
                                date_mod: '2026-10-01 00:05:00'
                            }
                        })
                    });

                    // 2. In NewRecruit Pinia (/app/MyLists), simulate the exact state after refreshAllListCosts():
                    //    totalCost is still scalar 2000, while totalCosts is an Array [{ name: 'pts', typeId: 'pts', value: 1980 }]
                    //    and _compiled_by_nr is true with _compiled_pts_sum = 1980.
                    const piniaRow = st.list.listData.find(r => r && r.list_key === 'shatter1');
                    if (piniaRow) {
                        piniaRow.totalCost = 2000;
                        piniaRow.totalCosts = [{ name: 'pts', typeId: 'pts', value: 1980 }];
                        piniaRow._compiled_by_nr = true;
                        piniaRow._compiled_pts_sum = 1980;
                        delete piniaRow.army;
                    }

                    // 3. Force a full sync from NewRecruit to My Hub and reload My Hub lists
                    await win.__omnitacticaNrBridge.forceFullSync(false);
                    await new Promise(r => setTimeout(r, 350));
                    await loadHubArmyLists();

                    const hubShatter = (window.hubSavedLists || []).find(l => l.list_key === 'shatter1' || l.id === 'nr_shatter1');
                    const hubCardEl = document.querySelector('.hub-rec-card[data-list-key="shatter1"]');
                    const hubCardText = hubCardEl ? hubCardEl.innerText : '';

                    return {
                        piniaTotalCostAfterSync: piniaRow ? piniaRow.totalCost : null,
                        hubPoints: hubShatter ? hubShatter.points : null,
                        hubCardShows1980: hubCardText.includes('1980 PTS'),
                        hubCardText
                    };
                })()
                """
            )
            record(
                "T8: Row with scalar totalCost: 2000 and array totalCosts: [{value: 1980}] syncs 1980 PTS to My Hub without being overwritten by stale backend 2000 PTS",
                bool(
                    t8_array_total_costs
                    and t8_array_total_costs.get("piniaTotalCostAfterSync") == 1980
                    and t8_array_total_costs.get("hubPoints") == 1980
                    and t8_array_total_costs.get("hubCardShows1980") is True
                ),
                json.dumps(t8_array_total_costs),
            )

            print("\n" + "=" * 88)
            print(f"🎉 ALL {len(checks)} / {len(checks)} LIVE MFM & CROSS-DEVICE SYNC CHECKS PASSED!")
            print("=" * 88)

    finally:
        if chrome_proc:
            chrome_proc.terminate()
            try:
                chrome_proc.wait(timeout=3)
            except Exception:
                chrome_proc.kill()
        server_proc.terminate()
        try:
            server_proc.wait(timeout=3)
        except Exception:
            server_proc.kill()


if __name__ == "__main__":
    asyncio.run(main())
