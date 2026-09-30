/**
 * Minimal mysqldump reader/writer for the legacy masking tool. It understands exactly what
 * `mysqldump` (MySQL 8) emits: comments, conditional comments, CREATE TABLE, and INSERT
 * statements (extended or single-row, with or without a column list). Values are parsed into
 * a small model and written back with MySQL's escaping, so a masked dump loads like the
 * original. No dependencies: it runs on the owner's server with plain Node 24.
 */

export type SqlValue =
  | { readonly kind: 'null' }
  | { readonly kind: 'num'; readonly raw: string }
  | { readonly kind: 'str'; readonly value: string; readonly introducer?: string }
  | { readonly kind: 'hex'; readonly raw: string }
  | { readonly kind: 'raw'; readonly raw: string };

export interface Column {
  readonly name: string;
  /** Lower-cased base type: varchar, text, json, int, datetime, … */
  readonly type: string;
  /** Character length for char/varchar (and text family maxima), else null. */
  readonly maxLength: number | null;
  /** False when the column is declared NOT NULL. */
  readonly nullable: boolean;
}

export interface TableDef {
  readonly name: string;
  readonly columns: readonly Column[];
  /** Column sets of UNIQUE/PRIMARY keys. */
  readonly uniques: readonly (readonly string[])[];
}

export interface InsertStatement {
  readonly table: string;
  /** Explicit column list (`--complete-insert`), or null to use the table's order. */
  readonly columns: readonly string[] | null;
  readonly rows: SqlValue[][];
  /** `INSERT IGNORE` / `REPLACE` etc. — the verb before INTO, kept as written. */
  readonly verb: string;
}

const TEXT_MAX: Record<string, number> = {
  tinytext: 255,
  text: 65_535,
  mediumtext: 16_777_215,
  longtext: 4_294_967_295,
};

/**
 * Split a dump into statements, chunk by chunk. A statement ends at `;` outside quotes and
 * comments; `--` / `#` line comments and blank lines outside statements are emitted as-is.
 */
export class StatementSplitter {
  private buf = '';
  private quote: string | null = null;
  private escaped = false;
  private inBlockComment = false;
  /** A non-whitespace character outside comments has been seen since `start`. */
  private inStatement = false;
  private start = 0;
  private scan = 0;

  /** Feed a chunk; returns every complete statement (or comment line) it finished. */
  push(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];
    const s = this.buf;
    let i = this.scan;
    for (; i < s.length; i++) {
      const c = s[i];
      if (this.quote) {
        if (this.escaped) this.escaped = false;
        else if (c === '\\') this.escaped = true;
        else if (c === this.quote) {
          // A doubled quote inside a string is an escaped quote; wait for the next chunk
          // when the quote is the last character we have.
          if (i + 1 >= s.length) break;
          if (s[i + 1] === this.quote) i++;
          else this.quote = null;
        }
        continue;
      }
      if (this.inBlockComment) {
        if (c === '*') {
          if (i + 1 >= s.length) break;
          if (s[i + 1] === '/') {
            this.inBlockComment = false;
            i++;
          }
        }
        continue;
      }
      if (!this.inStatement) {
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') continue;
        if (c === '#' || c === '-') {
          if (c === '-' && i + 2 >= s.length) break;
          const n = s[i + 1];
          const isComment = c === '#' || (n === '-' && /[\s]/.test(s[i + 2] ?? ''));
          if (isComment) {
            // A line comment outside a statement: emit the line whole.
            const nl = s.indexOf('\n', i);
            if (nl === -1) break;
            out.push(s.slice(this.start, nl + 1));
            this.start = nl + 1;
            i = nl;
            continue;
          }
        }
        this.inStatement = true;
      }
      if (c === "'" || c === '"' || c === '`') {
        this.quote = c;
        continue;
      }
      if (c === '/' && s[i + 1] === '*' && s[i + 2] !== '!') {
        this.inBlockComment = true;
        i++;
        continue;
      }
      if (c === ';') {
        // Include the trailing newline with the statement.
        let end = i + 1;
        if (end >= s.length) break;
        if (s[end] === '\r') end++;
        if (end >= s.length) break;
        if (s[end] === '\n') end++;
        out.push(s.slice(this.start, end));
        this.start = end;
        this.inStatement = false;
        i = end - 1;
      }
    }
    this.scan = i;
    if (this.start > 1 << 20) {
      this.buf = this.buf.slice(this.start);
      this.scan -= this.start;
      this.start = 0;
    }
    return out;
  }

  /** Whatever remains at end of input: a final statement without a trailing newline, or whitespace. */
  end(): string {
    const rest = this.buf.slice(this.start);
    this.buf = '';
    this.start = 0;
    this.scan = 0;
    this.inStatement = false;
    return rest;
  }
}

/** Parse a `CREATE TABLE` statement's columns, lengths and unique keys. */
export function parseCreateTable(stmt: string): TableDef | null {
  const head = /^\s*CREATE TABLE (?:IF NOT EXISTS )?`([^`]+)`\s*\(/i.exec(stmt);
  if (!head?.[1]) return null;
  const columns: Column[] = [];
  const uniques: string[][] = [];
  for (const line of stmt.slice(head[0].length).split('\n')) {
    const l = line.trim();
    const col = /^`([^`]+)`\s+([a-zA-Z]+)(?:\((\d+)(?:,\d+)?\))?/.exec(l);
    if (col?.[1] && col[2]) {
      const type = col[2].toLowerCase();
      const len =
        col[3] && (type === 'varchar' || type === 'char') ? Number(col[3]) : (TEXT_MAX[type] ?? null);
      columns.push({ name: col[1], type, maxLength: len, nullable: !/\bNOT NULL\b/i.test(l) });
      continue;
    }
    const key = /^(PRIMARY KEY|UNIQUE KEY(?: `[^`]+`)?)\s*\(([^)]*)\)/i.exec(l);
    if (key?.[2]) uniques.push([...key[2].matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? ''));
  }
  return { name: head[1], columns, uniques };
}

const INSERT_HEAD = /^\s*(INSERT(?:\s+IGNORE)?|REPLACE)\s+INTO\s+`([^`]+)`\s*(\(([^)]*)\))?\s*VALUES\s*/i;

/** Is this statement an INSERT/REPLACE … VALUES? (Cheap check before a full parse.) */
export const isInsert = (stmt: string) => INSERT_HEAD.test(stmt.slice(0, 4096));

/** Parse an INSERT … VALUES (…),(…); statement into rows of values. */
export function parseInsert(stmt: string): InsertStatement {
  const head = INSERT_HEAD.exec(stmt);
  if (!head?.[1] || !head[2]) throw new Error('not an INSERT … VALUES statement');
  const columns = head[4] ? [...head[4].matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '') : null;
  const rows: SqlValue[][] = [];
  let i = head[0].length;
  const s = stmt;
  const ws = () => {
    while (i < s.length && /\s/.test(s[i] ?? '')) i++;
  };
  for (;;) {
    ws();
    if (s[i] !== '(') throw new Error(`expected ( at ${i}`);
    i++;
    const row: SqlValue[] = [];
    for (;;) {
      ws();
      row.push(readValue());
      ws();
      if (s[i] === ',') {
        i++;
        continue;
      }
      if (s[i] === ')') {
        i++;
        break;
      }
      throw new Error(`expected , or ) at ${i}`);
    }
    rows.push(row);
    ws();
    if (s[i] === ',') {
      i++;
      continue;
    }
    if (s[i] === ';') break;
    throw new Error(`expected , or ; after a row at ${i}`);
  }
  return { table: head[2], columns, rows, verb: head[1].toUpperCase().replace(/\s+/g, ' ') };

  function readValue(): SqlValue {
    const rest = s.slice(i, i + 16);
    if (/^NULL\b/i.test(rest)) {
      i += 4;
      return { kind: 'null' };
    }
    if (/^0x[0-9a-f]/i.test(rest)) {
      const m = /^0x[0-9a-fA-F]*/.exec(s.slice(i)) as RegExpExecArray;
      i += m[0].length;
      return { kind: 'hex', raw: m[0] };
    }
    const intro = /^(_[a-z0-9]+)\s*'/i.exec(s.slice(i, i + 32));
    if (intro?.[1]) {
      i += intro[0].length - 1;
      return { kind: 'str', value: readString(), introducer: intro[1] };
    }
    if (s[i] === "'" || s[i] === '"') return { kind: 'str', value: readString() };
    const num = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(s.slice(i, i + 64));
    if (num) {
      i += num[0].length;
      return { kind: 'num', raw: num[0] };
    }
    // Anything else (e.g. a bare keyword) is kept verbatim up to the next , or ).
    const start = i;
    while (i < s.length && s[i] !== ',' && s[i] !== ')') i++;
    return { kind: 'raw', raw: s.slice(start, i).trim() };
  }

  function readString(): string {
    const q = s[i];
    i++;
    let out = '';
    for (;;) {
      if (i >= s.length) throw new Error('unterminated string');
      const c = s[i] as string;
      if (c === '\\') {
        const n = s[i + 1] ?? '';
        out += UNESCAPE[n] ?? n;
        i += 2;
        continue;
      }
      if (c === q) {
        if (s[i + 1] === q) {
          out += q;
          i += 2;
          continue;
        }
        i++;
        return out;
      }
      out += c;
      i++;
    }
  }
}

const UNESCAPE: Record<string, string> = { '0': '\0', n: '\n', r: '\r', t: '\t', b: '\b', Z: '\x1a' };

/** MySQL string escaping as mysqldump writes it (mysql_real_escape_string). */
export function escapeString(v: string): string {
  let out = '';
  for (const c of v) {
    switch (c) {
      case '\0':
        out += '\\0';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\\':
        out += '\\\\';
        break;
      case "'":
        out += "\\'";
        break;
      case '"':
        out += '\\"';
        break;
      case '\x1a':
        out += '\\Z';
        break;
      default:
        out += c;
    }
  }
  return out;
}

export function formatValue(v: SqlValue): string {
  switch (v.kind) {
    case 'null':
      return 'NULL';
    case 'num':
    case 'hex':
    case 'raw':
      return v.raw;
    case 'str':
      return `${v.introducer ?? ''}'${escapeString(v.value)}'`;
  }
}

/** Write an INSERT back as one extended-insert statement (mysqldump's shape). */
export function formatInsert(ins: InsertStatement): string {
  const cols = ins.columns ? ` (${ins.columns.map((c) => `\`${c}\``).join(', ')})` : '';
  const rows = ins.rows.map((r) => `(${r.map(formatValue).join(',')})`).join(',');
  return `${ins.verb} INTO \`${ins.table}\`${cols} VALUES ${rows};\n`;
}
