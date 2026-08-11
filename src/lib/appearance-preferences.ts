"use client";

import { useSyncExternalStore } from "react";

export const accentOptions = ["#91e653", "#59c7f3", "#f0b85a", "#b58cff", "#f07178"] as const;
export type AccentOption = (typeof accentOptions)[number];

export interface AppearancePreferences {
  accent: AccentOption;
  compact: boolean;
  highContrast: boolean;
  reducedEffects: boolean;
  sidebarCollapsed: boolean;
  autoRefresh: boolean;
  refreshIntervalSeconds: 30 | 60 | 120;
  chainWarningSeconds: 60 | 120 | 180 | 300;
}

const storageKey = "chainward:appearance:v1";
const changeEvent = "chainward:appearance";

const defaults: AppearancePreferences = {
  accent: accentOptions[0],
  compact: false,
  highContrast: false,
  reducedEffects: false,
  sidebarCollapsed: false,
  autoRefresh: true,
  refreshIntervalSeconds: 30,
  chainWarningSeconds: 180,
};
let currentSnapshot = defaults;
let snapshotLoaded = false;

export function useAppearancePreferences(): AppearancePreferences {
  return useSyncExternalStore(subscribe, browserSnapshot, () => defaults);
}

export function readAppearancePreferences(): AppearancePreferences {
  if (typeof window === "undefined") return defaults;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    if (!value || typeof value !== "object") return defaults;
    const candidate = value as Partial<AppearancePreferences>;
    return {
      accent: accentOptions.includes(candidate.accent as AccentOption) ? candidate.accent as AccentOption : defaults.accent,
      compact: candidate.compact === true,
      highContrast: candidate.highContrast === true,
      reducedEffects: candidate.reducedEffects === true,
      sidebarCollapsed: candidate.sidebarCollapsed === true,
      autoRefresh: candidate.autoRefresh !== false,
      refreshIntervalSeconds: isRefreshInterval(candidate.refreshIntervalSeconds) ? candidate.refreshIntervalSeconds : defaults.refreshIntervalSeconds,
      chainWarningSeconds: isWarningThreshold(candidate.chainWarningSeconds) ? candidate.chainWarningSeconds : defaults.chainWarningSeconds,
    };
  } catch {
    return defaults;
  }
}

export function saveAppearancePreferences(patch: Partial<AppearancePreferences>): AppearancePreferences {
  const preferences = { ...readAppearancePreferences(), ...patch };
  currentSnapshot = preferences;
  snapshotLoaded = true;
  applyAppearancePreferences(preferences);
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(preferences));
  } catch {
    // The preference still applies to the current page when storage is blocked.
  }
  window.dispatchEvent(new CustomEvent<AppearancePreferences>(changeEvent, { detail: preferences }));
  return preferences;
}

export function applyAppearancePreferences(preferences: AppearancePreferences): void {
  const root = document.documentElement;
  const rgb = hexToRgb(preferences.accent);
  root.classList.toggle("density-compact", preferences.compact);
  root.classList.toggle("high-contrast", preferences.highContrast);
  root.classList.toggle("reduced-motion", preferences.reducedEffects);
  // The rail width is resolved from this attribute so the pre-hydration paint
  // in `AppearanceBootScript` and the hydrated shell always agree.
  root.dataset.sidebar = preferences.sidebarCollapsed ? "collapsed" : "expanded";
  root.style.setProperty("--accent", preferences.accent);
  root.style.setProperty("--accent-strong", preferences.accent);
  root.style.setProperty("--accent-rgb", rgb);
  root.style.setProperty("--accent-soft", `rgba(${rgb}, 0.1)`);
}

export function observeAppearancePreferences(listener: (preferences: AppearancePreferences) => void): () => void {
  function receive(event: Event): void {
    listener((event as CustomEvent<AppearancePreferences>).detail);
  }
  window.addEventListener(changeEvent, receive);
  return () => window.removeEventListener(changeEvent, receive);
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener(changeEvent, onStoreChange);
  return () => window.removeEventListener(changeEvent, onStoreChange);
}

function browserSnapshot(): AppearancePreferences {
  if (!snapshotLoaded) {
    currentSnapshot = readAppearancePreferences();
    snapshotLoaded = true;
  }
  return currentSnapshot;
}

function hexToRgb(value: AccentOption): string {
  const number = Number.parseInt(value.slice(1), 16);
  return `${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}`;
}

function isRefreshInterval(value: unknown): value is AppearancePreferences["refreshIntervalSeconds"] {
  return value === 30 || value === 60 || value === 120;
}

function isWarningThreshold(value: unknown): value is AppearancePreferences["chainWarningSeconds"] {
  return value === 60 || value === 120 || value === 180 || value === 300;
}
