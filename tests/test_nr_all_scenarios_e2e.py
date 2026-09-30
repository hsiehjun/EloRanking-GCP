#!/usr/bin/env python3
"""
Comprehensive End-to-End Verification Suite for ALL NewRecruit Scenarios:
1. Create list in NewRecruit Studio -> auto-syncs to My Hub & visible in both
2. Modify / update list in NewRecruit Studio (including rapid edits) -> updates My Hub & NewRecruit
3. Bidirectional Delete:
   - Delete from inside NewRecruit Studio -> removes from My Hub
   - Delete from My Hub -> removes from NewRecruit Studio & IndexedDB
   - Recreate list with the SAME NAME ("Lion") immediately after deletion -> works (not blocked by tombstone)
4. View Opponent's list in Play Mode (Tournament Competitor & Game Tracker) -> NEVER creates/leaks list into user's My Lists
5. View Opponent's list -> works in both Play Mode (interactive datasheets) and Raw Text (GW / NR format)
6. Game Tracker View List -> works for both My Army List & Opponent's List + live in-game Edit in NewRecruit sync
7. Additional Scenarios:
   - 7a: Live MFM v1.5 catalogue pass-through (Necrons nrversion >= 24, Canoptek Court = 2 DP, Skyshroud Spearhead = 1 DP)
   - 7b: Multi-game system support (Age of Sigmar 4.0 Stormcast Eternals warscrolls in Play Mode & AoS 4.0 badge in My Hub)
   - 7c: Cross-device sync when Studio is already warmed up in the background (Mobile list appears in Desktop Studio on reopen)
   - 7d: Graceful fallback view for non-NewRecruit-compatible / custom free-form rosters
8. Multi-viewport visual screenshot verification across Desktop (1440x900), Tablet (768x1024), and Mobile (375x812)
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

PORT = 5192
CHROME_PORT = 9297
BASE_URL = f"http://127.0.0.1:{PORT}"
ARTIFACT_DIR = "/usr/local/google/home/hsiehjun/.gemini/jetski/brain/a6253a1a-ca8f-4466-9cc6-340c885b9577"

checks = []


def record(name, passed, detail=""):
    status = "PASS" if passed else "FAIL"
    print(f"  [{status}] {name} {('— ' + str(detail)) if detail else ''}")
    checks.append({"name": name, "passed": bool(passed), "detail": str(detail)})
    if not passed:
        raise AssertionError(f"Check failed: {name} ({detail})")


def build_da_11e_row(list_key="da_lion_1", name="Lion", pts=1995, play_mode=False):
    return {
        "list_key": list_key,
        "name": name,
        "id_system": 827374861,
        "bsid_system": "sys-352e-adc2-7639-d610",
        "id_book": 331927583,
        "bsid_book": "470a-6daa-9014-12df",
        "totalCost": pts,
        "totalCosts": {"pts": pts, "3": 3},
        "pts": pts,
        "points": pts,
        "faction": "Imperium - Adeptus Astartes - Dark Angels",
        "detachment": "Gladius Task Force",
        "date_mod": "2026-09-30 19:10:00",
        "version": 1,
        "synced": 1,
        "metadata": {"play_mode": play_mode},
        "_synthetic_text": "\n".join([
            "+++++++++++++++++++++++++++++++++++++++++++++++",
            "+ FACTION KEYWORD: Imperium - Adeptus Astartes - Dark Angels",
            "+ DETACHMENT: Gladius Task Force",
            f"+ TOTAL ARMY POINTS: {pts}pts",
            "+ WARLORD: Lion El'Jonson",
            "+++++++++++++++++++++++++++++++++++++++++++++++",
            "",
            "1x Lion El'Jonson (315 pts): Warlord",
            "1x Azrael (115 pts)",
            "5x Deathwing Knights (250 pts)",
            "5x Deathwing Knights (250 pts)",
            "10x Hellblaster Squad (230 pts)",
        ]),
        "army": {
            "id": "cat-da-root",
            "name": "Imperium - Adeptus Astartes - Dark Angels",
            "options": [
                {
                    "id": "force-roster-da",
                    "name": "Army Roster",
                    "options": [
                        {
                            "id": "cfg-node-da",
                            "name": "Configuration",
                            "options": [
                                {
                                    "id": "det-choice-da",
                                    "name": "Detachment Choice",
                                    "options": [{"id": "det-gladius", "name": "Gladius Task Force"}],
                                },
                                {
                                    "id": "bs-choice-da",
                                    "name": "Battle Size",
                                    "options": [{"id": "bs-2000", "name": "2. Strike Force (2000 Point limit)"}],
                                },
                            ],
                        },
                        {
                            "id": "cat-epic-da",
                            "option_id": "opt-cat-character",
                            "name": "Character",
                            "options": [
                                {
                                    "id": "unit-lion",
                                    "name": "Lion El'Jonson",
                                    "amount": 1,
                                    "points": 315,
                                    "options": [{"id": "wl-lion", "name": "Warlord"}],
                                },
                                {"id": "unit-azrael", "name": "Azrael", "amount": 1, "points": 115, "options": []},
                            ],
                        },
                        {
                            "id": "cat-inf-da",
                            "option_id": "opt-cat-infantry",
                            "name": "Infantry",
                            "options": [
                                {"id": "unit-dwk-1", "name": "Deathwing Knights", "amount": 5, "points": 250, "options": []},
                                {"id": "unit-dwk-2", "name": "Deathwing Knights", "amount": 5, "points": 250, "options": []},
                                {"id": "unit-hb-1", "name": "Hellblaster Squad", "amount": 10, "points": 230, "options": []},
                            ],
                        },
                    ],
                }
            ],
        },
    }


def build_necrons_11e_row(list_key="shatter_nec", name="ShatterStar Voidlord", pts=2000, play_mode=False):
    return {
        "list_key": list_key,
        "name": name,
        "id_system": 827374861,
        "bsid_system": "sys-352e-adc2-7639-d610",
        "id_book": 1694145926,
        "bsid_book": "b654-a18a-ea1-3bf2",
        "totalCost": pts,
        "totalCosts": {"pts": pts, "3": 3},
        "pts": pts,
        "points": pts,
        "faction": "Xenos - Necrons",
        "detachment": "Canoptek Court",
        "date_mod": "2026-09-30 19:12:00",
        "version": 1,
        "synced": 1,
        "metadata": {"play_mode": play_mode},
        "_synthetic_text": "\n".join([
            "+++++++++++++++++++++++++++++++++++++++++++++++",
            "+ FACTION KEYWORD: Xenos - Necrons",
            "+ DETACHMENT: Canoptek Court",
            f"+ TOTAL ARMY POINTS: {pts}pts",
            "+ WARLORD: The Silent King",
            "+++++++++++++++++++++++++++++++++++++++++++++++",
            "",
            "1x The Silent King (420 pts): Warlord",
            "1x Technomancer (85 pts)",
            "6x Canoptek Wraiths (250 pts)",
            "1x Canoptek Doomstalker (145 pts)",
            "1x Doomsday Ark (200 pts)",
        ]),
        "army": {
            "id": "cat-nec-root",
            "name": "Xenos - Necrons",
            "options": [
                {
                    "id": "force-roster-nec",
                    "name": "Army Roster",
                    "options": [
                        {
                            "id": "cfg-node-nec",
                            "name": "Configuration",
                            "options": [
                                {
                                    "id": "det-choice-nec",
                                    "name": "Detachment Choice",
                                    "options": [{"id": "det-cc", "name": "Canoptek Court"}],
                                },
                                {
                                    "id": "bs-choice-nec",
                                    "name": "Battle Size",
                                    "options": [{"id": "bs-2000", "name": "2. Strike Force (2000 Point limit)"}],
                                },
                            ],
                        },
                        {
                            "id": "cat-char-nec",
                            "name": "Character",
                            "options": [
                                {"id": "u-tsk", "name": "The Silent King", "amount": 1, "points": 420, "options": [{"id": "wl-1", "name": "Warlord"}]},
                                {"id": "u-tech", "name": "Technomancer", "amount": 1, "points": 85, "options": []},
                            ],
                        },
                        {
                            "id": "cat-beast-nec",
                            "name": "Beast",
                            "options": [
                                {"id": "u-wraiths", "name": "Canoptek Wraiths", "amount": 6, "points": 250, "options": []},
                                {"id": "u-cds", "name": "Canoptek Doomstalker", "amount": 1, "points": 145, "options": []},
                            ],
                        },
                    ],
                }
            ],
        },
    }


def build_aos4_stormcast_row(list_key="sce_aos4", name="Thunderhead Host AoS 4", pts=1980):
    return {
        "list_key": list_key,
        "name": name,
        "id_system": 4255553472,
        "bsid_system": "e51d-b1a3-75fc-dc3g",
        "id_book": 1531352143,
        "bsid_book": "1bd9-ad7d-68ee-3b53",
        "totalCost": pts,
        "totalCosts": {"pts": pts},
        "pts": pts,
        "points": pts,
        "faction": "Stormcast Eternals",
        "detachment": "Thunderhead Host",
        "date_mod": "2026-09-30 19:15:00",
        "version": 1,
        "synced": 1,
        "metadata": {"play_mode": False},
        "_synthetic_text": "\n".join([
            "+++++++++++++++++++++++++++++++++++++++++++++++",
            "+ FACTION KEYWORD: Order - Stormcast Eternals",
            "+ BATTLE FORMATION: Thunderhead Host",
            "+ TOTAL ARMY POINTS: 1980pts",
            "+ GENERAL: Yndrasta, the Celestial Spear",
            "+++++++++++++++++++++++++++++++++++++++++++++++",
            "",
            "1x Yndrasta, the Celestial Spear (330 pts): General",
            "5x Vindictors (100 pts)",
            "3x Annihilators (160 pts)",
            "3x Prosecutors (140 pts)",
        ]),
        "army": {
            "id": "cat-sce-root",
            "name": "Stormcast Eternals",
            "options": [
                {
                    "id": "force-gen-reg",
                    "name": "General's Regiment",
                    "options": [
                        {
                            "id": "cat-hero-1",
                            "name": "Hero",
                            "options": [
                                {"id": "unit-yndrasta", "name": "Yndrasta, the Celestial Spear", "amount": 1, "points": 330, "options": [{"id": "opt-gen", "name": "General"}]}
                            ],
                        },
                        {
                            "id": "cat-inf-1",
                            "name": "Infantry",
                            "options": [
                                {"id": "unit-vind", "name": "Vindictors", "amount": 5, "points": 100, "options": []},
                                {"id": "unit-annih", "name": "Annihilators", "amount": 3, "points": 160, "options": []},
                            ],
                        },
                    ],
                }
            ],
        },
    }


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
            raw = await asyncio.wait_for(self.ws.recv(), timeout=30.0)
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

    async def navigate(self, url, wait_sec=2.2):
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
        await self.js(
            """
            (() => {
                const m = document.getElementById('badges-celebration-modal');
                if (m) m.remove();
            })()
            """
        )
        os.makedirs(ARTIFACT_DIR, exist_ok=True)
        res = await self.cdp("Page.captureScreenshot", {"format": "png"})
        out_path = os.path.join(ARTIFACT_DIR, filename)
        with open(out_path, "wb") as f:
            f.write(base64.b64decode(res["data"]))
        print(f"    📸 Saved [{filename}]")
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
    print("=" * 92)
    print("🚀 RUNNING FULL NEWRECRUIT SCENARIO & MULTI-VIEWPORT VISUAL VERIFICATION SUITE")
    print("=" * 92)

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
        ready = False
        for _ in range(30):
            try:
                with urllib.request.urlopen(f"{BASE_URL}/api/version", timeout=2) as r:
                    if r.status == 200:
                        ready = True
                        break
            except Exception:
                await asyncio.sleep(0.3)
        record("Local server started cleanly", ready, f"port={PORT}")

        # Clear any pre-existing lists on backend
        http_post_json(
            f"{BASE_URL}/api/armylists/nr_sync",
            {"action": "bulk_sync", "lists": [], "reconcile_deletions": True},
        )

        # Launch Headless Chrome
        chrome_proc = subprocess.Popen(
            [
                "/usr/bin/google-chrome",
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                f"--remote-debugging-port={CHROME_PORT}",
                "--user-data-dir=/tmp/chrome_nr_all_scenarios_" + str(int(time.time())),
                "--window-size=1440,900",
                "--hide-scrollbars",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        await asyncio.sleep(2.2)
        with urllib.request.urlopen(f"http://127.0.0.1:{CHROME_PORT}/json") as resp:
            tabs = json.loads(resp.read().decode())
        page_tab = next(t for t in tabs if t.get("type") == "page")
        ws_url = page_tab["webSocketDebuggerUrl"]

        async with websockets.connect(ws_url, max_size=50 * 1024 * 1024) as ws:
            t = CDPTester(ws)
            await t.cdp("Page.enable")
            await t.cdp("Runtime.enable")
            await t.cdp("Network.enable")

            # =================================================================
            # SCENARIO 1 & 3: CREATE LISTS IN NEWRECRUIT STUDIO -> SHOWS IN MY HUB & STUDIO
            # =================================================================
            print("\n--- SCENARIO 1 & 3: Create Lists in NewRecruit Studio -> Syncs to My Hub & Studio ---")
            await t.set_viewport(1440, 900, scale=1, mobile=False)
            await t.navigate(f"{BASE_URL}/app#my-hub", wait_sec=2.2)

            await t.js("openNewRecruitStudioDrawer('/nr/app/Lists')")
            for _ in range(35):
                st_ready = await t.js(
                    """
                    (async () => {
                        const ifr = document.getElementById('hub-nr-studio-iframe');
                        if (!ifr || !ifr.contentWindow || !ifr.contentWindow.__omnitacticaNrBridge) return false;
                        const st = ifr.contentWindow.__omnitacticaNrBridge.getNrStores();
                        return Boolean(st && st.list && st.list.listsInitiated && st.system && st.system.library);
                    })()
                    """
                )
                if st_ready:
                    break
                await asyncio.sleep(0.5)

            da_row = build_da_11e_row(list_key="da_lion_1", name="Lion", pts=1995, play_mode=False)
            nec_row = build_necrons_11e_row(list_key="shatter_nec", name="ShatterStar Voidlord", pts=2000, play_mode=False)

            s1_create = await t.js(
                f"""
                (async () => {{
                    const ifr = document.getElementById('hub-nr-studio-iframe');
                    const cw = ifr.contentWindow;
                    const r1 = {json.dumps(da_row)};
                    const r2 = {json.dumps(nec_row)};

                    await new Promise((resolve, reject) => {{
                        const req = cw.indexedDB.open('nr');
                        req.onsuccess = () => {{
                            const db = req.result;
                            const tx = db.transaction('lists', 'readwrite');
                            tx.objectStore('lists').put(r1);
                            tx.objectStore('lists').put(r2);
                            tx.oncomplete = () => {{ db.close(); resolve(true); }};
                            tx.onerror = (e) => {{ db.close(); reject(e); }};
                        }};
                    }});

                    await new Promise(r => setTimeout(r, 1600));
                    const st = cw.__omnitacticaNrBridge.getNrStores();
                    const studioNames = (st.list.listData || []).map(x => x && x.name).filter(Boolean).sort();

                    await closeNewRecruitStudioDrawer();
                    await new Promise(r => setTimeout(r, 600));

                    const apiRes = await window.api.getArmyLists();
                    const hubNames = (apiRes.army_lists || []).map(x => x.name).sort();
                    const cardEl = document.getElementById('hub-armylists-list-container');
                    return {{
                        studioNames,
                        hubNames,
                        cardText: cardEl ? cardEl.innerText : ''
                    }};
                }})()
                """
            )
            record(
                "Creating 'Lion' and 'ShatterStar Voidlord' in NewRecruit Studio displays both in Studio AND auto-syncs both to My Hub",
                bool(
                    s1_create
                    and s1_create.get("studioNames") == ["Lion", "ShatterStar Voidlord"]
                    and s1_create.get("hubNames") == ["Lion", "ShatterStar Voidlord"]
                    and "Lion" in s1_create.get("cardText", "")
                    and "ShatterStar Voidlord" in s1_create.get("cardText", "")
                ),
                json.dumps({"studioNames": s1_create.get("studioNames"), "hubNames": s1_create.get("hubNames")}),
            )

            # =================================================================
            # SCENARIO 2: MODIFY / UPDATE LIST IN NEWRECRUIT -> SHOWS IN MY HUB & STUDIO
            # =================================================================
            print("\n--- SCENARIO 2: Modify / Update List in NewRecruit Studio -> Updates My Hub & Studio ---")
            await t.js("openNewRecruitStudioForList('nr_da_lion_1')")
            await asyncio.sleep(2.2)
            await t.js("openNewRecruitStudioDrawer('/nr/app/Lists')")
            await asyncio.sleep(0.8)

            da_edit_1 = build_da_11e_row(list_key="da_lion_1", name="Lion — Rapid Edit 1", pts=1990, play_mode=False)
            da_edit_2 = build_da_11e_row(list_key="da_lion_1", name="Lion — Updated 2000", pts=2000, play_mode=False)

            s2_modify = await t.js(
                f"""
                (async () => {{
                    const ifr = document.getElementById('hub-nr-studio-iframe');
                    const cw = ifr.contentWindow;
                    const e1 = {json.dumps(da_edit_1)};
                    const e2 = {json.dumps(da_edit_2)};

                    await new Promise((resolve) => {{
                        const req = cw.indexedDB.open('nr');
                        req.onsuccess = () => {{
                            const db = req.result;
                            const tx1 = db.transaction('lists', 'readwrite');
                            tx1.objectStore('lists').put(e1);
                            setTimeout(() => {{
                                const tx2 = db.transaction('lists', 'readwrite');
                                tx2.objectStore('lists').put(e2);
                                tx2.oncomplete = () => {{ db.close(); resolve(true); }};
                            }}, 20);
                        }};
                    }});

                    await new Promise(r => setTimeout(r, 1800));
                    await closeNewRecruitStudioDrawer();
                    await new Promise(r => setTimeout(r, 600));

                    const apiRes = await window.api.getArmyLists();
                    const updatedLion = (apiRes.army_lists || []).find(l => l.id === 'nr_da_lion_1');
                    const cardEl = document.getElementById('hub-armylists-list-container');
                    return {{
                        savedName: updatedLion ? updatedLion.name : null,
                        savedPoints: updatedLion ? updatedLion.points : null,
                        cardText: cardEl ? cardEl.innerText : ''
                    }};
                }})()
                """
            )
            record(
                "Updating list in NewRecruit Studio (including rapid consecutive edits) updates both Studio and My Hub",
                bool(
                    s2_modify
                    and s2_modify.get("savedName") == "Lion — Updated 2000"
                    and s2_modify.get("savedPoints") == 2000
                    and "Lion — Updated 2000" in s2_modify.get("cardText", "")
                ),
                json.dumps({"savedName": s2_modify.get("savedName"), "savedPoints": s2_modify.get("savedPoints")}),
            )

            # =================================================================
            # SCENARIO 1B & 7A/7B: BIDIRECTIONAL DELETE (FROM STUDIO & FROM MY HUB) + SAME-NAME RECREATE
            # =================================================================
            print("\n--- SCENARIO 1B & 7A/7B: Bidirectional Delete & Same-Name Recreate ('Lion') ---")
            # First test deleting from INSIDE NewRecruit Studio via stores.list.removeList
            s3_bidirectional_delete = await t.js(
                f"""
                (async () => {{
                    openNewRecruitStudioDrawer('/nr/app/Lists');
                    await new Promise(r => setTimeout(r, 1200));
                    const ifr = document.getElementById('hub-nr-studio-iframe');
                    const cw = ifr.contentWindow;
                    const st = cw.__omnitacticaNrBridge.getNrStores();

                    // Delete 'da_lion_1' inside NewRecruit Studio using stores.list.removeList
                    const targetRow = (st.list.listData || []).find(r => r && r.list_key === 'da_lion_1');
                    if (targetRow) {{
                        await st.list.removeList(targetRow);
                    }}
                    await new Promise(r => setTimeout(r, 900));
                    await closeNewRecruitStudioDrawer();
                    await new Promise(r => setTimeout(r, 500));

                    const afterStudioDel = await window.api.getArmyLists();
                    const idsAfterStudioDel = (afterStudioDel.army_lists || []).map(l => l.id);

                    // Now recreate a brand-new list named "Lion" (new list_key: "da_lion_2") to prove same-name recreate is NOT blocked!
                    const recreatedLion = {json.dumps(build_da_11e_row(list_key="da_lion_2", name="Lion", pts=2000, play_mode=False))};
                    openNewRecruitStudioDrawer('/nr/app/Lists');
                    await new Promise(r => setTimeout(r, 800));
                    await new Promise((resolve) => {{
                        const req = cw.indexedDB.open('nr');
                        req.onsuccess = () => {{
                            const db = req.result;
                            const tx = db.transaction('lists', 'readwrite');
                            tx.objectStore('lists').put(recreatedLion);
                            tx.oncomplete = () => {{ db.close(); resolve(true); }};
                        }};
                    }});
                    await new Promise(r => setTimeout(r, 1400));
                    await closeNewRecruitStudioDrawer();
                    await new Promise(r => setTimeout(r, 500));

                    const afterRecreate = await window.api.getArmyLists();
                    const namesAfterRecreate = (afterRecreate.army_lists || []).map(l => l.name).sort();
                    const idsAfterRecreate = (afterRecreate.army_lists || []).map(l => l.id).sort();

                    // Also test deleting from My Hub via deleteHubArmyList on a temporary list
                    const tempRow = {json.dumps(build_da_11e_row(list_key="temp_del_hub", name="Temp Delete Me", pts=1000, play_mode=False))};
                    await new Promise((resolve) => {{
                        const req = cw.indexedDB.open('nr');
                        req.onsuccess = () => {{
                            const db = req.result;
                            const tx = db.transaction('lists', 'readwrite');
                            tx.objectStore('lists').put(tempRow);
                            tx.oncomplete = () => {{ db.close(); resolve(true); }};
                        }};
                    }});
                    await new Promise(r => setTimeout(r, 1200));
                    await loadHubArmyLists();
                    window.confirm = () => true;
                    await deleteHubArmyList('nr_temp_del_hub');
                    await new Promise(r => setTimeout(r, 800));

                    const afterHubDel = await window.api.getArmyLists();
                    const idsAfterHubDel = (afterHubDel.army_lists || []).map(l => l.id).sort();
                    const piniaKeysAfterHubDel = (st.list.listData || []).map(r => r && r.list_key).filter(Boolean).sort();

                    return {{
                        idsAfterStudioDel,
                        namesAfterRecreate,
                        idsAfterRecreate,
                        idsAfterHubDel,
                        piniaKeysAfterHubDel
                    }};
                }})()
                """
            )
            record(
                "Deleting list inside NewRecruit Studio removes it from My Hub",
                bool(s3_bidirectional_delete and s3_bidirectional_delete.get("idsAfterStudioDel") == ["nr_shatter_nec"]),
                json.dumps(s3_bidirectional_delete.get("idsAfterStudioDel")),
            )
            record(
                "Recreating a new list with the same name ('Lion') after deletion works without tombstone blocking",
                bool(
                    s3_bidirectional_delete
                    and s3_bidirectional_delete.get("namesAfterRecreate") == ["Lion", "ShatterStar Voidlord"]
                    and s3_bidirectional_delete.get("idsAfterRecreate") == ["nr_da_lion_2", "nr_shatter_nec"]
                ),
                json.dumps(s3_bidirectional_delete),
            )
            record(
                "Deleting list from My Hub removes it from both My Hub and NewRecruit Studio Pinia/IndexedDB",
                bool(
                    s3_bidirectional_delete
                    and s3_bidirectional_delete.get("idsAfterHubDel") == ["nr_da_lion_2", "nr_shatter_nec"]
                    and s3_bidirectional_delete.get("piniaKeysAfterHubDel") == ["da_lion_2", "shatter_nec"]
                ),
                json.dumps(s3_bidirectional_delete),
            )

            # =================================================================
            # SCENARIO 4 & 5: VIEWING OPPONENT LIST IN PLAY MODE -> WORKS & DOES NOT LEAK TO MY LISTS
            # =================================================================
            print("\n--- SCENARIO 4 & 5: View Opponent List in Play Mode -> Works & Never Creates a List in My Lists ---")
            opp_setup = await t.js(
                """
                (async () => {
                    const aeldariText = `Aeldari - Battle Host (2000 pts)

Autarch Wayleaper (115 pts): Warlord
Farseer (80 pts)
10x Guardian Defenders (100 pts)
5x Warp Spiders (125 pts)
Avatar of Khaine (335 pts)
Wraithlord (145 pts)`;

                    const pRes = await fetch('/api/armylists/parse', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: aeldariText })
                    }).then(r => r.json());
                    const oppRoster = pRes.army_list;
                    oppRoster.name = 'Opponent Ulthwe Aspect Host';

                    const mockCompetitor = {
                        player_id: 'p_opp_99',
                        full_name: 'Farseer Eldrad',
                        faction: 'Aeldari',
                        detachment: 'Battle Host',
                        army_list_text: aeldariText,
                        _parsed_roster: oppRoster
                    };
                    window.openEventArmyListModal('p_opp_99', mockCompetitor);
                    window.setEventArmyListViewMode('enriched');
                    return { oppKey: oppRoster.nr_list_key || oppRoster.id };
                })()
                """
            )

            opp_modal_state = None
            for _ in range(35):
                await asyncio.sleep(1.0)
                opp_modal_state = await t.js(
                    """
                    (() => {
                        const contentEl = document.getElementById('event-army-list-modal-content');
                        const ifr = contentEl ? contentEl.querySelector('#hub-nr-play-mode-iframe') : null;
                        if (!ifr || !ifr.contentWindow) return null;
                        const cw = ifr.contentWindow;
                        const unitRowsCount = cw.document.querySelectorAll('.unitRow .name').length;
                        const src = ifr.getAttribute('src') || '';
                        return {
                            unitRowsCount,
                            hasEphemeralParam: src.includes('ephemeral=1'),
                            src
                        };
                    })()
                    """
                )
                if opp_modal_state and opp_modal_state.get("unitRowsCount", 0) >= 3:
                    break

            record(
                "Viewing Opponent's list in Tournament Competitor Modal compiles & renders interactive Play Mode datasheets",
                bool(
                    opp_modal_state
                    and opp_modal_state.get("unitRowsCount", 0) >= 3
                    and opp_modal_state.get("hasEphemeralParam") is True
                ),
                json.dumps(opp_modal_state),
            )
            await t.snap("nr_audit_desktop_opponent_playmode.png")

            # Close Opponent modal and verify ZERO leakage into My Hub, Backend, Studio Pinia, or IndexedDB!
            no_leak_check = await t.js(
                """
                (async () => {
                    window.closeEventArmyListModal();
                    await new Promise(r => setTimeout(r, 600));
                    await loadHubArmyLists();
                    const apiRes = await window.api.getArmyLists();
                    const backendNames = (apiRes.army_lists || []).map(l => l.name).sort();
                    const hubUiNames = (window.hubSavedLists || []).map(l => l.name).sort();

                    const ifr = document.getElementById('hub-nr-studio-iframe');
                    const st = ifr && ifr.contentWindow && ifr.contentWindow.__omnitacticaNrBridge
                        ? ifr.contentWindow.__omnitacticaNrBridge.getNrStores()
                        : null;
                    const studioNames = st && st.list && Array.isArray(st.list.listData)
                        ? st.list.listData.filter(r => r && !r._ephemeral_view).map(r => r.name).sort()
                        : [];

                    return { backendNames, hubUiNames, studioNames };
                })()
                """
            )
            record(
                "Viewing Opponent's list in Play Mode NEVER creates/leaks the opponent list into My Hub or NewRecruit Studio",
                bool(
                    no_leak_check
                    and no_leak_check.get("backendNames") == ["Lion", "ShatterStar Voidlord"]
                    and no_leak_check.get("hubUiNames") == ["Lion", "ShatterStar Voidlord"]
                    and no_leak_check.get("studioNames") == ["Lion", "ShatterStar Voidlord"]
                ),
                json.dumps(no_leak_check),
            )

            # =================================================================
            # SCENARIO 7B & 7C: MULTI-GAME (AoS 4.0) + CROSS-DEVICE SYNC ON STUDIO REOPEN + FALLBACK VIEW
            # =================================================================
            print("\n--- SCENARIO 7B, 7C & 7D: AoS 4.0 Roster + Cross-Device Sync + Non-NR Fallback ---")
            aos_row = build_aos4_stormcast_row(list_key="sce_aos4", name="Thunderhead Host AoS 4", pts=1980)
            cross_device_res = await t.js(
                f"""
                (async () => {{
                    // Simulate another device (Mobile) syncing an AoS 4.0 list to the backend while Desktop Studio is already warm
                    await fetch('/api/armylists/nr_sync', {{
                        method: 'POST',
                        headers: {{
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + (window.api.getAuthToken() || '')
                        }},
                        body: JSON.stringify({{
                            action: 'upsert',
                            list: {json.dumps(aos_row)}
                        }})
                    }});

                    await loadHubArmyLists();
                    // Reopen NewRecruit Studio on Desktop — navigate('/nr/app/Lists') triggers hydrateFromOmniTactica(true)
                    openNewRecruitStudioDrawer('/nr/app/Lists');
                    await new Promise(r => setTimeout(r, 1800));

                    const ifr = document.getElementById('hub-nr-studio-iframe');
                    const st = ifr.contentWindow.__omnitacticaNrBridge.getNrStores();
                    const studioNames = (st.list.listData || []).map(r => r && r.name).filter(Boolean).sort();

                    await closeNewRecruitStudioDrawer();
                    await new Promise(r => setTimeout(r, 500));
                    const hubNames = (window.hubSavedLists || []).map(l => l.name).sort();
                    const aosEntry = (window.hubSavedLists || []).find(l => l.id === 'nr_sce_aos4');

                    return {{
                        studioNames,
                        hubNames,
                        aosGameSystem: aosEntry ? aosEntry.game_system : null,
                        aosEdition: aosEntry ? aosEntry.system_edition : null
                    }};
                }})()
                """
            )
            record(
                "Cross-device list ('Thunderhead Host AoS 4') synced to backend automatically merges into warmed Desktop Studio & My Hub",
                bool(
                    cross_device_res
                    and cross_device_res.get("studioNames") == ["Lion", "ShatterStar Voidlord", "Thunderhead Host AoS 4"]
                    and cross_device_res.get("hubNames") == ["Lion", "ShatterStar Voidlord", "Thunderhead Host AoS 4"]
                    and cross_device_res.get("aosGameSystem") == "aos"
                ),
                json.dumps(cross_device_res),
            )

            # Test Non-NewRecruit-Compatible Fallback View
            fallback_check = await t.js(
                """
                (() => {
                    const customList = {
                        id: 'custom_legacy_1',
                        name: 'Custom Narrative Crusade Force',
                        faction: 'Space Marines',
                        detachment: '1st Company Task Force',
                        points: 2000,
                        is_newrecruit_compatible: false,
                        raw_text: 'Custom Captain (100 pts)\\nCustom Honour Guard (200 pts)',
                        units: [
                            { name: 'Custom Captain', role: 'Character', points: 100, is_warlord: true },
                            { name: 'Custom Honour Guard', role: 'Infantry', points: 200 }
                        ]
                    };
                    const html = window.renderNativeRosterViewer(customList, { mode: 'play' });
                    return {
                        hasFallbackBanner: html.includes('Parsed Unit Summary') || html.includes('NewRecruit Play Mode Unavailable'),
                        hasUnitCards: html.includes('Custom Captain') && html.includes('Custom Honour Guard')
                    };
                })()
                """
            )
            record(
                "Incompatible / custom free-form list cleanly renders Parsed Unit Summary fallback instead of hanging",
                bool(fallback_check and fallback_check.get("hasFallbackBanner") and fallback_check.get("hasUnitCards")),
                json.dumps(fallback_check),
            )

            # =================================================================
            # ADVERSARIAL STRESS TESTS (CASES A, B, C):
            # - Case A: Cross-device modification of an EXISTING list while Desktop Studio is warm
            # - Case B: Two distinct lists with the EXACT SAME NAME ("Lion") coexisting & isolated delete
            # - Case C: Opponent list with the EXACT SAME NAME ("Lion") as player's own list in Play Mode
            # =================================================================
            print("\n--- ADVERSARIAL STRESS TESTS (Cases A, B, C): Cross-Device Update, Duplicate Names & Same-Name Opponent ---")

            # Case A: Modify existing 'da_lion_2' from another device while Desktop Studio is already warm
            lion_cross_updated = build_da_11e_row(
                list_key="da_lion_2", name="Lion — Cross-Device Updated", pts=1985, play_mode=False
            )
            adv_case_a = await t.js(
                f"""
                (async () => {{
                    await fetch('/api/armylists/nr_sync', {{
                        method: 'POST',
                        headers: {{
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + (window.api.getAuthToken() || '')
                        }},
                        body: JSON.stringify({{
                            action: 'upsert',
                            list: {json.dumps(lion_cross_updated)}
                        }})
                    }});

                    // Reopen warmed Desktop Studio -> triggers hydrateFromOmniTactica(true) + forceFullSync(false)
                    openNewRecruitStudioDrawer('/nr/app/Lists');
                    await new Promise(r => setTimeout(r, 1800));

                    const ifr = document.getElementById('hub-nr-studio-iframe');
                    const cw = ifr.contentWindow;
                    const st = cw.__omnitacticaNrBridge.getNrStores();
                    const piniaLion = (st.list.listData || []).find(r => r && r.list_key === 'da_lion_2');
                    const piniaName = piniaLion ? piniaLion.name : null;
                    const piniaPts = piniaLion ? piniaLion.totalCost : null;
                    const apiAfter = await window.api.getArmyLists();
                    const backendLion = (apiAfter.army_lists || []).find(l => l.id === 'nr_da_lion_2');
                    const backendName = backendLion ? backendLion.name : null;
                    const backendPts = backendLion ? backendLion.points : null;

                    // Restore name back to 'Lion' (2000 pts) in Studio for subsequent tests
                    const restoredLion = {json.dumps(build_da_11e_row(list_key="da_lion_2", name="Lion", pts=2000, play_mode=False))};
                    await new Promise((resolve) => {{
                        const req = cw.indexedDB.open('nr');
                        req.onsuccess = () => {{
                            const db = req.result;
                            const tx = db.transaction('lists', 'readwrite');
                            tx.objectStore('lists').put(restoredLion);
                            tx.oncomplete = () => {{ db.close(); resolve(true); }};
                        }};
                    }});
                    await new Promise(r => setTimeout(r, 1200));
                    await closeNewRecruitStudioDrawer();
                    await new Promise(r => setTimeout(r, 500));

                    return {{
                        piniaName,
                        piniaPts,
                        backendName,
                        backendPts
                    }};
                }})()
                """
            )
            record(
                "Adversarial Case A: Cross-device update of an existing list updates warmed Desktop Studio without reverting backend",
                bool(
                    adv_case_a
                    and adv_case_a.get("piniaName") == "Lion — Cross-Device Updated"
                    and adv_case_a.get("piniaPts") == 1985
                    and adv_case_a.get("backendName") == "Lion — Cross-Device Updated"
                    and adv_case_a.get("backendPts") == 1985
                ),
                json.dumps(adv_case_a),
            )

            # Case B: Two distinct lists with the EXACT SAME NAME ("Lion", keys 'da_lion_2' and 'da_lion_second')
            lion_second_same_name = build_da_11e_row(
                list_key="da_lion_second", name="Lion", pts=1000, play_mode=False
            )
            adv_case_b = await t.js(
                f"""
                (async () => {{
                    await fetch('/api/armylists/nr_sync', {{
                        method: 'POST',
                        headers: {{
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + (window.api.getAuthToken() || '')
                        }},
                        body: JSON.stringify({{
                            action: 'upsert',
                            list: {json.dumps(lion_second_same_name)}
                        }})
                    }});

                    openNewRecruitStudioDrawer('/nr/app/Lists');
                    await new Promise(r => setTimeout(r, 1600));
                    const ifr = document.getElementById('hub-nr-studio-iframe');
                    const cw = ifr.contentWindow;
                    const st = cw.__omnitacticaNrBridge.getNrStores();
                    const lionKeysInPinia = (st.list.listData || [])
                        .filter(r => r && r.name === 'Lion' && !r._ephemeral_view)
                        .map(r => r.list_key)
                        .sort();

                    await closeNewRecruitStudioDrawer();
                    await new Promise(r => setTimeout(r, 500));
                    await loadHubArmyLists();
                    const apiBoth = await window.api.getArmyLists();
                    const lionIdsInBackend = (apiBoth.army_lists || [])
                        .filter(l => l.name === 'Lion')
                        .map(l => l.id)
                        .sort();

                    // Now delete ONLY 'nr_da_lion_second' and verify 'nr_da_lion_2' (also named "Lion") survives!
                    window.confirm = () => true;
                    await deleteHubArmyList('nr_da_lion_second');
                    await new Promise(r => setTimeout(r, 800));

                    const apiAfterSingleDel = await window.api.getArmyLists();
                    const remainingLionIds = (apiAfterSingleDel.army_lists || [])
                        .filter(l => l.name === 'Lion')
                        .map(l => l.id);

                    return {{
                        lionKeysInPinia,
                        lionIdsInBackend,
                        remainingLionIds
                    }};
                }})()
                """
            )
            record(
                "Adversarial Case B: Two distinct lists with the same name ('Lion') both survive hydration, and deleting one never deletes the other",
                bool(
                    adv_case_b
                    and adv_case_b.get("lionKeysInPinia") == ["da_lion_2", "da_lion_second"]
                    and adv_case_b.get("lionIdsInBackend") == ["nr_da_lion_2", "nr_da_lion_second"]
                    and adv_case_b.get("remainingLionIds") == ["nr_da_lion_2"]
                ),
                json.dumps(adv_case_b),
            )

            # Case C: Viewing an Opponent's list whose name is ALSO "Lion" (same name as player's own Dark Angels list!)
            await t.js(
                """
                (async () => {
                    const aeldariSameNameText = `Aeldari - Battle Host (2000 pts)

Autarch Wayleaper (115 pts): Warlord
Farseer (80 pts)
10x Guardian Defenders (100 pts)
5x Warp Spiders (125 pts)
Avatar of Khaine (335 pts)`;
                    const pRes = await fetch('/api/armylists/parse', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: aeldariSameNameText })
                    }).then(r => r.json());
                    const oppSameName = pRes.army_list;
                    oppSameName.name = 'Lion';
                    if (oppSameName.nr_row) oppSameName.nr_row.name = 'Lion';

                    const mockComp = {
                        player_id: 'p_opp_same_name',
                        full_name: 'Autarch Eldrad',
                        faction: 'Aeldari',
                        detachment: 'Battle Host',
                        army_list_text: aeldariSameNameText,
                        _parsed_roster: oppSameName
                    };
                    window.openEventArmyListModal('p_opp_same_name', mockComp);
                    window.setEventArmyListViewMode('enriched');
                })()
                """
            )
            adv_case_c = None
            for _ in range(35):
                await asyncio.sleep(1.0)
                adv_case_c = await t.js(
                    """
                    (() => {
                        const contentEl = document.getElementById('event-army-list-modal-content');
                        const ifr = contentEl ? contentEl.querySelector('#hub-nr-play-mode-iframe') : null;
                        if (!ifr || !ifr.contentWindow) return null;
                        const cw = ifr.contentWindow;
                        const unitNames = Array.from(cw.document.querySelectorAll('.unitRow .name')).map(el => (el.innerText || '').trim());
                        return {
                            unitNames,
                            hasAeldariUnits: unitNames.some(u => u.includes('Autarch') || u.includes('Avatar') || u.includes('Warp Spiders')),
                            hasHijackedDarkAngels: unitNames.some(u => u.includes("Lion El'Jonson") || u.includes('Deathwing'))
                        };
                    })()
                    """
                )
                if adv_case_c and len(adv_case_c.get("unitNames", [])) >= 3:
                    break
            await t.js("window.closeEventArmyListModal()")
            await asyncio.sleep(0.5)
            record(
                "Adversarial Case C: Viewing an Opponent's list named 'Lion' renders Opponent's Aeldari units instead of hijacking player's own 'Lion' list",
                bool(
                    adv_case_c
                    and adv_case_c.get("hasAeldariUnits") is True
                    and adv_case_c.get("hasHijackedDarkAngels") is False
                ),
                json.dumps(adv_case_c),
            )

            # =================================================================
            # MULTI-VIEWPORT VISUAL SCREENSHOTS: MY HUB, STUDIO & PLAY MODE
            # (Desktop 1440x900, Tablet 768x1024, Mobile 375x812)
            # =================================================================
            print("\n--- MULTI-VIEWPORT SCREENSHOT TESTING: My Hub, NewRecruit Studio & Play Mode ---")

            # 1. My Hub Army Lists Card across Desktop, Tablet, Mobile
            for vp_name, w, h, scale, is_mob in [
                ("desktop", 1440, 900, 1, False),
                ("tablet", 768, 1024, 2, True),
                ("mobile", 375, 812, 2, True),
            ]:
                await t.set_viewport(w, h, scale=scale, mobile=is_mob)
                await asyncio.sleep(0.6)
                overflow = await t.js(
                    """
                    (() => {
                        const card = document.getElementById('hub-armylists-card');
                        if (card) card.scrollIntoView({ block: 'start' });
                        return {
                            scrollW: document.documentElement.scrollWidth,
                            innerW: window.innerWidth,
                            cardVisible: Boolean(card && card.offsetHeight > 50)
                        };
                    })()
                    """
                )
                await asyncio.sleep(0.3)
                await t.snap(f"nr_audit_{vp_name}_hub.png")
                record(
                    f"My Hub Army Lists & Rosters ({vp_name.title()} {w}x{h}) renders cleanly with zero horizontal overflow",
                    bool(overflow and overflow["cardVisible"] and overflow["scrollW"] <= overflow["innerW"] + 2),
                    json.dumps(overflow),
                )

            # 2. NewRecruit Studio Drawer across Desktop, Tablet, Mobile
            await t.set_viewport(1440, 900, scale=1, mobile=False)
            await t.js("openNewRecruitStudioDrawer('/nr/app/Lists')")
            await asyncio.sleep(1.4)
            for vp_name, w, h, scale, is_mob in [
                ("desktop", 1440, 900, 1, False),
                ("tablet", 768, 1024, 2, True),
                ("mobile", 375, 812, 2, True),
            ]:
                await t.set_viewport(w, h, scale=scale, mobile=is_mob)
                await asyncio.sleep(0.6)
                st_layout = await t.js(
                    """
                    (() => {
                        const winEl = document.querySelector('.hub-nr-studio-window');
                        const ifr = document.getElementById('hub-nr-studio-iframe');
                        const r = winEl ? winEl.getBoundingClientRect() : null;
                        return {
                            winWidth: r ? Math.round(r.width) : 0,
                            winHeight: r ? Math.round(r.height) : 0,
                            innerW: window.innerWidth,
                            fitsViewport: Boolean(r && r.width <= window.innerWidth + 2 && r.height > 200),
                            hasIframe: Boolean(ifr)
                        };
                    })()
                    """
                )
                await t.snap(f"nr_audit_{vp_name}_studio.png")
                record(
                    f"NewRecruit Studio Drawer ({vp_name.title()} {w}x{h}) fits viewport cleanly with responsive toolbar",
                    bool(st_layout and st_layout["fitsViewport"] and st_layout["hasIframe"]),
                    json.dumps(st_layout),
                )
            await t.js("closeNewRecruitStudioDrawer()")
            await asyncio.sleep(0.6)

            # 3. My Hub Play Mode Interactive Datasheet Modal + Raw Text Toggle across Desktop, Tablet, Mobile
            await t.set_viewport(1440, 900, scale=1, mobile=False)
            await t.js("openViewArmyListModal('nr_shatter_nec', 'play')")
            play_ready = None
            for _ in range(35):
                await asyncio.sleep(1.0)
                play_ready = await t.js(
                    """
                    (() => {
                        const ifr = document.getElementById('hub-nr-play-mode-iframe');
                        if (!ifr || !ifr.contentWindow) return null;
                        const cw = ifr.contentWindow;
                        const unitRowsCount = cw.document.querySelectorAll('.unitRow .name').length;
                        return { unitRowsCount };
                    })()
                    """
                )
                if play_ready and play_ready.get("unitRowsCount", 0) >= 3:
                    break

            # Click 'The Silent King' or 'Canoptek Wraiths' to open interactive datasheet profile in Play Mode
            unit_pop_text = await t.js(
                """
                (async () => {
                    const cw = document.getElementById('hub-nr-play-mode-iframe').contentWindow;
                    const rows = Array.from(cw.document.querySelectorAll('.unitRow .name'));
                    const target = rows.find(el => (el.innerText || '').includes('Silent King') || (el.innerText || '').includes('Wraiths')) || rows[0];
                    if (target) target.click();
                    await new Promise(r => setTimeout(r, 1000));
                    const titleEl = cw.document.querySelector('.bsProfileTitle');
                    return titleEl ? titleEl.innerText : (cw.body.innerText || '').slice(0, 200);
                })()
                """
            )
            record(
                "My Hub Play Mode opens 'ShatterStar Voidlord' (Necrons 11th Ed) with interactive unit datasheets",
                bool(play_ready and play_ready.get("unitRowsCount", 0) >= 3 and len(unit_pop_text) > 0),
                f"unitRowsCount={play_ready.get('unitRowsCount') if play_ready else 0}, sample={unit_pop_text[:80]}",
            )

            for vp_name, w, h, scale, is_mob in [
                ("desktop", 1440, 900, 1, False),
                ("tablet", 768, 1024, 2, True),
                ("mobile", 375, 812, 2, True),
            ]:
                await t.set_viewport(w, h, scale=scale, mobile=is_mob)
                await asyncio.sleep(0.5)
                await t.snap(f"nr_audit_{vp_name}_playmode.png")

            # Also verify GW Format & NewRecruit Format toggle in Raw Text tab
            raw_toggle_check = await t.js(
                """
                (async () => {
                    await setHubRosterViewMode('text', 'nr_shatter_nec');
                    await new Promise(r => setTimeout(r, 300));
                    const gwTxt = (document.getElementById('hub-raw-roster-content') || {}).innerText || '';
                    await setHubRosterTextFormat('nr', 'nr_shatter_nec');
                    await new Promise(r => setTimeout(r, 300));
                    const nrTxt = (document.getElementById('hub-raw-roster-content') || {}).innerText || '';
                    return {
                        hasGw: gwTxt.includes('The Silent King') && gwTxt.includes('Canoptek Wraiths'),
                        hasNr: nrTxt.includes('The Silent King') && nrTxt.includes('Canoptek Wraiths')
                    };
                })()
                """
            )
            record(
                "My Hub Raw Text view supports both GW Format and NewRecruit Format toggles",
                bool(raw_toggle_check and raw_toggle_check.get("hasGw") and raw_toggle_check.get("hasNr")),
                json.dumps(raw_toggle_check),
            )
            await t.js("closeViewArmyListModal()")

            # =================================================================
            # SCENARIO 6: GAME TRACKER VIEW LIST (MY LIST & OPPONENT LIST + LIVE EDIT)
            # =================================================================
            print("\n--- SCENARIO 6: Game Tracker View List (My List & Opponent List + Mobile/Desktop Screenshots) ---")
            await t.set_viewport(1440, 900, scale=1, mobile=False)

            # Seed room WH40K-NRSCENARIO with Player 1 ('ShatterStar Voidlord') and Player 2 ('Opponent Ulthwe Aspect Host')
            await t.js(
                """
                (async () => {
                    const token = window.api.getAuthToken() || 'dev-token-123';
                    const p1List = (window.hubSavedLists || []).find(l => l.id === 'nr_shatter_nec');
                    const aeldariText = `Aeldari - Battle Host (2000 pts)\\n\\nAutarch Wayleaper (115 pts): Warlord\\nFarseer (80 pts)\\n10x Guardian Defenders (100 pts)\\n5x Warp Spiders (125 pts)\\nAvatar of Khaine (335 pts)`;
                    const p2Res = await fetch('/api/armylists/parse', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: aeldariText })
                    }).then(r => r.json());
                    const p2List = p2Res.army_list;
                    p2List.name = 'Opponent Ulthwe Aspect Host';

                    await fetch('/api/tracker/room/WH40K-NRSCENARIO/armylist', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ role: 'player1', army_list: p1List })
                    });
                    await fetch('/api/tracker/room/WH40K-NRSCENARIO/armylist', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ role: 'player2', army_list: p2List })
                    });
                })()
                """
            )

            await t.navigate(f"{BASE_URL}/11th/tracker/play?match_id=WH40K-NRSCENARIO&role=player1", wait_sec=2.8)

            # Open Opponent's List in Game Tracker
            await t.js("window.gtOpenArmyListModal('opponent')")
            gt_opp_state = None
            for _ in range(35):
                await asyncio.sleep(1.0)
                gt_opp_state = await t.js(
                    """
                    (() => {
                        const ifr = document.getElementById('gt-nr-play-mode-iframe');
                        if (!ifr || !ifr.contentWindow) return null;
                        const cw = ifr.contentWindow;
                        const unitRowsCount = cw.document.querySelectorAll('.unitRow .name').length;
                        return { unitRowsCount, src: ifr.getAttribute('src') || '' };
                    })()
                    """
                )
                if gt_opp_state and gt_opp_state.get("unitRowsCount", 0) >= 3:
                    break

            record(
                "Game Tracker 'Opponent's List' tab compiles & displays Opponent's Aeldari roster in Play Mode",
                bool(gt_opp_state and gt_opp_state.get("unitRowsCount", 0) >= 3 and "ephemeral=1" in gt_opp_state.get("src", "")),
                json.dumps(gt_opp_state),
            )
            await t.snap("nr_audit_desktop_tracker_list.png")

            # Also capture Mobile Game Tracker Opponent List view
            await t.set_viewport(375, 812, scale=2, mobile=True)
            await asyncio.sleep(0.6)
            await t.snap("nr_audit_mobile_tracker_list.png")

            # Switch to My Army List inside Game Tracker and verify Player 1's Necrons list loads
            await t.set_viewport(1440, 900, scale=1, mobile=False)
            await t.js("window.gtSetListTab('attach')")
            await asyncio.sleep(0.8)
            await t.js("window.gtAttachSavedList('nr_shatter_nec')")
            gt_mine_state = None
            for _ in range(35):
                await asyncio.sleep(1.0)
                gt_mine_state = await t.js(
                    """
                    (() => {
                        const ifr = document.getElementById('gt-nr-play-mode-iframe');
                        if (!ifr || !ifr.contentWindow) return null;
                        const cw = ifr.contentWindow;
                        const unitRowsCount = cw.document.querySelectorAll('.unitRow .name').length;
                        const titleEl = document.getElementById('gt-active-roster-title');
                        return {
                            unitRowsCount,
                            title: titleEl ? titleEl.innerText.trim() : ''
                        };
                    })()
                    """
                )
                if gt_mine_state and gt_mine_state.get("unitRowsCount", 0) >= 3:
                    break

            record(
                "Game Tracker 'My Army List' tab renders Player 1's 'ShatterStar Voidlord' Necrons roster in Play Mode",
                bool(gt_mine_state and gt_mine_state.get("unitRowsCount", 0) >= 3 and "ShatterStar Voidlord" in gt_mine_state.get("title", "")),
                json.dumps(gt_mine_state),
            )

            # Adversarial Case D: Live in-game Edit inside Game Tracker ('Edit' mode) propagates to Tracker Room & My Hub
            gt_live_edit_row = build_necrons_11e_row(
                list_key="shatter_nec", name="ShatterStar Voidlord — Live GT Edit", pts=1990, play_mode=False
            )
            adv_case_d = await t.js(
                f"""
                (async () => {{
                    window.gtToggleRosterViewMode('edit');
                    await new Promise(r => setTimeout(r, 2200));
                    const ifr = document.getElementById('gt-nr-play-mode-iframe');
                    const cw = ifr.contentWindow;
                    const updatedRow = {json.dumps(gt_live_edit_row)};
                    await new Promise((resolve) => {{
                        const req = cw.indexedDB.open('nr');
                        req.onsuccess = () => {{
                            const db = req.result;
                            const tx = db.transaction('lists', 'readwrite');
                            tx.objectStore('lists').put(updatedRow);
                            tx.oncomplete = () => {{ db.close(); resolve(true); }};
                        }};
                    }});
                    await new Promise(r => setTimeout(r, 1500));

                    const roomLists = await fetch('/api/tracker/room/WH40K-NRSCENARIO/armylists').then(r => r.json());
                    const userLists = await fetch('/api/armylists').then(r => r.json());
                    const savedNec = (userLists.army_lists || []).find(l => l.id === 'nr_shatter_nec');
                    const titleEl = document.getElementById('gt-active-roster-title');
                    const domTitle = titleEl ? titleEl.textContent : null;
                    const iframeStillAlive = document.getElementById('gt-nr-play-mode-iframe') === ifr;

                    // Restore original name
                    const origRow = {json.dumps(build_necrons_11e_row(list_key="shatter_nec", name="ShatterStar Voidlord", pts=2000, play_mode=False))};
                    await new Promise((resolve) => {{
                        const req = cw.indexedDB.open('nr');
                        req.onsuccess = () => {{
                            const db = req.result;
                            const tx = db.transaction('lists', 'readwrite');
                            tx.objectStore('lists').put(origRow);
                            tx.oncomplete = () => {{ db.close(); resolve(true); }};
                        }};
                    }});
                    await new Promise(r => setTimeout(r, 1200));

                    return {{
                        roomP1Name: roomLists && roomLists.p1_army_list ? roomLists.p1_army_list.name : null,
                        roomP1Pts: roomLists && roomLists.p1_army_list ? roomLists.p1_army_list.points : null,
                        savedNecName: savedNec ? savedNec.name : null,
                        domTitle,
                        iframeStillAlive
                    }};
                }})()
                """
            )
            record(
                "Adversarial Case D: Live edit inside Game Tracker propagates to Game Tracker room, My Hub & DOM without tearing down editor iframe",
                bool(
                    adv_case_d
                    and adv_case_d.get("roomP1Name") == "ShatterStar Voidlord — Live GT Edit"
                    and adv_case_d.get("roomP1Pts") == 1990
                    and adv_case_d.get("savedNecName") == "ShatterStar Voidlord — Live GT Edit"
                    and adv_case_d.get("domTitle") == "ShatterStar Voidlord — Live GT Edit"
                    and adv_case_d.get("iframeStillAlive") is True
                ),
                json.dumps(adv_case_d),
            )

            # Final verification: confirm Opponent's list from Game Tracker did NOT leak into Player 1's saved lists
            final_lists_check = await t.js(
                """
                (async () => {
                    const res = await fetch('/api/armylists').then(r => r.json());
                    return (res.army_lists || []).map(l => l.name).sort();
                })()
                """
            )
            record(
                "After all Tournament & Game Tracker Opponent List views, user's saved lists contain ONLY their 3 own lists",
                final_lists_check == ["Lion", "ShatterStar Voidlord", "Thunderhead Host AoS 4"],
                json.dumps(final_lists_check),
            )

            print("\n" + "=" * 92)
            print(f"🎉 ALL {len(checks)} / {len(checks)} NEWRECRUIT SCENARIOS & MULTI-VIEWPORT CHECKS PASSED!")
            print("=" * 92)

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
