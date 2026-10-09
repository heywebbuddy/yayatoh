import 'server-only';
import { withPlatformReader } from '@yayatoh/db/platform';
import { sql } from 'drizzle-orm';
import type { Staff } from './staff.ts';

export function dashboardDays(value?: string): 7 | 30 | 90 {
  return value === '7' ? 7 : value === '90' ? 90 : 30;
}

export interface DashboardTotals {
  organizations: number;
  users: number;
  events: number;
  upcoming: number;
  orders: number;
  tickets: number;
  subscriptions: number;
  newOrganizations: number;
  periodOrders: number;
  paidOrders: number;
  paymentFailed: number;
  suspended: number;
  payoutsHeld: number;
  pendingRefunds: number;
  reconciliation: number;
  pastDue: number;
  openDisputes: number;
}
export interface DashboardDay {
  day: string;
  organizations: number;
  orders: number;
}
export interface DashboardGroup {
  label: string;
  count: number;
}
export interface DashboardMoney {
  currency: string;
  gross: string;
  refunds: string;
  commission: string;
}
export interface DashboardOrganization {
  id: string;
  name: string;
  slug: string;
  status: string;
  created: string;
}

/** Aggregated platform facts only; sandbox organizations are excluded throughout. */
export async function dashboardData(staff: Staff, days: number) {
  const window = dashboardDays(String(days));
  return withPlatformReader(
    { actor: staff.actor, reason: `staff dashboard: ${window} UTC days` },
    async (tx) => {
      const [totals] = await tx.execute<DashboardTotals & Record<string, unknown>>(sql`
      with orgs as (select * from tenancy.organizations where not sandbox),
      period as (select (now() at time zone 'UTC')::date - (${window}::int - 1) as start, ((now() at time zone 'UTC')::date + 1) as finish)
      select
        (select count(*)::int from orgs) as organizations,
        (select count(*)::int from auth.users where deleted_at is null) as users,
        (select count(*)::int from events.events e join orgs o on o.id=e.org_id) as events,
        (select count(*)::int from events.events e join orgs o on o.id=e.org_id where e.status='published' and e.ends_at>now()) as upcoming,
        (select count(*)::int from orders.orders x join orgs o on o.id=x.org_id) as orders,
        (select count(*)::int from ticketing.tickets x join orgs o on o.id=x.org_id where x.status='active') as tickets,
        (select count(*)::int from billing.subscriptions x join orgs o on o.id=x.org_id where x.status in ('active','trialing')) as subscriptions,
        (select count(*)::int from orgs, period p where created_at>=p.start at time zone 'UTC' and created_at<p.finish at time zone 'UTC') as "newOrganizations",
        (select count(*)::int from orders.orders x join orgs o on o.id=x.org_id, period p where x.created_at>=p.start at time zone 'UTC' and x.created_at<p.finish at time zone 'UTC') as "periodOrders",
        (select count(*)::int from orders.orders x join orgs o on o.id=x.org_id, period p where x.paid_at>=p.start at time zone 'UTC' and x.paid_at<p.finish at time zone 'UTC') as "paidOrders",
        (select count(*)::int from orders.orders x join orgs o on o.id=x.org_id, period p where x.status='payment_failed' and x.created_at>=p.start at time zone 'UTC' and x.created_at<p.finish at time zone 'UTC') as "paymentFailed",
        (select count(*)::int from orgs where status='suspended') as suspended,
        (select count(*)::int from payments.payment_accounts x join orgs o on o.id=x.org_id where x.payouts_held) as "payoutsHeld",
        (select count(*)::int from orders.refunds x join orgs o on o.id=x.org_id where x.status='pending') as "pendingRefunds",
        (select count(*)::int from payments.reconciliation_items x join orgs o on o.id=x.org_id where x.status='open') as reconciliation,
        (select count(*)::int from billing.subscriptions x join orgs o on o.id=x.org_id where x.status in ('past_due','unpaid')) as "pastDue",
        (select count(*)::int from payments.disputes x join orgs o on o.id=x.org_id where x.status in ('open','evidence_submitted')) as "openDisputes"
    `);
      const trend = await tx.execute<DashboardDay & Record<string, unknown>>(sql`
      with period as (select (now() at time zone 'UTC')::date - (${window}::int - 1) as start, ((now() at time zone 'UTC')::date + 1) as finish),
      orgs as (select id,created_at from tenancy.organizations where not sandbox),
      new_orgs as (select (created_at at time zone 'UTC')::date as day,count(*)::int n from orgs,period p where created_at>=p.start at time zone 'UTC' and created_at<p.finish at time zone 'UTC' group by 1),
      new_orders as (select (x.created_at at time zone 'UTC')::date as day,count(*)::int n from orders.orders x join orgs o on o.id=x.org_id,period p where x.created_at>=p.start at time zone 'UTC' and x.created_at<p.finish at time zone 'UTC' group by 1)
      select d.day::date::text as day,coalesce(o.n,0) organizations,coalesce(x.n,0) orders
      from period p,generate_series(p.start::timestamp,(now() at time zone 'UTC')::date::timestamp,interval '1 day') d(day)
      left join new_orgs o on o.day=d.day::date left join new_orders x on x.day=d.day::date order by d.day
    `);
      const organizationStatus = await tx.execute<DashboardGroup & Record<string, unknown>>(sql`
      select status label,count(*)::int count from tenancy.organizations where not sandbox group by status order by count desc,status`);
      const eventStatus = await tx.execute<DashboardGroup & Record<string, unknown>>(sql`
      select e.status label,count(*)::int count from events.events e join tenancy.organizations o on o.id=e.org_id where not o.sandbox group by e.status order by count desc,e.status`);
      const plans = await tx.execute<DashboardGroup & Record<string, unknown>>(sql`
      select coalesce(p.name,'Launch standard') label,count(*)::int count from tenancy.organizations o
      left join billing.org_plans op on op.org_id=o.id left join billing.plans p on p.key=op.plan_key
      where not o.sandbox group by coalesce(p.name,'Launch standard') order by count desc,label`);
      const financials = await tx.execute<DashboardMoney & Record<string, unknown>>(sql`
      with orgs as (select id from tenancy.organizations where not sandbox),
      period as (select ((now() at time zone 'UTC')::date - (${window}::int - 1)) at time zone 'UTC' as start, ((now() at time zone 'UTC')::date + 1) as finish),
      sales as (select x.currency,sum(x.total_minor) gross from orders.orders x join orgs o on o.id=x.org_id,period p where x.paid_at>=p.start and x.paid_at<p.finish at time zone 'UTC' group by x.currency),
      refunds as (select x.currency,sum(x.amount_minor) refunds from orders.refunds x join orgs o on o.id=x.org_id,period p where x.status='succeeded' and x.completed_at>=p.start and x.completed_at<p.finish at time zone 'UTC' group by x.currency),
      fees as (select x.currency,-sum(x.amount_minor) commission from payments.postings x join payments.journal_entries j on j.id=x.journal_id and j.org_id=x.org_id join orgs o on o.id=x.org_id,period p where j.occurred_at>=p.start and j.occurred_at<p.finish at time zone 'UTC' and x.account in ('platform:platform_fee_deferred','platform:platform_fee_revenue') group by x.currency),
      currencies as (select currency from sales union select currency from refunds union select currency from fees)
      select c.currency,coalesce(s.gross,0)::text gross,coalesce(r.refunds,0)::text refunds,coalesce(f.commission,0)::text commission from currencies c left join sales s using(currency) left join refunds r using(currency) left join fees f using(currency) order by c.currency`);
      const recent = await tx.execute<DashboardOrganization & Record<string, unknown>>(sql`
      select id,name,slug,status,created_at::text created from tenancy.organizations where not sandbox order by created_at desc limit 6`);
      if (!totals) throw new Error('dashboard_totals_missing');
      return {
        totals,
        trend: [...trend],
        organizationStatus: [...organizationStatus],
        eventStatus: [...eventStatus],
        plans: [...plans],
        financials: [...financials],
        recent: [...recent],
      };
    },
  );
}
