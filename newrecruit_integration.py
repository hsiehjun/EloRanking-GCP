"""
Seamless NewRecruit Integration (Option 3 Hybrid Architecture + Native Play Mode):
1. Same-Origin Embedded NewRecruit Studio & Play Mode Proxy + Real-Time IndexedDB Auto-Sync Bridge
2. Linked NewRecruit Cloud Account RPC Sync (login, user_get_data, get_list_bulk)
3. Zero-Backend-Storage Datasheet & Stratagem Rendering via NewRecruit Play Mode (/nr/app/Lists/{list_key}?view=play)
"""

import hashlib
import json
import logging
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from army_list_parser import get_parser

logger = logging.getLogger("NewRecruitIntegration")

NR_BASE_URL = "https://www.newrecruit.eu"
NR_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Real NewRecruit Warhammer 40,000 system and faction catalogue IDs
NR_40K_SYSTEM_ID = 2821148162
NR_40K_SYSTEM_BSID = "sys-352e-adc2-7639-d6a9"

NR_40K_FACTION_BOOKS: Dict[str, Tuple[int, str, str]] = {
    "adepta sororitas": (2058815731, "b39e-4401-8f3e-fdf7", "Imperium - Adepta Sororitas"),
    "sisters of battle": (2058815731, "b39e-4401-8f3e-fdf7", "Imperium - Adepta Sororitas"),
    "black templars": (142652252, "36d3-36bc-68dd-40ac", "Imperium - Adeptus Astartes - Black Templars"),
    "blood angels": (3811889199, "4ef9-15ce-e3e6-36de", "Imperium - Adeptus Astartes - Blood Angels"),
    "dark angels": (331927583, "470a-6daa-9014-12df", "Imperium - Adeptus Astartes - Dark Angels"),
    "deathwatch": (1708061280, "f89b-84e0-6e3b-f1e2", "Imperium - Adeptus Astartes - Deathwatch"),
    "imperial fists": (2373215974, "5d6e-fd3-330a-11dd", "Imperium - Adeptus Astartes - Imperial Fists"),
    "iron hands": (2663644003, "f27e-18c0-b73e-748e", "Imperium - Adeptus Astartes - Iron Hands"),
    "raven guard": (61125968, "6e59-e1ee-47ad-6ce5", "Imperium - Adeptus Astartes - Raven Guard"),
    "salamanders": (3812267311, "2261-79a5-19d9-1668", "Imperium - Adeptus Astartes - Salamanders"),
    "space marines": (455211524, "e0af-67df-9d63-8fb7", "Imperium - Adeptus Astartes - Space Marines"),
    "adeptus astartes": (455211524, "e0af-67df-9d63-8fb7", "Imperium - Adeptus Astartes - Space Marines"),
    "space wolves": (2975519365, "94bb-3284-ee14-57a1", "Imperium - Adeptus Astartes - Space Wolves"),
    "ultramarines": (599543230, "4029-9237-e8db-af55", "Imperium - Adeptus Astartes - Ultramarines"),
    "white scars": (1852695118, "67c1-fc13-f9a1-cbbf", "Imperium - Adeptus Astartes - White Scars"),
    "adeptus custodes": (2461408627, "1f19-6509-d906-ca10", "Imperium - Adeptus Custodes"),
    "adeptus mechanicus": (1915182632, "77b9-2f66-3f9b-5cf3", "Imperium - Adeptus Mechanicus"),
    "agents of the imperium": (394010041, "b00-cd86-4b4c-97ba", "Imperium - Agents of the Imperium"),
    "imperial agents": (394010041, "b00-cd86-4b4c-97ba", "Imperium - Agents of the Imperium"),
    "astra militarum": (3188869395, "b0ae-12a5-c84-ea45", "Imperium - Astra Militarum"),
    "imperial guard": (3188869395, "b0ae-12a5-c84-ea45", "Imperium - Astra Militarum"),
    "grey knights": (3875817488, "50c4-3e83-fe54-97c4", "Imperium - Grey Knights"),
    "imperial knights": (1799226443, "25dd-7aa0-6bf4-f2d5", "Imperium - Imperial Knights"),
    "chaos daemons": (1418017000, "d265-877b-e03d-30ca", "Chaos - Chaos Daemons"),
    "chaos knights": (2126900523, "46d8-abc8-ef3a-9f85", "Chaos - Chaos Knights"),
    "chaos space marines": (4171985849, "c8da-e875-58f7-f6d6", "Chaos - Chaos Space Marines"),
    "heretic astartes": (4171985849, "c8da-e875-58f7-f6d6", "Chaos - Chaos Space Marines"),
    "death guard": (253717870, "5108-f98-63c2-53cb", "Chaos - Death Guard"),
    "emperor's children": (708977740, "03fe-a162-4c02-f07b", "Chaos - Emperor's Children"),
    "emperors children": (708977740, "03fe-a162-4c02-f07b", "Chaos - Emperor's Children"),
    "thousand sons": (164965956, "1069-10ff-3ba9-873b", "Chaos - Thousand Sons"),
    "world eaters": (3934587149, "df9a-59b2-f464-59ad", "Chaos - World Eaters"),
    "aeldari": (1194327035, "34a5-8c7e-f468-82d1", "Xenos - Aeldari"),
    "craftworlds": (1194327035, "34a5-8c7e-f468-82d1", "Xenos - Aeldari"),
    "ynnari": (1760867348, "1f1-47f9-a3a4-9bfb", "Aeldari - Ynnari"),
    "drukhari": (1007559722, "38de-521f-1ce0-44a0", "Xenos - Drukhari"),
    "genestealer cults": (3339098360, "3bdf-a114-5035-c6ac", "Xenos - Genestealer Cults"),
    "leagues of votann": (3439666802, "f616-3f08-ee8e-3349", "Xenos - Leagues of Votann"),
    "necrons": (1694145926, "b654-a18a-ea1-3bf2", "Xenos - Necrons"),
    "orks": (3898668199, "a55f-b7b3-6c65-a05f", "Xenos - Orks"),
    "t'au empire": (3882515956, "d81a-61dd-6d27-a3ce", "Xenos - T'au Empire"),
    "tau empire": (3882515956, "d81a-61dd-6d27-a3ce", "Xenos - T'au Empire"),
    "tyranids": (1071245710, "b984-7317-81cc-20f", "Xenos - Tyranids"),
}

# In-memory cache for static NewRecruit assets (/_nuxt/*, /settings/*, /assets/*, HTML shell)
_NR_STATIC_CACHE: Dict[str, Tuple[float, bytes, str]] = {}
_NR_HTML_SHELL_CACHE: Optional[Tuple[float, str]] = None
_NR_CACHE_TTL_SECONDS = 1800  # 30 minutes

# Per-user NewRecruit Cloud Account session store (keyed by user_id or 'default')
_NR_CLOUD_ACCOUNTS: Dict[str, Dict[str, Any]] = {}


def resolve_nr_40k_book(faction: str) -> Tuple[int, str, str]:
    """Resolves a faction name to its NewRecruit 40k (id_book, bsid_book, book_name)."""
    f_clean = (faction or "").strip().lower()
    if f_clean in NR_40K_FACTION_BOOKS:
        return NR_40K_FACTION_BOOKS[f_clean]
    for key, val in NR_40K_FACTION_BOOKS.items():
        if key in f_clean or f_clean in key:
            return val
    return NR_40K_FACTION_BOOKS["space marines"]


def build_roster_text_for_nr_compiler(roster: Dict[str, Any], book_name: str) -> str:
    """Builds a clean Warhammer 40,000 text export that NewRecruit's native text compiler (ukVEh7Py.js) can compile into a full catalogue army."""
    raw_text = str(roster.get("raw_text") or "").strip()
    detachment = str(roster.get("detachment") or "Gladius Task Force").strip()
    if detachment in ("Core Detachment", "Unknown Detachment", "Tournament Standard"):
        detachment = ""
    pts = int(roster.get("points") or 2000)

    # If raw_text already has units, prepend FACTION KEYWORD / DETACHMENT headers if missing so NewRecruit's parser resolves book & detachment
    if raw_text and len(raw_text.splitlines()) >= 4 and not raw_text.startswith("{"):
        header_lines = [
            "+++++++++++++++++++++++++++++++++++++++++++++++",
            f"+ FACTION KEYWORD: {book_name}",
        ]
        if detachment:
            header_lines.append(f"+ DETACHMENT: {detachment}")
        header_lines.append(f"+ TOTAL ARMY POINTS: {pts}pts")
        header_lines.append("+++++++++++++++++++++++++++++++++++++++++++++++")
        if "FACTION KEYWORD" not in raw_text.upper():
            return "\n".join(header_lines) + "\n\n" + raw_text
        return raw_text

    lines = [
        "+++++++++++++++++++++++++++++++++++++++++++++++",
        f"+ FACTION KEYWORD: {book_name}",
    ]
    if detachment:
        lines.append(f"+ DETACHMENT: {detachment}")
    lines.append(f"+ TOTAL ARMY POINTS: {pts}pts")
    lines.append("+++++++++++++++++++++++++++++++++++++++++++++++")
    lines.append("")

    units = [u for u in (roster.get("units") or []) if isinstance(u, dict) and u.get("name")]
    for u in units:
        u_name = str(u.get("name") or "Unit").strip()
        u_pts = int(u.get("points") or 0)
        u_models = int(u.get("model_count") or 1)
        prefix = f"{u_models}x " if u_models > 1 and not re.match(r"^\d+x\s+", u_name, re.I) else ""
        pts_str = f" [{u_pts} pts]" if u_pts > 0 else ""
        lines.append(f"{prefix}{u_name}{pts_str}")
        if u.get("is_warlord"):
            lines.append("• Warlord")
        if u.get("enhancement"):
            lines.append(f"• Enhancement: {u['enhancement']}")
        for wg in (u.get("wargear") or []):
            wg_s = str(wg).strip()
            if wg_s and wg_s.lower() not in ("warlord",):
                lines.append(f"• {wg_s}")
        lines.append("")

    return "\n".join(lines).strip()


OMNITACTICA_NR_BRIDGE_SCRIPT = r"""
<script id="omnitactica-nr-bridge">
(function() {
  if (window.__omnitacticaNrBridgeInstalled) return;
  window.__omnitacticaNrBridgeInstalled = true;

  var initialSearch = window.location.search || '';
  var initialPath = window.location.pathname || '';
  var wantPlayModeFromUrl = (
    initialSearch.indexOf('view=play') !== -1 ||
    initialSearch.indexOf('play=1') !== -1 ||
    initialSearch.indexOf('mode=play') !== -1
  );
  var requestedListKeyFromUrl = null;
  var mListUrl = initialPath.match(/\/Lists\/([^\/\?\#]+)/i) || initialPath.match(/\/list\/([^\/\?\#]+)/i);
  if (mListUrl && mListUrl[1]) {
    requestedListKeyFromUrl = decodeURIComponent(mListUrl[1]);
  } else {
    var mQueryList = initialSearch.match(/[?&]list=([^&#]+)/i);
    if (mQueryList && mQueryList[1]) {
      requestedListKeyFromUrl = decodeURIComponent(mQueryList[1]);
    }
  }

  // 1. Rewrite /nr/app/... path to /app/... BEFORE Nuxt vue-router initializes.
  // If a specific list key was requested in the URL, boot on /app/Lists first so Nuxt does not
  // prematurely fail to load the list before IndexedDB hydration and text-to-catalogue compilation complete.
  try {
    var curPath = window.location.pathname || '';
    if (requestedListKeyFromUrl) {
      window.history.replaceState(
        null,
        '',
        '/app/MyLists'
      );
    } else if (curPath.indexOf('/nr/app') === 0) {
      var mappedPath = curPath.replace(/^\/nr\/app/, '/app');
      if (!mappedPath || mappedPath === '/app' || mappedPath === '/app/') {
        mappedPath = '/app/Lists';
      }
      window.history.replaceState(
        null,
        '',
        mappedPath + (window.location.search || '') + (window.location.hash || '')
      );
    } else if (curPath === '/app' || curPath === '/app/') {
      window.history.replaceState(
        null,
        '',
        '/app/Lists' + (window.location.search || '') + (window.location.hash || '')
      );
    }
  } catch (err) {
    console.warn('[OmniTactica Bridge] Path rewrite notice:', err);
  }

  var isHydrating = false;
  var initialHydrationDone = false;
  var storesConfigured = false;
  var playModeActivatedForKey = null;
  var compilingKeys = {};
  var knownListsMap = {}; // list_key -> signature string
  var syncInFlight = {};
  var pendingNrRowFromParent = null;

  function notifyParent(payload) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          Object.assign({ type: 'OMNITACTICA_NR_SYNC_EVENT', timestamp: Date.now() }, payload),
          '*'
        );
      }
    } catch (e) {}
  }

  function computeSignature(row) {
    if (!row || !row.list_key) return '';
    var armyStr = '';
    var enrichedStr = '';
    try {
      armyStr = row.army ? JSON.stringify(row.army) : '';
      enrichedStr = row._omnitactica_enriched_units ? JSON.stringify(row._omnitactica_enriched_units) : '';
    } catch (e) {
      armyStr = String(row.date_mod || '');
    }
    return [
      row.list_key,
      row.name || '',
      row.totalCost || 0,
      row.date_mod || '',
      row.version || 0,
      armyStr.length,
      enrichedStr
    ].join('|');
  }

  // Extract lightweight unit summary (name, role, points, model_count, is_warlord) from globalThis.$debugOption when open
  function extractLiveUnitsFromDebugOption(targetListKey) {
    try {
      var inst = window.$debugOption;
      if (!inst || typeof inst.getForces !== 'function') return null;
      var curUrl = window.location.pathname || '';
      if (targetListKey && curUrl.indexOf('/Lists/') !== -1 && curUrl.indexOf(targetListKey) === -1) {
        return null;
      }
      var enriched = [];
      var forces = inst.getForces() || [];
      for (var fIdx = 0; fIdx < forces.length; fIdx++) {
        var force = forces[fIdx];
        if (!force || typeof force.getCategories !== 'function') continue;
        var cats = force.getCategories() || [];
        for (var cIdx = 0; cIdx < cats.length; cIdx++) {
          var cat = cats[cIdx];
          if (!cat || cat.isConfiguration || typeof cat.getUnits !== 'function') continue;
          var catName = cat.getName ? cat.getName() : (cat.name || 'Infantry');
          var units = cat.getUnits() || [];
          for (var uIdx = 0; uIdx < units.length; uIdx++) {
            var u = units[uIdx];
            if (!u) continue;
            var uName = (typeof u.getCustomName === 'function' && u.getCustomName()) ||
                        (typeof u.getName === 'function' ? u.getName() : (u.name || 'Unit'));
            var pts = typeof u.getPointsCost === 'function' ? u.getPointsCost() : 0;
            var models = typeof u.calcTotalUnitSize === 'function' ? u.calcTotalUnitSize() : 1;
            var isWarlord = false;
            try {
              isWarlord = Boolean(u.isWarlord && (typeof u.isWarlord === 'function' ? u.isWarlord() : u.isWarlord));
            } catch (e) {}
            enriched.push({
              name: uName,
              role: catName,
              points: Number(pts) || 0,
              model_count: Math.max(1, Number(models) || 1),
              is_warlord: isWarlord
            });
          }
        }
      }
      return enriched.length > 0 ? enriched : null;
    } catch (e) {
      return null;
    }
  }

  function cloneCleanRow(row) {
    if (!row || typeof row !== 'object') return null;
    try {
      var copy = JSON.parse(JSON.stringify(row));
      var liveUnits = extractLiveUnitsFromDebugOption(copy.list_key);
      if (liveUnits && liveUnits.length > 0) {
        copy._omnitactica_enriched_units = liveUnits;
      }
      return copy;
    } catch (e) {
      return null;
    }
  }

  async function postSyncAction(action, payload) {
    try {
      var res = await fetch('/api/armylists/nr_sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(Object.assign({ action: action }, payload))
      });
      if (!res.ok) return null;
      var data = await res.json();
      notifyParent({
        action: action,
        list_key: payload.list_key || (payload.list && payload.list.list_key) || null,
        army_list: data.army_list || null,
        army_lists: data.army_lists || null,
        deleted_id: data.deleted_id || null
      });
      return data;
    } catch (e) {
      console.warn('[OmniTactica Bridge] Sync error:', e);
      return null;
    }
  }

  async function syncUpsertRow(row) {
    if (isHydrating || !row || !row.list_key || row._ephemeral_view) return;
    var clean = cloneCleanRow(row);
    if (!clean) return;
    var sig = computeSignature(clean);
    if (knownListsMap[clean.list_key] === sig) {
      return;
    }
    if (syncInFlight[clean.list_key]) return;
    knownListsMap[clean.list_key] = sig;
    syncInFlight[clean.list_key] = true;
    try {
      await postSyncAction('upsert', { list: clean });
    } finally {
      syncInFlight[clean.list_key] = false;
    }
  }

  async function syncDeleteKey(listKey) {
    if (isHydrating || !listKey) return;
    delete knownListsMap[listKey];
    await postSyncAction('delete', { list_key: String(listKey) });
  }

  // 2. Hook IDBObjectStore.prototype.put / add / delete & IDBCursor.prototype.delete
  try {
    var origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      var req = origPut.apply(this, arguments);
      try {
        if (!isHydrating && this.name === 'lists' && value && value.list_key) {
          var captured = value;
          req.addEventListener('success', function() {
            setTimeout(function() { syncUpsertRow(captured); }, 60);
          });
        }
      } catch (e) {}
      return req;
    };

    var origAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function(value, key) {
      var req = origAdd.apply(this, arguments);
      try {
        if (!isHydrating && this.name === 'lists' && value && value.list_key) {
          var captured = value;
          req.addEventListener('success', function() {
            setTimeout(function() { syncUpsertRow(captured); }, 60);
          });
        }
      } catch (e) {}
      return req;
    };

    var origDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function(key) {
      var req = origDelete.apply(this, arguments);
      try {
        if (!isHydrating && this.name === 'lists' && key) {
          var capturedKey = key;
          req.addEventListener('success', function() {
            if (typeof capturedKey === 'string') {
              setTimeout(function() { syncDeleteKey(capturedKey); }, 60);
            }
          });
        }
      } catch (e) {}
      return req;
    };

    var origCursorDelete = IDBCursor.prototype.delete;
    IDBCursor.prototype.delete = function() {
      var req = origCursorDelete.apply(this, arguments);
      try {
        var storeName = this.source ? (this.source.name || (this.source.objectStore && this.source.objectStore.name)) : '';
        if (!isHydrating && storeName === 'lists') {
          var val = this.value;
          var pKey = (val && val.list_key) || this.primaryKey;
          req.addEventListener('success', function() {
            if (pKey && typeof pKey === 'string') {
              setTimeout(function() { syncDeleteKey(pKey); }, 60);
            }
          });
        }
      } catch (e) {}
      return req;
    };
  } catch (err) {
    console.warn('[OmniTactica Bridge] IDB hook notice:', err);
  }

  // Helper to safely open existing 'nr' IndexedDB only AFTER Dexie has created it
  async function openExistingNrDb() {
    try {
      if (indexedDB.databases) {
        var dbs = await indexedDB.databases();
        var nrExists = dbs && dbs.some(function(d) { return d.name === 'nr' && d.version >= 10; });
        if (!nrExists) return null;
      }
      return await new Promise(function(resolve) {
        var req = indexedDB.open('nr');
        req.onsuccess = function() {
          var db = req.result;
          if (db && db.objectStoreNames && db.objectStoreNames.contains('lists')) {
            resolve(db);
          } else {
            if (db) db.close();
            resolve(null);
          }
        };
        req.onerror = function() { resolve(null); };
      });
    } catch (e) {
      return null;
    }
  }

  async function readAllNrLists() {
    var db = await openExistingNrDb();
    if (!db) return null;
    return await new Promise(function(resolve) {
      try {
        var tx = db.transaction('lists', 'readonly');
        var store = tx.objectStore('lists');
        var req = store.getAll();
        req.onsuccess = function() {
          var rows = req.result || [];
          db.close();
          resolve(rows);
        };
        req.onerror = function() {
          db.close();
          resolve(null);
        };
      } catch (e) {
        db.close();
        resolve(null);
      }
    });
  }

  // 3. Hydrate IndexedDB 'nr.lists' from OmniTactica backend on startup
  async function hydrateFromOmniTactica() {
    if (initialHydrationDone) return;
    var insertedNewCount = 0;
    try {
      var db = null;
      for (var attempt = 0; attempt < 25; attempt++) {
        db = await openExistingNrDb();
        if (db) break;
        await new Promise(function(r) { setTimeout(r, 160); });
      }
      if (!db) {
        initialHydrationDone = true;
        return;
      }

      var res = await fetch('/api/armylists/nr_state', { credentials: 'same-origin' });
      if (!res.ok) {
        db.close();
        initialHydrationDone = true;
        return;
      }
      var state = await res.json();
      if (state && state.cloud_account && state.cloud_account.connected) {
        if (state.cloud_account.access && !localStorage.getItem('access')) {
          localStorage.setItem('access', state.cloud_account.access);
        }
        if (state.cloud_account.refresh && !localStorage.getItem('refresh')) {
          localStorage.setItem('refresh', state.cloud_account.refresh);
        }
      }

      var serverRows = (state && Array.isArray(state.nr_rows)) ? state.nr_rows.slice() : [];
      if (pendingNrRowFromParent && pendingNrRowFromParent.list_key) {
        var alreadyInServer = serverRows.some(function(r) { return r && r.list_key === pendingNrRowFromParent.list_key; });
        if (!alreadyInServer) {
          serverRows.push(pendingNrRowFromParent);
        }
      }

      isHydrating = true;
      await new Promise(function(resolve) {
        try {
          var tx = db.transaction('lists', 'readwrite');
          var store = tx.objectStore('lists');
          var existingByKey = {};
          var serverKeyMap = {};
          serverRows.forEach(function(sr) {
            if (sr && sr.list_key) {
              serverKeyMap[sr.list_key] = sr;
            }
          });
          var curReq = store.openCursor();
          curReq.onsuccess = function(ev) {
            var cursor = ev.target.result;
            if (cursor) {
              var item = cursor.value;
              if (item && item.list_key) {
                if (
                  !serverKeyMap[item.list_key] &&
                  item.list_key !== requestedListKeyFromUrl &&
                  !syncInFlight[item.list_key] &&
                  !knownListsMap[item.list_key]
                ) {
                  try { cursor.delete(); } catch (e) {}
                  delete knownListsMap[item.list_key];
                  cursor.continue();
                  return;
                }
                if (existingByKey[item.list_key]) {
                  // Remove duplicate entry for the same list_key
                  try { cursor.delete(); } catch (e) {}
                  cursor.continue();
                  return;
                }
                var sRow = serverKeyMap[item.list_key];
                if (sRow) {
                  var itemArmyId = item.army ? String(item.army.id || '') : '';
                  var localIsLegacySynthetic = (
                    item.id_system === 1 ||
                    (!item._compiled_by_nr && sRow._synthetic_text && (!item.army || itemArmyId.indexOf('army-') === 0 || itemArmyId.indexOf('root-') === 0))
                  );
                  var isRequestedTarget = (requestedListKeyFromUrl && requestedListKeyFromUrl === sRow.list_key);
                  if (localIsLegacySynthetic || isRequestedTarget) {
                    var toUpdate = Object.assign({}, item, sRow);
                    if (item._compiled_by_nr && item.army && itemArmyId.indexOf('army-') !== 0 && itemArmyId.indexOf('root-') !== 0) {
                      toUpdate.army = item.army;
                      toUpdate._compiled_by_nr = true;
                      delete toUpdate._synthetic_text;
                    }
                    if (store.keyPath && item[store.keyPath] !== undefined) {
                      toUpdate[store.keyPath] = item[store.keyPath];
                    }
                    if (isRequestedTarget) {
                      toUpdate.metadata = Object.assign({}, toUpdate.metadata || {}, { play_mode: Boolean(wantPlayModeFromUrl) });
                    }
                    try { cursor.update(toUpdate); } catch (e) {}
                    existingByKey[item.list_key] = toUpdate;
                    knownListsMap[item.list_key] = computeSignature(toUpdate);
                    cursor.continue();
                    return;
                  }
                }
                existingByKey[item.list_key] = item;
                knownListsMap[item.list_key] = computeSignature(item);
              }
              cursor.continue();
            } else {
              // Cursor finished scanning existing rows; now insert any serverRows not already in IndexedDB
              serverRows.forEach(function(sRow) {
                if (!sRow || !sRow.list_key || existingByKey[sRow.list_key]) return;
                var toInsert = Object.assign({}, sRow);
                delete toInsert._id;
                if (requestedListKeyFromUrl && requestedListKeyFromUrl === sRow.list_key) {
                  toInsert.metadata = Object.assign({}, toInsert.metadata || {}, { play_mode: Boolean(wantPlayModeFromUrl) });
                }
                try { store.put(toInsert); } catch (e) {}
                knownListsMap[sRow.list_key] = computeSignature(toInsert);
                insertedNewCount++;
              });
            }
          };
          tx.oncomplete = function() {
            db.close();
            resolve();
          };
          tx.onerror = function() {
            db.close();
            resolve();
          };
        } catch (e) {
          db.close();
          resolve();
        }
      });
    } catch (e) {
      console.warn('[OmniTactica Bridge] Hydration notice:', e);
    } finally {
      isHydrating = false;
      initialHydrationDone = true;
      await ensurePlayModeAndStoreHooks();
    }
  }

  function getNrStores() {
    var s = globalThis.__nr_stores;
    if (!s || !s.system || !s.user) return null;
    var pMap = (s.system._p && s.system._p._s) ? s.system._p._s : null;
    var listsStore = s.lists || s.list || (pMap ? pMap.get('lists') : null);
    var optionsStore = s.options || s.option || (pMap ? pMap.get('optionsStore') : null);
    var listsPageStore = s.listsPage || (pMap ? pMap.get('listsPage') : null);
    if (!listsStore) return null;
    s.list = listsStore;
    s.lists = listsStore;
    if (optionsStore) {
      s.option = optionsStore;
      s.options = optionsStore;
    }
    if (listsPageStore) {
      s.listsPage = listsPageStore;
    }
    if (!Object.getOwnPropertyDescriptor(listsStore, 'selectedList')) {
      try {
        Object.defineProperty(listsStore, 'selectedList', {
          get: function() { return this.currentList; },
          configurable: true
        });
      } catch (e) {}
    }
    return {
      user: s.user,
      system: s.system,
      list: listsStore,
      lists: listsStore,
      options: optionsStore,
      listsPage: listsPageStore
    };
  }

  async function upsertSingleRowToIdb(row) {
    if (!row || !row.list_key) return false;
    var db = await openExistingNrDb();
    if (!db) return false;
    var prevHydrating = isHydrating;
    isHydrating = true;
    return await new Promise(function(resolve) {
      try {
        var tx = db.transaction('lists', 'readwrite');
        var store = tx.objectStore('lists');
        var updatedExisting = false;
        var curReq = store.openCursor();
        curReq.onsuccess = function(ev) {
          var cursor = ev.target.result;
          if (cursor) {
            var existing = cursor.value;
            if (existing && existing.list_key === row.list_key) {
              if (!updatedExisting) {
                var toPut = Object.assign({}, existing, row);
                if (store.keyPath && existing[store.keyPath] !== undefined) {
                  toPut[store.keyPath] = existing[store.keyPath];
                }
                try { cursor.update(toPut); } catch (e) {}
                knownListsMap[row.list_key] = computeSignature(toPut);
                updatedExisting = true;
              } else {
                try { cursor.delete(); } catch (e) {}
              }
            }
            cursor.continue();
          } else if (!updatedExisting) {
            var toInsert = Object.assign({}, row);
            delete toInsert._id;
            try { store.put(toInsert); } catch (e) {}
            knownListsMap[row.list_key] = computeSignature(toInsert);
          }
        };
        tx.oncomplete = function() {
          db.close();
          isHydrating = prevHydrating;
          resolve(true);
        };
        tx.onerror = function() {
          db.close();
          isHydrating = prevHydrating;
          resolve(false);
        };
      } catch (e) {
        db.close();
        isHydrating = prevHydrating;
        resolve(false);
      }
    });
  }

  // Compile synthetic/text-imported row into a real NewRecruit BattleScribe catalogue army using ukVEh7Py.js
  async function compileSyntheticRowIfNeeded(row, systemStore, listStore) {
    if (!row || !row.list_key || !row._synthetic_text || row._compiled_by_nr) return row;
    var rowArmyId = row.army ? String(row.army.id || '') : '';
    var hasSyntheticArmy = !row.army || rowArmyId.indexOf('army-') === 0 || rowArmyId.indexOf('root-') === 0;
    if (!hasSyntheticArmy) return row;
    if (compilingKeys[row.list_key]) {
      return await compilingKeys[row.list_key];
    }
    var compilePromise = (async function() {
      try {
        var sys = await systemStore.selectSystem(row.id_system || 2821148162);
        if (!sys) return row;
        var booksArr = (sys.books && Array.isArray(sys.books.array)) ? sys.books.array : [];
        var fallbackBook = booksArr.find(function(b) {
          return b && (b.id === row.id_book || b.bsid === row.bsid_book);
        }) || booksArr.find(function(b) { return b && b.playable; }) || null;
        var mod = await import('/_nuxt/ukVEh7Py.js');
        var importTextFn = mod && mod.i;
        if (typeof importTextFn !== 'function') return row;
        var res = await importTextFn(sys, row._synthetic_text, {
          fallbackBook: fallbackBook,
          maxCost: Number(row.totalCost) || 2000
        });
        if (res && res.list && res.list.army) {
          row.id_system = sys.id;
          row.bsid_system = sys.bsid || row.bsid_system;
          if (res.list.row) {
            row.id_book = res.list.row.id_book || row.id_book;
            row.bsid_book = res.list.row.bsid_book || row.bsid_book;
            row.nrversion = res.list.row.nrversion || 1;
          }
          delete row.booksDate;
          row.army = res.list.army.toJson();
          row.totalCost = res.list.army.getPointsCost() || row.totalCost || 2000;
          if (typeof res.list.army.calcTotalCosts === 'function') {
            row.totalCosts = res.list.army.calcTotalCosts();
          }
          row._compiled_by_nr = true;
          await listStore.saveListLocally({
            row: row,
            army: res.list.army,
            book: res.list.book
          });
        }
      } catch (err) {
        console.warn('[OmniTactica Bridge] Text-to-catalogue compile notice:', err);
      } finally {
        delete compilingKeys[row.list_key];
      }
      return row;
    })();
    compilingKeys[row.list_key] = compilePromise;
    return await compilePromise;
  }

  var activatingPlayMode = false;

  // 4. Hook NewRecruit Pinia stores to unlock Play Mode (Datasheets + Stratagems + Leaders) and auto-open requested list
  async function ensurePlayModeAndStoreHooks() {
    var stores = getNrStores();
    if (!stores || !stores.user || !stores.list || !stores.system) return;

    // Always unlock Play Mode features (Stratagems book 105, Combined Leader Profiles, Casualty Tracking)
    try {
      stores.user.isSupporter = function() { return true; };
    } catch (e) {}

    // Ensure findListByKey finds any hydrated list regardless of currently selected game system
    if (!stores.list.__omniPatchedFind) {
      stores.list.__omniPatchedFind = true;
      var origFind = stores.list.findListByKey.bind(stores.list);
      stores.list.findListByKey = function(listKey, sysFilter) {
        var found = origFind(listKey, sysFilter);
        if (!found && listKey && Array.isArray(this.listData)) {
          found = this.listData.find(function(n) { return n && n.list_key === listKey; }) || null;
        }
        return found;
      };

      var origSelect = stores.list.selectList.bind(stores.list);
      stores.list.selectList = async function(rowOrKey, opts) {
        try {
          var rowObj = (typeof rowOrKey === 'string') ? this.findListByKey(rowOrKey) : rowOrKey;
          if (rowObj && rowObj._synthetic_text && !rowObj._compiled_by_nr) {
            if (stores.options && typeof stores.options.addInstalledSystemVue === 'function' && rowObj.id_system) {
              stores.options.addInstalledSystemVue(rowObj.id_system);
            }
            await compileSyntheticRowIfNeeded(rowObj, stores.system, stores.list);
          }
        } catch (e) {}
        return await origSelect(rowOrKey, opts);
      };
    }

    if (!initialHydrationDone || activatingPlayMode) return;

    var curPath = window.location.pathname || '';
    var curSearch = window.location.search || '';
    var mPathKey = curPath.match(/\/Lists\/([^\/\?\#]+)/i);
    var targetKey = requestedListKeyFromUrl || ((mPathKey && mPathKey[1]) ? decodeURIComponent(mPathKey[1]) : null);
    var wantPlay = Boolean(wantPlayModeFromUrl || curSearch.indexOf('view=play') !== -1 || curSearch.indexOf('play=1') !== -1);
    var modeToken = targetKey ? (targetKey + ':' + (wantPlay ? 'play' : 'edit')) : null;

    if (!targetKey) return;
    var curList = stores.list.currentList;
    var isOnListRoute = curPath.indexOf('/Lists/' + targetKey) !== -1;
    if (playModeActivatedForKey === modeToken && curList && curList.row && curList.row.list_key === targetKey) {
      if (stores.listsPage && stores.listsPage.editedList !== curList) {
        stores.listsPage.editedList = curList;
      }
      if (!isOnListRoute) {
        var rtr = stores.list.$router || (window.$nuxt && window.$nuxt.$router);
        if (rtr) {
          try {
            await rtr.replace({
              path: '/app/Lists/' + targetKey,
              query: wantPlay ? { view: 'play' } : {}
            });
          } catch (e) {}
        }
      }
      return;
    }

    activatingPlayMode = true;
    try {
      await stores.list.loadListsFromIndexDB();

      var targetRow = Array.isArray(stores.list.listData)
        ? stores.list.listData.find(function(r) { return r && r.list_key === targetKey; })
        : null;

      if (!targetRow && pendingNrRowFromParent && pendingNrRowFromParent.list_key === targetKey) {
        var rowToSeed = Object.assign({}, pendingNrRowFromParent);
        rowToSeed.metadata = Object.assign({}, rowToSeed.metadata || {}, { play_mode: Boolean(wantPlay) });
        await upsertSingleRowToIdb(rowToSeed);
        await stores.list.loadListsFromIndexDB();
        targetRow = Array.isArray(stores.list.listData)
          ? stores.list.listData.find(function(r) { return r && r.list_key === targetKey; })
          : null;
      }

      if (!targetRow) return;

      if (stores.options && typeof stores.options.addInstalledSystemVue === 'function' && targetRow.id_system) {
        stores.options.addInstalledSystemVue(targetRow.id_system);
      }
      if (!stores.system.selectedSystem || stores.system.selectedSystem.id !== targetRow.id_system) {
        await stores.system.selectSystem(targetRow.id_system);
      }
      await compileSyntheticRowIfNeeded(targetRow, stores.system, stores.list);

      targetRow.metadata = targetRow.metadata || {};
      targetRow.metadata.play_mode = Boolean(wantPlay);

      var loadedListObj = stores.list.currentList;
      if (!loadedListObj || !loadedListObj.row || loadedListObj.row.list_key !== targetKey) {
        loadedListObj = await stores.list.selectList(targetRow);
      }
      if (loadedListObj && loadedListObj.row) {
        loadedListObj.row.metadata = loadedListObj.row.metadata || {};
        loadedListObj.row.metadata.play_mode = Boolean(wantPlay);
      }
      stores.list.lastSelectedListKey = targetKey;
      var freshStores = getNrStores();
      if (freshStores && freshStores.listsPage && loadedListObj) {
        freshStores.listsPage.editedList = loadedListObj;
      }

      // Navigate Nuxt 3 router ($router on lists store) to /app/Lists/{targetKey}
      var router = stores.list.$router || (window.$nuxt && window.$nuxt.$router);
      var nowPath = window.location.pathname || '';
      if (router) {
        if (nowPath.indexOf('/Lists/' + targetKey) === -1) {
          await router.replace({
            path: '/app/Lists/' + targetKey,
            query: wantPlay ? { view: 'play' } : {}
          });
        } else if (wantPlay && (window.location.search || '').indexOf('view=play') === -1) {
          await router.replace({
            path: '/app/Lists/' + targetKey,
            query: { view: 'play' }
          });
        } else if (!wantPlay && (window.location.search || '').indexOf('view=play') !== -1) {
          await router.replace({
            path: '/app/Lists/' + targetKey,
            query: {}
          });
        }
      }
      playModeActivatedForKey = modeToken;
    } catch (err) {
      console.warn('[OmniTactica Bridge] Play Mode activation notice:', err);
    } finally {
      activatingPlayMode = false;
    }
  }

  // 5. Snapshot diff watcher to catch any edits, imports, or cursor deletions
  async function pollListsDiff() {
    await ensurePlayModeAndStoreHooks();
    if (!initialHydrationDone || isHydrating) return;
    var rows = await readAllNrLists();
    if (!rows) return;

    var currentKeys = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !r.list_key) continue;
      currentKeys[r.list_key] = true;
      var clean = cloneCleanRow(r);
      var sig = computeSignature(clean || r);
      if (knownListsMap[r.list_key] !== sig) {
        await syncUpsertRow(clean || r);
      }
    }

    var prevKeys = Object.keys(knownListsMap);
    for (var j = 0; j < prevKeys.length; j++) {
      var pk = prevKeys[j];
      if (!currentKeys[pk]) {
        await syncDeleteKey(pk);
      }
    }
  }

  async function forceFullSync() {
    if (!initialHydrationDone) {
      await hydrateFromOmniTactica();
    }
    var rows = await readAllNrLists();
    if (!rows) return null;
    var cleaned = rows.filter(function(r) { return r && !r._ephemeral_view; }).map(cloneCleanRow).filter(Boolean);
    cleaned.forEach(function(r) {
      knownListsMap[r.list_key] = computeSignature(r);
    });
    return await postSyncAction('bulk_sync', { lists: cleaned });
  }

  window.__omnitacticaNrBridge = {
    forceFullSync: forceFullSync,
    pollListsDiff: pollListsDiff,
    hydrateFromOmniTactica: hydrateFromOmniTactica,
    ensurePlayModeAndStoreHooks: ensurePlayModeAndStoreHooks,
    getNrStores: getNrStores
  };

  window.addEventListener('message', async function(ev) {
    var msg = ev && ev.data;
    if (!msg || msg.type !== 'OMNITACTICA_NR_COMMAND') return;
    if (msg.command === 'force_sync') {
      forceFullSync();
    } else if (msg.command === 'delete_list' && msg.list_key) {
      var delKey = String(msg.list_key);
      delete knownListsMap[delKey];
      if (pendingNrRowFromParent && pendingNrRowFromParent.list_key === delKey) {
        pendingNrRowFromParent = null;
      }
      var db = await openExistingNrDb();
      if (db) {
        var prevH = isHydrating;
        isHydrating = true;
        await new Promise(function(resolve) {
          try {
            var tx = db.transaction('lists', 'readwrite');
            var store = tx.objectStore('lists');
            var curReq = store.openCursor();
            curReq.onsuccess = function(evCur) {
              var cursor = evCur.target.result;
              if (cursor) {
                var it = cursor.value;
                if (it && it.list_key === delKey) {
                  try { cursor.delete(); } catch (e) {}
                }
                cursor.continue();
              }
            };
            tx.oncomplete = function() { db.close(); isHydrating = prevH; resolve(); };
            tx.onerror = function() { db.close(); isHydrating = prevH; resolve(); };
          } catch (e) { db.close(); isHydrating = prevH; resolve(); }
        });
      }
      var stDel = getNrStores();
      if (stDel && stDel.list) {
        try { await stDel.list.loadListsFromIndexDB(); } catch (e) {}
      }
    } else if (msg.command === 'open_play_mode' && msg.list_key) {
      requestedListKeyFromUrl = String(msg.list_key);
      wantPlayModeFromUrl = msg.play !== false;
      playModeActivatedForKey = null;
      if (msg.nr_row && msg.nr_row.list_key) {
        pendingNrRowFromParent = Object.assign({}, msg.nr_row);
        var existingRows = await readAllNrLists();
        var existingMap = {};
        (existingRows || []).forEach(function(er) {
          if (er && er.list_key) existingMap[er.list_key] = er;
        });
        var cur = existingMap[msg.nr_row.list_key];
        if (!cur || (!cur._compiled_by_nr && msg.nr_row._synthetic_text)) {
          var rowToWrite = Object.assign({}, msg.nr_row);
          rowToWrite.metadata = Object.assign({}, rowToWrite.metadata || {}, { play_mode: Boolean(wantPlayModeFromUrl) });
          await upsertSingleRowToIdb(rowToWrite);
          var st = getNrStores();
          if (st && st.list) {
            try { await st.list.loadListsFromIndexDB(); } catch (e) {}
          }
        }
      }
      await ensurePlayModeAndStoreHooks();
    } else if (msg.command === 'navigate' && msg.path) {
      try {
        window.location.href = msg.path;
      } catch (e) {}
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(hydrateFromOmniTactica, 150);
    });
  } else {
    setTimeout(hydrateFromOmniTactica, 150);
  }

  setInterval(pollListsDiff, 900);
})();
</script>
"""


def inject_nr_bridge_into_html(html: str) -> str:
    """Injects the OmniTactica <-> NewRecruit IndexedDB live sync & Play Mode bridge script at the top of <head>."""
    if "omnitactica-nr-bridge" in html:
        return html
    if "<head>" in html:
        return html.replace("<head>", "<head>" + OMNITACTICA_NR_BRIDGE_SCRIPT, 1)
    if "<head " in html:
        m = re.search(r"<head[^>]*>", html, re.IGNORECASE)
        if m:
            idx = m.end()
            return html[:idx] + OMNITACTICA_NR_BRIDGE_SCRIPT + html[idx:]
    return OMNITACTICA_NR_BRIDGE_SCRIPT + html


def fetch_nr_html_shell() -> str:
    """Fetches and caches NewRecruit's SPA HTML shell and injects the OmniTactica bridge."""
    global _NR_HTML_SHELL_CACHE
    now = time.time()
    if _NR_HTML_SHELL_CACHE and (now - _NR_HTML_SHELL_CACHE[0] < _NR_CACHE_TTL_SECONDS):
        return _NR_HTML_SHELL_CACHE[1]

    req = urllib.request.Request(
        f"{NR_BASE_URL}/app/Lists",
        headers={
            "User-Agent": NR_USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(req, timeout=10.0) as resp:
        raw_html = resp.read().decode("utf-8", errors="ignore")

    injected = inject_nr_bridge_into_html(raw_html)
    _NR_HTML_SHELL_CACHE = (now, injected)
    return injected


def proxy_nr_request(
    path_with_query: str,
    method: str = "GET",
    body: Optional[bytes] = None,
    req_headers: Optional[Dict[str, str]] = None,
) -> Tuple[int, bytes, str]:
    """
    Proxies static assets (/_nuxt/*, /settings/*, /assets/*) and API calls (/api/rpc, /api/book/*, /api/token)
    to https://www.newrecruit.eu with in-memory caching for static assets.
    Returns (status_code, content_bytes, content_type).
    """
    clean_path = path_with_query if path_with_query.startswith("/") else f"/{path_with_query}"
    is_cacheable_static = (
        method.upper() == "GET"
        and (
            clean_path.startswith("/_nuxt/")
            or clean_path.startswith("/settings/")
            or clean_path.startswith("/assets/")
            or clean_path.startswith("/icons/")
            or clean_path in ("/assets.json", "/favicon.ico", "/favicon-32x32.png")
        )
    )

    now = time.time()
    if is_cacheable_static and clean_path in _NR_STATIC_CACHE:
        ts, cached_bytes, cached_ct = _NR_STATIC_CACHE[clean_path]
        if now - ts < _NR_CACHE_TTL_SECONDS:
            return 200, cached_bytes, cached_ct

    target_url = f"{NR_BASE_URL}{clean_path}"
    headers: Dict[str, str] = {
        "User-Agent": NR_USER_AGENT,
        "Origin": NR_BASE_URL,
        "Referer": f"{NR_BASE_URL}/app/Lists",
    }
    if req_headers:
        for hdr_key in ("Content-Type", "content-type", "Authorization", "authorization", "Accept", "accept"):
            if hdr_key in req_headers and req_headers[hdr_key]:
                canonical = hdr_key.title() if hdr_key.islower() else hdr_key
                headers[canonical] = req_headers[hdr_key]

    req = urllib.request.Request(target_url, data=body if method.upper() != "GET" else None, headers=headers, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=15.0) as resp:
            status = resp.status
            data = resp.read()
            content_type = resp.headers.get("Content-Type", "application/octet-stream")
            if is_cacheable_static and status == 200:
                _NR_STATIC_CACHE[clean_path] = (now, data, content_type)
            return status, data, content_type
    except urllib.error.HTTPError as he:
        err_body = he.read() if hasattr(he, "read") else b""
        ct = he.headers.get("Content-Type", "application/json") if he.headers else "application/json"
        return he.code, err_body, ct
    except Exception as e:
        logger.warning("NewRecruit upstream proxy error for %s: %s", clean_path, e)
        err_payload = json.dumps({"error": str(e)}).encode("utf-8")
        return 502, err_payload, "application/json"


def build_synthetic_nr_row(roster: Dict[str, Any]) -> Dict[str, Any]:
    """
    Builds a valid NewRecruit IndexedDB nr.lists row from an OmniTactica roster.
    If the roster already has an authentic NewRecruit `nr_row` (created in NewRecruit Studio or Cloud), preserves it.
    Otherwise maps the faction to its real NewRecruit 40k catalogue (id_system, id_book) and attaches
    `_synthetic_text` so NewRecruit's native engine compiles it into an interactive Play Mode roster with full datasheets and stratagems.
    """
    faction = str(roster.get("faction") or "Space Marines").strip()
    id_book, bsid_book, book_name = resolve_nr_40k_book(faction)

    if isinstance(roster.get("nr_row"), dict) and roster["nr_row"].get("list_key"):
        row = dict(roster["nr_row"])
        row["name"] = roster.get("name") or row.get("name") or "Army Roster"
        row["totalCost"] = int(roster.get("points") or row.get("totalCost") or 0)
        if roster.get("_ephemeral_view"):
            row["_ephemeral_view"] = True
        army_obj = row.get("army") if isinstance(row.get("army"), dict) else {}
        is_legacy_synthetic = (
            row.get("id_system") in (None, 1)
            or str(army_obj.get("id") or "").startswith("army-")
            or str(army_obj.get("id") or "").startswith("root-")
        )
        if not is_legacy_synthetic:
            return row

    raw_id = str(roster.get("list_key") or roster.get("id") or "").strip()
    if raw_id.startswith("nr_"):
        list_key = raw_id[3:]
    elif raw_id.startswith("list_"):
        list_key = raw_id[5:]
    elif raw_id:
        list_key = re.sub(r"[^a-zA-Z0-9_\-]", "", raw_id)[:12]
    else:
        list_key = uuid.uuid4().hex[:6]

    # Group units by role into NewRecruit's fallback Army Roster structure AND attach _synthetic_text for native compilation
    by_role: Dict[str, List[Dict[str, Any]]] = {}
    for u in roster.get("units") or []:
        if not isinstance(u, dict):
            continue
        role = str(u.get("role") or "Infantry")
        by_role.setdefault(role, []).append(u)

    cat_options = []
    det_name = str(roster.get("detachment") or "Gladius Task Force")
    cat_options.append({
        "id": "cfg-root",
        "name": "Configuration",
        "options": [
            {
                "id": "cfg-det",
                "name": "Detachment",
                "options": [{"id": "cfg-det-val", "name": det_name, "options": [{"id": "cfg-det-leaf", "name": det_name}]}],
            }
        ],
    })

    for role, u_list in by_role.items():
        unit_nodes = []
        for idx, u in enumerate(u_list):
            sub_opts = []
            if u.get("is_warlord"):
                sub_opts.append({"id": f"wl-{idx}", "name": "Warlord"})
            if u.get("enhancement"):
                sub_opts.append({
                    "id": f"enh-{idx}",
                    "name": "Enhancements",
                    "options": [{"id": f"enh-val-{idx}", "name": str(u["enhancement"])}],
                })
            for wg_idx, wg in enumerate(u.get("wargear") or []):
                sub_opts.append({"id": f"wg-{idx}-{wg_idx}", "name": str(wg)})
            unit_nodes.append({
                "id": str(u.get("id") or f"unit-{idx}"),
                "name": str(u.get("name") or "Unit"),
                "amount": int(u.get("model_count") or 1),
                "points": int(u.get("points") or 0),
                "options": sub_opts,
            })
        cat_options.append({
            "id": f"cat-{role.lower().replace(' ', '-')}",
            "name": role,
            "options": unit_nodes,
        })

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    synthetic_text = build_roster_text_for_nr_compiler(roster, book_name)
    out_row = {
        "list_key": list_key,
        "name": str(roster.get("name") or f"{faction} - {det_name}"),
        "id_system": NR_40K_SYSTEM_ID,
        "id_book": id_book,
        "bsid_system": NR_40K_SYSTEM_BSID,
        "bsid_book": bsid_book,
        "totalCost": int(roster.get("points") or 0),
        "totalCosts": {"pts": int(roster.get("points") or 0)},
        "date_mod": str(roster.get("date_mod") or now_str),
        "version": 1,
        "synced": 1,
        "metadata": {"play_mode": True},
        "_synthetic_text": synthetic_text,
        "army": {
            "id": f"army-{list_key}",
            "name": book_name,
            "options": [
                {
                    "id": f"roster-{list_key}",
                    "name": "Army Roster",
                    "options": cat_options,
                }
            ],
        },
    }
    if roster.get("_ephemeral_view"):
        out_row["_ephemeral_view"] = True
    return out_row


def get_nr_state_payload(
    current_lists: List[Dict[str, Any]],
    user_key: str = "default",
) -> Dict[str, Any]:
    """Returns the hydration payload for GET /api/armylists/nr_state."""
    nr_rows = []
    seen_keys = set()
    for item in current_lists:
        if not isinstance(item, dict):
            continue
        row = build_synthetic_nr_row(item)
        lkey = row.get("list_key")
        if lkey and lkey not in seen_keys:
            seen_keys.add(lkey)
            nr_rows.append(row)

    acct = _NR_CLOUD_ACCOUNTS.get(user_key) or _NR_CLOUD_ACCOUNTS.get("default") or {}
    return {
        "success": True,
        "nr_rows": nr_rows,
        "cloud_account": {
            "connected": bool(acct.get("connected")),
            "login": acct.get("login") or "",
            "last_sync": acct.get("last_sync"),
            "access": acct.get("access") or "",
            "refresh": acct.get("refresh") or "",
        },
    }


def process_nr_sync_payload(
    body: Dict[str, Any],
    save_fn: Callable[[Dict[str, Any]], Dict[str, Any]],
    delete_fn: Callable[[str], bool],
    list_fn: Callable[[], List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """
    Processes a POST /api/armylists/nr_sync payload from the embedded NewRecruit Studio Bridge.
    Note: Wahapedia enrichment is intentionally NOT called (`enrich=False`) because NewRecruit Play Mode
    handles all datasheet and stratagem rendering directly.
    """
    action = str(body.get("action") or "upsert").strip().lower()
    parser = get_parser()

    if action == "delete":
        list_key = str(body.get("list_key") or body.get("id") or "").strip()
        if not list_key:
            return {"success": False, "error": "Missing list_key for delete"}
        delete_fn(list_key)
        delete_fn(f"nr_{list_key}")
        return {
            "success": True,
            "action": "delete",
            "deleted_id": f"nr_{list_key}" if not list_key.startswith("nr_") else list_key,
            "army_lists": list_fn(),
        }

    if action == "bulk_sync":
        incoming_lists = body.get("lists")
        if not isinstance(incoming_lists, list):
            return {"success": True, "action": "bulk_sync", "army_lists": list_fn()}

        incoming_keys = set()
        for row in incoming_lists:
            if not isinstance(row, dict) or not row.get("list_key"):
                continue
            lkey = str(row["list_key"]).strip()
            incoming_keys.add(lkey)
            parsed = parser.parse_newrecruit_dict(row, default_id=f"nr_{lkey}", enrich=False)
            parsed["source_format"] = "NewRecruit Studio"
            save_fn(parsed)

        if body.get("reconcile_deletions"):
            existing = list_fn()
            for item in existing:
                if not isinstance(item, dict):
                    continue
                item_id = str(item.get("id") or "")
                item_lkey = str(item.get("list_key") or (item_id[3:] if item_id.startswith("nr_") else ""))
                if item_lkey and item_lkey not in incoming_keys and item.get("source_format") in ("NewRecruit Studio", "NewRecruit Sync"):
                    delete_fn(item_id)

        return {
            "success": True,
            "action": "bulk_sync",
            "army_lists": list_fn(),
        }

    # Default: 'upsert'
    row = body.get("list") or body
    if not isinstance(row, dict):
        return {"success": False, "error": "Invalid list payload"}
    lkey = str(row.get("list_key") or row.get("id") or uuid.uuid4().hex[:6]).strip()
    if lkey.startswith("nr_"):
        lkey = lkey[3:]
    row["list_key"] = lkey

    parsed = parser.parse_newrecruit_dict(row, default_id=f"nr_{lkey}", enrich=False)
    parsed["source_format"] = row.get("source_format") or "NewRecruit Studio"
    saved = save_fn(parsed)
    return {
        "success": True,
        "action": "upsert",
        "army_list": saved,
        "army_lists": list_fn(),
    }


def _nr_rpc_call(method: str, params: List[Any], access_token: Optional[str] = None) -> Any:
    """Calls https://www.newrecruit.eu/api/rpc?m=<method> and returns parsed JSON."""
    url = f"{NR_BASE_URL}/api/rpc?m={urllib.parse.quote(method)}"
    payload = json.dumps({"method": method, "params": params}).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "User-Agent": NR_USER_AGENT,
        "Origin": NR_BASE_URL,
        "Referer": f"{NR_BASE_URL}/app/Lists",
    }
    if access_token:
        headers["Authorization"] = access_token

    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=12.0) as resp:
        raw = resp.read().decode("utf-8", errors="ignore")
        return json.loads(raw) if raw else {}


def hash_newrecruit_password(login: str, password: str) -> str:
    """
    Replicates NewRecruit's exact client-side password hash `vb(login, password)`:
    1. md5_hex = md5(f"{login}*{password}")
    2. sha256_hex = sha256(md5_hex)
    """
    step1 = hashlib.md5(f"{login}*{password}".encode("utf-8")).hexdigest()
    return hashlib.sha256(step1.encode("utf-8")).hexdigest()


def handle_nr_cloud_connect(
    body: Dict[str, Any],
    save_fn: Callable[[Dict[str, Any]], Dict[str, Any]],
    delete_fn: Callable[[str], bool],
    list_fn: Callable[[], List[Dict[str, Any]]],
    user_key: str = "default",
) -> Dict[str, Any]:
    """
    Handles Option 2: NewRecruit Cloud Account Connection & Bidirectional Cloud List Sync.
    """
    action = str(body.get("action") or "connect").strip().lower()
    parser = get_parser()

    if action == "status":
        acct = _NR_CLOUD_ACCOUNTS.get(user_key) or _NR_CLOUD_ACCOUNTS.get("default") or {}
        return {
            "success": True,
            "connected": bool(acct.get("connected")),
            "login": acct.get("login") or "",
            "last_sync": acct.get("last_sync"),
            "synced_count": acct.get("synced_count", 0),
        }

    if action == "disconnect":
        _NR_CLOUD_ACCOUNTS.pop(user_key, None)
        _NR_CLOUD_ACCOUNTS.pop("default", None)
        return {
            "success": True,
            "connected": False,
            "login": "",
            "army_lists": list_fn(),
        }

    acct = dict(_NR_CLOUD_ACCOUNTS.get(user_key) or _NR_CLOUD_ACCOUNTS.get("default") or {})
    login_input = str(body.get("login") or body.get("username") or body.get("email") or acct.get("login") or "").strip()
    password_input = str(body.get("password") or "").strip()
    access_token = str(body.get("access_token") or acct.get("access") or "").strip()
    refresh_token = str(body.get("refresh_token") or acct.get("refresh") or "").strip()

    share_url_or_key = str(body.get("share_url") or body.get("list_key") or "").strip()
    if share_url_or_key and not password_input and action in ("sync_link", "connect"):
        parsed = parser.parse_url(share_url_or_key)
        parsed["source_format"] = "NewRecruit Cloud"
        saved = save_fn(parsed)
        return {
            "success": True,
            "connected": bool(acct.get("connected")),
            "login": acct.get("login") or "NewRecruit Share Link",
            "synced_count": 1,
            "army_list": saved,
            "army_lists": list_fn(),
        }

    if login_input and password_input:
        resolved_login = login_input
        try:
            if "@" in login_input:
                email_res = _nr_rpc_call("login_from_email", [login_input])
                if isinstance(email_res, dict) and email_res.get("login"):
                    resolved_login = str(email_res["login"]).strip()
                elif isinstance(email_res, dict) and email_res.get("error"):
                    return {"success": False, "error": str(email_res["error"])}

            pwd_hash = hash_newrecruit_password(resolved_login, password_input)
            client_key = acct.get("client_key") or uuid.uuid4().hex[:8]
            login_res = _nr_rpc_call("login", [resolved_login, pwd_hash, client_key, "36.25"])
            if isinstance(login_res, dict) and login_res.get("access"):
                access_token = str(login_res["access"])
                refresh_token = str(login_res.get("refresh") or "")
                acct = {
                    "connected": True,
                    "login": resolved_login,
                    "access": access_token,
                    "refresh": refresh_token,
                    "client_key": client_key,
                }
            else:
                err_msg = (
                    (login_res.get("error") or login_res.get("message") or login_res.get("msg"))
                    if isinstance(login_res, dict)
                    else "Invalid NewRecruit username or password"
                )
                return {"success": False, "error": str(err_msg or "Invalid NewRecruit credentials")}
        except Exception as e:
            logger.warning("NewRecruit RPC login error: %s", e)
            return {"success": False, "error": f"Could not reach NewRecruit Cloud API: {e}"}

    if not access_token:
        return {
            "success": False,
            "error": "Please enter your NewRecruit username/email and password to connect your account.",
        }

    try:
        user_data = _nr_rpc_call("user_get_data", [], access_token=access_token)
        if isinstance(user_data, dict) and user_data.get("error"):
            return {"success": False, "error": str(user_data["error"])}

        cloud_list_stubs = user_data.get("lists") if isinstance(user_data, dict) else []
        if not isinstance(cloud_list_stubs, list):
            cloud_list_stubs = []

        list_keys = [str(item.get("list_key")).strip() for item in cloud_list_stubs if isinstance(item, dict) and item.get("list_key")]
        full_lists: List[Dict[str, Any]] = []
        if list_keys:
            bulk_res = _nr_rpc_call("get_list_bulk", [list_keys], access_token=access_token)
            if isinstance(bulk_res, list):
                full_lists = [r for r in bulk_res if isinstance(r, dict)]
            elif isinstance(bulk_res, dict) and isinstance(bulk_res.get("lists"), list):
                full_lists = [r for r in bulk_res["lists"] if isinstance(r, dict)]

        synced_keys = set()
        for row in full_lists:
            lkey = str(row.get("list_key") or "").strip()
            if not lkey:
                continue
            synced_keys.add(lkey)
            parsed = parser.parse_newrecruit_dict(row, default_id=f"nr_{lkey}", enrich=False)
            parsed["source_format"] = "NewRecruit Cloud"
            save_fn(parsed)

        for existing_item in list_fn():
            if not isinstance(existing_item, dict):
                continue
            if existing_item.get("source_format") == "NewRecruit Cloud":
                ex_id = str(existing_item.get("id") or "")
                ex_key = str(existing_item.get("list_key") or (ex_id[3:] if ex_id.startswith("nr_") else ""))
                if ex_key and ex_key not in synced_keys:
                    delete_fn(ex_id)

        now_iso = datetime.now(timezone.utc).isoformat()
        acct["connected"] = True
        acct["last_sync"] = now_iso
        acct["synced_count"] = len(synced_keys)
        _NR_CLOUD_ACCOUNTS[user_key] = acct
        _NR_CLOUD_ACCOUNTS["default"] = acct

        return {
            "success": True,
            "connected": True,
            "login": acct.get("login") or login_input,
            "last_sync": now_iso,
            "synced_count": len(synced_keys),
            "army_lists": list_fn(),
        }
    except Exception as e:
        logger.warning("NewRecruit Cloud sync error: %s", e)
        return {"success": False, "error": f"Failed to sync lists from NewRecruit Cloud: {e}"}
