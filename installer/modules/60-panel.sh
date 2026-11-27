# shellcheck shell=bash
# 60 — Mirkomil Panel (Cockpit plugin) + branded Cockpit login page.
#
# The panel is installed system-wide to /usr/share/cockpit/mirkomil, so every
# Linux user sees it after logging in to Cockpit. It is static files only:
# no daemon, no port — Cockpit serves it and enforces login/TLS.
# shellcheck disable=SC2034  # read by installer/main.sh
MODULE_TITLE="Mirkomil Panel"

PANEL_DIR=/usr/share/cockpit/mirkomil
# Cockpit picks branding by os-release ID first ("ubuntu"), before ID_LIKE ("debian").
BRANDING_DIR=/usr/share/cockpit/branding/ubuntu

module_run() {
  local dist="$MK_SRC/panel/dist"
  if [[ ! -f "$dist/manifest.json" || ! -f "$dist/index.html" ]]; then
    warn "Panel build topilmadi ($dist). Release arxividan o'rnating yoki: cd panel && npm ci && npm run build"
    return 0
  fi

  # Replace atomically: stage next to the target, then swap directories.
  local stage="$PANEL_DIR.new"
  rm -rf "$stage"
  mkdir -p "$stage"
  cp -a "$dist/." "$stage/"
  # Cockpit keeps the panel page for the whole login session, so an open session still asks for
  # the previous build's lazy chunks after an update: carry those over (one generation only —
  # .assets-list names a build's own files, so older ones are dropped on the next update).
  (cd "$dist/assets" && find . -maxdepth 1 -type f -printf '%f\n' | sort) >"$stage/.assets-list"
  local f prev=""
  if [[ -f "$PANEL_DIR/.assets-list" ]]; then
    prev="$(cat "$PANEL_DIR/.assets-list")"
  elif [[ -d "$PANEL_DIR/assets" ]]; then
    prev="$(cd "$PANEL_DIR/assets" && find . -maxdepth 1 -type f -printf '%f\n')"  # installed before lists existed
  fi
  while IFS= read -r f; do
    [[ "$f" =~ ^[A-Za-z0-9._-]+$ && -f "$PANEL_DIR/assets/$f" && ! -e "$stage/assets/$f" ]] \
      && cp -a "$PANEL_DIR/assets/$f" "$stage/assets/$f"
  done <<<"$prev"
  chown -R root:root "$stage"
  find "$stage" -type d -exec chmod 0755 {} + -o -type f -exec chmod 0644 {} +
  # unchanged = every file of this build is already installed as-is (files kept from the
  # previous build don't count, so a re-run keeps them instead of reinstalling)
  if [[ -d "$PANEL_DIR" ]] && cmp -s "$stage/.assets-list" "$PANEL_DIR/.assets-list" \
     && ! { diff -rq "$dist" "$PANEL_DIR" 2>&1 || true; } | grep -qv "^Only in $PANEL_DIR"; then
    rm -rf "$stage"
  else
    rm -rf "$PANEL_DIR.old"
    [[ -d "$PANEL_DIR" ]] && mv "$PANEL_DIR" "$PANEL_DIR.old"
    mv "$stage" "$PANEL_DIR"
    rm -rf "$PANEL_DIR.old"
    changed "panel: $PANEL_DIR ($(jq -r .version "$PANEL_DIR/manifest.json" 2>/dev/null))"
  fi
  cockpit_conf_apply
  ok "Panel o'rnatilgan: kirgandan keyin to'g'ridan-to'g'ri Mirkomil Panel ochiladi"

  # Branded login page (logo, colors, Uzbek welcome).
  # cockpit-ws ships these files itself, so we never just overwrite them:
  # dpkg-divert moves the package's file aside (*.distrib) — package upgrades
  # then update the diverted copy, and --uninstall puts the original back.
  mkdir -p "$BRANDING_DIR"
  local f
  for f in branding.css logo.svg; do
    if ! dpkg-divert --list "$BRANDING_DIR/$f" | grep -q mirkomil; then
      run dpkg-divert --package mirkomil-server --add --rename --divert "$BRANDING_DIR/$f.distrib" "$BRANDING_DIR/$f"
    fi
  done
  # name + domain come from config.env (editable in the panel)
  install_template "$MK_SRC/configs/cockpit/branding/branding.css.tmpl" "$BRANDING_DIR/branding.css"
  install_file "$MK_SRC/configs/cockpit/branding/logo.svg" "$BRANDING_DIR/logo.svg"
  # the panel's own fonts for the login page (new files, not owned by any package)
  local inter display
  inter="$(compgen -G "$PANEL_DIR/assets/inter-latin-wght-normal-*.woff2" | head -n1 || true)"
  display="$(compgen -G "$PANEL_DIR/assets/space-grotesk-latin-wght-normal-*.woff2" | head -n1 || true)"
  if [[ -n "$inter" ]]; then install_file "$inter" "$BRANDING_DIR/inter.woff2"; fi
  if [[ -n "$display" ]]; then install_file "$display" "$BRANDING_DIR/display.woff2"; fi
  ok "Kirish sahifasi brendlangan (asl fayllar: *.distrib)"
}
