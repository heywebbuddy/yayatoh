import { exec, hasTable, type StepContext } from './context.ts';

/**
 * T5 check-ins (roadmap §7.5 "Audit-derived"). A legacy `checkins` row is one booking checked in on
 * one day: `event_start_date` is the scan day in the platform timezone and `check_in_time` the time
 * of day in UTC; the instant is that UTC time on the UTC date that falls on that regional day
 * (`legacy.checkin_instant`). Each becomes, for every ticket of the booking (a hand-on row: its one
 * ticket), an admission (the check-in state, one per ticket per event day in the event's timezone)
 * and a `scans` row with `code_kind = 'legacy'` (a legacy import, dedupe key `legacy:{inst}:…`).
 * Duplicate legacy rows for the same booking and day (the app's uniqueness was not enforced) collapse.
 * A check-in for a booking that was not migrated is quarantined (the run fails).
 */
export async function t5Checkins(ctx: StepContext): Promise<void> {
  if (!(await hasTable(ctx, 'checkins'))) return;
  await exec(
    ctx,
    `
    drop table if exists t5_src;
    create temp table t5_src as
    select c.id as legacy_id, c.booking_id, c.user_id,
           coalesce(case when c.event_start_date is not null and c.check_in_time is not null
                         then legacy.checkin_instant(c.event_start_date, c.check_in_time, {tz}) end,
                    (c.created_at at time zone {tz})) as at
    from {s}.checkins c;

    -- The tickets each legacy booking admits: its units (minus units handed on), or for a
    -- hand-on row its one ticket.
    drop table if exists t5_map;
    create temp table t5_map as
    select split_part(u.legacy_id, ':', 1)::bigint as booking_id, u.new_id as ticket_id
    from legacy.ref u
    where u.instance = {inst} and u.entity = 'booking_units'
      and not exists (select 1 from legacy.ref h where h.instance = {inst} and h.entity = 'bookings'
                      and h.new_id = u.new_id and h.legacy_id <> split_part(u.legacy_id, ':', 1))
    union all
    select h.legacy_id::bigint, h.new_id
    from legacy.ref h join {s}.bookings hb on hb.id::text = h.legacy_id and hb.distributed_from_booking_id is not null
    where h.instance = {inst} and h.entity = 'bookings';
    create index on t5_map (booking_id);

    insert into legacy.quarantine (run_id, instance, table_name, legacy_id, column_name, reason, detail)
    select {run}, {inst}, 'checkins', s.legacy_id::text, 'booking_id', 'orphan', 'booking ' || s.booking_id
    from t5_src s
    where s.at is null or not exists (select 1 from t5_map m where m.booking_id = s.booking_id);

    drop table if exists t5_adm;
    create temp table t5_adm as
    select distinct on (k.org_id, k.id, to_char(s.at at time zone e.timezone, 'YYYY-MM-DD'))
           s.legacy_id, s.at, s.user_id, k.id as ticket_id, k.org_id, k.event_id,
           to_char(s.at at time zone e.timezone, 'YYYY-MM-DD') as day
    from t5_src s
    join t5_map m on m.booking_id = s.booking_id
    join ticketing.tickets k on k.id = m.ticket_id
    join events.events e on e.id = k.event_id
    where s.at is not null
    order by k.org_id, k.id, to_char(s.at at time zone e.timezone, 'YYYY-MM-DD'), s.at, s.legacy_id;

    insert into checkin.admissions (id, org_id, event_id, ticket_id, day, admitted_at, admitted_by, created_at, updated_at)
    select legacy.det_uuid(a.at, {inst} || '|admissions|' || a.ticket_id || '|' || a.day), a.org_id, a.event_id, a.ticket_id, a.day, a.at,
           (select r.new_id from legacy.ref r where r.instance = {inst} and r.entity = 'users' and r.legacy_id = a.user_id::text),
           a.at, a.at
    from t5_adm a
    on conflict (id) do nothing;

    insert into checkin.scans (id, org_id, event_id, ticket_id, admission_id, result, code_kind, client_scan_id, scanned_at,
                               scanned_by, offline, created_at, updated_at)
    select legacy.det_uuid(a.at, {inst} || '|scans|' || a.ticket_id || '|' || a.day), a.org_id, a.event_id, a.ticket_id,
           legacy.det_uuid(a.at, {inst} || '|admissions|' || a.ticket_id || '|' || a.day), 'admitted', 'legacy',
           'legacy:' || {inst} || ':' || a.legacy_id || ':' || a.ticket_id, a.at,
           (select r.new_id from legacy.ref r where r.instance = {inst} and r.entity = 'users' and r.legacy_id = a.user_id::text),
           false, a.at, a.at
    from t5_adm a
    on conflict (id) do nothing;
  `,
  );
}
