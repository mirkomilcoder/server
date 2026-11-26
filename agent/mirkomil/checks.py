"""Health checks → list of CheckResult. Pure evaluation lives in `evaluate()`
so it can be unit-tested with fake facts.

Messages are in plain Uzbek: they go to the panel and to Telegram as-is.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from .config import Thresholds

SEVERITY_ORDER = {"ok": 0, "info": 1, "warn": 2, "crit": 3}


@dataclass
class CheckResult:
    id: str
    severity: str  # ok | warn | crit
    title: str
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def evaluate(f: dict[str, Any], th: Thresholds) -> list[CheckResult]:
    """`f` = facts gathered by gather_facts(). Missing facts → check skipped."""
    out: list[CheckResult] = []

    disk = f.get("disk_pct")
    if disk is not None:
        sev = "crit" if disk >= th.disk_crit_pct else "warn" if disk >= th.disk_warn_pct else "ok"
        out.append(CheckResult("disk", sev, f"Disk {disk:.0f}% band",
                               "" if sev == "ok" else "Joy tugayapti: eski loglar, apt kesh va Docker obrazlarini tozalash kerak."))

    mem = f.get("mem_pct")
    if mem is not None:
        sev = "warn" if mem >= th.mem_warn_pct else "ok"
        out.append(CheckResult("memory", sev, f"Xotira {mem:.0f}% band",
                               "" if sev == "ok" else "Xotira deyarli to'lgan. Eng ko'p xotira yeyotgan ilovani tekshiring."))

    load, cores = f.get("load1"), f.get("cores") or 1
    if load is not None:
        sev = "warn" if load / cores >= th.load_warn_per_core else "ok"
        out.append(CheckResult("load", sev, f"Yuklama {load:.2f} ({cores} yadro)"))

    temp = f.get("temp")
    if temp is not None:
        sev = "crit" if temp >= th.temp_crit_c else "warn" if temp >= th.temp_warn_c else "ok"
        out.append(CheckResult("temperature", sev, f"Harorat {temp:.0f}°C",
                               "" if sev == "ok" else "Protsessor qizib ketgan: ventilyator va havo aylanishini tekshiring."))

    if "internet" in f:
        out.append(CheckResult("internet", "ok" if f["internet"] else "crit",
                               "Internet bor" if f["internet"] else "Internet yo'q",
                               "" if f["internet"] else "1.1.1.1, 8.8.8.8 va 9.9.9.9 ga ulanib bo'lmadi."))
    if "dns" in f and f.get("internet", True):
        out.append(CheckResult("dns", "ok" if f["dns"] else "warn",
                               "DNS ishlayapti" if f["dns"] else "DNS ishlamayapti",
                               "" if f["dns"] else "Internet bor, lekin domen nomlari ochilmayapti."))

    failed = f.get("failed_units")
    if failed is not None:
        out.append(CheckResult("failed_units", "warn" if failed else "ok",
                               f"{len(failed)} ta servis ishlamay qoldi" if failed else "Barcha servislar ishlayapti",
                               ", ".join(failed[:10])))

    ts = f.get("tailscale")
    if ts is not None:
        out.append(CheckResult("tailscale", "ok" if ts == "Running" else "warn",
                               "Tailscale ulangan" if ts == "Running" else f"Tailscale ulanmagan ({ts})"))

    up = f.get("updates")
    if up is not None:
        total, sec = up
        out.append(CheckResult("updates", "warn" if sec else "ok",
                               f"{sec} ta xavfsizlik yangilanishi kutmoqda" if sec else
                               (f"{total} ta yangilanish bor" if total else "Tizim yangi"),
                               "Unattended-upgrades ularni avtomatik o'rnatadi." if sec else ""))

    if f.get("reboot_required"):
        out.append(CheckResult("reboot", "warn", "Qayta yoqish talab qilinadi",
                               "Yangilangan yadro/kutubxonalar qayta yoqilgandan keyin ishlaydi."))
    return out


def health_score(results: list[CheckResult]) -> int:
    """100 minus penalties: warn −8, crit −25 (min 0)."""
    score = 100
    for r in results:
        score -= {"warn": 8, "crit": 25}.get(r.severity, 0)
    return max(0, score)


def worst(results: list[CheckResult]) -> str:
    return max((r.severity for r in results), key=lambda s: SEVERITY_ORDER[s], default="ok")
