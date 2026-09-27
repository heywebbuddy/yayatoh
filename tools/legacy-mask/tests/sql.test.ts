import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatInsert, parseCreateTable, parseInsert, StatementSplitter } from '../src/index.ts';

const FIXTURE = readFileSync(new URL('./fixtures/legacy-synthetic.sql', import.meta.url), 'utf8');

function split(text: string, chunk: number): string[] {
  const s = new StatementSplitter();
  const out: string[] = [];
  for (let i = 0; i < text.length; i += chunk) out.push(...s.push(text.slice(i, i + chunk)));
  const rest = s.end();
  if (rest.trim()) out.push(rest);
  return out;
}

describe('fixtures are invented data only', () => {
  // .gitignore lets *.sql in this folder through; this keeps a real dump from riding along.
  it('every fixture says SYNTHETIC and uses only reserved example domains', () => {
    const dir = new URL('./fixtures/', import.meta.url);
    for (const name of readdirSync(dir)) {
      const text = readFileSync(new URL(name, dir), 'utf8');
      expect(text, name).toContain('SYNTHETIC TEST DATA ONLY');
      const domains = [...text.matchAll(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)].map((m) =>
        (m[1] ?? '').toLowerCase(),
      );
      for (const d of domains)
        expect(d, `${name}: ${d}`).toMatch(/(^|\.)example\.(com|org|net)$|(^|\.)test$/);
    }
  });
});

describe('mysqldump reader', () => {
  it('splits statements the same way whatever the chunk size (1 byte to whole file)', () => {
    const whole = split(FIXTURE, FIXTURE.length);
    for (const size of [1, 2, 3, 7, 64, 1000]) expect(split(FIXTURE, size)).toEqual(whole);
    // Nothing is lost or duplicated.
    expect(whole.join('')).toBe(FIXTURE.slice(0, whole.join('').length));
    expect(FIXTURE.slice(whole.join('').length).trim()).toBe('');
  });

  it('keeps ; and ),( inside strings and comments as part of their statement', () => {
    const inserts = split(FIXTURE, 5).filter((s) => s.startsWith('INSERT INTO `users`'));
    expect(inserts).toHaveLength(1);
    expect(parseInsert(inserts[0] ?? '').rows).toHaveLength(4);
  });

  it('reads column names, lengths, nullability and unique keys from CREATE TABLE', () => {
    const create = split(FIXTURE, FIXTURE.length).find((s) => s.startsWith('CREATE TABLE `users`')) ?? '';
    const def = parseCreateTable(create);
    expect(def?.name).toBe('users');
    expect(def?.columns.find((c) => c.name === 'email')).toEqual({
      name: 'email',
      type: 'varchar',
      maxLength: 255,
      nullable: false,
    });
    expect(def?.columns.find((c) => c.name === 'bio')).toMatchObject({
      type: 'text',
      maxLength: 65_535,
      nullable: true,
    });
    expect(def?.columns.find((c) => c.name === 'role_id')).toMatchObject({ type: 'int', maxLength: null });
    expect(def?.uniques).toEqual([['id'], ['email']]);
  });

  it('parses every value kind: NULL, negatives, decimals, escapes, emoji, hex and _binary', () => {
    const ins = parseInsert(
      "INSERT INTO `t` VALUES (NULL,-5.25,1e3,'it\\'s \\\"q\\\" \\\\ \\n\\0 ''x''','Zoë 😀',0xDEADBEEF,_binary 'raw\\0b');",
    );
    expect(ins.rows[0]).toEqual([
      { kind: 'null' },
      { kind: 'num', raw: '-5.25' },
      { kind: 'num', raw: '1e3' },
      { kind: 'str', value: `it's "q" \\ \n\0 'x'` },
      { kind: 'str', value: 'Zoë 😀' },
      { kind: 'hex', raw: '0xDEADBEEF' },
      { kind: 'str', value: 'raw\0b', introducer: '_binary' },
    ]);
  });

  it('writes values back so they parse to the same thing (round trip)', () => {
    for (const stmt of split(FIXTURE, FIXTURE.length).filter((s) => s.startsWith('INSERT'))) {
      const once = parseInsert(stmt);
      expect(parseInsert(formatInsert(once))).toEqual(once);
    }
  });

  it('keeps an explicit column list (--complete-insert) and INSERT IGNORE', () => {
    const ins = parseInsert("INSERT IGNORE INTO `t` (`a`, `b`) VALUES (1,'x'),(2,'y');");
    expect(ins).toMatchObject({ verb: 'INSERT IGNORE', columns: ['a', 'b'] });
    expect(formatInsert(ins)).toBe("INSERT IGNORE INTO `t` (`a`, `b`) VALUES (1,'x'),(2,'y');\n");
  });

  it('refuses malformed rows instead of guessing', () => {
    expect(() => parseInsert("INSERT INTO `t` VALUES (1,'unterminated);")).toThrow(/unterminated/);
    expect(() => parseInsert('INSERT INTO `t` VALUES (1 2);')).toThrow(/expected/);
  });
});
