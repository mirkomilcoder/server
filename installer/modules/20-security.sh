# shellcheck shell=bash
# 20 — Security: firewall (ufw), fail2ban, SSH hardening.
#
# Lockout protection (never lock the owner out):
#   - the SSH port is allowed in ufw BEFORE ufw is enabled;
#   - passwords are disabled only after proving that key login works for the
#     admin user (valid authorized_keys AND a real "Accepted publickey" in the journal);
#   - sshd -t validates the config before reload; a bad config is rolled back.
# shellcheck disable=SC2034  # read by installer/main.sh
MODULE_TITLE="Xavfsizlik: firewall, fail2ban, SSH"

module_run() {
  security_ufw
  security_fail2ban
  security_ssh
}

ssh_port() { sshd -T 2>/dev/null | awk '/^port / && !done {print $2; done=1}'; }

security_ufw() {
  apt_install ufw
  local port before after
  port="$(ssh_port)"; port="${port:-22}"
  before="$(ufw status verbose 2>/dev/null || true)"

  run ufw default deny incoming
  run ufw default allow outgoing
  run ufw limit "$port/tcp" comment 'SSH'
  run ufw allow in on tailscale0 comment 'Tailscale'
  if [[ "$MK_LAN_CIDR" != none ]]; then
    run ufw allow from "$MK_LAN_CIDR" to any port 9090 proto tcp comment 'Cockpit (LAN)'
  fi
  run ufw --force enable

  after="$(ufw status verbose)"
  if [[ "$before" != "$after" ]]; then changed "ufw qoidalari yangilandi"; fi
  ok "Firewall yoqilgan: kiruvchi taqiqlangan; ruxsat: SSH ($port), tailscale0${MK_LAN_CIDR:+, panel LAN ($MK_LAN_CIDR)}"
  info "Eslatma: Docker o'z portlarini ufw'dan chetlab ochadi — shuning uchun ilovalar faqat 127.0.0.1 ga bog'lanadi."
}

security_fail2ban() {
  apt_install fail2ban
  local before; before="$(cat /etc/fail2ban/jail.d/50-mirkomil.local 2>/dev/null || true)"
  install_file "$MK_SRC/configs/fail2ban/50-mirkomil.local" /etc/fail2ban/jail.d/50-mirkomil.local
  run fail2ban-client -t
  if [[ "$before" != "$(cat /etc/fail2ban/jail.d/50-mirkomil.local)" ]] || ! systemctl is-active -q fail2ban; then
    run systemctl enable fail2ban
    run systemctl restart fail2ban
  fi
  ok "fail2ban: SSH himoyalangan (5 xato → blok, takrorlansa uzayadi)"
}

# Returns 0 when we have evidence that the admin can log in with a key.
ssh_key_login_verified() {
  local user="$1" home keys
  home="$(getent passwd "$user" | cut -d: -f6)"
  keys="$home/.ssh/authorized_keys"
  [[ -s "$keys" ]] || return 1
  ssh-keygen -lf "$keys" >/dev/null 2>&1 || return 1
  # -r -n 1: newest match only (no pipe → no SIGPIPE false negatives)
  [[ -n "$(journalctl -q -r -n 1 --since "-60 days" -t sshd -t sshd-session -g "Accepted publickey for $user from" 2>/dev/null)" ]]
}

security_ssh() {
  local want="yes" conf=/etc/ssh/sshd_config.d/00-mirkomil.conf before
  case "$MK_SSH_PASSWORD_AUTH" in
    keep) want=yes ;;
    disable | auto)
      if ssh_key_login_verified "$MK_ADMIN_USER"; then
        want=no
      elif [[ "$MK_SSH_PASSWORD_AUTH" == disable ]]; then
        die "Parol bilan kirishni o'chirib bo'lmaydi: '$MK_ADMIN_USER' kalit bilan kirgani tasdiqlanmadi. Avval kalit bilan SSH orqali kiring."
      else
        want=yes
        warn "SSH parol bilan kirish HOZIRCHA yoqiq qoldirildi: '$MK_ADMIN_USER' SSH kaliti bilan kirgani topilmadi."
        warn "Kompyuteringizda: ssh-copy-id $MK_ADMIN_USER@<server>, keyin kalit bilan kiring va 'sudo mirkomil repair' ni ishga tushiring."
      fi
      ;;
  esac

  before="$(cat "$conf" 2>/dev/null || true)"
  MK_SSH_PASSWORD_AUTH_VALUE="$want" install_template "$MK_SRC/configs/ssh/00-mirkomil.conf.tmpl" "$conf"
  if [[ "$before" != "$(cat "$conf")" ]]; then
    if ! sshd -t >>"$MK_LOG" 2>&1; then
      # roll back: never leave sshd with a broken config
      if [[ -n "$before" ]]; then printf '%s\n' "$before" >"$conf"; else rm -f "$conf"; fi
      die "sshd konfiguratsiyasi xato — o'zgarish bekor qilindi. Log: $MK_LOG"
    fi
    # reload keeps existing sessions; with socket activation the service may be inactive
    if systemctl is-active -q ssh; then run systemctl reload ssh; fi
  fi
  printf '%s\n' "$want" >"$MK_STATE/ssh-password-auth"
  if [[ "$want" == no ]]; then
    ok "SSH: faqat kalit bilan, root kira olmaydi"
  else
    ok "SSH: root kira olmaydi (parol hali yoqiq)"
  fi
}
