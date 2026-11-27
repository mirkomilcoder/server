"""GitHub webhooks: push → deploy, without waiting for the 5-minute poll.

A tiny HTTP listener inside Guardian, bound to 127.0.0.1 only. The internet
reaches it solely through the Cloudflare Tunnel (hooks.<domain>), which routes
nothing else there. It answers exactly one thing:

    POST /github/<app>     X-Hub-Signature-256: sha256=<hmac of the body>

Every app has its own random secret (apps.hook_secret). The signature is checked
with a constant-time compare BEFORE the body is parsed; unknown apps, apps
without webhooks and bad signatures all get the same 404/401 without detail.
A push to another branch is ignored. If a deploy is already running, the commit
is queued and started by pending_tick() when the running one ends.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import time
from pathlib import Path
from typing import Any

from .. import helper

log = logging.getLogger("mirkomil.hooks")

HOOK_HOST = "127.0.0.1"
HOOK_PORT = int(os.environ.get("MK_HOOK_PORT", "8099"))
PATH_RE = re.compile(r"^/github/([a-z][a-z0-9-]{1,30}[a-z0-9])$")
MAX_HEADERS = 16_384
MAX_BODY = 5 * 1024 * 1024
KEEP_DELIVERIES = 20


def new_secret() -> str:
    return secrets.token_hex(24)


def signature_ok(secret: str, body: bytes, header: str) -> bool:
    if not secret or not header.startswith("sha256="):
        return False
    want = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, header[7:].strip())


def record(db: Any, app: str, event: str, result: str, detail: str = "") -> None:
    key = f"hook_log:{app}"
    items = db.get(key, [])
    items.insert(0, {"ts": int(time.time()), "event": event, "result": result, "detail": detail[:200]})
    db.put(key, items[:KEEP_DELIVERIES])


def deploy_running(app: str) -> bool:
    from .api_apps import deploys_of
    return any(d.get("state") == "running" for d in deploys_of(app, 5))


def start_deploy_sync(state: Any, row: dict[str, Any], by: str) -> str:
    """Same arguments the panel's deploy button sends (blocking: run in an executor)."""
    res = helper.call("app.deploy", {**{k: row.get(k) for k in ("repo", "branch", "type", "port", "mem_mb", "cpus", "public", "root_dir")},
                                     "app": row["name"], "domain": state.cfg.domain, "by": by}, timeout=60)
    return str(res.get("deploy_id", ""))


def handle_delivery(state: Any, app: str, event: str, signature: str, body: bytes) -> tuple[int, dict[str, Any]]:
    """Pure decision + side effects for one delivery (blocking; tests call it directly)."""
    db = state.db
    row = db.conn.execute("SELECT * FROM apps WHERE name = ?", (app,)).fetchone()
    row = dict(row) if row else None
    if not row or not row.get("hook_secret"):
        return 404, {"error": "not found"}
    if not signature_ok(row["hook_secret"], body, signature):
        record(db, app, event or "?", "rejected", "imzo mos kelmadi")
        return 401, {"error": "bad signature"}
    if event == "ping":
        record(db, app, "ping", "ok", "GitHub ulanishni tekshirdi")
        return 200, {"ok": "pong"}
    if event != "push":
        record(db, app, event or "?", "ignored", "faqat push hodisasi ishlatiladi")
        return 202, {"ignored": event}
    try:
        payload = json.loads(body)
        if not isinstance(payload, dict):
            raise ValueError
    except ValueError:
        record(db, app, "push", "rejected", "JSON emas — Content type: application/json bo'lsin")
        return 400, {"error": "payload must be application/json"}
    ref = str(payload.get("ref", ""))
    sha = str(payload.get("after", ""))[:40]
    if ref != f"refs/heads/{row['branch']}":
        record(db, app, "push", "ignored", f"{ref.removeprefix('refs/heads/')} branch — kuzatilmaydi ({row['branch']})")
        return 202, {"ignored": ref}
    if payload.get("deleted") or set(sha) == {"0"}:
        record(db, app, "push", "ignored", "branch o'chirildi")
        return 202, {"ignored": "deleted"}
    who = str((payload.get("pusher") or {}).get("name", ""))[:40]
    msg = str((payload.get("head_commit") or {}).get("message", "")).splitlines()[0][:80] if payload.get("head_commit") else ""
    def queue() -> tuple[int, dict[str, Any]]:
        db.put(f"hook_pending:{app}", {"sha": sha, "who": who, "ts": int(time.time())})
        record(db, app, "push", "queued", f"{sha[:7]} {msg} — joriy deploy tugagach boshlanadi")
        return 202, {"queued": sha}

    if deploy_running(app):
        return queue()
    try:
        did = start_deploy_sync(state, row, "github")
    except helper.VerbError:
        # a deploy that started a moment ago may not have written its status yet:
        # the helper refuses a second one — queue this commit instead of failing
        return queue()
    record(db, app, "push", "deployed", f"{sha[:7]} {msg}")
    db.add_event("action", "info", f"Webhook: deploy boshlandi: {app}", f"{sha[:7]} {msg} ({who or 'GitHub'})",
                 check_id=f"app:{app}", actor="github")
    return 202, {"deploy_id": did}


def pending_tick(state: Any) -> list[str]:
    """Start queued webhook deploys whose previous deploy has finished (Guardian loop, blocking)."""
    started = []
    rows = state.db.conn.execute("SELECT k FROM kv WHERE k LIKE 'hook_pending:%'").fetchall()
    for (key,) in rows:
        app = key.split(":", 1)[1]
        if deploy_running(app):
            continue
        row = state.db.conn.execute("SELECT * FROM apps WHERE name = ?", (app,)).fetchone()
        if not row:
            state.db.conn.execute("DELETE FROM kv WHERE k = ?", (key,))
            continue
        try:
            start_deploy_sync(state, dict(row), "github")
        except helper.VerbError as e:
            if "allaqachon" in str(e):
                continue  # the previous deploy is still finishing: keep the commit queued
            state.db.conn.execute("DELETE FROM kv WHERE k = ?", (key,))
            record(state.db, app, "push", "failed", str(e)[:200])
            continue
        except Exception as e:  # noqa: BLE001 — reported in the delivery log
            state.db.conn.execute("DELETE FROM kv WHERE k = ?", (key,))
            record(state.db, app, "push", "failed", str(e)[:200])
            continue
        state.db.conn.execute("DELETE FROM kv WHERE k = ?", (key,))
        record(state.db, app, "push", "deployed", "navbatdagi commit")
        started.append(app)
    return started


# ---------------------------------------------------------------- the listener

async def _respond(writer: asyncio.StreamWriter, status: int, body: dict[str, Any]) -> None:
    data = json.dumps(body).encode()
    reason = {200: "OK", 202: "Accepted", 400: "Bad Request", 401: "Unauthorized", 404: "Not Found",
              405: "Method Not Allowed", 413: "Payload Too Large", 503: "Service Unavailable"}.get(status, "Error")
    writer.write(f"HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {len(data)}\r\n"
                 f"Connection: close\r\n\r\n".encode() + data)
    try:
        await writer.drain()
    finally:
        writer.close()


LOGO = Path(__file__).resolve().parents[3] / "configs" / "cockpit" / "branding" / "logo.svg"


async def _respond_logo(writer: asyncio.StreamWriter) -> None:
    """The server's logo for the Cloudflare Access login page (a public image, nothing else)."""
    try:
        data = LOGO.read_bytes()
    except OSError:
        return await _respond(writer, 404, {"error": "not found"})
    writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: image/svg+xml\r\nCache-Control: public, max-age=3600\r\n"
                 b"X-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\n"
                 + f"Content-Length: {len(data)}\r\nConnection: close\r\n\r\n".encode() + data)
    try:
        await writer.drain()
    finally:
        writer.close()


async def _handle(state: Any, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=10)
    except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, TimeoutError):
        writer.close()
        return
    try:
        lines = head.decode("latin-1").split("\r\n")
        method, path, _ = lines[0].split(" ", 2)
        headers = {k.strip().lower(): v.strip() for k, _, v in (ln.partition(":") for ln in lines[1:] if ln)}
    except ValueError:
        return await _respond(writer, 400, {"error": "bad request"})
    if method == "GET" and path.split("?", 1)[0] == "/brand/logo.svg":
        return await _respond_logo(writer)
    m = PATH_RE.match(path.split("?", 1)[0])
    if not m:
        return await _respond(writer, 404, {"error": "not found"})
    if method != "POST":
        return await _respond(writer, 405, {"error": "POST only"})
    try:
        length = int(headers.get("content-length", ""))
    except ValueError:
        return await _respond(writer, 400, {"error": "content-length required"})
    if not 0 <= length <= MAX_BODY:
        return await _respond(writer, 413, {"error": "too large"})
    try:
        body = await asyncio.wait_for(reader.readexactly(length), timeout=30)
    except (asyncio.IncompleteReadError, TimeoutError):
        writer.close()
        return
    loop = asyncio.get_running_loop()
    try:
        status, out = await loop.run_in_executor(None, handle_delivery, state, m.group(1),
                                                 headers.get("x-github-event", ""), headers.get("x-hub-signature-256", ""), body)
    except Exception:
        log.exception("webhook delivery failed")
        status, out = 503, {"error": "deploy could not start"}
    await _respond(writer, status, out)


async def serve(state: Any) -> asyncio.AbstractServer | None:
    try:
        server = await asyncio.start_server(lambda r, w: _handle(state, r, w), HOOK_HOST, HOOK_PORT, limit=MAX_HEADERS)
    except OSError as e:
        log.warning("webhook listener not started (%s:%d): %s", HOOK_HOST, HOOK_PORT, e)
        return None
    log.info("webhooks: http://%s:%d/github/<app>", HOOK_HOST, HOOK_PORT)
    return server
