"use client";

import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  LockKeyhole,
  RefreshCcw,
  ShieldCheck,
  UserRoundCog,
} from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Spinner } from "@/components/ui/spinner";

type ConnectionResult = {
  player: { id: number; name: string };
  faction: { id: number; name: string; tag: string };
  key: { accessType: string; hasFactionPermission: boolean };
  capabilities: Record<"identity" | "faction" | "liveChain" | "completedChains" | "members" | "chainReports", "verified" | "available">;
  checkedAt: string;
  session: { remembered: boolean; expiresAt: string };
  connected: true;
  offline?: boolean;
  nextPath?: Route;
};

type ConnectionError = { message: string; code: string | null };

/** Mirrors the selections `validateTornConnection` requires before connecting. */
const REQUIRED_SELECTIONS = ["key/info", "user/basic", "faction/basic", "chain", "chains", "chainreport", "members"] as const;

export function ConnectForm({ offlineEnabled = false }: { offlineEnabled?: boolean }) {
  const router = useRouter();
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<ConnectionError | null>(null);
  const [result, setResult] = useState<ConnectionResult | null>(null);

  useEffect(() => {
    if (result) confirmationHeadingRef.current?.focus();
  }, [result]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError(null);
    setLoading(true);
    const form = new FormData(formElement);
    const apiKey = String(form.get("apiKey") ?? "");
    const remember = form.get("remember") === "on";
    try {
      const response = await fetch("/api/onboarding/validate-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey, remember }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isConnectionResult(payload)) {
        const message = isErrorPayload(payload) ? payload.error : "The key could not be validated.";
        const connectionError = new Error(message) as Error & { code?: string };
        if (isErrorPayload(payload)) connectionError.code = payload.code;
        throw connectionError;
      }
      formElement.reset();
      setVisible(false);
      setResult(payload);
      router.prefetch(connectionNextPath(payload));
    } catch (cause: unknown) {
      setError({
        message: cause instanceof Error ? cause.message : "The key could not be validated.",
        code: cause instanceof Error && "code" in cause && typeof cause.code === "string" ? cause.code : null,
      });
    } finally {
      setLoading(false);
    }
  }

  async function openOfflineSession(identity: "member" | "owner"): Promise<void> {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/onboarding/offline-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identity }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isConnectionResult(payload)) throw new Error(isErrorPayload(payload) ? payload.error : "The offline session could not be opened.");
      setResult(payload);
      router.prefetch(payload.nextPath ?? (identity === "owner" ? "/admin" : "/unlock"));
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : "The offline session could not be opened.", code: null });
    } finally {
      setLoading(false);
    }
  }

  async function resetConnection(): Promise<void> {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/onboarding/disconnect", { method: "POST" });
      if (!response.ok) throw new Error("The current session could not be cleared. Please try again.");
      setResult(null);
      setVisible(false);
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : "The current session could not be cleared.", code: null });
    } finally {
      setLoading(false);
    }
  }

  const formState = result ? "verified" : loading ? "validating" : "entry";
  const className = `connect-form connect-form--${formState}${offlineEnabled ? " connect-form--offline" : ""}`;

  return (
    <form className={className} onSubmit={submit} aria-busy={loading}>
      <span className="connect-form__activity" aria-hidden="true" />
      {result ? (
        <section className="connection-confirmation" aria-labelledby="connection-confirmation-title">
          <header className="connection-confirmation__hero">
            <div className="connection-confirmation__crest" aria-hidden="true"><span><BadgeCheck size={29} /></span><i /></div>
            <p className="connection-confirmation__eyebrow"><Check size={12} /> {result.offline ? "Offline preview verified" : "Connection verified"}</p>
            <h2 id="connection-confirmation-title" ref={confirmationHeadingRef} tabIndex={-1}>Your workspace is ready.</h2>
            <p>{result.player.name} is securely matched to <strong>{result.faction.name}</strong>. Review the connection below, then enter when you are ready.</p>
          </header>

          <dl className="connection-confirmation__identity">
            <div><dt>Player</dt><dd>{result.player.name}<small>#{result.player.id}</small></dd></div>
            <div><dt>Faction</dt><dd>{result.faction.name}<small>{result.faction.tag ? `[${result.faction.tag}]` : `#${result.faction.id}`}</small></dd></div>
            <div><dt>Key access</dt><dd><Check size={13} /> {result.key.accessType}<small>Approved</small></dd></div>
          </dl>

          <div className="connection-confirmation__capabilities" aria-label="Verified API capabilities">
            {Object.entries(result.capabilities).map(([name, status]) => (
              <span key={name}><Check size={12} /><strong>{capabilityLabel(name)}</strong><small>{status === "verified" ? "Tested" : "Ready"}</small></span>
            ))}
          </div>

          <div className="connection-confirmation__session">
            <span><LockKeyhole size={16} /></span>
            <p><strong>{result.session.remembered ? "Remembered connection secured" : "Private session secured"}</strong><small>{result.session.remembered ? "This browser can reconnect for 30 days using an HTTP-only session token." : "This temporary workspace session expires automatically within 12 hours."}</small></p>
          </div>

          {error && <div className="form-error connection-confirmation__error" role="alert"><AlertTriangle size={17} /><div><strong>Session could not be cleared</strong><span>{error.message}</span></div></div>}

          <div className="connection-confirmation__actions">
            <button type="button" className="button button--primary" disabled={loading || opening} onClick={() => { setOpening(true); router.push(connectionNextPath(result)); }}>{opening ? <Spinner size={16} label="Opening workspace" /> : null}{opening ? "Opening workspace…" : <>Open {result.faction.tag ? `[${result.faction.tag}]` : "faction"} workspace <ArrowRight size={16} /></>}</button>
            <button type="button" className="connection-confirmation__reset" disabled={loading} onClick={() => void resetConnection()}>{loading ? <Spinner size={14} label="Clearing connection" /> : <RefreshCcw size={14} />} {loading ? "Clearing session…" : "Use a different key"}</button>
          </div>
        </section>
      ) : (
        <div className="connect-stage connect-stage--entry">
          <div className="connect-form__heading"><span><KeyRound size={19} /></span><div><small>{loading ? "Verification in progress" : "Restricted key connection"}</small><h2>{loading ? "Checking your connection…" : "Connect your Torn API"}</h2><p>{loading ? "Confirming your identity, faction, and required selections with Torn. This usually takes only a moment." : "We’ll verify your identity, faction, and required API selections before anything opens."}</p></div></div>
          <label className="api-key-field">
            <span className="api-key-field__label"><strong>Torn API key</strong><small>Exactly 16 characters</small></span>
            <div><input name="apiKey" type={visible ? "text" : "password"} autoComplete="off" autoCapitalize="none" spellCheck={false} inputMode="text" minLength={16} maxLength={16} pattern="[A-Za-z0-9]{16}" required disabled={loading} placeholder="Paste your restricted Torn API key" aria-describedby="api-key-guidance" onChange={() => { if (error) setError(null); }} /><button type="button" disabled={loading} onClick={() => setVisible((value) => !value)} aria-label={visible ? "Hide API key" : "Show API key"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
            <small id="api-key-guidance"><ShieldCheck size={13} /> Limited Access is sufficient. Never enter your Torn password.</small>
          </label>
          <label className="remember-connection">
            <input name="remember" type="checkbox" defaultChecked disabled={loading} />
            <span aria-hidden="true"><Check size={14} /></span>
            <span><strong>Remember this browser</strong><small>Reconnect automatically for 30 days. Only a random, HTTP-only session token is stored in this browser.</small></span>
          </label>
          {error && <div className="form-error" role="alert"><AlertTriangle size={17} /><div><strong>{errorTitle(error.code)}</strong><span>{error.message}</span><small>{errorGuidance(error.code)}</small></div></div>}
          <button type="submit" className="button button--primary connect-submit" disabled={loading}>{loading ? <><Spinner size={16} label="Validating Torn connection" /> Validating securely…</> : <>Validate and connect <ArrowRight size={16} /></>}</button>
          <section className="connect-requirements" aria-label="API selections Chainward verifies">
            <p><ShieldCheck size={13} /> Selections checked during validation</p>
            <ul>{REQUIRED_SELECTIONS.map((selection) => <li key={selection}><Check size={11} />{selection}</li>)}</ul>
          </section>
          {offlineEnabled && <section className="offline-test-entry" aria-label="Offline testing">
            <header><span><Laptop size={16} /></span><p><strong>Test without internet access</strong><small>Development fixture only · clearly labelled · never available in production</small></p></header>
            <div><button type="button" disabled={loading} onClick={() => void openOfflineSession("member")}><KeyRound size={14} /><span><strong>Faction tester</strong><small>Preview the member confirmation flow</small></span></button><button type="button" disabled={loading} onClick={() => void openOfflineSession("owner")}><UserRoundCog size={14} /><span><strong>Owner reviewer</strong><small>Preview the owner confirmation flow</small></span></button></div>
          </section>}
        </div>
      )}
    </form>
  );
}

function isConnectionResult(value: unknown): value is ConnectionResult {
  if (!value || typeof value !== "object") return false;
  return "player" in value && "faction" in value && "key" in value && "capabilities" in value && "checkedAt" in value && "session" in value && "connected" in value && value.connected === true;
}

function capabilityLabel(name: string): string {
  return ({ identity: "Identity", faction: "Faction", liveChain: "Live chain", completedChains: "History", members: "Roster", chainReports: "Reports" } as Record<string, string>)[name] ?? name;
}

function connectionNextPath(result: ConnectionResult): Route {
  if (result.nextPath === "/admin" || result.nextPath === "/unlock" || result.nextPath === "/dashboard") return result.nextPath;
  return "/dashboard";
}

function isErrorPayload(value: unknown): value is { error: string; code: string } {
  return Boolean(value && typeof value === "object" && "error" in value && typeof value.error === "string" && "code" in value && typeof value.code === "string");
}

function errorTitle(code: string | null): string {
  if (code === "INVALID_KEY") return "Torn rejected this key";
  if (code === "KEY_PAUSED") return "This key is not active";
  if (code === "MISSING_SELECTIONS" || code === "INSUFFICIENT_PERMISSION") return "More API access is required";
  if (code === "RATE_LIMITED" || code === "API_UNAVAILABLE") return "Torn API is temporarily unavailable";
  return "Connection could not be verified";
}

function errorGuidance(code: string | null): string {
  if (code === "INVALID_KEY") return "Check for a rotated or deleted key, then copy its value again from Torn Settings → API Keys.";
  if (code === "KEY_PAUSED") return "Resume the key in Torn, or create a new Limited Access key, before retrying.";
  if (code === "MISSING_SELECTIONS" || code === "INSUFFICIENT_PERMISSION") return "Use a Limited Access key, or a custom key containing basic, chain, chains, chainreport, and members.";
  return "No connection was saved and no unverified Torn values will be displayed.";
}
