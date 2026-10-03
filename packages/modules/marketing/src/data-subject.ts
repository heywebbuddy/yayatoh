import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  defineDataSubjectContributor,
  REDACT,
  refsOf,
  type SubjectErasure,
} from '@yayatoh/platform';
import { and, asc, inArray, isNotNull, or } from 'drizzle-orm';
import { attributions, linkClicks } from './schema.ts';

/** Attribution records of the orders the person placed. */
async function attributionsTx(tx: TenantTx, s: DataSubject) {
  const orders = refsOf(s, 'order');
  if (orders.length === 0) return [];
  return tx
    .select()
    .from(attributions)
    .where(inArray(attributions.orderId, orders))
    .orderBy(asc(attributions.createdAt));
}

/**
 * marketing's part of a data-subject request (M6.1c). Clicks hold no plaintext, only keyed hashes
 * of the device and IP; the clicks attributed to the person's orders, and every other click from
 * the same device, lose both hashes, so no later purchase or click can be linked back to them.
 * The clicks (counts per link) and the order's attribution (which link sold it, no personal
 * values) stay for the organizer's reports.
 */
export const marketingDataSubjects = defineDataSubjectContributor({
  module: 'marketing',
  tables: {
    'marketing.link_clicks': REDACT,
  },
  async export(tx, s) {
    const rows = await attributionsTx(tx, s);
    return {
      sections: {
        attributions: rows.map((a) => ({
          orderId: a.orderId,
          eventId: a.eventId,
          model: a.model,
          firstAt: a.firstAt,
          lastAt: a.lastAt,
          utmSource: a.utmSource,
          utmMedium: a.utmMedium,
          utmCampaign: a.utmCampaign,
          utmContent: a.utmContent,
          utmTerm: a.utmTerm,
          firstUtmSource: a.firstUtmSource,
          firstUtmMedium: a.firstUtmMedium,
          firstUtmCampaign: a.firstUtmCampaign,
        })),
      },
    };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const rows = await attributionsTx(tx, s);
    const clickIds = [
      ...new Set(rows.flatMap((a) => [a.firstClickId, a.lastClickId]).filter((id): id is string => !!id)),
    ];
    if (clickIds.length === 0) return { erased: {} };
    const devices = (
      await tx
        .select({ deviceHash: linkClicks.deviceHash })
        .from(linkClicks)
        .where(and(inArray(linkClicks.id, clickIds), isNotNull(linkClicks.deviceHash)))
    ).flatMap((c) => (c.deviceHash ? [c.deviceHash] : []));
    const changed = await tx
      .update(linkClicks)
      .set({ deviceHash: null, ipHash: null, updatedAt: ctx.now })
      .where(
        and(
          or(
            inArray(linkClicks.id, clickIds),
            devices.length ? inArray(linkClicks.deviceHash, [...new Set(devices)]) : undefined,
          ),
          or(isNotNull(linkClicks.deviceHash), isNotNull(linkClicks.ipHash)),
        ),
      )
      .returning({ id: linkClicks.id });
    return { erased: { 'marketing.link_clicks': changed.length } };
  },
});
