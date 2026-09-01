"""Native user accounts, authentication, and Best Coast Pairings account linking module."""

import base64
import hashlib
import json
import logging
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

try:
    from google3.experimental.users.hsiehjun.EloRanking.config import BCP_API_BASE, DEFAULT_HEADERS
    from google3.experimental.users.hsiehjun.EloRanking.database import Database, get_db
except ImportError:
    try:
        from experimental.users.hsiehjun.EloRanking.config import BCP_API_BASE, DEFAULT_HEADERS
        from experimental.users.hsiehjun.EloRanking.database import Database, get_db
    except ImportError:
        from config import BCP_API_BASE, DEFAULT_HEADERS
        from database import Database, get_db

logger = logging.getLogger("NativeAuth")

COGNITO_ENDPOINT = "https://cognito-idp.us-east-1.amazonaws.com/"
BCP_COGNITO_CLIENT_ID = "5083iih0nitpn5enl02fkpr9bc"


def _hash_password(password: str) -> str:
    """Hashes password using PBKDF2-HMAC-SHA256 with a unique random salt."""
    salt = secrets.token_hex(16)
    pw_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100_000)
    return f"{salt}:{pw_hash.hex()}"


def _verify_password(password: str, stored_hash: str) -> bool:
    """Verifies password against stored salt:hash."""
    try:
        salt, pw_hash = stored_hash.split(':')
        computed = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100_000)
        return secrets.compare_digest(computed.hex(), pw_hash)
    except Exception:
        return False


def _decode_jwt_payload(token: str) -> Dict[str, Any]:
    """Safely decodes JWT payload without external cryptography libraries."""
    try:
        parts = token.split(".")
        if len(parts) >= 2:
            payload_b64 = parts[1]
            padded = payload_b64 + "=" * ((4 - len(payload_b64) % 4) % 4)
            decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
            return json.loads(decoded)
    except Exception as e:
        logger.debug(f"JWT decode error: {e}")
    return {}


class AuthManager:
    _tables_initialized = False
    """Manages native user accounts, sessions, and BCP linked credentials."""

    def __init__(self, db: Optional[Database] = None):
        self.db = db or get_db()
        self.headers = DEFAULT_HEADERS.copy()
        if not AuthManager._tables_initialized:
            self._ensure_tables()
            AuthManager._tables_initialized = True

    def _ensure_tables(self):
        """Creates native users and sessions tables safely without heavy indexing locks."""
        try:
            with self.db.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                    CREATE TABLE IF NOT EXISTS users (
                        id VARCHAR(64) PRIMARY KEY,
                        email TEXT UNIQUE NOT NULL,
                        password_hash TEXT NOT NULL,
                        display_name TEXT NOT NULL,
                        role TEXT DEFAULT 'player',
                        player_id VARCHAR(64),
                        bcp_user_id VARCHAR(64),
                        bcp_email TEXT,
                        bcp_access_token TEXT,
                        bcp_id_token TEXT,
                        bcp_refresh_token TEXT,
                        bcp_token_expires_at TIMESTAMPTZ,
                        bcp_linked_at TIMESTAMPTZ,
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW()
                    );
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'player';
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS bcp_id_token TEXT;
                    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

                    -- Ensure primary administrator accounts have admin role
                    UPDATE users SET role = 'admin' WHERE LOWER(email) IN ('swimgeek751@gmail.com', 'hsiehjun@google.com', 'hsiehjun@gmail.com') AND role = 'player';

                    CREATE TABLE IF NOT EXISTS user_sessions (
                        session_token VARCHAR(64) PRIMARY KEY,
                        user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '60 days')
                    );
                    ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS user_id VARCHAR(64);
                    CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
                    """)
                conn.commit()
        except Exception as e:
            logger.debug(f"Ensure tables notice: {e}")

    def register(self, email: str, password: str, display_name: str) -> Dict[str, Any]:
        """Registers a new native user account."""
        email = email.strip().lower()
        display_name = display_name.strip()
        if not email or "@" not in email:
            return {"success": False, "error": "Please provide a valid email address."}
        if not password or len(password) < 6:
            return {"success": False, "error": "Password must be at least 6 characters."}
        if not display_name:
            display_name = email.split("@")[0]

        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("SELECT id FROM users WHERE email = %s;", (email,))
                if cur.fetchone():
                    return {"success": False, "error": "An account with this email already exists."}

                user_id = str(uuid.uuid4())
                pw_hash = _hash_password(password)

                # Match with local player database by display name
                cur.execute("SELECT player_id FROM player_ratings WHERE LOWER(player_name) = LOWER(%s) OR player_name ILIKE %s ORDER BY matches_played DESC LIMIT 1;", (display_name, f"%{display_name}%"))
                match_p = cur.fetchone()
                player_id = match_p["player_id"] if match_p else None

                cur.execute("""
                INSERT INTO users (id, email, password_hash, display_name, player_id, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, NOW(), NOW());
                """, (user_id, email, pw_hash, display_name, player_id))

                session_token = str(uuid.uuid4())
                cur.execute("""
                INSERT INTO user_sessions (session_token, user_id, created_at, expires_at)
                VALUES (%s, %s, NOW(), NOW() + INTERVAL '60 days');
                """, (session_token, user_id))
            conn.commit()

        user_info = self.get_user_by_id(user_id)
        return {
            "success": True,
            "session_token": session_token,
            "user": user_info
        }

    def login(self, email: str, password: str) -> Dict[str, Any]:
        """Authenticates native user with email and password."""
        email = email.strip().lower()
        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("SELECT id, password_hash FROM users WHERE email = %s;", (email,))
                row = cur.fetchone()
                if not row or not _verify_password(password, row["password_hash"]):
                    return {"success": False, "error": "Invalid email or password."}

                user_id = row["id"]
                session_token = str(uuid.uuid4())
                cur.execute("""
                INSERT INTO user_sessions (session_token, user_id, created_at, expires_at)
                VALUES (%s, %s, NOW(), NOW() + INTERVAL '60 days');
                """, (session_token, user_id))
            conn.commit()

        user_info = self.get_user_by_id(user_id)
        return {
            "success": True,
            "session_token": session_token,
            "user": user_info
        }

    def get_session(self, session_token: str) -> Optional[Dict[str, Any]]:
        """Retrieves user profile and BCP link status for active session token."""
        if not session_token:
            return None
        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("""
                SELECT u.id, u.email, u.display_name, u.role, u.player_id,
                       u.bcp_user_id, u.bcp_email, u.bcp_linked_at,
                       p.current_elo, p.peak_elo, p.top_faction, p.team
                FROM user_sessions s
                JOIN users u ON s.user_id = u.id
                LEFT JOIN player_ratings p ON u.player_id = p.player_id
                WHERE s.session_token = %s AND s.expires_at > NOW();
                """, (session_token,))
                row = cur.fetchone()
                if row:
                    data = dict(row)
                    data["session_token"] = session_token
                    data["role"] = data.get("role") or "player"
                    user_email = (data.get("email") or "").strip().lower()
                    if user_email in ('swimgeek751@gmail.com', 'hsiehjun@umich.edu', 'hsiehjun@google.com', 'hsiehjun@gmail.com'):
                        if data["role"] != "admin":
                            data["role"] = "admin"
                            try:
                                with conn.cursor() as up_cur:
                                    up_cur.execute("UPDATE users SET role = 'admin' WHERE id = %s;", (data.get("id"),))
                                    conn.commit()
                            except Exception:
                                pass
                    data["bcp_connected"] = bool(data.get("bcp_user_id"))
                    return data
        return None

    def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Fetches user dict by user ID."""
        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("""
                SELECT u.id, u.email, u.display_name, u.role, u.player_id,
                       u.bcp_user_id, u.bcp_email, u.bcp_linked_at,
                       p.current_elo, p.peak_elo, p.top_faction, p.team
                FROM users u
                LEFT JOIN player_ratings p ON u.player_id = p.player_id
                WHERE u.id = %s;
                """, (user_id,))
                row = cur.fetchone()
                if row:
                    data = dict(row)
                    data["role"] = data.get("role") or "player"
                    user_email = (data.get("email") or "").strip().lower()
                    if user_email in ('swimgeek751@gmail.com', 'hsiehjun@umich.edu', 'hsiehjun@google.com', 'hsiehjun@gmail.com'):
                        if data["role"] != "admin":
                            data["role"] = "admin"
                            try:
                                with conn.cursor() as up_cur:
                                    up_cur.execute("UPDATE users SET role = 'admin' WHERE id = %s;", (data.get("id"),))
                                    conn.commit()
                            except Exception:
                                pass
                    data["bcp_connected"] = bool(data.get("bcp_user_id"))
                    return data
        return None

    def set_user_role(self, email_or_id: str, role: str) -> bool:
        """Updates role for a user by email or user ID in PostgreSQL."""
        with self.db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                UPDATE users SET role = %s, updated_at = NOW() 
                WHERE LOWER(email) = LOWER(%s) OR id = %s;
                """, (role.lower(), email_or_id, email_or_id))
                conn.commit()
                return cur.rowcount > 0

    def update_settings(self, user_id: str, display_name: Optional[str] = None, old_password: Optional[str] = None, new_password: Optional[str] = None) -> Dict[str, Any]:
        """Updates user display name or password."""
        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("SELECT id, password_hash FROM users WHERE id = %s;", (user_id,))
                row = cur.fetchone()
                if not row:
                    return {"success": False, "error": "User not found."}

                updates = []
                params = []

                if display_name is not None and display_name.strip():
                    name_clean = display_name.strip()
                    updates.append("display_name = %s")
                    params.append(name_clean)
                    # Attempt to link player rating
                    cur.execute("SELECT player_id FROM player_ratings WHERE LOWER(player_name) = LOWER(%s) OR player_name ILIKE %s ORDER BY matches_played DESC LIMIT 1;", (name_clean, f"%{name_clean}%"))
                    match_p = cur.fetchone()
                    if match_p:
                        updates.append("player_id = %s")
                        params.append(match_p["player_id"])

                if new_password:
                    if not old_password or not _verify_password(old_password, row["password_hash"]):
                        return {"success": False, "error": "Current password is incorrect."}
                    if len(new_password) < 6:
                        return {"success": False, "error": "New password must be at least 6 characters."}
                    updates.append("password_hash = %s")
                    params.append(_hash_password(new_password))

                if not updates:
                    return {"success": True, "message": "No changes requested.", "user": self.get_user_by_id(user_id)}

                updates.append("updated_at = NOW()")
                params.append(user_id)
                cur.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = %s;", tuple(params))
            conn.commit()

        user_info = self.get_user_by_id(user_id)
        return {"success": True, "user": user_info}

    def logout(self, session_token: str) -> bool:
        """Terminates active session."""
        if not session_token:
            return True
        with self.db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM user_sessions WHERE session_token = %s;", (session_token,))
            conn.commit()
        return True

    # =========================================================================
    # BEST COAST PAIRINGS ACCOUNT LINKING & SILENT REFRESH
    # =========================================================================

    def link_bcp_account(self, user_id: str, bcp_email: str, bcp_password: str) -> Dict[str, Any]:
        """Links user's Best Coast Pairings account via Headless Browser with fallback to Cognito."""
        # 1. Attempt Headless Browser Automated Login (Native Web-App Session)
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser = p.chromium.launch(
                    headless=True,
                    args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process"]
                )
                context = browser.new_context(
                    user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
                )
                page = context.new_page()
                login_url = "https://auth.bestcoastpairings.com/login?client_id=web-app&response_type=code&scope=email+openid+profile+aws.cognito.signin.user.admin&redirect_uri=https://www.bestcoastpairings.com/"
                page.goto(login_url, wait_until="domcontentloaded", timeout=25000)

                email_input = page.wait_for_selector('input[type="email"], input[name="username"], input[name="email"], input[type="text"]', timeout=10000)
                if email_input:
                    email_input.fill(bcp_email.strip())

                pwd_input = page.wait_for_selector('input[type="password"]', timeout=5000)
                if pwd_input:
                    pwd_input.fill(bcp_password)

                submit_btn = page.wait_for_selector('button[type="submit"], button:has-text("Log In"), button:has-text("Sign In")', timeout=5000)
                if submit_btn:
                    submit_btn.click()

                try:
                    page.wait_for_url("**/bestcoastpairings.com/**", timeout=25000)
                    page.wait_for_timeout(3000)
                except Exception:
                    pass

                tokens = page.evaluate("""() => {
                    const r = {};
                    for (let i = 0; i < localStorage.length; i++) {
                        const k = localStorage.key(i);
                        if (k.includes('idToken')) r.id_token = localStorage.getItem(k);
                        if (k.includes('accessToken')) r.access_token = localStorage.getItem(k);
                        if (k.includes('refreshToken')) r.refresh_token = localStorage.getItem(k);
                    }
                    return r;
                }""")
                browser.close()

                if tokens.get("id_token") or tokens.get("access_token"):
                    logger.info(f"✅ Headless BCP Login succeeded for {bcp_email}")
                    return self.link_bcp_token(user_id, tokens)
        except Exception as pe:
            logger.info(f"Headless Playwright login notice: {pe}")

        # 2. Fallback to Direct Cognito Authentication
        payload = {
            "AuthFlow": "USER_PASSWORD_AUTH",
            "ClientId": BCP_COGNITO_CLIENT_ID,
            "AuthParameters": {
                "USERNAME": bcp_email.strip(),
                "PASSWORD": bcp_password
            }
        }

        req = urllib.request.Request(
            COGNITO_ENDPOINT,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/x-amz-json-1.1",
                "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth"
            },
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                auth_resp = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            logger.warning(f"Cognito Link HTTP {e.code}: {err_body}")
            return {"success": False, "error": "Incorrect Best Coast Pairings email or password. You can also use the 1-Line Browser Sync tab."}
        except Exception as e:
            return {"success": False, "error": f"Connection error to BCP Authentication: {str(e)}"}

        auth_result = auth_resp.get("AuthenticationResult") or {}
        id_token = auth_result.get("IdToken") or ""
        access_token = auth_result.get("AccessToken") or ""
        refresh_token = auth_result.get("RefreshToken") or ""

        claims = _decode_jwt_payload(id_token) if id_token else {}
        bcp_user_id = claims.get("sub") or claims.get("custom:userId") or bcp_email
        
        given_name = str(claims.get("given_name") or "").strip()
        family_name = str(claims.get("family_name") or "").strip()
        full_bcp_name = f"{given_name} {family_name}".strip()
        bcp_name = claims.get("name") or full_bcp_name or claims.get("nickname") or bcp_email.split("@")[0]

        # Match competitor in player_ratings database
        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                # 1. Match by BCP UUID
                cur.execute("SELECT player_id, player_name FROM player_ratings WHERE player_id = %s;", (bcp_user_id,))
                p_match = cur.fetchone()
                
                # 2. Match by exact or fuzzy name
                if not p_match and bcp_name:
                    cur.execute("SELECT player_id, player_name FROM player_ratings WHERE LOWER(player_name) = LOWER(%s) OR player_name ILIKE %s ORDER BY matches_played DESC LIMIT 1;", (bcp_name, f"%{bcp_name}%"))
                    p_match = cur.fetchone()

                pid = p_match["player_id"] if p_match else bcp_user_id
                official_name = (p_match["player_name"] if p_match else None) or bcp_name

                # Override name, player_id, and tokens
                cur.execute("""
                UPDATE users SET
                    display_name = COALESCE(NULLIF(%s, ''), display_name),
                    player_id = %s,
                    bcp_user_id = %s,
                    bcp_email = %s,
                    bcp_access_token = %s,
                    bcp_id_token = %s,
                    bcp_refresh_token = %s,
                    bcp_token_expires_at = (NOW() + INTERVAL '1 hour'),
                    bcp_linked_at = NOW(),
                    updated_at = NOW()
                WHERE id = %s;
                """, (official_name, pid, bcp_user_id, bcp_email.strip(), access_token or id_token, id_token or access_token, refresh_token, user_id))
            conn.commit()

        updated_user = self.get_user_by_id(user_id)
        return {
            "success": True,
            "bcp_connected": True,
            "bcp_email": bcp_email,
            "bcp_user_id": bcp_user_id,
            "player_id": pid,
            "user": updated_user
        }

    def link_bcp_token(self, user_id: str, token: str, refresh_token: Optional[str] = None) -> Dict[str, Any]:
        """Directly links verified BCP tokens (ID token, access token, and refresh token) to the user profile."""
        import base64, json
        
        raw_str = str(token).strip()
        parsed = {}
        if raw_str.startswith("{") and raw_str.endswith("}"):
            try:
                parsed = json.loads(raw_str)
            except Exception:
                pass

        id_tok = (parsed.get("id_token") or parsed.get("idToken")) if isinstance(parsed, dict) else None
        acc_tok = (parsed.get("access_token") or parsed.get("accessToken")) if isinstance(parsed, dict) else None
        ref_tok = ((parsed.get("refresh_token") or parsed.get("refreshToken")) if isinstance(parsed, dict) else None) or refresh_token

        primary_tok = id_tok or acc_tok or raw_str
        actual_id = id_tok or primary_tok
        actual_acc = acc_tok or primary_tok

        claims = _decode_jwt_payload(actual_id) or _decode_jwt_payload(actual_acc)
        logger.info(f"🔍 [BCP Token Link] User: {user_id}, ClientID: {parsed.get('client_id')}, Aud: {claims.get('aud') or claims.get('client_id')}, Sub: {claims.get('sub')}, Email: {claims.get('email')}")

        bcp_user_id = claims.get("sub") or claims.get("username")
        bcp_email = claims.get("email") or claims.get("bcpEmail") or ""
        pid = claims.get("userId") or claims.get("custom:userId")

        if not pid or len(str(pid)) > 15:
            if (bcp_email or "").strip().lower() == "swimgeek751@gmail.com":
                pid = "MEV83VFANA"
            else:
                try:
                    import urllib.request
                    u_url = f"https://newprod-api.bestcoastpairings.com/v1/users/{bcp_user_id}"
                    req = urllib.request.Request(u_url, headers={"Authorization": f"Bearer {actual_id}", "User-Agent": "OmniTactica/1.0"})
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        if resp.status == 200:
                            u_data = json.loads(resp.read().decode("utf-8"))
                            if isinstance(u_data, dict) and u_data.get("id"):
                                pid = str(u_data["id"])
                except Exception:
                    pass

        with self.db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                UPDATE users SET
                    bcp_user_id = COALESCE(%s, bcp_user_id),
                    player_id = COALESCE(%s, player_id),
                    bcp_email = COALESCE(NULLIF(%s, ''), bcp_email),
                    bcp_access_token = %s,
                    bcp_id_token = %s,
                    bcp_refresh_token = COALESCE(%s, bcp_refresh_token),
                    bcp_token_expires_at = (NOW() + INTERVAL '1 hour'),
                    bcp_linked_at = NOW(),
                    updated_at = NOW()
                WHERE id = %s;
                """, (bcp_user_id, pid, bcp_email, actual_acc, actual_id, ref_tok, user_id))
            conn.commit()

        updated_user = self.get_user_by_id(user_id)
        return {
            "success": True,
            "bcp_connected": True,
            "bcp_email": bcp_email,
            "bcp_user_id": bcp_user_id,
            "player_id": pid,
            "user": updated_user
        }

    def unlink_bcp_account(self, user_id: str) -> Dict[str, Any]:
        """Unlinks Best Coast Pairings account from user."""
        with self.db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                UPDATE users SET
                    bcp_user_id = NULL,
                    bcp_email = NULL,
                    bcp_access_token = NULL,
                    bcp_id_token = NULL,
                    bcp_refresh_token = NULL,
                    bcp_token_expires_at = NULL,
                    bcp_linked_at = NULL,
                    updated_at = NOW()
                WHERE id = %s;
                """, (user_id,))
            conn.commit()
        return {"success": True}

    def get_valid_bcp_tokens(self, user_id: str, force_refresh: bool = False) -> Dict[str, Optional[str]]:
        """Returns active BCP tokens (id_token, access_token), silently refreshing via refresh_token if needed."""
        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("""
                SELECT bcp_access_token, bcp_id_token, bcp_refresh_token, bcp_token_expires_at, bcp_user_id, bcp_email
                FROM users WHERE id = %s AND bcp_user_id IS NOT NULL;
                """, (user_id,))
                row = cur.fetchone()
                if not row:
                    return {"id_token": None, "access_token": None}

                acc_tok = row.get("bcp_access_token")
                id_tok = row.get("bcp_id_token") or acc_tok
                ref_tok = row.get("bcp_refresh_token")

                # If token still valid (>1 min remaining) and not forced, return what we have
                if not force_refresh and (id_tok or acc_tok):
                    check_tok = id_tok or acc_tok
                    claims = _decode_jwt_payload(check_tok) if check_tok else {}
                    exp = claims.get("exp")
                    now_ts = datetime.now(timezone.utc).timestamp()
                    if exp and exp > (now_ts + 60):
                        return {"id_token": id_tok, "access_token": acc_tok}
                    elif not exp and row.get("bcp_token_expires_at") and row["bcp_token_expires_at"] > datetime.now(timezone.utc):
                        return {"id_token": id_tok, "access_token": acc_tok}

                # Silent Background Refresh via BCP OAuth Token Endpoint
                if ref_tok:
                    oauth_payload = {
                        "grant_type": "refresh_token",
                        "refresh_token": ref_tok
                    }
                    oauth_req = urllib.request.Request(
                        "https://newprod-api.bestcoastpairings.com/oauth/token",
                        data=json.dumps(oauth_payload).encode("utf-8"),
                        headers={
                            "Content-Type": "application/json",
                            "client-id": "web-app",
                            "User-Agent": "Mozilla/5.0",
                            "Accept": "application/json"
                        },
                        method="POST"
                    )
                    try:
                        with urllib.request.urlopen(oauth_req, timeout=10) as resp:
                            data = json.loads(resp.read().decode("utf-8"))
                            new_acc = data.get("accessToken") or data.get("access_token")
                            new_id = data.get("idToken") or data.get("id_token") or new_acc
                            new_ref = data.get("refreshToken") or data.get("refresh_token") or ref_tok
                            if new_acc or new_id:
                                cur.execute("""
                                UPDATE users SET
                                    bcp_access_token = COALESCE(%s, bcp_access_token),
                                    bcp_id_token = COALESCE(%s, bcp_id_token),
                                    bcp_refresh_token = COALESCE(%s, bcp_refresh_token),
                                    bcp_token_expires_at = (NOW() + INTERVAL '1 hour'),
                                    updated_at = NOW()
                                WHERE id = %s;
                                """, (new_acc, new_id, new_ref, user_id))
                                conn.commit()
                                logger.info(f"✅ Successfully refreshed BCP tokens via /oauth/token for user {user_id}")
                                return {"id_token": new_id or id_tok, "access_token": new_acc or acc_tok}
                    except Exception as e:
                        logger.warning(f"BCP /oauth/token refresh notice for user {user_id}: {e}")

                return {"id_token": id_tok, "access_token": acc_tok}

    def get_valid_bcp_token(self, user_id: str, force_refresh: bool = False) -> Optional[str]:
        tokens = self.get_valid_bcp_tokens(user_id, force_refresh=force_refresh)
        return tokens.get("id_token") or tokens.get("access_token")

    def get_user_competitor_hub(self, player_id: Optional[str] = None, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Generates comprehensive personalized Competitor Hub analytics."""
        target_pid = player_id
        if not target_pid and user_id:
            u = self.get_user_by_id(user_id)
            if u:
                target_pid = u.get("player_id")

        if not target_pid:
            return {
                "player": {"player_name": "Competitor", "current_elo": 1500.0, "peak_elo": 1500.0, "win_rate": 0.0},
                "rankings": {},
                "history": [],
                "faction_mastery": [],
                "matchup_matrix": [],
                "events_attended": [],
                "upcoming_events": [],
                "rivals": []
            }

        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                # 1. Player Rating & World Rank
                cur.execute("""
                SELECT player_id, player_name, current_elo, peak_elo,
                       matches_played, wins, losses, draws, win_rate, top_faction, team, last_active_date
                FROM player_ratings
                WHERE player_id = %s;
                """, (target_pid,))
                p_stat = cur.fetchone() or {
                    "player_id": target_pid,
                    "player_name": "Competitor",
                    "current_elo": 1500.0,
                    "peak_elo": 1500.0,
                    "matches_played": 0,
                    "wins": 0,
                    "losses": 0,
                    "draws": 0,
                    "win_rate": 0.0,
                    "top_faction": "",
                    "team": ""
                }

                # Calculate Global & Faction Rank
                cur.execute("SELECT COUNT(*) + 1 as rank FROM player_ratings WHERE current_elo > %s AND matches_played >= 3;", (p_stat["current_elo"],))
                global_rank = cur.fetchone()["rank"]

                faction_rank = None
                if p_stat.get("top_faction"):
                    cur.execute("""
                    SELECT COUNT(*) + 1 as rank FROM player_ratings 
                    WHERE current_elo > %s AND top_faction ILIKE %s AND matches_played >= 3;
                    """, (p_stat["current_elo"], f"%{p_stat['top_faction']}%"))
                    faction_rank = cur.fetchone()["rank"]

                # 2. Rating History Trajectory
                cur.execute("""
                SELECT 
                    rh.match_date, rh.round, rh.old_elo, rh.new_elo, rh.delta_elo,
                    rh.result, rh.player_faction, rh.opponent_name, rh.opponent_elo, rh.opponent_faction,
                    rh.player_score, rh.opponent_score,
                    e.name as event_name, e.city, e.state, e.country, e.id as event_id
                FROM rating_history rh
                LEFT JOIN events e ON rh.event_id = e.id
                WHERE rh.player_id = %s
                ORDER BY rh.match_date ASC NULLS FIRST, rh.id ASC;
                """, (target_pid,))
                history_points = [dict(r) for r in cur.fetchall()]

                # 3. Faction Mastery Breakdown (Stats per army played)
                cur.execute("""
                WITH player_games AS (
                    SELECT player1_faction as faction, (winner_id = player1_id) as is_win, is_draw, player1_score as score
                    FROM matches WHERE player1_id = %s AND is_done = TRUE AND player1_faction IS NOT NULL AND TRIM(player1_faction) != ''
                    UNION ALL
                    SELECT player2_faction as faction, (winner_id = player2_id) as is_win, is_draw, player2_score as score
                    FROM matches WHERE player2_id = %s AND is_done = TRUE AND is_bye = FALSE AND player2_faction IS NOT NULL AND TRIM(player2_faction) != ''
                )
                SELECT 
                    faction,
                    COUNT(*) as games,
                    SUM(CASE WHEN is_win THEN 1 ELSE 0 END) as wins,
                    SUM(CASE WHEN NOT is_win AND NOT is_draw THEN 1 ELSE 0 END) as losses,
                    SUM(CASE WHEN is_draw THEN 1 ELSE 0 END) as draws,
                    ROUND((SUM(CASE WHEN is_win THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0))::numeric, 1) as win_rate,
                    ROUND(AVG(score)::numeric, 1) as avg_score
                FROM player_games
                GROUP BY faction
                ORDER BY games DESC, win_rate DESC;
                """, (target_pid, target_pid))
                faction_mastery = [dict(r) for r in cur.fetchall()]

                # 4. Opponent Matchup Matrix (Computed directly from rating_history for 100% fidelity)
                cur.execute("""
                SELECT 
                    COALESCE(NULLIF(TRIM(opponent_faction), ''), 'Unknown Faction') as enemy_faction,
                    COUNT(*) as total_encounters,
                    SUM(CASE WHEN result = 'W' THEN 1 ELSE 0 END) as wins,
                    SUM(CASE WHEN result = 'L' THEN 1 ELSE 0 END) as losses,
                    SUM(CASE WHEN result = 'D' THEN 1 ELSE 0 END) as draws,
                    ROUND((SUM(CASE WHEN result = 'W' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0))::numeric, 1) as win_rate
                FROM rating_history
                WHERE player_id = %s AND opponent_faction IS NOT NULL AND TRIM(opponent_faction) != ''
                GROUP BY COALESCE(NULLIF(TRIM(opponent_faction), ''), 'Unknown Faction')
                ORDER BY total_encounters DESC, win_rate DESC;
                """, (target_pid,))
                matchup_matrix = [dict(r) for r in cur.fetchall()]

                # 5. Tournaments Attended & Performance Summary (Optimized Subquery Join)
                cur.execute("""
                SELECT 
                    e.id as event_id, e.name as event_name, e.event_date, e.city, e.state, e.country,
                    e.total_players, e.num_rounds,
                    COALESCE(ep.faction, 'Unknown') as registered_faction,
                    COALESCE(m_stat.cnt, 0) as matches_played,
                    COALESCE(m_stat.wins, 0) as wins,
                    COALESCE(m_stat.losses, 0) as losses,
                    COALESCE(m_stat.draws, 0) as draws,
                    COALESCE(m_stat.battle_points, 0) as total_battle_points
                FROM event_participants ep
                JOIN events e ON ep.event_id = e.id
                LEFT JOIN (
                    SELECT 
                        event_id,
                        COUNT(*) as cnt,
                        SUM(CASE WHEN winner_id = %s THEN 1 ELSE 0 END) as wins,
                        SUM(CASE WHEN loser_id = %s THEN 1 ELSE 0 END) as losses,
                        SUM(CASE WHEN is_draw THEN 1 ELSE 0 END) as draws,
                        SUM(CASE WHEN player1_id = %s THEN COALESCE(player1_score, 0) ELSE COALESCE(player2_score, 0) END) as battle_points
                    FROM matches
                    WHERE player1_id = %s OR player2_id = %s
                    GROUP BY event_id
                ) m_stat ON e.id = m_stat.event_id
                WHERE ep.player_id = %s
                ORDER BY e.event_date DESC NULLS LAST;
                """, (target_pid, target_pid, target_pid, target_pid, target_pid, target_pid))
                events_attended = [dict(r) for r in cur.fetchall()]
                conn.commit()

        upcoming_events = []
        for ev in events_attended:
            ev_date_str = str(ev.get("event_date") or "")[:10]
            if ev_date_str >= datetime.now(timezone.utc).strftime("%Y-%m-%d"):
                upcoming_events.append(ev)

        # 5. Live Game Tracker Matches from 11th Edition /tracker
        tracker_history = []
        try:
            tracker_history = self.db.get_tracker_history(limit=50, user_id=user_id)
        except Exception as e:
            logger.debug(f"Tracker history error: {e}")

        return {
            "player": p_stat,
            "rankings": {
                "global_rank": global_rank,
                "faction_rank": faction_rank,
                "total_ranked_players": 77322
            },
            "history": history_points,
            "tracker_history": tracker_history,
            "faction_mastery": faction_mastery,
            "matchup_matrix": matchup_matrix,
            "events_attended": events_attended,
            "upcoming_events": upcoming_events
        }


# Global singleton
_auth_manager: Optional[AuthManager] = None


def get_auth_manager() -> AuthManager:
    global _auth_manager
    if _auth_manager is None:
        _auth_manager = AuthManager()
    return _auth_manager

# Backward compatibility alias
BCPAuthManager = AuthManager
