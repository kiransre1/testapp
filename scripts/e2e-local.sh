#!/usr/bin/env bash
# Disposable end-to-end environment: a private network, a throwaway PostgreSQL
# and the pinned Playwright image (browsers + Node 26) running scripts/e2e-inner.sh.
# Removes only the resources it created. Logs are kept in diagnostics/e2e.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUFFIX="$(date +%s)-$$"
NET="testapp-e2e-net-$SUFFIX"; PG="testapp-e2e-pg-$SUFFIX"; RUNNER="testapp-e2e-runner-$SUFFIX"
PGPASS="e2e-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
cleanup() { docker rm -f "$RUNNER" "$PG" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" --tmpfs /var/lib/postgresql -e POSTGRES_USER=testapp -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB=testapp postgres:18-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "$PG" pg_isready -U testapp -d testapp >/dev/null 2>&1 && break; sleep 1; done
sleep 1
docker run --name "$RUNNER" --rm --network "$NET" --ipc=host --init \
  -v "$ROOT:/repo" -v testapp-pnpm-store:/pnpm-store -e PNPM_STORE_DIR=/pnpm-store \
  -e DATABASE_URL="postgres://testapp:$PGPASS@$PG:5432/testapp" \
  -e SKIP_BUILD="${SKIP_BUILD:-0}" -e E2E_GREP="${E2E_GREP:-}" \
  mcr.microsoft.com/playwright:v1.65.1-noble bash /repo/scripts/e2e-inner.sh
