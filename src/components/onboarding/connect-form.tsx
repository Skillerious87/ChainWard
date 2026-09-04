"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  Laptop,
  LockKeyhole,
  ShieldCheck,
  UserRoundCog,
} from "lucide-react";
import type { Route } from "next";
import { useState, type FormEvent } from "react";
import { Spinner } from "@/components/ui/spinner";
import { WorkspaceLoadingOverlay } from "@/components/ui/workspace-loading-overlay";
import { enterConnectedWorkspace } from "./workspace-navigation";

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
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<ConnectionError | null>(null);

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
        credentials: "same-origin",
        cache: "no-store",
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
      // Verification success and workspace entry are the same moment from the
      // player's side: no confirmation screen sits between "Verify" and being
      // inside the app.
      setOpening(true);
      enterConnectedWorkspace(connectionNextPath(payload));
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
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ identity }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isConnectionResult(payload)) throw new Error(isErrorPayload(payload) ? payload.error : "The offline session could not be opened.");
      setOpening(true);
      enterConnectedWorkspace(connectionNextPath(payload));
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : "The offline session could not be opened.", code: null });
    } finally {
      setLoading(false);
    }
  }

  const formState = loading || opening ? "validating" : "entry";
  const className = `connect-form connect-form--${formState}${offlineEnabled ? " connect-form--offline" : ""}`;

  return (
    <form className={className} onSubmit={submit} aria-busy={loading || opening}>
      <WorkspaceLoadingOverlay visible={opening} />
      <span className="connect-form__activity" aria-hidden="true" />
      <div className="connect-stage connect-stage--entry">
          <header className="connect-form__heading">
            <p><ShieldCheck size={13} /> Secure sign in</p>
            <h2>Welcome to Chainward</h2>
            <span>Verify a restricted Torn key to open your faction workspace.</span>
          </header>
          <span className="sr-only" aria-live="polite">{loading ? "Verifying your Torn connection." : ""}</span>
          <div className="api-key-field">
            <label className="api-key-field__label" htmlFor="torn-api-key"><strong>Torn API key</strong><small>Exactly 16 characters</small></label>
            <div><input id="torn-api-key" name="apiKey" type={visible ? "text" : "password"} autoComplete="off" autoCapitalize="none" spellCheck={false} inputMode="text" enterKeyHint="go" minLength={16} maxLength={16} pattern="[A-Za-z0-9]{16}" required disabled={loading} placeholder="Paste your Torn API key" aria-describedby="api-key-guidance" onChange={() => { if (error) setError(null); }} /><button type="button" disabled={loading} onClick={() => setVisible((value) => !value)} aria-label={visible ? "Hide API key" : "Show API key"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
            <small id="api-key-guidance"><span><ShieldCheck size={13} /> Limited Access is enough. Never use your Torn password.</span><a href="https://www.torn.com/preferences.php#tab=api" target="_blank" rel="noreferrer">Create a key <ExternalLink size={12} /></a></small>
          </div>
          <label className="remember-connection">
            <input name="remember" type="checkbox" defaultChecked disabled={loading} />
            <span aria-hidden="true"><Check size={14} /></span>
            <span><strong>Keep me signed in</strong><small>Remember this browser for 30 days.</small></span>
          </label>
          {error && <div className="form-error" role="alert"><AlertTriangle size={17} /><div><strong>{errorTitle(error.code)}</strong><span>{error.message}</span><small>{errorGuidance(error.code)}</small></div></div>}
          <button type="submit" className="button button--primary connect-submit" disabled={loading}>{loading ? <><Spinner size={16} label="Verifying Torn connection" /> Verifying securely…</> : <>Verify and continue <ArrowRight size={16} /></>}</button>
          <p className="connect-security-note"><LockKeyhole size={15} /><span><strong>Encrypted handoff</strong><small>Your raw key is handled server-side and never returned to browser code.</small></span></p>
          <details className="connect-details">
            <summary><ShieldCheck size={14} /> Access &amp; data details <ChevronDown size={15} /></summary>
            <div>
              <p>Chainward checks these selections before opening a workspace, and keeps clear boundaries for everything it stores.</p>
              <ul className="connect-details__selections">{REQUIRED_SELECTIONS.map((selection) => <li key={selection}><Check size={11} />{selection}</li>)}</ul>
              <dl>
                <div><dt>Stored data</dt><dd>Operational records, member reports, and awards persist in the configured Chainward database until the workspace operator removes that data. Torn roster responses are briefly cached.</dd></div>
                <div><dt>Shared with</dt><dd>The connected faction workspace. Entries marked leadership-only are restricted to authorised member managers.</dd></div>
                <div><dt>API key</dt><dd>Used server-side only. A temporary connection is encrypted for up to 12 hours; “Keep me signed in” stores the encrypted key server-side for up to 30 days.</dd></div>
              </dl>
            </div>
          </details>
          {offlineEnabled && <details className="offline-test-entry">
            <summary><Laptop size={15} /> Open an offline test workspace <ChevronDown size={15} /></summary>
            <p>Development fixture only. Never available in production.</p>
            <div><button type="button" disabled={loading} onClick={() => void openOfflineSession("member")}><KeyRound size={14} /><span><strong>Faction tester</strong><small>Preview member access</small></span></button><button type="button" disabled={loading} onClick={() => void openOfflineSession("owner")}><UserRoundCog size={14} /><span><strong>Owner reviewer</strong><small>Preview owner access</small></span></button></div>
          </details>}
      </div>
    </form>
  );
}

function isConnectionResult(value: unknown): value is ConnectionResult {
  if (!value || typeof value !== "object") return false;
  return "player" in value && "faction" in value && "key" in value && "capabilities" in value && "checkedAt" in value && "session" in value && "connected" in value && value.connected === true;
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
