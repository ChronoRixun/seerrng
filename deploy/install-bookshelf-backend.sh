#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_COMPOSE="${SCRIPT_DIR}/compose.bookshelf.yml"

DRY_RUN=false
VALIDATE_ONLY=false
VALIDATE_API=false
SKIP_PULL=false
NO_STOP_READARR=false

INSTALL_DIR="${INSTALL_DIR:-/opt/bookshelf-backend}"
BACKUP_DIR="${BACKUP_DIR:-${INSTALL_DIR}/backups/$(date +%Y%m%d-%H%M%S)}"

BOOKSHELF_EBOOKS_CONFIG_DIR="${BOOKSHELF_EBOOKS_CONFIG_DIR:-/mnt/datapool_lvm_media/readarr-config}"
BOOKSHELF_AUDIOBOOKS_CONFIG_DIR="${BOOKSHELF_AUDIOBOOKS_CONFIG_DIR:-/mnt/datapool_lvm_media/bookshelf-audiobooks-config}"
RREADING_GLASSES_POSTGRES_DIR="${RREADING_GLASSES_POSTGRES_DIR:-/mnt/datapool_lvm_media/rreading-glasses-postgres/data}"

MEDIA_ROOT="${MEDIA_ROOT:-/mnt/datapool_lvm_media}"
DOWNLOAD_ROOT="${DOWNLOAD_ROOT:-/mnt/datapool_lvm_media/download}"
PLEX_ROOT="${PLEX_ROOT:-/mnt/datapool_lvm_media/plex}"
TZ="${TZ:-America/Regina}"
PUID="${PUID:-1000}"
PGID="${PGID:-953}"

BOOKSHELF_EBOOKS_PORT="${BOOKSHELF_EBOOKS_PORT:-8787}"
BOOKSHELF_AUDIOBOOKS_PORT="${BOOKSHELF_AUDIOBOOKS_PORT:-8788}"
RREADING_GLASSES_PORT="${RREADING_GLASSES_PORT:-8790}"
RREADING_GLASSES_POSTGRES_PORT="${RREADING_GLASSES_POSTGRES_PORT:-15433}"
BOOKSHELF_METADATA_URL="${BOOKSHELF_METADATA_URL:-http://127.0.0.1:${RREADING_GLASSES_PORT}}"
BOOKSHELF_IMAGE="${BOOKSHELF_IMAGE:-ghcr.io/snapetech/bookshelfng:softcover}"

STOP_OLD_READARR_CONTAINER="${STOP_OLD_READARR_CONTAINER:-}"
CLONE_EBOOKS_CONFIG_TO_AUDIOBOOKS="${CLONE_EBOOKS_CONFIG_TO_AUDIOBOOKS:-false}"

usage() {
  cat <<EOF
Usage: $0 [options]

Deploy a two-instance Bookshelf backend for SeerrNG ebook and audiobook requests.

Options:
  --dry-run          Print the actions that would be taken without changing files
                    or starting containers.
  --validate-only    Validate commands, paths, compose config, and image pull
                    availability without changing files or starting containers.
  --validate-api     After startup, validate Bookshelf development config and
                    lookup endpoints. Set EBOOK_API_KEY and AUDIOBOOK_API_KEY.
  --skip-pull        Do not run docker compose pull before starting containers.
  --no-stop-readarr  Ignore STOP_OLD_READARR_CONTAINER even if it is set.
  -h, --help         Show this help text.

Common environment overrides:
  INSTALL_DIR
  BACKUP_DIR
  BOOKSHELF_IMAGE
  BOOKSHELF_EBOOKS_CONFIG_DIR
  BOOKSHELF_AUDIOBOOKS_CONFIG_DIR
  RREADING_GLASSES_POSTGRES_DIR
  MEDIA_ROOT
  DOWNLOAD_ROOT
  PLEX_ROOT
  STOP_OLD_READARR_CONTAINER
  CLONE_EBOOKS_CONFIG_TO_AUDIOBOOKS=true
  EBOOK_API_KEY
  AUDIOBOOK_API_KEY
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      ;;
    --validate-only)
      VALIDATE_ONLY=true
      DRY_RUN=true
      ;;
    --validate-api)
      VALIDATE_API=true
      ;;
    --skip-pull)
      SKIP_PULL=true
      ;;
    --no-stop-readarr)
      NO_STOP_READARR=true
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

run() {
  if [ "$DRY_RUN" = "true" ]; then
    printf 'DRY RUN:'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi

  "$@"
}

compose_cmd() {
  docker compose "$@"
}

generate_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    date +%s%N | sha256sum | awk '{print $1}'
  fi
}

backup_path() {
  local path="$1"
  local label="$2"

  if [ -e "$path" ]; then
    run mkdir -p "$BACKUP_DIR"
    run tar -C "$(dirname "$path")" -czf "${BACKUP_DIR}/${label}.tgz" "$(basename "$path")"
    echo "Backed up $path to ${BACKUP_DIR}/${label}.tgz"
  else
    echo "No existing $label path at $path; skipping backup"
  fi
}

ensure_bookshelf_config() {
  local config_dir="$1"
  local port="$2"
  local label="$3"
  local config_file="${config_dir}/config.xml"
  local api_key

  run mkdir -p "$config_dir"

  if [ ! -f "$config_file" ]; then
    if [ "$DRY_RUN" = "true" ]; then
      echo "Would create ${label} Bookshelf config.xml with port ${port}."
      return
    fi

    api_key="$(generate_password | cut -c 1-32)"
    cat >"$config_file" <<EOF
<Config>
  <LogLevel>info</LogLevel>
  <Port>${port}</Port>
  <UrlBase></UrlBase>
  <BindAddress>*</BindAddress>
  <SslPort>6868</SslPort>
  <EnableSsl>False</EnableSsl>
  <LaunchBrowser>False</LaunchBrowser>
  <ApiKey>${api_key}</ApiKey>
  <AuthenticationMethod>External</AuthenticationMethod>
  <Branch>develop</Branch>
  <UpdateMechanism>Docker</UpdateMechanism>
</Config>
EOF
    echo "Created ${label} Bookshelf config.xml with port ${port}."
    return
  fi

  if grep -q '<Port>.*</Port>' "$config_file"; then
    run sed -i "s#<Port>.*</Port>#<Port>${port}</Port>#" "$config_file"
  else
    run sed -i "s#</Config>#  <Port>${port}</Port>\\n</Config>#" "$config_file"
  fi

  if ! grep -q '<ApiKey>.*</ApiKey>' "$config_file"; then
    api_key="$(generate_password | cut -c 1-32)"
    run sed -i "s#</Config>#  <ApiKey>${api_key}</ApiKey>\\n</Config>#" "$config_file"
  fi

  echo "Ensured ${label} Bookshelf config.xml uses port ${port}."
}

write_env_file() {
  local env_file="${INSTALL_DIR}/.env"

  if [ "$DRY_RUN" = "true" ]; then
    echo "Would write ${env_file}"
    return
  fi

  RREADING_GLASSES_POSTGRES_PASSWORD="${RREADING_GLASSES_POSTGRES_PASSWORD:-$(generate_password)}"
  cat >"$env_file" <<EOF
PUID=${PUID}
PGID=${PGID}
TZ=${TZ}

BOOKSHELF_IMAGE=${BOOKSHELF_IMAGE}
BOOKSHELF_METADATA_URL=${BOOKSHELF_METADATA_URL}
BOOKSHELF_EBOOKS_CONFIG_DIR=${BOOKSHELF_EBOOKS_CONFIG_DIR}
BOOKSHELF_AUDIOBOOKS_CONFIG_DIR=${BOOKSHELF_AUDIOBOOKS_CONFIG_DIR}
BOOKSHELF_EBOOKS_CONTAINER_NAME=bookshelf-ebooks
BOOKSHELF_AUDIOBOOKS_CONTAINER_NAME=bookshelf-audiobooks

MEDIA_ROOT=${MEDIA_ROOT}
DOWNLOAD_ROOT=${DOWNLOAD_ROOT}
PLEX_ROOT=${PLEX_ROOT}

RREADING_GLASSES_CONTAINER_NAME=rreading-glasses
RREADING_GLASSES_PORT=${RREADING_GLASSES_PORT}
RREADING_GLASSES_UPSTREAM=www.goodreads.com
RREADING_GLASSES_POSTGRES_CONTAINER_NAME=rreading-glasses-postgres
RREADING_GLASSES_POSTGRES_DIR=${RREADING_GLASSES_POSTGRES_DIR}
RREADING_GLASSES_POSTGRES_HOST=127.0.0.1
RREADING_GLASSES_POSTGRES_PORT=${RREADING_GLASSES_POSTGRES_PORT}
RREADING_GLASSES_POSTGRES_DB=rreading-glasses
RREADING_GLASSES_POSTGRES_USER=rreading
RREADING_GLASSES_POSTGRES_PASSWORD=${RREADING_GLASSES_POSTGRES_PASSWORD}
EOF
  chmod 600 "$env_file"
  echo "Wrote ${env_file}"
}

preflight() {
  require_command docker

  if ! docker compose version >/dev/null 2>&1; then
    echo "Missing required docker compose plugin." >&2
    exit 1
  fi

  if [ ! -f "$SOURCE_COMPOSE" ]; then
    echo "Cannot find compose template: $SOURCE_COMPOSE" >&2
    exit 1
  fi

  if [ ! -d "$MEDIA_ROOT" ]; then
    echo "Warning: MEDIA_ROOT does not exist yet: $MEDIA_ROOT" >&2
  fi
  if [ ! -d "$DOWNLOAD_ROOT" ]; then
    echo "Warning: DOWNLOAD_ROOT does not exist yet: $DOWNLOAD_ROOT" >&2
  fi
  if [ ! -d "$PLEX_ROOT" ]; then
    echo "Warning: PLEX_ROOT does not exist yet: $PLEX_ROOT" >&2
  fi

  if [ "$SKIP_PULL" != "true" ]; then
    if docker manifest inspect "$BOOKSHELF_IMAGE" >/dev/null 2>&1; then
      echo "Bookshelf image is reachable: $BOOKSHELF_IMAGE"
    else
      echo "Warning: cannot inspect Bookshelf image: $BOOKSHELF_IMAGE" >&2
      echo "If this is a private GHCR package, authenticate Docker or make the package public." >&2
    fi
  fi
}

render_compose_inputs() {
  run mkdir -p "$INSTALL_DIR"
  run cp "$SOURCE_COMPOSE" "${INSTALL_DIR}/compose.yml"

  if [ ! -f "${INSTALL_DIR}/.env" ]; then
    write_env_file
  else
    echo "Keeping existing ${INSTALL_DIR}/.env"
  fi
}

validate_compose() {
  if [ "$DRY_RUN" = "true" ] && [ ! -f "${INSTALL_DIR}/compose.yml" ]; then
    RREADING_GLASSES_POSTGRES_PASSWORD="${RREADING_GLASSES_POSTGRES_PASSWORD:-dry-run-password}" \
      PUID="$PUID" \
      PGID="$PGID" \
      TZ="$TZ" \
      BOOKSHELF_IMAGE="$BOOKSHELF_IMAGE" \
      BOOKSHELF_METADATA_URL="$BOOKSHELF_METADATA_URL" \
      BOOKSHELF_EBOOKS_CONFIG_DIR="$BOOKSHELF_EBOOKS_CONFIG_DIR" \
      BOOKSHELF_AUDIOBOOKS_CONFIG_DIR="$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR" \
      MEDIA_ROOT="$MEDIA_ROOT" \
      DOWNLOAD_ROOT="$DOWNLOAD_ROOT" \
      PLEX_ROOT="$PLEX_ROOT" \
      RREADING_GLASSES_POSTGRES_DIR="$RREADING_GLASSES_POSTGRES_DIR" \
      RREADING_GLASSES_POSTGRES_PORT="$RREADING_GLASSES_POSTGRES_PORT" \
      RREADING_GLASSES_PORT="$RREADING_GLASSES_PORT" \
      docker compose -f "$SOURCE_COMPOSE" config >/dev/null
    echo "Compose template is valid."
    return
  fi

  (
    cd "$INSTALL_DIR"
    compose_cmd config >/dev/null
  )
  echo "Compose config is valid."
}

validate_bookshelf_api() {
  local ebook_base="http://127.0.0.1:${BOOKSHELF_EBOOKS_PORT}/api/v1"
  local audiobook_base="http://127.0.0.1:${BOOKSHELF_AUDIOBOOKS_PORT}/api/v1"

  require_command curl

  if [ -z "${EBOOK_API_KEY:-}" ] || [ -z "${AUDIOBOOK_API_KEY:-}" ]; then
    echo "Skipping API validation because EBOOK_API_KEY and AUDIOBOOK_API_KEY are not both set." >&2
    return 0
  fi

  echo "Validating ebook Bookshelf API on ${ebook_base}"
  curl -fsS -H "X-Api-Key: ${EBOOK_API_KEY}" \
    "${ebook_base}/config/development" >/dev/null
  curl -fsS -H "X-Api-Key: ${EBOOK_API_KEY}" \
    "${ebook_base}/book/lookup?term=isbn:9780547928227" >/dev/null

  echo "Validating audiobook Bookshelf API on ${audiobook_base}"
  curl -fsS -H "X-Api-Key: ${AUDIOBOOK_API_KEY}" \
    "${audiobook_base}/config/development" >/dev/null
  curl -fsS -H "X-Api-Key: ${AUDIOBOOK_API_KEY}" \
    "${audiobook_base}/book/lookup?term=Foundation%20Isaac%20Asimov" >/dev/null

  echo "Bookshelf API validation passed."
}

print_summary() {
  cat <<EOF

Bookshelf backend deployment summary:
  Install dir:              ${INSTALL_DIR}
  Compose file:             ${INSTALL_DIR}/compose.yml
  Env file:                 ${INSTALL_DIR}/.env
  Backups:                  ${BACKUP_DIR}
  Bookshelf image:          ${BOOKSHELF_IMAGE}
  Ebook config:             ${BOOKSHELF_EBOOKS_CONFIG_DIR}
  Audiobook config:         ${BOOKSHELF_AUDIOBOOKS_CONFIG_DIR}
  rreading-glasses data:    ${RREADING_GLASSES_POSTGRES_DIR}
  Metadata URL:             ${BOOKSHELF_METADATA_URL}
  Ebook Bookshelf port:     ${BOOKSHELF_EBOOKS_PORT}
  Audiobook Bookshelf port: ${BOOKSHELF_AUDIOBOOKS_PORT}

Seerr service settings:
  Ebook Bookshelf hostname: 127.0.0.1 or the Docker host name reachable by Seerr
  Ebook Bookshelf port:     ${BOOKSHELF_EBOOKS_PORT}
  Audiobook Bookshelf port: ${BOOKSHELF_AUDIOBOOKS_PORT}

After Bookshelf finishes first boot:
  1. Open each Bookshelf instance and copy its API key from Settings > General > Security.
  2. In Seerr, add one Bookshelf service with Book Format = Ebook and port ${BOOKSHELF_EBOOKS_PORT}.
  3. Add a second Bookshelf service with Book Format = Audiobook and port ${BOOKSHELF_AUDIOBOOKS_PORT}.
  4. Mark each as default for its own format.
  5. Use the Run Diagnostic button in Seerr's Bookshelf service modal.

Optional validation commands, after replacing API keys:
  curl -H 'X-Api-Key: EBOOK_API_KEY' 'http://127.0.0.1:${BOOKSHELF_EBOOKS_PORT}/api/v1/config/development'
  curl -H 'X-Api-Key: EBOOK_API_KEY' 'http://127.0.0.1:${BOOKSHELF_EBOOKS_PORT}/api/v1/book/lookup?term=isbn:9780547928227'
  curl -H 'X-Api-Key: AUDIOBOOK_API_KEY' 'http://127.0.0.1:${BOOKSHELF_AUDIOBOOKS_PORT}/api/v1/book/lookup?term=Foundation%20Isaac%20Asimov'
EOF
}

preflight
render_compose_inputs
validate_compose

if [ "$VALIDATE_ONLY" = "true" ]; then
  print_summary
  exit 0
fi

backup_path "$BOOKSHELF_EBOOKS_CONFIG_DIR" "bookshelf-ebooks-config"
backup_path "$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR" "bookshelf-audiobooks-config"
backup_path "$RREADING_GLASSES_POSTGRES_DIR" "rreading-glasses-postgres"

run mkdir -p "$BOOKSHELF_EBOOKS_CONFIG_DIR" "$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR" "$RREADING_GLASSES_POSTGRES_DIR"

if [ "$CLONE_EBOOKS_CONFIG_TO_AUDIOBOOKS" = "true" ] && [ -d "$BOOKSHELF_EBOOKS_CONFIG_DIR" ] && [ -z "$(find "$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  run cp -a "${BOOKSHELF_EBOOKS_CONFIG_DIR}/." "$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR/"
  echo "Cloned ebook config into audiobook config directory."
fi

ensure_bookshelf_config "$BOOKSHELF_EBOOKS_CONFIG_DIR" "$BOOKSHELF_EBOOKS_PORT" "ebook"
ensure_bookshelf_config "$BOOKSHELF_AUDIOBOOKS_CONFIG_DIR" "$BOOKSHELF_AUDIOBOOKS_PORT" "audiobook"

if [ "$NO_STOP_READARR" != "true" ] && [ -n "$STOP_OLD_READARR_CONTAINER" ]; then
  run docker stop "$STOP_OLD_READARR_CONTAINER" >/dev/null 2>&1 || true
  echo "Stopped old Readarr container: $STOP_OLD_READARR_CONTAINER"
fi

if [ "$DRY_RUN" != "true" ]; then
  (
    cd "$INSTALL_DIR"
    if [ "$SKIP_PULL" != "true" ]; then
      compose_cmd pull
    fi
    compose_cmd up -d
  )
else
  echo "Dry run complete; containers were not changed."
fi

if [ "$VALIDATE_API" = "true" ] && [ "$DRY_RUN" != "true" ]; then
  validate_bookshelf_api
fi

print_summary
