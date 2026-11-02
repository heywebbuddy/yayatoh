import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type CommandPorts, type Ctx, DomainError, executeCommand, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { z } from 'zod';
import { append, creditUsageEvent, lockedAccount, refundTx } from './credits.ts';
import { AiOutputError } from './domain/compose.ts';
import { DraftOutputError } from './domain/drafts.ts';
import { type AiPurpose, debit } from './domain/ledger.ts';
import { AI_ROUTES, purposeDisabled } from './domain/routes.ts';
import { AiUnavailableError } from './drafter.ts';
import { aiCallScope, type CallUsage, type UsageOutcome, usageCommand } from './usage.ts';

/**
 * M6.12b: every AI call spends credits from the org's ledger first (the ledger is the AI meter's
 * source: `ai.credits_spent@1` → billing's `ai_credits` meter) and gives them back when the call
 * fails. The permission is the one the feature itself needs, so each feature has its own pair.
 */
function spendPair<const P extends readonly AiPurpose[]>(opts: {
  key: string;
  permission: string;
  purposes: P;
}) {
  const spend = tenantCommand({
    name: `ai.spend${opts.key}`,
    category: 'money',
    input: z.object({
      purpose: z.enum(opts.purposes),
      eventId: z.uuid().nullable().default(null),
      credits: z.int().min(1).max(50).default(1),
    }),
    output: z.object({ debitId: z.uuid(), balance: z.number().int() }),
    entitlement: 'ai',
    permission: opts.permission,
    handler: async ({ input, ctx, tx, emit }) => {
      if (input.eventId && !(await findEventTx(tx, input.eventId))) throw new DomainError('not_found');
      const account = await lockedAccount(tx, ctx);
      const spent = debit(account, input.credits);
      if (!spent.ok)
        throw new DomainError('invalid_state', 'No AI credits left this month', { reason: 'out_of_credits' });
      const [id] = await append(tx, ctx, account.id, spent.state, [spent.entry], {
        reason: 'ai',
        draftKind: input.purpose,
        ...(input.eventId ? { eventId: input.eventId } : {}),
      });
      if (!id) throw new DomainError('internal');
      emit(creditUsageEvent('ai.credits_spent', requireOrg(ctx), id, Math.abs(spent.entry.amount)));
      return { debitId: id, balance: spent.state.balance };
    },
    audit: (input, res) => ({
      action: 'ai.credit.spend',
      targetType: input.eventId ? 'event' : 'organization',
      targetId: input.eventId,
      data: { purpose: input.purpose, debitId: res.debitId, balance: res.balance },
    }),
  });
  const giveBack = tenantCommand({
    name: `ai.refund${opts.key}`,
    category: 'money',
    input: z.object({ debitId: z.uuid() }),
    output: z.object({ balance: z.number().int(), refunded: z.boolean() }),
    entitlement: 'ai',
    permission: opts.permission,
    handler: ({ input, ctx, tx, emit }) => refundTx(tx, ctx, input.debitId, emit),
    audit: (input) => ({ action: 'ai.credit.refund', targetType: 'credit', targetId: input.debitId }),
  });
  return { spend, refund: giveBack, record: usageCommand(opts.key, opts.permission) };
}

/** Campaign drafts and audience suggestions: whoever may send messages. */
export const messagingCredits = spendPair({
  key: 'MessagingCredit',
  permission: 'messages:send',
  purposes: ['campaign', 'audience', 'insights', 'support_assist'] as const,
});
/** Org site pages (the CMS): whoever may write marketing content. */
export const contentCredits = spendPair({
  key: 'ContentCredit',
  permission: 'marketing:write',
  purposes: ['page', 'translate'] as const,
});
/** Agenda drafts, matchmaking embeddings and whole-event setup drafts: whoever may edit events. */
export const eventCredits = spendPair({
  key: 'EventCredit',
  permission: 'events:write',
  purposes: ['agenda', 'embedding', 'event_setup', 'insights'] as const,
});

/**
 * An attendee's question to an event's assistant: charged to the organizer's credits. The asker is
 * not a member, so the permission is a `public:` one; the web action rate limits first and checks
 * that the organizer turned the assistant on for the event.
 */
export const assistantCredits = spendPair({
  key: 'AssistantCredit',
  permission: 'public:ai.assistant',
  purposes: ['assistant', 'help_answer'] as const,
});
/** AI1: help with a refund request: whoever may decide one. */
export const refundCredits = spendPair({
  key: 'RefundCredit',
  permission: 'orders:refund',
  purposes: ['support_assist'] as const,
});

type Pair =
  | typeof messagingCredits
  | typeof contentCredits
  | typeof eventCredits
  | typeof assistantCredits
  | typeof refundCredits;

export const AI_CALL_TIMEOUT_MS = 30_000;

/** Run `call` against the provider with a timeout. */
export async function withTimeout<T>(call: Promise<T>, ms = AI_CALL_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    call,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AiUnavailableError('timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const outcomeOf = (err: unknown): UsageOutcome =>
  err instanceof AiOutputError || err instanceof DraftOutputError ? 'unusable' : 'unavailable';

/**
 * Spend the credits, run `call` on the purpose's route, record the call's usage, and refund when
 * it throws. Provider failures and unusable output come back as `invalid_state` with reason
 * `ai_unavailable` / `ai_output`. A purpose in `AI_DISABLED_PURPOSES` spends and calls nothing.
 */
export async function chargedCall<T>(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  pair: Pair,
  spendInput: { purpose: AiPurpose; eventId?: string | null; credits?: number },
  call: () => Promise<T>,
): Promise<{ value: T; balance: number }> {
  if (purposeDisabled(spendInput.purpose, process.env.AI_DISABLED_PURPOSES))
    throw new DomainError('invalid_state', 'AI is unavailable', { reason: 'ai_unavailable' });
  // The purposes are checked by each pair's input schema.
  const spent = await executeCommand(
    pair.spend as typeof messagingCredits.spend,
    spendInput as never,
    ctx,
    ports,
  );
  const route = AI_ROUTES[spendInput.purpose];
  const seen: { usage: CallUsage | null } = { usage: null };
  const started = Date.now();
  const record = async (outcome: UsageOutcome) => {
    // Bookkeeping must never cost the organizer a draft they already have.
    try {
      await executeCommand(
        pair.record as typeof messagingCredits.record,
        {
          purpose: spendInput.purpose,
          eventId: spendInput.eventId ?? null,
          debitId: spent.debitId,
          model: seen.usage?.model ?? route.model,
          inputTokens: seen.usage?.input ?? 0,
          cacheReadTokens: seen.usage?.cacheRead ?? 0,
          outputTokens: seen.usage?.output ?? 0,
          latencyMs: Date.now() - started,
          outcome,
        },
        ctx,
        ports,
      );
    } catch (err) {
      console.error('ai: usage not recorded', err);
    }
  };
  try {
    const value = await aiCallScope.run(
      {
        route,
        report: (u) => {
          seen.usage = u;
        },
      },
      call,
    );
    await record('ok');
    return { value, balance: spent.balance };
  } catch (err) {
    await record(seen.usage?.refused ? 'refused' : outcomeOf(err));
    await executeCommand(
      pair.refund as typeof messagingCredits.refund,
      { debitId: spent.debitId },
      ctx,
      ports,
    );
    if (err instanceof AiOutputError || err instanceof DraftOutputError)
      throw new DomainError('invalid_state', 'The AI result could not be used', { reason: 'ai_output' });
    if (err instanceof AiUnavailableError)
      throw new DomainError('invalid_state', 'AI is unavailable', { reason: 'ai_unavailable' });
    throw err;
  }
}
