import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), transact: vi.fn(), revoke: vi.fn(), keyInfo: vi.fn() }));
vi.mock("./api-state-store", () => ({ apiState: (value: unknown) => ({ value }), apiStateStore: { read: mocks.read, transact: mocks.transact } }));
vi.mock("./api-pool-store", () => ({ revokeApiPoolGrant: mocks.revoke }));
vi.mock("./client", () => ({ TornClient: class { getKeyInfo = mocks.keyInfo; } }));

import { verifyTornIdentity } from "./api-identity";
import { TornApiError } from "./errors";
import { withTornRequestScope } from "./request-scope";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockImplementation(async (key: string) => key.startsWith("identity:") ? { ownerId: 1, factionId: 10, verifiedAt: Date.now() } : undefined);
});

describe("request-scoped identity verification", () => {
  it("shares one proof across shell and strict pool callers, then rechecks the next request", async () => {
    await withTornRequestScope(() => Promise.all([
      verifyTornIdentity("test-key", 1, 10, true),
      verifyTornIdentity("test-key", 1, 10),
      verifyTornIdentity("test-key", 1, 10),
    ]));
    expect(mocks.read).toHaveBeenCalledTimes(2);
    await withTornRequestScope(() => verifyTornIdentity("test-key", 1, 10));
    expect(mocks.read).toHaveBeenCalledTimes(4);
  });

  it("never reuses a proof for a different key, owner, faction, or concurrent request", async () => {
    mocks.read.mockResolvedValue(undefined);
    mocks.keyInfo.mockResolvedValue({ info: { user: { id: 1, faction_id: 10 } } });
    await Promise.all([
      withTornRequestScope(() => Promise.all([verifyTornIdentity("first", 1, 10), verifyTornIdentity("second", 1, 10)])),
      withTornRequestScope(() => verifyTornIdentity("first", 1, 10)),
    ]);
    expect(mocks.keyInfo).toHaveBeenCalledTimes(3);
    await withTornRequestScope(async () => {
      await verifyTornIdentity("first", 1, 10);
      await expect(verifyTornIdentity("first", 2, 10)).rejects.toMatchObject({ code: 7 });
      await expect(verifyTornIdentity("first", 1, 20)).rejects.toMatchObject({ code: 7 });
    });
  });

  it("does not turn a tolerated shell outage into pool authorization", async () => {
    mocks.read.mockRejectedValue(new Error("Database unavailable"));
    await withTornRequestScope(async () => {
      await expect(verifyTornIdentity("key", 1, 10, true)).resolves.toBeUndefined();
      await expect(verifyTornIdentity("key", 1, 10)).rejects.toThrow("Database unavailable");
    });
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it("rejects and revokes invalid credentials even for outage-tolerant callers", async () => {
    mocks.read.mockImplementation(async (key: string) => key.startsWith("credential:") ? { disabled: true, errorCode: 18 } : undefined);
    await withTornRequestScope(async () => {
      const results = await Promise.allSettled([verifyTornIdentity("key", 1, 10, true), verifyTornIdentity("key", 1, 10)]);
      expect(results.every((result) => result.status === "rejected" && result.reason instanceof TornApiError)).toBe(true);
    });
    expect(mocks.transact).toHaveBeenCalledOnce();
    expect(mocks.revoke).toHaveBeenCalledWith(1, 10);
    expect(mocks.keyInfo).not.toHaveBeenCalled();
  });
});
