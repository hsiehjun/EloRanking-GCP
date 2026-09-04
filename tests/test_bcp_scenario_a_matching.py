"""
Comprehensive Unit & Integration Test Suite for Scenario A:
Automated on BCP Link (Silent / Seamless) Competitor Resolution

Verifies:
1. Will Trovato BCP Link (given_name="Will", family_name="Trovato") updates display_name to "Will Trovato" and links player_id "5ODCSZURyN".
2. Match volume tie-breaking: 5ODCSZURyN (212 matches) is selected over 7 duplicate 0-match rows in public.players.
3. Competitor Hub dashboard hydration: Will's dashboard lights up with 212 matches, 1739.77 Elo, and Custodes stats.
4. Bidirectional prefix matching (Will -> William, William -> Will) without brittle dictionaries.
5. Dan -> Daniel and Chris -> Christopher prefix resolution without dictionaries.
6. Direct 10-character player ID matching.
7. Graceful fallback for unknown competitors (Cognito UUID preserved safely).
8. Tokenized multi-word autocomplete search in database.py (search_players("Will Trovato") -> William Trovato).
9. Tokenized multi-word directory filtering in database.py (get_players_directory).
10. Account settings auto-link and dashboard self-healing for previously unlinked UUIDs.
"""

import sys
import json
import base64
from pathlib import Path
from unittest.mock import MagicMock, patch

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from auth import AuthManager, _decode_jwt_payload
from database import PostgresDatabase

# Sample rows from public.players as reported from production
SAMPLE_PLAYERS = [
    {"id": "TENiGWKmO7pK", "first_name": "William", "last_name": "Trovato", "full_name": "William Trovato", "team": "Team Zero Comp"},
    {"id": "EX33F6KHYR", "first_name": "Will", "last_name": "Trovato", "full_name": "Will Trovato", "team": "Team Zero Comp"},
    {"id": "19F8VUF2Q1", "first_name": "Will", "last_name": "Trovato", "full_name": "Will Trovato", "team": None},
    {"id": "0J10V9TY12", "first_name": "Will", "last_name": "Trovato", "full_name": "Will Trovato", "team": "Team Zero Comp"},
    {"id": "5ODCSZURyN", "first_name": "Will", "last_name": "Trovato", "full_name": "Will Trovato", "team": "Team Zero Comp"},
    {"id": "Y5RU7L92U0", "first_name": "Will", "last_name": "Trovato", "full_name": "Will Trovato", "team": "Team Zero Comp"},
    {"id": "AUX4YDP55G", "first_name": "Will", "last_name": "Trovato", "full_name": "Will Trovato", "team": "Team Zero Comp"},
    {"id": "LYQUT7TG7A", "first_name": "Will", "last_name": "Trovato", "full_name": "Will Trovato", "team": "Team Zero Comp"},
    {"id": "DAN_SMITH_99", "first_name": "Daniel", "last_name": "Smith", "full_name": "Daniel Smith", "team": "Team Silver"},
    {"id": "CHRIS_JONES_88", "first_name": "Christopher", "last_name": "Jones", "full_name": "Christopher Jones", "team": "Waaagh Boys"},
]

# Sample rows in public.player_ratings
SAMPLE_PLAYER_RATINGS = [
    {
        "player_id": "5ODCSZURyN",
        "player_name": "William Trovato",
        "current_elo": 1739.77,
        "peak_elo": 1837.83,
        "matches_played": 212,
        "wins": 132,
        "losses": 69,
        "draws": 11,
        "win_rate": 62.3,
        "top_faction": "Adeptus Custodes",
        "team": "Team Zero Comp",
        "last_active_date": "2026-09-03"
    },
    {
        "player_id": "MEV83VFANA",
        "player_name": "Jun Hsieh",
        "current_elo": 1650.0,
        "peak_elo": 1700.0,
        "matches_played": 50,
        "wins": 30,
        "losses": 18,
        "draws": 2,
        "win_rate": 60.0,
        "top_faction": "Aeldari",
        "team": "Team Alpha",
        "last_active_date": "2026-09-01"
    },
    {
        "player_id": "DAN_SMITH_99",
        "player_name": "Daniel Smith",
        "current_elo": 1800.0,
        "peak_elo": 1850.0,
        "matches_played": 100,
        "wins": 70,
        "losses": 30,
        "draws": 0,
        "win_rate": 70.0,
        "top_faction": "Necrons",
        "team": "Team Silver",
        "last_active_date": "2026-09-01"
    },
    {
        "player_id": "CHRIS_JONES_88",
        "player_name": "Christopher Jones",
        "current_elo": 1750.0,
        "peak_elo": 1780.0,
        "matches_played": 80,
        "wins": 55,
        "losses": 25,
        "draws": 0,
        "win_rate": 68.8,
        "top_faction": "Orks",
        "team": "Waaagh Boys",
        "last_active_date": "2026-09-02"
    }
]

def make_jwt(payload: dict) -> str:
    h = base64.urlsafe_b64encode(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()).decode().rstrip("=")
    p = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return f"{h}.{p}.fake_sig"


class MockDBEnvironment:
    """In-memory simulated PostgreSQL database for Auth and Database tests."""
    def __init__(self):
        self.players = [dict(p) for p in SAMPLE_PLAYERS]
        self.player_ratings = [dict(pr) for pr in SAMPLE_PLAYER_RATINGS]
        self.users = {
            "user-will-1": {
                "id": "user-will-1",
                "email": "will.trovato@example.com",
                "password_hash": "hash123",
                "display_name": "Will",
                "role": "player",
                "player_id": None,
                "bcp_user_id": None,
                "bcp_email": None,
                "bcp_access_token": None,
                "bcp_id_token": None,
                "bcp_refresh_token": None,
                "bcp_linked_at": None,
            }
        }
        self.sessions = {}

    def get_connection(self):
        env = self
        class ConnContext:
            def __enter__(self):
                return MockConn(env)
            def __exit__(self, exc_type, exc_val, exc_tb):
                pass
        return ConnContext()


class MockConn:
    def __init__(self, env):
        self.env = env

    def cursor(self, cursor_factory=None):
        return MockCursor(self.env)

    def commit(self):
        pass


class MockCursor:
    def __init__(self, env):
        self.env = env
        self._last_result = []
        self._idx = 0
        self.rowcount = 1

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass

    def execute(self, query, params=None):
        params = params or ()
        q = query.strip()

        # 1. find_matching_competitor direct player_ratings check
        if "FROM player_ratings" in q and "WHERE player_id = %s" in q and "SELECT player_id, player_name, COALESCE(matches_played" in q:
            pid = params[0]
            matched = [pr for pr in self.env.player_ratings if pr["player_id"] == pid]
            self._last_result = matched
            self._idx = 0
            return

        # 2. find_matching_competitor UNION query
        if "SELECT player_id, player_name, matches_played, current_elo" in q and "FROM (" in q and "UNION" in q:
            last_p = str(params[0]).replace("%", "").lower()
            first_p = str(params[2]).replace("%", "").lower()
            first_prefix = str(params[3]).replace("%", "").lower()

            candidates = []
            # Source 1: players joined with player_ratings
            for p in self.env.players:
                p_last = (p.get("last_name") or "").lower()
                p_full = (p.get("full_name") or "").lower()
                p_first = (p.get("first_name") or "").lower()

                pr_match = next((pr for pr in self.env.player_ratings if pr["player_id"] == p["id"]), None)
                pr_name = (pr_match["player_name"] if pr_match else "").lower()

                match_last = (last_p in p_last) or (last_p in p_full)
                match_first = (p_first.startswith(first_p) or p_first.startswith(first_prefix) or 
                               p_full.startswith(first_p) or pr_name.startswith(first_p) or (first_prefix in pr_name))

                if match_last and match_first:
                    candidates.append({
                        "player_id": p["id"],
                        "player_name": pr_match["player_name"] if pr_match else p["full_name"],
                        "matches_played": pr_match["matches_played"] if pr_match else 0,
                        "current_elo": pr_match["current_elo"] if pr_match else 1500.0
                    })

            # Source 2: player_ratings directly
            for pr in self.env.player_ratings:
                pr_name = pr["player_name"].lower()
                match_last = last_p in pr_name
                match_first = (pr_name.startswith(first_p) or pr_name.startswith(first_prefix) or 
                               (first_p in pr_name) or (first_prefix in pr_name))
                if match_last and match_first:
                    candidates.append({
                        "player_id": pr["player_id"],
                        "player_name": pr["player_name"],
                        "matches_played": pr["matches_played"],
                        "current_elo": pr["current_elo"]
                    })

            # Sort by matches_played DESC, current_elo DESC
            candidates.sort(key=lambda x: (x["matches_played"], x["current_elo"]), reverse=True)
            seen_pids = set()
            deduped = []
            for c in candidates:
                if c["player_id"] not in seen_pids:
                    seen_pids.add(c["player_id"])
                    deduped.append(c)

            self._last_result = deduped[:1]
            self._idx = 0
            return

        # 3. 1-to-1 BCP account conflict check
        if "SELECT id, email, display_name FROM users" in q and "bcp_user_id = %s" in q:
            bcp_uid = params[0]
            target_uid = params[-1]
            conflicts = [u for u in self.env.users.values() if u.get("bcp_user_id") == bcp_uid and u["id"] != target_uid]
            self._last_result = conflicts
            self._idx = 0
            return

        # 4. UPDATE users SET
        if "UPDATE users SET" in q:
            if "bcp_access_token" in q:
                disp_name, pid, bcp_uid, bcp_email, acc_tok, id_tok, ref_tok, uid = params
                if uid in self.env.users:
                    u = self.env.users[uid]
                    if disp_name:
                        u["display_name"] = disp_name
                    u["player_id"] = pid
                    u["bcp_user_id"] = bcp_uid
                    u["bcp_email"] = bcp_email
                    u["bcp_access_token"] = acc_tok
                    u["bcp_id_token"] = id_tok
                    u["bcp_refresh_token"] = ref_tok
                    u["bcp_connected"] = True
            elif "player_id = %s WHERE id = %s" in q:
                pid, uid = params
                if uid in self.env.users:
                    self.env.users[uid]["player_id"] = pid
            elif "display_name = %s" in q:
                name_clean = params[0]
                pid = params[1] if len(params) > 2 else None
                uid = params[-1]
                if uid in self.env.users:
                    self.env.users[uid]["display_name"] = name_clean
                    if pid:
                        self.env.users[uid]["player_id"] = pid
            self._last_result = []
            self._idx = 0
            return

        # 5. SELECT from users (get_user_by_id)
        if "FROM users u" in q and "WHERE u.id = %s" in q:
            uid = params[0]
            u = self.env.users.get(uid)
            if u:
                row = dict(u)
                pid = u.get("player_id")
                pr = next((pr for pr in self.env.player_ratings if pr["player_id"] == pid), None)
                pl = next((p for p in self.env.players if p["id"] == pid), None)
                if pr:
                    row["competitor_name"] = pr["player_name"]
                    row["current_elo"] = pr["current_elo"]
                    row["peak_elo"] = pr["peak_elo"]
                    row["matches_played"] = pr["matches_played"]
                    row["wins"] = pr["wins"]
                    row["losses"] = pr["losses"]
                    row["win_rate"] = pr["win_rate"]
                    row["top_faction"] = pr["top_faction"]
                    row["team"] = pr["team"]
                elif pl:
                    row["competitor_name"] = pl["full_name"]
                    row["current_elo"] = 1500.0
                    row["peak_elo"] = 1500.0
                    row["matches_played"] = 0
                    row["wins"] = 0
                    row["losses"] = 0
                    row["win_rate"] = 0.0
                    row["top_faction"] = "General"
                    row["team"] = pl["team"]
                self._last_result = [row]
            else:
                self._last_result = []
            self._idx = 0
            return

        # 6. Competitor Hub: SELECT FROM player_ratings WHERE player_id = %s
        if "FROM player_ratings" in q and "WHERE player_id = %s" in q and "win_rate, top_faction" in q:
            pid = params[0]
            matched = [pr for pr in self.env.player_ratings if pr["player_id"] == pid]
            self._last_result = matched
            self._idx = 0
            return

        # 7. Autocomplete search_players
        if "FROM player_ratings" in q and "ORDER BY matches_played DESC" in q and "LIMIT %s" in q:
            limit = params[-1]
            if "WHERE (" in q and "AND" in q:
                tokens = [p.replace("%", "").lower() for p in params[:-2]]
                res = []
                for pr in self.env.player_ratings:
                    pr_name = pr["player_name"].lower()
                    if all(t in pr_name for t in tokens):
                        res.append(pr)
                res.sort(key=lambda x: (x["matches_played"], x["current_elo"]), reverse=True)
                self._last_result = res[:limit]
            else:
                q_term = str(params[0]).replace("%", "").lower()
                res = [pr for pr in self.env.player_ratings if q_term in pr["player_name"].lower() or pr["player_id"] == q_term]
                res.sort(key=lambda x: (x["matches_played"], x["current_elo"]), reverse=True)
                self._last_result = res[:limit]
            self._idx = 0
            return

        # 8. Directory count and select
        if "FROM player_ratings r" in q:
            if "total_count" in q:
                self._last_result = [{"total_count": len(self.env.player_ratings)}]
            else:
                # Directory rows
                tokens = [p.replace("%", "").lower() for p in params if isinstance(p, str) and "%" in p]
                res = []
                for pr in self.env.player_ratings:
                    if not tokens or all(t in pr["player_name"].lower() for t in tokens):
                        r = dict(pr)
                        r["has_account"] = False
                        r["account_user_id"] = None
                        res.append(r)
                self._last_result = res
            self._idx = 0
            return

        # 9. Rank queries
        if "as rank FROM player_ratings" in q:
            self._last_result = [{"rank": 1}]
            self._idx = 0
            return

        # 10. Update settings user password hash check
        if "SELECT id, password_hash FROM users WHERE id = %s" in q:
            uid = params[0]
            u = self.env.users.get(uid)
            self._last_result = [{"id": uid, "password_hash": u["password_hash"]}] if u else []
            self._idx = 0
            return

        self._last_result = []
        self._idx = 0

    def fetchone(self):
        if self._idx < len(self._last_result):
            r = self._last_result[self._idx]
            self._idx += 1
            return r
        return None

    def fetchall(self):
        res = self._last_result[self._idx:]
        self._idx = len(self._last_result)
        return res


def test_scenario_a_will_trovato_link():
    """Verify Scenario A: User clicks 'Connect BCP', receives Will Trovato, auto-resolves 5ODCSZURyN."""
    env = MockDBEnvironment()
    auth_mgr = AuthManager(env)

    token = make_jwt({
        "sub": "bcp-cognito-uuid-will-trovato-9876",
        "email": "will.trovato@example.com",
        "given_name": "Will",
        "family_name": "Trovato",
        "name": "Will Trovato"
    })

    res = auth_mgr.link_bcp_token("user-will-1", token)

    assert res["success"] is True, f"Link failed: {res}"
    assert res["player_id"] == "5ODCSZURyN", f"Expected 5ODCSZURyN, got {res['player_id']}"
    assert res["bcp_connected"] is True

    # Check updated user
    user = env.users["user-will-1"]
    assert user["display_name"] == "Will Trovato", f"Expected display_name 'Will Trovato', got {user['display_name']}"
    assert user["player_id"] == "5ODCSZURyN", f"Expected player_id '5ODCSZURyN', got {user['player_id']}"

    # Verify Competitor Hub lights up with Will's stats
    hub = auth_mgr.get_user_competitor_hub(player_id="5ODCSZURyN", user_id="user-will-1")
    player_stats = hub["player"]
    assert player_stats["player_id"] == "5ODCSZURyN"
    assert player_stats["player_name"] == "William Trovato"
    assert player_stats["matches_played"] == 212, f"Expected 212 matches, got {player_stats['matches_played']}"
    assert player_stats["current_elo"] == 1739.77, f"Expected 1739.77 Elo, got {player_stats['current_elo']}"
    assert player_stats["top_faction"] == "Adeptus Custodes"
    assert player_stats["team"] == "Team Zero Comp"
    print("✅ test_scenario_a_will_trovato_link passed: Resolved 5ODCSZURyN, 212 matches, 1739.77 Elo!")


def test_william_variant_resolves_cleanly():
    """Verify linking when BCP profile is registered as 'William Trovato'."""
    env = MockDBEnvironment()
    auth_mgr = AuthManager(env)

    token = make_jwt({
        "sub": "bcp-cognito-uuid-william-trovato-1111",
        "email": "william.trovato@example.com",
        "given_name": "William",
        "family_name": "Trovato",
        "name": "William Trovato"
    })

    res = auth_mgr.link_bcp_token("user-will-1", token)
    assert res["success"] is True
    assert res["player_id"] == "5ODCSZURyN"
    assert env.users["user-will-1"]["display_name"] == "William Trovato"
    print("✅ test_william_variant_resolves_cleanly passed!")


def test_dan_daniel_and_chris_christopher_prefix_matching():
    """Verify prefix matching resolves 'Dan Smith' -> 'Daniel Smith' and 'Chris Jones' -> 'Christopher Jones' without dictionaries."""
    env = MockDBEnvironment()
    auth_mgr = AuthManager(env)

    # Dan -> Daniel Smith
    token_dan = make_jwt({
        "sub": "uuid-dan-smith-1",
        "email": "dan@example.com",
        "given_name": "Dan",
        "family_name": "Smith",
        "name": "Dan Smith"
    })
    res_dan = auth_mgr.link_bcp_token("user-will-1", token_dan)
    assert res_dan["player_id"] == "DAN_SMITH_99", f"Expected DAN_SMITH_99, got {res_dan['player_id']}"

    # Chris -> Christopher Jones
    token_chris = make_jwt({
        "sub": "uuid-chris-jones-1",
        "email": "chris@example.com",
        "given_name": "Chris",
        "family_name": "Jones",
        "name": "Chris Jones"
    })
    res_chris = auth_mgr.link_bcp_token("user-will-1", token_chris)
    assert res_chris["player_id"] == "CHRIS_JONES_88", f"Expected CHRIS_JONES_88, got {res_chris['player_id']}"
    print("✅ test_dan_daniel_and_chris_christopher_prefix_matching passed without dictionaries!")


def test_match_volume_tie_breaker():
    """Verify that among the 8 Trovato rows, the active profile (212 matches) beats 0-match rows."""
    env = MockDBEnvironment()
    auth_mgr = AuthManager(env)

    with env.get_connection() as conn:
        with conn.cursor() as cur:
            cand = auth_mgr.find_matching_competitor(cur, first_name="Will", last_name="Trovato", full_name="Will Trovato")
            assert cand is not None
            assert cand["player_id"] == "5ODCSZURyN"
            assert cand["matches_played"] == 212
    print("✅ test_match_volume_tie_breaker passed: 5ODCSZURyN (212 matches) selected!")


def test_direct_id_match():
    """Verify that a direct 10-char player ID with match history returns immediately."""
    env = MockDBEnvironment()
    auth_mgr = AuthManager(env)

    token = make_jwt({
        "sub": "cognito-uuid-jun-4321",
        "email": "jun@example.com",
        "userId": "MEV83VFANA",
        "name": "Jun Hsieh"
    })

    res = auth_mgr.link_bcp_token("user-will-1", token)
    assert res["success"] is True
    assert res["player_id"] == "MEV83VFANA"
    print("✅ test_direct_id_match passed: MEV83VFANA resolved directly!")


def test_unknown_player_safe_fallback():
    """Verify unknown player with no rating history links safely using Cognito UUID without crash."""
    env = MockDBEnvironment()
    auth_mgr = AuthManager(env)

    unknown_sub = "unknown-uuid-brand-new-player-999"
    token = make_jwt({
        "sub": unknown_sub,
        "email": "newplayer@example.com",
        "name": "Brand New Player"
    })

    res = auth_mgr.link_bcp_token("user-will-1", token)
    assert res["success"] is True
    assert res["player_id"] == unknown_sub
    print("✅ test_unknown_player_safe_fallback passed!")


def test_database_search_players_multi_word_tokenized():
    """Verify search_players('Will Trovato') matches 'William Trovato' via tokenization."""
    env = MockDBEnvironment()
    db = PostgresDatabase.__new__(PostgresDatabase)
    db.get_connection = env.get_connection

    # Multi-token search
    results = db.search_players("Will Trovato")
    assert len(results) >= 1
    assert results[0]["player_id"] == "5ODCSZURyN"
    assert results[0]["player_name"] == "William Trovato"

    # Single-token search
    results_single = db.search_players("Trovato")
    assert len(results_single) >= 1
    assert results_single[0]["player_id"] == "5ODCSZURyN"
    print("✅ test_database_search_players_multi_word_tokenized passed: 'Will Trovato' found 'William Trovato'!")


def test_database_get_players_directory_tokenized():
    """Verify get_players_directory filters correctly with multi-word query."""
    env = MockDBEnvironment()
    db = PostgresDatabase.__new__(PostgresDatabase)
    db.get_connection = env.get_connection

    res = db.get_players_directory(query="Will Trovato")
    assert res["total"] >= 1
    matched = [p for p in res["items"] if p["player_id"] == "5ODCSZURyN"]
    assert len(matched) == 1
    print("✅ test_database_get_players_directory_tokenized passed!")


def test_settings_update_resolves_player_id():
    """Verify update_settings auto-links competitor when user updates display_name to Will Trovato."""
    env = MockDBEnvironment()
    auth_mgr = AuthManager(env)

    env.users["user-will-1"]["player_id"] = None
    res = auth_mgr.update_settings("user-will-1", display_name="Will Trovato")
    assert res["success"] is True
    assert env.users["user-will-1"]["player_id"] == "5ODCSZURyN"
    print("✅ test_settings_update_resolves_player_id passed!")


def test_competitor_hub_auto_healing():
    """Verify that if a user profile has a long UUID as player_id, get_user_competitor_hub auto-heals it."""
    env = MockDBEnvironment()
    auth_mgr = AuthManager(env)

    env.users["user-will-1"]["player_id"] = "bcp-cognito-uuid-will-trovato-9876"
    env.users["user-will-1"]["display_name"] = "Will Trovato"
    env.users["user-will-1"]["bcp_email"] = "will.trovato@example.com"

    hub = auth_mgr.get_user_competitor_hub(user_id="user-will-1")
    assert hub["player"]["player_id"] == "5ODCSZURyN"
    assert hub["player"]["matches_played"] == 212
    print("✅ test_competitor_hub_auto_healing passed: Self-healed UUID to 5ODCSZURyN!")


if __name__ == "__main__":
    test_scenario_a_will_trovato_link()
    test_william_variant_resolves_cleanly()
    test_dan_daniel_and_chris_christopher_prefix_matching()
    test_match_volume_tie_breaker()
    test_direct_id_match()
    test_unknown_player_safe_fallback()
    test_database_search_players_multi_word_tokenized()
    test_database_get_players_directory_tokenized()
    test_settings_update_resolves_player_id()
    test_competitor_hub_auto_healing()
    print("\n🎉 ALL 10 SCENARIO A TESTS PASSED 100%!")
