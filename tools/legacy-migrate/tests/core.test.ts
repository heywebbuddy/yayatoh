import { describe, expect, it } from 'vitest';
import {
  detUuid,
  emailNorm,
  isValidEmail,
  legacyKey,
  SHORT_CODE_ALPHABET,
  shortCode,
  slugify,
} from '../src/ids.ts';
import { convertValue, mapColumn, parseCreate } from '../src/load.ts';
import { orderKey, rowTotals, splitRow } from '../src/money.ts';
import { checkinInstant, localDate, venueTimezone, wallClock, wallToInstant } from '../src/time.ts';

describe('deterministic UUIDv7 ids', () => {
  const at = new Date('2024-05-01T14:00:00.123Z');

  it('is a v7 UUID whose timestamp is created_at and whose rest is SHA-256(instance|table|id)', () => {
    const id = detUuid(at, legacyKey('yay', 'bookings', 42));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(at.getTime());
  });

  it('is stable across runs and differs per instance, table and legacy id', () => {
    const a = detUuid(at, legacyKey('yay', 'bookings', 42));
    expect(detUuid(new Date(at), legacyKey('yay', 'bookings', 42))).toBe(a);
    expect(detUuid('2024-05-01 14:00:00.123+00', legacyKey('yay', 'bookings', 42))).toBe(a);
    expect(detUuid(at, legacyKey('abc', 'bookings', 42))).not.toBe(a);
    expect(detUuid(at, legacyKey('yay', 'attendees', 42))).not.toBe(a);
    expect(detUuid(at, legacyKey('yay', 'bookings', 43))).not.toBe(a);
  });

  it('sorts with creation time (index locality) and falls back to a fixed epoch when created_at is missing', () => {
    const earlier = detUuid(new Date('2023-01-01T00:00:00Z'), 'k1');
    const later = detUuid(new Date('2025-01-01T00:00:00Z'), 'k0');
    expect(earlier < later).toBe(true);
    expect(detUuid(null, 'k')).toBe(detUuid(new Date('2019-01-01T00:00:00Z'), 'k'));
    expect(() => detUuid('not a date', 'k')).toThrow(/not a timestamp/);
  });
});

describe('email merge key lower(nfkc(trim(email)))', () => {
  it('trims, folds case and applies NFKC', () => {
    expect(emailNorm('  Priya.Fictional@Example.ORG\n')).toBe('priya.fictional@example.org');
    expect(emailNorm('ＡＤＡ@ｅｘａｍｐｌｅ.com')).toBe('ada@example.com');
    // A non-breaking space becomes a plain space under NFKC, then is trimmed.
    expect(emailNorm(' zoe@example.com ')).toBe('zoe@example.com');
    expect(emailNorm('ﬁnn@example.net')).toBe('finn@example.net');
  });

  it('validates what can be an address', () => {
    expect(isValidEmail('a@example.org')).toBe(true);
    for (const bad of ['N/A', 'a@b', 'a b@example.org', '@example.org', 'a@@example.org', ''])
      expect(isValidEmail(emailNorm(bad)), bad).toBe(false);
  });
});

describe('short codes and slugs', () => {
  it('derives an 8-character short code in the ticket alphabet, stable per id and salt', () => {
    const id = '0190f2a0-0000-7000-8000-000000000001';
    const c = shortCode(id);
    expect(c).toMatch(/^[2-9A-HJKMNP-TV-Z]{8}$/);
    expect([...c].every((ch) => SHORT_CODE_ALPHABET.includes(ch))).toBe(true);
    expect(shortCode(id)).toBe(c);
    expect(shortCode(id, 1)).not.toBe(c);
  });

  it('slugifies to the new schema’s slug format', () => {
    expect(slugify('Zoë’s Jazz Night — 2026!')).toBe('zoe-s-jazz-night-2026');
    expect(slugify('***')).toBe('event');
    expect(slugify('a'.repeat(80), 60)).toHaveLength(60);
    expect(slugify('ends-with-dash-', 14)).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
  });
});

describe('time rules (platform wall clock, DST, check-ins)', () => {
  const NY = 'America/New_York';

  it('converts an ordinary wall-clock time', () => {
    const r = wallToInstant('2026-07-04 19:30:00', NY);
    expect(r).toEqual({ ms: Date.parse('2026-07-04T23:30:00Z'), kind: 'ok' });
    expect(wallClock(r.ms, NY)).toBe('2026-07-04 19:30:00');
  });

  it('takes the later instant in a DST fall-back fold (as Postgres does) and says so', () => {
    const r = wallToInstant('2025-11-02 01:30:00', NY);
    expect(r.kind).toBe('fold');
    expect(new Date(r.ms).toISOString()).toBe('2025-11-02T06:30:00.000Z');
  });

  it('uses the offset before the transition inside a spring-forward gap (as Postgres does)', () => {
    const r = wallToInstant('2026-03-08 02:30:00', NY);
    expect(r.kind).toBe('gap');
    expect(new Date(r.ms).toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  it('handles zones without DST and other DST dates', () => {
    expect(wallToInstant('2025-11-02 01:30:00', 'America/Phoenix').kind).toBe('ok');
    expect(wallToInstant('2025-11-02 01:30:00', 'America/Chicago').kind).toBe('fold');
    expect(wallToInstant('2025-03-30 01:30:00', 'Europe/London').kind).toBe('gap');
  });

  it('combines a check-in UTC time with the regional scan day', () => {
    // 21:30 in New York on June 10 is 01:30 UTC on June 11.
    expect(new Date(checkinInstant('2026-06-10', '01:30:00', NY)).toISOString()).toBe(
      '2026-06-11T01:30:00.000Z',
    );
    // Midday: same UTC date.
    expect(new Date(checkinInstant('2026-06-10', '16:00:00', NY)).toISOString()).toBe(
      '2026-06-10T16:00:00.000Z',
    );
    // East of UTC: 08:30 in Tokyo on June 10 is 23:30 UTC on June 9.
    expect(new Date(checkinInstant('2026-06-10', '23:30:00', 'Asia/Tokyo')).toISOString()).toBe(
      '2026-06-09T23:30:00.000Z',
    );
    // Fall-back night in New York: 05:30 UTC is 01:30 EDT on Nov 2 (first pass of the fold).
    const fold = checkinInstant('2025-11-02', '05:30:00', NY);
    expect(localDate(fold, NY)).toBe('2025-11-02');
  });

  it('derives the venue timezone from country and state, falling back to the platform zone', () => {
    expect(venueTimezone({ country: 'US', state: 'IL' }, NY)).toEqual({
      tz: 'America/Chicago',
      derived: true,
    });
    expect(venueTimezone({ country: 'US', state: 'Texas' }, NY).tz).toBe('America/Chicago');
    expect(venueTimezone({ country: 'US', state: 'az' }, NY).tz).toBe('America/Phoenix');
    expect(venueTimezone({ country: 'GB', state: '' }, NY).tz).toBe('Europe/London');
    expect(venueTimezone({ country: 'US', state: 'Atlantis' }, NY)).toEqual({ tz: NY, derived: false });
  });
});

describe('staging types (roadmap §7.5 type rules)', () => {
  it('maps MySQL column types', () => {
    const t = (line: string) => mapColumn(line)?.pgType;
    expect(t('`checked_in` tinyint(1) NOT NULL')).toBe('smallint');
    expect(t('`id` int unsigned NOT NULL AUTO_INCREMENT')).toBe('bigint');
    expect(t('`id` bigint unsigned NOT NULL')).toBe('bigint');
    expect(t('`price` decimal(10,2) unsigned NOT NULL')).toBe('numeric(10,2)');
    expect(t('`reward` double(10,2) DEFAULT NULL')).toBe('double precision');
    expect(t('`created_at` timestamp NULL DEFAULT NULL')).toBe('timestamp without time zone');
    expect(t('`checked_in_time` datetime DEFAULT NULL')).toBe('timestamp without time zone');
    expect(t('`access_dates` json DEFAULT NULL')).toBe('jsonb');
    expect(t('`body` mediumtext COLLATE utf8mb4_unicode_ci')).toBe('text');
    expect(t("`status` enum('ACTIVE','INACTIVE') NOT NULL")).toBe('text');
    expect(t('PRIMARY KEY (`id`)')).toBeUndefined();
    expect(
      parseCreate(
        'CREATE TABLE `t` (\n  `a` int,\n  `b` date,\n  PRIMARY KEY (`a`)\n) ENGINE=InnoDB;',
      )?.columns.map((c) => c.name),
    ).toEqual(['a', 'b']);
  });

  it('turns zero dates into null and quarantines impossible values', () => {
    const col = (line: string) => mapColumn(line) as NonNullable<ReturnType<typeof mapColumn>>;
    const date = col('`d` date');
    const ts = col('`t` datetime');
    const time = col('`c` time');
    const json = col('`j` json');
    const int = col('`i` int');
    const s = (value: string) => ({ kind: 'str', value }) as const;
    expect(convertValue(s('0000-00-00'), date)).toEqual({ value: null });
    expect(convertValue(s('0000-00-00 00:00:00'), ts)).toEqual({ value: null });
    expect(convertValue(s('2024-02-30'), date)).toEqual({ value: null, issue: 'invalid_date' });
    expect(convertValue(s('2024-02-29 23:59:59'), ts)).toEqual({ value: '2024-02-29 23:59:59' });
    expect(convertValue(s('838:59:59'), time)).toEqual({ value: null, issue: 'invalid_time' });
    expect(convertValue(s('{"a":1}'), json)).toEqual({ value: '{"a":1}' });
    expect(convertValue(s('{"a":'), json)).toEqual({ value: null, issue: 'invalid_json' });
    expect(convertValue({ kind: 'num', raw: '12' }, int)).toEqual({ value: '12' });
    expect(convertValue(s('twelve'), int)).toEqual({ value: null, issue: 'invalid_number' });
    expect(convertValue({ kind: 'null' }, int)).toEqual({ value: null });
  });
});

describe('order grouping and exact money split', () => {
  it('groups by (common_order, event, buyer)', () => {
    const rows = [
      { id: 1, common_order: '172500000012345', event_id: 7, customer_id: 3 },
      { id: 2, common_order: '172500000012345', event_id: 7, customer_id: 3 },
      { id: 3, common_order: '172500000099999', event_id: 7, customer_id: 3 },
      // A colliding common_order for another buyer is another order.
      { id: 4, common_order: '172500000012345', event_id: 7, customer_id: 9 },
    ];
    const groups = new Map<string, number[]>();
    for (const r of rows) groups.set(orderKey(r), [...(groups.get(orderKey(r)) ?? []), r.id]);
    expect([...groups.values()]).toEqual([[1, 2], [3], [4]]);
  });

  it('keeps a row whole when it divides, else splits off one remainder unit — always exact', () => {
    expect(splitRow(rowTotals({ price: 3000, net: 3150, reward: 0, earning: 2898 }), 3)).toEqual([
      { face: 1000, discount: 0, fee: 50, allIn: 1050, organizerNet: 966, quantity: 3 },
    ]);
    const parts = splitRow(rowTotals({ price: 3000, net: 2900, reward: 250, earning: 2760 }), 3);
    expect(parts).toHaveLength(2);
    for (const k of ['face', 'discount', 'fee', 'allIn', 'organizerNet'] as const) {
      const total = parts.reduce((a, p) => a + p[k] * p.quantity, 0);
      expect(total, k).toBe({ face: 3000, discount: 250, fee: 150, allIn: 2900, organizerNet: 2760 }[k]);
    }
    expect(parts.map((p) => p.quantity)).toEqual([2, 1]);
    expect(() => splitRow(rowTotals({ price: 1, net: 1, reward: 0, earning: 1 }), 0)).toThrow();
  });

  it('treats net − price + reward as the fee added on top, never negative', () => {
    expect(rowTotals({ price: 5000, net: 5250, reward: 0, earning: null }).fee).toBe(250);
    expect(rowTotals({ price: 5000, net: 4250, reward: 750, earning: null }).fee).toBe(0);
    expect(rowTotals({ price: 5000, net: 4900, reward: 0, earning: null }).fee).toBe(0);
  });
});
