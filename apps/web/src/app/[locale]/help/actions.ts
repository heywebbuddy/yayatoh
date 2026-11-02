'use server';

import { askHelp } from '@yayatoh/ai';
import { FEEDBACK_REASONS, plainExcerpt, rankArticles, submitHelpFeedbackCommand } from '@yayatoh/cms';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { getLocale } from 'next-intl/server';
import { helpArticlePath } from '@/components/help/help-views.tsx';
import type { FormState } from '@/lib/form-state.ts';
import { aiDrafter } from '@/server/ai.ts';
import { failure, success } from '@/server/form.ts';
import { cachedHelpDocs, helpVoterKey, platformContentOrg } from '@/server/help.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';
import { requestHost } from '@/server/request-origin.ts';

/**
 * "Was this helpful?" (M3.11b). Rate-limited per device (and IP ceiling); one answer per browser
 * per article is kept (answering again replaces it). The org is the platform content org.
 */
export async function helpFeedbackAction(
  slug: string,
  locale: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const limit = await limitAction('helpFeedback');
  if (!limit.allowed) return { ok: false, code: 'rate_limited', reason: String(retryAfterMinutes(limit)) };
  const org = await platformContentOrg(await requestHost());
  if (!org) return { ok: false, code: 'not_found' };
  const helpful = String(form.get('helpful') ?? '') === 'yes';
  const rawReason = String(form.get('reason') ?? '');
  const reason = (FEEDBACK_REASONS as readonly string[]).includes(rawReason) ? rawReason : null;
  try {
    await executeCommand(
      submitHelpFeedbackCommand,
      { slug, locale: locale as never, helpful, reason: reason as never, voterKey: await helpVoterKey() },
      createCtx({ orgId: org.orgId }),
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  return { ...success(), reason: helpful ? 'yes' : reason ? 'reason' : 'no' };
}

export type HelpAnswerReply =
  | {
      readonly kind: 'answer';
      readonly known: boolean;
      readonly answer: string;
      readonly citations: readonly { readonly label: string; readonly href: string }[];
    }
  | { readonly kind: 'rate_limited'; readonly minutes: number }
  /** No AI provider, no credits left, or the provider failed (the search results still stand). */
  | { readonly kind: 'unavailable' };

const HELP_SOURCES = 5;
const HELP_SOURCE_TEXT = 700;

/**
 * AI1: answer a question from the published help articles the search found: only those are sent,
 * and the question isn't stored. One credit of the platform content org per answer.
 */
export async function askHelpAction(question: string): Promise<HelpAnswerReply> {
  const q = String(question ?? '')
    .trim()
    .slice(0, 120);
  const org = await platformContentOrg(await requestHost());
  const drafter = aiDrafter();
  if (q.length < 3 || !org || !drafter) return { kind: 'unavailable' };
  const limit = await limitAction('helpAnswer', { identity: 'help-answer' });
  if (!limit.allowed) return { kind: 'rate_limited', minutes: retryAfterMinutes(limit) };
  const locale = await getLocale();
  const docs = rankArticles(q, await cachedHelpDocs(org.orgId, locale)).slice(0, HELP_SOURCES);
  if (docs.length === 0) return { kind: 'answer', known: false, answer: '', citations: [] };
  const sources = docs.map(({ doc }, i) => ({
    id: `s${i + 1}`,
    label: doc.title.slice(0, 160),
    // Plain text: an answer is shown as text, so it mustn't echo Markdown marks.
    text: (plainExcerpt(doc.body, HELP_SOURCE_TEXT) || doc.summary || doc.title).slice(0, HELP_SOURCE_TEXT),
  }));
  const hrefs = new Map(docs.map(({ doc }, i) => [`s${i + 1}`, helpArticlePath(doc.categorySlug, doc.slug)]));
  try {
    const a = await askHelp(createCtx({ orgId: org.orgId }), ports, drafter, {
      question: q,
      locale,
      sources,
    });
    return {
      kind: 'answer',
      known: a.known,
      answer: a.answer,
      citations: a.sourceIds.flatMap((id) => {
        const href = hrefs.get(id);
        const label = sources.find((s) => s.id === id)?.label;
        return href && label ? [{ label, href }] : [];
      }),
    };
  } catch {
    return { kind: 'unavailable' };
  }
}
