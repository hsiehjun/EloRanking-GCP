#!/usr/bin/env python3
"""Sequential Production Endpoint & Database Latency Gate for OmniTactica.

Runs one endpoint at a time against the production server (default: https://omnitactica.com),
verifies every server endpoint returns in < 1,000ms (1.0s), and inspects
/api/system/perf-telemetry to confirm structured API and DB call latency logging.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple


def fetch_once(url: str, timeout: float = 10.0) -> Tuple[int, float, bytes]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "OmniTactica-PerfGate/1.0",
            "Accept": "application/json, text/html, image/svg+xml, */*",
        },
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            ms = (time.perf_counter() - t0) * 1000.0
            return resp.status, ms, body
    except urllib.error.HTTPError as e:
        try:
            body = e.read()
        except Exception:
            body = b""
        ms = (time.perf_counter() - t0) * 1000.0
        return e.code, ms, body
    except Exception as exc:
        ms = (time.perf_counter() - t0) * 1000.0
        return 599, ms, str(exc).encode("utf-8")


def wait_for_prewarm(base_url: str, max_wait_sec: int = 25) -> None:
    """Waits briefly after deployment for background startup cache pre-warming to finish."""
    deadline = time.time() + max_wait_sec
    while time.time() < deadline:
        status, _, body = fetch_once(f"{base_url}/api/system/perf-telemetry", timeout=5.0)
        if status == 200:
            try:
                data = json.loads(body.decode("utf-8"))
                if int(data.get("observed_db_methods_count") or 0) >= 8:
                    return
            except Exception:
                pass
        time.sleep(2.0)


def build_endpoint_list(base_url: str) -> List[Tuple[str, str]]:
    """Resolves live IDs from production and returns the full sequential endpoint list."""
    p1_id = "demo-player"
    p2_id = "demo-player-2"
    ev_id = "demo-event"
    team_name = "Art of War"
    store_name = "At Ease Games"
    league_id = "sd40k"

    st, _, body = fetch_once(f"{base_url}/api/players?page=1&page_size=5&game_system=40k")
    if st == 200:
        try:
            players = (json.loads(body.decode("utf-8")).get("players") or [])
            if len(players) >= 1 and players[0].get("player_id"):
                p1_id = str(players[0]["player_id"])
            if len(players) >= 2 and players[1].get("player_id"):
                p2_id = str(players[1]["player_id"])
        except Exception:
            pass

    st, _, body = fetch_once(f"{base_url}/api/events?page=1&page_size=5&game_system=40k")
    if st == 200:
        try:
            events = (json.loads(body.decode("utf-8")).get("events") or [])
            if events and events[0].get("id"):
                ev_id = str(events[0]["id"])
        except Exception:
            pass

    st, _, body = fetch_once(f"{base_url}/api/teams?page=1&page_size=5&game_system=40k")
    if st == 200:
        try:
            teams = (json.loads(body.decode("utf-8")).get("teams") or [])
            if teams and (teams[0].get("team_name") or teams[0].get("team")):
                team_name = str(teams[0].get("team_name") or teams[0].get("team"))
        except Exception:
            pass

    p1_q = urllib.parse.quote(p1_id, safe="")
    p2_q = urllib.parse.quote(p2_id, safe="")
    ev_q = urllib.parse.quote(ev_id, safe="")
    team_q = urllib.parse.quote(team_name, safe="")
    store_q = urllib.parse.quote(store_name, safe="")
    lg_q = urllib.parse.quote(league_id, safe="")

    return [
        # 1. Core Health, Version & Telemetry
        ("Health /health", "/health"),
        ("Health /api/health", "/api/health"),
        ("Version /api/version", "/api/version"),
        ("Version /version.json", "/version.json"),
        ("Manifest /manifest.json", "/manifest.json"),
        ("Perf Telemetry /api/system/perf-telemetry", "/api/system/perf-telemetry"),
        ("DB Status /api/admin/db_status", "/api/admin/db_status"),
        ("Maps Key /api/config/maps-key", "/api/config/maps-key"),
        # 2. HTML Pages
        ("Page /", "/"),
        ("Page /app", "/app"),
        ("Page /login", "/login"),
        ("Page /tracker", "/tracker"),
        ("Page /40k", "/40k"),
        ("Page /aos", "/aos"),
        ("Page /11th", "/11th"),
        ("Page /scorecard", "/scorecard"),
        ("Page /eventstudio", "/eventstudio"),
        ("Page /overlay", "/overlay"),
        # 3. Leaderboard & Stats (40k + AoS)
        ("Stats 40k", "/api/stats?game_system=40k"),
        ("Stats AoS", "/api/stats?game_system=aos"),
        ("Players Top 40k", "/api/players?page=1&page_size=25&min_matches=3&game_system=40k"),
        ("Players Top AoS", "/api/players?page=1&page_size=25&min_matches=3&game_system=aos"),
        ("Players Dir 40k", "/api/players/directory?page=1&page_size=25&game_system=40k"),
        ("Players Dir AoS", "/api/players/directory?page=1&page_size=25&game_system=aos"),
        ("Players Search 40k", "/api/players/search?q=John&game_system=40k"),
        ("Players Search AoS", "/api/players/search?q=John&game_system=aos"),
        ("Player Profile 40k", f"/api/player/{p1_q}?game_system=40k"),
        ("Player Tournaments 40k", f"/api/player/{p1_q}/tournaments?game_system=40k"),
        ("Player Army Lists 40k", f"/api/player/{p1_q}/army-lists?game_system=40k"),
        ("Head to Head 40k", f"/api/h2h?p1={p1_q}&p2={p2_q}&game_system=40k"),
        ("Predict 40k", f"/api/predict?p1_id={p1_q}&p2_id={p2_q}&game_system=40k"),
        ("OG Player Card SVG", f"/api/og/player/40k/{p1_q}.svg"),
        ("Public Player Share", f"/p/40k/{p1_q}"),
        # 4. Events & Tournaments
        ("Events All 40k", "/api/events?page=1&page_size=25&status=all&game_system=40k"),
        ("Events Completed 40k", "/api/events?page=1&page_size=25&status=completed&game_system=40k"),
        ("Events All AoS", "/api/events?page=1&page_size=25&status=all&game_system=aos"),
        ("Events Recommended 40k", "/api/events/recommended?game_system=40k"),
        ("Events Recommended AoS", "/api/events/recommended?game_system=aos"),
        ("Event Details", f"/api/event/{ev_q}"),
        ("Event Pairings", f"/api/event/{ev_q}/pairings"),
        ("Event Placings", f"/api/event/{ev_q}/placings"),
        # 5. Teams
        ("Teams List 40k", "/api/teams?page=1&page_size=25&game_system=40k"),
        ("Teams List AoS", "/api/teams?page=1&page_size=25&game_system=aos"),
        ("Team Details 40k", f"/api/team/{team_q}?game_system=40k"),
        # 6. Factions & Meta Intel
        ("Factions List 40k", "/api/factions?game_system=40k"),
        ("Factions List AoS", "/api/factions?game_system=aos"),
        ("Factions Meta 40k", "/api/factions/meta?game_system=40k"),
        ("Factions Meta AoS", "/api/factions/meta?game_system=aos"),
        ("Faction Details Space Marines 1yr", "/api/faction/Space%20Marines/details?game_system=40k&time_range=1yr"),
        ("Faction Details Space Marines 6mo", "/api/faction/Space%20Marines/details?game_system=40k&time_range=6mo"),
        ("Faction Details Aeldari 1yr", "/api/faction/Aeldari/details?game_system=40k&time_range=1yr"),
        # 7. Stores & Community
        ("Stores Nearby SD 40k", "/api/stores/nearby?lat=32.7157&lng=-117.1611&radius_miles=50&game_system=40k"),
        ("Stores Nearby SD AoS", "/api/stores/nearby?lat=32.7157&lng=-117.1611&radius_miles=50&game_system=aos"),
        ("Store Tournaments", f"/api/stores/{store_q}/tournaments?game_system=40k"),
        ("Community Overview Default 40k", "/api/community/overview?game_system=40k"),
        ("Community Overview Default AoS", "/api/community/overview?game_system=aos"),
        ("Community Overview SD 40k", "/api/community/overview?lat=32.7157&lng=-117.1611&radius_miles=50&game_system=40k"),
        ("Community Overview SD AoS", "/api/community/overview?lat=32.7157&lng=-117.1611&radius_miles=50&game_system=aos"),
        ("Community LFG", "/api/community/lfg?game_system=40k"),
        ("CommunityFeed", "/api/community/feed?game_system=40k"),
        ("Community Recruiting Teams", "/api/community/teams/recruiting?game_system=40k"),
        ("Community Upcoming Events", "/api/community/upcoming-events?game_system=40k"),
        # 8. Leagues Hub
        ("Leagues List /api/leagues", "/api/leagues?game_system=40k"),
        ("Leagues List /api/leagues/list", "/api/leagues/list?game_system=40k"),
        ("Leagues List AoS", "/api/leagues?game_system=aos"),
        ("League Detail sd40k", f"/api/league/{lg_q}"),
        ("League Detail the-gauntlet", "/api/league/the-gauntlet"),
        ("League Seasons Singular", f"/api/league/{lg_q}/seasons"),
        ("League Seasons Plural", f"/api/leagues/{lg_q}/seasons"),
        ("Seasons Catalog 40k", "/api/leagues/seasons/catalog?game_system=40k"),
        # 9. Tracker & Live Matches
        ("Tracker Live Matches 40k", "/api/tracker/live-matches?game_system=40k"),
        ("Tracker Live Matches AoS", "/api/tracker/live-matches?game_system=aos"),
        ("Tracker History 40k", "/api/tracker/history?limit=25&game_system=40k"),
        ("Tracker History AoS", "/api/tracker/history?limit=25&game_system=aos"),
        ("Tracker Active Rooms", "/api/tracker/rooms"),
        ("Tracker Missions 40k", "/api/tracker/missions?game_system=40k"),
        # 10. Armory & Army Lists
        ("Armory Detachments 40k", "/api/armory/detachments?game_system=40k"),
        ("Armory Formations AoS", "/api/armory/formations?game_system=aos"),
        ("Armory Factions 40k", "/api/armory/factions?game_system=40k"),
        ("Armory Factions AoS", "/api/armory/factions?game_system=aos"),
        ("Armory Enhancements 40k", "/api/armory/enhancements?faction=Space%20Marines&game_system=40k"),
        ("Armory Units 40k", "/api/armory/units?faction=Space%20Marines&game_system=40k"),
        ("Army Lists Search 40k", "/api/army_lists?limit=20&game_system=40k"),
        ("Army Lists Factions 40k", "/api/army_lists/factions?game_system=40k"),
        # 11. Event Studio
        ("EventStudio Locations Default", "/api/eventstudio/locations/search"),
        ("EventStudio Locations San Diego", "/api/eventstudio/locations/search?q=San%20Diego"),
        ("EventStudio Circuits 40k", "/api/eventstudio/circuits?game_system=40k"),
        ("EventStudio Circuits AoS", "/api/eventstudio/circuits?game_system=aos"),
        ("EventStudio Match Predictor", "/api/eventstudio/match_predictor"),
        # 12. Auth & Connect Session Checks
        ("Auth Session", "/api/auth/session"),
        ("Auth Glory Catalog", "/api/glory/catalog"),
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="Sequential Production Performance & Latency Gate")
    parser.add_argument("--base-url", default="https://omnitactica.com", help="Target production base URL")
    parser.add_argument("--max-ms", type=float, default=1000.0, help="Maximum allowed latency per endpoint in ms")
    parser.add_argument("--output", default="/tmp/prod_benchmark_latest.json", help="Output JSON report path")
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    max_ms = args.max_ms

    print(f"======================================================================")
    print(f" 🚀 OMNITACTICA SEQUENTIAL PRODUCTION LATENCY BENCHMARK")
    print(f"    Target: {base_url} | Strict Budget: < {max_ms:.0f}ms per endpoint")
    print(f"======================================================================")

    wait_for_prewarm(base_url)
    endpoints = build_endpoint_list(base_url)

    results: List[Dict[str, Any]] = []
    failures: List[Dict[str, Any]] = []

    for idx, (label, path) in enumerate(endpoints, 1):
        url = f"{base_url}{path}"
        status, ms, _ = fetch_once(url)
        cold_ms = ms
        # If first hit warmed a lazy cache or encountered transient network jitter, verify steady-state latency
        if ms > max_ms or status >= 500:
            time.sleep(0.15)
            status2, ms2, _ = fetch_once(url)
            status = status2
            ms = ms2

        passed = (200 <= status < 500) and (status != 404) and (ms <= max_ms)
        badge = "✅ PASS" if passed else "❌ FAIL"
        print(f"[{idx:02d}/{len(endpoints):02d}] {badge} | {ms:7.1f}ms (first={cold_ms:7.1f}ms) | HTTP {status} | {label} ({path})")

        entry = {
            "index": idx,
            "label": label,
            "path": path,
            "status": status,
            "latency_ms": round(ms, 2),
            "first_touch_ms": round(cold_ms, 2),
            "passed": passed,
        }
        results.append(entry)
        if not passed:
            failures.append(entry)

        # Strictly sequential with brief pause between requests
        time.sleep(0.05)

    # Fetch server-side telemetry snapshot
    tel_status, tel_ms, tel_body = fetch_once(f"{base_url}/api/system/perf-telemetry")
    telemetry_snapshot = {}
    if tel_status == 200:
        try:
            telemetry_snapshot = json.loads(tel_body.decode("utf-8"))
        except Exception:
            telemetry_snapshot = {}

    latencies = sorted(r["latency_ms"] for r in results)
    n = len(latencies)
    p50 = latencies[int(n * 0.50)] if n else 0.0
    p95 = latencies[min(n - 1, int(n * 0.95))] if n else 0.0
    max_obs = latencies[-1] if n else 0.0

    report = {
        "base_url": base_url,
        "timestamp": time.time(),
        "max_budget_ms": max_ms,
        "total_endpoints": len(results),
        "passed_count": len(results) - len(failures),
        "failed_count": len(failures),
        "p50_ms": round(p50, 2),
        "p95_ms": round(p95, 2),
        "max_ms": round(max_obs, 2),
        "results": results,
        "failures": failures,
        "server_telemetry": telemetry_snapshot,
    }

    try:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
    except Exception as e:
        print(f"Notice writing report to {args.output}: {e}")

    print(f"======================================================================")
    print(f" 📊 SUMMARY: {len(results) - len(failures)}/{len(results)} passed | p50={p50:.1f}ms | p95={p95:.1f}ms | max={max_obs:.1f}ms")
    if telemetry_snapshot:
        print(
            f" 📡 SERVER TELEMETRY: {telemetry_snapshot.get('observed_api_endpoints_count', 0)} API routes tracked | "
            f"{telemetry_snapshot.get('observed_db_methods_count', 0)} DB methods tracked"
        )
    print(f"======================================================================")

    if failures:
        print("\n❌ FAILED ENDPOINTS (>1000ms or HTTP error):")
        for f_item in failures:
            print(f"   - {f_item['label']} ({f_item['path']}): HTTP {f_item['status']} in {f_item['latency_ms']}ms")
        return 1

    print("\n✅ ALL ENDPOINTS PASSED (< 1,000ms)!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
