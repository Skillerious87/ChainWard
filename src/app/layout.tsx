import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AppearanceBootScript } from "@/components/appearance-boot-script";
import "./globals.css";
import "./polish.css";
import "./shell.css";
import "./onboarding.css";
import "./rewards.css";
import "./admin.css";
import "./settings.css";
import "./chain.css";
import "./history.css";
import "./unlock.css";
import "./members.css";
import "./mobile.css";

/**
 * Inter is self-hosted rather than fetched from a font CDN: local rendering has
 * to work with no internet access, and a third-party font request would leak
 * every page view to another origin. The single variable file covers weights
 * 100-900, so no separate weight files are needed.
 *
 * Licence: SIL Open Font License 1.1 — see `fonts/Inter-LICENSE.txt`.
 */
const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  // globals.css composes this into `--font-inter` with the system fallbacks.
  variable: "--font-inter-sans",
  weight: "100 900",
  style: "normal",
  display: "swap",
  fallback: ["Segoe UI Variable", "Segoe UI", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  applicationName: "Chainward",
  title: {
    default: "Chainward · Faction chain operations",
    template: "%s · Chainward",
  },
  description:
    "A third-party Torn faction chain tracker, reward engine, and payout operations platform.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Chainward",
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#080d0f",
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // `AppearanceBootScript` writes the saved accent and rail width onto this
    // element before React hydrates, which is the whole point of it — so the
    // attributes here will legitimately differ from the server markup.
    <html lang="en" className={inter.variable} data-scroll-behavior="smooth" data-sidebar="expanded" suppressHydrationWarning>
      <body>
        <AppearanceBootScript />
        {children}
      </body>
    </html>
  );
}
