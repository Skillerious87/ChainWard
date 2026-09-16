"use client";

import { useEffect } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { PushNotifications } from "@capacitor/push-notifications";
import { isNativeApp } from "@/lib/is-native-app";
import { notify } from "@/lib/client-actions";

/**
 * Mounted once at the app root (see layout.tsx), not just from the Settings
 * screen where native-push.ts's registration flow lives - a tapped
 * notification needs to deep-link correctly even in a session where the
 * user never opened Settings. No-op outside the Capacitor Android shell.
 *
 * push-fcm.ts already puts a same-origin relative path in the FCM `data.url`
 * field specifically so a tap can route somewhere; without this listener
 * that payload went nowhere and a tap just foregrounded the WebView
 * wherever it already was.
 */
export function NativePushBootstrap() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativeApp()) return;

    const actionHandle = PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      // Same-origin relative path chosen server-side (push-fcm.ts), not a
      // statically-known route - Next's typed-routes checker can't validate
      // it, hence the cast, matching the pattern already used for other
      // runtime-determined destinations (see Route imports elsewhere).
      router.push(safeRelativeUrl(action.notification.data?.url) as Route);
    });

    const receivedHandle = PushNotifications.addListener("pushNotificationReceived", (notification) => {
      notify({
        title: notification.title?.trim() || "ChainWard alert",
        description: notification.body,
        tone: "info",
        dedupeKey: notification.tag,
      });
    });

    return () => {
      void actionHandle.then((handle) => handle.remove());
      void receivedHandle.then((handle) => handle.remove());
    };
  }, [router]);

  return null;
}

/** Mirrors chainward-notifications.js's safeRelativeUrl - only ever navigate within the app. */
function safeRelativeUrl(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") ? value : "/dashboard";
}
