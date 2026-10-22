#!/usr/bin/env python3
"""
Dedicated Cloud Run Job / CLI Sync Script for Melee.gg (`scripts/sync_melee.py`).
Scrapes completed competitive TCG tournaments (`mtg`, `sw_unlimited`, `lorcana`, `flesh_and_blood`, `riftbound`)
from `https://melee.gg` (`melee:` prefix), including round standings, pairings, and decklists,
and updates Elo & Meta Intel strictly for the touched game systems.
"""

import argparse
import gzip
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.sync_multiplatform import (
    finalize_platform_sync,
    get_existing_platform_event_ids,
    get_sync_db,
    import_live_melee_tournaments,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("elo.job.melee_sync")

MELEE_GAME_TAGS: Dict[str, str] = {
    "mtg": "MagicTheGathering",
    "sw_unlimited": "StarWarsUnlimited",
    "lorcana": "Lorcana",
    "flesh_blood": "FleshAndBlood",
    "riftbound": "Riftbound",
}

DEFAULT_MELEE_TARGETS: List[Tuple[str, str]] = [
    ("mtg", "428253"),          # Arena Championship 12 (2026)
    ("mtg", "72980"),           # Pro Tour Thunder Junction (2024)
    ("sw_unlimited", "458821"), # Star Wars: Unlimited - 09/10/26
    ("sw_unlimited", "468577"), # SWU - 10/01/26
]

HISTORICAL_MELEE_TARGETS: List[Tuple[str, str]] = [
    ("mtg", "2000"),            # Chimera Gaming Standard Arena Tournament 06/20/20
    ("mtg", "3500"),            # Saturday 8PM PAX Online MTG Arena Historic Preliminary
    ("mtg", "5000"),            # Magic Online Society Pauper FNM
    ("mtg", "8000"),            # SCG Tour Online - Satellite #1 - Standard
    ("mtg", "10500"),           # 2º Explorer Element4 Teresina
    ("mtg", "14122"),           # Weekday Night Magic
    ("mtg", "15255"),           # CF SEA - Saturday 11AM Canadian Highlander Tournament
    ("lorcana", "23000"),       # Underworld Games Lorcana TCG Casual Countdown constructed event
    ("lorcana", "30000"),       # Lorcana League Week 5 (Constructed)
    ("lorcana", "40500"),       # Prima Tappa Lorcana 2nd Chapter
    ("lorcana", "47500"),       # Lorcana Night Core 2
    ("lorcana", "54500"),       # Friday Night Lorcana
    ("mtg", "58000"),           # Ottawa Tour Weekend - Saturday Super Qualifier
    ("lorcana", "61500"),       # Lorcana Locals 15/2/24
    ("lorcana", "65000"),       # Disney Lorcana - Constructed Tournament - 2/25 - 3:00 PM
    ("lorcana", "72000"),       # BOOSTER DRAFT INTO THE INKLANDS
    ("lorcana", "75500"),       # Into the Inklands Championship - Clan Shots Gaming
    ("lorcana", "89500"),       # Thursday Lorcana League
    ("lorcana", "93000"),       # Hiveworld - Lorcana Constructed 03.06.24
    ("lorcana", "103500"),      # Liga Lorcana 6 de Junio
    ("lorcana", "107000"),      # Ursula's Return Draft
    ("lorcana", "110500"),      # Torneo COSTRUITO COMPETITIVO LORCANA - Il Ritorno di Ursula
    ("lorcana", "114000"),      # End of Round Poorcana Tournament
    ("lorcana", "128000"),      # Shimmering Skies Midnight Release Sealed Event
    ("lorcana", "138500"),      # Saturday Lorcana 08/24/24
    ("lorcana", "142000"),      # Lorcana - Enchanted Series
    ("lorcana", "149000"),      # Weekly Play - Lorcana League: Shimmering Skies, Week 6
    ("mtg", "150000"),          # Aspettando lo Store Championship
    ("sw_unlimited", "159500"), # Saturday SWU Locals
    ("sw_unlimited", "170000"), # Tournoi Construit Star Wars Unlimited
    ("sw_unlimited", "187500"), # Star Wars Unlimited DRAFT night
    ("lorcana", "194500"),      # Azurite Sea Set Championship w/Krakenhits
    ("sw_unlimited", "200000"), # Starwars Unlimited Weekly
    ("lorcana", "205000"),      # Azurite Sea Championship
    ("sw_unlimited", "208500"), # Star Wars Unlimited Draft
    ("lorcana", "212000"),      # Lorcana League Azurite Sea R1 W4
    ("sw_unlimited", "219000"), # Star Wars Unlimited Twilight of the Republic Showdown
    ("sw_unlimited", "233000"), # Store Championship Star Wars Unlimited
    ("lorcana", "243500"),      # Lorcana Locals 2/8/25
    ("sw_unlimited", "250500"), # Avant Première : Set 4 - Jump to Lightspeed
    ("sw_unlimited", "257500"), # star wars store champ
    ("lorcana", "268000"),      # Archazia's Island Weekly Play
    ("lorcana", "278500"),      # Java Archazia's Island Set Championship
    ("lorcana", "285500"),      # ALTF4 - Archazia's Island Store Champ
    ("lorcana", "296000"),      # Derby Archazia's Island Set Championship
    ("sw_unlimited", "306500"), # Star Wars Unlimited Constructed @PlayhousePatras
    ("lorcana", "310000"),      # HDLegacy Lorcana League
    ("lorcana", "320500"),      # 6/3 Reign of Jafar Prerelease: Sealed
    ("sw_unlimited", "327500"), # Calanda Magic Prerelease SWU Legends of the Force
    ("sw_unlimited", "334500"), # Legends of the Force Prerelease w Rebelowej Strefie Gier
    ("lorcana", "338000"),      # Tuesday Lorcana Toronto July 08
    ("sw_unlimited", "341500"), # Star Wars Unlimited Weekly Play
    ("lorcana", "348500"),      # Lorcana Store Champ
    ("sw_unlimited", "355500"), # Legends of the Force Store Showdown
    ("mtg", "366000"),          # MTG Spider-man Prerelese
    ("sw_unlimited", "376500"), # TORNEO SWU
    ("mtg", "397500"),          # Lorwyn Prerelease
    ("sw_unlimited", "401000"), # Store showdown Secrets of Power
    ("sw_unlimited", "404500"), # SWU - Store Showdown
    ("sw_unlimited", "411500"), # Star Wars Unlimited 03-07-2025 Prerelease
    ("sw_unlimited", "418500"), # SWU: Casual Premier 3/31
    ("sw_unlimited", "432500"), # MSB SWU Weekly
    ("sw_unlimited", "436000"), # Star Wars: Unlimited – Store Showdown
    ("mtg", "443000"),          # MTG Paper Legacy Discord - Weekday Warrior Tournament - 7/8/26
    ("sw_unlimited", "446500"), # SWU Ashes of the Empire Draft
]


def _parse_iso_bound(val: Optional[str], is_end: bool = False) -> Optional[datetime]:
    if not val or not str(val).strip():
        return None
    s = str(val).strip()
    if len(s) == 10:
        s = f"{s}T23:59:59+00:00" if is_end else f"{s}T00:00:00+00:00"
    else:
        s = s.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _discover_live_melee_targets_via_cdp(
    systems: List[str],
    start_iso: str,
    end_iso: str,
    is_backfill: bool,
    cap: int,
    existing_set: set,
) -> List[Tuple[str, str]]:
    """
    Discovers completed Melee.gg tournaments directly from `https://melee.gg/Tournament/TournamentSearch`
    via headless Chrome/Chromium CDP across requested game tags.
    """
    chrome_bin = shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chromium-browser")
    if not (shutil.which("node") and chrome_bin) or os.getenv("MELEE_SKIP_CHROME", "0") == "1":
        return []

    tag_pairs = [(s, MELEE_GAME_TAGS[s]) for s in systems if s in MELEE_GAME_TAGS]
    if not tag_pairs:
        return []

    with tempfile.NamedTemporaryFile(prefix="melee_disc_", suffix=".json", delete=False) as tf:
        out_path = tf.name

    node_disc_script = r"""
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");

const cfg = JSON.parse(process.argv[1]);
const outPath = process.argv[2];
const chromeBin = process.argv[3] || "google-chrome";

async function main() {
  const port = 19560 + Math.floor(Math.random() * 400);
  const profileDir = `/tmp/chrome_disc_${port}_${process.pid}`;
  try { fs.mkdirSync(profileDir, { recursive: true }); } catch (e) {}
  const chrome = spawn(chromeBin, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--no-first-run", "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    `--user-data-dir=${profileDir}`,
    "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    `--remote-debugging-port=${port}`,
    "https://melee.gg/Tournament/Index?ordering=StartDate&mode=Table"
  ], { stdio: "ignore" });
  const cleanup = () => {
    try { chrome.kill("SIGKILL"); } catch (e) {}
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
  };
  let pageTarget = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(r => setTimeout(r, 350));
    try {
      const targets = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/json`, res => {
          let d = ""; res.on("data", c => d += c); res.on("end", () => {
            try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
          });
        });
        req.on("error", reject);
        req.setTimeout(1000, () => { req.destroy(); reject(new Error("timeout")); });
      });
      if (Array.isArray(targets)) {
        pageTarget = targets.find(t => t.type === "page" && t.webSocketDebuggerUrl && String(t.url || "").includes("melee.gg"));
        if (pageTarget) break;
      }
    } catch (e) {}
  }
  if (!pageTarget) {
    fs.writeFileSync(outPath, "{}");
    cleanup();
    process.exit(0);
  }
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  let msgId = 1;
  const send = (method, params = {}) => new Promise(resolve => {
    const id = msgId++;
    const listener = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.id === id) { ws.removeEventListener("message", listener); resolve(data.result); }
    };
    ws.addEventListener("message", listener);
    ws.send(JSON.stringify({ id, method, params }));
  });
  for (let w = 0; w < 35; w++) {
    const chk = await send("Runtime.evaluate", { expression: "Boolean(window.$ && window.$.post)", returnByValue: true });
    if (chk && chk.result && chk.result.value === true) break;
    await new Promise(r => setTimeout(r, 350));
  }
  const res = await send("Runtime.evaluate", {
    expression: `(async () => {
      const baseColumns = [
        {"data":"StartDate","name":"StartDate","searchable":true,"orderable":true,"search":{"value":"","regex":false}},
        {"data":"Name","name":"Name","searchable":true,"orderable":true,"search":{"value":"","regex":false}},
        {"data":"OrganizationName","name":"OrganizationName","searchable":true,"orderable":false,"search":{"value":"","regex":false}},
        {"data":"Format","name":"Format","searchable":true,"orderable":true,"search":{"value":"","regex":false}},
        {"data":"Status","name":"Status","searchable":true,"orderable":true,"search":{"value":"","regex":false}},
        {"data":"Game","name":"Game","searchable":true,"orderable":true,"search":{"value":"","regex":false}},
        {"data":"Decklists","name":"Decklists","searchable":false,"orderable":true,"search":{"value":"","regex":false}},
        {"data":"Cards","name":"Cards","searchable":true,"orderable":false,"search":{"value":"","regex":false}}
      ];
      const tagPairs = ${JSON.stringify(cfg.tagPairs)};
      const startIso = ${JSON.stringify(cfg.startIso)};
      const endIso = ${JSON.stringify(cfg.endIso)};
      const isBackfill = ${JSON.stringify(cfg.isBackfill)};
      const bySystem = {};

      await Promise.all(tagPairs.map(async ([sysSlug, tag]) => {
        bySystem[sysSlug] = [];
        try {
          const first = await $.post("/Tournament/TournamentSearch", {
            ordering: "StartDate",
            filters: ["Ended", tag],
            mode: "Table",
            variables: {
              draw: 1,
              columns: baseColumns,
              order: [{"column": 0, "dir": "desc"}],
              start: 0,
              length: 100,
              search: {"value": "", "regex": false}
            }
          });
          const totalFiltered = (first && first.recordsFiltered) || 0;
          const allRows = (first && first.data) ? [...first.data] : [];
          let extraOffsets = [100];
          if (isBackfill && totalFiltered > 200) {
            const maxOff = Math.min(totalFiltered - 100, 40000);
            const rawOffs = [100, 300, 800, 2000, 5000, 12000, 25000, maxOff];
            extraOffsets = Array.from(new Set(rawOffs.filter(o => o > 0 && o <= maxOff)));
          } else if (totalFiltered <= 100) {
            extraOffsets = [];
          }
          const extraPages = await Promise.all(extraOffsets.map(off =>
            $.post("/Tournament/TournamentSearch", {
              ordering: "StartDate",
              filters: ["Ended", tag],
              mode: "Table",
              variables: {
                draw: 1,
                columns: baseColumns,
                order: [{"column": 0, "dir": "desc"}],
                start: off,
                length: 100,
                search: {"value": "", "regex": false}
              }
            }).then(r => (r && r.data) || []).catch(() => [])
          ));
          for (const pageRows of extraPages) {
            allRows.push(...pageRows);
          }
          for (const row of allRows) {
            const sd = String(row.startDate || "");
            const enrolled = Number(row.enrolledPlayerCount || 0);
            if (row.id && enrolled >= 6 && sd >= startIso && sd <= endIso) {
              bySystem[sysSlug].push(String(row.id));
            }
          }
        } catch (e) {}
      }));
      return JSON.stringify(bySystem);
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  fs.writeFileSync(outPath, (res && res.result && res.result.value) || "{}");
  try { ws.close(); } catch (e) {}
  cleanup();
  process.exit(0);
}
main().catch(() => {
  try { fs.writeFileSync(outPath, "{}"); } catch (e) {}
  process.exit(0);
});
"""
    discovered: List[Tuple[str, str]] = []
    seen_tids: set = set()
    try:
        payload = {
            "tagPairs": tag_pairs,
            "startIso": start_iso,
            "endIso": end_iso,
            "isBackfill": is_backfill,
        }
        subprocess.run(
            ["node", "-e", node_disc_script, json.dumps(payload), out_path, chrome_bin],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=35,
        )
        with open(out_path, "r", encoding="utf-8") as f:
            by_system = json.load(f) or {}

        import itertools

        per_sys_lists: List[List[Tuple[str, str]]] = []
        for sys_slug, _ in tag_pairs:
            tids_for_sys = by_system.get(sys_slug) or []
            sys_cands: List[Tuple[str, str]] = []
            for tid in tids_for_sys:
                tid_str = str(tid).strip()
                if (
                    not tid_str
                    or tid_str in seen_tids
                    or tid_str in existing_set
                    or f"melee:{tid_str}" in existing_set
                ):
                    continue
                seen_tids.add(tid_str)
                sys_cands.append((sys_slug, tid_str))
            if sys_cands:
                per_sys_lists.append(sys_cands)

        for row_tuple in itertools.zip_longest(*per_sys_lists):
            for pair in row_tuple:
                if pair is None:
                    continue
                discovered.append(pair)
                if len(discovered) >= cap:
                    break
            if len(discovered) >= cap:
                break
    except Exception as e:
        logger.debug(f"[MeleeSync] Live /Tournament/TournamentSearch discovery fallback: {e}")
    finally:
        if os.path.exists(out_path):
            os.remove(out_path)

    return discovered[:cap]


def discover_melee_targets(
    game_system: str = "all",
    days: int = 14,
    max_events: Optional[int] = 100,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    existing_ids: Optional[set] = None,
) -> List[Tuple[str, str]]:
    """
    Discovers completed Melee.gg tournaments directly from `https://melee.gg/Tournament/TournamentSearch`
    across 2020–2026 (`mtg`, `sw_unlimited`, `lorcana`, `flesh_blood`, `riftbound`), falling back to
    `DEFAULT_MELEE_TARGETS` / `HISTORICAL_MELEE_TARGETS` only when headless Chrome is unavailable or more events are needed.
    """
    target_sys = (game_system or "all").strip().lower()
    if target_sys == "flesh_and_blood":
        target_sys = "flesh_blood"
    is_backfill = bool((days or 14) >= 365 or start_date)
    cap = max_events or (200 if is_backfill else 15)
    existing_set = existing_ids or set()

    if target_sys in ("all", "other", "tcg"):
        systems = list(MELEE_GAME_TAGS.keys())
    else:
        systems = [target_sys]

    now_dt = datetime.now(timezone.utc)
    end_dt = min(_parse_iso_bound(end_date, is_end=True) or now_dt, now_dt + timedelta(days=1))
    start_dt = _parse_iso_bound(start_date, is_end=False) or (end_dt - timedelta(days=max(1, int(days or 14))))
    start_iso = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    end_iso = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    live_discovered = _discover_live_melee_targets_via_cdp(
        systems=systems,
        start_iso=start_iso,
        end_iso=end_iso,
        is_backfill=is_backfill,
        cap=cap,
        existing_set=existing_set,
    )
    if len(live_discovered) >= cap:
        return live_discovered[:cap]

    candidate_pool: List[Tuple[str, str]] = list(live_discovered)
    seen_tids = {tid for _, tid in candidate_pool}

    fallback_by_sys: Dict[str, List[Tuple[str, str]]] = {}
    for s_slug, tid in list(DEFAULT_MELEE_TARGETS) + (list(HISTORICAL_MELEE_TARGETS) if is_backfill else []):
        s_norm = "flesh_blood" if s_slug == "flesh_and_blood" else s_slug
        if tid not in seen_tids:
            seen_tids.add(tid)
            fallback_by_sys.setdefault(s_norm, []).append((s_norm, tid))

    cache_gz_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "melee_live_cache.json.gz")
    if os.path.exists(cache_gz_path):
        try:
            with gzip.open(cache_gz_path, "rt", encoding="utf-8") as gf:
                cached_by_tid = json.load(gf) or {}
            sorted_keys = sorted(
                cached_by_tid.keys(),
                key=lambda x: int(x) if str(x).isdigit() else 0,
                reverse=not is_backfill,
            )
            for raw_tid in sorted_keys:
                if raw_tid not in seen_tids:
                    gs_val = str((cached_by_tid.get(raw_tid) or {}).get("game_system") or "mtg").strip().lower()
                    if gs_val == "flesh_and_blood":
                        gs_val = "flesh_blood"
                    seen_tids.add(raw_tid)
                    fallback_by_sys.setdefault(gs_val, []).append((gs_val, str(raw_tid)))
        except Exception:
            pass

    import itertools
    for row_tuple in itertools.zip_longest(*[b for b in fallback_by_sys.values() if b]):
        for pair in row_tuple:
            if pair is not None:
                candidate_pool.append(pair)

    filtered = [
        (s, tid)
        for s, tid in candidate_pool
        if target_sys in ("all", "other", "tcg") or s == target_sys
    ]
    unimported = [
        (s, tid)
        for s, tid in filtered
        if tid not in existing_set and f"melee:{tid}" not in existing_set
    ]
    selected = unimported[:cap] if unimported else filtered[:cap]
    return selected


def run_melee_sync(
    game_system: str = "all",
    days: int = 14,
    max_events: Optional[int] = 100,
    event_ids: Optional[List[Tuple[str, str]]] = None,
    sqlite_path: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Dict[str, Any]:
    """Executes the Melee.gg tournament sync and incremental Elo reconstruction."""
    logger.info(
        f"🚀 Starting Melee.gg Sync Job (game_system={game_system}, days={days}, "
        f"start_date={start_date}, end_date={end_date}, max_events={max_events})"
    )
    db = get_sync_db(sqlite_path=sqlite_path)

    if event_ids:
        targets = event_ids
    else:
        existing_ids = get_existing_platform_event_ids(db, "melee")
        targets = discover_melee_targets(
            game_system=game_system,
            days=days,
            max_events=max_events,
            start_date=start_date,
            end_date=end_date,
            existing_ids=existing_ids,
        )

    if not targets:
        logger.info("ℹ️ [MeleeSync] No matching Melee.gg tournaments specified.")
        return {"platform": "melee", "events_imported": 0, "matches_imported": 0}

    import_res = import_live_melee_tournaments(db, targets)
    touched_systems = sorted({t[0] for t in targets})
    finalize_res = finalize_platform_sync(db, touched_systems, platform_name="Melee.gg")

    return {
        **import_res,
        **finalize_res,
        "platform": "melee",
        "targets_count": len(targets),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cloud Run Job: Melee.gg tournament sync & Elo recalculation")
    parser.add_argument("--game-system", default=os.getenv("GAME_SYSTEM", "all"), help="Game system (all, mtg, sw_unlimited, lorcana, flesh_and_blood)")
    parser.add_argument("--days", type=int, default=int(os.getenv("DAYS", "14")), help="Days of past tournaments to scrape (default: 14; use 3650 for 10yr backfill)")
    parser.add_argument("--start-date", "--from", dest="start_date", default=os.getenv("START_DATE"), help="Optional start date (YYYY-MM-DD or ISO8601)")
    parser.add_argument("--end-date", "--to", dest="end_date", default=os.getenv("END_DATE"), help="Optional end date (YYYY-MM-DD or ISO8601)")
    parser.add_argument("--max-events", type=int, default=int(os.getenv("MAX_EVENTS", "10")), help="Max tournaments to scrape (default: 10)")
    parser.add_argument("--event-ids", default="", help="Optional comma-separated sys:tournament_id pairs (e.g. mtg:428253,sw_unlimited:458821)")
    parser.add_argument("--sqlite-path", default=os.getenv("LOCAL_SQLITE_PATH"), help="Optional local SQLite DB path for local verification")
    args, _ = parser.parse_known_args()

    explicit_pairs: Optional[List[Tuple[str, str]]] = None
    if args.event_ids.strip():
        explicit_pairs = []
        for tok in args.event_ids.split(","):
            tok = tok.strip()
            if ":" in tok:
                s_slug, t_id = tok.split(":", 1)
                explicit_pairs.append((s_slug.strip().lower(), t_id.strip()))
            elif tok:
                explicit_pairs.append(((args.game_system if args.game_system != "all" else "mtg"), tok))

    res = run_melee_sync(
        game_system=args.game_system,
        days=args.days,
        max_events=args.max_events,
        event_ids=explicit_pairs,
        sqlite_path=args.sqlite_path,
        start_date=args.start_date,
        end_date=args.end_date,
    )
    print(json.dumps(res, indent=2, default=str))
