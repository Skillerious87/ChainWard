"use client";

import { useEffect } from "react";

/** Temporary: confirms whether chainward_passkey_device is actually visible client-side when this page renders. */
export function CookieDebug() {
  useEffect(() => {
    console.warn("[chainward] marketing page document.cookie", document.cookie);
  }, []);
  return null;
}
