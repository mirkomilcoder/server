import json
import os
import stat

import pytest

from mirkomil import cloudflare as cfm
from mirkomil.cloudflare import CF, CFError, build_ingress, hosts_of

TOKEN = "t" * 40


class FakeAPI:
    """Tiny in-memory Cloudflare: enough to drive setup/sync end to end."""

    def __init__(self, zone_found=True, access=True):
        self.calls: list[tuple[str, str]] = []
        self.zone_found, self.access = zone_found, access
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
            return {"status": "active"}
        if path.startswith("/zones?name="):
            return [{"id": "Z", "account": {"id": "A"}}] if self.zone_found else []
        if path == "/accounts/A/access/organizations":
            return {"auth_domain": "myteam.cloudflareaccess.com"} if self.access else {}
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
            return {**body, "id": "APP", "aud": "AUD123"}
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
    assert all(r["service"] == "http://localhost:8088" for r in ing[2:-1])
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
