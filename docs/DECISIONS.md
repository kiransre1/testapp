# Implementation decisions

Each entry: decision, reason, consequence.

1. **Toolchain pinned to Node 26.13.1 + pnpm 12.23.0.** Node 26 is the active
   LTS line on the build date; the Playwright 1.65.1 Docker image ships the same
   Node version, so web, worker and CI share one runtime.
2. **pnpm supply-chain guard kept on.** pnpm 12 rejects packages published less
   than a day ago. Instead of disabling it, a few dev tools use caret ranges and
   resolve to the newest version that passes the policy (pinned by the lockfile).
3. **Biome for formatting and linting** instead of ESLint + Prettier: one fast
   tool, one config, no plugin compatibility matrix with TypeScript 6/Next 16.
4. **TypeScript 6.0.x** rather than 7.x (native compiler): Next.js build-time
   type checking and editor tooling still expect the JavaScript compiler API.
5. **Containerised toolchain** (`scripts/in-docker.sh`): the build host has no
   Node install, and nothing is installed onto the host.
6. **Worker and CLIs bundled with esbuild**; workspace packages are consumed as
   TypeScript source (`exports` → `src/index.ts`) and transpiled by Next.js
   (`transpilePackages`) or esbuild. Avoids a per-package compile step.
