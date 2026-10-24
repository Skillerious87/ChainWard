# Navigation, reliability and dependency review — 24 October 2026

View changes were waiting for avoidable upstream requests, repeating identity
lookups, and competing with refresh loops that survived the page that started
them. Production response headers also identified US function execution
(`iad1`), while the configured PostgreSQL database is in `eu-west-2`.

## Changes

- Live Chain renders its header and timer independently of its contributor
  report. The report streams through its own Suspense boundary. Target
  verification runs independently, once in the client watcher, and withdraws
  an old attack link when the chain or hit count changes.
- Targets renders stored snapshots without waiting for optional Torn battle
  stats and FFScouter estimates. Existing refresh requests populate those
  estimates after the list appears.
- Targets cancels its backlog loop, waiting timers and pending HTTP requests
  when the page unmounts. The live poll permits one pending request and has a
  30-second timeout. Cleanup also works under React Strict Mode.
- Identity proofs are shared within one server render or route-handler request,
  including between the shell and the faction data pool. Separate credentials,
  players, factions and requests remain isolated. Outage-tolerant shell checks
  cannot authorize a strict pool caller. Later requests still read durable
  revocation state.
- Both target endpoints now share their decrypted connection and identity
  checks within an isolated request scope.
- `vercel.json` sets function execution to London (`lhr1`) to keep compute near
  the database. Static assets continue to use Vercel's CDN.
- Zod is updated from 4.4.3 to 4.6.7. Dependency overrides select patched
  uuid 11.1.1, sharp 0.35.5 and tar 7.5.22, also removing obsolete image-tool
  dependencies. The complete npm audit reports zero known vulnerabilities.

## Validation

- `npm run check:full`: ESLint, TypeScript, 588 tests in 99 files, production
  build, and 115 offline HTTP acceptance assertions.
- Acceptance coverage includes public and operational routes, owner/member
  access, licensing, departed and unassigned members, rewards and payouts,
  backup access, telemetry, activity monitoring, both target endpoints,
  cross-site mutations and oversized input.
- `npm run verify:pool:postgres`: real PostgreSQL quota reservations and shared
  refresh leases with isolated disposable records; no Torn API requests.
- Dependency compatibility smoke checks cover native image resizing, Xcode
  UUID generation and the Capacitor asset CLI. An Android APK is outside this
  web release's verification.
- Browser inspection covers the saved live connection's Overview, Live Chain
  and Targets navigation and the responsive navigation menu. Automated React
  tests cover rendering while reports/targets remain unresolved and immediate
  removal of stale target links.
- Production-mode HTTP smoke checks verify login rendering, CSP/HSTS headers,
  protected-page redirects and anonymous API denial. Offline owner sessions
  remain disabled even when the offline environment flag is deliberately set.

Five warmed offline development HTTP samples from the final full check
measured medians of 386 ms for Overview, 202 ms for Live Chain and 196 ms
for Targets. `verify:offline` now reports these measurements on every run.
These are complete fixture HTML response times, not browser interaction
latencies or live Torn/production benchmarks. No before/after improvement
percentage is claimed. Live Torn freshness, quota and availability still
affect the time required for verified data to arrive.

## References

Implementation follows the installed Next.js 16.4.2 guides in
`node_modules/next/dist/docs/`, including navigation, loading boundaries and
request memoization. External primary references:

- [Next.js navigation and streaming](https://nextjs.org/docs/app/getting-started/linking-and-navigating)
- [Vercel function region configuration](https://vercel.com/docs/functions/configuring-functions/region)
- [Zod collection validation advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
- [uuid buffer bounds advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq)
