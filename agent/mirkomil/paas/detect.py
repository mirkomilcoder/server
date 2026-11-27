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
#   optional — everything else; "auto" decides from the code (detect_site):
#              a bot with a webhook server → site, a polling bot → private,
#              Node with a web server → site, a Dockerfile with EXPOSE → site
SITE_REQUIRED = {"django", "fastapi", "flask", "static"}
SITE_DEFAULT = {"bot": False, "node": True, "dockerfile": True}


def site_mode(kind: str | None) -> str:
    """'required' | 'optional' | 'auto' (type not known yet)."""
    if kind is None:
        return "auto"
    return "required" if kind in SITE_REQUIRED else "optional"


def is_public(kind: str, public: bool | None, auto: bool | None = None) -> bool:
    """Final decision: required types always; else the user's choice; else what the code showed."""
    if kind in SITE_REQUIRED:
        return True
    if public is not None:
        return bool(public)
    return SITE_DEFAULT.get(kind, True) if auto is None else auto

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
    # does the code serve HTTP? (None = can't tell) and why we think so, for the deploy log/UI
    site: bool | None = None
    site_reason: str = ""
    # Procfile processes / start.sh — replace the template's start command
    commands: dict[str, str] = field(default_factory=dict)


# ---------------------------------------------------------------- "is it a site?" from the code

# a Telegram bot that runs its own HTTP server for webhooks
BOT_WEBHOOK_RE = re.compile(
    r"SimpleRequestHandler|setup_application|TokenBasedRequestHandler|run_webhook|start_webhook"
    r"|web\.run_app|uvicorn\.run|\bFastAPI\(|\bFlask\(|aiohttp\.web|from aiohttp import web")
BOT_POLLING_RE = re.compile(r"start_polling|run_polling|infinity_polling|\.polling\(|idle\(\)")
NODE_WEB_DEPS = ("express", "fastify", "koa", "@hapi/hapi", "hono", "next", "nuxt", "@nestjs/core", "@remix-run/serve",
                 "astro", "@sveltejs/kit", "sirv-cli", "serve", "http-server", "restify", "polka", "socket.io")
NODE_WEB_RE = re.compile(r"\.listen\s*\(|createServer\s*\(|Bun\.serve|Deno\.serve")
NODE_BOT_DEPS = ("telegraf", "grammy", "node-telegram-bot-api", "discord.js", "@whiskeysockets/baileys", "whatsapp-web.js")
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "env", "__pycache__", "dist", "build", ".next", "site-packages"}


def _code(root: Path, exts: tuple[str, ...], budget: int = 3_000_000, max_files: int = 400) -> str:
    """Source text of the repo (bounded), for pattern checks."""
    out, size, n = [], 0, 0
    for p in sorted(root.rglob("*")):
        if n >= max_files or size >= budget:
            break
        if not p.is_file() or p.suffix not in exts or any(part in SKIP_DIRS for part in p.relative_to(root).parts):
            continue
        t = _read(p, 300_000)
        out.append(t)
        size += len(t)
        n += 1
    return "\n".join(out)


# ---------------------------------------------------------------- start commands, versions, subfolders

PROC_RE = re.compile(r"^([A-Za-z0-9_-]{1,30})\s*:\s*(\S.*)$")
ROOT_DIR_RE = re.compile(r"^[A-Za-z0-9._-]{1,100}(/[A-Za-z0-9._-]{1,100}){0,4}$")


def procfile(root: Path) -> dict[str, str]:
    """Heroku/Railway Procfile: {"web": cmd, "worker": cmd, ...} (release/one-off lines ignored)."""
    out: dict[str, str] = {}
    for line in _read(root / "Procfile", 20_000).splitlines():
        m = PROC_RE.match(line.strip())
        if m and m.group(1) not in ("release", "postdeploy") and len(m.group(2)) <= 1000:
            out[m.group(1)] = m.group(2).strip()
    return out


def start_commands(root: Path) -> dict[str, str]:
    """What to run: the Procfile's processes, else start.sh. Empty = the template's default."""
    procs = procfile(root)
    if procs:
        return procs
    if (root / "start.sh").is_file():
        return {"worker": "bash start.sh"}
    return {}


def python_version(root: Path) -> str:
    """runtime.txt "python-3.11.7" / .python-version "3.11" → "3.11" (supported 3.9–3.14, default 3.13)."""
    for f in ("runtime.txt", ".python-version"):
        m = re.search(r"(?:python-)?3\.(\d{1,2})", _read(root / f, 200))
        if m and 9 <= int(m.group(1)) <= 14:
            return f"3.{m.group(1)}"
    return "3.13"


def valid_root_dir(d: str) -> bool:
    return d == "" or (ROOT_DIR_RE.match(d) is not None and ".." not in d.split("/"))


def find_root(root: Path) -> tuple[str, str]:
    """Monorepo / nested project: if the repo root isn't a project but exactly one
    top-level folder is, use that folder. Returns (subdir, reason); ("", "") = repo root."""
    try:
        _guess(root)
        return "", ""
    except DetectError:
        pass
    found = []
    for d in sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith(".") and p.name not in SKIP_DIRS):
        try:
            _guess(d)
            found.append(d.name)
        except DetectError:
            continue
    if len(found) == 1:
        return found[0], f"loyiha «{found[0]}/» papkasida topildi"
    return "", ""


def detect_site(root: Path, kind: str) -> tuple[bool | None, str]:
    """Does this app serve HTTP? Returns (answer, reason in Uzbek)."""
    if kind == "static":
        return True, "statik sayt (index.html)"
    if kind in SITE_REQUIRED:
        return True, "veb-framework — doim sayt"
    procs = procfile(root) if kind != "dockerfile" else {}
    if "web" in procs:
        return True, "Procfile'da web jarayoni bor"
    if procs:
        return False, f"Procfile'da faqat {', '.join(procs)} — sayt emas"
    if kind == "bot":
        code = _code(root, (".py",))
        hook = BOT_WEBHOOK_RE.search(code)
        if hook:
            return True, f"webhook server topildi ({hook.group(0).strip('(')}) — sayt sifatida ochiladi"
        if BOT_POLLING_RE.search(code):
            return False, "polling bot — Telegram'ga o'zi ulanadi, sayt kerak emas"
        return False, "bot — HTTP server topilmadi"
    if kind == "node":
        try:
            pkg = json.loads(_read(root / "package.json") or "{}")
        except ValueError:
            pkg = {}
        deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
        web = next((d for d in NODE_WEB_DEPS if d in deps), None)
        if web:
            return True, f"veb-server topildi ({web})"
        if NODE_WEB_RE.search(_code(root, (".js", ".mjs", ".cjs", ".ts"))):
            return True, "kodda .listen() / createServer() bor"
        bot = next((d for d in NODE_BOT_DEPS if d in deps), None)
        if bot:
            return False, f"bot ({bot}) — sayt kerak emas"
        return None, ""
    if kind == "dockerfile":
        m = re.search(r"^\s*EXPOSE\s+(\d+)", _read(root / "Dockerfile"), re.M | re.I)
        if m:
            return True, f"Dockerfile'da EXPOSE {m.group(1)}"
        return False, "Dockerfile'da EXPOSE yo'q — fon jarayoni deb hisoblanadi"
    return None, ""


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


def _python_deps(root: Path) -> str:
    """What to COPY before installing: only requirements.txt lets Docker cache the install layer."""
    return "requirements.txt" if (root / "requirements.txt").is_file() else "."


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
    d = _detect(root, kind)
    d.site, d.site_reason = detect_site(root, kind)
    if kind in ("django", "fastapi", "flask", "bot"):
        d.vars["PY"] = python_version(root)
    d.commands = start_commands(root) if kind != "dockerfile" else {}
    return d


def _detect(root: Path, kind: str) -> Detection:

    if kind == "dockerfile":
        if not (root / "Dockerfile").is_file():
            raise DetectError("Repoda Dockerfile yo'q.")
        return Detection("dockerfile", web=True, note="Repodagi Dockerfile ishlatiladi")
    if kind == "django":
        return Detection("django", web=True, vars={"INSTALL": _python_install(root), "WSGI": _find_wsgi(root), "DEPS": _python_deps(root)})
    if kind == "fastapi":
        return Detection("fastapi", web=True, vars={"INSTALL": _python_install(root), "ASGI": _find_app_object(root, "FastAPI"), "DEPS": _python_deps(root)})
    if kind == "flask":
        return Detection("flask", web=True, vars={"INSTALL": _python_install(root), "WSGI_APP": _find_app_object(root, "Flask"), "DEPS": _python_deps(root)})
    if kind == "bot":
        entry = _find_entry(root) if not start_commands(root) else "-"
        return Detection("bot", web=False, vars={"INSTALL": _python_install(root), "ENTRY": entry, "DEPS": _python_deps(root)})
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
