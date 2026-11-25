# Security and safety

TestApp drives a real browser against third-party applications, so its controls are layered
rather than relying on LLM instructions. Every control below is deterministic code with tests.

## Authorised, synthetic-only use

- Creating a target requires an explicit authorisation confirmation and a staging designation.
  Both are recorded with a timestamp.
- Use only synthetic accounts and data. Browser artifacts (screenshots, traces, axe HTML
  snippets) may contain target page content, so treat stored artifacts as sensitive.
- Seed/reset instructions in a brief are documentation only. TestApp never executes shell
  commands, SQL or reset instructions from a brief.

## Single-user authentication

- There is no public registration. The single user is bootstrapped from
  `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD` by an idempotent CLI. A table lock prevents
  a second user from being created in a race.
- Passwords are hashed with Argon2id (19 MiB, t=2, p=1) and must be at least 12 characters at
  bootstrap.
- Sessions are opaque random tokens. Only the SHA-256 of a token is stored. Sessions expire
  after 7 days and logout deletes them server-side.
- The session cookie is `HttpOnly` and `SameSite=Lax`, and gets `Secure` when `COOKIE_SECURE=true`.
- Every mutating API requires a per-session CSRF token (`x-csrf-token`) **and** a same-origin
  `Origin`/`Referer`. Login itself requires same-origin.
- Login is rate-limited: 5 failures per account and 20 per client key within 15 minutes, keyed
  by hashed identifiers. Unknown accounts take the same Argon2 verification time as known ones.
- Passwords, session tokens and cookies are never logged.

## Target credentials

- Credentials are encrypted with AES-256-GCM using `APP_ENCRYPTION_KEY`, which is separate from
  `SESSION_SECRET`. Associated data binds each ciphertext to its target and field.
- Credential APIs are write-only. Target APIs return `hasCredential` and nothing else.
- Plans reference secrets as `{"secretRef":"username"|"password"}`. The worker decrypts the
  values in memory and injects them only inside the `fill` action. Values never enter prompts,
  plan JSON, step results, findings, reports or logs. Redaction is applied to all persisted text
  as a second layer.
- Login happens in a separate browser context that is never traced or screenshotted. Scenario
  contexts receive only the resulting storage state, which stays in memory and is never written
  to disk. Scenarios that type secrets themselves are not traced. Screenshots mask
  `input[type=password]`.
- Network evidence keeps only the method, the origin+path (no query string or fragment), the
  status and the failure text. Headers, cookies and bodies are never stored, and full HAR files
  are not captured.
- Verification scans logs and every stored artifact for the ephemeral test secrets
  (`scripts/e2e-inner.sh`, `scripts/verify-compose.sh`).

## Origin and navigation policy (`packages/core/src/policy/origin.ts`)

- Only `http:` and `https:` are allowed. `file:`, `chrome:`, `data:`, `javascript:` and every
  other scheme are blocked for navigation.
- URLs with embedded credentials are rejected.
- Top-level navigations must stay within the **explicitly allowlisted origins**: exact scheme,
  host and port.
- Cloud metadata and link-local destinations are **always** blocked, even if allowlisted. This
  covers 169.254/16, fe80::/10, `metadata.google.internal`, 100.100.100.200 and IPv4-mapped
  forms.
- Loopback, private and internal hostnames need explicit `allowPrivateNetwork`. The Docker demo
  hostname is allowed only when `DEMO_MODE=true`.
- In the browser, every request goes through a route handler. Top-level navigations are fetched
  without following redirects, so the handler checks **each redirect hop** before the browser
  follows it. Disallowed hops are aborted and recorded. WebKit cannot fulfil 3xx responses, so
  for WebKit the handler checks the hop and then hands the browser a same-tab GET to the
  location, which prevents double form submission. 307/308 redirects of non-GET requests are
  blocked on WebKit.
- Subresources may be cross-origin (for CDNs), but odd schemes and metadata/link-local hosts are
  blocked. Frames follow navigation rules. Downloads and service workers are disabled.
- Forbidden routes (path prefixes) configured per target are blocked.

**Residual risk (documented, not solved in v1).** DNS is not pinned. A public hostname that
resolves, or later re-resolves (DNS rebinding), to a private address is not detected. Browser
features outside request routing (WebRTC, some prefetching) are not individually policed.
TestApp is not a hostile-target sandbox, so run the worker on a network segment that cannot
reach sensitive internal services.

## Action policy (`packages/core/src/policy/actions.ts`)

- The plan schema allowlists actions: navigate, click, fill, select, check, press (allowlisted
  keys), waitFor, reload, assertVisible/Text/Url/Count, runAccessibilityCheck and screenshot.
  Objects are strict, so unknown keys and unknown actions are rejected. CSS locators cannot use
  `javascript:` or Playwright engine prefixes. **No action executes arbitrary JavaScript.**
- Purchase/payment, deletion and external-message semantics (buy, checkout, delete, remove,
  send, email, invite, share, publish…) are blocked at three points: when the plan is validated,
  before each step runs, and against the **live element's** accessible name and text right
  before the interaction.
- Write-like interactions (save, create, add, submit…) need a `disposable_write` scenario on a
  target with disposable writes enabled. Created data uses the run prefix (`{{run}}` → `TA-XXXXXX`).
- A scenario classified with a prohibited action class is never executed.
- Forbidden selectors and routes configured per target are enforced.
- These keyword heuristics are supplementary. Target owners must still disable or mock real
  integrations in staging.

## Prompt injection

- Page content and briefs are untrusted. They reach a provider only inside fenced
  `<untrusted_*>` blocks, with instructions to treat them as data. Closing fences inside the data
  are neutralised.
- Model output cannot change the allowlist, the action policy or budgets. Those values are
  loaded from the database by deterministic code, and every generated plan goes through the same
  schema and policy checks.
- The runner only performs plan steps. Text on a page is never interpreted as instructions.
- The demo target's help page contains a harmless injection attempt. The e2e suite shows that
  following its link is blocked and that the target's policy is unchanged.

## Budgets

Each run has hard limits on elapsed minutes, scenarios, actions per scenario, total browser
actions, input and output tokens, estimated cost (only when pricing is configured), repeated
identical actions (loop detection) and consecutive blocked actions. Time and action limits are
checked deterministically before each action. Token limits use pre-call estimates and the usage
the provider reports. When a budget is exhausted, new work stops, completed evidence is kept,
the remaining scenarios are `skipped`, the run becomes `partial`, the report names the budget
that was reached, and the run is never presented as complete coverage.

## Artifacts

Artifacts are stored under `DATA_DIR/artifacts` with server-generated opaque keys. Key
validation blocks path traversal, and files are created with mode 0600. They are served only by
`/api/artifacts/:id` after authentication, with `Cache-Control: private, no-store`, `nosniff`
and a restrictive CSP (`sandbox`, no scripts).

## Web hardening

The web app sends `X-Frame-Options: DENY`, a CSP with `frame-ancestors 'none'`, `nosniff` and
`Referrer-Policy: same-origin`. API errors never echo internal details.

## Deployment behind a reverse proxy

- Keep `WEB_BIND_ADDRESS=127.0.0.1`. Terminate TLS in a reverse proxy (Caddy, nginx, Traefik) on
  the same host, and preferably add an extra authentication layer (SSO or basic auth) in front.
- Set `APP_BASE_URL=https://your-host` and `COOKIE_SECURE=true`.
- The proxy must forward `Host` and `X-Forwarded-Proto`/`X-Forwarded-Host`, which the
  same-origin check uses. The login rate limiter uses the first `X-Forwarded-For` value, so
  configure the proxy to overwrite that header rather than append a client-supplied one.
- Back up the `pgdata` and `artifacts` volumes, and keep `APP_ENCRYPTION_KEY` safe. Losing it
  makes stored target credentials unrecoverable.
