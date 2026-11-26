"""Panel users (Linux accounts). Runs as root in the helper.

Model
    A panel user is a normal Linux account (uid ≥ 1000) — Cockpit logs in with it.
    The role is ONE supplementary group: mirkomil-admin / mirkomil-dev / mirkomil-viewer.
    Members of "sudo" are owners: shown as admins, never changed from the panel.
    New users never get sudo, a password-less login or an SSH key.

Extra groups
    Besides the role, an admin may add a few harmless groups (EXTRA_GROUPS, e.g. read
    system logs). Root-equivalent groups (sudo, docker, lxd, disk, shadow…) can never
    be granted from the panel.

/etc is read-only inside the helper's sandbox, so account changes run through
`systemd-run --wait --pipe` (a one-off unit outside the sandbox) — fixed argv only.
"""

from __future__ import annotations

import grp
import os
import pwd
import re
import secrets
import subprocess
from pathlib import Path
from typing import Any, Callable

USER_RE = re.compile(r"^[a-z][a-z0-9_-]{1,30}$")
COMMENT_RE = re.compile(r"^[^:,\x00-\x1f\x7f]{0,60}$")
ROLE_GROUPS = {"admin": "mirkomil-admin", "developer": "mirkomil-dev", "viewer": "mirkomil-viewer"}
RESERVED = {"root", "mirkomil", "admin", "daemon", "nobody", "www-data", "sudo", "docker", "syslog", "cockpit-ws", "cockpit-wsinstance"}
PW_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
# group → what it allows (shown in the panel). Nothing here grants root.
EXTRA_GROUPS = {
    "adm": "tizim loglarini o'qish (/var/log)",
    "systemd-journal": "jurnalni (journalctl) to'liq o'qish",
    "www-data": "veb-server fayllari bilan ishlash",
}


class UserError(Exception):
    pass


# ---------------------------------------------------------------- running privileged commands

def _systemd_run(argv: list[str], stdin: str | None = None, timeout: int = 60) -> str:
    cmd = ["systemd-run", "--wait", "--pipe", "--collect", "--quiet", "--service-type=exec", "--", *argv]
    p = subprocess.run(cmd, input=stdin or "", capture_output=True, text=True, timeout=timeout, check=False)
    if p.returncode != 0:
        raise UserError((p.stderr or p.stdout or f"exit {p.returncode}").strip()[-500:])
    return p.stdout


# replaced in tests
RUN: Callable[..., str] = _systemd_run


# ---------------------------------------------------------------- reading accounts

def _groups_of(name: str, gid: int) -> set[str]:
    out = set()
    for g in os.getgrouplist(name, gid):
        try:
            out.add(grp.getgrgid(g).gr_name)
        except KeyError:
            pass
    return out


def role_of(groups: set[str]) -> str:
    if "sudo" in groups or "mirkomil-admin" in groups:
        return "admin"
    if "mirkomil-dev" in groups:
        return "developer"
    if "mirkomil-viewer" in groups:
        return "viewer"
    return "none"


def _shadow() -> dict[str, list[str]]:
    try:
        lines = Path("/etc/shadow").read_text().splitlines()
    except OSError:
        return {}
    return {ln.split(":")[0]: ln.split(":") for ln in lines if ln.count(":") >= 8}


def list_users() -> list[dict[str, Any]]:
    shadow = _shadow()
    out = []
    for pw in pwd.getpwall():
        if not 1000 <= pw.pw_uid < 60000 or pw.pw_name in RESERVED:
            continue
        groups = _groups_of(pw.pw_name, pw.pw_gid)
        sh = shadow.get(pw.pw_name, [])
        locked = bool(sh) and (sh[1].startswith("!") or sh[7] == "1")
        out.append({
            "user": pw.pw_name, "uid": pw.pw_uid, "name": pw.pw_gecos.split(",")[0],
            "role": role_of(groups), "owner": "sudo" in groups,
            "managed": bool(groups & set(ROLE_GROUPS.values())),
            "locked": locked, "must_change": bool(sh) and sh[2] == "0",
            "groups": sorted(g for g in groups if g in EXTRA_GROUPS),
        })
    return sorted(out, key=lambda u: (not u["owner"], u["user"]))


def _target(user: str, managed_only: bool = True) -> dict[str, Any]:
    if not USER_RE.match(user or ""):
        raise UserError("foydalanuvchi nomi noto'g'ri")
    u = next((x for x in list_users() if x["user"] == user), None)
    if u is None:
        raise UserError("bunday foydalanuvchi yo'q")
    if u["owner"]:
        raise UserError("server egasini (sudo) paneldan o'zgartirib bo'lmaydi")
    if managed_only and not u["managed"]:
        raise UserError("bu hisob panel tomonidan boshqarilmaydi — avval unga rol bering")
    return u


# ---------------------------------------------------------------- account operations

def temp_password() -> str:
    raw = "".join(secrets.choice(PW_ALPHABET) for _ in range(16))
    return "-".join(raw[i:i + 4] for i in range(0, 16, 4))


def _set_temp_password(user: str) -> str:
    pw = temp_password()
    RUN(["chpasswd"], stdin=f"{user}:{pw}\n")
    RUN(["chage", "-d", "0", "--", user])  # must choose their own password at first login
    return pw


def create(user: str, role: str, name: str = "") -> dict[str, Any]:
    if not USER_RE.match(user or "") or user in RESERVED:
        raise UserError("nom: 2–31 belgi, kichik lotin harfi bilan boshlansin (a-z, 0-9, _ -)")
    if role not in ROLE_GROUPS:
        raise UserError("rol: admin, developer yoki viewer")
    if not COMMENT_RE.match(name or ""):
        raise UserError("to'liq ism noto'g'ri")
    try:
        pwd.getpwnam(user)
        raise UserError("bu nomli foydalanuvchi allaqachon bor")
    except KeyError:
        pass
    try:
        grp.getgrnam(user)
        raise UserError("bu nom tizim guruhi sifatida band")
    except KeyError:
        pass
    RUN(["useradd", "--create-home", "--shell", "/bin/bash", "--comment", name or user,
         "--groups", ROLE_GROUPS[role], "--", user])
    try:
        pw = _set_temp_password(user)
    except UserError:
        RUN(["userdel", "--remove", "--", user])
        raise
    return {"user": user, "role": role, "password": pw}


def set_role(user: str, role: str) -> str:
    if role not in ROLE_GROUPS:
        raise UserError("rol: admin, developer yoki viewer")
    u = _target(user, managed_only=False)
    groups = _groups_of(user, pwd.getpwnam(user).pw_gid)
    for g in groups & set(ROLE_GROUPS.values()):
        if g != ROLE_GROUPS[role]:
            RUN(["gpasswd", "--delete", user, g])
    if ROLE_GROUPS[role] not in groups:
        RUN(["gpasswd", "--add", user, ROLE_GROUPS[role]])
    if u["role"] != role:
        _logout(user)  # the new role applies from the next login
    return role


def _logout(user: str) -> None:
    try:
        RUN(["loginctl", "terminate-user", "--", user], timeout=20)
    except UserError:
        pass  # not logged in


def set_locked(user: str, locked: bool) -> bool:
    _target(user)
    if locked:
        RUN(["usermod", "--lock", "--expiredate", "1", "--", user])
        _logout(user)
    else:
        RUN(["usermod", "--unlock", "--expiredate", "", "--", user])
    return locked


def reset_password(user: str) -> str:
    _target(user)
    pw = _set_temp_password(user)
    _logout(user)
    return pw


def delete(user: str) -> str:
    _target(user)
    _logout(user)
    RUN(["userdel", "--", user])  # the home folder stays (data is never deleted silently)
    return "deleted"


def set_groups(user: str, wanted: list[str]) -> list[str]:
    """Make the user's EXTRA_GROUPS membership exactly `wanted` (other groups untouched)."""
    bad = [g for g in wanted if g not in EXTRA_GROUPS]
    if bad:
        raise UserError(f"bu guruhni paneldan berib bo'lmaydi: {', '.join(bad)}")
    _target(user)
    have = _groups_of(user, pwd.getpwnam(user).pw_gid)
    for g in EXTRA_GROUPS:
        try:
            grp.getgrnam(g)
        except KeyError:
            continue  # group not on this system
        if g in wanted and g not in have:
            RUN(["gpasswd", "--add", user, g])
        elif g not in wanted and g in have:
            RUN(["gpasswd", "--delete", user, g])
    return sorted(set(wanted))
