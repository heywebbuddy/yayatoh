import type { TenantTx } from '@yayatoh/db';
import { actorId, DomainError, requireOrg } from '@yayatoh/kernel';
import { orderOutcomesTx } from '@yayatoh/orders';
import { appTokenSecret, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq, gte, inArray, lte, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { pseudonym } from './domain/click-token.ts';
import { clickPath, landingKind } from './domain/touches.ts';
import { cleanUtmValue } from './domain/utm.ts';
import {
  CLOCK_SKEW_MS,
  DAY_MS,
  DEFAULT_WINDOW_DAYS,
  inWindow,
  MAX_WINDOW_DAYS,
  MIN_WINDOW_DAYS,
  pickTouches,
} from './domain/window.ts';
import { AttributionSettingsDto, OrderAttributionDto } from './dto.ts';
import { attributionSettings, attributionTouches, attributions, linkClicks, trackingLinks } from './schema.ts';

/** The org's attribution window in days (the default until an organizer sets one). */
export async function attributionWindowTx(tx: TenantTx): Promise<number> {
  const [row] = await tx.select({ windowDays: attributionSettings.windowDays }).from(attributionSettings);
  return row?.windowDays ?? DEFAULT_WINDOW_DAYS;
}

export const attributionSettingsQuery = tenantQuery({
  name: 'marketing.attributionSettings',
  input: z.object({}),
  output: AttributionSettingsDto,
  entitlement: 'marketing',
  permission: 'marketing:read',
  handler: async ({ tx }) => ({ windowDays: await attributionWindowTx(tx) }),
});

/** Change the attribution window (applies to orders placed from now on; records keep theirs). */
export const setAttributionWindowCommand = tenantCommand({
  name: 'marketing.setAttributionWindow',
  input: z.object({ windowDays: z.int().min(MIN_WINDOW_DAYS).max(MAX_WINDOW_DAYS) }),
  output: AttributionSettingsDto,
  entitlement: 'marketing',
  permission: 'marketing:write',
  handler: async ({ input, ctx, tx }) => {
    await tx
      .insert(attributionSettings)
      .values({ orgId: requireOrg(ctx), windowDays: input.windowDays, updatedBy: actorId(ctx.actor) })
      .onConflictDoUpdate({
        target: [attributionSettings.orgId],
        set: { windowDays: input.windowDays, updatedBy: actorId(ctx.actor), updatedAt: ctx.now },
      });
    return { windowDays: input.windowDays };
  },
  audit: (input) => ({
    action: 'marketing.attribution.window',
    targetType: 'organization',
    targetId: null,
    data: { count: input.windowDays },
  }),
});

const UtmInput = z.object({
  source: z.string().max(200),
  medium: z.string().max(200).nullish(),
  campaign: z.string().max(200).nullish(),
  content: z.string().max(200).nullish(),
  term: z.string().max(200).nullish(),
  at: z.int().positive(),
});

export const AttributeOrderInput = z.object({
  orderId: z.uuid(),
  /** Click ids from verified tokens (the click cookie); unverified values never get here. */
  clickIds: z.array(z.uuid()).max(4).default([]),
  /** The buyer's `yy_did` device cookie: finds their earlier clicks inside the window. */
  deviceId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,64}$/)
    .nullish(),
  /** First and last UTM landings (the `yy_utm` cookie), for UTM-only attribution. */
  utm: z.object({ first: UtmInput, last: UtmInput }).nullish(),
});

/** M6.2b: an order's attribution was recorded (the warehouse recomputes the event's attribution). */
export const ORDER_ATTRIBUTED_EVENT = 'marketing.order_attributed';
const attributedEvent = (orderId: string, eventId: string) => ({
  type: ORDER_ATTRIBUTED_EVENT,
  version: 1,
  aggregateType: 'order',
  aggregateId: orderId,
  payload: { orderId, eventId },
});

const AttributeOrderOutput = z.object({
  outcome: z.enum(['click', 'utm', 'none', 'exists']),
});

/**
 * The checkout hook (M3.8a): record the attribution of a new order. Idempotent (one record per
 * order; a second call is `exists`). Click touches must be for the order's event and inside the
 * org's window; without one, UTM landings inside the window give a `utm` record; else nothing.
 * The org comes from the order's checkout, never from the request.
 */
export const attributeOrderCommand = tenantCommand({
  name: 'marketing.attributeOrder',
  input: AttributeOrderInput,
  output: AttributeOrderOutput,
  entitlement: 'marketing',
  permission: 'public:checkout',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const [order] = await orderOutcomesTx(tx, [input.orderId]);
    if (!order) throw new DomainError('not_found', 'Order not found');
    const [existing] = await tx
      .select({ id: attributions.id })
      .from(attributions)
      .where(eq(attributions.orderId, order.orderId));
    if (existing) return { outcome: 'exists' as const };
    const windowDays = await attributionWindowTx(tx);
    const orderAt = order.createdAt;
    const since = new Date(orderAt.getTime() - windowDays * DAY_MS);
    const until = new Date(orderAt.getTime() + CLOCK_SKEW_MS);
    const deviceHash = input.deviceId ? pseudonym('device', input.deviceId, appTokenSecret()) : null;
    const who = [
      ...(input.clickIds.length ? [inArray(linkClicks.id, input.clickIds)] : []),
      ...(deviceHash ? [eq(linkClicks.deviceHash, deviceHash)] : []),
    ];
    const clicks = who.length
      ? await tx
          .select({
            clickId: linkClicks.id,
            linkId: linkClicks.linkId,
            eventId: linkClicks.eventId,
            clickedAt: linkClicks.clickedAt,
          })
          .from(linkClicks)
          .where(
            and(
              eq(linkClicks.eventId, order.eventId),
              gte(linkClicks.clickedAt, since),
              lte(linkClicks.clickedAt, until),
              or(...who),
            ),
          )
          .limit(500)
      : [];
    const touches = pickTouches(clicks, { eventId: order.eventId, at: orderAt }, windowDays);
    if (touches) {
      // M6.2b: every counting click is a touch of the path (multi-touch models).
      const path = clickPath(
        clicks.filter((c) => c.eventId === order.eventId && inWindow(c.clickedAt, orderAt, windowDays)),
      );
      const links = await tx
        .select()
        .from(trackingLinks)
        .where(inArray(trackingLinks.id, [...new Set(path.map((c) => c.linkId))]));
      const first = links.find((l) => l.id === touches.first.linkId);
      const last = links.find((l) => l.id === touches.last.linkId);
      await tx
        .insert(attributions)
        .values({
          orgId,
          orderId: order.orderId,
          eventId: order.eventId,
          model: 'click',
          firstClickId: touches.first.clickId,
          firstLinkId: touches.first.linkId,
          firstAt: touches.first.clickedAt,
          lastClickId: touches.last.clickId,
          lastLinkId: touches.last.linkId,
          lastAt: touches.last.clickedAt,
          utmSource: last?.utmSource ?? null,
          utmMedium: last?.utmMedium ?? null,
          utmCampaign: last?.utmCampaign ?? null,
          utmContent: last?.utmContent ?? null,
          utmTerm: last?.utmTerm ?? null,
          firstUtmSource: first?.utmSource ?? null,
          firstUtmMedium: first?.utmMedium ?? null,
          firstUtmCampaign: first?.utmCampaign ?? null,
          windowDays,
        })
        .onConflictDoNothing();
      const byId = new Map(links.map((l) => [l.id, l] as const));
      await tx.insert(attributionTouches).values(
        path.map((c, position) => {
          const l = byId.get(c.linkId);
          return {
            orgId,
            orderId: order.orderId,
            position,
            kind: 'click',
            at: c.clickedAt,
            linkId: c.linkId,
            campaignId: l?.campaignId ?? null,
            source: l?.utmSource ?? 'unknown',
            medium: l?.utmMedium ?? null,
            campaign: l?.utmCampaign ?? null,
          };
        }),
      ).onConflictDoNothing();
      emit(attributedEvent(order.orderId, order.eventId));
      return { outcome: 'click' as const };
    }
    const utm = input.utm;
    const lastSource = cleanUtmValue(utm?.last.source);
    if (utm && lastSource && inWindow(new Date(utm.last.at), orderAt, windowDays)) {
      // A first landing outside the window no longer counts: the last one is the first too.
      const firstCounts =
        inWindow(new Date(utm.first.at), orderAt, windowDays) && utm.first.at <= utm.last.at;
      const first = firstCounts ? utm.first : utm.last;
      await tx
        .insert(attributions)
        .values({
          orgId,
          orderId: order.orderId,
          eventId: order.eventId,
          model: 'utm',
          firstAt: new Date(first.at),
          lastAt: new Date(utm.last.at),
          utmSource: lastSource,
          utmMedium: cleanUtmValue(utm.last.medium),
          utmCampaign: cleanUtmValue(utm.last.campaign),
          utmContent: cleanUtmValue(utm.last.content),
          utmTerm: cleanUtmValue(utm.last.term),
          firstUtmSource: cleanUtmValue(first.source),
          firstUtmMedium: cleanUtmValue(first.medium),
          firstUtmCampaign: cleanUtmValue(first.campaign),
          windowDays,
        })
        .onConflictDoNothing();
      // M6.2b: the landings (first and last; one when they are the same landing) as the path.
      const landings = first === utm.last || first.at === utm.last.at ? [utm.last] : [first, utm.last];
      await tx.insert(attributionTouches).values(
        landings.map((u, position) => {
          const medium = cleanUtmValue(u.medium);
          const campaign = cleanUtmValue(u.campaign);
          return {
            orgId,
            orderId: order.orderId,
            position,
            kind: landingKind({ medium, campaign }),
            at: new Date(u.at),
            source: cleanUtmValue(u.source) ?? lastSource,
            medium,
            campaign,
          };
        }),
      ).onConflictDoNothing();
      emit(attributedEvent(order.orderId, order.eventId));
      return { outcome: 'utm' as const };
    }
    return { outcome: 'none' as const };
  },
  audit: (input, r) => ({
    action: 'marketing.attribution.record',
    targetType: 'order',
    targetId: input.orderId,
    data: { kind: r.outcome, orderId: input.orderId },
  }),
});

const firstLink = alias(trackingLinks, 'first_link');
const lastLink = alias(trackingLinks, 'last_link');

/** The attribution record of one order (null when the order has none). */
export const orderAttributionQuery = tenantQuery({
  name: 'marketing.orderAttribution',
  input: z.object({ orderId: z.uuid() }),
  output: OrderAttributionDto.nullable(),
  entitlement: 'marketing',
  permission: 'orders:read',
  handler: async ({ input, tx }) => {
    const [r] = await tx
      .select({
        a: attributions,
        firstCode: firstLink.code,
        lastCode: lastLink.code,
      })
      .from(attributions)
      .leftJoin(
        firstLink,
        and(eq(firstLink.orgId, attributions.orgId), eq(firstLink.id, attributions.firstLinkId)),
      )
      .leftJoin(
        lastLink,
        and(eq(lastLink.orgId, attributions.orgId), eq(lastLink.id, attributions.lastLinkId)),
      )
      .where(eq(attributions.orderId, input.orderId));
    if (!r) return null;
    const a = r.a;
    return {
      orderId: a.orderId,
      model: a.model as 'click' | 'utm',
      firstTouch: {
        linkId: a.firstLinkId,
        code: r.firstCode,
        at: a.firstAt,
        source: a.firstUtmSource,
        medium: a.firstUtmMedium,
        campaign: a.firstUtmCampaign,
      },
      lastTouch: {
        linkId: a.lastLinkId,
        code: r.lastCode,
        at: a.lastAt,
        source: a.utmSource,
        medium: a.utmMedium,
        campaign: a.utmCampaign,
      },
      windowDays: a.windowDays,
    };
  },
});
