/** A compact, human-readable label for a newly registered passkey - "Unknown device" beats a bare credential ID in a management list. */
export function deriveDeviceLabel(userAgent: string): string {
  const os = /windows/i.test(userAgent) ? "Windows"
    : /iphone/i.test(userAgent) ? "iPhone"
    : /ipad/i.test(userAgent) ? "iPad"
    : /android/i.test(userAgent) ? "Android"
    : /mac ?os/i.test(userAgent) ? "Mac"
    : /linux/i.test(userAgent) ? "Linux"
    : "Unknown device";
  const browser = /edg\//i.test(userAgent) ? "Edge"
    : /chrome|crios/i.test(userAgent) ? "Chrome"
    : /firefox|fxios/i.test(userAgent) ? "Firefox"
    : /safari/i.test(userAgent) ? "Safari"
    : null;
  return browser ? `${os} · ${browser}` : os;
}
