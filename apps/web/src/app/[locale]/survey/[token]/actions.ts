'use server';

import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { publicSurvey, submitSurveyResponseCommand, surveyRef } from '@yayatoh/surveys';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';

export interface SurveyFormState {
  /** `required` / `invalid` (a question), a DomainError reason (`already_answered`, `expired`, `closed`) or code. */
  readonly code: string | null;
  readonly field?: string;
}

/**
 * The respondent answers from their link. The link is the only credential: its org comes from the
 * signed invitation id, never from input. Answers are read by the questions' keys and types and
 * validated again by the forms engine; success shows the thank-you page.
 */
export async function submitSurveyAction(
  token: string,
  _prev: SurveyFormState,
  form: FormData,
): Promise<SurveyFormState> {
  const locale = await getLocale();
  const ref = await surveyRef(token);
  if (!ref) return { code: 'not_found' };
  const view = await publicSurvey(token);
  if (!view) return { code: 'not_found' };
  if (view.state !== 'open') return { code: view.state === 'answered' ? 'already_answered' : view.state };
  const answers: Record<string, unknown> = {};
  for (const q of view.form?.fields ?? []) {
    const name = `q:${q.key}`;
    if (q.type === 'multi_select') {
      const all = form.getAll(name).map(String);
      if (all.length) answers[q.key] = all;
    } else {
      const v = String(form.get(name) ?? '').trim();
      if (v) answers[q.key] = q.type === 'checkbox' ? true : v;
    }
  }
  try {
    await executeCommand(
      submitSurveyResponseCommand,
      { token, answers },
      createCtx({ orgId: ref.orgId }),
      ports,
    );
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const field = typeof err.details?.field === 'string' ? err.details.field : undefined;
    if (field) return { code: answers[field] === undefined ? 'required' : 'invalid', field };
    return { code: String(err.details?.reason ?? '') || err.code };
  }
  return redirect({ href: `/survey/${token}?thanks=1`, locale });
}
