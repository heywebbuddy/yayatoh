# Spec: M6.12 — AI seating and AI v2

- **Milestone:** M6.12 (roadmap Phase 6; plan `docs/plans/phase-6.md`, rows M6.12A and M6.12B)
- **Status:** M6.12a built (2026-10-03: seating rules and the solver); M6.12b (AI v2) to follow
- **Risk tags:** `db-migration`, `tenancy`
- **Related decisions and ADRs:** P6-1 (behind flags), P6-10 (tabu search in a Web Worker, editable proposals, never overwrite manual placements), P6-12 (CP-SAT later), P6-13 (`ai_seating` entitlement), D25; ADR 0012 (seating), 0018/0022 (tokens)

## M6.12a — seating rules and solver (built 2026-10-03)

### 1. Goal and users
A host with hundreds of guests sets a few rules ("keep each party together", "keep the Acme and
Globex tables apart", "VIP parties nearest the stage", "guests tagged Accessibility near an
exit", "at most 8 per table"), presses one button and gets a proposal for everyone still in the
queue within seconds. They read it as text, move anyone with a table chooser, and accept one table
or all. Nobody they seated by hand ever moves.

### 2. References
- **Plan:** `docs/plans/phase-6.md` row M6.12A ("Rule builder; tabu search in a Web Worker producing editable proposals; accept per table or all"). Acceptance: "400 guests seated in ≤ 5 s with no hard-rule violations; manual placements are never overwritten".
- **Brief:** `docs/agent-briefs/m6.12a.md`.
- **Built on:** M4.3a guest seating (`guest_seats`, the `OccupantDirectory` port, the chart chooser), M4.2b gala tables, M1.7 floor plans (stages, exits and entrances are plan objects).
- **Legacy evidence:** none (Eventmie Pro has no seating solver).

### 3. Scope
**In (built):**
- **Auto-seat** (`/o/{org}/e/{event}/seating/solver`, a new "Auto-seat" tab on every seating view of an org with the `guests` and `ai_seating` modules; the Seating section guard applies). The chart chooser is the guest seating editor's (`?sub=`).
- **Rule builder:** the event's rules in words ("Keep the Bride side apart from the Groom side", "Soft · weight 8"), each with a Strength chooser (Hard / Soft), a Weight (1–10), Save and Remove. "Add a rule": Rule (Keep together, Keep apart, VIP nearest the stage, Accessibility needs near exits, Table maximum), then who it is about (each party, a party, everyone with a tag, everyone on a side; tag and side fields suggest the list's own values), Hard/Soft radios and the weight. Inline validation before sending ("Choose who the rule is about.", "Choose two different groups.", "Enter a weight from 1 to 10.", "Enter a number from 1 to 40."); server refusals in words ("This event already has that rule.", "An event can have at most 50 rules.", "That party isn't on this guest list.").
- **Solver (`domain/solver.ts`, pure):** a tabu search over units (guests; a hard together group that fits a table is one unit) and places (tables and rows: room = seats − tickets/attendee seats − guests who declined but are still seated − manual placements; a hard table maximum lowers it). Greedy start (most constrained and biggest units first, best fit), then sampled moves and swaps with a tabu tenure and aspiration; integer costs: a hard breach 1,000,000, a guest left in the queue 1,000, a soft breach its weight. Hard zones (VIP near the stage, accessibility near exits) are the nearest tables whose room holds everyone concerned. Capacity is never exceeded. Deterministic for a seed (mulberry32); runs in steps; the same `evaluate` scores any state from scratch (the editor after each edit, the accept command, the tests).
- **Web Worker** (`solver.worker.ts`, `useSolver`): the page sends the chart and an "arrangement number" (the seed: the same number gives the same proposal); progress arrives as a progress bar and a polite live line; **Stop** cancels (nothing is proposed). "Try another arrangement" runs the next number.
- **Proposal review (the accessible alternative to dragging):** a text summary ("Proposal ready in 0.1 s (arrangement 1).", "6 guests at 2 tables; nobody left in the queue.", "No hard rule is broken.", "Soft rules: penalty 0 (0 is best).", one line per rule: "Keep each party together: kept" / "2 breaks", and notices: no stage, no exit, a group bigger than any table, too few seats). Then each proposed table as a region ("Table 3", "4 proposed · 0 seated · 0 of 4 free") listing its guests ("Luis X (Garcia)") with a **"Table for Luis X"** chooser (every table with its free count, or "Leave in the queue"), and "Left in the queue". Edits re-score at once; a table over its free seats or breaking a hard rule shows a warning and its accept button is disabled ("Fix the tables marked with a warning first.").
- **Accept** one table ("Accept table 3") or all ("Accept all tables") through `seating.acceptSeatingProposal`; success: "Table 3 accepted: 2 guests seated." / "Proposal accepted: 400 guests seated."; the page re-reads (accepted guests become manual placements). Refusals in words: someone seated by hand meanwhile, a guest who declined, a hard rule, "Only 1 more fit at that table."
- **Server (`seating`, module `ai_seating`):** `solver_rules` (per event, cascades with it); `seating.solverRules` / `seating.solverSetup` (`guests:read`); `seating.addSolverRule` / `updateSolverRule` / `removeSolverRule` (`seating:write`, audited); `seating.acceptSeatingProposal` (`seating:write`, idempotent, audited with counts only; see MODULE.md for its checks).
- **Permissions:** viewers read the rules, can run the solver and read a proposal, but see no rule forms, table choosers or accept buttons; the commands refuse them.
- **Dev/CI:** `POST /api/dev/seating-solver` (dev auth only) builds a 44-table ballroom with a stage and an exit and 400 guests in parties of 1–6 for the browser test.

**Later / not yet:**
- "Unlock and re-plan everyone" (today every seated guest is fixed) — pending owner.
- An audited override for accepting a hard-rule break — pending owner (today refused).
- Reading sealed accessibility answers as a flag — pending owner (P4-3; today a party tag).
- Seat-level placement (chairs) and dragging guests on the map inside a proposal; the list is the editor for now.
- The CP-SAT service (D25, P6-12) if a customer's rooms beat the Worker.
- `/v1` resources for rules and proposals.

### 4. `touches:`
```yaml
touches:
  - packages/modules/seating/src/{domain/solver,domain/solver-rules,solver,schema,private-columns,guest-seating,client,index}.ts, MODULE.md
  - packages/modules/seating/tests/solver.test.ts
  - packages/platform/src/modules.ts (ai_seating)
  - packages/db/drizzle/0114_old_blue_blade.sql (+ meta; renumbered at merge)
  - packages/testing/src/fixtures.ts, tests/seating-solver.int.test.ts
  - apps/web/src/app/[locale]/o/[org]/e/[event]/seating/solver/{page,actions}.ts(x)
  - apps/web/src/app/[locale]/o/[org]/e/[event]/seating/{page,assign/page,rules/page,finder/page,guests/page}.tsx (the tab)
  - apps/web/src/components/seating-solver/{seating-solver,solver-rules,solver-proposal}.tsx, {solver.worker,use-solver}.ts
  - apps/web/src/components/seating-tabs.tsx
  - apps/web/src/app/api/dev/seating-solver/route.ts
  - apps/web/messages/*.json (seating.tabs.solver, seating.solver.*)
  - apps/web/tests/solver-worker.test.ts, e2e/seating-solver.spec.ts
  - docs/specs/M6.12/spec.md, docs/owner-inbox.md
```

### 5. Migration
`0114_old_blue_blade.sql`: new table `seating.solver_rules` (RLS enabled and forced, the tenant policy, `org_id`-leading indexes, CHECKs on kind, strength, weight 1–10 and params being an object). Hand-written (between `-- hand-written: begin/end`): the composite FK `(org_id, event_id)` → `events.events` `ON DELETE CASCADE`, and `INSERT INTO billing.plan_modules ('launch_standard', 'ai_seating')` (free in beta, P6-13). Additive only.

### 6. Acceptance
| ID | Criterion | Test |
|---|---|---|
| AC-M6.12a-1 | 400 guests seated in ≤ 5 s in the headless browser, no hard-rule violations, soft score reported | `e2e/seating-solver.spec.ts` ("400 guests seated in at most 5 seconds…"); `seating/tests/solver.test.ts` ("seats 400 guests…"); `apps/web/tests/solver-worker.test.ts` |
| AC-M6.12a-2 | Manual placements are never overwritten (property over random locks) | `seating/tests/solver.test.ts` ("never moves a manual placement (property over random locks)"); `seating-solver.int.test.ts` ("never overwrites a manual placement made after the proposal"); `e2e/seating-solver.spec.ts` ("a manual placement made after the proposal is never overwritten") |
| AC-M6.12a-3 | Deterministic for a seed; cancellable; progress reported | `solver.test.ts` ("is deterministic for a seed", "steps, reports progress and can stop early"); `solver-worker.test.ts` |
| AC-M6.12a-4 | Hard rules never broken by a proposal; soft rules scored by weight | `solver.test.ts` (keep apart, table maximum, VIP, incremental cost = full evaluation) |
| AC-M6.12a-5 | Accepting goes through commands: audited, idempotent; per table or all | `seating-solver.int.test.ts` ("accepts one table, then all; idempotent; audited; manual placements stay") |
| AC-M6.12a-6 | Accept refuses what doesn't fit or breaks a hard rule; nothing changes | `seating-solver.int.test.ts` ("refuses what doesn't fit and what breaks a hard rule") |
| AC-M6.12a-7 | Isolation, permissions, the `ai_seating` module gate | `seating-solver.int.test.ts` (viewer, other org, module revoked); isolation suite (fixture rule for both orgs) |
| AC-M6.12a-8 | E2E: build rules, run, review, accept one table then all; keyboard only; axe both themes; RTL | `e2e/seating-solver.spec.ts` (keyboard test, viewer, empty states, Arabic) |
| AC-M6.12a-9 | An accessible alternative to drag; 24 px targets | the list-based "Table for …" choosers and the text summary (keyboard e2e; axe) |

## M6.12b — AI v2 (built 2026-10-03)

### 1. Goal and users
Organizers and marketers get a first draft in their own voice: campaign emails, site pages and agenda
sessions, in a chosen **tone** and **brand kit**; marketers describe who they want to reach and get an
audience in the builder's own rules; attendees who opted in to networking see the people closest to
them at the event. AI never sends, publishes or saves anything: every result is an editable preview.

### 2. References
- **Plan:** Phase 6, row M6.12B (acceptance: *matchmaking never includes someone not opted in; AI usage meters exactly*); brief `docs/agent-briefs/m6.12b.md`.
- **Decisions:** P6-10 (Claude behind the existing port, fake in CI; pgvector matchmaking for opted-in profiles; AI counts against the AI meter), P6-7 / D12 (credits and the AI meter), P6-13 (behind the `ai` entitlement), P5-3 (networking privacy).
- **Builds on:** M1.4f (`AiDrafter`, credits ledger), M3.6 (segment DSL, builder), M3.6b (campaign blocks), M1.4g (CMS), M1.4f program sessions, M5.8a (networking profiles), M6.6b (meters; stacked from `agent/m6.6b`).

### 3. Scope (built)
- **The port** (`packages/modules/ai/src/drafter.ts`): `AiDrafter` gains `compose(req)` (a v2 draft; the reply is one JSON object) and `embed(texts)` (512-number vectors). `fakeDrafter` is deterministic (tone openers, the kit's first preferred word, hashed bag-of-words vectors); `anthropicDrafter` stays a stub that builds the hardened prompt; Claude has no embeddings endpoint (owner inbox).
- **Prompt hygiene** (`domain/compose.ts`): the brief, the brand voice and the event facts travel in one `<organizer_data>` JSON block with `<`, `>`, `&` escaped; the instructions forbid obeying it. Replies are parsed and cleaned: campaigns to plain text (tags and merge braces dropped), pages to the Markdown subset (no headings, HTML or images), agenda sessions kept only inside the event's wall-clock dates, ordered and without overlaps; an audience suggestion must parse as a `SegmentDefinition` and reference only the org's offered events (no smuggled ids).
- **Brand kits** (`ai.brand_kits`, `brand-kits.ts`): name (unique per org, case-insensitive), voice (≤ 600), default tone, ≤ 12 words to use / avoid (≤ 40 chars), one default, ≤ 20 per org. Page `/o/{org}/brand-kits` (Site & content → Brand kits), read `marketing:read`, write `marketing:write`.
- **Drafting v2** (`compose.ts`): `draftCampaign` (`messages:send`), `draftPage` (`marketing:write`), `draftAgenda` (`events:write`), `suggestAudience` (`messages:send`; sized with the builder's own `previewAudienceQuery`, so the money gate applies).
  - Campaign editor: "Draft with AI" (tone, kit, optional event, brief) → preview → "Use this draft" replaces the subject, preheader and heading/text/button blocks in the **unsaved** editor (images, event cards, dividers and the footer stay); the organizer edits and saves.
  - New page/post: the preview becomes a **draft** entry (`createEntryCommand`) opened in the editor.
  - Sessions page: proposed sessions as a checklist (times in the event's zone); the chosen ones go through `createSessionCommand` (the agenda stays unpublished until published).
  - Audiences: "Suggest an audience" → explanation, size and rule count → "Review in the builder" (`/audiences/new?suggestion=…`, base64url of the definition, re-validated server-side; a tampered one is refused) → saved there.
- **Credits and the meter** (`spend.ts`): every provider call spends one credit first, through a spend command whose permission is the feature's (`messagingCredits`, `contentCredits`, `eventCredits`), and is refunded once if the call fails or its result is unusable (`chargedCall`). The ledger's `ai.credits_spent@1` / `ai.credits_refunded@1` feed M6.6b's `ai_credits` meter, so meter rows equal ledger debits and refunds exactly. `credit_ledger.draft_kind` now records the purpose (`AI_PURPOSES`).
- **Matchmaking** (engagement `network_embeddings`, pgvector `vector(512)` in the `extensions` schema): `refreshMatchmaking` (organizer's "Update suggestions", `events:write`) embeds listed profiles without a vector, 64 per call (one credit each, ≤ 10 calls per refresh), from their public fields only (never names or emails); `storeEmbeddingsCommand` skips anyone who left meanwhile. Opting out, being hidden, editing the profile and erasure delete the vector in the same transaction. `suggestedMatchesQuery` is an exact cosine search within the event that re-checks both sides are listed, attending and unblocked, and leaves out existing connections; the attendee page shows "Suggested for you" (score and shared interests) once their profile is embedded. The console shows how many listed people have suggestions ready.
- **Infrastructure:** `docker-compose.yml` and CI use `pgvector/pgvector:pg18`; `db:bootstrap` (superuser) creates the extension; the migration only asserts it.

### 4. Later / not yet
- A real provider: the Anthropic adapter (key in Doppler) and an embeddings provider (e.g. Voyage AI) behind `embed` (owner inbox).
- Automatic embedding on opt-in / profile edit (a worker job) instead of the organizer's button (owner inbox).
- Drafting in the guest-site and event-page block editors beyond M1.4f's tagline/description/FAQ; brand kits published downward by agencies (M6.8).
- An ANN (HNSW) index if events grow past tens of thousands of opted-in people.

### 5. Migration
`0141_stale_iceman.sql` (renumbered at merge): new `ai.brand_kits` and `engagement.network_embeddings` (RLS enabled and forced, tenant policy, `org_id`-leading indexes, composite FK to `network_profiles` with cascade). Hand-written: `CREATE SCHEMA IF NOT EXISTS extensions` + `CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions` (a no-op when bootstrap/the runbook created it); the embedding column's type schema-qualified (`"extensions"."vector"(512)`); the widened `credit_ledger_draft_kind_check` re-added `NOT VALID` then `VALIDATE`d. Additive only. Stacking `agent/m6.6b` brought its migration as `0140_concerned_firedrake.sql`.

### 6. Acceptance
| ID | Criterion | Test |
|---|---|---|
| AC-M6.12b-1 | Matchmaking never includes someone not opted in, and drops a profile when it opts out (also hidden, edited, blocked) | `packages/testing/tests/ai-v2.int.test.ts` ("embeds only listed people…", "drops a profile when it opts out, is hidden or edits itself; blocks are respected"); `e2e/ai-v2.spec.ts` (matchmaking) |
| AC-M6.12b-2 | AI usage meters exactly: fixture calls = meter rows = ledger debits (refunds negative); replay records nothing | `ai-v2.int.test.ts` ("every call debits one credit; the AI meter equals debits minus refunds") |
| AC-M6.12b-3 | No prompt or embedding crosses orgs | `ai-v2.int.test.ts` ("org A's calls carry only org A's data…"); isolation suite (fixture rows in `brand_kits` and `network_embeddings` for both orgs) |
| AC-M6.12b-4 | Drafts with tone and brand kit; always editable, never auto-sent or published | `ai-v2.int.test.ts` (drafting v2); `ai/tests/compose.test.ts`; `e2e/ai-v2.spec.ts` (campaign, page, agenda) |
| AC-M6.12b-5 | Audience suggestions output a valid segment in the DSL, reviewed before saving | `compose.test.ts` (DSL and offered-events checks); `ai-v2.int.test.ts` (sized like the builder); `e2e/ai-v2.spec.ts` (accepted in the builder; tampered link refused) |
| AC-M6.12b-6 | Permissions, refunds, out of credits, AI off | `ai-v2.int.test.ts` ("who may draft what", "a failed call gives its credit back…"); `e2e/ai-v2.spec.ts` (viewer/finance, out of credits) |
| AC-M6.12b-7 | Prompt hygiene: organizer text is data; output cleaned | `compose.test.ts` (escaping, locale tag, HTML/merge braces dropped, agenda bounds) |
| AC-M6.12b-8 | E2E: draft a campaign with a brand kit, accept an audience suggestion, see matchmaking suggestions; keyboard only, axe both themes, RTL | `e2e/ai-v2.spec.ts` (6 tests × 3 projects) |

### 7. Gate (2026-10-04)
`pnpm verify` steps on the merged branch (build branch + `merge/next-3u` + `agent/m6.6b`): lint (2 pre-existing file-size warnings on `hi.json`/`ru.json`), check:modules, typecheck 63/63, unit 3482/3482, integration 1963 tests (one category rule fixed during the run; the file re-run green). E2E: `ai-v2.spec.ts` 18/18 and the related `ai-draft`, `campaigns`, `audiences`, `cms`, `agenda`, `networking`, `console-nav` specs on 375/768/1280.
