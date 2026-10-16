import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/auth/authorization";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), addressLimit: vi.fn(), actorLimit: vi.fn(), bestTarget: vi.fn() }));
vi.mock("@/lib/auth/faction-authorization", () => ({ requireFactionPermission: mocks.permission }));
vi.mock("@/lib/security/rate-limit", () => ({ consumeRateLimit: mocks.addressLimit, consumePartitionRateLimit: mocks.actorLimit }));
vi.mock("@/lib/targets/best-target", () => ({ getBestChainTarget: mocks.bestTarget }));

import { GET } from "./route";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.permission.mockResolvedValue({ actor: { tornUserId: 999 } });
  mocks.addressLimit.mockReturnValue({ allowed: true });
  mocks.actorLimit.mockReturnValue({ allowed: true });
  mocks.bestTarget.mockResolvedValue({ target: null, targetCount: 2 });
});
const request = () => new Request("http://localhost/api/targets/next");

describe("next-target endpoint", () => {
  it("requires faction access and returns an uncached personal recommendation", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.permission).toHaveBeenCalledWith("faction:view");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ target: null, targetCount: 2 });
  });

  it("does not fetch personal targets for an unauthorised request", async () => {
    mocks.permission.mockRejectedValue(new AuthorizationError("No faction access"));
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(mocks.bestTarget).not.toHaveBeenCalled();
  });

  it.each(["addressLimit", "actorLimit"] as const)("bounds polling with the %s", async (limit) => {
    mocks[limit].mockReturnValue({ allowed: false, retryAfterSeconds: 12 });
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("12");
    expect(mocks.bestTarget).not.toHaveBeenCalled();
  });

  it("does not expose upstream or credential details on failure", async () => {
    mocks.bestTarget.mockRejectedValue(new Error("private upstream details"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private upstream details");
  });
});
