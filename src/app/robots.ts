import type { MetadataRoute } from "next";

const privateRoutes = [
  "/admin",
  "/analytics",
  "/api/",
  "/chains",
  "/dashboard",
  "/faction",
  "/live-chain",
  "/members",
  "/payouts",
  "/rewards",
  "/settings",
  "/unlock",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: ["/", "/connect"],
      disallow: privateRoutes,
    }],
  };
}
