import {
  Activity,
  ArrowUpRight,
  Clock3,
  RadioTower,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type {
  OperationsBrief as OperationsBriefView,
  OperationsSignalIcon,
} from "@/lib/intelligence/operations-brief";

const signalIcons: Record<OperationsSignalIcon, LucideIcon> = {
  timer: Clock3,
  coverage: RadioTower,
  readiness: UsersRound,
  trend: TrendingUp,
};

export function OperationsBrief({ brief }: { brief: OperationsBriefView }) {
  return (
    <section className={`operations-brief operations-brief--${brief.tone}`} aria-labelledby="operations-brief-title">
      <header className="operations-brief__header">
        <div className="operations-brief__identity">
          <span><Sparkles size={17} /></span>
          <div><p>Chainward intelligence</p><small>Explainable decision layer</small></div>
        </div>
        <span className="operations-brief__confidence"><ShieldCheck size={13} /> {brief.confidence.label}</span>
      </header>

      <div className="operations-brief__priority">
        <span className="operations-brief__priority-icon"><Activity size={21} /></span>
        <div>
          <p className="eyebrow">Recommended focus</p>
          <h2 id="operations-brief-title">{brief.title}</h2>
          <p>{brief.summary}</p>
        </div>
        <Link className="button button--primary" href={brief.action.href}>{brief.action.label}<ArrowUpRight size={15} /></Link>
      </div>

      <div className="operations-brief__signals">
        {brief.signals.map((signal) => {
          const Icon = signalIcons[signal.icon];
          return (
            <article className={`operations-signal operations-signal--${signal.tone}`} key={signal.label}>
              <span><Icon size={15} /></span>
              <div><small>{signal.label}</small><strong>{signal.value}</strong><p>{signal.detail}</p></div>
            </article>
          );
        })}
      </div>

      <footer><ShieldCheck size={13} /><span><strong>Why this recommendation:</strong> {brief.rationale}</span><time dateTime={brief.checkedAt}>{formatCheckedAt(brief.checkedAt)}</time></footer>
    </section>
  );
}

function formatCheckedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Check time unavailable";
  return `Checked ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(date)} TCT`;
}
