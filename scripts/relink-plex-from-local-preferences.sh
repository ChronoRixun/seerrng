#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="${CONFIG_DIRECTORY:-"$ROOT_DIR/config"}"
SETTINGS_FILE="$CONFIG_DIR/settings.json"
DB_FILE="$CONFIG_DIR/db/db.sqlite3"
PLEX_PREFS="${PLEX_PREFERENCES:-/var/lib/plex-standby-config/Library/Application Support/Plex Media Server/Preferences.xml}"
PLEX_PROXY_HOST="${PLEX_PROXY_HOST:-127.0.0.1}"
PLEX_PROXY_PORT="${PLEX_PROXY_PORT:-33240}"

if [[ ! -f "$PLEX_PREFS" ]]; then
  echo "Plex Preferences.xml not found: $PLEX_PREFS" >&2
  exit 1
fi

if [[ ! -f "$SETTINGS_FILE" ]]; then
  echo "Seerr settings file not found: $SETTINGS_FILE" >&2
  exit 1
fi

if [[ ! -f "$DB_FILE" ]]; then
  echo "Seerr sqlite database not found: $DB_FILE" >&2
  exit 1
fi

command -v sqlite3 >/dev/null || {
  echo "sqlite3 is required" >&2
  exit 1
}

readarray -t plex_values < <(
  PLEX_PREFS="$PLEX_PREFS" python - <<'PY'
import os
import sys
import xml.etree.ElementTree as ET

root = ET.parse(os.environ["PLEX_PREFS"]).getroot()
required = ["PlexOnlineToken", "ProcessedMachineIdentifier"]
missing = [key for key in required if not root.attrib.get(key)]
if missing:
    print(f"missing Plex preference fields: {', '.join(missing)}", file=sys.stderr)
    sys.exit(1)

print(root.attrib["PlexOnlineToken"])
print(root.attrib["ProcessedMachineIdentifier"])
print(root.attrib.get("FriendlyName") or "Plex")
PY
)

PLEX_TOKEN="${plex_values[0]}"
PLEX_MACHINE_ID="${plex_values[1]}"
PLEX_NAME="${plex_values[2]}"

curl -fsS --compressed --max-time 10 \
  -H "X-Plex-Token: ${PLEX_TOKEN}" \
  "http://${PLEX_PROXY_HOST}:${PLEX_PROXY_PORT}/library/sections" \
  >/dev/null

SETTINGS_FILE="$SETTINGS_FILE" \
PLEX_PROXY_HOST="$PLEX_PROXY_HOST" \
PLEX_PROXY_PORT="$PLEX_PROXY_PORT" \
PLEX_MACHINE_ID="$PLEX_MACHINE_ID" \
PLEX_NAME="$PLEX_NAME" \
python - <<'PY'
import json
import os
from pathlib import Path

path = Path(os.environ["SETTINGS_FILE"])
settings = json.loads(path.read_text())
settings.setdefault("plex", {})
settings["plex"]["name"] = os.environ["PLEX_NAME"]
settings["plex"]["ip"] = os.environ["PLEX_PROXY_HOST"]
settings["plex"]["port"] = int(os.environ["PLEX_PROXY_PORT"])
settings["plex"]["useSsl"] = False
settings["plex"]["machineId"] = os.environ["PLEX_MACHINE_ID"]
path.write_text(json.dumps(settings, indent=2) + "\n")
PY

DB_FILE="$DB_FILE" PLEX_TOKEN="$PLEX_TOKEN" python - <<'PY'
import os
import sqlite3

with sqlite3.connect(os.environ["DB_FILE"]) as conn:
    conn.execute(
        """
        update user
           set plexToken = ?,
               plexId = coalesce(plexId, 1)
         where plexToken is not null
            or id = 1
        """,
        (os.environ["PLEX_TOKEN"],),
    )
PY

echo "Relinked Seerr Plex settings to ${PLEX_NAME} via ${PLEX_PROXY_HOST}:${PLEX_PROXY_PORT}."
echo "Restart Seerr for running processes to pick up the updated settings."
