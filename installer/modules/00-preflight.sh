# shellcheck shell=bash
# 00 — Preflight: refuse politely on anything we don't support. Changes nothing.
# shellcheck disable=SC2034  # read by installer/main.sh
MODULE_TITLE="Tekshiruv (preflight)"

SUPPORTED_UBUNTU=("26.04")

module_run() {
  local id ver arch free_gb mem_mb
  id="$(os_release ID)"; ver="$(os_release VERSION_ID)"
  if [[ "$id" != ubuntu ]] || [[ " ${SUPPORTED_UBUNTU[*]} " != *" $ver "* ]]; then
    die "Faqat Ubuntu Server ${SUPPORTED_UBUNTU[*]} qo'llab-quvvatlanadi (sizda: ${id:-?} ${ver:-?}). Hech narsa o'zgartirilmadi."
  fi
  ok "OS: $(os_release PRETTY_NAME)"

  arch="$(dpkg --print-architecture)"
  [[ "$arch" == amd64 || "$arch" == arm64 ]] || die "Arxitektura qo'llab-quvvatlanmaydi: $arch"
  ok "Arxitektura: $arch"

  [[ -d /run/systemd/system ]] || die "systemd ishlamayapti (konteyner ichidamisiz?)"

  free_gb=$(($(df --output=avail -k / | tail -1) / 1024 / 1024))
  ((free_gb >= 8)) || die "Diskda kamida 8 GB bo'sh joy kerak (bor: ${free_gb} GB)"
  ok "Bo'sh disk: ${free_gb} GB"

  mem_mb=$(($(awk '/MemTotal/{print $2}' /proc/meminfo) / 1024))
  ((mem_mb >= 1800)) || warn "RAM kam: ${mem_mb} MB (tavsiya: 4 GB+). Davom etamiz."
  ok "RAM: ${mem_mb} MB"

  if [[ "${MK_PREFLIGHT_QUICK:-0}" == 1 ]]; then
    ok "Tezkor rejim (panel orqali sozlamalarni qo'llash)"
    return 0
  fi

  if ! curl -fsS --max-time 10 -o /dev/null https://archive.ubuntu.com/ubuntu/ 2>>"$MK_LOG" &&
     ! curl -fsS --max-time 10 -o /dev/null https://security.ubuntu.com/ubuntu/ 2>>"$MK_LOG"; then
    die "Internet yoki DNS ishlamayapti (archive.ubuntu.com ga ulanib bo'lmadi)."
  fi
  ok "Internet bor"

  if fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; then
    info "apt band (ehtimol avtomatik yangilanish). Kutyapmiz..."
    local _
    for _ in $(seq 1 60); do fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || break; sleep 5; done
  fi

  ok "Administrator: $MK_ADMIN_USER"
}
