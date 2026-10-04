'use server';

import {
  type CalculationDto,
  calculateCreditsCommand,
  parseCredits,
  removeSessionRuleCommand,
  setCeSettingsCommand,
  setSessionRuleCommand,
} from '@yayatoh/ce';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/**
 * CE credits (M6.9b): the credit's name and accreditor, a rule per session, and the calculation
 * that issues certificates. The commands check `events:write` and the `virtual` module.
 */
const path = (org: string, event: string) => `/o/${org}/e/${event}/ce-credits`;

export async function saveSettingsAction(
  org: string,
  event: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'ceCredits');
  const creditLabel = String(form.get('creditLabel') ?? '');
  const accreditor = String(form.get('accreditor') ?? '');
  const fields = [
    ...(creditLabel.trim().length > 60 ? ['creditLabel'] : []),
    ...(accreditor.trim().length > 120 ? ['accreditor'] : []),
  ];
  if (fields.length) return { ok: false, code: 'validation_failed', fields };
  try {
    await executeCommand(setCeSettingsCommand, { eventId: ev.id, creditLabel, accreditor }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event), 'page');
  return success();
}

export async function saveRuleAction(
  org: string,
  event: string,
  sessionId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'ceCredits');
  const credits = parseCredits(String(form.get('credits') ?? ''));
  const rawMinutes = String(form.get('minMinutes') ?? '').trim();
  const minMinutes = /^\d{1,4}$/.test(rawMinutes) ? Number(rawMinutes) : Number.NaN;
  const countInPerson = form.get('countInPerson') === 'on';
  const countVirtual = form.get('countVirtual') === 'on';
  const fields = [
    ...(credits === null ? ['credits'] : []),
    ...(!(minMinutes >= 1 && minMinutes <= 1440) ? ['minMinutes'] : []),
    ...(!countInPerson && !countVirtual ? ['countInPerson'] : []),
  ];
  if (fields.length) return { ok: false, code: 'validation_failed', fields };
  try {
    await executeCommand(
      setSessionRuleCommand,
      { eventId: ev.id, sessionId, credits: credits as number, minMinutes, countInPerson, countVirtual },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event), 'page');
  return success();
}

export async function removeRuleAction(
  org: string,
  event: string,
  sessionId: string,
  _prev: FormState,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'ceCredits');
  try {
    await executeCommand(removeSessionRuleCommand, { eventId: ev.id, sessionId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event), 'page');
  return success();
}

/** What a calculation returns to its form: the counts it shows. */
export interface CalculationState extends FormState {
  readonly result?: CalculationDto;
}

export async function calculateAction(
  org: string,
  event: string,
  _prev: CalculationState,
): Promise<CalculationState> {
  const { data, event: ev } = await loadEvent(org, event, 'ceCredits');
  try {
    const result = await executeCommand(calculateCreditsCommand, { eventId: ev.id }, data.ctx, ports);
    revalidatePath(path(org, event), 'page');
    return { ...success(), result };
  } catch (err) {
    return failure(err);
  }
}
