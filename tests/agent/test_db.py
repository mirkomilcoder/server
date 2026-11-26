import time

import pytest

from mirkomil.db import DB


def test_samples_history_and_prune(tmp_path):
    db = DB(tmp_path / "g.db")
    now = int(time.time())
    for i in range(10):
        db.add_sample(now - 600 + i * 60, {"cpu": float(i * 10), "mem": 50.0})
    db.add_sample(now - 30 * 86400, {"cpu": 1.0})  # very old
    hist = db.history("cpu", now - 3600, buckets=10)
    assert hist and all(0 <= v <= 90 for _, v in hist)
    db.prune(keep_days=8)
    assert all(ts > now - 9 * 86400 for ts, _ in db.history("cpu", 0, buckets=1000))


def test_history_rejects_unknown_metric(tmp_path):
    db = DB(tmp_path / "g.db")
    with pytest.raises(ValueError):
        db.history("cpu; DROP TABLE samples", 0)


def test_events_and_kv(tmp_path):
    db = DB(tmp_path / "g.db")
    db.add_event("problem", "warn", "Disk 90% band", check_id="disk")
    db.put("check_states", {"disk": "warn"})
    assert db.events()[0]["title"] == "Disk 90% band"
    assert db.get("check_states") == {"disk": "warn"}
