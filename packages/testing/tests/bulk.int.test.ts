import {
  attendeeLabelBulk,
  createAttendeesTx,
  listAttendeesQuery,
  setAttendeeLabelsCommand,
} from '@yayatoh/attendees';
import { scanTicketCommand } from '@yayatoh/checkin';
import { upsertContactTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { orderByManageToken, startCheckoutCommand } from '@yayatoh/orders';
import { listBulkOperationsQuery } from '@yayatoh/platform';
import { attendeeExportBulk, csvCell } from '@yayatoh/reports';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXPORT_PARAMS, type OrgFixture, ports, runBulk, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let bigEventId: string;

const DURING = new Date('2027-12-01T20:00:00Z');

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const mk = async (name: string) => {
    const e = await executeCommand(
      createEventCommand,
      { name, timezone: 'America/Chicago', startsAt: '2027-12-01T15:00:00Z', endsAt: '2027-12-02T04:00:00Z' },
      a.ctx(),
      ports,
    );
    return e.id;
  };
  eventId = await mk('Bulk');
  bigEventId = await mk('Bulk big');
  const t = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'GA', priceMinor: 0, quantityTotal: 50, maxPerOrder: 10 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  for (const [name, email, qty] of [
    ['Ada Lovelace', 'ada@example.test', 2],
    ['=HYPERLINK("http://evil")', 'evil@example.test', 1],
    ['Grace, "Amazing" Hopper', 'grace@example.test', 1],
  ] as const) {
    const r = await executeCommand(
      startCheckoutCommand,
      { eventId, items: [{ ticketTypeId: t.id, quantity: qty }], buyer: { email, name } },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    if (name === 'Ada Lovelace') {
      const code = (await orderByManageToken(r.manageToken))?.tickets[0]?.shortCode ?? '';
      await executeCommand(scanTicketCommand, { eventId, code }, a.ctx({ now: DURING }), ports);
    }
  }
  // 2,000 attendees for the volume test (one shared contact keeps the setup quick).
  await withTenant(systemCtx(a.org.id), async (tx) => {
    const ctx = systemCtx(a.org.id);
    const c = await upsertContactTx(tx, ctx, {
      email: 'crowd@example.test',
      name: 'Crowd',
      source: 'import',
    });
    await createAttendeesTx(
      tx,
      ctx,
      Array.from({ length: 2000 }, (_, i) => ({
        eventId: bigEventId,
        contactId: c.id,
        source: 'import' as const,
        name: `Guest ${i}`,
        email: `guest${i}@example.test`,
      })),
    );
  });
});
afterAll(closePools);

const labelsOf = async (ev = eventId) =>
  (await executeQuery(listAttendeesQuery, { eventId: ev, limit: 500 }, a.ctx(), ports)).items;

describe('bulk actions (M1.8b)', () => {
  it('labels a selection by ids, reports partial failures by item, and undoes within the window', async () => {
    const all = await labelsOf();
    const [first, second] = all;
    // One attendee already has 20 labels: adding another must fail for that one only.
    await executeCommand(
      setAttendeeLabelsCommand,
      { eventId, attendeeIds: [second?.id as string], add: Array.from({ length: 20 }, (_, i) => `L${i}`) },
      a.ctx(),
      ports,
    );
    const op = await executeCommand(
      attendeeLabelBulk.start,
      { eventId, selection: { ids: all.map((x) => x.id) }, params: { add: ['VIP'] } },
      a.ctx(),
      ports,
    );
    expect(op.total).toBe(4);
    expect(await runBulk(a.org.id, op.operationId)).toBe('done');
    const st = await executeQuery(attendeeLabelBulk.status, { operationId: op.operationId }, a.ctx(), ports);
    expect(st).toMatchObject({ status: 'done', total: 4, processed: 4, succeeded: 3, failed: 1 });
    expect(st.failures).toEqual([{ itemId: second?.id, code: 'too_many_labels' }]);
    expect(st.undoUntil).not.toBeNull();
    expect((await labelsOf()).find((x) => x.id === first?.id)?.labels).toEqual(['VIP']);

    await executeCommand(attendeeLabelBulk.undo, { operationId: op.operationId }, a.ctx(), ports);
    expect(await runBulk(a.org.id, op.operationId)).toBe('undone');
    const after = await labelsOf();
    expect(after.find((x) => x.id === first?.id)?.labels).toEqual([]);
    expect(after.find((x) => x.id === second?.id)?.labels).toHaveLength(20);
    // Undo is one-shot.
    await expect(
      executeCommand(attendeeLabelBulk.undo, { operationId: op.operationId }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    await executeCommand(
      setAttendeeLabelsCommand,
      { eventId, attendeeIds: [second?.id as string], remove: Array.from({ length: 20 }, (_, i) => `L${i}`) },
      a.ctx(),
      ports,
    );
  });

  it('the undo window closes', async () => {
    const op = await executeCommand(
      attendeeLabelBulk.start,
      { eventId, selection: { filter: {} }, params: { add: ['Late'] } },
      a.ctx(),
      ports,
    );
    await runBulk(a.org.id, op.operationId);
    await expect(
      executeCommand(
        attendeeLabelBulk.undo,
        { operationId: op.operationId },
        a.ctx({ now: new Date(Date.now() + 11 * 60_000) }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    await executeCommand(
      setAttendeeLabelsCommand,
      { eventId, attendeeIds: (await labelsOf()).map((x) => x.id), remove: ['Late'] },
      a.ctx(),
      ports,
    );
  });

  it('2,000 attendees by filter: chunked progress, then undo restores every one', async () => {
    const started = Date.now();
    const op = await executeCommand(
      attendeeLabelBulk.start,
      { eventId: bigEventId, selection: { filter: { search: 'guest' } }, params: { add: ['Table 1'] } },
      a.ctx(),
      ports,
    );
    expect(op.total).toBe(2000);
    // A tiny budget stops after the first chunk: progress is visible between chunks.
    await runBulk(a.org.id, op.operationId, 0);
    const mid = await executeQuery(attendeeLabelBulk.status, { operationId: op.operationId }, a.ctx(), ports);
    expect(mid).toMatchObject({ status: 'running', processed: 500 });
    expect(await runBulk(a.org.id, op.operationId)).toBe('done');
    expect((await labelsOf(bigEventId)).every((x) => x.labels.includes('Table 1'))).toBe(true);
    await executeCommand(attendeeLabelBulk.undo, { operationId: op.operationId }, a.ctx(), ports);
    expect(await runBulk(a.org.id, op.operationId)).toBe('undone');
    const [n] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from attendees.attendees where event_id = ${bigEventId} and cardinality(labels) > 0`,
      ),
    );
    expect(n?.n).toBe(0);
    expect(Date.now() - started).toBeLessThan(20_000);
  });

  it('exports CSV with localized headers, event-time stamps, check-in state and formula protection', async () => {
    const op = await executeCommand(
      attendeeExportBulk.start,
      { eventId, selection: { filter: {} }, params: EXPORT_PARAMS },
      a.ctx(),
      ports,
    );
    expect(await runBulk(a.org.id, op.operationId)).toBe('done');
    const f = await executeQuery(attendeeExportBulk.file, { operationId: op.operationId }, a.ctx(), ports);
    expect(f.name).toMatch(/^attendees-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(f.contentType).toBe('text/csv; charset=utf-8');
    const lines = f.content.replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'Name,Email,Ticket type,Ticket code,No.,Source,Status,Labels,Registered,Checked in',
    );
    expect(lines).toHaveLength(5);
    expect(lines.filter((l) => l.startsWith('Ada Lovelace,')).map((l) => l.split(',').at(-1))).toEqual(
      expect.arrayContaining(['Yes', 'No']),
    );
    expect(f.content).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(f.content).toContain('"Grace, ""Amazing"" Hopper"');
    expect(f.content).not.toContain('contact');
    expect(lines[1]).toMatch(/,\d{4}-\d{2}-\d{2} \d{2}:\d{2},(Yes|No)$/);
  });

  it('csvCell neutralises formulas and quotes separators', () => {
    expect(csvCell('+1 555')).toBe("'+1 555");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell(12)).toBe('12');
    expect(csvCell(null)).toBe('');
  });

  it('permissions: viewers cannot label or export; only the system runner runs steps', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    await expect(
      executeCommand(
        attendeeLabelBulk.start,
        { eventId, selection: { filter: {} }, params: { add: ['X'] } },
        viewer,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        attendeeExportBulk.start,
        { eventId, selection: { filter: {} }, params: EXPORT_PARAMS },
        viewer,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Nobody can run a step as a user: only the system runner.
    const { bulkStep } = await import('../src/index.ts');
    const [op] = await executeQuery(listBulkOperationsQuery, { eventId }, a.ctx(), ports);
    await expect(
      executeCommand(bulkStep, { operationId: op?.id as string }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('selections are checked: foreign ids and empty selections are refused', async () => {
    const [other] = (
      await executeQuery(listAttendeesQuery, { eventId: bigEventId, limit: 1 }, a.ctx(), ports)
    ).items;
    await expect(
      executeCommand(
        attendeeLabelBulk.start,
        { eventId, selection: { ids: [other?.id as string] }, params: { add: ['X'] } },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(
        attendeeLabelBulk.start,
        { eventId, selection: { filter: { search: 'nobody-matches-this' } }, params: { add: ['X'] } },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('isolation: org B can neither see, undo nor download org A operations', async () => {
    const [op] = await executeQuery(listBulkOperationsQuery, { eventId }, a.ctx(), ports);
    const exp = (await executeQuery(listBulkOperationsQuery, { eventId, limit: 50 }, a.ctx(), ports)).find(
      (o) => o.hasFile,
    );
    expect(await executeQuery(listBulkOperationsQuery, { eventId }, b.ctx(), ports)).toEqual([]);
    await expect(
      executeQuery(attendeeLabelBulk.status, { operationId: op?.id as string }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeQuery(attendeeExportBulk.file, { operationId: exp?.id as string }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(runBulk(b.org.id, op?.id as string)).resolves.toBe('failed');
  });
});
