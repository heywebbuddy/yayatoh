import type { TenantTx } from '@yayatoh/db';
import { publishRealtimeTx } from '@yayatoh/platform';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { DisplayAs } from './domain/giving.ts';
import { SCREEN_THANKS_MAX, screenName } from './domain/screen.ts';
import { EMPTY_SCREEN, GIVING_SCREEN_CHANNEL, type ScreenStateDto } from './screen-dto.ts';
import { campaigns, gifts } from './schema.ts';
import { paddleCalls, paddleEntries } from './schema-paddles.ts';
import { screens } from './schema-screens.ts';

/** Paddle entries that count towards a level (the console's rule, `callTotals`). */
const COUNTED = ['recorded', 'confirmed'];

/** The event's screen settings row, or null before the host sets the screen up. */
export async function screenRowTx(tx: TenantTx, eventId: string) {
  const [row] = await tx.select().from(screens).where(eq(screens.eventId, eventId));
  return row ?? null;
}

/**
 * What the room's screen shows (M4.8d), allowlisted: the campaign's goal and its total (paid gifts
 * without the fee cover, plus the paddles counted at its levels, in its currency), how many gifts
 * and paddles that is, the level being called with its paddle count, and the names of donors who
 * asked to be thanked on screen (P4-13), newest first. A paddle's holder is never named: a pledge
 * carries no consent to be shown.
 */
export async function screenStateTx(tx: TenantTx, eventId: string): Promise<ScreenStateDto> {
  const screen = await screenRowTx(tx, eventId);
  if (!screen) return EMPTY_SCREEN;
  const [campaign] = await tx
    .select({ id: campaigns.id, name: campaigns.name, goalMinor: campaigns.goalMinor, currency: campaigns.currency })
    .from(campaigns)
    .where(and(eq(campaigns.id, screen.campaignId), eq(campaigns.eventId, eventId)));
  if (!campaign) return EMPTY_SCREEN;
  const [given = { sum: '0', n: 0 }] = await tx
    .select({ sum: sql<string>`coalesce(sum(${gifts.amountMinor}), 0)::text`, n: sql<number>`count(*)::int` })
    .from(gifts)
    .where(and(eq(gifts.campaignId, campaign.id), eq(gifts.status, 'paid')));
  const [raised = { sum: '0', n: 0 }] = await tx
    .select({
      sum: sql<string>`coalesce(sum(${paddleCalls.amountMinor}), 0)::text`,
      n: sql<number>`count(*)::int`,
    })
    .from(paddleEntries)
    .innerJoin(
      paddleCalls,
      and(eq(paddleCalls.orgId, paddleEntries.orgId), eq(paddleCalls.id, paddleEntries.callId)),
    )
    .where(
      and(
        eq(paddleCalls.campaignId, campaign.id),
        eq(paddleCalls.currency, campaign.currency),
        ne(paddleCalls.status, 'withdrawn'),
        inArray(paddleEntries.status, COUNTED),
      ),
    );
  const [open] = await tx
    .select()
    .from(paddleCalls)
    .where(
      and(
        eq(paddleCalls.eventId, eventId),
        eq(paddleCalls.campaignId, campaign.id),
        eq(paddleCalls.status, 'open'),
      ),
    );
  let calling: ScreenStateDto['calling'] = null;
  if (open) {
    const [c = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(paddleEntries)
      .where(and(eq(paddleEntries.callId, open.id), inArray(paddleEntries.status, COUNTED)));
    calling = {
      levelName: open.levelName,
      amountMinor: open.amountMinor,
      currency: open.currency,
      paddles: c.n,
    };
  }
  const named = screen.showNames
    ? await tx
        .select({ donorName: gifts.donorName, displayAs: gifts.displayAs, showOnScreen: gifts.showOnScreen })
        .from(gifts)
        .where(
          and(
            eq(gifts.campaignId, campaign.id),
            eq(gifts.status, 'paid'),
            eq(gifts.showOnScreen, true),
            ne(gifts.displayAs, 'anonymous'),
          ),
        )
        .orderBy(desc(gifts.paidAt), desc(gifts.id))
        .limit(SCREEN_THANKS_MAX)
    : [];
  return {
    campaign: { name: campaign.name, goalMinor: campaign.goalMinor, currency: campaign.currency },
    totalMinor: Number(given.sum) + Number(raised.sum),
    gifts: given.n + raised.n,
    calling,
    thanks: named
      .map((g) => screenName({ ...g, displayAs: g.displayAs as DisplayAs }))
      .filter((n): n is string => n !== null),
  };
}

/**
 * Tell the event's screen what it shows now (in the write's transaction). Nothing is published
 * before the host sets the screen up.
 */
export async function publishScreenStateTx(tx: TenantTx, orgId: string, eventId: string) {
  if (!(await screenRowTx(tx, eventId))) return;
  await publishRealtimeTx(tx, orgId, GIVING_SCREEN_CHANNEL, {
    eventId,
    event: 'state',
    data: await screenStateTx(tx, eventId),
  });
}

/** The screens of these campaigns' events (a campaign edit or a gift moves them). */
export async function screenEventsOfCampaignTx(tx: TenantTx, campaignId: string): Promise<string[]> {
  const rows = await tx
    .select({ eventId: screens.eventId })
    .from(screens)
    .where(eq(screens.campaignId, campaignId));
  return rows.map((r) => r.eventId);
}
