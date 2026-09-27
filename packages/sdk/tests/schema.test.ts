import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generate } from '../scripts/generate.ts';

describe('SDK types', () => {
  it('are generated from the committed openapi.json (run `pnpm --filter @yayatoh/sdk generate`)', async () => {
    const committed = readFileSync(new URL('../src/schema.ts', import.meta.url), 'utf8');
    expect(committed).toBe(await generate());
  });
});

describe('SDK runtime', () => {
  it('ships only runtime-neutral code (browser, React Native, Node, Deno, workers)', () => {
    for (const file of ['index.ts', 'schema.ts']) {
      const src = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      expect(imports.filter((i) => i?.startsWith('node:') || i?.startsWith('@yayatoh/'))).toEqual([]);
    }
  });
});
