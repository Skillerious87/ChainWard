import "server-only";

import { cache } from "react";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import { normalizeTornProfileImageUrl } from "@/lib/torn/profile-image";
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
        profileImageUrl: normalizeTornProfileImageUrl(connection.tornUserImageUrl),
      };
    }

    const detailedProfile = await connection.client.getMyProfileDetails().catch(() => null);
    const profileMatchesConnection = detailedProfile?.profile.id === connection.tornUserId;
    if (profileMatchesConnection) {
      return {
        name: detailedProfile.profile.name,
        tornUserId: detailedProfile.profile.id,
        isPlatformAdmin: detailedProfile.profile.id === PLATFORM_OWNER.tornUserId,
        profileImageUrl: normalizeTornProfileImageUrl(detailedProfile.profile.image),
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
      profileImageUrl: null,
    };
  } catch {
    return unauthenticatedActor();
  }
});
