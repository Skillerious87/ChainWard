"use client";

import { useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { ApiUseDisclosure } from "@/components/onboarding/api-use-disclosure";
import { API_POOL_POLICY_VERSION, type ApiPoolStatus } from "@/lib/torn/api-pool-types";

export function ApiPoolSettings() {
  const [status, setStatus] = useState<ApiPoolStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [limit, setLimit] = useState(10);
  const [allowOffline, setAllowOffline] = useState(false);
  const [allowBackground, setAllowBackground] = useState(false);
  const [consent, setConsent] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/settings/api-pool", { cache: "no-store", credentials: "same-origin" }).then(async (response) => {
      const result = await response.json() as ApiPoolStatus & { error?: string };
      if (!active) return;
      if (!response.ok || !result.available) {
        setUnavailable(true);
        setMessage(result.error ?? "Contribution settings are unavailable.");
        return;
      }
      setStatus(result);
      setLimit(result.limitPerMinute);
      setAllowOffline(result.allowOffline);
      setAllowBackground(result.allowBackground);
    }).catch(() => { if (active) setMessage("Contribution settings could not be loaded. Try again after reconnecting."); });
    return () => { active = false; };
  }, []);

  async function update(remove: boolean) {
    if (working) return;
    setWorking(true);
    setMessage("");
    try {
      const response = await fetch("/api/settings/api-pool", {
        method: remove ? "DELETE" : "PUT",
        credentials: "same-origin",
        cache: "no-store",
        headers: remove ? undefined : { "content-type": "application/json" },
        body: remove ? undefined : JSON.stringify({ ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), limitPerMinute: limit, allowOffline, allowBackground, acceptContribution: consent, policyVersion: API_POOL_POLICY_VERSION }),
      });
      const result = await response.json() as ApiPoolStatus & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The contribution could not be updated.");
      setStatus(result);
      setApiKey("");
      setConsent(false);
      setMessage(remove ? "Your contribution key has been removed. New calls have stopped; your login is unchanged." : "Your contribution is active within your chosen allowance.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The contribution could not be updated.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="settings-subsection api-pool-settings" aria-labelledby="api-pool-title">
      <header><h3 id="api-pool-title"><ShieldCheck size={16} /> Shared faction API capacity</h3><p>Help your faction stay current while spreading the remaining API work. Shared snapshots reduce repeated calls for everyone.</p></header>
      {status && <dl className="settings-detail-list">
        <div><dt>Your contribution</dt><dd>{status.enabled ? `Active · key ending ${status.lastFour}` : "Not contributing"}</dd></div>
        <div><dt>Calls in the last minute</dt><dd>{status.requestsLastMinute} Chainward calls, including {status.contributionsLastMinute} contributions</dd></div>
        <div><dt>Last contribution</dt><dd>{status.lastUsedAt ? new Date(status.lastUsedAt).toLocaleString("en-GB") : "None yet"}</dd></div>
      </dl>}
      {status?.lastError && <p role="status">{status.lastError}</p>}
      <p>Chainward permits up to 30 calls per player per minute, including up to 10 contributions. Other apps use the same Torn allowance, so spare capacity cannot be guaranteed.</p>
      <ApiUseDisclosure contribution />
      {!unavailable && <>
        <label className="api-pool-settings__field"><span>Public Only contribution key</span><input type="password" autoComplete="off" spellCheck={false} maxLength={16} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status?.lastFour ? `Keep key ending ${status.lastFour}, or enter a replacement` : "Enter a separate 16-character Public Only key"} disabled={working} /></label>
        <label className="api-pool-settings__field"><span>Maximum contributions per minute</span><select value={limit} onChange={(event) => setLimit(Number(event.target.value))} disabled={working}>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((amount) => <option key={amount} value={amount}>{amount} calls per minute</option>)}</select></label>
        <label className="api-pool-settings__choice"><input type="checkbox" checked={allowOffline} disabled={working} onChange={(event) => { setAllowOffline(event.target.checked); if (!event.target.checked) setAllowBackground(false); }} /><span>Allow my key to help active faction viewers while I am offline.</span></label>
        <label className="api-pool-settings__choice"><input type="checkbox" checked={allowBackground} disabled={working || !allowOffline} onChange={(event) => setAllowBackground(event.target.checked)} /><span>Also allow my key to power the faction&apos;s enabled background push monitoring.</span></label>
        <label className="api-pool-settings__choice"><input type="checkbox" checked={consent} disabled={working} onChange={(event) => setConsent(event.target.checked)} /><span>I authorise the faction API use described here, within this allowance and the options I selected. I can remove my contribution at any time.</span></label>
        <div className="settings-view-actions">
          <button type="button" className="button button--secondary" disabled={working || !status || !consent || (!apiKey.trim() && !status.lastFour)} onClick={() => void update(false)}><RefreshCw size={15} /> {working ? "Updating…" : status?.enabled ? "Save contribution" : "Enable contribution"}</button>
          {status?.lastFour && <button type="button" className="button button--quiet" disabled={working} onClick={() => void update(true)}><Trash2 size={15} /> Stop and remove key</button>}
        </div>
      </>}
      {message && <p role="status" aria-live="polite">{message}</p>}
    </section>
  );
}
