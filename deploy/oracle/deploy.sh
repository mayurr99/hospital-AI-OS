#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ ! -f .env.oracle ]]; then
  echo "Missing .env.oracle. Copy .env.oracle.example and fill DOMAIN and STORAGE_ENCRYPTION_KEY."
  exit 1
fi

if ! grep -Eq '^DOMAIN=.+\..+' .env.oracle; then
  echo "DOMAIN in .env.oracle must be a real DNS name pointing to this VM."
  exit 1
fi

if ! grep -Eq '^STORAGE_ENCRYPTION_KEY=([0-9a-fA-F]{64}|[A-Za-z0-9+/]{43}=?)$' .env.oracle; then
  echo "STORAGE_ENCRYPTION_KEY must be a 32-byte value. Generate it with: openssl rand -hex 32"
  exit 1
fi

mkdir -p .oracle-data .oracle-backups
chmod 700 .oracle-data .oracle-backups
if [[ "$(id -u)" == "0" ]]; then
  chown -R 1000:1000 .oracle-data .oracle-backups
else
  sudo chown -R 1000:1000 .oracle-data .oracle-backups
fi

docker compose --env-file .env.oracle -f deploy/oracle/compose.yaml build --pull
docker compose --env-file .env.oracle -f deploy/oracle/compose.yaml up -d
docker compose --env-file .env.oracle -f deploy/oracle/compose.yaml ps

