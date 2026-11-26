# shellcheck shell=bash
# 70 — Guardian agent (user "mirkomil") + root helper + role groups.
MODULE_TITLE="Guardian: monitoring va ogohlantirishlar"

ROLE_GROUPS=(mirkomil-admin mirkomil-dev mirkomil-viewer)

module_run() {
  local cfg="$MK_SRC/configs/systemd" g units_changed=0 before

  # System user without login shell or home; owns only Guardian's state.
  if ! id mirkomil >/dev/null 2>&1; then
    run useradd --system --user-group --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin mirkomil
    changed "tizim foydalanuvchisi: mirkomil"
  fi
  for g in "${ROLE_GROUPS[@]}"; do
    if ! getent group "$g" >/dev/null; then run groupadd --system "$g"; changed "guruh: $g"; fi
  done
  if ! id -nG "$MK_ADMIN_USER" | tr ' ' '\n' | grep -qx mirkomil-admin; then
    run usermod -aG mirkomil-admin "$MK_ADMIN_USER"
    changed "$MK_ADMIN_USER → mirkomil-admin"
  fi
  ok "Rollar: mirkomil-admin / mirkomil-dev / mirkomil-viewer"

  # Guardian reads ONLY its own secrets file (Telegram), not secrets.env.
  local gsec="$MK_ETC/guardian.env" tmp
  tmp="$(mktemp)"
  {
    printf '# %s\n' "$MK_MANAGED_HEADER"
    if [[ "$MK_TELEGRAM" == yes && -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
      printf 'TELEGRAM_BOT_TOKEN="%s"\n' "$TELEGRAM_BOT_TOKEN"
    fi
  } >"$tmp"
  if ! cmp -s "$tmp" "$gsec" 2>/dev/null; then
    install -m 0640 -o root -g mirkomil "$tmp" "$gsec"; changed "$gsec"; units_changed=1
  fi
  rm -f "$tmp"
  chown root:mirkomil "$gsec"; chmod 0640 "$gsec"

  for f in mirkomil-guardian.service mirkomil-helper.service; do
    before="$(cat "/etc/systemd/system/$f" 2>/dev/null || true)"
    install_file "$cfg/$f" "/etc/systemd/system/$f"
    [[ "$before" == "$(cat "/etc/systemd/system/$f")" ]] || units_changed=1
  done
  install_file "$cfg/mirkomil-tmpfiles.conf" /etc/tmpfiles.d/mirkomil.conf
  # PaaS data: root-owned, group "mirkomil" may read deploy status/logs (never app secrets)
  install -d -m 0750 -o root -g mirkomil /var/lib/mirkomil/apps
  install -d -m 0755 -o root -g root /var/lib/mirkomil/proxy
  run systemd-tmpfiles --create /etc/tmpfiles.d/mirkomil.conf

  # restart when the agent's code changed too (not only its unit files)
  local code_hash
  code_hash="$(cd "$MK_SRC/agent" && find . -name '*.py' -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)"
  if [[ "$(cat "$MK_STATE/agent.sha256" 2>/dev/null)" != "$code_hash" ]]; then
    units_changed=1
    printf '%s
' "$code_hash" >"$MK_STATE/agent.sha256"
    changed "Guardian kodi yangilandi"
  fi

  run systemctl daemon-reload
  run systemctl enable mirkomil-helper.service mirkomil-guardian.service
  if ((units_changed)) || [[ "$MK_DO_UPGRADE" == 1 ]]; then
    run systemctl restart mirkomil-helper.service mirkomil-guardian.service
  else
    run systemctl start mirkomil-helper.service mirkomil-guardian.service
  fi

  local i
  for i in $(seq 1 20); do [[ -S /run/mirkomil/api.sock ]] && break; sleep 1; done
  if curl -fsS --max-time 5 --unix-socket /run/mirkomil/api.sock http://localhost/v1/health >>"$MK_LOG" 2>&1; then
    ok "Guardian ishlayapti (/run/mirkomil/api.sock)"
  else
    die "Guardian javob bermayapti. Log: journalctl -u mirkomil-guardian"
  fi
  if [[ "$MK_TELEGRAM" == yes ]]; then ok "Telegram ogohlantirishlari yoqilgan"; fi
}
