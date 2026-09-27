import { createHmac } from 'node:crypto';

/**
 * Masking strategies. Every one is deterministic under the owner's secret key (keyed
 * HMAC-SHA256), so the same person masks to the same values everywhere in the dump — joins,
 * duplicate detection and "same buyer, two orders" still work — while nobody without the key
 * can link a masked value back to a real one. Outputs stay valid for their column (email
 * format, E.164 phone, JSON stays JSON, bcrypt stays bcrypt) and are cut to the column's
 * length, so the masked dump imports like the original and passes the new product's checks.
 */
export class Masker {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length < 32) throw new Error('The masking key must be at least 32 bytes');
    this.key = key;
  }

  /** Hex digest for (purpose, value): the only source of randomness in masked output. */
  digest(purpose: string, value: string): string {
    return createHmac('sha256', this.key).update(`${purpose}\u0000${value}`).digest('hex');
  }

  /** A number in [0, n) from the digest. */
  pick(purpose: string, value: string, n: number): number {
    return Number.parseInt(this.digest(purpose, value).slice(0, 12), 16) % n;
  }

  /** `u.<12 hex>@masked.yayatoh.test`; case and surrounding space don't change the result. */
  email(value: string): string {
    const norm = value.trim().toLowerCase();
    if (!norm) return value;
    return `u.${this.digest('email', norm).slice(0, 12)}@masked.yayatoh.test`;
  }

  firstName(value: string): string {
    if (!value.trim()) return value;
    return FIRST[this.pick('first', value.trim().toLowerCase(), FIRST.length)] as string;
  }

  lastName(value: string): string {
    if (!value.trim()) return value;
    return LAST[this.pick('last', value.trim().toLowerCase(), LAST.length)] as string;
  }

  /** A full name: two words, stable per original name. */
  fullName(value: string): string {
    if (!value.trim()) return value;
    const v = value.trim().toLowerCase();
    return `${FIRST[this.pick('first', v, FIRST.length)]} ${LAST[this.pick('last', v, LAST.length)]}`;
  }

  /** A fictional E.164 number (+1 555 …), stable per original digits. */
  phone(value: string): string {
    const digits = value.replace(/\D/g, '');
    if (!digits) return value;
    const n = Number.parseInt(this.digest('phone', digits).slice(0, 10), 16) % 10_000_000;
    return `+1555${String(n).padStart(7, '0')}`;
  }

  /** A street address that looks like one and says nothing. */
  street(value: string): string {
    if (!value.trim()) return value;
    const v = value.trim().toLowerCase();
    return `${100 + this.pick('street-no', v, 9_800)} ${STREETS[this.pick('street', v, STREETS.length)]}`;
  }

  postcode(value: string): string {
    if (!value.trim()) return value;
    return String(10_000 + this.pick('postcode', value.trim(), 89_999));
  }

  /** An IPv4 address in TEST-NET-3 (203.0.113.0/24); IPv6 in the documentation prefix. */
  ip(value: string): string {
    if (!value.trim()) return value;
    return value.includes(':')
      ? `2001:db8::${this.digest('ip', value).slice(0, 4)}`
      : `203.0.113.${this.pick('ip', value, 254) + 1}`;
  }

  /** Same length, same alphabet class (hex stays hex), unrelated to the original. */
  token(value: string): string {
    if (!value) return value;
    const hex = this.digest('token', value).repeat(Math.ceil(value.length / 64) + 1);
    if (/^[0-9a-f]+$/.test(value)) return hex.slice(0, value.length);
    const alnum = Buffer.from(hex, 'hex')
      .toString('base64')
      .replace(/[^a-zA-Z0-9]/g, 'x')
      .repeat(2);
    return alnum.slice(0, value.length);
  }

  /**
   * Provider references (Stripe `pi_…`, `ch_…`, `acct_…`, PayPal ids): keep the prefix so the
   * import can still tell what kind of object it was, replace the rest.
   */
  reference(value: string): string {
    if (!value) return value;
    const m = /^([a-z]{1,8}_)(test_)?/i.exec(value);
    const prefix = m ? m[0] : '';
    return `${prefix}masked${this.digest('ref', value).slice(0, Math.max(8, value.length - prefix.length - 6))}`;
  }

  /** Placeholder prose of about the same length, so layouts and length checks still work. */
  text(value: string): string {
    if (!value.trim()) return value;
    const words: string[] = [];
    let len = 0;
    let n = 0;
    while (len < Math.min(value.length, 2_000)) {
      const w = LOREM[this.pick('text', `${value.length}:${n++}`, LOREM.length)] as string;
      words.push(w);
      len += w.length + 1;
    }
    const out = words.join(' ');
    return `${out.charAt(0).toUpperCase()}${out.slice(1)}.`;
  }

  /** A person's photo or upload: one neutral placeholder path. */
  image(value: string): string {
    if (!value.trim()) return value;
    const ext = /\.(png|jpe?g|gif|webp|svg)$/i.exec(value)?.[0] ?? '.png';
    return `masked/avatar-${this.digest('image', value).slice(0, 8)}${ext}`;
  }

  /** Keep the year, move the day to 1 January (dates of birth). */
  birthDate(value: string): string {
    const m = /^(\d{4})-\d{2}-\d{2}/.exec(value);
    return m ? value.replace(/^\d{4}-\d{2}-\d{2}/, `${m[1]}-01-01`) : value;
  }
}

/**
 * The Laravel factory hash of the word "password" ($2y$, cost 10): a valid bcrypt value, so
 * the legacy-password import and rehash path still runs, and developers can sign in as any
 * masked user with "password".
 */
export const MASKED_PASSWORD_HASH = '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';

const FIRST = [
  'Alex',
  'Amani',
  'Ari',
  'Bea',
  'Cam',
  'Dana',
  'Eden',
  'Emery',
  'Finley',
  'Gray',
  'Harper',
  'Indy',
  'Jules',
  'Kai',
  'Lane',
  'Lee',
  'Marlo',
  'Nico',
  'Noor',
  'Oakley',
  'Parker',
  'Quinn',
  'Remy',
  'Reese',
  'Rowan',
  'Sage',
  'Sasha',
  'Shay',
  'Sky',
  'Tatum',
  'Toni',
  'Val',
  'Wren',
  'Yael',
  'Zion',
  'Zuri',
];
const LAST = [
  'Abara',
  'Bell',
  'Castillo',
  'Diallo',
  'Ekwueme',
  'Fontaine',
  'Garcia',
  'Hale',
  'Ibarra',
  'Jensen',
  'Kaur',
  'Lindqvist',
  'Mensah',
  'Novak',
  'Okafor',
  'Park',
  'Quintero',
  'Rossi',
  'Sato',
  'Tan',
  'Umar',
  'Vance',
  'Wong',
  'Xu',
  'Yilmaz',
  'Zeller',
  'Adeyemi',
  'Brooks',
  'Chen',
  'Duarte',
];
const STREETS = [
  'Maple Ave',
  'Oak St',
  'Cedar Ln',
  'Pine Rd',
  'Elm St',
  'Birch Way',
  'Willow Ct',
  'Harbor Dr',
  'Lakeview Blvd',
  'Park Pl',
  'River Rd',
  'Hill St',
];
const LOREM = [
  'lorem',
  'ipsum',
  'dolor',
  'sit',
  'amet',
  'consectetur',
  'adipiscing',
  'elit',
  'sed',
  'do',
  'eiusmod',
  'tempor',
  'incididunt',
  'ut',
  'labore',
  'et',
  'dolore',
  'magna',
  'aliqua',
  'enim',
  'minim',
  'veniam',
  'quis',
  'nostrud',
  'exercitation',
  'ullamco',
  'laboris',
  'nisi',
  'aliquip',
];
