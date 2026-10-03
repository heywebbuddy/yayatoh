import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GENERATED_DIR,
  GENERATED_FILES,
  generateApps,
  PLUMBING,
  readOpenApi,
  validateApps,
} from '../src/index.ts';

/**
 * M6.5c: the Make app and the n8n node are generated from the /v1 OpenAPI document, checked in,
 * and valid (CI also runs `pnpm contracts:check`, which fails on a stale file).
 */

const doc = readOpenApi();
const { model, files, text, problems } = generateApps(doc);
const SCOPE = /scope `([a-z_]+:[a-z_]+)`/i;

describe('generated automation apps (M6.5c)', () => {
  it('are current: the checked-in files are what the generator writes', () => {
    for (const [key, rel] of Object.entries(GENERATED_FILES))
      expect(readFileSync(join(GENERATED_DIR, rel), 'utf8'), rel).toBe(text[key as keyof typeof text]);
  });

  it('are valid', () => {
    expect(problems).toEqual([]);
  });

  it('cover every scoped org operation an API key can call, and every subscribable webhook', () => {
    const scoped = Object.entries(doc.paths).flatMap(([path, ops]) =>
      Object.values(ops).flatMap((op) =>
        path.startsWith('/v1/orgs/{org}') &&
        op.security?.some((s) => 'apiKey' in s) &&
        SCOPE.test(`${op.summary ?? ''} ${op.description ?? ''}`) &&
        !PLUMBING.has(op.operationId)
          ? [op.operationId]
          : [],
      ),
    );
    expect(model.operations.map((o) => o.key).sort()).toEqual(scoped.sort());
    expect(model.operations.length).toBeGreaterThanOrEqual(25);
    const make = files.make.modules.filter((m) => m.typeName !== 'instant_trigger').map((m) => m.name);
    expect(make.sort()).toEqual(scoped.sort());
    expect(Object.keys(files.n8nNode.yayatoh.operations).sort()).toEqual(scoped.sort());
    const subscribable = Object.keys(doc.webhooks ?? {}).filter((t) => t !== 'webhook.test');
    expect(files.make.webhooks.map((w) => w.eventType).sort()).toEqual(subscribable.sort());
    expect([...files.n8nTrigger.yayatoh.eventTypes].sort()).toEqual(subscribable.sort());
  });

  it('take the org from the connection only, next to the key', () => {
    expect(files.make.base.baseUrl).toBe('{{connection.baseUrl}}/v1/orgs/{{connection.org}}');
    expect(files.n8nNode.description.requestDefaults.baseURL).toBe(
      '={{$credentials.baseUrl}}/v1/orgs/{{$credentials.org}}',
    );
    for (const m of files.make.modules)
      if ('expect' in m) for (const p of m.expect) expect(['org', 'orgId', 'apiKey']).not.toContain(p.name);
    expect(JSON.stringify(files.n8nNode.description.properties)).not.toMatch(/"name":"(org|orgId|apiKey)"/);
  });

  it('say which scope each module needs; triggers need webhooks:manage', () => {
    for (const m of files.make.modules) expect(m.scope).toMatch(/^[a-z_]+:[a-z_]+$/);
    expect(
      files.make.modules
        .filter((m) => m.typeName === 'instant_trigger')
        .every((m) => m.scope === 'webhooks:manage'),
    ).toBe(true);
    expect(files.make.connections[0]?.scopes).toContain('webhooks:manage');
    expect(files.n8nTrigger.yayatoh.subscription.scope).toBe('webhooks:manage');
  });

  it('canary: the validator refuses an app that could reach another host, take the org, or claim another scope', () => {
    const tamper = (fn: (make: { modules: Record<string, unknown>[] }) => void) => {
      const make = structuredClone(files.make) as unknown as { modules: Record<string, unknown>[] };
      fn(make);
      return validateApps(doc, model, { ...files, make });
    };
    const action = (make: { modules: Record<string, unknown>[] }) =>
      make.modules.find((m) => m.typeName === 'action') as Record<string, unknown> & {
        communication: { url: string };
        expect: { name: string; label: string; type: string }[];
      };
    expect(
      tamper((m) => {
        action(m).communication.url = 'https://evil.example/steal';
      }).join('\n'),
    ).toMatch(/communication\.url/);
    expect(
      tamper((m) => {
        action(m).expect.push({ name: 'org', label: 'Org', type: 'text' });
      }).join('\n'),
    ).toMatch(/takes org as input/);
    expect(
      tamper((m) => {
        action(m).scope = 'org:read';
      }).join('\n'),
    ).toMatch(/is not the documented/);
    expect(
      tamper((m) => {
        m.modules.push({
          ...action(m),
          name: 'ghost',
          operation: { method: 'GET', path: '/v1/orgs/{org}/ghost' },
        });
      }).join('\n'),
    ).toMatch(/is not a \/v1 operation/);
  });
});
