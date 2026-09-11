import "server-only";

import { deploymentOrigin } from "@/lib/metadata/public-origin";

const DEV_FALLBACK_ORIGIN = "http://localhost:3000";

/** Mirrors `layout.tsx`'s localhost fallback for `metadataBase` outside production. */
export function webauthnOrigin(): URL | undefined {
  return deploymentOrigin() ?? (process.env.NODE_ENV === "production" ? undefined : new URL(DEV_FALLBACK_ORIGIN));
}

export function webauthnRpId(): string | undefined {
  return webauthnOrigin()?.hostname;
}
