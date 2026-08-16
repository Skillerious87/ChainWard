import type { Metadata } from "next";
import { ArrowLeft, Check, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { ConnectForm } from "@/components/onboarding/connect-form";
import { offlineTestModeEnabled } from "@/lib/torn/offline-fixture";

export const metadata: Metadata = {
  title: "Secure workspace access",
  description: "Connect a restricted Torn API key to open your verified Chainward faction workspace.",
};

const assurances = ["Restricted key only", "No Torn password", "Revoke anytime in Torn"] as const;

export default function ConnectPage() {
  return (
    <main className="connect-page login-page">
      <span className="login-page__glow login-page__glow--left" aria-hidden="true" />
      <span className="login-page__glow login-page__glow--right" aria-hidden="true" />

      <header className="login-topbar">
        <Link href="/" aria-label="Chainward home"><BrandMark /></Link>
        <Link className="login-topbar__back" href="/"><ArrowLeft size={14} /> Back to home</Link>
      </header>

      <section className="login-layout" aria-labelledby="login-title">
        <div className="login-intro">
          <p className="login-intro__eyebrow"><span /> Secure faction access</p>
          <h1 id="login-title">Open your faction workspace.</h1>
          <p className="login-intro__lede">Use a restricted Torn API key to verify your identity and continue to Chainward.</p>

          <div className="login-assurance">
            <span className="login-assurance__icon"><ShieldCheck size={20} /></span>
            <div>
              <strong>Private by design</strong>
              <p>Your key is validated server-side and used only for requests to Torn.</p>
              <ul aria-label="Connection assurances">
                {assurances.map((assurance) => <li key={assurance}><Check size={12} /> {assurance}</li>)}
              </ul>
            </div>
          </div>
        </div>

        <section className="login-card" aria-label="Sign in to Chainward">
          <ConnectForm offlineEnabled={offlineTestModeEnabled()} />
        </section>
      </section>

      <footer className="login-footer">
        <span>Independent Torn community software</span>
        <span>Not affiliated with or endorsed by Torn</span>
      </footer>
    </main>
  );
}
