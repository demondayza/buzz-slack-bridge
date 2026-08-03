#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
GENERATED_DIR="$ROOT_DIR/deploy/generated"
SYNAPSE_DIR="$GENERATED_DIR/synapse"
MAUTRIX_DIR="$GENERATED_DIR/mautrix-slack"
BRIDGE_DIR="$GENERATED_DIR/bridge"
MATRIX_SERVER_NAME=${MATRIX_SERVER_NAME:-matrix.localhost}
SYNAPSE_IMAGE="ghcr.io/element-hq/synapse:v1.157.2@sha256:097e3120b8ecf97e4f92537d7af2da41564c706e33fc740f3741c9defacc2af1"
MAUTRIX_IMAGE="dock.mau.dev/mautrix/slack:v0.2607.0@sha256:36e05f31f6c6e74385766cb3bda620f6082b936c0f7ec3415157a2cdf2f3a773"

command -v docker >/dev/null || {
  echo "Docker is required." >&2
  exit 1
}

mkdir -p "$SYNAPSE_DIR" "$MAUTRIX_DIR" "$BRIDGE_DIR"

if [[ ! -f "$SYNAPSE_DIR/homeserver.yaml" ]]; then
  docker run --rm \
    -v "$SYNAPSE_DIR:/data" \
    -e "SYNAPSE_SERVER_NAME=$MATRIX_SERVER_NAME" \
    -e SYNAPSE_REPORT_STATS=no \
    "$SYNAPSE_IMAGE" generate
fi

if [[ ! -f "$MAUTRIX_DIR/config.yaml" ]]; then
  docker run --rm -v "$MAUTRIX_DIR:/data" "$MAUTRIX_IMAGE"
fi

MATRIX_SERVER_NAME="$MATRIX_SERVER_NAME" perl -0pi -e '
  $domain = $ENV{"MATRIX_SERVER_NAME"};
  s|    type: postgres|    type: sqlite3-fk-wal|;
  s|    uri: postgres://user:password\@host/database\?sslmode=disable|    uri: file:/data/mautrix-slack.db?_txlock=immediate|;
  s|    address: http://example\.localhost:8008|    address: http://synapse:8008|;
  s|    domain: example\.com|    domain: $domain|;
  s|    address: http://localhost:29335|    address: http://mautrix-slack:29335|;
  s|    public_address: https://bridge\.example\.com|    public_address:|;
  s|    hostname: 127\.0\.0\.1|    hostname: 0.0.0.0|;
  s|        "example\.com": user|        "$domain": user|;
  s|        "\@admin:example\.com": admin|        "\@buzzbridge:$domain": admin|;
  s|    federate_rooms: true|    federate_rooms: false|;
' "$MAUTRIX_DIR/config.yaml"

for expected in \
  "type: sqlite3-fk-wal" \
  "address: http://synapse:8008" \
  "domain: $MATRIX_SERVER_NAME" \
  "address: http://mautrix-slack:29335" \
  'hostname: 0.0.0.0'; do
  if ! grep -Fq "$expected" "$MAUTRIX_DIR/config.yaml"; then
    echo "Generated mautrix-slack config is missing: $expected" >&2
    exit 1
  fi
done

if [[ ! -f "$MAUTRIX_DIR/registration.yaml" ]]; then
  docker run --rm -v "$MAUTRIX_DIR:/data" "$MAUTRIX_IMAGE"
fi

if ! grep -q '^app_service_config_files:' "$SYNAPSE_DIR/homeserver.yaml"; then
  printf '\napp_service_config_files:\n  - /data/mautrix-slack-registration.yaml\n' \
    >> "$SYNAPSE_DIR/homeserver.yaml"
fi

if [[ ! -f "$BRIDGE_DIR/config.json" ]]; then
  cp "$ROOT_DIR/config.example.json" "$BRIDGE_DIR/config.json"
fi

MATRIX_SERVER_NAME="$MATRIX_SERVER_NAME" perl -0pi -e '
  $domain = $ENV{"MATRIX_SERVER_NAME"};
  s|\@buzzbridge:matrix\.localhost|\@buzzbridge:$domain|;
' "$BRIDGE_DIR/config.json"

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
fi

echo
echo "Generated deployment configuration under deploy/generated/."
echo "Next: docker compose up -d synapse mautrix-slack"
echo "Then: ./scripts/create-matrix-user.sh"
