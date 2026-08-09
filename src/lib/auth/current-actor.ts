import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { getConfiguredTornClient } from "@/lib/torn/server-client";
import { PLATFORM_OWNER, type PlatformActor, unauthenticatedActor } from "./platform-owner";

export const getCurrentActor = cache(async (): Promise<PlatformActor> => {
  try {
    await cookies();
    const client = await getConfiguredTornClient();
    if (!client) return unauthenticatedActor();
    const { profile } = await client.getMyProfile();
    return {
      name: profile.name,
      tornUserId: profile.id,
      isPlatformAdmin: profile.id === PLATFORM_OWNER.tornUserId,
    };
  } catch {
    return unauthenticatedActor();
  }
});
