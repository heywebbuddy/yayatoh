import type { ColumnRule, SchemaPrivacy, TenantTx } from '@yayatoh/db';
import type { Ctx } from '@yayatoh/kernel';

/**
 * Data-subject requests across modules (M6.1c; roadmap §10 Privacy, ADR 0023 "contact reference
 * owners"). One request exports or erases a person everywhere the org holds them. Every module
 * that keeps personal data exports a `DataSubjectContributor` from its index; each app's
 * composition root registers them (`registerDataSubjectContributors`, like the key vault and the
 * contact-reference owners). The privacy module runs them inside one tenant transaction.
 *
 * A contributor writes only its own tables. It declares every table it covers and what erasure
 * does there; the coverage test (`subjectCoverage`, packages/testing) fails when a table with a
 * personal or holder column (the column-privacy registry) has no contributor.
 */

/** Why a row survives an erasure (listed in the signed receipt). */
export const LEGAL_HOLD_BASES = [
  /** Orders, payments, refunds, credit notes and the ledger: tax and accounting (D11, 7 years). */
  'tax_accounting',
  /** Card disputes: evidence the payment provider and card networks may ask for. */
  'payment_dispute',
  /** Consent history and the request record itself: proof the org acted lawfully (GDPR Art. 5(2)). */
  'accountability',
] as const;
export type LegalHoldBasis = (typeof LEGAL_HOLD_BASES)[number];

/**
 * What erasure does to a table's rows about the person:
 * - `delete`: the rows are deleted;
 * - `redact`: the rows stay (other records depend on them) with every personal value replaced;
 * - `hold`: rows that must be kept are kept under a legal hold with the person's name and contact
 *   details replaced, and listed in the receipt (other rows are redacted or deleted);
 * - `none`: the table holds no data about a data subject (`why` says why: organizer content shown
 *   to ticket holders, staff settings …).
 */
export type SubjectTableAction =
  | { readonly action: 'delete' }
  | { readonly action: 'redact' }
  | { readonly action: 'hold'; readonly basis: LegalHoldBasis }
  | { readonly action: 'none'; readonly why: string };

export const DELETE: SubjectTableAction = { action: 'delete' };
export const REDACT: SubjectTableAction = { action: 'redact' };
export const hold = (basis: LegalHoldBasis): SubjectTableAction => ({ action: 'hold', basis });
export const notSubject = (why: string): SubjectTableAction => ({ action: 'none', why });

/** Record ids found for the person, by kind (`contact`, `order`, `ticket` …), plus `name`s. */
export type SubjectRefs = Readonly<Record<string, readonly string[]>>;

export interface DataSubject {
  readonly orgId: string;
  /** The normalized address (trimmed, lower case). */
  readonly email: string;
  /** Everything every contributor resolved (merged until no contributor finds anything new). */
  readonly refs: SubjectRefs;
}

/** The ids of one kind the request resolved (`refsOf(s, 'order')`). */
export const refsOf = (s: Pick<DataSubject, 'refs'>, kind: string): string[] => [...(s.refs[kind] ?? [])];

/** A file the person gave or that was made about them (speaker uploads …), read lazily. */
export interface SubjectFile {
  /** Path inside the archive's `files/<module>/` folder (no slashes). */
  readonly name: string;
  readonly contentType: string;
  readonly read: () => Promise<Uint8Array | null>;
}

export interface SubjectExport {
  /** Allowlisted JSON, one section per kind of record. Empty sections are left out. */
  readonly sections: Readonly<Record<string, readonly unknown[]>>;
  readonly files?: readonly SubjectFile[];
}

/** A row kept after an erasure (no personal data: the id, a short label and the basis). */
export interface HeldRecord {
  /** `schema.table` */
  readonly table: string;
  readonly id: string;
  /** A short non-identifying reference, e.g. an order number or a status. */
  readonly ref: string;
  readonly basis: LegalHoldBasis;
  /** When the hold ends (ISO date), when known. */
  readonly until?: string | null;
}

export interface SubjectErasure {
  /** Rows deleted or redacted, by `schema.table`. */
  readonly erased: Readonly<Record<string, number>>;
  readonly held?: readonly HeldRecord[];
  /** Media assets whose stored files must go once the transaction commits (`media` deletes them). */
  readonly mediaAssets?: readonly string[];
}

export interface DataSubjectContributor {
  /** The module (`orders`, `crm` …): sections are written to `<module>.json`. */
  readonly module: string;
  /** Every table it covers (`schema.table`) and what erasure does there. */
  readonly tables: Readonly<Record<string, SubjectTableAction>>;
  /**
   * The person's record ids in this module, from the address and what other modules found.
   * Called again while any contributor finds something new, so it must be idempotent.
   */
  resolve?(tx: TenantTx, s: DataSubject, ctx: Ctx): Promise<SubjectRefs>;
  export(tx: TenantTx, s: DataSubject, ctx: Ctx): Promise<SubjectExport>;
  erase(tx: TenantTx, s: DataSubject, ctx: Ctx): Promise<SubjectErasure>;
}

export function defineDataSubjectContributor(c: DataSubjectContributor): DataSubjectContributor {
  for (const [table, a] of Object.entries(c.tables)) {
    if (!/^[a-z_]+\.[a-z_]+$/.test(table)) throw new Error(`${c.module}: bad table name "${table}"`);
    if (a.action === 'none' && a.why.trim().length < 10)
      throw new Error(`${c.module}: ${table} needs a reason why it holds no data subject`);
  }
  return c;
}

/**
 * Connector hooks (M6.4): integrations that copied a person to a third party (Mailchimp, HubSpot …)
 * propagate the erasure there. Called after the erasure commits, from the outbox event
 * `privacy.subject_erased@1` (at least once). None are registered until M6.4.
 */
export interface ErasureConnectorHook {
  readonly name: string;
  onErased(input: {
    readonly orgId: string;
    readonly requestId: string;
    /** SHA-256 of the normalized address: connectors match on it, never on the address. */
    readonly subjectRef: string;
  }): Promise<void>;
}

let contributors: readonly DataSubjectContributor[] | null = null;
let hooks: readonly ErasureConnectorHook[] = [];

/** Register every module's contributor in the app's composition root. */
export function registerDataSubjectContributors(list: readonly DataSubjectContributor[]): void {
  const seen = new Map<string, string>();
  for (const c of list)
    for (const t of Object.keys(c.tables)) {
      const other = seen.get(t);
      if (other) throw new Error(`${t} is declared by both ${other} and ${c.module}`);
      seen.set(t, c.module);
    }
  contributors = list;
}

export function dataSubjectContributors(): readonly DataSubjectContributor[] {
  if (!contributors) throw new Error('No data-subject contributors registered (composition root)');
  return contributors;
}

export function registerErasureConnectorHooks(list: readonly ErasureConnectorHook[]): void {
  hooks = list;
}

export const erasureConnectorHooks = (): readonly ErasureConnectorHook[] => hooks;

export interface SubjectCoverageProblem {
  readonly table: string;
  readonly message: string;
}

const PERSONAL = (r: ColumnRule) => typeof r === 'object' && (r.class === 'personal' || r.class === 'holder');

/**
 * Every table with a personal or holder column (the column-privacy registry) must be declared
 * by exactly one contributor, and every declaration must name a registered table. Returns one
 * problem per gap with the line to add.
 */
export function subjectCoverage(
  list: readonly DataSubjectContributor[],
  privacy: readonly SchemaPrivacy[],
  /** Every tenant table (`schema.table`), for declarations of tables without text columns. */
  tenantTables: ReadonlySet<string> = new Set(),
): SubjectCoverageProblem[] {
  const problems: SubjectCoverageProblem[] = [];
  const declared = new Map<string, string[]>();
  for (const c of list)
    for (const t of Object.keys(c.tables)) declared.set(t, [...(declared.get(t) ?? []), c.module]);
  const known = new Set<string>();
  for (const s of privacy)
    for (const [table, cols] of Object.entries(s.tables)) {
      const id = `${s.schema}.${table}`;
      known.add(id);
      const personal = Object.entries(cols)
        .filter(([, r]) => PERSONAL(r))
        .map(([c]) => c);
      if (personal.length === 0 || declared.has(id)) continue;
      problems.push({
        table: id,
        message: `${id} has personal or holder columns (${personal.join(', ')}) but no data-subject contributor. Add \`'${id}': DELETE | REDACT | hold(basis) | notSubject(why)\` to the ${s.schema} module's contributor (src/data-subject.ts) and register it.`,
      });
    }
  for (const [id, mods] of declared) {
    if (mods.length > 1)
      problems.push({
        table: id,
        message: `${id} is declared by more than one contributor (${mods.join(', ')})`,
      });
    if (!known.has(id) && !tenantTables.has(id))
      problems.push({
        table: id,
        message: `${id} is declared by ${mods.join(', ')} but is not a tenant table (renamed or dropped?)`,
      });
  }
  return problems.sort((a, b) => a.table.localeCompare(b.table));
}
