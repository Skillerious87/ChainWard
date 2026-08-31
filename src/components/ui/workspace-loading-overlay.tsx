"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { WorkspaceLoadingScreen } from "./workspace-loading-screen";

const subscribeToClient = () => () => undefined;

/** Renders outside animated or clipped login cards so it truly fills the viewport. */
export function WorkspaceLoadingOverlay({ visible }: { visible: boolean }) {
  const portalReady = useSyncExternalStore(subscribeToClient, () => true, () => false);

  if (!portalReady || !visible) return null;
  return createPortal(<WorkspaceLoadingScreen className="workspace-loading-screen--overlay" />, document.body);
}
