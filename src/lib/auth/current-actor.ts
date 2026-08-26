import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import { PLATFORM_OWNER, type PlatformActor, unauthenticatedActor } from "./platform-owner";

export const getCurrentActor = cache(async (): Promise<PlatformActor> => {
  try {
    await cookies();
    const connection = await getConfiguredTornConnection();
    if (!connection) return unauthenticatedActor();
    const { profile } = await connection.client.getMyProfile();
    if (profile.id !== connection.tornUserId) return unauthenticatedActor();
    return {
      name: profile.name,
      tornUserId: profile.id,
      isPlatformAdmin: profile.id === PLATFORM_OWNER.tornUserId,
    };
  } catch {
    return unauthenticatedActor();
  }
});
