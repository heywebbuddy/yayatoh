import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface Violation {
  readonly rule: string;
  readonly file: string;
  readonly message: string;
}

interface Pkg {
  readonly name: string;
  readonly dir: string;
  readonly exports: ReadonlySet<string>;
  readonly deps: ReadonlySet<string>;
  readonly tier: number | null;
  readonly universal: boolean;
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
  'drizzle',
  'canaries',
]);
const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|jsx)$/;
const RAW_DB_CLIENTS = [
  'postgres',
  'pg',
  'drizzle-orm/postgres-js',
  'drizzle-orm/node-postgres',
  'drizzle-orm/neon-http',
];
const PLATFORM_READER_APPS = ['apps/admin', 'apps/worker'];
/** Files allowed to hold raw colour literals (ADR 0018: tokens are the only source). */
const TOKEN_FILES = ['packages/ui/src/tokens.ts', 'packages/ui/src/styles.css'];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function loadPackages(root: string): Pkg[] {
  const pkgs: Pkg[] = [];
  for (const file of walk(root).filter((f) => f.endsWith(`${sep}package.json`))) {
    const json = readJson(file);
    const name = json.name as string | undefined;
    if (!name?.startsWith('@yayatoh/')) continue;
    const exp = (json.exports ?? {}) as Record<string, unknown> | string;
    const exportKeys = typeof exp === 'string' ? ['.'] : Object.keys(exp);
    const meta = (json.yayatoh ?? {}) as { tier?: number; kind?: string };
    const deps = {
      ...(json.dependencies as object),
      ...(json.devDependencies as object),
      ...(json.peerDependencies as object),
    };
    pkgs.push({
      name,
      dir: relative(root, join(file, '..')).split(sep).join('/'),
      exports: new Set(exportKeys),
      deps: new Set(Object.keys(deps)),
      tier: typeof meta.tier === 'number' ? meta.tier : null,
      universal: meta.kind === 'universal',
    });
  }
  return pkgs;
}

const IMPORT_RE =
  /(?:^|[^\w$.])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|[^\w$.])import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

export function importsOf(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (spec) out.push(spec);
  }
  return out;
}

/** JSX text nodes containing letters (outside `{…}` expressions). Heuristic, tuned for our TSX. */
export function literalJsxText(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/(?:[\w"'}]|\/)>([^<>{}]*)</gu)) {
    const text = (m[1] ?? '').trim();
    if (!/\p{L}/u.test(text) || /[;=()[\]]|=>|&&|\|\|/.test(text)) continue;
    out.push(text.replace(/\s+/g, ' ').slice(0, 40));
  }
  return out;
}

function isTestFile(rel: string): boolean {
  return /(^|\/)tests?\//.test(rel) || /\.(int\.)?test\.tsx?$/.test(rel) || /(^|\/)e2e\//.test(rel);
}

function loadGlobalTables(root: string): Set<string> {
  const file = join(root, 'packages/db/src/global-tables.ts');
  if (!existsSync(file)) return new Set();
  const src = readFileSync(file, 'utf8');
  return new Set([...src.matchAll(/['"]([a-z_][\w]*\.[a-z_][\w]*)['"]\s*:/g)].map((m) => m[1] as string));
}

export function checkModules(root: string): Violation[] {
  const violations: Violation[] = [];
  const pkgs = loadPackages(root);
  const byName = new Map(pkgs.map((p) => [p.name, p]));
  const globalTables = loadGlobalTables(root);
  const owner = (rel: string) =>
    pkgs
      .filter((p) => rel === p.dir || rel.startsWith(`${p.dir}/`))
      .sort((a, b) => b.dir.length - a.dir.length)[0];

  const roots = ['apps', 'packages', 'tools'].map((d) => join(root, d));
  const files = roots.flatMap((d) => walk(d)).filter((f) => SOURCE.test(f) || f.endsWith('.css'));

  for (const abs of files) {
    const rel = relative(root, abs).split(sep).join('/');
    const pkg = owner(rel);
    const src = readFileSync(abs, 'utf8');
    const add = (rule: string, message: string) => violations.push({ rule, file: rel, message });
    const test = isTestFile(rel);

    // Raw colour literals outside the token files (ADR 0018).
    if (
      (rel.startsWith('apps/web/src/') || rel.startsWith('packages/ui/src/')) &&
      !TOKEN_FILES.includes(rel)
    ) {
      const hex = src.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/g);
      if (hex && !test) add('design-tokens', `raw colour ${hex[0]} — use a token from @yayatoh/ui`);
    }
    if (!SOURCE.test(abs)) continue;

    // UI strings go through next-intl (CLAUDE.md → UI): no literal JSX text or literal labels.
    if (rel.startsWith('apps/web/src/') && rel.endsWith('.tsx') && !test) {
      for (const text of literalJsxText(src))
        add('i18n-literal', `literal UI text "${text}" — use a next-intl message`);
      for (const m of src.matchAll(/\b(aria-label|placeholder|title|alt|label)="([^"]*\p{L}[^"]*)"/gu)) {
        add('i18n-literal', `literal ${m[1]}="${m[2]}" — use a next-intl message`);
      }
    }

    for (const spec of importsOf(src)) {
      // Relative imports must stay inside their own package.
      if (spec.startsWith('.')) {
        const target = relative(root, join(abs, '..', spec))
          .split(sep)
          .join('/');
        const targetPkg = owner(target);
        if (pkg && targetPkg && targetPkg.name !== pkg.name) {
          add(
            'cross-package-relative',
            `relative import into ${targetPkg.name}; import its public exports instead`,
          );
        }
        continue;
      }

      if (RAW_DB_CLIENTS.includes(spec) && pkg?.name !== '@yayatoh/db') {
        add('raw-db-client', `"${spec}" may only be used inside packages/db — use withTenant()`);
      }

      if (!spec.startsWith('@yayatoh/')) {
        if (
          pkg?.universal &&
          !test &&
          (spec.startsWith('node:') || spec === 'react-dom' || spec.startsWith('next'))
        ) {
          add('universal', `universal package ${pkg.name} must not import "${spec}"`);
        }
        continue;
      }

      const [scope, name, ...rest] = spec.split('/');
      const targetName = `${scope}/${name}`;
      const sub = rest.length ? `./${rest.join('/')}` : '.';
      const target = byName.get(targetName);
      if (!target) {
        add('unknown-package', `unknown workspace package ${targetName}`);
        continue;
      }
      if (pkg && target.name === pkg.name) continue;

      if (!target.exports.has(sub)) {
        const hint = sub === './schema' ? ' (a module schema is private to its module)' : '';
        add('private-import', `${spec} is not a public export of ${target.name}${hint}`);
      }
      if (spec === '@yayatoh/db/platform' && !PLATFORM_READER_APPS.some((a) => rel.startsWith(`${a}/`))) {
        add('platform-reader', 'platform_reader access is limited to apps/admin and apps/worker');
      }
      if (spec === '@yayatoh/db/identity' && pkg?.name !== '@yayatoh/auth') {
        add('identity-db', 'the identity database handle is for packages/auth only');
      }
      if (sub === './testing' && !test) add('testing-import', `${spec} may only be imported from tests`);
      if (pkg && !pkg.deps.has(target.name)) {
        add(
          'undeclared-dependency',
          `${pkg.name} imports ${target.name} without declaring it in package.json`,
        );
      }
      if (pkg?.tier != null && target.tier != null && target.tier >= pkg.tier) {
        add(
          'tier',
          `${pkg.name} (tier ${pkg.tier}) may not import ${target.name} (tier ${target.tier}); use events or ports`,
        );
      }
    }

    // Tables must be tenantTable() unless registered in GLOBAL_TABLES.
    if (
      !test &&
      rel !== 'packages/db/src/tenant-table.ts' &&
      /from\s+['"]drizzle-orm\/pg-core['"]/.test(src)
    ) {
      for (const m of src.matchAll(/(?:\bpgTable|\.table)\s*\(\s*['"]([\w]+)['"]/g)) {
        const tableName = m[1] as string;
        const schemaMatch = /pgSchema\(\s*['"]([\w]+)['"]\s*\)/.exec(src);
        const key = `${schemaMatch?.[1] ?? 'public'}.${tableName}`;
        if (!globalTables.has(key)) {
          add('tenant-table', `table ${key} is not a tenantTable() and not listed in GLOBAL_TABLES`);
        }
      }
    }
  }
  return violations;
}
