#!/usr/bin/env bash
# Runs INSIDE the Playwright image (scripts/e2e-local.sh starts it). Builds the
# apps, migrates an empty database, bootstraps the single user with ephemeral
# credentials, starts demo target + web + worker in the background, runs the
# Playwright suite, captures logs, and checks logs/exports for secret leakage.
set -uo pipefail
cd /repo
export CI=1 NEXT_TELEMETRY_DISABLED=1
DIAG="${DIAG_DIR:-/repo/diagnostics/e2e}"
mkdir -p "$DIAG"
rnd() { node -e "process.stdout.write(require('crypto').randomBytes($1).toString('base64url'))"; }
export SESSION_SECRET="$(rnd 48)"
export APP_ENCRYPTION_KEY="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))")"
export BOOTSTRAP_ADMIN_EMAIL="e2e-admin@example.test"
export BOOTSTRAP_ADMIN_PASSWORD="e2e-$(rnd 18)"
export DEMO_PASSWORD="demo-$(rnd 12)"
export DEMO_USERNAME="demo.user@example.test"
export DATA_DIR="$(mktemp -d)/data"
export LLM_PROVIDER=fake DEMO_MODE=true DEMO_TARGET_HOSTNAMES=127.0.0.1,localhost
export APP_BASE_URL=http://127.0.0.1:3000 E2E_BASE_URL=http://127.0.0.1:3000
export DEMO_TARGET_URL=http://127.0.0.1:4000
export WORKER_POLL_INTERVAL_MS=500
export E2E_ADMIN_EMAIL="$BOOTSTRAP_ADMIN_EMAIL" E2E_ADMIN_PASSWORD="$BOOTSTRAP_ADMIN_PASSWORD"
export E2E_DEMO_USERNAME="$DEMO_USERNAME" E2E_DEMO_PASSWORD="$DEMO_PASSWORD"

npm install -g pnpm@12.23.0 --no-fund --no-audit >/dev/null 2>&1
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  pnpm install --frozen-lockfile >"$DIAG/install.log" 2>&1 || { echo "install failed"; tail -30 "$DIAG/install.log"; exit 1; }
  pnpm build >"$DIAG/build.log" 2>&1 || { echo "build failed"; tail -40 "$DIAG/build.log"; exit 1; }
fi
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/ 2>/dev/null || true

MIGRATIONS_DIR=/repo/packages/db/drizzle node apps/worker/dist/migrate.mjs || exit 1
node apps/worker/dist/bootstrap-admin.mjs || exit 1

PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; }
trap cleanup EXIT
PORT=4000 HOST=127.0.0.1 node apps/demo-target/dist/server.mjs >"$DIAG/demo-target.log" 2>&1 & PIDS+=($!)
(cd apps/web/.next/standalone && PORT=3000 HOSTNAME=127.0.0.1 node apps/web/server.js) >"$DIAG/web.log" 2>&1 & PIDS+=($!)
FAKE_PROVIDER_FIXTURE_DIR=/repo/packages/core/fixtures node apps/worker/dist/main.mjs >"$DIAG/worker.log" 2>&1 & PIDS+=($!)

for url in http://127.0.0.1:4000/healthz http://127.0.0.1:3000/api/health; do
  ok=0; for _ in $(seq 1 90); do curl -fsS "$url" >/dev/null 2>&1 && { ok=1; break; }; sleep 1; done
  [ "$ok" = 1 ] || { echo "service not healthy: $url"; tail -30 "$DIAG"/*.log; exit 1; }
done

pnpm exec playwright test -c e2e/playwright.config.ts ${E2E_GREP:+--grep "$E2E_GREP"}
status=$?

# Secret-leak review: none of the ephemeral secrets may appear in logs or stored artifacts.
leak=0
for secret in "$DEMO_PASSWORD" "$BOOTSTRAP_ADMIN_PASSWORD" "$SESSION_SECRET" "$APP_ENCRYPTION_KEY"; do
  if grep -rqF -- "$secret" "$DIAG" "$DATA_DIR" 2>/dev/null; then echo "SECRET LEAK DETECTED in logs or artifacts"; leak=1; fi
done
[ "$leak" = 0 ] && echo "secret-leak scan: clean (logs + $(find "$DATA_DIR" -type f | wc -l) artifact files)"
[ "$status" = 0 ] && [ "$leak" = 0 ]
