# Contributor/verification toolchain image: pinned Node LTS + pnpm.
# Used by scripts/in-docker.sh so contributors without a local Node install
# can run every check. Not used in production.
FROM node:26.13.1-bookworm-slim
RUN npm install -g pnpm@12.23.0 --no-fund --no-audit && pnpm --version
ENV CI=1 NEXT_TELEMETRY_DISABLED=1 PNPM_HOME=/pnpm PNPM_STORE_DIR=/pnpm-store
WORKDIR /repo
