#!/usr/bin/env python3
"""
Periodic Maintenance Utility for data/nr_offline_bundle.zip

Usage:
  1. Check which Warhammer 40k / AoS books have newer versions on www.newrecruit.eu:
       python3 scripts/update_nr_offline_bundle.py --dry-run

  2. Refresh fallback catalogue books (rpc/get_library.json + updated books/*.json)
     while keeping the tested UI shell (shell.html + static/_nuxt/*) pinned:
       python3 scripts/update_nr_offline_bundle.py

  3. Refresh both fallback catalogue books AND the Vue/Nuxt UI shell:
       python3 scripts/update_nr_offline_bundle.py --update-ui-shell
"""

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

ROOT_DIR = Path(__file__).resolve().parent.parent
BUNDLE_PATH = ROOT_DIR / "data" / "nr_offline_bundle.zip"
NR_BASE_URL = os.environ.get("NR_BASE_URL", "https://www.newrecruit.eu").rstrip("/")
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Target game systems kept in the fallback bundle:
# - 827374861: Warhammer 40,000 11th/Latest Edition
# - 2821148162: Warhammer 40,000 10th Edition
# - 4255553472: Age of Sigmar 4.0
# - 4194757354: Age of Sigmar 3.0
TARGET_SYSTEM_IDS: Set[int] = {827374861, 2821148162, 4255553472, 4194757354}


def _http_post_rpc(method: str, params: List[Any]) -> bytes:
    url = f"{NR_BASE_URL}/api/rpc?m={method}"
    payload = json.dumps({"method": method, "params": params}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*",
            "Origin": NR_BASE_URL,
            "Referer": f"{NR_BASE_URL}/app/Lists",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20.0) as resp:
        return resp.read()


def _http_get_bytes(path: str) -> bytes:
    url = f"{NR_BASE_URL}{path if path.startswith('/') else '/' + path}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Origin": NR_BASE_URL,
            "Referer": f"{NR_BASE_URL}/app/Lists",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=20.0) as resp:
        return resp.read()


def _extract_books_from_library(lib_bytes: bytes) -> Dict[Tuple[int, int], Dict[str, Any]]:
    """Returns {(id_system, id_book): book_meta} for target Warhammer 40k & AoS systems."""
    out: Dict[Tuple[int, int], Dict[str, Any]] = {}
    data = json.loads(lib_bytes.decode("utf-8", errors="ignore"))
    systems = []
    if isinstance(data, dict):
        if isinstance(data.get("array"), list):
            systems = data["array"]
        elif isinstance(data.get("index"), dict):
            systems = list(data["index"].values())
        elif isinstance(data.get("systems"), list):
            systems = data["systems"]
    elif isinstance(data, list):
        systems = data

    for sys_obj in systems:
        if not isinstance(sys_obj, dict):
            continue
        sys_id = int(sys_obj.get("id") or 0)
        if sys_id not in TARGET_SYSTEM_IDS:
            continue
        books_container = sys_obj.get("books")
        book_list = []
        if isinstance(books_container, dict):
            if isinstance(books_container.get("array"), list):
                book_list = books_container["array"]
            elif isinstance(books_container.get("index"), dict):
                book_list = list(books_container["index"].values())
        elif isinstance(books_container, list):
            book_list = books_container
        for b in book_list:
            if not isinstance(b, dict) or not b.get("id"):
                continue
            b_id = int(b["id"])
            out[(sys_id, b_id)] = b
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh data/nr_offline_bundle.zip from live www.newrecruit.eu")
    parser.add_argument("--dry-run", action="store_true", help="Only report outdated books without modifying the zip")
    parser.add_argument("--force-books", action="store_true", help="Re-download all books even if nrversion matches")
    parser.add_argument(
        "--update-ui-shell",
        action="store_true",
        help="Also refresh shell.html and referenced /_nuxt/* assets (default keeps UI shell pinned)",
    )
    args = parser.parse_args()

    if not BUNDLE_PATH.exists():
        print(f"ERROR: Bundle not found at {BUNDLE_PATH}", file=sys.stderr)
        return 1

    print(f"[1/3] Fetching live get_library from {NR_BASE_URL}...")
    live_lib_bytes = _http_post_rpc("get_library", [])
    live_books = _extract_books_from_library(live_lib_bytes)
    print(f"      Found {len(live_books)} Warhammer 40k / AoS books in live library.")

    with zipfile.ZipFile(BUNDLE_PATH, "r") as zf:
        existing_names = set(zf.namelist())
        old_books: Dict[Tuple[int, int], Dict[str, Any]] = {}
        if "rpc/get_library.json" in existing_names:
            try:
                old_books = _extract_books_from_library(zf.read("rpc/get_library.json"))
            except Exception:
                old_books = {}

    to_download: List[Tuple[int, int, Dict[str, Any], Any]] = []
    for (sys_id, book_id), meta in sorted(live_books.items()):
        arcname = f"books/{sys_id}_{book_id}.json"
        live_ver = meta.get("nrversion")
        old_meta = old_books.get((sys_id, book_id)) or {}
        old_ver = old_meta.get("nrversion")
        if args.force_books or (live_ver != old_ver) or (arcname not in existing_names and old_ver is None):
            to_download.append((sys_id, book_id, meta, old_ver))

    print(f"[2/3] {len(to_download)} book(s) have updated versions compared to {BUNDLE_PATH.name}:")
    for sys_id, book_id, meta, old_ver in to_download:
        print(
            f"      - [{sys_id}] {meta.get('name')} (id={book_id}): "
            f"bundled nrversion={old_ver} -> live nrversion={meta.get('nrversion')}"
        )

    if args.dry_run:
        print("[Dry Run] Exiting without modifying data/nr_offline_bundle.zip.")
        return 0

    updated_entries: Dict[str, bytes] = {
        "rpc/get_library.json": live_lib_bytes,
    }

    for idx, (sys_id, book_id, meta, _) in enumerate(to_download, start=1):
        arcname = f"books/{sys_id}_{book_id}.json"
        print(f"      Downloading ({idx}/{len(to_download)}) {meta.get('name')} -> {arcname} ...")
        try:
            book_bytes = _http_post_rpc("books_get_book_row", [sys_id, book_id])
            if book_bytes and len(book_bytes) > 10:
                updated_entries[arcname] = book_bytes
            time.sleep(0.15)
        except Exception as e:
            print(f"      WARNING: Failed to download {arcname}: {e}", file=sys.stderr)

    if args.update_ui_shell:
        print("[2b/3] Fetching live shell.html and referenced /_nuxt/* assets...")
        shell_bytes = _http_get_bytes("/app/Lists")
        updated_entries["shell.html"] = shell_bytes
        shell_str = shell_bytes.decode("utf-8", errors="ignore")
        nuxt_paths = sorted(set(re.findall(r"/_nuxt/[A-Za-z0-9._-]+", shell_str)))
        for npath in nuxt_paths:
            arc = f"static{npath}"
            try:
                updated_entries[arc] = _http_get_bytes(npath)
                time.sleep(0.08)
            except Exception as e:
                print(f"      WARNING: Failed to fetch {npath}: {e}", file=sys.stderr)

    print(f"[3/3] Writing updated archive to {BUNDLE_PATH}...")
    fd, tmp_path = tempfile.mkstemp(suffix=".zip", dir=str(BUNDLE_PATH.parent))
    os.close(fd)
    try:
        with zipfile.ZipFile(BUNDLE_PATH, "r") as zin, zipfile.ZipFile(
            tmp_path, "w", compression=zipfile.ZIP_DEFLATED
        ) as zout:
            for item in zin.infolist():
                if item.filename in updated_entries:
                    continue
                zout.writestr(item, zin.read(item.filename))
            for arcname, content in updated_entries.items():
                zout.writestr(arcname, content)
        shutil.move(tmp_path, BUNDLE_PATH)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    print(f"✅ Successfully updated {BUNDLE_PATH} ({len(updated_entries)} entries refreshed).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
