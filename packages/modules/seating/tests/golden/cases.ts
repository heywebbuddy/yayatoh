import type { SeatingViewLike } from '../../src/domain/cards.ts';
import {
  type CardKind,
  type CardsCopy,
  cardsHtml,
  cardsOf,
  type PaperSize,
  seatingSheet,
} from '../../src/index.ts';

/**
 * The fixture wedding for golden cards (M4.3b): Harper & Theo, 12 June 2027 in Los Angeles. Three
 * tables (natural order: "Table 2" before "Table 10"), a sponsored table, a party split over two
 * tables, an unnamed plus-one, a child, a guest who declined (never printed) and a guest not seated
 * yet, with Latin, Arabic and Japanese names. English and Arabic words are the app's own
 * (`apps/web/messages/{en,ar}.json`, `seating.cards.doc`).
 */
export const LANGS = ['en', 'ar'] as const;
export type Lang = (typeof LANGS)[number];

const id = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

export const WEDDING_VIEW: SeatingViewLike = {
  places: [
    { itemId: id(103), kind: 'table', label: 'Table 10', capacity: 8, vip: false, sponsor: null },
    { itemId: id(101), kind: 'table', label: 'Table 1', capacity: 8, vip: true, sponsor: null },
    {
      itemId: id(102),
      kind: 'table',
      label: 'Table 2',
      capacity: 8,
      vip: false,
      sponsor: 'Rosewood Florals',
    },
  ],
  parties: [
    {
      id: id(1),
      name: 'The García Family',
      guests: [
        g(11, 'Ana García', 'Beef', 'attending', id(101)),
        g(12, 'Luis García', 'Fish', 'attending', id(101)),
        { ...g(13, 'Sofía García', null, 'attending', id(101)), ageClass: 'child' },
      ],
    },
    {
      id: id(2),
      name: 'Chen',
      guests: [
        g(21, 'Mei Chen', 'Vegetarian', 'attending', id(102)),
        g(22, 'Jun Chen', 'beef ', 'attending', id(102)),
        { ...g(23, null, null, 'pending', id(102)), kind: 'plus_one', guestOf: 'Jun Chen' },
        g(24, 'Kai Chen', 'Fish', 'declined', id(102)),
      ],
    },
    {
      id: id(3),
      name: 'عائلة حداد',
      guests: [
        g(31, 'ليلى حداد', 'Fish', 'attending', id(103)),
        g(32, 'عمر حداد', 'Beef', 'attending', id(101)),
      ],
    },
    {
      id: id(4),
      name: 'Yamada',
      guests: [
        g(41, '山田 花子', 'Vegetarian', 'attending', id(103)),
        g(42, 'Taro Yamada', null, 'pending', null),
      ],
    },
  ],
};

function g(
  n: number,
  name: string | null,
  meal: string | null,
  status: 'attending' | 'pending' | 'declined',
  itemId: string | null,
) {
  return {
    id: id(n),
    kind: 'guest' as const,
    name,
    guestOf: null,
    ageClass: 'adult' as const,
    meal,
    status,
    itemId,
  };
}

export const EVENT = {
  name: 'Harper & Theo',
  startsAt: new Date('2027-06-12T23:00:00Z'),
  timeZone: 'America/Los_Angeles',
};

const TITLES: Record<Lang, Record<CardKind, string>> = {
  en: { place: 'Place cards', escort: 'Escort cards', table: 'Table cards' },
  ar: { place: 'بطاقات الأماكن', escort: 'بطاقات الإرشاد', table: 'بطاقات الطاولات' },
};

export const COPY = (lang: Lang, kind: CardKind): CardsCopy =>
  lang === 'ar'
    ? {
        title: TITLES.ar[kind],
        yourTable: 'طاولتك',
        guestOf: (name) => `ضيف ${name}`,
        hostedBy: (name) => `باستضافة ${name}`,
      }
    : {
        title: TITLES.en[kind],
        yourTable: 'Your table',
        guestOf: (name) => `Guest of ${name}`,
        hostedBy: (name) => `Hosted by ${name}`,
      };

/** Each card kind on a different common paper size. */
export const GOLDEN_CASES: Record<string, { kind: CardKind; paper: PaperSize }> = {
  'place-a4': { kind: 'place', paper: 'a4' },
  'escort-letter': { kind: 'escort', paper: 'letter' },
  'table-a5': { kind: 'table', paper: 'a5' },
};

export function goldenHtml(name: string, lang: Lang): string {
  const c = GOLDEN_CASES[name];
  if (!c) throw new Error(name);
  return cardsHtml({
    kind: c.kind,
    paper: c.paper,
    lang,
    dir: lang === 'ar' ? 'rtl' : 'ltr',
    copy: COPY(lang, c.kind),
    event: EVENT,
    cards: cardsOf(c.kind, seatingSheet(WEDDING_VIEW)),
  });
}
