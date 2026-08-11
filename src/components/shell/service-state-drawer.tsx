"use client";

import {
  Activity,
  Database,
  KeyRound,
  RefreshCw,
  Satellite,
  Settings,
  Timer,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import type { DatabaseStatus } from "@/lib/data/database-status";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";

type ServiceTone = "ok" | "attention" | "neutral";

interface ServiceRow {
  key: string;
  icon: LucideIcon;
  name: string;
  detail: string;
  state: string;
  tone: ServiceTone;
}

interface ServiceStateDrawerProps {
  telemetry: WorkspaceTelemetry;
  database: DatabaseStatus;
  syncing: boolean;
  onSync: () => void;
  onClose: () => void;
}

export function ServiceStateDrawer({ telemetry, database, syncing, onSync, onClose }: ServiceStateDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const offline = telemetry.mode === "offline";
  const live = telemetry.source === "live";
  const rows = buildRows(telemetry, database);
  const attention = rows.filter((row) => row.tone === "attention").length;
  const overall: ServiceTone = attention > 0 ? "attention" : "ok";
  const headline = offline ? "Test mode" : attention > 0 ? "Needs attention" : "Operational";
  const summary = offline
    ? "Deterministic local fixture data. Torn was not contacted and no value on screen is live."
    : attention > 0
      ? `${attention} of ${rows.length} checks need attention before operational data can be trusted.`
      : "Every check Chainward performs on this device responded successfully.";

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="service-drawer" role="dialog" aria-modal="true" aria-label="Observed service state">
      <button className="service-drawer__scrim" onClick={onClose} aria-label="Close service state" />
      <aside className="service-drawer__panel">
        <header className="service-drawer__header">
          <span className={`service-drawer__glyph service-drawer__glyph--${overall}`}><Activity size={18} /></span>
          <div>
            <p className="eyebrow">Observed service state</p>
            <h2>Data connection</h2>
          </div>
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Close service state"><X size={18} /></button>
        </header>

        <div className="service-drawer__body">
          <section className={`service-summary service-summary--${offline ? "test" : overall}`}>
            <div className="service-summary__top">
              <span className="service-summary__pulse" aria-hidden="true" />
              <strong>{headline}</strong>
              <em>{rows.filter((row) => row.tone !== "attention").length}/{rows.length} healthy</em>
            </div>
            <p>{summary}</p>
            <dl className="service-summary__facts">
              <div><dt>Data source</dt><dd>{offline ? "Local fixture" : live ? "Torn API v2" : "Unavailable"}</dd></div>
              <div><dt>Storage</dt><dd>{database.label}</dd></div>
              <div><dt>Last check</dt><dd><Timer size={12} /> {relativeTime(telemetry.checkedAt)}</dd></div>
            </dl>
          </section>

          <ul className="service-check-list">
            {rows.map((row) => {
              const Icon = row.icon;
              return (
                <li key={row.key} className={`service-check service-check--${row.tone}`}>
                  <span className="service-check__icon"><Icon size={15} /></span>
                  <div className="service-check__copy">
                    <strong>{row.name}</strong>
                    <small>{row.detail}</small>
                  </div>
                  <em className="service-check__state">{row.state}</em>
                </li>
              );
            })}
          </ul>

          <p className="service-drawer__note">{telemetry.message}</p>
        </div>

        <footer className="service-drawer__footer">
          <button className="button button--secondary" onClick={onSync} disabled={syncing || offline}>
            <RefreshCw className={syncing ? "spin" : undefined} size={14} /> {syncing ? "Checking…" : "Re-check now"}
          </button>
          <Link href="/settings" className="button button--quiet" onClick={onClose}><Settings size={14} /> Settings</Link>
          <time dateTime={telemetry.checkedAt}>{new Date(telemetry.checkedAt).toLocaleString("en-GB")}</time>
        </footer>
      </aside>
    </div>
  );
}

function buildRows(telemetry: WorkspaceTelemetry, database: DatabaseStatus): ServiceRow[] {
  const offline = telemetry.mode === "offline";
  const live = telemetry.source === "live";
  return [
    {
      key: "torn",
      icon: Satellite,
      name: offline ? "Data fixture" : "Torn API",
      detail: offline ? "Local deterministic responses replace every Torn request." : live ? "Responded to the last server-side request." : "No verified response was received.",
      state: offline ? "Test only" : live ? "Verified" : "Attention",
      tone: offline ? "neutral" : live ? "ok" : "attention",
    },
    {
      key: "database",
      icon: Database,
      name: "Application database",
      detail: database.message,
      state: database.available ? "Ready" : database.configured ? "Attention" : "Not configured",
      tone: database.available ? "ok" : database.configured ? "attention" : "neutral",
    },
    {
      key: "credential",
      icon: KeyRound,
      name: "Credential",
      detail: offline ? "An encrypted offline test session is active." : live ? "Encrypted server-side and never returned to the browser." : "The stored credential is missing or no longer valid.",
      state: offline ? "Test session" : live ? "Configured" : "Attention",
      tone: offline ? "neutral" : live ? "ok" : "attention",
    },
    {
      key: "jobs",
      icon: Timer,
      name: "Background jobs",
      detail: "No background worker is configured; refreshes happen while the workspace is open.",
      state: "Not configured",
      tone: "neutral",
    },
  ];
}

function relativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1_000));
  if (seconds < 45) return "Moments ago";
  if (seconds < 3_600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}
