import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  type CommandPorts,
  createCtx,
  DomainError,
  defineCommand,
  executeCommand,
  stableStringify,
} from '../src/index.ts';

type FakeTx = { id: string };

function fakePorts(overrides: Partial<CommandPorts<FakeTx>> = {}) {
  const log: string[] = [];
  const record = (entry: string) => {
    log.push(entry);
    return true;
  };
  const store = new Map<string, { fingerprint: string; output: unknown }>();
  const ports: CommandPorts<FakeTx> = {
    entitlements: { has: async (_c, key) => record(`entitlement:${key}`) },
    authorizer: { can: async (_c, perm) => record(`authorize:${perm}`) },
    stepUp: { satisfied: async () => record('stepUp') },
    idempotency: {
      lookup: async (_c, scope, key, fp) => {
        log.push('idempotency:lookup');
        const hit = store.get(`${scope}:${key}`);
        if (!hit) return null;
        if (hit.fingerprint !== fp) throw new DomainError('idempotency_key_reused');
        return { output: hit.output };
      },
      save: async (_tx, _c, scope, key, fp, output) => {
        log.push('idempotency:save');
        store.set(`${scope}:${key}`, { fingerprint: fp, output });
      },
    },
    transaction: async (_c, fn) => {
      log.push('tx:begin');
      const r = await fn({ id: 'tx1' });
      log.push('tx:commit');
      return r;
    },
    outbox: {
      emit: async (_tx, _c, events) => void log.push(`outbox:${events.map((e) => e.type).join(',')}`),
    },
    audit: { record: async (_tx, _c, entry) => void log.push(`audit:${entry.action}`) },
    ...overrides,
  };
  return { ports, log };
}

const rename = defineCommand<{ name: string }, { id: string; name: string }, Record<string, string>, FakeTx>({
  name: 'tenancy.renameOrganization',
  input: z.object({ name: z.string().min(1) }),
  output: z.object({ id: z.string(), name: z.string() }),
  entitlement: 'core',
  permission: 'org:update',
  stepUp: true,
  idempotent: true,
  handler: async ({ input, tx, emit }) => {
    emit({
      type: 'organization.renamed',
      version: 1,
      aggregateType: 'organization',
      aggregateId: 'o1',
      payload: {},
    });
    return { id: 'o1', name: input.name, bankAccount: 'SECRET', txId: tx.id };
  },
  audit: (input) => ({
    action: 'org.rename',
    targetType: 'organization',
    targetId: 'o1',
    data: { name: input.name },
  }),
});

const ctx = createCtx({ orgId: '0190f5f6-0000-7000-8000-000000000001', idempotencyKey: 'k1' });

describe('executeCommand', () => {
  it('runs the ten steps in order', async () => {
    const { ports, log } = fakePorts();
    await executeCommand(rename, { name: 'Acme' }, ctx, ports);
    expect(log).toEqual([
      'entitlement:core',
      'authorize:org:update',
      'stepUp',
      'idempotency:lookup',
      'tx:begin',
      'outbox:organization.renamed',
      'audit:org.rename',
      'idempotency:save',
      'tx:commit',
    ]);
  });

  it('serializes through the allowlist and never returns extra fields', async () => {
    const { ports } = fakePorts();
    const out = await executeCommand(rename, { name: 'Acme' }, ctx, ports);
    expect(out).toEqual({ id: 'o1', name: 'Acme' });
    expect(JSON.stringify(out)).not.toContain('SECRET');
  });

  it('fails validation before touching any port', async () => {
    const { ports, log } = fakePorts();
    await expect(executeCommand(rename, { name: '' }, ctx, ports)).rejects.toMatchObject({
      code: 'validation_failed',
    });
    expect(log).toEqual([]);
  });

  it('rejects when the module is not entitled', async () => {
    const { ports, log } = fakePorts({ entitlements: { has: async () => false } });
    await expect(executeCommand(rename, { name: 'A' }, ctx, ports)).rejects.toMatchObject({
      code: 'module_not_enabled',
    });
    expect(log).not.toContain('tx:begin');
  });

  it('rejects unauthorized actors and missing step-up', async () => {
    const denied = fakePorts({ authorizer: { can: async () => false } });
    await expect(executeCommand(rename, { name: 'A' }, ctx, denied.ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const noStepUp = fakePorts({ stepUp: { satisfied: async () => false } });
    await expect(executeCommand(rename, { name: 'A' }, ctx, noStepUp.ports)).rejects.toMatchObject({
      code: 'step_up_required',
    });
  });

  it('requires a tenant for tenant-scoped commands', async () => {
    const { ports } = fakePorts();
    await expect(
      executeCommand(rename, { name: 'A' }, createCtx({ idempotencyKey: 'k' }), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('replays an idempotent command without re-running the handler', async () => {
    const { ports, log } = fakePorts();
    const first = await executeCommand(rename, { name: 'Acme' }, ctx, ports);
    log.length = 0;
    const second = await executeCommand(rename, { name: 'Acme' }, ctx, ports);
    expect(second).toEqual(first);
    expect(log).not.toContain('tx:begin');
    await expect(executeCommand(rename, { name: 'Other' }, ctx, ports)).rejects.toMatchObject({
      code: 'idempotency_key_reused',
    });
  });

  it('requires an Idempotency-Key when the command is idempotent', async () => {
    const { ports } = fakePorts();
    const noKey = createCtx({ orgId: ctx.orgId });
    await expect(executeCommand(rename, { name: 'A' }, noKey, ports)).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('rejects badly named commands', () => {
    expect(() => defineCommand({ ...rename, name: 'rename' })).toThrow(/module.verbNoun/);
  });
});

describe('stableStringify', () => {
  it('is independent of key order', () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(
      stableStringify({ a: [{ c: 3, d: 2 }], b: 1 }),
    );
  });
});
