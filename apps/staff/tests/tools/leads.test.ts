import { YayatohApiError } from '@yayatoh/sdk';
import type { LeadScanResult } from '../../src/tools/api';
import {
  checkEdit,
  createLeadOutbox,
  failureOf,
  matchesLead,
  scanGate,
  shownLead,
  SYNC_BATCH_MAX,
} from '../../src/tools/leads';
import { lead, newId, setup, testVault } from './fixtures';

const result = (scanId: string, status: LeadScanResult['status'] = 'captured'): LeadScanResult => ({
  scanId,
  status,
  reason: status === 'refused' ? 'invalid' : null,
  lead: status === 'refused' ? null : lead(),
});

const portal = (over: Record<string, unknown> = {}) => ({
  setup: jest.fn(),
  leads: jest.fn(),
  updateLead: jest.fn(),
  syncScans: jest.fn(async (scans: readonly { scanId: string; code: string }[]) => scans.map((s) => result(s.scanId))),
  ...over,
});

const problemWith = (status: number, reason?: string) =>
  new YayatohApiError(new Response(null, { status }), { code: 'x', ...(reason ? { reason } : {}) } as never);

describe('lead consent (P5-8)', () => {
  it('shows every field the attendee agreed to share, the email only with its consent', () => {
    const s = shownLead(lead());
    expect(s).toMatchObject({ name: 'Dana Whitfield', jobTitle: 'Head of Operations', company: 'Northwind', email: 'dana@northwind.test' });
  });

  it('hides a field that was not shared even if the response carries it', () => {
    const s = shownLead(lead({ sharedFields: ['name'], email: 'dana@northwind.test' }));
    expect(s).toMatchObject({ name: 'Dana Whitfield', jobTitle: null, company: null, email: null });
  });

  it('hides an email the attendee withdrew, and says it was withdrawn', () => {
    const s = shownLead(lead({ emailWithdrawnAt: '2026-10-21T09:00:00Z' }));
    expect(s.email).toBeNull();
    expect(s.emailWithdrawn).toBe(true);
  });

  it('never shows an email without its consent, whatever else is shared', () => {
    const s = shownLead(lead({ sharedFields: ['name', 'job_title', 'company'], email: 'dana@northwind.test' }));
    expect(s.email).toBeNull();
    expect(s.emailWithdrawn).toBe(false);
    expect(JSON.stringify(s)).not.toContain('dana@northwind.test');
  });

  it('searches only what the rep may see', () => {
    const s = shownLead(lead({ sharedFields: ['name'], company: 'Northwind' }));
    expect(matchesLead(s, 'dana')).toBe(true);
    expect(matchesLead(s, 'northwind')).toBe(false);
    expect(matchesLead(s, 'after the keynote')).toBe(true);
    expect(matchesLead(s, '  ')).toBe(true);
  });
});

describe('the lead licence and the capture window (P5-4)', () => {
  const noon = new Date('2026-10-20T12:00:00Z');
  it('lets a licensed rep scan inside the window', () => expect(scanGate(setup(), noon)).toEqual({ open: true }));
  it('stops a rep without a licence, or over the allowance', () => {
    expect(scanGate(setup({ license: 'unlicensed' }), noon)).toEqual({ open: false, why: 'no_license' });
    expect(scanGate(setup({ license: 'over_allowance' }), noon)).toEqual({ open: false, why: 'over_allowance' });
  });
  it('waits for the exhibitor admin to accept the lead terms', () =>
    expect(scanGate(setup({ termsAccepted: false }), noon)).toEqual({ open: false, why: 'terms' }));
  it('opens 24 hours before the event and closes 48 hours after', () => {
    expect(scanGate(setup(), new Date('2026-10-19T12:59:00Z'))).toEqual({ open: false, why: 'not_open' });
    expect(scanGate(setup(), new Date('2026-10-22T13:01:00Z'))).toEqual({ open: false, why: 'closed' });
  });
});

describe('editing a lead', () => {
  it('keeps to the limits the route enforces', () => {
    expect(checkEdit({ qualifiers: [], notes: '' })).toBeNull();
    expect(checkEdit({ qualifiers: Array(11).fill('a'), notes: '' })).toBe('too_many_qualifiers');
    expect(checkEdit({ qualifiers: ['x'.repeat(61)], notes: '' })).toBe('qualifier_too_long');
    expect(checkEdit({ qualifiers: [], notes: 'n'.repeat(2001) })).toBe('notes_too_long');
  });
});

describe('the lead outbox', () => {
  const make = (api: unknown = portal(), owner = 'rep@acme.test', t = testVault()) => ({
    t,
    api: api as ReturnType<typeof portal>,
    outbox: createLeadOutbox({
      vault: t.vault,
      api: api as never,
      owner,
      newId,
      now: () => new Date('2026-10-20T10:00:00Z'),
    }),
  });

  it('queues an offline scan with its rating, qualifiers and notes, then syncs it', async () => {
    const { outbox, api } = make();
    const s = await outbox.add({ code: ' BADGE-1 ', rating: 'hot', qualifiers: ['Wants demo'], notes: 'Call', offline: true });
    expect(s).toMatchObject({ code: 'BADGE-1', rating: 'hot', qualifiers: ['Wants demo'], notes: 'Call', offline: true, capturedAt: '2026-10-20T10:00:00.000Z' });
    const r = await outbox.flush();
    expect(r).toMatchObject({ pending: 0, failure: null });
    expect(r.results.map((x) => x.status)).toEqual(['captured']);
    expect(api.syncScans.mock.calls[0]?.[0]?.[0]).not.toHaveProperty('owner');
    expect(await outbox.pending()).toEqual([]);
  });

  it('keeps scans while offline and sends them later, each scan id once', async () => {
    let up = false;
    const api = portal({
      syncScans: jest.fn(async (scans: readonly { scanId: string }[]) => {
        if (!up) throw new TypeError('Network request failed');
        return scans.map((s) => result(s.scanId));
      }),
    });
    const { outbox } = make(api);
    const a = await outbox.add({ code: 'A' });
    await outbox.add({ code: 'B' });
    expect(await outbox.flush()).toMatchObject({ pending: 2, failure: 'unreachable', results: [] });
    up = true;
    const r = await outbox.flush();
    expect(r.results.map((x) => x.scanId)).toContain(a.scanId);
    expect(r.pending).toBe(0);
  });

  it('lets an edit made before the sync ride along with the scan', async () => {
    const { outbox, api } = make();
    const s = await outbox.add({ code: 'A', rating: 'cold' });
    await outbox.edit(s.scanId, { rating: 'hot', notes: 'Better fit than I thought' });
    await outbox.flush();
    expect(api.syncScans.mock.calls[0]?.[0]?.[0]).toMatchObject({ rating: 'hot', notes: 'Better fit than I thought' });
  });

  it('removes a refused scan from the queue (it will not succeed on a retry)', async () => {
    const api = portal({ syncScans: jest.fn(async (scans: readonly { scanId: string }[]) => scans.map((s) => result(s.scanId, 'refused'))) });
    const { outbox } = make(api);
    await outbox.add({ code: 'bad' });
    const r = await outbox.flush();
    expect(r.results[0]).toMatchObject({ status: 'refused', reason: 'invalid' });
    expect(await outbox.pending()).toEqual([]);
  });

  it('sends at most 200 scans per request', async () => {
    const { outbox, api } = make();
    for (let i = 0; i < SYNC_BATCH_MAX + 3; i++) await outbox.add({ code: `B${i}` });
    await outbox.flush();
    expect(api.syncScans.mock.calls.map((c) => c[0].length)).toEqual([200, 3]);
  });

  it('keeps the queue and says why when the licence, the terms or the access has ended', async () => {
    const cases: [unknown, string][] = [
      [problemWith(403, 'no_license'), 'no_license'],
      [problemWith(403, 'over_allowance'), 'over_allowance'],
      [problemWith(409, 'terms_not_accepted'), 'terms'],
      [problemWith(409), 'ended'],
      [problemWith(401), 'unreachable'],
      [problemWith(500), 'unreachable'],
      [new TypeError('x'), 'unreachable'],
    ];
    for (const [err, failure] of cases) {
      expect(failureOf(err)).toBe(failure);
      const { outbox } = make(portal({ syncScans: jest.fn(async () => { throw err; }) }));
      await outbox.add({ code: 'A' });
      expect(await outbox.flush()).toMatchObject({ pending: 1, failure });
    }
  });

  it('never shows or sends another rep’s queue from the same phone', async () => {
    const t = testVault();
    const a = make(portal(), 'rep-a@acme.test', t);
    const b = make(portal(), 'rep-b@other.test', t);
    await a.outbox.add({ code: 'A1' });
    await b.outbox.add({ code: 'B1' });
    expect((await a.outbox.pending()).map((s) => s.code)).toEqual(['A1']);
    expect((await b.outbox.pending()).map((s) => s.code)).toEqual(['B1']);
    await b.outbox.flush();
    expect(b.api.syncScans.mock.calls.flatMap((c) => c[0].map((s: { code: string }) => s.code))).toEqual(['B1']);
    expect((await a.outbox.pending()).map((s) => s.code)).toEqual(['A1']);
  });

  it('keeps badge payloads and notes encrypted on the phone', async () => {
    const { outbox, t } = make();
    await outbox.add({ code: 'SECRETBADGE', notes: 'private note' });
    for (const f of t.files.files.values()) {
      const text = new TextDecoder().decode(f);
      expect(text).not.toContain('SECRETBADGE');
      expect(text).not.toContain('private note');
    }
  });
});
