"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { hasAnyPasskeyEnrolledOnThisDevice } from "@/lib/passkey-device-flag";

/**
 * A device with a confirmed passkey never sees the marketing homepage in the
 * first place (proxy.ts redirects it straight here) - "Home" from here would
 * just loop it right back to this same screen. Only a first-time visitor,
 * who actually arrived here *from* that page, has anywhere for it to go.
 */
export function ConnectHomeLink() {
  const [showHomeLink, setShowHomeLink] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setShowHomeLink(!hasAnyPasskeyEnrolledOnThisDevice()));
  }, []);

  if (!showHomeLink) return null;
  return (
    <Link className="login-home" href="/"><ArrowLeft size={14} /> Home</Link>
  );
}
