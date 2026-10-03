/**
 * Cards and exports (M4.3b), pure: what is printed from a chart's guest seating, and how cards
 * sit on a sheet of paper. Shared by the PDF document, the CSV/XLSX exports and the browser.
 *
 * - **Place cards:** one per seated guest (a tent card folded across the middle: the name on
 *   both faces, so it reads from both sides of the table).
 * - **Escort cards:** one per party per table ("The Garcia Family — Table 3"), laid out flat
 *   for the entrance.
 * - **Table cards:** one per table or row of the chart, a sheet folded across the middle.
 *
 * Guests who declined are never printed and never counted for the caterer (they stay in the
 * seating chart export, flagged, so the host can see and fix them).
 */

import type { OccupantStatus } from './guest-seating.ts';

export const CARD_KINDS = ['place', 'escort', 'table'] as const;
export type CardKind = (typeof CARD_KINDS)[number];
export const isCardKind = (v: string): v is CardKind => (CARD_KINDS as readonly string[]).includes(v);

/** Common paper sizes, portrait, in millimetres. */
export const PAPER_SIZES = ['a4', 'letter', 'a5', 'legal'] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];
export const isPaperSize = (v: string): v is PaperSize => (PAPER_SIZES as readonly string[]).includes(v);

export const PAPER: Readonly<Record<PaperSize, { readonly widthMm: number; readonly heightMm: number }>> = {
  a4: { widthMm: 210, heightMm: 297 },
  letter: { widthMm: 215.9, heightMm: 279.4 },
  a5: { widthMm: 148, heightMm: 210 },
  legal: { widthMm: 215.9, heightMm: 355.6 },
};

/** The paper a locale's printers usually hold: Letter in the Americas, A4 elsewhere. */
export const defaultPaper = (region: string | null): PaperSize =>
  region && ['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT'].includes(region.toUpperCase()) ? 'letter' : 'a4';

/** Margin kept clear on every sheet (most office printers can't print closer to the edge). */
export const SHEET_MARGIN_MM = 10;

/**
 * One card, unfolded, in millimetres. A place card is a 90 × 50 mm tent (100 mm flat); an escort
 * card is 3.5 × 2 in; a table card is the whole printable sheet, folded across the middle.
 */
export function cardSizeMm(kind: CardKind, paper: PaperSize): { widthMm: number; heightMm: number } {
  if (kind === 'place') return { widthMm: 90, heightMm: 100 };
  if (kind === 'escort') return { widthMm: 88.9, heightMm: 50.8 };
  const p = PAPER[paper];
  return { widthMm: p.widthMm - 2 * SHEET_MARGIN_MM, heightMm: p.heightMm - 2 * SHEET_MARGIN_MM };
}

/** Whether the card is folded across the middle (its top half printed upside down). */
export const isTent = (kind: CardKind) => kind !== 'escort';

export interface SheetLayout {
  readonly paper: PaperSize;
  readonly kind: CardKind;
  readonly cols: number;
  readonly rows: number;
  readonly perPage: number;
  readonly cardWidthMm: number;
  readonly cardHeightMm: number;
  /** Top-left corner of each slot on the page, in reading order (right to left in RTL). */
  readonly slots: readonly { readonly x: number; readonly y: number }[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * How cards of a kind sit on a sheet: as many as fit inside the margins, butted together so one
 * cut serves two cards, the grid centred on the page. In a right-to-left language the first card
 * of a row is the right-most one.
 */
export function sheetLayout(kind: CardKind, paper: PaperSize, dir: 'ltr' | 'rtl' = 'ltr'): SheetLayout {
  const p = PAPER[paper];
  const c = cardSizeMm(kind, paper);
  const cols = Math.max(1, Math.floor((p.widthMm - 2 * SHEET_MARGIN_MM + 0.001) / c.widthMm));
  const rows = Math.max(1, Math.floor((p.heightMm - 2 * SHEET_MARGIN_MM + 0.001) / c.heightMm));
  const left = (p.widthMm - cols * c.widthMm) / 2;
  const top = (p.heightMm - rows * c.heightMm) / 2;
  const slots: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++)
    for (let i = 0; i < cols; i++) {
      const col = dir === 'rtl' ? cols - 1 - i : i;
      slots.push({ x: round2(left + col * c.widthMm), y: round2(top + r * c.heightMm) });
    }
  return {
    paper,
    kind,
    cols,
    rows,
    perPage: cols * rows,
    cardWidthMm: c.widthMm,
    cardHeightMm: c.heightMm,
    slots,
  };
}

/** Split cards into pages of `perPage`. */
export function paginate<T>(items: readonly T[], perPage: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  return pages;
}

/* ---------------------------------------------------------------- the seating sheet ---- */

/** The parts of the guest seating view (`seating.guestSeating`) cards and exports read. */
export interface SeatingViewLike {
  readonly places: readonly {
    readonly itemId: string;
    readonly kind: 'table' | 'row';
    readonly label: string;
    readonly capacity: number;
    readonly vip: boolean;
    readonly sponsor: string | null;
  }[];
  readonly parties: readonly {
    readonly id: string;
    readonly name: string;
    readonly guests: readonly {
      readonly id: string;
      readonly kind: 'guest' | 'plus_one';
      readonly name: string | null;
      readonly guestOf: string | null;
      readonly ageClass: 'adult' | 'child' | 'infant';
      readonly meal: string | null;
      readonly status: OccupantStatus;
      readonly itemId: string | null;
    }[];
  }[];
}

export interface SheetGuest {
  readonly id: string;
  /** The guest's name, or null for a plus-one not named yet (then `guestOf`). */
  readonly name: string | null;
  readonly guestOf: string | null;
  readonly partyId: string;
  readonly party: string;
  readonly ageClass: 'adult' | 'child' | 'infant';
  readonly meal: string | null;
  readonly status: OccupantStatus;
}

export interface SheetPlace {
  readonly itemId: string;
  readonly kind: 'table' | 'row';
  readonly label: string;
  readonly capacity: number;
  readonly vip: boolean;
  readonly sponsor: string | null;
  readonly guests: readonly SheetGuest[];
}

export interface SeatingSheet {
  readonly places: readonly SheetPlace[];
  /** Guests who are coming or haven't answered, with no place on this chart yet. */
  readonly unseated: readonly SheetGuest[];
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * The chart by table: places in natural label order ("Table 2" before "Table 10"), each with its
 * guests by party (the party's own order inside it, plus-ones after their host).
 */
export function seatingSheet(view: SeatingViewLike): SeatingSheet {
  const parties = [...view.parties].sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
  const guests = parties.flatMap((p) =>
    p.guests.map((g) => ({
      itemId: g.itemId,
      guest: {
        id: g.id,
        name: g.name,
        guestOf: g.guestOf,
        partyId: p.id,
        party: p.name,
        ageClass: g.ageClass,
        meal: g.meal?.trim() ? g.meal.trim() : null,
        status: g.status,
      } satisfies SheetGuest,
    })),
  );
  const places = [...view.places]
    .sort((a, b) => collator.compare(a.label, b.label) || a.itemId.localeCompare(b.itemId))
    .map((p) => ({
      itemId: p.itemId,
      kind: p.kind,
      label: p.label,
      capacity: p.capacity,
      vip: p.vip,
      sponsor: p.sponsor,
      guests: guests.filter((g) => g.itemId === p.itemId).map((g) => g.guest),
    }));
  const placed = new Set(places.map((p) => p.itemId));
  const unseated = guests
    .filter((g) => !(g.itemId && placed.has(g.itemId)) && g.guest.status !== 'declined')
    .map((g) => g.guest);
  return { places, unseated };
}

const coming = (g: SheetGuest) => g.status !== 'declined';

/* ----------------------------------------------------------------------- the cards ---- */

export interface PlaceCard {
  readonly name: string | null;
  readonly guestOf: string | null;
  readonly place: string;
}

export interface EscortCard {
  readonly party: string;
  readonly names: readonly { readonly name: string | null; readonly guestOf: string | null }[];
  readonly place: string;
}

export interface TableCard {
  readonly place: string;
  readonly sponsor: string | null;
}

export type CardsOf = {
  readonly place: PlaceCard;
  readonly escort: EscortCard;
  readonly table: TableCard;
};

/** A place card for every seated guest who is coming, table by table. */
export const placeCards = (sheet: SeatingSheet): PlaceCard[] =>
  sheet.places.flatMap((p) =>
    p.guests.filter(coming).map((g) => ({ name: g.name, guestOf: g.guestOf, place: p.label })),
  );

/**
 * An escort card per party per table (a party split over two tables gets two), sorted by party
 * name so guests find theirs alphabetically at the entrance.
 */
export function escortCards(sheet: SeatingSheet): EscortCard[] {
  const cards: (EscortCard & { partyId: string; order: number })[] = [];
  sheet.places.forEach((p, order) => {
    const byParty = new Map<string, SheetGuest[]>();
    for (const g of p.guests.filter(coming)) byParty.set(g.partyId, [...(byParty.get(g.partyId) ?? []), g]);
    for (const [partyId, gs] of byParty)
      cards.push({
        partyId,
        order,
        party: gs[0]?.party ?? '',
        names: gs.map((g) => ({ name: g.name, guestOf: g.guestOf })),
        place: p.label,
      });
  });
  return cards
    .sort((a, b) => collator.compare(a.party, b.party) || a.partyId.localeCompare(b.partyId) || a.order - b.order)
    .map(({ party, names, place }) => ({ party, names, place }));
}

/** A table card for every table or row of the chart, in label order. */
export const tableCards = (sheet: SeatingSheet): TableCard[] =>
  sheet.places.map((p) => ({ place: p.label, sponsor: p.sponsor }));

export function cardsOf<K extends CardKind>(kind: K, sheet: SeatingSheet): CardsOf[K][] {
  if (kind === 'place') return placeCards(sheet) as CardsOf[K][];
  if (kind === 'escort') return escortCards(sheet) as CardsOf[K][];
  return tableCards(sheet) as CardsOf[K][];
}

/* ---------------------------------------------------------------------- meal counts ---- */

export interface MealCountRow {
  /** The place's label, or null for the guests not seated yet. */
  readonly place: string | null;
  /** Count per meal, in the order of `MealCounts.meals`. */
  readonly meals: readonly number[];
  /** Guests with no meal chosen. */
  readonly notChosen: number;
  readonly children: number;
  readonly infants: number;
  readonly total: number;
}

export interface MealCounts {
  /** Every meal chosen on this chart, alphabetically. */
  readonly meals: readonly string[];
  readonly rows: readonly MealCountRow[];
  readonly totals: MealCountRow;
}

/**
 * What the caterer needs, table by table: how many of each meal (and how many guests chose
 * none), with children and infants counted apart. Guests coming but not seated yet get their own
 * row so the totals are the whole count; declined guests are left out. Meals are grouped by their
 * trimmed text, case-insensitively (the first spelling met is kept).
 */
export function mealCounts(sheet: SeatingSheet): MealCounts {
  const spelling = new Map<string, string>();
  const key = (m: string) => m.toLocaleLowerCase('en');
  const all = [...sheet.places.flatMap((p) => p.guests), ...sheet.unseated].filter(coming);
  for (const g of all) if (g.meal && !spelling.has(key(g.meal))) spelling.set(key(g.meal), g.meal);
  const meals = [...spelling.values()].sort(collator.compare);
  const index = new Map(meals.map((m, i) => [key(m), i]));
  const row = (place: string | null, gs: readonly SheetGuest[]): MealCountRow => {
    const counts = meals.map(() => 0);
    let notChosen = 0;
    for (const g of gs) {
      const i = g.meal ? index.get(key(g.meal)) : undefined;
      if (i === undefined) notChosen++;
      else counts[i] = (counts[i] ?? 0) + 1;
    }
    return {
      place,
      meals: counts,
      notChosen,
      children: gs.filter((g) => g.ageClass === 'child').length,
      infants: gs.filter((g) => g.ageClass === 'infant').length,
      total: gs.length,
    };
  };
  const rows = sheet.places.map((p) => row(p.label, p.guests.filter(coming)));
  if (sheet.unseated.length) rows.push(row(null, sheet.unseated));
  const totals = row(null, all);
  return { meals, rows, totals };
}

/* -------------------------------------------------------------------- export tables ---- */

export const EXPORT_KINDS = ['chart', 'meals'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
export const isExportKind = (v: string): v is ExportKind => (EXPORT_KINDS as readonly string[]).includes(v);

export const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const isExportFormat = (v: string): v is ExportFormat =>
  (EXPORT_FORMATS as readonly string[]).includes(v);

/** The words an export's header and labels use, in the reader's language. */
export interface ExportCopy {
  readonly place: string;
  readonly guest: string;
  readonly party: string;
  readonly age: string;
  readonly meal: string;
  readonly reply: string;
  readonly ageClass: Readonly<Record<'adult' | 'child' | 'infant', string>>;
  readonly status: Readonly<Record<OccupantStatus, string>>;
  readonly notSeated: string;
  readonly notChosen: string;
  readonly children: string;
  readonly infants: string;
  readonly total: string;
  readonly guestOf: (name: string) => string;
}

export type ExportCell = string | number;

const nameOf = (g: { name: string | null; guestOf: string | null }, copy: { guestOf: (n: string) => string }) =>
  g.name ?? copy.guestOf(g.guestOf ?? '');

/**
 * The seating chart by table, one line per guest: place, guest, party, age, meal, reply. Guests
 * not seated yet come last under "Not seated".
 */
export function seatingChartTable(sheet: SeatingSheet, copy: ExportCopy): ExportCell[][] {
  const line = (place: string, g: SheetGuest): ExportCell[] => [
    place,
    nameOf(g, copy),
    g.party,
    copy.ageClass[g.ageClass],
    g.meal ?? '',
    copy.status[g.status],
  ];
  return [
    [copy.place, copy.guest, copy.party, copy.age, copy.meal, copy.reply],
    ...sheet.places.flatMap((p) => p.guests.map((g) => line(p.label, g))),
    ...sheet.unseated.map((g) => line(copy.notSeated, g)),
  ];
}

/** Meal counts as a table: a column per meal, then not chosen, children, infants and total. */
export function mealCountsTable(counts: MealCounts, copy: ExportCopy): ExportCell[][] {
  const line = (label: string, r: MealCountRow): ExportCell[] => [
    label,
    ...r.meals,
    r.notChosen,
    r.children,
    r.infants,
    r.total,
  ];
  return [
    [copy.place, ...counts.meals, copy.notChosen, copy.children, copy.infants, copy.total],
    ...counts.rows.map((r) => line(r.place ?? copy.notSeated, r)),
    line(copy.total, counts.totals),
  ];
}
