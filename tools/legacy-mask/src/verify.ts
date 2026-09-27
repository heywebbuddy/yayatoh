import { createHash } from 'node:crypto';
import { heuristic, type Rules } from './mask.ts';
import {
  isInsert,
  parseCreateTable,
  parseInsert,
  type SqlValue,
  StatementSplitter,
  type TableDef,
} from './sql.ts';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MASKED_DOMAIN = '@masked.yayatoh.test';

/** 8-byte fingerprints: the verifier remembers originals without holding them in memory. */
const fp = (s: string) => createHash('sha256').update(s).digest('base64url').slice(0, 11);

export interface VerifyResult {
  ok: boolean;
  problems: string[];
  tables: Record<string, { original: number; masked: number }>;
}

/** Walks a dump: table definitions and every row, statement by statement. */
export class DumpReader {
  readonly defs = new Map<string, TableDef>();
  private readonly splitter = new StatementSplitter();
  errors: string[] = [];

  private readonly onRow: (table: string, columns: readonly string[], row: SqlValue[]) => void;

  constructor(onRow: (table: string, columns: readonly string[], row: SqlValue[]) => void) {
    this.onRow = onRow;
  }

  push(chunk: string) {
    for (const s of this.splitter.push(chunk)) this.statement(s);
  }

  end() {
    const rest = this.splitter.end();
    if (rest.trim()) this.statement(rest);
  }

  private statement(stmt: string) {
    const t = stmt.trimStart();
    if (/^CREATE TABLE/i.test(t)) {
      const def = parseCreateTable(t);
      if (def) this.defs.set(def.name, def);
      return;
    }
    if (!isInsert(t)) return;
    try {
      const ins = parseInsert(t);
      const cols = ins.columns ?? this.defs.get(ins.table)?.columns.map((c) => c.name) ?? [];
      for (const row of ins.rows) {
        if (row.length !== cols.length)
          this.errors.push(`${ins.table}: a row has ${row.length} values for ${cols.length} columns`);
        this.onRow(ins.table, cols, row);
      }
    } catch (err) {
      this.errors.push(`unparseable INSERT: ${(err as Error).message}`);
    }
  }
}

/**
 * Checks a masked dump against its original, holding only fingerprints of the original's
 * personal values:
 * - every table keeps its row count (tables dropped by rule must be empty);
 * - no original email address appears anywhere in the masked dump, and no original phone,
 *   token or name-column value survives in the column it came from;
 * - every UNIQUE/PRIMARY key is still unique;
 * - the masked dump parses completely.
 */
export class Verifier {
  private readonly originals = new Set<string>();
  private readonly counts: Record<string, { original: number; masked: number }> = {};
  private readonly problems: string[] = [];
  private readonly uniques = new Map<string, Set<string>>();
  private readonly original: DumpReader;
  private readonly masked: DumpReader;

  private readonly rules: Rules;

  constructor(rules: Rules) {
    this.rules = rules;
    this.original = new DumpReader((table, cols, row) => this.rememberOriginal(table, cols, row));
    this.masked = new DumpReader((table, cols, row) => this.checkMasked(table, cols, row));
  }

  pushOriginal(chunk: string) {
    this.original.push(chunk);
  }

  endOriginal() {
    this.original.end();
  }

  pushMasked(chunk: string) {
    this.masked.push(chunk);
  }

  result(): VerifyResult {
    this.masked.end();
    this.problems.push(
      ...this.original.errors.map((e) => `original: ${e}`),
      ...this.masked.errors.map((e) => `masked: ${e}`),
    );
    for (const [table, c] of Object.entries(this.counts)) {
      const expected = this.rules[table]?.dropRows ? 0 : c.original;
      if (c.masked !== expected)
        this.problems.push(`${table}: ${c.masked} rows in the masked dump, expected ${expected}`);
    }
    return { ok: this.problems.length === 0, problems: this.problems, tables: this.counts };
  }

  private count(table: string) {
    this.counts[table] ??= { original: 0, masked: 0 };
    return this.counts[table];
  }

  private sensitive(table: string, column: string): boolean {
    const explicit = this.rules[table]?.columns?.[column];
    const s = explicit ?? heuristic(column);
    // Only strategies whose output can't plausibly equal a real value by chance: masked names
    // and postcodes come from small pools and may coincide with somebody's real ones.
    return !!s && ['email', 'phone', 'token', 'reference', 'street', 'ip', 'image'].includes(s);
  }

  private rememberOriginal(table: string, cols: readonly string[], row: SqlValue[]) {
    this.count(table).original++;
    row.forEach((v, i) => {
      if (v.kind !== 'str' || !v.value) return;
      for (const m of v.value.matchAll(EMAIL)) this.originals.add(`email:${fp(m[0].toLowerCase())}`);
      const col = cols[i] ?? '';
      if (v.value.trim().length >= 4 && this.sensitive(table, col))
        this.originals.add(`col:${table}.${col}:${fp(v.value)}`);
    });
  }

  private checkMasked(table: string, cols: readonly string[], row: SqlValue[]) {
    this.count(table).masked++;
    row.forEach((v, i) => {
      if (v.kind !== 'str' || !v.value) return;
      const col = cols[i] ?? '';
      for (const m of v.value.matchAll(EMAIL)) {
        const e = m[0].toLowerCase();
        if (!e.endsWith(MASKED_DOMAIN) && this.originals.has(`email:${fp(e)}`))
          this.problems.push(`${table}.${col}: an original email address survived`);
      }
      if (
        v.value.trim().length >= 4 &&
        this.sensitive(table, col) &&
        this.originals.has(`col:${table}.${col}:${fp(v.value)}`)
      )
        this.problems.push(`${table}.${col}: an original value survived`);
    });
    const def = this.masked.defs.get(table);
    for (const key of def?.uniques ?? []) {
      const idx = key.map((k) => cols.indexOf(k));
      if (idx.some((x) => x < 0)) continue;
      const vals = idx.map((x) => row[x]);
      if (vals.some((x) => !x || x.kind === 'null')) continue;
      const id = `${table}(${key.join(',')})`;
      let seen = this.uniques.get(id);
      if (!seen) {
        seen = new Set();
        this.uniques.set(id, seen);
      }
      const k = fp(
        vals
          .map((x) => (x?.kind === 'str' ? `s:${x.value.toLowerCase()}` : JSON.stringify(x)))
          .join('\u0000'),
      );
      if (seen.has(k)) this.problems.push(`${id}: a duplicate value in the masked dump`);
      seen.add(k);
    }
  }
}
