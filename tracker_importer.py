"""
Programmatic Game History Importer for Tabletop Battles (Goonhammer) & Official GW App.

Supports:
1. Tabletop Battles Cloud Sync via AWS Cognito USER_SRP_AUTH (us-east-1_mn7BKd0lb)
   -> GET https://api.administratum.net/ttb/games/list
2. Tabletop Battles Live Observer / Game Link Code
   -> wss://cpu46vdwg0.execute-api.us-east-1.amazonaws.com/default/?ObserverCode={code}
   -> GET https://api.administratum.net/ttb/games/links/lookup/{code}
3. Universal Scorecard Parser for:
   - Tabletop Battles JSON (GameEnvelope, Game, GameCore, ObserverPOC, ITCBA)
   - Tabletop Battles Share / Export Text Summaries (40k 10e/11e & AoS 4e)
   - Official GW App (Warhammer 40,000: The App War Journal / Command Bunker) Text Summaries

All imported games are normalized as Completed matches (is_finished=True, status='completed')
and saved strictly to PostgreSQL `tracker_games` (never Firestore).
"""

import base64
import datetime
import hashlib
import hmac
import json
import logging
import re
import secrets
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ============================================================================
# 1. TABLETOP BATTLES (GOONHAMMER) AWS COGNITO & API CONSTANTS
# ============================================================================
TTB_COGNITO_REGION = "us-east-1"
TTB_COGNITO_USER_POOL_ID = "us-east-1_mn7BKd0lb"
TTB_COGNITO_POOL_NAME = "mn7BKd0lb"
TTB_COGNITO_CLIENT_IDS = [
    "ssqsvlalhqs59vhetfnkmj3m3",  # Tabletop Battles mobile app (Flutter)
    "1d4o11ossdv7n4rrkn93mj0g3l",  # Administratum / TTB web client
]
TTB_COGNITO_URL = f"https://cognito-idp.{TTB_COGNITO_REGION}.amazonaws.com/"

TTB_API_BASES = [
    "https://api.administratum.net",
    "https://83prsr19g0.execute-api.us-east-1.amazonaws.com",
]
TTB_OBSERVER_WS_HOST = "cpu46vdwg0.execute-api.us-east-1.amazonaws.com"
TTB_OBSERVER_WS_PATH = "/default/?ObserverCode="

# RFC 5054 3072-bit prime modulus N and generator g=2 used by AWS Cognito SRP
_SRP_N_HEX = (
    "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74"
    "020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F1437"
    "4FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED"
    "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF05"
    "98DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB"
    "9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B"
    "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF695581718"
    "3995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33"
    "A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7"
    "ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864"
    "D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E2"
    "08E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF"
)
_SRP_N = int(_SRP_N_HEX, 16)
_SRP_G = 2


def _pad_hex(val: int) -> str:
    """Pads an integer to Cognito's signed big-endian hex representation."""
    h = format(val, "x")
    if len(h) % 2 == 1:
        h = "0" + h
    elif h[0] in "89abcdefABCDEF":
        h = "00" + h
    return h


def _hex_hash(hex_str: str) -> str:
    return hashlib.sha256(bytes.fromhex(hex_str)).hexdigest()


def _cognito_now_timestamp() -> str:
    """Formats UTC timestamp in Cognito's exact 'EEE MMM d HH:mm:ss UTC yyyy' format."""
    now = datetime.datetime.now(datetime.timezone.utc)
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    dow = days[now.weekday()]
    mon = months[now.month - 1]
    return f"{dow} {mon} {now.day} {now.hour:02d}:{now.minute:02d}:{now.second:02d} UTC {now.year}"


def _compute_cognito_hkdf(ikm: bytes, salt: bytes) -> bytes:
    """Computes the 16-byte AWS Cognito SRP 'Caldera Derived Key'."""
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    info = b"Caldera Derived Key\x01"
    okm = hmac.new(prk, info, hashlib.sha256).digest()
    return okm[:16]


def _get_demo_ttb_games() -> List[Dict[str, Any]]:
    """Returns authentic Tabletop Battles GameEnvelope fixtures for demo/testing."""
    return [
        {
            "id": "ttb-cloud-40k-pariah-001",
            "gameType": "wh40k10e",
            "gameDate": "2026-09-28T18:30:00Z",
            "isFinished": True,
            "wentFirstRollOff": "firstPlayer",
            "mission": {
                "packId": "pariahNexus",
                "packName": "Pariah Nexus Tournament Companion",
                "missionId": "takeAndHold",
                "missionName": "Take and Hold",
                "deploymentMapName": "Tipping Point",
                "selectedMissionRules": ["Raise Banners"],
            },
            "players": [
                {
                    "name": "Innes Wilson",
                    "faction": {
                        "id": "adeptusCustodes",
                        "name": "Adeptus Custodes",
                        "subtitle": "Shield Host",
                    },
                    "primaries": [
                        {"id": "takeAndHold", "name": "Take and Hold", "scores": [0, 10, 15, 15, 10]}
                    ],
                    "secondaries": [
                        {"id": "cleanse", "name": "Cleanse", "categoryId": "tacticalMissions", "drawnInRound": 0, "discardedInRound": 0, "scores": [4, 0, 0, 0, 0]},
                        {"id": "sabotage", "name": "Sabotage", "categoryId": "tacticalMissions", "drawnInRound": 0, "discardedInRound": 0, "scores": [0, 0, 0, 0, 0]},
                        {"id": "assassination", "name": "Assassination", "categoryId": "tacticalMissions", "drawnInRound": 1, "discardedInRound": 1, "scores": [0, 5, 0, 0, 0]},
                        {"id": "extendBattleLines", "name": "Extend Battle Lines", "categoryId": "tacticalMissions", "drawnInRound": 1, "discardedInRound": 1, "scores": [0, 5, 0, 0, 0]},
                        {"id": "secureNoMansLand", "name": "Secure No Man's Land", "categoryId": "tacticalMissions", "drawnInRound": 2, "discardedInRound": 2, "scores": [0, 0, 5, 0, 0]},
                        {"id": "bringItDown", "name": "Bring It Down", "categoryId": "tacticalMissions", "drawnInRound": 2, "discardedInRound": 2, "scores": [0, 0, 4, 0, 0]},
                        {"id": "defendStronghold", "name": "Defend Stronghold", "categoryId": "tacticalMissions", "drawnInRound": 3, "discardedInRound": 3, "scores": [0, 0, 0, 6, 0]},
                        {"id": "overwhelmingForce", "name": "Overwhelming Force", "categoryId": "tacticalMissions", "drawnInRound": 3, "discardedInRound": 4, "scores": [0, 0, 0, 0, 5]},
                        {"id": "recoverAssets", "name": "Recover Assets", "categoryId": "tacticalMissions", "drawnInRound": 4, "discardedInRound": 4, "scores": [0, 0, 0, 0, 0]},
                    ],
                    "isBattleReady": True,
                    "cpRemaining": 2,
                    "totalScore": 94,
                },
                {
                    "name": "Vik Vijay",
                    "faction": {
                        "id": "aeldari",
                        "name": "Aeldari",
                        "subtitle": "Battle Host",
                    },
                    "primaries": [
                        {"id": "takeAndHold", "name": "Take and Hold", "scores": [0, 10, 10, 10, 5]}
                    ],
                    "secondaries": [
                        {"id": "engageOnAllFronts", "name": "Engage on All Fronts", "categoryId": "tacticalMissions", "drawnInRound": 0, "discardedInRound": 0, "scores": [4, 0, 0, 0, 0]},
                        {"id": "behindEnemyLines", "name": "Behind Enemy Lines", "categoryId": "tacticalMissions", "drawnInRound": 0, "discardedInRound": 0, "scores": [0, 0, 0, 0, 0]},
                        {"id": "investigateSignals", "name": "Investigate Signals", "categoryId": "tacticalMissions", "drawnInRound": 1, "discardedInRound": 1, "scores": [0, 4, 0, 0, 0]},
                        {"id": "stormHostileObjective", "name": "Storm Hostile Objective", "categoryId": "tacticalMissions", "drawnInRound": 1, "discardedInRound": 2, "scores": [0, 0, 5, 0, 0]},
                        {"id": "noPrisoners", "name": "No Prisoners", "categoryId": "tacticalMissions", "drawnInRound": 2, "discardedInRound": 2, "scores": [0, 0, 0, 0, 0]},
                        {"id": "areaDenial", "name": "Area Denial", "categoryId": "tacticalMissions", "drawnInRound": 3, "discardedInRound": 3, "scores": [0, 0, 0, 5, 0]},
                        {"id": "aTemptingTarget", "name": "A Tempting Target", "categoryId": "tacticalMissions", "drawnInRound": 3, "discardedInRound": 3, "scores": [0, 0, 0, 5, 0]},
                        {"id": "markedForDeath", "name": "Marked for Death", "categoryId": "tacticalMissions", "drawnInRound": 4, "discardedInRound": 4, "scores": [0, 0, 0, 0, 5]},
                        {"id": "cullTheHorde", "name": "Cull the Horde", "categoryId": "tacticalMissions", "drawnInRound": 4, "discardedInRound": None, "scores": [0, 0, 0, 0, 0]},
                    ],
                    "isBattleReady": True,
                    "cpRemaining": 1,
                    "totalScore": 73,
                },
            ],
        },
        {
            "id": "ttb-cloud-aos-ghb-002",
            "gameType": "aos4e",
            "gameDate": "2026-09-25T14:00:00Z",
            "isFinished": True,
            "wentFirstRollOff": "firstPlayer",
            "priorityRollOffs": ["firstPlayer", "secondPlayer", "secondPlayer", "firstPlayer", "firstPlayer"],
            "mission": {
                "packId": "ghb2024",
                "packName": "General's Handbook 2024-25",
                "missionId": "borderWar",
                "missionName": "Border War",
                "deploymentMapName": "Standard Battleplan",
            },
            "players": [
                {
                    "name": "Innes Wilson",
                    "faction": {
                        "id": "stormcastEternals",
                        "name": "Stormcast Eternals",
                        "subtitle": "Vanguard Wing",
                    },
                    "primaries": [
                        {"id": "borderWar", "name": "Border War", "scores": [6, 6, 5, 6, 6]}
                    ],
                    "battleTactics": [
                        {"id": "takeTheFlanks", "name": "Take the Flanks", "scores": [4, 0, 0, 0, 0]},
                        {"id": "seizeTheCentre", "name": "Seize the Centre", "scores": [0, 4, 0, 0, 0]},
                        {"id": "slayTheEntourage", "name": "Slay the Entourage", "scores": [0, 0, 4, 0, 0]},
                        {"id": "doNotWaver", "name": "Do Not Waver", "scores": [0, 0, 0, 4, 0]},
                        {"id": "takeTheirLand", "name": "Take Their Land", "scores": [0, 0, 0, 0, 4]},
                    ],
                    "cpRemaining": 1,
                    "totalScore": 49,
                },
                {
                    "name": "David Gaylard",
                    "faction": {
                        "id": "skaven",
                        "name": "Skaven",
                        "subtitle": "Warpcog Convocation",
                    },
                    "primaries": [
                        {"id": "borderWar", "name": "Border War", "scores": [4, 5, 6, 4, 4]}
                    ],
                    "battleTactics": [
                        {"id": "takeTheFlanks", "name": "Take the Flanks", "scores": [4, 0, 0, 0, 0]},
                        {"id": "seizeTheCentre", "name": "Seize the Centre", "scores": [0, 4, 0, 0, 0]},
                        {"id": "attackOnTwoFronts", "name": "Attack on Two Fronts", "scores": [0, 0, 4, 0, 0]},
                        {"id": "ordainedCharge", "name": "Ordained Charge", "scores": [0, 0, 0, 0, 4]},
                    ],
                    "cpRemaining": 0,
                    "totalScore": 39,
                },
            ],
        },
    ]


def authenticate_ttb_cognito(username: str, password: str, timeout: int = 10) -> Dict[str, Any]:
    """
    Authenticates against Tabletop Battles / Goonhammer AWS Cognito User Pool
    using pure-Python USER_SRP_AUTH.
    Returns {"id_token": ..., "access_token": ..., "refresh_token": ..., "username": ...}.
    """
    username = (username or "").strip()
    if not username or not password:
        raise ValueError("Tabletop Battles email/username and password are required.")

    if username.lower() in ("demo@tabletopbattles.com", "demo@goonhammer.com"):
        return {
            "id_token": "DEMO_TTB_SYNC_TOKEN",
            "access_token": "DEMO_TTB_SYNC_TOKEN",
            "refresh_token": "DEMO_TTB_REFRESH_TOKEN",
            "username": username,
        }

    k = int(_hex_hash(_pad_hex(_SRP_N) + _pad_hex(_SRP_G)), 16)
    small_a = secrets.randbits(1024) % _SRP_N
    large_a = pow(_SRP_G, small_a, _SRP_N)
    if large_a % _SRP_N == 0:
        raise RuntimeError("Invalid SRP_A generated.")

    last_err = None
    for client_id in TTB_COGNITO_CLIENT_IDS:
        try:
            init_payload = {
                "AuthFlow": "USER_SRP_AUTH",
                "ClientId": client_id,
                "AuthParameters": {
                    "USERNAME": username,
                    "SRP_A": _pad_hex(large_a),
                },
            }
            req = urllib.request.Request(
                TTB_COGNITO_URL,
                data=json.dumps(init_payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/x-amz-json-1.1",
                    "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
                    "User-Agent": "Dart/3.5 (dart:io)",
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    challenge_data = json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as he:
                err_body = he.read().decode("utf-8", errors="ignore")
                try:
                    err_json = json.loads(err_body)
                    msg = err_json.get("message") or err_json.get("__type") or err_body
                except Exception:
                    msg = err_body
                last_err = ValueError(f"Tabletop Battles login failed: {msg}")
                if "UserNotFoundException" in err_body or "NotAuthorizedException" in err_body:
                    raise last_err
                continue

            if challenge_data.get("ChallengeName") != "PASSWORD_VERIFIER":
                raise ValueError(f"Unexpected Cognito challenge: {challenge_data.get('ChallengeName')}")

            params = challenge_data.get("ChallengeParameters") or {}
            user_id_for_srp = params.get("USER_ID_FOR_SRP") or username
            srp_b = int(params["SRP_B"], 16)
            salt_int = int(params["SALT"], 16)
            secret_block_b64 = params["SECRET_BLOCK"]

            if srp_b % _SRP_N == 0:
                raise ValueError("Invalid SRP_B from server.")

            u_val = int(_hex_hash(_pad_hex(large_a) + _pad_hex(srp_b)), 16)
            if u_val == 0:
                raise ValueError("Invalid SRP U parameter.")

            user_pass_hash = hashlib.sha256(
                f"{TTB_COGNITO_POOL_NAME}{user_id_for_srp}:{password}".encode("utf-8")
            ).hexdigest()
            x_val = int(_hex_hash(_pad_hex(salt_int) + user_pass_hash), 16)

            g_mod_pow_xn = pow(_SRP_G, x_val, _SRP_N)
            int_val2 = (srp_b - k * g_mod_pow_xn) % _SRP_N
            s_val = pow(int_val2, small_a + u_val * x_val, _SRP_N)

            hkdf_key = _compute_cognito_hkdf(
                bytes.fromhex(_pad_hex(s_val)),
                bytes.fromhex(_pad_hex(u_val)),
            )

            timestamp = _cognito_now_timestamp()
            secret_block_bytes = base64.b64decode(secret_block_b64)
            msg_bytes = (
                TTB_COGNITO_POOL_NAME.encode("utf-8")
                + user_id_for_srp.encode("utf-8")
                + secret_block_bytes
                + timestamp.encode("utf-8")
            )
            signature = base64.b64encode(hmac.new(hkdf_key, msg_bytes, hashlib.sha256).digest()).decode("utf-8")

            verify_payload = {
                "ChallengeName": "PASSWORD_VERIFIER",
                "ClientId": client_id,
                "ChallengeResponses": {
                    "USERNAME": user_id_for_srp,
                    "PASSWORD_CLAIM_SECRET_BLOCK": secret_block_b64,
                    "TIMESTAMP": timestamp,
                    "PASSWORD_CLAIM_SIGNATURE": signature,
                },
            }
            if challenge_data.get("Session"):
                verify_payload["Session"] = challenge_data["Session"]

            req2 = urllib.request.Request(
                TTB_COGNITO_URL,
                data=json.dumps(verify_payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/x-amz-json-1.1",
                    "X-Amz-Target": "AWSCognitoIdentityProviderService.RespondToAuthChallenge",
                    "User-Agent": "Dart/3.5 (dart:io)",
                },
            )
            try:
                with urllib.request.urlopen(req2, timeout=timeout) as resp2:
                    auth_res = json.loads(resp2.read().decode("utf-8"))
            except urllib.error.HTTPError as he2:
                err_body2 = he2.read().decode("utf-8", errors="ignore")
                try:
                    err_json2 = json.loads(err_body2)
                    msg2 = err_json2.get("message") or err_json2.get("__type") or err_body2
                except Exception:
                    msg2 = err_body2
                raise ValueError(f"Tabletop Battles authentication failed: {msg2}")

            tokens = auth_res.get("AuthenticationResult") or {}
            return {
                "id_token": tokens.get("IdToken"),
                "access_token": tokens.get("AccessToken"),
                "refresh_token": tokens.get("RefreshToken"),
                "username": user_id_for_srp,
            }
        except ValueError:
            raise
        except Exception as e:
            last_err = e

    raise ValueError(f"Unable to authenticate with Tabletop Battles: {last_err}")


def fetch_ttb_cloud_games(
    id_token: Optional[str] = None,
    access_token: Optional[str] = None,
    timeout: int = 12,
) -> List[Dict[str, Any]]:
    """
    Fetches synced games from Tabletop Battles Cloud Sync (`GET /ttb/games/list`).
    Tries all valid header combinations (`Bearer <id_token>`, `Bearer <access_token>`, + `Identity`).
    """
    token_primary = (id_token or access_token or "").strip()
    if token_primary.lower().startswith("bearer "):
        token_primary = token_primary[7:].strip()
    if not token_primary:
        raise ValueError("Missing Tabletop Battles authentication token.")

    if token_primary == "DEMO_TTB_SYNC_TOKEN":
        return _get_demo_ttb_games()

    token_secondary = (access_token or id_token or token_primary).strip()
    if token_secondary.lower().startswith("bearer "):
        token_secondary = token_secondary[7:].strip()

    header_candidates = [
        {"Authorization": f"Bearer {token_primary}", "Identity": token_primary},
        {"Authorization": token_secondary, "Identity": token_primary},
        {"Authorization": f"Bearer {token_secondary}", "Identity": token_primary},
        {"Authorization": token_primary},
    ]

    last_err = None
    for base_url in TTB_API_BASES:
        url = f"{base_url}/ttb/games/list"
        for hdrs in header_candidates:
            req_headers = {
                "User-Agent": "Dart/3.5 (dart:io)",
                "Accept": "application/json",
                **hdrs,
            }
            req = urllib.request.Request(url, headers=req_headers, method="GET")
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    raw = resp.read().decode("utf-8", errors="ignore")
                    data = json.loads(raw) if raw.strip() else []
                    return _extract_ttb_envelope_games(data)
            except urllib.error.HTTPError as he:
                body = he.read().decode("utf-8", errors="ignore")
                last_err = f"HTTP {he.code}: {body[:200]}"
            except Exception as e:
                last_err = str(e)

    raise ValueError(f"Failed to fetch games from Tabletop Battles Cloud Sync ({last_err}).")


def fetch_ttb_game_by_code(
    code_or_url: str,
    id_token: Optional[str] = None,
    timeout: int = 8,
) -> Dict[str, Any]:
    """
    Downloads a Tabletop Battles game using an Observer Code, Game Link Code,
    or ObserverPOC URL.
    1. First attempts the public WebSocket stream:
       wss://cpu46vdwg0.execute-api.us-east-1.amazonaws.com/default/?ObserverCode={code}
    2. If an auth token is provided, also tries:
       GET https://api.administratum.net/ttb/games/links/lookup/{code}
       GET https://api.administratum.net/ttb/games/observe/code/{code}
    """
    raw = (code_or_url or "").strip()
    if not raw:
        raise ValueError("Please provide a Tabletop Battles Observer Code or Game Link Code.")

    # Extract code if user pasted full ObserverPOC URL or query string
    code = raw
    if "code=" in raw.lower() or "observercode=" in raw.lower():
        parsed = urllib.parse.urlparse(raw)
        qs = urllib.parse.parse_qs(parsed.query)
        code = (
            (qs.get("code") or qs.get("Code") or qs.get("ObserverCode") or qs.get("observerCode") or [raw])[0]
        ).strip()
    elif "/" in raw:
        code = raw.rstrip("/").split("/")[-1].strip()

    code = re.sub(r"[^A-Za-z0-9_-]", "", code)
    if not code:
        raise ValueError("Invalid Tabletop Battles code format.")

    if code.upper() == "DEMO40K":
        return _get_demo_ttb_games()[0]
    if code.upper() == "DEMOAOS":
        return _get_demo_ttb_games()[1]

    # 1. Try REST lookup if authenticated token is provided
    if id_token:
        tok = id_token[7:].strip() if id_token.lower().startswith("bearer ") else id_token.strip()
        for ep in [f"/ttb/games/links/lookup/{code}", f"/ttb/games/observe/code/{code}"]:
            for base_url in TTB_API_BASES:
                try:
                    req = urllib.request.Request(
                        f"{base_url}{ep}",
                        headers={
                            "User-Agent": "Dart/3.5 (dart:io)",
                            "Accept": "application/json",
                            "Authorization": f"Bearer {tok}",
                            "Identity": tok,
                        },
                    )
                    with urllib.request.urlopen(req, timeout=timeout) as resp:
                        data = json.loads(resp.read().decode("utf-8"))
                        games = _extract_ttb_envelope_games(data)
                        if games:
                            return games[0]
                except Exception:
                    pass

    # 2. Connect to Tabletop Battles public Observer WebSocket
    return _fetch_ttb_observer_websocket(code, timeout=timeout)


def _fetch_ttb_observer_websocket(code: str, timeout: int = 8) -> Dict[str, Any]:
    """
    Performs a minimal RFC 6455 WebSocket handshake with Tabletop Battles'
    Observer WebSocket endpoint, sends `{"action": "get_data"}`, and reads the game JSON.
    """
    ctx = ssl.create_default_context()
    with socket.create_connection((TTB_OBSERVER_WS_HOST, 443), timeout=timeout) as sock:
        with ctx.wrap_socket(sock, server_hostname=TTB_OBSERVER_WS_HOST) as ssock:
            ws_key = base64.b64encode(secrets.token_bytes(16)).decode("ascii")
            path = f"{TTB_OBSERVER_WS_PATH}{urllib.parse.quote(code)}"
            handshake = (
                f"GET {path} HTTP/1.1\r\n"
                f"Host: {TTB_OBSERVER_WS_HOST}\r\n"
                f"Upgrade: websocket\r\n"
                f"Connection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {ws_key}\r\n"
                f"Sec-WebSocket-Version: 13\r\n"
                f"Origin: https://s3.amazonaws.com\r\n\r\n"
            )
            ssock.sendall(handshake.encode("utf-8"))

            header_buf = b""
            while b"\r\n\r\n" not in header_buf:
                chunk = ssock.recv(4096)
                if not chunk:
                    break
                header_buf += chunk

            header_text, _, leftover = header_buf.partition(b"\r\n\r\n")
            first_line = header_text.splitlines()[0].decode("utf-8", errors="ignore") if header_text else ""
            if "101" not in first_line:
                body_msg = leftover.decode("utf-8", errors="ignore").strip()
                raise ValueError(
                    f"Tabletop Battles Observer Code '{code}' not found or expired ({body_msg or first_line})."
                )

            # Send masked WebSocket text frame: {"action": "get_data"}
            payload_bytes = b'{"action": "get_data"}'
            mask_key = secrets.token_bytes(4)
            masked_payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload_bytes))
            frame = bytearray([0x81, 0x80 | len(payload_bytes)]) + mask_key + masked_payload
            ssock.sendall(bytes(frame))

            # Read WebSocket response frame
            frame_buf = bytearray(leftover)
            while len(frame_buf) < 2:
                chunk = ssock.recv(4096)
                if not chunk:
                    break
                frame_buf.extend(chunk)

            if len(frame_buf) < 2:
                raise ValueError("Empty response from Tabletop Battles Observer stream.")

            payload_len = frame_buf[1] & 0x7F
            offset = 2
            if payload_len == 126:
                while len(frame_buf) < 4:
                    frame_buf.extend(ssock.recv(4096))
                payload_len = int.from_bytes(frame_buf[2:4], "big")
                offset = 4
            elif payload_len == 127:
                while len(frame_buf) < 10:
                    frame_buf.extend(ssock.recv(4096))
                payload_len = int.from_bytes(frame_buf[2:10], "big")
                offset = 10

            is_masked = bool(frame_buf[1] & 0x80)
            if is_masked:
                offset += 4

            while len(frame_buf) < offset + payload_len:
                chunk = ssock.recv(8192)
                if not chunk:
                    break
                frame_buf.extend(chunk)

            msg_bytes = bytes(frame_buf[offset : offset + payload_len])
            msg_json = json.loads(msg_bytes.decode("utf-8", errors="ignore"))
            games = _extract_ttb_envelope_games(msg_json)
            if not games:
                raise ValueError("No game data found in Tabletop Battles Observer response.")
            return games[0]


def _normalize_ttb_date_to_iso(raw_date: Any) -> Optional[str]:
    """Converts epoch-ms ints/floats/numeric-strings or ISO date strings into an ISO-8601 UTC string."""
    if raw_date is None:
        return None
    if isinstance(raw_date, (int, float)):
        if raw_date <= 0:
            return None
        ts = float(raw_date) / 1000.0 if raw_date > 1e11 else float(raw_date)
        try:
            return datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc).isoformat()
        except Exception:
            return None
    if isinstance(raw_date, str):
        s = raw_date.strip()
        if not s:
            return None
        if re.match(r"^\d{9,16}(?:\.\d+)?$", s):
            val = float(s)
            ts = val / 1000.0 if val > 1e11 else val
            try:
                return datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc).isoformat()
            except Exception:
                return None
        try:
            dt = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=datetime.timezone.utc)
            return dt.isoformat()
        except Exception:
            return s
    return None


def _extract_ttb_envelope_games(raw_data: Any) -> List[Dict[str, Any]]:
    """Unwraps GameEnvelopesList / GameEnvelope / Observer JSON into raw game dicts."""
    if isinstance(raw_data, str):
        raw_data = raw_data.strip()
        if not raw_data:
            return []
        raw_data = json.loads(raw_data)

    if isinstance(raw_data, list):
        out = []
        for item in raw_data:
            out.extend(_extract_ttb_envelope_games(item))
        return out

    if isinstance(raw_data, dict):
        # Check for list containers (combine all matching list keys such as games + coreGames)
        combined_lists: List[Dict[str, Any]] = []
        found_list_key = False
        for list_key in ("games", "coreGames", "envelopes", "items", "battles", "results"):
            if isinstance(raw_data.get(list_key), list):
                found_list_key = True
                combined_lists.extend(_extract_ttb_envelope_games(raw_data[list_key]))
        if found_list_key:
            return combined_lists

        # Check if it's a GameEnvelope wrapping `data` or `game` or `gameCore`
        for inner_key in ("data", "game", "gameCore", "envelope"):
            inner = raw_data.get(inner_key)
            if isinstance(inner, str):
                try:
                    inner = json.loads(inner)
                except Exception:
                    inner = None
            if isinstance(inner, dict) and any(
                k in inner for k in ("players", "teams", "gameType", "systemId", "mission", "primaries")
            ):
                merged = dict(inner)
                for meta_k in (
                    "id",
                    "gameId",
                    "gameType",
                    "systemId",
                    "gameSystemId",
                    "coreSystemId",
                    "edition",
                    "date",
                    "gameDate",
                    "createdDate",
                    "startDate",
                    "eventDate",
                    "createdOn",
                    "updatedOn",
                    "isFinished",
                ):
                    if meta_k in raw_data and (meta_k not in merged or merged.get(meta_k) in (None, "")):
                        merged[meta_k] = raw_data[meta_k]
                return [merged]

        # Check if raw_data is already a Game / GameCore / ITCBA battle dict
        if any(k in raw_data for k in ("players", "teams", "player1", "p1", "gameType", "systemId")):
            return [raw_data]

    return []


# ============================================================================
# 2. NORMALIZATION TO OMNITACTICA COMPLETED SCORECARD STATE
# ============================================================================

def _clean_card_slug(name_or_id: str) -> str:
    """Converts a secondary/tactic ID or name into a clean kebab-case cardId."""
    s = (name_or_id or "").strip()
    if "." in s:
        s = s.split(".")[-1]
    # Convert camelCase to kebab-case
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", s)
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s or "secondary-mission"


def _humanize_identifier(val: str) -> str:
    """Converts camelCase / dot.separated / snake_case identifiers to Title Case."""
    if not val:
        return ""
    s = str(val).strip()
    if "." in s:
        s = s.split(".")[-1]
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", s)
    s = s.replace("_", " ").replace("-", " ")
    return " ".join(w.capitalize() for w in s.split())


def _extract_ttb_faction_and_detachment(faction_obj: Any) -> Tuple[str, str]:
    """Extracts (faction_name, detachment_or_formation) from a Tabletop Battles player faction object."""
    if not faction_obj:
        return ("", "")
    if isinstance(faction_obj, str):
        return (_humanize_identifier(faction_obj), "")
    if not isinstance(faction_obj, dict):
        return ("", "")

    fac_name = faction_obj.get("name") or _humanize_identifier(faction_obj.get("id") or "")
    det_name = faction_obj.get("subtitle") or faction_obj.get("detachment") or ""

    parts = faction_obj.get("factionParts") or []
    if isinstance(parts, list) and parts:
        first_part = parts[0] if isinstance(parts[0], dict) else {}
        if not fac_name:
            fac_name = first_part.get("name") or _humanize_identifier(first_part.get("id") or "")
        if not det_name:
            subfactions = first_part.get("subfactions") or []
            if isinstance(subfactions, list) and subfactions:
                sf0 = subfactions[0]
                if isinstance(sf0, dict):
                    det_name = sf0.get("name") or _humanize_identifier(sf0.get("id") or "")
                elif isinstance(sf0, str):
                    det_name = _humanize_identifier(sf0)

    return (str(fac_name or "").strip(), str(det_name or "").strip())


def _detect_game_system(raw_game: Dict[str, Any], default_system: str = "40k") -> str:
    """Detects whether a raw game record is 'aos' or '40k'."""
    gtype = str(
        raw_game.get("gameType")
        or raw_game.get("systemId")
        or raw_game.get("gameSystem")
        or raw_game.get("game_system")
        or ""
    ).lower()
    if any(k in gtype for k in ("aos", "sigmar", "spearhead", "aoe4", "aoe3")):
        return "aos"
    if any(k in gtype for k in ("40k", "wh40k", "leviathan", "pariah", "ca25")):
        return "40k"

    # Inspect mission/pack names or battle tactics
    mission = raw_game.get("mission") if isinstance(raw_game.get("mission"), dict) else {}
    pack_str = f"{mission.get('packId', '')} {mission.get('packName', '')} {mission.get('missionName', '')}".lower()
    if any(k in pack_str for k in ("general's handbook", "ghb", "battleplan", "border war", "spearhead", "pb_24", "pb_25", "pb_26")):
        return "aos"

    players = raw_game.get("players") or []
    if isinstance(players, list):
        for p in players:
            if isinstance(p, dict) and (p.get("battleTactics") or p.get("grandStrategy")):
                return "aos"

    return "aos" if "aos" in (default_system or "").lower() else "40k"


def convert_ttb_game_to_omnitactica(
    raw_game: Dict[str, Any],
    importing_user: Optional[Dict[str, Any]] = None,
    default_system: str = "40k",
    source_label: str = "tabletop_battles",
) -> Optional[Dict[str, Any]]:
    """
    Converts a single Tabletop Battles (or ITCBA / structured) game dict into an
    OmniTactica completed game record ready for `db.save_tracker_game()`.

    Returns:
      {
        "match_id": "WH40K-TTB-...",
        "game_system": "40k" | "aos",
        "p1_name": ...,
        "p2_name": ...,
        "p1_faction": ...,
        "p2_faction": ...,
        "p1_detachment": ...,
        "p2_detachment": ...,
        "p1_score": int,
        "p2_score": int,
        "primary_mission": ...,
        "deployment": ...,
        "game_date": ISO str,
        "user_id_p1": ...,
        "user_id_p2": ...,
        "state": { ... full OmniTactica completed state ... }
      }
    """
    if not isinstance(raw_game, dict):
        return None

    # Skip explicitly deleted games
    if raw_game.get("isDeleted") is True:
        return None

    # Handle legacy ITCBA format {"player1": ..., "player2": ..., "battleDate": ...}
    if "player1" in raw_game and "player2" in raw_game and "players" not in raw_game:
        return _convert_itcba_game_to_omnitactica(raw_game, importing_user=importing_user)

    # Handle newer GameCore format (`teams` / `roundScores`) if `players` is not top-level
    if "teams" in raw_game and "players" not in raw_game:
        raw_game = _adapt_game_core_to_ttb_game(raw_game)

    players = raw_game.get("players") or []
    if not isinstance(players, list) or len(players) < 2:
        return None

    p1_raw = players[0] if isinstance(players[0], dict) else {}
    p2_raw = players[1] if isinstance(players[1], dict) else {}

    game_sys = _detect_game_system(raw_game, default_system=default_system)
    is_aos = game_sys == "aos"

    # Extract raw ID and generate deterministic match_id
    raw_id = str(
        raw_game.get("id")
        or raw_game.get("uuid")
        or raw_game.get("gameId")
        or raw_game.get("match_id")
        or ""
    ).strip()
    if not raw_id:
        sig = f"{raw_game.get('gameDate')}-{p1_raw.get('name')}-{p2_raw.get('name')}-{p1_raw.get('totalScore')}-{p2_raw.get('totalScore')}"
        raw_id = hashlib.sha256(sig.encode("utf-8")).hexdigest()[:12]

    short_hash = hashlib.sha256(raw_id.encode("utf-8")).hexdigest()[:8].upper()
    _src_map = {
        "tabletop_battles": ("WH40K-TTB", "AOS-TTB", "Tabletop Battles"),
        "battlebase": ("WH40K-BB", "AOS-BB", "BattleBase"),
        "newrecruit": ("WH40K-NR", "AOS-NR", "NewRecruit"),
        "championshub": ("WH40K-CH", "AOS-CH", "ChampionsHub"),
        "bcp": ("WH40K-BCP", "AOS-BCP", "Best Coast Pairings"),
        "milarki": ("WH40K-MLK", "AOS-MLK", "Milarki"),
        "gw_app": ("WH40K-GW", "AOS-GW", "GW App"),
    }
    p40k, paos, app_display_name = _src_map.get(
        str(source_label or "tabletop_battles").lower(),
        ("WH40K-TTB", "AOS-TTB", "Tabletop Battles"),
    )
    prefix = paos if is_aos else p40k
    match_id = f"{prefix}-{short_hash}"

    # Player names & user binding
    user_id = importing_user.get("id") if isinstance(importing_user, dict) else None
    user_display = (
        (importing_user.get("display_name") or importing_user.get("name") or importing_user.get("competitor_name") or "")
        if isinstance(importing_user, dict)
        else ""
    ).strip()

    p1_name = str(p1_raw.get("name") or "").strip()
    p2_name = str(p2_raw.get("name") or "").strip()

    if not p1_name or p1_name.lower() in ("you", "player 1", "player1"):
        p1_name = user_display or "Player 1"
    if not p2_name or p2_name.lower() in ("opponent", "player 2", "player2"):
        p2_name = "Opponent" if p2_name.lower() == "opponent" else "Player 2"

    uid_p1 = None
    uid_p2 = None
    if user_id:
        if user_display and p2_name.lower() == user_display.lower() and p1_name.lower() != user_display.lower():
            uid_p2 = user_id
        else:
            uid_p1 = user_id

    p1_fac, p1_det = _extract_ttb_faction_and_detachment(p1_raw.get("faction"))
    p2_fac, p2_det = _extract_ttb_faction_and_detachment(p2_raw.get("faction"))
    if not p1_fac:
        p1_fac = "Age of Sigmar" if is_aos else "Warhammer 40k"
    if not p2_fac:
        p2_fac = "Age of Sigmar" if is_aos else "Warhammer 40k"

    # Mission & Deployment metadata
    mission_obj = raw_game.get("mission") if isinstance(raw_game.get("mission"), dict) else {}
    mission_name = (
        mission_obj.get("missionName")
        or _humanize_identifier(mission_obj.get("missionId") or "")
        or raw_game.get("primary_mission")
        or ("Border War" if is_aos else "Take & Hold")
    )
    pack_name = (
        mission_obj.get("packName")
        or _humanize_identifier(mission_obj.get("packId") or "")
        or ("General's Handbook" if is_aos else "Chapter Approved")
    )
    deployment_name = (
        mission_obj.get("deploymentMapName")
        or _humanize_identifier(mission_obj.get("deploymentMapId") or mission_obj.get("deploymentId") or "")
        or raw_game.get("deployment")
        or ("Standard Deployment" if is_aos else "Search & Destroy")
    )
    rules_list = mission_obj.get("selectedMissionRules") or []
    mission_rule = (
        _humanize_identifier(rules_list[0])
        if isinstance(rules_list, list) and rules_list
        else (raw_game.get("mission_rule") or "Matched Play")
    )

    # First Turn / Initiative
    went_first_raw = str(raw_game.get("wentFirstRollOff") or raw_game.get("firstTurn") or "").lower()
    first_turn = "p2" if "second" in went_first_raw or went_first_raw in ("2", "p2", "player2") else "p1"

    # Historical Game Date
    raw_date = (
        raw_game.get("gameDate")
        or raw_game.get("date")
        or raw_game.get("createdDate")
        or raw_game.get("startDate")
        or raw_game.get("eventDate")
        or raw_game.get("battleDate")
        or raw_game.get("createdOn")
        or raw_game.get("created_at")
        or raw_game.get("updatedOn")
    )
    game_date_iso = (
        _normalize_ttb_date_to_iso(raw_date)
        or datetime.datetime.now(datetime.timezone.utc).isoformat()
    )

    edition_code, edition_label = detect_game_edition(raw_game, is_aos=is_aos, game_date_iso=game_date_iso)
    event_name = str(raw_game.get("eventName") or "").strip()

    if is_aos:
        p1_state, p1_total = _build_aos_player_state(p1_raw, p1_name, p1_fac, p1_det, edition=edition_code)
        p2_state, p2_total = _build_aos_player_state(p2_raw, p2_name, p2_fac, p2_det, edition=edition_code)
        if p1_raw.get("armyListText"):
            p1_state["armyListText"] = str(p1_raw["armyListText"])
        if p2_raw.get("armyListText"):
            p2_state["armyListText"] = str(p2_raw["armyListText"])

        priority_rolls = raw_game.get("priorityRollOffs") or []
        round_state = {}
        prev_first = None
        for r_idx in range(1, 6):
            r_first = first_turn if r_idx == 1 else "p1"
            if isinstance(priority_rolls, list) and len(priority_rolls) >= r_idx:
                pr = str(priority_rolls[r_idx - 1] or "").lower()
                if "second" in pr or pr in ("2", "p2", "player2"):
                    r_first = "p2"
                elif "first" in pr or pr in ("1", "p1", "player1"):
                    r_first = "p1"
            is_double = bool(r_idx > 1 and prev_first == r_first)
            round_state[str(r_idx)] = {
                "firstTurn": r_first,
                "isDoubleTurn": is_double,
            }
            prev_first = r_first

        state = {
            "id": raw_id,
            "match_id": match_id,
            "game_system": "aos",
            "gameSystem": "aos",
            "edition": edition_code,
            "edition_label": edition_label,
            "imported_source": source_label,
            "imported_app": app_display_name,
            "imported_raw_id": raw_id,
            "event_name": event_name,
            "game_date": game_date_iso,
            "started": True,
            "is_finished": True,
            "isFinished": True,
            "status": "completed",
            "round": 5,
            "currentRound": 5,
            "firstTurn": first_turn,
            "battleplan": {
                "name": mission_name,
                "pack": pack_name,
            },
            "roundState": round_state,
            "game": {
                "p1Name": p1_name,
                "p2Name": p2_name,
                "p1Faction": p1_fac,
                "p2Faction": p2_fac,
                "p1Detachments": [p1_det] if p1_det else [],
                "p2Detachments": [p2_det] if p2_det else [],
                "primary": mission_name,
                "deployment": deployment_name,
                "missionRule": mission_rule,
                "firstTurn": first_turn,
                "edition": edition_code,
                "editionLabel": edition_label,
                "eventName": event_name,
                "battleplan": {"name": mission_name, "pack": pack_name},
            },
            "p1": p1_state,
            "p2": p2_state,
            "p1Score": p1_total,
            "p2Score": p2_total,
            "user_id_p1": uid_p1,
            "user_id_p2": uid_p2,
        }
    else:
        p1_state, p1_total = _build_40k_player_state(p1_raw, p1_name, p1_fac, p1_det, edition=edition_code)
        p2_state, p2_total = _build_40k_player_state(p2_raw, p2_name, p2_fac, p2_det, edition=edition_code)
        if p1_raw.get("armyListText"):
            p1_state["armyListText"] = str(p1_raw["armyListText"])
        if p2_raw.get("armyListText"):
            p2_state["armyListText"] = str(p2_raw["armyListText"])

        state = {
            "id": raw_id,
            "match_id": match_id,
            "game_system": "40k",
            "gameSystem": "40k",
            "edition": edition_code,
            "edition_label": edition_label,
            "imported_source": source_label,
            "imported_app": app_display_name,
            "imported_raw_id": raw_id,
            "event_name": event_name,
            "game_date": game_date_iso,
            "started": True,
            "is_finished": True,
            "isFinished": True,
            "status": "completed",
            "round": 5,
            "currentRound": 5,
            "firstTurn": first_turn,
            "game": {
                "p1Name": p1_name,
                "p2Name": p2_name,
                "p1Faction": p1_fac,
                "p2Faction": p2_fac,
                "p1Detachments": [p1_det] if p1_det else [],
                "p2Detachments": [p2_det] if p2_det else [],
                "primary": mission_name,
                "p1Primary": mission_name,
                "deployment": deployment_name,
                "missionRule": mission_rule,
                "missionPack": pack_name,
                "edition": edition_code,
                "editionLabel": edition_label,
                "eventName": event_name,
                "firstTurn": first_turn,
            },
            "p1": p1_state,
            "p2": p2_state,
            "p1Score": p1_total,
            "p2Score": p2_total,
            "user_id_p1": uid_p1,
            "user_id_p2": uid_p2,
        }

    return {
        "match_id": match_id,
        "game_system": game_sys,
        "edition": edition_code,
        "edition_label": edition_label,
        "p1_name": p1_name,
        "p2_name": p2_name,
        "p1_faction": p1_fac,
        "p2_faction": p2_fac,
        "p1_detachment": p1_det,
        "p2_detachment": p2_det,
        "p1_score": p1_total,
        "p2_score": p2_total,
        "primary_mission": mission_name,
        "deployment": deployment_name,
        "mission_rule": mission_rule,
        "game_date": game_date_iso,
        "user_id_p1": uid_p1,
        "user_id_p2": uid_p2,
        "imported_source": source_label,
        "state": state,
    }


def detect_game_edition(
    raw_game: Dict[str, Any],
    is_aos: bool = False,
    game_date_iso: str = "",
) -> Tuple[str, str]:
    """
    Detects the historical or current Warhammer edition for an imported game:
      - '8th_itc' -> '8th Ed ITC'
      - '9th'     -> '9th Edition'
      - '10th'    -> '10th Edition'
      - '11th'    -> '11th Edition'
      - 'aos_3e'  -> 'AoS 3rd Edition'
      - 'aos_4e'  -> 'AoS 4th Edition'
    """
    norm_date = _normalize_ttb_date_to_iso(game_date_iso)
    if norm_date:
        game_date_iso = norm_date

    explicit_ed = str(raw_game.get("edition") or "").strip().lower()
    if explicit_ed in ("8th_itc", "8th", "8e", "itc"):
        return ("8th_itc", "8th Ed ITC")
    if explicit_ed in ("9th", "9e"):
        return ("9th", "9th Edition")
    if explicit_ed in ("10th", "10e"):
        return ("10th", "10th Edition")
    if explicit_ed in ("11th", "11e"):
        return ("11th", "11th Edition")
    if explicit_ed in ("aos_3e", "aos3e", "3e", "3rd"):
        return ("aos_3e", "AoS 3rd Edition")
    if explicit_ed in ("aos_4e", "aos4e", "4e", "4th"):
        return ("aos_4e", "AoS 4th Edition")

    gtype = " ".join([
        str(raw_game.get("gameType") or ""),
        str(raw_game.get("systemId") or ""),
        str(raw_game.get("gameSystemId") or ""),
        str(raw_game.get("coreSystemId") or ""),
    ]).strip().lower()
    mission_obj = raw_game.get("mission") if isinstance(raw_game.get("mission"), dict) else {}
    players = raw_game.get("players") or []

    # Collect all mission, pack, primary, and secondary IDs/names to inspect TTB dataset prefixes
    sec_and_pri_tokens: List[str] = []
    for p in players:
        if not isinstance(p, dict):
            continue
        for pr in (p.get("primaries") or []):
            if isinstance(pr, dict):
                sec_and_pri_tokens.append(str(pr.get("id") or ""))
                sec_and_pri_tokens.append(str(pr.get("name") or ""))
        for sc in (p.get("secondaries") or []):
            if isinstance(sc, dict):
                sec_and_pri_tokens.append(str(sc.get("id") or ""))
                sec_and_pri_tokens.append(str(sc.get("name") or ""))
                sec_and_pri_tokens.append(str(sc.get("categoryId") or ""))

    pack_str = " ".join([
        str(mission_obj.get("packId") or ""),
        str(mission_obj.get("packName") or ""),
        str(mission_obj.get("missionId") or ""),
        str(mission_obj.get("missionName") or ""),
        str(mission_obj.get("deploymentMapId") or ""),
        str(mission_obj.get("deploymentMapName") or ""),
        str(raw_game.get("packId") or ""),
        str(raw_game.get("packName") or ""),
        str(raw_game.get("missionId") or ""),
        str(raw_game.get("missionName") or ""),
        str(raw_game.get("mission_pack") or ""),
        str(raw_game.get("primary_mission") or ""),
        *sec_and_pri_tokens,
    ]).lower()

    if is_aos:
        if any(k in gtype for k in ("aos3", "3e", "3rd")) or any(
            k in pack_str for k in ("2021", "2022", "2023", "pb23", "pb_23", "andtor", "gallet", "ghur", "thondia", "dawnbringers", "3rd", "3e")
        ):
            return ("aos_3e", "AoS 3rd Edition")
        for p in players:
            if isinstance(p, dict) and (
                p.get("grandStrategy") or p.get("grand_strategy") or p.get("grandStrategyScore")
            ):
                return ("aos_3e", "AoS 3rd Edition")
        if not any(k in gtype for k in ("aos4", "4e", "4th")) and not any(
            k in pack_str for k in ("pb24", "pb_24", "pb25", "pb_25", "pb26", "pb_26", "2024", "2025", "2026", "fireandjade", "sandandbone", "cityofash")
        ):
            if game_date_iso and len(game_date_iso) >= 10 and game_date_iso[:10] < "2024-07-01":
                return ("aos_3e", "AoS 3rd Edition")
        return ("aos_4e", "AoS 4th Edition")

    # 40k Edition Detection
    if any(k in gtype for k in ("8e", "8th", "itc")) or any(
        k in pack_str for k in ("itc", "champions mission", "champions_mission", "8th")
    ):
        return ("8th_itc", "8th Ed ITC")

    if any(k in gtype for k in ("9e", "9th")) or any(
        k in pack_str
        for k in (
            "nephilim",
            "arks of omen",
            "arks_of_omen",
            "arksofomen",
            "warzone nachmund",
            "warzone_nachmund",
            "warzonenachmund",
            "tempest of war",
            "tempest_of_war",
            "tempestofwar",
            "octarius",
            "gt 2020",
            "gt 2021",
            "gt 2022",
            "gt2020",
            "gt2021",
            "gt2022",
            "eternal war",
            "eternal_war",
            "eternalwar",
            "wh40k9e",
            "9th",
        )
    ) or ("nachmund" in pack_str and "crusade" not in pack_str):
        return ("9th", "9th Edition")

    if any(k in gtype for k in ("11e", "11th")):
        return ("11th", "11th Edition")

    if any(k in gtype for k in ("10e", "10th")):
        return ("10th", "10th Edition")

    if any(
        k in pack_str
        for k in (
            "wh40k11e",
            "11th",
            "vanguard operation",
            "vanguard_operation",
            "search and scour",
            "search_and_scour",
            "core rulebook",
            "forward position",
            "forward-position",
            "forward-posision",
            "centre ground",
            "centre-ground",
            "burden of trust",
            "burden-of-trust",
        )
    ):
        return ("11th", "11th Edition")

    if any(
        k in pack_str for k in ("leviathan", "pariah", "ca25", "chapter approved 2025", "nachmund_crusade", "nachmundcrusade", "10th")
    ):
        return ("10th", "10th Edition")

    # Inspect player secondaries/primaries for unmistakable 8th ITC or 9th Edition signatures
    for p in players:
        if not isinstance(p, dict):
            continue
        for pr in (p.get("primaries") or []):
            if isinstance(pr, dict) and any(k in pr for k in ("hold", "holdMore", "kill", "killMore")):
                return ("8th_itc", "8th Ed ITC")
        secs = p.get("secondaries") or []
        sec_sum = 0
        for s in secs:
            if not isinstance(s, dict):
                continue
            pts_arr = s.get("scores") if isinstance(s.get("scores"), list) else (s.get("points") if isinstance(s.get("points"), list) else [])
            s_tot = sum(int(x or 0) for x in pts_arr if isinstance(x, (int, float))) if pts_arr else int(s.get("totalScore") or (s.get("points") if isinstance(s.get("points"), (int, float)) else 0) or 0)
            sec_sum += s_tot
        pri_sum = 0
        for pr in (p.get("primaries") or []):
            if isinstance(pr, dict):
                p_arr = pr.get("scores") if isinstance(pr.get("scores"), list) else (pr.get("points") if isinstance(pr.get("points"), list) else [])
                pri_sum += sum(int(x or 0) for x in p_arr if isinstance(x, (int, float)))
        is_modern_date = bool(game_date_iso and len(game_date_iso) >= 10 and game_date_iso[:10] >= "2023-06-20")
        if not is_modern_date and (
            int(p.get("secondaryScore") or 0) > 40
            or (sec_sum > 40 and len(secs) <= 3 and pri_sum <= 45)
        ):
            return ("9th", "9th Edition")

    # Check historical date if not explicitly 10e
    if "10e" not in gtype and "10th" not in gtype and not any(
        k in pack_str for k in ("leviathan", "pariah", "ca25", "nachmund_crusade", "nachmundcrusade", "10th")
    ):
        if game_date_iso and len(game_date_iso) >= 10 and game_date_iso[:4].isdigit():
            ymd = game_date_iso[:10]
            if ymd < "2020-07-25":
                return ("8th_itc", "8th Ed ITC")
            if ymd < "2023-06-15":
                return ("9th", "9th Edition")

    return ("10th", "10th Edition")


def _build_40k_player_state(
    p_raw: Dict[str, Any],
    p_name: str,
    p_fac: str,
    p_det: str,
    edition: str = "10th",
) -> Tuple[Dict[str, Any], int]:
    """Builds a 40k player state dict (`rounds`, `hand`, `battleReady`, `cp`) and total VP."""
    primaries = p_raw.get("primaries") or []
    pri_scores = [0, 0, 0, 0, 0]
    if isinstance(primaries, list) and primaries:
        for prim in primaries:
            if isinstance(prim, dict):
                p_arr = prim.get("scores") if isinstance(prim.get("scores"), list) else (prim.get("points") if isinstance(prim.get("points"), list) else None)
                if isinstance(p_arr, list):
                    for idx in range(len(p_arr)):
                        val = p_arr[idx]
                        if isinstance(val, (int, float)):
                            pri_scores[min(4, idx)] += int(val)
    elif isinstance(p_raw.get("primaryScores") or p_raw.get("primary"), list):
        p_arr = p_raw.get("primaryScores") or p_raw.get("primary")
        for idx in range(len(p_arr)):
            pri_scores[min(4, idx)] += int(p_arr[idx] or 0)

    # Extract secondaries per round and build hand cards (including unscored, held, and discarded cards)
    secondaries = p_raw.get("secondaries") or []
    sec_round_totals = [0, 0, 0, 0, 0]
    sec_round_items: List[List[Dict[str, Any]]] = [[], [], [], [], []]
    hand: List[Dict[str, Any]] = []

    if isinstance(secondaries, list):
        has_tactical = any(
            isinstance(s, dict) and "tactical" in str(s.get("categoryId") or s.get("category") or "").lower()
            for s in secondaries
        )
        for sec in secondaries:
            if not isinstance(sec, dict):
                continue
            raw_sec_id = str(sec.get("id") or sec.get("cardId") or "").strip()
            raw_sec_name = str(sec.get("name") or sec.get("title") or "").strip()
            if not raw_sec_id and not raw_sec_name:
                continue

            sec_name = raw_sec_name or _humanize_identifier(raw_sec_id or "Secondary Mission")
            card_id = _clean_card_slug(raw_sec_id or sec_name)
            cat_id = str(sec.get("categoryId") or sec.get("category") or "").lower()

            drawn_r: Optional[int] = None
            if sec.get("drawnInRound") is not None:
                try:
                    drawn_r = max(1, min(5, int(sec["drawnInRound"]) + 1))
                except (ValueError, TypeError):
                    drawn_r = None
            elif sec.get("drawnRound") is not None:
                try:
                    drawn_r = max(1, min(5, int(sec["drawnRound"])))
                except (ValueError, TypeError):
                    drawn_r = None
            elif sec.get("round") is not None:
                try:
                    drawn_r = max(1, min(5, int(sec["round"])))
                except (ValueError, TypeError):
                    drawn_r = None

            discarded_r: Optional[int] = None
            if sec.get("discardedInRound") is not None:
                try:
                    discarded_r = max(1, min(5, int(sec["discardedInRound"]) + 1))
                except (ValueError, TypeError):
                    discarded_r = None
            elif sec.get("discardedRound") is not None:
                try:
                    discarded_r = max(1, min(5, int(sec["discardedRound"])))
                except (ValueError, TypeError):
                    discarded_r = None

            was_discarded_start = bool(sec.get("wasDiscardedStartOfRound"))

            scores_arr = (
                sec.get("scores")
                if isinstance(sec.get("scores"), list)
                else (sec.get("points") if isinstance(sec.get("points"), list) else [])
            )

            round_scores_map: Dict[str, int] = {}
            scored_rounds: List[int] = []
            for r_idx in range(min(5, len(scores_arr))):
                pts = int(scores_arr[r_idx] or 0)
                if pts > 0:
                    r_num = r_idx + 1
                    round_scores_map[str(r_num)] = pts
                    scored_rounds.append(r_num)
                    sec_round_totals[r_idx] += pts

            # Handle flat secondary with totalScore/points but no per-round array
            if not scores_arr and (sec.get("totalScore") is not None or isinstance(sec.get("points"), (int, float))):
                pts = int(sec.get("totalScore") or (sec.get("points") if isinstance(sec.get("points"), (int, float)) else 0) or 0)
                if sec.get("scoredRound") is not None:
                    r_num = int(sec.get("scoredRound"))
                elif drawn_r is not None:
                    r_num = drawn_r
                elif discarded_r is not None:
                    r_num = discarded_r
                else:
                    r_num = 1
                r_num = max(1, min(5, r_num))
                if pts > 0:
                    round_scores_map[str(r_num)] = pts
                    scored_rounds.append(r_num)
                    sec_round_totals[r_num - 1] += pts

            is_recurring = ("fixed" in cat_id) or (len(scored_rounds) > 1) or (edition in ("9th", "8th_itc"))

            if round_scores_map:
                if is_recurring:
                    for r_num in scored_rounds:
                        pts = round_scores_map[str(r_num)]
                        sec_round_items[r_num - 1].append({
                            "cardId": card_id,
                            "name": sec_name,
                            "score": pts,
                            "points": pts,
                            "status": "scored",
                            "recurring": True,
                        })
                    hand.append({
                        "cardId": card_id,
                        "name": sec_name,
                        "recurring": True,
                        "status": "scored",
                        "roundScores": round_scores_map,
                        "points": sum(round_scores_map.values()),
                    })
                else:
                    only_r = scored_rounds[0]
                    pts = round_scores_map[str(only_r)]
                    start_r = drawn_r if (drawn_r is not None and drawn_r <= only_r) else only_r
                    for hr in range(start_r, only_r):
                        sec_round_items[hr - 1].append({
                            "cardId": card_id,
                            "name": sec_name,
                            "score": 0,
                            "points": 0,
                            "status": "held",
                            "drawnRound": start_r,
                            "scoredRound": only_r,
                        })
                    sec_round_items[only_r - 1].append({
                        "cardId": card_id,
                        "name": sec_name,
                        "score": pts,
                        "points": pts,
                        "status": "scored",
                        "drawnRound": start_r,
                        "scoredRound": only_r,
                    })
                    hand.append({
                        "cardId": card_id,
                        "name": sec_name,
                        "recurring": False,
                        "status": "scored",
                        "drawnRound": start_r,
                        "scoredRound": only_r,
                        "discardedRound": discarded_r or only_r,
                        "points": pts,
                    })
            else:
                # 0 VP card: either a discarded/held/unscored Tactical card or an unscored Fixed/9th/8th secondary
                if is_recurring:
                    if "fixed" in cat_id and has_tactical and p_raw.get("useFixedMissions") is False:
                        continue
                    sec_round_items[0].append({
                        "cardId": card_id,
                        "name": sec_name,
                        "score": 0,
                        "points": 0,
                        "status": "unscored",
                        "recurring": True,
                    })
                    hand.append({
                        "cardId": card_id,
                        "name": sec_name,
                        "recurring": True,
                        "status": "unscored",
                        "roundScores": {},
                        "points": 0,
                    })
                else:
                    start_r = drawn_r or discarded_r or 1
                    end_r = discarded_r if (discarded_r is not None and discarded_r >= start_r) else start_r
                    raw_status = str(sec.get("status") or "").strip().lower()
                    is_disc = bool(discarded_r is not None or was_discarded_start or raw_status == "discarded")
                    final_status = "discarded" if is_disc else (raw_status if raw_status in ("held", "active", "unscored") else "unscored")

                    for hr in range(start_r, end_r):
                        sec_round_items[hr - 1].append({
                            "cardId": card_id,
                            "name": sec_name,
                            "score": 0,
                            "points": 0,
                            "status": "held",
                            "drawnRound": start_r,
                            "discardedRound": end_r if is_disc else None,
                        })
                    sec_round_items[end_r - 1].append({
                        "cardId": card_id,
                        "name": sec_name,
                        "score": 0,
                        "points": 0,
                        "status": final_status,
                        "drawnRound": start_r,
                        "discardedRound": end_r if is_disc else None,
                        "wasDiscardedStartOfRound": was_discarded_start,
                    })
                    hand.append({
                        "cardId": card_id,
                        "name": sec_name,
                        "recurring": False,
                        "status": final_status,
                        "drawnRound": start_r,
                        "scoredRound": None,
                        "discardedRound": end_r if is_disc else None,
                        "wasDiscardedStartOfRound": was_discarded_start,
                        "points": 0,
                    })

        # If a tactical card was drawn in `drawnRound` and never scored or marked discarded
        # (`discardedRound is None` and not `wasDiscardedStartOfRound`), carry it forward into
        # subsequent rounds that have fewer than 2 active cards (representing a card held in hand).
        for h_card in hand:
            if (
                not h_card.get("recurring")
                and h_card.get("scoredRound") is None
                and h_card.get("discardedRound") is None
                and not h_card.get("wasDiscardedStartOfRound")
            ):
                start_r = int(h_card.get("drawnRound") or 1)
                c_id = h_card.get("cardId")
                c_name = h_card.get("name")
                carried_any = False
                for next_r in range(start_r + 1, 6):
                    r_list = sec_round_items[next_r - 1]
                    active_count = sum(1 for item in r_list if not item.get("wasDiscardedStartOfRound"))
                    already_in = any(item.get("cardId") == c_id for item in r_list)
                    if active_count < 2 and not already_in:
                        r_list.append({
                            "cardId": c_id,
                            "name": c_name,
                            "score": 0,
                            "points": 0,
                            "status": "held" if next_r < 5 else "unscored",
                            "drawnRound": start_r,
                        })
                        carried_any = True
                    else:
                        break
                if carried_any:
                    for item in sec_round_items[start_r - 1]:
                        if item.get("cardId") == c_id and item.get("score", 0) == 0:
                            item["status"] = "held"
                            break


    # Also Include Secret Mission / Challenger Cards if present in TTB
    secret_score = int(p_raw.get("secretMissionScore") or 0)
    if secret_score > 0:
        sec_name = _humanize_identifier(p_raw.get("secretMission") or "Secret Mission")
        pri_scores[4] += secret_score

    # Edition-specific scoring caps (8th ITC: 36/12, 9th & 11th: 45/45, 10th: 50/40)
    if edition == "8th_itc":
        pri_cap = 36
        sec_cap = 12
        max_total = 48
    elif edition in ("9th", "11th"):
        pri_cap = 45
        sec_cap = 45
        max_total = 100
    else:
        pri_cap = 50
        sec_cap = 40
        max_total = 100

    # If round scores weren't broken down by round, distribute or set on round 1..5
    raw_pri_total = p_raw.get("primaryScore")
    if sum(pri_scores) == 0 and isinstance(raw_pri_total, (int, float)) and int(raw_pri_total) > 0:
        # Spread across rounds 2..5 evenly
        rem = int(raw_pri_total)
        for r_idx in range(1, 5):
            chunk = min(15, rem // (5 - r_idx))
            pri_scores[r_idx] = chunk
            rem -= chunk

    raw_sec_total = p_raw.get("secondaryScore")
    if sum(sec_round_totals) == 0 and isinstance(raw_sec_total, (int, float)) and int(raw_sec_total) > 0:
        rem = int(raw_sec_total)
        for r_idx in range(5):
            chunk = min(15, rem // (5 - r_idx))
            if chunk > 0:
                sec_round_totals[r_idx] = chunk
                sec_round_items[r_idx].append({
                    "cardId": "secondary-objectives",
                    "name": "Secondary Objectives",
                    "score": chunk,
                    "points": chunk,
                    "status": "scored",
                })
                hand.append({
                    "cardId": f"secondary-r{r_idx + 1}",
                    "name": f"Round {r_idx + 1} Secondaries",
                    "recurring": False,
                    "status": "scored",
                    "scoredRound": r_idx + 1,
                    "points": chunk,
                })
                rem -= chunk

    is_battle_ready = p_raw.get("isBattleReady")
    if edition == "8th_itc":
        br_pts = p_raw.get("battleReadyScore")
        is_battle_ready = bool(int(br_pts) > 0) if br_pts is not None else False
        paint_pts = int(br_pts) if br_pts is not None else 0
    else:
        if is_battle_ready is None:
            br_pts = p_raw.get("battleReadyScore")
            is_battle_ready = (int(br_pts) > 0) if br_pts is not None else True
        paint_pts = 10 if is_battle_ready else 0

    sec_total = min(sec_cap, sum(sec_round_totals))
    pri_total = min(pri_cap, sum(pri_scores))
    computed_total = min(max_total, pri_total + sec_total + paint_pts)

    if isinstance(p_raw.get("totalScore"), (int, float)) and int(p_raw["totalScore"]) > 0:
        explicit_total = int(p_raw["totalScore"])
        if computed_total > explicit_total:
            excess = (pri_total + sec_total + paint_pts) - explicit_total
            for r_idx in range(4, -1, -1):
                if excess <= 0:
                    break
                dec = min(pri_scores[r_idx], excess)
                pri_scores[r_idx] -= dec
                excess -= dec
            pri_total = min(pri_cap, sum(pri_scores))
        computed_total = explicit_total

    rounds = []
    for r_idx in range(5):
        rounds.append({
            "round": r_idx + 1,
            "battleRound": r_idx + 1,
            "primaryScore": pri_scores[r_idx],
            "secondaryScore": sec_round_totals[r_idx],
            "secondaries": sec_round_items[r_idx],
        })

    p_state = {
        "name": p_name,
        "faction": p_fac,
        "detachment": p_det,
        "edition": edition,
        "battleReady": bool(is_battle_ready),
        "paintScore": paint_pts,
        "primaryCap": pri_cap,
        "secondaryCap": sec_cap,
        "cp": int(p_raw.get("cpRemaining") or 0),
        "score": computed_total,
        "totalScore": computed_total,
        "primaryScore": pri_total,
        "secondaryScore": sec_total,
        "rounds": rounds,
        "hand": hand,
    }
    return p_state, computed_total


def _build_aos_player_state(
    p_raw: Dict[str, Any],
    p_name: str,
    p_fac: str,
    p_det: str,
    edition: str = "aos_4e",
) -> Tuple[Dict[str, Any], int]:
    """Builds an AoS 3rd/4th Edition player state dict (`rounds` with primaryScore & tacticId/tacticScore, plus 3e Grand Strategy) and total VP."""
    primaries = p_raw.get("primaries") or []
    pri_scores = [0, 0, 0, 0, 0]
    if isinstance(primaries, list) and primaries:
        for prim in primaries:
            if isinstance(prim, dict):
                p_arr = prim.get("scores") if isinstance(prim.get("scores"), list) else (prim.get("points") if isinstance(prim.get("points"), list) else None)
                if isinstance(p_arr, list):
                    for idx in range(min(5, len(p_arr))):
                        val = p_arr[idx]
                        if isinstance(val, (int, float)):
                            pri_scores[idx] += int(val)
    elif isinstance(p_raw.get("primaryScores"), list):
        for idx in range(min(5, len(p_raw["primaryScores"]))):
            pri_scores[idx] = int(p_raw["primaryScores"][idx] or 0)

    # Extract AoS Battle Tactics per round (from `battleTactics`, `secondaries`, or `rounds`)
    tactics_raw = p_raw.get("battleTactics") or p_raw.get("secondaries") or []
    round_tactics: List[Dict[str, Any]] = [
        {"tacticId": "none", "tacticStatus": "pending", "tacticScore": 0}
        for _ in range(5)
    ]

    if isinstance(p_raw.get("rounds"), list):
        for idx, r_item in enumerate(p_raw["rounds"][:5]):
            if not isinstance(r_item, dict):
                continue
            r_idx = max(0, min(4, int(r_item.get("round") or (idx + 1)) - 1))
            if pri_scores[r_idx] == 0:
                pri_scores[r_idx] = int(r_item.get("primaryScore") if r_item.get("primaryScore") is not None else (r_item.get("primary") or 0))
            tac_id = r_item.get("tacticId") or r_item.get("tactic") or "none"
            tac_scored = r_item.get("tacticScored") if "tacticScored" in r_item else (r_item.get("tacticStatus") == "achieved")
            tac_pts = int(
                r_item.get("tacticScore")
                if r_item.get("tacticScore") is not None
                else (r_item.get("tacticPoints") if r_item.get("tacticPoints") is not None else (4 if tac_scored else 0))
            )
            if tac_id and tac_id != "none":
                round_tactics[r_idx] = {
                    "tacticId": str(tac_id),
                    "tacticStatus": "achieved" if (tac_scored or tac_pts > 0) else "failed",
                    "tacticScore": tac_pts if (tac_scored or tac_pts > 0) else 0,
                }

    gs_name = None
    gs_score = 0
    gs_achieved = False

    gs_raw = p_raw.get("grandStrategy") or p_raw.get("grand_strategy")
    if isinstance(gs_raw, dict):
        gs_name = gs_raw.get("name") or _humanize_identifier(gs_raw.get("id") or "Grand Strategy")
        gs_score = int(
            gs_raw.get("score")
            or (gs_raw.get("points") if isinstance(gs_raw.get("points"), (int, float)) else 0)
            or (3 if gs_raw.get("completed") or gs_raw.get("achieved") else 0)
        )
        gs_achieved = gs_score > 0 or bool(gs_raw.get("completed") or gs_raw.get("achieved"))
    elif isinstance(gs_raw, str) and gs_raw.strip():
        gs_name = gs_raw.strip()
        if p_raw.get("grandStrategyScore") is not None:
            gs_score = int(p_raw.get("grandStrategyScore") or 0)
        elif p_raw.get("grandStrategyAchieved") is False:
            gs_score = 0
        else:
            gs_score = 3
        gs_achieved = gs_score > 0
    elif p_raw.get("grandStrategyScore") is not None:
        gs_name = "Grand Strategy"
        gs_score = int(p_raw.get("grandStrategyScore") or 0)
        gs_achieved = gs_score > 0

    if isinstance(tactics_raw, list):
        for tac in tactics_raw:
            if not isinstance(tac, dict):
                continue
            tac_name = tac.get("name") or _humanize_identifier(tac.get("id") or "Battle Tactic")
            cat_low = str(tac.get("categoryId") or tac.get("category") or "").lower()
            if "grand" in cat_low or "grand strategy" in tac_name.lower():
                gs_name = tac_name
                pts_arr = tac.get("scores") if isinstance(tac.get("scores"), list) else (tac.get("points") if isinstance(tac.get("points"), list) else [])
                gs_score = sum(int(x or 0) for x in pts_arr if isinstance(x, (int, float))) if pts_arr else int(tac.get("totalScore") or tac.get("score") or (tac.get("points") if isinstance(tac.get("points"), (int, float)) else 0) or 3)
                gs_achieved = gs_score > 0
                continue
            scores_arr = (
                tac.get("scores")
                if isinstance(tac.get("scores"), list)
                else (tac.get("points") if isinstance(tac.get("points"), list) else [])
            )
            any_scored = False
            for r_idx in range(min(5, len(scores_arr))):
                pts = int(scores_arr[r_idx] or 0)
                if pts > 0:
                    any_scored = True
                    round_tactics[r_idx] = {
                        "tacticId": tac_name,
                        "tacticStatus": "achieved",
                        "tacticScore": pts,
                    }
                elif tac.get("drawnInRound") == r_idx and round_tactics[r_idx]["tacticId"] == "none":
                    round_tactics[r_idx] = {
                        "tacticId": tac_name,
                        "tacticStatus": "failed",
                        "tacticScore": 0,
                    }

            if not any_scored:
                fallback_r_idx: Optional[int] = None
                if tac.get("drawnInRound") is not None:
                    fallback_r_idx = int(tac["drawnInRound"])
                elif tac.get("discardedInRound") is not None:
                    fallback_r_idx = int(tac["discardedInRound"])
                elif tac.get("drawnRound") is not None:
                    fallback_r_idx = int(tac["drawnRound"]) - 1
                elif tac.get("round") is not None:
                    fallback_r_idx = int(tac["round"]) - 1
                if fallback_r_idx is not None:
                    r_idx = max(0, min(4, fallback_r_idx))
                    pts = int(
                        tac.get("score")
                        or (tac.get("points") if isinstance(tac.get("points"), (int, float)) else 0)
                        or (4 if tac.get("completed") or tac.get("status") == "achieved" else 0)
                    )
                    if pts > 0 or round_tactics[r_idx]["tacticId"] == "none":
                        round_tactics[r_idx] = {
                            "tacticId": tac_name,
                            "tacticStatus": "achieved" if pts > 0 else "failed",
                            "tacticScore": pts,
                        }

    rounds = []
    for r_idx in range(5):
        rounds.append({
            "round": r_idx + 1,
            "primaryScore": pri_scores[r_idx],
            "tacticId": round_tactics[r_idx]["tacticId"],
            "tacticStatus": round_tactics[r_idx]["tacticStatus"],
            "tacticScore": round_tactics[r_idx]["tacticScore"],
        })

    if edition == "aos_3e" or gs_name is not None:
        pri_total = sum(pri_scores)
        tac_total = sum(r["tacticScore"] for r in rounds)
        computed_total = pri_total + tac_total + gs_score
    else:
        pri_total = min(30, sum(pri_scores))
        tac_total = min(20, sum(r["tacticScore"] for r in rounds))
        computed_total = min(50, pri_total + tac_total)

    if isinstance(p_raw.get("totalScore"), (int, float)) and int(p_raw["totalScore"]) > 0 and (computed_total == 0 or edition == "aos_3e"):
        computed_total = int(p_raw["totalScore"])

    p_state = {
        "name": p_name,
        "faction": p_fac,
        "battleFormation": p_det,
        "edition": edition,
        "cp": int(p_raw.get("cpRemaining") or 4),
        "score": computed_total,
        "totalScore": computed_total,
        "primaryScore": pri_total,
        "secondaryScore": tac_total,
        "grandStrategy": gs_name,
        "grandStrategyScore": gs_score,
        "grandStrategyAchieved": gs_achieved,
        "rounds": rounds,
    }
    return p_state, computed_total


def _adapt_game_core_to_ttb_game(core: Dict[str, Any]) -> Dict[str, Any]:
    """Adapts a newer Tabletop Battles `GameCore` object (`teams`, `players`, `plugins`) into standard TTB Game dict."""
    adapted = dict(core)
    adapted["gameType"] = core.get("systemId") or core.get("gameType") or "wh40k10e"
    players_list = []
    raw_players = core.get("players") or []
    if isinstance(raw_players, dict):
        raw_players = list(raw_players.values())
    for p in raw_players:
        if isinstance(p, dict):
            players_list.append(p)
    adapted["players"] = players_list
    return adapted


def _convert_itcba_game_to_omnitactica(
    battle: Dict[str, Any],
    importing_user: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Converts a legacy ITC Battles App (`itcba`) battle record into TTB format and then OmniTactica."""
    p1 = battle.get("player1") or {}
    p2 = battle.get("player2") or {}

    def _map_itcba_player(p: Dict[str, Any], default_name: str) -> Dict[str, Any]:
        prim_arr = p.get("primaries") or []
        scores = []
        for r in prim_arr[:5]:
            if isinstance(r, dict):
                pts = (
                    (4 if r.get("hold") else 0)
                    + (4 if r.get("holdMore") else 0)
                    + (4 if r.get("kill") else 0)
                    + (4 if r.get("killMore") else 0)
                    + (2 if r.get("bonus") else 0)
                    + (int(r.get("points") or 0) if isinstance(r.get("points"), (int, float, str)) else 0)
                )
                scores.append(pts)
            elif isinstance(r, (int, float)):
                scores.append(int(r))
        secs = []
        for s in (p.get("secondaries") or []):
            if isinstance(s, dict):
                raw_pts = s.get("points")
                if isinstance(raw_pts, list):
                    scores_list = [int(x or 0) if isinstance(x, (int, float, str)) else 0 for x in raw_pts[:5]]
                    while len(scores_list) < 5:
                        scores_list.append(0)
                    pts = sum(scores_list)
                else:
                    pts = int(raw_pts or 0) if isinstance(raw_pts, (int, float, str)) else 0
                    scores_list = [pts, 0, 0, 0, 0]
                secs.append({
                    "id": s.get("id") or "secondary",
                    "name": _humanize_identifier(s.get("id") or "Secondary"),
                    "totalScore": pts,
                    "points": pts,
                    "categoryId": "fixedMissions",
                    "scores": scores_list,
                })
        return {
            "name": p.get("name") or default_name,
            "faction": {"name": _humanize_identifier(p.get("faction") or p.get("notes") or "Warhammer 40k")},
            "primaries": [{"name": "ITC Champions Mission", "scores": scores}],
            "secondaries": secs,
            "isBattleReady": False,
            "battleReadyScore": 0,
        }

    ttb_equiv = {
        "id": battle.get("id") or secrets.token_hex(6),
        "gameType": "wh40k8e_itc",
        "edition": "8th_itc",
        "gameDate": battle.get("battleDate") or battle.get("created_at"),
        "isFinished": True,
        "mission": {
            "missionName": _humanize_identifier(battle.get("mission") or "ITC Champions Mission"),
            "packName": "8th Ed ITC Champions Missions",
            "deploymentMapName": _humanize_identifier(battle.get("deployment") or "Search & Destroy"),
        },
        "players": [
            _map_itcba_player(p1, "Player 1"),
            _map_itcba_player(p2, "Player 2"),
        ],
    }
    return convert_ttb_game_to_omnitactica(ttb_equiv, importing_user=importing_user, source_label="tabletop_battles")


# ============================================================================
# 3. UNIVERSAL TEXT / JSON / GW APP WAR JOURNAL SCORECARD PARSER
# ============================================================================

def parse_imported_games_payload(
    raw_input: str,
    importing_user: Optional[Any] = None,
    default_system: str = "40k",
    source_hint: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Universal entry point to parse one or more completed games from:
    1. Tabletop Battles JSON (single game, GameEnvelope, GameEnvelopesList, ObserverPOC JSON, or ITCBA JSON)
    2. Tabletop Battles Share / Export Text Summary
    3. Official GW App (Warhammer 40,000: The App War Journal / Command Bunker) Text Summary
    """
    if isinstance(importing_user, str):
        if not source_hint:
            source_hint = importing_user
        importing_user = None

    if isinstance(raw_input, (dict, list)):
        text = json.dumps(raw_input)
    else:
        text = str(raw_input or "").strip()
    if not text:
        raise ValueError("No game data provided to import.")

    # 1. Try JSON parsing first
    if text.startswith("{") or text.startswith("["):
        try:
            parsed_json = json.loads(text)
            raw_games = _extract_ttb_envelope_games(parsed_json)
            if raw_games:
                results = []
                for rg in raw_games:
                    conv = convert_ttb_game_to_omnitactica(
                        rg,
                        importing_user=importing_user,
                        default_system=default_system,
                        source_label=source_hint or "tabletop_battles",
                    )
                    if conv:
                        results.append(conv)
                if results:
                    return results
        except Exception:
            pass

    # 2. Parse structured Text Summaries (supports multiple games separated by === or ---)
    blocks = re.split(r"\n\s*(?:={3,}|-{4,})\s*\n", text)
    results = []
    for block in blocks:
        if not block.strip():
            continue
        parsed_game = _parse_single_text_scorecard(
            block,
            importing_user=importing_user,
            default_system=default_system,
            source_hint=source_hint,
        )
        if parsed_game:
            results.append(parsed_game)

    if not results:
        raise ValueError(
            "Could not recognize game format. Paste a Tabletop Battles JSON/text export, Observer Code, or GW War Journal summary."
        )
    return results


def _parse_single_text_scorecard(
    block: str,
    importing_user: Optional[Dict[str, Any]] = None,
    default_system: str = "40k",
    source_hint: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Parses a human-readable scorecard summary from Tabletop Battles or GW 40k App War Journal.
    Supports formats like:
      - GW War Journal / Command Bunker:
        "Warhammer 40,000 - War Journal" / "Command Bunker"
        "Player 1: Alex (Space Marines - Gladius Task Force) - 88 VP"
        "Player 2: Marcus (Necrons - Awakened Dynasty) - 72 VP"
        "Primary Mission: Take and Hold | Deployment: Search and Destroy"
        "Round 1: P1 Pri 0, Sec 5 (Area Denial 5) | P2 Pri 0, Sec 3 (Cleanse 3)"
      - Tabletop Battles Share Text:
        "Jack Chapman (T'au - Kauyon) 52 vs 86 Ed (Aeldari - Battle Host)"
        "Mission: Supply Drop (Leviathan) | Date: 2026-03-15"
    """
    lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
    if not lines:
        return None

    full_lower = block.lower()
    detected_source = source_hint or (
        "gw_app"
        if any(k in full_lower for k in ("war journal", "command bunker", "warhammer 40,000: the app", "gw app"))
        else "tabletop_battles"
    )
    is_aos = any(k in full_lower for k in ("age of sigmar", "aos", "battleplan", "battle tactic", "spearhead", "general's handbook")) or (
        "aos" in (default_system or "").lower() and "40,000" not in full_lower and "40k" not in full_lower
    )

    p1_name, p1_fac, p1_det, p1_score = "Player 1", "", "", None
    p2_name, p2_fac, p2_det, p2_score = "Player 2", "", "", None
    mission_name = "Border War" if is_aos else "Take & Hold"
    deployment_name = "Standard Deployment" if is_aos else "Search & Destroy"
    mission_rule = "Matched Play"
    game_date = None
    first_turn = "p1"
    p1_paint = True
    p2_paint = True

    p1_pri = [0, 0, 0, 0, 0]
    p2_pri = [0, 0, 0, 0, 0]
    p1_secs: List[Dict[str, Any]] = []
    p2_secs: List[Dict[str, Any]] = []
    p1_tactics: List[Dict[str, Any]] = []
    p2_tactics: List[Dict[str, Any]] = []

    def _parse_faction_det(ParenText: str) -> Tuple[str, str]:
        if not ParenText:
            return ("", "")
        for sep in (" - ", " – ", " / ", ": "):
            if sep in ParenText:
                a, b = ParenText.split(sep, 1)
                return (a.strip(), b.strip())
        return (ParenText.strip(), "")

    # Pattern 1: Versus header line, e.g. "Jack (T'au - Kauyon) 52 vs 86 Ed (Aeldari - Battle Host)"
    vs_re = re.compile(
        r"^(?P<p1>[^(\d\n]+?)(?:\s*\((?P<f1>[^)]+)\))?\s+(?P<s1>\d+)\s*(?:vp\s*)?(?:vs\.?|v\.?|-|to)\s*(?P<s2>\d+)\s*(?:vp\s*)?(?P<p2>[^(\n]+?)(?:\s*\((?P<f2>[^)]+)\))?$",
        re.IGNORECASE,
    )

    # Pattern 2: Explicit Player 1 / Player 2 lines
    p_line_re = re.compile(
        r"^(?:player\s*(?P<pnum>[12])|p(?P<pnum2>[12]))\s*[:\-]\s*(?P<name>[^(\-\n]+?)(?:\s*\((?P<fac>[^)]+)\))?(?:\s*[\-–:]\s*(?P<score>\d+)\s*(?:vp|pts)?)?$",
        re.IGNORECASE,
    )

    # Pattern 3: Round line, e.g. "Round 2: P1 Pri 10, Sec 5 (Cleanse +5) | P2 Pri 5, Sec 8 (Bring It Down +8)"
    round_re = re.compile(r"^(?:battle\s+)?(?:round|turn|r|t)\s*(?P<r>[1-5])\s*[:\-]\s*(?P<rest>.+)$", re.IGNORECASE)

    current_player_ctx = "p1"
    for ln in lines:
        m_vs = vs_re.match(ln)
        if m_vs:
            p1_name = m_vs.group("p1").strip()
            p2_name = m_vs.group("p2").strip()
            p1_score = int(m_vs.group("s1"))
            p2_score = int(m_vs.group("s2"))
            p1_fac, p1_det = _parse_faction_det(m_vs.group("f1") or "")
            p2_fac, p2_det = _parse_faction_det(m_vs.group("f2") or "")
            continue

        m_pl = p_line_re.match(ln)
        if m_pl:
            pnum = m_pl.group("pnum") or m_pl.group("pnum2")
            nm = m_pl.group("name").strip()
            fc, dt = _parse_faction_det(m_pl.group("fac") or "")
            sc = int(m_pl.group("score")) if m_pl.group("score") else None
            if pnum == "1":
                current_player_ctx = "p1"
                p1_name = nm
                if fc: p1_fac = fc
                if dt: p1_det = dt
                if sc is not None: p1_score = sc
            else:
                current_player_ctx = "p2"
                p2_name = nm
                if fc: p2_fac = fc
                if dt: p2_det = dt
                if sc is not None: p2_score = sc
            continue

        m_rnd = round_re.match(ln)
        if m_rnd:
            r_idx = int(m_rnd.group("r")) - 1
            rest = m_rnd.group("rest")
            # Split by | or ; for P1 vs P2
            parts = re.split(r"\s*[|;/]\s*", rest)
            for idx_p, part in enumerate(parts[:2]):
                if len(parts) == 1:
                    target_is_p2 = (
                        "p2" in part.lower()
                        or "player 2" in part.lower()
                        or (current_player_ctx == "p2" and "p1" not in part.lower() and "player 1" not in part.lower())
                    )
                else:
                    target_is_p2 = ("p2" in part.lower() or "player 2" in part.lower()) or (idx_p == 1 and "p1" not in part.lower())
                m_pri = re.search(r"(?:pri(?:mary)?)\s*[:=]?\s*\+?(\d+)", part, re.IGNORECASE)
                if m_pri:
                    if target_is_p2:
                        p2_pri[r_idx] = int(m_pri.group(1))
                    else:
                        p1_pri[r_idx] = int(m_pri.group(1))

                m_sec = re.search(r"(?:sec(?:ondary)?|tac(?:tic)?)\s*[:=]?\s*\+?(\d+)", part, re.IGNORECASE)
                sec_total_for_part = int(m_sec.group(1)) if m_sec else 0

                # Extract named cards in parentheses e.g. (Cleanse +5, Bring It Down +4) or (Cleanse +5, Assassination)
                m_paren = re.search(r"\(([^)]+)\)", part)
                parsed_named = False
                if m_paren:
                    raw_items = [x.strip() for x in m_paren.group(1).split(",") if x.strip()]
                    unnumbered_names: List[str] = []
                    for item_str in raw_items:
                        m_card = re.match(r"^\s*([A-Za-z0-9'&\-\s]+?)\s*[:+]?\s*(\d+)\s*(?:vp|pts)?\s*$", item_str, re.IGNORECASE)
                        if m_card:
                            c_name = m_card.group(1).strip()
                            c_pts = int(m_card.group(2))
                            scores_5 = [0, 0, 0, 0, 0]
                            scores_5[r_idx] = c_pts
                            sec_entry = {
                                "name": c_name,
                                "id": _clean_card_slug(c_name),
                                "scores": scores_5,
                                "drawnInRound": r_idx,
                                "discardedInRound": r_idx,
                                "categoryId": "tacticalMissions",
                            }
                            if target_is_p2:
                                p2_secs.append(sec_entry)
                                p2_tactics.append({"round": r_idx + 1, "name": c_name, "score": c_pts, "completed": c_pts > 0})
                            else:
                                p1_secs.append(sec_entry)
                                p1_tactics.append({"round": r_idx + 1, "name": c_name, "score": c_pts, "completed": c_pts > 0})
                            parsed_named = True
                        else:
                            unnumbered_names.append(item_str)

                    if unnumbered_names:
                        n_cards = len(unnumbered_names)
                        for c_idx, raw_c_name in enumerate(unnumbered_names):
                            c_name = re.sub(r"\s*[-–:]?\s*\b(?:discarded|held|unscored|failed)\b\s*$", "", raw_c_name, flags=re.IGNORECASE).strip() or raw_c_name
                            is_explicit_disc = bool(re.search(r"\bdiscarded\b", raw_c_name, re.IGNORECASE))
                            if not parsed_named and sec_total_for_part > 0:
                                c_pts = (sec_total_for_part // n_cards) + (1 if c_idx < (sec_total_for_part % n_cards) else 0)
                            else:
                                c_pts = 0
                            scores_5 = [0, 0, 0, 0, 0]
                            scores_5[r_idx] = c_pts
                            sec_entry = {
                                "name": c_name,
                                "id": _clean_card_slug(c_name),
                                "scores": scores_5,
                                "drawnInRound": r_idx,
                                "discardedInRound": r_idx if (c_pts > 0 or is_explicit_disc) else None,
                                "status": "discarded" if is_explicit_disc else ("scored" if c_pts > 0 else "unscored"),
                                "categoryId": "tacticalMissions",
                            }
                            if target_is_p2:
                                p2_secs.append(sec_entry)
                                p2_tactics.append({"round": r_idx + 1, "name": c_name, "score": c_pts, "completed": c_pts > 0})
                            else:
                                p1_secs.append(sec_entry)
                                p1_tactics.append({"round": r_idx + 1, "name": c_name, "score": c_pts, "completed": c_pts > 0})
                        parsed_named = True

                if not parsed_named and sec_total_for_part > 0:
                    c_pts = sec_total_for_part
                    scores_5 = [0, 0, 0, 0, 0]
                    scores_5[r_idx] = c_pts
                    sec_entry = {
                        "name": f"Round {r_idx + 1} {'Battle Tactic' if is_aos else 'Secondary'}",
                        "id": f"round-{r_idx + 1}-sec",
                        "scores": scores_5,
                        "drawnInRound": r_idx,
                        "discardedInRound": r_idx,
                        "categoryId": "tacticalMissions",
                    }
                    if target_is_p2:
                        p2_secs.append(sec_entry)
                        p2_tactics.append({"round": r_idx + 1, "name": f"Round {r_idx + 1} Tactic", "score": c_pts, "completed": True})
                    else:
                        p1_secs.append(sec_entry)
                        p1_tactics.append({"round": r_idx + 1, "name": f"Round {r_idx + 1} Tactic", "score": c_pts, "completed": True})
            continue

        # Parse Mission / Battleplan / Deployment / Date metadata
        for seg in re.split(r"\s*[|•]\s*", ln):
            low = seg.lower()
            if low.startswith("mission:") or low.startswith("primary mission:") or low.startswith("primary:") or low.startswith("battleplan:"):
                mission_name = seg.split(":", 1)[1].strip()
            elif low.startswith("deployment:"):
                deployment_name = seg.split(":", 1)[1].strip()
            elif low.startswith("mission rule:") or low.startswith("rule:"):
                mission_rule = seg.split(":", 1)[1].strip()
            elif low.startswith("date:"):
                game_date = seg.split(":", 1)[1].strip()
            elif low.startswith("first turn:") or low.startswith("went first:"):
                ft_val = seg.split(":", 1)[1].strip().lower()
                if "2" in ft_val or (p2_name and p2_name.lower() in ft_val):
                    first_turn = "p2"
            elif low.startswith("p1 faction:"):
                p1_fac, p1_det = _parse_faction_det(seg.split(":", 1)[1].strip())
            elif low.startswith("p2 faction:"):
                p2_fac, p2_det = _parse_faction_det(seg.split(":", 1)[1].strip())
            elif low.startswith("score:") or low.startswith("final score:"):
                m_sc = re.search(r"(\d+)\s*[\-–:vto]+\s*(\d+)", seg, re.IGNORECASE)
                if m_sc:
                    p1_score = int(m_sc.group(1))
                    p2_score = int(m_sc.group(2))

    if p1_score is None and p2_score is None and sum(p1_pri) == 0 and sum(p2_pri) == 0:
        return None

    text_edition = None
    if is_aos:
        if any(k in full_lower for k in ("aos 3", "3rd edition", "3e", "grand strategy", "andtor", "gallet", "ghur", "thondia")):
            text_edition = "aos_3e"
    else:
        if any(k in full_lower for k in ("8th", "8e", "itc champions", "hold more", "kill more")):
            text_edition = "8th_itc"
            p1_paint = False
            p2_paint = False
        elif any(k in full_lower for k in ("9th", "9e", "nephilim", "arks of omen", "nachmund", "octarius", "gt 2020", "gt 2021", "gt 2022")):
            text_edition = "9th"
        elif any(k in full_lower for k in ("11th", "11e")):
            text_edition = "11th"

    # If only total scores were given without per-round primary/secondary breakdown, synthesize a clean breakdown
    if sum(p1_pri) == 0 and sum(p2_pri) == 0 and p1_score is not None and p2_score is not None:
        if is_aos:
            p1_pri_tot = min(30, int(round(p1_score * 0.6)))
            p1_tac_tot = max(0, min(20, p1_score - p1_pri_tot))
            p2_pri_tot = min(30, int(round(p2_score * 0.6)))
            p2_tac_tot = max(0, min(20, p2_score - p2_pri_tot))
            for i in range(5):
                p1_pri[i] = p1_pri_tot // 5 + (1 if i < (p1_pri_tot % 5) else 0)
                p2_pri[i] = p2_pri_tot // 5 + (1 if i < (p2_pri_tot % 5) else 0)
                if p1_tac_tot >= 4:
                    p1_tactics.append({"round": i + 1, "name": f"Round {i + 1} Battle Tactic", "score": 4, "completed": True})
                    p1_tac_tot -= 4
                if p2_tac_tot >= 4:
                    p2_tactics.append({"round": i + 1, "name": f"Round {i + 1} Battle Tactic", "score": 4, "completed": True})
                    p2_tac_tot -= 4
        else:
            if text_edition == "8th_itc":
                p1_paint = False
                p2_paint = False
                p1_pri_tot = min(30, int(round(p1_score * 0.7)))
                p1_sec_tot = max(0, min(12, p1_score - p1_pri_tot))
                p2_pri_tot = min(30, int(round(p2_score * 0.7)))
                p2_sec_tot = max(0, min(12, p2_score - p2_pri_tot))
            else:
                p1_paint = p1_score >= 10
                p2_paint = p2_score >= 10
                p1_rem = max(0, p1_score - (10 if p1_paint else 0))
                p2_rem = max(0, p2_score - (10 if p2_paint else 0))
                pri_cap = 45 if text_edition in ("9th", "11th") else 50
                sec_cap = 45 if text_edition in ("9th", "11th") else 40
                p1_pri_tot = min(pri_cap, int(round(p1_rem * (0.5 if text_edition in ("9th", "11th") else 0.56))))
                p1_sec_tot = max(0, min(sec_cap, p1_rem - p1_pri_tot))
                p2_pri_tot = min(pri_cap, int(round(p2_rem * (0.5 if text_edition in ("9th", "11th") else 0.56))))
                p2_sec_tot = max(0, min(sec_cap, p2_rem - p2_pri_tot))
            for i in range(1, 5):
                p1_pri[i] = p1_pri_tot // 4 + (1 if (i - 1) < (p1_pri_tot % 4) else 0)
                p2_pri[i] = p2_pri_tot // 4 + (1 if (i - 1) < (p2_pri_tot % 4) else 0)
            if p1_sec_tot > 0:
                s_arr = [p1_sec_tot // 5 + (1 if i < (p1_sec_tot % 5) else 0) for i in range(5)]
                p1_secs.append({"name": "Secondary Objectives" if text_edition in ("9th", "8th_itc") else "Tactical Secondaries", "id": "tactical-secondaries", "scores": s_arr, "categoryId": "fixedMissions"})
            if p2_sec_tot > 0:
                s_arr2 = [p2_sec_tot // 5 + (1 if i < (p2_sec_tot % 5) else 0) for i in range(5)]
                p2_secs.append({"name": "Secondary Objectives" if text_edition in ("9th", "8th_itc") else "Tactical Secondaries", "id": "tactical-secondaries", "scores": s_arr2, "categoryId": "fixedMissions"})

    synthetic_ttb = {
        "id": hashlib.sha256(block.strip().encode("utf-8")).hexdigest()[:16],
        "gameType": ("aos3e" if text_edition == "aos_3e" else "aos4e") if is_aos else (
            "wh40k8e_itc" if text_edition == "8th_itc" else ("wh40k9e" if text_edition == "9th" else ("wh40k11e" if text_edition == "11th" else "wh40k10e"))
        ),
        "edition": text_edition,
        "gameDate": game_date or datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "isFinished": True,
        "wentFirstRollOff": "secondPlayer" if first_turn == "p2" else "firstPlayer",
        "mission": {
            "missionName": mission_name,
            "deploymentMapName": deployment_name,
            "selectedMissionRules": [mission_rule],
        },
        "players": [
            {
                "name": p1_name,
                "faction": {"name": p1_fac or ("Age of Sigmar" if is_aos else "Warhammer 40k"), "subtitle": p1_det},
                "primaries": [{"name": mission_name, "scores": p1_pri}],
                "secondaries": p1_secs,
                "battleTactics": p1_tactics,
                "isBattleReady": p1_paint,
                "totalScore": p1_score,
            },
            {
                "name": p2_name,
                "faction": {"name": p2_fac or ("Age of Sigmar" if is_aos else "Warhammer 40k"), "subtitle": p2_det},
                "primaries": [{"name": mission_name, "scores": p2_pri}],
                "secondaries": p2_secs,
                "battleTactics": p2_tactics,
                "isBattleReady": p2_paint,
                "totalScore": p2_score,
            },
        ],
    }

    return convert_ttb_game_to_omnitactica(
        synthetic_ttb,
        importing_user=importing_user,
        default_system="aos" if is_aos else "40k",
        source_label=detected_source,
    )


# ============================================================================
# 4. BATTLEBASE (https://www.battlebase.app/graphql) LIVE GRAPHQL IMPORTER
# ============================================================================

BATTLEBASE_GRAPHQL_URL = "https://www.battlebase.app/graphql"


def _clean_battlebase_slug(slug: str, kind: str = "", faction_slug: str = "") -> str:
    """Converts BattleBase mission/faction/detachment slugs into clean human-readable titles."""
    s = str(slug or "").strip()
    if not s:
        return ""
    if "|" in s:
        s = s.split("|")[0].strip()
    # Strip known BattleBase prefixes
    s = re.sub(
        r"^(?:primary-mission|secondary-mission|secret-mission|challenger-card|deployment|mission-rule|mission-pack)-(?:chapter-approved-\d{4}-\d{2}-|pariah-nexus-|leviathan-|nachmund-gauntlet-|crusade-)?",
        "",
        s,
        flags=re.IGNORECASE,
    )
    if kind == "detachment":
        f_core = re.sub(r"^faction-", "", str(faction_slug or "").strip(), flags=re.IGNORECASE)
        if f_core:
            s = re.sub(rf"^detachment-{re.escape(f_core)}-", "", s, flags=re.IGNORECASE)
        s = re.sub(r"^detachment-[a-z0-9-]+?-", "", s, flags=re.IGNORECASE)
    elif kind == "faction":
        s = re.sub(r"^faction-", "", s, flags=re.IGNORECASE)
    s = re.sub(r"^(?:detachment|faction|mission-pack)-", "", s, flags=re.IGNORECASE)
    human = _humanize_identifier(s)
    # Restore apostrophes for known factions
    human_map = {
        "Emperors Children": "Emperor's Children",
        "Tau Empire": "T'au Empire",
        "Thousand Sons": "Thousand Sons",
        "Chaos Daemons": "Chaos Daemons",
    }
    return human_map.get(human, human)


def convert_battlebase_battle_to_omnitactica(
    battle: Dict[str, Any],
    importing_user: Optional[Dict[str, Any]] = None,
    target_bb_username: str = "",
) -> Optional[Dict[str, Any]]:
    """
    Converts a BattleBase GraphQL battle (`battleSetupJson` + `eventsJson`) into an OmniTactica scorecard
    with full turn-by-turn Primary VP, Secondary card draws/scores/discards, paint bonus, and historical date.
    """
    if not isinstance(battle, dict):
        return None
    b_id = str(battle.get("id") or "").strip()
    if not b_id:
        return None

    setup = battle.get("battleSetupJson") or {}
    if isinstance(setup, str):
        try:
            setup = json.loads(setup)
        except Exception:
            setup = {}
    if not isinstance(setup, dict):
        setup = {}

    events = battle.get("eventsJson") or []
    if isinstance(events, str):
        try:
            events = json.loads(events)
        except Exception:
            events = []
    if not isinstance(events, list):
        events = []

    created_by = battle.get("createdBy") if isinstance(battle.get("createdBy"), dict) else {}
    opponent = battle.get("opponent") if isinstance(battle.get("opponent"), dict) else {}

    pf = setup.get("playersAndFactions") if isinstance(setup.get("playersAndFactions"), dict) else {}
    me_id = str(pf.get("meId") or created_by.get("id") or "1")
    opp_id = str(pf.get("opponentId") or opponent.get("id") or "2")

    me_name = str(created_by.get("username") or "Player 1").strip()
    opp_name = str(opponent.get("username") or "Player 2").strip()

    me_fac_slug = str(pf.get("meFactionId") or "")
    opp_fac_slug = str(pf.get("opponentFactionId") or "")
    me_fac = _clean_battlebase_slug(me_fac_slug, kind="faction") or "Warhammer 40k"
    opp_fac = _clean_battlebase_slug(opp_fac_slug, kind="faction") or "Warhammer 40k"

    me_dets = pf.get("meDetachmentIds") if isinstance(pf.get("meDetachmentIds"), list) else []
    opp_dets = pf.get("opponentDetachmentIds") if isinstance(pf.get("opponentDetachmentIds"), list) else []
    me_det = _clean_battlebase_slug(me_dets[0], kind="detachment", faction_slug=me_fac_slug) if me_dets else ""
    opp_det = _clean_battlebase_slug(opp_dets[0], kind="detachment", faction_slug=opp_fac_slug) if opp_dets else ""
    # Strip faction prefix if still present in detachment slug
    for fac_lbl in (me_fac, opp_fac):
        if fac_lbl and me_det.lower().startswith(fac_lbl.lower().replace("'", "") + " "):
            me_det = me_det[len(fac_lbl):].strip()
        if fac_lbl and opp_det.lower().startswith(fac_lbl.lower().replace("'", "") + " "):
            opp_det = opp_det[len(fac_lbl):].strip()

    me_paint = bool(pf.get("mePaintedArmy", True))
    opp_paint = bool(pf.get("opponentPaintedArmy", True))

    pack_id = str(setup.get("missionPackId") or "mission-pack-chapter-approved-2025-26")
    pack_name = _clean_battlebase_slug(pack_id) or "Chapter Approved"
    msel = setup.get("missionSelection") if isinstance(setup.get("missionSelection"), dict) else {}
    mission_name = _clean_battlebase_slug(msel.get("missionId") or "") or "Take & Hold"
    deployment_name = _clean_battlebase_slug(msel.get("deploymentId") or "") or "Search & Destroy"
    rule_ids = msel.get("missionRuleIds") if isinstance(msel.get("missionRuleIds"), list) else []
    mission_rule = _clean_battlebase_slug(rule_ids[0]) if rule_ids else "Matched Play"

    is_first_turn_me = bool(setup.get("isFirstTurnMe", True))

    # Replay eventsJson to reconstruct per-round Primary VP, Secondary cards, Paint VP, and timestamp
    pri_by_actor: Dict[str, List[int]] = {me_id: [0, 0, 0, 0, 0], opp_id: [0, 0, 0, 0, 0]}
    cards_by_actor: Dict[str, Dict[str, Dict[str, Any]]] = {me_id: {}, opp_id: {}}
    paint_by_actor: Dict[str, bool] = {me_id: me_paint, opp_id: opp_paint}
    cur_round = 1
    first_ts: Optional[int] = None

    for ev in events:
        if not isinstance(ev, dict):
            continue
        ev_type = str(ev.get("type") or "")
        actor = str(ev.get("actor") or "")
        data = ev.get("data") if isinstance(ev.get("data"), dict) else {}
        val = int(ev.get("value") or 0) if isinstance(ev.get("value"), (int, float)) else 0
        ts = ev.get("timestamp")
        if isinstance(ts, (int, float)) and ts > 1_000_000_000_000:
            if first_ts is None or int(ts) < first_ts:
                first_ts = int(ts)

        if ev_type == "STARTED_TURN":
            t_num = data.get("turnNumber")
            if isinstance(t_num, (int, float)) and 1 <= int(t_num) <= 5:
                cur_round = int(t_num)
            continue

        if actor not in (me_id, opp_id):
            continue
        r_idx = max(0, min(4, cur_round - 1))

        if ev_type in (
            "GAINED_PRIMARY_VICTORY_POINTS",
            "GAINED_GAMBIT_VICTORY_POINTS",
            "GAINED_SECRET_MISSION_VICTORY_POINTS",
        ):
            pri_by_actor[actor][r_idx] += val
        elif ev_type == "GAINED_BONUS_VP_FOR_PAINTED_ARMY":
            if val > 0:
                paint_by_actor[actor] = True
        elif ev_type == "DREW_SECONDARY_MISSION_CARD":
            m_slug = str(data.get("missionId") or "").strip()
            if m_slug:
                c_title = _clean_battlebase_slug(m_slug)
                c_map = cards_by_actor[actor]
                if m_slug not in c_map:
                    c_map[m_slug] = {
                        "id": _clean_card_slug(c_title or m_slug),
                        "name": c_title or "Secondary Mission",
                        "scores": [0, 0, 0, 0, 0],
                        "drawnInRound": r_idx,
                        "discardedInRound": None,
                        "categoryId": "tacticalMissions",
                    }
        elif ev_type in ("GAINED_SECONDARY_VICTORY_POINTS", "GAINED_CHALLENGER_CARD_MISSION_VICTORY_POINTS"):
            m_slug = str(data.get("missionId") or "secondary-mission").strip()
            c_title = _clean_battlebase_slug(m_slug) or "Secondary Mission"
            c_map = cards_by_actor[actor]
            if m_slug not in c_map:
                c_map[m_slug] = {
                    "id": _clean_card_slug(c_title),
                    "name": c_title,
                    "scores": [0, 0, 0, 0, 0],
                    "drawnInRound": r_idx,
                    "discardedInRound": None,
                    "categoryId": "tacticalMissions",
                }
            c_map[m_slug]["scores"][r_idx] += val
        elif ev_type in ("ACHIEVED_TACTICAL_SECONDARY_MISSION", "DISCARDED_TACTICAL_SECONDARY_MISSION"):
            m_slug = str(data.get("missionId") or "").strip()
            if m_slug and m_slug in cards_by_actor[actor]:
                cards_by_actor[actor][m_slug]["discardedInRound"] = r_idx

    me_player = {
        "name": me_name,
        "faction": {"name": me_fac, "subtitle": me_det},
        "primaries": [{"name": mission_name, "scores": pri_by_actor[me_id]}],
        "secondaries": list(cards_by_actor[me_id].values()),
        "isBattleReady": paint_by_actor[me_id],
    }
    opp_player = {
        "name": opp_name,
        "faction": {"name": opp_fac, "subtitle": opp_det},
        "primaries": [{"name": mission_name, "scores": pri_by_actor[opp_id]}],
        "secondaries": list(cards_by_actor[opp_id].values()),
        "isBattleReady": paint_by_actor[opp_id],
    }

    # Put the target BattleBase user in P1 slot if they were `opponent`
    swap_p1_p2 = bool(
        target_bb_username
        and opp_name.lower() == target_bb_username.strip().lower()
        and me_name.lower() != target_bb_username.strip().lower()
    )
    if swap_p1_p2:
        players_arr = [opp_player, me_player]
        went_first = "secondPlayer" if is_first_turn_me else "firstPlayer"
    else:
        players_arr = [me_player, opp_player]
        went_first = "firstPlayer" if is_first_turn_me else "secondPlayer"

    is_11e = "2026-27" in pack_id or "11e" in pack_id.lower() or "11th" in pack_id.lower()
    ttb_equiv = {
        "id": f"bb-{b_id}",
        "gameType": "wh40k11e" if is_11e else "wh40k10e",
        "edition": "11th" if is_11e else "10th",
        "gameDate": first_ts or datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "isFinished": True,
        "wentFirstRollOff": went_first,
        "mission": {
            "missionName": mission_name,
            "packName": pack_name,
            "packId": pack_id,
            "deploymentMapName": deployment_name,
            "selectedMissionRules": [mission_rule],
        },
        "players": players_arr,
    }
    return convert_ttb_game_to_omnitactica(
        ttb_equiv,
        importing_user=importing_user,
        default_system="40k",
        source_label="battlebase",
    )


def _battlebase_graphql_request(query: str, variables: Optional[Dict[str, Any]] = None, token: Optional[str] = None) -> Dict[str, Any]:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; OmniTacticaTrackerSync/1.0)",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    payload = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(BATTLEBASE_GRAPHQL_URL, data=payload, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=18) as resp:
        return json.loads(resp.read().decode("utf-8", errors="ignore"))


def sync_battlebase_account_games(
    username: str,
    password: str = "",
    importing_user: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Authenticates with BattleBase (`https://www.battlebase.app/graphql`) using Email/Username + Password
    (or fetches public user battles by BattleBase username) and converts all battles into OmniTactica scorecards.
    """
    clean_user = (username or "").strip()
    clean_pass = password or ""
    if not clean_user:
        raise ValueError("BattleBase Email or Username is required.")

    token: Optional[str] = None
    resolved_username = clean_user
    raw_battles: List[Dict[str, Any]] = []
    seen_ids: set = set()

    # 1. If password is provided, sign in via BattleBase GraphQL `signIn` mutation
    if clean_pass:
        login_query = """
        mutation Login($email: String!, $password: String!) {
          signIn(email: $email, password: $password) {
            token
            me { id email username }
          }
        }
        """
        res_login = _battlebase_graphql_request(login_query, {"email": clean_user, "password": clean_pass})
        sign_in_data = (res_login.get("data") or {}).get("signIn")
        if sign_in_data and sign_in_data.get("token"):
            token = sign_in_data["token"]
            me_obj = sign_in_data.get("me") or {}
            if me_obj.get("username"):
                resolved_username = str(me_obj["username"])
        elif "@" in clean_user:
            errs = res_login.get("errors") or []
            err_msg = errs[0].get("message") if errs and isinstance(errs[0], dict) else "Invalid BattleBase email or password."
            raise ValueError(f"BattleBase login failed: {err_msg}")

    # 2. If authenticated with token, fetch `me.battles`
    if token:
        me_query = """
        query MeBattles {
          me {
            id
            username
            battles {
              id
              isFinished
              createdBy { id username }
              opponent { id username }
              battleSetupJson
              eventsJson
            }
          }
        }
        """
        res_me = _battlebase_graphql_request(me_query, {}, token=token)
        me_node = (res_me.get("data") or {}).get("me") or {}
        if me_node.get("username"):
            resolved_username = str(me_node["username"])
        for b in (me_node.get("battles") or []):
            if isinstance(b, dict) and b.get("id") and b["id"] not in seen_ids:
                seen_ids.add(b["id"])
                raw_battles.append(b)

    # 3. Also query `user(username: ...)` (supports syncing by BattleBase username or supplementing `me.battles`)
    if resolved_username and "@" not in resolved_username:
        user_query = """
        query UserBattles($username: String!, $last: Int) {
          user(username: $username) {
            id
            username
            battles(last: $last) {
              id
              isFinished
              createdBy { id username }
              opponent { id username }
              battleSetupJson
              eventsJson
            }
          }
        }
        """
        try:
            res_u = _battlebase_graphql_request(user_query, {"username": resolved_username, "last": 200}, token=token)
            u_node = (res_u.get("data") or {}).get("user")
            if not u_node and not token:
                raise ValueError(f"BattleBase user '{resolved_username}' not found. Check your username or sign in with your BattleBase email & password.")
            if isinstance(u_node, dict):
                for b in (u_node.get("battles") or []):
                    if isinstance(b, dict) and b.get("id") and b["id"] not in seen_ids:
                        seen_ids.add(b["id"])
                        raw_battles.append(b)
        except ValueError:
            raise
        except Exception as e:
            logger.warning(f"BattleBase user query warning for {resolved_username}: {e}")

    imported_games: List[Dict[str, Any]] = []
    for b in raw_battles:
        conv = convert_battlebase_battle_to_omnitactica(
            b,
            importing_user=importing_user,
            target_bb_username=resolved_username,
        )
        if conv:
            imported_games.append(conv)

    return {
        "username": resolved_username,
        "raw_count": len(raw_battles),
        "games": imported_games,
    }


# ============================================================================
# 5. NEWRECRUIT (https://www.newrecruit.eu/api/rpc) GAME & REPORT IMPORTER
# ============================================================================

def _parse_nr_exported_list_meta(exported_list: str, is_aos: bool = False) -> Tuple[str, str]:
    """Extracts (faction, detachment/formation) from a NewRecruit WTC-Compact or GW exported_list string."""
    text = str(exported_list or "").replace("\u00a0", " ")
    if not text:
        return ("", "")
    fac = ""
    det = ""
    m_fac = re.search(r"\+\s*FACTION KEYWORD:\s*([^\r\n]+)", text, re.IGNORECASE)
    if m_fac:
        raw_f = m_fac.group(1).strip()
        if " - " in raw_f:
            raw_f = raw_f.split(" - ", 1)[1].strip()
        fac = raw_f
    m_det = re.search(r"\+\s*(?:DETACHMENT|BATTLE FORMATION|SUBFACTION):\s*([^\r\n]+)", text, re.IGNORECASE)
    if m_det:
        raw_d = m_det.group(1).strip()
        raw_d = re.sub(r"\s*\([^)]*\)\s*$", "", raw_d).strip()
        det = raw_d
    return (fac, det)


def convert_newrecruit_report_to_omnitactica(
    report: Dict[str, Any],
    importing_user: Optional[Dict[str, Any]] = None,
    target_nr_user_id: str = "",
    target_nr_login: str = "",
) -> Optional[Dict[str, Any]]:
    """Converts a NewRecruit `match_history` or `my_reports` game report into an OmniTactica scorecard."""
    if not isinstance(report, dict):
        return None
    rep_id = str(report.get("_id") or report.get("id") or "").strip()
    players = report.get("players") or []
    scores = report.get("score") or []
    if len(players) < 2 or len(scores) < 2:
        return None

    sys_id = int(report.get("id_game_system") or 827374861)
    is_aos = sys_id == 4255553472

    def _extract_nr_p(idx: int) -> Dict[str, Any]:
        p = players[idx] if isinstance(players[idx], dict) else {}
        sc = scores[idx] if isinstance(scores[idx], dict) else {}
        vp = sc.get("vp")
        if vp is None:
            vp = sc.get("tp") if sc.get("tp") is not None else sc.get("score")
        total_vp = int(vp or 0) if isinstance(vp, (int, float, str)) and str(vp).lstrip("-").isdigit() else 0
        exp_list = str(p.get("exported_list") or "").strip()
        fac, det = _parse_nr_exported_list_meta(exp_list, is_aos=is_aos)
        if not fac:
            fac = "Age of Sigmar" if is_aos else "Warhammer 40k"
        p_name = str(p.get("name") or p.get("alias") or f"Player {idx + 1}").strip()

        # Synthesize clean 5-round breakdown from total_vp
        pri = [0, 0, 0, 0, 0]
        secs = []
        tactics = []
        if is_aos:
            pri_tot = min(30, int(round(total_vp * 0.6)))
            tac_tot = max(0, min(20, total_vp - pri_tot))
            for i in range(5):
                pri[i] = pri_tot // 5 + (1 if i < (pri_tot % 5) else 0)
                if tac_tot >= 4:
                    tactics.append({"round": i + 1, "name": f"Round {i + 1} Battle Tactic", "score": 4, "completed": True})
                    tac_tot -= 4
        else:
            paint = total_vp >= 10
            rem = max(0, total_vp - (10 if paint else 0))
            pri_tot = min(50, int(round(rem * 0.56)))
            sec_tot = max(0, min(40, rem - pri_tot))
            for i in range(1, 5):
                pri[i] = pri_tot // 4 + (1 if (i - 1) < (pri_tot % 4) else 0)
            if sec_tot > 0:
                s_arr = [sec_tot // 5 + (1 if i < (sec_tot % 5) else 0) for i in range(5)]
                secs.append({"name": "Secondary Objectives", "id": "secondary-objectives", "scores": s_arr, "categoryId": "tacticalMissions"})

        return {
            "id_member": str(p.get("id_member") or ""),
            "name": p_name,
            "faction": {"name": fac, "subtitle": det},
            "primaries": [{"name": "Border War" if is_aos else "Take & Hold", "scores": pri}],
            "secondaries": secs,
            "battleTactics": tactics,
            "isBattleReady": not is_aos and total_vp >= 10,
            "totalScore": total_vp,
            "armyListText": exp_list,
        }

    p0 = _extract_nr_p(0)
    p1 = _extract_nr_p(1)

    swap = False
    if target_nr_user_id and p1["id_member"] == target_nr_user_id and p0["id_member"] != target_nr_user_id:
        swap = True
    elif target_nr_login and p1["name"].lower() == target_nr_login.lower() and p0["name"].lower() != target_nr_login.lower():
        swap = True

    first_turn_idx = int(report.get("first_turn") or 0)
    if swap:
        players_arr = [p1, p0]
        went_first = "firstPlayer" if first_turn_idx == 1 else "secondPlayer"
    else:
        players_arr = [p0, p1]
        went_first = "secondPlayer" if first_turn_idx == 1 else "firstPlayer"

    ttb_equiv = {
        "id": f"nr-{rep_id}",
        "gameType": "aos4e" if is_aos else "wh40k10e",
        "gameDate": report.get("date") or datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "isFinished": True,
        "wentFirstRollOff": went_first,
        "mission": {
            "missionName": "Border War" if is_aos else "Take & Hold",
            "packName": "General's Handbook" if is_aos else "Chapter Approved",
            "deploymentMapName": "Standard Deployment" if is_aos else "Search & Destroy",
            "selectedMissionRules": [f"Round {report.get('round')}" if report.get("round") else "Matched Play"],
        },
        "players": players_arr,
    }
    return convert_ttb_game_to_omnitactica(
        ttb_equiv,
        importing_user=importing_user,
        default_system="aos" if is_aos else "40k",
        source_label="newrecruit",
    )


def sync_newrecruit_account_games(
    username: str,
    password: str = "",
    importing_user: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Authenticates with NewRecruit (`https://www.newrecruit.eu/api/rpc`) using login + password
    and pulls all 40k & AoS match reports (`my_reports` + `match_history` for both friendly and tournament games).
    """
    from newrecruit_integration import _nr_rpc_call, hash_newrecruit_password

    clean_user = (username or "").strip()
    clean_pass = password or ""
    if not clean_user:
        raise ValueError("NewRecruit Username or Email is required.")
    if not clean_pass:
        raise ValueError("NewRecruit Password is required.")

    hashed_pw = hash_newrecruit_password(clean_user, clean_pass)
    login_res = _nr_rpc_call("login", [clean_user, hashed_pw])
    if (not isinstance(login_res, dict) or login_res.get("error") or not login_res.get("access")) and "@" in clean_user:
        login_res = _nr_rpc_call("login_from_email", [clean_user, clean_pass])

    if not isinstance(login_res, dict) or login_res.get("error") or not login_res.get("access"):
        err_msg = (login_res.get("message") or login_res.get("msg") or "Invalid NewRecruit username or password.") if isinstance(login_res, dict) else "Login failed."
        raise ValueError(f"NewRecruit login failed: {err_msg}")

    access_token = str(login_res["access"])
    nr_user_id = str(login_res.get("_id") or login_res.get("id_user") or "")
    nr_login_name = str(login_res.get("login") or clean_user)

    if not nr_user_id:
        try:
            u_data = _nr_rpc_call("user_get_data", [], access_token=access_token)
            if isinstance(u_data, dict):
                u_obj = u_data.get("user") if isinstance(u_data.get("user"), dict) else u_data
                nr_user_id = str(u_obj.get("_id") or "")
                nr_login_name = str(u_obj.get("login") or nr_login_name)
        except Exception:
            pass

    raw_reports: List[Dict[str, Any]] = []
    seen_ids: set = set()

    for sys_id in (827374861, 4255553472):
        # 1. User's own reports
        try:
            my_reps = _nr_rpc_call("my_reports", [sys_id], access_token=access_token)
            if isinstance(my_reps, list):
                for r in my_reps:
                    if isinstance(r, dict) and r.get("_id") and r["_id"] not in seen_ids:
                        seen_ids.add(r["_id"])
                        raw_reports.append(r)
        except Exception as e:
            logger.debug(f"NewRecruit my_reports({sys_id}) warning: {e}")

        # 2. Match history (friendly + tourny)
        if nr_user_id:
            for p_type in ("friendly", "tourny"):
                try:
                    mh = _nr_rpc_call("match_history", [sys_id, p_type, nr_user_id], access_token=access_token)
                    if isinstance(mh, list):
                        for r in mh:
                            if isinstance(r, dict) and r.get("_id") and r["_id"] not in seen_ids:
                                seen_ids.add(r["_id"])
                                raw_reports.append(r)
                except Exception as e:
                    logger.debug(f"NewRecruit match_history({sys_id}, {p_type}) warning: {e}")

    imported_games: List[Dict[str, Any]] = []
    for rep in raw_reports:
        conv = convert_newrecruit_report_to_omnitactica(
            rep,
            importing_user=importing_user,
            target_nr_user_id=nr_user_id,
            target_nr_login=nr_login_name,
        )
        if conv:
            imported_games.append(conv)

    return {
        "username": nr_login_name,
        "raw_count": len(raw_reports),
        "games": imported_games,
    }


# ============================================================================
# 6. CHAMPIONSHUB (https://api.championshub.app/api) TOURNAMENT & HOME GAMES IMPORTER
# ============================================================================

CHAMPIONSHUB_API_BASE = "https://api.championshub.app/api"


def _championshub_request(
    path: str,
    method: str = "GET",
    payload: Optional[Dict[str, Any]] = None,
    game_system: str = "wh40k",
    cookie_header: str = "",
) -> Tuple[Any, str]:
    url = f"{CHAMPIONSHUB_API_BASE}/{path.lstrip('/')}"
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; OmniTacticaTrackerSync/1.0)",
        "Accept": "application/json",
        "game-system": game_system,
        "locale": "en",
    }
    if cookie_header:
        headers["Cookie"] = cookie_header
    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=15) as resp:
        set_cookies = resp.headers.get_all("Set-Cookie") or []
        cookie_str = "; ".join(c.split(";", 1)[0] for c in set_cookies if ";" in c)
        raw = resp.read().decode("utf-8", errors="ignore")
        return (json.loads(raw) if raw.strip() else {}, cookie_str)


def sync_championshub_account_games(
    username: str,
    password: str = "",
    importing_user: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Authenticates with ChampionsHub (`https://api.championshub.app/api`) using Email + Password
    (or searches by ChampionsHub Display Name / User ID) and imports all 40k & AoS tournament + private games.
    """
    clean_user = (username or "").strip()
    clean_pass = password or ""
    if not clean_user:
        raise ValueError("ChampionsHub Email or Username is required.")

    cookie_hdr = ""
    ch_user_id = ""
    ch_display = clean_user

    # 1. If password is provided, sign in via POST /api/auth/login
    if clean_pass and "@" in clean_user:
        try:
            _, login_cookies = _championshub_request(
                "auth/login",
                method="POST",
                payload={"email": clean_user, "password": clean_pass, "rememberMe": True},
            )
            cookie_hdr = login_cookies
            prof, _ = _championshub_request("user/profile", method="GET", cookie_header=cookie_hdr)
            if isinstance(prof, dict) and prof.get("id"):
                ch_user_id = str(prof["id"])
                ch_display = str(prof.get("displayName") or clean_user)
        except urllib.error.HTTPError as he:
            raise ValueError(f"ChampionsHub login failed (HTTP {he.code}). Check your email and password.")
        except Exception as e:
            raise ValueError(f"ChampionsHub login failed: {e}")

    # 2. If ch_user_id not yet resolved, check if clean_user is a UUID or search ranking-elo/list
    if not ch_user_id:
        if re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", clean_user, re.I):
            ch_user_id = clean_user
        else:
            q_low = clean_user.lower()
            for sys_code in ("wh40k", "aos"):
                try:
                    search_res, _ = _championshub_request(
                        "ranking-elo/list",
                        method="POST",
                        payload={"cityId": "", "search": clean_user, "seasonLabel": "CURRENT"},
                        game_system=sys_code,
                    )
                    rows = (search_res.get("data") or []) if isinstance(search_res, dict) else []
                    exact_match = None
                    partial_match = None
                    for r in rows:
                        if not isinstance(r, dict) or not isinstance(r.get("user"), dict):
                            continue
                        dn = str(r["user"].get("displayName") or "").strip()
                        if dn.lower() == q_low:
                            exact_match = r["user"]
                            break
                        if not partial_match and q_low in dn.lower():
                            partial_match = r["user"]
                    picked = exact_match or partial_match
                    if picked and picked.get("id"):
                        ch_user_id = str(picked["id"])
                        ch_display = str(picked.get("displayName") or clean_user)
                        break
                except Exception:
                    pass

    if not ch_user_id:
        raise ValueError(f"Could not find ChampionsHub player '{clean_user}'. Sign in with your ChampionsHub email & password or enter your exact ChampionsHub display name.")

    imported_games: List[Dict[str, Any]] = []
    raw_count = 0

    for sys_code, is_aos in (("wh40k", False), ("aos", True)):
        # Load army dictionary for faction lookup
        army_map: Dict[int, str] = {}
        try:
            armies_res, _ = _championshub_request("army/list", method="GET", game_system=sys_code)
            if isinstance(armies_res, list):
                for a in armies_res:
                    if isinstance(a, dict) and a.get("id") and a.get("name"):
                        army_map[int(a["id"])] = str(a["name"])
        except Exception:
            pass

        # A. Fetch tournament history & detailed round pairings
        try:
            hist_res, _ = _championshub_request(
                f"ranking-elo/user-history/{ch_user_id}?season=CURRENT",
                method="GET",
                game_system=sys_code,
                cookie_header=cookie_hdr,
            )
            events_list = (hist_res.get("data") or []) if isinstance(hist_res, dict) else []
        except Exception:
            events_list = []

        for ev in events_list[:30]:
            if not isinstance(ev, dict) or not ev.get("id"):
                continue
            ev_id = str(ev["id"])
            ev_name = str(ev.get("name") or "ChampionsHub Tournament")
            ev_date = ev.get("startsAt") or ev.get("endsAt")

            # Fetch detailed submission/list to get secondaryPoints (actual 0-100 Battle VP) & army list
            sub_data = None
            try:
                sub_res, _ = _championshub_request(
                    f"submission/list/{ev_id}/{ch_user_id}",
                    method="GET",
                    game_system=sys_code,
                    cookie_header=cookie_hdr,
                )
                if isinstance(sub_res, dict) and sub_res.get("userPairings"):
                    sub_data = sub_res
            except Exception:
                sub_data = None

            pairings = (sub_data.get("userPairings") if sub_data else None) or ev.get("pairings") or []
            my_list_text = str((sub_data or {}).get("list") or "").strip()
            my_list_title = str((sub_data or {}).get("listTitle") or "").strip()

            for p_idx, pr in enumerate(pairings):
                if not isinstance(pr, dict):
                    continue
                u1 = pr.get("pairingUser1") or {}
                u2 = pr.get("pairingUser2") or {}
                if not u1 or not u2:
                    continue
                raw_count += 1

                def _parse_ch_side(side: Dict[str, Any]) -> Dict[str, Any]:
                    u_nested = side.get("user") if isinstance(side.get("user"), dict) else {}
                    uid = str(side.get("userId") or u_nested.get("id") or "")
                    dname = str(side.get("displayName") or u_nested.get("displayName") or "Player").strip()
                    army_obj = side.get("army") if isinstance(side.get("army"), dict) else {}
                    aid = side.get("armyId") or army_obj.get("id")
                    fac_name = str(army_obj.get("name") or (army_map.get(int(aid)) if isinstance(aid, int) else "") or ("Age of Sigmar" if is_aos else "Warhammer 40k"))
                    # In ChampionsHub, secondaryPoints is 0-100 Battle VP; primaryPoints is 0-20 WTC TP
                    sec_pts = side.get("secondaryPoints")
                    pri_pts = side.get("primaryPoints")
                    vp = int(sec_pts) if isinstance(sec_pts, (int, float)) and int(sec_pts) > 0 else int(pri_pts or 0)
                    is_me = uid == ch_user_id

                    pri_arr = [0, 0, 0, 0, 0]
                    secs_arr = []
                    tactics_arr = []
                    if is_aos:
                        p_tot = min(30, int(round(vp * 0.6)))
                        t_tot = max(0, min(20, vp - p_tot))
                        for i in range(5):
                            pri_arr[i] = p_tot // 5 + (1 if i < (p_tot % 5) else 0)
                            if t_tot >= 4:
                                tactics_arr.append({"round": i + 1, "name": f"Round {i + 1} Battle Tactic", "score": 4, "completed": True})
                                t_tot -= 4
                    else:
                        paint = vp >= 10
                        rem = max(0, vp - (10 if paint else 0))
                        p_tot = min(50, int(round(rem * 0.56)))
                        s_tot = max(0, min(40, rem - p_tot))
                        for i in range(1, 5):
                            pri_arr[i] = p_tot // 4 + (1 if (i - 1) < (p_tot % 4) else 0)
                        if s_tot > 0:
                            s_5 = [s_tot // 5 + (1 if i < (s_tot % 5) else 0) for i in range(5)]
                            secs_arr.append({"name": "Secondary Objectives", "id": "secondary-objectives", "scores": s_5, "categoryId": "tacticalMissions"})

                    return {
                        "uid": uid,
                        "name": dname,
                        "faction": {"name": fac_name, "subtitle": my_list_title if is_me else ""},
                        "primaries": [{"name": ev_name, "scores": pri_arr}],
                        "secondaries": secs_arr,
                        "battleTactics": tactics_arr,
                        "isBattleReady": not is_aos and vp >= 10,
                        "totalScore": vp,
                        "armyListText": my_list_text if is_me else "",
                    }

                s1 = _parse_ch_side(u1)
                s2 = _parse_ch_side(u2)
                players_arr = [s2, s1] if (s2["uid"] == ch_user_id and s1["uid"] != ch_user_id) else [s1, s2]
                round_id = str(pr.get("roundId") or f"{ev_id}-r{p_idx + 1}")
                round_name = str(pr.get("roundName") or f"Round {p_idx + 1}")

                ttb_equiv = {
                    "id": f"ch-{ev_id}-{round_id}",
                    "gameType": "aos4e" if is_aos else "wh40k10e",
                    "gameDate": ev_date or datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    "eventName": ev_name,
                    "isFinished": True,
                    "mission": {
                        "missionName": f"{ev_name} ({round_name})",
                        "packName": "ChampionsHub",
                        "deploymentMapName": "Tournament Pairing",
                        "selectedMissionRules": [round_name],
                    },
                    "players": players_arr,
                }
                conv = convert_ttb_game_to_omnitactica(
                    ttb_equiv,
                    importing_user=importing_user,
                    default_system="aos" if is_aos else "40k",
                    source_label="championshub",
                )
                if conv:
                    imported_games.append(conv)

    return {
        "username": ch_display,
        "raw_count": raw_count,
        "games": imported_games,
    }


# ============================================================================
# 7. MILARKI (https://www.milarki.com/api/v1) AGE OF SIGMAR BATTLE IMPORTER
# ============================================================================

MILARKI_API_BASE = "https://www.milarki.com/api/v1"


def convert_milarki_battle_to_omnitactica(
    battle: Dict[str, Any],
    importing_user: Optional[Dict[str, Any]] = None,
    target_player_id: str = "",
) -> Optional[Dict[str, Any]]:
    """
    Converts a Milarki API v1 Battle object (`/api/v1/users/{publicId}/battles`) into a full
    round-by-round OmniTactica Age of Sigmar scorecard (`AOS-MLK-...`).
    """
    if not isinstance(battle, dict):
        return None
    b_id = str(battle.get("id") or "").strip()
    players = battle.get("players") or []
    if not b_id or len(players) < 2:
        return None

    scenario = str(battle.get("scenario") or "Border War").strip()
    battle_pack = str(battle.get("battlePack") or "General's Handbook").strip()
    b_date = battle.get("date") or datetime.datetime.now(datetime.timezone.utc).isoformat()
    tourn_slug = str(battle.get("tournament") or "").strip()

    def _map_mlk_player(p: Dict[str, Any], idx: int) -> Dict[str, Any]:
        p_name = str(p.get("player") or f"Player {idx + 1}").strip()
        p_id = str(p.get("playerId") or "").strip()
        fac = str(p.get("faction") or "Age of Sigmar").strip()
        sub_fac = str(p.get("subFaction") or "").strip()
        vp = int(p.get("victoryPoints") or p.get("battlePoints") or 0)
        gs_name = str(p.get("grandStrategy") or "").strip()
        gs_scored = bool(p.get("grandStrategyScored"))

        pri_scores = [0, 0, 0, 0, 0]
        tactics_list = []
        rounds_arr = p.get("rounds") if isinstance(p.get("rounds"), list) else []
        if rounds_arr:
            for r in rounds_arr:
                if not isinstance(r, dict):
                    continue
                r_num = max(1, min(5, int(r.get("round") or 1)))
                obj_pts = int(r.get("objectivePoints") if r.get("objectivePoints") is not None else max(0, int(r.get("victoryPoints") or 0) - (4 if r.get("battleTacticScored") else 0)))
                pri_scores[r_num - 1] = obj_pts
                bt_name = str(r.get("battleTactic") or "").strip()
                bt_scored = bool(r.get("battleTacticScored"))
                if bt_name or bt_scored:
                    tactics_list.append({
                        "round": r_num,
                        "name": bt_name or f"Round {r_num} Battle Tactic",
                        "score": 4 if bt_scored else 0,
                        "completed": bt_scored,
                    })
        else:
            obj_tot = int(p.get("objectivePoints") or min(30, int(round(vp * 0.6))))
            bt_cnt = int(p.get("battleTacticsScored") or max(0, (vp - obj_tot) // 4))
            for i in range(5):
                pri_scores[i] = obj_tot // 5 + (1 if i < (obj_tot % 5) else 0)
                if i < bt_cnt:
                    tactics_list.append({
                        "round": i + 1,
                        "name": f"Round {i + 1} Battle Tactic",
                        "score": 4,
                        "completed": True,
                    })

        return {
            "playerId": p_id,
            "name": p_name,
            "faction": {"name": fac, "subtitle": sub_fac},
            "primaries": [{"name": scenario, "scores": pri_scores}],
            "battleTactics": tactics_list,
            "grandStrategy": {"name": gs_name, "points": 3 if gs_scored else 0, "achieved": gs_scored} if gs_name else None,
            "totalScore": vp,
        }

    p0 = _map_mlk_player(players[0], 0)
    p1 = _map_mlk_player(players[1], 1)
    if target_player_id and p1["playerId"].upper() == target_player_id.strip().upper() and p0["playerId"].upper() != target_player_id.strip().upper():
        players_arr = [p1, p0]
    else:
        players_arr = [p0, p1]

    is_3e = any(k in battle_pack.lower() for k in ("2022", "2023", "23-24", "3rd", "3e")) or bool(players_arr[0].get("grandStrategy"))
    ttb_equiv = {
        "id": f"mlk-{b_id}",
        "gameType": "aos3e" if is_3e else "aos4e",
        "edition": "aos_3e" if is_3e else "aos_4e",
        "gameDate": b_date,
        "eventName": _humanize_identifier(tourn_slug) if tourn_slug else "",
        "isFinished": True,
        "mission": {
            "missionName": scenario,
            "packName": battle_pack,
            "deploymentMapName": "Age of Sigmar Battleplan",
            "selectedMissionRules": [battle_pack],
        },
        "players": players_arr,
    }
    return convert_ttb_game_to_omnitactica(
        ttb_equiv,
        importing_user=importing_user,
        default_system="aos",
        source_label="milarki",
    )


def sync_milarki_account_games(
    player_id: str,
    api_key: str,
    importing_user: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Fetches a player's Age of Sigmar battles from Milarki's official REST API v1
    (`GET https://www.milarki.com/api/v1/users/{publicId}/battles?limit=100` with `Bearer mlk_v1_...`).
    """
    clean_pid = (player_id or "").strip()
    clean_key = (api_key or "").strip()
    if not clean_pid:
        raise ValueError("Milarki Player ID (e.g. L80MTI4R) is required.")
    if not clean_key:
        raise ValueError("Milarki API Key (mlk_v1_...) is required. Generate one in your Milarki Account Settings.")

    url = f"{MILARKI_API_BASE}/users/{urllib.parse.quote(clean_pid)}/battles?limit=100"
    headers = {
        "Authorization": f"Bearer {clean_key}",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; OmniTacticaTrackerSync/1.0)",
    }
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read().decode("utf-8", errors="ignore"))
    except urllib.error.HTTPError as he:
        if he.code == 401:
            raise ValueError("Milarki authentication failed: Invalid API Key (must start with mlk_v1_).")
        if he.code == 404:
            raise ValueError(f"Milarki Player ID '{clean_pid}' not found.")
        raise ValueError(f"Milarki API returned HTTP {he.code}.")

    battles = (payload.get("data") if isinstance(payload, dict) else payload) or []
    imported_games: List[Dict[str, Any]] = []
    for b in battles:
        conv = convert_milarki_battle_to_omnitactica(
            b,
            importing_user=importing_user,
            target_player_id=clean_pid,
        )
        if conv:
            imported_games.append(conv)

    return {
        "username": clean_pid,
        "raw_count": len(battles),
        "games": imported_games,
    }

