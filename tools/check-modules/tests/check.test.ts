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

  it('cache without an org scope (raw unstable_cache or use cache) fails', () => {
    const v = checkModules(here('../canaries/unscoped-cache')).filter((x) => x.rule === 'cache-scope');
    expect(v.map((x) => x.file)).toEqual(['apps/web/src/server/listings.ts', 'apps/web/src/server/other.ts']);
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

  it('the migrator connection outside tools/legacy-migrate fails', () => {
    expect(rules('migrator-access')).toContain('migrator-access');
  });

  it('raw colours (hex, rgba, default palette classes) fail in web, admin and ui; token files pass', () => {
    const v = checkModules(here('../canaries/raw-colour')).filter((x) => x.rule === 'design-tokens');
    expect(v.map((x) => x.file).sort()).toEqual([
      'apps/admin/src/rgba.tsx',
      'apps/web/src/hex.tsx',
      'apps/web/src/palette.tsx',
    ]);
    expect(v.find((x) => x.file === 'apps/web/src/palette.tsx')?.message).toContain('bg-zinc-100');
  });

  it('literal UI strings in the web app fail', () => {
    const v = checkModules(here('../canaries/literal-strings')).filter((x) => x.rule === 'i18n-literal');
    expect(v.map((x) => x.message)).toEqual([
      expect.stringContaining('"Welcome back"'),
      expect.stringContaining('aria-label="Search events"'),
    ]);
  });

  it('native selects and date/time inputs fail outside the UI kit (U1 no-native-select)', () => {
    const v = checkModules(here('../canaries/native-select')).filter((x) => x.rule === 'no-native-select');
    expect(v.map((x) => x.file).sort()).toEqual([
      'apps/admin/src/dates.tsx',
      'apps/admin/src/dates.tsx',
      'apps/admin/src/dates.tsx',
      'apps/web/src/select.tsx',
    ]);
    expect(v.find((x) => x.file === 'apps/web/src/select.tsx')?.message).toContain('Select');
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
