export type FactionRole =
  | "OWNER"
  | "ADMINISTRATOR"
  | "CHAIN_MANAGER"
  | "VIEWER";

/** The roles an operator can actually be assigned. OWNER is never assignable. */
export type ManagedRole = Exclude<FactionRole, "OWNER">;

export type Permission =
  | "faction:view"
  | "chain:manage"
  | "payout:manage"
  | "rewards:manage"
  | "members:manage"
  | "access:manage"
  | "api:manage"
  | "faction:backup"
  | "faction:manage";

export interface PermissionDescriptor {
  permission: Permission;
  label: string;
  detail: string;
}

/**
 * The permission catalogue is the single source of truth for both enforcement
 * and the role policy screen. Rendering the interface from the same table the
 * server checks means a role can never advertise a capability it does not have.
 */
export const permissionCatalogue: readonly PermissionDescriptor[] = [
  { permission: "faction:view", label: "View workspace", detail: "Read every operational screen for the connected faction." },
  { permission: "chain:manage", label: "Chains", detail: "Operate live chains and record chain outcomes." },
  { permission: "payout:manage", label: "Payouts", detail: "Acknowledge payouts and close settled chains." },
  { permission: "rewards:manage", label: "Rewards", detail: "Create and version reward schemes." },
  { permission: "members:manage", label: "Members", detail: "Manage member activity, reports, awards, and alert thresholds." },
  { permission: "access:manage", label: "Access", detail: "Review sign-in requests and manage faction-scoped application roles." },
  { permission: "faction:backup", label: "Backup", detail: "Download a portable faction configuration backup." },
  { permission: "faction:manage", label: "Restore", detail: "Overwrite workspace configuration from a backup file." },
  { permission: "api:manage", label: "API credential", detail: "Replace the stored Torn API credential." },
];

const rolePermissions: Readonly<Record<FactionRole, ReadonlySet<Permission>>> = {
  OWNER: new Set([
    "faction:view",
    "chain:manage",
    "payout:manage",
    "rewards:manage",
    "members:manage",
    "access:manage",
    "faction:backup",
    "faction:manage",
    "api:manage",
  ]),
  // Deliberately narrower than OWNER. A delegated administrator runs faction
  // operations, but restoring a backup overwrites workspace configuration and
  // replacing the stored credential changes who the workspace authenticates
  // as — both stay with the verified owner.
  ADMINISTRATOR: new Set([
    "faction:view",
    "chain:manage",
    "payout:manage",
    "rewards:manage",
    "members:manage",
    "access:manage",
    "faction:backup",
  ]),
  CHAIN_MANAGER: new Set(["faction:view", "chain:manage", "payout:manage"]),
  VIEWER: new Set(["faction:view"]),
};

export interface RoleDefinition {
  role: ManagedRole;
  label: string;
  description: string;
  permissions: readonly PermissionDescriptor[];
}

export const roleDefinitions: readonly RoleDefinition[] = [
  { role: "ADMINISTRATOR", label: "Administrator", description: "Runs faction operations, reviews member access, and can export a configuration backup.", permissions: descriptorsFor("ADMINISTRATOR") },
  { role: "CHAIN_MANAGER", label: "Chain manager", description: "Operates live chains and acknowledges payouts.", permissions: descriptorsFor("CHAIN_MANAGER") },
  { role: "VIEWER", label: "Viewer", description: "Reads faction operations without changing anything.", permissions: descriptorsFor("VIEWER") },
];

export function roleLabel(role: FactionRole): string {
  if (role === "OWNER") return "Owner";
  return roleDefinitions.find((definition) => definition.role === role)?.label ?? role;
}

export function hasPermission(role: FactionRole, permission: Permission): boolean {
  return rolePermissions[role].has(permission);
}

export function requirePermission(role: FactionRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new AuthorizationError(`Your ${roleLabel(role).toLowerCase()} role does not include this action.`);
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

function descriptorsFor(role: FactionRole): readonly PermissionDescriptor[] {
  return permissionCatalogue.filter((descriptor) => rolePermissions[role].has(descriptor.permission));
}
