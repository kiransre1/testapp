# syntax=docker/dockerfile:1
# Browser worker. The Playwright image version MUST match the playwright npm
# package version pinned in apps/worker/package.json (1.65.1). The image ships
# Node 26.13.1, matching .nvmrc.
FROM mcr.microsoft.com/playwright:v1.65.1-noble AS base
ENV CI=1 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm install -g pnpm@12.23.0 --no-fund --no-audit
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/demo-target/package.json apps/demo-target/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter "@testapp/worker..."
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/worker apps/worker
RUN pnpm --filter @testapp/worker build \
  && pnpm --filter @testapp/worker deploy --prod --legacy /out \
  && cp -r apps/worker/dist /out/dist \
  && cp -r packages/db/drizzle /out/drizzle \
  && mkdir -p /out/fixtures && cp -r packages/core/fixtures/. /out/fixtures/ 2>/dev/null || true

FROM mcr.microsoft.com/playwright:v1.65.1-noble AS runtime
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    MIGRATIONS_DIR=/app/drizzle FAKE_PROVIDER_FIXTURE_DIR=/app/fixtures
WORKDIR /app
COPY --from=build --chown=pwuser:pwuser /out ./
RUN mkdir -p /data && chown pwuser:pwuser /data
USER pwuser
CMD ["node", "dist/main.mjs"]
