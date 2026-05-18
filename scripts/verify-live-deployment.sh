#!/usr/bin/env bash
set -euo pipefail

HOST="${SEERRNG_DEPLOY_HOST:-kspls0}"
CONTAINER="${SEERRNG_CONTAINER_NAME:-seerr-host}"
PORT="${SEERRNG_PORT:-5055}"
EXPECTED_COMMIT="${1:-$(git rev-parse HEAD)}"

ssh "$HOST" bash -s -- "$CONTAINER" "$PORT" "$EXPECTED_COMMIT" <<'EOF'
set -euo pipefail
CONTAINER="$1"
PORT="$2"
EXPECTED_COMMIT="$3"

running="$(docker ps \
  --filter "name=^/${CONTAINER}$" \
  --filter "status=running" \
  --format '{{.Names}}')"
test "$running" = "$CONTAINER"

status_json="$(curl --fail --silent --show-error "http://127.0.0.1:${PORT}/api/v1/status")"
commit_tag="$(printf '%s' "$status_json" | jq -r '.commitTag')"
image_revision="$(docker inspect "$CONTAINER" \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"

printf 'container=%s\n' "$CONTAINER"
printf 'status.commitTag=%s\n' "$commit_tag"
printf 'image.revision=%s\n' "$image_revision"
printf 'expected=%s\n' "$EXPECTED_COMMIT"

test "$commit_tag" = "$EXPECTED_COMMIT"
test "$image_revision" = "$EXPECTED_COMMIT"
EOF
