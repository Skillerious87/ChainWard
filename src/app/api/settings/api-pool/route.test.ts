import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ scope: vi.fn(), mayUsePool: vi.fn() }));
vi.mock("@/lib/torn/current-connection-scope", () => ({ currentConnectionScope: mocks.scope }));
vi.mock("@/lib/torn/api-pool-broker", () => ({ mayUseFactionPool: mocks.mayUsePool }));
vi.mock("@/lib/security/rate-limit", () => ({ consumePartitionRateLimit: () => ({ allowed: true }) }));

import { DELETE, GET, PUT } from "./route";
import { apiPoolStatus } from "@/lib/torn/api-pool-store";

const key = "ABCD1234EFGH5678";
const scope = { apiKey: "own-login-key", tornUserId: 1, tornFactionId: 51393, keyFingerprint: "verified-login" };
const consent = { apiKey: key, limitPerMinute: 5, allowOffline: false, allowBackground: false, acceptContribution: true, policyVersion: 1 };

function request(body: unknown, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/settings/api-pool", { method: "PUT", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}

function identity(ownerId = 1, factionId = 51393, access = "Public Only") {
  return { info: { user: { id: ownerId, faction_id: factionId, company_id: null }, access: { type: access, level: 1, faction: false, company: false }, selections: { user: ["basic", "profile"], faction: ["basic", "chain", "chains", "members", "chainreport"], key: ["info"] } } };
}

describe.sequential("API pool settings boundary", () => {
  let directory = "";

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "chainward-pool-route-"));
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("CHAINWARD_APP_DATA_DIR", path.join(directory, "appdata"));
    vi.stubEnv("CHAINWARD_LOCAL_DB_PATH", path.join(directory, "workspace.sqlite"));
    vi.stubEnv("API_KEY_ENCRYPTION_SECRET", Buffer.alloc(32, 4).toString("base64"));
    mocks.scope.mockResolvedValue(scope);
    mocks.mayUsePool.mockResolvedValue(true);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(identity())));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    if (!path.resolve(directory).startsWith(path.join(path.resolve(tmpdir()), "chainward-pool-route-"))) throw new Error("Unexpected test directory.");
    rmSync(directory, { recursive: true, force: true });
  });

  it("keeps existing users unenrolled and requires a session", async () => {
    expect(await (await GET()).json()).toMatchObject({ enabled: false, lastFour: null });
    mocks.scope.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await PUT(request(consent))).status).toBe(401);
  });

  it("rejects cross-origin changes and missing consent before using a key", async () => {
    expect((await PUT(request(consent, "https://untrusted.example"))).status).toBe(403);
    expect((await PUT(request({ ...consent, acceptContribution: false }))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts the user's public key without returning or exposing it", async () => {
    const response = await PUT(request(consent));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ enabled: true, lastFour: "5678", limitPerMinute: 5, allowOffline: false });
    expect(JSON.stringify(payload)).not.toContain(key);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses full-access keys and keys for another faction", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(identity(1, 51393, "Full Access"))));
    expect((await PUT(request(consent))).status).toBe(400);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(identity(1, 99999))));
    expect((await PUT(request(consent))).status).toBe(403);
    expect((await apiPoolStatus(1, 51393)).enabled).toBe(false);
  });

  it("refuses another player's key and client-supplied identity fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(identity(999))));
    expect((await PUT(request(consent))).status).toBe(400);
    expect((await PUT(request({ ...consent, ownerId: 999 }))).status).toBe(400);
    expect((await apiPoolStatus(1, 51393)).enabled).toBe(false);
  });

  it("allows opt-out even after faction access is removed", async () => {
    expect((await PUT(request(consent))).status).toBe(200);
    mocks.mayUsePool.mockResolvedValue(false);
    const response = await DELETE(new Request("http://localhost:3000/api/settings/api-pool", { method: "DELETE", headers: { origin: "http://localhost:3000" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: false, lastFour: null });
  });

  it("requires offline permission before authorising background calls", async () => {
    expect((await PUT(request({ ...consent, allowBackground: true }))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
