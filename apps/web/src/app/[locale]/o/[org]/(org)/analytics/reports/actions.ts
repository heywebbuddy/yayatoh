'use server';

import {
  createReportScheduleCommand,
  deleteReportScheduleCommand,
  setReportScheduleEnabledCommand,
  updateReportScheduleCommand,
} from '@yayatoh/analytics';
import { executeCommand } from '@yayatoh/kernel';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import type { FormState } from '@/lib/form-state.ts';
import { loadConsole } from '@/server/console.ts';
import { failure } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const text = (form: FormData, k: string) => String(form.get(k) ?? '').trim();

const fields = (form: FormData) => ({
  name: text(form, 'name'),
  frequency: text(form, 'frequency'),
  sendHour: Number(text(form, 'sendHour') || '8'),
  eventId: text(form, 'eventId') || null,
  recipients: form.getAll('recipients').map(String),
});

async function back(org: string, done: string): Promise<never> {
  redirect({ href: `/o/${org}/analytics/reports?done=${done}`, locale: await getLocale() });
  throw new Error('unreachable');
}

/** Schedule a PDF report (M6.2b; owners and admins, audited by the command). */
export async function createScheduleAction(
  org: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(createReportScheduleCommand, fields(form), data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  return back(org, 'created');
}

export async function updateScheduleAction(
  org: string,
  scheduleId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(updateReportScheduleCommand, { ...fields(form), scheduleId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  return back(org, 'saved');
}

export async function toggleScheduleAction(
  org: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  const enabled = form.get('enabled') === '1';
  try {
    await executeCommand(
      setReportScheduleEnabledCommand,
      { scheduleId: text(form, 'scheduleId'), enabled },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  return back(org, enabled ? 'on' : 'off');
}

export async function deleteScheduleAction(
  org: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(
      deleteReportScheduleCommand,
      { scheduleId: text(form, 'scheduleId') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  return back(org, 'deleted');
}
