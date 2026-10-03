# agency (tier 6)

Agency v1 (M6.7a, P6-8): the agency's **Clients | Events | Marketing | Reports** pages. Owns
Postgres schema `agency` (`client_snapshots`, `event_snapshots`), both owned by the **agency**
org. Grants themselves live in tenancy (`tenancy.org_access_grants`, owned by the client).

**Invariants**
- The agency's pages read only the agency's own snapshot rows, joined to the **live** grant list
  (`tenancy.agency_client_grants()`, a SECURITY DEFINER function that takes the agency from the
  transaction). A revoked client disappears at once; nothing on these pages reads a client table.
- Snapshots are computed under the **client's** tenant (a system actor of the client org) from the
  client's projections and exported read functions only (`eventHeadlineTx` over
  `reports.metric_snapshots`, events, marketing analytics totals), then written into the agency's
  tenant. Writers: `agency.refreshSnapshots` (the Reports page, `agency:read` + entitlement
  `agency`) and the `agency.snapshots` subscriber (grant created, changed or revoked).
- Money (gross sales) is stored only when the client opted in to finance (`with_finance`, CHECK), and
  shown only while the live grant still has the opt-in.
- Clients pay for themselves (D23): nothing here moves or bills money.
- Tier 6: it reads reports and marketing (tier 5) and is imported only by the apps.

**Public surface:** `.` (queries, the refresh command, the subscriber, pure report totals).
