"""Managed databases: one-click PostgreSQL / Redis containers (runs as root via the helper).

    container  mk-db-<name>          internal network "mirkomil" only — no host port, ever
    volume     mk-db-<name>-data     survives restarts/upgrades; deleted only on explicit request
    secrets    /var/lib/mirkomil/dbs/<name>/private/      root 0700 dir (password, pg.env, redis.conf)
    meta       /var/lib/mirkomil/dbs/<name>/meta.json     root:mirkomil 0640 (no secrets)

Attaching a database to an app writes DATABASE_URL / REDIS_URL into the
app's root-only env file; the password never travels to the browser.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from .engine import NETWORK, DeployError, app_dir, ensure_dir, quiet, read_env, write_env, write_shared

DBS = Path(os.environ.get("MK_DBS_DIR", "/var/lib/mirkomil/dbs"))
DB_RE = re.compile(r"^[a-z][a-z0-9-]{1,30}[a-z0-9]$")

KINDS: dict[str, dict[str, Any]] = {
    "postgres": {"image": "postgres:17.6-alpine", "port": 5432, "var": "DATABASE_URL"},
    "redis": {"image": "redis:7.4.6-alpine", "port": 6379, "var": "REDIS_URL"},
}

HARDENING = ["--security-opt", "no-new-privileges:true", "--cap-drop", "NET_RAW", "--cap-drop", "MKNOD",
             "--cap-drop", "AUDIT_WRITE", "--cap-drop", "SETFCAP", "--pids-limit", "512",
             "--log-driver", "local", "--log-opt", "max-size=10m", "--log-opt", "max-file=3"]


def _dir(name: str) -> Path:
    return DBS / name


def container(name: str) -> str:
    return f"mk-db-{name}"


def volume(name: str) -> str:
    return f"mk-db-{name}-data"


def _check(name: str) -> None:
    if not DB_RE.match(name or ""):
        raise DeployError("baza nomi: 3–32 belgi, kichik harf/raqam/chiziqcha, harf bilan boshlansin")


def _private(name: str) -> Path:
    """Root-only directory: Guardian (group mirkomil) can read meta.json but never this."""
    p = _dir(name) / "private"
    p.mkdir(parents=True, exist_ok=True)
    os.chmod(p, 0o700)
    return p


def _secret(name: str) -> dict[str, str]:
    try:
        return json.loads((_private(name) / "secret.json").read_text())
    except (OSError, ValueError):
        raise DeployError("baza topilmadi")


def url(name: str) -> str:
    """Connection string reachable from app containers (same internal network)."""
    meta = json.loads((_dir(name) / "meta.json").read_text())
    s = _secret(name)
    host, port = container(name), KINDS[meta["kind"]]["port"]
    if meta["kind"] == "postgres":
        return f"postgresql://{s['user']}:{s['password']}@{host}:{port}/{s['db']}"
    # explicit "default" user: with an empty username ("redis://:pw@") some clients
    # (redis-cli 7) send AUTH "" pw and get WRONGPASS
    return f"redis://default:{s['password']}@{host}:{port}/0"


def create(name: str, kind: str, mem_mb: int, by: str) -> dict[str, Any]:
    _check(name)
    if kind not in KINDS:
        raise DeployError("tur: postgres yoki redis")
    if not 64 <= int(mem_mb) <= 8192:
        raise DeployError("RAM: 64–8192 MB")
    if (_dir(name) / "meta.json").exists():
        raise DeployError("bu nomli baza allaqachon bor")
    k = KINDS[kind]
    d = ensure_dir(_dir(name))
    priv = _private(name)
    # url-safe random secrets (no characters that need escaping in a URL)
    sec = {"user": "app", "db": name.replace("-", "_"), "password": secrets.token_urlsafe(32)}
    fd = os.open(priv / "secret.json", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(sec, f)

    if quiet(["docker", "network", "inspect", NETWORK]).returncode != 0:
        quiet(["docker", "network", "create", NETWORK])
    argv = ["docker", "run", "-d", "--name", container(name), "--network", NETWORK, "--restart", "unless-stopped",
            "--memory", f"{mem_mb}m", "--memory-swap", f"{mem_mb}m",
            "--label", f"mirkomil.db={name}", "--label", f"mirkomil.dbkind={kind}", *HARDENING]
    if kind == "postgres":
        # env-file keeps the password off the process list
        envf = priv / "pg.env"
        fd = os.open(envf, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(f"POSTGRES_USER={sec['user']}\nPOSTGRES_DB={sec['db']}\nPOSTGRES_PASSWORD={sec['password']}\n")
        argv += ["--env-file", str(envf), "-v", f"{volume(name)}:/var/lib/postgresql/data", k["image"]]
    else:
        # redis: password via a root-only config file mounted read-only
        conf = priv / "redis.conf"
        fd = os.open(conf, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
        with os.fdopen(fd, "w") as f:
            f.write(f"requirepass {sec['password']}\nappendonly yes\nprotected-mode yes\n")
        # file readable by redis (uid 999) through the bind mount; on the host the
        # private/ directory (0700 root) still keeps everyone else out
        os.chmod(conf, 0o644)
        argv += ["-v", f"{volume(name)}:/data", "-v", f"{conf}:/usr/local/etc/redis/redis.conf:ro",
                 k["image"], "redis-server", "/usr/local/etc/redis/redis.conf"]
    r = quiet(argv, timeout=300)
    if r.returncode != 0:
        shutil.rmtree(d, ignore_errors=True)
        raise DeployError("baza ishga tushmadi: " + r.stderr.strip()[-300:])
    meta = {"name": name, "kind": kind, "image": k["image"], "mem_mb": int(mem_mb), "created_by": by,
            "created_at": int(time.time()), "attached": []}
    write_shared(d / "meta.json", json.dumps(meta))
    return meta


def list_all() -> list[dict[str, Any]]:
    out = []
    try:
        names = sorted(p.name for p in DBS.iterdir() if DB_RE.match(p.name))
    except OSError:
        return out
    for n in names:
        try:
            meta = json.loads((_dir(n) / "meta.json").read_text())
        except (OSError, ValueError):
            continue
        st = quiet(["docker", "inspect", "-f", "{{.State.Status}}", container(n)]).stdout.strip() or "missing"
        meta["state"] = st
        meta["host"] = container(n)
        meta["port"] = KINDS[meta["kind"]]["port"]
        out.append(meta)
    return out


def attach(name: str, app: str, var: str | None = None) -> dict[str, Any]:
    """Put the connection string into the app's env (takes effect on next deploy/restart)."""
    _check(name)
    meta = json.loads((_dir(name) / "meta.json").read_text())
    var = var or KINDS[meta["kind"]]["var"]
    if not re.match(r"^[A-Z_][A-Z0-9_]{0,63}$", var):
        raise DeployError("o'zgaruvchi nomi noto'g'ri")
    if not (app_dir(app)).exists():
        raise DeployError("ilova topilmadi")
    env = read_env(app)
    env[var] = url(name)
    write_env(app, env)
    if app not in meta["attached"]:
        meta["attached"].append(app)
        write_shared(_dir(name) / "meta.json", json.dumps(meta))
    return {"app": app, "var": var}


def delete(name: str, drop_data: bool) -> str:
    _check(name)
    quiet(["docker", "rm", "-f", container(name)], timeout=120)
    if drop_data:
        quiet(["docker", "volume", "rm", volume(name)], timeout=120)
    shutil.rmtree(_dir(name), ignore_errors=True)
    return "deleted" + (" (data too)" if drop_data else " (data volume kept)")
