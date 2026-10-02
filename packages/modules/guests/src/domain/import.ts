import type { AgeClass } from '../schema.ts';
import { fullName, normalizeTags } from './guests.ts';

/**
 * Guest-list import (M4.1b): the pure part. Column guessing on headers in the 13 console
 * languages, reading one row through the host's mapping, and grouping rows into parties by a
 * household column. The limits of M4.1a apply to whole parties: a party that can't be imported
 * whole is rejected whole, never half of it.
 */

export const GUEST_IMPORT_FIELDS = [
  'party',
  'fullName',
  'firstName',
  'lastName',
  'ageClass',
  'meal',
  'side',
  'vip',
  'tags',
  'email',
  'phone',
  'dietary',
  'accessibility',
  'address',
  'plusOne',
] as const;
export type GuestImportField = (typeof GUEST_IMPORT_FIELDS)[number];
/** field → 0-based column index. */
export type GuestMapping = Partial<Record<GuestImportField, number>>;

/** Why a row is not imported (shown to the host, and in the rejected-rows file). */
export const GUEST_IMPORT_REJECTIONS = [
  'missing_name',
  'name_too_long',
  'value_too_long',
  'invalid_age',
  'invalid_email',
  'invalid_phone',
  'too_many_tags',
  'plus_one_without_guest',
  'duplicate_in_file',
  /** The party would have more than 20 guests (plus-ones count). */
  'party_too_large',
  /** Another row of the same party has a problem; the party is imported whole or not at all. */
  'party_has_errors',
  /** The event already has a party with this name. */
  'party_exists',
  /** The event's party or guest limit would be passed. */
  'event_full',
] as const;
export type GuestImportRejection = (typeof GUEST_IMPORT_REJECTIONS)[number];

/* ---------------------------------------------------------------------------- guessing ---- */

/** Lower case, accents dropped, punctuation to spaces: "Prénom " → "prenom", "E-mail" → "e mail". */
export function normalizeHeader(h: string): string {
  return h
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_\-.:/\\()[\]#*?|,;'"’]+/g, ' ')
    .trim();
}

const LATIN = /^[a-z0-9 +]+$/;

/**
 * A keyword matches a whole word run of a Latin header ("guest name" in "the guest name"), a
 * substring of a header in another script, or, for a one-character keyword (CJK 姓, 名), the
 * whole header only.
 */
function matches(header: string, keyword: string): boolean {
  const k = normalizeHeader(keyword);
  if (!k) return false;
  if ([...k].length === 1) return header === k;
  if (LATIN.test(k)) return ` ${header} `.includes(` ${k} `);
  return header.includes(k);
}

/**
 * Ordered: earlier fields claim a header first, so "family name" is a last name before "family"
 * can make it a household, and "guest of" is a plus-one before "guest" can make it a name.
 */
const GUESSES: readonly (readonly [GuestImportField, readonly string[]])[] = [
  [
    'plusOne',
    [
      'plus one',
      'plus 1',
      '+1',
      'plusone',
      'guest of',
      'companion',
      'accompanying',
      'acompanante',
      'invitado de',
      'accompagnateur',
      'accompagnant',
      'invite de',
      'begleitung',
      'begleiter',
      'begleitperson',
      'accompagnatore',
      'ospite di',
      'introductie',
      'partner',
      'acompanhante',
      'спутник',
      'плюс один',
      '同伴者',
      '同伴',
      '随行',
      '隨行',
      'مرافق',
      'साथी',
    ],
  ],
  [
    'email',
    [
      'email',
      'e mail',
      'mail',
      'courriel',
      'correo',
      'correo electronico',
      'posta elettronica',
      'почта',
      'эл почта',
      'メール',
      'メールアドレス',
      '邮箱',
      '郵箱',
      '电子邮件',
      '電子郵件',
      'البريد',
      'ईमेल',
    ],
  ],
  [
    'phone',
    [
      'phone',
      'telephone',
      'tel',
      'mobile',
      'cell',
      'cellphone',
      'telefono',
      'telefone',
      'celular',
      'movil',
      'handy',
      'telefon',
      'portable',
      'cellulare',
      'telefoon',
      'telefoonnummer',
      'телефон',
      '電話',
      '電話番号',
      '电话',
      '手机',
      '手機',
      'هاتف',
      'جوال',
      'फोन',
      'फ़ोन',
      'मोबाइल',
    ],
  ],
  [
    'dietary',
    [
      'dietary',
      'diet',
      'dietary needs',
      'dietary restrictions',
      'allergies',
      'allergy',
      'food restrictions',
      'dieta',
      'alergias',
      'alergia',
      'restricciones',
      'regime',
      'allergies',
      'diat',
      'allergien',
      'unvertraglichkeiten',
      'allergie',
      'dieet',
      'dieetwensen',
      'restricoes alimentares',
      'alergias',
      'диета',
      'аллергии',
      'аллергия',
      '食事制限',
      'アレルギー',
      '饮食',
      '飲食',
      '过敏',
      '過敏',
      'حمية',
      'حساسية',
      'आहार',
      'एलर्जी',
    ],
  ],
  [
    'accessibility',
    [
      'accessibility',
      'access needs',
      'accessible',
      'mobility',
      'wheelchair',
      'disability',
      'accesibilidad',
      'movilidad',
      'accessibilite',
      'mobilite',
      'barrierefreiheit',
      'barrierefrei',
      'rollstuhl',
      'accessibilita',
      'toegankelijkheid',
      'acessibilidade',
      'доступность',
      'バリアフリー',
      'アクセシビリティ',
      '无障碍',
      '無障礙',
      'إمكانية الوصول',
      'الإعاقة',
      'सुलभता',
    ],
  ],
  [
    'address',
    [
      'address',
      'mailing address',
      'home address',
      'street',
      'direccion',
      'domicilio',
      'adresse',
      'anschrift',
      'indirizzo',
      'adres',
      'endereco',
      'morada',
      'адрес',
      '住所',
      '地址',
      'العنوان',
      'पता',
    ],
  ],
  [
    'meal',
    [
      'meal',
      'meal choice',
      'menu',
      'entree',
      'main course',
      'food choice',
      'dinner',
      'plat',
      'repas',
      'comida',
      'plato',
      'menu',
      'essen',
      'hauptgang',
      'pasto',
      'maaltijd',
      'refeicao',
      'prato',
      'блюдо',
      'меню',
      'еда',
      '食事',
      '料理',
      'メニュー',
      '餐点',
      '餐點',
      '菜品',
      'وجبة',
      'भोजन',
    ],
  ],
  [
    'ageClass',
    [
      'age',
      'age group',
      'age class',
      'adult child',
      'adult or child',
      'edad',
      'adulto nino',
      'alter',
      'erwachsene kind',
      'eta',
      'leeftijd',
      'idade',
      'возраст',
      '年齢',
      '年龄',
      '年齡',
      'العمر',
      'आयु',
      'उम्र',
    ],
  ],
  [
    'side',
    [
      'side',
      'bride or groom',
      'bride groom',
      'lado',
      'cote',
      'seite',
      'lato',
      'kant',
      'сторона',
      '側',
      '新郎新婦',
      '男方女方',
      '男方',
      '女方',
      'جانب',
      'पक्ष',
    ],
  ],
  ['vip', ['vip', 'v i p']],
  [
    'tags',
    [
      'tags',
      'tag',
      'labels',
      'label',
      'category',
      'categories',
      'etiquetas',
      'etiqueta',
      'etiquettes',
      'schlagworter',
      'stichworter',
      'etichette',
      'etiketten',
      'метки',
      'теги',
      'タグ',
      '标签',
      '標籤',
      'وسوم',
      'علامات',
      'टैग',
    ],
  ],
  [
    'fullName',
    [
      'full name',
      'fullname',
      'guest name',
      'nombre completo',
      'nom complet',
      'nom et prenom',
      'vollstandiger name',
      'nome completo',
      'volledige naam',
      'полное имя',
      'фио',
      'ф и о',
      '氏名',
      '姓名',
      '全名',
      'الاسم الكامل',
      'पूरा नाम',
    ],
  ],
  [
    'lastName',
    [
      'last name',
      'lastname',
      'surname',
      'family name',
      'last',
      'apellido',
      'apellidos',
      'nom de famille',
      'nom',
      'nachname',
      'familienname',
      'cognome',
      'achternaam',
      'sobrenome',
      'apelido',
      'фамилия',
      '姓',
      '苗字',
      'اسم العائلة',
      'الكنية',
      'उपनाम',
    ],
  ],
  [
    'firstName',
    [
      'first name',
      'firstname',
      'given name',
      'first',
      'forename',
      'nombre',
      'nombre de pila',
      'prenom',
      'vorname',
      'nome',
      'voornaam',
      'primeiro nome',
      'имя',
      '名',
      '下の名前',
      'الاسم الأول',
      'पहला नाम',
    ],
  ],
  [
    'party',
    [
      'household',
      'household name',
      'family',
      'familia',
      'famille',
      'famiglia',
      'familie',
      'gezin',
      'huishouden',
      'foyer',
      'hogar',
      'party',
      'party name',
      'group',
      'groupe',
      'grupo',
      'gruppo',
      'groep',
      'gruppe',
      'invitation',
      'семья',
      'группа',
      '家族',
      '世帯',
      'グループ',
      '家庭',
      '户',
      '戶',
      'परिवार',
      'समूह',
      'عائلة',
      'العائلة',
      'أسرة',
      'مجموعة',
    ],
  ],
  [
    'fullName',
    [
      'name',
      'names',
      'guest',
      'guests',
      'invitado',
      'invitados',
      'invite',
      'invites',
      'gast',
      'gaste',
      'ospite',
      'naam',
      'convidado',
      'гость',
      'гости',
      'ゲスト',
      '名前',
      '客人',
      '宾客',
      '賓客',
      '名字',
      'الضيف',
      'الاسم',
      'अतिथि',
      'नाम',
    ],
  ],
];

/** Best-effort mapping from header names; the host confirms or changes it before anything is imported. */
export function guessGuestMapping(headers: readonly string[]): GuestMapping {
  const norm = headers.map(normalizeHeader);
  const out: GuestMapping = {};
  const taken = new Set<number>();
  for (const [field, keywords] of GUESSES) {
    if (out[field] !== undefined) continue;
    const i = norm.findIndex((h, j) => !taken.has(j) && h !== '' && keywords.some((k) => matches(h, k)));
    if (i >= 0) {
      out[field] = i;
      taken.add(i);
    }
  }
  // A full name next to first and last names is redundant; first/last win.
  if (out.fullName !== undefined && out.firstName !== undefined) delete out.fullName;
  return out;
}

/* ----------------------------------------------------------------------------- values ---- */

const YES = new Set(
  [
    'y',
    'yes',
    'true',
    '1',
    'x',
    '✓',
    '✔',
    'si',
    'oui',
    'ja',
    'sim',
    'da',
    'да',
    'はい',
    '是',
    '有',
    'نعم',
    'हाँ',
    'हां',
    'vip',
    'wahr',
    'vrai',
    'verdadero',
    'vero',
    'waar',
    '+1',
    'plus one',
    'guest',
    'invite',
    'invitado',
    'acompanante',
    'gast',
    'ospite',
    'convidado',
    'гость',
    'ゲスト',
  ].map(normalizeHeader),
);
const NO = new Set(
  [
    '',
    'n',
    'no',
    'false',
    '0',
    '-',
    'non',
    'nein',
    'nao',
    'нет',
    'いいえ',
    '否',
    '无',
    '無',
    'لا',
    'नहीं',
    'falso',
    'faux',
    'onwaar',
    'none',
    'ninguno',
    'aucun',
  ].map(normalizeHeader),
);

export const isYes = (v: string) => YES.has(normalizeHeader(v));
const isNo = (v: string) => NO.has(normalizeHeader(v));

const AGES: Record<AgeClass, readonly string[]> = {
  adult: [
    'adult',
    'adults',
    'adulte',
    'adulto',
    'adulta',
    'erwachsen',
    'erwachsene',
    'erwachsener',
    'volwassene',
    'взрослый',
    'взрослая',
    '大人',
    '成人',
    'بالغ',
    'वयस्क',
  ],
  child: [
    'child',
    'kid',
    'children',
    'kids',
    'enfant',
    'nino',
    'nina',
    'kind',
    'bambino',
    'bambina',
    'crianca',
    'ребенок',
    'ребёнок',
    '子供',
    '子ども',
    'こども',
    '儿童',
    '兒童',
    '小孩',
    'طفل',
    'बच्चा',
  ],
  infant: [
    'infant',
    'baby',
    'bebe',
    'toddler',
    'nourrisson',
    'saugling',
    'kleinkind',
    'neonato',
    'zuigeling',
    'младенец',
    '乳児',
    '赤ちゃん',
    '婴儿',
    '嬰兒',
    'رضيع',
    'शिशु',
  ],
};
const AGE_OF = new Map<string, AgeClass>(
  (Object.entries(AGES) as [AgeClass, readonly string[]][]).flatMap(([a, ws]) =>
    ws.map((w) => [normalizeHeader(w), a] as const),
  ),
);

/** "Child", "niño", "子供" or an age in years (under 2: infant; under 13: child). Empty: adult. */
export function parseAgeClass(v: string): AgeClass | null {
  const s = normalizeHeader(v);
  if (!s) return 'adult';
  if (/^\d{1,3}$/.test(s)) {
    const n = Number(s);
    return n < 2 ? 'infant' : n < 13 ? 'child' : 'adult';
  }
  return AGE_OF.get(s) ?? null;
}

/** "Luis Garcia" → Luis / Garcia; "Garcia, Luis" → Luis / Garcia; "Cher" → Cher. */
export function splitName(v: string): { first: string | null; last: string | null } {
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s) return { first: null, last: null };
  const comma = s.indexOf(',');
  if (comma > 0) {
    const last = s.slice(0, comma).trim();
    const first = s.slice(comma + 1).trim();
    return first ? { first, last: last || null } : { first: last, last: null };
  }
  const sp = s.lastIndexOf(' ');
  return sp > 0 ? { first: s.slice(0, sp), last: s.slice(sp + 1) } : { first: s, last: null };
}

/**
 * A row that stands for someone's plus-one rather than a named guest: "+1", "Plus one",
 * "Guest", or "Guest of Luis" (in several languages). Returns whose (the name after "of"), or
 * `''` when it doesn't say; null when the row is a named guest.
 */
export function plusOneMarker(name: string): string | null {
  const s = name.replace(/\s+/g, ' ').trim();
  const n = normalizeHeader(s);
  if (
    /^(\+ ?1|plus ?one|plus 1|guest|a guest|invitado|invitada|acompanante|invite|invitee|gast|begleitung|ospite|convidado|спутник|гость|同伴者|同伴|مرافق)$/.test(
      n,
    )
  )
    return '';
  const of = s.match(
    /^(?:guest of|plus[- ]?one of|\+1 of|invitad[oa] de|acompañante de|acompanante de|invité de|invitée de|invite de|gast von|begleitung von|ospite di|gast van|convidad[oa] de|гость|спутник)\s+(.+)$/i,
  );
  return of?.[1] ? of[1].trim() : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[\d\s().\-/]{5,30}$/;
const splitTags = (v: string) => v.split(/[;|,]/);

export interface MappedGuestRow {
  readonly rowNo: number;
  /** The household as written (first occurrence names the party), or null for a party of one. */
  readonly household: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  /** This row is someone's plus-one: `of` names the host ('' = the guest above it). */
  readonly plusOneOf: string | null;
  readonly ageClass: AgeClass;
  readonly meal: string | null;
  readonly side: string | null;
  readonly vip: boolean;
  readonly tags: readonly string[];
  readonly email: string | null;
  readonly phone: string | null;
  readonly dietary: string | null;
  readonly accessibility: string | null;
  readonly address: string | null;
  /** The plus-one column: none, a placeholder, or a named plus-one. */
  readonly plusOne: null | 'unnamed' | { firstName: string | null; lastName: string | null };
  readonly error: GuestImportRejection | null;
}

/** One staged row through the mapping, with the first problem found (if any). */
export function mapGuestRow(rowNo: number, cells: readonly string[], m: GuestMapping): MappedGuestRow {
  const cell = (f: GuestImportField) =>
    m[f] === undefined ? '' : (cells[m[f] as number] ?? '').replace(/\s+/g, ' ').trim();
  const long = (f: GuestImportField) =>
    m[f] === undefined ? '' : (cells[m[f] as number] ?? '').replace(/[ \t]+/g, ' ').trim();
  const opt = (v: string) => v || null;
  let error: GuestImportRejection | null = null;
  const fail = (e: GuestImportRejection) => {
    error ??= e;
  };

  let first = cell('firstName');
  let last = cell('lastName');
  if (!first && !last && m.fullName !== undefined) {
    const s = splitName(cell('fullName'));
    first = s.first ?? '';
    last = s.last ?? '';
  }
  const whole = [first, last].filter(Boolean).join(' ');
  const marker = whole ? plusOneMarker(whole) : null;
  if (marker !== null) {
    first = '';
    last = '';
  } else if (!first) fail('missing_name');
  if (first.length > 80 || last.length > 80) fail('name_too_long');

  const ageClass = parseAgeClass(cell('ageClass'));
  if (!ageClass) fail('invalid_age');
  const household = cell('party');
  const meal = cell('meal');
  const side = cell('side');
  const phone = cell('phone');
  const email = cell('email');
  const dietary = long('dietary');
  const accessibility = long('accessibility');
  const address = long('address');
  if (household.length > 120 || meal.length > 80 || side.length > 40) fail('value_too_long');
  if (dietary.length > 500 || accessibility.length > 500 || address.length > 500) fail('value_too_long');
  if (email && (!EMAIL.test(email) || email.length > 254)) fail('invalid_email');
  if (phone && !PHONE.test(phone)) fail('invalid_phone');
  const rawTags = splitTags(cell('tags'));
  const tags = normalizeTags(rawTags);
  if (tags.length > 20 || tags.some((t) => t.length > 40)) fail('too_many_tags');

  const p = cell('plusOne');
  let plusOne: MappedGuestRow['plusOne'] = null;
  if (p && !isNo(p)) {
    if (isYes(p) || plusOneMarker(p) !== null) plusOne = 'unnamed';
    else {
      const s = splitName(p);
      if ((s.first?.length ?? 0) > 80 || (s.last?.length ?? 0) > 80) fail('name_too_long');
      plusOne = { firstName: s.first, lastName: s.last };
    }
  }
  if (marker !== null && plusOne) fail('plus_one_without_guest');

  return {
    rowNo,
    household: opt(household),
    firstName: opt(first),
    lastName: opt(last),
    plusOneOf: marker,
    ageClass: ageClass ?? 'adult',
    meal: opt(meal),
    side: opt(side),
    vip: isYes(cell('vip')),
    tags,
    email: opt(email),
    phone: opt(phone),
    dietary: opt(dietary),
    accessibility: opt(accessibility),
    address: opt(address),
    plusOne,
    error,
  };
}

/* ---------------------------------------------------------------------------- grouping ---- */

export interface PlannedGuest {
  readonly rowNo: number;
  readonly kind: 'guest' | 'plus_one';
  /** For a plus-one: the index (in `guests`) of the guest who brings them. */
  readonly host: number | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly ageClass: AgeClass;
  readonly meal: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly dietary: string | null;
  readonly accessibility: string | null;
  readonly address: string | null;
}

export interface PlannedParty {
  /** The grouping key (household, case- and space-insensitive; or a row of its own). */
  readonly key: string;
  readonly name: string;
  readonly side: string | null;
  readonly vip: boolean;
  readonly tags: readonly string[];
  readonly rowNos: readonly number[];
  /** Named guests in row order, each plus-one right after the guest who brings them. */
  readonly guests: readonly PlannedGuest[];
}

export interface GroupLimits {
  readonly maxGuestsPerParty: number;
  readonly maxPartiesPerEvent: number;
  readonly maxGuestsPerEvent: number;
}

export interface GroupContext {
  /** Names of the event's parties (any case). */
  readonly existingPartyNames: readonly string[];
  readonly existing: { readonly parties: number; readonly guests: number };
  readonly limits: GroupLimits;
}

const keyOf = (s: string) => s.replace(/\s+/g, ' ').trim().toLocaleLowerCase();

/**
 * Rows → parties. A household column groups rows (first occurrence names the party; side, VIP
 * and tags merge); rows without one are a party of one named after the guest. Plus-ones come
 * from the plus-one column or from marker rows ("Guest of Luis", "+1") that attach to the named
 * guest (or the guest above them in the same party). A party is rejected whole when any of its
 * rows has a problem, when it would pass the per-party limit, when the event already has a party
 * of that name, or when the event's limits would be passed.
 */
export function groupGuestRows(
  rows: readonly MappedGuestRow[],
  ctx: GroupContext,
): { parties: PlannedParty[]; rejected: Map<number, GuestImportRejection> } {
  const rejected = new Map<number, GuestImportRejection>();
  interface Draft {
    key: string;
    name: string;
    side: string | null;
    vip: boolean;
    tags: string[];
    rowNos: number[];
    guests: PlannedGuest[];
    bad: boolean;
  }
  const drafts = new Map<string, Draft>();
  const order: Draft[] = [];
  const draftFor = (r: MappedGuestRow): Draft => {
    const key = r.household ? `h:${keyOf(r.household)}` : `r:${r.rowNo}`;
    let d = drafts.get(key);
    if (!d) {
      const name = r.household ?? fullName(r) ?? '';
      d = { key, name, side: null, vip: false, tags: [], rowNos: [], guests: [], bad: false };
      drafts.set(key, d);
      order.push(d);
    }
    return d;
  };
  const fields = (r: MappedGuestRow) => ({
    rowNo: r.rowNo,
    ageClass: r.ageClass,
    meal: r.meal,
    email: r.email,
    phone: r.phone,
    dietary: r.dietary,
    accessibility: r.accessibility,
    address: r.address,
  });

  for (const r of rows) {
    const d = draftFor(r);
    d.rowNos.push(r.rowNo);
    d.side ??= r.side;
    d.vip ||= r.vip;
    d.tags = normalizeTags([...d.tags, ...r.tags]);
    if (r.error) {
      rejected.set(r.rowNo, r.error);
      d.bad = true;
      continue;
    }
    if (r.plusOneOf !== null) {
      // Whose plus-one: the named guest, else the latest guest above who has none yet.
      const want = keyOf(r.plusOneOf);
      const hasOne = (i: number) => d.guests.some((g) => g.host === i);
      const candidates = d.guests
        .map((g, i) => ({ g, i }))
        .filter(({ g, i }) => g.kind === 'guest' && !hasOne(i));
      const host = want
        ? candidates.find(({ g }) => keyOf(fullName(g) ?? '') === want || keyOf(g.firstName ?? '') === want)
        : candidates.at(-1);
      if (!host) {
        rejected.set(r.rowNo, 'plus_one_without_guest');
        d.bad = true;
        continue;
      }
      d.guests.push({ ...fields(r), kind: 'plus_one', host: host.i, firstName: null, lastName: null });
      continue;
    }
    const name = keyOf(fullName(r) ?? '');
    if (d.guests.some((g) => g.kind === 'guest' && keyOf(fullName(g) ?? '') === name)) {
      rejected.set(r.rowNo, 'duplicate_in_file');
      d.bad = true;
      continue;
    }
    const idx = d.guests.length;
    d.guests.push({ ...fields(r), kind: 'guest', host: null, firstName: r.firstName, lastName: r.lastName });
    if (r.plusOne)
      d.guests.push({
        rowNo: r.rowNo,
        kind: 'plus_one',
        host: idx,
        firstName: r.plusOne === 'unnamed' ? null : r.plusOne.firstName,
        lastName: r.plusOne === 'unnamed' ? null : r.plusOne.lastName,
        ageClass: 'adult',
        meal: null,
        email: null,
        phone: null,
        dietary: null,
        accessibility: null,
        address: null,
      });
  }

  const existingNames = new Set(ctx.existingPartyNames.map(keyOf));
  const singles = new Set<string>();
  let parties = ctx.existing.parties;
  let guests = ctx.existing.guests;
  const out: PlannedParty[] = [];
  const rejectRest = (d: Draft, code: GuestImportRejection) => {
    for (const n of d.rowNos) if (!rejected.has(n)) rejected.set(n, code);
  };
  for (const d of order) {
    if (d.bad) {
      rejectRest(d, 'party_has_errors');
      continue;
    }
    // A plus-one always follows the guest who brings them.
    const listed = d.guests
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => g.kind === 'guest')
      .flatMap(({ g, i }) => [g, ...d.guests.filter((p) => p.host === i)]);
    const remap = new Map(d.guests.map((g, i) => [i, listed.indexOf(g)]));
    const list = listed.map((g) => (g.host === null ? g : { ...g, host: remap.get(g.host) ?? null }));
    if (list.length === 0) {
      rejectRest(d, 'missing_name');
      continue;
    }
    if (list.length > ctx.limits.maxGuestsPerParty) {
      rejectRest(d, 'party_too_large');
      continue;
    }
    const nameKey = keyOf(d.name);
    if (existingNames.has(nameKey)) {
      rejectRest(d, 'party_exists');
      continue;
    }
    if (d.key.startsWith('r:')) {
      // Two single rows for the same person.
      if (singles.has(nameKey)) {
        rejectRest(d, 'duplicate_in_file');
        continue;
      }
      singles.add(nameKey);
    }
    if (parties + 1 > ctx.limits.maxPartiesPerEvent || guests + list.length > ctx.limits.maxGuestsPerEvent) {
      rejectRest(d, 'event_full');
      continue;
    }
    parties += 1;
    guests += list.length;
    out.push({
      key: d.key,
      name: d.name.slice(0, 120),
      side: d.side,
      vip: d.vip,
      tags: d.tags,
      rowNos: d.rowNos,
      guests: list,
    });
  }
  return { parties: out, rejected };
}

/* ------------------------------------------------------------------------ Google Sheets ---- */

/**
 * A Google Sheet shared as "anyone with the link" (P4-7): only
 * `https://docs.google.com/spreadsheets/d/<id>/…` is accepted (the tab from `gid=` in the query
 * or the fragment). Anything else, including "published to the web" links (`/d/e/…`), is null.
 */
export function parseSheetUrl(raw: string): { id: string; gid: string | null } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') return null;
  if (url.username || url.password || (url.port && url.port !== '443')) return null;
  const m = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})(?:\/[A-Za-z0-9_/-]*)?$/);
  if (!m?.[1]) return null;
  const gid = url.searchParams.get('gid') ?? url.hash.match(/gid=(\d+)/)?.[1] ?? null;
  return { id: m[1], gid: gid && /^\d{1,12}$/.test(gid) ? gid : null };
}

/** The CSV export of the sheet's tab (the first tab when none is named). */
export const sheetExportUrl = (s: { id: string; gid: string | null }) =>
  `https://docs.google.com/spreadsheets/d/${s.id}/export?format=csv${s.gid ? `&gid=${s.gid}` : ''}`;
