import { describe, expect, it } from "vitest";
import {
  assertTenantScope,
  AuthorizationError,
  hasPermission,
  permissionCatalogue,
  requirePermission,
  roleDefinitions,
  roleLabel,
  type FactionRole,
  type Permission,
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

describe("role policy", () => {
  it("keeps a delegated administrator strictly below the owner", () => {
    const ownerOnly: Permission[] = ["faction:manage", "api:manage"];
    for (const permission of ownerOnly) {
      expect(hasPermission("OWNER", permission)).toBe(true);
      expect(hasPermission("ADMINISTRATOR", permission)).toBe(false);
    }
  });

  it("lets an administrator export a backup but not overwrite the workspace", () => {
    expect(hasPermission("ADMINISTRATOR", "faction:backup")).toBe(true);
    expect(hasPermission("ADMINISTRATOR", "access:manage")).toBe(true);
    expect(hasPermission("CHAIN_MANAGER", "access:manage")).toBe(false);
    expect(hasPermission("ADMINISTRATOR", "faction:manage")).toBe(false);
    expect(() => requirePermission("ADMINISTRATOR", "faction:manage")).toThrow(AuthorizationError);
  });

  it("never lets a lower role hold a permission its senior role lacks", () => {
    const ordered: FactionRole[] = ["VIEWER", "CHAIN_MANAGER", "ADMINISTRATOR", "OWNER"];
    for (let index = 1; index < ordered.length; index += 1) {
      const junior = ordered[index - 1]!;
      const senior = ordered[index]!;
      for (const { permission } of permissionCatalogue) {
        if (hasPermission(junior, permission)) expect(hasPermission(senior, permission)).toBe(true);
      }
    }
  });

  it("publishes exactly the permissions each assignable role is granted", () => {
    expect(roleDefinitions.map((definition) => definition.role)).toEqual(["ADMINISTRATOR", "CHAIN_MANAGER", "VIEWER"]);
    for (const definition of roleDefinitions) {
      for (const { permission } of permissionCatalogue) {
        const advertised = definition.permissions.some((descriptor) => descriptor.permission === permission);
        expect(advertised).toBe(hasPermission(definition.role, permission));
      }
    }
  });

  it("never publishes the owner role as assignable", () => {
    expect(roleDefinitions.some((definition) => (definition.role as FactionRole) === "OWNER")).toBe(false);
    expect(roleLabel("OWNER")).toBe("Owner");
    expect(roleLabel("CHAIN_MANAGER")).toBe("Chain manager");
  });
});
