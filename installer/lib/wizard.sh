# shellcheck shell=bash
# Interactive setup questions.
#
# All prompts read from /dev/tty, so they work even when the installer is
# piped:  curl -fsSL .../install.sh | sudo bash
# whiptail is used when available, otherwise plain prompts.

_use_whiptail() { have whiptail && [[ -n "${TERM:-}" && "${TERM}" != dumb ]]; }

# ask_input VAR "Question" DEFAULT VALIDATOR
ask_input() {
  local var="$1" q="$2" def="$3" validator="$4" ans
  while :; do
    if _use_whiptail; then
      ans="$(whiptail --title "Mirkomil Server" --inputbox "$q" 10 70 "$def" 3>&1 1>&2 2>&3 </dev/tty)" ||
        die "O'rnatish bekor qilindi."
    else
      printf '%s%s%s [%s]: ' "$C_BOLD" "$q" "$C_RESET" "$def" >/dev/tty
      IFS= read -r ans </dev/tty || die "O'rnatish bekor qilindi."
    fi
    ans="${ans:-$def}"
    if "$validator" "$ans"; then printf -v "$var" '%s' "$ans"; return 0; fi
    _wizard_error "Noto'g'ri qiymat: '$ans'. Qayta kiriting."
  done
}

# ask_yesno VAR "Question" DEFAULT(yes|no)
ask_yesno() {
  local var="$1" q="$2" def="$3" ans
  if _use_whiptail; then
    local flag=()
    [[ "$def" == no ]] && flag=(--defaultno)
    if whiptail --title "Mirkomil Server" "${flag[@]}" --yes-button "Ha" --no-button "Yo'q" \
      --yesno "$q" 10 70 </dev/tty >/dev/tty 2>&1; then ans=yes; else ans=no; fi
  else
    local hint="h/Y"; [[ "$def" == yes ]] && hint="H/y"
    printf '%s%s%s [%s]: ' "$C_BOLD" "$q" "$C_RESET" "$hint" >/dev/tty
    IFS= read -r ans </dev/tty || die "O'rnatish bekor qilindi."
    case "${ans,,}" in h | ha | y | yes) ans=yes ;; "" ) ans="$def" ;; *) ans=no ;; esac
  fi
  printf -v "$var" '%s' "$ans"
}

# ask_secret VAR "Question" — empty allowed; never echoed or logged.
ask_secret() {
  local var="$1" q="$2" ans
  if _use_whiptail; then
    ans="$(whiptail --title "Mirkomil Server" --passwordbox "$q" 10 70 3>&1 1>&2 2>&3 </dev/tty)" || ans=""
  else
    printf '%s%s%s (bo‘sh qoldirish mumkin): ' "$C_BOLD" "$q" "$C_RESET" >/dev/tty
    IFS= read -rs ans </dev/tty || ans=""
    printf '\n' >/dev/tty
  fi
  printf -v "$var" '%s' "$ans"
}

_wizard_error() {
  if _use_whiptail; then
    whiptail --title "Mirkomil Server" --msgbox "$1" 8 70 </dev/tty >/dev/tty 2>&1
  else
    printf '%s%s%s\n' "$C_RED" "$1" "$C_RESET" >/dev/tty
  fi
}

_valid_lan() { [[ "$1" == none ]] || valid_cidr "$1"; }
_valid_any() { :; }
_valid_ts_key() { [[ -z "$1" || "$1" =~ ^tskey-[A-Za-z0-9-]+$ ]]; }
_valid_tg_token() { [[ -z "$1" || "$1" =~ ^[0-9]{5,15}:[A-Za-z0-9_-]{30,50}$ ]]; }
_valid_tg_chat() { [[ "$1" =~ ^-?[0-9]{3,20}$ ]]; }

# Fill MK_* defaults (used by both the wizard and --yes mode).
config_defaults() {
  : "${MK_HOSTNAME:=$(hostname -s | tr '[:upper:]' '[:lower:]')}"
  : "${MK_ADMIN_USER:=${SUDO_USER:-}}"
  : "${MK_TIMEZONE:=Asia/Tashkent}"
  : "${MK_LAN_CIDR:=$(detect_lan_cidr || echo none)}"
  : "${MK_TAILSCALE:=yes}"
  : "${MK_SSH_PASSWORD_AUTH:=auto}"
  : "${MK_TELEGRAM:=no}"
  # Hosting domain: panel.<domain>, <app>.<domain>. Used from M6 (Cloudflare Tunnel).
  : "${MK_DOMAIN:=mirkomil-host.uz}"
}

run_wizard() {
  config_defaults
  local tmp
  if _use_whiptail; then
    whiptail --title "Mirkomil Server $MK_VERSION" --msgbox \
      "Assalomu alaykum!\n\nBu dastur serveringizni xavfsiz va o'zini o'zi tiklaydigan uy serveriga aylantiradi.\nBir nechta savolga javob bering — qolganini o'zi qiladi.\n\nIstalgan vaqtda qayta ishga tushirish xavfsiz." \
      14 70 </dev/tty >/dev/tty 2>&1
  else
    printf '\n%sMirkomil Server %s — sozlash%s\n\n' "$C_BOLD" "$MK_VERSION" "$C_RESET" >/dev/tty
  fi

  ask_input MK_HOSTNAME "Server nomi (hostname):" "$MK_HOSTNAME" valid_hostname
  ask_input MK_ADMIN_USER "Administrator foydalanuvchi (Linux login):" "$MK_ADMIN_USER" valid_username
  ask_input MK_TIMEZONE "Vaqt mintaqasi:" "$MK_TIMEZONE" valid_timezone
  ask_input MK_LAN_CIDR "Panelga ruxsat beriladigan lokal tarmoq (yoki 'none'):" "$MK_LAN_CIDR" _valid_lan
  ask_input MK_DOMAIN "Hosting domeni (panel.<domen>, <ilova>.<domen>):" "$MK_DOMAIN" valid_domain

  ask_yesno MK_TAILSCALE "Tailscale o'rnatilsinmi? (serverga istalgan joydan xavfsiz kirish, port ochmasdan)" "$MK_TAILSCALE"
  if [[ "$MK_TAILSCALE" == yes && -z "${TS_AUTHKEY:-}" ]]; then
    while :; do
      ask_secret tmp "Tailscale auth key (bo'sh = brauzer orqali kirish havolasi ko'rsatiladi)"
      _valid_ts_key "$tmp" && break
      _wizard_error "Kalit 'tskey-...' bilan boshlanishi kerak."
    done
    TS_AUTHKEY="$tmp"
  fi

  ask_yesno MK_TELEGRAM "Telegram orqali ogohlantirishlar yoqilsinmi? (Guardian uchun, keyinroq ham yoqish mumkin)" "$MK_TELEGRAM"
  if [[ "$MK_TELEGRAM" == yes ]]; then
    while :; do
      ask_secret tmp "Telegram bot token (@BotFather'dan)"
      [[ -n "$tmp" ]] && _valid_tg_token "$tmp" && break
      _wizard_error "Token formati: 123456789:ABC..."
    done
    TELEGRAM_BOT_TOKEN="$tmp"
    ask_input TELEGRAM_CHAT_ID "Telegram chat ID (masalan 123456789):" "${TELEGRAM_CHAT_ID:-}" _valid_tg_chat
  fi
}

validate_config() {
  valid_hostname "$MK_HOSTNAME"       || die "MK_HOSTNAME noto'g'ri: '$MK_HOSTNAME'"
  valid_username "$MK_ADMIN_USER"     || die "MK_ADMIN_USER noto'g'ri yoki bo'sh. config.env da ko'rsating."
  valid_timezone "$MK_TIMEZONE"       || die "MK_TIMEZONE noto'g'ri: '$MK_TIMEZONE'"
  _valid_lan "$MK_LAN_CIDR"           || die "MK_LAN_CIDR noto'g'ri: '$MK_LAN_CIDR'"
  valid_domain "$MK_DOMAIN"           || die "MK_DOMAIN noto'g'ri: '$MK_DOMAIN'"
  valid_yesno "$MK_TAILSCALE"         || die "MK_TAILSCALE yes yoki no bo'lishi kerak"
  valid_yesno "$MK_TELEGRAM"          || die "MK_TELEGRAM yes yoki no bo'lishi kerak"
  [[ "$MK_SSH_PASSWORD_AUTH" =~ ^(auto|keep|disable)$ ]] || die "MK_SSH_PASSWORD_AUTH: auto | keep | disable"
  _valid_ts_key "${TS_AUTHKEY:-}"     || die "TS_AUTHKEY formati noto'g'ri"
  _valid_tg_token "${TELEGRAM_BOT_TOKEN:-}" || die "TELEGRAM_BOT_TOKEN formati noto'g'ri"
  id "$MK_ADMIN_USER" >/dev/null 2>&1 || die "Foydalanuvchi '$MK_ADMIN_USER' mavjud emas. Avval uni yarating (adduser)."
}

save_config() {
  mkdir -p "$MK_ETC"; chmod 0755 "$MK_ETC"
  if [[ ! -f "$MK_CONFIG" ]]; then
    printf '# %s\n# Mirkomil Server sozlamalari (maxfiy emas). Maxfiy kalitlar: %s\n' \
      "$MK_MANAGED_HEADER" "$MK_SECRETS" >"$MK_CONFIG"
  fi
  local k
  for k in MK_HOSTNAME MK_ADMIN_USER MK_TIMEZONE MK_LAN_CIDR MK_DOMAIN MK_TAILSCALE MK_SSH_PASSWORD_AUTH MK_TELEGRAM; do
    set_env_key "$MK_CONFIG" "$k" "${!k}"
  done
  chmod 0644 "$MK_CONFIG"

  # Secrets: root-only file, created with a safe umask BEFORE writing anything.
  (umask 077 && touch "$MK_SECRETS")
  chown root:root "$MK_SECRETS"; chmod 0600 "$MK_SECRETS"
  [[ -n "${TS_AUTHKEY:-}" ]] && set_env_key "$MK_SECRETS" TS_AUTHKEY "$TS_AUTHKEY"
  [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]] && set_env_key "$MK_SECRETS" TELEGRAM_BOT_TOKEN "$TELEGRAM_BOT_TOKEN"
  [[ -n "${TELEGRAM_CHAT_ID:-}" ]] && set_env_key "$MK_CONFIG" TELEGRAM_CHAT_ID "$TELEGRAM_CHAT_ID"
  return 0
}
