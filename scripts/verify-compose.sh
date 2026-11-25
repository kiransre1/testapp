#!/usr/bin/env bash
# Isolated Docker Compose verification: builds the production images, starts a
# disposable project (unique name, own volumes, nothing published to the host),
# waits for health with a bounded timeout, runs the e2e suite against the
# containers from a Playwright container on the project network, scans logs
# and the artifact volume for leaked secrets, then tears down ONLY that project.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DIAG="$ROOT/diagnostics/verify-compose"
mkdir -p "$DIAG"
PROJECT="testapp-verify-$(date +%s)"
ENVF="$DIAG/compose.env"
rnd() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
umask 077
cat >"$ENVF" <<ENV
POSTGRES_USER=testapp
POSTGRES_PASSWORD=pg-$(rnd 12)
POSTGRES_DB=testapp
SESSION_SECRET=$(rnd 32)
APP_ENCRYPTION_KEY=$(head -c 32 /dev/urandom | base64)
APP_BASE_URL=http://web:3000
BOOTSTRAP_ADMIN_EMAIL=verify-admin@example.test
BOOTSTRAP_ADMIN_PASSWORD=verify-$(rnd 12)
LLM_PROVIDER=fake
DEMO_MODE=true
DEMO_TARGET_HOSTNAMES=demo-target
DEMO_TARGET_USERNAME=demo.user@example.test
DEMO_TARGET_PASSWORD=demo-$(rnd 10)
WORKER_POLL_INTERVAL_MS=500
ENV
get() { grep "^$1=" "$ENVF" | head -1 | cut -d= -f2-; }
DC=(docker compose -p "$PROJECT" --env-file "$ENVF" -f docker-compose.yml -f docker-compose.verify.yml --profile demo)

teardown() {
  "${DC[@]}" logs --no-color >"$DIAG/compose.log" 2>&1 || true
  "${DC[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$ENVF"
}
trap teardown EXIT

echo "[compose] building images (bounded 20 min)"
if ! timeout 1200 "${DC[@]}" build >"$DIAG/build.log" 2>&1; then echo "[compose] image build FAILED"; tail -40 "$DIAG/build.log"; exit 1; fi
echo "[compose] starting stack"
if ! timeout 300 "${DC[@]}" up -d --wait --wait-timeout 240 >"$DIAG/up.log" 2>&1; then
  echo "[compose] stack did not become healthy"; tail -40 "$DIAG/up.log"; "${DC[@]}" ps; exit 1
fi
"${DC[@]}" ps --format '{{.Service}} {{.Status}}' | tee "$DIAG/ps.txt"

NET="${PROJECT}_default"
echo "[compose] running e2e suite against the containers"
timeout 1500 docker run --rm --network "$NET" --ipc=host --init \
  -v "$ROOT:/repo" -w /repo \
  -e CI=1 -e E2E_BASE_URL=http://web:3000 -e DEMO_TARGET_URL=http://demo-target:4000 \
  -e E2E_ADMIN_EMAIL="$(get BOOTSTRAP_ADMIN_EMAIL)" -e E2E_ADMIN_PASSWORD="$(get BOOTSTRAP_ADMIN_PASSWORD)" \
  -e E2E_DEMO_USERNAME="$(get DEMO_TARGET_USERNAME)" -e E2E_DEMO_PASSWORD="$(get DEMO_TARGET_PASSWORD)" \
  mcr.microsoft.com/playwright:v1.65.1-noble \
  bash -c 'npm install -g pnpm@12.23.0 --no-fund --no-audit >/dev/null 2>&1; pnpm exec playwright test -c e2e/playwright.config.ts' \
  >"$DIAG/e2e.log" 2>&1
status=$?
grep -E "passed|failed|did not run|flaky" "$DIAG/e2e.log" | tail -5

"${DC[@]}" logs --no-color >"$DIAG/compose.log" 2>&1 || true
leak=0
for key in POSTGRES_PASSWORD SESSION_SECRET APP_ENCRYPTION_KEY BOOTSTRAP_ADMIN_PASSWORD DEMO_TARGET_PASSWORD; do
  v="$(get "$key")"
  if grep -qF -- "$v" "$DIAG/compose.log" "$DIAG/e2e.log"; then echo "[compose] SECRET LEAK in logs: $key"; leak=1; fi
  if docker run --rm -e S="$v" -v "${PROJECT}_artifacts:/data:ro" node:26.13.1-bookworm-slim sh -c 'grep -rqF -- "$S" /data'; then
    echo "[compose] SECRET LEAK in artifact volume: $key"; leak=1
  fi
done
[ "$leak" = 0 ] && echo "[compose] secret-leak scan: clean"
[ "$status" = 0 ] && [ "$leak" = 0 ]
