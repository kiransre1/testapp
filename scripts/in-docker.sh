#!/usr/bin/env bash
# Run a command inside the pinned Node toolchain container with the repository
# mounted. Example: scripts/in-docker.sh pnpm test:unit
# Optional: TESTAPP_DOCKER_NETWORK to attach to a network, extra -e via
# TESTAPP_DOCKER_ENV (space separated NAME=VALUE pairs; never secrets of value).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="testapp-toolchain:26.13.1"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  timeout 600 docker build -q -t "$IMAGE" -f "$ROOT/docker/toolchain.Dockerfile" "$ROOT/docker" >/dev/null
fi
args=(--rm -i -v "$ROOT:/repo" -v testapp-pnpm-store:/pnpm-store -w /repo -e CI=1)
if [ -n "${TESTAPP_DOCKER_NETWORK:-}" ]; then args+=(--network "$TESTAPP_DOCKER_NETWORK"); fi
for kv in ${TESTAPP_DOCKER_ENV:-}; do args+=(-e "$kv"); done
exec docker run "${args[@]}" "$IMAGE" "$@"
