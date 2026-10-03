import type { TenantTx } from '@yayatoh/db';
import { eventDetailsQuery, findEventTx, getEventQuery } from '@yayatoh/events';
import {
  actorId,
  type CommandPorts,
  type Ctx,
  DomainError,
  executeCommand,
  executeQuery,
  requireOrg,
  utcToZonedInput,
} from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { cleanDraft, DraftOutputError, MAX_NOTES_LENGTH } from './domain/drafts.ts';
import {
  AI_PURPOSES,
  type AiPurpose,
  type CreditState,
  DRAFT_KINDS,
  type DraftKind,
  debit,
  effectiveBalance,
  FREE_MONTHLY_CREDITS,
  type LedgerEntry,
  periodOf,
  refund,
  rollover,
} from './domain/ledger.ts';
import { type AiDrafter, AiUnavailableError } from './drafter.ts';
import { creditAccounts, creditLedger } from './schema.ts';

/** Sentinel period of a new account: the first use tops it up to the allowance. */
const NEVER = '0000-00';

export const CreditBalanceDto = z.object({
  balance: z.number().int(),
  allowance: z.number().int(),
  period: z.string(),
});
export type CreditBalanceDto = z.infer<typeof CreditBalanceDto>;

export const CreditEntryDto = z.object({
  id: z.uuid(),
  kind: z.enum(['grant', 'debit', 'refund', 'adjust']),
  amount: z.number().int(),
  balanceAfter: z.number().int(),
  reason: z.string(),
  draftKind: z.enum(AI_PURPOSES).nullable(),
  createdAt: z.date(),
});
export type CreditEntryDto = z.infer<typeof CreditEntryDto>;

type AccountRow = typeof creditAccounts.$inferSelect;

/**
 * The org's account, locked for this transaction (FOR UPDATE), brought into the current month.
 * Two concurrent drafts serialize here, so neither can spend a credit the other already spent.
 */
export async function lockedAccount(tx: TenantTx, ctx: Ctx): Promise<AccountRow> {
  const orgId = requireOrg(ctx);
  const find = () => tx.select().from(creditAccounts).where(eq(creditAccounts.orgId, orgId)).for('update');
  let [row] = await find();
  if (!row) {
    await tx
      .insert(creditAccounts)
      .values({ orgId, balance: 0, allowance: FREE_MONTHLY_CREDITS, period: NEVER })
      .onConflictDoNothing({ target: creditAccounts.orgId });
    [row] = await find();
  }
  if (!row) throw new DomainError('internal');
  const period = periodOf(ctx.now);
  const { state, entries } = rollover(row, period, row.allowance);
  if (entries.length === 0) return row;
  await append(tx, ctx, row.id, state, entries, { reason: 'monthly_allowance' });
  return { ...row, ...state };
}

export async function append(
  tx: TenantTx,
  ctx: Ctx,
  accountId: string,
  state: CreditState,
  entries: readonly LedgerEntry[],
  meta: { reason: string; draftKind?: AiPurpose; eventId?: string; refId?: string },
): Promise<string[]> {
  const orgId = requireOrg(ctx);
  await tx
    .update(creditAccounts)
    .set({ balance: state.balance, period: state.period, updatedAt: ctx.now })
    .where(eq(creditAccounts.id, accountId));
  const rows = await tx
    .insert(creditLedger)
    .values(
      entries.map((e) => ({
        orgId,
        kind: e.kind,
        amount: e.amount,
        balanceAfter: e.balanceAfter,
        period: state.period,
        reason: meta.reason,
        draftKind: meta.draftKind ?? null,
        eventId: meta.eventId ?? null,
        refId: meta.refId ?? null,
        actor: actorId(ctx.actor),
      })),
    )
    .returning({ id: creditLedger.id });
  return rows.map((r) => r.id);
}

/** The AI meter's usage event (M6.6b): credits spent on, or given back for, one draft. */
export const creditUsageEvent = (type: string, orgId: string, debitId: string, credits: number) => ({
  type,
  version: 1,
  aggregateType: 'ai_credit',
  aggregateId: debitId,
  payload: { orgId, debitId, credits },
});

export const creditBalanceQuery = tenantQuery({
  name: 'ai.creditBalance',
  input: z.object({}),
  output: CreditBalanceDto,
  entitlement: 'ai',
  permission: 'events:read',
  handler: async ({ ctx, tx }) => {
    const [row] = await tx
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.orgId, requireOrg(ctx)));
    const period = periodOf(ctx.now);
    const allowance = row?.allowance ?? FREE_MONTHLY_CREDITS;
    // A read never writes: a new month shows the topped-up balance the next draft will see.
    return {
      balance: effectiveBalance(row ?? { balance: 0, period: NEVER }, period, allowance),
      allowance,
      period,
    };
  },
});

export const creditLedgerQuery = tenantQuery({
  name: 'ai.creditLedger',
  input: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
  output: z.array(CreditEntryDto),
  entitlement: 'ai',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select()
      .from(creditLedger)
      .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
      .limit(input.limit);
    return rows.map((r) => CreditEntryDto.parse(r));
  },
});

/** Spend one credit for a draft of `kind` for `eventId`. `invalid_state/out_of_credits` at zero. */
export const debitDraftCreditCommand = tenantCommand({
  name: 'ai.debitCredit',
  category: 'money',
  input: z.object({ eventId: z.uuid(), kind: z.enum(DRAFT_KINDS) }),
  output: z.object({ debitId: z.uuid(), balance: z.number().int() }),
  entitlement: 'ai',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    if (!(await findEventTx(tx, input.eventId))) throw new DomainError('not_found');
    const account = await lockedAccount(tx, ctx);
    const spent = debit(account);
    if (!spent.ok)
      throw new DomainError('invalid_state', 'No AI credits left this month', { reason: 'out_of_credits' });
    const [id] = await append(tx, ctx, account.id, spent.state, [spent.entry], {
      reason: 'draft',
      draftKind: input.kind,
      eventId: input.eventId,
    });
    if (!id) throw new DomainError('internal');
    // The AI meter (M6.6b, P6-7/D12) counts credits from this event (billing's usage meter).
    emit(creditUsageEvent('ai.credits_spent', requireOrg(ctx), id, Math.abs(spent.entry.amount)));
    return { debitId: id, balance: spent.state.balance };
  },
  audit: (input, res) => ({
    action: 'ai.draft.debit',
    targetType: 'event',
    targetId: input.eventId,
    data: { kind: input.kind, debitId: res.debitId, balance: res.balance },
  }),
});

/** Give a debit back, once: a second refund of the same debit is a no-op. */
export async function refundTx(
  tx: TenantTx,
  ctx: Ctx,
  debitId: string,
  emit: (e: ReturnType<typeof creditUsageEvent>) => void,
): Promise<{ balance: number; refunded: boolean }> {
  const account = await lockedAccount(tx, ctx);
  const [d] = await tx
    .select()
    .from(creditLedger)
    .where(and(eq(creditLedger.id, debitId), eq(creditLedger.kind, 'debit')));
  if (!d) throw new DomainError('not_found');
  const [already] = await tx
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(and(eq(creditLedger.refId, d.id), eq(creditLedger.kind, 'refund')));
  if (already) return { balance: account.balance, refunded: false };
  const back = refund(account, d.amount);
  await append(tx, ctx, account.id, back.state, [back.entry], {
    reason: d.reason === 'draft' ? 'draft_failed' : 'ai_failed',
    ...(d.draftKind ? { draftKind: d.draftKind as AiPurpose } : {}),
    ...(d.eventId ? { eventId: d.eventId } : {}),
    refId: d.id,
  });
  emit(creditUsageEvent('ai.credits_refunded', requireOrg(ctx), d.id, Math.abs(back.entry.amount)));
  return { balance: back.state.balance, refunded: true };
}

/** Give a failed draft's credit back, once (a second refund of the same debit is a no-op). */
export const refundDraftCreditCommand = tenantCommand({
  name: 'ai.refundCredit',
  category: 'money',
  input: z.object({ debitId: z.uuid() }),
  output: z.object({ balance: z.number().int(), refunded: z.boolean() }),
  entitlement: 'ai',
  permission: 'events:write',
  handler: ({ input, ctx, tx, emit }) => refundTx(tx, ctx, input.debitId, emit),
  audit: (input) => ({ action: 'ai.draft.refund', targetType: 'credit', targetId: input.debitId }),
});

/**
 * Platform staff (and dev/CI tooling, as a system actor): set an org's balance, recorded as one
 * `adjust` entry with a reason. Metered purchases replace this at M6.6.
 */
export const adjustCreditsCommand = tenantCommand({
  name: 'ai.adjustCredits',
  input: z.object({
    balance: z.number().int().min(0).max(100_000),
    reason: z.string().trim().min(3).max(200),
  }),
  output: CreditBalanceDto,
  entitlement: null,
  permission: 'platform:entitlements.manage',
  handler: async ({ input, ctx, tx }) => {
    const account = await lockedAccount(tx, ctx);
    const amount = input.balance - account.balance;
    if (amount !== 0)
      await append(
        tx,
        ctx,
        account.id,
        { balance: input.balance, period: account.period },
        [{ kind: 'adjust', amount, balanceAfter: input.balance }],
        { reason: input.reason },
      );
    return { balance: input.balance, allowance: account.allowance, period: account.period };
  },
  audit: (input) => ({
    action: 'ai.credits.adjust',
    targetType: 'organization',
    targetId: null,
    data: { balance: input.balance, reason: input.reason },
  }),
});

export const DraftInput = z.object({
  eventId: z.uuid(),
  kind: z.enum(DRAFT_KINDS),
  notes: z.string().max(MAX_NOTES_LENGTH).default(''),
  locale: z.string().max(20).default('en'),
});
export type DraftInput = z.input<typeof DraftInput>;

export const DraftResultDto = z.object({
  kind: z.enum(DRAFT_KINDS),
  /** The cleaned preview, as the organizer edits it (FAQ: blocks of question + answer). */
  text: z.string(),
  balance: z.number().int(),
});
export type DraftResultDto = z.infer<typeof DraftResultDto>;

export const DRAFT_TIMEOUT_MS = 30_000;

/**
 * Draft copy for an event (M1.4f): spend a credit (permission, entitlement and balance checks
 * happen there), build the facts, call the drafter outside any transaction, clean the result.
 * A provider failure or an unusable draft gives the credit back. Nothing is saved: the result
 * is a preview the organizer accepts (through the normal event commands), edits or rejects.
 */
export async function draftEventCopy(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  drafter: AiDrafter | null,
  raw: DraftInput,
): Promise<DraftResultDto> {
  const parsed = DraftInput.safeParse(raw);
  if (!parsed.success)
    throw new DomainError('validation_failed', 'Invalid draft request', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), code: i.code })),
    });
  const input = parsed.data;
  if (!drafter) throw new DomainError('invalid_state', 'AI drafting is off', { reason: 'ai_unavailable' });
  const spent = await executeCommand(
    debitDraftCreditCommand,
    { eventId: input.eventId, kind: input.kind },
    ctx,
    ports,
  );
  try {
    const ev = await executeQuery(getEventQuery, { eventId: input.eventId }, ctx, ports);
    const details = await executeQuery(eventDetailsQuery, { eventId: input.eventId }, ctx, ports);
    const fmt = (d: Date) => utcToZonedInput(d, ev.timezone).replace('T', ' ');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const raw = await Promise.race([
      drafter.draft({
        kind: input.kind,
        locale: input.locale,
        notes: input.notes,
        facts: {
          name: ev.name,
          profile: ev.profile,
          startsLocal: fmt(ev.startsAt),
          endsLocal: fmt(ev.endsAt),
          timezone: ev.timezone,
          venueName: ev.venueName,
          city: ev.city,
          attendanceMode: details.attendanceMode,
          category: details.category,
          tagline: ev.tagline,
        },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AiUnavailableError('timeout')), DRAFT_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    return { kind: input.kind, text: cleanDraft(input.kind, raw), balance: spent.balance };
  } catch (err) {
    await executeCommand(refundDraftCreditCommand, { debitId: spent.debitId }, ctx, ports);
    if (err instanceof DraftOutputError)
      throw new DomainError('invalid_state', 'The draft could not be used', { reason: 'ai_output' });
    if (err instanceof AiUnavailableError)
      throw new DomainError('invalid_state', 'AI drafting is unavailable', { reason: 'ai_unavailable' });
    throw err;
  }
}
