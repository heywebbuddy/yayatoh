import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  COMMAND_CATEGORIES,
  type CommandPorts,
  createCtx,
  DomainError,
  defineCommand,
  defineQuery,
  executeCommand,
  executeQuery,
  isStepUpFresh,
  STEP_UP_WINDOW_MS,
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

  it('runs the org gate inside the transaction, before the handler; a refusal writes nothing (M1.3f)', async () => {
    const seen: unknown[] = [];
    const { ports, log } = fakePorts({
      orgGate: {
        check: async (tx, _c, command) => {
          seen.push({ tx: tx.id, ...command });
          log.push('orgGate');
        },
      },
    });
    await executeCommand(rename, { name: 'Acme' }, ctx, ports);
    expect(log.slice(log.indexOf('tx:begin'), log.indexOf('tx:begin') + 3)).toEqual([
      'tx:begin',
      'orgGate',
      'outbox:organization.renamed',
    ]);
    expect(seen).toEqual([{ tx: 'tx1', name: 'tenancy.renameOrganization', category: undefined }]);

    const refused = fakePorts({
      orgGate: {
        check: async () => {
          throw new DomainError('invalid_state', 'suspended', { reason: 'org_suspended' });
        },
      },
    });
    await expect(executeCommand(rename, { name: 'Acme' }, ctx, refused.ports)).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'org_suspended' },
    });
    expect(refused.log.some((l) => l.startsWith('outbox') || l.startsWith('audit'))).toBe(false);
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

  it('lets a handler require step-up from what it reads, rolling the write back', async () => {
    const conditional = defineCommand<{ amount: number }, { ok: boolean }, { ok: boolean }, FakeTx>({
      name: 'orders.refundSomething',
      input: z.object({ amount: z.int() }),
      output: z.object({ ok: z.boolean() }),
      entitlement: 'core',
      permission: 'orders:refund',
      handler: async ({ input, requireStepUp }) => {
        if (input.amount >= 100) await requireStepUp();
        return { ok: true };
      },
    });
    const stale = fakePorts({ stepUp: { satisfied: async () => false } });
    expect(await executeCommand(conditional, { amount: 5 }, ctx, stale.ports)).toEqual({ ok: true });
    stale.log.length = 0;
    await expect(executeCommand(conditional, { amount: 500 }, ctx, stale.ports)).rejects.toMatchObject({
      code: 'step_up_required',
    });
    expect(stale.log).toContain('tx:begin');
    expect(stale.log).not.toContain('tx:commit');
    const fresh = fakePorts();
    expect(await executeCommand(conditional, { amount: 500 }, ctx, fresh.ports)).toEqual({ ok: true });
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

describe('impersonation (M1.2e)', () => {
  const impersonatedBy = { staffUserId: 'staff-1', impersonationId: 'imp-1' };
  const acting = createCtx({ orgId: '00000000-0000-7000-8000-000000000001', impersonatedBy });
  const plain = (category?: (typeof COMMAND_CATEGORIES)[number], stepUp = false) =>
    defineCommand<Record<string, never>, { ok: boolean }, { ok: boolean }, FakeTx>({
      name: 'orders.doSomething',
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      entitlement: 'core',
      permission: 'orders:refund',
      stepUp,
      ...(category ? { category } : {}),
      handler: async () => ({ ok: true }),
    });

  it('refuses money, export and delete commands before anything runs', async () => {
    for (const category of COMMAND_CATEGORIES) {
      const { ports, log } = fakePorts();
      await expect(executeCommand(plain(category), {}, acting, ports)).rejects.toMatchObject({
        code: 'impersonation_blocked',
        details: { reason: category },
      });
      expect(log).not.toContain('tx:begin');
      // Without an impersonator the same command runs.
      const other = fakePorts();
      expect(
        await executeCommand(plain(category), {}, createCtx({ orgId: acting.orgId }), other.ports),
      ).toEqual({
        ok: true,
      });
    }
  });

  it('runs uncategorized commands, and the context carries the staff member', async () => {
    let seen: unknown = null;
    const { ports } = fakePorts({
      audit: {
        record: async (_tx, c) => {
          seen = c.impersonatedBy;
        },
      },
    });
    expect(await executeCommand(plain(), {}, acting, ports)).toEqual({ ok: true });
    expect(seen).toEqual(impersonatedBy);
  });

  it('never satisfies step-up, even when the session would be fresh', async () => {
    const { ports, log } = fakePorts();
    await expect(executeCommand(plain(undefined, true), {}, acting, ports)).rejects.toMatchObject({
      code: 'impersonation_blocked',
      details: { reason: 'step_up' },
    });
    expect(log).not.toContain('stepUp');
    const conditional = defineCommand<Record<string, never>, { ok: boolean }, { ok: boolean }, FakeTx>({
      name: 'orders.refundLarge',
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      entitlement: 'core',
      permission: 'orders:refund',
      handler: async ({ requireStepUp }) => {
        await requireStepUp();
        return { ok: true };
      },
    });
    await expect(executeCommand(conditional, {}, acting, fakePorts().ports)).rejects.toMatchObject({
      code: 'impersonation_blocked',
    });
  });

  it('refuses export queries (a finished file) but not other reads', async () => {
    const file = defineQuery<Record<string, never>, { ok: boolean }, { ok: boolean }, FakeTx>({
      name: 'reports.exportFile',
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      entitlement: 'core',
      permission: 'reports:read',
      category: 'export',
      handler: async () => ({ ok: true }),
    });
    const { ports } = fakePorts();
    await expect(executeQuery(file, {}, acting, ports)).rejects.toMatchObject({
      code: 'impersonation_blocked',
    });
    expect(await executeQuery({ ...file, category: undefined }, {}, acting, ports)).toEqual({ ok: true });
  });
});

describe('isStepUpFresh', () => {
  const now = new Date('2026-09-27T12:00:00Z');
  it('is fresh for ten minutes after a re-authentication, and never without one', () => {
    expect(isStepUpFresh(null, now)).toBe(false);
    expect(isStepUpFresh(new Date(now.getTime() - 9 * 60_000), now)).toBe(true);
    expect(isStepUpFresh(new Date(now.getTime() - STEP_UP_WINDOW_MS), now)).toBe(false);
    expect(isStepUpFresh(new Date(now.getTime() - 11 * 60_000), now)).toBe(false);
  });
  it('tolerates a little clock skew but not a timestamp from the future', () => {
    expect(isStepUpFresh(new Date(now.getTime() + 2_000), now)).toBe(true);
    expect(isStepUpFresh(new Date(now.getTime() + 5 * 60_000), now)).toBe(false);
  });
});

describe('stableStringify', () => {
  it('is independent of key order', () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(
      stableStringify({ a: [{ c: 3, d: 2 }], b: 1 }),
    );
  });
});
