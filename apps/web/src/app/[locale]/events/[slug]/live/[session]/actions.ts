'use server';

import { askQuestionCommand, upvoteQuestionCommand, voteCommand } from '@yayatoh/engagement';
import { checkoutTarget } from '@yayatoh/events';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { openFeedbackCommand } from '@yayatoh/surveys';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { participantKeyFor, viewerAccount } from '@/server/engagement.ts';
import { ports } from '@/server/ports.ts';
import { limitAction } from '@/server/rate-limit.ts';

/** What a participant's form gets back: ok, or a code/reason the view turns into a message. */
export interface LiveActionState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly field?: string;
  readonly stamp?: number;
}

const refused = (err: unknown): LiveActionState => {
  if (!isDomainError(err)) throw err;
  const reason = typeof err.details?.reason === 'string' ? err.details.reason : null;
  const field = typeof err.details?.field === 'string' ? err.details.field : undefined;
  return { ok: false, code: reason ?? err.code, ...(field ? { field } : {}) };
};

/**
 * The org and event come from the event's public slug (never from the form); the participant key
 * from the visitor's account or device cookie. Every action is rate limited per device and network.
 */
async function participant(slug: string, sessionId: string) {
  const target = await checkoutTarget(slug);
  if (!target) return null;
  const limit = await limitAction('engagement', { scope: sessionId });
  if (!limit.allowed) return 'rate_limited' as const;
  const key = await participantKeyFor(sessionId, { write: true });
  if (!key) return null;
  // M5.7b: a signed-in person acts as their account, so an attendee's taking part is scored.
  const account = await viewerAccount();
  const asUser = account
    ? createCtx({ orgId: target.orgId, actor: { type: 'user', userId: account.userId } })
    : null;
  return { ...target, key, account, asUser, ctx: createCtx({ orgId: target.orgId }) };
}

export async function voteAction(
  slug: string,
  sessionId: string,
  pollId: string,
  _prev: LiveActionState,
  form: FormData,
): Promise<LiveActionState> {
  const p = await participant(slug, sessionId);
  if (p === 'rate_limited') return { ok: false, code: 'rate_limited' };
  if (!p) return { ok: false, code: 'not_found' };
  const rating = String(form.get('rating') ?? '').trim();
  try {
    await executeCommand(
      voteCommand,
      {
        eventId: p.eventId,
        pollId,
        participantKey: p.key,
        optionIds: form.getAll('option').map(String),
        ...(rating ? { rating: Number(rating) } : {}),
        word: String(form.get('word') ?? ''),
        ...(p.account ? { account: p.account } : {}),
      },
      p.asUser ?? p.ctx,
      ports,
    );
    return { ok: true, code: null, stamp: Date.now() };
  } catch (err) {
    return refused(err);
  }
}

export async function askAction(
  slug: string,
  sessionId: string,
  _prev: LiveActionState,
  form: FormData,
): Promise<LiveActionState> {
  const body = String(form.get('body') ?? '').trim();
  if (!body) return { ok: false, code: 'required', field: 'body' };
  const p = await participant(slug, sessionId);
  if (p === 'rate_limited') return { ok: false, code: 'rate_limited' };
  if (!p) return { ok: false, code: 'not_found' };
  const anonymous = form.get('anonymous') === 'on';
  try {
    await executeCommand(
      askQuestionCommand,
      {
        eventId: p.eventId,
        sessionId,
        participantKey: p.key,
        body,
        name: String(form.get('name') ?? ''),
        anonymous,
        // An anonymous question stays anonymous: no account, no actor (M5.7b scores skip it).
        ...(p.account && !anonymous ? { account: p.account } : {}),
      },
      anonymous ? p.ctx : (p.asUser ?? p.ctx),
      ports,
    );
    return { ok: true, code: null, stamp: Date.now() };
  } catch (err) {
    return refused(err);
  }
}

export async function upvoteAction(
  slug: string,
  sessionId: string,
  questionId: string,
): Promise<LiveActionState> {
  const p = await participant(slug, sessionId);
  if (p === 'rate_limited') return { ok: false, code: 'rate_limited' };
  if (!p) return { ok: false, code: 'not_found' };
  try {
    await executeCommand(
      upvoteQuestionCommand,
      { eventId: p.eventId, questionId, participantKey: p.key },
      p.ctx,
      ports,
    );
    return { ok: true, code: null, stamp: Date.now() };
  } catch (err) {
    return refused(err);
  }
}

/**
 * M5.7b: "Give feedback" once the session is over. The signed-in attendee gets their survey link
 * for this session's feedback survey (M3.9a) and goes to it; one response per person still holds.
 */
export async function openFeedbackAction(
  slug: string,
  sessionId: string,
  _prev: LiveActionState,
): Promise<LiveActionState> {
  const target = await checkoutTarget(slug);
  const account = await viewerAccount();
  if (!target || !account) return { ok: false, code: 'not_found' };
  let token: string;
  try {
    ({ token } = await executeCommand(
      openFeedbackCommand,
      { eventId: target.eventId, sessionId, account },
      createCtx({ orgId: target.orgId, actor: { type: 'user', userId: account.userId } }),
      ports,
    ));
  } catch (err) {
    return refused(err);
  }
  redirect({ href: `/survey/${encodeURIComponent(token)}`, locale: await getLocale() });
  return { ok: true, code: null };
}
