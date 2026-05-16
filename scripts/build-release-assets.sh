#!/usr/bin/env bash
set -euo pipefail

tag="${1:?usage: build-release-assets.sh <tag> <dist-dir>}"
dist_dir="${2:-dist-release}"
mkdir -p "$dist_dir"
dist_abs="$(cd "$dist_dir" && pwd)"

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=macos ;;
  MINGW*|MSYS*|CYGWIN*) os=windows ;;
  *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) arch="$(uname -m)" ;;
esac

asset="seerrng-${tag}-${os}-${arch}"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
stage="${work_dir}/${asset}"
mkdir -p "$stage"

if command -v corepack >/dev/null 2>&1; then
  corepack enable
fi
CI=true CYPRESS_INSTALL_BINARY=0 pnpm install --frozen-lockfile
pnpm build

cp -R .next dist server public bin "$stage"/
cp package.json pnpm-lock.yaml next.config.ts seerr-api.yml LICENSE "$stage"/
(cd "$stage" && CI=true CYPRESS_INSTALL_BINARY=0 pnpm install --prod --frozen-lockfile)
rm -rf "$stage/.next/cache" "$stage/.next/dev" "$stage/cache"
mkdir -p "$stage/config"
touch "$stage/config/.gitkeep"

cat > "$stage/start.sh" <<'EOF'
#!/usr/bin/env sh
set -eu
export NODE_ENV="${NODE_ENV:-production}"
export CONFIG_DIRECTORY="${CONFIG_DIRECTORY:-$(pwd)/config}"
exec node dist/index.js "$@"
EOF
chmod 0755 "$stage/start.sh"

cat > "$stage/start.cmd" <<'EOF'
@echo off
set NODE_ENV=production
if "%CONFIG_DIRECTORY%"=="" set CONFIG_DIRECTORY=%CD%\config
node dist\index.js %*
EOF

if [[ "$os" == "windows" ]]; then
  (cd "$work_dir" && zip -qr "${dist_abs}/${asset}.zip" "$asset")
else
  tar -C "$work_dir" -czf "${dist_abs}/${asset}.tar.gz" "$asset"
fi

(cd "$dist_abs" && sha256sum "${asset}".* > "${asset}.sha256")
