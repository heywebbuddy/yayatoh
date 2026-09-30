import { migratorSql } from '@yayatoh/db/migration';
import type { PaymentProvider } from '@yayatoh/payments';
import { ensureControlSchema, ident, stagingSchema } from './sql.ts';
import type { Instance } from './transforms/context.ts';

/**
 * Refunding post-cutover platform (SCT) orders after a rollback (M2.5a; roadmap §7.5: "no transfers
 * are released before PONR. A runbook script refunds these orders directly in Stripe"). After the
 * route flips back, an order the new platform charged on the platform account (`platform_mor`,
 * separate charges and transfers) has no refund path in the legacy app, so this script refunds it at
 * the provider (the port: the fake in dev and CI, never a live call from here), records the refund
 * in `legacy.rollback_refunds` and cancels its legacy bookings (`booking_cancel = 3`, commissions
 * off), which the reverse ETL wrote. Idempotent: the provider idempotency key is
 * `rollback-refund:<order id>` and a recorded refund is never repeated.
 *
 * An order whose event already had a transfer released cannot be refunded this way (the money is
 * on the organizer's account): it is listed (`transfer_released`) for the owner. Without `orderIds`
 * nothing is refunded: the plan lists what is eligible (the dry run).
 */
export interface RollbackRefundOptions {
  readonly instance: Instance;
  readonly cutoverAt: Date;
  readonly provider: PaymentProvider;
  /** Orders to refund; omitted = plan only (lists eligible orders, refunds nothing). */
  readonly orderIds?: readonly string[];
  /** Who runs it (kept on each refund row), e.g. `owner:<name>` or `rehearsal:R2`. */
  readonly actor: string;
}

export interface RollbackRefundItem {
  readonly orderId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly status: 'planned' | 'succeeded' | 'pending' | 'failed' | 'already_refunded' | 'transfer_released';
  readonly providerRefundId?: string;
  readonly bookingsCancelled?: number;
}

export interface RollbackRefundReport {
  readonly instance: Instance;
  readonly dryRun: boolean;
  readonly eligible: number;
  readonly items: readonly RollbackRefundItem[];
  readonly totalMs: number;
}

export async function rollbackRefunds(opts: RollbackRefundOptions): Promise<RollbackRefundReport> {
  const started = Date.now();
  const sql = migratorSql();
  await ensureControlSchema(sql);
  const S = ident(stagingSchema(opts.instance));
  const candidates = await sql<
    {
      id: string;
      org_id: string;
      currency: string;
      provider_payment_id: string;
      refundable: string;
      transferred: boolean;
      done: boolean;
    }[]
  >`
    select o.id, o.org_id, o.currency, o.provider_payment_id,
           o.total_minor - coalesce((select sum(f.amount_minor) from orders.refunds f where f.order_id = o.id and f.status = 'succeeded'), 0) as refundable,
           exists (select 1 from payments.settlements s where s.org_id = o.org_id and s.event_id = o.event_id and s.status = 'transferred') as transferred,
           exists (select 1 from legacy.rollback_refunds r where r.instance = ${opts.instance} and r.order_id = o.id and r.status = 'succeeded') as done
    from orders.orders o
    join legacy.ref er on er.instance = ${opts.instance} and er.entity = 'events' and er.new_id = o.event_id
    where o.created_at >= ${opts.cutoverAt.toISOString()}
      and o.funds_flow = 'platform_mor' and o.provider_payment_id is not null
      and o.status in ('paid', 'partially_refunded')
      and not exists (select 1 from legacy.ref r where r.instance = ${opts.instance} and r.entity = 'orders' and r.new_id = o.id)
    order by o.created_at, o.id`;
  const wanted = opts.orderIds ? new Set(opts.orderIds) : null;
  const items: RollbackRefundItem[] = [];
  for (const c of candidates) {
    const amount = Number(c.refundable);
    const base = { orderId: c.id, amountMinor: amount, currency: c.currency };
    if (c.done) {
      if (!wanted || wanted.has(c.id)) items.push({ ...base, status: 'already_refunded' });
      continue;
    }
    if (amount <= 0) continue;
    if (c.transferred) {
      items.push({ ...base, status: 'transfer_released' });
      continue;
    }
    if (!wanted?.has(c.id)) {
      items.push({ ...base, status: 'planned' });
      continue;
    }
    const r = await opts.provider.refund({
      providerPaymentId: c.provider_payment_id,
      amount: { amount, currency: c.currency },
      connectedAccountId: null,
      refundApplicationFee: { amount: 0, currency: c.currency },
      idempotencyKey: `rollback-refund:${c.id}`,
      orgId: c.org_id,
    });
    let cancelled = 0;
    await sql.begin(async (tx) => {
      await tx`
        insert into legacy.rollback_refunds (instance, order_id, org_id, provider_payment_id, provider_refund_id, amount_minor,
                                             currency, status, refunded_by)
        values (${opts.instance}, ${c.id}, ${c.org_id}, ${c.provider_payment_id}, ${r.refundId}, ${amount}, ${c.currency},
                ${r.status}, ${opts.actor})
        on conflict (instance, order_id) do update set provider_refund_id = excluded.provider_refund_id,
          status = excluded.status, refunded_by = excluded.refunded_by`;
      if (r.status !== 'succeeded') return;
      const bookings = (await tx.unsafe(
        `select r.legacy_id from legacy.reverse_ref r join ticketing.tickets k on k.id::text = r.new_id
         where r.instance = $1 and r.entity = 'bookings' and k.order_id = $2`,
        [opts.instance, c.id],
      )) as unknown as { legacy_id: string }[];
      const ids = bookings.map((b) => Number(b.legacy_id));
      if (!ids.length) return;
      const res = await tx.unsafe(
        `update ${S}.bookings set booking_cancel = 3, updated_at = (now() at time zone
           (select platform_tz from legacy.instance_settings where instance = $2))
         where id = any($1::bigint[]) and booking_cancel <> 3`,
        [ids, opts.instance],
      );
      cancelled = res.count ?? 0;
      await tx.unsafe(`update ${S}.commissions set status = 0 where booking_id = any($1::bigint[])`, [ids]);
      for (const id of ids)
        await tx`
          insert into legacy.reverse_updates (instance, source, new_id, legacy_table, legacy_id, change, run_id)
          values (${opts.instance}, 'rollback_refund', ${c.id}, 'bookings', ${id}, '{"booking_cancel":3}'::jsonb, 0)
          on conflict do nothing`;
    });
    items.push({ ...base, status: r.status, providerRefundId: r.refundId, bookingsCancelled: cancelled });
  }
  return {
    instance: opts.instance,
    dryRun: !opts.orderIds,
    eligible: candidates.filter((c) => !c.done && Number(c.refundable) > 0 && !c.transferred).length,
    items,
    totalMs: Date.now() - started,
  };
}
