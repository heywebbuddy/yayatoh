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
   T4 commerce → T5 check-ins → codes and links → T3 remainder (venues, categories, series, seat
   charts) → T6 communications (consents, push tokens, the order-link plan) → T8 auth artifacts
   (access tokens, magic links, resets, dual-hash grace) → T9 derived data (participation, contact
   totals, monthly metrics, replayed domain events) → the URL inventory (legacy redirects). Each stage
   is one transaction. Ids are deterministic, so a rerun on the same dump changes nothing and
   duplicates nothing.
3. **Validate** (V1–V12) and the quarantine gate, then print the summary and write the JSON report.

Options:

| Option | Default | Meaning |
|---|---|---|
| `--event-clock=platform\|venue` | `platform` | How legacy event DATE+TIME are read. The legacy app converted organizer input to the platform timezone before saving, so `platform` is correct for data it wrote. `venue` reads them as venue-local (pending owner confirmation, see owner inbox). |
| `--system-timezone=Area/City` | the dump's `regional.timezone_default` (else `America/New_York`) | The platform timezone that system timestamps are wall-clock in. |
| `--report <file>` | none | Also write the full JSON report (checks, quarantine, exceptions, timings). |
| `--skip-load` | off | Re-run the transforms on what is already staged (no `--dump`). |
| `--freeze-at=<ISO instant>` | now | The freeze (T−0). What was live then is carried: unexpired access tokens, magic links until they expire, password resets under 60 minutes old; the dual-hash grace runs 180 days from it; the order-link plan covers events that had not ended. Use the real T−0 at cutover. |

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
  ok   V6 QR, token and password vectors (100% pass)
  ok   V7 Golden queries (21) legacy vs migrated: 0 differences
  ok   V8 Facade twin diff (0 unexplained) — pending: facade not built
  ok   V9 URL inventory: every legacy URL has its planned status
  ok   V10 Checksums per table (reproduced by a rerun on the same dump)
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
  staff), placeholder buyer emails, direct charges without a connected account; and since M2.2c:
  unmapped categories, inferred series, venue coordinates or timezones that could not be read, seats
  booked per date or over capacity, access tokens of users who were not migrated, invalid newsletter
  addresses, legacy slugs shared by several events (`url_ambiguous_slug`); and since M2.2d: session
  fixes (`session_end_fixed`, `session_outside_event`, `session_speaker_missing`,
  `session_access_not_migrated`), links and contact fields not carried (`speaker_link_dropped`,
  `exhibitor_website_dropped`, `exhibitor_contact_not_migrated`, `tag_contact_not_migrated`),
  switched-off or unlinked performer tags, custom sections with nothing usable or skipped items,
  events moved to the `conference` profile, CMS slugs that changed and platform content
  (`cms_slug_changed`, `cms_platform_content`), media without a target yet (`media_no_target`,
  one row per kind) and the legacy chats, blocks and message reports kept in staging
  (`chat_not_migrated`, `chat_block_not_migrated`, `chat_report_not_migrated`, one row each).
- **V6–V10** (M2.2c): V6 checks that every active booking's legacy QR resolves to exactly its ticket,
  a sample of yy1 codes verifies, every live access token and magic link was carried with the right
  hash, and every carried password is one of that person's legacy hashes (remember-me and signed-URL
  vectors need the instances' APP_KEYs: pending). V7 runs 14 golden queries twice (legacy vs new: sales,
  refunds, discounts, valid tickets per org and event, tickets per type, orders, payouts, open balances,
  commission, promo redemptions, events and ticket types, check-ins, buyers). V8 is the facade twin diff:
  pending until the `/api/v2` facade exists (harness `tools/legacy-migrate/src/facade-diff.ts`). Since
  M2.2d V1, V4, V7 (G15–G21) and V10 also cover the program, announcements, sections, private info
  and CMS entries the migration wrote (through `legacy.ref`, so rows made on the new platform never
  count). V9 checks
  each inventoried URL has its planned redirect or page. V10 hashes every staging table and the migrated
  tables' stable columns: the same input must give the same output (a rerun on the same dump reproduces
  the checksums).
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
- **Buyers' order links** (T6): every migrated order has a manage token. The migration builds the plan
  and never sends anything. Review the dry run:

  ```bash
  pnpm migrate:legacy:order-links --instance=yay --report reports/yay-order-links.json
  ```

  It lists how many buyers get a "your new order link" message (orders of events that had not ended
  at the freeze), per org and event, with masked samples and the reasons others are skipped
  (`invalid_email`, `order_cancelled`, `no_active_tickets`, …). The send is a separate, reviewed step
  after cutover (it queues the transactional `orders.tickets` message per planned order); it is not built
  yet and needs owner approval.
- **Consents**: newsletter subscribers are `granted` (with `withdrawn` for those who unsubscribed) on the
  instance's platform-level org (the `yayatoh` platform org for yayatoh.com, ABC for abc); every other
  migrated contact is `unknown_legacy`. Nobody is opted in.
- **Seating**: each legacy chart is an org floor plan (Seating → saved plans) with the chart image as its
  underlay (the image arrives with the media copy); sold seats are on the tickets. Organizers with
  charts get the seating module (a `grant` override, `billing.entitlement_overrides`), and seated events
  the `gala` profile. Repetitive events' per-date seats stay on the tickets only (exception
  `seat_per_date_not_migrated`). Load the media manifest's image sizes into `legacy.media_images`
  (instance, path, width_px, height_px) before the run to scale charts to their images.
- **Series** (`series_inferred` exceptions): events of one organizer with the same title across years are
  grouped; check the list and edit them in the console (Series).
- **Legacy URLs** (`legacy.url_inventory`): every event, attendee-page, venue and organizer URL with its
  planned status; the 308s are loaded into `marketplace.legacy_redirects` for the instance host. Since
  M2.2d also `/pages/{slug}`, `/blogs/{slug}` and `/events/{slug}/tag_{Title}` (performer pages → the
  event's speaker page).
- **CMS content** (M2.2d): yayatoh.com's Voyager pages and posts belong to the `yayatoh` platform org.
  Their unchanged URLs (`/pages/about`) are served by the marketplace only when
  **`MARKETPLACE_CONTENT_ORG=yayatoh`** is set on the web app at cutover (the redirect table holds only
  the changed ones). abc's belong to ABC and are served by its tenant site once `abc.yayatoh.com` is
  active. An organizer's own pages redirect to their organizer page.
- **Program** (M2.2d): legacy sessions, speakers, exhibitors (with sponsor levels), announcements,
  custom sections, private info and performer tags are in the event's program and page. Events that
  gained a program and had the default profile now have the `conference` profile (their console lists
  Sessions, Speakers, Exhibitors and Sponsors). Legacy session times were saved as the organizer typed
  them, so they are read in the event's timezone (not the platform one).
- **Chats** (M2.2d): the legacy attendee-to-attendee chat, its blocks and message reports have no
  target module and stay in staging (listed, one exception each).
- **Media manifest** (`legacy.media_refs`, M2.2d): every legacy upload a migrated row references, with the
  R2 key the media copy writes it to (`legacy/{inst}/storage/…`) and its target. Copy the files with
  `rclone copy --checksum` to those keys; `media:*` targets (event covers and galleries, venue photos)
  are then imported through the media pipeline (a reviewed step, not built yet); `underlay:*` are the
  seat plans' underlays; `none:*` wait for their module to hold images.

  ```sql
  select target, count(*) from legacy.media_refs where instance = 'yay' group by 1 order by 1;
  ```

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
before the run (rehearsal databases are disposable). After go-live and before the point of no
return, the reverse ETL copies the new platform's writes back (`pnpm migrate:legacy:reverse`,
M2.5a): see [cutover.md](cutover.md) §5. The migration never deletes or edits rows it did
not create, and it never overwrites a password set on the new platform.

## 6. Synthetic data (development and CI)

No real legacy data is used in development. `pnpm migrate:legacy:synth --instance=yay --scale=small|demo|large --out file.sql`
writes a deterministic synthetic dump (marked `SYNTHETIC TEST DATA ONLY`, reserved example domains);
`pnpm migrate:legacy:demo` generates and migrates the e2e dataset (the Playwright global setup runs it).

**Nightly rehearsals** (`.github/workflows/legacy-rehearsal.yml`): the synthetic job runs every night on
the `large` dataset (both instances, a rerun for V10, the order-link dry run; reports as artifacts). The
masked job is defined but off until the masked dumps exist: set the repository variable
`LEGACY_MASKED_DUMPS_READY=true`, the `legacy-ref` environment, and the secrets
`LEGACY_MASKED_DUMP_YAY_URL` / `LEGACY_MASKED_DUMP_ABC_URL` (read-only, expiring links to the masked
files).
