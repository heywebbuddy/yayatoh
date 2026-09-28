import type { SchemaPrivacy } from '@yayatoh/db';
import { isPrivate, registeredColumns } from './registry.ts';

/** The part of a drizzle-kit snapshot (`packages/db/drizzle/meta/NNNN_snapshot.json`) we read. */
export interface Snapshot {
  readonly tables: Record<
    string,
    {
      readonly schema: string;
      readonly name: string;
      readonly columns: Record<string, { readonly type: string }>;
    }
  >;
}

/** Column types that can hold a canary string. */
export const TEXTUAL = (type: string) =>
  /^(text|jsonb?|citext|bytea|character varying|varchar|character|char)(\(\d+\))?(\[\])?$/.test(type);

export interface CoverageProblem {
  readonly id: string;
  readonly message: string;
}

/**
 * Compares the column-privacy declarations with the schema: every textual column of a tenant
 * table (one with `org_id`, not in GLOBAL_TABLES) must be declared, and every declaration must
 * name a real textual column. `ownerOf(schema)` says where the declaration lives (for messages).
 */
export function columnCoverage(
  snapshot: Snapshot,
  privacy: readonly SchemaPrivacy[],
  globalTables: Readonly<Record<string, string>>,
  ownerOf: (schema: string) => string,
): CoverageProblem[] {
  const problems: CoverageProblem[] = [];
  const declared = new Map(registeredColumns(privacy).map((c) => [c.id, c]));
  const real = new Map<string, string>();
  for (const t of Object.values(snapshot.tables)) {
    const key = `${t.schema}.${t.name}`;
    if (!('org_id' in t.columns) || key in globalTables) continue;
    for (const [col, def] of Object.entries(t.columns)) {
      if (!TEXTUAL(def.type)) continue;
      const id = `${key}.${col}`;
      real.set(id, def.type);
      if (declared.has(id)) continue;
      const file = ownerOf(t.schema);
      const hasSchema = privacy.some((p) => p.schema === t.schema);
      const where = hasSchema
        ? `${file}: under \`${t.name}\``
        : `${file} (new): \`export const privateColumns = columnPrivacy('${t.schema}', { ${t.name}: { … } })\`, export it from the module's index and add it to COLUMN_PRIVACY in packages/testing/src/canary/registry.ts`;
      problems.push({
        id,
        message: `${id} (${def.type}) is neither private nor public. Add \`${col}: 'public' | 'vocab' | secret() | personal() | internal() | holder()\` in ${where}.`,
      });
    }
  }
  for (const [id, c] of declared) {
    const type = real.get(id);
    if (!type) {
      problems.push({
        id,
        message: `${id} is declared in ${ownerOf(c.schema)} but is not a textual column of a tenant table (renamed or dropped?). Remove or rename the entry.`,
      });
      continue;
    }
    if (!isPrivate(c.rule)) continue;
    const seed = c.rule.seed;
    if (seed === 'none' && !c.rule.why)
      problems.push({ id, message: `${id}: seed 'none' needs a \`why\` (where is its exposure covered?)` });
    const json = type.startsWith('json');
    if ((seed === 'json' && !json) || ((seed === 'sealed' || seed === 'sealed-json') && type !== 'text'))
      problems.push({ id, message: `${id}: seed '${seed}' does not fit the column type ${type}` });
    if (!json && type !== 'text' && seed && ['email', 'phone', 'url', 'path', 'code'].includes(seed))
      problems.push({ id, message: `${id}: seed '${seed}' needs a text column, not ${type}` });
    if (json && seed && !['json', 'none'].includes(seed))
      problems.push({ id, message: `${id}: a ${type} column takes seed 'json' (or 'none')` });
  }
  return problems;
}
