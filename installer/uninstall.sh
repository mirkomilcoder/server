# shellcheck shell=bash
# Removes Mirkomil's own configuration and tools. Deliberately KEEPS:
#   - installed packages (Docker, Cockpit, Tailscale, ...) — they may be in use;
#   - all data (Docker volumes, apps, databases, home directories);
#   - the firewall enabled (turning it off silently would be unsafe).
# The original files we replaced are restored from /var/backups/mirkomil.

MANAGED_FILES=(
  /etc/apt/apt.conf.d/52mirkomil-unattended-upgrades
  /etc/apt/apt.conf.d/21mirkomil-auto-upgrades
  /etc/systemd/logind.conf.d/50-mirkomil.conf
  /etc/systemd/journald.conf.d/50-mirkomil.conf
  /etc/sysctl.d/90-mirkomil.conf
  /etc/ssh/sshd_config.d/00-mirkomil.conf
  /etc/fail2ban/jail.d/50-mirkomil.local
  /etc/cockpit/cockpit.conf
  /etc/docker/daemon.json
  /usr/local/bin/mirkomil
  /etc/systemd/system/mirkomil-guardian.service
  /etc/systemd/system/mirkomil-helper.service
  /etc/tmpfiles.d/mirkomil.conf
)

uninstall_main() {
  section "Mirkomil komponentlarini olib tashlash"
  info "Paketlar, ma'lumotlar va firewall saqlanadi; faqat Mirkomil sozlamalari olib tashlanadi."
  if is_interactive && [[ "$MK_NONINTERACTIVE" != 1 ]]; then
    local host ans
    host="$(hostname -s)"
    printf 'Tasdiqlash uchun server nomini yozing (%s): ' "$host" >/dev/tty
    IFS= read -r ans </dev/tty
    [[ "$ans" == "$host" ]] || die "Bekor qilindi."
  fi

  local f bak
  systemctl disable --now mirkomil-guardian.service mirkomil-helper.service >>"$MK_LOG" 2>&1 || true
  for f in "${MANAGED_FILES[@]}"; do
    [[ -e "$f" ]] || continue
    # never delete a file we don't manage (daemon.json has no header: compare content)
    if grep -q "$MK_MANAGED_HEADER" "$f" 2>/dev/null || cmp -s "$f" "$MK_SRC/configs/docker/daemon.json" || [[ "$f" == /usr/local/bin/mirkomil ]]; then
      bak="$(ls -1t "$MK_BACKUP_DIR$f".* 2>/dev/null | head -n1 || true)"
      if [[ -n "$bak" ]]; then cp -a "$bak" "$f"; info "Tiklandi: $f"; else rm -f "$f"; info "O'chirildi: $f"; fi
    fi
  done

  if sshd -t >>"$MK_LOG" 2>&1 && systemctl is-active -q ssh; then run systemctl reload ssh; fi
  run systemctl kill -s HUP systemd-logind || true
  run systemctl restart systemd-journald || true
  if systemctl is-active -q fail2ban; then run systemctl restart fail2ban || true; fi
  for t in sleep.target suspend.target hibernate.target hybrid-sleep.target suspend-then-hibernate.target; do
    run systemctl unmask "$t" || true
  done

  rm -rf /usr/share/cockpit/mirkomil
  systemctl daemon-reload >>"$MK_LOG" 2>&1 || true
  info "Guardian tarixi saqlandi: /var/lib/mirkomil/guardian (kerak bo'lmasa o'chiring)"
  rm -f /usr/share/cockpit/branding/ubuntu/inter.woff2 /usr/share/cockpit/branding/ubuntu/display.woff2
  # restore Cockpit's own branding files (see 60-panel.sh: dpkg-divert)
  for f in branding.css logo.svg; do
    if dpkg-divert --list "/usr/share/cockpit/branding/ubuntu/$f" | grep -q mirkomil; then
      rm -f "/usr/share/cockpit/branding/ubuntu/$f"
      run dpkg-divert --package mirkomil-server --remove --rename "/usr/share/cockpit/branding/ubuntu/$f" || true
    fi
  done
  rm -rf "$MK_OPT"
  # installer state files only: Guardian history (a subdirectory) is kept
  find "$MK_STATE" -maxdepth 1 -type f -delete 2>/dev/null || true
  info "Sozlamalar ($MK_ETC) saqlandi — kerak bo'lmasa: sudo rm -rf $MK_ETC"
  ok "Tayyor. Paketlarni olib tashlash (ixtiyoriy): sudo apt purge tailscale cockpit*"
}
