'use server';

import { createEventCommand } from '@yayatoh/events';
import { executeCommand, isDomainError, zonedTimeToUtc } from '@yayatoh/kernel';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

const IDEMPOTENT_CREATE = { ...createEventCommand, idempotent: true };

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
  const requestKey = get('requestKey');
  // Built inside run(): an unparseable date throws there and is mapped below.
  const input = () => ({
    name: get('name'),
    profile: get('profile') || data.profile,
    timezone,
    // Organizers enter wall-clock times in the event's zone (CLAUDE.md → Time).
    startsAt: zonedTimeToUtc(get('startsAt'), timezone),
    endsAt: zonedTimeToUtc(get('endsAt'), timezone),
    venueName: get('venueName') || null,
    city: get('city') || null,
    currency: data.org.currency,
  });
  // With the form's request key the create is idempotent: a repeated submit gets the same event.
  const run = () =>
    requestKey
      ? executeCommand(IDEMPOTENT_CREATE, input(), { ...data.ctx, idempotencyKey: requestKey }, ports)
      : executeCommand(createEventCommand, input(), data.ctx, ports);
  let slug: string;
  try {
    let created: Awaited<ReturnType<typeof run>>;
    try {
      created = await run();
    } catch (err) {
      // A concurrent double submit loses the slug race to its twin; once the twin commits, the
      // same request key replays its result.
      if (!requestKey || !isDomainError(err) || err.details?.field !== 'slug') throw err;
      await new Promise((r) => setTimeout(r, 400));
      created = await run();
    }
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
