# shellcheck shell=bash
# 99 — Final summary: where to open the panel and what's left to do by hand.
MODULE_TITLE="Tayyor"

module_run() {
  local lan_ip ts_ip pw
  lan_ip="$(primary_ip)"; ts_ip="$(tailscale_ip || true)"
  pw="$(cat "$MK_STATE/ssh-password-auth" 2>/dev/null || echo "?")"

  {
    printf 'MK_INSTALLED_VERSION="%s"\n' "$MK_VERSION"
    printf 'MK_INSTALLED_AT="%s"\n' "$(date -Is)"
  } >"$MK_STATE/installed.env"

  if ((MK_CHANGES == 0)); then
    ok "Hammasi allaqachon to'g'ri sozlangan — hech narsa o'zgartirilmadi."
  else
    ok "$MK_CHANGES ta o'zgarish kiritildi."
  fi

  printf '\n%sPanel:%s\n' "$C_BOLD" "$C_RESET"
  [[ -n "$lan_ip" && "$MK_LAN_CIDR" != none ]] && printf '  Lokal tarmoq:  https://%s:9090\n' "$lan_ip"
  [[ -n "$ts_ip" ]] && printf '  Tailscale:     https://%s:9090\n' "$ts_ip"
  printf '  Login: Linux foydalanuvchi "%s" va uning paroli\n' "$MK_ADMIN_USER"

  printf '\n%sSSH:%s\n' "$C_BOLD" "$C_RESET"
  [[ -n "$ts_ip" ]] && printf '  ssh %s@%s   (Tailscale orqali, istalgan joydan)\n' "$MK_ADMIN_USER" "$ts_ip"
  [[ -n "$lan_ip" ]] && printf '  ssh %s@%s   (uy tarmog‘ida)\n' "$MK_ADMIN_USER" "$lan_ip"
  if [[ "$pw" == no ]]; then printf '  Parol bilan kirish o‘chirilgan — faqat SSH kalit.\n'; fi

  printf '\n%sQo‘lda qilinadigan ishlar:%s\n' "$C_BOLD" "$C_RESET"
  if [[ "$MK_TAILSCALE" == yes ]]; then
    printf '  1. https://login.tailscale.com/admin/machines → "%s" → ⋯ → "Disable key expiry"\n' "$MK_HOSTNAME"
  fi
  printf '  2. BIOS: "Restore on AC power loss" = On (tok kelganda server o‘zi yoqiladi)\n'
  if [[ "$pw" != no ]]; then
    printf '  3. SSH kalitini qo‘shing (ssh-copy-id), kalit bilan kiring, so‘ng: sudo mirkomil repair\n'
  fi

  printf '\nHolatni tekshirish: %smirkomil doctor%s    Log: %s\n\n' "$C_BOLD" "$C_RESET" "$MK_LOG"
  return 0
}
