'use server';

import { publishRsvpQuestionsCommand, removeMenuOptionCommand, saveMenuOptionCommand } from '@yayatoh/guests';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const path = (org: string, event: string) => `/o/${org}/e/${event}/guests/questions`;

/** The builder's publish result: the new version on success (the builder keeps editing from it). */
export type PublishState = FormState & { readonly version?: number };

/**
 * Publish the builder's draft as the next version of the event's RSVP questions (M4.1e). The
 * draft travels as JSON; the command checks it (conditions, sub-events, the menu) and refuses a
 * publish from a stale version (another editor published meanwhile).
 */
export async function publishQuestionsAction(
  org: string,
  event: string,
  _prev: PublishState,
  form: FormData,
): Promise<PublishState> {
  const { data, event: ev } = await loadEvent(org, event, 'guests');
  let definition: unknown;
  try {
    definition = JSON.parse(String(form.get('definition') ?? ''));
  } catch {
    return { ok: false, code: 'validation_failed', reason: 'invalid' };
  }
  const seen = Number(form.get('version'));
  try {
    const r = await executeCommand(
      publishRsvpQuestionsCommand,
      {
        eventId: ev.id,
        definition: definition as never,
        ...(Number.isInteger(seen) && seen >= 0 ? { expectedVersion: seen } : {}),
      },
      data.ctx,
      ports,
    );
    revalidatePath(path(org, event));
    return { ...success(), version: r.version };
  } catch (err) {
    return failure(err);
  }
}

/** Add a menu option, or change one (`optionId`): a rename follows onto the guests who chose it. */
export async function saveMenuOptionAction(
  org: string,
  event: string,
  optionId: string | null,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'guests');
  const label = String(form.get('label') ?? '').trim();
  if (!label) return { ok: false, code: 'validation_failed', fields: ['label'] };
  try {
    await executeCommand(
      saveMenuOptionCommand,
      {
        eventId: ev.id,
        ...(optionId ? { optionId } : {}),
        label,
        notes: textOrNull(form, 'notes'),
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event));
  return success();
}

/** Remove a menu option nobody chose. */
export async function removeMenuOptionAction(
  org: string,
  event: string,
  optionId: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'guests');
  try {
    await executeCommand(removeMenuOptionCommand, { eventId: ev.id, optionId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event));
  return success();
}
