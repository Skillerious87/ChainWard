/**
 * Full offline acceptance run. Starts the development server with the offline
 * fixture enabled, opens an offline session over HTTP, grants the test faction
 * an active licence through the real licensing store, then requests every
 * operational route and asserts each one renders without an error boundary.
 *
 * No network access and no Torn API key are required. Run with:
 *   node scripts/verify-offline.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = Number.parseInt(process.env.CHAINWARD_VERIFY_PORT ?? "3123", 10);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const START_TIMEOUT_MS = 180_000;

const PUBLIC_ROUTES = ["/", "/connect"];
const OPERATIONAL_ROUTES = [
  "/dashboard",
  "/live-chain",
  "/members",
  "/chains",
  "/analytics",
  "/rewards",
  "/payouts",
  "/faction",
  "/settings",
];

const failures = [];
let passed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
    return true;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  return false;
}

function nextBinary() {
  return fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
}

async function waitForServer(child) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`The development server exited early with code ${child.exitCode}.\n${child.startupLog?.join("") ?? ""}`);
    try {
      const response = await fetch(`${ORIGIN}/connect`, { headers: { accept: "text/html" } });
      if (response.ok) return;
    } catch {
      // The server is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error("The development server did not become ready in time.");
}

function cookieHeaderFrom(response, existing = "") {
  const jar = new Map(existing.split("; ").filter(Boolean).map((pair) => {
    const index = pair.indexOf("=");
    return [pair.slice(0, index), pair.slice(index + 1)];
  }));
  for (const value of response.headers.getSetCookie()) {
    const [pair] = value.split(";");
    const index = pair.indexOf("=");
    const name = pair.slice(0, index);
    const content = pair.slice(index + 1);
    if (content === "") jar.delete(name);
    else jar.set(name, content);
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

/** Next renders its error boundary inline, so the HTML itself is the signal. */
function looksLikeErrorPage(html) {
  return html.includes("Application error: a client-side exception")
    || html.includes("This page could not be displayed")
    || /<h[12][^>]*>\s*(Internal Server Error|500)\s*</i.test(html);
}

/**
 * `loading.tsx` lets the shell flush before the page finishes, so a server
 * `redirect()` arrives as a client-side instruction inside the streamed RSC
 * payload with HTTP 200 rather than as a 3xx response. Status alone therefore
 * says nothing about whether a guard fired.
 */
function redirectTarget(result) {
  if (result.status >= 300 && result.status < 400) return result.location ?? "";
  return result.html.match(/NEXT_REDIRECT;[a-z]+;([^;]+);/)?.[1] ?? "";
}

async function openOfflineSession(identity) {
  const response = await fetch(`${ORIGIN}/api/onboarding/offline-session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ identity }),
  });
  const payload = await response.json();
  return { response, payload, cookie: cookieHeaderFrom(response) };
}

async function getRoute(path, cookie) {
  const response = await fetch(`${ORIGIN}${path}`, {
    headers: { accept: "text/html", ...(cookie ? { cookie } : {}) },
    redirect: "manual",
  });
  const html = response.status >= 300 && response.status < 400 ? "" : await response.text();
  return { status: response.status, location: response.headers.get("location"), html };
}

/**
 * `--conditions=react-server` makes the `server-only` guard resolve to its
 * no-op server entry instead of throwing outside a React Server Component.
 */
function runSeed(mode) {
  return spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", fileURLToPath(new URL("./seed-offline-license.mts", import.meta.url)), mode], {
    encoding: "utf8",
    env: { ...process.env, CHAINWARD_LOCAL_TEST_MODE: "true", CHAINWARD_OFFLINE_TEST_MODE: "true" },
  });
}

async function run() {
  console.log(`\nChainward offline verification on ${ORIGIN}\n`);

  // Start from the locked state so the licence gate is genuinely exercised.
  const reset = runSeed("reset");
  if (reset.stdout) process.stdout.write(reset.stdout.replace(/^/gm, "  "));
  if (reset.status !== 0) console.log(`  reset skipped: ${(reset.stderr || "").split("\n").slice(-4).join(" ").slice(0, 200)}`);

  const child = spawn(process.execPath, [nextBinary(), "dev", "--port", String(PORT), "--hostname", "127.0.0.1"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "development",
      CHAINWARD_LOCAL_TEST_MODE: "true",
      CHAINWARD_OFFLINE_TEST_MODE: "true",
      // Keeps this run independent of a development server already using `.next`.
      CHAINWARD_DIST_DIR: process.env.CHAINWARD_DIST_DIR ?? ".next-offline-verify",
    },
  });
  const serverLog = [];
  child.startupLog = serverLog;
  child.stdout.on("data", (chunk) => serverLog.push(String(chunk)));
  child.stderr.on("data", (chunk) => serverLog.push(String(chunk)));

  try {
    await waitForServer(child);
    console.log("Server ready.\n");

    console.log("Public routes");
    for (const path of PUBLIC_ROUTES) {
      const result = await getRoute(path);
      check(`GET ${path} renders`, result.status === 200 && !looksLikeErrorPage(result.html), `status ${result.status}`);
    }
    const connect = await getRoute("/connect");
    check("/connect offers the offline test identities", connect.html.includes("Faction tester") && connect.html.includes("Owner reviewer"));
    check("/connect lists the verified key selections", connect.html.includes("chainreport"));
    check("/connect declares a responsive viewport", /<meta name="viewport" content="[^"]*width=device-width/.test(connect.html));
    check("/connect keeps the key field above the supporting steps for narrow viewports", connect.html.indexOf("onboarding-form-shell") < connect.html.indexOf("onboarding-support"), "the form markup must precede the supporting steps");

    console.log("\nGuest access control");
    const guarded = await getRoute("/dashboard");
    check("/dashboard sends an unconnected visitor to /connect", redirectTarget(guarded).includes("/connect"), `status ${guarded.status} target "${redirectTarget(guarded)}"`);

    console.log("\nOffline session");
    const owner = await openOfflineSession("owner");
    check("owner offline session opens", owner.response.ok && owner.payload.connected === true, JSON.stringify(owner.payload).slice(0, 120));
    check("owner session never returns the fixture key", !JSON.stringify(owner.payload).includes("chainward-offline-owner"));
    const ownerAdmin = await getRoute("/admin", owner.cookie);
    check("owner reaches /admin", ownerAdmin.status === 200 && !looksLikeErrorPage(ownerAdmin.html), `status ${ownerAdmin.status}`);
    check("access audit rows carry a single body cell", !ownerAdmin.html.includes("access-audit-list\"><div"), "the four-child grid row was the source of the overflowing reviewer name");

    const member = await openOfflineSession("member");
    check("member offline session opens", member.response.ok && member.payload.connected === true);
    const memberAdmin = await getRoute("/admin", member.cookie);
    check("member cannot reach owner administration", !memberAdmin.html.includes("Access request queue") && !memberAdmin.html.includes("admin-owner-banner"), `status ${memberAdmin.status}`);

    console.log("\nLicence gate before approval");
    const lockedRewards = await getRoute("/rewards", member.cookie);
    check("/rewards sends an unlicensed faction to /unlock", redirectTarget(lockedRewards).includes("/unlock"), `status ${lockedRewards.status} target "${redirectTarget(lockedRewards)}"`);
    check("/rewards leaks no licensed content while locked", !lockedRewards.html.includes("reward-console") && !lockedRewards.html.includes("Scheme library"));

    console.log("\nGranting offline licence");
    const seed = runSeed("grant");
    if (seed.stdout) process.stdout.write(seed.stdout.replace(/^/gm, "  "));
    check("licence seeding completed", seed.status === 0, (seed.stderr || "").split("\n").slice(-6).join(" ").slice(0, 300));

    console.log("\nOperational routes");
    const session = await openOfflineSession("member");
    for (const path of OPERATIONAL_ROUTES) {
      const result = await getRoute(path, session.cookie);
      const target = redirectTarget(result);
      check(`GET ${path} renders`, result.status === 200 && !target && !looksLikeErrorPage(result.html), `status ${result.status}${target ? ` redirected to ${target}` : ""}`);
    }

    console.log("\nOffline data provenance");
    const dashboard = await getRoute("/dashboard", session.cookie);
    check("dashboard is labelled as offline test data", dashboard.html.includes("Offline test data") || dashboard.html.includes("Offline fixture"));
    check("dashboard shows the fixture faction", dashboard.html.includes("Chainward Test Faction"));
    check("shell resolves the saved rail width before paint", dashboard.html.includes('data-sidebar='));
    check("workspace scrolls inside the shell, not the document", dashboard.html.includes('class="app-scroll"'), "the top bar and provenance banner must stay outside the scroll region");
    check("provenance banner precedes the scroll region", dashboard.html.indexOf("data-source-banner") < dashboard.html.indexOf('class="app-scroll"'));

    const rewards = await getRoute("/rewards", session.cookie);
    check("reward console renders", rewards.html.includes("reward-console") && rewards.html.includes("Scheme library"));
    check("reward console renders its tabbed editor", rewards.html.includes("Payout preview") && rewards.html.includes("Hit ranges"));
    check("reward console loads the seeded scheme", rewards.html.includes("Offline verification scheme"));
    check("reward console drops the old stacked strips", !rewards.html.includes("reward-summary-strip") && !rewards.html.includes("reward-onboarding"));

    const liveChain = await getRoute("/live-chain", session.cookie);
    check("live chain renders fixture chain progress", liveChain.html.includes("742"));
    check("live chain reports the fixture chain as active", !liveChain.html.includes("No active chain"), "a chain with a counting-down timeout must not read as idle");
    check("live chain renders the 0-to-max gauge", liveChain.html.includes("chain-gauge__track") && liveChain.html.includes("chain-gauge__scale"));
    check("gauge scale is derived from Torn's reported maximum", liveChain.html.includes("1,000"));
    check("live chain labels contributors as live, not last-completed", liveChain.html.includes("Live report contributors"));

    const history = await getRoute("/chains", session.cookie);
    check("chain history reports settlement standing", history.html.includes("history-summary__settlement") && history.html.includes("marked paid"));
    const chainReport = await getRoute("/chains/7000003", session.cookie);
    check("chain report renders the ranked contributor chart", chainReport.html.includes("contributor-chart__rank") && chainReport.html.includes("contributor-chart__bar"));
    check("chain report states respect per hit", chainReport.html.includes("Respect per hit"));

    const settings = await getRoute("/settings", session.cookie);
    check("settings opens straight into its console", settings.html.includes("settings-console") && !settings.html.includes("Manage one area at a time"));
    check("licence testing tools are hidden from a non-owner", !settings.html.includes("Developer tools"), "the controls that lock and unlock the workspace must be owner-only");
    const ownerForSettings = await openOfflineSession("owner");
    const ownerSettings = await getRoute("/settings", ownerForSettings.cookie);
    check("licence testing tools are offered to the owner in local test mode", ownerSettings.html.includes("Developer tools"));

    console.log("\nPermission enforcement");
    const memberBackup = await fetch(`${ORIGIN}/api/data/backup`, { headers: { cookie: session.cookie } });
    check("a member without an assignment cannot export a backup", memberBackup.status === 403, `status ${memberBackup.status}`);
    const ownerSession = await openOfflineSession("owner");
    const ownerBackup = await fetch(`${ORIGIN}/api/data/backup`, { headers: { cookie: ownerSession.cookie } });
    check("the owner can export a backup", ownerBackup.status === 200, `status ${ownerBackup.status}`);
    const anonymousBackup = await fetch(`${ORIGIN}/api/data/backup`);
    check("an unauthenticated caller cannot export a backup", anonymousBackup.status === 403, `status ${anonymousBackup.status}`);

    console.log("\nTelemetry API");
    const telemetry = await fetch(`${ORIGIN}/api/telemetry/live-chain`, { headers: { accept: "application/json", cookie: session.cookie } });
    const telemetryPayload = await telemetry.json();
    check("telemetry endpoint answers with live fixture data", telemetry.ok && telemetryPayload.source === "live" && telemetryPayload.mode === "offline", `status ${telemetry.status}`);
    check("telemetry never leaks a credential", !JSON.stringify(telemetryPayload).toLowerCase().includes("apikey"));
    const anonymousTelemetry = await fetch(`${ORIGIN}/api/telemetry/live-chain`, { headers: { accept: "application/json" } });
    check("telemetry rejects an unauthenticated caller", anonymousTelemetry.status === 401, `status ${anonymousTelemetry.status}`);

    console.log("\nRequest hardening");
    const crossSite = await fetch(`${ORIGIN}/api/onboarding/offline-session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ identity: "owner" }),
    });
    check("cross-site mutation is refused", crossSite.status === 403, `status ${crossSite.status}`);
    const oversized = await fetch(`${ORIGIN}/api/onboarding/validate-key`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ apiKey: "x".repeat(5_000) }),
    });
    check("oversized validate-key body is refused", oversized.status === 413 || oversized.status === 400, `status ${oversized.status}`);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (child.exitCode === null) child.kill("SIGKILL");
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(`  - ${failure}`);
    if (serverLog.length) {
      console.log("\nLast server output:");
      console.log(serverLog.join("").split("\n").slice(-25).join("\n"));
    }
    process.exitCode = 1;
    return;
  }
  console.log("Offline verification passed.");
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
