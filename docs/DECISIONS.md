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
7. **One generic `jobs` table** (`preflight`, `generate_plan`, `execute_run`) claimed with
   `FOR UPDATE SKIP LOCKED`, plus leases and heartbeats. No Redis. `execute_run` jobs are never
   retried automatically: an interrupted run becomes `partial` so that browser side effects are
   not duplicated.
8. **Observed findings are derived deterministically.** The LLM can only add heuristic
   observations, inferred risks and enhancement opportunities. The finding schema rejects an
   observed category that lacks evidence or comes from `llm_analysis`.
9. **Soft assertions within a scenario.** After an assertion fails, the scenario keeps executing
   to collect more evidence (for example the "after reload" check). It stops at the first
   blocked step or error, because continuing could act on an unexpected state.
10. **Redirects are checked hop by hop** with `route.fetch({maxRedirects: 0})` and fulfilment.
    WebKit cannot fulfil 3xx, so it gets a policy-checked same-tab GET (meta refresh, with cookies
    forwarded). That keeps one network request per hop and never double-submits forms.
11. **Login runs in an untraced, un-screenshotted context.** Its storage state stays in memory
    for the run only. Scenarios that type secrets themselves are not traced.
12. **Structured outputs for Anthropic.** Current models reject forced `tool_choice`, so the
    provider uses `output_config.format` with a JSON Schema generated from the Zod contracts.
    Constraint keywords are stripped from the schema and enforced by Zod afterwards. No
    `thinking` parameter is sent, so the request stays valid for whichever model the operator
    configures. One repair attempt is allowed, and the provider never falls back to fake output.
13. **The report is built once and rendered many ways.** `buildReport` produces the
    schema-validated JSON. Markdown, printable HTML and the fix packet are rendered from it and
    stored as private artifacts. The in-app report page renders the same JSON.
14. **Containers share uid 1000** for the artifact volume: `node` in the web image and `ubuntu`
    in the Playwright worker image. Artifacts stay 0600/0700 rather than becoming
    group/world-readable.
15. **Single verification entry point** (`scripts/verify.sh`) that runs everything in pinned
    containers. The host needs only Docker. Skipped components are reported as NOT RUN, never as
    passed.
16. **Commits stayed local** because no non-interactive GitHub write credential was available
    (see BUILD_STATUS.md). Authentication failures were not retried and no interactive login was
    attempted.
