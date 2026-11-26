# shellcheck shell=bash
# 40 — Docker Engine + Compose v2 from Ubuntu's own (signed) archive.
#
# The admin user is deliberately NOT added to the "docker" group: membership
# is equivalent to root. The panel/PaaS talk to Docker through the root helper.
MODULE_TITLE="Docker"

module_run() {
  apt_install docker.io docker-compose-v2 docker-buildx

  local conf=/etc/docker/daemon.json tmp
  tmp="$(mktemp)"
  cp "$MK_SRC/configs/docker/daemon.json" "$tmp"
  if ! cmp -s "$tmp" "$conf" 2>/dev/null; then
    # Validate before installing — a bad daemon.json stops Docker from starting.
    run dockerd --validate --config-file="$tmp"
    install_file "$tmp" "$conf" 0644
    run systemctl enable docker.service containerd.service
    run systemctl restart docker.service
  fi
  rm -f "$tmp"
  run systemctl enable --now docker.service

  docker info >/dev/null 2>&1 || die "Docker ishga tushmadi. Log: journalctl -u docker"
  ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null), Compose $(docker compose version --short 2>/dev/null)"
  ok "Loglar cheklangan (10 MB × 3 har konteynerga), live-restore yoqilgan"
}
