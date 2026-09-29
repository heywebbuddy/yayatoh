import { type AlertDeps, evaluateOrgNow } from '@yayatoh/alerts';
import { withTenant } from '@yayatoh/db';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import {
  attributeOrderCommand,
  createTrackedLinkCommand,
  createTrackedLinkTx,
  recordClickCommand,
} from '@yayatoh/marketing';
import { campaignDedupeKey, createNotifier } from '@yayatoh/notifications';
import { applyProviderEventCommand, attachPaymentCommand, startCheckoutCommand } from '@yayatoh/orders';
import {
  AGREEMENT_DOCUMENTS,
  acceptAgreementCommand,
  createOrganization,
  PLATFORM_AGREEMENTS,
} from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { ports } from './ports.ts';

/**
 * The M3.8b acceptance fixture's numbers (integration tests and e2e share them). One event, a
 * $25.00 pass, and:
 * - the messaging campaign "Spring launch" (an M3.6b campaign id on its email link): 120 emails
 *   from the org's own sending domain, 112 delivered, 8 bounced (6.66 %: over the 5 % threshold);
 * - a manual link "Instagram bio" (UTM campaign `spring-social`, medium `social`);
 * - 200 other emails from the platform sender, all delivered (so the org as a whole is under the
 *   thresholds: the campaign and its domain raise the alert on their own);
 * - device 1 clicks the campaign (3 days ago) then Instagram (1 day ago) and buys one pass;
 *   device 2 clicks the campaign and buys two; device 3 clicks the campaign twice; device 4 clicks
 *   Instagram; a fifth buyer lands with podcast UTM values only (no click) and buys one pass.
 */
export const MARKETING_FIXTURE = {
  priceMinor: 2500,
  campaignName: 'Spring launch',
  socialLabel: 'Instagram bio',
  campaign: {
    sends: 120,
    deliveries: 112,
    bounced: 8,
    clicks: 4,
    uniqueClickers: 3,
    firstTouchOrders: 2,
    firstTouchRevenueMinor: 7500,
    lastTouchOrders: 1,
    lastTouchRevenueMinor: 5000,
    conversionBps: 2500,
  },
  social: {
    clicks: 2,
    uniqueClickers: 2,
    firstTouchOrders: 0,
    firstTouchRevenueMinor: 0,
    lastTouchOrders: 1,
    lastTouchRevenueMinor: 2500,
    conversionBps: 5000,
  },
  podcast: { firstTouchOrders: 1, lastTouchOrders: 1, revenueMinor: 2500 },
  totals: {
    sends: 120,
    deliveries: 112,
    clicks: 6,
    uniqueClickers: 4,
    orders: 3,
    revenueMinor: 10_000,
    conversionBps: 5000,
  },
  otherEmails: 200,
  orgSent: 320,
  /** 8 of 320: 2.5 % (under 5 %). */
  orgBounceBps: 250,
  /** 8 of 120: 6.66 %. */
  campaignBounceBps: 666,
} as const;

export interface MarketingScenario {
  readonly orgId: string;
  readonly eventId: string;
  readonly eventSlug: string;
  readonly eventName: string;
  readonly campaignId: string;
  readonly campaignLinkId: string;
  readonly socialLinkId: string;
  readonly senderDomain: string;
  /** Order ids: device 1 (campaign → Instagram), device 2 (campaign), the podcast buyer. */
  readonly orders: { readonly mixed: string; readonly campaign: string; readonly podcast: string };
  /** What the worker does: evaluate the org's alert rules (optionally at another time). */
  readonly evaluate: (now?: Date) => Promise<void>;
}

const DAY = 86_400_000;

/**
 * An org with nothing in it but its owner and the accepted terms (no fixture rows: the M3.8b
 * figures must be exact, and the shared fixture already holds a tracked link, a click and email).
 */
export async function bareOrg(
  slug: string,
  name: string,
): Promise<{ orgId: string; ownerId: string; ctx: () => Ctx }> {
  const ownerId = uuidv7();
  const owner = (orgId: string | null = null) => createCtx({ orgId, actor: { type: 'user', userId: ownerId }, stepUpAt: new Date() });
  const org = await createOrganization(owner(), { slug, name, defaultProfile: 'concert' }, ports);
  for (const document of AGREEMENT_DOCUMENTS)
    await executeCommand(
      acceptAgreementCommand,
      { document, version: PLATFORM_AGREEMENTS[document].version },
      owner(org.id),
      ports,
    );
  return { orgId: org.id, ownerId, ctx: () => owner(org.id) };
}
const system = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: 'fixture' } });

async function pay(orgId: string, orderId: string, totalMinor: number) {
  const pi = `fakepi_mkt_${uuidv7()}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId, provider: 'fake', providerPaymentId: pi },
    createCtx({ orgId }),
    ports,
  );
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_${pi}`,
      type: 'payment.succeeded',
      providerPaymentId: pi,
      amountMinor: totalMinor,
      currency: 'USD',
      orgId,
      orderId,
    },
    system(orgId),
    ports,
  );
}

/**
 * Email the campaign or the org sent (as the dispatcher would have recorded them after the
 * provider accepted them) and their delivery reports (as the webhooks would have recorded them).
 */
export async function seedEmails(
  ctx: Ctx,
  opts: {
    readonly count: number;
    readonly bounced?: number;
    readonly complained?: number;
    readonly campaignId?: string | null;
    readonly senderDomain: string;
    readonly sentAt: Date;
  },
) {
  const orgId = ctx.orgId as string;
  await withTenant(ctx, async (tx) => {
    for (let i = 0; i < opts.count; i++) {
      const id = uuidv7();
      const bounced = i < (opts.bounced ?? 0);
      const complained = !bounced && i < (opts.bounced ?? 0) + (opts.complained ?? 0);
      const delivery = bounced ? 'bounced' : complained ? 'complained' : 'delivered';
      const key = opts.campaignId ? campaignDedupeKey(opts.campaignId, uuidv7()) : `fixture:${id}`;
      await tx.execute(sql`insert into notifications.messages
        (id, org_id, kind, category, channel, dedupe_key, status, recipient_email, params_ciphertext,
         sent_at, delivery, delivery_at, sender_domain, provider)
        values (${id}, ${orgId}, ${opts.campaignId ? 'marketing.message' : 'orders.confirmation'},
          ${opts.campaignId ? 'marketing' : 'transactional'}, 'email', ${key}, 'sent',
          ${`person${i}.${id.slice(-6)}@example.test`}, 'fixture', ${opts.sentAt.toISOString()}::timestamptz,
          ${delivery}, ${opts.sentAt.toISOString()}::timestamptz, ${opts.senderDomain}, 'fake')`);
      if (bounced || complained)
        await tx.execute(sql`insert into notifications.message_events
          (org_id, message_id, provider, provider_event_id, type, bounce_type, occurred_at)
          values (${orgId}, ${id}, 'fake', ${`evt_${id}`}, ${bounced ? 'bounced' : 'complained'},
            ${bounced ? 'hard' : null}, ${opts.sentAt.toISOString()}::timestamptz)`);
    }
  });
}

/** The M3.8b fixture in one org, through the real commands (see `MARKETING_FIXTURE`). */
export async function marketingScenario(
  orgId: string,
  deps: AlertDeps = { notifier: createNotifier() },
): Promise<MarketingScenario> {
  const ctx = system(orgId);
  const tag = uuidv7().slice(-8);
  const now = Date.now();
  const eventName = `Spring Gala ${tag}`;
  const event = await executeCommand(
    createEventCommand,
    {
      name: eventName,
      slug: `spring-gala-${tag}`,
      profile: 'concert',
      timezone: 'America/Chicago',
      startsAt: new Date(now + 10 * DAY).toISOString(),
      endsAt: new Date(now + 10 * DAY + 4 * 3_600_000).toISOString(),
    },
    ctx,
    ports,
  );
  const pass = await executeCommand(
    createTicketTypeCommand,
    { eventId: event.id, name: 'Gala pass', priceMinor: MARKETING_FIXTURE.priceMinor, quantityTotal: 500 },
    ctx,
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: event.id, transition: 'publish' }, ctx, ports);

  // The campaign's link, as M3.6b creates it (inside its own command), and a manual one.
  const campaignId = uuidv7();
  const campaignLink = await withTenant(ctx, (tx) =>
    createTrackedLinkTx(tx, ctx, {
      eventId: event.id,
      source: 'yayatoh',
      medium: 'email',
      campaign: 'spring-launch',
      content: 'hero',
      label: MARKETING_FIXTURE.campaignName,
      campaignId,
    }),
  );
  const social = await executeCommand(
    createTrackedLinkCommand,
    {
      eventId: event.id,
      source: 'instagram',
      medium: 'social',
      campaign: 'spring-social',
      label: MARKETING_FIXTURE.socialLabel,
    },
    ctx,
    ports,
  );

  const devices = [1, 2, 3, 4].map((n) => `mkt${n}${tag}${uuidv7().replace(/-/g, '')}`.slice(0, 40));
  const click = async (linkId: string, device: string, daysAgo: number) =>
    (
      await executeCommand(
        recordClickCommand,
        { linkId, deviceId: device, ip: '198.51.100.7' },
        createCtx({ orgId, now: new Date(now - daysAgo * DAY) }),
        ports,
      )
    ).clickId;
  const [d1, d2, d3, d4] = devices as [string, string, string, string];
  await click(campaignLink.id, d1, 3);
  await click(social.id, d1, 1);
  await click(campaignLink.id, d2, 2);
  await click(campaignLink.id, d3, 2);
  await click(campaignLink.id, d3, 1);
  await click(social.id, d4, 1);

  const buy = async (n: number, who: string) => {
    const c = await executeCommand(
      startCheckoutCommand,
      {
        eventId: event.id,
        items: [{ ticketTypeId: pass.id, quantity: n }],
        buyer: { email: `${who}.${tag}@buyers.test`, name: who },
      },
      createCtx({ orgId }),
      ports,
    );
    await pay(orgId, c.order.id, c.order.totalMinor);
    return c.order.id;
  };
  const mixed = await buy(1, 'Mira');
  await executeCommand(attributeOrderCommand, { orderId: mixed, deviceId: d1 }, createCtx({ orgId }), ports);
  const campaignOrder = await buy(2, 'Cam');
  await executeCommand(
    attributeOrderCommand,
    { orderId: campaignOrder, deviceId: d2 },
    createCtx({ orgId }),
    ports,
  );
  const podcast = await buy(1, 'Pod');
  const landing = { source: 'podcast', medium: 'audio', campaign: 'spring-podcast', at: now - DAY };
  await executeCommand(
    attributeOrderCommand,
    { orderId: podcast, utm: { first: landing, last: landing } },
    createCtx({ orgId }),
    ports,
  );

  const senderDomain = `news-${tag}.example.test`;
  await seedEmails(ctx, {
    count: MARKETING_FIXTURE.campaign.sends,
    bounced: MARKETING_FIXTURE.campaign.bounced,
    campaignId,
    senderDomain,
    sentAt: new Date(now - 2 * DAY),
  });
  await seedEmails(ctx, {
    count: MARKETING_FIXTURE.otherEmails,
    senderDomain: 'mail.yayatoh.com',
    sentAt: new Date(now - 2 * DAY),
  });

  const evaluate = async (when?: Date) => {
    await evaluateOrgNow(orgId, deps, when ? { now: when } : {});
  };
  await evaluate();

  return {
    orgId,
    eventId: event.id,
    eventSlug: event.slug,
    eventName,
    campaignId,
    campaignLinkId: campaignLink.id,
    socialLinkId: social.id,
    senderDomain,
    orders: { mixed, campaign: campaignOrder, podcast },
    evaluate,
  };
}
