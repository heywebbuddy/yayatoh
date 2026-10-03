import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build `@yayatoh/sdk` for npm (M6.3b): ES2022 JavaScript and type declarations from `src/`, a
 * publish-ready package.json (no `private`, no workspace dependencies, exports to the built files)
 * and the README, in `dist/` (or the directory given). CI then runs `npm publish --dry-run` on it;
 * the real publish waits for the owner's npm token (owner inbox).
 *
 *   node scripts/build-npm.ts [outDir]
 */
const root = fileURLToPath(new URL('..', import.meta.url));

export interface NpmManifest {
  readonly name: string;
  readonly version: string;
  readonly [key: string]: unknown;
}

export function npmManifest(source: {
  name: string;
  version: string;
  description: string;
  license: string;
  dependencies: Record<string, string>;
}): NpmManifest {
  const workspace = Object.entries(source.dependencies).filter(
    ([, v]) => v.startsWith('workspace:') || v.startsWith('catalog:'),
  );
  if (workspace.length > 0)
    throw new Error(
      `runtime dependencies must be published versions: ${workspace.map(([k]) => k).join(', ')}`,
    );
  return {
    name: source.name,
    version: source.version,
    description: source.description,
    license: source.license,
    type: 'module',
    sideEffects: false,
    main: './index.js',
    types: './index.d.ts',
    exports: {
      '.': { types: './index.d.ts', import: './index.js', default: './index.js' },
      './package.json': './package.json',
    },
    files: ['*.js', '*.d.ts', 'README.md'],
    dependencies: source.dependencies,
    engines: { node: '>=20' },
    keywords: ['yayatoh', 'events', 'tickets', 'api', 'sdk', 'webhooks', 'openapi'],
    homepage: 'https://yayatoh.com/developers',
    repository: {
      type: 'git',
      url: 'git+https://github.com/heywebbuddy/yayatoh.git',
      directory: 'packages/sdk',
    },
    publishConfig: { access: 'public', provenance: true },
  };
}

export function buildNpm(outDir = join(root, 'dist')): string {
  const out = resolve(outDir);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  const r = spawnSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.build.json'), '--outDir', out], {
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`tsc failed:\n${r.stdout}\n${r.stderr}`);
  // tsc rewrites `.ts` specifiers in the JavaScript only; declarations get the same `.js` paths so
  // NodeNext consumers resolve them.
  for (const f of readdirSync(out).filter((n) => n.endsWith('.d.ts'))) {
    const p = join(out, f);
    writeFileSync(p, readFileSync(p, 'utf8').replace(/(from\s+['"]\.\.?\/[^'"]+)\.ts(['"])/g, '$1.js$2'));
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  writeFileSync(join(out, 'package.json'), `${JSON.stringify(npmManifest(pkg), null, 2)}\n`);
  copyFileSync(join(root, 'README.md'), join(out, 'README.md'));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.info(`@yayatoh/sdk built in ${buildNpm(process.argv[2])}`);
}
