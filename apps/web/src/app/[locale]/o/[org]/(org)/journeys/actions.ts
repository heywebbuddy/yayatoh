'use server';

import {
  createJourneyCommand,
  deleteJourneyCommand,
  INVOICE_REMINDER_MESSAGES,
  invoiceRemindersTemplate,
  setJourneyEnabledCommand,
  updateJourneyCommand,
  VISION_MESSAGES,
  visionTemplate,
} from '@yayatoh/automations';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export interface JourneyFormState {
  readonly ok: boolean;
  readonly code: string | null;
  /** The field the problem is about (`name`, `scope`, `steps.2.subject`). */
  readonly field?: string;
}

const fieldOf = (err: { details?: Record<string, unknown> }): string | undefined => {
  if (typeof err.details?.field === 'string') return err.details.field;
  const issue = Array.isArray(err.details?.issues)
    ? (err.details.issues[0] as { path?: string } | undefined)
    : undefined;
  return issue?.path || undefined;
};

/** M5.1d: the invoice reminders' copy in the organizer's language; placeholders stay as written. */
async function invoiceReminderCopy() {
  const t = await getTranslations('journeys.invoiceReminders');
  const keep = {
    name: '{name}',
    event: '{event}',
    when: '{when}',
    invoice: '{invoice}',
    balance: '{balance}',
    due: '{due}',
    link: '{link}',
  };
  return Object.fromEntries(
    INVOICE_REMINDER_MESSAGES.map((k) => [
      k,
      { subject: t(`${k}.subject`, keep), body: t(`${k}.body`, keep) },
    ]),
  ) as Parameters<typeof invoiceRemindersTemplate>[0];
}

/** The vision template's copy in the organizer's language; placeholders stay as `{name}`… */
async function visionCopy() {
  const t = await getTranslations('journeys.vision');
  const keep = { name: '{name}', event: '{event}', when: '{when}' };
  return Object.fromEntries(
    VISION_MESSAGES.map((k) => [k, { subject: t(`${k}.subject`, keep), body: t(`${k}.body`, keep) }]),
  ) as Parameters<typeof visionTemplate>[0];
}

/** New journey: for an event or a series, blank or from the vision template (created off). */
export async function createJourneyAction(
  org: string,
  _prev: JourneyFormState,
  form: FormData,
): Promise<JourneyFormState> {
  const data = await loadConsole(org);
  const scope = String(form.get('scope') ?? '');
  const [kind, id] = scope.split(':');
  if (!id || (kind !== 'event' && kind !== 'series'))
    return { ok: false, code: 'validation_failed', field: 'scope' };
  const raw = form.get('template');
  const template = raw === 'vision' || raw === 'invoice_reminders' ? raw : null;
  const trigger = String(form.get('trigger') ?? 'order_paid');
  const fromTemplate =
    template === 'vision'
      ? visionTemplate(await visionCopy())
      : template === 'invoice_reminders'
        ? invoiceRemindersTemplate(await invoiceReminderCopy())
        : null;
  let journeyId: string;
  try {
    ({ id: journeyId } = await executeCommand(
      createJourneyCommand,
      {
        name: String(form.get('name') ?? ''),
        eventId: kind === 'event' ? id : null,
        seriesId: kind === 'series' ? id : null,
        trigger: fromTemplate?.trigger ?? trigger,
        template,
        steps: fromTemplate?.steps ?? [],
      },
      data.ctx,
      ports,
    ));
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const field = fieldOf(err);
    return {
      ok: false,
      code: err.code,
      field: field === 'eventId' || field === 'seriesId' ? 'scope' : field,
    };
  }
  revalidatePath(`/o/${org}/journeys`);
  redirect({ href: `/o/${org}/journeys/${journeyId}?created=1`, locale: await getLocale() });
  return { ok: true, code: null };
}

/** Save name, trigger and steps (the editor sends the steps as JSON). */
export async function saveJourneyAction(
  org: string,
  journeyId: string,
  _prev: JourneyFormState,
  form: FormData,
): Promise<JourneyFormState> {
  const data = await loadConsole(org);
  let steps: unknown;
  try {
    steps = JSON.parse(String(form.get('steps') ?? '[]'));
  } catch {
    return { ok: false, code: 'validation_failed', field: 'steps' };
  }
  try {
    await executeCommand(
      updateJourneyCommand,
      { journeyId, name: String(form.get('name') ?? ''), trigger: String(form.get('trigger') ?? ''), steps },
      data.ctx,
      ports,
    );
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return { ok: false, code: err.code, field: fieldOf(err) };
  }
  revalidatePath(`/o/${org}/journeys/${journeyId}`);
  redirect({ href: `/o/${org}/journeys/${journeyId}?saved=1`, locale: await getLocale() });
  return { ok: true, code: null };
}

export async function setJourneyEnabledAction(
  org: string,
  journeyId: string,
  enabled: boolean,
): Promise<void> {
  const data = await loadConsole(org);
  let query: string;
  try {
    const r = await executeCommand(setJourneyEnabledCommand, { journeyId, enabled }, data.ctx, ports);
    query = enabled ? 'enabled=1' : `disabled=${r.cancelled}`;
  } catch (err) {
    if (!isDomainError(err)) throw err;
    query = `error=${encodeURIComponent(String(err.details?.reason ?? err.code))}`;
  }
  revalidatePath(`/o/${org}/journeys`);
  redirect({ href: `/o/${org}/journeys/${journeyId}?${query}`, locale: await getLocale() });
}

export async function deleteJourneyAction(org: string, journeyId: string): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(deleteJourneyCommand, { journeyId }, data.ctx, ports);
  revalidatePath(`/o/${org}/journeys`);
  redirect({ href: `/o/${org}/journeys?deleted=1`, locale: await getLocale() });
}
