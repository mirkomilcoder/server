from mirkomil.checks import CheckResult
from mirkomil.rules import RuleEngine


class Store(dict):
    def get(self, k, d=None):
        return super().get(k, d)

    def put(self, k, v):
        self[k] = v


class Clock:
    def __init__(self):
        self.t = 1_000_000.0

    def __call__(self):
        return self.t


def engine(mode="auto"):
    calls = []
    store, clock = Store(), Clock()
    e = RuleEngine(store, lambda verb, args: calls.append((verb, args)) or "done", now=clock)
    e.set_mode(mode)
    return e, calls, clock


FAILED = [CheckResult("failed_units", "warn", "1 ta servis ishlamay qoldi")]
FACTS = {"failed_units": ["tailscaled.service"]}


def test_default_mode_is_dryrun_and_runs_nothing():
    e = RuleEngine(Store(), lambda *a: (_ for _ in ()).throw(AssertionError("must not run")))
    assert e.mode() == "dryrun"
    recs = e.evaluate(FAILED, FACTS)
    assert recs and all(r["result"] == "dryrun" for r in recs)


def test_restart_failed_unit_then_cooldown():
    e, calls, clock = engine()
    recs = e.evaluate(FAILED, FACTS)
    assert calls == [("unit.restart", {"unit": "tailscaled.service"})]
    assert recs[0]["result"] == "ok"
    clock.t += 60  # inside the 300 s cooldown
    e.evaluate(FAILED, FACTS)
    assert len(calls) == 1


def test_escalates_after_max_attempts_once():
    e, calls, clock = engine()
    for _ in range(3):
        e.evaluate(FAILED, FACTS)
        clock.t += 301
    recs = e.evaluate(FAILED, FACTS)
    assert len(calls) == 3
    assert [r["result"] for r in recs] == ["escalated"]
    clock.t += 301
    assert e.evaluate(FAILED, FACTS) == []  # no repeated escalation spam


def test_recovery_resets_state():
    e, calls, clock = engine()
    e.evaluate(FAILED, FACTS)
    e.evaluate([CheckResult("failed_units", "ok", "ok")], {"failed_units": []})
    clock.t += 301
    e.evaluate(FAILED, FACTS)
    assert len(calls) == 2


def test_sustain_delays_network_action():
    e, calls, clock = engine()
    down = [CheckResult("internet", "crit", "Internet yo'q")]
    e.evaluate(down, {})
    assert calls == []  # must be down for 180 s first
    clock.t += 181
    e.evaluate(down, {})
    assert calls[0][0] == "network.restart"


def test_reboot_rule_off_by_default():
    e, calls, clock = engine()
    down = [CheckResult("internet", "crit", "Internet yo'q")]
    e.evaluate(down, {})
    clock.t += 3600
    e.evaluate(down, {})
    assert ("system.reboot", {"reason": "internet down 15+ min"}) not in calls


def test_disk_cleanup_steps_escalate_in_order():
    e, calls, clock = engine()
    full = [CheckResult("disk", "warn", "Disk 90% band")]
    for _ in range(3):
        e.evaluate(full, {})
        clock.t += 1801
    assert [c[0] for c in calls] == ["apt.clean", "journal.vacuum", "docker.prune"]


def test_failed_action_is_reported_not_raised():
    store, clock = Store(), Clock()

    def boom(verb, args):
        raise RuntimeError("helper down")

    e = RuleEngine(store, boom, now=clock)
    e.set_mode("auto")
    recs = e.evaluate(FAILED, FACTS)
    assert recs[0]["result"] == "failed" and "helper down" in recs[0]["detail"]
