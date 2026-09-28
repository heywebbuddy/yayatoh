import type { z } from 'zod';
import type { Ctx } from './ctx.ts';
import { DomainError } from './errors.ts';

/** A versioned domain event written to the outbox inside the command's transaction. */
export interface DomainEvent<P = unknown> {
  readonly type: string;
  readonly version: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: P;
}

export interface AuditEntry {
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly data?: Record<string, unknown>;
}

export interface HandlerArgs<I, Tx> {
  readonly input: I;
  readonly ctx: Ctx;
  readonly tx: Tx;
  /** Queue a domain event; written to the outbox after the handler returns (step 8). */
  readonly emit: (event: DomainEvent) => void;
  /**
   * Step-up decided by data the handler reads (e.g. a large refund): throws `step_up_required`
   * unless the actor re-authenticated recently. Rolls the transaction back like any error.
   */
  readonly requireStepUp: () => Promise<void>;
}

/**
 * What kind of thing a command does, for rules that apply to a whole kind rather than a list of
 * pages (M1.2e): `money` moves money or changes where it goes (refunds, payouts, payout accounts,
 * transfers); `export` lets data leave in bulk (every bulk action with a file, DSAR exports);
 * `delete` deletes or erases. Commands of these kinds are refused while staff act as a member.
 */
export type CommandCategory = 'money' | 'export' | 'delete';
export const COMMAND_CATEGORIES: readonly CommandCategory[] = ['money', 'export', 'delete'];

/** Refused while platform staff act as a member (roadmap M1.2: blocks money, export and delete). */
export const IMPERSONATION_BLOCKED: ReadonlySet<CommandCategory> = new Set(COMMAND_CATEGORIES);

/** The refusal for a command (or query) of `category` under an impersonated context, if any. */
export function impersonationRefusal(ctx: Ctx, category: CommandCategory | undefined): DomainError | null {
  if (!ctx.impersonatedBy || !category || !IMPERSONATION_BLOCKED.has(category)) return null;
  return new DomainError('impersonation_blocked', 'Not available while acting as a member', {
    reason: category,
  });
}

export interface CommandDefinition<I, O, R, Tx> {
  /** `module.verbNoun`, e.g. `tenancy.createOrganization`. Unique across the app. */
  readonly name: string;
  readonly input: z.ZodType<I>;
  /** Allowlist output schema. Only the keys it declares leave the command (step 10). */
  readonly output: z.ZodType<O>;
  /** Module entitlement key, or `null` for platform-level commands (explicit, never implied). */
  readonly entitlement: string | null;
  /** Permission checked by the authorizer, e.g. `org:update`. */
  readonly permission: string;
  /** Require a recent step-up (re-authentication). */
  readonly stepUp?: boolean;
  /** What kind of thing this command does (money, export, delete): see CommandCategory. */
  readonly category?: CommandCategory;
  /** Require an Idempotency-Key and replay the stored result on retry. Default: false. */
  readonly idempotent?: boolean;
  /** Tenant-scoped commands run in `withTenant`; platform commands need `orgId === null` explicitly. */
  readonly scope?: 'tenant' | 'platform';
  readonly handler: (args: HandlerArgs<I, Tx>) => Promise<R>;
  /** Audit row for this execution (step 9). Defaults to `{ action: name }`. */
  readonly audit?: (input: I, result: R) => AuditEntry;
  /** Maps the handler result to the output DTO before the allowlist parse. Default: identity. */
  readonly present?: (result: R) => unknown;
}

export type Command<I, O, R = unknown, Tx = unknown> = CommandDefinition<I, O, R, Tx> & {
  readonly kind: 'command';
};

export function defineCommand<I, O, R, Tx = unknown>(
  def: CommandDefinition<I, O, R, Tx>,
): Command<I, O, R, Tx> {
  if (!/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/.test(def.name)) {
    throw new Error(`Command name must be "module.verbNoun": ${def.name}`);
  }
  if (!def.permission) throw new Error(`Command ${def.name} must declare a permission`);
  return Object.freeze({ ...def, kind: 'command' as const });
}

/** Everything `executeCommand` needs from the platform. Implemented in packages/platform. */
export interface CommandPorts<Tx> {
  readonly entitlements: { has(ctx: Ctx, key: string): Promise<boolean> };
  readonly authorizer: { can(ctx: Ctx, permission: string, input: unknown): Promise<boolean> };
  readonly stepUp: { satisfied(ctx: Ctx): Promise<boolean> };
  readonly idempotency: {
    lookup(ctx: Ctx, scope: string, key: string, fingerprint: string): Promise<{ output: unknown } | null>;
    save(tx: Tx, ctx: Ctx, scope: string, key: string, fingerprint: string, output: unknown): Promise<void>;
  };
  readonly transaction: <T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>) => Promise<T>;
  readonly outbox: { emit(tx: Tx, ctx: Ctx, events: readonly DomainEvent[]): Promise<void> };
  readonly audit: { record(tx: Tx, ctx: Ctx, entry: AuditEntry): Promise<void> };
}

/** Stable JSON (sorted keys) for idempotency fingerprints. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * A stored idempotent result, parsed again with the command's output schema. The store keeps
 * JSON, so dates come back as ISO strings: exactly the fields the schema reports as expecting a
 * date are turned back into Dates, and nothing else is touched.
 */
export function replayOutput<O>(schema: z.ZodType<O>, stored: unknown): O {
  let value = stored;
  for (let round = 0; round < 3; round++) {
    const r = schema.safeParse(value);
    if (r.success) return r.data;
    const dates = r.error.issues.filter((i) => i.code === 'invalid_type' && i.expected === 'date');
    if (dates.length === 0) break;
    value = structuredClone(value);
    for (const issue of dates) reviveAt(value, issue.path);
  }
  return schema.parse(value);
}

function reviveAt(root: unknown, path: readonly PropertyKey[]): void {
  let node = root as Record<PropertyKey, unknown>;
  for (const key of path.slice(0, -1)) node = node?.[key] as Record<PropertyKey, unknown>;
  const last = path[path.length - 1];
  if (node && last !== undefined && typeof node[last] === 'string') {
    const d = new Date(node[last] as string);
    if (!Number.isNaN(d.getTime())) node[last] = d;
  }
}

/**
 * The single write pipeline. Steps run in this order, always:
 * (impersonation refusal) · 1 validate · 2 entitlement · 3 authorize · 4 step-up · 5 idempotency ·
 * 6 tenant transaction · 7 handler · 8 outbox · 9 audit · 10 serialize.
 */
export async function executeCommand<I, O, R, Tx>(
  command: Command<I, O, R, Tx>,
  rawInput: unknown,
  ctx: Ctx,
  ports: CommandPorts<Tx>,
): Promise<O> {
  // Staff acting as a member (M1.2e) never move money, export or delete: whatever the input or
  // the member's role, before anything else runs.
  const refusal = impersonationRefusal(ctx, command.category);
  if (refusal) throw refusal;

  // 1. Validate
  const parsed = command.input.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError('validation_failed', 'Invalid input', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), code: i.code })),
    });
  }
  const input = parsed.data;

  const scope = command.scope ?? 'tenant';
  if (scope === 'tenant' && !ctx.orgId) throw new DomainError('forbidden', 'Tenant context required');

  // 2. Entitlement
  if (command.entitlement !== null && !(await ports.entitlements.has(ctx, command.entitlement))) {
    throw new DomainError('module_not_enabled', `Module not enabled: ${command.entitlement}`, {
      module: command.entitlement,
    });
  }

  // 3. Authorize
  if (!(await ports.authorizer.can(ctx, command.permission, input))) {
    throw new DomainError('forbidden', 'Not allowed');
  }

  // 4. Step-up (never satisfied while staff act as a member: the person isn't there to confirm)
  const requireStepUp = async () => {
    if (ctx.impersonatedBy)
      throw new DomainError('impersonation_blocked', 'Not available while acting as a member', {
        reason: 'step_up',
      });
    if (!(await ports.stepUp.satisfied(ctx)))
      throw new DomainError('step_up_required', 'Re-authentication required');
  };
  if (command.stepUp) await requireStepUp();

  // 5. Idempotency
  let fingerprint: string | null = null;
  if (command.idempotent) {
    if (!ctx.idempotencyKey) throw new DomainError('validation_failed', 'Idempotency-Key is required');
    fingerprint = stableStringify({ command: command.name, input });
    const prior = await ports.idempotency.lookup(ctx, command.name, ctx.idempotencyKey, fingerprint);
    if (prior) return replayOutput(command.output, prior.output);
  }

  // 6. Tenant transaction
  return ports.transaction(ctx, async (tx) => {
    // 7. Handler
    const events: DomainEvent[] = [];
    const result = await command.handler({
      input,
      ctx,
      tx,
      emit: (e) => void events.push(e),
      requireStepUp,
    });

    // 8. Outbox
    if (events.length > 0) await ports.outbox.emit(tx, ctx, events);

    // 9. Audit
    await ports.audit.record(
      tx,
      ctx,
      command.audit
        ? command.audit(input, result)
        : { action: command.name, targetType: 'none', targetId: null },
    );

    // 10. Serialize (inside the transaction: a leak-shaped result rolls the write back)
    const presented = command.present ? command.present(result) : result;
    const output = command.output.parse(presented);

    if (command.idempotent && ctx.idempotencyKey && fingerprint) {
      await ports.idempotency.save(tx, ctx, command.name, ctx.idempotencyKey, fingerprint, output);
    }
    return output;
  });
}
