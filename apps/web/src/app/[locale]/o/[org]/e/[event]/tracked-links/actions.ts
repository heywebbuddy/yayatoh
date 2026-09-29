'use server';

import { executeCommand } from '@yayatoh/kernel';
import { createTrackedLinkCommand, setAttributionWindowCommand } from '@yayatoh/marketing';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/** Create a tracked link for this event (M3.8a). The command checks `marketing:write`. */
export async function createTrackedLinkAction(
  org: string,
  event: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'trackedLinks');
  try {
    await executeCommand(
      createTrackedLinkCommand,
      {
        eventId: ev.id,
        source: String(form.get('source') ?? ''),
        medium: String(form.get('medium') ?? ''),
        campaign: String(form.get('campaign') ?? ''),
        content: textOrNull(form, 'content'),
        term: textOrNull(form, 'term'),
        label: textOrNull(form, 'label'),
        destinationPath: textOrNull(form, 'destinationPath'),
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/e/${event}/tracked-links`);
  return success();
}

/** The org's attribution window in days (applies to orders placed from now on). */
export async function setAttributionWindowAction(
  org: string,
  event: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data } = await loadEvent(org, event, 'trackedLinks');
  try {
    await executeCommand(
      setAttributionWindowCommand,
      { windowDays: Number(String(form.get('windowDays') ?? '').trim() || Number.NaN) },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/e/${event}/tracked-links`);
  return success();
}
