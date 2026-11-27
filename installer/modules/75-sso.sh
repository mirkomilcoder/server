# shellcheck shell=bash
# 75 — Login only through Cloudflare Access (single sign-on), when MK_SSO=yes.
#
# panel.<domain> → Cloudflare Access (Google / GitHub / email code, super-admin emails only)
# → Cockpit's OAuth login → /run/mirkomil-sso.sock verifies the token → session as "mkadmin".
# mkadmin has no password and no SSH; its only sudo right is Cockpit's admin-mode bridge.
# Turn off from SSH:  sudo mirkomil sso off   (Cockpit's normal password login comes back)
# shellcheck disable=SC2034  # read by installer/main.sh
MODULE_TITLE="Kirish: faqat Cloudflare orqali (SSO)"

SSO_USER=mkadmin
SSO_SUDOERS=/etc/sudoers.d/60-mirkomil-sso
TUNNEL_STATE=/var/lib/mirkomil/tunnel/state.json

module_run() {
  local cfg="$MK_SRC/configs/systemd"
  if [[ "${MK_SSO:-no}" != yes ]]; then
    if systemctl is-enabled -q mirkomil-sso.socket 2>/dev/null; then
      run systemctl disable --now mirkomil-sso.socket
      changed "SSO o'chirildi"
    fi
    if [[ -f "$SSO_SUDOERS" ]]; then rm -f "$SSO_SUDOERS"; changed "$SSO_SUDOERS olib tashlandi"; fi
    cockpit_conf_apply
    ok "Kirish: Cockpit logini (Linux foydalanuvchi va parol)"
    return 0
  fi

  if [[ "$(jq -r '.panel_host // empty' "$TUNNEL_STATE" 2>/dev/null)" == "" ]]; then
    warn "SSO uchun avval domen ulanishi kerak (panel → Domenlar & SSL). Hozircha o'tkazib yuborildi."
    return 0
  fi

  # the one account SSO sessions run as: no password, no SSH login (ssh only allows key auth
  # and it has no keys), full panel rights through the admin group
  if ! id "$SSO_USER" >/dev/null 2>&1; then
    run useradd --create-home --shell /bin/bash --comment "Mirkomil super admin (Cloudflare SSO)" "$SSO_USER"
    changed "hisob: $SSO_USER"
  fi
  run usermod -aG mirkomil-admin,adm,systemd-journal "$SSO_USER"
  run passwd -l "$SSO_USER"

  # Cockpit's admin mode runs: sudo -k -A python3 -ic "# cockpit-bridge" --privileged (cockpit/bridge.py).
  # sudo-rs (Ubuntu 26.04) can't match an argument containing a space, so the rule is "python3 -ic *".
  # That is root either way (the privileged bridge is a root Python): mkadmin IS a root-level super
  # admin. What protects it: mkadmin can only be entered through a verified Cloudflare login
  # (password locked, no SSH key) — see agent/mirkomil/sso.py.
  local tmp; tmp="$(mktemp)"
  printf '%s\n%s\n' "# $MK_MANAGED_HEADER" \
    "$SSO_USER ALL=(root) NOPASSWD: /usr/bin/python3 -ic *" >"$tmp"
  visudo -cqf "$tmp" || { rm -f "$tmp"; die "sudoers qoidasi tekshiruvdan o'tmadi"; }
  if ! cmp -s "$tmp" "$SSO_SUDOERS" 2>/dev/null; then
    install -m 0440 -o root -g root "$tmp" "$SSO_SUDOERS"; changed "$SSO_SUDOERS"
  fi
  rm -f "$tmp"

  local before u changed_units=0
  for u in mirkomil-sso.socket mirkomil-sso@.service; do
    before="$(cat "/etc/systemd/system/$u" 2>/dev/null || true)"
    install_file "$cfg/$u" "/etc/systemd/system/$u"
    [[ "$before" == "$(cat "/etc/systemd/system/$u")" ]] || changed_units=1
  done
  run systemctl daemon-reload
  run systemctl enable mirkomil-sso.socket
  if ((changed_units)); then run systemctl restart mirkomil-sso.socket; else run systemctl start mirkomil-sso.socket; fi
  cockpit_conf_apply
  ok "Kirish faqat Cloudflare orqali: https://$(jq -r .panel_host "$TUNNEL_STATE")  (o'chirish: sudo mirkomil sso off)"
}
