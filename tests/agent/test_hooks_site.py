import hashlib
import hmac
import json
import sqlite3

import pytest

from mirkomil.paas import api_apps, hooks
from mirkomil.paas.detect import detect, is_public


# ---------------------------------------------------------------- "is it a site?" from the code

def _repo(tmp_path, files):
    for name, text in files.items():
        p = tmp_path / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    return tmp_path


def test_polling_aiogram_bot_is_not_a_site(tmp_path):
    root = _repo(tmp_path, {"requirements.txt": "aiogram==3.13\n",
                            "bot.py": "from aiogram import Dispatcher\nasync def main():\n    await dp.start_polling(bot)\n"})
    d = detect(root)
    assert d.type == "bot" and d.site is False and "polling" in d.site_reason
    assert is_public(d.type, None, d.site) is False


def test_webhook_aiogram_bot_becomes_a_site(tmp_path):
    root = _repo(tmp_path, {"requirements.txt": "aiogram==3.13\naiohttp\n",
                            "main.py": "from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application\n"
                                       "from aiohttp import web\nweb.run_app(app, host='0.0.0.0', port=int(os.environ['PORT']))\n"})
    d = detect(root)
    assert d.type == "bot" and d.site is True and "webhook" in d.site_reason
    assert is_public(d.type, None, d.site) is True
    assert is_public(d.type, False, d.site) is False  # the user's choice wins


def test_node_web_and_node_bot(tmp_path):
    web = _repo(tmp_path / "web", {"package.json": json.dumps({"scripts": {"start": "node index.js"}, "dependencies": {"express": "^4"}})})
    assert detect(web).site is True
    bot = _repo(tmp_path / "bot", {"package.json": json.dumps({"scripts": {"start": "node bot.js"}, "dependencies": {"telegraf": "^4"}}),
                                   "bot.js": "bot.launch()\n"})
    d = detect(bot)
    assert d.site is False and "telegraf" in d.site_reason
    assert is_public("node", None, d.site) is False


def test_dockerfile_expose_decides(tmp_path):
    a = _repo(tmp_path / "a", {"Dockerfile": "FROM alpine\nEXPOSE 3000\nCMD [\"x\"]\n"})
    b = _repo(tmp_path / "b", {"Dockerfile": "FROM alpine\nCMD [\"worker\"]\n"})
    assert detect(a).site is True and "3000" in detect(a).site_reason
    assert detect(b).site is False


def test_web_frameworks_are_always_sites(tmp_path):
    root = _repo(tmp_path, {"requirements.txt": "fastapi\n", "main.py": "from fastapi import FastAPI\napp = FastAPI()\n"})
    d = detect(root)
    assert d.site is True and is_public(d.type, False, d.site) is True


def test_requirements_copied_before_code_for_layer_cache(tmp_path):
    root = _repo(tmp_path, {"requirements.txt": "flask\n", "app.py": "from flask import Flask\napp = Flask(__name__)\n"})
    assert detect(root).vars["DEPS"] == "requirements.txt"


# ---------------------------------------------------------------- webhooks

SECRET = "s" * 48


class _DB:
    def __init__(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(api_apps.SCHEMA)
        self.conn.execute("ALTER TABLE apps ADD COLUMN public INTEGER")
        self.conn.execute("ALTER TABLE apps ADD COLUMN hook_secret TEXT")
        self.conn.execute("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT)")
        self.conn.execute("INSERT INTO apps (name, repo, branch, hook_secret) VALUES ('shop', 'https://github.com/a/shop', 'main', ?)", (SECRET,))
        self.conn.execute("INSERT INTO apps (name, repo, branch) VALUES ('nohook', 'https://github.com/a/b', 'main')")
        self.events = []

    def get(self, k, default=None):
        r = self.conn.execute("SELECT v FROM kv WHERE k = ?", (k,)).fetchone()
        return json.loads(r[0]) if r else default

    def put(self, k, v):
        self.conn.execute("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", (k, json.dumps(v)))

    def add_event(self, *a, **k):
        self.events.append(a)


class _State:
    def __init__(self):
        self.db = _DB()
        self.cfg = type("Cfg", (), {"domain": "d.uz"})()


def _sig(body, secret=SECRET):
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def _push(ref="refs/heads/main", sha="a" * 40):
    return json.dumps({"ref": ref, "after": sha, "pusher": {"name": "ali"}, "head_commit": {"message": "Yangi sahifa\n\nbody"}}).encode()


@pytest.fixture
def env(monkeypatch):
    calls = []
    running = {"v": False}
    monkeypatch.setattr(hooks, "start_deploy_sync", lambda state, row, by: calls.append((row["name"], by)) or "20261127-101010-abcd")
    monkeypatch.setattr(hooks, "deploy_running", lambda app: running["v"])
    return _State(), calls, running


def test_push_to_branch_deploys(env):
    state, calls, _ = env
    body = _push()
    assert hooks.handle_delivery(state, "shop", "push", _sig(body), body) == (202, {"deploy_id": "20261127-101010-abcd"})
    assert calls == [("shop", "github")]
    log = state.db.get("hook_log:shop")
    assert log[0]["result"] == "deployed" and "Yangi sahifa" in log[0]["detail"]


def test_bad_signature_unknown_app_and_disabled_app_are_refused(env):
    state, calls, _ = env
    body = _push()
    assert hooks.handle_delivery(state, "shop", "push", _sig(body, "wrong"), body)[0] == 401
    assert hooks.handle_delivery(state, "shop", "push", "", body)[0] == 401
    assert hooks.handle_delivery(state, "nohook", "push", _sig(body), body)[0] == 404
    assert hooks.handle_delivery(state, "ghost", "push", _sig(body), body)[0] == 404
    assert calls == []


def test_ping_other_branch_and_non_push_are_not_deploys(env):
    state, calls, _ = env
    ping = b"{}"
    assert hooks.handle_delivery(state, "shop", "ping", _sig(ping), ping) == (200, {"ok": "pong"})
    other = _push("refs/heads/dev")
    assert hooks.handle_delivery(state, "shop", "push", _sig(other), other)[0] == 202
    issue = b'{"action":"opened"}'
    assert hooks.handle_delivery(state, "shop", "issues", _sig(issue), issue)[0] == 202
    deleted = _push(sha="0" * 40)
    assert hooks.handle_delivery(state, "shop", "push", _sig(deleted), deleted)[0] == 202
    assert calls == []


def test_form_encoded_payload_explains_json(env):
    state, calls, _ = env
    body = b"payload=%7B%7D"
    assert hooks.handle_delivery(state, "shop", "push", _sig(body), body)[0] == 400
    assert "application/json" in state.db.get("hook_log:shop")[0]["detail"]


def test_push_during_running_deploy_is_queued_then_started(env):
    state, calls, running = env
    running["v"] = True
    body = _push(sha="b" * 40)
    assert hooks.handle_delivery(state, "shop", "push", _sig(body), body) == (202, {"queued": "b" * 40})
    assert calls == [] and hooks.pending_tick(state) == []  # still running
    running["v"] = False
    assert hooks.pending_tick(state) == ["shop"]
    assert calls == [("shop", "github")] and state.db.get("hook_pending:shop") is None


def test_signature_check_is_constant_time_and_strict():
    assert hooks.signature_ok("k", b"x", "sha256=" + hmac.new(b"k", b"x", hashlib.sha256).hexdigest())
    assert not hooks.signature_ok("k", b"x", "sha1=abc")
    assert not hooks.signature_ok("", b"x", "sha256=")


def test_tunnel_routes_hooks_host():
    from mirkomil.cloudflare import build_ingress, hosts_of
    ing = build_ingress("d.uz", {}, "t.cloudflareaccess.com", "AUD", None)
    hook = next(r for r in ing if r.get("hostname") == "hooks.d.uz")
    assert hook["service"] == "http://localhost:8099" and "access" not in json.dumps(hook)
    assert hosts_of(ing) == ["panel.d.uz", "hooks.d.uz"]


def test_push_right_after_another_is_queued_not_failed(env, monkeypatch):
    """The first deploy may not have written its status yet; the helper refuses a second one."""
    state, calls, _ = env

    def busy(*_a, **_k):
        raise hooks.helper.VerbError("bu ilova uchun deploy allaqachon davom etmoqda")

    monkeypatch.setattr(hooks, "start_deploy_sync", busy)
    body = _push(sha="e" * 40)
    assert hooks.handle_delivery(state, "shop", "push", _sig(body), body) == (202, {"queued": "e" * 40})
    assert hooks.pending_tick(state) == []  # still busy: stays queued
    assert state.db.get("hook_pending:shop")["sha"] == "e" * 40
    monkeypatch.setattr(hooks, "start_deploy_sync", lambda state, row, by: calls.append(row["name"]) or "x")
    assert hooks.pending_tick(state) == ["shop"] and state.db.get("hook_pending:shop") is None


# ---------------------------------------------------------------- subfolders, Procfile, start.sh, Python version

def test_project_in_a_subfolder_is_found(tmp_path):
    from mirkomil.paas.detect import find_root
    _repo(tmp_path, {"README.md": "hi", "bot/requirements.txt": "aiogram==3.*\n", "bot/main.py": "dp.start_polling(bot)\n"})
    assert find_root(tmp_path) == ("bot", "loyiha «bot/» papkasida topildi")
    root_ok = _repo(tmp_path / "flat", {"requirements.txt": "flask\n", "app.py": "app = Flask(__name__)\n"})
    assert find_root(root_ok) == ("", "")


def test_two_candidate_subfolders_are_not_guessed(tmp_path):
    from mirkomil.paas.detect import find_root
    _repo(tmp_path, {"a/requirements.txt": "flask\n", "b/package.json": "{}"})
    assert find_root(tmp_path) == ("", "")


def test_procfile_worker_and_web(tmp_path):
    worker = _repo(tmp_path / "w", {"requirements.txt": "aiogram\n", "Procfile": "worker: python main.py\nrelease: x\n", "main.py": ""})
    d = detect(worker)
    assert d.commands == {"worker": "python main.py"} and d.site is False and "worker" in d.site_reason
    both = _repo(tmp_path / "b", {"requirements.txt": "aiogram\nfastapi\n", "Procfile": "worker: bash start.sh\nweb: python -m app.web_main\n",
                                  "start.sh": "python -m app.bot_main\n", "runtime.txt": "python-3.11.7\n"})
    d = detect(both)  # no bot.py/main.py at the root: the Procfile is enough
    assert d.type == "bot" and d.site is True and d.vars["PY"] == "3.11"
    assert d.commands == {"worker": "bash start.sh", "web": "python -m app.web_main"}


def test_start_sh_when_no_procfile(tmp_path):
    root = _repo(tmp_path, {"requirements.txt": "aiogram\n", "start.sh": "python -m app.bot_main\n"})
    assert detect(root).commands == {"worker": "bash start.sh"}


def test_with_commands_runs_web_first_and_all_processes():
    from mirkomil.paas.engine import with_commands
    df = "FROM x\nCMD [\"python\", \"main.py\"]\n"
    one = with_commands(df, {"worker": "python main.py"}, "bash")
    assert one.endswith('CMD ["bash", "-c", "exec python main.py"]\n') and one.count("CMD") == 1
    both = with_commands(df, {"worker": "bash start.sh", "web": "python -m app.web_main"}, "bash")
    assert 'python -m app.web_main & bash start.sh & wait -n; exit 1' in both


def test_python_version_and_root_dir_validation(tmp_path):
    from mirkomil.paas.detect import python_version, valid_root_dir
    assert python_version(_repo(tmp_path / "a", {".python-version": "3.12.4\n"})) == "3.12"
    assert python_version(_repo(tmp_path / "b", {"runtime.txt": "python-2.7\n"})) == "3.13"
    for ok in ("", "bot", "apps/web", "my_app.v2"):
        assert valid_root_dir(ok), ok
    for bad in ("../etc", "a/../../b", "/abs", "a b", "a;rm", "a/./b/../c/../../.."):
        assert not valid_root_dir(bad), bad
