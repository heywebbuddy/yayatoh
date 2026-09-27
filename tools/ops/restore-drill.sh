#!/usr/bin/env bash
# Restore drill (M1.14d; acceptance: restore RTO ≤ 1 h). Restores a dump into a FRESH database,
# checks it, and prints the elapsed time. Never points at production as the target.
#   DUMP        a .dump from offsite-dump.sh (decrypt .age first with the offline key)
#   TARGET_URL  superuser URL of the drill server; a database named yayatoh_restore_<stamp> is
#               created there (a Neon branch or a local container in drills)
set -euo pipefail
: "${DUMP:?set DUMP}"
: "${TARGET_URL:?set TARGET_URL}"
IMAGE="${PG_IMAGE:-postgres:18}"
case "$TARGET_URL" in *prod*|*production*) echo "restore-drill: refusing a production-looking target" >&2; exit 1;; esac
START=$(date +%s)
DB="yayatoh_restore_$(date -u +%Y%m%d%H%M%S)"
BASE="${TARGET_URL%/*}"
DUMPDIR="$(cd "$(dirname "$DUMP")" && pwd)"
psqlc() { docker run -i --rm --network host "$IMAGE" psql "$@"; }
if [ -f "$DUMP.sha256" ]; then (cd "$DUMPDIR" && sha256sum -c "$(basename "$DUMP").sha256"); fi
# Roles are cluster-wide: the drill server must have them (pnpm db:bootstrap, or the prod role runbook).
psqlc "$TARGET_URL" -v ON_ERROR_STOP=1 -c "create database $DB"
docker run --rm --network host -v "$DUMPDIR:/in:ro" "$IMAGE" \
  pg_restore --no-owner --no-privileges --exit-on-error --dbname="$BASE/$DB" "/in/$(basename "$DUMP")"
# Checks: migrations journal present, row counts, every org's audit chain verifies.
psqlc "$BASE/$DB" -v ON_ERROR_STOP=1 -At <<'SQL'
select 'migrations', count(*) from drizzle.__drizzle_migrations;
select 'organizations', count(*) from tenancy.organizations;
select 'orders', count(*) from orders.orders;
select 'tickets', count(*) from ticketing.tickets;
select 'ledger_postings', count(*) from payments.postings;
select 'audit_broken_orgs', count(*) from (
  select org_id from (
    select org_id, seq, hash, prev_hash,
      platform.audit_hash(prev_hash, org_id, seq, actor, action, target_type, target_id, data, request_id, created_at) as expected,
      lag(hash) over (partition by org_id order by seq) as lag_hash,
      lag(seq) over (partition by org_id order by seq) as lag_seq
    from platform.audit_events) c
  where hash <> expected or prev_hash <> coalesce(lag_hash, '') or seq <> coalesce(lag_seq, 0) + 1
  group by org_id) b;
select 'ledger_balanced', bool_and(s = 0) from (select sum(amount_minor) s from payments.postings group by journal_id) j;
SQL
END=$(date +%s)
echo "restore-drill: database $DB restored and checked in $((END - START)) s (target RTO 3600 s)"
if [ "${KEEP:-}" != "1" ]; then psqlc "$TARGET_URL" -c "drop database $DB" >/dev/null; fi
