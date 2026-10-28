"""
Lightweight Melee.gg client (`scripts/melee_client.py`) used by `scripts/sync_melee.py` and
`import_live_melee_tournaments` in `scripts/sync_multiplatform.py`.

Melee.gg's DataTables JSON endpoints answer plain HTTPS requests as long as they are sent the way the
site's own jQuery code sends them (form-encoded `variables[...]` DataTables params, `X-Requested-With`).
The old headless-Chrome discovery posted malformed params (capitalised column names, nested JSON) which
the server rejected with HTTP 500, so discovery silently returned nothing.

Key facts (verified against melee.gg):
  * `POST /Tournament/TournamentSearch` (mode=Table) pages with `variables[start]`/`variables[length]`;
    `length` is capped at 500 and `start` is floored to a multiple of `length` (page index).
    Ordering by the `id` column is deterministic, which makes an id-cursor resumable across runs.
  * Game tags (`MagicTheGathering`, ...) are missing on pre-2024 tournaments, so backfill walks the
    untagged `Ended` filter and classifies rows by `gameDescription`.
  * `POST /Standing/GetRoundStandings` and `/Match/GetRoundMatches/{roundId}` also cap `length` at 500.
  * `GET /Tournament/View/{id}` exposes start date, game and round ids.

If melee.gg ever starts serving Cloudflare challenges to plain HTTP, set `MELEE_TRANSPORT=chrome`
(or it switches automatically on a 403 challenge) to tunnel the same requests through `fetch()` inside a
single long-lived headless Chrome page.
"""

import html as html_lib
import json
import logging
import os
import queue
import re
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Sequence, Tuple

logger = logging.getLogger("elo.melee_client")

MELEE_BASE = "https://melee.gg"
MELEE_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/128.0.0.0 Safari/537.36"
)
MELEE_PAGE_SIZE = 500  # Server-side cap for every DataTables endpoint.

# `/Tournament/TournamentSearch` table columns, in the order the site's own DataTable declares them
# plus `id` (sortable server side) so we can order deterministically by tournament id.
_SEARCH_COLUMNS = [
    "startDate", "name", "game", "organizationName", "status", "registrationType",
    "entryFeeString", "enrolledPlayerCount", "tags", "id",
]
_SEARCH_COL_INDEX = {c: i for i, c in enumerate(_SEARCH_COLUMNS)}


class MeleeBlockedError(RuntimeError):
    """Raised when melee.gg answers with a Cloudflare challenge instead of data."""


# =============================================================================
# Transports
# =============================================================================


class _HttpTransport:
    name = "http"

    def __init__(self, timeout: float = 20.0, retries: int = 3):
        self.timeout = timeout
        self.retries = retries

    def request(self, method: str, path: str, form: Optional[Sequence[Tuple[str, Any]]] = None) -> Tuple[int, str]:
        url = path if path.startswith("http") else MELEE_BASE + path
        data = urllib.parse.urlencode([(k, "" if v is None else str(v)) for k, v in form]).encode() if form is not None else None
        headers = {
            "User-Agent": MELEE_UA,
            "Accept": "application/json, text/javascript, text/html, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": MELEE_BASE + "/Tournament/Index",
        }
        if data is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8"
        last_err: Optional[Exception] = None
        for attempt in range(self.retries):
            try:
                req = urllib.request.Request(url, data=data, headers=headers, method=method)
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return resp.status, resp.read().decode("utf-8", "replace")
            except urllib.error.HTTPError as e:
                body = ""
                try:
                    body = e.read().decode("utf-8", "replace")
                except Exception:
                    pass
                if e.code in (403, 503) and ("Just a moment" in body or "cf-chl" in body or "challenge-platform" in body):
                    raise MeleeBlockedError(f"Cloudflare challenge on {path}")
                if e.code in (429, 502, 503, 504) and attempt + 1 < self.retries:
                    time.sleep(2.0 * (attempt + 1))
                    last_err = e
                    continue
                return e.code, body
            except Exception as e:  # URLError, timeouts, connection resets
                last_err = e
                time.sleep(1.5 * (attempt + 1))
        raise RuntimeError(f"melee.gg request failed for {path}: {last_err}")

    def close(self) -> None:
        pass


_CHROME_BRIDGE_JS = r"""
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const readline = require("readline");
const chromeBin = process.argv[1] || "google-chrome";
const port = 19800 + Math.floor(Math.random() * 400);
const profileDir = `/tmp/chrome_melee_${port}_${process.pid}`;
const chrome = spawn(chromeBin, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  "--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled",
  `--user-data-dir=${profileDir}`, `--user-agent=${process.argv[2]}`,
  `--remote-debugging-port=${port}`, "https://melee.gg/Tournament/Index"
], { stdio: "ignore" });
const cleanup = () => {
  try { chrome.kill("SIGKILL"); } catch (e) {}
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
};
process.on("exit", cleanup);
const getJson = (url) => new Promise((resolve, reject) => {
  const req = http.get(url, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); });
  req.on("error", reject); req.setTimeout(1500, () => { req.destroy(); reject(new Error("timeout")); });
});
(async () => {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { const ts = await getJson(`http://127.0.0.1:${port}/json`); target = ts.find(t => t.type === "page" && String(t.url).includes("melee.gg") && t.webSocketDebuggerUrl); } catch (e) {}
  }
  if (!target) { process.stdout.write(JSON.stringify({ ready: false }) + "\n"); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  let msgId = 1; const pending = new Map();
  ws.addEventListener("message", ev => { const d = JSON.parse(ev.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
  const send = (method, params) => new Promise(resolve => { const id = msgId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  for (let i = 0; i < 60; i++) {
    const r = await send("Runtime.evaluate", { expression: "Boolean(window.jQuery)", returnByValue: true });
    if (r.result && r.result.result && r.result.result.value === true) break;
    await new Promise(r => setTimeout(r, 500));
  }
  process.stdout.write(JSON.stringify({ ready: true }) + "\n");
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async line => {
    let req; try { req = JSON.parse(line); } catch (e) { return; }
    const expr = `(async () => { try {
        const r = await fetch(${JSON.stringify(req.path)}, { method: ${JSON.stringify(req.method)}, credentials: "include",
          headers: { "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
          body: ${req.body === null ? "undefined" : JSON.stringify(req.body)} });
        return JSON.stringify({ s: r.status, t: await r.text() });
      } catch (e) { return JSON.stringify({ s: 0, t: String(e) }); } })()`;
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    let out = { s: 0, t: "" };
    try { out = JSON.parse(r.result.result.value); } catch (e) {}
    process.stdout.write(JSON.stringify({ id: req.id, s: out.s, t: out.t }) + "\n");
  });
  rl.on("close", () => { cleanup(); process.exit(0); });
})().catch(() => { cleanup(); process.exit(1); });
"""


class _ChromeTransport:
    """Tunnels requests through `fetch()` inside one long-lived headless Chrome page (Cloudflare fallback)."""

    name = "chrome"

    def __init__(self, timeout: float = 90.0):
        chrome_bin = shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chromium-browser")
        if not (chrome_bin and shutil.which("node")):
            raise RuntimeError("Chrome transport requires google-chrome/chromium and node")
        self.timeout = timeout
        self._proc = subprocess.Popen(
            ["node", "-e", _CHROME_BRIDGE_JS, chrome_bin, MELEE_UA],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1,
        )
        self._lock = threading.Lock()
        self._next_id = 1
        self._waiters: Dict[int, "queue.Queue[Dict[str, Any]]"] = {}
        ready_line = self._proc.stdout.readline() if self._proc.stdout else ""
        if not ready_line or not json.loads(ready_line or "{}").get("ready"):
            self.close()
            raise RuntimeError("Chrome transport failed to start")
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

    def _read_loop(self) -> None:
        assert self._proc.stdout is not None
        for line in self._proc.stdout:
            try:
                msg = json.loads(line)
            except Exception:
                continue
            q = self._waiters.pop(int(msg.get("id") or 0), None)
            if q is not None:
                q.put(msg)

    def request(self, method: str, path: str, form: Optional[Sequence[Tuple[str, Any]]] = None) -> Tuple[int, str]:
        body = urllib.parse.urlencode([(k, "" if v is None else str(v)) for k, v in form]) if form is not None else None
        q: "queue.Queue[Dict[str, Any]]" = queue.Queue(maxsize=1)
        with self._lock:
            rid = self._next_id
            self._next_id += 1
            self._waiters[rid] = q
            assert self._proc.stdin is not None
            self._proc.stdin.write(json.dumps({"id": rid, "method": method, "path": path, "body": body}) + "\n")
            self._proc.stdin.flush()
        try:
            msg = q.get(timeout=self.timeout)
        except queue.Empty:
            self._waiters.pop(rid, None)
            raise RuntimeError(f"Chrome transport timeout for {path}")
        return int(msg.get("s") or 0), str(msg.get("t") or "")

    def close(self) -> None:
        try:
            if self._proc.stdin:
                self._proc.stdin.close()
        except Exception:
            pass
        try:
            self._proc.wait(timeout=5)
        except Exception:
            try:
                self._proc.kill()
            except Exception:
                pass


class MeleeClient:
    """Thread-safe Melee.gg JSON/HTML client with automatic Cloudflare fallback to a Chrome tunnel."""

    def __init__(self, transport: Optional[str] = None):
        self._mode = (transport or os.getenv("MELEE_TRANSPORT", "http")).strip().lower()
        self._transport: Any = None
        self._switch_lock = threading.Lock()
        self.request_count = 0
        self._init_transport()

    def _init_transport(self) -> None:
        if self._mode == "chrome":
            self._transport = _ChromeTransport()
        else:
            self._transport = _HttpTransport()

    @property
    def transport_name(self) -> str:
        return getattr(self._transport, "name", "?")

    def _request(self, method: str, path: str, form: Optional[Sequence[Tuple[str, Any]]] = None) -> Tuple[int, str]:
        self.request_count += 1
        try:
            return self._transport.request(method, path, form)
        except MeleeBlockedError:
            with self._switch_lock:
                if self._transport.name == "http":
                    logger.warning("[Melee.gg] Cloudflare challenge on plain HTTP; switching to headless Chrome transport.")
                    self._mode = "chrome"
                    self._transport = _ChromeTransport()
            return self._transport.request(method, path, form)

    def get_text(self, path: str) -> str:
        status, body = self._request("GET", path)
        if status != 200:
            raise RuntimeError(f"GET {path} -> HTTP {status}")
        return body

    def post_json(self, path: str, form: Sequence[Tuple[str, Any]]) -> Any:
        status, body = self._request("POST", path, form)
        if status != 200:
            raise RuntimeError(f"POST {path} -> HTTP {status}")
        return json.loads(body)

    def get_json(self, path: str) -> Any:
        return json.loads(self.get_text(path))

    def close(self) -> None:
        try:
            self._transport.close()
        except Exception:
            pass

    # -------------------------------------------------------------------------
    # Tournament search (discovery)
    # -------------------------------------------------------------------------

    def search_tournaments(
        self,
        filters: Sequence[str],
        page: int,
        order_by: str = "id",
        order_dir: str = "asc",
        length: int = MELEE_PAGE_SIZE,
    ) -> Dict[str, Any]:
        """Returns one DataTables page `{recordsFiltered, data:[{id, name, gameDescription, startDate, enrolledPlayerCount, status}]}`."""
        length = max(1, min(int(length), MELEE_PAGE_SIZE))
        form: List[Tuple[str, Any]] = [("ordering", "StartDate"), ("mode", "Table")]
        form += [("filters[]", f) for f in filters]
        form.append(("variables[draw]", 1))
        for i, col in enumerate(_SEARCH_COLUMNS):
            form += [
                (f"variables[columns][{i}][data]", col),
                (f"variables[columns][{i}][name]", col),
                (f"variables[columns][{i}][searchable]", "true"),
                (f"variables[columns][{i}][orderable]", "true"),
                (f"variables[columns][{i}][search][value]", ""),
                (f"variables[columns][{i}][search][regex]", "false"),
            ]
        form += [
            ("variables[order][0][column]", _SEARCH_COL_INDEX.get(order_by, _SEARCH_COL_INDEX["id"])),
            ("variables[order][0][dir]", order_dir),
        ]
        if order_by != "id":  # Deterministic tie-break so pages never overlap/skip on identical start dates.
            form += [("variables[order][1][column]", _SEARCH_COL_INDEX["id"]), ("variables[order][1][dir]", order_dir)]
        form += [
            ("variables[start]", int(page) * length),
            ("variables[length]", length),
            ("variables[search][value]", ""),
            ("variables[search][regex]", "false"),
        ]
        res = self.post_json("/Tournament/TournamentSearch", form)
        rows = []
        for r in (res.get("data") or []) if isinstance(res, dict) else []:
            rows.append(
                {
                    "id": r.get("id"),
                    "name": r.get("name"),
                    "gameDescription": r.get("gameDescription"),
                    "startDate": r.get("startDate"),
                    "enrolledPlayerCount": r.get("enrolledPlayerCount") or 0,
                    "status": r.get("status"),
                    "organizationId": r.get("organizationId"),
                    "organizationName": r.get("organizationName"),
                    "formatString": r.get("formatString"),
                    "entryFeeString": r.get("entryFeeString"),
                    "registrationType": r.get("registrationType"),
                    "tags": r.get("tags") or [],
                }
            )
        return {"recordsFiltered": int((res or {}).get("recordsFiltered") or 0), "data": rows}

    # -------------------------------------------------------------------------
    # Tournament detail scraping
    # -------------------------------------------------------------------------

    def _datatable_all(self, path: str, base_form: List[Tuple[str, Any]], max_rows: int = 20000) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        page = 0
        while True:
            form = list(base_form) + [("draw", 1), ("start", page * MELEE_PAGE_SIZE), ("length", MELEE_PAGE_SIZE)]
            res = self.post_json(path, form) or {}
            data = res.get("data") or []
            total = int(res.get("recordsFiltered") or res.get("recordsTotal") or 0)
            rows.extend(data)
            page += 1
            if len(data) < MELEE_PAGE_SIZE or len(rows) >= total or len(rows) >= max_rows:
                break
        return rows

    def fetch_round_standings(self, round_id: str) -> List[Dict[str, Any]]:
        return self._datatable_all(
            "/Standing/GetRoundStandings",
            [("roundId", round_id), ("columns[0][data]", "Rank"), ("order[0][column]", 0), ("order[0][dir]", "asc")],
        )

    def fetch_round_matches(self, round_id: str) -> List[Dict[str, Any]]:
        rows = self._datatable_all(
            f"/Match/GetRoundMatches/{round_id}",
            [("columns[0][data]", "TableNumber"), ("order[0][column]", 0), ("order[0][dir]", "asc")],
        )
        return [_compact_match(m) for m in rows]

    def fetch_decklist(self, decklist_id: str) -> Optional[Dict[str, Any]]:
        d = self.get_json(f"/Decklist/GetDecklistDetails?id={urllib.parse.quote(str(decklist_id))}")
        if not isinstance(d, dict) or not d.get("Components"):
            return None
        return {
            "DecklistName": d.get("DecklistName"),
            "Format": d.get("FormatName"),
            "Components": [
                {
                    "ComponentDescription": c.get("ComponentDescription"),
                    "CardQuantity": c.get("CardQuantity"),
                    "CardRecords": [{"q": rec.get("q"), "n": rec.get("n")} for rec in (c.get("CardRecords") or [])],
                }
                for c in (d.get("Components") or [])
            ],
        }

    def fetch_tournament(self, tid: str, max_decklists: int = 2) -> Optional[Dict[str, Any]]:
        """Scrapes one tournament into the payload shape consumed by `import_live_melee_tournaments`."""
        page_html = self.get_text(f"/Tournament/View/{tid}")
        meta = parse_tournament_view(page_html, tid)
        standings: List[Dict[str, Any]] = []
        # Final standings live on the last round that has rows (single-elim top-cut rounds may be empty).
        for rd in reversed(meta["standing_rounds"]):
            standings = self.fetch_round_standings(rd["id"])
            if standings:
                break
        is_live_status = str(meta.get("status") or "").strip().lower() in ("in progress", "started", "active", "ongoing")
        if not standings and not (is_live_status and meta.get("pairing_rounds")):
            meta.update({"standings": [], "roundMatches": [], "decklists": {}})
            return meta
        round_matches = []
        for idx, pr in enumerate(meta["pairing_rounds"]):
            try:
                matches = self.fetch_round_matches(pr["id"])
            except Exception as e:
                logger.debug(f"[Melee.gg] Round {pr['id']} of {tid} failed: {e}")
                matches = []
            if matches:
                round_matches.append({"roundNum": idx + 1, "roundId": pr["id"], "roundName": pr["name"], "matches": matches})
        decklists: Dict[str, Any] = {}
        if max_decklists > 0:
            for st in standings[:max_decklists]:
                dks = st.get("Decklists") or []
                chosen = next((d for d in dks if d.get("DecklistName") and d.get("DecklistName") != "Decklist"), dks[0] if dks else None)
                did = (chosen or {}).get("DecklistId")
                if did and did not in decklists:
                    try:
                        dl = self.fetch_decklist(did)
                        if dl:
                            decklists[did] = dl
                    except Exception as e:
                        logger.debug(f"[Melee.gg] Decklist {did} failed: {e}")
        meta.update({"standings": standings, "roundMatches": round_matches, "decklists": decklists})
        return meta


def _compact_match(m: Dict[str, Any]) -> Dict[str, Any]:
    """Keeps only the match fields the importer uses (~10x smaller than Melee's raw payload)."""
    comps = []
    for c in m.get("Competitors") or []:
        players = ((c.get("Team") or {}).get("Players") or [])
        p0 = players[0] if players else {}
        comps.append(
            {
                "Team": {"Players": [{"Username": p0.get("Username"), "ID": p0.get("ID"), "DisplayName": p0.get("DisplayName")}]},
                "GameWins": c.get("GameWins"),
                "GameWinsAndGameByes": c.get("GameWinsAndGameByes"),
                "Decklists": [
                    {"DecklistId": d.get("DecklistId"), "DecklistName": d.get("DecklistName")} for d in (c.get("Decklists") or [])
                ],
            }
        )
    return {
        "Guid": m.get("Guid"),
        "TableNumber": m.get("TableNumber"),
        "ResultString": m.get("ResultString"),
        "ByeReason": m.get("ByeReason"),
        "Competitors": comps,
    }


_ROUND_RE = re.compile(r'data-id="(\d+)"\s+data-name="([^"]*)"')


def _round_selectors(page_html: str, container_id: str) -> List[Dict[str, str]]:
    m = re.search(r'id="%s"(.*?)</div>' % re.escape(container_id), page_html, re.S)
    if not m:
        return []
    return [{"id": rid, "name": html_lib.unescape(name)} for rid, name in _ROUND_RE.findall(m.group(1))]


def _extract_tab_inner_html(page_html: str, tab_id: str) -> str:
    """Extracts sanitized inner HTML from a Bootstrap tab-pane (`#tournament-description-tab`, `#tournament-prizes-tab`)."""
    m = re.search(
        r'<div[^>]*\bid="%s"[^>]*>(.*?)</div>\s*(?=<div[^>]*\bid="tournament-[a-z0-9-]+-tab"|</div>\s*</div>|<div[^>]*\bid="standings-round-selector|</body)'
        % re.escape(tab_id),
        page_html,
        re.S | re.I,
    )
    if not m:
        return ""
    raw = m.group(1)
    raw = re.sub(r"<script\b[^>]*>.*?</script>", "", raw, flags=re.S | re.I)
    raw = re.sub(r"<style\b[^>]*>.*?</style>", "", raw, flags=re.S | re.I)
    return raw.strip()


def parse_tournament_view(page_html: str, tid: str) -> Dict[str, Any]:
    title_m = re.search(r"<title>(.*?)</title>", page_html, re.S)
    title = html_lib.unescape(title_m.group(1)).split("|")[0].strip() if title_m else ""
    if not title:
        # XHR requests get the layout-less partial view (no <title>); use the headline <h3> instead.
        h3_m = re.search(r'id="tournament-headline-start-date-field".*?<h3[^>]*>(.*?)</h3>', page_html, re.S)
        if h3_m:
            title = html_lib.unescape(re.sub(r"<[^>]+>", "", h3_m.group(1))).strip()
    start_m = re.search(r'id="tournament-headline-start-date-field".*?data-value="([^"]+)"', page_html, re.S)
    game_val_m = re.search(r'id="tournament-headline-game"[^>]*\bdata-value="([^"]+)"', page_html, re.S | re.I)
    game_m = re.search(r'id="tournament-headline-game"[^>]*>(.*?)</', page_html, re.S)
    game_name = (
        html_lib.unescape(game_val_m.group(1)).strip()
        if (game_val_m and game_val_m.group(1).strip())
        else (html_lib.unescape(game_m.group(1)).replace("Game:", "").strip() if game_m else None)
    )
    status_m = re.search(r"fa-info-circle[^>]*></i>\s*([^|<]+)", page_html)
    status_str = html_lib.unescape(status_m.group(1)).strip() if status_m else None
    org_m = re.search(r'id="tournament-headline-organization"[^>]*>.*?<a([^>]*)>(.*?)</a>', page_html, re.S)
    if not org_m:
        org_m = re.search(r'<a([^>]*\bid="tournament-headline-organization-name-field"[^>]*)>(.*?)</a>', page_html, re.S)
    org_name = html_lib.unescape(re.sub(r"<[^>]+>", "", org_m.group(2))).strip() if org_m else None
    org_url = None
    if org_m:
        href_m = re.search(r'href="([^"]+)"', org_m.group(1))
        if href_m and href_m.group(1).strip():
            raw_href = href_m.group(1).strip()
            org_url = raw_href if raw_href.startswith("http") else f"{MELEE_BASE}{raw_href}"
    venue_m = re.search(r'Event Venue:\s*<a[^>]*>(.*?)</a>', page_html, re.S)
    venue_name = html_lib.unescape(re.sub(r"<[^>]+>", "", venue_m.group(1))).strip() if venue_m else None
    plat_m = re.search(r'id="tournament-headline-platform"[^>]*>(.*?)</', page_html, re.S)
    plat_type = html_lib.unescape(plat_m.group(1)).replace("Tournament Type:", "").strip() if plat_m else None
    fmt_m = re.search(r"Format:\s*([^|<]+)", page_html)
    format_name = html_lib.unescape(fmt_m.group(1)).strip() if fmt_m else None
    enr_m = re.search(r"(?:fa-user\b[^>]*></i>\s*)?(\d+)(?:\s+of\s+(\d+))?\s+Enrolled\s+Players", page_html, re.I)
    enrolled_players = int(enr_m.group(1)) if enr_m else 0
    player_cap = int(enr_m.group(2)) if (enr_m and enr_m.group(2)) else 0
    if not player_cap:
        cap_inp_m = re.search(r'id="tournament-player-cap-value"[^>]*value="(\d+)"', page_html, re.I)
        if cap_inp_m:
            player_cap = int(cap_inp_m.group(1))

    entry_fee = None
    registration_type = None
    reg_line_m = re.search(r'id="tournament-headline-registration"[^>]*>(.*?)</p>', page_html, re.S | re.I)
    if reg_line_m:
        reg_parts = [
            " ".join(html_lib.unescape(re.sub(r"<[^>]+>", " ", seg)).split()).strip()
            for seg in reg_line_m.group(1).split("|")
        ]
        reg_parts = [p for p in reg_parts if p]
        for idx_p, part in enumerate(reg_parts):
            low_p = part.lower()
            if low_p.startswith("format:") or "enrolled player" in low_p:
                continue
            if status_str and low_p == status_str.strip().lower():
                continue
            if any(k in low_p for k in ("open registration", "invite only", "closed registration", "password", "passcode")):
                if not registration_type:
                    registration_type = part
                continue
            if idx_p == 0 and not entry_fee:
                entry_fee = part

    dl_m = re.search(r'id="DecklistEnabled"[^>]*value="(true|false)"', page_html, re.I)
    decklists_enabled = (dl_m.group(1).lower() == "true") if dl_m else None

    img_m = re.search(r'id="tournament-headline-brand-image"[^>]*src="([^"]+)"', page_html, re.I)
    brand_img = img_m.group(1).strip() if img_m else ""
    if "blankbrandimage" in brand_img.lower():
        brand_img = ""

    desc_html = _extract_tab_inner_html(page_html, "tournament-description-tab")
    prizes_html = _extract_tab_inner_html(page_html, "tournament-prizes-tab")

    combined_desc_parts: List[str] = []
    if desc_html:
        combined_desc_parts.append(desc_html)
    if prizes_html and "agreed to pay out prizes in 60 days" not in prizes_html.lower():
        combined_desc_parts.append(f"<h4>Prizes</h4>\n{prizes_html}")
    elif prizes_html and not desc_html:
        combined_desc_parts.append(prizes_html)
    combined_description = "\n".join(combined_desc_parts).strip() or None

    return {
        "tid": str(tid),
        "title": title or f"Melee Tournament {tid}",
        "start_date": start_m.group(1) if start_m else None,
        "game_name": game_name,
        "status": status_str,
        "organization_name": org_name,
        "organization_url": org_url,
        "venue_name": venue_name,
        "platform_type": plat_type,
        "format_name": format_name,
        "entry_fee": entry_fee,
        "registration_type": registration_type,
        "decklists_enabled": decklists_enabled,
        "brand_image_url": brand_img or None,
        "description_html": desc_html or None,
        "prizes_html": prizes_html or None,
        "description": combined_description,
        "enrolled_players": enrolled_players,
        "player_cap": player_cap,
        "standing_rounds": _round_selectors(page_html, "standings-round-selector-container"),
        "pairing_rounds": _round_selectors(page_html, "pairings-round-selector-container"),
    }
