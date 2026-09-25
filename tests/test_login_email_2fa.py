"""
Comprehensive unit and integration test suite for Login Email 2FA:
- Unregistered / non-active device login triggers 6-digit Email 2FA verification
- Invalid password fails before 2FA is triggered
- Incorrect 2FA code rejection & 5-attempt brute-force lockout protection
- Resend 2FA code generates a new code, resets attempt counter, and extends expiration
- Valid 2FA code verification registers the device in user_sessions and issues session_token
- Subsequent login from an already-registered active device session skips 2FA
- Login from a second unregistered device (different device_id) still requires 2FA
- Revoking a session or logging out removes active session status so next login requires 2FA again
- Expired 2FA code rejection
- FastAPI router endpoint integration (/api/auth/login, /api/auth/verify-login-2fa, /api/auth/resend-login-2fa)
"""
import asyncio
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from auth import AuthManager, _hash_password, _FAILED_LOGIN_2FA_ATTEMPTS
from email_service import send_login_2fa_email
from routers.auth import (
    LoginPayload,
    VerifyLogin2FAPayload,
    ResendLogin2FAPayload,
    api_auth_login,
    api_auth_verify_login_2fa,
    api_auth_resend_login_2fa,
)


class StatefulFakeCursor:
    """In-memory relational state simulator for users, user_sessions, and pending_login_2fa."""

    def __init__(self, store):
        self.store = store
        self._last_rows = []
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass

    def execute(self, sql: str, params=None):
        q = " ".join(str(sql).split())
        q_upper = q.upper()
        params = params or ()
        self._last_rows = []
        self.rowcount = 0

        # 1. Lookup user by email on login
        if "SELECT ID, EMAIL, DISPLAY_NAME, PASSWORD_HASH FROM USERS WHERE LOWER(EMAIL) =" in q_upper:
            email = str(params[0]).strip().lower()
            user = self.store["users_by_email"].get(email)
            if user:
                self._last_rows = [dict(user)]
            return

        # 2. Query active sessions for user
        if "FROM USER_SESSIONS WHERE USER_ID = %S AND EXPIRES_AT > NOW()" in q_upper:
            user_id = params[0]
            now = datetime.now(timezone.utc)
            rows = [
                dict(s)
                for s in self.store["user_sessions"].values()
                if s["user_id"] == user_id and s["expires_at"] > now
            ]
            rows.sort(key=lambda r: r.get("last_active_at") or r.get("created_at") or now, reverse=True)
            self._last_rows = rows
            return

        # 3. Update existing active session on login from registered device
        if q_upper.startswith("UPDATE USER_SESSIONS SET DEVICE_ID = COALESCE"):
            eff_dev_id, ua, ip, tok = params
            sess = self.store["user_sessions"].get(tok)
            if sess:
                if eff_dev_id:
                    sess["device_id"] = eff_dev_id
                if ua:
                    sess["user_agent"] = ua
                if ip:
                    sess["ip_address"] = ip
                sess["last_active_at"] = datetime.now(timezone.utc)
                sess["expires_at"] = datetime.now(timezone.utc) + timedelta(days=60)
                self.rowcount = 1
            return

        # 4. Upsert pending_login_2fa
        if q_upper.startswith("INSERT INTO PENDING_LOGIN_2FA"):
            email, user_id, verify_code, login_token, dev_id, ua, ip = params
            email = email.strip().lower()
            self.store["pending_login_2fa"][email] = {
                "email": email,
                "user_id": user_id,
                "verify_code": verify_code,
                "login_token": login_token,
                "device_id": dev_id,
                "user_agent": ua,
                "ip_address": ip,
                "expires_at": datetime.now(timezone.utc) + timedelta(minutes=15),
                "created_at": datetime.now(timezone.utc),
            }
            self.rowcount = 1
            return

        # 5. Select from pending_login_2fa for verify_login_2fa
        if q_upper.startswith("SELECT") and "FROM PENDING_LOGIN_2FA WHERE LOWER(EMAIL) =" in q_upper:
            email = str(params[0]).strip().lower()
            rec = self.store["pending_login_2fa"].get(email)
            if rec:
                self._last_rows = [dict(rec)]
            return

        # 6. Select from pending_login_2fa JOIN users for resend_login_2fa_code
        if "FROM PENDING_LOGIN_2FA P LEFT JOIN USERS U" in q_upper:
            email = str(params[0]).strip().lower()
            rec = self.store["pending_login_2fa"].get(email)
            if rec:
                user = self.store["users_by_id"].get(rec["user_id"], {})
                merged = dict(rec)
                merged["display_name"] = user.get("display_name")
                self._last_rows = [merged]
            return

        # 7. Update pending_login_2fa on resend
        if q_upper.startswith("UPDATE PENDING_LOGIN_2FA SET VERIFY_CODE ="):
            new_code, eff_ua, eff_ip, email = params
            email = email.strip().lower()
            rec = self.store["pending_login_2fa"].get(email)
            if rec:
                rec["verify_code"] = new_code
                if eff_ua:
                    rec["user_agent"] = eff_ua
                if eff_ip:
                    rec["ip_address"] = eff_ip
                rec["expires_at"] = datetime.now(timezone.utc) + timedelta(minutes=15)
                rec["created_at"] = datetime.now(timezone.utc)
                self.rowcount = 1
            return

        # 8. Delete stale user_sessions by (user_id, device_id)
        if q_upper.startswith("DELETE FROM USER_SESSIONS WHERE USER_ID = %S AND DEVICE_ID = %S"):
            user_id, dev_id = params
            to_del = [
                tok
                for tok, s in self.store["user_sessions"].items()
                if s["user_id"] == user_id and s.get("device_id") == dev_id
            ]
            for tok in to_del:
                del self.store["user_sessions"][tok]
            self.rowcount = len(to_del)
            return

        # 9. Insert new user_sessions row
        if q_upper.startswith("INSERT INTO USER_SESSIONS"):
            session_token, user_id, dev_id, ua, ip = params
            now = datetime.now(timezone.utc)
            self.store["user_sessions"][session_token] = {
                "session_token": session_token,
                "user_id": user_id,
                "device_id": dev_id,
                "user_agent": ua,
                "ip_address": ip,
                "created_at": now,
                "last_active_at": now,
                "expires_at": now + timedelta(days=60),
            }
            self.rowcount = 1
            return

        # 10. Delete from pending_login_2fa
        if q_upper.startswith("DELETE FROM PENDING_LOGIN_2FA"):
            email = str(params[0]).strip().lower()
            if email in self.store["pending_login_2fa"]:
                del self.store["pending_login_2fa"][email]
                self.rowcount = 1
            return

        # 11. Logout single session
        if q_upper.startswith("DELETE FROM USER_SESSIONS WHERE SESSION_TOKEN = %S"):
            tok = params[0]
            if tok in self.store["user_sessions"]:
                del self.store["user_sessions"][tok]
                self.rowcount = 1
            return

        # 12. Revoke specific session for user
        if "DELETE FROM USER_SESSIONS WHERE USER_ID = %S AND SESSION_TOKEN = %S" in q_upper:
            user_id, tok = params
            sess = self.store["user_sessions"].get(tok)
            if sess and sess["user_id"] == user_id:
                del self.store["user_sessions"][tok]
                self.rowcount = 1
            return

        # 13. Logout all sessions for user
        if "DELETE FROM USER_SESSIONS WHERE USER_ID = %S AND SESSION_TOKEN != %S" in q_upper:
            user_id, keep_tok = params
            to_del = [
                tok
                for tok, s in self.store["user_sessions"].items()
                if s["user_id"] == user_id and tok != keep_tok
            ]
            for tok in to_del:
                del self.store["user_sessions"][tok]
            self.rowcount = len(to_del)
            return

        if q_upper.startswith("DELETE FROM USER_SESSIONS WHERE USER_ID = %S"):
            user_id = params[0]
            to_del = [tok for tok, s in self.store["user_sessions"].items() if s["user_id"] == user_id]
            for tok in to_del:
                del self.store["user_sessions"][tok]
            self.rowcount = len(to_del)
            return

    def fetchone(self):
        return self._last_rows[0] if self._last_rows else None

    def fetchall(self):
        return list(self._last_rows)


class StatefulFakeDB:
    def __init__(self, store):
        self.store = store

    def get_connection(self):
        store = self.store

        class _Conn:
            def __enter__(self_conn):
                return self_conn

            def __exit__(self_conn, exc_type, exc_val, exc_tb):
                pass

            def cursor(self_conn, cursor_factory=None):
                return StatefulFakeCursor(store)

            def commit(self_conn):
                pass

            def rollback(self_conn):
                pass

        return _Conn()


class TestLoginEmail2FA(unittest.TestCase):
    """Tests the full lifecycle of Login Email 2FA for unregistered devices and active sessions."""

    def setUp(self):
        _FAILED_LOGIN_2FA_ATTEMPTS.clear()
        self.user_id = "user_commander_1"
        self.email = "commander@omnitactica.com"
        self.password = "EmperorProtects40k!"
        self.pw_hash = _hash_password(self.password)

        user_obj = {
            "id": self.user_id,
            "email": self.email,
            "display_name": "Commander Dante",
            "password_hash": self.pw_hash,
            "role": "player",
        }
        self.store = {
            "users_by_email": {self.email: user_obj},
            "users_by_id": {self.user_id: user_obj},
            "user_sessions": {},
            "pending_login_2fa": {},
        }

        self.auth_mgr = AuthManager.__new__(AuthManager)
        self.auth_mgr.db = StatefulFakeDB(self.store)
        self.auth_mgr._ensure_login_2fa_table = MagicMock()
        self.auth_mgr.get_user_by_id = MagicMock(
            return_value={
                "id": self.user_id,
                "email": self.email,
                "display_name": "Commander Dante",
                "role": "player",
            }
        )

    def test_1_wrong_password_rejected_without_triggering_2fa(self):
        """Wrong password or unknown email must fail immediately and never send a 2FA code."""
        with patch("auth.send_login_2fa_email") as mock_email:
            res = self.auth_mgr.login(
                self.email,
                "WrongPassword123",
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/125.0",
                ip_address="203.0.113.10",
                device_id="dev_mac_1",
            )
            self.assertFalse(res.get("success"))
            self.assertIn("Invalid email or password", res.get("error", ""))
            mock_email.assert_not_called()
            self.assertEqual(len(self.store["pending_login_2fa"]), 0)

    def test_2_unregistered_device_requires_email_2fa_and_completes_verification(self):
        """Logging in from a device not in user_sessions requires Email 2FA; verifying registers the device."""
        with patch("auth.send_login_2fa_email", return_value={"success": True, "simulated": True}) as mock_email:
            res = self.auth_mgr.login(
                self.email,
                self.password,
                user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1",
                ip_address="198.51.100.42",
                device_id="dev_iphone_1",
            )

            self.assertTrue(res.get("success"))
            self.assertTrue(res.get("requires_2fa"))
            self.assertTrue(res.get("requires_verification"))
            self.assertEqual(res.get("verification_type"), "login_2fa")
            self.assertIsNone(res.get("session_token"))
            self.assertEqual(res.get("device_name"), "iPhone • Safari")
            self.assertTrue(res.get("login_token"))
            mock_email.assert_called_once()

            # Extract the 6-digit code sent to email
            sent_kwargs = mock_email.call_args.kwargs
            verify_code = sent_kwargs["verify_code"]
            self.assertEqual(len(verify_code), 6)
            self.assertTrue(verify_code.isdigit())

            # Active sessions should still be empty before 2FA verification
            self.assertEqual(len(self.store["user_sessions"]), 0)

            # Now verify the 6-digit code
            verify_res = self.auth_mgr.verify_login_2fa(
                email=self.email,
                code=verify_code,
                login_token=res["login_token"],
                user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1",
                ip_address="198.51.100.42",
                device_id="dev_iphone_1",
            )
            self.assertTrue(verify_res.get("success"))
            self.assertFalse(verify_res.get("requires_2fa"))
            self.assertTrue(verify_res.get("session_token"))
            self.assertEqual(verify_res.get("device_id"), "dev_iphone_1")
            self.assertEqual(verify_res["user"]["display_name"], "Commander Dante")

            # Pending 2FA record should be cleaned up and device registered in user_sessions
            self.assertEqual(len(self.store["pending_login_2fa"]), 0)
            self.assertEqual(len(self.store["user_sessions"]), 1)

            # Subsequent login from the SAME registered active device ("dev_iphone_1") skips 2FA!
            mock_email.reset_mock()
            second_login = self.auth_mgr.login(
                self.email,
                self.password,
                user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1",
                ip_address="198.51.100.99",  # even if mobile IP roamed!
                device_id="dev_iphone_1",
            )
            self.assertTrue(second_login.get("success"))
            self.assertFalse(second_login.get("requires_2fa"))
            self.assertEqual(second_login.get("session_token"), verify_res.get("session_token"))
            mock_email.assert_not_called()

    def test_3_second_unregistered_device_requires_2fa_even_on_same_ip(self):
        """A second browser/device (different device_id) is NOT an active session and must require Email 2FA."""
        with patch("auth.send_login_2fa_email", return_value={"success": True, "simulated": True}) as mock_email:
            # Register Device 1
            res1 = self.auth_mgr.login(
                self.email,
                self.password,
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/125.0",
                ip_address="203.0.113.5",
                device_id="dev_desktop_1",
            )
            code1 = self.store["pending_login_2fa"][self.email]["verify_code"]
            self.auth_mgr.verify_login_2fa(
                email=self.email,
                code=code1,
                login_token=res1["login_token"],
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/125.0",
                ip_address="203.0.113.5",
                device_id="dev_desktop_1",
            )
            self.assertEqual(len(self.store["user_sessions"]), 1)

            # Now sign in from Device 2 (e.g. incognito or second browser on same network IP & UA)
            mock_email.reset_mock()
            res2 = self.auth_mgr.login(
                self.email,
                self.password,
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/125.0",
                ip_address="203.0.113.5",
                device_id="dev_desktop_2_unregistered",
            )
            self.assertTrue(res2.get("success"))
            self.assertTrue(res2.get("requires_2fa"), "Second unregistered device_id must require Email 2FA")
            self.assertIsNone(res2.get("session_token"))
            mock_email.assert_called_once()

    def test_4_revoking_or_logging_out_session_requires_2fa_on_next_login(self):
        """Once a device session is logged out or revoked, it is no longer an active session and requires 2FA again."""
        with patch("auth.send_login_2fa_email", return_value={"success": True, "simulated": True}) as mock_email:
            res1 = self.auth_mgr.login(
                self.email,
                self.password,
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0",
                ip_address="192.0.2.55",
                device_id="dev_win_pc",
            )
            code1 = self.store["pending_login_2fa"][self.email]["verify_code"]
            v1 = self.auth_mgr.verify_login_2fa(
                email=self.email,
                code=code1,
                login_token=res1["login_token"],
                device_id="dev_win_pc",
            )
            token = v1["session_token"]

            # Confirm active device logs in without 2FA
            direct = self.auth_mgr.login(self.email, self.password, device_id="dev_win_pc")
            self.assertFalse(direct.get("requires_2fa"))

            # Now revoke/logout that session
            self.auth_mgr.revoke_session(self.user_id, token)
            self.assertEqual(len(self.store["user_sessions"]), 0)

            # Next login from dev_win_pc MUST require 2FA because its active session was revoked
            mock_email.reset_mock()
            after_revoke = self.auth_mgr.login(
                self.email,
                self.password,
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0",
                ip_address="192.0.2.55",
                device_id="dev_win_pc",
            )
            self.assertTrue(after_revoke.get("requires_2fa"))
            self.assertIsNone(after_revoke.get("session_token"))
            mock_email.assert_called_once()

    def test_5_wrong_2fa_code_attempts_and_brute_force_lockout_and_resend(self):
        """Verifies 5-attempt brute-force lockout on login 2FA and reset via resend_login_2fa_code."""
        with patch("auth.send_login_2fa_email", return_value={"success": True, "simulated": True}):
            res = self.auth_mgr.login(self.email, self.password, device_id="dev_tablet")
            self.assertTrue(res.get("requires_2fa"))
            real_code = self.store["pending_login_2fa"][self.email]["verify_code"]

            # 5 wrong attempts
            for attempt in range(1, 6):
                bad = self.auth_mgr.verify_login_2fa(self.email, "000000", login_token=res["login_token"])
                self.assertFalse(bad.get("success"))
                self.assertIn(f"{5 - attempt} attempt(s) remaining", bad.get("error", ""))

            # 6th attempt even with real code is blocked by rate-limiter
            locked = self.auth_mgr.verify_login_2fa(self.email, real_code, login_token=res["login_token"])
            self.assertFalse(locked.get("success"))
            self.assertIn("Too many failed attempts", locked.get("error", ""))

            # Resending 2FA code resets the rate-limiter and rotates the code
            resend_res = self.auth_mgr.resend_login_2fa_code(self.email, login_token=res["login_token"])
            self.assertTrue(resend_res.get("success"))
            new_code = self.store["pending_login_2fa"][self.email]["verify_code"]

            # Now verification with new_code succeeds
            ok = self.auth_mgr.verify_login_2fa(
                self.email,
                new_code,
                login_token=res["login_token"],
                device_id="dev_tablet",
            )
            self.assertTrue(ok.get("success"))
            self.assertTrue(ok.get("session_token"))

    def test_6_expired_2fa_code_is_rejected(self):
        """An expired 6-digit login 2FA code must be rejected."""
        with patch("auth.send_login_2fa_email", return_value={"success": True, "simulated": True}):
            res = self.auth_mgr.login(self.email, self.password, device_id="dev_exp")
            code = self.store["pending_login_2fa"][self.email]["verify_code"]
            # Force expiration in the past
            self.store["pending_login_2fa"][self.email]["expires_at"] = datetime.now(timezone.utc) - timedelta(minutes=1)

            expired_res = self.auth_mgr.verify_login_2fa(self.email, code, login_token=res["login_token"])
            self.assertFalse(expired_res.get("success"))
            self.assertIn("expired", expired_res.get("error", "").lower())

    def test_7_send_login_2fa_email_simulator(self):
        """Verifies send_login_2fa_email formats and simulates email cleanly when SMTP_HOST is unset."""
        with patch.dict("os.environ", {"SMTP_HOST": ""}, clear=False):
            mail_res = send_login_2fa_email(
                to_email=self.email,
                verify_code="482910",
                display_name="Commander Dante",
                device_name="Mac • Chrome",
                ip_address="203.0.113.77",
            )
            self.assertTrue(mail_res.get("success"))
            self.assertTrue(mail_res.get("simulated"))
            self.assertEqual(mail_res.get("verify_code"), "482910")

    def test_8_router_endpoints_integration(self):
        """Tests /api/auth/login, /api/auth/verify-login-2fa, and /api/auth/resend-login-2fa router handlers."""
        with patch("routers.auth.get_auth_manager", return_value=self.auth_mgr), patch(
            "auth.send_login_2fa_email", return_value={"success": True, "simulated": True}
        ):
            mock_req = MagicMock()
            mock_req.headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/125.0"}
            mock_req.cookies = {}
            mock_req.client.host = "198.51.100.12"
            mock_req.url.scheme = "https"
            mock_resp = MagicMock()

            # Step 1: Login from unregistered device -> returns requires_2fa=True and does NOT set session_token cookie
            login_res = asyncio.run(
                api_auth_login(
                    request=mock_req,
                    payload=LoginPayload(email=self.email, password=self.password, device_id="dev_router_test"),
                    response=mock_resp,
                )
            )
            self.assertTrue(login_res.get("requires_2fa"))
            mock_resp.set_cookie.assert_not_called()

            # Step 2: Resend 2FA code via router endpoint
            resend_res = asyncio.run(
                api_auth_resend_login_2fa(
                    request=mock_req,
                    payload=ResendLogin2FAPayload(email=self.email, login_token=login_res["login_token"]),
                )
            )
            self.assertTrue(resend_res.get("success"))

            # Step 3: Verify 2FA code via router endpoint -> sets session_token and omni_device_id cookies
            code = self.store["pending_login_2fa"][self.email]["verify_code"]
            verify_res = asyncio.run(
                api_auth_verify_login_2fa(
                    request=mock_req,
                    payload=VerifyLogin2FAPayload(
                        email=self.email,
                        code=code,
                        login_token=login_res["login_token"],
                        device_id="dev_router_test",
                    ),
                    response=mock_resp,
                )
            )
            self.assertTrue(verify_res.get("success"))
            self.assertTrue(verify_res.get("session_token"))
            cookie_keys = [c.kwargs.get("key") for c in mock_resp.set_cookie.call_args_list]
            self.assertIn("session_token", cookie_keys)
            self.assertIn("omni_device_id", cookie_keys)

            # Step 4: Subsequent login from same registered device sets session_token cookie immediately
            mock_resp.reset_mock()
            login_again = asyncio.run(
                api_auth_login(
                    request=mock_req,
                    payload=LoginPayload(email=self.email, password=self.password, device_id="dev_router_test"),
                    response=mock_resp,
                )
            )
            self.assertFalse(login_again.get("requires_2fa"))
            self.assertEqual(login_again.get("session_token"), verify_res.get("session_token"))
            cookie_keys_2 = [c.kwargs.get("key") for c in mock_resp.set_cookie.call_args_list]
            self.assertIn("session_token", cookie_keys_2)


if __name__ == "__main__":
    unittest.main()
