import type { Metadata } from "next";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BadgeCheck,
  CalendarCheck2,
  CalendarDays,
  Check,
  CircleDollarSign,
  Clock3,
  Crown,
  Fingerprint,
  LockKeyhole,
  Pill,
  ShieldCheck,
  Sparkles,
  Users,
  WalletCards,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { LoginBackdrop } from "@/components/onboarding/login-backdrop";
import { licensePlans } from "@/lib/licensing/pricing";

export const metadata: Metadata = {
  title: "Faction operations, beautifully organised",
  description: "Bring Torn chain tracking, faction analytics, rewards, payouts, and member access into one protected operations workspace.",
  alternates: { canonical: "/" },
};

const capabilities = [
  { icon: Activity, label: "Live operations", detail: "Follow chain state, timeout pressure, pace, and current progress from one focused view." },
  { icon: BarChart3, label: "Useful intelligence", detail: "Turn verified chain and roster activity into decisions your leadership can act on." },
  { icon: CircleDollarSign, label: "Reward clarity", detail: "Build versioned reward schemes and preserve exactly how every payout was calculated." },
  { icon: Users, label: "Controlled access", detail: "Give approved faction members the right workspace role with an auditable history." },
] as const;

const assurances = [
  [ShieldCheck, "Verified by Torn", "Operational facts come from the Torn API, with unavailable states shown honestly."],
  [LockKeyhole, "Faction scoped", "Identity, permissions, licences, and saved records stay tied to the verified faction."],
  [WalletCards, "Human controlled", "Chainward records decisions; it never pretends that an in-game transfer happened automatically."],
] as const;

const pricingPresentation = [
  { icon: Clock3, eyebrow: "Flexible start", feature: "A low-commitment way to open the complete workspace." },
  { icon: CalendarDays, eyebrow: "Most popular", feature: "Three months of calm operations with a built-in saving." },
  { icon: CalendarCheck2, eyebrow: "Best recurring value", feature: "A full year for established faction leadership teams." },
  { icon: Sparkles, eyebrow: "Permanent access", feature: "One approval, no renewal date, and every future release." },
] as const;

export default function HomePage() {
  return (
    <main className="welcome-page">
      <LoginBackdrop />

      <header className="welcome-nav">
        <Link href="/" aria-label="Chainward home"><BrandMark /></Link>
        <nav aria-label="Welcome page">
          <a href="#capabilities">Capabilities</a>
          <a href="#pricing">Pricing</a>
          <a href="#assurance">Built with care</a>
          <Link href="/connect">Connect</Link>
        </nav>
        <Link className="welcome-nav__workspace" href="/dashboard">Open workspace <ArrowRight size={14} /></Link>
      </header>

      <section className="welcome-hero">
        <div className="welcome-hero__copy">
          <div className="welcome-signal"><span><i /> Torn faction operations</span><small>Independent community platform</small></div>
          <p className="welcome-kicker"><Sparkles size={14} /> One calm place for the work behind every chain</p>
          <h1>Run your faction with <span>clarity.</span></h1>
          <p className="welcome-lead">Chainward brings live chain awareness, member intelligence, reward policy, and payout records into one protected workspace—so your team can operate without the spreadsheet sprawl.</p>
          <div className="welcome-actions">
            <Link className="button button--primary welcome-primary-action" href="/connect">Connect your faction <ArrowRight size={16} /></Link>
            <Link className="welcome-secondary-action" href="/dashboard"><span><Zap size={15} /></span><p><strong>Already connected?</strong><small>Enter your command centre</small></p><ArrowRight size={14} /></Link>
          </div>
          <div className="welcome-proof" aria-label="Platform assurances">
            <span><Check size={13} /> Restricted Torn key</span>
            <span><Check size={13} /> No Torn password</span>
            <span><Check size={13} /> No fabricated data</span>
          </div>
        </div>

        <div className="welcome-preview" aria-label="Illustrative Chainward workspace interface preview">
          <div className="welcome-preview__halo" />
          <div className="welcome-console">
            <header>
              <div><span className="welcome-console__mark"><Crown size={17} /></span><p><strong>Faction command</strong><small>Interface preview</small></p></div>
              <em><i /> Product preview</em>
            </header>
            <div className="welcome-console__chain">
              <div className="welcome-console__title"><span><Activity size={13} /> Active chain</span><small>#58410291</small></div>
              <div className="welcome-console__count"><strong>742</strong><span>/ 1,000</span><em>74.2%</em></div>
              <div className="welcome-console__progress"><i /></div>
              <div className="welcome-console__labels"><span>Current progress</span><strong>258 hits to target</strong></div>
            </div>
            <div className="welcome-console__metrics">
              <article><span><Clock3 size={15} /></span><p><small>Timeout</small><strong>03:42</strong></p><em>Stable</em></article>
              <article><span><Users size={15} /></span><p><small>Contributors</small><strong>28</strong></p><em>Live</em></article>
              <article><span><BarChart3 size={15} /></span><p><small>Current pace</small><strong>91.4/hr</strong></p><em>+8.2%</em></article>
            </div>
            <footer><span><Fingerprint size={13} /> Verified data boundary</span><small>Illustrative values</small></footer>
          </div>
          <div className="welcome-float-card welcome-float-card--access"><ShieldCheck size={16} /><p><strong>Protected access</strong><small>Faction identity verified</small></p><Check size={13} /></div>
          <div className="welcome-float-card welcome-float-card--reward"><CircleDollarSign size={16} /><p><strong>Reward policy ready</strong><small>Version 4 · history locked</small></p></div>
        </div>
      </section>

      <section className="welcome-capabilities" id="capabilities">
        <header><div><p className="eyebrow">Designed for serious faction operations</p><h2>Everything important, without the noise.</h2></div><p>Purpose-built surfaces keep live Torn facts, leadership decisions, and saved records distinct and understandable.</p></header>
        <div>{capabilities.map(({ icon: Icon, label, detail }, index) => <article key={label}><span><Icon size={19} /></span><em>0{index + 1}</em><h3>{label}</h3><p>{detail}</p><i /></article>)}</div>
      </section>

      <section className="welcome-pricing" id="pricing" aria-labelledby="welcome-pricing-title">
        <header className="welcome-pricing__header">
          <div>
            <p className="eyebrow">Simple faction-wide access</p>
            <h2 id="welcome-pricing-title">One licence. Every approved member.</h2>
            <p>Choose the term that fits your faction. Every plan includes the complete Chainward workspace with no per-seat pricing or feature tiers.</p>
          </div>
          <aside>
            <span><Pill size={18} /></span>
            <p><strong>Paid with Torn items</strong><small>No card details, subscriptions, or surprise renewals.</small></p>
            <BadgeCheck size={17} />
          </aside>
        </header>

        <div className="welcome-pricing__grid">
          {licensePlans.map((plan, index) => {
            const presentation = pricingPresentation[index] ?? pricingPresentation[0];
            const PlanIcon = presentation.icon;
            const featured = plan.id === "quarterly";
            return (
              <article key={plan.id} className={`welcome-price-card${featured ? " welcome-price-card--featured" : ""}`}>
                <div className="welcome-price-card__top">
                  <span><PlanIcon size={19} /></span>
                  <p><small>{presentation.eyebrow}</small><strong>{plan.name}</strong></p>
                  {"badge" in plan && <em>{plan.badge}</em>}
                </div>
                <div className="welcome-price-card__amount">
                  <strong>{plan.itemQuantity}</strong>
                  <span><b>{plan.itemName}</b><small>{plan.term}</small></span>
                </div>
                <p className="welcome-price-card__description">{presentation.feature}</p>
                <ul>
                  <li><Check size={13} /> Complete operations workspace</li>
                  <li><Check size={13} /> Unlimited approved faction members</li>
                  <li><Check size={13} /> All features and releases in the term</li>
                </ul>
                <Link href="/connect">Choose {plan.name.toLowerCase()} <ArrowRight size={14} /></Link>
              </article>
            );
          })}
        </div>

        <footer className="welcome-pricing__footer">
          <span><ShieldCheck size={17} /></span>
          <p><strong>Manual, auditable activation</strong><small>Chainward creates a unique faction reference. Access begins only after the item transfer is matched and approved by the platform owner.</small></p>
          <Link href="/connect">Start securely <ArrowRight size={14} /></Link>
        </footer>
      </section>

      <section className="welcome-assurance" id="assurance">
        <div className="welcome-assurance__intro"><p className="eyebrow">Confidence by design</p><h2>Polished on the surface. Careful underneath.</h2><p>Chainward is built around clear boundaries: verified facts stay verified, deliberate actions stay auditable, and sensitive credentials stay server-side.</p><Link href="/connect">See the secure connection flow <ArrowRight size={14} /></Link></div>
        <div className="welcome-assurance__list">{assurances.map(([Icon, title, detail]) => <article key={title}><span><Icon size={18} /></span><p><strong>{title}</strong><small>{detail}</small></p><Check size={14} /></article>)}</div>
      </section>

      <section className="welcome-cta">
        <span><Sparkles size={22} /></span>
        <div><p className="eyebrow">Your workspace is ready</p><h2>Give your next chain a better command centre.</h2><p>Connect a supported Torn API key and let Chainward verify the faction workspace securely.</p></div>
        <Link className="button button--primary" href="/connect">Get started <ArrowRight size={16} /></Link>
      </section>

      <footer className="welcome-footer"><BrandMark /><p>Independent Torn community software. Not affiliated with or endorsed by Torn.</p><span>Built for clear, accountable faction operations.</span></footer>
    </main>
  );
}
