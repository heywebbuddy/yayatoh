import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * U2 empty-state audit (UX review 1, principle 6 "no dead ends"): every empty state in the org
 * and event console says what goes there AND offers a primary action. It walks the console's
 * route sweep (every file under `/o/`) and every component those files import, and lists each
 * `<EmptyState>` without an `action`.
 */
const SRC = join(__dirname, '../src');
const CONSOLE_DIR = join(SRC, 'app/[locale]/o');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')])
    if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

/** The console's files plus every app file they import (transitively). */
function consoleFiles(): string[] {
  const seen = new Set<string>();
  const queue = files(CONSOLE_DIR);
  while (queue.length > 0) {
    const f = queue.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
      const r = resolveImport(f, m[1] as string);
      if (r?.startsWith(SRC) && /\.tsx$/.test(r) && !seen.has(r)) queue.push(r);
    }
  }
  return [...seen].filter((f) => f.endsWith('.tsx')).sort();
}

/** `<EmptyState …/>` or `<EmptyState …>` openings whose props have no `action`. */
export function emptyStatesWithoutAction(src: string): number {
  let missing = 0;
  for (const m of src.matchAll(/<EmptyState\b/g)) {
    // The opening tag ends at the first `>` outside braces.
    let depth = 0;
    let end = (m.index as number) + m[0].length;
    for (; end < src.length; end++) {
      const ch = src[end];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    const tag = src.slice(m.index, end);
    if (!/\saction=\{/.test(tag)) missing++;
  }
  return missing;
}

describe('empty-state audit', () => {
  const scanned = consoleFiles();

  it('walks the console route sweep and the components it renders', () => {
    expect(scanned.length).toBeGreaterThan(150);
    expect(scanned.some((f) => f.includes('venues/page.tsx'))).toBe(true);
    expect(scanned.some((f) => f.endsWith('components/alerts-list.tsx'))).toBe(true);
  });

  it('parses the opening tag only', () => {
    expect(emptyStatesWithoutAction('<EmptyState title={t("a")} description="b" />')).toBe(1);
    expect(emptyStatesWithoutAction('<EmptyState title={x > 1 ? "a" : "b"} action={<A />} />')).toBe(0);
    expect(emptyStatesWithoutAction('<EmptyState\n  title="a"\n  action={\n <Link href="/x">x</Link>\n }\n/>')).toBe(0);
  });

  it('lists zero console empty states without a primary action', () => {
    const offenders = scanned
      .map((f) => [relative(SRC, f), emptyStatesWithoutAction(readFileSync(f, 'utf8'))] as const)
      .filter(([, n]) => n > 0)
      .map(([f, n]) => `${f} (${n})`);
    expect(offenders).toEqual([]);
  });
});
