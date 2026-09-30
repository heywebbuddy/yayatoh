/**
 * Column privacy (roadmap §9, "canary leak test"). Every text, jsonb and text[] column of a tenant
 * table is declared here by the module that owns the table: either **public** (it may appear on a
 * public page) or **private** with a class. The canary fixture (`@yayatoh/testing/canary`) seeds
 * `__CANARY_<schema>.<table>.<column>__` into every private column and the crawler fails on any
 * canary that reaches a response it must not reach. A unit test compares these declarations with
 * the latest drizzle snapshot, so a new column cannot be skipped silently.
 */

/**
 * - `secret`: tokens, hashes, ciphertext, provider/bank account ids. Never in any response,
 *   export or outbound message (only a hash or prefix the owner sees in the console).
 * - `personal`: names, emails, phones, addresses, answers, messages. Never public; org-scoped
 *   responses and exports only where their allowlist names the column.
 * - `internal`: notes, reasons, internal flags, audit details, staff and system data. Never public
 *   and never in outbound messages.
 * - `holder`: shown to ticket holders or door staff only (join links, private info, ticket codes,
 *   access codes). Never public.
 */
export type PrivateClass = 'secret' | 'personal' | 'internal' | 'holder';

/**
 * How the canary fixture writes the canary (default from the SQL type: text → `text`,
 * jsonb → `json`, text[] → `array`).
 * - `email` / `phone` / `url` / `path` / `code`: a canary shaped to pass the column's CHECKs
 *   (`code`: `CANARY_<nn>_<row>`, for upper-case codes such as promo and access codes).
 * - `key-prefix`: keeps the value's `yy_live_` / `yy_test_` head (API key prefixes, whose CHECK
 *   ties the head to the key's mode) and replaces the rest with the canary.
 * - `sealed`: the canary is encrypted with the org's key vault (plaintext exposure is what counts).
 * - `sealed-json`: the sealed JSON object gains a `__canary` key.
 * - `none`: not seedable; `why` must say where exposure is covered instead.
 */
export type CanarySeed =
  | 'text'
  | 'email'
  | 'phone'
  | 'url'
  | 'path'
  | 'code'
  | 'key-prefix'
  | 'json'
  | 'array'
  | 'sealed'
  | 'sealed-json'
  | 'none';

export interface PrivateColumn {
  readonly class: PrivateClass;
  readonly seed?: CanarySeed;
  /** Only rows matching this SQL predicate hold private data (the rest are public). */
  readonly where?: string;
  readonly why?: string;
}

/**
 * `public`: free text meant to be shown publicly (names, descriptions, public content).
 * `vocab`: a machine value from a closed set (status, kind, currency, locale, timezone, ISO code);
 * it cannot carry personal data. Both count as "explicitly public".
 */
export type ColumnRule = 'public' | 'vocab' | PrivateColumn;

export interface SchemaPrivacy {
  readonly schema: string;
  /** table → column (SQL names) → rule. */
  readonly tables: Readonly<Record<string, Readonly<Record<string, ColumnRule>>>>;
}

/** Declares the privacy of a module's tenant tables (keys are SQL names). */
export function columnPrivacy(
  schema: string,
  tables: Record<string, Record<string, ColumnRule>>,
): SchemaPrivacy {
  return { schema, tables };
}

type Opts = Omit<PrivateColumn, 'class' | 'seed'>;
const rule =
  (cls: PrivateClass) =>
  (seed?: CanarySeed, opts: Opts = {}): PrivateColumn => ({ class: cls, ...(seed ? { seed } : {}), ...opts });

export const secret = rule('secret');
export const personal = rule('personal');
export const internal = rule('internal');
export const holder = rule('holder');
