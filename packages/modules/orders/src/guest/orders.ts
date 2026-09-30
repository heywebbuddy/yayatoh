import { randomBytes } from 'node:crypto';
import { defineSerializer } from '@yayatoh/contracts';
import { type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { createCtx, DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { defineSubscriber, keyVault, type Notifier, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { organizationNameTx } from '@yayatoh/tenancy';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { hashManageToken } from '../commands/checkout.ts';
import { checkoutSettings, ORDER_STATUSES, orderItems, orders } from '../schema.ts';
import { normalizeGuestEmail } from './otp.ts';

/** Orders a buyer can open from "My tickets" and have their links resent for. */
export const GUEST_VISIBLE_STATUSES = ['paid', 'partially_refunded', 'refunded'] as const;

// ─── Checkout settings ──────────────────────────────────────────────────────────────────────

/**
 * Default: buyers confirm their email with a code before ordering (owner decision 2026-09-28,
 * "guest checkout with OTP"; the per-event switch and its default are pending owner).
 */
export const VERIFY_EMAIL_DEFAULT = true;

export const CheckoutSettingsDto = z.object({ verifyEmail: z.boolean() });
export type CheckoutSettingsDto = z.infer<typeof CheckoutSettingsDto>;

async function checkoutSettingsTx(tx: TenantTx, eventId: string): Promise<CheckoutSettingsDto> {
  const [row] = await tx
    .select({ verifyEmail: checkoutSettings.verifyEmail })
    .from(checkoutSettings)
    .where(eq(checkoutSettings.eventId, eventId));
  return { verifyEmail: row?.verifyEmail ?? VERIFY_EMAIL_DEFAULT };
}

export const checkoutSettingsQuery = tenantQuery({
  name: 'orders.checkoutSettings',
  input: z.object({ eventId: z.uuid() }),
  output: CheckoutSettingsDto,
  entitlement: 'ticketing',
  permission: 'events:read',
  handler: ({ input, tx }) => checkoutSettingsTx(tx, input.eventId),
});

/** Turn buyer email verification on or off for an event (M1.5f). */
export const setCheckoutSettingsCommand = tenantCommand({
  name: 'orders.setCheckoutSettings',
  input: z.object({ eventId: z.uuid(), verifyEmail: z.boolean() }),
  output: CheckoutSettingsDto,
  entitlement: 'ticketing',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const ev = await findEventTx(tx, input.eventId);
    if (!ev) throw new DomainError('not_found', 'Event not found');
    const updatedBy = ctx.actor.type === 'user' ? ctx.actor.userId : ctx.actor.type;
    await tx
      .insert(checkoutSettings)
      .values({ orgId: requireOrg(ctx), eventId: input.eventId, verifyEmail: input.verifyEmail, updatedBy })
      .onConflictDoUpdate({
        target: [checkoutSettings.orgId, checkoutSettings.eventId],
        set: { verifyEmail: input.verifyEmail, updatedBy, updatedAt: ctx.now },
      });
    return { verifyEmail: input.verifyEmail };
  },
  audit: (input) => ({
    action: 'orders.checkout_settings',
    targetType: 'event',
    targetId: input.eventId,
    data: { verifyEmail: input.verifyEmail },
  }),
});

/** Public checkout: must this event's buyers verify their email? (server-side, system actor) */
export async function checkoutVerificationRequired(orgId: string, eventId: string): Promise<boolean> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'orders.checkout-settings' } });
  return (await withTenant(ctx, (tx) => checkoutSettingsTx(tx, eventId))).verifyEmail;
}

// ─── Manage links: reissue and resend ───────────────────────────────────────────────────────

/**
 * Buyer support: revoke an order's manage link and email the buyer a new one. The old link stops
 * working at once (only the new token's hash matches); audited.
 */
export const reissueManageLinkCommand = tenantCommand({
  name: 'orders.reissueManageLink',
  input: z.object({ orderId: z.uuid() }),
  output: z.object({ orderId: z.uuid() }),
  entitlement: 'ticketing',
  permission: 'orders:support',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const token = randomBytes(32).toString('base64url');
    const [row] = await tx
      .update(orders)
      .set({
        manageTokenHash: hashManageToken(token),
        manageTokenCiphertext: await keyVault().encrypt(orgId, new TextEncoder().encode(token)),
        updatedAt: ctx.now,
      })
      .where(eq(orders.id, input.orderId))
      .returning({ id: orders.id, eventId: orders.eventId });
    if (!row) throw new DomainError('not_found', 'Order not found');
    emit({
      type: 'order.manage_link_reissued',
      version: 1,
      aggregateType: 'order',
      aggregateId: row.id,
      payload: { orgId, orderId: row.id, requestId: uuidv7() },
    });
    return { orderId: row.id };
  },
  audit: (input) => ({ action: 'orders.manage_link_reissue', targetType: 'order', targetId: input.orderId }),
});

/**
 * Public: "email me my order links again". The same answer, rows and audit whether or not the
 * address bought anything here (the event names only order ids; none for an unknown address).
 */
export const requestOrderLinksCommand = tenantCommand({
  name: 'orders.requestOrderLinks',
  input: z.object({ email: z.email().max(254) }),
  output: z.object({ requested: z.literal(true) }),
  entitlement: 'ticketing',
  permission: 'public:order_links',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const found = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.buyerEmail, normalizeGuestEmail(input.email)),
          inArray(orders.status, [...GUEST_VISIBLE_STATUSES]),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(20);
    const requestId = uuidv7();
    emit({
      type: 'order.links_requested',
      version: 1,
      aggregateType: 'order_links',
      aggregateId: requestId,
      payload: { orgId, requestId, orderIds: found.map((o) => o.id) },
    });
    return { requested: true as const };
  },
  audit: () => ({ action: 'orders.links_requested', targetType: 'org', targetId: null }),
});

// The locale came from the request; only a well-formed tag goes into a URL.
const localePrefix = (locale: string) =>
  locale !== 'en' && /^[a-z]{2}(-[A-Z]{2})?$/.test(locale) ? `/${locale}` : '';

async function manageTokenOf(orgId: string, ciphertext: string | null): Promise<string | null> {
  if (!ciphertext) return null;
  return new TextDecoder().decode(await keyVault().decrypt(orgId, ciphertext));
}

const LinksPayload = z.object({ orgId: z.uuid(), requestId: z.uuid(), orderIds: z.array(z.uuid()).max(20) });
const ReissuePayload = z.object({ orgId: z.uuid(), orderId: z.uuid(), requestId: z.uuid() });

/**
 * Emails order links (worker): one `orders.order-link` message per order, after a resend request
 * or a reissue. The link is decrypted here from its envelope; events never carry tokens.
 */
export function orderLinkMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'orders.order-link-mailer',
    events: ['order.links_requested@1', 'order.manage_link_reissued@1'],
    handle: async (tx, event) => {
      const reissued = event.type === 'order.manage_link_reissued';
      const p = reissued
        ? (() => {
            const r = ReissuePayload.parse(event.payload);
            return { orgId: r.orgId, requestId: r.requestId, orderIds: [r.orderId] };
          })()
        : LinksPayload.parse(event.payload);
      if (p.orderIds.length === 0) return;
      const rows = await tx.select().from(orders).where(inArray(orders.id, p.orderIds));
      for (const order of rows) {
        const token = await manageTokenOf(p.orgId, order.manageTokenCiphertext);
        if (!token) continue;
        const ev = await findEventTx(tx, order.eventId);
        await deps.notifier.enqueue(tx, {
          kind: 'orders.order-link',
          to: {
            email: order.buyerEmail,
            name: order.buyerName,
            userId: order.buyerUserId,
            locale: order.locale,
            timeZone: ev?.timezone ?? null,
          },
          params: {
            url: `${deps.appOrigin}${localePrefix(order.locale)}/orders/${token}`,
            name: order.buyerName,
            eventName: ev?.name ?? '',
            reason: reissued ? 'reissued' : 'resend',
          },
          dedupeKey: `order-link:${p.requestId}:${order.id}`,
          orderId: order.id,
          eventId: order.eventId,
        });
      }
    },
  });
}

// ─── "My tickets" ───────────────────────────────────────────────────────────────────────────

export const GuestOrderDto = z.object({
  orderId: z.uuid(),
  orgName: z.string(),
  eventName: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  timeZone: z.string(),
  status: z.enum(ORDER_STATUSES),
  tickets: z.int().min(0),
  totalMinor: z.int(),
  currency: z.string(),
  createdAt: z.date(),
  /** The existing order page (`/orders/{manageToken}`), for the verified buyer only. */
  managePath: z.string().regex(/^\/orders\/[A-Za-z0-9_-]{40,60}$/),
});
export type GuestOrderDto = z.infer<typeof GuestOrderDto>;
export const guestOrderSerializer = defineSerializer('orders.guestOrder', GuestOrderDto);

async function guestOrdersInOrgTx(
  tx: TenantTx,
  orgId: string,
  email: string,
  onlyIds?: readonly string[],
): Promise<GuestOrderDto[]> {
  const rows = await tx
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.buyerEmail, email),
        inArray(orders.status, [...GUEST_VISIBLE_STATUSES]),
        onlyIds ? inArray(orders.id, [...onlyIds]) : undefined,
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(200);
  if (rows.length === 0) return [];
  const counts = await tx
    .select({ orderId: orderItems.orderId, n: sql<number>`sum(${orderItems.quantity})::int` })
    .from(orderItems)
    .where(
      inArray(
        orderItems.orderId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(orderItems.orderId);
  const orgName = (await organizationNameTx(tx, orgId)) ?? '';
  const out: GuestOrderDto[] = [];
  for (const r of rows) {
    const token = await manageTokenOf(orgId, r.manageTokenCiphertext);
    const ev = await findEventTx(tx, r.eventId);
    if (!token || !ev) continue;
    out.push(
      guestOrderSerializer.serialize({
        orderId: r.id,
        orgName,
        eventName: ev.name,
        startsAt: ev.startsAt,
        endsAt: ev.endsAt,
        timeZone: ev.timezone,
        status: r.status,
        tickets: counts.find((c) => c.orderId === r.id)?.n ?? 0,
        totalMinor: r.totalMinor,
        currency: r.currency,
        createdAt: r.createdAt,
        managePath: `/orders/${token}`,
      }),
    );
  }
  return out;
}

/** A buyer's orders across orgs → (org, order) ids, through the SECURITY DEFINER lookup. */
async function orderRefsByEmail(email: string) {
  return withoutTenant((tx) =>
    tx.execute<{ org_id: string; order_id: string }>(
      sql`select org_id, order_id from orders.order_refs_by_email(${email})`,
    ),
  );
}

/**
 * The orders of a verified address: on an org's site, that org's orders (under its RLS); on the
 * marketplace (`orgId` null), every org's, found through the cross-org lookup and then read under
 * each org's RLS. Newest first; allowlisted.
 */
export async function guestOrders(email: string, orgId: string | null): Promise<GuestOrderDto[]> {
  const addr = normalizeGuestEmail(email);
  const actor = { type: 'system' as const, name: 'orders.my-tickets' };
  if (orgId) return withTenant(createCtx({ orgId, actor }), (tx) => guestOrdersInOrgTx(tx, orgId, addr));
  const byOrg = new Map<string, string[]>();
  for (const r of await orderRefsByEmail(addr))
    byOrg.set(r.org_id, [...(byOrg.get(r.org_id) ?? []), r.order_id]);
  const all: GuestOrderDto[] = [];
  for (const [org, ids] of byOrg)
    all.push(
      ...(await withTenant(createCtx({ orgId: org, actor }), (tx) => guestOrdersInOrgTx(tx, org, addr, ids))),
    );
  return all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** The orgs where an address has orders (marketplace "email me my links": one request per org). */
export async function orgsWithOrdersFor(email: string): Promise<string[]> {
  return [...new Set((await orderRefsByEmail(normalizeGuestEmail(email))).map((r) => r.org_id))];
}
