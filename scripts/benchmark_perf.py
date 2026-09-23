#!/usr/bin/env python3
import urllib.request
import time
import json

endpoints = [
    ("Leaderboard 40k", "/api/leaderboard"),
    ("Leaderboard AoS", "/api/leaderboard?game_system=aos"),
    ("Teams Leaderboard", "/api/leaderboard/teams"),
    ("Stats Overview", "/api/stats"),
    ("Factions Meta", "/api/factions/meta"),
    ("Player List", "/api/players?limit=25"),
    ("Player Search", "/api/players/search?q=Innes"),
    ("Player Profile", "/api/player/p_innes_wilson"),
    ("Team Roster (Zero Comp)", "/api/team/Team%20Zero%20Comp"),
    ("Team Roster (Art of War)", "/api/team/Art%20of%20War"),
    ("Recommended Events", "/api/events/recommended"),
    ("Live Event", "/api/event/ev_ongoing_gt_live"),
    ("Community Overview", "/api/community/overview"),
    ("Community Stores", "/api/community/stores"),
    ("Armory Catalog", "/api/armory/catalog"),
    ("Armory Vault", "/api/armory/vault"),
    ("Badges Catalog", "/api/badges/catalog"),
    ("Wahapedia Status", "/api/wahapedia/status"),
]

base = "http://localhost:5178"
print(f"{'Endpoint':<26} | {'Run 1 (Cold)':<12} | {'Run 2 (Warm)':<12} | {'Status':<6} | {'Integrity'}")
print("-" * 80)

for name, ep in endpoints:
    url = base + ep
    # Run 1
    t0 = time.time()
    req1 = urllib.request.Request(url, headers={"Authorization": "Bearer dev-auth-token-123"})
    with urllib.request.urlopen(req1) as r1:
        d1 = r1.read()
        dur1 = (time.time() - t0) * 1000
        code1 = r1.status

    # Run 2
    t1 = time.time()
    req2 = urllib.request.Request(url, headers={"Authorization": "Bearer dev-auth-token-123"})
    with urllib.request.urlopen(req2) as r2:
        d2 = r2.read()
        dur2 = (time.time() - t1) * 1000
        code2 = r2.status

    # Validate JSON integrity
    try:
        j1 = json.loads(d1.decode("utf-8"))
        valid = f"Valid JSON ({len(d1)}b)"
    except Exception as e:
        valid = f"Invalid: {e}"

    print(f"{name:<26} | {dur1:8.2f}ms   | {dur2:8.2f}ms   | {code1:<6} | {valid}")
