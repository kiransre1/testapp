#!/usr/bin/env bash
# Start a disposable PostgreSQL container on a private network, run the given
# command in the toolchain container with TEST_DATABASE_URL set, then remove
# only the resources this script created.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUFFIX="$(date +%s)-$$"
NET="testapp-it-net-$SUFFIX"
PG="testapp-it-pg-$SUFFIX"
PGPASS="it-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
cleanup() {
  docker rm -f "$PG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" --tmpfs /var/lib/postgresql \
  -e POSTGRES_USER=testapp -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB=testapp_admin \
  postgres:18-alpine >/dev/null
ready=0
for _ in $(seq 1 60); do
  if docker exec "$PG" pg_isready -U testapp -d testapp_admin >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then echo "PostgreSQL did not become ready within 60s" >&2; docker logs "$PG" 2>&1 | tail -20 >&2; exit 3; fi
sleep 1
TESTAPP_DOCKER_NETWORK="$NET" \
TESTAPP_DOCKER_ENV="TEST_DATABASE_URL=postgres://testapp:$PGPASS@$PG:5432/testapp_admin ${TESTAPP_DOCKER_ENV:-}" \
  "$ROOT/scripts/in-docker.sh" "$@"
