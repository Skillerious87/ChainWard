export function ApiUseDisclosure({ contribution = false }: { contribution?: boolean }) {
  return (
    <div className="api-use-disclosure">
      <p><strong>{contribution ? "Faction API contribution" : "How Chainward uses your Torn API key"}</strong></p>
      <div className="api-use-disclosure__table">
        <table>
          <thead><tr><th>Data storage</th><th>Data sharing</th><th>Purpose of use</th><th>Key storage &amp; sharing</th><th>Key access level</th></tr></thead>
          <tbody><tr>
            <td>{contribution ? "Live snapshots expire after refresh. Consent and the encrypted key remain until removed; short-lived request counters support limits." : "Faction records persist in the workspace database. Temporary API snapshots expire after refresh."}</td>
            <td>{contribution ? "Common faction data is served only to authorised members of your own faction. Personal data is excluded." : "Your own private views and feature-authorised faction members. Common faction snapshots may be reused within your faction."}</td>
            <td>{contribution ? "Refresh shared chain, roster, faction and chain-report data within your chosen allowance. Offline and background use require separate permission." : "Verify identity and faction; display faction operations and the personal features you use. Contribution to other members' API calls is separately opt-in."}</td>
            <td>{contribution ? "Encrypted on the server; sent only to Torn. Never given to other players or services. Removal stops new calls; calls already sent cannot be recalled." : "Remembered keys are encrypted on the server; temporary connections use an encrypted HttpOnly session cookie. Plaintext keys are never returned to other players."}</td>
            <td>{contribution ? "Public Only. A separate key does not add quota: Torn limits calls across all your keys combined." : "Public Only for faction views; Limited for optional personal battle stats, attacks and events. Custom keys require the selections described in key help."}</td>
          </tr></tbody>
        </table>
      </div>
      {!contribution && <p>Custom keys require key/info, user/basic, user/profile, faction/basic, faction/chain, faction/chains, faction/chainreport and faction/members. Authored member reports and awards persist in the workspace; their audience is faction-visible or leadership-only. Temporary sessions last up to 12 hours; remembered sessions renew for 30 days of inactivity.</p>}
    </div>
  );
}
