import {
  attendeeImportBulk,
  guessMapping,
  importFailuresQuery,
  importSummaryQuery,
  listAttendeesQuery,
  stageImportCommand,
  validateImportCommand,
} from '@yayatoh/attendees';
import { parseCsv } from '@yayatoh/csv';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { startCheckoutCommand } from '@yayatoh/orders';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, runBulk, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const e = await executeCommand(
    createEventCommand,
    { name: 'Imports', timezone: 'UTC', startsAt: '2027-12-01T18:00:00Z', endsAt: '2027-12-01T23:00:00Z' },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  const t = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'Free', priceMinor: 0, quantityTotal: 10 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  // Already on the list through a ticket.
  await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId: t.id, quantity: 1 }],
      buyer: { email: 'Taken@Example.test', name: 'Taken' },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
});
afterAll(closePools);

const stage = (csv: string, f = a, ev = eventId) =>
  executeCommand(stageImportCommand, { eventId: ev, fileName: 'guests.csv', csv }, f.ctx(), ports);
const summary = (batchId: string) => executeQuery(importSummaryQuery, { eventId, batchId }, a.ctx(), ports);

describe('guest-list import (M1.8c)', () => {
  it('guesses the mapping from headers in several languages', () => {
    expect(guessMapping(['Full Name', 'E-mail', 'Tags'])).toEqual({ name: 0, email: 1, labels: 2 });
    expect(guessMapping(['Courriel', 'Nom'])).toEqual({ email: 0, name: 1 });
    expect(guessMapping(['x', 'y'])).toEqual({});
  });

  it('stages, validates with a reason per bad row, previews, and imports only the good rows', async () => {
    const csv = [
      'Full Name;E-mail;Tags',
      'Ada Lovelace;ada@example.test;VIP, Table 1',
      'Bad Address;not-an-email;',
      'No Mail;;',
      'Ada Again;ADA@example.test;',
      'Taken Guest;taken@example.test;',
      `Long Label;long@example.test;${'x'.repeat(41)}`,
      ';anon@example.test;',
    ].join('\n');
    const s = await stage(csv);
    expect(s).toMatchObject({ rowCount: 7, headers: ['Full Name', 'E-mail', 'Tags'] });
    expect((await summary(s.batchId)).mapping).toEqual({ name: 0, email: 1, labels: 2 });

    const v = await executeCommand(
      validateImportCommand,
      { eventId, batchId: s.batchId, mapping: { name: 0, email: 1, labels: 2 }, extraLabels: ['Imported'] },
      a.ctx(),
      ports,
    );
    expect(v).toEqual({ valid: 2, invalid: 5 });
    const sum = await summary(s.batchId);
    expect(sum.invalidByCode).toEqual({
      invalid_email: 1,
      missing_email: 1,
      duplicate_in_file: 1,
      already_on_list: 1,
      invalid_label: 1,
    });
    expect(sum.preview[0]).toMatchObject({
      rowNo: 1,
      name: 'Ada Lovelace',
      labels: ['VIP', 'Table 1', 'Imported'],
    });
    // A nameless row falls back to the email's local part.
    expect(sum.preview.find((p) => p.rowNo === 7)?.name).toBe('anon');

    const op = await executeCommand(
      attendeeImportBulk.start,
      { eventId, selection: { filter: { batchId: s.batchId } }, params: {} },
      a.ctx(),
      ports,
    );
    expect(op.total).toBe(2);
    expect(await runBulk(a.org.id, op.operationId)).toBe('done');
    const list = await executeQuery(listAttendeesQuery, { eventId, source: 'import' }, a.ctx(), ports);
    expect(list.items.map((x) => x.email).sort()).toEqual(['ada@example.test', 'anon@example.test']);
    expect((await summary(s.batchId)).imported).toBe(2);

    // The failure report: the organizer's columns plus the reason, bad rows only.
    const report = await executeQuery(
      importFailuresQuery,
      {
        eventId,
        batchId: s.batchId,
        reasonHeader: 'Problem',
        reasons: { invalid_email: 'Email address looks wrong' },
      },
      a.ctx(),
      ports,
    );
    expect(report.fileName).toBe('guests-not-imported.csv');
    const parsed = parseCsv(report.csv);
    expect(parsed.headers).toEqual(['Full Name', 'E-mail', 'Tags', 'Problem']);
    expect(parsed.rows).toHaveLength(5);
    expect(parsed.rows[0]).toEqual(['Bad Address', 'not-an-email', '', 'Email address looks wrong']);

    // Imported files can't be re-mapped; undo removes exactly the imported guests.
    await expect(
      executeCommand(
        validateImportCommand,
        { eventId, batchId: s.batchId, mapping: { email: 1 } },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    await executeCommand(attendeeImportBulk.undo, { operationId: op.operationId }, a.ctx(), ports);
    expect(await runBulk(a.org.id, op.operationId)).toBe('undone');
    expect(
      (await executeQuery(listAttendeesQuery, { eventId, source: 'import' }, a.ctx(), ports)).total,
    ).toBe(0);
    expect((await summary(s.batchId)).imported).toBe(0);
  });

  it('acceptance: 5,000 rows import in under 60 s with at least 97% accepted', async () => {
    const lines = ['Name,Email,Group'];
    for (let i = 0; i < 5000; i++)
      lines.push(
        i % 50 === 7
          ? `Broken ${i},broken-${i}-at-example.test,`
          : `Guest ${i},guest${i}@bulk.example.test,Wave ${i % 5}`,
      );
    const started = Date.now();
    const s = await stage(lines.join('\r\n'));
    const v = await executeCommand(
      validateImportCommand,
      { eventId, batchId: s.batchId, mapping: { name: 0, email: 1, labels: 2 } },
      a.ctx(),
      ports,
    );
    const op = await executeCommand(
      attendeeImportBulk.start,
      { eventId, selection: { filter: { batchId: s.batchId } }, params: {} },
      a.ctx(),
      ports,
    );
    expect(await runBulk(a.org.id, op.operationId, 60_000)).toBe('done');
    const elapsed = Date.now() - started;
    const st = await executeQuery(attendeeImportBulk.status, { operationId: op.operationId }, a.ctx(), ports);
    expect(v).toEqual({ valid: 4900, invalid: 100 });
    expect(st.succeeded / 5000).toBeGreaterThanOrEqual(0.97);
    expect(st).toMatchObject({ succeeded: 4900, failed: 0 });
    expect(elapsed).toBeLessThan(60_000);
    const [n] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number; contacts: number }>(sql`
        select count(*)::int as n, count(distinct contact_id)::int as contacts
        from attendees.attendees where event_id = ${eventId} and email like '%@bulk.example.test'`),
    );
    expect(n).toEqual({ n: 4900, contacts: 4900 });
  });

  it('refuses unreadable files and viewers', async () => {
    await expect(stage('a,b\n"unterminated')).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'unterminated_quote' },
    });
    await expect(stage('Name,Email\n')).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        stageImportCommand,
        { eventId, fileName: 'x.csv', csv: 'Email\nx@example.test' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const s = await stage('Email\nlate@example.test');
    // Starting before the mapping is checked is refused.
    await expect(
      executeCommand(
        attendeeImportBulk.start,
        { eventId, selection: { filter: { batchId: s.batchId } }, params: {} },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('isolation: org B cannot read, validate or import org A files', async () => {
    const s = await stage('Email\nsecret@example.test');
    await expect(
      executeQuery(importSummaryQuery, { eventId, batchId: s.batchId }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(
        attendeeImportBulk.start,
        { eventId: b.event.id, selection: { filter: { batchId: s.batchId } }, params: {} },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    // And org B can't stage into org A's event (the composite FK refuses a foreign event).
    await expect(stage('Email\nx@example.test', b, eventId)).rejects.toBeTruthy();
  });
});
