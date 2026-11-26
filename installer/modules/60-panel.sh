# shellcheck shell=bash
# 60 — Mirkomil Panel (Cockpit plugin) + branded Cockpit login page.
#
# The panel is installed system-wide to /usr/share/cockpit/mirkomil, so every
# Linux user sees it after logging in to Cockpit. It is static files only:
# no daemon, no port — Cockpit serves it and enforces login/TLS.
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
  chown -R root:root "$stage"
  find "$stage" -type d -exec chmod 0755 {} + -o -type f -exec chmod 0644 {} +
  if [[ -d "$PANEL_DIR" ]] && diff -rq "$stage" "$PANEL_DIR" >/dev/null 2>&1; then
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
  inter="$(ls "$PANEL_DIR"/assets/inter-latin-wght-normal-*.woff2 2>/dev/null | head -n1 || true)"
  display="$(ls "$PANEL_DIR"/assets/space-grotesk-latin-wght-normal-*.woff2 2>/dev/null | head -n1 || true)"
  if [[ -n "$inter" ]]; then install_file "$inter" "$BRANDING_DIR/inter.woff2"; fi
  if [[ -n "$display" ]]; then install_file "$display" "$BRANDING_DIR/display.woff2"; fi
  ok "Kirish sahifasi brendlangan (asl fayllar: *.distrib)"
}
