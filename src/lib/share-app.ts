"use client";

import { Share } from "@capacitor/share";
import { notify } from "@/lib/client-actions";
import { isNativeApp } from "@/lib/is-native-app";

const SHARE_TITLE = "Chainward";
const SHARE_TEXT = "Faction chain operations, reward calculations, and payout records in one verified workspace.";

/**
 * Native share sheet on Android, the Web Share API where a browser supports
 * it, and a clipboard-copy fallback everywhere else - each surface already
 * gives its own feedback (the share sheet itself, the OS toast on copy) so
 * only the clipboard fallback needs an in-app toast.
 */
export async function shareChainward(): Promise<void> {
  const url = window.location.origin;
  if (isNativeApp()) {
    await Share.share({ title: SHARE_TITLE, text: SHARE_TEXT, url, dialogTitle: "Share Chainward" }).catch(() => undefined);
    return;
  }
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  await navigator.clipboard.writeText(url);
  notify({ title: "Link copied", description: url, tone: "success" });
}
