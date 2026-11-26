"""Self-healing rules: condition → action → cooldown → max attempts → escalate.

Safety model
------------
* Global mode: "dryrun" (default after install: log what WOULD happen) or "auto".
* Each rule can be switched off; risky rules (reboot) are off by default.
* Actions go through the root helper's fixed verbs only.
* Never destructive on data: no volume/database/user-file deletion anywhere.
* Every decision is an event (kind="action") with who/what/why/result.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable

from .checks import CheckResult

# action runner signature: (verb, args) -> output; raises on failure
Runner = Callable[[str, dict[str, Any]], Any]


@dataclass
class Rule:
    id: str
    title: str  # Uzbek, shown in panel + Telegram
    check: str  # CheckResult.id that triggers it
    severities: tuple[str, ...]
    steps: list[tuple[str, dict[str, Any]]]  # helper verbs, tried in order on successive attempts
    cooldown_s: int = 600
    max_attempts: int = 3  # per window, then escalate
    window_s: int = 3600
    sustain_s: int = 0  # condition must hold this long before acting
    default_enabled: bool = True
    risky: bool = False
    # filled per evaluation (e.g. the failed unit names)
    dynamic_args: Callable[[CheckResult, dict[str, Any]], list[dict[str, Any]]] | None = field(default=None, repr=False)


def _failed_unit_args(_r: CheckResult, facts: dict[str, Any]) -> list[dict[str, Any]]:
    return [{"unit": u} for u in facts.get("failed_units", []) if u.endswith(".service")][:5]


RULES: list[Rule] = [
    Rule("restart-failed", "Ishlamay qolgan servisni qayta ishga tushirish", "failed_units", ("warn", "crit"),
         steps=[("unit.restart", {})], cooldown_s=300, max_attempts=3, dynamic_args=_failed_unit_args),
    Rule("disk-cleanup", "Diskni tozalash (apt kesh, jurnal, eski Docker obrazlari)", "disk", ("warn", "crit"),
         steps=[("apt.clean", {}), ("journal.vacuum", {"size": "500M"}), ("docker.prune", {})],
         cooldown_s=1800, max_attempts=3, window_s=6 * 3600),
    Rule("tailscale-restart", "Tailscale'ni qayta ulash", "tailscale", ("warn",),
         steps=[("unit.restart", {"unit": "tailscaled.service"})], cooldown_s=600, sustain_s=120),
    Rule("network-recover", "Internet uzildi: tarmoqni qayta ishga tushirish", "internet", ("crit",),
         steps=[("network.restart", {}), ("unit.restart", {"unit": "tailscaled.service"})],
         cooldown_s=300, max_attempts=2, sustain_s=180),
    Rule("network-reboot", "Internet uzoq vaqt yo'q: serverni qayta yoqish", "internet", ("crit",),
         steps=[("system.reboot", {"reason": "internet down 15+ min"})],
         cooldown_s=6 * 3600, max_attempts=1, window_s=6 * 3600, sustain_s=900,
         default_enabled=False, risky=True),
]

RULES_BY_ID = {r.id: r for r in RULES}


class RuleEngine:
    """Stateful evaluator. Persists its state through the `store` (DB kv)."""

    def __init__(self, store: Any, runner: Runner, now: Callable[[], float] = time.time):
        self.store = store
        self.run = runner
        self.now = now

    # ---- settings ----
    def mode(self) -> str:
        return self.store.get("guardian_mode", "dryrun")

    def set_mode(self, mode: str) -> None:
        if mode not in ("dryrun", "auto"):
            raise ValueError("mode must be dryrun or auto")
        self.store.put("guardian_mode", mode)

    def enabled(self, rule: Rule) -> bool:
        return self.store.get("rule_enabled", {}).get(rule.id, rule.default_enabled)

    def set_enabled(self, rule_id: str, on: bool) -> None:
        if rule_id not in RULES_BY_ID:
            raise KeyError(rule_id)
        cur = self.store.get("rule_enabled", {})
        cur[rule_id] = bool(on)
        self.store.put("rule_enabled", cur)

    def describe(self) -> list[dict[str, Any]]:
        st = self.store.get("rule_state", {})
        return [{
            "id": r.id, "title": r.title, "enabled": self.enabled(r), "risky": r.risky,
            "cooldown_s": r.cooldown_s, "max_attempts": r.max_attempts,
            "last_action": st.get(r.id, {}).get("last", 0),
            "attempts": len(st.get(r.id, {}).get("attempts", [])),
        } for r in RULES]

    # ---- evaluation ----
    def evaluate(self, results: list[CheckResult], facts: dict[str, Any]) -> list[dict[str, Any]]:
        """Returns the list of action records produced this round (for events/alerts)."""
        now = self.now()
        by_id = {r.id: r for r in results}
        st: dict[str, dict[str, Any]] = self.store.get("rule_state", {})
        records: list[dict[str, Any]] = []

        for rule in RULES:
            rs = st.setdefault(rule.id, {"since": 0, "last": 0, "attempts": [], "escalated": False})
            res = by_id.get(rule.check)
            bad = res is not None and res.severity in rule.severities
            if not bad:
                rs.update(since=0, attempts=[], escalated=False)
                continue
            if not rs["since"]:
                rs["since"] = now
            if not self.enabled(rule):
                continue
            if now - rs["since"] < rule.sustain_s or now - rs["last"] < rule.cooldown_s:
                continue
            rs["attempts"] = [t for t in rs["attempts"] if now - t < rule.window_s]
            if len(rs["attempts"]) >= rule.max_attempts:
                if not rs["escalated"]:
                    rs["escalated"] = True
                    records.append({"rule": rule.id, "title": rule.title, "result": "escalated",
                                    "detail": f"{rule.max_attempts} urinishdan keyin ham tuzalmadi — qo'lda tekshirish kerak."})
                continue

            step_verb, step_args = rule.steps[min(len(rs["attempts"]), len(rule.steps) - 1)]
            arg_list = rule.dynamic_args(res, facts) if rule.dynamic_args else [step_args]
            rs["last"] = now
            rs["attempts"].append(now)
            for args in arg_list or [step_args]:
                rec = {"rule": rule.id, "title": rule.title, "verb": step_verb, "args": args}
                if self.mode() != "auto":
                    rec.update(result="dryrun", detail=f"Sinov rejimi: '{step_verb}' bajarilmadi")
                else:
                    try:
                        out = self.run(step_verb, args)
                        rec.update(result="ok", detail=str(out)[:500] if out else "")
                    except Exception as e:  # report, never crash the loop
                        rec.update(result="failed", detail=str(e)[:500])
                records.append(rec)

        self.store.put("rule_state", st)
        return records
