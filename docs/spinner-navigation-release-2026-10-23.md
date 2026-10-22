# Spinner-only navigation — 23 October 2026

All workspace route fallbacks now render one plain CSS spinner. The branded
loading screen, skeleton layouts, dimming and blur layers, Android cube loader,
and full-window login handoff overlay have been removed from the web app.

Navigation feedback follows actual pending operations. There is no delayed
appearance, minimum display time, finish timer, safety-dismiss timer, or exit
animation. Synchronous editor and section changes do not manufacture a pending
state. Sign-in navigation makes its fresh document request immediately while
the form's own button shows its request state. Incoming pages have no fade or
entrance animation.

Investigation also identified a display-only avatar refresh in the shell's
blocking Promise.all. That promise now streams into an avatar-only Suspense
boundary. The saved image remains visible until the result arrives; a slow
Torn profile request cannot keep the authorized workspace behind its fallback.
Identity, licence and current membership requirements remain in the blocking
authorization path.

Verification: lint, TypeScript, production build, 573 tests and all 100 offline
HTTP acceptance checks passed. Browser tests deliberately held an actual route
request, checked that a spinner appeared without dimming the workspace, then
released the response and verified both route and fallback spinners disappeared.
Tests also cover immediate navigation and a workspace rendering while its
avatar refresh remains unresolved.

This removes artificial loading presentation. The spinner still reflects real
server and Torn work. Request timeouts and polling intervals are not loading
display timers; this change does not remove their recovery and freshness rules.
