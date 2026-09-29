import { createHash, randomBytes } from 'node:crypto';
import { checkinFactsTx, scanIssuesTx, staffBoardTx } from '@yayatoh/checkin';
import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { EventDto, findEventTx } from '@yayatoh/events';
import { type Ctx, createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { ticketTypeStatsTx } from '@yayatoh/ticketing';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { EVENT_MODES } from './domain/modes.ts';
import { CapacityWidgetDto, CheckinSpeedWidgetDto, capacityTx, checkinSpeedTx } from './live-widgets.ts';
import { displayLinks } from './schema.ts';
import { eventModeTx } from './view.ts';
import { localMidnight } from './widgets.ts';

/**
 * TV mode (M3.3a): a read-only board for a venue screen, opened by a display link with no session.
 * The link's token (`yytv_` + 32 random bytes) is shown once; only its SHA-256 is stored. The token
 * alone finds the org and event (a SECURITY DEFINER function returning ids only, while the link is
 * live and the org active); the board then reads under that org's RLS as the system actor
 * `display:{link}`, re-checking the link inside the transaction. Revoking stops it at the next
 * refresh. The board carries no money and no people: counts, speed, capacity and devices.
 */

const TOKEN = /^yytv_[A-Za-z0-9_-]{43}$/;
export const hashDisplayToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const DisplayLinkDto = z.object({
  id: z.uuid(),
  label: z.string(),
  createdAt: z.date(),
  revokedAt: z.date().nullable(),
});
export type DisplayLinkDto = z.infer<typeof DisplayLinkDto>;

export const createDisplayLinkCommand = tenantCommand({
  name: 'commandCenter.createDisplayLink',
  input: z.object({ eventId: z.uuid(), label: z.string().trim().min(1).max(60) }),
  // The token is returned exactly once (never audited, never stored).
  output: z.object({ id: z.uuid(), label: z.string(), token: z.string().regex(TOKEN) }),
  entitlement: 'checkin',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const token = `yytv_${randomBytes(32).toString('base64url')}`;
    const [row] = await tx
      .insert(displayLinks)
      .values({
        orgId: requireOrg(ctx),
        eventId: event.id,
        label: input.label,
        tokenHash: hashDisplayToken(token),
        createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      })
      .returning({ id: displayLinks.id });
    if (!row) throw new DomainError('internal');
    return { id: row.id, label: input.label, token };
  },
  audit: (input, r) => ({
    action: 'commandCenter.display.create',
    targetType: 'event',
    targetId: input.eventId,
    data: { linkId: r?.id ?? null, label: input.label },
  }),
});

export const revokeDisplayLinkCommand = tenantCommand({
  name: 'commandCenter.revokeDisplayLink',
  input: z.object({ eventId: z.uuid(), linkId: z.uuid() }),
  output: z.object({ revoked: z.boolean() }),
  entitlement: 'checkin',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .select({ revokedAt: displayLinks.revokedAt })
      .from(displayLinks)
      .where(and(eq(displayLinks.id, input.linkId), eq(displayLinks.eventId, input.eventId)));
    if (!row) throw new DomainError('not_found', 'Display link not found');
    if (row.revokedAt) return { revoked: false };
    await tx
      .update(displayLinks)
      .set({
        revokedAt: ctx.now,
        revokedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        updatedAt: ctx.now,
      })
      .where(eq(displayLinks.id, input.linkId));
    return { revoked: true };
  },
  audit: (input, r) => ({
    action: 'commandCenter.display.revoke',
    targetType: 'event',
    targetId: input.eventId,
    data: { linkId: input.linkId, revoked: r?.revoked ?? false },
  }),
});

export const displayLinksQuery = tenantQuery({
  name: 'commandCenter.displayLinks',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(DisplayLinkDto),
  entitlement: 'checkin',
  permission: 'events:read',
  handler: async ({ input, tx }) =>
    tx
      .select({
        id: displayLinks.id,
        label: displayLinks.label,
        createdAt: displayLinks.createdAt,
        revokedAt: displayLinks.revokedAt,
      })
      .from(displayLinks)
      .where(eq(displayLinks.eventId, input.eventId))
      .orderBy(sql`${displayLinks.revokedAt} is not null`, desc(displayLinks.createdAt)),
});

/**
 * The org and event a display token opens, and the context the board reads with (the system
 * actor `display:{link}`). Null for a malformed, unknown or revoked token, or a suspended org.
 */
export async function resolveDisplayLink(
  token: string,
): Promise<{ ctx: Ctx; eventId: string; linkId: string } | null> {
  if (!TOKEN.test(token)) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; event_id: string; link_id: string }>(
      sql`select org_id, event_id, link_id from command_center.display_link_target(${hashDisplayToken(token)})`,
    ),
  );
  const r = rows[0];
  if (!r) return null;
  return {
    ctx: createCtx({ orgId: r.org_id, actor: { type: 'system', name: `display:${r.link_id}` } }),
    eventId: r.event_id,
    linkId: r.link_id,
  };
}

const iso = z.iso.datetime({ offset: true });
const Count = z.int().min(0);

export const TvBoardDto = z.object({
  eventName: z.string(),
  timeZone: z.string(),
  mode: z.enum(EVENT_MODES),
  checkins: z.object({ today: Count, total: Count, valid: Count }),
  capacity: CapacityWidgetDto.shape.venue,
  areas: CapacityWidgetDto.shape.areas,
  speed: CheckinSpeedWidgetDto.pick({ scansPerMin: true, queueMin: true, remaining: true, series: true }).extend({
    entrances: z.array(
      z.object({ name: z.string().nullable(), scansPerMin: z.number().min(0), queueMin: z.int().min(0).nullable() }),
    ),
  }),
  devices: z.object({ online: Count, total: Count }),
  issues: z.object({ duplicates: Count, refused: Count }),
  asOf: iso,
});
export type TvBoardDto = z.infer<typeof TvBoardDto>;

async function liveLinkTx(tx: TenantTx, ctx: Ctx, eventId: string) {
  const m = ctx.actor.type === 'system' ? /^display:([0-9a-f-]{36})$/.exec(ctx.actor.name) : null;
  if (!m?.[1]) throw new DomainError('forbidden', 'A display link is required');
  const [link] = await tx
    .select({ id: displayLinks.id })
    .from(displayLinks)
    .where(and(eq(displayLinks.id, m[1]), eq(displayLinks.eventId, eventId), isNull(displayLinks.revokedAt)));
  if (!link) throw new DomainError('not_found', 'Display link not found');
}

/** The TV board for a display link's event (read-only; no money, no people). */
export const tvBoardQuery = tenantQuery({
  name: 'commandCenter.tvBoard',
  input: z.object({ eventId: z.uuid() }),
  output: TvBoardDto,
  entitlement: 'checkin',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    await liveLinkTx(tx, ctx, input.eventId);
    const found = await findEventTx(tx, input.eventId);
    if (!found) throw new DomainError('not_found', 'Event not found');
    const ev = EventDto.parse(found);
    const total = await checkinFactsTx(tx, { eventId: ev.id });
    const today = await checkinFactsTx(tx, { eventId: ev.id, from: localMidnight(ctx.now, ev.timezone) });
    const valid = (await ticketTypeStatsTx(tx, ev.id)).reduce((s, t) => s + t.valid, 0);
    const speed = await checkinSpeedTx(tx, ctx, ev);
    const cap = await capacityTx(tx, ctx, ev.id);
    const board = await staffBoardTx(tx, ev.id, ctx.now);
    const issues = await scanIssuesTx(tx, ev.id, localMidnight(ctx.now, ev.timezone), 1);
    let duplicates = 0;
    let refused = 0;
    for (const [result, n] of issues.counts)
      if (result === 'duplicate' || result === 'duplicate_offline') duplicates += n;
      else refused += n;
    return {
      eventName: ev.name,
      timeZone: ev.timezone,
      mode: (await eventModeTx(tx, ctx, ev)).mode,
      checkins: { today: today.tickets, total: total.tickets, valid },
      capacity: cap.venue,
      areas: cap.areas,
      speed: {
        scansPerMin: speed.scansPerMin,
        queueMin: speed.queueMin,
        remaining: speed.remaining,
        series: speed.series,
        entrances: speed.entrances.map((e) => ({
          name: e.name,
          scansPerMin: e.scansPerMin,
          queueMin: e.queueMin,
        })),
      },
      devices: { online: board.devices.filter((d) => d.online).length, total: board.devices.length },
      issues: { duplicates, refused },
      asOf: ctx.now.toISOString(),
    };
  },
});
