"""Entry point:  python3 -m mirkomil {guardian|helper|status}"""

from __future__ import annotations

import asyncio
import json
import logging
import sys


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")

    if cmd == "guardian":
        from .guardian import main_async
        asyncio.run(main_async())
        return 0
    if cmd == "helper":
        from .helper import serve
        serve()
        return 0
    if cmd == "deploy":
        # started by the helper via systemd-run (root, outside the helper sandbox)
        from pathlib import Path
        from .paas.engine import deploy
        return deploy(Path(sys.argv[2]))
    if cmd == "status":
        # Query the running Guardian over its socket (same path the panel uses).
        import socket
        from .config import RUN
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(10)
            s.connect(str(RUN / "api.sock"))
            s.sendall(b"GET /v1/status HTTP/1.1\r\nHost: localhost\r\n\r\n")
            data = b""
            while chunk := s.recv(65536):
                data += chunk
        body = data.split(b"\r\n\r\n", 1)[1]
        print(json.dumps(json.loads(body), ensure_ascii=False, indent=2))
        return 0
    print("usage: python3 -m mirkomil {guardian|helper|status}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
