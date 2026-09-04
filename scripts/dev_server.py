#!/usr/bin/env python3
"""
Lightweight development server for OmniTactica and Warhammer 40k Game Tracker.
Uses only Python standard library (no external dependencies required).
"""

import http.server
import os
import sys
import json
import mimetypes
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 5174))
HOST = "0.0.0.0"

REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = REPO_ROOT / "web"
TRACKER_DIR = WEB_DIR / "tracker"
TRACKER_STATIC_DIR = TRACKER_DIR / "static"

ROOMS_DB = {}

DEV_USER = {
    "authenticated": True,
    "user": {
        "id": "dev_commander",
        "username": "Commander",
        "display_name": "Commander",
        "email": "commander@omnitactica.com",
        "role": "admin"
    }
}

AUTH_INJECTION = """<script>
  (function() {
    try {
      localStorage.setItem('elo_auth_token', 'dev-auth-token-123');
      localStorage.setItem('native_session_token', 'dev-auth-token-123');
      sessionStorage.setItem('elo_auth_token', 'dev-auth-token-123');
      document.cookie = 'session_token=dev-auth-token-123; path=/; max-age=2592000; SameSite=Lax';
    } catch (e) {}
  })();
</script>
"""

class OmniTacticaDevHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_HEAD(self):
        self._handle_request(is_head=True)

    def do_GET(self):
        self._handle_request(is_head=False)

    def do_POST(self):
        clean_path = self.path.split("?")[0].strip("/")
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length > 0 else b"{}"

        if clean_path in ("api/auth/login", "api/auth/register"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Set-Cookie", "session_token=dev-auth-token-123; path=/; max-age=2592000; SameSite=Lax")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "token": "dev-auth-token-123", **DEV_USER}).encode("utf-8"))
            return

        if clean_path == "api/tracker/room/create":
            match_id = "WH40K-DEV1"
            res = {
                "success": True,
                "match_id": match_id,
                "role": "player1",
                "p1_name": "Player 1",
                "p2_name": "Player 2",
                "state": None
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if clean_path.startswith("api/tracker/"):
            try:
                payload = json.loads(body.decode("utf-8"))
            except Exception:
                payload = {}

            room_id = clean_path.replace("api/tracker/", "").replace("room/", "").strip("/")
            if room_id:
                ROOMS_DB[room_id] = payload

            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "match_id": room_id or "WH40K-DEV1"}).encode("utf-8"))
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(b'{"status": "ok"}')

    def _handle_request(self, is_head=False):
        raw_path = self.path.split("?")[0]
        query_str = self.path.split("?")[1] if "?" in self.path else ""
        clean_path = raw_path.strip("/")

        # 1. API routes
        if clean_path in ("api/auth/me", "api/auth/session"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(DEV_USER).encode("utf-8"))
            return

        if clean_path in ("api/tracker/history",):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"success": True, "history": []}).encode("utf-8"))
            return

        if clean_path.endswith("/check"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"success": True, "exists": True, "is_finished": False}).encode("utf-8"))
            return

        if clean_path.startswith("api/player/"):
            import urllib.parse
            pid = urllib.parse.unquote(clean_path.replace("api/player/", "").strip("/"))
            if "john" in pid.lower():
                res = {
                    "player": {
                        "player_id": "p_john_doe",
                        "player_name": "John Doe",
                        "team": "Team Zero Comp",
                        "teams_history": ["Team Zero Comp"],
                        "top_faction": "Adeptus Astartes, Necrons",
                        "current_elo": 1650.0,
                        "peak_elo": 1680.0,
                        "wins": 45,
                        "losses": 20,
                        "draws": 1,
                        "win_rate": 68.2,
                        "total_matches": 66
                    },
                    "has_account": False,
                    "longest_win_streak": 8,
                    "history": []
                }
            else:
                # Default to Folger Pyles profile matching the user's test scenario
                res = {
                    "player": {
                        "player_id": "p_folger_pyles",
                        "player_name": "Folger Pyles",
                        "team": "Art of War",
                        "teams_history": [
                            "Art of War",
                            "Team USA",
                            "Gem Wargaming",
                            "Battle Brothers Wargaming",
                            "Bookery Battle Brothers",
                            "Gemhammer",
                            "Watchers in the dark"
                        ],
                        "top_faction": "Adeptus Custodes, Aeldari, Necrons, Drukhari, Imperial Agents, Chaos Space Marines, Ynnari, Death Guard, World Eaters",
                        "current_elo": 2495.2,
                        "peak_elo": 2495.2,
                        "wins": 290,
                        "losses": 30,
                        "draws": 2,
                        "win_rate": 90.1,
                        "total_matches": 322
                    },
                    "has_account": False,
                    "longest_win_streak": 36,
                    "history": [
                        {
                            "match_date": "2022-04-16",
                            "event_name": "GemHammer RTT April 2022",
                            "round": "R1",
                            "result": "W",
                            "player_score": 69,
                            "opponent_score": 63,
                            "player_faction": "Adeptus Custodes",
                            "opponent_name": "GemHammer RTT April 2022",
                            "opponent_elo": 1820.0,
                            "delta_elo": 12.4,
                            "new_elo": 2495.2
                        },
                        {
                            "match_date": "2022-04-16",
                            "event_name": "GemHammer RTT April 2022",
                            "round": "R2",
                            "result": "L",
                            "player_score": 61,
                            "opponent_score": 72,
                            "player_faction": "Adeptus Custodes",
                            "opponent_name": "Opponent",
                            "opponent_elo": 1900.0,
                            "delta_elo": -8.1,
                            "new_elo": 2487.1
                        }
                    ]
                }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if clean_path in ("api/leaderboard", "api/players", "api/events", "api/teams", "api/community/feed", "api/notifications/unread-count"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"players": [], "events": [], "teams": [], "count": 0}).encode("utf-8"))
            return

        if clean_path.startswith("api/tracker/"):
            room_id = clean_path.replace("api/tracker/", "").replace("room/", "").strip("/")
            data = ROOMS_DB.get(room_id, {})
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"success": True, "match_id": room_id or "WH40K-DEV1", "data": data, "state": None}).encode("utf-8"))
            return

        if clean_path in ("app", "app.html"):
            self._serve_html_with_auth(WEB_DIR / "app.html", is_head)
            return

        # 2. Redirects to /11th/tracker/play
        # Ensuring the URL has /play guarantees isPlay=true in tracker_sync.js
        if clean_path in ("", "login", "tracker", "11th/tracker"):
            target = f"/11th/tracker/play{('?' + query_str) if query_str else ''}"
            self.send_response(302)
            self.send_header("Location", target)
            self.send_header("Set-Cookie", "session_token=dev-auth-token-123; path=/; max-age=2592000; SameSite=Lax")
            self.end_headers()
            return

        # 3. Game Tracker Play SPA
        if clean_path in ("11th/tracker/play", "tracker/play"):
            self._serve_html_with_auth(TRACKER_DIR / "play.html", is_head)
            return

        if clean_path in ("11th/tracker/lobby", "tracker/lobby"):
            self._serve_html_with_auth(TRACKER_DIR / "lobby.html", is_head)
            return

        # 4. Bundle & Sync Assets
        if clean_path in ("tracker/bundle.js", "11th/tracker/bundle.js", "bundle.js"):
            self._serve_file(TRACKER_DIR / "bundle.js", "application/javascript; charset=utf-8", is_head)
            return

        if clean_path in ("tracker/tracker_sync.js", "11th/tracker/tracker_sync.js"):
            self._serve_file(TRACKER_DIR / "tracker_sync.js", "application/javascript; charset=utf-8", is_head)
            return

        if clean_path in ("tracker/tracker_sync.css", "11th/tracker/tracker_sync.css"):
            self._serve_file(TRACKER_DIR / "tracker_sync.css", "text/css; charset=utf-8", is_head)
            return

        # 5. _next static assets
        if clean_path.startswith("_next/"):
            rel = clean_path.replace("_next/", "")
            target = TRACKER_STATIC_DIR / "_next" / rel
            if target.is_file():
                self._serve_file(target, is_head=is_head)
                return
            fallback = REPO_ROOT.parent / "gdm-tracker-standalone" / "_next" / rel
            if fallback.is_file():
                self._serve_file(fallback, is_head=is_head)
                return

        # 6. Direct file resolution in WEB_DIR
        local_web = WEB_DIR / clean_path
        if local_web.is_file():
            self._serve_file(local_web, is_head=is_head)
            return

        # 7. Check in TRACKER_STATIC_DIR
        local_static = TRACKER_STATIC_DIR / clean_path
        if local_static.is_file():
            self._serve_file(local_static, is_head=is_head)
            return

        # Fallback to play.html
        self._serve_html_with_auth(TRACKER_DIR / "play.html", is_head)

    def _serve_html_with_auth(self, file_path: Path, is_head=False):
        if not file_path.is_file():
            self.send_error(404, f"File Not Found: {file_path.name}")
            return
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()

            if "<head>" in content:
                content = content.replace("<head>", f"<head>\n{AUTH_INJECTION}", 1)

            encoded = content.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Set-Cookie", "session_token=dev-auth-token-123; path=/; max-age=2592000; SameSite=Lax")
            self.end_headers()
            if not is_head:
                self.wfile.write(encoded)
        except Exception as e:
            self.send_error(500, f"Internal Server Error: {e}")

    def _serve_file(self, file_path: Path, content_type: str = None, is_head=False):
        if not file_path.is_file():
            self.send_error(404, f"File Not Found: {file_path.name}")
            return
        
        if not content_type:
            content_type, _ = mimetypes.guess_type(str(file_path))
            if not content_type:
                content_type = "application/octet-stream"

        try:
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            if not is_head:
                self.wfile.write(content)
        except Exception as e:
            self.send_error(500, f"Internal Server Error: {e}")

class ThreadedHTTPServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

def main():
    print(f"--> Starting OmniTactica Game Tracker dev server on http://{HOST}:{PORT}")
    print(f"    Serving web directory: {WEB_DIR}")
    print(f"    Proxy URL: http://hsiehjun-high-perf-2.c.googlers.com:{PORT}/11th/tracker/play")
    httpd = ThreadedHTTPServer((HOST, PORT), OmniTacticaDevHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("--> Shutting down server.")
    finally:
        httpd.server_close()

if __name__ == "__main__":
    main()
