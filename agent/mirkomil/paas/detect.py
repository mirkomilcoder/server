"""Detect what kind of app a repository is, and how to run it.

Pure functions over a checked-out directory — no network, no Docker — so the
rules are easy to unit-test. The result picks a Dockerfile template from
paas/templates/ (unless the repo brings its own Dockerfile).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

SUPPORTED = ("dockerfile", "django", "fastapi", "flask", "bot", "node", "static")

# app types that serve HTTP (get a route + health check); bots are workers
WEB_TYPES = {"dockerfile", "django", "fastapi", "flask", "node", "static"}

# Is the app published as a site (<app>.<domain>)?
#   required — web frameworks exist to serve a site: always public
#   optional — bots/workers (aiogram…) default to private; turn on e.g. for a webhook;
#              node / own Dockerfile can be either, default public
SITE_REQUIRED = {"django", "fastapi", "flask", "static"}
SITE_DEFAULT = {"bot": False, "node": True, "dockerfile": True}


def site_mode(kind: str | None) -> str:
    """'required' | 'optional' | 'auto' (type not known yet)."""
    if kind is None:
        return "auto"
    return "required" if kind in SITE_REQUIRED else "optional"


def is_public(kind: str, public: bool | None) -> bool:
    """Final decision for a detected type and the app's setting (None = default)."""
    if kind in SITE_REQUIRED:
        return True
    return SITE_DEFAULT.get(kind, True) if public is None else bool(public)

BOT_LIBS = ("aiogram", "python-telegram-bot", "pytelegrambotapi", "telebot", "pyrogram")
ENTRY_CANDIDATES = ("bot.py", "main.py", "app.py", "run.py", "__main__.py", "src/bot.py", "src/main.py")
MODULE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$")


class DetectError(Exception):
    """Human-readable (Uzbek) reason why the repo can't be deployed as-is."""


@dataclass
class Detection:
    type: str
    web: bool
    vars: dict[str, str] = field(default_factory=dict)  # template variables
    note: str = ""


def _read(p: Path, limit: int = 200_000) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="replace")[:limit]
    except OSError:
        return ""


def _requirements(root: Path) -> str:
    """Lower-cased dependency text from requirements*.txt / pyproject.toml."""
    parts = [_read(p) for p in sorted(root.glob("requirements*.txt"))]
    parts.append(_read(root / "pyproject.toml"))
    return "\n".join(parts).lower()


def _python_install(root: Path) -> str:
    if (root / "requirements.txt").is_file():
        return "pip install -r requirements.txt"
    if (root / "pyproject.toml").is_file():
        return "pip install ."
    raise DetectError("Python loyiha topildi, lekin requirements.txt yoki pyproject.toml yo'q.")


def _find_wsgi(root: Path) -> str:
    """Django: <project>/wsgi.py → '<project>.wsgi'."""
    for p in sorted(root.glob("*/wsgi.py")) + sorted(root.glob("src/*/wsgi.py")):
        rel = p.relative_to(root).with_suffix("")
        parts = [x for x in rel.parts if x != "src"]
        mod = ".".join(parts)
        if MODULE_RE.match(mod):
            return mod
    raise DetectError("Django loyiha: <loyiha>/wsgi.py topilmadi.")


def _find_app_object(root: Path, ctor: str) -> str:
    """FastAPI/Flask: find 'name = FastAPI(' → 'module:name'."""
    rx = re.compile(rf"^([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=]+)?=\s*{ctor}\(", re.M)
    for cand in ("main.py", "app.py", "app/main.py", "src/main.py", "api/main.py", "server.py", "wsgi.py", "asgi.py"):
        p = root / cand
        m = rx.search(_read(p)) if p.is_file() else None
        if m:
            mod = cand[:-3].replace("/", ".")
            if MODULE_RE.match(mod):
                return f"{mod}:{m.group(1)}"
    raise DetectError(f"{ctor}() bilan yaratilgan ilova obyekti topilmadi (main.py / app.py / app/main.py).")


def _find_entry(root: Path) -> str:
    for cand in ENTRY_CANDIDATES:
        if (root / cand).is_file():
            return cand
    raise DetectError("Bot uchun kirish fayli topilmadi (bot.py, main.py, app.py yoki run.py).")


def detect(root: Path, forced: str | None = None) -> Detection:
    """`forced` lets the user override the guess (still validated)."""
    root = Path(root)
    kind = forced or _guess(root)
    if kind not in SUPPORTED:
        raise DetectError(f"Qo'llab-quvvatlanmaydigan tur: {kind}")

    if kind == "dockerfile":
        if not (root / "Dockerfile").is_file():
            raise DetectError("Repoda Dockerfile yo'q.")
        return Detection("dockerfile", web=True, note="Repodagi Dockerfile ishlatiladi")
    if kind == "django":
        return Detection("django", web=True, vars={"INSTALL": _python_install(root), "WSGI": _find_wsgi(root)})
    if kind == "fastapi":
        return Detection("fastapi", web=True, vars={"INSTALL": _python_install(root), "ASGI": _find_app_object(root, "FastAPI")})
    if kind == "flask":
        return Detection("flask", web=True, vars={"INSTALL": _python_install(root), "WSGI_APP": _find_app_object(root, "Flask")})
    if kind == "bot":
        return Detection("bot", web=False, vars={"INSTALL": _python_install(root), "ENTRY": _find_entry(root)})
    if kind == "node":
        pkg = _read(root / "package.json")
        try:
            scripts = json.loads(pkg).get("scripts", {}) if pkg else {}
        except ValueError:
            raise DetectError("package.json noto'g'ri JSON.")
        if "start" not in scripts:
            raise DetectError('package.json\'da "start" skripti yo\'q.')
        return Detection("node", web=True)
    # static
    for d in (".", "public", "dist", "build", "site", "docs"):
        if (root / d / "index.html").is_file():
            return Detection("static", web=True, vars={"STATIC_DIR": d})
    raise DetectError("Statik sayt uchun index.html topilmadi.")


def _guess(root: Path) -> str:
    if (root / "Dockerfile").is_file():
        return "dockerfile"
    if any((root / n).is_file() for n in ("docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml")):
        raise DetectError("docker-compose loyihalar keyingi bosqichda qo'shiladi (xavfsizlik tekshiruvi bilan). "
                          "Hozircha Dockerfile qo'shing yoki turini qo'lda tanlang.")
    reqs = _requirements(root)
    if (root / "manage.py").is_file() and "django" in reqs:
        return "django"
    if any(lib in reqs for lib in BOT_LIBS):
        return "bot"
    if "fastapi" in reqs:
        return "fastapi"
    if "flask" in reqs:
        return "flask"
    if (root / "package.json").is_file():
        return "node"
    if any((root / d / "index.html").is_file() for d in (".", "public", "dist", "build", "site", "docs")):
        return "static"
    raise DetectError("Loyiha turini aniqlab bo'lmadi. Dockerfile qo'shing yoki turini qo'lda tanlang.")
