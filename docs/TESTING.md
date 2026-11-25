# Testing

All automated tests use the deterministic fake provider and need no Anthropic key. Ephemeral
secrets, admin credentials and target credentials are generated inside each test process or
script. You never need to create a `.env` file to run them.

## Single entry point

```bash
scripts/verify.sh
```

`scripts/verify.sh` runs each component below with a finite timeout and reports each one as
**PASSED**, **FAILED** or **NOT RUN** (with the reason). It exits non-zero if any component did
not pass. Logs go to `diagnostics/verify/` (git-ignored), and the summary is written to
`diagnostics/verify/summary.txt`. The whole run is capped by `VERIFY_TIMEOUT_SECONDS`, which
defaults to 90 minutes. To skip components, set `VERIFY_SKIP="compose-stack e2e"`; skipped
components are reported as NOT RUN, never as passed.

| Component      | Command                                               | What it covers                                                                                                                                                                                                                                                                                                                                                                  |
| -------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| install        | `pnpm install --frozen-lockfile`                      | Lockfile integrity. pnpm's minimum-release-age supply-chain policy stays on.                                                                                                                                                                                                                                                                                                    |
| format / lint  | `pnpm format:check`, `pnpm lint`                      | Biome.                                                                                                                                                                                                                                                                                                                                                                          |
| typecheck      | `pnpm typecheck`                                      | Every workspace plus the e2e suite.                                                                                                                                                                                                                                                                                                                                             |
| unit           | `pnpm test:unit`                                      | Vitest. Plan validation, rejection of scripts and unknown actions, secret refs and redaction, origin and redirect rules, action policy, budgets and loop detection, state transitions, finding classification and deduplication, report schemas and rendering, regression comparison, agentic schema, storage key safety, providers (fake, and Anthropic with a mocked client). |
| integration    | `scripts/with-test-postgres.sh pnpm test:integration` | A disposable PostgreSQL container. Migrations from an empty DB, auth and sessions, rate limiting, target and brief persistence, credential encryption and non-disclosure, fake-provider plan generation, transactional job claiming, heartbeats, lease expiry and interrupted runs, cancellation. Each test file creates and drops its own database.                            |
| build          | `pnpm build`                                          | Next.js production build, worker and demo-target bundles.                                                                                                                                                                                                                                                                                                                       |
| e2e            | `scripts/e2e-local.sh`                                | A disposable network with PostgreSQL and the pinned Playwright image running demo-target, web and worker. Runs the Playwright suite, then scans logs and artifacts for secrets.                                                                                                                                                                                                 |
| compose-config | `docker compose … config -q`                          | Compose file validity.                                                                                                                                                                                                                                                                                                                                                          |
| compose-stack  | `scripts/verify-compose.sh`                           | Builds the production images and starts an isolated Compose project (unique name, its own volumes, nothing published) with bounded health checks. Runs the e2e suite against the containers and scans logs and the artifact volume for secrets, then removes only that project's resources.                                                                                     |
| repo-hygiene   | inline                                                | No `.env`, keys, or generated or test artifacts tracked, and no key-shaped strings.                                                                                                                                                                                                                                                                                             |

## The e2e suite (`e2e/tests`)

1. `01-auth`: unauthenticated redirects and 401s, no registration, generic login error,
   cross-origin login rejection, cookie flags, CSRF, server-side logout.
2. `02-demo`: the full vertical slice through the UI. Create the demo target with a synthetic
   credential → preflight → fake plan → **real worker execution** → valid journeys pass → the
   deliberate edit-persistence defect, the uncaught TypeError and the 500, and the axe `label`
   violation are all detected → every observed finding links to retrievable evidence →
   recommendations are never labelled observed → HTML, Markdown and schema-valid JSON exports →
   fix packet → per-scenario rerun → comparison (persistent / not retested, never falsely
   resolved) → history retained.
3. `03-safety`: script and unknown actions rejected, non-allowlisted and metadata navigation
   blocked (including via the injected help-page link), prompt-injection text does not change
   policy, a prohibited deletion is never executed, budget exhaustion produces a partial run,
   and emergency stop cancels the run.
4. `04-browsers`: the worker runs mobile-viewport Chromium (core smoke passes, the responsive
   navigation defect is detected) and Firefox and WebKit smoke scenarios.
5. `05-ui-accessibility`: axe-core on TestApp's own pages, keyboard focus, skip link, and the
   mobile layout.

Suites `03` to `05` reuse the target created in `02`, so run the suite in order (`workers: 1`).

## CI

`.github/workflows/ci.yml` runs format, lint, typecheck, unit, integration (PostgreSQL service)
and build on Node from `.nvmrc`, plus an e2e job in the Playwright container. It needs no
repository secrets.

## Running pieces locally

```bash
scripts/in-docker.sh pnpm test:unit
```

```bash
scripts/with-test-postgres.sh pnpm test:integration
```

```bash
SKIP_BUILD=1 E2E_GREP="safety" scripts/e2e-local.sh
```
