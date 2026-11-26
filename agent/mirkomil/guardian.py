"""Guardian: collects metrics, runs checks, records problems, sends alerts,
and serves the local API — one asyncio process running as user "mirkomil".

Self-healing rules live in rules.py; they start in dry-run mode until an
admin switches them to automatic from the panel.
"""

from __future__ import annotations

import asyncio
import logging
import os
import socket
import time
from pathlib import Path
from typing import Any

from . import collectors as c
from . import helper, telegram
from .api import build_api
from .checks import CheckResult, evaluate, health_score, worst
from .config import RUN, STATE, Config, load
from .db import DB
from .rules import RuleEngine

log = logging.getLogger("mirkomil.guardian")

# A check must be bad this many evaluations in a row before we alert (no flapping).
CONFIRM_BAD = 2


class GuardianState:
    def __init__(self, cfg: Config, db: DB):
        self.cfg = cfg
        self.db = db
        self.sampler = c.RateSampler()
        self.checks: list[CheckResult] = []
        self.latest: dict[str, Any] = {}
        self.slow: dict[str, Any] = {}  # facts refreshed less often
        self.started = int(time.time())
        self.bad_streak: dict[str, int] = {}
        self.rules = RuleEngine(db, helper.call)

    def snapshot(self) -> dict[str, Any]:
        return {
            "hostname": self.cfg.hostname,
            "brand": self.cfg.brand,
            "domain": self.cfg.domain,
            "time": int(time.time()),
            "started": self.started,
            "uptime": c.uptime_seconds(),
            "metrics": self.latest,
            "checks": [r.to_dict() for r in self.checks],
            "score": health_score(self.checks),
            "status": worst(self.checks),
            "telegram": self.cfg.telegram_enabled,
            "mode": self.rules.mode(),
            "ip": self.slow.get("ip"),
            "tailscale_ip": self.slow.get("tailscale_ip"),
            "os": c.os_pretty_name(),
        }

    def heal(self) -> None:
        """Run self-healing rules for the current check results; record + alert."""
        for rec in self.rules.evaluate(self.checks, self.facts()):
            sev = {"ok": "info", "dryrun": "info", "failed": "warn", "escalated": "crit"}[rec["result"]]
            label = {"ok": "Bajarildi", "dryrun": "Sinov rejimi", "failed": "Muvaffaqiyatsiz", "escalated": "Qo'lda tekshirish kerak"}[rec["result"]]
            target = rec.get("args", {}).get("unit", "")
            title = f"{label}: {rec['title']}" + (f" ({target})" if target else "")
            self.db.add_event("action", sev, title, rec.get("detail", ""), check_id=rec["rule"])
            if rec["result"] != "dryrun" and self.cfg.telegram_enabled:
                telegram.send(self.cfg.telegram_token, self.cfg.telegram_chat_id,
                              telegram.format_alert(self.cfg.brand, sev if sev != "info" else "ok", title, rec.get("detail", "")))

    # ---------- collection ----------

    def collect_fast(self) -> dict[str, Any]:
        s = self.sampler.sample()
        mem = c.meminfo()
        s.update({"cores": c.cpu_count(), "mem_total": mem["total"], "mem_used": mem["used"],
                  "swap_used": mem["swap_used"]})
        return s

    def collect_slow(self) -> dict[str, Any]:
        return {
            "internet": c.internet_ok(),
            "dns": c.dns_ok(),
            "failed_units": c.failed_units(),
            "tailscale": c.tailscale_state(),
            "reboot_required": c.reboot_required(),
            "ip": c.primary_ip(),
            "tailscale_ip": c.tailscale_ip(),
        }

    def facts(self) -> dict[str, Any]:
        f: dict[str, Any] = {
            "disk_pct": self.latest.get("disk"),
            "mem_pct": self.latest.get("mem"),
            "load1": self.latest.get("load1"),
            "cores": self.latest.get("cores"),
            "temp": self.latest.get("temp"),
        }
        f.update(self.slow)
        return {k: v for k, v in f.items() if v is not None}

    # ---------- problem tracking ----------

    def process_checks(self, results: list[CheckResult]) -> list[tuple[str, CheckResult]]:
        """Returns transitions to notify about: ('problem'|'recovered', result)."""
        prev: dict[str, str] = self.db.get("check_states", {})
        notify: list[tuple[str, CheckResult]] = []
        for r in results:
            was = prev.get(r.id, "ok")
            if r.severity in ("warn", "crit"):
                self.bad_streak[r.id] = self.bad_streak.get(r.id, 0) + 1
                if self.bad_streak[r.id] >= CONFIRM_BAD and was != r.severity:
                    prev[r.id] = r.severity
                    self.db.add_event("problem", r.severity, r.title, r.detail, check_id=r.id)
                    notify.append(("problem", r))
            else:
                self.bad_streak[r.id] = 0
                if was in ("warn", "crit"):
                    prev[r.id] = "ok"
                    self.db.add_event("recovered", "ok", f"Tuzaldi: {r.title}", check_id=r.id)
                    notify.append(("recovered", r))
        self.db.put("check_states", prev)
        self.checks = results
        return notify

    def alert(self, transitions: list[tuple[str, CheckResult]]) -> None:
        if not self.cfg.telegram_enabled:
            return
        for kind, r in transitions:
            sev = r.severity if kind == "problem" else "ok"
            title = r.title if kind == "problem" else f"Tuzaldi: {r.title}"
            telegram.send(self.cfg.telegram_token, self.cfg.telegram_chat_id,
                          telegram.format_alert(self.cfg.brand, sev, title, r.detail if kind == "problem" else ""))


async def run_loop(state: GuardianState, stop: asyncio.Event) -> None:
    loop = asyncio.get_running_loop()
    tick = 0
    last_prune = 0.0
    while not stop.is_set():
        try:
            fast = await loop.run_in_executor(None, state.collect_fast)
            state.latest = fast
            if fast.get("cpu") is not None:
                state.db.add_sample(int(time.time()), fast)
            if tick % 2 == 0:  # every ~60s
                state.slow.update(await loop.run_in_executor(None, state.collect_slow))
            if tick % 60 == 0:  # every ~30 min: apt list is slow-ish
                state.slow["updates"] = await loop.run_in_executor(None, c.upgradable_packages)
            transitions = state.process_checks(evaluate(state.facts(), state.cfg.thresholds))
            if transitions:
                await loop.run_in_executor(None, state.alert, transitions)
            await loop.run_in_executor(None, state.heal)
            if time.time() - last_prune > 3600:
                state.db.prune(state.cfg.retention_days)
                last_prune = time.time()
        except Exception:
            log.exception("guardian tick failed")
        tick += 1
        try:
            await asyncio.wait_for(stop.wait(), timeout=state.cfg.sample_interval)
        except TimeoutError:
            pass


async def serve(socket_path: Path, state: GuardianState) -> asyncio.AbstractServer:
    api = build_api(state)
    socket_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        socket_path.unlink()
    except FileNotFoundError:
        pass
    server = await asyncio.start_unix_server(api.handle, path=str(socket_path))
    # Any local user may connect; every request is authorised by peer uid (auth.py).
    os.chmod(socket_path, 0o666)
    return server


def systemd_notify(msg: str) -> None:
    """sd_notify without libsystemd (Type=notify readiness + watchdog)."""
    addr = os.environ.get("NOTIFY_SOCKET")
    if not addr:
        return
    if addr.startswith("@"):
        addr = "\0" + addr[1:]
    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as s:
        s.connect(addr)
        s.sendall(msg.encode())


async def main_async() -> None:
    cfg = load()
    STATE.mkdir(parents=True, exist_ok=True)
    db = DB(STATE / "guardian.db")
    state = GuardianState(cfg, db)
    db.add_event("info", "info", "Guardian ishga tushdi")
    server = await serve(RUN / "api.sock", state)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    import signal
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    systemd_notify("READY=1")
    log.info("guardian ready: %s", RUN / "api.sock")

    async def watchdog() -> None:
        while not stop.is_set():
            systemd_notify("WATCHDOG=1")
            await asyncio.sleep(20)

    async with server:
        await asyncio.gather(run_loop(state, stop), watchdog())
    db.add_event("info", "info", "Guardian to'xtadi")
