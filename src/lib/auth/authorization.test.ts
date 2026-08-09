import { describe, expect, it } from "vitest";
import {
  assertTenantScope,
  AuthorizationError,
  hasPermission,
  requirePermission,
} from "./authorization";
import { isPlatformOwner, PLATFORM_OWNER, requirePlatformOwner, unauthenticatedActor } from "./platform-owner";

describe("RBAC", () => {
  it("allows chain managers to process payouts but not edit schemes", () => {
    expect(hasPermission("CHAIN_MANAGER", "payout:manage")).toBe(true);
    expect(hasPermission("CHAIN_MANAGER", "rewards:manage")).toBe(false);
    expect(() => requirePermission("CHAIN_MANAGER", "rewards:manage")).toThrow(
      AuthorizationError,
    );
  });

  it("keeps faction resources tenant scoped", () => {
    expect(() => assertTenantScope("faction-a", "faction-a")).not.toThrow();
    expect(() => assertTenantScope("faction-a", "faction-b")).toThrow(
      AuthorizationError,
    );
  });

  it("restricts platform administration to Skillerious", () => {
    const owner = { name: PLATFORM_OWNER.name, tornUserId: PLATFORM_OWNER.tornUserId, isPlatformAdmin: true };
    const otherAdmin = { name: "Other", tornUserId: 123_456, isPlatformAdmin: true };
    expect(isPlatformOwner(owner)).toBe(true);
    expect(isPlatformOwner(otherAdmin)).toBe(false);
    expect(() => requirePlatformOwner(owner)).not.toThrow();
    expect(() => requirePlatformOwner(otherAdmin)).toThrow(AuthorizationError);
  });

  it("fails closed until a verified owner identity exists", () => {
    expect(isPlatformOwner({ name: PLATFORM_OWNER.name, tornUserId: PLATFORM_OWNER.tornUserId, isPlatformAdmin: true })).toBe(true);
    expect(isPlatformOwner(unauthenticatedActor())).toBe(false);
    expect(() => requirePlatformOwner(unauthenticatedActor())).toThrow(AuthorizationError);
  });
});
