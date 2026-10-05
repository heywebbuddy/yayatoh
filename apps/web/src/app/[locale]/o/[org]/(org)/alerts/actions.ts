'use server';

import {
  ALERT_CATEGORIES,
  acknowledgeAlertCommand,
  ROUTING_CHANNELS,
  setAlertRoutingCommand,
  setMyAlertPhoneCommand,
  setSalesTargetCommand,
  snoozeAlertCommand,
} from '@yayatoh/alerts';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { ORG_ROLES } from '@yayatoh/tenancy';
import { revalidatePath } from 'next/cache';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export type AlertActionState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'acknowledged' }
  | { readonly kind: 'snoozed'; readonly until: string }
  | { readonly kind: 'error'; readonly code: string };

const codeOf = (err: unknown) => (isDomainError(err) ? err.code : 'internal');

/**
 * Acknowledge or snooze one alert (M3.2b). The commands refuse members without `alerts:manage`
 * (viewers and scanners see no buttons, and are refused here too) and alerts they may not see.
 */
export async function alertAction(
  org: string,
  alertId: string,
  _prev: AlertActionState,
  form: FormData,
): Promise<AlertActionState> {
  const data = await loadConsole(org);
  try {
    if (form.get('op') === 'snooze') {
      const minutes = Number(form.get('minutes'));
      const r = await executeCommand(snoozeAlertCommand, { alertId, minutes }, data.ctx, ports);
      revalidatePath(`/o/${org}`, 'layout');
      return { kind: 'snoozed', until: (r.snoozedUntil ?? new Date()).toISOString() };
    }
    await executeCommand(acknowledgeAlertCommand, { alertId }, data.ctx, ports);
    revalidatePath(`/o/${org}`, 'layout');
    return { kind: 'acknowledged' };
  } catch (err) {
    return { kind: 'error', code: codeOf(err) };
  }
}

export type SettingsFormState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'saved';
      readonly what: 'phone' | 'phoneCleared' | 'routing' | 'target' | 'targetCleared';
      readonly seq: number;
    }
  | {
      readonly kind: 'error';
      readonly code: string;
      readonly field: string | null;
      readonly value: string;
      readonly seq: number;
    };

const next = (prev: SettingsFormState) => (prev.kind === 'idle' ? 0 : prev.seq) + 1;

/** The member's own alert number (texts); empty turns texts off. */
export async function savePhoneAction(
  org: string,
  prev: SettingsFormState,
  form: FormData,
): Promise<SettingsFormState> {
  const data = await loadConsole(org);
  const seq = next(prev);
  const raw = String(form.get('smsPhone') ?? '').trim();
  try {
    await executeCommand(setMyAlertPhoneCommand, { smsPhone: raw === '' ? null : raw }, data.ctx, ports);
    revalidatePath(`/o/${org}/alerts/settings`);
    return { kind: 'saved', what: raw === '' ? 'phoneCleared' : 'phone', seq };
  } catch (err) {
    return { kind: 'error', code: codeOf(err), field: 'smsPhone', value: raw, seq };
  }
}

/** Owners and admins: the whole routing grid (every role × group; ticked channels). */
export async function saveRoutingAction(
  org: string,
  prev: SettingsFormState,
  form: FormData,
): Promise<SettingsFormState> {
  const data = await loadConsole(org);
  const seq = next(prev);
  const ticked = new Set(form.getAll('cell').map(String));
  const cells = ORG_ROLES.flatMap((role) =>
    ALERT_CATEGORIES.map((category) => ({
      role,
      category,
      channels: ROUTING_CHANNELS.filter((c) => ticked.has(`${role}:${category}:${c}`)),
    })),
  );
  try {
    await executeCommand(setAlertRoutingCommand, { cells }, data.ctx, ports);
    revalidatePath(`/o/${org}/alerts/settings`);
    return { kind: 'saved', what: 'routing', seq };
  } catch (err) {
    return { kind: 'error', code: codeOf(err), field: null, value: '', seq };
  }
}

/** One event's ticket target (the sales pace rule); empty removes it. */
export async function saveTargetAction(
  org: string,
  eventId: string,
  prev: SettingsFormState,
  form: FormData,
): Promise<SettingsFormState> {
  const data = await loadConsole(org);
  const seq = next(prev);
  const raw = String(form.get('tickets') ?? '').trim();
  if (raw !== '' && !/^\d{1,8}$/.test(raw))
    return { kind: 'error', code: 'validation_failed', field: 'tickets', value: raw, seq };
  try {
    await executeCommand(
      setSalesTargetCommand,
      { eventId, tickets: raw === '' ? null : Number(raw) },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/alerts/settings`);
    return { kind: 'saved', what: raw === '' ? 'targetCleared' : 'target', seq };
  } catch (err) {
    return { kind: 'error', code: codeOf(err), field: 'tickets', value: raw, seq };
  }
}
