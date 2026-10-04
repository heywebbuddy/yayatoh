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
