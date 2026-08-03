#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

MATRIX_SERVER_NAME=${MATRIX_SERVER_NAME:-matrix.localhost}
MATRIX_PORT=${MATRIX_PORT:-8008}
MATRIX_USER=${MATRIX_USER:-buzzbridge}
MATRIX_PASSWORD=${MATRIX_PASSWORD:-$(openssl rand -base64 30 | tr -d '\n')}

docker compose exec -T synapse register_new_matrix_user \
  -c /data/homeserver.yaml \
  http://localhost:8008 \
  --no-admin \
  --user "$MATRIX_USER" \
  --password "$MATRIX_PASSWORD"

response=$(curl --fail-with-body --silent --show-error \
  -X POST "http://127.0.0.1:${MATRIX_PORT}/_matrix/client/v3/login" \
  -H 'Content-Type: application/json' \
  --data "{\"type\":\"m.login.password\",\"identifier\":{\"type\":\"m.id.user\",\"user\":\"${MATRIX_USER}\"},\"password\":\"${MATRIX_PASSWORD}\"}")

token=$(RESPONSE="$response" node -e 'process.stdout.write(JSON.parse(process.env.RESPONSE).access_token)')

echo
echo "Matrix user: @${MATRIX_USER}:${MATRIX_SERVER_NAME}"
echo "Matrix password: ${MATRIX_PASSWORD}"
echo "Add this line to .env:"
echo "MATRIX_ACCESS_TOKEN=${token}"
