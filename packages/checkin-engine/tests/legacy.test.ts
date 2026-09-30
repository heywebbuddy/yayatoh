import { describe, expect, it } from 'vitest';
import {
  admittedKey,
  legacyIndex,
  legacyPayloadHash,
  legacyQrPayload,
  lookupHash,
  type ManifestRow,
  type OfflineState,
  offlineVerdict,
} from '../src/index.ts';

/**
 * M1.9e: migrated (legacy Eventmie) tickets scan offline. The manifest carries their QR payloads
 * only as per-event salted hashes; the device hashes what it scans and looks the row up, before
 * short codes (the server's order).
 */
const SALT = 'yy-manifest:e1';
const NOW = new Date('2027-12-01T20:00:00Z'); // 2 pm Chicago, inside the event window
const ID = '0190d3a0-0000-7000-8000-000000000001';
const OTHER = '0190d3a0-0000-7000-8000-000000000002';

const row = (ticketId: string, over: Partial<ManifestRow> = {}): ManifestRow => ({
  ticketId,
  shortCode: ticketId === ID ? 'ABCD2345' : 'WXYZ6789',
  rev: 0,
  status: 'active',
  ticketTypeId: 'type-ga',
  typeName: 'Season Pass',
  accessDates: [],
  holderName: 'Lee',
  emailHash: '',
  issuedAt: '2027-11-01T00:00:00Z',
  ...over,
});

async function state(rows: ManifestRow[], admitted: string[] = []): Promise<OfflineState> {
  return {
    header: {
      event: {
        id: 'e1',
        name: 'Legacy gala',
        startsAt: '2027-12-01T15:00:00Z',
        endsAt: '2027-12-02T04:00:00Z',
        timezone: 'America/Chicago',
      },
      publicKeys: {},
      salt: SALT,
      serverTime: '2027-12-01T12:00:00Z',
      unknownPolicy: 'provisional',
      checkpoints: [],
    },
    byId: new Map(rows.map((r) => [r.ticketId, r])),
    byShortCode: new Map(rows.map((r) => [r.shortCode, r])),
    byLegacyCode: legacyIndex(rows),
    admitted: new Set(admitted),
    lastSyncAt: new Date('2027-12-01T12:00:00Z'),
  };
}

describe('legacy QR payloads offline', () => {
  it('normalizes raw and JSON payloads, case-sensitively, and refuses anything else', () => {
    expect(legacyQrPayload(' 1700000123456 ')).toBe('1700000123456');
    expect(legacyQrPayload('{"order_number":"AbC-12345","x":1}')).toBe('AbC-12345');
    expect(legacyQrPayload('{"order_number":1700000123456}')).toBe('1700000123456');
    expect(legacyQrPayload('{"order_number":null}')).toBeNull();
    expect(legacyQrPayload('{not json')).toBeNull();
    expect(legacyQrPayload('short')).toBeNull();
    expect(legacyQrPayload('has space 123')).toBeNull();
  });

  it('hashes are salted per event, case-sensitive, and not the email lookup hash', async () => {
    const h = await legacyPayloadHash(SALT, 'AbC-12345');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await legacyPayloadHash(SALT, 'abc-12345')).not.toBe(h);
    expect(await legacyPayloadHash('yy-manifest:e2', 'AbC-12345')).not.toBe(h);
    expect(await lookupHash(SALT, 'AbC-12345')).not.toBe(h);
  });

  it('admits a migrated ticket by its payload (raw or JSON), then a repeat is a local duplicate', async () => {
    const rows = [row(ID, { legacyCodes: [await legacyPayloadHash(SALT, '1700000123456')] }), row(OTHER)];
    const s = await state(rows);
    expect(await offlineVerdict(s, '1700000123456', NOW)).toMatchObject({ verdict: 'admit', ticketId: ID });
    expect(await offlineVerdict(s, '{"order_number":"1700000123456"}', NOW)).toMatchObject({
      verdict: 'admit',
      ticketId: ID,
    });
    const s2 = await state(rows, [admittedKey(ID, '2027-12-01')]);
    expect(await offlineVerdict(s2, '1700000123456', NOW)).toMatchObject({
      verdict: 'duplicate',
      ticketId: ID,
    });
    // The same ticket by its printed short code is the same admission.
    expect(await offlineVerdict(s2, 'abcd2345', NOW)).toMatchObject({ verdict: 'duplicate', ticketId: ID });
  });

  it('applies the event rules to migrated tickets (void)', async () => {
    const s = await state([
      row(ID, { status: 'void', legacyCodes: [await legacyPayloadHash(SALT, 'LEG-0001')] }),
    ]);
    expect(await offlineVerdict(s, 'LEG-0001', NOW)).toMatchObject({ verdict: 'void', ticketId: ID });
  });

  it('an unknown legacy-looking payload is invalid; a short code still works; old manifests have no hashes', async () => {
    const s = await state([
      row(ID, { legacyCodes: [await legacyPayloadHash(SALT, 'LEG-0001')] }),
      row(OTHER),
    ]);
    expect(await offlineVerdict(s, '999999999999999', NOW)).toMatchObject({
      verdict: 'invalid',
      ticketId: null,
    });
    expect(await offlineVerdict(s, 'leg-0001', NOW)).toMatchObject({ verdict: 'invalid' });
    expect(await offlineVerdict(s, 'WXYZ6789', NOW)).toMatchObject({ verdict: 'admit', ticketId: OTHER });
    const old = { ...(await state([row(ID)])), byLegacyCode: undefined };
    expect(await offlineVerdict(old, 'LEG-0001', NOW)).toMatchObject({ verdict: 'invalid' });
  });
});
