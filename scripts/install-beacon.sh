#!/bin/sh
# Installs the kanna-beacon daemon from a GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/cuongtranba/kanna/main/scripts/install-beacon.sh | sh
#
# Overrides (environment):
#   KANNA_BEACON_VERSION   release tag to install, e.g. v1.60.0 (default: latest)
#   KANNA_BEACON_REPO      owner/name to download from (default: cuongtranba/kanna)
#   KANNA_BEACON_BIN_DIR   install directory (default: $HOME/.local/bin)
#
# Windows: download kanna-beacon-windows-x64.exe and SHA256SUMS from the release page.
set -eu
set -o pipefail 2>/dev/null || true

REPO="${KANNA_BEACON_REPO:-cuongtranba/kanna}"
VERSION="${KANNA_BEACON_VERSION:-latest}"
BIN_DIR="${KANNA_BEACON_BIN_DIR:-$HOME/.local/bin}"

fail() {
  echo "install-beacon: $*" >&2
  exit 1
}

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "unsupported OS $(uname -s); on Windows download kanna-beacon-windows-x64.exe from the release page" ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) fail "unsupported architecture $(uname -m)" ;;
esac

asset="kanna-beacon-${os}-${arch}"

if [ "$VERSION" = "latest" ]; then
  base="https://github.com/${REPO}/releases/latest/download"
else
  base="https://github.com/${REPO}/releases/download/${VERSION}"
fi

command -v curl >/dev/null 2>&1 || fail "curl is required"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

echo "Downloading ${asset} (${VERSION}) from ${REPO}..."
curl -fsSL "${base}/${asset}" -o "${tmp}/${asset}" || fail "could not download ${base}/${asset}"
curl -fsSL "${base}/SHA256SUMS" -o "${tmp}/SHA256SUMS" || fail "could not download ${base}/SHA256SUMS"

expected="$(awk -v name="$asset" '$2 == name { print $1 }' "${tmp}/SHA256SUMS")"
[ -n "$expected" ] || fail "${asset} is not listed in SHA256SUMS"

if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${tmp}/${asset}" | awk '{ print $1 }')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "${tmp}/${asset}" | awk '{ print $1 }')"
else
  fail "sha256sum or shasum is required to verify the download"
fi

[ "$actual" = "$expected" ] || fail "checksum mismatch for ${asset}: expected ${expected}, got ${actual}"

mkdir -p "$BIN_DIR"
install -m 755 "${tmp}/${asset}" "${BIN_DIR}/kanna-beacon"

echo "Installed ${BIN_DIR}/kanna-beacon"
case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *) echo "Note: ${BIN_DIR} is not on your PATH; add it or run the binary by full path." ;;
esac
echo
echo "Next: open Settings in Kanna, create a pairing code, then run"
echo "  kanna-beacon pair <url> <code>"
