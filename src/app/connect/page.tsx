import type { Metadata } from "next";
import { Activity, ArrowUpRight, Crosshair, LockKeyhole, ShieldCheck, UsersRound, WalletCards } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { ApiKeyHelpDialog } from "@/components/onboarding/api-key-help-dialog";
import { ConnectForm } from "@/components/onboarding/connect-form";
import { ConnectHomeLink } from "@/components/onboarding/connect-home-link";
import { InstallPrompt } from "@/components/onboarding/install-prompt";
import { offlineTestModeEnabled } from "@/lib/torn/offline-fixture";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Connect a restricted Torn API key to open your verified Chainward faction workspace.",
};

export default function ConnectPage() {
  return (
    <main className="connect-page login-page">
      <header className="login-nav">
        <Link href="/" className="login-brand" aria-label="Chainward home">
          <Image src="/icons/android-chrome-192x192.png?v=2" alt="" width={40} height={40} priority />
          <span>Chain<span>ward</span></span>
        </Link>
        <div className="login-nav__actions"><ConnectHomeLink /><ApiKeyHelpDialog /></div>
      </header>
      <div className="login-shell">
        <section className="login-intro" aria-labelledby="login-intro-title">
          <span className="login-eyebrow"><i /> Your faction. Connected.</span>
          <h2 id="login-intro-title">Every chain.<br /><span>Under control.</span></h2>
          <p className="login-intro__description">The clarity to coordinate your faction.<br />The confidence to make every hit count.</p>

          <div className="login-operation" aria-label="Coordinate your members, track every chain, and reward contributions">
            <div className="login-operation__header"><span><Activity size={14} /> Faction command centre</span><span>ONE CONNECTED WORKSPACE</span></div>
            <div className="login-operation__flow">
              <div><span><UsersRound size={24} strokeWidth={1.5} /></span><strong>Coordinate</strong><small>Your people, in sync</small></div>
              <i aria-hidden="true" />
              <div className="login-operation__focus"><span><Crosshair size={26} strokeWidth={1.5} /></span><strong>Track</strong><small>Every chain, in focus</small></div>
              <i aria-hidden="true" />
              <div><span><WalletCards size={24} strokeWidth={1.5} /></span><strong>Reward</strong><small>Every contribution counts</small></div>
            </div>
            <div className="login-operation__footer"><span><ShieldCheck size={13} /> Verified Torn data</span><span>Built around your faction <ArrowUpRight size={13} /></span></div>
          </div>
          <p className="login-intro__note"><LockKeyhole size={15} /> Your key stays private. Your faction stays connected.</p>
        </section>

        <section className="login-card" aria-label="Sign in to Chainward">
          <ConnectForm offlineEnabled={offlineTestModeEnabled()} />
        </section>
      </div>
      <footer className="login-legal"><span>Independent community software · Not affiliated with Torn</span><span><ShieldCheck size={13} /> Secure by design</span></footer>
      <InstallPrompt />
    </main>
  );
}
