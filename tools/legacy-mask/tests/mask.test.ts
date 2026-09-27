import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  DumpMasker,
  LEGACY_RULES,
  MASKED_PASSWORD_HASH,
  parseCreateTable,
  parseInsert,
  type SqlValue,
  StatementSplitter,
  Verifier,
} from '../src/index.ts';

const FIXTURE = readFileSync(new URL('./fixtures/legacy-synthetic.sql', import.meta.url), 'utf8');
const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);

function mask(text: string, key = KEY, chunk = text.length) {
  const m = new DumpMasker(key, LEGACY_RULES);
  let out = '';
  for (let i = 0; i < text.length; i += chunk) out += m.push(text.slice(i, i + chunk));
  out += m.end();
  return { out, report: m.report };
}

/** Rows of a table in a dump, as column-name → value objects. */
function rows(dump: string, table: string): Record<string, SqlValue>[] {
  const s = new StatementSplitter();
  const stmts = [...s.push(dump), s.end()];
  const def = parseCreateTable(
    stmts.find((x) => x.trimStart().startsWith(`CREATE TABLE \`${table}\``)) ?? '',
  );
  const names = def?.columns.map((c) => c.name) ?? [];
  return stmts
    .filter((x) => x.trimStart().startsWith(`INSERT INTO \`${table}\``))
    .flatMap((x) => parseInsert(x.trimStart()).rows)
    .map((r) => Object.fromEntries(r.map((v, i) => [names[i] ?? String(i), v])));
}
const str = (v: SqlValue | undefined) => (v?.kind === 'str' ? v.value : v?.kind === 'null' ? null : v);

const ORIGINAL_SECRETS = [
  'priya.fictional@example.org',
  'Priya.Fictional@Example.org',
  'omar@example.net',
  'zoe@example.com',
  'dana.planner@example.org',
  'host@example.org',
  'guest.of.priya@example.org',
  'hello@example.org',
  '4000056655665556',
  'sunflower42',
  '4821',
  'Gp4ss-Fake-Word',
  'sk_test_fake',
  'mailer-user-fake',
  'FAKELOGINID',
  'fake-access-key-id',
  '000123456789',
  'First Fictional Bank',
  'rememberme1234567890',
  'cus_FAKE00000001',
  'pi_FAKE3Nabcdefghijklmnop',
  '198.51.100.7',
  '12 Imaginary Rd',
  'letmein',
  'sessFAKEabc123',
  '3125559876',
  '555-9876',
  'linkedin.example',
  'Priya Fictional',
];

describe('legacy masking — nothing personal or secret survives', () => {
  const { out, report } = mask(FIXTURE);

  it('no original email, card, code, key, token, bank detail or name appears anywhere in the output', () => {
    for (const secret of ORIGINAL_SECRETS) expect(out, secret).not.toContain(secret);
  });

  it('the verifier agrees: counts match, nothing survives, unique keys stay unique', () => {
    const v = new Verifier(LEGACY_RULES);
    v.pushOriginal(FIXTURE);
    v.endOriginal();
    v.pushMasked(out);
    const r = v.result();
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.tables.users).toEqual({ original: 4, masked: 4 });
    expect(r.tables.sessions).toEqual({ original: 1, masked: 0 });
  });

  it('raw card data is emptied to {} (still valid JSON, never NULL for a NOT NULL column)', () => {
    const [fb] = rows(out, 'failed_bookings');
    expect(str(fb?.payment_method)).toBe('{}');
    // The booking JSON keeps its shape and quantities; only the person changes.
    const booking = JSON.parse(String(str(fb?.booking)));
    expect(booking.quantity).toBe(2);
    expect(booking.customer_email).toMatch(/^u\.[0-9a-f]{12}@masked\.yayatoh\.test$/);
  });

  it('sessions, reset tokens and other credential tables keep their structure but no rows', () => {
    expect(out).toContain('CREATE TABLE `sessions`');
    expect(rows(out, 'sessions')).toHaveLength(0);
    expect(report.tables.sessions).toMatchObject({ rowsIn: 1, rowsOut: 0 });
  });

  it('secrets in the settings table are replaced; ordinary settings are kept', () => {
    const byKey = Object.fromEntries(rows(out, 'settings').map((r) => [str(r.key), str(r.value)]));
    expect(byKey['site.title']).toBe('Yayatoh Synthetic');
    for (const k of [
      'apps.stripe_secret_key',
      'mail.mail_username',
      'apps.authorize_login_id',
      'storage.aws_access_key_id',
    ])
      expect(byKey[k], k).toBe('masked');
    expect(byKey['contact.email']).toMatch(/@masked\.yayatoh\.test$/);
    expect(byKey['contact.phone']).toMatch(/^\+1555\d{7}$/);
  });

  it('private event info stays valid JSON with the same shape, but every value changes', () => {
    const [gala] = rows(out, 'events');
    const info = JSON.parse(String(str(gala?.private_info)));
    expect(Object.keys(info)).toEqual(['wifi', 'parking', 'contact']);
    expect(info.wifi.password).not.toBe('sunflower42');
    expect(info.parking.code).toMatch(/^\d{4}$/);
    expect(info.parking.code).not.toBe('4821');
    expect(info.contact.email).toMatch(/@masked\.yayatoh\.test$/);
    // Public event content is kept (the migration must reproduce it), minus quoted addresses.
    expect(str(gala?.title)).toBe('Summer Gala');
    expect(String(str(gala?.description))).toMatch(
      /^Questions\? Write to u\.[0-9a-f]{12}@masked\.yayatoh\.test or call us\.$/,
    );
  });

  it('plain-text guest passwords inside sent notifications are gone', () => {
    const [n] = rows(out, 'notifications');
    const data = JSON.parse(String(str(n?.data)));
    expect(data.notification.guest_password).not.toBe('Gp4ss-Fake-Word');
    expect(data.notification.user.email).toMatch(/@masked\.yayatoh\.test$/);
  });

  it('binary token columns are replaced with bytes of the same length', () => {
    const [a, b] = rows(out, 'personal_access_tokens');
    expect(a?.secret_blob).toMatchObject({ kind: 'hex' });
    const blob = a?.secret_blob?.kind === 'hex' ? a.secret_blob.raw : '';
    expect(blob).toHaveLength('0xDEADBEEF'.length);
    expect(blob).not.toBe('0xDEADBEEF');
    expect(str(a?.token)).toMatch(/^[0-9a-f]{64}$/);
    expect(str(a?.token)).not.toBe(str(b?.token));
    expect(b?.secret_blob).toMatchObject({ kind: 'str', introducer: '_binary' });
  });

  it('the report names columns and counts only — never a value', () => {
    const json = JSON.stringify(report);
    for (const secret of ORIGINAL_SECRETS) expect(json).not.toContain(secret);
    expect(report.tables.users?.masked.email).toBe('email');
    expect(report.errors).toEqual([]);
  });
});

describe('legacy masking — the masked dump still imports into the new product', () => {
  const { out } = mask(FIXTURE);
  const original = (t: string) => rows(FIXTURE, t);
  const masked = (t: string) => rows(out, t);

  it('ids, foreign keys, amounts, currencies, dates and statuses are unchanged', () => {
    const keep = [
      'id',
      'customer_id',
      'event_id',
      'price',
      'net_price',
      'currency',
      'order_number',
      'created_at',
    ];
    expect(masked('bookings').map((r) => keep.map((k) => r[k]))).toEqual(
      original('bookings').map((r) => keep.map((k) => r[k])),
    );
    expect(masked('users').map((r) => [r.id, r.role_id, r.created_at])).toEqual(
      original('users').map((r) => [r.id, r.role_id, r.created_at]),
    );
  });

  it('one person keeps one identity across tables (case-insensitive), so buyers still dedupe', () => {
    const userEmail = str(masked('users')[0]?.email);
    expect(str(masked('bookings')[0]?.customer_email)).toBe(userEmail);
    expect(str(masked('attendees')[0]?.address)).toBe(userEmail);
    expect(str(masked('transactions')[0]?.payer_reference)).toBe(userEmail);
    // "OMAR@EXAMPLE.NET" in bookings and "omar@example.net" in users are one person.
    expect(str(masked('bookings')[1]?.customer_email)).toBe(str(masked('users')[1]?.email));
  });

  it("values pass the new product's own validation: emails, E.164 phones, JSON, bcrypt, lengths", () => {
    const email = z.email();
    for (const u of masked('users')) {
      expect(email.safeParse(str(u.email)).success).toBe(true);
      expect(str(u.password)).toBe(MASKED_PASSWORD_HASH);
      expect(String(str(u.password))).toMatch(/^\$2y\$10\$.{53}$/);
      if (str(u.phone)) expect(str(u.phone)).toMatch(/^\+1555\d{7}$/);
      if (str(u.social_links)) expect(() => JSON.parse(String(str(u.social_links)))).not.toThrow();
      expect(String(str(u.remember_token) ?? '').length).toBeLessThanOrEqual(100);
      expect(String(str(u.magic_login_token) ?? '').length).toBeLessThanOrEqual(64);
    }
    for (const a of masked('attendees')) if (str(a.phone)) expect(str(a.phone)).toMatch(/^\+1555\d{7}$/);
  });

  it('NOT NULL columns never become NULL; bank details are blanked', () => {
    for (const u of masked('users')) {
      expect(u.name?.kind).toBe('str');
      expect(u.email?.kind).toBe('str');
      expect(str(u.bank_account_number)).toBe('');
      expect(str(u.bank_name) ?? '').toBe('');
    }
  });

  it('provider references keep their prefix (the import can still route them)', () => {
    const [t] = masked('transactions');
    expect(String(str(t?.txn_id))).toMatch(/^pi_masked[0-9a-f]+$/);
    expect(String(str(masked('users')[0]?.stripe_id))).toMatch(/^cus_masked[0-9a-f]+$/);
  });

  it('is deterministic under a key, different under another, and chunking changes nothing', () => {
    expect(mask(FIXTURE).out).toBe(out);
    expect(mask(FIXTURE, KEY, 3).out).toBe(out);
    const other = mask(FIXTURE, OTHER_KEY).out;
    expect(other).not.toBe(out);
    expect(str(rows(other, 'users')[0]?.email)).not.toBe(str(masked('users')[0]?.email));
  });

  it('comments, conditional comments, DROP/LOCK statements pass through untouched', () => {
    for (const line of [
      '/*!40101 SET NAMES utf8mb4 */;',
      'LOCK TABLES `users` WRITE;',
      'DROP TABLE IF EXISTS `users`;',
      '-- Dump completed on 2026-09-28 12:00:00',
    ])
      expect(out).toContain(line);
  });
});

describe('legacy masking — uniqueness and fail-closed behaviour', () => {
  it('unique columns stay unique across 20,000 people even when masked values collide', () => {
    const create =
      'CREATE TABLE `people` (\n  `id` int NOT NULL,\n  `email` varchar(255) NOT NULL,\n  `phone` varchar(32) NOT NULL,\n  PRIMARY KEY (`id`),\n  UNIQUE KEY `people_phone_unique` (`phone`),\n  UNIQUE KEY `people_email_unique` (`email`)\n);\n';
    const values = Array.from(
      { length: 20_000 },
      (_, i) => `(${i},'person${i}@example.org','+44 20 ${String(7_000_000 + i)}')`,
    );
    const dump = `${create}INSERT INTO \`people\` VALUES ${values.join(',')};\n`;
    const { out } = mask(dump);
    const people = rows(out, 'people');
    expect(people).toHaveLength(20_000);
    expect(new Set(people.map((p) => str(p.phone))).size).toBe(20_000);
    expect(new Set(people.map((p) => str(p.email))).size).toBe(20_000);
    const v = new Verifier({});
    v.pushOriginal(dump);
    v.endOriginal();
    v.pushMasked(out);
    expect(v.result().problems).toEqual([]);
  });

  it('rows for a table without a definition are omitted and reported, never written unmasked', () => {
    const { out, report } = mask("INSERT INTO `mystery` VALUES (1,'someone@example.org');\n");
    expect(out).not.toContain('someone@example.org');
    expect(report.errors[0]).toMatch(/mystery/);
  });

  it('the verifier catches a leak, a lost row and a duplicate key', () => {
    const { out } = mask(FIXTURE);
    const leaky = out.replace(/u\.[0-9a-f]{12}@masked\.yayatoh\.test/, 'zoe@example.com');
    const lossy = out.replace(/,\(4,'[^;]*?;\n/, ';\n');
    const dup = out
      .replace("(2,2,'aaaa", "(2,2,'aaaa")
      .replace(/(INSERT INTO `settings` VALUES \(1,)'site\.title'/, "$1'apps.stripe_public_key'");
    for (const [bad, expected] of [
      [leaky, /original email address survived/],
      [lossy, /users: 3 rows in the masked dump, expected 4/],
      [dup, /settings\(key\): a duplicate value/],
    ] as const) {
      const v = new Verifier(LEGACY_RULES);
      v.pushOriginal(FIXTURE);
      v.endOriginal();
      v.pushMasked(bad);
      const r = v.result();
      expect(r.ok).toBe(false);
      expect(r.problems.join('\n')).toMatch(expected);
    }
  });

  it('refuses a short key', () => {
    expect(() => new DumpMasker(Buffer.alloc(8), LEGACY_RULES)).toThrow(/at least 32 bytes/);
  });
});
