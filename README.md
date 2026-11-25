# TestApp

TestApp is a private, single-user QA and product-evaluation workbench for staging web
applications, with AI assistance. It tests a target as a black box. You give it a written
brief, a staging URL, an optional synthetic login, explicit permissions and hard run budgets.
TestApp then:

1. **Preflights** the target. It checks the allowlist, reachability, the HTML response,
   redirects, login, the start page, the browser and storage, then runs a bounded discovery pass.
2. **Plans** the testing: personas, journeys, a coverage matrix and prioritised scenarios. The
   plan comes from an LLM provider (Anthropic, or a deterministic offline fake) and is validated
   against strict schemas.
3. **Executes** the scenarios in a real Playwright browser: desktop or mobile Chromium, Firefox
   or WebKit. Every request passes an origin policy, and every action passes an action-safety
   policy and hard budgets.
4. **Captures evidence**: assertion results, console errors, page errors, failed requests,
   screenshots (password fields masked), Playwright traces kept only for failures, and axe-core
   results.
5. **Reports** observed bugs, UI/UX findings, agentic opportunities, standards-informed
   observations, coverage and limitations. Exports are interactive HTML, printable HTML,
   Markdown and schema-valid JSON.
6. **Produces a fix packet**: Markdown you can paste straight into the coding assistant that
   owns the target's source.
7. **Keeps history**: it supports full and per-scenario reruns and compares runs for regressions.

**Product rule:** a brief or an LLM can only suggest a _risk_. Only an executed observation can
be labelled an observed finding: a failed assertion, a runtime error, or an automated check
result. Recommendations from the LLM are always labelled heuristic, inferred or enhancement,
and the code enforces this rule.

TestApp never modifies the target's source code and never applies fixes itself.

## Architecture (overview)

```
apps/web          Next.js App Router UI + JSON APIs (auth, intake, plans, runs, reports, artifacts)
apps/worker       Node worker: polls PostgreSQL jobs (leases/heartbeats), Playwright runner, providers
apps/demo-target  "TaskPad": a small, deliberately buggy synthetic app for the demo
packages/core     Shared Zod contracts, safety policies, budgets, findings, reports, regression logic
packages/db       Drizzle schema + migrations, auth/session, targets, plans, runs, jobs services
e2e/              Playwright Test product end-to-end suite
```

PostgreSQL holds all application state. Artifacts live in private filesystem storage outside
the web public directory, and the web app serves them only through authenticated routes. Long
work never runs inside request handlers. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quickstart (Docker Compose)

Requirements: Docker with Compose v2. Nothing else needs to be installed on the host.

1. **Configure secrets.**

   ```bash
   cp .env.example .env
   ```

   Edit `.env`: set `POSTGRES_PASSWORD`, `SESSION_SECRET` (`openssl rand -base64 48`),
   `APP_ENCRYPTION_KEY` (`openssl rand -base64 32`) and `BOOTSTRAP_ADMIN_EMAIL` /
   `BOOTSTRAP_ADMIN_PASSWORD` (12+ characters).

2. **Start PostgreSQL, web and worker.** The one-shot `migrate` service applies migrations and
   bootstraps the single user (it is idempotent) before web and worker start.

   ```bash
   docker compose up -d --build
   ```

3. **Migrations and the bootstrap user** run automatically as step 2 describes. To run them by
   hand:

   ```bash
   docker compose run --rm migrate
   ```

4. **Optional: start the demo target.** Set `DEMO_MODE=true` and `DEMO_TARGET_HOSTNAMES=demo-target`
   in `.env`, then:

   ```bash
   docker compose --profile demo up -d --build
   ```

5. **Run the complete fake-provider demo.** Open http://127.0.0.1:3000 and sign in. Then:
   **New target** → base URL `http://demo-target:4000/`, allowlisted origin
   `http://demo-target:4000`, form login at `http://demo-target:4000/login`, success when the
   URL contains `/tasks`, start path `/tasks`, and the synthetic demo credentials from `.env`.
   Paste the brief from [docs/DEMO_TARGET.md](docs/DEMO_TARGET.md#brief) → **Run preflight** →
   **Generate plan** → **Start run**. The run page shows results, evidence, exports and the fix
   packet. The UI labels everything produced by the fake provider.

6. **Switch to Anthropic.** Set `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, and an
   `ANTHROPIC_MODEL` that your Anthropic account supports. TestApp does not hardcode a model.
   You can also set `ANTHROPIC_INPUT_PRICE_PER_MTOK` / `ANTHROPIC_OUTPUT_PRICE_PER_MTOK` to get
   cost _estimates_. Then restart: `docker compose up -d`. The provider never silently falls back
   to fake output.

7. **Onboard a real staging target safely.** Read [docs/TARGET_ONBOARDING.md](docs/TARGET_ONBOARDING.md).
   Use only authorised staging environments, synthetic accounts and synthetic data, and have the
   target owner disable or mock external integrations.

Compose binds the web port to `127.0.0.1` by default. For remote access, put it behind an
authenticated HTTPS reverse proxy and set `COOKIE_SECURE=true` and `APP_BASE_URL`. See
[docs/SECURITY_AND_SAFETY.md](docs/SECURITY_AND_SAFETY.md#deployment-behind-a-reverse-proxy).

## Local development

No host Node install is required. The pinned toolchain (Node 26.13.1, pnpm 12.23.0) runs in
Docker:

```bash
scripts/in-docker.sh pnpm install
```

```bash
scripts/in-docker.sh pnpm lint
```

```bash
scripts/with-test-postgres.sh pnpm test:integration
```

```bash
scripts/e2e-local.sh
```

The last command starts a disposable stack and runs the Playwright suite. If you have Node
26.13.1 and pnpm 12.23.0 locally, the same `pnpm` scripts work directly.

Full verification, with every component reported as PASSED, FAILED or NOT RUN:

```bash
scripts/verify.sh
```

See [docs/TESTING.md](docs/TESTING.md).

## Important caveats

- Use TestApp only on staging targets you are authorised to test, with synthetic accounts and
  data.
- External integrations (payments, email, messaging, webhooks) must be disabled or mocked in
  staging. TestApp's keyword guards are a supplement, not a substitute.
- TestApp cannot infer every business rule. It tests what the brief states and leaves the rest
  untested, and says so.
- Blocked or inconclusive automation is not necessarily a target bug.
- Automated accessibility results (axe-core) do not prove WCAG conformance or non-conformance.
- Passive header and transport observations are not penetration testing.
- Browser artifacts (screenshots, traces) may contain target page content. Treat them as
  sensitive.
- Generic semantic browser automation can be brittle. Review blocked steps and refine locators.
- Anthropic cost figures are estimates based on the pricing you configure and the usage the
  provider reports.

More: [docs/LIMITATIONS.md](docs/LIMITATIONS.md) · [docs/DECISIONS.md](docs/DECISIONS.md) ·
[BUILD_STATUS.md](BUILD_STATUS.md) · [BUILD_REPORT.md](BUILD_REPORT.md)
