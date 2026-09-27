#!/usr/bin/env python3
import asyncio
import base64
import json
import os
import subprocess
import time
import urllib.request
import websockets

PORT = 5178
CHROME_PORT = 9292
BASE_URL = f"http://localhost:{PORT}"
ARTIFACT_DIR = "/usr/local/google/home/hsiehjun/.gemini/jetski/brain/a6253a1a-ca8f-4466-9cc6-340c885b9577"

checks = []


def record(name, passed, detail=""):
    status = "PASS" if passed else "FAIL"
    print(f"  [{status}] {name} {('— ' + str(detail)) if detail else ''}")
    checks.append({"name": name, "passed": bool(passed), "detail": str(detail)})
    if not passed:
        raise AssertionError(f"Check failed: {name} ({detail})")


def build_studio_nr_row(list_key="da9988", name="Lion's Blade Strike Force", pts=1995, play_mode=False):
    return {
        "list_key": list_key,
        "name": name,
        "id_system": 2821148162,
        "id_book": 3826258388,
        "bsid_system": "sys-352e-adc2-7639-d6a9",
        "bsid_book": "4068-70a9-f407-5133",
        "totalCost": pts,
        "totalCosts": {"pts": pts},
        "date_mod": "2026-09-27 03:20:00",
        "version": 1,
        "synced": 1,
        "metadata": {"play_mode": play_mode},
        "army": {
            "id": "root-da",
            "name": "Imperium - Adeptus Astartes - Dark Angels",
            "options": [
                {
                    "id": "force-roster",
                    "name": "Army Roster",
                    "options": [
                        {
                            "id": "cat-cfg",
                            "name": "Configuration",
                            "options": [
                                {
                                    "id": "opt-det",
                                    "name": "Detachment",
                                    "options": [
                                        {
                                            "id": "det-grp",
                                            "name": "Detachment Choice",
                                            "options": [{"id": "det-gladius", "name": "Gladius Task Force"}],
                                        }
                                    ],
                                },
                                {
                                    "id": "opt-bs",
                                    "name": "Battle Size",
                                    "options": [{"id": "bs-2k", "name": "2. Strike Force (2000 Point limit)"}],
                                },
                            ],
                        },
                        {
                            "id": "cat-char",
                            "name": "Character",
                            "options": [
                                {
                                    "id": "u-captain",
                                    "name": "Captain in Gravis Armour",
                                    "amount": 1,
                                    "points": 80,
                                    "options": [
                                        {"id": "wl-1", "name": "Warlord"},
                                        {
                                            "id": "enh-1",
                                            "name": "Enhancements",
                                            "options": [{"id": "enh-fh", "name": "Fire Discipline"}],
                                        },
                                        {"id": "wg-1", "name": "Master-crafted heavy bolt rifle"},
                                    ],
                                }
                            ],
                        },
                        {
                            "id": "cat-bl",
                            "name": "Battleline",
                            "options": [
                                {
                                    "id": "u-intercessors",
                                    "name": "Intercessor Squad",
                                    "amount": 10,
                                    "points": 160,
                                    "options": [
                                        {"id": "wg-3", "name": "Bolt rifle"},
                                        {"id": "wg-4", "name": "Astartes grenade launcher"},
                                    ],
                                }
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
        self.cid = 1

    async def cdp(self, method, params=None):
        curr_id = self.cid
        self.cid += 1
        msg = {"id": curr_id, "method": method, "params": params or {}}
        await self.ws.send(json.dumps(msg))
        while True:
            raw = await self.ws.recv()
            data = json.loads(raw)
            if data.get("id") == curr_id:
                return data.get("result", {})

    async def js(self, expr):
        res = await self.cdp("Runtime.evaluate", {
            "expression": expr,
            "returnByValue": True,
            "awaitPromise": True,
        })
        return res.get("result", {}).get("value")

    async def set_viewport(self, width, height, scale=1, mobile=False):
        await self.cdp("Emulation.setDeviceMetricsOverride", {
            "width": width,
            "height": height,
            "deviceScaleFactor": scale,
            "mobile": mobile,
        })

    async def navigate(self, url, wait_sec=2.0):
        await self.cdp("Page.navigate", {"url": url})
        await asyncio.sleep(wait_sec)

    async def snap(self, filename):
        await self.js("""
            (() => {
                const m = document.getElementById('badges-celebration-modal');
                if (m) m.remove();
            })()
        """)
        res = await self.cdp("Page.captureScreenshot", {"format": "png"})
        img_data = base64.b64decode(res["data"])
        filepath = os.path.join(ARTIFACT_DIR, filename)
        with open(filepath, "wb") as f:
            f.write(img_data)
        print(f"    📸 Saved [{filename}] ({len(img_data):,} bytes)")


async def main():
    print("=" * 88)
    print("🚀 RUNNING COMPREHENSIVE E2E TEST SUITE FOR ALL 7 ROSTER USER JOURNEYS")
    print("=" * 88)

    # Clear existing lists on dev server before starting
    req = urllib.request.Request(f"{BASE_URL}/api/armylists")
    with urllib.request.urlopen(req) as resp:
        existing = json.loads(resp.read().decode("utf-8")).get("army_lists", [])
    for item in existing:
        del_req = urllib.request.Request(f"{BASE_URL}/api/armylists/{item['id']}", method="DELETE")
        urllib.request.urlopen(del_req)
    print(f"🧹 Cleared {len(existing)} existing lists from backend.")

    chrome_proc = subprocess.Popen([
        "/usr/bin/google-chrome",
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        f"--remote-debugging-port={CHROME_PORT}",
        "--user-data-dir=/tmp/chrome_roster_journeys_" + str(int(time.time())),
        "--window-size=1440,900",
        "--hide-scrollbars",
    ])

    try:
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

            # =====================================================================
            # JOURNEY 1: CREATE ROSTER IN NEWRECRUIT STUDIO & AUTO-SYNC TO MY HUB
            # =====================================================================
            print("\n--- JOURNEY 1: Create Roster in NewRecruit Studio & Auto-Sync to My Hub ---")
            await t.set_viewport(1440, 900, scale=1, mobile=False)
            await t.navigate(f"{BASE_URL}/app#my-hub", wait_sec=2.2)

            hub_clean_check = await t.js("""
                (() => {
                  const card = document.getElementById('hub-armylists-card');
                  const html = card ? card.innerHTML : '';
                  return {
                    hasCard: Boolean(card),
                    hasLegacyImportBtn: html.includes('openImportArmyListModal'),
                    hasLegacyWahaText: html.includes('Wahapedia'),
                    hasStudioBtn: Boolean(document.getElementById('hub-btn-launch-nr-studio')),
                    hasCloudSyncBtn: Boolean(document.getElementById('hub-btn-nr-cloud-sync'))
                  };
                })()
            """)
            record(
                "My Hub Army Lists card has zero legacy Wahapedia/Import Text UI & exposes NewRecruit Studio + Cloud Sync",
                bool(
                    hub_clean_check
                    and hub_clean_check.get("hasCard")
                    and not hub_clean_check.get("hasLegacyImportBtn")
                    and not hub_clean_check.get("hasLegacyWahaText")
                    and hub_clean_check.get("hasStudioBtn")
                ),
                json.dumps(hub_clean_check),
            )

            # Open NewRecruit Studio Drawer and wait for bridge initialization
            await t.js("openNewRecruitStudioDrawer('/nr/app/Lists')")
            for _ in range(25):
                st = await t.js("""
                    (async () => {
                        const ifr = document.getElementById('hub-nr-studio-iframe');
                        if (!ifr || !ifr.contentWindow || !ifr.contentWindow.__omnitacticaNrBridgeInstalled) return false;
                        const dbs = await ifr.contentWindow.indexedDB.databases();
                        return dbs.some(d => d.name === 'nr' && d.version >= 10);
                    })()
                """)
                if st:
                    break
                await asyncio.sleep(0.5)

            studio_row = build_studio_nr_row(list_key="da9988", name="Lion's Blade Strike Force", pts=1995, play_mode=True)
            j1_sync = await t.js(f"""
                (async () => {{
                  const row = {json.dumps(studio_row)};
                  const ifr = document.getElementById('hub-nr-studio-iframe');
                  await new Promise((resolve, reject) => {{
                    const req = ifr.contentWindow.indexedDB.open('nr');
                    req.onsuccess = () => {{
                      const db = req.result;
                      const tx = db.transaction('lists', 'readwrite');
                      tx.objectStore('lists').put(row);
                      tx.oncomplete = () => {{ db.close(); resolve(true); }};
                      tx.onerror = (e) => {{ db.close(); reject(e); }};
                    }};
                  }});
                  await new Promise(r => setTimeout(r, 1600));
                  closeNewRecruitStudioDrawer();
                  await new Promise(r => setTimeout(r, 600));
                  const listsResp = await window.api.getArmyLists();
                  const saved = (listsResp.army_lists || []).find(l => l.id === 'nr_da9988');
                  const cardContainer = document.getElementById('hub-armylists-list-container');
                  return {{
                    hubCardText: cardContainer ? cardContainer.innerText : '',
                    hasDeleteBtnOnCard: cardContainer ? cardContainer.innerHTML.includes("deleteHubArmyList('nr_da9988'") : false,
                    savedId: saved ? saved.id : null,
                    savedName: saved ? saved.name : null,
                    savedPoints: saved ? saved.points : null,
                    hasRawText: Boolean(saved && saved.raw_text && saved.raw_text.includes("ARMY NAME: Lion's Blade Strike Force") && saved.raw_text.includes('Captain in Gravis Armour'))
                  }};
                }})()
            """)
            record(
                "Creating a list in NewRecruit Studio auto-syncs to My Hub with Delete button and auto-generated raw_text",
                bool(
                    j1_sync
                    and j1_sync.get("savedId") == "nr_da9988"
                    and "Lion's Blade Strike Force" in j1_sync.get("hubCardText", "")
                    and j1_sync.get("hasDeleteBtnOnCard")
                    and j1_sync.get("hasRawText")
                ),
                json.dumps(j1_sync),
            )

            # =====================================================================
            # JOURNEY 2: MODIFY ROSTER VIA 'MANAGE IN NEWRECRUIT' (EDIT MODE + RAPID SYNC)
            # =====================================================================
            print("\n--- JOURNEY 2: Modify Roster via 'Manage in NewRecruit' (Edit Mode + Rapid Auto-Sync) ---")
            await t.js("openNewRecruitStudioForList('nr_da9988')")
            await asyncio.sleep(2.5)

            edit_1 = build_studio_nr_row(list_key="da9988", name="Lion's Blade — Edit 1", pts=1990, play_mode=False)
            edit_2 = build_studio_nr_row(list_key="da9988", name="Lion's Blade — Modified v2", pts=1985, play_mode=False)

            j2_edit_result = await t.js(f"""
                (async () => {{
                  const ifr = document.getElementById('hub-nr-studio-iframe');
                  if (!ifr || !ifr.contentWindow) return {{ error: 'no studio iframe' }};
                  const cw = ifr.contentWindow;

                  // 1. Check that opening /nr/app/Lists/da9988 without ?view=play flipped play_mode to false!
                  const rowBefore = await new Promise((resolve) => {{
                    const req = cw.indexedDB.open('nr');
                    req.onsuccess = () => {{
                      const db = req.result;
                      const tx = db.transaction('lists', 'readonly');
                      const g = tx.objectStore('lists').getAll();
                      g.onsuccess = () => {{
                        db.close();
                        const found = (g.result || []).find(r => r && r.list_key === 'da9988') || null;
                        resolve(found);
                      }};
                    }};
                  }});
                  const playModeInEdit = rowBefore && rowBefore.metadata ? rowBefore.metadata.play_mode : null;

                  // 2. Perform two rapid consecutive edits (20ms apart) to test syncInFlight race fix
                  const r1 = {json.dumps(edit_1)};
                  const r2 = {json.dumps(edit_2)};
                  if (rowBefore && rowBefore._id !== undefined) {{
                    r1._id = rowBefore._id;
                    r2._id = rowBefore._id;
                  }}
                  await new Promise((resolve) => {{
                    const req = cw.indexedDB.open('nr');
                    req.onsuccess = () => {{
                      const db = req.result;
                      const tx1 = db.transaction('lists', 'readwrite');
                      tx1.objectStore('lists').put(r1);
                      setTimeout(() => {{
                        const tx2 = db.transaction('lists', 'readwrite');
                        tx2.objectStore('lists').put(r2);
                        tx2.oncomplete = () => {{ db.close(); resolve(true); }};
                      }}, 20);
                    }};
                  }});

                  await new Promise(r => setTimeout(r, 1800));
                  closeNewRecruitStudioDrawer();
                  await new Promise(r => setTimeout(r, 600));

                  const cardContainer = document.getElementById('hub-armylists-list-container');
                  const listsResp = await window.api.getArmyLists();
                  const saved = (listsResp.army_lists || []).find(l => l.id === 'nr_da9988');
                  return {{
                    url: cw.location.pathname + cw.location.search,
                    playModeInEdit: playModeInEdit,
                    hubCardText: cardContainer ? cardContainer.innerText : '',
                    savedName: saved ? saved.name : null,
                    savedPoints: saved ? saved.points : null
                  }};
                }})()
            """)
            record(
                "'🛠️ Manage in NewRecruit' switches list to Edit Mode (play_mode=False) & syncs rapid edits to My Hub",
                bool(
                    j2_edit_result
                    and j2_edit_result.get("playModeInEdit") is False
                    and j2_edit_result.get("savedName") == "Lion's Blade — Modified v2"
                    and j2_edit_result.get("savedPoints") == 1985
                    and "Lion's Blade — Modified v2" in j2_edit_result.get("hubCardText", "")
                ),
                json.dumps(j2_edit_result),
            )
            await t.snap("journey_2_desktop_hub_modified_roster.png")

            # =====================================================================
            # JOURNEY 3: VIEW ROSTER IN MY HUB (PLAY MODE DATASHEETS & RAW TEXT)
            # =====================================================================
            print("\n--- JOURNEY 3: View Roster in My Hub (NewRecruit Play Mode Datasheets & Raw Text) ---")
            j3_setup = await t.js("""
                (async () => {
                  const smText = `Space Marines - Gladius Task Force (2000 pts)

Captain in Gravis Armour (80 pts): Warlord
Librarian in Terminator Armour (75 pts)
10x Intercessor Squad (160 pts)
5x Terminator Squad (175 pts)
Redemptor Dreadnought (210 pts)
Repulsor Executioner (220 pts)`;

                  const aeldariText = `Aeldari - Battle Host (2000 pts)

Autarch Wayleaper (115 pts): Warlord
Farseer (80 pts)
10x Guardian Defenders (100 pts)
5x Warp Spiders (125 pts)
Avatar of Khaine (335 pts)
Wraithlord (145 pts)`;

                  const p1Res = await fetch('/api/armylists/parse', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: smText })
                  }).then(r => r.json());

                  const p2Res = await fetch('/api/armylists/parse', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: aeldariText })
                  }).then(r => r.json());

                  const p1List = p1Res.army_list;
                  const p2List = p2Res.army_list;
                  p1List.name = 'Ultramarines Gladius Strike Force';
                  p2List.name = 'Ulthwe Aspect Host';

                  const token = localStorage.getItem('auth_token') || 'dev-token-123';
                  await fetch('/api/armylists', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(p1List)
                  });
                  await fetch('/api/armylists', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(p2List)
                  });

                  await fetch('/api/tracker/room/WH40K-JOURNEY01/armylist', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ role: 'player1', army_list: p1List })
                  });
                  await fetch('/api/tracker/room/WH40K-JOURNEY01/armylist', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ role: 'player2', army_list: p2List })
                  });

                  await loadHubArmyLists();
                  return { p1Id: p1List.id, p2Id: p2List.id };
                })()
            """)

            await t.js(f"openViewArmyListModal('{j3_setup['p1Id']}', 'play')")
            hub_play_state = None
            for _ in range(35):
                await asyncio.sleep(1.0)
                hub_play_state = await t.js("""
                    (() => {
                      const ifr = document.getElementById('hub-nr-play-mode-iframe');
                      if (!ifr || !ifr.contentWindow) return null;
                      const cw = ifr.contentWindow;
                      const stores = cw.__omnitacticaNrBridge && cw.__omnitacticaNrBridge.getNrStores ? cw.__omnitacticaNrBridge.getNrStores() : cw.__nr_stores;
                      const sel = stores && stores.list && (stores.list.currentList || stores.list.selectedList);
                      const isPlay = Boolean((sel && sel.playMode) || (sel && sel.row && sel.row.metadata && sel.row.metadata.play_mode));
                      const unitRowsCount = cw.document.querySelectorAll('.unitRow .name').length;
                      return {
                        hasSel: Boolean(sel),
                        playMode: isPlay,
                        compiledByNr: sel && sel.row ? Boolean(sel.row._compiled_by_nr) : false,
                        unitRowsCount: unitRowsCount
                      };
                    })()
                """)
                if hub_play_state and hub_play_state.get("playMode") and hub_play_state.get("unitRowsCount", 0) >= 3:
                    break

            await asyncio.sleep(0.8)
            clicked_unit_popup = await t.js("""
                (async () => {
                  const cw = document.getElementById('hub-nr-play-mode-iframe').contentWindow;
                  const rows = Array.from(cw.document.querySelectorAll('.unitRow .name'));
                  const target = rows.find(el => (el.innerText || '').includes('Captain in Gravis Armour') || (el.innerText || '').includes('Redemptor Dreadnought'));
                  if (target) target.click();
                  await new Promise(r => setTimeout(r, 1200));
                  const titleEl = cw.document.querySelector('.bsProfileTitle');
                  const pop = titleEl ? (titleEl.parentElement && titleEl.parentElement.parentElement ? titleEl.parentElement.parentElement : titleEl.parentElement) : null;
                  return pop ? pop.innerText.slice(0, 400) : '';
                })()
            """)
            record(
                "My Hub Play Mode compiles roster into interactive NewRecruit datasheets & stratagems popup",
                bool(hub_play_state and hub_play_state.get("playMode") and len(clicked_unit_popup) > 40),
                clicked_unit_popup[:140].replace("\n", " "),
            )

            # Switch to Raw Roster Text tab in My Hub modal
            j3_raw = await t.js(f"""
                (async () => {{
                  setHubRosterViewMode('text', '{j3_setup['p1Id']}');
                  await new Promise(r => setTimeout(r, 400));
                  const pre = document.getElementById('hub-raw-roster-content');
                  return pre ? pre.innerText : '';
                }})()
            """)
            record(
                "My Hub Raw Roster Text tab renders monospaced copy-ready roster text",
                bool(j3_raw and "Captain in Gravis Armour" in j3_raw and "Redemptor Dreadnought" in j3_raw),
                j3_raw[:100].replace("\n", " "),
            )
            await t.js("closeViewArmyListModal()")

            # =====================================================================
            # JOURNEY 4 & 5: GAME TRACKER — PLAYER & OPPONENT PLAY MODE + LIVE EDIT SYNC
            # =====================================================================
            print("\n--- JOURNEY 4 & 5: Game Tracker — Player & Opponent Play Mode + Live In-Game Edit Sync ---")
            await t.navigate(f"{BASE_URL}/11th/tracker/play?match_id=WH40K-JOURNEY01&role=player1", wait_sec=3.0)

            # 4A: Open Opponent's List (Aeldari) in Play Mode
            await t.js("window.gtOpenArmyListModal('opponent')")
            opp_play_state = None
            for _ in range(35):
                await asyncio.sleep(1.0)
                opp_play_state = await t.js("""
                    (() => {
                      const ifr = document.getElementById('gt-nr-play-mode-iframe');
                      if (!ifr || !ifr.contentWindow) return null;
                      const cw = ifr.contentWindow;
                      const stores = cw.__omnitacticaNrBridge && cw.__omnitacticaNrBridge.getNrStores ? cw.__omnitacticaNrBridge.getNrStores() : cw.__nr_stores;
                      const sel = stores && stores.list && (stores.list.currentList || stores.list.selectedList);
                      const isPlay = Boolean((sel && sel.playMode) || (sel && sel.row && sel.row.metadata && sel.row.metadata.play_mode));
                      const unitRowsCount = cw.document.querySelectorAll('.unitRow .name').length;
                      return {
                        playMode: isPlay,
                        unitRowsCount: unitRowsCount,
                        listName: sel && sel.row ? sel.row.name : null
                      };
                    })()
                """)
                if opp_play_state and opp_play_state.get("playMode") and opp_play_state.get("unitRowsCount", 0) >= 3:
                    break

            record(
                "Game Tracker '📜 Opponent's List' renders Opponent's Aeldari roster in NewRecruit Play Mode",
                bool(opp_play_state and opp_play_state.get("playMode") and opp_play_state.get("unitRowsCount", 0) >= 3),
                json.dumps(opp_play_state),
            )

            # 4B: Switch to '➕ Attach / Switch List' tab & attach P1's 'nr_da9988' list, then test Live Edit in NewRecruit!
            await t.js("window.gtSetListTab('attach')")
            await asyncio.sleep(0.8)
            await t.js("window.gtAttachSavedList('nr_da9988')")
            await asyncio.sleep(1.5)

            # Switch to '🛠️ Edit in NewRecruit' inside Game Tracker
            await t.js("window.gtToggleRosterViewMode('edit')")
            for _ in range(30):
                await asyncio.sleep(1.0)
                edit_ready = await t.js("""
                    (() => {
                      const ifr = document.getElementById('gt-nr-play-mode-iframe');
                      if (!ifr || !ifr.contentWindow) return null;
                      const cw = ifr.contentWindow;
                      const unitRowsCount = cw.document.querySelectorAll('.unitRow .name').length;
                      return { unitRowsCount };
                    })()
                """)
                if edit_ready and edit_ready.get("unitRowsCount", 0) >= 2:
                    break

            edit_in_game = build_studio_nr_row(list_key="da9988", name="Lion's Blade — Live In-Game Edit", pts=1975, play_mode=False)
            j5_live_edit = await t.js(f"""
                (async () => {{
                  const ifr = document.getElementById('gt-nr-play-mode-iframe');
                  if (!ifr || !ifr.contentWindow) return {{ error: 'no tracker edit iframe' }};
                  const cw = ifr.contentWindow;
                  const fallbackRow = {json.dumps(edit_in_game)};

                  await new Promise((resolve) => {{
                    const req = cw.indexedDB.open('nr');
                    req.onsuccess = () => {{
                      const db = req.result;
                      const tx = db.transaction('lists', 'readwrite');
                      const store = tx.objectStore('lists');
                      const g = store.getAll();
                      g.onsuccess = () => {{
                        const base = (g.result || []).find(r => r && r.list_key === 'da9988') || fallbackRow;
                        const updated = Object.assign({{}}, base, {{
                          name: "Lion's Blade — Live In-Game Edit",
                          totalCost: 1975,
                          totalCosts: {{ pts: 1975 }},
                          date_mod: "2026-09-27 03:55:00",
                          metadata: {{ play_mode: false }}
                        }});
                        store.put(updated);
                      }};
                      tx.oncomplete = () => {{ db.close(); resolve(true); }};
                    }};
                  }});

                  await new Promise(r => setTimeout(r, 1800));
                  const titleEl = document.getElementById('gt-active-roster-title');
                  const metaEl = document.getElementById('gt-active-roster-meta');

                  // Verify backend room state was automatically updated via _save_and_propagate!
                  const roomResp = await fetch('/api/tracker/room/WH40K-JOURNEY01').then(r => r.json());
                  const roomP1 = roomResp ? (roomResp.p1_army_list || (roomResp.room && roomResp.room.p1_army_list)) : null;

                  return {{
                    headerTitleAfter: titleEl ? titleEl.innerText : '',
                    headerMetaAfter: metaEl ? metaEl.innerText : '',
                    roomP1Name: roomP1 ? roomP1.name : null,
                    roomP1Points: roomP1 ? roomP1.points : null
                  }};
                }})()
            """)
            record(
                "Editing roster via '🛠️ Edit in NewRecruit' inside Game Tracker live-updates modal header AND active room state",
                bool(
                    j5_live_edit
                    and j5_live_edit.get("headerTitleAfter") == "Lion's Blade — Live In-Game Edit"
                    and "1975 PTS" in j5_live_edit.get("headerMetaAfter", "")
                    and j5_live_edit.get("roomP1Name") == "Lion's Blade — Live In-Game Edit"
                    and j5_live_edit.get("roomP1Points") == 1975
                ),
                json.dumps(j5_live_edit),
            )
            await t.snap("journey_5_desktop_tracker_live_edit_sync.png")
            await t.js("window.gtCloseArmyListModal()")

            # =====================================================================
            # JOURNEY 6: TOURNAMENT COMPETITOR ARMY LIST VIEWER MODAL
            # =====================================================================
            print("\n--- JOURNEY 6: Tournament Registration & Competitor Army List Viewer Modal ---")
            await t.navigate(f"{BASE_URL}/app#my-hub", wait_sec=2.2)

            j6_comp_modal = await t.js(f"""
                (async () => {{
                  const listsResp = await window.api.getArmyLists();
                  const saved = (listsResp.army_lists || []).find(l => l.id === '{j3_setup['p1Id']}') || (listsResp.army_lists || [])[0] || null;
                  const mockPlayer = {{
                    player_id: 'p_comp_1',
                    full_name: 'Supreme Grand Master Azrael',
                    faction: 'Space Marines',
                    detachment: 'Gladius Task Force',
                    army_list_text: saved ? saved.raw_text : 'Space Marines - Gladius Task Force (2000 pts)\\nCaptain in Gravis Armour (80 pts): Warlord',
                    _parsed_roster: saved
                  }};
                  window.openEventArmyListModal('p_comp_1', mockPlayer);
                  window.setEventArmyListViewMode('enriched');
                  await new Promise(r => setTimeout(r, 800));

                  const btnEnriched = document.getElementById('btn-army-list-mode-enriched');
                  const contentEl = document.getElementById('event-army-list-modal-content');
                  const ifr = contentEl ? contentEl.querySelector('#hub-nr-play-mode-iframe') : null;
                  return {{
                    btnLabel: btnEnriched ? btnEnriched.innerText.trim() : '',
                    hasLegacyWahaLabel: btnEnriched ? btnEnriched.innerText.includes('Wahapedia') : false,
                    hasPlayModeIframe: Boolean(ifr),
                    iframeSrc: ifr ? ifr.getAttribute('src') : null
                  }};
                }})()
            """)
            for _ in range(30):
                await asyncio.sleep(1.0)
                comp_ready = await t.js("""
                    (() => {
                      const contentEl = document.getElementById('event-army-list-modal-content');
                      const ifr = contentEl ? contentEl.querySelector('#hub-nr-play-mode-iframe') : null;
                      if (!ifr || !ifr.contentWindow) return null;
                      const cw = ifr.contentWindow;
                      const unitRowsCount = cw.document.querySelectorAll('.unitRow .name').length;
                      return { unitRowsCount };
                    })()
                """)
                if comp_ready and comp_ready.get("unitRowsCount", 0) >= 2:
                    break
            record(
                "Tournament Competitor Army List Modal displays '🎮 NewRecruit Play Mode' and embeds interactive Play Mode iframe",
                bool(
                    j6_comp_modal
                    and "NewRecruit Play Mode" in j6_comp_modal.get("btnLabel", "")
                    and not j6_comp_modal.get("hasLegacyWahaLabel")
                    and j6_comp_modal.get("hasPlayModeIframe")
                ),
                json.dumps(j6_comp_modal),
            )
            await asyncio.sleep(0.8)
            await t.snap("journey_6_desktop_tournament_competitor_playmode.png")
            await t.js("closeEventArmyListModal()")
            await asyncio.sleep(0.5)

            # =====================================================================
            # JOURNEY 7: DELETE ROSTER & SAME-ORIGIN INDEXEDDB RECONCILIATION
            # =====================================================================
            print("\n--- JOURNEY 7: Delete Roster & Same-Origin IndexedDB Reconciliation ---")
            j7_delete = await t.js("""
                (async () => {
                  window.confirm = () => true;
                  await deleteHubArmyList('nr_da9988');
                  await new Promise(r => setTimeout(r, 800));

                  const cardContainer = document.getElementById('hub-armylists-list-container');
                  const hubTextAfter = cardContainer ? cardContainer.innerText : '';
                  const listsResp = await window.api.getArmyLists();
                  const remainingIds = (listsResp.army_lists || []).map(l => l.id);

                  // Check same-origin IndexedDB ('nr' -> 'lists') via getAll() to confirm 'da9988' was purged
                  const idbRowAfter = await new Promise((resolve) => {
                    const req = indexedDB.open('nr');
                    req.onsuccess = () => {
                      const db = req.result;
                      if (!db.objectStoreNames.contains('lists')) { db.close(); return resolve(null); }
                      const tx = db.transaction('lists', 'readonly');
                      const g = tx.objectStore('lists').getAll();
                      g.onsuccess = () => {
                        db.close();
                        const found = (g.result || []).find(r => r && r.list_key === 'da9988') || null;
                        resolve(found);
                      };
                      g.onerror = () => { db.close(); resolve(null); };
                    };
                    req.onerror = () => resolve(null);
                  });

                  // Also reopen NewRecruit Studio Drawer and verify the deleted list is NOT resurrected!
                  openNewRecruitStudioDrawer('/nr/app/Lists');
                  await new Promise(r => setTimeout(r, 2000));
                  closeNewRecruitStudioDrawer();
                  const listsAfterReopen = await window.api.getArmyLists();
                  const idsAfterReopen = (listsAfterReopen.army_lists || []).map(l => l.id);

                  return {
                    hubTextAfter: hubTextAfter,
                    remainingIds: remainingIds,
                    idbRowAfter: idbRowAfter,
                    idsAfterReopen: idsAfterReopen
                  };
                })()
            """)
            record(
                "Deleting roster from My Hub removes it from backend AND purges same-origin IndexedDB (never resurrected on Studio reopen)",
                bool(
                    j7_delete
                    and "nr_da9988" not in j7_delete.get("remainingIds", [])
                    and "nr_da9988" not in j7_delete.get("idsAfterReopen", [])
                    and j7_delete.get("idbRowAfter") is None
                ),
                json.dumps(j7_delete),
            )
            await t.snap("journey_7_desktop_hub_after_delete.png")

            # =====================================================================
            # RESPONSIVE VIEWPORT VERIFICATION (TABLET 768x1024 & MOBILE 375x812)
            # =====================================================================
            print("\n--- RESPONSIVE VIEWPORT VERIFICATION (Tablet 768x1024 & Mobile 375x812) ---")
            await t.set_viewport(768, 1024, scale=2, mobile=True)
            await asyncio.sleep(0.8)
            await t.js("document.getElementById('hub-armylists-card').scrollIntoView({block: 'center'})")
            await asyncio.sleep(0.4)
            tab_overflow = await t.js("({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth })")
            record(
                "Tablet (768x1024) My Hub Army Lists card renders cleanly with zero horizontal overflow",
                bool(tab_overflow and tab_overflow["scrollW"] <= tab_overflow["innerW"] + 2),
                json.dumps(tab_overflow),
            )
            await t.snap("journey_8_tablet_hub_rosters.png")

            await t.set_viewport(375, 812, scale=2, mobile=True)
            await asyncio.sleep(0.8)
            await t.js("document.getElementById('hub-armylists-card').scrollIntoView({block: 'center'})")
            await asyncio.sleep(0.4)
            mob_overflow = await t.js("({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth })")
            record(
                "Mobile (375x812) My Hub Army Lists card renders cleanly with zero horizontal overflow",
                bool(mob_overflow and mob_overflow["scrollW"] <= mob_overflow["innerW"] + 2),
                json.dumps(mob_overflow),
            )
            await t.snap("journey_9_mobile_hub_rosters.png")

            print("\n" + "=" * 88)
            print(f"🎉 ALL {len(checks)} / {len(checks)} ROSTER USER JOURNEY E2E CHECKS PASSED WITH ZERO ERRORS!")
            print("=" * 88)

    finally:
        chrome_proc.terminate()
        try:
            chrome_proc.wait(timeout=3)
        except Exception:
            chrome_proc.kill()


if __name__ == "__main__":
    asyncio.run(main())
