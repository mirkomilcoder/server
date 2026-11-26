"""Read-only system collectors. Everything here works as an unprivileged user.

Things that need root (docker, smartctl, fail2ban, ufw) are asked from the
root helper instead — see helper.py.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

PROC = Path(os.environ.get("MK_PROC", "/proc"))
SYS = Path(os.environ.get("MK_SYS", "/sys"))

VIRTUAL_IF = ("lo", "docker", "br-", "veth", "virbr", "tailscale", "vnet", "cni", "flannel")


# ---------------- CPU / memory / load / network ----------------

@dataclass
class CpuTimes:
    idle: int
    total: int


def read_cpu_times(text: str | None = None) -> CpuTimes:
    text = text if text is not None else (PROC / "stat").read_text()
    for line in text.splitlines():
        if line.startswith("cpu "):
            v = [int(x) for x in line.split()[1:9]]
            return CpuTimes(idle=v[3] + v[4], total=sum(v))
    raise ValueError("no cpu line in /proc/stat")


def cpu_percent(prev: CpuTimes, cur: CpuTimes) -> float | None:
    dt = cur.total - prev.total
    if dt <= 0:
        return None
    return max(0.0, min(100.0, (1 - (cur.idle - prev.idle) / dt) * 100))


def cpu_count() -> int:
    return os.cpu_count() or 1


def meminfo(text: str | None = None) -> dict[str, int]:
    """Bytes. Keys: total, available, used, swap_total, swap_used."""
    text = text if text is not None else (PROC / "meminfo").read_text()
    kv: dict[str, int] = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0].endswith(":"):
            kv[parts[0][:-1]] = int(parts[1]) * 1024
    total = kv.get("MemTotal", 0)
    avail = kv.get("MemAvailable", 0)
    return {
        "total": total,
        "available": avail,
        "used": total - avail,
        "swap_total": kv.get("SwapTotal", 0),
        "swap_used": kv.get("SwapTotal", 0) - kv.get("SwapFree", 0),
    }


def loadavg() -> tuple[float, float, float]:
    a, b, c = (PROC / "loadavg").read_text().split()[:3]
    return float(a), float(b), float(c)


def net_bytes(text: str | None = None) -> tuple[int, int]:
    """Total rx/tx bytes over physical interfaces (virtual bridges excluded)."""
    text = text if text is not None else (PROC / "net" / "dev").read_text()
    rx = tx = 0
    for line in text.splitlines()[2:]:
        if ":" not in line:
            continue
        name, rest = line.split(":", 1)
        if name.strip().startswith(VIRTUAL_IF):
            continue
        f = rest.split()
        rx += int(f[0])
        tx += int(f[8])
    return rx, tx


def disk_usage(path: str = "/") -> dict[str, float]:
    u = shutil.disk_usage(path)
    return {"total": u.total, "used": u.used, "free": u.free, "pct": u.used / u.total * 100 if u.total else 0.0}


def uptime_seconds() -> float:
    return float((PROC / "uptime").read_text().split()[0])


# ---------------- temperature ----------------

def max_temperature_c() -> float | None:
    """Highest CPU-ish temperature from /sys/class/thermal or hwmon; None if no sensors (VMs)."""
    temps: list[float] = []
    for zone in (SYS / "class" / "thermal").glob("thermal_zone*"):
        try:
            kind = (zone / "type").read_text().strip().lower()
            if kind.startswith(("acpitz", "x86_pkg_temp", "cpu", "soc", "coretemp", "k10temp")):
                temps.append(int((zone / "temp").read_text()) / 1000)
        except (OSError, ValueError):
            continue
    for f in (SYS / "class" / "hwmon").glob("hwmon*/temp*_input"):
        try:
            name = (f.parent / "name").read_text().strip().lower()
            if name in ("coretemp", "k10temp", "zenpower", "cpu_thermal", "nvme"):
                temps.append(int(f.read_text()) / 1000)
        except (OSError, ValueError):
            continue
    temps = [t for t in temps if 0 < t < 150]
    return max(temps) if temps else None


# ---------------- connectivity ----------------

def tcp_ok(host: str, port: int, timeout: float = 3.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def dns_ok(name: str = "archive.ubuntu.com", timeout: float = 4.0) -> bool:
    with ThreadPoolExecutor(max_workers=1) as ex:
        fut = ex.submit(socket.getaddrinfo, name, 443)
        try:
            return bool(fut.result(timeout=timeout))
        except Exception:
            return False


def internet_ok() -> bool:
    """Reachable if ANY of several well-known anycast endpoints answers."""
    return any(tcp_ok(h, p) for h, p in (("1.1.1.1", 443), ("8.8.8.8", 443), ("9.9.9.9", 443)))


# ---------------- systemd / apt ----------------

def _run(argv: list[str], timeout: float = 15) -> str:
    """Run a fixed argv (never a shell); return stdout or '' on failure."""
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False).stdout
    except (OSError, subprocess.TimeoutExpired):
        return ""


def failed_units() -> list[str]:
    out = _run(["systemctl", "--failed", "--no-legend", "--plain", "--type=service"])
    return [line.split()[0] for line in out.splitlines() if line.strip()]


def unit_active(unit: str) -> str:
    return _run(["systemctl", "is-active", unit]).strip() or "unknown"


def upgradable_packages() -> tuple[int, int]:
    """(total upgradable, security) from apt's cached lists (no network, no root)."""
    out = _run(["apt", "list", "--upgradable"], timeout=60)
    lines = [l for l in out.splitlines() if "/" in l and "[upgradable" in l]
    sec = sum(1 for l in lines if "-security" in l.split()[0])
    return len(lines), sec


def reboot_required() -> bool:
    return Path("/run/reboot-required").exists()


def tailscale_state() -> str | None:
    if not shutil.which("tailscale"):
        return None
    import json
    out = _run(["tailscale", "status", "--json"], timeout=10)
    try:
        return json.loads(out).get("BackendState")
    except ValueError:
        return "Unknown"


class RateSampler:
    """Keeps previous counters to turn /proc totals into rates."""

    def __init__(self) -> None:
        self.prev_cpu: CpuTimes | None = None
        self.prev_net: tuple[float, int, int] | None = None

    def sample(self) -> dict[str, float | None]:
        cpu_now = read_cpu_times()
        cpu = cpu_percent(self.prev_cpu, cpu_now) if self.prev_cpu else None
        self.prev_cpu = cpu_now

        t = time.monotonic()
        rx, tx = net_bytes()
        rx_bps = tx_bps = None
        if self.prev_net:
            dt = t - self.prev_net[0]
            if dt > 0:
                rx_bps = max(0.0, (rx - self.prev_net[1]) * 8 / dt)
                tx_bps = max(0.0, (tx - self.prev_net[2]) * 8 / dt)
        self.prev_net = (t, rx, tx)

        mem = meminfo()
        return {
            "cpu": cpu,
            "mem": mem["used"] / mem["total"] * 100 if mem["total"] else None,
            "disk": disk_usage("/")["pct"],
            "load1": loadavg()[0],
            "rx_bps": rx_bps,
            "tx_bps": tx_bps,
            "temp": max_temperature_c(),
        }
