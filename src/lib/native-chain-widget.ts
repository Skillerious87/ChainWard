"use client";

import { isNativeApp } from "@/lib/is-native-app";
import type { SafeChainTelemetry, SafeFactionTelemetry } from "@/lib/torn/telemetry-types";

/**
 * Pushes a chain snapshot to the native ChainWidget plugin (see
 * android/app/src/main/java/com/chainward/app/ChainWidgetPlugin.java), which
 * fans it out to both the home-screen widget and the Quick Settings tile.
 * Neither native surface polls anything itself - this is the only path data
 * ever reaches them, so it's called from app-shell.tsx every time the live
 * chain telemetry it already holds changes. A custom local plugin (no npm
 * package), called the same direct way native-splash-hide.tsx already calls
 * AppSplash - there's nothing here a web fallback would mean anything for.
 */
export function syncNativeChainWidget(chain: SafeChainTelemetry | null, faction: SafeFactionTelemetry | null, checkedAt: string): void {
  if (!isNativeApp()) return;
  const update = (window as unknown as {
    Capacitor?: { Plugins?: { ChainWidget?: { update?: (options: Record<string, unknown>) => Promise<void> } } };
  }).Capacitor?.Plugins?.ChainWidget?.update;
  if (!update) return;

  const checkedAtEpochMs = Date.parse(checkedAt);
  const remainingSeconds = chain?.state === "active" ? chain.timeoutSeconds : chain?.state === "cooldown" ? chain.cooldownSeconds : 0;
  const deadlineEpochMs = chain && Number.isFinite(checkedAtEpochMs) ? checkedAtEpochMs + remainingSeconds * 1_000 : 0;

  void update({
    factionName: faction?.name ?? "",
    state: chain?.state ?? "idle",
    current: chain?.current ?? 0,
    maximum: chain?.maximum ?? 0,
    deadlineEpochMs,
    checkedAtEpochMs: Number.isFinite(checkedAtEpochMs) ? checkedAtEpochMs : Date.now(),
  }).catch(() => undefined);
}
