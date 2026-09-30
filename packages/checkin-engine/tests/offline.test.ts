import { generateKeyPair, signTicketCode } from '@yayatoh/ticket-crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  admittedKey,
  lookupHash,
  type ManifestRow,
  type OfflineState,
  offlineVerdict,
  uuidv7Time,
  zoneAllows,
} from '../src/index.ts';

// UUIDv7 ids with chosen timestamps (first 48 bits = ms since epoch).
const idAt = (ms: number, tail: string) =>
  `${ms
    .toString(16)
    .padStart(12, '0')
    .replace(/^(.{8})(.{4})$/, '$1-$2')}-7000-8000-${tail}`;
const SYNC = Date.parse('2027-12-01T12:00:00Z');
const KNOWN = idAt(SYNC - 86_400_000, '000000000001');
const GALA = idAt(SYNC - 86_400_000, '000000000002');
const VOIDED = idAt(SYNC - 86_400_000, '000000000003');
const LATE = idAt(SYNC + 60_000, '000000000004'); // issued after the last sync
const OLD_UNKNOWN = idAt(SYNC - 3_600_000, '000000000005');
const NOW = new Date('2027-12-01T20:00:00Z'); // 2 pm Chicago, Dec 1

let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let other: Awaited<ReturnType<typeof generateKeyPair>>;
const code = (id: string, rev = 0, k = keys) => signTicketCode({ kid: 1, ticketId: id, rev }, k.privateKey);

const row = (ticketId: string, over: Partial<ManifestRow> = {}): ManifestRow => ({
  ticketId,
  shortCode: `SC${'ABCDEFGH'[Number(ticketId.slice(-1))] ?? 'Z'}XYZWQ`,
  rev: 0,
  status: 'active',
  ticketTypeId: 'type-ga',
  typeName: 'Pass',
  accessDates: [],
  holderName: 'Sam',
  emailHash: '',
  issuedAt: new Date(uuidv7Time(ticketId)).toISOString(),
  ...over,
});

function state(admitted: string[] = [], policy: 'provisional' | 'reject' = 'provisional'): OfflineState {
  const rows = [
    row(KNOWN, { rev: 1 }),
    row(GALA, { ticketTypeId: 'type-vip', accessDates: [{ date: '2027-12-02', name: 'Gala' }] }),
    row(VOIDED, { status: 'void' }),
  ];
  return {
    header: {
      event: {
        id: 'e1',
        name: 'Offline test',
        startsAt: '2027-12-01T15:00:00Z',
        endsAt: '2027-12-03T04:00:00Z',
        timezone: 'America/Chicago',
      },
      publicKeys: { '1': btoa(String.fromCharCode(...keys.publicKey)) },
      salt: 's',
      serverTime: new Date(SYNC).toISOString(),
      unknownPolicy: policy,
      checkpoints: [
        { id: 'north', name: 'North gate', kind: 'entrance', ticketTypeIds: [] },
        { id: 'vip', name: 'VIP lounge', kind: 'zone', ticketTypeIds: ['type-vip'] },
        { id: 'hall', name: 'Hall', kind: 'zone', ticketTypeIds: [] },
      ],
    },
    byId: new Map(rows.map((r) => [r.ticketId, r])),
    byShortCode: new Map(rows.map((r) => [r.shortCode, r])),
    admitted: new Set(admitted),
    lastSyncAt: new Date(SYNC),
  };
}

beforeAll(async () => {
  keys = await generateKeyPair();
  other = await generateKeyPair();
});

describe('offline verdicts (ADR 0011 table)', () => {
  it('valid signature, rev equal, active, not admitted locally → admit', async () => {
    expect((await offlineVerdict(state(), await code(KNOWN, 1), NOW)).verdict).toBe('admit');
  });

  it('already admitted on this device (today, event timezone) → duplicate', async () => {
    const s = state([admittedKey(KNOWN, '2027-12-01')]);
    expect((await offlineVerdict(s, await code(KNOWN, 1), NOW)).verdict).toBe('duplicate');
  });

  it('rev lower than the manifest → superseded', async () => {
    expect((await offlineVerdict(state(), await code(KNOWN, 0), NOW)).verdict).toBe('superseded');
  });

  it('not in the manifest: issued after the last sync → provisional (policy), before → invalid', async () => {
    expect((await offlineVerdict(state(), await code(LATE), NOW)).verdict).toBe('provisional');
    expect((await offlineVerdict(state([], 'reject'), await code(LATE), NOW)).verdict).toBe('invalid');
    expect((await offlineVerdict(state(), await code(OLD_UNKNOWN), NOW)).verdict).toBe('invalid');
  });

  it('bad signature (another org’s key, or tampered) → invalid', async () => {
    expect((await offlineVerdict(state(), await code(KNOWN, 1, other), NOW)).verdict).toBe('invalid');
    const c = await code(KNOWN, 1);
    expect(
      (await offlineVerdict(state(), `${c.slice(0, -1)}${c.endsWith('A') ? 'B' : 'A'}`, NOW)).verdict,
    ).toBe('invalid');
  });

  it('shares the server rules: void, access dates, event window; short codes work', async () => {
    const s = state();
    expect((await offlineVerdict(s, await code(VOIDED), NOW)).verdict).toBe('void');
    expect((await offlineVerdict(s, await code(GALA), NOW)).verdict).toBe('not_today');
    expect((await offlineVerdict(s, await code(GALA), new Date('2027-12-02T20:00:00Z'))).verdict).toBe(
      'admit',
    );
    expect((await offlineVerdict(s, await code(KNOWN, 1), new Date('2027-11-30T00:00:00Z'))).verdict).toBe(
      'outside_window',
    );
    const short = [...s.byShortCode.keys()][0] as string;
    expect((await offlineVerdict(s, short.toLowerCase(), NOW)).verdict).toBe('admit');
    expect((await offlineVerdict(s, 'NOPE2345', NOW)).verdict).toBe('invalid');
  });

  it('lookup hashes are salted per event and normalize the email', async () => {
    expect(await lookupHash('e1', ' Ada@Example.test ')).toBe(await lookupHash('e1', 'ada@example.test'));
    expect(await lookupHash('e1', 'ada@example.test')).not.toBe(await lookupHash('e2', 'ada@example.test'));
  });
});

describe('checkpoints', () => {
  const GALA_DAY = new Date('2027-12-02T20:00:00Z');

  it('an entrance behaves like the event: admit, then duplicate on this device', async () => {
    expect((await offlineVerdict(state(), await code(KNOWN, 1), NOW, 'north')).verdict).toBe('admit');
    const day = '2027-12-01';
    expect(
      (await offlineVerdict(state([admittedKey(KNOWN, day)]), await code(KNOWN, 1), NOW, 'north')).verdict,
    ).toBe('duplicate');
  });

  it('a zone grants the listed ticket types, refuses others, and allows re-entry', async () => {
    expect((await offlineVerdict(state(), await code(GALA), GALA_DAY, 'vip')).verdict).toBe('granted');
    expect((await offlineVerdict(state(), await code(KNOWN, 1), NOW, 'vip')).verdict).toBe('no_access');
    const again = state([admittedKey(GALA, '2027-12-02')]);
    expect((await offlineVerdict(again, await code(GALA), GALA_DAY, 'vip')).verdict).toBe('granted');
    // Event rules still come first: the gala pass isn't valid on Dec 1.
    expect((await offlineVerdict(state(), await code(GALA), NOW, 'vip')).verdict).toBe('not_today');
  });

  it('an unknown-but-signed pass only gets into an all-types zone', async () => {
    expect((await offlineVerdict(state(), await code(LATE), NOW, 'vip')).verdict).toBe('no_access');
    expect((await offlineVerdict(state(), await code(LATE), NOW, 'hall')).verdict).toBe('granted');
    expect(zoneAllows({ ticketTypeIds: [] }, null)).toBe(true);
  });
});
