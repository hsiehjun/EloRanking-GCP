"""Native user accounts, authentication, and Best Coast Pairings account linking module."""
from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
import hashlib
import json
import logging
import os
import secrets
import time
from typing import Any, Callable, Dict, List, Optional, Set, Tuple, Union
import urllib.error
import urllib.parse
import urllib.request
import uuid

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

try:
    from email_service import send_password_reset_email, send_registration_verification_email
except ImportError:
    try:
        from google3.experimental.users.hsiehjun.EloRanking.email_service import send_password_reset_email, send_registration_verification_email
    except ImportError:
        def send_password_reset_email(*args, **kwargs):
            return {"success": True, "simulated": True}
        def send_registration_verification_email(*args, **kwargs):
            return {"success": True, "simulated": True}

try:
    import psycopg2
    from psycopg2 import extras, errors
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False
    class _DummyExtras:
        RealDictCursor = None
    class _DummyErrors:
        DeadlockDetected = type("DeadlockDetected", (Exception,), {})
        OperationalError = type("OperationalError", (Exception,), {})
    extras = _DummyExtras()
    errors = _DummyErrors()
    import sys
    if "psycopg2" not in sys.modules:
        import types
        _mod = types.ModuleType("psycopg2")
        _mod.extras = extras
        _mod.errors = errors
        sys.modules["psycopg2"] = _mod
        sys.modules["psycopg2.extras"] = extras
        sys.modules["psycopg2.errors"] = errors

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


def parse_device_info(ua_string: Optional[str]) -> str:
    """Parses a User-Agent string into a clean, human-readable device label."""
    if not ua_string:
        return "Unknown Device"
    ua = ua_string.lower()
    os_name = "Desktop"
    if "iphone" in ua:
        os_name = "iPhone"
    elif "ipad" in ua:
        os_name = "iPad"
    elif "android" in ua:
        os_name = "Android"
    elif "mac os" in ua or "macintosh" in ua:
        os_name = "Mac"
    elif "windows" in ua:
        os_name = "Windows"
    elif "linux" in ua:
        os_name = "Linux"

    browser = "Browser"
    if "edg/" in ua:
        browser = "Edge"
    elif "chrome/" in ua:
        browser = "Chrome"
    elif "safari/" in ua and "chrome/" not in ua:
        browser = "Safari"
    elif "firefox/" in ua:
        browser = "Firefox"

    return f"{os_name} • {browser}"


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
        """Creates native users and sessions tables safely without heavy indexing locks or deadlocks."""
        try:
            # Fast check: If users and user_sessions already exist and auth schema is ready, return immediately
            with self.db.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                    SELECT 
                        to_regclass('public.users') IS NOT NULL 
                        AND to_regclass('public.user_sessions') IS NOT NULL
                        AND to_regclass('public.system_settings') IS NOT NULL;
                    """)
                    row = cur.fetchone()
                    if row and row[0]:
                        cur.execute("SELECT value FROM system_settings WHERE key = 'auth_schema_ready';")
                        setting = cur.fetchone()
                        if setting and setting[0] == 'true':
                            return
        except Exception as e:
            logger.debug(f"Auth schema pre-check notice: {e}")

        # Acquire an advisory lock so only one worker runs DDL at a time
        try:
            with self.db.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT pg_try_advisory_lock(83921938);")
                    acquired = cur.fetchone()[0]
                    if not acquired:
                        logger.info("Another process is currently ensuring auth tables; skipping.")
                        return

                try:
                    # Run DDL table-by-table with short lock_timeout and individual commits
                    # to prevent multi-table exclusive lock accumulation and deadlocks.
                    table_statements = [
                        # Table: users
                        """
                        SET lock_timeout = '2s';
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
                        ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by_user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL;
                        ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code_used VARCHAR(64);
                        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
                        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_unique_bcp_user_id ON users(bcp_user_id) WHERE bcp_user_id IS NOT NULL AND bcp_user_id != '';
                        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_unique_bcp_email ON users(LOWER(bcp_email)) WHERE bcp_email IS NOT NULL AND bcp_email != '';
                        UPDATE users SET role = 'admin' WHERE LOWER(email) = 'swimgeek751@gmail.com';
                        """,
                        # Table: user_sessions
                        """
                        SET lock_timeout = '2s';
                        CREATE TABLE IF NOT EXISTS user_sessions (
                            session_token VARCHAR(64) PRIMARY KEY,
                            user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
                            created_at TIMESTAMPTZ DEFAULT NOW(),
                            expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '60 days')
                        );
                        ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS user_id VARCHAR(64);
                        ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
                        ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS ip_address TEXT;
                        ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT NOW();
                        CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
                        CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
                        """,
                        # Table: password_resets
                        """
                        SET lock_timeout = '2s';
                        CREATE TABLE IF NOT EXISTS password_resets (
                            id VARCHAR(64) PRIMARY KEY,
                            user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
                            email TEXT NOT NULL,
                            token VARCHAR(128) UNIQUE NOT NULL,
                            code VARCHAR(16) NOT NULL,
                            expires_at TIMESTAMPTZ NOT NULL,
                            used_at TIMESTAMPTZ,
                            created_at TIMESTAMPTZ DEFAULT NOW()
                        );
                        CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);
                        CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email);
                        CREATE INDEX IF NOT EXISTS idx_password_resets_code ON password_resets(code);
                        """,
                        # Table: pending_registrations
                        """
                        SET lock_timeout = '2s';
                        CREATE TABLE IF NOT EXISTS pending_registrations (
                            email TEXT PRIMARY KEY,
                            password_hash TEXT NOT NULL,
                            display_name TEXT NOT NULL,
                            verify_code VARCHAR(16) NOT NULL,
                            registration_token VARCHAR(128) NOT NULL,
                            expires_at TIMESTAMPTZ NOT NULL,
                            created_at TIMESTAMPTZ DEFAULT NOW()
                        );
                        ALTER TABLE pending_registrations ADD COLUMN IF NOT EXISTS invite_code VARCHAR(64);
                        CREATE INDEX IF NOT EXISTS idx_pending_reg_email ON pending_registrations(email);
                        CREATE INDEX IF NOT EXISTS idx_pending_reg_code ON pending_registrations(verify_code);
                        """,
                        # Table: invitation_codes
                        """
                        SET lock_timeout = '2s';
                        CREATE TABLE IF NOT EXISTS invitation_codes (
                            code VARCHAR(64) PRIMARY KEY,
                            created_by_user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
                            is_admin_code BOOLEAN DEFAULT FALSE,
                            is_active BOOLEAN DEFAULT TRUE,
                            max_uses INTEGER DEFAULT NULL,
                            use_count INTEGER DEFAULT 0,
                            created_at TIMESTAMPTZ DEFAULT NOW(),
                            expires_at TIMESTAMPTZ
                        );
                        CREATE INDEX IF NOT EXISTS idx_invitation_codes_creator ON invitation_codes(created_by_user_id);
                        CREATE INDEX IF NOT EXISTS idx_invitation_codes_active ON invitation_codes(is_active);
                        """,
                        # Table: invite_redemptions
                        """
                        SET lock_timeout = '2s';
                        CREATE TABLE IF NOT EXISTS invite_redemptions (
                            id VARCHAR(64) PRIMARY KEY,
                            code VARCHAR(64) REFERENCES invitation_codes(code) ON DELETE CASCADE,
                            invited_by_user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
                            new_user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
                            ip_address TEXT,
                            redeemed_at TIMESTAMPTZ DEFAULT NOW()
                        );
                        CREATE INDEX IF NOT EXISTS idx_redemptions_inviter ON invite_redemptions(invited_by_user_id);
                        CREATE INDEX IF NOT EXISTS idx_redemptions_new_user ON invite_redemptions(new_user_id);
                        CREATE INDEX IF NOT EXISTS idx_redemptions_code ON invite_redemptions(code);
                        """,
                        # Table: system_settings & mark ready
                        """
                        SET lock_timeout = '2s';
                        CREATE TABLE IF NOT EXISTS system_settings (
                            key VARCHAR(64) PRIMARY KEY,
                            value TEXT NOT NULL,
                            updated_at TIMESTAMPTZ DEFAULT NOW(),
                            updated_by_user_id VARCHAR(64)
                        );
                        ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS value TEXT;
                        ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
                        ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS updated_by_user_id VARCHAR(64);
                        INSERT INTO system_settings (key, value) VALUES ('invites_enabled', 'true') ON CONFLICT (key) DO NOTHING;
                        INSERT INTO system_settings (key, value) VALUES ('auth_schema_ready', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true';
                        """
                    ]

                    for stmt in table_statements:
                        try:
                            with conn.cursor() as cur:
                                cur.execute(stmt)
                            conn.commit()
                        except Exception as step_err:
                            conn.rollback()
                            logger.debug(f"Auth schema step notice (continuing): {step_err}")
                finally:
                    try:
                        with conn.cursor() as cur:
                            cur.execute("SELECT pg_advisory_unlock(83921938);")
                        conn.commit()
                    except Exception:
                        pass
        except Exception as e:
            logger.debug(f"Ensure tables notice: {e}")

    def get_system_setting(self, key: str, default: Optional[str] = None) -> Optional[str]:
        from psycopg2 import extras
        try:
            with self.db.get_connection() as conn:
                with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                    cur.execute("SELECT value FROM system_settings WHERE key = %s;", (key,))
                    row = cur.fetchone()
                    return str(row["value"]) if (row and row.get("value") is not None) else default
        except Exception:
            return default

    def set_system_setting(self, key: str, value: str, user_id: Optional[str] = None) -> bool:
        key = str(key).strip()
        val = str(value).strip().lower()
        try:
            with self.db.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                    INSERT INTO system_settings (key, value, updated_at, updated_by_user_id)
                    VALUES (%s, %s, NOW(), %s)
                    ON CONFLICT (key) DO UPDATE SET
                        value = EXCLUDED.value,
                        updated_at = NOW(),
                        updated_by_user_id = EXCLUDED.updated_by_user_id;
                    """, (key, val, user_id))
                conn.commit()
            logger.info(f"⚙️ System setting updated: {key} = {val}")
            return True
        except Exception as e:
            logger.error(f"Failed to set system setting {key} with user_id: {e}")
            try:
                with self.db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("""
                        INSERT INTO system_settings (key, value, updated_at)
                        VALUES (%s, %s, NOW())
                        ON CONFLICT (key) DO UPDATE SET
                            value = EXCLUDED.value,
                            updated_at = NOW();
                        """, (key, val))
                    conn.commit()
                logger.info(f"⚙️ System setting updated via fallback: {key} = {val}")
                return True
            except Exception as e2:
                logger.error(f"Fallback failed to set system setting {key}: {e2}")
                return False

    def are_registrations_open(self) -> bool:
        """Returns False if registrations have been locked by the administrator."""
        val = self.get_system_setting("invites_enabled", "true")
        if val is None:
            return True
        val_clean = str(val).strip().lower()
        return val_clean not in ("false", "0", "no", "off", "disabled")

    def validate_invite_code(self, code_str: str) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
        """Validates an invitation code against global settings, expiry, active status, and use limits."""
        # 1. Global kill switch check
        if not self.are_registrations_open():
            return False, "Account registration is currently locked by the administrator. All invitation codes are suspended.", None

        code_clean = (code_str or "").strip().upper()
        if not code_clean:
            return False, "An invitation code is required to register an account.", None

        from psycopg2 import extras
        try:
            with self.db.get_connection() as conn:
                with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                    cur.execute("""
                    SELECT code, created_by_user_id, is_admin_code, is_active, max_uses, use_count, expires_at
                    FROM invitation_codes
                    WHERE code = %s;
                    """, (code_clean,))
                    row = cur.fetchone()
                    if not row:
                        return False, f"Invalid invitation code '{code_clean}'. Please obtain a valid invite code from a current member.", None

                    if not row["is_active"]:
                        return False, f"Invitation code '{code_clean}' has been deactivated.", None

                    exp = row.get("expires_at")
                    if exp and exp < datetime.now(timezone.utc):
                        return False, f"Invitation code '{code_clean}' has expired.", None

                    max_u = row.get("max_uses")
                    use_c = row.get("use_count") or 0
                    if max_u is not None and use_c >= max_u:
                        return False, f"Invitation code '{code_clean}' has reached its maximum registration limit.", None

                    return True, None, dict(row)
        except Exception as e:
            logger.error(f"Error validating invite code: {e}")
            return False, "Error validating invitation code. Please try again.", None

    def register(self, email: str, password: str, display_name: str, invite_code: Optional[str] = None) -> Dict[str, Any]:
        """Registers a new native user account with 2FA email verification."""
        return self.initiate_registration(email, password, display_name, invite_code)

    def initiate_registration(self, email: str, password: str, display_name: str, invite_code: Optional[str] = None) -> Dict[str, Any]:
        """Initiates account registration and sends a 6-digit email verification code."""
        email = email.strip().lower()
        display_name = display_name.strip()
        if not email or "@" not in email:
            return {"success": False, "error": "Please provide a valid email address."}
        if not password or len(password) < 6:
            return {"success": False, "error": "Password must be at least 6 characters."}
        if not display_name:
            display_name = email.split("@")[0]

        # Validate Invitation Code
        invite_code_clean = (invite_code or "").strip().upper()
        is_valid, err_msg, code_rec = self.validate_invite_code(invite_code_clean)
        if not is_valid:
            return {"success": False, "error": err_msg}

        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("SELECT id FROM users WHERE email = %s;", (email,))
                if cur.fetchone():
                    return {"success": False, "error": "An account with this email already exists."}

                verify_code = f"{secrets.randbelow(900000) + 100000}"
                reg_token = str(uuid.uuid4())
                pw_hash = _hash_password(password)

                cur.execute("""
                INSERT INTO pending_registrations (email, password_hash, display_name, verify_code, registration_token, invite_code, expires_at, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, NOW() + INTERVAL '15 minutes', NOW())
                ON CONFLICT (email) DO UPDATE SET
                    password_hash = EXCLUDED.password_hash,
                    display_name = EXCLUDED.display_name,
                    verify_code = EXCLUDED.verify_code,
                    registration_token = EXCLUDED.registration_token,
                    invite_code = EXCLUDED.invite_code,
                    expires_at = NOW() + INTERVAL '15 minutes',
                    created_at = NOW();
                """, (email, pw_hash, display_name, verify_code, reg_token, invite_code_clean))
            conn.commit()

        # Dispatch email
        send_res = send_registration_verification_email(email, verify_code, display_name)
        logger.info(f"📧 Registration verification code generated for {email}: {verify_code}")

        return {
            "success": True,
            "requires_verification": True,
            "email": email,
            "registration_token": reg_token,
            "message": f"Verification code sent to {email}. Please enter the 6-digit code to activate your account."
        }

    def verify_registration_code(self, email: str, code: str, user_agent: Optional[str] = None, ip_address: Optional[str] = None) -> Dict[str, Any]:
        """Verifies the 6-digit code and creates the active user account."""
        if not self.are_registrations_open():
            return {"success": False, "error": "Account registration is currently locked by the administrator. All invitation codes are suspended."}

        email = email.strip().lower()
        code = str(code).strip()
        if not email or not code:
            return {"success": False, "error": "Email and 6-digit verification code are required."}

        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("""
                SELECT email, password_hash, display_name, verify_code, invite_code, expires_at
                FROM pending_registrations
                WHERE email = %s;
                """, (email,))
                row = cur.fetchone()

                if not row:
                    return {"success": False, "error": "No pending registration found for this email. Please register again."}

                if row["verify_code"] != code:
                    return {"success": False, "error": "Incorrect verification code. Please check your email and try again."}

                if row["expires_at"] < datetime.now(timezone.utc):
                    return {"success": False, "error": "Verification code has expired. Please request a new code."}

                # Check again if user was created in the meantime
                cur.execute("SELECT id FROM users WHERE email = %s;", (email,))
                if cur.fetchone():
                    return {"success": False, "error": "An account with this email already exists."}

                user_id = str(uuid.uuid4())
                display_name = row["display_name"]
                pw_hash = row["password_hash"]

                # Account creation never auto-links to a competitor profile; linking only occurs via explicit BCP connection
                player_id = None

                # Extract invite_code and resolve inviter_id
                invite_code = row.get("invite_code")
                inviter_id = None
                if invite_code:
                    cur.execute("SELECT created_by_user_id FROM invitation_codes WHERE code = %s;", (invite_code,))
                    c_row = cur.fetchone()
                    if c_row:
                        inviter_id = c_row.get("created_by_user_id")

                cur.execute("""
                INSERT INTO users (id, email, password_hash, display_name, role, player_id, invited_by_user_id, invite_code_used, created_at, updated_at)
                VALUES (%s, %s, %s, %s, 'player', %s, %s, %s, NOW(), NOW());
                """, (user_id, email, pw_hash, display_name, player_id, inviter_id, invite_code))

                # Track redemption and increment count
                if invite_code:
                    cur.execute("UPDATE invitation_codes SET use_count = use_count + 1 WHERE code = %s;", (invite_code,))
                    cur.execute("""
                    INSERT INTO invite_redemptions (id, code, invited_by_user_id, new_user_id, ip_address, redeemed_at)
                    VALUES (%s, %s, %s, %s, %s, NOW());
                    """, (str(uuid.uuid4()), invite_code, inviter_id, user_id, ip_address))

                session_token = str(uuid.uuid4())
                cur.execute("""
                INSERT INTO user_sessions (session_token, user_id, user_agent, ip_address, created_at, last_active_at, expires_at)
                VALUES (%s, %s, %s, %s, NOW(), NOW(), NOW() + INTERVAL '60 days');
                """, (session_token, user_id, user_agent, ip_address))

                # Clean up pending registration
                cur.execute("DELETE FROM pending_registrations WHERE email = %s;", (email,))
            conn.commit()

        user_info = self.get_user_by_id(user_id)
        logger.info(f"🎉 User {email} successfully registered and verified (ID: {user_id}, Code: {invite_code})")
        return {
            "success": True,
            "session_token": session_token,
            "user": user_info
        }

    def resend_registration_code(self, email: str) -> Dict[str, Any]:
        """Generates and dispatches a fresh 6-digit code for a pending registration."""
        email = email.strip().lower()
        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("SELECT display_name FROM pending_registrations WHERE email = %s;", (email,))
                row = cur.fetchone()
                if not row:
                    return {"success": False, "error": "No pending registration found for this email."}

                display_name = row["display_name"]
                new_code = f"{secrets.randbelow(900000) + 100000}"
                cur.execute("""
                UPDATE pending_registrations SET
                    verify_code = %s,
                    expires_at = NOW() + INTERVAL '15 minutes',
                    created_at = NOW()
                WHERE email = %s;
                """, (new_code, email))
            conn.commit()

        send_registration_verification_email(email, new_code, display_name)
        return {"success": True, "message": f"A new verification code has been sent to {email}."}

    def login(self, email: str, password: str, user_agent: Optional[str] = None, ip_address: Optional[str] = None) -> Dict[str, Any]:
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
                INSERT INTO user_sessions (session_token, user_id, user_agent, ip_address, created_at, last_active_at, expires_at)
                VALUES (%s, %s, %s, %s, NOW(), NOW(), NOW() + INTERVAL '60 days');
                """, (session_token, user_id, user_agent, ip_address))
            conn.commit()

        user_info = self.get_user_by_id(user_id)
        return {
            "success": True,
            "session_token": session_token,
            "user": user_info
        }

    # =========================================================================
    # PASSWORD RESET FLOW VIA EMAIL
    # =========================================================================

    def request_password_reset(self, email: str) -> Dict[str, Any]:
        """Initiates password reset flow by generating a secure token/code and dispatching email."""
        email = email.strip().lower()
        if not email or "@" not in email:
            return {"success": False, "error": "Please provide a valid email address."}

        from psycopg2 import extras
        user = None
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("SELECT id, email, display_name FROM users WHERE LOWER(email) = %s;", (email,))
                user = cur.fetchone()

        # To prevent account enumeration, return success even if user doesn't exist
        if not user:
            logger.info(f"Password reset requested for non-existent email: {email}")
            return {
                "success": True,
                "message": "If this email is registered, a password reset link and verification code has been dispatched."
            }

        user_id = user["id"]
        token = secrets.token_urlsafe(32)
        code = f"{secrets.randbelow(900000) + 100000}"
        reset_id = str(uuid.uuid4())

        with self.db.get_connection() as conn:
            with conn.cursor() as cur:
                # Invalidate any previous active reset requests for this user
                cur.execute("UPDATE password_resets SET used_at = NOW() WHERE user_id = %s AND used_at IS NULL;", (user_id,))
                cur.execute("""
                INSERT INTO password_resets (id, user_id, email, token, code, expires_at, created_at)
                VALUES (%s, %s, %s, %s, %s, NOW() + INTERVAL '1 hour', NOW());
                """, (reset_id, user_id, email, token, code))
            conn.commit()

        # Dispatch email (or fallback to log simulation if SMTP is not configured)
        mail_res = send_password_reset_email(
            to_email=user["email"],
            reset_token=token,
            reset_code=code,
            display_name=user.get("display_name")
        )

        return {
            "success": True,
            "message": "If this email is registered, a password reset link and verification code has been dispatched.",
            "email": email,
            "simulated": mail_res.get("simulated", False),
            "dev_code": code if mail_res.get("simulated") else None,
            "mail_error": mail_res.get("error") if mail_res.get("error") else None,
            "smtp_configured": bool(os.environ.get("SMTP_HOST", "").strip())
        }

    def validate_reset_token(self, token: Optional[str] = None, code: Optional[str] = None, email: Optional[str] = None) -> Dict[str, Any]:
        """Validates if a reset token or code is valid and has not expired."""
        token = (token or "").strip()
        code = (code or "").strip()
        email = (email or "").strip().lower()

        if not token and not (code and email):
            return {"valid": False, "error": "Reset token or email & code required."}

        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                if token:
                    cur.execute("""
                    SELECT pr.id, pr.email, pr.expires_at, u.display_name
                    FROM password_resets pr
                    JOIN users u ON u.id = pr.user_id
                    WHERE pr.token = %s AND pr.used_at IS NULL AND pr.expires_at > NOW();
                    """, (token,))
                else:
                    cur.execute("""
                    SELECT pr.id, pr.email, pr.expires_at, u.display_name
                    FROM password_resets pr
                    JOIN users u ON u.id = pr.user_id
                    WHERE pr.code = %s AND LOWER(pr.email) = %s AND pr.used_at IS NULL AND pr.expires_at > NOW();
                    """, (code, email))
                row = cur.fetchone()
                if row:
                    return {"valid": True, "email": row["email"], "display_name": row.get("display_name")}
                return {"valid": False, "error": "Password reset token or code has expired or is invalid."}

    def reset_password(self, new_password: str, token: Optional[str] = None, code: Optional[str] = None, email: Optional[str] = None) -> Dict[str, Any]:
        """Resets user password, marks reset token as used, and returns fresh session."""
        if not new_password or len(new_password) < 6:
            return {"success": False, "error": "Password must be at least 6 characters."}

        token = (token or "").strip()
        code = (code or "").strip()
        email = (email or "").strip().lower()

        if not token and not (code and email):
            return {"success": False, "error": "Reset token or email and 6-digit code is required."}

        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                if token:
                    cur.execute("""
                    SELECT pr.id, pr.user_id, pr.email
                    FROM password_resets pr
                    WHERE pr.token = %s AND pr.used_at IS NULL AND pr.expires_at > NOW();
                    """, (token,))
                else:
                    cur.execute("""
                    SELECT pr.id, pr.user_id, pr.email
                    FROM password_resets pr
                    WHERE pr.code = %s AND LOWER(pr.email) = %s AND pr.used_at IS NULL AND pr.expires_at > NOW();
                    """, (code, email))
                row = cur.fetchone()
                if not row:
                    return {"success": False, "error": "Invalid or expired reset token/code. Please request a new link."}

                user_id = row["user_id"]
                reset_id = row["id"]
                new_pw_hash = _hash_password(new_password)

                # 1. Update user password
                cur.execute("UPDATE users SET password_hash = %s, updated_at = NOW() WHERE id = %s;", (new_pw_hash, user_id))

                # 2. Mark reset token as used
                cur.execute("UPDATE password_resets SET used_at = NOW() WHERE id = %s;", (reset_id,))

                # 3. Invalidate old sessions for security
                cur.execute("DELETE FROM user_sessions WHERE user_id = %s;", (user_id,))

                # 4. Create fresh session so user is logged in immediately
                session_token = str(uuid.uuid4())
                cur.execute("""
                INSERT INTO user_sessions (session_token, user_id, created_at, expires_at)
                VALUES (%s, %s, NOW(), NOW() + INTERVAL '60 days');
                """, (session_token, user_id))
            conn.commit()

        updated_user = self.get_user_by_id(user_id)
        logger.info(f"✅ Password successfully reset for user {row.get('email')} ({user_id})")

        return {
            "success": True,
            "message": "Password successfully reset!",
            "session_token": session_token,
            "user": updated_user
        }

    def create_session(self, user_id: str, user_agent: Optional[str] = None, ip_address: Optional[str] = None) -> str:
        """Creates and stores a fresh session token for user with device tracking."""
        session_token = str(uuid.uuid4())
        with self.db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                INSERT INTO user_sessions (session_token, user_id, user_agent, ip_address, created_at, last_active_at, expires_at)
                VALUES (%s, %s, %s, %s, NOW(), NOW(), NOW() + INTERVAL '60 days');
                """, (session_token, user_id, user_agent, ip_address))
            conn.commit()
        return session_token

    def get_session(self, session_token: str) -> Optional[Dict[str, Any]]:
        """Retrieves user profile and BCP link status for active session token."""
        if not session_token:
            return None
        import time
        from psycopg2 import extras
        import psycopg2.errors

        for attempt in range(2):
            try:
                with self.db.get_connection() as conn:
                    with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                        cur.execute("""
                        SELECT u.id, u.email, u.display_name, u.role, u.player_id,
                               u.bcp_user_id, u.bcp_email, u.bcp_linked_at,
                               COALESCE(p.player_name, pl.full_name) as competitor_name,
                               p.current_elo, p.peak_elo, p.matches_played, p.wins, p.losses, p.win_rate,
                               p.top_faction, COALESCE(p.team, pl.team) as team
                        FROM user_sessions s
                        JOIN users u ON s.user_id = u.id
                        LEFT JOIN player_ratings p ON u.player_id = p.player_id
                        LEFT JOIN players pl ON u.player_id = pl.id
                        WHERE s.session_token = %s AND s.expires_at > NOW();
                        """, (session_token,))
                        row = cur.fetchone()
                        if row:
                            data = dict(row)
                            data["session_token"] = session_token
                            user_email = (data.get("email") or "").strip().lower()
                            data["role"] = "admin" if user_email == "swimgeek751@gmail.com" else (str(row.get("role") or "player").lower())
                            data["bcp_connected"] = bool(data.get("bcp_user_id"))

                            # Touch last_active_at periodically (at most once every 5 minutes)
                            try:
                                cur.execute("""
                                UPDATE user_sessions 
                                SET last_active_at = NOW() 
                                WHERE session_token = %s AND (last_active_at IS NULL OR last_active_at < NOW() - INTERVAL '5 minutes');
                                """, (session_token,))
                                conn.commit()
                            except Exception:
                                pass

                            return data
                return None
            except (psycopg2.errors.DeadlockDetected, psycopg2.OperationalError) as exc:
                if attempt == 0:
                    time.sleep(0.06)
                    continue
                logger.warning(f"get_session transient DB error after retry: {exc}")
                return None
            except Exception as e:
                logger.error(f"get_session unexpected error: {e}")
                return None

    def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Fetches user dict by user ID."""
        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("""
                SELECT u.id, u.email, u.display_name, u.role, u.player_id,
                       u.bcp_user_id, u.bcp_email, u.bcp_linked_at,
                       COALESCE(p.player_name, pl.full_name) as competitor_name,
                       p.current_elo, p.peak_elo, p.matches_played, p.wins, p.losses, p.win_rate,
                       p.top_faction, COALESCE(p.team, pl.team) as team
                FROM users u
                LEFT JOIN player_ratings p ON u.player_id = p.player_id
                LEFT JOIN players pl ON u.player_id = pl.id
                WHERE u.id = %s;
                """, (user_id,))
                row = cur.fetchone()
                if row:
                    data = dict(row)
                    user_email = (data.get("email") or "").strip().lower()
                    data["role"] = "admin" if user_email == "swimgeek751@gmail.com" else (str(row.get("role") or "player").lower())
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

    def logout_all_sessions(self, user_id: str, keep_current_token: Optional[str] = None) -> int:
        """Invalidates active sessions across all devices for a user.
        If keep_current_token is provided, only other device sessions are revoked."""
        if not user_id:
            return 0
        with self.db.get_connection() as conn:
            with conn.cursor() as cur:
                if keep_current_token:
                    cur.execute("""
                    DELETE FROM user_sessions 
                    WHERE user_id = %s AND session_token != %s;
                    """, (user_id, keep_current_token))
                else:
                    cur.execute("DELETE FROM user_sessions WHERE user_id = %s;", (user_id,))
                deleted_count = cur.rowcount
            conn.commit()
        logger.info(f"🔒 Revoked {deleted_count} session(s) for user {user_id} (keep_current={bool(keep_current_token)})")
        return deleted_count

    def revoke_session(self, user_id: str, target_token: str) -> bool:
        """Revokes a specific session for a user."""
        if not user_id or not target_token:
            return False
        with self.db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                DELETE FROM user_sessions 
                WHERE user_id = %s AND session_token = %s;
                """, (user_id, target_token))
                deleted = cur.rowcount > 0
            conn.commit()
        return deleted

    def get_active_sessions(self, user_id: str, current_token: Optional[str] = None) -> List[Dict[str, Any]]:
        """Returns list of active device sessions for user."""
        if not user_id:
            return []
        from psycopg2 import extras
        sessions = []
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("""
                SELECT session_token, user_agent, ip_address, created_at, last_active_at, expires_at
                FROM user_sessions
                WHERE user_id = %s AND expires_at > NOW()
                ORDER BY last_active_at DESC NULLS LAST, created_at DESC;
                """, (user_id,))
                for row in cur.fetchall():
                    tok = row["session_token"]
                    ua = row.get("user_agent")
                    sessions.append({
                        "session_token": tok,
                        "masked_token": tok[:8] + "..." if tok else "",
                        "is_current": (tok == current_token) if current_token else False,
                        "device_name": parse_device_info(ua),
                        "user_agent": ua or "Unknown",
                        "ip_address": row.get("ip_address") or "Unknown",
                        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
                        "last_active_at": (row.get("last_active_at") or row["created_at"]).isoformat() if (row.get("last_active_at") or row.get("created_at")) else None,
                    })
        return sessions

    # =========================================================================
    # INVITATION CODES & REFERRAL MANAGEMENT
    # =========================================================================

    def generate_user_invite_code(self, user_id: str) -> Dict[str, Any]:
        """Generates a 24-hour multi-use invitation code for an authenticated user (or retrieves their active one)."""
        if not user_id:
            return {"success": False, "error": "Authentication required."}

        if not self.are_registrations_open():
            return {"success": False, "error": "Account registration is currently suspended by the administrator."}

        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                # Check for an active, non-expired 24h code for this user
                cur.execute("""
                SELECT code, created_at, expires_at, use_count, is_active
                FROM invitation_codes
                WHERE created_by_user_id = %s 
                  AND is_active = TRUE
                  AND expires_at IS NOT NULL 
                  AND expires_at > NOW()
                ORDER BY created_at DESC
                LIMIT 1;
                """, (user_id,))
                active = cur.fetchone()
                if active:
                    exp = active["expires_at"]
                    remaining_secs = max(0, int((exp - datetime.now(timezone.utc)).total_seconds())) if exp else 0
                    return {
                        "success": True,
                        "code": active["code"],
                        "expires_at": exp.isoformat() if exp else None,
                        "remaining_seconds": remaining_secs,
                        "use_count": active["use_count"] or 0,
                        "is_new": False,
                        "message": "Existing active 24-hour invite code retrieved."
                    }

                # Generate new code: TAC-XXXX
                chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
                rand_suffix = "".join(secrets.choice(chars) for _ in range(4))
                new_code = f"TAC-{rand_suffix}"

                # Ensure unique
                cur.execute("SELECT code FROM invitation_codes WHERE code = %s;", (new_code,))
                if cur.fetchone():
                    new_code = f"TAC-{secrets.randbelow(8999) + 1000}"

                cur.execute("""
                INSERT INTO invitation_codes (code, created_by_user_id, is_admin_code, is_active, max_uses, use_count, created_at, expires_at)
                VALUES (%s, %s, FALSE, TRUE, NULL, 0, NOW(), NOW() + INTERVAL '24 hours');
                """, (new_code, user_id))
            conn.commit()

        exp_dt = datetime.now(timezone.utc) + timedelta(hours=24)
        return {
            "success": True,
            "code": new_code,
            "expires_at": exp_dt.isoformat(),
            "remaining_seconds": 86400,
            "use_count": 0,
            "is_new": True,
            "message": "Generated 24-hour multi-use invite code. Multiple players can use this code today."
        }

    def get_user_active_invite_code(self, user_id: str) -> Dict[str, Any]:
        """Returns the user's current active 24-hour invite code if any."""
        if not user_id:
            return {"success": False, "has_code": False}

        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("""
                SELECT code, created_at, expires_at, use_count, is_active
                FROM invitation_codes
                WHERE created_by_user_id = %s 
                  AND is_active = TRUE
                  AND expires_at IS NOT NULL 
                  AND expires_at > NOW()
                ORDER BY created_at DESC
                LIMIT 1;
                """, (user_id,))
                active = cur.fetchone()
                if not active:
                    return {"success": True, "has_code": False}

                exp = active["expires_at"]
                remaining_secs = max(0, int((exp - datetime.now(timezone.utc)).total_seconds())) if exp else 0
                return {
                    "success": True,
                    "has_code": True,
                    "code": active["code"],
                    "expires_at": exp.isoformat() if exp else None,
                    "remaining_seconds": remaining_secs,
                    "use_count": active["use_count"] or 0
                }

    def create_admin_invite_code(self, admin_user_id: str, code_str: str, max_uses: Optional[int] = None, expires_in_days: Optional[int] = None) -> Dict[str, Any]:
        """Creates an admin persistent invitation code (or time-bounded)."""
        code_str = code_str.strip().upper().replace(" ", "-")
        if not code_str or len(code_str) < 3:
            return {"success": False, "error": "Code must be at least 3 characters long."}

        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("SELECT code FROM invitation_codes WHERE code = %s;", (code_str,))
                if cur.fetchone():
                    return {"success": False, "error": f"Code '{code_str}' already exists."}

                expires_at = None
                if expires_in_days and int(expires_in_days) > 0:
                    expires_at = datetime.now(timezone.utc) + timedelta(days=int(expires_in_days))

                cur.execute("""
                INSERT INTO invitation_codes (code, created_by_user_id, is_admin_code, is_active, max_uses, use_count, created_at, expires_at)
                VALUES (%s, %s, TRUE, TRUE, %s, 0, NOW(), %s);
                """, (code_str, admin_user_id, max_uses, expires_at))
            conn.commit()

        return {
            "success": True,
            "code": code_str,
            "is_persistent": expires_at is None,
            "max_uses": max_uses,
            "message": f"Admin invite code '{code_str}' successfully created."
        }

    def delete_admin_invite_code(self, code_str: str) -> Dict[str, Any]:
        code_str = code_str.strip().upper()
        with self.db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM invitation_codes WHERE code = %s;", (code_str,))
            conn.commit()
        return {"success": True, "message": f"Code '{code_str}' deleted."}

    def toggle_invite_code(self, code_str: str, is_active: bool) -> Dict[str, Any]:
        code_str = code_str.strip().upper()
        with self.db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE invitation_codes SET is_active = %s WHERE code = %s;", (is_active, code_str))
            conn.commit()
        return {"success": True, "is_active": is_active}

    def get_admin_dashboard_metrics(self) -> Dict[str, Any]:
        """Calculates system health, registration metrics, and referral velocity."""
        from psycopg2 import extras
        total_users = 0
        bcp_linked = 0
        active_sessions = 0
        games_tracked = 0
        signups_today = 0
        signups_week = 0
        signups_month = 0
        invites_enabled = True
        total_redemptions = 0
        active_codes_count = 0

        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                try:
                    cur.execute("SELECT COUNT(*) as c FROM users;")
                    row = cur.fetchone()
                    if row: total_users = row["c"]
                except Exception:
                    conn.rollback()

                try:
                    cur.execute("SELECT COUNT(*) as c FROM users WHERE bcp_user_id IS NOT NULL AND bcp_user_id != '';")
                    row = cur.fetchone()
                    if row: bcp_linked = row["c"]
                except Exception:
                    conn.rollback()

                try:
                    cur.execute("SELECT COUNT(*) as c FROM user_sessions WHERE expires_at > NOW();")
                    row = cur.fetchone()
                    if row: active_sessions = row["c"]
                except Exception:
                    conn.rollback()

                try:
                    cur.execute("SELECT COUNT(*) as c FROM matches;")
                    row = cur.fetchone()
                    if row: games_tracked = row["c"]
                except Exception:
                    conn.rollback()

                try:
                    cur.execute("SELECT COUNT(*) as c FROM users WHERE created_at >= NOW() - INTERVAL '24 hours';")
                    row = cur.fetchone()
                    if row: signups_today = row["c"]
                except Exception:
                    conn.rollback()

                try:
                    cur.execute("SELECT COUNT(*) as c FROM users WHERE created_at >= NOW() - INTERVAL '7 days';")
                    row = cur.fetchone()
                    if row: signups_week = row["c"]
                except Exception:
                    conn.rollback()

                try:
                    cur.execute("SELECT COUNT(*) as c FROM users WHERE created_at >= NOW() - INTERVAL '30 days';")
                    row = cur.fetchone()
                    if row: signups_month = row["c"]
                except Exception:
                    conn.rollback()

                try:
                    cur.execute("SELECT value FROM system_settings WHERE key = 'invites_enabled';")
                    s_row = cur.fetchone()
                    if s_row and s_row.get("value") is not None:
                        val_str = str(s_row["value"]).strip().lower()
                        invites_enabled = val_str not in ("false", "0", "no", "off", "disabled")
                except Exception:
                    conn.rollback()

                try:
                    cur.execute("SELECT COUNT(*) as c FROM invite_redemptions;")
                    row = cur.fetchone()
                    if row: total_redemptions = row["c"]
                except Exception:
                    conn.rollback()

                try:
                    cur.execute("SELECT COUNT(*) as c FROM invitation_codes WHERE is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW());")
                    row = cur.fetchone()
                    if row: active_codes_count = row["c"]
                except Exception:
                    conn.rollback()

        return {
            "total_users": total_users,
            "bcp_linked": bcp_linked,
            "bcp_percent": round((bcp_linked / total_users * 100), 1) if total_users > 0 else 0,
            "active_sessions": active_sessions,
            "games_tracked": games_tracked,
            "signups_today": signups_today,
            "signups_week": signups_week,
            "signups_month": signups_month,
            "invites_enabled": invites_enabled,
            "total_redemptions": total_redemptions,
            "active_codes_count": active_codes_count
        }

    def get_admin_invite_codes(self) -> List[Dict[str, Any]]:
        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("""
                SELECT 
                    ic.code,
                    ic.is_admin_code,
                    ic.is_active,
                    ic.max_uses,
                    ic.use_count,
                    ic.created_at,
                    ic.expires_at,
                    u.email as creator_email,
                    u.display_name as creator_name,
                    CASE 
                        WHEN ic.expires_at IS NULL THEN 'Never (Persistent)'
                        WHEN ic.expires_at < NOW() THEN 'Expired'
                        ELSE 'Active'
                    END as status_label
                FROM invitation_codes ic
                LEFT JOIN users u ON ic.created_by_user_id = u.id
                ORDER BY ic.created_at DESC;
                """)
                rows = cur.fetchall()
                for r in rows:
                    if r.get("created_at"): r["created_at"] = r["created_at"].isoformat()
                    if r.get("expires_at"): r["expires_at"] = r["expires_at"].isoformat()
                return rows

    def get_admin_referrals(self) -> List[Dict[str, Any]]:
        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("""
                SELECT 
                    r.id,
                    r.code,
                    r.redeemed_at,
                    r.ip_address,
                    u_new.id as new_user_id,
                    u_new.display_name as new_user_name,
                    u_new.email as new_user_email,
                    u_new.bcp_user_id as new_user_bcp,
                    u_inv.id as inviter_id,
                    u_inv.display_name as inviter_name,
                    u_inv.email as inviter_email
                FROM invite_redemptions r
                JOIN users u_new ON r.new_user_id = u_new.id
                LEFT JOIN users u_inv ON r.invited_by_user_id = u_inv.id
                ORDER BY r.redeemed_at DESC
                LIMIT 250;
                """)
                rows = cur.fetchall()
                for r in rows:
                    if r.get("redeemed_at"): r["redeemed_at"] = r["redeemed_at"].isoformat()
                return rows

    def get_admin_users(self) -> List[Dict[str, Any]]:
        from psycopg2 import extras
        admin_email = 'swimgeek751@gmail.com'
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("""
                SELECT 
                    u.id,
                    u.email,
                    u.display_name,
                    u.role,
                    u.bcp_user_id,
                    u.bcp_email,
                    u.created_at,
                    u.invite_code_used,
                    inv.display_name as invited_by_name,
                    inv.email as invited_by_email,
                    (SELECT COUNT(*) FROM invite_redemptions WHERE invited_by_user_id = u.id) as invite_count
                FROM users u
                LEFT JOIN users inv ON u.invited_by_user_id = inv.id
                ORDER BY u.created_at DESC
                LIMIT 500;
                """)
                rows = cur.fetchall()
                for r in rows:
                    if r.get("created_at"): r["created_at"] = r["created_at"].isoformat()
                    user_email = (r.get("email") or "").strip().lower()
                    if user_email == admin_email:
                        r["role"] = "admin"
                    else:
                        r["role"] = str(r.get("role") or "player").lower()
                return rows

    # =========================================================================
    # BEST COAST PAIRINGS ACCOUNT LINKING & SILENT REFRESH
    # =========================================================================

    def get_competitor_by_player_id(self, cur, player_id: Optional[str]) -> Optional[Dict[str, Any]]:
        """Checks if a verified BCP player_id exists in our player_ratings database."""
        if not player_id:
            return None
        clean_id = str(player_id).strip()
        cur.execute("""
        SELECT player_id, player_name, COALESCE(matches_played, 0) as matches_played, COALESCE(current_elo, 1500.0) as current_elo
        FROM player_ratings
        WHERE player_id = %s;
        """, (clean_id,))
        row = cur.fetchone()
        if not row:
            return None
        if isinstance(row, dict):
            return {
                "player_id": str(row.get("player_id") or ""),
                "player_name": str(row.get("player_name") or ""),
                "matches_played": int(row.get("matches_played") or 0),
                "current_elo": float(row.get("current_elo") or 1500.0)
            }
        return {
            "player_id": str(row[0] or ""),
            "player_name": str(row[1] or ""),
            "matches_played": int(row[2] or 0),
            "current_elo": float(row[3] or 1500.0)
        }

    def find_matching_competitor(
        self,
        cur,
        bcp_user_id: Optional[str] = None,
        first_name: str = "",
        last_name: str = "",
        full_name: str = "",
        email: str = ""
    ) -> Optional[Dict[str, Any]]:
        """Exact ID lookup only. Fuzzy name matching has been completely disabled to prevent cross-account collisions."""
        if bcp_user_id:
            return self.get_competitor_by_player_id(cur, bcp_user_id)
        return None

    def link_bcp_account(self, user_id: str, bcp_email: str, bcp_password: str) -> Dict[str, Any]:
        """Links user's Best Coast Pairings account via direct AWS Cognito authentication and official BCP User Profile API."""
        # 1. Direct AWS Cognito Authentication
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

        tokens = {
            "id_token": id_token,
            "access_token": access_token,
            "refresh_token": refresh_token,
            "email": bcp_email.strip()
        }
        return self.link_bcp_token(user_id, tokens)

    def link_bcp_token(self, user_id: str, token: Any, refresh_token: Optional[str] = None) -> Dict[str, Any]:
        """Directly links verified BCP tokens (ID token, access token, and refresh token) to the user profile."""
        import base64, json

        parsed = {}
        if isinstance(token, dict):
            parsed = token
        else:
            raw_str = str(token).strip()
            if raw_str.startswith("{") and raw_str.endswith("}"):
                try:
                    parsed = json.loads(raw_str)
                except Exception:
                    pass

        id_tok = (parsed.get("id_token") or parsed.get("idToken")) if isinstance(parsed, dict) else None
        acc_tok = (parsed.get("access_token") or parsed.get("accessToken")) if isinstance(parsed, dict) else None
        ref_tok = ((parsed.get("refresh_token") or parsed.get("refreshToken")) if isinstance(parsed, dict) else None) or refresh_token

        primary_tok = id_tok or acc_tok or (str(token).strip() if not isinstance(token, dict) else "")
        actual_id = id_tok or primary_tok
        actual_acc = acc_tok or primary_tok

        claims = _decode_jwt_payload(actual_id) or _decode_jwt_payload(actual_acc)
        logger.info(f"🔍 [BCP Token Link] User: {user_id}, ClientID: {parsed.get('client_id')}, Aud: {claims.get('aud') or claims.get('client_id')}, Sub: {claims.get('sub')}, Email: {claims.get('email')}")

        bcp_user_id = claims.get("sub") or claims.get("username") or parsed.get("bcp_user_id") or parsed.get("userId")
        bcp_email = claims.get("email") or claims.get("bcpEmail") or parsed.get("email") or ""
        
        # Player ID prioritization:
        # 1. Directly supplied player_id or custom:userId
        # 2. JWT claims
        # 3. Fetched from BCP /v1/users/{sub} endpoint
        pid = parsed.get("player_id") or claims.get("userId") or claims.get("custom:userId")

        given_name = str(parsed.get("given_name") or claims.get("given_name") or "").strip()
        family_name = str(parsed.get("family_name") or claims.get("family_name") or "").strip()
        full_bcp_name = f"{given_name} {family_name}".strip()
        bcp_name = (parsed.get("name") or claims.get("name") or full_bcp_name or claims.get("nickname") or "").strip()
        if not bcp_name and bcp_email:
            bcp_name = bcp_email.split("@")[0].strip()

        # If given_name or family_name is missing, extract from bcp_name
        if not given_name or not family_name:
            parts = bcp_name.split()
            if len(parts) >= 2:
                if not given_name:
                    given_name = parts[0]
                if not family_name:
                    family_name = parts[-1]
            elif len(parts) == 1 and not given_name:
                given_name = parts[0]

        # If pid is missing or is a Cognito UUID (>15 chars), query BCP user endpoint directly with access token & client-id header
        if (not pid or len(str(pid)) > 15) and (actual_acc or actual_id) and bcp_user_id:
            try:
                import urllib.request
                u_url = f"https://newprod-api.bestcoastpairings.com/v1/users/{bcp_user_id}"
                req = urllib.request.Request(
                    u_url,
                    headers={
                        "Authorization": f"Bearer {actual_acc or actual_id}",
                        "client-id": "web-app",
                        "User-Agent": "Mozilla/5.0"
                    }
                )
                with urllib.request.urlopen(req, timeout=5) as resp:
                    if resp.status == 200:
                        u_data = json.loads(resp.read().decode("utf-8"))
                        if isinstance(u_data, dict):
                            if u_data.get("id"):
                                pid = str(u_data["id"])
                            if u_data.get("firstName") and not given_name:
                                given_name = str(u_data["firstName"]).strip()
                            if u_data.get("lastName") and not family_name:
                                family_name = str(u_data["lastName"]).strip()
                            if not bcp_name and (given_name or family_name):
                                bcp_name = f"{given_name} {family_name}".strip()
            except Exception as ue:
                logger.debug(f"Direct BCP user profile fetch notice: {ue}")

        if not pid:
            pid = bcp_user_id

        from psycopg2 import extras
        with self.db.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                # 1. Enforce strict 1-to-1 BCP account linking
                clauses = []
                chk_params = []
                if bcp_user_id:
                    clauses.append("bcp_user_id = %s")
                    chk_params.append(bcp_user_id)
                if bcp_email and bcp_email.strip():
                    clauses.append("LOWER(bcp_email) = LOWER(%s)")
                    chk_params.append(bcp_email.strip())

                if clauses:
                    check_query = f"""
                    SELECT id, email, display_name FROM users
                    WHERE ({' OR '.join(clauses)}) AND id != %s
                    LIMIT 1;
                    """
                    chk_params.append(user_id)
                    cur.execute(check_query, tuple(chk_params))
                    conflict = cur.fetchone()
                    if conflict:
                        conflict_name = conflict.get("display_name") or conflict.get("email") or "another user"
                        display_email = bcp_email or bcp_user_id
                        logger.warning(f"⚠️ Conflict: BCP account {display_email} is already linked to OmniTactica user {conflict_name} ({conflict.get('id')})")
                        return {
                            "success": False,
                            "error": f"This Best Coast Pairings account ({display_email}) is already linked to another OmniTactica account ({conflict_name}). An account can only be linked to one OmniTactica profile. Please disconnect it from that profile first."
                        }

                # 2. Check if player_id exists in player_ratings
                comp_match = self.get_competitor_by_player_id(cur, pid) if pid else None
                if comp_match:
                    logger.info(f"✅ BCP Competitor linked: '{bcp_name}' -> '{comp_match.get('player_name')}' (ID: {pid}, Matches: {comp_match.get('matches_played')}, Elo: {comp_match.get('current_elo')})")
                else:
                    logger.info(f"ℹ️ Verified BCP player ID '{pid}' linked for '{bcp_name}'.")

                # 3. Update users table with official BCP name, verified player_id, and tokens
                target_display_name = bcp_name or full_bcp_name or None
                cur.execute("""
                UPDATE users SET
                    display_name = COALESCE(NULLIF(%s, ''), display_name),
                    player_id = %s,
                    bcp_user_id = COALESCE(%s, bcp_user_id),
                    bcp_email = COALESCE(NULLIF(%s, ''), bcp_email),
                    bcp_access_token = %s,
                    bcp_id_token = %s,
                    bcp_refresh_token = COALESCE(%s, bcp_refresh_token),
                    bcp_token_expires_at = (NOW() + INTERVAL '1 hour'),
                    bcp_linked_at = NOW(),
                    updated_at = NOW()
                WHERE id = %s;
                """, (target_display_name, pid, bcp_user_id, bcp_email.strip() if bcp_email else None, actual_acc, actual_id, ref_tok, user_id))
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
        """Unlinks Best Coast Pairings account from user and clears competitor profile."""
        with self.db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                UPDATE users SET
                    player_id = NULL,
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
        user_info = None
        if user_id:
            user_info = self.get_user_by_id(user_id)
            if user_info:
                target_pid = target_pid or user_info.get("player_id")

        display_name = (user_info and user_info.get("display_name")) or "Competitor"

        if not target_pid:
            return {
                "player": {
                    "player_name": display_name,
                    "display_name": display_name,
                    "current_elo": 1500.0,
                    "peak_elo": 1500.0,
                    "win_rate": 0.0,
                    "matches_played": 0,
                    "wins": 0,
                    "losses": 0,
                    "draws": 0,
                    "top_faction": "General",
                    "team": ""
                },
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
                    "player_name": display_name,
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

                if display_name and display_name != "Competitor":
                    p_stat["display_name"] = display_name
                    if p_stat.get("player_name") == "Competitor" or not p_stat.get("player_name"):
                        p_stat["player_name"] = display_name

                # Calculate Global & Faction Rank
                cur.execute("SELECT COUNT(*) + 1 as rank FROM player_ratings WHERE current_elo > %s AND matches_played >= 3;", (p_stat["current_elo"],))
                g_row = cur.fetchone()
                global_rank = g_row["rank"] if (g_row and isinstance(g_row, dict)) else 1

                faction_rank = None
                if p_stat.get("top_faction"):
                    cur.execute("""
                    SELECT COUNT(*) + 1 as rank FROM player_ratings 
                    WHERE current_elo > %s AND top_faction ILIKE %s AND matches_played >= 3;
                    """, (p_stat["current_elo"], f"%{p_stat['top_faction']}%"))
                    f_row = cur.fetchone()
                    faction_rank = f_row["rank"] if (f_row and isinstance(f_row, dict)) else 1

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
