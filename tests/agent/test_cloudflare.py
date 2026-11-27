import json
import os
import stat

import pytest

from mirkomil import cloudflare as cfm
from mirkomil.cloudflare import CF, CFError, build_ingress, hosts_of

TOKEN = "t" * 40


class FakeAPI:
    """Tiny in-memory Cloudflare: enough to drive setup/sync end to end."""

    def __init__(self, zone_found=True, access=True, account_token=False, idp_edit=True):
        self.calls: list[tuple[str, str]] = []
        self.zone_found, self.access = zone_found, access
        # new "cfat_…" Account API tokens: valid only on /accounts/<id>/tokens/verify
        self.account_token = account_token
        self.idp_edit = idp_edit  # token has "Access: Organizations, Identity Providers, and Groups → Edit"
        self.idps: list[dict] = []
        self.login_design = None
        self.tunnels: list[dict] = []
        self.dns: dict[str, dict] = {}
        self.apps: list[dict] = []
        self.policies: dict[str, list[dict]] = {}
        self.ingress = None
        self.n = 0

    def _id(self):
        self.n += 1
        return f"id{self.n}"

    def __call__(self, method, path, body):
        self.calls.append((method, path))
        if path == "/user/tokens/verify":
            if self.account_token:
                raise CFError("Cloudflare: 1000: Invalid API Token")
            return {"status": "active"}
        if path == "/accounts/A/tokens/verify":
            if not self.account_token:
                raise CFError("Cloudflare: 1000: Invalid API Token")
            return {"status": "active"}
        if path.startswith("/zones?name="):
            return [{"id": "Z", "account": {"id": "A"}}] if self.zone_found else []
        if path == "/accounts/A/access/organizations" and method == "PUT":
            if not self.idp_edit:
                raise CFError("Cloudflare: 10000: Authentication error")
            self.login_design = body["login_design"]
            return body
        if path == "/accounts/A/access/organizations":
            return {"auth_domain": "myteam.cloudflareaccess.com"} if self.access else {}
        if path.startswith("/accounts/A/access/identity_providers/"):
            iid = path.rsplit("/", 1)[1]
            if method == "DELETE":
                self.idps = [i for i in self.idps if i["id"] != iid]
                return {}
            self.idps = [({**body, "id": iid} if i["id"] == iid else i) for i in self.idps]
            return {**body, "id": iid}
        if path == "/accounts/A/access/identity_providers":
            if method == "GET":
                return self.idps
            if not self.idp_edit:
                raise CFError("Cloudflare: 10000: Authentication error")
            self.idps.append({**body, "id": {"onetimepin": "OTP"}.get(body["type"], body["type"].upper())})
            return self.idps[-1]
        if path.startswith("/accounts/A/cfd_tunnel?name="):
            return self.tunnels
        if path == "/accounts/A/cfd_tunnel" and method == "POST":
            t = {"id": "TUN", "name": body["name"]}
            self.tunnels.append(t)
            return t
        if path == "/accounts/A/cfd_tunnel/TUN/token":
            return "tunnel-secret-token"
        if path == "/accounts/A/cfd_tunnel/TUN/configurations":
            self.ingress = body["config"]["ingress"]
            return {}
        if path == "/accounts/A/cfd_tunnel/TUN":
            return {"status": "healthy", "connections": [{}, {}]}
        if path.startswith("/zones/Z/dns_records") and method == "GET":
            return list(self.dns.values())
        if path == "/zones/Z/dns_records" and method == "POST":
            self.dns[body["name"]] = {**body, "id": self._id()}
            return {}
        if path.startswith("/zones/Z/dns_records/"):
            rid = path.rsplit("/", 1)[1]
            name = next(n for n, r in self.dns.items() if r["id"] == rid)
            if method == "DELETE":
                del self.dns[name]
            else:
                self.dns[name] = {**body, "id": rid}
            return {}
        if path == "/accounts/A/access/apps" and method == "GET":
            return self.apps
        if path == "/accounts/A/access/apps" and method == "POST":
            a = {**body, "id": "APP", "aud": "AUD123"}
            self.apps.append(a)
            return a
        if path.startswith("/accounts/A/access/apps/APP/policies"):
            if method == "GET":
                return self.policies.get("APP", [])
            if method == "POST":
                self.policies.setdefault("APP", []).append({**body, "id": "P1"})
            else:
                self.policies["APP"] = [{**body, "id": "P1"}]
            return {}
        if path == "/accounts/A/access/apps/APP" and method == "PUT":
            self.apps[0] = {**body, "id": "APP", "aud": "AUD123"}
            return self.apps[0]
        raise AssertionError(f"unexpected {method} {path}")


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(cfm, "TUNNEL_DIR", tmp_path / "tunnel")
    monkeypatch.setattr(cfm, "ROUTES", tmp_path / "routes.json")
    (tmp_path / "routes.json").write_text(json.dumps({
        "shop": {"hosts": ["shop.example.uz"], "upstream": "mk-app-shop-1:8000"},
        "site": {"hosts": ["site.example.uz", "www.customer.com"], "upstream": "mk-app-site-1:8000"},
    }))
    return tmp_path


def test_token_format_checked_before_any_call():
    with pytest.raises(CFError):
        CF("bad token; rm -rf", requester=lambda *a: None)


def test_ingress_panel_first_with_access_and_404_last():
    routes = {"shop": {"hosts": ["shop.d.uz"], "upstream": "x:8000"}}
    ing = build_ingress("d.uz", routes, "myteam.cloudflareaccess.com", "AUD", "shop")
    assert ing[0]["hostname"] == "panel.d.uz"
    acc = ing[0]["originRequest"]["access"]
    assert acc == {"required": True, "teamName": "myteam", "audTag": ["AUD"]}
    assert ing[-1] == {"service": "http_status:404"}
    root = next(r for r in ing if r.get("hostname") == "d.uz")
    assert root["originRequest"]["httpHostHeader"] == "shop.d.uz"
    assert all(r["service"] == "http://localhost:8088" for r in ing[3:-1])
    assert hosts_of(ing) == ["panel.d.uz", "hooks.d.uz", "shop.d.uz", "d.uz"]


def test_root_app_ignored_when_unknown():
    ing = build_ingress("d.uz", {}, "t.cloudflareaccess.com", "AUD", "missing")
    assert hosts_of(ing) == ["panel.d.uz", "hooks.d.uz"]


def test_setup_end_to_end_and_secrets_private(env):
    api = FakeAPI()
    out = cfm.setup(TOKEN, "example.uz", ["Admin@Example.com"], root_app="site", requester=api)
    assert out["configured"]
    assert set(api.dns) == {"panel.example.uz", "hooks.example.uz", "shop.example.uz", "site.example.uz", "example.uz"}
    assert "www.customer.com" not in api.dns  # outside the zone: never touched
    assert all(r["proxied"] and r["content"] == "TUN.cfargotunnel.com" and r["comment"] == "mirkomil" for r in api.dns.values())
    assert api.apps[0]["session_duration"] == "168h"
    assert api.policies["APP"][0]["include"] == [{"email": {"email": "admin@example.com"}}]
    priv = env / "tunnel" / "private"
    assert stat.S_IMODE(os.stat(priv).st_mode) == 0o700
    assert (priv / "tunnel.env").read_text() == "TUNNEL_TOKEN=tunnel-secret-token\n"
    assert stat.S_IMODE(os.stat(priv / "api_token").st_mode) == 0o600
    state = (env / "tunnel" / "state.json").read_text()
    assert TOKEN not in state and "tunnel-secret-token" not in state


def test_setup_is_idempotent(env):
    api = FakeAPI()
    cfm.setup(TOKEN, "example.uz", ["a@b.uz"], requester=api)
    cfm.setup(TOKEN, "example.uz", ["a@b.uz"], requester=api)
    assert len(api.tunnels) == 1 and len(api.apps) == 1 and len(api.policies["APP"]) == 1


def test_sync_removes_only_own_records_and_never_overwrites_foreign(env):
    api = FakeAPI()
    api.dns["shop.example.uz"] = {"id": "foreign", "name": "shop.example.uz", "content": "1.2.3.4", "comment": ""}
    cfm.setup(TOKEN, "example.uz", ["a@b.uz"], requester=api)
    assert api.dns["shop.example.uz"]["content"] == "1.2.3.4"  # someone else's
    (env / "routes.json").write_text(json.dumps({}))
    out = cfm.sync(requester=api)
    assert "site.example.uz" in out["dns"]["removed"]
    assert "shop.example.uz" in api.dns  # foreign record stays
    assert set(api.dns) == {"panel.example.uz", "hooks.example.uz", "shop.example.uz"}


def test_setup_errors_are_clear(env):
    with pytest.raises(CFError, match="topilmadi"):
        cfm.setup(TOKEN, "example.uz", ["a@b.uz"], requester=FakeAPI(zone_found=False))
    with pytest.raises(CFError, match="Zero Trust"):
        cfm.setup(TOKEN, "example.uz", ["a@b.uz"], requester=FakeAPI(access=False))
    with pytest.raises(CFError, match="email"):
        cfm.setup(TOKEN, "example.uz", ["not-an-email"], requester=FakeAPI())
    assert not (env / "tunnel" / "private" / "api_token").exists()


def test_sync_noop_when_not_configured(env):
    assert cfm.sync(requester=FakeAPI()) == {"configured": False}
    assert cfm.status(requester=FakeAPI()) == {"configured": False}


def test_status_reports_connections(env):
    api = FakeAPI()
    cfm.setup(TOKEN, "example.uz", ["a@b.uz"], requester=api)
    st = cfm.status(requester=api)
    assert st["status"] == "healthy" and st["connections"] == 2 and st["panel_host"] == "panel.example.uz"


def test_account_api_tokens_cfat_work(env):
    """Cloudflare's new account-owned tokens are verified under /accounts/<id>, not /user."""
    api = FakeAPI(account_token=True)
    out = cfm.setup("cfat_" + "x" * 48, "example.uz", ["a@b.uz"], requester=api)
    assert out["configured"] and ("GET", "/accounts/A/tokens/verify") in api.calls



@pytest.mark.parametrize("err,expect", [
    ("Cloudflare: 9109: Invalid access token", "qabul qilmadi"),
    ("Cloudflare: 1000: Invalid API Token", "qabul qilmadi"),
    ("Cloudflare: 9109: Unauthorized to access requested resource", "Zone Read"),
    ("Cloudflare: 10000: Authentication error", "Zone Read"),
])
def test_token_errors_are_explained(err, expect):
    def req(_m, _p, _b):
        raise CFError(err)
    with pytest.raises(CFError, match=expect.replace(" ", ".*")):
        CF(TOKEN, req).zone("example.uz")


def test_everyone_mode_uses_email_code_login_and_brands_the_page(env):
    api = FakeAPI()
    out = cfm.setup(TOKEN, "example.uz", [], mode="everyone", brand="ITC HOSTING", requester=api)
    assert out["warnings"] == []
    assert api.idps == [{"name": "Email kod (One-time PIN)", "type": "onetimepin", "config": {}, "id": "OTP"}]
    app = api.apps[0]
    assert app["allowed_idps"] == ["OTP"] and app["auto_redirect_to_identity"] is True
    assert api.policies["APP"][0]["include"] == [{"everyone": {}}]
    assert api.login_design["header_text"] == "ITC HOSTING"
    assert api.login_design["logo_path"] == "https://hooks.example.uz/brand/logo.svg"
    # a second run reuses the existing one-time PIN provider
    cfm.setup(TOKEN, "example.uz", [], mode="everyone", requester=api)
    assert len(api.idps) == 1
    assert cfm.status(requester=api)["access_mode"] == "everyone"


def test_read_only_access_permission_still_works_with_clear_warnings(env):
    api = FakeAPI(idp_edit=False)
    out = cfm.setup(TOKEN, "example.uz", ["a@b.uz"], requester=api)
    assert out["configured"] and len(out["warnings"]) == 2 and "Edit" in out["warnings"][0]
    assert "allowed_idps" not in api.apps[0]


def test_email_mode_needs_emails_and_rejects_unknown_mode(env):
    with pytest.raises(CFError, match="email"):
        cfm.setup(TOKEN, "example.uz", [], mode="emails", requester=FakeAPI())
    with pytest.raises(CFError, match="rejim"):
        cfm.setup(TOKEN, "example.uz", [], mode="public", requester=FakeAPI())


def test_google_and_github_login_are_offered_with_email_code(env):
    api = FakeAPI()
    cfm.setup(TOKEN, "example.uz", ["boss@gmail.com"], requester=api)
    out = cfm.set_login_provider("google", "123-abc.apps.googleusercontent.com", "GOCSPX-secret-value", requester=api)
    assert out["providers"] == ["google", "onetimepin"]
    assert out["callback"] == "https://myteam.cloudflareaccess.com/cdn-cgi/access/callback"
    google = next(i for i in api.idps if i["type"] == "google")
    assert google["config"] == {"client_id": "123-abc.apps.googleusercontent.com", "client_secret": "GOCSPX-secret-value"}
    app = api.apps[0]
    assert app["allowed_idps"] == ["GOOGLE", "OTP"] and app["auto_redirect_to_identity"] is False  # two choices
    secret_on_disk = "".join(p.read_text() for p in (env / "tunnel").rglob("*") if p.is_file())
    assert "GOCSPX-secret-value" not in secret_on_disk  # the secret lives in Cloudflare only
    cfm.set_login_provider("google", "", "", enabled=False, requester=api)
    assert [i["type"] for i in api.idps] == ["onetimepin"]


def test_bad_oauth_credentials_are_refused_before_calling_cloudflare(env):
    api = FakeAPI()
    cfm.setup(TOKEN, "example.uz", ["boss@gmail.com"], requester=api)
    with pytest.raises(CFError, match="Client"):
        cfm.set_login_provider("github", "x", "short", requester=api)

