import {
  computeContactStats,
  NO_SIGNALS,
  recordContactSignalTx,
  signalTotalsTx,
  statsContactPageTx,
  statsParticipationTx,
  writeContactStatsTx,
} from '@yayatoh/crm';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { eventsOverTx } from '@yayatoh/events';
import { type Ctx, createCtx, requireOrg } from '@yayatoh/kernel';
import { catchUpSubscriber, defineSubscriber, type Subscriber } from '@yayatoh/platform';
import { organizationDefaultsTx } from '@yayatoh/tenancy';
import { z } from 'zod';

/**
 * M6.1b contact stats, kept current from the outbox. The participation projector refreshes the
 * stats of every contact it touches (same transaction); this subscriber adds the two signals no
 * participation row carries. Both recompute from the sources, so a replayed or reordered event
 * converges on the same numbers, and the daily rescore (worker) moves people whose events ended.
 *
 * Event contracts (v1; producers: M5.6a session check-in, campaign open tracking):
 * - `session.attended@1` `{ eventId, sessionId, contactId, attendedAt? }`
 * - `campaign.opened@1` `{ campaignId, contactId, openedAt? }`
 */
export const CONTACT_SIGNAL_EVENTS = ['session.attended@1', 'campaign.opened@1'] as const;

export const SessionAttendedPayload = z.object({
  eventId: z.uuid(),
  sessionId: z.uuid(),
  contactId: z.uuid(),
  attendedAt: z.iso.datetime({ offset: true }).optional(),
});
export const CampaignOpenedPayload = z.object({
  campaignId: z.uuid(),
  contactId: z.uuid(),
  openedAt: z.iso.datetime({ offset: true }).optional(),
});

/** Recompute these contacts' stats from participation, signals and which events are over. */
export async function refreshContactStatsTx(
  tx: TenantTx,
  ctx: Ctx,
  contactIds: readonly string[],
): Promise<number> {
  const ids = [...new Set(contactIds)];
  if (ids.length === 0) return 0;
  const orgId = requireOrg(ctx);
  const orgCurrency = (await organizationDefaultsTx(tx, orgId))?.currency ?? 'USD';
  const participation = await statsParticipationTx(tx, ids);
  const signals = await signalTotalsTx(tx, ids);
  const over = await eventsOverTx(
    tx,
    [...participation.values()].flatMap((rows) => rows.map((r) => r.eventId)),
    ctx.now,
  );
  const results = new Map(
    ids.map((id) => [
      id,
      computeContactStats({
        participation: participation.get(id) ?? [],
        signals: signals.get(id) ?? NO_SIGNALS,
        orgCurrency,
        isOver: (eventId) => over.has(eventId),
      }),
    ]),
  );
  return writeContactStatsTx(tx, ctx, results);
}

/** The signal one outbox event carries, if any. */
export function contactSignalOf(event: {
  type: string;
  version: number;
  payload: unknown;
  occurredAt?: string;
}) {
  const at = (iso: string | undefined) => new Date(iso ?? event.occurredAt ?? Date.now());
  switch (`${event.type}@${event.version}`) {
    case 'session.attended@1': {
      const p = SessionAttendedPayload.parse(event.payload);
      return {
        contactId: p.contactId,
        kind: 'session_attended' as const,
        refId: p.sessionId,
        eventId: p.eventId,
        occurredAt: at(p.attendedAt),
      };
    }
    case 'campaign.opened@1': {
      const p = CampaignOpenedPayload.parse(event.payload);
      return {
        contactId: p.contactId,
        kind: 'campaign_opened' as const,
        refId: p.campaignId,
        eventId: null,
        occurredAt: at(p.openedAt),
      };
    }
    default:
      return null;
  }
}

/**
 * `audiences.contact_signals` (M6.1b): records a session attended or a campaign opened once per
 * (contact, session or campaign) and refreshes that contact's stats. Takes replayed history too.
 */
export function contactSignalsSubscriber(): Subscriber {
  return defineSubscriber({
    name: 'audiences.contact_signals',
    events: CONTACT_SIGNAL_EVENTS,
    acceptsReplayed: true,
    handle: async (tx, event) => {
      const signal = contactSignalOf(event);
      if (!signal) return;
      const ctx = createCtx({
        orgId: event.orgId,
        actor: { type: 'system', name: 'audiences.contact_signals' },
      });
      if (await recordContactSignalTx(tx, ctx, signal))
        await refreshContactStatsTx(tx, ctx, [signal.contactId]);
    },
  });
}

/** Apply the org's signal events not handled yet (seed, e2e, deploy catch-up). */
export function catchUpContactSignals(orgId: string) {
  return catchUpSubscriber(contactSignalsSubscriber(), orgId);
}

export const RESCORE_PAGE = 500;

/**
 * Recompute every contact's stats in one org, a page per transaction (the backfill, and the daily
 * rescore that moves people whose registrations' events have ended). Idempotent.
 */
export async function rescoreOrgContacts(
  orgId: string,
  opts: { readonly now?: Date; readonly pageSize?: number } = {},
): Promise<number> {
  const ctx = createCtx({
    orgId,
    actor: { type: 'system', name: 'audiences.contact_stats' },
    ...(opts.now ? { now: opts.now } : {}),
  });
  let after: string | null = null;
  let total = 0;
  for (;;) {
    const cursor: string | null = after;
    const done: { n: number; last: string | null } = await withTenant(ctx, async (tx) => {
      const ids = await statsContactPageTx(tx, cursor, opts.pageSize ?? RESCORE_PAGE);
      await refreshContactStatsTx(tx, ctx, ids);
      return { n: ids.length, last: ids.at(-1) ?? null };
    });
    total += done.n;
    if (!done.last || done.n < (opts.pageSize ?? RESCORE_PAGE)) return total;
    after = done.last;
  }
}
