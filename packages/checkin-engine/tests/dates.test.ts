import { generateKeyPair } from '@yayatoh/ticket-crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { type ManifestRow, type OfflineState, offlineVerdict, ruleResult } from '../src/index.ts';

// A two-night event in Chicago: Dec 1 and Dec 2, 2027, 7–11 pm (CST, UTC−6).
const EVENT = {
  id: 'e1',
  startsAt: new Date('2027-12-02T01:00:00Z'),
  endsAt: new Date('2027-12-03T05:00:00Z'),
  timezone: 'America/Chicago',
};
const NIGHT_1 = { startsAt: new Date('2027-12-02T01:00:00Z'), endsAt: new Date('2027-12-02T05:00:00Z') };
const NIGHT_2 = { startsAt: new Date('2027-12-03T01:00:00Z'), endsAt: new Date('2027-12-03T05:00:00Z') };
const DURING_1 = new Date('2027-12-02T02:00:00Z');
const DURING_2 = new Date('2027-12-03T02:00:00Z');

const ticket = (occurrence: { startsAt: Date; endsAt: Date; status: string } | null) => ({
  eventId: 'e1',
  status: 'active',
  accessDates: [],
  occurrence,
});

describe('per-date admission (M1.4b)', () => {
  it('admits a ticket around its own date and refuses it on another date', () => {
    const t = ticket({ ...NIGHT_2, status: 'scheduled' });
    expect(ruleResult({ now: DURING_2, event: EVENT, ticket: t })).toBe('ok');
    expect(ruleResult({ now: DURING_1, event: EVENT, ticket: t })).toBe('wrong_date');
    // Doors open up to 6 h before, and scanning continues 6 h after.
    expect(
      ruleResult({ now: new Date(NIGHT_2.startsAt.getTime() - 5 * 3_600_000), event: EVENT, ticket: t }),
    ).toBe('ok');
    expect(
      ruleResult({ now: new Date(NIGHT_2.startsAt.getTime() - 7 * 3_600_000), event: EVENT, ticket: t }),
    ).toBe('wrong_date');
  });

  it('never admits on a cancelled date; tickets without a date admit on every date', () => {
    expect(
      ruleResult({ now: DURING_1, event: EVENT, ticket: ticket({ ...NIGHT_1, status: 'cancelled' }) }),
    ).toBe('wrong_date');
    for (const now of [DURING_1, DURING_2])
      expect(ruleResult({ now, event: EVENT, ticket: ticket(null) })).toBe('ok');
  });

  it('keeps the other verdicts first: void and outside the event window', () => {
    const t = { ...ticket({ ...NIGHT_2, status: 'scheduled' }), status: 'void' };
    expect(ruleResult({ now: DURING_1, event: EVENT, ticket: t })).toBe('void');
    expect(
      ruleResult({
        now: new Date('2027-12-10T00:00:00Z'),
        event: EVENT,
        ticket: ticket({ ...NIGHT_2, status: 'scheduled' }),
      }),
    ).toBe('outside_window');
  });
});

describe('offline per-date admission', () => {
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  beforeAll(async () => {
    keys = await generateKeyPair();
  });
  const row = (shortCode: string, occurrenceId: string | null): ManifestRow => ({
    ticketId: `0190a000-0000-7000-8000-00000000000${shortCode.length}`,
    shortCode,
    rev: 0,
    status: 'active',
    ticketTypeId: 'type-ga',
    typeName: 'Night pass',
    accessDates: [],
    occurrenceId,
    holderName: 'Sam',
    emailHash: '',
    issuedAt: '2027-11-01T00:00:00Z',
  });
  const state = (rows: ManifestRow[], withDates = true): OfflineState => ({
    header: {
      event: {
        id: 'e1',
        name: 'Two nights',
        startsAt: EVENT.startsAt.toISOString(),
        endsAt: EVENT.endsAt.toISOString(),
        timezone: EVENT.timezone,
      },
      publicKeys: { '1': btoa(String.fromCharCode(...keys.publicKey)) },
      salt: 's',
      serverTime: '2027-12-01T00:00:00Z',
      unknownPolicy: 'provisional',
      checkpoints: [],
      ...(withDates
        ? {
            occurrences: [
              {
                id: 'n1',
                startsAt: NIGHT_1.startsAt.toISOString(),
                endsAt: NIGHT_1.endsAt.toISOString(),
                status: 'scheduled',
              },
              {
                id: 'n2',
                startsAt: NIGHT_2.startsAt.toISOString(),
                endsAt: NIGHT_2.endsAt.toISOString(),
                status: 'cancelled',
              },
            ],
          }
        : {}),
    },
    byId: new Map(rows.map((r) => [r.ticketId, r])),
    byShortCode: new Map(rows.map((r) => [r.shortCode, r])),
    admitted: new Set(),
    lastSyncAt: new Date('2027-12-01T00:00:00Z'),
  });

  it('uses the manifest dates: its own date admits, another or a cancelled one does not', async () => {
    const s = state([row('NIGHTAAA', 'n1'), row('NIGHTBBBB', 'n2'), row('ANYDATEAAA', null)]);
    expect((await offlineVerdict(s, 'NIGHTAAA', DURING_1)).verdict).toBe('admit');
    expect((await offlineVerdict(s, 'NIGHTAAA', DURING_2)).verdict).toBe('wrong_date');
    expect((await offlineVerdict(s, 'NIGHTBBBB', DURING_2)).verdict).toBe('wrong_date');
    expect((await offlineVerdict(s, 'ANYDATEAAA', DURING_2)).verdict).toBe('admit');
  });

  it('a date missing from an older manifest admits nowhere', async () => {
    const s = state([row('NIGHTAAA', 'n1')], false);
    expect((await offlineVerdict(s, 'NIGHTAAA', DURING_1)).verdict).toBe('wrong_date');
  });
});
