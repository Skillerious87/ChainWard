# Workspace reliability release — 22 October 2026

React error 418 reports a disagreement between server HTML and the first client
render. The workspace contained several concrete sources of that disagreement:
implicit number locales, implicit date time zones, a watch-schedule clock created
with `Date.now()`, and a saved watch view read during initial rendering. Number
formatting now explicitly uses `en-GB`; rendered dates use UTC, consistent with
Torn time. The watch schedule and licence renewal notices use the persistent
server-anchored clock. A saved timeline view is restored after hydration.

Navigation previously covered the destination with an animation for at least
1,000 ms plus its exit animation, even after the page was ready. It now shows a
slim progress indicator only after 150 ms. Page loading boundaries retain the
incoming view's skeleton only while its server data is pending. The watch
schedule also has a loading boundary. The authenticated layout starts roster and
permission reads alongside avatar refresh, removing a network waterfall.

Panic mode defaults on and is owned by the persistent shell. It appears on any
workspace route during an active chain's final 60 seconds. Its button saves an
opt-out in appearance preferences; the timer control can re-enable it. A new
hit, cooldown, or timer reaching zero removes the warning. The portal is mounted
only after hydration, including when the initial snapshot is already critical.
Reduced motion retains a steady warning border.

Browser telemetry requests time out after 15 seconds so a stalled shared
request cannot trap all later refreshes. Existing values remain while a failed
poll recovers. Exhausted PostgreSQL lookups now raise a recoverable error rather
than impersonating a missing session. A failed legacy credential migration write
also preserves the session. Missing, expired, and owner-mismatched sessions
remain refused. An application error boundary permits retries when the
authenticated layout has not yet mounted.

## Validation

- `npm run check`: ESLint, TypeScript, the full unit/DOM regression suite, and an
  optimized production build.
- `npm run verify:offline`: 100 HTTP acceptance assertions across public,
  operational, licensing, payout, member, and API routes, including watch
  scheduling and authorization rejection cases.
- React DOM hydration tests simulate different browser locales, time zones,
  wall clocks, saved watch views, and an initially critical chain.
- DOM tests cover automatic panic activation, opt-out persistence, hit resets,
  inactive chains, and fast/slow navigation feedback.
- Request and storage tests cover timeout recovery, database outages, failed
  credential migrations, and missing/expired/mismatched sessions.

Interactive browser control was unavailable in this session. DOM hydration and
HTTP acceptance checks do not replace visual testing on physical Android/iOS
devices or testing against a live Torn connection.

## Dependency updates and remaining advisories

Next.js and its ESLint configuration move from 16.3.3 to 16.4.2. Vitest moves
from 4.1.10 to 4.1.12. Compatible transitive dependency fixes are locked as well.
The relevant upstream framework advisories include
[server-action denial of service](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r)
and [image optimization](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw).

After these updates, `npm audit --omit=dev` reports no high or critical
vulnerabilities and four moderate dependency entries involving `uuid`, `gaxios`,
`xcode`, and the Capacitor CLI. The complete development tree still includes
advisories in native asset generation and lint glob dependencies. Automated
suggestions include incompatible framework downgrades; those are not applied.
Native tooling should be upgraded separately with Android/iOS build validation.
