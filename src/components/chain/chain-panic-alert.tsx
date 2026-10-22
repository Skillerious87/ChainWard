"use client";

import { Siren } from "lucide-react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useLiveWorkspaceTelemetry } from "@/components/shell/live-workspace-telemetry";
import { saveAppearancePreferences, useAppearancePreferences } from "@/lib/appearance-preferences";

const subscribeToClient = () => () => undefined;

/** The persistent shell keeps the warning available on every workspace page. */
export function ChainPanicAlert() {
  const { telemetry, seconds } = useLiveWorkspaceTelemetry();
  const { chainPanicMode } = useAppearancePreferences();
  const mounted = useSyncExternalStore(subscribeToClient, () => true, () => false);
  if (!mounted || !chainPanicMode || telemetry.chain?.state !== "active" || seconds <= 0 || seconds > 60) return null;

  return createPortal(
    <div className="chain-panic-alert" role="status">
      <span><Siren size={18} aria-hidden="true" /> Chain timeout: 60 seconds or less remaining
        <button type="button" onClick={() => saveAppearancePreferences({ chainPanicMode: false })}>Turn off panic mode</button>
      </span>
    </div>,
    document.body,
  );
}
