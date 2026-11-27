# shellcheck shell=bash
# shellcheck disable=SC2034  # shared settings (MK_*, colours) are used by the files that source this one
# Shared helpers for the Mirkomil Server installer.
# Sourced by installer/main.sh, the modules, and the `mirkomil` CLI.
#
# Conventions:
#   - Every function is idempotent where it changes the system.
#   - Commands are run through `run` so stdout/stderr go to the log file,
#     the console stays clean, and failures are reported with context.
#   - Secrets are never passed to `run` (it logs the command line);
#     use `run_quiet_secret` for those.

MK_VERSION="${MK_VERSION:-0.1.0}"
MK_ETC="/etc/mirkomil"
MK_CONFIG="$MK_ETC/config.env"
MK_SECRETS="$MK_ETC/secrets.env"
MK_OPT="/opt/mirkomil"
MK_STATE="/var/lib/mirkomil"
MK_BACKUP_DIR="/var/backups/mirkomil"
MK_LOG="${MK_LOG:-/var/log/mirkomil-install.log}"
MK_MANAGED_HEADER="Managed by mirkomil-server — edits are overwritten by install.sh"

# Counts real changes made in this run (for the "nothing changed" summary).
MK_CHANGES=0

# ---------- output ----------

if [[ -t 1 ]]; then
  C_RESET=$'\e[0m'; C_DIM=$'\e[2m'; C_BOLD=$'\e[1m'
  C_GREEN=$'\e[32m'; C_YELLOW=$'\e[33m'; C_RED=$'\e[31m'; C_CYAN=$'\e[36m'
else
  C_RESET=''; C_DIM=''; C_BOLD=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_CYAN=''
fi

_log_file() {
  # The log may not be writable yet (non-root dry checks) — never fail on it.
  # (the braces make 2>/dev/null also cover a failing >> redirection)
  { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$MK_LOG"; } 2>/dev/null || true
}

section() { printf '\n%s==> %s%s\n' "$C_BOLD$C_CYAN" "$*" "$C_RESET"; _log_file "== $*"; }
info()    { printf '  %s\n' "$*"; _log_file "INFO $*"; }
ok()      { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; _log_file "OK   $*"; }
changed() { MK_CHANGES=$((MK_CHANGES + 1)); printf '  %s+%s %s\n' "$C_CYAN" "$C_RESET" "$*"; _log_file "CHG  $*"; }
warn()    { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; _log_file "WARN $*"; }
die()     { printf '\n%sXato:%s %s\n' "$C_RED$C_BOLD" "$C_RESET" "$*" >&2; _log_file "FAIL $*"; exit 1; }

# run CMD [ARGS...] — run a command, output to the log only. Fails loudly.
run() {
  _log_file "RUN  $*"
  if ! "$@" >>"$MK_LOG" 2>&1; then
    warn "Buyruq bajarilmadi: $*"
    warn "Batafsil: $MK_LOG"
    return 1
  fi
}

# Like run, but the command line is NOT logged (it contains a secret).
run_quiet_secret() {
  local label="$1"; shift
  _log_file "RUN  $label (argumentlar yashirilgan)"
  "$@" >>"$MK_LOG" 2>&1
}

# ---------- environment checks ----------

require_root() {
  [[ ${EUID:-$(id -u)} -eq 0 ]] || die "root kerak. Shunday ishga tushiring: sudo $0 $*"
}

is_interactive() {
  [[ "${MK_NONINTERACTIVE:-0}" != 1 ]] && [[ -r /dev/tty ]] && { : </dev/tty; } 2>/dev/null
}

have() { command -v "$1" >/dev/null 2>&1; }

# ---------- validation (pure functions; covered by tests/bats) ----------

valid_hostname() {
  # RFC 1123 label, lowercase, 1–63 chars.
  [[ "$1" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]
}

valid_username() {
  [[ "$1" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] && [[ "$1" != root ]]
}

valid_timezone() {
  [[ "$1" =~ ^[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+){0,2}$ ]] && [[ -e "/usr/share/zoneinfo/$1" ]]
}

valid_cidr() {
  local ip mask o
  [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]] || return 1
  ip="${1%/*}"; mask="${1#*/}"
  ((mask <= 32)) || return 1
  IFS=. read -r -a o <<<"$ip"
  for x in "${o[@]}"; do ((x <= 255)) || return 1; done
}

valid_yesno() { [[ "$1" == yes || "$1" == no ]]; }

# Display name like "Mirkomil Host": 2–40 chars, no characters that could
# break the CSS/INI/env files it is written into.
valid_brand() {
  # bracket expression: " \ < > { } ; ` $  (backslash is literal inside [...])
  local re='["\<>{};`$]' nl=$'\n'
  [[ ${#1} -ge 2 && ${#1} -le 40 && "$1" != *"$nl"* ]] && ! [[ "$1" =~ $re ]]
}

# Registrable domain like mirkomil-host.uz (lowercase, ≥2 labels, no wildcard).
valid_domain() {
  [[ ${#1} -le 253 ]] && [[ "$1" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]
}

# ---------- config files (KEY="value") ----------

# Parse a KEY=value file WITHOUT sourcing it (no code execution).
# Only UPPER_CASE keys with an allowed prefix are accepted.
load_env_file() {
  local file="$1" line key val
  [[ -r "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    if [[ "$line" =~ ^(MK_[A-Z0-9_]+|TS_[A-Z0-9_]+|TELEGRAM_[A-Z0-9_]+|CF_[A-Z0-9_]+)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
      # strip one level of matching quotes
      if [[ "$val" =~ ^\"(.*)\"$ || "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
      # environment variables given on the command line win over the file
      if [[ -z "${!key+x}" ]]; then printf -v "$key" '%s' "$val"; fi
    else
      warn "$file: noto'g'ri qator o'tkazib yuborildi: ${line:0:40}"
    fi
  done <"$file"
  # explicit: a false test on the last line must not become the function's status (set -e)
  return 0
}

# set_env_key FILE KEY VALUE — add or replace one line (value is quoted).
set_env_key() {
  local file="$1" key="$2" val="$3" tmp
  [[ "$val" != *$'\n'* && "$val" != *'"'* ]] || die "$key qiymatida ruxsat etilmagan belgi bor"
  tmp="$(mktemp)"
  if [[ -f "$file" ]]; then grep -v "^${key}=" "$file" >"$tmp" || true; fi
  printf '%s="%s"\n' "$key" "$val" >>"$tmp"
  cat "$tmp" >"$file"; rm -f "$tmp"
}

# ---------- files ----------

# install_file SRC DST MODE — copy a managed file; back up a foreign original.
# Prints "+" only if the content actually changed (idempotent).
install_file() {
  local src="$1" dst="$2" mode="${3:-0644}"
  if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
    run chmod "$mode" "$dst"
    return 0
  fi
  if [[ -f "$dst" ]] && ! grep -q "$MK_MANAGED_HEADER" "$dst"; then
    local bak
    bak="$MK_BACKUP_DIR$dst.$(date +%Y%m%d%H%M%S)"
    mkdir -p "$(dirname "$bak")"
    cp -a "$dst" "$bak"
    info "Asl fayl saqlandi: $bak"
  fi
  mkdir -p "$(dirname "$dst")"
  install -m "$mode" -o root -g root "$src" "$dst"
  changed "$dst"
  return 0
}

# render_template SRC — print SRC with {{MK_VAR}} replaced by validated values.
render_template() {
  local text var val i=0
  text="$(cat "$1")"
  while [[ "$text" =~ \{\{(MK_[A-Z0-9_]+)\}\} ]] && ((i++ < 100)); do
    var="${BASH_REMATCH[1]}"
    val="${!var-}"
    # quoted replacement: bash 5.2 would otherwise treat "&" specially
    text="${text//"{{$var}}"/"$val"}"
  done
  printf '%s\n' "$text"
}

# install_template SRC DST MODE — render then install_file.
install_template() {
  local tmp; tmp="$(mktemp)"
  render_template "$1" >"$tmp"
  install_file "$tmp" "$2" "${3:-0644}"
  rm -f "$tmp"
}

# ---------- apt ----------

export DEBIAN_FRONTEND=noninteractive
# Retries: home internet blips (or a mirror refusing for a minute) must not abort the install.
APT_NET=(-o Acquire::Retries=5 -o Acquire::http::Timeout=30)
APT_OPTS=(-y -q "${APT_NET[@]}" -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

pkg_installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed"; }

# apt_install PKG... — installs only what is missing.
apt_install() {
  local missing=() p
  for p in "$@"; do pkg_installed "$p" || missing+=("$p"); done
  ((${#missing[@]})) || return 0
  info "O'rnatilmoqda: ${missing[*]}"
  run apt-get install "${APT_OPTS[@]}" --no-install-recommends "${missing[@]}"
  changed "paketlar: ${missing[*]}"
}

MK_APT_UPDATED=0
apt_update() {
  ((MK_APT_UPDATED)) && return 0
  run apt-get update -q "${APT_NET[@]}"
  MK_APT_UPDATED=1
}

# add_apt_repo NAME KEY_URL LIST_LINE — signed third-party repo (keyring per repo).
add_apt_repo() {
  local name="$1" key_url="$2" line="$3"
  local keyring="/usr/share/keyrings/${name}-archive-keyring.gpg"
  local list="/etc/apt/sources.list.d/${name}.list"
  local tmpkey; tmpkey="$(mktemp)"
  run curl -fsSL --proto '=https' --tlsv1.2 -o "$tmpkey" "$key_url"
  # Accept both armored and binary keys; store binary.
  if grep -q "BEGIN PGP PUBLIC KEY" "$tmpkey"; then
    gpg --dearmor <"$tmpkey" >"$tmpkey.bin" 2>>"$MK_LOG" && mv "$tmpkey.bin" "$tmpkey"
  fi
  if [[ ! -f "$keyring" ]] || ! cmp -s "$tmpkey" "$keyring"; then
    install -m 0644 "$tmpkey" "$keyring"; changed "$keyring"
  fi
  rm -f "$tmpkey"
  if [[ "$(cat "$list" 2>/dev/null)" != "$line" ]]; then
    printf '%s\n' "$line" >"$list"; changed "$list"
    MK_APT_UPDATED=0
  fi
}

# ---------- cockpit ----------

# Write /etc/cockpit/cockpit.conf. Mirkomil Panel becomes Cockpit's shell (the
# page shown after login) only when it is really installed — otherwise login
# would land on a missing page. Called by 50-cockpit and again by 60-panel.
cockpit_conf_apply() {
  local conf=/etc/cockpit/cockpit.conf before
  if [[ -f /usr/share/cockpit/mirkomil/index.html ]]; then
    MK_COCKPIT_SHELL_LINE="Shell = /mirkomil/index.html"
  else
    MK_COCKPIT_SHELL_LINE="# Shell: Cockpit default (Mirkomil Panel is not installed yet)"
  fi
  # Login only through Cloudflare Access (module 75): Cockpit's OAuth login fetches the
  # Access token from /mk-sso and our socket service verifies it.
  local host
  host="$(jq -r '.panel_host // empty' /var/lib/mirkomil/tunnel/state.json 2>/dev/null || true)"
  MK_COCKPIT_SSO=""
  if [[ "${MK_SSO:-no}" == yes && -n "$host" && -f /etc/systemd/system/mirkomil-sso.socket ]]; then
    MK_COCKPIT_SSO="
# Login only through Cloudflare Access (https://$host). Undo from SSH: sudo mirkomil sso off
[OAuth]
URL = https://$host/mk-sso
ErrorParam = error
TokenParam = access_token

[bearer]
UnixPath = /run/mirkomil-sso.sock"
  fi
  before="$(cat "$conf" 2>/dev/null || true)"
  install_template "$MK_SRC/configs/cockpit/cockpit.conf.tmpl" "$conf"
  if [[ "$before" != "$(cat "$conf")" ]] && systemctl is-active -q cockpit.service; then
    if [[ "${MK_DEFER_COCKPIT_RESTART:-0}" == 1 ]]; then
      # applied from the panel itself: restart a few seconds later so the
      # request that triggered it can still be answered
      run systemd-run --quiet --collect --on-active=8 --unit=mirkomil-cockpit-restart systemctl restart cockpit.service || true
    else
      # drops open web sessions only; cockpit.socket keeps listening
      run systemctl restart cockpit.service
    fi
  fi
  return 0
}

# ---------- misc ----------
# NOTE: never use `awk '{...; exit}'` after a pipe here: with `set -o pipefail`
# the writer gets SIGPIPE (exit 141) and the installer aborts.

os_release() {
  # subshell: os-release variables must not leak into the installer
  # shellcheck disable=SC1091
  (. /etc/os-release && printf '%s' "${!1:-}")
}

default_iface() { ip -4 route show default 2>/dev/null | awk '!done {print $5; done=1}'; }

# CIDR of the LAN the default route goes through, e.g. 192.168.1.0/24.
detect_lan_cidr() {
  local iface; iface="$(default_iface)"
  [[ -n "$iface" ]] || return 1
  ip -4 route show dev "$iface" scope link proto kernel 2>/dev/null | awk '!done {print $1; done=1}'
}

primary_ip() { ip -4 -o addr show dev "$(default_iface)" 2>/dev/null | awk '!done {print $4; done=1}' | cut -d/ -f1; }

tailscale_ip() { have tailscale && tailscale ip -4 2>/dev/null | awk '!d {print; d=1}'; }
