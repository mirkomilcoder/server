"""Local HTTP/JSON API on a Unix socket (/run/mirkomil/api.sock).

The panel calls it with cockpit.http("/run/mirkomil/api.sock"). There is no
TCP port. Every request is authorised from the caller's kernel-verified uid
(see auth.py), so roles are enforced HERE, not only in the UI.

Deliberately tiny HTTP/1.1: GET/POST, Content-Length bodies, one request per
connection (Connection: close).
"""

from __future__ import annotations

import asyncio
import re
import json
import logging
import time
from typing import Any, Awaitable, Callable
from urllib.parse import parse_qs, urlsplit

from . import __version__
from .auth import Peer, identify, peer_uid

log = logging.getLogger("mirkomil.api")

MAX_HEADER = 16 * 1024
MAX_BODY = 256 * 1024

Handler = Callable[[Peer, dict[str, str], Any], Awaitable[Any]]


class HttpError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


REASONS = {200: "OK", 400: "Bad Request", 403: "Forbidden", 404: "Not Found",
           405: "Method Not Allowed", 413: "Payload Too Large", 500: "Internal Server Error"}


class Api:
    def __init__(self) -> None:
        self.routes: dict[tuple[str, str], tuple[str, Handler]] = {}

    def route(self, method: str, path: str, role: str = "viewer"):
        def deco(fn: Handler) -> Handler:
            self.routes[(method, path)] = (role, fn)
            return fn
        return deco

    def _match(self, method: str | None, path: str) -> tuple[tuple[str, Handler] | None, dict[str, str]]:
        """Exact routes first, then patterns like /v1/apps/{name}/deploy ({x} = one safe path segment)."""
        if method and (method, path) in self.routes:
            return self.routes[(method, path)], {}
        parts = path.strip("/").split("/")
        for (m, pattern), found in self.routes.items():
            if method and m != method:
                continue
            pp = pattern.strip("/").split("/")
            if len(pp) != len(parts):
                continue
            params: dict[str, str] = {}
            for want, got in zip(pp, parts):
                if want.startswith("{") and want.endswith("}"):
                    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", got):
                        break
                    params[want[1:-1]] = got
                elif want != got:
                    break
            else:
                return found, params
        return None, {}

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        status, payload = 500, {"error": "internal"}
        try:
            sock = writer.get_extra_info("socket")
            peer = identify(peer_uid(sock))
            status, payload = await self._dispatch(peer, reader)
        except HttpError as e:
            status, payload = e.status, {"error": e.message}
        except Exception:  # never leak tracebacks to clients
            log.exception("request failed")
        body = json.dumps(payload, ensure_ascii=False).encode()
        head = (f"HTTP/1.1 {status} {REASONS.get(status, 'Error')}\r\n"
                f"Content-Type: application/json; charset=utf-8\r\n"
                f"Content-Length: {len(body)}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n")
        try:
            writer.write(head.encode() + body)
            await writer.drain()
        finally:
            writer.close()

    async def _dispatch(self, peer: Peer, reader: asyncio.StreamReader) -> tuple[int, Any]:
        try:
            raw = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=10)
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, TimeoutError):
            raise HttpError(400, "bad request")
        if len(raw) > MAX_HEADER:
            raise HttpError(400, "headers too large")
        lines = raw.decode("latin-1").split("\r\n")
        try:
            method, target, _ver = lines[0].split(" ", 2)
        except ValueError:
            raise HttpError(400, "bad request line")
        headers = {k.strip().lower(): v.strip() for k, _, v in (l.partition(":") for l in lines[1:] if l)}

        body: Any = None
        length = int(headers.get("content-length", "0") or 0)
        if length:
            if length > MAX_BODY:
                raise HttpError(413, "body too large")
            data = await asyncio.wait_for(reader.readexactly(length), timeout=10)
            try:
                body = json.loads(data)
            except ValueError:
                raise HttpError(400, "body must be JSON")

        url = urlsplit(target)
        query = {k: v[-1] for k, v in parse_qs(url.query).items()}
        found, params = self._match(method, url.path)
        if not found:
            if self._match(None, url.path)[0]:
                raise HttpError(405, "method not allowed")
            raise HttpError(404, "not found")
        query.update(params)  # path parameters ({name}) are passed like query params
        role, fn = found
        if not peer.at_least(role):
            log.warning("denied %s %s for %s (role %s)", method, url.path, peer.user, peer.role)
            raise HttpError(403, f"ruxsat yo'q: '{role}' roli kerak")
        return 200, await fn(peer, query, body)


def build_api(state: "GuardianState") -> Api:  # noqa: F821 (forward ref, see guardian.py)
    api = Api()

    @api.route("GET", "/v1/health", role="none")
    async def health(_p: Peer, _q: dict[str, str], _b: Any) -> Any:
        return {"ok": True, "version": __version__, "time": int(time.time())}

    @api.route("GET", "/v1/me", role="none")
    async def me(p: Peer, _q: dict[str, str], _b: Any) -> Any:
        return {"user": p.user, "uid": p.uid, "role": p.role, "groups": list(p.groups)}

    @api.route("GET", "/v1/status")
    async def status(_p: Peer, _q: dict[str, str], _b: Any) -> Any:
        return state.snapshot()

    @api.route("GET", "/v1/history")
    async def history(_p: Peer, q: dict[str, str], _b: Any) -> Any:
        ranges = {"1h": 3600, "24h": 86400, "7d": 7 * 86400}
        rng = q.get("range", "1h")
        if rng not in ranges:
            raise HttpError(400, "range: 1h | 24h | 7d")
        metrics = [m for m in q.get("metrics", "cpu,mem").split(",") if m]
        since = int(time.time()) - ranges[rng]
        try:
            return {"range": rng, "series": {m: state.db.history(m, since) for m in metrics[:7]}}
        except ValueError as e:
            raise HttpError(400, str(e))

    @api.route("GET", "/v1/events")
    async def events(_p: Peer, q: dict[str, str], _b: Any) -> Any:
        try:
            limit = int(q.get("limit", "100"))
            before = int(q["before"]) if "before" in q else None
        except ValueError:
            raise HttpError(400, "limit/before must be numbers")
        return {"events": state.db.events(limit, before)}

    @api.route("POST", "/v1/identity", role="admin")
    async def identity(p: Peer, _q: dict[str, str], b: Any) -> Any:
        """Rename the server / change the hosting domain everywhere (login page, panel, alerts)."""
        from .config import valid_brand, valid_domain
        from . import helper
        if not isinstance(b, dict):
            raise HttpError(400, "JSON object expected")
        brand, domain = str(b.get("brand", "")).strip(), str(b.get("domain", "")).strip().lower()
        if not valid_brand(brand):
            raise HttpError(400, "brand: 2–40 belgi; qo'shtirnoq, \\ < > { } ; ` $ belgilari mumkin emas")
        if not valid_domain(domain):
            raise HttpError(400, "domain: masalan mirkomil-host.uz")
        loop = asyncio.get_running_loop()
        try:
            await loop.run_in_executor(None, lambda: helper.call("identity.apply", {"brand": brand, "domain": domain}, timeout=300))
        except helper.VerbError as e:
            raise HttpError(500, f"qo'llab bo'lmadi: {e}")
        old = (state.cfg.brand, state.cfg.domain)
        state.cfg.brand, state.cfg.domain = brand, domain
        state.db.add_event("action", "info", f"Server nomi/domeni o'zgartirildi: {old[0]} → {brand}, {old[1]} → {domain}", actor=p.user)
        return {"brand": brand, "domain": domain}

    from .paas.api_apps import register as register_apps
    register_apps(api, state)

    @api.route("GET", "/v1/rules")
    async def rules_get(_p: Peer, _q: dict[str, str], _b: Any) -> Any:
        return {"mode": state.rules.mode(), "rules": state.rules.describe()}

    @api.route("POST", "/v1/rules", role="admin")
    async def rules_set(p: Peer, _q: dict[str, str], b: Any) -> Any:
        if not isinstance(b, dict):
            raise HttpError(400, "JSON object expected")
        try:
            if "mode" in b:
                state.rules.set_mode(str(b["mode"]))
                state.db.add_event("action", "info", f"Avtomatik tuzatish rejimi: {b['mode']}", actor=p.user)
            if "rule" in b:
                state.rules.set_enabled(str(b["rule"]), bool(b.get("enabled")))
                word = "yoqildi" if b.get("enabled") else "o'chirildi"
                state.db.add_event("action", "info", f"Qoida {word}: {b['rule']}", actor=p.user)
        except (ValueError, KeyError) as e:
            raise HttpError(400, f"invalid: {e}")
        return {"mode": state.rules.mode(), "rules": state.rules.describe()}

    return api
