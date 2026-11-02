'use server';

import { type SummarizeResultDto, summarizeAnswers } from '@yayatoh/ai';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  dismissReportsCommand,
  hideReviewCommand,
  listReviewsQuery,
  unhideReviewCommand,
} from '@yayatoh/reviews';
import { revalidatePath, updateTag } from 'next/cache';
import { getLocale } from 'next-intl/server';
import type { AiComposeResult } from '@/lib/ai-compose.ts';
import { orgChangeTags } from '@/lib/cache-keys.ts';
import type { FormState } from '@/lib/form-state.ts';
import { aiDrafter } from '@/server/ai.ts';
import { aiCall } from '@/server/ai-compose.ts';
import { insightAnswers } from '@/server/ai-insights.ts';
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

/** AI1: summarize the reviews the public can see. Hidden ones are never sent. */
export async function summarizeReviewsAction(
  org: string,
  event: string,
): Promise<AiComposeResult<SummarizeResultDto>> {
  const { data, event: ev, can } = await loadEvent(org, event, 'reviews');
  if (!can('events:write') || !data.modules.has('ai_insights')) return { ok: false, code: 'forbidden' };
  const locale = await getLocale();
  return aiCall({ orgId: data.org.id, userId: data.session.userId, key: 'insights' }, async () => {
    const list = await executeQuery(listReviewsQuery, { eventId: ev.id, filter: 'visible' }, data.ctx, ports);
    const answers = insightAnswers(list.reviews.map((r) => ({ text: r.body, rating: r.rating })));
    const value = await summarizeAnswers(data.ctx, ports, aiDrafter(), {
      subject: 'reviews',
      subjectId: ev.id,
      eventId: ev.id,
      answers,
      total: Math.max(answers.length, list.reviews.length < list.count ? list.count : 0),
      locale,
    });
    return { value, balance: value.balance };
  });
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
