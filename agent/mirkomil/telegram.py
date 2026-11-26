"""Telegram alerts (optional). Uses the Bot API over HTTPS; token never logged."""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request

log = logging.getLogger("mirkomil.telegram")

ICONS = {"crit": "🔴", "warn": "🟡", "ok": "🟢", "info": "ℹ️"}


def format_alert(hostname: str, severity: str, title: str, detail: str = "") -> str:
    # Telegram is a chat, not the panel UI, so status emoji are fine here.
    text = f"{ICONS.get(severity, '•')} {hostname}: {title}"
    if detail:
        text += f"\n{detail}"
    return text[:4000]


def send(token: str, chat_id: str, text: str, timeout: float = 10) -> bool:
    if not token or not chat_id:
        return False
    data = json.dumps({"chat_id": chat_id, "text": text, "disable_web_page_preview": True}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status == 200
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        # never include the URL (it contains the token) in logs
        log.warning("telegram send failed: %s", type(e).__name__)
        return False
