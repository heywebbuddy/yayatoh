# Restore drill and real restore

**Targets (roadmap §10):** checkout and check-in RPO ≤ 5 min / RTO ≤ 1 h; other data RPO 1 h /
RTO 4 h. Acceptance for M1.14: a drill restores within 1 h.

## Backups
| Layer | What | Where | Retention |
|---|---|---|---|
| PITR | Neon point-in-time restore (WAL) | Neon, production project | 7 days (Neon plan; owner) |
| Off-account | `tools/ops/offsite-dump.sh`: nightly `pg_dump -Fc`, encrypted with the offline `age` key | Backup account bucket with Object Lock (Cloudflare R2 or S3, **separate account**) | 35 daily, 12 monthly |
| Files | Exports expire in 7 days; nothing else is file-only yet | — | — |

The offline private key for the dumps is kept by the owner (password manager + paper copy),
never in Doppler or the repo.

## Monthly drill (staging, 30 min)
1. `SOURCE_URL=<staging read-only URL> DUMP_DIR=./backups AGE_RECIPIENT=<public key> bash tools/ops/offsite-dump.sh`
2. Decrypt with the offline key: `age -d -i key.txt -o drill.dump backups/<file>.age`
3. `DUMP=drill.dump TARGET_URL=<drill server superuser URL>/postgres bash tools/ops/restore-drill.sh`
   The script refuses production-looking targets, verifies the checksum, restores into a new
   `yayatoh_restore_<stamp>` database and checks: migration journal, row counts, **every org's
   audit hash chain**, and **ledger journals balance**. It prints the elapsed time.
4. Also drill PITR: in Neon, create a branch of staging at "now − 10 min", point a preview at it,
   sign in and open an order. Record the time from decision to working app.
5. Record both times in the drill log below. Over 45 min → open an issue before the next event.

**Local drill (2026-09-27, Claude Code):** 3.4 MB database, dump 0.8 s, restore + checks 3 s;
every org's audit chain verified (0 broken) and all ledger journals balanced. A production-size drill needs a
masked snapshot on staging (owner inbox).

| Date | Env | Size | Dump | Restore + checks | PITR branch → app | By |
|---|---|---|---|---|---|---|
| 2026-09-27 | local | 3.4 MB | 0.8 s | 3 s | n/a (no Neon yet) | Claude Code |

## Real restore (production, owner)
1. Declare an incident ([incident.md](incident.md)); pause checkout if data is being corrupted.
2. Prefer **PITR**: create a Neon branch at the last good time. Verify it with the checks in
   `restore-drill.sh` (run against the branch).
3. Either promote the branch (whole-database loss) or copy only the affected rows back with a
   reviewed script (partial damage). Never overwrite live tables wholesale while checkout runs.
4. If Neon itself is unavailable: restore the latest off-account dump into a new Neon project
   (or any Postgres 18), run `pnpm db:bootstrap` role runbook, point `DATABASE_URL` at it.
5. Reconcile payments for the gap (webhook-replay.md) — Stripe is the source of truth for money
   that moved while the database was behind.
