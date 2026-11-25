# Onboarding a staging target

## Before you start (target owner checklist)

- [ ] You are authorised in writing to test this environment.
- [ ] It is a staging or test environment, not production, and holds only synthetic data.
- [ ] Payments, email, SMS, push, webhooks and other external integrations are disabled or
      mocked.
- [ ] You have a dedicated synthetic account with the minimum role needed. It is not a real
      person's account and does not reuse a password from anywhere else.
- [ ] You know which routes and controls must never be touched (admin, billing, destructive
      bulk actions).

## Create the target

1. **New target.** Enter the project name, target name and base staging URL.
2. **Brief.** Describe the purpose, roles and permissions, key journeys, business rules
   (validation, limits, states) and anything out of scope. TestApp does not invent rules the
   brief does not state, so areas the brief leaves unspecified are reported as unsupported.
3. **Authorisation and environment.** Tick both confirmations.
4. **Allowlisted origins.** List every origin the browser may navigate to, one per line, as
   scheme://host:port. The base URL's origin must be included. Origins on localhost or a private
   network also need the private-network opt-in.
5. **Disposable writes.** Enable this only if scenarios may create or edit run-prefixed records.
   Deleting pre-existing data is never allowed.
6. **Prohibited actions, forbidden selectors and routes.** Add anything specific to this target,
   for example `/admin`, `/billing` or `#danger-zone button`.
7. **Authentication.** Choose _Form login_, then enter:
   - The login URL.
   - A success condition: the URL contains a string, and/or a visible text appears.
   - The synthetic username and password. They are encrypted and never shown again.
   - Optional explicit locators. Automatic detection uses labels such as email or username, the
     `type=password` field, and a sign-in or log-in button.
   - The post-login starting path.

## Preflight

Press **Run preflight**. If any check fails, fix the configuration before you plan. Typical
fixes:

| Failure                                   | Fix                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| Origin not allowlisted / redirect blocked | Add the redirect destination's origin if it is legitimate (for example an auth subdomain). |
| Private network destination               | Enable the private-network opt-in, or use a public staging hostname.                       |
| Could not find username/password field    | Configure explicit locators (label, placeholder, test ID or CSS).                          |
| Login could not be verified               | Correct the success URL fragment or text, and check the credential manually.               |
| Starting page redirected to login         | The start path needs a different role, or the session cookie is not being kept.            |

Discovery visits same-origin links with GET only. It skips links that look like logout, delete,
purchase or messaging, and stops at the configured page and depth limits.

## Plan, review, run

1. **Generate plan.** Review the personas, coverage matrix, unsupported areas and scenarios.
   Disable anything you do not want to run. Edit steps in the validated JSON editor; edits bump
   the scenario version.
2. **Start run.** Choose a browser profile and conservative budgets. The run page updates live,
   and **Emergency stop** halts it before the next action.
3. **Triage.** For `blocked` or `inconclusive` scenarios, first check locators and timing.
   Blocked automation is not necessarily a target bug.
4. **Hand off.** Copy the fix packet into the coding assistant that owns the target's source.
   Rerun scenarios after fixes, and use **Compare** to see which findings are new, persistent,
   regressed, resolved or not retested.

## Using Anthropic

Set `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, and an `ANTHROPIC_MODEL` that your account
supports. Pricing variables are optional and only feed cost estimates. Planning input contains
the brief, sanitised discovery data, and target configuration without secrets.
