# Runbook — migrate a legacy instance (ELT)

**Who runs it:** Claude Code or the owner's developer for rehearsals on **masked** dumps; the owner
(or someone they name) for R3/R4 and cutover, step by step, per roadmap §7.8.
**What it touches:** the target Postgres only. It never connects to MySQL or to the legacy servers.
**Input:** a mysqldump of one instance (`yayatoh.com` = `yay`, `abc.yayatoh.com` = `abc`). For every
run before cutover that is the **masked** dump from `docs/runbooks/legacy-export.md`; the raw dump
never leaves the owner's machine.

Roadmap §7.5 is the specification; `docs/specs/M2.2/spec.md` (M2.2b) lists what is built and what is not yet.

## 0. Before you start

- Node 24 and pnpm 12 (`pnpm install --frozen-lockfile`), a Postgres 18 migrated to the current schema
  (`pnpm db:migrate`).
- Environment (names only; values from Doppler or the cloud environment):
  - `MIGRATOR_DATABASE_URL`: the **migrator** role (schema owner, direct connection, not the pooler).
    The tool refuses any other role. It never uses `app_user` for writes.
  - `DATABASE_URL`: `app_user`, used read-only by validation V11 (the two-org RLS probe).
  - `LOCAL_KMS_KEY`: the key vault that encrypts each org's ticket-signing key and each order's
    manage-token envelope. Production needs the KMS adapter first (owner inbox).
- Free disk: about 4× the dump size in the database (staging + migrated rows).
- Load both instances in the same database for every rehearsal, **yay first, then abc**: the identity
  merge (T1) spans both, and running them in this order keeps every id identical run after run.

## 1. Rehearsal

```bash
pnpm migrate:legacy --instance=yay --mode=rehearsal --dump masked-yay.sql.gz --report reports/yay.json
pnpm migrate:legacy --instance=abc --mode=rehearsal --dump masked-abc.sql.gz --report reports/abc.json
```

Each run:

1. **Load** the dump into the staging schema `legacy_yay` / `legacy_abc` (dropped and recreated;
   platform-owned, readable by the migrator only). DATETIME/TIMESTAMP become `timestamp without time
   zone`, `tinyint(1)` smallint, unsigned bigint, zero dates null; values a column cannot hold (bad JSON
   in a JSON column, impossible dates, a TIME past 24 h) load as null and are quarantined.
2. **Transform** T1 identity → T2 orgs → T3 catalog (events, ticket types, event roles, promo codes) →
   T4 commerce → T5 check-ins → codes and links. Each stage is one transaction. Ids are deterministic,
   so a rerun on the same dump changes nothing and duplicates nothing.
3. **Validate** (V1–V5, V11, V12) and the quarantine gate, then print the summary and write the JSON report.

Options:

| Option | Default | Meaning |
|---|---|---|
| `--event-clock=platform\|venue` | `platform` | How legacy event DATE+TIME are read. The legacy app converted organizer input to the platform timezone before saving, so `platform` is correct for data it wrote. `venue` reads them as venue-local (pending owner confirmation, see owner inbox). |
| `--system-timezone=Area/City` | the dump's `regional.timezone_default` (else `America/New_York`) | The platform timezone that system timestamps are wall-clock in. |
| `--report <file>` | none | Also write the full JSON report (checks, quarantine, exceptions, timings). |
| `--skip-load` | off | Re-run the transforms on what is already staged (no `--dump`). |

`LEGACY_TRACE=1` logs every statement slower than 0.5 s (timing rehearsals).

**Exit codes:** 0 pass; 1 a validation check failed or a quarantine limit was exceeded; 2 usage or
runtime error. `pnpm migrate:legacy:validate --instance=yay` re-validates the latest run without
transforming anything.

## 2. Read the result

The summary looks like:

```
legacy migration validation — instance yay, run 12: PASS
  ok   V1 Row counts with split factors
  ok   V2 Money per event × instance (gross, fees, discounts, refunds, commission, earning, open) to the cent
  ok   V3 Status distributions (tickets by legacy booking state; orders reported)
  ok   V4 Referential integrity (0 orphans)
  ok   V5 Merged users vs distinct emails; pre-hijack guard; no staff from legacy
  ok   V11 RLS enabled + forced on every org_id table; two-org probe as app_user; staging not visible
  ok   V12 Timezone spot checks (50 events, 50 check-ins; DST folds/gaps logged)
  ok   quarantine: none
  exceptions for owner review: dst_fold 1, legacy_admin 1
```

- **Quarantine** (`legacy.quarantine`): rows or values that could not be migrated as they are.
  Money and ticket tables (`bookings`, `transactions`, `commissions`, `tickets`, `attendees`,
  `checkins`, `promocodes`, `ticket_promocode`) must quarantine **zero** rows; any other (content)
  table at most **0.5 %**, with owner sign-off. Above either limit the run fails.
- **Exceptions** (`legacy.exceptions`) are for owner review, never silently dropped: events in a
  holding org (their owner was not an organizer), timezone fallbacks, DST folds and gaps, duplicate
  QR payloads (`order_number` repeated within an instance: not attached to any ticket), repeated
  gateway references, credentials skipped by the pre-hijack guard, legacy admins (never platform
  staff), placeholder buyer emails, direct charges without a connected account.
- Queries the owner may want:

```sql
select kind, count(*) from legacy.exceptions where run_id = <run> group by 1 order by 1;
select table_name, reason, count(*) from legacy.quarantine where run_id = <run> group by 1, 2;
select * from payments.legacy_settlements where kind = 'opening_balance' order by org_id, currency;
```

## 3. Owner sign-offs after a green rehearsal

- **Opening balances** (`payments.legacy_settlements`, `kind = 'opening_balance'`, status
  `pending_signoff`): what each organizer was still owed at the freeze, per currency. Nothing is
  released until the owner signs them off (a reviewed runbook script, not built yet).
- **Exceptions** above, and the content quarantine (≤ 0.5 %).
- **Stripe accounts** (`payments.payment_accounts`, `provider = 'stripe'`): carried over with charges
  and payouts off; refresh their capabilities from Stripe at cutover (M2.6).
- **ABC**: `abc.yayatoh.com` is attached to the ABC org as `pending_dns`; staff activate it at the
  B-A cutover. The ABC owner is the earliest abc admin (pending owner confirmation).
- **Buyers' order links**: every migrated order has a manage token; sending the links is a T6 step (Later).

## 4. Timed rehearsal and cutover

- Run the full pipeline on the production-sized masked dump and record the wall time from the
  report (`totalMs`) per instance. Target: the timed run ≤ 70 % of the cutover window; the roadmap
  budget is ≤ 60 min for production size. Measured on synthetic data: see the M2.2b spec.
- **Cutover** (`--mode=cutover`) is the same pipeline on the production dump inside the freeze
  window. It refuses to start unless `LEGACY_CUTOVER_CONFIRM=<instance>` is set, as a deliberate
  second step. Run it only as part of roadmap §7.8 with the owner approving each step. Keep the
  staging schema and the `legacy` control schema (raw rows are kept 12 months, roadmap §7.5).

## 5. Rollback

Before go-live, a failed or unwanted rehearsal is undone by restoring the database snapshot taken
before the run (rehearsal databases are disposable). The migration never deletes or edits rows it did
not create, and it never overwrites a password set on the new platform.

## 6. Synthetic data (development and CI)

No real legacy data is used in development. `pnpm migrate:legacy:synth --instance=yay --scale=small|demo|large --out file.sql`
writes a deterministic synthetic dump (marked `SYNTHETIC TEST DATA ONLY`, reserved example domains);
`pnpm migrate:legacy:demo` generates and migrates the e2e dataset (the Playwright global setup runs it).
