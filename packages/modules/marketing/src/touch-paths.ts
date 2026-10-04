import type { TenantTx } from '@yayatoh/db';
import { asc, eq, inArray } from 'drizzle-orm';
import { landingKind, type TouchKind } from './domain/touches.ts';
import { attributions, attributionTouches, trackingLinks } from './schema.ts';

/** One touch of an order's path (numbers and link metadata only, never a click's hashes). */
export interface TouchFact {
  readonly at: Date;
  readonly kind: TouchKind;
  readonly source: string;
  /** UTM medium (`referral` for referral landings); null when the landing had none. */
  readonly medium: string | null;
  /** The campaign key, as in M3.8b: `c.{id}` (a messaging campaign's link), `u.{utm_campaign}`, or null. */
  readonly campaignKey: string | null;
  readonly linkId: string | null;
}

export interface TouchPath {
  readonly orderId: string;
  readonly touches: readonly TouchFact[];
}

const campaignKey = (campaignId: string | null, campaign: string | null) =>
  campaignId ? `c.${campaignId}` : campaign ? `u.${campaign}` : null;

/**
 * The touch paths of an event's attributed orders (M6.2b), for the analytics warehouse's
 * multi-touch models: each order's touches in time order. Records made before M6.2b have no
 * touch rows; their first and last touch (one when they are the same) stand in. Orders without an
 * attribution record are absent. Runs under the caller's RLS.
 */
export async function eventTouchPathsTx(tx: TenantTx, eventId: string): Promise<TouchPath[]> {
  const records = await tx
    .select()
    .from(attributions)
    .where(eq(attributions.eventId, eventId))
    .orderBy(asc(attributions.orderId));
  if (records.length === 0) return [];
  const orderIds = records.map((r) => r.orderId);
  const rows: (typeof attributionTouches.$inferSelect)[] = [];
  for (let i = 0; i < orderIds.length; i += 1000)
    rows.push(
      ...(await tx
        .select()
        .from(attributionTouches)
        .where(inArray(attributionTouches.orderId, orderIds.slice(i, i + 1000)))
        .orderBy(asc(attributionTouches.orderId), asc(attributionTouches.position))),
    );
  const byOrder = new Map<string, TouchFact[]>();
  for (const t of rows) {
    const list = byOrder.get(t.orderId) ?? [];
    list.push({
      at: t.at,
      kind: t.kind as TouchKind,
      source: t.source,
      medium: t.medium,
      campaignKey: campaignKey(t.campaignId, t.campaign),
      linkId: t.linkId,
    });
    byOrder.set(t.orderId, list);
  }
  const legacy = records.filter((r) => !byOrder.has(r.orderId));
  const linkIds = [
    ...new Set(legacy.flatMap((r) => [r.firstLinkId, r.lastLinkId]).filter((x): x is string => !!x)),
  ];
  const links = new Map(
    (linkIds.length
      ? await tx
          .select({
            id: trackingLinks.id,
            campaignId: trackingLinks.campaignId,
            source: trackingLinks.utmSource,
            medium: trackingLinks.utmMedium,
            campaign: trackingLinks.utmCampaign,
          })
          .from(trackingLinks)
          .where(inArray(trackingLinks.id, linkIds))
      : []
    ).map((l) => [l.id, l] as const),
  );
  for (const r of legacy) {
    const touches: TouchFact[] = [];
    if (r.model === 'click') {
      for (const [linkId, at] of [
        [r.firstLinkId, r.firstAt],
        [r.lastLinkId, r.lastAt],
      ] as const) {
        const l = linkId ? links.get(linkId) : undefined;
        if (!l) continue;
        touches.push({
          at,
          kind: 'click',
          source: l.source,
          medium: l.medium,
          campaignKey: campaignKey(l.campaignId, l.campaign),
          linkId: l.id,
        });
      }
    } else {
      const first = {
        source: r.firstUtmSource ?? r.utmSource ?? 'unknown',
        medium: r.firstUtmMedium,
        campaign: r.firstUtmCampaign,
      };
      const last = { source: r.utmSource ?? 'unknown', medium: r.utmMedium, campaign: r.utmCampaign };
      for (const [u, at] of [
        [first, r.firstAt],
        [last, r.lastAt],
      ] as const)
        touches.push({
          at,
          kind: landingKind(u),
          source: u.source,
          medium: u.medium,
          campaignKey: campaignKey(null, u.campaign),
          linkId: null,
        });
    }
    // The same touch twice (first = last) is one touch.
    const [a, b] = touches;
    if (a && b && a.at.getTime() === b.at.getTime() && a.linkId === b.linkId && a.source === b.source)
      touches.pop();
    if (touches.length) byOrder.set(r.orderId, touches);
  }
  return orderIds.flatMap((orderId) => {
    const touches = byOrder.get(orderId);
    return touches ? [{ orderId, touches }] : [];
  });
}
