import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { isPlatformOwner } from "@/lib/auth/platform-owner";

/**
 * Route-wide owner boundary. Individual pages retain their own check and every
 * server mutation checks again; this layout prevents a future admin child route
 * from accidentally shipping without the same deny-by-default policy.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  if (!isPlatformOwner(await getCurrentActor())) notFound();
  return children;
}
