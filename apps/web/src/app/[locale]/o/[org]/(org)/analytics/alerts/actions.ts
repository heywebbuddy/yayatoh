'use server';

import {
  createAlertRuleCommand,
  deleteAlertRuleCommand,
  setAlertRuleEnabledCommand,
  updateAlertRuleCommand,
} from '@yayatoh/analytics';
import { executeCommand } from '@yayatoh/kernel';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import type { FormState } from '@/lib/form-state.ts';
import { parseThreshold } from '@/lib/rule-threshold.ts';
import { loadConsole } from '@/server/console.ts';
import { failure } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const text = (form: FormData, k: string) => String(form.get(k) ?? '').trim();

function fields(form: FormData) {
  const measure = text(form, 'measure');
  const condition = text(form, 'condition');
  const currency = text(form, 'currency');
  return {
    name: text(form, 'name'),
    measure,
    condition,
    threshold: parseThreshold(text(form, 'threshold'), measure, condition, currency),
    windowDays: Number(text(form, 'windowDays')),
    currency,
    eventId: text(form, 'eventId') || null,
    severity: text(form, 'severity') || 'warning',
    quietHours: form.get('quietHours') === '1',
  };
}

const badThreshold: FormState = { ok: false, code: 'validation_failed', fields: ['threshold'] };

async function back(org: string, done: string): Promise<never> {
  redirect({ href: `/o/${org}/analytics/alerts?done=${done}`, locale: await getLocale() });
  throw new Error('unreachable');
}

export async function createRuleAction(org: string, _prev: FormState, form: FormData): Promise<FormState> {
  const data = await loadConsole(org);
  const f = fields(form);
  if (f.threshold === null) return badThreshold;
  try {
    await executeCommand(createAlertRuleCommand, f, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  return back(org, 'created');
}

export async function updateRuleAction(
  org: string,
  ruleId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  const f = fields(form);
  if (f.threshold === null) return badThreshold;
  try {
    await executeCommand(updateAlertRuleCommand, { ...f, ruleId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  return back(org, 'saved');
}

export async function toggleRuleAction(org: string, _prev: FormState, form: FormData): Promise<FormState> {
  const data = await loadConsole(org);
  const enabled = form.get('enabled') === '1';
  try {
    await executeCommand(
      setAlertRuleEnabledCommand,
      { ruleId: text(form, 'ruleId'), enabled },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  return back(org, enabled ? 'on' : 'off');
}

export async function deleteRuleAction(org: string, _prev: FormState, form: FormData): Promise<FormState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(deleteAlertRuleCommand, { ruleId: text(form, 'ruleId') }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  return back(org, 'deleted');
}
