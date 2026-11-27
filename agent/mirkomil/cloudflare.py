"""Cloudflare Tunnel + Access + DNS, driven by a scoped API token (runs as root in the helper).

Public access model:
    panel.<domain>   → https://localhost:9090 (Cockpit), behind Cloudflare Access;
                       cloudflared ALSO validates the Access JWT (defense in depth)
    <app>.<domain>   → http://localhost:8088 (Caddy router) → app container
    <domain>         → optional "root app" (landing page)
No inbound ports are opened: cloudflared only makes outbound connections.

Token permissions needed. Either kind of token works:
    Account API token ("cfat_…", dash.cloudflare.com → Manage Account → Account API Tokens) — recommended
    User API token (dash.cloudflare.com → My Profile → API Tokens)
    Account · Cloudflare Tunnel · Edit
    Account · Access: Apps and Policies · Edit
    Account · Access: Organizations, Identity Providers, and Groups · Edit
        (Edit: turn on email-code login and brand the Access login page; Read still works without those)
    Zone · DNS · Edit   and   Zone · Zone · Read   (for the hosting domain)

Layout:
    /var/lib/mirkomil/tunnel/state.json          root:mirkomil 0640 — ids, hosts, emails (no secrets)
    /var/lib/mirkomil/tunnel/private/            root 0700 — api_token, tunnel.env (TUNNEL_TOKEN)

Only DNS records this module created (comment "mirkomil") are ever changed or deleted.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

API = "https://api.cloudflare.com/client/v4"
TUNNEL_DIR = Path(os.environ.get("MK_TUNNEL_DIR", "/var/lib/mirkomil/tunnel"))
ROUTES = Path(os.environ.get("MK_PROXY_DIR", "/var/lib/mirkomil/proxy")) / "routes.json"
MARK = "mirkomil"  # comment on records we own
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,63}$")
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{30,200}$")
SESSION = "168h"  # 7 days between Access logins

Requester = Callable[[str, str, Any], Any]


class CFError(Exception):
    pass


def _urllib_request(token: str) -> Requester:
    def req(method: str, path: str, body: Any = None) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(API + path, data=data, method=method,
                                   headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(r, timeout=30) as resp:
                payload = json.loads(resp.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read() or b"{}")
            except ValueError:
                raise CFError(f"Cloudflare {e.code}")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise CFError(f"Cloudflare'ga ulanib bo'lmadi: {type(e).__name__}")
        if not payload.get("success", False):
            msgs = "; ".join(f"{m.get('code')}: {m.get('message')}" for m in payload.get("errors", [])) or "noma'lum xato"
            raise CFError(f"Cloudflare: {msgs}")
        return payload.get("result")
    return req


class CF:
    def __init__(self, token: str, requester: Requester | None = None):
        if not TOKEN_RE.match(token or ""):
            raise CFError("API token formati noto'g'ri")
        self.req = requester or _urllib_request(token)

    # ---- discovery ----
    def verify(self, acc: str) -> None:
        """Account API tokens ("cfat_…") are checked under the account, user tokens under /user."""
        try:
            r = self.req("GET", f"/accounts/{acc}/tokens/verify", None)
        except CFError:
            r = self.req("GET", "/user/tokens/verify", None)
        if (r or {}).get("status") != "active":
            raise CFError("API token faol emas (muddati o'tgan yoki o'chirilgan)")

    def zone(self, domain: str) -> tuple[str, str]:
        try:
            r = self.req("GET", f"/zones?name={domain}", None) or []
        except CFError as e:
            msg = str(e).lower()
            # 9109 "Invalid access token" / 1000 "Invalid API Token": the token itself is wrong
            if "invalid access token" in msg or "invalid api token" in msg:
                raise CFError("Cloudflare tokenni qabul qilmadi: to'liq nusxalanganini tekshiring (bo'sh joysiz). "
                              "Token o'chirilgan yoki yangilangan (Roll) bo'lsa, yangisini kiriting.")
            # 9109 "Unauthorized to access requested resource" / 10000 "Authentication error": missing permission
            if "unauthorized" in msg or "authentication error" in msg:
                raise CFError("Tokenda «Zone · Zone · Read» ruxsati yo'q yoki u bu domenga berilmagan")
            raise
        if not r:
            raise CFError(f"{domain} domeni bu Cloudflare akkauntida topilmadi (avval domenni Cloudflare'ga qo'shing)")
        return r[0]["id"], r[0]["account"]["id"]

    def team_domain(self, acc: str) -> str:
        r = self.req("GET", f"/accounts/{acc}/access/organizations", None) or {}
        team = r.get("auth_domain", "")
        if not team:
            raise CFError("Zero Trust (Access) yoqilmagan: dash.cloudflare.com → Zero Trust'ni bir marta oching (bepul reja)")
        return team

    # ---- tunnel ----
    def ensure_tunnel(self, acc: str, name: str) -> tuple[str, str]:
        existing = self.req("GET", f"/accounts/{acc}/cfd_tunnel?name={name}&is_deleted=false", None) or []
        if existing:
            tid = existing[0]["id"]
        else:
            tid = self.req("POST", f"/accounts/{acc}/cfd_tunnel", {"name": name, "config_src": "cloudflare"})["id"]
        token = self.req("GET", f"/accounts/{acc}/cfd_tunnel/{tid}/token", None)
        if not isinstance(token, str) or not token:
            raise CFError("tunnel token olinmadi")
        return tid, token

    def put_ingress(self, acc: str, tid: str, ingress: list[dict[str, Any]]) -> None:
        self.req("PUT", f"/accounts/{acc}/cfd_tunnel/{tid}/configurations", {"config": {"ingress": ingress}})

    def tunnel_status(self, acc: str, tid: str) -> dict[str, Any]:
        r = self.req("GET", f"/accounts/{acc}/cfd_tunnel/{tid}", None) or {}
        return {"status": r.get("status", "unknown"), "connections": len(r.get("connections") or [])}

    # ---- DNS (only our own records) ----
    def dns_records(self, zone: str) -> list[dict[str, Any]]:
        return self.req("GET", f"/zones/{zone}/dns_records?type=CNAME&per_page=500", None) or []

    def sync_dns(self, zone: str, tid: str, hosts: list[str], domain: str) -> dict[str, list[str]]:
        target = f"{tid}.cfargotunnel.com"
        # custom domains outside this zone are pointed by their owner (CNAME to <app>.<domain>)
        hosts = [h for h in hosts if h == domain or h.endswith("." + domain)]
        records = {r["name"]: r for r in self.dns_records(zone)}
        created, skipped, removed = [], [], []
        for h in hosts:
            r = records.get(h)
            if r is None:
                self.req("POST", f"/zones/{zone}/dns_records",
                         {"type": "CNAME", "name": h, "content": target, "proxied": True, "comment": MARK})
                created.append(h)
            elif r.get("comment") == MARK and r.get("content") != target:
                self.req("PUT", f"/zones/{zone}/dns_records/{r['id']}",
                         {"type": "CNAME", "name": h, "content": target, "proxied": True, "comment": MARK})
                created.append(h)
            elif r.get("comment") != MARK:
                skipped.append(h)  # someone else's record: never overwrite
        for name, r in records.items():
            if r.get("comment") == MARK and name not in hosts:
                self.req("DELETE", f"/zones/{zone}/dns_records/{r['id']}", None)
                removed.append(name)
        return {"created": created, "skipped": skipped, "removed": removed}

    # ---- Access (panel protection) ----
    def ensure_otp_idp(self, acc: str) -> str | None:
        """Login with a one-time code sent to any email ("One-time PIN"). A fresh Zero Trust
        account may only offer "Cloudflare" sign-in (account members only), so we make sure
        this exists. None = the token may not create it (needs Edit on identity providers)."""
        try:
            idps = self.req("GET", f"/accounts/{acc}/access/identity_providers", None) or []
            otp = next((i for i in idps if i.get("type") == "onetimepin"), None)
            if otp is None:
                otp = self.req("POST", f"/accounts/{acc}/access/identity_providers",
                               {"name": "Email kod (One-time PIN)", "type": "onetimepin", "config": {}})
            return otp["id"]
        except CFError:
            return None

    def brand_login(self, acc: str, brand: str, domain: str) -> bool:
        """Access login page in the server's colours and name instead of Cloudflare's default."""
        try:
            org = self.req("GET", f"/accounts/{acc}/access/organizations", None) or {}
            body = {"name": org.get("name") or brand, "auth_domain": org["auth_domain"],
                    "login_design": {"background_color": "#070B16", "text_color": "#E6EDF7",
                                     "header_text": brand, "footer_text": f"Server boshqaruv paneli · {domain}",
                                     "logo_path": f"https://hooks.{domain}/brand/logo.svg"}}
            self.req("PUT", f"/accounts/{acc}/access/organizations", body)
            return True
        except (CFError, KeyError):
            return False

    def ensure_access_app(self, acc: str, host: str, emails: list[str], mode: str = "emails",
                          idp: str | None = None) -> str:
        """mode "everyone": any email that receives the code passes (then the server login and the
        user's role decide); mode "emails": only the listed addresses."""
        apps = self.req("GET", f"/accounts/{acc}/access/apps", None) or []
        app = next((a for a in apps if a.get("domain") == host), None)
        body = {"name": f"Mirkomil panel ({host})", "domain": host, "type": "self_hosted",
                "session_duration": SESSION, "app_launcher_visible": False,
                # with only the email-code login there is nothing to choose: go straight to it
                "auto_redirect_to_identity": bool(idp)}
        if idp:
            body["allowed_idps"] = [idp]
        if app is None:
            app = self.req("POST", f"/accounts/{acc}/access/apps", body)
        else:
            app = self.req("PUT", f"/accounts/{acc}/access/apps/{app['id']}", body)
        include = [{"everyone": {}}] if mode == "everyone" else [{"email": {"email": e}} for e in emails]
        policy = {"name": "Mirkomil admins", "decision": "allow", "include": include, "precedence": 1}
        pols = self.req("GET", f"/accounts/{acc}/access/apps/{app['id']}/policies", None) or []
        mine = next((p for p in pols if p.get("name") == "Mirkomil admins"), None)
        if mine:
            self.req("PUT", f"/accounts/{acc}/access/apps/{app['id']}/policies/{mine['id']}", policy)
        else:
            self.req("POST", f"/accounts/{acc}/access/apps/{app['id']}/policies", policy)
        return app["aud"]


# ---------------------------------------------------------------- desired state

def build_ingress(domain: str, routes: dict[str, Any], team: str, aud: str, root_app: str | None) -> list[dict[str, Any]]:
    """Ordered tunnel rules; the catch-all 404 must be last (Cloudflare requirement)."""
    rules: list[dict[str, Any]] = [{
        "hostname": f"panel.{domain}",
        "service": "https://localhost:9090",
        "originRequest": {"noTLSVerify": True,  # Cockpit's self-signed cert, over localhost only
                          "access": {"required": True, "teamName": team.split(".")[0], "audTag": [aud]}},
    }]
    # GitHub webhooks: only POST /github/<app> with a valid per-app HMAC is accepted there
    rules.append({"hostname": f"hooks.{domain}", "service": "http://localhost:8099"})
    for app, r in sorted(routes.items()):
        for h in r.get("hosts", []):
            rules.append({"hostname": h, "service": "http://localhost:8088", "originRequest": {"httpHostHeader": h}})
    if root_app and root_app in routes:
        host = routes[root_app]["hosts"][0]
        rules.append({"hostname": domain, "service": "http://localhost:8088", "originRequest": {"httpHostHeader": host}})
    rules.append({"service": "http_status:404"})
    return rules


def hosts_of(ingress: list[dict[str, Any]]) -> list[str]:
    return [r["hostname"] for r in ingress if "hostname" in r]


# ---------------------------------------------------------------- persistence

def _private() -> Path:
    p = TUNNEL_DIR / "private"
    p.mkdir(parents=True, exist_ok=True)
    os.chmod(p, 0o700)
    return p


def load_state() -> dict[str, Any]:
    try:
        return json.loads((TUNNEL_DIR / "state.json").read_text())
    except (OSError, ValueError):
        return {}


def save_state(state: dict[str, Any]) -> None:
    from .paas.engine import write_shared, ensure_dir
    ensure_dir(TUNNEL_DIR)
    write_shared(TUNNEL_DIR / "state.json", json.dumps(state, indent=2))


def _write_secret(name: str, text: str) -> None:
    p = _private() / name
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)


def _read_secret(name: str) -> str:
    return (_private() / name).read_text().strip()


def load_routes() -> dict[str, Any]:
    try:
        return json.loads(ROUTES.read_text())
    except (OSError, ValueError):
        return {}


# ---------------------------------------------------------------- operations (helper verbs)

ACCESS_MODES = ("everyone", "emails")


def setup(token: str, domain: str, emails: list[str], root_app: str | None = None,
          requester: Requester | None = None, mode: str = "emails", brand: str = "Mirkomil Host") -> dict[str, Any]:
    if mode not in ACCESS_MODES:
        raise CFError("kirish rejimi noto'g'ri")
    emails = sorted({e.strip().lower() for e in emails if e.strip()})
    if not all(EMAIL_RE.match(e) for e in emails) or (mode == "emails" and not emails):
        raise CFError("kamida bitta to'g'ri email kerak (panelga kira oladiganlar)")
    cf = CF(token, requester)
    zone, acc = cf.zone(domain)  # first call: works for account and user tokens alike
    cf.verify(acc)
    team = cf.team_domain(acc)
    tid, tunnel_token = cf.ensure_tunnel(acc, f"mirkomil-{domain}")
    warnings = []
    idp = cf.ensure_otp_idp(acc)
    if idp is None:
        warnings.append("Email kod bilan kirishni yoqib bo'lmadi: tokenga «Access: Organizations, Identity Providers, "
                        "and Groups → Edit» ruxsatini bering va qayta saqlang.")
    aud = cf.ensure_access_app(acc, f"panel.{domain}", emails, mode, idp)
    if not cf.brand_login(acc, brand, domain):
        warnings.append("Cloudflare kirish sahifasini brendlab bo'lmadi (o'sha «Edit» ruxsati kerak).")
    _write_secret("api_token", token)
    _write_secret("tunnel.env", f"TUNNEL_TOKEN={tunnel_token}\n")
    state = {"domain": domain, "zone_id": zone, "account_id": acc, "tunnel_id": tid, "team": team,
             "aud": aud, "emails": emails, "root_app": root_app, "panel_host": f"panel.{domain}",
             "access_mode": mode, "otp": bool(idp), "warnings": warnings}
    save_state(state)
    return {**sync(requester=requester), "warnings": warnings}


def sync(requester: Requester | None = None) -> dict[str, Any]:
    """Make tunnel routes + DNS match the current apps. No-op when the tunnel isn't configured."""
    st = load_state()
    if not st.get("tunnel_id"):
        return {"configured": False}
    cf = CF(_read_secret("api_token"), requester)
    ingress = build_ingress(st["domain"], load_routes(), st["team"], st["aud"], st.get("root_app"))
    cf.put_ingress(st["account_id"], st["tunnel_id"], ingress)
    dns = cf.sync_dns(st["zone_id"], st["tunnel_id"], hosts_of(ingress), st["domain"])
    st["hosts"] = hosts_of(ingress)
    save_state(st)
    return {"configured": True, "hosts": st["hosts"], "dns": dns}


def status(requester: Requester | None = None) -> dict[str, Any]:
    st = load_state()
    if not st.get("tunnel_id"):
        return {"configured": False}
    out = {k: st.get(k) for k in ("domain", "panel_host", "hosts", "emails", "root_app", "team", "warnings")}
    out["access_mode"] = st.get("access_mode", "emails")
    out["configured"] = True
    try:
        cf = CF(_read_secret("api_token"), requester)
        out.update(cf.tunnel_status(st["account_id"], st["tunnel_id"]))
    except (CFError, OSError) as e:
        out.update(status="unknown", error=str(e)[:200])
    return out
