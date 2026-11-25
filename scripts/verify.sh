#!/usr/bin/env bash
# TestApp single non-interactive verification entry point.
#
#   scripts/verify.sh            # everything
#   VERIFY_SKIP="compose" scripts/verify.sh   # skip named components (reported NOT RUN)
#
# Every component has a finite timeout and is reported as PASSED, FAILED or
# NOT RUN (with the reason). Exit status is non-zero if any mandatory component
# FAILED or was NOT RUN. Logs go to diagnostics/verify (git-ignored). Only
# resources created by this script are removed.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DIAG="$ROOT/diagnostics/verify"
mkdir -p "$DIAG"
OVERALL_DEADLINE=$(( $(date +%s) + ${VERIFY_TIMEOUT_SECONDS:-5400} ))
SKIP=" ${VERIFY_SKIP:-} "

if ! command -v timeout >/dev/null 2>&1; then
  timeout() { local t="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$t" "$@"; }
fi

declare -a NAMES=() RESULTS=() NOTES=()
record() { NAMES+=("$1"); RESULTS+=("$2"); NOTES+=("$3"); printf '%-22s %-8s %s\n' "$1" "$2" "$3"; }

run() { # name timeout_seconds command...
  local name="$1" t="$2"; shift 2
  if [[ "$SKIP" == *" $name "* ]]; then record "$name" "NOT RUN" "skipped via VERIFY_SKIP"; return; fi
  local now; now=$(date +%s)
  if (( now >= OVERALL_DEADLINE )); then record "$name" "NOT RUN" "overall verification deadline reached"; return; fi
  local remaining=$(( OVERALL_DEADLINE - now )); (( t > remaining )) && t=$remaining
  local start=$now
  timeout "$t" "$@" >"$DIAG/$name.log" 2>&1
  local rc=$?
  local dur=$(( $(date +%s) - start ))
  if [ $rc -eq 0 ]; then record "$name" "PASSED" "${dur}s";
  elif [ $rc -eq 124 ] || [ $rc -eq 142 ]; then record "$name" "FAILED" "timed out after ${t}s (log: diagnostics/verify/$name.log)";
  else record "$name" "FAILED" "exit $rc after ${dur}s (log: diagnostics/verify/$name.log)"; fi
}

echo "TestApp verification — $(date -u +%Y-%m-%dT%H:%M:%SZ) — commit $(git rev-parse --short HEAD 2>/dev/null || echo unknown)$(git diff --quiet 2>/dev/null || echo ' (+uncommitted changes)')"

# Environment probe: all components run inside pinned containers.
if ! timeout 30 docker info >/dev/null 2>&1; then
  for c in install format lint typecheck unit integration build e2e compose-config compose-stack; do
    record "$c" "NOT RUN" "Docker daemon unavailable (probe timed out or failed); no host toolchain is assumed"
  done
else
  IN=("$ROOT/scripts/in-docker.sh")
  run install 900 "${IN[@]}" pnpm install --frozen-lockfile
  run format 300 "${IN[@]}" pnpm format:check
  run lint 300 "${IN[@]}" pnpm lint
  run typecheck 600 "${IN[@]}" pnpm typecheck
  run unit 600 "${IN[@]}" pnpm test:unit
  run integration 900 "$ROOT/scripts/with-test-postgres.sh" pnpm test:integration
  run build 900 "${IN[@]}" pnpm build
  SKIP_BUILD=1 run e2e 1800 "$ROOT/scripts/e2e-local.sh"
  run compose-config 60 docker compose --env-file .env.example -f docker-compose.yml --profile demo config -q
  run compose-stack 3000 "$ROOT/scripts/verify-compose.sh"
fi

# Repository hygiene: no secrets or generated artifacts tracked.
hygiene() {
  local bad=0
  if git ls-files | grep -E '(^|/)\.env$|(^|/)\.env\.(local|production|development)$|\.pem$|\.key$|(^|/)(test-results|playwright-report|diagnostics|\.data|node_modules|\.next|dist)/' ; then bad=1; fi
  # Source files hidden by ignore rules would pass locally but be missing from the repository.
  if git ls-files --others --ignored --exclude-standard \
    | grep -vE '(^|/)(node_modules|\.next|dist|diagnostics|test-results|playwright-report|\.data)/|\.tsbuildinfo$|next-env\.d\.ts$' \
    | grep -E '\.(ts|tsx|js|mjs|json|css|sql|md|ya?ml|sh)$'; then
    echo "ignored source files found (see above)"; bad=1
  fi
  if git grep -nIE -- '-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}' -- ':!scripts/verify.sh' ; then bad=1; fi
  return $bad
}
if hygiene >"$DIAG/repo-hygiene.log" 2>&1; then record repo-hygiene PASSED "no secrets or generated artifacts tracked"; else record repo-hygiene FAILED "see diagnostics/verify/repo-hygiene.log"; fi

echo
echo "Summary"
fail=0
for i in "${!NAMES[@]}"; do
  printf '  %-22s %s\n' "${NAMES[$i]}" "${RESULTS[$i]}"
  [ "${RESULTS[$i]}" = "PASSED" ] || fail=1
done
{
  echo "verified_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "commit=$(git rev-parse HEAD 2>/dev/null)"
  echo "worktree_clean=$(git diff --quiet && git diff --cached --quiet && echo yes || echo no)"
  for i in "${!NAMES[@]}"; do echo "${NAMES[$i]}=${RESULTS[$i]} ${NOTES[$i]}"; done
} >"$DIAG/summary.txt"
exit $fail
