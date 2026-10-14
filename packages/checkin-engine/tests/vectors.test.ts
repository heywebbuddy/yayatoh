import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  clockOffsetMs,
  correctedArrival,
  earlierArrival,
  findTicketHolders,
  legacyIndex,
  lookupHash,
  lookupKind,
  type ManifestHeader,
  type ManifestRow,
  type OfflineState,
  offlineVerdict,
  phoneKey,
  phoneLookupHash,
  verifyManifestScope,
} from '../src/index.ts';
import { buildVectors, serialize } from './generate-vectors.ts';

const dir = fileURLToPath(new URL('../vectors/', import.meta.url));
const read = <T>(name: string) => JSON.parse(readFileSync(`${dir}${name}`, 'utf8')) as T;

describe('the committed vector files', () => {
  it('are exactly what the generator produces (they can never change silently)', async () => {
    const built = await buildVectors();
    expect(readdirSync(dir).sort()).toEqual(Object.keys(built).sort());
    for (const [name, value] of Object.entries(built)) {
      expect(readFileSync(`${dir}${name}`, 'utf8'), name).toBe(serialize(value));
    }
  });
});

interface StateDef {
  header: ManifestHeader;
  rows: ManifestRow[];
  lastSyncAt: string;
}
interface Scenario {
  name: string;
  rule: string;
  state: string;
  code: string;
  now: string;
  checkpointId: string | null;
  direction: 'in' | 'out';
  admitted: string[];
  inRoom: string[];
  occupancy: Record<string, number>;
  expect: { verdict: string; ticketId: string | null };
}

/** The same shape a device builds from its manifest store. */
function hydrate(def: StateDef, s: Scenario): OfflineState {
  const legacy = legacyIndex(def.rows);
  return {
    header: def.header,
    byId: new Map(def.rows.map((r) => [r.ticketId, r])),
    byShortCode: new Map(def.rows.map((r) => [r.shortCode, r])),
    ...(legacy.size ? { byLegacyCode: legacy } : {}),
    admitted: new Set(s.admitted),
    lastSyncAt: new Date(def.lastSyncAt),
    inRoom: new Set(s.inRoom),
    occupancy: new Map(Object.entries(s.occupancy)),
  };
}

describe('offline verdict vectors (ADR 0011)', () => {
  const file = read<{ states: Record<string, StateDef>; scenarios: Scenario[] }>('verdicts.json');

  it('cover every ADR 0011 verdict and the rules around them', () => {
    const verdicts = new Set(file.scenarios.map((s) => s.expect.verdict));
    for (const v of [
      'admit',
      'duplicate',
      'superseded',
      'provisional',
      'invalid',
      'void',
      'outside_window',
      'wrong_date',
      'not_today',
      'granted',
      'no_access',
      'wrong_checkpoint',
      'entered',
      'scanned_out',
      'not_in_room',
      'not_enrolled',
      'admission_level',
      'capacity',
    ])
      expect(verdicts.has(v), v).toBe(true);
    expect(file.scenarios.length).toBeGreaterThanOrEqual(60);
  });

  for (const s of file.scenarios) {
    it(`${s.rule}: ${s.name}`, async () => {
      const def = file.states[s.state] as StateDef;
      const r = await offlineVerdict(hydrate(def, s), s.code, new Date(s.now), s.checkpointId, {
        direction: s.direction,
      });
      expect({ verdict: r.verdict, ticketId: r.ticketId }).toEqual(s.expect);
    });
  }
});

describe('lookup vectors', () => {
  const file = read<{
    salt: string;
    emails: { value: string; hash: string }[];
    phones: { value: string; key: string | null; hash: string | null }[];
    kinds: { query: string; kind: string }[];
    otherSalt: { salt: string; value: string; hash: string };
    rows: ManifestRow[];
    searches: { query: string; ids: string[] }[];
  }>('lookup.json');

  it('hashes a normalized email: trimmed, case-folded, per-event salt', async () => {
    for (const e of file.emails)
      expect(await lookupHash(file.salt, e.value), JSON.stringify(e.value)).toBe(e.hash);
    expect(new Set(file.emails.slice(0, 4).map((e) => e.hash)).size).toBe(1);
    expect(await lookupHash(file.otherSalt.salt, file.otherSalt.value)).toBe(file.otherSalt.hash);
    expect(file.otherSalt.hash).not.toBe(file.emails[0]?.hash);
  });

  it('hashes a phone number by its last eight digits, domain separated from emails', async () => {
    for (const p of file.phones) {
      expect(phoneKey(p.value), p.value).toBe(p.key);
      expect(await phoneLookupHash(file.salt, p.value), p.value).toBe(p.hash);
    }
    expect(new Set(file.phones.slice(0, 6).map((p) => p.hash)).size).toBe(1);
  });

  it('classifies a query as email, phone or name', () => {
    for (const k of file.kinds) expect(lookupKind(k.query), JSON.stringify(k.query)).toBe(k.kind);
  });

  it('finds holders by email hash, phone hash or name, best first', async () => {
    for (const s of file.searches) {
      const found = await findTicketHolders(file.rows, file.salt, s.query);
      expect(
        found.rows.map((r) => r.ticketId),
        JSON.stringify(s.query),
      ).toEqual(s.ids);
    }
  });
});

describe('first-wins vectors (clock offsets)', () => {
  const file = read<{
    offsets: { name: string; serverTime: number; sentAt: number; receivedAt: number; expect: number }[];
    corrected: { name: string; deviceTs: string; offsetMs: number; now: string; expect: string }[];
    earlier: { name: string; current: string | null; candidate: string; expect: boolean }[];
    races: {
      name: string;
      now: string;
      arrivals: { device: string; deviceTs: string; offsetMs: number }[];
      winner: string;
    }[];
  }>('first-wins.json');

  it('estimates the clock offset closest to zero that the round trip allows', () => {
    for (const o of file.offsets) expect(clockOffsetMs(o), o.name).toBe(o.expect);
  });

  it('corrects a device time to the server clock, never into the future', () => {
    for (const c of file.corrected) {
      expect(correctedArrival(new Date(c.deviceTs), c.offsetMs, new Date(c.now)).toISOString(), c.name).toBe(
        c.expect,
      );
    }
  });

  it('replaces a recorded arrival only with a strictly earlier one', () => {
    for (const e of file.earlier) {
      expect(earlierArrival(e.current ? new Date(e.current) : null, new Date(e.candidate)), e.name).toBe(
        e.expect,
      );
    }
  });

  const permutations = <T>(xs: T[]): T[][] =>
    xs.length <= 1
      ? [xs]
      : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));

  for (const race of file.races) {
    it(`${race.name}: the same winner in every upload order`, () => {
      for (const order of permutations(race.arrivals)) {
        let best: Date | null = null;
        let winner = '';
        for (const a of order) {
          const t = correctedArrival(new Date(a.deviceTs), a.offsetMs, new Date(race.now));
          if (earlierArrival(best, t)) {
            best = t;
            winner = a.device;
          }
        }
        expect(winner, order.map((a) => a.device).join(',')).toBe(race.winner);
      }
    });
  }
});

describe('signed manifest scope vectors', () => {
  const file = read<{ vectors: { name: string; header: ManifestHeader; expect: boolean }[] }>('scopes.json');
  for (const v of file.vectors) {
    it(v.name, async () => {
      expect(await verifyManifestScope(v.header)).toBe(v.expect);
    });
  }
});
