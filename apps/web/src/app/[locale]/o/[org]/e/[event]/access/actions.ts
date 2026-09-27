'use server';

import { createAccessCodeCommand, setAccessCodeActiveCommand, setPrivateInfoCommand } from '@yayatoh/events';
import { executeCommand, zonedTimeToUtc } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, numberOrNull, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const done = (org: string, event: string) => revalidatePath(`/o/${org}/e/${event}/access`);

export async function savePrivateInfoAction(
  org: string,
  event: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      setPrivateInfoCommand,
      {
        eventId: ev.id,
        body: String(form.get('body') ?? ''),
        joinUrl: textOrNull(form, 'joinUrl'),
        joinOpensMinutes: numberOrNull(form, 'joinOpensMinutes') ?? 30,
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function createAccessCodeAction(
  org: string,
  event: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event);
  const expires = String(form.get('expiresAt') ?? '').trim();
  let expiresAt: Date | null = null;
  try {
    // A wall-clock time in the event's timezone (CLAUDE.md → Time).
    expiresAt = expires ? zonedTimeToUtc(expires, ev.timezone) : null;
  } catch {
    return { ok: false, code: 'validation_failed', fields: ['expiresAt'] };
  }
  try {
    await executeCommand(
      createAccessCodeCommand,
      {
        eventId: ev.id,
        code: String(form.get('code') ?? ''),
        label: textOrNull(form, 'label'),
        unlocksEvent: form.get('unlocksEvent') === '1',
        ticketTypeIds: form.getAll('ticketTypeIds').map(String),
        maxUses: numberOrNull(form, 'maxUses'),
        expiresAt,
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function setAccessCodeActiveAction(
  org: string,
  event: string,
  accessCodeId: string,
  active: boolean,
): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(setAccessCodeActiveCommand, { eventId: ev.id, accessCodeId, active }, data.ctx, ports);
  done(org, event);
}
