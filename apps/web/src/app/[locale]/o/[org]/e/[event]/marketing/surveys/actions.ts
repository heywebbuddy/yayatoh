'use server';

import { type FieldDefinition, SURVEY_FIELD_TYPES } from '@yayatoh/forms';
import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import {
  createSurveyCommand,
  saveSurveyQuestionsCommand,
  sendSurveyCommand,
  setSurveyClosedCommand,
  surveyExportBulk,
  surveyQuery,
  surveyTargetsQuery,
  updateSurveyCommand,
} from '@yayatoh/surveys';
import { revalidatePath } from 'next/cache';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import type { FormState } from '@/lib/form-state.ts';
import { runBulkInline } from '@/server/bulk.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const base = (org: string, event: string) => `/o/${org}/e/${event}/marketing/surveys`;
const invalid = (...fields: string[]): FormState => ({ ok: false, code: 'validation_failed', fields });

/**
 * Create the post-event survey or a session's feedback survey, with a starting set of questions
 * written in the organizer's language (NPS, an overall rating, "what could we do better?").
 */
export async function createSurveyAction(
  org: string,
  event: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const locale = await getLocale();
  const { data, event: ev } = await loadEvent(org, event, 'marketing');
  const t = await getTranslations('surveys');
  const kind = form.get('kind') === 'session_feedback' ? 'session_feedback' : 'post_event';
  let subject = ev.name;
  let sessionId: string | null = null;
  if (kind === 'session_feedback') {
    sessionId = String(form.get('sessionId') ?? '');
    if (!/^[0-9a-f-]{36}$/.test(sessionId)) return invalid('sessionId');
    // The title names the session; the command checks it belongs to this event again.
    const targets = await executeQuery(surveyTargetsQuery, { eventId: ev.id }, data.ctx, ports);
    const session = targets.sessions.find((s) => s.id === sessionId);
    if (!session) return invalid('sessionId');
    subject = session.title;
  }
  let id: string;
  try {
    ({ id } = await executeCommand(
      createSurveyCommand,
      {
        eventId: ev.id,
        kind,
        sessionId,
        title: (kind === 'post_event'
          ? t('defaultTitle', { event: subject })
          : t('defaultSessionTitle', { session: subject })
        ).slice(0, 120),
        definition: {
          fields: [
            { key: 'nps', type: 'nps', label: t('defaultNps', { subject }).slice(0, 200), required: true },
            { key: 'overall', type: 'rating', label: t('defaultRating') },
            { key: 'improve', type: 'long_text', label: t('defaultImprove') },
          ],
        },
      },
      data.ctx,
      ports,
    ));
  } catch (err) {
    return failure(err);
  }
  revalidatePath(base(org, event));
  return redirect({ href: `${base(org, event)}/${id}`, locale });
}

export async function updateSurveyAction(
  org: string,
  event: string,
  surveyId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'marketing');
  const title = String(form.get('title') ?? '').trim();
  if (!title) return invalid('title');
  try {
    await executeCommand(
      updateSurveyCommand,
      { eventId: ev.id, surveyId, title, intro: String(form.get('intro') ?? '') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`${base(org, event)}/${surveyId}`);
  return success();
}

/** Every change publishes a new form version (answers keep the version they were given on). */
async function editQuestions(
  org: string,
  event: string,
  surveyId: string,
  change: (fields: FieldDefinition[]) => FieldDefinition[] | Record<string, unknown>[],
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'marketing');
  try {
    const current = await executeQuery(surveyQuery, { eventId: ev.id, surveyId }, data.ctx, ports);
    const fields = change([...current.definition.fields]);
    await executeCommand(
      saveSurveyQuestionsCommand,
      { eventId: ev.id, surveyId, definition: { fields } },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`${base(org, event)}/${surveyId}`);
  return success();
}

/** A stable key from the label ("How was the food?" → how_was_the_food), unique within the survey. */
function keyFor(label: string, taken: Set<string>): string {
  const base =
    label
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'question';
  const start = /^[a-z]/.test(base) ? base : `q_${base}`.slice(0, 34);
  let key = start;
  for (let n = 2; taken.has(key); n++) key = `${start.slice(0, 30)}_${n}`;
  return key;
}

export async function addSurveyQuestionAction(
  org: string,
  event: string,
  surveyId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const label = String(form.get('label') ?? '').trim();
  const rawType = String(form.get('type') ?? '');
  const type = (SURVEY_FIELD_TYPES as readonly string[]).includes(rawType) ? rawType : 'short_text';
  const choice = type === 'select' || type === 'multi_select';
  const labels = String(form.get('options') ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const missing = [...(label ? [] : ['label']), ...(choice && labels.length === 0 ? ['options'] : [])];
  if (missing.length) return invalid(...missing);
  const taken = new Set<string>();
  const options = labels.map((l) => {
    const value = keyFor(l, taken);
    taken.add(value);
    return { value, label: l.slice(0, 120) };
  });
  return editQuestions(org, event, surveyId, (fields) => [
    ...fields,
    {
      key: keyFor(label, new Set(fields.map((f) => f.key))),
      type,
      label: label.slice(0, 200),
      required: form.get('required') === '1',
      options: choice ? options : [],
    },
  ]);
}

export async function removeSurveyQuestionAction(
  org: string,
  event: string,
  surveyId: string,
  key: string,
): Promise<void> {
  await editQuestions(org, event, surveyId, (fields) => fields.filter((f) => f.key !== key));
}

export async function moveSurveyQuestionAction(
  org: string,
  event: string,
  surveyId: string,
  key: string,
  by: -1 | 1,
): Promise<void> {
  await editQuestions(org, event, surveyId, (fields) => {
    const i = fields.findIndex((f) => f.key === key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= fields.length) return fields;
    const next = [...fields];
    [next[i], next[j]] = [next[j] as FieldDefinition, next[i] as FieldDefinition];
    return next;
  });
}

export interface SendState extends FormState {
  readonly sent?: number;
}

const whole = (raw: string, min: number, max: number): number | null | 'bad' => {
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : 'bad';
};

/** Send to the event's attendees (or only those who checked in); the key makes a double submit send once. */
export async function sendSurveyAction(
  org: string,
  event: string,
  surveyId: string,
  _prev: SendState,
  form: FormData,
): Promise<SendState> {
  const { data, event: ev } = await loadEvent(org, event, 'marketing');
  const reminderDays = whole(String(form.get('reminderDays') ?? '').trim(), 1, 30);
  const linkDays = whole(String(form.get('linkDays') ?? '').trim(), 1, 90);
  const bad = [
    ...(reminderDays === 'bad' ? ['reminderDays'] : []),
    ...(linkDays === 'bad' || linkDays === null ? ['linkDays'] : []),
  ];
  if (bad.length) return invalid(...bad);
  const key = String(form.get('key') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(key)) return { ok: false, code: 'validation_failed' };
  try {
    const r = await executeCommand(
      sendSurveyCommand,
      {
        eventId: ev.id,
        surveyId,
        audience: form.get('audience') === 'checked_in' ? 'checked_in' : 'all',
        reminderDays: reminderDays as number | null,
        linkDays: linkDays as number,
      },
      { ...data.ctx, idempotencyKey: key },
      ports,
    );
    revalidatePath(`${base(org, event)}/${surveyId}`);
    return { ...success(), sent: r.sent };
  } catch (err) {
    return failure(err);
  }
}

export async function setSurveyClosedAction(
  org: string,
  event: string,
  surveyId: string,
  closed: boolean,
  _prev: FormState,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'marketing');
  try {
    await executeCommand(setSurveyClosedCommand, { eventId: ev.id, surveyId, closed }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`${base(org, event)}/${surveyId}`);
  return success();
}

/**
 * Export the responses as CSV through the bulk framework (a recent step-up, `attendees:export`):
 * small exports finish in this request; the page then offers the download.
 */
export async function exportSurveyAction(
  org: string,
  event: string,
  surveyId: string,
  _form: FormData,
): Promise<{ code: string } | undefined> {
  const locale = await getLocale();
  const { data, event: ev } = await loadEvent(org, event, 'marketing');
  const t = await getTranslations('surveys');
  const back = `${base(org, event)}/${surveyId}`;
  let operationId: string;
  try {
    ({ operationId } = await executeCommand(
      surveyExportBulk.start,
      {
        eventId: ev.id,
        selection: { filter: { surveyId } },
        params: {
          headers: {
            name: t('exportColumns.name'),
            email: t('exportColumns.email'),
            submittedAt: t('exportColumns.submittedAt'),
          },
          yes: t('yes'),
          no: t('no'),
        },
      },
      data.ctx,
      ports,
    ));
  } catch (err) {
    const code = isDomainError(err) ? err.code : 'internal';
    if (code === 'step_up_required') return { code };
    return redirect({ href: `${back}?exportError=${code}`, locale });
  }
  await runBulkInline(data.org.id, operationId);
  redirect({ href: `${back}?op=${operationId}`, locale });
}
