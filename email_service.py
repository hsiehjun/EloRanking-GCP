"""
email_service.py - Email Dispatch Service for OmniTactica

Supports SMTP delivery (STARTTLS / SSL) with graceful dev fallback / simulation.
Configured via standard environment variables:
  SMTP_HOST: SMTP server hostname (e.g., smtp.gmail.com, smtp.sendgrid.net)
  SMTP_PORT: SMTP port (default 587)
  SMTP_USER: SMTP username / auth user
  SMTP_PASS: SMTP password / app password / API key
  SMTP_FROM: From address (default: "OmniTactica <noreply@omnitactica.com>")
  SMTP_SECURE: "tls" (default), "ssl", or "none"
  APP_URL: Base application URL (default: "https://omnitactica.com")
"""

import os
import smtplib
import logging
import urllib.parse
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, Any, Optional

logger = logging.getLogger("EmailService")


def get_email_config() -> Dict[str, Any]:
    return {
        "host": os.environ.get("SMTP_HOST", "").strip(),
        "port": int(os.environ.get("SMTP_PORT", "587")),
        "user": os.environ.get("SMTP_USER", os.environ.get("SMTP_USERNAME", "")).strip(),
        "password": os.environ.get("SMTP_PASS", os.environ.get("SMTP_PASSWORD", "")).strip(),
        "secure": os.environ.get("SMTP_SECURE", "tls").strip().lower(),
        "from_addr": os.environ.get("SMTP_FROM", os.environ.get("MAIL_FROM", "OmniTactica <noreply@omnitactica.com>")).strip(),
        "app_url": os.environ.get("APP_URL", "https://omnitactica.com").rstrip("/")
    }


def send_password_reset_email(to_email: str, reset_token: str, reset_code: str, display_name: Optional[str] = None) -> Dict[str, Any]:
    """Dispatches a password reset email with a 6-digit code and 1-click reset URL."""
    config = get_email_config()
    app_url = config["app_url"]
    reset_url = f"{app_url}/login?view=reset&token={urllib.parse.quote(reset_token)}&email={urllib.parse.quote(to_email)}"
    name_greeting = f"Commander {display_name}" if display_name else "Commander"

    subject = "OmniTactica - Password Reset Request"
    
    text_content = f"""Greetings {name_greeting},

We received a request to reset your OmniTactica account password.

Your 6-Digit Verification Code:
{reset_code}

Or use this direct reset link:
{reset_url}

This code and link are valid for 1 hour (60 minutes).
If you did not request this password reset, please ignore this email. Your password will remain unchanged.

OmniTactica 40k Tournament Companion
{app_url}
"""

    html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {{ background-color: #07090e; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; }}
    .container {{ max-width: 520px; margin: 30px auto; background: #0f1523; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }}
    .header {{ padding: 28px 24px 20px; text-align: center; border-bottom: 1px solid #1e293b; background: linear-gradient(180deg, rgba(30, 41, 59, 0.5) 0%, transparent 100%); }}
    .logo-text {{ font-family: 'Cinzel', Georgia, serif; font-size: 22px; font-weight: 800; color: #f8fafc; letter-spacing: 2px; margin-top: 8px; }}
    .subhead {{ font-size: 12px; color: #94a3b8; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px; }}
    .body {{ padding: 28px 28px 32px; font-size: 14px; line-height: 1.6; color: #cbd5e1; }}
    .code-box {{ margin: 22px 0; padding: 18px; background: #070b14; border: 1px solid #1e293b; border-radius: 12px; text-align: center; }}
    .code-label {{ font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #94a3b8; margin-bottom: 8px; font-weight: 700; }}
    .code {{ font-family: 'JetBrains Mono', Courier, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #38bdf8; text-shadow: 0 0 12px rgba(56, 189, 248, 0.4); }}
    .btn {{ display: block; background: #f59e0b; color: #0f172a !important; font-weight: 800; text-decoration: none; padding: 15px 24px; border-radius: 10px; text-align: center; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin: 24px 0 16px; font-family: 'JetBrains Mono', Courier, monospace; }}
    .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #1e293b; background: #090d18; }}
    .warning {{ font-size: 12px; color: #94a3b8; background: rgba(148, 163, 184, 0.08); padding: 12px; border-radius: 8px; margin-top: 20px; }}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div style="font-size: 36px; line-height: 1;">⚔️</div>
      <div class="logo-text">OMNITACTICA</div>
      <div class="subhead">Warhammer 40k Competitor Network</div>
    </div>
    <div class="body">
      <p style="margin-top: 0;">Greetings <strong>{name_greeting}</strong>,</p>
      <p>We received a request to reset the password for your OmniTactica account (<strong>{to_email}</strong>).</p>
      
      <div class="code-box">
        <div class="code-label">Verification Code</div>
        <div class="code">{reset_code}</div>
      </div>

      <p style="text-align: center; color: #94a3b8; font-size: 13px;">Enter this code on the reset screen, or click the button below directly:</p>

      <a href="{reset_url}" class="btn" target="_blank">Reset Password Now</a>

      <div class="warning">
        ⏳ <strong>Security Note:</strong> This reset code and link will expire in <strong>60 minutes</strong>. If you did not request this password change, no action is needed; your password remains unchanged.
      </div>
    </div>
    <div class="footer">
      OmniTactica &bull; Warhammer 40k Elo, Tournament Companion & Live Game Tracker<br>
      <a href="{app_url}" style="color: #38bdf8; text-decoration: none;">{app_url}</a>
    </div>
  </div>
</body>
</html>
"""

    if not config["host"]:
        logger.info(f"📧 [DEV EMAIL SIMULATOR] Password reset for {to_email}: Code={reset_code} | Link={reset_url}")
        return {
            "success": True,
            "simulated": True,
            "to_email": to_email,
            "reset_code": reset_code,
            "reset_url": reset_url
        }

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = config["from_addr"]
        msg["To"] = to_email

        part1 = MIMEText(text_content, "plain", "utf-8")
        part2 = MIMEText(html_content, "html", "utf-8")
        msg.attach(part1)
        msg.attach(part2)

        host = config["host"]
        port = config["port"]
        user = config["user"]
        pwd = config["password"]
        secure = config["secure"]

        if secure == "ssl" or port == 465:
            server = smtplib.SMTP_SSL(host, port, timeout=12)
        else:
            server = smtplib.SMTP(host, port, timeout=12)
            if secure != "none":
                server.starttls()

        import email.utils
        sender_email = email.utils.parseaddr(config["from_addr"])[1] or config["from_addr"]
        recipient_email = email.utils.parseaddr(to_email)[1] or to_email

        try:
            server.sendmail(sender_email, [recipient_email], msg.as_string())
        except smtplib.SMTPResponseException as resp_err:
            # If Resend rejects unverified domain with 550, automatically retry with onboarding@resend.dev
            if resp_err.smtp_code == 550 and "resend.com" in host and sender_email != "onboarding@resend.dev":
                logger.warning(f"⚠️ Resend domain '{sender_email}' not verified (550). Retrying with 'onboarding@resend.dev'...")
                msg.replace_header("From", "OmniTactica <onboarding@resend.dev>")
                server.sendmail("onboarding@resend.dev", [recipient_email], msg.as_string())
            else:
                raise
        server.quit()
        logger.info(f"✅ Password reset email successfully delivered to {to_email}")
        return {"success": True, "simulated": False, "to_email": to_email}
    except Exception as e:
        logger.error(f"❌ Failed to dispatch password reset email to {to_email}: {e}")
        logger.warning(f"📧 [FALLBACK CODE] Reset code for {to_email}: {reset_code}")
        return {"success": False, "error": str(e), "to_email": to_email, "simulated": True, "reset_code": reset_code}

