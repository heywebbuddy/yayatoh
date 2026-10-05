'use server';

import { executeCommand, zonedTimeToUtc } from '@yayatoh/kernel';
import {
  addCfpQuestionCommand,
  addCfpReviewerCommand,
  assignCfpReviewerCommand,
  decideCfpSubmissionCommand,
  placeDraftSessionCommand,
  removeCfpQuestionCommand,
  revokeCfpReviewerCommand,
  saveCfpCommand,
  unassignCfpReviewerCommand,
} from '@yayatoh/program';
import { revalidatePath } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/**
 * The organizer's side of the call for papers (M5.3b): settings and questions, reviewers (portal
 * accounts), assignments and decisions. Every write is a program command (`events:write`, the
 * `speakers` module); viewers get `forbidden` even from a stale page.
 */
const base = (org: string, event: string) => `/o/${org}/e/${event}/speakers/cfp`;
const done = (org: string, event: string) => revalidatePath(base(org, event), 'layout');

async function run(
  org: string,
  event: string,
  write: (ctx: Awaited<ReturnType<typeof loadEvent>>) => Promise<unknown>,
): Promise<ProgramFormState> {
  const loaded = await loadEvent(org, event, 'speakers');
  try {
    await write(loaded);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function saveCfpAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  return run(org, event, async ({ data, event: ev }) => {
    const closes = textOrNull(form, 'closesAt');
    await executeCommand(
      saveCfpCommand,
      {
        eventId: ev.id,
        status: String(form.get('status') ?? 'draft') as 'draft' | 'open' | 'closed',
        intro: String(form.get('intro') ?? ''),
        closesAt: closes ? zonedTimeToUtc(closes, ev.timezone) : null,
        blind: form.getAll('blind').includes('1'),
        durations: form.getAll('durations').map((d) => Number(d)),
        maxCoSpeakers: Number(form.get('maxCoSpeakers') ?? 3),
      },
      data.ctx,
      ports,
    );
  });
}

export async function addQuestionAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  return run(org, event, async ({ data, event: ev }) => {
    const options = String(form.get('options') ?? '')
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean);
    await executeCommand(
      addCfpQuestionCommand,
      {
        eventId: ev.id,
        type: String(form.get('type') ?? 'short_text') as 'short_text',
        label: String(form.get('label') ?? ''),
        required: form.getAll('required').includes('1'),
        options,
      },
      data.ctx,
      ports,
    );
  });
}

export async function removeQuestionAction(
  org: string,
  event: string,
  key: string,
  _prev: ProgramFormState,
): Promise<ProgramFormState> {
  return run(org, event, ({ data, event: ev }) =>
    executeCommand(removeCfpQuestionCommand, { eventId: ev.id, key }, data.ctx, ports),
  );
}

export async function addReviewerAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  return run(org, event, ({ data, event: ev }) =>
    executeCommand(
      addCfpReviewerCommand,
      { eventId: ev.id, name: String(form.get('name') ?? ''), email: String(form.get('email') ?? '') },
      data.ctx,
      ports,
    ),
  );
}

export async function revokeReviewerAction(
  org: string,
  event: string,
  accountId: string,
  _prev: ProgramFormState,
): Promise<ProgramFormState> {
  return run(org, event, ({ data, event: ev }) =>
    executeCommand(revokeCfpReviewerCommand, { eventId: ev.id, accountId }, data.ctx, ports),
  );
}

export async function assignReviewerAction(
  org: string,
  event: string,
  submissionId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  return run(org, event, ({ data, event: ev }) =>
    executeCommand(
      assignCfpReviewerCommand,
      { eventId: ev.id, submissionId, reviewerId: String(form.get('reviewerId') ?? '') },
      data.ctx,
      ports,
    ),
  );
}

export async function unassignReviewerAction(
  org: string,
  event: string,
  submissionId: string,
  reviewerId: string,
  _prev: ProgramFormState,
): Promise<ProgramFormState> {
  return run(org, event, ({ data, event: ev }) =>
    executeCommand(unassignCfpReviewerCommand, { eventId: ev.id, submissionId, reviewerId }, data.ctx, ports),
  );
}

export async function decideSubmissionAction(
  org: string,
  event: string,
  submissionId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const state = await run(org, event, ({ data, event: ev }) =>
    executeCommand(
      decideCfpSubmissionCommand,
      {
        eventId: ev.id,
        submissionId,
        decision: form.get('decision') === 'approve' ? 'accept' : 'reject',
        note: textOrNull(form, 'note'),
      },
      data.ctx,
      ports,
    ),
  );
  if (state.ok) {
    revalidatePath(`/o/${org}/e/${event}/sessions`);
    revalidatePath(`/o/${org}/e/${event}/speakers`);
  }
  return state;
}

/** "Add to the agenda" from the sessions page: the accepted proposal's draft becomes public. */
export async function placeDraftSessionAction(
  org: string,
  event: string,
  sessionId: string,
  _prev: ProgramFormState,
): Promise<ProgramFormState> {
  const state = await run(org, event, ({ data, event: ev }) =>
    executeCommand(placeDraftSessionCommand, { eventId: ev.id, sessionId }, data.ctx, ports),
  );
  if (state.ok) revalidatePath(`/o/${org}/e/${event}/sessions`);
  return state;
}
