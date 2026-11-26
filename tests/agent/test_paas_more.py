import json
import sqlite3

import pytest

from mirkomil.paas import api_apps
from mirkomil.paas.engine import REPO_RE, SSH_HOST_RE, DeployError, git_env
from mirkomil.paas.dbs import DB_RE, KINDS


def test_private_repo_urls_accepted_only_for_known_hosts():
    assert REPO_RE.match("git@github.com:acme/private-shop.git")
    assert REPO_RE.match("https://github.com/acme/shop")
    for bad in ["git@evil.com:acme/x.git", "ssh://git@github.com/acme/x", "git@github.com:acme/x; id",
                "git@github.com:-oProxyCommand=x/y", "ext::sh -c id", "file:///etc/passwd"]:
        assert not REPO_RE.match(bad), bad


def test_option_injection_in_owner_is_blocked():
    # an owner starting with "-" is allowed by the char class, but git receives it after "--"
    # and ssh never sees it as an option because the host is fixed by the regex
    m = SSH_HOST_RE.match("git@github.com:-x/y")
    assert m and m.group(1) == "github.com"


def test_private_repo_without_key_gives_clear_error(tmp_path, monkeypatch):
    from mirkomil.paas import engine
    monkeypatch.setattr(engine, "APPS", tmp_path)
    with pytest.raises(DeployError, match="deploy kalit"):
        git_env("shop", "git@github.com:acme/shop.git")


def test_public_repo_env_has_no_ssh_command(tmp_path, monkeypatch):
    from mirkomil.paas import engine
    monkeypatch.setattr(engine, "APPS", tmp_path)
    env = git_env("shop", "https://github.com/acme/shop")
    assert env["GIT_TERMINAL_PROMPT"] == "0" and "GIT_SSH_COMMAND" not in env


def test_db_names_and_kinds():
    assert DB_RE.match("shop-db") and not DB_RE.match("Shop") and not DB_RE.match("a")
    assert set(KINDS) == {"postgres", "redis"}
    assert all(":" in k["image"] and "latest" not in k["image"] for k in KINDS.values())


class _State:
    def __init__(self, conn):
        self.db = type("D", (), {"conn": conn, "add_event": lambda *a, **k: None})()
        self.cfg = type("C", (), {"domain": "mirkomil-host.uz"})()


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript(api_apps.SCHEMA)
    c.execute("ALTER TABLE apps ADD COLUMN autodeploy INTEGER NOT NULL DEFAULT 0")
    c.execute("INSERT INTO apps (name, repo, branch, type, port, mem_mb, cpus, autodeploy) VALUES "
              "('shop', 'https://github.com/acme/shop', 'main', NULL, 0, 256, 1, 1)")
    return c


def _status(tmp_path, did, state, sha):
    d = tmp_path / "shop" / "deploys" / did
    d.mkdir(parents=True)
    (d / "status.json").write_text(json.dumps({"id": did, "state": state, "commit_sha": sha}))


def test_autodeploy_starts_only_for_new_commits(tmp_path, monkeypatch):
    monkeypatch.setattr(api_apps, "APPS", tmp_path)
    calls = []

    def fake_call(verb, args, timeout=0):
        calls.append(verb)
        return {"sha": "b" * 40} if verb == "app.remote_head" else {"deploy_id": "20261126-120000-ffff"}

    monkeypatch.setattr(api_apps.helper, "call", fake_call)
    state = _State(_db())

    _status(tmp_path, "20261126-110000-aaaa", "success", "a" * 40)
    assert api_apps.autodeploy_tick(state) == ["shop"]  # new commit → deploy
    assert calls == ["app.remote_head", "app.deploy"]

    calls.clear()
    _status(tmp_path, "20261126-115000-bbbb", "success", "b" * 40)
    assert api_apps.autodeploy_tick(state) == []  # already deployed
    assert calls == ["app.remote_head"]


def test_autodeploy_does_not_retry_a_failed_commit(tmp_path, monkeypatch):
    monkeypatch.setattr(api_apps, "APPS", tmp_path)
    monkeypatch.setattr(api_apps.helper, "call", lambda verb, args, timeout=0: {"sha": "c" * 40})
    state = _State(_db())
    _status(tmp_path, "20261126-110000-aaaa", "success", "a" * 40)
    _status(tmp_path, "20261126-120000-cccc", "failed", "c" * 40)
    assert api_apps.autodeploy_tick(state) == []


def test_autodeploy_skips_while_a_deploy_is_running(tmp_path, monkeypatch):
    monkeypatch.setattr(api_apps, "APPS", tmp_path)
    monkeypatch.setattr(api_apps.helper, "call", lambda *a, **k: pytest.fail("must not call the helper"))
    state = _State(_db())
    _status(tmp_path, "20261126-120000-dddd", "running", "")
    assert api_apps.autodeploy_tick(state) == []


def test_connection_urls(tmp_path, monkeypatch):
    from mirkomil.paas import dbs
    monkeypatch.setattr(dbs, "DBS", tmp_path)
    for name, kind in (("shop-db", "postgres"), ("cache", "redis")):
        d = tmp_path / name / "private"
        d.mkdir(parents=True)
        (d / "secret.json").write_text(json.dumps({"user": "app", "db": name.replace("-", "_"), "password": "s3cr-et_X"}))
        (tmp_path / name / "meta.json").write_text(json.dumps({"kind": kind}))
    assert dbs.url("shop-db") == "postgresql://app:s3cr-et_X@mk-db-shop-db:5432/shop_db"
    # explicit default user (empty user makes redis-cli 7 fail with WRONGPASS)
    assert dbs.url("cache") == "redis://default:s3cr-et_X@mk-db-cache:6379/0"
