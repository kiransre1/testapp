# Architecture

TestApp is a TypeScript modular monolith. The web app and the browser worker are separate
processes. All persistent state is in PostgreSQL. Redis, queues and microservices are not used.

```
             ┌──────────────── browser (single user) ────────────────┐
             │  Next.js UI (server components + small client parts)  │
             └───────────────┬───────────────────────────────────────┘
                             │ HTTPS (reverse proxy) / loopback
┌────────────────────────────▼─────────────────────────────┐
│ apps/web  (Next.js App Router)                            │
│  • auth: Argon2id, opaque DB sessions, CSRF + same-origin │
│  • JSON APIs: targets, briefs, credentials, preflight,    │
│    plans, runs, cancel, rerun, exports, artifacts         │
│  • never runs browser work or LLM calls in a request      │
└───────────────┬───────────────────────────┬───────────────┘
                │ SQL (Drizzle)             │ read artifacts (authorised)
┌───────────────▼───────────────┐   ┌───────▼────────────────────┐
│ PostgreSQL                     │   │ private artifact storage   │
│ users, sessions, projects,     │   │ (DATA_DIR/artifacts, a     │
│ targets, credentials (AES-GCM),│   │  Docker volume; never in   │
│ briefs, plans, scenarios, jobs,│   │  the web public dir)       │
│ runs, results, findings, events│   └───────▲────────────────────┘
└───────────────▲───────────────┘           │ write
                │ claim (FOR UPDATE SKIP LOCKED), lease, heartbeat
┌───────────────┴──────────────────────────────────────────────┐
│ apps/worker                                                   │
│  jobs: preflight │ generate_plan │ execute_run                │
│  providers: FakeProvider (offline) │ AnthropicProvider (SDK)  │
│  runner: Playwright (chromium desktop/mobile, firefox, webkit)│
│    policy context (origin/redirect checks) → login (untraced) │
│    → sequential scenarios → evidence → findings → reports     │
└──────────────────────────────┬───────────────────────────────┘
                               │ HTTP(S), allowlisted origins only
                        ┌──────▼──────┐
                        │ staging app │ (e.g. apps/demo-target)
                        └─────────────┘
```

## Packages

| Package            | Responsibility                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core`    | Zod contracts (plan/actions/locators, run config/budgets, findings, report), origin policy, action policy, budget tracker, loop detection, state machines, redaction, AES-GCM helpers, storage interface + local implementation, deterministic finding derivation, report/fix-packet rendering, regression comparison, provider interface and prompts. Pure TypeScript; unit-tested without I/O. |
| `packages/db`      | Drizzle schema, versioned SQL migrations (`packages/db/drizzle`), DB client, migrate/bootstrap CLIs, services for auth, targets/credentials, plans, jobs and runs.                                                                                                                                                                                                                               |
| `apps/web`         | UI and APIs. Workspace packages are consumed as TS source (`transpilePackages`). Output is Next.js standalone.                                                                                                                                                                                                                                                                                   |
| `apps/worker`      | Job loop, providers, Playwright runner, preflight/discovery, report generation. Bundled with esbuild; Playwright, axe, Argon2, postgres and the Anthropic SDK stay external.                                                                                                                                                                                                                     |
| `apps/demo-target` | TaskPad, the synthetic buggy app. Dependency-free Node HTTP server.                                                                                                                                                                                                                                                                                                                              |

## Jobs, leases and recovery

- `jobs` rows have `kind`, `status`, `lease_owner`, `lease_expires_at`, `heartbeat_at`,
  `attempts` and `max_attempts`.
- A worker claims work with a single `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`.
  Two workers can never claim the same job.
- While a job runs, a heartbeat extends the lease every `WORKER_LEASE_SECONDS/3`.
- Every tenth poll the worker reclaims stale leases. `preflight` and `generate_plan` jobs with
  attempts left are re-queued. `execute_run` jobs are **never re-executed**, because repeating
  browser actions could duplicate side effects on the target. The interrupted run is marked
  `partial`: running scenarios become `inconclusive`, pending ones become `skipped`, and a
  report is still generated from the evidence already collected.
- Cancellation sets `runs.cancel_requested`. The runner checks the flag before every browser
  action.

## Run lifecycle

`queued → preflighting → running → analysing → completed | partial | failed | cancelled`.
`planning` is reserved for combined plan-and-run flows. The state machine lives in
`packages/core/src/schemas/run.ts` and is enforced in `setRunStatus`. Terminal states are
immutable.

Scenario states: `pending → running → passed | failed | blocked | skipped | inconclusive`.

- A failed application-level assertion → `failed`. This is a potential target defect.
- A locator that is not found, ambiguous or not visible, or a policy block → `blocked`. This is
  an automation blockage, not a defect.
- A timeout or navigation error → `inconclusive`, at low confidence.
- A budget stop or cancellation → `skipped` for the remaining scenarios, and the run → `partial`
  or `cancelled`.

## Evidence → findings → reports

1. The runner persists step results incrementally, with sanitised URLs and redacted text. It
   writes artifacts (screenshots, axe JSON, event logs, failure traces) to private storage,
   linked to the run, scenario and step.
2. `deriveObservedFindings` (core) turns failed assertions, page/console/network events and axe
   violations into observed findings. Fingerprints are normalised for run prefixes and volatile
   values, and matching fingerprints are deduplicated. A finding schema refinement rejects any
   observed finding that lacks evidence or comes from the LLM.
3. If analysis is enabled, the provider receives a redacted evidence summary. Its output schema
   can only express UX recommendations, agentic opportunities and inferred risks.
4. `buildReport` produces the schema-valid JSON report. Markdown, HTML and the fix packet are
   rendered from that report. The report is stored on the run and as artifacts.
5. `compareRuns` compares runs by scenario key and version and by finding fingerprint. A finding
   counts as `resolved` only if the scenario that produced it was rerun with the same definition
   and passed.

## Providers

`LlmProvider` has two methods, `generatePlan` and `analyseRun`, each with token-budget
pre-checks.

- `FakeProvider` is deterministic and offline. It loads fixture plans whose `match` string
  appears in the brief, and otherwise derives a generic smoke plan from discovery.
- `AnthropicProvider` uses the official SDK with `output_config.format` (a JSON Schema derived
  from the Zod contracts) and streaming `finalMessage()`. It re-validates the result with Zod,
  allows one bounded repair attempt, maps refusals and truncation to errors, and maps SDK errors
  to typed `ProviderError`s. It never falls back to the fake provider, and the model always
  comes from configuration.
