import { AuthorizationError } from "./authorization";

export const PLATFORM_OWNER = {
  name: "Skillerious",
  tornUserId: 3_212_954,
  profileUrl: "https://www.torn.com/profiles.php?XID=3212954",
} as const;

export interface PlatformActor {
  name: string;
  tornUserId: number;
  isPlatformAdmin: boolean;
  profileImageUrl?: string | null;
}

export function unauthenticatedActor(): PlatformActor {
  return { name: "Not connected", tornUserId: 0, isPlatformAdmin: false, profileImageUrl: null };
}

export function isPlatformOwner(actor: PlatformActor): boolean {
  return actor.isPlatformAdmin && actor.tornUserId === PLATFORM_OWNER.tornUserId;
}

export function requirePlatformOwner(actor: PlatformActor): void {
  if (!isPlatformOwner(actor)) {
    throw new AuthorizationError("Platform administration is restricted to Skillerious.");
  }
}
