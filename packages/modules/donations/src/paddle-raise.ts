import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { campaignOfEventTx, levelsByCampaignTx } from './campaigns.ts';
import { type EntryOutcome, type EntryStatus, entryStatusFor, undoStep } from './domain/paddles.ts';
import {
  PaddleConsoleDto,
  PaddleReviewDto,
  RecordPaddlesInput,
  RecordPaddlesOutput,
  SpotterStateDto,
} from './paddle-dto.ts';
import {
  callDto,
  callsOfEventTx,
  openCallTx,
  publishConsoleStateTx,
  publishSpotterStateTx,
  raiseTotalsTx,
  spotterStateTx,
} from './paddle-live.ts';
import { paddleEventTx, paddleNamesTx } from './paddles.ts';
import { campaigns, levels } from './schema.ts';
import { activeMatchesTx, resyncMatchPledgesTx } from './match-progress.ts';
import { paddleCalls, paddleEntries, paddles, pledges } from './schema-paddles.ts';

/**
 * The paddle raise (M4.8c): the console arms a level (a call), spotters record the paddles they
 * see, the console closes the level or undoes the last step, and the recorder turns recorded
 * paddles into confirmed pledges. Every write tells the live channels in its own transaction.
 */

const publishAll = async (
  tx: TenantTx,
  ctx: Parameters<typeof publishSpotterStateTx>[1],
  eventId: string,
  currency: string,
) => {
  await publishSpotterStateTx(tx, ctx, eventId);
  await publishConsoleStateTx(tx, ctx, eventId, currency);
};

/** Arm a level: the auctioneer starts calling it. One level at a time per event. */
export const armLevelCommand = tenantCommand({
  name: 'donations.armLevel',
  input: z.object({ eventId: z.uuid(), campaignId: z.uuid(), levelId: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  entitlement: 'donations',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await paddleEventTx(tx, input.eventId);
    const campaign = await campaignOfEventTx(tx, event.id, input.campaignId);
    const [level] = await tx
      .select()
      .from(levels)
      .where(and(eq(levels.id, input.levelId), eq(levels.campaignId, campaign.id)));
    if (!level) throw new DomainError('not_found', 'Level not found', { field: 'levelId' });
    const busy = () =>
      new DomainError('conflict', 'Close the level being called first', { reason: 'call_open' });
    if (await openCallTx(tx, event.id, true)) throw busy();
    try {
      const [row] = await tx
        .insert(paddleCalls)
        .values({
          orgId: requireOrg(ctx),
          eventId: event.id,
          campaignId: campaign.id,
          levelId: level.id,
          levelName: level.name,
          amountMinor: level.amountMinor,
          currency: campaign.currency,
          openedAt: ctx.now,
        })
        .returning({ id: paddleCalls.id });
      if (!row) throw new DomainError('internal');
      await publishAll(tx, ctx, event.id, event.currency);
      return row;
    } catch (err) {
      if (isUniqueViolation(err)) throw busy();
      throw err;
    }
  },
  audit: (input, r) => ({
    action: 'donations.paddle_call.arm',
    targetType: 'donation_paddle_call',
    targetId: r.id,
    data: { eventId: input.eventId, levelId: input.levelId },
  }),
});

/** Close the level being called (spotters' late entries for it are still accepted). */
export const closeCallCommand = tenantCommand({
  name: 'donations.closeCall',
  input: z.object({ eventId: z.uuid(), callId: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  entitlement: 'donations',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await paddleEventTx(tx, input.eventId);
    const [call] = await tx
      .select()
      .from(paddleCalls)
      .where(and(eq(paddleCalls.id, input.callId), eq(paddleCalls.eventId, event.id)))
      .for('update');
    if (!call) throw new DomainError('not_found', 'Level not found');
    if (call.status !== 'open')
      throw new DomainError('invalid_state', 'This level is not being called', { reason: 'not_open' });
    await tx
      .update(paddleCalls)
      .set({ status: 'closed', closedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(paddleCalls.id, call.id));
    await publishAll(tx, ctx, event.id, event.currency);
    return { id: call.id };
  },
  audit: (input) => ({
    action: 'donations.paddle_call.close',
    targetType: 'donation_paddle_call',
    targetId: input.callId,
  }),
});

/**
 * Undo the room's last step (`undoStep`): set aside the newest paddle waiting for review while a
 * level is open, withdraw an arm with no paddles, or reopen the level just closed.
 */
export const undoPaddleStepCommand = tenantCommand({
  name: 'donations.undoPaddleStep',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({
    undone: z.enum(['void_entry', 'withdraw_call', 'reopen_call']),
    paddleNumber: z.int().nullable(),
    levelName: z.string(),
  }),
  entitlement: 'donations',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await paddleEventTx(tx, input.eventId);
    const [latest] = await tx
      .select()
      .from(paddleCalls)
      .where(and(eq(paddleCalls.eventId, event.id), ne(paddleCalls.status, 'withdrawn')))
      .orderBy(desc(paddleCalls.openedAt), desc(paddleCalls.id))
      .limit(1)
      .for('update');
    const entries = latest
      ? await tx
          .select({ id: paddleEntries.id, status: paddleEntries.status, number: paddleEntries.paddleNumber })
          .from(paddleEntries)
          .where(eq(paddleEntries.callId, latest.id))
          .orderBy(desc(paddleEntries.createdAt), desc(paddleEntries.id))
      : [];
    const step = undoStep(
      latest ? { status: latest.status as 'open' | 'closed' } : null,
      entries.map((e) => ({ id: e.id, status: e.status as EntryStatus })),
    );
    if (step.kind === 'nothing' || !latest)
      throw new DomainError('invalid_state', 'Nothing to undo', { reason: 'nothing_to_undo' });
    let paddleNumber: number | null = null;
    if (step.kind === 'void_entry') {
      await tx
        .update(paddleEntries)
        .set({ status: 'voided', reviewedAt: ctx.now, updatedAt: ctx.now })
        .where(eq(paddleEntries.id, step.entryId));
      paddleNumber = entries.find((e) => e.id === step.entryId)?.number ?? null;
    } else if (step.kind === 'withdraw_call') {
      await tx
        .update(paddleCalls)
        .set({ status: 'withdrawn', updatedAt: ctx.now })
        .where(eq(paddleCalls.id, latest.id));
    } else {
      await tx
        .update(paddleCalls)
        .set({ status: 'open', closedAt: null, updatedAt: ctx.now })
        .where(eq(paddleCalls.id, latest.id));
    }
    await publishAll(tx, ctx, event.id, event.currency);
    return { undone: step.kind, paddleNumber, levelName: latest.levelName };
  },
  audit: (input, r) => ({
    action: 'donations.paddle_call.undo',
    targetType: 'event',
    targetId: input.eventId,
    data: { undone: r.undone },
  }),
});

/**
 * Spotters' entries (a sync batch from one phone). Each entry carries the device's own id, so a
 * batch sent again after a lost answer is stored once: a known id gets its stored status back. A
 * paddle not given at this event, or a level that isn't this event's, is refused (not stored);
 * the same paddle twice at a call is stored as a duplicate for the recorder, never dropped.
 */
export const recordPaddlesCommand = tenantCommand({
  name: 'donations.recordPaddles',
  input: RecordPaddlesInput,
  output: RecordPaddlesOutput,
  entitlement: 'donations',
  permission: 'checkin:scan',
  handler: async ({ input, ctx, tx }) => {
    const event = await paddleEventTx(tx, input.eventId);
    const orgId = requireOrg(ctx);
    // One answer per client id (a batch may repeat one).
    const batch = [...new Map(input.entries.map((e) => [e.clientId, e])).values()];
    // Lock the calls first (in id order): batches for one call queue up, so duplicate checks see
    // every entry committed before them.
    const callIds = [...new Set(batch.map((e) => e.callId))].sort();
    const calls = new Map(
      (
        await tx
          .select()
          .from(paddleCalls)
          .where(and(inArray(paddleCalls.id, callIds), eq(paddleCalls.eventId, event.id)))
          .orderBy(asc(paddleCalls.id))
          .for('update')
      ).map((c) => [c.id, c]),
    );
    const known = new Map(
      (
        await tx
          .select({
            clientId: paddleEntries.clientId,
            status: paddleEntries.status,
            eventId: paddleEntries.eventId,
          })
          .from(paddleEntries)
          .where(
            inArray(
              paddleEntries.clientId,
              batch.map((e) => e.clientId),
            ),
          )
      ).map((r) => [r.clientId, r]),
    );
    const numbers = [...new Set(batch.map((e) => e.paddle))];
    const paddleIds = new Map(
      (
        await tx
          .select({ id: paddles.id, number: paddles.number })
          .from(paddles)
          .where(and(eq(paddles.eventId, event.id), inArray(paddles.number, numbers)))
      ).map((p) => [p.number, p.id]),
    );
    // What each (call, paddle) already has: statuses and the first entry that counts.
    const seen = new Map<string, { statuses: EntryStatus[]; first: string | null }>();
    const liveCalls = [...calls.keys()];
    if (liveCalls.length > 0)
      for (const r of await tx
        .select({
          id: paddleEntries.id,
          callId: paddleEntries.callId,
          number: paddleEntries.paddleNumber,
          status: paddleEntries.status,
        })
        .from(paddleEntries)
        .where(and(inArray(paddleEntries.callId, liveCalls), inArray(paddleEntries.paddleNumber, numbers)))
        .orderBy(asc(paddleEntries.createdAt), asc(paddleEntries.id))) {
        const key = `${r.callId}:${r.number}`;
        const s = seen.get(key) ?? { statuses: [], first: null };
        s.statuses.push(r.status as EntryStatus);
        if (!s.first && r.status !== 'voided' && r.status !== 'duplicate') s.first = r.id;
        seen.set(key, s);
      }
    const results: { clientId: string; outcome: EntryOutcome }[] = [];
    let stored = 0;
    for (const e of batch) {
      const k = known.get(e.clientId);
      if (k) {
        // Another event's entry with this id is not this phone's: refused, never revealed.
        results.push({
          clientId: e.clientId,
          outcome:
            k.eventId === event.id
              ? { status: k.status as EntryStatus }
              : { status: 'refused', reason: 'call_unknown' },
        });
        continue;
      }
      const call = calls.get(e.callId);
      if (!call) {
        results.push({ clientId: e.clientId, outcome: { status: 'refused', reason: 'call_unknown' } });
        continue;
      }
      if (call.status === 'withdrawn') {
        results.push({ clientId: e.clientId, outcome: { status: 'refused', reason: 'call_withdrawn' } });
        continue;
      }
      const paddleId = paddleIds.get(e.paddle);
      if (!paddleId) {
        results.push({ clientId: e.clientId, outcome: { status: 'refused', reason: 'paddle_unknown' } });
        continue;
      }
      const key = `${call.id}:${e.paddle}`;
      const s = seen.get(key) ?? { statuses: [], first: null };
      const status = entryStatusFor(s.statuses);
      const [row] = await tx
        .insert(paddleEntries)
        .values({
          orgId,
          eventId: event.id,
          callId: call.id,
          clientId: e.clientId,
          paddleId,
          paddleNumber: e.paddle,
          status,
          duplicateOf: status === 'duplicate' ? s.first : null,
          spotterUserId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
          recordedAt: e.recordedAt.getTime() > ctx.now.getTime() ? ctx.now : e.recordedAt,
        })
        .onConflictDoNothing({ target: [paddleEntries.orgId, paddleEntries.clientId] })
        .returning({ id: paddleEntries.id });
      if (!row) {
        // The same entry arrived on a parallel request that committed first: its answer stands.
        const [again] = await tx
          .select({ status: paddleEntries.status })
          .from(paddleEntries)
          .where(eq(paddleEntries.clientId, e.clientId));
        results.push({
          clientId: e.clientId,
          outcome: { status: (again?.status ?? 'recorded') as EntryStatus },
        });
        continue;
      }
      stored++;
      s.statuses.push(status);
      if (!s.first && status === 'recorded') s.first = row.id;
      seen.set(key, s);
      results.push({ clientId: e.clientId, outcome: { status } });
    }
    if (stored > 0) await publishConsoleStateTx(tx, ctx, event.id, event.currency);
    return { results };
  },
  audit: (input, r) => ({
    action: 'donations.paddle_entry.record',
    targetType: 'event',
    targetId: input.eventId,
    data: {
      entries: r.results.length,
      refused: r.results.filter((x) => x.outcome.status === 'refused').length,
      duplicates: r.results.filter((x) => x.outcome.status === 'duplicate').length,
    },
  }),
});

/**
 * The recorder confirms entries: each becomes one pledge of its level's amount for the paddle's
 * holder. Either the chosen entries (duplicates included, when the recorder decides they are real)
 * or every recorded entry of one level. Confirming twice makes no second pledge.
 */
export const confirmEntriesCommand = tenantCommand({
  name: 'donations.confirmEntries',
  input: z
    .object({
      eventId: z.uuid(),
      entryIds: z.array(z.uuid()).min(1).max(500).optional(),
      callId: z.uuid().optional(),
    })
    .refine((v) => !!v.entryIds !== !!v.callId, { message: 'Choose entries or a level' }),
  output: z.object({ confirmed: z.int(), skipped: z.int() }),
  entitlement: 'donations',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await paddleEventTx(tx, input.eventId);
    const rows = await tx
      .select()
      .from(paddleEntries)
      .where(
        and(
          eq(paddleEntries.eventId, event.id),
          input.entryIds
            ? inArray(paddleEntries.id, input.entryIds)
            : and(eq(paddleEntries.callId, input.callId ?? ''), eq(paddleEntries.status, 'recorded')),
        ),
      )
      .orderBy(asc(paddleEntries.createdAt), asc(paddleEntries.id))
      .for('update');
    if (input.entryIds && rows.length !== new Set(input.entryIds).size)
      throw new DomainError('not_found', 'Entry not found');
    const callIds = [...new Set(rows.map((r) => r.callId))];
    const calls = new Map(
      (callIds.length ? await tx.select().from(paddleCalls).where(inArray(paddleCalls.id, callIds)) : []).map(
        (c) => [c.id, c],
      ),
    );
    const paddleIds = [...new Set(rows.flatMap((r) => (r.paddleId ? [r.paddleId] : [])))];
    const holders = new Map(
      (paddleIds.length ? await tx.select().from(paddles).where(inArray(paddles.id, paddleIds)) : []).map(
        (p) => [p.id, p],
      ),
    );
    const orgId = requireOrg(ctx);
    let confirmed = 0;
    let skipped = 0;
    for (const r of rows) {
      const call = calls.get(r.callId);
      const holder = r.paddleId ? holders.get(r.paddleId) : undefined;
      if ((r.status !== 'recorded' && r.status !== 'duplicate') || !call || !holder) {
        skipped++;
        continue;
      }
      await tx.insert(pledges).values({
        orgId,
        eventId: event.id,
        campaignId: call.campaignId,
        callId: call.id,
        entryId: r.id,
        paddleNumber: r.paddleNumber,
        guestId: holder.guestId,
        partyId: holder.partyId,
        amountMinor: call.amountMinor,
        currency: call.currency,
        confirmedAt: ctx.now,
      });
      await tx
        .update(paddleEntries)
        .set({ status: 'confirmed', reviewedAt: ctx.now, updatedAt: ctx.now })
        .where(eq(paddleEntries.id, r.id));
      confirmed++;
    }
    if (confirmed > 0) await publishConsoleStateTx(tx, ctx, event.id, event.currency);
    return { confirmed, skipped };
  },
  audit: (input, r) => ({
    action: 'donations.pledge.confirm',
    targetType: 'event',
    targetId: input.eventId,
    data: { confirmed: r.confirmed, skipped: r.skipped, callId: input.callId ?? null },
  }),
});

/** The recorder sets an entry aside (a mistaken number); a pledge made from it is cancelled. */
export const voidEntryCommand = tenantCommand({
  name: 'donations.voidEntry',
  input: z.object({ eventId: z.uuid(), entryId: z.uuid() }),
  output: z.object({ voided: z.boolean(), pledgeCancelled: z.boolean() }),
  entitlement: 'donations',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await paddleEventTx(tx, input.eventId);
    const [e] = await tx
      .select()
      .from(paddleEntries)
      .where(and(eq(paddleEntries.id, input.entryId), eq(paddleEntries.eventId, event.id)))
      .for('update');
    if (!e) throw new DomainError('not_found', 'Entry not found');
    if (e.status === 'voided') return { voided: false, pledgeCancelled: false };
    const cancelled =
      e.status === 'confirmed'
        ? await tx
            .update(pledges)
            .set({ status: 'cancelled', cancelledAt: ctx.now, updatedAt: ctx.now })
            .where(and(eq(pledges.entryId, e.id), eq(pledges.status, 'confirmed')))
            .returning({ id: pledges.id, campaignId: pledges.campaignId })
        : [];
    // M4.8f: a sponsor's recorded match comes down with the pledges it matched.
    for (const p of cancelled) await resyncMatchPledgesTx(tx, p.campaignId, ctx.now);
    await tx
      .update(paddleEntries)
      .set({ status: 'voided', reviewedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(paddleEntries.id, e.id));
    await publishConsoleStateTx(tx, ctx, event.id, event.currency);
    return { voided: true, pledgeCancelled: cancelled.length > 0 };
  },
  audit: (input, r) => ({
    action: 'donations.paddle_entry.void',
    targetType: 'donation_paddle_entry',
    targetId: input.entryId,
    data: { pledgeCancelled: r.pledgeCancelled },
  }),
});

/** The host console: campaigns and levels to arm, the open call, every call and the totals. */
export const paddleConsoleQuery = tenantQuery({
  name: 'donations.paddleConsole',
  input: z.object({ eventId: z.uuid() }),
  output: PaddleConsoleDto,
  entitlement: 'donations',
  permission: 'orders:read',
  handler: async ({ input, ctx, tx }) => {
    const event = await paddleEventTx(tx, input.eventId);
    const cs = await tx
      .select()
      .from(campaigns)
      .where(eq(campaigns.eventId, event.id))
      .orderBy(asc(campaigns.position), asc(campaigns.createdAt));
    const lv = await levelsByCampaignTx(
      tx,
      cs.map((c) => c.id),
    );
    const calls = await callsOfEventTx(tx, event.id);
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(paddles)
      .where(eq(paddles.eventId, event.id));
    return {
      campaigns: cs.map((c) => ({
        id: c.id,
        name: c.name,
        currency: c.currency,
        levels: [...(lv.get(c.id) ?? [])]
          .sort((a, b) => b.amountMinor - a.amountMinor)
          .map((l) => ({ id: l.id, name: l.name, amountMinor: l.amountMinor })),
      })),
      open: calls.find((c) => c.status === 'open') ?? null,
      calls,
      totals: await raiseTotalsTx(tx, event.id, event.currency, calls),
      matches: await activeMatchesTx(tx, event.id, ctx.now),
      paddleCount: n,
    };
  },
});

/** A spotter's phone: the level being called and the paddle numbers (never names or amounts given). */
export const spotterStateQuery = tenantQuery({
  name: 'donations.spotterState',
  input: z.object({ eventId: z.uuid() }),
  output: SpotterStateDto,
  entitlement: 'donations',
  permission: 'checkin:scan',
  handler: async ({ input, tx }) => {
    const event = await paddleEventTx(tx, input.eventId);
    return spotterStateTx(tx, event.id);
  },
});

/** The recorder's review: every call (newest first) with its entries and the holders' names. */
export const paddleReviewQuery = tenantQuery({
  name: 'donations.paddleReview',
  input: z.object({ eventId: z.uuid() }),
  output: PaddleReviewDto,
  entitlement: 'donations',
  permission: 'orders:read',
  handler: async ({ input, tx }) => {
    const event = await paddleEventTx(tx, input.eventId);
    const callRows = await tx
      .select()
      .from(paddleCalls)
      .where(and(eq(paddleCalls.eventId, event.id), ne(paddleCalls.status, 'withdrawn')))
      .orderBy(desc(paddleCalls.openedAt), desc(paddleCalls.id));
    const entries = callRows.length
      ? await tx
          .select()
          .from(paddleEntries)
          .where(
            inArray(
              paddleEntries.callId,
              callRows.map((c) => c.id),
            ),
          )
          .orderBy(asc(paddleEntries.createdAt), asc(paddleEntries.id))
          .limit(5_000)
      : [];
    const paddleIds = [...new Set(entries.flatMap((e) => (e.paddleId ? [e.paddleId] : [])))];
    const names = await paddleNamesTx(
      tx,
      paddleIds.length
        ? await tx
            .select({ id: paddles.id, guestId: paddles.guestId, partyId: paddles.partyId })
            .from(paddles)
            .where(inArray(paddles.id, paddleIds))
        : [],
    );
    const byCall = new Map<string, typeof entries>();
    for (const e of entries) byCall.set(e.callId, [...(byCall.get(e.callId) ?? []), e]);
    const calls = callRows.map((c) => {
      const list = byCall.get(c.id) ?? [];
      return {
        call: callDto(
          c,
          list.map((e) => e.status as EntryStatus),
        ),
        entries: list.map((e) => ({
          id: e.id,
          paddleNumber: e.paddleNumber,
          holderName: e.paddleId ? (names.get(e.paddleId) ?? null) : null,
          status: e.status as EntryStatus,
          duplicateOf: e.duplicateOf,
          recordedAt: e.recordedAt,
          receivedAt: e.createdAt,
        })),
      };
    });
    return {
      calls,
      totals: await raiseTotalsTx(
        tx,
        event.id,
        event.currency,
        calls.map((c) => c.call),
      ),
    };
  },
});
