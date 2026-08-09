export type FactionRole =
  | "OWNER"
  | "ADMINISTRATOR"
  | "CHAIN_MANAGER"
  | "VIEWER";

export type Permission =
  | "faction:view"
  | "chain:manage"
  | "payout:manage"
  | "rewards:manage"
  | "members:manage"
  | "api:manage"
  | "faction:manage";

const rolePermissions: Readonly<Record<FactionRole, ReadonlySet<Permission>>> = {
  OWNER: new Set([
    "faction:view",
    "chain:manage",
    "payout:manage",
    "rewards:manage",
    "members:manage",
    "api:manage",
    "faction:manage",
  ]),
  ADMINISTRATOR: new Set([
    "faction:view",
    "chain:manage",
    "payout:manage",
    "rewards:manage",
    "members:manage",
    "api:manage",
    "faction:manage",
  ]),
  CHAIN_MANAGER: new Set(["faction:view", "chain:manage", "payout:manage"]),
  VIEWER: new Set(["faction:view"]),
};

export function hasPermission(role: FactionRole, permission: Permission): boolean {
  return rolePermissions[role].has(permission);
}

export function requirePermission(role: FactionRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new AuthorizationError("You do not have permission to perform this action.");
  }
}

export function assertTenantScope(
  sessionFactionId: string,
  resourceFactionId: string,
): void {
  if (sessionFactionId !== resourceFactionId) {
    throw new AuthorizationError("The requested resource belongs to another faction.");
  }
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}
