import { readFileSync } from 'node:fs';
import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, type EventDto, grantTeamRoleTx, inviteTeamMemberCommand } from '@yayatoh/events';
import {
  createPartyCommand,
  GUEST_IMPORT_REJECTIONS,
  type GuestTableInput,
  guestImportAction,
  guestImportBulk,
  guestImportRejectedQuery,
  guestImportSummaryQuery,
  guestListQuery,
  partyHistoryQuery,
  purgeGuestImportsCommand,
  readGuestTable,
  stageGuestImportCommand,
  validateGuestImportCommand,
} from '@yayatoh/guests';
import { fetchGoogleSheetCsv } from '@yayatoh/guests/sheet';
import { type Ctx, createCtx, DomainError, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import type { Resolver, Transport, TransportRequest } from '@yayatoh/platform/ssrf';
import { acceptInvitation, signInvitation } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, runBulk, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M4.1b: guest-list import. The same list as pasted text, a Windows-1252 CSV, an XLSX workbook
 * and a Google Sheet (through a fake network) imports the same parties and guests.
 */

const dir = new URL('../fixtures/guest-import/', import.meta.url);
const file = (name: string) => new Uint8Array(readFileSync(new URL(name, dir)));
const SHEET_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`;

let admin: AdminSql;
let a: OrgFixture;
let b: OrgFixture;

const publicResolver: Resolver = async () => [{ address: '142.250.1.1', family: 4 }];

/** Google's export: a redirect to the content host, then the CSV. */
function googleTransport(body: Uint8Array, seen: TransportRequest[] = []): Transport {
  return async (req) => {
    seen.push(req);
    if (req.url.hostname === 'docs.google.com')
      return {
        status: 307,
        headers: {
          location: `https://doc-0s-3c-sheets.googleusercontent.com/export/abc/${SHEET_ID}?format=csv`,
        },
        body: new Uint8Array(),
      };
    return { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' }, body };
  };
}

const wedding = (f: OrgFixture, name: string) =>
  executeCommand(
    createEventCommand,
    {
      name,
      profile: 'wedding',
      timezone: 'America/Chicago',
      startsAt: '2030-06-01T20:00:00Z',
      endsAt: '2030-06-02T04:00:00Z',
    },
    f.ctx(),
    ports,
  );

async function stage(ev: EventDto, input: GuestTableInput, ctx: Ctx = a.ctx(), fileName = '') {
  const t = readGuestTable(input);
  return executeCommand(
    stageGuestImportCommand,
    {
      eventId: ev.id,
      source: input.source,
      fileName,
      sheet: t.sheet,
      sheets: [...t.sheets],
      headers: [...t.headers],
      rows: t.rows.map((r) => [...r]),
    },
    ctx,
    ports,
  );
}

const summary = (ev: EventDto, batchId: string, ctx: Ctx = a.ctx()) =>
  executeQuery(guestImportSummaryQuery, { eventId: ev.id, batchId }, ctx, ports);

async function validate(ev: EventDto, batchId: string, ctx: Ctx = a.ctx()) {
  const s = await summary(ev, batchId, ctx);
  return executeCommand(
    validateGuestImportCommand,
    { eventId: ev.id, batchId, mapping: s.mapping },
    ctx,
    ports,
  );
}

async function runImport(ev: EventDto, batchId: string, ctx: Ctx = a.ctx(), org = a) {
  const op = await executeCommand(
    guestImportBulk.start,
    { eventId: ev.id, selection: { filter: { batchId } }, params: {} },
    ctx,
    ports,
  );
  await runBulk(org.org.id, op.operationId);
  return op;
}

/** The whole list as plain data (ids and times left out), to compare imports. */
async function listOf(ev: EventDto, ctx: Ctx = a.ctx()) {
  const l = await executeQuery(guestListQuery, { eventId: ev.id, limit: 200 }, ctx, ports);
  return {
    counts: l.counts,
    parties: l.parties.map((p) => ({
      name: p.name,
      side: p.side,
      vip: p.vip,
      tags: p.tags,
      source: p.source,
      guests: p.guests.map((g) => ({
        kind: g.kind,
        firstName: g.firstName,
        lastName: g.lastName,
        ageClass: g.ageClass,
        meal: g.meal,
        dietary: g.dietary,
        accessibility: g.accessibility,
        address: g.address,
        email: g.email,
        phone: g.phone,
        isPrimary: g.isPrimary,
        guestOf: g.hostGuestId ? p.guests.find((h) => h.id === g.hostGuestId)?.firstName : null,
      })),
    })),
  };
}

beforeAll(async () => {
  admin = adminClient();
  ({ a, b } = await twoOrgs());
});

afterAll(async () => {
  await closePools();
  await admin.end();
});

describe('guest import (M4.1b)', () => {
  it('paste, CSV, XLSX and a Google Sheet import the same parties and guests', async () => {
    const seen: TransportRequest[] = [];
    const sheetBytes = await fetchGoogleSheetCsv(SHEET_URL, {
      transport: googleTransport(file('sheet-export.csv'), seen),
      resolver: publicResolver,
    });
    // One read of the export, redirect followed on Google's content host only.
    expect(seen.map((r) => r.url.hostname)).toEqual([
      'docs.google.com',
      'doc-0s-3c-sheets.googleusercontent.com',
    ]);
    expect(seen[0]?.url.pathname).toBe(`/spreadsheets/d/${SHEET_ID}/export`);
    const inputs: [string, GuestTableInput][] = [
      ['paste', { source: 'paste', text: new TextDecoder().decode(file('guests.txt')) }],
      ['csv', { source: 'csv', bytes: file('guests.csv') }],
      ['xlsx', { source: 'xlsx', bytes: file('guests.xlsx') }],
      ['sheet', { source: 'sheet', bytes: sheetBytes }],
    ];
    const lists = [];
    for (const [name, input] of inputs) {
      const ev = await wedding(a, `Import ${name} ${a.org.slug}`);
      const staged = await stage(ev, input);
      expect(staged.rowCount).toBe(6);
      const s = await summary(ev, staged.batchId);
      expect(s).toMatchObject({ source: name, status: 'staged', rowCount: 6 });
      expect(s.mapping).toEqual({
        party: 0,
        firstName: 1,
        lastName: 2,
        ageClass: 3,
        meal: 4,
        side: 5,
        vip: 6,
        tags: 7,
        email: 8,
        phone: 9,
        dietary: 10,
        accessibility: 11,
        address: 12,
        plusOne: 13,
      });
      if (name === 'xlsx') expect(s).toMatchObject({ sheet: 'Guests', sheets: ['Guests', 'Old list'] });
      // Nothing is imported until the host confirms.
      expect((await listOf(ev)).counts.parties).toBe(0);
      expect(await validate(ev, staged.batchId)).toEqual({ parties: 3, guests: 7, rejected: 1 });
      expect((await listOf(ev)).counts.parties).toBe(0);
      await runImport(ev, staged.batchId);
      lists.push(await listOf(ev));
      expect(await summary(ev, staged.batchId)).toMatchObject({
        status: 'imported',
        partiesImported: 3,
        guestsImported: 7,
        rejected: 1,
      });
    }
    const [first, ...rest] = lists;
    for (const l of rest) expect(l).toEqual(first);
    expect(first?.counts).toMatchObject({
      parties: 3,
      guests: 7,
      adults: 6,
      children: 1,
      plusOnesPending: 2,
    });
    expect(first?.parties.map((p) => [p.name, p.side, p.vip, p.tags, p.source])).toEqual([
      ['Ana Kim', 'Groom', false, ['Work'], 'import'],
      ['Okafor family', 'Groom', false, [], 'import'],
      ['The Garcias', 'Bride', true, ['Family', 'Out of town'], 'import'],
    ]);
    const garcias = first?.parties.find((p) => p.name === 'The Garcias');
    expect(garcias?.guests).toEqual([
      {
        kind: 'guest',
        firstName: 'Luis',
        lastName: 'Garcia',
        ageClass: 'adult',
        meal: 'Beef',
        dietary: 'No nuts',
        accessibility: null,
        address: '1 Main St, Springfield',
        email: 'luis@example.test',
        phone: '+1 555 010 2000',
        isPrimary: true,
        guestOf: null,
      },
      expect.objectContaining({ kind: 'plus_one', firstName: null, guestOf: 'Luis', isPrimary: false }),
      expect.objectContaining({ kind: 'guest', firstName: 'Sofía', lastName: 'García', ageClass: 'child' }),
    ]);
    expect(first?.parties.find((p) => p.name === 'Ana Kim')?.guests).toEqual([
      expect.objectContaining({ firstName: 'Ana', accessibility: 'Step-free seat', isPrimary: true }),
      expect.objectContaining({ kind: 'plus_one', firstName: 'Jamie', lastName: 'Lee', guestOf: 'Ana' }),
    ]);
    expect(first?.parties.find((p) => p.name === 'Okafor family')?.guests).toEqual([
      expect.objectContaining({ firstName: 'Chidi', dietary: 'Vegan' }),
      expect.objectContaining({ kind: 'plus_one', firstName: null, guestOf: 'Chidi' }),
    ]);
  });

  it('rejected rows: reasons per row, a formula-safe download in the host’s words; a chosen sheet', async () => {
    const ev = await wedding(a, `Rejected ${a.org.slug}`);
    const staged = await stage(ev, { source: 'xlsx', bytes: file('guests.xlsx') }, a.ctx(), 'guests.xlsx');
    await validate(ev, staged.batchId);
    const s = await summary(ev, staged.batchId);
    expect(s.rejectedByCode).toEqual({ invalid_age: 1 });
    expect(s.rejectedRows).toEqual([{ rowNo: 6, name: '=1+2 Row', code: 'invalid_age' }]);
    expect(s.preview.map((p) => [p.name, p.guests.map((g) => g.firstName ?? `+1 of ${g.guestOf}`)])).toEqual([
      ['The Garcias', ['Luis', '+1 of Luis Garcia', 'Sofía']],
      ['Ana Kim', ['Ana', 'Jamie']],
      ['Okafor family', ['Chidi', '+1 of Chidi Okafor']],
    ]);
    const reasons = Object.fromEntries(GUEST_IMPORT_REJECTIONS.map((c) => [c, `Reason ${c}`]));
    const out = await executeQuery(
      guestImportRejectedQuery,
      { eventId: ev.id, batchId: staged.batchId, reasonHeader: 'Problem', reasons },
      a.ctx(),
      ports,
    );
    expect(out.fileName).toBe('guests-not-imported.csv');
    const lines = out.csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe(
      'Household,First name,Last name,Age,Meal,Side,VIP,Tags,Email,Phone,Dietary,Accessibility,Address,Plus one,Problem',
    );
    expect(lines.slice(1)).toEqual([",'=1+2,Row,teenager,,,,,,,,,,,Reason invalid_age"]);

    // The other sheet of the workbook, chosen by name.
    const other = await stage(ev, { source: 'xlsx', bytes: file('guests.xlsx'), sheet: 'Old list' });
    expect(await summary(ev, other.batchId)).toMatchObject({
      sheet: 'Old list',
      headers: ['Name'],
      rowCount: 1,
    });
  });

  it('checks the mapping and reads only what it can', async () => {
    const ev = await wedding(a, `Mapping ${a.org.slug}`);
    const staged = await stage(ev, { source: 'paste', text: 'Name,Notes\nAl Bo,hi' });
    const v = (mapping: Record<string, number>) =>
      executeCommand(
        validateGuestImportCommand,
        { eventId: ev.id, batchId: staged.batchId, mapping },
        a.ctx(),
        ports,
      );
    await expect(v({ lastName: 0 })).rejects.toMatchObject({ details: { reason: 'name_required' } });
    await expect(v({ fullName: 0, tags: 0 })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(v({ fullName: 7 })).rejects.toMatchObject({ details: { reason: 'unknown_column' } });
    await expect(v({ fullName: 1 })).resolves.toEqual({ parties: 1, guests: 1, rejected: 0 });
    // Running the check again with another mapping replaces the plan.
    await expect(v({ fullName: 0 })).resolves.toEqual({ parties: 1, guests: 1, rejected: 0 });
    expect((await summary(ev, staged.batchId)).preview[0]?.name).toBe('Al Bo');
    // Unreadable input is refused with the reader's reason.
    expect(() => readGuestTable({ source: 'xlsx', bytes: file('guests.csv') })).toThrow(DomainError);
    try {
      readGuestTable({ source: 'xlsx', bytes: file('guests.xlsx'), sheet: 'Missing' });
    } catch (err) {
      expect(err).toMatchObject({ code: 'validation_failed', details: { reason: 'sheet_not_found' } });
    }
    expect(() =>
      readGuestTable({
        source: 'paste',
        text: `Name\n${Array.from({ length: 5_001 }, (_, i) => `G${i}`).join('\n')}`,
      }),
    ).toThrow(DomainError);
    await expect(
      executeCommand(
        stageGuestImportCommand,
        { eventId: ev.id, source: 'paste', headers: ['Name'], rows: [] },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'empty' } });
    await expect(
      executeCommand(
        stageGuestImportCommand,
        { eventId: uuidv7(), source: 'paste', headers: ['Name'], rows: [['X']] },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('runs once: a second start is refused and a chunk run again creates nothing twice', async () => {
    const ev = await wedding(a, `Once ${a.org.slug}`);
    const staged = await stage(ev, { source: 'paste', text: new TextDecoder().decode(file('guests.txt')) });
    await validate(ev, staged.batchId);
    await runImport(ev, staged.batchId);
    await expect(runImport(ev, staged.batchId)).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'already_imported' },
    });
    await expect(validate(ev, staged.batchId)).rejects.toMatchObject({
      details: { reason: 'already_imported' },
    });
    // The same planned parties again (a worker retrying a chunk): they already exist.
    const planned = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string }>(
        sql`select distinct planned_party_id as id from guests.import_rows where batch_id = ${staged.batchId} and planned_party_id is not null`,
      ),
    );
    const again = await withTenant(systemCtx(a.org.id), (tx) =>
      guestImportAction.run(
        tx,
        systemCtx(a.org.id),
        planned.map((p) => p.id),
        {},
        {
          first: true,
          eventId: ev.id,
          operationId: uuidv7(),
          emit: () => {},
        },
      ),
    );
    expect(again.results.every((r) => r.ok)).toBe(true);
    expect((await listOf(ev)).counts).toMatchObject({ parties: 3, guests: 7 });
  });

  it('writes history with source import and the batch id for every party and guest', async () => {
    const ev = await wedding(a, `History ${a.org.slug}`);
    const staged = await stage(ev, { source: 'paste', text: new TextDecoder().decode(file('guests.txt')) });
    await validate(ev, staged.batchId);
    await runImport(ev, staged.batchId);
    const l = await executeQuery(guestListQuery, { eventId: ev.id }, a.ctx(), ports);
    const garcias = l.parties.find((p) => p.name === 'The Garcias');
    const h = await executeQuery(
      partyHistoryQuery,
      { eventId: ev.id, partyId: garcias?.id as string },
      a.ctx(),
      ports,
    );
    expect(h.map((e) => e.action).sort()).toEqual([
      'guest_added',
      'guest_added',
      'party_created',
      'plus_one_added',
    ]);
    expect(new Set(h.map((e) => e.source))).toEqual(new Set(['import']));
    expect(new Set(h.map((e) => e.detail.batchId))).toEqual(new Set([staged.batchId]));
    expect(h.every((e) => e.actor === `user:${a.ownerId}`)).toBe(false); // the runner acts as the system
    const luis = h.find((e) => e.action === 'guest_added' && e.fields.includes('dietary'));
    expect(luis?.fields).toEqual(
      expect.arrayContaining([
        'firstName',
        'lastName',
        'meal',
        'dietary',
        'address',
        'email',
        'phone',
        'isPrimary',
      ]),
    );
    const [all] = await admin<{ n: number; imp: number }[]>`
      select count(*)::int as n, count(*) filter (where source = 'import')::int as imp
      from guests.rsvp_history where org_id = ${a.org.id} and event_id = ${ev.id}`;
    expect(all).toEqual({ n: 3 + 7, imp: 3 + 7 });
  });

  it('seals private columns and staged rows; purges rows after import and everything at expiry', async () => {
    const ev = await wedding(a, `Sealed ${a.org.slug}`);
    const staged = await stage(ev, { source: 'csv', bytes: file('guests.csv') });
    const plain = ['No nuts', 'Step-free seat', '1 Main St', 'luis@example.test', 'Household', 'Luis'];
    const rawRows = async () =>
      admin<{ cells: string | null; err: string | null; imported: boolean }[]>`
        select cells_ciphertext as cells, error_code as err, imported_at is not null as imported
        from guests.import_rows where batch_id = ${staged.batchId} order by row_no`;
    const [batch] = await admin<{ h: string | null }[]>`
      select headers_ciphertext as h from guests.import_batches where id = ${staged.batchId}`;
    for (const p of plain) expect(batch?.h).not.toContain(p);
    for (const r of await rawRows()) {
      expect(r.cells).toMatch(/^local\.v1\./);
      for (const p of plain) expect(r.cells).not.toContain(p);
    }
    await validate(ev, staged.batchId);
    await runImport(ev, staged.batchId);
    // Imported rows lose their cells at once; the rejected row stays sealed for its download.
    const after = await rawRows();
    expect(after.filter((r) => r.imported).every((r) => r.cells === null)).toBe(true);
    expect(after.filter((r) => r.err).map((r) => r.cells !== null)).toEqual([true]);
    const guestRows = await admin<{ p: string | null }[]>`
      select private_ciphertext as p from guests.guests where event_id = ${ev.id}`;
    for (const g of guestRows) for (const p of plain) expect(g.p ?? '').not.toContain(p);
    expect(guestRows.filter((g) => g.p).length).toBe(3);
    // Audit rows and history hold ids and counts, never the list.
    const audit = await admin<{ data: unknown }[]>`
      select data from platform.audit_events where org_id = ${a.org.id} and action like 'guests.import.%'`;
    expect(audit.length).toBeGreaterThan(0);
    for (const r of audit) for (const p of plain) expect(JSON.stringify(r.data)).not.toContain(p);
    const hist = await admin<{ d: unknown }[]>`
      select detail as d, fields from guests.rsvp_history where event_id = ${ev.id}`;
    for (const r of hist) for (const p of plain) expect(JSON.stringify(r)).not.toContain(p);

    // A list staged but never imported, and the imported one, both expire.
    const left = await stage(ev, { source: 'paste', text: 'Name,Address\nZed Z,9 Private Way' });
    await admin`update guests.import_batches set expires_at = now() - interval '1 minute'
      where id in (${staged.batchId}, ${left.batchId})`;
    const purged = await executeCommand(purgeGuestImportsCommand, {}, systemCtx(a.org.id), ports);
    expect(purged.batches).toBeGreaterThanOrEqual(2);
    const rest = await admin<{ n: number }[]>`
      select count(*)::int as n from guests.import_rows
      where batch_id in (${staged.batchId}, ${left.batchId}) and cells_ciphertext is not null`;
    expect(rest[0]?.n).toBe(0);
    expect(await summary(ev, left.batchId)).toMatchObject({ expired: true, headers: [], sample: [] });
    await expect(
      executeQuery(
        guestImportRejectedQuery,
        { eventId: ev.id, batchId: staged.batchId, reasonHeader: 'Problem', reasons: {} },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(validate(ev, left.batchId)).rejects.toMatchObject({ details: { reason: 'expired' } });
    // Members can't purge (a system job).
    await expect(executeCommand(purgeGuestImportsCommand, {}, a.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('never creates CRM contacts, consents, audience members or domain events', async () => {
    const counts = async () => {
      const [r] = await admin<{ contacts: number; consents: number; events: number; attendees: number }[]>`
        select (select count(*)::int from crm.contacts where org_id = ${a.org.id}) as contacts,
               (select count(*)::int from crm.consents where org_id = ${a.org.id}) as consents,
               (select count(*)::int from attendees.attendees where org_id = ${a.org.id}) as attendees,
               (select count(*)::int from platform.domain_events where org_id = ${a.org.id}
                  and type not like 'bulk.%') as events`;
      return r;
    };
    const ev = await wedding(a, `Quiet import ${a.org.slug}`);
    const before = await counts();
    const staged = await stage(ev, { source: 'csv', bytes: file('guests.csv') });
    await validate(ev, staged.batchId);
    await runImport(ev, staged.batchId);
    expect(await counts()).toEqual(before);
  });

  it('rejects a whole party that no longer fits at import time, and parties over 20', async () => {
    const ev = await wedding(a, `Fits ${a.org.slug}`);
    const big = Array.from({ length: 11 }, (_, i) => `Big\tG${i} X\tyes`).join('\n');
    const staged = await stage(ev, {
      source: 'paste',
      text: `Household\tName\tPlus one\n${big}\nClash\tAl A\t\nClash\tBo B\t\nFine\tCy C\t\n`,
    });
    expect(await validate(ev, staged.batchId)).toEqual({ parties: 2, guests: 3, rejected: 11 });
    // A party named "Clash" is added by hand after the check.
    await executeCommand(createPartyCommand, { eventId: ev.id, name: 'clash' }, a.ctx(), ports);
    await runImport(ev, staged.batchId);
    const s = await summary(ev, staged.batchId);
    expect(s).toMatchObject({ status: 'imported', partiesImported: 1, guestsImported: 1 });
    expect(s.rejectedByCode).toEqual({ party_too_large: 11, party_exists: 2 });
    const names = (await listOf(ev)).parties.map((p) => [p.name, p.guests.length]);
    expect(names).toEqual([
      ['clash', 0],
      ['Fine', 1],
    ]);
  });

  it('co-hosts and planners import on their event; viewers, anonymous and other orgs cannot', async () => {
    const ev = await wedding(a, `Team import ${a.org.slug}`);
    const email = `planner-${uuidv7()}@example.test`;
    const inv = await executeCommand(
      inviteTeamMemberCommand,
      { eventId: ev.id, email, role: 'planner' },
      a.ctx(),
      ports,
    );
    const plannerId = uuidv7();
    await acceptInvitation(
      userCtx(plannerId),
      signInvitation(inv.id, process.env.APP_TOKEN_SECRET as string),
      { email, emailVerified: true },
      ports,
      { grantEventRole: grantTeamRoleTx },
    );
    const planner = userCtx(plannerId, a.org.id);
    const staged = await stage(ev, { source: 'paste', text: 'Name\nPat Planner' }, planner);
    await validate(ev, staged.batchId, planner);
    await runImport(ev, staged.batchId, planner);
    expect((await listOf(ev)).parties.map((p) => p.name)).toEqual(['Pat Planner']);
    // Not on another event of the org.
    const other = await wedding(a, `Not theirs ${a.org.slug}`);
    await expect(stage(other, { source: 'paste', text: 'Name\nX Y' }, planner)).rejects.toMatchObject({
      code: 'forbidden',
    });

    const viewer = userCtx(a.viewerId, a.org.id);
    await expect(stage(ev, { source: 'paste', text: 'Name\nX Y' }, viewer)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const mine = await stage(ev, { source: 'paste', text: 'Name\nVi Ewer' });
    await expect(summary(ev, mine.batchId, viewer)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(validate(ev, mine.batchId, viewer)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        guestImportBulk.start,
        { eventId: ev.id, selection: { filter: { batchId: mine.batchId } }, params: {} },
        viewer,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeQuery(
        guestImportSummaryQuery,
        { eventId: ev.id, batchId: mine.batchId },
        createCtx({ orgId: a.org.id }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Org B: A's import doesn't exist.
    await expect(summary(ev, mine.batchId, b.ctx())).rejects.toMatchObject({ code: 'not_found' });
    const bEvent = await wedding(b, `B wedding ${b.org.slug}`);
    await expect(summary(bEvent, mine.batchId, b.ctx())).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(
        guestImportBulk.start,
        { eventId: bEvent.id, selection: { filter: { batchId: mine.batchId } }, params: {} },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    const bRows = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from guests.import_rows where batch_id = ${mine.batchId}`,
      ),
    );
    expect(bRows[0]?.n).toBe(0);
    // The module switched off.
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'guests', effect: 'revoke', reason: 'test' },
      systemCtx(a.org.id),
      ports,
    );
    try {
      await expect(stage(ev, { source: 'paste', text: 'Name\nOff Line' })).rejects.toMatchObject({
        code: 'module_not_enabled',
      });
    } finally {
      await executeCommand(
        setEntitlementOverrideCommand,
        { moduleKey: 'guests', effect: 'grant', reason: 'test' },
        systemCtx(a.org.id),
        ports,
      );
    }
  });
});

describe('Google Sheet reader (P4-7): the SSRF guard', () => {
  const reason = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (err) {
      return (err as DomainError).details?.reason;
    }
  };
  const respond =
    (status: number, headers: Record<string, string> = {}, body = new Uint8Array()): Transport =>
    async () => ({ status, headers, body });

  it('accepts only Google Sheet links and refuses private networks and foreign redirects', async () => {
    const calls: TransportRequest[] = [];
    const spy: Transport = async (req) => {
      calls.push(req);
      return { status: 200, headers: {}, body: new Uint8Array() };
    };
    for (const url of [
      'https://evil.test/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123/edit',
      'http://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123/edit',
      'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123/edit',
      'https://10.0.0.1/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123/edit',
      'file:///etc/passwd',
    ])
      expect(await reason(fetchGoogleSheetCsv(url, { transport: spy, resolver: publicResolver }))).toBe(
        'sheet_url',
      );
    expect(calls).toEqual([]);
    // docs.google.com answering with a private address (DNS rebinding, a poisoned resolver).
    const privateResolver: Resolver = async () => [{ address: '10.0.0.5', family: 4 }];
    expect(await reason(fetchGoogleSheetCsv(SHEET_URL, { transport: spy, resolver: privateResolver }))).toBe(
      'sheet_blocked',
    );
    const loopback: Resolver = async () => [{ address: '::1', family: 6 }];
    expect(await reason(fetchGoogleSheetCsv(SHEET_URL, { transport: spy, resolver: loopback }))).toBe(
      'sheet_blocked',
    );
    expect(calls).toEqual([]);
    // A redirect off Google's hosts is not followed.
    expect(
      await reason(
        fetchGoogleSheetCsv(SHEET_URL, {
          transport: respond(302, { location: 'https://169.254.169.254/latest/meta-data' }),
          resolver: publicResolver,
        }),
      ),
    ).toBe('sheet_unavailable');
    expect(
      await reason(
        fetchGoogleSheetCsv(SHEET_URL, {
          transport: respond(302, { location: 'https://evil.test/x.csv' }),
          resolver: publicResolver,
        }),
      ),
    ).toBe('sheet_unavailable');
  });

  it('names a private, missing, oversized or unreachable sheet', async () => {
    const r = (t: Transport) =>
      reason(fetchGoogleSheetCsv(SHEET_URL, { transport: t, resolver: publicResolver }));
    expect(await r(respond(302, { location: 'https://accounts.google.com/ServiceLogin?continue=x' }))).toBe(
      'sheet_private',
    );
    expect(await r(respond(401))).toBe('sheet_private');
    expect(await r(respond(403))).toBe('sheet_private');
    expect(await r(respond(200, { 'content-type': 'text/html; charset=utf-8' }))).toBe('sheet_private');
    expect(await r(respond(404))).toBe('sheet_missing');
    expect(await r(respond(500))).toBe('sheet_unavailable');
    expect(
      await r(async () => {
        throw new DomainError('validation_failed', 'Response too large');
      }),
    ).toBe('too_large');
    expect(
      await r(async () => {
        throw new DomainError('validation_failed', 'Timed out');
      }),
    ).toBe('sheet_unavailable');
    // Redirect loops stop.
    expect(
      await r(
        respond(302, { location: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv` }),
      ),
    ).toBe('sheet_unavailable');
    // Limits reach the transport.
    const seen: TransportRequest[] = [];
    await fetchGoogleSheetCsv(SHEET_URL, {
      transport: googleTransport(new Uint8Array([65]), seen),
      resolver: publicResolver,
    });
    expect(seen[0]).toMatchObject({ timeoutMs: 10_000, maxBytes: 5_000_000, method: 'GET' });
    expect(seen[0]?.address).toEqual({ address: '142.250.1.1', family: 4 });
  });
});
