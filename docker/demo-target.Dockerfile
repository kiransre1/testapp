# syntax=docker/dockerfile:1
# Deliberately buggy synthetic demo target. For local demonstration only.
FROM node:26.13.1-bookworm-slim AS build
ENV CI=1
RUN npm install -g pnpm@12.23.0 --no-fund --no-audit
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/demo-target/package.json apps/demo-target/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter "@testapp/demo-target..."
COPY tsconfig.base.json ./
COPY apps/demo-target apps/demo-target
RUN pnpm --filter @testapp/demo-target build

FROM node:26.13.1-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/demo-target/dist ./dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=5s --timeout=3s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:4000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.mjs"]
