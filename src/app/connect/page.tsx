import type { Metadata } from "next";
import { Check, ExternalLink, LockKeyhole, Shield, Users } from "lucide-react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { ConnectForm } from "@/components/onboarding/connect-form";

export const metadata: Metadata = { title: "Connect Your Faction" };

export default function ConnectPage() {
  return (
    <main className="connect-page">
      <header className="connect-topbar"><Link href="/dashboard"><BrandMark /></Link><span>Independent Torn community tool</span></header>
      <div className="connect-layout">
        <section className="connect-intro">
          <p className="eyebrow">Secure faction onboarding</p>
          <h1>Bring your chain operations into focus.</h1>
          <p>Connect a restricted Torn API key to validate your identity and faction. We never ask for your password.</p>
          <ul><li><Check size={15} /> Server-side Torn validation</li><li><Check size={15} /> Secure 30-day remembered sign-in</li><li><Check size={15} /> Identity and faction verified with Torn</li></ul>
          <a href="https://www.torn.com/preferences.php#tab=api" target="_blank" rel="noreferrer">Open Torn API settings <ExternalLink size={14} /></a>
        </section>
        <ConnectForm />
      </div>
      <section className="privacy-disclosure">
        <div className="privacy-disclosure__heading"><span><Shield size={20} /></span><div><p className="eyebrow">Required disclosure</p><h2>How we use your Torn API key</h2><p>This summary is intentionally shown where your key is submitted.</p></div></div>
        <div className="privacy-grid">
          <div><span><LockKeyhole size={17} /></span><h3>Session security</h3><strong>Encrypted server-side</strong><p>When remembered, your key is encrypted at rest on the Chainward server. The browser receives only a random HTTP-only session token.</p></div>
          <div><span><Users size={17} /></span><h3>Data sharing</h3><strong>Torn receives the API requests</strong><p>Chainward sends the key only to the Torn API. Operational responses are rendered in your connected workspace.</p></div>
          <div><span><Shield size={17} /></span><h3>Purpose of use</h3><strong>Retrieve verified faction data</strong><p>The server uses the key only for the Torn API selections required by identity, faction, chains, reports, and roster screens.</p></div>
          <div><span><KeyRoundIcon /></span><h3>Operational connection</h3><strong>Revocable remembered access</strong><p>Remembered access expires after 30 days. Disconnecting revokes stored sessions and credentials immediately; the raw key is never returned to browser code.</p></div>
        </div>
        <footer><strong>Required access</strong><span>Public or custom key selections: key/info, user/basic, faction/basic, chain, chains, chainreport, and members.</span></footer>
      </section>
    </main>
  );
}

function KeyRoundIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15 8l2 2m1-5 2 2"/></svg>;
}
