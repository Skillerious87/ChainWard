import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { ConnectForm } from "@/components/onboarding/connect-form";
import { LoginBackdrop } from "@/components/onboarding/login-backdrop";
import { offlineTestModeEnabled } from "@/lib/torn/offline-fixture";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Connect a restricted Torn API key to open your verified Chainward faction workspace.",
};

export default function ConnectPage() {
  return (
    <main className="connect-page login-page">
      <LoginBackdrop />

      <Link className="login-home" href="/"><ArrowLeft size={14} /> Home</Link>

      <div className="login-shell">
        <Link className="login-brand" href="/" aria-label="Chainward home"><BrandMark /></Link>

        <section className="login-card" aria-labelledby="login-title">
          <ConnectForm offlineEnabled={offlineTestModeEnabled()} />
        </section>

        <p className="login-legal">Independent community software · Not affiliated with Torn</p>
      </div>
    </main>
  );
}
