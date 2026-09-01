import "server-only";

interface PublicOriginEnvironment {
  CHAINWARD_PUBLIC_ORIGIN?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
}

/**
 * Returns a canonical origin from deployment-controlled values only. Incoming
 * Host and forwarding headers are deliberately excluded because they are
 * caller-controlled unless a separate trusted-proxy boundary proves otherwise.
 */
export function deploymentOrigin(environment: PublicOriginEnvironment = {
  CHAINWARD_PUBLIC_ORIGIN: process.env.CHAINWARD_PUBLIC_ORIGIN,
  VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
}): URL | undefined {
  const configured = absoluteOrigin(environment.CHAINWARD_PUBLIC_ORIGIN);
  if (configured) return configured;

  // Vercel documents this as the canonical production domain, including in
  // preview builds, specifically for links such as Open Graph image URLs.
  const vercelProductionHost = environment.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (!vercelProductionHost || /[\s/@\\?#]/u.test(vercelProductionHost)) return undefined;
  return absoluteOrigin(`https://${vercelProductionHost}`);
}

function absoluteOrigin(value: string | undefined): URL | undefined {
  const configured = value?.trim();
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    if (
      !(url.protocol === "http:" || url.protocol === "https:")
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash
    ) return undefined;
    return url;
  } catch {
    return undefined;
  }
}
