"""Local HTTP/JSON API on a Unix socket (/run/mirkomil/api.sock).

The panel calls it with cockpit.http("/run/mirkomil/api.sock"). There is no
TCP port. Every request is authorised from the caller's kernel-verified uid
(see auth.py), so roles are enforced HERE, not only in the UI.

Deliberately tiny HTTP/1.1: GET/POST, Content-Length bodies, one request per
connection (Connection: close).
"""

from __future__ import annotations

import asyncio
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
        found = self.routes.get((method, url.path))
        if not found:
            if any(p == url.path for (_m, p) in self.routes):
                raise HttpError(405, "method not allowed")
            raise HttpError(404, "not found")
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

    return api
