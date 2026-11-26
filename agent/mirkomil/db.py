"""SQLite storage: metric samples, events (problems / recoveries / actions).

One small file in /var/lib/mirkomil/guardian.db, WAL mode so the API can read
while the collector writes.
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS samples (
  ts     INTEGER PRIMARY KEY,   -- unix seconds
  cpu    REAL, mem REAL, disk REAL, load1 REAL,
  rx_bps REAL, tx_bps REAL, temp REAL
);
CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,
  kind    TEXT NOT NULL,        -- problem | recovered | action | info
  check_id TEXT,
  severity TEXT NOT NULL,       -- ok | warn | crit | info
  title   TEXT NOT NULL,
  detail  TEXT,
  actor   TEXT                  -- 'guardian' or a username
);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
"""

METRICS = ("cpu", "mem", "disk", "load1", "rx_bps", "tx_bps", "temp")


class DB:
    def __init__(self, path: Path | str):
        self.path = str(path)
        self.conn = sqlite3.connect(self.path, timeout=5, isolation_level=None, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.executescript(SCHEMA)

    # ---- samples ----
    def add_sample(self, ts: int, values: dict[str, float | None]) -> None:
        cols = ", ".join(METRICS)
        marks = ", ".join("?" for _ in METRICS)
        self.conn.execute(
            f"INSERT OR REPLACE INTO samples (ts, {cols}) VALUES (?, {marks})",
            (ts, *(values.get(m) for m in METRICS)),
        )

    def history(self, metric: str, since: int, buckets: int = 240) -> list[tuple[int, float]]:
        """Average of `metric` in `buckets` equal time slices since `since`."""
        if metric not in METRICS:
            raise ValueError(f"unknown metric {metric!r}")
        now = int(time.time())
        width = max(1, (now - since) // max(1, buckets))
        # The point's time is the mean time of its samples (not the bucket start),
        # so wide buckets don't shift recent data into the past on the chart.
        rows = self.conn.execute(
            f"SELECT AVG(ts) AS t, AVG({metric}) AS v FROM samples "
            f"WHERE ts >= ? AND {metric} IS NOT NULL GROUP BY ts / ? ORDER BY t",
            (since, width),
        ).fetchall()
        return [(int(r["t"]), round(float(r["v"]), 3)) for r in rows]

    def latest_sample(self) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM samples ORDER BY ts DESC LIMIT 1").fetchone()
        return dict(row) if row else None

    def prune(self, keep_days: int) -> None:
        cutoff = int(time.time()) - keep_days * 86400
        self.conn.execute("DELETE FROM samples WHERE ts < ?", (cutoff,))
        # events are small; keep 90 days of timeline
        self.conn.execute("DELETE FROM events WHERE ts < ?", (int(time.time()) - 90 * 86400,))

    # ---- events ----
    def add_event(self, kind: str, severity: str, title: str, detail: str = "",
                  check_id: str | None = None, actor: str = "guardian", ts: int | None = None) -> int:
        cur = self.conn.execute(
            "INSERT INTO events (ts, kind, check_id, severity, title, detail, actor) VALUES (?,?,?,?,?,?,?)",
            (ts or int(time.time()), kind, check_id, severity, title, detail[:4000], actor),
        )
        return int(cur.lastrowid or 0)

    def events(self, limit: int = 100, before: int | None = None) -> list[dict[str, Any]]:
        limit = max(1, min(500, limit))
        if before:
            rows = self.conn.execute("SELECT * FROM events WHERE id < ? ORDER BY id DESC LIMIT ?", (before, limit))
        else:
            rows = self.conn.execute("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,))
        return [dict(r) for r in rows.fetchall()]

    # ---- small key/value state (e.g. last known check states) ----
    def get(self, key: str, default: Any = None) -> Any:
        row = self.conn.execute("SELECT v FROM kv WHERE k = ?", (key,)).fetchone()
        return json.loads(row["v"]) if row else default

    def put(self, key: str, value: Any) -> None:
        self.conn.execute("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", (key, json.dumps(value)))
