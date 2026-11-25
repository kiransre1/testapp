# BUILD_REPORT

**Overall status: COMPLETE.** Every mandatory v1 requirement is implemented. Every mandatory
verification ran and passed against `VERIFIED_CODE_SHA`. Later commits are documentation/status
only, and the branch was pushed with its remote SHA confirmed.

- **VERIFIED_CODE_SHA:** `2baa73246a85e11d36a99d91d371d5abee68f83e` (`2baa732`)
- **Verified twice, independently:**
  - `scripts/verify.sh` from a clean `git worktree` checkout of `2baa732`: all components
    PASSED.
  - GitHub Actions run 45658019786 on `2baa732`: both the `checks` and `e2e` jobs passed.
- **LAST_LOCAL_GREEN_SHA / LAST_REMOTE_GREEN_SHA:** `2baa732`, confirmed with `git ls-remote`.
  The documentation-only commit that records this report follows it.
- **Delivery:** the initial pushes failed because there was no credential. After the operator
  ran `gh auth login` and `gh auth setup-git` was configured, the branch was pushed and every
  push was confirmed with `git ls-remote`.
- **Correction:** an earlier version of this report named `50ea12b` as verified. That local run
  passed only because `apps/web/app/api/artifacts/[id]/route.ts` existed in the working tree
  while an unanchored `artifacts/` ignore rule kept it out of git. GitHub CI's clean checkout
  exposed the problem. It was fixed in `b0bd302`, the hygiene check now fails on ignored source
  files, and final verification runs from a clean checkout.
- **Live Anthropic behaviour was not exercised.** No paid API calls were made. Real-model plan
  and recommendation quality is unverified.

## Implemented functionality

- **Single-user auth.** Argon2id; idempotent bootstrap CLI with a lock to keep it single-user;
  opaque hashed sessions with HttpOnly and SameSite cookies (Secure behind HTTPS); per-session
  CSRF tokens plus same-origin checks; login rate limiting; no registration.
- **Target intake.** Project and target, base URL, brief (versioned), authorisation and staging
  confirmations, origin allowlist (private networks need opt-in; the demo hostname is allowed
  only in demo mode), disposable-write toggle, prohibited-action summary, forbidden
  selectors/routes, build label, seed/reset notes (documentation only), form login with
  automatic or explicit locators and a URL/text success condition, and synthetic credentials
  encrypted with AES-256-GCM through a write-only API.
- **Preflight.** URL/allowlist, budgets, artifact storage, browser launch, reachability,
  plausible HTML, redirect safety, login verification, post-login start page, and bounded
  same-origin GET-only discovery. Discovered content is treated as untrusted.
- **Providers.** A provider interface with a deterministic, offline FakeProvider (fixture- and
  discovery-driven) and an AnthropicProvider (official SDK 1.14.0, `output_config.format`
  structured output, Zod re-validation, one bounded repair, token-budget pre-checks, typed error
  mapping, configurable model, no silent fallback).
- **Planning.** Personas, journeys, coverage matrix, unsupported areas and prioritised scenarios
  under strict schemas, with allowlisted actions, semantic locators, secret references, a
  prohibited-action class and maxActions. The UI supports inspection, enable/disable and
  validated JSON editing, which bumps the scenario version.
- **Worker.** Transactional claiming with `FOR UPDATE SKIP LOCKED`, leases and heartbeats;
  stale-lease recovery (interrupted runs become partial and are never re-executed);
  cancellation checked before every action; sequential scenarios in isolated contexts;
  run-prefixed synthetic data; untraced login with in-memory storage state; secrets injected
  only at fill time.
- **Safety in the browser.** Every request is policy-checked. Each redirect hop is checked,
  including a WebKit-safe path. Metadata and link-local destinations are always blocked. Odd
  schemes, embedded credentials and forbidden routes are blocked. Purchase, deletion and
  external-message semantics are blocked statically, per step and against the live element.
  Write actions need disposable-write permission.
- **Budgets.** Elapsed time, scenarios, actions per scenario, total actions, input and output
  tokens, estimated cost (only when pricing is configured), loop detection, and consecutive
  blocked actions. A run that exhausts a budget becomes partial and states which budget was
  reached.
- **Evidence.** Step results with expected/actual values; console and page errors; failed and
  error responses with sanitised metadata; screenshots with passwords masked; Playwright traces
  kept for non-passing scenarios; axe-core results; browser, viewport and build metadata. No HAR
  files.
- **Findings.** Observed categories are derived deterministically from evidence, and the schema
  requires evidence for them. Conservative fingerprint deduplication. The LLM is limited to
  heuristic observations, inferred risks and enhancement opportunities.
- **Reports.** A schema-valid JSON report rendered as an interactive in-app page, printable
  HTML, Markdown and a fix packet. The eight required sections, with the fake provider clearly
  indicated.
- **History.** Full and per-scenario reruns, and a comparison view (new, persistent, regressed,
  resolved, not_retested) in which a finding is resolved only after a successful rerun with the
  same scenario definition.
- **UI.** Dashboard, target creation and settings, briefs, credentials, preflight diagnostics,
  plans (personas, coverage, scenarios), run configuration and budgets, start and emergency
  stop, live polling, run detail with filters, artifacts, report, exports, fix packet with
  copy/download, run list and comparison. Semantic HTML, a skip link, visible focus, and 24px
  targets.
- **Demo target.** TaskPad with five documented deliberate defects
  ([docs/DEMO_TARGET.md](docs/DEMO_TARGET.md)), a sample brief and a FakeProvider fixture plan.
- **Ops.** Production Dockerfiles (web on Next standalone; worker on the Playwright 1.65.1 image
  with matching npm version), Compose with health checks, a one-shot migrate/bootstrap service,
  loopback binding, persistent volumes and an optional demo profile. `.env.example`, CI
  workflows and documentation.

## Architecture summary

A TypeScript pnpm monorepo: `apps/web` (Next.js 16 App Router), `apps/worker` (Node +
Playwright), `apps/demo-target`, `packages/core` (contracts, policies, budgets, findings,
reports), `packages/db` (Drizzle + PostgreSQL 18). Node 26.13.1 LTS is pinned everywhere. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Verification executed against VERIFIED_CODE_SHA (2baa732)

Command: `scripts/verify.sh`, run 2026-11-25 16:49–16:53 UTC in a separate clean `git worktree`
checked out at `2baa732`. The overall
timeout was 90 minutes, and each component had its own finite timeout.

| Component      | Exact command                                                                                                                                                                                                                     | Timeout | Result                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------- |
| install        | `scripts/in-docker.sh pnpm install --frozen-lockfile`                                                                                                                                                                             | 900s    | PASSED                                                         |
| format         | `scripts/in-docker.sh pnpm format:check`                                                                                                                                                                                          | 300s    | PASSED                                                         |
| lint           | `scripts/in-docker.sh pnpm lint`                                                                                                                                                                                                  | 300s    | PASSED                                                         |
| typecheck      | `scripts/in-docker.sh pnpm typecheck` (all workspaces + e2e)                                                                                                                                                                      | 600s    | PASSED                                                         |
| unit           | `scripts/in-docker.sh pnpm test:unit`                                                                                                                                                                                             | 600s    | PASSED: 68 tests, 9 files                                      |
| integration    | `scripts/with-test-postgres.sh pnpm test:integration` (disposable PostgreSQL 18; migrations from an empty DB)                                                                                                                     | 900s    | PASSED: 19 tests, 5 files                                      |
| build          | `scripts/in-docker.sh pnpm build` (Next production build, worker and demo bundles)                                                                                                                                                | 900s    | PASSED                                                         |
| e2e            | `SKIP_BUILD=1 scripts/e2e-local.sh` (disposable network + PostgreSQL + Playwright 1.65.1 image)                                                                                                                                   | 1800s   | PASSED: 24 tests; secret scan clean (logs + 90 artifact files) |
| compose-config | `docker compose --env-file .env.example -f docker-compose.yml --profile demo config -q`                                                                                                                                           | 60s     | PASSED                                                         |
| compose-stack  | `scripts/verify-compose.sh`: builds production images, isolated project `testapp-verify-<ts>`, `up --wait` (health-checked), the same 24 e2e tests against the containers, secret scan of logs and the artifact volume, `down -v` | 3000s   | PASSED: 24 tests; secret scan clean                            |
| repo-hygiene   | inline `git ls-files` / `git grep` checks, including ignored source files                                                                                                                                                         | —       | PASSED                                                         |

No mandatory check was skipped, NOT RUN or failed in the final verification.

GitHub Actions run 45658019786 on `2baa732` also passed. The `checks` job ran format, lint,
typecheck, unit, integration and build on GitHub's runner. The `e2e` job ran all 24 Playwright
tests in the Playwright container with a PostgreSQL service.

### Significant failures and retries during the build (all resolved by VERIFIED_CODE_SHA)

- `git push` initially failed with an authentication error and was not retried. It succeeded
  after the operator signed in with the GitHub CLI.
- pnpm 12's minimum-release-age policy rejected packages published less than a day earlier. The
  policy was kept and older versions were selected.
- The first e2e run found a cross-host absolute redirect in the export route (fixed with a
  relative `Location`) and a WebKit `route.fulfill` 3xx limitation. That rejection crashed the
  worker; the route handler now never throws, and WebKit uses a policy-checked same-tab GET.
- GitHub CI (first runs) found two problems. The artifact route had never been committed
  because an ignore rule hid it (fixed in `b0bd302`). Firefox would not launch in the
  GitHub container because it refuses to run as root with a foreign `$HOME`; the fix is
  Playwright's documented `HOME=/root`, in `2baa732`.
- Compose verification found that artifacts were unreadable across containers (different uids),
  a WCAG 2.2 target-size violation in TestApp's own UI, and Chromium Local Network Access
  blocking the target's own same-origin fetch behind the policy proxy. That last one was a false
  runtime symptom, fixed by disabling LNA enforcement in the worker's Chromium.

## Browser coverage achieved

The worker ran its browsers against the demo target inside the Playwright 1.65.1 image (Linux
arm64), both locally and in Compose:

- **Desktop Chromium:** the full demo plan (10 scenarios), safety runs, budget and cancellation
  runs, reruns.
- **Mobile-viewport Chromium (390×844):** core smoke (SC-001, SC-002, SC-010 passed) plus
  detection of the responsive navigation defect (SC-009 failed).
- **Firefox:** smoke (SC-001, SC-009, SC-010) passed.
- **WebKit:** smoke (SC-001, SC-009, SC-010) passed.
- **TestApp UI e2e** driven in desktop Chromium, plus a mobile-viewport layout check.

## Docker verification achieved

The web, worker and demo-target production images built. A disposable Compose project ran
PostgreSQL, migrate/bootstrap, web, worker and demo-target with health checks, and the e2e suite
passed against it. Teardown removed only that project's containers, network and volumes. No VPS
deployment was performed, by design.

## End-to-end demo result (desktop Chromium, fake provider)

The e2e suite asserts these results:

- **Passed:** SC-001 task list, SC-002 create, SC-003 persistence after reload, SC-004
  required-title validation, SC-010 signed-out redirect. SC-009 desktop navigation passed on
  Firefox and WebKit.
- **Failed, as expected for the deliberate defects:** SC-005 edit persistence, SC-006 reports
  statistics/runtime, and the SC-007 axe violation. SC-009 failed on mobile Chromium.

The e2e suite does not assert SC-008 (help page) or SC-009 on desktop Chromium.

### Deliberate defects detected

1. Edit not persisted → `observed_failure` (SC-005), with screenshots and trace.
2. Reports page → `observed_runtime_symptom` for the uncaught `TypeError` and for the HTTP 500
   from `GET /api/stats`, plus an `observed_failure` for the missing statistics (SC-006).
3. Unlabelled filter input → `automated_standard_result`, axe `label` rule with WCAG 2.2 SC
   1.3.1/4.1.2 references.
4. Responsive navigation → `observed_failure` for SC-009 on mobile Chromium only.
5. Prompt-injection help text → treated as data. Following its link was blocked by the origin
   policy and the target's policy was unchanged.

## Known limitations

See [docs/LIMITATIONS.md](docs/LIMITATIONS.md). In summary:

- Live Anthropic behaviour is unverified.
- DNS rebinding and private resolution of public hostnames are not detected.
- Keyword safety guards are heuristics.
- axe results do not certify WCAG.
- Security observations are passive only.
- Semantic locators can be brittle.
- Artifacts have no automatic retention policy.
- On WebKit, 307/308 redirects of non-GET requests are blocked.

## Remaining issues and incomplete requirements

- The `planning` run state exists for future plan-and-run flows; the current UI plans and runs
  as separate steps.

## Commands

Start the application (after `cp .env.example .env` and filling in the secrets):

```bash
docker compose up -d --build
```

Start it with the demo target (requires `DEMO_MODE=true` and `DEMO_TARGET_HOSTNAMES=demo-target`
in `.env`):

```bash
docker compose --profile demo up -d --build
```

Then open http://127.0.0.1:3000 and follow the demo steps in README.md.

Full verification:

```bash
scripts/verify.sh
```

## External setup still required

- For real-model use: `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, an `ANTHROPIC_MODEL`
  supported by your account, and optional pricing variables for cost estimates.
- For remote access: an authenticated HTTPS reverse proxy with `COOKIE_SECURE=true` and
  `APP_BASE_URL`.
