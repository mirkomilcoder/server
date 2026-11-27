"""Single sign-on: Cloudflare Access → Cockpit, with no second password.

How a login works
    1. panel.<domain> is protected by Cloudflare Access (Google / GitHub / email code;
       only the super-admin emails are allowed). cloudflared also rejects any request
       without a valid Access token for our app (originRequest.access.required).
    2. Cockpit's own login page is configured for OAuth ([OAuth] in cockpit.conf):
       it opens /mk-sso, which (behind Access) answers with a redirect back to the
       panel carrying the request's Cloudflare-signed token (Cf-Access-Jwt-Assertion).
    3. The login page sends it as "Authorization: Bearer <jwt>". cockpit-ws hands that to
       this module ([bearer] UnixPath = /run/mirkomil-sso.sock, a root socket service).
    4. We verify the RS256 signature against the team's public keys, the issuer, our
       app's audience, the expiry, that the email is a super admin, and that the request
       came through the tunnel (loopback). Only then a session starts — as the dedicated
       account "mkadmin" (no password, no SSH), whose only sudo right is Cockpit's
       admin-mode bridge. Every login is logged with the person's email.

Everything is standard library: RSA-PKCS#1 v1.5 verification is a modular exponentiation.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import pwd
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger("mirkomil.sso")

SSO_USER = "mkadmin"
TUNNEL_DIR = Path(os.environ.get("MK_TUNNEL_DIR", "/var/lib/mirkomil/tunnel"))
CERTS_FILE = TUNNEL_DIR / "access-certs.json"  # public keys only (0644)
LEEWAY = 60
# DER prefix of DigestInfo for SHA-256 (RFC 8017 §9.2)
SHA256_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")


class SSOError(Exception):
    """Why a token was refused (logged; the browser only sees "authentication failed")."""


def _b64url(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def rs256_ok(n: int, e: int, signing_input: bytes, sig: bytes) -> bool:
    k = (n.bit_length() + 7) // 8
    if len(sig) != k:
        return False
    s = int.from_bytes(sig, "big")
    if s >= n:
        return False
    em = pow(s, e, n).to_bytes(k, "big")
    t = SHA256_PREFIX + hashlib.sha256(signing_input).digest()
    expected = b"\x00\x01" + b"\xff" * (k - len(t) - 3) + b"\x00" + t
    return hmac.compare_digest(em, expected)


# ---------------------------------------------------------------- Cloudflare's public keys

_memory: dict[str, Any] = {"keys": {}, "fetched": 0.0}


def _fetch_certs(team: str) -> dict[str, tuple[int, int]]:
    url = f"https://{team}/cdn-cgi/access/certs"
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "mirkomil-sso"}), timeout=10) as r:
        data = json.loads(r.read())
    keys = {}
    for k in data.get("keys", []):
        if k.get("kty") == "RSA" and k.get("kid") and k.get("n") and k.get("e"):
            keys[k["kid"]] = (int.from_bytes(_b64url(k["n"]), "big"), int.from_bytes(_b64url(k["e"]), "big"))
    return keys


def team_keys(team: str, kid: str, cache_file: Path | None = CERTS_FILE,
              fetch: Callable[[str], dict[str, tuple[int, int]]] = _fetch_certs) -> tuple[int, int]:
    """Key for `kid`: memory → file cache → Cloudflare (at most once a minute; keys rotate)."""
    keys: dict[str, tuple[int, int]] = _memory["keys"]
    if kid not in keys and cache_file is not None:
        try:
            raw = json.loads(cache_file.read_text())
            if raw.get("team") == team:
                keys.update({k: (int(v[0]), int(v[1])) for k, v in raw["keys"].items()})
        except (OSError, ValueError, KeyError):
            pass
    if kid not in keys and time.time() - _memory["fetched"] > 60:
        _memory["fetched"] = time.time()
        try:
            fresh = fetch(team)
        except OSError as e:
            raise SSOError(f"Cloudflare kalitlarini olib bo'lmadi: {e}")
        keys.clear()
        keys.update(fresh)
        if cache_file is not None:
            try:
                tmp = cache_file.with_suffix(".tmp")
                tmp.write_text(json.dumps({"team": team, "keys": {k: [str(n), str(e)] for k, (n, e) in fresh.items()}}))
                os.chmod(tmp, 0o644)
                os.replace(tmp, cache_file)
            except OSError:
                pass
    if kid not in keys:
        raise SSOError("noma'lum kalit (kid)")
    return keys[kid]


def verify(token: str, team: str, aud: str, emails: list[str], now: float | None = None,
           key: Callable[[str], tuple[int, int]] | None = None) -> str:
    """Checks a Cloudflare Access token; returns the (lower-case) email or raises SSOError."""
    parts = token.strip().split(".")
    if len(parts) != 3 or len(token) > 8192:
        raise SSOError("token formati noto'g'ri")
    try:
        header = json.loads(_b64url(parts[0]))
        claims = json.loads(_b64url(parts[1]))
        sig = _b64url(parts[2])
    except ValueError:
        raise SSOError("token formati noto'g'ri")
    if header.get("alg") != "RS256":  # never "none" / HMAC
        raise SSOError("algoritm RS256 emas")
    n, e = (key or (lambda kid: team_keys(team, kid)))(str(header.get("kid", "")))
    if not rs256_ok(n, e, f"{parts[0]}.{parts[1]}".encode(), sig):
        raise SSOError("imzo noto'g'ri")
    now = time.time() if now is None else now
    if claims.get("iss") != f"https://{team}":
        raise SSOError("issuer noto'g'ri")
    auds = claims.get("aud")
    auds = auds if isinstance(auds, list) else [auds]
    if aud not in auds:
        raise SSOError("token boshqa ilova uchun")
    if not isinstance(claims.get("exp"), (int, float)) or claims["exp"] < now - LEEWAY:
        raise SSOError("token muddati tugagan")
    if isinstance(claims.get("nbf"), (int, float)) and claims["nbf"] > now + LEEWAY:
        raise SSOError("token hali kuchga kirmagan")
    email = str(claims.get("email", "")).strip().lower()
    if not email or email not in {x.lower() for x in emails}:
        raise SSOError(f"{email or '?'} super adminlar ro'yxatida yo'q")
    return email


def settings() -> dict[str, Any]:
    """team / aud / allowed emails / panel host from the tunnel state (None = SSO not possible)."""
    try:
        st = json.loads((TUNNEL_DIR / "state.json").read_text())
    except (OSError, ValueError):
        return {}
    if not (st.get("team") and st.get("aud") and st.get("panel_host")):
        return {}
    return {"team": st["team"], "aud": st["aud"], "emails": st.get("emails") or [], "panel_host": st["panel_host"]}


# ---------------------------------------------------------------- Cockpit auth command (root, per connection)

def _send(obj: dict[str, Any]) -> None:
    data = json.dumps(obj).encode()
    os.write(1, str(len(data) + 1).encode() + b"\n\n" + data)


def _read() -> dict[str, Any]:
    size = b""
    while (c := os.read(0, 1)) and c != b"\n":
        size += c
        if len(size) > 7:
            raise SSOError("frame too long")
    n = int(size or b"0")
    data = b""
    while len(data) < n:
        chunk = os.read(0, n - len(data))
        if not chunk:
            break
        data += chunk
    channel, _, payload = data.partition(b"\n")
    return json.loads(payload) if not channel else {}


def _fail(problem: str, message: str) -> int:
    _send({"command": "init", "problem": problem, "message": message})
    return 1


def auth_main() -> int:
    """stdin/stdout = the connection from cockpit-ws (mirkomil-sso@.service)."""
    _send({"command": "authorize", "cookie": f"mk{os.getpid()}{int(time.time())}", "challenge": "*"})
    try:
        reply = _read()
    except (OSError, ValueError, SSOError):
        return _fail("authentication-failed", "bad request")
    response = str(reply.get("response", ""))
    peer = str(reply.get("remote-peer", ""))
    if not response.startswith("Bearer "):
        return _fail("authentication-failed", "Bearer token kerak")
    cfg = settings()
    if not cfg:
        return _fail("authentication-unavailable", "Cloudflare kirishi sozlanmagan")
    if peer not in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
        log.warning("SSO refused: not through the tunnel (peer %s)", peer)
        return _fail("access-denied", f"Faqat https://{cfg['panel_host']} orqali kiring")
    try:
        email = verify(response[7:], cfg["team"], cfg["aud"], cfg["emails"])
    except SSOError as e:
        log.warning("SSO refused (%s): %s", peer, e)
        return _fail("authentication-failed", str(e))
    try:
        pw = pwd.getpwnam(SSO_USER)
    except KeyError:
        return _fail("authentication-unavailable", f"{SSO_USER} hisobi yo'q (sudo mirkomil repair)")
    log.info("SSO login: %s → %s", email, SSO_USER)
    os.chdir(pw.pw_dir if os.path.isdir(pw.pw_dir) else "/")
    os.execv("/usr/bin/setpriv", ["setpriv", f"--reuid={pw.pw_uid}", f"--regid={pw.pw_gid}", "--init-groups",
                                  "--reset-env", "--", "/usr/bin/cockpit-bridge"])
    return 1  # not reached


# ---------------------------------------------------------------- /mk-sso (Guardian's public listener)

def token_redirect(jwt: str, redirect_uri: str) -> tuple[int, str]:
    """(status, Location). The token is only ever handed back to the panel's own address."""
    cfg = settings()
    if not cfg:
        return 503, ""
    home = f"https://{cfg['panel_host']}/"
    if not jwt:
        return 302, home
    try:
        verify(jwt, cfg["team"], cfg["aud"], cfg["emails"])
    except SSOError as e:
        log.warning("mk-sso refused: %s", e)
        return 302, home + "#error=" + urllib.parse.quote(str(e))
    if any(ord(c) < 0x21 or c in '"<>\\^`{|}' or ord(c) == 0x7f for c in redirect_uri) or len(redirect_uri) > 2000:
        return 302, home  # never echo control characters / spaces into the Location header
    u = urllib.parse.urlsplit(redirect_uri)
    if u.scheme != "https" or u.netloc != cfg["panel_host"]:
        return 302, home  # e.g. opened from the LAN address: start again at the panel's address
    base = redirect_uri.split("#", 1)[0]
    return 302, f"{base}#access_token={jwt}"

