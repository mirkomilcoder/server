"""Who is calling? Kernel-verified identity of a Unix-socket peer.

SO_PEERCRED gives the uid of the process on the other end of the socket. The
panel reaches us through Cockpit's bridge, which runs as the logged-in Linux
user — so a browser can't pretend to be someone else. Roles come from Linux
groups (managed by the installer / Users page):

    admin      uid 0, or member of mirkomil-admin or sudo
    developer  member of mirkomil-dev
    viewer     member of mirkomil-viewer
"""

from __future__ import annotations

import grp
import os
import pwd
import socket
import struct
from dataclasses import dataclass

ROLE_RANK = {"none": 0, "viewer": 1, "developer": 2, "admin": 3}


@dataclass(frozen=True)
class Peer:
    uid: int
    user: str
    groups: tuple[str, ...]
    role: str

    def at_least(self, role: str) -> bool:
        return ROLE_RANK[self.role] >= ROLE_RANK[role]


def peer_uid(sock: socket.socket) -> int:
    creds = sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
    _pid, uid, _gid = struct.unpack("3i", creds)
    return uid


def role_for(uid: int, groups: tuple[str, ...]) -> str:
    if uid == 0 or "mirkomil-admin" in groups or "sudo" in groups:
        return "admin"
    if "mirkomil-dev" in groups:
        return "developer"
    if "mirkomil-viewer" in groups:
        return "viewer"
    return "none"


def identify(uid: int) -> Peer:
    try:
        pw = pwd.getpwuid(uid)
    except KeyError:
        return Peer(uid, f"uid{uid}", (), "none")
    gids = os.getgrouplist(pw.pw_name, pw.pw_gid)
    names = []
    for g in gids:
        try:
            names.append(grp.getgrgid(g).gr_name)
        except KeyError:
            continue
    groups = tuple(sorted(set(names)))
    return Peer(uid, pw.pw_name, groups, role_for(uid, groups))
