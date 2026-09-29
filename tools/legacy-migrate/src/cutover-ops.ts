import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_FOLDER, migratorSql } from '@yayatoh/db/migration';
import { ensureControlSchema } from './sql.ts';
import type { Instance } from './transforms/context.ts';

/**
 * The database side of the cutover orchestrator (tools/cutover, M2.5a), as `migrator`: pre-flight
 * reads, the platform ops flags (read-only freeze, host routing) through `platform.set_ops_flag`
 * (every change appended to `platform.ops_flag_changes` with the operator), and the hard freeze rule.
 * tools/cutover has no database access of its own.
 */

/** Schema migrations: how many the repository has and how many ran on this database. */
export async function migrationStatus(): Promise<{ files: number; applied: number; pending: number }> {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as {
    entries: unknown[];
  };
  const [r] = await migratorSql()<
    { n: number }[]
  >`select count(*)::int as n from drizzle.__drizzle_migrations`;
  const applied = r?.n ?? 0;
  return { files: journal.entries.length, applied, pending: Math.max(0, journal.entries.length - applied) };
}

/** The latest migration run of an instance and whether its validation passed. */
export async function latestRun(
  instance: Instance,
): Promise<{ id: number; pass: boolean; mode: string; finishedAt: Date | null } | null> {
  const sql = migratorSql();
  await ensureControlSchema(sql);
  const [r] = await sql<{ id: string; status: string; mode: string; finished_at: Date | null }[]>`
    select id, status, mode, finished_at from legacy.runs where instance = ${instance} order by id desc limit 1`;
  return r
    ? { id: Number(r.id), pass: r.status === 'succeeded', mode: r.mode, finishedAt: r.finished_at }
    : null;
}

/** The orgs the ELT created for an instance (the B-A freeze scope, the rollback freeze scope). */
export async function instanceOrgIds(instance: Instance): Promise<string[]> {
  const sql = migratorSql();
  await ensureControlSchema(sql);
  const rows = await sql<{ org_id: string }[]>`
    select distinct org_id::text as org_id from legacy.ref where instance = ${instance} and org_id is not null order by 1`;
  return rows.map((r) => r.org_id);
}

/** Set (or clear, `null`) one ops flag as the migrator, with the operator and reason recorded. */
export async function setOpsFlag(key: string, value: unknown, reason: string, actor: string): Promise<void> {
  await migratorSql()`select platform.set_ops_flag(${key}, ${value === null ? null : JSON.stringify(value)}::text::jsonb, ${reason}, ${actor})`;
}

export async function opsFlags(): Promise<Record<string, unknown>> {
  const rows = await migratorSql()<
    { key: string; value: unknown }[]
  >`select key, value from platform.ops_flags`;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/**
 * The hard freeze rule (roadmap §7.4): no cutover within ±72 h of any event with sales or check-ins.
 * Events of the instance's migrated orgs, and of every org when `allOrgs` (B-Y moves the whole
 * platform front door), that start or end within the window and have a paid order or an admission.
 */
export async function eventsNearWindow(
  at: Date,
  hours: number,
  scope: { instance: Instance; allOrgs: boolean },
): Promise<{ id: string; name: string; startsAt: Date }[]> {
  const from = new Date(at.getTime() - hours * 3_600_000).toISOString();
  const to = new Date(at.getTime() + hours * 3_600_000).toISOString();
  const rows = await migratorSql()<{ id: string; name: string; starts_at: Date }[]>`
    select e.id, e.name, e.starts_at from events.events e
    where (e.starts_at between ${from} and ${to} or e.ends_at between ${from} and ${to}
           or (e.starts_at <= ${from} and e.ends_at >= ${to}))
      and (${scope.allOrgs} or e.org_id in (select org_id from legacy.ref where instance = ${scope.instance} and org_id is not null))
      and (exists (select 1 from orders.orders o where o.event_id = e.id and o.status in ('paid', 'partially_refunded'))
           or exists (select 1 from checkin.admissions a where a.event_id = e.id))
    order by e.starts_at limit 50`;
  return rows.map((r) => ({ id: r.id, name: r.name, startsAt: new Date(r.starts_at) }));
}

/** A few public URLs of the instance for the HTTP smoke set: an event page and a legacy redirect. */
export async function smokeTargets(
  instance: Instance,
): Promise<{ eventSlug: string | null; redirect: { host: string; path: string; status: number } | null }> {
  const sql = migratorSql();
  const [ev] = await sql<{ slug: string }[]>`
    select e.slug from legacy.ref r join events.events e on e.id = r.new_id
    where r.instance = ${instance} and r.entity = 'events' and e.status = 'published' and e.visibility = 'public'
    order by e.starts_at desc limit 1`.catch(() => []);
  const [rd] = await sql<{ host: string; path: string; planned_status: number }[]>`
    select host, path, planned_status from legacy.url_inventory
    where instance = ${instance} and planned_status in (301, 308) order by host, path limit 1`.catch(
    () => [],
  );
  return {
    eventSlug: ev?.slug ?? null,
    redirect: rd ? { host: rd.host, path: rd.path, status: rd.planned_status } : null,
  };
}

/**
 * For rehearsals only: a migrated event of the instance that is running now with a migrated paid
 * ticket type on sale (room for a few), where the rehearsal sells and scans after the flip.
 */
export async function rehearsalTarget(
  instance: Instance,
): Promise<{ orgId: string; eventId: string; ticketTypeId: string; currency: string } | null> {
  const [t] = await migratorSql()<{ org_id: string; event_id: string; type_id: string; currency: string }[]>`
    select e.org_id, e.id as event_id, tt.id as type_id, tt.currency
    from legacy.ref er join events.events e on e.id = er.new_id
    join ticketing.ticket_types tt on tt.event_id = e.id
    join legacy.ref tr on tr.instance = ${instance} and tr.entity = 'tickets' and tr.new_id = tt.id
    where er.instance = ${instance} and er.entity = 'events' and e.status = 'published'
      and e.starts_at < now() and e.ends_at > now() + interval '1 day'
      and tt.price_minor > 0 and tt.quantity_total - tt.quantity_sold - tt.quantity_held >= 3
      and (tt.sales_start_at is null or tt.sales_start_at <= now()) and (tt.sales_end_at is null or tt.sales_end_at > now())
    order by e.starts_at, tt.id limit 1`;
  return t ? { orgId: t.org_id, eventId: t.event_id, ticketTypeId: t.type_id, currency: t.currency } : null;
}
