"use client";

import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  Eye,
  EyeOff,
  ExternalLink,
  Fingerprint,
  KeyRound,
  Laptop,
  ShieldCheck,
  UserRoundCog,
  WifiOff,
} from "lucide-react";
import type { Route } from "next";
import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import {
  browserSupportsWebAuthnAutofill,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
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
  hasWebauthnCredential?: boolean;
};

type ConnectionError = { message: string; code: string | null };
type PasskeyAssertion = Awaited<ReturnType<typeof startAuthentication>>;

/**
 * The OS - not this app - decides whether a "platform authenticator" prompt
 * is a fingerprint, Face ID, or a PIN entry, so this can't force one method.
 * What it can do honestly is set expectations by device class: phones are
 * overwhelmingly fingerprint sensors (Face ID iPhones aside), and desktops
 * without a camera/reader fall back to a PIN via Windows Hello or similar -
 * "PIN" reads as less demanding than "Face ID" for that case.
 */
function isMobileUserAgent(userAgent: string): boolean {
  return /android|iphone|ipad|ipod|mobile/i.test(userAgent);
}

export function ConnectForm({ offlineEnabled = false }: { offlineEnabled?: boolean }) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<ConnectionError | null>(null);
  const [networkOffline, setNetworkOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  const [platformAuthAvailable, setPlatformAuthAvailable] = useState(false);
  const [autofillSupported, setAutofillSupported] = useState(false);
  const [passkeyPrompt, setPasskeyPrompt] = useState<ConnectionResult | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  // Only ever read by content already gated behind `platformAuthAvailable`
  // (false on both the server render and the initial client hydration pass),
  // or by a post-interaction prompt - so recomputing it per render can't
  // introduce a server/client output mismatch.
  const isMobile = isMobileUserAgent(typeof navigator === "undefined" ? "" : navigator.userAgent);
  const passkeyNoun = isMobile ? "fingerprint" : "PIN";
  const PasskeyIcon = isMobile ? Fingerprint : KeyRound;

  useEffect(() => {
    const goOnline = () => setNetworkOffline(false);
    const goOffline = () => setNetworkOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const available = await platformAuthenticatorIsAvailable().catch(() => false);
      if (!cancelled) setPlatformAuthAvailable(available);
      // A discoverable passkey can surface as a native autofill suggestion on
      // the key field itself, with no explicit button - try this passively
      // and let a manual key entry or the explicit unlock button win if the
      // user does something else first. Browsers without autofill support
      // fall back to the explicit unlock button instead.
      const autofillReady = await browserSupportsWebAuthnAutofill().catch(() => false);
      if (!cancelled) setAutofillSupported(autofillReady);
      if (!autofillReady || cancelled) return;
      const optionsResponse = await fetch("/api/onboarding/webauthn/authentication-options", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      }).catch(() => null);
      const optionsPayload: unknown = await optionsResponse?.json().catch(() => null);
      if (cancelled || !optionsResponse?.ok || !isOptionsPayload(optionsPayload)) return;
      const assertion = await startAuthentication({ optionsJSON: optionsPayload.options, useBrowserAutofill: true }).catch(() => null);
      if (cancelled || !assertion) return;
      await completePasskeyAuthentication(assertion).catch(() => {});
    })();
    return () => { cancelled = true; };
  }, []);

  async function completePasskeyAuthentication(assertion: PasskeyAssertion): Promise<void> {
    const response = await fetch("/api/onboarding/webauthn/authentication-verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ response: assertion }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isConnectionResult(payload)) {
      const message = isErrorPayload(payload) ? payload.error : "The passkey could not be used.";
      const passkeyError = new Error(message) as Error & { code?: string };
      if (isErrorPayload(payload)) passkeyError.code = payload.code;
      throw passkeyError;
    }
    setOpening(true);
    enterConnectedWorkspace(connectionNextPath(payload));
  }

  async function unlockWithPasskey(): Promise<void> {
    if (loading || opening) return;
    setError(null);
    setLoading(true);
    try {
      const optionsResponse = await fetch("/api/onboarding/webauthn/authentication-options", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      const optionsPayload: unknown = await optionsResponse.json();
      if (!optionsResponse.ok || !isOptionsPayload(optionsPayload)) throw new Error("Passkey sign-in is unavailable right now.");
      const assertion = await startAuthentication({ optionsJSON: optionsPayload.options });
      await completePasskeyAuthentication(assertion);
    } catch (cause: unknown) {
      setError(connectionErrorFrom(cause, "The passkey could not be used."));
    } finally {
      setLoading(false);
    }
  }

  async function enrollPasskey(result: ConnectionResult): Promise<void> {
    setEnrolling(true);
    try {
      const optionsResponse = await fetch("/api/onboarding/webauthn/registration-options", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      const optionsPayload: unknown = await optionsResponse.json();
      if (!optionsResponse.ok || !isRegistrationOptionsPayload(optionsPayload)) throw new Error("registration-options-failed");
      const registration = await startRegistration({ optionsJSON: optionsPayload.options });
      await fetch("/api/onboarding/webauthn/registration-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ response: registration }),
      });
    } catch {
      // Enrollment is a bonus, never a gate - a cancelled prompt or an
      // unsupported browser just means the user keeps using their key.
    } finally {
      setEnrolling(false);
      proceedToWorkspace(result);
    }
  }

  function proceedToWorkspace(result: ConnectionResult): void {
    setPasskeyPrompt(null);
    setOpening(true);
    enterConnectedWorkspace(connectionNextPath(result));
  }

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
      if (payload.hasWebauthnCredential === false && platformAuthAvailable) {
        // Offer to enroll a passkey before entering the workspace - skippable
        // and never blocking, but this is the one moment the server knows
        // for certain no passkey exists yet for this key.
        setPasskeyPrompt(payload);
        return;
      }
      // Verification success and workspace entry are the same moment from the
      // player's side: no confirmation screen sits between "Verify" and being
      // inside the app.
      setOpening(true);
      enterConnectedWorkspace(connectionNextPath(payload));
    } catch (cause: unknown) {
      setError(connectionErrorFrom(cause, "The key could not be validated."));
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
      setError(connectionErrorFrom(cause, "The offline session could not be opened."));
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
          <div className="connect-hero">
            <span className="connect-hero__mark"><Image src="/icons/android-chrome-512x512.png?v=2" alt="" width={144} height={144} priority /></span>
            <span className="connect-hero__word">Chain<span>ward</span></span>
            <span className="connect-hero__tag">Faction Ops · Secure Access</span>
          </div>
        </header>
        <span className="sr-only" aria-live="polite">{loading ? "Verifying your Torn connection." : ""}</span>

        {networkOffline && (
          <div className="connect-offline-banner" role="status">
            <WifiOff size={15} /> <span>You&apos;re offline. Reconnect to sign in.</span>
          </div>
        )}

        {passkeyPrompt ? (
          <div className="connect-passkey-offer">
            <span className="connect-passkey-offer__icon" aria-hidden="true"><PasskeyIcon size={22} /></span>
            <strong>Enable {passkeyNoun} unlock for next time?</strong>
            <p>Unlock this workspace with your {passkeyNoun} instead of pasting your API key.</p>
            <div className="connect-passkey-offer__actions">
              <button type="button" className="button button--primary" disabled={enrolling} onClick={() => void enrollPasskey(passkeyPrompt)}>{enrolling ? "Enabling…" : "Enable"}</button>
              <button type="button" className="button button--quiet" disabled={enrolling} onClick={() => proceedToWorkspace(passkeyPrompt)}>Skip</button>
            </div>
          </div>
        ) : (
          <>
            {platformAuthAvailable && !autofillSupported && (
              <button type="button" className="connect-passkey-unlock connect-passkey-unlock--in" disabled={loading || opening || networkOffline} onClick={() => void unlockWithPasskey()}>
                <PasskeyIcon size={16} /> Unlock with {passkeyNoun}
              </button>
            )}

            <div className="api-key-field">
              <label className="api-key-field__label" htmlFor="torn-api-key"><strong>Torn API key</strong><small>16 characters</small></label>
              <div>
                <input id="torn-api-key" name="apiKey" type={visible ? "text" : "password"} autoComplete="username webauthn" autoCapitalize="none" spellCheck={false} inputMode="text" enterKeyHint="go" minLength={16} maxLength={16} pattern="[A-Za-z0-9]{16}" required disabled={loading} placeholder="Paste your Torn API key" aria-describedby="api-key-guidance" onChange={() => { if (error) setError(null); }} />
                <button type="button" disabled={loading} onClick={() => setVisible((value) => !value)} aria-label={visible ? "Hide API key" : "Show API key"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
              <small id="api-key-guidance">
                <span><ShieldCheck size={13} /> Limited Access is enough</span>
                <a href="https://www.torn.com/preferences.php#tab=api" target="_blank" rel="noreferrer">Create a key <ExternalLink size={12} /></a>
              </small>
            </div>

            <label className="login-remember">
              <span className="login-remember__text"><strong>Keep me signed in</strong><small>Remember this browser for 30 days</small></span>
              <input name="remember" type="checkbox" defaultChecked disabled={loading} />
              <span className="login-remember__track" aria-hidden="true"><span /></span>
            </label>

            {error && <div className="form-error" role="alert"><AlertTriangle size={17} /><div><strong>{errorTitle(error.code)}</strong><span>{error.message}</span><small>{errorGuidance(error.code)}</small></div></div>}

            <button type="submit" className="button button--primary connect-submit" data-state={loading ? "loading" : "idle"} disabled={loading || networkOffline}>
              <span className="connect-submit__text">
                <span key={loading ? "verifying" : "enter"}>{loading ? "Verifying securely…" : "Enter workspace"}</span>
              </span>
              <span className="connect-submit__ind" aria-hidden="true">
                <ArrowRight className="connect-submit__arrow" size={16} />
                <span className="connect-submit__spin">
                  <svg className="connect-submit__spin-svg" viewBox="0 0 20 20">
                    <circle className="connect-submit__spin-track" cx="10" cy="10" r="7" />
                    <circle className="connect-submit__spin-head" cx="10" cy="10" r="7" pathLength={100} />
                  </svg>
                </span>
              </span>
            </button>

            <span className="connect-trust"><ShieldCheck size={13} /> Encrypted server-side. Never stored in your browser.</span>

            <span className="connect-footer-link">Need a key? <a href="https://www.torn.com/preferences.php#tab=api" target="_blank" rel="noreferrer">Create one <ExternalLink size={12} /></a></span>

            {offlineEnabled && <details className="offline-test-entry">
              <summary><Laptop size={15} /> Open an offline test workspace <ChevronDown size={15} /></summary>
              <p>Development fixture only. Never available in production.</p>
              <div><button type="button" disabled={loading} onClick={() => void openOfflineSession("member")}><KeyRound size={14} /><span><strong>Faction tester</strong><small>Preview member access</small></span></button><button type="button" disabled={loading} onClick={() => void openOfflineSession("owner")}><UserRoundCog size={14} /><span><strong>Owner reviewer</strong><small>Preview owner access</small></span></button></div>
            </details>}
          </>
        )}
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

function isOptionsPayload(value: unknown): value is { options: Parameters<typeof startAuthentication>[0]["optionsJSON"] } {
  return Boolean(value && typeof value === "object" && "options" in value && value.options && typeof value.options === "object");
}

function isRegistrationOptionsPayload(value: unknown): value is { options: Parameters<typeof startRegistration>[0]["optionsJSON"] } {
  return Boolean(value && typeof value === "object" && "options" in value && value.options && typeof value.options === "object");
}

/** A network-level fetch failure (no response reached the server) surfaces as a TypeError in every major browser. */
function connectionErrorFrom(cause: unknown, fallbackMessage: string): ConnectionError {
  if (cause instanceof TypeError) {
    return { message: "You appear to be offline. Check your connection and try again.", code: "OFFLINE" };
  }
  return {
    message: cause instanceof Error ? cause.message : fallbackMessage,
    code: cause instanceof Error && "code" in cause && typeof cause.code === "string" ? cause.code : null,
  };
}

function errorTitle(code: string | null): string {
  if (code === "INVALID_KEY") return "Torn rejected this key";
  if (code === "KEY_PAUSED") return "This key is not active";
  if (code === "MISSING_SELECTIONS" || code === "INSUFFICIENT_PERMISSION") return "More API access is required";
  if (code === "RATE_LIMITED" || code === "API_UNAVAILABLE") return "Torn API is temporarily unavailable";
  if (code === "CREDENTIAL_REVOKED") return "This passkey no longer works";
  if (code === "OFFLINE") return "You're offline";
  return "Connection could not be verified";
}

function errorGuidance(code: string | null): string {
  if (code === "INVALID_KEY") return "Check for a rotated or deleted key, then copy its value again from Torn Settings → API Keys.";
  if (code === "KEY_PAUSED") return "Resume the key in Torn, or create a new Limited Access key, before retrying.";
  if (code === "MISSING_SELECTIONS" || code === "INSUFFICIENT_PERMISSION") return "Use a Limited Access key, or a custom key containing user basic and profile plus faction basic, chain, chains, chainreport, and members.";
  if (code === "CREDENTIAL_REVOKED") return "The API key behind this passkey was rotated or deleted in Torn. Sign in with your current key to keep using this workspace.";
  if (code === "OFFLINE") return "No request reached Chainward. Check your connection and try again.";
  return "No connection was saved and no unverified Torn values will be displayed.";
}
