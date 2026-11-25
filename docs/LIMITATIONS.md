# Known limitations (v1)

- **Live Anthropic behaviour has not been exercised.** No paid API calls were made while
  building this. The Anthropic provider is covered by unit tests with a mocked SDK client
  (structured output request shape, validation and repair, refusal and truncation handling,
  budget pre-checks, error mapping). Real-model plan quality, schema adherence, latency and cost
  are unverified. The JSON Schema sent as `output_config.format` drops constraint keywords that
  structured outputs may not support (lengths, patterns), and Zod enforces those afterwards. Some
  accounts or models may still reject a schema of this size; that would surface as a clear
  provider error, never as fake output.
- **The fake provider is fixture-driven.** It returns the TaskPad fixture plan when the brief
  mentions "TaskPad". Otherwise it derives a generic smoke plan (page loads, headings, axe) from
  discovery. Its recommendations are templates.
- **Business rules are not inferred.** Areas the brief does not specify are reported as
  unsupported or untested.
- **Semantic automation is brittle.** Locator ambiguity, timing and custom widgets lead to
  `blocked` or `inconclusive` results. These are not defects. Review them and refine the
  locators.
- **Accessibility.** axe-core checks a subset of WCAG 2.2 at selected states. Results do not
  establish conformance or non-conformance. Manual review is always required.
- **Security observations are passive.** TestApp inspects headers and transport only. It does no
  penetration testing, fuzzing, authentication bypass attempts or exploitation.
- **Network isolation.** DNS is not pinned, so DNS rebinding and private resolution of public
  hostnames are not detected. Run the worker on a network that cannot reach sensitive internal
  services. On WebKit, redirects are re-issued as same-tab GETs after the policy check, and
  method-preserving 307/308 redirects of non-GET requests are blocked.
- **Keyword safety guards are heuristics.** Destructive or external actions labelled in unusual
  language can slip past them. Staging must have its real integrations disabled.
- **Single user, single worker by default.** Scenarios run sequentially. Horizontal scaling and
  multi-tenancy are out of scope.
- **Rate limiting** uses database counters keyed by hashed email and client IP. Behind a proxy it
  relies on a trustworthy `X-Forwarded-For`.
- **Timing data** comes from one synthetic session and is not real-user performance data.
- **Artifact retention** has no automatic expiry in v1. Remove old runs' artifacts manually if
  needed.
- **Interrupted runs are never resumed.** After a worker crash the run is marked partial, and a
  rerun must be started explicitly. This avoids duplicating side effects on the target.
- **One credential per target** is optimised in the UI, although the schema supports labels.
