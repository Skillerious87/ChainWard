import type { Metadata } from "next";
import { ArrowLeft, Check, KeyRound, ServerCog, ShieldCheck, UsersRound } from "lucide-react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { ConnectForm } from "@/components/onboarding/connect-form";
import { offlineTestModeEnabled } from "@/lib/torn/offline-fixture";

export const metadata: Metadata = {
  title: "Secure workspace access",
  description: "Connect a restricted Torn API key to open your verified Chainward faction workspace.",
};

const connectionSteps = [
  { icon: KeyRound, title: "Restricted key", detail: "Limited Access is enough; your Torn password is never used." },
  { icon: ServerCog, title: "Server-side check", detail: "The key is encrypted and validated away from browser code." },
  { icon: UsersRound, title: "Faction-scoped entry", detail: "You enter only the verified workspace attached to your identity." },
] as const;

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
          <p className="login-intro__eyebrow"><span /> Protected access, clearly explained</p>
          <h1 id="login-title">Enter your faction command centre.</h1>
          <p className="login-intro__lede">One restricted Torn key verifies who you are, identifies your faction, and opens the right workspace without ever asking for your Torn password.</p>

          <div className="login-assurance">
            <header><span className="login-assurance__icon"><ShieldCheck size={20} /></span><p><small>How sign in works</small><strong>Three checks. One protected workspace.</strong></p></header>
            <ol aria-label="Secure connection steps">
              {connectionSteps.map(({ icon: Icon, title, detail }, index) => <li key={title}><span><Icon size={15} /></span><p><strong>{title}</strong><small>{detail}</small></p><em>{index + 1}</em><Check size={13} /></li>)}
            </ol>
          </div>
        </div>

        <section className="login-card" aria-label="Sign in to Chainward">
          <ConnectForm offlineEnabled={offlineTestModeEnabled()} />
        </section>
      </section>

      <footer className="login-footer">
        <span>Encrypted server-side. Scoped to one faction. Revocable in Torn.</span>
        <span>Independent community software. Not affiliated with Torn.</span>
      </footer>
    </main>
  );
}
