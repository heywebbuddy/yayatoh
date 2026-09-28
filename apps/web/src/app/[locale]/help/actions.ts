'use server';

import { FEEDBACK_REASONS, submitHelpFeedbackCommand } from '@yayatoh/cms';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import type { FormState } from '@/lib/form-state.ts';
import { failure, success } from '@/server/form.ts';
import { helpVoterKey, platformContentOrg } from '@/server/help.ts';
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
