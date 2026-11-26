"""Configuration: /etc/mirkomil/config.env (+ secrets.env, root-only).

Same KEY="value" format the installer writes. Parsed, never executed.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

ETC = Path(os.environ.get("MK_ETC", "/etc/mirkomil"))
STATE = Path(os.environ.get("MK_STATE", "/var/lib/mirkomil"))
RUN = Path(os.environ.get("MK_RUN", "/run/mirkomil"))

_LINE = re.compile(r"^([A-Z][A-Z0-9_]*)=(.*)$")


def parse_env_file(path: Path) -> dict[str, str]:
    """KEY="value" lines → dict. Comments/blank lines skipped, quotes stripped."""
    out: dict[str, str] = {}
    try:
        text = path.read_text(encoding="utf-8")
    except (FileNotFoundError, PermissionError):
        return out
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = _LINE.match(line)
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        out[key] = val
    return out


@dataclass
class Thresholds:
    disk_warn_pct: float = 85.0
    disk_crit_pct: float = 95.0
    mem_warn_pct: float = 90.0
    load_warn_per_core: float = 2.0
    temp_warn_c: float = 80.0
    temp_crit_c: float = 92.0


@dataclass
class Config:
    hostname: str = "server"
    domain: str = "mirkomil-host.uz"
    admin_user: str = ""
    telegram_token: str = ""
    telegram_chat_id: str = ""
    sample_interval: int = 30
    retention_days: int = 8
    thresholds: Thresholds = field(default_factory=Thresholds)

    @property
    def telegram_enabled(self) -> bool:
        return bool(self.telegram_token and self.telegram_chat_id)


def load(etc: Path = ETC) -> Config:
    env = parse_env_file(etc / "config.env")
    # Guardian's own secrets file (root:mirkomil 0640) — it can't read secrets.env.
    sec = parse_env_file(etc / "guardian.env")
    cfg = Config(
        hostname=env.get("MK_HOSTNAME", "server"),
        domain=env.get("MK_DOMAIN", "mirkomil-host.uz"),
        admin_user=env.get("MK_ADMIN_USER", ""),
        telegram_chat_id=env.get("TELEGRAM_CHAT_ID", ""),
        telegram_token=sec.get("TELEGRAM_BOT_TOKEN", "") if env.get("MK_TELEGRAM", "no") == "yes" else "",
    )
    try:
        cfg.sample_interval = max(10, min(300, int(env.get("MK_SAMPLE_INTERVAL", "30"))))
    except ValueError:
        pass
    return cfg
