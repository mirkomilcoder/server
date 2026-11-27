# shellcheck shell=bash
# 10 — Base system: hostname, timezone, updates, base packages, no sleep,
#      journald limits, sysctl hardening, the `mirkomil` CLI.
# shellcheck disable=SC2034  # read by installer/main.sh
MODULE_TITLE="Asosiy tizim"

BASE_PACKAGES=(
  ca-certificates curl gnupg jq git rsync psmisc
  unattended-upgrades apt-listchanges needrestart
  smartmontools lm-sensors whiptail sqlite3 python3
)

module_run() {
  local cfg="$MK_SRC/configs"

  # hostname (+ /etc/hosts so sudo doesn't complain about resolving it)
  if [[ "$(hostnamectl --static 2>/dev/null)" != "$MK_HOSTNAME" ]]; then
    run hostnamectl set-hostname "$MK_HOSTNAME"
    changed "hostname: $MK_HOSTNAME"
  fi
  if ! grep -qE "^127\.0\.1\.1[[:space:]]+$MK_HOSTNAME([[:space:]]|$)" /etc/hosts; then
    sed -i '/^127\.0\.1\.1[[:space:]]/d' /etc/hosts
    printf '127.0.1.1\t%s\n' "$MK_HOSTNAME" >>/etc/hosts
    changed "/etc/hosts"
  fi
  ok "Hostname: $MK_HOSTNAME"

  if [[ "$(timedatectl show -p Timezone --value)" != "$MK_TIMEZONE" ]]; then
    run timedatectl set-timezone "$MK_TIMEZONE"
    changed "vaqt mintaqasi: $MK_TIMEZONE"
  fi
  run timedatectl set-ntp true
  ok "Vaqt: $MK_TIMEZONE (NTP yoqilgan)"

  apt_update
  if [[ "$MK_DO_UPGRADE" == 1 || ! -f "$MK_STATE/first-upgrade-done" ]]; then
    info "Tizim yangilanmoqda (bir necha daqiqa olishi mumkin)..."
    run apt-get full-upgrade "${APT_OPTS[@]}"
    touch "$MK_STATE/first-upgrade-done"
    ok "Tizim yangilandi"
  fi
  apt_install "${BASE_PACKAGES[@]}"
  ok "Asosiy paketlar o'rnatilgan"

  # Automatic security updates. Reboots are left to Guardian's maintenance window.
  install_file "$cfg/apt/52mirkomil-unattended-upgrades" /etc/apt/apt.conf.d/52mirkomil-unattended-upgrades
  install_file "$cfg/apt/21mirkomil-auto-upgrades" /etc/apt/apt.conf.d/21mirkomil-auto-upgrades
  run systemctl enable --now unattended-upgrades.service
  ok "Xavfsizlik yangilanishlari avtomatik"

  # A server must never go to sleep (laptop lid, idle, power key).
  local t
  for t in sleep.target suspend.target hibernate.target hybrid-sleep.target suspend-then-hibernate.target; do
    if [[ "$(systemctl is-enabled "$t" 2>/dev/null)" != masked ]]; then
      run systemctl mask "$t"; changed "$t o'chirildi"
    fi
  done
  local before; before="$(cat /etc/systemd/logind.conf.d/50-mirkomil.conf 2>/dev/null || true)"
  install_file "$cfg/systemd/logind-50-mirkomil.conf" /etc/systemd/logind.conf.d/50-mirkomil.conf
  if [[ "$before" != "$(cat /etc/systemd/logind.conf.d/50-mirkomil.conf)" ]]; then
    # SIGHUP reloads logind config without ending user sessions.
    run systemctl kill -s HUP systemd-logind
  fi
  ok "Uyqu rejimi o'chirilgan"

  before="$(cat /etc/systemd/journald.conf.d/50-mirkomil.conf 2>/dev/null || true)"
  install_file "$cfg/systemd/journald-50-mirkomil.conf" /etc/systemd/journald.conf.d/50-mirkomil.conf
  mkdir -p /var/log/journal
  if [[ "$before" != "$(cat /etc/systemd/journald.conf.d/50-mirkomil.conf)" ]]; then
    run systemctl restart systemd-journald
  fi
  ok "Jurnal: doimiy, hajmi cheklangan"

  before="$(cat /etc/sysctl.d/90-mirkomil.conf 2>/dev/null || true)"
  install_file "$cfg/sysctl/90-mirkomil.conf" /etc/sysctl.d/90-mirkomil.conf
  if [[ "$before" != "$(cat /etc/sysctl.d/90-mirkomil.conf)" ]]; then
    run sysctl -p /etc/sysctl.d/90-mirkomil.conf
  fi
  ok "Yadro (sysctl) sozlamalari"

  # CLI
  install_file "$MK_SRC/bin/mirkomil" /usr/local/bin/mirkomil 0755
  mkdir -p "$MK_OPT"
  if [[ "$(readlink -f "$MK_OPT/src" 2>/dev/null)" != "$MK_SRC" && "$MK_SRC" != "$MK_OPT/src" ]]; then
    ln -sfn "$MK_SRC" "$MK_OPT/src"
  fi
  ok "'mirkomil' buyrug'i o'rnatildi"
}
