import type { Metadata } from "next";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Check,
  CircleDollarSign,
  Clock3,
  Crown,
  Fingerprint,
  LockKeyhole,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { LoginBackdrop } from "@/components/onboarding/login-backdrop";
import { PlanExplorer } from "@/components/marketing/plan-explorer";

export const metadata: Metadata = {
  title: "Faction operations, beautifully organised",
  description:
    "Bring Torn chain tracking, faction analytics, rewards, payouts, and member access into one protected operations workspace.",
  alternates: { canonical: "/" },
};

const features = [
  {
    icon: Activity,
    title: "Live chain awareness",
    detail:
      "Hit count, timeout pressure, pace, and active contributors on one screen — read straight from the Torn API.",
  },
  {
    icon: BarChart3,
    title: "Member intelligence",
    detail:
      "Roster and chain history become plain answers about who is carrying weight and who has gone quiet.",
  },
  {
    icon: CircleDollarSign,
    title: "Reward policy that holds",
    detail:
      "Versioned payout schemes record exactly how every share was calculated, long after the chain ends.",
  },
  {
    icon: Users,
    title: "Access you control",
    detail:
      "Approve members into workspace roles and keep an auditable history of who changed what.",
  },
] as const;

const steps = [
  {
    icon: LockKeyhole,
    title: "Connect a restricted key",
    detail:
      "Add a limited-access Torn API key. No password, no write access, nothing Torn wouldn't already show your faction.",
  },
  {
    icon: BadgeCheck,
    title: "Chainward verifies the faction",
    detail:
      "The faction identity is confirmed and tied to your workspace before anything unlocks.",
  },
  {
    icon: Crown,
    title: "Your team operates",
    detail:
      "Leadership works from shared, live surfaces instead of a stack of spreadsheets and screenshots.",
  },
] as const;

export default function HomePage() {
  return (
    <main className="welcome-page">
      <LoginBackdrop />

      <header className="welcome-nav">
        <Link href="/" aria-label="Chainward home">
          <BrandMark />
        </Link>
        <nav aria-label="Page sections">
          <a href="#features">Capabilities</a>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <Link className="welcome-nav__workspace" href="/dashboard">
          Open workspace <ArrowRight size={14} />
        </Link>
      </header>

      <section className="welcome-hero">
        <div className="welcome-hero__copy">
          <p className="welcome-signal">
            <i /> Independent Torn faction platform
          </p>
          <h1>
            Run your faction with <span>clarity.</span>
          </h1>
          <p className="welcome-lead">
            Chainward pulls live chain state, member intelligence, reward policy, and payout
            records into one protected workspace — so leadership stops running the faction out
            of a spreadsheet.
          </p>
          <div className="welcome-actions">
            <Link className="button button--primary welcome-actions__primary" href="/connect">
              Connect your faction <ArrowRight size={16} />
            </Link>
            <Link className="welcome-actions__secondary" href="/dashboard">
              Already connected? <ArrowRight size={14} />
            </Link>
          </div>
          <ul className="welcome-proof">
            <li>
              <Check size={13} /> Restricted Torn key only
            </li>
            <li>
              <Check size={13} /> No Torn password
            </li>
            <li>
              <Check size={13} /> No fabricated data
            </li>
          </ul>
        </div>

        <div className="welcome-preview" aria-hidden="true">
          <div className="welcome-console">
            <header>
              <span className="welcome-console__mark">
                <Activity size={15} />
              </span>
              <p>
                <strong>Active chain</strong>
                <small>#58410291 · live</small>
              </p>
              <em>
                <i /> Verified
              </em>
            </header>
            <div className="welcome-console__body">
              <div className="welcome-console__count">
                <strong>742</strong>
                <span>/ 1,000</span>
                <em>74%</em>
              </div>
              <div className="welcome-console__progress">
                <i />
              </div>
              <div className="welcome-console__labels">
                <span>Current progress</span>
                <span>258 hits to target</span>
              </div>
              <div className="welcome-console__metrics">
                <article>
                  <Clock3 size={14} />
                  <small>Timeout</small>
                  <strong>03:42</strong>
                </article>
                <article>
                  <Users size={14} />
                  <small>Contributors</small>
                  <strong>28</strong>
                </article>
                <article>
                  <BarChart3 size={14} />
                  <small>Pace</small>
                  <strong>91/hr</strong>
                </article>
              </div>
            </div>
            <footer>
              <Fingerprint size={12} /> Illustrative values · verified data boundary
            </footer>
          </div>
        </div>
      </section>

      <section className="welcome-section welcome-features" id="features">
        <header className="welcome-section__head">
          <p className="eyebrow">Capabilities</p>
          <h2>Everything that matters, none of the noise.</h2>
          <p>
            Four focused surfaces keep verified Torn facts, leadership decisions, and saved
            records apart and easy to read.
          </p>
        </header>
        <div className="welcome-features__grid">
          {features.map(({ icon: Icon, title, detail }) => (
            <article key={title}>
              <span>
                <Icon size={18} />
              </span>
              <h3>{title}</h3>
              <p>{detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="welcome-section welcome-steps" id="how">
        <header className="welcome-section__head">
          <p className="eyebrow">How it works</p>
          <h2>Three steps from key to command centre.</h2>
        </header>
        <ol className="welcome-steps__list">
          {steps.map(({ icon: Icon, title, detail }, index) => (
            <li key={title}>
              <span className="welcome-steps__index">{index + 1}</span>
              <span className="welcome-steps__icon">
                <Icon size={17} />
              </span>
              <h3>{title}</h3>
              <p>{detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section
        className="welcome-section welcome-pricing"
        id="pricing"
        aria-labelledby="welcome-pricing-title"
      >
        <header className="welcome-section__head">
          <p className="eyebrow">Pricing</p>
          <h2 id="welcome-pricing-title">One licence. Every approved member.</h2>
          <p>
            Pick the term that suits your faction. Every plan is the complete workspace — no
            per-seat pricing, no feature tiers, paid in Torn items.
          </p>
        </header>
        <PlanExplorer />
        <p className="welcome-pricing__note">
          <ShieldCheck size={14} />
          Open any plan for its true monthly rate and how activation works. Access begins only after
          the item transfer is matched and approved by the platform owner.
        </p>
      </section>

      <section className="welcome-cta">
        <div>
          <p className="eyebrow">Your workspace is ready</p>
          <h2>Give your next chain a real command centre.</h2>
          <p>Connect a supported Torn API key and let Chainward verify the faction securely.</p>
        </div>
        <Link className="button button--primary" href="/connect">
          Get started <ArrowRight size={16} />
        </Link>
      </section>

      <footer className="welcome-footer">
        <BrandMark />
        <p>Independent Torn community software. Not affiliated with or endorsed by Torn.</p>
      </footer>
    </main>
  );
}
