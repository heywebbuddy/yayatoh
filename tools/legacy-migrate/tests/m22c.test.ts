import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { placedSeats } from '@yayatoh/floorplan';
import {
  isInsert,
  parseCreateTable,
  parseInsert,
  type SqlValue,
  StatementSplitter,
} from '@yayatoh/legacy-mask';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mapCategory, seriesKey, seriesName } from '../src/categories.ts';
import { diffExchange, diffJson, explain, FACADE_STATUS, readHar } from '../src/facade-diff.ts';
import { GOLDEN_QUERIES } from '../src/golden.ts';
import { legacySeatUuid, SEAT_NAMESPACE, uuidv5 } from '../src/ids.ts';
import { CM_PER_PX, convertChart, type LegacySeat, mergeCharts, parseCoordinates } from '../src/seatchart.ts';
import {
  generateDumpFile,
  type SynthSummary,
  synthAccessTokenPlain,
  synthMagicToken,
} from '../src/synth/generate.ts';

/** M2.2c pure rules: seat charts, categories, series, the facade harness and the new synthetic tables. */
const seat = (id: number, name: string, coordinates: string, over: Partial<LegacySeat> = {}): LegacySeat => ({
  id,
  name,
  coordinates,
  capacity: 1,
  status: 1,
  width: '20',
  height: '20',
  ...over,
});

describe('ids', () => {
  it('uuidv5 matches the RFC 4122 vector and seat ids follow the roadmap formula', () => {
    // RFC 4122 / Python uuid.uuid5(NAMESPACE_DNS, 'www.example.com').
    expect(uuidv5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
    expect(legacySeatUuid('yay', 17)).toBe(uuidv5(SEAT_NAMESPACE, 'yay:seat:17'));
    expect(legacySeatUuid('yay', 17, 3)).toBe(uuidv5(SEAT_NAMESPACE, 'yay:seat:17:3'));
    expect(legacySeatUuid('abc', 17)).not.toBe(legacySeatUuid('yay', 17));
  });
});

describe('seat charts → floor plans', () => {
  it('reads "Xpx,Ypx", "X,Y" and the older {left, top}', () => {
    expect(parseCoordinates('120px,48px')).toEqual({ x: 120, y: 48 });
    expect(parseCoordinates(' 12.5 , 7 ')).toEqual({ x: 12.5, y: 7 });
    expect(parseCoordinates('{"left":300,"top":420}')).toEqual({ x: 300, y: 420 });
    expect(parseCoordinates('{"left":"a"}')).toBeNull();
    expect(parseCoordinates('nowhere')).toBeNull();
  });

  const chart = {
    id: 9,
    image: 'seatcharts/gala.png',
    label: 'Gala Seat',
    seats: [
      seat(1, 'A1', '40px,60px'),
      seat(2, 'A2', '76px,60px'),
      seat(3, 'A3', '{"left":112,"top":60}', { status: 0 }),
      seat(4, 'B1', '40px,100px'),
      seat(5, 'T1', '520px,80px', { capacity: 8, width: '60', height: '60' }),
      seat(6, 'Stage left', 'garbage'),
    ],
  };

  it('keeps every seat at its legacy spot in centimetres, rows by letter, a table per capacity', () => {
    const c = convertChart('yay', chart);
    const rows = c.doc.items.filter((i) => i.kind === 'row');
    const tables = c.doc.items.filter((i) => i.kind === 'table');
    expect(rows.map((r) => r.label).sort()).toEqual(['A', 'B', 'Gala Seat']);
    expect(tables).toHaveLength(1);
    expect(tables[0]?.kind === 'table' && tables[0].seats).toHaveLength(8);
    const placed = new Map(placedSeats(c.doc).map((p) => [p.seatId, p]));
    // A1's centre: (40 + 10, 60 + 10) px → cm.
    expect(placed.get(legacySeatUuid('yay', 1))).toMatchObject({
      x: Math.round(50 * CM_PER_PX),
      y: Math.round(70 * CM_PER_PX),
    });
    expect(placed.get(legacySeatUuid('yay', 3))).toMatchObject({ x: Math.round(122 * CM_PER_PX) });
    // The table's places keep deterministic ids; place 1 is the seat's own id.
    expect(c.places.get(5)?.[0]).toBe(legacySeatUuid('yay', 5));
    expect(c.places.get(5)).toHaveLength(8);
    expect(c.disabled.has(3)).toBe(true);
    expect(c.unreadable).toEqual([6]);
    // The underlay is the chart image under the media path, covering the canvas.
    expect(c.doc.underlay).toMatchObject({ url: 'legacy/yay/storage/seatcharts/gala.png', x: 0, y: 0 });
    expect(c.doc.width).toBeGreaterThanOrEqual(Math.round((520 + 60 + 30) * CM_PER_PX));
  });

  it('is deterministic, and scales to the image’s natural size when the media manifest knows it', () => {
    const a = convertChart('yay', chart);
    const b = convertChart('yay', chart);
    expect(a.checksum).toBe(b.checksum);
    expect(createHash('sha256').update(JSON.stringify(a.doc)).digest('hex')).toBe(
      createHash('sha256').update(JSON.stringify(b.doc)).digest('hex'),
    );
    const big = convertChart('yay', { ...chart, natural: { width: 1600, height: 900 } });
    expect(big.doc.width).toBe(1600 * CM_PER_PX);
    expect(big.doc.underlay?.height).toBe(900 * CM_PER_PX);
  });

  it('puts several charts of one event into one plan, one section each', () => {
    const one = convertChart('yay', chart);
    const two = convertChart('yay', {
      ...chart,
      id: 10,
      label: 'Balcony',
      seats: chart.seats.map((s) => ({ ...s, id: s.id + 100 })),
    });
    const doc = mergeCharts('yay', 'event-1', [
      { label: 'Gala Seat', converted: one },
      { label: 'Balcony', converted: two },
    ]);
    expect(doc.sections.map((s) => s.label)).toEqual(['Gala Seat', 'Balcony']);
    expect(doc.underlay).toBeNull();
    expect(placedSeats(doc)).toHaveLength(placedSeats(one.doc).length * 2);
    expect(mergeCharts('yay', 'event-1', [{ label: 'Gala Seat', converted: one }])).toBe(one.doc);
  });
});

describe('categories and series', () => {
  it('maps legacy categories to the platform taxonomy, else other', () => {
    expect(mapCategory('Music')).toEqual({ category: 'music', matched: true });
    expect(mapCategory('Business')).toEqual({ category: 'business_seminars', matched: true });
    expect(mapCategory('Arts')).toEqual({ category: 'arts_culture', matched: true });
    expect(mapCategory('Community')).toEqual({ category: 'community', matched: true });
    expect(mapCategory('Hackathons')).toEqual({ category: 'technology', matched: true });
    expect(mapCategory('Miscellany')).toEqual({ category: 'other', matched: false });
  });

  it('groups titles across years without the year, ordinals or “annual”', () => {
    expect(seriesKey('Harbor Winter Gala 2024')).toBe(seriesKey('Harbor Winter Gala 2025'));
    expect(seriesKey('5th Annual Harbor Gala – 2023')).toBe('harbor gala');
    expect(seriesKey('Harbor Gala')).not.toBe(seriesKey('Harbor Winter Gala'));
    expect(seriesName('Harbor Winter Gala 2025')).toBe('Harbor Winter Gala');
    expect(seriesName('2025')).toBe('2025');
  });
});

describe('facade twin diff harness (V8)', () => {
  it('is type-strict and ignores key order', () => {
    expect(diffJson({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toEqual([]);
    expect(diffJson({ id: 1 }, { id: '1' })).toEqual([
      { path: '$.id', kind: 'type', legacy: 1, facade: '1' },
    ]);
    expect(diffJson({ a: [1] }, { a: [1, 2], b: null }).map((d) => d.kind)).toEqual(['extra', 'extra']);
    expect(diffJson({ a: 1 }, {})[0]?.kind).toBe('missing');
  });

  it('explains differences only through the quirks ledger', () => {
    const diffs = diffJson({ data: [{ id: 1, at: 'x' }] }, { data: [{ id: 1, at: 'y' }] });
    const r = explain(diffs, [{ path: '$.data[*].at', kinds: ['value'], reason: 'timestamps differ' }]);
    expect(r.unexplained).toEqual([]);
    expect(r.explained[0]?.reason).toBe('timestamps differ');
    expect(explain(diffs, [{ path: '$.data[*].id', reason: 'x' }]).unexplained).toHaveLength(1);
  });

  it('reads /api/v2 exchanges from a HAR and compares status and body', () => {
    const har = {
      log: {
        entries: [
          {
            request: { method: 'get', url: 'https://yayatoh.com/api/v2/events?page=1' },
            response: { status: 200, content: { mimeType: 'application/json', text: '{"data":[]}' } },
          },
          { request: { method: 'GET', url: 'https://yayatoh.com/' }, response: { status: 200 } },
        ],
      },
    };
    const [x] = readHar(har);
    expect(x).toEqual({ method: 'GET', path: '/api/v2/events?page=1', status: 200, body: { data: [] } });
    if (!x) throw new Error('no exchange');
    expect(diffExchange(x, { ...x, status: 500 })[0]?.kind).toBe('status');
    expect(FACADE_STATUS.built).toBe(false);
  });
});

describe('golden queries (V7)', () => {
  it('have unique ids and compare both sides', () => {
    expect(new Set(GOLDEN_QUERIES.map((g) => g.id)).size).toBe(GOLDEN_QUERIES.length);
    expect(GOLDEN_QUERIES.length).toBeGreaterThanOrEqual(12);
    for (const g of GOLDEN_QUERIES) {
      expect(g.sql).toContain('as legacy');
      expect(g.sql).toContain('{s}.');
    }
  });
});

// --- the synthetic generator's M2.2c tables ------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'synth-m22c-'));
let summary: SynthSummary;
let rows: Map<string, Record<string, string | null>[]>;

function rowsOf(text: string): Map<string, Record<string, string | null>[]> {
  const stmts = new StatementSplitter().push(text);
  const cols = new Map<string, string[]>();
  const out = new Map<string, Record<string, string | null>[]>();
  const val = (v: SqlValue) => (v.kind === 'null' ? null : v.kind === 'str' ? v.value : v.raw);
  for (const st of stmts) {
    const def = parseCreateTable(st);
    if (def)
      cols.set(
        def.name,
        def.columns.map((c) => c.name),
      );
    else if (isInsert(st)) {
      const ins = parseInsert(st);
      const names = cols.get(ins.table) ?? [];
      const list = out.get(ins.table) ?? [];
      for (const r of ins.rows)
        list.push(Object.fromEntries(names.map((n, i) => [n, val(r[i] ?? { kind: 'null' })])));
      out.set(ins.table, list);
    }
  }
  return out;
}

beforeAll(async () => {
  const path = join(dir, 'yay.sql');
  summary = await generateDumpFile(path, { instance: 'yay', scale: 'small', demo: true });
  rows = rowsOf(readFileSync(path, 'utf8'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('synthetic legacy generator (M2.2c tables)', () => {
  it('writes venues, seat charts, tokens, the newsletter and notifications', () => {
    for (const t of [
      'venues',
      'event_venue',
      'seatcharts',
      'seats',
      'personal_access_tokens',
      'password_resets',
      'newsletter_subscribers',
      'notifications',
    ])
      expect(rows.get(t)?.length ?? 0, t).toBeGreaterThan(0);
    expect(summary.facts.seatCharts.some((c) => c.repetitive)).toBe(true);
    expect(summary.facts.seriesGroups[0]).toHaveLength(2);
  });

  it('seats attendees on existing, switched-on seats, within each seat’s capacity per date', () => {
    const seats = new Map((rows.get('seats') ?? []).map((s) => [s.id, s]));
    const perSeat = new Map<string, number>();
    for (const a of rows.get('attendees') ?? []) {
      if (!a.seat_id) continue;
      const s = seats.get(a.seat_id);
      expect(s, `seat ${a.seat_id}`).toBeDefined();
      expect(s?.status).toBe('1');
      const k = `${a.seat_id}|${a.event_date}`;
      perSeat.set(k, (perSeat.get(k) ?? 0) + 1);
      expect(perSeat.get(k)).toBeLessThanOrEqual(Number(s?.capacity));
    }
    expect(perSeat.size).toBeGreaterThan(0);
  });

  it('stores Sanctum hashes of the plain tokens, plain magic tokens, and one orphan token', () => {
    const pats = new Map((rows.get('personal_access_tokens') ?? []).map((p) => [Number(p.id), p]));
    for (const t of summary.facts.accessTokens) {
      expect(t.plain).toBe(synthAccessTokenPlain('yay', t.id));
      expect(pats.get(t.id)?.token).toBe(createHash('sha256').update(t.plain).digest('hex'));
    }
    expect(summary.facts.accessTokens.filter((t) => t.orphan)).toHaveLength(1);
    const users = new Map((rows.get('users') ?? []).map((u) => [Number(u.id), u]));
    for (const m of summary.facts.magicTokens) {
      expect(m.token).toBe(synthMagicToken('yay', m.userId));
      expect(users.get(m.userId)?.magic_login_token).toBe(m.token);
    }
  });

  it('plants a guest password in one notification (it must never be migrated)', () => {
    expect((rows.get('notifications') ?? []).some((n) => n.data?.includes('invented-guest-password'))).toBe(
      true,
    );
    expect(summary.facts.newsletter.some((n) => n.email === 'not-an-email')).toBe(true);
  });
});
