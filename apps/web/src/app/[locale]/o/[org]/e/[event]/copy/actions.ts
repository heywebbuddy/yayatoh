'use server';

import { executeCommand, isDomainError, zonedTimeToUtc } from '@yayatoh/kernel';
import { duplicateEventCommand, saveTemplateCommand } from '@yayatoh/templates';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export interface CopyFormState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly field?: string;
}

const failure = (err: unknown): CopyFormState => {
  if (isDomainError(err)) {
    const d = err.details ?? {};
    const issue = Array.isArray(d.issues) ? (d.issues[0] as { path?: string } | undefined) : undefined;
    const field = typeof d.field === 'string' ? d.field : issue?.path;
    return field ? { ok: false, code: err.code, field } : { ok: false, code: err.code };
  }
  if (err instanceof Error && /YYYY-MM-DDTHH:mm/.test(err.message))
    return { ok: false, code: 'validation_failed', field: 'startsAt' };
  throw err;
};

/** Duplicate the event (a new draft; never its orders) and open the copy. */
export async function duplicateAction(
  org: string,
  event: string,
  _prev: CopyFormState,
  form: FormData,
): Promise<CopyFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'copy');
  const startsAt = String(form.get('startsAt') ?? '').trim();
  let slug: string;
  try {
    const copy = await executeCommand(
      duplicateEventCommand,
      {
        eventId: ev.id,
        name: String(form.get('name') ?? '').trim(),
        ...(startsAt ? { startsAt: zonedTimeToUtc(startsAt, ev.timezone) } : {}),
      },
      data.ctx,
      ports,
    );
    slug = copy.slug;
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}`, 'layout');
  return redirect({ href: `/o/${org}/e/${slug}`, locale: await getLocale() });
}

export async function saveTemplateAction(
  org: string,
  event: string,
  _prev: CopyFormState,
  form: FormData,
): Promise<CopyFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'copy');
  try {
    await executeCommand(
      saveTemplateCommand,
      {
        eventId: ev.id,
        name: String(form.get('name') ?? '').trim(),
        description: String(form.get('description') ?? '').trim() || null,
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/templates`);
  return { ok: true, code: null };
}
