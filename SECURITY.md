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
* File manager → runs with the logged-in user's own Linux permissions. Directory operations are
  whitelisted argv actions (`find`, `mv`, `cp`, `rm`, `tar`, `python3 -m zipfile`) with every path
  validated as normalised and absolute and passed after `--`/`-t`/`-T`; `/` and top-level system
  folders can never be deleted, moved or chmod-ed; moves and copies never overwrite
  (`--update=none-fail`); archives are unpacked without `..`/absolute members and without
  overwriting. Contents travel over Cockpit file channels (uploads in chunks with flow control,
  written atomically; edits refuse to overwrite a file changed meanwhile). "Admin rejimi" needs
  Cockpit administrative access, runs the same actions as root and logs each one. File content
  is shown only as plain text or as an image — never rendered as HTML.
* A non-admin panel user trying to change Guardian rules → enforced in Guardian by kernel-verified
  uid → Linux groups (`mirkomil-admin`/`sudo`, `mirkomil-dev`, `mirkomil-viewer`), not by the UI.
* Internet-facing attacks → no ports are opened: Cockpit is reachable from the LAN subnet you choose
  and via Tailscale only. Public access goes through an outbound-only Cloudflare Tunnel:
  `panel.<domain>` is protected by Cloudflare Access (allow-listed emails, 7-day session) **and**
  cloudflared validates the Access JWT itself (`originRequest.access.required`), so a misconfigured
  Access app or a direct hit on the tunnel cannot skip it; Cockpit's own login still follows.
  Apps are served through the Caddy router bound to 127.0.0.1 only; databases and Docker are never
  routed. cloudflared runs as a DynamicUser with an empty capability set (exposure score 1.7).
* Cloudflare API token → typed once in the panel, passed to the root helper over the local socket,
  stored in `/var/lib/mirkomil/tunnel/private/api_token` (`root`, `0600`), never logged or returned.
  Use a token scoped to the listed permissions and the one zone. Only DNS records created by
  Mirkomil (comment `mirkomil`) are ever modified or deleted.
* Panel users → each one is a normal Linux account with exactly one role group
  (`mirkomil-admin` / `mirkomil-dev` / `mirkomil-viewer`); the panel never grants `sudo` or
  root-equivalent groups (`docker`, `lxd`, `disk`, `shadow`) and can't change the server owner
  (members of `sudo`) or the caller's own account. New users get a random one-time password, shown
  once on the invite card and never stored or logged, and must set their own at first login.
  Developers and viewers see only the apps they created or were assigned (enforced by Guardian;
  others get 404). Own password changes run `passwd` in a pty as the user, so PAM verifies the
  current password; the passwords are written only to that pty.
* Admin mode → by default Cockpit asks for the Linux password every time admin mode is switched
  on; "Admin rejimini eslab qolish" (opt-in) lets Cockpit re-enable it at login with the login password.
* Login only through Cloudflare (SSO, on by default once a domain is connected) → `panel.<domain>`
  is protected by Cloudflare Access (Google / GitHub / email code); only the super-admin emails
  are allowed and cloudflared rejects requests without a valid Access token for the app. Cockpit's
  own login page is configured for OAuth: `/mk-sso` hands the request's Access token back **only**
  to `https://panel.<domain>` (no open redirect; control characters refused), and Cockpit passes it
  as `Authorization: Bearer` to `/run/mirkomil-sso.sock` (root, reachable only by cockpit-ws's
  group). There the RS256 signature is verified against the team's public keys (standard-library
  RSA), plus issuer, audience, expiry, super-admin email, and that the request came through the
  tunnel (loopback peer). The session then runs as the dedicated account `mkadmin`: password
  locked, no SSH key. **`mkadmin` is root-equivalent**: its sudo rule (`python3 -ic *`, the only
  form sudo-rs can match for Cockpit's admin bridge) needs no password, so whoever controls a
  listed Google/GitHub account controls the server — keep that list short and those accounts
  protected with 2-step verification. Every SSO login is logged with the email
  (`journalctl -t mirkomil-sso`). LAN/Tailscale password login is off while SSO is on; the way
  back in is SSH: `sudo mirkomil sso off`.
* Google / GitHub client secrets → passed straight to Cloudflare, never stored on the server.
* GitHub webhooks → a listener inside Guardian bound to 127.0.0.1:8099 only, reachable from the
  internet solely through the Cloudflare Tunnel host `hooks.<domain>`. It accepts nothing but
  `POST /github/<app>` (body ≤ 5 MB); each app has its own random secret and the
  `X-Hub-Signature-256` HMAC is verified in constant time before the body is parsed. Unknown apps,
  apps without a webhook and bad signatures get the same terse answer. Only a push to the app's
  configured branch starts a deploy; concurrent pushes are queued, never run in parallel.
* Apps as sites → web frameworks (Django, FastAPI, Flask, static) are always published; bots and
  workers (e.g. aiogram) stay private unless explicitly published (e.g. for a webhook).
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
* Secrets are never passed on a logged command line and never stored in browser localStorage.
  Server secret files are never shown in the UI. An app's own env values are shown (masked until
  revealed) only to developers/admins with access to that app, fetched when the Env tab is opened,
  and every opening is written to the activity log; change logs list key names, never values.

## Reporting a vulnerability

Please open a **private security advisory** on GitHub
(Security → Advisories → "Report a vulnerability") instead of a public issue. Include steps to
reproduce and the version (`mirkomil version`). We aim to answer within 7 days.
