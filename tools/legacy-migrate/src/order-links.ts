import { migratorSql } from '@yayatoh/db/migration';

/**
 * The buyers' "your new order link" plan (T6) as a dry-run report: how many buyers get a message,
 * per org and per event (with the event's end), and why the others are skipped. Emails are shown
 * masked. Nothing is sent: the send is a runbook step the owner approves (it enqueues the
 * transactional `orders.tickets` message with each order's link, in the order's locale).
 */
export async function orderLinkReport(instance: 'yay' | 'abc') {
  const sql = migratorSql();
  const [totals] = await sql<{ planned: number; skipped: number; buyers: number; tickets: number }[]>`
    select count(*) filter (where status = 'planned')::int as planned, count(*) filter (where status = 'skipped')::int as skipped,
           count(distinct buyer_email) filter (where status = 'planned')::int as buyers,
           coalesce(sum(active_tickets) filter (where status = 'planned'), 0)::int as tickets
    from legacy.order_link_plan where instance = ${instance}`;
  const skipped = await sql<{ reason: string; n: number }[]>`
    select skip_reason as reason, count(*)::int as n from legacy.order_link_plan
    where instance = ${instance} and status = 'skipped' group by 1 order by 2 desc, 1`;
  const byEvent = await sql<
    { org: string; event: string; ends_at: string; orders: number; tickets: number }[]
  >`
    select g.slug as org, e.name as event, p.event_ends_at::text as ends_at, count(*)::int as orders,
           sum(p.active_tickets)::int as tickets
    from legacy.order_link_plan p join tenancy.organizations g on g.id = p.org_id join events.events e on e.id = p.event_id
    where p.instance = ${instance} and p.status = 'planned'
    group by 1, 2, 3 order by 3, 1, 2`;
  const sample = await sql<{ email: string; locale: string; tickets: number }[]>`
    select regexp_replace(buyer_email, '^(.).*(@.*)$', '\\1•••\\2') as email, locale, active_tickets as tickets
    from legacy.order_link_plan where instance = ${instance} and status = 'planned'
    order by order_id limit 10`;
  return {
    instance,
    dryRun: true,
    note: 'Nothing was sent. The send is a reviewed runbook step (docs/runbooks/legacy-migration.md).',
    message: 'orders.tickets',
    ...totals,
    skipped: Object.fromEntries(skipped.map((s) => [s.reason, s.n])),
    byEvent,
    sample,
  };
}
