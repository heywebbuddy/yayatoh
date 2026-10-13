import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { checkModules } from '../src/check.ts';

// M7.1b, ADR 0025: the rules for apps/mobile, apps/staff and packages/mobile-core.
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const messages = (canary: string, rule: string) =>
  checkModules(here(`../canaries/${canary}`))
    .filter((v) => v.rule === rule)
    .map((v) => v.message);

describe('mobile gate canaries', () => {
  it('an app importing the database, a module, next, react-dom or node:fs fails', () => {
    expect(messages('mobile-imports', 'mobile-imports')).toEqual(
      expect.arrayContaining([
        expect.stringContaining('@yayatoh/events: apps import only universal packages'),
        expect.stringContaining('@yayatoh/db: apps import only universal packages'),
        expect.stringContaining('"next/navigation" is web or server code'),
        expect.stringContaining('"react-dom" is web or server code'),
        expect.stringContaining('"node:fs" does not exist on a phone'),
      ]),
    );
  });

  it('an app declaring the database or next in package.json fails too', () => {
    const declared = checkModules(here('../canaries/mobile-imports')).filter((v) =>
      v.message.includes('declares'),
    );
    expect(declared.map((v) => v.file)).toEqual(['apps/mobile/package.json', 'apps/mobile/package.json']);
    expect(declared.map((v) => v.message)).toEqual([
      expect.stringContaining('declares @yayatoh/db'),
      expect.stringContaining('declares next'),
    ]);
  });

  it('colour literals in an app .tsx fail (hex, rgba, a named colour)', () => {
    expect(messages('mobile-colour', 'design-tokens')).toEqual(
      expect.arrayContaining([
        expect.stringContaining('#6A3BFF'),
        expect.stringContaining('rgba('),
        expect.stringContaining('literal colour "white"'),
      ]),
    );
  });

  it('literal UI strings in an app .tsx fail (JSX text and accessibilityLabel)', () => {
    expect(messages('mobile-literal', 'i18n-literal')).toEqual([
      expect.stringContaining('"Welcome back"'),
      expect.stringContaining('accessibilityLabel "Open my tickets"'),
    ]);
  });
});

describe('mobile rules on a throwaway repo', () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });
  const repo = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), 'check-modules-mobile-'));
    roots.push(root);
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), body);
    }
    return root;
  };
  const pkg = (value: object) => JSON.stringify(value);
  // Built in pieces so the repo-wide check does not read these fixtures as this file's own imports.
  const imp = (name: string, from: string) =>
    ['import', ` { ${name} } `, 'from ', JSON.stringify(from), ';'].join('');
  const base = {
    'apps/mobile/package.json': pkg({
      name: '@yayatoh/mobile',
      dependencies: {
        '@yayatoh/sdk': 'workspace:*',
        '@yayatoh/ui': 'workspace:*',
        '@yayatoh/mobile-core': 'workspace:*',
        '@yayatoh/checkin-engine': 'workspace:*',
      },
    }),
    'packages/sdk/package.json': pkg({ name: '@yayatoh/sdk', exports: { '.': './src/index.ts' } }),
    'packages/sdk/src/index.ts': 'export const sdk = 1;\n',
    'packages/ui/package.json': pkg({
      name: '@yayatoh/ui',
      exports: { '.': './src/index.ts', './tokens': './src/tokens.ts' },
    }),
    'packages/ui/src/index.ts': 'export const ui = 1;\n',
    'packages/ui/src/tokens.ts': "export const light = { ink: '#16131D' };\n",
    'packages/mobile-core/package.json': pkg({
      name: '@yayatoh/mobile-core',
      exports: { '.': './src/index.ts' },
      yayatoh: { kind: 'mobile' },
    }),
    'packages/mobile-core/src/index.ts': 'export const core = 1;\n',
    'packages/checkin-engine/package.json': pkg({
      name: '@yayatoh/checkin-engine',
      exports: { '.': './src/index.ts' },
      yayatoh: { kind: 'universal' },
    }),
    'packages/checkin-engine/src/index.ts': 'export const engine = 1;\n',
  };

  it('accepts universal packages, the SDK, the tokens, mobile-core, token styles and translated text', () => {
    const root = repo({
      ...base,
      'apps/mobile/app.config.ts': "import { readFileSync } from 'node:fs';\nexport default readFileSync;\n",
      'apps/mobile/src/screen.tsx': [
        imp('engine', '@yayatoh/checkin-engine'),
        imp('core', '@yayatoh/mobile-core'),
        imp('sdk', '@yayatoh/sdk'),
        imp('light', '@yayatoh/ui/tokens'),
        "import { Text, View } from 'react-native';",
        'export function Screen({ t }: { t: (k: string) => string }) {',
        '  return (',
        '    <View style={{ backgroundColor: light.ink, borderColor: "transparent" }}>',
        '      <Text accessibilityLabel={t("label")}>{t("hello")}</Text>',
        '      {[engine, core, sdk].length}',
        '    </View>',
        '  );',
        '}',
        '',
      ].join('\n'),
      // Tests may hold literals.
      'apps/mobile/tests/screen.test.tsx':
        'export const colour = "#FFFFFF"; export const x = <p>Plain</p>;\n',
    });
    expect(checkModules(root)).toEqual([]);
  });

  it('refuses the web UI package root, the testing package and another app', () => {
    const root = repo({
      ...base,
      'packages/testing/package.json': pkg({ name: '@yayatoh/testing', exports: { '.': './src/index.ts' } }),
      'packages/testing/src/index.ts': 'export const t = 1;\n',
      'apps/staff/package.json': pkg({ name: '@yayatoh/staff' }),
      'apps/staff/src/index.ts': 'export const s = 1;\n',
      'apps/mobile/src/a.ts': [
        imp('ui', '@yayatoh/ui'),
        imp('t', '@yayatoh/testing'),
        imp('s', '@yayatoh/staff'),
        'export const all = [ui, t, s];',
        '',
      ].join('\n'),
    });
    // '@yayatoh/ui' itself (not its tokens) is the web component kit: only the tokens are allowed.
    expect(
      checkModules(root)
        .filter((v) => v.rule === 'mobile-imports')
        .map((v) => v.message),
    ).toEqual([
      expect.stringContaining('@yayatoh/ui:'),
      expect.stringContaining('@yayatoh/testing:'),
      expect.stringContaining('@yayatoh/staff:'),
    ]);
  });

  it('Node modules are fine in config files and tests, not in app source', () => {
    const root = repo({
      ...base,
      'apps/mobile/metro.config.js': "const path = require('node:path');\nmodule.exports = path;\n",
      'apps/mobile/src/storage.ts': "import { readFileSync } from 'node:fs';\nexport default readFileSync;\n",
      'packages/mobile-core/tests/app.test.ts': "import path from 'node:path';\nexport default path;\n",
    });
    expect(
      checkModules(root)
        .filter((v) => v.rule === 'mobile-imports')
        .map((v) => v.file),
    ).toEqual(['apps/mobile/src/storage.ts']);
  });

  it('applies to packages/mobile-core as well', () => {
    const root = repo({
      ...base,
      'packages/mobile-core/src/theme.tsx':
        'export const c = <p style={{ color: "#fff" }}>Hello there</p>;\n',
      'packages/mobile-core/src/data.ts': imp('db', '@yayatoh/db') + '\nexport default db;\n',
    });
    expect(checkModules(root).map((v) => `${v.rule}:${v.file}`)).toEqual(
      expect.arrayContaining([
        'design-tokens:packages/mobile-core/src/theme.tsx',
        'i18n-literal:packages/mobile-core/src/theme.tsx',
        'mobile-imports:packages/mobile-core/src/data.ts',
      ]),
    );
  });

  it('leaves the web apps alone', () => {
    const root = repo({
      'apps/web/package.json': pkg({ name: '@yayatoh/web', dependencies: { next: '1' } }),
      'apps/web/src/page.ts': "import { redirect } from 'next/navigation';\nexport default redirect;\n",
    });
    expect(checkModules(root).filter((v) => v.rule === 'mobile-imports')).toEqual([]);
  });
});
