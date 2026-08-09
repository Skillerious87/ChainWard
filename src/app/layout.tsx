import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "./polish.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  title: {
    default: "Chainward · Faction chain operations",
    template: "%s · Chainward",
  },
  description:
    "A third-party Torn faction chain tracker, reward engine, and payout operations platform.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0b0d0f",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${inter.className}`} data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
