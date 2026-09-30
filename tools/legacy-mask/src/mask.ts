import {
  formatInsert,
  type InsertStatement,
  isInsert,
  parseCreateTable,
  parseInsert,
  type SqlValue,
  StatementSplitter,
  type TableDef,
} from './sql.ts';
import { MASKED_PASSWORD_HASH, Masker } from './strategies.ts';

export type Strategy =
  | 'keep'
  | 'null'
  | 'email'
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'phone'
  | 'street'
  | 'postcode'
  | 'ip'
  | 'userAgent'
  | 'token'
  | 'reference'
  | 'text'
  | 'password'
  | 'image'
  | 'birthDate'
  | 'json'
  /** JSON whose every string may be personal (private info, notification mail arrays). */
  | 'jsonAll'
  /** A JSON column that must hold nothing (raw card data): `{}` — valid and never NULL. */
  | 'emptyJson'
  /** An email when the value looks like one, otherwise a street address. */
  | 'contact'
  /** An email when the value looks like one, otherwise a provider reference. */
  | 'emailOrReference'
  /** Card last four digits: always 4242. */
  | 'last4';

export interface TableRule {
  /** Keep the table's structure but none of its rows (sessions, reset tokens, queues). */
  readonly dropRows?: boolean;
  /** Column → strategy; anything not listed falls back to the name heuristics. */
  readonly columns?: Readonly<Record<string, Strategy>>;
  /** Key/value settings tables: mask `value` when `key` looks secret or holds an address. */
  readonly settings?: { readonly keyColumn: string; readonly valueColumn: string };
}

export type Rules = Readonly<Record<string, TableRule>>;

const STRINGY = new Set([
  'char',
  'varchar',
  'tinytext',
  'text',
  'mediumtext',
  'longtext',
  'json',
  'enum',
  'set',
]);
/** Column types the name heuristics apply to: text and binary (tokens are often stored as blobs). */
const MASKABLE = new Set([...STRINGY, 'binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob']);
const SECRET_SETTING =
  /(secret|password|passwd|pass\b|token|api[_-]?key|apikey|client[_-]?id|private|webhook|smtp|auth|dsn|sid\b|key$|key_name|login_id|encrypt|username|access_key|merchant_key)/i;
const PHONE_SETTING = /(phone|mobile|whatsapp|_number$)/i;
const ADDRESS_SETTING = /(^|[._])address$/i;
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Column-name heuristics for columns without an explicit rule. They err on the side of
 * masking: a false positive costs realism, a false negative leaks a person.
 */
export function heuristic(column: string): Strategy | null {
  const c = column.toLowerCase();
  if (c === 'password' || c.endsWith('_password') || c === 'pass') return 'password';
  if (/(^|_)(e?mail|email_address)($|_)/.test(c) || c.endsWith('email')) return 'email';
  if (/(^|_)(phone|mobile|cell|telephone|whatsapp|msisdn)($|_)/.test(c)) return 'phone';
  if (c === 'first_name' || c === 'firstname' || c === 'fname' || c === 'given_name') return 'firstName';
  if (c === 'last_name' || c === 'lastname' || c === 'lname' || c === 'surname' || c === 'family_name')
    return 'lastName';
  if (
    /(^|_)(full_?name|customer_name|holder_name|attendee_name|guest_name|buyer_name|contact_name|billing_name|account_holder|account_name)$/.test(
      c,
    )
  )
    return 'fullName';
  if (/(^|_)(address|street|address_?line_?\d?|billing_address|shipping_address)$/.test(c)) return 'street';
  if (/(^|_)(zip|zipcode|zip_code|postcode|postal_code)$/.test(c)) return 'postcode';
  if (/(^|_)(ip|ip_address|ipaddress|last_ip|client_ip)$/.test(c)) return 'ip';
  if (/(^|_)(user_agent|useragent)$/.test(c)) return 'userAgent';
  if (
    /(token|secret|api_key|apikey|otp|remember|magic|nonce|signature|hash)$/.test(c) ||
    c.startsWith('token_') ||
    c.includes('secret')
  )
    return 'token';
  if (
    /(bank|iban|swift|bic|routing|account_number|acct_number|sort_code|tax_id|taxid|ssn|ein|vat_number|national_id|passport)/.test(
      c,
    )
  )
    return 'null';
  if (/(^|_)(dob|birth_?date|date_of_birth|birthday)$/.test(c)) return 'birthDate';
  if (/(^|_)(avatar|profile_photo|profile_image|photo|selfie|id_document)$/.test(c)) return 'image';
  return null;
}

export interface TableReport {
  rowsIn: number;
  rowsOut: number;
  /** column → strategy and where it came from (never any values). */
  masked: Record<string, string>;
  /** Text columns kept as-is without an explicit rule: review these. */
  unreviewedText: string[];
}

export interface MaskReport {
  readonly tool: 'yayatoh-legacy-mask';
  readonly version: 1;
  tables: Record<string, TableReport>;
  /** Tables whose rows appeared without a CREATE TABLE (refused: nothing written for them). */
  errors: string[];
}

/**
 * Masks one dump, statement by statement. Unique values stay unique (a collision is re-drawn),
 * and the same input always gives the same output under the same key.
 */
export class DumpMasker {
  private readonly defs = new Map<string, TableDef>();
  private readonly splitter = new StatementSplitter();
  private readonly masker: Masker;
  /** strategy → original → masked, and strategy → masked values in use. */
  private readonly seen = new Map<string, Map<string, string>>();
  private readonly used = new Map<string, Set<string>>();
  readonly report: MaskReport = { tool: 'yayatoh-legacy-mask', version: 1, tables: {}, errors: [] };

  private readonly rules: Rules;

  // Plain fields, not parameter properties: the tool runs with Node's strip-only TypeScript.
  constructor(key: Buffer, rules: Rules) {
    this.masker = new Masker(key);
    this.rules = rules;
  }

  /** Feed raw dump text; returns the masked text for every statement completed so far. */
  push(chunk: string): string {
    return this.splitter
      .push(chunk)
      .map((s) => this.statement(s))
      .join('');
  }

  end(): string {
    const rest = this.splitter.end();
    return rest.trim() ? this.statement(rest) : rest;
  }

  private statement(stmt: string): string {
    const trimmed = stmt.trimStart();
    if (/^CREATE TABLE/i.test(trimmed)) {
      const def = parseCreateTable(trimmed);
      if (def) {
        this.defs.set(def.name, def);
        this.report.tables[def.name] ??= { rowsIn: 0, rowsOut: 0, masked: {}, unreviewedText: [] };
      }
      return stmt;
    }
    if (!isInsert(trimmed)) return stmt;
    const ins = parseInsert(trimmed);
    const def = this.defs.get(ins.table);
    if (!def) {
      // Fail closed: rows we can't attribute to columns are never written unmasked.
      this.report.errors.push(`${ins.table}: INSERT before CREATE TABLE — rows omitted`);
      return `-- legacy-mask: rows of \`${ins.table}\` omitted (no table definition)\n`;
    }
    const rep = this.report.tables[ins.table] as TableReport;
    rep.rowsIn += ins.rows.length;
    const rule = this.rules[ins.table] ?? {};
    if (rule.dropRows) return `-- legacy-mask: ${ins.rows.length} rows of \`${ins.table}\` omitted by rule\n`;
    const names = ins.columns ?? def.columns.map((c) => c.name);
    const plan = names.map((name) => this.planColumn(def, rule, name, rep));
    const keyIdx = rule.settings ? names.indexOf(rule.settings.keyColumn) : -1;
    const valIdx = rule.settings ? names.indexOf(rule.settings.valueColumn) : -1;
    const rows = ins.rows.map((row) =>
      row.map((v, i) => {
        if (i === valIdx && keyIdx >= 0) return this.setting(row[keyIdx], v, def, names[i] as string);
        const p = plan[i];
        return p ? this.apply(p.strategy, v, p.column) : v;
      }),
    );
    rep.rowsOut += rows.length;
    const out: InsertStatement = { ...ins, rows };
    return formatInsert(out);
  }

  private planColumn(def: TableDef, rule: TableRule, name: string, rep: TableReport) {
    const column = def.columns.find((c) => c.name === name);
    if (!column) return null;
    const explicit = rule.columns?.[name];
    const strategy = explicit ?? (MASKABLE.has(column.type) ? heuristic(name) : null) ?? 'keep';
    if (strategy !== 'keep') rep.masked[name] = `${strategy}${explicit ? '' : ' (heuristic)'}`;
    else if (
      !explicit &&
      ['text', 'mediumtext', 'longtext', 'json'].includes(column.type) &&
      !rep.unreviewedText.includes(name)
    )
      rep.unreviewedText.push(name);
    return { strategy, column };
  }

  private setting(keyValue: SqlValue | undefined, v: SqlValue, def: TableDef, column: string): SqlValue {
    if (v.kind !== 'str' || !v.value) return v;
    const key = keyValue?.kind === 'str' ? keyValue.value : '';
    const col = def.columns.find((c) => c.name === column) ?? null;
    if (SECRET_SETTING.test(key)) return { ...v, value: 'masked' };
    if (PHONE_SETTING.test(key) && v.value.replace(/\D/g, '').length >= 7)
      return {
        ...v,
        value: this.fit(
          this.unique('phone', v.value.replace(/\D/g, ''), () => this.masker.phone(v.value)),
          col,
        ),
      };
    if (ADDRESS_SETTING.test(key)) return { ...v, value: this.fit(this.masker.street(v.value), col) };
    if (/@/.test(v.value))
      return {
        ...v,
        value: this.fit(
          v.value.replace(EMAIL_IN_TEXT, (m) =>
            this.unique('email', m.toLowerCase(), () => this.masker.email(m)),
          ),
          col,
        ),
      };
    return v;
  }

  private apply(strategy: Strategy, v: SqlValue, column: TableDef['columns'][number]): SqlValue {
    if (v.kind === 'null') return v;
    if (strategy === 'keep') {
      // Kept text can still quote someone's address (an event description, a note): swap
      // every email inside for its masked twin, consistently with the rest of the dump.
      if (v.kind !== 'str' || !v.value.includes('@') || !STRINGY.has(column.type)) return v;
      const swept = v.value.replace(EMAIL_IN_TEXT, (m) =>
        this.unique('email', m.toLowerCase(), () => this.masker.email(m)),
      );
      return swept === v.value ? v : { ...v, value: this.fit(swept, column) };
    }
    // A NOT NULL column is blanked with '' so the masked dump still loads.
    if (strategy === 'null') return column.nullable ? { kind: 'null' } : { kind: 'str', value: '' };
    if (v.kind === 'hex') {
      // Binary data in a masked column (e.g. --hex-blob tokens): same length, new bytes.
      const digits = v.raw.slice(2);
      return digits ? { kind: 'hex', raw: `0x${this.masker.token(digits.toLowerCase())}` } : v;
    }
    if (v.kind === 'num') {
      // A phone kept as a number column: a fictional number of the same kind.
      return strategy === 'phone' ? { kind: 'num', raw: this.masker.phone(v.raw).replace(/\D/g, '') } : v;
    }
    if (v.kind !== 'str') return v;
    const s = v.value;
    const m = this.masker;
    let out: string;
    switch (strategy) {
      case 'email':
        out = this.unique('email', s.trim().toLowerCase(), () => m.email(s));
        break;
      case 'phone':
        out = this.unique('phone', s.replace(/\D/g, ''), () => m.phone(s));
        break;
      case 'token':
        out = this.unique('token', s, () => m.token(s));
        break;
      case 'reference':
        out = this.unique('reference', s, () => m.reference(s));
        break;
      case 'firstName':
        out = m.firstName(s);
        break;
      case 'lastName':
        out = m.lastName(s);
        break;
      case 'fullName':
        out = m.fullName(s);
        break;
      case 'street':
        out = m.street(s);
        break;
      case 'postcode':
        out = m.postcode(s);
        break;
      case 'ip':
        out = m.ip(s);
        break;
      case 'userAgent':
        out = s ? 'Mozilla/5.0 (masked)' : s;
        break;
      case 'text':
        out = m.text(s);
        break;
      case 'password':
        out = s ? MASKED_PASSWORD_HASH : s;
        break;
      case 'image':
        out = m.image(s);
        break;
      case 'birthDate':
        out = m.birthDate(s);
        break;
      case 'json':
        out = this.json(s);
        break;
      case 'jsonAll':
        out = this.json(s, true);
        break;
      case 'emptyJson':
        out = s ? '{}' : s;
        break;
      case 'contact':
        out = s.includes('@') ? this.unique('email', s.trim().toLowerCase(), () => m.email(s)) : m.street(s);
        break;
      case 'emailOrReference':
        out = s.includes('@')
          ? this.unique('email', s.trim().toLowerCase(), () => m.email(s))
          : this.unique('reference', s, () => m.reference(s));
        break;
      case 'last4':
        out = s ? '4242' : s;
        break;
    }
    return { ...v, value: this.fit(out, column) };
  }

  /** Mask the personal parts of a JSON document; it stays valid JSON with the same shape. */
  private json(s: string, all = false): string {
    let doc: unknown;
    try {
      doc = JSON.parse(s);
    } catch {
      // Not JSON after all: treat it as free text, but keep it syntactically harmless.
      return s.trim() ? this.masker.text(s) : s;
    }
    const walk = (node: unknown, key: string): unknown => {
      if (Array.isArray(node)) return node.map((n) => walk(n, key));
      if (node && typeof node === 'object')
        return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]));
      if (typeof node === 'string' && node) {
        if (all) return this.anyString(node);
        const h = heuristic(key);
        if (h && h !== 'keep') {
          const masked = this.apply(
            h,
            { kind: 'str', value: node },
            { name: key, type: 'text', maxLength: null, nullable: true },
          );
          return masked.kind === 'str' ? masked.value : null;
        }
        return node.replace(EMAIL_IN_TEXT, (m) =>
          this.unique('email', m.toLowerCase(), () => this.masker.email(m)),
        );
      }
      return node;
    };
    return JSON.stringify(walk(doc, ''));
  }

  /** A string of unknown meaning inside personal JSON: keep its kind, lose its content. */
  private anyString(v: string): string {
    const m = this.masker;
    if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.trim()))
      return this.unique('email', v.trim().toLowerCase(), () => m.email(v));
    if (/^https?:\/\//i.test(v)) return `https://example.com/masked/${m.digest('url', v).slice(0, 10)}`;
    if (/^\+?[\d\s().-]{7,}$/.test(v) && v.replace(/\D/g, '').length >= 7)
      return this.unique('phone', v.replace(/\D/g, ''), () => m.phone(v));
    if (/^\d{4}-\d{2}-\d{2}/.test(v) || /^\d{1,2}:\d{2}/.test(v)) return v; // dates and times aren't personal
    if (/^\d+$/.test(v)) {
      // Door, parking or Wi-Fi codes are often all digits: same length, new digits.
      const d = BigInt(`0x${m.digest('digits', v)}`)
        .toString()
        .padStart(v.length, '0');
      return d.slice(0, v.length);
    }
    if (/^-?\d+\.\d+$/.test(v)) return v; // amounts and coordinates
    return m.text(v);
  }

  /** Same original → same masked value; a masked value is never shared by two originals. */
  private unique(kind: string, original: string, make: () => string): string {
    if (!original) return original;
    let byOriginal = this.seen.get(kind);
    let taken = this.used.get(kind);
    if (!byOriginal || !taken) {
      byOriginal = new Map();
      taken = new Set();
      this.seen.set(kind, byOriginal);
      this.used.set(kind, taken);
    }
    const known = byOriginal.get(original);
    if (known !== undefined) return known;
    let candidate = make();
    for (let n = 1; taken.has(candidate); n++) candidate = this.redraw(kind, candidate, n);
    byOriginal.set(original, candidate);
    taken.add(candidate);
    return candidate;
  }

  private redraw(kind: string, candidate: string, n: number): string {
    const d = this.masker.digest(`redraw:${kind}:${n}`, candidate);
    if (kind === 'email') return candidate.replace(/^u\.[0-9a-f]+/, `u.${d.slice(0, 12)}`);
    if (kind === 'phone')
      return `+1555${String(Number.parseInt(d.slice(0, 10), 16) % 10_000_000).padStart(7, '0')}`;
    return `${candidate.slice(0, Math.max(0, candidate.length - 6))}${d.slice(0, 6)}`;
  }

  /** Cut to the column's character length (strings only; never splits a surrogate pair). */
  private fit(value: string, column: TableDef['columns'][number] | null): string {
    const max = column?.maxLength;
    if (!max || value.length <= max) return value;
    return Array.from(value).slice(0, max).join('');
  }
}
