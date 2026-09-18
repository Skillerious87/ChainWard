"use client";

import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { isNativeApp } from "@/lib/is-native-app";

/** A light tick for routine navigation - bottom-tab switches, a manual refresh trigger. No-ops outside the Capacitor Android shell. */
export function tapHaptic(): void {
  if (!isNativeApp()) return;
  void Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
}

/** A heavier, distinct pulse for a critical alert arriving while the app is already open in the foreground (see native-push-bootstrap.tsx) - critical chain/member alerts otherwise feel identical to routine ones on a device already in hand. */
export function criticalAlertHaptic(): void {
  if (!isNativeApp()) return;
  void Haptics.notification({ type: NotificationType.Warning }).catch(() => undefined);
}
