# shellcheck shell=bash
# 90 — Public access through Cloudflare Tunnel (outbound only, no open ports).
# Installs cloudflared from Cloudflare's signed repo and the tunnel unit.
# The tunnel itself is configured from the panel (Domenlar & SSL) with an API token.
# shellcheck disable=SC2034  # read by installer/main.sh
MODULE_TITLE="Internetga chiqish: Cloudflare Tunnel"

module_run() {
  add_apt_repo cloudflare-main \
    "https://pkg.cloudflare.com/cloudflare-main.gpg" \
    "deb [signed-by=/usr/share/keyrings/cloudflare-main-archive-keyring.gpg] https://pkg.cloudflare.com/cloudflared any main"
  apt_update
  apt_install cloudflared
  ok "cloudflared $(cloudflared --version 2>/dev/null | awk '!d {print $3; d=1}')"

  install -d -m 0750 -o root -g mirkomil /var/lib/mirkomil/tunnel
  install -d -m 0700 -o root -g root /var/lib/mirkomil/tunnel/private

  local unit=/etc/systemd/system/mirkomil-tunnel.service before
  before="$(cat "$unit" 2>/dev/null || true)"
  install_file "$MK_SRC/configs/systemd/mirkomil-tunnel.service" "$unit"
  run systemctl daemon-reload
  # Enabled always; ConditionPathExists keeps it idle until the panel writes the token.
  run systemctl enable mirkomil-tunnel.service
  if [[ -f /var/lib/mirkomil/tunnel/private/tunnel.env ]]; then
    if [[ "$before" != "$(cat "$unit")" ]]; then run systemctl restart mirkomil-tunnel.service
    else run systemctl start mirkomil-tunnel.service; fi
    ok "Tunnel sozlangan: $(systemctl is-active mirkomil-tunnel.service 2>/dev/null || true)"
  else
    ok "Tunnel hali sozlanmagan — panel → Domenlar & SSL bo'limida Cloudflare tokenini kiriting"
  fi
}
