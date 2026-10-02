# ADR 0022 — Phase 6 module layout

- **Status:** Accepted (M6.1a, 2026-10-02), within the owner-approved Phase 6 plan (P6-1 to P6-13).
- **Relates to:** ADR 0001 (modular monolith), ADR 0008 (outbox), ADR 0013 (profiles, entitlements), ADR 0021 (Phase 5 layout), roadmap §3.5 (tiers), `docs/plans/phase-6.md` §3.

## Context
- Phase 6 adds a CRM v2 (merge, timeline, stats, DSAR propagation), a warehouse, integrations, billing activation, agency, virtual events, advanced seating and marketplace search (M6.1–M6.14).
- `docs/plans/phase-6.md` §3 names the new modules and tiers: `analytics` (6), `integrations` (6), `agency` (5), `virtual` (4); `crm`, `billing`, `seating` and `marketplace` grow in place.
- Wave 1 runs eight sessions in parallel (M6.1a/b/c, M6.3a/b, M6.6a, M6.11a/b). Several of them touch every module that holds a person: merge (M6.1a), stats (M6.1b) and DSAR propagation (M6.1c). Without one rule for "a person's rows in another module", each would invent its own.
- crm is tier 1: it can never import the modules that reference contacts (attendees 2, orders 4, surveys 5, campaigns 6…). Roadmap §3.5 rule 3 says writes go down by call, up or sideways by events or ports.

## Decision

### Modules and tiers
| Module | Tier | Owns (schema) | Phase 6 increments |
|---|---|---|---|
| `crm` (grows) | 1 | `crm`: contacts (+ `company`), consents, participation and profile projections, **merges and their moves ledger, duplicate candidates and scans, the person timeline** (M6.1a), `contact_stats` scoring (M6.1b), DSAR receipts (M6.1c) | M6.1a–c |
| `audiences` (grows) | 5 | `audiences`: segments; hosts the people-level reads that need names from lower tiers (the timeline query with event names) and the participation projection's merge step | M6.1a |
| `analytics` (new) | 6 | `analytics`: warehouse port, rollups, explorer, scheduled reports | M6.2a/b |
| `integrations` (new) | 6 | `integrations`: connections, mappings, sync runs, errors | M6.4a–d, M6.5b–d |
| `billing` (grows) | 1 | `billing`: plans, prices, entitlement features, meters (dormant) | M6.6a/b |
| `agency` (new) | 5 | `agency`: grants, snapshots, commission (v2) | M6.7a, M6.8a/b |
| `virtual` (new) | 4 | `virtual`: delivery modes, playback grants, watch time, CE rules | M6.9a/b, M6.10a |
| `seating` (grows) | 3 | best available, ADA, channels, layout revisions | M6.11a/b, M6.12a |
| `marketplace` (grows) | 6 | search index port, moderation, venues | M6.14a/b |

### A person's rows in other modules: contact reference owners
- **Every module that stores a reference to a crm contact owns moving it.** The house convention is a uuid column named `contact_id` or `*_contact_id`. The module exports a `ContactReferenceOwner` (`@yayatoh/crm`): `columns` (the `schema.table.column`s it covers), `move` (re-point the duplicate's rows to the record that stays and return exactly the rows moved, keeping a row on the duplicate when moving it would break the module's own unique key) and `restore` (move back exactly the recorded rows). It writes only its own tables.
- **Each app's composition root registers the owners** (`registerContactReferenceOwners`, like the key vault): `apps/web/src/server/ports.ts` and the test ports. The merge command calls them **inside its own transaction**, references first and projections last (`phase: 'projections'`, the participation recompute), so a merge is atomic: every reference moves, or none.
- **The merge refuses while any contact column in the database has no owner.** `uncoveredContactColumnsTx` reads the catalog (every `contact_id` / `*_contact_id` uuid column outside `crm`) and compares it with the registered owners. A new module (donations, RSVP, DSAR…) that forgets to register can never merge half a person; the integration test fails the same way.
- **crm records every moved row** in `crm.contact_merge_moves` (unique per merge, table and row): an undo moves exactly those back, and the ledger proves "exactly once".
- **`crm.contacts_merged@1` and `crm.contacts_unmerged@1`** (outbox, after commit) tell read models, webhooks and future connectors what happened; owners never depend on them to move rows.
- **M6.1c (DSAR propagation) and M6.1b (stats)** should use the same registry shape (an owner per module that erases/exports or summarizes its own rows) rather than a second mechanism.

### The person timeline is a crm projection fed by its owners
- `crm.timeline_entries`: one row per fact, written only through `recordTimelineTx`, exactly once per `(kind, source_ref)`, never read with joins. Each owning module has a small outbox subscriber (`orders.timeline`, `checkin.timeline`, `messaging.timeline`, `surveys.timeline`, `campaigns.timeline`) that calls crm down the tiers. The kinds are fixed in crm (`TIMELINE_KINDS`); a new source (donations, RSVPs, session attendance) adds a subscriber, not a table.
- A fact names its **subject** (the order, attendee record, recipient row, invitation): an undo moves an entry back with its subject, so facts recorded while two records were merged return to the right one.

### Why not the alternatives
- **Only outbox events (`crm.contacts_merged@1` handled by each module).** Rejected for moving rows: each subscriber commits on its own, so for a while a merge is half applied; the participation projection would recompute before attendees and orders moved; an undo would race the forward handlers. Events stay for read models.
- **A tier-6 orchestrator importing every module.** Rejected: tier-6 owners (campaigns, automations) are siblings it may not call, and the orchestrator would grow with every module. The port keeps each module's write in that module.
- **crm writes the other schemas itself.** Rejected: roadmap §3.5 rule 2.
- **Timeline as a runtime query (the M1.8 `reports.contactTimeline`).** Rejected for M6.1: it joins four modules per page view and cannot page by time across them.

## Consequences
- Modules that reference contacts gain a `contact-merge.ts` and an owner export; apps register them. checkin, guests and surveys now depend on crm (down the tiers).
- A new table with a contact column must ship its owner in the same change, or merges stop (by design).
- `upsertContactTx`, `upsertContactsTx` and `contactIdByEmailTx` follow `merged_into`: a merged-away address resolves to the record that stays.
- Erasure scrubs merge snapshots (such a merge can no longer be undone).

## Revisit when
- A module needs to move contact references that are not in a `contact_id`-named column (rename it, or extend the catalog rule).
- A merge regularly touches more rows than one transaction should hold (then: chunked moves with the ledger as the resume point).
