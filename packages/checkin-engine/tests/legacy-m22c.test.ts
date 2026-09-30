import { describe, expect, it } from 'vitest';
import {
  legacyPayloadHash,
  legacyQrPayload,
  type ManifestRow,
  type OfflineState,
  offlineVerdict,
} from '../src/index.ts';

/** M2.2c: migrated tickets' legacy (Eventmie) QR payloads scan offline from the manifest. */
const NOW = new Date('2027-12-01T20:00:00Z');
const row = (ticketId: string, over: Partial<ManifestRow> = {}): ManifestRow => ({
  ticketId,
  shortCode: 'ABCDEFGH',
  rev: 0,
  status: 'active',
  ticketTypeId: 'type-ga',
  typeName: 'Pass',
  accessDates: [],
  holderName: 'Sam',
  emailHash: '',
  issuedAt: '2027-11-01T00:00:00Z',
  ...over,
});

async function state(rows: ManifestRow[], admitted: string[] = []): Promise<OfflineState> {
  return {
    header: {
      event: {
        id: 'e1',
        name: 'Legacy',
        startsAt: '2027-12-01T15:00:00Z',
        endsAt: '2027-12-02T04:00:00Z',
        timezone: 'America/Chicago',
      },
      publicKeys: {},
      salt: 'yy-manifest:e1',
      serverTime: '2027-12-01T12:00:00Z',
      unknownPolicy: 'provisional',
      checkpoints: [],
    },
    byId: new Map(rows.map((r) => [r.ticketId, r])),
    byShortCode: new Map(rows.map((r) => [r.shortCode, r])),
    byLegacyCode: new Map(rows.flatMap((r) => (r.legacyCodes ?? []).map((c) => [c, r] as const))),
    admitted: new Set(admitted),
    lastSyncAt: new Date('2027-12-01T12:00:00Z'),
  };
}

describe('legacy QR payloads', () => {
  it('reads the raw order number or a JSON object carrying it', () => {
    expect(legacyQrPayload(' 172633440000017 ')).toBe('172633440000017');
    expect(legacyQrPayload('{"order_number":"172633440000017","event":3}')).toBe('172633440000017');
    expect(legacyQrPayload('{"order_number":172633440000017}')).toBe('172633440000017');
    expect(legacyQrPayload('{"id":1}')).toBeNull();
    expect(legacyQrPayload('{broken')).toBeNull();
    expect(legacyQrPayload('abc')).toBeNull();
    expect(legacyQrPayload('has spaces 123')).toBeNull();
  });

  it('admits a migrated ticket by its legacy payload offline, then reports it as a duplicate', async () => {
    const payload = '172633440000017';
    const t = row('t1', { legacyCodes: [await legacyPayloadHash('yy-manifest:e1', payload)] });
    const s = await state([t]);
    const first = await offlineVerdict(s, payload, NOW);
    expect(first).toMatchObject({ verdict: 'admit', ticketId: 't1' });
    const json = await offlineVerdict(s, JSON.stringify({ order_number: payload }), NOW);
    expect(json.verdict).toBe('admit');
    const again = await offlineVerdict(await state([t], ['t1:2027-12-01']), payload, NOW);
    expect(again.verdict).toBe('duplicate');
  });

  it('never admits an unknown legacy payload, a void ticket or a payload from another event', async () => {
    const t = row('t1', { legacyCodes: [await legacyPayloadHash('yy-manifest:e1', '172633440000017')] });
    const v = row('t2', {
      shortCode: 'BCDEFGHJ',
      status: 'void',
      legacyCodes: [await legacyPayloadHash('yy-manifest:e1', '172633440000018')],
    });
    const s = await state([t, v]);
    expect((await offlineVerdict(s, '999999999999999', NOW)).verdict).toBe('invalid');
    expect((await offlineVerdict(s, '172633440000018', NOW)).verdict).toBe('void');
    // Hashed with another event's salt: not found here.
    const foreign = row('t3', {
      shortCode: 'CDEFGHJK',
      legacyCodes: [await legacyPayloadHash('yy-manifest:e2', '172633440000019')],
    });
    expect((await offlineVerdict(await state([foreign]), '172633440000019', NOW)).verdict).toBe('invalid');
  });

  it('still reads short codes when a manifest has no legacy codes', async () => {
    const s = await state([row('t1')]);
    expect((await offlineVerdict(s, 'abcdefgh', NOW)).verdict).toBe('admit');
  });
});
