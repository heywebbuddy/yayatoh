# Runbook — cutover of a legacy instance (and its rollback)

**What:** move one legacy instance to the new platform: yayatoh.com first (B-Y, M2.7), then
abc.yayatoh.com (B-A, M2.8). Roadmap §7.8 is the specification; §7.4 the freeze rules; §7.5 the
data pipeline and the rollback before the point of no return; ADR 0006 the strategy. Spec:
`docs/specs/M2.5/spec.md`.
**Who:** the owner runs it (or someone they name), step by step. Claude Code prepared the tooling
and rehearses it; it never runs production actions.
**Tooling:** `pnpm cutover` (`tools/cutover`, the roadmap's `make cutover`), `pnpm migrate:legacy*`
(`tools/legacy-migrate`), the staff console's **Maintenance** page.

> **Safety.** Every command is a dry run until you add `--target=local` or `--target=staging`, and
> it refuses any database host that is not local (`--target=local`) or listed in
> `CUTOVER_STAGING_HOSTS` (`--target=staging`). Production is not an allowed target: the
> production cutover needs an owner-approved change to that rule (owner inbox, M2.7). Each step
> waits for you to type its id (`go` at a go/no-go); `--yes` skips that on a local target only.
> Payments go through the fake provider only; nothing is sent to anyone automatically.

## 1. What the tooling does

| Piece | Command / place | What it does |
|---|---|---|
| Orchestrator | `pnpm cutover run --instance=yay --mode=cutover --target=staging` | The steps below in order, with a state file (`.cutover/<instance>-<mode>.json`): a failed or paused run resumes where it stopped; every step is idempotent. Timings per step and a report (`report.md`, `report.json`). |
| Plan | `pnpm cutover plan --instance=yay` | Prints every step, its checklist and what it would change. Writes nothing. |
| Abort / rollback | `pnpm cutover abort --instance=yay --target=…` | Before the flip: back out. After it (before PONR): rollback with the reverse ETL (§5). |
| Read-only freeze of the new app | staff console → **Maintenance** (admins; reason + confirm it's you) or the orchestrator | Every write is refused with a maintenance message (HTTP 503 + `Retry-After` on the API); reads, exports already made, check-in scans (online and offline) and public pages keep working. Platform-wide or for listed organizations. Organizers see a banner in their language. |
| Host routing | the orchestrator's `switch_routing` / `route_back`; shown on the Maintenance page | `host_route:<host>` = `next` or `legacy`; the web front door (M2.4a's, docs/runbooks/front-door.md) reads it within 5 s and forwards the whole host to its origin (`LEGACY_ORIGIN_URL` / `LEGACY_ABC_ORIGIN_URL`, secret `LEGACY_ORIGIN_SECRET`), overriding the per-route flags. No DNS change. Cookies `yy_canary=next` / `yy_legacy=1` let testers see either side. |
| Legacy freeze probe | `pnpm migrate:legacy:freeze-probe --instance=yay --freeze-at=<T−0>` | Reads the final snapshot: any row created or updated after T−0 means the legacy freeze did not hold. |
| Reverse ETL | `pnpm migrate:legacy:reverse --instance=yay --cutover-at=<flip> [--apply --target=… --mysql rollback.sql]` | Copies the new platform's post-flip orders, tickets, attendees, refunds and check-ins back into the legacy shape (ids from 10,000,000), reconciled to the cent; writes the MySQL script to apply. Dry run by default. |
| Rollback refunds | `pnpm migrate:legacy:rollback-refunds --instance=yay --cutover-at=<flip> [--order <id> --apply --target=…]` | Lists (default) or refunds post-flip platform (SCT) orders at the provider, exactly once. Fake provider only here; a Stripe refund is run by the owner. |
| Messages | `pnpm cutover comms --out review/ --start <T−0> --end <T−0+45m> --time-zone America/New_York` | Renders the T−14, T−2, freeze start, freeze end and rollback messages for organizers and buyers in all 13 locales, for review and sending. Nothing is sent. |
| Rehearsals | `pnpm cutover rehearse --rehearsal=R2\|R3\|R4 --target=local --yes` | The whole runbook on the synthetic dataset, yay then abc, then the yay rollback with an SCT refund; timed reports. Run on a **fresh** database (CI does, nightly and on PRs that touch the tooling). |

## 2. Step table (per instance)

Budgets are for manual and go/no-go steps (a rehearsal simulates them and counts the budget);
they are pending your confirmation.

| # | Step | Kind | Budget | What happens | Gate |
|---|---|---|---|---|---|
| 1 | `preflight` | auto | — | Schema migrations all applied; the last ELT run for the instance green (V1–V12); hosts not already routed; no event with sales or check-ins within ±72 h (hard rule); the messages render in 13 locales | Any failure stops the run (in cutover mode) |
| 2 | `comms_freeze_start` | manual | 2 min | Status page: maintenance. Send the **freezeStart** messages | — |
| 3 | `freeze_legacy` | manual | 3 min | Laravel: checkout paused since T−2 h, open Checkout Sessions expired, queues drained; maintenance read-only (GETs served, writes and `/api/v2` writes 503 + `Retry-After`); scheduler and workers stopped; **record the MySQL binlog position**. Confirming this step records **T−0** | — |
| 4 | `freeze_new_app` | auto | — | B-Y: platform-wide read-only freeze (beta tenants were told at T−2). B-A: the organizations imported for abc only. Expected end T−0 + 45 min | — |
| 5 | `final_dump` | manual | 5 min | mysqldump from the replica at the recorded position (`legacy-export.md`); pass it with `--dump` | — |
| 6 | `delta_elt` | auto | — | The ELT on the final snapshot with `--freeze-at=T−0` (needs `LEGACY_CUTOVER_CONFIRM=<instance>` in cutover mode). B-A: the imported orgs are frozen too | ELT validation passes |
| 7 | `verify_legacy_freeze` | auto | — | The freeze probe on the loaded snapshot | No write after T−0 |
| 8 | `golden_checks` | auto | — | V1–V12 again | All green |
| 9 | `go_no_go_1` | decision | 1 min | Steps 6–8 done and the freeze under 90 min: type `go` | **Go/no-go #1** |
| 10 | `media_delta` | manual | 3 min | `rclone copy --checksum` of the media delta; reindex; cache warm | — |
| 11 | `smoke` | auto + manual | 8 min | HTTP (with `--base-url`): home, event listing, sign-in, a migrated event over `/api/v1`. **You**: bcrypt sign-in on both instances, an existing Sanctum token on a real device, a live $1 purchase + refund (your card), a refund of one legacy order via its recorded charge path, a legacy QR in the old app and the PWA, seat finder, dashboard vs golden queries, email, push | All pass |
| 12 | `go_no_go_2` | decision | 1 min | Type `go` | **Go/no-go #2** |
| 13 | `switch_routing` | auto | — | `host_route:<host>` → `next` for the instance's hosts. **You**: MySQL user read-only; the new scheduler on. Records the flip time | — |
| 14 | `unfreeze_new_app` | auto | — | Ends the read-only freeze | End of the freeze window (target 45 min, **abort at 90**) |
| 15 | `comms_freeze_end` | manual | 2 min | Status page. Send the **freezeEnd** messages | — |

The report's freeze window is step 3 start → step 14 end.

## 3. Owner decision points

- **T−30 d:** the window (Tuesday or Wednesday, 02:00–05:00 ET; not within ±72 h of an event with
  sales or check-ins; ±7 d of an on-sale is a soft rule); B-A ≥ 21 d after B-Y, ≥ 30 d after ABC
  2026's financial wrap, ≥ 60 d before ABC 2027's on-sale. Send the **t14** messages at T−14 d
  and the **t2** messages at T−2 d (`pnpm cutover comms`).
- **T−14 d:** R3 green; go/no-go signed (checklist below).
- **T−5 d:** R4 on a fresh snapshot ≤ 70 % of the window.
- **T−0:** go/no-go #1 and #2 (typed `go`); abort at any time on a trigger (§4).
- **Rollback:** decided by you, before PONR (T+48 h or the first payout release, whichever is
  earlier). After PONR: fix forward only.
- **Refunds after a rollback:** which post-flip platform (SCT) orders to refund (default: those
  whose buyer asks; the tool lists them all).

## 4. Go/no-go checklist and abort criteria

**Go (T−14 and T−0):**
- [ ] 3 consecutive green rehearsals; the last timed run ≤ 70 % of the window (`rehearsal_share`).
- [ ] Rollback rehearsed ≤ 15 min including an SCT refund after rollback (R2 and later).
- [ ] Facade diff 0 (V8 once the facade exists), store-build smoke test, restore drill done.
- [ ] Messages reviewed (label `legal-copy`) and scheduled; status page ready.
- [ ] `LEGACY_ORIGIN_URL` / `LEGACY_ABC_ORIGIN_URL` / `LEGACY_ORIGIN_SECRET` set on the web app; the legacy nginx accepts only
      the secret header; DNS TTL 60 s (T−7 d).
- [ ] No event with sales or check-ins within ±72 h (preflight).

**Abort (before the flip) or roll back (after it, before PONR) when:**
- the freeze reaches **90 min** (the go/no-go steps refuse after that);
- the freeze probe finds a legacy write after T−0 and it can't be explained;
- any validation check fails or any money discrepancy appears;
- after the flip: any cross-tenant exposure; a double charge; payment failures above 2 % for
  15 min; sign-in failures above 3× baseline for 30 min; facade 5xx above 1 % for 15 min; legacy
  QR false rejects above 0.5 %.

UI defects are fixed forward.

## 5. Abort and rollback

`pnpm cutover abort --instance=<inst> --target=<t>` (same state file). The steps depend on whether
the route flipped:

**Before the flip** (nothing was sold on the new platform): `route_back` (a no-op),
`lift_new_freeze`, `unfreeze_legacy` (you: Laravel out of maintenance, scheduler and workers on,
checkout resumed), `comms_rollback`.

**After the flip, before PONR** (budget ≤ 15 min, including the SCT refund):

| Step | Kind | Budget | What happens |
|---|---|---|---|
| `freeze_instance` | auto | — | Read-only freeze of the instance's migrated organizations (beta tenants keep working) |
| `reverse_etl` | auto | — | Post-flip writes copied into the legacy shape and reconciled (R1–R5); the MySQL script is written to the report folder |
| `apply_mysql` | manual | 3 min | **You**: review the script and apply it to the legacy MySQL; MySQL user read-write again |
| `route_back` | auto | — | `host_route:<host>` → `legacy` |
| `unfreeze_legacy` | manual | 2 min | **You**: Laravel out of maintenance; scheduler, workers and checkout on |
| `refund_sct` | auto | — | Lists post-flip platform (SCT) orders; refunds the ones you choose (`--order`) at the provider, once. An order whose event already had a transfer released is listed `transfer_released` and needs a transfer reversal first |
| `comms_rollback` | manual | 2 min | **You**: send the **rollback** messages; status page |

What the reverse ETL can't express in the legacy shape is listed in its report, not dropped:
orders on events or ticket types created after the flip, an amount-only refund, one ticket of a
migrated multi-ticket booking. New-platform QR codes don't scan in the legacy app: the legacy
booking's order number is the ticket's short code, so the door types it.

**Before trying again:** restore the new database to its pre-cutover snapshot (Neon branch; see
`restore-drill.md`), then run the cutover again on a new dump, which now carries the reverse rows
as legacy rows.

## 6. After the flip

T+2 h to T+1 d: watch 4xx/5xx, app versions, deliveries, sign-in rate; payment reconciliation;
404 review; support triage. T+48 h: PONR (or the first payout run): you confirm. Then
`docs/runbooks/legacy-migration.md` §3 (sign-offs) and roadmap §7.9 (decommissioning).
