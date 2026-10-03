import type { TenantTx } from '@yayatoh/db';
import { type Ctx, requireOrg } from '@yayatoh/kernel';
import { publishRealtimeTx } from '@yayatoh/platform';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { type CallStatus, callTotals, type EntryStatus } from './domain/paddles.ts';
import {
  type CallDto,
  type ConsoleLiveDto,
  PADDLE_CONSOLE_CHANNEL,
  type RaiseTotalsDto,
  SPOTTER_CHANNEL,
  type SpotterStateDto,
} from './paddle-dto.ts';
import { paddleCalls, paddleEntries, paddles, pledges } from './schema-paddles.ts';

type CallRow = typeof paddleCalls.$inferSelect;

/** The event's open call, locked for a write when `forUpdate`. */
export async function openCallTx(tx: TenantTx, eventId: string, forUpdate = false) {
  const q = tx
    .select()
    .from(paddleCalls)
    .where(and(eq(paddleCalls.eventId, eventId), eq(paddleCalls.status, 'open')));
  const [row] = forUpdate ? await q.for('update') : await q;
  return row ?? null;
}

/** Entry statuses per call. */
async function statusesByCallTx(tx: TenantTx, callIds: readonly string[]) {
  const out = new Map<string, EntryStatus[]>();
  if (callIds.length === 0) return out;
  const rows = await tx
    .select({
      callId: paddleEntries.callId,
      status: paddleEntries.status,
      n: sql<number>`count(*)::int`,
    })
    .from(paddleEntries)
    .where(inArray(paddleEntries.callId, [...callIds]))
    .groupBy(paddleEntries.callId, paddleEntries.status);
  for (const r of rows)
    out.set(r.callId, [...(out.get(r.callId) ?? []), ...Array(r.n).fill(r.status as EntryStatus)]);
  return out;
}

export function callDto(c: CallRow, statuses: readonly EntryStatus[]): CallDto {
  return {
    id: c.id,
    campaignId: c.campaignId,
    levelName: c.levelName,
    amountMinor: c.amountMinor,
    currency: c.currency,
    status: c.status as CallStatus,
    openedAt: c.openedAt.toISOString(),
    closedAt: c.closedAt?.toISOString() ?? null,
    ...callTotals(c.amountMinor, statuses),
  };
}

/** Every call of the event that counts (withdrawn ones aside), newest first, with totals. */
export async function callsOfEventTx(tx: TenantTx, eventId: string): Promise<CallDto[]> {
  const rows = await tx
    .select()
    .from(paddleCalls)
    .where(and(eq(paddleCalls.eventId, eventId), ne(paddleCalls.status, 'withdrawn')))
    .orderBy(desc(paddleCalls.openedAt), desc(paddleCalls.id));
  const statuses = await statusesByCallTx(
    tx,
    rows.map((r) => r.id),
  );
  return rows.map((r) => callDto(r, statuses.get(r.id) ?? []));
}

/** Totals over every call of the event, in the event's currency. */
export async function raiseTotalsTx(
  tx: TenantTx,
  eventId: string,
  currency: string,
  calls?: readonly CallDto[],
): Promise<RaiseTotalsDto> {
  const list = calls ?? (await callsOfEventTx(tx, eventId));
  const [p = { sum: '0', n: 0 }] = await tx
    .select({
      sum: sql<string>`coalesce(sum(${pledges.amountMinor}), 0)::text`,
      n: sql<number>`count(*)::int`,
    })
    .from(pledges)
    .where(and(eq(pledges.eventId, eventId), eq(pledges.status, 'confirmed')));
  const own = list.filter((c) => c.currency === currency);
  return {
    count: own.reduce((a, c) => a + c.count, 0),
    totalMinor: own.reduce((a, c) => a + c.totalMinor, 0),
    pledgedMinor: Number(p.sum),
    pledgeCount: p.n,
    toReview: list.reduce((a, c) => a + (c.count - c.confirmed) + c.duplicates, 0),
    duplicates: list.reduce((a, c) => a + c.duplicates, 0),
    currency,
  };
}

export async function consoleLiveTx(
  tx: TenantTx,
  eventId: string,
  currency: string,
): Promise<ConsoleLiveDto> {
  const calls = await callsOfEventTx(tx, eventId);
  return {
    open: calls.find((c) => c.status === 'open') ?? null,
    totals: await raiseTotalsTx(tx, eventId, currency, calls),
  };
}

export async function spotterStateTx(tx: TenantTx, eventId: string): Promise<SpotterStateDto> {
  const [call, numbers] = await Promise.all([
    openCallTx(tx, eventId),
    tx
      .select({ number: paddles.number })
      .from(paddles)
      .where(eq(paddles.eventId, eventId))
      .orderBy(asc(paddles.number)),
  ]);
  return {
    call: call
      ? { id: call.id, levelName: call.levelName, amountMinor: call.amountMinor, currency: call.currency }
      : null,
    paddles: numbers.map((n) => n.number),
  };
}

/** Tell spotters' phones the level being called and the paddle numbers (in the write's transaction). */
export async function publishSpotterStateTx(tx: TenantTx, ctx: Ctx, eventId: string) {
  await publishRealtimeTx(tx, requireOrg(ctx), SPOTTER_CHANNEL, {
    eventId,
    event: 'state',
    data: await spotterStateTx(tx, eventId),
  });
}

/** Tell the console and the recorder the open call and the totals (in the write's transaction). */
export async function publishConsoleStateTx(tx: TenantTx, ctx: Ctx, eventId: string, currency: string) {
  await publishRealtimeTx(tx, requireOrg(ctx), PADDLE_CONSOLE_CHANNEL, {
    eventId,
    event: 'state',
    data: await consoleLiveTx(tx, eventId, currency),
  });
}
