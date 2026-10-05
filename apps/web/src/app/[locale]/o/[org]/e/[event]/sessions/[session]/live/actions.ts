'use server';

import {
  closePollCommand,
  createPollCommand,
  deletePollCommand,
  enableLiveCommand,
  type ModerationAction,
  moderateQuestionCommand,
  openPollCommand,
  type PollKind,
  pinQuestionCommand,
  presentPollCommand,
  rotateDisplayLinkCommand,
  setPollResultsCommand,
  updateSettingsCommand,
} from '@yayatoh/engagement';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/** One moderator control (M5.7a). The org and event come from the route; the command checks the role. */
export type ModeratorIntent =
  | { intent: 'enable' }
  | { intent: 'open' | 'close' | 'delete'; pollId: string }
  | { intent: 'results'; pollId: string; show: boolean }
  | { intent: 'present'; pollId: string | null }
  | { intent: 'moderate'; questionId: string; action: ModerationAction }
  | { intent: 'pin'; questionId: string | null }
  | { intent: 'rotate' };

const path = (org: string, event: string, session: string) => `/o/${org}/e/${event}/sessions/${session}/live`;

export async function moderatorAction(
  org: string,
  event: string,
  sessionId: string,
  input: ModeratorIntent,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'sessions');
  const at = { eventId: ev.id, sessionId };
  const ctx = data.ctx;
  try {
    switch (input.intent) {
      case 'enable':
        await executeCommand(enableLiveCommand, at, ctx, ports);
        break;
      case 'open':
        await executeCommand(openPollCommand, { eventId: ev.id, pollId: input.pollId }, ctx, ports);
        break;
      case 'close':
        await executeCommand(closePollCommand, { eventId: ev.id, pollId: input.pollId }, ctx, ports);
        break;
      case 'delete':
        await executeCommand(deletePollCommand, { eventId: ev.id, pollId: input.pollId }, ctx, ports);
        break;
      case 'results':
        await executeCommand(
          setPollResultsCommand,
          { eventId: ev.id, pollId: input.pollId, show: input.show },
          ctx,
          ports,
        );
        break;
      case 'present':
        await executeCommand(presentPollCommand, { ...at, pollId: input.pollId }, ctx, ports);
        break;
      case 'moderate':
        await executeCommand(
          moderateQuestionCommand,
          { eventId: ev.id, questionId: input.questionId, action: input.action },
          ctx,
          ports,
        );
        break;
      case 'pin':
        await executeCommand(pinQuestionCommand, { ...at, questionId: input.questionId }, ctx, ports);
        break;
      case 'rotate':
        await executeCommand(rotateDisplayLinkCommand, at, ctx, ports);
        break;
    }
  } catch (err) {
    return failure(err);
  }
  // The live views follow the stream; the page itself re-renders for links and settings.
  if (input.intent === 'enable' || input.intent === 'rotate') revalidatePath(path(org, event, sessionId));
  return success();
}

const lines = (v: FormDataEntryValue | null) =>
  String(v ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

export async function createPollAction(
  org: string,
  event: string,
  sessionId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'sessions');
  const kind = String(form.get('kind') ?? 'single') as PollKind;
  const question = String(form.get('question') ?? '').trim();
  const options = lines(form.get('options'));
  const choice = kind === 'single' || kind === 'multi';
  const bad = [...(question ? [] : ['question']), ...(choice && options.length < 2 ? ['options'] : [])];
  if (bad.length) return { ok: false, code: 'validation_failed', fields: bad };
  const max = Number(String(form.get('maxChoices') ?? '').trim() || NaN);
  const scale = Number(String(form.get('ratingScale') ?? '').trim() || NaN);
  try {
    await executeCommand(
      createPollCommand,
      {
        eventId: ev.id,
        sessionId,
        kind,
        question,
        options: choice ? options : [],
        ...(kind === 'multi' && Number.isFinite(max) ? { maxChoices: max } : {}),
        ...(kind === 'rating' && Number.isFinite(scale) ? { ratingScale: scale } : {}),
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  return success();
}

export async function settingsAction(
  org: string,
  event: string,
  sessionId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'sessions');
  try {
    await executeCommand(
      updateSettingsCommand,
      {
        eventId: ev.id,
        sessionId,
        qaOpen: form.get('qaOpen') === 'on',
        allowAnonymous: form.get('allowAnonymous') === 'on',
        anonymousIdentity: form.get('anonymousIdentity') === 'moderators' ? 'moderators' : 'hidden',
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event, sessionId));
  return success();
}

/** "Turn on polls and Q&A" (a plain form: works before any script loads). */
export async function enableLiveAction(org: string, event: string, sessionId: string): Promise<void> {
  await moderatorAction(org, event, sessionId, { intent: 'enable' });
}
