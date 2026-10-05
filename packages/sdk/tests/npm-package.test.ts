import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildNpm, npmManifest } from '../scripts/build-npm.ts';
import { SDK_VERSION } from '../src/index.ts';

/** M6.3b: the SDK as npm would ship it (CI runs `npm publish --dry-run` on the same build). */
describe('@yayatoh/sdk npm package', () => {
  let out: string;
  beforeAll(() => {
    // Under the package's node_modules/.cache, so the build resolves its real dependency
    // (openapi-fetch) as an installed package would.
    const cache = fileURLToPath(new URL('../node_modules/.cache/', import.meta.url));
    mkdirSync(cache, { recursive: true });
    out = buildNpm(join(mkdtempSync(join(cache, 'npm-')), 'dist'));
  }, 120_000);
  afterAll(() => rmSync(join(out, '..'), { recursive: true, force: true }));

  it('has a publishable manifest: public, versioned like the code, no workspace dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(out, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('@yayatoh/sdk');
    expect(pkg.version).toBe(SDK_VERSION);
    expect(pkg.private).toBeUndefined();
    expect(pkg.publishConfig).toMatchObject({ access: 'public' });
    expect(Object.values(pkg.dependencies as Record<string, string>).every((v) => /^\d/.test(v))).toBe(true);
    expect(pkg.exports['.']).toEqual({ types: './index.d.ts', import: './index.js', default: './index.js' });
    expect(() =>
      npmManifest({
        name: 'x',
        version: '1.0.0',
        description: '',
        license: 'MIT',
        dependencies: { a: 'workspace:*' },
      }),
    ).toThrow(/published versions/);
  });

  it('runs as plain JavaScript (no TypeScript, no workspace imports)', async () => {
    const js = readFileSync(join(out, 'index.js'), 'utf8');
    expect(js).not.toMatch(/from '\.\/schema\.ts'|@yayatoh\//);
    const m = await import(pathToFileURL(join(out, 'index.js')).href);
    expect(Object.keys(m)).toEqual(
      expect.arrayContaining([
        'createYayatohClient',
        'paginate',
        'unwrap',
        'idempotencyKey',
        'verifyWebhook',
      ]),
    );
    expect(m.SDK_VERSION).toBe(SDK_VERSION);
  });

  it('type-checks in a NodeNext consumer, webhook types included', () => {
    const consumer = mkdtempSync(join(out, '..', 'consumer-'));
    writeFileSync(
      join(consumer, 'main.ts'),
      `import { createYayatohClient, verifyWebhook, type WebhookMessage } from '${join(out, 'index.js')}';
const api = createYayatohClient({ baseUrl: 'https://api.yayatoh.com', token: 'yy_test_x' });
export const pending = api.GET('/v1/orgs/{org}', { params: { path: { org: 'lakeside-events' } } });
export async function receive(raw: string, h: Record<string, string>) {
  const m = await verifyWebhook<'order.refunded'>('whsec_x', h, raw);
  const amount: number = m.data.amountMinor;
  const typed: WebhookMessage<'ticket.admitted'>['data']['day'] = '2030-01-01';
  return [amount, typed];
}
`,
    );
    writeFileSync(
      join(consumer, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          lib: ['ES2022', 'DOM'],
          types: [],
        },
        files: ['main.ts'],
      }),
    );
    const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
    const r = spawnSync(process.execPath, [tsc, '-p', join(consumer, 'tsconfig.json')], { encoding: 'utf8' });
    expect(r.stdout + r.stderr).toBe('');
    expect(r.status).toBe(0);
  }, 120_000);
});
