"""mirkomil-helper — the ONLY component that runs as root.

Listens on /run/mirkomil/helper.sock (root:mirkomil 0660) and accepts one JSON
request per connection from the "mirkomil" user (Guardian) or root:

    {"verb": "ufw.status", "args": {}}  →  {"ok": true, "out": "..."}

Each verb maps to a FIXED argv built from validated arguments. There is no
generic "run command" verb and never a shell.
"""

from __future__ import annotations

import json
import logging
import os
import pwd
import re
import socket
import socketserver
import subprocess
from pathlib import Path
from typing import Any, Callable

from .auth import peer_uid

log = logging.getLogger("mirkomil.helper")

SOCKET = Path(os.environ.get("MK_HELPER_SOCKET", "/run/mirkomil/helper.sock"))
UNIT_RE = re.compile(r"^[a-zA-Z0-9@._-]{1,200}\.service$")
JAIL_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
DEV_RE = re.compile(r"^/dev/(sd[a-z]|nvme\d+n\d+|vd[a-z])$")

# Units Guardian may restart automatically (extended per app in M5).
RESTARTABLE_SYSTEM_UNITS = {"tailscaled.service", "cloudflared.service", "docker.service",
                            "fail2ban.service", "systemd-resolved.service", "ssh.service"}


class VerbError(Exception):
    pass


def _run(argv: list[str], timeout: int = 60) -> str:
    p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False)
    if p.returncode != 0:
        raise VerbError((p.stderr or p.stdout or f"exit {p.returncode}").strip()[:2000])
    return p.stdout


def _unit(args: dict[str, Any]) -> str:
    u = str(args.get("unit", ""))
    if not UNIT_RE.match(u):
        raise VerbError("invalid unit name")
    return u


def v_ufw_status(_a: dict[str, Any]) -> Any:
    return _run(["ufw", "status", "verbose"])


def v_fail2ban_status(a: dict[str, Any]) -> Any:
    jail = a.get("jail")
    if jail is None:
        return _run(["fail2ban-client", "status"])
    if not JAIL_RE.match(str(jail)):
        raise VerbError("invalid jail")
    return _run(["fail2ban-client", "status", "--", str(jail)])


def v_docker_ps(_a: dict[str, Any]) -> Any:
    out = _run(["docker", "ps", "--all", "--no-trunc", "--format", "{{json .}}"])
    return [json.loads(l) for l in out.splitlines() if l.strip()]


def v_smart_health(a: dict[str, Any]) -> Any:
    dev = str(a.get("device", ""))
    if not DEV_RE.match(dev):
        raise VerbError("invalid device")
    p = subprocess.run(["smartctl", "--json", "-H", "-A", "--", dev], capture_output=True, text=True, timeout=60)
    try:
        return json.loads(p.stdout)
    except ValueError:
        raise VerbError("smartctl gave no JSON")


def v_unit_restart(a: dict[str, Any]) -> Any:
    u = _unit(a)
    if u not in RESTARTABLE_SYSTEM_UNITS and not u.startswith("mirkomil-"):
        raise VerbError("unit is not restartable by Guardian")
    _run(["systemctl", "restart", "--", u])
    return "restarted"


SIZE_RE = re.compile(r"^[1-9][0-9]{0,4}[MG]$")


def v_apt_clean(_a: dict[str, Any]) -> Any:
    _run(["apt-get", "clean"])
    return "apt cache cleaned"


def v_journal_vacuum(a: dict[str, Any]) -> Any:
    size = str(a.get("size", "500M"))
    if not SIZE_RE.match(size):
        raise VerbError("invalid size")
    return _run(["journalctl", f"--vacuum-size={size}"]).strip()[-300:] or "journal vacuumed"


def v_docker_prune(_a: dict[str, Any]) -> Any:
    # Dangling images + build cache only. NEVER volumes, never running containers' images.
    if not Path("/usr/bin/docker").exists():
        return "docker not installed"
    out = _run(["docker", "image", "prune", "--force"], timeout=300)
    out += _run(["docker", "builder", "prune", "--force"], timeout=300)
    return out.strip()[-300:]


def v_network_restart(_a: dict[str, Any]) -> Any:
    for unit in ("systemd-networkd.service", "NetworkManager.service"):
        state = subprocess.run(["systemctl", "is-active", unit], capture_output=True, text=True).stdout.strip()
        if state == "active":
            _run(["systemctl", "restart", "--", unit])
            return f"restarted {unit}"
    raise VerbError("no known network service is active")


def v_system_reboot(a: dict[str, Any]) -> Any:
    reason = re.sub(r"[^\w .,:+-]", "", str(a.get("reason", "guardian")))[:120]
    subprocess.run(["logger", "-t", "mirkomil-panel", "--", f"guardian system.reboot {reason}"], check=False)
    # +1 minute: gives Guardian time to send the Telegram alert first
    _run(["shutdown", "--reboot", "+1", f"Mirkomil Guardian: {reason}"])
    return "reboot scheduled in 1 minute"


INSTALLER = "/opt/mirkomil/src/installer/main.sh"


def run_installer_job(name: str, only: str, env: dict[str, str], timeout: int = 300) -> str:
    """
    Run the installer (fixed path, fixed arguments) as a one-off systemd unit.

    The helper itself is sandboxed (ProtectSystem=full: /etc and /usr are
    read-only), so it cannot rewrite configuration directly. Instead systemd
    starts the installer — the single place that writes managed files — with
    validated values passed as environment variables (env wins over
    config.env in the installer, and save_config() persists them).
    """
    argv = ["systemd-run", f"--unit=mirkomil-job-{name}", "--wait", "--pipe", "--collect", "--quiet",
            "--setenv=MK_NONINTERACTIVE=1", "--setenv=MK_PREFLIGHT_QUICK=1", "--setenv=MK_DEFER_COCKPIT_RESTART=1"]
    argv += [f"--setenv={k}={v}" for k, v in env.items()]
    argv += [INSTALLER, "--repair", "--only", only]
    p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False)
    if p.returncode != 0:
        raise VerbError((p.stderr or p.stdout).strip()[-800:] or f"installer exit {p.returncode}")
    return "applied"


def v_identity_apply(a: dict[str, Any]) -> Any:
    from .config import valid_brand, valid_domain
    brand, domain = str(a.get("brand", "")), str(a.get("domain", ""))
    if not valid_brand(brand) or not valid_domain(domain):
        raise VerbError("invalid brand or domain")
    # 50: cockpit.conf (LoginTitle) · 60: login page branding
    return run_installer_job("identity", "50,60", {"MK_BRAND_NAME": brand, "MK_DOMAIN": domain})


# ---------------------------------------------------------------- PaaS apps

CONTAINER_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$")


def _app(a: dict[str, Any]) -> str:
    from .paas.engine import APP_RE
    app = str(a.get("app", ""))
    if not APP_RE.match(app):
        raise VerbError("invalid app name")
    return app


def _current(app: str) -> dict[str, Any]:
    from .paas.engine import app_dir
    try:
        return json.loads((app_dir(app) / "current.json").read_text())
    except (OSError, ValueError):
        raise VerbError("app is not deployed yet")


def v_app_deploy(a: dict[str, Any]) -> Any:
    """Validate, write the spec, start the deploy as its own low-priority systemd job."""
    from .paas import engine
    a = dict(a, deploy_id=engine.new_deploy_id())
    try:
        spec = engine.validate_spec(a)
    except engine.DeployError as e:
        raise VerbError(str(e))
    running = subprocess.run(["systemctl", "list-units", "--state=activating,active", "--no-legend", "--plain",
                              f"mk-deploy-{spec['app']}-*"], capture_output=True, text=True).stdout.strip()
    if running:
        raise VerbError("bu ilova uchun deploy allaqachon davom etmoqda")
    ddir = engine.ensure_dir(engine.app_dir(spec["app"]) / "deploys" / spec["deploy_id"])
    engine.ensure_dir(engine.app_dir(spec["app"]) / "deploys")
    engine.write_shared(ddir / "spec.json", json.dumps(spec))
    unit = f"mk-deploy-{spec['app']}-{spec['deploy_id'][-4:]}"
    _run(["systemd-run", f"--unit={unit}", "--collect", "--no-block", "--quiet",
          "--property=Nice=10", "--property=CPUWeight=50", "--property=IOWeight=50",
          "--setenv=PYTHONPATH=/opt/mirkomil/src/agent", "--setenv=PYTHONDONTWRITEBYTECODE=1",
          "/usr/bin/python3", "-m", "mirkomil", "deploy", str(ddir / "spec.json")])
    return {"deploy_id": spec["deploy_id"]}


def v_app_env_set(a: dict[str, Any]) -> Any:
    """Replace env: new values from `env`, plus existing values for keys listed in `keep`."""
    from .paas import engine
    app = _app(a)
    env, keep = a.get("env") or {}, a.get("keep") or []
    if not isinstance(env, dict) or not isinstance(keep, list):
        raise VerbError("bad env")
    old = engine.read_env(app)
    merged = {k: old[k] for k in keep if isinstance(k, str) and k in old}
    merged.update({str(k): str(v) for k, v in env.items()})
    try:
        engine.write_env(app, merged)
    except engine.DeployError as e:
        raise VerbError(str(e))
    return engine.read_env_keys(app)


def v_app_env_keys(a: dict[str, Any]) -> Any:
    from .paas import engine
    return engine.read_env_keys(_app(a))


def v_app_control(a: dict[str, Any]) -> Any:
    app, op = _app(a), str(a.get("op", ""))
    if op not in ("start", "stop", "restart"):
        raise VerbError("op: start | stop | restart")
    _run(["docker", op, _current(app)["container"]], timeout=90)
    return op


def v_app_logs(a: dict[str, Any]) -> Any:
    app = _app(a)
    lines = max(10, min(2000, int(a.get("lines") or 200)))
    p = subprocess.run(["docker", "logs", "--tail", str(lines), "--timestamps", _current(app)["container"]],
                       capture_output=True, text=True, timeout=30)
    return (p.stdout + p.stderr)[-300_000:]


def v_app_delete(a: dict[str, Any]) -> Any:
    from .paas import engine
    app = _app(a)
    for name in engine.app_containers(app):
        subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=60)
    if app in engine.load_routes():
        engine.set_route(app, None, None)
    tags = subprocess.run(["docker", "image", "ls", f"mirkomil/app-{app}", "--format", "{{.Repository}}:{{.Tag}}"],
                          capture_output=True, text=True).stdout.split()
    for t in tags:
        subprocess.run(["docker", "image", "rm", t], capture_output=True, timeout=60)
    import shutil
    shutil.rmtree(engine.app_dir(app), ignore_errors=True)
    return "deleted"


def v_app_stats(_a: dict[str, Any]) -> Any:
    """CPU / memory per Mirkomil container (one docker stats snapshot)."""
    p = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{json .}}"], capture_output=True, text=True, timeout=30)
    out = {}
    for line in p.stdout.splitlines():
        try:
            s = json.loads(line)
        except ValueError:
            continue
        if s.get("Name", "").startswith("mk-"):
            out[s["Name"]] = {"cpu": s.get("CPUPerc"), "mem": s.get("MemUsage"), "memPerc": s.get("MemPerc")}
    return out


def v_docker_container(a: dict[str, Any]) -> Any:
    name, op = str(a.get("name", "")), str(a.get("op", ""))
    if not CONTAINER_RE.match(name) or op not in ("start", "stop", "restart"):
        raise VerbError("invalid container or op")
    _run(["docker", op, "--", name], timeout=90)
    return op


def v_docker_logs(a: dict[str, Any]) -> Any:
    name = str(a.get("name", ""))
    if not CONTAINER_RE.match(name):
        raise VerbError("invalid container")
    lines = max(10, min(2000, int(a.get("lines") or 200)))
    p = subprocess.run(["docker", "logs", "--tail", str(lines), "--timestamps", "--", name], capture_output=True, text=True, timeout=30)
    return (p.stdout + p.stderr)[-300_000:]


def _paas_call(fn: Callable[[], Any]) -> Any:
    from .paas.engine import DeployError
    try:
        return fn()
    except DeployError as e:
        raise VerbError(str(e))


def v_app_deploykey(a: dict[str, Any]) -> Any:
    from .paas import engine
    app = _app(a)
    if not engine.app_dir(app).exists():
        raise VerbError("app not found")
    return {"public_key": _paas_call(lambda: engine.deploy_key(app))}


def v_app_remote_head(a: dict[str, Any]) -> Any:
    from .paas import engine
    app, repo, branch = _app(a), str(a.get("repo", "")), str(a.get("branch", ""))
    if not engine.REPO_RE.match(repo) or not engine.BRANCH_RE.match(branch):
        raise VerbError("invalid repo or branch")
    return {"sha": _paas_call(lambda: engine.remote_head(app, repo, branch))}


def v_db_create(a: dict[str, Any]) -> Any:
    from .paas import dbs
    by = re.sub(r"[^a-z0-9_.-]", "", str(a.get("by", "?")))[:32]
    return _paas_call(lambda: dbs.create(str(a.get("name", "")), str(a.get("kind", "")), int(a.get("mem_mb") or 256), by))


def v_db_list(_a: dict[str, Any]) -> Any:
    from .paas import dbs
    return dbs.list_all()


def v_db_attach(a: dict[str, Any]) -> Any:
    from .paas import dbs
    app = _app(a)
    var = a.get("var") or None
    return _paas_call(lambda: dbs.attach(str(a.get("name", "")), app, str(var) if var else None))


def v_db_delete(a: dict[str, Any]) -> Any:
    from .paas import dbs
    return _paas_call(lambda: dbs.delete(str(a.get("name", "")), bool(a.get("drop_data"))))


VERBS: dict[str, Callable[[dict[str, Any]], Any]] = {
    "app.deploykey": v_app_deploykey,
    "app.remote_head": v_app_remote_head,
    "db.create": v_db_create,
    "db.list": v_db_list,
    "db.attach": v_db_attach,
    "db.delete": v_db_delete,
    "app.deploy": v_app_deploy,
    "app.env.set": v_app_env_set,
    "app.env.keys": v_app_env_keys,
    "app.control": v_app_control,
    "app.logs": v_app_logs,
    "app.delete": v_app_delete,
    "app.stats": v_app_stats,
    "docker.container": v_docker_container,
    "docker.logs": v_docker_logs,
    "identity.apply": v_identity_apply,
    "apt.clean": v_apt_clean,
    "journal.vacuum": v_journal_vacuum,
    "docker.prune": v_docker_prune,
    "network.restart": v_network_restart,
    "system.reboot": v_system_reboot,
    "ufw.status": v_ufw_status,
    "fail2ban.status": v_fail2ban_status,
    "docker.ps": v_docker_ps,
    "smart.health": v_smart_health,
    "unit.restart": v_unit_restart,
}


def allowed_uids() -> set[int]:
    uids = {0}
    try:
        uids.add(pwd.getpwnam("mirkomil").pw_uid)
    except KeyError:
        pass
    return uids


def handle_request(raw: bytes, uid: int, allowed: set[int]) -> dict[str, Any]:
    if uid not in allowed:
        return {"ok": False, "error": "forbidden"}
    try:
        req = json.loads(raw)
        verb, args = str(req["verb"]), req.get("args") or {}
        if not isinstance(args, dict):
            raise ValueError
    except (ValueError, KeyError, TypeError):
        return {"ok": False, "error": "bad request"}
    fn = VERBS.get(verb)
    if fn is None:
        return {"ok": False, "error": f"unknown verb {verb}"}
    try:
        out = fn(args)
        log.info("verb %s ok (uid %d)", verb, uid)
        return {"ok": True, "out": out}
    except (VerbError, subprocess.TimeoutExpired, FileNotFoundError) as e:
        log.warning("verb %s failed (uid %d): %s", verb, uid, e)
        return {"ok": False, "error": str(e)}
    except Exception as e:  # always answer: a dropped connection hides the real cause
        log.exception("verb %s crashed (uid %d)", verb, uid)
        return {"ok": False, "error": f"internal error: {type(e).__name__}: {e}"[:500]}


class _Handler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        raw = self.rfile.readline(64 * 1024)
        resp = handle_request(raw, peer_uid(self.request), self.server.allowed)  # type: ignore[attr-defined]
        self.wfile.write(json.dumps(resp).encode() + b"\n")


class _Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    allowed: set[int] = set()


def serve() -> None:
    SOCKET.parent.mkdir(parents=True, exist_ok=True)
    try:
        SOCKET.unlink()
    except FileNotFoundError:
        pass
    srv = _Server(str(SOCKET), _Handler)
    srv.allowed = allowed_uids()
    try:
        gid = pwd.getpwnam("mirkomil").pw_gid
        os.chown(SOCKET, 0, gid)
    except KeyError:
        gid = 0
    os.chmod(SOCKET, 0o660)
    log.info("helper listening on %s", SOCKET)
    srv.serve_forever()


def call(verb: str, args: dict[str, Any] | None = None, timeout: float = 90) -> Any:
    """Client side (used by Guardian). Raises VerbError on failure."""
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(timeout)
        s.connect(str(SOCKET))
        s.sendall(json.dumps({"verb": verb, "args": args or {}}).encode() + b"\n")
        data = b""
        while not data.endswith(b"\n"):
            chunk = s.recv(65536)
            if not chunk:
                break
            data += chunk
    resp = json.loads(data or b"{}")
    if not resp.get("ok"):
        raise VerbError(resp.get("error", "helper error"))
    return resp.get("out")
