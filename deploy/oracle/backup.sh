#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
docker compose --env-file .env.oracle -f deploy/oracle/compose.yaml exec -T app npm run backup -- /backups

