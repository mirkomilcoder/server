import asyncio
import json

import pytest

from mirkomil import users
from mirkomil.users import UserError

@pytest.fixture
def fake(tmp_path, monkeypatch):
    calls = []

    def run(argv, stdin=None, timeout=60):
        calls.append((argv, stdin))
        return ""

    monkeypatch.setattr(users, "RUN", run)
    return calls


def test_create_uses_fixed_argv_and_forces_password_change(fake):
    res = users.create("ali", "developer", "Ali Valiyev")
    argv = [c[0] for c in fake]
    assert argv[0] == ["useradd", "--create-home", "--shell", "/bin/bash", "--comment", "Ali Valiyev",
                       "--groups", "mirkomil-dev", "--", "ali"]
    assert argv[1] == ["chpasswd"] and fake[1][1] == f"ali:{res['password']}\n"
    assert argv[2] == ["chage", "-d", "0", "--", "ali"]
    assert "sudo" not in json.dumps(argv)
    assert len(res["password"]) == 19 and res["password"].count("-") == 3


@pytest.mark.parametrize("name", ["root", "Ali", "-x", "a", "ali;id", "mirkomil", "x" * 40])
def test_create_rejects_bad_or_reserved_names(fake, name):
    with pytest.raises(UserError):
        users.create(name, "viewer")
    assert fake == []


def test_create_rejects_unknown_role_and_gecos_injection(fake):
    with pytest.raises(UserError):
        users.create("ali", "root")
    with pytest.raises(UserError):
        users.create("ali", "viewer", "Ali:0:0")
    assert fake == []


def test_owner_and_unmanaged_accounts_are_protected(fake, monkeypatch):
    monkeypatch.setattr(users, "list_users", lambda: [
        {"user": "boss", "owner": True, "managed": False, "role": "admin"},
        {"user": "guest", "owner": False, "managed": False, "role": "none"},
    ])
    for fn in (lambda: users.delete("boss"), lambda: users.set_locked("boss", True), lambda: users.reset_password("boss"),
               lambda: users.set_role("boss", "viewer"), lambda: users.delete("guest")):
        with pytest.raises(UserError):
            fn()
    assert fake == []


def test_lock_terminates_sessions(fake, monkeypatch):
    monkeypatch.setattr(users, "list_users", lambda: [{"user": "ali", "owner": False, "managed": True, "role": "viewer"}])
    users.set_locked("ali", True)
    assert fake[0][0] == ["usermod", "--lock", "--expiredate", "1", "--", "ali"]
    assert fake[1][0] == ["loginctl", "terminate-user", "--", "ali"]


def test_only_harmless_extra_groups_can_be_granted(fake, monkeypatch):
    monkeypatch.setattr(users, "list_users", lambda: [{"user": "ali", "owner": False, "managed": True, "role": "viewer"}])
    for g in ("sudo", "docker", "lxd", "disk", "shadow", "root"):
        with pytest.raises(UserError):
            users.set_groups("ali", [g])
    assert fake == []


# ---------------------------------------------------------------- API: per-app access

def _state():
    import sqlite3

    class DB:
        conn = sqlite3.connect(":memory:", check_same_thread=False)
        conn.row_factory = sqlite3.Row

        @staticmethod
        def add_event(*_a, **_k):
            pass

    class State:
        db = DB()
        cfg = type("Cfg", (), {"domain": "d.uz", "brand": "B"})()

        def snapshot(self):
            return {"ip": "10.0.0.2"}

    return State()


def _get(api, peer, path):
    async def go():
        reader = asyncio.StreamReader()
        reader.feed_data(f"GET {path} HTTP/1.1\r\n\r\n".encode())
        reader.feed_eof()
        return await api._dispatch(peer, reader)
    return asyncio.run(go())


def test_developers_and_viewers_only_see_their_apps(monkeypatch):
    from mirkomil import api as api_mod, helper
    from mirkomil.auth import Peer
    monkeypatch.setattr(helper, "call", lambda verb, args, timeout=0: {} if verb == "app.stats" else [])
    st = _state()
    api = api_mod.build_api(st)
    c = st.db.conn
    for name, by in (("shop", "ali"), ("blog", "vali"), ("crm", "boss")):
        c.execute("INSERT INTO apps (name, repo, branch, created_by) VALUES (?, 'https://github.com/a/b', 'main', ?)", (name, by))
    c.execute("INSERT INTO app_members (app, user) VALUES ('crm', 'ali')")
    ali = Peer(1001, "ali", ("mirkomil-dev",), "developer")
    viewer = Peer(1002, "zara", ("mirkomil-viewer",), "viewer")
    admin = Peer(1000, "boss", ("mirkomil-admin",), "admin")
    names = lambda peer: [a["name"] for a in _get(api, peer, "/v1/apps")[1]["apps"]]  # noqa: E731
    assert names(ali) == ["crm", "shop"]
    assert names(viewer) == []
    assert names(admin) == ["blog", "crm", "shop"]
    with pytest.raises(api_mod.HttpError) as e:
        _get(api, ali, "/v1/apps/blog/logs")
    assert e.value.status == 404


def test_user_admin_endpoints_need_admin(monkeypatch):
    from mirkomil import api as api_mod, helper
    from mirkomil.auth import Peer
    monkeypatch.setattr(helper, "call", lambda *a, **k: [])
    api = api_mod.build_api(_state())
    with pytest.raises(api_mod.HttpError) as e:
        _get(api, Peer(1001, "ali", ("mirkomil-dev",), "developer"), "/v1/users")
    assert e.value.status == 403


def test_access_list_is_owner_plus_panel_users(monkeypatch):
    """Only panel users (and the owner's own emails) may pass Cloudflare Access."""
    import json as _json
    from mirkomil import api as api_mod, helper
    from mirkomil.api_users import OWNER_KEY, allowed_emails
    from mirkomil.auth import Peer
    st = _state()
    kv = {}
    st.db.get = lambda k, d=None: kv.get(k, d)
    st.db.put = lambda k, v: kv.__setitem__(k, v)
    setups = []

    def call(verb, args, timeout=0):
        if verb == "tunnel.status":
            current = setups[-1]["emails"] if setups else ["boss@x.uz"]
            return {"configured": True, "emails": current, "access_mode": "emails", "root_app": None}
        if verb == "tunnel.setup":
            setups.append(args)
            return {"configured": True}
        if verb == "user.create":
            return {"user": args["user"], "role": args["role"], "password": "p"}
        if verb == "user.delete":
            return "deleted"
        return []

    monkeypatch.setattr(helper, "call", call)
    api = api_mod.build_api(st)
    admin = Peer(1000, "boss", ("sudo",), "admin")

    def post(path, body):
        raw = _json.dumps(body).encode()

        async def go():
            reader = asyncio.StreamReader()
            reader.feed_data(f"POST {path} HTTP/1.1\r\nContent-Length: {len(raw)}\r\n\r\n".encode() + raw)
            reader.feed_eof()
            return await api._dispatch(admin, reader)
        return asyncio.run(go())

    post("/v1/users", {"user": "ali", "role": "developer", "email": "Ali@Gmail.com"})
    assert kv[OWNER_KEY] == ["boss@x.uz"]  # what was there before becomes the owner's list
    assert setups[-1]["emails"] == ["ali@gmail.com", "boss@x.uz"] and setups[-1]["access_mode"] == "emails"
    post("/v1/users/ali/delete", {"confirm": "ali"})
    assert setups[-1]["emails"] == ["boss@x.uz"]
    assert allowed_emails(st.db) == ["boss@x.uz"]
