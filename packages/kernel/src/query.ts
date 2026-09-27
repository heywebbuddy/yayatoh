import type { z } from 'zod';
import type { CommandPorts } from './command.ts';
import type { Ctx } from './ctx.ts';
import { DomainError } from './errors.ts';

export interface QueryDefinition<I, O, R, Tx> {
  readonly name: string;
  readonly input: z.ZodType<I>;
  /** Allowlist output schema. */
  readonly output: z.ZodType<O>;
  readonly entitlement: string | null;
  readonly permission: string;
  readonly handler: (args: { input: I; ctx: Ctx; tx: Tx }) => Promise<R>;
  readonly present?: (result: R) => unknown;
}

export type Query<I, O, R = unknown, Tx = unknown> = QueryDefinition<I, O, R, Tx> & {
  readonly kind: 'query';
};

export function defineQuery<I, O, R, Tx = unknown>(def: QueryDefinition<I, O, R, Tx>): Query<I, O, R, Tx> {
  if (!/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/.test(def.name)) {
    throw new Error(`Query name must be "module.getNoun": ${def.name}`);
  }
  return Object.freeze({ ...def, kind: 'query' as const });
}

export type QueryPorts<Tx> = Pick<CommandPorts<Tx>, 'entitlements' | 'authorizer' | 'transaction'>;

/** The read pipeline: validate → entitlement → authorize → tenant transaction → handler → serialize. */
export async function executeQuery<I, O, R, Tx>(
  query: Query<I, O, R, Tx>,
  rawInput: unknown,
  ctx: Ctx,
  ports: QueryPorts<Tx>,
): Promise<O> {
  const parsed = query.input.safeParse(rawInput);
  if (!parsed.success) throw new DomainError('validation_failed', 'Invalid input');
  if (!ctx.orgId) throw new DomainError('forbidden', 'Tenant context required');
  if (query.entitlement !== null && !(await ports.entitlements.has(ctx, query.entitlement))) {
    throw new DomainError('module_not_enabled', `Module not enabled: ${query.entitlement}`, {
      module: query.entitlement,
    });
  }
  if (!(await ports.authorizer.can(ctx, query.permission, parsed.data)))
    throw new DomainError('forbidden', 'Not allowed');
  return ports.transaction(ctx, async (tx) => {
    const result = await query.handler({ input: parsed.data, ctx, tx });
    return query.output.parse(query.present ? query.present(result) : result);
  });
}
