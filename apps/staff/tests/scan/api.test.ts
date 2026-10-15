/**
 * The scanner's two server calls go through `@yayatoh/sdk` (never a hand-written `/v1` fetch), with
 * the device token in the Authorization header, and map refusals to errors the engine understands.
 */
import { createYayatohClient } from '@yayatoh/sdk';
import { ScanAuthError, ScanRejectedError, ScanSyncError, sdkScanApi } from '../../src/scan/api';
import { EVENT_ID, header } from './harness';

const TOKEN = `yyd_${'Ab1'.repeat(14)}`;

function client(respond: (request: Request) => Response) {
  const calls: Request[] = [];
  const api = sdkScanApi(
    createYayatohClient({
      baseUrl: 'https://api.test',
      token: TOKEN,
      client: 'yayatoh-staff-android/1.0.0',
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push(request.clone());
        return respond(request);
      },
    }),
  );
  return { api, calls };
}

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the manifest call', () => {
  it('asks for a page by cursor with the device token, and no overlap on the first page', async () => {
    const page = { header: await header(), rows: [], cursor: '40', complete: true };
    const { api, calls } = client(() => json(200, page));
    const out = await api.manifestPage(EVENT_ID, { cursor: null, overlap: false, limit: 2000 });
    expect(out.complete).toBe(true);
    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toBe(`/v1/events/${EVENT_ID}/manifest`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '2000' });
    expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]?.headers.get('x-yayatoh-client')).toBe('yayatoh-staff-android/1.0.0');
  });

  it('sends the cursor, and the overlap only with one', async () => {
    const page = { header: await header(), rows: [], cursor: '40', complete: true };
    const { api, calls } = client(() => json(200, page));
    await api.manifestPage(EVENT_ID, { cursor: '40', overlap: true, limit: 500 });
    await api.manifestPage(EVENT_ID, { cursor: '40', overlap: false, limit: 500 });
    await api.manifestPage(EVENT_ID, { cursor: null, overlap: true, limit: 500 });
    const query = (i: number) => Object.fromEntries(new URL(calls[i]?.url ?? '').searchParams);
    expect(query(0)).toEqual({ limit: '500', cursor: '40', overlap: 'true' });
    expect(query(1)).toEqual({ limit: '500', cursor: '40' });
    expect(query(2)).toEqual({ limit: '500' });
  });

  it.each([
    [401, ScanAuthError],
    [403, ScanSyncError],
    [422, ScanRejectedError],
  ])('turns a %s into the error the engine handles', async (status, error) => {
    const { api } = client(() => json(status, { code: 'x' }));
    await expect(api.manifestPage(EVENT_ID, { cursor: null, overlap: false, limit: 10 })).rejects.toThrow(
      error,
    );
  });

  it('turns a server error into a plain failure (the engine retries)', async () => {
    const { api } = client(() => json(503));
    const call = api.manifestPage(EVENT_ID, { cursor: null, overlap: false, limit: 10 });
    await expect(call).rejects.toThrow('request failed (503)');
    await expect(call).rejects.not.toBeInstanceOf(ScanAuthError);
  });
});

describe('the batch call', () => {
  const scan = {
    scanId: '0192d3a0-0000-7000-8000-000000000001',
    code: 'ABCD1234',
    deviceTs: '2027-12-01T20:00:00.000Z',
    clockOffsetMs: -250,
    verdict: 'admit',
  };

  it('posts the scans with the event, leaving optional fields out when they are not set', async () => {
    const { api, calls } = client(() => json(200, { results: [], duplicatesOffline: 0 }));
    await api.syncScans(EVENT_ID, [
      scan,
      {
        ...scan,
        scanId: '0192d3a0-0000-7000-8000-000000000002',
        checkpointId: '0192d3a0-0000-7000-8000-00000000c001',
        direction: 'out',
      },
    ]);
    expect(new URL(calls[0]?.url ?? '').pathname).toBe('/v1/scans/batch');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    const body = (await calls[0]?.json()) as { eventId: string; scans: Record<string, unknown>[] };
    expect(body.eventId).toBe(EVENT_ID);
    expect(body.scans[0]).toEqual(scan);
    expect(body.scans[1]).toMatchObject({
      checkpointId: '0192d3a0-0000-7000-8000-00000000c001',
      direction: 'out',
    });
  });

  it('never sends what the screens kept for themselves (ticket id, holder name)', async () => {
    const { api, calls } = client(() => json(200, { results: [], duplicatesOffline: 0 }));
    await api.syncScans(EVENT_ID, [{ ...scan, ticketId: 't1', holderName: 'Ada' } as never]);
    expect(JSON.stringify(await calls[0]?.json())).not.toContain('Ada');
  });

  it.each([
    [401, ScanAuthError],
    [400, ScanRejectedError],
    [422, ScanRejectedError],
  ])('turns a %s into the error the engine handles', async (status, error) => {
    const { api } = client(() => json(status, { code: 'x' }));
    await expect(api.syncScans(EVENT_ID, [scan])).rejects.toThrow(error);
  });
});
