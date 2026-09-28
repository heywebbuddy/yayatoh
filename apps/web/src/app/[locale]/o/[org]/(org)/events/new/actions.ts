'use server';

import { ATTENDANCE_MODES, createEventCommand, setEventDetailsCommand } from '@yayatoh/events';
import {
  executeCommand,
  executeQuery,
  isDomainError,
  moneyFromDecimal,
  zonedTimeToUtc,
} from '@yayatoh/kernel';
import { createTicketTypeCommand, listTicketTypesQuery } from '@yayatoh/ticketing';
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

/** Which wizard step owns a field (the wizard jumps back to it on a server error). */
const WIZARD_STEP: Readonly<Record<string, number>> = {
  name: 0,
  tagline: 0,
  profile: 0,
  slug: 0,
  timezone: 1,
  startsAt: 1,
  endsAt: 1,
  venueId: 1,
  venueName: 1,
  city: 1,
  attendanceMode: 1,
  ticketName: 2,
  ticketPrice: 2,
  ticketQuantity: 2,
};

export interface WizardState {
  readonly code: string | null;
  readonly field?: string;
  readonly step?: number;
}

const wizardError = (code: string, field?: string): WizardState =>
  field ? { code, field, step: WIZARD_STEP[field] ?? 0 } : { code };

/**
 * The three-step wizard (M1.4f): basics → when and where → tickets and the publish checklist.
 * One submit at the end creates the draft (idempotent per wizard), then applies the venue and
 * attendance mode and the optional first ticket type. Everything is validated before anything
 * is written, so a mistake on step 3 never leaves a half-made event.
 */
export async function guidedCreateAction(
  org: string,
  _prev: WizardState,
  form: FormData,
): Promise<WizardState> {
  const data = await loadConsole(org);
  const get = (k: string) => String(form.get(k) ?? '').trim();
  const timezone = get('timezone') || data.org.timezone;
  const requestKey = get('requestKey');
  const attendanceMode = (ATTENDANCE_MODES as readonly string[]).includes(get('attendanceMode'))
    ? (get('attendanceMode') as (typeof ATTENDANCE_MODES)[number])
    : 'in_person';
  const venueId = get('venueId') || null;
  let startsAt: Date;
  let endsAt: Date;
  try {
    startsAt = zonedTimeToUtc(get('startsAt'), timezone);
  } catch {
    return wizardError('validation_failed', 'startsAt');
  }
  try {
    endsAt = zonedTimeToUtc(get('endsAt'), timezone);
  } catch {
    return wizardError('validation_failed', 'endsAt');
  }
  // The optional first pass: all or nothing, checked before the event exists.
  const ticketName = get('ticketName');
  const ticketQuantity = get('ticketQuantity');
  const ticketPrice = get('ticketPrice');
  let ticket: { name: string; priceMinor: number; quantityTotal: number } | null = null;
  if (ticketName || ticketQuantity || ticketPrice) {
    if (!ticketName || ticketName.length > 120) return wizardError('validation_failed', 'ticketName');
    const quantity = Number(ticketQuantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000)
      return wizardError('validation_failed', 'ticketQuantity');
    let priceMinor: number;
    try {
      priceMinor = moneyFromDecimal(ticketPrice || '0', data.org.currency).amount;
    } catch {
      return wizardError('validation_failed', 'ticketPrice');
    }
    ticket = { name: ticketName, priceMinor, quantityTotal: quantity };
  }
  const input = {
    name: get('name'),
    tagline: get('tagline') || null,
    profile: get('profile') || data.profile,
    timezone,
    startsAt,
    endsAt,
    venueName: venueId ? null : get('venueName') || null,
    city: venueId ? null : get('city') || null,
    currency: data.org.currency,
  };
  let slug: string;
  try {
    const ctx = requestKey ? { ...data.ctx, idempotencyKey: `wizard:${requestKey}` } : data.ctx;
    const created = requestKey
      ? await executeCommand(IDEMPOTENT_CREATE, input, ctx, ports)
      : await executeCommand(createEventCommand, input, ctx, ports);
    slug = created.slug;
    if (venueId || attendanceMode !== 'in_person')
      await executeCommand(
        setEventDetailsCommand,
        { eventId: created.id, ...(venueId ? { venueId } : {}), attendanceMode },
        data.ctx,
        ports,
      );
    if (ticket && data.modules.has('ticketing')) {
      const existing = await executeQuery(listTicketTypesQuery, { eventId: created.id }, data.ctx, ports);
      // A repeated submit (same wizard) replays the event; don't add its pass twice.
      if (!existing.some((x) => x.name === ticket.name))
        await executeCommand(createTicketTypeCommand, { eventId: created.id, ...ticket }, data.ctx, ports);
    }
  } catch (err) {
    if (isDomainError(err)) {
      const issues = (err.details?.issues ?? []) as { path: string }[];
      const field =
        typeof err.details?.field === 'string'
          ? err.details.field
          : issues[0]?.path.split('.')[0] || undefined;
      return wizardError(err.code, field);
    }
    throw err;
  }
  return redirect({ href: `/o/${org}/e/${slug}/setup-guide`, locale: await getLocale() });
}
