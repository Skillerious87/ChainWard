import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, Check, CircleCheckBig, ExternalLink, KeyRound, LockKeyhole, Server, Shield, ShieldCheck, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { ConnectForm } from "@/components/onboarding/connect-form";
import { offlineTestModeEnabled } from "@/lib/torn/offline-fixture";

export const metadata: Metadata = { title: "Connect Your Faction" };

export default function ConnectPage() {
  return (
    <main className="connect-page onboarding-page">
      <span className="onboarding-page__aurora onboarding-page__aurora--one" aria-hidden="true" />
      <span className="onboarding-page__aurora onboarding-page__aurora--two" aria-hidden="true" />
      <header className="connect-topbar onboarding-topbar">
        <Link href="/" aria-label="Chainward home"><BrandMark /></Link>
        <nav className="onboarding-steps" aria-label="Onboarding progress">
          <span><b>01</b> Connect</span><i />
          <span><b>02</b> Verify</span><i />
          <span><b>03</b> Workspace</span>
        </nav>
        <div className="onboarding-topbar__trust"><ShieldCheck size={15} /><span><strong>Private by design</strong><small>Independent Torn community tool</small></span></div>
      </header>

      {/* The supporting steps are a sibling of the form rather than a child of
          the intro so that a narrow viewport can show headline → form → detail
          without burying the key field below a screen of explanation. */}
      <section className="onboarding-hero">
        <div className="connect-intro onboarding-intro">
          <div className="onboarding-intro__badge"><Sparkles size={13} /><span>Secure setup in about two minutes</span></div>
          <h1>Your faction’s command centre <span>starts here.</span></h1>
          <p className="onboarding-intro__lede">Connect a restricted Torn API key and Chainward builds a verified workspace around your faction — clear, calm, and ready for the next chain.</p>
        </div>

        <aside className="onboarding-form-shell" aria-label="Secure Torn connection">
          <div className="onboarding-form-shell__topline"><span>Secure faction onboarding</span><em><LockKeyhole size={12} /> Protected connection</em></div>
          <ConnectForm offlineEnabled={offlineTestModeEnabled()} />
          <footer><Server size={15} /><p><strong>Validated server-side</strong><small>The key is sent directly to Chainward over your secure connection, then used only with Torn.</small></p></footer>
        </aside>

        <div className="onboarding-support">
          <ol className="onboarding-journey" aria-label="Three-step connection process">
            <li>
              <span className="onboarding-journey__marker"><KeyRound size={15} /></span>
              <div><small>Step 01</small><strong>Paste a restricted key</strong><p>Limited Access is enough. Your Torn password is never needed and never asked for.</p></div>
            </li>
            <li>
              <span className="onboarding-journey__marker"><CircleCheckBig size={15} /></span>
              <div><small>Step 02</small><strong>Chainward verifies it</strong><p>Your identity, faction, and every required API selection are confirmed with Torn before anything opens.</p></div>
            </li>
            <li>
              <span className="onboarding-journey__marker"><ArrowRight size={15} /></span>
              <div><small>Step 03</small><strong>Your workspace opens</strong><p>Only verified operational data is shown. Nothing is estimated and nothing is invented.</p></div>
            </li>
          </ol>

          <div className="onboarding-intro__footer">
            <p><ShieldCheck size={16} /><span><strong>No password. No guesswork.</strong><small>Your raw key never returns to browser code.</small></span></p>
            <a href="https://www.torn.com/preferences.php#tab=api" target="_blank" rel="noreferrer">Open Torn API settings <ExternalLink size={14} /></a>
          </div>
        </div>
      </section>

      <section className="privacy-disclosure onboarding-disclosure">
        <div className="privacy-disclosure__heading onboarding-disclosure__heading"><span><Shield size={20} /></span><div><p className="eyebrow">Transparent by default</p><h2>Your key stays yours.</h2><p>Here is exactly what happens when you connect—no vague security claims and no hidden use.</p></div></div>
        <div className="privacy-grid onboarding-privacy-grid">
          <div><span><LockKeyhole size={18} /></span><em>01</em><h3>Session security</h3><strong>Encrypted server-side</strong><p>When remembered, your key is encrypted at rest. This browser receives only a random HTTP-only session token.</p></div>
          <div><span><Users size={18} /></span><em>02</em><h3>Data sharing</h3><strong>Only Torn receives requests</strong><p>Chainward sends the key only to the Torn API. Verified responses are rendered inside your connected workspace.</p></div>
          <div><span><Shield size={18} /></span><em>03</em><h3>Purpose of use</h3><strong>Verified faction operations</strong><p>The key is used only for identity, faction, chain, report, history, and roster selections required by the app.</p></div>
          <div><span><KeyRound size={18} /></span><em>04</em><h3>Your control</h3><strong>Revocable remembered access</strong><p>Remembered access expires after 30 days. Disconnecting immediately revokes stored sessions and credentials.</p></div>
        </div>
        <footer><strong><Check size={13} /> Required access</strong><span>Public or custom key selections: key/info, user/basic, faction/basic, chain, chains, chainreport, and members.</span></footer>
      </section>

      <footer className="onboarding-footer"><Link href="/"><ArrowLeft size={13} /> Back to Chainward</Link><span>Built for Torn faction leaders who value clarity.</span></footer>
    </main>
  );
}
