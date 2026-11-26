# shellcheck shell=bash
# 30 — Private network access with Tailscale (no open ports).
# Tailscale SSH is enabled as a second way in, in case regular SSH breaks.
MODULE_TITLE="Tarmoq: Tailscale"

module_run() {
  if [[ "$MK_TAILSCALE" != yes ]]; then
    ok "Tailscale o'chirilgan (MK_TAILSCALE=no) — o'tkazib yuborildi"
    return 0
  fi

  local codename; codename="$(os_release VERSION_CODENAME)"
  add_apt_repo tailscale \
    "https://pkgs.tailscale.com/stable/ubuntu/${codename}.noarmor.gpg" \
    "deb [signed-by=/usr/share/keyrings/tailscale-archive-keyring.gpg] https://pkgs.tailscale.com/stable/ubuntu ${codename} main"
  apt_update
  apt_install tailscale
  run systemctl enable --now tailscaled
  ok "Tailscale o'rnatilgan ($(tailscale version 2>/dev/null | head -n1))"

  local state; state="$(tailscale status --json 2>/dev/null | jq -r '.BackendState // "Unknown"')"
  if [[ "$state" == Running ]]; then
    run tailscale set --ssh --hostname="$MK_HOSTNAME"
    ok "Tailscale ulangan: $(tailscale_ip)  (Tailscale SSH yoqilgan)"
    return 0
  fi

  if [[ -n "${TS_AUTHKEY:-}" ]]; then
    if run_quiet_secret "tailscale up --auth-key" tailscale up --auth-key="$TS_AUTHKEY" --ssh --hostname="$MK_HOSTNAME" --timeout=120s; then
      # auth keys are usually single-use: don't keep it around
      sed -i '/^TS_AUTHKEY=/d' "$MK_SECRETS"
      changed "Tailscale tarmog'iga ulandi: $(tailscale_ip)"
      return 0
    fi
    warn "Auth key bilan ulanib bo'lmadi (muddati o'tgan bo'lishi mumkin). Brauzer orqali ulaning."
  fi

  if is_interactive; then
    info "Tailscale'ga kirish: quyidagi havolani telefon yoki kompyuterda oching (yoki QR kodni skanerlang)."
    info "10 daqiqa kutiladi..."
    # Output goes to the terminal on purpose: the user needs the link/QR.
    if tailscale up --ssh --hostname="$MK_HOSTNAME" --qr --timeout=600s </dev/tty >/dev/tty 2>&1; then
      changed "Tailscale tarmog'iga ulandi: $(tailscale_ip)"
      return 0
    fi
  fi
  warn "Tailscale hali ulanmagan. Keyinroq bajaring: sudo tailscale up --ssh"
}
