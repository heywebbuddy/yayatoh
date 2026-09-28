import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import type { Writable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import type { MigratorSql } from '@yayatoh/db/migration';
import { isInsert, parseInsert, type SqlValue, StatementSplitter } from '@yayatoh/legacy-mask';
import { ident, stagingSchema } from './sql.ts';

/**
 * Load a mysqldump into the platform-owned staging schema `legacy_{inst}` (roadmap §7.5 step 2),
 * streaming (any dump size) with legacy-mask's reader instead of pgloader. Type rules:
 *  - DATETIME/TIMESTAMP → `timestamp` WITHOUT time zone (the transforms apply the zone rules);
 *  - tinyint(1) → smallint; unsigned (and every other integer) → bigint; zero dates → null;
 *  - TEXT and strings stay text; JSON columns are parsed, and a value that is not JSON is loaded as
 *    null and quarantined (JSON kept inside text columns is checked by `legacy.try_jsonb()` later).
 * Anything a column cannot hold (an impossible date, a TIME past 24 h) is quarantined the same way.
 * The staging schema is dropped and recreated on every load; `app_user` has no access to it.
 */
export interface ColumnDef {
  readonly name: string;
  readonly mysqlType: string;
  readonly pgType: string;
  readonly kind: 'int' | 'numeric' | 'float' | 'text' | 'json' | 'date' | 'timestamp' | 'time' | 'bytea';
}

export interface LoadIssue {
  readonly table: string;
  readonly legacyId: string | null;
  readonly column: string;
  readonly reason: 'invalid_json' | 'invalid_date' | 'invalid_time' | 'invalid_number' | 'nul_byte';
  readonly detail: string;
}

export interface LoadResult {
  readonly schema: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly dumpTimeZone: string | null;
  readonly tables: Record<string, number>;
  readonly issues: LoadIssue[];
  readonly synthetic: boolean;
}

const COL = /^`([^`]+)`\s+([a-zA-Z]+)(\(([^)]*)\))?(\s+unsigned)?/i;

/** Map one column of a MySQL `CREATE TABLE` to its staging type (§7.5 type rules). */
export function mapColumn(line: string): ColumnDef | null {
  const m = COL.exec(line.trim());
  if (!m?.[1] || !m[2]) return null;
  const base = m[2].toLowerCase();
  const args = m[4] ?? '';
  const mysqlType = `${base}${m[3] ?? ''}${m[5] ? ' unsigned' : ''}`;
  const def = (pgType: string, kind: ColumnDef['kind']): ColumnDef => ({
    name: m[1] as string,
    mysqlType,
    pgType,
    kind,
  });
  switch (base) {
    case 'tinyint':
      return def('smallint', 'int');
    case 'smallint':
    case 'mediumint':
    case 'int':
    case 'integer':
    case 'bigint':
    case 'year':
      return def('bigint', 'int');
    case 'bit':
      return def('bigint', 'int');
    case 'decimal':
    case 'numeric':
      return def(args ? `numeric(${args})` : 'numeric', 'numeric');
    case 'float':
    case 'double':
    case 'real':
      return def('double precision', 'float');
    case 'json':
      return def('jsonb', 'json');
    case 'date':
      return def('date', 'date');
    case 'datetime':
    case 'timestamp':
      return def('timestamp without time zone', 'timestamp');
    case 'time':
      return def('time', 'time');
    case 'binary':
    case 'varbinary':
    case 'blob':
    case 'tinyblob':
    case 'mediumblob':
    case 'longblob':
      return def('bytea', 'bytea');
    default:
      // char, varchar, the text family, enum, set
      return def('text', 'text');
  }
}

export function parseCreate(stmt: string): { table: string; columns: ColumnDef[] } | null {
  const head = /^\s*CREATE TABLE (?:IF NOT EXISTS )?`([^`]+)`\s*\(/i.exec(stmt);
  if (!head?.[1]) return null;
  const columns: ColumnDef[] = [];
  for (const line of stmt.slice(head[0].length).split('\n')) {
    const c = mapColumn(line);
    if (c) columns.push(c);
  }
  return { table: head[1], columns };
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?$/;
const TIME = /^(-)?(\d{2,3}):(\d{2}):(\d{2})(\.\d+)?$/;

function realDate(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

type Converted = { value: string | null; issue?: LoadIssue['reason'] };

/** One dumped value → a COPY text field (or null), per the column's staging type. */
export function convertValue(v: SqlValue, col: ColumnDef): Converted {
  if (v.kind === 'null') return { value: null };
  const text = v.kind === 'str' ? v.value : v.kind === 'hex' ? v.raw : v.raw;
  switch (col.kind) {
    case 'int': {
      const t = text.trim();
      if (/^[-+]?\d+$/.test(t)) return { value: t.replace(/^\+/, '') };
      if (/^[-+]?\d+\.0*$/.test(t)) return { value: t.replace(/^\+/, '').replace(/\..*$/, '') };
      if (t === '') return { value: null };
      return { value: null, issue: 'invalid_number' };
    }
    case 'numeric':
    case 'float': {
      const t = text.trim();
      if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return { value: t };
      if (t === '') return { value: null };
      return { value: null, issue: 'invalid_number' };
    }
    case 'json': {
      try {
        JSON.parse(text);
        return { value: text };
      } catch {
        return { value: null, issue: 'invalid_json' };
      }
    }
    case 'date': {
      const t = text.trim();
      if (t === '' || /^0000-00-00/.test(t)) return { value: null };
      const m = DATE.exec(t) ?? DATETIME.exec(t);
      if (!m || !realDate(Number(m[1]), Number(m[2]), Number(m[3])))
        return { value: null, issue: 'invalid_date' };
      return { value: t.slice(0, 10) };
    }
    case 'timestamp': {
      const t = text.trim();
      if (t === '' || /^0000-00-00/.test(t)) return { value: null };
      const m = DATETIME.exec(t);
      const d = DATE.exec(t);
      if (d && realDate(Number(d[1]), Number(d[2]), Number(d[3]))) return { value: `${t} 00:00:00` };
      if (
        !m ||
        !realDate(Number(m[1]), Number(m[2]), Number(m[3])) ||
        Number(m[4]) > 23 ||
        Number(m[5]) > 59 ||
        Number(m[6]) > 59
      )
        return { value: null, issue: 'invalid_date' };
      return { value: t };
    }
    case 'time': {
      const t = text.trim();
      if (t === '') return { value: null };
      const m = TIME.exec(t);
      if (!m || m[1] || Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4]) > 59)
        return { value: null, issue: 'invalid_time' };
      return { value: t };
    }
    case 'bytea':
      return {
        value: v.kind === 'hex' ? `\\x${v.raw.slice(2)}` : `\\x${Buffer.from(text, 'utf8').toString('hex')}`,
      };
    default:
      if (text.includes('\0')) return { value: text.replace(/\0/g, ''), issue: 'nul_byte' };
      return { value: text };
  }
}

/** COPY text format escaping. */
function copyField(v: string | null): string {
  if (v === null) return '\\N';
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

/** Columns worth an index for the transforms' joins. */
const indexable = (name: string) =>
  name === 'id' ||
  name.endsWith('_id') ||
  name === 'common_order' ||
  name === 'order_number' ||
  name === 'email';

export async function loadDump(
  sql: MigratorSql,
  instance: string,
  dumpPath: string,
  options: { onProgress?: (table: string, rows: number) => void } = {},
): Promise<LoadResult> {
  const schema = stagingSchema(instance);
  const S = ident(schema);
  await sql.unsafe(
    `drop schema if exists ${S} cascade; create schema ${S}; revoke all on schema ${S} from public;`,
  );
  await sql.unsafe(
    `create table ${S}._columns (table_name text, column_name text, ordinal int, mysql_type text, pg_type text)`,
  );

  const defs = new Map<string, ColumnDef[]>();
  const tables: Record<string, number> = {};
  const issues: LoadIssue[] = [];
  const hash = createHash('sha256');
  let bytes = 0;
  let dumpTimeZone: string | null = null;
  let synthetic = false;

  // One COPY stream open at a time: mysqldump writes each table's INSERTs together.
  let copy: { table: string; stream: Writable; buffer: string[]; size: number } | null = null;
  const flushCopy = async () => {
    if (!copy || copy.buffer.length === 0) return;
    const chunk = copy.buffer.join('');
    copy.buffer = [];
    copy.size = 0;
    if (!copy.stream.write(chunk)) await once(copy.stream, 'drain');
  };
  const closeCopy = async () => {
    if (!copy) return;
    await flushCopy();
    const s = copy.stream;
    s.end();
    await once(s, 'finish');
    copy = null;
  };

  const handle = async (stmt: string) => {
    if (/^\s*--/.test(stmt)) {
      if (stmt.includes('SYNTHETIC TEST DATA ONLY')) synthetic = true;
      return;
    }
    const tz = /SET TIME_ZONE='([^']+)'/i.exec(stmt);
    if (tz?.[1]) dumpTimeZone = tz[1];
    const create = /^\s*CREATE TABLE/i.test(stmt) ? parseCreate(stmt) : null;
    if (create) {
      await closeCopy();
      defs.set(create.table, create.columns);
      tables[create.table] = 0;
      const cols = create.columns.map((c) => `${ident(c.name)} ${c.pgType}`).join(', ');
      await sql.unsafe(`create table ${S}.${ident(create.table)} (${cols})`);
      await sql`insert into ${sql(schema)}._columns ${sql(
        create.columns.map((c, i) => ({
          table_name: create.table,
          column_name: c.name,
          ordinal: i + 1,
          mysql_type: c.mysqlType,
          pg_type: c.pgType,
        })),
      )}`;
      return;
    }
    if (!isInsert(stmt)) return;
    const ins = parseInsert(stmt);
    const cols = defs.get(ins.table);
    if (!cols) throw new Error(`INSERT into ${ins.table} before its CREATE TABLE`);
    const order = ins.columns
      ? ins.columns.map((n) => cols.findIndex((c) => c.name === n))
      : cols.map((_, i) => i);
    if (order.some((i) => i < 0)) throw new Error(`INSERT into ${ins.table} names an unknown column`);
    if (!copy || copy.table !== ins.table) {
      await closeCopy();
      const names = order.map((i) => ident((cols[i] as ColumnDef).name)).join(', ');
      const stream = await sql.unsafe(`copy ${S}.${ident(ins.table)} (${names}) from stdin`).writable();
      copy = { table: ins.table, stream, buffer: [], size: 0 };
    }
    const idIdx = cols.findIndex((c) => c.name === 'id');
    for (const row of ins.rows) {
      const fields: string[] = [];
      const legacyId =
        idIdx >= 0
          ? (() => {
              const pos = order.indexOf(idIdx);
              const v = pos >= 0 ? row[pos] : undefined;
              return v && v.kind !== 'null' ? (v.kind === 'str' ? v.value : v.raw) : null;
            })()
          : null;
      for (const [pos, ci] of order.entries()) {
        const col = cols[ci] as ColumnDef;
        const c = convertValue(row[pos] ?? { kind: 'null' }, col);
        if (c.issue) {
          const raw = row[pos];
          const text = raw && raw.kind !== 'null' ? (raw.kind === 'str' ? raw.value : raw.raw) : '';
          issues.push({
            table: ins.table,
            legacyId,
            column: col.name,
            reason: c.issue,
            detail: text.slice(0, 120),
          });
        }
        fields.push(copyField(c.value));
      }
      const line = `${fields.join('\t')}\n`;
      copy.buffer.push(line);
      copy.size += line.length;
      tables[ins.table] = (tables[ins.table] ?? 0) + 1;
    }
    if (copy.size > 1 << 20) await flushCopy();
    options.onProgress?.(ins.table, tables[ins.table] ?? 0);
  };

  const splitter = new StatementSplitter();
  const source = createReadStream(dumpPath);
  const input = dumpPath.endsWith('.gz') ? source.pipe(createGunzip()) : source;
  source.on('data', (b: Buffer | string) => {
    hash.update(b);
    bytes += b.length;
  });
  input.setEncoding('utf8');
  for await (const chunk of input) for (const stmt of splitter.push(chunk as string)) await handle(stmt);
  const rest = splitter.end();
  if (rest.trim()) await handle(rest);
  await closeCopy();

  // Indexes for the transforms, row statistics, and no access for the runtime roles.
  for (const [table, cols] of defs)
    for (const c of cols.filter((x) => indexable(x.name)))
      await sql.unsafe(`create index on ${S}.${ident(table)} (${ident(c.name)})`);
  await sql.unsafe(`create table ${S}._load (key text primary key, value text)`);
  await sql`insert into ${sql(schema)}._load ${sql([
    { key: 'sha256', value: hash.digest('hex') },
    { key: 'bytes', value: String(bytes) },
    { key: 'dump_time_zone', value: dumpTimeZone ?? '' },
    { key: 'synthetic', value: String(synthetic) },
    { key: 'tables', value: JSON.stringify(tables) },
  ])}`;
  await sql.unsafe(`revoke all on all tables in schema ${S} from app_user, platform_reader`);
  for (const table of defs.keys()) await sql.unsafe(`analyze ${S}.${ident(table)}`);
  const [load] = await sql<{ value: string }[]>`select value from ${sql(schema)}._load where key = 'sha256'`;
  return { schema, sha256: load?.value ?? '', bytes, dumpTimeZone, tables, issues, synthetic };
}
