#!/usr/bin/env bash
set -euo pipefail

tag="${1:?usage: build-release-assets.sh <tag> <dist-dir>}"
dist_dir="${2:-dist-release}"

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
stage="${dist_dir}/${asset}"
rm -rf "$stage"
mkdir -p "$stage"

corepack enable
CI=true CYPRESS_INSTALL_BINARY=0 pnpm install --frozen-lockfile
pnpm build
rm -rf node_modules
CI=true CYPRESS_INSTALL_BINARY=0 pnpm install --prod --frozen-lockfile

cp -R .next dist server public config "$stage"/
cp package.json pnpm-lock.yaml next.config.ts seerr-api.yml LICENSE "$stage"/
cp -R node_modules "$stage"/node_modules

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

mkdir -p "$dist_dir"
if [[ "$os" == "windows" ]]; then
  (cd "$dist_dir" && zip -qr "${asset}.zip" "$asset")
else
  tar -C "$dist_dir" -czf "${dist_dir}/${asset}.tar.gz" "$asset"
fi

(cd "$dist_dir" && sha256sum "${asset}".* > "${asset}.sha256")
