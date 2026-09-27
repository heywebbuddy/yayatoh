'use server';

import { createEventCommand } from '@yayatoh/events';
import { executeCommand, isDomainError, zonedTimeToUtc } from '@yayatoh/kernel';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export interface CreateEventState {
  readonly code: string | null;
  readonly field?: string;
}

export async function createEventAction(
  org: string,
  _prev: CreateEventState,
  form: FormData,
): Promise<CreateEventState> {
  const data = await loadConsole(org);
  const get = (k: string) => String(form.get(k) ?? '').trim();
  const timezone = get('timezone') || data.org.timezone;
  let slug: string;
  try {
    const created = await executeCommand(
      createEventCommand,
      {
        name: get('name'),
        profile: get('profile') || data.profile,
        timezone,
        // Organizers enter wall-clock times in the event's zone (CLAUDE.md → Time).
        startsAt: zonedTimeToUtc(get('startsAt'), timezone),
        endsAt: zonedTimeToUtc(get('endsAt'), timezone),
        venueName: get('venueName') || null,
        city: get('city') || null,
        currency: data.org.currency,
      },
      data.ctx,
      ports,
    );
    slug = created.slug;
  } catch (err) {
    if (isDomainError(err)) {
      const field = typeof err.details?.field === 'string' ? err.details.field : undefined;
      return field ? { code: err.code, field } : { code: err.code };
    }
    if (err instanceof Error && /YYYY-MM-DDTHH:mm/.test(err.message)) return { code: 'validation_failed' };
    throw err;
  }
  return redirect({ href: `/o/${org}/e/${slug}`, locale: await getLocale() });
}
