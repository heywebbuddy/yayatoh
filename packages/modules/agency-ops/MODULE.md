# agency-ops (tier 7)

Agency v2 operations (M6.8b, P6-8), behind the platform switch `agency_v2` and the `agency`
entitlement. Owns Postgres schema `agency_ops`. Builds on agency v1 (grants in tenancy, the
`agency` module's snapshots) and calls templates, campaigns, audiences, events and tenancy down
the tiers.

**Invariants**
- **Published downward = copied.** A template or brand kit published to a client becomes the
  client's own row in the client's org (a normal template; a kit in its library), written by the
  agency person **acting through the client's live grant** (`viaGrantCtx`), so the client's
  authorizer (grant role, team and day-of rules), audit (`viaAgency`) and row security apply.
- **Private parts never leave the agency.** Template private notes (`template_settings`) and
  kept-back parts (`questions`, `seating`, removed by `publicSnapshot`) and brand kits' private
  notes are never sent; a CHECK keeps notes off received kits.
- **Fan-out never mixes orgs.** One agency message becomes one campaign per client in that
  client's org with the client's own segment, footer (postal address) and send: its consent and
  suppression rules decide recipients (campaigns' recipient snapshot). The agency stores only
  ids and statuses (`fanout_targets`), never a recipient.
- **Detach keeps the client's data.** `agencyOps.detachAgency` (client, `members:manage`) and the
  agency's handover (`agency:manage` + step-up, then the same command as a system actor of the
  client) delete nothing of the client's: they revoke the grant and every team place and day-of
  pass under it, and clear the links back to the agency's originals. Event
  `agency_ops.client_detached@1` marks the agency's side (subscriber `agency-ops.detached`).
- **Team and day-of grants** are client-owned rows in `tenancy.agency_staff_grants`, read per
  request by `tenancy.agency_access()`; the agency writes them under the client's tenant only after
  checking its live grant; the agency reads them back through `tenancy.agency_staff_of_agency()`.
- Cross-org reads only through SECURITY DEFINER functions (`tenancy.agency_client_grants`,
  `tenancy.agency_staff_of_agency`); nothing here reads another org's tables directly.

**Public surface:** `.` (commands, queries, the publish / fan-out / handover orchestrators, the
subscriber, pure rules in `domain.ts`).
