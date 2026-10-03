import { describe, expect, it } from 'vitest';
import {
  cardSizeMm,
  defaultPaper,
  type ExportCopy,
  escortCards,
  mealCounts,
  mealCountsTable,
  PAPER_SIZES,
  paginate,
  placeCards,
  seatingChartTable,
  seatingSheet,
  sheetLayout,
  tableCards,
} from '../src/index.ts';
import { WEDDING_VIEW } from './golden/cases.ts';

const sheet = seatingSheet(WEDDING_VIEW);

const COPY: ExportCopy = {
  place: 'Table',
  guest: 'Guest',
  party: 'Party',
  age: 'Age',
  meal: 'Meal',
  reply: 'Reply',
  ageClass: { adult: 'Adult', child: 'Child', infant: 'Infant' },
  status: { attending: 'Attending', pending: 'Awaiting reply', declined: 'Declined' },
  notSeated: 'Not seated',
  notChosen: 'Not chosen',
  children: 'Children',
  infants: 'Infants',
  total: 'Total',
  guestOf: (n) => `Guest of ${n}`,
};

describe('seating sheet (M4.3b)', () => {
  it('places in natural label order, guests by party; unseated guests who are coming', () => {
    expect(sheet.places.map((p) => p.label)).toEqual(['Table 1', 'Table 2', 'Table 10']);
    expect(sheet.places[0]?.guests.map((g) => g.name)).toEqual([
      'Ana García',
      'Luis García',
      'Sofía García',
      'عمر حداد',
    ]);
    expect(sheet.places[1]?.guests.map((g) => g.name ?? `+${g.guestOf}`)).toEqual([
      'Mei Chen',
      'Jun Chen',
      '+Jun Chen',
      'Kai Chen',
    ]);
    expect(sheet.places[2]?.guests.map((g) => g.name)).toEqual(['山田 花子', 'ليلى حداد']);
    expect(sheet.unseated.map((g) => g.name)).toEqual(['Taro Yamada']);
    expect(sheet.places[1]?.guests[1]?.meal).toBe('beef');
  });

  it('a place on a table the chart no longer has puts the guest back with the unseated', () => {
    const s = seatingSheet({ ...WEDDING_VIEW, places: WEDDING_VIEW.places.slice(1) });
    expect(s.places.map((p) => p.label)).toEqual(['Table 1', 'Table 2']);
    expect(s.unseated.map((g) => g.name)).toEqual(['山田 花子', 'Taro Yamada', 'ليلى حداد']);
  });
});

describe('cards (M4.3b)', () => {
  it('place cards: one per seated guest who is coming (declined guests are never printed)', () => {
    const cards = placeCards(sheet);
    expect(cards).toHaveLength(9);
    expect(cards.map((c) => c.name ?? `Guest of ${c.guestOf}`)).not.toContain('Kai Chen');
    expect(cards).toContainEqual({ name: null, guestOf: 'Jun Chen', place: 'Table 2' });
    expect(cards[0]).toEqual({ name: 'Ana García', guestOf: null, place: 'Table 1' });
  });

  it('escort cards: one per party per table, by party name', () => {
    const cards = escortCards(sheet);
    expect(cards.map((c) => `${c.party}@${c.place}`)).toEqual([
      'Chen@Table 2',
      'The García Family@Table 1',
      'Yamada@Table 10',
      'عائلة حداد@Table 1',
      'عائلة حداد@Table 10',
    ]);
    expect(cards[0]?.names).toEqual([
      { name: 'Mei Chen', guestOf: null },
      { name: 'Jun Chen', guestOf: null },
      { name: null, guestOf: 'Jun Chen' },
    ]);
  });

  it('table cards: every place of the chart, with its sponsor', () => {
    expect(tableCards(sheet)).toEqual([
      { place: 'Table 1', sponsor: null },
      { place: 'Table 2', sponsor: 'Rosewood Florals' },
      { place: 'Table 10', sponsor: null },
    ]);
  });
});

describe('sheet layout (M4.3b)', () => {
  it('fits cards inside 10 mm margins, centred, for every paper size', () => {
    for (const paper of PAPER_SIZES)
      for (const kind of ['place', 'escort', 'table'] as const) {
        const l = sheetLayout(kind, paper);
        expect(l.perPage).toBeGreaterThanOrEqual(1);
        expect(l.slots).toHaveLength(l.perPage);
        for (const s of l.slots) {
          expect(s.x).toBeGreaterThanOrEqual(10 - 0.01);
          expect(s.y).toBeGreaterThanOrEqual(10 - 0.01);
        }
      }
    const a4 = sheetLayout('place', 'a4');
    expect([a4.cols, a4.rows]).toEqual([2, 2]);
    expect(a4.slots).toEqual([
      { x: 15, y: 48.5 },
      { x: 105, y: 48.5 },
      { x: 15, y: 148.5 },
      { x: 105, y: 148.5 },
    ]);
    expect(sheetLayout('escort', 'letter').perPage).toBe(10);
    expect(sheetLayout('escort', 'a4').perPage).toBe(10);
    expect(sheetLayout('place', 'a5').perPage).toBe(1);
    expect(sheetLayout('table', 'legal').perPage).toBe(1);
    expect(cardSizeMm('table', 'letter')).toEqual({ widthMm: 195.9, heightMm: 259.4 });
  });

  it('right to left: the first card of a row is the right-most', () => {
    const rtl = sheetLayout('place', 'a4', 'rtl');
    expect(rtl.slots.slice(0, 2)).toEqual([
      { x: 105, y: 48.5 },
      { x: 15, y: 48.5 },
    ]);
  });

  it('paginates and picks Letter for the Americas, A4 elsewhere', () => {
    expect(paginate([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(paginate([], 4)).toEqual([]);
    expect(defaultPaper('US')).toBe('letter');
    expect(defaultPaper('ca')).toBe('letter');
    expect(defaultPaper('FR')).toBe('a4');
    expect(defaultPaper(null)).toBe('a4');
  });
});

describe('exports (M4.3b)', () => {
  it('meal counts per table: meals grouped case-insensitively, declined left out, unseated row, totals', () => {
    const m = mealCounts(sheet);
    expect(m.meals).toEqual(['Beef', 'Fish', 'Vegetarian']);
    expect(m.rows).toEqual([
      { place: 'Table 1', meals: [2, 1, 0], notChosen: 1, children: 1, infants: 0, total: 4 },
      { place: 'Table 2', meals: [1, 0, 1], notChosen: 1, children: 0, infants: 0, total: 3 },
      { place: 'Table 10', meals: [0, 1, 1], notChosen: 0, children: 0, infants: 0, total: 2 },
      { place: null, meals: [0, 0, 0], notChosen: 1, children: 0, infants: 0, total: 1 },
    ]);
    expect(m.totals).toEqual({
      place: null,
      meals: [3, 2, 2],
      notChosen: 3,
      children: 1,
      infants: 0,
      total: 10,
    });
  });

  it('meal counts table with headers in the reader’s words', () => {
    expect(mealCountsTable(mealCounts(sheet), COPY)).toEqual([
      ['Table', 'Beef', 'Fish', 'Vegetarian', 'Not chosen', 'Children', 'Infants', 'Total'],
      ['Table 1', 2, 1, 0, 1, 1, 0, 4],
      ['Table 2', 1, 0, 1, 1, 0, 0, 3],
      ['Table 10', 0, 1, 1, 0, 0, 0, 2],
      ['Not seated', 0, 0, 0, 1, 0, 0, 1],
      ['Total', 3, 2, 2, 3, 1, 0, 10],
    ]);
    const empty = mealCounts(seatingSheet({ places: [], parties: [] }));
    expect(mealCountsTable(empty, COPY)).toEqual([
      ['Table', 'Not chosen', 'Children', 'Infants', 'Total'],
      ['Total', 0, 0, 0, 0],
    ]);
  });

  it('seating chart by table: one line per guest, declined flagged, unseated last', () => {
    const t = seatingChartTable(sheet, COPY);
    expect(t[0]).toEqual(['Table', 'Guest', 'Party', 'Age', 'Meal', 'Reply']);
    expect(t[1]).toEqual(['Table 1', 'Ana García', 'The García Family', 'Adult', 'Beef', 'Attending']);
    expect(t[3]).toEqual(['Table 1', 'Sofía García', 'The García Family', 'Child', '', 'Attending']);
    expect(t).toContainEqual(['Table 2', 'Guest of Jun Chen', 'Chen', 'Adult', '', 'Awaiting reply']);
    expect(t).toContainEqual(['Table 2', 'Kai Chen', 'Chen', 'Adult', 'Fish', 'Declined']);
    expect(t.at(-1)).toEqual(['Not seated', 'Taro Yamada', 'Yamada', 'Adult', '', 'Awaiting reply']);
    expect(t).toHaveLength(1 + 10 + 1);
  });
});
