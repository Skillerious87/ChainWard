# Login and workspace performance release — 22 October 2026

The sign-in page now has a split desktop layout and a focused mobile form.
The document scrolls naturally; the form no longer clips content into an
internal scrollbar. Key-use disclosures expand into readable sections instead
of a horizontally overflowing table. The network-status subscription provides
a stable server snapshot, fixing a hydration mismatch that rebuilt the form.

Workspace performance changes:

- The overview streams its welcome and live chain before secondary reports
  and history finish. Idle visits reuse recent reports; active reports retain
  their forced refresh and upstream-cache bypass.
- License, assignment and roster checks start together. No protected content
  renders before the required checks succeed. Locked users can redirect
  without waiting for an unrelated roster request.
- Concurrent shared Torn reads reuse their pending promise. Request-scoped
  access checks share their result during server rendering. Telemetry and
  member-monitor route handlers use an isolated asynchronous scope to share
  one decrypted connection and identity check within each request. Tests cover
  isolation between concurrent players and fresh checks on later requests.
- Successful shared refreshes use only the claim and commit transactions,
  removing an unnecessary third transaction after the lease was already
  released. Failed refreshes retain their cooldown and ownership checks.
- PostgreSQL coordination retries transient connection, pool and transaction
  failures. Permanent database errors and application refusals fail immediately
  without unnecessary backoff. The PostgreSQL concurrency check initially
  reproduced connection failures and passed after the recovery changes.
- The shell and monitoring endpoint read current activity records and policy
  without fetching historical periods and audit events. History synchronization
  uses Next.js `after` so durable writes continue after the response without
  blocking the page. The personnel pages still synchronize before presenting
  history. An unavailable activity store returns 503 rather than publishing
  alerts calculated with a default policy.
- The countdown retains its 250 ms clock checks but only updates React state
  when displayed seconds change. Pending presence and member-monitor requests
  time out after 15 seconds and are cancelled when their effects stop.
- Client telemetry validation rejects malformed faction, chain, timestamp and
  age data before it reaches rendering and countdown controls.

Release validation uses `npm run check:full` (lint, TypeScript, all tests,
production build and 100 offline acceptance assertions) and
`npm run verify:pool:postgres` (isolated PostgreSQL coordination records, with
no Torn API requests). Browser checks cover eight viewport sizes from 320 to
1920 pixels, privacy expansion, password visibility, session preference,
key help, error recovery, offline/online transitions and reduced motion.

The earlier local navigation measurements used warmed development routes and
offline fixture data. They are not live Torn or production latency benchmarks.
