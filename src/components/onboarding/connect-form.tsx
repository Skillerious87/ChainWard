"use client";

import { AlertTriangle, ArrowRight, Check, Eye, EyeOff, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type ConnectionResult = {
  player: { id: number; name: string };
  faction: { id: number; name: string; tag: string };
  key: { accessType: string; hasFactionPermission: boolean };
  capabilities: Record<"identity" | "faction" | "liveChain" | "completedChains" | "members" | "chainReports", "verified" | "available">;
  checkedAt: string;
  session: { remembered: boolean; expiresAt: string };
  connected: true;
};

type ConnectionError = { message: string; code: string | null };

export function ConnectForm() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ConnectionError | null>(null);
  const [result, setResult] = useState<ConnectionResult | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError(null);
    setResult(null);
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
        const error = new Error(message) as Error & { code?: string };
        if (isErrorPayload(payload)) error.code = payload.code;
        throw error;
      }
      setResult(payload);
      formElement.reset();
      setVisible(false);
      router.prefetch("/dashboard");
      window.setTimeout(() => {
        router.push("/dashboard");
        router.refresh();
      }, 650);
    } catch (cause: unknown) {
      setError({
        message: cause instanceof Error ? cause.message : "The key could not be validated.",
        code: cause instanceof Error && "code" in cause && typeof cause.code === "string" ? cause.code : null,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="connect-form" onSubmit={submit} aria-busy={loading}>
      <div className="connect-form__heading"><span><KeyRound size={19} /></span><div><small>Restricted key connection</small><h2>Connect your Torn API</h2><p>We’ll verify your identity, faction, and required API selections before anything opens.</p></div></div>
      <label className="api-key-field">
        <span className="api-key-field__label"><strong>Torn API key</strong><small>16–18 characters</small></span>
        <div><input name="apiKey" type={visible ? "text" : "password"} autoComplete="off" autoCapitalize="none" spellCheck={false} inputMode="text" minLength={16} maxLength={18} pattern="[A-Za-z0-9'&quot;]{16,18}" required placeholder="Paste your restricted Torn API key" aria-describedby="api-key-guidance" onChange={() => { if (error) setError(null); if (result) setResult(null); }} /><button type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Hide API key" : "Show API key"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
        <small id="api-key-guidance"><ShieldCheck size={13} /> Limited Access is sufficient. Never enter your Torn password.</small>
      </label>
      <label className="remember-connection">
        <input name="remember" type="checkbox" defaultChecked />
        <span aria-hidden="true"><Check size={14} /></span>
        <span><strong>Remember this browser</strong><small>Reconnect automatically for 30 days. Only a random, HTTP-only session token is stored in this browser.</small></span>
      </label>
      {error && <div className="form-error" role="alert"><AlertTriangle size={17} /><div><strong>{errorTitle(error.code)}</strong><span>{error.message}</span><small>{errorGuidance(error.code)}</small></div></div>}
      {result && (
        <div className="connection-result">
          <div><ShieldCheck size={18} /><strong>API connection verified</strong></div>
          <dl><div><dt>Player</dt><dd>{result.player.name} [{result.player.id}]</dd></div><div><dt>Faction</dt><dd>{result.faction.name} [{result.faction.id}]</dd></div><div><dt>Key access</dt><dd><Check size={13} /> {result.key.accessType}</dd></div></dl>
          <div className="capability-checks" aria-label="Verified API capabilities">{Object.entries(result.capabilities).map(([name, status]) => <span key={name}><Check size={12} />{capabilityLabel(name)}<small>{status === "verified" ? "Tested" : "Available"}</small></span>)}</div>
          <p className="connection-session-note"><ShieldCheck size={13} /> {result.session.remembered ? "This browser will reconnect automatically for 30 days." : "Temporary workspace session active for up to 12 hours."}</p>
        </div>
      )}
      <button type={result ? "button" : "submit"} className="button button--primary connect-submit" disabled={loading} onClick={result ? () => { router.push("/dashboard"); router.refresh(); } : undefined}>{loading ? <><LoaderCircle className="spin" size={16} /> Validating securely…</> : result ? <>Open verified workspace <ArrowRight size={16} /></> : <>Validate and connect <ArrowRight size={16} /></>}</button>
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
