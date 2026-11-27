"""Guardian API endpoints for apps (PaaS) and Docker.

Guardian (user "mirkomil") owns the app list in SQLite and enforces roles;
everything that touches Docker or root-owned files is a helper verb.
Deploy status/logs are read straight from the group-readable job files.

Roles: viewer = read · developer = create / deploy / control / env · admin = delete + raw Docker.
Per-app access: admins see every app; developers and viewers only the apps they
created or were assigned on the Users page (table app_members). Others get 404 —
an app's existence isn't revealed.
"""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any

from .. import helper
from ..api import HttpError
from ..auth import Peer
from .detect import site_mode
from .engine import APP_RE, APPS, DEPLOY_RE, ENV_KEY_RE, REPO_RE, BRANCH_RE

SCHEMA = """
CREATE TABLE IF NOT EXISTS apps (
  name TEXT PRIMARY KEY, repo TEXT NOT NULL, branch TEXT NOT NULL, type TEXT,
  port INTEGER NOT NULL DEFAULT 0, mem_mb INTEGER NOT NULL DEFAULT 512, cpus REAL NOT NULL DEFAULT 1.0,
  created_by TEXT, created_at INTEGER
);
"""

TYPES = (None, "dockerfile", "django", "fastapi", "flask", "bot", "node", "static")


def _read_json(p: Path) -> dict[str, Any] | None:
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return None


def deploys_of(app: str, limit: int = 20) -> list[dict[str, Any]]:
    d = APPS / app / "deploys"
    try:
        ids = sorted((x.name for x in d.iterdir() if DEPLOY_RE.match(x.name)), reverse=True)[:limit]
    except OSError:
        return []
    return [s for s in (_read_json(d / i / "status.json") for i in ids) if s]


def _validate_settings(b: dict[str, Any], partial: bool = False) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if not partial or "repo" in b:
        out["repo"] = str(b.get("repo", "")).strip()
        if not REPO_RE.match(out["repo"]):
            raise HttpError(400, "repo: https://github.com/<egasi>/<repo> ko'rinishida bo'lsin (hozircha ochiq repolar)")
    if not partial or "branch" in b:
        out["branch"] = str(b.get("branch") or "main").strip()
        if not BRANCH_RE.match(out["branch"]):
            raise HttpError(400, "branch nomi noto'g'ri")
    if "type" in b or not partial:
        t = b.get("type") or None
        if t not in TYPES:
            raise HttpError(400, "tur noto'g'ri")
        out["type"] = t
    for key, lo, hi, cast in (("port", 0, 65535, int), ("mem_mb", 64, 16384, int), ("cpus", 0.1, 16, float)):
        if key in b or not partial:
            try:
                v = cast(b.get(key) if b.get(key) is not None else {"port": 0, "mem_mb": 512, "cpus": 1.0}[key])
            except (TypeError, ValueError):
                raise HttpError(400, f"{key} noto'g'ri")
            if not lo <= v <= hi:
                raise HttpError(400, f"{key}: {lo}–{hi}")
            out[key] = v
    if "autodeploy" in b:
        out["autodeploy"] = 1 if b.get("autodeploy") else 0
    if "public" in b:
        # None = default for the type; web frameworks are always public (detect.is_public)
        out["public"] = None if b.get("public") is None else (1 if b.get("public") else 0)
    return out


AUTODEPLOY_EVERY_S = 300


def autodeploy_tick(state: Any) -> list[str]:
    """
    Auto-deploy (runs in Guardian's loop, blocking → executor): for each app
    with autodeploy on, ask the helper for the branch's latest commit and start
    a deploy when it differs from the last successful one. Returns started apps.
    """
    started = []
    rows = state.db.conn.execute("SELECT * FROM apps WHERE autodeploy = 1").fetchall()
    for row in rows:
        a = dict(row)
        deps = deploys_of(a["name"], 10)
        if any(d.get("state") == "running" for d in deps):
            continue
        last_ok = next((d for d in deps if d.get("state") == "success" and d.get("commit_sha")), None)
        last_any = deps[0] if deps else None
        try:
            sha = helper.call("app.remote_head", {"app": a["name"], "repo": a["repo"], "branch": a["branch"]}, timeout=90)["sha"]
        except Exception:
            continue  # network blip / auth problem: try again next round
        if last_ok and last_ok["commit_sha"] == sha:
            continue
        # don't retry the same broken commit forever
        if last_any and last_any.get("state") == "failed" and last_any.get("commit_sha") == sha:
            continue
        try:
            res = helper.call("app.deploy", {**{k: a.get(k) for k in ("repo", "branch", "type", "port", "mem_mb", "cpus", "public")},
                                             "app": a["name"], "domain": state.cfg.domain, "by": "auto"}, timeout=60)
        except Exception:
            continue
        state.db.add_event("action", "info", f"Avto-deploy: {a['name']} (yangi commit {sha[:7]})", res.get("deploy_id", ""),
                           check_id=f"app:{a['name']}", actor="guardian")
        started.append(a["name"])
    return started


def _validate_env(env: Any) -> dict[str, str]:
    if env is None:
        return {}
    if not isinstance(env, dict) or len(env) > 100:
        raise HttpError(400, "env: obyekt (ko'pi bilan 100 ta kalit)")
    out = {}
    for k, v in env.items():
        k, v = str(k), str(v)
        if not ENV_KEY_RE.match(k) or k == "PORT":
            raise HttpError(400, f"env kaliti noto'g'ri: {k}")
        if "\n" in v or "\r" in v or len(v) > 8192:
            raise HttpError(400, f"env qiymati noto'g'ri: {k}")
        out[k] = v
    return out


def register(api: Any, state: Any) -> None:
    db = state.db
    db.conn.executescript(SCHEMA)
    # migration: auto-deploy flag (added after the first release of the apps table)
    cols = {r[1] for r in db.conn.execute("PRAGMA table_info(apps)").fetchall()}
    if "autodeploy" not in cols:
        db.conn.execute("ALTER TABLE apps ADD COLUMN autodeploy INTEGER NOT NULL DEFAULT 0")
    if "public" not in cols:  # NULL = default for the app type
        db.conn.execute("ALTER TABLE apps ADD COLUMN public INTEGER")
    loop_call = lambda fn: asyncio.get_running_loop().run_in_executor(None, fn)  # noqa: E731

    async def h(verb: str, args: dict[str, Any] | None = None, timeout: float = 120) -> Any:
        try:
            return await loop_call(lambda: helper.call(verb, args or {}, timeout=timeout))
        except helper.VerbError as e:
            raise HttpError(400, str(e))
        except OSError:
            raise HttpError(503, "root helper ishlamayapti")

    db.conn.execute("CREATE TABLE IF NOT EXISTS app_members (app TEXT NOT NULL, user TEXT NOT NULL, PRIMARY KEY (app, user))")

    def can_see(p: Peer, app: dict[str, Any]) -> bool:
        if p.role == "admin" or app.get("created_by") == p.user:
            return True
        return db.conn.execute("SELECT 1 FROM app_members WHERE app = ? AND user = ?", (app["name"], p.user)).fetchone() is not None

    def get_app(name: str, p: Peer | None = None) -> dict[str, Any]:
        if not APP_RE.match(name or ""):
            raise HttpError(400, "ilova nomi noto'g'ri")
        row = db.conn.execute("SELECT * FROM apps WHERE name = ?", (name,)).fetchone()
        if not row or (p is not None and not can_see(p, dict(row))):
            raise HttpError(404, "ilova topilmadi")
        return dict(row)

    async def start_deploy(app: dict[str, Any], by: str, image: str | None = None) -> Any:
        res = await h("app.deploy", {**{k: app.get(k) for k in ("repo", "branch", "type", "port", "mem_mb", "cpus", "public")},
                                     "app": app["name"], "domain": state.cfg.domain, "by": by, "image": image})
        title = f"Deploy boshlandi: {app['name']}" if not image else f"Rollback boshlandi: {app['name']}"
        db.add_event("action", "info", title, res.get("deploy_id", ""), check_id=f"app:{app['name']}", actor=by)
        return res

    @api.route("GET", "/v1/apps")
    async def list_apps(p: Peer, _q: dict[str, str], _b: Any) -> Any:
        stats: dict[str, Any] = {}
        try:
            stats = await loop_call(lambda: helper.call("app.stats", {}, timeout=40))
        except Exception:
            pass
        out = []
        for row in db.conn.execute("SELECT * FROM apps ORDER BY name").fetchall():
            a = dict(row)
            if not can_see(p, a):
                continue
            cur = _read_json(APPS / a["name"] / "current.json") or {}
            deps = deploys_of(a["name"], 1)
            a["site_mode"] = site_mode(cur.get("type") or a.get("type"))
            a.update(current=cur, last_deploy=deps[0] if deps else None,
                     url=f"http://{a['name']}.{state.cfg.domain}" if cur.get("web") else None,
                     stats=stats.get(cur.get("container", ""), None))
            out.append(a)
        return {"apps": out, "domain": state.cfg.domain}

    @api.route("POST", "/v1/apps", role="developer")
    async def create_app(p: Peer, _q: dict[str, str], b: Any) -> Any:
        if not isinstance(b, dict):
            raise HttpError(400, "JSON object expected")
        name = str(b.get("name", "")).strip()
        if not APP_RE.match(name):
            raise HttpError(400, "nom: 3–32 belgi, kichik lotin harflari, raqamlar va '-', harf bilan boshlansin")
        if db.conn.execute("SELECT 1 FROM apps WHERE name = ?", (name,)).fetchone():
            raise HttpError(400, "bu nomli ilova allaqachon bor")
        s = _validate_settings(b)
        env = _validate_env(b.get("env"))
        await h("app.env.set", {"app": name, "env": env, "keep": []})
        public = _validate_settings({"public": b.get("public")}, partial=True)["public"] if "public" in b else None
        db.conn.execute("INSERT INTO apps (name, repo, branch, type, port, mem_mb, cpus, public, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (name, s["repo"], s["branch"], s["type"], s["port"], s["mem_mb"], s["cpus"], public, p.user, int(time.time())))
        db.add_event("action", "info", f"Yangi ilova: {name}", s["repo"], check_id=f"app:{name}", actor=p.user)
        return await start_deploy(get_app(name, p), p.user)

    @api.route("GET", "/v1/apps/{name}")
    async def app_detail(p: Peer, q: dict[str, str], _b: Any) -> Any:
        a = get_app(q["name"], p)
        keys = await h("app.env.keys", {"app": a["name"]})
        cur = _read_json(APPS / a["name"] / "current.json") or {}
        return {**a, "current": cur, "deploys": deploys_of(a["name"]), "env": keys,
                "site_mode": site_mode(cur.get("type") or a.get("type")),
                "url": f"http://{a['name']}.{state.cfg.domain}" if cur.get("web") else None}

    @api.route("POST", "/v1/apps/{name}/settings", role="developer")
    async def app_settings(p: Peer, q: dict[str, str], b: Any) -> Any:
        a = get_app(q["name"], p)
        s = _validate_settings(b if isinstance(b, dict) else {}, partial=True)
        if s:
            sets = ", ".join(f"{k} = ?" for k in s)
            db.conn.execute(f"UPDATE apps SET {sets} WHERE name = ?", (*s.values(), a["name"]))  # keys are fixed names
            db.add_event("action", "info", f"Ilova sozlamalari o'zgardi: {a['name']}", ", ".join(s), check_id=f"app:{a['name']}", actor=p.user)
        return get_app(a["name"], p)

    @api.route("POST", "/v1/apps/{name}/deploy", role="developer")
    async def redeploy(p: Peer, q: dict[str, str], _b: Any) -> Any:
        return await start_deploy(get_app(q["name"], p), p.user)

    @api.route("POST", "/v1/apps/{name}/rollback", role="developer")
    async def rollback(p: Peer, q: dict[str, str], b: Any) -> Any:
        a = get_app(q["name"], p)
        did = str((b or {}).get("deploy_id", ""))
        st = _read_json(APPS / a["name"] / "deploys" / did / "status.json") if DEPLOY_RE.match(did) else None
        if not st or st.get("state") != "success" or not st.get("image"):
            raise HttpError(400, "bu deploy'ga qaytib bo'lmaydi (muvaffaqiyatli bo'lmagan yoki obraz o'chirilgan)")
        return await start_deploy(a, p.user, image=st["image"])

    @api.route("GET", "/v1/apps/{name}/deploys/{id}")
    async def deploy_log(p: Peer, q: dict[str, str], _b: Any) -> Any:
        a = get_app(q["name"], p)
        if not DEPLOY_RE.match(q["id"]):
            raise HttpError(400, "deploy id noto'g'ri")
        d = APPS / a["name"] / "deploys" / q["id"]
        st = _read_json(d / "status.json")
        if not st:
            raise HttpError(404, "deploy topilmadi")
        offset = max(0, int(q.get("offset", "0") or 0))
        try:
            with open(d / "log", "rb") as f:
                f.seek(offset)
                chunk = f.read(256_000)
        except OSError:
            chunk = b""
        return {"status": st, "text": chunk.decode("utf-8", "replace"), "next": offset + len(chunk)}

    @api.route("POST", "/v1/apps/{name}/control", role="developer")
    async def control(p: Peer, q: dict[str, str], b: Any) -> Any:
        a = get_app(q["name"], p)
        op = str((b or {}).get("op", ""))
        res = await h("app.control", {"app": a["name"], "op": op})
        db.add_event("action", "info", f"Ilova {op}: {a['name']}", check_id=f"app:{a['name']}", actor=p.user)
        return {"result": res}

    @api.route("GET", "/v1/apps/{name}/logs")
    async def logs(p: Peer, q: dict[str, str], _b: Any) -> Any:
        a = get_app(q["name"], p)
        return {"text": await h("app.logs", {"app": a["name"], "lines": int(q.get("lines", "300") or 300)})}

    @api.route("POST", "/v1/apps/{name}/env", role="developer")
    async def set_env(p: Peer, q: dict[str, str], b: Any) -> Any:
        a = get_app(q["name"], p)
        b = b if isinstance(b, dict) else {}
        keep = [k for k in (b.get("keep") or []) if isinstance(k, str) and ENV_KEY_RE.match(k)]
        env = _validate_env(b.get("env"))
        before = {e["key"] for e in await h("app.env.keys", {"app": a["name"]})}
        keys = await h("app.env.set", {"app": a["name"], "env": env, "keep": keep})
        after = {e["key"] for e in keys}
        # which keys changed — never the values
        detail = "; ".join(x for x in (
            f"o'zgardi: {', '.join(sorted(set(env) & before))}" if set(env) & before else "",
            f"qo'shildi: {', '.join(sorted(after - before))}" if after - before else "",
            f"o'chirildi: {', '.join(sorted(before - after))}" if before - after else "",
        ) if x) or "o'zgarish yo'q"
        db.add_event("action", "info", f"Env o'zgaruvchilari yangilandi: {a['name']}", detail,
                     check_id=f"app:{a['name']}", actor=p.user)
        return {"env": keys}

    @api.route("POST", "/v1/apps/{name}/env/reveal", role="developer")
    async def reveal_env(p: Peer, q: dict[str, str], _b: Any) -> Any:
        """Current values for the env editor: only for users who may use this app; every read is logged."""
        a = get_app(q["name"], p)
        env = await h("app.env.get", {"app": a["name"]})
        db.add_event("action", "warn", f"Env qiymatlari ko'rildi: {a['name']}", f"{len(env)} ta kalit",
                     check_id=f"app:{a['name']}", actor=p.user)
        return {"env": [{"key": k, "value": v} for k, v in env.items()]}

    @api.route("POST", "/v1/apps/{name}/delete", role="admin")
    async def delete(p: Peer, q: dict[str, str], b: Any) -> Any:
        a = get_app(q["name"], p)
        if str((b or {}).get("confirm", "")) != a["name"]:
            raise HttpError(400, "tasdiqlash uchun ilova nomini yozing")
        await h("app.delete", {"app": a["name"]}, timeout=300)
        db.conn.execute("DELETE FROM apps WHERE name = ?", (a["name"],))
        db.conn.execute("DELETE FROM app_members WHERE app = ?", (a["name"],))
        db.add_event("action", "warn", f"Ilova o'chirildi: {a['name']}", check_id=f"app:{a['name']}", actor=p.user)
        return {"deleted": a["name"]}

    @api.route("POST", "/v1/apps/{name}/deploykey", role="developer")
    async def deploykey(p: Peer, q: dict[str, str], _b: Any) -> Any:
        """Create (once) and return the PUBLIC deploy key; the private key never leaves the server."""
        a = get_app(q["name"], p)
        res = await h("app.deploykey", {"app": a["name"]})
        db.add_event("action", "info", f"Deploy kaliti: {a['name']}", check_id=f"app:{a['name']}", actor=p.user)
        return res

    # ---- managed databases ----

    @api.route("GET", "/v1/databases")
    async def dbs_list(p: Peer, _q: dict[str, str], _b: Any) -> Any:
        return {"databases": await h("db.list")}

    @api.route("POST", "/v1/databases", role="developer")
    async def dbs_create(p: Peer, _q: dict[str, str], b: Any) -> Any:
        b = b if isinstance(b, dict) else {}
        kind = str(b.get("kind", ""))
        if kind not in ("postgres", "redis"):
            raise HttpError(400, "tur: postgres yoki redis")
        res = await h("db.create", {"name": str(b.get("name", "")), "kind": kind, "mem_mb": int(b.get("mem_mb") or 256), "by": p.user}, timeout=400)
        db.add_event("action", "info", f"Yangi baza: {res['name']} ({kind})", actor=p.user)
        return res

    @api.route("POST", "/v1/databases/{name}/attach", role="developer")
    async def dbs_attach(p: Peer, q: dict[str, str], b: Any) -> Any:
        b = b if isinstance(b, dict) else {}
        app = get_app(str(b.get("app", "")), p)["name"]
        res = await h("db.attach", {"name": q["name"], "app": app, "var": b.get("var") or None})
        db.add_event("action", "info", f"Baza ulandi: {q['name']} → {app} ({res['var']})", check_id=f"app:{app}", actor=p.user)
        return res

    @api.route("POST", "/v1/databases/{name}/delete", role="admin")
    async def dbs_delete(p: Peer, q: dict[str, str], b: Any) -> Any:
        b = b if isinstance(b, dict) else {}
        if str(b.get("confirm", "")) != q["name"]:
            raise HttpError(400, "tasdiqlash uchun baza nomini yozing")
        res = await h("db.delete", {"name": q["name"], "drop_data": bool(b.get("drop_data"))}, timeout=300)
        db.add_event("action", "warn", f"Baza o'chirildi: {q['name']} — {res}", actor=p.user)
        return {"result": res}

    # ---- raw Docker (admin) ----

    @api.route("GET", "/v1/docker/containers", role="admin")
    async def containers(p: Peer, _q: dict[str, str], _b: Any) -> Any:
        return {"containers": await h("docker.ps"), "stats": await h("app.stats", timeout=40)}

    @api.route("POST", "/v1/docker/container", role="admin")
    async def container_op(p: Peer, _q: dict[str, str], b: Any) -> Any:
        b = b if isinstance(b, dict) else {}
        res = await h("docker.container", {"name": str(b.get("name", "")), "op": str(b.get("op", ""))})
        db.add_event("action", "info", f"Docker {b.get('op')}: {b.get('name')}", actor=p.user)
        return {"result": res}

    @api.route("GET", "/v1/docker/logs", role="admin")
    async def container_logs(p: Peer, q: dict[str, str], _b: Any) -> Any:
        return {"text": await h("docker.logs", {"name": q.get("name", ""), "lines": int(q.get("lines", "300") or 300)})}

    @api.route("POST", "/v1/docker/prune", role="admin")
    async def prune(p: Peer, _q: dict[str, str], _b: Any) -> Any:
        res = await h("docker.prune", {}, timeout=600)
        db.add_event("action", "info", "Docker tozalandi (eski obrazlar, build kesh)", str(res)[:300], actor=p.user)
        return {"result": res}

    # ---- public access: Cloudflare Tunnel + Access (admin) ----

    @api.route("GET", "/v1/tunnel", role="admin")
    async def tunnel_status(p: Peer, _q: dict[str, str], _b: Any) -> Any:
        return await h("tunnel.status", timeout=40)

    @api.route("POST", "/v1/tunnel/setup", role="admin")
    async def tunnel_setup(p: Peer, _q: dict[str, str], b: Any) -> Any:
        """The API token passes through to the root helper and is stored root-only; it is never logged or returned."""
        b = b if isinstance(b, dict) else {}
        emails = b.get("emails")
        if not isinstance(emails, list) or not emails or len(emails) > 50:
            raise HttpError(400, "kamida bitta email kerak")
        root = b.get("root_app") or None
        if root is not None:
            root = get_app(str(root))["name"]
        res = await h("tunnel.setup", {"token": str(b.get("token") or ""), "domain": state.cfg.domain,
                                       "emails": [str(e) for e in emails], "root_app": root}, timeout=120)
        db.add_event("action", "info", f"Cloudflare Tunnel sozlandi: panel.{state.cfg.domain}",
                     f"ruxsat: {', '.join(str(e) for e in emails)}", actor=p.user)
        return res

    @api.route("POST", "/v1/tunnel/sync", role="admin")
    async def tunnel_sync(p: Peer, _q: dict[str, str], _b: Any) -> Any:
        res = await h("tunnel.sync", timeout=120)
        db.add_event("action", "info", "Cloudflare: DNS va marshrutlar sinxronlandi", actor=p.user)
        return res
