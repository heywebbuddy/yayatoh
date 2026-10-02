'use server';

import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { manageTokenOrg } from '@yayatoh/orders';
import {
  acceptSessionOfferCommand,
  CONFLICT_CHOICES,
  type ConflictChoice,
  dropSessionCommand,
  enrollSessionCommand,
} from '@yayatoh/registration';
import { revalidatePath } from 'next/cache';
import type { ScheduleActionState } from '@/components/my-schedule.tsx';
import { ports } from '@/server/ports.ts';
import { limitAction } from '@/server/rate-limit.ts';

/**
 * "My schedule" (M5.2b): the order's manage link is the only credential; the org comes from it
 * (never from the request) and the commands re-check the registrant, the session and every rule.
 */
async function run(
  token: string,
  fn: (ctx: ReturnType<typeof createCtx>) => Promise<Partial<ScheduleActionState>>,
): Promise<ScheduleActionState> {
  const limit = await limitAction('sessionEnrollment', { identity: `order:${token}` });
  if (!limit.allowed) return { ok: false, code: 'rate_limited' };
  const orgId = await manageTokenOrg(token);
  if (!orgId) return { ok: false, code: 'not_found' };
  try {
    const out = await fn(createCtx({ orgId }));
    revalidatePath(`/orders/${token}/schedule`);
    return { ok: true, code: null, stamp: Date.now(), ...out };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const d = (err.details ?? {}) as {
      reason?: string;
      sessionTitle?: string | null;
      groupName?: string | null;
      keepBoth?: boolean;
    };
    return {
      ok: false,
      code: err.code,
      reason: d.reason,
      otherTitle: d.sessionTitle ?? undefined,
      groupName: d.groupName ?? undefined,
      keepBoth: d.keepBoth === true,
    };
  }
}

/** One form per session: the pressed button's `intent` says what to do (enrol, drop, accept). */
export async function scheduleAction(
  token: string,
  registrantId: string,
  sessionId: string,
  _prev: ScheduleActionState,
  form: FormData,
): Promise<ScheduleActionState> {
  const intent = String(form.get('intent') ?? '');
  const raw = String(form.get('choice') ?? 'refuse');
  const choice = (CONFLICT_CHOICES as readonly string[]).includes(raw) ? (raw as ConflictChoice) : 'refuse';
  return run(token, async (ctx) => {
    const input = { token, registrantId, sessionId };
    if (intent === 'drop') return { done: (await executeCommand(dropSessionCommand, input, ctx, ports)).status };
    if (intent === 'accept') {
      await executeCommand(acceptSessionOfferCommand, input, ctx, ports);
      return { done: 'accepted' };
    }
    const r = await executeCommand(enrollSessionCommand, { ...input, choice }, ctx, ports);
    return { done: r.status, position: r.position ?? undefined };
  });
}
