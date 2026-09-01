# Chainward API, efficiency, and interface audit

Reviewed: 11 August 2026. Follows the security review in
[`security-audit.md`](security-audit.md), which is unchanged by this pass — no
new vulnerability was found and every control it lists was re-exercised by
`npm run verify:offline`.

## Scope

Torn API call patterns and caching, per-request server work, the connection
screen, the observed service state drawer, route transitions, the navigation
rail, the reward scheme workspace, and a network-free acceptance run.

## September 2026 performance follow-up

The hosted request path received a second pass after production navigation and
active-chain timings were observed:

- New encrypted sessions carry the player and faction labels that Torn already
  verified during connection. Reconstructing the current actor no longer adds a
  `/user/basic` request to every render and five-second telemetry poll. Existing
  temporary cookies remain compatible and use the old lookup until they expire.
- Remembered PostgreSQL session and credential reads now run concurrently.
  Licence and renewal queries are also parallel, and authorization reads one
  actor assignment instead of the complete assignment list and audit history.
- The protected layout starts database authorization, health, roster, member
  activity, and display telemetry work as soon as their inputs are available,
  avoiding the previous sequence of database and Torn network waterfalls.
- Browser telemetry refreshes share one in-flight response across the shell and
  live-chain controls. Hidden tabs pause polling, and member monitoring accepts
  the freshly rendered server snapshot instead of repeating it after hydration.

## Findings and fixes

### 1. The stored credential was decrypted three to five times per page render

`getConfiguredTornClient()` read cookies, decrypted the remembered credential,
and — in local mode — opened and closed the AppData credential SQLite database
on **every** call. Each cached data loader calls it independently, so a single
render repeated that work once per loader:

| Route | Loaders resolving a client | Credential resolutions before | After |
| --- | --- | --- | --- |
| `/dashboard`, `/analytics` | actor, telemetry, roster, chain history, current report | 5 | 1 |
| `/live-chain`, `/chains` | actor, telemetry, + one data loader | 4 | 1 |
| `/members`, `/faction`, `/payouts`, `/rewards`, `/settings` | actor, telemetry, roster | 3 | 1 |

**Fix.** `getConfiguredTornClient` is wrapped in React `cache()`, so the
credential is decrypted and the client constructed once per request. This never
affected Torn request volume — the response cache already deduplicated those —
but it removed the repeated cryptography and file handles.

### 2. History responses were re-fetched every minute

`server-client.ts` passed a 60-second fallback for `historyCacheSeconds` while
the client's own default was 900. That bucket covers `/key/info`,
`/user/basic`, and `/faction/chains` — data that changes rarely. `/user/basic`
is now needed only for connection validation and backward compatibility with a
temporary cookie from the previous release.

**Fix.** The fallback is now 600 seconds. `TORN_HISTORY_CACHE_SECONDS` still
overrides it, and live buckets (faction, chain, members, current chain report)
are untouched at 30 seconds.

### 3. The Torn response cache grew without bound

`responseCache` is a module-level `Map` keyed by credential fingerprint plus
URL, and entries were only ever added. A long-running server retained one entry
per key per endpoint forever.

**Fix.** Writes now drop expired entries and evict oldest-first past 400
entries.

### 4. Background telemetry went stale after a hidden tab

The poll skipped while the tab was hidden but nothing re-ran on return, so a
workspace left in a background tab showed the chain count from before it was
hidden until the next interval tick.

**Fix.** `visibilitychange` and `online` now trigger a catch-up poll, but only
when more than one refresh interval has elapsed.

### 5. Keyboard shortcuts re-subscribed on every render

The `g`-prefix navigation effect depended on `searchableItems`, which is rebuilt
each render. Every render tore down and re-registered the listener and cleared
the in-flight prefix timer, so a `g` followed by a re-render lost the shortcut.

**Fix.** Destinations are read through a ref; the listener registers once.

### 6. Reward schemes could silently pay nobody

`validateRewardTiers` rejected overlapping ranges but not *gaps*. A scheme of
`0–5` and `10–20` saved cleanly, and any member finishing on 6–9 hits matched no
tier and was paid nothing with no warning anywhere in the interface.

**Fix.** A new `analyzeRewardCoverage` reports uncovered ranges — opening gaps,
interior gaps, and an unbounded tail when no tier is open-ended — with six unit
tests. The editor surfaces them as a non-blocking warning with a one-click
repair, and the payout preview shows the "no reward" outcome directly. Gaps stay
warnings rather than errors because a faction may legitimately choose not to pay
below a threshold.

### 7. Saving a scheme discarded the operator's place

`/rewards` remounted the whole manager with `key={workspace.revision}`, so every
save reset the selection, the scroll position, and any second scheme being
compared.

**Fix.** The manager reconciles against `workspace.revision` itself and rebinds
to the record that was just persisted.

### 8. `addTier` could swallow hit counts

When the last tier was open-ended, adding a tier closed it at
`minimumHits + 9` — an arbitrary offset that could overlap or leave a gap
depending on the existing ranges.

**Fix.** The open tier is closed at its own minimum and the new tier starts one
above the highest bound in the scheme, so the result is always contiguous.

### 9. A departed member kept workspace access

`requireFactionPermission` authorised purely from the stored assignment row. It
never re-checked that the holder was still in the verified Torn faction, so a
member who left or was removed kept operating the workspace until somebody
noticed the row and revoked it by hand.

**Fix.** Every permission check still confirms current roster membership.
Telemetry and that authorization work now run concurrently, so the security
check adds no separate network waterfall. Checks deny only on a definite
answer — if Torn cannot return the roster at all we do not know that the member
left, and converting an upstream outage into a lockout for every delegated
operator would be worse than the risk it avoids.

### 10. Stale assignments could not be revoked

The revoke action ran through the same verification as granting, which requires
the target to be on the current roster. Revocation is most necessary precisely
when the member has left, so those rows were permanent.

**Fix.** Revocation resolves the target from the assignment registry instead,
and keeps the owner, faction, and licence checks. The interface now lists stale
assignments in a dedicated banner with a working revoke, and the assignment row
for a departed member offers *Revoke* rather than a *Manage* button that
silently did nothing because no roster record existed to open.

### 11. Administrator held every owner permission

`ADMINISTRATOR` had a byte-identical permission set to `OWNER`, including
`faction:manage` — which gates the **destructive** backup restore — and
`api:manage`. A delegated faction administrator could overwrite workspace
configuration from a backup file.

**Fix.** Backup and restore are now separate permissions. An administrator can
export a configuration backup (`faction:backup`); restoring one and replacing
the stored Torn credential stay with the owner. A test asserts the role ladder
is monotonic, so a junior role can never hold a permission its senior lacks.

### 12. The role policy screen advertised capabilities that did not exist

Role labels, descriptions, and permission lists were hard-coded in the client
component, separately from the permissions the server enforces. The
Administrator card listed "API", which maps to nothing enforced anywhere.

**Fix.** `permissionCatalogue` and `roleDefinitions` in `authorization.ts` are
now the single source of truth, and the screen renders from them. A test asserts
each published role advertises exactly the permissions it is granted, so the two
cannot drift again.

### 13. Owner access could be written into the assignment registry

Nothing stopped the owner from assigning themselves a role. `isPlatformOwner`
bypasses assignments, so there was no lockout risk, but the registry could
display `Skillerious — Viewer — Suspended` while the owner retained full access,
contradicting the policy stated on the same screen.

**Fix.** Assignment, batch assignment, and revocation all refuse the platform
owner as a target. The local registry read also filters `OWNER` rows, matching
what the PostgreSQL path already did.

### 14. Chain state mixed two different time representations

Torn's current OpenAPI schema defines `timeout` as **seconds remaining** and
`cooldown` as the **Unix timestamp at which cooldown ends**. It also returns a
non-zero `end` for some live chains, so that field cannot decide liveness.

**Fix.** `timeout > 0` selects an active chain. A future `cooldown` timestamp
selects cooldown and is converted to seconds remaining before reaching the
browser. Tests pin the active, cooldown, stale-timestamp, and idle cases.

### 15. The chain countdown restarted on every page load

Chain responses are cached briefly, but the telemetry map stamped every render
with `checkedAt = now`. A cached response therefore received a fresh timestamp
and the countdown appeared to jump back to its cached value on each refresh.

**Fix.** The cache records when Torn actually answered and telemetry carries
that reading's age. The browser subtracts the age plus half the measured round
trip, then projects the duration with `performance.now()`. The displayed drop
time and elapsed runtime use the server's checked time projected by the same
monotonic clock, so changing the browser wall clock cannot move the countdown.

### 16. Cached bodies looked like timer resets

An identical Torn response can repeat the same `timeout` for up to 30 seconds.
As the local projection fell, the difference from that unchanged value grew
past the old reset threshold, so every cached `300` could push the UI back to
`300` without a hit.

**Fix.** An upward reset now requires corroboration from a higher `current`
count at hit 10 or later; hits 1–10 share the warm-up window. Active checks also
use Torn's documented unique `timestamp` parameter to bypass the service cache,
immediately on mount and then every 10 seconds. Only the chain request bypasses
cache, keeping usage to at most six unique chain calls per minute at the default
cadence.

### 17. `max` was labelled as a faction ceiling

Torn's `chain.max` reports the **next chain bonus milestone**, not a faction
maximum. Torn awards a flat respect bonus at thirteen fixed lengths — 10, 25,
50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000 — so a faction
capable of a 250 chain sees `max: 25` at 21 hits. The interface called this
"Maximum chain".

**Fix.** It now reads "Next bonus at", the gauge is captioned as progress to the
next bonus, and a milestone ladder shows the window around the current target.
The milestone values are a documented game rule, cited in the source; all
progress still comes only from Torn's `current` and `max`.

## Interface work

- **Connect screen.** The entry card reserved a fixed `570px` so the
  confirmation view would not shift the page, which left a large empty well
  under the submit button. The card is now sized by its content, the entry and
  confirmation views share a minimum height instead, and the space carries the
  API selections Chainward verifies. Supporting copy moved off the 8–9px floor
  onto a 10.5–15px scale, and the three steps read as a sequence instead of
  three competing cards.
- **Observed service state.** Rebuilt as a real component rather than an inline
  nested array. Each check now carries an icon, a tone, a plain-language detail,
  and a state pill; the panel summarises how many checks are healthy, exposes a
  re-check action, and is escapable and focus-managed. Type sizes rose from
  8–8.5px to 10–12.5px.
- **View switching.** Three separate causes of the "it reloads the page" feel.
  `(platform)/loading.tsx` replaced the entire view with skeleton blocks on
  every navigation, so each route change flashed placeholder content before the
  real page arrived; it was removed, and the current view now stays on screen
  and recedes slightly while the next one resolves. The route stage animated
  `filter: blur(2px)`, forcing an offscreen composite of the whole page per
  navigation; it is now a 300ms opacity and transform enter. And nothing
  acknowledged the click at all, so `useLinkStatus` now drives a per-destination
  indicator and a top progress bar. Every piece of navigation feedback is
  delayed 110–140ms, so an instant prefetched navigation shows none of it.
  The shell chrome deliberately never dims — only the view being replaced does.
- **Layout waterfall.** `(platform)/layout.tsx` awaited the database probe on
  its own before starting the two licence lookups, adding its full latency to
  every render. The three independent calls now run together.
- **Navigation rail.** The collapsed state lived only in `localStorage` and was
  applied after hydration, so every load painted the expanded rail and then
  snapped — the main source of the "clunky" feel. A pre-paint script now
  resolves the saved rail width and accent, the layout is driven by a single
  `--rail-width` token with one shared easing curve, duplicate and conflicting
  width rules across the two stylesheets were removed, and collapsed items show
  a styled label on hover.
- **Handhelds.** A dedicated `mobile.css` layer states what a phone needs
  rather than editing every desktop rule. The connect screen re-orders to
  headline → key field → supporting steps, so the primary action is reachable
  without scrolling past a screen of explanation; on desktop the two-column
  reading order is unchanged, because the hero now uses named grid areas. The
  full-width hairline under the topbar tracked a hard-coded `top: 81px`, which
  drifted as soon as the bar changed height, and is now anchored to the bar.
  Every text control is raised to 16px on narrow viewports — Safari on iOS zooms
  the page whenever a focused control is smaller — and a global
  `input { font-size: 12.5px !important }` rule in polish.css was quietly
  overriding the key field's own size on desktop too. Touch targets go to 46px,
  safe-area insets are honoured at the top and bottom, `body` clips horizontal
  overflow (with `clip`, not `hidden`, so the sticky topbar keeps sticking), and
  the reward tier grid becomes labelled cards instead of a seven-column table
  nobody can use one-handed.
- **Reward schemes.** The screen stacked a storage banner, a three-step
  explainer, a four-tile summary strip, and a fixed-height builder, so editing
  meant scrolling past four blocks of chrome. It is now a viewport-height
  console: a compact bar, a scheme library, and a tabbed editor
  (Details / Hit ranges / Payout preview) where only the active pane scrolls.
  New capabilities: coverage warnings with one-click repair, an unsaved-changes
  badge with discard, `Ctrl+S` to save, and a payout simulator that shows what a
  member on a given hit count receives.

## Verification

`npm run check` passes: lint, TypeScript, 73 unit tests (11 new), and an
optimized production build.

`npm run verify:offline` runs 41 end-to-end assertions against a throwaway
development server with no network access and no Torn key. It starts from the
locked state, checks the licence gate, grants access through the real licensing
store, then exercises every operational route, offline data labelling, the
telemetry API, and request hardening. See
[`unlock-release-walkthrough.md`](unlock-release-walkthrough.md) for the manual
equivalent.

One behaviour worth recording, because it will recur if a route-level
`loading.tsx` is ever reintroduced: a Suspense boundary at the route level lets
the shell flush before the page finishes, and a server `redirect()` then arrives
as an instruction inside the streamed RSC payload with HTTP 200 rather than as a
3xx response. Status alone proves nothing about whether a guard fired. The
harness therefore accepts either form and additionally asserts that no protected
content appears in the response.

## Typography

Inter is now self-hosted. A single variable woff2 covering weights 100-900 is
loaded through `next/font/local`, which fingerprints and preloads it, and
`--font-inter` composes it ahead of the previous system fallbacks. No font is
fetched from a third-party origin: local rendering has to work without internet
access, and a CDN request would disclose every page view to another host. The
SIL Open Font License accompanies the file in `src/app/fonts/`.

The interface also had roughly 620 declarations below 11px, some as small as
6.5px. Everything under that floor was raised, so no label in the application is
now set below 11px — 10.5px in the newer layers, which use a tighter scale.

## Not changed

- `requestAddress` in the rate limiter trusts `x-real-ip` and `x-forwarded-for`
  without a proxy allowlist, so a direct-to-origin caller can rotate the header
  to evade per-address throttling. The process-wide throttle still applies. This
  is correct for the current single-device local deployment and is already
  tracked as a hosted-release risk in the security audit.
- The CSP keeps `script-src 'unsafe-inline'`, which the pre-paint appearance
  script relies on. A hosted release adopting per-request nonces should give
  that script a nonce.
