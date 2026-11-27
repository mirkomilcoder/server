#!/usr/bin/env bash
# Mirkomil Server — bootstrap installer.
#
#   curl -fsSL https://raw.githubusercontent.com/mirkomilcoder/server/main/install.sh | sudo bash
#
# What this small script does:
#   1. checks it runs as root;
#   2. gets the full source: from this checkout if run locally, otherwise a
#      tarball from GitHub over HTTPS (optionally pinned with MK_REF and
#      verified with MK_SHA256);
#   3. places it in /opt/mirkomil/src and runs installer/main.sh with your arguments.
set -Eeuo pipefail

REPO="${MK_REPO:-mirkomilcoder/server}"
# Default: latest GitHub release (includes the prebuilt panel). MK_REF=<branch|tag> pins a source tarball.
REF="${MK_REF:-}"
DEST=/opt/mirkomil/src

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Root huquqi kerak. Shunday ishga tushiring: curl -fsSL ... | sudo bash" >&2
  exit 1
fi

update=0
for a in "$@"; do [[ "$a" == --update ]] && update=1; done

self="${BASH_SOURCE[0]:-}"
here=""
if [[ -n "$self" && -f "$self" ]]; then here="$(cd "$(dirname "$self")" && pwd)"; fi

fetch_release() {
  local tmp url
  tmp="$(mktemp -d)"
  if [[ -n "$REF" ]]; then
    url="https://codeload.github.com/${REPO}/tar.gz/${REF}"
  else
    url="https://github.com/${REPO}/releases/latest/download/mirkomil-server.tar.gz"
  fi
  echo "Yuklab olinmoqda: ${url}"
  # explicit "|| return": set -e is not active inside `if ! fetch_release`
  curl -fsSL --proto '=https' --tlsv1.2 -o "$tmp/src.tar.gz" "$url" || return 1
  if [[ -n "${MK_SHA256:-}" ]]; then
    echo "${MK_SHA256}  $tmp/src.tar.gz" | sha256sum -c - >/dev/null || { echo "SHA256 mos kelmadi — to'xtatildi." >&2; exit 1; }
  fi
  mkdir -p "$tmp/x"
  tar -xzf "$tmp/src.tar.gz" -C "$tmp/x" --strip-components=1 || return 1
  [[ -f "$tmp/x/installer/main.sh" ]] || { echo "Arxivda installer/ topilmadi." >&2; exit 1; }
  install_tree "$tmp/x" || return 1
  rm -rf "$tmp"
}

# Replace $DEST atomically-ish with the given tree (root-owned, not world-writable).
install_tree() {
  local from="$1"
  mkdir -p /opt/mirkomil
  rm -rf "$DEST.new"
  mkdir -p "$DEST.new"
  tar -C "$from" --exclude=./.git --exclude=./panel/node_modules -cf - . | tar -C "$DEST.new" -xf -
  chown -R root:root "$DEST.new"
  chmod -R go-w "$DEST.new"
  rm -rf "$DEST.old"
  if [[ -e "$DEST" || -L "$DEST" ]]; then mv "$DEST" "$DEST.old"; fi
  mv "$DEST.new" "$DEST"
  rm -rf "$DEST.old"
}

if [[ -n "$here" && -f "$here/installer/main.sh" && "$here" != "$DEST" ]]; then
  install_tree "$here"                     # local checkout (development / offline)
elif [[ -z "$here" || ! -f "$here/installer/main.sh" ]] || ((update)); then
  if ! fetch_release && [[ -f "$DEST/installer/main.sh" ]]; then
    echo "Yangi versiyani yuklab bo'lmadi — mavjud versiya bilan davom etamiz." >&2
  fi
fi

[[ -f "$DEST/installer/main.sh" ]] || { echo "Manba topilmadi: $DEST" >&2; exit 1; }
exec bash "$DEST/installer/main.sh" "$@"
