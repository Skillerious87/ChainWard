import "server-only";

import { cache } from "react";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import { PLATFORM_OWNER, type PlatformActor, unauthenticatedActor } from "./platform-owner";

export const getCurrentActor = cache(async (): Promise<PlatformActor> => {
  try {
    const connection = await getConfiguredTornConnection();
    if (!connection) return unauthenticatedActor();
    if (connection.tornUserName) {
      return {
        name: connection.tornUserName,
        tornUserId: connection.tornUserId,
        isPlatformAdmin: connection.tornUserId === PLATFORM_OWNER.tornUserId,
      };
    }

    // Backward compatibility for temporary cookies issued before the verified
    // identity was embedded. New and remembered sessions never spend this
    // extra Torn request on the navigation path.
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
