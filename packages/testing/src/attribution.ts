import { catchUpWarehouse } from '@yayatoh/analytics';
import { withTenant } from '@yayatoh/db';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import {
  attributeOrderCommand,
  createTrackedLinkCommand,
  createTrackedLinkTx,
  recordClickCommand,
} from '@yayatoh/marketing';
import { applyProviderEventCommand, attachPaymentCommand, startCheckoutCommand } from '@yayatoh/orders';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { ports } from './ports.ts';

const DAY = 86_400_000;

/**
 * M6.2b: the multi-touch attribution fixture (integration tests and e2e share it). One USD event
 * with a $10.00 ticket, three tracked links — the messaging campaign "Autumn launch" (an M3.6b
 * campaign id; yayatoh/email), "Instagram bio" (instagram/social, UTM campaign `autumn-social`)
 * and "Partner newsletter" (partner-news/email, UTM campaign `partner`) — and four sold orders:
 *
 * | order | path (oldest first)                                | total  |
 * |-------|-----------------------------------------------------|--------|
 * | O1    | campaign (5 d) → Instagram (3 d) → partner (1 d)    | $10.00 |
 * | O2    | Instagram (2 d) → campaign (1 d)                    | $20.00 |
 * | O3    | podcast UTM landing (4 d) → referral google.com (1 d) | $10.00 |
 * | O4    | nothing (unattributed)                              | $10.00 |
 *
 * Hand-computed attributed revenue (cents) and orders (basis points of an order):
 * - first: campaign 1000, Instagram 2000, podcast 1000;
 * - last: partner 1000, campaign 2000, google.com 1000;
 * - linear: O1 333 / 333 / 334 (the remainder to the last touch), O2 1000 / 1000, O3 500 / 500 →
 *   campaign 1333, Instagram 1333, partner 334, podcast 500, google.com 500.
 * Every model adds up to $40.00 of the $50.00 sold (O4 is not attributed).
 */
export const ATTRIBUTION_FIXTURE = {
  priceMinor: 1000,
  campaignName: 'Autumn launch',
  sources: {
    campaign: 'yayatoh',
    social: 'instagram',
    partner: 'partner-news',
    podcast: 'podcast',
    google: 'google.com',
  },
  revenue: {
    first: { yayatoh: 1000, instagram: 2000, podcast: 1000 },
    last: { 'partner-news': 1000, yayatoh: 2000, 'google.com': 1000 },
    linear: { yayatoh: 1333, instagram: 1333, 'partner-news': 334, podcast: 500, 'google.com': 500 },
  },
  orders: {
    first: { yayatoh: 10_000, instagram: 10_000, podcast: 10_000 },
    last: { 'partner-news': 10_000, yayatoh: 10_000, 'google.com': 10_000 },
    linear: { yayatoh: 8333, instagram: 8333, 'partner-news': 3334, podcast: 5000, 'google.com': 5000 },
  },
  /** Linear by channel (UTM medium): email = campaign + partner. */
  linearByChannel: { email: 1667, social: 1333, audio: 500, referral: 500 },
  attributedMinor: 4000,
  soldMinor: 5000,
} as const;

export interface AttributionScenario {
  readonly eventId: string;
  readonly eventName: string;
  readonly eventSlug: string;
  readonly campaignId: string;
  readonly orders: readonly string[];
}

export async function attributionScenario(
  orgId: string,
  opts: { now?: Date } = {},
): Promise<AttributionScenario> {
  const now = opts.now ?? new Date();
  const sys = (at = now) => ({
    ...createCtx({ orgId, actor: { type: 'system', name: 'attribution-fixture' } }),
    now: at,
  });
  const anon = (at = now) => ({ ...createCtx({ orgId }), now: at });
  const tag = uuidv7().slice(-8);
  const eventName = `Autumn Social ${tag}`;
  const event = await executeCommand(
    createEventCommand,
    {
      name: eventName,
      slug: `autumn-social-${tag}`,
      timezone: 'UTC',
      currency: 'USD',
      startsAt: new Date(now.getTime() + 20 * DAY).toISOString(),
      endsAt: new Date(now.getTime() + 20 * DAY + 3 * 3_600_000).toISOString(),
    },
    sys(),
    ports,
  );
  const ticket = await executeCommand(
    createTicketTypeCommand,
    { eventId: event.id, name: 'General', priceMinor: ATTRIBUTION_FIXTURE.priceMinor, quantityTotal: 100 },
    sys(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: event.id, transition: 'publish' }, sys(), ports);
  const campaignId = uuidv7();
  const ctx = sys();
  const campaign = await withTenant(ctx, (tx) =>
    createTrackedLinkTx(tx, ctx, {
      eventId: event.id,
      source: 'yayatoh',
      medium: 'email',
      campaign: 'autumn-launch',
      label: ATTRIBUTION_FIXTURE.campaignName,
      campaignId,
    }),
  );
  const link = (source: string, medium: string, utm: string, label: string) =>
    executeCommand(
      createTrackedLinkCommand,
      { eventId: event.id, source, medium, campaign: utm, label },
      sys(),
      ports,
    );
  const social = await link('instagram', 'social', 'autumn-social', 'Instagram bio');
  const partner = await link('partner-news', 'email', 'partner', 'Partner newsletter');
  const device = (n: number) => `attr${n}${tag}${uuidv7().replace(/-/g, '')}`.slice(0, 40);
  const click = (linkId: string, deviceId: string, daysAgo: number) =>
    executeCommand(
      recordClickCommand,
      { linkId, deviceId, ip: '198.51.100.9' },
      anon(new Date(now.getTime() - daysAgo * DAY)),
      ports,
    );
  const buy = async (quantity: number, who: string) => {
    const c = await executeCommand(
      startCheckoutCommand,
      {
        eventId: event.id,
        items: [{ ticketTypeId: ticket.id, quantity }],
        buyer: { email: `${who}.${tag}@buyers.test`, name: who },
      },
      anon(),
      ports,
    );
    const pi = `fakepi_attr_${uuidv7()}`;
    await executeCommand(
      attachPaymentCommand,
      { orderId: c.order.id, provider: 'fake', providerPaymentId: pi },
      anon(),
      ports,
    );
    await executeCommand(
      applyProviderEventCommand,
      {
        provider: 'fake',
        id: `fakeevt_${pi}`,
        type: 'payment.succeeded',
        providerPaymentId: pi,
        amountMinor: c.order.totalMinor,
        currency: 'USD',
        orgId,
        orderId: c.order.id,
      },
      sys(),
      ports,
    );
    if (c.order.totalMinor !== quantity * ATTRIBUTION_FIXTURE.priceMinor)
      throw new Error(`attribution fixture: unexpected total ${c.order.totalMinor}`);
    return c.order.id;
  };
  const d1 = device(1);
  const d2 = device(2);
  await click(campaign.id, d1, 5);
  await click(social.id, d1, 3);
  await click(partner.id, d1, 1);
  await click(social.id, d2, 2);
  await click(campaign.id, d2, 1);
  const o1 = await buy(1, 'Ola');
  await executeCommand(attributeOrderCommand, { orderId: o1, deviceId: d1 }, anon(), ports);
  const o2 = await buy(2, 'Teo');
  await executeCommand(attributeOrderCommand, { orderId: o2, deviceId: d2 }, anon(), ports);
  const o3 = await buy(1, 'Pia');
  await executeCommand(
    attributeOrderCommand,
    {
      orderId: o3,
      utm: {
        first: { source: 'podcast', medium: 'audio', campaign: 'autumn-pod', at: now.getTime() - 4 * DAY },
        last: { source: 'google.com', medium: 'referral', campaign: null, at: now.getTime() - DAY },
      },
    },
    anon(),
    ports,
  );
  const o4 = await buy(1, 'Una');
  await catchUpWarehouse(orgId);
  return { eventId: event.id, eventName, eventSlug: event.slug, campaignId, orders: [o1, o2, o3, o4] };
}
