# shellcheck shell=bash
# 50 — Cockpit (web console the panel plugs into) + PCP for metrics history.
#
# Since Cockpit ~3xx there is no "cockpit-pcp" package: the bridge reads PCP
# archives through python3-pcp, so we install pcp + python3-pcp instead.
MODULE_TITLE="Cockpit + metrikalar tarixi (PCP)"

COCKPIT_PACKAGES=(cockpit-ws cockpit-bridge cockpit-system cockpit-storaged pcp python3-pcp)

module_run() {
  apt_install "${COCKPIT_PACKAGES[@]}"

  local before; before="$(cat /etc/cockpit/cockpit.conf 2>/dev/null || true)"
  install_template "$MK_SRC/configs/cockpit/cockpit.conf.tmpl" /etc/cockpit/cockpit.conf
  if [[ "$before" != "$(cat /etc/cockpit/cockpit.conf)" ]] && systemctl is-active -q cockpit.service; then
    # Restarting cockpit.service only drops open web sessions; the socket stays.
    run systemctl restart cockpit.service
  fi
  run systemctl enable --now cockpit.socket

  run systemctl enable --now pmcd.service pmlogger.service
  ok "PCP yozib boryapti (grafiklar uchun 24 soat / 7 kunlik tarix)"

  if curl -fsSk --max-time 10 https://localhost:9090/ping 2>>"$MK_LOG" | grep -q cockpit; then
    ok "Cockpit ishlayapti: https://localhost:9090"
  else
    die "Cockpit javob bermayapti (https://localhost:9090/ping)"
  fi
}
