import type { NextConfig } from "next";

const development = process.env.NODE_ENV !== "production";
const serverActionAllowedOrigins = (process.env.CHAINWARD_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .flatMap((value) => {
    try { return [new URL(value).host]; }
    catch { return []; }
  });
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://profileimages.torn.com",
  "font-src 'self' data:",
  `connect-src 'self'${development ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "profileimages.torn.com", pathname: "/**" }],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "256kb",
      ...(serverActionAllowedOrigins.length ? { allowedOrigins: serverActionAllowedOrigins } : {}),
    },
  },
  // `scripts/verify-offline.mjs` sets this so its throwaway server can run
  // beside a development server already using the default `.next` directory.
  ...(process.env.CHAINWARD_DIST_DIR ? { distDir: process.env.CHAINWARD_DIST_DIR } : {}),
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
        ...(development ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
      ],
    }];
  },
};

export default nextConfig;
