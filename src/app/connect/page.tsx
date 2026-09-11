import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
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
        <section className="login-card" aria-labelledby="login-title">
          <ConnectForm offlineEnabled={offlineTestModeEnabled()} />
        </section>

        <p className="login-legal">
          Independent community software · Not affiliated with Torn
          <span>Torn City · Faction Ops · Secure by Design</span>
        </p>
      </div>
    </main>
  );
}
