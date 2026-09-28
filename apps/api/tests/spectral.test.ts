import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;
const bin = join(root, 'node_modules/.bin/spectral');
const ruleset = join(root, 'spectral/.spectral.yaml');

async function lint(file: string) {
  try {
    const { stdout } = await run(bin, ['lint', file, '--ruleset', ruleset, '--format', 'json', '--quiet'], {
      cwd: root,
    });
    return JSON.parse(stdout || '[]') as { code: string; message: string }[];
  } catch (err) {
    const out = (err as { stdout?: string }).stdout;
    if (!out) throw err;
    return JSON.parse(out) as { code: string; message: string }[];
  }
}

const ok = (extra: Record<string, unknown> = {}) => ({
  operationId: 'listThings',
  tags: ['things'],
  summary: 'Things',
  description: 'A page of things.',
  ...extra,
});
const page = {
  description: 'A page',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { type: 'string' } },
          nextCursor: { type: ['string', 'null'] },
        },
      },
    },
  },
};
const limit = {
  name: 'limit',
  in: 'query',
  description: 'Page size',
  schema: { type: 'integer', minimum: 1, maximum: 100 },
};
const cursor = { name: 'cursor', in: 'query', description: 'Next page', schema: { type: 'string' } };

function write(doc: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'spectral-'));
  const file = join(dir, 'openapi.json');
  writeFileSync(file, JSON.stringify(doc));
  return file;
}

describe('Spectral ruleset (contracts:check)', () => {
  it('the committed apps/api/openapi.json passes every rule', async () => {
    expect(await lint(join(root, 'openapi.json'))).toEqual([]);
  }, 60_000);

  it('a compliant document passes', async () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 't', version: '1', description: 'Test API' },
      tags: [{ name: 'things', description: 'Things' }],
      paths: {
        '/things': { get: { ...ok(), parameters: [limit, cursor], responses: { 200: page } } },
      },
      components: { schemas: { Colour: { type: 'string', enum: ['red', 'blue'] } } },
    };
    expect(await lint(write(doc))).toEqual([]);
  }, 60_000);

  it('flags every rule: operationId, tags, descriptions, named enums, pagination params', async () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 't', version: '1' },
      paths: {
        '/things': {
          get: {
            tags: ['undeclared'],
            parameters: [
              { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } },
            ],
            responses: { 200: page },
          },
        },
        '/other': {
          get: {
            ...ok({ operationId: 'getOther', tags: ['things'] }),
            parameters: [
              cursor,
              { name: 'mode', in: 'query', description: 'x', schema: { type: 'string', enum: ['a', 'b'] } },
            ],
            responses: {
              200: { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } },
            },
          },
        },
        '/nothing': {
          post: { ...ok({ operationId: 'makeNothing' }), responses: { 400: { description: 'bad' } } },
        },
      },
    };
    const codes = new Set((await lint(write(doc))).map((r) => r.code));
    for (const code of [
      'operation-operationId',
      'operation-description',
      'operation-tag-defined',
      'openapi-tags',
      'info-description',
      'yayatoh-operation-summary',
      'yayatoh-parameter-description',
      'yayatoh-named-enums',
      'yayatoh-pagination-params',
      'yayatoh-operation-success',
    ])
      expect(codes, code).toContain(code);
  }, 60_000);
});
