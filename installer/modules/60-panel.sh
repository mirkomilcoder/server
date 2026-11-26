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
  ok "Panel o'rnatilgan: Cockpit menyusida \"Mirkomil Panel\""

  # Branded login page (logo, colors, Uzbek welcome). Other files fall back to Cockpit's defaults.
  if dpkg -S "$BRANDING_DIR" >/dev/null 2>&1; then
    warn "$BRANDING_DIR paketga tegishli — brending o'tkazib yuborildi"
  else
    mkdir -p "$BRANDING_DIR"
    install_file "$MK_SRC/configs/cockpit/branding/branding.css" "$BRANDING_DIR/branding.css"
    install_file "$MK_SRC/configs/cockpit/branding/logo.svg" "$BRANDING_DIR/logo.svg"
    install_file "$MK_SRC/configs/cockpit/branding/logo.svg" "$BRANDING_DIR/favicon.svg"
    ok "Kirish sahifasi brendlangan"
  fi
}
