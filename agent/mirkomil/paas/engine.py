"""Deploy engine (runs as root, started by the helper as a systemd job).

    python3 -m mirkomil deploy /var/lib/mirkomil/apps/<app>/deploys/<id>/spec.json

Steps: clone → detect → Dockerfile → build → run new container → health
check → switch the Caddy route → stop the previous container. A failure at
any step leaves the previously running version untouched.

Layout (root:mirkomil, so Guardian can read status/logs but not secrets):
    /var/lib/mirkomil/apps/<app>/            0750
        env                                  0600 root  (secrets, --env-file)
        src/                                 0700 root  (git checkout)
        current.json                         0640       (running deploy)
        deploys/<id>/spec.json|status.json|log  0640
    /var/lib/mirkomil/proxy/Caddyfile, routes.json
"""

from __future__ import annotations

import grp
import json
import os
import re
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .detect import DetectError, detect, is_public

APPS = Path(os.environ.get("MK_APPS_DIR", "/var/lib/mirkomil/apps"))
PROXY = Path(os.environ.get("MK_PROXY_DIR", "/var/lib/mirkomil/proxy"))
TEMPLATES = Path(os.environ.get("MK_TEMPLATES", "/opt/mirkomil/src/paas/templates"))

NETWORK = "mirkomil"
PROXY_NAME = "mk-proxy"
PROXY_IMAGE = "caddy:2.10.2-alpine"
PROXY_BIND = "127.0.0.1:8088"  # public traffic arrives via Cloudflare Tunnel (M6), never a public port

APP_RE = re.compile(r"^[a-z][a-z0-9-]{1,30}[a-z0-9]$")
# public: https://github.com/owner/repo · private (deploy key): git@github.com:owner/repo.git
REPO_RE = re.compile(r"^(https://(github\.com|gitlab\.com|codeberg\.org)/|git@(github\.com|gitlab\.com|codeberg\.org):)"
                     r"[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}?(\.git)?$")
SSH_HOST_RE = re.compile(r"^git@([a-z.]+):")
# Pinned host keys (GitHub publishes these); other hosts are trusted on first use per app.
KNOWN_HOSTS = Path(os.environ.get("MK_KNOWN_HOSTS", "/opt/mirkomil/src/paas/known_hosts"))
BRANCH_RE = re.compile(r"^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,100}$")
DEPLOY_RE = re.compile(r"^[0-9]{8}-[0-9]{6}-[a-f0-9]{4}$")
ENV_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
RESERVED_ENV = {"PORT"}

# Hardening applied to every app container.
RUN_HARDENING = [
    "--security-opt", "no-new-privileges:true",
    "--cap-drop", "NET_RAW", "--cap-drop", "MKNOD", "--cap-drop", "AUDIT_WRITE",
    "--cap-drop", "SYS_CHROOT", "--cap-drop", "SETFCAP",
    "--pids-limit", "512",
    "--log-driver", "local", "--log-opt", "max-size=10m", "--log-opt", "max-file=3",
]


class DeployError(Exception):
    pass


# ---------------------------------------------------------------- validation

def validate_spec(s: dict[str, Any]) -> dict[str, Any]:
    """Everything that reaches argv or a file is checked here (helper calls it too)."""
    out = {
        "app": str(s.get("app", "")),
        "repo": str(s.get("repo", "")),
        "branch": str(s.get("branch", "main")),
        "type": s.get("type") or None,
        "port": int(s.get("port") or 0),
        "mem_mb": int(s.get("mem_mb") or 512),
        "cpus": float(s.get("cpus") or 1.0),
        "domain": str(s.get("domain", "")),
        "deploy_id": str(s.get("deploy_id", "")),
        "by": re.sub(r"[^a-z0-9_.-]", "", str(s.get("by", "?")))[:32] or "?",
        "image": s.get("image") or None,  # rollback: reuse an existing image
        # publish as a site: None = default for the type (see detect.is_public)
        "public": None if s.get("public") is None else bool(s.get("public")),
    }
    if not APP_RE.match(out["app"]):
        raise DeployError("ilova nomi: 3–32 belgi, kichik harf/raqam/chiziqcha, harf bilan boshlansin")
    if not out["image"] and not REPO_RE.match(out["repo"]):
        raise DeployError("repo: https://github.com/<egasi>/<repo> ko'rinishida bo'lsin")
    if not BRANCH_RE.match(out["branch"]):
        raise DeployError("branch nomi noto'g'ri")
    if out["type"] is not None and out["type"] not in ("dockerfile", "django", "fastapi", "flask", "bot", "node", "static"):
        raise DeployError("tur noto'g'ri")
    if not (0 <= out["port"] <= 65535):
        raise DeployError("port noto'g'ri")
    if not (64 <= out["mem_mb"] <= 16384):
        raise DeployError("RAM: 64–16384 MB")
    if not (0.1 <= out["cpus"] <= 16):
        raise DeployError("CPU: 0.1–16")
    if not DEPLOY_RE.match(out["deploy_id"]):
        raise DeployError("deploy id noto'g'ri")
    if out["image"] and not re.match(r"^mirkomil/app-[a-z0-9-]+:[0-9]{8}-[0-9]{6}-[a-f0-9]{4}$", out["image"]):
        raise DeployError("image noto'g'ri")
    return out


def new_deploy_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-") + os.urandom(2).hex()


# ---------------------------------------------------------------- files

def _mirkomil_gid() -> int:
    try:
        return grp.getgrnam("mirkomil").gr_gid
    except KeyError:
        return 0


def ensure_dir(p: Path, mode: int = 0o750) -> Path:
    p.mkdir(parents=True, exist_ok=True)
    os.chmod(p, mode)
    if os.geteuid() == 0:
        os.chown(p, 0, _mirkomil_gid())
    return p


def write_shared(p: Path, text: str) -> None:
    """Group-readable by Guardian (root:mirkomil 0640), atomic."""
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.chmod(tmp, 0o640)
    if os.geteuid() == 0:
        os.chown(tmp, 0, _mirkomil_gid())
    os.replace(tmp, p)


def app_dir(app: str) -> Path:
    return APPS / app


def write_env(app: str, env: dict[str, str]) -> None:
    lines = []
    for k, v in env.items():
        if not ENV_KEY_RE.match(k) or k in RESERVED_ENV:
            raise DeployError(f"env kaliti noto'g'ri: {k}")
        if "\n" in v or "\r" in v or len(v) > 8192:
            raise DeployError(f"env qiymati noto'g'ri: {k}")
        lines.append(f"{k}={v}")
    ensure_dir(app_dir(app))
    p = app_dir(app) / "env"
    tmp = p.with_name("env.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + ("\n" if lines else ""))
    os.replace(tmp, p)


def read_env_keys(app: str) -> list[dict[str, Any]]:
    """Keys + value length only: secret values never leave this process."""
    p = app_dir(app) / "env"
    if not p.exists():
        return []
    out = []
    for line in p.read_text(encoding="utf-8").splitlines():
        k, _, v = line.partition("=")
        if k:
            out.append({"key": k, "length": len(v)})
    return out


def read_env(app: str) -> dict[str, str]:
    p = app_dir(app) / "env"
    if not p.exists():
        return {}
    return dict(l.split("=", 1) for l in p.read_text(encoding="utf-8").splitlines() if "=" in l)


# ---------------------------------------------------------------- git (public + deploy keys)

GIT_SAFE = ["-c", "core.hooksPath=/dev/null", "-c", "protocol.file.allow=never", "-c", "protocol.ext.allow=never"]


def private_dir(app: str) -> Path:
    """Root-only (0700): deploy key, per-app known_hosts. Guardian cannot read it."""
    p = app_dir(app) / "private"
    p.mkdir(parents=True, exist_ok=True)
    os.chmod(p, 0o700)
    return p


def deploy_key(app: str) -> str:
    """Create (once) an ed25519 deploy key for the app; return the PUBLIC key only."""
    key = private_dir(app) / "deploy_key"
    if not key.exists():
        r = quiet(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", f"mirkomil-{app}", "-f", str(key)])
        if r.returncode != 0:
            raise DeployError("deploy kalit yaratib bo'lmadi: " + r.stderr.strip()[-200:])
        os.chmod(key, 0o600)
    return (key.with_suffix(".pub")).read_text().strip()


def git_env(app: str, repo: str) -> dict[str, str]:
    env = {"GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "/bin/false", "GIT_CONFIG_NOSYSTEM": "1"}
    m = SSH_HOST_RE.match(repo)
    if m:
        key = private_dir(app) / "deploy_key"
        if not key.exists():
            raise DeployError("bu private repo uchun avval deploy kalitini yarating va GitHub'ga qo'shing")
        host = m.group(1)
        app_kh = private_dir(app) / "known_hosts"
        # github.com: only the pinned key is accepted; others: trust on first use, then pinned per app
        strict = "yes" if host == "github.com" else "accept-new"
        env["GIT_SSH_COMMAND"] = (f"ssh -i {key} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking={strict} "
                                  f"-o UserKnownHostsFile='{KNOWN_HOSTS} {app_kh}' -o ConnectTimeout=20")
    return env


def remote_head(app: str, repo: str, branch: str) -> str:
    """Latest commit SHA of the branch on the remote (for auto-deploy), without cloning."""
    r = subprocess.run(["git", *GIT_SAFE, "ls-remote", "--", repo, f"refs/heads/{branch}"],
                       capture_output=True, text=True, timeout=60, env={**os.environ, **git_env(app, repo)}, check=False)
    if r.returncode != 0:
        raise DeployError("repo'ga ulanib bo'lmadi: " + r.stderr.strip()[-200:])
    sha = r.stdout.split()[0] if r.stdout.split() else ""
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise DeployError(f"branch topilmadi: {branch}")
    return sha


# ---------------------------------------------------------------- job log / status

class Job:
    def __init__(self, spec: dict[str, Any]):
        self.spec = spec
        self.dir = ensure_dir(app_dir(spec["app"]) / "deploys" / spec["deploy_id"])
        self.log_path = self.dir / "log"
        self.status: dict[str, Any] = {"id": spec["deploy_id"], "app": spec["app"], "by": spec["by"],
                                       "state": "running", "step": "start", "started": int(time.time())}
        write_shared(self.log_path, "")
        self.save()

    def save(self) -> None:
        write_shared(self.dir / "status.json", json.dumps(self.status))

    def step(self, name: str, title: str) -> None:
        self.status["step"] = name
        self.save()
        self.log(f"\n==> {title}")

    def log(self, text: str) -> None:
        with open(self.log_path, "a", encoding="utf-8") as f:
            f.write(text.rstrip("\n") + "\n")

    def finish(self, state: str, **extra: Any) -> None:
        self.status.update(state=state, finished=int(time.time()), **extra)
        self.save()


def clone_error(out: str, repo: str, branch: str) -> str:
    """Turn git's clone failure into advice the user can act on."""
    # GitHub answers 401 for both missing and private repos, so we can't tell them apart
    if "could not read Username" in out or "Repository not found" in out or "terminal prompts disabled" in out:
        ssh =SSH_HOST_RE.match(repo) is None and re.sub(r"^https://([^/]+)/(.+?)(\.git)?$", r"git@\1:\2.git", repo)
        return ("repo topilmadi yoki yopiq (private). Manzilni tekshiring (katta-kichik harf, '-' va '_' farqi muhim)."
                + (f" Yopiq bo'lsa: manzilni {ssh} ga o'zgartiring va loyihadagi «Deploy kaliti»ni GitHub → Settings → "
                   "Deploy keys'ga qo'shing." if ssh else ""))
    if "Permission denied (publickey)" in out:
        return "GitHub deploy kalitini qabul qilmadi: loyihadagi «Deploy kaliti»ni repo → Settings → Deploy keys'ga qo'shing."
    if "Remote branch" in out and "not found" in out:
        return f"'{branch}' branch'i repoda yo'q — sozlamalarda to'g'ri branch nomini kiriting (masalan main yoki master)."
    if "Could not resolve host" in out or "Failed to connect" in out:
        return "GitHub'ga ulanib bo'lmadi — server internetini tekshiring."
    return "kodni yuklab bo'lmadi (git clone) — logni ko'ring"


def sh(job: Job | None, argv: list[str], timeout: int = 600, env: dict[str, str] | None = None, check: bool = True) -> str:
    """Run argv (never a shell), streaming output into the job log."""
    if job:
        job.log("$ " + " ".join(argv))
    p = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                         env={**os.environ, **(env or {})})
    out_lines: list[str] = []
    deadline = time.monotonic() + timeout
    assert p.stdout is not None
    for line in p.stdout:
        out_lines.append(line)
        if job:
            job.log(line)
        if time.monotonic() > deadline:
            p.kill()
            raise DeployError(f"vaqt tugadi ({timeout}s): {argv[0]}")
    rc = p.wait()
    if check and rc != 0:
        raise DeployError(f"{argv[0]} {argv[1] if len(argv) > 1 else ''} xato bilan tugadi (kod {rc})")
    return "".join(out_lines)


def quiet(argv: list[str], timeout: int = 60) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False)


# ---------------------------------------------------------------- proxy (Caddy)

def ensure_proxy() -> None:
    if quiet(["docker", "network", "inspect", NETWORK]).returncode != 0:
        quiet(["docker", "network", "create", NETWORK])
    ensure_dir(PROXY, 0o755)
    if not (PROXY / "Caddyfile").exists():
        write_caddyfile({})
    state = quiet(["docker", "inspect", "-f", "{{.State.Running}}", PROXY_NAME]).stdout.strip()
    if state != "true":
        quiet(["docker", "rm", "-f", PROXY_NAME])
        r = quiet(["docker", "run", "-d", "--name", PROXY_NAME, "--network", NETWORK, "--restart", "unless-stopped",
                   "-p", f"{PROXY_BIND}:80", "-v", f"{PROXY}:/etc/caddy:ro",
                   "--security-opt", "no-new-privileges:true", "--log-driver", "local",
                   "--label", "mirkomil.role=proxy", PROXY_IMAGE], timeout=300)
        if r.returncode != 0:
            raise DeployError("proxy (Caddy) ishga tushmadi: " + r.stderr.strip()[-300:])


def load_routes() -> dict[str, Any]:
    try:
        return json.loads((PROXY / "routes.json").read_text())
    except (OSError, ValueError):
        return {}


def render_caddyfile(routes: dict[str, Any]) -> str:
    out = ["# Generated by Mirkomil PaaS — do not edit", "{", "\tadmin localhost:2019", "\tauto_https off", "}", ""]
    for app, r in sorted(routes.items()):
        hosts = " ".join(f"http://{h}" for h in r["hosts"])
        out += [f"{hosts} {{", f"\treverse_proxy {r['upstream']}", "}", ""]
    out += [":80 {", '\trespond "Mirkomil Host: bu manzilda ilova yo\'q" 404', "}", ""]
    return "\n".join(out)


def write_caddyfile(routes: dict[str, Any]) -> None:
    ensure_dir(PROXY, 0o755)
    (PROXY / "Caddyfile").write_text(render_caddyfile(routes), encoding="utf-8")
    (PROXY / "routes.json").write_text(json.dumps(routes, indent=2), encoding="utf-8")


def set_route(app: str, hosts: list[str] | None, upstream: str | None) -> None:
    """Add/replace (or remove when hosts is None) a route and reload Caddy; roll back on failure."""
    routes = load_routes()
    old_file = (PROXY / "Caddyfile").read_text() if (PROXY / "Caddyfile").exists() else None
    old_routes = dict(routes)
    if hosts is None:
        routes.pop(app, None)
    else:
        routes[app] = {"hosts": hosts, "upstream": upstream}
    write_caddyfile(routes)
    r = quiet(["docker", "exec", PROXY_NAME, "caddy", "reload", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"])
    if r.returncode != 0:
        if old_file is not None:
            (PROXY / "Caddyfile").write_text(old_file)
            (PROXY / "routes.json").write_text(json.dumps(old_routes, indent=2))
        raise DeployError("Caddy konfiguratsiyasi qabul qilinmadi: " + r.stderr.strip()[-300:])


# ---------------------------------------------------------------- containers

def _scheme() -> str:
    """https once the Cloudflare Tunnel is set up (Cloudflare terminates TLS), else http (local only)."""
    return "https" if Path("/var/lib/mirkomil/tunnel/private/tunnel.env").exists() else "http"


def container_name(app: str, deploy_id: str) -> str:
    return f"mk-{app}-{deploy_id[-11:].replace('-', '')}"


def app_containers(app: str) -> list[str]:
    r = quiet(["docker", "ps", "-a", "--filter", f"label=mirkomil.app={app}", "--format", "{{.Names}}"])
    return [n for n in r.stdout.split() if n]


# Typical app ports first; admin/TLS ports that base images also EXPOSE
# (e.g. caddy: 80, 443, 2019) must not win just by sorting first.
PREFERRED_PORTS = (8000, 8080, 3000, 5000, 80, 8888, 4000, 9000)
NOT_APP_PORTS = {443, 2019, 9229}


def pick_port(exposed: list[int]) -> int | None:
    for p in PREFERRED_PORTS:
        if p in exposed:
            return p
    rest = sorted(p for p in exposed if p not in NOT_APP_PORTS)
    return rest[0] if rest else None


def image_port(image: str) -> int | None:
    r = quiet(["docker", "image", "inspect", "-f", "{{json .Config.ExposedPorts}}", image])
    try:
        ports = json.loads(r.stdout or "null") or {}
    except ValueError:
        return None
    return pick_port([int(m.group(1)) for k in ports if (m := re.match(r"^(\d+)/tcp$", k))])


def run_container(job: Job, spec: dict[str, Any], image: str, port: int, web: bool) -> str:
    name = container_name(spec["app"], spec["deploy_id"])
    quiet(["docker", "rm", "-f", name])
    argv = ["docker", "run", "-d", "--name", name, "--network", NETWORK, "--restart", "unless-stopped",
            "--memory", f"{spec['mem_mb']}m", "--memory-swap", f"{spec['mem_mb']}m", "--cpus", str(spec["cpus"]),
            "--label", f"mirkomil.app={spec['app']}", "--label", f"mirkomil.deploy={spec['deploy_id']}",
            *RUN_HARDENING]
    env_file = app_dir(spec["app"]) / "env"
    if env_file.exists():
        argv += ["--env-file", str(env_file)]
    if web:
        argv += ["-e", f"PORT={port}"]
    argv.append(image)
    sh(job, argv, timeout=120)
    return name


def healthy(job: Job, name: str, port: int, web: bool, wait_s: int = 60) -> bool:
    """Web: any HTTP answer through the proxy network. Worker: still running after 15 s."""
    deadline = time.monotonic() + (wait_s if web else 15)
    while time.monotonic() < deadline:
        st = quiet(["docker", "inspect", "-f", "{{.State.Running}} {{.RestartCount}}", name]).stdout.split()
        if st and (st[0] != "true" or (len(st) > 1 and st[1] != "0")):
            job.log(f"konteyner to'xtadi yoki qayta ishga tushdi: {' '.join(st)}")
            return False
        if web:
            r = quiet(["docker", "exec", PROXY_NAME, "wget", "-q", "-S", "-O", "/dev/null", "-T", "3", f"http://{name}:{port}/"])
            if "HTTP/" in (r.stdout + r.stderr):
                job.log(f"health: {name}:{port} javob berdi")
                return True
        time.sleep(2)
    if web:
        job.log(f"health: {wait_s}s ichida {name}:{port} HTTP javob bermadi")
        return False
    job.log("health: bot 15 soniya barqaror ishladi")
    return True


def prune_images(app: str, keep: int = 3) -> None:
    r = quiet(["docker", "image", "ls", f"mirkomil/app-{app}", "--format", "{{.Tag}}"])
    tags = sorted(t for t in r.stdout.split() if DEPLOY_RE.match(t))
    for tag in tags[:-keep]:
        quiet(["docker", "image", "rm", f"mirkomil/app-{app}:{tag}"])


# ---------------------------------------------------------------- the deploy job

def deploy(spec_path: Path) -> int:
    spec = validate_spec(json.loads(Path(spec_path).read_text()))
    job = Job(spec)
    app, did = spec["app"], spec["deploy_id"]
    adir = app_dir(app)
    try:
        image = spec["image"]
        commit = ""
        if image:
            job.step("rollback", f"Oldingi versiyaga qaytish: {image}")
            prev = json.loads((adir / "deploys" / image.split(":")[1] / "status.json").read_text())
            det_type, port = prev.get("type", "dockerfile"), int(prev.get("port") or 8000)
            web = is_public(det_type, spec["public"])
            commit = prev.get("commit", "")
        else:
            job.step("clone", f"Kod yuklanmoqda: {spec['repo']} ({spec['branch']})")
            src = adir / "src"
            shutil.rmtree(src, ignore_errors=True)
            out = sh(job, ["git", *GIT_SAFE, "clone", "--depth", "1", "--single-branch", "--branch", spec["branch"],
                           "--no-recurse-submodules", "--", spec["repo"], str(src)], timeout=600,
                     env=git_env(app, spec["repo"]), check=False)
            if not (src / ".git").is_dir():
                raise DeployError(clone_error(out, spec["repo"], spec["branch"]))
            os.chmod(src, 0o700)
            commit = quiet(["git", "-C", str(src), "log", "-1", "--format=%h %s"]).stdout.strip()[:200]
            job.status["commit_sha"] = quiet(["git", "-C", str(src), "rev-parse", "HEAD"]).stdout.strip()[:40]
            job.log(f"commit: {commit}")

            job.step("detect", "Loyiha turi aniqlanmoqda")
            try:
                d = detect(src, spec["type"])
            except DetectError as e:
                raise DeployError(str(e))
            det_type, web = d.type, is_public(d.type, spec["public"])
            job.log(f"tur: {d.type}" + (f" ({d.note})" if d.note else ""))
            job.log("sayt: " + (f"ha — {app}.{spec['domain']} (PORT muhit o'zgaruvchisidagi portda tinglashi kerak)"
                                if web else "yo'q — ichki ishlaydi (bot / fon jarayoni), tashqaridan ochilmaydi"))
            if not (src / ".dockerignore").exists():
                shutil.copy(TEMPLATES / "dockerignore", src / ".dockerignore")
            dockerfile = src / "Dockerfile"
            if d.type != "dockerfile":
                text = (TEMPLATES / f"{d.type}.Dockerfile").read_text()
                for k, v in d.vars.items():
                    text = text.replace("{{" + k + "}}", v)
                dockerfile = job.dir / "Dockerfile"
                dockerfile.write_text(text)

            job.step("build", "Docker obraz yig'ilmoqda (bir necha daqiqa olishi mumkin)")
            image = f"mirkomil/app-{app}:{did}"
            sh(job, ["docker", "build", "-t", image, "-f", str(dockerfile),
                     "--label", f"mirkomil.app={app}", "--label", f"mirkomil.deploy={did}", str(src)],
               timeout=1800, env={"DOCKER_BUILDKIT": "1"})
            # our templates always listen on 8000; a repo's own Dockerfile: its EXPOSEd port
            port = spec["port"] or (8000 if d.type != "dockerfile" else image_port(image)) or 8000

        job.status.update(type=det_type, web=web, port=port, commit=commit, image=image)
        job.save()

        job.step("proxy", "Ichki router (Caddy) tekshirilmoqda")
        ensure_proxy()

        job.step("start", "Yangi versiya ishga tushirilmoqda")
        name = run_container(job, spec, image, port, web)

        job.step("health", "Sog'liq tekshiruvi")
        if not healthy(job, name, port, web):
            r = quiet(["docker", "logs", "--tail", "40", name])
            logs = r.stdout + r.stderr
            job.log("--- konteyner loglari ---\n" + logs)
            quiet(["docker", "rm", "-f", name])
            raise DeployError("yangi versiya sog'liq tekshiruvidan o'tmadi — eski versiya ishlashda davom etadi")

        job.step("switch", "Trafik yangi versiyaga o'tkazilmoqda")
        if web and spec["domain"]:
            set_route(app, [f"{app}.{spec['domain']}"], f"{name}:{port}")
        elif app in load_routes():
            set_route(app, None, None)  # no longer a site: unpublish
        for old in app_containers(app):
            if old != name:
                quiet(["docker", "rm", "-f", old])
        write_shared(adir / "current.json", json.dumps({"deploy_id": did, "container": name, "image": image,
                                                        "port": port, "web": web, "type": det_type}))
        prune_images(app)
        if spec["domain"]:
            from ..helper import sync_tunnel_quietly
            tun = sync_tunnel_quietly()
            if tun != "off":
                job.log(f"Cloudflare Tunnel (DNS + marshrut): {tun}")
        job.finish("success", url=f"{_scheme()}://{app}.{spec['domain']}" if web and spec["domain"] else "")
        job.log("\n✓ Deploy muvaffaqiyatli tugadi")
        return 0
    except Exception as e:  # report every failure in the job status
        job.log(f"\n✗ Xato: {e}")
        job.finish("failed", error=str(e)[:500])
        return 1
