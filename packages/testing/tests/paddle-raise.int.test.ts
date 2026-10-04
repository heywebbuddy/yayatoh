import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  armLevelCommand,
  assignPaddleCommand,
  bulkAssignPaddlesCommand,
  closeCallCommand,
  confirmEntriesCommand,
  createCampaignCommand,
  createLevelCommand,
  type EntryOutcome,
  PADDLE_CONSOLE_CHANNEL,
  paddleConsoleQuery,
  paddleReviewQuery,
  paddlesQuery,
  recordPaddlesCommand,
  releasePaddleCommand,
  SPOTTER_CHANNEL,
  spotterStateQuery,
  undoPaddleStepCommand,
  voidEntryCommand,
} from '@yayatoh/donations';
import {
  emptyQueue,
  enqueue,
  nextBatch,
  type QueuedEntry,
  type SpotterQueue,
  settle,
} from '@yayatoh/donations/paddle-queue';
import { createEventCommand } from '@yayatoh/events';
import { type Ctx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { realtimeChannelName } from '@yayatoh/platform';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M4.8c paddle raise: paddle numbers for guests and parties (one at a time, bulk, by table), the
 * console (arm, close, undo), spotters' entries synced exactly once with duplicates flagged and
 * unknown paddles refused, the recorder's pledges, live channels without names (P4-13),
 * permissions and tenant isolation. The acceptance run: 30 spotters record 400 paddles, half of
 * them offline for two minutes, with lost answers and replays.
 */

let a: OrgFixture;
let b: OrgFixture;

interface Gala {
  readonly id: string;
  readonly campaignId: string;
  readonly levels: { readonly top: string; readonly mid: string; readonly low: string };
  readonly guests: string[];
  readonly parties: string[];
}

const q = <T extends Record<string, unknown>>(f: OrgFixture, query: ReturnType<typeof sql>) =>
  withTenant(systemCtx(f.org.id), (tx) => tx.execute<T>(query));

/** A gala with a campaign of three levels and `parties` × `perParty` named guests (rows only). */
async function newGala(f: OrgFixture, name: string, parties = 2, perParty = 3): Promise<Gala> {
  const e = await executeCommand(
    createEventCommand,
    {
      name,
      profile: 'gala',
      timezone: 'America/Chicago',
      startsAt: '2027-11-20T00:00:00Z',
      endsAt: '2027-11-20T05:00:00Z',
    },
    f.ctx(),
    ports,
  );
  const campaign = await executeCommand(
    createCampaignCommand,
    { eventId: e.id, name: 'Fund-a-need', goalMinor: 10_000_000 },
    f.ctx(),
    ports,
  );
  const level = async (n: string, amountMinor: number) =>
    (
      await executeCommand(
        createLevelCommand,
        { eventId: e.id, campaignId: campaign.id, name: n, amountMinor },
        f.ctx(),
        ports,
      )
    ).id;
  const levels = {
    top: await level('Fund a classroom', 1_000_000),
    mid: await level('Books for a year', 100_000),
    low: await level('A school day', 25_000),
  };
  const partyIds: string[] = [];
  const guestIds: string[] = [];
  await withTenant(systemCtx(f.org.id), async (tx) => {
    for (let p = 0; p < parties; p++) {
      const [party] = await tx.execute<{ id: string }>(
        sql`insert into guests.parties (org_id, event_id, name) values (${f.org.id}, ${e.id}, ${`Party ${p + 1}`}) returning id`,
      );
      partyIds.push(party?.id ?? '');
      for (let g = 0; g < perParty; g++) {
        const [guest] = await tx.execute<{ id: string }>(
          sql`insert into guests.guests (org_id, event_id, party_id, first_name, last_name, is_primary)
              values (${f.org.id}, ${e.id}, ${party?.id}, ${`Guest${p + 1}x${g + 1}`}, 'Donor', ${g === 0}) returning id`,
        );
        guestIds.push(guest?.id ?? '');
      }
    }
  });
  return { id: e.id, campaignId: campaign.id, levels, guests: guestIds, parties: partyIds };
}

const arm = (f: OrgFixture, g: Gala, levelId: string, ctx: Ctx = f.ctx()) =>
  executeCommand(armLevelCommand, { eventId: g.id, campaignId: g.campaignId, levelId }, ctx, ports);

const record = (
  f: OrgFixture,
  eventId: string,
  entries: { clientId?: string; callId: string; paddle: number; recordedAt?: Date }[],
  ctx: Ctx = f.ctx(),
) =>
  executeCommand(
    recordPaddlesCommand,
    {
      eventId,
      entries: entries.map((e) => ({
        clientId: e.clientId ?? uuidv7(),
        callId: e.callId,
        paddle: e.paddle,
        recordedAt: e.recordedAt ?? new Date(),
      })),
    },
    ctx,
    ports,
  );

const outcomes = (r: { results: { outcome: EntryOutcome }[] }) => r.results.map((x) => x.outcome);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('paddle numbers', () => {
  it('gives one guest the next number, refuses a taken number and a second paddle', async () => {
    const g = await newGala(a, 'Paddles One');
    const first = await executeCommand(
      assignPaddleCommand,
      { eventId: g.id, guestId: g.guests[0] },
      a.ctx(),
      ports,
    );
    expect(first.number).toBe(100);
    await expect(
      executeCommand(
        assignPaddleCommand,
        { eventId: g.id, guestId: g.guests[1], number: 100 },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'number_taken' } });
    await expect(
      executeCommand(assignPaddleCommand, { eventId: g.id, guestId: g.guests[0] }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'has_paddle' } });
    // A chosen number, then the next free one follows the highest.
    const chosen = await executeCommand(
      assignPaddleCommand,
      { eventId: g.id, guestId: g.guests[1], number: 7 },
      a.ctx(),
      ports,
    );
    expect(chosen.number).toBe(7);
    const party = await executeCommand(
      assignPaddleCommand,
      { eventId: g.id, partyId: g.parties[1] },
      a.ctx(),
      ports,
    );
    expect(party.number).toBe(101);
    // Neither or both holders: refused by validation; a guest of another event is not found.
    await expect(
      executeCommand(assignPaddleCommand, { eventId: g.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const other = await newGala(a, 'Paddles Other', 1, 1);
    await expect(
      executeCommand(assignPaddleCommand, { eventId: g.id, guestId: other.guests[0] }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    const view = await executeQuery(paddlesQuery, { eventId: g.id }, a.ctx(), ports);
    expect(view.paddles.map((p) => [p.number, p.holderKind, p.holderName, p.partyName])).toEqual([
      [7, 'guest', 'Guest1x2 Donor', 'Party 1'],
      [100, 'guest', 'Guest1x1 Donor', 'Party 1'],
      [101, 'party', 'Party 2', 'Party 2'],
    ]);
    expect(view.guestsWithout.map((x) => x.name)).toEqual([
      'Guest1x3 Donor',
      'Guest2x1 Donor',
      'Guest2x2 Donor',
      'Guest2x3 Donor',
    ]);
    expect(view.partiesWithout.map((x) => x.name)).toEqual(['Party 1']);
    expect(view.nextNumber).toBe(102);
  });

  it('bulk: every guest without a paddle, party by party, from a start number; again gives none', async () => {
    const g = await newGala(a, 'Paddles Bulk', 3, 2);
    await executeCommand(
      assignPaddleCommand,
      { eventId: g.id, guestId: g.guests[2], number: 201 },
      a.ctx(),
      ports,
    );
    const r = await executeCommand(
      bulkAssignPaddlesCommand,
      { eventId: g.id, scope: 'all', per: 'guest', startAt: 200 },
      a.ctx(),
      ports,
    );
    expect(r).toEqual({ assigned: 5, first: 200, last: 205 });
    const view = await executeQuery(paddlesQuery, { eventId: g.id }, a.ctx(), ports);
    expect(view.paddles.map((p) => `${p.number}:${p.holderName}`)).toEqual([
      '200:Guest1x1 Donor',
      '201:Guest2x1 Donor',
      '202:Guest1x2 Donor',
      '203:Guest2x2 Donor',
      '204:Guest3x1 Donor',
      '205:Guest3x2 Donor',
    ]);
    expect(
      await executeCommand(
        bulkAssignPaddlesCommand,
        { eventId: g.id, scope: 'all', per: 'guest' },
        a.ctx(),
        ports,
      ),
    ).toEqual({ assigned: 0, first: null, last: null });
    // Parties get their own paddles after the highest number.
    expect(
      await executeCommand(
        bulkAssignPaddlesCommand,
        { eventId: g.id, scope: 'all', per: 'party' },
        a.ctx(),
        ports,
      ),
    ).toEqual({ assigned: 3, first: 206, last: 208 });
  });

  it('bulk by table: only the parties of purchased tables (M4.2b)', async () => {
    // The fixture event has a purchased table: make the fixture party its table party.
    const [unit] = await q<{ id: string }>(
      a,
      sql`select id from ticketing.table_units where event_id = ${a.event.id} limit 1`,
    );
    const [party] = await q<{ id: string }>(
      a,
      sql`update guests.parties set table_unit_id = ${unit?.id} where event_id = ${a.event.id}
          and id = (select id from guests.parties where event_id = ${a.event.id} and table_unit_id is null order by created_at limit 1)
          returning id`,
    );
    const before = await executeQuery(paddlesQuery, { eventId: a.event.id }, a.ctx(), ports);
    const r = await executeCommand(
      bulkAssignPaddlesCommand,
      { eventId: a.event.id, scope: 'tables', per: 'guest' },
      a.ctx(),
      ports,
    );
    const after = await executeQuery(paddlesQuery, { eventId: a.event.id }, a.ctx(), ports);
    expect(r.assigned).toBeGreaterThan(0);
    expect(after.paddles.length - before.paddles.length).toBe(r.assigned);
    expect(after.tableCount).toBeGreaterThanOrEqual(1);
    // Every new paddle is held by a guest of the table's party.
    const [{ n } = { n: -1 }] = await q<{ n: number }>(
      a,
      sql`select count(*)::int as n from donations.paddles p join guests.guests g on g.id = p.guest_id
          where p.event_id = ${a.event.id} and g.party_id <> ${party?.id} and p.number >= ${r.first}`,
    );
    expect(n).toBe(0);
  });

  it('only guests:write assigns; viewers read; a paddle with entries cannot be released', async () => {
    const g = await newGala(a, 'Paddles Perms', 1, 2);
    const viewer = userCtx(a.viewerId, a.org.id);
    await expect(
      executeCommand(assignPaddleCommand, { eventId: g.id, guestId: g.guests[0] }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const p = await executeCommand(
      assignPaddleCommand,
      { eventId: g.id, guestId: g.guests[0] },
      a.ctx(),
      ports,
    );
    expect((await executeQuery(paddlesQuery, { eventId: g.id }, viewer, ports)).paddles).toHaveLength(1);
    const call = await arm(a, g, g.levels.mid);
    await record(a, g.id, [{ callId: call.id, paddle: p.number }]);
    await expect(
      executeCommand(releasePaddleCommand, { eventId: g.id, paddleId: p.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'has_entries' } });
    const free = await executeCommand(
      assignPaddleCommand,
      { eventId: g.id, guestId: g.guests[1] },
      a.ctx(),
      ports,
    );
    expect(
      await executeCommand(releasePaddleCommand, { eventId: g.id, paddleId: free.id }, a.ctx(), ports),
    ).toEqual({ released: true });
  });
});

describe('the console and spotters', () => {
  it('arms one level at a time, closes it, and spotters see the level and numbers only', async () => {
    const g = await newGala(a, 'Console One');
    await executeCommand(
      bulkAssignPaddlesCommand,
      { eventId: g.id, scope: 'all', per: 'guest' },
      a.ctx(),
      ports,
    );
    expect((await executeQuery(spotterStateQuery, { eventId: g.id }, a.ctx(), ports)).call).toBeNull();
    const call = await arm(a, g, g.levels.top);
    await expect(arm(a, g, g.levels.mid)).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'call_open' },
    });
    const spot = await executeQuery(spotterStateQuery, { eventId: g.id }, a.ctx(), ports);
    expect(spot).toEqual({
      call: { id: call.id, levelName: 'Fund a classroom', amountMinor: 1_000_000, currency: 'USD' },
      paddles: [100, 101, 102, 103, 104, 105],
    });
    await executeCommand(closeCallCommand, { eventId: g.id, callId: call.id }, a.ctx(), ports);
    await expect(
      executeCommand(closeCallCommand, { eventId: g.id, callId: call.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'not_open' } });
    const next = await arm(a, g, g.levels.mid);
    const view = await executeQuery(paddleConsoleQuery, { eventId: g.id }, a.ctx(), ports);
    expect(view.open?.id).toBe(next.id);
    expect(view.calls.map((c) => [c.levelName, c.status])).toEqual([
      ['Books for a year', 'open'],
      ['Fund a classroom', 'closed'],
    ]);
    // Levels largest first, the way an auctioneer calls them.
    expect(view.campaigns[0]?.levels.map((l) => l.amountMinor)).toEqual([1_000_000, 100_000, 25_000]);
    expect(view.paddleCount).toBe(6);

    // The live channels: names never travel to spotters, nor in the console's totals.
    const channel = (def: typeof SPOTTER_CHANNEL | typeof PADDLE_CONSOLE_CHANNEL) =>
      realtimeChannelName(def, a.org.id, g.id);
    const rows = await q<{ channel: string; data: unknown }>(
      a,
      sql`select channel, data from platform.realtime_messages where channel in
          (${channel(SPOTTER_CHANNEL)}, ${channel(PADDLE_CONSOLE_CHANNEL)}) order by seq`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(6);
    const text = JSON.stringify(rows.map((r) => r.data));
    expect(text).not.toMatch(/Guest\dx\d|Donor|Party \d/);
    const lastSpot = rows.filter((r) => r.channel === channel(SPOTTER_CHANNEL)).at(-1)?.data;
    expect(lastSpot).toMatchObject({ call: { id: next.id, levelName: 'Books for a year' } });
  });

  it('records entries: duplicates flagged, unknown paddles and foreign calls refused, replays stored once', async () => {
    const g = await newGala(a, 'Spotters One');
    await executeCommand(
      bulkAssignPaddlesCommand,
      { eventId: g.id, scope: 'all', per: 'guest' },
      a.ctx(),
      ports,
    );
    const other = await newGala(a, 'Spotters Other', 1, 1);
    const otherCall = await arm(a, other, other.levels.low);
    const call = await arm(a, g, g.levels.mid);
    const same = uuidv7();
    const r1 = await record(a, g.id, [
      { clientId: same, callId: call.id, paddle: 100 },
      { callId: call.id, paddle: 101 },
      { callId: call.id, paddle: 100 },
      { callId: call.id, paddle: 999 },
      { callId: otherCall.id, paddle: 102 },
    ]);
    expect(outcomes(r1)).toEqual([
      { status: 'recorded' },
      { status: 'recorded' },
      { status: 'duplicate' },
      { status: 'refused', reason: 'paddle_unknown' },
      { status: 'refused', reason: 'call_unknown' },
    ]);
    // The same entry again (a lost answer): its first answer, no new row.
    const r2 = await record(a, g.id, [{ clientId: same, callId: call.id, paddle: 100 }]);
    expect(outcomes(r2)).toEqual([{ status: 'recorded' }]);
    const review = await executeQuery(paddleReviewQuery, { eventId: g.id }, a.ctx(), ports);
    const entries = review.calls[0]?.entries ?? [];
    expect(entries.map((e) => [e.paddleNumber, e.status, e.holderName])).toEqual([
      [100, 'recorded', 'Guest1x1 Donor'],
      [101, 'recorded', 'Guest1x2 Donor'],
      [100, 'duplicate', 'Guest1x1 Donor'],
    ]);
    expect(entries[2]?.duplicateOf).toBe(entries[0]?.id);
    expect(review.totals).toMatchObject({ count: 2, totalMinor: 200_000, duplicates: 1, toReview: 3 });
    // A late entry for a closed level still counts (a phone that was offline).
    await executeCommand(closeCallCommand, { eventId: g.id, callId: call.id }, a.ctx(), ports);
    const late = await record(a, g.id, [
      { callId: call.id, paddle: 102, recordedAt: new Date(Date.now() - 120_000) },
    ]);
    expect(outcomes(late)).toEqual([{ status: 'recorded' }]);
    // A device clock in the future is stored as the time it arrived.
    const future = await record(a, g.id, [
      { callId: call.id, paddle: 103, recordedAt: new Date(Date.now() + 86_400_000) },
    ]);
    expect(outcomes(future)).toEqual([{ status: 'recorded' }]);
    const [{ late_ok } = { late_ok: false }] = await q<{ late_ok: boolean }>(
      a,
      sql`select bool_and(recorded_at <= now()) as late_ok from donations.paddle_entries where event_id = ${g.id}`,
    );
    expect(late_ok).toBe(true);
  });

  it('undo: voids the newest paddle, withdraws an empty arm, reopens a closed level', async () => {
    const g = await newGala(a, 'Undo One');
    await executeCommand(
      bulkAssignPaddlesCommand,
      { eventId: g.id, scope: 'all', per: 'guest' },
      a.ctx(),
      ports,
    );
    const undo = () => executeCommand(undoPaddleStepCommand, { eventId: g.id }, a.ctx(), ports);
    await expect(undo()).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'nothing_to_undo' },
    });
    const call = await arm(a, g, g.levels.top);
    await record(a, g.id, [
      { callId: call.id, paddle: 100 },
      { callId: call.id, paddle: 101 },
    ]);
    expect(await undo()).toEqual({ undone: 'void_entry', paddleNumber: 101, levelName: 'Fund a classroom' });
    expect(await undo()).toEqual({ undone: 'void_entry', paddleNumber: 100, levelName: 'Fund a classroom' });
    expect(await undo()).toMatchObject({ undone: 'withdraw_call' });
    // A withdrawn level refuses late entries; the console arms again.
    const late = await record(a, g.id, [{ callId: call.id, paddle: 102 }]);
    expect(outcomes(late)).toEqual([{ status: 'refused', reason: 'call_withdrawn' }]);
    const again = await arm(a, g, g.levels.mid);
    await executeCommand(closeCallCommand, { eventId: g.id, callId: again.id }, a.ctx(), ports);
    expect(await undo()).toMatchObject({ undone: 'reopen_call', levelName: 'Books for a year' });
    expect((await executeQuery(spotterStateQuery, { eventId: g.id }, a.ctx(), ports)).call?.id).toBe(
      again.id,
    );
    const view = await executeQuery(paddleConsoleQuery, { eventId: g.id }, a.ctx(), ports);
    expect(view.calls.map((c) => c.levelName)).toEqual(['Books for a year']);
  });
});

describe('the recorder', () => {
  it('confirms recorded paddles into pledges once; a voided pledge is cancelled', async () => {
    const g = await newGala(a, 'Recorder One');
    await executeCommand(
      bulkAssignPaddlesCommand,
      { eventId: g.id, scope: 'all', per: 'guest' },
      a.ctx(),
      ports,
    );
    await executeCommand(assignPaddleCommand, { eventId: g.id, partyId: g.parties[0] }, a.ctx(), ports);
    const call = await arm(a, g, g.levels.mid);
    await record(a, g.id, [
      { callId: call.id, paddle: 100 },
      { callId: call.id, paddle: 101 },
      { callId: call.id, paddle: 101 },
      { callId: call.id, paddle: 106 },
    ]);
    const r = await executeCommand(confirmEntriesCommand, { eventId: g.id, callId: call.id }, a.ctx(), ports);
    // Duplicates wait for the recorder's own decision.
    expect(r).toEqual({ confirmed: 3, skipped: 0 });
    expect(
      await executeCommand(confirmEntriesCommand, { eventId: g.id, callId: call.id }, a.ctx(), ports),
    ).toEqual({ confirmed: 0, skipped: 0 });
    const review = await executeQuery(paddleReviewQuery, { eventId: g.id }, a.ctx(), ports);
    const dup = review.calls[0]?.entries.find((e) => e.status === 'duplicate');
    expect(review.totals).toMatchObject({
      pledgedMinor: 300_000,
      pledgeCount: 3,
      toReview: 1,
      duplicates: 1,
    });
    // The recorder decides the duplicate was a second raise: confirmed on its own.
    expect(
      await executeCommand(
        confirmEntriesCommand,
        { eventId: g.id, entryIds: [dup?.id ?? ''] },
        a.ctx(),
        ports,
      ),
    ).toEqual({ confirmed: 1, skipped: 0 });
    const pledged = await q<{
      paddle_number: number;
      guest_id: string | null;
      party_id: string | null;
      amount_minor: string;
    }>(
      a,
      sql`select paddle_number, guest_id, party_id, amount_minor::text from donations.pledges
          where event_id = ${g.id} order by paddle_number, created_at`,
    );
    expect(pledged.map((p) => [p.paddle_number, p.amount_minor, !!p.guest_id, !!p.party_id])).toEqual([
      [100, '100000', true, false],
      [101, '100000', true, false],
      [101, '100000', true, false],
      [106, '100000', false, true],
    ]);
    // Voiding a confirmed entry cancels its pledge; voiding twice is a no-op.
    const first = review.calls[0]?.entries[0]?.id ?? '';
    expect(await executeCommand(voidEntryCommand, { eventId: g.id, entryId: first }, a.ctx(), ports)).toEqual(
      {
        voided: true,
        pledgeCancelled: true,
      },
    );
    expect(await executeCommand(voidEntryCommand, { eventId: g.id, entryId: first }, a.ctx(), ports)).toEqual(
      {
        voided: false,
        pledgeCancelled: false,
      },
    );
    const totals = (await executeQuery(paddleConsoleQuery, { eventId: g.id }, a.ctx(), ports)).totals;
    expect(totals).toMatchObject({ pledgedMinor: 300_000, pledgeCount: 3, count: 3, totalMinor: 300_000 });
    // Unknown entries are refused whole.
    await expect(
      executeCommand(confirmEntriesCommand, { eventId: g.id, entryIds: [uuidv7()] }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('permissions and isolation', () => {
  it('door staff record paddles on their event but cannot run the console or confirm', async () => {
    // The fixture viewer is door staff on the fixture event (checkin:scan there only).
    const viewer = userCtx(a.viewerId, a.org.id);
    const [{ id: levelId } = { id: '' }] = await q<{ id: string }>(
      a,
      sql`select l.id from donations.levels l join donations.campaigns c on c.id = l.campaign_id
          where c.event_id = ${a.event.id} limit 1`,
    );
    const [{ id: campaignId } = { id: '' }] = await q<{ id: string }>(
      a,
      sql`select campaign_id as id from donations.levels where id = ${levelId}`,
    );
    await expect(
      executeCommand(armLevelCommand, { eventId: a.event.id, campaignId, levelId }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const call = await executeCommand(
      armLevelCommand,
      { eventId: a.event.id, campaignId, levelId },
      a.ctx(),
      ports,
    );
    const [paddle] = await q<{ number: number }>(
      a,
      sql`select number from donations.paddles where event_id = ${a.event.id} order by number limit 1`,
    );
    const r = await record(a, a.event.id, [{ callId: call.id, paddle: paddle?.number ?? 0 }], viewer);
    expect(outcomes(r)[0]?.status).toMatch(/recorded|duplicate/);
    expect((await executeQuery(spotterStateQuery, { eventId: a.event.id }, viewer, ports)).call?.id).toBe(
      call.id,
    );
    await expect(
      executeCommand(confirmEntriesCommand, { eventId: a.event.id, callId: call.id }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(undoPaddleStepCommand, { eventId: a.event.id }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await executeCommand(closeCallCommand, { eventId: a.event.id, callId: call.id }, a.ctx(), ports);
    // Not door staff on another event: refused there.
    const g = await newGala(a, 'Perms Other', 1, 1);
    await executeCommand(
      bulkAssignPaddlesCommand,
      { eventId: g.id, scope: 'all', per: 'guest' },
      a.ctx(),
      ports,
    );
    const other = await arm(a, g, g.levels.low);
    await expect(record(a, g.id, [{ callId: other.id, paddle: 100 }], viewer)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it("another org sees none of it, and can't record against this org's levels", async () => {
    const g = await newGala(a, 'Isolation One', 1, 2);
    await executeCommand(
      bulkAssignPaddlesCommand,
      { eventId: g.id, scope: 'all', per: 'guest' },
      a.ctx(),
      ports,
    );
    const call = await arm(a, g, g.levels.low);
    const id = uuidv7();
    await record(a, g.id, [{ clientId: id, callId: call.id, paddle: 100 }]);
    const refused = { code: 'not_found' };
    await expect(executeQuery(paddlesQuery, { eventId: g.id }, b.ctx(), ports)).rejects.toMatchObject(
      refused,
    );
    await expect(executeQuery(paddleConsoleQuery, { eventId: g.id }, b.ctx(), ports)).rejects.toMatchObject(
      refused,
    );
    await expect(executeQuery(paddleReviewQuery, { eventId: g.id }, b.ctx(), ports)).rejects.toMatchObject(
      refused,
    );
    await expect(executeQuery(spotterStateQuery, { eventId: g.id }, b.ctx(), ports)).rejects.toMatchObject(
      refused,
    );
    // B's own event, A's call id and A's entry id: refused, nothing revealed or stored.
    const r = await record(b, b.event.id, [
      { clientId: id, callId: call.id, paddle: 100 },
      { callId: call.id, paddle: 100 },
    ]);
    expect(outcomes(r)).toEqual([
      { status: 'refused', reason: 'call_unknown' },
      { status: 'refused', reason: 'call_unknown' },
    ]);
    const [{ n } = { n: -1 }] = await q<{ n: number }>(
      b,
      sql`select count(*)::int as n from donations.paddle_entries where call_id = ${call.id}`,
    );
    expect(n).toBe(0);
  });
});

describe('acceptance: 30 spotters, 400 paddles, half offline for 2 minutes', () => {
  it('syncs with no loss and no duplicates, through lost answers and replays', async () => {
    const g = await newGala(a, 'Acceptance Gala', 40, 10);
    const assigned = await executeCommand(
      bulkAssignPaddlesCommand,
      { eventId: g.id, scope: 'all', per: 'guest', startAt: 100 },
      a.ctx(),
      ports,
    );
    expect(assigned).toEqual({ assigned: 400, first: 100, last: 499 });
    const call = await arm(a, g, g.levels.low);
    const t0 = Date.now();
    // Each paddle is raised once; spotters split the room (paddle % 30).
    const spotters: SpotterQueue[] = Array.from({ length: 30 }, () => emptyQueue());
    for (let paddle = 100; paddle < 500; paddle++) {
      const s = paddle % 30;
      const entry: QueuedEntry = {
        clientId: crypto.randomUUID(),
        callId: call.id,
        paddle,
        recordedAt: new Date(t0 + (paddle - 100) * 50).toISOString(),
      };
      spotters[s] = enqueue(spotters[s] as SpotterQueue, entry);
    }
    let sent = 0;
    // One phone syncing: batches of 7; the answer to every third request is lost (sent again).
    const sync = async (i: number) => {
      let queue = spotters[i] as SpotterQueue;
      while (queue.pending.length > 0) {
        const batch = nextBatch(queue, 7);
        const r = await record(
          a,
          g.id,
          batch.map((e) => ({ ...e, recordedAt: new Date(e.recordedAt) })),
        );
        if (++sent % 3 === 0) continue;
        queue = settle(queue, r.results);
      }
      spotters[i] = queue;
    };
    const online = [...spotters.keys()].filter((i) => i % 2 === 0);
    const offline = [...spotters.keys()].filter((i) => i % 2 === 1);
    // The online half syncs at once, all phones in parallel; the auctioneer closes the level.
    await Promise.all(online.map(sync));
    await executeCommand(closeCallCommand, { eventId: g.id, callId: call.id }, a.ctx(), ports);
    // Two minutes later the offline half reconnects, in parallel, each phone sending its first
    // batch twice at the same moment (a retry racing the original).
    await Promise.all(
      offline.map(async (i) => {
        const first = nextBatch(spotters[i] as SpotterQueue, 7).map((e) => ({
          ...e,
          recordedAt: new Date(e.recordedAt),
        }));
        await Promise.all([record(a, g.id, first), record(a, g.id, first)]);
        await sync(i);
      }),
    );
    expect(spotters.every((s) => s.pending.length === 0)).toBe(true);
    const [row] = await q<{ n: number; paddles: number; recorded: number; clients: number }>(
      a,
      sql`select count(*)::int as n, count(distinct paddle_number)::int as paddles,
          count(*) filter (where status = 'recorded')::int as recorded,
          count(distinct client_id)::int as clients
          from donations.paddle_entries where event_id = ${g.id}`,
    );
    expect(row).toEqual({ n: 400, paddles: 400, recorded: 400, clients: 400 });
    const view = await executeQuery(paddleConsoleQuery, { eventId: g.id }, a.ctx(), ports);
    expect(view.calls[0]).toMatchObject({ count: 400, totalMinor: 400 * 25_000, duplicates: 0 });
    // Every phone's answers say recorded: nothing was refused or flagged.
    expect(spotters.flatMap((s) => s.settled).filter((e) => e.outcome.status !== 'recorded')).toEqual([]);
  });
});
