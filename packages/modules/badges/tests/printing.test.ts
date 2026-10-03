import { describe, expect, it } from 'vitest';
import {
  comesOnline,
  goesQuiet,
  offlineAt,
  PRINT_REASONS,
  PRINTER_OFFLINE_AFTER_MS,
  printKindFor,
  REPRINT_REASONS,
  reasonProblem,
  STATION_HEARTBEAT_MS,
} from '../src/client.ts';
import { browserPrinter, fakePrintNode, printNodeFromEnv, printNodePrinter } from '../src/printer-port.ts';

const at = (s: number) => new Date(Date.UTC(2030, 5, 1, 9, 0, s));

describe('print kinds and reasons (M5.5b)', () => {
  it('a badge never printed is a print; anything after a counted print is a reprint', () => {
    expect(printKindFor(0)).toBe('print');
    expect(printKindFor(1)).toBe('reprint');
    expect(printKindFor(7)).toBe('reprint');
  });

  it('a first print takes no reason (logged as first_print)', () => {
    expect(reasonProblem('print', null, null)).toBeNull();
    expect(reasonProblem('print', 'first_print', null)).toBeNull();
    expect(reasonProblem('print', 'damaged', null)).toBe('reason_not_allowed');
  });

  it('a reprint needs a reprint reason, and "other" needs a note', () => {
    expect(reasonProblem('reprint', null, null)).toBe('reason_required');
    expect(reasonProblem('reprint', 'first_print', null)).toBe('reason_required');
    expect(reasonProblem('reprint', 'bogus', null)).toBe('reason_required');
    for (const r of REPRINT_REASONS.filter((x) => x !== 'other'))
      expect(reasonProblem('reprint', r, null)).toBeNull();
    expect(reasonProblem('reprint', 'other', null)).toBe('note_required');
    expect(reasonProblem('reprint', 'other', '   ')).toBe('note_required');
    expect(reasonProblem('reprint', 'other', 'Coffee spilled')).toBeNull();
  });

  it('every reprint reason is a print reason, and first_print is not a reprint reason', () => {
    expect(PRINT_REASONS).toEqual(['first_print', ...REPRINT_REASONS]);
    expect(REPRINT_REASONS).not.toContain('first_print');
  });
});

describe('printer heartbeat watchdog (M5.5b)', () => {
  const online = (lastSeenAt: Date) => ({ status: 'online' as const, lastSeenAt, archived: false });

  it('the window is 90 s and a station beats three times inside it', () => {
    expect(PRINTER_OFFLINE_AFTER_MS).toBe(90_000);
    expect(PRINTER_OFFLINE_AFTER_MS / STATION_HEARTBEAT_MS).toBe(3);
  });

  it('a printer silent for 89 s is still online; at 90 s it goes quiet', () => {
    expect(goesQuiet(online(at(0)), at(89))).toBe(false);
    expect(goesQuiet(online(at(0)), at(90))).toBe(true);
    expect(goesQuiet(online(at(0)), at(600))).toBe(true);
    expect(offlineAt(at(0))).toEqual(at(90));
  });

  it('only an online printer goes quiet (so the offline event fires once per silence)', () => {
    expect(goesQuiet({ status: 'offline', lastSeenAt: at(0), archived: false }, at(500))).toBe(false);
    expect(goesQuiet({ status: 'unknown', lastSeenAt: null, archived: false }, at(500))).toBe(false);
    expect(goesQuiet({ status: 'online', lastSeenAt: at(0), archived: true }, at(500))).toBe(false);
  });

  it('a heartbeat is a change only for a printer not already online', () => {
    expect(comesOnline({ status: 'unknown', lastSeenAt: null, archived: false })).toBe(true);
    expect(comesOnline({ status: 'offline', lastSeenAt: at(0), archived: false })).toBe(true);
    expect(comesOnline(online(at(0)))).toBe(false);
    expect(comesOnline({ status: 'offline', lastSeenAt: at(0), archived: true })).toBe(false);
  });
});

describe('BadgePrinter port (M5.5b)', () => {
  const job = (over: Partial<Parameters<typeof browserPrinter.submit>[0]> = {}) => ({
    orgId: '00000000-0000-7000-8000-000000000001',
    printnodePrinterId: 7,
    title: 'Summit · Ada Lovelace',
    pdf: new TextEncoder().encode('%PDF-1'),
    idempotencyKey: 'job-1',
    ...over,
  });

  it('the browser adapter hands over without a provider job and reports no states', async () => {
    expect(await browserPrinter.submit(job())).toEqual({ ok: true, providerJobId: null });
    expect((await browserPrinter.states('o', [1, 2])).size).toBe(0);
  });

  it('the fake PrintNode accepts jobs once per idempotency key and reports states', async () => {
    const pn = fakePrintNode();
    const a = await pn.submit(job());
    const again = await pn.submit(job());
    expect(a).toEqual({ ok: true, providerJobId: '1001' });
    expect(again).toEqual(a);
    expect(pn.jobs).toHaveLength(1);
    pn.setState(8, 'offline');
    pn.setState(9, 'rejects');
    const states = await pn.states('o', [7, 8, 9, 404]);
    expect(Object.fromEntries(states)).toEqual({ 7: 'online', 8: 'offline', 9: 'online' });
    expect(await pn.submit(job({ printnodePrinterId: 9, idempotencyKey: 'job-2' }))).toEqual({
      ok: false,
      code: 'printer_rejected',
    });
    expect(await pn.submit(job({ printnodePrinterId: 404, idempotencyKey: 'job-3' }))).toEqual({
      ok: false,
      code: 'printer_unknown',
    });
  });

  it('the PrintNode adapter speaks the REST API with the org as child account (no network: stub)', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const pn = printNodePrinter({
      apiKey: 'test-key',
      baseUrl: 'https://printnode.invalid',
      fetch: async (url, init) => {
        calls.push({ url, init });
        if (url.endsWith('/printjobs')) return new Response('4242', { status: 201 });
        return Response.json([
          { id: 7, state: 'online', computer: { state: 'connected' } },
          { id: 8, state: 'online', computer: { state: 'disconnected' } },
        ]);
      },
    });
    expect(await pn.submit(job())).toEqual({ ok: true, providerJobId: '4242' });
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['x-child-account-by-creatorref']).toBe('00000000-0000-7000-8000-000000000001');
    expect(headers['x-idempotency-key']).toBe('job-1');
    expect(headers.authorization).toBe(`Basic ${Buffer.from('test-key:').toString('base64')}`);
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ printerId: 7, contentType: 'pdf_base64' });
    expect(Buffer.from(String(body.content), 'base64').toString()).toBe('%PDF-1');
    const states = await pn.states('org', [7, 8]);
    expect(calls[1]?.url).toBe('https://printnode.invalid/printers/7,8');
    expect(Object.fromEntries(states)).toEqual({ 7: 'online', 8: 'offline' });
  });

  it('the PrintNode adapter maps refusals and outages to codes', async () => {
    const status = (s: number) =>
      printNodePrinter({ apiKey: 'k', fetch: async () => new Response('{}', { status: s }) });
    expect(await (await status(404)).submit(job())).toEqual({ ok: false, code: 'printer_unknown' });
    expect(await (await status(409)).submit(job())).toEqual({ ok: true, providerJobId: null });
    expect(await (await status(500)).submit(job())).toEqual({ ok: false, code: 'http_500' });
    const down = printNodePrinter({
      apiKey: 'k',
      fetch: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(await down.submit(job())).toEqual({ ok: false, code: 'unreachable' });
  });

  it('chooses the real PrintNode only with an explicit switch and a key; the fake in dev and CI', () => {
    expect(printNodeFromEnv({ PRINTNODE_API_KEY: 'k' })).toBeNull();
    expect(printNodeFromEnv({ YAYATOH_DEV_AUTH: '1', PRINTNODE_API_KEY: 'k' })).toHaveProperty('setState');
    expect(printNodeFromEnv({ NODE_ENV: 'test' })).toHaveProperty('setState');
    const real = printNodeFromEnv({ BADGE_PRINTER_PROVIDER: 'printnode', PRINTNODE_API_KEY: 'k' });
    expect(real?.adapter).toBe('printnode');
    expect(real).not.toHaveProperty('setState');
  });
});
