#!/usr/bin/env bash
# Mirkomil Server installer — main entry point.
# Usually started by ../install.sh, but can be run directly from a checkout:
#   sudo ./installer/main.sh [--yes] [--config FILE] [--repair|--update|--uninstall] [--only 10,20]
set -Eeuo pipefail

MK_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/common.sh
. "$MK_SRC/installer/lib/common.sh"
# shellcheck source=lib/wizard.sh
. "$MK_SRC/installer/lib/wizard.sh"

usage() {
  cat <<EOF
Mirkomil Server o'rnatuvchisi $MK_VERSION

Foydalanish: sudo install.sh [parametrlar]

  (parametrsiz)     O'rnatish: savollar beriladi, keyin hammasi sozlanadi
  -y, --yes         Savolsiz: $MK_CONFIG yoki --config fayldagi qiymatlar ishlatiladi
  --config FAYL     Sozlamalar fayli (config.env namunasi: installer/config.example.env)
  --repair          Saqlangan sozlamalar bilan hammasini qayta tekshirish va tuzatish
  --update          Paketlarni yangilash + --repair
  --only 10,20      Faqat ko'rsatilgan modullarni ishga tushirish
  --uninstall       Mirkomil komponentlarini olib tashlash (ma'lumotlar saqlanadi)
  -h, --help        Shu yordam
EOF
}

ACTION=install
ONLY=""
CONFIG_ARG=""
while (($#)); do
  case "$1" in
    -y | --yes) MK_NONINTERACTIVE=1 ;;
    --config) CONFIG_ARG="${2:?--config: fayl yo‘li kerak}"; shift ;;
    --repair) ACTION=repair; MK_NONINTERACTIVE=1 ;;
    --update) ACTION=update; MK_NONINTERACTIVE=1 ;;
    --uninstall) ACTION=uninstall ;;
    --only) ONLY="${2:?--only: modul raqamlari kerak}"; shift ;;
    -h | --help) usage; exit 0 ;;
    --version) echo "$MK_VERSION"; exit 0 ;;
    *) usage; die "Noma'lum parametr: $1" ;;
  esac
  shift
done
export MK_NONINTERACTIVE="${MK_NONINTERACTIVE:-0}"

require_root
mkdir -p "$(dirname "$MK_LOG")" "$MK_STATE" "$MK_BACKUP_DIR"
touch "$MK_LOG"; chmod 0600 "$MK_LOG"
chmod 0700 "$MK_BACKUP_DIR"
_log_file "===== mirkomil installer $MK_VERSION action=$ACTION args: only=$ONLY config=$CONFIG_ARG ====="

CURRENT_MODULE=""
on_exit() {
  local rc=$?
  if ((rc)); then
    printf '\n%sO‘rnatish "%s" bosqichida to‘xtadi (kod %s).%s\n' "$C_RED" "${CURRENT_MODULE:-boshlash}" "$rc" "$C_RESET" >&2
    printf 'Log: %s\nTuzatgandan so‘ng qayta ishga tushiring — bu xavfsiz.\n' "$MK_LOG" >&2
  fi
}
trap on_exit EXIT

# ---- configuration: CLI file > saved config > wizard/defaults ----
[[ -n "$CONFIG_ARG" ]] && { [[ -r "$CONFIG_ARG" ]] || die "Fayl topilmadi: $CONFIG_ARG"; load_env_file "$CONFIG_ARG"; }
load_env_file "$MK_CONFIG"
load_env_file "$MK_SECRETS"

if [[ "$ACTION" == uninstall ]]; then
  # shellcheck source=uninstall.sh
  . "$MK_SRC/installer/uninstall.sh"
  uninstall_main
  exit 0
fi

if [[ "$ACTION" == install && ! -f "$MK_CONFIG" && -z "$CONFIG_ARG" ]] && is_interactive; then
  run_wizard
elif [[ "$ACTION" != install && ! -f "$MK_CONFIG" ]]; then
  die "Saqlangan sozlamalar yo'q ($MK_CONFIG). Avval o'rnating: sudo install.sh"
fi
config_defaults
validate_config
save_config
export MK_SRC MK_HOSTNAME MK_ADMIN_USER MK_TIMEZONE MK_LAN_CIDR MK_DOMAIN MK_TAILSCALE MK_SSH_PASSWORD_AUTH MK_TELEGRAM
[[ "$ACTION" == update ]] && MK_DO_UPGRADE=1 || MK_DO_UPGRADE=0
export MK_DO_UPGRADE

# ---- modules ----
for f in "$MK_SRC"/installer/modules/[0-9][0-9]-*.sh; do
  num="$(basename "$f" | cut -c1-2)"
  if [[ -n "$ONLY" && ",$ONLY," != *",$num,"* && "$num" != 00 && "$num" != 99 ]]; then continue; fi
  unset -f module_run
  MODULE_TITLE=""
  # shellcheck source=/dev/null
  . "$f"
  CURRENT_MODULE="$(basename "$f" .sh)"
  section "$MODULE_TITLE"
  module_run
done

CURRENT_MODULE=""
trap - EXIT
