from mirkomil.checks import evaluate, health_score, worst
from mirkomil.config import Thresholds

TH = Thresholds()


def by_id(results):
    return {r.id: r for r in results}


def test_healthy_server_scores_100():
    r = evaluate({"disk_pct": 40, "mem_pct": 50, "load1": 0.3, "cores": 4, "internet": True,
                  "dns": True, "failed_units": [], "updates": (0, 0)}, TH)
    assert worst(r) == "ok"
    assert health_score(r) == 100


def test_disk_thresholds():
    assert by_id(evaluate({"disk_pct": 86}, TH))["disk"].severity == "warn"
    assert by_id(evaluate({"disk_pct": 96}, TH))["disk"].severity == "crit"


def test_dns_not_reported_when_internet_down():
    r = by_id(evaluate({"internet": False, "dns": False}, TH))
    assert r["internet"].severity == "crit"
    assert "dns" not in r


def test_missing_facts_are_skipped():
    # e.g. a VM without temperature sensors
    assert "temperature" not in by_id(evaluate({"disk_pct": 10}, TH))


def test_security_updates_warn():
    r = by_id(evaluate({"updates": (5, 2)}, TH))
    assert r["updates"].severity == "warn"
    assert "2" in r["updates"].title


def test_score_never_negative():
    r = evaluate({"disk_pct": 99, "mem_pct": 99, "internet": False, "failed_units": ["a.service"],
                  "temp": 99, "reboot_required": True, "updates": (1, 1), "load1": 50, "cores": 1}, TH)
    assert health_score(r) == 0
