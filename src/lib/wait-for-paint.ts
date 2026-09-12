/**
 * Resolves after the browser has committed at least one paint, so a state
 * update (e.g. swapping an icon for a spinner) is guaranteed to be visible
 * before a call that can seize the main thread without yielding first — like
 * the native WebAuthn biometric sheet on mobile — starts.
 */
export function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}
