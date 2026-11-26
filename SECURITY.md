# Security

## What this project is allowed to do

Mirkomil Server runs on a machine you own and administers it. The design goal is that **each part has
only the access it needs**, and that the web UI cannot become a remote shell.

| Component | Runs as | Can do | Cannot do |
|---|---|---|---|
| `install.sh` / installer | root (you run it with sudo) | install packages, write the managed config files listed in `installer/uninstall.sh` | run anything from the network except signed apt repos and the release tarball |
| Mirkomil Panel (Cockpit plugin) | the logged-in Linux user, in the browser | call actions in `panel/src/api/actions.ts` (fixed argv, validated params); privileged ones only with Cockpit "Administrative access" | run arbitrary commands, use a shell, load remote code (Cockpit's CSP blocks it) |
| `mirkomil-guardian` | system user `mirkomil` (no login, no sudo), heavy systemd sandboxing | read system state, store history in `/var/lib/mirkomil/guardian`, send Telegram messages, ask the helper for fixed verbs | write outside its state dir and `/run/mirkomil`, gain privileges (`NoNewPrivileges`, empty capability set) |
| `mirkomil-helper` | root | the verbs in `agent/mirkomil/helper.py` (`VERBS`), each with validated arguments | anything else; it only accepts requests from uid 0 and the `mirkomil` user (`SO_PEERCRED`) |

## Threat model

**In scope**

* A stolen/guessed panel session or a malicious browser extension trying to run commands → the panel
  has no generic "run" path; every process comes from the whitelist with argv arrays (no shell).
* A non-admin panel user trying to change Guardian rules → enforced in Guardian by kernel-verified
  uid → Linux groups (`mirkomil-admin`/`sudo`, `mirkomil-dev`, `mirkomil-viewer`), not by the UI.
* Internet-facing attacks → no ports are opened: Cockpit is reachable from the LAN subnet you choose
  and via Tailscale only; public access (later milestone) goes through Cloudflare Tunnel + Access.
* SSH brute force → key-only login (enabled only after key login is proven to work), fail2ban with
  increasing ban times.
* Lock-out by the installer → SSH port allowed before ufw is enabled, `sshd -t` validated with
  automatic rollback, Tailscale SSH as a second way in.
* Supply chain → packages come from Ubuntu's archive or the vendors' signed apt repos (Tailscale,
  Cloudflare); the agent uses only the Python standard library; the panel bundles everything at build
  time (no CDN). Release tarballs carry a SHA-256 file; `MK_SHA256` lets you pin it.

**Out of scope / known limits**

* Anyone who already has root (or `docker` group membership, which is root-equivalent) on the server.
  The installer never adds users to the `docker` group.
* The activity log uses `logger -t mirkomil-panel`; **any local user can write lines with that tag**,
  so it is an audit trail of normal use, not tamper-proof evidence.
* App secrets (later milestone) are protected by file permissions (`root`, `0600`), not encryption
  at rest — an encryption key stored on the same disk would add no real protection.
* Deploying an app builds its Dockerfile as root inside Docker; only deploy code you trust.

## Secrets

* `/etc/mirkomil/secrets.env` — root only (`0600`).
* `/etc/mirkomil/guardian.env` — Telegram token only, `root:mirkomil 0640`.
* Secrets are never passed on a logged command line, never stored in browser localStorage, and the
  contents of env files are never shown in the UI.

## Reporting a vulnerability

Please open a **private security advisory** on GitHub
(Security → Advisories → "Report a vulnerability") instead of a public issue. Include steps to
reproduce and the version (`mirkomil version`). We aim to answer within 7 days.
