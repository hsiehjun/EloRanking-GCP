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

# In-memory cache for static NewRecruit assets (/_nuxt/*, /settings/*, /assets/*, /api/book/*, HTML shell)
_NR_STATIC_CACHE: Dict[str, Tuple[float, bytes, str]] = {}
_NR_HTML_SHELL_CACHE: Optional[Tuple[float, str]] = None
_NR_CACHE_TTL_SECONDS = 86400  # 24 hours

try:
    import urllib3
    _NR_HTTP_POOL: Optional[Any] = urllib3.PoolManager(maxsize=16, retries=urllib3.Retry(total=2, backoff_factor=0.1))
except Exception:
    _NR_HTTP_POOL = None

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
<style id="omnitactica-nr-clean-ui">
  /* 1. Hide all ad banners, supporter prompts, and subscription/payment clutter */
  .support-banner,
  .ad-banner,
  .adbanner,
  [class*="SupportNewRecruit"],
  [class*="playwire"],
  [id^="google_ads"],
  [id^="div-gpt-ad"],
  [id^="tyche"],
  .pw-tag,
  [data-v-2c249119],
  iframe[src*="googlesyndication"],
  iframe[src*="doubleclick"],
  iframe[src*="intergient"],
  iframe[src*="playwire"] {
    display: none !important;
    height: 0 !important;
    max-height: 0 !important;
    overflow: hidden !important;
    pointer-events: none !important;
  }

  /* 2. Keep Navigation Bar at Top on BOTH Desktop & Mobile; Hide Bottom Bar & Non-List Icons */
  .menu.mainMenu {
    position: fixed !important;
    top: 0 !important;
    bottom: auto !important;
    left: 0 !important;
    right: 0 !important;
    height: 50px !important;
    background: #161b26 !important;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
    display: flex !important;
    flex-direction: row !important;
    align-items: center !important;
    justify-content: space-between !important;
    padding: 0 10px !important;
    z-index: 999 !important;
    box-sizing: border-box !important;
  }
  .menu.mainMenu .left {
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    min-width: 0 !important;
    flex: 1 1 auto !important;
    overflow: hidden !important;
  }
  .menu.mainMenu .left a[href="/app/MyLists"],
  .menu.mainMenu .left a.hideOnSmallScreen,
  .menu.mainMenu .left button.navBarItem {
    display: inline-flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    flex-shrink: 0 !important;
  }
  .menu.mainMenu .left select {
    max-width: min(230px, 50vw) !important;
    text-overflow: ellipsis !important;
  }
  .menu.mainMenu .right.menuIcons {
    position: static !important;
    bottom: auto !important;
    left: auto !important;
    right: auto !important;
    width: auto !important;
    height: auto !important;
    border-top: none !important;
    background: transparent !important;
    display: flex !important;
    align-items: center !important;
    justify-content: flex-end !important;
    flex-shrink: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
  }
  html body {
    padding-top: 52px !important;
    padding-bottom: 0 !important;
  }
  #mainContent,
  .mainContent {
    top: 52px !important;
    bottom: 0 !important;
  }
  .main-view {
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    margin-top: 0 !important;
  }

  /* Hide Games, Lists (duplicate icon), Models, Tourny, Profile, Play, Support, Build from right/bottom menu — keep ONLY Login/User */
  .menu.mainMenu .right.menuIcons a.priority-3,
  .menu.mainMenu .right.menuIcons a.priority-4,
  .menu.mainMenu .right.menuIcons a.priority-5,
  .menu.mainMenu .right.menuIcons a.priority-6,
  .menu.mainMenu .right.menuIcons a.priority-7,
  .menu.mainMenu .right.menuIcons a.priority-8,
  .menu.mainMenu .right.menuIcons a.priority-9,
  .menu.mainMenu .right.menuIcons a.hideOnBigScreen,
  .menu.mainMenu .right.menuIcons a[href="/app/MySystems"],
  .menu.mainMenu .right.menuIcons a[href="/app/tourny"],
  .menu.mainMenu .right.menuIcons a[href="/app/MyModels"],
  .menu.mainMenu .right.menuIcons a[href="/app/Profile"],
  .menu.mainMenu .right.menuIcons a[href="/app/game"],
  .menu.mainMenu .right.menuIcons a[href="/app/supporters"],
  .menu.mainMenu .right.menuIcons a[href="/app/Lists"],
  .menu.mainMenu .right.menuIcons a:has(.nr-miniature),
  .menu.mainMenu .right.menuIcons a:has(.tourny),
  .menu.mainMenu .right.menuIcons a:has(.nr-games) {
    display: none !important;
  }

  /* 3. Hide "Import file", "Text Import", "Sync Lists", and "Delete X Lists" buttons in MyLists */
  [data-v-2b034e2c],
  .importButtons,
  .importRow,
  .boutons.mobilePadding > [data-v-2b034e2c],
  [data-v-b9210782] .boutons.mobilePadding > button.bouton:not(.createToolbarBtn),
  .folder[data-v-7711fa10] > .boutons,
  [data-v-7711fa10] > .boutons > button.bouton,
  .omnitactica-hidden-nr-btn {
    display: none !important;
  }

  /* 4. Direct-List Loading Screen (prevents flashing /app/MyLists when opening a specific list) */
  html.omnitactica-nr-embedded-viewer header,
  html.omnitactica-nr-embedded-viewer .menu.mainMenu {
    display: none !important;
  }
  html.omnitactica-nr-embedded-viewer .main-view {
    padding-top: 4px !important;
    margin-top: 0 !important;
  }
  html.omnitactica-nr-direct-list-loading,
  html.omnitactica-nr-direct-list-loading body {
    background: #090d16 !important;
    overflow: hidden !important;
  }
  html.omnitactica-nr-direct-list-loading #__nuxt {
    opacity: 0 !important;
    pointer-events: none !important;
  }
  #omnitactica-nr-direct-loader {
    position: fixed;
    inset: 0;
    z-index: 999999;
    background: radial-gradient(circle at center, #0f172a 0%, #070b14 100%);
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    color: #f8fafc;
    text-align: center;
    padding: 24px;
  }
  html.omnitactica-nr-direct-list-loading #omnitactica-nr-direct-loader {
    display: flex !important;
  }
  @keyframes omniNrSpin {
    to { transform: rotate(360deg); }
  }
  .omnitactica-nr-spinner {
    width: 40px;
    height: 40px;
    border: 3.5px solid rgba(56, 189, 248, 0.2);
    border-top-color: #38bdf8;
    border-radius: 50%;
    animation: omniNrSpin 0.75s linear infinite;
  }

  /* 5. Login / Account Page (/app/Login): Keep ONLY the Login Form / Welcome + Logout button */
  .connectForm .nrversion,
  .connectForm .section.boutons,
  .connectForm a[href="/app/Options"],
  .connectForm a[href="/app/MySystems"],
  .connectForm a[href="/app/MyModels"],
  .connectForm a[href="/app/combat"],
  .connectForm a[href="/app/wh40kSimulator"],
  .connectForm a[href="/app/wh40kDeployment"],
  .connectForm a[href="/app/tourny"],
  .connectForm a[href="/app/Profile"],
  .connectForm a[href="/app/changelog"],
  .connectForm a[href="/app/Contact"],
  .connectForm a[href="/app/Paths"],
  .connectForm .modal {
    display: none !important;
  }

  .connectForm {
    max-width: 380px !important;
    width: 92% !important;
    height: fit-content !important;
    min-height: 0 !important;
    max-height: fit-content !important;
    margin: 48px auto !important;
    padding: 28px 32px !important;
    background: #f8fafc !important;
    color: #0f172a !important;
    border: 1px solid #cbd5e1 !important;
    border-radius: 14px !important;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12) !important;
    overflow: hidden !important;
  }
  .connectForm #loginform {
    height: auto !important;
    min-height: 0 !important;
    margin: 0 auto !important;
    width: 100% !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
  }
</style>
<script id="omnitactica-nr-bridge">
(function() {
  if (window.__omnitacticaNrBridgeInstalled) return;
  window.__omnitacticaNrBridgeInstalled = true;

  // 0. Block all 3rd-party Ad/RTB/Telemetry requests (Playwire, Prebid, OpenX, Rubicon, GTag, Sentry)
  // so 0 red "(blocked:other)" errors occur and page load is never delayed by ad auctions.
  var AD_BLOCK_RE = /playwire|intergient|prebid|openx|rubiconproject|doubleclick|googlesyndication|googletagmanager|google-analytics|btloader|adnxs|criteo|pubmatic|sonobi|sharethrough|gumgum|3lift|casalemedia|amazon-adsystem|indexexchange|smartadserver|yieldmo|kargo|teads|onetag|medianet|bidswitch|taboola|outbrain|sentry\.io|report_client_error|error_snapshot_save/i;

  try {
    var origFetch = window.fetch ? window.fetch.bind(window) : null;
    if (origFetch) {
      window.fetch = function(input, init) {
        var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
        if (url && AD_BLOCK_RE.test(url)) {
          return Promise.resolve(new Response('{}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
        if (typeof input === 'string' && /^https?:\/\/(?:api|www)\.newrecruit\.eu(\/.*)$/i.test(input)) {
          input = input.replace(/^https?:\/\/(?:api|www)\.newrecruit\.eu/i, '');
        }
        return origFetch(input, init);
      };
    }

    var origXhrOpen = XMLHttpRequest.prototype.open;
    var origXhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      var urlStr = String(url || '');
      this.__omniBlockedAd = AD_BLOCK_RE.test(urlStr);
      if (this.__omniBlockedAd) {
        return origXhrOpen.call(this, method, 'data:application/json,%7B%7D', true);
      }
      if (/^https?:\/\/(?:api|www)\.newrecruit\.eu(\/.*)$/i.test(urlStr)) {
        arguments[1] = urlStr.replace(/^https?:\/\/(?:api|www)\.newrecruit\.eu/i, '');
      }
      return origXhrOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
      if (this.__omniBlockedAd) {
        var self = this;
        setTimeout(function() {
          try {
            if (typeof self.onload === 'function') self.onload();
            if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
          } catch (e) {}
        }, 0);
        return;
      }
      return origXhrSend.apply(this, arguments);
    };

    var origCreateElement = document.createElement.bind(document);
    document.createElement = function(tagName, options) {
      var el = origCreateElement(tagName, options);
      if (String(tagName || '').toLowerCase() === 'script') {
        var origSetAttr = el.setAttribute.bind(el);
        el.setAttribute = function(name, val) {
          if (String(name || '').toLowerCase() === 'src' && AD_BLOCK_RE.test(String(val || ''))) {
            return origSetAttr('src', 'data:text/javascript,//');
          }
          return origSetAttr(name, val);
        };
        try {
          var protoDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
          if (protoDesc && protoDesc.set) {
            Object.defineProperty(el, 'src', {
              configurable: true,
              enumerable: true,
              get: function() { return protoDesc.get ? protoDesc.get.call(this) : this.getAttribute('src'); },
              set: function(v) {
                if (AD_BLOCK_RE.test(String(v || ''))) {
                  v = 'data:text/javascript,//';
                }
                if (protoDesc.set) protoDesc.set.call(this, v);
                else origSetAttr('src', v);
              }
            });
          }
        } catch (e) {}
      }
      return el;
    };
  } catch (e) {}

  // Heal any corrupt legacy 'nr' IndexedDB (version < 200 created before Dexie) so Dexie never hits VersionError
  try {
    if (window.indexedDB && typeof window.indexedDB.databases === 'function') {
      window.indexedDB.databases().then(function(dbs) {
        if (!Array.isArray(dbs)) return;
        dbs.forEach(function(d) {
          if (d && d.name === 'nr' && d.version && d.version < 200) {
            try { window.indexedDB.deleteDatabase('nr'); } catch (e) {}
          }
        });
      }).catch(function() {});
    }
  } catch (e) {}

  var initialSearch = window.location.search || '';
  var initialPath = window.location.pathname || '';
  var isEmbeddedViewer = (
    initialSearch.indexOf('embed=hub') !== -1 ||
    initialSearch.indexOf('embed=tracker') !== -1
  );
  if (isEmbeddedViewer) {
    try { document.documentElement.classList.add('omnitactica-nr-embedded-viewer'); } catch (e) {}
  }
  var wantPlayModeFromUrl = (
    initialSearch.indexOf('view=play') !== -1 ||
    initialSearch.indexOf('play=1') !== -1 ||
    initialSearch.indexOf('mode=play') !== -1
  );
  var requestedListKeyFromUrl = null;
  var requestedListNameFromUrl = '';
  var mNameQuery = initialSearch.match(/[?&]name=([^&#]+)/i);
  if (mNameQuery && mNameQuery[1]) {
    try { requestedListNameFromUrl = decodeURIComponent(mNameQuery[1]).trim(); } catch (e) {}
  }
  var mListUrl = initialPath.match(/\/Lists\/([^\/\?\#]+)/i) || initialPath.match(/\/list\/([^\/\?\#]+)/i);
  if (mListUrl && mListUrl[1]) {
    requestedListKeyFromUrl = decodeURIComponent(mListUrl[1]);
  } else {
    var mQueryList = initialSearch.match(/[?&]list=([^&#]+)/i);
    if (mQueryList && mQueryList[1]) {
      requestedListKeyFromUrl = decodeURIComponent(mQueryList[1]);
    }
  }

  var directListLoaderTimer = null;
  var directListLookupRetries = 0;
  function showDirectListLoader(label) {
    try {
      document.documentElement.classList.add('omnitactica-nr-direct-list-loading');
      var ensureDom = function() {
        if (!document.body) return;
        var el = document.getElementById('omnitactica-nr-direct-loader');
        if (!el) {
          el = document.createElement('div');
          el.id = 'omnitactica-nr-direct-loader';
          el.innerHTML = '<div class="omnitactica-nr-spinner"></div>' +
            '<div id="omnitactica-nr-direct-loader-title" style="font-size:15px;font-weight:800;color:#f8fafc;letter-spacing:0.01em;">Loading Army Roster...</div>' +
            '<div style="font-size:12px;color:#94a3b8;">Opening datasheet &amp; detachment view...</div>';
          document.body.appendChild(el);
        }
        if (label) {
          var tEl = document.getElementById('omnitactica-nr-direct-loader-title');
          if (tEl) tEl.textContent = label;
        }
      };
      if (document.body) ensureDom();
      else document.addEventListener('DOMContentLoaded', ensureDom, { once: true });
      if (directListLoaderTimer) clearTimeout(directListLoaderTimer);
      directListLoaderTimer = setTimeout(hideDirectListLoader, 7500);
    } catch (e) {}
  }

  function hideDirectListLoader() {
    try {
      if (directListLoaderTimer) {
        clearTimeout(directListLoaderTimer);
        directListLoaderTimer = null;
      }
      document.documentElement.classList.remove('omnitactica-nr-direct-list-loading');
    } catch (e) {}
  }

  if (requestedListKeyFromUrl) {
    showDirectListLoader(wantPlayModeFromUrl ? 'Loading Play Mode Datasheets...' : 'Opening Army Roster...');
  }

  // 1. Rewrite /nr/app/... path to clean /app/MyLists BEFORE Nuxt vue-router initializes
  // so Lists.vue never misinterprets cache-busting query params (e.g. _cb) as a broken list query.
  try {
    var curPath = window.location.pathname || '';
    if (requestedListKeyFromUrl || /^\/(?:nr\/)?app(?:\/Lists|\/MyLists|\/)?$/i.test(curPath)) {
      window.history.replaceState(null, '', '/app/MyLists');
    } else if (curPath.indexOf('/nr/app') === 0) {
      var mappedPath = curPath.replace(/^\/nr\/app/, '/app');
      window.history.replaceState(null, '', mappedPath);
    }
  } catch (err) {
    console.warn('[OmniTactica Bridge] Path rewrite notice:', err);
  }

  var isHydrating = false;
  var initialHydrationDone = false;
  var readyNotified = false;
  var playModeActivatedForKey = null;
  var compilingKeys = {};
  var knownListsMap = {}; // list_key -> signature string
  var syncInFlight = {};
  var pendingNrRowFromParent = null;
  var cachedNrDb = null;

  function getAuthHeaders(extraHeaders) {
    var hdrs = Object.assign({}, extraHeaders || {});
    try {
      var tok = localStorage.getItem('native_session_token') || localStorage.getItem('elo_auth_token') || '';
      if (!tok && document.cookie) {
        var m = document.cookie.match(/(?:^|;\s*)(?:session_token|elo_auth_token|native_session_token)=([^;]+)/);
        if (m && m[1]) tok = decodeURIComponent(m[1]);
      }
      if (tok) {
        hdrs['Authorization'] = 'Bearer ' + tok;
      }
    } catch (e) {}
    return hdrs;
  }

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
      row._omnitactica_book_name || '',
      row._omnitactica_detachment || '',
      row.version || 0,
      armyStr.length,
      enrichedStr
    ].join('|');
  }

  function getNrStores() {
    var s = globalThis.__nr_stores;
    if (!s || !s.system || !s.user) return null;
    try {
      s.user.isSupporter = function() { return true; };
    } catch (e) {}
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

  // Extract live unit summary, detachment, and book metadata from a live Army instance or $debugOption
  function extractLiveArmyMetadata(targetListKey, explicitArmy, explicitBook) {
    var out = { units: null, detachment: '', bookName: '', systemName: '' };
    try {
      var stores = getNrStores();
      var inst = explicitArmy || null;
      var bookInst = explicitBook || null;
      if (!inst && stores && stores.list && stores.list.currentList) {
        var cl = stores.list.currentList;
        if (!targetListKey || (cl.row && cl.row.list_key === targetListKey)) {
          inst = cl.army || null;
          bookInst = bookInst || cl.book || null;
        }
      }
      if (!inst && window.$debugOption && typeof window.$debugOption.getForces === 'function') {
        var curUrl = window.location.pathname || '';
        if (!targetListKey || curUrl.indexOf('/Lists/') === -1 || curUrl.indexOf(targetListKey) !== -1) {
          inst = window.$debugOption;
        }
      }
      if (bookInst) {
        if (typeof bookInst.getName === 'function') out.bookName = bookInst.getName() || '';
        else if (bookInst.name) out.bookName = bookInst.name;
        var sysObj = typeof bookInst.getSystem === 'function' ? bookInst.getSystem() : bookInst.system;
        if (sysObj && (sysObj.name || sysObj.short)) out.systemName = sysObj.name || sysObj.short || '';
      }
      if (!inst || typeof inst.getForces !== 'function') return out;
      var enriched = [];
      var forces = inst.getForces() || [];
      for (var fIdx = 0; fIdx < forces.length; fIdx++) {
        var force = forces[fIdx];
        if (!force || typeof force.getCategories !== 'function') continue;
        if (!out.bookName && typeof force.getBook === 'function' && force.getBook()) {
          var fb = force.getBook();
          out.bookName = (typeof fb.getName === 'function' ? fb.getName() : fb.name) || '';
        }
        var cats = force.getCategories() || [];
        for (var cIdx = 0; cIdx < cats.length; cIdx++) {
          var cat = cats[cIdx];
          if (!cat || typeof cat.getUnits !== 'function') continue;
          if (cat.isConfiguration) {
            var cfgUnits = cat.getUnits() || [];
            for (var cuIdx = 0; cuIdx < cfgUnits.length; cuIdx++) {
              var cu = cfgUnits[cuIdx];
              if (!cu) continue;
              var cuName = (typeof cu.getName === 'function' ? cu.getName() : (cu.name || '')).toLowerCase();
              if (cuName.indexOf('detachment') !== -1 && typeof cu.getChildInstances === 'function') {
                var ch = cu.getChildInstances() || [];
                for (var chIdx = 0; chIdx < ch.length; chIdx++) {
                  var cInst = ch[chIdx];
                  if (cInst && (!cInst.getAmount || cInst.getAmount() > 0)) {
                    var detVal = typeof cInst.getName === 'function' ? cInst.getName() : (cInst.name || '');
                    if (detVal && detVal.toLowerCase().indexOf('detachment') === -1) {
                      out.detachment = detVal;
                    }
                  }
                }
              }
            }
            continue;
          }
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
      if (enriched.length > 0) out.units = enriched;
    } catch (e) {}
    return out;
  }

  function cloneCleanRow(row, explicitArmy, explicitBook) {
    if (!row || typeof row !== 'object') return null;
    try {
      var copy = JSON.parse(JSON.stringify(row));
      if (!copy.list_key && copy._id) {
        copy.list_key = String(copy._id);
      }
      var stores = getNrStores();
      if (explicitArmy && typeof explicitArmy.toJson === 'function') {
        try {
          copy.army = explicitArmy.toJson();
          if (typeof explicitArmy.getPointsCost === 'function') {
            copy.totalCost = explicitArmy.getPointsCost() || copy.totalCost || 0;
          }
        } catch (e) {}
      } else if (stores && stores.list && stores.list.currentList && stores.list.currentList.row && stores.list.currentList.row.list_key === copy.list_key) {
        var curArmy = stores.list.currentList.army;
        if (curArmy && typeof curArmy.toJson === 'function') {
          try {
            copy.army = curArmy.toJson();
            if (typeof curArmy.getPointsCost === 'function') {
              copy.totalCost = curArmy.getPointsCost() || copy.totalCost || 0;
            }
          } catch (e) {}
        }
      }
      var meta = extractLiveArmyMetadata(copy.list_key, explicitArmy, explicitBook);
      if (meta.units && meta.units.length > 0) {
        copy._omnitactica_enriched_units = meta.units;
      }
      if (meta.detachment) {
        copy._omnitactica_detachment = meta.detachment;
      }
      if (meta.bookName) {
        copy._omnitactica_book_name = meta.bookName;
      }
      if (meta.systemName) {
        copy._omnitactica_system_name = meta.systemName;
      }
      // Also resolve book & system name from stores.system.library (index or array) if not set yet
      if (stores && stores.system && stores.system.library && (copy.id_system || copy.bsid_system)) {
        var lib = stores.system.library;
        var sysData = (lib.index && copy.id_system && lib.index[copy.id_system]) ? lib.index[copy.id_system] : null;
        if (!sysData && Array.isArray(lib.array)) {
          sysData = lib.array.find(function(n) {
            return n && (n.id == copy.id_system || (n.bsid != null && (n.bsid == copy.id_system || n.bsid == copy.bsid_system)));
          }) || null;
        }
        if (sysData) {
          if (!copy._omnitactica_system_name && (sysData.name || sysData.short)) {
            copy._omnitactica_system_name = sysData.name || sysData.short;
          }
          if (!copy._omnitactica_book_name && (copy.id_book || copy.bsid_book) && sysData.books) {
            if (sysData.books.index && copy.id_book && sysData.books.index[copy.id_book]) {
              copy._omnitactica_book_name = sysData.books.index[copy.id_book].name || '';
            } else if (Array.isArray(sysData.books.array)) {
              var bkMatch = sysData.books.array.find(function(d) {
                return d && (d.id == copy.id_book || (d.bsid != null && (d.bsid == copy.id_book || d.bsid == copy.bsid_book)));
              });
              if (bkMatch && bkMatch.name) {
                copy._omnitactica_book_name = bkMatch.name;
              }
            }
          }
        }
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
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
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

  async function syncUpsertRow(row, explicitArmy, explicitBook) {
    if (isHydrating || !row || row._ephemeral_view) return;
    var clean = cloneCleanRow(row, explicitArmy, explicitBook);
    if (!clean || !clean.list_key) return;
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
        if (!isHydrating && this.name === 'lists' && value && (value.list_key || value._id)) {
          var captured = value;
          req.addEventListener('success', function() {
            setTimeout(function() { syncUpsertRow(captured); }, 40);
          });
        }
      } catch (e) {}
      return req;
    };

    var origAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function(value, key) {
      var req = origAdd.apply(this, arguments);
      try {
        if (!isHydrating && this.name === 'lists' && value && (value.list_key || value._id)) {
          var captured = value;
          req.addEventListener('success', function() {
            setTimeout(function() { syncUpsertRow(captured); }, 40);
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
              setTimeout(function() { syncDeleteKey(capturedKey); }, 40);
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
              setTimeout(function() { syncDeleteKey(pKey); }, 40);
            }
          });
        }
      } catch (e) {}
      return req;
    };
  } catch (err) {
    console.warn('[OmniTactica Bridge] IDB hook notice:', err);
  }

  // Safely open existing 'nr' IndexedDB ONLY after Dexie has initialized it (version >= 200)
  // and reuse the connection without calling db.close() so Dexie's on("close") handler never fires.
  async function openExistingNrDb() {
    if (cachedNrDb) {
      try {
        if (cachedNrDb.objectStoreNames && cachedNrDb.objectStoreNames.contains('lists')) {
          return cachedNrDb;
        }
      } catch (e) {
        cachedNrDb = null;
      }
    }
    try {
      var stores = getNrStores();
      if (!stores || !stores.list || !stores.list.listsInitiated) {
        return null;
      }
      if (indexedDB.databases) {
        var dbs = await indexedDB.databases();
        var nrExists = dbs && dbs.some(function(d) { return d.name === 'nr' && d.version >= 200; });
        if (!nrExists) return null;
      }
      return await new Promise(function(resolve) {
        var req = indexedDB.open('nr');
        req.onsuccess = function() {
          var db = req.result;
          if (db && db.objectStoreNames && db.objectStoreNames.contains('lists')) {
            db.onversionchange = function() {
              try { db.close(); } catch (e) {}
              cachedNrDb = null;
            };
            cachedNrDb = db;
            resolve(db);
          } else {
            resolve(null);
          }
        };
        req.onerror = function() { resolve(null); };
      });
    } catch (e) {
      return null;
    }
  }

  // Check whether a list row is active & visible in NewRecruit's MyLists view (not deleted book, not hidden folder)
  function isActiveNrListRow(r, stores) {
    if (!r || !(r.list_key || r._id) || r._ephemeral_view || r.deleted || r.trashed) {
      return false;
    }
    if (!stores) return true;
    try {
      // 1. Check hidden folder in optionsStore
      if (stores.options && typeof stores.options.getSystemOption === 'function' && r.id_system) {
        var folderName = (r.metadata && r.metadata.folder) ? String(r.metadata.folder) : 'Default';
        var sysFolders = stores.options.getSystemOption(r.id_system, 'folders', []);
        if (Array.isArray(sysFolders)) {
          var isHiddenFolder = sysFolders.some(function(f) {
            return f && f.name === folderName && Boolean(f.hidden);
          });
          if (isHiddenFolder) return false;
        }
      }
      // 2. Check valid system & book in library using NewRecruit's ListsView.getBookName logic
      if (stores.system && stores.system.library && (r.id_system || r.bsid_system) && (r.id_book || r.bsid_book)) {
        var lib = stores.system.library;
        if (lib.index && lib.index[r.id_system] && lib.index[r.id_system].books && lib.index[r.id_system].books.index && lib.index[r.id_system].books.index[r.id_book]) {
          return true;
        }
        if (Array.isArray(lib.array) && lib.array.length > 0) {
          var sysObj = lib.array.find(function(n) {
            return n && (
              n.id == r.id_system ||
              (n.bsid != null && (n.bsid == r.id_system || n.bsid == r.bsid_system))
            );
          });
          if (sysObj && sysObj.books && Array.isArray(sysObj.books.array) && sysObj.books.array.length > 0) {
            var bkObj = sysObj.books.array.find(function(d) {
              return d && (
                d.id == r.id_book ||
                (d.bsid != null && (d.bsid == r.id_book || d.bsid == r.bsid_book))
              );
            });
            if (!bkObj) return false;
          }
        }
      }
    } catch (e) {}
    return true;
  }

  // Read active lists from Pinia stores.list.listData (authoritative live UI state) matching the active game system
  async function readAllNrLists() {
    var mergedMap = {};
    var mergedList = [];
    var stores = getNrStores();
    var piniaInitiated = Boolean(stores && stores.list && stores.list.listsInitiated);
    if (stores && stores.list) {
      if (Array.isArray(stores.list.listData)) {
        for (var i = 0; i < stores.list.listData.length; i++) {
          var r = stores.list.listData[i];
          if (r && (r.list_key || r._id)) {
            var k = String(r.list_key || r._id);
            r.list_key = k;
            if (!isActiveNrListRow(r, stores)) continue;
            mergedMap[k] = r;
            mergedList.push(r);
          }
        }
      }
      if (stores.list.currentList && stores.list.currentList.row) {
        var cr = stores.list.currentList.row;
        var ck = String(cr.list_key || cr._id || '');
        if (ck && isActiveNrListRow(cr, stores)) {
          cr.list_key = ck;
          if (stores.list.currentList.army && typeof stores.list.currentList.army.toJson === 'function') {
            try {
              cr.army = stores.list.currentList.army.toJson();
              cr.totalCost = stores.list.currentList.army.getPointsCost() || cr.totalCost || 0;
            } catch (e) {}
          }
          if (!mergedMap[ck]) {
            mergedMap[ck] = cr;
            mergedList.push(cr);
          } else {
            mergedMap[ck] = Object.assign(mergedMap[ck], cr);
          }
        }
      }
    }

    var db = await openExistingNrDb();
    if (db) {
      var idbRows = await new Promise(function(resolve) {
        try {
          var tx = db.transaction('lists', 'readonly');
          var store = tx.objectStore('lists');
          var req = store.getAll();
          req.onsuccess = function() { resolve(req.result || []); };
          req.onerror = function() { resolve([]); };
        } catch (e) {
          resolve([]);
        }
      });
      for (var j = 0; j < idbRows.length; j++) {
        var ir = idbRows[j];
        if (ir && (ir.list_key || ir._id)) {
          var ik = String(ir.list_key || ir._id);
          ir.list_key = ik;
          if (piniaInitiated) {
            if (mergedMap[ik] && !mergedMap[ik].army && ir.army) {
              mergedMap[ik].army = ir.army;
            }
          } else if (!mergedMap[ik] && isActiveNrListRow(ir, stores)) {
            mergedMap[ik] = ir;
            mergedList.push(ir);
          }
        }
      }
    }

    // Filter to the currently selected game system (matching NewRecruit's filteredListsSystem) when lists exist for that system
    if (stores && stores.system && stores.system.selectedSystem && mergedList.length > 0) {
      var selSys = stores.system.selectedSystem;
      var sysFiltered = mergedList.filter(function(e) {
        return e && (
          e.id_system == selSys.id ||
          (selSys.bsid != null && (e.id_system == selSys.bsid || e.bsid_system == selSys.bsid))
        );
      });
      if (sysFiltered.length > 0) {
        return sysFiltered;
      }
    }

    if (mergedList.length > 0 || piniaInitiated) {
      return mergedList;
    }
    return null;
  }

  // 3. Hydrate NewRecruit from OmniTactica backend on startup AND reconcile active NewRecruit lists back to OmniTactica
  async function hydrateFromOmniTactica() {
    if (initialHydrationDone) return;
    try {
      var stores = null;
      for (var attempt = 0; attempt < 80; attempt++) {
        stores = getNrStores();
        if (stores && stores.list && stores.list.listsInitiated) break;
        await new Promise(function(r) { setTimeout(r, 120); });
      }
      if (!stores || !stores.list) {
        initialHydrationDone = true;
        return;
      }

      // Wait for NewRecruit cloud sync if running
      try {
        if (typeof stores.list.whenSynced === 'function') {
          await Promise.race([
            stores.list.whenSynced(),
            new Promise(function(r) { setTimeout(r, 2500); })
          ]);
        }
      } catch (e) {}

      var res = await fetch('/api/armylists/nr_state', {
        headers: getAuthHeaders(),
        credentials: 'same-origin'
      });
      if (!res.ok) {
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

      var isNrLoggedIn = Boolean(
        (stores.user && stores.user.user && stores.user.user.login) ||
        localStorage.getItem('access')
      );

      var serverRows = (state && Array.isArray(state.nr_rows)) ? state.nr_rows.slice() : [];
      if (pendingNrRowFromParent && pendingNrRowFromParent.list_key) {
        var alreadyInServer = serverRows.some(function(r) { return r && r.list_key === pendingNrRowFromParent.list_key; });
        if (!alreadyInServer) {
          serverRows.push(pendingNrRowFromParent);
        }
      }

      var currentListData = Array.isArray(stores.list.listData) ? stores.list.listData : [];
      var piniaKeyMap = {};
      var piniaNameMap = {};
      for (var pIdx = 0; pIdx < currentListData.length; pIdx++) {
        var pRow = currentListData[pIdx];
        if (!pRow || !pRow.list_key) continue;
        piniaKeyMap[pRow.list_key] = pRow;
        if (pRow.name) {
          piniaNameMap[String(pRow.name).trim().toLowerCase()] = pRow;
        }
      }

      // Only seed serverRows into Pinia if:
      // - It is the explicitly requested list from URL (and no real list with that key/name is already in Pinia), OR
      // - The user is NOT logged into NewRecruit AND Pinia has no lists at all yet.
      var allowSeedFromOmniServer = (!isNrLoggedIn && currentListData.length === 0);
      serverRows.forEach(function(sRow) {
        if (!sRow || !sRow.list_key) return;
        var sNameLow = String(sRow.name || '').trim().toLowerCase();
        var isTargetUrlRow = Boolean(
          (requestedListKeyFromUrl && requestedListKeyFromUrl === sRow.list_key) ||
          (requestedListNameFromUrl && sNameLow && sNameLow === requestedListNameFromUrl.toLowerCase())
        );
        if (!isTargetUrlRow && !allowSeedFromOmniServer) return;

        // If Pinia already has a real list with the same name (e.g. migrated to 11th Ed), don't seed a duplicate synthetic row
        if (isTargetUrlRow && piniaNameMap[sNameLow] && !piniaKeyMap[sRow.list_key]) {
          var realMatch = piniaNameMap[sNameLow];
          realMatch.metadata = Object.assign({}, realMatch.metadata || {}, { play_mode: Boolean(wantPlayModeFromUrl) });
          requestedListKeyFromUrl = realMatch.list_key;
          return;
        }

        sRow.metadata = Object.assign(
          { builder_settings: {}, custom_categories: [], custom_view: false },
          sRow.metadata || {}
        );
        if (isTargetUrlRow) {
          sRow.metadata.play_mode = Boolean(wantPlayModeFromUrl);
        }
        var existingPinia = piniaKeyMap[sRow.list_key];
        if (!existingPinia) {
          stores.list.listData.push(sRow);
          piniaKeyMap[sRow.list_key] = sRow;
          knownListsMap[sRow.list_key] = computeSignature(sRow);
        } else if (isTargetUrlRow) {
          existingPinia.metadata = Object.assign({}, existingPinia.metadata || {}, { play_mode: Boolean(wantPlayModeFromUrl) });
          knownListsMap[sRow.list_key] = computeSignature(existingPinia);
        }
      });

      try {
        if (typeof stores.list.rebuildTreeData === 'function') {
          stores.list.rebuildTreeData();
        }
      } catch (e) {}
    } catch (e) {
      console.warn('[OmniTactica Bridge] Hydration notice:', e);
    } finally {
      isHydrating = false;
      initialHydrationDone = true;
      await ensurePlayModeAndStoreHooks();
      if (!readyNotified && !requestedListKeyFromUrl) {
        readyNotified = true;
        notifyParent({ action: 'ready' });
      }
      if (!isEmbeddedViewer && !requestedListKeyFromUrl) {
        await forceFullSync();
      }
    }
  }

  async function upsertSingleRowToIdb(row) {
    if (!row || !row.list_key) return false;
    var stores = getNrStores();
    if (stores && stores.list && Array.isArray(stores.list.listData)) {
      row.metadata = Object.assign(
        { builder_settings: {}, custom_categories: [], custom_view: false },
        row.metadata || {}
      );
      var idx = stores.list.listData.findIndex(function(r) { return r && r.list_key === row.list_key; });
      if (idx === -1) {
        stores.list.listData.unshift(row);
      } else {
        stores.list.listData.splice(idx, 1, Object.assign({}, stores.list.listData[idx], row));
      }
      try {
        if (typeof stores.list.rebuildTreeData === 'function') {
          stores.list.rebuildTreeData();
        }
      } catch (e) {}
    }
    var db = await openExistingNrDb();
    if (!db) return true;
    var prevHydrating = isHydrating;
    isHydrating = true;
    return await new Promise(function(resolve) {
      try {
        var tx = db.transaction('lists', 'readwrite');
        var store = tx.objectStore('lists');
        var toPut = Object.assign({}, row);
        delete toPut._id;
        try { store.put(toPut); } catch (e) {}
        knownListsMap[row.list_key] = computeSignature(toPut);
        tx.oncomplete = function() {
          isHydrating = prevHydrating;
          resolve(true);
        };
        tx.onerror = function() {
          isHydrating = prevHydrating;
          resolve(false);
        };
      } catch (e) {
        isHydrating = prevHydrating;
        resolve(false);
      }
    });
  }

  // Compile synthetic/text-imported row into a real NewRecruit BattleScribe catalogue army using ukVEh7Py.js
  async function compileSyntheticRowIfNeeded(row, systemStore, listStore, forceCompile) {
    if (!row || !row.list_key || !row._synthetic_text) return row;
    if (row._compiled_by_nr && !forceCompile) return row;
    var rowArmyId = row.army ? String(row.army.id || '') : '';
    var hasSyntheticArmy = Boolean(
      forceCompile ||
      !row.army ||
      !row.nrversion ||
      rowArmyId.indexOf('army-') === 0 ||
      rowArmyId.indexOf('root-') === 0 ||
      rowArmyId.indexOf('cat-') === 0
    );
    if (!hasSyntheticArmy) return row;
    if (compilingKeys[row.list_key]) {
      return await compilingKeys[row.list_key];
    }
    var compilePromise = (async function() {
      try {
        var sys = await systemStore.selectSystem(row.id_system || 827374861);
        if (!sys) {
          sys = await systemStore.selectSystem(2821148162);
        }
        if (!sys) return row;
        var booksArr = (sys.books && Array.isArray(sys.books.array)) ? sys.books.array : [];
        var fallbackBook = booksArr.find(function(b) {
          return b && (b.id == row.id_book || b.bsid == row.bsid_book);
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
          if (listStore && Array.isArray(listStore.listData)) {
            var existingIdx = listStore.listData.findIndex(function(r) { return r && r.list_key === row.list_key; });
            if (existingIdx !== -1) {
              Object.assign(listStore.listData[existingIdx], row);
            }
          }
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

  function cleanUpMyListsButtons() {
    try {
      var btns = document.querySelectorAll('.main-view button, .main-view .bouton');
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (!b || b.classList.contains('createToolbarBtn')) continue;
        var txt = String(b.textContent || '').trim();
        if (
          txt === 'Import file' ||
          txt === 'Text Import' ||
          txt === 'Sync Lists' ||
          /^Delete\s+\d+\s+Lists?$/i.test(txt)
        ) {
          b.classList.add('omnitactica-hidden-nr-btn');
          if (b.parentElement && b.parentElement.classList.contains('importButtons')) {
            b.parentElement.classList.add('omnitactica-hidden-nr-btn');
          }
        }
      }
    } catch (e) {}
  }

  var activatingPlayMode = false;

  // 4. Hook NewRecruit Pinia stores to unlock Play Mode, hook list mutations, and auto-open requested list
  async function ensurePlayModeAndStoreHooks() {
    cleanUpMyListsButtons();
    var stores = getNrStores();
    if (!stores || !stores.user || !stores.list || !stores.system) return;

    try {
      stores.user.isSupporter = function() { return true; };
    } catch (e) {}

    // Auto-select the game system of the user's active lists ONLY when not opening a specific list URL
    // and ONLY if no system is selected or if the currently selected system has 0 matching lists while another system has lists
    if (!requestedListKeyFromUrl && !stores.system.__omniDefaultSysChecked && stores.list.listsInitiated) {
      var sysArr = (stores.system.library && Array.isArray(stores.system.library.array) && stores.system.library.array.length)
        ? stores.system.library.array
        : (Array.isArray(stores.system.installedSystems) ? stores.system.installedSystems : []);
      if (sysArr.length > 0) {
        stores.system.__omniDefaultSysChecked = true;
        try {
          var activeRows = Array.isArray(stores.list.listData)
            ? stores.list.listData.filter(function(r) { return isActiveNrListRow(r, stores); })
            : [];
          var curSel = stores.system.selectedSystem;
          var curSelHasLists = Boolean(curSel && activeRows.some(function(r) {
            return r.id_system == curSel.id || (curSel.bsid != null && (r.id_system == curSel.bsid || r.bsid_system == curSel.bsid));
          }));
          if (!curSel || (activeRows.length > 0 && !curSelHasLists)) {
            // Prefer 11th Edition (827374861) if the user has lists in 11th Edition, else most recent list's system
            var row11e = activeRows.find(function(r) { return r.id_system == 827374861 || r.bsid_system === 'sys-352e-adc2-7639-d610'; });
            var preferredSysId = row11e ? row11e.id_system : (activeRows.length > 0 ? activeRows[0].id_system : null);
            var targetSys = (preferredSysId && sysArr.find(function(s) { return s && s.id == preferredSysId; })) ||
              sysArr.find(function(s) { return s && s.id == 827374861; }) ||
              sysArr.find(function(s) { return s && s.id == 2821148162; }) ||
              sysArr.find(function(s) { return s && String(s.name || '').indexOf('Warhammer 40,000') !== -1; });
            if (targetSys && (!curSel || curSel.id !== targetSys.id)) {
              await stores.system.selectSystem(targetSys.id);
            }
          }
        } catch (e) {}
      }
    }

    // Rename top-right "Menu" button to "Login" (when logged out) or the user's username (when logged in)
    try {
      var curLogin = (stores.user && stores.user.user && stores.user.user.login) ? String(stores.user.user.login) : '';
      var loginBtnSpan = document.querySelector('.menu.mainMenu a[href="/app/Login"] .textBelowImg');
      if (loginBtnSpan) {
        var targetLabel = curLogin ? curLogin : 'Login';
        if (loginBtnSpan.textContent !== targetLabel) {
          loginBtnSpan.textContent = targetLabel;
        }
      }
      if (stores.user.__omniLastLoginNotified !== curLogin && stores.list.listsInitiated) {
        stores.user.__omniLastLoginNotified = curLogin;
        notifyParent({
          action: 'auth_status',
          logged_in: Boolean(curLogin),
          login: curLogin
        });
      }
    } catch (e) {}

    if (!readyNotified && stores.list.listsInitiated && !requestedListKeyFromUrl) {
      readyNotified = true;
      notifyParent({ action: 'ready' });
    }

    if (!stores.list.__omniPatchedFind) {
      stores.list.__omniPatchedFind = true;
      var origFind = stores.list.findListByKey.bind(stores.list);
      stores.list.findListByKey = function(listKey, sysFilter) {
        var found = origFind(listKey, sysFilter);
        if (!found && listKey && Array.isArray(this.listData)) {
          found = this.listData.find(function(n) { return n && n.list_key === listKey; }) || null;
        }
        if (!found && listKey && listKey === requestedListKeyFromUrl && requestedListNameFromUrl && Array.isArray(this.listData)) {
          var wantName = String(requestedListNameFromUrl).trim().toLowerCase();
          found = this.listData.find(function(n) {
            return n && !n._ephemeral_view && String(n.name || '').trim().toLowerCase() === wantName;
          }) || null;
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

      // Hook system switching so changing game system in Studio updates My Hub to match
      if (stores.system && typeof stores.system.selectSystem === 'function' && !stores.system.__omniPatchedSelectSys) {
        stores.system.__omniPatchedSelectSys = true;
        var origSelectSystem = stores.system.selectSystem.bind(stores.system);
        stores.system.selectSystem = async function(sysId, forceReload) {
          var res = await origSelectSystem(sysId, forceReload);
          if (!isEmbeddedViewer && !requestedListKeyFromUrl && initialHydrationDone) {
            setTimeout(function() { forceFullSync(); }, 180);
          }
          return res;
        };
      }

      // Hook addList, doSaveList, removeList, and syncAllLists directly on Pinia listsStore
      if (typeof stores.list.doSaveList === 'function') {
        var origDoSaveList = stores.list.doSaveList.bind(stores.list);
        stores.list.doSaveList = async function(listObj, localOnly) {
          var res = await origDoSaveList(listObj, localOnly);
          try {
            if (listObj && listObj.row) {
              setTimeout(function() {
                syncUpsertRow(listObj.row, listObj.army, listObj.book);
              }, 20);
            }
          } catch (e) {}
          return res;
        };
      }

      if (typeof stores.list.addList === 'function') {
        var origAddList = stores.list.addList.bind(stores.list);
        stores.list.addList = async function(listObj, selectIt) {
          var res = await origAddList(listObj, selectIt);
          try {
            if (listObj && listObj.row) {
              setTimeout(function() {
                syncUpsertRow(listObj.row, listObj.army, listObj.book);
              }, 20);
            }
          } catch (e) {}
          return res;
        };
      }

      if (typeof stores.list.removeList === 'function') {
        var origRemoveList = stores.list.removeList.bind(stores.list);
        stores.list.removeList = async function(rowObj) {
          var keyToDelete = rowObj && (rowObj.list_key || rowObj._id);
          var res = await origRemoveList(rowObj);
          try {
            if (keyToDelete) {
              setTimeout(function() {
                syncDeleteKey(String(keyToDelete));
              }, 20);
            }
          } catch (e) {}
          return res;
        };
      }

      if (typeof stores.list.selectList === 'function') {
        var origSelectList = stores.list.selectList.bind(stores.list);
        stores.list.selectList = async function(rowObj) {
          if (rowObj && rowObj._synthetic_text && !rowObj._compiled_by_nr) {
            await compileSyntheticRowIfNeeded(rowObj, stores.system, stores.list, false);
          }
          var res = await origSelectList(rowObj);
          if (!res && rowObj) {
            if (rowObj.booksDate) {
              delete rowObj.booksDate;
              res = await origSelectList(rowObj);
            }
            if (!res && rowObj._synthetic_text) {
              rowObj._compiled_by_nr = false;
              await compileSyntheticRowIfNeeded(rowObj, stores.system, stores.list, true);
              res = await origSelectList(rowObj);
            }
          }
          if (res && res.row && requestedListKeyFromUrl) {
            var wantPlayNow = Boolean(wantPlayModeFromUrl || (window.location.search || '').indexOf('view=play') !== -1);
            res.row.metadata = Object.assign({}, res.row.metadata || {}, { play_mode: wantPlayNow });
          }
          return res;
        };
      }

      if (typeof stores.list.syncAllLists === 'function') {
        var origSyncAll = stores.list.syncAllLists.bind(stores.list);
        stores.list.syncAllLists = async function() {
          var res = await origSyncAll.apply(this, arguments);
          setTimeout(function() {
            pollListsDiff();
            if (!isEmbeddedViewer) {
              forceFullSync();
            }
            try {
              if ((window.location.pathname || '').indexOf('/Login') !== -1 && stores.user && stores.user.user) {
                var rtr = stores.list.$router || (window.$nuxt && window.$nuxt.$router);
                if (rtr) rtr.push('/app/MyLists');
              }
            } catch (e) {}
          }, 180);
          return res;
        };
      }
    }

    if (!initialHydrationDone || activatingPlayMode) return;

    var curPath = window.location.pathname || '';
    var curSearch = window.location.search || '';
    var mPathKey = curPath.match(/\/Lists\/([^\/\?\#]+)/i);
    var targetKey = requestedListKeyFromUrl || ((mPathKey && mPathKey[1]) ? decodeURIComponent(mPathKey[1]) : null);
    var wantPlay = Boolean(wantPlayModeFromUrl || curSearch.indexOf('view=play') !== -1 || curSearch.indexOf('play=1') !== -1);
    var modeToken = targetKey ? (targetKey + ':' + (wantPlay ? 'play' : 'edit')) : null;

    if (!targetKey) {
      hideDirectListLoader();
      return;
    }
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
      setTimeout(function() {
        hideDirectListLoader();
        readyNotified = true;
        notifyParent({ action: 'ready' });
      }, 80);
      return;
    }

    activatingPlayMode = true;
    try {
      var listArr = Array.isArray(stores.list.listData) ? stores.list.listData : [];
      var targetRow = listArr.find(function(r) { return r && r.list_key === targetKey; }) || null;

      // Fallback: match by list name (e.g. if the list was migrated to 11th Edition with a new list_key)
      var searchName = (
        requestedListNameFromUrl ||
        (targetRow && targetRow.name) ||
        (pendingNrRowFromParent && pendingNrRowFromParent.name) ||
        ''
      ).trim().toLowerCase();

      if (searchName && listArr.length > 0) {
        var nameMatches = listArr.filter(function(r) {
          return r && !r._ephemeral_view && String(r.name || '').trim().toLowerCase() === searchName;
        });
        if (nameMatches.length > 0) {
          nameMatches.sort(function(a, b) {
            var aReal = a._synthetic_text ? 0 : 1;
            var bReal = b._synthetic_text ? 0 : 1;
            if (aReal !== bReal) return bReal - aReal;
            var a11e = (a.id_system == 827374861) ? 1 : 0;
            var b11e = (b.id_system == 827374861) ? 1 : 0;
            if (a11e !== b11e) return b11e - a11e;
            return String(b.date_mod || '').localeCompare(String(a.date_mod || ''));
          });
          if (!targetRow || (targetRow._synthetic_text && !nameMatches[0]._synthetic_text)) {
            targetRow = nameMatches[0];
            targetKey = targetRow.list_key;
            requestedListKeyFromUrl = targetKey;
            modeToken = targetKey + ':' + (wantPlay ? 'play' : 'edit');
          }
        }
      }

      if (!targetRow && pendingNrRowFromParent && (pendingNrRowFromParent.list_key === targetKey || !pendingNrRowFromParent.list_key || listArr.length === 0)) {
        var rowToSeed = Object.assign({}, pendingNrRowFromParent);
        if (!rowToSeed.list_key) rowToSeed.list_key = targetKey;
        rowToSeed.metadata = Object.assign({}, rowToSeed.metadata || {}, { play_mode: Boolean(wantPlay) });
        await upsertSingleRowToIdb(rowToSeed);
        targetRow = Array.isArray(stores.list.listData)
          ? stores.list.listData.find(function(r) { return r && r.list_key === rowToSeed.list_key; })
          : null;
        if (targetRow) {
          targetKey = targetRow.list_key;
          requestedListKeyFromUrl = targetKey;
          modeToken = targetKey + ':' + (wantPlay ? 'play' : 'edit');
        }
      }

      if (!targetRow) {
        directListLookupRetries++;
        if (directListLookupRetries < 25) {
          return;
        }
        hideDirectListLoader();
        readyNotified = true;
        notifyParent({ action: 'ready' });
        return;
      }

      stores.system.__omniDefaultSysChecked = true;
      if (stores.options && typeof stores.options.addInstalledSystemVue === 'function' && targetRow.id_system) {
        stores.options.addInstalledSystemVue(targetRow.id_system);
      }
      if (!stores.system.selectedSystem || stores.system.selectedSystem.id != targetRow.id_system) {
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
      var postNavStores = getNrStores();
      if (postNavStores && postNavStores.listsPage && loadedListObj) {
        postNavStores.listsPage.editedList = loadedListObj;
      }
      playModeActivatedForKey = modeToken;
      setTimeout(function() {
        hideDirectListLoader();
        readyNotified = true;
        notifyParent({ action: 'ready' });
      }, 90);
    } catch (err) {
      console.warn('[OmniTactica Bridge] Play Mode activation notice:', err);
      hideDirectListLoader();
    } finally {
      activatingPlayMode = false;
    }
  }

  // 5. Snapshot diff watcher to catch any edits, imports, or deletions across Pinia listData & IndexedDB
  async function pollListsDiff() {
    await ensurePlayModeAndStoreHooks();
    if (!initialHydrationDone || isHydrating || isEmbeddedViewer) return;
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
    if (isEmbeddedViewer) return null;
    if (!initialHydrationDone) {
      await hydrateFromOmniTactica();
    }
    var st = getNrStores();
    try {
      if (st && st.list && typeof st.list.whenSynced === 'function') {
        await Promise.race([
          st.list.whenSynced(),
          new Promise(function(r) { setTimeout(r, 2500); })
        ]);
      }
    } catch (e) {}
    var rows = await readAllNrLists();
    if (!rows) return null;
    var cleaned = rows.filter(function(r) { return r && !r._ephemeral_view; }).map(function(r) { return cloneCleanRow(r); }).filter(Boolean);
    if (cleaned.length === 0) {
      return null;
    }
    knownListsMap = {};
    cleaned.forEach(function(r) {
      knownListsMap[r.list_key] = computeSignature(r);
    });
    return await postSyncAction('bulk_sync', {
      lists: cleaned,
      reconcile_deletions: true
    });
  }

  window.__omnitacticaNrBridge = {
    forceFullSync: forceFullSync,
    pollListsDiff: pollListsDiff,
    hydrateFromOmniTactica: hydrateFromOmniTactica,
    ensurePlayModeAndStoreHooks: ensurePlayModeAndStoreHooks,
    getNrStores: getNrStores,
    readAllNrLists: readAllNrLists
  };

  window.addEventListener('message', async function(ev) {
    var msg = ev && ev.data;
    if (!msg || msg.type !== 'OMNITACTICA_NR_COMMAND') return;
    if (msg.command === 'force_sync') {
      await forceFullSync();
    } else if (msg.command === 'delete_list' && msg.list_key) {
      var delKey = String(msg.list_key);
      delete knownListsMap[delKey];
      if (pendingNrRowFromParent && pendingNrRowFromParent.list_key === delKey) {
        pendingNrRowFromParent = null;
      }
      var stDel = getNrStores();
      if (stDel && stDel.list && Array.isArray(stDel.list.listData)) {
        var dIdx = stDel.list.listData.findIndex(function(x) { return x && x.list_key === delKey; });
        if (dIdx !== -1) {
          stDel.list.listData.splice(dIdx, 1);
          try { if (typeof stDel.list.rebuildTreeData === 'function') stDel.list.rebuildTreeData(); } catch (e) {}
        }
      }
      var db = await openExistingNrDb();
      if (db) {
        var prevH = isHydrating;
        isHydrating = true;
        await new Promise(function(resolve) {
          try {
            var tx = db.transaction('lists', 'readwrite');
            var store = tx.objectStore('lists');
            try { store.delete(delKey); } catch (e) {}
            tx.oncomplete = function() { isHydrating = prevH; resolve(); };
            tx.onerror = function() { isHydrating = prevH; resolve(); };
          } catch (e) { isHydrating = prevH; resolve(); }
        });
      }
    } else if (msg.command === 'open_play_mode' && msg.list_key) {
      requestedListKeyFromUrl = String(msg.list_key);
      if (msg.list_name) {
        requestedListNameFromUrl = String(msg.list_name).trim();
      } else if (msg.nr_row && msg.nr_row.name) {
        requestedListNameFromUrl = String(msg.nr_row.name).trim();
      }
      wantPlayModeFromUrl = msg.play !== false;
      playModeActivatedForKey = null;
      directListLookupRetries = 0;
      showDirectListLoader(wantPlayModeFromUrl ? 'Loading Play Mode Datasheets...' : 'Opening Army Roster...');
      if (msg.nr_row && msg.nr_row.list_key) {
        pendingNrRowFromParent = Object.assign({}, msg.nr_row);
        var existingRows = await readAllNrLists();
        var existingMap = {};
        var existingByName = {};
        (existingRows || []).forEach(function(er) {
          if (er && er.list_key) {
            existingMap[er.list_key] = er;
            if (er.name) existingByName[String(er.name).trim().toLowerCase()] = er;
          }
        });
        var cur = existingMap[msg.nr_row.list_key] || (requestedListNameFromUrl ? existingByName[requestedListNameFromUrl.toLowerCase()] : null);
        if (!cur || (!cur._compiled_by_nr && msg.nr_row._synthetic_text && cur._synthetic_text)) {
          var rowToWrite = Object.assign({}, msg.nr_row);
          rowToWrite.metadata = Object.assign({}, rowToWrite.metadata || {}, { play_mode: Boolean(wantPlayModeFromUrl) });
          await upsertSingleRowToIdb(rowToWrite);
        }
      }
      await ensurePlayModeAndStoreHooks();
    } else if (msg.command === 'navigate' && msg.path) {
      try {
        var cleanTarget = String(msg.path).replace(/^\/nr\/app/, '/app');
        var mNavName = cleanTarget.match(/[?&]name=([^&#]+)/i);
        if (mNavName && mNavName[1]) {
          try { requestedListNameFromUrl = decodeURIComponent(mNavName[1]).trim(); } catch (e) {}
        } else if (msg.list_name) {
          requestedListNameFromUrl = String(msg.list_name).trim();
        } else {
          requestedListNameFromUrl = '';
        }
        if (msg.nr_row && msg.nr_row.list_key) {
          pendingNrRowFromParent = Object.assign({}, msg.nr_row);
        }
        var mNavList = cleanTarget.match(/\/Lists\/([^\/\?\#]+)/i);
        if (mNavList && mNavList[1]) {
          requestedListKeyFromUrl = decodeURIComponent(mNavList[1]);
          wantPlayModeFromUrl = cleanTarget.indexOf('view=play') !== -1;
          playModeActivatedForKey = null;
          directListLookupRetries = 0;
          showDirectListLoader(wantPlayModeFromUrl ? 'Loading Play Mode Datasheets...' : 'Opening Army Roster...');
          await ensurePlayModeAndStoreHooks();
          return;
        }
        if (/^\/app\/Lists(?:\?.*)?$/i.test(cleanTarget)) {
          cleanTarget = '/app/MyLists';
        }
        requestedListKeyFromUrl = null;
        hideDirectListLoader();
        var storesNav = getNrStores();
        var rtrNav = storesNav && storesNav.list && (storesNav.list.$router || (window.$nuxt && window.$nuxt.$router));
        if (rtrNav) {
          await rtrNav.push(cleanTarget);
        } else {
          window.location.href = '/nr' + cleanTarget;
        }
      } catch (e) {}
    }
  });

  // Fast 40ms early hook to unlock Supporter mode and store hooks as soon as Pinia initializes
  var earlyHookCount = 0;
  var earlyHookTimer = setInterval(function() {
    earlyHookCount++;
    var s = getNrStores();
    if (s && s.user) {
      try { s.user.isSupporter = function() { return true; }; } catch (e) {}
      if (s.list && s.list.listsInitiated) {
        ensurePlayModeAndStoreHooks();
        clearInterval(earlyHookTimer);
      }
    }
    if (earlyHookCount > 250) {
      clearInterval(earlyHookTimer);
    }
  }, 40);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(hydrateFromOmniTactica, 80);
    });
  } else {
    setTimeout(hydrateFromOmniTactica, 80);
  }

  setInterval(pollListsDiff, 900);
})();
</script>
"""


def inject_nr_bridge_into_html(html: str) -> str:
    """Injects the OmniTactica <-> NewRecruit IndexedDB live sync & Play Mode bridge script at the top of <head> and strips 3rd-party tracker tags."""
    if "omnitactica-nr-bridge" in html:
        return html
    # Strip Google Tag Manager script tags from the shell HTML so the browser never requests them
    html = re.sub(r"<script[^>]+googletagmanager[^>]*></script>", "", html, flags=re.IGNORECASE)
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

    try:
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
    except Exception as e:
        logger.warning("Notice fetching upstream NewRecruit HTML shell: %s", e)
        if _NR_HTML_SHELL_CACHE:
            return _NR_HTML_SHELL_CACHE[1]
        return inject_nr_bridge_into_html("<!DOCTYPE html><html><head><meta charset='utf-8'><title>NewRecruit Studio</title></head><body><div id='__nuxt'></div></body></html>")


def proxy_nr_request(
    path_with_query: str,
    method: str = "GET",
    body: Optional[bytes] = None,
    req_headers: Optional[Dict[str, str]] = None,
) -> Tuple[int, bytes, str]:
    """
    Proxies static assets (/_nuxt/*, /settings/*, /assets/*) and API calls (/api/rpc, /api/book/*, /api/token)
    to https://www.newrecruit.eu with in-memory caching for static assets and read-only library RPCs.
    Returns (status_code, content_bytes, content_type).
    """
    clean_path = path_with_query if path_with_query.startswith("/") else f"/{path_with_query}"
    method_up = method.upper()

    # Short-circuit client error telemetry RPCs so they never hit upstream
    if method_up == "POST" and ("report_client_error" in clean_path or "error_snapshot_save" in clean_path):
        return 200, b"{}", "application/json"

    is_cacheable_get = (
        method_up == "GET"
        and (
            clean_path.startswith("/_nuxt/")
            or clean_path.startswith("/settings/")
            or clean_path.startswith("/assets/")
            or clean_path.startswith("/icons/")
            or clean_path.startswith("/api/book/")
            or clean_path in ("/assets.json", "/favicon.ico", "/favicon-32x32.png")
        )
    )
    has_auth = bool(req_headers and (req_headers.get("Authorization") or req_headers.get("authorization")))
    body_str = body.decode("utf-8", errors="ignore") if (body and method_up == "POST" and len(body) < 512) else ""
    is_cacheable_rpc = (
        method_up == "POST"
        and not has_auth
        and clean_path.startswith("/api/rpc")
        and any(m_name in body_str for m_name in ('"get_library"', '"get_countries"', '"get_timezones"', '"get_games"'))
    )

    cache_key = f"POST:{clean_path}:{body_str}" if is_cacheable_rpc else clean_path
    now = time.time()
    if (is_cacheable_get or is_cacheable_rpc) and cache_key in _NR_STATIC_CACHE:
        ts, cached_bytes, cached_ct = _NR_STATIC_CACHE[cache_key]
        ttl = 3600 if is_cacheable_rpc else _NR_CACHE_TTL_SECONDS
        if now - ts < ttl:
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

    try:
        if _NR_HTTP_POOL is not None:
            resp = _NR_HTTP_POOL.request(
                method_up,
                target_url,
                body=body if method_up != "GET" else None,
                headers=headers,
                timeout=15.0,
            )
            status = int(resp.status)
            data = bytes(resp.data or b"")
            content_type = resp.headers.get("Content-Type", "application/octet-stream")
        else:
            req = urllib.request.Request(target_url, data=body if method_up != "GET" else None, headers=headers, method=method_up)
            with urllib.request.urlopen(req, timeout=15.0) as uresp:
                status = uresp.status
                data = uresp.read()
                content_type = uresp.headers.get("Content-Type", "application/octet-stream")

        if (is_cacheable_get or is_cacheable_rpc) and status == 200:
            _NR_STATIC_CACHE[cache_key] = (now, data, content_type)
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
        if row.get("totalCost") is None:
            row["totalCost"] = int(roster.get("points") or 0)
        if roster.get("_ephemeral_view"):
            row["_ephemeral_view"] = True
        if not row.get("_synthetic_text"):
            row["_synthetic_text"] = build_roster_text_for_nr_compiler(roster, book_name)
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
        list_key = re.sub(r"[^a-zA-Z0-9_\-]", "", raw_id)[:64]
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
    sys_id = int(roster.get("id_system") or NR_40K_SYSTEM_ID)
    sys_bsid = (
        "sys-352e-adc2-7639-d610"
        if sys_id == 827374861
        else str(roster.get("bsid_system") or NR_40K_SYSTEM_BSID)
    )
    out_row = {
        "list_key": list_key,
        "name": str(roster.get("name") or f"{faction} - {det_name}"),
        "id_system": sys_id,
        "id_book": id_book,
        "bsid_system": sys_bsid,
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

        if body.get("reconcile_deletions", True):
            existing = list_fn()
            for item in existing:
                if not isinstance(item, dict):
                    continue
                item_id = str(item.get("id") or "")
                item_lkey = str(item.get("list_key") or (item_id[3:] if item_id.startswith("nr_") else item_id))
                if item_lkey not in incoming_keys and item_id not in incoming_keys:
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
