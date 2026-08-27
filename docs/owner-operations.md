# Chainward owner operations

This guide describes the manual faction-licensing and reward-payment workflows.
Chainward records decisions; it does not claim to read or verify Torn item
transfers automatically.

## Administration boundary

The administration route is available only when the currently validated Torn
identity is **Skillerious [3212954]**. The page and every review action check the
identity independently on the server. Hiding the navigation item is not the
security boundary.

For local testing, the purchase queue, licences, users, and audit records use
the temporary project SQLite database. A released multi-user service must use
PostgreSQL so every server instance and every faction sees the same durable
licence register. Local SQLite is not a shared production licence service.

## How a faction purchase reaches the queue

1. A faction member connects a supported Torn API key. Chainward identifies the
   player and faction from the API response.
2. The member opens **Unlock Chainward**, selects a term, and receives a payment
   reference such as `CW-51393-A1B2C3D4`.
3. The member submits the request before sending items. Chainward stores the player, faction, plan,
   expected quantity, reference, and submission time in one database
   transaction and writes an audit event.
4. From the locked pending view, the member sends the displayed Xanax quantity
   to Skillerious [3212954] in Torn and includes that exact reference.
5. The faction sees the review state. A second open request cannot be
   created for the same faction.

Submitting the request is not proof of payment. It only creates a record that
can be matched against evidence reviewed manually in Torn.

## Unique identifiers

| Identifier | Example | Purpose |
| --- | --- | --- |
| Torn user ID | `3212954` | Stable purchaser or owner identity returned by Torn. |
| Torn faction ID | `51393` | Binds a request and licence to one faction. |
| Payment reference | `CW-51393-A1B2C3D4` | Customer-visible identifier that must accompany the item transfer. It is unique in the licence database. |
| Request UUID | `1f96…` | Internal immutable access-request record. The console shows its first eight characters for quick comparison. |
| Licence UUID | `8c21…` | Internal active-licence record created after approval. |
| Torn chain ID | `58410291` | Connects a completed Torn report to its reward snapshot and payout entries. |
| Payout UUID | database generated | Identifies one member reward in the PostgreSQL ledger. SQLite uses a faction/chain/member composite identity. |

The payment reference is the operational matching key. The request UUID is a
database identity and should not replace the payment reference in Torn.

## Reviewing a purchase as Skillerious

1. Connect Chainward using the Torn identity **Skillerious [3212954]**.
2. Open **Administration**. A non-owner receives a not-found response even if
   they type the route manually.
3. In **Faction access queue**, search by faction, player, request ID, or
   payment reference.
4. Press **Review payment** and compare all four facts:
   - the Torn sender matches the submitted player;
   - the request faction ID is correct;
   - the transferred Xanax quantity matches the selected plan;
   - the transfer contains the exact `CW-…` reference.
5. Check the manual-verification box and type the payment reference exactly.
   The activation button remains locked until both checks pass.
6. Add an optional private note describing where or when the evidence was
   reviewed, then press **Activate faction licence**.

Approval runs as one database transaction. It rechecks the owner, request
state, plan, exact reference, and conflicting active licences. It then marks
the request approved, creates or activates the licence, calculates the expiry,
records the reviewer, and writes an audit event. The faction’s top-bar control
turns into the green protected-access badge after refresh.

If evidence is incomplete, use **Request information** and enter a clear note.
The request remains open and the message appears in the faction’s pending
request dialog. If the request is invalid, use **Reject** and enter a private
reason. Neither action creates a licence.

## Licence terms

| Term | Expected payment | Access duration |
| --- | ---: | ---: |
| Monthly | 2 Xanax | 30 days from approval |
| Quarterly | 5 Xanax | 90 days from approval |
| Annual | 18 Xanax | 365 days from approval |
| Lifetime | 60 Xanax | No expiry |

Expiry begins at approval time, not request-submission time. A stored ACTIVE
record whose expiry has passed is not treated as valid access.

## Paying faction chain rewards

1. Open **Reward schemes**, define non-overlapping hit ranges, set the reward
   per range, save the scheme, and make the intended scheme the default.
2. Open **Chain history** and choose a completed chain returned by Torn.
3. Review the report’s per-member hit count, calculated tier, and reward. The
   page names the exact scheme version used.
4. Send the listed rewards to members in Torn. Chainward does not perform the
   transfers.
5. Only after every listed transfer is complete, press **Mark chain paid** and
   confirm the total and member count.

The PAID action stores an immutable calculation. With PostgreSQL it also stores
the chain, contributions, reward snapshot, and one ledger decision per member.
Payable rewards are marked PAID; zero-reward decisions are shown as Not eligible
and never count as a payment. With local SQLite it stores the complete per-member snapshot in the
local database file. Used reward schemes become version-locked so later edits
create a new version instead of changing historical calculations.

The **Payout ledger** can then be searched, filtered, and exported. A Torn chain
report by itself never marks a reward as paid.

## Backup boundary

Portable JSON backups include reward schemes and selected faction settings.
They deliberately exclude API credentials, licence approvals, access audit
records, and paid-chain history. Use the PostgreSQL full-backup commands for a
complete owner-console recovery.
