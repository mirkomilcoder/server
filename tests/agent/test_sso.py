import base64
import hashlib
import json
import random
import time

import pytest

from mirkomil import sso
from mirkomil.sso import SSOError, verify

TEAM = "round-silence-7567.cloudflareaccess.com"
AUD = "aud-123"


def _prime(bits, rng):
    while True:
        n = rng.getrandbits(bits) | (1 << (bits - 1)) | 1
        if all(n % p for p in (3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37)) and _probable(n, rng):
            return n


def _probable(n, rng, rounds=20):
    d, r = n - 1, 0
    while d % 2 == 0:
        d //= 2
        r += 1
    for _ in range(rounds):
        x = pow(rng.randrange(2, n - 2), d, n)
        if x in (1, n - 1):
            continue
        for _ in range(r - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


@pytest.fixture(scope="module")
def key():
    rng = random.Random(7)
    e = 65537
    while True:
        p, q = _prime(512, rng), _prime(512, rng)
        phi = (p - 1) * (q - 1)
        if p != q and phi % e:
            return p * q, e, pow(e, -1, phi)


def _b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _token(key, claims=None, header=None):
    n, e, d = key
    head = _b64(json.dumps(header or {"alg": "RS256", "kid": "k1", "typ": "JWT"}).encode())
    body = {"iss": f"https://{TEAM}", "aud": [AUD], "email": "Boss@Gmail.com", "exp": time.time() + 3600,
            "nbf": time.time() - 10, **(claims or {})}
    payload = _b64(json.dumps(body).encode())
    k = (n.bit_length() + 7) // 8
    t = sso.SHA256_PREFIX + hashlib.sha256(f"{head}.{payload}".encode()).digest()
    em = int.from_bytes(b"\x00\x01" + b"\xff" * (k - len(t) - 3) + b"\x00" + t, "big")
    return f"{head}.{payload}.{_b64(pow(em, d, n).to_bytes(k, 'big'))}"


def _check(key, tok, emails=("boss@gmail.com",)):
    return verify(tok, TEAM, AUD, list(emails), key=lambda kid: (key[0], key[1]) if kid == "k1" else (_ for _ in ()).throw(SSOError("kid")))


def test_valid_token_returns_the_email(key):
    assert _check(key, _token(key)) == "boss@gmail.com"


def test_tampered_payload_is_refused(key):
    h, p, s = _token(key).split(".")
    forged = _b64(json.dumps({"iss": f"https://{TEAM}", "aud": [AUD], "email": "evil@x.uz", "exp": time.time() + 99}).encode())
    with pytest.raises(SSOError, match="imzo"):
        _check(key, f"{h}.{forged}.{s}", emails=["evil@x.uz"])


@pytest.mark.parametrize("header", [{"alg": "none", "kid": "k1"}, {"alg": "HS256", "kid": "k1"}])
def test_only_rs256(key, header):
    with pytest.raises(SSOError, match="RS256"):
        _check(key, _token(key, header=header))


@pytest.mark.parametrize("claims,why", [
    ({"aud": ["someone-else"]}, "boshqa ilova"),
    ({"iss": "https://evil.cloudflareaccess.com"}, "issuer"),
    ({"exp": time.time() - 3600}, "muddati"),
    ({"nbf": time.time() + 3600}, "kuchga"),
    ({"email": "stranger@gmail.com"}, "ro'yxatida yo'q"),
])
def test_claims_are_enforced(key, claims, why):
    with pytest.raises(SSOError, match=why):
        _check(key, _token(key, claims))


def test_unknown_key_id_is_refused(key):
    with pytest.raises(SSOError):
        _check(key, _token(key, header={"alg": "RS256", "kid": "other"}))


def test_garbage_is_refused(key):
    for bad in ("", "a.b", "a.b.c", "x" * 9000):
        with pytest.raises(SSOError):
            _check(key, bad)


# ---------------------------------------------------------------- /mk-sso redirect

@pytest.fixture
def state(tmp_path, monkeypatch, key):
    monkeypatch.setattr(sso, "TUNNEL_DIR", tmp_path)
    (tmp_path / "state.json").write_text(json.dumps({"team": TEAM, "aud": AUD, "emails": ["boss@gmail.com"],
                                                     "panel_host": "panel.milano-kafe.uz"}))
    monkeypatch.setattr(sso, "team_keys", lambda team, kid, **_: (key[0], key[1]))
    return tmp_path


def test_token_goes_back_only_to_the_panel(state, key):
    tok = _token(key)
    status, loc = sso.token_redirect(tok, "https://panel.milano-kafe.uz/?x=1#old")
    assert status == 302 and loc == f"https://panel.milano-kafe.uz/?x=1#access_token={tok}"
    for other in ("https://evil.example/", "http://panel.milano-kafe.uz/", "https://192.168.1.5:9090/",
                  "https://panel.milano-kafe.uz.evil.com/", "https://panel.milano-kafe.uz/\r\nSet-Cookie: x=1"):
        assert sso.token_redirect(tok, other) == (302, "https://panel.milano-kafe.uz/")


def test_invalid_or_missing_token_never_redirects_with_a_token(state, key):
    assert sso.token_redirect("", "https://panel.milano-kafe.uz/") == (302, "https://panel.milano-kafe.uz/")
    status, loc = sso.token_redirect(_token(key, {"email": "x@y.uz"}), "https://panel.milano-kafe.uz/")
    assert "access_token" not in loc and "#error=" in loc


def test_tunnel_routes_mk_sso_behind_access_and_hosts_are_distinct():
    from mirkomil.cloudflare import build_ingress, hosts_of
    ing = build_ingress("d.uz", {}, "t.cloudflareaccess.com", "AUD", None)
    assert ing[0] == {"hostname": "panel.d.uz", "path": "^/mk-sso$", "service": "http://localhost:8099",
                      "originRequest": {"access": {"required": True, "teamName": "t", "audTag": ["AUD"]}}}
    assert hosts_of(ing) == ["panel.d.uz", "hooks.d.uz"]
