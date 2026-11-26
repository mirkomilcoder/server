"""Guardian API: panel users (admin), invites, per-app access and extra groups.

Linux accounts are changed only by the root helper (users.py); Guardian keeps the
panel-side facts in SQLite: invite metadata (email, who invited) and which apps a
developer/viewer may see. Temporary passwords pass through once and are never
stored or logged.
"""

from __future__ import annotations

import asyncio
import re
import time
from typing import Any

from . import helper
from .api import HttpError
from .auth import Peer

USER_RE = re.compile(r"^[a-z][a-z0-9_-]{1,30}$")
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,63}$")
ROLES = ("admin", "developer", "viewer")

SCHEMA = """
CREATE TABLE IF NOT EXISTS user_meta (
  user TEXT PRIMARY KEY, email TEXT, invited_by TEXT, invited_at INTEGER
);
CREATE TABLE IF NOT EXISTS app_members (
  app TEXT NOT NULL, user TEXT NOT NULL, PRIMARY KEY (app, user)
);
"""



def apps_for(db: Any, user: str) -> list[str]:
    return [r[0] for r in db.conn.execute("SELECT app FROM app_members WHERE user = ? ORDER BY app", (user,)).fetchall()]


def register(api: Any, state: Any) -> None:
    db = state.db
    db.conn.executescript(SCHEMA)

    async def h(verb: str, args: dict[str, Any] | None = None, timeout: float = 60) -> Any:
        try:
            return await asyncio.get_running_loop().run_in_executor(None, lambda: helper.call(verb, args or {}, timeout=timeout))
        except helper.VerbError as e:
            raise HttpError(400, str(e))
        except OSError:
            raise HttpError(503, "root helper ishlamayapti")

    def target(name: str, p: Peer) -> str:
        if not USER_RE.match(name or ""):
            raise HttpError(400, "foydalanuvchi nomi noto'g'ri")
        if name == p.user:
            raise HttpError(400, "o'zingizning hisobingizni bu yerda o'zgartirib bo'lmaydi")
        return name

    def known_apps(names: Any) -> list[str]:
        if not isinstance(names, list) or len(names) > 200:
            raise HttpError(400, "apps: ro'yxat kutilgan")
        rows = {r[0] for r in db.conn.execute("SELECT name FROM apps").fetchall()}
        out = sorted({str(n) for n in names})
        missing = [n for n in out if n not in rows]
        if missing:
            raise HttpError(400, f"bunday ilova yo'q: {', '.join(missing)}")
        return out

    async def access_emails(add: str | None = None, remove: str | None = None) -> str:
        """Keep the Cloudflare Access allow-list in step with invited users (best effort)."""
        try:
            st = await h("tunnel.status", timeout=40)
        except HttpError:
            return "off"
        if not st.get("configured"):
            return "off"
        emails = set(st.get("emails") or [])
        before = set(emails)
        if add:
            emails.add(add.lower())
        if remove:
            emails.discard(remove.lower())
        if emails == before or not emails:
            return "ok"
        try:
            await h("tunnel.setup", {"token": "", "domain": state.cfg.domain, "emails": sorted(emails),
                                     "root_app": st.get("root_app")}, timeout=120)
            return "ok"
        except HttpError as e:
            return f"xato: {e}"

    async def panel_url() -> str:
        try:
            st = await h("tunnel.status", timeout=40)
            if st.get("configured") and st.get("panel_host"):
                return f"https://{st['panel_host']}"
        except HttpError:
            pass
        snap = state.snapshot()
        ip = snap.get("tailscale_ip") or snap.get("ip")
        return f"https://{ip}:9090" if ip else ""

    # ---------------------------------------------------------------- admin: users

    @api.route("GET", "/v1/users", role="admin")
    async def users_list(_p: Peer, _q: dict[str, str], _b: Any) -> Any:
        users = await h("user.list")
        meta = {r["user"]: dict(r) for r in db.conn.execute("SELECT * FROM user_meta").fetchall()}
        for u in users:
            m = meta.get(u["user"], {})
            u.update(email=m.get("email"), invited_by=m.get("invited_by"), invited_at=m.get("invited_at"),
                     apps=apps_for(db, u["user"]))
        return {"users": users}

    @api.route("POST", "/v1/users", role="admin")
    async def users_create(p: Peer, _q: dict[str, str], b: Any) -> Any:
        b = b if isinstance(b, dict) else {}
        user = str(b.get("user", "")).strip().lower()
        role = str(b.get("role", ""))
        email = str(b.get("email") or "").strip().lower() or None
        if role not in ROLES:
            raise HttpError(400, "rol: admin, developer yoki viewer")
        if email and not EMAIL_RE.match(email):
            raise HttpError(400, "email noto'g'ri")
        apps = known_apps(b.get("apps") or [])
        res = await h("user.create", {"user": user, "role": role, "name": str(b.get("name") or "")[:60]}, timeout=90)
        db.conn.execute("INSERT OR REPLACE INTO user_meta (user, email, invited_by, invited_at) VALUES (?,?,?,?)",
                        (user, email, p.user, int(time.time())))
        db.conn.executemany("INSERT OR IGNORE INTO app_members (app, user) VALUES (?,?)", [(a, user) for a in apps])
        access = await access_emails(add=email) if email else "off"
        db.add_event("action", "info", f"Yangi foydalanuvchi: {user} ({role})", f"email: {email or '—'}", actor=p.user)
        return {"user": user, "role": role, "password": res["password"], "panel_url": await panel_url(),
                "email": email, "apps": apps, "access": access}

    @api.route("POST", "/v1/users/{name}/role", role="admin")
    async def users_role(p: Peer, q: dict[str, str], b: Any) -> Any:
        user = target(q["name"], p)
        role = str((b or {}).get("role", ""))
        if role not in ROLES:
            raise HttpError(400, "rol: admin, developer yoki viewer")
        await h("user.role", {"user": user, "role": role})
        db.add_event("action", "warn" if role == "admin" else "info", f"Rol o'zgardi: {user} → {role}", actor=p.user)
        return {"user": user, "role": role}

    @api.route("POST", "/v1/users/{name}/lock", role="admin")
    async def users_lock(p: Peer, q: dict[str, str], b: Any) -> Any:
        user = target(q["name"], p)
        locked = bool((b or {}).get("locked"))
        await h("user.lock", {"user": user, "locked": locked})
        db.add_event("action", "warn" if locked else "info", f"{'Bloklandi' if locked else 'Blokdan chiqarildi'}: {user}", actor=p.user)
        return {"user": user, "locked": locked}

    @api.route("POST", "/v1/users/{name}/password", role="admin")
    async def users_password(p: Peer, q: dict[str, str], _b: Any) -> Any:
        user = target(q["name"], p)
        res = await h("user.password", {"user": user}, timeout=60)
        db.add_event("action", "warn", f"Vaqtinchalik parol berildi: {user}", actor=p.user)
        return {"user": user, "password": res["password"], "panel_url": await panel_url()}

    @api.route("POST", "/v1/users/{name}/apps", role="admin")
    async def users_apps(p: Peer, q: dict[str, str], b: Any) -> Any:
        user = target(q["name"], p)
        apps = known_apps((b or {}).get("apps"))
        db.conn.execute("DELETE FROM app_members WHERE user = ?", (user,))
        db.conn.executemany("INSERT INTO app_members (app, user) VALUES (?,?)", [(a, user) for a in apps])
        db.add_event("action", "info", f"Ilovalar biriktirildi: {user}", ", ".join(apps) or "—", actor=p.user)
        return {"user": user, "apps": apps}

    @api.route("POST", "/v1/users/{name}/groups", role="admin")
    async def users_groups(p: Peer, q: dict[str, str], b: Any) -> Any:
        user = target(q["name"], p)
        groups = (b or {}).get("groups")
        if not isinstance(groups, list) or len(groups) > 10:
            raise HttpError(400, "groups: ro'yxat kutilgan")
        res = await h("user.groups", {"user": user, "groups": [str(g) for g in groups]})
        db.add_event("action", "warn", f"Guruhlar o'zgardi: {user}", ", ".join(res) or "—", actor=p.user)
        return {"user": user, "groups": res}

    @api.route("GET", "/v1/users/groups", role="admin")
    async def users_group_list(_p: Peer, _q: dict[str, str], _b: Any) -> Any:
        from .users import EXTRA_GROUPS
        return {"groups": [{"name": k, "about": v} for k, v in EXTRA_GROUPS.items()]}

    @api.route("POST", "/v1/users/{name}/delete", role="admin")
    async def users_delete(p: Peer, q: dict[str, str], b: Any) -> Any:
        user = target(q["name"], p)
        if str((b or {}).get("confirm", "")) != user:
            raise HttpError(400, "tasdiqlash uchun foydalanuvchi nomini yozing")
        await h("user.delete", {"user": user}, timeout=90)
        row = db.conn.execute("SELECT email FROM user_meta WHERE user = ?", (user,)).fetchone()
        db.conn.execute("DELETE FROM user_meta WHERE user = ?", (user,))
        db.conn.execute("DELETE FROM app_members WHERE user = ?", (user,))
        if row and row[0]:
            await access_emails(remove=row[0])
        db.add_event("action", "warn", f"Foydalanuvchi o'chirildi: {user}", "uy papkasi saqlandi", actor=p.user)
        return {"deleted": user}
