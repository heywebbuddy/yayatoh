'use server';

import { askQuestionCommand, upvoteQuestionCommand, voteCommand } from '@yayatoh/engagement';
import { checkoutTarget } from '@yayatoh/events';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { participantKeyFor } from '@/server/engagement.ts';
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
  return { ...target, key, ctx: createCtx({ orgId: target.orgId }) };
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
      },
      p.ctx,
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
  try {
    await executeCommand(
      askQuestionCommand,
      {
        eventId: p.eventId,
        sessionId,
        participantKey: p.key,
        body,
        name: String(form.get('name') ?? ''),
        anonymous: form.get('anonymous') === 'on',
      },
      p.ctx,
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
