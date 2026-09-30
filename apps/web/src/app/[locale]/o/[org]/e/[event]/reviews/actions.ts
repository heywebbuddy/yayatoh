'use server';

import { executeCommand } from '@yayatoh/kernel';
import { dismissReportsCommand, hideReviewCommand, unhideReviewCommand } from '@yayatoh/reviews';
import { revalidatePath, updateTag } from 'next/cache';
import { orgChangeTags } from '@/lib/cache-keys.ts';
import type { FormState } from '@/lib/form-state.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

async function run(
  org: string,
  event: string,
  fn: (ctx: Awaited<ReturnType<typeof loadEvent>>) => Promise<unknown>,
): Promise<FormState> {
  const loaded = await loadEvent(org, event, 'reviews');
  try {
    await fn(loaded);
  } catch (err) {
    return failure(err);
  }
  // The public event page shows reviews: drop the org's cached public reads.
  for (const tag of orgChangeTags(loaded.data.org.id)) updateTag(tag);
  revalidatePath(`/o/${org}/e/${event}/reviews`);
  return success();
}

const reason = (form: FormData) => String(form.get('reason') ?? '');

export async function hideReviewAction(
  org: string,
  event: string,
  reviewId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  return run(org, event, ({ data, event: ev }) =>
    executeCommand(hideReviewCommand, { eventId: ev.id, reviewId, reason: reason(form) }, data.ctx, ports),
  );
}

export async function unhideReviewAction(
  org: string,
  event: string,
  reviewId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  return run(org, event, ({ data, event: ev }) =>
    executeCommand(unhideReviewCommand, { eventId: ev.id, reviewId, reason: reason(form) }, data.ctx, ports),
  );
}

export async function dismissReportsAction(
  org: string,
  event: string,
  reviewId: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  return run(org, event, ({ data, event: ev }) =>
    executeCommand(dismissReportsCommand, { eventId: ev.id, reviewId }, data.ctx, ports),
  );
}
