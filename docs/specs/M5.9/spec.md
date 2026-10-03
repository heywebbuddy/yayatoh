# M5.9 — Conference Command Center pack

Plan row: `docs/plans/phase-5.md` (Wave 4, M5.9a). Builds on the M3.2a Command Center shell, the
M3.2b alert engine, M3.3a live mode, the program (M1.4f, M5.2a, M5.3a, M5.4a), registration
(M5.1c approvals, M5.2b enrollment), invoices (M5.1d) and M5.6a session check-in.

## M5.9a — Conference Command Center pack (done)

### 1. Goal and users
Organizers and their ops and marketing staff running a conference see, on the event's Command
Center and in their alerts, what needs them now: sessions about to fill, long lines, rooms too
small, exhibitors without booth staff or leads, overdue speaker tasks and sponsor deliverables,
badge printers or kiosks offline, applications waiting and invoices overdue. Door staff see the
session rooms live and the stations alert, never money.

### 2. References
CLAUDE.md non-negotiables; roadmap §5.2 (alert engine, event modes); `packages/modules/alerts/MODULE.md`;
`packages/modules/command-center/MODULE.md`; ADR 0022 (design tokens and components).

### 3. Scope (built)
**Ten alert rules on the M3.2b engine** (`alerts` `domain/config.ts`, pure `evaluateConferenceRules`
in `domain/rules.ts`, facts in `facts.ts` → `conferenceFactsTx`). All are event rules; one alert per
rule and event; each clears by itself when fixed; counts only.

| Rule | Fires when | Group · permission | Fixing page |
|---|---|---|---|
| `sessionsNearCapacity` | sessions at ≥ 95 % of their places (held), or of their places/room by people in the room while they run | conference · `events:read` | Sessions |
| `sessionWaitlists` | sessions with more than 10 people waiting | conference · `events:read` | Session enrollment |
| `roomsTooSmall` | sessions holding more places than their room seats | conference · `events:read` | Sessions |
| `exhibitorsNoLeads` | while live: exhibitors with no lead (needs a lead source) | conference · `events:read` | Exhibitors |
| `exhibitorsNoStaff` | from 7 days before and while live: exhibitors with no live portal person | conference · `events:read` | Exhibitor portal |
| `speakerTasksOverdue` | open speaker task assignments past due | conference · `events:read` | Speaker tasks |
| `deliverablesOverdue` | open sponsor deliverables past due (needs a deliverables source) | conference · `events:read` | Sponsors |
| `printersKiosksOffline` | pre-show and live: badge printers (source) + kiosks of the event silent > 90 s; live-critical while live | door · `events:read` | Onsite |
| `approvalBacklog` | ≥ 10 applications pending, or one pending > 48 h | attendees · `attendees:read` | Applications |
| `invoicesOverdue` | open invoices whose due day passed (event zone) | payments · `orders:read` | Invoices |

Nothing fires once the event wraps or is cancelled/completed. A new routing group `conference`
(owners, admins, managers: in-app and email by default). New outbox triggers: registrant
applied/approved/denied/confirmed, session promoted, exhibitor staff invited, portal invite, speaker
task assigned/completed/overdue, invoiced, invoice payment, order voided, session attended/left;
time passing is the sweep's job.

**Reads added to lower modules** (new files, appended exports, counts only):
`program` `sessionFillTx`, `exhibitorStaffingTx`, `overdueSpeakerTasksTx`, `sponsorTierCountsTx`;
`registration` `sessionWaitlistsTx`, `approvalBacklogTx`; `orders` `overdueInvoicesTx`;
`checkin` `kiosksOfflineTx`, `sessionsInRoomTx`.

**Ports for modules not on this build** (`ConferenceSources` on `AlertDeps.conference`; the tiles'
`ExhibitorLeads` / `OverdueDeliverables`): leads per exhibitor (M5.6b), overdue sponsor deliverables
(M5.4b), offline badge printers (M5.5b). A missing port, or one answering `null` for an event,
leaves its rule quiet and its tile says the source isn't on yet. Production connects none yet; the
web app's dev fake (`apps/web/src/server/conference-sources.ts`, set by `POST /api/dev/conference`,
dev/CI only) serves e2e. The worker connects none.

**Four Command Center tiles** (conference profile only; counts, session titles, exhibitor and
sponsor names; no money, so none is revenue):
- `sessionAttendance` (owner, ops, door; pre-show and live; follows `event.checkins`): sessions
  running now and starting within the hour, people in the room against places, level, kiosks offline.
- `sessionFill` (owner, ops, marketing; planning to live): nearly full and full sessions, people
  waiting, long lines, rooms too small, the five fullest sessions.
- `exhibitorActivity` (owner, ops, marketing; every mode): exhibitors with booth staff, people
  invited, leads and exhibitors without leads (port), the most active.
- `sponsorActivity` (owner, ops, marketing; every mode): sponsors per package, overdue deliverables (port).

Default layouts place them per role and mode (owner/ops/marketing; the door gets session rooms in
pre-show and live). Thresholds are shared with the engine (`alert-thresholds.test.ts`).

**Fix found on the way:** M3.3a's capacity tile failed its own DTO when an event had an M5.6a
session door (kind `session`), which broke the whole live board of a conference with session
doors. It now lists entrances and zones only (session rooms are on the session rooms tile).

**Migration** `0114_conference_alert_rules.sql`: widens `alerts_rule_check`, `alerts_category_check`
and `routing_category_check` (NOT VALID, then VALIDATE; hand-written block).

### 4. Later / not yet
- Connect the real sources when M5.6b (leads), M5.4b (deliverables) and M5.5b (printers, its
  `badges.printer_offline@1`/`online@1` events as triggers) merge: one `ConferenceSources` in the
  web app and the worker, and the three tiles' ports.
- Staff *badges* for exhibitors (M5.4b's package badges): today "booth staff" means live exhibitor
  portal people.
- Per-org thresholds (95 %, 10 waiting, 10 applications / 48 h) — pending the owner.
- TV board versions of the session rooms tile.

### 5. Acceptance (M5.9a)
| Criterion | Test |
|---|---|
| Fixtures give exactly "3 sessions are over 95 % capacity", clearing when fixed | `packages/testing/tests/conference-pack.int.test.ts` (acceptance), `apps/web/e2e/conference-pack.spec.ts` (acceptance), `packages/modules/alerts/tests/conference-rules.test.ts` |
| Fixtures give exactly "5 exhibitors have no leads", clearing when fixed | same three files |
| Every other pack rule raises once with its count and clears with its fix; evaluating twice changes nothing | `conference-pack.int.test.ts` (the rest of the pack), `conference-rules.test.ts` |
| Unconnected sources keep their rules quiet; tiles say so | `conference-pack.int.test.ts`, `conference-pack.spec.ts` (empty states) |
| The door never sees money: session rooms and the stations alert only; other tiles refused directly | `packages/modules/command-center/tests/conference.test.ts`, `conference-pack.int.test.ts` (who sees what), `conference-pack.spec.ts` (door) |
| Alerts follow the reader's permissions (scanner none, finance invoices) | `conference-pack.int.test.ts` |
| Tenant isolation | `conference-pack.int.test.ts` (tenant isolation) |
| Tiles' numbers (fill, lines, rooms, attendance, exhibitors, sponsors) | `conference-pack.int.test.ts`, `conference-pack.spec.ts` |
| Keyboard-only paths, axe in light and dark, Arabic RTL | `conference-pack.spec.ts` |
| Thresholds equal between tiles and rules | `packages/testing/tests/alert-thresholds.test.ts` |
| Capacity tile beside a session door | `conference-pack.int.test.ts` (live mode with session doors) |

### 6. Gate (2026-10-03)
- lint, check:modules, typecheck (59/59), unit 2729/2729 passed.
- Integration: 1520/1521 on the full run; the one failure was the canary outbound check meeting
  its first push (the pack's overdue-invoice alert to the canary owner): the fake transport records
  the device address, which the check read as message content. Fixed in the canary fixture (push
  content checked without its address; a new test asserts the address is the org's own canary
  device token); `canary.int.test.ts` 6/6 after the fix.
- e2e on 375/768/1280: `conference-pack.spec.ts` 12/12; related `command-center`, `live-mode`,
  `alerts`, `session-checkin` specs green after their conference layouts gained the pack's tiles.
