import type { TenantTx } from '@yayatoh/db';
import type { Ctx } from '@yayatoh/kernel';
import { sql } from 'drizzle-orm';

/** A row an owning module moved from one contact to the other (`table` is `schema.table`). */
export interface MovedRow {
  readonly table: string;
  readonly id: string;
}

/** One merge step: move what belongs to `fromContactId` onto `toContactId`. */
export interface MergeStep {
  readonly mergeId: string;
  readonly fromContactId: string;
  readonly toContactId: string;
}

/**
 * A module that holds references to crm contacts (M6.1a, ADR 0023). The merge command calls every
 * registered owner inside its own transaction, through the owner's public functions, so each
 * module writes only its own tables:
 * - `move` re-points the module's rows from the duplicate to the record that stays and returns
 *   exactly the rows it moved (crm records them in `contact_merge_moves`). A row whose move would
 *   break one of the module's unique keys (the same campaign sent to both, say) stays on the
 *   duplicate and is counted in `kept`; the merged record still shows it in the timeline.
 * - `restore` (undo) moves back exactly the recorded rows that are still on the target, and
 *   returns the ones it moved.
 * `projections` owners (the participation projector) run after every `references` owner, so
 * they recompute from sources that already moved.
 */
export interface ContactReferenceOwner {
  readonly module: string;
  /** The contact columns this owner moves, `schema.table.column` (the coverage guard reads them). */
  readonly columns: readonly string[];
  readonly phase?: 'references' | 'projections';
  move(
    tx: TenantTx,
    ctx: Ctx,
    step: MergeStep,
  ): Promise<{ moved: readonly MovedRow[]; kept?: Readonly<Record<string, number>> }>;
  restore(
    tx: TenantTx,
    ctx: Ctx,
    step: MergeStep & { rows: readonly MovedRow[] },
  ): Promise<readonly MovedRow[]>;
}

let owners: readonly ContactReferenceOwner[] = [];

/**
 * Register the contact reference owners (each app's composition root, and the test ports). The
 * merge refuses to run while any contact column in the database has no owner (see
 * `uncoveredContactColumnsTx`), so a missing registration can never merge half a person.
 */
export function registerContactReferenceOwners(list: readonly ContactReferenceOwner[]): void {
  const seen = new Set<string>();
  for (const o of list)
    for (const c of o.columns) {
      if (seen.has(c)) throw new Error(`contact column ${c} has two owners`);
      seen.add(c);
    }
  owners = [...list];
}

/** The registered owners, `references` first, then `projections`. */
export function contactReferenceOwners(): readonly ContactReferenceOwner[] {
  return [
    ...owners.filter((o) => (o.phase ?? 'references') === 'references'),
    ...owners.filter((o) => o.phase === 'projections'),
  ];
}

/**
 * Every uuid column outside the crm schema named `contact_id` or `*_contact_id` (the house
 * convention for a reference to a crm contact), as `schema.table.column`.
 */
export async function contactColumnsTx(tx: TenantTx): Promise<string[]> {
  const rows = await tx.execute<{ col: string }>(sql`
    select n.nspname || '.' || c.relname || '.' || a.attname as col
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
      and a.atttypid = 'uuid'::regtype
      and (a.attname = 'contact_id' or a.attname like '%\\_contact\\_id')
      and n.nspname not in ('crm', 'pg_catalog', 'information_schema')
    order by 1`);
  return rows.map((r) => r.col);
}

/** Contact columns no registered owner moves (the merge refuses while any exist). */
export async function uncoveredContactColumnsTx(tx: TenantTx): Promise<string[]> {
  const covered = new Set(owners.flatMap((o) => o.columns));
  return (await contactColumnsTx(tx)).filter((c) => !covered.has(c));
}
