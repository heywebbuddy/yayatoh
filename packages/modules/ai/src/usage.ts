import { AsyncLocalStorage } from 'node:async_hooks';
import { requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { z } from 'zod';
import { AI_PURPOSES } from './domain/ledger.ts';
import { type AiRoute, costMicros } from './domain/routes.ts';
import { aiUsage } from './schema.ts';

export interface CallUsage {
  readonly model: string;
  readonly input: number;
  readonly cacheRead: number;
  readonly output: number;
  /** The model declined (classifiers or policy), as opposed to a reply that couldn't be used. */
  readonly refused?: boolean;
}

/**
 * AI1: what one provider call needs from its caller, carried beside the call so the port's many
 * call sites don't change. The adapter reads the route and reports its usage here.
 */
export const aiCallScope = new AsyncLocalStorage<{
  readonly route: AiRoute;
  readonly report: (usage: CallUsage) => void;
}>();

export const USAGE_OUTCOMES = ['ok', 'refused', 'unusable', 'unavailable'] as const;
export type UsageOutcome = (typeof USAGE_OUTCOMES)[number];

const RecordUsageInput = z.object({
  purpose: z.enum(AI_PURPOSES),
  eventId: z.uuid().nullable().default(null),
  debitId: z.uuid().nullable().default(null),
  model: z.string().max(80),
  inputTokens: z.int().min(0),
  cacheReadTokens: z.int().min(0),
  outputTokens: z.int().min(0),
  latencyMs: z.int().min(0),
  outcome: z.enum(USAGE_OUTCOMES),
});
export type RecordUsageInput = z.input<typeof RecordUsageInput>;

/** One row per provider call, under the permission of the feature that made it. No prompt text. */
export function usageCommand(key: string, permission: string) {
  return tenantCommand({
    name: `ai.recordUsage${key}`,
    input: RecordUsageInput,
    output: z.object({ id: z.uuid() }),
    entitlement: 'ai',
    permission,
    handler: async ({ input, ctx, tx }) => {
      const [row] = await tx
        .insert(aiUsage)
        .values({
          orgId: requireOrg(ctx),
          purpose: input.purpose,
          eventId: input.eventId,
          debitId: input.debitId,
          model: input.model,
          inputTokens: input.inputTokens,
          cacheReadTokens: input.cacheReadTokens,
          outputTokens: input.outputTokens,
          costMicros: costMicros(input.model, {
            input: input.inputTokens,
            cacheRead: input.cacheReadTokens,
            output: input.outputTokens,
          }),
          latencyMs: input.latencyMs,
          outcome: input.outcome,
        })
        .returning({ id: aiUsage.id });
      if (!row) throw new Error('usage row not written');
      return { id: row.id };
    },
  });
}
