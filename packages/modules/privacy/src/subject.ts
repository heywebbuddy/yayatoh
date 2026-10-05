import type { TenantTx } from '@yayatoh/db';
import { type Ctx, requireOrg } from '@yayatoh/kernel';
import {
  type DataSubject,
  type DataSubjectContributor,
  dataSubjectContributors,
  type HeldRecord,
  type SubjectFile,
} from '@yayatoh/platform';

/**
 * Runs the registered contributors (M6.1c) for one person inside the caller's tenant
 * transaction: resolve their records across modules, collect the export, or erase.
 */

/** A module may need ids another module finds (forms answers by order id …): resolve to a fixpoint. */
const MAX_PASSES = 6;

export async function resolveDataSubjectTx(
  tx: TenantTx,
  ctx: Ctx,
  email: string,
  list: readonly DataSubjectContributor[] = dataSubjectContributors(),
): Promise<DataSubject> {
  const refs = new Map<string, Set<string>>();
  const snapshot = (): DataSubject => ({
    orgId: requireOrg(ctx),
    email,
    refs: Object.fromEntries([...refs].map(([k, v]) => [k, [...v].sort()])),
  });
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let grew = false;
    for (const c of list) {
      if (!c.resolve) continue;
      const found = await c.resolve(tx, snapshot(), ctx);
      for (const [kind, ids] of Object.entries(found)) {
        const set = refs.get(kind) ?? new Set<string>();
        for (const id of ids) {
          if (id === '' || set.has(id)) continue;
          set.add(id);
          grew = true;
        }
        refs.set(kind, set);
      }
    }
    if (!grew) break;
  }
  return snapshot();
}

export interface ModuleExport {
  readonly module: string;
  readonly sections: Readonly<Record<string, readonly unknown[]>>;
  readonly files: readonly SubjectFile[];
  readonly records: number;
}

/** Every module's allowlisted sections and files about the person (empty modules left out). */
export async function collectSubjectExportTx(
  tx: TenantTx,
  ctx: Ctx,
  subject: DataSubject,
  list: readonly DataSubjectContributor[] = dataSubjectContributors(),
): Promise<ModuleExport[]> {
  const out: ModuleExport[] = [];
  for (const c of list) {
    const e = await c.export(tx, subject, ctx);
    const sections = Object.fromEntries(Object.entries(e.sections).filter(([, rows]) => rows.length > 0));
    const files = e.files ?? [];
    const records = Object.values(sections).reduce((n, rows) => n + rows.length, 0);
    if (records === 0 && files.length === 0) continue;
    out.push({ module: c.module, sections, files, records });
  }
  return out;
}

/** Records per module (the "what the org holds" summary): counts only. */
export const summarizeExport = (mods: readonly ModuleExport[]): Record<string, number> =>
  Object.fromEntries(mods.map((m) => [m.module, m.records + m.files.length]));

export interface ErasureOutcome {
  /** `schema.table` → rows deleted or redacted (tables with none are left out). */
  readonly erased: Readonly<Record<string, number>>;
  /** What each table's declaration says erasure does there (for the receipt). */
  readonly actions: Readonly<Record<string, string>>;
  readonly held: readonly HeldRecord[];
  readonly mediaAssets: readonly string[];
}

/** Erase the person in every module. Contributors run in registration order (platform last). */
export async function eraseSubjectEverywhereTx(
  tx: TenantTx,
  ctx: Ctx,
  subject: DataSubject,
  list: readonly DataSubjectContributor[] = dataSubjectContributors(),
): Promise<ErasureOutcome> {
  const erased: Record<string, number> = {};
  const actions: Record<string, string> = {};
  const held: HeldRecord[] = [];
  const mediaAssets = new Set<string>();
  for (const c of list) {
    const r = await c.erase(tx, subject, ctx);
    for (const [table, n] of Object.entries(r.erased)) {
      if (!(table in c.tables)) throw new Error(`${c.module} erased ${table}, which it does not declare`);
      if (n > 0) {
        erased[table] = (erased[table] ?? 0) + n;
        actions[table] = (c.tables[table] as { action: string }).action;
      }
    }
    for (const h of r.held ?? []) {
      if (!(h.table in c.tables)) throw new Error(`${c.module} holds ${h.table}, which it does not declare`);
      held.push(h);
      actions[h.table] = 'hold';
    }
    for (const a of r.mediaAssets ?? []) mediaAssets.add(a);
  }
  held.sort((a, b) => a.table.localeCompare(b.table) || a.id.localeCompare(b.id));
  return { erased, actions, held, mediaAssets: [...mediaAssets].sort() };
}
