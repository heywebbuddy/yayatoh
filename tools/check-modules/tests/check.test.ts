import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkModules, importsOf, literalJsxText } from '../src/check.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const rules = (canary: string) => checkModules(here(`../canaries/${canary}`)).map((v) => v.rule);

describe('check-modules gate canaries', () => {
  it('cross-module import: private schema, relative reach-in and tier inversion all fail', () => {
    expect(rules('cross-module-import')).toEqual(
      expect.arrayContaining(['private-import', 'cross-package-relative', 'tier', 'undeclared-dependency']),
    );
  });

  it('table without RLS (not a tenantTable) fails', () => {
    expect(rules('table-without-rls')).toContain('tenant-table');
  });

  it('raw database client outside packages/db fails', () => {
    expect(rules('raw-db-client')).toContain('raw-db-client');
  });

  it('platform_reader outside admin/worker fails', () => {
    expect(rules('platform-reader')).toContain('platform-reader');
  });

  it('literal UI strings in the web app fail', () => {
    const v = checkModules(here('../canaries/literal-strings')).filter((x) => x.rule === 'i18n-literal');
    expect(v.map((x) => x.message)).toEqual([
      expect.stringContaining('"Welcome back"'),
      expect.stringContaining('aria-label="Search events"'),
    ]);
  });

  it('the CLI exits non-zero on a canary and zero on the repo', () => {
    const cli = here('../cli.ts');
    expect(() =>
      execFileSync(process.execPath, [cli, '--root', here('../canaries/cross-module-import')], {
        stdio: 'pipe',
      }),
    ).toThrow();
    expect(() =>
      execFileSync(process.execPath, [cli, '--root', here('../../..')], { stdio: 'pipe' }),
    ).not.toThrow();
  });
});

describe('importsOf', () => {
  it('finds static, side-effect, dynamic and re-export specifiers', () => {
    const src = `import a from 'a';\nimport 'b';\nexport { c } from "c";\nconst d = await import('d');\nimport type { E } from 'e';`;
    expect(importsOf(src).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('literalJsxText', () => {
  it('ignores expressions, generics and comparisons', () => {
    expect(literalJsxText('<p>{t("x")}</p>')).toEqual([]);
    expect(literalJsxText('const a: Promise<{ x: string }> = f(); if (n > 0 && m < 2) {}')).toEqual([]);
    expect(literalJsxText('<Label>{t("a")}</Label>\n<span>Hi there</span>')).toEqual(['Hi there']);
  });
});
