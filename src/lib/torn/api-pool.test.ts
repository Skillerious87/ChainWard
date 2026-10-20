import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/licensing/faction-access", () => ({ getFactionAccessSummary: vi.fn(async () => ({ state: "active" })) }));
vi.mock("@/lib/auth/faction-access-store", () => ({ getFactionAccessAssignment: vi.fn(async () => ({ status: "ACTIVE", role: "VIEWER" })) }));

import { readFactionPoolRequest, readSharedOperation } from "./api-pool-broker";
import { canonicalFactionPoolRequest, factionPoolOperation, projectFactionPoolResponse, tornCredentialFingerprint } from "./api-pool-policy";
import { apiPoolStatus, decryptApiPoolGrant, reconcileApiPoolConnection, revokeApiPoolGrant, saveApiPoolGrant, touchApiPoolPresence } from "./api-pool-store";
import { apiState, apiStateStore } from "./api-state-store";
import { identifyTornOwner, readPoolGrant, readRequestBudget, recordTornFailure, reserveTornAttempt } from "./api-request-budget";
import { credentialDatabasePath } from "./credential-database";
import { TornApiError } from "./errors";
import type { ApiPoolGrant, TornCoordinationContext } from "./api-pool-types";
import { getFactionAccessSummary } from "@/lib/licensing/faction-access";
import { verifyTornIdentity } from "./api-identity";

const factionId = 51393;
const chainRequest = { path: `/faction/${factionId}/chain`, query: {}, cacheMs: 5_000, forceRefresh: true };
const contributionKey = "ABCD1234EFGH5678";
const preferences = { enabled: true, limitPerMinute: 10, allowOffline: true, allowBackground: false };

function chain(current = 42) {
  return { chain: { id: 1234, current, max: 100, timeout: 200, modifier: 1, cooldown: 0, start: 1000, end: 0 } };
}

function roster(ids = [1, 2, 3]) {
  return { members: ids.map((id) => ({ id, name: `Player ${id}`, position: "Member", level: 10, days_in_faction: 100, is_revivable: true, is_on_wall: false, is_in_oc: false, has_early_discharge: false, last_action: { status: "Online", timestamp: 1000, relative: "Now" }, status: { description: "Okay", details: null, state: "Okay", until: null, color: "green", secret: "must-not-share" }, revive_setting: "Faction" })) };
}

async function grantContext(ownerId = 2): Promise<TornCoordinationContext> {
  const grant = readPoolGrant(await apiStateStore.read(`grant:${ownerId}`))!;
  return { ownerId, contribution: { ownerId, factionId: grant.factionId, version: grant.version, background: false } };
}

describe.sequential("shared Torn API capacity", () => {
  let directory = "";
  let now = 0;

  beforeEach(async () => {
    directory = mkdtempSync(path.join(tmpdir(), "chainward-api-pool-"));
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("CHAINWARD_APP_DATA_DIR", path.join(directory, "appdata"));
    vi.stubEnv("CHAINWARD_LOCAL_DB_PATH", path.join(directory, "workspace.sqlite"));
    vi.stubEnv("API_KEY_ENCRYPTION_SECRET", Buffer.alloc(32, 7).toString("base64"));
    now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.mocked(getFactionAccessSummary).mockResolvedValue({ state: "active" } as Awaited<ReturnType<typeof getFactionAccessSummary>>);
    for (const [apiKey, ownerId] of [["viewer-one-key", 1], ["viewer-two-key", 3], ["viewer-key", 1], ["departed-key", 1]] as const) {
      await identifyTornOwner(tornCredentialFingerprint(apiKey), ownerId, apiStateStore, { factionId, verifiedAt: now });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    if (!path.resolve(directory).startsWith(path.join(path.resolve(tmpdir()), "chainward-api-pool-"))) throw new Error("Unexpected test directory.");
    rmSync(directory, { recursive: true, force: true });
  });

  it("atomically caps concurrent requests across every credential for one player", async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 40 }, (_, index) => reserveTornAttempt(`key-${index}`, { ownerId: 1 })));
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(30);
    expect(readRequestBudget(await apiStateStore.read("budget:1")).attempts).toHaveLength(30);
    await expect(reserveTornAttempt("another-player", { ownerId: 2 })).resolves.toBeUndefined();
    now += 60_001;
    await expect(reserveTornAttempt("fresh-window", { ownerId: 1 })).resolves.toBeUndefined();
  });

  it("attributes initial identity requests to the player without counting twice", async () => {
    await reserveTornAttempt("new-key", {});
    await identifyTornOwner("new-key", 1);
    await identifyTornOwner("new-key", 1);
    await reserveTornAttempt("new-key", {});
    expect(readRequestBudget(await apiStateStore.read("budget:1")).attempts).toHaveLength(2);
  });

  it("encrypts contributed keys and exposes only safe owner status", async () => {
    await saveApiPoolGrant(2, factionId, contributionKey, preferences);
    const status = await apiPoolStatus(2, factionId);
    expect(status).toMatchObject({ enabled: true, lastFour: "5678", contributionsLastMinute: 0 });
    expect(JSON.stringify(status)).not.toContain(contributionKey);
    expect(readFileSync(credentialDatabasePath()).includes(Buffer.from(contributionKey))).toBe(false);
    expect((await apiPoolStatus(2, factionId + 1)).enabled).toBe(false);
  });

  it("respects the smaller contribution allowance within the player's total", async () => {
    await saveApiPoolGrant(2, factionId, contributionKey, { ...preferences, limitPerMinute: 2 });
    const context = await grantContext();
    const fingerprint = tornCredentialFingerprint(contributionKey);
    await reserveTornAttempt(fingerprint, context);
    await reserveTornAttempt(fingerprint, context);
    await expect(reserveTornAttempt(fingerprint, context)).rejects.toMatchObject({ code: 5 });
    await expect(reserveTornAttempt("personal-key", { ownerId: 2 })).resolves.toBeUndefined();
    expect((await apiPoolStatus(2, factionId)).requestsLastMinute).toBe(3);
  });

  it("requires recent presence unless offline contribution was accepted", async () => {
    await saveApiPoolGrant(2, factionId, contributionKey, { ...preferences, allowOffline: false });
    const context = await grantContext();
    const fingerprint = tornCredentialFingerprint(contributionKey);
    await expect(reserveTornAttempt(fingerprint, context)).rejects.toMatchObject({ code: 18 });
    await touchApiPoolPresence(2, factionId);
    await reserveTornAttempt(fingerprint, context);
    now += 45_001;
    await expect(reserveTornAttempt(fingerprint, context)).rejects.toMatchObject({ code: 18 });
  });

  it("requires separate authorisation for background monitoring", async () => {
    await saveApiPoolGrant(2, factionId, contributionKey, preferences);
    const context = await grantContext();
    context.contribution!.background = true;
    await expect(reserveTornAttempt(tornCredentialFingerprint(contributionKey), context)).rejects.toMatchObject({ code: 18 });
    await saveApiPoolGrant(2, factionId, contributionKey, { ...preferences, allowBackground: true });
    const authorised = await grantContext();
    authorised.contribution!.background = true;
    await expect(reserveTornAttempt(tornCredentialFingerprint(contributionKey), authorised)).resolves.toBeUndefined();
  });

  it("rejects queued work after opt-out, replacement and faction movement", async () => {
    await saveApiPoolGrant(2, factionId, contributionKey, preferences);
    const context = await grantContext();
    await revokeApiPoolGrant(2);
    await expect(reserveTornAttempt(tornCredentialFingerprint(contributionKey), context)).rejects.toMatchObject({ code: 18 });
    const removed = await apiStateStore.read("grant:2");
    expect(JSON.stringify(removed)).not.toContain("encryptedKey");
    await saveApiPoolGrant(2, factionId, contributionKey, preferences);
    await expect(reserveTornAttempt(tornCredentialFingerprint(contributionKey), context)).rejects.toMatchObject({ code: 18 });
    const replacementContext = await grantContext();
    await saveApiPoolGrant(2, factionId + 1, contributionKey, preferences);
    await expect(reserveTornAttempt(tornCredentialFingerprint(contributionKey), replacementContext)).rejects.toMatchObject({ code: 18 });
  });

  it("revokes contributions when the login key or faction changes", async () => {
    await saveApiPoolGrant(2, factionId, contributionKey, preferences, apiStateStore, "login-A");
    await reconcileApiPoolConnection(2, factionId, "login-A");
    expect((await apiPoolStatus(2, factionId)).enabled).toBe(true);
    await reconcileApiPoolConnection(2, factionId, "login-B");
    expect((await apiPoolStatus(2, factionId)).enabled).toBe(false);
  });

  it("requires fresh donor membership before another operation", async () => {
    await saveApiPoolGrant(2, factionId, contributionKey, preferences);
    const context = await grantContext();
    now += 60_001;
    await expect(reserveTornAttempt(tornCredentialFingerprint(contributionKey), context)).rejects.toMatchObject({ code: 18 });
    await expect(reserveTornAttempt(tornCredentialFingerprint(contributionKey), { ...context, verificationRequest: true })).resolves.toBeUndefined();
  });

  it("honours long owner cooldowns across different keys", async () => {
    await recordTornFailure("key-A", { ownerId: 1 }, new TornApiError(5, "Limit", { retryAfterSeconds: 86_400 }));
    now += 3_600_000;
    await expect(reserveTornAttempt("key-B", { ownerId: 1 })).rejects.toMatchObject({ code: 5, retryAfterSeconds: 82_800 });
    await expect(reserveTornAttempt("other-player", { ownerId: 2 })).resolves.toBeUndefined();
  });

  it("stops all players on an IP block and quarantines invalid credentials", async () => {
    await recordTornFailure("invalid-key", { ownerId: 1 }, new TornApiError(2, "Invalid"));
    await expect(reserveTornAttempt("invalid-key", { ownerId: 1 })).rejects.toMatchObject({ code: 2 });
    await recordTornFailure("key-A", { ownerId: 1 }, new TornApiError(8, "IP blocked"));
    await expect(reserveTornAttempt("key-B", { ownerId: 2 })).rejects.toMatchObject({ code: 5 });
  });

  it("coalesces twenty viewers and manual refreshes into one chain call", async () => {
    const refresh = vi.fn(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      return { value: chain(), fetchedAt: Date.now() };
    });
    const snapshots = await Promise.all(Array.from({ length: 20 }, () => readSharedOperation(factionId, chainRequest, refresh)));
    expect(refresh).toHaveBeenCalledOnce();
    expect(snapshots.every((snapshot) => snapshot.fetchedAt === now)).toBe(true);
    await readSharedOperation(factionId, chainRequest, refresh);
    expect(refresh).toHaveBeenCalledOnce();
    now += 5_001;
    await readSharedOperation(factionId, chainRequest, refresh);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("isolates faction caches and keeps personal endpoints outside the pool", async () => {
    const refresh = vi.fn(async () => ({ value: chain(), fetchedAt: Date.now() }));
    await readSharedOperation(factionId, chainRequest, refresh);
    await readSharedOperation(factionId + 1, { ...chainRequest, path: `/faction/${factionId + 1}/chain` }, refresh);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(factionPoolOperation("/user/attacks", factionId)).toBeNull();
    expect(factionPoolOperation("/user/battlestats", factionId)).toBeNull();
    expect(factionPoolOperation("/key/info", factionId)).toBeNull();
    expect(factionPoolOperation(`/faction/${factionId + 1}/members`, factionId)).toBeNull();
  });

  it("strips permission-dependent and unknown fields before caching a roster", async () => {
    const request = { ...chainRequest, path: `/faction/${factionId}/members` };
    const refresh = vi.fn(async () => ({ value: roster(), fetchedAt: Date.now() }));
    const snapshot = await readSharedOperation(factionId, request, refresh);
    expect(JSON.stringify(snapshot.value)).not.toContain("must-not-share");
    expect(JSON.stringify(snapshot.value)).not.toContain('"revive_setting":"Faction"');
    expect(JSON.stringify(await apiStateStore.list("cache:"))).not.toContain("must-not-share");
  });

  it("rejects a report from another faction and does not cache it", async () => {
    const request = { ...chainRequest, path: "/faction/1234/chainreport" };
    expect(() => projectFactionPoolResponse(request, factionId, { chainreport: { faction_id: factionId + 1 } })).toThrow();
    const malformed = vi.fn(async () => ({ value: { chain: { id: -1 } }, fetchedAt: Date.now() }));
    await expect(readSharedOperation(factionId, chainRequest, malformed)).rejects.toThrow();
    const valid = vi.fn(async () => ({ value: chain(), fetchedAt: Date.now() }));
    await expect(readSharedOperation(factionId, chainRequest, valid)).rejects.toMatchObject({ code: 17 });
    expect(valid).not.toHaveBeenCalled();
    now += 5_001;
    await readSharedOperation(factionId, chainRequest, valid);
    expect(valid).toHaveBeenCalledOnce();
  });

  it("uses a consenting donor once and serves the resulting data to another viewer", async () => {
    await saveApiPoolGrant(2, factionId, contributionKey, preferences);
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname.endsWith("/members")) return Response.json(roster());
      if (pathname.endsWith("/chain")) return Response.json(chain());
      throw new Error("Unexpected Torn operation");
    });
    vi.stubGlobal("fetch", fetchMock);
    await readFactionPoolRequest({ ownerId: 1, factionId, apiKey: "viewer-one-key" }, chainRequest);
    await readFactionPoolRequest({ ownerId: 3, factionId, apiKey: "viewer-two-key" }, chainRequest);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every((call) => (call[1]?.headers as Record<string, string>).Authorization === `ApiKey ${contributionKey}`)).toBe(true);
    expect((await apiPoolStatus(2, factionId)).contributionsLastMinute).toBe(2);
    expect((await apiPoolStatus(1, factionId)).requestsLastMinute).toBe(0);
  });

  it("does not let a departed viewer inherit a donor's faction access", async () => {
    await saveApiPoolGrant(2, factionId, contributionKey, preferences);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(roster([2, 3])));
    vi.stubGlobal("fetch", fetchMock);
    await expect(readFactionPoolRequest({ ownerId: 1, factionId, apiKey: "departed-key" }, chainRequest)).rejects.toMatchObject({ code: 7 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("distributes necessary refreshes across eligible contributors", async () => {
    const otherKey = "EFGH5678ABCD1234";
    await saveApiPoolGrant(2, factionId, contributionKey, preferences);
    await saveApiPoolGrant(3, factionId, otherKey, preferences);
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => new URL(String(input)).pathname.endsWith("/members") ? Response.json(roster()) : Response.json(chain()));
    vi.stubGlobal("fetch", fetchMock);
    await readFactionPoolRequest({ ownerId: 1, factionId, apiKey: "viewer-key" }, chainRequest);
    expect((await apiPoolStatus(2, factionId)).contributionsLastMinute).toBe(1);
    expect((await apiPoolStatus(3, factionId)).contributionsLastMinute).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never uses a donor for an unlicensed viewer", async () => {
    vi.mocked(getFactionAccessSummary).mockResolvedValue({ state: "inactive" } as Awaited<ReturnType<typeof getFactionAccessSummary>>);
    await saveApiPoolGrant(2, factionId, contributionKey, preferences);
    const ownRead = vi.fn(async () => ({ value: chain(), fetchedAt: now }));
    await readFactionPoolRequest({ ownerId: 1, factionId, apiKey: "own-key" }, chainRequest, ownRead);
    expect(ownRead).toHaveBeenCalledOnce();
    expect((await apiPoolStatus(2, factionId)).contributionsLastMinute).toBe(0);
  });

  it("does not provide a shared-key fallback for an anonymous caller", async () => {
    await saveApiPoolGrant(2, factionId, contributionKey, preferences);
    await expect(readFactionPoolRequest({ factionId }, chainRequest)).rejects.toMatchObject({ code: 7 });
    expect((await apiPoolStatus(2, factionId)).contributionsLastMinute).toBe(0);
  });

  it("rejects a revoked viewer key even while another contributor is healthy", async () => {
    await saveApiPoolGrant(2, factionId, contributionKey, preferences);
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ error: { code: 2, error: "Incorrect key" } }));
    vi.stubGlobal("fetch", fetchMock);
    const context = { ownerId: 1, factionId, apiKey: "revoked-viewer-key" };
    await expect(readFactionPoolRequest(context, chainRequest)).rejects.toMatchObject({ code: 2 });
    await expect(readFactionPoolRequest(context, chainRequest)).rejects.toMatchObject({ code: 2 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((await apiPoolStatus(2, factionId)).contributionsLastMinute).toBe(0);
  });

  it("keeps a changed-faction identity invalid even during later cooldowns", async () => {
    const apiKey = "changed-faction-viewer";
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ info: { user: { id: 1, faction_id: 99999, company_id: null }, access: { type: "Public Only", level: 1, faction: false, company: false }, selections: { faction: [], user: [], key: ["info"] } } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyTornIdentity(apiKey, 1, factionId, true)).rejects.toMatchObject({ code: 7 });
    await recordTornFailure("other-key", { ownerId: 1 }, new TornApiError(5, "Limit"));
    await expect(verifyTornIdentity(apiKey, 1, factionId, true)).rejects.toMatchObject({ code: 7 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fences an expired worker from overwriting a newer snapshot", async () => {
    const request = canonicalFactionPoolRequest(chainRequest, factionId);
    const key = `cache:faction:${factionId}:public-v1:${request.path}:`;
    const refresh = async () => {
      await apiStateStore.transact([key], () => ({ result: undefined, changes: { [key]: apiState({ snapshot: { value: chain(99), fetchedAt: now, expiresAt: now + 5_000 } }, now + 60_000) } }));
      return { value: chain(42), fetchedAt: now };
    };
    await expect(readSharedOperation(factionId, request, refresh)).rejects.toMatchObject({ code: 17 });
    const cached = await readSharedOperation(factionId, request, vi.fn());
    expect(cached.value).toEqual(chain(99));
  });

  it("fails closed when state coordination cannot reserve a request", async () => {
    const unavailableStore = { ...apiStateStore, transact: vi.fn(async () => { throw new Error("Shared store unavailable"); }) };
    await expect(reserveTornAttempt("key", { ownerId: 1 }, unavailableStore)).rejects.toThrow("Shared store unavailable");
  });

  it("does not permit a stored grant to change owners during a reservation", async () => {
    await saveApiPoolGrant(2, factionId, contributionKey, preferences);
    const grant = await apiStateStore.read("grant:2") as ApiPoolGrant;
    await apiStateStore.transact(["grant:2"], () => ({ result: undefined, changes: { "grant:2": apiState({ ...grant, ownerId: 99 }) } }));
    await expect(reserveTornAttempt(grant.fingerprint, { ownerId: 2, contribution: { ownerId: 2, factionId, version: grant.version, background: false } })).rejects.toMatchObject({ code: 18 });
  });

  it("cryptographically binds contribution material to its owner and consent", async () => {
    await saveApiPoolGrant(2, factionId, contributionKey, preferences);
    const grant = readPoolGrant(await apiStateStore.read("grant:2"))!;
    expect(decryptApiPoolGrant(grant)).toBe(contributionKey);
    expect(() => decryptApiPoolGrant({ ...grant, ownerId: 99 })).toThrow("consent context");
    expect(() => decryptApiPoolGrant({ ...grant, allowBackground: true })).toThrow("consent context");
    expect(() => decryptApiPoolGrant({ ...grant, limitPerMinute: 30 })).toThrow("consent context");
  });

  it("quarantines corrupt contribution material without blocking the viewer's own reads", async () => {
    await saveApiPoolGrant(2, factionId, contributionKey, preferences);
    const grant = readPoolGrant(await apiStateStore.read("grant:2"))!;
    await apiStateStore.transact(["grant:2"], () => ({ result: undefined, changes: { "grant:2": apiState({ ...grant, encryptedKey: "corrupt-ciphertext" }) } }));
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => new URL(String(input)).pathname.endsWith("/members") ? Response.json(roster()) : Response.json(chain()));
    vi.stubGlobal("fetch", fetchMock);
    await readFactionPoolRequest({ ownerId: 1, factionId, apiKey: "viewer-key" }, chainRequest);
    expect((await apiPoolStatus(2, factionId)).enabled).toBe(false);
    expect(fetchMock.mock.calls.every((call) => (call[1]?.headers as Record<string, string>).Authorization === "ApiKey viewer-key")).toBe(true);
  });
});
