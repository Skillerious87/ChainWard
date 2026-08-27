# Performance, security, and payout-ledger audit

Last reviewed: 13 August 2026

## Scope

This pass covered the Next.js 16.3 application shell, protected route loading,
chain-report rendering, Server Actions, mutation route handlers, proxy trust,
CSV export, dependency advisories, shared layout queries, payout persistence,
and the payout-ledger interaction and visual model.

## Security findings remediated

| Severity | Finding | Resolution |
| --- | --- | --- |
| High | Member names, tier labels, or other external text beginning with a spreadsheet operator could be exported as an executable CSV formula. | String cells beginning with `=`, `+`, `-`, or `@` (including leading whitespace) are neutralised. Genuine numeric values stay numeric. Regression tests cover formula-like payloads. |
| Medium | Mutation origin checks accepted `x-forwarded-host` and `x-forwarded-proto` without proving that a trusted proxy set them. A direct caller could expand the accepted origin set. | Forwarded headers no longer define an accepted origin. Direct requests compare `Origin` with the browser-controlled `Host`; hosted proxy origins must be declared in `CHAINWARD_ALLOWED_ORIGINS`. |
| Medium | Per-address connection throttling trusted caller-supplied proxy IP headers. | Proxy IP headers are ignored by default. `CHAINWARD_TRUST_PROXY_HEADERS=true` is required and is documented as safe only when direct origin access is blocked and the proxy overwrites those headers. The process-wide limiter remains in force. |
| Low | Server Actions retained the framework's broad 1 MB default even though current action inputs are small structured records. | The raw Server Action body limit is now 256 KB. Explicit public proxy origins are also passed to Next's own Server Action CSRF allowlist. |
| Low | Two useful isolation/legacy-plugin headers were absent. | `Cross-Origin-Resource-Policy: same-origin` and `X-Permitted-Cross-Domain-Policies: none` are sent globally. |

`npm audit` reports zero known vulnerabilities across 634 production,
development, optional, and transitive dependencies.

## Performance findings remediated

### Shared layout over-read

Every navigation loaded the complete faction access workspace, including the
assignment directory and twenty audit records, only to find the current actor's
single role. The shell and Members page now use a narrow indexed assignment
lookup. The full registry remains exclusive to views and actions that need it.

Database status, licence summary, access workspace, assignment, and member
activity reads are request-memoized. When a layout and page need the same data,
one render now performs one read.

### Repeated payout snapshot JSON

The PostgreSQL ledger included `snapshot.calculation` through every member
payout row. A calculation already contains every member, so a 100-member chain
could return the same large JSON document 100 times. The ledger now selects
only row fields first, fetches each distinct snapshot calculation once, and
joins tier labels in memory.

### Large client registers

The old ledger rendered every matching row and ran search directly from each
keystroke. The new register uses deferred search, memoized analysis/filtering,
and 25-row pagination. Analysis still covers the complete loaded ledger; only
the DOM is paginated.

## Loading system

- Every protected route has a lightweight `loading.tsx` boundary. Its shaped
  fallback appears immediately whenever server rendering actually suspends.
- Every same-origin workspace link shows the crisp Chainward loading ring
  immediately, including prefetched links for which Next.js intentionally skips
  `useLinkStatus`. A minimum visible interval makes the feedback perceptible on
  fast transitions; the new view becomes interactive as soon as it resolves.
- Settings sections and reward-editor views publish the same feedback for
  client-only view changes. Chain reports retain a dedicated fallback describing
  contribution and reward-snapshot validation.
- Connection validation, workspace sync, live-chain sync, database creation,
  backup preparation, PostgreSQL tests, licence operations, reward saves, bulk
  access changes, workspace entry, and all asynchronous dialog confirmations use
  the same loading mark with action-specific copy.
- Reduced-motion preferences disable ring and skeleton motion.

## Payout-ledger analysis model

The redesigned view provides four levels of review:

1. **Executive posture:** settlement rate, unresolved record count,
   outstanding liability, member coverage, and latest acknowledgement.
2. **Control intelligence:** status distribution plus explicit warnings for
   held payments, approved-but-unpaid records, missing recorder attribution,
   and missing saved tier labels.
3. **Chain queue:** chain-level unresolved-risk rings ordered by held/open risk,
   with outstanding liability and the next operational state. A fully settled
   chain is explicitly 0% risk rather than the inverse 100% completion figure.
4. **Auditable register:** status tabs, full-text search, reward-unit filtering,
   useful sort modes, pagination, exact reward decision, creation/processing
   timeline, and recorder identity.

Reward units are never combined. For example, `5 Xanax` and `$5,000,000` remain
two liabilities rather than becoming a meaningless `5,000,005` total.

The view remains intentionally conservative about provenance:

- `PAID` means a deliberate Chainward acknowledgement, not inferred Torn
  activity.
- `WAIVED` counts as resolved but never as paid value.
- A zero-value decision is displayed as `Not eligible`, excluded from paid and
  settlement-rate totals, and retained in the register for reward provenance.
- Local SQLite currently persists paid chain settlements and withdrawal
  corrections; PostgreSQL can expose the full pending/approved/held/paid/waived
  lifecycle. The interface analyses only records actually present in its
  backend and does not invent outstanding transfers.
- Withdrawn acknowledgements remain visible in the corrections panel with the
  recorded reason and operator.

## Verification

- ESLint: passed.
- TypeScript: passed.
- Unit tests: 126 passed across 29 files. The test glob now includes `.tsx`
  component tests; those files previously type-checked but were silently absent
  from Vitest runs.
- Optimized Next.js production build: passed.
- Offline end-to-end harness: 65 passed, 0 failed. This covers protected route
  guards, licence gating, owner/member permissions, payout history and
  corrections, live telemetry, cross-site mutation rejection, body limits, and
  every operational route.
- `git diff --check`: passed.

## Residual deployment considerations

- The in-process limiter is deliberately single-instance. A multi-instance
  deployment still needs a durable proxy or shared-store limiter.
- The pre-paint appearance script requires inline script permission. A hosted
  CSP can remove `unsafe-inline` after adopting per-request nonces.
- Platform-owner authority is still derived from the configured Torn identity.
  Independent operator authentication is advisable before high-value or
  multi-operator use.
- The owner-only PostgreSQL tester accepts self-signed TLS for setup. Production
  application connections should validate certificates.
- Local SQLite is a single-device backend, not a multi-instance production
  database.
